"""Indian-market research universe.

Symbols are grouped the way a trader browses them: headline indices, the
Nifty 50 constituents, the rest of the Nifty 100 (Nifty Next 50), a liquid
Nifty Midcap basket, a liquid Nifty Smallcap basket, and a Pharma & Healthcare
set. Prices are demo base levels for the simulated feed, not live quotes.
"""
from __future__ import annotations

from typing import Any

# (symbol, company, sector, demo base price)
NIFTY_50: list[tuple[str, str, str, float]] = [
    ("ADANIENT", "Adani Enterprises", "Diversified", 2480),
    ("ADANIPORTS", "Adani Ports", "Infrastructure", 1285),
    ("APOLLOHOSP", "Apollo Hospitals", "Healthcare", 7240),
    ("ASIANPAINT", "Asian Paints", "Consumer", 2460),
    ("AXISBANK", "Axis Bank", "Banking", 1135),
    ("BAJAJ-AUTO", "Bajaj Auto", "Auto", 9860),
    ("BAJFINANCE", "Bajaj Finance", "Finance", 7280),
    ("BAJAJFINSV", "Bajaj Finserv", "Finance", 1695),
    ("BEL", "Bharat Electronics", "Industrials", 292),
    ("BHARTIARTL", "Bharti Airtel", "Telecom", 1688),
    ("BPCL", "Bharat Petroleum", "Energy", 312),
    ("BRITANNIA", "Britannia Industries", "FMCG", 5420),
    ("CIPLA", "Cipla", "Pharma", 1545),
    ("COALINDIA", "Coal India", "Energy", 418),
    ("DRREDDY", "Dr. Reddy's Laboratories", "Pharma", 1290),
    ("EICHERMOT", "Eicher Motors", "Auto", 4920),
    ("GRASIM", "Grasim Industries", "Materials", 2680),
    ("HCLTECH", "HCL Technologies", "IT", 1690),
    ("HDFCBANK", "HDFC Bank", "Banking", 1628.40),
    ("HDFCLIFE", "HDFC Life Insurance", "Insurance", 688),
    ("HEROMOTOCO", "Hero MotoCorp", "Auto", 4540),
    ("HINDALCO", "Hindalco Industries", "Metals", 692),
    ("HINDUNILVR", "Hindustan Unilever", "FMCG", 2465),
    ("ICICIBANK", "ICICI Bank", "Banking", 1295),
    ("INDUSINDBK", "IndusInd Bank", "Banking", 980),
    ("INFY", "Infosys", "IT", 1461.55),
    ("ITC", "ITC", "FMCG", 462),
    ("JSWSTEEL", "JSW Steel", "Metals", 965),
    ("KOTAKBANK", "Kotak Mahindra Bank", "Banking", 1865),
    ("LT", "Larsen & Toubro", "Infrastructure", 3620),
    ("M&M", "Mahindra & Mahindra", "Auto", 2910),
    ("MARUTI", "Maruti Suzuki", "Auto", 12640),
    ("NESTLEIND", "Nestle India", "FMCG", 2320),
    ("NTPC", "NTPC", "Power", 362),
    ("ONGC", "ONGC", "Energy", 258),
    ("POWERGRID", "Power Grid Corporation", "Power", 318),
    ("RELIANCE", "Reliance Industries", "Energy", 2942.60),
    ("SBILIFE", "SBI Life Insurance", "Insurance", 1560),
    ("SBIN", "State Bank of India", "Banking", 824),
    ("SHRIRAMFIN", "Shriram Finance", "Finance", 628),
    ("SUNPHARMA", "Sun Pharmaceutical", "Pharma", 1765),
    ("TATACONSUM", "Tata Consumer Products", "FMCG", 1095),
    ("TATAMOTORS", "Tata Motors", "Auto", 1014.20),
    ("TATASTEEL", "Tata Steel", "Metals", 156),
    ("TCS", "Tata Consultancy Services", "IT", 3881.20),
    ("TECHM", "Tech Mahindra", "IT", 1580),
    ("TITAN", "Titan Company", "Consumer", 3420),
    ("TRENT", "Trent", "Consumer", 5480),
    ("ULTRACEMCO", "UltraTech Cement", "Materials", 11320),
    ("WIPRO", "Wipro", "IT", 286),
]

