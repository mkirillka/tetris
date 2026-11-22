/*
 * Офлайн-кеш игры.
 *
 * Стратегия: при установке кладём все файлы игры в кеш, дальше отдаём их
 * «сначала из кеша, потом из сети» и тихо обновляем кеш в фоне. Игра статичная,
 * поэтому такой режим даёт мгновенный запуск и работу без сети.
 *
 * При изменении файлов меняйте VERSION — старый кеш удалится при активации.
 */
const VERSION = 'v1.2.0';
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // служебные страницы (тесты, замеры) в кеш не кладём — они нужны только разработке
  if (url.pathname.includes('/tools/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);          // нет сети — отдаём что есть

      return cached || network;
    }),
  );
});
