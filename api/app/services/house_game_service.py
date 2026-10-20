"""
services/house_game_service.py

House-vs-player games: Mines and Dice.
 - Randomness: Python `secrets` (OS CSPRNG). Odds are the same for everyone.
 - Fair payout: multiplier = (1 - HOUSE_EDGE) / true_probability. Edge is disclosed in the UI.
 - Money: bet is debited at round start, payout credited at the end, all inside
   one DB transaction with the wallet row locked + unique idempotency keys,
   so a double-tap can never pay twice.
"""
import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN
from math import comb

from sqlalchemy.orm import Session

from app.models.models import GameRound
from app.services.wallet_service import _get_locked_wallet, _write_ledger_row

HOUSE_EDGE = Decimal("0.03")          # Dice edge, disclosed to players
MINES_EDGE = Decimal("0.15")          # Mines edge, disclosed to players
DICE_ENABLED = False                  # Dice is "coming soon"; set True to open it
MIN_BET = Decimal("1")
MAX_BET = Decimal("500")
MAX_PAYOUT = Decimal("2000")          # per-round cap; Mines auto cashes out when reached
GRID = 25
MINE_OPTIONS = [10]               # one mode only: 10 mines, 15 safe
DICE_MIN_CHANCE = 2                   # percent
DICE_MAX_CHANCE = 95


class GameError(Exception):
    pass


def _q2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_DOWN)


def _now():
    return datetime.now(timezone.utc)


def _check_bet(bet) -> Decimal:
    try:
        bet = Decimal(str(bet))
    except Exception:
        raise GameError("Invalid bet amount.")
    if bet != _q2(bet) or bet < MIN_BET or bet > MAX_BET:
        raise GameError(f"Bet must be between {MIN_BET} and {MAX_BET} ETB.")
    return bet


# ---------------- Mines math ----------------

MINES_FIXED = {1: Decimal("1.20"), 2: Decimal("1.50"), 3: Decimal("1.80"),
               4: Decimal("2.10"), 5: Decimal("2.40"), 6: Decimal("3.00")}   # fixed payout table, shown to players
MINES_MAX_PICKS = max(MINES_FIXED)                                   # auto cash-out at the last step


def mines_win_prob(mines: int, k: int) -> Decimal:
    return Decimal(comb(GRID - mines, k)) / Decimal(comb(GRID, k))


def mines_multiplier(mines: int, safe_picked: int) -> Decimal:
    if safe_picked <= 0:
        return Decimal("1")
    return MINES_FIXED[safe_picked]


def mines_table(mines: int) -> list:
    return [{"picks": k, "multiplier": str(m),
             "win_chance": str((mines_win_prob(mines, k) * 100).quantize(Decimal("0.1"))),
             "return_percent": str((mines_win_prob(mines, k) * m * 100).quantize(Decimal("0.1")))}
            for k, m in MINES_FIXED.items()]


def mines_rules() -> dict:
    return {
        "max_picks": MINES_MAX_PICKS,
        "min_bet": str(MIN_BET), "max_bet": str(MAX_BET), "max_payout": str(MAX_PAYOUT),
        "options": [{"mines": m, "safe": GRID - m, "table": mines_table(m)} for m in MINE_OPTIONS],
    }


def _mines_public(r: GameRound, reveal_all=False) -> dict:
    p = r.params
    out = {
        "round_id": str(r.id), "game": "mines", "status": r.status,
        "bet": str(r.bet_amount), "mines": p["mines"], "revealed": p["revealed"],
        "multiplier": str(r.multiplier), "payout": str(r.payout_amount),
        "potential_payout": str(_q2(min(r.bet_amount * r.multiplier, MAX_PAYOUT))),
    }
    nxt = len(p["revealed"]) + 1
    if r.status == "active" and nxt <= MINES_MAX_PICKS:
        out["next_multiplier"] = str(mines_multiplier(p["mines"], nxt))
    if r.status != "active":
        out["mine_positions"] = p["positions"]   # shown only after the round ends
    return out