# The other half of the Nifty 100 (Nifty Next 50).
NIFTY_NEXT_50: list[tuple[str, str, str, float]] = [
    ("ABB", "ABB India", "Industrials", 6850),
    ("ADANIGREEN", "Adani Green Energy", "Power", 1680),
    ("ADANIPOWER", "Adani Power", "Power", 548),
    ("AMBUJACEM", "Ambuja Cements", "Materials", 565),
    ("BAJAJHLDNG", "Bajaj Holdings", "Finance", 11240),
    ("BANKBARODA", "Bank of Baroda", "Banking", 248),
    ("BOSCHLTD", "Bosch", "Auto", 32400),
    ("CANBK", "Canara Bank", "Banking", 104),
    ("CHOLAFIN", "Cholamandalam Investment", "Finance", 1425),
    ("DLF", "DLF", "Realty", 812),
    ("DMART", "Avenue Supermarts", "Consumer", 3920),
    ("GAIL", "GAIL India", "Energy", 198),
    ("GODREJCP", "Godrej Consumer Products", "FMCG", 1185),
    ("HAL", "Hindustan Aeronautics", "Industrials", 4280),
    ("HAVELLS", "Havells India", "Consumer", 1680),
    ("HDFCAMC", "HDFC AMC", "Finance", 4285),
    ("ICICIGI", "ICICI Lombard", "Insurance", 1860),
    ("ICICIPRULI", "ICICI Prudential Life", "Insurance", 645),
    ("IOC", "Indian Oil Corporation", "Energy", 152),
    ("INDHOTEL", "Indian Hotels", "Consumer", 742),
    ("INDIGO", "InterGlobe Aviation", "Consumer", 4520),
    ("IRFC", "Indian Railway Finance", "Finance", 148),
    ("JINDALSTEL", "Jindal Steel", "Metals", 920),
    ("JIOFIN", "Jio Financial Services", "Finance", 328),
    ("JSWENERGY", "JSW Energy", "Power", 620),
    ("LICI", "Life Insurance Corporation", "Insurance", 980),
    ("LODHA", "Macrotech Developers", "Realty", 1288),
    ("MAXHEALTH", "Max Healthcare", "Healthcare", 1125),
    ("MOTHERSON", "Samvardhana Motherson", "Auto", 148),
    ("NAUKRI", "Info Edge (Naukri)", "IT", 7680),
    ("PFC", "Power Finance Corporation", "Finance", 452),
    ("PIDILITIND", "Pidilite Industries", "Materials", 2980),
    ("PNB", "Punjab National Bank", "Banking", 108),
    ("RECLTD", "REC", "Finance", 498),
    ("SHREECEM", "Shree Cement", "Materials", 27850),
    ("SIEMENS", "Siemens", "Industrials", 6420),
    ("TATAPOWER", "Tata Power", "Power", 412),
    ("TORNTPHARM", "Torrent Pharmaceuticals", "Pharma", 3280),
    ("TVSMOTOR", "TVS Motor", "Auto", 2485),
    ("UNITDSPR", "United Spirits", "FMCG", 1480),
    ("VBL", "Varun Beverages", "FMCG", 580),
    ("VEDL", "Vedanta", "Metals", 465),
    ("ZYDUSLIFE", "Zydus Lifesciences", "Pharma", 1045),
    ("DABUR", "Dabur India", "FMCG", 545),
    ("DIVISLAB", "Divi's Laboratories", "Pharma", 5820),
    ("MUTHOOTFIN", "Muthoot Finance", "Finance", 1980),
    ("POLYCAB", "Polycab India", "Industrials", 6480),
    ("CUMMINSIND", "Cummins India", "Industrials", 3420),
    ("COLPAL", "Colgate-Palmolive India", "FMCG", 2860),
    ("CGPOWER", "CG Power", "Industrials", 720),
]

