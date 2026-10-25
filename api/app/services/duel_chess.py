"""
duel_chess.py — complete chess rules (pure Python, no database).

Board: 64-char string, index 0 = a8 ... 63 = h1 (row 0 is rank 8).
Uppercase = white, lowercase = black, '.' = empty.
State is a plain dict so it can live in a JSONB column:
  {board, turn:'w'|'b', castle:'KQkq'-subset or '-', ep:int(-1 none), half:int, full:int, keys:[str]}
Handles: check, checkmate, stalemate, castling, en passant, promotion,
50-move rule, threefold repetition and insufficient material.
"""

START = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR"
KN = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
KG = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
BI = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
RK = [(-1, 0), (1, 0), (0, -1), (0, 1)]


def initial_state() -> dict:
    s = {"board": START, "turn": "w", "castle": "KQkq", "ep": -1, "half": 0, "full": 1}
    s["keys"] = [_key(s)]
    return s


def _key(s) -> str:
    return f'{s["board"]}{s["turn"]}{s["castle"]}{s["ep"]}'


def _white(p):
    return p.isupper()


def attacked(b, target: int, by_white: bool) -> bool:
    """Is square `target` attacked by the given colour?"""
    r, c = divmod(target, 8)
    # pawns
    pr = r + 1 if by_white else r - 1
    if 0 <= pr < 8:
        for dc in (-1, 1):
            cc = c + dc
            if 0 <= cc < 8 and b[pr * 8 + cc] == ("P" if by_white else "p"):
                return True
    knight = "N" if by_white else "n"
    for dr, dc in KN:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and b[rr * 8 + cc] == knight:
            return True
    king = "K" if by_white else "k"
    for dr, dc in KG:
        rr, cc = r + dr, c + dc
        if 0 <= rr < 8 and 0 <= cc < 8 and b[rr * 8 + cc] == king:
            return True
    q, rk, bi = ("Q", "R", "B") if by_white else ("q", "r", "b")
    for dirs, pieces in ((RK, (rk, q)), (BI, (bi, q))):
        for dr, dc in dirs:
            rr, cc = r + dr, c + dc
            while 0 <= rr < 8 and 0 <= cc < 8:
                p = b[rr * 8 + cc]
                if p != ".":
                    if p in pieces:
                        return True
                    break
                rr += dr
                cc += dc
    return False


def _king_sq(b, white):
    return b.index("K" if white else "k")


def in_check(s, white=None) -> bool:
    w = (s["turn"] == "w") if white is None else white
    return attacked(s["board"], _king_sq(s["board"], w), not w)


def _pseudo(s):
    b, white = s["board"], s["turn"] == "w"
    out = []
    for i, p in enumerate(b):
        if p == "." or _white(p) != white:
            continue
        r, c = divmod(i, 8)
        t = p.upper()
        if t == "P":
            d = -1 if white else 1
            start = 6 if white else 1
            last = 0 if white else 7
            r1 = r + d
            if 0 <= r1 < 8 and b[r1 * 8 + c] == ".":
                if r1 == last:
                    out += [(i, r1 * 8 + c, x) for x in "qrbn"]
                else:
                    out.append((i, r1 * 8 + c, ""))
                    if r == start and b[(r + 2 * d) * 8 + c] == ".":
                        out.append((i, (r + 2 * d) * 8 + c, ""))
            for dc in (-1, 1):
                cc = c + dc
                if not (0 <= cc < 8 and 0 <= r1 < 8):
                    continue
                to = r1 * 8 + cc
                q = b[to]
                if q != "." and _white(q) != white:
                    if r1 == last:
                        out += [(i, to, x) for x in "qrbn"]
                    else:
                        out.append((i, to, ""))
                elif to == s["ep"]:
                    out.append((i, to, ""))
        elif t in "NK":
            for dr, dc in (KN if t == "N" else KG):
                rr, cc = r + dr, c + dc
                if 0 <= rr < 8 and 0 <= cc < 8:
                    q = b[rr * 8 + cc]
                    if q == "." or _white(q) != white:
                        out.append((i, rr * 8 + cc, ""))
            if t == "K":
                rank = 7 if white else 0
                if r == rank and c == 4 and not attacked(b, i, not white):
                    cs = s["castle"]
                    kk, qq = ("K", "Q") if white else ("k", "q")
                    rook = "R" if white else "r"
                    if kk in cs and b[rank * 8 + 5] == "." and b[rank * 8 + 6] == "." and b[rank * 8 + 7] == rook \
                            and not attacked(b, rank * 8 + 5, not white) and not attacked(b, rank * 8 + 6, not white):
                        out.append((i, rank * 8 + 6, ""))
                    if qq in cs and b[rank * 8 + 3] == "." and b[rank * 8 + 2] == "." and b[rank * 8 + 1] == "." \
                            and b[rank * 8] == rook \
                            and not attacked(b, rank * 8 + 3, not white) and not attacked(b, rank * 8 + 2, not white):
                        out.append((i, rank * 8 + 2, ""))
        else:
            dirs = BI if t == "B" else RK if t == "R" else BI + RK
            for dr, dc in dirs:
                rr, cc = r + dr, c + dc
                while 0 <= rr < 8 and 0 <= cc < 8:
                    q = b[rr * 8 + cc]
                    if q == ".":
                        out.append((i, rr * 8 + cc, ""))
                    else:
                        if _white(q) != white:
                            out.append((i, rr * 8 + cc, ""))
                        break
                    rr += dr
                    cc += dc
    return out


