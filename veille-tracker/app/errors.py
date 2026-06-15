"""Central error classification + DB-retry helpers for the pipeline.

Two responsibilities, kept dependency-free (no imports from pipeline_stats /
workers) so it can be imported anywhere:

  * classify_error(exc, context) — turns a raw exception into a stable
    {category, severity, summary, detail} dict. The monitor groups by category
    and colours by severity instead of dumping raw tracebacks.

  * with_db_retry(fn, ...) — runs a self-contained DB write and retries on
    transient MySQL lock errors (deadlock / lock-wait timeout). Same idea as the
    one-off retry in scripts/normalize_existing_tags.py, but adapted to a
    SQLAlchemy session (unwraps the wrapped pymysql error to read the code).
"""

import time

# ── Severity scale (low → high) ───────────────────────────────────────────────
TRANSIENT = "transient"   # auto-recovered (e.g. deadlock resolved on retry)
WARNING   = "warning"     # degraded but the pipeline keeps going (fallback / per-article retry)
ERROR     = "error"       # the article failed this stage; retried up to MAX_PIPELINE_ATTEMPTS
CRITICAL  = "critical"    # repeated failure — article parked

# MySQL error codes we treat as retryable lock contention
_DEADLOCK_CODES     = (1213, 1020)   # deadlock found / record changed
_LOCK_TIMEOUT_CODES = (1205,)        # lock wait timeout exceeded
_CONN_CODES         = (2002, 2003, 2006, 2013, 2055)  # can't connect / gone away / lost


def _mysql_code(exc) -> int | None:
    """Return the MySQL error code if exc is a DB error, else None.

    SQLAlchemy wraps the driver error: the pymysql exception lives on `.orig`,
    and its `.args[0]` is the integer MySQL code. We only read args[0] when the
    exception really is DB-related, so a non-DB exception that happens to carry
    an int first arg (e.g. an OSError errno) is never mistaken for a MySQL code.
    """
    orig = getattr(exc, "orig", None)
    candidate = orig if orig is not None else exc
    cand_mod = type(candidate).__module__ or ""
    exc_mod = type(exc).__module__ or ""
    if "pymysql" not in cand_mod and "MySQLdb" not in cand_mod and "sqlalchemy" not in exc_mod:
        return None
    args = getattr(candidate, "args", ())
    if args and isinstance(args[0], int):
        return args[0]
    return None


def is_retryable_db_error(exc, codes=_DEADLOCK_CODES + _LOCK_TIMEOUT_CODES) -> bool:
    return _mysql_code(exc) in codes


def classify_error(exc, context: str = "") -> dict:
    """Classify an exception into {category, severity, summary, detail}.

    `summary` is a short human-readable line (shown in the monitor); `detail`
    keeps the raw `Type: message` (truncated to 500) for the expandable view.
    `context` is an optional prefix label (e.g. "LLM fallback", "straggler").
    """
    name = type(exc).__name__
    exc_mod = type(exc).__module__ or ""
    msg = str(exc)
    msg_lower = msg.lower()
    code = _mysql_code(exc)

    detail = f"{name}: {msg}"
    if context:
        detail = f"{context} — {detail}"
    detail = detail[:500]

    # ── Database (MySQL via pymysql / SQLAlchemy) ──────────────────────────
    if code in _DEADLOCK_CODES:
        category, severity = "db_deadlock", TRANSIENT
        summary = "Deadlock MySQL (verrous concurrents) — réessayé automatiquement"
    elif code in _LOCK_TIMEOUT_CODES:
        category, severity = "db_lock_timeout", TRANSIENT
        summary = "Délai d'attente d'un verrou MySQL dépassé — réessayé"
    elif code in _CONN_CODES or "gone away" in msg_lower or "lost connection" in msg_lower:
        category, severity = "db_connection", ERROR
        summary = "Connexion à la base de données perdue"
    elif code is not None or name in ("IntegrityError", "DataError", "DatabaseError", "OperationalError") or "sqlalchemy" in exc_mod:
        category, severity = "db_error", ERROR
        summary = "Erreur base de données"

    # ── LLM / Ollama (httpx) and JSON parsing ──────────────────────────────
    elif "timeout" in name.lower() or "timed out" in msg_lower:
        category, severity = "llm_timeout", WARNING
        summary = "Délai dépassé sur l'appel au modèle (Ollama)"
    elif name == "JSONDecodeError" or (name == "ValueError" and ("json" in msg_lower or "expecting value" in msg_lower)):
        category, severity = "llm_json", WARNING
        summary = "Réponse du modèle non parsable (JSON invalide) — fallback dégradé"
    elif name == "HTTPStatusError":
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status and status >= 500:
            category, severity = "llm_unavailable", ERROR
            summary = f"Service modèle (Ollama) en erreur {status}"
        else:
            category, severity = "http_error", WARNING
            summary = (f"Erreur HTTP {status} sur une requête externe" if status
                       else "Erreur HTTP sur une requête externe")
    elif name in ("ConnectError", "ConnectionError") or "connection refused" in msg_lower or "connection attempts failed" in msg_lower:
        category, severity = "llm_unavailable", ERROR
        summary = "Service modèle (Ollama) injoignable"
    elif "http" in name.lower():
        category, severity = "http_error", WARNING
        summary = "Erreur HTTP sur une requête externe"

    # ── Fallback ───────────────────────────────────────────────────────────
    else:
        category, severity = "unknown", ERROR
        summary = f"Erreur non classée : {name}"

    return {"category": category, "severity": severity, "summary": summary, "detail": detail}


def with_db_retry(fn, *, on_retry=None, attempts: int = 4,
                  codes=_DEADLOCK_CODES + _LOCK_TIMEOUT_CODES, base_delay: float = 0.3):
    """Run `fn` and retry on transient MySQL lock errors.

    `fn` must be self-contained and idempotent (it does its own writes + commit
    and is safe to re-run). On a retryable error we call `on_retry` (typically
    `db.rollback`) to reset the aborted transaction, back off, then retry.
    Returns fn()'s value on success; re-raises once attempts are exhausted or
    the error is not a retryable lock error.
    """
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            if _mysql_code(exc) in codes and attempt < attempts - 1:
                if on_retry is not None:
                    on_retry()
                time.sleep(base_delay * (attempt + 1))
                continue
            raise
