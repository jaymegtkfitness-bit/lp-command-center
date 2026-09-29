/* Legacy OS — service worker (app-shell cache for instant repeat opens).
   Strategy:
     • OUR OWN FILES (same-origin GET): stale-while-revalidate — serve from the phone's
       disk instantly, then refresh in the background so the next open is current.
     • THE DATA DOORWAY (Apps Script, cross-origin) + all POSTs: never touched — always
       live network. The app keeps its own localStorage cache for offline data.
   Updating: bump CACHE_VERSION whenever you need to force every device to drop the old
   cached shell (e.g. a big client.html change). It also auto-refreshes in the background
   on every visit, so most changes reach people on their next open without a bump.
   Keep the ?v= values below in sync with the tags in client.html. */
const CACHE_VERSION = 'lp-v2-2026-09-29';
const SHELL  = 'lp-shell-'  + CACHE_VERSION;
const RUNTIME = 'lp-runtime-' + CACHE_VERSION;

/* The handful of files the app needs to boot. Versioned assets update on their own when
   their ?v= changes (a new URL = a fresh fetch + cache entry). */
const SHELL_FILES = [
  './client.html',
  './nutrition-engine.js?v=42',
  './recipe-data.js?v=6',
  './logo-white-gold.png',
  './shield-navmark.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(function(c){ return c.addAll(SHELL_FILES).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== SHELL && k !== RUNTIME; })
        .map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* Only our own GETs. Everything else — the Apps Script doorway (cross-origin), Google
     Fonts, and any POST — goes straight to the network and is never cached. */
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function(cached){
      var network = fetch(req).then(function(res){
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(RUNTIME).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return cached; });   // offline → whatever we have cached
      return cached || network;                  // cache first for speed, else the network
    })
  );
});
