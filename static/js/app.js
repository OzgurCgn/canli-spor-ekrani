"use strict";

const leagueSlugs = {
  superlig: "tur.1", premier: "eng.1", championship: "eng.2", laliga: "esp.1", laliga2: "esp.2",
  seriea: "ita.1", serieb: "ita.2", bundesliga: "ger.1", bundesliga2: "ger.2",
  ligue1: "fra.1", ligue2: "fra.2", belgium: "bel.1", eredivisie: "ned.1", ligaportugal: "por.1", saudi: "ksa.1",
  ucl: "uefa.champions", uel: "uefa.europa", uecl: "uefa.europa.conf",
};
const leagueChoices = {
  all: { name: "Tüm Ligler", symbol: "🌍" },
  superlig: { name: "Trendyol Süper Lig", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/18.png" },
  premier: { name: "Premier League", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png" },
  laliga: { name: "La Liga", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png" },
  seriea: { name: "Serie A", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png" },
  bundesliga: { name: "Bundesliga", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png" },
  ligue1: { name: "Ligue 1", group: "Üst Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png" },
  championship: { name: "EFL Championship", group: "2. Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/24.png" },
  laliga2: { name: "La Liga 2", group: "2. Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/107.png" },
  serieb: { name: "Serie B", group: "2. Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/99.png" },
  bundesliga2: { name: "2. Bundesliga", group: "2. Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/97.png" },
  ligue2: { name: "Ligue 2", group: "2. Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/96.png" },
  belgium: { name: "Belçika Pro Ligi", group: "Diğer Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/6.png" },
  eredivisie: { name: "Eredivisie", group: "Diğer Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/11.png" },
  ligaportugal: { name: "Liga Portugal", group: "Diğer Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/14.png" },
  saudi: { name: "Suudi Pro Ligi", group: "Diğer Ligler", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2488.png" },
  ucl: { name: "UEFA Şampiyonlar Ligi", group: "UEFA", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png" },
  uel: { name: "UEFA Avrupa Ligi", group: "UEFA", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/2310.png" },
  uecl: { name: "UEFA Konferans Ligi", group: "UEFA", logo: "https://a.espncdn.com/i/leaguelogos/soccer/500/20296.png" },
};
const preferenceKeys = {
  teams: "canlispor.favoriteTeams",
  leagues: "canlispor.favoriteLeagues",
  notifications: "canlispor.notifications",
  followedMatches: "canlispor.followedMatches",
  overviewGrouping: "canlispor.overviewGrouping",
};
const fixtureCacheStorageKey = "canlispor.fixtureCache.v1";
const fixtureMemoryCache = new Map();
const fixturePrefetches = new Set();
const fixtureCacheLimit = 18;
const xgStatTitle = "Beklenen Gol (xG)";

const state = {
  activeLeague: "all",
  selectedDate: toISODate(new Date()),
  matches: [],
  selectedMatchId: null,
  selectedMatch: null,
  detailMatchId: null,
  liveOnly: false,
  favoritesOnly: false,
  searchQuery: "",
  overviewGrouping: "status",
  activeView: "matches",
  activeDetailTab: "overview",
  favoriteTeams: new Set(),
  favoriteLeagues: new Set(),
  notificationsEnabled: false,
  followedMatches: new Set(),
  fixtureRequest: 0,
  fixtureController: null,
  fixtureRefreshTimer: null,
  fixturePrefetchTimer: null,
  detailRequest: 0,
  teamRequest: 0,
  leadersRequest: 0,
  h2hRequest: 0,
  h2hMatchId: null,
};

const elements = {};

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(value, amount) {
  const date = fromISODate(value);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr-TR").trim();
}

function parseURLState(search) {
  const params = new URLSearchParams(search || "");
  const league = params.get("league");
  const selectedDate = params.get("date");
  const match = params.get("match");
  return {
    league: league === "all" || leagueSlugs[league] ? league : "all",
    date: /^\d{4}-\d{2}-\d{2}$/.test(selectedDate || "") ? selectedDate : "",
    match: /^\d+$/.test(match || "") ? match : null,
  };
}

function leagueKeyFromSlug(slug) {
  return Object.keys(leagueSlugs).find(key => leagueSlugs[key] === slug) || "all";
}

function storedSet(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function savePreferences() {
  try {
    localStorage.setItem(preferenceKeys.teams, JSON.stringify([...state.favoriteTeams]));
    localStorage.setItem(preferenceKeys.leagues, JSON.stringify([...state.favoriteLeagues]));
    localStorage.setItem(preferenceKeys.notifications, String(state.notificationsEnabled));
    localStorage.setItem(preferenceKeys.followedMatches, JSON.stringify([...state.followedMatches]));
    localStorage.setItem(preferenceKeys.overviewGrouping, state.overviewGrouping);
  } catch (_) { /* Preferences are optional when storage is unavailable. */ }
}

function syncURL(push = false) {
  const params = new URLSearchParams();
  params.set("date", state.selectedDate);
  if (state.activeLeague !== "all") params.set("league", state.activeLeague);
  if (state.selectedMatchId) params.set("match", state.selectedMatchId);
  const url = `${window.location.pathname}?${params.toString()}`;
  window.history[push ? "pushState" : "replaceState"]({}, "", url);
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
}

function image(src, className, alt) {
  const img = node("img", className);
  img.alt = alt || "";
  img.loading = "lazy";
  if (src) img.src = src;
  img.addEventListener("error", () => { img.hidden = true; }, { once: true });
  return img;
}

function leagueLogo(key) {
  const choice = leagueChoices[key] || leagueChoices.all;
  const holder = node("span", `league-choice-logo${choice.logo ? "" : " league-all-logo"}`);
  holder.setAttribute("aria-hidden", "true");
  if (choice.logo) holder.append(image(choice.logo, "league-logo-image", ""));
  else holder.textContent = choice.symbol;
  return holder;
}

function setLeagueMenu(open) {
  elements.leagueMenu.hidden = !open;
  elements.leagueSelectButton.setAttribute("aria-expanded", String(open));
  elements.leaguePicker.classList.toggle("open", open);
  if (open) {
    const selected = elements.leagueMenu.querySelector('[aria-selected="true"]');
    selected?.focus();
  }
}

function updateLeaguePicker() {
  const choice = leagueChoices[state.activeLeague] || leagueChoices.all;
  elements.leagueSelectedLogo.replaceWith(leagueLogo(state.activeLeague));
  elements.leagueSelectedLogo = elements.leagueSelectButton.querySelector(".league-choice-logo");
  elements.leagueSelectedLogo.id = "leagueSelectedLogo";
  elements.leagueSelectedName.textContent = choice.name;
  for (const option of elements.leagueMenu.querySelectorAll(".league-option")) {
    const selected = option.dataset.league === state.activeLeague;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", String(selected));
  }
}

function renderLeagueMenu() {
  let lastGroup = "";
  const options = [];
  for (const [key, choice] of Object.entries(leagueChoices)) {
    if (choice.group && choice.group !== lastGroup) {
      options.push(node("div", "league-menu-group", choice.group));
      lastGroup = choice.group;
    }
    const button = node("button", "league-option");
    button.type = "button";
    button.role = "option";
    button.dataset.league = key;
    button.append(leagueLogo(key), node("span", "league-option-name", choice.name), node("span", "league-option-check", "✓"));
    button.addEventListener("click", () => {
      elements.leagueSelect.value = key;
      elements.leagueSelect.dispatchEvent(new Event("change", { bubbles: true }));
      setLeagueMenu(false);
      elements.leagueSelectButton.focus();
    });
    options.push(button);
  }
  elements.leagueMenu.replaceChildren(...options);
  updateLeaguePicker();
}

function emptyState(title, detail = "") {
  const box = node("div", "empty-state");
  box.append(node("strong", "", title));
  if (detail) box.append(node("span", "", detail));
  return box;
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: options.signal });
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.detail || "Veri alınırken bir sorun oluştu.");
  }
  return payload;
}

function fixtureCacheKey(league, selectedDate) {
  return `${league}:${selectedDate}`;
}

function fixtureCacheTTL(selectedDate, data) {
  if ((data?.matches || []).some(match => match.status === "LIVE")) return 15000;
  const current = toISODate(new Date());
  if (selectedDate < current) return 21600000;
  if (selectedDate > current) return 900000;
  return 60000;
}

function restoreFixtureCache() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(fixtureCacheStorageKey) || "{}");
    for (const [key, entry] of Object.entries(stored)) {
      if (entry && Number.isFinite(entry.savedAt) && entry.data) fixtureMemoryCache.set(key, entry);
    }
  } catch (_) { /* Session caching is an optional performance enhancement. */ }
}

function persistFixtureCache() {
  try {
    const entries = [...fixtureMemoryCache.entries()]
      .sort((left, right) => right[1].savedAt - left[1].savedAt)
      .slice(0, fixtureCacheLimit);
    fixtureMemoryCache.clear();
    for (const [key, entry] of entries) fixtureMemoryCache.set(key, entry);
    sessionStorage.setItem(fixtureCacheStorageKey, JSON.stringify(Object.fromEntries(entries)));
  } catch (_) { /* Ignore unavailable or full session storage. */ }
}

function cachedFixtures(league, selectedDate) {
  const entry = fixtureMemoryCache.get(fixtureCacheKey(league, selectedDate));
  if (!entry) return null;
  return {
    data: entry.data,
    fresh: Date.now() - entry.savedAt < fixtureCacheTTL(selectedDate, entry.data),
  };
}

function cacheFixtures(league, selectedDate, data) {
  fixtureMemoryCache.set(fixtureCacheKey(league, selectedDate), { savedAt: Date.now(), data });
  persistFixtureCache();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => { elements.toast.hidden = true; }, 4500);
}

function setLoading(container, count = 3) {
  container.replaceChildren(...Array.from({ length: count }, () => node("div", "skeleton")));
}

function updateDateControls() {
  const selected = fromISODate(state.selectedDate);
  const today = toISODate(new Date());
  elements.datePicker.value = state.selectedDate;
  elements.selectedDateLabel.textContent = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
  }).format(selected);
  elements.yesterdayButton.classList.toggle("active", state.selectedDate === addDays(today, -1));
  elements.todayButton.classList.toggle("active", state.selectedDate === today);
  elements.tomorrowButton.classList.toggle("active", state.selectedDate === addDays(today, 1));
}

