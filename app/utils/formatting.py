from datetime import date, datetime, timezone
from typing import Dict, Optional
from zoneinfo import ZoneInfo


ISTANBUL = ZoneInfo("Europe/Istanbul")
TURKISH_DAYS = ("Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz")
TURKISH_MONTHS = ("", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")


def parse_espn_datetime(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(ISTANBUL)
    except (TypeError, ValueError):
        return None


def parse_selected_date(value: Optional[str]) -> date:
    if not value:
        return datetime.now(ISTANBUL).date()
    return date.fromisoformat(value)


def format_match_time(raw_date: str, status_state: str, status_detail: str, today: Optional[date] = None) -> Dict[str, str]:
    if status_state == "in":
        return {"display": f"CANLI {status_detail or ''}".strip(), "full_date": "Canlı Oynanıyor", "type": "LIVE"}

    match_dt = parse_espn_datetime(raw_date)
    if not match_dt:
        finished = status_state == "post"
        return {"display": "MS" if finished else "Yakında", "full_date": "Tarih Belirtilmedi", "type": "FT" if finished else "NS"}

    reference = today or datetime.now(ISTANBUL).date()
    difference = (match_dt.date() - reference).days
    if difference == 0:
        day_prefix = "Bugün"
    elif difference == -1:
        day_prefix = "Dün"
    elif difference == 1:
        day_prefix = "Yarın"
    else:
        day_prefix = f"{match_dt.day} {TURKISH_MONTHS[match_dt.month]} {TURKISH_DAYS[match_dt.weekday()]}"

    time_text = match_dt.strftime("%H:%M")
    if status_state == "post":
        return {"display": f"{day_prefix} MS", "full_date": f"{day_prefix} • {time_text}", "type": "FT"}
    return {"display": f"{day_prefix} {time_text}", "full_date": f"{day_prefix} • {time_text}", "type": "NS"}
