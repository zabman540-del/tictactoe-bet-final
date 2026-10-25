"""
duel_pool.py — 8-ball pool, simulated entirely on the server (pure Python).

The player only sends an angle + power. The server runs a deterministic physics
simulation and returns animation frames; both players watch the same replay.

Ball ids: 0 = cue, 1-7 solids, 8 = black, 9-15 stripes.
Table: 800 x 400, ball radius 11, 6 pockets.
Rules ("8-ball lite"):
  * Table starts open. First legal pot assigns solids/stripes to the shooter.
  * Pot one of your balls without a foul -> shoot again.
  * Foul (scratch, no ball hit, or wrong ball hit first) -> opponent gets ball-in-hand.
  * Pot the 8 after clearing your group = win. Pot it early (or with a foul) = loss.
"""
import math

W, H, R = 800.0, 400.0, 11.0
POCKETS = [(0, 0, 27), (W / 2, -4, 22), (W, 0, 27), (0, H, 27), (W / 2, H + 4, 22), (W, H, 27)]
DT = 1.0 / 240.0
FRAME_EVERY = 10          # 24 fps
DECEL = 250.0             # rolling friction (units/s^2)
STOP = 5.0
MAX_SPEED = 1700.0
REST_WALL = 0.82
REST_BALL = 0.96
MAX_SECONDS = 14.0


def rack() -> list:
    """16 balls: [x, y, pocketed(0/1)] ; index = ball id."""
    balls = [[W * 0.25, H / 2, 0]] + [[0.0, 0.0, 0] for _ in range(15)]
    # triangle apex at x = W*0.72
    order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15]
    # keep 8 in the middle (position 4 = row 3 middle); solids/stripes alternate
    x0, i = W * 0.72, 0
    for row in range(5):
        for k in range(row + 1):
            bid = order[i]
            i += 1
            balls[bid] = [x0 + row * (R * 2 * 0.87 + 0.5), H / 2 + (k - row / 2.0) * (R * 2 + 0.5), 0]
    return balls


def group_of(b: int):
    if b == 8 or b == 0:
        return None
    return "solid" if b < 8 else "stripe"


def _simulate(balls, cue_vx, cue_vy):
    """Runs physics. Returns dict(frames, first_hit, pocketed(list), cue_rail_after_hit)."""
    n = 16
    px = [b[0] for b in balls]
    py = [b[1] for b in balls]
    vx = [0.0] * n
    vy = [0.0] * n
    alive = [not b[2] for b in balls]
    vx[0], vy[0] = cue_vx, cue_vy
    first_hit = None
    pocketed = []
    frames = []

    def snap():
        fr = []
        for i in range(n):
            if alive[i]:
                fr += [int(round(px[i])), int(round(py[i]))]
            else:
                fr += [-1, -1]
        frames.append(fr)

    snap()
    steps = int(MAX_SECONDS / DT)
    D2 = (2 * R) ** 2
    for step in range(steps):
        moving = False
        for i in range(n):
            if not alive[i]:
                continue
            ax, ay = vx[i], vy[i]
            sp = math.hypot(ax, ay)
            if sp > 0:
                moving = True
                ns = sp - DECEL * DT
                if ns < STOP:
                    vx[i] = vy[i] = 0.0
                else:
                    k = ns / sp
                    vx[i], vy[i] = ax * k, ay * k
                    px[i] += vx[i] * DT
                    py[i] += vy[i] * DT
        if not moving:
            break
        # pockets
        for i in range(n):
            if not alive[i]:
                continue
            for (cx, cy, cr) in POCKETS:
                if (px[i] - cx) ** 2 + (py[i] - cy) ** 2 < cr * cr:
                    alive[i] = False
                    vx[i] = vy[i] = 0.0
                    pocketed.append(i)
                    break
        # cushions
        for i in range(n):
            if not alive[i]:
                continue
            if px[i] < R:
                px[i] = R
                vx[i] = abs(vx[i]) * REST_WALL
            elif px[i] > W - R:
                px[i] = W - R
                vx[i] = -abs(vx[i]) * REST_WALL
            if py[i] < R:
                py[i] = R
                vy[i] = abs(vy[i]) * REST_WALL
            elif py[i] > H - R:
                py[i] = H - R
                vy[i] = -abs(vy[i]) * REST_WALL
        # ball-ball
        for i in range(n):
            if not alive[i]:
                continue
            for j in range(i + 1, n):
                if not alive[j]:
                    continue
                if vx[i] == 0 and vy[i] == 0 and vx[j] == 0 and vy[j] == 0:
                    continue
                dx, dy = px[j] - px[i], py[j] - py[i]
                d2 = dx * dx + dy * dy
                if d2 < D2 and d2 > 1e-9:
                    d = math.sqrt(d2)
                    nx, ny = dx / d, dy / d
                    ov = (2 * R - d) / 2
                    px[i] -= nx * ov
                    py[i] -= ny * ov
                    px[j] += nx * ov
                    py[j] += ny * ov
                    rv = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny
                    if rv > 0:
                        imp = rv * (1 + REST_BALL) / 2
                        vx[i] -= imp * nx
                        vy[i] -= imp * ny
                        vx[j] += imp * nx
                        vy[j] += imp * ny
                        if first_hit is None and (i == 0 or j == 0):
                            first_hit = j if i == 0 else i
        if step % FRAME_EVERY == 0:
            snap()
    snap()
    return {"frames": frames, "first_hit": first_hit, "pocketed": pocketed,
            "final": [[round(px[i], 2), round(py[i], 2), 0 if alive[i] else 1] for i in range(n)]}


