import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../static/js/app.js", import.meta.url), "utf8");
const sandbox = {
  URLSearchParams,
  document: { addEventListener() {} },
};
vm.runInNewContext(`${source}\nObject.assign(globalThis, { leagueChoices, parseURLState, navigationQuery, horizontalRank, formationRows, storedSet, isFavoriteMatch, fixtureCacheTTL, addDays, toISODate, normalizeSearch });`, sandbox);

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

test("daily bookmarks always reopen today while match links retain their date", () => {
  assert.deepEqual(
    { ...sandbox.parseURLState("?date=2026-09-05") },
    { league: "all", date: "", match: null },
  );
  assert.equal(sandbox.navigationQuery("all", "2026-09-05", null), "");
  assert.equal(sandbox.navigationQuery("premier", "2026-09-05", null), "league=premier");
  assert.equal(sandbox.navigationQuery("premier", "2026-09-05", "401"), "league=premier&date=2026-09-05&match=401");
});

test("lineup horizontal order keeps right centre-back before right-back", () => {
  const players = ["CD-R", "RB", "LB", "CD-L"].map(pos => ({ pos }));
  players.sort((a, b) => sandbox.horizontalRank(a) - sandbox.horizontalRank(b));
  assert.deepEqual(players.map(player => player.pos), ["LB", "CD-L", "CD-R", "RB"]);
});

test("formation rows follow the announced shape instead of generic position labels", () => {
  const arsenal = [
    ["GK", "1"], ["CD-L", "6"], ["CD-R", "5"], ["LB", "3"], ["RB", "2"],
    ["AM", "10"], ["LM", "4"], ["RM", "8"], ["F", "9"], ["AM-L", "11"], ["AM-R", "7"],
  ].map(([pos, formationPlace]) => ({ pos, formationPlace }));
  assert.deepEqual(
    Array.from(sandbox.formationRows(arsenal, "4-2-3-1"), row => row.length),
    [1, 3, 2, 4, 1],
  );

  const bielefeld = [
    ["G", "1"], ["CD-L", "6"], ["CD-R", "5"], ["DM", "4"], ["LB", "3"], ["RB", "2"],
    ["CM-L", "10"], ["CM-R", "8"], ["LM", "11"], ["RM", "7"], ["F", "9"],
  ].map(([pos, formationPlace]) => ({ pos, formationPlace }));
  const rows = sandbox.formationRows(bielefeld, "4-1-4-1");
  assert.deepEqual(Array.from(rows, row => row.length), [1, 4, 1, 4, 1]);
  assert.equal(rows[2][0].pos, "DM");
});

test("three-at-the-back formations may use a nominal midfielder in the defensive line", () => {
  const hannover = [
    ["G", "1"], ["CD-L", "4"], ["CD", "5"], ["DM", "6"],
    ["LM", "3"], ["CM-L", "8"], ["CM-R", "7"], ["RM", "2"],
    ["LF", "11"], ["F", "9"], ["RF", "10"],
  ].map(([pos, formationPlace]) => ({ pos, formationPlace }));
  const rows = sandbox.formationRows(hannover, "3-4-3-d");
  assert.deepEqual(Array.from(rows, row => row.length), [3, 4, 3, 1]);
  assert.ok(rows[2].some(player => player.pos === "DM"));
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

test("notifications use Web Push instead of page-only Notification objects", () => {
  const worker = fs.readFileSync(new URL("../static/sw.js", import.meta.url), "utf8");
  const badge = fs.readFileSync(new URL("../static/images/notification-badge.png", import.meta.url));
  assert.match(source, /pushManager\.subscribe/);
  assert.match(source, /\/api\/push\/preferences/);
  assert.doesNotMatch(source, /new Notification\s*\(/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /badge: "\/images\/notification-badge\.png"/);
  assert.deepEqual([...badge.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /openWindow/);
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
