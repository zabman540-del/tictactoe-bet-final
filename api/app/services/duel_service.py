"""
duel_service.py — 1v1 rooms for Chess, Archery, Car Race and Pool.

Same money rules as Rock Paper Scissors:
  * both stake the same amount (5-500 ETB), locked when the challenge is made / joined
  * winner gets 2 x stake minus the fee (1 / 2 / 3 ETB tiers); draw = both refunded, no fee
  * nobody joins within 10 minutes -> expired, stake refunded
Every rule is enforced on the server; the app only draws what the server says.
Sides: "c" = creator, "o" = opponent.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.models import DuelGame, User
from app.services import wallet_service
from app.services import duel_chess as chess
from app.services import duel_games as dg
from app.services import duel_pool as pool
from app.services.wallet_service import InsufficientBalanceError
from app.services.rps_service import fee_for, MIN_STAKE, MAX_STAKE, OPEN_MINUTES

GAMES = ("chess", "archery", "race", "pool")
CHESS_SECONDS = 90
POOL_SECONDS = 60
RACE_READY_SECONDS = 60
ARCHERY_FIRST_DELAY = 8.0
ARCHERY_NEXT_DELAY = 2.8
RACE_COUNTDOWN = 5.0


class DuelError(Exception):
    pass


def _now():
    return datetime.now(timezone.utc)


def _iso(d):
    return d.isoformat() if d else None


def _parse(s):
    return datetime.fromisoformat(s) if s else None


def rules() -> dict:
    return {"min_stake": str(MIN_STAKE), "max_stake": str(MAX_STAKE), "open_minutes": OPEN_MINUTES,
            "chess_seconds": CHESS_SECONDS, "pool_seconds": POOL_SECONDS,
            "arrows_each": dg.ARROWS_EACH, "race_penalty": dg.CRASH_PENALTY, "race_base": round(dg.BASE_TIME, 1)}


def _name(db, uid):
    if not uid:
        return None
    u = db.query(User).filter(User.internal_id == uid).first()
    return (u.full_name or u.telegram_username or str(u.telegram_user_id)) if u else None


def _side(g, uid):
    return "c" if g.creator_id == uid else ("o" if g.opponent_id == uid else None)


def _uid(g, side):
    return g.creator_id if side == "c" else g.opponent_id


def _lock_game(db, game_id) -> DuelGame:
    try:
        gid = uuid.UUID(str(game_id))
    except ValueError:
        raise DuelError("Game not found.")
    g = db.query(DuelGame).filter(DuelGame.id == gid).with_for_update().first()
    if not g:
        raise DuelError("Game not found.")
    return g


# ---------------------------------------------------------------- settlement
def _win(db, g, side, reason):
    win_id, lose_id = _uid(g, side), _uid(g, "o" if side == "c" else "c")
    fee = fee_for(g.stake_amount)
    g.status, g.winner_id, g.result_reason = "completed", win_id, reason
    g.platform_fee, g.payout_amount, g.settled_at, g.deadline = fee, g.stake_amount * 2 - fee, _now(), None
    db.flush()
    wallet_service.settle_match_win(db, win_id, lose_id, g.stake_amount, fee, g.id)   # commits


def _draw(db, g, reason):
    g.status, g.result_reason, g.settled_at, g.payout_amount, g.deadline = "draw", reason, _now(), Decimal("0"), None
    db.flush()
    wallet_service.settle_match_draw(db, g.creator_id, g.opponent_id, g.stake_amount, g.id)   # commits


# ---------------------------------------------------------------- game setup
def _start_state(game):
    now = _now()
    if game == "chess":
        return {"chess": chess.initial_state(), "last": None, "turn": "c"}, now + timedelta(seconds=CHESS_SECONDS + 10)
    if game == "pool":
        return ({"balls": pool.rack(), "groups": {"c": None, "o": None}, "turn": "c", "in_hand": None,
                 "shot_no": 0, "anim": None, "last": None, "timeouts": {"c": 0, "o": 0}},
                now + timedelta(seconds=POOL_SECONDS + 10))
    if game == "archery":
        start = now + timedelta(seconds=ARCHERY_FIRST_DELAY)
        cur = dg.new_arrow()
        cur["start_at"] = _iso(start)
        return ({"idx": 0, "totals": {"c": 0, "o": 0}, "arrows": [], "cur": cur, "misses": {"c": 0, "o": 0}},
                start + timedelta(seconds=dg.SHOT_SECONDS))
    # race
    return ({"phase": "ready", "ready": {"c": False, "o": False}, "seed": None, "track": None, "start_at": None,
             "results": {"c": None, "o": None}}, now + timedelta(seconds=RACE_READY_SECONDS))


# ---------------------------------------------------------------- timeouts
def _timeout_chess(db, g):
    s = g.state
    mover = s["turn"]
    _win(db, g, "o" if mover == "c" else "c", "timeout")


def _timeout_pool(db, g):
    s = dict(g.state)
    side = s["turn"]
    other = "o" if side == "c" else "c"
    to = dict(s["timeouts"])
    to[side] += 1
    if to[side] >= 2:
        _win(db, g, other, "timeout")
        return
    s.update({"timeouts": to, "turn": other, "in_hand": other, "anim": None,
              "last": {"by": side, "foul": True, "why": "timeout", "potted": []}})
    s["shot_no"] += 1
    g.state = s
    g.deadline = _now() + timedelta(seconds=POOL_SECONDS + 5)
    db.commit()


def _timeout_archery(db, g):
    s = dict(g.state)
    side = "c" if s["idx"] % 2 == 0 else "o"
    arrows = list(s["arrows"]) + [{"p": side, "score": 0, "x": None, "y": None, "timeout": True,
                                   "wx": s["cur"]["wx"], "wy": s["cur"]["wy"]}]
    misses = dict(s["misses"])
    misses[side] += 1
    s["arrows"], s["misses"], s["idx"] = arrows, misses, s["idx"] + 1
    if misses[side] >= 3:
        g.state = s
        _win(db, g, "o" if side == "c" else "c", "timeout")
        return
    _next_arrow(db, g, s)


def _next_arrow(db, g, s):
    """After an arrow resolved: finish the game or open the next arrow."""
    if dg.archery_total_arrows(s["idx"], s["totals"]):
        g.state = s
        if s["totals"]["c"] == s["totals"]["o"]:
            _draw(db, g, "tie")
        else:
            _win(db, g, "c" if s["totals"]["c"] > s["totals"]["o"] else "o", "score")
        return
    start = _now() + timedelta(seconds=ARCHERY_NEXT_DELAY)
    cur = dg.new_arrow()
    cur["start_at"] = _iso(start)
    s["cur"] = cur
    g.state = s
    g.deadline = start + timedelta(seconds=dg.SHOT_SECONDS)
    db.commit()


def _timeout_race(db, g):
    s = g.state
    if s["phase"] == "ready":
        r = s["ready"]
        if r["c"] and not r["o"]:
            _win(db, g, "c", "forfeit")
        elif r["o"] and not r["c"]:
            _win(db, g, "o", "forfeit")
        else:
            _draw(db, g, "no_show")
        return
    res = s["results"]
    if res["c"] and not res["o"]:
        _win(db, g, "c", "forfeit")
    elif res["o"] and not res["c"]:
        _win(db, g, "o", "forfeit")
    else:
        _draw(db, g, "no_show")


def _apply_timeouts(db, g) -> bool:
    """Call with g locked. True if it changed (and committed)."""
    now = _now()
    changed = False
    if g.status == "open" and g.expires_at <= now:
        g.status, g.result_reason, g.settled_at = "expired", "expired", now
        db.flush()
        wallet_service.release_single_stake(db, g.creator_id, g.stake_amount, g.id, "duel_expired")   # commits
        return True
    for _ in range(30):                      # archery can owe several missed arrows
        if g.status != "playing" or not g.deadline or g.deadline > now:
            break
        {"chess": _timeout_chess, "pool": _timeout_pool, "archery": _timeout_archery, "race": _timeout_race}[g.game](db, g)
        changed = True
    return changed


# ---------------------------------------------------------------- lifecycle
def create(db: Session, user: User, game: str, stake, invited_id=None) -> DuelGame:
    if game not in GAMES:
        raise DuelError("Unknown game.")
    try:
        stake = Decimal(str(stake))
    except Exception:
        raise DuelError("Invalid stake.")
    if stake != stake.quantize(Decimal("0.01")) or stake < MIN_STAKE or stake > MAX_STAKE:
        raise DuelError(f"Stake must be between {MIN_STAKE} and {MAX_STAKE} ETB.")
    g = DuelGame(id=uuid.uuid4(), game=game, creator_id=user.internal_id, invited_id=invited_id, stake_amount=stake,
                 status="open", state={}, expires_at=_now() + timedelta(minutes=OPEN_MINUTES))
    db.add(g)
    db.flush()
    try:
        wallet_service.lock_stake(db, user.internal_id, stake, g.id)
    except InsufficientBalanceError:
        db.rollback()
        raise DuelError("Not enough balance for this stake.")
    return g


def join(db: Session, user: User, game_id) -> DuelGame:
    g = _lock_game(db, game_id)
    if _apply_timeouts(db, g):
        raise DuelError("This challenge has expired.")
    if g.status != "open":
        db.rollback()
        raise DuelError("This challenge is no longer open.")
    if g.creator_id == user.internal_id:
        db.rollback()
        raise DuelError("You can't join your own challenge.")
    if g.invited_id and g.invited_id != user.internal_id:
        db.rollback()
        raise DuelError("This challenge is for another player.")
    g.opponent_id, g.status, g.joined_at = user.internal_id, "playing", _now()
    g.state, g.deadline = _start_state(g.game)
    db.flush()
    try:
        wallet_service.lock_stake(db, user.internal_id, g.stake_amount, g.id)
    except InsufficientBalanceError:
        db.rollback()
        raise DuelError("Not enough balance for this stake.")
    return g


def cancel(db: Session, user: User, game_id) -> DuelGame:
    g = _lock_game(db, game_id)
    if g.creator_id != user.internal_id:
        db.rollback()
        raise DuelError("Only the creator can cancel.")
    if g.status != "open":
        db.rollback()
        raise DuelError("Too late to cancel; the game already started.")
    g.status, g.result_reason, g.settled_at = "cancelled", "cancelled", _now()
    db.flush()
    wallet_service.release_single_stake(db, g.creator_id, g.stake_amount, g.id, "duel_cancelled")
    return g


def resign(db: Session, user: User, game_id) -> DuelGame:
    g = _lock_game(db, game_id)
    side = _side(g, user.internal_id)
    if not side:
        db.rollback()
        raise DuelError("You are not in this game.")
    if _apply_timeouts(db, g):
        return g
    if g.status != "playing":
        db.rollback()
        raise DuelError("This game is not active.")
    if g.game in ("archery", "race"):
        db.rollback()
        raise DuelError("You can't resign this game.")
    _win(db, g, "o" if side == "c" else "c", "resign")
    return g


# ---------------------------------------------------------------- moves
def move(db: Session, user: User, game_id, data: dict) -> DuelGame:
    g = _lock_game(db, game_id)
    side = _side(g, user.internal_id)
    if not side:
        db.rollback()
        raise DuelError("You are not in this game.")
    if _apply_timeouts(db, g):
        return g
    if g.status != "playing":
        db.rollback()
        raise DuelError("This game is not active.")
    try:
        {"chess": _move_chess, "pool": _move_pool, "archery": _move_archery, "race": _move_race}[g.game](db, g, side, data or {})
    except DuelError:
        db.rollback()
        raise
    except ValueError as e:
        db.rollback()
        raise DuelError(str(e))
    return g


def _move_chess(db, g, side, d):
    s = dict(g.state)
    if s["turn"] != side:
        raise DuelError("It's not your turn.")
    try:
        fr, to = int(d["from"]), int(d["to"])
        if not (0 <= fr < 64 and 0 <= to < 64):
            raise ValueError
    except Exception:
        raise DuelError("Bad move.")
    p = s["chess"]["board"][fr]
    if p == "." or p.isupper() != (side == "c"):
        raise DuelError("That's not your piece.")
    try:
        ns = chess.apply(s["chess"], fr, to, str(d.get("promo") or ""))
    except ValueError:
        raise DuelError("Illegal move.")
    ns["keys"] = ns["keys"][-120:]
    s["chess"], s["last"] = ns, [fr, to]
    s["turn"] = "o" if side == "c" else "c"
    st = chess.status(ns)
    g.state = s
    if st == "checkmate":
        _win(db, g, side, "checkmate")
    elif st != "ongoing":
        _draw(db, g, st)
    else:
        g.deadline = _now() + timedelta(seconds=CHESS_SECONDS)
        db.commit()


def _move_pool(db, g, side, d):
    s = dict(g.state)
    if s["turn"] != side:
        raise DuelError("It's not your turn.")
    try:
        angle, power = float(d["angle"]), float(d["power"])
    except Exception:
        raise DuelError("Bad shot.")
    place = d.get("place")
    r = pool.take_shot(s, side, angle, power, place)
    s["shot_no"] += 1
    s["balls"], s["groups"] = r["balls"], r["groups"]
    s["in_hand"], s["turn"] = r["in_hand"], r["next_turn"]
    s["timeouts"] = {"c": 0, "o": 0}
    s["anim"] = {"no": s["shot_no"], "frames": r["frames"]}
    s["last"] = {"by": side, "foul": r["foul"], "why": r["why"], "potted": r["potted"], "first_hit": r["first_hit"]}
    g.state = s
    if r["ended"]:
        _win(db, g, r["ended"], r["reason"])
    else:
        g.deadline = _now() + timedelta(seconds=POOL_SECONDS + len(r["frames"]) / 24.0 + 2)
        db.commit()


def _move_archery(db, g, side, d):
    s = dict(g.state)
    turn = "c" if s["idx"] % 2 == 0 else "o"
    if turn != side:
        raise DuelError("It's not your turn.")
    t = (_now() - _parse(s["cur"]["start_at"])).total_seconds()
    if t < 0:
        raise DuelError("Wait for the crosshair to start.")
    x, y, score = dg.shoot(s["cur"], t)
    arrow = {"p": side, "score": score, "x": x, "y": y, "wx": s["cur"]["wx"], "wy": s["cur"]["wy"]}
    totals, misses = dict(s["totals"]), dict(s["misses"])
    totals[side] += score
    misses[side] = 0
    s.update({"arrows": list(s["arrows"]) + [arrow], "totals": totals, "misses": misses, "idx": s["idx"] + 1})
    _next_arrow(db, g, s)


def _move_race(db, g, side, d):
    s = dict(g.state)
    now = _now()
    if s["phase"] == "ready":
        if not d.get("ready"):
            raise DuelError("Press READY first.")
        ready = dict(s["ready"])
        ready[side] = True
        s["ready"] = ready
        if ready["c"] and ready["o"]:
            seed = secrets.token_hex(8)
            start = now + timedelta(seconds=RACE_COUNTDOWN)
            s.update({"phase": "racing", "seed": seed, "track": dg.make_track(seed), "start_at": _iso(start)})
            g.deadline = start + timedelta(seconds=dg.BASE_TIME + 20)
        g.state = s
        db.commit()
        return
    # racing: submit steering log
    res = dict(s["results"])
    if res[side]:
        raise DuelError("You already finished.")
    start = _parse(s["start_at"])
    if (now - start).total_seconds() < dg.BASE_TIME * 0.92:
        raise DuelError("The race isn't over yet.")
    log = dg.validate_log(d.get("log") or [])
    r = dg.race_time(s["track"], log)
    res[side] = {"time": r["time"], "crashes": r["crashes"], "hit": r["hit"], "log": log}
    s["results"] = res
    g.state = s
    if res["c"] and res["o"]:
        tc, to = res["c"]["time"], res["o"]["time"]
        if abs(tc - to) < 0.001:
            _draw(db, g, "same_time")
        else:
            _win(db, g, "c" if tc < to else "o", "time")
    else:
        db.commit()


# ---------------------------------------------------------------- public state
def public_state(db: Session, g: DuelGame, user_id) -> dict:
    side = _side(g, user_id) or "viewer"
    done = g.status in ("completed", "draw")
    out = {
        "game_id": str(g.id), "game": g.game, "status": g.status, "stake": str(g.stake_amount),
        "fee": str(fee_for(g.stake_amount)), "you_are": side,
        "creator_name": _name(db, g.creator_id), "opponent_name": _name(db, g.opponent_id),
        "opponent_id": str((g.opponent_id if side == "c" else g.creator_id) or "") or None,
        "deadline": _iso(g.deadline), "expires_at": _iso(g.expires_at), "server_now": _iso(_now()),
    }
    if g.status in ("completed", "draw", "cancelled", "expired"):
        out["you_won"] = (g.winner_id == user_id) if g.winner_id else None
        out["payout"] = str(g.payout_amount or 0)
        out["reason"] = g.result_reason
    if g.status in ("playing",) or done:
        s = g.state or {}
        out["g"] = _game_view(g, s, side, done)
    return out


def _game_view(g, s, side, done):
    if g.game == "chess":
        cs = s["chess"]
        mine = s["turn"] == side and not done
        return {"board": cs["board"], "turn": s["turn"], "last": s["last"], "color": "w" if side == "c" else "b",
                "check": (not done) and chess.in_check(cs),
                "legal": ({str(k): v for k, v in chess.moves_by_square(cs).items()} if mine else {}),
                "half": cs["half"], "full": cs["full"]}
    if g.game == "pool":
        o = "o" if side == "c" else "c"
        grp = s["groups"]
        return {"balls": s["balls"], "turn": s["turn"], "in_hand": s["in_hand"], "shot_no": s["shot_no"],
                "my_group": grp.get(side), "opp_group": grp.get(o), "last": s["last"],
                "anim_frames": len(s["anim"]["frames"]) if s.get("anim") else 0}
    if g.game == "archery":
        cur = s["cur"]
        return {"idx": s["idx"], "totals": s["totals"], "arrows": s["arrows"], "turn": "c" if s["idx"] % 2 == 0 else "o",
                "cur": (None if done else cur), "arrows_each": dg.ARROWS_EACH,
                "aim_delay": dg.AIM_DELAY, "shot_seconds": dg.SHOT_SECONDS}
    # race
    other = "o" if side == "c" else "c"
    res = s["results"]
    out = {"phase": s["phase"], "ready": s["ready"], "start_at": s["start_at"], "track": s["track"],
           "length": dg.TRACK_LEN, "speed": dg.SPEED, "penalty": dg.CRASH_PENALTY, "base": dg.BASE_TIME,
           "my_result": ({"time": res[side]["time"], "crashes": res[side]["crashes"]} if side in res and res[side] else None),
           "opp_done": bool(res.get(other)) if side != "viewer" else False}
    if done:
        out["results"] = {k: ({"time": v["time"], "crashes": v["crashes"]} if v else None) for k, v in res.items()}
    return out


def get_anim(db: Session, user: User, game_id, no: int) -> dict:
    g = db.query(DuelGame).filter(DuelGame.id == uuid.UUID(str(game_id))).first()
    if not g or g.game != "pool" or not _side(g, user.internal_id):
        raise DuelError("Not found.")
    a = (g.state or {}).get("anim")
    if not a or a.get("no") != no:
        return {"no": no, "frames": []}
    return a


def get_state(db: Session, user: User, game_id) -> dict:
    g = _lock_game(db, game_id)
    if not _apply_timeouts(db, g):
        db.rollback()
    db.refresh(g)
    return public_state(db, g, user.internal_id)


def lobby(db: Session, user: User, game=None) -> dict:
    now = _now()
    q = db.query(DuelGame).filter(DuelGame.status == "open", DuelGame.expires_at > now,
                                  DuelGame.creator_id != user.internal_id)
    if game:
        q = q.filter(DuelGame.game == game)
    rows = [g for g in q.order_by(DuelGame.created_at.desc()).limit(30).all()
            if not g.invited_id or g.invited_id == user.internal_id]
    mine = (db.query(DuelGame).filter(DuelGame.status.in_(["open", "playing"]),
                                      (DuelGame.creator_id == user.internal_id) | (DuelGame.opponent_id == user.internal_id))
            .order_by(DuelGame.created_at.desc()).first())
    return {"open": [{"game_id": str(g.id), "game": g.game, "creator_name": _name(db, g.creator_id),
                      "stake": str(g.stake_amount), "private": bool(g.invited_id)} for g in rows],
            "mine": str(mine.id) if mine else None}


def sweep_timeouts(db: Session):
    now = _now()
    ids = [r[0] for r in db.query(DuelGame.id).filter(
        ((DuelGame.status == "open") & (DuelGame.expires_at <= now)) |
        ((DuelGame.status == "playing") & (DuelGame.deadline <= now))).all()]
    for gid in ids:
        g = _lock_game(db, gid)
        if not _apply_timeouts(db, g):
            db.rollback()
