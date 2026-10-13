#!/usr/bin/env node
/**
 * War Room — 无鉴权 · 无身份 · 全局单局（零依赖单文件）
 *
 * 模型：
 *   - 服务端从头到尾只有【一盘进行中的游戏】，状态由服务端权威持有。
 *   - 连接即匿名：WebSocket 一连上就是一个无身份通道，不传"你是谁"。
 *   - 视角是纯客户端概念：操作以 (国家, 动作, 参数) 的形式发来，服务端不做权限/归属判断。
 *   - 任何操作 → 服务端状态变化 → 立即广播给所有在线连接（动作来源对他人无感）。
 *
 * 启动:  node server.js   (默认端口 3000)
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

/* ============================================================
 * 一、最小 WebSocket 实现（RFC 6455）
 * ============================================================ */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function upgradeToWebSocket(req, socket, head, { onMessage, onClose }) {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const conn = {
    id: crypto.randomBytes(8).toString("hex"),
    alive: true,
    send(data) {
      if (!conn.alive) return;
      const payload = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
      try { socket.write(encodeFrame(payload, 0x1)); } catch { conn.alive = false; }
    },
    close() {
      conn.alive = false;
      try { socket.write(encodeFrame(Buffer.alloc(0), 0x8)); } catch {}
      try { socket.destroy(); } catch {}
    },
  };

  let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      buffer = frame.rest;
      if (frame.opcode === 0x8) { conn.alive = false; onClose(conn); socket.destroy(); return; }
      if (frame.opcode === 0x9) { try { socket.write(encodeFrame(frame.payload, 0xA)); } catch {} continue; }
      if (frame.opcode === 0x1 || frame.opcode === 0x2) onMessage(conn, frame.payload.toString("utf8"));
    }
  });
  socket.on("close", () => { conn.alive = false; onClose(conn); });
  socket.on("error", () => { conn.alive = false; onClose(conn); });

  return conn;
}

function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  let maskKey = null;
  if (masked) { if (buf.length < offset + 4) return null; maskKey = buf.subarray(offset, offset + 4); offset += 4; }
  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
  return { opcode, payload, rest: buf.subarray(offset + len) };
}

/* ============================================================
 * 二、全局唯一的游戏状态（服务端权威）
 * ============================================================ */

const PHASES = [
  "phase1_economy", "phase2_planning", "phase3_movement",
  "phase4_combat", "phase5_refit", "phase6_morale", "phase7_production",
];

const NATIONS = [
  { id: "germany", name: "德意志", flag: "Germany_Flag.jpg", alliance: "axis" },
  { id: "italy",   name: "意大利", flag: "Italy_Flag.jpg",   alliance: "axis" },
  { id: "japan",   name: "日本",   flag: "Japan_Flag.jpg",   alliance: "axis" },
  { id: "britain", name: "英联邦", flag: "Britain_Flag.jpg", alliance: "allies" },
  { id: "soviet",  name: "苏联",   flag: "Soviet_Flag.jpg",  alliance: "allies" },
  { id: "usa",     name: "美国",   flag: "USA_Flag.jpg",     alliance: "allies" },
  { id: "china",   name: "中国",   flag: "China_Flag.jpg",   alliance: "allies" },
];

// —— 全局单局状态 ——
const game = {
  scenario: "global",
  round: 1,
  phase: PHASES[0],
  phaseIndex: 0,
  status: "playing",           // 永远有一盘进行中的游戏
  // 国家 -> 状态：联盟、资源储量、是否已确认、压力、阶段2 竞价与指令
  nations: Object.fromEntries(NATIONS.map((n) => [n.id, {
    alliance: n.alliance,
    resources: { oil: 0, iron: 0, osr: 0 },   // 当前储量
    income:    { oil: 0, iron: 0, osr: 0 },   // 本回合收入（由地块归属派生）
    confirmed: false,                          // 是否已点「确认」
    bid: 0,                                     // 阶段2：石油竞价
    orders: Array(9).fill(null),                // 阶段2：最多 9 个指令 { formationId, dest } 或 null
  }])),
  // 棋盘：领土归属 + 交战状态；单位将在后续阶段填充
  territories: {},             // { code: { owner: nationId|null, embattled: bool } }
  units: {},
  // 阶段结果快照（回看用）：{ [round]: { [phaseKey]: <data> } }
  phaseHistory: {},
  // 阶段2 步骤2-3：回合顺位（竞价 → 依次选位 → 统一支付）
  turnOrder: {
    active: false,          // 是否已进入"展示竞价并重排顺位"步骤
    bids: {},               // {nation: 竞价}（进入步骤时快照）
    queue: [],              // 选择顺序（按竞价高→低，同分随机）
    currentIndex: 0,        // queue 指针（下一个要选的国家）
    picks: Array(7).fill(null),  // 7 个位次 -> nation|null
    done: false,            // 是否全部选完
    paid: false,            // 是否已支付石油
  },
  // 阶段3：移动操作（服务端全权结算状态机）
  roundOrder: [],            // 本轮行动顺位（phase2 结束时保存）
  movePhase: {
    active: false,
    order: [],            // 行动顺位（nationId 数组）
    natIndex: 0,          // 当前结算到第几个国家
    ordIndex: 0,          // 该国当前结算到第几条指令
    cur: null,            // 当前待结算的指令 {nation, orderIndex, formationId, dest}
    awaiting: false,      // 是否在等待"当前指令所属国"点击（执行/放弃）
    resolved: [],         // 已结算记录 [{nation, orderIndex, result:'done'|'cancel'}]
    done: false,
  },
  log: [],
};

