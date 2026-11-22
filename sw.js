/* =========================================================
   单词守卫队 · sw.js
   仅接管同源 GET 请求；不拦截非 GET、跨域请求或任何数据同步。
   全部路径均相对 sw.js 所在目录，可直接部署到
   GitHub Pages 项目子路径（如 /english-word-defense/）。
   ========================================================= */

const CACHE_PREFIX = 'word-defense-';
const CACHE_VERSION = 'v5';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

// 相对路径以 sw.js 的 URL 为基准解析，因此子路径部署同样有效。
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './data.js',
  './vocabulary.js',
  './game.js',
  './progress-sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const OFFLINE_FALLBACK = './index.html';

function offlineResponse() {
  return new Response('离线状态，且本地缓存尚未就绪。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // cache: 'reload' 绕过 HTTP 缓存，避免把旧文件写入新版本缓存。
      await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 非 GET 与跨域请求完全交给浏览器，不 respondWith。
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});

/**
 * 页面导航：优先网络，失败时回退到同路径缓存或缓存的 index.html。
 */
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      try {
        await cache.put(request, response.clone());
      } catch {
        // 缓存写入失败不应影响正常联网访问。
      }
    }
    if (response && response.ok) return response;
  } catch {
    // 离线或网络错误：继续走缓存回退。
  }

  const cached =
    (await cache.match(request, { ignoreSearch: true })) ||
    (await cache.match(OFFLINE_FALLBACK));

  return cached || offlineResponse();
}

/**
 * 静态资源：缓存优先，未命中时取网络并写入当前版本缓存。
 */
async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      try {
        await cache.put(request, response.clone());
      } catch {
        // 缓存写入失败时仍然返回网络响应。
      }
    }
    return response;
  } catch {
    return offlineResponse();
  }
}
