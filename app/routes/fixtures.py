from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.config import LEAGUE_MAP
from app.routes.common import upstream_error
from app.services.espn import ESPNServiceError, espn_service
from app.utils.formatting import parse_selected_date


router = APIRouter(prefix="/api", tags=["fixtures"])


@router.get("/fixtures")
async def get_fixtures(
    league: str = Query("all"),
    match_date: Optional[str] = Query(None, alias="date"),
):
    if league != "all" and league not in LEAGUE_MAP:
        raise HTTPException(status_code=422, detail="Desteklenmeyen lig.")
    try:
        selected: date = parse_selected_date(match_date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Tarih YYYY-MM-DD biçiminde olmalı.") from exc
    try:
        if league == "all":
            return await espn_service.all_fixtures(list(LEAGUE_MAP.values()), selected.isoformat())
        return await espn_service.fixtures(LEAGUE_MAP[league], selected.isoformat())
    except ESPNServiceError as exc:
        raise upstream_error(exc) from exc
