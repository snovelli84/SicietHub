"""Funzioni comuni: numeri e date in formato italiano."""
import re
from datetime import date

MONEY = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$")
DATA = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def num(s):
    """'1.234,56' -> 1234.56 (None se non è un importo)."""
    s = (s or "").strip().replace("\xa0", "")
    if not MONEY.match(s):
        return None
    return round(float(s.replace(".", "").replace(",", ".")), 2)


def data(s):
    m = DATA.match((s or "").strip())
    if not m:
        return None
    g, me, a = map(int, m.groups())
    try:
        return date(a, me, g)
    except ValueError:
        return None


def iso(d):
    return d.isoformat() if d else None


def eur(x):
    if x is None:
        return ""
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " €"
