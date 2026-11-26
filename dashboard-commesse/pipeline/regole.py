"""Regole di business SICIET: accorpamento padre+varianti, stato, perimetro, residuo."""
import json
from collections import defaultdict
from datetime import date


def gruppo(codice):
    return codice[:5]


def e_economia(codice, prefissi):
    return codice.startswith(tuple(prefissi))


def costruisci(prospetti, elenco, ordini_righe, cfg, override, oggi=None):
    """Ritorna (commesse, scartate). Una commessa = gruppo code[:5] (padre + varianti)."""
    oggi = oggi or date.today()
    pref = cfg["prefissi_economia"]

    el_per_cod = {e["codice"]: e for e in elenco}
    el_per_gruppo = defaultdict(list)
    for e in elenco:
        el_per_gruppo[gruppo(e["codice"])].append(e)

    # ordini per gruppo (somma delle righe d'ordine; i 'Totale Commessa' del PDF servono da controllo)
    ord_g = defaultdict(lambda: {"ordine": 0.0, "fatt": 0.0, "n": 0})
    for r in ordini_righe:
        g = ord_g[gruppo(r["codice"])]
        g["ordine"] += r["ordine"] or 0.0
        g["fatt"] += r["fatturato"] or 0.0
        g["n"] += 1

    righe_g = defaultdict(list)
    for p in prospetti:
        if p["capo"] in cfg["perimetro"]["capi_esclusi"]:
            continue
        for r in p["righe"]:
            if not e_economia(r["codice"], pref):
                righe_g[gruppo(r["codice"])].append(r)

    # Commesse aperte nell'Elenco ma senza righe nel Prospetto (nessun movimento): importi a zero
    interni = set(cfg.get("clienti_interni", []))
    for g, L in el_per_gruppo.items():
        if g in righe_g or e_economia(g, pref):
            continue
        std = next((e for e in L if e["sezione"] == "Standard"), None)
        if not std or std["cliente"] in interni:
            continue
        if any(e["stato"] != "Chiusa" for e in L):
            righe_g[g] = [dict(codice=std["codice"], descrizione=std["descrizione"], capo="(non assegnato)",
                               cliente=std["cliente"], cliente_codice=std["cliente_codice"], ricavi=0.0, costi=0.0,
                               fatturato=0.0, stato=std["stato"], senza_prospetto=True)]

    commesse = []
    for g, righe in sorted(righe_g.items()):
        capi = sorted({r["capo"] for r in righe})
        ricavi = round(sum(r["ricavi"] for r in righe), 2)
        costi = round(sum(r["costi"] for r in righe), 2)
        fatt = round(sum(r["fatturato"] for r in righe), 2)
        mlc = round(ricavi - costi, 2)

        # stato: dall'Elenco per i codici presenti nel prospetto, altrimenti dal prospetto
        stati = []
        for r in righe:
            e = el_per_cod.get(r["codice"]) or el_per_cod.get(r["codice"].replace("-", ""))
            stati.append((e or {}).get("stato") or r.get("stato") or "")
        stati = [s for s in stati if s]
        aperta = any(s != "Chiusa" for s in stati) if stati else None

        base = el_per_cod.get(g)
        gruppo_el = el_per_gruppo.get(g, [])
        std = base if base and base["sezione"] == "Standard" else next(
            (e for e in gruppo_el if e["sezione"] == "Standard"), None)
        cliente = (std or {}).get("cliente") or next((r["cliente"] for r in righe if r.get("cliente")), "")
        # nome cliente: preferisci quello del prospetto (non spezzato dal PDF)
        cl_pr = next((r["cliente"] for r in righe if r.get("cliente")), "")
        cliente = cl_pr or cliente
        apertura = (std or {}).get("creazione") or next((e["creazione"] for e in gruppo_el if e["creazione"]), None)
        chiusura = None
        if not aperta:
            chiusura = (base or {}).get("consegna")
            if not chiusura:
                d = [e["consegna"] for e in gruppo_el if e["consegna"]]
                chiusura = max(d) if d else None

        c = dict(
            codice=g,
            descrizione=((std or {}).get("descrizione") or righe[0]["descrizione"]),
            capo=capi[0], capi=capi, cliente=cliente,
            apertura=apertura, chiusura=chiusura,
            stato="Aperta" if aperta else ("Chiusa" if aperta is False else "n.d."),
            n_righe=len(righe),
            ricavi=ricavi, costi=costi, mlc=mlc,
            mlc_pct=round(mlc / ricavi * 100, 2) if ricavi else None,
            fatturato=fatt, scostamento=round(ricavi - fatt, 2),
            ordine=None, residuo=None,
            da_chiudere=False, in_avvio=False, anomalie=[],
        )
        if ricavi == 0 and costi == 0 and fatt == 0:
            c["in_avvio"] = True
            c["senza_prospetto"] = any(r.get("senza_prospetto") for r in righe)

        o = ord_g.get(g)
        c["ordine_totale_pdf"] = round(o["ordine"], 2) if o else 0.0
        c["fatt_su_ordini"] = round(o["fatt"], 2) if o else 0.0
        if aperta:
            ordine = round(o["ordine"], 2) if o else 0.0
            res = round(ordine - (round(o["fatt"], 2) if o else 0.0), 2)
            if o and abs(res) <= cfg["soglia_da_chiudere_euro"]:
                c["da_chiudere"] = True           # ordine = fatturato: ordine e residuo restano VUOTI
            else:
                c["ordine"], c["residuo"] = ordine, res
            if not o:
                c["anomalie"].append("aperta_senza_ordini")
            if res < -cfg["soglia_da_chiudere_euro"]:
                c["anomalie"].append("fatturato_oltre_ordini")
        # anomalie comuni
        if aperta is False and not chiusura:
            c["anomalie"].append("chiusa_senza_data")
        if ricavi and costi / ricavi > 1:
            c["anomalie"].append("in_perdita")
        ov = override.get(g, {})
        c["dato_da_verificare"] = bool(ov.get("dato_da_verificare"))
        c["note"] = ov.get("nota", "")
        if c["dato_da_verificare"]:
            c["anomalie"].append("dato_da_verificare")
        commesse.append(c)

    # perimetro
    a, b = cfg["perimetro"]["chiuse_dal_anno"], cfg["perimetro"]["chiuse_al_anno"]
    dentro, fuori = [], []
    for c in commesse:
        if c["stato"] == "Aperta":
            dentro.append(c)
        elif c["chiusura"]:
            (dentro if a <= int(c["chiusura"][:4]) <= b else fuori).append(c)
        else:
            (dentro if cfg["perimetro"]["includi_chiuse_senza_data"] else fuori).append(c)
    return dentro, fuori
