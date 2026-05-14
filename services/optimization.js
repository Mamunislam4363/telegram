/**
 * ⚡ UNIFIED PERFORMANCE OPTIMIZATION SYSTEM
 * All optimization modules in one file
 * 
 * Components:
 * 1. CacheManager - In-memory caching
 * 2. PerformanceMiddleware - Response optimization
 * 3. TaskQueue - Background task processing
 * 4. DatabaseOptimizer - Query optimization
 * 5. PerformanceMonitor - System monitoring
 */

// ============================================================
// 1. CACHE MANAGER - In-Memory Caching for Performance
// ============================================================

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.ttl = new Map();
        this.stats = { hits: 0, misses: 0 };
    }

    set(key, value, ttlSeconds = 300) {
        this.cache.set(key, value);
        
        if (this.ttl.has(key)) {
            clearTimeout(this.ttl.get(key).timer);
        }

        const timer = setTimeout(() => {
            this.cache.delete(key);
            this.ttl.delete(key);
        }, ttlSeconds * 1000);

        this.ttl.set(key, { timer, expireTime: Date.now() + ttlSeconds * 1000 });
    }

    get(key) {
        if (this.cache.has(key)) {
            this.stats.hits++;
            return this.cache.get(key);
        }
        this.stats.misses++;
        return null;
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        if (this.ttl.has(key)) {
            clearTimeout(this.ttl.get(key).timer);
            this.ttl.delete(key);
        }
        return this.cache.delete(key);
    }

    clear() {
        for (const [, ttlData] of this.ttl) {
            clearTimeout(ttlData.timer);
        }
        this.cache.clear();
        this.ttl.clear();
        this.stats = { hits: 0, misses: 0 };
    }

    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;
        return {
            size: this.cache.size,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: `${hitRate}%`,
            totalRequests: total
        };
    }

    invalidateByPattern(pattern) {
        const regex = new RegExp(pattern);
        const keysToDelete = [];
        
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.delete(key));
        return keysToDelete.length;
    }

    getKeysByPattern(pattern) {
        const regex = new RegExp(pattern);
        const matching = [];
        
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                matching.push(key);
            }
        }
        return matching;
    }
}

// ============================================================
// 2. PERFORMANCE MIDDLEWARE - Response Optimization
// ============================================================

const compression = require('compression');

function applyCompressionMiddleware(app) {
    app.use(compression({
        filter: (req, res) => {
            if (req.headers['x-no-compression']) {
                return false;
            }
            return compression.filter(req, res);
        },
        level: 6,
        threshold: 1024
    }));
}

function optimizeResponse(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = function(data) {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-Response-Time', `${Date.now() - req._startTime}ms`);
        return originalJson(data);
    };

    req._startTime = Date.now();
    next();
}

function paginateArray(array, page = 1, limit = 20) {
    const start = (page - 1) * limit;
    const end = start + limit;
    const data = array.slice(start, end);
    
    return {
        data,
        pagination: {
            page,
            limit,
            total: array.length,
            pages: Math.ceil(array.length / limit),
            hasMore: end < array.length
        }
    };
}

function successResponse(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
    });
}

function errorResponse(res, message = 'Error', statusCode = 500, error = null) {
    return res.status(statusCode).json({
        success: false,
        message,
        error: error ? error.message : null,
        timestamp: new Date().toISOString()
    });
}

// ============================================================
// 3. TASK QUEUE - Background Task Processing
// ============================================================

const EventEmitter = require('events');

class TaskQueue extends EventEmitter {
    constructor(concurrency = 3) {
        super();
        this.queue = [];
        this.running = 0;
        this.concurrency = concurrency;
        this.completed = 0;
        this.failed = 0;
        this.stats = {
            total: 0,
            completed: 0,
            failed: 0,
            averageTime: 0
        };
        this.taskTimes = [];
    }

    async add(task, priority = 0) {
        return new Promise((resolve, reject) => {
            const queueItem = {
                task,
                priority,
                resolve,
                reject,
                createdAt: Date.now(),
                status: 'pending'
            };

            const insertIndex = this.queue.findIndex(item => item.priority < priority);
            if (insertIndex === -1) {
                this.queue.push(queueItem);
            } else {
                this.queue.splice(insertIndex, 0, queueItem);
            }

            this.stats.total++;
            this.process();
        });
    }

