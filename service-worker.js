// service-worker.js — Controlled Drugs PWA v5 (robust for GitHub Pages)
// آخر تحديث: 2025-09-04

// غيّر الاسم عند كل تعديل لضمان تحديث الكاش
const CACHE_NAME = 'cd-v5-2025-09-04';

// أضف هنا فقط الأصول المحلية داخل نفس المستودع (لا تضف روابط CDN)
const STATIC_ASSETS = [
  '',                 // = ./ (index)
  'index.html',
  'styles.css',
  'app.js',
  'config.js',
  'logo.jpg',
  'manifest.webmanifest',
  'favicon.ico'
];

// نحول كل أصل لمسار مطلق داخل نطاق الصفحة (مهم مع GitHub Pages)
// مثال: https://{user}.github.io/controlled-drugs-pwa-v5/index.html
let SCOPED_URLS = null;
let SCOPED_SET  = null;
function computeScopedUrls() {
  if (SCOPED_URLS) return SCOPED_URLS;
  const base = self.registration.scope; // ينتهي بـ '/'
  SCOPED_URLS = STATIC_ASSETS.map(p => new URL(p, base).toString());
  SCOPED_SET  = new Set(SCOPED_URLS);
  return SCOPED_URLS;
}
function isStatic(urlHref) {
  if (!SCOPED_SET) computeScopedUrls();
  return SCOPED_SET.has(urlHref);
}

/* ========== install ========== */
// نخزن كل أصل على حدة مع Promise.allSettled لتفادي فشل addAll بسبب ملف واحد
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = computeScopedUrls();
    await Promise.allSettled(urls.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(u, res.clone());
      } catch (e) {
        // نتجاهل الإخفاق الفردي؛ لا نرمي خطأ كي لا يفشل التثبيت بالكامل
      }
    }));
  })());
  self.skipWaiting();
});

/* ========== activate ========== */
// حذف الكاشات القديمة التي تبدأ بالبادئة
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== CACHE_NAME && k.startsWith('cd-v5-')) {
        return caches.delete(k);
      }
    }));
  })());
  self.clients.claim();
});

/* ========== fetch ========== */
// الإستراتيجية:
// - طلبات navigation (الصفحات): شبكة أولاً؛ عند الفشل نرجع index.html من الكاش.
// - الأصول الثابتة المسبقة: كاش أولاً ثم شبكة (Cache First).
// - باقي الطلبات (Supabase / CDN): نمررها للشبكة كما هي.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // صفحات التنقل
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        // أول عنصر في STATIC_ASSETS هو '' (index)
        const indexUrl = computeScopedUrls()[0];
        return (await cache.match(indexUrl)) || Response.error();
      }
    })());
    return;
  }

  // أصول ثابتة من نفس النطاق وموجودة في قائمة الـ precache
  if (url.origin === self.location.origin && isStatic(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }

  // أي شيء آخر: مرره للشبكة (بدون caching) — API/صور خارجية/CDN
  // يمكنك تخصيصه لاحقًا حسب الحاجة.
});
