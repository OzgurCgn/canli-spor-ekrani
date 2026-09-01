import time
import webbrowser
import threading
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import httpx
import uvicorn

app = FastAPI(title="Canlı Spor Ekranı")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LEAGUE_MAP = {
    "superlig": {"slug": "tur.1", "name": "Trendyol Süper Lig"},
    "premier": {"slug": "eng.1", "name": "Premier League"},
    "laliga": {"slug": "esp.1", "name": "La Liga"},
    "seriea": {"slug": "ita.1", "name": "Serie A"},
    "bundesliga": {"slug": "ger.1", "name": "Bundesliga"},
    "ligue1": {"slug": "fra.1", "name": "Ligue 1"},
    "eredivisie": {"slug": "ned.1", "name": "Eredivisie"},
    "ligaportugal": {"slug": "por.1", "name": "Liga Portugal"},
    "saudi": {"slug": "ksa.1", "name": "Suudi Pro Ligi"},
    "ucl": {"slug": "uefa.champions", "name": "Şampiyonlar Ligi"},
    "uel": {"slug": "uefa.europa", "name": "Avrupa Ligi"},
    "uecl": {"slug": "uefa.europa.conf", "name": "Konferans Ligi"}
}

TEAM_NAME_FIXES = {
    "Besiktas": "Beşiktaş", "Fenerbahce": "Fenerbahçe", "Galatasaray": "Galatasaray",
    "Trabzonspor": "Trabzonspor", "Istanbul Basaksehir": "Başakşehir", "Basaksehir": "Başakşehir",
    "Gaziantep FK": "Gaziantep FK", "Kasimpasa": "Kasımpaşa", "Konyaspor": "Konyaspor",
    "Caykur Rizespor": "Çaykur Rizespor", "Rizespor": "Çaykur Rizespor", "Goztepe": "Göztepe",
    "Bodrum FK": "Bodrum FK", "Eyupspor": "Eyüpspor", "Sivasspor": "Sivasspor",
    "Alanyaspor": "Alanyaspor", "Antalyaspor": "Antalyaspor", "Kayserispor": "Kayserispor",
    "Adana Demirspor": "Adana Demirspor", "Genclerbirligi": "Gençlerbirliği",
    "Erzurum BB": "Erzurumspor FK", "Corum FK": "Çorum FK", "Kocaelispor": "Kocaelispor",
    "Sakaryaspor": "Sakaryaspor", "Bayern Munich": "Bayern Münih", "Inter Milan": "Inter",
    "AC Milan": "Milan", "Atletico Madrid": "Atlético Madrid", "Sporting CP": "Sporting Lizbon"
}

def clean_team_name(name: str) -> str:
    return TEAM_NAME_FIXES.get(name, name)

TURKISH_DAYS = {"Mon": "Pzt", "Tue": "Sal", "Wed": "Çar", "Thu": "Per", "Fri": "Cum", "Sat": "Cmt", "Sun": "Paz"}
TURKISH_MONTHS = {"01": "Oca", "02": "Şub", "03": "Mar", "04": "Nis", "05": "May", "06": "Haz", "07": "Tem", "08": "Ağu", "09": "Eyl", "10": "Eki", "11": "Kas", "12": "Ara"}

def format_match_time(utc_date_str: str, status_state: str, status_detail: str) -> Dict[str, str]:
    if status_state == "in":
        return {"display": f"CANLI {status_detail}", "full_date": "Canlı Oynanıyor", "type": "LIVE"}

    try:
        dt = datetime.strptime(utc_date_str, "%Y-%m-%dT%H:%MZ") + timedelta(hours=3)
        now = datetime.now()
        diff_days = (dt.date() - now.date()).days
        time_str = dt.strftime("%H:%M")
        
        if diff_days == 0:
            day_prefix = "Bugün"
        elif diff_days == -1:
            day_prefix = "Dün"
        elif diff_days == 1:
            day_prefix = "Yarın"
        else:
            day_code = dt.strftime("%a")
            tr_day = TURKISH_DAYS.get(day_code, day_code)
            month_str = TURKISH_MONTHS.get(dt.strftime("%m"), "")
            day_prefix = f"{dt.day} {month_str} {tr_day}"

        if status_state == "post":
            return {"display": f"{day_prefix} MS", "full_date": f"{day_prefix} • {time_str}", "type": "FT"}
        else:
            return {"display": f"{day_prefix} {time_str}", "full_date": f"{day_prefix} • {time_str}", "type": "NS"}
    except Exception:
        return {"display": "MS" if status_state == "post" else "Yakında", "full_date": "Tarih Belirtilmedi", "type": "FT" if status_state == "post" else "NS"}

CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = 15

