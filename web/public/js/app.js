/* War Room — 前端主逻辑
 *  - 世界地图渲染（Canvas）
 *  - 两侧国家图标列（左上轴心阵营视角 / 右上盟军阵营视角）
 *  - WebSocket 连接：接收全局状态广播
 * 无身份、无房间、无昵称。
 */
"use strict";

/* ---------- 国家定义（与后端一致） ---------- */
const NATIONS = [
  { id: "germany", name: "德意志", flag: "Germany_Flag.jpg", alliance: "axis",   capital: "G1" },
  { id: "italy",   name: "意大利", flag: "Italy_Flag.jpg",   alliance: "axis",   capital: "T1" },
  { id: "japan",   name: "日本",   flag: "Japan_Flag.jpg",   alliance: "axis",   capital: "J1" },
  { id: "britain", name: "英联邦", flag: "Britain_Flag.jpg", alliance: "allies", capital: "B1" },
  { id: "soviet",  name: "苏联",   flag: "Soviet_Flag.jpg",  alliance: "allies", capital: "R1" },
  { id: "usa",     name: "美国",   flag: "USA_Flag.jpg",     alliance: "allies", capital: "U1" },
  { id: "china",   name: "中国",   flag: "China_Flag.jpg",   alliance: "allies", capital: "J4" },
];
const AXIS = NATIONS.filter((n) => n.alliance === "axis");
const ALLIES = NATIONS.filter((n) => n.alliance === "allies");
// 国家 id → 中文名
function nationName(id) {
  const n = NATIONS.find((x) => x.id === id);
  return n ? n.name : id;
}

/* 当前视角（纯客户端概念）。null = 未选。 */
let currentNation = null;

/* ============================================================
 * 资源经济学（阶段1 国民经济）
 *   规则（规则书 p.8「步骤2 获得资源收入」）：
 *     · 每回合收入 = 该国「拥有的所有领土卡牌」上的每种资源之和；
 *     · 领土卡牌有正面（常规）与交战面（带红白条纹，资源较少）两面；
 *       处于交战状态的领土产出较少的资源。
 *   数据来源：territories_full.json 的 resources / embattledResources。
 *   「拥有」= ownerOf(code)（默认取 startingOwner，可被引擎更新）。
 *   海洋区域不产出资源，也不可被「控制」（规则书 p.8）。
 * ============================================================ */
const RES_KINDS = ["oil", "iron", "osr"];   // 石油 / 钢铁 / 其他

// 某地块在其当前（交战/常规）状态下对拥有者的资源产出
function territoryYield(t, embattled) {
  const src = embattled ? (t.embattledResources || t.resources) : t.resources;
  return { oil: src.oil || 0, iron: src.iron || 0, osr: src.osr || 0 };
}

// 某国本回合的资源收入（= 其拥有地块资源之和；交战地块用交战面数值）
function incomeOf(nation) {
  initTerritoryOwners();
  const sum = { oil: 0, iron: 0, osr: 0 };
  for (const t of (TERRITORIES || [])) {
    if (t.type !== "land") continue;            // 海洋不产出资源
    if (ownerOf(t.code) !== nation) continue;   // 非本国所有
    const y = territoryYield(t, flippedCards.has(t.code));
    sum.oil += y.oil; sum.iron += y.iron; sum.osr += y.osr;
  }
  return sum;
}

// 刷新所有国家的收入字段（NATION_INFO[*].oilInc/...）为地块派生的真实值
function refreshAllIncomes() {
  for (const n of NATIONS) {
    const inc = incomeOf(n.id);
    const d = NATION_INFO[n.id];
    if (!d) continue;
    d.oilInc = inc.oil; d.ironInc = inc.iron; d.osrInc = inc.osr;
  }
}

/* 阶段1·步骤2：获得资源收入 —— 把 incomeOf 加到该国的当前资源上 */
function applyIncome(nation) {
  const d = NATION_INFO[nation];
  if (!d) return null;
  const inc = incomeOf(nation);
  // 中国的限制：不能获得石油（规则书 p.8）
  const gainOil = (nation === "china") ? 0 : inc.oil;
  d.oil += gainOil; d.iron += inc.iron; d.osr += inc.osr;
  refreshAllIncomes();
  return { oil: gainOil, iron: inc.iron, osr: inc.osr };
}

/* 对战各国收入信息（资源/收入）数据（占位；后续由服务端 game state 提供）
 *  oil/iron/osr: 当前值（初始库存；此处暂用 0，正式剧本应填入初设库存）
 *  oilInc/ironInc/osrInc: 回合收入（+X）—— 由 territories 动态派生，勿手填
 *  stress: 当前压力值; stressMax: 压力阈值（= bundle 的 stressThreshold）
 */
const NATION_INFO = {
  // stressMax = 压力阈值（来源：bundle 的 stressThreshold）
  // oilInc/ironInc/osrInc 会在启动时由 refreshAllIncomes() 用地块数据覆写
  // color = 国家色（来源：bundle 的 NATIONS 数组）
  germany: { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 6, color: "#808080" },
  italy:   { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 4, color: "#6B8E23" },
  japan:   { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 6, color: "#CC3300" },
  britain: { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 4, color: "#4169E1" },
  soviet:  { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 5, color: "#CC0000" },
  usa:     { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 4, color: "#228B22" },
  china:   { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 4, color: "#FFD700" },
};
const NATION_COLOR = Object.fromEntries(Object.entries(NATION_INFO).map(([k, v]) => [k, v.color]));

/* ============================================================
 * 一、左侧阵营栏
 *   三段（从上到下）：
 *     [自己]  永远置顶（旗帜固定左上角）+ 可单独收起的资源条
 *     [同阵营其他国家]（亮）   资源条随"向上收起"统一开闭
 *     [敌对阵营]（暗）         资源条随"向上收起"统一开闭
 *   段与段之间留间隔。
 * ============================================================ */
let globalCollapsed = false;   // "向上收起"状态：收起除自己外的所有国家
let selfInfoOpen = true;       // 自己资源条的单独开合状态
let turnOrderAutoCollapsed = false;   // 顺位阶段是否已自动收起资源列表

// 自动收起/恢复左上资源列表（顺位步骤用）
function autoCollapseNationRail(collapse) {
  if (collapse) {
    selfInfoOpen = false;
    globalCollapsed = true;
  } else {
    selfInfoOpen = true;
    globalCollapsed = false;
  }
  const btn = document.getElementById("collapse-all");
  if (btn) { btn.textContent = globalCollapsed ? "▼" : "▲"; }
  renderPanel();
}

// 构建一整行：旗帜 + 资源条（+ 自己的单独收起按钮）
function buildRow(n, isSelf) {
  const row = document.createElement("div");
  row.className = "nation-row";
  row.dataset.nation = n.id;

  // 旗帜
  const icon = document.createElement("div");
  icon.className = `nation-icon ${n.alliance}`;
  icon.dataset.nation = n.id;
  icon.title = n.name;
  const img = document.createElement("img");
  img.src = `/assets/${n.flag}`;
  img.alt = n.name;
  icon.appendChild(img);
  icon.addEventListener("click", () => selectNation(n.id));

  // 资源条
  const info = document.createElement("div");
  info.className = "info-bar";
  info.appendChild(buildInfo(n.id));

  row.appendChild(icon);
  row.appendChild(info);

  if (isSelf) {
    icon.classList.add("active");
    // 自己的资源条：默认展开 + 独立收起按钮
    row.classList.add("self");
    if (selfInfoOpen) row.classList.add("show-info");
    else row.classList.add("self-collapsed");
    const tg = document.createElement("button");
    tg.className = "self-toggle";
    tg.title = "收起/展开资源条";
    tg.textContent = "◀";
    tg.addEventListener("click", (e) => {
      e.stopPropagation();
      selfInfoOpen = !selfInfoOpen;
      row.classList.toggle("show-info", selfInfoOpen);
      row.classList.toggle("self-collapsed", !selfInfoOpen);
    });
    row.appendChild(tg);
  } else {
    // 其他国家的资源条：随"向上收起"统一开闭
    if (!globalCollapsed) row.classList.add("show-info");
  }
  return row;
}

// 全量重绘三段
function renderPanel() {
  const self = NATIONS.find((n) => n.id === currentNation);
  const selfEl = document.getElementById("panel-self");
  const allyEl = document.getElementById("panel-ally");
  const enemyEl = document.getElementById("panel-enemy");
  selfEl.innerHTML = "";
  allyEl.innerHTML = "";
  enemyEl.innerHTML = "";

  // 未选国家：只显示一个国家列表（其实默认应有自己，这里兜底全部亮）
  if (!self) {
    if (globalCollapsed) return;
    for (const n of NATIONS) allyEl.appendChild(buildRow(n, false));
    return;
  }

  // 1) 自己（永远显示）
  selfEl.appendChild(buildRow(self, true));

  // 2) 同阵营其他国家（亮）
  const allies = NATIONS.filter((n) => n.alliance === self.alliance && n.id !== self.id);
  // 3) 敌对阵营（暗）
  const enemies = NATIONS.filter((n) => n.alliance !== self.alliance);

  if (!globalCollapsed) {
    for (const n of allies) allyEl.appendChild(buildRow(n, false));
    for (const n of enemies) {
      const r = buildRow(n, false);
      r.querySelector(".nation-icon").classList.add("dim");
      enemyEl.appendChild(r);
    }
  }
}

// 构建某国的资源/压力信息（单行紧凑：色点 + 数值）
function buildInfo(id) {
  const frag = document.createDocumentFragment();
  const d = NATION_INFO[id] || { oil: 0, iron: 0, osr: 0, oilInc: 0, ironInc: 0, osrInc: 0, stress: 0, stressMax: 5 };

  // 资源三项：色点 + 当前值 /收入（收入暗绿）
  const res = [
    ["oil",  d.oil,  d.oilInc],
    ["iron", d.iron, d.ironInc],
    ["osr",  d.osr,  d.osrInc],
  ];
  for (const [kind, val, inc] of res) {
    const span = document.createElement("span");
    span.className = "res-item";
    const dot = document.createElement("span");
    dot.className = `dot ${kind}`;
    span.appendChild(dot);
    span.appendChild(document.createTextNode(`${val}/`));
    const incSpan = document.createElement("span");
    incSpan.className = "inc";
    incSpan.textContent = inc;
    span.appendChild(incSpan);
    frag.appendChild(span);
  }

  // 压力：灰点 + 当前值 /阈值（阈值暗红）
  const st = document.createElement("span");
  st.className = "stress-item";
  const sdot = document.createElement("span");
  sdot.className = "dot stress";
  st.appendChild(sdot);
  st.appendChild(document.createTextNode(`${d.stress}/`));
  const maxSpan = document.createElement("span");
  maxSpan.className = "max";
  maxSpan.textContent = d.stressMax;
  st.appendChild(maxSpan);
  frag.appendChild(st);

  return frag;
}

function selectNation(id) {
  const n = NATIONS.find((x) => x.id === id);
  if (!n) return;

  // 单击「已经是自己」的国家 → 关注其首都
  if (currentNation === id) {
    focusCapital(n);
    return;
  }

  currentNation = id;
  renderPanel();
  renderUnitPanel();   // 视角国家变了，刷新部队栏目
  // 视角国家变了，刷新行动页（进度条/确认按钮/资源内容）与国家确认高亮
  if (SERVER_STATE) {
    renderConfirmButton(SERVER_STATE);
    renderActionContent(SERVER_STATE);
    renderNationConfirmHighlights(SERVER_STATE);
  }
}

// 关注某国首都
function focusCapital(nation) {
  const code = nation.capital;
  const p = positions && positions[code];
  if (!p) { console.warn("[focusCapital] 无坐标:", code); return; }
  setTerritoryFocus(code);
}

function initNationColumns() {
  // 默认视角：德意志（后续可由服务端/用户决定）
  if (!currentNation) currentNation = "germany";

  // "向上收起"按钮：切换 收起/展开 除自己外的所有国家
  const btn = document.getElementById("collapse-all");
  btn.addEventListener("click", () => {
    globalCollapsed = !globalCollapsed;
    btn.textContent = globalCollapsed ? "▼" : "▲";
    btn.title = globalCollapsed ? "展开其他国家" : "收起其他国家";
    renderPanel();
  });

  renderPanel();
}

/* ============================================================
 * 二、世界地图渲染
 * ============================================================ */
const canvas = document.getElementById("map-canvas");
const ctx = canvas.getContext("2d");
const mapImg = new Image();
let mapReady = false;
let positions = {};   // 归一化坐标表

// ---- 视图变换：地图内容在其上缩放/平移（画布=全视口） ----
// 地图逻辑边长固定（与视口无关），保证 PC/手机 上图与番号的比例一致
const MAP_SIDE = 2048;
const view = {
  scale: 1,        // 缩放倍数
  minScale: 0.1,   // 最小缩放（实际会在 resize 时按"适应视口"重设）
  maxScale: 8,     // 最大倍数
  x: 0,            // 平移（CSS 像素，旋转前的坐标系）
  y: 0,
  rotation: 0,     // 旋转角（弧度），绕屏幕中心
};
let cssW = 0;      // 视口宽（画布尺寸）
let cssH = 0;      // 视口高
const mapSide = MAP_SIDE;   // 地图逻辑边长（固定，正方形）
let fitScale = 1;           // "适应视口"的基准缩放（视口短边铺满）
let previousMapWidth = null;
let focusScaleAbs = 3.2;    // focus 的绝对缩放（= 基准 × 倍数）
let initialized = false;    // 是否已完成首次布局
window.__view = view; // 调试/测试用

/* ---- 统一坐标变换：地图逻辑点(m) -> 屏幕点(s) ----
 *   s = R(screenCenter, rot) · ( m*scale + (view.x, view.y) )
 * 逆变换：m = R^-1(screenCenter, rot) · s - (view.x, view.y) 后再 /scale
 */
