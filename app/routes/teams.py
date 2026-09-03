from fastapi import APIRouter, HTTPException, Query

from app.config import LEAGUE_MAP
from app.routes.common import upstream_error
from app.services.espn import ESPNServiceError, espn_service


router = APIRouter(prefix="/api", tags=["teams"])
LEAGUES_BY_SLUG = {league["slug"]: league for league in LEAGUE_MAP.values()}


@router.get("/team-detail")
async def get_team_detail(
    team_id: str = Query(..., min_length=1, max_length=20),
    league_slug: str = Query(..., min_length=1),
):
    if not team_id.isdigit():
        raise HTTPException(status_code=422, detail="Geçersiz takım kimliği.")
    league = LEAGUES_BY_SLUG.get(league_slug)
    if not league:
        raise HTTPException(status_code=422, detail="Desteklenmeyen lig.")
    try:
        return await espn_service.team_detail(team_id, league)
    except ESPNServiceError as exc:
        raise upstream_error(exc) from exc
