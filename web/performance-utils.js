/**
 * Frontend Performance Utilities
 * Client-side caching, lazy loading, and request optimization
 */

class ClientCache {
    constructor(maxSize = 50) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    set(key, value, ttlSeconds = 300) {
        // Remove oldest if cache is full
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expireTime: Date.now() + ttlSeconds * 1000,
            createdAt: Date.now()
        });
    }

    get(key) {
        const item = this.cache.get(key);
        
        if (!item) return null;

        // Check if expired
        if (Date.now() > item.expireTime) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    clear() {
        this.cache.clear();
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            utilization: `${((this.cache.size / this.maxSize) * 100).toFixed(1)}%`
        };
    }
}

// Export singleton
const clientCache = new ClientCache();

/**
 * API Request Optimizer with Deduplication
 */
class ApiOptimizer {
    constructor() {
        this.pendingRequests = new Map();
        this.requestStats = {
            total: 0,
            cached: 0,
            duplicate: 0,
            fresh: 0,
            averageTime: 0
        };
        this.requestTimes = [];
    }

    /**
     * Make optimized API call with automatic deduplication
     */
    async fetch(url, options = {}) {
        const cacheKey = `api:${url}:${JSON.stringify(options)}`;
        
        // Check client cache first
        const cached = clientCache.get(cacheKey);
        if (cached && !options.noCache) {
            this.requestStats.cached++;
            return cached;
        }

        // Check for pending requests to avoid duplication
        if (this.pendingRequests.has(cacheKey)) {
            this.requestStats.duplicate++;
            return this.pendingRequests.get(cacheKey);
        }

        // Make the request
        const startTime = Date.now();
        const promise = fetch(url, options)
            .then(res => res.json())
            .then(data => {
                const time = Date.now() - startTime;
                this.requestTimes.push(time);
                this.requestStats.fresh++;
                this.requestStats.total++;
                
                // Calculate average time
                if (this.requestTimes.length > 100) {
                    this.requestTimes = this.requestTimes.slice(-100);
                }
                this.requestStats.averageTime = Math.round(
                    this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length
                );

                // Cache the result
                const ttl = options.cacheTtl || 300;
                clientCache.set(cacheKey, data, ttl);

                this.pendingRequests.delete(cacheKey);
                return data;
            })
            .catch(error => {
                this.pendingRequests.delete(cacheKey);
                throw error;
            });

        // Store pending request
        this.pendingRequests.set(cacheKey, promise);
        return promise;
    }

    /**
     * Batch fetch multiple URLs in parallel
     */
    async batchFetch(urls, options = {}) {
        return Promise.all(urls.map(url => this.fetch(url, options)));
    }

    /**
     * Get request stats
     */
    getStats() {
        return {
            ...this.requestStats,
            averageTime: `${this.requestStats.averageTime}ms`,
            hitRate: this.requestStats.total > 0 
                ? `${((this.requestStats.cached / this.requestStats.total) * 100).toFixed(1)}%`
                : '0%'
        };
    }
}

const apiOptimizer = new ApiOptimizer();

/**
 * Lazy Loading Utility
 */
class LazyLoader {
    constructor() {
        this.loadedElements = new Set();
        this.pendingElements = new Set();
    }

    /**
     * Setup lazy loading for images
     */
    setupImageLazyLoading(selector = 'img[data-lazy]') {
        if (!('IntersectionObserver' in window)) {
            // Fallback for older browsers
            document.querySelectorAll(selector).forEach(img => {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                }
            });
            return;
        }

        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-lazy');
                        observer.unobserve(img);
                    }
                }
            });
        });

        document.querySelectorAll(selector).forEach(img => {
            imageObserver.observe(img);
        });
    }

    /**
     * Setup lazy loading for elements (DOM content)
     */
    setupElementLazyLoading(selector = '[data-lazy-load]') {
        if (!('IntersectionObserver' in window)) {
            return;
        }

        const elementObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const callback = element.dataset.lazyLoad;
                    
                    if (callback && typeof window[callback] === 'function') {
                        window[callback](element);
                    }
                    
                    element.removeAttribute('data-lazy-load');
                    observer.unobserve(element);
                }
            });
        }, { rootMargin: '50px' });

        document.querySelectorAll(selector).forEach(el => {
            elementObserver.observe(el);
        });
    }
}

const lazyLoader = new LazyLoader();

/**
 * Debounce helper for frequent operations
 */
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle helper for frequent events
 */
function throttle(func, limit = 300) {
    let lastFunc;
    let lastRan;
    return function(...args) {
        if (!lastRan) {
            func.apply(this, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(this, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

/**
 * Initialize all performance features
 */
function initPerformanceOptimizations() {
    // Setup lazy loading
    lazyLoader.setupImageLazyLoading();
    lazyLoader.setupElementLazyLoading();

    // Log performance metrics
    if ('performance' in window && 'navigation' in window.performance) {
        window.addEventListener('load', () => {
            const perfData = window.performance.timing;
            const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
            console.log(`⚡ Page Load Time: ${pageLoadTime}ms`);
        });
    }

    console.log('✅ Performance optimizations initialized');
}

// Export utilities
window.PerformanceUtils = {
    clientCache,
    apiOptimizer,
    lazyLoader,
    debounce,
    throttle,
    initPerformanceOptimizations
};

// Auto-initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPerformanceOptimizations);
} else {
    initPerformanceOptimizations();
}
