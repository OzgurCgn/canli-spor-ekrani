from fastapi import APIRouter, HTTPException, Query

from app.config import LEAGUE_MAP
from app.routes.common import upstream_error
from app.services.espn import ESPNServiceError, espn_service


router = APIRouter(prefix="/api", tags=["matches"])
ALLOWED_SLUGS = {league["slug"] for league in LEAGUE_MAP.values()}


@router.get("/match-detail")
async def get_match_detail(event_id: str = Query(..., min_length=1), league_slug: str = "tur.1"):
    if league_slug not in ALLOWED_SLUGS:
        raise HTTPException(status_code=422, detail="Desteklenmeyen lig.")
    try:
        return await espn_service.match_detail(event_id, league_slug)
    except ESPNServiceError as exc:
        raise upstream_error(exc) from exc
