from typing import Dict, List
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from app.config import LEAGUE_MAP
from app.services.push import push_service


router = APIRouter(prefix="/api/push", tags=["push"])
VALID_LEAGUE_SLUGS = {league["slug"] for league in LEAGUE_MAP.values()}


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=512)
    auth: str = Field(min_length=8, max_length=256)


class BrowserSubscription(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)
    keys: SubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def secure_endpoint(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Push endpoint HTTPS olmalı.")
        return value


class FollowedMatch(BaseModel):
    id: str = Field(pattern=r"^\d+$", max_length=32)
    leagueSlug: str = Field(max_length=64)
    matchDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    startTime: str = Field(default="", max_length=64)
    homeTeam: str = Field(max_length=120)
    awayTeam: str = Field(max_length=120)

    @field_validator("leagueSlug")
    @classmethod
    def supported_league(cls, value: str) -> str:
        if value not in VALID_LEAGUE_SLUGS:
            raise ValueError("Desteklenmeyen lig.")
        return value


class PushPreferences(BaseModel):
    subscription: BrowserSubscription
    allMatches: bool = False
    followedMatches: List[FollowedMatch] = Field(default_factory=list, max_length=100)


class SubscriptionRemoval(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)


def _check_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    parsed = urlparse(origin)
    if parsed.netloc != request.headers.get("host"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Geçersiz istek kaynağı.")


@router.get("/public-key")
async def public_key() -> Dict[str, object]:
    return {"enabled": push_service.ready, "publicKey": push_service.public_key if push_service.ready else ""}


@router.post("/preferences", status_code=status.HTTP_204_NO_CONTENT)
async def save_preferences(preferences: PushPreferences, request: Request) -> None:
    _check_same_origin(request)
    try:
        await push_service.save_preferences(preferences.model_dump())
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@router.delete("/subscription", status_code=status.HTTP_204_NO_CONTENT)
async def remove_subscription(removal: SubscriptionRemoval, request: Request) -> None:
    _check_same_origin(request)
    await push_service.remove_subscription(removal.endpoint)
