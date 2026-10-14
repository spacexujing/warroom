"use strict";
// All numbers displayed here are drafts or server results; this file never mutates game state.
(() => {
  const UNIT = { infantry: "步兵", artillery: "炮兵", armor: "装甲", fighter: "战斗机", bomber: "轰炸机", submarine: "潜水艇", cruiser: "巡洋舰", carrier: "航空母舰", battleship: "战列舰", carrier_fighter: "舰载机", convoy_casualty: "护航损失" };
  const STANCE = { defensive: "防御", offensive: "进攻", anti_air: "防空", ground: "对陆", air: "空战", surface: "对陆／海", strategic: "战略轰炸", escort: "护卫", dive: "下潜" };
  const COLOR = { yellow: "黄", blue: "蓝", green: "绿", red: "红", black: "黑", white: "白", miss: "未命中" };
  const ZONE = ["白色 · 安定", "蓝色 · 工潮", "黄色 · 基础设施受限", "橙色 · 指令减少", "红色 · 经济崩溃", "灰色 · 叛逃"];
  const STEP = { cancel: "1 · 消除压力", relieve: "2 · 缓解等级", penalty: "3 · 支付维稳资源", desert: "4 · 选择叛逃单位", done: "压力结算完成" };
  let preview = null, draftKey = "", productionDraft = [], civilianDraft = { oil: 0, iron: 0, osr: 0 };
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  const name = id => NATIONS.find(n => n.id === id)?.name || (id === "neutral" ? "中立卫戍" : id);
  const loc = code => `${code} ${TERRITORY_NAMES?.[code] || ""}`;
  const costText = obj => ["oil", "iron", "osr"].filter(k => obj?.[k]).map(k => `${RES_LABEL[k]} ${obj[k]}`).join(" · ") || "无资源支出";
  function card(box, title, note) { const section = el("section", undefined, "settlement-card"); section.append(el("h3", title)); if (note) section.append(el("p", note, "settlement-note")); box.append(section); return section; }
  function button(parent, text, callback, disabled = false, secondary = false) { const b = el("button", text, `settlement-button${secondary ? " secondary" : ""}`); b.type = "button"; b.disabled = disabled; b.onclick = callback; parent.append(b); return b; }
  function field(parent, label, input) { const row = el("label", undefined, "settlement-field"); row.append(el("span", label), input); parent.append(row); return input; }
  function number(parent, label, max = 100, value = 0) { const input = el("input"); input.type = "number"; input.min = "0"; input.max = String(max); input.step = "1"; input.value = String(value); return field(parent, label, input); }
  function select(parent, label, choices, value) { const input = el("select"); for (const [v, text] of choices) { const option = el("option", text); option.value = v; input.append(option); } if (value !== undefined) input.value = value; return field(parent, label, input); }
  function payment(parent, nation, heading = "付款资源") { const box = el("div", undefined, "payment-grid"); parent.append(el("p", heading, "settlement-note"), box); const fields = {}; for (const k of ["oil", "iron", "osr"]) fields[k] = number(box, RES_LABEL[k], SERVER_STATE.nations[nation]?.resources[k] || 0); return () => Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, Number(input.value)])); }
  function execute(action, payload = {}) { sendAction(action, payload); }
  function previewOperation(operation) { if (!ws || ws.readyState !== WebSocket.OPEN) { showToast("连接已断开，请等待恢复"); return; } sendAction("preview", { operation }); }
  window.previewSettlement = previewOperation;

  const modal = el("dialog", undefined, "settlement-preview"); modal.setAttribute("aria-label", "操作预览"); document.body.append(modal);
  const drawer = el("dialog", undefined, "settlement-reports"); drawer.setAttribute("aria-label", "结算记录"); document.body.append(drawer);
  function showPreview(msg) {
    preview = msg; modal.replaceChildren(); modal.append(el("h2", "操作预览"));
    const description = { set_production: "保存生产清单，资源在全体确认后统一扣减。", finish_battle: "确认维修选择并结算战斗报告。", morale_submit: "提交当前压力步骤，全部国家完成后进入下一步骤。", deploy: "将生产单位编入现役部队。", land_air: "将待着陆空军移动至友方领土。", trade: "立即支付并获得贸易资源。", reorganize_area: "按当前方案重调部队，相关旧指令会清空。", force_confirm: "全体视为确认；阶段二将保留已选顺位，随机补齐剩余顺位并支付竞价石油；其他阶段须先完成必要操作。", resolve_order: "按合法路线结算本条移动指令。", launch_carrier: "从航空母舰出动舰载战斗机。" }[msg.operation.action] || "核对本次操作的变化，执行后所有视角同步。";
    modal.append(el("p", description, "settlement-note"));
    if (msg.production) { const c = card(modal, "生产清单"); c.append(el("p", costText(msg.production.cost))); for (const item of msg.production.items) c.append(el("p", `${loc(item.code)} · ${UNIT[item.type]} ×${item.count}${item.immediate ? " · 立即动员" : " · 下一轮部署"}`)); if (msg.production.civilianGoods) c.append(el("p", `民用物资 +${msg.production.civilianGoods}`)); }
    const nation = msg.operation.nation, previous = SERVER_STATE.nations[nation];
    if (msg.nation && previous) {
      const rows = [];
      for (const k of ["oil", "iron", "osr"]) if (previous.resources[k] !== msg.nation.resources[k]) rows.push(`${RES_LABEL[k]} ${previous.resources[k]} → ${msg.nation.resources[k]}`);
      for (const [key, label] of [["stress", "压力"], ["medals", "奖章"], ["civilianGoods", "民用物资"]]) if (previous[key] !== msg.nation[key]) rows.push(`${label} ${previous[key]} → ${msg.nation[key]}`);
      if (previous.zone !== msg.nation.zone) rows.push(`压力等级 ${ZONE[previous.zone]} → ${ZONE[msg.nation.zone]}`);
      if (rows.length) { const c = card(modal, name(nation)); rows.forEach(row => c.append(el("p", row))); }
    }
    if (msg.operation.action === "land_air" || msg.operation.action === "resolve_order") {
      const id = msg.operation.unitId || SERVER_STATE.movePhase.cur?.formationId, before = SERVER_STATE.units[id], after = msg.units[id];
      if (before) card(modal, "部队位置", `${loc(before.code)} → ${after ? loc(after.code) : "移入伤亡区"}`);
      if (msg.operation.route) modal.append(el("p", `路线：${msg.operation.route.join(" → ")}`));
    }
    renderReports(modal, msg.reports || [], true);
    if (msg.phase !== SERVER_STATE.phase) modal.append(el("p", `下一阶段：${PHASE_NAMES[msg.phase]}`));
    const actions = el("div", undefined, "settlement-actions"); modal.append(actions);
    button(actions, "返回修改", () => { modal.close(); preview = null; }, false, true);
    button(actions, "执行操作", () => { const operation = preview.operation, revision = preview.revision; modal.close(); preview = null; execute(operation.action, { ...operation, revision }); });
    modal.append(el("p", "执行前会再次检查最新局面。", "settlement-note")); if (!modal.open) modal.showModal();
  }
  function reportDescription(report) {
    const d = report.details || {}, lines = [];
    if (d.cost) lines.push(`支出：${costText(d.cost)}`);
    if (d.remaining) lines.push(`剩余：${costText(d.remaining)}`);
    if (d.from && d.to) lines.push(`${loc(d.from)} → ${loc(d.to)}`);
    if (d.losses) {
      if (Array.isArray(d.losses)) for (const loss of d.losses) { if (loss.type) lines.push(`${name(loss.nation)} ${UNIT[loss.type]} −${loss.count || 1}`); else if (loss.lost) lines.push(`${name(loss.nation)} 损失 ${costText(loss.lost)}`); }
    }
    if (d.captured) lines.push(`控制权：${name(d.oldOwner) || "中立"} → ${name(d.owner)}`);
    if (d.embattled) lines.push("双方仍有地面／海军兵力，保留交战标记");
    if (d.bombTokens) lines.push(`设施轰炸标记 ×${d.bombTokens}`);
    if (d.received) lines.push(`获得：${costText(d.received)}`);
    if (d.paid) lines.push(`支付：${costText(d.paid)}`);
    if (d.items) d.items.forEach(item => lines.push(`${loc(item.code)} ${UNIT[item.type]} ×${item.count}`));
    if (d.groups) d.groups.forEach((group, i) => lines.push(`部队 ${i + 1}：${Object.entries(group).map(([t, n]) => `${UNIT[t]}×${n}`).join("、")}`));
    if (report.kind === "morale") for (const [nation, info] of Object.entries(d)) { if (info.value !== undefined) lines.push(`${name(nation)} 伤亡值 ${info.value} → 压力 +${info.stress}`); else if (info.paid) lines.push(`${name(nation)} 支付 ${costText(info.paid)}`); else if (info.stress !== undefined) lines.push(`${name(nation)} 压力 ${info.stress}${info.zone !== undefined ? ` · ${ZONE[info.zone]}` : ""}`); }
    if (report.kind === "economy") for (const [nation, info] of Object.entries(d.nations || {})) lines.push(`${name(nation)} 储量 ${costText(info.resources)}`);
    if (d.addedStress) lines.push(`压力 +${d.addedStress}`);
    if (d.winner) lines.push(`结果：${d.winner === "draw" ? "双方战败" : d.winner === "axis" ? "轴心国获胜" : "同盟国获胜"}`);
    return lines;
  }
  function renderReports(box, reports, expanded = false) {
    if (!reports.length) { if (!expanded) box.append(el("p", "暂无结算记录。", "settlement-note")); return; }
    for (const report of [...reports].reverse()) {
      const detail = el("details", undefined, "report-item"); detail.open = expanded; detail.append(el("summary", `${report.title} · 第${report.round}轮`));
      reportDescription(report).forEach(line => detail.append(el("p", line)));
      if (report.details?.rolls) report.details.rolls.forEach(roll => { const row = el("div", undefined, "dice-row"); row.append(el("span", `${roll.stage === "air" ? "空战" : roll.stage === "surface" ? "陆／海战" : roll.stage === "bombing" ? "轰炸" : "常备部队"} `)); (roll.faces || roll.dice).forEach(color => row.append(el("span", COLOR[color], `die ${color}`))); detail.append(row); });
      box.append(detail);
    }
  }
  window.renderSettlementReports = renderReports;
  function openReports() { drawer.replaceChildren(); const header = el("div", undefined, "settlement-actions"); header.append(el("h2", "结算记录")); button(header, "关闭", () => drawer.close(), false, true); drawer.append(header); renderReports(drawer, SERVER_STATE?.reports || []); drawer.showModal(); }
  document.getElementById("open-reports").onclick = openReports;
  window.handleSettlementMessage = msg => { if (msg.type === "preview") showPreview(msg); if (msg.type === "error") showToast(msg.message); if (msg.type === "ack") { if (msg.requestId) showToast("操作已执行"); } };
  window.refreshSettlementChrome = g => {
    const status = document.getElementById("connection-state"); status.textContent = g.status === "finished" ? (g.winner === "axis" ? "轴心国获胜" : g.winner === "allies" ? "同盟国获胜" : "双方战败") : "已同步";
    if (preview && preview.revision !== g.revision) { const b = modal.querySelector(".settlement-actions button:last-child"); if (b) { b.disabled = true; b.textContent = "局面已变化，请重新预览"; } }
    if (g.phase !== draftKey.split("|")[0] || currentNation !== draftKey.split("|")[1] || g.round !== Number(draftKey.split("|")[2])) { draftKey = `${g.phase}|${currentNation}|${g.round}`; const draft = g.productionDrafts[currentNation]; productionDraft = draft?.items.map(item => ({ ...item })) || []; civilianDraft = { ...(draft?.civilianPayment || { oil: 0, iron: 0, osr: 0 }) }; }
  };
  function renderBattle(box, g) {
    const c = g.combat, b = c?.current;
    if (!b) {
      const s = card(box, c?.pending.length ? `热点区域 · ${c.pending.length} 个待结算` : "本轮热点已结算", c?.pending.length ? `轮到 ${name(c.picker)} 选择牵涉本国的热点。` : "可确认进入改装部署阶段。");
      for (const task of c?.pending || []) {
        const row = el("div"); s.append(row);
        const raiders = task.kind === "convoy" ? task.raiderIds.map(id => { const input = el("input"); input.type = "checkbox"; input.checked = true; field(row, `${id} 参与突袭`, input); return { id, input }; }) : null;
        button(row, `${loc(task.code)} · ${task.kind === "convoy" ? "护航突袭" : "战斗"}`, () => execute("choose_battle", { nation: currentNation, battleId: task.id, ...(raiders ? { raiderIds: raiders.filter(r => r.input.checked).map(r => r.id) } : {}) }), currentNation !== c.picker || !task.nations.includes(currentNation), true);
      }
      return;
    }
    const s = card(box, `${loc(b.code)} · ${b.kind === "convoy" ? "护航舰队突袭" : "战斗"}`);
    button(s, "地图定位", () => setTerritoryFocus(b.code), false, true);
    if (b.kind === "convoy") {
      for (const target of b.targets) s.append(el("p", `${name(target.owner)} · ${target.linkedTerritory ? loc(target.linkedTerritory) : `${target.origin} → ${target.destination}`} · ${costText(target.dice)}`));
      if (!b.dice) button(s, "投骰突袭", () => execute("roll_convoy", { nation: currentNation }), !b.nations.includes(currentNation));
      else {
        renderDice(s, b.dice); const choices = b.dice.filter(c => c === "black").map((_, i) => select(s, `黑色骰面 ${i + 1}`, ["yellow", "blue", "red", "miss"].map(c => [c, COLOR[c]])));
        button(s, "预览突袭结算", () => previewOperation({ action: "finish_convoy", nation: currentNation, blackColors: choices.map(s => s.value) }), !b.nations.includes(currentNation));
      }
      return;
    }
    const labels = { setup: "初设 · 选择姿态", roll: `${b.stage === "air" ? "空战" : "陆／海战"} · 分批投骰`, hits: "按颜色分配命中", garrison_hit: "常备部队命中", bombing: "战略轰炸", report: "战斗结束 · 维修与报告" };
    s.append(el("p", labels[b.step], "settlement-status"));
    if (b.frontName) s.append(el("p", `苏日条约分组：${name(b.frontName)} · 第${b.frontIndex + 1}场／${b.fronts.length}场`, "settlement-note"));
    if (b.step === "setup") {
      const partition = !b.fronts && g.treaties.sovietJapan && b.tokens.some(t => t.nation === "japan") && b.tokens.some(t => t.nation === "soviet");
      if (partition) s.append(el("p", "苏日不能互相造成伤亡。日本与苏联单位分属两场战斗，其他国家逐单位选择参加哪一场；同一单位只参加一次。", "settlement-note"));
      if (b.garrison) s.append(el("p", "空置敌方领土：常备部队投两颗骰子抵抗，不进行普通战斗。", "settlement-note"));
      for (const side of ["axis", "allies"]) {
        const group = el("details", undefined, "battle-group"); group.open = true; group.append(el("summary", `${side === "axis" ? "轴心国" : "同盟国"} · 指挥官 ${name(b.commanders[side])}`));
        const candidates = [...new Set(b.tokens.filter(t => t.alliance === side && t.nation !== "neutral").map(t => t.nation))];
        if (candidates.length > 1) { const commander = select(group, "指挥官", candidates.map(n => [n, name(n)]), b.commanders[side]); commander.disabled = !candidates.includes(currentNation); commander.onchange = () => execute("set_commander", { nation: currentNation, commander: commander.value }); }
        for (const t of b.tokens.filter(t => t.alliance === side)) {
          const choices = Object.keys(SERVER_META.stances[t.type]).filter(k => b.surface !== "sea" || k !== "strategic").map(k => [k, STANCE[k]]);
          const input = select(group, `${name(t.nation)} ${UNIT[t.type]}`, choices, t.stance); input.disabled = currentNation !== t.nation && !(t.nation === "neutral" && currentNation === b.commanders[side]); input.onchange = () => execute("set_stance", { nation: currentNation, tokenId: t.id, stance: input.value });
          if (partition && !["japan", "soviet", "neutral"].includes(t.nation)) { const roots = ["japan", "soviet"].sort((a, b) => g.roundOrder.indexOf(a) - g.roundOrder.indexOf(b)); const front = select(group, "参加条约分组", roots.map(n => [n, `${name(n)}分组`]), t.front || roots[0]); front.disabled = t.nation !== currentNation; front.onchange = () => execute("set_front", { nation: currentNation, tokenId: t.id, front: front.value }); }
        }
        s.append(group);
      }
      button(s, b.garrison ? "常备部队投骰" : "开始战斗", () => execute("start_battle", { nation: currentNation }), !b.nations.includes(currentNation));
    } else if (b.step === "roll") {
      s.append(el("p", `轮到 ${name(b.commanders[b.turn])} · 本批 ${Math.min(10, b.remainingDice[b.turn])} 颗`));
      s.append(el("p", `剩余骰子：轴心 ${b.remainingDice.axis} · 同盟 ${b.remainingDice.allies}`, "settlement-note"));
      if (b.stage === "surface") s.append(el("p", `兵种优势：${b.advantage.axis ? "轴心国" : b.advantage.allies ? "同盟国" : "双方相同"}`));
      button(s, "投掷当前批次", () => execute("roll_combat", { nation: currentNation }), currentNation !== b.commanders[b.turn]);
    } else if (["hits", "garrison_hit"].includes(b.step)) {
      renderDice(s, b.dice.faces); s.append(el("p", `当前分配：${COLOR[b.dice.remaining[0]]}色命中`));
      const targets = b.step === "garrison_hit" ? b.garrisonTargets : b.legalTargets || [];
      const enabled = b.step === "garrison_hit" ? b.nations.includes(currentNation) : currentNation === b.commanders[b.dice.side];
      const target = select(s, "命中目标", targets.map(id => { const t = b.tokens.find(t => t.id === id); return [id, `${name(t.nation)} ${UNIT[t.type]} · ${STANCE[t.stance]} · 已中${t.damage}次`]; }));
      const guards = b.tokens.filter(t => t.type === "cruiser" && t.stance === "escort" && !t.destroyed && t.alliance !== b.dice.side);
      const guard = b.step === "hits" && b.surface === "sea" ? select(s, "护卫替代（由守方选择）", [["", "不使用护卫"], ...guards.map(t => [t.id, `${name(t.nation)} 巡洋舰 · 已中${t.damage}次`])]) : null;
      button(s, "分配这次命中", () => execute("assign_hit", { nation: currentNation, tokenId: target.value, guardId: guard?.value || undefined }), !enabled || !targets.length);
      if (b.step === "hits" && b.dice.remaining[0] === "black") button(s, "放弃万能命中", () => execute("discard_hit", { nation: currentNation }), !enabled, true);
    } else if (b.step === "bombing") renderBombing(s, b);
    else if (b.step === "report") renderBattleReport(s, b);
    if (b.step !== "setup") {
      const detail = el("details", undefined, "battle-group"); detail.append(el("summary", "查看双方单位状态"));
      for (const t of b.tokens) detail.append(el("p", `${name(t.nation)} ${UNIT[t.type]} · ${t.destroyed ? "摧毁" : t.withdrawn ? "潜艇已撤离" : t.damage ? `命中 ${t.damage} 次` : "完好"}`)); s.append(detail);
    }
  }
  function renderDice(parent, faces) { const row = el("div", undefined, "dice-row"); faces.forEach(color => row.append(el("span", COLOR[color], `die ${color}`))); parent.append(row); }
  function renderBombing(parent, b) {
    const bomber = b.tokens.find(t => t.id === b.bombingQueue[0]); parent.append(el("p", `${name(bomber.nation)} · 剩余轰炸机 ${b.bombingQueue.length}`));
    if (!b.bombDice) { button(parent, "此轰炸机投四颗骰子", () => execute("roll_bombing", { nation: currentNation }), currentNation !== bomber.nation); return; }
    renderDice(parent, b.bombDice); const face = b.bombDice[0];
    const color = face === "black" ? select(parent, "万能颜色", ["yellow", "blue", "green", "red", "white"].map(c => [c, COLOR[c]])) : null;
    const targets = select(parent, "轰炸效果", []);
    const rebuild = () => {
      const c = color?.value || face, options = [["miss", "未命中／放弃效果"]], owner = SERVER_STATE.territories[b.code].owner;
      const kind = { yellow: "osr", blue: "iron", red: "oil" }[c]; if (kind) options.push([kind, `扣减 ${RES_LABEL[kind]} 1（受领土产出上限限制）`]); if (c === "white") options.push(["facility", "设施受损 · 添加轰炸标记"]);
      for (const p of SERVER_STATE.production.filter(p => p.code === b.code && p.nation === owner)) { const map = { infantry: "yellow", submarine: "yellow", artillery: "blue", cruiser: "blue", armor: "green", fighter: "green", carrier: "green", bomber: "red", battleship: "red" }; if (map[p.type] === c) options.push([p.id, `摧毁生产中 ${UNIT[p.type]} 1（剩余${p.count}）`]); }
      targets.replaceChildren(...options.map(([value, text]) => { const option = el("option", text); option.value = value; return option; }));
    };
    rebuild(); if (color) color.onchange = rebuild;
    button(parent, "分配当前轰炸骰面", () => execute("assign_bombing", { nation: currentNation, color: color?.value, target: targets.value, productionId: SERVER_STATE.production.some(p => p.id === targets.value) ? targets.value : undefined }), currentNation !== bomber.nation);
  }
  function renderBattleReport(parent, b) {
    const repairs = {}, payments = {};
    for (const nation of b.nations) {
      const damaged = b.tokens.filter(t => t.nation === nation && !t.destroyed && t.type !== "submarine" && t.damage >= SERVER_META.stances[t.type][t.stance].hits - 1);
      if (!damaged.length) continue;
      const section = card(parent, `${name(nation)} · 维修`); repairs[nation] = [];
      for (const t of damaged) {
        if (t.domain === "sea" && b.ports[t.alliance]) { section.append(el("p", `${UNIT[t.type]} · 港口优势免费维修`)); continue; }
        const input = el("input"); input.type = "checkbox"; field(section, `${UNIT[t.type]} · 支付1资源维修（不选则摧毁）`, input); repairs[nation].push({ input, id: t.id });
      }
      payments[nation] = payment(section, nation, "为选中的单位分配维修资源");
    }
    const survivors = b.tokens.filter(t => !t.destroyed && t.domain === "land" && t.nation !== "neutral"), choices = [...new Set(survivors.map(t => t.nation))];
    const owner = choices.length ? select(parent, "夺取领土的国家", choices.map(n => [n, name(n)])) : null;
    const medal = select(parent, "奖章接收国", b.nations.map(n => [n, name(n)]));
    button(parent, "预览战斗报告", () => previewOperation({ action: "finish_battle", nation: currentNation, repairs: Object.fromEntries(Object.entries(repairs).map(([n, entries]) => [n, entries.filter(e => e.input.checked).map(e => e.id)])), payments: Object.fromEntries(Object.entries(payments).map(([n, read]) => [n, read()])), owner: owner?.value, medalNation: medal.value }), !b.nations.includes(currentNation));
  }
  function renderRefit(box, g) {
    const air = Object.values(g.units).filter(u => u.nation === currentNation && u.needsLanding), ready = g.production.filter(p => p.nation === currentNation && p.readyRound <= g.round);
    const s = card(box, "空军着陆", air.length ? "移动或参战的空军须在两步内着陆。可先拆分，再分别选择着陆点。" : "本国没有待着陆空军。");
    for (const u of air) {
      const row = card(s, `${u.id} · ${loc(u.code)}`), targets = g.landingOptions[u.id] || [];
      if (targets.length) { const dest = select(row, "友方着陆地", targets.map(c => [c, loc(c)])); button(row, "预览着陆", () => previewOperation({ action: "land_air", nation: currentNation, unitId: u.id, code: dest.value })); }
      else button(row, "确认无法着陆 · 移入伤亡区", () => previewOperation({ action: "land_air", nation: currentNation, unitId: u.id, destroy: true }));
    }
    const p = card(box, "部署生产单位", ready.length ? "按生产地部署；海军只可进入与该港口相连的海区。" : "本国没有本轮可部署单位。");
    for (const item of ready) {
      const row = card(p, `${loc(item.code)} · ${UNIT[item.type]} ×${item.count}`), count = number(row, "部署数量", item.count, item.count), sea = SERVER_META.units[item.type].domain === "sea";
      const dest = select(row, "部署位置", (sea ? SERVER_META.ports[item.code] || [] : [item.code]).map(c => [c, loc(c)]));
      button(row, "预览部署", () => previewOperation({ action: "deploy", nation: currentNation, productionId: item.id, count: Number(count.value), code: dest.value }));
      button(row, "摧毁超出产能的单位", () => previewOperation({ action: "discard_production", nation: currentNation, productionId: item.id, count: Number(count.value) }), false, true);
      button(row, "番号不足 · 保留待入编", () => previewOperation({ action: "defer_deployment", nation: currentNation, productionId: item.id }), item.deferredRound === g.round, true);
    }
    card(box, "重调部队", "在地图或部队列表中右击番号，即可合并与拆分；每个部队最多8个单位。更改会先进入预览。");
  }
  function renderMorale(box, g) {
    const m = g.morale, me = g.nations[currentNation], c = m.casualties[currentNation], s = card(box, STEP[m.step], `压力 ${me.stress} / 阈值 ${me.threshold} · ${ZONE[me.zone]} · 奖章 ${me.medals} · 民用物资 ${me.civilianGoods}`);
    if (c) s.append(el("p", `本轮伤亡值 ${c.value}，已增加压力 ${c.stress}。`, "settlement-note"));
    if (m.step === "done") { s.append(el("p", "全部国家已完成，可确认进入生产阶段。")); return; }
    const order = g.roundOrder?.length ? g.roundOrder : Object.keys(g.nations);
    const active = order.find(id => !g.nations[id].collapsed && !m.submitted[id]); s.append(el("p", `轮到 ${name(active)} · 已完成 ${Object.keys(m.submitted).length} 国`, "settlement-status"));
    if (m.submitted[currentNation]) { s.append(el("p", "本国已提交，等待其他国家。")); return; }
    const enabled = active === currentNation;
    if (["cancel", "relieve"].includes(m.step)) {
      s.append(el("p", m.step === "cancel" ? "每份奖章／民用物资消除1点压力；提交零表示保留。全体完成后统一评估等级。" : `支付恰好${me.threshold}份奖章／民用物资，缓解一级；每轮最多一次。`, "settlement-note"));
      const medals = number(s, "使用奖章", me.medals), cg = number(s, "使用民用物资", me.civilianGoods);
      button(s, "预览提交", () => previewOperation({ action: "morale_submit", nation: currentNation, step: m.step, medals: Number(medals.value), civilianGoods: Number(cg.value) }), !enabled);
    } else if (m.step === "penalty") {
      const need = me.zone >= 1 ? Math.min(3, Object.values(me.resources).reduce((a, b) => a + b, 0)) : 0; s.append(el("p", `本国本轮须支付 ${need} 个维稳资源。`)); const pay = payment(s, currentNation);
      button(s, "预览维稳结算", () => previewOperation({ action: "morale_submit", nation: currentNation, step: m.step, payment: pay() }), !enabled);
    } else {
      const mine = Object.values(g.units).filter(u => u.nation === currentNation && !u.carrierFighter), total = mine.reduce((a, u) => a + u.unitCount, 0), need = me.zone === 5 ? Math.min(me.stress, total) : 0, inputs = [];
      s.append(el("p", `须选择 ${need} 个单位移入伤亡区；压力保持不变。`));
      if (need) for (const u of mine) for (const [type, count] of Object.entries(u.units)) inputs.push({ unitId: u.id, type, input: number(s, `${loc(u.code)} ${u.num} · ${UNIT[type]}`, count) });
      button(s, "预览叛逃结算", () => previewOperation({ action: "morale_submit", nation: currentNation, step: m.step, losses: inputs.map(i => ({ unitId: i.unitId, type: i.type, count: Number(i.input.value) })).filter(i => i.count > 0) }), !enabled);
    }
  }
  function renderProduction(box, g, editable = true) {
    window.refreshSettlementChrome(g);
    const me = g.nations[currentNation], s = card(box, "生产清单", "全体确认后统一扣资源；新单位通常在下一轮改装部署阶段部署。中国步兵立即动员。");
    for (const [index, item] of productionDraft.entries()) { const row = el("div", undefined, "production-line"); row.append(el("span", `${loc(item.code)} · ${UNIT[item.type]} ×${item.count}`)); button(row, "移除", () => { productionDraft.splice(index, 1); redraw(); }, !editable || me.confirmed, true); s.append(row); }
    const codes = (TERRITORIES || []).filter(t => g.territories[t.code]?.owner === currentNation && (t.industrySlotsTotal > 0 || (currentNation === "china" && t.code.startsWith("C"))));
    const types = Object.keys(SERVER_META.units).filter(t => t !== "carrier_fighter" && (currentNation !== "china" || ["infantry", "artillery"].includes(t)));
    const type = select(s, "单位", types.map(t => [t, `${UNIT[t]} · ${costText(SERVER_META.units[t].cost)}`])), count = number(s, "数量", 80, 1);
    const factory = select(s, "生产地", codes.map(t => [t.code, `${loc(t.code)} · 产能${Math.max(0, t.industrySlotsTotal - g.territories[t.code].bombTokens) || t.stratValue}`]));
    button(s, "加入清单", () => { if (!factory.value || !Number.isInteger(Number(count.value)) || Number(count.value) <= 0) { showToast("请选择生产地并输入正整数数量"); return; } productionDraft.push({ type: type.value, code: factory.value, count: Number(count.value) }); redraw(); }, !editable || me.confirmed);
    const cg = card(box, "民用物资", "每份费用为任意组合的5个资源，不占工业产能。"), fields = {};
    for (const kind of ["oil", "iron", "osr"]) { fields[kind] = number(cg, `${RES_LABEL[kind]}支出`, me.resources[kind], civilianDraft[kind]); fields[kind].disabled = !editable || me.confirmed; fields[kind].oninput = () => { civilianDraft[kind] = Number(fields[kind].value); updateTotal(); }; }
    const total = card(box, "购买前核对"), totalText = el("p"); total.append(totalText);
    function updateTotal() { const cost = { ...civilianDraft }; for (const item of productionDraft) for (const k of ["oil", "iron", "osr"]) cost[k] += SERVER_META.units[item.type].cost[k] * item.count; totalText.textContent = `费用：${costText(cost)} · 当前：${costText(me.resources)}`; }
    updateTotal();
    button(total, "预览并保存清单", () => previewOperation({ action: "set_production", nation: currentNation, items: productionDraft, civilianPayment: civilianDraft }), !editable || me.confirmed);
    if (g.productionDrafts[currentNation]) total.append(el("p", "已有清单保存在服务端；全体确认后结算。", "settlement-note"));
    if (editable && currentNation !== "china") {
      const trade = card(box, "与中立国交易", me.traded ? "本国本轮已完成一次交易。" : "每轮至多一次，服务端检查联盟、陆路／海路及压力限制。"), neutral = select(trade, "中立国", SERVER_META.neutrals.filter(t => Object.values(t.trades).some(Boolean)).map(t => [t.code, loc(t.code)]));
      const receive = select(trade, "获得资源", [["oil", "石油2"], ["iron", "钢铁3"], ["osr", "其他5"]]), batches = number(trade, "整组数", 20, 1), pay = payment(trade, currentNation);
      button(trade, "预览贸易", () => previewOperation({ action: "trade", nation: currentNation, code: neutral.value, receive: receive.value, batches: Number(batches.value), payment: pay() }), me.traded || me.confirmed);
    }
    function redraw() { box.replaceChildren(); renderProduction(box, SERVER_STATE, editable); }
  }
  window.renderProductionTab = g => {
    if (!g || !SERVER_META) return; const box = document.querySelector('[data-page="production"]'); if (!box) return; box.replaceChildren();
    if (g.phase === "phase7_production") renderProduction(box, g);
    else { const s = card(box, "生产中的单位", "本轮可部署单位请在改装部署阶段处理。"); const items = g.production.filter(p => p.nation === currentNation); if (!items.length) s.append(el("p", "本国暂无生产中的单位。")); for (const item of items) s.append(el("p", `${loc(item.code)} · ${UNIT[item.type]} ×${item.count} · 第${item.readyRound}轮可部署`)); }
  };
  window.renderSettlementPhase = (box, g) => {
    if (!SERVER_META || !g.nations[currentNation]) return;
    if (g.nations[currentNation].collapsed) { card(box, "本国已崩溃", "可切换其他国家视角，或查看历史结算记录。"); return; }
    if (g.phase === "phase4_combat") renderBattle(box, g);
    else if (g.phase === "phase5_refit") renderRefit(box, g);
    else if (g.phase === "phase6_morale") renderMorale(box, g);
    else if (g.phase === "phase7_production") renderProduction(box, g);
  };
  window.renderPhaseTools = (box, g) => {
    if (g.blocker) card(box, "阶段完成条件", g.blocker);
    if (g.phase === "phase3_movement" && g.movePhase.cur?.nation === currentNation && !g.movePhase.cur.partial) {
      const cur = g.movePhase.cur, s = card(box, "选择移动路线", "可修改完整路线，以逗号分隔区域编号。服务端逐边检查距离、海峡、铁路和条约。"), input = el("input"); input.value = (cur.remainingRoute || cur.route || []).join(","); field(s, "完整路线", input);
      button(s, "预览此路线", () => previewOperation({ action: "resolve_order", nation: currentNation, result: "execute", route: input.value.split(/[,，\s→]+/).filter(Boolean).map(c => c.toUpperCase().replace(/-/g, "")) }));
    }
    if (g.phase === "phase3_movement" && g.movePhase.done) {
      const carriers = Object.values(g.units).filter(u => u.nation === currentNation && u.units.carrier && !u.launched);
      if (carriers.length) { const s = card(box, "舰载战斗机出动", "每艘航母可出动1个舰载机；此步骤不需移动指令。"); for (const u of carriers) { const target = select(s, `${u.id} 出动到`, (g.carrierOptions[u.id] || []).map(code => [code, loc(code)])); button(s, "预览出动", () => previewOperation({ action: "launch_carrier", nation: currentNation, unitId: u.id, code: target.value })); } }
    }
    if (g.treaties.sovietJapan && ["japan", "soviet"].includes(currentNation) && !["phase6_morale", "phase7_production"].includes(g.phase)) { const s = card(box, "苏日中立条约", "生效中。主动打破会立即增加6点压力，本轮夺取对方领土不获奖章。"); button(s, "预览打破条约", () => previewOperation({ action: "break_treaty", nation: currentNation }), false, true); }
    const recent = g.reports.filter(r => r.phase === g.phase && r.round === g.round).slice(-3); if (recent.length) { const section = card(box, "最近结算"); renderReports(section, recent); }
  };
  // Preserve the existing confirm/force controls while making force advancement reviewable.
  const force = document.getElementById("force-advance-btn");
  force.addEventListener("click", event => { event.stopImmediatePropagation(); previewOperation({ action: "force_confirm" }); document.getElementById("force-advance-backdrop").hidden = true; force.hidden = true; }, true);
  const connectState = () => { if (ws?.readyState !== WebSocket.OPEN) document.getElementById("connection-state").textContent = "离线 · 正在重连"; };
  setInterval(connectState, 2000);
  if (SERVER_STATE) { renderActionContent(SERVER_STATE); window.renderProductionTab(SERVER_STATE); }
})();