function setDate(value) {
  if (value === state.selectedDate) return;
  state.selectedDate = value;
  state.selectedMatchId = null;
  state.selectedMatch = null;
  state.detailMatchId = null;
  updateDateControls();
  syncURL();
  loadFixtures();
}

function setStageMatch(match) {
  state.selectedMatch = match;
  elements.stagePlaceholder.hidden = true;
  elements.stageContent.hidden = false;
  elements.detailsGrid.hidden = false;
  elements.matchDetailTabs.hidden = false;
  elements.stageMeta.textContent = match.round ? `${match.league} • ${match.round}` : match.league;
  elements.stageHome.textContent = match.homeTeam;
  elements.stageAway.textContent = match.awayTeam;
  elements.stageScore.textContent = match.score;
  setImage(elements.stageHomeLogo, match.homeLogo, `${match.homeTeam} logosu`);
  setImage(elements.stageAwayLogo, match.awayLogo, `${match.awayTeam} logosu`);
  elements.lineupHomeName.textContent = match.homeTeam;
  elements.lineupAwayName.textContent = match.awayTeam;
  elements.stageHomeButton.dataset.teamId = match.homeId;
  elements.stageHomeButton.dataset.leagueSlug = match.leagueSlug;
  elements.stageAwayButton.dataset.teamId = match.awayId;
  elements.stageAwayButton.dataset.leagueSlug = match.leagueSlug;
  updateTeamFavoriteButtons();
  elements.stageTag.className = `match-tag${match.status === "LIVE" ? " live" : ""}`;
  elements.stageTag.textContent = match.status === "LIVE" ? match.minute : (match.fullDate || match.time);
  updateStageFollowButton();
  setDetailTab(state.activeDetailTab);
}

function setImage(img, src, alt) {
  img.hidden = !src;
  img.alt = alt;
  if (src) img.src = src;
}

function resetDetails() {
  elements.homeEventsList.replaceChildren();
  elements.awayEventsList.replaceChildren();
  elements.timeline.replaceChildren(node("div", "skeleton"));
  elements.statsContainer.replaceChildren(node("div", "skeleton"));
  elements.homeLineupList.replaceChildren(node("div", "skeleton"));
  elements.awayLineupList.replaceChildren(node("div", "skeleton"));
  elements.venueText.textContent = "Yükleniyor...";
  elements.refereeText.textContent = "Yükleniyor...";
  elements.h2hContainer.replaceChildren(emptyState("Karşılaştırma sekmesi açıldığında veriler yüklenir."));
  state.h2hMatchId = null;
}

function setDetailTab(tab) {
  const selected = ["overview", "timeline", "lineups", "stats", "h2h"].includes(tab) ? tab : "overview";
  state.activeDetailTab = selected;
  for (const button of elements.matchDetailTabs.querySelectorAll("[data-detail-tab]")) {
    const active = button.dataset.detailTab === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of elements.detailsGrid.querySelectorAll("[data-detail-panel]")) {
    panel.hidden = panel.dataset.detailPanel !== selected;
  }
  if (selected === "h2h" && state.selectedMatch && state.h2hMatchId !== state.selectedMatch.id) loadHeadToHead(state.selectedMatch);
}

function isFavoriteMatch(match, teams = state.favoriteTeams, leagues = state.favoriteLeagues) {
  return teams.has(String(match.homeId)) || teams.has(String(match.awayId)) || leagues.has(String(match.leagueSlug));
}

function updateTeamFavoriteButtons() {
  for (const [button, teamId, teamName] of [
    [elements.stageHomeFavorite, state.selectedMatch?.homeId, state.selectedMatch?.homeTeam],
    [elements.stageAwayFavorite, state.selectedMatch?.awayId, state.selectedMatch?.awayTeam],
  ]) {
    const active = Boolean(teamId && state.favoriteTeams.has(String(teamId)));
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "★" : "☆";
    button.setAttribute("aria-label", `${teamName || "Takım"} ${active ? "favorilerden çıkar" : "favorilere ekle"}`);
  }
}

function updateFavoriteControls() {
  const slug = leagueSlugs[state.activeLeague];
  const active = Boolean(slug && state.favoriteLeagues.has(slug));
  elements.favoriteLeagueButton.disabled = !slug;
  elements.favoriteLeagueButton.classList.toggle("active", active);
  elements.favoriteLeagueButton.setAttribute("aria-pressed", String(active));
  elements.favoriteLeagueButton.textContent = active ? "★" : "☆";
  elements.favoriteLeagueButton.title = active ? "Seçili ligi favorilerden çıkar" : "Seçili ligi favorilere ekle";
  elements.favoritesFilter.classList.toggle("active", state.favoritesOnly);
  elements.favoritesFilter.setAttribute("aria-pressed", String(state.favoritesOnly));
  updateTeamFavoriteButtons();
}

function toggleFavoriteTeam(teamId) {
  const key = String(teamId || "");
  if (!key) return;
  if (state.favoriteTeams.has(key)) state.favoriteTeams.delete(key); else state.favoriteTeams.add(key);
  savePreferences();
  updateFavoriteControls();
  renderMatches();
  if (!state.selectedMatchId) renderDayOverview(visibleMatches());
}

function toggleFavoriteLeague() {
  const slug = leagueSlugs[state.activeLeague];
  if (!slug) return;
  if (state.favoriteLeagues.has(slug)) state.favoriteLeagues.delete(slug); else state.favoriteLeagues.add(slug);
  savePreferences();
  updateFavoriteControls();
  renderMatches();
  if (!state.selectedMatchId) renderDayOverview(visibleMatches());
}

function isFollowedMatch(match) {
  return Boolean(match?.id && state.followedMatches.has(String(match.id)));
}

function updateStageFollowButton() {
  const active = isFollowedMatch(state.selectedMatch);
  elements.stageFollowButton.classList.toggle("active", active);
  elements.stageFollowButton.setAttribute("aria-pressed", String(active));
  elements.stageFollowButton.textContent = active ? "🔔 Takip ediliyor" : "🔔 Maçı takip et";
}

async function enableNotificationsForFollow() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission !== "granted") return false;
  state.notificationsEnabled = true;
  updateNotificationButton();
  return true;
}

async function toggleFollowedMatch(match) {
  if (!match?.id) return;
  const key = String(match.id);
  if (state.followedMatches.has(key)) {
    state.followedMatches.delete(key);
    showToast(`${match.homeTeam} - ${match.awayTeam} takibi kapatıldı.`);
  } else {
    state.followedMatches.add(key);
    const enabled = await enableNotificationsForFollow();
    showToast(enabled ? "Maç bildirimleri açıldı." : "Maç takipte; bildirim izni tarayıcı ayarından açılabilir.");
  }
  savePreferences();
  updateStageFollowButton();
  renderMatches();
  if (!state.selectedMatchId) renderDayOverview(visibleMatches());
}

