#!/bin/zsh
# Re-wraps the built GHL drop-in as the standalone hosted page.
# Run after: site/build.py legacy-install
HERE=${0:A:h}
python3 - "$HERE" <<'PY'
import sys, re, pathlib
here = pathlib.Path(sys.argv[1])
frag = (here / '../../site/dist/legacy-install.html').resolve().read_text()
page = (here / 'index.html').read_text()
head = page.split('<body>')[0] + '<body>\n'
(here / 'index.html').write_text(head + frag + "\n</body>\n</html>\n")
print("rewrapped", len(head+frag), "bytes")
PY
