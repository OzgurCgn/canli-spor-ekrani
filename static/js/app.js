"use strict";

const state = {
  activeLeague: "all",
  selectedDate: toISODate(new Date()),
  matches: [],
  selectedMatchId: null,
  liveOnly: false,
  activeView: "matches",
  fixtureRequest: 0,
  detailRequest: 0,
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

function emptyState(title, detail = "") {
  const box = node("div", "empty-state");
  box.append(node("strong", "", title));
  if (detail) box.append(node("span", "", detail));
  return box;
}

async function requestJSON(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  let payload = null;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.detail || "Veri alınırken bir sorun oluştu.");
  }
  return payload;
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
  state.selectedDate = value;
  state.selectedMatchId = null;
  updateDateControls();
  loadFixtures();
}

function setStageMatch(match) {
  elements.stagePlaceholder.hidden = true;
  elements.stageContent.hidden = false;
  elements.detailsGrid.hidden = false;
  elements.stageMeta.textContent = match.round ? `${match.league} • ${match.round}` : match.league;
  elements.stageHome.textContent = match.homeTeam;
  elements.stageAway.textContent = match.awayTeam;
  elements.stageScore.textContent = match.score;
  setImage(elements.stageHomeLogo, match.homeLogo, `${match.homeTeam} logosu`);
  setImage(elements.stageAwayLogo, match.awayLogo, `${match.awayTeam} logosu`);
  elements.lineupHomeName.textContent = match.homeTeam;
  elements.lineupAwayName.textContent = match.awayTeam;
  elements.stageTag.className = `match-tag${match.status === "LIVE" ? " live" : ""}`;
  elements.stageTag.textContent = match.status === "LIVE" ? match.minute : (match.fullDate || match.time);
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
}

async function loadFixtures() {
  const requestId = ++state.fixtureRequest;
  setLoading(elements.matchFeed);
  try {
    const params = new URLSearchParams({ league: state.activeLeague, date: state.selectedDate });
    const data = await requestJSON(`/api/fixtures?${params}`);
    if (requestId !== state.fixtureRequest) return;
    state.matches = data.matches || [];
    renderMatches();
    renderTicker();
    updateLiveCount();

    const selected = state.matches.find(match => match.id === state.selectedMatchId);
    if (selected) {
      setStageMatch(selected);
      if (selected.status === "LIVE") loadMatchDetail(selected);
    } else if (state.matches.length && state.activeLeague !== "all") {
      selectMatch(state.matches[0]);
    } else if (state.matches.length) {
      renderDayOverview(visibleMatches());
    } else {
      clearStage("Bu tarihte maç bulunamadı.");
    }
  } catch (error) {
    if (requestId !== state.fixtureRequest) return;
    elements.matchFeed.replaceChildren(emptyState("Maçlar yüklenemedi", error.message));
    showToast(error.message);
  }
}

function visibleMatches() {
  return state.liveOnly ? state.matches.filter(match => match.status === "LIVE") : state.matches;
}

function renderMatches() {
  const matches = visibleMatches();
  if (!matches.length) {
    const message = state.liveOnly ? "Şu anda canlı maç yok." : "Bu tarihte maç bulunamadı.";
    elements.matchFeed.replaceChildren(emptyState(message));
    return;
  }

  const cards = matches.map(match => {
    const card = node("button", `feed-card ${match.status}${match.id === state.selectedMatchId ? " active-selected" : ""}`);
    card.type = "button";
    card.dataset.matchId = match.id;
    card.setAttribute("aria-label", `${match.homeTeam} - ${match.awayTeam} maçını aç`);

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
    card.append(header, body);
    card.addEventListener("click", () => selectMatch(match));
    return card;
  });
  elements.matchFeed.replaceChildren(...cards);
}

function overviewMatchCard(match) {
  const card = node("button", `overview-match ${match.status}`);
  card.type = "button";
  card.setAttribute("aria-label", `${match.homeTeam} - ${match.awayTeam} maçını aç`);

  const meta = node("span", "overview-meta");
  const statusText = match.status === "LIVE" ? match.minute : (match.status === "FT" ? "MS" : match.time);
  meta.append(node("span", "", match.league), node("strong", `overview-status ${match.status}`, statusText));

  const teams = node("span", "overview-teams");
  for (const [name, logo] of [[match.homeTeam, match.homeLogo], [match.awayTeam, match.awayLogo]]) {
    const team = node("span", "overview-team");
    team.append(image(logo, "team-logo overview-logo", ""), node("span", "", name));
    teams.append(team);
  }
  card.append(meta, teams, node("span", "overview-score", match.score));
  card.addEventListener("click", () => selectMatch(match));
  return card;
}

function renderDayOverview(matches) {
  state.selectedMatchId = null;
  elements.stageContent.hidden = true;
  elements.detailsGrid.hidden = true;
  elements.stagePlaceholder.hidden = false;

  const dateText = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(fromISODate(state.selectedDate));
  const overview = node("div", "day-overview");
  const heading = node("div", "overview-heading");
  heading.append(node("span", "overview-kicker", "GÜNÜN MAÇLARI"), node("h2", "", dateText));
  overview.append(heading);

  const sections = [
    { title: "Canlı", className: "live", matches: matches.filter(match => match.status === "LIVE") },
    { title: "Tamamlanan", className: "finished", matches: matches.filter(match => match.status === "FT") },
    { title: "Yaklaşan", className: "upcoming", matches: matches.filter(match => match.status !== "LIVE" && match.status !== "FT") },
  ];
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
  if (!matches.length) overview.append(emptyState(state.liveOnly ? "Şu anda canlı maç yok." : "Bu tarihte maç bulunamadı."));
  elements.stagePlaceholder.replaceChildren(overview);
}

