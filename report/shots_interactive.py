"""Capture report screenshots that need clicks (headless Edge driven over the DevTools protocol).

Needs the local server on :8000.   .venv/Scripts/python report/shots_interactive.py
  message_hi.png  - invoice panel: reminder drafted in Hindi with the UPI pay link
  pay_hi.png      - the customer's UPI payment page on a phone, in Hindi
  credit.png      - new order check with the what-if comparison of credit periods
"""
import asyncio
import base64
import json
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
APP = "http://localhost:8000"
PROD = "https://paypredict-ad5f.onrender.com"
OUT = Path(__file__).resolve().parent / "shots"
PORT = 9333
INVOICE = 35936


def api(path, token=None, data=None):
    req = urllib.request.Request(APP + path, data=data, method="POST" if data is not None else "GET",
                                 headers={"Authorization": f"Bearer {token}"} if token else {})
    return json.load(urllib.request.urlopen(req, timeout=120))


class Page:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expr):
        r = await self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        return r.get("result", {}).get("value")

    async def size(self, w, h, mobile=False):
        await self.send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=mobile)

    async def go(self, url, wait=4):
        await self.send("Page.navigate", url=url)
        await asyncio.sleep(wait)

    async def shot(self, name):
        r = await self.send("Page.captureScreenshot", format="png")
        (OUT / name).write_bytes(base64.b64decode(r["data"]))
        print("saved", name)

    async def click_text(self, text, scope="document", contains=False):
        test = f"x.textContent.includes({json.dumps(text)})" if contains else f"x.textContent.trim() === {json.dumps(text)}"
        ok = await self.js(f"""(() => {{ const b = [...{scope}.querySelectorAll('button,[role=option]')]
            .find(x => {test}); if (b) b.click(); return !!b; }})()""")
        if not ok:
            raise RuntimeError(f"button not found: {text}")


async def run(ws_url, login):
    async with websockets.connect(ws_url, max_size=50_000_000) as ws:
        p = Page(ws)
        await p.send("Page.enable")
        await p.send("Runtime.enable")
        await p.size(1440, 1000)
        await p.go(APP + "/login", 3)
        uid = login["user"]["id"]
        await p.js(f"""localStorage.setItem('pp_token', {json.dumps(login['token'])}); localStorage.setItem('pp_tour_{uid}', 'done');
                       localStorage.setItem('pp_setup_hidden_{uid}', '1'); localStorage.setItem('pp_theme', 'light');
                       localStorage.setItem('pp_shot', '1'); true""")

        # 1. reminder in Hindi with the UPI link (production address, as the live app writes it)
        await p.go(f"{APP}/?invoice={INVOICE}", 5)
        await p.click_text("हिंदी", "document.querySelector('[data-tour=\"drawer-message\"]')")
        await asyncio.sleep(2.5)
        await p.js(f"""(() => {{ const c = document.querySelector('[data-tour="drawer-message"]'); c.scrollIntoView({{block: 'start'}});
            const ta = c.querySelector('textarea'); ta.value = ta.value.replaceAll({json.dumps(APP)}, {json.dumps(PROD)});
            ta.rows = 14; return true; }})()""")
        await asyncio.sleep(1)
        await p.shot("message_hi.png")

        # 2. what the customer sees on the phone
        pay = api(f"/api/invoices/{INVOICE}", login["token"])["pay_url"].replace(APP, "")
        await p.size(500, 980, mobile=True)
        await p.go(f"{APP}{pay}?lang=hi", 5)
        await p.shot("pay_hi.png")

        # 3. new order check with what-if
        await p.size(1440, 1000)
        await p.go(APP + "/credit-check", 4)
        await p.js("document.querySelector('input[aria-label=Customer]').focus(); true")
        await p.send("Input.insertText", text="Deccan Electricals")
        await asyncio.sleep(1)
        await p.click_text("Deccan Electricals Ltd", "document.getElementById('credit-customers')", contains=True)
        await p.js("document.querySelector('input[inputmode=numeric]').focus(); true")
        await p.send("Input.insertText", text="500000")
        await asyncio.sleep(0.5)
        await p.click_text("Check this order")
        await asyncio.sleep(8)
        h = await p.js("Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('main,[class*=overflow-y]')].map(e => e.scrollHeight))")
        await p.size(1440, int(min(max(h, 1000), 3000)))
        await asyncio.sleep(2)
        await p.shot("credit.png")


def main():
    login = api("/api/auth/demo", data=b"")
    prof = tempfile.mkdtemp()
    proc = subprocess.Popen([EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={prof}", "about:blank"])
    try:
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=2))
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.3)
        asyncio.run(asyncio.wait_for(run(page["webSocketDebuggerUrl"], login), 180))
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == "__main__":
    main()
