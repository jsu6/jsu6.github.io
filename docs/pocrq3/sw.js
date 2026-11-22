self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname === '/sw-echo') e.respondWith(new Response(String(e.clientId)));
  if (new URL(e.request.url).pathname === '/sw-trusted') e.respondWith(Response.json({isTrusted: e.isTrusted}));
  if (new URL(e.request.url).pathname === '/sw-d1-cookie-event') e.respondWith((() => { const ev = new ExtendableCookieChangeEvent('cookiechange', {changed: [{name: 'a', value: '1'}], deleted: [{name: 'b'}]}); return Response.json({type: ev.type, changed: ev.changed, deleted: ev.deleted}); })());
});
self.addEventListener('message', (e) => { if (e.data && e.data.e1 === 'origin' && e.ports[0]) e.ports[0].postMessage({origin: e.origin, isTrusted: e.isTrusted}); });
