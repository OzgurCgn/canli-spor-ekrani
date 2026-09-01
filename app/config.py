from typing import Dict


LEAGUE_MAP: Dict[str, Dict[str, str]] = {
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


def clean_team_name(name: str) -> str:
    return TEAM_NAME_FIXES.get(name, name)
