/* LP AUTH · sign-in for the dashboard + Meal Builder (Nov 25, 2026)
   Supabase Auth, no Google sign-in, works inside Everfit's in-app browser.
     First time / forgot PIN:  email -> 6-digit code by email -> set a 6-digit PIN
     Every time after:         email + PIN
   Access is decided in the DATABASE (RLS + has_feature), never in this file: hiding a screen here is
   only convenience. The licensed recipes cannot be read by anyone the database does not entitle.

   Usage:
     LPAuth.start({ feature:'meal_builder', title:'Meal Builder', onReady:function(sb, access){...} });
   The publishable key below is meant to be public. The secret key never touches a page. */
(function(){
  var SB_URL = 'https://gtvzoxfudbxchreuydfq.supabase.co';
  var SB_KEY = 'sb_publishable_V75x0U54pSVjhzjBHORnxw_jHAvCMMQ';
  var LOCK_KEY = 'lp_auth_lock_v1', MAX_TRIES = 5, LOCK_MIN = 15;
  /* Codes are emailed by GoHighLevel, not Supabase (see platform/src/app/api/auth/send-code). */
  var SEND_CODE_URL = 'https://legacy-performance-rho.vercel.app/api/auth/send-code';

  var css = '\
.lpa-bg{position:fixed;inset:0;z-index:100;background:#F6F8F5;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 16px;font-family:Montserrat,system-ui,sans-serif;color:#1C1C1C}\
.lpa{width:100%;max-width:400px;background:#fff;border:1px solid #E4E8E1;border-radius:20px;padding:28px 22px}\
.lpa img{height:30px;display:block;margin:0 auto 18px}\
.lpa h1{font-size:22px;font-weight:900;margin:0 0 6px;text-align:center}\
.lpa p{font-size:14px;color:#7a7e76;margin:0 0 18px;text-align:center;line-height:1.5}\
.lpa label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#7a7e76;margin:12px 0 6px}\
.lpa input{width:100%;box-sizing:border-box;border:1px solid #E4E8E1;background:#fbfcfa;border-radius:12px;padding:13px 14px;font:700 16px Montserrat,system-ui,sans-serif;min-height:48px}\
.lpa input.code{letter-spacing:.4em;text-align:center;font-size:22px}\
.lpa input:focus{outline:2px solid #EEF2EA;border-color:#4A5C3E}\
.lpa .go{width:100%;margin-top:18px;border:0;border-radius:12px;padding:14px;background:#4A5C3E;color:#fff;font:800 15px Montserrat,system-ui,sans-serif;cursor:pointer}\
.lpa .go[disabled]{opacity:.6}\
.lpa .lnk{display:block;width:100%;margin-top:12px;border:0;background:none;color:#4A5C3E;font:700 13.5px Montserrat,system-ui,sans-serif;cursor:pointer;text-align:center}\
.lpa .err{background:#F3E4E0;color:#9A4A3A;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;margin-top:12px;display:none}\
.lpa .ok{background:#EEF2EA;color:#4A5C3E;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;margin-top:12px}\
.lpa .fine{font-size:12px;color:#7a7e76;text-align:center;margin-top:16px}';

  function el(html){ var d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }
  function lockedUntil(){ try{ var o=JSON.parse(localStorage.getItem(LOCK_KEY)||'{}'); return o.until||0; }catch(e){ return 0; } }
  function failTry(){ try{ var o=JSON.parse(localStorage.getItem(LOCK_KEY)||'{}'); o.n=(o.n||0)+1; if(o.n>=MAX_TRIES){ o.until=Date.now()+LOCK_MIN*60000; o.n=0; } localStorage.setItem(LOCK_KEY,JSON.stringify(o)); }catch(e){} }
  function clearTries(){ try{ localStorage.removeItem(LOCK_KEY); }catch(e){} }
  function sixDigits(v){ return /^\d{6}$/.test(String(v||'').trim()); }
  function codeDigits(v){ return /^\d{6,8}$/.test(String(v||'').trim()); }

  var LPAuth = {
    sb: null,
    start: function(opts){
      opts = opts || {};
      if(!window.supabase || !window.supabase.createClient){ console.error('supabase-js not loaded'); return; }
      var sb = this.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth:{ persistSession:true, autoRefreshToken:true, storageKey:'lp-auth' } });
      var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      var root = el('<div class="lpa-bg" id="lpaBg"><div class="lpa" id="lpa"></div></div>');
      var title = opts.title || 'your dashboard';
      var logo = opts.logo || '../logo.png';

      function show(){ if(root.parentNode!==document.body) document.body.appendChild(root); }
      function hide(){ if(root.parentNode===document.body) document.body.removeChild(root); }
      function card(html){ show(); document.getElementById('lpa').innerHTML = '<img src="'+logo+'" alt="Legacy Performance">'+html; }
      function err(msg){ var e=document.querySelector('#lpa .err'); if(e){ e.textContent=msg; e.style.display=msg?'block':'none'; } }
      function busy(b, on, label){ if(!b) return; b.disabled=on; if(label) b.textContent=label; }

      /* ---- screen: email + PIN (returning) ---- */
      function signInScreen(email){
        card('<h1>Sign in</h1><p>Open '+title+' with your email and PIN.</p>'
          +'<label>Email</label><input id="lpaEmail" type="email" autocomplete="email" inputmode="email" value="'+(email||'')+'">'
          +'<label>PIN</label><input id="lpaPin" class="code" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••••">'
          +'<button class="go" id="lpaGo">Sign in</button><div class="err"></div>'
          +'<button class="lnk" id="lpaFirst">First time here, or forgot your PIN? Get a code by email</button>');
        var go=document.getElementById('lpaGo');
        document.getElementById('lpaPin').addEventListener('keydown',function(e){ if(e.key==='Enter') go.click(); });
        go.onclick=function(){
          var em=document.getElementById('lpaEmail').value.trim(), pin=document.getElementById('lpaPin').value.trim();
          var lu=lockedUntil(); if(lu>Date.now()){ err('Too many tries. Try again in '+Math.ceil((lu-Date.now())/60000)+' minutes, or get a code by email.'); return; }
          if(!em){ err('Enter your email.'); return; } if(!sixDigits(pin)){ err('Your PIN is 6 numbers.'); return; }
          busy(go,true,'Signing in…');
          sb.auth.signInWithPassword({ email:em, password:pin }).then(function(r){
            if(r.error){ failTry(); busy(go,false,'Sign in'); err('That email and PIN don’t match. Check them, or get a code by email.'); return; }
            clearTries(); afterSignIn();
          });
        };
        document.getElementById('lpaFirst').onclick=function(){ codeRequestScreen(document.getElementById('lpaEmail').value.trim()); };
      }

      /* ---- screen: get a code ---- */
      function codeRequestScreen(email){
        card('<h1>Get your code</h1><p>We’ll email you a code. Use the email you bought with.</p>'
          +'<label>Email</label><input id="lpaEmail" type="email" autocomplete="email" inputmode="email" value="'+(email||'')+'">'
          +'<button class="go" id="lpaGo">Email me a code</button><div class="err"></div>'
          +'<button class="lnk" id="lpaBack">I have a PIN. Sign in</button>');
        var go=document.getElementById('lpaGo');
        go.onclick=function(){
          var em=document.getElementById('lpaEmail').value.trim(); if(!em){ err('Enter your email.'); return; }
          busy(go,true,'Sending…');
          fetch(SEND_CODE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})})
            .then(function(r){ return r.json().catch(function(){return {}}).then(function(j){ return {status:r.status, j:j}; }); })
            .then(function(x){
              if(x.status===429){ busy(go,false,'Email me a code'); err('Too many codes asked for. Wait 15 minutes, then try again.'); return; }
              if(x.status>=400){ busy(go,false,'Email me a code'); err('Something went wrong sending your code. Try again in a minute.'); return; }
              codeEnterScreen(em);
            })
            .catch(function(){ busy(go,false,'Email me a code'); err('Can\u2019t reach the server. Check your connection and try again.'); });
        };
        document.getElementById('lpaBack').onclick=function(){ signInScreen(document.getElementById('lpaEmail').value.trim()); };
      }

      /* ---- screen: enter the code ---- */
      function codeEnterScreen(email){
        card('<h1>Check your email</h1><p>If <b>'+email.replace(/</g,'&lt;')+'</b> has a Legacy Performance plan, a code is on its way from Legacy Performance. It can take a minute. Check spam too.</p>'
          +'<label>Code</label><input id="lpaCode" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="code">'
          +'<button class="go" id="lpaGo">Continue</button><div class="err"></div>'
          +'<button class="lnk" id="lpaAgain">Send a new code</button>');
        var go=document.getElementById('lpaGo');
        document.getElementById('lpaCode').addEventListener('keydown',function(e){ if(e.key==='Enter') go.click(); });
        go.onclick=function(){
          var code=document.getElementById('lpaCode').value.trim(); if(!codeDigits(code)){ err('Enter the code from your email.'); return; }
          busy(go,true,'Checking…');
          sb.auth.verifyOtp({ email:email, token:code, type:'email' }).then(function(r){
            return r.error ? sb.auth.verifyOtp({ email:email, token:code, type:'magiclink' }) : r;
          }).then(function(r){
            if(r.error){ busy(go,false,'Continue'); err('That code didn’t work. It may have expired. Send a new one.'); return; }
            clearTries(); pinSetScreen();
          });
        };
        document.getElementById('lpaAgain').onclick=function(){ codeRequestScreen(email); };
      }

      /* ---- screen: set your PIN ---- */
      function pinSetScreen(){
        card('<h1>Set your PIN</h1><p>6 numbers. You’ll use it with your email every time you sign in.</p>'
          +'<label>PIN</label><input id="lpaP1" class="code" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" placeholder="••••••">'
          +'<label>Type it again</label><input id="lpaP2" class="code" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" placeholder="••••••">'
          +'<button class="go" id="lpaGo">Save my PIN</button><div class="err"></div>');
        var go=document.getElementById('lpaGo');
        go.onclick=function(){
          var a=document.getElementById('lpaP1').value.trim(), b=document.getElementById('lpaP2').value.trim();
          if(!sixDigits(a)){ err('Your PIN is 6 numbers.'); return; }
          if(/^(\d)\1{5}$/.test(a) || a==='123456' || a==='654321'){ err('Pick something harder to guess.'); return; }
          if(a!==b){ err('Those don’t match.'); return; }
          busy(go,true,'Saving…');
          sb.auth.updateUser({ password:a, data:{ pin_set:true } }).then(function(r){
            if(r.error){ busy(go,false,'Save my PIN'); err(r.error.message); return; }
            afterSignIn();
          });
        };
      }

      /* ---- screens: no purchase found / not included ---- */
      function noClientScreen(email){
        card('<h1>We can’t find your purchase</h1><p>You’re signed in as <b>'+(email||'').replace(/</g,'&lt;')+'</b>, but there’s no plan on that email yet. If you just bought, give it a few minutes. If you used a different email, sign out and use that one.</p>'
          +'<button class="go" id="lpaOut">Sign out</button><div class="fine">Still stuck? Message us in the app.</div>');
        document.getElementById('lpaOut').onclick=function(){ sb.auth.signOut().then(function(){ signInScreen(''); }); };
      }
      function lockedScreen(access){
        card('<h1>'+(opts.lockedTitle||'Not part of your plan yet')+'</h1><p>'+(opts.lockedText||'This comes with the Legacy Nutrition System.')+'</p>'
          +(opts.lockedUrl?'<a class="go" style="display:block;text-align:center;text-decoration:none" href="'+opts.lockedUrl+'">'+(opts.lockedCta||'See the Legacy Nutrition System')+'</a>':'')
          +'<button class="lnk" id="lpaOut">Sign out</button>');
        document.getElementById('lpaOut').onclick=function(){ sb.auth.signOut().then(function(){ signInScreen(''); }); };
      }

      /* ---- after any sign-in: link the client, read access ---- */
      function afterSignIn(){
        card('<h1>One moment</h1><p>Loading your account…</p>');
        sb.rpc('claim_client').then(function(){ return sb.rpc('my_access'); }).then(function(r){
          var access=(r&&r.data)||{};
          return sb.auth.getUser().then(function(u){
            var user=u.data&&u.data.user;
            if(user && !(user.user_metadata||{}).pin_set){ pinSetScreen(); return; }
            if(!access.client){ noClientScreen(user&&user.email); return; }
            if(opts.feature && (access.features||[]).indexOf(opts.feature)<0){ lockedScreen(access); return; }
            hide();
            if(opts.onReady) opts.onReady(sb, access, user);
          });
        });
      }

      LPAuth.signOut=function(){ return sb.auth.signOut().then(function(){ location.reload(); }); };
      sb.auth.getSession().then(function(r){ if(r.data && r.data.session) afterSignIn(); else signInScreen(''); });
    }
  };
  /* A member's daily numbers. Jayme sets them per client as plan.targets
     {calories, protein, produce?, water?, meals?, frequency?} on their latest nutrition plan.
     No guessing from meal lists: if targets aren't set, this returns null and pages say so. */
  LPAuth.targets = function(plan){
    var t=(plan&&(plan.targets||plan))||{}, c=+t.calories||+t.cal||0, p=+t.protein||+t.pro||0;
    if(!(c>0&&p>0)) return null;
    var f=String(t.frequency||(plan&&plan.frequency)||''), m=+t.meals||parseInt(f,10)||4;
    return {cal:Math.round(c), pro:Math.round(p), meals:m, shake:/shake/i.test(f), produce:+t.produce||0, water:+t.water||0, names:Array.isArray(t.mealNames)?t.mealNames:null};
  };
  window.LPAuth = LPAuth;
})();