    async process() {
        if (this.running >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.running++;
        const item = this.queue.shift();
        item.status = 'running';
        const startTime = Date.now();

        try {
            const result = await item.task();
            const executionTime = Date.now() - startTime;
            
            this.taskTimes.push(executionTime);
            this.stats.completed++;
            this.stats.averageTime = Math.round(
                this.taskTimes.reduce((a, b) => a + b, 0) / this.taskTimes.length
            );

            item.status = 'completed';
            item.resolve(result);
            this.emit('taskComplete', { task: item.task.name, time: executionTime });
        } catch (error) {
            this.stats.failed++;
            item.status = 'failed';
            item.reject(error);
            this.emit('taskError', { task: item.task.name, error: error.message });
        } finally {
            this.running--;
            this.process();
        }
    }

    getStats() {
        return {
            queueSize: this.queue.length,
            running: this.running,
            concurrency: this.concurrency,
            completed: this.stats.completed,
            failed: this.stats.failed,
            total: this.stats.total,
            averageTaskTime: `${this.stats.averageTime}ms`,
            pending: this.queue.filter(item => item.status === 'pending').length
        };
    }

    async waitForEmpty() {
        return new Promise((resolve) => {
            const checkEmpty = () => {
                if (this.queue.length === 0 && this.running === 0) {
                    resolve();
                } else {
                    setTimeout(checkEmpty, 100);
                }
            };
            checkEmpty();
        });
    }

    clear() {
        this.queue = [];
    }
}

// ============================================================
// 4. DATABASE OPTIMIZER - Query Optimization
// ============================================================

class DatabaseOptimizer {
    constructor(cacheManager) {
        this.cache = cacheManager;
        this.queryStats = {
            total: 0,
            cached: 0,
            fresh: 0,
            averageTime: 0
        };
        this.queryTimes = [];
    }

    async query(key, queryFn, ttl = 300) {
        this.queryStats.total++;

        const cached = this.cache.get(key);
        if (cached !== null) {
            this.queryStats.cached++;
            return cached;
        }

        const startTime = Date.now();
        const result = await queryFn();
        const executionTime = Date.now() - startTime;

        this.queryTimes.push(executionTime);
        this.queryStats.fresh++;
        this.queryStats.averageTime = Math.round(
            this.queryTimes.reduce((a, b) => a + b, 0) / this.queryTimes.length
        );

        this.cache.set(key, result, ttl);

        return result;
    }

    async batchQuery(queries) {
        return Promise.all(
            queries.map(({ key, fn, ttl = 300 }) => this.query(key, fn, ttl))
        );
    }

    invalidateCache(pattern) {
        return this.cache.invalidateByPattern(pattern);
    }

    getStats() {
        const hitRate = this.queryStats.total > 0 
            ? ((this.queryStats.cached / this.queryStats.total) * 100).toFixed(2)
            : 0;

        return {
            ...this.queryStats,
            cacheHitRate: `${hitRate}%`,
            averageQueryTime: `${this.queryStats.averageTime}ms`,
            totalQueries: this.queryStats.total
        };
    }

