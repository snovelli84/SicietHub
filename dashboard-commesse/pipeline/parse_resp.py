"""Parser 'Prospetto Margine Responsabili Commessa': totali per responsabile (usati per la riconciliazione).
Un capo commessa può comparire con più codici responsabile (es. Moreschi S0386 e S0394)."""
import re
from bs4 import BeautifulSoup
from .util import num

RIGA = re.compile(r"(?:([A-Z]\d{4})\s+)?([A-Z][A-Z' .]+?\.{0,3})\s+((?:-?[\d.]+,\d\d\s+){10}-?[\d.]+,\d\d)")


def leggi(path):
    t = BeautifulSoup(open(path, encoding="utf-8", errors="replace").read(), "lxml").get_text(" ", strip=True)
    m = re.search(r"Ricavi ([\-\d.]+,\d\d) Costi Diretti ([\-\d.]+,\d\d) MLC ([\-\d.]+,\d\d) Fatturato ([\-\d.]+,\d\d)", t)
    tot = dict(zip(("ricavi", "costi", "mlc", "fatturato"), map(num, m.groups()))) if m else None
    i = t.find("%MLC")
    righe = []
    for g in RIGA.finditer(t[i:] if i >= 0 else t):
        v = [num(x) for x in g.group(3).split()]
        righe.append(dict(codice=g.group(1) or "", nome=g.group(2).strip(), ricavi=v[0], costi=v[2], mlc=v[4], fatturato=v[7]))
    return dict(totale=tot, righe=righe)
