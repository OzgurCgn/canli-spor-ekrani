import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/js/app.js", import.meta.url), "utf8");
const sandbox = {
  URLSearchParams,
  document: { addEventListener() {} },
};
vm.runInNewContext(`${source}\nObject.assign(globalThis, { leagueChoices, parseURLState, horizontalRank, storedSet, isFavoriteMatch, fixtureCacheTTL, addDays, toISODate, normalizeSearch });`, sandbox);

test("league picker has a logo for every supported competition", () => {
  assert.equal(Object.keys(sandbox.leagueChoices).length, 19);
  for (const key of Object.keys(sandbox.leagueChoices)) {
    const choice = sandbox.leagueChoices[key];
    assert.ok(choice.logo || choice.symbol, `${key} needs a visual`);
  }
});

test("search normalization handles Turkish accents", () => {
  assert.equal(sandbox.normalizeSearch("  Göztepe  "), "goztepe");
});

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

test("fixture cache keeps historical dates longer than live scores", () => {
  const today = sandbox.toISODate(new Date());
  assert.equal(sandbox.fixtureCacheTTL(today, { matches: [{ status: "LIVE" }] }), 15000);
  assert.equal(sandbox.fixtureCacheTTL(today, { matches: [] }), 60000);
  assert.equal(sandbox.fixtureCacheTTL(sandbox.addDays(today, -1), { matches: [] }), 21600000);
  assert.equal(sandbox.fixtureCacheTTL(sandbox.addDays(today, 1), { matches: [] }), 900000);
});

test("polling is scheduled dynamically instead of running on every historical view", () => {
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /state\.selectedDate !== toISODate\(new Date\(\)\)/);
  assert.match(source, /fixtureController\?\.abort\(\)/);
});

test("match detail has a safe return path to the day overview", () => {
  const html = fs.readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.match(html, /id="backToOverview"/);
  assert.match(source, /function returnToDayOverview\(\)/);
  assert.match(source, /state\.detailRequest \+= 1/);
  assert.match(source, /elements\.backToOverview\.addEventListener\("click", returnToDayOverview\)/);
  assert.match(source, /renderDayOverview\(visibleMatches\(\)\)/);
});

test("feature pack includes follow, grouping, leaders, xg and head-to-head UI", () => {
  const html = fs.readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
  assert.match(html, /id="stageFollowButton"/);
  assert.match(html, /id="leadersTab"/);
  assert.match(html, /id="matchSearch"/);
  assert.match(html, /data-detail-tab="h2h"/);
  assert.match(source, /function toggleFollowedMatch\(match\)/);
  assert.match(source, /overviewGrouping/);
  assert.match(source, /Beklenen Gol \(xG\)/);
  assert.match(source, /loadHeadToHead/);
});

test("desktop date control uses a browser-independent calendar", () => {
  assert.match(source, /function renderCalendar\(\)/);
  assert.match(source, /calendarPopover/);
  assert.doesNotMatch(source, /\.showPicker\(\)/);
});

test("changing league keeps the daily overview instead of auto-opening a match", () => {
  assert.doesNotMatch(source, /selectMatch\(availableMatches\[0\]\)/);
  assert.match(source, /renderDayOverview\(availableMatches\)/);
});
