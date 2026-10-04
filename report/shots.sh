#!/usr/bin/env bash
# Capture app screenshots for the report with headless Edge, all in parallel, 60 s cap each.
# Needs the local server on :8000. Writes a TEMPORARY login helper into web/dist and deletes it at the end.
cd "$(dirname "$0")/.." || exit 1
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
OUT="D:/IESMCRC-Hackhton/report/shots"
mkdir -p report/shots

./.venv/Scripts/python.exe - <<'EOF'
import json, urllib.request
r = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:8000/api/auth/demo", data=b"", method="POST"), timeout=120))
uid = r["user"]["id"]
inv = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:8000/api/invoices/35936",
      headers={"Authorization": "Bearer " + r["token"]}), timeout=60))
open("report/.pay_path", "w").write(inv["pay_url"].split(":8000", 1)[1])
js = f"""// TEMPORARY screenshot helper - deleted after capture.
const p = new URLSearchParams(location.search);
localStorage.setItem("pp_token", {json.dumps(r["token"])});
localStorage.setItem("pp_tour_{uid}", "done");
localStorage.setItem("pp_setup_hidden_{uid}", "1");
localStorage.setItem("pp_theme", "light");
localStorage.setItem("pp_shot", "1");
location.replace(p.get("to") || "/");
"""
open("web/dist/_shot.js", "w", encoding="utf-8").write(js)
open("web/dist/_shot.html", "w", encoding="utf-8").write('<!doctype html><meta charset="utf-8"><script src="/_shot.js"></script>')
open("web/dist/_anon.js", "w", encoding="utf-8").write('localStorage.setItem("pp_shot","1");localStorage.setItem("pp_theme","light");location.replace(new URLSearchParams(location.search).get("to"));')
open("web/dist/_anon.html", "w", encoding="utf-8").write('<!doctype html><meta charset="utf-8"><script src="/_anon.js"></script>')
EOF
PAY=$(cat report/.pay_path)

shot() {  # name size helper target
  if [ -n "$ONLY" ] && [[ " $ONLY " != *" $1 "* ]]; then return; fi
  local prof; prof="$TEMP/pp_shot_$1_$RANDOM"
  timeout 60 "$EDGE" --headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir="$prof" \
    --window-size="$2" --virtual-time-budget=20000 --screenshot="$OUT/$1.png" \
    "http://localhost:8000/$3?to=$(MSYS_NO_PATHCONV=1 ./.venv/Scripts/python.exe -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$4")" >/dev/null 2>&1
  echo "$1: exit $? $(stat -c %s "$OUT/$1.png" 2>/dev/null) bytes"
  rm -rf "$prof"
}
shot today        1440,1000 _shot.html /             &
shot invoice      1440,1100 _shot.html "/?invoice=35936" &
shot cash         1440,1050 _shot.html /cash         &
shot customers    1440,1100 _shot.html /customers    &
shot pay_mobile   500,980   _anon.html "$PAY"        &
shot copilot      1440,1000 _shot.html "/?ask=Should I accept an order of 5 lakh from Deccan Electricals?" &
shot reply        1440,1000 _shot.html "/?ask=Kaveri replied: will pay by next Friday" &
shot ai_full      1440,4200 _shot.html /impact       &
wait
rm -f web/dist/_shot.js web/dist/_shot.html web/dist/_anon.js web/dist/_anon.html report/.pay_path
echo "done - helper removed"
