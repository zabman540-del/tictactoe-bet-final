"""
routes/matches.py

Reading a match's current state, and the all-important "make a
move" endpoint, which is the real referee entry point.
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Header, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rate_limit import limiter
from app.core.telegram_auth import verify_init_data, InvalidInitDataError
from app.schemas import MakeMoveRequest, CheckersMoveRequest, WebAppCheckersMoveRequest, WebAppMoveRequest
from app.services.user_service import get_user_or_404
from app.services import match_service, checkers_service
from app.models.models import Match

router = APIRouter()


def _match_response(match: Match) -> dict:
    return {
        "match_id": str(match.id),
        "game_type": match.game_type,
        "board": match.board,
        "current_turn": match.current_turn,
        "status": match.status,
        "winner_id": str(match.winner_id) if match.winner_id else None,
        "result_reason": match.result_reason,
        "payout_amount": str(match.payout_amount) if match.payout_amount is not None else None,
        "stake_amount": str(match.stake_amount),
        "player_x_id": str(match.player_x_id),
        "player_o_id": str(match.player_o_id),
    }


def _get_webapp_user(db: Session, x_telegram_init_data: str = Header(None)):
    """
    Dependency for Mini App endpoints. Validates the signed initData
    Telegram attaches to every request from inside the WebApp, and
    resolves it to one of our users. We NEVER trust a telegram_user_id
    sent in a request body for these endpoints — only this verified
    header — since the whole point is that it can't be spoofed.
    """
    try:
        tg_user = verify_init_data(x_telegram_init_data)
    except InvalidInitDataError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = get_user_or_404(db, tg_user["id"])
    try:
        from app.services.user_service import touch_user
        touch_user(db, user)
    except Exception:
        db.rollback()
    return user


def _personalize(state: dict, user) -> dict:
    """Adds the per-player fields the Mini App needs. The turn flag is
    computed HERE, on the server, with the same rule make_move enforces,
    so the screen can never disagree with what the server will accept."""
    you_are = "X" if str(state.get("player_x_id")) == str(user.internal_id) else "O"
    state["you_are"] = you_are
    state["you_id"] = str(user.internal_id)
    state["is_your_turn"] = (state.get("status") == "active" and state.get("current_turn") == you_are)
    state["you_won"] = (
        state["winner_id"] == str(user.internal_id) if state.get("winner_id") else None
    )
    return state


@router.get("/matches/{match_id}")
def get_match(match_id: str, db: Session = Depends(get_db)):
    match = db.query(Match).filter(Match.id == uuid.UUID(match_id)).first()
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    return _match_response(match)


@router.post("/matches/{match_id}/move")
@limiter.limit("30/minute")
def make_move(request: Request, match_id: str, payload: MakeMoveRequest, db: Session = Depends(get_db)):
    user = get_user_or_404(db, payload.telegram_user_id)

    try:
        state = match_service.make_move(
            db,
            match_id=uuid.UUID(match_id),
            player_id=user.internal_id,
            cell_position=payload.cell_position,
            idempotency_key=payload.idempotency_key,
        )
    except match_service.InvalidMoveError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except match_service.MatchNotActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    # Add a "you_won" field personalized to whoever asked, since the
    # bot can't safely compare internal UUIDs to Telegram IDs itself.
    state["you_won"] = (
        state["winner_id"] == str(user.internal_id) if state["winner_id"] else None
    )
    return state


@router.post("/matches/{match_id}/checkers-move")
@limiter.limit("30/minute")
def make_checkers_move(request: Request, match_id: str, payload: CheckersMoveRequest, db: Session = Depends(get_db)):
    user = get_user_or_404(db, payload.telegram_user_id)

    try:
        state = checkers_service.make_move(
            db,
            match_id=uuid.UUID(match_id),
            player_id=user.internal_id,
            from_position=payload.from_position,
            to_position=payload.to_position,
            idempotency_key=payload.idempotency_key,
        )
    except checkers_service.InvalidMoveError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except checkers_service.MatchNotActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    state["you_won"] = (
        state["winner_id"] == str(user.internal_id) if state["winner_id"] else None
    )
    return state


# ---------------- Telegram Mini App (visual board) endpoints ----------------
# These are what checkers_app/ (the visual board that opens as a
# Telegram WebApp) actually calls. They identify the player from
# Telegram's signed initData instead of a client-supplied id, since
# this is a real-money game and the request can't be trusted otherwise.

@router.get("/matches/{match_id}/my-state")
@router.get("/matches/{match_id}/webapp-state")
def get_match_webapp(
    match_id: str, response: Response, db: Session = Depends(get_db),
    x_telegram_init_data: str = Header(None),
):
    response.headers["Cache-Control"] = "no-store"
    user = _get_webapp_user(db, x_telegram_init_data)
    match = db.query(Match).filter(Match.id == uuid.UUID(match_id)).first()
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found.")
    if str(user.internal_id) not in (str(match.player_x_id), str(match.player_o_id)):
        raise HTTPException(status_code=403, detail="You're not a player in this match.")

    state = _personalize(_match_response(match), user)
    # names + timer for the match screen
    from datetime import datetime, timezone
    from app.models.models import User as _U
    def _nm(u):
        return (u.full_name or u.telegram_username or "Player") if u else "Player"
    x = db.query(_U).filter(_U.internal_id == match.player_x_id).first()
    o = db.query(_U).filter(_U.internal_id == match.player_o_id).first()
    me_is_x = state["you_are"] == "X"
    state["you_name"] = _nm(x if me_is_x else o)
    state["opponent_name"] = _nm(o if me_is_x else x)
    state["opponent_id"] = str(match.player_o_id if me_is_x else match.player_x_id)
    state["fee"] = str(match.platform_fee)
    state["timeout_seconds"] = match.move_timeout_seconds
    if match.status == "active" and match.last_move_at:
        elapsed = (datetime.now(timezone.utc) - match.last_move_at).total_seconds()
        state["seconds_left"] = max(0, int(match.move_timeout_seconds - elapsed))
    return state


@router.post("/matches/{match_id}/move-webapp")
@limiter.limit("30/minute")
def make_move_webapp(
    request: Request, match_id: str, payload: WebAppMoveRequest, db: Session = Depends(get_db),
    x_telegram_init_data: str = Header(None),
):
    user = _get_webapp_user(db, x_telegram_init_data)

    try:
        state = match_service.make_move(
            db,
            match_id=uuid.UUID(match_id),
            player_id=user.internal_id,
            cell_position=payload.cell_position,
            idempotency_key=payload.idempotency_key,
        )
    except match_service.InvalidMoveError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except match_service.MatchNotActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _personalize(state, user)
    return state


@router.post("/matches/{match_id}/checkers-move-webapp")
@limiter.limit("30/minute")
def make_checkers_move_webapp(
    request: Request, match_id: str, payload: WebAppCheckersMoveRequest, db: Session = Depends(get_db),
    x_telegram_init_data: str = Header(None),
):
    user = _get_webapp_user(db, x_telegram_init_data)

    try:
        state = checkers_service.make_move(
            db,
            match_id=uuid.UUID(match_id),
            player_id=user.internal_id,
            from_position=payload.from_position,
            to_position=payload.to_position,
            idempotency_key=payload.idempotency_key,
        )
    except checkers_service.InvalidMoveError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except checkers_service.MatchNotActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    _personalize(state, user)
    return state
