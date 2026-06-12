"""
Active learning worker — learns the team's own definition of relevance.

Training data: human 👍/👎 feedback (feedback table) paired with the article
embeddings already stored for corroboration. Model: logistic regression on the
768-d vectors, implemented in pure numpy (no scikit-learn dependency, CPU
only, trains in milliseconds — zero VRAM impact).

Output: articles.ml_relevance = predicted relevance probability × 100 for
every embedded article. The feed's "to review" queue sorts by uncertainty
(|ml_relevance − 50| ascending), so each new human label is asked where the
model hesitates most — that is the "active" part of active learning.

The model never deletes anything: it only feeds the review queue and the
display. Human verdicts always win.
"""

import struct
import threading
import numpy as np
from sqlalchemy import text
from database import SessionLocal
from models import MlModel, Feedback, Embedding
from ollama_client import bytes_to_vector

MIN_PER_CLASS = 10

_train_lock = threading.Lock()


def _unit_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


def _train_logreg(X: np.ndarray, y: np.ndarray, epochs: int = 400, lr: float = 0.5, l2: float = 1e-3):
    """Class-weighted logistic regression by full-batch gradient descent."""
    n, d = X.shape
    w = np.zeros(d, dtype=np.float64)
    b = 0.0
    # Balance classes: each class contributes equally to the loss
    n_pos = float(y.sum())
    n_neg = float(n - n_pos)
    sample_w = np.where(y == 1, n / (2 * n_pos), n / (2 * n_neg))
    for _ in range(epochs):
        p = 1.0 / (1.0 + np.exp(-(X @ w + b)))
        err = (p - y) * sample_w
        w -= lr * (X.T @ err / n + l2 * w)
        b -= lr * float(np.mean(err))
    return w, b


def train_and_apply() -> dict:
    """Train on current feedback and refresh ml_relevance for all articles."""
    with _train_lock:
        db = SessionLocal()
        try:
            rows = (
                db.query(Feedback.verdict, Embedding.vec_data)
                .join(Embedding, Embedding.article_id == Feedback.article_id)
                .all()
            )
            y = np.array([1.0 if v == "pertinent" else 0.0 for v, _ in rows])
            n_pos = int(y.sum()) if len(y) else 0
            n_neg = len(y) - n_pos
            if n_pos < MIN_PER_CLASS or n_neg < MIN_PER_CLASS:
                return {
                    "trained": False,
                    "reason": f"besoin d'au moins {MIN_PER_CLASS} exemples par classe "
                              f"(👍 {n_pos} · 👎 {n_neg})",
                    "n_samples": len(y), "n_positive": n_pos,
                }

            X = _unit_rows(np.stack([
                np.array(bytes_to_vector(vd), dtype=np.float32) for _, vd in rows
            ]).astype(np.float64))

            w, b = _train_logreg(X, y)
            p = 1.0 / (1.0 + np.exp(-(X @ w + b)))
            accuracy = round(float(np.mean((p >= 0.5) == (y == 1))) * 100, 1)

            weights_blob = struct.pack(f"{len(w)}f", *w.astype(np.float32)) + struct.pack("f", float(b))
            db.add(MlModel(
                n_samples=len(y), n_positive=n_pos,
                accuracy=accuracy, weights=weights_blob,
            ))
            db.commit()

            applied = _apply_to_all(db, w, b)
            return {"trained": True, "n_samples": len(y), "n_positive": n_pos,
                    "accuracy": accuracy, "applied_to": applied}
        finally:
            db.close()


def _apply_to_all(db, w: np.ndarray, b: float) -> int:
    """Predict ml_relevance for every embedded article (short transactions)."""
    rows = db.execute(text("SELECT article_id, vec_data FROM embeddings")).fetchall()
    db.commit()  # end the read snapshot before updating (MariaDB 1020)

    ids = [r[0] for r in rows]
    X = _unit_rows(np.stack([
        np.array(bytes_to_vector(r[1]), dtype=np.float32) for r in rows
    ]).astype(np.float64))
    probs = 1.0 / (1.0 + np.exp(-(X @ w + b)))

    applied = 0
    for i in range(0, len(ids), 500):
        chunk = list(zip(ids[i:i + 500], probs[i:i + 500]))
        for attempt in (1, 2, 3):
            try:
                for article_id, prob in chunk:
                    db.execute(
                        text("UPDATE articles SET ml_relevance = :p WHERE id = :id"),
                        {"p": round(float(prob) * 100, 1), "id": article_id},
                    )
                db.commit()
                applied += len(chunk)
                break
            except Exception:
                db.rollback()
    return applied


def retrain_if_new_feedback() -> dict:
    """Hourly scheduler job: retrain only when the label set changed."""
    db = SessionLocal()
    try:
        current = db.query(Feedback).count()
        last = db.query(MlModel).order_by(MlModel.trained_at.desc()).first()
    finally:
        db.close()
    if current == 0 or (last and last.n_samples == current):
        return {"trained": False, "reason": "no new feedback"}
    return train_and_apply()