function followMatchButton(match) {
  const active = isFollowedMatch(match);
  const button = node("button", `card-follow-button${active ? " active" : ""}`, active ? "🔔" : "🔕");
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", `${match.homeTeam} - ${match.awayTeam} maçını ${active ? "takipten çıkar" : "takip et"}`);
  button.title = active ? "Maç takibini kapat" : "Maçı takip et";
  button.addEventListener("click", event => {
    event.stopPropagation();
    toggleFollowedMatch(match);
  });
  return button;
}

async function toggleNotifications() {
  if (!("Notification" in window)) {
    showToast("Bu tarayıcı bildirimleri desteklemiyor.");
    return;
  }
  if (!state.notificationsEnabled) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Bildirim izni verilmedi.");
      return;
    }
    state.notificationsEnabled = true;
    showToast(state.followedMatches.size ? "Takip edilen maçların bildirimleri açıldı." : "Bildirim açık; maç kartındaki zil ile takip seçebilirsin.");
  } else {
    state.notificationsEnabled = false;
    showToast("Canlı gol bildirimleri kapatıldı.");
  }
  savePreferences();
  updateNotificationButton();
}

function updateNotificationButton() {
  const active = state.notificationsEnabled && "Notification" in window && Notification.permission === "granted";
  state.notificationsEnabled = active;
  elements.notificationButton.classList.toggle("active", active);
  elements.notificationButton.setAttribute("aria-pressed", String(active));
}

