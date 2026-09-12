"""Relay backend — FastAPI app hosting the project-knowledge query endpoint."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# backend/.env wins over the repo-root .env, whose DATABASE_URL is Prisma's sqlite one.
BACKEND_ENV = Path(__file__).parent / ".env"
ROOT_ENV = Path(__file__).parent.parent / ".env"
load_dotenv(BACKEND_ENV)
load_dotenv(ROOT_ENV)

from api.analytics import router as analytics_router  # noqa: E402
from api.llm import build_providers  # noqa: E402
from api.project import router as project_router  # noqa: E402
from api.query import load_embedding_model, router as query_router  # noqa: E402
from api.scratchpad import router as scratchpad_router  # noqa: E402
from api.sessions import router as sessions_router  # noqa: E402
from api.sync import SYNC_INTERVAL_MINUTES, router as sync_router, sync_all  # noqa: E402

logger = logging.getLogger(__name__)

# Set SYNC_ENABLED=false to turn the background Jira/GitHub poller off
# (e.g. a throwaway local instance pointed at the production database).
SYNC_ENABLED = os.environ.get("SYNC_ENABLED", "true").lower() != "false"


async def _sync_loop(app: FastAPI):
    """Keeps zone1/zone2 in step with live Jira and GitHub. First pass runs
    shortly after startup; afterwards every SYNC_INTERVAL_MINUTES. Failures
    are logged and retried next cycle — a sync error must never take the API
    down."""
    await asyncio.sleep(20)  # let startup finish before hitting the APIs
    while True:
        try:
            results = await sync_all(app.state.pool, app.state.embedding_model)
            logger.info("live sync pass: %s", results)
        except Exception:
            logger.exception("live sync pass failed")
        await asyncio.sleep(SYNC_INTERVAL_MINUTES * 60)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set (see backend/.env.example)")
    if not url.startswith(("postgresql://", "postgres://")):
        raise RuntimeError(
            "DATABASE_URL must point at the Relay postgres instance, got: "
            + url.split(":", 1)[0]
        )
    return url


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Model, LLM client and connection pool are all built once, at startup.
    app.state.embedding_model = load_embedding_model()
    app.state.llm_providers = build_providers()
    # ivfflat.probes (recall for the vector search in api/query.py) is set on
    # the pm_user role in database/init.sql, not here — a per-connection SET
    # via asyncpg's pool init hook proved unreliable: nothing guarantees which
    # pooled connection serves a given request once the pool grows past one.
    app.state.pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=5)
    sync_task = None
    if SYNC_ENABLED:
        sync_task = asyncio.create_task(_sync_loop(app))
    try:
        yield
    finally:
        if sync_task:
            sync_task.cancel()
        await app.state.pool.close()


app = FastAPI(title="Relay Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(query_router)
app.include_router(sessions_router)
app.include_router(scratchpad_router)
app.include_router(analytics_router)
app.include_router(project_router)
app.include_router(sync_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
