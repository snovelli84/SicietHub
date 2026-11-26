"""Parser 'Elenco Commesse per Tipologia' (PDF).

Righe a colonne fisse: si assegna ogni carattere alla colonna dalla sua posizione x, quindi
date e importi attaccati al testo (es. 'S.R.1L6./02/2006') non creano problemi. Le descrizioni
che vanno a capo si agganciano alla riga precedente.
"""
import re
import pdfplumber
from .util import data, iso

# confini di colonna (x, in punti) ricavati dall'intestazione del report
COL = [("codice", 0, 65), ("padre", 65, 110), ("descr", 110, 296), ("cli_cod", 296, 345),
       ("cli", 345, 494), ("creazione", 494, 541), ("consegna", 541, 600),
       ("resto", 600, 762), ("stato", 762, 900)]
RE_COD = re.compile(r"^S[A-Z0-9]{3,}(?:-\d+)?$|^RICFISC$")


def _col(x):
    for n, a, b in COL:
        if a <= x < b:
            return n
    return "resto"


def _righe(page):
    righe = {}
    for ch in page.chars:
        righe.setdefault(round(ch["top"] / 3), []).append(ch)
    for k in sorted(righe):
        cols, date = {}, []
        for ch in sorted(righe[k], key=lambda c: c["x0"]):
            x, t = ch["x0"], ch["text"]
            # Le ragioni sociali lunghe finiscono SOPRA le colonne delle date: nella fascia
            # 480-600 cifre e '/' sono date, il resto è nome cliente.
            if 480 <= x < 600 and (t.isdigit() or t == "/") and ch["x0"] >= 494:
                date.append(ch)
            elif 480 <= x < 600 and x >= 494:
                cols.setdefault("cli", []).append(t)
            else:
                cols.setdefault(_col(x), []).append(t)
        r = {n: "".join(v).strip() for n, v in cols.items()}
        if date:
            txt = "".join(c["text"] for c in date)
            if len(txt) >= 20:
                r["creazione"], r["consegna"] = txt[:10], txt[10:20]
            elif len(txt) == 10:
                r["consegna" if date[0]["x0"] >= 535 else "creazione"] = txt
        yield r


def _stato(t):
    t = t.strip()
    return "In Contenzioso" if t.startswith("In Contenz") else t


def leggi(path):
    out, sezione, ultimo = [], None, None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for r in _righe(page):
                cod = r.get("codice", "")
                if cod in ("Standard", "Di Variante", "In Economia", "Economia") or \
                        r.get("descr") in ("Standard", "Di Variante", "In Economia", "Economia") and not cod:
                    sezione = r.get("descr") or cod
                    continue
                if RE_COD.match(cod) and r.get("cli_cod", "").isdigit():
                    padre = r.get("padre", "")
                    rec = dict(codice=cod, padre=padre, sezione=sezione, descrizione=r.get("descr", ""),
                               cliente_codice=r["cli_cod"], cliente=r.get("cli", ""),
                               creazione=iso(data(r.get("creazione", ""))),
                               consegna=iso(data(r.get("consegna", ""))),
                               stato=_stato(r.get("stato", "")))
                    # descrizioni lunghe che sfiorano la colonna cliente: nessuna correzione necessaria
                    out.append(rec)
                    ultimo = rec
                elif ultimo is not None and not cod and r.get("descr") and "SICIET_M4" not in r.get("descr", ""):
                    # riga di continuazione della descrizione (non intestazione di pagina)
                    if not re.match(r"^(Da|A|Estrai|Elenco|Selezione|Standard,|Commessa|Padre)", r["descr"]):
                        ultimo["descrizione"] += " " + r["descr"]
    return out
