#!/bin/zsh
# Prints youre-in/pdf.html (one page) to the PDF attached to the CNS follow-up email.
# Run after changing the page or its CONFIG links.
HERE=${0:A:h}
OUT="$HERE/../../CNS-Youre-In-Steps.pdf"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="$OUT" "file://$HERE/pdf.html" 2>/dev/null
echo "wrote ${OUT:A}"
