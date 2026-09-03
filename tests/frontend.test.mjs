import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/js/app.js", import.meta.url), "utf8");
const sandbox = {
  URLSearchParams,
  document: { addEventListener() {} },
};
vm.runInNewContext(`${source}\nObject.assign(globalThis, { parseURLState, horizontalRank, storedSet, isFavoriteMatch });`, sandbox);

test("shareable URL state accepts supported values", () => {
  assert.deepEqual(
    { ...sandbox.parseURLState("?league=superlig&date=2026-09-03&match=401") },
    { league: "superlig", date: "2026-09-03", match: "401" },
  );
  assert.deepEqual(
    { ...sandbox.parseURLState("?league=unknown&date=03-09-2026&match=nope") },
    { league: "all", date: "", match: null },
  );
});

test("lineup horizontal order keeps right centre-back before right-back", () => {
  const players = ["CD-R", "RB", "LB", "CD-L"].map(pos => ({ pos }));
  players.sort((a, b) => sandbox.horizontalRank(a) - sandbox.horizontalRank(b));
  assert.deepEqual(players.map(player => player.pos), ["LB", "CD-L", "CD-R", "RB"]);
});

test("favorites include team and league matches", () => {
  const match = { homeId: "1", awayId: "2", leagueSlug: "tur.1" };
  assert.equal(sandbox.isFavoriteMatch(match, new Set(["2"]), new Set()), true);
  assert.equal(sandbox.isFavoriteMatch(match, new Set(), new Set(["tur.1"])), true);
  assert.equal(sandbox.isFavoriteMatch(match, new Set(), new Set()), false);
});

test("stored preferences recover safely from invalid JSON", () => {
  const goodStorage = { getItem: () => '["432","364"]' };
  const badStorage = { getItem: () => "not-json" };
  assert.deepEqual([...sandbox.storedSet(goodStorage, "key")], ["432", "364"]);
  assert.deepEqual([...sandbox.storedSet(badStorage, "key")], []);
});
