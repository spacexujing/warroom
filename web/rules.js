"use strict";
const DATA = require("./rule-data.json");
const NATION_ALLIANCE = { germany: "axis", italy: "axis", japan: "axis", britain: "allies", soviet: "allies", usa: "allies", china: "allies" };
const PHASES = ["phase1_economy", "phase2_planning", "phase3_movement", "phase4_combat", "phase5_refit", "phase6_morale", "phase7_production"];
const COLORS = ["yellow", "blue", "green", "red", "black", "white"];
// Rulebook p.3: a twelve-sided die, with unequal color frequencies.
const DIE = ["yellow", "yellow", "yellow", "yellow", "blue", "blue", "blue", "green", "green", "red", "black", "white"];
const UNIT_COLOR = { infantry: "yellow", artillery: "blue", armor: "green", fighter: "green", bomber: "red", submarine: "yellow", cruiser: "blue", carrier: "green", battleship: "red", carrier_fighter: "green" };
const STANCES = {
  infantry: { defensive: { air: 0, surface: 1, hits: 2 }, offensive: { air: 0, surface: 2, hits: 1 } },
  artillery: { anti_air: { air: 2, surface: 1, hits: 2 }, ground: { air: 0, surface: 2, hits: 2 } },
  armor: { defensive: { air: 1, surface: 2, hits: 3 }, offensive: { air: 0, surface: 4, hits: 2 } },
  fighter: { air: { air: 3, surface: 0, hits: 2 }, surface: { air: 0, surface: 3, hits: 2 } },
  bomber: { ground: { air: 1, surface: 4, sea: 3, hits: 2 }, strategic: { air: 1, surface: 0, hits: 2 } },
  submarine: { dive: { air: 0, surface: 2, hits: 2 } },
  cruiser: { escort: { air: 2, surface: 2, hits: 2 }, offensive: { air: 1, surface: 3, hits: 2 } },
  carrier: { anti_air: { air: 2, surface: 1, hits: 3 }, offensive: { air: 1, surface: 2, hits: 3 } },
  battleship: { anti_air: { air: 2, surface: 3, hits: 3 }, offensive: { air: 1, surface: 4, hits: 3 } },
  carrier_fighter: { air: { air: 3, surface: 0, hits: 2 }, surface: { air: 0, surface: 3, hits: 2 } },
};
const ZERO = () => ({ oil: 0, iron: 0, osr: 0 });
const clone = value => JSON.parse(JSON.stringify(value));
const ally = (a, b) => !!NATION_ALLIANCE[a] && NATION_ALLIANCE[a] === NATION_ALLIANCE[b];
function check(ok, message, code = "INVALID_ACTION") { if (!ok) { const error = new Error(message); error.code = code; throw error; } }
function integer(value, min = 0, max = 10000) { check(Number.isSafeInteger(value) && value >= min && value <= max, `数量必须是 ${min} 至 ${max} 的整数`); return value; }
function resources(value) {
  check(value && typeof value === "object" && !Array.isArray(value), "请选择资源组合");
  check(Object.keys(value).every(k => ["oil", "iron", "osr"].includes(k)), "未知资源种类");
  return Object.fromEntries(["oil", "iron", "osr"].map(k => [k, integer(value[k] ?? 0)]));
}
function spend(stock, cost) { for (const k of Object.keys(cost)) check(stock[k] >= cost[k], `${k} 储量不足`); for (const k of Object.keys(cost)) stock[k] -= cost[k]; }
function casualtyStress(value) { return [18, 34, 50, 68, 88, 108].filter(max => value > max).length; }
function orderLimit(nation, state) { return Math.max(0, (nation === "china" || nation === "italy" ? 6 : 9) - (state.zone >= 3 ? 3 : 0)); }
function defaultStance(type) { return Object.keys(STANCES[type])[0]; }
module.exports = { DATA, PHASES, NATION_ALLIANCE, COLORS, DIE, UNIT_COLOR, STANCES, ZERO, clone, ally, check, integer, resources, spend, casualtyStress, orderLimit, defaultStance };
