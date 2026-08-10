"""Result-set comparison for agent evals.

There are many correct SQL queries for one question, so generated SQL is never
compared to golden SQL. Result sets are — order-insensitive on rows and
columns, with a tight numeric tolerance that absorbs rounding, not error.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import date, datetime
from decimal import Decimal


def _norm(v, tol: float):
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float, Decimal)):
        return round(float(v), 2)          # tolerance applied at compare time
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return str(v).strip()


def result_sets_match(golden: list[dict], actual: list[dict],
                      keys: list[str], tol: float = 0.01) -> bool:
    """Order-insensitive on rows AND columns. Extra actual columns are allowed;
    every golden column must be present and equal within tolerance."""
    if golden and any(k not in (actual[0] if actual else {}) for k in keys):
        return False

    def sig(row):
        return tuple(_norm(row.get(k), tol) for k in keys)

    g, a = Counter(map(sig, golden)), Counter(map(sig, actual))
    if set(g) != set(a):
        return False
    return all(g[k] == a[k] for k in g)


# ------------------------------------------------------------- grounding check
NUM = re.compile(r"-?£?\s?\d[\d,]*(?:\.\d+)?")


def _is_number(v) -> bool:
    return isinstance(v, (int, float, Decimal)) and not isinstance(v, bool)


def numbers_are_grounded(answer: str, rows: list[dict]) -> tuple[bool, set]:
    """Assert every number in the prose appears in (or derives simply from)
    the query result. Cheap detector for the one failure that destroys trust:
    a fabricated figure. Run as a WARNING that queues human review — it will
    flag legitimate derived figures (deltas, % of %), and cannot see a number
    the model should have mentioned but didn't."""
    claimed = set()
    for m in NUM.findall(answer):
        try:
            claimed.add(float(m.replace("£", "").replace(",", "").strip()))
        except ValueError:
            pass
    present = {round(float(v), 2) for r in rows for v in r.values() if _is_number(v)}
    present |= {float(len(rows))}                       # "7 sites are over budget"
    for col in (rows[0].keys() if rows else []):        # legitimate derived totals
        vals = [float(r[col]) for r in rows if _is_number(r.get(col))]
        if vals:
            present |= {round(sum(vals), 2), round(sum(vals) / len(vals), 2)}
    ungrounded = {c for c in claimed
                  if not any(abs(c - p) <= 0.01 * max(1, abs(p)) for p in present)}
    return not ungrounded, ungrounded
