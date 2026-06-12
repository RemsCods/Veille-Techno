"""
Relevance management API:
- topic anchors CRUD (the editable watch scope)
- ML model status + manual retrain
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import TopicAnchor, MlModel, Feedback
from schemas import AnchorCreate, AnchorPatch, AnchorOut, MlModelOut
from relevance import invalidate_anchor_cache
from workers.learner import train_and_apply, MIN_PER_CLASS

router = APIRouter(prefix="/relevance", tags=["relevance"])


# ── Topic anchors ─────────────────────────────────────────────────────────────

@router.get("/anchors", response_model=list[AnchorOut])
def list_anchors(db: Session = Depends(get_db)):
    return db.query(TopicAnchor).order_by(TopicAnchor.polarity, TopicAnchor.id).all()


@router.post("/anchors", response_model=AnchorOut, status_code=201)
def create_anchor(payload: AnchorCreate, db: Session = Depends(get_db)):
    if payload.polarity not in ("positive", "negative"):
        raise HTTPException(422, "polarity must be 'positive' or 'negative'")
    phrase = payload.phrase.strip()
    if not phrase:
        raise HTTPException(422, "phrase is empty")
    if db.query(TopicAnchor).filter(TopicAnchor.phrase == phrase).first():
        raise HTTPException(409, "anchor already exists")
    anchor = TopicAnchor(phrase=phrase, polarity=payload.polarity)
    db.add(anchor)
    db.commit()
    db.refresh(anchor)
    invalidate_anchor_cache()
    return anchor


@router.patch("/anchors/{anchor_id}", response_model=AnchorOut)
def patch_anchor(anchor_id: int, payload: AnchorPatch, db: Session = Depends(get_db)):
    anchor = db.get(TopicAnchor, anchor_id)
    if not anchor:
        raise HTTPException(404, "anchor not found")
    if payload.phrase is not None:
        anchor.phrase = payload.phrase.strip()
    if payload.polarity is not None:
        if payload.polarity not in ("positive", "negative"):
            raise HTTPException(422, "polarity must be 'positive' or 'negative'")
        anchor.polarity = payload.polarity
    if payload.active is not None:
        anchor.active = payload.active
    db.commit()
    db.refresh(anchor)
    invalidate_anchor_cache()
    return anchor


@router.delete("/anchors/{anchor_id}", status_code=204)
def delete_anchor(anchor_id: int, db: Session = Depends(get_db)):
    anchor = db.get(TopicAnchor, anchor_id)
    if not anchor:
        raise HTTPException(404, "anchor not found")
    db.delete(anchor)
    db.commit()
    invalidate_anchor_cache()


# ── ML model (active learning) ────────────────────────────────────────────────

@router.get("/model", response_model=MlModelOut)
def model_status(db: Session = Depends(get_db)):
    last = db.query(MlModel).order_by(MlModel.trained_at.desc()).first()
    fb_total = db.query(Feedback).count()
    fb_pos = db.query(Feedback).filter(Feedback.verdict == "pertinent").count()
    fb_neg = fb_total - fb_pos
    out = MlModelOut(
        feedback_count=fb_total,
        feedback_positive=fb_pos,
        min_per_class=MIN_PER_CLASS,
        trainable=fb_pos >= MIN_PER_CLASS and fb_neg >= MIN_PER_CLASS,
    )
    if last:
        out.trained_at = last.trained_at
        out.n_samples = last.n_samples
        out.n_positive = last.n_positive
        out.accuracy = last.accuracy
    return out


@router.post("/retrain")
def retrain():
    """Train the relevance classifier on current feedback and apply it."""
    return train_and_apply()
