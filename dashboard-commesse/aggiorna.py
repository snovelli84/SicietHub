"""Un solo comando: rilegge input/, applica le regole, controlla i totali e rigenera dist/index.html.
Uso:  python3 aggiorna.py"""
import subprocess, sys
from pathlib import Path

R = Path(__file__).resolve().parent
sys.path.insert(0, str(R))
from pipeline import build, genera  # noqa: E402

build.main()
genera.main()
print((R / "data/riconciliazione.txt").read_text(encoding="utf-8"))
r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(R / "tests")], cwd=R)
print("\nDashboard pronta:", R / "dist/index.html", "" if r.returncode == 0 else "\n⚠ TEST DI RICONCILIAZIONE FALLITI: vedi sopra")
