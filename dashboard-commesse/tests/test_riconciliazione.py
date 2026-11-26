"""Test di riconciliazione (si lanciano con:  python3 -m unittest discover -s tests).
Richiedono i file reali in input/ (non inclusi nella repository)."""
import json, sys, unittest
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))


class Riconciliazione(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        f = RADICE / "data/riconciliazione.json"
        if not f.exists():
            raise unittest.SkipTest("eseguire prima: python3 pipeline/build.py")
        cls.rec = json.load(open(f, encoding="utf-8"))

    def test_prospetti_coincidono_con_intestazioni(self):
        errori = [x for x in self.rec["prospetti"] if not x["ok"]]
        self.assertEqual(errori, [], f"Prospetti non riconciliati: {errori}")

    def test_ordini_righe_uguali_ai_totali_commessa(self):
        self.assertEqual(self.rec["ordini"]["differenze"], [])

    def test_totali_pagina_ordini(self):
        # la pagina 1 contiene ordini senza commessa: ammessa
        diff = [d for d in self.rec["totali_pagina_ordini"] if d["pagina"] != 1]
        self.assertEqual(diff, [])


class Regole(unittest.TestCase):
    def test_s1469(self):
        d = json.load(open(RADICE / "data/commesse.json", encoding="utf-8"))
        tutte = {c["codice"]: c for c in d["commesse"] + d["fuori_perimetro"]}
        c = tutte["S1469"]
        self.assertAlmostEqual(c["ricavi"], 236842.78, 2)
        self.assertAlmostEqual(c["costi"], 235035.96, 2)   # dal Prospetto, non dalla Cronostoria
        self.assertTrue(c["dato_da_verificare"])

    def test_nessuna_economia(self):
        d = json.load(open(RADICE / "data/commesse.json", encoding="utf-8"))
        for c in d["commesse"] + d["fuori_perimetro"]:
            self.assertFalse(c["codice"].startswith(("SM", "SL", "SF")))


if __name__ == "__main__":
    unittest.main()