def _free_spot(balls, x, y) -> bool:
    if not (R <= x <= W - R and R <= y <= H - R):
        return False
    for i in range(1, 16):
        if not balls[i][2] and (balls[i][0] - x) ** 2 + (balls[i][1] - y) ** 2 < (2 * R) ** 2:
            return False
    for (cx, cy, cr) in POCKETS:
        if (cx - x) ** 2 + (cy - y) ** 2 < (cr + R) ** 2:
            return False
    return True


def take_shot(state: dict, shooter: str, angle: float, power: float, place=None) -> dict:
    """
    state: {balls, groups:{c:None|'solid'|'stripe', o:...}, in_hand:None|'c'|'o'}
    shooter: 'c' or 'o'. Mutates & returns a result dict:
      {frames, ended: None|'c'|'o'  (winner side), reason, next_turn, foul, potted:[ids], msg}
    """
    balls = [list(b) for b in state["balls"]]
    other = "o" if shooter == "c" else "c"
    if state.get("in_hand") == shooter:
        if place is None:
            raise ValueError("Place the cue ball first.")
        x, y = float(place[0]), float(place[1])
        if not _free_spot(balls, x, y):
            raise ValueError("You can't place the cue ball there.")
        balls[0] = [x, y, 0]
    elif balls[0][2]:
        balls[0] = [W * 0.25, H / 2, 0]
    if not (0 <= power <= 1) or not math.isfinite(angle):
        raise ValueError("Bad shot.")
    power = max(0.05, power)
    spd = MAX_SPEED * power
    sim = _simulate(balls, math.cos(angle) * spd, math.sin(angle) * spd)
    pot = sim["pocketed"]
    groups = dict(state["groups"])
    my = groups.get(shooter)
    foul = False
    why = ""
    fh = sim["first_hit"]
    cue_potted = 0 in pot
    potted = [b for b in pot if b != 0]
    if fh is None:
        foul, why = True, "no_hit"
    elif my is None:
        if fh == 8:
            foul, why = True, "hit_8_first"
    else:
        remaining = [i for i in range(1, 16) if group_of(i) == my and not balls[i][2]]
        needed = group_of(fh) == my or (fh == 8 and not remaining)
        if not needed:
            foul, why = True, "wrong_ball"
    if cue_potted:
        foul, why = True, "scratch"

    final = sim["final"]
    ended, reason = None, None
    if 8 in potted:
        remaining_before = [i for i in range(1, 16) if my and group_of(i) == my and not balls[i][2]]
        clean = (my is not None) and not remaining_before and not foul
        if clean:
            ended, reason = shooter, "black_win"
        else:
            ended, reason = other, "black_early"
    # assign groups on the first clean pot of an open table
    if ended is None and my is None and not foul:
        for b in potted:
            g = group_of(b)
            if g:
                groups[shooter] = g
                groups[other] = "stripe" if g == "solid" else "solid"
                my = g
                break
    own_pot = [b for b in potted if (my and group_of(b) == my)]
    keep_turn = (not foul) and ended is None and bool(own_pot)
    next_turn = shooter if keep_turn else other
    in_hand = other if (foul and ended is None) else None
    if cue_potted:
        final[0] = [W * 0.25, H / 2, 0]
    return {"frames": sim["frames"], "balls": final, "groups": groups, "ended": ended, "reason": reason,
            "foul": foul, "why": why, "potted": potted, "next_turn": next_turn, "in_hand": in_hand,
            "first_hit": fh}

