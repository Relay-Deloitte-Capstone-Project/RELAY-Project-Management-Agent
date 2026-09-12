"""Relay backend — FastAPI app hosting the project-knowledge query endpoint."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, Request
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
    await app.state.model_ready.wait()  # sync re-embeds changed chunks
    await asyncio.sleep(20)  # let startup finish before hitting the APIs
    while True:
        try:
            results = await sync_all(app.state.pool, app.state.embedding_model)
            logger.info("live sync pass: %s", results)
        except Exception:
            logger.exception("live sync pass failed")
        await asyncio.sleep(SYNC_INTERVAL_MINUTES * 60)


async def _load_model(app: FastAPI):
    """Load the embedding model in the background so the server accepts
    connections (and answers /health) within seconds of a cold start. Routes
    that embed wait on app.state.model_ready; everything else is unaffected."""
    try:
        app.state.embedding_model = await asyncio.to_thread(load_embedding_model)
    except Exception:
        logger.exception("embedding model failed to load")
    finally:
        app.state.model_ready.set()


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
    # LLM client and connection pool are built once, at startup. The embedding
    # model (~100MB) loads in the background — on Render's free tier this is
    # the difference between a ~5s and a multi-minute cold start.
    app.state.embedding_model = None
    app.state.model_ready = asyncio.Event()
    app.state.llm_providers = build_providers()
    # ivfflat.probes (recall for the vector search in api/query.py) is set on
    # the pm_user role in database/init.sql, not here — a per-connection SET
    # via asyncpg's pool init hook proved unreliable: nothing guarantees which
    # pooled connection serves a given request once the pool grows past one.
    app.state.pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=5)
    model_task = asyncio.create_task(_load_model(app))
    sync_task = None
    if SYNC_ENABLED:
        sync_task = asyncio.create_task(_sync_loop(app))
    try:
        yield
    finally:
        model_task.cancel()
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
async def health(request: Request):
    # Kept deliberately cheap — this is what the keep-alive pinger hits.
    return {"status": "ok", "model_ready": request.app.state.model_ready.is_set()}
