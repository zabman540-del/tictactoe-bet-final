"""
services/nova_flight_service.py — Nova Flight (crash game, real ETB, provably fair).

FAIRNESS
 - Each round has a secret server_seed. Its SHA-256 (seed_hash) is published BEFORE take-off.
 - crash = floor( 96 * 2^52 / (2^52 - e) ) / 100, clamped to [1.00, 100.00],
   where e = first 52 bits of HMAC_SHA256(key = server_seed, msg = "nova-flight").
   => P(crash >= x) = 0.96 / x   (4% house edge, same for everyone, no player can change it)
 - After the crash the seed is revealed so anyone can re-compute the result.
MONEY
 - Bet is debited at join, payout credited at cash-out, through the wallet ledger
   (house_bet / house_payout) with unique idempotency keys -> a retry can never pay twice.
 - One global advisory lock serialises flight operations; lock order is always
   advisory lock -> wallet row.
 - Auto cash-out is enforced by the server (no latency unfairness).
"""
import hashlib
import hmac
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_DOWN, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.models import Wallet
from app.services.wallet_service import _get_locked_wallet, _write_ledger_row

GROWTH = 0.11                    # multiplier = e^(GROWTH * seconds)
COUNTDOWN = 8                    # betting window, seconds
END_PAUSE = 4                    # crash shown, seconds
EDGE_PERCENT = 4                 # shown to players
E52 = 2 ** 52
MIN_BET = Decimal("1")
MAX_BET = Decimal("500")
MAX_PAYOUT = Decimal("2000")     # per bet; bet auto-collects when this is reached
MAX_AUTO = Decimal("100")
LOCK_KEY = 740011


class FlightError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_DOWN)


def mult_at(t: float) -> Decimal:
    if t <= 0:
        return Decimal("1.00")
    return _q2(Decimal(str(math.exp(GROWTH * t))))


def crash_from_seed(seed_hex: str) -> Decimal:
    h = hmac.new(bytes.fromhex(seed_hex), b"nova-flight", hashlib.sha256).hexdigest()
    e = int(h[:13], 16)                                   # 52 bits
    cents = (100 - EDGE_PERCENT) * E52 // (E52 - e)
    cents = max(100, min(int(MAX_AUTO) * 100, cents))
    return Decimal(cents) / 100


def _ensure_round(db: Session, now: datetime):
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LOCK_KEY})
    row = db.execute(text(
        "SELECT id, crash_point, start_at, crash_at, end_at, seed_hash, server_seed "
        "FROM nova_flight_rounds ORDER BY id DESC LIMIT 1")).first()
    if row is None or now >= row.end_at:
        seed = secrets.token_hex(32)
        shash = hashlib.sha256(bytes.fromhex(seed)).hexdigest()
        c = crash_from_seed(seed)
        start = now + timedelta(seconds=COUNTDOWN)
        crash_at = start + timedelta(seconds=math.log(float(c)) / GROWTH)
        end_at = crash_at + timedelta(seconds=END_PAUSE)
        row = db.execute(text(
            "INSERT INTO nova_flight_rounds (crash_point, start_at, crash_at, end_at, server_seed, seed_hash) "
            "VALUES (:c, :s, :ca, :e, :sd, :sh) "
            "RETURNING id, crash_point, start_at, crash_at, end_at, seed_hash, server_seed"),
            {"c": c, "s": start, "ca": crash_at, "e": end_at, "sd": seed, "sh": shash}).first()
    return row


def _pay(db: Session, bet, mult: Decimal):
    """Settle one bet as a win at `mult`. Caller holds the advisory lock."""
    payout = _q2(min(bet.amount * mult, MAX_PAYOUT))
    db.execute(text("UPDATE nova_flight_bets SET cashout_multiplier=:m, payout=:p, settled=true WHERE id=:i"),
               {"m": mult, "p": payout, "i": bet.id})
    wallet = _get_locked_wallet(db, uuid.UUID(str(bet.user_id)))
    wallet.available_balance += payout
    db.flush()
    _write_ledger_row(db, wallet, "house_payout", payout, f"flight:{bet.id}:payout", "house_round",
                      uuid.UUID(str(bet.id)), "Nova Flight payout")


def _sweep(db: Session, now: datetime):
    """Settle auto cash-outs that are due and close out lost bets."""
    rows = db.execute(text(
        "SELECT b.id, b.user_id, b.amount, b.auto_cashout, r.crash_point, r.start_at, r.crash_at "
        "FROM nova_flight_bets b JOIN nova_flight_rounds r ON r.id = b.round_id WHERE NOT b.settled")).all()
    for b in rows:
        ended = now >= b.crash_at
        flying = (not ended) and now >= b.start_at
        if not (ended or flying):
            continue
        target = _q2(MAX_PAYOUT / b.amount)               # the payout cap acts like an auto cash-out
        if b.auto_cashout is not None:
            target = min(target, b.auto_cashout)
        cur = None if ended else min(mult_at((now - b.start_at).total_seconds()), b.crash_point)
        if target <= b.crash_point and (ended or target <= cur):
            _pay(db, b, target)
        elif ended:
            db.execute(text("UPDATE nova_flight_bets SET settled=true, payout=0 WHERE id=:i"), {"i": b.id})


