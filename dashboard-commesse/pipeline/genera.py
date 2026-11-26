"""Genera dist/index.html: pagina unica, tutto incorporato (dati, grafici, esportazione Excel).
Nessun servizio esterno: si apre anche con doppio clic (file://) o da una cartella di rete."""
import base64, json, os, re, sys
from collections import defaultdict
from datetime import date
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent


def _mese(d):
    return d[:7]


def _aggiornato_al(inp):
    for f in sorted(inp.glob("*")):
        m = re.search(r"(\d{2})_(\d{2})_(\d{2})", f.name)
        if m:
            return date(2000 + int(m.group(3)), int(m.group(2)), int(m.group(1)))
    mt = max((f.stat().st_mtime for f in inp.glob("*") if f.is_file()), default=None)
    return date.fromtimestamp(mt) if mt else date.today()


def serie_mensile(commesse, oggi, mesi_default):
    """Passato: fatturato registrato sugli ordini per mese (data consegna/ordine della riga).
    Futuro: residuo delle commesse aperte distribuito in parti uguali dal mese corrente
    al mese dell'ultima consegna prevista (altrimenti 'mesi_default' mesi) - È UNA STIMA."""
    passato = defaultdict(float)
    mese_oggi = oggi.strftime("%Y-%m")
    for c in commesse:
        for d, v in c.get("fatt_righe", []):
            if d and _mese(d) <= mese_oggi:
                passato[_mese(d)] += v
    futuro = defaultdict(float)
    for c in commesse:
        if c["stato"] != "Aperta" or not c["residuo"] or c["residuo"] <= 0:
            continue
        y, m = oggi.year, oggi.month
        n = mesi_default
        u = c.get("ultima_attivita")
        if u and _mese(u) > mese_oggi:
            n = max(1, (int(u[:4]) - y) * 12 + int(u[5:7]) - m + 1)
        for i in range(n):
            mm = (m - 1 + i)
            futuro[f"{y + mm // 12}-{mm % 12 + 1:02d}"] += c["residuo"] / n
    return dict(passato={k: round(v, 2) for k, v in sorted(passato.items())},
                futuro={k: round(v, 2) for k, v in sorted(futuro.items())}, mese_oggi=mese_oggi)


ITER = 600_000


def cifra(testo, password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    salt, iv = os.urandom(16), os.urandom(12)
    chiave = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
    ct = AESGCM(chiave).encrypt(iv, testo.encode("utf-8"), None)
    b = lambda x: base64.b64encode(x).decode()
    return dict(salt=b(salt), iv=b(iv), iter=ITER, dati=b(ct))


def main():
    cfg = json.load(open(RADICE / "config/soglie.json", encoding="utf-8"))
    d = json.load(open(RADICE / "data/commesse.json", encoding="utf-8"))
    rec = json.load(open(RADICE / "data/riconciliazione.json", encoding="utf-8"))
    agg = _aggiornato_al(RADICE / "input")
    oggi = max(agg, date.today()) if False else agg
    commesse = d["commesse"]
    rec_sint = dict(
        prospetti_ok=sum(1 for x in rec["prospetti"] if x["ok"]), prospetti_tot=len(rec["prospetti"]),
        prospetti_diff=[x for x in rec["prospetti"] if not x["ok"]],
        ordini_diff=rec["ordini"]["differenze"], ordini_senza_importi=len(rec["ordini"]["avvisi"]),
        ordini_totali=rec["ordini"]["n_totali"], v6=rec["v6"],
        capi_senza_prospetto=rec.get("capi_senza_prospetto", []))
    dati = dict(aggiornato_al=agg.strftime("%d/%m/%Y"), oggi=oggi.isoformat(), soglie=cfg, commesse=commesse,
                riconciliazione=rec_sint, escluse={k: len(v) for k, v in d.get("escluse", {}).items()})
    web = RADICE / "web"
    html = (web / "template.html").read_text(encoding="utf-8")
    js = lambda f: (web / "lib" / f).read_text(encoding="utf-8").replace("</script", "<\\/script")
    def pagina(blocco):
        return (html.replace("/*CHART*/", js("chart.umd.js")).replace("/*XLSX*/", js("xlsx.mini.min.js"))
                .replace("/*DATI*/", blocco.replace("</", "<\\/")))
    raw = json.dumps(dati, ensure_ascii=False)
    out = pagina("const DATI_CHIARI = " + raw + ";")
    (RADICE / "dist").mkdir(exist_ok=True)
    (RADICE / "dist/index.html").write_text(out, encoding="utf-8")
    print(f"dist/index.html generato ({len(out)//1024} KB), dati aggiornati al {dati['aggiornato_al']}")
    # Versione per il sito pubblico: dati cifrati (AES-256-GCM, chiave da password con PBKDF2)
    pw = os.environ.get("SICIET_DASHBOARD_PASSWORD") or (
        (RADICE / "config/password.txt").read_text(encoding="utf-8").strip() if (RADICE / "config/password.txt").exists() else "")
    cartella = cfg.get("pubblicazione", {}).get("cartella")
    if pw and cartella:
        dest = (RADICE / cartella).resolve()
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "index.html").write_text(pagina("const DATI_CIFRATI = " + json.dumps(cifra(raw, pw)) + ";"), encoding="utf-8")
        print(f"Versione protetta da password scritta in {dest / 'index.html'}")
    elif cartella:
        print("Password non impostata (config/password.txt o SICIET_DASHBOARD_PASSWORD): versione pubblica NON generata.")


if __name__ == "__main__":
    main()
