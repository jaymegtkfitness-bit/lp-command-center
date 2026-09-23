#!/bin/zsh
# Prints bundle-welcome/pdf.html (one page) to the PDF sent to Legacy Blueprint Bundle buyers.
# Run after changing the page or its links.js.
HERE=${0:A:h}
OUT="$HERE/next-steps.pdf"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$OUT" "file://$HERE/pdf.html" 2>/dev/null
cp "$OUT" "$HERE/../../Legacy-Blueprint-Bundle-Next-Steps.pdf"   # copy for the receipt email
echo "wrote ${OUT:A} (+ a copy in Legacy-Performance-App/)"
