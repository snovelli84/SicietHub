"""Pipeline: legge input/, applica le regole, scrive data/commesse.json e il report di riconciliazione."""
import glob, json, sys
from pathlib import Path
from datetime import date

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))
from pipeline import parse_prospetti, parse_elenco, parse_fatture, parse_lista, parse_ordini, parse_resp, regole, riconcilia  # noqa: E402


def _cache(nome, files, fn):
    """Il parsing dei PDF è lento (~1-2 min): se i file non sono cambiati si riusa il risultato."""
    import pickle, hashlib
    h = hashlib.sha1()
    for f in files:
        st = Path(f).stat()
        h.update(f"{f}{st.st_size}{st.st_mtime_ns}".encode())
    h.update(Path(__file__).read_bytes() if False else b"v1")
    for m in ("parse_prospetti", "parse_elenco", "parse_fatture", "parse_lista", "parse_ordini", "parse_resp"):
        h.update((Path(__file__).parent / f"{m}.py").read_bytes())
    cf = RADICE / "data" / ".cache" / f"{nome}-{h.hexdigest()[:12]}.pkl"
    if cf.exists():
        return pickle.load(open(cf, "rb"))
    out = fn()
    cf.parent.mkdir(parents=True, exist_ok=True)
    pickle.dump(out, open(cf, "wb"))
    return out


