"""Parser 'Lista fatture emesse' (Liste di spunta - Fatture immediate), PDF.

Colonne fisse: Data (x~16), Numero (~60), Commessa (~98), Cliente (~180), Imponibile (bordo destro ~451),
Totale+Pagamento attaccati (es. '1.700,00BFM12'). Si usa l'IMPONIBILE (è il valore che Mago4 mette nel
fatturato di commessa). Le fatture senza commessa vengono lette ma non assegnate.
"""
import re
import pdfplumber
from .util import num, data, iso

RE_COD = re.compile(r"^S[A-Z]?\d{4}[A-Z0-9]*$")


def leggi(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for pi, page in enumerate(pdf.pages, 1):
            linee = {}
            for w in page.extract_words():
                linee.setdefault(round(w["top"] / 3), []).append(w)
            for k in sorted(linee):
                l = sorted(linee[k], key=lambda w: w["x0"])
                d = data(l[0]["text"]) if l and l[0]["x0"] < 40 else None
                if not d or len(l) < 4 or not (55 <= l[1]["x0"] <= 70):
                    continue
                cod = next((w["text"] for w in l if 92 <= w["x0"] <= 140 and RE_COD.match(w["text"])), None)
                imp = next((num(w["text"]) for w in l if 400 <= w["x1"] <= 462 and num(w["text"]) is not None), None)
                if not cod:
                    m = re.search(r"(S[A-Z]?\d{4}[A-Z0-9]*)$", l[1]["text"])
                    cod = m.group(1) if m else None
                cli = next((w["text"] for w in l if 175 <= w["x0"] <= 205 and w["text"].isdigit()), "")
                out.append(dict(data=iso(d), numero=l[1]["text"], commessa=cod, cliente_codice=cli, imponibile=imp, pagina=pi))
    return out