function worldToScreen(mx, my) {
  const sx = mx * view.scale + view.x;
  const sy = my * view.scale + view.y;
  const cx = cssW / 2, cy = cssH / 2;
  const cos = Math.cos(view.rotation), sin = Math.sin(view.rotation);
  const dx = sx - cx, dy = sy - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
function screenToWorld(sx, sy) {
  const cx = cssW / 2, cy = cssH / 2;
  const cos = Math.cos(-view.rotation), sin = Math.sin(-view.rotation);
  const dx = sx - cx, dy = sy - cy;
  const rx = cx + dx * cos - dy * sin;
  const ry = cy + dx * sin + dy * cos;
  return { x: (rx - view.x) / view.scale, y: (ry - view.y) / view.scale };
}

// ---- 关注（focus）：把视角移到目标居中，并缩放到统一值 ----
// focus 的缩放由 resizeCanvas 计算为 focusScaleAbs（= fitScale × 3.2）

// 换算：归一化地图坐标(0..1) -> 地图逻辑像素
function normToCanvas(nx, ny) { return { x: nx * mapSide, y: ny * mapSide }; }
// 关注一个目标：目标落在【水平 40% / 垂直 50%】处（右侧留行动界面，使目标处于视觉重心）
// 注：目标点始终以"未旋转"的锚点定位，旋转时围绕屏幕中心转。
const FOCUS_ANCHOR_X = 0.40;
const FOCUS_ANCHOR_Y = 0.50;

// 计算"关注"某归一化坐标 (nx,ny) 时的目标视图参数（不直接应用）
function focusTarget(nx, ny) {
  const p = normToCanvas(nx, ny);
  const scale = focusScaleAbs;   // 绝对缩放（已按 fitScale 换算）
  const cx = cssW / 2, cy = cssH / 2;
  const ax = cssW * FOCUS_ANCHOR_X, ay = cssH * FOCUS_ANCHOR_Y;
  const cos = Math.cos(-view.rotation), sin = Math.sin(-view.rotation);
  const dx = ax - cx, dy = ay - cy;
  const targetX = cx + dx * cos - dy * sin;
  const targetY = cy + dx * sin + dy * cos;
  return {
    scale,
    x: targetX - p.x * scale,
    y: targetY - p.y * scale,
  };
}

// ---- 阶段3：把「番号 ↔ 目标地块」两点放入左 70% 画面的外 20% 内，缩放 ≤ 4.5 ----
//   leftW = 行动面板外的可视图（宽度的 70%）；两点中心须落在该区域的外 20% 内。
//   返回 { scale, x, y }（未旋转近似；旋转为 0 时精确）。
const LEFT_VIEW_FRAC = 0.70;    // 行动面板外可见宽度占比
const MOVE_MAX_SCALE = 4.5;     // 缩放上限
function moveEffectTarget(unitPos, destPos) {
  // 两点在"地图逻辑像素"坐标
  const ax = unitPos.x, ay = unitPos.y;
  const bx = destPos.x, by = destPos.y;
  const leftW = cssW * LEFT_VIEW_FRAC;
  const outerX = leftW * 0.20;    // 外 20% 左内缩
  const outerY = cssH * 0.20;     // 上下内缩（用高度 20%）
  // 需要容纳的范围：两点的包围盒 + 两侧外 20% 边距
  const minX = Math.min(ax, bx) - outerX;
  const maxX = Math.max(ax, bx) + outerX;
  const minY = Math.min(ay, by) - outerY;
  const maxY = Math.max(ay, by) + outerY;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  // 缩放到能容纳包围盒（相对左 70% 宽 / 全高）
  let scale = Math.min(leftW / spanX, cssH / spanY);
  // 上限 & 下限（下限= fitScale，避免过小）
  scale = Math.min(scale, MOVE_MAX_SCALE, fitScale * MOVE_MAX_SCALE);
  scale = Math.max(scale, fitScale);
  // 两点中心对准左 70% 区域的中心
  const cwx = (ax + bx) / 2, cwy = (ay + by) / 2;
  const anchorX = leftW / 2, anchorY = cssH / 2;
  return { scale, x: anchorX - cwx * scale, y: anchorY - cwy * scale };
}

let focusAnim = null;   // { from:{x,y,scale}, to:{...}, t0, dur }
// 缓动：ease-in-out cubic
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function tickFocusAnim(now) {
  if (!focusAnim) return;
  const { from, to, t0, dur } = focusAnim;
  let t = (now - t0) / dur;
  if (t >= 1) t = 1;
  const k = easeInOutCubic(t);
  view.scale = from.scale + (to.scale - from.scale) * k;
  view.x = from.x + (to.x - from.x) * k;
  view.y = from.y + (to.y - from.y) * k;
  drawMap();
  if (t < 1) {
    requestAnimationFrame(tickFocusAnim);
  } else {
    focusAnim = null;
    // 精确落到目标值
    view.scale = to.scale; view.x = to.x; view.y = to.y;
    drawMap();
  }
}

// 关注（带动画切换）
const FOCUS_ANIM_MS = 600;
function cancelFocusAnim() { focusAnim = null; }
function focus(nx, ny, animate = true) {
  const target = focusTarget(nx, ny);
  if (!animate) {
    cancelFocusAnim();
    view.scale = target.scale; view.x = target.x; view.y = target.y;
    clampView(); drawMap();
    return;
  }
  focusAnim = {
    from: { x: view.x, y: view.y, scale: view.scale },
    to: target,
    t0: performance.now(),
    dur: FOCUS_ANIM_MS,
  };
  requestAnimationFrame(tickFocusAnim);
}
window.__focus = focus; // 供测试/后续调用

/* ============================================================
 * 关注高亮 + 可达地区标点
 *   · 关注地区 → 高亮该地块 + 唤起所有「相邻地区」标点
 *   · 关注部队 → 描框该番号 + 唤起其「一回合可达地区」标点
 *       陆军：1 跳相邻（铁路任意距离暂不实现）
 *       空军/海军：1~2 跳同域相邻（BFS）
 * ============================================================ */
let focusHighlight = null;   // { kind:"territory"|"unit", code, unitId, reach:Set<code> }

// 地块表（code -> record，含 adjacentTo / type / airOnly）
function territoryMap() {
  if (!TERRITORIES) return {};
  if (!territoryMap._c) {
    territoryMap._c = {};
    for (const t of TERRITORIES) territoryMap._c[t.code] = t;
  }
  return territoryMap._c;
}
function isLandPassable(code) {
  const t = territoryMap()[code];
  return !!t && t.type === "land" && !t.airOnly;
}

// 某兵种从 code 出发、一回合可达的地区集合（不含自身）。
// 返回 { reach:Set<code>, via:[{from,to,kind}] }，kind ∈ "channel"|"rail"（用于虚线连线）。
function reachableFrom(code, domain, nation) {
  const authoritativeUnit = UNITS.find(u => u.code === code && u.domain === domain && u.nation === nation);
  if (SERVER_STATE?.legalMoves && authoritativeUnit && SERVER_STATE.legalMoves[authoritativeUnit.id]) return { reach: new Set(SERVER_STATE.legalMoves[authoritativeUnit.id].filter(c => c !== code)), via: [] };
  const map = territoryMap();
  const start = map[code];
  const out = new Set();
  const via = [];
  if (!start || !start.adjacentTo) return { reach: out, via };

  // 通道/铁路"必经连线"记录（仅当该边被通道管辖时；铁路任意距离尚未实现，
  // 且铁路边本就⊂相邻边，故 1 跳陆地不画铁路虚线，待铁路长途可达时再启用）
  const recordVia = (from, to) => {
    const ch = channelBySeaPair && channelBySeaPair[seaPairKey(from, to)];
    if (ch) via.push({ from, to, kind: "channel", id: ch.id });
  };

  // 海上邻接（考虑通道封锁）
  const seaNbrs = (c) => navalNeighbors(c, nation);
  const landNbrs = (c) => (map[c] && map[c].adjacentTo) || [];

  if (domain === "land") {
    const isLand = (c) => isLandPassable(c);
    const isSea  = (c) => map[c] && map[c].type === "sea";
    const fromSea = isSea(code);
    // 中国的陆军不能进入海洋区域（规则书第309行）
    const canEnterSea = (nation !== "china");

    if (!fromSea) {
      // 在陆地：陆→陆 / 陆→海 / 陆→海→海
      for (const nb of landNbrs(code)) {
        if (isLand(nb)) { out.add(nb); recordVia(code, nb); }   // 陆→陆（1 跳，非铁路）
        if (isSea(nb) && canEnterSea) {
          out.add(nb);                                          // 陆→海（下海）
          recordVia(code, nb);
          for (const s2 of seaNbrs(nb)) {                       // 陆→海→海（通道感知）
            if (isSea(s2) && s2 !== code) { out.add(s2); recordVia(nb, s2); }
          }
        }
      }
      // 铁路任意距离：沿 rT 网络 BFS，只经"友方可通过"的领土
      const railReach = railReachableFrom(code, nation);
      const oneHopLand = new Set(
        landNbrs(code).filter((c) => isLand(c))        // 1 跳相邻陆地（陆军本就能走）
      );
      for (const rcode of railReach.reach) {
        out.add(rcode);
      }
      // 关注界面：只画"铁路专属"（1 跳够不到、必须坐火车）的铁路线段。
      //   若铁路落点本身是 1 跳相邻陆地，则不算"必经铁路"，跳过。
      const railOnlyStop = new Set(
        [...railReach.reach].filter((c) => !oneHopLand.has(c))
      );
      if (railOnlyStop.size) {
        // 只保留通向"铁路专属停靠点"的生成树边（沿路径回溯）
        const parent = railReach.parent || {};
        const keep = new Set();
        for (const stop of railOnlyStop) {
          let cur = stop;
          while (parent[cur] && parent[cur] !== code) {
            keep.add(parent[cur] + "|" + cur);
            cur = parent[cur];
          }
          if (parent[cur] === code) keep.add(code + "|" + cur);
        }
        for (const e of railReach.edges) {
          if (keep.has(e.from + "|" + e.to)) via.push(e);
        }
      }
    } else {
      // 在海上（运兵船）：海→海 / 海→海→海 / 海→陆（陆军在海上不能走铁路）
      for (const s1 of seaNbrs(code)) {
        if (isLand(s1)) { out.add(s1); continue; }              // 海→陆（上岸）
        if (!isSea(s1)) continue;
        out.add(s1); recordVia(code, s1);                       // 海→海
        for (const s2 of seaNbrs(s1)) {                         // 海→海→海
          if (isSea(s2) && s2 !== code) { out.add(s2); recordVia(s1, s2); }
        }
      }
    }
    return { reach: out, via };
  }

  // 空军 / 海军：1~2 跳（同域相邻，海军受通道封锁）
  const wantType = domain === "sea" ? "sea" : null;
  let frontier = [code];
  const seen = new Set([code]);
  for (let hop = 0; hop < 2; hop++) {
    const next = [];
    for (const cur of frontier) {
      const rec = map[cur];
      if (!rec) continue;
      // 海军用通道感知的海邻接；空军用原始相邻（不受通道影响）
      const nbrs = (domain === "sea") ? navalNeighbors(cur, nation) : (rec.adjacentTo || []);
      for (const nb of nbrs) {
        if (seen.has(nb)) continue;
        const nt = map[nb];
        if (!nt) continue;
        if (wantType && nt.type !== wantType) continue;
        if (!wantType && nt.type === "barrier" && !nt.airOnly) continue;
        seen.add(nb);
        out.add(nb);
        if (domain === "sea") recordVia(cur, nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return { reach: out, via };
}

// 取去重后的 via 边（避免同一通道/铁路边重复记录）
function dedupeVia(via) {
  const seen = new Set();
  const out = [];
  for (const v of via) {
    const k = (v.from < v.to ? v.from + "|" + v.to : v.to + "|" + v.from) + "|" + v.kind;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/* 铁路任意距离可达（陆军）：
 *   沿 RAILROADS 网络 BFS，仅经「友方可通过」的领土
 *   （规则书 p.10：不能进入/经过 敌方控制领土或非友方中立领土；
 *     亦不能进入有敌方陆军或轰炸指示物的领土 —— 后者需动态状态，暂缺）。
 *   落点也须为友方可通过领土（不能铁路入侵）。
 *   返回 { reach:Set, edges:[{from,to,kind:"rail"}], parent:{node:parentCode} }
 *   （edges = BFS 生成树边，用于黑色虚线；parent 用于回溯路径）。
 */
let RAIL_BLOCKED = new Set();   // 预留：动态阻挡（轰炸/敌方陆军等）的地块 code
function railPassableFor(code, nation) {
  if (RAIL_BLOCKED.has(code)) return false;
  const t = territoryMap()[code];
  if (!t || t.type !== "land" || t.airOnly) return false;     // 铁路只在普通陆地上
  const o = ownerOf(code);
  if (!o) return false;                                       // 无主/中立 → 不可用
  return allianceOf(nation).has(o);                           // 须该国或其盟友控制
}

function railReachableFrom(code, nation) {
  const reach = new Set();
  const edges = [];
  const parent = {};
  if (!RAILROADS || !RAILROADS[code]) return { reach, edges, parent };
  if (!railPassableFor(code, nation)) return { reach, edges, parent };
  const seen = new Set([code]);
  const queue = [code];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of (RAILROADS[cur] || [])) {
      if (seen.has(nb)) continue;
      if (!railPassableFor(nb, nation)) continue;             // 不可经过/进入
      seen.add(nb);
      reach.add(nb);
      parent[nb] = cur;
      edges.push({ from: cur, to: nb, kind: "rail" });
      queue.push(nb);
    }
  }
  return { reach, edges, parent };
}

// ---- 概念区分 ----
//   关注(focus) = 镜头缩放 + 移动
//   选中(select) = 番号描框高亮 + 显示可达区块（不改动镜头）
//   双击本国部队 = 关注 + 选中；单击地图其他地方 = 取消选中。
let selectedUnit = null;     // { code, unitId }  当前选中的番号
let dragUnitPayload = null;  // { id, nation }  正在从部队列表拖拽的番号
let pendingDestSlot = null;  // { nation, index }  正在编辑地块区的指令格（供地图点选）
let mapPickOrder = null;     // { nation, index }  双击选中部队后自动填入的指令格；地图点标点即填其地块
let orderDragFrom = null;    // 正在拖拽重排的指令格下标
let hoverArrow = null;       // { source:{x,y}世界坐标, target:code }  悬停在可达标点时的临时箭头
// focusHighlight 已在文件上方声明（绘制用）

/* 轻提示：显示一条错误信息（非法指令等），2 秒后淡出 */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  // 强制 reflow 以重启动画
  void el.offsetWidth;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 200);
  }, 2000);
}

// 关注（地区）：镜头移动到该地块并高亮其相邻区块（不涉及部队选中）
function setTerritoryFocus(code) {
  const p = positions && positions[code];
  if (!p) return;
  const t = territoryMap()[code];
  const reach = new Set(t && t.adjacentTo ? t.adjacentTo : []);
  // 地区关注的相邻边里，属于通道的也画虚线（铁路待长途可达实现后再加）
  const via = [];
  for (const nb of (t && t.adjacentTo) || []) {
    const ch = channelBySeaPair && channelBySeaPair[seaPairKey(code, nb)];
    if (ch) via.push({ from: code, to: nb, kind: "channel", id: ch.id });
  }
  focusHighlight = { kind: "territory", code, reach, via: dedupeVia(via) };
  focus(p.x, p.y);
  drawMap();
}

// 选中（部队）：描框该番号 + 显示其可达区块（不改动镜头）
function selectUnit(code, unit) {
  const nation = unit.nation || currentNation;
  const { reach, via } = reachableFrom(code, unit.domain, nation);
  selectedUnit = { code, unitId: unit.id };
  focusHighlight = { kind: "unit", code, unitId: unit.id, reach, via: dedupeVia(via) };
  drawMap();
}

// 取消选中（清空高亮；不改动镜头）
function clearSelection() {
  if (!selectedUnit && !focusHighlight) return;
  selectedUnit = null;
  focusHighlight = null;
  mapPickOrder = null;
  drawMap();
}

// 关注 + 选中（部队）：镜头移动到该番号并选中它
function focusAndSelect(code, unit) {
  const p = positions && positions[code];
  if (p) focus(p.x, p.y);
  selectUnit(code, unit);
}

// 清除高亮（等同 clearSelection，兼容旧调用名）
function clearFocusHighlight() {
  clearSelection();
}


mapImg.onload = () => { mapReady = true; resizeCanvas(); };
mapImg.src = "/assets/map_cn.jpg";

/* ---- 单位（番号）----
 * 从 /units.json 加载（初始编成：122 个番号）
 * 每个番号: { id, nation, domain, num, code(区域), face(番号图), units, unitCount }
 * 渲染位置 = 区域中心 + 同区域序号偏移（避免完全重叠）
 */
let UNITS = [];

const unitFaces = {};   // face 文件名 -> Image

function loadUnitFaces() {
  for (const u of UNITS) {
    if (!u.face) continue;                       // 无 face 的番号不加载
    if (!unitFaces[u.face]) {
      const im = new Image();
      im.onload = () => drawMap();
      im.onerror = () => { /* 加载失败：留空，drawUnits 会跳过 */ };
      im.src = `/assets/${u.face}`;
      unitFaces[u.face] = im;
    }
  }
}

function loadUnits() {
  return fetch("/units.json")
    .then((r) => r.json())
    .then((list) => {
      UNITS = SERVER_STATE?.units ? Object.values(SERVER_STATE.units) : (Array.isArray(list) ? list : []);
      loadUnitFaces();
      drawMap();
      renderUnitPanel();   // 单位就绪后刷新部队栏目
      console.log(`[units] 已加载 ${UNITS.length} 个番号`);
    })
    .catch((e) => console.warn("[units] 加载失败", e));
}

// 单位尺寸：以「地图逻辑单位」表示，固定占地图的比例 → PC/手机 一致
// 陆/空军为正方形，海军为横向长条（宽高比由素材决定）
const UNIT_FRAC = 0.018;         // 陆/空：边长 = 地图边长的 1.8%
const SEA_ASPECT = 365 / 149;    // 海军素材宽高比（宽 = 高 × 2.45）
const LAND_ASPECT = 1.0;         // 陆/空军：宽 = 高

function unitLogicalHeight(domain) {
  // 以"高度"为基准（海军高不变，宽按比例放大）
  return mapSide * UNIT_FRAC;
}
// 单位在"地图逻辑单位"下的 {w, h}
function unitLogicalSize(domain) {
  const h = unitLogicalHeight(domain);
  const w = (domain === "sea") ? h * SEA_ASPECT : h * LAND_ASPECT;
  return { w, h };
}

// 屏幕上的最小/最大高度（CSS 像素），避免极端缩放下过小过大
const UNIT_MIN_SCREEN = 5;
const UNIT_MAX_SCREEN = 48;
// 返回当前缩放下，某域单位的逻辑尺寸 {w,h}
function unitSizeForScale(scale, domain) {
  let { w, h } = unitLogicalSize(domain);
  const screenH = h * scale;
  if (screenH < UNIT_MIN_SCREEN) { const k = (UNIT_MIN_SCREEN / scale) / h; w *= k; h *= k; }
  else if (screenH > UNIT_MAX_SCREEN) { const k = (UNIT_MAX_SCREEN / scale) / h; w *= k; h *= k; }
  return { w, h };
}

/* ---- 单位排布规则 ----
 * 单阵营：以区域中心为中心，构建 2 列 × x 行的块。
 *   · 空军从第 0 行起，按 左上→右上→下一行 填充
 *   · 陆/海军从"空军占用行数"的下一行起（无论空军是否排满），同样左上→右下
 * 双阵营：扩为 4 列 × x 行，轴心固定在左半（列0-1），同盟在右半（列2-3）。
 *   从中间往外排：左半先 col1 再 col0；右半先 col2 再 col3
 *
 * 关键：单元格尺寸使用「当前缩放下的实际绘制尺寸」，保证卡片始终紧贴（无缝隙）。
 */
function layoutArea(list, scale) {
  // 分阵营
  const axis = list.filter(u => u.alliance === "axis");
  const allied = list.filter(u => u.alliance === "allied");
  const singleAlliance = axis.length === 0 || allied.length === 0;

  // 每个"半区"内部排序：空军优先，其次陆/海（保持原始顺序稳定）
  const airFirst = (arr) => {
    const air = arr.filter(u => u.domain === "air");
    const rest = arr.filter(u => u.domain !== "air");
    return { air, rest };
  };

  // 当前缩放下的实际尺寸（含 clamp）；单元格以此为准，保证紧贴
  const sizeOf = (u) => unitSizeForScale(scale, u.domain);

  // 计算某半区需要的行数 & 最大实际宽高
  function halfMetrics(arr) {
    const { air, rest } = airFirst(arr);
    const airRows = Math.ceil(air.length / 2);
    const restRows = Math.ceil(rest.length / 2);
    let maxW = 0, maxH = 0;
    for (const u of arr) {
      const sz = sizeOf(u);
      maxW = Math.max(maxW, sz.w); maxH = Math.max(maxH, sz.h);
    }
    return { air, rest, airRows, rows: airRows + restRows, maxW, maxH };
  }

  // 分别算两个半区（单阵营时只算一个）
  const halfA = singleAlliance ? halfMetrics(axis.length ? axis : allied) : halfMetrics(axis);
  const halfB = singleAlliance ? null : halfMetrics(allied);

  // 列宽/行高：按"当前缩放下的实际最大尺寸" → 卡片紧贴
  const colW = Math.max(halfA.maxW, halfB ? halfB.maxW : 0) || 1;
  const rowH = Math.max(halfA.maxH, halfB ? halfB.maxH : 0) || 1;

  // 生成某半区的单元格位置
  //   colOrder: 半区内第0/1槽分别落到哪个绝对列
  function placeHalf(arr, colOrder) {
    const { air, rest, airRows } = halfMetrics(arr);
    const out = [];
    air.forEach((u, i) => {
      out.push({ u, row: Math.floor(i / 2), col: colOrder[i % 2] });
    });
    rest.forEach((u, i) => {
      out.push({ u, row: airRows + Math.floor(i / 2), col: colOrder[i % 2] });
    });
    return out;
  }

  let cells = [];
  if (singleAlliance) {
    cells = placeHalf(axis.length ? axis : allied, [0, 1]);
  } else {
    cells = placeHalf(axis, [1, 0]).concat(placeHalf(allied, [2, 3]));
  }

  // 实际占用的行列范围（自适应：块宽按真正用到的最左/最右列）
  const usedCols = cells.map(c => c.col);
  const usedRows = cells.map(c => c.row);
  const minCol = usedCols.length ? Math.min(...usedCols) : 0;
  const maxCol = usedCols.length ? Math.max(...usedCols) : 0;
  const minRow = usedRows.length ? Math.min(...usedRows) : 0;
  const maxRow = usedRows.length ? Math.max(...usedRows) : 0;

  // 块尺寸（按实际占用）与左上角（相对区域中心，居中对齐）
  const spanCols = maxCol - minCol + 1;
  const spanRows = maxRow - minRow + 1;
  const blockW = spanCols * colW;
  const blockH = spanRows * rowH;
  const left0 = -blockW / 2;   // 相对 minCol 列的左边界
  const top0 = -blockH / 2;    // 相对 minRow 行的上边界

  // 转成相对区域中心的偏移（单元格中心）
  const res = cells.map(({ u, row, col }) => {
    const cx = left0 + (col - minCol + 0.5) * colW;
    const cy = top0 + (row - minRow + 0.5) * rowH;
    const sz = sizeOf(u);
    return { u, ox: cx, oy: cy, w: sz.w, h: sz.h };
  });
  return { placements: res, blockW, blockH, colW, rowH };
}

function drawUnits(ctx) {
  // 按区域分组
  const byArea = {};
  for (const u of UNITS) {
    (byArea[u.code] = byArea[u.code] || []).push(u);
  }
  for (const [code, list] of Object.entries(byArea)) {
    const base = (positions && positions[code]) || null;
    if (!base) continue;
    const bx = base.x * mapSide, by = base.y * mapSide;

    const { placements } = layoutArea(list, view.scale);
    for (const { u, ox, oy, w, h } of placements) {
      const im = unitFaces[u.face];
      // complete 对"加载失败"的图也是 true；用 naturalWidth 判断真正可用
      if (!im || !im.complete || !im.naturalWidth) continue;
      const x = bx + ox - w / 2;
      const y = by + oy - h / 2;
      try {
        ctx.drawImage(im, x, y, w, h);
      } catch (_) { /* 单张失败不影响整张地图 */ }
      // 关注该番号 → 描金色框
      if (focusHighlight && focusHighlight.kind === "unit" && focusHighlight.unitId === u.id) {
        ctx.save();
        ctx.lineWidth = 2.5 / view.scale;
        ctx.strokeStyle = "#ffd700";
        ctx.shadowColor = "rgba(255,215,0,0.9)";
        ctx.shadowBlur = 8 / view.scale;
        ctx.strokeRect(x - 2 / view.scale, y - 2 / view.scale, w + 4 / view.scale, h + 4 / view.scale);
        ctx.restore();
      }
    }
  }
}

fetch("/data_positions.json").then((r) => r.json()).then((p) => { positions = p; drawMap(); }).catch(() => {});

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const prevH = cssH || window.innerHeight, prevFit = fitScale;
  const centerWorld = initialized && view.scale > 0
    ? { x: ((previousMapWidth || cssW || window.innerWidth) / 2 - view.x) / view.scale, y: (prevH / 2 - view.y) / view.scale }
    : null;
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 基准缩放：让地图"完整适配"视口短边（PC/手机 一致）
  const compact = window.matchMedia("(max-width: 900px), (max-height: 500px), (pointer: coarse)").matches;
  const mapWidth = compact && !actionCollapsed ? cssW - document.getElementById("action-panel").offsetWidth : cssW;
  previousMapWidth = mapWidth;
  fitScale = Math.min(mapWidth, cssH) / mapSide;
  view.minScale = fitScale * 0.5;    // 允许缩小到一半
  view.maxScale = fitScale * 12;     // 允许放大到 12 倍
  focusScaleAbs = fitScale * 3.2;    // focus 的绝对缩放

  // 首次加载：初始缩放 = 适应视口；之后 resize 保持"相对倍数"不变
  if (!initialized) {
    view.scale = fitScale;
    initialized = true;
    centerView();
  } else if (prevFit > 0) {
    view.scale = view.scale * (fitScale / prevFit);
    view.scale = Math.max(view.minScale, Math.min(view.maxScale, view.scale));
    // 让之前屏幕中心的地图点，仍落在新的屏幕中心
    if (centerWorld) {
      view.x = mapWidth / 2 - centerWorld.x * view.scale;
      view.y = cssH / 2 - centerWorld.y * view.scale;
    }
  }
  view.scale = Math.max(view.minScale, Math.min(view.maxScale, view.scale));
  drawMap();
}

