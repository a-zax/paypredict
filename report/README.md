# Report

`report.html` is the source of the report (A4, print-styled). `build_pdf.py` turns it into a PDF.

## Build the PDF

```bash
pip install pypdfium2
python report/build_pdf.py
```

The script prints the page through headless Microsoft Edge, reads the page numbers of each heading, fills
them into the contents page and prints again (two passes). It expects Edge at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; edit `EDGE` in the script for another
location or browser. Output: `report/monikabhati2005_FinTechAI_Hackathon4.0.pdf` (git-ignored).

## Tables

Every table in the report has complete borders (all four sides of every cell). The rules live in the
`/* tables */` block of the `<style>` element in `report.html`; new tables pick them up automatically,
so no per-table border styling is needed. Table captions go in a `.caption` div under the table.

## Screenshots

`shots/` holds the application screenshots used as figures. To recapture them, start the app on port 8000
and run `bash report/shots.sh` (static pages) and `python report/shots_interactive.py` (the Hindi message, Hindi pay
page and credit-check shots, which need clicks or typed input; needs `pip install websockets`). `shots.sh` writes a temporary login helper into `web/dist` and removes it when
finished. Its output path and browser path are set for the author's Windows machine, so edit `OUT` and
`EDGE` at the top before running elsewhere.

`ai_data.json` holds the captured model output (factor importance, probability curves, metrics, Munim AI traces) used for the report's figures and tables.