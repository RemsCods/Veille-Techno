from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Blacklist
from schemas import BlacklistCreate, BlacklistOut

router = APIRouter(prefix="/blacklist", tags=["blacklist"])


@router.get("", response_model=list[BlacklistOut])
def list_blacklist(db: Session = Depends(get_db)):
    return db.query(Blacklist).all()


@router.post("", response_model=BlacklistOut, status_code=201)
def add_to_blacklist(payload: BlacklistCreate, db: Session = Depends(get_db)):
    entry = Blacklist(**payload.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def remove_from_blacklist(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(Blacklist, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
