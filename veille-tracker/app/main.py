from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import articles, sources, blacklist, stats, relevance
from scheduler import start_scheduler
from database import SessionLocal
from models import Article


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Reset any articles stuck in 'processing' from a previous crash
    db = SessionLocal()
    try:
        stuck = db.query(Article).filter(Article.status == "processing").all()
        for a in stuck:
            a.status = "collecte"
        if stuck:
            db.commit()
    finally:
        db.close()
    start_scheduler()
    yield


app = FastAPI(
    title="Veille Techno API",
    description="AI/LLM technology watch — collect → enrich → score → publish",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(articles.router)
app.include_router(sources.router)
app.include_router(blacklist.router)
app.include_router(stats.router)
app.include_router(relevance.router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
