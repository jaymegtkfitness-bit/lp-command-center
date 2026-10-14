#!/usr/bin/env python3
"""Convert staged Wellness Vault rows -> RECIPE_LIBRARY entries for recipe-data.js.

The generator (nutrition-engine.js) scales a recipe by PROTEIN (s = target_protein / r.m[1])
and trusts r.m for the displayed macros, so the two things that must be right are:
  - r.m = [kcal, protein, carbs, fat] PER SERVING   (vault carries this, verified consistent)
  - per-serving ingredient quantities               (vault q is WHOLE recipe -> divide by serves)
plus: a recognizable `lead` protein, a single `slot` (am/pm/snack), and section/allergen tags.

Usage:  python3 tools/vault-to-library.py <staged.json>  > /tmp/vault-lib.js
Emits only the recipe object literals (comma-separated), ready to splice into RECIPE_LIBRARY.
"""
import json, sys, re, hashlib

staged = json.load(open(sys.argv[1]))
rows = [r for r in staged if r.get('layout') == 'vault']

FRUIT = re.compile(r'apple|banana|berr|blueberr|strawberr|raspberr|blackberr|peach|pear|mango|pineapple|melon|cantaloupe|watermelon|grape|orange|clementine|kiwi|cherry|cherries|plum|apricot|fig|date|pomegranate|cranberr|lemon|lime|citrus|nectarine|papaya|guava|passion', re.I)
BEAN  = re.compile(r'\b(beans?|lentil|chickpea|garbanzo|edamame|tofu|tempeh|black.?eyed|split pea|hummus)\b', re.I)
NUT   = re.compile(r'almond|cashew|walnut|pecan|hazelnut|pistachio|macadamia|pine nut|peanut|nut butter|chia|flax|hemp|sunflower seed|pumpkin seed|sesame|tahini|seeds?\b', re.I)
GRAIN = re.compile(r'\b(rice|oat|quinoa|pasta|bread|flour|barley|couscous|tortilla|bagel|wrap|noodle|farro|bulgur|millet|cereal|cracker|granola|polenta|grits|english muffin|pita|naan)\b', re.I)
OILFAT= re.compile(r'\boil\b|butter|avocado|coconut|olive|ghee|mayo|mayonnaise|lard|tallow|dressing', re.I)
PWDR  = re.compile(r'protein powder|whey|collagen|protein isolate|casein', re.I)
POTATO= re.compile(r'potato|sweet potato|yam|plantain|squash|pumpkin', re.I)   # starchy produce -> carb

MEAT = re.compile(r'chicken|turkey|beef|steak|pork|bacon|ham|sausage|lamb|bison|venison|sirloin|ground', re.I)
FISH = re.compile(r'salmon|tuna|cod|tilapia|halibut|trout|mackerel|sardine|anchov|fish\b', re.I)
SHELL= re.compile(r'shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|shellfish', re.I)

def section(cat, name):
    n = name.lower()
    if PWDR.search(n): return 'pw'
    if cat == 'meat/fish/poultry': return 'mf'
    if cat == 'dairy':
        if 'butter' in n and 'nut' not in n and 'peanut' not in n: return 'fx'
        return 'ed'
    if cat == 'beans/nuts/grains':
        if BEAN.search(n): return 'pp'
        if NUT.search(n):  return 'fx'
        return 'cg'
    if cat == 'produce':
        if POTATO.search(n): return 'cg'
        if FRUIT.search(n):  return 'fr'
        return 'vg'
    if cat == 'baking':
        if GRAIN.search(n) or 'flour' in n or 'oat' in n: return 'cg'
        return 'ps'
    if cat == 'condiments':
        if OILFAT.search(n) or NUT.search(n): return 'fx'
        return 'ps'
    if cat == 'miscellaneous':
        if OILFAT.search(n) or NUT.search(n): return 'fx'
        if BEAN.search(n): return 'pp'
        if GRAIN.search(n): return 'cg'
        if FRUIT.search(n): return 'fr'
        if 'egg' in n: return 'ed'
        return 'ps'
    return 'ps'   # seasonings + anything else

def allergens(name):
    n = name.lower(); t = ''
    if re.search(r'milk|cheese|yogurt|cream|butter|whey|casein|dairy|parmesan|feta|mozz|ricotta|cottage', n) and 'nut' not in n and 'peanut' not in n and 'coconut' not in n: t += 'D'
    if re.search(r'\begg', n): t += 'E'
    if re.search(r'wheat|bread|pasta|flour|gluten|barley|rye|couscous|cracker|bagel|tortilla|noodle|panko|breadcrumb', n): t += 'G'
    if NUT.search(n) and not re.search(r'peanut|coconut|nutmeg|water chestnut|butternut', n): t += 'N'
    if re.search(r'peanut', n): t += 'K'
    if SHELL.search(n): t += 'S'
    if FISH.search(n): t += 'F'
    if re.search(r'beef|steak|sirloin|bison|lamb|venison', n): t += 'RM'
    if re.search(r'\bpork\b|bacon|ham|prosciutto|sausage|chorizo', n): t += 'PM'
    elif re.search(r'chicken|turkey|poultry', n): t += 'M'
    if re.search(r'\bsoy|tofu|edamame|tempeh|tamari|miso|soya', n): t += 'Y'
    # dedupe preserving order
    seen=''; out=''
    for c in t:
        if c not in seen: seen+=c; out+=c
    return out

