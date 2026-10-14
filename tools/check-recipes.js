#!/usr/bin/env node
/* ============================================================================
   RECIPE SELF-CHECK GUARDRAIL
   Validates the whole recipe library (public recipe-data.js + the gitignored
   recipe-vault.js pool) so a bad or drifted recipe can't silently ship.

   HARD failures (exit 1) break the generator: malformed macros, empty/
   malformed ingredients, bad slot, duplicate id, unknown section, a vault
   recipe missing its safety flags.
   SOFT warnings (exit 0) are accuracy flags: the stated kcal doesn't match
   4·protein+4·carb+9·fat (a macro typo/drift), implausible protein density,
   or a protein that can't be portioned to a normal per-meal target.

   Usage:
     node tools/check-recipes.js            # full report + summary
     node tools/check-recipes.js --quiet    # summary only (used by the kit build)
     node tools/check-recipes.js --hard     # exit 1 only on HARD failures (CI)
   ========================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const DASH = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(DASH, 'recipe-data.js'), 'utf8'), ctx);
let n_public = ctx.RECIPE_LIBRARY.length, n_vault = 0;
const vp = path.join(DASH, 'recipe-vault.js');
if (fs.existsSync(vp)) {
  vm.runInContext(fs.readFileSync(vp, 'utf8'), ctx);
  if (Array.isArray(ctx.window.RECIPE_VAULT)) { n_vault = ctx.window.RECIPE_VAULT.length; ctx.RECIPE_LIBRARY = ctx.RECIPE_LIBRARY.concat(ctx.window.RECIPE_VAULT); }
}
const L = ctx.RECIPE_LIBRARY;

const SECTIONS = new Set(['mf','pp','ed','pw','cg','fr','vg','fx','ps']);
const SLOTS = new Set(['am','pm','snack']);
/* Atwater (4·p + 4·c + 9·f) counts total carbs at 4 kcal/g, but fibre yields ~0–2, so a correct
   high-fibre recipe reads BELOW 4/4/9. So be lenient on negative drift (fibre-explained) and tight
   on positive drift (stated kcal ABOVE 4/4/9 = likely a real macro typo). */
const ATWATER_POS = 0.10;         // stated kcal ABOVE 4/4/9 by >10% -> flag (suspicious)
const ATWATER_NEG = 0.22;         // stated kcal BELOW 4/4/9 by >22% -> flag (beyond what fibre explains)
const DENS_MIN = 1, DENS_MAX = 60; // g protein per 100 kcal (plausibility)
const PRO_MIN = 8, PRO_MAX = 90;   // per-serving protein that can scale to a normal meal target (engine clamp 0.75–3×)

const hard = [], soft = [];
const seenId = new Map();

function num(x){ return typeof x === 'number' && isFinite(x); }

L.forEach((r, idx) => {
  const id = r.id || '(#'+idx+')';
  const H = m => hard.push({id, m});
  const S = m => soft.push({id, m});

  // ---- id ----
  if (!r.id) H('no id');
  else if (seenId.has(r.id)) H('duplicate id (also '+seenId.get(r.id)+')');
  else seenId.set(r.id, idx);

  // ---- macros ----
  const m = r.m;
  if (!Array.isArray(m) || m.length !== 4 || !m.every(num)) { H('bad m (need [kcal,p,c,f] numbers)'); return; }
  const [k, p, c, f] = m;
  if (k <= 0 || p < 0 || c < 0 || f < 0) H('negative/zero macro in m='+JSON.stringify(m));

  // ---- slot / lead / ingredients ----
  if (!SLOTS.has(r.slot)) H('bad slot: '+r.slot);
  if (!r.lead || typeof r.lead !== 'string') H('missing lead protein');
  if (!Array.isArray(r.ing) || !r.ing.length) H('no ingredients');
  else r.ing.forEach((g, gi) => {
    if (!Array.isArray(g) || g.length < 5) H('ing['+gi+'] malformed');
    else if (!SECTIONS.has(g[4])) H('ing['+gi+'] unknown section: '+g[4]);
  });

  // ---- vault safety flags (recipes carrying ax must carry v) ----
  if (r.ax !== undefined && (r.v === undefined || ![0,1,2].includes(r.v))) H('vault recipe missing/!bad v flag');

  // ---- SOFT: macro accuracy / portionability ----
  if (k > 0) {
    const atwater = 4*p + 4*c + 9*f;
    const drift = (k - atwater) / k;   // + = stated kcal ABOVE 4/4/9 (suspicious); − = below (fibre)
    if (drift > ATWATER_POS || drift < -ATWATER_NEG) S('kcal '+k+' vs 4/4/9 '+Math.round(atwater)+' ('+(drift>0?'+':'')+Math.round(drift*100)+'%)');
    const dens = p / k * 100;
    if (dens < DENS_MIN || dens > DENS_MAX) S('implausible protein density '+dens.toFixed(1)+' g/100kcal');
  }
  if (num(p) && (p < PRO_MIN || p > PRO_MAX)) S('protein '+p+'g hard to portion to a meal (want '+PRO_MIN+'–'+PRO_MAX+')');
});

// ---- report ----
if (!QUIET) {
  const show = (title, arr) => {
    console.log('\n'+title+': '+arr.length);
    arr.slice(0, 40).forEach(x => console.log('  '+x.id.padEnd(34)+' '+x.m));
    if (arr.length > 40) console.log('  …and '+(arr.length-40)+' more');
  };
  console.log('Recipes checked: '+L.length+'  ('+n_public+' public + '+n_vault+' vault)');
  show('HARD failures', hard);
  show('SOFT warnings', soft);
}
console.log('\ncheck-recipes: '+L.length+' recipes · '+hard.length+' hard · '+soft.length+' soft');

const failHardOnly = process.argv.includes('--hard');
process.exit((hard.length || (!failHardOnly && false)) ? (hard.length ? 1 : 0) : 0);
