"""
routes/admin_overview.py

Data for the admin "Overview" page: money in/out, requests waiting,
and how much the house earned from each of the 4 games
(Tic-Tac-Toe, Rock Paper Scissors, Chicken Road, Mines, Nova Flight).

Earnings:
  - TTT / RPS : the platform fee taken from each finished (non-draw) match.
  - Chicken / Mines : house profit = money bet - money paid back to players.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, cast, Date, text
from sqlalchemy.orm import Session

from app.core.admin_auth import get_current_admin
from app.core.database import get_db
from app.models.models import (
    Admin, Deposit, DuelGame, GameRound, Match, RpsGame, User, Wallet, Withdrawal,
)

router = APIRouter()

TTT_FEE_STATUSES = ["completed_win", "completed_forfeit"]
TTT_DONE = ["completed_win", "completed_draw", "completed_forfeit"]
RPS_FEE_STATUSES = ["completed"]
RPS_DONE = ["completed", "draw"]


def _d(v) -> Decimal:
    return Decimal(v or 0)


def _s(v) -> str:
    return str(_d(v).quantize(Decimal("0.01")))


def _name(u: User) -> str:
    if not u:
        return "?"
    return u.display_name or u.full_name or (("@" + u.telegram_username) if u.telegram_username else str(u.telegram_user_id))


@router.get("/admin/overview")
def overview(db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin)):
    try:
        return _overview(db)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Overview error: {type(e).__name__}: {str(e)[:300]}")


def _overview(db: Session):

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    start14 = (now - timedelta(days=13)).replace(hour=0, minute=0, second=0, microsecond=0)

    # ---------- money in / out ----------
    dep_ok = db.query(func.coalesce(func.sum(Deposit.amount), 0)).filter(Deposit.status == "approved").scalar()
    wd_ok = db.query(func.coalesce(func.sum(Withdrawal.amount), 0)).filter(Withdrawal.status.in_(["paid", "approved", "completed"])).scalar()
    dep_pend = db.query(func.count(Deposit.id), func.coalesce(func.sum(Deposit.amount), 0)).filter(Deposit.status == "pending").one()
    wd_pend = db.query(func.count(Withdrawal.id), func.coalesce(func.sum(Withdrawal.amount), 0)).filter(Withdrawal.status == "pending").one()
    owed = db.query(func.coalesce(func.sum(Wallet.available_balance + Wallet.locked_balance), 0)).scalar()

    # ---------- per game ----------
    def ttt(since=None):
        q = db.query(func.count(Match.id), func.coalesce(func.sum(Match.stake_amount * 2), 0))
        q = q.filter(Match.game_type == "tictactoe", Match.status.in_(TTT_DONE))
        f = db.query(func.coalesce(func.sum(Match.platform_fee), 0)).filter(
            Match.game_type == "tictactoe", Match.status.in_(TTT_FEE_STATUSES))
        if since is not None:
            q = q.filter(Match.settled_at >= since); f = f.filter(Match.settled_at >= since)
        n, vol = q.one()
        return n, vol, f.scalar()

    def rps(since=None):
        q = db.query(func.count(RpsGame.id), func.coalesce(func.sum(RpsGame.stake_amount * 2), 0)).filter(RpsGame.status.in_(RPS_DONE))
        f = db.query(func.coalesce(func.sum(RpsGame.platform_fee), 0)).filter(RpsGame.status.in_(RPS_FEE_STATUSES))
        if since is not None:
            q = q.filter(RpsGame.settled_at >= since); f = f.filter(RpsGame.settled_at >= since)
        n, vol = q.one()
        return n, vol, f.scalar()

    def duel(game, since=None):
        q = db.query(func.count(DuelGame.id), func.coalesce(func.sum(DuelGame.stake_amount * 2), 0)).filter(
            DuelGame.game == game, DuelGame.status.in_(RPS_DONE))
        f = db.query(func.coalesce(func.sum(DuelGame.platform_fee), 0)).filter(
            DuelGame.game == game, DuelGame.status.in_(RPS_FEE_STATUSES))
        if since is not None:
            q = q.filter(DuelGame.settled_at >= since); f = f.filter(DuelGame.settled_at >= since)
        n, vol = q.one()
        return n, vol, f.scalar()

    def house(game, since=None):
        q = db.query(func.count(GameRound.id), func.coalesce(func.sum(GameRound.bet_amount), 0),
                     func.coalesce(func.sum(GameRound.payout_amount), 0)).filter(
            GameRound.game == game, GameRound.status != "active")
        if since is not None:
            q = q.filter(GameRound.settled_at >= since)
        n, bet, paid = q.one()
        return n, bet, _d(bet) - _d(paid)

    def flight(since=None):
        q = ("SELECT count(*), coalesce(sum(amount),0), coalesce(sum(coalesce(payout,0)),0) "
             "FROM nova_flight_bets WHERE settled" + (" AND created_at >= :s" if since is not None else ""))
        try:
            n, bet, paid = db.execute(text(q), {"s": since} if since is not None else {}).one()
        except Exception:
            db.rollback()
            return 0, 0, 0
        return n, bet, _d(bet) - _d(paid)

    def row(key, label, icon, today, total):
        return {"key": key, "label": label, "icon": icon,
                "rounds": total[0], "volume": _s(total[1]), "earned": _s(total[2]),
                "rounds_24h": today[0], "volume_24h": _s(today[1]), "earned_24h": _s(today[2])}

    games = [
        row("ttt", "Tic-Tac-Toe", "⭕", ttt(day_ago), ttt()),
        row("rps", "Rock Paper Scissors", "✊", rps(day_ago), rps()),
        row("chicken", "Chicken Road", "🐔", house("chicken", day_ago), house("chicken")),
        row("mines", "Mines", "💣", house("mines", day_ago), house("mines")),
        row("flight", "Nova Flight", "✈️", house("flight", day_ago), house("flight")),
        row("chess", "Chess", "♟️", duel("chess", day_ago), duel("chess")),
        row("archery", "Archery", "🏹", duel("archery", day_ago), duel("archery")),
        row("race", "Car Race", "🏎️", duel("race", day_ago), duel("race")),
        row("pool", "Pool", "🎱", duel("pool", day_ago), duel("pool")),
    ]
    total_earned = sum(_d(g["earned"]) for g in games)
    earned_24h = sum(_d(g["earned_24h"]) for g in games)

    # ---------- last 14 days (profit per day, per game) ----------
    days = [(start14 + timedelta(days=i)).date() for i in range(14)]
    series = {d.isoformat(): {"ttt": Decimal(0), "rps": Decimal(0), "chicken": Decimal(0), "mines": Decimal(0), "flight": Decimal(0),
                                  "chess": Decimal(0), "archery": Decimal(0), "race": Decimal(0), "pool": Decimal(0)} for d in days}

    m_day = cast(Match.settled_at, Date)
    for d, v in db.query(m_day, func.sum(Match.platform_fee)).filter(
            Match.game_type == "tictactoe", Match.status.in_(TTT_FEE_STATUSES), Match.settled_at >= start14).group_by(m_day).all():
        if d and d.isoformat() in series:
            series[d.isoformat()]["ttt"] = _d(v)
    r_day = cast(RpsGame.settled_at, Date)
    for d, v in db.query(r_day, func.sum(RpsGame.platform_fee)).filter(
            RpsGame.status.in_(RPS_FEE_STATUSES), RpsGame.settled_at >= start14).group_by(r_day).all():
        if d and d.isoformat() in series:
            series[d.isoformat()]["rps"] = _d(v)
    d_day = cast(DuelGame.settled_at, Date)
    for g, d, v in db.query(DuelGame.game, d_day, func.sum(DuelGame.platform_fee)).filter(
            DuelGame.status.in_(RPS_FEE_STATUSES), DuelGame.settled_at >= start14).group_by(DuelGame.game, d_day).all():
        if d and d.isoformat() in series and g in series[d.isoformat()]:
            series[d.isoformat()][g] = _d(v)
    g_day = cast(GameRound.settled_at, Date)
    for g, d, bet, paid in db.query(GameRound.game, g_day, func.sum(GameRound.bet_amount),
                                    func.sum(GameRound.payout_amount)).filter(
            GameRound.status != "active", GameRound.game.in_(["chicken", "mines", "flight"]),
            GameRound.settled_at >= start14).group_by(GameRound.game, g_day).all():
        if d and d.isoformat() in series:
            series[d.isoformat()][g] = _d(bet) - _d(paid)
    try:
        for d, bet, paid in db.execute(text(
                "SELECT created_at::date, sum(amount), sum(coalesce(payout,0)) FROM nova_flight_bets "
                "WHERE settled AND created_at >= :s GROUP BY 1"), {"s": start14}).all():
            if d and d.isoformat() in series:
                series[d.isoformat()]["flight"] = _d(bet) - _d(paid)
    except Exception:
        db.rollback()
    daily = [{"date": k, **{g: str(v) for g, v in vals.items()}} for k, vals in series.items()]

    # ---------- queues ----------
    users = {}

    def uname(uid):
        if uid not in users:
            users[uid] = _name(db.query(User).filter(User.internal_id == uid).first())
        return users[uid]

    pend_dep = [{"id": str(d.id), "user": uname(d.user_id), "amount": _s(d.amount), "method": d.payment_method,
                 "reference": d.reference_number, "created_at": d.created_at.isoformat()}
                for d in db.query(Deposit).filter(Deposit.status == "pending").order_by(Deposit.created_at.asc()).limit(8)]
    pend_wd = [{"id": str(w.id), "user": uname(w.user_id), "amount": _s(w.amount), "method": w.payment_method,
                "details": w.payment_details, "created_at": w.created_at.isoformat()}
               for w in db.query(Withdrawal).filter(Withdrawal.status == "pending").order_by(Withdrawal.created_at.asc()).limit(8)]

    users_total = db.query(func.count(User.internal_id)).scalar()
    users_online = db.query(func.count(User.internal_id)).filter(User.last_seen_at >= now - timedelta(minutes=5)).scalar()
    users_new = db.query(func.count(User.internal_id)).filter(User.registered_at >= day_ago).scalar()

    return {
        "money": {
            "deposits_approved": _s(dep_ok), "withdrawals_paid": _s(wd_ok),
            "net_cash": _s(_d(dep_ok) - _d(wd_ok)),
            "deposits_pending_count": dep_pend[0], "deposits_pending_amount": _s(dep_pend[1]),
            "withdrawals_pending_count": wd_pend[0], "withdrawals_pending_amount": _s(wd_pend[1]),
            "players_hold": _s(owed),
        },
        "earned_total": _s(total_earned), "earned_24h": _s(earned_24h),
        "games": games, "daily": daily,
        "pending_deposits": pend_dep, "pending_withdrawals": pend_wd,
        "users": {"total": users_total, "online": users_online, "new_24h": users_new},
    }
