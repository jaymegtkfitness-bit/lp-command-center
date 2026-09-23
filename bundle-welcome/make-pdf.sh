#!/bin/zsh
# Prints bundle-welcome/pdf.html (one page) to the PDF sent to Legacy Blueprint Bundle buyers.
# Run after changing the page or its links.js.
HERE=${0:A:h}
OUT="$HERE/../../Legacy-Blueprint-Bundle-Next-Steps.pdf"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$OUT" "file://$HERE/pdf.html" 2>/dev/null
echo "wrote ${OUT:A}"