def mines_start(db: Session, user_id, bet, mines: int) -> dict:
    bet = _check_bet(bet)
    if mines not in MINE_OPTIONS:
        raise GameError("Invalid mine count.")
    wallet = _get_locked_wallet(db, user_id)   # also serialises this user's requests
    active = (db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "mines",
                                         GameRound.status == "active").first())
    if active:
        db.rollback()
        raise GameError("You already have an active Mines round.")
    if wallet.available_balance < bet:
        db.rollback()
        raise GameError("Not enough balance.")
    positions = sorted(secrets.SystemRandom().sample(range(GRID), mines))
    rnd = GameRound(id=uuid.uuid4(), user_id=user_id, game="mines", bet_amount=bet, status="active",
                    params={"mines": mines, "positions": positions, "revealed": []}, multiplier=Decimal("0"))
    db.add(rnd)
    wallet.available_balance -= bet
    db.flush()
    _write_ledger_row(db, wallet, "house_bet", -bet, f"round:{rnd.id}:bet", "house_round", rnd.id, "Mines bet")
    db.commit()
    return _mines_public(rnd)


def _load_round_locked(db, user_id, round_id, game):
    try:
        round_id = uuid.UUID(str(round_id))
    except ValueError:
        raise GameError("Round not found.")
    r = (db.query(GameRound).filter(GameRound.id == round_id, GameRound.user_id == user_id,
                                    GameRound.game == game).with_for_update().first())
    if not r:
        raise GameError("Round not found.")
    return r


def _settle_payout(db, r: GameRound, status: str):
    payout = _q2(min(r.bet_amount * r.multiplier, MAX_PAYOUT))
    wallet = _get_locked_wallet(db, r.user_id)
    wallet.available_balance += payout
    r.status, r.payout_amount, r.settled_at = status, payout, _now()
    db.flush()
    _write_ledger_row(db, wallet, "house_payout", payout, f"round:{r.id}:payout", "house_round", r.id,
                      f"{r.game} payout")


def mines_reveal(db: Session, user_id, round_id, tile: int) -> dict:
    if not isinstance(tile, int) or tile < 0 or tile >= GRID:
        raise GameError("Invalid tile.")
    r = _load_round_locked(db, user_id, round_id, "mines")
    if r.status != "active":
        out = _mines_public(r); db.rollback(); return out   # duplicate tap after end: no effect
    p = dict(r.params)
    if tile in p["revealed"]:
        out = _mines_public(r); db.rollback(); return out
    out_hit = tile in p["positions"]
    if out_hit:
        r.status, r.multiplier, r.payout_amount, r.settled_at = "lost", Decimal("0"), Decimal("0"), _now()
        out = _mines_public(r)
        out["hit"] = tile
    else:
        p["revealed"] = p["revealed"] + [tile]
        r.params = p
        r.multiplier = mines_multiplier(p["mines"], len(p["revealed"]))
        capped = r.bet_amount * r.multiplier >= MAX_PAYOUT
        if capped or len(p["revealed"]) >= MINES_MAX_PICKS:
            _settle_payout(db, r, "cashed_out")
        out = _mines_public(r)
        out["safe"] = tile
    db.commit()
    return out


def mines_cashout(db: Session, user_id, round_id) -> dict:
    r = _load_round_locked(db, user_id, round_id, "mines")
    if r.status != "active":
        out = _mines_public(r); db.rollback(); return out
    if not r.params["revealed"]:
        db.rollback()
        raise GameError("Pick at least one tile before cashing out.")
    _settle_payout(db, r, "cashed_out")
    out = _mines_public(r)
    db.commit()
    return out


def mines_active(db: Session, user_id):
    r = db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "mines",
                                   GameRound.status == "active").first()
    return _mines_public(r) if r else None


