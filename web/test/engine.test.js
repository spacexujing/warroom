"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createEngine } = require("../engine"), R = require("../rules");
function setup(options) {
  const engine = createEngine(options), replies = [], connection = { send: msg => replies.push(msg) };
  return { ...engine, replies, send(msg) { replies.length = 0; engine.dispatch(connection, JSON.stringify(msg)); return replies.find(r => r.type === "error") || replies.at(-1); }, raw(raw) { replies.length = 0; engine.dispatch(connection, raw); return replies.at(-1); } };
}
function ok(e, msg) { const reply = e.send(msg); assert.notEqual(reply?.type, "error", reply?.message); return reply; }
function phase(e, key) { e.game.phase = key; e.game.phaseIndex = R.PHASES.indexOf(key); for (const n of Object.values(e.game.nations)) n.confirmed = false; }
function stack(nation, domain, num, code, units) { return { id: `${nation}-${domain}-${num}`, nation, alliance: R.NATION_ALLIANCE[nation], domain, num, code, units, unitCount: Object.values(units).reduce((a, b) => a + b), face: `${nation}_${domain}_${num}.png` }; }
test("malformed, null, oversized and debug messages cannot change state", () => {
  const e = setup(), before = JSON.stringify(e.game);
  for (const raw of ["{", "null", "[]", JSON.stringify({ action: "patch", patch: { round: 100 } }), "x".repeat(65537)]) assert.equal(e.raw(raw).type, "error");
  assert.equal(JSON.stringify(e.game), before);
});
test("optimistic revisions and request IDs prevent repeat payments", () => {
  const e = setup(); ok(e, { action: "force_confirm", requestId: "economy", revision: 0 });
  const stock = { ...e.game.nations.germany.resources }, revision = e.game.revision;
  ok(e, { action: "force_confirm", requestId: "economy" }); assert.deepEqual(e.game.nations.germany.resources, stock); assert.equal(e.game.revision, revision);
  assert.equal(e.send({ action: "set_bid", nation: "germany", value: 1, revision: 0 }).code, "STALE_STATE");
});
test("planning validates nation, destination, duplicate formation and finite bids", () => {
  const e = setup(); ok(e, { action: "force_confirm" });
  for (const msg of [{ action: "set_order", nation: "germany", index: 0, order: { formationId: "britain-land-53", dest: "B1" } }, { action: "set_order", nation: "germany", index: 0, order: { formationId: "germany-land-48", dest: "INVALID" } }, { action: "set_bid", nation: "china", value: 1 }]) assert.equal(e.send(msg).type, "error");
  ok(e, { action: "set_order", nation: "germany", index: 0, order: { formationId: "germany-land-48", dest: "G2" } });
  assert.equal(e.send({ action: "set_order", nation: "germany", index: 1, order: { formationId: "germany-land-48", dest: "G2" } }).type, "error");
});
test("bids are frozen, all slots chosen and payment applied exactly once", () => {
  const e = setup({ randomInt: () => 0 }); ok(e, { action: "force_confirm" });
  ok(e, { action: "set_bid", nation: "germany", value: 2 }); const oil = e.game.nations.germany.resources.oil;
  assert.equal(e.send({ action: "force_confirm" }).type, "error"); ok(e, { action: "start_turn_order" });
  assert.equal(e.send({ action: "set_bid", nation: "germany", value: 0 }).type, "error");
  while (!e.game.turnOrder.done) { const nation = e.game.turnOrder.queue[e.game.turnOrder.currentIndex], slot = e.game.turnOrder.picks.indexOf(null); ok(e, { action: "pick_slot", nation, slot }); }
  assert.equal(e.game.nations.germany.resources.oil, oil - 2); ok(e, { action: "pay_bids" }); assert.equal(e.game.nations.germany.resources.oil, oil - 2);
});
test("pinning counts the matching surface domain and ignores air", () => {
  const e = setup(), a = stack("germany", "land", 48, "G1", { infantry: 2 }), b = stack("soviet", "air", 11, "G1", { fighter: 8 }); e.game.units = { [a.id]: a, [b.id]: b };
  assert.equal(e.movement.pinned(a).pinned, false);
  const c = stack("soviet", "land", 21, "G1", { infantry: 1 }); e.game.units[c.id] = c;
  assert.deepEqual(e.movement.pinned(a), { pinned: false, partial: true, X: 1 });
});
test("naval travel rejects land, China transports and blocked canals", () => {
  const e = setup(), u = stack("germany", "sea", 1, "M1", { cruiser: 1 });
  assert.throws(() => e.movement.validate(u, "B3")); assert.equal(e.movement.routes(u).A15, undefined);
  const china = stack("china", "land", 100, "J4", { infantry: 1 }); assert.throws(() => e.movement.validate(china, "P0"));
});
test("treaties restrict entry and can only be broken once", () => {
  const e = setup(), u = stack("japan", "air", 11, "R16", { fighter: 1 }); assert.equal(e.movement.treatyAllows(u, "R1"), false);
  ok(e, { action: "break_treaty", nation: "japan" }); assert.equal(e.game.nations.japan.stress, 6); assert.equal(e.send({ action: "break_treaty", nation: "japan" }).type, "error");
});
test("production previews are pure and purchases become available next round", () => {
  const e = setup(); phase(e, "phase7_production"); e.game.nations.germany.resources = { oil: 10, iron: 10, osr: 10 };
  const operation = { action: "set_production", nation: "germany", items: [{ type: "fighter", count: 2, code: "G1" }], civilianPayment: { oil: 1, iron: 2, osr: 2 } }, before = JSON.stringify(e.game);
  const preview = e.send({ action: "preview", operation }); assert.equal(preview.type, "preview"); assert.deepEqual(preview.production.cost, { oil: 5, iron: 4, osr: 4 }); assert.equal(JSON.stringify(e.game), before);
  ok(e, operation); ok(e, { action: "force_confirm" }); assert.deepEqual(e.game.nations.germany.resources, { oil: 5, iron: 6, osr: 6 }); assert.equal(e.game.nations.germany.civilianGoods, 1); assert.equal(e.game.production[0].readyRound, 2); assert.equal(e.game.round, 2);
});
test("production rejects naval factories without port and overcapacity atomically", () => {
  const e = setup(); phase(e, "phase7_production"); e.game.nations.germany.resources = { oil: 100, iron: 100, osr: 100 };
  assert.equal(e.send({ action: "set_production", nation: "germany", items: [{ type: "infantry", count: 9, code: "G1" }] }).type, "error");
  assert.equal(e.send({ action: "set_production", nation: "germany", items: [{ type: "carrier", count: 1, code: "G4" }] }).type, "error"); assert.deepEqual(e.game.productionDrafts, {});
});
test("Chinese infantry mobilizes immediately, artillery waits and no armor purchases", () => {
  const e = setup(); phase(e, "phase7_production"); e.game.territories.J4.owner = "china"; e.game.nations.china.resources = { oil: 0, iron: 5, osr: 10 };
  assert.equal(e.send({ action: "set_production", nation: "china", items: [{ type: "armor", count: 1, code: "J4" }] }).type, "error");
  ok(e, { action: "set_production", nation: "china", items: [{ type: "infantry", count: 1, code: "J4" }, { type: "artillery", count: 1, code: "J4" }] }); ok(e, { action: "force_confirm" });
  assert.ok(Object.values(e.game.units).some(u => u.nation === "china" && u.code === "J4")); assert.equal(e.game.production[0].type, "artillery");
});
test("deployment uses designated port and aircraft must land at a friendly territory", () => {
  const e = setup(); phase(e, "phase5_refit"); e.game.deployedAt = {}; e.game.production = [{ id: "p", nation: "germany", code: "G1", type: "cruiser", count: 1, readyRound: 1 }];
  assert.equal(e.send({ action: "deploy", nation: "germany", productionId: "p", code: "A6" }).type, "error"); ok(e, { action: "deploy", nation: "germany", productionId: "p", code: "A5" }); assert.equal(e.game.production.length, 0);
  const air = e.game.units["germany-air-11"]; air.needsLanding = true; assert.equal(e.send({ action: "land_air", nation: "germany", unitId: air.id, code: "B1" }).type, "error"); ok(e, { action: "land_air", nation: "germany", unitId: air.id, code: "G1" }); assert.equal(e.game.units[air.id].needsLanding, false);
});
test("reorganization conserves pieces and refuses duplicate sources", () => {
  const e = setup(); phase(e, "phase5_refit"); const id = "germany-land-48", original = JSON.stringify(e.game.units[id].units);
  assert.equal(e.send({ action: "reorganize", nation: "germany", unitIds: [id, id], groups: [{ infantry: 6 }] }).type, "error");
  assert.equal(JSON.stringify(e.game.units[id].units), original);
  ok(e, { action: "reorganize", nation: "germany", unitIds: [id], groups: [{ armor: 2, artillery: 2 }, { infantry: 3 }] });
  assert.equal(Object.values(e.game.units).filter(u => u.nation === "germany" && u.code === "G1" && u.domain === "land").reduce((s, u) => s + u.unitCount, 0), 7);
});
test("casualty table follows printed ranges and morale advances through barriers", () => {
  assert.deepEqual([0, 18, 20, 34, 36, 50, 52, 68, 70, 88, 90, 108, 110, 200].map(R.casualtyStress), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  const e = setup(); phase(e, "phase6_morale"); e.game.nations.germany.casualties = { battleship: 1, bomber: 1 }; e.settlement.startMorale(); assert.equal(e.game.nations.germany.stress, 1);
  for (const id of Object.keys(e.game.nations)) ok(e, { action: "morale_submit", nation: id, step: "cancel" }); assert.equal(e.game.morale.step, "relieve");
  assert.equal(e.send({ action: "morale_submit", nation: "germany", step: "cancel" }).type, "error");
});
test("red-zone economy adds no resources", () => { const e = setup(); e.game.nations.germany.zone = 4; ok(e, { action: "force_confirm" }); assert.deepEqual(e.game.nations.germany.resources, R.ZERO()); });
test("twelve-sided dice preserve correct color weights", () => { assert.deepEqual(R.DIE.reduce((o, c) => (o[c] = (o[c] || 0) + 1, o), {}), { yellow: 4, blue: 3, green: 2, red: 1, black: 1, white: 1 }); });
function battleSetup(randomInt = () => 0) {
  const e = setup({ randomInt }); phase(e, "phase4_combat"); const a = stack("germany", "land", 48, "G1", { infantry: 2 }), b = stack("soviet", "land", 21, "G1", { infantry: 2 }); e.game.units = { [a.id]: a, [b.id]: b }; e.game.roundOrder = ["germany", "soviet", "italy", "japan", "britain", "usa", "china"]; e.settlement.startCombat(); ok(e, { action: "choose_battle", nation: "germany", battleId: "battle-G1" }); return e;
}
test("combat freezes dice totals, applies damage first and never allows repeated rolls", () => {
  const e = battleSetup(); ok(e, { action: "start_battle", nation: "germany" }); let b = e.game.combat.current; assert.equal(b.stage, "surface"); assert.equal(b.remainingDice.allies, 2);
  ok(e, { action: "roll_combat", nation: "germany" }); assert.equal(e.send({ action: "roll_combat", nation: "germany" }).type, "error");
  const target = b.tokens.find(t => t.nation === "soviet"); ok(e, { action: "assign_hit", nation: "germany", tokenId: target.id });
  const other = b.tokens.find(t => t.nation === "soviet" && t.id !== target.id); assert.equal(e.send({ action: "assign_hit", nation: "germany", tokenId: other.id }).type, "error");
  ok(e, { action: "assign_hit", nation: "germany", tokenId: target.id }); b = e.game.combat.current; assert.equal(b.remainingDice.allies, 2); assert.equal(e.game.nations.soviet.casualties.infantry, 1);
});
test("garrison rolls two dice and capture awards pressure and medals", () => {
  const e = setup({ randomInt: () => 11 }); phase(e, "phase4_combat"); const u = stack("soviet", "land", 21, "G1", { infantry: 2 }); e.game.units = { [u.id]: u }; e.game.roundOrder = ["soviet", "germany"]; e.settlement.startCombat();
  ok(e, { action: "choose_battle", nation: "soviet", battleId: "battle-G1" }); ok(e, { action: "start_battle", nation: "soviet" }); assert.equal(e.game.combat.current.step, "report");
  ok(e, { action: "finish_battle", nation: "soviet", owner: "soviet", medalNation: "soviet" }); assert.equal(e.game.territories.G1.owner, "soviet"); assert.equal(e.game.nations.germany.stress, 8); assert.equal(e.game.nations.soviet.medals, 3);
});
test("neutral garrison activates once with printed Sweden artillery count", () => {
  const e = setup(); const u = stack("germany", "land", 48, "N10", { infantry: 3 }); e.game.units = { [u.id]: u }; e.settlement.activateNeutral(u); e.settlement.activateNeutral(u); assert.equal(e.game.nations.germany.stress, 1); assert.equal(e.game.units["neutral-N10-land"].units.artillery, 1);
});
test("autosave can restore the exact committed revision", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warroom-test-")), savePath = path.join(dir, "game.json");
  try { const e = setup({ savePath }); ok(e, { action: "force_confirm" }); const restored = setup({ savePath }); assert.equal(restored.game.revision, 1); assert.deepEqual(restored.game.nations.germany.resources, e.game.nations.germany.resources); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("bombing consumes current stock only up to territory yield; duplicate allocation fails", () => {
  const e = setup({ randomInt: () => 0 }); phase(e, "phase4_combat"); const u = stack("germany", "air", 11, "R1", { bomber: 1 }); e.game.units = { [u.id]: u }; e.game.roundOrder = ["germany", "soviet"];
  e.game.nations.soviet.resources = { oil: 10, iron: 10, osr: 10 }; e.settlement.startCombat(); ok(e, { action: "choose_battle", nation: "germany", battleId: "battle-R1" });
  const token = e.game.combat.current.tokens[0]; ok(e, { action: "set_stance", nation: "germany", tokenId: token.id, stance: "strategic" }); ok(e, { action: "start_battle", nation: "germany" });
  ok(e, { action: "roll_combat", nation: "germany" }); assert.equal(e.game.combat.current.step, "bombing"); ok(e, { action: "roll_bombing", nation: "germany" });
  const cap = e.settlement.terr.R1.resources.osr;
  for (let i = 0; i < Math.min(cap, 4); i++) ok(e, { action: "assign_bombing", nation: "germany", target: "osr" });
  if (cap < 4) { const before = JSON.stringify(e.game); assert.equal(e.send({ action: "assign_bombing", nation: "germany", target: "osr" }).type, "error"); assert.equal(JSON.stringify(e.game), before); }
  while (e.game.combat.current.bombDice?.length) ok(e, { action: "assign_bombing", nation: "germany", target: "miss" });
  assert.equal(e.game.nations.soviet.resources.osr, 10 - Math.min(cap, 4)); assert.equal(e.game.combat.current.step, "report");
});
test("neutral defenders surviving combat prevent occupation", () => {
  const e = setup({ randomInt: () => 11 }); phase(e, "phase4_combat"); const u = stack("germany", "land", 48, "N10", { infantry: 3 }); e.game.units = { [u.id]: u }; e.game.roundOrder = ["germany", "soviet"]; e.settlement.activateNeutral(u); e.settlement.startCombat();
  ok(e, { action: "choose_battle", nation: "germany", battleId: "battle-N10" }); ok(e, { action: "start_battle", nation: "germany" });
  for (let i = 0; i < 30 && e.game.combat.current.step !== "report"; i++) { const b = e.game.combat.current; if (b.step === "roll") ok(e, { action: "roll_combat", nation: b.commanders[b.turn] }); else { const ids = e.settlement.hitTargets(b, b.dice.remaining[0]); ok(e, { action: "assign_hit", nation: b.commanders[b.dice.side], tokenId: ids[0].id }); } }
  ok(e, { action: "finish_battle", nation: "germany" }); assert.equal(e.game.territories.N10.owner, null); assert.equal(e.game.territories.N10.embattled, true);
});
test("one formation cannot raid multiple independent convoys in the same sea region", () => {
  const e = setup({ randomInt: () => 0 }); phase(e, "phase4_combat"); const u = stack("germany", "sea", 1, "A18", { cruiser: 2 }); e.game.units = { [u.id]: u }; e.game.roundOrder = ["germany", "britain"]; e.game.nations.britain.resources = { oil: 10, iron: 10, osr: 10 }; e.settlement.startCombat();
  const raids = e.game.combat.pending.filter(t => t.kind === "convoy"); assert.equal(raids.length, 3);
  ok(e, { action: "choose_battle", nation: "germany", battleId: raids[0].id }); ok(e, { action: "roll_convoy", nation: "germany" }); ok(e, { action: "finish_convoy", nation: "germany", blackColors: [] });
  assert.equal(e.game.combat.pending.length, 0); assert.equal(e.game.nations.britain.resources.osr, 9);
});
test("convoy clusters exclude separate circles and reject illegal black colors", () => {
  const e = setup({ randomInt: () => 10 }); phase(e, "phase4_combat"); const u = stack("germany", "sea", 1, "I1", { cruiser: 2 }); e.game.units = { [u.id]: u }; e.game.roundOrder = ["germany", "britain"]; e.game.nations.britain.resources = { oil: 10, iron: 10, osr: 10 }; e.settlement.startCombat();
  const raid = e.game.combat.pending[0]; assert.equal(raid.targets.length, 2); ok(e, { action: "choose_battle", nation: "germany", battleId: raid.id }); ok(e, { action: "roll_convoy", nation: "germany" });
  assert.equal(e.send({ action: "finish_convoy", nation: "germany", blackColors: ["green", "red"] }).type, "error"); ok(e, { action: "finish_convoy", nation: "germany", blackColors: ["red", "yellow"] });
  assert.deepEqual(e.game.nations.britain.resources, { oil: 8, iron: 10, osr: 10 });
});
test("naval transports sink without escort; submarines cannot protect them from air", () => {
  const e = setup(), transport = stack("germany", "land", 48, "A5", { infantry: 2 }), sub = stack("germany", "sea", 1, "A5", { submarine: 1 }), air = stack("britain", "air", 11, "A5", { fighter: 1 });
  e.game.units = Object.fromEntries([transport, sub, air].map(u => [u.id, u])); e.settlement.sinkTransports("A5"); assert.equal(e.game.units[transport.id], undefined); assert.equal(e.game.nations.germany.casualties.infantry, 2);
});
test("deployment capacity shrinks after bombing and only excess can be discarded", () => {
  const e = setup(); phase(e, "phase5_refit"); e.game.deployedAt = {}; e.game.territories.G1.bombTokens = 7; e.game.production = [{ id: "p", nation: "germany", code: "G1", type: "infantry", count: 2, readyRound: 1 }];
  assert.equal(e.send({ action: "deploy", nation: "germany", productionId: "p", code: "G1", count: 2 }).type, "error"); ok(e, { action: "discard_production", nation: "germany", productionId: "p", count: 1 });
  assert.equal(e.send({ action: "discard_production", nation: "germany", productionId: "p", count: 1 }).type, "error"); ok(e, { action: "deploy", nation: "germany", productionId: "p", code: "G1", count: 1 });
});
test("failed area reorganization rolls back earlier groups", () => {
  const e = setup(); phase(e, "phase5_refit"); const before = JSON.stringify(e.game);
  assert.equal(e.send({ action: "reorganize_area", nation: "germany", operations: [{ unitIds: ["germany-land-48"], groups: [{ armor: 2, artillery: 2, infantry: 3 }] }, { unitIds: ["germany-air-11"], groups: [{ fighter: 8 }] }] }).type, "error"); assert.equal(JSON.stringify(e.game), before);
});
test("trade follows neutral alignment, access, exchange ratio and once-per-round limit", () => {
  const e = setup(); phase(e, "phase7_production"); e.game.nations.usa.resources = { oil: 10, iron: 0, osr: 10 };
  ok(e, { action: "trade", nation: "usa", code: "N1", receive: "iron", payment: { oil: 2 }, batches: 1 }); assert.deepEqual(e.game.nations.usa.resources, { oil: 8, iron: 3, osr: 10 });
  assert.equal(e.send({ action: "trade", nation: "usa", code: "N1", receive: "iron", payment: { oil: 2 } }).type, "error");
});
test("global victory requires the specified capitals at round end", () => {
  const e = setup(); e.game.territories.G1.owner = "britain"; e.settlement.endRound(); assert.equal(e.game.status, "playing"); e.game.territories.J1.owner = "usa"; e.settlement.endRound(); assert.equal(e.game.winner, "allies");
});
test("morale threshold escalation, exact relief payment and orange command reduction", () => {
  const e = setup(); phase(e, "phase6_morale"); e.game.roundOrder = Object.keys(e.game.nations); const n = e.game.nations.germany; n.stress = 19; n.medals = 6; e.settlement.startMorale();
  for (const nation of e.game.roundOrder) ok(e, { action: "morale_submit", nation, step: "cancel" }); assert.equal(e.game.nations.germany.zone, 3); assert.equal(e.game.nations.germany.stress, 1); assert.equal(R.orderLimit("germany", e.game.nations.germany), 6);
  assert.equal(e.send({ action: "morale_submit", nation: "germany", step: "relieve", medals: 5 }).type, "error"); ok(e, { action: "morale_submit", nation: "germany", step: "relieve", medals: 6 }); assert.equal(e.game.nations.germany.zone, 2);
});
test("active Soviet-Japanese treaty splits a mixed hotspot into separate ordered fronts", () => {
  const e = setup({ randomInt: () => 11 }); phase(e, "phase4_combat");
  const units = [stack("japan", "land", 44, "T2", { infantry: 1 }), stack("soviet", "land", 21, "T2", { infantry: 1 }), stack("germany", "land", 48, "T2", { infantry: 2 }), stack("usa", "land", 51, "T2", { infantry: 1 })];
  e.game.units = Object.fromEntries(units.map(u => [u.id, u])); e.game.roundOrder = ["japan", "soviet", "germany", "usa"]; e.settlement.startCombat(); ok(e, { action: "choose_battle", nation: "japan", battleId: "battle-T2" });
  const german = e.game.combat.current.tokens.filter(t => t.nation === "germany"); for (const t of german.slice(1)) ok(e, { action: "set_front", nation: "germany", tokenId: t.id, front: "soviet" });
  ok(e, { action: "start_battle", nation: "japan" }); assert.equal(e.game.combat.current.frontName, "japan"); assert.ok(!e.game.combat.current.tokens.some(t => t.nation === "soviet"));
  for (let front = 0; front < 2; front++) {
    if (front) ok(e, { action: "start_battle", nation: "soviet" });
    for (let i = 0; i < 30 && e.game.combat.current.step !== "report"; i++) { const b = e.game.combat.current; ok(e, { action: "roll_combat", nation: b.commanders[b.turn] }); }
    ok(e, { action: "finish_battle", nation: front ? "soviet" : "japan" });
    if (!front) assert.equal(e.game.combat.current.frontName, "soviet");
  }
  assert.equal(e.game.combat.current, null); assert.equal(e.game.treaties.sovietJapan, true); assert.equal(e.game.units["germany-land-48"].unitCount, 2);
});
test("explicit routes validate every edge and preserve rail or two-step limits", () => {
  const e = setup(), sea = stack("germany", "sea", 1, "A5", { cruiser: 1 }), army = e.game.units["germany-land-48"];
  assert.throws(() => e.movement.validate(sea, "A18", false, ["A5", "A18"]));
  assert.throws(() => e.movement.validate(sea, "A8", false, ["A5", "A6", "A7", "A8"]));
  const route = e.movement.validate(army, "G4", false, ["G1", "G8", "G4"]); assert.equal(route.rail, true);
});
test("selected route previews and executions use the same path without moving during preview", () => {
  const e = setup(); phase(e, "phase3_movement"); const u = stack("germany", "sea", 1, "M1", { cruiser: 1 }); e.game.units = { [u.id]: u }; e.game.nations.germany.orders = [{ formationId: u.id, dest: "M3" }];
  e.game.movePhase = { active: true, order: ["germany"], natIndex: 0, ordIndex: 0, cur: { nation: "germany", orderIndex: 0, formationId: u.id, dest: "M3", pinned: false, invalid: false, partial: false }, awaiting: true, resolved: [], done: false };
  const operation = { action: "resolve_order", nation: "germany", result: "execute", route: ["M1", "M2", "M3"] }, before = JSON.stringify(e.game), preview = e.send({ action: "preview", operation });
  assert.equal(preview.type, "preview"); assert.deepEqual(preview.reports[0].details.route, operation.route); assert.equal(JSON.stringify(e.game), before);
  ok(e, operation); assert.equal(e.game.units[u.id].code, "M3"); assert.deepEqual(e.game.reports.at(-1).details.route, operation.route);
});
test("a battle commander can be chosen only from the declaring nation's alliance", () => {
  const e = setup(); phase(e, "phase4_combat"); const units = [stack("germany", "land", 48, "G1", { infantry: 1 }), stack("soviet", "land", 21, "G1", { infantry: 1 }), stack("usa", "land", 51, "G1", { infantry: 1 })];
  e.game.units = Object.fromEntries(units.map(u => [u.id, u])); e.game.roundOrder = ["germany", "soviet", "usa"]; e.settlement.startCombat(); ok(e, { action: "choose_battle", nation: "germany", battleId: "battle-G1" });
  assert.equal(e.send({ action: "set_commander", nation: "germany", commander: "usa" }).type, "error"); ok(e, { action: "set_commander", nation: "soviet", commander: "usa" }); assert.equal(e.game.combat.current.commanders.allies, "usa");
});