@app.get("/api/fixtures")
async def get_fixtures(league: str = Query("superlig", enum=list(LEAGUE_MAP.keys()))):
    current_time = time.time()
    cache_key = f"fixtures_{league}"

    if cache_key in CACHE:
        if current_time - CACHE[cache_key]["timestamp"] < CACHE_TTL:
            return CACHE[cache_key]["data"]

    league_info = LEAGUE_MAP.get(league)
    matches = []

    today = datetime.now()
    d_from = (today - timedelta(days=5)).strftime("%Y%m%d")
    d_to = (today + timedelta(days=5)).strftime("%Y%m%d")
    
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_info['slug']}/scoreboard?dates={d_from}-{d_to}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                events = data.get("events", [])

                for event in events:
                    competition = event.get("competitions", [{}])[0]
                    competitors = competition.get("competitors", [])
                    
                    home_team_obj = next((c for c in competitors if c.get("homeAway") == "home"), {})
                    away_team_obj = next((c for c in competitors if c.get("homeAway") == "away"), {})

                    home_name = clean_team_name(home_team_obj.get("team", {}).get("displayName", "Ev Sahibi"))
                    away_name = clean_team_name(away_team_obj.get("team", {}).get("displayName", "Deplasman"))
                    home_id = str(home_team_obj.get("id", ""))
                    away_id = str(away_team_obj.get("id", ""))
                    
                    home_score = home_team_obj.get("score")
                    away_score = away_team_obj.get("score")

                    status_state = event.get("status", {}).get("type", {}).get("state", "pre")
                    status_detail = event.get("status", {}).get("type", {}).get("shortDetail", "")
                    raw_date = event.get("date", "")

                    time_meta = format_match_time(raw_date, status_state, status_detail)
                    score_str = f"{home_score} - {away_score}" if time_meta["type"] != "NS" else "vs"
                    
                    week_num = event.get("season", {}).get("week", "")
                    round_str = f"{week_num}. Hafta" if week_num else ""

                    matches.append({
                        "id": event.get("id"),
                        "league": league_info["name"],
                        "leagueSlug": league_info["slug"],
                        "homeId": home_id,
                        "awayId": away_id,
                        "homeTeam": home_name,
                        "awayTeam": away_name,
                        "score": score_str,
                        "status": time_meta["type"],
                        "minute": time_meta["display"],
                        "time": time_meta["display"],
                        "fullDate": time_meta["full_date"],
                        "round": round_str
                    })
    except Exception as e:
        print(f"Fikstür çekme hatası: {e}")

    response_payload = {"league": league_info["name"], "matches": matches}
    CACHE[cache_key] = {"timestamp": current_time, "data": response_payload}
    return response_payload

