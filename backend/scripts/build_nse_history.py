"""Download real daily history for the whole universe from the free NSE archives.

Usage (from the backend folder):
    .venv\\Scripts\\python scripts\\build_nse_history.py            # last 5.5 years
    .venv\\Scripts\\python scripts\\build_nse_history.py --years 2  # shorter window

Writes app/data/nse_daily.csv.gz and app/data/nse_isin.json. Re-running only
adds days that are missing, so it doubles as a manual "update" command.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import nse_data  # noqa: E402
from app.services.universe import INSTRUMENTS  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--years", type=float, default=5.5, help="how many years back to download")
    parser.add_argument("--workers", type=int, default=6, help="parallel downloads (be polite)")
    args = parser.parse_args()

    stocks = [s for s, meta in INSTRUMENTS.items() if meta["kind"] != "index"]
    start = date.today() - timedelta(days=int(args.years * 365.25))
    began = time.time()

    def progress(done: int, total: int) -> None:
        if done % 50 == 0 or done == total:
            print(f"  {done}/{total} trading days scanned ({time.time() - began:.0f}s)", flush=True)

    print(f"Downloading NSE archives from {start} for {len(stocks)} stocks + indices ...", flush=True)
    result = nse_data.build(stocks, start, workers=args.workers, progress=progress)
    nse_data.save()
    info = nse_data.status()
    print(f"Done: {result['rows_added']} new rows, {info['symbols']} symbols, "
          f"{info['first_date']} to {info['last_date']}.")
    missing = [s for s in INSTRUMENTS if not nse_data.has(s)]
    if missing:
        print("No usable history (will stay simulated):", ", ".join(missing))


if __name__ == "__main__":
    main()
