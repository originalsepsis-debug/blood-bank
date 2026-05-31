const CACHE='blood-bank-v7-4-2-static';
const ASSETS=['/static/style.css','/static/app.js','/static/icon-192.png','/static/icon-512.png','/manifest.json','/offline'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{ const u=new URL(e.request.url); if(e.request.mode==='navigate') return; if(u.pathname.startsWith('/static/') || u.pathname==='/manifest.json' || u.pathname==='/offline') e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))); });