def main():
    cfg = json.load(open(RADICE / "config/soglie.json", encoding="utf-8"))
    ov = {k: v for k, v in json.load(open(RADICE / "config/override.json", encoding="utf-8")).items() if not k.startswith("_")}
    inp = RADICE / "input"
    fp = sorted(glob.glob(str(inp / "Prospetto*.html")))
    prospetti = _cache("prospetti", fp, lambda: [parse_prospetti.leggi(f) for f in fp])
    fe = str(inp / "Elenco Commesse per Tipologia.pdf")
    elenco = _cache("elenco", [fe], lambda: parse_elenco.leggi(fe))
    fl = sorted(glob.glob(str(inp / "Lista commesse*.pdf")))
    lista = _cache("lista", fl, lambda: parse_lista.leggi(fl[-1])) if fl else []
    ff = inp / "Fatture emesse.pdf"
    fatture = _cache("fatture", [str(ff)], lambda: parse_fatture.leggi(ff)) if ff.exists() else []
    fo = str(inp / "Ordini da cliente.pdf")
    righe_pag = _cache("ordini", [fo], lambda: parse_ordini.leggi_righe(fo))
    ordini = [r for p in righe_pag for r in p["righe"]]
    dentro, fuori, escluse = regole.costruisci(prospetti, elenco, ordini, cfg, ov, lista=lista, fatture=fatture)
    (RADICE / "data").mkdir(exist_ok=True)
    json.dump(dict(commesse=dentro, fuori_perimetro=fuori, escluse=escluse), open(RADICE / "data/commesse.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    tot_av = _cache("ordini_tot", [fo], lambda: parse_ordini.leggi(fo))
    _scrivi_sorgenti(prospetti, elenco, lista, righe_pag, tot_av, fatture, inp)
    # --- riconciliazione ---
    rec = dict(
        prospetti=riconcilia.prospetti_vs_intestazione(prospetti, cfg["tolleranza_riconciliazione_euro"]),
        ordini=riconcilia.ordini_righe_vs_totali(tot_av, righe_pag),
        totali_pagina_ordini=riconcilia.totali_pagina(righe_pag),
        v6=_confronta_v6(inp, dentro),
        responsabili=(riconcilia.prospetti_vs_responsabili(prospetti, parse_resp.leggi(inp / "Totali responsabili.html"), cfg["tolleranza_riconciliazione_euro"])
                      if (inp / "Totali responsabili.html").exists() else None),
        capi_senza_prospetto=[a for a in cfg["perimetro"]["capi_attivi"]
                              if not any(regole.capo_attivo(p["capo"], [a]) for p in prospetti)],
        capi_prospetti=[p["capo"] for p in prospetti],
    )
    json.dump(rec, open(RADICE / "data/riconciliazione.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    _scrivi_report(rec, dentro, fuori)
    return prospetti, elenco, ordini, dentro, fuori


def _scrivi_sorgenti(prospetti, elenco, lista, righe_pag, tot_av, fatture, inp):
    """Sorgenti elaborate (stesso formato del motore JavaScript): permettono aggiornamenti parziali dal browser."""
    tot, avvisi = tot_av
    pr = {}
    for p in prospetti:
        eco = p["economie"]
        pr[Path(p["file"]).name] = dict(
            capo=p["capo"], intestazione=p["intestazione"], righe=p["righe"],
            economie=dict(n=len(eco), ricavi=round(sum(x["ricavi"] for x in eco), 2),
                          costi=round(sum(x["costi"] for x in eco), 2), fatturato=round(sum(x["fatturato"] for x in eco), 2)))
    resp = None
    if (inp / "Totali responsabili.html").exists():
        resp = parse_resp.leggi(inp / "Totali responsabili.html")
    src = dict(
        prospetti=pr, elenco=dict(righe=elenco), lista=dict(righe=lista),
        ordini=dict(righe=[r for p in righe_pag for r in p["righe"]],
                    totali=[dict(codice=t["codice"], ordine=t["ordine"], fatturato_ordini=t["fatturato_ordini"]) for t in tot],
                    avvisi=avvisi),
        fatture=dict(righe=fatture), responsabili=resp)
    json.dump(src, open(RADICE / "data/sorgenti.json", "w", encoding="utf-8"), ensure_ascii=False)


def _confronta_v6(inp, dentro):
    f = glob.glob(str(inp / "Andamento_commesse_per_capo_commessa*.xlsx"))
    if not f:
        return dict(stato="non fornito", nota="Metti l'Excel v6 in input/ per il confronto automatico.")
    return dict(stato="presente", file=f[0], nota="Confronto per commessa: da implementare sul layout del file.")


def _scrivi_report(rec, dentro, fuori):
    from pipeline.util import eur
    ap = [c for c in dentro if c["stato"] == "Aperta"]
    L = ["RICONCILIAZIONE (le differenze sono segnalate, non nascoste)", ""]
    L.append("1) Prospetti: totali intestazione = righe standard + economie")
    for x in rec["prospetti"]:
        L.append(f"   {'OK ' if x['ok'] else 'DIFF'} {x['capo']:22s} {x['voce']:10s} intest. {eur(x['intestazione']):>20s} diff {x['differenza']:>10,.2f}")
    L += ["", "2) Ordini da cliente: somma righe d'ordine = righe 'Totale Commessa'",
          f"   {rec['ordini']['n_totali']} totali letti, {len(rec['ordini']['differenze'])} differenze, "
          f"{len(rec['ordini']['avvisi'])} totali senza importi (valore 0 nel PDF)"]
    L += [f"   {d}" for d in rec["ordini"]["differenze"]]
    L += ["", "3) Totali progressivi di pagina (Ordini): differenze " + str(rec["totali_pagina_ordini"]),
          "   (pag. 1 = ordini senza commessa assegnata: fuori perimetro)", "",
          f"4) Excel v6: {rec['v6']['stato']} - {rec['v6']['nota']}", "",
          "5) Perimetro attuale: " + f"{len(dentro)} commesse (di cui {len(ap)} aperte), {len(fuori)} fuori perimetro"]
    S = lambda k: sum((c[k] or 0) for c in ap)
    L.append(f"   aperte: ricavi {eur(S('ricavi'))}  ordini attesi {eur(S('ordine'))}  residuo {eur(S('residuo'))}  (v6: ordini 46,1 M€, residuo 17,06 M€)")
    open(RADICE / "data/riconciliazione.txt", "w", encoding="utf-8").write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
