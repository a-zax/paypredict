"""Build the solution-report PDF with headless Edge, then fill the contents page numbers (two passes).

    .venv/Scripts/python report/build_pdf.py
"""
import re
import subprocess
import tempfile
from pathlib import Path

import pypdfium2 as pdfium

HERE = Path(__file__).resolve().parent
SRC = HERE / "report.html"
OUT = HERE / "monikabhati2005_FinTechAI_Hackathon4.0.pdf"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def render(html: Path, pdf: Path):
    with tempfile.TemporaryDirectory() as prof:     # fresh profile each time: no cached copy of the page
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={prof}",
                        "--no-pdf-header-footer", f"--print-to-pdf={pdf}", html.as_uri()],
                       check=True, timeout=120, capture_output=True)


def pages_text(pdf: Path) -> list[str]:
    doc = pdfium.PdfDocument(str(pdf))
    try:
        return [doc[i].get_textpage().get_text_range() for i in range(len(doc))]
    finally:
        doc.close()                                 # Windows: an open handle would stop Edge overwriting the file


def main():
    html = SRC.read_text(encoding="utf-8")
    tmp = HERE / "_build.html"                      # same folder so relative image paths resolve
    try:
        tmp.write_text(html, encoding="utf-8")
        render(tmp, OUT)
        texts = pages_text(OUT)
        keys = re.findall(r'data-pg="([^"]+)"', html)
        found = {}
        for k in keys:
            for i, t in enumerate(texts[2:], start=3):  # skip cover and the contents page itself
                if re.search(r"(^|\n)\s*" + re.escape(k), t):
                    found[k] = i
                    break
        missing = [k for k in keys if k not in found]
        if missing:
            raise SystemExit(f"Headings not found in PDF: {missing}")
        filled = re.sub(r'<span data-pg="([^"]+)"></span>', lambda m: f'<span>{found[m.group(1)]}</span>', html)
        tmp.write_text(filled, encoding="utf-8")
        render(tmp, OUT)
    finally:
        tmp.unlink(missing_ok=True)
    print(f"{OUT.name}: {len(pages_text(OUT))} pages; contents -> {found}")


if __name__ == "__main__":
    main()
