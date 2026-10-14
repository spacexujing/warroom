"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createEngine } = require("../engine");

// Run the actual browser layout without requiring a DOM or loading map images.
const source = fs.readFileSync(path.join(__dirname, "../public/js/app.js"), "utf8");
const start = source.indexOf("function layoutArea(");
const end = source.indexOf("function drawUnits(", start);
const context = vm.createContext({ unitSizeForScale: () => ({ w: 10, h: 10 }) });
vm.runInContext(source.slice(start, end), context);

test("map layout includes every live unit, including all four Allied nations", () => {
  const units = Object.values(createEngine().snapshot().game.units);
  for (const nation of ["britain", "soviet", "usa", "china"]) {
    const list = units.filter(u => u.nation === nation);
    assert.ok(list.length > 0);
    const result = context.layoutArea(list, 1);
    assert.equal(result.placements.length, list.length, nation);
  }
  const groups = {};
  for (const u of units) (groups[u.code] ||= []).push(u);
  for (const list of Object.values(groups)) {
    assert.equal(context.layoutArea(list, 1).placements.length, list.length);
  }
});

test("mixed armies keep Axis on the left and both Allied spellings on the right", () => {
  const list = ["axis", "allies", "allied"].map((alliance, id) => ({ id, alliance, domain: "land" }));
  const { placements } = context.layoutArea(list, 1);
  assert.equal(placements.length, 3);
  const axis = placements.find(p => p.u.alliance === "axis");
  for (const p of placements.filter(p => p !== axis)) assert.ok(p.ox > axis.ox);
});
