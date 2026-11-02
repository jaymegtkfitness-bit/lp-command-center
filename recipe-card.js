/* LP RECIPE CARD — ONE TEMPLATE, TWO CALLERS (Jayme 2026-11-02)

   The printable Legacy-dark recipe sheet. It used to live only inside tools/make-client-kit.js,
   which meant the card a client downloads from the app and the card in her Drive folder were two
   separate copies of the same design waiting to drift apart. This is the single source.

   Node:    const CARD = require('./recipe-card.js')
   Browser: <script src="recipe-card.js"></script>  ->  window.LP_RECIPE_CARD

   html(opt, o) wants:
     opt    a deck option or companion: {name, items[], parts[], cal, protein, carbs, fat,
            nocook, recipe:{id, how}}
     o      {slot, idx, first, shield, mealLink, shopInfo, forScreen}
            shield     = base64 PNG for the header mark; omitted = no mark
            footerName = name in the footer; defaults to first
            mealLink = the engine's mealLink(opt); omitted = no Cronometer line
            forScreen= true drops the fixed letter width so it reads on a phone
*/
(function(root, factory){
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LP_RECIPE_CARD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function cap(s){ return String(s||'').charAt(0).toUpperCase() + String(s||'').slice(1); }
  function slug(s){
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
  }

  /* A library recipe carries its own method. A built meal has none, so the steps are assembled
     from how each of its foods is cooked (SHOP_INFO), which is the only honest thing to print. */
  function steps(opt, shopInfo){
    if (opt.recipe && opt.recipe.how){
      /* Split on sentence ends. The lookbehind is avoided for older Safari. */
      return String(opt.recipe.how).split(/\.\s+/).filter(Boolean)
        .map(function(s, i, a){ return i < a.length-1 && !/[.!?]$/.test(s) ? s + '.' : s; });
    }
    var COOK = shopInfo || {}, out = [], seen = {};
    (opt.parts || []).forEach(function(pt){
      var info = COOK[pt.n];
      if (info && info.cook && !seen[info.cook]){ seen[info.cook] = 1; out.push(cap(pt.n) + ': ' + info.cook); }
    });
    var veg = (opt.parts || []).filter(function(p){ return p.veg; }).map(function(p){ return p.n; });
    if (veg.length) out.push('Vegetables (' + veg.join(', ') + '): raw, steamed, or roasted at 425°F for 15 to 20 minutes.');
    out.push('Plate it together and weigh anything you are unsure of.');
    return out;
  }

  var CSS_PRINT = '@page{size:letter portrait;margin:0}\n'
    + 'body{width:8.5in;min-height:11in;padding:0.62in 0.7in}\n';
  var CSS_SCREEN = 'body{width:100%;max-width:8.5in;min-height:100vh;padding:28px 22px}\n'
    + '@media print{@page{size:letter portrait;margin:0} body{width:8.5in;padding:0.62in 0.7in}}\n';

  function css(forScreen){
    return '*{margin:0;padding:0;box-sizing:border-box}\n'
    + (forScreen ? CSS_SCREEN : CSS_PRINT)
    + 'body{background:#161616;color:#d9d3c8;font-family:Montserrat,-apple-system,Segoe UI,sans-serif;'
    + 'position:relative;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n'
    + 'body:before{content:"";position:absolute;inset:0;z-index:0;'
    + 'background:radial-gradient(760px 620px at -8% 114%, rgba(74,92,62,.55), rgba(74,92,62,0) 68%),'
    + 'radial-gradient(620px 480px at 108% -10%, rgba(193,173,114,.16), rgba(193,173,114,0) 64%)}\n'
    + '.page{position:relative;z-index:1}\n'
    + '.top{display:flex;align-items:center;gap:12px;margin-bottom:22px}\n'
    + '.top img{height:38px;width:auto}\n'
    + '.top .brand{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:#8FA97A;font-weight:700}\n'
    + '.label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8FA97A;font-weight:700;margin-bottom:8px}\n'
    + 'h1{font-size:30px;line-height:1.06;font-weight:900;color:#F2EDE4;letter-spacing:-.01em;margin-bottom:6px}\n'
    + 'h1 .g{color:#C1AD72}\n'
    + 'h2{font-size:14px;font-weight:800;color:#F2EDE4;margin:20px 0 8px;letter-spacing:.01em}\n'
    + 'p{font-size:12.5px;line-height:1.55;margin-bottom:9px;max-width:66ch}\n'
    + '.lede{font-size:13.5px;color:#d9d3c8;margin-bottom:16px}\n'
    + '.nums{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}\n'
    + '.num{border:1px solid rgba(143,169,122,.28);border-radius:10px;padding:8px 13px;background:rgba(74,92,62,.14);min-width:96px}\n'
    + '.num b{display:block;font-size:19px;color:#C1AD72;font-family:Cinzel,Georgia,serif;line-height:1.1}\n'
    + '.num span{font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:#bdb7ac}\n'
    + '.tile{border:1px solid rgba(143,169,122,.22);border-radius:12px;padding:13px 15px;background:rgba(74,92,62,.12);margin-bottom:10px}\n'
    + '.tile b{color:#F2EDE4;font-size:12.5px;display:block;margin-bottom:3px}\n'
    + '.tile p{font-size:11.5px;margin:0;color:#d9d3c8}\n'
    + 'ul,ol{margin:0 0 10px 17px}\n'
    + 'li{font-size:12.5px;line-height:1.6;margin-bottom:4px}\n'
    + '.ing li{list-style:none;margin-left:-17px;padding-left:20px;position:relative;border-bottom:1px solid rgba(143,169,122,.12);padding-bottom:5px;margin-bottom:5px}\n'
    + '.ing li:before{content:"";position:absolute;left:0;top:5px;width:10px;height:10px;border:1.5px solid rgba(193,173,114,.6);border-radius:3px}\n'
    + '.ing li b{color:#F2EDE4}\n'
    + '.side{color:#8FA97A;font-size:11px;letter-spacing:.04em}\n'
    + '.foot{' + (forScreen ? 'margin-top:26px;display:flex;justify-content:space-between;' : 'position:absolute;left:.7in;right:.7in;bottom:.45in;display:flex;justify-content:space-between;')
    + 'font-size:9.5px;color:#8f8a80;border-top:1px solid rgba(143,169,122,.18);padding-top:9px;z-index:1}\n'
    + 'a{color:#C1AD72;text-decoration:none}\n'
    + '.note{font-size:11px;color:#bdb7ac;margin-top:10px}\n'
    + '.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n';
  }

  /* Just the inner body, for callers that supply their own shell. */
  function body(opt, o){
    o = o || {};
    var sideRx = /^on the side:\s*/i;
    var ing = (opt.items || []).map(function(x){
      return sideRx.test(x)
        ? '<li><b>' + esc(x.replace(sideRx,'')) + '</b> <span class="side">on the side</span></li>'
        : '<li><b>' + esc(x) + '</b></li>';
    }).join('');
    var title = opt.name || ((o.slot || 'Meal') + (o.idx ? ' option ' + o.idx : ''));
    var who = o.first ? 'Portioned for ' + esc(o.first) + '. ' : '';
    return '\n  <span class="label">' + esc(o.slot || 'Meal')
      + (o.idx ? ' &middot; option ' + o.idx : '') + (opt.nocook ? ' &middot; no cooking' : '') + '</span>\n'
      + '  <h1>' + esc(title) + '</h1>\n'
      + '  <p class="lede">' + who + 'Every option in this meal hits the same numbers, so this one can be eaten on any day.</p>\n'
      + '  <div class="nums">\n'
      + '    <div class="num"><b>' + Math.round(opt.cal || 0) + '</b><span>Calories</span></div>\n'
      + '    <div class="num"><b>' + Math.round(opt.protein || 0) + 'g</b><span>Protein</span></div>\n'
      + '    <div class="num"><b>' + Math.round(opt.carbs || 0) + 'g</b><span>Carbs</span></div>\n'
      + '    <div class="num"><b>' + Math.round(opt.fat || 0) + 'g</b><span>Fat</span></div>\n'
      + '  </div>\n'
      + '  <h2>What goes in it</h2>\n'
      + '  <ul class="ing">' + ing + '</ul>\n'
      + '  <h2>How to make it</h2>\n'
      + '  <ol>' + steps(opt, o.shopInfo).map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>\n'
      + '  <div class="tile"><b>Weigh it, at least at first</b><p>The numbers on this sheet are only true at these portions. Weigh the protein and the carb until you can call them by eye, and keep the vegetables generous.</p></div>\n'
      + (o.mealLink ? '  <p class="note">Track it in one tap: <a href="' + esc(o.mealLink) + '">Log this meal in Cronometer</a></p>' : '');
  }

  /* The whole standalone file. */
  function html(opt, o){
    o = o || {};
    var title = opt.name || (o.slot || 'Recipe');
    return '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>' + esc(title) + '</title>\n'
      + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
      + '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">\n'
      + '<style>' + css(!!o.forScreen) + '</style></head><body><div class="page">\n'
      + '<div class="top">' + (o.shield ? '<img src="data:image/png;base64,' + o.shield + '" alt="">' : '')
      + '<span class="brand">Legacy Performance</span></div>\n'
      + body(opt, o) + '</div>\n'
      + '<div class="foot"><span>Legacy Performance' + ((o.footerName || o.first) ? ' &middot; ' + esc(o.footerName || o.first) : '')
      + '</span><span>legacyperformance.co</span></div>\n'
      + '</body></html>';
  }

  return {html:html, body:body, steps:steps, css:css, esc:esc, slug:slug, cap:cap};
});