/* ---- 地块资源表（服务端权威）：从 territories_full.json 载入 ---- */
let TERR = {};                 // { code: { type, resources, embattledResources, startingOwner } }
function loadTerritoriesData() {
  try {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, "territories_full.json"), "utf8");
    const arr = JSON.parse(raw);
    TERR = {};
    for (const t of arr) TERR[t.code] = t;
    // 初始化归属：默认 = startingOwner（neutral/无 → null）
    for (const t of arr) {
      const o = t.startingOwner;
      game.territories[t.code] = { owner: (!o || o === "neutral") ? null : o, embattled: false };
    }
    console.log(`[warroom] 载入地块 ${arr.length} 个`);
  } catch (e) {
    console.warn("[warroom] territories_full.json 载入失败:", e.message);
  }
}
loadTerritoriesData();

// 某国本回合收入 = 其拥有陆地地块资源之和（交战地块用交战面数值）
function computeIncome(nation) {
  const sum = { oil: 0, iron: 0, osr: 0 };
  for (const code in game.territories) {
    const st = game.territories[code];
    const t = TERR[code];
    if (!t || t.type !== "land") continue;      // 海洋不产出
    if (st.owner !== nation) continue;
    const src = st.embattled ? (t.embattledResources || t.resources) : t.resources;
    sum.oil += src.oil || 0; sum.iron += src.iron || 0; sum.osr += src.osr || 0;
  }
  return sum;
}

// 刷新所有国家收入（归属/交战变化后调用）
function refreshIncomes() {
  for (const id in game.nations) game.nations[id].income = computeIncome(id);
}

/* 阶段1「国民经济」结算：把收入加到各国储量（中国的石油限制在此生效）
 * 并在结算完成的瞬间，记录一份「阶段1 快照」，供下一轮对比地块变化。 */
function settleEconomy() {
  for (const id in game.nations) {
    const n = game.nations[id];
    const inc = computeIncome(id);
    const gainOil = (id === "china") ? 0 : inc.oil;
    n.resources.oil  += gainOil;
    n.resources.iron += inc.iron;
    n.resources.osr  += inc.osr;
    pushLog(`${id} 资源收入 石油+${gainOil} 钢铁+${inc.iron} 其他+${inc.osr}`);
  }
  // 记录阶段1 快照（归属 + 交战），供下轮计算地块变化
  game.phase1Snapshot = {};
  for (const code in game.territories) {
    game.phase1Snapshot[code] = {
      owner: game.territories[code].owner,
      embattled: game.territories[code].embattled,
    };
  }
  game.phase1SnapshotRound = game.round;
}

/* 计算「地块变化」：本回合阶段1 vs 上回合阶段1
 * 返回 4 类（仅保留会导致资源变化的项）：
 *   lost      上回合有其、本回合失去 → 负收入
 *   embattled 上回合未交战、本回合交战（仍在手）→ 负收入（差额）
 *   gained    上回合非其、本回合获得 → 正收入
 *   recovered 上回合交战、本回合脱离交战（仍在手）→ 正收入（差额）
 * 第一回合（无快照）返回空数组。
 */
function computeTerritoryChanges(nation) {
  const snap = game.phase1Snapshot;
  if (!snap) return [];                       // 第一回合：无变化
  const out = [];
  const yOf = (code, embattled) => {
    const t = TERR[code];
    if (!t || t.type !== "land") return { oil: 0, iron: 0, osr: 0 };
    const src = embattled ? (t.embattledResources || t.resources) : t.resources;
    return { oil: src.oil || 0, iron: src.iron || 0, osr: src.osr || 0 };
  };
  for (const code in game.territories) {
    const t = TERR[code];
    if (!t || t.type !== "land") continue;    // 只看陆地（海洋不产资源）
    const prev = snap[code];
    const cur = game.territories[code];
    if (!prev) continue;
    const wasMine = prev.owner === nation;
    const isMine = cur.owner === nation;

    // 1) 新失去的地块（上回合属于我，本回合不再属于我）
    if (wasMine && !isMine) {
      const y = yOf(code, prev.embattled);
      if (y.oil || y.iron || y.osr) out.push({ kind: "lost", code, delta: neg(y) });
      continue;
    }
    // 3) 新获得的地块（上回合不属于我，本回合属于我）
    if (!wasMine && isMine) {
      const y = yOf(code, cur.embattled);
      if (y.oil || y.iron || y.osr) out.push({ kind: "gained", code, delta: y });
      continue;
    }
    // 仍在手：比较交战状态
    if (wasMine && isMine) {
      // 2) 新翻面（交战）→ 收入减少
      if (!prev.embattled && cur.embattled) {
        const d = sub(yOf(code, true), yOf(code, false));  // 交战 - 常规（负）
        if (d.oil || d.iron || d.osr) out.push({ kind: "embattled", code, delta: d });
      }
      // 4) 脱离翻面 → 收入恢复
      else if (prev.embattled && !cur.embattled) {
        const d = sub(yOf(code, false), yOf(code, true));  // 常规 - 交战（正）
        if (d.oil || d.iron || d.osr) out.push({ kind: "recovered", code, delta: d });
      }
    }
  }
  // 按 4 类固定顺序排列：失去 → 交战 → 获得 → 脱离
  const order = { lost: 0, embattled: 1, gained: 2, recovered: 3 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || a.code.localeCompare(b.code));
  return out;
}

