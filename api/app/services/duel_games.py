"""
duel_games.py — pure game logic for Archery and Car Race (no database).

ARCHERY
  The crosshair drifts on a smooth path that is a pure function of SERVER time
  since the arrow window opened, so the app cannot lie about where it aimed.
  Wind pushes the arrow, and a tiny random hand-shake is added by the server.
  Score = 10 (bullseye) .. 1 (outer ring), 0 = miss.

CAR RACE
  Both players race the SAME track (made from a random seed). Constant speed,
  3 lanes, obstacles in lanes. The player only steers. The server replays the
  steering log; every crash adds a time penalty. Lowest total time wins.
"""
import math
import random
import secrets

# ------------------------------------------------------------------ archery
ARROWS_EACH = 5
SUDDEN_PAIRS = 3
AIM_DELAY = 1.5       # seconds before the crosshair starts moving
SHOT_SECONDS = 15     # window to shoot after AIM_DELAY
SHAKE = 0.03          # random hand shake (std-dev, in target radii)


def new_arrow() -> dict:
    r = secrets.SystemRandom()
    return {
        "wx": round(r.uniform(-0.22, 0.22), 3), "wy": round(r.uniform(-0.22, 0.22), 3),
        "ax": round(r.uniform(0.6, 0.78), 3), "ay": round(r.uniform(0.6, 0.78), 3),
        "fx": round(r.uniform(0.22, 0.34), 3), "fy": round(r.uniform(0.27, 0.40), 3),
        "px": round(r.uniform(0, 6.28), 3), "py": round(r.uniform(0, 6.28), 3),
    }


def crosshair(a: dict, t: float):
    t = max(0.0, t)
    return (a["ax"] * math.sin(2 * math.pi * a["fx"] * t + a["px"]),
            a["ay"] * math.sin(2 * math.pi * a["fy"] * t + a["py"]))


def score_for(d: float) -> int:
    if d >= 1.0:
        return 0
    return 10 - int(d / 0.1)


def shoot(a: dict, t: float):
    """t = seconds since the crosshair started moving. Returns (x, y, score)."""
    cx, cy = crosshair(a, t)
    rnd = secrets.SystemRandom()
    x = cx + a["wx"] + rnd.gauss(0, SHAKE)
    y = cy + a["wy"] + rnd.gauss(0, SHAKE)
    return round(x, 3), round(y, 3), score_for(math.hypot(x, y))


def archery_total_arrows(idx_done: int, totals: dict) -> bool:
    """True when the game is finished after idx_done arrows (alternating creator/opponent)."""
    base = ARROWS_EACH * 2
    if idx_done < base:
        return False
    if (idx_done - base) % 2 == 1:        # mid sudden-death pair
        return False
    if totals["c"] != totals["o"]:
        return True
    return idx_done >= base + SUDDEN_PAIRS * 2


# ------------------------------------------------------------------ car race
TRACK_LEN = 2200.0
SPEED = 110.0                      # units / second  -> 20 s base time
CRASH_PENALTY = 1.2                # seconds added per crash
BASE_TIME = TRACK_LEN / SPEED
CAR_HALF = 14.0                    # collision half length


def make_track(seed: str) -> list:
    """List of [distance, lane] obstacles (lane 0,1,2), same for both players."""
    rnd = random.Random(seed)
    obs, d = [], 260.0
    while d < TRACK_LEN - 120:
        if rnd.random() < 0.32:
            free = rnd.randrange(3)
            for ln in range(3):
                if ln != free:
                    obs.append([round(d), ln])
        else:
            obs.append([round(d), rnd.randrange(3)])
        d += rnd.uniform(75, 125)
    return obs


def validate_log(log):
    """log = [[t_ms, lane], ...]. Returns cleaned list or raises ValueError."""
    if not isinstance(log, list) or len(log) > 300:
        raise ValueError("Bad steering log.")
    out, last_t, lane = [], -1000, 1
    for e in log:
        if not (isinstance(e, (list, tuple)) and len(e) == 2):
            raise ValueError("Bad steering log.")
        t, ln = int(e[0]), int(e[1])
        if t < last_t + 90 or t > (BASE_TIME + 3) * 1000 or ln not in (0, 1, 2) or abs(ln - lane) != 1:
            raise ValueError("Bad steering log.")
        out.append([t, ln])
        last_t, lane = t, ln
    return out


def lane_at(log, t_ms: float) -> int:
    lane = 1
    for t, ln in log:
        if t <= t_ms:
            lane = ln
        else:
            break
    return lane


def race_time(track, log) -> dict:
    crashes = 0
    hit = []
    for d, ln in track:
        t_ms = d / SPEED * 1000.0
        # you crash if you are in the lane at any moment while the car overlaps the obstacle
        t0 = (d - CAR_HALF) / SPEED * 1000.0
        t1 = (d + CAR_HALF) / SPEED * 1000.0
        lanes = {lane_at(log, t0), lane_at(log, t_ms), lane_at(log, t1)}
        lanes.update(l for tt, l in log if t0 < tt < t1)
        if ln in lanes:
            crashes += 1
            hit.append(d)
    return {"crashes": crashes, "time": round(BASE_TIME + crashes * CRASH_PENALTY, 3), "hit": hit}
