"""Test di riconciliazione. Le differenze vengono SEGNALATE (mai nascoste né 'aggiustate')."""
from collections import defaultdict

from . import parse_ordini


def prospetti_vs_intestazione(prospetti, tol):
    """Per ogni capo commessa: totali dell'intestazione = righe standard + righe 'Economie'."""
    out = []
    for p in prospetti:
        h = p["intestazione"]
        for k in ("ricavi", "costi", "fatturato"):
            std = round(sum(r[k] for r in p["righe"]), 2)
            eco = round(sum(r[k] for r in p["economie"]), 2)
            d = round(h[k] - std - eco, 2)
            out.append(dict(capo=p["capo"], voce=k, intestazione=h[k], standard=std, economia=eco,
                            differenza=d, ok=abs(d) <= max(tol, 0.02)))
    return out


def ordini_righe_vs_totali(tot_avvisi, righe_pag):
    """Somma delle righe d'ordine per codice vs righe 'Totale Commessa' stampate nel PDF."""
    tot, avvisi = tot_avvisi
    somma = defaultdict(lambda: [0.0, 0.0])
    for p in righe_pag:
        for r in p["righe"]:
            somma[r["codice"]][0] += r["ordine"] or 0
            somma[r["codice"]][1] += r["fatturato"] or 0
    stampati = defaultdict(lambda: [0.0, 0.0])
    for t in tot:
        stampati[t["codice"]][0] += t["ordine"]
        stampati[t["codice"]][1] += t["fatturato_ordini"]
    diff = []
    for cod in sorted(set(somma) | set(stampati)):
        a, b = somma.get(cod, [0, 0]), stampati.get(cod, [0, 0])
        if abs(a[0] - b[0]) > 0.02 or abs(a[1] - b[1]) > 0.02:
            diff.append(dict(codice=cod, ordine_righe=round(a[0], 2), ordine_totale=round(b[0], 2),
                             fatt_righe=round(a[1], 2), fatt_totale=round(b[1], 2)))
    # totale pagina progressivo (ultima pagina) vs somma righe con commessa
    return dict(differenze=diff, avvisi=avvisi, n_totali=len(tot))


def totali_pagina(righe_pag):
    """Il PDF riporta un totale progressivo a piè di pagina: deve coincidere con la somma delle righe.
    La pagina 1 contiene ordini senza commessa (fuori perimetro)."""
    prev, out = (0.0, 0.0), []
    for p in righe_pag:
        t = p["totale_pagina"]
        if not t:
            continue
        so = sum(r["ordine"] or 0 for r in p["righe"])
        sf = sum(r["fatturato"] or 0 for r in p["righe"])
        d = (round(t[0] - prev[0] - so, 2), round(t[1] - prev[1] - sf, 2))
        prev = t
        if d != (0, 0):
            out.append(dict(pagina=p["pagina"], diff_ordine=d[0], diff_fatturato=d[1]))
    return out


def prospetti_vs_responsabili(prospetti, resp, tol=0.05):
    """Ogni prospetto deve coincidere con una riga del 'Prospetto Margine Responsabili Commessa'
    (stessi ricavi, costi, fatturato). Così si verifica che l'esportazione per capo sia completa."""
    out, usate = [], set()
    for p in prospetti:
        h = p["intestazione"]
        trovata = next((i for i, r in enumerate(resp["righe"]) if i not in usate
                        and abs(r["ricavi"] - h["ricavi"]) <= tol and abs(r["costi"] - h["costi"]) <= tol
                        and abs(r["fatturato"] - h["fatturato"]) <= tol), None)
        if trovata is not None:
            usate.add(trovata)
        out.append(dict(capo=p["capo"], ricavi=h["ricavi"], ok=trovata is not None,
                        responsabile=(resp["righe"][trovata]["codice"] + " " + resp["righe"][trovata]["nome"]).strip() if trovata is not None else None))
    altri = [r for i, r in enumerate(resp["righe"]) if i not in usate]
    return dict(controlli=out, non_esportati=altri, totale=resp["totale"],
                somma_righe=round(sum(r["ricavi"] for r in resp["righe"]), 2))