function neg(y) { return { oil: -y.oil, iron: -y.iron, osr: -y.osr }; }
function sub(a, b) { return { oil: a.oil - b.oil, iron: a.iron - b.iron, osr: a.osr - b.osr }; }

/* ---- 单位数据（服务端权威）：从 units.json 载入，供阶段2 指令格块显示部队信息 ---- */
let UNITS_DATA = [];
function loadUnitsData() {
  try {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, "units.json"), "utf8");
    UNITS_DATA = JSON.parse(raw);
    game.units = Object.fromEntries(UNITS_DATA.map((u) => [u.id, u]));
    console.log(`[warroom] 载入单位番号 ${UNITS_DATA.length} 个`);
  } catch (e) {
    console.warn("[warroom] units.json 载入失败:", e.message);
  }
}
loadUnitsData();

/* ---- 全部素材番号（服务端权威）：从 formations_all.json 载入，供"空余番号"查找 ---- */
let FORMATIONS_ALL = null;   // { nation: { air:[..], sea:[..], land:[..] } }
function loadFormationsAll() {
  try {
    FORMATIONS_ALL = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "formations_all.json"), "utf8"));
    console.log("[warroom] 载入素材番号表");
  } catch (e) {
    console.warn("[warroom] formations_all.json 载入失败:", e.message);
  }
}
loadFormationsAll();

/* ---- 阶段结果快照（回看用）----
 * 在每个阶段「结算并推进」的瞬间，记录该阶段的结果数据。
 *   phase1: 各国本回合新增资源 + 结算后储量 + 地块变化
 *   phase2: 各国竞价 + 指令
 * 存储：game.phaseHistory[round][phaseKey] = <data>
 */
function recordPhaseHistory(round, phaseKey) {
  if (!game.phaseHistory[round]) game.phaseHistory[round] = {};
  const out = { phase: phaseKey, round, at: Date.now() };
  if (phaseKey === "phase1_economy") {
    out.nations = {};
    for (const n of NATIONS) {
      const st = game.nations[n.id];
      out.nations[n.id] = {
        gain: computeIncome(n.id),               // 本回合新增（= 当前地块收入）
        settled: { ...st.resources },            // 结算后的储量
        changes: computeTerritoryChanges(n.id),  // 地块变化
      };
    }
    out.hasSnapshot = !!game.phase1Snapshot;
  } else if (phaseKey === "phase2_planning") {
    out.nations = {};
    for (const n of NATIONS) {
      const st = game.nations[n.id];
      out.nations[n.id] = { bid: st.bid, orders: JSON.parse(JSON.stringify(st.orders)) };
    }
  }
  game.phaseHistory[round][phaseKey] = out;
}

function snapshot() {
  return {
    type: "state",
    game: {
      scenario: game.scenario,
      round: game.round,
      phase: game.phase,
      phaseIndex: game.phaseIndex,
      status: game.status,
      nations: game.nations,
      units: game.units,
      territories: game.territories,
      // 地块变化：每国一组（仅陆地、仅导致资源变化者）
      changes: Object.fromEntries(NATIONS.map((n) => [n.id, computeTerritoryChanges(n.id)])),
      hasSnapshot: !!game.phase1Snapshot,
      // 阶段历史快照（回看用）
      phaseHistory: game.phaseHistory,
      // 阶段2 步骤2-3：回合顺位
      turnOrder: game.turnOrder,
      // 阶段3：移动结算状态机
      movePhase: game.movePhase,
      // 每国指令上限（中国/意大利 6，其余 9）
      orderLimit: Object.fromEntries(NATIONS.map((n) => [n.id, (n.id === "china" || n.id === "italy") ? 6 : 9])),
      log: game.log.slice(-50),
    },
    meta: { phases: PHASES, nations: NATIONS },
  };
}

function pushLog(text) {
  game.log.push({ t: Date.now(), text });
  if (game.log.length > 200) game.log.shift();
}

/* ============================================================
 * 三、连接管理 + 广播
 * ============================================================ */

const conns = new Set();

