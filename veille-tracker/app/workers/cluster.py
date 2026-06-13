"""
Semantic cluster worker.

After an article is scored its corroborations are already stored.
This worker groups corroborated articles into clusters so the feed
can show one representative per cluster instead of N near-identical entries.

Cluster rules:
- All articles involved in a corroboration pair form a cluster.
- The canonical article = the one with the highest confidence_score.
- Non-canonical articles: canonical_id = canonical.id
- Canonical article: canonical_id = NULL, cluster_size = N

The worker is idempotent: re-running on an already-clustered article is a no-op
because it rechecks and may only update if a better canonical appeared.
"""

from sqlalchemy import text
from database import SessionLocal


def run_cluster(batch: int = 100) -> int:
    """
    Process up to `batch` unclustered articles that have corroborations.
    Returns the number of articles whose canonical_id was (re)assigned.
    """
    db = SessionLocal()
    updated = 0
    try:
        # Find scored articles that appear in any corroboration row (either side)
        # and haven't been assigned to a cluster yet (canonical_id IS NULL and cluster_size = 1)
        # We only reprocess articles with cluster_size = 1 to avoid re-clustering every cycle.
        rows = db.execute(text("""
            SELECT DISTINCT a.id
            FROM articles a
            JOIN corroborations c ON (c.article_id = a.id OR c.similar_article_id = a.id)
            WHERE a.status = 'score'
              AND a.cluster_size = 1
            LIMIT :batch
        """), {"batch": batch}).fetchall()

        article_ids = [r[0] for r in rows]

        for article_id in article_ids:
            did_update = _cluster_article(article_id, db)
            if did_update:
                updated += 1

    except Exception:
        db.rollback()
    finally:
        db.close()

    return updated


def _cluster_article(article_id: int, db) -> bool:
    """
    Find all articles in the same corroboration cluster as `article_id`,
    elect the canonical (highest confidence_score), and update the DB.

    Returns True if any change was made.
    """
    # ── Collect all IDs in this cluster (transitive corroborations, depth 1) ──
    rows = db.execute(text("""
        SELECT article_id, similar_article_id
        FROM corroborations
        WHERE article_id = :id OR similar_article_id = :id
    """), {"id": article_id}).fetchall()

    if not rows:
        return False  # no corroborations yet

    cluster_ids: set[int] = {article_id}
    for r in rows:
        cluster_ids.add(r[0])
        cluster_ids.add(r[1])

    # ── Expand one more level: follow corroborations of cluster members ─────
    # (handles A→B, B→C chains so A and C end up in the same cluster)
    for mid in list(cluster_ids):
        extra = db.execute(text("""
            SELECT article_id, similar_article_id
            FROM corroborations
            WHERE article_id = :id OR similar_article_id = :id
        """), {"id": mid}).fetchall()
        for r in extra:
            cluster_ids.add(r[0])
            cluster_ids.add(r[1])

    cluster_size = len(cluster_ids)
    if cluster_size < 2:
        return False  # should not happen, but be safe

    # ── Elect canonical: highest confidence_score wins ───────────────────────
    id_list = ", ".join(str(i) for i in cluster_ids)
    best = db.execute(text(f"""
        SELECT id, confidence_score
        FROM articles
        WHERE id IN ({id_list})
        ORDER BY confidence_score DESC, id ASC
        LIMIT 1
    """)).fetchone()

    if not best:
        return False

    canonical_id = best[0]
    non_canonical = cluster_ids - {canonical_id}

    # ── Skip if the DB already reflects this clustering ──────────────────────
    # Without this, an already-clustered article is "re-clustered" (same values)
    # on every pipeline cycle and still reported as work done — the pipeline then
    # never registers as idle. Comparing to the current state keeps the worker
    # idempotent in its RETURN value: a fully-clustered corpus reports 0 work
    # (so the idle re-review can kick in), while a changed canonical or a new
    # cluster member still triggers a real update below.
    current = db.execute(text(f"""
        SELECT id, canonical_id, cluster_size
        FROM articles
        WHERE id IN ({id_list})
    """)).fetchall()
    cur = {r[0]: (r[1], r[2]) for r in current}
    already_clustered = (
        cur.get(canonical_id) == (None, cluster_size)
        and all(cur.get(i) == (canonical_id, 1) for i in non_canonical)
    )
    if already_clustered:
        return False

    # ── Update: canonical gets cluster_size, others get canonical_id ─────────
    db.execute(text(f"""
        UPDATE articles
        SET canonical_id = NULL, cluster_size = :size
        WHERE id = :cid
    """), {"size": cluster_size, "cid": canonical_id})

    if non_canonical:
        nc_list = ", ".join(str(i) for i in non_canonical)
        db.execute(text(f"""
            UPDATE articles
            SET canonical_id = :cid, cluster_size = 1
            WHERE id IN ({nc_list})
        """), {"cid": canonical_id})

    db.commit()
    return True
