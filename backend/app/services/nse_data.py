"""Real daily history store built from the free NSE archives.

``app/data/nse_daily.csv.gz`` holds raw (unadjusted) daily bars for every
instrument in the universe, built by ``scripts/build_nse_history.py``. NSE's
bhavcopy is *not* adjusted for corporate actions (its previous close on a
bonus ex-date is still the old price), so at read time each series is
back-adjusted with split/bonus events from the public Yahoo chart endpoint,
stored in ``app/data/nse_actions.json``. Demergers, which Yahoo does not list,
are adjusted from NSE's own ex-date opening price.

On startup the server tops the file up with any trading days published since
it was built (best effort — if NSE is unreachable the stored history is used
as is). Symbols missing from the store fall back to the simulated research
series, and :func:`source_for` says which one a caller got.
"""
from __future__ import annotations

import csv
import gzip
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.services import nse_archive

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_FILE = DATA_DIR / "nse_daily.csv.gz"
ISIN_FILE = DATA_DIR / "nse_isin.json"
ACTIONS_FILE = DATA_DIR / "nse_actions.json"
FIELDS = ("symbol", "date", "open", "high", "low", "close", "prev_close", "volume")

# SENSEX is a BSE index, so it is not in the NSE archive; its history comes
# from the public Yahoo chart endpoint instead.
YAHOO_ONLY = {"SENSEX": "^BSESN"}

# Demergers: symbol -> ex-date. The factor comes from the ex-date open versus
# the previous close, i.e. the value that moved to the new company.
DEMERGERS = {
    "TATAMOTORS": "2025-10-14",  # commercial vehicles demerged into TMCV
    "SIEMENS": "2025-04-07",     # Siemens Energy India demerged
    "VEDL": "2026-04-30",        # Vedanta business demerger
    "MOTHERSON": "2022-01-14",   # Motherson Sumi restructuring
}

# Same-day split + bonus that Yahoo records as a single event; these replace
# Yahoo's entry for that date. Multiplier applies to every earlier bar.
MANUAL_ACTIONS = {
    "BAJFINANCE": [("2025-06-16", 0.1)],  # 1:2 split and 4:1 bonus
    "BAJAJFINSV": [("2022-09-13", 0.1)],  # 1:5 split and 1:1 bonus
}

_lock = threading.RLock()
_raw: dict[str, list[dict]] = {}
_actions: dict[str, list[list]] = {}
_adjusted: dict[str, list[dict]] = {}
_loaded = False
_status: dict[str, Any] = {"last_update_attempt": None, "last_update_error": None, "days_added": 0}


# ──────────────────────────────────────────────────────────────────────────
# Loading and reading
# ──────────────────────────────────────────────────────────────────────────
def _ensure_loaded() -> None:
    global _loaded
    if _loaded:
        return
    with _lock:
        if _loaded:
            return
        if ACTIONS_FILE.exists():
            _actions.update(json.loads(ACTIONS_FILE.read_text(encoding="utf-8")))
        if DATA_FILE.exists():
            with gzip.open(DATA_FILE, "rt", encoding="utf-8", newline="") as handle:
                for row in csv.DictReader(handle):
                    _raw.setdefault(row["symbol"], []).append({
                        "date": row["date"],
                        "open": float(row["open"]), "high": float(row["high"]),
                        "low": float(row["low"]), "close": float(row["close"]),
                        "prev_close": float(row["prev_close"] or 0),
                        "volume": int(float(row["volume"] or 0)),
                    })
            for rows in _raw.values():
                rows.sort(key=lambda r: r["date"])
        _loaded = True


def _epoch(day: str) -> int:
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


def _events(symbol: str, rows: list[dict]) -> list[tuple[str, float]]:
    """(ex-date, price multiplier for earlier bars) for every corporate action."""
    manual = MANUAL_ACTIONS.get(symbol, [])
    manual_days = {day for day, _ in manual}
    events = [(day, float(factor)) for day, factor in _actions.get(symbol, []) if day not in manual_days]
    events += manual
    ex_date = DEMERGERS.get(symbol)
    if ex_date:
        before = [r for r in rows if r["date"] < ex_date]
        on = next((r for r in rows if r["date"] >= ex_date), None)
        if before and on and before[-1]["close"] > 0:
            events.append((on["date"], on["open"] / before[-1]["close"]))
    return events


