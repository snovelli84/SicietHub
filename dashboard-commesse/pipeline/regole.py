"""Regole di business SICIET: accorpamento padre+varianti, stato, perimetro, residuo."""
import json
from collections import defaultdict
from datetime import date


def gruppo(codice):
    return codice[:5]


def capo_attivo(nome, attivi):
    """True se il capo commessa è tra quelli oggi in azienda (confronto per parti del nome)."""
    n = (nome or "").upper().replace("\u00ec", "I").replace("'", "")
    return any(a.upper().replace("'", "") in n for a in attivi)


def fatturabili_discordanti(fatt_prospetto, fg):
    tot = fg["tot"] if fg else 0.0
    return abs(tot - fatt_prospetto) > 1.0


def e_economia(codice, prefissi):
    return codice.startswith(tuple(prefissi))


def costruisci(prospetti, elenco, ordini_righe, cfg, override, oggi=None, lista=None, fatture=None):
    """Ritorna (commesse, scartate). Una commessa = gruppo code[:5] (padre + varianti)."""
    oggi = oggi or date.today()
    pref = cfg["prefissi_economia"]

    el_per_cod = {e["codice"]: e for e in elenco}
    el_per_gruppo = defaultdict(list)
    for e in elenco:
        el_per_gruppo[gruppo(e["codice"])].append(e)

    # ordini per gruppo (somma delle righe d'ordine; i 'Totale Commessa' del PDF servono da controllo)
    ord_g = defaultdict(lambda: {"ordine": 0.0, "fatt": 0.0, "n": 0, "ult": None, "righe": []})
    for r in ordini_righe:
        g = ord_g[gruppo(r["codice"])]
        d = r.get("consegna") or r.get("data_ordine")
        if d and (g["ult"] is None or d > g["ult"]):
            g["ult"] = d
        if r.get("fatturato"):
            g["righe"].append((d, r["fatturato"]))
        g["ordine"] += r["ordine"] or 0.0
        g["fatt"] += r["fatturato"] or 0.0
        g["n"] += 1

    fat_g = defaultdict(lambda: {"tot": 0.0, "fm": defaultdict(float), "ult": None, "n": 0})
    for f in fatture or []:
        if f.get("commessa") and f.get("imponibile") is not None:
            g = fat_g[gruppo(f["commessa"])]
            g["tot"] += f["imponibile"]; g["n"] += 1
            g["fm"][f["data"][:7]] += f["imponibile"]
            if g["ult"] is None or f["data"] > g["ult"]:
                g["ult"] = f["data"]

    righe_g = defaultdict(list)
    for p in prospetti:
        if not capo_attivo(p["capo"], cfg["perimetro"]["capi_attivi"]):
            continue
        for r in p["righe"]:
            if not e_economia(r["codice"], pref):
                righe_g[gruppo(r["codice"])].append(r)

    # Commesse aperte nell'Elenco ma senza righe nel Prospetto (nessun movimento): importi a zero.
    # Escluse (decisione del titolare): commesse interne (cliente SICIET) e commesse Sospese.
    interni = set(cfg.get("clienti_interni_codici", []))
    lista = lista or []
    resp = {x["codice"]: x for x in lista}
    nomi_cli = {e["cliente_codice"]: e["cliente"] for e in elenco}
    for p in prospetti:
        for r in p["righe"]:
            if r.get("cliente_codice") and r.get("cliente"):
                nomi_cli[r["cliente_codice"]] = r["cliente"]
    attivi = cfg["perimetro"]["capi_attivi"]
    escluse = {"interne": [], "sospese": [], "capi_non_attivi": []}
    for g, L in el_per_gruppo.items():
        if g in righe_g or e_economia(g, pref):
            continue
        std = next((e for e in L if e["sezione"] == "Standard"), None)
        if not std:
            continue
        if std["cliente_codice"] in interni:
            escluse["interne"].append(g)
            continue
        if any(e["stato"] != "Chiusa" for e in L):
            if all(e["stato"] in ("Chiusa", "Sospesa") for e in L):
                escluse["sospese"].append(g)
                continue
            capo = (resp.get(g) or {}).get("nome") or "(non assegnato)"
            if capo != "(non assegnato)" and not capo_attivo(capo, attivi):
                escluse["capi_non_attivi"].append(g)
                continue
            righe_g[g] = [dict(codice=std["codice"], descrizione=std["descrizione"], capo=capo,
                               cliente=std["cliente"], cliente_codice=std["cliente_codice"], ricavi=0.0, costi=0.0,
                               fatturato=0.0, stato=std["stato"], senza_prospetto=True)]
    # Commesse presenti nella lista più recente ma non ancora nell'Elenco con Stato: nuove, in avvio
    for x in lista:
        g = x["codice"][:5]
        if g in righe_g or g in el_per_gruppo or e_economia(g, pref) or x["codice"] != g:
            continue
        if x["cliente_codice"] in interni:
            continue
        if x["nome"] and not capo_attivo(x["nome"], attivi):
            escluse["capi_non_attivi"].append(g)
            continue
        righe_g[g] = [dict(codice=g, descrizione="(nuova commessa, non ancora nell'Elenco con Stato)",
                           capo=x["nome"] or "(non assegnato)", cliente=nomi_cli.get(x["cliente_codice"], x["cliente_codice"]),
                           cliente_codice=x["cliente_codice"], ricavi=0.0, costi=0.0, fatturato=0.0,
                           stato="In Progress", senza_prospetto=True, nuova=True, creazione=x["creazione"])]

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
        apertura = (std or {}).get("creazione") or next((e["creazione"] for e in gruppo_el if e["creazione"]), None) \
            or next((r.get("creazione") for r in righe if r.get("creazione")), None)
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
        c["ultima_attivita"] = o["ult"] if o else None
        fm = defaultdict(float)
        for d_, v_ in (o["righe"] if o else []):
            if d_:
                fm[d_[:7]] += v_
        c["fm"] = {k: round(v, 2) for k, v in sorted(fm.items())}   # fatturato sugli ordini per mese
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
        fg = fat_g.get(g)
        c["fatture_totale"] = round(fg["tot"], 2) if fg else 0.0
        c["ultima_fattura"] = fg["ult"] if fg else None
        # fatturato nel tempo: se le fatture emesse in lista coincidono con il fatturato del Prospetto (±1 €)
        # si usano le DATE DELLE FATTURE, altrimenti la data di consegna delle righe d'ordine (stima)
        if fg and abs(fg["tot"] - fatt) <= 1.0:
            c["fm"] = {k: round(v, 2) for k, v in sorted(fg["fm"].items())}
            c["fm_fonte"] = "fatture"
        else:
            c["fm_fonte"] = "ordini"
        if fatturabili_discordanti(fatt, fg):
            c["anomalie"].append("fatture_discordanti")
        c["chiusura_stimata"] = None
        if aperta is False and not chiusura:
            c["chiusura_stimata"] = c["ultima_fattura"] or c["ultima_attivita"]   # stima: ultima fattura, altrimenti ultimo ordine/consegna
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

    # Il perimetro (aperte + chiuse 2025-2026 di default) è una VISTA modificabile nella dashboard:
    # il dataset contiene tutte le commesse dei capi attivi.
    dentro, fuori = commesse, []
    fuori_extra = escluse
    return dentro, fuori, fuori_extra
