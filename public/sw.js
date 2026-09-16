// Service worker de Leal Bets: solo cachea el "cascarón" de la app (HTML/CSS/JS
// e íconos) para que abra rápido e instalada como app. Los datos reales
// (apuestas, saldo, estado del mercado) NUNCA se sirven desde acá — la API y
// el socket siempre van directo a la red, así nadie ve fichas/resultados
// desactualizados por culpa de un caché viejo.
// ¡IMPORTANTE! subir este número cada vez que cambie index.html/style.css/
// app.js: si no, la primera vez que alguien abre la app instalada después de
// un cambio sigue viendo la versión vieja (el caché solo se termina de
// actualizar recién en la visita SIGUIENTE) — al cambiar el nombre acá, en
// cambio, se vacía el caché viejo entero y esa misma visita ya trae todo
// fresco de la red.
const CACHE_NAME = 'leal-bets-v3';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/favicon.svg',
  '/img/icons/icon-192.png',
  '/img/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // nunca cachear apuestas/cambios (POST/PUT/DELETE)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fuentes de Google, etc.: sin tocar
  // la API y el socket en tiempo real van siempre a la red, nunca a caché
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // stale-while-revalidate: responde rápido con lo cacheado si existe, y en
  // paralelo pide la versión nueva a la red para la próxima vez.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