@app.get("/api/match-detail")
async def get_match_detail(event_id: str, league_slug: str = "tur.1"):
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{league_slug}/summary?event={event_id}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                
                home_events = []
                away_events = []
                all_events = []

                header_comp = data.get("header", {}).get("competitions", [{}])[0]
                home_team_id = next((str(c.get("id")) for c in header_comp.get("competitors", []) if c.get("homeAway") == "home"), "")
                away_team_id = next((str(c.get("id")) for c in header_comp.get("competitors", []) if c.get("homeAway") == "away"), "")

                details = header_comp.get("details", [])
                
                if details:
                    for det in details:
                        clock = str(det.get("clock", {}).get("displayValue", ""))
                        team_id = str(det.get("team", {}).get("id", ""))
                        type_info = det.get("type", {})
                        type_text = type_info.get("text", "").lower()
                        
                        is_penalty = det.get("penaltyKick", False) or "penalty" in type_text
                        is_own_goal = det.get("ownGoal", False) or "own goal" in type_text or "kendi kalesine" in type_text
                        is_red = det.get("redCard", False) or "red" in type_text
                        is_yellow = det.get("yellowCard", False) or "yellow" in type_text
                        is_goal = det.get("scoringPlay", False) or "goal" in type_text

                        participants = det.get("participants", [])
                        scorer = ""
                        assist = ""
                        
                        for p in participants:
                            role = p.get("type", "")
                            p_name = p.get("athlete", {}).get("displayName", "")
                            if not scorer and (role in ["scorer", "athlete", ""] or not role):
                                scorer = p_name
                            elif role in ["assist", "assist2"]:
                                assist = p_name

                        if not scorer:
                            scorer = det.get("athlete", {}).get("displayName", "") or det.get("text", "Bilinmeyen Oyuncu")

                        icon = "⚽"
                        tag = "Gol"
                        important = True

                        if is_own_goal:
                            icon = "⚽"
                            tag = "(K.K.)"
                        elif is_penalty:
                            icon = "🎯"
                            tag = "(P)"
                        elif is_red:
                            icon = "🟥"
                            tag = "Kırmızı Kart"
                        elif is_yellow:
                            icon = "🟨"
                            tag = "Sarı Kart"
                            important = False
                        elif not is_goal:
                            continue

                        event_obj = {
                            "clock": clock,
                            "icon": icon,
                            "tag": tag,
                            "scorer": scorer,
                            "isOwnGoal": is_own_goal,
                            "isPenalty": is_penalty,
                            "assist": f"(Asist: {assist})" if (assist and not is_own_goal) else "",
                            "isImportant": important
                        }
                        all_events.append(event_obj)

                        if important:
                            if team_id == home_team_id:
                                home_events.append(event_obj)
                            else:
                                away_events.append(event_obj)

                # Yedek Kaynak
                if not home_events and not away_events:
                    for item in data.get("keyEvents", []):
                        clock = item.get("clock", {}).get("displayValue", "")
                        text = item.get("text", "")
                        ev_type = item.get("type", {}).get("text", "").lower()
                        team_id = str(item.get("team", {}).get("id", ""))
                        participants = item.get("participants", [])

                        if "goal" in ev_type:
                            scorer = participants[0].get("athlete", {}).get("displayName", text) if participants else text
                            assist = participants[1].get("athlete", {}).get("displayName", "") if len(participants) > 1 else ""
                            is_own_goal = "own goal" in ev_type
                            is_penalty = "penalty" in ev_type

                            event_obj = {
                                "clock": clock,
                                "icon": "🎯" if is_penalty else "⚽",
                                "tag": "(P)" if is_penalty else ("(K.K.)" if is_own_goal else "Gol"),
                                "scorer": scorer,
                                "isOwnGoal": is_own_goal,
                                "isPenalty": is_penalty,
                                "assist": f"(Asist: {assist})" if (assist and not is_own_goal) else "",
                                "isImportant": True
                            }
                            all_events.append(event_obj)
                            
                            if is_own_goal:
                                target_is_home = (team_id == away_team_id)
                            else:
                                target_is_home = (team_id == home_team_id)

                            if target_is_home:
                                home_events.append(event_obj)
                            else:
                                away_events.append(event_obj)

                        elif "red card" in ev_type:
                            player = participants[0].get("athlete", {}).get("displayName", text) if participants else text
                            event_obj = {
                                "clock": clock,
                                "icon": "🟥",
                                "tag": "Kırmızı Kart",
                                "scorer": player,
                                "isOwnGoal": False,
                                "isPenalty": False,
                                "assist": "",
                                "isImportant": True
                            }
                            all_events.append(event_obj)
                            if team_id == home_team_id:
                                home_events.append(event_obj)
                            else:
                                away_events.append(event_obj)

                # Stadyum & Hakem
                game_info = data.get("gameInfo", {})
                venue = game_info.get("venue", {}).get("fullName", "Belirtilmedi")
                city = game_info.get("venue", {}).get("address", {}).get("city", "")
                venue_str = f"{venue} ({city})" if city else venue
                
                officials = game_info.get("officials", [])
                referee = officials[0].get("displayName", "Belirtilmedi") if officials else "Belirtilmedi"

                # İstatistikler
                stats = []
                boxscore = data.get("boxscore", {})
                team_stats = boxscore.get("teams", [])
                if len(team_stats) == 2:
                    home_stats = {s["name"]: s.get("displayValue") for s in team_stats[0].get("statistics", [])}
                    away_stats = {s["name"]: s.get("displayValue") for s in team_stats[1].get("statistics", [])}
                    
                    stat_keys = [
                        ("possessionPct", "Topla Oynama (%)"),
                        ("totalShots", "Toplam Şut"),
                        ("shotsOnTarget", "İsabetli Şut"),
                        ("wonCorners", "Korner"),
                        ("foulsCommitted", "Faul")
                    ]
                    
                    for key, title in stat_keys:
                        if key in home_stats or key in away_stats:
                            stats.append({
                                "title": title,
                                "home": home_stats.get(key, "-"),
                                "away": away_stats.get(key, "-")
                            })

                # Kadrolar
                lineups = {"home": [], "away": [], "homeFormation": "", "awayFormation": "", "isOfficial": False}
                rosters = data.get("rosters", [])
                if rosters and len(rosters) == 2:
                    lineups["isOfficial"] = True
                    lineups["homeFormation"] = rosters[0].get("formation", "")
                    for p in rosters[0].get("roster", [])[:11]:
                        athlete = p.get("athlete", {})
                        lineups["home"].append({
                            "name": athlete.get("displayName", ""),
                            "jersey": p.get("jersey", athlete.get("jersey", "")),
                            "pos": p.get("position", {}).get("abbreviation", athlete.get("position", {}).get("abbreviation", ""))
                        })
                    lineups["awayFormation"] = rosters[1].get("formation", "")
                    for p in rosters[1].get("roster", [])[:11]:
                        athlete = p.get("athlete", {})
                        lineups["away"].append({
                            "name": athlete.get("displayName", ""),
                            "jersey": p.get("jersey", athlete.get("jersey", "")),
                            "pos": p.get("position", {}).get("abbreviation", athlete.get("position", {}).get("abbreviation", ""))
                        })

                return {
                    "venue": venue_str,
                    "referee": referee,
                    "homeEvents": home_events,
                    "awayEvents": away_events,
                    "events": all_events,
                    "stats": stats,
                    "lineups": lineups
                }
    except Exception as e:
        print(f"Detay çekme hatası: {e}")

    return {"venue": "Belirtilmedi", "referee": "Belirtilmedi", "homeEvents": [], "awayEvents": [], "events": [], "stats": [], "lineups": {"home":[], "away":[], "isOfficial":False}}

app.mount("/", StaticFiles(directory="static", html=True), name="static")

def open_browser():
    time.sleep(1.2)
    webbrowser.open("http://localhost:8000")

if __name__ == "__main__":
    threading.Thread(target=open_browser).start()
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)