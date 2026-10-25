"""
routes/admin_live.py — data for the admin "Live" page.

Shows, refreshed every few seconds:
  - Tic-Tac-Toe / Checkers matches in progress (board + whose turn)
  - Rock Paper Scissors games (waiting, picking, and just finished)
  - Chicken Road / Mines rounds currently being played
  - recently finished matches

Rock Paper Scissors picks are shown only AFTER the game is settled
(while a game is still being played only "locked in / thinking" is shown),
so nobody with admin access can ever leak a pick to a player.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.admin_auth import get_current_admin
from app.core.database import get_db
from app.models.models import Admin, GameRound, Match, RpsGame, User

router = APIRouter()


def _now():
    return datetime.now(timezone.utc)


def _iso(d):
    return d.isoformat() if d else None


def _names(db, ids):
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = db.query(User).filter(User.internal_id.in_(ids)).all()
    return {u.internal_id: (u.full_name or u.telegram_username or str(u.telegram_user_id)) for u in rows}


@router.get("/admin/live")
def live(db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    try:
        now = _now()
        recent_cut = now - timedelta(minutes=30)

        matches = (db.query(Match).filter((Match.status == "active") | (Match.updated_at >= recent_cut))
                   .order_by(Match.created_at.desc()).limit(60).all())
        rps = (db.query(RpsGame).filter(RpsGame.status.in_(["open", "picking"]) |
                                        (RpsGame.settled_at >= recent_cut))
               .order_by(RpsGame.created_at.desc()).limit(60).all())
        rounds = (db.query(GameRound).filter(GameRound.status == "active")
                  .order_by(GameRound.created_at.desc()).limit(40).all())

        ids = []
        for m in matches:
            ids += [m.player_x_id, m.player_o_id, m.winner_id]
        for g in rps:
            ids += [g.creator_id, g.opponent_id, g.winner_id]
        for r in rounds:
            ids.append(r.user_id)
        nm = _names(db, ids)

        out_matches = []
        for m in matches:
            active = m.status == "active"
            out_matches.append({
                "id": str(m.id), "game": m.game_type, "stake": str(m.stake_amount),
                "active": active, "status": m.status,
                "x": nm.get(m.player_x_id), "o": nm.get(m.player_o_id),
                "turn": m.current_turn if active else None,
                "board": m.board, "winner": nm.get(m.winner_id),
                "reason": m.result_reason, "payout": str(m.payout_amount or 0),
                "since": _iso(m.last_move_at if active else m.settled_at or m.updated_at),
            })

        out_rps = []
        for g in rps:
            finished = g.status in ("completed", "draw")
            out_rps.append({
                "id": str(g.id), "stake": str(g.stake_amount), "status": g.status,
                "creator": nm.get(g.creator_id), "opponent": nm.get(g.opponent_id),
                "creator_locked": g.creator_move is not None,
                "opponent_locked": g.opponent_move is not None,
                # picks are revealed only once the game is settled
                "creator_move": g.creator_move if finished else None,
                "opponent_move": g.opponent_move if finished else None,
                "winner": nm.get(g.winner_id), "reason": g.result_reason,
                "payout": str(g.payout_amount or 0),
                "deadline": _iso(g.pick_deadline), "since": _iso(g.settled_at or g.joined_at or g.created_at),
            })

        out_rounds = [{
            "id": str(r.id), "game": r.game, "player": nm.get(r.user_id), "bet": str(r.bet_amount),
            "step": (r.params or {}).get("step"), "difficulty": (r.params or {}).get("difficulty"),
            "mines": (r.params or {}).get("mines"), "picks": len((r.params or {}).get("revealed", []) or []),
            "since": _iso(r.created_at),
        } for r in rounds]

        return {
            "now": _iso(now),
            "counts": {
                "matches": sum(1 for m in out_matches if m["active"]),
                "rps": sum(1 for g in out_rps if g["status"] in ("open", "picking")),
                "rounds": len(out_rounds),
            },
            "matches": out_matches, "rps": out_rps, "rounds": out_rounds,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Live error: {type(e).__name__}: {e}")