NIFTY_MIDCAP: list[tuple[str, str, str, float]] = [
    ("PERSISTENT", "Persistent Systems", "IT", 5480),
    ("COFORGE", "Coforge", "IT", 7920),
    ("LTTS", "L&T Technology Services", "IT", 4680),
    ("MPHASIS", "Mphasis", "IT", 2860),
    ("OFSS", "Oracle Financial Services", "IT", 11240),
    ("DIXON", "Dixon Technologies", "Consumer", 14280),
    ("VOLTAS", "Voltas", "Consumer", 1520),
    ("SUPREMEIND", "Supreme Industries", "Materials", 4280),
    ("PAGEIND", "Page Industries", "Consumer", 42850),
    ("MRF", "MRF", "Auto", 128400),
    ("BALKRISIND", "Balkrishna Industries", "Auto", 2680),
    ("PIIND", "PI Industries", "Chemicals", 3920),
    ("SRF", "SRF", "Chemicals", 2480),
    ("DEEPAKNTR", "Deepak Nitrite", "Chemicals", 2485),
    ("ASTRAL", "Astral", "Industrials", 1620),
    ("GODREJPROP", "Godrej Properties", "Realty", 2680),
    ("PRESTIGE", "Prestige Estates", "Realty", 1685),
    ("OBEROIRLTY", "Oberoi Realty", "Realty", 1820),
    ("TATAELXSI", "Tata Elxsi", "IT", 6280),
    ("KPITTECH", "KPIT Technologies", "IT", 1425),
    ("CONCOR", "Container Corporation", "Infrastructure", 820),
    ("PETRONET", "Petronet LNG", "Energy", 318),
    ("IGL", "Indraprastha Gas", "Energy", 198),
    ("UNIONBANK", "Union Bank of India", "Banking", 124),
    ("FEDERALBNK", "Federal Bank", "Banking", 198),
    ("AUBANK", "AU Small Finance Bank", "Banking", 620),
    ("IDFCFIRSTB", "IDFC First Bank", "Banking", 72),
    ("BHEL", "Bharat Heavy Electricals", "Industrials", 248),
    ("SAIL", "Steel Authority of India", "Metals", 128),
    ("ESCORTS", "Escorts Kubota", "Auto", 3480),
]

NIFTY_SMALLCAP: list[tuple[str, str, str, float]] = [
    ("CDSL", "Central Depository Services", "Finance", 1580),
    ("CAMS", "Computer Age Management", "Finance", 4280),
    ("BSE", "BSE", "Finance", 4860),
    ("ANGELONE", "Angel One", "Finance", 2680),
    ("KAYNES", "Kaynes Technology", "Industrials", 5420),
    ("RADICO", "Radico Khaitan", "FMCG", 2280),
    ("PVRINOX", "PVR INOX", "Consumer", 1420),
    ("INDIAMART", "IndiaMART InterMESH", "IT", 2480),
    ("REDINGTON", "Redington", "IT", 198),
    ("SONATSOFTW", "Sonata Software", "IT", 620),
    ("TANLA", "Tanla Platforms", "IT", 780),
    ("APARINDS", "Apar Industries", "Industrials", 8420),
    ("RVNL", "Rail Vikas Nigam", "Infrastructure", 420),
    ("IRCON", "IRCON International", "Infrastructure", 198),
    ("NBCC", "NBCC India", "Infrastructure", 98),
    ("HUDCO", "HUDCO", "Finance", 218),
    ("IREDA", "Indian Renewable Energy Dev.", "Finance", 186),
    ("RAILTEL", "RailTel Corporation", "Telecom", 380),
    ("BSOFT", "Birlasoft", "IT", 580),
    ("LATENTVIEW", "LatentView Analytics", "IT", 460),
    ("KFINTECH", "KFin Technologies", "Finance", 980),
    ("CEAT", "CEAT", "Auto", 3280),
    ("GRSE", "Garden Reach Shipbuilders", "Industrials", 1680),
    ("COCHINSHIP", "Cochin Shipyard", "Industrials", 1580),
]

# Names that are not already inside Nifty 50 / Next 50.
PHARMA_EXTRA: list[tuple[str, str, str, float]] = [
    ("LUPIN", "Lupin", "Pharma", 1980),
    ("AUROPHARMA", "Aurobindo Pharma", "Pharma", 1285),
    ("GLENMARK", "Glenmark Pharmaceuticals", "Pharma", 1480),
    ("ALKEM", "Alkem Laboratories", "Pharma", 5280),
    ("LAURUSLABS", "Laurus Labs", "Pharma", 520),
    ("IPCALAB", "IPCA Laboratories", "Pharma", 1485),
    ("MANKIND", "Mankind Pharma", "Pharma", 2420),
    ("FORTIS", "Fortis Healthcare", "Healthcare", 620),
    ("METROPOLIS", "Metropolis Healthcare", "Healthcare", 1980),
    ("SYNGENE", "Syngene International", "Healthcare", 780),
    ("ABBOTINDIA", "Abbott India", "Pharma", 28640),
    ("NATCOPHARM", "Natco Pharma", "Pharma", 1280),
    ("GRANULES", "Granules India", "Pharma", 545),
    ("AJANTPHARM", "Ajanta Pharma", "Pharma", 2860),
    ("BIOCON", "Biocon", "Pharma", 345),
    ("PFIZER", "Pfizer", "Pharma", 4680),
]