function clearStage(message) {
  state.selectedMatchId = null;
  elements.stagePlaceholder.textContent = message;
  elements.stagePlaceholder.hidden = false;
  elements.stageContent.hidden = true;
  elements.detailsGrid.hidden = true;
}

async function selectMatch(match) {
  if (!match) return;
  state.selectedMatchId = match.id;
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
    const row = node("div", "stat-row");
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
  if (pos.endsWith("-L") || pos === "LB" || pos === "LM" || pos === "LW") return 0;
  if (pos.endsWith("-R") || pos === "RB" || pos === "RM" || pos === "RW") return 2;
  return 1;
}

function eventBadge(badge, compact = false) {
  const item = node("span", `player-event-badge ${badge.tone || ""}${compact ? " compact" : ""}`, badge.label);
  item.title = badge.title || "";
  return item;
}

function playerKit(player, compact = false) {
  const kit = node("span", `player-kit${compact ? " compact" : ""}`);
  kit.append(node("span", "player-kit-fallback", player.jersey || "?"));
  if (player.jerseyImage) kit.append(image(player.jerseyImage, "player-jersey-image", ""));
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

function pitchPlayer(player) {
  const button = node("button", "pitch-player");
  button.type = "button";
  button.setAttribute("aria-label", `${player.name} oyuncu kartını aç`);
  button.append(playerKit(player));
  const badges = node("span", "pitch-player-badges");
  badges.append(...(player.eventBadges || []).map(badge => eventBadge(badge, true)));
  if (badges.childNodes.length) button.append(badges);
  button.append(node("span", "pitch-player-name", player.shortName || player.name));
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
      row.append(node("td", "", standing.rank));
      const teamCell = node("td");
      const team = node("span", "table-team");
      team.append(image(standing.logo, "team-logo table-logo", ""), node("span", "", standing.team));
      teamCell.append(team);
      row.append(teamCell);
      for (const key of ["played", "wins", "draws", "losses", "goalDifference"]) row.append(node("td", "", standing[key]));
      row.append(node("td", "points-cell", standing.points));
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    content.push(wrap);
  }
  elements.standingsPanel.replaceChildren(...content);
}

function setView(view) {
  state.activeView = view;
  const matchesActive = view === "matches";
  elements.matchesTab.classList.toggle("active", matchesActive);
  elements.standingsTab.classList.toggle("active", !matchesActive);
  elements.matchFeed.hidden = !matchesActive;
  elements.standingsPanel.hidden = matchesActive;
  elements.liveFilter.hidden = !matchesActive;
  if (!matchesActive) loadStandings();
}

function bindElements() {
  const ids = [
    "liveCount", "previousDay", "yesterdayButton", "todayButton", "tomorrowButton", "datePicker", "nextDay",
    "selectedDateLabel", "stagePlaceholder", "stageContent", "detailsGrid", "stageMeta", "stageHomeLogo",
    "stageAwayLogo", "stageHome", "stageAway", "stageScore", "homeEventsList", "awayEventsList", "stageTag",
    "timeline", "eventCount", "statsContainer", "lineupBadge", "lineupHomeName", "lineupAwayName", "lineupHomeForm",
    "lineupAwayForm", "homeLineupList", "awayLineupList", "venueText", "refereeText", "leagueSelect", "matchesTab",
    "standingsTab", "liveFilter", "matchFeed", "standingsPanel", "tickerTrack", "toast", "lineupHomeTab",
    "lineupAwayTab", "lineupHomeCol", "lineupAwayCol", "playerDialog", "playerDialogClose", "playerDialogContent",
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
  elements.datePicker.addEventListener("change", event => { if (event.target.value) setDate(event.target.value); });
  elements.leagueSelect.addEventListener("change", event => {
    state.activeLeague = event.target.value;
    state.selectedMatchId = null;
    if (state.activeView === "matches") loadFixtures(); else loadStandings();
  });
  elements.liveFilter.addEventListener("click", () => {
    state.liveOnly = !state.liveOnly;
    elements.liveFilter.classList.toggle("active", state.liveOnly);
    elements.liveFilter.setAttribute("aria-pressed", String(state.liveOnly));
    renderMatches();
    if (!state.selectedMatchId) renderDayOverview(visibleMatches());
  });
  elements.matchesTab.addEventListener("click", () => setView("matches"));
  elements.standingsTab.addEventListener("click", () => setView("standings"));
  elements.lineupHomeTab.addEventListener("click", () => setMobileLineup("home"));
  elements.lineupAwayTab.addEventListener("click", () => setMobileLineup("away"));
  elements.playerDialogClose.addEventListener("click", () => elements.playerDialog.close());
  elements.playerDialog.addEventListener("click", event => {
    if (event.target === elements.playerDialog) elements.playerDialog.close();
  });
}

function init() {
  bindElements();
  bindEvents();
  updateDateControls();
  loadFixtures();
  window.setInterval(() => {
    if (state.activeView === "matches" && !document.hidden) loadFixtures();
  }, 15000);
}

document.addEventListener("DOMContentLoaded", init);