function broadcast(msg) {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of conns) c.send(data);
}

function broadcastState() {
  broadcast(snapshot());
}

/* ============================================================
 * 四、操作处理（无身份、无权限、无归属判断）
 *   操作格式: { action, nation, ...payload }
 * ============================================================ */

/* ---- 阶段2 步骤2-3：回合顺位 ---- */

// 进入"展示竞价并重排顺位"：快照竞价、按高→低排序（同分随机）
function startTurnOrder() {
  const to = game.turnOrder;
  to.active = true;
  to.done = false;
  to.paid = false;
  to.picks = Array(NATIONS.length).fill(null);
  to.currentIndex = 0;
  // 快照竞价
  to.bids = {};
  for (const n of NATIONS) to.bids[n.id] = game.nations[n.id].bid || 0;
  // 排序：竞价高→低；同分随机（盲抽）
  const arr = NATIONS.map((n) => n.id);
  // 先随机打乱，再稳定按竞价降序 → 同分保持随机序
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  arr.sort((a, b) => to.bids[b] - to.bids[a]);
  // 中国强制 0 出价
  to.queue = arr;
  pushLog(`回合顺位竞价开始：${to.queue.map((id) => `${id}(${to.bids[id]})`).join(" > ")}`);
}

// 当前该选位的国家
function currentPicker() {
  const to = game.turnOrder;
  if (!to.active || to.done) return null;
  return to.queue[to.currentIndex] || null;
}

// 某国选一个位次
function pickTurnSlot(nation, slot) {
  const to = game.turnOrder;
  if (!to.active || to.done) return;
  if (nation !== currentPicker()) return;                  // 不是轮到该国
  if (!Number.isInteger(slot) || slot < 0 || slot >= to.picks.length) return;
  if (to.picks[slot] !== null) return;                     // 该位已被占
  to.picks[slot] = nation;
  to.currentIndex += 1;
  if (to.currentIndex >= to.queue.length) {
    to.done = true;
    // 所有人选完 → 统一支付石油（步骤3）
    payTurnOrderBids();
  }
}

// 步骤3：所有国家支付其竞价石油
function payTurnOrderBids() {
  const to = game.turnOrder;
  if (to.paid) return;
  for (const id of Object.keys(to.bids)) {
    const n = game.nations[id];
    if (!n) continue;
    const b = to.bids[id] || 0;
    n.resources.oil = Math.max(0, (n.resources.oil || 0) - b);
  }
  to.paid = true;
  pushLog("回合顺位石油已统一支付");
}

/* ============================================================
 * 阶段3：移动操作（服务端全权结算）
 *   步骤1（自动）：把交战标记翻至热点区域面
 *   步骤2：按行动顺位 → 逐国 → 逐条（左→右、上→下）结算指令
 *     每条指令 → 其所属国（=当前顺位国）收到"执行/放弃"提示
 *     execute：部队真正移动到目的地（改 units.code，番号不变）
 *     abandon：该指令作废
 * ============================================================ */

// 步骤1 + 启动阶段3状态机
function startMovement() {
  const mp = game.movePhase;
  mp.active = true;
  mp.done = false;
  mp.natIndex = 0;
  mp.ordIndex = 0;
  mp.cur = null;
  mp.awaiting = false;
  mp.resolved = [];

  // ---- 步骤1（自动）：交战标记翻至热点区域面 ----
  //   本模型用 embattled 布尔表示；"翻至热点面"= 标记为热点（保留 embattled 状态，
  //   由阶段4战斗产生；这里只确保进入阶段3时标记就位）。
  let hotCount = 0;
  for (const code in game.territories) {
    if (game.territories[code].embattled) hotCount++;
  }
  pushLog(`阶段3 步骤1：交战标记翻至热点面（${hotCount} 个热点）`);

  // ---- 行动顺序：沿用本轮回合顺位（离开阶段2时存入 game.roundOrder）----
  let order = (game.roundOrder || []).slice();
  if (order.length === 0) {
    const picks = (game.turnOrder.picks || []).filter(Boolean);
    order = picks.length ? picks : NATIONS.map((n) => n.id);
  }
  mp.order = order;

  pushLog(`阶段3 行动顺序：${mp.order.map((id) => nationLabel(id)).join(" → ")}`);
  stepMovement();
}

function nationLabel(id) {
  const n = NATIONS.find((x) => x.id === id);
  return n ? n.name : id;
}

// 阵营：返回与 nation 同阵营的 nationId 集合（含自身）
function allianceOfServer(nation) {
  const a = (NATIONS.find((n) => n.id === nation) || {}).alliance;
  const s = new Set([nation]);
  for (const n of NATIONS) if (n.alliance === a) s.add(n.id);
  return s;
}

// 战区类型
function terrType(code) {
  const t = TERR[code];
  return t ? t.type : null;   // "land" | "sea" | "barrier"
}