INDICES: list[tuple[str, str, str, float]] = [
    ("NIFTY 50", "Nifty 50", "Index", 22559.0),
    ("NIFTY NEXT 50", "Nifty Next 50", "Index", 68420),
    ("NIFTY 100", "Nifty 100", "Index", 24860),
    ("BANKNIFTY", "Nifty Bank", "Index", 48320.10),
    ("NIFTY MIDCAP 100", "Nifty Midcap 100", "Index", 54820),
    ("NIFTY MIDCAP 150", "Nifty Midcap 150", "Index", 21450),
    ("NIFTY SMALLCAP 100", "Nifty Smallcap 100", "Index", 17680),
    ("NIFTY SMALLCAP 250", "Nifty Smallcap 250", "Index", 16840),
    ("NIFTY PHARMA", "Nifty Pharma", "Index", 22150),
    ("NIFTY HEALTHCARE", "Nifty Healthcare", "Index", 14280),
    ("SENSEX", "BSE Sensex", "Index", 74742.50),
    ("INDIA VIX", "India VIX", "Index", 12.84),
]

PHARMA_SYMBOLS = {
    "APOLLOHOSP", "CIPLA", "DRREDDY", "SUNPHARMA", "TORNTPHARM", "ZYDUSLIFE",
    "DIVISLAB", "MAXHEALTH",
}

GROUP_ORDER = [
    "Indices",
    "Nifty 50",
    "Nifty 100",
    "Nifty Midcap",
    "Nifty Smallcap",
    "Pharma & Healthcare",
]

_VOL = {"index": 0.00012, "large": 0.00032, "mid": 0.00045, "small": 0.00058}


def _volume_band(base: float, kind: str) -> tuple[int, int]:
    if kind == "index":
        return (5_000_000, 25_000_000)
    if base < 200:
        return (8_000_000, 35_000_000)
    if base < 1000:
        return (1_000_000, 8_000_000)
    if base < 4000:
        return (300_000, 2_500_000)
    return (40_000, 600_000)


def _add(
    book: dict[str, dict[str, Any]],
    rows: list[tuple[str, str, str, float]],
    *,
    kind: str,
    universes: list[str],
    primary: str,
) -> None:
    for symbol, name, sector, base in rows:
        tags = list(universes)
        if symbol in PHARMA_SYMBOLS and "Pharma & Healthcare" not in tags:
            tags.append("Pharma & Healthcare")
        if symbol not in book:
            book[symbol] = {
                "symbol": symbol,
                "name": name,
                "sector": sector,
                "base": float(base),
                "vol": _VOL[kind],
                "decimals": 2,
                "volume": _volume_band(base, kind),
                "kind": kind,
                "universes": tags,
                "primary_group": primary,
            }
        else:
            for tag in tags:
                if tag not in book[symbol]["universes"]:
                    book[symbol]["universes"].append(tag)


def _build() -> dict[str, dict[str, Any]]:
    book: dict[str, dict[str, Any]] = {}
    _add(book, INDICES, kind="index", universes=["Indices"], primary="Indices")
    _add(book, NIFTY_50, kind="large", universes=["Nifty 50", "Nifty 100"], primary="Nifty 50")
    _add(book, NIFTY_NEXT_50, kind="large", universes=["Nifty 100"], primary="Nifty 100")
    _add(book, NIFTY_MIDCAP, kind="mid", universes=["Nifty Midcap"], primary="Nifty Midcap")
    _add(book, NIFTY_SMALLCAP, kind="small", universes=["Nifty Smallcap"], primary="Nifty Smallcap")
    _add(book, PHARMA_EXTRA, kind="mid", universes=["Pharma & Healthcare"], primary="Pharma & Healthcare")
    # Index products also surface inside the basket they represent.
    for symbol, extra in (
        ("NIFTY 50", "Nifty 50"),
        ("NIFTY NEXT 50", "Nifty 100"),
        ("NIFTY 100", "Nifty 100"),
        ("NIFTY MIDCAP 100", "Nifty Midcap"),
        ("NIFTY MIDCAP 150", "Nifty Midcap"),
        ("NIFTY SMALLCAP 100", "Nifty Smallcap"),
        ("NIFTY SMALLCAP 250", "Nifty Smallcap"),
        ("NIFTY PHARMA", "Pharma & Healthcare"),
        ("NIFTY HEALTHCARE", "Pharma & Healthcare"),
    ):
        if extra not in book[symbol]["universes"]:
            book[symbol]["universes"].append(extra)
    return book