# ---------------- Dice ----------------

def dice_chance(direction: str, target: int) -> int:
    """Winning chance in percent (integer, out of 100)."""
    if direction == "over":
        return 100 - target          # roll > target
    return target - 1                # roll < target


def dice_multiplier(chance: int) -> Decimal:
    return (Decimal(100) / Decimal(chance) * (1 - HOUSE_EDGE)).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)


def dice_quote(direction: str, target: int) -> dict:
    if direction not in ("over", "under") or not isinstance(target, int) or target < 1 or target > 100:
        raise GameError("Invalid prediction.")
    c = dice_chance(direction, target)
    if c < DICE_MIN_CHANCE or c > DICE_MAX_CHANCE:
        raise GameError(f"Win chance must be between {DICE_MIN_CHANCE}% and {DICE_MAX_CHANCE}%.")
    return {"direction": direction, "target": target, "win_chance": c,
            "multiplier": str(dice_multiplier(c)),
            "wins_on": f"{target + 1}-100" if direction == "over" else f"1-{target - 1}"}


def dice_roll(db: Session, user_id, bet, direction: str, target: int) -> dict:
    if not DICE_ENABLED:
        raise GameError("Dice is coming soon.")
    bet = _check_bet(bet)
    q = dice_quote(direction, target)
    mult = Decimal(q["multiplier"])
    wallet = _get_locked_wallet(db, user_id)
    if wallet.available_balance < bet:
        db.rollback()
        raise GameError("Not enough balance.")
    roll = secrets.randbelow(100) + 1
    won = roll > target if direction == "over" else roll < target
    rid = uuid.uuid4()
    rnd = GameRound(id=rid, user_id=user_id, game="dice", bet_amount=bet, status="active",
                    params={"direction": direction, "target": target, "roll": roll, "chance": q["win_chance"]},
                    multiplier=mult if won else Decimal("0"))
    db.add(rnd)
    wallet.available_balance -= bet
    db.flush()
    _write_ledger_row(db, wallet, "house_bet", -bet, f"round:{rid}:bet", "house_round", rid, "Dice bet")
    if won:
        _settle_payout(db, rnd, "won")
    else:
        rnd.status, rnd.settled_at = "lost", _now()
    out = {"round_id": str(rid), "roll": roll, "won": won, "bet": str(bet), "payout": str(rnd.payout_amount),
           "multiplier": q["multiplier"], "win_chance": q["win_chance"], "direction": direction, "target": target,
           "balance": str(wallet.available_balance)}
    db.commit()
    return out


# ---------------- Chicken Road ----------------
# One difficulty. Every step is an independent 50% safe / 50% trap. The whole
# path is drawn with the OS CSPRNG when the round starts and kept secret on the
# server. Fair multiplier = 2^k; we pay 2^k x (1 - CHICKEN_EDGE), disclosed.

CHICKEN_EDGE = Decimal("0.12")
CHICKEN_MAX_STEPS = 10
CHICKEN_SAFE_CHANCE = 45


def chicken_multiplier(step: int) -> Decimal:
    if step <= 0:
        return Decimal("1")
    return (Decimal(2) ** step * (1 - CHICKEN_EDGE)).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)


def chicken_rules() -> dict:
    return {"safe_chance": CHICKEN_SAFE_CHANCE, "house_edge_percent": str(CHICKEN_EDGE * 100),
            "min_bet": str(MIN_BET), "max_bet": str(MAX_BET), "max_payout": str(MAX_PAYOUT),
            "max_steps": CHICKEN_MAX_STEPS,
            "steps": [{"step": k, "multiplier": str(chicken_multiplier(k)),
                       "survive_chance": str((Decimal(CHICKEN_SAFE_CHANCE) ** k / Decimal(100) ** (k - 1)).quantize(Decimal("0.01")))}
                      for k in range(1, CHICKEN_MAX_STEPS + 1)]}