// 将地图置为「初始居中」：水平居中、垂直居中
function centerView() {
  const compact = window.matchMedia("(max-width: 900px), (max-height: 500px), (pointer: coarse)").matches;
  const mapWidth = compact && !actionCollapsed ? cssW - document.getElementById("action-panel").offsetWidth : cssW;
  previousMapWidth = mapWidth;
  view.x = (mapWidth - mapSide * view.scale) / 2;
  view.y = (cssH - mapSide * view.scale) / 2;
}

// 视图钳制：仅限制缩放范围；平移不设限（允许视野越过地图边界，用黑边填充）
function clampView() {
  view.scale = Math.max(view.minScale, Math.min(view.maxScale, view.scale));
}

// 把"屏幕像素位移"换算为 view 坐标系（未旋转）的平移量
// 用户手动平移时，中断正在进行的 focus 动画
function panByScreen(dxScreen, dyScreen) {
  if (typeof cancelFocusAnim === "function") cancelFocusAnim();
  const cos = Math.cos(-view.rotation), sin = Math.sin(-view.rotation);
  view.x += dxScreen * cos - dyScreen * sin;
  view.y += dxScreen * sin + dyScreen * cos;
}

// 以某个屏幕点为锚，缩放到 newScale（保持该屏幕点下的地图点不动）
// 用户手动缩放时，中断正在进行的 focus 动画
function zoomAtScreen(newScale, sx, sy) {
  if (typeof cancelFocusAnim === "function") cancelFocusAnim();
  const before = screenToWorld(sx, sy);   // 锚点当前对应的地图逻辑点
  view.scale = Math.max(view.minScale, Math.min(view.maxScale, newScale));
  // 让 before 点仍落在 (sx, sy)：反解 view.x/view.y
  const cx = cssW / 2, cy = cssH / 2;
  const cos = Math.cos(-view.rotation), sin = Math.sin(-view.rotation);
  const dx = sx - cx, dy = sy - cy;
  const tx = cx + dx * cos - dy * sin;   // 旋转前坐标系中的屏幕点
  const ty = cy + dx * sin + dy * cos;
  view.x = tx - before.x * view.scale;
  view.y = ty - before.y * view.scale;
  clampView();
}

function drawMap() {
  const w = cssW, h = cssH;
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 应用视图变换：绕屏幕中心旋转 + 平移 + 缩放
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(view.rotation);
  ctx.translate(-w / 2, -h / 2);
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  if (mapReady) ctx.drawImage(mapImg, 0, 0, mapSide, mapSide);

  // 指令箭头（番号 → 目的地）：已填指令的常驻箭头 + 悬停临时箭头
  drawOrderArrows(ctx);

  // 阶段3：移动结算特效（箭头生长/悬停高亮/沿箭头移动）
  drawMoveEffect(ctx);

  // 绘制单位（番号）
  drawUnits(ctx);

  // 区块/地块标点：浮在最上层（在地图与番号之上）
  //   左下角「地块编号」按钮开启，或关注时唤起可达标点
  if (showCardMarks) drawCardMarks(ctx);
  if (focusHighlight) drawFocusHighlight(ctx);

  ctx.restore();
}

/* ---------- 指令箭头（番号 → 目的地） ---------- */
// 国家色见上方 NATION_COLOR（来源：bundle 的 NATIONS 数组）

/* ============================================================
 * 阶段3：移动结算的客户端特效（所有玩家视角同步）
 *   当服务端 movePhase.cur 变化 → 表示"当前正在结算这条指令"：
 *     1) 镜头同步跳转+缩放：以 番号↔目标地块 连线为中心（左70%画面，缩放≤4.5）
 *     2) 箭头生长出现（起点=番号，终点=目标地块）
 *     3) 若本国 = 该指令所属国 → 画面下方出提示按钮（点击路线=确认，点击提示=取消）
 *     4) 悬停连线上高亮
 *   执行成功 → 沿箭头移动小动效；取消/失败 → 箭头反向生长消失。
 * ============================================================ */
let moveEffect = null;   // { key, nation, orderIndex, formationId, dest, phase:'grow'|'resolve'|'fade', t0 }

// 从服务端 g 同步阶段3 特效状态
function syncMoveEffect(g) {
  const mp = g && g.movePhase;
  const cur = mp && mp.cur;
  if (!cur) {
    // 无当前指令 → 若正在展示，进入淡出
    if (moveEffect && moveEffect.phase !== "fade") { moveEffect.phase = "fade"; moveEffect.t0 = performance.now(); startMoveEffectAnim(); }
    return;
  }
  const key = `${cur.nation}#${cur.orderIndex}#${cur.formationId}->${cur.dest}`;
  if (moveEffect && moveEffect.key === key) return;   // 同一条，不重启
  // 新的一条指令 → 建立特效
  const u = UNITS.find((x) => x.id === cur.formationId);
  const startPos = u ? unitMapPos(u) : null;
  const dpos = positions && positions[cur.dest] ? normToCanvas(positions[cur.dest].x, positions[cur.dest].y) : null;
  if (!startPos || !dpos) return;
  moveEffect = { key, nation: cur.nation, orderIndex: cur.orderIndex, formationId: cur.formationId,
                 dest: cur.dest, phase: "grow", t0: performance.now(),
                 startPos, destPos: dpos, pinned: !!cur.pinned, partial: !!cur.partial,
                 sourceCode: u ? u.code : null };
  // 1) 镜头同步：两点放入左 70% 画面外 20% 内，缩放 ≤4.5
  const t = moveEffectTarget(startPos, dpos);
  focusAnim = { from: { x: view.x, y: view.y, scale: view.scale }, to: t, t0: performance.now(), dur: 600 };
  requestAnimationFrame(tickFocusAnim);
  startMoveEffectAnim();
  // 计时：箭头生长 400ms
  setTimeout(() => { if (moveEffect && moveEffect.phase === "grow") { moveEffect.phase = "ready"; drawMap(); } }, 400);
}

let moveEffectAnimId = null;
function startMoveEffectAnim() {
  if (moveEffectAnimId !== null) return;
  const tick = () => {
    drawMap();
    const now = performance.now();
    const me = moveEffect;
    if (me) {
      if (me.phase === "grow" && now - me.t0 < 450) { moveEffectAnimId = requestAnimationFrame(tick); return; }
      if (me.phase === "resolve" && now - me.t0 < 700) { moveEffectAnimId = requestAnimationFrame(tick); return; }
      if (me.phase === "fade" && now - me.t0 < 450) { moveEffectAnimId = requestAnimationFrame(tick); return; }
      if (me.phase === "fade") { moveEffect = null; drawMap(); }
    }
    moveEffectAnimId = null;
  };
  moveEffectAnimId = requestAnimationFrame(tick);
}

// 本国点「确认」→ 播放"沿箭头移动"动效后发 resolve_order(execute)
function confirmMoveOrder() {
  if (!moveEffect) return;
  moveEffect.phase = "resolve";
  moveEffect.t0 = performance.now();
  startMoveEffectAnim();
  sendAction("resolve_order", { nation: currentNation, result: "execute" });
}
// 本国点「取消」→ 箭头反向消失后发 resolve_order(cancel)
function cancelMoveOrder() {
  if (!moveEffect) return;
  moveEffect.phase = "fade";
  moveEffect.t0 = performance.now();
  startMoveEffectAnim();
  sendAction("resolve_order", { nation: currentNation, result: "cancel" });
}


// 某番号在地图上的世界坐标中心（用其区域坐标 + 布局偏移）
function unitMapPos(u) {
  const base = positions && positions[u.code];
  if (!base) return null;
  const bx = base.x * mapSide, by = base.y * mapSide;
  const list = UNITS.filter((x) => x.code === u.code);
  const { placements } = layoutArea(list, view.scale);
  const pl = placements.find((p) => p.u.id === u.id);
  if (!pl) return { x: bx, y: by };
  return { x: bx + pl.ox, y: by + pl.oy };
}

// 画一支箭头（世界坐标 a→b），颜色 color，progress=生长进度 0..1
function drawArrow(ctx, ax, ay, bx, by, color, width, progress) {
  const s = view.scale;
  const p = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  // 缩短两端，避免压住番号/标点
  const padA = 14 / s, padB = 12 / s;
  const sx = ax + ux * padA, sy = ay + uy * padA;
  const exFull = bx - ux * padB, eyFull = by - uy * padB;
  const fullLen = Math.hypot(exFull - sx, eyFull - sy);
  if (fullLen < 1) return;

  // 生长点：从起点沿方向前进 p 比例
  const reached = fullLen * p;
  const ex = sx + ux * reached, ey = sy + uy * reached;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = (width || 2.5) / s;
  // 线身（生长中只画到 reached）
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // 箭头头部：只在接近全长时出现（p>0.6），随生长淡入
  if (p > 0.6) {
    const headLen = 10 / s, headW = 5.5 / s;
    ctx.globalAlpha = Math.min(1, (p - 0.6) / 0.4);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * headLen - uy * headW, ey - uy * headLen + ux * headW);
    ctx.lineTo(ex - ux * headLen + uy * headW, ey - uy * headLen - ux * headW);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- 箭头生长动效 ----------
 *   出现：从起点生长到终点（ARROW_GROW_MS）；消失：无动效。
 *   以 key（国家+序号 / "hover"）跟踪每支箭头的起始时间。 */
const ARROW_GROW_MS = 350;
const arrowAnimStart = new Map();   // key -> performance.now()
let arrowAnimId = null;

function arrowProgress(key) {
  if (!arrowAnimStart.has(key)) arrowAnimStart.set(key, performance.now());
  const t = (performance.now() - arrowAnimStart.get(key)) / ARROW_GROW_MS;
  return Math.min(1, t);
}
function hasGrowingArrow() {
  const now = performance.now();
  for (const [, t0] of arrowAnimStart) if (now - t0 < ARROW_GROW_MS) return true;
  return false;
}
function tickArrowAnim() {
  drawMap();
  if (hasGrowingArrow()) arrowAnimId = requestAnimationFrame(tickArrowAnim);
  else { arrowAnimId = null; }
}

/* 绘制指令箭头：
 *   1) 常驻：所有「本国 + 同阵营盟友」的已填指令 → 箭头（国家色）
 *   2) 悬停：双击番号填指令后，鼠标悬停在可达标点上 → 从该番号指向标点的临时箭头
 */
function drawOrderArrows(ctx) {
  if (!SERVER_STATE || !SERVER_STATE.nations || !positions) return;
  const myAlliance = NATION_ALLIANCE[currentNation];
  const seenKeys = new Set();
  // 1) 常驻箭头（每个国家用自己的国家色）
  for (const nat of Object.keys(SERVER_STATE.nations)) {
    if (NATION_ALLIANCE[nat] !== myAlliance) continue;     // 只画同阵营（含本国）
    const color = NATION_COLOR[nat] || "#fff";
    const orders = SERVER_STATE.nations[nat].orders || [];
    orders.forEach((o, idx) => {
      if (!o || !o.formationId || !o.dest) return;
      const u = UNITS.find((x) => x.id === o.formationId);
      if (!u) return;
      const a = unitMapPos(u);
      const d = positions[o.dest];
      if (!a || !d) return;
      const key = `${nat}#${idx}#${o.formationId}->${o.dest}`;
      seenKeys.add(key);
      drawArrow(ctx, a.x, a.y, d.x * mapSide, d.y * mapSide, color, 3.5, arrowProgress(key));
    });
  }
  // 2) 悬停箭头（用本国色）
  if (hoverArrow && hoverArrow.target && hoverArrow.source) {
    const a = hoverArrow.source;
    const d = positions[hoverArrow.target];
    if (d) {
      const key = `hover:${hoverArrow.target}`;
      seenKeys.add(key);
      drawArrow(ctx, a.x, a.y, d.x * mapSide, d.y * mapSide,
                NATION_COLOR[currentNation] || "#fff", 3.5, arrowProgress(key));
    }
  }
  // 清理已消失箭头的 key（消失无动效，直接移除）
  for (const k of [...arrowAnimStart.keys()]) if (!seenKeys.has(k)) arrowAnimStart.delete(k);
  // 若有箭头在生长 → 启动动画循环
  if (hasGrowingArrow() && arrowAnimId === null) arrowAnimId = requestAnimationFrame(tickArrowAnim);
}

/* 阶段3 移动特效绘制：箭头（生长/高亮/反向消失）+ 沿箭头移动的单位 */
function drawMoveEffect(ctx) {
  const me = moveEffect;
  if (!me) return;
  const color = NATION_COLOR[me.nation] || "#fff";
  const a = me.startPos, b = me.destPos;
  const now = performance.now();
  const s = view.scale;

  // 被压制 → 不画箭头，改画"番号区域"外围红框
  if (me.pinned) {
    drawPinnedFrame(me, now);
    return;
  }

  // 部分压制 → 红框 + 箭头【同时】出现
  if (me.partial) {
    drawPinnedFrame(me, now);
  }

  // 进度：grow 0→1；resolve 1（满）；fade 1→0
  let p = 1;
  if (me.phase === "grow") p = Math.min(1, (now - me.t0) / 450);
  else if (me.phase === "fade") p = Math.max(0, 1 - (now - me.t0) / 450);

  const hovered = moveEffectHover;
  drawArrow(ctx, a.x, a.y, b.x, b.y, hovered ? "#ffffff" : color, hovered ? 6 : 4.5, p);

  // 沿箭头移动的小动效（resolve 阶段）：标记沿 a→b 前进
  if (me.phase === "resolve") {
    const t = Math.min(1, (now - me.t0) / 700);
    const mx = a.x + (b.x - a.x) * t, my = a.y + (b.y - a.y) * t;
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, 9 / s, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 / s;
    ctx.stroke();
    ctx.restore();
  }
}

// 画"番号区域"外围呼吸红框（完全压制 / 部分压制共用）
function drawPinnedFrame(me, now) {
  const rect = unitBlockRect(me.sourceCode, me.formationId);
  if (!rect) return;
  const s = view.scale;
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(now / 300));
  const ctx = document.querySelector("canvas").getContext("2d");
  ctx.save();
  ctx.strokeStyle = `rgba(255,60,60,${pulse})`;
  ctx.lineWidth = 3 / s;
  ctx.setLineDash([]);
  const pad = 6 / s;
  ctx.strokeRect(rect.x - pad, rect.y - pad, rect.w + 2 * pad, rect.h + 2 * pad);
  ctx.restore();
}