// 某格内某阵营的兵力之和（部队指示物总数），可选排除一个番号
function forceInTerritory(code, allianceSet, excludeId) {
  let sum = 0;
  for (const id in game.units) {
    const u = game.units[id];
    if (u.code !== code) continue;
    if (excludeId && id === excludeId) continue;
    if (!allianceSet.has(u.nation)) continue;
    sum += u.unitCount || 0;
  }
  return sum;
}

// 某格内某阵营的海军兵力之和（部队指示物总数）
function navalForceInTerritory(code, allianceSet, excludeId) {
  let sum = 0;
  for (const id in game.units) {
    const u = game.units[id];
    if (u.code !== code || u.domain !== "sea") continue;
    if (excludeId && id === excludeId) continue;
    if (allianceSet.has(u.nation)) sum += u.unitCount || 0;
  }
  return sum;
}

/* 压制判定（pinning）：
 *   空军：不参与压制 → 永不压制
 *   陆军/海军（在陆地起始格）：敌方阵营兵力总和 ≥ 我方阵营兵力总和 → 压制
 *   海中的陆军（运兵船，起始格为海区）：敌方海军 > 己方海军（严格大于，与陆军无关）→ 压制
 *     特例：陆军上岸到「友军拥有」的区块 → 不压制
 *   注：要移动的这支部队【参与】计算（含自身）。
 *   兵力 = 部队指示物总数（unitCount 之和）。
 */
function computePinned(nation, u, dest) {
  if (!u) return false;
  if (u.domain === "air") return false;                 // 空军不参与压制
  const here = u.code;
  const myAlliance = allianceOfServer(nation);
  // 敌方阵营 = 另一阵营
  const enemyAlliance = new Set();
  for (const n of NATIONS) if (!myAlliance.has(n.id)) enemyAlliance.add(n.id);

  const hereType = terrType(here);

  if (u.domain === "land" && hereType === "sea") {
    // 运兵船（陆军在海上）
    // 特例：上岸到友军拥有的陆地 → 不压制
    if (dest && terrType(dest) === "land") {
      const owner = game.territories[dest] && game.territories[dest].owner;
      if (owner && myAlliance.has(owner)) return false;
    }
    const my = navalForceInTerritory(here, myAlliance, null);      // 含自身
    const en = navalForceInTerritory(here, enemyAlliance, null);
    return en > my;                                                 // 严大于
  }

  // 海军（在海上）或 陆军（在陆地）：敌我阵营兵力总和比较
  const my = forceInTerritory(here, myAlliance, null);
  const en = forceInTerritory(here, enemyAlliance, null);
  return en >= my;                                                  // ≥
}

/* 部分压制判定（partial pinning）：
 *   移动前 己方阵营兵力 > 敌方阵营兵力，但"本部队移出后"己方 < 敌方（等于不触发）。
 *   返回 { partial:bool, X:number }   X = 敌方兵力 - (己方兵力 - 移出部队兵力)
 *   注：仅 陆军/海军 可能触发；海中的陆军（运兵船）不可能触发；空军不参与。
 *       仅当非完全压制时评估。
 */
function computePartialPin(nation, u) {
  if (!u) return { partial: false, X: 0 };
  if (u.domain === "air") return { partial: false, X: 0 };
  const here = u.code;
  if (u.domain === "land" && terrType(here) === "sea") return { partial: false, X: 0 };  // 运兵船不触发
  const myAlliance = allianceOfServer(nation);
  const enemyAlliance = new Set();
  for (const n of NATIONS) if (!myAlliance.has(n.id)) enemyAlliance.add(n.id);
  const my = forceInTerritory(here, myAlliance, null);
  const en = forceInTerritory(here, enemyAlliance, null);
  const moved = u.unitCount || 0;
  const myAfter = my - moved;
  if (my > en && myAfter < en) {
    const X = en - myAfter;   // = en - (my - moved)
    return { partial: true, X };
  }
  return { partial: false, X: 0 };
}

/* 找一个"空余番号"：同国、同域（陆/空），未被任何现有 unit 使用，且未在本轮指令中使用。
 *   返回 { nation, domain, num, id, face } 或 null。 */
function findFreeFormation(nation, domain) {
  const FA = FORMATIONS_ALL && FORMATIONS_ALL[nation];
  if (!FA) return null;
  const allNums = FA[domain] || [];   // 该域全部素材番号
  const used = new Set();
  for (const id in game.units) { const u = game.units[id]; if (u.nation === nation && u.domain === domain) used.add(u.num); }
  // 也排除本轮指令中占用的番号
  const orders = (game.nations[nation] && game.nations[nation].orders) || [];
  for (const o of orders) {
    if (!o || !o.formationId) continue;
    const ou = game.units[o.formationId];
    if (ou && ou.domain === domain) used.add(ou.num);
  }
  const free = allNums.filter((n) => !used.has(n));
  if (!free.length) return null;
  const num = free[0];   // 任选一个
  return { nation, domain, num, id: `${nation}-${domain}-${num}` };
}

