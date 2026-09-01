from fastapi import APIRouter, HTTPException, Query

from app.config import LEAGUE_MAP
from app.routes.common import upstream_error
from app.services.espn import ESPNServiceError, espn_service


router = APIRouter(prefix="/api", tags=["standings"])


@router.get("/standings")
async def get_standings(league: str = Query("superlig")):
    if league not in LEAGUE_MAP:
        raise HTTPException(status_code=422, detail="Desteklenmeyen lig.")
    try:
        return await espn_service.standings(LEAGUE_MAP[league])
    except ESPNServiceError as exc:
        raise upstream_error(exc) from exc
