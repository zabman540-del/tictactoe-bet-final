"""
services/rps_service.py — Rock Paper Scissors, 1v1.

Rules (shown to players before they play):
 - Both stake the same amount, 5-500 ETB (locked when the challenge is created / joined).
 - Both secretly pick Rock, Paper or Scissors. A pick is final (cannot be changed).
 - Moves stay hidden (server never sends them) until BOTH have picked.
 - Rock beats Scissors, Scissors beats Paper, Paper beats Rock.
 - Winner gets 2 x stake minus the platform fee (1/2/3 ETB tiers, same as other games).
 - Same move = draw: both stakes refunded, no fee.
 - Only ONE player picks within 60s of joining: that player wins by forfeit. Nobody picks: both refunded.
 - Nobody joins within 10 minutes: the challenge expires and the stake is refunded.
Money moves reuse wallet_service (row-locked, idempotent ledger).
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.models import RpsGame, User
from app.services import wallet_service
from app.services.wallet_service import InsufficientBalanceError

MIN_STAKE = Decimal("5")
MAX_STAKE = Decimal("500")
MOVES = ("rock", "paper", "scissors")
BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}
OPEN_MINUTES = 10
PICK_SECONDS = 60


class RpsError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def fee_for(stake: Decimal) -> Decimal:
    if stake <= Decimal("50"):
        return Decimal("1.00")
    if stake <= Decimal("100"):
        return Decimal("2.00")
    return Decimal("3.00")


def rules() -> dict:
    return {"min_stake": str(MIN_STAKE), "max_stake": str(MAX_STAKE), "pick_seconds": PICK_SECONDS, "open_minutes": OPEN_MINUTES,
            "fees": {"up_to_50": "1", "up_to_100": "2", "above_100": "3"}}


def _name(db, uid):
    if not uid:
        return None
    u = db.query(User).filter(User.internal_id == uid).first()
    return (u.full_name or u.telegram_username or str(u.telegram_user_id)) if u else None


def public_state(db: Session, g: RpsGame, user_id) -> dict:
    uid = user_id
    is_creator = g.creator_id == uid
    is_opp = g.opponent_id == uid
    finished = g.status in ("completed", "draw")
    my_move = g.creator_move if is_creator else (g.opponent_move if is_opp else None)
    opp_move = g.opponent_move if is_creator else g.creator_move
    out = {
        "game_id": str(g.id), "status": g.status, "stake": str(g.stake_amount),
        "fee": str(fee_for(g.stake_amount)),
        "you_are": "creator" if is_creator else ("opponent" if is_opp else "viewer"),
        "creator_name": _name(db, g.creator_id), "opponent_name": _name(db, g.opponent_id),
        "my_move": my_move,
        "opponent_locked": (g.opponent_move is not None) if is_creator else (g.creator_move is not None),
        "pick_deadline": g.pick_deadline.isoformat() if g.pick_deadline else None,
        "expires_at": g.expires_at.isoformat() if g.expires_at else None,
    }
    if finished:   # moves are revealed only once the game is settled
        out["creator_move"] = g.creator_move
        out["opponent_move"] = g.opponent_move
    if g.status in ("completed", "draw", "cancelled", "expired"):
        out["you_won"] = (g.winner_id == uid) if g.winner_id else None
        out["payout"] = str(g.payout_amount or 0)
        out["reason"] = g.result_reason
    return out


def _lock_game(db, game_id) -> RpsGame:
    try:
        gid = uuid.UUID(str(game_id))
    except ValueError:
        raise RpsError("Game not found.")
    g = db.query(RpsGame).filter(RpsGame.id == gid).with_for_update().first()
    if not g:
        raise RpsError("Game not found.")
    return g


def _settle_win(db, g: RpsGame, winner_id, loser_id, reason):
    fee = fee_for(g.stake_amount)
    g.status, g.winner_id, g.result_reason = "completed", winner_id, reason
    g.platform_fee, g.payout_amount, g.settled_at = fee, g.stake_amount * 2 - fee, _now()
    db.flush()
    wallet_service.settle_match_win(db, winner_id, loser_id, g.stake_amount, fee, g.id)   # commits


def _settle_draw(db, g: RpsGame, reason):
    g.status, g.result_reason, g.settled_at, g.payout_amount = "draw", reason, _now(), Decimal("0")
    db.flush()
    wallet_service.settle_match_draw(db, g.creator_id, g.opponent_id, g.stake_amount, g.id)   # commits


def _apply_timeouts(db, g: RpsGame) -> bool:
    """Call with g locked. Returns True if it changed (and committed)."""
    now = _now()
    if g.status == "open" and g.expires_at <= now:
        g.status, g.result_reason, g.settled_at = "expired", "expired", now
        db.flush()
        wallet_service.release_single_stake(db, g.creator_id, g.stake_amount, g.id, "rps_expired")  # commits
        return True
    if g.status == "picking" and g.pick_deadline and g.pick_deadline <= now:
        c, o = g.creator_move, g.opponent_move
        if c and not o:
            _settle_win(db, g, g.creator_id, g.opponent_id, "forfeit")
        elif o and not c:
            _settle_win(db, g, g.opponent_id, g.creator_id, "forfeit")
        else:
            _settle_draw(db, g, "no_picks")
        return True
    return False


def create(db: Session, user: User, stake, invited_id=None) -> RpsGame:
    try:
        stake = Decimal(str(stake))
    except Exception:
        raise RpsError("Invalid stake.")
    if stake != stake.quantize(Decimal("0.01")) or stake < MIN_STAKE or stake > MAX_STAKE:
        raise RpsError(f"Stake must be between {MIN_STAKE} and {MAX_STAKE} ETB.")
    g = RpsGame(id=uuid.uuid4(), creator_id=user.internal_id, invited_id=invited_id, stake_amount=stake,
                status="open", expires_at=_now() + timedelta(minutes=OPEN_MINUTES))
    db.add(g)
    db.flush()
    try:
        wallet_service.lock_stake(db, user.internal_id, stake, g.id)   # commits game + lock together
    except InsufficientBalanceError:
        db.rollback()
        raise RpsError("Not enough balance for this stake.")
    return g


def join(db: Session, user: User, game_id) -> RpsGame:
    g = _lock_game(db, game_id)
    if _apply_timeouts(db, g):
        raise RpsError("This challenge has expired.")
    if g.status != "open":
        db.rollback()
        raise RpsError("This challenge is no longer open.")
    if g.creator_id == user.internal_id:
        db.rollback()
        raise RpsError("You can't join your own challenge.")
    if g.invited_id and g.invited_id != user.internal_id:
        db.rollback()
        raise RpsError("This challenge is for another player.")
    g.opponent_id, g.status = user.internal_id, "picking"
    g.joined_at = _now()
    g.pick_deadline = g.joined_at + timedelta(seconds=PICK_SECONDS)
    db.flush()
    try:
        wallet_service.lock_stake(db, user.internal_id, g.stake_amount, g.id)   # commits join + lock together
    except InsufficientBalanceError:
        db.rollback()
        raise RpsError("Not enough balance for this stake.")
    return g


def pick(db: Session, user: User, game_id, move: str) -> RpsGame:
    if move not in MOVES:
        raise RpsError("Invalid move.")
    g = _lock_game(db, game_id)
    if _apply_timeouts(db, g):
        return g
    if g.status != "picking":
        db.rollback()
        raise RpsError("This game is not accepting moves.")
    if user.internal_id == g.creator_id:
        if g.creator_move:
            db.rollback()
            raise RpsError("You already locked in your move.")
        g.creator_move = move
    elif user.internal_id == g.opponent_id:
        if g.opponent_move:
            db.rollback()
            raise RpsError("You already locked in your move.")
        g.opponent_move = move
    else:
        db.rollback()
        raise RpsError("You are not in this game.")
    if g.creator_move and g.opponent_move:
        c, o = g.creator_move, g.opponent_move
        if c == o:
            _settle_draw(db, g, "same_move")
        elif BEATS[c] == o:
            _settle_win(db, g, g.creator_id, g.opponent_id, "moves")
        else:
            _settle_win(db, g, g.opponent_id, g.creator_id, "moves")
    else:
        db.commit()
    return g


def cancel(db: Session, user: User, game_id) -> RpsGame:
    g = _lock_game(db, game_id)
    if g.creator_id != user.internal_id:
        db.rollback()
        raise RpsError("Only the creator can cancel.")
    if g.status != "open":
        db.rollback()
        raise RpsError("Too late to cancel; the game already started.")
    g.status, g.result_reason, g.settled_at = "cancelled", "cancelled", _now()
    db.flush()
    wallet_service.release_single_stake(db, g.creator_id, g.stake_amount, g.id, "rps_cancelled")  # commits
    return g


def get_state(db: Session, user: User, game_id) -> dict:
    g = _lock_game(db, game_id)
    if not _apply_timeouts(db, g):
        db.rollback()
    db.refresh(g)
    return public_state(db, g, user.internal_id)


def lobby(db: Session, user: User) -> dict:
    now = _now()
    open_games = (db.query(RpsGame).filter(RpsGame.status == "open", RpsGame.expires_at > now,
                                           RpsGame.creator_id != user.internal_id).order_by(RpsGame.created_at.desc()).limit(30).all())
    open_games = [g for g in open_games if not g.invited_id or g.invited_id == user.internal_id]
    mine = (db.query(RpsGame).filter(RpsGame.status.in_(["open", "picking"]),
                                     (RpsGame.creator_id == user.internal_id) | (RpsGame.opponent_id == user.internal_id))
            .order_by(RpsGame.created_at.desc()).first())
    return {
        "open": [{"game_id": str(g.id), "creator_name": _name(db, g.creator_id), "stake": str(g.stake_amount),
                  "private": bool(g.invited_id)} for g in open_games],
        "mine": str(mine.id) if mine else None,
    }


def sweep_timeouts(db: Session):
    """Called from the background loop."""
    now = _now()
    ids = [r[0] for r in db.query(RpsGame.id).filter(
        ((RpsGame.status == "open") & (RpsGame.expires_at <= now)) |
        ((RpsGame.status == "picking") & (RpsGame.pick_deadline <= now))).all()]
    for gid in ids:
        g = _lock_game(db, gid)
        if not _apply_timeouts(db, g):
            db.rollback()
