"use strict";
const R = require("./rules");
const { homeland } = require("./movement");
const { DATA, ally, check, integer, resources, spend, ZERO, clone, STANCES, UNIT_COLOR, COLORS, DIE, casualtyStress, defaultStance } = R;
const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

class Settlements {
  constructor(game, terr, formations, movement, log, randomInt) {
    Object.assign(this, { game, terr, formations, movement, log, randomInt });
    game.production ||= []; game.productionDrafts ||= {}; game.reports ||= []; game.reportSequence ||= 0;
    game.treaties ||= { sovietJapan: true, sinoSoviet: true, stalin: true };
    for (const u of Object.values(game.units)) if (R.NATION_ALLIANCE[u.nation]) u.alliance = R.NATION_ALLIANCE[u.nation];
    for (const [id, n] of Object.entries(game.nations)) {
      Object.assign(n, { stress: n.stress || 0, zone: n.zone || 0, medals: n.medals || 0, civilianGoods: n.civilianGoods || 0, casualties: n.casualties || {}, casualtyHistory: n.casualtyHistory || {}, threshold: DATA.thresholds.global[id], collapsed: !!n.collapsed });
    }
    for (const t of Object.values(game.territories)) { t.bombTokens ||= 0; }
  }
  nation(id) { const n = this.game.nations[id]; check(n && !n.collapsed, "国家不存在或已崩溃"); return n; }
  phase(key) { check(this.game.phase === key && this.game.status === "playing", "当前阶段不能执行此操作"); }
  report(kind, title, details) {
    const report = { id: `${this.game.round}-${++this.game.reportSequence}`, round: this.game.round, phase: this.game.phase, kind, title, at: Date.now(), details: clone(details) };
    this.game.reports.push(report); if (this.game.reports.length > 100) this.game.reports.shift();
    this.log(title); return report;
  }
  casualty(nation, type, count = 1) {
    if (!this.game.nations[nation]) return;
    const n = this.game.nations[nation];
    n.casualties[type] = (n.casualties[type] || 0) + count;
    n.casualtyHistory[type] = (n.casualtyHistory[type] || 0) + count;
  }
  cleanUnits() {
    for (const [id, u] of Object.entries(this.game.units)) {
      u.units = Object.fromEntries(Object.entries(u.units).filter(([, count]) => count > 0));
      u.unitCount = sum(u.units); if (!u.unitCount) delete this.game.units[id];
    }
  }
  ports(code) { return DATA.ports[code] || []; }
  capacity(code) { const t = this.terr[code], st = this.game.territories[code]; return Math.max(0, (t.industrySlotsTotal || 0) - (st.bombTokens || 0)); }
  freeFormation(nation, domain) {
    const nums = this.formations[nation]?.[domain] || [], used = new Set(Object.values(this.game.units).filter(u => u.nation === nation && u.domain === domain).map(u => u.num));
    return nums.find(num => !used.has(num));
  }
  addUnits(nation, code, type, count) {
    const domain = DATA.units[type].domain;
    // Preflight the complete capacity before changing any existing stack.
    const existing = Object.values(this.game.units).filter(u => u.nation === nation && u.code === code && u.domain === domain);
    const used = new Set(Object.values(this.game.units).filter(u => u.nation === nation && u.domain === domain).map(u => u.num));
    const free = (this.formations[nation]?.[domain] || []).filter(num => !used.has(num));
    check(existing.reduce((n, u) => n + 8 - u.unitCount, 0) + free.length * 8 >= count, "可用番号不足：请先合并部队，再部署");
    for (const u of existing) { const take = Math.min(count, 8 - u.unitCount); u.units[type] = (u.units[type] || 0) + take; u.unitCount += take; count -= take; }
    while (count > 0) {
      const num = this.freeFormation(nation, domain), take = Math.min(count, 8), id = `${nation}-${domain}-${num}`;
      const name = { usa: "USA", soviet: "Soviet", britain: "Britain", germany: "Germany", japan: "Japan", italy: "Italy", china: "China" }[nation];
      this.game.units[id] = { id, nation, alliance: R.NATION_ALLIANCE[nation], domain, num, code, face: `${name}_${domain[0].toUpperCase() + domain.slice(1)}_${num}.png`, units: { [type]: take }, unitCount: take };
      count -= take;
    }
  }
  productionPreview(nation, items, civilianPayment = ZERO()) {
    this.nation(nation); check(Array.isArray(items) && items.length <= 100, "生产清单无效");
    const cost = ZERO(), locations = {}, immediate = [], normalized = [];
    for (const item of items) {
      check(item && DATA.units[item.type] && item.type !== "carrier_fighter", "未知或不可购买的单位");
      const count = integer(item.count, 1, 80), rule = DATA.units[item.type], t = this.terr[item.code];
      check(t && t.type === "land" && this.game.territories[item.code].owner === nation, "生产地必须由本国控制");
      check(nation !== "china" || ["infantry", "artillery"].includes(item.type), "中国只能购买步兵和炮兵");
      const mobilize = nation === "china" && item.type === "infantry";
      check(t.industrySlotsTotal > 0 || (mobilize && homeland(t) === "china"), "此地没有工业或中国动员标识");
      check(rule.domain !== "sea" || this.ports(item.code).length > 0, "海军必须在有港口的工业领土生产");
      locations[item.code] = (locations[item.code] || 0) + count;
      for (const k of Object.keys(cost)) cost[k] += rule.cost[k] * count;
      const out = { type: item.type, count, code: item.code, immediate: mobilize };
      normalized.push(out); if (mobilize) immediate.push(out);
    }
    for (const [code, count] of Object.entries(locations)) {
      const t = this.terr[code], waiting = this.game.production.filter(p => p.code === code).reduce((n, p) => n + p.count, 0);
      const cap = t.industrySlotsTotal ? this.capacity(code) : t.stratValue;
      check(count + waiting <= cap, `${code} 产能不足：上限 ${cap}，待部署 ${waiting}，本次 ${count}`);
    }
    const cg = resources(civilianPayment); check(sum(cg) % 5 === 0, "每份民用物资须支付任意组合的5个资源");
    for (const k of Object.keys(cost)) cost[k] += cg[k];
    check(nation !== "china" || cost.oil === 0, "中国不能使用石油");
    for (const k of Object.keys(cost)) check(this.game.nations[nation].resources[k] >= cost[k], `${k} 储量不足`);
    return { items: normalized, cost, civilianGoods: sum(cg) / 5, civilianPayment: cg, locations, immediate };
  }
  setProduction(msg) {
    this.phase("phase7_production"); const n = this.nation(msg.nation); check(!n.confirmed, "请先取消本国确认，再修改生产清单");
    const preview = this.productionPreview(msg.nation, msg.items, msg.civilianPayment);
    this.game.productionDrafts[msg.nation] = preview; return preview;
  }
  settleProduction() {
    // Validate every draft first. Engine transactions roll back if immediate deployment fails.
    const drafts = Object.entries(this.game.productionDrafts).map(([nation, draft]) => [nation, this.productionPreview(nation, draft.items, draft.civilianPayment)]);
    for (const [nation, draft] of drafts) {
      spend(this.game.nations[nation].resources, draft.cost); this.game.nations[nation].civilianGoods += draft.civilianGoods;
      for (const item of draft.items) {
        if (item.immediate) this.addUnits(nation, item.code, item.type, item.count);
        else this.game.production.push({ id: `P${this.game.round}-${nation}-${this.game.production.length}`, nation, type: item.type, code: item.code, count: item.count, readyRound: this.game.round + 1 });
      }
      this.report("production", `${nation} 生产结算`, { nation, ...draft, remaining: this.game.nations[nation].resources });
    }
    this.game.productionDrafts = {};
  }
  trade(msg) {
    this.phase("phase7_production"); const n = this.nation(msg.nation), t = DATA.neutrals.find(t => t.code === msg.code), st = this.game.territories[msg.code];
    check(!n.confirmed && !n.traded && msg.nation !== "china" && n.zone < 4, "本国已确认、已交易或不能获得贸易收入");
    check(t && t.trades[msg.receive] && !st.embattled, "中立贸易地或资源无效");
    const affiliation = st.owner ? R.NATION_ALLIANCE[st.owner] : st.neutralAlliance || (t.neutralAffiliation === "pro-allied" ? "allies" : null);
    check(!affiliation || affiliation === R.NATION_ALLIANCE[msg.nation], "该中立国不与本国联盟交易");
    const land = t.adjacentTo.some(code => this.terr[code]?.type === "land" && ally(msg.nation, this.game.territories[code]?.owner) && !this.game.territories[code].embattled);
    const sea = n.zone < 2 && this.ports(msg.code).some(code => {
      const units = Object.values(this.game.units).filter(u => u.code === code && u.domain === "sea");
      return !units.some(u => !ally(msg.nation, u.nation)) && (R.NATION_ALLIANCE[msg.nation] === "allies" || affiliation === "axis" || units.some(u => ally(msg.nation, u.nation)));
    });
    check(land || sea, "没有可用的陆路或海上贸易路线");
    const rates = { oil: 2, iron: 3, osr: 5 }, paid = resources(msg.payment), batches = integer(msg.batches ?? 1, 1, 20);
    check(paid[msg.receive] === 0, "不能使用该中立国提供的同种资源付款");
    // Mixed resources represent exact fractions of a trade bundle (LCM 30).
    check(paid.oil * 15 + paid.iron * 10 + paid.osr * 6 === batches * 30, "贸易比例为石油2 : 钢铁3 : 其他5，请支付整组资源");
    spend(n.resources, paid); n.resources[msg.receive] += rates[msg.receive] * batches; n.traded = true;
    // Existing drafts must remain affordable after trade.
    const draft = this.game.productionDrafts[msg.nation]; if (draft) this.productionPreview(msg.nation, draft.items, draft.civilianPayment);
    this.report("trade", `${msg.nation} 完成中立贸易`, { nation: msg.nation, code: msg.code, paid, received: { [msg.receive]: rates[msg.receive] * batches } });
  }
  landAir(msg) {
    this.phase("phase5_refit"); const u = this.game.units[msg.unitId]; check(u && u.nation === msg.nation && u.domain === "air" && u.needsLanding, "这支空军不需要着陆");
    if (msg.destroy) { check(!Object.keys(this.movement.routes(u, true)).length, "存在合法着陆地，不能主动摧毁部队"); for (const [type, count] of Object.entries(u.units)) this.casualty(u.nation, type, count); delete this.game.units[u.id]; this.report("landing", "空军无法着陆，移入伤亡区", { unitId: u.id }); return; }
    const route = this.movement.validate(u, msg.code, true), from = u.code; u.code = msg.code; u.needsLanding = false;
    this.report("landing", `${u.id} 着陆 ${msg.code}`, { nation: u.nation, unitId: u.id, from, to: msg.code, route });
  }
  deploy(msg) {
    this.phase("phase5_refit"); this.nation(msg.nation);
    const p = this.game.production.find(p => p.id === msg.productionId); check(p && p.nation === msg.nation && p.readyRound <= this.game.round, "没有可部署的生产单位");
    const count = integer(msg.count ?? p.count, 1, p.count), domain = DATA.units[p.type].domain;
    check(domain === "sea" ? this.ports(p.code).includes(msg.code) : msg.code === p.code, "部署位置必须是生产地，海军必须部署到该港口相连海区");
    const used = this.game.deployedAt?.[p.code] || 0; check(used + count <= this.capacity(p.code), "轰炸后的烟囱容量不足，请选择超额单位移入伤亡区");
    this.addUnits(p.nation, msg.code, p.type, count); p.count -= count;
    this.game.deployedAt[p.code] = used + count; this.game.production = this.game.production.filter(p => p.count > 0);
    this.report("deployment", `${msg.nation} 部署 ${count} 个 ${p.type}`, { nation: p.nation, type: p.type, count, from: p.code, to: msg.code });
  }
  deferDeployment(msg) {
    this.phase("phase5_refit"); const p = this.game.production.find(p => p.id === msg.productionId);
    check(p && p.nation === msg.nation && p.readyRound <= this.game.round, "生产单位不存在");
    const domain = DATA.units[p.type].domain, codes = domain === "sea" ? this.ports(p.code) : [p.code];
    const canFit = codes.some(code => Object.values(this.game.units).some(u => u.nation === p.nation && u.domain === domain && u.code === code && u.unitCount < 8));
    check(this.freeFormation(p.nation, domain) === undefined && !canFit, "仍有可用番号或现役部队空间，不能转为待入编");
    p.deferredRound = this.game.round;
    this.report("deployment", "番号不足，单位保留为待入编", { nation: p.nation, type: p.type, count: p.count, code: p.code });
  }
  discardProduction(msg) {
    this.phase("phase5_refit"); const p = this.game.production.find(p => p.id === msg.productionId); check(p && p.nation === msg.nation && p.readyRound <= this.game.round, "生产单位不存在");
    const ready = this.game.production.filter(item => item.code === p.code && item.readyRound <= this.game.round).reduce((n, item) => n + item.count, 0);
    const excess = Math.max(0, ready + (this.game.deployedAt[p.code] || 0) - this.capacity(p.code)), count = integer(msg.count, 1, p.count);
    check(count <= excess, "只能摧毁因轰炸而超过部署产能的单位");
    this.casualty(p.nation, p.type, count); p.count -= count; this.game.production = this.game.production.filter(p => p.count > 0);
    this.report("deployment", "超额生产单位移入伤亡区", { nation: p.nation, type: p.type, count });
  }
  reorganize(msg) {
    check(["phase2_planning", "phase5_refit"].includes(this.game.phase), "只能在规划或改装部署阶段重调部队");
    const nation = this.nation(msg.nation); check(!nation.confirmed, "请先取消确认");
    check(Array.isArray(msg.unitIds) && msg.unitIds.length > 0 && new Set(msg.unitIds).size === msg.unitIds.length, "请选择不同的部队");
    const src = msg.unitIds.map(id => this.game.units[id]), first = src[0];
    check(first && src.every(u => u && u.nation === msg.nation && u.code === first.code && u.domain === first.domain), "只能重调同国、同区域、同大类部队");
    check(src.every(u => !!u.needsLanding === !!first.needsLanding), "待着陆空军不能与已着陆空军合并");
    const total = {}; for (const u of src) for (const [type, count] of Object.entries(u.units)) total[type] = (total[type] || 0) + count;
    check(Array.isArray(msg.groups) && msg.groups.length > 0 && msg.groups.length <= 30, "拆分方案无效");
    const next = {};
    for (const group of msg.groups) {
      check(group && typeof group === "object" && !Array.isArray(group) && sum(group) > 0 && sum(group) <= 8, "每个部队须有1至8个单位");
      for (const [type, count] of Object.entries(group)) { check(DATA.units[type]?.domain === first.domain, "兵种大类不匹配"); integer(count); next[type] = (next[type] || 0) + count; }
    }
    check([...new Set([...Object.keys(total), ...Object.keys(next)])].every(type => (total[type] || 0) === (next[type] || 0)), "重调不能增加或移除单位");
    const nums = (this.formations[msg.nation]?.[first.domain] || []).filter(num => !Object.values(this.game.units).some(u => u.nation === msg.nation && u.domain === first.domain && u.num === num && !msg.unitIds.includes(u.id)));
    check(nums.length >= msg.groups.length, "空余番号不足");
    if (msg.numbers) check(Array.isArray(msg.numbers) && msg.numbers.length === msg.groups.length && new Set(msg.numbers).size === msg.numbers.length && msg.numbers.every(num => nums.includes(num)), "所选番号不可用或重复");
    for (const id of msg.unitIds) delete this.game.units[id];
    msg.groups.forEach((group, i) => { const num = msg.numbers?.[i] ?? (i < src.length ? src[i].num : nums.find(n => !Object.values(this.game.units).some(u => u.nation === msg.nation && u.domain === first.domain && u.num === n))); const id = `${msg.nation}-${first.domain}-${num}`; this.game.units[id] = { ...clone(first), id, num, face: first.face.replace(/_\d+\.png$/, `_${num}.png`), units: clone(group), unitCount: sum(group) }; });
    for (const n of Object.values(this.game.nations)) n.orders = n.orders.map(o => o && msg.unitIds.includes(o.formationId) ? null : o);
    this.report("reorganization", "部队重调完成", { nation: msg.nation, code: first.code, groups: msg.groups });
  }
  reorganizeArea(msg) {
    check(Array.isArray(msg.operations) && msg.operations.length > 0 && msg.operations.length <= 3, "重调方案无效");
    for (const operation of msg.operations) this.reorganize({ ...operation, nation: msg.nation });
  }
  startMorale() {
    this.game.morale = { step: "cancel", submitted: {}, casualties: {}, reports: {} };
    for (const [nation, n] of Object.entries(this.game.nations)) {
      const value = Object.entries(n.casualties).reduce((sum, [type, count]) => sum + count * (type === "convoy_casualty" ? 6 : DATA.units[type].casualtyValue), 0), stress = casualtyStress(value);
      this.game.morale.casualties[nation] = { counts: clone(n.casualties), value, stress }; n.stress += stress; n.casualties = {};
    }
    this.report("morale", "伤亡转换为压力", this.game.morale.casualties);
  }
  morale(msg) {
    this.phase("phase6_morale"); const n = this.nation(msg.nation), m = this.game.morale;
    check(msg.step === m.step && !m.submitted[msg.nation], "当前步骤已提交或已变化");
    const order = this.game.roundOrder.length ? this.game.roundOrder : Object.keys(this.game.nations);
    check(order.find(id => !this.game.nations[id].collapsed && !m.submitted[id]) === msg.nation, "请按回合顺位逐国完成当前压力步骤");
    let details;
    if (["cancel", "relieve"].includes(m.step)) {
      const medals = integer(msg.medals ?? 0), cg = integer(msg.civilianGoods ?? 0), total = medals + cg;
      check(medals <= n.medals && cg <= n.civilianGoods, "奖章或民用物资不足");
      if (m.step === "cancel") { check(total <= n.stress, "支出不能超过当前压力"); n.stress -= total; }
      else { check(total === 0 || (n.zone > 0 && total === n.threshold), "缓解一级须恰好支付压力阈值数量的奖章/民用物资"); if (total) n.zone--; }
      n.medals -= medals; n.civilianGoods -= cg; details = { medals, civilianGoods: cg, stress: n.stress, zone: n.zone };
    } else if (m.step === "penalty") {
      const cost = resources(msg.payment || ZERO()), need = n.zone >= 1 ? Math.min(3, sum(n.resources)) : 0;
      check(sum(cost) === need && (msg.nation !== "china" || cost.oil === 0), `须支付 ${need} 个可用资源`); spend(n.resources, cost); details = { paid: cost };
    } else if (m.step === "desert") {
      const available = Object.values(this.game.units).filter(u => u.nation === msg.nation && !u.carrierFighter).reduce((s, u) => s + u.unitCount, 0), need = n.zone === 5 ? Math.min(n.stress, available) : 0;
      check(Array.isArray(msg.losses) && msg.losses.length <= 100, "请选择叛逃单位"); let total = 0; const combined = new Map();
      for (const loss of msg.losses) { const u = this.game.units[loss.unitId], count = integer(loss.count, 1, 80); check(u && u.nation === msg.nation && !u.carrierFighter && DATA.units[loss.type], "叛逃单位无效"); const key = `${loss.unitId}:${loss.type}`; combined.set(key, (combined.get(key) || 0) + count); check(combined.get(key) <= (u.units[loss.type] || 0), "叛逃数量超过现有单位"); total += count; }
      check(total === need, `须选择 ${need} 个单位叛逃`);
      for (const loss of msg.losses) { this.game.units[loss.unitId].units[loss.type] -= loss.count; this.casualty(msg.nation, loss.type, loss.count); } this.cleanUnits(); details = { losses: msg.losses, stress: n.stress };
    }
    check(details, "未知压力步骤"); m.submitted[msg.nation] = details;
    if (Object.entries(this.game.nations).every(([id, n]) => n.collapsed || m.submitted[id])) {
      this.report("morale", `压力步骤 ${m.step} 已结算`, m.submitted); m.reports[m.step] = clone(m.submitted); m.submitted = {};
      if (m.step === "cancel") {
        for (const [id, n] of Object.entries(this.game.nations)) {
          if (n.collapsed) continue;
          while (n.stress >= n.threshold && n.zone < 5) { n.zone++; n.stress -= n.threshold; }
          const hasUnits = Object.values(this.game.units).some(u => u.nation === id && !u.carrierFighter), hasLand = Object.values(this.game.territories).some(t => t.owner === id);
          if ((!hasUnits || !hasLand) && n.zone < 5) n.zone++;
        }
        m.step = "relieve";
      } else m.step = { relieve: "penalty", penalty: "desert", desert: "done" }[m.step];
      if (m.step === "done") this.expireTreaties();
    }
  }
  expireTreaties() {
    const g = this.game; if (g.nations.japan.zone >= 4 || g.nations.soviet.zone >= 4) g.treaties.sovietJapan = false;
    if (g.nations.china.zone >= 4 || g.nations.soviet.zone >= 4) g.treaties.sinoSoviet = false;
    if (g.nations.soviet.zone >= 4) g.treaties.stalin = false;
  }
  breakTreaty(msg) {
    check(!["phase6_morale", "phase7_production"].includes(this.game.phase), "压力和生产阶段不能主动撕毁条约");
    check(["japan", "soviet"].includes(msg.nation) && this.game.treaties.sovietJapan, "苏日条约已经失效或本国不是缔约方");
    this.game.treaties.sovietJapan = false; this.nation(msg.nation).stress += 6; this.game.treatyBroken = { nation: msg.nation, round: this.game.round };
    this.report("treaty", "苏日中立条约被打破", { nation: msg.nation, addedStress: 6 });
  }
  enemies(a, b) { return !ally(a, b) && !(this.game.treaties.sovietJapan && [a, b].includes("japan") && [a, b].includes("soviet")); }
  activateNeutral(unit) {
    const t = DATA.neutrals.find(t => t.code === unit.code), st = this.game.territories[unit.code];
    if (!t || st.owner || st.neutralActivated || (t.neutralAffiliation === "pro-allied" && R.NATION_ALLIANCE[unit.nation] === "allies")) return;
    st.neutralActivated = true; st.neutralAlliance = R.NATION_ALLIANCE[unit.nation] === "axis" ? "allies" : "axis";
    this.nation(unit.nation).stress++; const forces = clone(t.neutralForces);
    for (const domain of ["land", "air"]) {
      const units = Object.fromEntries(Object.entries(forces).filter(([type, count]) => count && DATA.units[type].domain === domain));
      if (sum(units)) { const id = `neutral-${unit.code}-${domain}`; this.game.units[id] = { id, nation: "neutral", alliance: st.neutralAlliance, domain, num: 0, code: unit.code, units, unitCount: sum(units), face: "Neutral_land_front_cn.jpg", neutral: true }; }
    }
    this.report("neutral", `${unit.code} 中立卫戍激活`, { invader: unit.nation, stress: 1, forces });
  }
  portAdvantage(code, alliance, nations) {
    return Object.entries(DATA.ports).some(([land, zones]) => {
      const st = this.game.territories[land], owner = st?.owner;
      if (!zones.includes(code) || st.bombTokens || this.game.nations[owner]?.zone >= 2) return false;
      if (this.game.treaties.sovietJapan && ((owner === "japan" && nations.includes("soviet")) || (owner === "soviet" && nations.includes("japan")))) return false;
      return R.NATION_ALLIANCE[owner] === alliance || (!owner && (st.neutralAlliance === alliance || (!st.neutralAlliance && alliance === "allies" && DATA.neutrals.find(t => t.code === land)?.neutralAffiliation === "pro-allied")));
    });
  }
  convoyTargets(code, alliance) {
    return DATA.convoys.map((convoy, index) => ({ ...convoy, id: `C${index}` })).filter(c => {
      if (c.seaRegion !== code || this.game.combat?.raided.includes(c.id)) return false;
      if (c.type === "coastal") return this.game.territories[c.linkedTerritory]?.owner && R.NATION_ALLIANCE[this.game.territories[c.linkedTerritory].owner] !== alliance;
      const a = this.game.territories[c.origin]?.owner, b = this.game.territories[c.destination]?.owner;
      return a && b && ally(a, b) && R.NATION_ALLIANCE[a] !== alliance;
    }).map(c => ({ ...c, owner: c.type === "coastal" ? this.game.territories[c.linkedTerritory].owner : (R.NATION_ALLIANCE[c.defaultControllerNation] === R.NATION_ALLIANCE[this.game.territories[c.origin].owner] ? c.defaultControllerNation : this.game.territories[c.origin].owner) }));
  }
  startCombat() {
    const g = this.game; g.combat = { pending: [], current: null, completed: [], raided: [], usedRaiders: [], battleZones: [], pickerIndex: 0, order: (g.roundOrder.length ? g.roundOrder : Object.keys(g.nations)).filter(id => !g.nations[id].collapsed) };
    for (const code of Object.keys(this.terr)) {
      const units = Object.values(g.units).filter(u => u.code === code), t = this.terr[code], st = g.territories[code];
      const sides = new Set(units.map(u => u.alliance === "allied" ? "allies" : u.alliance));
      const actualConflict = units.some(a => units.some(b => (a.nation === "neutral" || b.nation === "neutral") ? a.alliance !== b.alliance : this.enemies(a.nation, b.nation)));
      const invasion = t.type === "land" && units.some(u => u.domain === "land" && u.nation !== "neutral" && (st.owner ? this.enemies(u.nation, st.owner) : !(st.neutralAlliance === u.alliance || (DATA.neutrals.find(n => n.code === code)?.neutralAffiliation === "pro-allied" && u.alliance === "allies"))));
      const bombing = t.type === "land" && st.owner && units.some(u => u.units.bomber && this.enemies(u.nation, st.owner));
      if (actualConflict || invasion || bombing) { g.combat.pending.push({ id: `battle-${code}`, code, kind: "battle", nations: [...new Set([...units.map(u => u.nation).filter(n => n !== "neutral"), st.owner].filter(Boolean))], sides: [...sides] }); g.combat.battleZones.push(code); }
    }
    this.refreshRaids();
    this.updatePicker();
  }
  refreshRaids() {
    const g = this.game, c = g.combat;
    c.pending = c.pending.filter(task => task.kind !== "convoy");
    for (const code of Object.keys(this.terr).filter(code => this.terr[code].type === "sea" && !c.battleZones.includes(code))) {
      const units = Object.values(g.units).filter(u => u.code === code && u.domain !== "land");
      for (const alliance of ["axis", "allies"]) {
        const attackers = units.filter(u => u.alliance === alliance && !c.usedRaiders.includes(u.id)), guards = units.filter(u => u.alliance !== alliance);
        if (!attackers.length || guards.length) continue;
        const groups = new Map();
        for (const target of this.convoyTargets(code, alliance)) {
          if (!attackers.some(u => this.enemies(u.nation, target.owner))) continue;
          const key = target.clusterId || target.id;
          if (!groups.has(key)) groups.set(key, []); groups.get(key).push(target);
        }
        for (const [group, targets] of groups) {
          // A formation attacks a single convoy or cluster. Treaty-exempt formations cannot add dice.
          const raiders = attackers.filter(u => targets.every(t => this.enemies(u.nation, t.owner)));
          if (raiders.length) c.pending.push({ id: `raid-${code}-${alliance}-${group}`, kind: "convoy", code, alliance, group, nations: [...new Set(raiders.map(u => u.nation))], raiderIds: raiders.map(u => u.id), targets });
        }
      }
    }
  }
  updatePicker() {
    const c = this.game.combat;
    if (!c.pending.length) { c.picker = null; return; }
    for (let i = 0; i < c.order.length; i++) {
      const nation = c.order[c.pickerIndex % c.order.length];
      if (c.pending.some(b => b.nations.includes(nation))) { c.picker = nation; return; }
      c.pickerIndex++;
    }
    check(false, "热点没有可结算的国家");
  }
  chooseBattle(msg) {
    this.phase("phase4_combat"); const c = this.game.combat; check(!c.current && c.picker === msg.nation, "请等待当前国家选择热点");
    const task = c.pending.find(t => t.id === msg.battleId); check(task && task.nations.includes(msg.nation), "本国不能选择此热点");
    if (task.kind === "convoy") {
      const ids = msg.raiderIds || task.raiderIds;
      check(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => task.raiderIds.includes(id)), "请选择可参与此次突袭的部队");
      c.current = { ...clone(task), raiderIds: ids, step: "convoy", dice: null }; return;
    }
    const units = Object.values(this.game.units).filter(u => u.code === task.code), surface = this.terr[task.code].type === "sea" ? "sea" : "land", tokens = [];
    for (const u of units) {
      if (surface === "sea" && u.domain === "land") continue;
      for (const [type, count] of Object.entries(u.units)) for (let i = 0; i < count; i++) tokens.push({ id: `${u.id}:${type}:${i}`, formationId: u.id, nation: u.nation, alliance: u.alliance === "allied" ? "allies" : u.alliance, type, domain: DATA.units[type].domain, stance: defaultStance(type), damage: 0, destroyed: false, withdrawn: false });
      if (u.domain === "air") u.needsLanding = !u.neutral && !u.carrierFighter;
    }
    const nations = [...new Set(tokens.map(t => t.nation).filter(n => n !== "neutral"))], order = c.order;
    const commanders = {};
    for (const side of ["axis", "allies"]) commanders[side] = order.find(n => tokens.some(t => t.nation === n && t.alliance === side)) || (tokens.some(t => t.nation === "neutral" && t.alliance === side) ? msg.nation : null);
    const sides = ["axis", "allies"].sort((a, b) => order.indexOf(commanders[a]) - order.indexOf(commanders[b]));
    const current = { ...clone(task), surface, step: "setup", tokens, nations, commanders, sides, stage: null, advantage: {}, ports: {}, remainingDice: {}, dice: null, bombingQueue: [], bombLoss: ZERO(), rolls: [], garrison: false };
    for (const side of ["axis", "allies"]) current.ports[side] = surface === "sea" && this.portAdvantage(task.code, side, nations);
    const owner = this.game.territories[task.code].owner, invading = tokens.filter(t => t.domain === "land" && (!owner || this.enemies(t.nation, owner)));
    current.garrison = surface === "land" && invading.length > 0 && !tokens.some(t => t.alliance !== invading[0].alliance && ["land", "air"].includes(t.domain));
    c.current = current;
  }
  battle() { this.phase("phase4_combat"); const b = this.game.combat.current; check(b && b.kind === "battle", "没有当前战斗"); return b; }
  setStance(msg) {
    const b = this.battle(), token = b.tokens.find(t => t.id === msg.tokenId); check(b.step === "setup" && token && (msg.nation === token.nation || (token.nation === "neutral" && msg.nation === b.commanders[token.alliance])), "只能在战斗初设时选择本国单位姿态");
    check(STANCES[token.type][msg.stance], "此兵种没有该姿态"); check(!(b.surface === "sea" && msg.stance === "strategic"), "海上不能执行战略轰炸"); token.stance = msg.stance;
  }
  setFront(msg) {
    const b = this.battle(), token = b.tokens.find(t => t.id === msg.tokenId);
    check(b.step === "setup" && !b.fronts && this.game.treaties.sovietJapan && token && token.nation === msg.nation && !["japan", "soviet"].includes(token.nation), "只能在初设时分配本国的第三方单位");
    check(["japan", "soviet"].includes(msg.front), "条约战斗分组无效"); token.front = msg.front;
  }
  setCommander(msg) {
    const b = this.battle(), side = R.NATION_ALLIANCE[msg.nation];
    check(b.step === "setup" && b.nations.includes(msg.nation) && b.tokens.some(t => t.nation === msg.commander && t.alliance === side), "只能在初设时从本方参战国选指挥官");
    b.commanders[side] = msg.commander;
    const order = this.game.combat.order; b.sides.sort((a, c) => order.indexOf(b.commanders[a]) - order.indexOf(b.commanders[c]));
  }
  activateFront(b, index) {
    b.frontIndex = index; b.tokens = clone(b.fronts[index].tokens); b.frontName = b.fronts[index].name;
    b.step = "setup"; b.stage = null; b.dice = null; b.bombDice = null; b.bombingQueue = []; b.rolls = []; b.garrison = false;
    const order = this.game.combat.order;
    b.nations = [...new Set(b.tokens.map(t => t.nation).filter(n => n !== "neutral"))];
    for (const side of ["axis", "allies"]) b.ports[side] = b.surface === "sea" && this.portAdvantage(b.code, side, b.nations);
    for (const side of ["axis", "allies"]) if (!b.tokens.some(t => t.nation === b.commanders[side] && t.alliance === side)) b.commanders[side] = order.find(n => b.tokens.some(t => t.nation === n && t.alliance === side)) || (b.tokens.some(t => t.nation === "neutral" && t.alliance === side) ? b.nations[0] : null);
    b.sides = ["axis", "allies"].sort((a, c) => order.indexOf(b.commanders[a]) - order.indexOf(b.commanders[c]));
  }
  dice(count) { return Array.from({ length: count }, () => DIE[this.randomInt(DIE.length)]); }
  startBattle(msg) {
    const b = this.battle(); check(b.step === "setup" && b.nations.includes(msg.nation), "不能开始此战斗");
    if (!b.fronts && this.game.treaties.sovietJapan && b.tokens.some(t => t.nation === "japan") && b.tokens.some(t => t.nation === "soviet")) {
      const roots = ["japan", "soviet"].sort((a, c) => this.game.combat.order.indexOf(a) - this.game.combat.order.indexOf(c));
      b.fronts = roots.map(root => ({ name: root, tokens: b.tokens.filter(t => (["japan", "soviet"].includes(t.nation) ? t.nation : t.front || roots[0]) === root) }));
      this.activateFront(b, 0);
    }
    if (b.garrison) {
      const dice = this.dice(2), color = dice.includes("white") ? null : dice[0] === "black" ? dice[1] : dice[1] === "black" || dice[0] === dice[1] ? dice[0] : null;
      const owner = this.game.territories[b.code].owner, attackers = b.tokens.filter(t => t.domain === "land" && (!owner || this.enemies(t.nation, owner)));
      const targets = color ? attackers.filter(t => color === "black" || UNIT_COLOR[t.type] === color).map(t => t.id) : [];
      b.rolls.push({ stage: "garrison", dice }); b.garrisonTargets = targets;
      b.step = targets.length ? "garrison_hit" : "report"; b.dice = { faces: dice, remaining: targets.length ? [color] : [], side: attackers[0]?.alliance };
      return;
    }
    this.beginStage(b, "air");
  }
  stageValue(token, b, stage) {
    if (token.destroyed || token.withdrawn) return 0;
    const stance = STANCES[token.type][token.stance];
    if (stage === "air") return stance.air;
    if (token.domain === "air") {
      if (["ground", "surface"].includes(token.stance)) return b.surface === "sea" ? stance.sea ?? stance.surface : stance.surface;
      return 0;
    }
    return token.domain === b.surface ? stance.surface : 0;
  }
  beginStage(b, stage) {
    b.stage = stage; b.step = "roll"; b.dice = null;
    if (stage === "surface") {
      const counts = Object.fromEntries(["axis", "allies"].map(side => [side, new Set(b.tokens.filter(t => !t.destroyed && !t.withdrawn && t.alliance === side && t.domain === b.surface).map(t => t.type)).size]));
      b.advantage = { axis: counts.axis > counts.allies, allies: counts.allies > counts.axis };
    }
    b.remainingDice = Object.fromEntries(["axis", "allies"].map(side => {
      let count = b.tokens.filter(t => t.alliance === side).reduce((sum, token) => sum + this.stageValue(token, b, stage), 0);
      if (stage === "surface" && b.ports[side] && b.tokens.some(t => t.alliance === side && t.domain === "sea" && !t.destroyed)) count += 2;
      return [side, Math.min(30, count)];
    }));
    if (stage === "air" && !b.tokens.some(t => t.domain === "air" && !t.destroyed)) b.remainingDice = { axis: 0, allies: 0 };
    if (new Set(b.tokens.filter(t => !t.destroyed && !t.withdrawn).map(t => t.alliance)).size < 2 && b.fronts) b.remainingDice = { axis: 0, allies: 0 };
    b.turnSideIndex = 0; this.nextRoll(b);
  }
  nextRoll(b) {
    b.dice = null;
    if (!Object.values(b.remainingDice).some(n => n > 0)) {
      if (b.stage === "air") {
        const owner = this.game.territories[b.code].owner;
        b.bombingQueue = b.tokens.filter(t => t.type === "bomber" && t.stance === "strategic" && !t.destroyed && owner && this.enemies(t.nation, owner)).map(t => t.id);
        if (b.bombingQueue.length) { b.step = "bombing"; return; }
        this.beginStage(b, "surface");
      } else b.step = "report";
      return;
    }
    for (let i = 0; i < 2; i++) { const side = b.sides[b.turnSideIndex % 2]; if (b.remainingDice[side] > 0) { b.turn = side; b.step = "roll"; return; } b.turnSideIndex++; }
  }
  rollCombat(msg) {
    const b = this.battle(); check(b.step === "roll" && msg.nation === b.commanders[b.turn], "还未轮到此方指挥官投骰");
    const count = Math.min(10, b.remainingDice[b.turn]), faces = this.dice(count); b.remainingDice[b.turn] -= count;
    b.rolls.push({ stage: b.stage, side: b.turn, faces });
    b.dice = { side: b.turn, faces, remaining: [...faces].sort((a, b) => COLORS.indexOf(a) - COLORS.indexOf(b)) };
    b.step = "hits"; this.skipMisses(b);
  }
  hitTargets(b, color) {
    const enemy = b.dice.side === "axis" ? "allies" : "axis";
    if (b.stage === "surface" && b.advantage[enemy] && ["black", "white"].includes(color)) return [];
    const targets = b.tokens.filter(t => !t.destroyed && !t.withdrawn && t.alliance === enemy && t.domain === (b.stage === "air" ? "air" : b.surface) && (color === "black" || (color === "white" ? t.type !== "submarine" && t.damage >= STANCES[t.type][t.stance].hits - 1 : UNIT_COLOR[t.type] === color)));
    // A row is defined by unit type and stance. Damaged units in that row take hits first, across allies.
    return targets.filter(t => !targets.some(other => other.type === t.type && other.stance === t.stance && other.damage > t.damage));
  }
  skipMisses(b) {
    while (b.dice.remaining.length && !this.hitTargets(b, b.dice.remaining[0]).length) b.dice.remaining.shift();
    if (!b.dice.remaining.length) this.finishBatch(b);
  }
  kill(token) { token.destroyed = true; this.casualty(token.nation, token.type); }
  assignHit(msg) {
    const b = this.battle();
    if (b.step === "garrison_hit") {
      check(b.nations.includes(msg.nation) && b.garrisonTargets.includes(msg.tokenId), "常备部队命中目标无效"); this.kill(b.tokens.find(t => t.id === msg.tokenId)); b.dice.remaining = []; b.step = "report"; return;
    }
    check(b.step === "hits" && msg.nation === b.commanders[b.dice.side], "当前指挥官才能分配命中");
    const color = b.dice.remaining[0], targets = this.hitTargets(b, color), token = targets.find(t => t.id === msg.tokenId); check(token, "该目标不符合当前颜色、战斗阶段或伤损优先规则");
    let hit = token;
    if (msg.guardId) {
      const guard = b.tokens.find(t => t.id === msg.guardId);
      check(b.stage === "surface" && ["carrier", "battleship"].includes(token.type) && guard && guard.type === "cruiser" && guard.stance === "escort" && guard.alliance === token.alliance && !guard.destroyed, "巡洋舰不能护卫此命中"); hit = guard;
    }
    hit.damage++; if (hit.damage >= STANCES[hit.type][hit.stance].hits) this.kill(hit);
    b.dice.remaining.shift(); this.skipMisses(b);
  }
  discardHit(msg) {
    const b = this.battle(); check(b.step === "hits" && msg.nation === b.commanders[b.dice.side] && b.dice.remaining[0] === "black", "只能主动放弃黑色万能命中"); b.dice.remaining.shift(); this.skipMisses(b);
  }
  finishBatch(b) {
    for (const token of b.tokens) if (token.type === "submarine" && token.damage && !token.destroyed) token.withdrawn = true;
    b.turnSideIndex++; this.nextRoll(b);
  }
  rollBombing(msg) {
    const b = this.battle(), token = b.tokens.find(t => t.id === b.bombingQueue[0]); check(b.step === "bombing" && !b.bombDice && token && msg.nation === token.nation, "未轮到本国轰炸机");
    b.bombDice = this.dice(4); b.rolls.push({ stage: "bombing", bomber: token.id, faces: clone(b.bombDice) });
  }
  assignBombing(msg) {
    const b = this.battle(), bomber = b.tokens.find(t => t.id === b.bombingQueue[0]); check(b.step === "bombing" && b.bombDice?.length && msg.nation === bomber.nation, "没有待分配的轰炸结果");
    const face = b.bombDice[0], color = face === "black" ? msg.color : face;
    check(["yellow", "blue", "green", "red", "white", "miss"].includes(color) && (face === "black" || color === face || msg.target === "miss"), "轰炸颜色选择无效");
    const st = this.game.territories[b.code], owner = st.owner, n = this.game.nations[owner];
    if (msg.target !== "miss") {
      if (color === "white") { check(msg.target === "facility", "白色只能命中设施"); const max = this.terr[b.code].industrySlotsTotal || 1; st.bombTokens = Math.min(max, st.bombTokens + 1); }
      else if (msg.productionId) {
        const p = this.game.production.find(p => p.id === msg.productionId); check(p && p.code === b.code && p.nation === owner && UNIT_COLOR[p.type] === color, "此生产单位不是合法轰炸目标"); p.count--; this.casualty(owner, p.type); this.game.production = this.game.production.filter(p => p.count > 0);
      } else {
        const kind = { yellow: "osr", blue: "iron", red: "oil" }[color]; check(kind && msg.target === kind, "该颜色不能扣减这种资源");
        const yieldValue = (st.embattled ? this.terr[b.code].embattledResources || this.terr[b.code].resources : this.terr[b.code].resources)[kind];
        check(n.resources[kind] > 0 && b.bombLoss[kind] < yieldValue, "资源为零或已达本次突袭损失上限"); n.resources[kind]--; b.bombLoss[kind]++;
      }
    }
    b.bombDice.shift();
    if (!b.bombDice.length) { b.bombDice = null; b.bombingQueue.shift(); if (!b.bombingQueue.length) this.beginStage(b, "surface"); }
  }
  rollConvoy(msg) {
    this.phase("phase4_combat"); const b = this.game.combat.current; check(b?.kind === "convoy" && !b.dice && b.nations.includes(msg.nation), "没有可投骰的护航突袭");
    const count = Math.min(30, b.raiderIds.reduce((s, id) => s + this.game.units[id].unitCount, 0));
    b.dice = this.dice(count);
  }
  finishConvoy(msg) {
    this.phase("phase4_combat"); const c = this.game.combat, b = c.current; check(b?.kind === "convoy" && b.dice && b.nations.includes(msg.nation), "没有待结算护航突袭");
    const blacks = b.dice.filter(c => c === "black").length, choices = msg.blackColors || [];
    check(Array.isArray(choices) && choices.length === blacks && choices.every(c => ["yellow", "blue", "red", "miss"].includes(c)), "请为每个黑色骰面选择资源颜色或未命中");
    const hit = new Set([...b.dice.filter(c => c !== "black"), ...choices]), losses = [];
    for (const target of b.targets) {
      const n = this.game.nations[target.owner], lost = ZERO();
      for (const [kind, color] of [["oil", "red"], ["iron", "blue"], ["osr", "yellow"]]) if (hit.has(color)) {
        const st = this.game.territories[target.linkedTerritory], t = this.terr[target.linkedTerritory];
        const cap = target.type === "coastal" ? (st.embattled ? t.embattledResources || t.resources : t.resources)[kind] : Infinity;
        lost[kind] = Math.min(n.resources[kind], target.dice[kind], cap); n.resources[kind] -= lost[kind];
      }
      losses.push({ id: target.id, nation: target.owner, lost }); c.raided.push(target.id);
    }
    this.sinkTransports(b.code);
    c.usedRaiders.push(...b.raiderIds);
    this.report("convoy", `${b.code} 护航舰队突袭结算`, { dice: b.dice, blackColors: choices, losses }); this.completeHotspot(b.id);
  }
  sinkTransports(code) {
    const units = Object.values(this.game.units).filter(u => u.code === code);
    for (const u of units.filter(u => u.domain === "land" && !u.neutral)) {
      const own = units.filter(v => v.domain !== "land" && ally(u.nation, v.nation)), enemy = units.filter(v => v.domain !== "land" && this.enemies(u.nation, v.nation));
      const ownOnlySubs = own.length > 0 && own.every(v => Object.keys(v.units).every(type => type === "submarine"));
      if (enemy.length && (!own.length || (ownOnlySubs && enemy.some(v => v.domain === "air")))) { for (const [type, count] of Object.entries(u.units)) this.casualty(u.nation, type, count); delete this.game.units[u.id]; }
    }
  }
  finishBattle(msg) {
    const b = this.battle(); check(b.step === "report" && b.nations.includes(msg.nation), "战斗尚未完成投骰和命中分配");
    const repairs = msg.repairs || {}, payments = msg.payments || {};
    check(repairs && typeof repairs === "object" && payments && typeof payments === "object", "维修方案无效");
    check(Object.keys(repairs).every(n => b.nations.includes(n)) && Object.keys(payments).every(n => b.nations.includes(n)), "维修方案包含非参战国");
    const damaged = b.tokens.filter(t => !t.destroyed && t.damage >= STANCES[t.type][t.stance].hits - 1 && t.type !== "submarine");
    for (const [nation, ids] of Object.entries(repairs)) {
      check(Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(id => damaged.some(t => t.id === id && t.nation === nation)), "维修目标重复或不是本国受损单位");
    }
    for (const nation of b.nations) {
      const ids = repairs[nation] || [], charged = ids.filter(id => { const t = damaged.find(t => t.id === id); return !(t.domain === "sea" && b.ports[t.alliance]); }).length;
      const cost = resources(payments[nation] || ZERO()); check(sum(cost) === charged, `${nation} 维修须支付 ${charged} 个资源`); check(nation !== "china" || cost.oil === 0, "中国不能使用石油"); spend(this.game.nations[nation].resources, cost);
    }
    for (const token of damaged) if (!(token.domain === "sea" && b.ports[token.alliance]) && !(repairs[token.nation] || []).includes(token.id)) this.kill(token);
    // Rebuild participating formations from surviving pieces. Casualties were recorded at destruction.
    for (const id of new Set(b.tokens.map(t => t.formationId))) {
      const unit = this.game.units[id]; if (!unit) continue;
      // A formation can contribute pieces to both treaty fronts. Preserve pieces that haven't fought yet.
      for (const token of b.tokens.filter(t => t.formationId === id && t.destroyed)) unit.units[token.type]--;
    }
    this.cleanUnits(); if (b.surface === "sea") this.sinkTransports(b.code);
    const st = this.game.territories[b.code], oldOwner = st.owner;
    const allLand = Object.values(this.game.units).filter(u => u.code === b.code && u.domain === "land"), land = allLand.filter(u => !u.neutral), sides = new Set(allLand.map(u => u.alliance));
    const occupiers = [...new Set(land.map(u => u.nation))].filter(nation => (!oldOwner || this.enemies(nation, oldOwner)) && !allLand.some(u => u.neutral ? u.alliance !== R.NATION_ALLIANCE[nation] : this.enemies(nation, u.nation)));
    let captured = null;
    if (b.surface === "land" && occupiers.length) {
      const candidates = occupiers;
      const selected = msg.owner || candidates[0]; check(candidates.includes(selected), "新控制国必须有陆军在该领土幸存");
      const home = homeland(this.terr[b.code]); captured = ally(selected, home) && this.game.nations[home] && this.game.nations[home].zone < 5 && !this.game.nations[home].collapsed ? home : selected;
      st.owner = captured; st.embattled = false;
      if (oldOwner && oldOwner !== captured) this.game.nations[oldOwner].stress += this.terr[b.code].stratValue;
      const neutral = this.terr[b.code].startingOwner === "neutral";
      const broken = this.game.treatyBroken, forbidMedal = broken?.round === this.game.round && broken.nation === selected && [selected, oldOwner].includes("japan") && [selected, oldOwner].includes("soviet");
      const count = neutral || forbidMedal ? 0 : this.terr[b.code].isCapital ? 3 : 1;
      const medals = msg.medalNation || selected; check(!count || b.nations.includes(medals) && ally(medals, selected), "奖章只能分配给本场友方参战国"); if (count) this.game.nations[medals].medals += count;
      for (const p of this.game.production.filter(p => p.code === b.code)) { p.nation = captured; p.readyRound = this.game.round; }
      this.game.production = this.game.production.filter(p => !(p.code === b.code && captured === "china" && DATA.units[p.type].domain !== "land"));
    } else st.embattled = b.surface === "land" && allLand.some(a => allLand.some(c => a.neutral || c.neutral ? a.alliance !== c.alliance : this.enemies(a.nation, c.nation)));
    if (b.surface === "sea") { const surface = Object.values(this.game.units).filter(u => u.code === b.code && u.domain === "sea"); st.embattled = surface.some(a => surface.some(c => this.enemies(a.nation, c.nation))); }
    if (["G1", "R1"].some(code => this.game.territories[code].embattled || this.game.territories[code].owner !== this.terr[code].startingOwner)) this.game.treaties.sovietJapan = false;
    this.report("battle", `${b.code}${b.frontName ? ` · ${b.frontName}条约分组` : ""} 战斗报告`, { code: b.code, rolls: b.rolls, losses: b.tokens.filter(t => t.destroyed).map(t => ({ nation: t.nation, type: t.type })), repairs, payments, oldOwner, owner: st.owner, captured, embattled: st.embattled, bombingLoss: b.bombLoss, bombTokens: st.bombTokens });
    if (b.fronts && b.frontIndex + 1 < b.fronts.length) { this.activateFront(b, b.frontIndex + 1); return; }
    this.completeHotspot(b.id);
  }
  completeHotspot(id) {
    const c = this.game.combat; c.pending = c.pending.filter(t => t.id !== id); c.completed.push(id); c.current = null; c.pickerIndex++; this.refreshRaids(); this.updatePicker();
  }
  launchCarrier(msg) {
    this.phase("phase3_movement"); check(this.game.movePhase.done, "请先完成所有移动指令");
    const u = this.game.units[msg.unitId]; check(u && u.nation === msg.nation && u.units.carrier && !u.launched, "没有可出动舰载机的航空母舰");
    const proxy = { ...u, domain: "air" }; this.movement.validate(proxy, msg.code);
    const used = Object.values(this.game.units).filter(u => u.carrierFighter).reduce((n, u) => n + u.unitCount, 0), count = integer(msg.count ?? u.units.carrier, 1, u.units.carrier);
    check(used + count <= 16, "舰载机指示物总数不能超过16");
    const id = `${u.id}-CF`; this.game.units[id] = { ...clone(u), id, domain: "air", code: msg.code, face: `CarrierFighter_${u.alliance === "axis" ? "axis" : "allied"}.png`, units: { carrier_fighter: count }, unitCount: count, carrierFighter: true, needsLanding: false }; u.launched = true;
    this.report("carrier", "舰载战斗机出动", { nation: u.nation, carrier: u.id, code: msg.code, count });
  }
  endRound() {
    const g = this.game;
    for (const [id, n] of Object.entries(g.nations)) if (n.zone === 5 && !Object.values(g.units).some(u => u.nation === id && !u.carrierFighter)) { n.collapsed = true; n.resources = ZERO(); this.report("collapse", `${id} 国家崩溃`, { nation: id }); }
    const owns = (code, alliance) => {
      const owner = g.territories[code]?.owner;
      if (R.NATION_ALLIANCE[owner] === alliance) return true;
      return owner && g.nations[owner]?.collapsed && !Object.values(g.units).some(u => u.code === code && ally(u.nation, owner));
    };
    const axis = ["B1", "R1", "U1"].filter(code => owns(code, "axis")).length >= 2, allies = ["G1", "J1"].every(code => owns(code, "allies"));
    if (!Object.values(g.units).some(u => !u.carrierFighter)) { g.status = "finished"; g.winner = "draw"; }
    else if (axis !== allies) { g.status = "finished"; g.winner = axis ? "axis" : "allies"; }
    if (g.status === "finished") this.report("victory", "全球战场胜利检查", { winner: g.winner, axisCapitals: ["B1", "R1", "U1"].filter(c => owns(c, "axis")), alliedCapitals: ["G1", "J1"].filter(c => owns(c, "allies")) });
  }
  enter(phase) {
    if (phase === "phase4_combat") this.startCombat();
    if (phase === "phase5_refit") { this.game.deployedAt = {}; for (const [id, u] of Object.entries(this.game.units)) if (u.carrierFighter) delete this.game.units[id]; }
    if (phase === "phase6_morale") this.startMorale();
  }
  ready() {
    const g = this.game;
    if (g.phase === "phase2_planning") check(g.turnOrder.done && g.turnOrder.paid, "请先完成竞价选位与石油支付");
    if (g.phase === "phase3_movement") check(g.movePhase.done, "还有移动指令待结算");
    if (g.phase === "phase4_combat") check(!g.combat.current && g.combat.pending.length === 0, "还有热点战斗或突袭待结算");
    if (g.phase === "phase5_refit") {
      check(!Object.values(g.units).some(u => u.domain === "air" && u.needsLanding), "还有空军待着陆");
      check(!g.production.some(p => p.readyRound <= g.round && p.deferredRound !== g.round && g.territories[p.code].owner === p.nation), "还有生产单位待部署或待入编");
    }
    if (g.phase === "phase6_morale") check(g.morale.step === "done", "请先完成压力结算各步骤");
  }
  handle(msg) {
    const actions = { set_production: "setProduction", trade: "trade", land_air: "landAir", deploy: "deploy", defer_deployment: "deferDeployment", discard_production: "discardProduction", reorganize: "reorganize", reorganize_area: "reorganizeArea", morale_submit: "morale", break_treaty: "breakTreaty", choose_battle: "chooseBattle", set_stance: "setStance", set_front: "setFront", set_commander: "setCommander", start_battle: "startBattle", roll_combat: "rollCombat", assign_hit: "assignHit", discard_hit: "discardHit", finish_battle: "finishBattle", roll_bombing: "rollBombing", assign_bombing: "assignBombing", roll_convoy: "rollConvoy", finish_convoy: "finishConvoy", launch_carrier: "launchCarrier" };
    const method = actions[msg.action]; if (!method) return false; this[method](msg); return true;
  }
}
module.exports = { Settlements };