def _chicken_public(r: GameRound) -> dict:
    p = r.params
    step = p["step"]
    out = {"round_id": str(r.id), "game": "chicken", "status": r.status, "bet": str(r.bet_amount),
           "step": step, "max_steps": CHICKEN_MAX_STEPS, "multiplier": str(r.multiplier),
           "payout": str(r.payout_amount),
           "potential_payout": str(_q2(min(r.bet_amount * r.multiplier, MAX_PAYOUT)))}
    if r.status == "active" and step < CHICKEN_MAX_STEPS:
        out["next_multiplier"] = str(chicken_multiplier(step + 1))
    if r.status == "lost":
        out["lost_at"] = step + 1
    return out


def chicken_start(db: Session, user_id, bet) -> dict:
    bet = _check_bet(bet)
    wallet = _get_locked_wallet(db, user_id)
    active = (db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "chicken",
                                         GameRound.status == "active").first())
    if active:
        db.rollback()
        raise GameError("You already have an active Chicken Road round.")
    if wallet.available_balance < bet:
        db.rollback()
        raise GameError("Not enough balance.")
    path = [secrets.randbelow(100) < CHICKEN_SAFE_CHANCE for _ in range(CHICKEN_MAX_STEPS)]   # True = safe
    rnd = GameRound(id=uuid.uuid4(), user_id=user_id, game="chicken", bet_amount=bet, status="active",
                    params={"safe": path, "step": 0}, multiplier=Decimal("1"))
    db.add(rnd)
    wallet.available_balance -= bet
    db.flush()
    _write_ledger_row(db, wallet, "house_bet", -bet, f"round:{rnd.id}:bet", "house_round", rnd.id, "Chicken Road bet")
    db.commit()
    return _chicken_public(rnd)


def chicken_step(db: Session, user_id, round_id) -> dict:
    r = _load_round_locked(db, user_id, round_id, "chicken")
    if r.status != "active":
        out = _chicken_public(r); db.rollback(); return out
    p = dict(r.params)
    idx = p["step"]
    if idx >= CHICKEN_MAX_STEPS:
        out = _chicken_public(r); db.rollback(); return out
    if p["safe"][idx]:
        p["step"] = idx + 1
        r.params = p
        r.multiplier = chicken_multiplier(p["step"])
        if p["step"] >= CHICKEN_MAX_STEPS or r.bet_amount * r.multiplier >= MAX_PAYOUT:
            _settle_payout(db, r, "cashed_out")
    else:
        r.status, r.multiplier, r.payout_amount, r.settled_at = "lost", Decimal("0"), Decimal("0"), _now()
    out = _chicken_public(r)
    db.commit()
    return out


def chicken_cashout(db: Session, user_id, round_id) -> dict:
    r = _load_round_locked(db, user_id, round_id, "chicken")
    if r.status != "active":
        out = _chicken_public(r); db.rollback(); return out
    if r.params["step"] < 1:
        db.rollback()
        raise GameError("Take at least one step before cashing out.")
    _settle_payout(db, r, "cashed_out")
    out = _chicken_public(r)
    db.commit()
    return out


def chicken_active(db: Session, user_id):
    r = db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "chicken",
                                   GameRound.status == "active").first()
    return _chicken_public(r) if r else None


# ---------------- Nova Flight (crash) ----------------
# The server draws the crash point with the OS CSPRNG BEFORE takeoff and keeps it
# secret. The multiplier is a pure function of elapsed time: m(t) = e^(g*t).
# P(flight reaches x) = (1 - FLIGHT_EDGE) / x, so every cash-out target has the same
# disclosed house edge. Cash-outs are judged only by the server clock.

import math
import time

import hashlib
import hmac