// 推进一步：找到下一条待结算指令；若该国有指令 → 设为当前（等待其确认）；否则自动跳过
function stepMovement() {
  const mp = game.movePhase;
  if (!mp.active) return;

  while (mp.natIndex < mp.order.length) {
    const nat = mp.order[mp.natIndex];
    const orders = (game.nations[nat] && game.nations[nat].orders) || [];
    // 找到该国 ordIndex 起的第一条非空指令
    while (mp.ordIndex < orders.length && !(orders[mp.ordIndex] && orders[mp.ordIndex].formationId)) {
      mp.ordIndex++;
    }
    if (mp.ordIndex < orders.length) {
      const o = orders[mp.ordIndex];
      // 该部队是否已被下过更早的指令（只执行第一个）→ 若是，自动放弃本条
      const dup = orders.slice(0, mp.ordIndex).some((p) => p && p.formationId === o.formationId);
      if (dup) {
        resolveMovement("cancel", true);   // 自动取消（不等待）
        continue;
      }
      // 设为当前，等待所属国点击
      const u = game.units[o.formationId];
      const pinned = computePinned(nat, u, o.dest || null);
      // 部分压制（仅在非完全压制时评估）
      let partial = false, partialX = 0, freeFormation = null;
      if (!pinned && u) {
        const pp = computePartialPin(nat, u);
        if (pp.partial) {
          partial = true;
          partialX = pp.X;
          freeFormation = findFreeFormation(nat, u.domain);   // 可能为 null
        }
      }
      mp.cur = {
        nation: nat, orderIndex: mp.ordIndex, formationId: o.formationId, dest: o.dest || null,
        pinned, partial, partialX,
        freeFormation,                 // { nation, domain, num, id } 或 null
        split: null,                   // 拆分结果（确认后填）
      };
      mp.awaiting = true;
      return;
    }
    // 该国指令结算完 → 下一国
    mp.natIndex++;
    mp.ordIndex = 0;
  }
  // 全部国结算完
  mp.done = true;
  mp.active = false;
  mp.cur = null;
  mp.awaiting = false;
  pushLog("阶段3 移动结算完毕");
}

// 结算当前指令：result = "execute" | "cancel"
//   auto=true 表示服务端自动决定（不等待玩家）
function resolveMovement(result, auto) {
  const mp = game.movePhase;
  const cur = mp.cur;
  if (!cur) return;
  const orders = (game.nations[cur.nation] && game.nations[cur.nation].orders) || [];

  if (result === "execute" && cur.dest && !cur.pinned) {
    // 执行：部队移动到目的地（番号不变，只改位置 code）
    const u = game.units[cur.formationId];
    if (u) {
      const fromCode = u.code;
      u.code = cur.dest;
      // 若该指令执行后部队在海上（陆军 → 运兵船），domain 仍为 land（番号不变）
      pushLog(`${nationLabel(cur.nation)} 执行：${cur.formationId} ${fromCode} → ${cur.dest}`);
      mp.resolved.push({ nation: cur.nation, orderIndex: cur.orderIndex, result: "done", from: fromCode, to: cur.dest, formationId: cur.formationId });
    } else {
      // 番号不存在 → 视为取消
      mp.resolved.push({ nation: cur.nation, orderIndex: cur.orderIndex, result: "cancel", formationId: cur.formationId, dest: cur.dest });
    }
  } else {
    // 放弃/取消
    pushLog(`${nationLabel(cur.nation)} 放弃指令 #${cur.orderIndex + 1}`);
    mp.resolved.push({ nation: cur.nation, orderIndex: cur.orderIndex, result: "cancel", formationId: cur.formationId, dest: cur.dest });
  }

  // 清空该指令格（或标记已结算）→ 这里保留 orders 原样，结算记录在 resolved 中
  mp.ordIndex++;
  mp.cur = null;
  mp.awaiting = false;
  if (!auto) stepMovement();
}

/* 部分压制拆分：从当前部队移出 keep（{type:count}）到新"空余番号"，留在原地。
 *   其余兵种随原部队继续移动。
 */
function applyPartialSplit(cur, keep) {
  const src = game.units[cur.formationId];
  const free = cur.freeFormation;
  if (!src || !free) return;
  const units = { ...(src.units || {}) };
  const kept = {};
  for (const [type, cnt] of Object.entries(keep)) {
    const take = Math.min(units[type] || 0, cnt || 0);
    if (take > 0) { kept[type] = take; units[type] -= take; }
  }
  // 原部队剩下（可能为空 → 若全拆走则原部队消失）
  const remainCount = Object.values(units).reduce((a, b) => a + b, 0);
  // 新部队（留原地）
  const newUnit = {
    id: free.id, nation: free.nation, alliance: src.alliance, domain: src.domain,
    num: free.num, code: src.code,   // 留在原地
    face: `${NATION_ASSET_NAME(free.nation)}_${domainTitle(src.domain)}_${free.num}.png`,
    units: kept,
    unitCount: Object.values(kept).reduce((a, b) => a + b, 0),
  };
  game.units[free.id] = newUnit;
  // 原部队：更新剩余兵种
  if (remainCount > 0) {
    src.units = units; src.unitCount = remainCount;
  } else {
    delete game.units[cur.formationId];   // 全部拆走 → 原番号消失
  }
  cur.split = { newId: free.id, keep: kept };
  pushLog(`${nationLabel(cur.nation)} 部分压制拆分：${free.id} 留守，${Object.entries(kept).map(([k,v])=>k+v).join("+")}`);
}

