#!/bin/bash
# Move any recipe-pack PDFs that have landed in Downloads into the Drive recipe library,
# then re-run the parser. Safe to run repeatedly: it never overwrites and never deletes.
#   bash tools/sync-recipes.sh            files packs
#   bash tools/sync-recipes.sh singles    files one-recipe-per-file exports instead
set -euo pipefail
LIB="$HOME/Library/CloudStorage/GoogleDrive-jayme.gtkfitness@gmail.com/My Drive/Legacy Performance/Recipe Library"
SUB="Packs"; [ "${1:-}" = "singles" ] && SUB="Singles"
mkdir -p "$LIB/$SUB"
n=0
while IFS= read -r -d '' f; do
  b=$(basename "$f")
  case "$b" in *\(1\).pdf|*\(2\).pdf) continue;; esac
  # already in the library under either subfolder? leave it alone
  if [ -f "$LIB/Packs/$b" ] || [ -f "$LIB/Singles/$b" ]; then continue; fi
  if cp -n "$f" "$LIB/$SUB/$b" 2>/dev/null && [ -f "$LIB/$SUB/$b" ]; then
    echo "filed: $b"; n=$((n+1))
  fi
done < <(find "$HOME/Downloads" -maxdepth 1 -name '*.pdf' -mtime -1 -print0)
echo "$n new file(s)"
python3 "$(dirname "$0")/import-recipes.py"