FLIGHT_EDGE_PCT = 3                       # 3% house edge: P(flight reaches x) = 97% / x
FLIGHT_EDGE = Decimal(FLIGHT_EDGE_PCT) / 100
FLIGHT_GROWTH = 0.10          # per second:  2x ~ 6.9s, 5x ~ 16s, 10x ~ 23s
FLIGHT_TAKEOFF_DELAY = 1.5    # seconds between bet and takeoff
FLIGHT_MAX_CRASH = Decimal("1000")
FLIGHT_MIN_TARGET = Decimal("1.01")


def flight_crash_from_seed(seed: str, round_id: str) -> Decimal:
    """Provably fair: crash = f(HMAC_SHA256(server_seed, round_id)). Integer maths only, so
    players can recompute it exactly. The SHA-256 of the seed is shown BEFORE the flight."""
    h = hmac.new(seed.encode(), str(round_id).encode(), hashlib.sha256).hexdigest()
    r = int(h[:13], 16)                                    # 52 random bits
    c100 = (100 - FLIGHT_EDGE_PCT) * (1 << 52) // ((1 << 52) - r)
    c100 = max(100, min(int(FLIGHT_MAX_CRASH * 100), c100))
    return Decimal(c100) / 100


def _flight_mult_at(t: float) -> Decimal:
    if t <= 0:
        return Decimal("1.00")
    return (Decimal(str(math.exp(FLIGHT_GROWTH * t))) * 100).to_integral_value(rounding=ROUND_DOWN) / 100


def _flight_time_of(mult: Decimal) -> float:
    return math.log(float(mult)) / FLIGHT_GROWTH if mult > 1 else 0.0


def flight_rules() -> dict:
    return {"house_edge_percent": str(FLIGHT_EDGE * 100), "edge_pct": FLIGHT_EDGE_PCT, "growth": FLIGHT_GROWTH,
            "min_bet": str(MIN_BET), "max_bet": str(MAX_BET), "max_payout": str(MAX_PAYOUT),
            "min_target": str(FLIGHT_MIN_TARGET), "max_multiplier": str(FLIGHT_MAX_CRASH),
            "takeoff_delay": FLIGHT_TAKEOFF_DELAY,
            "samples": [{"x": str(x), "chance": str((((1 - FLIGHT_EDGE) / Decimal(x)) * 100).quantize(Decimal("0.01")))}
                        for x in (1.5, 2, 3, 5, 10, 50, 100)]}


def _flight_resolve(db, r: GameRound) -> bool:
    """Settle an active round if its time has come. Caller holds the row lock. True if changed."""
    if r.status != "active":
        return False
    p = r.params
    crash = Decimal(p["crash"])
    now = time.time()
    t = now - p["t0"]
    stop = None
    if p.get("target"):
        stop = Decimal(p["target"])
    cap = MAX_PAYOUT / r.bet_amount
    if stop is None or cap < stop:
        stop = cap
    if stop < crash and stop >= Decimal("1.00"):
        if t >= _flight_time_of(stop):
            r.multiplier = _q2(stop) if stop >= 1 else Decimal("1.00")
            _settle_payout(db, r, "cashed_out")
            return True
    elif t >= _flight_time_of(crash):
        r.status, r.multiplier, r.payout_amount, r.settled_at = "lost", Decimal("0"), Decimal("0"), _now()
        return True
    return False


def _flight_public(r: GameRound) -> dict:
    p = r.params
    out = {"round_id": str(r.id), "game": "flight", "status": r.status, "bet": str(r.bet_amount),
           "t0_ms": int(p["t0"] * 1000), "server_now_ms": int(time.time() * 1000),
           "growth": FLIGHT_GROWTH, "target": p.get("target"),
           "multiplier": str(r.multiplier), "payout": str(r.payout_amount),
           "seed_hash": p.get("seed_hash")}
    if r.status != "active":
        out["crash"] = p["crash"]          # revealed only after the round ends
        out["server_seed"] = p.get("seed")
    return out


