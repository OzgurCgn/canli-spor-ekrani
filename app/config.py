from typing import Dict


LEAGUE_MAP: Dict[str, Dict[str, str]] = {
    "superlig": {"slug": "tur.1", "name": "Trendyol Süper Lig"},
    "premier": {"slug": "eng.1", "name": "Premier League"},
    "championship": {"slug": "eng.2", "name": "EFL Championship"},
    "laliga": {"slug": "esp.1", "name": "La Liga"},
    "laliga2": {"slug": "esp.2", "name": "La Liga 2"},
    "seriea": {"slug": "ita.1", "name": "Serie A"},
    "serieb": {"slug": "ita.2", "name": "Serie B"},
    "bundesliga": {"slug": "ger.1", "name": "Bundesliga"},
    "bundesliga2": {"slug": "ger.2", "name": "2. Bundesliga"},
    "ligue1": {"slug": "fra.1", "name": "Ligue 1"},
    "ligue2": {"slug": "fra.2", "name": "Ligue 2"},
    "belgium": {"slug": "bel.1", "name": "Belçika Pro Ligi"},
    "eredivisie": {"slug": "ned.1", "name": "Eredivisie"},
    "ligaportugal": {"slug": "por.1", "name": "Liga Portugal"},
    "saudi": {"slug": "ksa.1", "name": "Suudi Pro Ligi"},
    "ucl": {"slug": "uefa.champions", "name": "Şampiyonlar Ligi"},
    "uel": {"slug": "uefa.europa", "name": "Avrupa Ligi"},
    "uecl": {"slug": "uefa.europa.conf", "name": "Konferans Ligi"},
}

TEAM_NAME_FIXES = {
    "Besiktas": "Beşiktaş",
    "Fenerbahce": "Fenerbahçe",
    "Istanbul Basaksehir": "Başakşehir",
    "Basaksehir": "Başakşehir",
    "Kasimpasa": "Kasımpaşa",
    "Caykur Rizespor": "Çaykur Rizespor",
    "Rizespor": "Çaykur Rizespor",
    "Goztepe": "Göztepe",
    "Eyupspor": "Eyüpspor",
    "Genclerbirligi": "Gençlerbirliği",
    "Erzurum BB": "Erzurumspor FK",
    "Corum FK": "Çorum FK",
    "Bayern Munich": "Bayern Münih",
    "Inter Milan": "Inter",
    "AC Milan": "Milan",
    "Atletico Madrid": "Atlético Madrid",
    "Sporting CP": "Sporting Lizbon",
}

TEAM_LOGO_OVERRIDES = {
    "132335": "/images/team-logos/amed-sfk.png",
    "21446": "/images/team-logos/al-faisaly.png",
}


def clean_team_name(name: str) -> str:
    return TEAM_NAME_FIXES.get(name, name)
