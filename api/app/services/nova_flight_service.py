"""
services/nova_flight_service.py — Nova Flight (crash-style game, VIRTUAL POINTS ONLY).

 - Never touches the ETB wallet. Points cannot be withdrawn or converted to money.
 - The server owns the clock: one shared round at a time, crash point drawn with
   `secrets` BEFORE the round starts and never sent to clients until the flight ends.
 - Multiplier is a pure function of elapsed time: m(t) = e^(GROWTH * t).
 - Cash-out is validated against the official round state (row locks, one bet per
   round, cashout only once, never after the crash).
"""
import math
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

GROWTH = 0.11            # per second
COUNTDOWN = 8            # seconds of betting before take-off
END_PAUSE = 4            # seconds the crash is shown
EDGE = 0.08              # P(crash >= x) = (1-EDGE)/x   (shown to players)
MAX_CRASH = Decimal("100.00")
START_POINTS = Decimal("1000")
MIN_BET = Decimal("1")
MAX_BET = Decimal("1000")
LOCK_KEY = 740011


class FlightError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mult_at(t: float) -> Decimal:
    if t <= 0:
        return Decimal("1.00")
    return (Decimal(str(math.exp(GROWTH * t))) * 100).to_integral_value(rounding=ROUND_DOWN) / 100


def _new_crash() -> Decimal:
    u = secrets.randbelow(10 ** 9) / 10 ** 9
    c = (1 - EDGE) / (1 - u)
    c = max(1.0, min(float(MAX_CRASH), c))
    return (Decimal(str(c)) * 100).to_integral_value(rounding=ROUND_DOWN) / 100


def _ensure_round(db: Session, now: datetime):
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LOCK_KEY})
    row = db.execute(text(
        "SELECT id, crash_point, start_at, crash_at, end_at FROM nova_flight_rounds ORDER BY id DESC LIMIT 1")).first()
    if row is None or now >= row.end_at:
        c = _new_crash()
        start = now + timedelta(seconds=COUNTDOWN)
        crash_at = start + timedelta(seconds=math.log(float(c)) / GROWTH)
        end_at = crash_at + timedelta(seconds=END_PAUSE)
        row = db.execute(text(
            "INSERT INTO nova_flight_rounds (crash_point, start_at, crash_at, end_at) "
            "VALUES (:c, :s, :ca, :e) RETURNING id, crash_point, start_at, crash_at, end_at"),
            {"c": c, "s": start, "ca": crash_at, "e": end_at}).first()
    return row


def _points(db: Session, user_id, lock=False) -> Decimal:
    db.execute(text("INSERT INTO nova_flight_points (user_id, balance) VALUES (:u, :b) ON CONFLICT (user_id) DO NOTHING"),
               {"u": user_id, "b": START_POINTS})
    q = "SELECT balance FROM nova_flight_points WHERE user_id = :u" + (" FOR UPDATE" if lock else "")
    return Decimal(db.execute(text(q), {"u": user_id}).scalar())


def _phase(row, now):
    if now < row.start_at:
        return "countdown"
    if now < row.crash_at:
        return "flying"
    return "ended"


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def state(db: Session, user_id) -> dict:
    now = _now()
    row = _ensure_round(db, now)
    bal = _points(db, user_id)
    bet = db.execute(text("SELECT amount, cashout_multiplier, payout FROM nova_flight_bets WHERE round_id=:r AND user_id=:u"),
                     {"r": row.id, "u": user_id}).first()
    hist = db.execute(text("SELECT id, crash_point FROM nova_flight_rounds WHERE crash_at <= :n ORDER BY id DESC LIMIT 30"),
                      {"n": now}).all()
    db.commit()
    ph = _phase(row, now)
    out = {
        "server_ms": _ms(now), "growth": GROWTH, "edge_percent": int(EDGE * 100),
        "balance": str(bal), "min_bet": str(MIN_BET), "max_bet": str(MAX_BET),
        "round": {"id": row.id, "phase": ph, "start_ms": _ms(row.start_at), "end_ms": _ms(row.end_at)},
        "history": [{"id": h.id, "crash": str(h.crash_point)} for h in hist],
        "bet": None,
    }
    if ph == "flying":
        out["round"]["multiplier"] = str(min(mult_at((now - row.start_at).total_seconds()), row.crash_point))
    if ph == "ended":
        out["round"]["crash"] = str(row.crash_point)
    if bet:
        out["bet"] = {"amount": str(bet.amount),
                      "cashout_multiplier": str(bet.cashout_multiplier) if bet.cashout_multiplier is not None else None,
                      "payout": str(bet.payout) if bet.payout is not None else None}
    return out


def place_bet(db: Session, user_id, amount) -> dict:
    try:
        amt = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    except (InvalidOperation, ValueError):
        raise FlightError("Enter a valid amount.")
    if amt < MIN_BET or amt > MAX_BET:
        raise FlightError(f"Entry must be between {MIN_BET} and {MAX_BET} points.")
    now = _now()
    bal = _points(db, user_id, lock=True)
    row = _ensure_round(db, now)
    if _phase(row, now) != "countdown":
        raise FlightError("Entries are closed. Wait for the next round.")
    if bal < amt:
        raise FlightError("Not enough virtual points.")
    ex = db.execute(text("SELECT 1 FROM nova_flight_bets WHERE round_id=:r AND user_id=:u"), {"r": row.id, "u": user_id}).first()
    if ex:
        raise FlightError("You already joined this round.")
    db.execute(text("UPDATE nova_flight_points SET balance = balance - :a, updated_at = now() WHERE user_id = :u"),
               {"a": amt, "u": user_id})
    db.execute(text("INSERT INTO nova_flight_bets (round_id, user_id, amount) VALUES (:r, :u, :a)"),
               {"r": row.id, "u": user_id, "a": amt})
    db.commit()
    return state(db, user_id)


def cash_out(db: Session, user_id) -> dict:
    now = _now()
    _points(db, user_id, lock=True)
    row = _ensure_round(db, now)
    bet = db.execute(text(
        "SELECT id, amount, cashout_multiplier FROM nova_flight_bets WHERE round_id=:r AND user_id=:u FOR UPDATE"),
        {"r": row.id, "u": user_id}).first()
    if not bet:
        raise FlightError("You have no entry in this round.")
    if bet.cashout_multiplier is not None:
        raise FlightError("Already collected.")
    ph = _phase(row, now)
    if ph == "countdown":
        raise FlightError("The flight has not started yet.")
    if ph == "ended":
        raise FlightError("Too late — the flight already ended.")
    m = min(mult_at((now - row.start_at).total_seconds()), row.crash_point)
    payout = (bet.amount * m).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    db.execute(text("UPDATE nova_flight_bets SET cashout_multiplier=:m, payout=:p WHERE id=:i"),
               {"m": m, "p": payout, "i": bet.id})
    db.execute(text("UPDATE nova_flight_points SET balance = balance + :p, updated_at = now() WHERE user_id=:u"),
               {"p": payout, "u": user_id})
    db.commit()
    return state(db, user_id)


def refill(db: Session, user_id) -> dict:
    bal = _points(db, user_id, lock=True)
    if bal >= Decimal("10"):
        raise FlightError("You still have enough points to play.")
    db.execute(text("UPDATE nova_flight_points SET balance = :b, updated_at = now() WHERE user_id=:u"),
               {"b": START_POINTS, "u": user_id})
    db.commit()
    return state(db, user_id)