def _adjust(rows: list[dict], events: list[tuple[str, float]]) -> list[dict]:
    """Back-adjust OHLC (and volume) for corporate actions, newest bar unchanged."""
    factors = []
    for row in rows:
        factor = 1.0
        for day, multiplier in events:
            if row["date"] < day:
                factor *= multiplier
        factors.append(factor)
    out = []
    for row, factor in zip(rows, factors):
        out.append({
            "time": _epoch(row["date"]),
            "open": round(row["open"] * factor, 2),
            "high": round(row["high"] * factor, 2),
            "low": round(row["low"] * factor, 2),
            "close": round(row["close"] * factor, 2),
            "volume": int(row["volume"] / factor) if factor > 0 else row["volume"],
        })
    return out


def candles(symbol: str) -> list[dict]:
    """Adjusted daily candles for ``symbol``, oldest first. Empty when not stored."""
    _ensure_loaded()
    with _lock:
        if symbol not in _adjusted:
            rows = _raw.get(symbol)
            _adjusted[symbol] = _adjust(rows, _events(symbol, rows)) if rows else []
        return _adjusted[symbol]


def has(symbol: str, minimum: int = 80) -> bool:
    return len(candles(symbol)) >= minimum


def last_close(symbol: str) -> float | None:
    series = candles(symbol)
    return float(series[-1]["close"]) if series else None


def source_for(symbol: str) -> str:
    if not has(symbol):
        return "simulated"
    if symbol in YAHOO_ONLY:
        return "BSE index via Yahoo Finance"
    if symbol in nse_archive.INDEX_NAMES:
        return "NSE index archive"
    return "NSE bhavcopy"


def status() -> dict[str, Any]:
    _ensure_loaded()
    with _lock:
        last = max((rows[-1]["date"] for rows in _raw.values() if rows), default=None)
        first = min((rows[0]["date"] for rows in _raw.values() if rows), default=None)
        return {
            "symbols": sum(1 for rows in _raw.values() if len(rows) >= 80),
            "first_date": first, "last_date": last,
            "file": DATA_FILE.name if DATA_FILE.exists() else None,
            **_status,
        }


# ──────────────────────────────────────────────────────────────────────────
# Building and updating
# ──────────────────────────────────────────────────────────────────────────
def _load_isins() -> dict[str, str]:
    if ISIN_FILE.exists():
        return json.loads(ISIN_FILE.read_text(encoding="utf-8"))
    return {}


def resolve_isins(stock_symbols: list[str], lookback_days: int = 10) -> dict[str, str]:
    """Map each MarketMind stock to its ISIN using the latest available bhavcopy."""
    today = date.today()
    for back in range(lookback_days):
        day = today - timedelta(days=back)
        if day.weekday() >= 5:
            continue
        rows = nse_archive.fetch_equity_day(day)
        if not rows:
            continue
        by_ticker = {}
        for row in rows:  # prefer the normal EQ book when a ticker trades in two
            if row["ticker"] not in by_ticker or row["series"] == "EQ":
                by_ticker[row["ticker"]] = row["isin"]
        out = {}
        for symbol in stock_symbols:
            ticker = nse_archive.TICKER_ALIASES.get(symbol, symbol)
            if ticker in by_ticker:
                out[symbol] = by_ticker[ticker]
        return out
    return {}


