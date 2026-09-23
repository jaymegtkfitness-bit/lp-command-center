/* Legacy Performance Free Tools pack: shared page helpers.
   Loaded AFTER ../../nutrition-engine.js on every tool page. No nutrition math lives here: every number
   on a tool page comes from the engine. This file only reads inputs, formats, remembers a viewer's
   numbers between tools (their own browser only), prefills from the URL, and tracks events. */

/* ===== CONFIG ===== */
var CONFIG={
  metaPixelId:"",                                   // paste the Meta Pixel ID to turn on pixel events; blank = off
  siteBase:"https://dashboard.legacyperformance.co",
  scoreUrl:"../../score/",                          // the Legacy Score (primary bridge CTA)
  phaseUrl:"../../find-your-phase/",                // Find Your Phase (secondary bridge CTA)
  rememberInputs:true,                              // share sex/height/weight/goal across tools in this browser
  debug:false
};

/* ===== TRACKING ===== */
(function initPixel(){
  if(!CONFIG.metaPixelId || typeof window==='undefined' || window.fbq) return;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
  s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', CONFIG.metaPixelId);
  window.fbq('track', 'PageView');
})();
function track(name, params){
  params=params||{};
  params.tool=params.tool||document.body.getAttribute('data-tool')||'hub';
  try{
    if(CONFIG.metaPixelId && window.fbq) window.fbq('trackCustom', name, params);
    window.dataLayer=window.dataLayer||[]; window.dataLayer.push(Object.assign({event:name}, params));
    if(CONFIG.debug) console.log('[track]', name, params);
  }catch(e){}
}

/* ===== INPUT HELPERS ===== */
var LPT={
  $:function(id){ return document.getElementById(id); },
  num:function(id){ var el=document.getElementById(id); if(!el) return NaN; var v=parseFloat(String(el.value).replace(/,/g,'')); return isFinite(v)?v:NaN; },
  heightIn:function(ftId, inId){ var ft=LPT.num(ftId), inch=LPT.num(inId); if(!(ft>0)) return NaN; return ft*12+(inch>0?inch:0); },
  seg:function(name){ var b=document.querySelector('.seg[data-name="'+name+'"] button[aria-pressed="true"]'); return b?b.getAttribute('data-v'):''; },
  setSeg:function(name, v){
    var g=document.querySelector('.seg[data-name="'+name+'"]'); if(!g) return false;
    var hit=g.querySelector('button[data-v="'+v+'"]'); if(!hit) return false;
    g.querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed', b===hit?'true':'false'); });
    return true;
  },
  fmt:function(n){ return (Math.round(+n)).toLocaleString('en-US'); },
  dateIn:function(weeks){
    var d=new Date(); d.setDate(d.getDate()+Math.round(weeks*7));
    return d.toLocaleDateString('en-US',{month:'long', day:'numeric', year:'numeric'});
  },
  esc:function(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); },

  /* Shared profile: a viewer's own numbers, kept in THEIR browser so the next tool is prefilled.
     Wrapped in try/catch: private windows and blocked storage just skip it. */
  PROFILE_KEY:'lp_tools_profile',
  PROFILE_FIELDS:{sex:'seg', age:'age', ft:'ft', inch:'in', weight:'weight', goal:'goal'},
  loadProfile:function(){ try{ return JSON.parse(localStorage.getItem(LPT.PROFILE_KEY)||'{}')||{}; }catch(e){ return {}; } },
  saveProfile:function(){
    if(!CONFIG.rememberInputs) return;
    try{
      var p=LPT.loadProfile(), sx=LPT.seg('sex');
      if(sx) p.sex=sx;
      ['age','ft','in','weight','goal'].forEach(function(id){ var el=document.getElementById(id); if(el && el.value!=='') p[id]=el.value; });
      localStorage.setItem(LPT.PROFILE_KEY, JSON.stringify(p));
    }catch(e){}
  },
  /* URL params win over the saved profile (so one tool can hand numbers to the next). */
  prefill:function(){
    var p=CONFIG.rememberInputs?LPT.loadProfile():{};
    try{ new URLSearchParams(location.search).forEach(function(v,k){ p[k]=v; }); }catch(e){}
    if(p.sex) LPT.setSeg('sex', p.sex);
    ['age','ft','in','weight','goal'].forEach(function(id){
      var el=document.getElementById(id); if(el && p[id]!=null && p[id]!=='' && el.value==='') el.value=p[id];
    });
  },

  /* Wire a calculator: segmented buttons, live recalculation on every input, first-result tracking. */
  bind:function(render){
    var fired=false;
    document.querySelectorAll('.seg').forEach(function(g){
      g.setAttribute('role','group');
      g.querySelectorAll('button').forEach(function(b){
        b.type='button';
        if(!b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed','false');
        b.addEventListener('click', function(){
          g.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-pressed', x===b?'true':'false'); });
          run();
        });
      });
    });
    function run(){
      var ok=false;
      try{ ok=render(); }catch(e){ console.error(e); }
      if(ok){ LPT.saveProfile(); if(!fired){ fired=true; track('tool_result'); } }
    }
    document.querySelectorAll('.calc input, .calc select').forEach(function(el){
      el.addEventListener('input', run); el.addEventListener('change', run);
    });
    LPT.prefill();
    run();
    return run;
  }
};

/* ===== LINKS + CTA TRACKING ===== */
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('[data-href="score"]').forEach(function(a){ a.href=CONFIG.scoreUrl; });
  document.querySelectorAll('[data-href="phase"]').forEach(function(a){ a.href=CONFIG.phaseUrl; });
  document.querySelectorAll('[data-track]').forEach(function(a){
    a.addEventListener('click', function(){ track('cta_click', {cta:a.getAttribute('data-track')}); });
  });
  var y=document.getElementById('yr'); if(y) y.textContent=new Date().getFullYear();
});
