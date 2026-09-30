#!/bin/bash
# Build one client's Drive kit: system PDF + onboarding guide + Power Food List + a sheet per recipe.
# Usage: bash tools/build-kit.sh <client.json> "<Client Name>"
set -e
JSON="$1"; NAME="$2"
DASH="$HOME/Legacy-Performance-App/dashboard"
DRIVE="$HOME/Library/CloudStorage/GoogleDrive-jayme.gtkfitness@gmail.com/My Drive/Legacy Performance/Client Kits/$NAME"
TMP="$(mktemp -d /private/tmp/claude-501/kit-XXXX)"
cd "$DASH"
mkdir -p "$DRIVE/Recipe sheets"
node tools/make-client-kit.js "$JSON" "$TMP" >/dev/null
URL="$(node tools/kit-url.js "$JSON")"
python3 - "$JSON" "$NAME" "$TMP" "$URL" <<'PY'
import json,sys,os,glob,re
json_path,name,tmp,url=sys.argv[1:5]
jobs=[{"url":url,"out":f"{tmp}/out/01 {name} - Nutrition System.pdf","settle":4000},
      {"url":f"file://{tmp}/_html/onboarding.html","out":f"{tmp}/out/00 Start here - Onboarding guide.pdf"},
      {"url":"http://localhost:8777/power-food-list/","out":f"{tmp}/out/02 The Power Food List.pdf"}]
man=json.load(open(f"{tmp}/_html/manifest.json"))
seen={}
for m in man:
    t=m['title']; seen[t]=seen.get(t,0)+1
    label=t if seen[t]==1 else f"{t} ({m['slot']})"
    safe=re.sub(r'[\\/:*?"<>|]','-',label)
    jobs.append({"url":f"file://{tmp}/_html/{m['file']}","out":f"{tmp}/out/Recipe sheets/{m['n']:02d} {safe}.pdf","settle":1500})
json.dump(jobs,open(f"{tmp}/jobs.json","w"))
PY
(curl -s -o /dev/null localhost:8777 || (cd "$DASH" && python3 -m http.server 8777 >/dev/null 2>&1 &)) ; sleep 1
node tools/print-pdfs.mjs "$TMP/jobs.json" > "$TMP/result.json"
rsync -a "$TMP/out/" "$DRIVE/"
python3 -c "
import json,sys
d=json.load(open('$TMP/result.json'))
print(len(d),'files')
for x in d: print('  ',round(x['bytes']/1024),'KB', x['out'].split('/out/')[-1])"
