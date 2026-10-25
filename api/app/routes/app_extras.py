"""routes/app_extras.py — live stats, activity feed, profile stats, transactions, rematch."""
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.redis_client import get_redis
from app.core import telegram_notify
from app.models.models import DuelGame, GameRound, Match, RpsGame, User, WalletTransaction
from app.routes.webapp import _webapp_user
from app.services import matchmaking_service

router = APIRouter(prefix="/webapp")


@router.get("/config")
def config():
    return {"bot_username": os.getenv("BOT_USERNAME", "Ticarena_bot"),
            "telebirr_number": os.getenv("TELEBIRR_NUMBER", "09xxxxxxxx"),
            "telebirr_name": os.getenv("TELEBIRR_NAME", "xxxxxxx")}


@router.get("/online")
def online(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    n = db.query(func.count(User.internal_id)).filter(User.last_seen_at >= since).scalar() or 0
    return {"online": n}


def _results(db: Session, uid, limit=60) -> list:
    out = []
    ms = (db.query(Match).filter((Match.player_x_id == uid) | (Match.player_o_id == uid),
                                 Match.status.in_(["completed_win", "completed_draw", "completed_forfeit"]))
          .order_by(Match.settled_at.desc()).limit(limit).all())
    for m in ms:
        if m.winner_id == uid:
            res, net = "win", (m.payout_amount or Decimal(0)) - m.stake_amount
        elif m.winner_id is None:
            res, net = "draw", Decimal(0)
        else:
            res, net = "loss", -m.stake_amount
        out.append({"game": m.game_type, "result": res, "net": str(net), "stake": str(m.stake_amount),
                    "at": m.settled_at})
    rs = (db.query(GameRound).filter(GameRound.user_id == uid, GameRound.status != "active")
          .order_by(GameRound.settled_at.desc()).limit(limit).all())
    for r in rs:
        net = r.payout_amount - r.bet_amount
        out.append({"game": r.game, "result": "win" if net > 0 else "loss", "net": str(net),
                    "stake": str(r.bet_amount), "at": r.settled_at})
    ps = (db.query(RpsGame).filter((RpsGame.creator_id == uid) | (RpsGame.opponent_id == uid),
                                   RpsGame.status.in_(["completed", "draw"]))
          .order_by(RpsGame.settled_at.desc()).limit(limit).all())
    for g in ps:
        if g.status == "draw":
            res, net = "draw", Decimal(0)
        elif g.winner_id == uid:
            res, net = "win", (g.payout_amount or Decimal(0)) - g.stake_amount
        else:
            res, net = "loss", -g.stake_amount
        out.append({"game": "rps", "result": res, "net": str(net), "stake": str(g.stake_amount), "at": g.settled_at})
    ds_ = (db.query(DuelGame).filter((DuelGame.creator_id == uid) | (DuelGame.opponent_id == uid),
                                     DuelGame.status.in_(["completed", "draw"]))
           .order_by(DuelGame.settled_at.desc()).limit(limit).all())
    for g in ds_:
        if g.status == "draw":
            res, net = "draw", Decimal(0)
        elif g.winner_id == uid:
            res, net = "win", (g.payout_amount or Decimal(0)) - g.stake_amount
        else:
            res, net = "loss", -g.stake_amount
        out.append({"game": g.game, "result": res, "net": str(net), "stake": str(g.stake_amount), "at": g.settled_at})
    out = [o for o in out if o["at"]]
    out.sort(key=lambda o: o["at"], reverse=True)
    return out


@router.get("/activity")
def activity(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    items = _results(db, user.internal_id)[:20]
    for i in items:
        i["at"] = i["at"].isoformat()
    return {"results": items}


@router.get("/profile-stats")
def profile_stats(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    items = _results(db, user.internal_id, limit=1000)
    wins = sum(1 for i in items if i["result"] == "win")
    losses = sum(1 for i in items if i["result"] == "loss")
    draws = sum(1 for i in items if i["result"] == "draw")
    decided = wins + losses
    total_won = sum((Decimal(i["net"]) for i in items if i["result"] == "win"), Decimal(0))
    net = sum((Decimal(i["net"]) for i in items), Decimal(0))
    best = max((Decimal(i["net"]) for i in items), default=Decimal(0))
    return {"games": len(items), "wins": wins, "losses": losses, "draws": draws,
            "win_rate": round(100 * wins / decided, 1) if decided else 0,
            "total_won": str(total_won), "net": str(net), "best_win": str(best if best > 0 else Decimal(0))}


@router.get("/transactions")
def transactions(response: Response, db: Session = Depends(get_db), x_telegram_init_data: str = Header(None)):
    user = _webapp_user(db, x_telegram_init_data)
    response.headers["Cache-Control"] = "no-store"
    rows = (db.query(WalletTransaction).filter(WalletTransaction.wallet_id == user.wallet.id)
            .order_by(WalletTransaction.created_at.desc()).limit(40).all())
    return {"transactions": [{"type": t.type, "amount": str(t.amount), "description": t.description,
                              "at": t.created_at.isoformat() if t.created_at else None} for t in rows]}


@router.post("/rematch/{match_id}")
async def rematch(match_id: str, db: Session = Depends(get_db), redis_client=Depends(get_redis),
                  x_telegram_init_data: str = Header(None)):
    import uuid
    user = _webapp_user(db, x_telegram_init_data)
    try:
        m = db.query(Match).filter(Match.id == uuid.UUID(match_id)).first()
    except ValueError:
        m = None
    if not m or user.internal_id not in (m.player_x_id, m.player_o_id):
        raise HTTPException(status_code=404, detail="Match not found.")
    opp_id = m.player_o_id if m.player_x_id == user.internal_id else m.player_x_id
    opp = db.query(User).filter(User.internal_id == opp_id).first()
    try:
        result = matchmaking_service.create_challenge_for_user(redis_client, db, user, opp, m.stake_amount, game_type=m.game_type)
    except matchmaking_service.InsufficientBalanceForStakeError:
        raise HTTPException(status_code=400, detail="Insufficient balance for this stake.")
    who = user.full_name or user.telegram_username or "A player"
    sent = await telegram_notify.send_message(
        result["opponent_telegram_id"],
        f"🔁 <b>{who} wants a rematch for {m.stake_amount} ETB!</b>",
        reply_markup=telegram_notify.challenge_response_markup(),
    )
    return {"notified": sent}