// 某地块内「番号区域」（4×N 布局块）的世界坐标包围盒
function unitBlockRect(code, formationId) {
  const base = positions && positions[code];
  if (!base) return null;
  const bx = base.x * mapSide, by = base.y * mapSide;
  const list = UNITS.filter((u) => u.code === code);
  if (!list.length) return null;
  const { placements } = layoutArea(list, view.scale);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pl of placements) {
    const w = pl.w, h = pl.h;
    minX = Math.min(minX, bx + pl.ox - w / 2);
    maxX = Math.max(maxX, bx + pl.ox + w / 2);
    minY = Math.min(minY, by + pl.oy - h / 2);
    maxY = Math.max(maxY, by + pl.oy + h / 2);
  }
  if (!isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// 命中测试：鼠标是否靠近移动特效的连线（用于高亮）
function moveEffectHit(e) {
  if (!moveEffect) return false;
  const rect = canvas.getBoundingClientRect();
  const sp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const a = moveEffect.startPos, b = moveEffect.destPos;
  // 点到线段距离
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((sp.x - a.x) * dx + (sp.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + dx * t, py = a.y + dy * t;
  const dist = Math.hypot(sp.x - px, sp.y - py);
  return dist < 14 / view.scale;
}
let moveEffectHover = false;


function drawFocusHighlight(ctx) {
  const fh = focusHighlight;
  if (!fh || !positions) return;
  const s = view.scale;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 1) 可达地区的标点（唤起）—— 金黄圈 + 编号
  const fs = 9 / s, off = 7 / s;
  ctx.font = `bold ${fs}px sans-serif`;
  for (const code of fh.reach) {
    const p = positions[code];
    if (!p) continue;
    const x = p.x * mapSide, y = p.y * mapSide;
    ctx.beginPath();
    ctx.arc(x, y, 4 / s, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,215,0,0.85)";
    ctx.fill();
    ctx.lineWidth = 1.2 / s;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    if (s > 0.25) {
      ctx.lineWidth = 2.6 / s;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(code, x, y - off);
      ctx.fillStyle = "#fff";
      ctx.fillText(code, x, y - off);
    }
  }

  // 2) 目标地块（地区关注）：金色大圈 + 金色编号
  if (fh.kind === "territory") {
    const p = positions[fh.code];
    if (p) {
      const x = p.x * mapSide, y = p.y * mapSide;
      ctx.beginPath();
      ctx.arc(x, y, 7 / s, 0, Math.PI * 2);
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = "#ffd700";
      ctx.stroke();
      ctx.font = `bold ${11 / s}px sans-serif`;
      ctx.lineWidth = 3 / s;
      ctx.strokeStyle = "rgba(0,0,0,0.95)";
      ctx.strokeText(fh.code, x, y - 12 / s);
      ctx.fillStyle = "#ffd700";
      ctx.fillText(fh.code, x, y - 12 / s);
    }
  }

  // 3) 必经通道/铁路：虚线连接两地块点（通道=蓝 / 铁路=橙）
  if (fh.via && fh.via.length) {
    for (const v of fh.via) {
      const a = positions[v.from], b = positions[v.to];
      if (!a || !b) continue;
      const x1 = a.x * mapSide, y1 = a.y * mapSide;
      const x2 = b.x * mapSide, y2 = b.y * mapSide;
      ctx.save();
      ctx.setLineDash([6 / s, 4 / s]);
      ctx.lineWidth = 2 / s;
      // 通道=蓝 / 铁路=黑（黑虚线在浅色底图上仍可见，必要时加浅色描边）
      if (v.kind === "channel") {
        ctx.strokeStyle = "#66ccff";
      } else {
        ctx.strokeStyle = "#000000";
      }
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* ---------- 地块卡编号标注叠加层 ---------- */
let showCardMarks = false;   // 由左下角「地块编号」按钮切换
// 有卡国家前缀 → 国别配色
const CARD_MARK_COLORS = {
  B: "#4a7fd4", G: "#d4a017", J: "#d44a4a", U: "#4ad488",
  R: "#c04ad4", T: "#88d44a", C: "#d4d44a", N: "#aaaaaa",
};

/* 整个铁路网（视图叠加层用）：把所有 rT 边画成黑色虚线 */
function drawRailNetwork(ctx) {
  if (!RAILROADS || !positions) return;
  const s = view.scale;
  ctx.save();
  ctx.setLineDash([5 / s, 4 / s]);
  ctx.lineWidth = 1.6 / s;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  const drawn = new Set();
  for (const a in RAILROADS) {
    const pa = positions[a];
    if (!pa) continue;
    for (const b of RAILROADS[a]) {
      const key = a < b ? a + "|" + b : b + "|" + a;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const pb = positions[b];
      if (!pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * mapSide, pa.y * mapSide);
      ctx.lineTo(pb.x * mapSide, pb.y * mapSide);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* 全部海峡/运河（视图叠加层用）：
 *   把每条通道的两端海区用虚线连起来，按「对玩家所在国的可用性」着色：
 *     可用（该国或其盟友控制过渡领土）→ 蓝色
 *     不可用                            → 红色
 */
function drawChannels(ctx) {
  if (!CHANNELS || !positions || !channelBySeaPair) return;
  const s = view.scale;
  const nation = currentNation;
  ctx.save();
  ctx.setLineDash([6 / s, 4 / s]);
  ctx.lineWidth = 2.2 / s;
  for (const ch of CHANNELS) {
    const [a, b] = ch.seaZones;
    const pa = positions[a], pb = positions[b];
    if (!pa || !pb) continue;
    const open = channelOpenFor(ch, nation);
    ctx.strokeStyle = open ? "#4aa3ff" : "#ff4a4a";   // 蓝=可用 / 红=不可用
    ctx.beginPath();
    ctx.moveTo(pa.x * mapSide, pa.y * mapSide);
    ctx.lineTo(pb.x * mapSide, pb.y * mapSide);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCardMarks(ctx) {
  if (!positions) return;
  // 先画整个铁路网（黑色虚线，位于标点之下）
  drawRailNetwork(ctx);
  // 再画海峡/运河连线（蓝=可用 / 红=不可用）
  drawChannels(ctx);
  const s = view.scale;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const r = 3 / s;                 // 圆点半径（屏幕恒定 3px）
  const fs = 9 / s;                // 字号（屏幕恒定 9px）
  const off = 7 / s;               // 标签上移量（屏幕恒定）
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.lineWidth = 2.4 / s;
  for (const code in positions) {
    const col = CARD_MARK_COLORS[code[0]];
    if (!col) continue;            // 只标有卡国家
    if (code === "TIBET") continue;
    const p = positions[code];
    const x = p.x * mapSide, y = p.y * mapSide;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.8 / s;
    ctx.stroke();
    if (s > 0.25) {                // 太小时不画文字，避免糊成一团
      ctx.lineWidth = 2.4 / s;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(code, x, y - off);
      ctx.fillStyle = "#fff";
      ctx.fillText(code, x, y - off);
    }
  }
  ctx.restore();
}

/* ---------- 左下角视窗按钮 ---------- */
function initViewToolbar() {
  const btn = document.getElementById("vt-card-marks");
  if (!btn) return;
  btn.addEventListener("click", () => {
    showCardMarks = !showCardMarks;
    btn.classList.toggle("active", showCardMarks);
    drawMap();
  });
}

window.addEventListener("resize", resizeCanvas);

/* ---------- 滚轮缩放（以指针为中心） ---------- */
canvas.addEventListener("wheel", (e) => {
  e.preventDefault(); // 阻止页面滚动
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;   // 指针在画布内的位置
  const py = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomAtScreen(view.scale * factor, px, py);
  drawMap();
}, { passive: false });

/* ---------- 拖动平移（鼠标中/左键拖）+ 双指捏合缩放 ---------- */
const pointers = new Map(); // pointerId -> {x,y}
let dragging = false;
let lastMid = null;   // 双指中点
let lastDist = 0;     // 双指间距

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) dragging = true;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    lastDist = Math.hypot(a.x - b.x, a.y - b.y);
    dragging = false;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);

  if (pointers.size === 1 && dragging) {
    // 单指/单键拖动平移
    panByScreen(cur.x - prev.x, cur.y - prev.y);
    clampView();
    drawMap();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const rect = canvas.getBoundingClientRect();
    const px = mid.x - rect.left, py = mid.y - rect.top;

    // 捏合缩放（以双指中点为锚）
    if (lastDist > 0 && dist > 0) {
      zoomAtScreen(view.scale * (dist / lastDist), px, py);
    }
    // 双指平移
    if (lastMid) panByScreen(mid.x - lastMid.x, mid.y - lastMid.y);
    lastMid = mid; lastDist = dist;
    clampView();
    drawMap();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) { lastMid = null; lastDist = 0; }
  if (pointers.size === 0) dragging = false;
  if (pointers.size === 1) dragging = true;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", endPointer);

/* ---------- 单击地图 ----------
 *   若存在"双击选中部队后待填地块的指令格"（mapPickOrder），
 *   且点击命中该部队可达区块的标点 → 填入该区块；否则取消选中。 */
canvas.addEventListener("click", (e) => {
  // 阶段3：点击移动连线（本国=当前指令所属国）→ 确认执行
  if (moveEffect && moveEffect.nation === currentNation && moveEffect.phase !== "fade" && moveEffectHit(e)) {
    confirmMoveOrder();
    return;
  }
  // 地图点选填地块（方式③）
  if (mapPickOrder && focusHighlight && focusHighlight.kind === "unit") {
    const hit = hitTestTerritory(e);
    if (hit && focusHighlight.reach && focusHighlight.reach.has(hit.code)) {
      const { nation, index } = mapPickOrder;
      const me = SERVER_STATE && SERVER_STATE.nations && SERVER_STATE.nations[nation];
      const ord = me && me.orders && me.orders[index];
      if (ord && ord.formationId) {
        sendAction("set_order", { nation, index, order: { formationId: ord.formationId, dest: hit.code } });
      }
      return;                                   // 已填地块，不取消选中
    }
  }
  // 单击地图任何位置 → 取消选中状态（不改动镜头）
  if (selectedUnit || focusHighlight) { clearSelection(); mapPickOrder = null; }
});

/* ---------- 鼠标移动：悬停箭头（双击番号填指令后，悬停在可达标点上） ----------
 *   仅当本次指令由"双击选中"方式产生（mapPickOrder）时启用悬停箭头。 */
canvas.addEventListener("mousemove", (e) => {
  // 阶段3：悬停移动连线高亮
  if (moveEffect && moveEffect.nation === currentNation && moveEffect.phase !== "fade") {
    const h = moveEffectHit(e);
    if (h !== moveEffectHover) {
      moveEffectHover = h;
      canvas.style.cursor = h ? "pointer" : "";
      drawMap();
    }
  }
  let next = null;
  if (mapPickOrder && focusHighlight && focusHighlight.kind === "unit") {
    const hit = hitTestTerritory(e);
    if (hit && focusHighlight.reach && focusHighlight.reach.has(hit.code)) {
      const u = selectedUnit ? UNITS.find((x) => x.id === selectedUnit.unitId) : null;
      const src = u ? unitMapPos(u) : null;
      if (src) next = { source: src, target: hit.code };
    }
  }
  const changed = (!!next) !== (!!hoverArrow) || (next && hoverArrow && next.target !== hoverArrow.target);
  if (changed) { hoverArrow = next; drawMap(); }
});

/* ---------- 双击地图 ----------
 *   · 本国部队 → 关注(镜头) + 选中(描框+可达区块)
 *   · 他国部队 → 仅关注(镜头)
 *   · 地块     → 关注地块 + 高亮其相邻区块
 *   · 空白     → 取消选中 + 复位视图
 */
canvas.addEventListener("dblclick", (e) => {
  const hu = hitTestUnit(e);
  if (hu) {
    if (hu.unit.nation === currentNation) {
      // 本国：关注 + 选中 + 自动填入一个新指令
      focusSelectAndFillOrder(hu.unit);
    } else {
      const p = positions[hu.code]; if (p) focus(p.x, p.y);   // 他国：仅关注
    }
    return;
  }
  const hit = hitTestTerritory(e);
  if (hit) { setTerritoryFocus(hit.code); mapPickOrder = null; return; }
  // 未命中 → 取消选中 + 复位视图
  clearSelection();
  mapPickOrder = null;
  cancelFocusAnim();
  view.scale = fitScale;
  view.rotation = 0;
  centerView();
  drawMap();
});

/* ---------- 右击地图单位：打开"合并与拆分部队"弹窗 ---------- */
canvas.addEventListener("contextmenu", (e) => {
  const hit = hitTestUnit(e);
  if (hit) {
    e.preventDefault();
    openMergeModal(hit.code, hit.unit);
  }
  // 未命中单位则不拦截（允许浏览器默认菜单…亦可屏蔽；这里仅在有单位时阻止）
});

/* ---------- 长按地图单位（触摸/鼠标）：打开"合并与拆分部队"弹窗 ---------- */
let lpTimer = null, lpStart = null;
const LONGPRESS_MS = 500;
function startLongPress(e) {
  const rect = canvas.getBoundingClientRect();
  lpStart = { x: e.clientX, y: e.clientY };
  lpTimer = setTimeout(() => {
    const hit = hitTestUnit({ clientX: lpStart.x, clientY: lpStart.y });
    if (hit) openMergeModal(hit.code, hit.unit);
    lpTimer = null;
  }, LONGPRESS_MS);
}
function cancelLongPress() {
  if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
}
canvas.addEventListener("pointerdown", startLongPress);
canvas.addEventListener("pointermove", (e) => {
  // 移动超过阈值则取消长按（视为拖动）
  if (lpStart && (Math.abs(e.clientX - lpStart.x) > 8 || Math.abs(e.clientY - lpStart.y) > 8)) {
    cancelLongPress();
  }
});
canvas.addEventListener("pointerup", cancelLongPress);
canvas.addEventListener("pointercancel", cancelLongPress);
canvas.addEventListener("pointerleave", cancelLongPress);


/* ---------- 双击地图：见上方（本国部队=关注+选中 / 他国=仅关注 / 地块=关注 / 空白=复位） ---------- */

// 命中最近的地块点（阈值内）
function hitTestTerritory(e) {
  const rect = canvas.getBoundingClientRect();
  const s = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const nx = s.x / mapSide, ny = s.y / mapSide;
  let best = null, bestD = Infinity;
  for (const [code, p] of Object.entries(positions || {})) {
    const d = Math.hypot(p.x - nx, p.y - ny);
    if (d < bestD) { bestD = d; best = { code, ...p }; }
  }
  return (best && bestD < 0.03) ? best : null;
}

// 命中地图上某个番号（返回该番号所在区域的 code + 番号 u）
function hitTestUnit(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const s = screenToWorld(sx, sy);
  // 按区域分组，逐区域检查其 placements 的矩形
  const byArea = {};
  for (const u of UNITS) (byArea[u.code] = byArea[u.code] || []).push(u);
  for (const [code, list] of Object.entries(byArea)) {
    const base = positions && positions[code];
    if (!base) continue;
    const bx = base.x * mapSide, by = base.y * mapSide;
    const { placements } = layoutArea(list, view.scale);
    for (const { u, ox, oy, w, h } of placements) {
      // 卡片中心（地图逻辑）→ 屏幕
      const c = worldToScreen(bx + ox, by + oy);
      // 卡片屏幕尺寸 = w * scale（h 同理）
      const sw = w * view.scale, sh = h * view.scale;
      if (Math.abs(sx - c.x) <= sw / 2 && Math.abs(sy - c.y) <= sh / 2) {
        return { code, unit: u };
      }
    }
  }
  return null;
}

/* ============================================================
 * 三·C、合并与拆分部队 弹窗
 *   · 顶部：空闲番号区（按该地块本国军队实际有的兵种类型，每类一行）
 *   · 下部：现有番号部队区（每个番号一块，固定 4 列×2 行网格）
 *   · 拖拽：番号间拖「单个兵种单位」（须同类、拖入后≤8）；
 *           拖到空闲番号图标上 → 新建部队（番号立即出现）
 *   · 番号变空不立即回收；点击弹窗外 = 确认，此时才回收空番号
 * ============================================================ */
let mergeDraft = null;
/* draft = {
 *   code, nation,
 *   formations: [ { key, num, domain, alliance, units:[type,...] } ],  // 现有番号
 *   // 空番号池（按域）：由 formations_all 与"已用番号"差集算出
 * } */

const MERGE_MAX_UNITS = 8;         // 每个番号最多 8 个单位
const MERGE_GRID_COLS = 4;
const MERGE_GRID_ROWS = 2;

function openMergeModal(code, unit) {
  const nation = currentNation;
  if (!SERVER_STATE || !["phase2_planning", "phase5_refit"].includes(SERVER_STATE.phase) || isViewingPast()) { showToast("只能在规划或改装部署阶段重调部队"); return; }
  // 构造草稿：该地块内「本国」的番号
  const mine = UNITS.filter(u => u.code === code && u.nation === nation);
  const formations = mine.map((u, i) => ({
    key: `${u.domain}-${u.num}-${i}`,
    num: u.num,
    domain: u.domain,
    alliance: u.alliance,
    face: u.face,
    sourceId: u.id,
    units: expandUnits(u.units),      // 展开为单个兵种数组
  }));

  mergeDraft = { code, nation, formations };

  const modal = document.getElementById("merge-modal");
  const backdrop = document.getElementById("merge-backdrop");
  if (!modal) return;
  const title = document.getElementById("merge-title");
  if (title) title.textContent = `合并与拆分部队 — ${code} ${TERRITORY_NAMES[code] || ""}`;
  renderMergeBody();
  modal.hidden = false;
  if (backdrop) backdrop.hidden = false;
}

// 把 {infantry:2, artillery:1} 展开为 ["infantry","infantry","artillery"]
function expandUnits(counts) {
  const out = [];
  for (const [type, n] of Object.entries(counts || {})) {
    for (let i = 0; i < n; i++) out.push(type);
  }
  return out;
}
// 把 ["infantry","infantry"] 收回为 {infantry:2}
function collapseUnits(arr) {
  const out = {};
  for (const t of arr) out[t] = (out[t] || 0) + 1;
  return out;
}

// 某个域中「空闲」的番号（该国全部素材番号 − 已用于本国任意地块的番号 − 本次草稿中已用番号）
function freeNumsFor(nation, domain) {
  const all = ((FORMATIONS_ALL && FORMATIONS_ALL[nation]) || {})[domain] || [];
  const used = new Set(UNITS.filter(u => u.nation === nation && u.domain === domain).map(u => u.num));
  // 草稿中已占用的番号（含刚由拖拽创建的新部队）也要排除，使其立即从空闲表消失
  if (mergeDraft && mergeDraft.nation === nation) {
    for (const f of mergeDraft.formations) {
      if (f.domain === domain) used.add(f.num);
    }
  }
  return all.filter(n => !used.has(n));
}

// 该地块本国军队实际出现的兵种类型（域）
function presentDomains(formations) {
  const s = new Set(formations.map(f => f.domain));
  return ["air", "land", "sea"].filter(d => s.has(d));
}

// 关闭并放弃更改（不回收）
function closeMergeModal() {
  const modal = document.getElementById("merge-modal");
  const backdrop = document.getElementById("merge-backdrop");
  if (modal) modal.hidden = true;
  if (backdrop) backdrop.hidden = true;
  mergeDraft = null;
}

// 确认更改：回收空番号，落定到 UNITS
function commitMergeModal() {
  if (!mergeDraft) { closeMergeModal(); return; }
  const { nation, code, formations } = mergeDraft;
  const originals = UNITS.filter(u => u.code === code && u.nation === nation);
  const kept = formations.filter(f => f.units.length);
  if (kept.length === originals.length && kept.every(f => { const source = originals.find(u => u.id === f.sourceId); const counts = collapseUnits(f.units); return source && source.num === f.num && Object.keys({ ...source.units, ...counts }).every(t => (source.units[t] || 0) === (counts[t] || 0)); })) { closeMergeModal(); return; }
  const operations = ["land", "air", "sea"].map(domain => ({
    unitIds: originals.filter(u => u.domain === domain).map(u => u.id),
    groups: formations.filter(f => f.domain === domain && f.units.length).map(f => collapseUnits(f.units)),
    numbers: formations.filter(f => f.domain === domain && f.units.length).map(f => f.num),
  })).filter(o => o.unitIds.length);
  closeMergeModal();
  if (window.previewSettlement) window.previewSettlement({ action: "reorganize_area", nation, operations });
}

// ---- 渲染 ----
function renderMergeBody() {
  const body = document.getElementById("merge-body");
  if (!body || !mergeDraft) return;
  body.innerHTML = "";

  const { nation, code, formations } = mergeDraft;

  // 顶部：空闲番号区（按该地块实际有的兵种类型，每类一行）
  const reserveWrap = document.createElement("div");
  reserveWrap.className = "merge-reserve";
  const domains = presentDomains(formations);
  if (domains.length === 0) {
    const empty = document.createElement("div");
    empty.className = "merge-hint";
    empty.textContent = "该地块无本国军队，无可用番号。";
    reserveWrap.appendChild(empty);
  } else {
    for (const domain of domains) {
      const nums = freeNumsFor(nation, domain);
      const row = document.createElement("div");
      row.className = "merge-reserve-row";
      const lbl = document.createElement("span");
      lbl.className = "merge-reserve-label";
      lbl.textContent = DOMAIN_CN[domain];
      row.appendChild(lbl);

      const strip = document.createElement("div");
      strip.className = "merge-reserve-strip";
      if (nums.length === 0) {
        const none = document.createElement("span");
        none.className = "merge-reserve-none";
        none.textContent = "（无空闲番号）";
        strip.appendChild(none);
      } else {
        for (const num of nums) {
          const cap = domain === "land" ? "Land" : (domain === "air" ? "Air" : "Sea");
          const asset = NATION_ASSET[nation];
          const face = `${asset}_${cap}_${num}.png`;
          const chip = document.createElement("div");
          chip.className = "merge-reserve-chip";
          chip.dataset.domain = domain;
          chip.dataset.num = num;
          chip.dataset.face = face;
          const img = document.createElement("img");
          img.className = "merge-chip-face" + (domain === "sea" ? " sea" : "");
          img.src = `/assets/${face}`;
          img.alt = `${domain}${num}`;
          chip.appendChild(img);
          // 作为拖放目标：从某番号拖单位过来 → 新建番号
          makeReserveDropTarget(chip);
          strip.appendChild(chip);
        }
      }
      row.appendChild(strip);
      reserveWrap.appendChild(row);
    }
  }
  body.appendChild(reserveWrap);

  // 分隔
  const sep = document.createElement("div");
  sep.className = "merge-sep";
  body.appendChild(sep);

  // 下部：现有番号部队区
  //   按域分组（空军 → 陆军 → 海军），每行放 3 块
  const listWrap = document.createElement("div");
  listWrap.className = "merge-formations";
  for (const domain of ["air", "land", "sea"]) {
    const group = formations.filter(f => f.domain === domain);
    if (group.length === 0) continue;
    const rowEl = document.createElement("div");
    // 海军图标更宽 → 一行只放 2 块；空军/陆军一行 3 块
    rowEl.className = "merge-block-row" + (domain === "sea" ? " two" : "");
    for (const f of group) {
      rowEl.appendChild(renderFormationBlock(f));
    }
    listWrap.appendChild(rowEl);
  }
  body.appendChild(listWrap);
}

// 单个番号区块（番号图标在上居中；下方固定 4×2 兵种网格）
function renderFormationBlock(f) {
  const block = document.createElement("div");
  block.className = "merge-block" + (f.units.length === 0 ? " empty" : "");
  block.dataset.key = f.key;
  block.dataset.domain = f.domain;

  // 番号图标（在上，居中）
  const head = document.createElement("div");
  head.className = "merge-block-head";
  const face = document.createElement("img");
  face.className = "merge-block-face" + (f.domain === "sea" ? " sea" : "");
  face.src = `/assets/${f.face}`;
  head.appendChild(face);
  block.appendChild(head);

  // 兵种网格：固定 4 列 × 2 行（共 8 格），不足留空
  const grid = document.createElement("div");
  grid.className = "merge-grid";
  const total = MERGE_GRID_COLS * MERGE_GRID_ROWS;
  for (let i = 0; i < total; i++) {
    const cell = document.createElement("div");
    cell.className = "merge-cell";
    if (i < f.units.length) {
      const type = f.units[i];
      const ic = document.createElement("img");
      ic.className = "u-icon";
      ic.src = `/assets/${UNIT_ICON[type] || "Infantry.jpg"}`;
      ic.title = type;
      ic.draggable = true;
      ic.dataset.type = type;
      ic.dataset.fromKey = f.key;
      ic.dataset.index = i;
      makeUnitDragSource(ic);
      cell.appendChild(ic);
    } else {
      cell.classList.add("vacant");
    }
    // 单元格作为拖放目标（整块可接收，落到该番号）
    grid.appendChild(cell);
  }
  // 整块作为拖放目标
  makeFormationDropTarget(block, f);
  block.appendChild(grid);
  return block;
}

/* ---- 拖拽逻辑 ---- */
let dragPayload = null;   // { fromKey, index, type, domain }

function makeUnitDragSource(ic) {
  ic.addEventListener("dragstart", (e) => {
    const f = mergeDraft.formations.find(x => x.key === ic.dataset.fromKey);
    dragPayload = { fromKey: f.key, index: +ic.dataset.index, type: ic.dataset.type, domain: f.domain };
    e.dataTransfer.effectAllowed = "move";
    // Firefox 需要 setData
    try { e.dataTransfer.setData("text/plain", "unit"); } catch (_) {}
    ic.classList.add("dragging");
  });
  ic.addEventListener("dragend", () => {
    ic.classList.remove("dragging");
    dragPayload = null;
    clearDropHints();
  });
}

function isValidDropTo(targetDomain, targetCount) {
  if (!dragPayload) return false;
  if (dragPayload.domain !== targetDomain) return false;   // 必须同类
  if (targetCount >= MERGE_MAX_UNITS) return false;        // 拖入后不得超过 8
  return true;
}

function makeFormationDropTarget(block, f) {
  block.addEventListener("dragover", (e) => {
    if (!dragPayload) return;
    if (isValidDropTo(f.domain, f.units.length)) {
      e.preventDefault();
      block.classList.add("drop-ok");
    } else {
      block.classList.add("drop-bad");
    }
  });
  block.addEventListener("dragleave", () => {
    block.classList.remove("drop-ok", "drop-bad");
  });
  block.addEventListener("drop", (e) => {
    e.preventDefault();
    block.classList.remove("drop-ok", "drop-bad");
    if (!dragPayload) return;
    if (!isValidDropTo(f.domain, f.units.length)) return;   // 无效：忽略
    applyMoveUnit(dragPayload.fromKey, dragPayload.index, f.key);
    dragPayload = null;
    renderMergeBody();
  });
}

// 拖到空闲番号图标：新建部队
function makeReserveDropTarget(chip) {
  chip.addEventListener("dragover", (e) => {
    if (!dragPayload) return;
    if (dragPayload.domain === chip.dataset.domain) {
      e.preventDefault();
      chip.classList.add("drop-ok");
    } else {
      chip.classList.add("drop-bad");
    }
  });
  chip.addEventListener("dragleave", () => {
    chip.classList.remove("drop-ok", "drop-bad");
  });
  chip.addEventListener("drop", (e) => {
    e.preventDefault();
    chip.classList.remove("drop-ok", "drop-bad");
    if (!dragPayload) return;
    if (dragPayload.domain !== chip.dataset.domain) return;  // 类型不符：无效
    // 从源番号取出该单位，创建新番号
    const { fromKey, index } = dragPayload;
    const from = mergeDraft.formations.find(x => x.key === fromKey);
    if (!from || index >= from.units.length) return;
    const type = from.units[index];
    from.units.splice(index, 1);
    mergeDraft.formations.push({
      key: `${chip.dataset.domain}-${chip.dataset.num}-new-${Date.now()}`,
      num: +chip.dataset.num,
      domain: chip.dataset.domain,
      alliance: mergeDraft.formations[0]?.alliance || "allied",
      face: chip.dataset.face,
      units: [type],
    });
    dragPayload = null;
    renderMergeBody();
  });
}

// 把某个单位从 fromKey 的 index 移到 toKey 番号末尾
function applyMoveUnit(fromKey, index, toKey) {
  const from = mergeDraft.formations.find(x => x.key === fromKey);
  const to = mergeDraft.formations.find(x => x.key === toKey);
  if (!from || !to) return;
  if (index >= from.units.length) return;
  const [type] = from.units.splice(index, 1);
  to.units.push(type);
}

function clearDropHints() {
  document.querySelectorAll(".drop-ok, .drop-bad").forEach(el => el.classList.remove("drop-ok", "drop-bad"));
}

// 初始化弹窗（关闭按钮 / 点击弹窗外=确认 / Esc 放弃）
function initMergeModal() {
  const modal = document.getElementById("merge-modal");
  const backdrop = document.getElementById("merge-backdrop");
  const close = document.getElementById("merge-close");
  // ✕ 按钮 = 确认并关闭
  if (close) close.addEventListener("click", (e) => { e.stopPropagation(); commitMergeModal(); });
  // 点击遮罩（弹窗之外）= 确认
  if (backdrop) backdrop.addEventListener("mousedown", () => commitMergeModal());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) closeMergeModal();
  });
}


/* ============================================================
 * 三、WebSocket 连接（无身份）
 * ============================================================ */
let ws = null;
let reconnectTimer = null;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    // 连上即可，无需发送任何身份信息
    ws.send(JSON.stringify({ action: "sync" }));
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "state") applyState(msg);
    else if (window.handleSettlementMessage) window.handleSettlementMessage(msg);
    else if (msg.type === "error") showToast(msg.message);
  };

  ws.onclose = () => {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

/* 服务端全局状态（节选）——供行动页/进度条/确认按钮渲染 */
let SERVER_META = null;
let SERVER_STATE = null;      // snapshot().game

/* ---- 回看模式 ----
 *  viewed = null            → 跟随当前阶段（可编辑）
 *  viewed = { round, idx }  → 回看某轮某阶段（冻结/只读）
 */
let viewed = null;

const PHASE_NAMES = {
  phase1_economy: "阶段1 国民经济",
  phase2_planning: "阶段2 战略规划",
  phase3_movement: "阶段3 移动操作",
  phase4_combat: "阶段4 作战行动",
  phase5_refit: "阶段5 改装部署",
  phase6_morale: "阶段6 压力结算",
  phase7_production: "阶段7 生产",
};
// 进度条上的短标签
const PHASE_SHORT = ["国", "规", "移", "战", "装", "压", "产"];

function applyState(msg) {
  const g = msg.game;
  if (!g) return;
  SERVER_STATE = g;
  if (msg.meta) SERVER_META = msg.meta;
  if (g.units) { UNITS = Object.values(g.units); loadUnitFaces(); renderUnitPanel(); }
  flippedCards.clear(); for (const [code, st] of Object.entries(g.territories || {})) if (st.embattled) flippedCards.add(code);
  if (window.refreshSettlementChrome) window.refreshSettlementChrome(g);
  if (msg.meta && msg.meta.phases) PHASE_KEYS = msg.meta.phases;
  document.getElementById("phase-label").textContent = PHASE_NAMES[g.phase] || g.phase;
  document.getElementById("round-label").textContent = `第 ${g.round} 轮`;
  // 地块当前控制权：以服务端权威 g.territories 为准
  syncTerritoryOwnersFromServer(g);
  // 左侧国家资源条：用服务端权威数据覆盖本地占位
  syncNationInfoFromServer(g);
  renderPhaseProgress(g);
  renderConfirmButton(g);
  renderActionContent(g);
  renderNationConfirmHighlights(g);
  renderTurnOrder(g);
  syncMoveEffect(g);
  renderMovePrompt(g);
  renderSplitModal(g);
  if (window.renderProductionTab) window.renderProductionTab(g);
  drawMap();
}

/* ---------- 部分压制：拆分弹窗 ---------- */
// 拆分草稿：{ [type]: count } 已拖到留守番号的兵种计数
let splitDraft = null;
let splitModalKey = null;   // 防重复渲染

function renderSplitModal(g) {
  const modal = document.getElementById("split-modal");
  const backdrop = document.getElementById("split-backdrop");
  if (!modal) return;
  const mp = g && g.movePhase;
  const cur = mp && mp.cur;
  const shouldShow = !isViewingPast() && cur && mp.awaiting && cur.nation === currentNation && cur.partial;
  if (!shouldShow) {
    modal.hidden = true; if (backdrop) backdrop.hidden = true;
    splitDraft = null; splitModalKey = null;
    return;
  }
  const key = `${cur.nation}#${cur.orderIndex}#${cur.formationId}`;
  if (splitModalKey === key) return;       // 同一条，避免重绘打断拖拽
  splitModalKey = key;
  splitDraft = {};
  modal.hidden = false; if (backdrop) backdrop.hidden = false;

  renderSplitModalBody(cur);
}

function renderSplitModalBody(cur) {
  const srcEl = document.getElementById("split-src");
  const dstEl = document.getElementById("split-dst");
  const freeLabel = document.getElementById("split-free-label");
  const confirmBtn = document.getElementById("split-confirm-btn");
  srcEl.innerHTML = ""; dstEl.innerHTML = "";

  const u = UNITS.find((x) => x.id === cur.formationId);
  const X = cur.partialX || 0;
  if (freeLabel) freeLabel.textContent = cur.freeFormation ? `${cur.freeFormation.domain === "air" ? "空" : "陆"}${cur.freeFormation.num}` : "（无）";

  // 当前部队的兵种指示物（可拖走的）
  const draftCount = Object.values(splitDraft).reduce((a, b) => a + b, 0);
  if (u) {
    for (const [type, count] of Object.entries(u.units || {})) {
      const inDraft = splitDraft[type] || 0;
      const remain = count - inDraft;
      for (let i = 0; i < remain; i++) {
        const img = document.createElement("img");
        img.className = "sp-icon";
        img.src = `/assets/${UNIT_ICON[type] || "Infantry.jpg"}`;
        img.alt = type; img.title = type;
        img.draggable = true;
        img.addEventListener("dragstart", (e) => {
          splitDrag = { type };
          try { e.dataTransfer.setData("text/plain", type); } catch (_) {}
        });
        img.addEventListener("click", () => {  // 也支持点击移动
          if (draftCount < X) { splitDraft[type] = (splitDraft[type] || 0) + 1; renderSplitModalBody(cur); }
        });
        srcEl.appendChild(img);
      }
    }
  }

  // 留守番号的 X 个格子（已填 + 空位）
  const filled = [];
  for (const [type, c] of Object.entries(splitDraft)) for (let i = 0; i < c; i++) filled.push(type);
  for (let i = 0; i < X; i++) {
    if (i < filled.length) {
      const img = document.createElement("img");
      img.className = "sp-icon";
      img.src = `/assets/${UNIT_ICON[filled[i]] || "Infantry.jpg"}`;
      img.alt = filled[i];
      img.title = "点击移回";
      img.addEventListener("click", () => {
        splitDraft[filled[i]] = Math.max(0, (splitDraft[filled[i]] || 0) - 1);
        if (splitDraft[filled[i]] === 0) delete splitDraft[filled[i]];
        renderSplitModalBody(cur);
      });
      dstEl.appendChild(img);
    } else {
      const slot = document.createElement("div");
      slot.className = "sp-slot";
      slot.addEventListener("dragover", (e) => e.preventDefault());
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        if (splitDrag && draftCount < X) {
          splitDraft[splitDrag.type] = (splitDraft[splitDrag.type] || 0) + 1;
          splitDrag = null;
          renderSplitModalBody(cur);
        }
      });
      dstEl.appendChild(slot);
    }
  }

  // 确认按钮：无空余番号 → "没有空余番号"（=取消）；否则需填满 X
  if (!cur.freeFormation) {
    confirmBtn.textContent = "没有空余番号";
    confirmBtn.disabled = false;
    confirmBtn.dataset.mode = "cancel";
  } else {
    confirmBtn.textContent = "确认";
    confirmBtn.disabled = draftCount !== X;
    confirmBtn.dataset.mode = "confirm";
  }
}
let splitDrag = null;

function initSplitModal() {
  const backdrop = document.getElementById("split-backdrop");
  const confirmBtn = document.getElementById("split-confirm-btn");
  const cancelBtn = document.getElementById("split-cancel-btn");
  if (backdrop) backdrop.addEventListener("click", () => { /* 点背景不关闭（必须明确选择） */ });
  if (confirmBtn) confirmBtn.addEventListener("click", () => {
    const mode = confirmBtn.dataset.mode;
    if (mode === "cancel") { cancelMoveOrder(); return; }
    // 确认拆分 → 发 resolve_split
    const cur = SERVER_STATE.movePhase.cur;
    sendAction("resolve_split", { nation: currentNation, keep: { ...splitDraft } });
  });
  if (cancelBtn) cancelBtn.addEventListener("click", () => cancelMoveOrder());
}

/* ---------- 阶段3 移动提示条（仅当前指令所属国可见） ---------- */
function renderMovePrompt(g) {
  const el = document.getElementById("move-prompt");
  if (!el) return;
  const mp = g && g.movePhase;
  const cur = mp && mp.cur;
  // 仅当：阶段3实时 && 有当前指令 && 本国=该指令所属国 && 正在等待
  const show = !isViewingPast() && cur && mp.awaiting && cur.nation === currentNation
               && moveEffect && moveEffect.phase !== "fade" && moveEffect.phase !== "resolve";
  el.hidden = !show;

  const confirmBtn = document.getElementById("move-confirm-btn");
  const cancelBtn = document.getElementById("move-cancel-btn");
  const pinnedMsg = document.getElementById("move-pinned-msg");
  const pinned = !!(cur && cur.pinned);
  if (pinnedMsg) pinnedMsg.hidden = !(show && pinned);
  // 被压制：不显示"点击路线以移动"（无箭头可点），仅显示"部队被压制" + 取消
  if (confirmBtn) confirmBtn.hidden = pinned;
  if (cancelBtn) cancelBtn.textContent = pinned ? "取消该指令" : "点击此处取消指令";
}
function initMovePrompt() {
  const confirmBtn = document.getElementById("move-confirm-btn");
  const cancelBtn = document.getElementById("move-cancel-btn");
  if (confirmBtn) confirmBtn.addEventListener("click", () => confirmMoveOrder());
  if (cancelBtn) cancelBtn.addEventListener("click", () => cancelMoveOrder());
}

/* ---------- 用服务端 g.territories 同步本地 territoryOwners（缺失时退回 startingOwner）。
 * 服务端结构： g.territories[code] = { owner, embattled } */
function syncTerritoryOwnersFromServer(g) {
  if (!g || !g.territories) return;
  initTerritoryOwners();                 // 先确保默认值存在
  let changed = false;
  for (const code in g.territories) {
    const o = g.territories[code] ? (g.territories[code].owner || null) : null;
    if (territoryOwners[code] !== o) { territoryOwners[code] = o; changed = true; }
  }
  if (changed) {
    refreshAllIncomes();
    renderPanel();
    renderTerritoryCards();
    drawMap();                           // 海峡/铁路可达性依赖控制权，重绘
  }
}

let PHASE_KEYS = ["phase1_economy","phase2_planning","phase3_movement","phase4_combat","phase5_refit","phase6_morale","phase7_production"];

/* 当前视图是否为「回看过去阶段」（冻结只读） */
function isViewingPast() {
  if (!viewed || !SERVER_STATE) return false;
  return !(viewed.round === SERVER_STATE.round && viewed.idx === SERVER_STATE.phaseIndex);
}

/* 当前视图对应的阶段 key 与轮次 */
function viewedPhaseKey() {
  if (!SERVER_STATE) return null;
  if (isViewingPast()) return PHASE_KEYS[viewed.idx];
  return SERVER_STATE.phase;
}
function viewedRound() {
  if (!SERVER_STATE) return 1;
  return isViewingPast() ? viewed.round : SERVER_STATE.round;
}
/* 取某阶段的回看快照（若不存在 → null） */
function phaseHistoryOf(round, phaseKey) {
  const h = SERVER_STATE && SERVER_STATE.phaseHistory;
  return (h && h[round] && h[round][phaseKey]) || null;
}

/* 用服务端状态刷新左侧资源条（储量/收入/压力阈值） */
function syncNationInfoFromServer(g) {
  if (!g.nations) return;
  let changed = false;
  for (const id in g.nations) {
    const s = g.nations[id];
    const d = NATION_INFO[id];
    if (!d) continue;
    const res = s.resources || { oil: 0, iron: 0, osr: 0 };
    const inc = s.income || { oil: 0, iron: 0, osr: 0 };
    if (d.oil !== res.oil || d.iron !== res.iron || d.osr !== res.osr ||
        d.oilInc !== inc.oil || d.ironInc !== inc.iron || d.osrInc !== inc.osr) {
      d.oil = res.oil; d.iron = res.iron; d.osr = res.osr;
      d.oilInc = inc.oil; d.ironInc = inc.iron; d.osrInc = inc.osr;
      changed = true;
    }
  }
  for (const [id, state] of Object.entries(g.nations)) { const info = NATION_INFO[id]; if (!info) continue; if (info.stress !== state.stress || info.stressMax !== state.threshold || info.zone !== state.zone) changed = true; info.stress = state.stress; info.stressMax = state.threshold; info.zone = state.zone; }
  if (changed) renderPanel();
}

/* ---------- 7 格阶段进度条（可点击回看） ---------- */
function renderPhaseProgress(g) {
  const box = document.getElementById("phase-steps");
  if (!box) return;
  box.innerHTML = "";
  const curIdx = g.phaseIndex;
  const curRound = g.round;
  PHASE_KEYS.forEach((key, i) => {
    const el = document.createElement("div");
    el.className = "phase-step";
    // 是否已「发生」：本轮的更早阶段，或更早轮次的所有阶段
    const isPast = (i < curIdx) || (viewed && viewed.round < curRound);
    if (i === curIdx && !isViewingPast()) el.classList.add("current");
    else if (i < curIdx) el.classList.add("done");
    // 正在回看这一格
    if (isViewingPast() && viewed.idx === i && viewed.round === curRound) el.classList.add("viewing");
    if (viewed && viewed.round < curRound) el.classList.add("done");
    el.textContent = `${i + 1}${PHASE_SHORT[i]}`;
    el.title = `${PHASE_NAMES[key] || key}${isPast ? "（点击回看）" : ""}`;
    // 点击：回看已发生的阶段；点当前阶段 → 回到实时
    el.addEventListener("click", () => onPhaseStepClick(i));
    if (i === curIdx && !isViewingPast()) el.classList.add("clickable");
    else if (i < curIdx) el.classList.add("clickable");
    box.appendChild(el);
  });
}

function onPhaseStepClick(idx) {
  if (!SERVER_STATE) return;
  // 只有已发生（idx < 当前）或当前阶段可点
  if (idx > SERVER_STATE.phaseIndex) return;
  if (idx === SERVER_STATE.phaseIndex) {
    viewed = null;                 // 回到实时
  } else {
    viewed = { round: SERVER_STATE.round, idx };   // 回看
  }
  renderPhaseProgress(SERVER_STATE);
  renderConfirmButton(SERVER_STATE);
  renderActionContent(SERVER_STATE);
  renderNationConfirmHighlights(SERVER_STATE);
  renderTurnOrder(SERVER_STATE);
}

/* ---------- 回合顺位区（阶段2 步骤2-3） ----------
 *   进入步骤2（g.turnOrder.active）：地图上方中部向下展开，左上资源列表自动收起。
 *   上排：各国国旗（按竞价高→低），其上方显示竞价数字；已选完的暗下。
 *   下排：N 个位次格块；轮到本国时，空位高亮可点。
 *   全部选完：收起一半（只留下排），表示该阶段后续行动顺序。
 */
function renderTurnOrder(g) {
  const panel = document.getElementById("turn-order");
  if (!panel) return;
  const to = g && g.turnOrder;
  const inPhase2 = g && g.phase === "phase2_planning";
  // 仅阶段2 且已进入顺位步骤才显示
  if (!inPhase2 || !to || !to.active) {
    panel.hidden = true;
    panel.classList.remove("open", "collapsed");
    if (turnOrderAutoCollapsed) { turnOrderAutoCollapsed = false; autoCollapseNationRail(false); }
    return;
  }
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("open"));

  // 左上资源列表自动收起（收起自己资源条 + 其他国家）
  if (!turnOrderAutoCollapsed) {
    turnOrderAutoCollapsed = true;
    autoCollapseNationRail(true);
  }

  const picks = to.picks || [];
  const queue = to.queue || [];
  const bids = to.bids || {};
  const done = !!to.done;
  panel.classList.toggle("collapsed", done);

  // 已选完的国家集合（用于上排暗下）
  const pickedNations = new Set(picks.filter(Boolean));

  // ---- 上排：国旗 + 竞价（按 queue 顺序 = 竞价高→低）----
  const top = document.getElementById("to-bids");
  top.innerHTML = "";
  for (const id of queue) {
    const nat = NATIONS.find((n) => n.id === id);
    if (!nat) continue;
    const cell = document.createElement("div");
    cell.className = "to-bid";
    if (pickedNations.has(id)) cell.classList.add("done");
    const img = document.createElement("img");
    img.className = "to-bid-flag";
    img.src = `/assets/${nat.flag}`;
    img.alt = nat.name;
    cell.appendChild(img);
    const num = document.createElement("span");
    num.className = "to-bid-num";
    num.textContent = String(bids[id] ?? 0);
    cell.appendChild(num);
    top.appendChild(cell);
  }

  // ---- 下排：位次格块 ----
  const slotsEl = document.getElementById("to-slots");
  slotsEl.innerHTML = "";
  // 当前轮到本国吗？
  const myTurn = !done && queue[to.currentIndex] === currentNation;
  for (let i = 0; i < picks.length; i++) {
    const cell = document.createElement("div");
    cell.className = "to-slot";
    const no = document.createElement("span");
    no.className = "to-slot-no";
    no.textContent = String(i + 1);
    cell.appendChild(no);
    const owner = picks[i];
    if (owner) {
      const nat = NATIONS.find((n) => n.id === owner);
      if (nat) {
        const f = document.createElement("img");
        f.className = "to-slot-flag";
        f.src = `/assets/${nat.flag}`;
        f.alt = nat.name;
        cell.appendChild(f);
      }
    } else if (myTurn) {
      cell.classList.add("pickable");
      cell.title = `选择顺位 ${i + 1}`;
      cell.addEventListener("click", () => {
        sendAction("pick_slot", { nation: currentNation, slot: i });
      });
    }
    slotsEl.appendChild(cell);
  }

  // 若轮到某国选择且不是本国 → 温和提示（可选）
  // （此处不显示阻塞弹窗，仅通过高亮体现"轮到谁"）
}

/* ---------- 确认按钮（红 ↔ 黑红） ---------- */
function renderConfirmButton(g) {
  const btn = document.getElementById("confirm-btn");
  if (!btn) return;
  const past = isViewingPast();
  const me = g.nations && g.nations[currentNation];
  const confirmed = !!(me && me.confirmed);
  btn.classList.toggle("confirmed", confirmed);
  if (past || g.status === "finished" || me?.collapsed) {
    btn.textContent = past ? "回看中" : "已结束";
    btn.disabled = true;
    btn.classList.add("disabled");
    btn.title = "正在回看过去的阶段；点击进度条当前格返回";
  } else {
    btn.textContent = confirmed ? "已确认" : "确认";
    btn.disabled = !!g.blocker && !confirmed;
    btn.classList.remove("disabled");
    btn.title = confirmed ? "点击取消确认" : g.blocker || "点击确认";
  }
}

/* ---------- 左侧国家图标：已确认 → 高亮外框 ---------- */
function renderNationConfirmHighlights(g) {
  if (!g.nations) return;
  document.querySelectorAll(".nation-icon").forEach((ic) => {
    const id = ic.dataset.nation;
    const s = g.nations[id];
    ic.classList.toggle("confirmed", !!(s && s.confirmed));
  });
}

/* ---------- 行动页内容（阶段1 国民经济） ---------- */
const RES_LABEL = { oil: "石油", iron: "钢铁", osr: "其他" };
const RES_CLS = { oil: "oil", iron: "iron", osr: "osr" };

function resLine(kind, text, neg) {
  const row = document.createElement("div");
  row.className = "res-line";
  const dot = document.createElement("span");
  dot.className = `dot ${RES_CLS[kind]}`;
  row.appendChild(dot);
  const t = document.createElement("span");
  t.textContent = RES_LABEL[kind];
  t.style.color = "#b8ad8f";
  row.appendChild(t);
  const num = document.createElement("span");
  num.className = "res-num" + (neg ? " neg" : "");
  num.textContent = text;
  row.appendChild(num);
  return row;
}

function renderActionContent(g) {
  const box = document.getElementById("action-content");
  if (!box) return;
  box.innerHTML = "";

  const phaseKey = viewedPhaseKey();
  const round = viewedRound();
  const past = isViewingPast();
  const me = (g.nations && g.nations[currentNation]) || null;

  // 回看：优先用历史快照渲染（冻结态）
  if (past) {
    const snap = phaseHistoryOf(round, phaseKey);
    const tag = document.createElement("div");
    tag.className = "view-banner";
    tag.textContent = `回看 · 第 ${round} 轮 ${PHASE_NAMES[phaseKey] || phaseKey}（已冻结）`;
    box.appendChild(tag);
    if (snap) {
      if (window.renderSettlementReports && !["phase1_economy", "phase2_planning"].includes(phaseKey)) window.renderSettlementReports(box, snap.reports || []);
      else renderPhaseFromSnapshot(box, phaseKey, snap, me, true);
    } else {
      const empty = document.createElement("div");
      empty.className = "change-empty";
      empty.textContent = "（该阶段无历史记录）";
      box.appendChild(empty);
    }
    return;
  }

  // 实时：按当前阶段渲染
  if (phaseKey === "phase1_economy") {
    renderEconomyLive(box, g, me);
  } else if (phaseKey === "phase2_planning") {
    renderPlanningLive(box, g, me);
  } else if (phaseKey === "phase3_movement") {
    renderMovementLive(box, g);
  } else {
    const hint = document.createElement("div");
    hint.className = "change-empty";
    if (window.renderSettlementPhase) window.renderSettlementPhase(box, g);
    else { hint.textContent = "结算界面加载中"; box.appendChild(hint); }
  }
  if (window.renderPhaseTools) window.renderPhaseTools(box, g);
}

/* 由历史快照渲染（冻结只读） */
function renderPhaseFromSnapshot(box, phaseKey, snap, me, frozen) {
  const my = (me && snap.nations && snap.nations[currentNation]) || null;
  if (!my) {
    const empty = document.createElement("div");
    empty.className = "change-empty"; empty.textContent = "（无可显示数据）";
    box.appendChild(empty); return;
  }
  if (phaseKey === "phase1_economy") {
    renderEconomyInner(box, {
      gain: my.gain, settled: my.settled, changes: my.changes, hasSnapshot: snap.hasSnapshot,
    }, currentNation, frozen);
  } else if (phaseKey === "phase2_planning") {
    renderPlanningInner(box, { bid: my.bid, orders: my.orders }, null, frozen);
  }
}

/* ---------- 阶段1：国民经济 ---------- */
function renderEconomyLive(box, g, me) {
  if (!me) return;
  const income = me.income || { oil: 0, iron: 0, osr: 0 };
  const stRes  = me.resources || { oil: 0, iron: 0, osr: 0 };
  const changes = (g.changes && g.changes[currentNation]) || [];
  // 「结算后储量」= 当前储量 + 本回合收入（实时预览）
  const settled = {
    oil:  (stRes.oil  || 0) + ((currentNation === "china" || me.zone >= 4) ? 0 : income.oil),
    iron: (stRes.iron || 0) + (me.zone >= 4 ? 0 : income.iron),
    osr:  (stRes.osr  || 0) + (me.zone >= 4 ? 0 : income.osr),
  };
  renderEconomyInner(box, { gain: me.zone >= 4 ? {oil:0,iron:0,osr:0} : income, settled, changes, hasSnapshot: g.hasSnapshot }, currentNation, false);
}

function renderEconomyInner(box, data, nation, frozen) {
  const chinaOilZero = (nation === "china");
  // 1) 本回合新增资源量
  const s1 = document.createElement("div");
  s1.className = "econ-section";
  const t1 = document.createElement("div");
  t1.className = "econ-title"; t1.textContent = "本回合新增资源量";
  s1.appendChild(t1);
  for (const k of ["oil", "iron", "osr"]) {
    const v = (chinaOilZero && k === "oil") ? 0 : (data.gain[k] || 0);
    s1.appendChild(resLine(k, "+" + v));
  }
  box.appendChild(s1);

  // 2) 结算后的资源储量
  const s2 = document.createElement("div");
  s2.className = "econ-section";
  const t2 = document.createElement("div");
  t2.className = "econ-title"; t2.textContent = "结算后的资源储量";
  s2.appendChild(t2);
  for (const k of ["oil", "iron", "osr"]) {
    s2.appendChild(resLine(k, String(data.settled[k] || 0)));
  }
  box.appendChild(s2);

  // 3) 地块变化（第一回合不显示）
  const s3 = document.createElement("div");
  s3.className = "econ-section";
  const t3 = document.createElement("div");
  t3.className = "econ-title"; t3.textContent = "地块变化";
  s3.appendChild(t3);
  const changes = data.changes || [];
  if (!data.hasSnapshot || changes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "change-empty";
    empty.textContent = data.hasSnapshot ? "（本回合无导致资源变化的地块变化）" : "（第一回合，无变化记录）";
    s3.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "change-list";
    for (const ch of changes) list.appendChild(changeRow(ch));
    s3.appendChild(list);
  }
  box.appendChild(s3);
}

function changeRow(ch) {
  const row = document.createElement("div");
  const sign = (ch.delta.oil + ch.delta.iron + ch.delta.osr) < 0 ? "neg" : "pos";
  row.className = `change-row ${sign}`;

  const code = document.createElement("span");
  code.className = "ch-code"; code.textContent = ch.code;
  row.appendChild(code);

  const name = document.createElement("span");
  name.className = "ch-name";
  const nm = (TERRITORY_NAMES && TERRITORY_NAMES[ch.code]) || "";
  name.textContent = nm || ch.code;
  row.appendChild(name);

  const delta = document.createElement("span");
  delta.className = "ch-delta";
  for (const k of ["oil", "iron", "osr"]) {
    const v = ch.delta[k];
    if (v === 0) continue;                 // 跳过无变化的资源类型
    const item = document.createElement("span");
    item.style.display = "inline-flex";
    item.style.alignItems = "center";
    item.style.gap = "2px";
    const dot = document.createElement("span");
    dot.className = `dot ${RES_CLS[k]}`;
    item.appendChild(dot);
    const num = document.createElement("span");
    num.textContent = (v > 0 ? "+" : "") + v;   // 负数自带 -
    item.appendChild(num);
    delta.appendChild(item);
  }
  row.appendChild(delta);
  return row;
}

/* ============================================================
 * 阶段2：战略规划
 *   区块1：石油竞价（输入框 0~当前油数 + 减/加按钮）
 *   区块2：指令区（3×3 / 3×2 格块：写指令区 + 部队信息）
 * ============================================================ */

/* ============================================================
 * 阶段3：移动操作（行动面板内容对所有玩家相同）
 *   顶部：7 个国旗标签，顺序 = 本轮行动顺位（turnOrder.picks 的 slot 0→6）
 *   每个标签页：该国阶段2写下的指令列表（按顺序从上到下）
 *     每行 = 番号图标 | 番号组成 | → | 目标地块（不显示出发地）
 *   本阶段不能切换标签（只有回看时才能切）；默认显示第 1 位国家。
 * ============================================================ */
let moveTabIndex = 0;   // 当前显示的行动顺位第几位（0 起）

function renderMovementLive(box, g) {
  // 行动顺序：优先用本轮顺位 picks（slot 0→6 对应 1..7 顺位）
  const order = movementOrder(g);

  // ---- 标签行（7 国旗，按行动顺序；本阶段不可切换）----
  const tabs = document.createElement("div");
  tabs.className = "move-tabs";
  order.forEach((natId, i) => {
    const t = document.createElement("div");
    t.className = "move-tab" + (i === moveTabIndex ? " active" : "") + " locked";
    t.title = `${nationName(natId)}（第 ${i + 1} 顺位）`;
    const nat = NATIONS.find((n) => n.id === natId);
    if (nat) {
      const img = document.createElement("img");
      img.src = `/assets/${nat.flag}`;
      img.alt = nat.name;
      t.appendChild(img);
    }
    // 本阶段不允许切换（仅标记高亮，不绑定点击）
    tabs.appendChild(t);
  });
  box.appendChild(tabs);

  // ---- 当前位次国家的指令列表 ----
  const natId = order[moveTabIndex];
  const sec = document.createElement("div");
  sec.className = "econ-section";
  const title = document.createElement("div");
  title.className = "econ-title";
  title.textContent = `${nationName(natId)} · 行动指令（第 ${moveTabIndex + 1} 顺位）`;
  sec.appendChild(title);

  const list = document.createElement("div");
  list.className = "move-order-list";
  const orders = (g.nations && g.nations[natId] && g.nations[natId].orders) || [];
  // 已结算记录：{ orderIndex: result }
  const resolvedMap = {};
  const mp = g && g.movePhase;
  if (mp && mp.resolved) for (const r of mp.resolved) if (r.nation === natId) resolvedMap[r.orderIndex] = r.result;
  let any = false;
  orders.forEach((o, idx) => {
    if (!o || !o.formationId) return;
    any = true;
    const row = movementOrderRow(o);
    if (resolvedMap[idx] === "done") row.classList.add("done");           // 执行成功 → 变暗
    else if (resolvedMap[idx] === "cancel") row.classList.add("cancelled"); // 取消 → 变暗打叉
    list.appendChild(row);
  });
  if (!any) {
    const empty = document.createElement("div");
    empty.className = "change-empty";
    empty.textContent = "（无指令）";
    list.appendChild(empty);
  }
  sec.appendChild(list);
  box.appendChild(sec);
}

// 本轮行动顺序：turnOrder.picks（slot 0..6 → 1..7 顺位），去掉空位
function movementOrder(g) {
  const to = g && g.turnOrder;
  if (to && to.picks && to.picks.some(Boolean)) {
    return to.picks.filter(Boolean);
  }
  // 兜底：按 NATIONS 顺序
  return NATIONS.map((n) => n.id);
}

// 阶段3 指令行：番号图标 | 番号组成 | → | 目标地块（不显示出发地）
function movementOrderRow(o) {
  const row = document.createElement("div");
  row.className = "move-order-row";

  const u = (UNITS || []).find((x) => x.id === o.formationId);
  // 番号图标
  const faceBox = document.createElement("div");
  faceBox.className = "row-face-box";
  if (u) {
    const img = document.createElement("img");
    img.className = "row-face" + (u.domain === "sea" ? " sea" : "");
    img.src = `/assets/${u.face}`;
    img.alt = u.id;
    faceBox.appendChild(img);
  }
  row.appendChild(faceBox);

  // 番号组成（兵种图标）
  const comp = document.createElement("div");
  comp.className = "move-order-comp row-units" + (u && u.domain === "sea" ? " naval" : "");
  if (u) {
    for (const [type, count] of Object.entries(u.units || {})) {
      for (let i = 0; i < count; i++) {
        const ic = document.createElement("img");
        ic.className = "u-icon";
        ic.src = `/assets/${UNIT_ICON[type] || "Infantry.jpg"}`;
        ic.alt = type;
        ic.title = type;
        comp.appendChild(ic);
      }
    }
  }
  row.appendChild(comp);

  // 箭头
  const arrow = document.createElement("span");
  arrow.className = "order-arrow";
  arrow.textContent = "→";
  row.appendChild(arrow);

  // 目标地块（号码 + 名称）
  const dest = document.createElement("span");
  dest.className = "move-order-dest";
  if (o.dest) {
    dest.textContent = `${o.dest} ${(TERRITORY_NAMES && TERRITORY_NAMES[o.dest]) || ""}`.trim();
  } else {
    dest.textContent = "—";
    dest.classList.add("none");
  }
  row.appendChild(dest);

  return row;
}

function renderPlanningLive(box, g, me) {
  if (!me) return;
  // 已进入顺位步骤 → 行动页只显示提示（顺位 UI 在地图上方）
  const to = g && g.turnOrder;
  if (to && to.active) {
    const hint = document.createElement("div");
    hint.className = "change-empty";
    const isMine = !to.done && to.queue[to.currentIndex] === currentNation;
    hint.textContent = to.done
      ? "回合顺位已确定（见地图上方），等待进入下一阶段。"
      : (isMine ? "轮到你选择行动顺位（见地图上方）。"
                : `等待 ${nationName(to.queue[to.currentIndex])} 选择顺位…`);
    box.appendChild(hint);
    return;
  }
  renderPlanningInner(box, { bid: me.bid || 0, orders: me.orders || [] }, g, false);
}

function renderPlanningInner(box, data, g, frozen) {
  const nation = currentNation;
  const oilMax = (g && g.nations && g.nations[nation] && g.nations[nation].resources.oil) || 0;

  /* ---- 区块1：石油竞价 ---- */
  const sec1 = document.createElement("div");
  sec1.className = "econ-section";
  const t1 = document.createElement("div");
  t1.className = "econ-title"; t1.textContent = "石油竞价";
  sec1.appendChild(t1);

  const bidRow = document.createElement("div");
  bidRow.className = "bid-row";
  const minus = document.createElement("button");
  minus.className = "bid-btn"; minus.textContent = "−"; minus.type = "button";
  const input = document.createElement("input");
  input.className = "bid-input"; input.type = "text"; input.inputMode = "numeric";
  input.value = String(data.bid || 0);
  const slash = document.createElement("span");
  slash.className = "bid-slash"; slash.textContent = "/";
  const cap = document.createElement("span");
  cap.className = "bid-cap"; cap.textContent = String(oilMax);
  const plus = document.createElement("button");
  plus.className = "bid-btn"; plus.textContent = "+"; plus.type = "button";

  if (frozen) { minus.disabled = true; plus.disabled = true; input.disabled = true; }

  const clamp = (v) => Math.max(0, Math.min(oilMax, v));
  const commit = (v) => {
    v = clamp(Math.round(Number(v) || 0));
    input.value = String(v);
    sendAction("set_bid", { nation, value: v });
  };
  minus.addEventListener("click", () => commit((Number(input.value) || 0) - 1));
  plus.addEventListener("click", () => commit((Number(input.value) || 0) + 1));
  input.addEventListener("change", () => commit(input.value));
  input.addEventListener("blur", () => commit(input.value));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(input.value); input.blur(); } });

  bidRow.appendChild(minus);
  bidRow.appendChild(input);
  bidRow.appendChild(slash);
  bidRow.appendChild(cap);
  bidRow.appendChild(plus);
  sec1.appendChild(bidRow);
  box.appendChild(sec1);

  /* ---- 区块2：指令区（精简：番号 → 目的地） ---- */
  const sec2 = document.createElement("div");
  sec2.className = "econ-section";
  const t2 = document.createElement("div");
  t2.className = "econ-title";
  const limit = (nation === "china" || nation === "italy") ? 6 : 9;
  t2.textContent = `指令区（最多 ${limit} 个）`;
  sec2.appendChild(t2);

  const grid = document.createElement("div");
  grid.className = "order-grid" + (limit === 6 ? " limit-6" : "");
  for (let i = 0; i < limit; i++) {
    grid.appendChild(renderOrderCell(nation, i, data.orders[i] || null, g, frozen));
  }
  sec2.appendChild(grid);
  box.appendChild(sec2);

  /* ---- 区块3：本国全部部队（同「部队」标签页） ---- */
  const sec3 = document.createElement("div");
  sec3.className = "econ-section";
  const t3 = document.createElement("div");
  t3.className = "econ-title";
  t3.textContent = "我方部队";
  sec3.appendChild(t3);
  const unitBox = document.createElement("div");
  unitBox.className = "planning-units";
  renderPlanningUnits(unitBox);
  sec3.appendChild(unitBox);
  box.appendChild(sec3);

  /* ---- 区块4：进入步骤2（展示竞价并重排顺位） ---- */
  if (!frozen) {
    const sec4 = document.createElement("div");
    sec4.className = "econ-section to-trigger-section";
    const btn = document.createElement("button");
    btn.className = "to-trigger-btn";
    btn.type = "button";
    btn.textContent = "完成指令与竞价 → 展示竞价并重排回合顺位";
    btn.addEventListener("click", () => sendAction("start_turn_order", {}));
    sec4.appendChild(btn);
    box.appendChild(sec4);
  }
}

