"""routes/games.py — Mines & Dice endpoints for the Mini App (signed initData auth)."""
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routes.webapp import _webapp_user
from app.services import house_game_service as hg

router = APIRouter(prefix="/webapp/games")


class MinesStart(BaseModel):
    bet: str
    mines: int

class MinesReveal(BaseModel):
    round_id: str
    tile: int

class MinesCash(BaseModel):
    round_id: str

class DiceQuote(BaseModel):
    direction: str
    target: int

class DiceRoll(DiceQuote):
    bet: str


def _run(fn, db):
    try:
        return fn()
    except hg.GameError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/rules")
def rules(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"mines": hg.mines_rules(), "chicken": hg.chicken_rules(),
            "dice": {"enabled": hg.DICE_ENABLED, "house_edge_percent": str(hg.HOUSE_EDGE * 100), "min_bet": str(hg.MIN_BET),
                     "max_bet": str(hg.MAX_BET), "max_payout": str(hg.MAX_PAYOUT),
                     "min_chance": hg.DICE_MIN_CHANCE, "max_chance": hg.DICE_MAX_CHANCE}}


@router.get("/mines/active")
def mines_active(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return {"round": hg.mines_active(db, user.internal_id)}


@router.post("/mines/start")
def mines_start(body: MinesStart, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.mines_start(db, user.internal_id, body.bet, body.mines), db)


@router.post("/mines/reveal")
def mines_reveal(body: MinesReveal, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.mines_reveal(db, user.internal_id, body.round_id, body.tile), db)


@router.post("/mines/cashout")
def mines_cashout(body: MinesCash, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.mines_cashout(db, user.internal_id, body.round_id), db)


@router.post("/dice/quote")
def dice_quote(body: DiceQuote):
    try:
        return hg.dice_quote(body.direction, body.target)
    except hg.GameError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/dice/roll")
def dice_roll(body: DiceRoll, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.dice_roll(db, user.internal_id, body.bet, body.direction, body.target), db)


@router.get("/chicken/active")
def chicken_active(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return {"round": hg.chicken_active(db, user.internal_id)}


class ChickenStart(BaseModel):
    bet: str


@router.post("/chicken/start")
def chicken_start(body: ChickenStart, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.chicken_start(db, user.internal_id, body.bet), db)


@router.post("/chicken/step")
def chicken_step(body: MinesCash, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.chicken_step(db, user.internal_id, body.round_id), db)


@router.post("/chicken/cashout")
def chicken_cashout(body: MinesCash, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    return _run(lambda: hg.chicken_cashout(db, user.internal_id, body.round_id), db)


@router.get("/history")
def history(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    return {"rounds": hg.history(db, user.internal_id)}
