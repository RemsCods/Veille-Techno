"""
One-time migration: normalize all existing tags in the DB.

Run with:
    docker exec veille-tracker-app-1 python scripts/normalize_existing_tags.py

What it does:
1. For every tag: apply normalize_tag()
2. If normalized == current name → nothing to do
3. If normalized == None → delete tag (and remove from articles_tags)
4. If normalized name already exists as a DIFFERENT tag → merge:
   - Re-point all articles_tags rows to the surviving tag
   - Delete the duplicate tag row
5. If normalized is a new name → rename the tag in-place
"""

import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pymysql
from tag_normalizer import normalize_tag

# Read DB config from environment (same as the app)
DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "veille")
DB_USER = os.getenv("DB_USER", "veille")
DB_PASS = os.getenv("DB_PASSWORD", "changeme")

MAX_RETRIES = 4


def get_conn():
    return pymysql.connect(
        host=DB_HOST, port=DB_PORT,
        user=DB_USER, password=DB_PASS, database=DB_NAME,
        autocommit=True,   # each statement is its own transaction → no lock conflicts
        charset="utf8mb4",
    )


def exec_retry(conn, sql: str, params: tuple = ()) -> None:
    for attempt in range(MAX_RETRIES):
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
            return
        except pymysql.err.OperationalError as e:
            if attempt < MAX_RETRIES - 1 and e.args[0] in (1020, 1213):  # record changed / deadlock
                time.sleep(0.3 * (attempt + 1))
                continue
            raise


def main():
    conn = get_conn()
    renamed = merged = deleted = skipped = errors = 0

    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM tags ORDER BY id")
        tags = cur.fetchall()

    print(f"Found {len(tags)} existing tags")

    for tag_id, tag_name in tags:
        try:
            normalized = normalize_tag(tag_name)

            # ── Case 1: already clean ──────────────────────────────────────
            if normalized == tag_name:
                skipped += 1
                continue

            # ── Case 2: reject → delete ────────────────────────────────────
            if normalized is None:
                print(f"  DELETE  [{tag_id}] '{tag_name}' → rejected by normalizer")
                exec_retry(conn, "DELETE FROM articles_tags WHERE tag_id = %s", (tag_id,))
                exec_retry(conn, "DELETE FROM tags WHERE id = %s", (tag_id,))
                deleted += 1
                continue

            # ── Check if target name already exists ────────────────────────
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM tags WHERE name = %s LIMIT 1", (normalized,))
                row = cur.fetchone()
            existing_id = row[0] if row else None

            if existing_id and existing_id != tag_id:
                # ── Case 3: merge into existing tag ───────────────────────
                print(f"  MERGE   [{tag_id}] '{tag_name}' → [{existing_id}] '{normalized}'")

                # Re-point rows, skip duplicates (IGNORE handles duplicate PKs)
                exec_retry(conn,
                    "UPDATE IGNORE articles_tags SET tag_id = %s WHERE tag_id = %s",
                    (existing_id, tag_id))

                # Remove any leftover rows pointing to old tag
                exec_retry(conn,
                    "DELETE FROM articles_tags WHERE tag_id = %s", (tag_id,))
                exec_retry(conn,
                    "DELETE FROM tags WHERE id = %s", (tag_id,))
                merged += 1

            else:
                # ── Case 4: rename in-place ────────────────────────────────
                print(f"  RENAME  [{tag_id}] '{tag_name}' → '{normalized}'")
                exec_retry(conn,
                    "UPDATE tags SET name = %s WHERE id = %s", (normalized, tag_id))
                renamed += 1

        except Exception as e:
            print(f"  SKIP    [{tag_id}] '{tag_name}' — error: {e}")
            errors += 1

    conn.close()
    print(f"\nDone: {skipped} unchanged, {renamed} renamed, {merged} merged, {deleted} deleted, {errors} errors")


if __name__ == "__main__":
    main()
