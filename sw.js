// Service worker Appetora: pornire rapidă și ultimele date disponibile fără internet
// (de exemplu lista de cumpărături în magazin, cu semnal slab).
// Scrierile (POST/PUT/DELETE) merg mereu direct la server.
const VERSION = 'v1';
const SHELL = 'appetora-shell-' + VERSION;
const DATA = 'appetora-data';          // răspunsuri API ale userului; se șterge la ieșirea din cont
const FONTS = 'appetora-fonts';

const SHELL_FILES = [
  '/', '/index.html', '/manifest.json',
  '/images/logo-appetora.png', '/images/logo-appetora_2.PNG',
  '/images/icons/icon-192.png', '/images/icons/apple-touch-icon.png'
];
// doar citirile de care are nevoie interfața ca să pornească
const API_CACHED = ['/api/auth/me', '/api/recipes', '/api/settings', '/api/plan-latest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('appetora-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// întâi rețeaua, apoi copia salvată
async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // fonturile Google: o dată descărcate, rămân
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;   // pozele din Azure Blob (SAS) nu se salvează

  if (url.pathname.startsWith('/api/')) {
    if (API_CACHED.includes(url.pathname)) e.respondWith(networkFirst(req, DATA));
    return;
  }

  // paginile: mereu versiunea nouă când e internet, altfel cea salvată
  if (req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    e.respondWith(networkFirst(req, SHELL, '/index.html'));
    return;
  }
  if (req.mode === 'navigate') return;          // admin.html, legacy.html: direct de pe server

  // restul fișierelor statice: din copie, actualizate în fundal
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req);
    const fresh = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  }));
});

self.addEventListener('message', e => {
  if (e.data === 'logout') e.waitUntil(caches.delete(DATA));
});
