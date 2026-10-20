"""routes/flight.py — Nova Flight (real ETB, provably fair). Auth via Telegram initData."""
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routes.webapp import _webapp_user
from app.services import nova_flight_service as nf

router = APIRouter(prefix="/webapp/flight")


class BetIn(BaseModel):
    amount: str
    auto_cashout: Optional[str] = None


def _run(fn, db):
    try:
        return fn()
    except nf.FlightError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/state")
def flight_state(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    u = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return _run(lambda: nf.state(db, u.internal_id), db)


@router.post("/bet")
def flight_bet(p: BetIn, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    u = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: nf.place_bet(db, u.internal_id, p.amount, p.auto_cashout), db)


@router.post("/cashout")
def flight_cashout(db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    u = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: nf.cash_out(db, u.internal_id), db)
