from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routes.fixtures import router as fixtures_router
from app.routes.matches import router as matches_router
from app.routes.standings import router as standings_router
from app.routes.teams import router as teams_router
from app.services.espn import espn_service


BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await espn_service.close()


app = FastAPI(
    title="Canlı Spor Ekranı API",
    version="3.2.0",
    description="ESPN verilerini kullanan canlı futbol skoru ve puan durumu API'si.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(fixtures_router)
app.include_router(matches_router)
app.include_router(standings_router)
app.include_router(teams_router)


@app.head("/health", include_in_schema=False)
@app.get("/health", include_in_schema=False)
@app.get("/api/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": "3.2.0"}


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
