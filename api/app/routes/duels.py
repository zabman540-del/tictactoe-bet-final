"""routes/duels.py — Chess, Archery, Car Race and Pool 1v1 (signed initData auth)."""
import os
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core import telegram_notify
from app.models.models import User
from app.routes.webapp import _webapp_user
from app.services import duel_service as ds

router = APIRouter(prefix="/webapp/duels")

LABEL = {"chess": "♟️ Chess", "archery": "🏹 Archery", "race": "🏎️ Car Race", "pool": "🎱 Pool"}


class CreateBody(BaseModel):
    game: str
    stake: str
    invite_user_id: str | None = None


class MoveBody(BaseModel):
    # chess
    from_: int | None = Field(default=None, alias="from")
    to: int | None = None
    promo: str | None = None
    # pool
    angle: float | None = None
    power: float | None = None
    place: list[float] | None = None
    # race
    ready: bool | None = None
    log: list | None = None

    model_config = {"populate_by_name": True}


def _guard(fn, db):
    try:
        return fn()
    except ds.DuelError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/rules")
def rules():
    return ds.rules()


@router.get("/lobby")
def lobby(response: Response, game: str | None = None, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return ds.lobby(db, user, game)


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
    g = _guard(lambda: ds.create(db, user, body.game, body.stake, invited.internal_id if invited else None), db)
    out = {"game_id": str(g.id), "notified": None}
    if invited:
        domain = os.getenv("PUBLIC_API_BASE_URL") or ("https://" + os.getenv("RAILWAY_PUBLIC_DOMAIN", ""))
        url = f"{domain.rstrip('/')}/app-ui/#/duel/{g.id}"
        who = user.full_name or user.telegram_username or "A player"
        out["notified"] = await telegram_notify.send_message(
            invited.telegram_user_id,
            f"{LABEL.get(g.game, g.game)}: <b>{who}</b> challenged you for <b>{g.stake_amount} ETB</b>!\n"
            f"Winner takes the pot (minus a small fee). Draw = refund.",
            reply_markup={"inline_keyboard": [[{"text": "⚔️ Open challenge", "web_app": {"url": url}}]]},
        )
    return out


@router.post("/{game_id}/join")
def join(game_id: str, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: ds.join(db, user, game_id), db)
    return ds.public_state(db, g, user.internal_id)


@router.post("/{game_id}/move")
def move(game_id: str, body: MoveBody, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    data = {"from": body.from_, "to": body.to, "promo": body.promo, "angle": body.angle, "power": body.power,
            "place": body.place, "ready": body.ready, "log": body.log}
    g = _guard(lambda: ds.move(db, user, game_id, data), db)
    db.refresh(g)
    return ds.public_state(db, g, user.internal_id)


@router.post("/{game_id}/resign")
def resign(game_id: str, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: ds.resign(db, user, game_id), db)
    db.refresh(g)
    return ds.public_state(db, g, user.internal_id)


@router.post("/{game_id}/cancel")
def cancel(game_id: str, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    g = _guard(lambda: ds.cancel(db, user, game_id), db)
    return ds.public_state(db, g, user.internal_id)


@router.get("/{game_id}/anim/{no}")
def anim(game_id: str, no: int, response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return _guard(lambda: ds.get_anim(db, user, game_id, no), db)


@router.get("/{game_id}")
def state(game_id: str, response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return _guard(lambda: ds.get_state(db, user, game_id), db)