def norm_unit(u):
    u = (u or '').lower().split(',')[0].strip()
    if 'tablespoon' in u or u == 'tbsp': return 'tbsp'
    if 'teaspoon' in u or u == 'tsp': return 'tsp'
    if u.startswith('cup'): return 'cup'
    if u.startswith('oz') or 'ounce' in u: return 'oz'
    if 'scoop' in u: return 'scoop'
    if 'slice' in u: return 'slice'
    if 'clove' in u: return 'clove'
    if u in ('dash','pinch'): return 'dash'
    if u in ('lb','pound','pounds'): return 'lb'
    if u in ('ml','gram','g','grams'): return u
    return ''   # medium/large/small/each/avocado/stalk/etc -> "whole"

def slot_of(tags):
    T = set(tags)
    if 'BREAKFAST' in T: return 'am'
    if 'LUNCH' in T or 'DINNER' in T: return 'pm'
    if T & {'SNACK','DESSERT','SMOOTHIE'}: return 'snack'
    return 'pm'

def lead_of(ings):
    # best protein ingredient: meat/fish first, then anything with real protein
    best=None; bestp=-1
    for i in ings:
        m=i.get('m') or [0,0,0,0]; p=(m[1] or 0)*numq(i.get('q',0))
        wt = p + (1000 if i.get('cat')=='meat/fish/poultry' else 0)
        if wt>bestp: bestp=wt; best=i
    if not best: return 'chicken breast'
    return re.sub(r'\s+',' ', best['n']).strip().lower()

def slug(title, vid):
    s=re.sub(r'[^a-z0-9]+','-', title.lower()).strip('-')[:34]
    return (s or 'recipe')+'-'+hashlib.md5((title+str(vid)).encode()).hexdigest()[:4]

def jss(x):  # JS single-quoted string
    return "'"+str(x).replace('\\','\\\\').replace("'","\\'").replace('\n',' ').strip()+"'"

def numq(v):
    if isinstance(v,(int,float)): return float(v)
    s=str(v or '').strip()
    m=re.match(r'^\s*(\d+)\s+(\d+)\s*/\s*(\d+)', s)      # "1 1/2"
    if m: return int(m.group(1))+int(m.group(2))/int(m.group(3))
    m=re.match(r'^\s*(\d+)\s*/\s*(\d+)', s)               # "1/2"
    if m: return int(m.group(1))/int(m.group(2))
    m=re.match(r'^\s*([\d.]+)', s)
    return float(m.group(1)) if m else 0.0

MEAL={'BREAKFAST','LUNCH','DINNER','SNACK'}
out=[]; skipped=0
for r in rows:
    if not (r.get('kcal') and r.get('protein') and r.get('ingredients')): skipped+=1; continue
    if not (set(r.get('tags',[])) & MEAL): skipped+=1; continue
    serves=r.get('serves') or 1
    ings=r['ingredients']
    # need at least one real protein ingredient
    if not any(i.get('cat')=='meat/fish/poultry' or (i.get('m') and (i['m'][1] or 0)>=5) for i in ings): skipped+=1; continue
    m=[round(r['kcal']), round(r['protein']), round(r.get('carbs') or 0), round(r.get('fat') or 0)]
    if m[1] < 8: skipped+=1; continue   # not a protein-forward meal
    slot=slot_of(r['tags'])
    ing_rows=[]
    for i in ings:
        q=round(numq(i.get("q",0))/serves, 3)
        if q<=0: continue
        nm=re.sub(r'\s+',' ', i['n']).strip()
        sec=section(i.get('cat','miscellaneous'), nm)
        tags=allergens(nm)
        ing_rows.append('['+str(q)+','+jss(norm_unit(i.get('u','')))+','+jss(nm)+','+jss(tags)+','+jss(sec)+']')
    lead=lead_of(ings)
    # AUTHORITATIVE allergen-present set from the vault's "X FREE" tags (+ fish/shellfish by ingredient).
    T=set(r.get('tags',[])); names=' '.join(i['n'].lower() for i in ings)
    ax=[]
    if 'DAIRY FREE'  not in T: ax.append('dairy')
    if 'GLUTEN FREE' not in T: ax.append('gluten')
    if 'EGG FREE'    not in T: ax.append('egg')
    if 'SOY FREE'    not in T: ax.append('soy')
    if 'NUT FREE'    not in T: ax.append('nut')
    if 'peanut' in names: ax.append('peanut')
    if FISH.search(names) or 'FISH' in T: ax.append('fish')
    if SHELL.search(names): ax.append('shellfish')
    veg = 2 if 'VEGAN' in T else (1 if 'VEGETARIAN' in T else 0)
    sides = ['berries','banana'] if slot=='am' else (['brown rice','sweet potato','potatoes'] if slot=='pm' else [])
    d=r.get('directions') or r.get('raw') or ''
    how=(' '.join(d) if isinstance(d,list) else str(d)).strip()
    nocook = ', nocook:1' if r.get('effort_label')=='no cook' else ''
    lit = ('{id:'+jss(slug(r['title'], r.get('vault_id')))+nocook+', name:'+jss(r['title'])+', slot:'+jss(slot)+
           ', m:['+','.join(map(str,m))+'], lead:'+jss(lead)+
           ', sides:['+','.join(jss(s) for s in sides)+']'+
           ', ax:'+jss(','.join(ax))+', v:'+str(veg)+
           (', density:'+str(round(r['density'],1)) if r.get('density') is not None else '')+
           ', how:'+jss(how)+
           ', ing:['+','.join(ing_rows)+']}')
    out.append(lit)

sys.stderr.write('converted %d, skipped %d (of %d vault rows)\n' % (len(out), skipped, len(rows)))
print(',\n  '.join(out))