/* 罗列本国所有部队（与「部队」标签页同样的分组与行样式）
 *   行动页版本：可拖拽、双击选中；已填入指令的部队变灰不可拖 */
function renderPlanningUnits(containerEl) {
  containerEl.innerHTML = "";
  const nation = currentNation;
  const mine = (UNITS || []).filter((u) => u.nation === nation);
  const used = usedFormationIds(nation);
  for (const domain of DOMAIN_ORDER) {
    const list = mine.filter((u) => u.domain === domain);
    if (list.length === 0) continue;
    list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    const group = document.createElement("div");
    group.className = "unit-group";
    const title = document.createElement("div");
    title.className = "unit-group-title";
    title.textContent = `${DOMAIN_CN[domain]} · ${list.length} 个番号`;
    group.appendChild(title);
    for (const u of list) {
      group.appendChild(renderActiveRow(u, { draggable: true, disabled: used.has(u.id) }));
    }
    containerEl.appendChild(group);
  }
  if (!containerEl.children.length) {
    const ph = document.createElement("div");
    ph.className = "order-info-empty";
    ph.textContent = "（无部队）";
    containerEl.appendChild(ph);
  }
}

/* 双击选中本国部队 → 关注 + 选中 + 自动填入新指令 + 记录地图点选
 *   （地图与行动页部队列表双击共用此入口，行为一致） */
