"""Free, official NSE end-of-day archives.

NSE publishes every trading day's results as public files on
``nsearchives.nseindia.com`` — no account, key or licence is needed to
download them for research:

* **Equity bhavcopy** — open/high/low/close/volume for every listed security.
  Since mid-2024 NSE uses the "UDiFF" CSV (``BhavCopy_NSE_CM_…``); older days
  are in the legacy ``cmDDMONYYYYbhav.csv`` file. Both are read here.
* **Index close file** (``ind_close_all_DDMMYYYY.csv``) — OHLC for every Nifty
  index and India VIX.

Rows are matched by **ISIN**, not ticker, so renames and demergers that keep
the ISIN (e.g. Tata Motors → TMPV) stay one continuous history.
"""
from __future__ import annotations

import csv
import io
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date, timedelta

BASE = "https://nsearchives.nseindia.com/content"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
EQUITY_SERIES = ("EQ", "BE", "BZ")  # normal, trade-for-trade and suspended-ish books

# MarketMind symbol -> NSE ticker, where they differ today.
TICKER_ALIASES = {"TATAMOTORS": "TMPV", "CEAT": "CEATLTD"}

# MarketMind index symbol -> name in ind_close_all (matched case-insensitively).
INDEX_NAMES = {
    "NIFTY 50": "nifty 50",
    "NIFTY NEXT 50": "nifty next 50",
    "NIFTY 100": "nifty 100",
    "BANKNIFTY": "nifty bank",
    "NIFTY MIDCAP 100": "nifty midcap 100",
    "NIFTY MIDCAP 150": "nifty midcap 150",
    "NIFTY SMALLCAP 100": "nifty smallcap 100",
    "NIFTY SMALLCAP 250": "nifty smallcap 250",
    "NIFTY PHARMA": "nifty pharma",
    "NIFTY HEALTHCARE": "nifty healthcare index",
    "INDIA VIX": "india vix",
}

_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


def _get(url: str, timeout: float = 20.0) -> bytes | None:
    """Fetch one archive file. ``None`` means "no file" (holiday) or unreachable."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                return None
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.8 * (attempt + 1))
    return None


def _unzip_first(blob: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        return archive.read(archive.namelist()[0]).decode("utf-8", errors="replace")


def _num(value: str | None) -> float:
    try:
        return float((value or "").strip() or 0)
    except ValueError:
        return 0.0


def fetch_equity_day(day: date) -> list[dict] | None:
    """Equity rows for one trading day, or None when NSE has no file for it."""
    stamp = day.strftime("%Y%m%d")
    blob = _get(f"{BASE}/cm/BhavCopy_NSE_CM_0_0_0_{stamp}_F_0000.csv.zip")
    if blob:
        rows = []
        for row in csv.DictReader(io.StringIO(_unzip_first(blob))):
            if row.get("SctySrs") in EQUITY_SERIES:
                rows.append({
                    "isin": row.get("ISIN", ""), "ticker": row.get("TckrSymb", ""),
                    "series": row.get("SctySrs", ""),
                    "open": _num(row.get("OpnPric")), "high": _num(row.get("HghPric")),
                    "low": _num(row.get("LwPric")), "close": _num(row.get("ClsPric")),
                    "prev_close": _num(row.get("PrvsClsgPric")),
                    "volume": int(_num(row.get("TtlTradgVol"))),
                })
        return rows

    mon = _MONTHS[day.month - 1]
    blob = _get(f"{BASE}/historical/EQUITIES/{day.year}/{mon}/cm{day.day:02d}{mon}{day.year}bhav.csv.zip")
    if not blob:
        return None
    rows = []
    for row in csv.DictReader(io.StringIO(_unzip_first(blob))):
        row = {k.strip(): v for k, v in row.items() if k}
        if row.get("SERIES", "").strip() in EQUITY_SERIES:
            rows.append({
                "isin": row.get("ISIN", "").strip(), "ticker": row.get("SYMBOL", "").strip(),
                "series": row.get("SERIES", "").strip(),
                "open": _num(row.get("OPEN")), "high": _num(row.get("HIGH")),
                "low": _num(row.get("LOW")), "close": _num(row.get("CLOSE")),
                "prev_close": _num(row.get("PREVCLOSE")),
                "volume": int(_num(row.get("TOTTRDQTY"))),
            })
    return rows


def fetch_index_day(day: date) -> dict[str, dict] | None:
    """Index OHLC for one trading day keyed by lower-case index name."""
    blob = _get(f"{BASE}/indices/ind_close_all_{day.strftime('%d%m%Y')}.csv")
    if not blob:
        return None
    out: dict[str, dict] = {}
    for row in csv.DictReader(io.StringIO(blob.decode("utf-8", errors="replace"))):
        name = (row.get("Index Name") or "").strip().lower()
        close = _num(row.get("Closing Index Value"))
        if not name or close <= 0:
            continue
        change = _num(row.get("Points Change"))
        out[name] = {
            "open": _num(row.get("Open Index Value")) or close,
            "high": _num(row.get("High Index Value")) or close,
            "low": _num(row.get("Low Index Value")) or close,
            "close": close,
            "prev_close": round(close - change, 4) if change else 0.0,
            "volume": int(_num(row.get("Volume"))),
        }
    return out


def weekdays(start: date, end: date):
    day = start
    while day <= end:
        if day.weekday() < 5:
            yield day
        day += timedelta(days=1)
