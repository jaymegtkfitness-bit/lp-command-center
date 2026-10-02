#!/usr/bin/env python3
"""Import recipe packs (PDF) into staged engine rows.

Reads every PDF in the Drive recipe library, pulls each recipe's name, macros, servings, times,
ingredients and directions, and grades it by effort so the deck can offer one of each kind at a meal:

    1 no cook        nothing is heated
    2 throw together one pot or one pan, about 15 minutes, few steps
    3 simple         about 30 minutes, a handful of steps
    4 full recipe    everything else

Usage: python3 tools/import-recipes.py [outfile.json]
Writes staged JSON for review. It never edits recipe-data.js directly: Jayme approves first.
"""
import fitz, re, json, sys, os, glob

LIB = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-jayme.gtkfitness@gmail.com/My Drive/Legacy Performance/Recipe Library")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/private/tmp/claude-501/recipes-staged.json"

HEAT = re.compile(r'\b(bake|roast|grill|fry|saute|sauté|simmer|boil|cook|heat|oven|stove|skillet|air fry|broil|microwave|steam|sear|toast)\b', re.I)
ONEPOT = re.compile(r'\b(one[- ]?pot|one[- ]?pan|sheet[- ]?pan|slow cooker|crock ?pot|air fryer|instant pot)\b', re.I)
TAGS = ['VEGETARIAN', 'VEGAN', 'GLUTEN FREE', 'DAIRY FREE', 'LOW CARB', 'HIGH PROTEIN', 'PESCATARIAN']


def num(m, default=None):
    return int(m.group(1)) if m else default


def parse_macros(t):
    """Two layouts seen so far: a labelled column, and a one-line NUTRITION INFO."""
    kcal = re.search(r'Kcal\s*\n\s*(\d+)', t) or re.search(r'Calories:\s*(\d+)', t)
    pro = re.search(r'Protein \(g\)\s*\n\s*(\d+)', t) or re.search(r'Protein:\s*(\d+)', t)
    carb = re.search(r'Carbs \(g\)\s*\n\s*(\d+)', t) or re.search(r'Carbohydrates?:\s*(\d+)', t)
    fat = re.search(r'Fats \(g\)\s*\n\s*(\d+)', t) or re.search(r'Fat:\s*(\d+)', t)
    return num(kcal), num(pro), num(carb), num(fat)


def parse_title(t, page):
    """The title sits between the ingredients and the timing line in layout A; in layout B it is the
    first short line that is not a heading."""
    m = re.search(r'Ingredients\s*\n(.+?)\n(?:PREP|COOK|SERVES)', t, re.S)
    if m:
        return m.group(1).strip().split('\n')[0]
    for line in [l.strip() for l in t.split('\n') if l.strip()]:
        if line.isupper() or re.match(r'^(DIRECTIONS|INGREDIENTS|NUTRITION|SERVINGS|PREPPING|COOKING)', line, re.I):
            continue
        if len(line) < 60 and not re.match(r'^[\d/½¼¾]', line):
            return line
    return 'page %d' % page


def parse_times(t):
    prep = re.search(r'PREP(?:PING)? TIME:\s*(\d+)', t, re.I)
    cook = re.search(r'COOK(?:ING)? TIME:\s*(\d+)', t, re.I)
    chill = re.search(r'(?:COOLING|CHILL) TIME:\s*(\d+)\s*(HRS?|MIN)', t, re.I)
    return num(prep, 0), num(cook, None), (chill.group(0) if chill else None)


def grade(cook, prep, steps, text):
    total = (prep or 0) + (cook or 0)
    if (cook == 0 or (cook is None and not HEAT.search(text))):
        return 1, 'no cook'
    if ONEPOT.search(text) or (total and total <= 15) or steps <= 2:
        return 2, 'throw together'
    if (total and total <= 30) or steps <= 4:
        return 3, 'simple'
    return 4, 'full recipe'


def parse_pdf(path):
    doc, out = fitz.open(path), []
    for i, page in enumerate(doc):
        t = page.get_text()
        if not (re.search(r'INGREDIENTS', t, re.I) and re.search(r'DIRECTIONS', t, re.I)):
            continue
        kcal, pro, carb, fat = parse_macros(t)
        if not (kcal and pro):
            continue
        prep, cook, chill = parse_times(t)
        steps = len(re.findall(r'^\s*\d+\s*[.)]', t, re.M)) or 1
        g, label = grade(cook, prep, steps, t)
        serves = re.search(r'SERV(?:INGS|ES):\s*(\d+)', t, re.I)
        out.append(dict(
            source=os.path.basename(path), page=i + 1,
            title=parse_title(t, i + 1),
            kcal=kcal, protein=pro, carbs=carb, fat=fat,
            serves=num(serves, 1), prep_min=prep, cook_min=cook, chill=chill,
            steps=steps, effort=g, effort_label=label,
            density=round(pro / kcal * 100, 1),
            tags=[x for x in TAGS if x in t.upper()],
            raw=t))
    return out


def main():
    pdfs = sorted(glob.glob(os.path.join(LIB, '*.pdf')))
    if not pdfs:
        print('no PDFs in', LIB); return
    all_r = []
    for p in pdfs:
        r = parse_pdf(p)
        all_r += r
        print('%-42s %3d recipes' % (os.path.basename(p)[:42], len(r)))
    json.dump(all_r, open(OUT, 'w'), indent=1)
    print('\n%d recipes staged -> %s' % (len(all_r), OUT))
    by = {}
    for r in all_r:
        by[r['effort_label']] = by.get(r['effort_label'], 0) + 1
    print('by effort:', by)
    dense = [r for r in all_r if r['density'] >= 10]
    print('GLP-1 grade (10g protein per 100 cal or better): %d' % len(dense))


if __name__ == '__main__':
    main()