def flight_start(db: Session, user_id, bet, target=None) -> dict:
    bet = _check_bet(bet)
    tgt = None
    if target not in (None, "", 0):
        try:
            tgt = Decimal(str(target))
        except Exception:
            raise GameError("Invalid auto cash-out value.")
        if tgt < FLIGHT_MIN_TARGET or tgt > FLIGHT_MAX_CRASH:
            raise GameError(f"Auto cash-out must be between {FLIGHT_MIN_TARGET} and {FLIGHT_MAX_CRASH}.")
        tgt = _q2(tgt)
    wallet = _get_locked_wallet(db, user_id)
    active = (db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "flight",
                                         GameRound.status == "active").with_for_update().first())
    if active:
        if _flight_resolve(db, active):
            db.flush()
        else:
            db.rollback()
            raise GameError("You already have a flight in the air.")
    if wallet.available_balance < bet:
        db.rollback()
        raise GameError("Not enough balance.")
    rid = uuid.uuid4()
    seed = secrets.token_hex(32)
    rnd = GameRound(id=rid, user_id=user_id, game="flight", bet_amount=bet, status="active",
                    params={"crash": str(flight_crash_from_seed(seed, str(rid))), "seed": seed,
                            "seed_hash": hashlib.sha256(seed.encode()).hexdigest(),
                            "t0": time.time() + FLIGHT_TAKEOFF_DELAY,
                            "target": str(tgt) if tgt else None},
                    multiplier=Decimal("1"))
    db.add(rnd)
    wallet.available_balance -= bet
    db.flush()
    _write_ledger_row(db, wallet, "house_bet", -bet, f"round:{rnd.id}:bet", "house_round", rnd.id, "Nova Flight bet")
    db.commit()
    return _flight_public(rnd)


def flight_state(db: Session, user_id, round_id) -> dict:
    r = _load_round_locked(db, user_id, round_id, "flight")
    _flight_resolve(db, r)
    out = _flight_public(r)
    db.commit()
    return out


def flight_cashout(db: Session, user_id, round_id) -> dict:
    r = _load_round_locked(db, user_id, round_id, "flight")
    if r.status != "active":
        out = _flight_public(r); db.rollback(); return out
    if _flight_resolve(db, r):               # crashed (or auto cash-out hit) before this tap arrived
        out = _flight_public(r); db.commit(); return out
    t = time.time() - r.params["t0"]
    if t < 0:
        db.rollback()
        raise GameError("Wait for takeoff.")
    m = _flight_mult_at(t)
    if m < Decimal("1.01"):
        db.rollback()
        raise GameError("Too early to cash out.")
    r.multiplier = m
    _settle_payout(db, r, "cashed_out")
    out = _flight_public(r)
    db.commit()
    return out


def flight_active(db: Session, user_id):
    r = (db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.game == "flight",
                                    GameRound.status == "active").with_for_update().first())
    if not r:
        db.rollback()
        return None
    _flight_resolve(db, r)
    out = _flight_public(r)
    db.commit()
    return out


def flight_recent(db: Session, limit=24) -> list:
    rows = (db.query(GameRound).filter(GameRound.game == "flight", GameRound.status != "active")
            .order_by(GameRound.settled_at.desc()).limit(limit).all())
    out = []
    for r in rows:
        c = r.params.get("crash")
        if c and r.status == "lost":
            out.append(c)                     # flew away at this multiplier
        elif c:
            out.append(c)                     # cashed out: still show where it would have flown away
    return out


# ---------------- History ----------------

def history(db: Session, user_id, limit=30) -> list:
    rows = (db.query(GameRound).filter(GameRound.user_id == user_id, GameRound.status != "active")
            .order_by(GameRound.created_at.desc()).limit(limit).all())
    return [{"game": r.game, "status": r.status, "bet": str(r.bet_amount), "payout": str(r.payout_amount),
             "multiplier": str(r.multiplier), "at": r.settled_at.isoformat() if r.settled_at else None}
            for r in rows]
