// Service Worker for PWA - Advanced Caching Strategy
const CACHE_NAME = 'gemini-wallet-v9';
const STATIC_CACHE = 'static-v9';
const DYNAMIC_CACHE = 'dynamic-v9';

// Static assets to cache immediately
const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js?v=2.8',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://telegram.org/js/telegram-web-app.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            console.log('[SW] Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
                    .map(key => caches.delete(key))
            );
        })
    );
    return self.clients.claim();
});

// Fetch event - Network First, fallback to Cache
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((res) => {
                // Clone response for caching
                const resClone = res.clone();
                caches.open(DYNAMIC_CACHE).then((cache) => {
                    cache.put(event.request, resClone);
                });
                return res;
            })
            .catch(() => {
                // Fallback to cache if network fails
                return caches.match(event.request);
            })
    );
});