INSTRUMENTS: dict[str, dict[str, Any]] = _build()

_ALIASES = {
    "NIFTY": "NIFTY 50",
    "NIFTY50": "NIFTY 50",
    "NIFTY BANK": "BANKNIFTY",
    "NIFTYBANK": "BANKNIFTY",
    "BANK NIFTY": "BANKNIFTY",
    "BANK NIFTY INDEX": "BANKNIFTY",
    "MIDCAP": "NIFTY MIDCAP 150",
    "NIFTY MIDCAP": "NIFTY MIDCAP 150",
    "SMALLCAP": "NIFTY SMALLCAP 250",
    "NIFTY SMALLCAP": "NIFTY SMALLCAP 250",
    "PHARMA": "NIFTY PHARMA",
    "HEALTHCARE": "NIFTY HEALTHCARE",
    "MEDICAL": "NIFTY HEALTHCARE",
    "SENSEX 30": "SENSEX",
    "VIX": "INDIA VIX",
    "INDIAVIX": "INDIA VIX",
}


def normalize_symbol(symbol: str) -> str:
    """Resolve a user symbol onto the universe. Unknown names fall back to Nifty 50."""
    cleaned = " ".join((symbol or "").strip().upper().split())
    if cleaned in INSTRUMENTS:
        return cleaned
    compact = cleaned.replace(" ", "")
    if compact in INSTRUMENTS:
        return compact
    return _ALIASES.get(cleaned) or _ALIASES.get(compact) or "NIFTY 50"


def lookup(symbol: str) -> dict[str, Any]:
    resolved = normalize_symbol(symbol)
    meta = INSTRUMENTS[resolved]
    return {
        "symbol": resolved,
        "name": meta["name"],
        "sector": meta["sector"],
        "universes": list(meta["universes"]),
        "primary_group": meta["primary_group"],
        "base": meta["base"],
        "kind": meta["kind"],
    }


def market_specs() -> dict[str, dict[str, Any]]:
    """Shape consumed by the live candle engine."""
    return {
        symbol: {
            "base": meta["base"],
            "vol": meta["vol"],
            "decimals": meta["decimals"],
            "volume": meta["volume"],
        }
        for symbol, meta in INSTRUMENTS.items()
    }


def list_instruments() -> list[dict[str, Any]]:
    def sort_key(meta: dict[str, Any]) -> tuple:
        group = meta["primary_group"]
        rank = GROUP_ORDER.index(group) if group in GROUP_ORDER else 99
        return (rank, meta["symbol"])

    rows = []
    for meta in sorted(INSTRUMENTS.values(), key=sort_key):
        rows.append({
            "symbol": meta["symbol"],
            "name": meta["name"],
            "sector": meta["sector"],
            "base_price": meta["base"],
            "decimals": meta["decimals"],
            "kind": meta["kind"],
            "group": meta["primary_group"],
            "universes": list(meta["universes"]),
        })
    return rows


def list_universes() -> dict[str, Any]:
    groups = []
    for label in GROUP_ORDER:
        members = [
            {
                "symbol": meta["symbol"],
                "name": meta["name"],
                "sector": meta["sector"],
                "base_price": meta["base"],
                "kind": meta["kind"],
            }
            for meta in INSTRUMENTS.values()
            if label in meta["universes"]
        ]
        members.sort(key=lambda row: (row["kind"] != "index", row["symbol"]))
        groups.append({"label": label, "count": len(members), "symbols": members})
    return {
        "groups": groups,
        "total_symbols": len(INSTRUMENTS),
        "note": (
            "Nifty 100 is the Nifty 50 plus the Nifty Next 50. "
            "Midcap and smallcap lists are liquid baskets inside those indices, "
            "not the full 150 / 250 membership. Prices are demo bases for research."
        ),
    }
