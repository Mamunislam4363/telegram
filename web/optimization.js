/**
 * Optimization — client library, bot & admin integration
 */

class OptimizationClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl || window.location.origin;
        this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.eventSource = null;
        this.subscribers = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.balanceCache = {};
        this.operationsPending = new Map();
        this._subscriptions = [];
    }

    connect(subscriptions = ['user_update', 'token_update', 'task_update']) {
        this._subscriptions = subscriptions;
        return new Promise((resolve, reject) => {
            try {
                this.eventSource = new EventSource(`${this.baseUrl}/api/optimization/updates/stream`);

                this.eventSource.onopen = () => {
                    this.reconnectAttempts = 0;
                    this.subscribe(subscriptions).catch(() => {});
                    resolve();
                };

                this.eventSource.onerror = (error) => {
                    this.handleConnectionError(error);
                    reject(error);
                };

                this.eventSource.onmessage = (event) => {
                    if (!event.data) return;
                    try {
                        this.handleMessage(JSON.parse(event.data));
                    } catch (e) {
                        console.error('Failed to parse optimization message:', e);
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    subscribe(eventTypes) {
        return fetch(`${this.baseUrl}/api/optimization/updates/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: this.clientId,
                events: Array.isArray(eventTypes) ? eventTypes : [eventTypes]
            })
        });
    }

    handleMessage(message) {
        const type = message.type;
        const data = message.data || message;

        if (type === 'token_update' && data.userId) {
            this.balanceCache[data.userId] = data.balance;
        }

        if (this.subscribers.has(type)) {
            this.subscribers.get(type).forEach(cb => {
                try { cb(data); } catch (err) { console.error(`Subscriber error (${type}):`, err); }
            });
        }
    }

    handleConnectionError() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
        this.reconnectAttempts++;
        setTimeout(() => {
            this.connect(this._subscriptions).catch(() => {});
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    on(eventType, callback) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, []);
        }
        this.subscribers.get(eventType).push(callback);
        return () => {
            const list = this.subscribers.get(eventType);
            const i = list.indexOf(callback);
            if (i > -1) list.splice(i, 1);
        };
    }

    async getBalance(userId) {
        if (this.balanceCache[userId] !== undefined) {
            return { success: true, balance: this.balanceCache[userId] };
        }
        const response = await fetch(`${this.baseUrl}/api/optimization/user/${userId}/balance`);
        const data = await response.json();
        if (data.balance !== undefined) this.balanceCache[userId] = data.balance;
        return data;
    }

    async reserveTokens(userId, amount, operationId) {
        const response = await fetch(`${this.baseUrl}/api/optimization/tokens/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, amount, operationId })
        });
        const result = await response.json();
        if (result.success) {
            this.operationsPending.set(operationId, { userId, amount, timestamp: Date.now(), status: 'reserved' });
        }
        return result;
    }

    async confirmDeduction(userId, operationId, amount, serviceDetails) {
        const response = await fetch(`${this.baseUrl}/api/optimization/tokens/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, operationId, amount, serviceDetails })
        });
        const result = await response.json();
        if (result.success) {
            this.operationsPending.delete(operationId);
            delete this.balanceCache[userId];
        }
        return result;
    }

    async refundTokens(userId, operationId, amount, reason) {
        const response = await fetch(`${this.baseUrl}/api/optimization/tokens/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, operationId, amount, reason })
        });
        const result = await response.json();
        if (result.success) {
            this.operationsPending.delete(operationId);
            delete this.balanceCache[userId];
        }
        return result;
    }

    async getPendingOperations(userId) {
        const response = await fetch(`${this.baseUrl}/api/optimization/tokens/pending/${userId}`);
        const data = await response.json();
        return data.pending || [];
    }

    async cancelOperation(operationId) {
        const response = await fetch(`${this.baseUrl}/api/optimization/tokens/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operationId })
        });
        return response.json();
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }
}

// --- Shared helpers (bot) ---

async function getBalanceWithProtection(userId) {
    if (!window.optimizationClient) return null;
    try {
        const result = await window.optimizationClient.getBalance(userId);
        return {
            balance: result.balance,
            available: result.available,
            reserved: result.reserved,
            currency: result.currency
        };
    } catch (error) {
        console.error('Error getting balance:', error);
        return null;
    }
}

async function reserveTokensForOperation(userId, amount, operationId) {
    if (!window.optimizationClient) return false;
    const result = await window.optimizationClient.reserveTokens(userId, amount, operationId);
    return !!result.success;
}

async function confirmOperationAndDeduct(userId, operationId, amount, serviceDetails) {
    if (!window.optimizationClient) return { success: false, error: 'Optimization not ready' };
    return window.optimizationClient.confirmDeduction(userId, operationId, amount, serviceDetails);
}

async function refundTokensOnFailure(userId, operationId, amount, reason) {
    if (!window.optimizationClient) return false;
    const result = await window.optimizationClient.refundTokens(userId, operationId, amount, reason);
    return !!result.success;
}

function updateBalanceDisplay(balance) {
    document.querySelectorAll('[data-balance], .balance, .user-balance').forEach(el => {
        el.textContent = typeof balance === 'number' ? balance.toLocaleString() + ' TC' : balance;
    });
}

function showOptimizationNotification(message, severity = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message);
    } else {
        console.log(`[${severity}] ${message}`);
    }
}

function refreshTaskUI() {
    if (typeof reloadTasks === 'function') reloadTasks();
}

// --- Admin helpers ---

function updateUserTokenDisplay(userId, balance) {
    const userRow = document.querySelector(`[data-user-id="${userId}"]`);
    if (!userRow) return;
    const balanceCell = userRow.querySelector('[data-balance]');
    if (balanceCell) balanceCell.textContent = balance.toLocaleString() + ' TC';
}

function logSystemEvent(data) {
    const eventLog = document.getElementById('event-log');
    if (!eventLog) return;
    const entry = document.createElement('div');
    entry.className = `event-${data.severity || 'info'}`;
    entry.innerHTML = `<time>${new Date().toLocaleTimeString()}</time><span>${data.message}</span>`;
    eventLog.insertBefore(entry, eventLog.firstChild);
    while (eventLog.children.length > 100) {
        eventLog.removeChild(eventLog.lastChild);
    }
}

function handleAdminUpdate(data) {
    console.log('Admin update:', data);
}

async function getAdminBalanceSummary() {
    const stats = await fetch('/api/optimization/admin/realtime-stats').then(r => r.json());
    return stats;
}

async function monitorCachePerformance() {
    return fetch('/api/optimization/admin/cache-stats').then(r => r.json());
}

async function clearUserCache(userId) {
    await fetch(`/api/optimization/admin/cache?pattern=balance_${userId}`, { method: 'DELETE' });
}

async function verifyUserBalance(userId) {
    const response = await fetch(`/api/optimization/user/${userId}/balance`);
    return response.json();
}

async function getPendingOperations(userId) {
    const response = await fetch(`/api/optimization/tokens/pending/${userId}`);
    const data = await response.json();
    return data.pending;
}

async function adminRefundUser(userId, amount, reason) {
    const operationId = `admin_refund_${Date.now()}`;
    const response = await fetch('/api/optimization/tokens/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId,
            operationId,
            amount,
            reason: `Admin refund: ${reason}`
        })
    });
    return response.json();
}

async function cancelStuckOperation(operationId) {
    const response = await fetch('/api/optimization/tokens/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId })
    });
    return response.json();
}

function displayDashboardStats(stats, cacheStats) {
    const dashboard = document.getElementById('admin-dashboard');
    if (!dashboard) return;
    dashboard.innerHTML = `
        <div class="stat-card"><h3>Active Users</h3><p>${stats.activeClients ?? 0}</p></div>
        <div class="stat-card"><h3>Cached Items</h3><p>${cacheStats.size ?? 0}</p></div>
        <div class="stat-card"><h3>Recent Changes</h3><p>${stats.changeLogSize ?? 0}</p></div>
        <div class="stat-card"><h3>Memory Usage</h3><p>${((cacheStats.memoryUsage || 0) / 1024).toFixed(2)} KB</p></div>
    `;
}

async function refreshAdminDashboard() {
    const stats = await getAdminBalanceSummary();
    const cacheStats = await monitorCachePerformance();
    displayDashboardStats(stats, cacheStats);
}

function injectAdminOptimizationStyles() {
    if (document.getElementById('optimization-admin-styles')) return;
    const style = document.createElement('style');
    style.id = 'optimization-admin-styles';
    style.textContent = `
        .event-info { background:#e3f2fd; border-left:4px solid #2196f3; padding:10px; margin:5px 0; }
        .event-warning { background:#fff3e0; border-left:4px solid #ff9800; padding:10px; margin:5px 0; }
        .event-error { background:#ffebee; border-left:4px solid #f44336; padding:10px; margin:5px 0; }
        .stat-card { background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:#fff; padding:20px; border-radius:8px; text-align:center; min-width:200px; }
        .stat-card h3 { margin:0; font-size:14px; opacity:.9; }
        .stat-card p { margin:10px 0 0; font-size:24px; font-weight:bold; }
        #event-log { max-height:400px; overflow-y:auto; background:#f5f5f5; border-radius:4px; padding:10px; }
        #event-log > div { padding:8px; margin:2px 0; border-radius:4px; font-size:12px; display:flex; gap:10px; }
        #event-log time { font-weight:bold; color:#666; }
    `;
    document.head.appendChild(style);
}

// --- Initialization ---

async function initBotOptimization() {
    const client = new OptimizationClient();
    await client.connect(['user_update', 'token_update', 'task_update', 'system_alert']);
    window.optimizationClient = client;

    client.on('token_update', (data) => {
        if (data.userId && data.balance !== undefined) {
            if (!window.userId || String(data.userId) === String(window.userId)) {
                updateBalanceDisplay(data.balance);
            }
        }
    });

    client.on('task_update', () => refreshTaskUI());

    client.on('system_alert', (data) => {
        showOptimizationNotification(data.message, data.severity);
    });
}

async function initAdminOptimization() {
    injectAdminOptimizationStyles();
    const adminOptimizer = new OptimizationClient();
    await adminOptimizer.connect(['token_update', 'user_update', 'system_alert', 'admin_update']);
    window.adminOptimizer = adminOptimizer;
    window.optimizationClient = adminOptimizer;

    adminOptimizer.on('token_update', (data) => updateUserTokenDisplay(data.userId, data.balance));
    adminOptimizer.on('system_alert', (data) => logSystemEvent(data));
    adminOptimizer.on('admin_update', (data) => handleAdminUpdate(data));

    if (document.getElementById('admin-dashboard')) {
        refreshAdminDashboard();
        setInterval(refreshAdminDashboard, 30000);
    }
}

function getOptimizationMode() {
    const script = document.currentScript || document.querySelector('script[data-optimization-mode]');
    if (script?.dataset?.optimizationMode) return script.dataset.optimizationMode;
    if (/\/admin\.html/i.test(location.pathname)) return 'admin';
    return 'bot';
}

// Globals
window.OptimizationClient = OptimizationClient;
window.getBalanceWithProtection = getBalanceWithProtection;
window.reserveTokensForOperation = reserveTokensForOperation;
window.confirmOperationAndDeduct = confirmOperationAndDeduct;
window.refundTokensOnFailure = refundTokensOnFailure;
window.getAdminBalanceSummary = getAdminBalanceSummary;
window.monitorCachePerformance = monitorCachePerformance;
window.clearUserCache = clearUserCache;
window.verifyUserBalance = verifyUserBalance;
window.getPendingOperations = getPendingOperations;
window.adminRefundUser = adminRefundUser;
window.cancelStuckOperation = cancelStuckOperation;
window.refreshAdminDashboard = refreshAdminDashboard;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const mode = getOptimizationMode();
        if (mode === 'admin') {
            await initAdminOptimization();
            console.log('✅ Admin optimization initialized');
        } else {
            await initBotOptimization();
            console.log('✅ Bot optimization initialized');
        }
    } catch (error) {
        console.error('Optimization initialization failed:', error);
    }
});
