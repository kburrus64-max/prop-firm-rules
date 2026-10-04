"""prop-firm-rules: sourced prop-firm drawdown rules + a small calculator (Python port of js/calc.mjs).

MIT License. https://github.com/kburrus64-max/prop-firm-rules
Rules change often: always confirm against your firm's dashboard. Not financial advice.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

__all__ = ["GREEN", "AMBER", "RED", "load_rules", "list_programs", "get_program", "get_firm",
           "rule_amount", "classify", "daily_loss", "max_drawdown", "max_lots", "evaluate", "check"]
__version__ = "0.1.0"

GREEN, AMBER, RED = "green", "amber", "red"
AMBER_AT = 0.5  # <= 50% of the allowance left -> amber
RED_AT = 0.2    # <= 20% left (or breached) -> red
_RANK = {GREEN: 0, AMBER: 1, RED: 2}
_DEFAULT_DATA = Path(__file__).resolve().parents[2] / "data" / "firms.json"


def _num(v, fallback=math.nan):
    if v is None or v == "":
        return fallback
    try:
        f = float(v)
    except (TypeError, ValueError):
        return fallback
    return fallback if math.isnan(f) else f


def load_rules(path: str | Path | None = None) -> dict:
    """Load the rules dataset (defaults to the repo's data/firms.json)."""
    with open(path or _DEFAULT_DATA, encoding="utf-8") as fh:
        return json.load(fh)


def list_programs(rules: dict | None = None) -> list[dict]:
    rules = rules or load_rules()
    return [{"firmId": f["id"], "firmName": f["name"], **p} for f in rules["firms"] for p in f["programs"]]


def get_program(program_id: str, rules: dict | None = None) -> dict | None:
    return next((p for p in list_programs(rules) if p["id"] == program_id), None)


def get_firm(firm_id: str, rules: dict | None = None) -> dict | None:
    rules = rules or load_rules()
    return next((f for f in rules["firms"] if f["id"] == firm_id), None)


def rule_amount(rule, size, initial, reference):
    """Dollar amount of a rule for a given account size / initial balance / reference value."""
    if not rule:
        return None
    if "amountBySize" in rule:
        a = rule["amountBySize"].get(str(int(size)) if float(size).is_integer() else str(size))
        return None if a is None else float(a)
    if "amount" in rule:
        return float(rule["amount"])
    if "pct" in rule:
        base = reference if rule.get("amountBase") == "reference" else initial
        return rule["pct"] / 100 * base
    return None


def classify(room, amount):
    if amount is None or not amount > 0:
        return None
    if room <= 0:
        return RED
    left = room / amount
    if left <= RED_AT:
        return RED
    if left <= AMBER_AT:
        return AMBER
    return GREEN


def _worst(*statuses):
    out = GREEN
    for s in statuses:
        if s and _RANK[s] > _RANK[out]:
            out = s
    return out


def daily_loss(rule, size, initial, day_start_balance, day_start_equity, measured):
    if not rule:
        return None
    reference = max(day_start_balance, day_start_equity) if rule.get("reference") == "max" else day_start_balance
    amount = rule_amount(rule, size, initial, reference)
    if amount is None:
        return None
    floor = reference - amount
    room = measured - floor
    return {"kind": rule.get("kind", "hard"), "reference": reference, "amount": amount, "floor": floor,
            "room": room, "status": classify(room, amount)}


def max_drawdown(rule, size, initial, measured, high_water_mark=None, current_balance=None, current_equity=None):
    """highWaterMark: highest EOD balance (trailing_eod), highest closed balance (trailing_closed) or peak incl.
    open profit (trailing_intraday)."""
    if not rule:
        return None
    amount = rule_amount(rule, size, initial, initial)
    if amount is None:
        return None
    peak = initial
    if rule["mode"] == "static":
        floor = initial - amount
    else:
        peak = max(initial, _num(high_water_mark, initial))
        if rule["mode"] == "trailing_closed" and current_balance is not None:
            peak = max(peak, current_balance)
        if rule["mode"] == "trailing_intraday":
            peak = max(peak, *(v for v in (current_balance, current_equity) if v is not None))
        floor = peak - amount
        if rule.get("lockAt") is not None:
            floor = min(floor, initial + float(rule["lockAt"]))
    room = measured - floor
    return {"mode": rule["mode"], "amount": amount, "peak": peak, "floor": floor, "room": room,
            "status": classify(room, amount)}


def max_lots(room, stop_distance, value_per_unit, buffer_amount=0.0, lot_step=0.01):
    """Largest size (rounded down to lot_step) whose stop-out keeps you above the buffered floor."""
    risk_per_lot = _num(stop_distance) * _num(value_per_unit)
    if not risk_per_lot > 0:
        return None
    usable = room - buffer_amount
    if not usable > 0:
        return 0
    steps = math.floor(usable / risk_per_lot / lot_step + 1e-9)
    return round(steps * lot_step, 6)


def evaluate(program, size, initial=None, current_balance=None, current_equity=None, today_pnl=0,
             day_start_balance=None, day_start_equity=None, high_water_mark=None, custom_daily_amount=None,
             stop_distance=None, value_per_unit=None, lot_step=0.01, buffer_pct=0):
    """Full check, same semantics as evaluate() in js/calc.mjs."""
    size = _num(size)
    initial = _num(initial, size)
    current_balance = _num(current_balance, initial)
    current_equity = _num(current_equity, current_balance)
    today_pnl = _num(today_pnl, 0)
    day_start_equity = _num(day_start_equity, current_equity - today_pnl)
    day_start_balance = _num(day_start_balance, day_start_equity)
    measured = min(current_balance, current_equity)  # conservative

    d_rule = program.get("dailyLoss")
    custom = _num(custom_daily_amount)
    if not d_rule and custom > 0:
        d_rule = {"amount": custom, "reference": "balance", "kind": "pause"}
    daily = daily_loss(d_rule, size, initial, day_start_balance, day_start_equity, measured)
    dd_rule = program.get("maxDrawdown")
    hwm_default = max(initial, day_start_balance) if dd_rule and dd_rule.get("mode") == "trailing_eod" else max(initial, current_balance)
    dd = max_drawdown(dd_rule, size, initial, measured, _num(high_water_mark, hwm_default), current_balance, current_equity)

    buf = min(max(_num(buffer_pct, 0), 0), 95) / 100
    binding = None
    for lim in (x for x in (daily, dd) if x):
        usable = lim["room"] - buf * lim["amount"]
        if binding is None or usable < binding[1]:
            binding = (lim, usable)
    lots = None
    if binding:
        lots = max_lots(binding[0]["room"], stop_distance, value_per_unit, buf * binding[0]["amount"], _num(lot_step, 0.01))
    return {"size": size, "initial": initial, "measured": measured, "daily": daily, "drawdown": dd, "maxLots": lots,
            "bindingLimit": None if not binding else ("daily" if binding[0] is daily else "drawdown"),
            "status": _worst(daily and daily["status"], dd and dd["status"])}


def check(program_id: str, rules: dict | None = None, **kwargs) -> dict:
    """evaluate() with a program id, e.g. check("ftmo_2step", size=100000, current_balance=102000)."""
    program = get_program(program_id, rules)
    if program is None:
        raise KeyError(f"Unknown program id: {program_id}")
    return evaluate(program, **kwargs)
