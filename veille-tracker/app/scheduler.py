import threading
import time as _time
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from database import SessionLocal
from models import Source
from config import settings

_scheduler = BackgroundScheduler()
_pipeline_stop = threading.Event()


def _collect_source(source_id: int) -> None:
    db = SessionLocal()
    try:
        source = db.get(Source, source_id)
        if not source or not source.active:
            return
        if "arxiv" in source.feed_url:
            from collectors.arxiv import collect_arxiv
            collect_arxiv(source, db)
        elif "hn.algolia" in source.feed_url:
            from collectors.hackernews import collect_hackernews
            collect_hackernews(source, db)
        else:
            from collectors.rss import collect_rss
            collect_rss(source, db)
    finally:
        db.close()


def _collect_all_rss() -> None:
    db = SessionLocal()
    try:
        ids = [s.id for s in db.query(Source).filter(Source.active == True, Source.type == "rss").all()]
    finally:
        db.close()
    for sid in ids:
        _collect_source(sid)


def _collect_all_api() -> None:
    db = SessionLocal()
    try:
        ids = [s.id for s in db.query(Source).filter(Source.active == True, Source.type == "api").all()]
    finally:
        db.close()
    for sid in ids:
        _collect_source(sid)


_ENRICHER_WORKERS = 3   # enricher threads  → 3 concurrent chat requests to Ollama
_ENRICHER_BATCH   = 25  # articles per enricher per round
_SCORER_BATCH     = 25  # articles per scorer per round


def _continuous_pipeline() -> None:
    from workers.enricher import run_enricher
    from workers.scorer import run_scorer
    from workers.embed_missing import run_embed_missing
    from workers.cluster import run_cluster

    pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="pipeline")

    while not _pipeline_stop.is_set():
        try:
            f_e1 = pool.submit(run_enricher,      _ENRICHER_BATCH)
            f_e2 = pool.submit(run_enricher,      _ENRICHER_BATCH)
            f_e3 = pool.submit(run_enricher,      _ENRICHER_BATCH)
            f_s1 = pool.submit(run_scorer,        _SCORER_BATCH)
            f_s2 = pool.submit(run_scorer,        _SCORER_BATCH)
            f_s3 = pool.submit(run_scorer,        _SCORER_BATCH)
            f_em = pool.submit(run_embed_missing,  30)
            f_cl = pool.submit(run_cluster,       100)  # cluster after scoring

            futures_wait([f_e1, f_e2, f_e3, f_s1, f_s2, f_s3, f_em, f_cl])
            n_enriched  = f_e1.result() + f_e2.result() + f_e3.result()
            n_scored    = f_s1.result() + f_s2.result() + f_s3.result()
            n_embedded  = f_em.result()
            n_clustered = f_cl.result()

            if n_enriched == 0 and n_scored == 0 and n_embedded == 0 and n_clustered == 0:
                _pipeline_stop.wait(timeout=15)
        except Exception:
            _pipeline_stop.wait(timeout=10)


def run_source_now(source_id: int) -> None:
    _collect_source(source_id)


def start_scheduler() -> None:
    rss_parts = settings.rss_collect_interval.split()
    arxiv_parts = settings.arxiv_collect_interval.split()

    _scheduler.add_job(
        _collect_all_rss,
        CronTrigger(
            minute=rss_parts[0], hour=rss_parts[1],
            day=rss_parts[2], month=rss_parts[3], day_of_week=rss_parts[4],
        ),
        id="collect_rss",
        replace_existing=True,
    )
    _scheduler.add_job(
        _collect_all_api,
        CronTrigger(
            minute=arxiv_parts[0], hour=arxiv_parts[1],
            day=arxiv_parts[2], month=arxiv_parts[3], day_of_week=arxiv_parts[4],
        ),
        id="collect_api",
        replace_existing=True,
    )

    if not _scheduler.running:
        _scheduler.start()

    t = threading.Thread(target=_continuous_pipeline, daemon=True, name="pipeline-worker")
    t.start()
