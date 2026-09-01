from fastapi import HTTPException

from app.services.espn import ESPNServiceError


def upstream_error(exc: ESPNServiceError) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))