def _phase(row, now):
    if now < row.start_at:
        return "countdown"
    if now < row.crash_at:
        return "flying"
    return "ended"


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _balance(db: Session, user_id) -> Decimal:
    w = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    return w.available_balance if w else Decimal("0")


def _public(db: Session, user_id, row, now) -> dict:
    bet = db.execute(text(
        "SELECT amount, auto_cashout, cashout_multiplier, payout, settled FROM nova_flight_bets "
        "WHERE round_id=:r AND user_id=:u"), {"r": row.id, "u": user_id}).first()
    hist = db.execute(text(
        "SELECT id, crash_point, server_seed, seed_hash FROM nova_flight_rounds "
        "WHERE crash_at <= :n ORDER BY id DESC LIMIT 30"), {"n": now}).all()
    ph = _phase(row, now)
    out = {
        "server_ms": _ms(now), "growth": GROWTH, "edge_percent": EDGE_PERCENT,
        "balance": str(_balance(db, user_id)),
        "min_bet": str(MIN_BET), "max_bet": str(MAX_BET), "max_payout": str(MAX_PAYOUT),
        "round": {"id": row.id, "phase": ph, "start_ms": _ms(row.start_at), "end_ms": _ms(row.end_at),
                  "seed_hash": row.seed_hash},
        "history": [{"id": h.id, "crash": str(h.crash_point), "seed": h.server_seed, "seed_hash": h.seed_hash}
                    for h in hist],
        "bet": None,
    }
    if ph == "flying":
        out["round"]["multiplier"] = str(min(mult_at((now - row.start_at).total_seconds()), row.crash_point))
    if ph == "ended":
        out["round"]["crash"] = str(row.crash_point)
        out["round"]["seed"] = row.server_seed
    if bet:
        out["bet"] = {
            "amount": str(bet.amount),
            "auto_cashout": str(bet.auto_cashout) if bet.auto_cashout is not None else None,
            "cashout_multiplier": str(bet.cashout_multiplier) if bet.cashout_multiplier is not None else None,
            "payout": str(bet.payout) if bet.payout is not None else None,
        }
    return out


def state(db: Session, user_id) -> dict:
    now = _now()
    row = _ensure_round(db, now)
    _sweep(db, now)
    out = _public(db, user_id, row, now)
    db.commit()
    return out


def place_bet(db: Session, user_id, amount, auto_cashout=None) -> dict:
    try:
        amt = _q2(Decimal(str(amount)))
    except (InvalidOperation, ValueError):
        raise FlightError("Enter a valid amount.")
    if amt < MIN_BET or amt > MAX_BET:
        raise FlightError(f"Bet must be between {MIN_BET} and {MAX_BET} ETB.")
    auto = None
    if auto_cashout not in (None, ""):
        try:
            auto = _q2(Decimal(str(auto_cashout)))
        except (InvalidOperation, ValueError):
            raise FlightError("Invalid auto cash-out value.")
        if auto < Decimal("1.01") or auto > MAX_AUTO:
            raise FlightError("Auto cash-out must be between 1.01x and 100x.")
    now = _now()
    row = _ensure_round(db, now)
    _sweep(db, now)
    if _phase(row, now) != "countdown":
        raise FlightError("Betting is closed. Wait for the next round.")
    if db.execute(text("SELECT 1 FROM nova_flight_bets WHERE round_id=:r AND user_id=:u"),
                  {"r": row.id, "u": user_id}).first():
        raise FlightError("You already joined this round.")
    wallet = _get_locked_wallet(db, user_id)
    if wallet.available_balance < amt:
        raise FlightError("Not enough balance.")
    bet_id = uuid.uuid4()
    wallet.available_balance -= amt
    db.execute(text(
        "INSERT INTO nova_flight_bets (id, round_id, user_id, amount, auto_cashout) VALUES (:i,:r,:u,:a,:ac)"),
        {"i": bet_id, "r": row.id, "u": user_id, "a": amt, "ac": auto})
    db.flush()
    _write_ledger_row(db, wallet, "house_bet", -amt, f"flight:{bet_id}:bet", "house_round", bet_id, "Nova Flight bet")
    out = _public(db, user_id, row, now)
    db.commit()
    return out


def cash_out(db: Session, user_id) -> dict:
    now = _now()
    row = _ensure_round(db, now)
    _sweep(db, now)
    bet = db.execute(text(
        "SELECT id, user_id, amount, settled FROM nova_flight_bets WHERE round_id=:r AND user_id=:u"),
        {"r": row.id, "u": user_id}).first()
    if not bet:
        raise FlightError("You have no bet in this round.")
    if bet.settled:
        raise FlightError("This bet is already settled.")
    ph = _phase(row, now)
    if ph == "countdown":
        raise FlightError("The flight has not started yet.")
    if ph == "ended":
        raise FlightError("Too late — the flight already ended.")
    m = min(mult_at((now - row.start_at).total_seconds()), row.crash_point)
    _pay(db, bet, m)
    out = _public(db, user_id, row, now)
    db.commit()
    return out