function notifyScoreChanges(previousMatches, matches) {
  if (!state.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  for (const match of matches) {
    if (!isFollowedMatch(match)) continue;
    const previous = previousMatches.get(match.id);
    if (!previous) continue;
    const notification = (title, tag) => new Notification(title, {
      body: `${match.league} • ${match.minute}`,
      icon: match.homeLogo || match.awayLogo || "/images/app-icon.svg",
      tag: `${tag}-${match.id}`,
    });
    if (previous.score !== match.score && match.status !== "NS") {
      notification(`Gol! ${match.homeTeam} ${match.score} ${match.awayTeam}`, "goal");
    }
    const previousReds = Number(previous.homeRedCards || 0) + Number(previous.awayRedCards || 0);
    const currentReds = Number(match.homeRedCards || 0) + Number(match.awayRedCards || 0);
    if (currentReds > previousReds) notification(`Kırmızı kart: ${match.homeTeam} - ${match.awayTeam}`, "red-card");
    if (previous.status === "NS" && match.status === "LIVE") notification(`Maç başladı: ${match.homeTeam} - ${match.awayTeam}`, "kickoff");
    if (previous.status !== "FT" && match.status === "FT") notification(`Maç sona erdi: ${match.homeTeam} ${match.score} ${match.awayTeam}`, "full-time");
    const phase = normalizeSearch(match.statusDetail);
    const oldPhase = normalizeSearch(previous.statusDetail);
    if (phase !== oldPhase && (phase === "ht" || phase.includes("half time") || phase.includes("devre"))) {
      notification(`Devre arası: ${match.homeTeam} ${match.score} ${match.awayTeam}`, "half-time");
    }
  }
}

function setFixturesUpdating(active) {
  elements.matchFeed.classList.toggle("is-refreshing", active);
  elements.mainStage.classList.toggle("is-refreshing", active);
  elements.matchFeed.setAttribute("aria-busy", String(active));
}

function applyFixtureData(data, previousMatches = new Map(), announceChanges = false) {
  state.matches = data.matches || [];
  if (announceChanges) notifyScoreChanges(previousMatches, state.matches);
  renderMatches();
  renderTicker();
  updateLiveCount();

  const selected = state.matches.find(match => match.id === state.selectedMatchId);
  const availableMatches = visibleMatches();
  if (selected) {
    setStageMatch(selected);
    if (selected.status === "LIVE" || state.detailMatchId !== selected.id) loadMatchDetail(selected);
  } else if (availableMatches.length && state.activeLeague !== "all") {
    selectMatch(availableMatches[0]);
  } else if (state.matches.length) {
    renderDayOverview(availableMatches);
  } else {
    clearStage("Bu tarihte maç bulunamadı.");
  }
}

function scheduleFixtureRefresh() {
  window.clearTimeout(state.fixtureRefreshTimer);
  state.fixtureRefreshTimer = null;
  if (state.selectedDate !== toISODate(new Date())) return;
  const delay = state.matches.some(match => match.status === "LIVE") ? 15000 : 60000;
  state.fixtureRefreshTimer = window.setTimeout(() => {
    if (state.activeView === "matches" && !document.hidden) {
      loadFixtures({ background: true, force: true, prefetch: false });
    } else {
      scheduleFixtureRefresh();
    }
  }, delay);
}

function prefetchAdjacentFixtures(league, selectedDate) {
  window.clearTimeout(state.fixturePrefetchTimer);
  if (navigator.connection?.saveData || document.hidden) return;
  state.fixturePrefetchTimer = window.setTimeout(async () => {
    if (league !== state.activeLeague || selectedDate !== state.selectedDate) return;
    for (const date of [addDays(selectedDate, -1), addDays(selectedDate, 1)]) {
      const key = fixtureCacheKey(league, date);
      if (cachedFixtures(league, date)?.fresh || fixturePrefetches.has(key)) continue;
      fixturePrefetches.add(key);
      try {
        const params = new URLSearchParams({ league, date });
        const data = await requestJSON(`/api/fixtures?${params}`);
        cacheFixtures(league, date, data);
      } catch (_) {
        // Prefetch failure is silent; the normal navigation request can retry later.
      } finally {
        fixturePrefetches.delete(key);
      }
    }
  }, 1200);
}

async function loadFixtures(options = {}) {
  const { background = false, force = false, prefetch = true } = options;
  const requestId = ++state.fixtureRequest;
  const league = state.activeLeague;
  const selectedDate = state.selectedDate;
  const cached = cachedFixtures(league, selectedDate);
  state.fixtureController?.abort();
  state.fixtureController = null;

  if (cached && !background) applyFixtureData(cached.data);
  if (cached?.fresh && !force) {
    setFixturesUpdating(false);
    scheduleFixtureRefresh();
    if (prefetch) prefetchAdjacentFixtures(league, selectedDate);
    return;
  }
  if (!cached && !background && !state.matches.length) setLoading(elements.matchFeed);

  const controller = new AbortController();
  state.fixtureController = controller;
  setFixturesUpdating(true);
  try {
    const params = new URLSearchParams({ league, date: selectedDate });
    const data = await requestJSON(`/api/fixtures?${params}`, { signal: controller.signal });
    if (requestId !== state.fixtureRequest || league !== state.activeLeague || selectedDate !== state.selectedDate) return;
    const previousMatches = new Map(state.matches.map(match => [match.id, match]));
    cacheFixtures(league, selectedDate, data);
    applyFixtureData(data, previousMatches, true);
    scheduleFixtureRefresh();
    if (prefetch) prefetchAdjacentFixtures(league, selectedDate);
  } catch (error) {
    if (error.name === "AbortError" || requestId !== state.fixtureRequest) return;
    if (!cached && !state.matches.length) elements.matchFeed.replaceChildren(emptyState("Maçlar yüklenemedi", error.message));
    showToast(cached ? "Güncel veri alınamadı; son kayıt gösteriliyor." : error.message);
    scheduleFixtureRefresh();
  } finally {
    if (requestId === state.fixtureRequest) {
      setFixturesUpdating(false);
      if (state.fixtureController === controller) state.fixtureController = null;
    }
  }
}

function visibleMatches() {
  const query = normalizeSearch(state.searchQuery);
  return state.matches.filter(match => {
    if (state.liveOnly && match.status !== "LIVE") return false;
    if (state.favoritesOnly && !isFavoriteMatch(match)) return false;
    if (query && !normalizeSearch(`${match.homeTeam} ${match.awayTeam} ${match.league}`).includes(query)) return false;
    return true;
  });
}

function makeMatchCardInteractive(card, match) {
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${match.homeTeam} - ${match.awayTeam} maçını aç`);
  card.addEventListener("click", () => selectMatch(match));
  card.addEventListener("keydown", event => {
    if (event.target !== card || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    selectMatch(match);
  });
}

function renderMatches() {
  const matches = visibleMatches();
  if (!matches.length) {
    const message = state.searchQuery ? "Aramana uygun maç bulunamadı." : (state.favoritesOnly ? "Bu tarihte favori takım veya lig maçı yok." : (state.liveOnly ? "Şu anda canlı maç yok." : "Bu tarihte maç bulunamadı."));
    elements.matchFeed.replaceChildren(emptyState(message));
    return;
  }

  const cards = matches.map(match => {
    const card = node("article", `feed-card ${match.status}${match.id === state.selectedMatchId ? " active-selected" : ""}${isFavoriteMatch(match) ? " favorite" : ""}${isFollowedMatch(match) ? " followed" : ""}`);
    card.dataset.matchId = match.id;

    const header = node("span", "feed-header");
    const competition = match.round ? `${match.league} • ${match.round}` : match.league;
    header.append(node("span", "", competition), node("span", "status-text", match.time));

    const body = node("span", "feed-body");
    const teams = node("span", "feed-teams");
    for (const [name, logo] of [[match.homeTeam, match.homeLogo], [match.awayTeam, match.awayLogo]]) {
      const team = node("span", "feed-team");
      team.append(image(logo, "team-logo feed-logo", ""), node("span", "", name));
      teams.append(team);
    }
    body.append(teams, node("span", "score-badge", match.score));
    card.append(header, body, followMatchButton(match));
    makeMatchCardInteractive(card, match);
    return card;
  });
  elements.matchFeed.replaceChildren(...cards);
}

function overviewMatchCard(match) {
  const card = node("article", `overview-match ${match.status}${isFavoriteMatch(match) ? " favorite" : ""}${isFollowedMatch(match) ? " followed" : ""}`);

  const meta = node("span", "overview-meta");
  const statusText = match.status === "LIVE" ? match.minute : (match.status === "FT" ? "MS" : match.time);
  meta.append(node("span", "", match.league), node("strong", `overview-status ${match.status}`, statusText));

  const teams = node("span", "overview-teams");
  for (const [name, logo] of [[match.homeTeam, match.homeLogo], [match.awayTeam, match.awayLogo]]) {
    const team = node("span", "overview-team");
    team.append(image(logo, "team-logo overview-logo", ""), node("span", "", name));
    teams.append(team);
  }
  card.append(meta, teams, node("span", "overview-score", match.score), followMatchButton(match));
  makeMatchCardInteractive(card, match);
  return card;
}

function renderDayOverview(matches) {
  state.selectedMatchId = null;
  state.selectedMatch = null;
  state.detailMatchId = null;
  elements.stageContent.hidden = true;
  elements.detailsGrid.hidden = true;
  elements.matchDetailTabs.hidden = true;
  elements.stagePlaceholder.hidden = false;

  const dateText = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(fromISODate(state.selectedDate));
  const overview = node("div", "day-overview");
  const heading = node("div", "overview-heading");
  heading.append(node("span", "overview-kicker", "GÜNÜN MAÇLARI"), node("h2", "", dateText));
  const grouping = node("div", "overview-grouping");
  for (const [value, label] of [["status", "Duruma göre"], ["league", "Lige göre"]]) {
    const button = node("button", `overview-group-button${state.overviewGrouping === value ? " active" : ""}`, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.overviewGrouping === value));
    button.addEventListener("click", () => {
      state.overviewGrouping = value;
      savePreferences();
      renderDayOverview(visibleMatches());
    });
    grouping.append(button);
  }
  heading.append(grouping);
  overview.append(heading);

  let sections;
  if (state.overviewGrouping === "league") {
    const leagueGroups = new Map();
    for (const match of matches) {
      const group = leagueGroups.get(match.leagueSlug) || { title: match.league, className: "league", matches: [] };
      group.matches.push(match);
      leagueGroups.set(match.leagueSlug, group);
    }
    sections = [...leagueGroups.values()];
  } else {
    sections = [
      { title: "Canlı", className: "live", matches: matches.filter(match => match.status === "LIVE") },
      { title: "Tamamlanan", className: "finished", matches: matches.filter(match => match.status === "FT") },
      { title: "Yaklaşan", className: "upcoming", matches: matches.filter(match => match.status !== "LIVE" && match.status !== "FT") },
    ];
  }
  for (const section of sections) {
    if (!section.matches.length) continue;
    const block = node("section", `overview-section ${section.className}`);
    const title = node("div", "overview-section-title");
    title.append(node("span", "overview-dot"), node("strong", "", section.title), node("span", "overview-count", section.matches.length));
    const grid = node("div", "overview-grid");
    grid.append(...section.matches.map(overviewMatchCard));
    block.append(title, grid);
    overview.append(block);
  }
  if (!matches.length) overview.append(emptyState(state.searchQuery ? "Aramana uygun maç bulunamadı." : (state.favoritesOnly ? "Bu tarihte favori takım veya lig maçı yok." : (state.liveOnly ? "Şu anda canlı maç yok." : "Bu tarihte maç bulunamadı."))));
  elements.stagePlaceholder.replaceChildren(overview);
}

function clearStage(message) {
  state.selectedMatchId = null;
  state.selectedMatch = null;
  state.detailMatchId = null;
  elements.stagePlaceholder.textContent = message;
  elements.stagePlaceholder.hidden = false;
  elements.stageContent.hidden = true;
  elements.detailsGrid.hidden = true;
  elements.matchDetailTabs.hidden = true;
}

function returnToDayOverview() {
  state.detailRequest += 1;
  state.selectedMatchId = null;
  state.selectedMatch = null;
  state.detailMatchId = null;
  state.activeDetailTab = "overview";
  syncURL();
  renderMatches();
  renderDayOverview(visibleMatches());
}

async function selectMatch(match) {
  if (!match) return;
  state.selectedMatchId = match.id;
  state.activeDetailTab = "overview";
  syncURL(true);
  renderMatches();
  setStageMatch(match);
  resetDetails();
  await loadMatchDetail(match);
}

async function loadMatchDetail(match) {
  const requestId = ++state.detailRequest;
  try {
    const params = new URLSearchParams({ event_id: match.id, league_slug: match.leagueSlug });
    const detail = await requestJSON(`/api/match-detail?${params}`);
    if (requestId !== state.detailRequest || match.id !== state.selectedMatchId) return;
    renderSummaryEvents(detail);
    renderTimeline(detail.events || [], match);
    renderStats(detail.stats || []);
    renderLineups(detail.lineups || {});
    state.detailMatchId = match.id;
    elements.venueText.textContent = detail.venue || "Belirtilmedi";
    elements.refereeText.textContent = detail.referee || "Belirtilmedi";
  } catch (error) {
    if (requestId !== state.detailRequest) return;
    elements.timeline.replaceChildren(emptyState("Maç detayı yüklenemedi", error.message));
    elements.statsContainer.replaceChildren(emptyState("İstatistik yüklenemedi"));
    elements.homeLineupList.replaceChildren(emptyState("Kadro yüklenemedi"));
    elements.awayLineupList.replaceChildren(emptyState("Kadro yüklenemedi"));
    elements.venueText.textContent = "-";
    elements.refereeText.textContent = "-";
    showToast(error.message);
  }
}

function renderHeadToHead(data, match) {
  const meetings = data.matches || [];
  if (!meetings.length) {
    elements.h2hContainer.replaceChildren(emptyState("Bu sezon ligde karşılaşma bulunamadı."));
    return;
  }
  const content = node("div", "h2h-body");
  const summary = node("div", "h2h-summary");
  summary.append(
    teamRecordItem(data.homeWins || 0, `${match.homeTeam} galibiyeti`),
    teamRecordItem(data.draws || 0, "Beraberlik"),
    teamRecordItem(data.awayWins || 0, `${match.awayTeam} galibiyeti`),
  );
  const list = node("div", "h2h-list");
  for (const meeting of meetings) {
    const button = node("button", "h2h-match-row");
    button.type = "button";
    const teams = node("span", "h2h-match-teams");
    teams.append(node("span", "", meeting.homeTeam), node("span", "", meeting.awayTeam));
    button.append(node("span", "h2h-match-date", meeting.fullDate || meeting.matchDate), teams, node("strong", "", meeting.score));
    button.addEventListener("click", () => openTeamMatch(meeting));
    list.append(button);
  }
  content.append(summary, list);
  elements.h2hContainer.replaceChildren(content);
}

async function loadHeadToHead(match) {
  const requestId = ++state.h2hRequest;
  elements.h2hContainer.replaceChildren(node("div", "skeleton"), node("div", "skeleton"));
  try {
    const params = new URLSearchParams({ home_id: match.homeId, away_id: match.awayId, league_slug: match.leagueSlug });
    const data = await requestJSON(`/api/head-to-head?${params}`);
    if (requestId !== state.h2hRequest || match.id !== state.selectedMatchId) return;
    state.h2hMatchId = match.id;
    renderHeadToHead(data, match);
  } catch (error) {
    if (requestId !== state.h2hRequest) return;
    elements.h2hContainer.replaceChildren(emptyState("Karşılaştırma yüklenemedi", error.message));
  }
}

function summaryEvent(event, reverse = false) {
  const line = node("div", `scorer-line${event.isOwnGoal ? " own-goal" : ""}`);
  const parts = [
    node("span", "event-icon", event.icon),
    node("strong", "", event.scorer),
  ];
  if (event.isOwnGoal) {
    const badge = node("span", "own-goal-badge", "K.K.");
    badge.title = "Kendi kalesine gol";
    badge.setAttribute("aria-label", "Kendi kalesine gol");
    parts.push(badge);
  }
  parts.push(node("span", "scorer-time", event.clock));
  if (event.assist) parts.push(node("span", "scorer-assist", event.assist));
  line.append(...(reverse ? parts.reverse() : parts));
  return line;
}

function renderSummaryEvents(detail) {
  const home = (detail.homeEvents || []).map(event => summaryEvent(event));
  const away = (detail.awayEvents || []).map(event => summaryEvent(event, true));
  elements.homeEventsList.replaceChildren(...home);
  elements.awayEventsList.replaceChildren(...away);
}

function renderTimeline(events, match) {
  elements.eventCount.textContent = `${events.length} olay`;
  if (!events.length) {
    elements.timeline.replaceChildren(emptyState("Maç olayı bulunamadı."));
    return;
  }
  const rows = events.map(event => {
    const row = node("div", `timeline-event ${event.type || ""}`);
    const copy = node("div", "timeline-copy");
    copy.append(node("strong", "", event.scorer), node("small", "", event.tag));
    if (event.assist) copy.append(node("small", "", event.assist));
    if (event.detail) copy.append(node("small", "event-detail", event.detail));
    const sideName = event.teamSide === "home" ? match.homeTeam : match.awayTeam;
    copy.append(node("span", "side-pill", sideName));
    row.append(node("span", "timeline-clock", event.clock), node("span", "timeline-icon", event.icon), copy);
    return row;
  });
  elements.timeline.replaceChildren(...rows);
}

function numericValue(value) {
  const parsed = Number.parseFloat(String(value).replace("%", "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function renderStats(stats) {
  if (!stats.length) {
    elements.statsContainer.replaceChildren(emptyState("Maç istatistikleri mevcut değil."));
    return;
  }
  const rows = stats.map(stat => {
    const row = node("div", `stat-row${stat.title === xgStatTitle ? " xg" : ""}`);
    const labels = node("div", "stat-labels");
    labels.append(node("span", "", stat.home), node("span", "stat-title", stat.title), node("span", "", stat.away));
    const homeValue = numericValue(stat.home);
    const awayValue = numericValue(stat.away);
    const total = homeValue + awayValue || 1;
    const track = node("div", "stat-track");
    const homeBar = node("div", "stat-home");
    const awayBar = node("div", "stat-away");
    homeBar.style.width = `${(homeValue / total) * 100}%`;
    awayBar.style.width = `${(awayValue / total) * 100}%`;
    track.append(homeBar, awayBar);
    row.append(labels, track);
    return row;
  });
  elements.statsContainer.replaceChildren(...rows);
}

const playerStatLabels = {
  totalGoals: "Gol",
  goalAssists: "Asist",
  totalShots: "Şut",
  shotsOnTarget: "İsabetli şut",
  yellowCards: "Sarı kart",
  redCards: "Kırmızı kart",
  foulsCommitted: "Yaptığı faul",
  foulsSuffered: "Maruz kaldığı faul",
  ownGoals: "Kendi kalesine gol",
  offsides: "Ofsayt",
  saves: "Kurtarış",
  goalsConceded: "Yediği gol",
  shotsFaced: "Karşılaştığı şut",
};

const playerPositionLabels = {
  G: "Kaleci", GK: "Kaleci", LB: "Sol bek", RB: "Sağ bek",
  CD: "Stoper", "CD-L": "Sol stoper", "CD-R": "Sağ stoper",
  DM: "Defansif orta saha", CM: "Merkez orta saha", "CM-L": "Sol merkez orta saha", "CM-R": "Sağ merkez orta saha",
  LM: "Sol orta saha", RM: "Sağ orta saha", AM: "Ofansif orta saha",
  "AM-L": "Sol ofansif orta saha", "AM-R": "Sağ ofansif orta saha",
  F: "Forvet", CF: "Santrfor", "CF-L": "Sol forvet", "CF-R": "Sağ forvet", SUB: "Yedek",
};

function playerPosition(player) {
  return playerPositionLabels[String(player.pos || "").toUpperCase()] || player.positionName || player.pos || "";
}

function playerBand(player) {
  const pos = String(player.pos || "").toUpperCase();
  if (pos === "G" || pos.includes("GK")) return "goalkeeper";
  if (pos.startsWith("AM") || pos.startsWith("CF") || pos.includes("W")) return "attacking";
  if (pos === "F" || pos.includes("ST")) return "forward";
  if (pos.includes("D") || pos === "LB" || pos === "RB") return "defense";
  if (pos.includes("M")) return "midfield";
  return "attacking";
}

function horizontalRank(player) {
  const pos = String(player.pos || "").toUpperCase();
  if (["LB", "LWB", "LM", "LW"].includes(pos)) return 0;
  if (pos.endsWith("-L")) return 1;
  if (pos.endsWith("-R")) return 3;
  if (["RB", "RWB", "RM", "RW"].includes(pos)) return 4;
  return 2;
}

function eventBadge(badge, compact = false) {
  const item = node("span", `player-event-badge ${badge.tone || ""}${compact ? " compact" : ""}`, badge.label);
  item.title = badge.title || "";
  return item;
}

function pitchEventBadges(badges = []) {
  const groups = new Map();
  for (const badge of badges) {
    const marker = String(badge.label || "").trim().split(/\s+/)[0];
    const key = `${badge.tone || ""}:${marker}`;
    const group = groups.get(key) || { marker, tone: badge.tone || "", labels: [], titles: [] };
    group.labels.push(badge.label);
    if (badge.title) group.titles.push(badge.title);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => eventBadge({
    label: group.labels.length > 1 ? `${group.marker}×${group.labels.length}` : group.marker,
    tone: group.tone,
    title: group.labels.join(" • "),
  }, true));
}

function playerKit(player, compact = false) {
  const kit = node("span", `player-kit${compact ? " compact" : ""}`);
  if (player.jerseyImage) {
    kit.append(image(player.jerseyImage, "player-jersey-image", ""));
  } else {
    kit.append(node("span", "player-kit-fallback", player.jersey || "?"));
  }
  return kit;
}

function showPlayerDialog(player) {
  const content = node("div", "player-dialog-body");
  const hero = node("div", "player-dialog-hero");
  const visual = player.headshot
    ? image(player.headshot, "player-dialog-image headshot", `${player.name} fotoğrafı`)
    : (player.jerseyImage
      ? image(player.jerseyImage, "player-dialog-image", `${player.name} forması`)
      : playerKit(player));
  const identity = node("div", "player-dialog-identity");
  const number = player.jersey ? `#${player.jersey}` : "";
  const title = node("h3", "", player.name || "Oyuncu");
  title.id = "playerDialogTitle";
  identity.append(
    node("span", "player-dialog-kicker", [number, playerPosition(player)].filter(Boolean).join(" • ")),
    title,
  );
  const badges = node("div", "player-dialog-badges");
  badges.append(...(player.eventBadges || []).map(badge => eventBadge(badge)));
  if (badges.childNodes.length) identity.append(badges);
  hero.append(visual, identity);
  content.append(hero);

  const statEntries = Object.entries(player.stats || {}).filter(([key]) => playerStatLabels[key]);
  if (statEntries.length) {
    const stats = node("div", "player-stat-grid");
    for (const [key, value] of statEntries) {
      const stat = node("div", "player-stat");
      stat.append(node("strong", "", value), node("span", "", playerStatLabels[key]));
      stats.append(stat);
    }
    content.append(stats);
  } else {
    content.append(emptyState("Bu oyuncu için maç istatistiği bulunmuyor."));
  }
  elements.playerDialogContent.replaceChildren(content);
  if (!elements.playerDialog.open) elements.playerDialog.showModal();
}

function teamRecordItem(value, label) {
  const item = node("div", "team-record-item");
  item.append(node("strong", "", value), node("span", "", label));
  return item;
}

function openTeamMatch(match) {
  elements.teamDialog.close();
  state.activeLeague = leagueKeyFromSlug(match.leagueSlug);
  state.selectedDate = match.matchDate || toISODate(new Date(match.startTime));
  state.selectedMatchId = match.id;
  state.detailMatchId = null;
  state.activeView = "matches";
  elements.leagueSelect.value = state.activeLeague;
  updateLeaguePicker();
  updateDateControls();
  updateFavoriteControls();
  setView("matches");
  syncURL(true);
  loadFixtures();
}

function teamMatchRow(match) {
  const button = node("button", "team-match-row");
  button.type = "button";
  const opponent = node("span", "team-match-opponent");
  opponent.append(image(match.opponentLogo, "", ""), node("span", "", `${match.isHome ? "İç saha" : "Deplasman"} • ${match.opponent}`));
  const score = node("strong", `team-match-score ${match.result || ""}`, match.status === "FT" ? match.score : match.time);
  button.append(node("span", "team-match-date", match.fullDate || match.time), opponent, score);
  button.addEventListener("click", () => openTeamMatch(match));
  return button;
}

function renderTeamDialog(data) {
  const team = data.team || {};
  const record = data.record || {};
  const body = node("div", "team-dialog-body");
  const hero = node("div", "team-dialog-hero");
  if (/^[0-9a-f]{6}$/i.test(team.color || "")) hero.style.setProperty("--team-color", `#${team.color}`);
  const logo = image(team.logo, "team-dialog-logo", `${team.name} logosu`);
  const title = node("div", "team-dialog-title");
  const heading = node("h2", "", team.name || "Takım");
  heading.id = "teamDialogTitle";
  title.append(node("span", "", team.league || ""), heading);
  const favorite = node("button", `team-favorite-button${state.favoriteTeams.has(String(team.id)) ? " active" : ""}`, state.favoriteTeams.has(String(team.id)) ? "★" : "☆");
  favorite.type = "button";
  favorite.setAttribute("aria-label", `${team.name} favorisini değiştir`);
  favorite.addEventListener("click", () => {
    toggleFavoriteTeam(team.id);
    renderTeamDialog(data);
  });
  hero.append(logo, title, favorite);
  body.append(hero);

  const recordGrid = node("div", "team-record-grid");
  recordGrid.append(
    teamRecordItem(record.rank ? `${record.rank}.` : "-", "Lig sırası"),
    teamRecordItem(record.points ?? "-", "Puan"),
    teamRecordItem(record.played ?? "-", "Maç"),
    teamRecordItem(`${record.wins ?? 0}-${record.draws ?? 0}-${record.losses ?? 0}`, "G-B-M"),
    teamRecordItem(`${record.goalsFor ?? 0}:${record.goalsAgainst ?? 0}`, "Gol"),
  );
  body.append(recordGrid);

  const performance = data.performance || {};
  const performanceGrid = node("div", "team-performance-grid");
  for (const [key, title] of [["home", "İç saha"], ["away", "Deplasman"]]) {
    const values = performance[key] || {};
    const card = node("div", "team-performance-card");
    card.append(
      node("strong", "", title),
      node("span", "", `${values.played || 0} maç • ${values.wins || 0}G ${values.draws || 0}B ${values.losses || 0}M`),
      node("small", "", `Gol ${values.goalsFor || 0}:${values.goalsAgainst || 0}`),
    );
    performanceGrid.append(card);
  }
  body.append(performanceGrid);

  const recent = data.recent || [];
  const recentSection = node("section", "team-section");
  const recentHeading = node("div", "team-section-heading");
  const form = node("span", "form-strip");
  form.append(...recent.slice().reverse().map(match => node("span", `form-result ${match.result || ""}`, match.result || "-")));
  recentHeading.append(node("strong", "", "Son maçlar"), form);
  const recentList = node("div", "team-match-list");
  recentList.append(...(recent.length ? recent.map(teamMatchRow) : [emptyState("Henüz tamamlanan maç yok.")]));
  recentSection.append(recentHeading, recentList);
  body.append(recentSection);

  const upcoming = data.upcoming || [];
  const upcomingSection = node("section", "team-section");
  upcomingSection.append(node("div", "team-section-heading", "Yaklaşan maçlar"));
  const upcomingList = node("div", "team-match-list");
  upcomingList.append(...(upcoming.length ? upcoming.map(teamMatchRow) : [emptyState("Planlanmış maç bulunamadı.")]));
  upcomingSection.append(upcomingList);
  body.append(upcomingSection);

  const squad = data.squad || [];
  const squadSection = node("section", "team-section");
  squadSection.append(node("div", "team-section-heading", `Takım kadrosu • ${squad.length}`));
  const squadGrid = node("div", "squad-grid");
  const positionOrder = { G: 0, GK: 0, D: 1, CD: 1, LB: 1, RB: 1, M: 2, DM: 2, CM: 2, AM: 2, F: 3, CF: 3 };
  const sortedSquad = squad.slice().sort((a, b) => (positionOrder[a.position] ?? 9) - (positionOrder[b.position] ?? 9) || String(a.name).localeCompare(String(b.name), "tr"));
  for (const player of sortedSquad) {
    const card = node("div", "squad-player");
    const avatar = player.headshot ? image(player.headshot, "squad-avatar", "") : node("span", "squad-avatar", player.jersey || player.name?.slice(0, 2));
    const copy = node("span", "squad-player-copy");
    copy.append(node("strong", "", `${player.jersey ? `${player.jersey} • ` : ""}${player.shortName || player.name}`), node("span", "", [player.positionName, player.age ? `${player.age} yaş` : ""].filter(Boolean).join(" • ")));
    card.append(avatar, copy);
    squadGrid.append(card);
  }
  if (!squad.length) squadGrid.append(emptyState("Kadro verisi bulunamadı."));
  squadSection.append(squadGrid);
  body.append(squadSection);
  elements.teamDialogContent.replaceChildren(body);
}

async function openTeamDetail(teamId, leagueSlug) {
  if (!teamId || !leagueSlug) return;
  const requestId = ++state.teamRequest;
  elements.teamDialogContent.replaceChildren(node("div", "skeleton"), node("div", "skeleton"), node("div", "skeleton"));
  if (!elements.teamDialog.open) elements.teamDialog.showModal();
  try {
    const params = new URLSearchParams({ team_id: teamId, league_slug: leagueSlug });
    const data = await requestJSON(`/api/team-detail?${params}`);
    if (requestId !== state.teamRequest) return;
    renderTeamDialog(data);
  } catch (error) {
    if (requestId !== state.teamRequest) return;
    elements.teamDialogContent.replaceChildren(emptyState("Takım bilgisi yüklenemedi", error.message));
  }
}

function pitchPlayer(player) {
  const button = node("button", "pitch-player");
  button.type = "button";
  button.setAttribute("aria-label", `${player.name} oyuncu kartını aç`);
  const visual = node("span", "pitch-player-visual");
  visual.append(playerKit(player));
  const badges = node("span", "pitch-player-badges");
  badges.append(...pitchEventBadges(player.eventBadges || []));
  button.append(visual, node("span", "pitch-player-name", player.shortName || player.name), badges);
  button.addEventListener("click", () => showPlayerDialog(player));
  return button;
}

function benchPlayer(player) {
  const button = node("button", `bench-player${player.subbedIn ? " entered" : ""}`);
  button.type = "button";
  button.setAttribute("aria-label", `${player.name} oyuncu kartını aç`);
  button.append(playerKit(player, true), node("span", "bench-player-name", player.shortName || player.name));
  const badges = (player.eventBadges || []).map(badge => eventBadge(badge, true));
  if (badges.length) button.append(...badges);
  button.addEventListener("click", () => showPlayerDialog(player));
  return button;
}

function lineupVisual(players, bench) {
  if (!players.length) return emptyState("Kadro açıklanmadı.");
  const content = node("div", "pitch-and-bench");
  const pitch = node("div", "football-pitch");
  pitch.append(
    node("span", "pitch-halfway"),
    node("span", "pitch-circle"),
    node("span", "pitch-box top"),
    node("span", "pitch-box bottom"),
  );
  for (const band of ["forward", "attacking", "midfield", "defense", "goalkeeper"]) {
    const linePlayers = players
      .filter(player => playerBand(player) === band)
      .sort((a, b) => horizontalRank(a) - horizontalRank(b) || Number(a.formationPlace || 99) - Number(b.formationPlace || 99));
    if (!linePlayers.length) continue;
    const row = node("div", `pitch-row ${band}`);
    row.style.gridTemplateColumns = `repeat(${linePlayers.length}, minmax(0, 1fr))`;
    row.append(...linePlayers.map(pitchPlayer));
    pitch.append(row);
  }
  content.append(pitch);

  const benchBox = node("div", "bench-box");
  const benchTitle = node("div", "bench-title");
  benchTitle.append(node("strong", "", "Yedekler"), node("span", "", `${bench.length} oyuncu`));
  benchBox.append(benchTitle);
  if (bench.length) {
    const benchList = node("div", "bench-list");
    benchList.append(...bench.map(benchPlayer));
    benchBox.append(benchList);
  } else {
    benchBox.append(emptyState("Yedek kadro bilgisi yok."));
  }
  content.append(benchBox);
  return content;
}

function setMobileLineup(side) {
  const homeActive = side === "home";
  elements.lineupHomeTab.classList.toggle("active", homeActive);
  elements.lineupAwayTab.classList.toggle("active", !homeActive);
  elements.lineupHomeCol.classList.toggle("mobile-active", homeActive);
  elements.lineupAwayCol.classList.toggle("mobile-active", !homeActive);
}

function renderLineups(lineups) {
  elements.lineupBadge.textContent = lineups.isOfficial ? "Resmi 11'ler" : "Kadro açıklanmadı";
  elements.lineupHomeForm.textContent = lineups.homeFormation || "";
  elements.lineupAwayForm.textContent = lineups.awayFormation || "";
  elements.lineupHomeTab.textContent = elements.lineupHomeName.textContent;
  elements.lineupAwayTab.textContent = elements.lineupAwayName.textContent;
  const home = lineups.home || [];
  const away = lineups.away || [];
  elements.homeLineupList.replaceChildren(lineupVisual(home, lineups.homeBench || []));
  elements.awayLineupList.replaceChildren(lineupVisual(away, lineups.awayBench || []));
  setMobileLineup("home");
}

function renderTicker() {
  const matches = state.matches;
  if (!matches.length) {
    elements.tickerTrack.replaceChildren(node("div", "ticker-item", "Bu tarih için skor bulunamadı."));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const match of matches) {
    const item = node("div", "ticker-item");
    item.append(node("strong", "", match.homeTeam), node("span", "", match.score), node("strong", "", match.awayTeam), node("span", `ticker-status ${match.status}`, `(${match.time})`));
    fragment.append(item);
  }
  const firstSet = Array.from(fragment.childNodes);
  elements.tickerTrack.replaceChildren(...firstSet, ...firstSet.map(item => item.cloneNode(true)));
}

function updateLiveCount() {
  const count = state.matches.filter(match => match.status === "LIVE").length;
  elements.liveCount.textContent = count ? `${count} CANLI MAÇ` : "CANLI AKIŞ";
}

async function loadStandings() {
  setLoading(elements.standingsPanel, 4);
  if (state.activeLeague === "all") {
    elements.standingsPanel.replaceChildren(emptyState("Puan durumu için bir lig seçin."));
    return;
  }
  try {
    const data = await requestJSON(`/api/standings?league=${encodeURIComponent(state.activeLeague)}`);
    renderStandings(data.groups || []);
  } catch (error) {
    elements.standingsPanel.replaceChildren(emptyState("Puan durumu yüklenemedi", error.message));
    showToast(error.message);
  }
}

function renderStandings(groups) {
  if (!groups.length) {
    elements.standingsPanel.replaceChildren(emptyState("Bu lig için puan durumu yok."));
    return;
  }
  const content = [];
  for (const group of groups) {
    content.push(node("div", "standings-group-title", group.name));
    const wrap = node("div", "standings-wrap");
    const table = node("table", "standings-table");
    const head = node("thead");
    const headRow = node("tr");
    for (const label of ["#", "Takım", "O", "G", "B", "M", "AV", "P"]) headRow.append(node("th", "", label));
    head.append(headRow);
    const body = node("tbody");
    for (const standing of group.rows || []) {
      const row = node("tr");
      if (/^#[0-9a-f]{6}$/i.test(standing.noteColor || "")) row.style.setProperty("--standing-note", standing.noteColor);
      if (standing.note) {
        row.classList.add("has-standing-note");
        row.title = standing.note;
      }
      row.append(node("td", "", standing.rank));
      const teamCell = node("td");
      const team = node("button", "table-team");
      team.type = "button";
      team.append(image(standing.logo, "team-logo table-logo", ""), node("span", "", standing.team));
      team.addEventListener("click", () => openTeamDetail(standing.teamId, leagueSlugs[state.activeLeague]));
      teamCell.append(team);
      row.append(teamCell);
      for (const key of ["played", "wins", "draws", "losses", "goalDifference"]) row.append(node("td", "", standing[key]));
      row.append(node("td", "points-cell", standing.points));
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    content.push(wrap);
    const notes = new Map();
    for (const standing of group.rows || []) {
      if (standing.note) notes.set(standing.note, standing.noteColor || "#38bdf8");
    }
    if (notes.size) {
      const legend = node("div", "standings-legend");
      for (const [label, color] of notes) {
        const item = node("span", "standings-legend-item");
        const dot = node("i", "standings-legend-dot");
        if (/^#[0-9a-f]{6}$/i.test(color)) dot.style.background = color;
        item.append(dot, node("span", "", label));
        legend.append(item);
      }
      content.push(legend);
    }
  }
  elements.standingsPanel.replaceChildren(...content);
}

function renderLeaders(data) {
  const sections = [
    { title: "Gol Krallığı", valueLabel: "Gol", rows: data.goals || [] },
    { title: "Asist Liderleri", valueLabel: "Asist", rows: data.assists || [] },
  ];
  const content = [];
  if (data.season) content.push(node("div", "leaders-season", data.season));
  for (const section of sections) {
    const card = node("section", "leaders-card");
    card.append(node("div", "leaders-title", section.title));
    const list = node("div", "leaders-list");
    for (const player of section.rows) {
      const row = node("div", "leader-row");
      const team = node("button", "leader-team");
      team.type = "button";
      team.append(image(player.teamLogo, "team-logo leader-logo", ""), node("span", "", player.team || "-"));
      if (player.teamId) team.addEventListener("click", () => openTeamDetail(player.teamId, leagueSlugs[state.activeLeague]));
      row.append(
        node("span", "leader-rank", player.rank),
        node("strong", "leader-name", player.name),
        team,
        node("span", "leader-played", `${player.appearances} maç`),
        node("strong", "leader-value", `${player.value} ${section.valueLabel}`),
      );
      list.append(row);
    }
    if (!section.rows.length) list.append(emptyState("Bu lig için liderlik verisi bulunamadı."));
    card.append(list);
    content.push(card);
  }
  elements.leadersPanel.replaceChildren(...content);
}

async function loadLeaders() {
  const requestId = ++state.leadersRequest;
  setLoading(elements.leadersPanel, 4);
  if (state.activeLeague === "all") {
    elements.leadersPanel.replaceChildren(emptyState("Liderleri görmek için bir lig seçin."));
    return;
  }
  try {
    const data = await requestJSON(`/api/leaders?league=${encodeURIComponent(state.activeLeague)}`);
    if (requestId !== state.leadersRequest) return;
    renderLeaders(data);
  } catch (error) {
    if (requestId !== state.leadersRequest) return;
    elements.leadersPanel.replaceChildren(emptyState("Liderlik verisi yüklenemedi", error.message));
  }
}

function setView(view) {
  state.activeView = view;
  const matchesActive = view === "matches";
  const standingsActive = view === "standings";
  const leadersActive = view === "leaders";
  elements.matchesTab.classList.toggle("active", matchesActive);
  elements.standingsTab.classList.toggle("active", standingsActive);
  elements.leadersTab.classList.toggle("active", leadersActive);
  elements.matchFeed.hidden = !matchesActive;
  elements.standingsPanel.hidden = !standingsActive;
  elements.leadersPanel.hidden = !leadersActive;
  elements.liveFilter.hidden = !matchesActive;
  elements.favoritesFilter.hidden = !matchesActive;
  elements.matchSearch.closest(".match-search").hidden = !matchesActive;
  if (standingsActive) loadStandings();
  if (leadersActive) loadLeaders();
}

function bindElements() {
  const ids = [
    "liveCount", "mainStage", "previousDay", "yesterdayButton", "todayButton", "tomorrowButton", "datePicker", "datePickerLabel", "nextDay",
    "selectedDateLabel", "stagePlaceholder", "stageContent", "backToOverview", "detailsGrid", "stageMeta", "stageHomeLogo",
    "stageAwayLogo", "stageHome", "stageAway", "stageScore", "homeEventsList", "awayEventsList", "stageTag",
    "timeline", "eventCount", "statsContainer", "lineupBadge", "lineupHomeName", "lineupAwayName", "lineupHomeForm",
    "lineupAwayForm", "homeLineupList", "awayLineupList", "venueText", "refereeText", "leagueSelect", "matchesTab",
    "standingsTab", "liveFilter", "matchFeed", "standingsPanel", "tickerTrack", "toast", "lineupHomeTab",
    "lineupAwayTab", "lineupHomeCol", "lineupAwayCol", "playerDialog", "playerDialogClose", "playerDialogContent",
    "matchDetailTabs", "stageHomeButton", "stageAwayButton", "stageHomeFavorite", "stageAwayFavorite", "copyLinkButton",
    "favoriteLeagueButton", "favoritesFilter", "notificationButton", "stageFollowButton", "teamDialog", "teamDialogClose", "teamDialogContent",
    "leaguePicker", "leagueSelectButton", "leagueSelectedLogo", "leagueSelectedName", "leagueMenu",
    "leadersTab", "leadersPanel", "matchSearch", "h2hContainer",
  ];
  for (const id of ids) elements[id] = document.getElementById(id);
}

function bindEvents() {
  elements.previousDay.addEventListener("click", () => setDate(addDays(state.selectedDate, -1)));
  elements.nextDay.addEventListener("click", () => setDate(addDays(state.selectedDate, 1)));
  const today = () => toISODate(new Date());
  elements.yesterdayButton.addEventListener("click", () => setDate(addDays(today(), -1)));
  elements.todayButton.addEventListener("click", () => setDate(today()));
  elements.tomorrowButton.addEventListener("click", () => setDate(addDays(today(), 1)));
  elements.datePicker.addEventListener("change", event => {
    elements.datePicker.classList.remove("open");
    if (event.target.value) setDate(event.target.value);
  });
  elements.datePicker.addEventListener("click", event => event.stopPropagation());
  elements.datePickerLabel.addEventListener("click", event => {
    event.stopPropagation();
    elements.datePicker.value = state.selectedDate;
    if (typeof elements.datePicker.showPicker === "function") {
      try { elements.datePicker.showPicker(); return; }
      catch (_) { /* Fall through to the visible desktop control. */ }
    }
    elements.datePicker.classList.toggle("open");
    if (elements.datePicker.classList.contains("open")) {
      elements.datePicker.focus();
    }
  });
  document.addEventListener("click", () => elements.datePicker.classList.remove("open"));
  elements.leagueSelect.addEventListener("change", event => {
    state.activeLeague = event.target.value;
    state.selectedMatchId = null;
    state.selectedMatch = null;
    state.detailMatchId = null;
    updateLeaguePicker();
    updateFavoriteControls();
    syncURL();
    if (state.activeView === "matches") loadFixtures();
    else if (state.activeView === "standings") loadStandings();
    else loadLeaders();
  });
  elements.leagueSelectButton.addEventListener("click", event => {
    event.stopPropagation();
    setLeagueMenu(elements.leagueMenu.hidden);
  });
  elements.leaguePicker.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", () => setLeagueMenu(false));
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || elements.leagueMenu.hidden) return;
    setLeagueMenu(false);
    elements.leagueSelectButton.focus();
  });
  elements.liveFilter.addEventListener("click", () => {
    state.liveOnly = !state.liveOnly;
    elements.liveFilter.classList.toggle("active", state.liveOnly);
    elements.liveFilter.setAttribute("aria-pressed", String(state.liveOnly));
    renderMatches();
    if (!state.selectedMatchId) renderDayOverview(visibleMatches());
  });
  elements.favoritesFilter.addEventListener("click", () => {
    state.favoritesOnly = !state.favoritesOnly;
    updateFavoriteControls();
    renderMatches();
    if (!state.selectedMatchId) renderDayOverview(visibleMatches());
  });
  elements.matchSearch.addEventListener("input", event => {
    state.searchQuery = event.target.value;
    renderMatches();
    if (!state.selectedMatchId) renderDayOverview(visibleMatches());
  });
  elements.favoriteLeagueButton.addEventListener("click", toggleFavoriteLeague);
  elements.notificationButton.addEventListener("click", toggleNotifications);
  elements.backToOverview.addEventListener("click", returnToDayOverview);
  elements.matchesTab.addEventListener("click", () => setView("matches"));
  elements.standingsTab.addEventListener("click", () => setView("standings"));
  elements.leadersTab.addEventListener("click", () => setView("leaders"));
  elements.lineupHomeTab.addEventListener("click", () => setMobileLineup("home"));
  elements.lineupAwayTab.addEventListener("click", () => setMobileLineup("away"));
  for (const button of elements.matchDetailTabs.querySelectorAll("[data-detail-tab]")) {
    button.addEventListener("click", () => setDetailTab(button.dataset.detailTab));
  }
  elements.stageHomeButton.addEventListener("click", () => openTeamDetail(elements.stageHomeButton.dataset.teamId, elements.stageHomeButton.dataset.leagueSlug));
  elements.stageAwayButton.addEventListener("click", () => openTeamDetail(elements.stageAwayButton.dataset.teamId, elements.stageAwayButton.dataset.leagueSlug));
  elements.stageHomeFavorite.addEventListener("click", () => toggleFavoriteTeam(state.selectedMatch?.homeId));
  elements.stageAwayFavorite.addEventListener("click", () => toggleFavoriteTeam(state.selectedMatch?.awayId));
  elements.stageFollowButton.addEventListener("click", () => toggleFollowedMatch(state.selectedMatch));
  elements.copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Maç bağlantısı kopyalandı.");
    } catch (_) {
      showToast("Bağlantı kopyalanamadı; adres çubuğundaki URL'yi kullanabilirsin.");
    }
  });
  elements.playerDialogClose.addEventListener("click", () => elements.playerDialog.close());
  elements.playerDialog.addEventListener("click", event => {
    if (event.target === elements.playerDialog) elements.playerDialog.close();
  });
  elements.teamDialogClose.addEventListener("click", () => elements.teamDialog.close());
  elements.teamDialog.addEventListener("click", event => {
    if (event.target === elements.teamDialog) elements.teamDialog.close();
  });
}

