#!/usr/bin/env python3
"""Import recipe packs (PDF) into staged engine rows.

Reads every PDF under the Drive recipe library, pulls each recipe's name, macros, servings, times,
ingredients and directions, and grades it by effort so the deck can offer one of each kind at a meal:

    1 no cook        nothing is heated
    2 throw together one pot or one pan, about 15 minutes, few steps
    3 simple         about 30 minutes, a handful of steps
    4 full recipe    everything else

Five page layouts are in the library, so each is tried in turn:

    A  labelled column        Kcal / Protein (g) stacked under the ingredients
    B  one-line NUTRITION INFO
    C  single-recipe export   Energy : 619 Cal, the only layout carrying fibre and sugar
    D  "What you need to do"  Prep / Cook / Kcal / Fats(g) / Carbs(g) / Protein(g), tag letters
    E  "Nutrition Per Serve"  Energy / Carbs / Protein / Fat stacked, tag letters

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
# The D and E layouts carry single-letter codes in place of words.
CODES = {'GF': 'GLUTEN FREE', 'DF': 'DAIRY FREE', 'V': 'VEGETARIAN', 'VG': 'VEGAN',
         'HP': 'HIGH PROTEIN', 'LC': 'LOW CARB', 'MP': 'MEAL PREP', 'Q': 'QUICK', 'N': 'CONTAINS NUTS'}


def num(m, g=1, default=None):
    return round(float(m.group(g))) if m else default


def lines(t):
    return [l.strip() for l in t.split('\n') if l.strip()]


# ---------------------------------------------------------------- layouts

def layout_ab(t):
    """A and B: the packs that head their sections INGREDIENTS and DIRECTIONS."""
    if not (re.search(r'INGREDIENTS', t, re.I) and re.search(r'DIRECTIONS', t, re.I)):
        return None
    kcal = (re.search(r'Kcal\s*\n\s*(\d+)', t) or re.search(r'Calories:\s*(\d+)', t)
            or re.search(r'Energy\s*:\s*(\d+(?:\.\d+)?)', t))
    pro = (re.search(r'Protein \(g\)\s*\n\s*(\d+)', t) or re.search(r'Protein:\s*(\d+)', t)
           or re.search(r'Protein\s*:\s*(\d+(?:\.\d+)?)', t))
    if not (kcal and pro):
        return None
    carb = (re.search(r'Carbs \(g\)\s*\n\s*(\d+)', t) or re.search(r'Carbohydrates?:\s*(\d+)', t)
            or re.search(r'Carbs\s*:\s*(\d+(?:\.\d+)?)', t))
    fat = (re.search(r'Fats \(g\)\s*\n\s*(\d+)', t) or re.search(r'Fat:\s*(\d+)', t)
           or re.search(r'Fat\s*:\s*(\d+(?:\.\d+)?)', t))
    prep = re.search(r'PREP(?:PING)? TIME:\s*(\d+)', t, re.I)
    cook = re.search(r'COOK(?:ING)? TIME:\s*(\d+)', t, re.I)
    m = re.search(r'Ingredients\s*\n(.+?)\n(?:PREP|COOK|SERVES)', t, re.S)
    title = m.group(1).strip().split('\n')[0] if m else None
    if not title:
        for line in lines(t):
            if line.isupper() or re.match(r'^(DIRECTIONS|INGREDIENTS|NUTRITION|SERVINGS|PREPPING|COOKING)', line, re.I):
                continue
            if len(line) < 60 and not re.match(r'^[\d/½¼¾]', line):
                title = line
                break
    return dict(layout='A/B', title=title, kcal=num(kcal), protein=num(pro), carbs=num(carb), fat=num(fat),
                fiber=num(re.search(r'Fiber\s*:?\s*(\d+(?:\.\d+)?)', t)),
                sugar=num(re.search(r'Sugar\s*:?\s*(\d+(?:\.\d+)?)', t)),
                prep_min=num(prep, default=0), cook_min=num(cook),
                serves=num(re.search(r'SERV(?:INGS|ES):\s*(\d+)', t, re.I), default=1),
                tags=[x for x in TAGS if x in t.upper()])


def layout_d(t):
    """D: 'What you need to do', with Prep / Cook / Kcal / Fats(g) / Carbs(g) / Protein(g) stacked
    above their six values in the same order."""
    lab = re.search(r'Prep\s*\n\s*Cook\s*\n\s*Kcal\s*\n\s*Fats?\(g\)\s*\n\s*Carbs?\(g\)\s*\n\s*Protein\(g\)\s*\n(.{0,120})',
                    t, re.S)
    if not lab:
        return None
    vals = re.findall(r'(\d+)\s*(?:mins?)?', lab.group(1))
    vals = [v for v in vals if v != '']
    if len(vals) < 6:
        return None
    prep, cook, kcal, fat, carb, pro = (int(v) for v in vals[:6])
    # Walk back from "What you need to": the title is every line up to the bare page number.
    title, ls = None, lines(t)
    for i, l in enumerate(ls):
        if l.startswith('What you need to'):
            part = []
            for j in range(i - 1, -1, -1):
                if re.fullmatch(r'\d+', ls[j]):
                    break
                part.insert(0, ls[j])
                if len(part) > 3:
                    part = []
                    break
            title = ' '.join(' '.join(part).split()) or None
            break
    codes = re.findall(r'^\s*(GF|DF|VG|V|HP|LC|MP|Q|N)\s*$', t, re.M)
    return dict(layout='D', title=title, kcal=kcal, protein=pro, carbs=carb, fat=fat, fiber=None, sugar=None,
                prep_min=prep, cook_min=cook,
                serves=num(re.search(r'Serves\s*(\d+)', t, re.I), default=1),
                tags=sorted({CODES[c] for c in codes if c in CODES}))


def layout_e(t):
    """E: 'Nutrition Per Serve' with Energy / Carbs / Protein / Fat stacked above their values."""
    m = re.search(r'Energy\s*\n\s*Carbs\s*\n\s*Protein\s*\n\s*Fat\s*\n\s*(\d+)\s*kcal\s*\n\s*(\d+)\s*g\s*\n\s*(\d+)\s*g\s*\n\s*(\d+)\s*g',
                  t, re.I)
    if not m:
        return None
    kcal, carb, pro, fat = (int(m.group(i)) for i in (1, 2, 3, 4))
    title = None
    ls = lines(t)
    if 'myfitnesspal' in ls:
        i = ls.index('myfitnesspal') + 1
        part = []
        # The title runs over one or two short title-case lines, then the directions begin.
        while i < len(ls) and len(part) < 3:
            l = ls[i]
            if len(l) > 45 or l.endswith('.') or l.endswith(':') or re.match(r'^[\d½¼¾⅓⅔⅛]', l):
                break
            part.append(l)
            i += 1
        title = ' '.join(part) or None
    total = num(re.search(r'(\d+)\s*Minutes', t, re.I))
    codes = re.findall(r'^\s*(GF|DF|VG|V|HP|LC|MP|Q|N)\s*$', t, re.M)
    return dict(layout='E', title=title, kcal=kcal, protein=pro, carbs=carb, fat=fat, fiber=None, sugar=None,
                prep_min=0, cook_min=(None if total is None else total),
                serves=num(re.search(r'Serves\s*(\d+)', t, re.I), default=1),
                tags=sorted({CODES[c] for c in codes if c in CODES}))


def grade(cook, prep, steps, text):
    total = (prep or 0) + (cook or 0)
    if cook == 0 or (cook is None and not HEAT.search(text)):
        return 1, 'no cook'
    if ONEPOT.search(text) or (total and total <= 15) or steps <= 2:
        return 2, 'throw together'
    if (total and total <= 30) or steps <= 4:
        return 3, 'simple'
    return 4, 'full recipe'


def parse_pdf(path):
    doc, out = fitz.open(path), []
    single = len(doc) == 1
    for i, page in enumerate(doc):
        t = page.get_text()
        if len(t.strip()) < 60:
            continue
        r = layout_ab(t) or layout_d(t) or layout_e(t)
        if not r or not (r['kcal'] and r['protein']):
            continue
        if single:
            r['title'] = os.path.splitext(os.path.basename(path))[0]
        if not r['title']:
            r['title'] = '%s page %d' % (os.path.basename(path), i + 1)
        steps = len(re.findall(r'^\s*\d+\s*[.)]', t, re.M)) or 1
        g, label = grade(r['cook_min'], r['prep_min'], steps, t)
        r.update(source=os.path.relpath(path, LIB), page=i + 1, steps=steps,
                 effort=g, effort_label=label,
                 density=round(r['protein'] / r['kcal'] * 100, 1), raw=t)
        out.append(r)
    return out


def load_vault():
    """The Wellness Vault export: already structured, so no page parsing. It is the only source that
    carries fibre on every recipe and gram weights on every ingredient, which is what lets the engine
    rescale a recipe to a client's numbers instead of picking whichever one lands closest."""
    path = os.path.join(LIB, 'Vault', 'wv-recipes-full.json')
    if not os.path.exists(path):
        return []
    out = []
    for r in json.load(open(path)):
        n = r.get('n') or {}
        kcal, pro = n.get('kcal'), n.get('p')
        if not (kcal and pro):
            continue
        steps = len(r.get('s') or []) or 1
        text = ' '.join(r.get('s') or [])
        g, label = grade(r.get('ck'), r.get('pr'), steps, text)
        out.append(dict(
            layout='vault', source='Vault/wv-recipes-full.json', page=0, vault_id=r.get('id'),
            title=r.get('t'), kcal=round(kcal), protein=round(pro),
            carbs=None if n.get('c') is None else round(n['c']),
            fat=None if n.get('f') is None else round(n['f']),
            fiber=None if n.get('fib') is None else round(n['fib']),
            sugar=None, serves=r.get('sv') or 1,
            prep_min=r.get('pr') or 0, cook_min=r.get('ck'), chill=None,
            steps=steps, effort=g, effort_label=label,
            density=round(pro / kcal * 100, 1),
            tags=sorted({t.upper() for t in (r.get('tg') or [])}),
            ingredients=r.get('i') or [],
            directions=r.get('s') or [],
            raw=text))
    return out


def main():
    pdfs = sorted(glob.glob(os.path.join(LIB, '**', '*.pdf'), recursive=True))

    all_r = load_vault()
    if all_r:
        print('%-52s %4d recipes' % ('Vault/wellness-vault-recipes.json', len(all_r)))
    for p in pdfs:
        r = parse_pdf(p)
        all_r += r
        print('%-52s %4d recipes' % (os.path.relpath(p, LIB)[:52], len(r)))
    json.dump(all_r, open(OUT, 'w'), indent=1)
    print('\n%d recipes staged -> %s' % (len(all_r), OUT))
    by = {}
    for r in all_r:
        by[r['effort_label']] = by.get(r['effort_label'], 0) + 1
    print('by effort:', by)
    print('GLP-1 grade (10g protein per 100 cal or better): %d' % len([r for r in all_r if r['density'] >= 10]))
    print('carry fibre (needed to sort the GLP-1 switch): %d of %d'
          % (len([r for r in all_r if r.get('fiber') is not None]), len(all_r)))
    tg = {}
    for r in all_r:
        for x in r['tags']:
            tg[x] = tg.get(x, 0) + 1
    print('tags:', dict(sorted(tg.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    main()