function focusSelectAndFillOrder(unit) {
  if (!unit) return;
  const p = positions && positions[unit.code];
  if (p) focus(p.x, p.y);              // 关注：镜头移动
  selectUnitAndFillOrder(unit);         // 选中 + 填指令
}

/* 双击选中本国部队 → 关注 + 选中（不填指令）
 *   用于「部队」标签页等非行动页的部队列表。 */
function focusSelectUnit(unit) {
  if (!unit) return;
  const p = positions && positions[unit.code];
  if (p) focus(p.x, p.y);              // 关注：镜头移动
  selectUnit(unit.code, unit);          // 选中：描框 + 可达区块
  mapPickOrder = null;                  // 非行动页：不参与地图点选填地块
}

/* 双击选中本国部队 → 自动填入一个新指令的番号区（选第一个空指令格）
 *   并记录 mapPickOrder：此后在地图上点击"该部队可达区块"的标点即填入其地块。 */
function selectUnitAndFillOrder(unit) {
  const nation = currentNation;
  if (!unit || unit.nation !== nation) return;
  // 同时执行"选中"（高亮+可达区块）
  selectUnit(unit.code, unit);
  // 找到第一个空指令格
  const me = SERVER_STATE && SERVER_STATE.nations && SERVER_STATE.nations[nation];
  const orders = (me && me.orders) || [];
  const used = usedFormationIds(nation);
  if (used.has(unit.id)) {                       // 已在指令中 → 不重复填，但可点选其地块
    const idx = orders.findIndex((o) => o && o.formationId === unit.id);
    if (idx >= 0) mapPickOrder = { nation, index: idx };
    return;
  }
  let slot = -1;
  for (let i = 0; i < orders.length; i++) { if (!orders[i] || !orders[i].formationId) { slot = i; break; } }
  if (slot < 0) return;                           // 无空格
  mapPickOrder = { nation, index: slot };         // 记录：地图点可达标点 → 填此格地块
  sendAction("set_order", { nation, index: slot, order: { formationId: unit.id, dest: null } });
}