function init() {
  bindElements();
  bindEvents();
  restoreFixtureCache();
  state.favoriteTeams = storedSet(localStorage, preferenceKeys.teams);
  state.favoriteLeagues = storedSet(localStorage, preferenceKeys.leagues);
  state.followedMatches = storedSet(localStorage, preferenceKeys.followedMatches);
  try { state.overviewGrouping = localStorage.getItem(preferenceKeys.overviewGrouping) === "league" ? "league" : "status"; } catch (_) { state.overviewGrouping = "status"; }
  try { state.notificationsEnabled = localStorage.getItem(preferenceKeys.notifications) === "true"; } catch (_) { state.notificationsEnabled = false; }
  const urlState = parseURLState(window.location.search);
  state.activeLeague = urlState.league;
  if (urlState.date) state.selectedDate = urlState.date;
  state.selectedMatchId = urlState.match;
  elements.leagueSelect.value = state.activeLeague;
  renderLeagueMenu();
  updateDateControls();
  updateFavoriteControls();
  updateNotificationButton();
  syncURL();
  loadFixtures();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.activeView === "matches") loadFixtures({ background: true, force: true });
  });
  window.addEventListener("popstate", () => {
    const next = parseURLState(window.location.search);
    state.activeLeague = next.league;
    state.selectedDate = next.date || toISODate(new Date());
    state.selectedMatchId = next.match;
    state.selectedMatch = null;
    state.detailMatchId = null;
    elements.leagueSelect.value = state.activeLeague;
    updateLeaguePicker();
    updateDateControls();
    updateFavoriteControls();
    loadFixtures();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
