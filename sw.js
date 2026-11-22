/*
 * Офлайн-кеш игры.
 *
 * Две стратегии:
 *   • сама страница (навигация) — сначала сеть, при отсутствии сети кеш.
 *     Так вышедшее обновление видно сразу, а не со второго открытия;
 *   • файлы игры — сначала кеш, параллельно тихое обновление из сети.
 *     Они меняются только вместе с версией страницы, зато открываются мгновенно.
 *
 * При изменении файлов поднимайте VERSION — старый кеш удалится при активации.
 */
const VERSION = 'v1.2.1';
const CACHE = `tetris-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/game.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/icon-180.png',
  './assets/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (!response || !response.ok) return;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(request, copy));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // служебные страницы (тесты, замеры) в кеш не кладём — они нужны только разработке
  if (url.pathname.includes('/tools/')) return;

  // Страница: сеть в приоритете, чтобы обновления приходили сразу
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          store(request, response);
          return response;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match('./index.html'))),
    );
    return;
  }

  // Остальные файлы: кеш сразу, сеть — для обновления копии
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          store(request, response);
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