def _make(s, mv, keys=True) -> dict:
    fr, to, promo = mv
    b = list(s["board"])
    p = b[fr]
    white = p.isupper()
    cap = b[to]
    b[to], b[fr] = p, "."
    ep = -1
    t = p.upper()
    if t == "P":
        if to == s["ep"] and cap == ".":
            b[to + (8 if white else -8)] = "."          # en passant capture
        if abs(to - fr) == 16:
            ep = (fr + to) // 2
        if promo:
            b[to] = promo.upper() if white else promo.lower()
    if t == "K" and abs(to - fr) == 2:                   # castling: move the rook
        if to > fr:
            b[fr + 1], b[fr + 3] = b[fr + 3], "."
        else:
            b[fr - 1], b[fr - 4] = b[fr - 4], "."
    cs = s["castle"]
    if t == "K":
        cs = cs.replace("K", "").replace("Q", "") if white else cs.replace("k", "").replace("q", "")
    for sqr, ch in ((56, "Q"), (63, "K"), (0, "q"), (7, "k")):
        if fr == sqr or to == sqr:
            cs = cs.replace(ch, "")
    n = {"board": "".join(b), "turn": "b" if white else "w", "castle": cs or "-", "ep": ep,
         "half": 0 if (t == "P" or cap != ".") else s["half"] + 1,
         "full": s["full"] + (0 if white else 1)}
    if keys:
        n["keys"] = s.get("keys", []) + [_key(n)]
    return n


def legal_moves(s):
    white = s["turn"] == "w"
    res = []
    for mv in _pseudo(s):
        n = _make(s, mv, keys=False)
        if not attacked(n["board"], _king_sq(n["board"], white), not white):
            res.append(mv)
    return res


def apply(s, fr: int, to: int, promo: str = "") -> dict:
    """Apply a move; raises ValueError if it is not legal."""
    promo = (promo or "").lower()
    p = s["board"][fr]
    if p.upper() == "P" and to // 8 in (0, 7) and not promo:
        promo = "q"
    if not (p.upper() == "P" and to // 8 in (0, 7)):
        promo = ""
    if (fr, to, promo) not in legal_moves(s):
        raise ValueError("Illegal move.")
    return _make(s, (fr, to, promo))


def _insufficient(b: str) -> bool:
    rest = [p for p in b if p not in ".kK"]
    if not rest:
        return True
    if len(rest) == 1 and rest[0] in "nNbB":
        return True
    return False


def status(s) -> str:
    """'ongoing' | 'checkmate' (side to move is mated) | 'stalemate' | 'draw_50' | 'draw_rep' | 'draw_material'."""
    if not legal_moves(s):
        return "checkmate" if in_check(s) else "stalemate"
    if _insufficient(s["board"]):
        return "draw_material"
    if s["half"] >= 100:
        return "draw_50"
    if s.get("keys") and s["keys"].count(s["keys"][-1]) >= 3:
        return "draw_rep"
    return "ongoing"


def moves_by_square(s) -> dict:
    out = {}
    for fr, to, promo in legal_moves(s):
        out.setdefault(fr, [])
        if to not in out[fr]:
            out[fr].append(to)
    return out


def perft(s, depth):
    if depth == 0:
        return 1
    return sum(perft(_make(s, m, keys=False), depth - 1) for m in legal_moves(s))