def _collect_day(day: date, isin_to_symbol: dict[str, str], ticker_to_symbol: dict[str, str]) -> list[dict]:
    """One day's rows for the universe, matched by ISIN first, then by ticker.

    A face-value split issues a new ISIN, so days before the split only match
    on the ticker.
    """
    rows: list[dict] = []
    stamp = day.isoformat()
    equity = nse_archive.fetch_equity_day(day)
    if equity:
        best: dict[str, dict] = {}
        by_isin: set[str] = set()
        for row in equity:
            symbol = isin_to_symbol.get(row["isin"])
            if symbol and row["close"] > 0 and (symbol not in best or row["series"] == "EQ"):
                best[symbol] = row
                by_isin.add(symbol)
        for row in equity:
            symbol = ticker_to_symbol.get(row["ticker"])
            if (symbol and symbol not in by_isin and row["close"] > 0
                    and (symbol not in best or row["series"] == "EQ")):
                best[symbol] = row
        for symbol, row in best.items():
            rows.append({"symbol": symbol, "date": stamp, **{k: row[k] for k in FIELDS[2:]}})
    indices = nse_archive.fetch_index_day(day)
    if indices:
        for symbol, name in nse_archive.INDEX_NAMES.items():
            row = indices.get(name)
            if row:
                rows.append({"symbol": symbol, "date": stamp, **{k: row[k] for k in FIELDS[2:]}})
    return rows