// 素材名映射
function NATION_ASSET_NAME(nation) {
  const m = { britain: "Britain", germany: "Germany", japan: "Japan", usa: "USA", soviet: "Soviet", italy: "Italy", china: "China" };
  return m[nation] || nation;
}
function domainTitle(domain) {
  return domain === "air" ? "Air" : domain === "sea" ? "Sea" : "Land";
}


/* ---- 阶段推进：从当前阶段推到下一阶段；跨轮时重置确认 ---- */
function advancePhase() {
  const i = PHASES.indexOf(game.phase);
  const ni = (i + 1) % PHASES.length;
  game.phaseIndex = ni;
  game.phase = PHASES[ni];
  if (ni === 0) game.round += 1;          // 回到阶段1 → 新的一轮
  // 新阶段：清除所有国家的确认状态
  for (const id in game.nations) game.nations[id].confirmed = false;
  // 离开阶段2 → 保存本轮行动顺位到 game.roundOrder，再复位 turnOrder
  if (PHASES[i] === "phase2_planning") {
    const picks = (game.turnOrder.picks || []).filter(Boolean);
    if (picks.length) game.roundOrder = picks;      // 供阶段3 使用
    game.turnOrder = {
      active: false, bids: {}, queue: [], currentIndex: 0,
      picks: Array(NATIONS.length).fill(null), done: false, paid: false,
    };
  }
  // 进入阶段3 → 自动启动移动结算状态机（含步骤1）
  if (game.phase === "phase3_movement") {
    startMovement();
  }
  // 离开阶段3 → 复位（保留本阶段结果可另存历史）
  if (PHASES[i] === "phase3_movement") {
    game.movePhase = {
      active: false, order: [], natIndex: 0, ordIndex: 0,
      cur: null, awaiting: false, resolved: [], done: false,
    };
  }
  pushLog(`推进 → ${game.phase}（第 ${game.round} 轮）`);
}

/* 所有国家是否都已确认 */
function allConfirmed() {
  for (const id in game.nations) {
    if (!game.nations[id].confirmed) return false;
  }
  return true;
}

/* 若全体确认：记录本阶段结果快照 → 结算 → 推进。返回是否发生了推进 */
function maybeAdvanceOnAllConfirmed() {
  if (!allConfirmed()) return false;
  const curPhase = game.phase, curRound = game.round;
  // 阶段1：结算国民经济（资源入账）
  if (curPhase === "phase1_economy") {
    settleEconomy();
  }
  // 记录本阶段结果快照（在推进前，用结算后的状态）
  recordPhaseHistory(curRound, curPhase);
  advancePhase();
  return true;
}

function handleMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.action) {
    // 拉取当前全局状态（新连接/需要同步时）
    case "sync":
      refreshIncomes();
      conn.send(snapshot());
      break;

    // 某国点击「确认」
    case "confirm": {
      const n = game.nations[msg.nation];
      if (n && !n.confirmed) {
        n.confirmed = true;
        pushLog(`${msg.nation} 已确认（${game.phase}）`);
        maybeAdvanceOnAllConfirmed();
        broadcastState();
      }
      break;
    }

    // 某国取消「确认」
    case "unconfirm": {
      const n = game.nations[msg.nation];
      if (n && n.confirmed) {
        n.confirmed = false;
        pushLog(`${msg.nation} 取消确认`);
        broadcastState();
      }
      break;
    }

    // 强制推进：等价于所有国家同时确认并按阶段结算，然后推进
    case "force_confirm": {
      for (const id in game.nations) game.nations[id].confirmed = true;
      pushLog("强制推进：全体视为已确认");
      maybeAdvanceOnAllConfirmed();
      broadcastState();
      break;
    }

    // 切换阶段（调试用：直接跳阶段，不做结算）
    case "next_phase": {
      advancePhase();
      broadcastState();
      break;
    }

    // 阶段2：设置某国石油竞价（0 ≤ bid ≤ 当前油数）
    case "set_bid": {
      const n = game.nations[msg.nation];
      if (n) {
        const max = n.resources.oil || 0;
        let v = Math.round(Number(msg.value) || 0);
        v = Math.max(0, Math.min(max, v));
        n.bid = v;
        broadcastState();
      }
      break;
    }

    // 阶段2 步骤2：进入"展示竞价并重排回合顺位"
    case "start_turn_order": {
      startTurnOrder();
      broadcastState();
      break;
    }

    // 调试：移动某番号到指定地块（仅用于测试构造场景）
    case "debug_move_unit": {
      const u = game.units[msg.unitId];
      if (u && msg.code) { u.code = msg.code; broadcastState(); }
      break;
    }

    // 阶段2 步骤2：当前国家选择一个位次（slot 0..6）
    case "pick_slot": {
      pickTurnSlot(msg.nation, Number(msg.slot));
      broadcastState();
      break;
    }

    // 阶段2 步骤3：统一支付石油（也可在选完后自动调用）
    case "pay_bids": {
      payTurnOrderBids();
      broadcastState();
      break;
    }

    // 阶段3：结算当前移动指令（由当前指令所属国点击：execute/cancel）
    case "resolve_order": {
      const mp = game.movePhase;
      if (mp.active && mp.awaiting && mp.cur && msg.nation === mp.cur.nation) {
        resolveMovement(msg.result === "execute" ? "execute" : "cancel", false);
        broadcastState();
      }
      break;
    }

    // 阶段3：部分压制拆分确认（把 X 个指示物拆到新番号留原地，其余继续移动）
    case "resolve_split": {
      const mp = game.movePhase;
      const cur = mp.cur;
      if (mp.active && mp.awaiting && cur && cur.partial && msg.nation === cur.nation) {
        applyPartialSplit(cur, msg.keep || {});
        resolveMovement("execute", false);   // 拆分后继续执行移动
        broadcastState();
      }
      break;
    }

    // 阶段2：设置某国的某个指令格 { index, order|null }
    //   order = { formationId, dest }  ；order=null 表示清空
    case "set_order": {
      const n = game.nations[msg.nation];
      if (n && Array.isArray(n.orders)) {
        const idx = Number(msg.index);
        const limit = (msg.nation === "china" || msg.nation === "italy") ? 6 : 9;
        if (Number.isInteger(idx) && idx >= 0 && idx < limit) {
          n.orders[idx] = msg.order ? {
            formationId: msg.order.formationId || null,
            dest: msg.order.dest || null,
          } : null;
          broadcastState();
        }
      }
      break;
    }

    // 阶段2：拖拽重排指令 —— 把 from 处的指令插入到 to 处，其后顺序后延
    //   顺序即数组下标（左上→右下递增）；空位(null)不参与移动。
    case "move_order": {
      const n = game.nations[msg.nation];
      if (n && Array.isArray(n.orders)) {
        const from = Number(msg.from), to = Number(msg.to);
        const limit = (msg.nation === "china" || msg.nation === "italy") ? 6 : 9;
        if (Number.isInteger(from) && Number.isInteger(to) &&
            from >= 0 && from < limit && to >= 0 && to < limit &&
            n.orders[from]) {
          const [moved] = n.orders.splice(from, 1);
          n.orders.splice(to, 0, moved);     // 插入 to 处，其后自动后延
          // 数组长度可能因插入超出 limit → 截断（尾部的 null 会被丢掉）
          n.orders.length = Math.min(n.orders.length, limit);
          // 补足到 limit 个 null
          while (n.orders.length < limit) n.orders.push(null);
          broadcastState();
        }
      }
      break;
    }

    // 引擎钩子：设置地块归属（供阶段4 夺取领土）
    case "set_owner": {
      if (msg.code && game.territories[msg.code]) {
        game.territories[msg.code].owner = msg.nation || null;
        refreshIncomes();
        broadcastState();
      }
      break;
    }

    // 引擎钩子：设置地块交战状态
    case "set_embattled": {
      if (msg.code && game.territories[msg.code]) {
        game.territories[msg.code].embattled = !!msg.on;
        refreshIncomes();
        broadcastState();
      }
      break;
    }

    // 通用状态补丁（占位：直接合并进全局状态并广播）
    case "patch": {
      if (msg.patch && typeof msg.patch === "object") {
        Object.assign(game, msg.patch);
        pushLog(`状态更新（来自 ${msg.nation || "未知视角"}）`);
        broadcastState();
      }
      break;
    }

    default:
      // 未知操作：不回执、不处理（保持"无感"）
      break;
  }
}

/* ============================================================
 * 五、HTTP：静态文件 + 图片素材
 * ============================================================ */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const alt = path.join(PUBLIC_DIR, "assets", path.basename(safe));
      return fs.stat(alt, (e2, s2) => {
        if (e2 || !s2.isFile()) { res.writeHead(404); return res.end("not found"); }
        streamFile(res, alt);
      });
    }
    streamFile(res, filePath);
  });
}

function streamFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
}

/* ============================================================
 * 六、启动
 * ============================================================ */

const server = http.createServer(serveStatic);

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/ws")) { socket.destroy(); return; }
  const conn = upgradeToWebSocket(req, socket, head, {
    onMessage: (c, raw) => handleMessage(c, raw),
    onClose: (c) => conns.delete(c),
  });
  if (!conn) return;
  conns.add(conn);
  // 一连上就推送全局状态（无需任何身份/握手信息）
  conn.send(snapshot());
});

server.listen(PORT, () => {
  console.log(`[warroom] 全局单局服务已启动  http://localhost:${PORT}`);
  console.log(`[warroom] 静态根目录: ${PUBLIC_DIR}`);
});
