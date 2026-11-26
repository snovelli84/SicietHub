"""Parser 'Elenco Commesse per Tipologia' nel formato con Responsabile (capo commessa).

Serve per: assegnare il capo commessa alle commesse senza movimenti (assenti dai prospetti) e
individuare commesse nate dopo l'ultimo Elenco con Stato. NON contiene Stato né data consegna.
"""
import re
import pdfplumber
from .util import data, iso

RE_COD = re.compile(r"^S[A-Z0-9]{3,}(?:-\d+)?$")


def leggi(path):
    out, ultimo = [], None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            righe = {}
            for ch in page.chars:
                righe.setdefault(round(ch["top"] / 3), []).append(ch)
            for k in sorted(righe):
                col = {"cod": [], "cli": [], "dat": [], "nome": [], "resp": []}
                for ch in sorted(righe[k], key=lambda c: c["x0"]):
                    x, t = ch["x0"], ch["text"]
                    if 60 <= x < 115:
                        col["cod"].append(t)
                    elif 330 <= x < 380:
                        col["cli"].append(t)
                    elif 605 <= x < 652 and (t.isdigit() or t == "/"):
                        col["dat"].append(t)
                    elif 652 <= x < 700:
                        col["resp"].append(t)
                    elif x >= 700:
                        col["nome"].append(t)
                cod = "".join(col["cod"]).strip()
                nome = re.sub(r"\s*(ULTIMO|PRIMO)$", "", "".join(col["nome"]).strip())
                if RE_COD.match(cod) and "".join(col["cli"]).strip().isdigit():
                    ultimo = dict(codice=cod, cliente_codice="".join(col["cli"]).strip(),
                                  creazione=iso(data("".join(col["dat"]))), resp=("".join(col["resp"])).strip(),
                                  nome=nome)
                    out.append(ultimo)
                elif ultimo and not cod and nome and not re.match(r"^(Nome|Estrai|Da|A)", nome) and not col["cli"]:
                    # seconda riga del nome (es. 'RICCARDO')
                    if ultimo["nome"] and len(nome) < 20 and nome.replace(" ", "").replace(".", "").isalpha() and nome.isupper():
                        ultimo["nome"] += " " + nome
    return out
