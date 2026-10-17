"""routes/rps.py — Rock Paper Scissors endpoints (signed initData auth)."""
import os
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core import telegram_notify
from app.models.models import User
from app.routes.webapp import _webapp_user
from app.services import rps_service as rps

router = APIRouter(prefix="/webapp/rps")


class CreateBody(BaseModel):
    stake: str
    invite_user_id: str | None = None

class PickBody(BaseModel):
    move: str


def _guard(fn, db):
    try:
        return fn()
    except rps.RpsError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/rules")
def rules():
    return rps.rules()


@router.get("/lobby")
def lobby(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return rps.lobby(db, user)


@router.post("/create")
async def create(body: CreateBody, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    invited = None
    if body.invite_user_id:
        try:
            invited = db.query(User).filter(User.internal_id == uuid.UUID(body.invite_user_id)).first()
        except ValueError:
            invited = None
        if not invited or invited.internal_id == user.internal_id:
            raise HTTPException(status_code=400, detail="Invalid friend.")
    g = _guard(lambda: rps.create(db, user, body.stake, invited.internal_id if invited else None), db)
    out = {"game_id": str(g.id), "notified": None}
    if invited:
        domain = os.getenv("PUBLIC_API_BASE_URL") or ("https://" + os.getenv("RAILWAY_PUBLIC_DOMAIN", ""))
        url = f"{domain.rstrip('/')}/app-ui/#/rps/{g.id}"
        who = user.full_name or user.telegram_username or "A player"
        out["notified"] = await telegram_notify.send_message(
            invited.telegram_user_id,
            f"✊✋✌️ <b>{who}</b> challenged you to Rock Paper Scissors for <b>{g.stake_amount} ETB</b>!\n"
            f"Fee 1–3 ETB, winner takes the pot. Draw = refund.",
            reply_markup={"inline_keyboard": [[{"text": "⚔️ Open challenge", "web_app": {"url": url}}]]},
        )
    return out


@router.post("/{game_id}/join")
def join(game_id: str, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: rps.join(db, user, game_id), db)
    return rps.public_state(db, g, user.internal_id)


@router.post("/{game_id}/pick")
def pick(game_id: str, body: PickBody, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: rps.pick(db, user, game_id, body.move), db)
    db.refresh(g)
    return rps.public_state(db, g, user.internal_id)


@router.post("/{game_id}/cancel")
def cancel(game_id: str, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: rps.cancel(db, user, game_id), db)
    return rps.public_state(db, g, user.internal_id)


@router.get("/{game_id}")
def state(game_id: str, response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return _guard(lambda: rps.get_state(db, user, game_id), db)
