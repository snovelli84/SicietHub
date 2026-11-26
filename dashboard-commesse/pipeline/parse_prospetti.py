"""Parser dei 'Prospetto Margine Economico <capo commessa>' (HTML esportato da Mago4).

Struttura del file:
  - intestazione con i totali (Ricavi, Costi Diretti, MLC, Fatturato, Scostamento)
  - righe  row_imageN     = riga AGGREGATA della commessa padre (ha il cliente) -> IGNORATA
  - righe  row_imageN_M   = commessa base + varianti (hanno lo Stato nel tooltip) -> TENUTE
"""
import re
from bs4 import BeautifulSoup
from .util import num

CLS_NUM = "box01RightBottomBorder"


def _testo(td):
    return td.get_text(" ", strip=True)


STATI = {"Chiusa", "In Progress", "Nuova", "In Contenzioso", "Aperta", "Sospesa", "Annullata", "Conclusa"}


def _clean(x):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x.replace("&nbsp;", " "))).strip()


def _prima_della_cella(cod_td):
    """Stato e costi (consuntivati/previsti) stanno nei tooltip delle celle-icona PRIMA del codice."""
    stato, costi = "", {}
    for sib in cod_td.find_previous_siblings("td"):
        for el in [sib] + sib.find_all(attrs={"title": True}):
            ti = el.get("title", "")
            if ti.strip() in STATI:
                stato = ti.strip()
            elif "Costi" in ti:
                t = _clean(ti)
                m = re.search(r"Costi Cons\. Complessivi:\s*(-?[\d.]+,\d\d)\s*-\s*Costi Previsti:\s*(-?[\d.]+,\d\d)", t)
                if m:
                    costi = dict(costi_consuntivati=num(m.group(1)), costi_previsti=num(m.group(2)))
                else:
                    c = re.search(r"Costi Consuntivati:\s*(-?[\d.]+,\d\d)", t)
                    p_ = re.search(r"Costi Previsti:\s*(-?[\d.]+,\d\d)", t)
                    if c:
                        costi["costi_consuntivati"] = num(c.group(1))
                    if p_:
                        costi["costi_previsti"] = num(p_.group(1))
    return stato, costi


def leggi(path):
    html = open(path, encoding="utf-8", errors="replace").read()
    b = BeautifulSoup(html, "lxml")
    titolo = b.title.get_text(strip=True) if b.title else ""
    capo = re.sub(r"^Prospetto Margine Economico\s*", "", titolo).strip()

    testo = b.get_text(" ", strip=True)
    m = re.search(
        r"Ricavi ([\-\d.]+,\d\d) [\-\d,]+% Costi Diretti ([\-\d.]+,\d\d) [\-\d,]+% "
        r"MLC ([\-\d.]+,\d\d) [\-\d,]+% Fatturato ([\-\d.]+,\d\d)", testo)
    intest = None
    if m:
        intest = dict(zip(("ricavi", "costi", "mlc", "fatturato"), map(num, m.groups())))
        s_ = re.search(r"Ricavi Competenza - Fatturato\s+(-?[\d.]+,\d\d)", testo)
        intest["scostamento"] = num(s_.group(1)) if s_ else None

    # Tipi di riga (tutte hanno una cella-codice con classe box01BottomBorder):
    #   id row_imageN      -> AGGREGATA di una commessa padre che ha figli  -> ignorata
    #   id row_imageN_M    -> commessa base / variante                       -> tenuta
    #   nessun id          -> commessa senza varianti (riga unica)           -> tenuta
    righe, aggregate, tutte = [], [], []
    sezione_eco = False
    for tr in b.find_all("tr"):
        cod_td = tr.find("td", class_="box01BottomBorder", recursive=False)
        if cod_td is None:
            continue
        codice = _testo(cod_td)
        if not re.match(r"^S", codice):
            continue
        rid = tr.get("id", "")
        figlia = bool(re.search(r"row_image\d+_\d+$", rid))
        aggr = bool(re.fullmatch(r"row_image\d+", rid))
        tds = tr.find_all("td", recursive=False)
        nums = [t for t in tds if CLS_NUM in (t.get("class") or [])]
        descr_td, resto = nums[0], nums[1:]
        cliente_cod = cliente_nome = None
        while resto and num(_testo(resto[0])) is None:        # cella cliente (vuota o codice)
            c = resto[0]
            if _testo(c):
                cliente_cod, cliente_nome = _testo(c), c.get("title", "")
            resto = resto[1:]
        v = [num(_testo(t)) for t in resto]
        if len(v) < 11 or any(x is None for x in v[:11]):
            raise ValueError(f"{path}: riga {rid or '-'} {codice}: valori non leggibili {[_testo(t) for t in resto]}")
        stato, costi = _prima_della_cella(cod_td)
        rec = dict(
            codice=codice, descrizione=descr_td.get("title") or _testo(descr_td),
            ricavi=v[0], costi=v[2], mlc=v[4], mlc_pct=v[6], fatturato=v[7], scostamento=v[9],
            stato=stato, capo=capo, cliente_codice=cliente_cod, cliente=cliente_nome, **costi,
        )
        if re.match(r"^S[MLF]", codice):                    # economia: mai nella dashboard
            rec["economia"] = True
            if not aggr:                                    # l'aggregata raddoppierebbe i totali
                tutte.append(rec)
            continue
        if aggr:
            aggregate.append(rec)
        else:
            rec["riga_unica"] = not figlia
            righe.append(rec)

    # il cliente è sull'aggregata (o sulla riga stessa se unica): lo propaghiamo per code[:5]
    cli = {}
    for a in aggregate + righe:
        if a.get("cliente_codice"):
            cli.setdefault(a["codice"][:5], (a["cliente_codice"], a["cliente"]))
    for r in righe:
        r["cliente_codice"], r["cliente"] = cli.get(r["codice"][:5], (r.get("cliente_codice"), r.get("cliente")))
    return dict(capo=capo, intestazione=intest, righe=righe, aggregate=aggregate,
                economie=tutte, file=str(path))