    resetStats() {
        this.queryStats = {
            total: 0,
            cached: 0,
            fresh: 0,
            averageTime: 0
        };
        this.queryTimes = [];
    }
}

// ============================================================
// 5. PERFORMANCE MONITOR - System Monitoring
// ============================================================

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            apiCalls: 0,
            averageResponseTime: 0,
            totalResponseTime: 0,
            memoryUsage: [],
            requestsPerSecond: 0,
            uptime: Date.now(),
            errors: 0
        };
        this.responseTimes = [];
        this.startTime = Date.now();
    }

    recordApiCall(responseTime, success = true) {
        this.metrics.apiCalls++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.averageResponseTime = Math.round(
            this.metrics.totalResponseTime / this.metrics.apiCalls
        );

        if (!success) {
            this.metrics.errors++;
        }

        this.responseTimes.push(responseTime);

        if (this.responseTimes.length > 1000) {
            this.responseTimes = this.responseTimes.slice(-1000);
        }
    }

    recordMemoryUsage() {
        const used = process.memoryUsage();
        this.metrics.memoryUsage.push({
            timestamp: Date.now(),
            heapUsed: Math.round(used.heapUsed / 1024 / 1024),
            heapTotal: Math.round(used.heapTotal / 1024 / 1024),
            rss: Math.round(used.rss / 1024 / 1024)
        });

        if (this.metrics.memoryUsage.length > 1000) {
            this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-1000);
        }
    }

    getStats() {
        const uptime = Math.round((Date.now() - this.startTime) / 1000);
        const requestsPerSecond = this.metrics.apiCalls > 0 
            ? (this.metrics.apiCalls / uptime).toFixed(2)
            : 0;

        const memUsage = this.metrics.memoryUsage.length > 0
            ? this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1]
            : { heapUsed: 0, heapTotal: 0, rss: 0 };

        const minResponseTime = this.responseTimes.length > 0
            ? Math.min(...this.responseTimes)
            : 0;

        const maxResponseTime = this.responseTimes.length > 0
            ? Math.max(...this.responseTimes)
            : 0;

        const errorRate = this.metrics.apiCalls > 0
            ? ((this.metrics.errors / this.metrics.apiCalls) * 100).toFixed(2)
            : 0;

        return {
            uptime: `${uptime}s`,
            apiCalls: this.metrics.apiCalls,
            averageResponseTime: `${this.metrics.averageResponseTime}ms`,
            minResponseTime: `${minResponseTime}ms`,
            maxResponseTime: `${maxResponseTime}ms`,
            requestsPerSecond: parseFloat(requestsPerSecond),
            errors: this.metrics.errors,
            errorRate: `${errorRate}%`,
            memory: {
                heapUsedMB: memUsage.heapUsed,
                heapTotalMB: memUsage.heapTotal,
                rssMB: memUsage.rss
            }
        };
    }

    middleware() {
        return (req, res, next) => {
            const startTime = Date.now();

            const originalJson = res.json.bind(res);
            res.json = function(data) {
                const responseTime = Date.now() - startTime;
                this.recordApiCall(responseTime, res.statusCode < 400);
                return originalJson(data);
            }.bind(this);

            const originalSend = res.send.bind(res);
            res.send = function(data) {
                const responseTime = Date.now() - startTime;
                this.recordApiCall(responseTime, res.statusCode < 400);
                return originalSend(data);
            }.bind(this);

            next();
        };
    }

    startMemoryTracking(intervalMs = 30000) {
        this.memoryTrackingInterval = setInterval(() => {
            this.recordMemoryUsage();
        }, intervalMs);
    }

    stopMemoryTracking() {
        if (this.memoryTrackingInterval) {
            clearInterval(this.memoryTrackingInterval);
        }
    }

    resetStats() {
        this.metrics = {
            apiCalls: 0,
            averageResponseTime: 0,
            totalResponseTime: 0,
            memoryUsage: [],
            requestsPerSecond: 0,
            uptime: Date.now(),
            errors: 0
        };
        this.responseTimes = [];
        this.startTime = Date.now();
    }
}

// ============================================================
// INITIALIZE & EXPORT
// ============================================================

const cacheManager = new CacheManager();
const taskQueue = new TaskQueue(5);
const dbOptimizer = new DatabaseOptimizer(cacheManager);
const performanceMonitor = new PerformanceMonitor();

module.exports = {
    // Cache Manager
    cache: cacheManager,
    CacheManager,
    
    // Performance Middleware
    applyCompressionMiddleware,
    optimizeResponse,
    paginateArray,
    successResponse,
    errorResponse,
    
    // Task Queue
    taskQueue,
    TaskQueue,
    
    // Database Optimizer
    dbOptimizer,
    DatabaseOptimizer,
    
    // Performance Monitor
    performanceMonitor,
    PerformanceMonitor,
    
    // Convenience aliases
    cache: cacheManager,
    queue: taskQueue,
    monitor: performanceMonitor,
    optimizer: dbOptimizer
};
