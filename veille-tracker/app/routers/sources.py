from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from models import Source
from schemas import SourceCreate, SourcePatch, SourceOut

router = APIRouter(prefix="/sources", tags=["sources"])


@router.post("/collect-all")
def collect_all(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    sources = db.query(Source).filter(Source.active == True).all()
    ids = [s.id for s in sources]

    def _run_all():
        from scheduler import run_source_now
        for sid in ids:
            run_source_now(sid)

    background_tasks.add_task(_run_all)
    return {"status": "collection triggered", "sources_count": len(ids)}


@router.get("", response_model=list[SourceOut])
def list_sources(db: Session = Depends(get_db)):
    return db.query(Source).all()


@router.post("", response_model=SourceOut, status_code=201)
def create_source(payload: SourceCreate, db: Session = Depends(get_db)):
    source = Source(**payload.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/{source_id}", response_model=SourceOut)
def update_source(source_id: int, payload: SourcePatch, db: Session = Depends(get_db)):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=204)
def delete_source(source_id: int, hard: bool = False, db: Session = Depends(get_db)):
    """
    hard=False (default): soft delete — sets active=False, keeps all articles.
    hard=True: cascade delete — removes articles, embeddings, fact_checks,
               corroborations, collect_logs, then the source itself.
    """
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")

    if hard:
        sid = source_id
        # Delete all dependent data in the right FK order
        db.execute(text("""
            DELETE FROM corroborations
            WHERE article_id IN (SELECT id FROM articles WHERE source_id = :sid)
               OR similar_article_id IN (SELECT id FROM articles WHERE source_id = :sid)
        """), {"sid": sid})
        db.execute(text("""
            DELETE FROM fact_checks
            WHERE article_id IN (SELECT id FROM articles WHERE source_id = :sid)
        """), {"sid": sid})
        db.execute(text("""
            DELETE FROM embeddings
            WHERE article_id IN (SELECT id FROM articles WHERE source_id = :sid)
        """), {"sid": sid})
        db.execute(text("""
            DELETE FROM articles_tags
            WHERE article_id IN (SELECT id FROM articles WHERE source_id = :sid)
        """), {"sid": sid})
        db.execute(text("DELETE FROM articles      WHERE source_id = :sid"), {"sid": sid})
        db.execute(text("DELETE FROM collect_logs  WHERE source_id = :sid"), {"sid": sid})
        db.delete(source)
    else:
        source.active = False

    db.commit()


@router.get("/{source_id}/collect")
def trigger_collect(source_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    source = db.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    from scheduler import run_source_now
    background_tasks.add_task(run_source_now, source_id)
    return {"status": "collection triggered", "source_id": source_id}