def fetch_yahoo_daily(ticker: str, rng: str = "10y") -> list[dict]:
    """Daily bars from the public Yahoo chart endpoint (used for SENSEX)."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(ticker)}?interval=1d&range={rng}")
    request = urllib.request.Request(url, headers={"User-Agent": nse_archive.USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8"))
        result = payload["chart"]["result"][0]
        quote = result["indicators"]["quote"][0]
    except Exception as exc:  # network, schema or rate limit
        logger.warning("Yahoo history for %s unavailable: %s", ticker, exc)
        return []
    rows = []
    for i, ts in enumerate(result.get("timestamp") or []):
        o, h, l, c = (quote[k][i] for k in ("open", "high", "low", "close"))
        if None in (o, h, l, c) or c <= 0:
            continue
        day = datetime.fromtimestamp(ts + 19800, timezone.utc).date().isoformat()  # IST date
        rows.append({"date": day, "open": round(o, 2), "high": round(h, 2), "low": round(l, 2),
                     "close": round(c, 2), "prev_close": 0.0, "volume": int(quote["volume"][i] or 0)})
    return rows


def build(stock_symbols: list[str], start: date, end: date | None = None,
          workers: int = 6, progress=None, refresh_corporate_actions: bool = True) -> dict[str, int]:
    """Download ``start``..``end`` from NSE into memory (merged with what is stored)."""
    _ensure_loaded()
    end = end or date.today()
    isins = resolve_isins(stock_symbols) or _load_isins()
    if not isins:
        raise RuntimeError("Could not reach the NSE archive to resolve ISINs.")
    isin_to_symbol = {isin: symbol for symbol, isin in isins.items()}
    ticker_to_symbol = {s: s for s in stock_symbols}
    ticker_to_symbol.update({nse_archive.TICKER_ALIASES.get(s, s): s for s in stock_symbols})
    have = {(sym, r["date"]) for sym, rows in _raw.items() for r in rows}
    days = [d for d in nse_archive.weekdays(start, end)]

    added = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for done, rows in enumerate(pool.map(lambda d: _collect_day(d, isin_to_symbol, ticker_to_symbol), days), 1):
            with _lock:
                for row in rows:
                    key = (row["symbol"], row["date"])
                    if key not in have:
                        have.add(key)
                        _raw.setdefault(row["symbol"], []).append({k: row[k] for k in FIELDS[1:]})
                        added += 1
            if progress:
                progress(done, len(days))

    for symbol, ticker in YAHOO_ONLY.items():
        years = max(1, (end - start).days // 365 + 1)
        for row in fetch_yahoo_daily(ticker, f"{min(10, years)}y"):
            if start.isoformat() <= row["date"] <= end.isoformat() and (symbol, row["date"]) not in have:
                have.add((symbol, row["date"]))
                _raw.setdefault(symbol, []).append(row)
                added += 1

    if refresh_corporate_actions:
        refresh_actions(stock_symbols)
    with _lock:
        for rows in _raw.values():
            rows.sort(key=lambda r: r["date"])
        _adjusted.clear()
    ISIN_FILE.parent.mkdir(parents=True, exist_ok=True)
    ISIN_FILE.write_text(json.dumps(isins, indent=1, sort_keys=True), encoding="utf-8")
    return {"days_scanned": len(days), "rows_added": added, "isins": len(isins)}


def fetch_split_events(symbol: str) -> list[list] | None:
    """Split and bonus events for one NSE stock as [ex-date, multiplier] pairs."""
    ticker = nse_archive.TICKER_ALIASES.get(symbol, symbol)
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(ticker)}.NS?interval=1d&range=10y&events=split")
    request = urllib.request.Request(url, headers={"User-Agent": nse_archive.USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))["chart"]["result"][0]
    except Exception as exc:
        logger.info("Split events for %s unavailable: %s", symbol, exc)
        return None
    events = []
    for split in ((result.get("events") or {}).get("splits") or {}).values():
        numerator, denominator = float(split.get("numerator") or 0), float(split.get("denominator") or 0)
        if numerator > 0 and denominator > 0:
            day = datetime.fromtimestamp(int(split["date"]) + 19800, timezone.utc).date().isoformat()
            events.append([day, round(denominator / numerator, 8)])
    return sorted(events)


def refresh_actions(stock_symbols: list[str], workers: int = 4) -> int:
    """Re-download split/bonus events; keeps the stored list for any symbol that fails."""
    with ThreadPoolExecutor(max_workers=workers) as pool:
        fetched = dict(zip(stock_symbols, pool.map(fetch_split_events, stock_symbols)))
    with _lock:
        for symbol, events in fetched.items():
            if events is not None:
                _actions[symbol] = events
        _adjusted.clear()
        ACTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
        ACTIONS_FILE.write_text(json.dumps(_actions, indent=0, sort_keys=True), encoding="utf-8")
    return sum(1 for events in fetched.values() if events is not None)


def save() -> None:
    with _lock:
        DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = DATA_FILE.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(FIELDS)
            for symbol in sorted(_raw):
                for r in _raw[symbol]:
                    writer.writerow([symbol, r["date"], r["open"], r["high"], r["low"],
                                     r["close"], r["prev_close"], r["volume"]])
        os.replace(tmp, DATA_FILE)


def update_recent(stock_symbols: list[str], max_days: int = 60) -> dict[str, Any]:
    """Fetch trading days published since the stored history ends."""
    _ensure_loaded()
    _status["last_update_attempt"] = datetime.now(timezone.utc).isoformat()
    last = status()["last_date"]
    start = (datetime.strptime(last, "%Y-%m-%d").date() + timedelta(days=1)) if last else date.today() - timedelta(days=max_days)
    start = max(start, date.today() - timedelta(days=max_days))
    if start > date.today():
        return {"rows_added": 0}
    try:
        result = build(stock_symbols, start, workers=3, refresh_corporate_actions=False)
        stale = not ACTIONS_FILE.exists() or time.time() - ACTIONS_FILE.stat().st_mtime > 20 * 3600
        if result["rows_added"] and stale:  # a new session may carry a fresh ex-date
            refresh_actions(stock_symbols)
        _status["days_added"] = result["rows_added"]
        _status["last_update_error"] = None
        if result["rows_added"]:
            try:
                save()
            except OSError as exc:  # read-only filesystem: keep the in-memory update
                logger.info("NSE history kept in memory only: %s", exc)
        return result
    except Exception as exc:
        _status["last_update_error"] = str(exc)
        logger.warning("NSE history update failed: %s", exc)
        return {"rows_added": 0, "error": str(exc)}


def start_background_updates(stock_symbols: list[str], every_hours: float = 6.0) -> None:
    """Top up the history now and every few hours, without blocking startup."""
    if os.getenv("NSE_AUTO_UPDATE", "1") == "0":
        return

    def loop() -> None:
        while True:
            update_recent(stock_symbols)
            time.sleep(every_hours * 3600)

    threading.Thread(target=loop, name="nse-history-updater", daemon=True).start()