/* 单个指令格块： [番号区] → [地块区] + 清除
 *   番号区填入方式：①文本输入(数字)回车 ②点击→下拉选择 ③从部队列表拖入 ④双击选中本国部队自动填入
 *   填入后：番号区改显示番号标识；地块区下拉 = 该部队一回合可达的区块（号码+名称）
 */
function renderOrderCell(nation, index, order, g, frozen) {
  const cell = document.createElement("div");
  cell.className = "order-cell";
  cell.dataset.index = String(index);
  const filled = !!(order && order.formationId);
  if (!filled) cell.classList.add("empty");

  // ---- 拖拽重排指令（顺序：左上→右下递增） ----
  if (!frozen && filled) {
    cell.draggable = true;
    cell.classList.add("order-draggable");
    cell.addEventListener("dragstart", (e) => {
      orderDragFrom = index;
      cell.classList.add("order-dragging");
      try { e.dataTransfer.setData("text/plain", String(index)); } catch (_) {}
      e.dataTransfer.effectAllowed = "move";
      e.stopPropagation();
    });
    cell.addEventListener("dragend", () => { cell.classList.remove("order-dragging"); orderDragFrom = null; });
  }
  if (!frozen) {
    cell.addEventListener("dragover", (e) => {
      if (orderDragFrom === null || orderDragFrom === index) return;
      e.preventDefault(); cell.classList.add("order-drop-ok");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("order-drop-ok"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault(); cell.classList.remove("order-drop-ok");
      if (orderDragFrom === null || orderDragFrom === index) return;
      const from = orderDragFrom, to = index;
      orderDragFrom = null;
      sendAction("move_order", { nation, from, to });
    });
  }

  const head = document.createElement("div");
  head.className = "order-head";
  const no = document.createElement("span");
  no.className = "order-no"; no.textContent = `#${index + 1}`;
  head.appendChild(no);

  // ---- 番号区 ----
  const slot = document.createElement("div");
  slot.className = "order-slot";
  slot.dataset.index = String(index);

  if (filled) {
    // 已填：显示番号标识（图标），点击可清除/重选
    const u = (UNITS || []).find((x) => x.id === order.formationId);
    slot.classList.add("filled");
    if (u) {
      const img = document.createElement("img");
      img.className = "order-slot-face" + (u.domain === "sea" ? " sea" : "");
      img.src = `/assets/${u.face}`;
      img.alt = u.id;
      img.title = `${u.code} · ${u.domain === "air" ? "空" : u.domain === "sea" ? "海" : "陆"}${u.num}`;
      slot.appendChild(img);          // 图标自带编号，无需额外文本
    } else {
      slot.textContent = order.formationId;
    }
    if (!frozen) {
      slot.title = "点击移除该番号";
      slot.addEventListener("click", () => sendAction("set_order", { nation, index, order: null }));
    }
  } else {
    // 未填：番号标识区（点击弹出下拉 / 可直接输入数字 / 可拖入）
    const pick = document.createElement("div");
    pick.className = "order-slot-pick";
    pick.textContent = "番号";
    pick.title = "点击选择 / 输入数字回车 / 从下方列表拖入";
    slot.appendChild(pick);

    if (!frozen) {
      attachOrderSlotInput(nation, index, order, slot, pick);
    }
  }
  head.appendChild(slot);

  // 箭头
  const arrow = document.createElement("span");
  arrow.className = "order-arrow"; arrow.textContent = "→";
  head.appendChild(arrow);

  // ---- 地块区（可达区块：号码+名称；支持直接输入 / 下拉选 / 地图点选） ----
  const destWrap = document.createElement("div");
  destWrap.className = "order-dest-wrap";

  const destInput = document.createElement("input");
  destInput.className = "order-dest-input";
  destInput.type = "text";
  destInput.placeholder = "目的地";
  destInput.autocomplete = "off";
  // 显示为「号码 名称」
  const destLabel = (c) => c ? `${c} ${(TERRITORY_NAMES && TERRITORY_NAMES[c]) || ""}`.trim() : "";
  destInput.value = (order && order.dest) ? destLabel(order.dest) : "";

  // 可达区块列表（供下拉 + 校验）
  let reachList = [];
  if (filled) {
    const u = (UNITS || []).find((x) => x.id === order.formationId);
    if (u) {
      const { reach } = reachableFrom(u.code, u.domain, u.nation || nation);
      reachList = [...reach].filter((c) => positions[c])
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
  }
  // datalist：既支持下拉选择，又支持直接输入
  const listId = `destlist-${index}`;
  const datalist = document.createElement("datalist");
  datalist.id = listId;
  for (const c of reachList) {
    const o = document.createElement("option");
    o.value = destLabel(c);          // 选它即填入「号码 名称」
    datalist.appendChild(o);
  }
  destInput.setAttribute("list", listId);

  const parseDest = (raw) => {
    const s = String(raw || "").trim();
    if (!s) return null;
    // 取开头的号码（如 "G1 大德意志" → "G1"；也接受直接输入 "G1"）
    const m = s.match(/^([A-Za-z]+\d+)/);
    if (!m) return null;
    const code = m[1].toUpperCase();
    return reachList.includes(code) ? code : null;   // 必须在可达集内
  };

  if (frozen || !filled) destInput.disabled = true;
  const commitDest = () => {
    if (!order || !order.formationId) return;
    const code = parseDest(destInput.value);
    if (code) {
      destInput.value = destLabel(code);
      sendAction("set_order", { nation, index, order: { formationId: order.formationId, dest: code } });
    } else if (!destInput.value.trim()) {
      sendAction("set_order", { nation, index, order: { formationId: order.formationId, dest: null } });
    } else {
      // 非法输入 → 提示"区块不可达"并还原为当前值
      showToast("区块不可达");
      destInput.value = (order.dest) ? destLabel(order.dest) : "";
    }
  };
  destInput.addEventListener("change", commitDest);
  destInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { commitDest(); destInput.blur(); } });
  destInput.addEventListener("focus", () => { pendingDestSlot = { nation, index }; });   // 供地图点选
  destInput.addEventListener("blur", () => { if (pendingDestSlot && pendingDestSlot.index === index) pendingDestSlot = null; });

  destWrap.appendChild(destInput);
  destWrap.appendChild(datalist);
  head.appendChild(destWrap);

  // 清除按钮
  const clr = document.createElement("button");
  clr.className = "order-clear"; clr.textContent = "✕"; clr.type = "button"; clr.title = "清除该指令";
  if (frozen || !filled) clr.disabled = true;
  clr.addEventListener("click", () => sendAction("set_order", { nation, index, order: null }));
  head.appendChild(clr);

  cell.appendChild(head);
  return cell;
}

/* 给「未填番号区」绑定：点击→下拉 / 文本输入回车 / 拖入 */
function attachOrderSlotInput(nation, index, order, slot, pick) {
  const mine = (UNITS || []).filter((u) => u.nation === nation).sort((a, b) => {
    const ord = { air: 0, land: 1, sea: 2 };
    return (ord[a.domain] - ord[b.domain]) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
  });
  const usedIds = usedFormationIds(nation);         // 已被其他指令占用的番号

  // ① 文本输入：双击番号区 → 变成 input，输入数字回车确认（匹配该国的番号 num）
  pick.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startTextEntry();
  });
  // ② 点击 → 弹出下拉
  pick.addEventListener("click", () => openSlotDropdown());
  // ③ 拖入
  slot.addEventListener("dragover", (e) => {
    if (dragUnitPayload && dragUnitPayload.nation === nation) { e.preventDefault(); slot.classList.add("drop-ok"); }
  });
  slot.addEventListener("dragleave", () => slot.classList.remove("drop-ok"));
  slot.addEventListener("drop", (e) => {
    e.preventDefault(); slot.classList.remove("drop-ok");
    if (!dragUnitPayload || dragUnitPayload.nation !== nation) return;
    const fid = dragUnitPayload.id;
    dragUnitPayload = null;
    if (usedIds.has(fid)) return;                    // 已用 → 忽略
    sendAction("set_order", { nation, index, order: { formationId: fid, dest: null } });
  });

  function startTextEntry() {
    const inp = document.createElement("input");
    inp.className = "order-slot-text";
    inp.type = "text"; inp.inputMode = "numeric";
    inp.placeholder = "编号";
    pick.style.display = "none";
    slot.insertBefore(inp, pick);
    inp.focus();
    const finish = (commit) => {
      if (commit) {
        const raw = inp.value.trim();
        if (raw) {
          const num = parseInt(raw, 10);
          // 该国全部番号里按 num 找（不限"未用"）
          const byNum = mine.filter((x) => x.num === num);
          if (byNum.length === 0) {
            showToast("部队不存在");                    // ① 非本国现役番号
          } else {
            const free = byNum.find((x) => !usedIds.has(x.id));
            if (free) {
              sendAction("set_order", { nation, index, order: { formationId: free.id, dest: null } });
            } else {
              showToast("已有指令");                    // ② 该番号已有指令
            }
          }
        }
      }
      inp.remove(); pick.style.display = "";
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    inp.addEventListener("blur", () => finish(false));
  }

  function openSlotDropdown() {
    // 用原生 <select> 作为下拉（简单可靠）：临时放入 slot
    const sel = document.createElement("select");
    sel.className = "order-slot-select";
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "选择部队…";
    sel.appendChild(o0);
    for (const u of mine) {
      const o = document.createElement("option");
      o.value = u.id;
      o.disabled = usedIds.has(u.id);                // 已用番号不可选
      o.textContent = `${u.code} · ${u.domain === "air" ? "空" : u.domain === "sea" ? "海" : "陆"}${u.num}${usedIds.has(u.id) ? "（已用）" : ""}`;
      sel.appendChild(o);
    }
    pick.style.display = "none";
    slot.insertBefore(sel, pick);
    sel.focus();
    const finish = () => { sel.remove(); pick.style.display = ""; };
    sel.addEventListener("change", () => {
      const fid = sel.value;
      if (fid && !usedIds.has(fid)) sendAction("set_order", { nation, index, order: { formationId: fid, dest: null } });
      else finish();
    });
    sel.addEventListener("blur", finish);
  }
}

/* 某国已被指令占用的番号 id 集合 */
function usedFormationIds(nation) {
  const set = new Set();
  const me = SERVER_STATE && SERVER_STATE.nations && SERVER_STATE.nations[nation];
  const orders = (me && me.orders) || [];
  for (const o of orders) if (o && o.formationId) set.add(o.formationId);
  return set;
}


/* ============================================================
 * 三·B、部队栏目（右侧「部队」页）
 *   · 顶部：剩余番号（空/海/陆 三类，显示 "图标×N"，N 可为 0）
 *   · 小格挡（分隔虚线）
 *   · 现役单位：按 空→陆→海 分组，每组最左有一个类别标识
 *       每行 = [类别标识] 番号图标 | 位置(标号+中文名, 两行) | 部队罗列
 *       陆空军：兵种图标直接横向罗列；海军：4列×2行网格(≤4 居中)
 * ============================================================ */
const DOMAIN_CN = { air: "空军", land: "陆军", sea: "海军" };
const DOMAIN_ORDER = ["air", "land", "sea"];
const UNIT_ICON = {
  infantry: "Infantry.jpg", artillery: "Artillery.jpg", armor: "Armor.jpg",
  fighter: "Fighter.jpg", bomber: "Bomber.jpg", submarine: "Submarine.jpg",
  cruiser: "Cruiser.jpg", carrier: "Carrier.jpg", battleship: "Battleship.jpg",
};
const NATION_ASSET = {
  britain: "Britain", germany: "Germany", japan: "Japan", usa: "USA",
  soviet: "Soviet", italy: "Italy", china: "China",
};

let FORMATIONS_ALL = null;   // 全部素材番号 { nation: { air:[..], sea:[..], land:[..] } }
let TERRITORY_NAMES = {};    // 地块中文名 { code: 中文名 }

/* ---------- 特殊移动：海峡/运河（通道）+ 铁路 ---------- */
let CHANNELS = null;         // [{id,name,controllerTerritories,seaZones:[a,b]}]
let RAILROADS = null;        // { code: [邻接code] }  权威铁路网络

function loadChannels() {
  return fetch("/channels.json")
    .then((r) => r.json())
    .then((d) => { CHANNELS = d || []; initChannelIndex(); drawMap(); })
    .catch((e) => console.warn("[channels] 加载失败", e));
}
function loadRailroads() {
  return fetch("/railroads.json")
    .then((r) => r.json())
    .then((d) => { RAILROADS = d || {}; drawMap(); })
    .catch((e) => console.warn("[railroads] 加载失败", e));
}

// 索引：某海区对 (低,高) 有序键 → 通道；便于快速判断"这条海-海边是否被通道管辖"
let channelBySeaPair = null;
function initChannelIndex() {
  channelBySeaPair = {};
  for (const ch of (CHANNELS || [])) {
    const [a, b] = ch.seaZones;
    channelBySeaPair[seaPairKey(a, b)] = ch;
  }
}
function seaPairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

// 通道对某国是否可通行：其所有控制领土均须由该国或其盟友控制（无主/敌方 → 关闭）
function channelOpenFor(ch, nation) {
  if (!ch) return true;                       // 非通道边 → 不受限
  const allies = allianceOf(nation);          // Set（含自身）
  for (const c of ch.controllerTerritories) {
    const o = ownerOf(c);
    if (!o || !allies.has(o)) return false;
  }
  return true;
}

// 某国阵营（含自身）。alliance 数据在 UNITS 上，国别→阵营直接映射。
const NATION_ALLIANCE = {
  germany: "axis", italy: "axis", japan: "axis",
  britain: "allied", usa: "allied", soviet: "allied", china: "allied",
};
function allianceOf(nation) {
  const a = NATION_ALLIANCE[nation];
  const s = new Set([nation]);
  if (a) for (const n in NATION_ALLIANCE) if (NATION_ALLIANCE[n] === a) s.add(n);
  return s;
}

/* 海军/运兵船在"海-海"边上的通行判断：
 *   若该边被某通道管辖，则仅当通道对 nation 开放时可通过。 */
function seaEdgeOpen(a, b, nation) {
  const ch = channelBySeaPair && channelBySeaPair[seaPairKey(a, b)];
  return channelOpenFor(ch, nation);
}

/* 供特定国视角计算的海上邻接：
 *   = adjacentTo（常规海上相邻）
 *   + 被「对该国开放的通道」连通的两海区（通道是额外边，两海区在 adjacentTo 里并不相邻）
 *   通道对某国关闭 → 该额外边不存在（敌方海军/运兵船不能通过）。 */
function navalNeighbors(code, nation) {
  const map = territoryMap();
  const rec = map[code];
  if (!rec) return [];
  const base = (rec.adjacentTo || []).slice();
  // 加上通道提供的额外连通（仅海-海通道）
  for (const ch of (CHANNELS || [])) {
    const [a, b] = ch.seaZones;
    let other = null;
    if (a === code) other = b;
    else if (b === code) other = a;
    else continue;
    if (!map[other] || map[other].type !== "sea") continue;
    if (!base.includes(other) && channelOpenFor(ch, nation)) base.push(other);
  }
  return base;
}

/* 判断某条"海-海"边是否只能经由通道建立（用于虚线连线）：
 *   返回通道对象（若该边由通道提供），否则 null。 */
function channelForSeaEdge(a, b) {
  if (!channelBySeaPair) return null;
  return channelBySeaPair[seaPairKey(a, b)] || null;
}


function loadFormationsAll() {
  return fetch("/formations_all.json")
    .then((r) => r.json())
    .then((d) => { FORMATIONS_ALL = d; renderUnitPanel(); })
    .catch((e) => console.warn("[formations_all] 加载失败", e));
}

function loadTerritoryNames() {
  return fetch("/territory_names_cn.json")
    .then((r) => r.json())
    .then((d) => { TERRITORY_NAMES = d || {}; renderUnitPanel(); renderTerritoryCards(); })
    .catch((e) => console.warn("[territory_names_cn] 加载失败", e));
}

function loadCards() {
  return fetch("/cards.json")
    .then((r) => r.json())
    .then((d) => { CARDS = d; return loadTerritories(); })
    .catch((e) => console.warn("[cards] 加载失败", e));
}

// 地块数据（含 startingOwner）：用于地块卡的所有权
function loadTerritories() {
  return fetch("/territories_full.json")
    .then((r) => r.json())
    .then((d) => {
      TERRITORIES = d || [];
      territoryOwners = null;          // 重新初始化
      refreshAllIncomes();             // 依据地块归属+交战状态派生各国收入
      renderPanel();                   // 刷新左侧资源条（含收入 +X）
      renderTerritoryCards();
    })
    .catch((e) => console.warn("[territories_full] 加载失败", e));
}

/* ============================================================
 * 三·D、地块卡（两列）
 *   语义：地块标签页 = 「该国当前拥有的地块」
 *     · 每个地块同时至多一个拥有者（可为 0 = 中立/无人）
 *     · 左列 = 本国初始地块卡中「仍被本国拥有」的（按编号升序）
 *     · 右列 = 由本国「获得」的非本国初始卡（按获得先后顺序）
 *         含被夺取的别国初始卡；被翻面的卡也在此列
 *     · 本国的初始卡若被别国夺走 → 离开本国地块页
 *   所有权来源：territoryOwners[code] ；默认取 startingOwner，可被引擎更新
 * ============================================================ */
