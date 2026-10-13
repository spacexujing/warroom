"use strict";
const { ally, check, DATA, NATION_ALLIANCE } = require("./rules");
const RAlliance = nation => NATION_ALLIANCE[nation];
const LIBERATED = { G7: "soviet", G6: "soviet", J3: "china", J4: "china", J5: "china", J15: "china", J16: "china" };
function homeland(t) { return LIBERATED[t.code] || t.startingOwner; }
class MovementRules {
  constructor(game, territories, channels, rails) { this.game = game; this.terr = territories; this.channels = channels; this.rails = rails; }
  treatyAllows(unit, code, landing = false) {
    const g = this.game, owner = g.territories[code]?.owner, home = homeland(this.terr[code] || {});
    if (g.treaties?.sovietJapan && ["soviet", "japan"].includes(unit.nation)) {
      const other = unit.nation === "soviet" ? "japan" : "soviet";
      if (owner === other || (code.startsWith("N") && Object.values(g.units).some(u => u.nation === other && u.code === code))) return false;
      if (unit.nation === "soviet" && unit.domain === "land" && code.startsWith("P") && this.terr[code]?.type === "sea") return false;
    }
    if (g.treaties?.sinoSoviet && ["china", "soviet"].includes(unit.nation)) {
      const other = unit.nation === "china" ? "soviet" : "china";
      if (owner === other && home === other && (unit.domain === "land" || landing)) return false;
    }
    if (g.treaties?.stalin && ["britain", "usa"].includes(unit.nation) && home === "soviet") {
      if (landing) return false;
      if (owner === "soviet" && unit.domain === "land") {
        const units = Object.values(g.units).filter(u => u.code === code && u.domain === "land");
        if (!units.some(u => !ally(u.nation, unit.nation) || ["britain", "usa"].includes(u.nation))) return false;
      }
    }
    return true;
  }
  channelOpen(channel, nation) {
    return channel.controllerTerritories.every(code => {
      const owner = this.game.territories[code]?.owner;
      return ally(nation, owner) || (!owner && nation !== "germany" && nation !== "italy" && nation !== "japan" && DATA.neutrals.find(n => n.code === code)?.neutralAffiliation === "pro-allied");
    });
  }
  neighbors(code, unit) {
    let out = [...(this.terr[code]?.adjacentTo || [])];
    if (unit.domain === "air") {
      for (const ch of this.channels) if (ch.seaZones.includes(code)) out.push(ch.seaZones.find(c => c !== code));
    } else {
      for (const ch of this.channels) if (ch.seaZones.includes(code)) {
        const other = ch.seaZones.find(c => c !== code);
        out = out.filter(c => c !== other);
        if (this.channelOpen(ch, unit.nation)) out.push(other);
      }
    }
    return [...new Set(out)].filter(c => this.terr[c] && this.treatyAllows(unit, c));
  }
  railPassable(code, unit) {
    const st = this.game.territories[code];
    const neutral = DATA.neutrals.find(t => t.code === code), affiliation = st?.neutralAlliance || (neutral?.neutralAffiliation === "pro-allied" ? "allies" : null);
    const friendly = ally(unit.nation, st?.owner) || (!st?.owner && affiliation === RAlliance(unit.nation));
    if (!st || !friendly || st.bombTokens > 0 || this.game.nations[st.owner]?.zone >= 2 || !this.treatyAllows(unit, code)) return false;
    return !Object.values(this.game.units).some(u => u.code === code && u.domain === "land" && (u.neutral ? u.alliance !== RAlliance(unit.nation) : !ally(unit.nation, u.nation)));
  }
  routes(unit, landing = false) {
    const result = { [unit.code]: [unit.code] }, start = this.terr[unit.code];
    if (!start) return result;
    const queue = [[unit.code]];
    while (queue.length) {
      const path = queue.shift(), code = path.at(-1), hops = path.length - 1;
      if (hops >= 2) continue;
      for (const next of this.neighbors(code, unit)) {
        if (path.includes(next)) continue;
        const t = this.terr[next];
        let valid = true;
        if (unit.domain === "sea") valid = t.type === "sea";
        if (unit.domain === "air") valid = t.type !== "barrier" || t.airOnly;
        if (unit.domain === "land") {
          valid = t.type !== "barrier" && !t.airOnly;
          if (unit.nation === "china" && t.type === "sea") valid = false;
          if (start.type === "land" && hops === 1) valid = this.terr[code]?.type === "sea" && t.type === "sea";
          if (start.type === "sea" && hops === 1) valid = this.terr[code]?.type === "sea" && t.type === "sea";
        }
        if (!valid) continue;
        const route = [...path, next];
        if (t.type !== "barrier" && !result[next]) result[next] = route;
        if (!(unit.domain === "land" && t.type === "land")) queue.push(route);
      }
    }
    if (unit.domain === "land" && start.type === "land" && this.railPassable(unit.code, unit)) {
      const rails = [[unit.code]], visited = new Set([unit.code]);
      while (rails.length) {
        const path = rails.shift();
        for (const next of this.rails[path.at(-1)] || []) if (!visited.has(next) && this.railPassable(next, unit)) {
          visited.add(next); const route = [...path, next];
          if (!result[next]) { result[next] = route; result[next].rail = true; }
          rails.push(route);
        }
      }
    }
    if (landing) for (const code of Object.keys(result)) if (this.terr[code]?.type !== "land" || !ally(unit.nation, this.game.territories[code]?.owner) || !this.treatyAllows(unit, code, true)) delete result[code];
    return result;
  }
  validate(unit, destination, landing = false, chosenRoute = null) {
    check(unit && this.terr[destination], "部队或目的地不存在");
    if (chosenRoute) {
      check(Array.isArray(chosenRoute) && chosenRoute.length > 0 && chosenRoute.length <= 191 && chosenRoute[0] === unit.code && chosenRoute.at(-1) === destination && new Set(chosenRoute).size === chosenRoute.length, "路线须从部队当前位置开始、在目的地结束，且不能重复经过区域");
      const route = [...chosenRoute], rail = unit.domain === "land" && route.every(code => this.terr[code]?.type === "land" && this.railPassable(code, unit)) && route.slice(1).every((code, i) => this.rails[route[i]]?.includes(code));
      if (rail) { route.rail = true; return route; }
      check(route.length <= 3, "普通移动路线最多两步");
      for (let i = 1; i < route.length; i++) {
        const t = this.terr[route[i]]; check(t && this.neighbors(route[i - 1], unit).includes(route[i]), "路线相邻关系、通道或条约不满足");
        if (unit.domain === "sea") check(t.type === "sea", "海军只能经过海洋区域");
        if (unit.domain === "land") { check(t.type !== "barrier" && !t.airOnly && !(unit.nation === "china" && t.type === "sea"), "陆军不能经过该区域"); if (i === 2) check(this.terr[route[1]].type === "sea" && t.type === "sea", "陆军两步移动仅允许海上运输"); }
        if (unit.domain === "air") check(t.type !== "barrier" || t.airOnly, "空军不能经过该区域");
      }
      check(this.terr[destination].type !== "barrier", "不能在不可驻留区域结束移动");
      if (landing) check(this.routes(unit, true)[destination], "该目的地不能着陆");
      return route;
    }
    const path = this.routes(unit, landing)[destination];
    check(path, landing ? "无法在两步内到达合法友方着陆地" : "目的地不可达：请检查距离、兵种、铁路、海峡及条约");
    return path;
  }
  pinned(unit, code = unit.code, dest) {
    if (unit.domain === "air") return { pinned: false, partial: false, X: 0 };
    const transport = unit.domain === "land" && this.terr[code]?.type === "sea";
    if (transport && this.terr[dest]?.type === "land" && ally(unit.nation, this.game.territories[dest]?.owner)) return { pinned: false, partial: false, X: 0 };
    const domain = transport ? "sea" : unit.domain;
    let own = 0, enemy = 0;
    for (const u of Object.values(this.game.units)) {
      if (u.code !== code || u.domain !== domain) continue;
      if (ally(unit.nation, u.nation) || (u.neutral && u.alliance === RAlliance(unit.nation))) own += u.unitCount;
      else if (!(this.game.treaties?.sovietJapan && [unit.nation, u.nation].includes("japan") && [unit.nation, u.nation].includes("soviet"))) enemy += u.unitCount;
    }
    if (!enemy) return { pinned: false, partial: false, X: 0 };
    const pinned = transport ? enemy > own : enemy >= own;
    const X = transport || pinned ? 0 : Math.max(0, enemy - (own - unit.unitCount));
    return { pinned, partial: X > 0, X };
  }
}
module.exports = { MovementRules, homeland };
