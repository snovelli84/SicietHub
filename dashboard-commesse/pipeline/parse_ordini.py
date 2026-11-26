"""Parser 'Ordini da cliente' (PDF): righe 'Totale Commessa'.

Per ogni 'Totale Commessa <codice>' il primo importo (colonna Totale Ordine) è il totale ordinato,
il secondo (colonna Fatturato) è il fatturato registrato sugli ordini. Si assegna l'importo alla
colonna dalla posizione x: così una riga con UN SOLO importo (o con importi andati a capo) non viene
scambiata tra ordinato e fatturato. Il codice può avere suffissi (V01, Q01, STR, ...).
"""
import re
import pdfplumber
from .util import num, data, iso, MONEY

X_SPLIT = 580  # importi con bordo destro < 580 = Totale Ordine, >= 580 = Fatturato


def _linee(page):
    ws = page.extract_words(keep_blank_chars=False)
    linee = {}
    for w in ws:
        linee.setdefault(round(w["top"] / 3), []).append(w)
    return [sorted(linee[k], key=lambda w: w["x0"]) for k in sorted(linee)]


def _importi(words):
    ordine = fatt = None
    for w in words:
        v = num(w["text"])
        if v is None:
            continue
        if w["x1"] < X_SPLIT:
            ordine = v
        else:
            fatt = v
    return ordine, fatt


GLUED = re.compile(r"^(-?\d{1,3}(?:\.\d{3})*,\d{2})(\d{2}/\d{2}/\d{4})$")
RE_CODICE = re.compile(r"^S[A-Z]?\d{4}[A-Z0-9]*$")


def _righe_ordine(linee):
    """Righe d'ordine: codice commessa in colonna 'Comm.' (x 400-450) + 'Si/No' (x ~541).
    Ordinato e fatturato hanno colonne fisse; l'ultimo importo può essere attaccato alla data di
    consegna ('10.797,2211/08/2017') oppure finire su una riga sotto (importo 'spostato')."""
    righe = []
    for i, l in enumerate(linee):
        cod = next((w for w in l if 380 <= w["x0"] <= 455 and RE_CODICE.match(w["text"].strip("\"'“”"))), None)
        if cod is None or not any(w["text"] in ("Si", "No") and 535 <= w["x0"] <= 548 for w in l):
            continue
        ordine = fatt = None
        d_ord = next((iso(data(w["text"])) for w in l if w["x0"] < 70 and data(w["text"])), None)
        consegna = next((iso(data(w["text"])) for w in l if w["x0"] >= 655 and data(w["text"])), None)
        for w in l:
            m = GLUED.match(w["text"])
            if m and w["x0"] > 590:
                fatt = num(m.group(1))
                consegna = consegna or iso(data(m.group(2)))
            elif MONEY.match(w["text"]):
                if w["x1"] < X_SPLIT:
                    ordine = num(w["text"])
                elif w["x0"] > 590:
                    fatt = num(w["text"])
        # importi spostati su una riga sottostante (riga con SOLO importi)
        for nxt in linee[i + 1:i + 2]:
            if nxt and nxt[0]["top"] < 520 and nxt[0]["top"] - l[0]["top"] < 16 \
                    and all(MONEY.match(w["text"]) for w in nxt):
                for w in nxt:
                    if w["x1"] < X_SPLIT and ordine is None:
                        ordine = num(w["text"])
                    elif w["x1"] >= X_SPLIT and fatt is None:
                        fatt = num(w["text"])
        righe.append(dict(codice=cod["text"].strip("\"'“”"), ordine=ordine, fatturato=fatt,
                          data_ordine=d_ord, consegna=consegna))
    return righe


def leggi_righe(path):
    """Tutte le righe d'ordine + totali di pagina (per recuperare importi mancanti nel PDF)."""
    out = []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages, 1):
            linee = _linee(page)
            righe = _righe_ordine(linee)
            tot = None
            for l in linee:   # riga di totale pagina: due importi grandi senza altre parole, in basso
                if len(l) == 2 and all(MONEY.match(w["text"]) for w in l) and l[0]["top"] > 500:
                    tot = (num(l[0]["text"]), num(l[1]["text"]))
            out.append(dict(pagina=pi, righe=righe, totale_pagina=tot))
    return out


def leggi(path):
    out, avvisi = [], []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages, 1):
            linee = _linee(page)
            for i, l in enumerate(linee):
                t = [w["text"] for w in l]
                if t[:2] != ["Totale", "Commessa"] or len(t) < 3:
                    continue
                codice = t[2]
                ordine, fatt = _importi(l[3:])
                # importi andati a capo: righe successive composte SOLO da importi
                if ordine is None and fatt is None:
                    for nxt in linee[i + 1:i + 3]:
                        if nxt and nxt[0]["top"] < 520 and all(MONEY.match(w["text"]) for w in nxt):
                            ordine, fatt = _importi(nxt)
                            break
                if ordine is None and fatt is None:
                    avvisi.append(f"pag. {pi}: Totale Commessa {codice} senza importi leggibili")
                out.append(dict(codice=codice, ordine=ordine or 0.0, fatturato_ordini=fatt or 0.0,
                                importi_presenti=(ordine is not None, fatt is not None), pagina=pi))
    return out, avvisi