let CARDS = null;               // cards.json
let TERRITORIES = null;         // territories_full.json（含 startingOwner）
let territoryOwners = null;     // { code: nation|null }  当前拥有者
let acquiredOrder = {};         // { code: seq }  某卡被本国获得的先后顺序
let flippedCards = new Set();   // 已翻面的地块卡 code
let territoryCardState = null;  // { left:[item], right:[item] }
const TC_OVERLAP = 0.60;        // 下一张遮住上一张的比例（下 60%）

// 初始化所有权：默认 = startingOwner（引擎后续可覆写）
//   注意：「neutral」表示无主中立地块，不属于任何玩家 → 记为 null
function initTerritoryOwners() {
  if (territoryOwners) return;
  territoryOwners = {};
  for (const t of (TERRITORIES || [])) {
    const o = t.startingOwner;
    territoryOwners[t.code] = (!o || o === "neutral") ? null : o;
  }
}

function ownerOf(code) {
  initTerritoryOwners();
  return territoryOwners[code] || null;
}

// 由本国获得的非本国初始卡：记录获得顺序
function markAcquired(code, seq) {
  if (acquiredOrder[code] == null) acquiredOrder[code] = seq;
}

// item = { nation, num, code, front, back, faceUp, enteredAt, initialOwner }
function buildTerritoryCards() {
  if (!CARDS) return;
  initTerritoryOwners();
  const nation = currentNation;
  const left = [];
  const right = [];
  let seq = 0;
  for (const [nat, info] of Object.entries(CARDS)) {
    for (const c of info.cards) {
      const owner = ownerOf(c.code);
      if (owner !== nation) continue;         // 不归本国 → 不出现在本国页面
      const isFlipped = flippedCards.has(c.code);
      const item = {
        nation: nat, num: c.num, code: c.code,
        front: c.front, back: c.back,
        faceUp: !isFlipped,
        initialOwner: nat,                     // 卡片国别 = 初始拥有者
        enteredAt: seq++,
        territory: (TERRITORY_NAMES && c.code) ? TERRITORY_NAMES[c.code] : null,
      };
      if (nat === nation && !isFlipped) {
        left.push(item);                       // 本国初始卡（仍拥有且未翻面）
      } else {
        // 非本国初始卡，或已翻面的本国卡 → 右列（记获得/翻面顺序）
        if (acquiredOrder[c.code] == null) markAcquired(c.code, seq);
        item.acqAt = acquiredOrder[c.code];
        right.push(item);
      }
    }
  }
  left.sort((a, b) => a.num - b.num);          // 左列：按编号升序
  right.sort((a, b) => a.acqAt - b.acqAt);     // 右列：按获得先后
  territoryCardState = { left, right };
}

function renderTerritoryCards() {
  const box = document.getElementById("territory-cards");
  if (!box) return;
  if (!CARDS) return;
  buildTerritoryCards();
  const { left, right } = territoryCardState;

  // 卡尺寸：按容器宽度分两列，留 gap
  const gap = 10;
  const totalW = box.clientWidth || 340;
  const colW = Math.max(60, (totalW - gap) / 2);
  const cardH = Math.round(colW * 347 / 493);
  const step = Math.round(cardH * (1 - TC_OVERLAP));   // 每增加一张的下移量

  renderCol(document.getElementById("tc-left"), left, colW, cardH, step);
  renderCol(document.getElementById("tc-right"), right, colW, cardH, step);
}

function renderCol(col, items, colW, cardH, step) {
  if (!col) return;
  col.innerHTML = "";
  col.style.width = colW + "px";
  col.style.height = (items.length ? (items.length - 1) * step + cardH : 0) + "px";
  items.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "tc-card" + (it.faceUp ? "" : " flipped");
    el.style.top = (i * step) + "px";
    el.style.width = colW + "px";
    el.style.height = cardH + "px";
    el.style.zIndex = String(i + 1);
    el.dataset.code = it.code;
    el.title = `${it.code}${it.territory ? " " + it.territory : ""}`;
    // 双击地块卡 → 关注 + 高亮该地块及其相邻区块
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (positions && positions[it.code]) setTerritoryFocus(it.code);
    });
    const img = document.createElement("img");
    img.src = `/cards/${it.faceUp ? it.front : (it.back || it.front)}`;
    img.alt = it.code;
    el.appendChild(img);
    col.appendChild(el);
  });
}

// 类别标识（空/陆/海 小标签）
function catBadge(domain) {
  const el = document.createElement("span");
  el.className = `cat-badge ${domain}`;
  el.textContent = DOMAIN_CN[domain];
  return el;
}

// 剩余番号：同一行内三组（空/海/陆），每组 = 图标 × N（N 可为 0）
function renderReserve(container) {
  container.innerHTML = "";
  const nation = currentNation;
  const all = (FORMATIONS_ALL && FORMATIONS_ALL[nation]) || {};
  const asset = NATION_ASSET[nation];

  for (const domain of ["air", "sea", "land"]) {   // 空 → 海 → 陆
    const allNums = all[domain] || [];
    const usedNums = new Set(UNITS.filter(u => u.nation === nation && u.domain === domain).map(u => u.num));
    const remain = allNums.filter(n => !usedNums.has(n)).length;

    const cell = document.createElement("div");
    cell.className = "unit-reserve-cell";

    // 该类的一个代表图标（取第一个素材番号）
    const sampleNum = allNums[0];
    if (sampleNum !== undefined) {
      const cap = domain === "land" ? "Land" : (domain === "air" ? "Air" : "Sea");
      const img = document.createElement("img");
      img.className = "res-icon" + (domain === "sea" ? " sea" : "");
      img.src = `/assets/${asset}_${cap}_${sampleNum}.png`;
      img.alt = domain;
      cell.appendChild(img);
    }

    const cnt = document.createElement("span");
    cnt.className = "res-count";
    cnt.textContent = `× ${remain}`;
    cell.appendChild(cnt);

    container.appendChild(cell);
  }
}

// 现役单位一行
function renderActiveRow(u, opts) {
  opts = opts || {};
  const row = document.createElement("div");
  row.className = "unit-row";
  row.appendChild(unitRowContent(u, false));
  // 右击 / 长按该行 → 打开"合并与拆分部队"弹窗
  attachRowMergeHandlers(row, u);
  // 行动页部队列表：可拖拽番号；双击 = 关注+选中(+填指令)
  if (opts.draggable) {
    row.classList.add("unit-row-draggable");
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      dragUnitPayload = { id: u.id, nation: u.nation };
      row.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", u.id); } catch (_) {}
      e.dataTransfer.effectAllowed = "copy";
    });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); dragUnitPayload = null; });
    row.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      focusSelectAndFillOrder(u);        // 行动页：关注 + 选中 + 填指令
    });
  } else if (opts.focusSelect) {
    // 「部队」标签页等：双击 = 关注 + 选中（不填指令）
    row.classList.add("unit-row-draggable");
    row.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      focusSelectUnit(u);
    });
  }
  if (opts.disabled) {
    row.classList.add("unit-row-used");
    row.draggable = false;
  }
  return row;
}

/* 一行部队信息（番号图标 | 地块号 | 地名 | 兵种图标）
 *   compact=true 用于指令格块内（尺寸更紧凑） */
function unitRowContent(u, compact) {
  const frag = document.createDocumentFragment();

  // 番号图标（列1；图标本身居中，其余列左对齐）
  const faceBox = document.createElement("div");
  faceBox.className = "row-face-box" + (compact ? " compact" : "");
  const face = document.createElement("img");
  face.className = "row-face" + (u.domain === "sea" ? " sea" : "");
  face.src = `/assets/${u.face}`;
  face.alt = u.id;
  faceBox.appendChild(face);
  frag.appendChild(faceBox);

  // 地块号（列2，左对齐）
  const codeEl = document.createElement("span");
  codeEl.className = "loc-code";
  codeEl.textContent = u.code;
  frag.appendChild(codeEl);

  // 地名（列3，左对齐；固定宽，最长名字折两行）
  const nameEl = document.createElement("span");
  nameEl.className = "loc-name";
  nameEl.textContent = TERRITORY_NAMES[u.code] || "";
  frag.appendChild(nameEl);

  // 部队罗列（列4，左对齐）
  const unitsEl = document.createElement("div");
  unitsEl.className = "row-units" + (u.domain === "sea" ? " naval" : "") + (compact ? " compact" : "");
  const counts = u.units || {};
  for (const [type, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      const ic = document.createElement("img");
      ic.className = "u-icon";
      ic.src = `/assets/${UNIT_ICON[type] || "Infantry.jpg"}`;
      ic.alt = type;
      ic.title = type;
      unitsEl.appendChild(ic);
    }
  }
  frag.appendChild(unitsEl);
  return frag;
}

// 给列表行绑定 右击 / 长按 → 合并拆分弹窗
function attachRowMergeHandlers(row, u) {
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMergeModal(u.code, u);
  });
  let t = null;
  row.addEventListener("pointerdown", () => {
    t = setTimeout(() => { openMergeModal(u.code, u); t = null; }, 500);
  });
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  row.addEventListener("pointerup", cancel);
  row.addEventListener("pointerleave", cancel);
  row.addEventListener("pointercancel", cancel);
  row.addEventListener("pointermove", cancel);
}

// 完整渲染部队栏目
function renderUnitPanel() {
  const reserveEl = document.getElementById("unit-panel-reserve");
  const activeEl = document.getElementById("unit-panel-active");
  if (!reserveEl || !activeEl) return;

  renderReserve(reserveEl);

  activeEl.innerHTML = "";
  const nation = currentNation;
  const mine = UNITS.filter(u => u.nation === nation);

  for (const domain of DOMAIN_ORDER) {
    const list = mine.filter(u => u.domain === domain);
    if (list.length === 0) continue;
    // 按地块标号排序（自然序：G1 < G2 < ... < G10）
    list.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    const group = document.createElement("div");
    group.className = "unit-group";
    const title = document.createElement("div");
    title.className = "unit-group-title";
    title.textContent = `${DOMAIN_CN[domain]} · ${list.length} 个番号`;
    group.appendChild(title);

    for (const u of list) group.appendChild(renderActiveRow(u, { focusSelect: true }));
    activeEl.appendChild(group);
  }
}

/* ============================================================
 * 四、行动界面收起/展开（小标签 或 空格键）
 * ============================================================ */
let actionCollapsed = false;

function toggleActionPanel() {
  const panel = document.getElementById("action-panel");
  const btn = document.getElementById("action-toggle");
  if (!panel || !btn) return;
  actionCollapsed = !actionCollapsed;
  panel.classList.toggle("collapsed", actionCollapsed);
  if (window.matchMedia("(max-width: 900px), (max-height: 500px), (pointer: coarse)").matches) { view.scale = actionCollapsed ? Math.min(cssW, cssH) / mapSide : fitScale; centerView(); drawMap(); }
  // 收起后标签指向左（可展开），展开时指向右（可收起）
  btn.textContent = actionCollapsed ? "◀" : "▶";
}

function initActionPanel() {
  const btn = document.getElementById("action-toggle");
  if (btn) btn.addEventListener("click", toggleActionPanel);
  // 空格键切换（避免在输入框中触发）
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      toggleActionPanel();
    }
  });

  // 标签页切换
  document.querySelectorAll("#action-panel .action-tab").forEach((tab) => {
    tab.addEventListener("click", () => selectActionTab(tab.dataset.tab));
  });

  // 确认按钮：确认 / 取消确认
  const cbtn = document.getElementById("confirm-btn");
  if (cbtn) {
    cbtn.addEventListener("click", () => {
      const me = SERVER_STATE && SERVER_STATE.nations && SERVER_STATE.nations[currentNation];
      const confirmed = !!(me && me.confirmed);
      sendAction(confirmed ? "unconfirm" : "confirm", { nation: currentNation });
    });
  }

  // 底部强制推进按钮
  initForceAdvance();

  // 首次渲染（若已有服务端状态）
  if (SERVER_STATE) {
    renderPhaseProgress(SERVER_STATE);
    renderConfirmButton(SERVER_STATE);
    renderActionContent(SERVER_STATE);
    renderNationConfirmHighlights(SERVER_STATE);
  } else {
    // 还没收到服务端状态：先用默认渲染进度条
    renderPhaseProgress({ phaseIndex: 0 });
  }
}

/* 发送操作到服务端（无身份） */
function sendAction(action, extra) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { console.warn("[ws] 未连接，忽略操作:", action); return; }
  const requestId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  ws.send(JSON.stringify(Object.assign({ action, requestId, revision: SERVER_STATE?.revision }, extra || {})));
  return requestId;
}

/* ---------- 底部：强制推进按钮（收起小 tab → 居中大按钮） ---------- */
let forceOpen = false;
function initForceAdvance() {
  const tab = document.getElementById("force-advance-tab");
  const btn = document.getElementById("force-advance-btn");
  const backdrop = document.getElementById("force-advance-backdrop");
  if (!tab || !btn || !backdrop) return;

  const open = () => {
    forceOpen = true;
    backdrop.hidden = false;
    btn.hidden = false;
    // 下一帧加 .open → 触发 0.5s 上移动画
    requestAnimationFrame(() => btn.classList.add("open"));
  };
  const close = () => {
    forceOpen = false;
    btn.classList.remove("open");
    // 等动画结束再隐藏
    setTimeout(() => { if (!forceOpen) { btn.hidden = true; backdrop.hidden = true; } }, 500);
  };

  tab.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  btn.addEventListener("click", () => {
    sendAction("force_confirm", {});
    close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && forceOpen) close();
  });
}

// 切换行动界面标签页
function selectActionTab(name) {
  document.querySelectorAll("#action-panel .action-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll("#action-panel .action-page").forEach((p) => {
    p.hidden = p.dataset.page !== name;
  });
  // 切到「部队」页时刷新
  if (name === "unit") renderUnitPanel();
  if (name === "production" && window.renderProductionTab) window.renderProductionTab(SERVER_STATE);
  // 切到「地块」页时刷新地块卡
  if (name === "territory") renderTerritoryCards();
}

/* ============================================================
 * 五、键盘控制地图：WASD 平移 / QE 旋转（长按阻尼加速到上限）
 *   仅在"地图为活动焦点"时响应：行动界面内、输入框内不响应。
 * ============================================================ */
const KEY_CFG = {
  panMax: 900,      // 平移上限速度（像素/秒）
  rotMax: 1.6,      // 旋转上限速度（弧度/秒）
  accel: 3.0,       // 加速度（到达上限所需时间 ≈ accel 秒的倒数关系；越大加速越快）
  decay: 8.0,       // 松开后的阻尼衰减系数
};

const held = { w: false, a: false, s: false, d: false, q: false, e: false };
let vPanX = 0, vPanY = 0;   // 当前平移速度（屏幕像素/秒）
let vRot = 0;               // 当前旋转速度（弧度/秒）
let animId = null, lastT = 0;

function mapHasFocus() {
  const el = document.activeElement;
  if (!el) return true;
  // 输入框 / 行动界面内 不响应
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return false;
  if (el.closest && el.closest("#action-panel")) return false;
  return true;
}

function loop(now) {
  if (!lastT) lastT = now;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // 目标速度（-1/0/1）
  // 视角方向：按 W 看上方、S 看下方、A 看左方、D 看右方
  // （view.x/view.y 是地图左上角位置，其增大 = 地图右移 = 视角左移，故符号取反）
  const tx = (held.a ? 1 : 0) - (held.d ? 1 : 0);
  const ty = (held.w ? 1 : 0) - (held.s ? 1 : 0);
  const tr = (held.e ? 1 : 0) - (held.q ? 1 : 0);

  // 由按键累积"加速度"，逐渐逼近上限速度（阻尼感）
  if (tx) vPanX += Math.sign(tx) * KEY_CFG.panMax * KEY_CFG.accel * dt;
  else     vPanX -= Math.sign(vPanX) * Math.min(Math.abs(vPanX), KEY_CFG.panMax * KEY_CFG.decay * dt);
  if (ty) vPanY += Math.sign(ty) * KEY_CFG.panMax * KEY_CFG.accel * dt;
  else     vPanY -= Math.sign(vPanY) * Math.min(Math.abs(vPanY), KEY_CFG.panMax * KEY_CFG.decay * dt);
  if (tr) vRot += Math.sign(tr) * KEY_CFG.rotMax * KEY_CFG.accel * dt;
  else    vRot -= Math.sign(vRot) * Math.min(Math.abs(vRot), KEY_CFG.rotMax * KEY_CFG.decay * dt);

  // 夹到上限
  vPanX = Math.max(-KEY_CFG.panMax, Math.min(KEY_CFG.panMax, vPanX));
  vPanY = Math.max(-KEY_CFG.panMax, Math.min(KEY_CFG.panMax, vPanY));
  vRot = Math.max(-KEY_CFG.rotMax, Math.min(KEY_CFG.rotMax, vRot));

  let changed = false;
  // 平移（屏幕方向 → 逆旋转到 view 坐标系）
  if (Math.abs(vPanX) > 0.01 || Math.abs(vPanY) > 0.01) {
    panByScreen(vPanX * dt, vPanY * dt);
    changed = true;
  }
  // 旋转
  if (Math.abs(vRot) > 0.0001) {
    view.rotation += vRot * dt;
    changed = true;
  }

  if (changed) { clampView(); drawMap(); }

  // 若还有速度则继续动画，否则停下
  if (Math.abs(vPanX) > 0.01 || Math.abs(vPanY) > 0.01 || Math.abs(vRot) > 0.0001 ||
      held.w || held.a || held.s || held.d || held.q || held.e) {
    animId = requestAnimationFrame(loop);
  } else {
    animId = null; lastT = 0;
  }
}

function startLoop() {
  if (animId == null) { lastT = 0; animId = requestAnimationFrame(loop); }
}

function initKeyboard() {
  const KEYMAP = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyQ: "q", KeyE: "e" };
  window.addEventListener("keydown", (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (!mapHasFocus()) return;
    e.preventDefault();
    if (!held[k]) { held[k] = true; startLoop(); }
  });
  window.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    held[k] = false;
    startLoop(); // 让阻尼衰减继续跑完
  });
}

/* ============================================================
 * 六、启动
 * ============================================================ */
initNationColumns();
initActionPanel();
initKeyboard();
initMergeModal();
initViewToolbar();
initMovePrompt();
initSplitModal();
loadUnits();
loadFormationsAll();
loadTerritoryNames();
loadCards();
loadChannels();
loadRailroads();
connect();

/* ---- 调试/测试接口（控制台或自动化测试用）---- */
window.__focusDbg = { reachableFrom, focusAndSelect, selectUnit, setTerritoryFocus, channelOpenFor,
  channels: () => CHANNELS, channelIndex: () => channelBySeaPair, allianceOf, ownerOf,
  railReachableFrom, railPassableFor, railroads: () => RAILROADS,
  selectedUnit: () => selectedUnit, highlight: () => focusHighlight };

window.__econ = {
  incomeOf,
  applyIncome,
  refreshAllIncomes,
  territoryYield,
  NATION_INFO,
  // 列出某国拥有的地块及其产出
  breakdown(nation) {
    initTerritoryOwners();
    return (TERRITORIES || [])
      .filter((t) => t.type === "land" && ownerOf(t.code) === nation)
      .map((t) => ({
        code: t.code, name: t.name,
        embattled: flippedCards.has(t.code),
        yield: territoryYield(t, flippedCards.has(t.code)),
        owner: ownerOf(t.code),
      }));
  },
  // 引擎钩子：改归属 + 触发重算（供未来阶段4 夺取领土时调用）
  setOwner(code, nation) {
    initTerritoryOwners();
    territoryOwners[code] = nation || null;
    refreshAllIncomes();
    renderPanel();
  },
  // 引擎钩子：设置某地块交战状态 + 触发重算
  setEmbattled(code, on) {
    if (on) flippedCards.add(code); else flippedCards.delete(code);
    refreshAllIncomes();
    renderPanel();
  },
};
