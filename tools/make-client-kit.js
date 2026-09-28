#!/usr/bin/env node
/* CLIENT KIT BUILDER (Jayme 2026-09-28)
   One folder per client, one link to send: the system PDF, an onboarding guide, the Power Food List,
   and a recipe sheet for every meal in their deck (9 meal options + 3 snacks = the 12 they get).
   Usage: node tools/make-client-kit.js <client.json> <outDir>
   Writes HTML into <outDir>/_html; the shell script prints each one to PDF. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const DASH = path.resolve(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
for (const f of ['recipe-data.js', 'restaurant-data.js', 'nutrition-engine.js'])
  vm.runInContext(fs.readFileSync(path.join(DASH, f), 'utf8'), ctx);

const inp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3];
const htmlDir = path.join(outDir, '_html');
fs.mkdirSync(htmlDir, { recursive: true });

const shield = fs.readFileSync(path.join(DASH, 'shield-white-gold.png')).toString('base64');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const first = (inp.name || '').trim().split(' ')[0] || 'your';

const macros = ctx.macrosFrom(inp.cal, inp.pro, inp.sex);
const sel = {
  frequency: inp.freq || '3', shakeGrams: inp.shake || 30,
  protein: inp.protein || [], carb: inp.carb || [], fruit: inp.fruit || [], fat: inp.fat || [], veg: inp.veg || [],
  style: inp.style || '', allergies: inp.allergies || [], glp1: inp.glp1 || '', dislikes: inp.dislikes || ''
};
const deck = ctx.generateMealOptions({ pfs: { calories: inp.cal, protein: inp.pro, carbs: macros.carbs, fat: macros.fat } }, sel, inp.name);

/* ---- the shared look (Legacy Dark, print first) ---- */
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
@page{size:letter portrait;margin:0}
body{width:8.5in;min-height:11in;background:#161616;color:#d9d3c8;font-family:Montserrat,-apple-system,Segoe UI,sans-serif;
  padding:0.62in 0.7in;position:relative;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body:before{content:"";position:absolute;inset:0;z-index:0;
  background:radial-gradient(760px 620px at -8% 114%, rgba(74,92,62,.55), rgba(74,92,62,0) 68%),
             radial-gradient(620px 480px at 108% -10%, rgba(193,173,114,.16), rgba(193,173,114,0) 64%)}
.page{position:relative;z-index:1}
.top{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.top img{height:38px;width:auto}
.top .brand{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#8FA97A;font-weight:700}
.label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8FA97A;font-weight:700;margin-bottom:8px}
h1{font-size:30px;line-height:1.06;font-weight:900;color:#F2EDE4;letter-spacing:-.01em;margin-bottom:6px}
h1 .g{color:#C1AD72}
h2{font-size:14px;font-weight:800;color:#F2EDE4;margin:20px 0 8px;letter-spacing:.01em}
p{font-size:12.5px;line-height:1.55;margin-bottom:9px;max-width:66ch}
.lede{font-size:13.5px;color:#d9d3c8;margin-bottom:16px}
.nums{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
.num{border:1px solid rgba(143,169,122,.28);border-radius:10px;padding:8px 13px;background:rgba(74,92,62,.14);min-width:96px}
.num b{display:block;font-size:19px;color:#C1AD72;font-family:Cinzel,Georgia,serif;line-height:1.1}
.num span{font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#bdb7ac}
.tile{border:1px solid rgba(143,169,122,.22);border-radius:12px;padding:13px 15px;background:rgba(74,92,62,.12);margin-bottom:10px}
.tile b{color:#F2EDE4;font-size:12.5px;display:block;margin-bottom:3px}
.tile p{font-size:11.5px;margin:0;color:#d9d3c8}
ul,ol{margin:0 0 10px 17px}
li{font-size:12.5px;line-height:1.6;margin-bottom:4px}
.ing li{list-style:none;margin-left:-17px;padding-left:20px;position:relative;border-bottom:1px solid rgba(143,169,122,.12);padding-bottom:5px;margin-bottom:5px}
.ing li:before{content:"";position:absolute;left:0;top:5px;width:10px;height:10px;border:1.5px solid rgba(193,173,114,.6);border-radius:3px}
.ing li b{color:#F2EDE4}
.side{color:#8FA97A;font-size:11px;letter-spacing:.04em}
.foot{position:absolute;left:.7in;right:.7in;bottom:.45in;display:flex;justify-content:space-between;
  font-size:9.5px;color:#8f8a80;border-top:1px solid rgba(143,169,122,.18);padding-top:9px;z-index:1}
a{color:#C1AD72;text-decoration:none}
.note{font-size:11px;color:#bdb7ac;margin-top:10px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`;
const shell = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="page">
<div class="top"><img src="data:image/png;base64,${shield}" alt=""><span class="brand">Legacy Performance</span></div>
${body}</div>
<div class="foot"><span>Legacy Performance &middot; ${esc(inp.name || '')}</span><span>legacyperformance.co</span></div>
</body></html>`;

/* ---- recipe sheets: one per meal option, plus the snacks ---- */
const COOK = ctx.SHOP_INFO || {};
function steps(opt) {
  if (opt.recipe && opt.recipe.how)
    return String(opt.recipe.how).split(/(?<=\.)\s+/).filter(Boolean);
  /* A built meal has no written method, so the steps come from how each food is cooked. */
  const out = [], seen = {};
  (opt.parts || []).forEach(pt => {
    const info = COOK[pt.n];
    if (info && info.cook && !seen[info.cook]) { seen[info.cook] = 1; out.push(cap(pt.n) + ': ' + info.cook); }
  });
  const veg = (opt.parts || []).filter(p => p.veg).map(p => p.n);
  if (veg.length) out.push('Vegetables (' + veg.join(', ') + '): raw, steamed, or roasted at 425°F for 15 to 20 minutes.');
  out.push('Plate it together and weigh anything you are unsure of.');
  return out;
}
const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const cards = [];
deck.slots.filter(s => !/shake/i.test(s.name)).forEach(sl => {
  sl.options.forEach((o, i) => cards.push({ slot: sl.name, idx: i + 1, opt: o, target: sl.target }));
});
(deck.companions || []).forEach(c => cards.push({ slot: 'Snack', idx: 0, opt: c, target: null }));

cards.forEach((card, n) => {
  const o = card.opt, sideRx = /^on the side:\s*/i;
  const ing = (o.items || []).map(x => sideRx.test(x)
    ? `<li><b>${esc(x.replace(sideRx, ''))}</b> <span class="side">on the side</span></li>`
    : `<li><b>${esc(x)}</b></li>`).join('');
  const body = `
  <span class="label">${esc(card.slot)}${card.idx ? ' &middot; option ' + card.idx : ''}${o.nocook ? ' &middot; no cooking' : ''}</span>
  <h1>${esc(o.name || (card.slot + ' option ' + card.idx))}</h1>
  <p class="lede">Portioned for ${esc(first)}. Every option in this meal hits the same numbers, so this one can be eaten on any day.</p>
  <div class="nums">
    <div class="num"><b>${Math.round(o.cal)}</b><span>Calories</span></div>
    <div class="num"><b>${Math.round(o.protein)}g</b><span>Protein</span></div>
    <div class="num"><b>${Math.round(o.carbs)}g</b><span>Carbs</span></div>
    <div class="num"><b>${Math.round(o.fat)}g</b><span>Fat</span></div>
  </div>
  <h2>What goes in it</h2>
  <ul class="ing">${ing}</ul>
  <h2>How to make it</h2>
  <ol>${steps(o).map(s => '<li>' + esc(s) + '</li>').join('')}</ol>
  <div class="tile"><b>Weigh it, at least at first</b><p>The numbers on this sheet are only true at these portions. Weigh the protein and the carb until you can call them by eye, and keep the vegetables generous.</p></div>
  ${typeof ctx.mealLink === 'function' ? `<p class="note">Track it in one tap: <a href="${esc(ctx.mealLink(o))}">Log this meal in Cronometer</a></p>` : ''}`;
  const name = String(n + 1).padStart(2, '0') + '-' + slug(o.name || (card.slot + '-' + card.idx));
  fs.writeFileSync(path.join(htmlDir, 'recipe-' + name + '.html'), shell(o.name || card.slot, body));
});

/* ---- the onboarding guide ---- */
const split = ctx.mealSplit({ calories: inp.cal, protein: inp.pro, carbs: macros.carbs, fat: macros.fat }, sel.frequency, sel.shakeGrams);
const labels = (typeof ctx.diaryLabels === 'function') ? ctx.diaryLabels(split) : [];
const CALL = 'https://legacyperformance.co/onboarding-call';
const DASHBOARD = 'https://dashboard.legacyperformance.co/client.html';
const guide = `
  <span class="label">Start here</span>
  <h1>Everything is built. <span class="g">Here is how to run it.</span></h1>
  <p class="lede">This folder holds your whole system. Nothing to buy, nothing to figure out. Read this page once, book your call, then start.</p>
  <h2>1. Book your onboarding call</h2>
  <p>We walk through your numbers together, set up your tracking, and answer whatever the documents did not. Twenty to thirty minutes.</p>
  <div class="tile"><b>Book it now</b><p><a href="${CALL}">${CALL}</a></p></div>
  <h2>2. What is in this folder</h2>
  <div class="tile"><b>Your Nutrition System</b><p>The main document. Your meals with three options each, one shopping list, prep guides, the swap guide, your food lists, restaurant orders, and how your numbers change over time.</p></div>
  <div class="tile"><b>The Power Food List</b><p>Every food, sorted into tiers. This is the method underneath your plan, so you can build any meal anywhere without me.</p></div>
  <div class="tile"><b>Recipe sheets</b><p>One page per meal in your plan, with your portions and how to make it. Print the ones you like and keep them on the fridge.</p></div>
  <h2>3. Your numbers</h2>
  <div class="nums">
    <div class="num"><b>${Math.round(inp.cal)}</b><span>Calories a day</span></div>
    <div class="num"><b>${Math.round(inp.pro)}g</b><span>Protein floor</span></div>
    <div class="num"><b>${split.meals}${split.shake ? '+1' : ''}</b><span>Meals a day</span></div>
    <div class="num"><b>${Math.round(split.perMeal.protein)}g</b><span>Protein per meal</span></div>
  </div>
  <p class="note">Protein is a floor, not a ceiling. Hitting it is the single highest-leverage thing you do each day.</p>
  <h2>4. Your first week</h2>
  <ol>
    <li>Shop once, using the shopping list in your system document.</li>
    <li>Eat the meals as written. Any option works on any day.</li>
    <li>Track everything, including the misses. That is how we learn what is actually happening.</li>
    <li>Weigh yourself three mornings, same days each week, and read the trend rather than any one morning.</li>
    <li>Walk. It is the fastest lever you own and it costs you nothing.</li>
  </ol>
  ${labels.length ? `<h2>5. Set up Cronometer once</h2>
  <p>Name your diary groups with the numbers for each meal, so you always know what a meal is supposed to be:</p>
  <ul>${labels.map(l => '<li>' + esc(l) + '</li>').join('')}</ul>
  <p class="note">Then use the "Log it in Cronometer" link on any meal or recipe sheet and it fills itself in.</p>` : ''}
  <h2>Where to ask questions</h2>
  <p>Your dashboard is where you check in each week and rebuild the plan whenever your numbers change: <a href="${DASHBOARD}">${DASHBOARD}</a></p>
  <p class="note">Educational coaching guidance, not medical advice. Individual results vary. Talk to your physician before changing your diet, especially with a medical condition.</p>`;
fs.writeFileSync(path.join(htmlDir, 'onboarding.html'), shell('Start here', guide));

console.log(JSON.stringify({ cards: cards.length, htmlDir }, null, 0));
