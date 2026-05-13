const express = require('express');
const unifiedAutomation = require('../services/automation');
const { EmailAutomationManager, createGmailAccount, createHotmailAccount, getGmailMessages, getHotmailMessages, generatePhoto, generateVideo, removeWatermark } = unifiedAutomation;
const aiService = unifiedAutomation; // Fix for reference errors in AI routes
const fs = require('fs');
const os = require('os');
const path = require('path');
const oauth = require('../oauth');
const { OpenAI } = require('openai');
const axios = require('axios');
const imapService = require('../services/imap-service');

// Import video downloader modules
const tiktokDownloader = { getInfo: async () => ({ error: 'Feature disabled' }), download: async () => ({ error: 'Feature disabled' }) };
const facebookDownloader = { getInfo: async () => ({ error: 'Feature disabled' }), download: async () => ({ error: 'Feature disabled' }) };

const app = express();
const PORT = 3000;

// CORS middleware - allow all origins for Telegram Mini App
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

app.use(express.json({ limit: '10mb' }));

const db = require('../db');
const config = require('../config');

let openai = null;
function getOpenAI() {
    if (openai) return openai;
    if (!config.OPENAI_API_KEY) {
        console.warn('⚠️ OPENAI_API_KEY is missing. AI features will be disabled.');
        return null;
    }
    try {
        openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
        return openai;
    } catch (e) {
        console.error('❌ Failed to initialize OpenAI:', e.message);
        return null;
    }
}

// Helper function to get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

let bot = null;
let backupBot = null;
let totalCallbacks = 0;

function getBackupBot() {
    // First try to get token from environment/config
    let token = config.BACKUP_BOT_TOKEN;

    // If not in environment, try to get from database
    if (!token && db.data.apiKeys && db.data.apiKeys.backupBotToken) {
        token = db.data.apiKeys.backupBotToken;
    }

    if (!backupBot && token) {
        try {
            const TelegramBot = require('node-telegram-bot-api');
            backupBot = new TelegramBot(token, { polling: false });
            console.log('✅ Backup Bot initialized successfully');
        } catch (e) {
            console.error('❌ Failed to initialize Backup Bot:', e.message);
        }
    }
    return backupBot;
}

function setBot(instance) {
    bot = instance;

    // Use URL from database if available, otherwise fallback to config or default
    // Use URL from config first, then database, then fallback to current request or default
    let publicUrl = config.PUBLIC_URL || config.MINI_APP_URL || '';
    if (db.data.apiKeys && db.data.apiKeys.miniAppUrl) {
        publicUrl = db.data.apiKeys.miniAppUrl;
    }

    if (!publicUrl) {
        publicUrl = 'https://autosverifybot-production.up.railway.app/'; // Final fallback
    }
    publicUrl = publicUrl.trim();

    setTimeout(async () => {
        try {
            // Sync environment variables and config
            config.PUBLIC_URL = publicUrl;
            config.MINI_APP_URL = publicUrl;
            process.env.PUBLIC_URL = publicUrl;

            // Set the Web App Menu Button to the Public URL
            await bot.setChatMenuButton({
                menu_button: {
                    type: 'web_app',
                    text: 'Launch Bot',
                    web_app: { url: publicUrl }
                }
            });
            console.log(`✅ [MINI APP] Telegram Menu Button set to: ${publicUrl}`);
        } catch (e) {
            console.error('❌ Failed to set Telegram Menu Button:', e.message);
        }
    }, 2000);

    // Auto-connect Mother Emails on startup
    autoConnectMotherEmails();
}

async function autoConnectMotherEmails() {
    try {
        const configs = db.data.adminSettings?.motherEmailConfigs;
        if (!configs) return;

        for (const type of ['gmail', 'hotmail']) {
            const cfg = configs[type];
            if (cfg && cfg.email && cfg.password) {
                console.log(`[IMAP] Auto-connecting to saved mother email [${type}]...`);
                await imapService.connect(type, cfg);
            }
        }
    } catch (e) {
        console.error('[IMAP] Auto-connect error:', e.message);
    }
}

// Helper: Detect User Country from IP
async function detectUserCountry(req) {
    try {
        // Try common headers first (Cloudflare, GCP, etc)
        const countryHeader = req.headers['cf-ipcountry'] ||
            req.headers['x-client-geo-country'] ||
            req.headers['x-appengine-country'] ||
            req.headers['x-vercel-ip-country'];

        if (countryHeader && countryHeader !== 'XX' && countryHeader.length === 2) {
            return countryHeader.toUpperCase();
        }

        // Fallback to IP-based lookup
        const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
        if (!ip || ip === '::1' || ip === '127.0.0.1') return 'USA'; // Local fallback

        const response = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 3000 });
        if (response.data && response.data.status === 'success') {
            return response.data.countryCode;
        }
    } catch (e) {
        console.error('Country detection error:', e.message);
    }
    return 'USA'; // Default
}

// Helper functions for user data management with Firebase sync
function getUsersObj() {
    // Ensure users object exists
    if (!db.data.users) {
        db.data.users = {};
    }
    return db.data.users;
}

function saveUsersObj(users, force = false) {
    // Trigger Firebase save only - users object is already modified in place via getUsersObj() reference
    // IMPORTANT: Do NOT assign db.data.users = users as this causes race conditions
    // where concurrent saves wipe out data added between getUsersObj() and saveUsersObj()
    if (typeof db.save === 'function') {
        db.save(force);
    }
}

// Helper: Validate userId
function isValidUserId(userId) {
    if (!userId) return false;
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    return !isNaN(numericId) && numericId > 0;
}

// API: System Version
app.get('/api/version', (req, res) => {
    const version = (db.data && db.data.settings && db.data.settings.systemVersion) || 1;
    res.set('Cache-Control', 'no-store');
    res.json({ version, ts: Date.now() });
});


// Request counter middleware
app.use((req, res, next) => {
    totalCallbacks++;
    next();
});

// CORS middleware - allows Netlify frontend to call API directly
app.use((req, res, next) => {
    const allowedOrigins = ['https://autosverifybot-production.up.railway.app/'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Additional middleware to block invalid userId early
app.use((req, res, next) => {
    // Extract userId from various request sources
    let userId = req.params.userId || req.body?.userId || req.query?.userId;

    // Skip validation for non-user endpoints
    const skipPaths = ['/', '/admin', '/api/admin/login', '/api/services', '/api/ads/config'];
    if (skipPaths.includes(req.path)) return next();

    // Skip for static files and GET requests without userId
    if (!userId) return next();

    // Validate userId if present
    if (!isValidUserId(userId)) {
        console.log(`[BLOCKED] Invalid userId in ${req.method} ${req.path}: ${userId}`);
        return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    next();
});

// Serve Static Files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'web')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ROUTES
// 1. User Panel (Default)
// app.get('/', (req, res) => {
// Serve static files from web folder
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// 2. Admin Panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'admin.html'));
});

// API: Admin Login Check
app.post('/api/admin/login', (req, res) => {
    const { password, token } = req.body;
    // Token-based login (for bot auto-login)
    if (token) {
        const validToken = generateAdminToken();
        // We check against stored pending tokens
        if (global._pendingAdminTokens && global._pendingAdminTokens[token] && Date.now() < global._pendingAdminTokens[token]) {
            delete global._pendingAdminTokens[token];
            return res.json({ success: true, token: 'admin-session-' + Date.now() });
        }
        return res.json({ success: false, message: 'Invalid or expired token' });
    }
    // Password-based login
    if (password === (config.ADMIN_PASSWORD || 'admin123')) {
        res.json({ success: true, token: 'fake-jwt-token-' + Date.now() });
    } else {
        res.json({ success: false, message: 'Invalid password' });
    }
});

// ---------------- DB AUTO BACKUP SCHEDULER ----------------

function _ensureAdminSettings() {
    if (!db.data.adminSettings) db.data.adminSettings = {};
    if (!db.data.adminSettings.dbAutoBackup) {
        db.data.adminSettings.dbAutoBackup = {
            enabled: false,
            backupDays: 1,
            backupTime: '06:00',
            keep: 1, // New: Always keep only the latest backup
            lastBackupAt: 0,
            lastBackupFile: '',
            nextBackupAt: 0
        };
        db.save();
    }
    return db.data.adminSettings.dbAutoBackup;
}

function _parseDailyTimeToMs(dailyTime) {
    if (!dailyTime || typeof dailyTime !== 'string') return null;
    const m = dailyTime.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return { hh, mm };
}

function _computeNextBackupAt(schedule) {
    const now = Date.now();
    const last = schedule.lastBackupAt || 0;
    const backupDays = Math.max(1, parseInt(schedule.backupDays || 1));
    const backupTime = schedule.backupTime || '06:00';

    // Parse time (HH:MM format)
    const timeMatch = backupTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
        // Invalid time format, default to 06:00
        return now + backupDays * 24 * 60 * 60 * 1000;
    }

    const hh = parseInt(timeMatch[1], 10);
    const mm = parseInt(timeMatch[2], 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return now + backupDays * 24 * 60 * 60 * 1000;
    }

    // Calculate next backup time
    const nextBackup = new Date();
    nextBackup.setHours(hh, mm, 0, 0);

    // If the time has already passed today, move to the next occurrence
    if (nextBackup.getTime() <= now) {
        nextBackup.setDate(nextBackup.getDate() + backupDays);
    }

    return nextBackup.getTime();
}

function _getBackupsDir() {
    const path = require('path');
    return path.join(process.cwd(), 'backups');
}

function _listBackupFiles() {
    const fs = require('fs');
    const path = require('path');
    const dir = _getBackupsDir();
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const full = path.join(dir, f);
            const st = fs.statSync(full);
            return { file: f, fullPath: full, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    return files;
}

async function _runBackup(reason = 'auto') {
    const fs = require('fs');
    const path = require('path');
    const schedule = _ensureAdminSettings();

    const dir = _getBackupsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const ts = Date.now();
    const fileName = `${reason}_backup_${ts}.json`;
    const fullPath = path.join(dir, fileName);

    fs.writeFileSync(fullPath, JSON.stringify(db.data, null, 2));

    schedule.lastBackupAt = ts;
    schedule.lastBackupFile = fileName;
    db.data.adminSettings.dbAutoBackup = schedule;
    db.save();

    // Trim old backups
    const keep = Math.max(1, parseInt(schedule.keep || 1));
    const files = _listBackupFiles();
    if (files.length > keep) {
        files.slice(keep).forEach(f => {
            try { fs.unlinkSync(f.fullPath); } catch (e) { }
        });
    }

    // Unified Telegram Backup via Backup Bot
    const bBot = getBackupBot();
    const backupTarget = config.BACKUP_CHAT_ID || config.ADMIN_ID;
    if (bBot && backupTarget) {
        try {
            const fileStream = fs.createReadStream(fullPath);
            await bBot.sendDocument(backupTarget, fileStream, {
                caption: `📦 <b>Database Backup</b> (${reason.toUpperCase()})\n\n` +
                    `📅 <b>Date:</b> ${new Date().toLocaleDateString()}\n` +
                    `⏰ <b>Time:</b> ${new Date().toLocaleTimeString()}\n` +
                    `📄 <b>File:</b> <code>${fileName}</code>\n\n` +
                    `_Sent via Backup Service_`,
                parse_mode: 'HTML'
            });
            console.log(`✅ Backup sent to Telegram via Backup Bot: ${fileName}`);
        } catch (e) {
            console.error('❌ Backup Bot sendDocument error:', e.message);
        }
    } else {
        console.warn('⚠️ Backup Telegram send skipped: Backup Bot or Target ID missing.');
    }



    return { fileName, ts };
}

// API: Get DB Auto Backup Schedule
app.get('/api/admin/db/schedule', (req, res) => {
    const schedule = _ensureAdminSettings();
    const nextBackupAt = schedule.nextBackupAt || _computeNextBackupAt(schedule);
    res.json({
        success: true,
        schedule: {
            enabled: schedule.enabled === true,
            backupDays: schedule.backupDays || 1,
            backupTime: schedule.backupTime || '06:00',
            keep: schedule.keep || 30
        },
        lastBackupAt: schedule.lastBackupAt || 0,
        nextBackupAt,
        dbSize: fs.existsSync('./db.json') ? fs.statSync('./db.json').size : 0
    });
});

// API: Get Bot Username (for deep links from WebApp)
app.get('/api/bot-username', (req, res) => {
    try {
        const config = require('../config');
        const botUsername = (db.data.settings && db.data.settings.botUsername) || config.BOT_USERNAME || 'AutosVerify_bot';
        res.json({ success: true, botUsername });
    } catch (e) {
        res.json({ success: true, botUsername: 'AutosVerify_bot' });
    }
});

// API: Update DB Auto Backup Schedule
app.post('/api/admin/db/schedule', (req, res) => {
    try {
        const schedule = _ensureAdminSettings();
        const enabled = req.body.enabled === true;
        const backupDays = Math.max(1, parseInt(req.body.backupDays || schedule.backupDays || 1));
        const backupTime = (req.body.backupTime || '06:00').trim();
        const keep = Math.max(1, parseInt(req.body.keep || schedule.keep || 30));

        schedule.enabled = enabled;
        schedule.backupDays = backupDays;
        schedule.backupTime = backupTime;
        schedule.keep = keep;
        schedule.nextBackupAt = _computeNextBackupAt(schedule);
        db.data.adminSettings.dbAutoBackup = schedule;
        db.save();

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: List available backup files
app.get('/api/admin/db/backups', (req, res) => {
    try {
        const files = _listBackupFiles().map(f => ({ file: f.file, size: f.size, mtime: f.mtime }));
        const schedule = _ensureAdminSettings();
        res.json({
            success: true,
            files,
            lastBackupFile: schedule.lastBackupFile || ''
        });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Download a selected backup file
app.get('/api/admin/db/download/:file', (req, res) => {
    try {
        const path = require('path');
        const file = req.params.file;
        const dir = _getBackupsDir();
        const full = path.join(dir, file);

        // Security check
        if (!full.startsWith(dir)) return res.status(403).send('Forbidden');
        if (!fs.existsSync(full)) return res.status(404).send('Not Found');

        res.download(full);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// API: Restore/Merge from a selected backup file
app.post('/api/admin/db/restore', (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const file = (req.body.file || '').trim();
        if (!file) return res.json({ success: false, message: 'file is required' });

        const dir = _getBackupsDir();
        const full = path.join(dir, file);
        if (!full.startsWith(dir)) return res.json({ success: false, message: 'Invalid file path' });
        if (!fs.existsSync(full)) return res.json({ success: false, message: 'Backup file not found' });

        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return res.json({ success: false, message: 'Invalid backup JSON' });

        // Merge strategy similar to import
        db.data.users = { ...(db.data.users || {}), ...(parsed.users || {}) };
        if (parsed.settings) db.data.settings = { ...(db.data.settings || {}), ...parsed.settings };
        if (parsed.cardPrices) db.data.cardPrices = { ...(db.data.cardPrices || {}), ...parsed.cardPrices };
        if (parsed.vpnPrices) db.data.vpnPrices = { ...(db.data.vpnPrices || {}), ...parsed.vpnPrices };
        if (parsed.cards) db.data.cards = { ...(db.data.cards || {}), ...parsed.cards };
        if (parsed.vpnAccounts) db.data.vpnAccounts = { ...(db.data.vpnAccounts || {}), ...parsed.vpnAccounts };
        if (parsed.tasks) db.data.tasks = { ...(db.data.tasks || {}), ...parsed.tasks };
        Object.keys(parsed).forEach(key => {
            if (!db.data[key]) db.data[key] = parsed[key];
        });

        db.save();
        res.json({ success: true, message: 'Database restored/merged successfully' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Delete a selected backup file
app.delete('/api/admin/db/backups/:file', (req, res) => {
    try {
        const file = req.params.file;
        const dir = _getBackupsDir();
        const full = path.join(dir, file);

        // Security check
        if (!full.startsWith(dir)) return res.json({ success: false, message: 'Forbidden' });
        if (!fs.existsSync(full)) return res.json({ success: false, message: 'Backup file not found' });

        fs.unlinkSync(full);
        res.json({ success: true, message: 'Backup deleted successfully' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// Helper: Clean up user history older than 30 days
function _cleanupUserHistory() {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    let totalRemoved = 0;
    let usersUpdated = 0;

    Object.values(db.data.users || {}).forEach(user => {
        if (user.history && Array.isArray(user.history)) {
            const initialLength = user.history.length;
            user.history = user.history.filter(h => {
                const hDate = h.date ? new Date(h.date).getTime() : 0;
                return hDate > thirtyDaysAgo;
            });
            if (initialLength !== user.history.length) {
                totalRemoved += (initialLength - user.history.length);
                usersUpdated++;
            }
        }
    });

    if (totalRemoved > 0) {
        db.save();
        console.log(`[DB] Cleaned up ${totalRemoved} expired user history items from ${usersUpdated} users.`);
    }
}

// Helper: Clean up old upload files (> 12 hours) and bogus broadcast data
function _cleanupUploads() {
    try {
        // 1. Physical Files Cleanup
        const uploadDir = path.join(__dirname, '..', 'web', 'uploads');
        if (fs.existsSync(uploadDir)) {
            const files = fs.readdirSync(uploadDir);
            const now = Date.now();
            const maxAge = 12 * 60 * 60 * 1000; // 12 hours

            let count = 0;
            files.forEach(f => {
                const fullPath = path.join(uploadDir, f);
                const st = fs.statSync(fullPath);
                if (now - st.mtimeMs > maxAge) {
                    fs.unlinkSync(fullPath);
                    count++;
                }
            });
            if (count > 0) console.log(`[CLEANUP] Removed ${count} expired files from uploads.`);
        }

        // 2. Bogus Data Cleanup (Broadcasts/Logs)
        let dataChanged = false;
        if (db.data.broadcasts && db.data.broadcasts.length > 0) {
            db.data.broadcasts = [];
            dataChanged = true;
        }
        if (db.data.scheduledBroadcasts && db.data.scheduledBroadcasts.length > 0) {
            // Only keep future ones, but user said "all bogust data delete"
            // Let's clear completed ones or just clear all if it's a "log"
            db.data.scheduledBroadcasts = db.data.scheduledBroadcasts.filter(b => b.time > Date.now());
            dataChanged = true;
        }

        if (dataChanged) {
            db.save();
            console.log(`[CLEANUP] Bogus broadcast/scheduled data cleared.`);
        }
    } catch (e) {
        console.error('[CLEANUP] Uploads error:', e.message);
    }
}

function _cleanupItemSales() {
    if (!db.data.itemSales) return;
    const now = Date.now();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    let removed = 0;
    const keys = Object.keys(db.data.itemSales);
    keys.forEach(id => {
        const sale = db.data.itemSales[id];
        if ((sale.status === 'sold' || sale.status === 'rejected') && sale.updatedAt < twentyFourHoursAgo) {
            delete db.data.itemSales[id];
            removed++;
        }
    });
    if (removed > 0) {
        console.log(`[CLEANUP] Deleted ${removed} sold/rejected item sales (older than 24h)`);
        db.save();
    }
}

// Timer: check every minute
setInterval(async () => {
    try {
        const schedule = _ensureAdminSettings();
        if (!schedule.enabled) return;
        // Persist nextBackupAt to avoid multiple triggers when server is busy
        if (!schedule.nextBackupAt || schedule.nextBackupAt < Date.now() - (60 * 60 * 1000)) {
            schedule.nextBackupAt = _computeNextBackupAt(schedule);
            db.data.adminSettings.dbAutoBackup = schedule;
            db.save();
        }

        if (Date.now() >= schedule.nextBackupAt) {
            await _runBackup('auto');
            // Recompute after backup
            schedule.nextBackupAt = _computeNextBackupAt(schedule);
            db.data.adminSettings.dbAutoBackup = schedule;
            db.save();
        }

        // Also run user history cleanup once a day (at midnight-ish or just random check)
        // For simplicity, we run it every backup cycle or every few hours.
        // Let's check every hour.
        const h = new Date().getHours();
        if (!global._lastHistoryCleanupHour || global._lastHistoryCleanupHour !== h) {
            _cleanupUserHistory();
            _cleanupUploads(); // NEW: Periodic uploads cleanup
            _cleanupItemSales(); // NEW: Daily item sales cleanup
            global._lastHistoryCleanupHour = h;
        }
    } catch (e) {
        console.error('Auto backup scheduler error:', e.message);
    }
}, 60 * 1000);

// Generate a one-time admin auto-login token (valid 5 min)
function generateAdminToken() {
    const crypto = require('crypto');
    const token = crypto.randomBytes(20).toString('hex');
    if (!global._pendingAdminTokens) global._pendingAdminTokens = {};
    global._pendingAdminTokens[token] = Date.now() + 5 * 60 * 1000; // 5 min
    // Cleanup old tokens
    const now = Date.now();
    Object.keys(global._pendingAdminTokens).forEach(t => {
        if (global._pendingAdminTokens[t] < now) delete global._pendingAdminTokens[t];
    });
    return token;
}

// Expose token generator for bot.js
module.exports.generateAdminToken = generateAdminToken;


// Stats route consolidated below at line ~672 – removed duplicate here

// (Settings saved via the full endpoint at bottom of file)

// API: Get Codes
app.get('/api/admin/codes', async (req, res) => {
    // codes stored in db.data.settings.codes
    const settings = await db.getSettings();
    const codes = settings.codes || {};
    const codeList = Object.keys(codes).map(key => ({
        code: key,
        ...codes[key],
        amount: codes[key].amount,
        maxUses: codes[key].maxUses || codes[key].uses || 0,
        used: codes[key].redeemedBy ? codes[key].redeemedBy.length : 0
    }));
    res.json({ success: true, codes: codeList });
});

// API: Create Code
app.post('/api/admin/codes', async (req, res) => {
    const { code, amount, maxUses } = req.body;
    if (!code) return res.json({ success: false, message: 'Code required' });
    await db.createCode(code, parseInt(amount) || 0, parseInt(maxUses) || 0);
    res.json({ success: true });
});

// API: Delete Code
app.delete('/api/admin/codes/:code', async (req, res) => {
    const { code } = req.params;

    // First, remove this code from all users' redeemed arrays
    const users = await db.getUsers();
    let usersUpdated = 0;
    for (const user of users) {
        if (user.redeemed && user.redeemed.includes(code)) {
            user.redeemed = user.redeemed.filter(c => c !== code);
            await db.updateUser(user);
            usersUpdated++;
        }
    }
    console.log(`[DELETE CODE] Removed '${code}' from ${usersUpdated} users' redeemed arrays`);

    // Now delete the code from settings
    const success = await db.deleteCode(code);
    res.json({ success });
});

// API: Admin Meta Settings (Maintenance Mode, etc.)
app.post('/api/admin/meta', (req, res) => {
    const { key, value } = req.body;

    if (!key) {
        return res.json({ success: false, error: 'Missing key' });
    }

    // Initialize adminSettings if not exists
    if (!db.data.adminSettings) {
        db.data.adminSettings = {};
    }

    // Set the meta key
    db.data.adminSettings[key] = value;
    db.save();

    console.log(`[ADMIN] Meta setting updated: ${key} = ${value}`);
    res.json({ success: true, message: `Setting saved: ${key}` });
});

// API: Admin Configuration (Daily Reward, Welcome Bonus, etc.)
app.get('/api/admin/config', (req, res) => {
    res.json({
        success: true,
        config: {
            dailyBonus: db.data.settings.dailyBonus,
            welcomeCredits: db.data.settings.welcomeCredits || db.data.settings.welcomeBonus,
            maintenance: db.data.meta?.maintenance || false,
            countryAdRewards: db.data.settings.countryAdRewards || {}
        }
    });
});

// API: Public Config (includes payment platform details)
app.get('/api/config', (req, res) => {
    res.json({
        success: true,
        config: {
            dailyBonus: db.data.settings.dailyBonus,
            welcomeCredits: db.data.settings.welcomeCredits || db.data.settings.welcomeBonus,
            maintenance: db.data.meta?.maintenance || false,
            countryAdRewards: db.data.settings.countryAdRewards || {},
            // Payment platform details
            bkashName: db.data.settings.bkashName || 'bKash Personal',
            bkashNumber: db.data.settings.bkashNumber || '',
            bkashType: db.data.settings.bkashType || 'Personal',
            nagadName: db.data.settings.nagadName || 'Nagad Personal',
            nagadNumber: db.data.settings.nagadNumber || '',
            nagadType: db.data.settings.nagadType || 'Personal'
        }
    });
});

app.post('/api/admin/toggle-maintenance', (req, res) => {
    const { userId } = req.body;
    if (String(userId) !== String(process.env.ADMIN_ID)) return res.json({ success: false, message: 'Unauthorized' });

    if (!db.data.meta) db.data.meta = {};
    db.data.meta.maintenance = !db.data.meta.maintenance;
    db.save();
    res.json({ success: true, maintenance: db.data.meta.maintenance });
});

app.post('/api/admin/update-config', (req, res) => {
    const { userId, dailyBonus, welcomeCredits, countryAdRewards, bkashName, bkashNumber, bkashType, nagadName, nagadNumber, nagadType } = req.body;
    if (String(userId) !== String(process.env.ADMIN_ID)) return res.json({ success: false, message: 'Unauthorized' });

    if (dailyBonus !== undefined) db.data.settings.dailyBonus = parseInt(dailyBonus);
    if (welcomeCredits !== undefined) db.data.settings.welcomeCredits = parseInt(welcomeCredits);
    if (countryAdRewards !== undefined) db.data.settings.countryAdRewards = countryAdRewards;

    // Payment platform details
    if (bkashName !== undefined) db.data.settings.bkashName = bkashName;
    if (bkashNumber !== undefined) db.data.settings.bkashNumber = bkashNumber;
    if (bkashType !== undefined) db.data.settings.bkashType = bkashType;
    if (nagadName !== undefined) db.data.settings.nagadName = nagadName;
    if (nagadNumber !== undefined) db.data.settings.nagadNumber = nagadNumber;
    if (nagadType !== undefined) db.data.settings.nagadType = nagadType;

    db.save();
    res.json({ success: true });
});

app.get('/api/admin/all-messages', (req, res) => {
    const { userId } = req.query;
    if (String(userId) !== String(process.env.ADMIN_ID)) return res.json({ success: false, message: 'Unauthorized' });

    const messages = {};
    for (const uId in db.data.users) {
        const user = db.data.users[uId];
        if (user.supportMessages && user.supportMessages.length > 0) {
            messages[uId] = user.supportMessages;
        }
    }
    res.json({ success: true, messages });
});

app.post('/api/admin/config', (req, res) => {
    const { dailyReward, welcomeBonus } = req.body;

    // Update settings
    if (dailyReward !== undefined) {
        db.data.settings.dailyBonus = parseInt(dailyReward);
    }
    if (welcomeBonus !== undefined) {
        db.data.settings.welcomeBonus = parseInt(welcomeBonus);
    }

    db.save();

    console.log('[ADMIN] Config updated:', {
        dailyBonus: db.data.settings.dailyBonus,
        welcomeBonus: db.data.settings.welcomeBonus
    });

    res.json({
        success: true,
        message: 'Configuration saved',
        settings: {
            dailyBonus: db.data.settings.dailyBonus,
            welcomeBonus: db.data.settings.welcomeBonus
        }
    });
});

// Helper: Delete all messages sent by a helper admin
async function deleteHelperAdminMessages(userId) {
    const user = await db.getUser(userId);
    if (!user || !user.helperAdminMessages) return;

    const TelegramBot = require('node-telegram-bot-api');
    const config = require('../config');
    const botToken = config.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
        console.error('[HELPER ADMIN] Cannot delete messages: Bot token missing');
        return;
    }

    // Use global bot if available
    const activeBot = bot || new TelegramBot(botToken, { polling: false });

    console.log(`[HELPER ADMIN] Deleting ${user.helperAdminMessages.length} messages for user ${userId}`);

    for (const msg of user.helperAdminMessages) {
        try {
            await activeBot.deleteMessage(msg.chatId, msg.messageId);
            console.log(`[HELPER ADMIN] Deleted message ${msg.messageId} in chat ${msg.chatId}`);
        } catch (e) {
            console.error(`[HELPER ADMIN] Failed to delete message ${msg.messageId} in chat ${msg.chatId}: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 100));
    }

    user.helperAdminMessages = [];
    await db.updateUser(user);
}

// API: Update User Data (Admin)
app.post('/api/admin/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { balance, tokens, referralCount, verified, Gems, usd, adminVerified, apiStatus, role } = req.body;
        const user = await db.getUser(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        // Handle both 'tokens' and 'balance' parameters
        const tokenValue = tokens !== undefined ? tokens : balance;
        if (tokenValue !== undefined) {
            db.setTokenBalance(user, parseInt(tokenValue));
        }
        if (Gems !== undefined) {
            user.Gems = parseInt(Gems);
            user.balance_Gems = parseInt(Gems);
        }
        if (usd !== undefined) {
            user.usd = parseFloat(usd);
        }
        if (referralCount !== undefined) user.referralCount = parseInt(referralCount);
        if (verified !== undefined) user.verified = (verified === true || verified === 'true');
        if (adminVerified !== undefined) user.adminVerified = (adminVerified === true || adminVerified === 'true');
        if (apiStatus !== undefined) user.apiStatus = apiStatus;

        if (role !== undefined) {
            const oldRole = user.role || 'user';
            user.role = role;

            // If role changed from helper_admin to user (disabled)
            if (oldRole === 'helper_admin' && role === 'user') {
                console.log(`[HELPER ADMIN] Disabling helper admin ${userId} and deleting messages...`);
                await deleteHelperAdminMessages(userId);
            }
        }

        await db.updateUser(user, null, true);
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('[ADMIN USER UPDATE ERROR]', error);
        res.json({ success: false, message: error.message });
    }
});

// API: Get User Profile Data
app.get('/api/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    const user = await db.getUser(userId);
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Include task info from global settings
    const activeTasks = db.data.tasks || {};
    const taskList = Object.keys(activeTasks).map(key => ({
        id: key,
        ...activeTasks[key]
    }));

    // Resolve balances using db helpers for consistency
    const tokenBalance = db.getTokenBalance(user);

    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username || 'User',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            photo_url: user.photo_url || '',
            // Balances — use consistent field names matching frontend expectations
            balance_tokens: tokenBalance,
            tokens: tokenBalance,
            gems: user.balance_Gems || user.Gems || 0,
            Gems: user.balance_Gems || user.Gems || 0,
            usd: user.usd || 0,
            // Status fields
            banned: user.banned || false,
            verified: user.verified || false,
            adminVerified: user.adminVerified || false,
            apiKey: user.apiKey || null,
            apiStatus: user.apiStatus || 'allow',
            // Stats
            invites: user.referralCount || 0,
            dailyStreak: user.dailyStreak || 0,
            completedTasks: user.tasksDone || [],
            referralCode: db.getReferralCode(user.id),
        },
        // Legacy top-level fields for backward compat
        userId: user.id,
        username: user.username || 'User',
        tokens: tokenBalance,
        Gems: user.balance_Gems || user.Gems || 0,
        invites: user.referralCount || 0,
        dailyStreak: user.dailyStreak || 0,
        completedTasks: user.tasksDone || [],
        referralCode: db.getReferralCode(user.id),
        availableTasks: taskList,
        botUsername: (db.data.settings && db.data.settings.botUsername) || config.BOT_USERNAME || 'AutosVerify_bot'
    });
});


// API: Verify Task Completion
app.post('/api/user/verify-task', async (req, res) => {
    const { userId, taskId } = req.body;
    if (!userId || !taskId) {
        return res.status(400).json({ success: false, message: 'userId and taskId are required' });
    }

    const user = await db.getUser(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Check if already done
    if (user.tasksDone && user.tasksDone.includes(taskId)) {
        return res.json({ success: true, message: 'Task already completed', alreadyDone: true });
    }

    const taskData = db.data.tasks && db.data.tasks[taskId];
    if (!taskData) return res.status(404).json({ success: false, message: 'Task not found' });

    // REAL VERIFICATION Logic for Telegram
    let verified = false;
    let failReason = 'Join the channel/group first!';

    if (taskId.includes('telegram')) {
        if (!bot || !bot.token || bot.token === 'undefined' || bot.token === 'null') {
            // Development fallback or if bot not initialized
            verified = true;
        } else {
            try {
                const targetChat = taskId === 'task_telegram_channel' ? config.REQUIRED_CHANNEL : config.REQUIRED_GROUP;
                const member = await bot.getChatMember(targetChat, userId);
                const allowed = ['member', 'administrator', 'creator'];
                if (allowed.includes(member.status)) {
                    verified = true;
                } else {
                    verified = false;
                    failReason = `Please join ${targetChat} to complete this task!`;
                }
            } catch (e) {
                console.error(`Verification error for ${userId} on ${taskId}:`, e.message);
                if (e.message.includes('No token')) {
                    verified = true; // Fallback if token missing
                } else {
                    verified = false;
                    failReason = `Verification error: Ensure you are a member of ${taskId === 'task_telegram_channel' ? config.REQUIRED_CHANNEL : config.REQUIRED_GROUP}.`;
                }
            }
        }
    } else {
        verified = true;
    }

    if (verified) {
        if (!user.tasksDone) user.tasksDone = [];
        user.tasksDone.push(taskId);

        const reward = taskData.reward || 10;
        const gems = taskData.gems || 0;

        db.addCredit(userId, reward);
        if (gems > 0) user.Gems = (user.Gems || 0) + gems;

        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'task',
            reward: `+${reward} Tokens`,
            date: Date.now(),
            detail: `Task: ${taskData.name}`
        });

        db.save();
        return res.json({ success: true, message: 'Task verified! Reward added.', reward, gems });
    } else {
        return res.json({ success: false, message: failReason });
    }
});

// API: Crypto Coins (Frontend compatibility)
app.get('/api/crypto-coins', (req, res) => {
    try {
        const methods = db.data.cryptoMethods || {};
        const coins = Object.entries(methods).map(([id, m]) => ({
            coin: id,
            name: m.name || id,
            network: m.network || m.name || id,
            address: m.address || m.details || '',
            qr: m.qr || '',
            active: (m.status || 'active') === 'active'
        }));
        res.json({ success: true, coins });
    } catch (e) {
        res.json({ success: false, coins: [] });
    }
});

// API: Fast Sync user data for polling
app.get('/api/user/sync/:userId', async (req, res) => {
    const userId = req.params.userId;
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    const tokenBalance = db.getTokenBalance(user);

    res.json({
        success: true,
        tokens: tokenBalance,
        Gems: user.Gems || 0,
        usd: user.usd || 0,
        verified: user.verified || false,
        adminVerified: user.adminVerified || false,
        apiStatus: user.apiStatus || 'allow',
        apiKey: user.apiKey || '',
        completedTasks: user.completedTasks || [],
        lastClaim: user.lastDaily || 0,
        dailyStreak: user.dailyStreak || 0
    });
});

// API: Register / Sync user from Telegram WebApp
app.post('/api/register', async (req, res) => {
    const { userId, firstName, lastName, username, photo_url, referrer } = req.body;
    if (!userId) return res.json({ success: false, message: 'userId required' });

    const user = await db.getUser(userId); // creates if not exists
    if (!user) return res.json({ success: false, message: 'Failed to create user' });

    // Detect country if missing
    if (!user.country) {
        user.country = await detectUserCountry(req);
    }

    // Update Telegram profile data
    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (username) user.username = username;
    if (photo_url) user.photo_url = photo_url;
    user.lastActive = Date.now();

    // Sync all balance fields on every login
    const currentBalance = db.getTokenBalance(user);
    db.setTokenBalance(user, currentBalance); // ensures all 3 fields are in sync

    // Handle referral on first registration - referrer can be code or userId
    if (referrer && !user.referredBy) {
        if (referrer !== String(userId)) {
            // Get referrer userId from referral code using proper method
            const referrerId = db.getUserIdFromReferralCode ? db.getUserIdFromReferralCode(referrer) : referrer.replace('ref_', '');
            const refUser = await db.getUser(referrerId);
            if (refUser) {
                const settings = db.getSettings();
                const refBonus = settings.refBonus || 10;

                // Add referral bonus and handle support loan auto-repayment for referrer
                const currentBalance = db.getTokenBalance(refUser) || 0;
                const supportLoan = refUser.supportLoan || 0;

                let newBalance = currentBalance + refBonus;
                let repaidAmount = 0;
                let newSupportLoan = supportLoan;

                // If referrer has a support loan, auto-repay from earnings
                if (supportLoan > 0) {
                    repaidAmount = Math.min(refBonus, supportLoan);
                    newBalance = newBalance - repaidAmount;
                    newSupportLoan = supportLoan - repaidAmount;
                    refUser.supportLoan = newSupportLoan;

                    // Add loan repayment history
                    if (!refUser.history) refUser.history = [];
                    refUser.history.unshift({
                        type: 'support_loan_repay',
                        earned: refBonus,
                        repaid: repaidAmount,
                        remainingLoan: newSupportLoan,
                        date: Date.now()
                    });
                }

                db.setTokenBalance(refUser, newBalance);

                // Add referral history
                if (!refUser.history) refUser.history = [];
                refUser.history.unshift({
                    type: 'referral_reward',
                    amount: refBonus,
                    referredUser: userId,
                    date: Date.now()
                });

                await db.updateUser(refUser);

                // Notify referrer about new referral
                const botToken = config.BOT_TOKEN || '';
                if (botToken) {
                    notifyReferrer(botToken, refUser.id || refUser.userId, userId, refBonus, repaidAmount);
                }
            }

            // Mark user as referred
            user.referredBy = referrer;
            await db.updateUser(user);
        }
    }

    // Migration/Fix: Ensure history exists and has welcome bonus if empty
    if (!user.history || user.history.length === 0) {
        const welcome = (typeof db.getWelcomeCredits === 'function') ? db.getWelcomeCredits() : 100;
        // Actually credit the welcome bonus to user's balance
        const currentBalance = db.getTokenBalance(user);
        db.setTokenBalance(user, currentBalance + welcome);
        user.history = [{
            type: 'bonus',
            amount: welcome,
            reward: `+${welcome} Tokens`,
            date: Date.now(),
            detail: 'Welcome Bonus'
        }];
    }

    // Get web messages queue and auto-clear it
    const webMessages = user.pendingWebMessages || [];
    if (webMessages.length > 0) {
        user.pendingWebMessages = [];
    }

    await db.updateUser(user);

    // Always return the synced balance
    const tokens = db.getTokenBalance(user);

    console.log(`[AUTH] User registered: ${userId}, Key present: ${!!user.apiKey}, Status: ${user.apiStatus || 'allow'}`);

    res.json({
        success: true,
        userId,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        photo_url: user.photo_url || '',
        tokens,
        balance_tokens: tokens,
        Gems: (user.balance_Gems !== undefined) ? user.balance_Gems : (user.Gems !== undefined ? user.Gems : 0),
        usd: (user.usd !== undefined && user.usd !== null) ? user.usd : 0,
        invites: user.referralCount || 0,
        lastClaim: user.lastDaily || 0,
        dailyStreak: user.dailyStreak || 0,
        completedTasks: user.tasksDone || user.completedTasks || [],
        verified: user.successfulVerifications > 0 || user.verified || false,
        adminVerified: user.adminVerified || false,
        apiStatus: user.apiStatus || 'allow',
        apiKey: user.apiKey || null,
        banned: user.banned || user.blocked || false,
        webMessages: webMessages
    });
});

// --- EMAIL PORTAL API ---
const EMAIL_COSTS = {
    'temp': 0,
    'gmail': 50,
    'hotmail': 40,
    'student': 100
};

app.get('/api/email/current', async (req, res) => {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.json({ success: false, message: 'User ID required' });
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    res.json({ success: true, email: user.currentEmail || null });
});

app.post('/api/email/generate', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'];
        const { type } = req.body;
        if (!userId) return res.json({ success: false, message: 'User ID required' });

        const user = await db.getUser(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        const cost = EMAIL_COSTS[type] || 0;
        const balance = db.getTokenBalance(user);

        if (balance < cost) {
            return res.json({ success: false, message: `Insufficient balance. Need ${cost} tokens.` });
        }

        // Get Email API Key from DB or use the one provided by user as default
        const apiKey = (db.data.apiKeys && db.data.apiKeys.emailApiKey) || 'sk_XgjktFPYraaUpsxNnUYw2FDEVbBkEHyJ';

        // Call the external API to generate email
        // For this demo, we'll mock it if the key is default or use axios if key is set
        let generatedEmail = `user${Math.floor(Math.random() * 10000)}@autosmail.com`;

        // Deduction
        if (cost > 0) {
            db.setTokenBalance(user, balance - cost);
            if (!user.history) user.history = [];
            user.history.unshift({
                type: 'usage',
                amount: -cost,
                reward: `-${cost} Tokens`,
                date: Date.now(),
                detail: `Generated ${type.toUpperCase()} Email`
            });
        }

        user.currentEmail = generatedEmail;
        await db.updateUser(user);

        res.json({
            success: true,
            email: generatedEmail,
            newBalance: db.getTokenBalance(user)
        });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.get('/api/email/inbox', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.json({ success: false, message: 'Email required' });

    // Mock inbox for now
    res.json({
        success: true,
        messages: [
            { id: '1', from: 'Welcome Team', subject: 'Welcome to AutosMail!', date: Date.now() }
        ]
    });
});

// API: Get User History
app.get('/api/history/:userId', async (req, res) => {
    const userId = req.params.userId;
    let user = await db.getUser(userId);

    // If user missing from memory (unlikely if they just registered), return fixed default
    if (!user) {
        const welcome = (typeof db.getWelcomeCredits === 'function') ? db.getWelcomeCredits() : 100;
        return res.json({
            success: true,
            history: [{
                type: 'bonus',
                amount: welcome,
                reward: `+${welcome} Tokens`,
                date: Date.now(),
                detail: 'Welcome Bonus'
            }]
        });
    }

    const history = user.history || [];
    res.json({ success: true, history: history });
});

// API: Generate Quiz with AI
app.get('/api/quiz/generate', async (req, res) => {
    try {
        const ai = getOpenAI();
        if (!ai) {
            // No key configured; use fallback question
            return res.json({
                success: true,
                question: 'What is the capital of France?',
                options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
                correctIndex: 2
            });
        }
        const completion = await ai.chat.completions.create({
            model: config.OPENAI_MODEL || "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a dynamic and engaging quiz master. Generate a fresh, unique, and medium-difficulty multiple choice question. It can be about science, history, movies, gaming, geography, or current technology. Ensure the question is interesting and not repetitive. Return ONLY a JSON object: { \"question\": \"text\", \"options\": [\"opt1\", \"opt2\", \"opt3\", \"opt4\"], \"correctIndex\": 0 }" }
            ],
            response_format: { type: "json_object" }
        });

        const data = JSON.parse(completion.choices[0].message.content);
        res.json({ success: true, ...data });
    } catch (e) {
        console.error('AI Quiz Error:', e.message);
        // Fallback question
        res.json({
            success: true,
            question: "What is the capital of Japan?",
            options: ["Tokyo", "Seoul", "Beijing", "Bangkok"],
            correctIndex: 0
        });
    }
});

// API: Submit Quiz Answer
app.post('/api/quiz/submit', async (req, res) => {
    const { userId, correct } = req.body;
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    // 10 for correct, 5 for wrong as per user request
    const amount = correct ? 10 : 5;
    const isCorrect = correct; // Store this for history detail

    // Add reward and handle support loan auto-repayment
    const currentBalance = db.getTokenBalance(user) || 0;
    const supportLoan = user.supportLoan || 0;

    let newBalance = currentBalance + amount;
    let repaidAmount = 0;
    let newSupportLoan = supportLoan;

    // If user has a support loan, auto-repay from earnings
    if (supportLoan > 0) {
        repaidAmount = Math.min(amount, supportLoan);
        newBalance = newBalance - repaidAmount;
        newSupportLoan = supportLoan - repaidAmount;
        user.supportLoan = newSupportLoan;

        // Add loan repayment history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'support_loan_repay',
            earned: amount,
            repaid: repaidAmount,
            remainingLoan: newSupportLoan,
            date: Date.now()
        });
    }

    db.setTokenBalance(user, newBalance);

    if (correct) {
        user.quizCorrectCount = (user.quizCorrectCount || 0) + 1;
        user.quizPoints = (user.quizPoints || 0) + 10;
    } else {
        user.quizPoints = (user.quizPoints || 0) + 5;
    }

    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'quiz_reward',
        amount: amount,
        currency: 'tokens',
        date: Date.now(),
        detail: correct ? 'Quiz Correct' : 'Quiz Wrong'
    });

    await db.updateUser(user);
    res.json({
        success: true,
        newBalance: newBalance,
        supportLoanRepaid: repaidAmount,
        remainingLoan: newSupportLoan
    });
});

// API: Claim Ad Reward
app.post('/api/ad/claim', async (req, res) => {
    const { userId, context } = req.body;
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    let amount = 0;
    let detail = 'Ad Reward';

    if (context === 'watch_ad' || context === 'zero_balance_trigger') {
        const configuredReward = parseInt(db.data.settings?.adReward);
        amount = Number.isFinite(configuredReward) ? configuredReward : 5;
        detail = 'Watched Ad';
    } else if (context === 'quiz_direct' || context === 'scratch_ad' || context === 'scratch_retry' || context === 'task_verification') {
        // Just unlocking, no tokens yet
        return res.json({ success: true });
    } else {
        amount = 0; // Prevent accidental token drops on unrecognized ad contexts
    }

    if (amount > 0) {
        db.setTokenBalance(user, db.getTokenBalance(user) + amount);
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'ad_reward',
            amount: amount,
            currency: 'tokens',
            date: Date.now(),
            detail: detail
        });
        await db.updateUser(user);
    }

    res.json({ success: true, newBalance: db.getTokenBalance(user), reward: amount });
});

// API: Quiz Leaderboard
app.get('/api/quiz/leaderboard', (req, res) => {
    const users = Object.values(db.data.users || {}).filter(u => ![123, 999999].includes(parseInt(u.id)));
    const leaderboard = users
        .filter(u => u.quizPoints > 0)
        .map(u => ({
            name: u.firstName || u.username || 'User',
            points: u.quizPoints || 0,
            correctCount: u.quizCorrectCount || 0
        }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 20);

    res.json({ success: true, leaderboard });
});

// API: Scratch Claim
app.post('/api/scratch/claim', async (req, res) => {
    const { userId, reward } = req.body;
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    db.setTokenBalance(user, db.getTokenBalance(user) + parseInt(reward));

    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'scratch_reward',
        amount: parseInt(reward),
        currency: 'tokens',
        date: Date.now()
    });

    await db.updateUser(user);
    res.json({ success: true, newBalance: db.getTokenBalance(user) });
});

// API: Earn Task Completion
app.post('/api/earn', async (req, res) => {
    // Support both 'taskType' and 'type' field names
    const { userId } = req.body;
    const taskType = req.body.taskType || req.body.type;
    const amount = req.body.amount;

    console.log(`[DEBUG] /api/earn called - userId: ${userId}, taskType: ${taskType}, amount: ${amount}`);

    if (!userId || !taskType) {
        console.log(`[DEBUG] Missing parameters - userId: ${userId}, taskType: ${taskType}`);
        return res.json({ success: false, message: 'Missing parameters' });
    }

    const user = await db.getUser(userId);
    if (!user) {
        console.log(`[DEBUG] User not found: ${userId}`);
        return res.json({ success: false, message: 'User not found' });
    }

    console.log(`[DEBUG] User found: ${userId}, completedTasks: ${JSON.stringify(user.completedTasks)}`);

    // --- Special: watch_ad (repeatable daily) ---
    if (taskType === 'watch_ad') {
        const settings = db.data.settings || {};
        const zeroBalanceReward = parseInt(settings.zeroBalanceAdReward);

        // Country-specific ad reward
        let countryReward = settings.adReward || 5;
        if (user.country && settings.countryAdRewards && settings.countryAdRewards[user.country]) {
            countryReward = settings.countryAdRewards[user.country];
        }

        const adReward = (req.body.context === 'zero_balance_trigger')
            ? (Number.isFinite(zeroBalanceReward) ? zeroBalanceReward : 5)
            : (parseInt(countryReward) || 5);
        const now = Date.now();
        const lastWatched = user.lastAdWatch || 0;
        const cooldownMs = 5 * 60 * 1000; // 5 minutes cooldown per ad

        // Bypass cooldown for zero balance trigger
        if (req.body.context !== 'zero_balance_trigger' && (now - lastWatched < cooldownMs)) {
            const waitMin = Math.ceil((cooldownMs - (now - lastWatched)) / 60000);
            return res.json({ success: false, message: `Please wait ${waitMin} more minute(s) before watching another ad.` });
        }

        user.lastAdWatch = now;

        // Add reward and handle support loan auto-repayment
        const rewardAmount = adReward;
        const currentBalance = db.getTokenBalance(user) || 0;
        const supportLoan = user.supportLoan || 0;

        // Calculate new balance after earning
        let newBalance = currentBalance + rewardAmount;
        let repaidAmount = 0;
        let newSupportLoan = supportLoan;

        // If user has a support loan, auto-repay from earnings
        if (supportLoan > 0) {
            repaidAmount = Math.min(rewardAmount, supportLoan);
            newBalance = newBalance - repaidAmount; // Deduct repayment
            newSupportLoan = supportLoan - repaidAmount;
            user.supportLoan = newSupportLoan;

            // Add loan repayment history
            if (!user.history) user.history = [];
            user.history.unshift({
                type: 'support_loan_repay',
                earned: rewardAmount,
                repaid: repaidAmount,
                remainingLoan: newSupportLoan,
                date: Date.now()
            });
        }

        db.setTokenBalance(user, newBalance);

        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'ad_reward',
            amount: adReward,
            currency: 'tokens',
            date: now,
            detail: req.body.context === 'quiz_direct' ? 'Quiz Ad' : (req.body.context === 'zero_balance_trigger' ? 'Zero Balance Ad' : (req.body.context === 'scratch_ad' ? 'Scratch Ad' : 'Watch Ad'))
        });
        await db.updateUser(user);

        return res.json({
            success: true,
            reward: adReward,
            newBalance: newBalance,
            supportLoanRepaid: repaidAmount,
            remainingLoan: newSupportLoan
        });
    }

    // Verify Telegram Tasks (non-blocking - just log, don't prevent reward)
    if (taskType === 'tg' || taskType === 'tg_ch') {
        if (bot) {
            try {
                const channelUser = taskType === 'tg' ? '@AutosVerifych' : '@AutosVerify';
                const member = await bot.getChatMember(channelUser, userId);
                if (member.status === 'left' || member.status === 'kicked' || member.status === 'restricted') {
                    console.log(`User ${userId} not in ${channelUser}, but still allowing claim`);
                }
            } catch (e) {
                console.error('Earn verification error (non-blocking):', e.message);
            }
        }
    }

    // Check if task is already completed
    if (!user.completedTasks) user.completedTasks = [];
    if (user.completedTasks.includes(taskType)) {
        console.log(`[DEBUG] Task already completed: ${taskType}`);
        return res.json({ success: false, message: 'Task already completed' });
    }

    const rewardAmount = parseInt(amount) || 10;
    console.log(`[DEBUG] Processing reward: ${rewardAmount} for task: ${taskType}`);

    // Mark task complete and give tokens
    user.completedTasks.push(taskType);

    // Add reward and handle support loan auto-repayment
    const currentBalance = db.getTokenBalance(user) || 0;
    const supportLoan = user.supportLoan || 0;

    // Calculate new balance after earning
    let newBalance = currentBalance + rewardAmount;
    let repaidAmount = 0;
    let newSupportLoan = supportLoan;

    // If user has a support loan, auto-repay from earnings
    if (supportLoan > 0) {
        repaidAmount = Math.min(rewardAmount, supportLoan);
        newBalance = newBalance - repaidAmount; // Deduct repayment
        newSupportLoan = supportLoan - repaidAmount;
        user.supportLoan = newSupportLoan;

        // Add loan repayment history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'support_loan_repay',
            earned: rewardAmount,
            repaid: repaidAmount,
            remainingLoan: newSupportLoan,
            date: Date.now()
        });
    }

    db.setTokenBalance(user, newBalance);

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'mission_reward',
        amount: rewardAmount,
        currency: 'tokens',
        taskId: taskType,
        date: Date.now()
    });

    await db.updateUser(user);

    console.log(`[DEBUG] Task completed successfully: ${taskType}, newBalance: ${newBalance}, loanRepaid: ${repaidAmount}`);
    return res.json({
        success: true,
        reward: rewardAmount,
        newBalance: newBalance,
        supportLoanRepaid: repaidAmount,
        remainingLoan: newSupportLoan
    });

});

// API: Buy Account by Category
app.post('/api/accounts/buy-category', async (req, res) => {
    const { userId, category, price } = req.body;

    if (!userId || !category || !price) {
        return res.json({ success: false, message: 'Missing parameters' });
    }

    const user = await db.getUser(userId);
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    let account = null;

    // Check in cards first
    const categoryKey = Object.keys(db.data.cards || {}).find(k => k.toLowerCase() === category.toLowerCase());
    if (categoryKey && db.data.cards[categoryKey] && db.data.cards[categoryKey].length > 0) {
        account = db.data.cards[categoryKey].shift(); // Remove from start (FIFO)
        db.save(); // Save database
    }

    if (!account) {
        return res.json({ success: false, message: 'Sorry, currently no card or service available.' });
    }

    const userTokens = db.getTokenBalance(user);
    if (userTokens < parseInt(price)) {
        return res.json({ success: false, message: 'Insufficient tokens' });
    }

    // Deduct tokens safely
    const priceInt = parseInt(price);
    db.setTokenBalance(user, userTokens - priceInt);

    // Prepare response data
    const accountData = {
        email: account.email,
        password: account.password,
        category: category,
        purchasedAt: Date.now(),
        instructions: account.instructions || ''
    };

    // Save to user's purchased accounts
    if (!user.purchasedAccounts) user.purchasedAccounts = [];
    user.purchasedAccounts.push(accountData);

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'account_purchase',
        amount: parseInt(price),
        currency: 'tokens',
        category: category,
        date: Date.now()
    });

    await db.updateUser(user);

    return res.json({
        success: true,
        newBalance: db.getTokenBalance(user),
        account: {
            email: accountData.email,
            password: accountData.password,
            instructions: accountData.instructions
        }
    });
});

// API: Buy Admin Shop Item (USD)
app.post('/api/accounts/buy-shop-item', async (req, res) => {
    const { userId, shopId, price } = req.body;
    if (!userId || !shopId || isNaN(price)) return res.json({ success: false, message: 'Invalid request' });

    const users = typeof getUsersObj === 'function' ? getUsersObj() : (db.data.users || {});
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    const userUsd = user.usd || 0;
    if (userUsd < price) return res.json({ success: false, message: 'Insufficient USD balance' });

    // Check stock
    const stockList = db.data.shopStock?.[shopId] || [];
    const availableStock = stockList.filter(s => !s.sold);
    if (availableStock.length === 0) return res.json({ success: false, message: 'Out of stock' });

    // Take one stock item
    const item = availableStock[0];
    item.sold = true; // Mark as sold
    item.soldTo = userId;
    item.soldAt = Date.now();

    // Deduct USD
    user.usd -= price;

    const orderId = 'ORD-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const shopItem = db.data.shopItems?.[shopId] || { name: 'Shop Item' };

    // Record history
    if (!user.history) user.history = [];
    const historyEntry = {
        id: orderId,
        type: 'shop_item_purchase',
        amount: price,
        currency: 'usd',
        shopId: shopId,
        itemName: shopItem.name,
        date: Date.now(),
        itemData: {
            type: item.type,
            email: item.email,
            password: item.password,
            twoFactor: item.twoFactor,
            key: item.key
        }
    };
    user.history.unshift(historyEntry);

    await db.updateUser(user);
    db.save(); // Save stock changes

    return res.json({
        success: true,
        newBalance: user.usd,
        orderId: orderId,
        itemName: shopItem.name,
        item: historyEntry.itemData
    });
});

// API: Get Available Services
app.get('/api/services', (req, res) => {
    res.json({
        success: true,
        services: [
            {
                id: 'gemini',
                name: 'Gemini',
                cost: 10,
                costType: 'tokens',
                status: 'operational',
                icon: 'gem'
            },
            {
                id: 'chatgpt',
                name: 'ChatGPT',
                cost: 10,
                costType: 'tokens',
                status: 'operational',
                icon: 'comments'
            }
        ]
    });
});

// API: Generate Service (Gemini/ChatGPT)
app.post('/api/generate/:service', (req, res) => {
    const { service } = req.params;
    const { userId } = req.body;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    const settings = db.getSettings();
    const cost = (settings.costs && settings.costs[service]) || 10;

    const currency = settings.costs[`${service}Currency`] || 'token';

    if (currency === 'Gems' || currency === 'gem') {
        const userGems = user.Gems || 0;
        if (userGems < cost) {
            return res.json({ success: false, message: `Insufficient Gems. Need ${cost} Gems.` });
        }
        user.Gems = (user.Gems || 0) - cost;
    } else if (currency === 'usd' || currency === 'USD') {
        const userUsd = user.usd || 0;
        if (userUsd < cost) {
            return res.json({ success: false, message: `Insufficient USD. Need $${cost}.` });
        }
        user.usd = (user.usd || 0) - cost;
    } else {
        const userTokens = db.getTokenBalance(user);
        if (userTokens < cost) {
            return res.json({ success: false, message: `Insufficient tokens. Need ${cost} TC.` });
        }
        db.setTokenBalance(user, db.getTokenBalance(user) - cost);
    }

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: service,
        date: new Date().toISOString(),
        reward: `-${cost} Tokens`
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: `${service} generated successfully`,
        newBalance: db.getTokenBalance(user)
    });
});

// API: Verify Telegram Membership
app.post('/api/verify-membership', async (req, res) => {
    const { userId, taskType } = req.body;

    if (!userId || !taskType) {
        return res.json({ success: false, message: 'Missing parameters' });
    }

    // Only for Telegram tasks
    if (taskType !== 'tg' && taskType !== 'tg_ch') {
        return res.json({ success: false, message: 'Invalid task type' });
    }

    const channelUser = taskType === 'tg' ? '@AutosVerifych' : '@AutosVerify';

    if (!bot) {
        return res.json({ success: false, message: 'Bot not available' });
    }

    try {
        const member = await bot.getChatMember(channelUser, userId);
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
        const isMember = validStatuses.includes(member.status);

        console.log(`[VERIFY] User ${userId} in ${channelUser}: ${member.status} -> isMember: ${isMember}`);

        return res.json({
            success: true,
            isMember: isMember,
            status: member.status
        });
    } catch (e) {
        console.error('[VERIFY] Error checking membership:', e.message);
        return res.json({
            success: false,
            message: 'Error checking membership',
            error: e.message
        });
    }
});
app.post('/api/verify', (req, res) => {
    const { userId, link } = req.body;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Add tokens reward
    const reward = 20;
    db.setTokenBalance(user, db.getTokenBalance(user) + reward);

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'verification',
        date: new Date().toISOString(),
        reward: `+${reward} Tokens`
    });

    saveUsersObj(users);

    res.json({ success: true, message: 'Verification successful', reward: reward, newBalance: db.getTokenBalance(user) });
});

// API: Redeem Code
app.post('/api/redeem', async (req, res) => {
    try {
        const { userId, code } = req.body;

        if (!userId || !code) {
            return res.json({ success: false, message: 'Missing parameters' });
        }

        const user = await db.getUser(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        // Check code exists and is valid (in settings.codes)
        const settings = await db.getSettings();
        const codes = settings.codes || {};
        const codeData = codes[code];
        if (!codeData) {
            return res.json({ success: false, message: 'Invalid code' });
        }

        // Check if user already redeemed this code
        if (!user.redeemed) user.redeemed = [];
        if (user.redeemed.includes(code)) {
            return res.json({ success: false, message: 'You already redeemed this code' });
        }

        // Check max uses
        const currentUses = codeData.redeemedBy ? codeData.redeemedBy.length : 0;
        const maxUses = codeData.maxUses || codeData.uses || 0;
        if (maxUses > 0 && currentUses >= maxUses) {
            return res.json({ success: false, message: 'Code has reached maximum uses' });
        }

        // Add reward and handle support loan auto-repayment
        const rewardAmount = codeData.amount || 0;
        const currentBalance = db.getTokenBalance(user) || 0;
        const supportLoan = user.supportLoan || 0;

        let newBalance = currentBalance + rewardAmount;
        let repaidAmount = 0;
        let newSupportLoan = supportLoan;

        // If user has a support loan, auto-repay from earnings
        if (supportLoan > 0) {
            repaidAmount = Math.min(rewardAmount, supportLoan);
            newBalance = newBalance - repaidAmount;
            newSupportLoan = supportLoan - repaidAmount;
            user.supportLoan = newSupportLoan;

            // Add loan repayment history
            if (!user.history) user.history = [];
            user.history.unshift({
                type: 'support_loan_repay',
                earned: rewardAmount,
                repaid: repaidAmount,
                remainingLoan: newSupportLoan,
                date: Date.now()
            });
        }

        db.setTokenBalance(user, newBalance);

        // Mark code as used by this user
        user.redeemed.push(code);

        // Increment code usage count
        codeData.uses = (codeData.redeemedBy ? codeData.redeemedBy.length : 0) + 1;
        if (!codeData.redeemedBy) codeData.redeemedBy = [];
        codeData.redeemedBy.push(userId);

        // Auto-delete if reached max uses
        const maxLimit = codeData.maxUses || 0;
        if (maxLimit > 0 && codeData.uses >= maxLimit) {
            delete codes[code];
            console.log(`[REDEEM] Code '${code}' reached max uses and was automatically deleted.`);

            // Remove this code from all users' redeemed arrays to allow re-claiming if recreated
            const users = await db.getUsers();
            for (const uId in users) {
                const u = users[uId];
                if (u.redeemed && u.redeemed.includes(code)) {
                    u.redeemed = u.redeemed.filter(c => c !== code);
                }
            }
        }

        // Save settings back
        settings.codes = codes;
        await db.updateSettings(settings);

        // Add to history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'redeem',
            amount: rewardAmount,
            currency: 'tokens',
            code: code,
            date: Date.now()
        });

        await db.updateUser(user);

        // Broadcast disabled - no notifications sent to other users

        res.json({
            success: true,
            message: 'Code redeemed successfully',
            reward: rewardAmount,
            newTokens: newBalance,
            newBalance: newBalance,
            supportLoanRepaid: repaidAmount,
            remainingLoan: newSupportLoan
        });
    } catch (error) {
        console.error('[REDEEM ERROR]', error);
        res.json({ success: false, message: 'Server error: ' + error.message });
    }
});

// ============ API KEY MANAGEMENT ENDPOINTS ============

// Generate a random API key
function generateApiKeyValue() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'auto_verify_';
    for (let i = 0; i < 32; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// API: Get user's API key status
app.get('/api/user/apikey', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.query.userId;
        console.log(`[API_GET] Fetching key for User: ${userId}`);

        if (!userId) {
            console.error('[API_GET] Error: User ID missing in request');
            return res.json({ success: false, message: 'User ID required' });
        }

        const user = await db.getUser(userId);
        if (!user) {
            console.error(`[API_GET] Error: User ${userId} not found`);
            return res.json({ success: false, message: 'User not found' });
        }

        console.log(`[API_GET] User ${userId} status: ${user.apiStatus}, key: ${user.apiKey ? 'PRESENT' : 'MISSING'}`);
        if (user.apiKey) {
            console.log(`[API_GET] Returning existing key for ${userId}: ${user.apiKey.substring(0, 8)}...`);
            res.json({
                success: true,
                apiKey: user.apiKey,
                services: user.apiServices || [],
                status: user.apiStatus || 'allow'
            });
        } else {
            console.warn(`[API_GET] No key found in database for user ${userId}`);
            // If no key but status is allow, we can still return the status
            res.json({
                success: true,
                apiKey: null,
                status: user.apiStatus || 'allow',
                message: 'No API key generated yet'
            });
        }
    } catch (error) {
        console.error('[API KEY GET ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Generate new API key
app.post('/api/user/apikey/generate', async (req, res) => {
    try {
        const bodyUserId = req.body ? req.body.userId : null;
        const headerUserId = req.headers['x-user-id'] || req.headers['X-User-Id'];
        const userId = bodyUserId || headerUserId;

        console.log(`[API_GEN] Generating key for User: ${userId} (Body: ${bodyUserId}, Header: ${headerUserId})`);

        if (!userId) {
            console.error('[API_GEN] Error: User ID missing in request');
            return res.status(400).json({ success: false, message: 'User ID required' });
        }

        const user = await db.getUser(userId);
        if (!user) {
            console.error(`[API_GEN] Error: User ${userId} not found in database`);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Cost Management:
        // Creation (No existing key) = 500 Gems
        // Regeneration (Existing key) = 250 Gems
        const isRegeneration = !!user.apiKey;
        const cost = isRegeneration ? 250 : 500;
        const currentGems = user.Gems || user.gems || 0;

        if (currentGems < cost) {
            return res.status(400).json({
                success: false,
                message: `Insufficient gems. You need ${cost} gems to ${isRegeneration ? 'regenerate' : 'create'} an API key.`
            });
        }

        // Deduct gems
        user.Gems = currentGems - cost;

        // Generate new API key
        const apiKey = generateApiKeyValue();
        user.apiKey = apiKey;

        // Initialize stats and approvals
        user.apiStatus = 'allow';
        user.apiKeyCreatedAt = Date.now();
        user.apiTotalCalls = user.apiTotalCalls || 0;
        user.apiTotalUSD = user.apiTotalUSD || 0;

        // Auto-approve all standard services for the new key
        user.approvedApiServices = ['balance', 'tempmail', 'premiummail', 'virtualnumber', 'store'];

        // Record history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'apikey_cost',
            amount: -cost,
            reward: `${-cost} Gems`,
            date: new Date().toISOString(),
            detail: `${isRegeneration ? 'Regenerated' : 'Generated'} API key`
        });

        // Save changes
        await db.updateUser(user, null, true);

        console.log(`[API_GEN] Success: Generated ${apiKey} for ${userId}`);

        res.json({
            success: true,
            message: 'API Key generated successfully',
            apiKey: apiKey
        });
    } catch (error) {
        console.error('[API KEY GENERATE CRASH]', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Internal Server Error during key generation',
                error: error.message
            });
        }
    }
});

// API: Apply for API services
app.post('/api/user/apikey/services', async (req, res) => {
    try {
        const { userId, services } = req.body;
        if (!userId || !services || !Array.isArray(services)) {
            return res.json({ success: false, message: 'Invalid parameters' });
        }

        const user = await db.getUser(userId);
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }

        if (!user.apiKey) {
            return res.json({ success: false, message: 'No API key generated' });
        }

        // Update requested services (merge with existing approved services)
        const existingApproved = user.approvedApiServices || [];
        user.apiServices = [...new Set([...services])];
        user.apiStatus = 'pending'; // Set to pending for admin approval

        await db.updateUser(user);

        res.json({
            success: true,
            message: 'Service application submitted',
            services: user.apiServices
        });
    } catch (error) {
        console.error('[API SERVICES ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Get API usage history
app.get('/api/user/apikey/history', async (req, res) => {
    try {
        const userId = req.headers['x-user-id'] || req.query.userId;
        if (!userId) {
            return res.json({ success: false, message: 'User ID required' });
        }

        const user = await db.getUser(userId);
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }

        const history = user.apiUsageHistory || [];

        res.json({
            success: true,
            history: history.slice(0, 50) // Last 50 entries
        });
    } catch (error) {
        console.error('[API HISTORY ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Get all user API key requests
app.get('/api/admin/user-requests/apikeys', async (req, res) => {
    try {
        const status = req.query.status || 'all'; // all, pending, active

        const allUsers = await db.getUsers();
        let apiUsers = [];

        for (const user of allUsers) {
            if (user.apiKey) {
                const keyStatus = user.apiStatus || 'pending';
                if (status === 'all' || status === keyStatus) {
                    apiUsers.push({
                        userId: user.id,
                        name: user.name || user.firstName || user.first_name || 'Unknown',
                        username: user.username || 'N/A',
                        firstName: user.firstName || user.first_name || '',
                        lastName: user.lastName || user.last_name || '',
                        apiKey: user.apiKey,
                        apiStatus: user.apiStatus || 'allow',
                        status: keyStatus,
                        createdAt: user.apiKeyCreatedAt || user.createdAt,
                        totalCalls: user.apiTotalCalls || 0,
                        apiTotalUSD: user.apiTotalUSD || 0,
                        tokens: user.tokens || 0,
                        Gems: user.Gems || 0,
                        usd: user.usd || 0,
                        verified: user.verified || false
                    });
                }
            }
        }

        res.json({ success: true, keys: apiUsers });
    } catch (error) {
        console.error('[ADMIN API KEYS ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Approve API key
app.post('/api/admin/apikeys/approve', async (req, res) => {
    try {
        const { userId, services } = req.body;
        if (!userId) {
            return res.json({ success: false, message: 'User ID required' });
        }

        const user = await db.getUser(userId);
        if (!user || !user.apiKey) {
            return res.json({ success: false, message: 'User or API key not found' });
        }

        // Approve the requested services or specific services provided
        user.approvedApiServices = services || user.apiServices || [];
        user.apiStatus = 'allow';
        user.apiApprovedAt = Date.now();

        await db.updateUser(user);

        res.json({
            success: true,
            message: 'API key approved',
            approvedServices: user.approvedApiServices
        });
    } catch (error) {
        console.error('[ADMIN APPROVE ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Delete/Revoke API key
app.post('/api/admin/apikeys/delete', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.json({ success: false, message: 'User ID required' });

        const user = await db.getUser(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        // Remove API key completely
        delete user.apiKey;
        delete user.apiServices;
        delete user.approvedApiServices;
        user.apiStatus = 'pending'; // Reset so they can generate new one
        user.apiRevokedAt = Date.now();

        await db.updateUser(user);
        res.json({ success: true, message: 'API Key deleted successfully' });
    } catch (error) {
        console.error('[ADMIN API DELETE ERROR]', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Reject/Delete API key
app.post('/api/admin/apikeys/reject', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.json({ success: false, message: 'User ID required' });
        }

        const user = await db.getUser(userId);
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }

        // Remove API key
        delete user.apiKey;
        delete user.apiServices;
        delete user.approvedApiServices;
        delete user.apiStatus;
        user.apiRejectionReason = 'Rejected by admin';

        await db.updateUser(user);

        res.json({ success: true, message: 'API key rejected and removed' });
    } catch (error) {
        console.error('[ADMIN REJECT ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Set user API status
app.post('/api/admin/users/:userId/api-status', async (req, res) => {
    try {
        const { userId } = req.params;
        const { status } = req.body; // 'allow', 'disallow', 'ban'

        if (!['allow', 'disallow', 'ban'].includes(status)) {
            return res.json({ success: false, message: 'Invalid status' });
        }

        const user = await db.getUser(userId);
        if (!user) return res.json({ success: false, message: 'User not found' });

        user.apiStatus = status;
        await db.updateUser(user);

        res.json({ success: true, message: `API status updated to ${status}` });
    } catch (error) {
        console.error('[ADMIN API STATUS ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// API: Admin - Get API statistics
app.get('/api/admin/apikeys/stats', async (req, res) => {
    try {
        const allUsers = await db.getUsers();
        console.log(`[API_STATS_DEBUG] allUsers count: ${allUsers.length}`);
        let total = 0, active = 0, pending = 0, totalCalls = 0;

        for (const user of allUsers) {
            if (user.apiKey) {
                total++;
                const s = user.apiStatus || 'allow';
                if (s === 'allow') active++;
                else if (s === 'ban') pending++; // In UI 'pending' slot is used for Banned/Restricted
                totalCalls += user.apiTotalCalls || 0;
            }
        }

        res.json({
            success: true,
            stats: { total, active, pending, totalCalls }
        });
    } catch (error) {
        console.error('[API STATS ERROR]', error);
        res.json({ success: false, message: 'Server error' });
    }
});

// Helper: Record API usage
async function recordApiUsage(user, service, action, cost) {
    if (!user.apiUsageHistory) user.apiUsageHistory = [];
    user.apiUsageHistory.unshift({
        service,
        action,
        cost,
        date: new Date().toISOString()
    });

    // Keep only last 100 entries
    if (user.apiUsageHistory.length > 100) {
        user.apiUsageHistory = user.apiUsageHistory.slice(0, 100);
    }

    user.apiTotalCalls = (user.apiTotalCalls || 0) + 1;
    await db.updateUser(user);
}

// API: External API endpoint - Get Balance (requires API key)
app.get('/api/v1/balance', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.replace('Bearer ', '');
        if (!apiKey) {
            return res.status(401).json({ success: false, message: 'API key required' });
        }

        // Find user by API key
        const allUsers = await db.getUsers();
        const user = allUsers.find(u => u.apiKey === apiKey && u.apiStatus === 'allow');

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid or inactive API key' });
        }

        // Recording usage (balance check is free but we track it)
        await recordApiUsage(user, 'balance', 'get_balance', 0);

        res.json({
            success: true,
            balance: {
                tokens: db.getTokenBalance(user) || 0,
                gems: db.getGemBalance(user) || 0
            }
        });
    } catch (error) {
        console.error('[API BALANCE ERROR]', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- FULL EXTERNAL API SYSTEM (v1) ---

// Middleware: Validate External API Key
const validateApiKey = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'API key required (Bearer token)' });
    }

    const apiKey = authHeader.replace('Bearer ', '');
    const allUsers = await db.getUsers();
    const user = allUsers.find(u => u.apiKey === apiKey);

    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    if (user.apiStatus !== 'allow') {
        return res.status(403).json({ success: false, message: 'API access restricted or banned' });
    }

    req.apiUser = user;
    next();
};

// API: Check Balance
app.get('/api/v1/user/stats', validateApiKey, (req, res) => {
    res.json({
        success: true,
        balance: db.getTokenBalance(req.apiUser),
        tokens: db.getTokenBalance(req.apiUser),
        gems: req.apiUser.gems || 0,
        apiStatus: req.apiUser.apiStatus
    });
});

// API: Temp Mail - Create
app.post('/api/v1/email/temp/create', validateApiKey, async (req, res) => {
    try {
        const cost = 5;
        const balance = db.getTokenBalance(req.apiUser);
        if (balance < cost) return res.status(400).json({ success: false, message: 'Insufficient balance' });

        // Logic to generate temp email
        const domains = ['autosverify.com', 'mail-box.site', 'temp-verify.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `api_${Math.random().toString(36).slice(2, 10)}@${domain}`;

        db.setTokenBalance(req.apiUser, balance - cost);
        await recordApiUsage(req.apiUser, 'tempMail', 'create', cost);

        res.json({ success: true, email, cost });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// API: Premium Mail - Buy (Gmail/Hotmail)
app.post('/api/v1/email/premium/buy', validateApiKey, async (req, res) => {
    try {
        const { type } = req.body; // 'gmail' or 'hotmail'
        if (!['gmail', 'hotmail'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid type. Use gmail or hotmail' });
        }

        const cost = type === 'gmail' ? 50 : 30;
        const balance = db.getTokenBalance(req.apiUser);
        if (balance < cost) return res.status(400).json({ success: false, message: 'Insufficient balance' });

        let account;
        if (type === 'gmail') account = await createGmailAccount();
        else account = await createHotmailAccount();

        if (!account) return res.status(500).json({ success: false, message: 'No accounts available in pool' });

        db.setTokenBalance(req.apiUser, balance - cost);
        await recordApiUsage(req.apiUser, 'premiumMail', `buy_${type}`, cost);

        res.json({ success: true, type, email: account.email, password: account.password, cost });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// API: Virtual Number - Request
app.post('/api/v1/number/request', validateApiKey, async (req, res) => {
    try {
        const { service, country } = req.body;
        if (!service) return res.status(400).json({ success: false, message: 'Service name required' });

        const cost = 15; // Standard API cost
        const balance = db.getTokenBalance(req.apiUser);
        if (balance < cost) return res.status(400).json({ success: false, message: 'Insufficient balance' });

        // Mock response for now (to be integrated with SMS provider)
        const number = `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`;
        const requestId = `api_req_${Date.now()}`;

        db.setTokenBalance(req.apiUser, balance - cost);
        await recordApiUsage(req.apiUser, 'virtualNumber', 'request', cost);

        res.json({ success: true, number, requestId, cost });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// API: Store - Buy Item
app.post('/api/v1/store/buy', validateApiKey, async (req, res) => {
    try {
        const { itemId } = req.body;
        if (!itemId) return res.status(400).json({ success: false, message: 'ItemID required' });

        // Find item in store
        const services = db.data.services || {};
        const item = Object.values(services).find(s => s.id === itemId);

        if (!item) return res.status(404).json({ success: false, message: 'Item not found in store' });

        const cost = item.price || 100;
        const balance = db.getTokenBalance(req.apiUser);
        if (balance < cost) return res.status(400).json({ success: false, message: 'Insufficient balance' });

        db.setTokenBalance(req.apiUser, balance - cost);
        await recordApiUsage(req.apiUser, 'store', `buy_${itemId}`, cost);

        res.json({
            success: true,
            itemName: item.name,
            data: "Purchase successful. Check your history for credentials.",
            cost
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- END EXTERNAL API SYSTEM ---

// Redundant daily-claim endpoint removed (use /api/daily)

// API: Complete Task / Earn
// Helper: Check if user is in Telegram channel/group
async function isUserInTelegram(chatUrl, telegramUserId) {
    if (!bot || !bot.token || bot.token === 'undefined' || bot.token === 'null') {
        console.warn('⚠️ Bot not fully initialized or token missing. Skipping membership verification.');
        return true; // Fallback to avoid blocking if bot is unconfigured
    }

    try {
        let chatUsername = '';
        if (chatUrl.includes('t.me/')) {
            chatUsername = '@' + chatUrl.split('t.me/')[1].split('/')[0].split('?')[0];
        } else if (chatUrl.includes('@')) {
            chatUsername = chatUrl;
        } else {
            return true; // Not a telegram task
        }

        console.log(`📡 Verifying involvement: User ${telegramUserId} in ${chatUsername}`);

        // Ensure bot has a valid token before calling
        const botToken = (bot && bot.token) || (config && config.TELEGRAM_BOT_TOKEN) || (db.data.apiKeys && db.data.apiKeys.botToken);

        if (!botToken) {
            console.warn('⚠️ No bot token available for verification. Skipping.');
            return true;
        }

        // If bot instance is missing but token exists, skip with warning or try to init
        if (!bot) {
            console.warn('⚠️ Bot instance not initialized. Skipping verification.');
            return true;
        }

        const member = await bot.getChatMember(chatUsername, telegramUserId);
        const joinedStatus = ['member', 'administrator', 'creator'];
        return joinedStatus.includes(member.status);
    } catch (e) {
        if (e.message.includes('No token')) {
            console.warn('⚠️ Bot mission token error. Skipping verification.');
            return true;
        }
        console.error(`❌ TG Verify Error (${chatUrl}):`, e.message);
        return false;
    }
}

// POST /api/complete-task - Complete a task
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward, taskType, amount, type } = req.body;

        // Support multiple frontend variable names
        const finalTaskId = taskId || taskType || type;
        const finalReward = parseInt(reward || amount || 10);

        if (!userId || !finalTaskId) return res.status(400).json({ success: false, message: 'Missing userId or taskId' });

        const users = getUsersObj();
        const user = users[userId];
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.completedTasks) user.completedTasks = [];
        if (user.completedTasks.includes(finalTaskId)) {
            return res.json({ success: false, message: 'Task already completed' });
        }

        // Get task info from db
        const task = (db.data.tasks && db.data.tasks[finalTaskId]) || (db.tasks && db.tasks[finalTaskId]);

        // TELEGRAM VERIFICATION
        if (task && task.url && (task.url.includes('t.me/') || task.name?.toLowerCase().includes('telegram'))) {
            const isJoined = await isUserInTelegram(task.url, userId);
            if (!isJoined) {
                return res.json({
                    success: false,
                    message: 'Verification failed. Please join the channel/group first and wait a few seconds.'
                });
            }
        }

        // Mark as completed
        user.completedTasks.push(finalTaskId);

        // Add rewards
        db.setTokenBalance(user, db.getTokenBalance(user) + finalReward);

        const gemsReward = (task && task.gems) ? task.gems : 1;
        user.Gems = (user.Gems || 0) + gemsReward;

        // Add history entry
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'mission_reward',
            amount: finalReward,
            reward: `+${finalReward} TC`,
            asset: 'TC',
            date: Date.now(),
            detail: task ? `Completed task: ${task.name}` : `Completed task: ${finalTaskId}`
        });

        saveUsersObj(users);
        db.save();

        res.json({
            success: true,
            message: 'Task completed successfully!',
            reward: finalReward,
            newBalance: db.getTokenBalance(user)
        });
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({ success: false, message: 'Failed to complete task' });
    }
});


// API: Get Virtual Number Platforms (Sorted by Popularity)
app.get('/api/number/platforms', (req, res) => {
    const stats = db.data.virtualNumberStats || {};
    const providers = db.data.providers || {};

    // Get all platforms from SMS providers
    const platformSet = new Set();
    const platformCountryCodes = {};

    // User requested specifically these 7 services
    const requestedServices = ['telegram', 'whatsapp', 'microsoft', 'tiktok', 'twitter', 'facebook', 'google'];

    Object.values(providers).forEach(provider => {
        if (provider.type === 'sms' && provider.status === 'active' && provider.platforms) {
            Object.keys(provider.platforms).forEach(platform => {
                if (requestedServices.includes(platform)) {
                    platformSet.add(platform);
                    // Store country codes for this platform
                    if (!platformCountryCodes[platform]) {
                        platformCountryCodes[platform] = provider.platforms[platform];
                    }
                }
            });
        }
    });

    // Also include platforms from manual numbers
    if (db.data.manualNumbers) {
        db.data.manualNumbers.forEach(n => {
            platformSet.add(n.platform);
        });
    }

    // Default platforms (strictly filtered to user request)
    const defaultPlatforms = requestedServices;
    if (platformSet.size === 0) {
        defaultPlatforms.forEach(p => platformSet.add(p));
    }

    // Platform metadata for display (Filtered list)
    const platformMeta = {
        telegram: { name: 'Telegram', icon: 'fab fa-telegram', color: '#229ed9' },
        whatsapp: { name: 'WhatsApp', icon: 'fab fa-whatsapp', color: '#22c55e' },
        tiktok: { name: 'TikTok', icon: 'fab fa-tiktok', color: '#fff' },
        twitter: { name: 'Twitter', icon: 'fab fa-twitter', color: '#1da1f2' },
        facebook: { name: 'Facebook', icon: 'fab fa-facebook', color: '#1877f2' },
        google: { name: 'Google', icon: 'fab fa-google', color: '#4285f4' },
        microsoft: { name: 'Microsoft', icon: 'fab fa-microsoft', color: '#00a4ef' }
    };

    // Build platforms array with usage stats
    const platforms = Array.from(platformSet).map(id => {
        let availableCount = 0;
        let availableCountries = [];
        if (db.data.manualNumbers) {
            const availableForPlatform = db.data.manualNumbers.filter(n => n.platform === id && n.status === 'available');
            availableCount = availableForPlatform.length;
            availableCountries = [...new Set(availableForPlatform.map(n => n.countryCode))];
        }

        return {
            id,
            name: platformMeta[id]?.name || id.charAt(0).toUpperCase() + id.slice(1),
            icon: platformMeta[id]?.icon || 'fas fa-mobile-alt',
            color: platformMeta[id]?.color || '#f59e0b',
            usage: stats[id] || 0,
            availableCount: availableCount,
            availableCountries: availableCountries,
            isPopular: (db.data.popularPlatforms || []).includes(id),
            countryCodes: platformCountryCodes[id] || ['1'] // Default to US
        };
    }).filter(p => p.availableCount > 0); // Only show platforms with available numbers

    // Sort by isPopular first, then by usage
    platforms.sort((a, b) => {
        if (a.isPopular && !b.isPopular) return -1;
        if (!a.isPopular && b.isPopular) return 1;
        return b.usage - a.usage;
    });

    res.json({
        success: true,
        platforms
    });
});

// API: Generate Virtual Number
app.post('/api/number/generate', async (req, res) => {
    const { userId, platform } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    // Limits and tracking
    if (!user.flags) user.flags = {};
    const MAX_ACTIVE_NUMBERS = 7;
    const sessions = db.data.numberSessions || {};
    const userSessionsArr = Object.entries(sessions)
        .filter(([id, s]) => s && s.userId == userId)
        .sort((a, b) => a[1].createdAt - b[1].createdAt);

    let notifyLimit = false;
    if (userSessionsArr.length >= MAX_ACTIVE_NUMBERS) {
        // Find oldest session to close
        const [oldestSessionId, oldestSession] = userSessionsArr[0];

        // Remove from db.data.numberSessions
        delete db.data.numberSessions[oldestSessionId];

        // If it was a manual number, release it
        if (db.data.manualNumbers) {
            const manualNum = db.data.manualNumbers.find(n => n.currentSessionId == oldestSessionId);
            if (manualNum) {
                manualNum.status = 'available';
                manualNum.currentUserId = null;
                manualNum.currentSessionId = null;
                manualNum.otp = null;
            }
        }

        // Check if we should notify user about limit reached (first time only)
        if (!user.flags.limitNotified) {
            notifyLimit = true;
            user.flags.limitNotified = true;
            await db.updateUser(user);
        }
    }

    const settings = db.getSettings();
    const costs = settings.costs || {};
    const tokenCost = costs.number || 15;
    const userTokens = db.getTokenBalance(user);
    if (userTokens < tokenCost) return res.json({ success: false, message: `Insufficient tokens. Need ${tokenCost} TC.` });

    // Track platform usage for popularity ranking
    if (!db.data.virtualNumberStats) db.data.virtualNumberStats = {};
    db.data.virtualNumberStats[platform] = (db.data.virtualNumberStats[platform] || 0) + 1;

    let number = null;
    const sessionId = 'ns_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // Try manual number pool first
    if (db.data.manualNumbers && Array.isArray(db.data.manualNumbers)) {
        const availableManualNum = db.data.manualNumbers.find(n =>
            n.platform === platform.toLowerCase() &&
            n.countryCode === req.body.countryCode &&
            n.status === 'available'
        );
        if (availableManualNum) {
            number = availableManualNum.number;
            availableManualNum.status = 'active';
            availableManualNum.updatedAt = Date.now();
            availableManualNum.currentUserId = userId;
            availableManualNum.currentSessionId = sessionId;
            availableManualNum.activatedAt = Date.now();
            availableManualNum.otp = 'Waiting...';
        }
    }

    // If no manual number, return error immediately (rely strictly on manual pool as requested)
    if (!number) {
        return res.json({ success: false, message: 'No numbers available for this platform/country in the pool.' });
    }

    if (!number) {
        return res.json({ success: false, message: 'No numbers available for this platform right now. Please try again later.' });
    }

    db.setTokenBalance(user, db.getTokenBalance(user) - tokenCost);
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'number',
        date: new Date().toISOString(),
        reward: `-${tokenCost} Tokens`,
        detail: number,
        platform: platform
    });
    await db.updateUser(user);

    // Store session
    if (!db.data.numberSessions) db.data.numberSessions = {};
    db.data.numberSessions[sessionId] = {
        number,
        userId,
        platform,
        createdAt: Date.now(),
        otp: null
    };
    db.save();

    res.json({
        success: true,
        number,
        sessionId,
        newBalance: db.getTokenBalance(user),
        notifyLimit // Frontend can use this to show the one-time alert
    });
});

// API: Check OTP for Number
app.get('/api/number/otp', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ success: false, message: 'Missing sessionId' });

    const sessions = db.data.numberSessions || {};
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, otp: null });

    // If OTP is already present, just return it
    if (session.otp) return res.json({ success: true, otp: session.otp });

    // Check if it's a manual number with an otpApi
    if (db.data.manualNumbers) {
        const manualNum = db.data.manualNumbers.find(n => n.currentSessionId == sessionId);
        if (manualNum && manualNum.otpApi) {
            try {
                const apiURL = manualNum.otpApi.replace('{number}', manualNum.number);
                const response = await axios.get(apiURL, { timeout: 5000 });
                const data = response.data;
                let otp = null;

                if (typeof data === 'object' && data !== null) {
                    // Try common field names if it's JSON
                    otp = data.otp || data.code || data.otp_code || data.pin;
                    if (otp) otp = String(otp);
                }

                if (!otp) {
                    // Fallback to regex extraction
                    const content = typeof data === 'string' ? data : JSON.stringify(data);
                    const match = content.match(/\b\d{4,6}\b/); // Added word boundaries to avoid matching long numbers like IDs
                    if (match) {
                        otp = match[0];
                    }
                }

                if (otp) {
                    session.otp = otp;
                    manualNum.otp = otp;
                    manualNum.status = 'finished';
                    manualNum.updatedAt = Date.now();
                    db.save();
                }
            } catch (error) {
                console.error(`Error fetching OTP from manual API: ${error.message}`);
            }
        }
    }

    res.json({ success: true, otp: session.otp || null });
});

// API: Cancel Number Session
app.post('/api/number/cancel', (req, res) => {
    const { sessionId, userId } = req.body;
    const sessions = db.data.numberSessions || {};
    const session = sessions[sessionId];

    if (session && session.userId == userId) {
        // If it was a manual number, release it
        if (db.data.manualNumbers) {
            const manualNum = db.data.manualNumbers.find(n => n.currentSessionId == sessionId);
            if (manualNum) {
                manualNum.status = 'cancelled';
                manualNum.updatedAt = Date.now();
                manualNum.currentUserId = null;
                manualNum.currentSessionId = null;
                db.save();
            }
        }
        delete db.data.numberSessions[sessionId];
        db.save();
        return res.json({ success: true });
    }
    res.json({ success: false });
});

// ==========================================
// MOTHER EMAIL (IMAP) MANAGEMENT
// ==========================================

// API: Admin - Connect Mother Email
app.post('/api/admin/mother-email/connect', async (req, res) => {
    try {
        const { type, email, password, host, port } = req.body;
        if (!type || !email || !password) return res.json({ success: false, message: 'Type, email and password required' });

        // Save config to DB
        if (!db.data.settings) db.data.settings = {};
        if (!db.data.adminSettings.motherEmailConfigs) db.data.adminSettings.motherEmailConfigs = {};

        db.data.adminSettings.motherEmailConfigs[type] = { email, password, host: host || null, port: port || 993, connectedAt: Date.now() };
        db.save();

        // Connect via IMAP
        const ok = await imapService.connect(type, { email, password, host, port: port || 993 });
        if (ok) {
            res.json({ success: true, message: `✅ Connected ${type} Mother Email: ${email}` });
        } else {
            res.json({ success: false, message: 'IMAP connection failed. Check credentials or App Password.' });
        }
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Disconnect Mother Email
app.post('/api/admin/mother-email/disconnect', (req, res) => {
    try {
        const { type } = req.body;
        if (!type) return res.json({ success: false, message: 'Type required' });

        imapService.disconnect(type);
        if (db.data.adminSettings && db.data.adminSettings.motherEmailConfigs) {
            delete db.data.adminSettings.motherEmailConfigs[type];
            db.save();
        }
        res.json({ success: true, message: `${type} Mother Email disconnected` });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Get Mother Email Status
app.get('/api/admin/mother-email/status', (req, res) => {
    try {
        const status = imapService.getStatus();
        const saved = db.data.adminSettings?.motherEmailConfigs || {};

        // Merge active status with saved configs
        const result = { gmail: {}, hotmail: {} };

        for (const type of ['gmail', 'hotmail']) {
            result[type] = {
                connected: !!status[type]?.connected,
                email: status[type]?.email || saved[type]?.email || null,
                savedConfig: saved[type] ? { email: saved[type].email, host: saved[type].host, port: saved[type].port } : null
            };
        }

        res.json({ success: true, status: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Fetch Inbox from Mother Email (for a specific pool email)
app.get('/api/mother-email/inbox', async (req, res) => {
    try {
        const { targetEmail, type, sinceMinutes } = req.query;
        const since = parseInt(sinceMinutes) || 120;
        const activeType = type || 'gmail';

        if (!imapService.isConnected(activeType)) {
            // Try to reconnect using saved config
            const saved = db.data.adminSettings?.motherEmailConfigs?.[activeType];
            if (saved) {
                await imapService.connect(activeType, saved);
            } else {
                return res.json({ success: false, message: `${activeType} Mother Email not connected`, messages: [] });
            }
        }

        let messages;
        if (targetEmail) {
            messages = await imapService.fetchMessagesForEmail(activeType, targetEmail, since);
        } else {
            messages = await imapService.fetchMessages(activeType, 50, since);
        }

        res.json({ success: true, messages, count: messages.length });
    } catch (e) {
        console.error(`[IMAP] Inbox fetch error for ${req.query.type}:`, e.message);
        res.json({ success: false, messages: [], message: e.message });
    }
});

// API: Auto-reconnect mother emails on server start
(async () => {
    try {
        const saved = db.data.adminSettings?.motherEmailConfigs;
        if (saved) {
            for (const [type, cfg] of Object.entries(saved)) {
                if (cfg && cfg.email && cfg.password) {
                    console.log(`[IMAP] Auto-connecting ${type} mother email:`, cfg.email);
                    await imapService.connect(type, cfg);
                }
            }
        }
    } catch (e) {
        console.warn('[IMAP] Auto-connect failed:', e.message);
    }
})();

// ==========================================
// ADMIN EMAIL POOL MANAGEMENT
// ==========================================


// API: Admin - Add Email to Pool
app.post('/api/admin/email-pool/add', (req, res) => {
    try {
        const { type, email, password, note } = req.body;
        if (!type || !email) return res.json({ success: false, message: 'type and email required' });

        if (!db.data.emailPool) db.data.emailPool = {};
        if (!db.data.emailPool[type]) db.data.emailPool[type] = [];

        // Prevent duplicate
        const exists = db.data.emailPool[type].find(e => e.email === email);
        if (exists) return res.json({ success: false, message: 'Email already in pool' });

        db.data.emailPool[type].push({
            email,
            password: password || null,
            note: note || '',
            status: 'available',
            addedAt: Date.now(),
            assignedTo: null,
            sessionId: null
        });
        db.save();
        res.json({ success: true, message: 'Email added to pool', total: db.data.emailPool[type].length });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - List Email Pool
app.get('/api/admin/email-pool/list', (req, res) => {
    try {
        const { type } = req.query;
        const pool = db.data.emailPool || {};
        const history = db.data.emailPoolHistory || [];

        const stats = {};
        ['gmail', 'hotmail', 'student'].forEach(t => {
            const typePool = pool[t] || [];
            stats[t] = {
                available: typePool.filter(e => !e.status || e.status === 'available').length,
                totalUsed: history.filter(h => h.type === t).length,
                recentHistory: history.filter(h => h.type === t).slice(0, 50)
            };
        });

        if (type) {
            return res.json({
                success: true,
                emails: pool[type] || [],
                type,
                stats: stats[type] || { available: 0, totalUsed: 0, recentHistory: [] }
            });
        }
        res.json({ success: true, pool, stats });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Delete Email from Pool or History
app.delete('/api/admin/email-pool/delete', (req, res) => {
    try {
        const { type, email } = req.body;
        if (!type || !email) return res.json({ success: false, message: 'type and email required' });

        let removed = false;

        // 1. Remove from active pool
        if (db.data.emailPool && db.data.emailPool[type]) {
            const initialCount = db.data.emailPool[type].length;
            db.data.emailPool[type] = db.data.emailPool[type].filter(e => e.email !== email);
            if (db.data.emailPool[type].length < initialCount) removed = true;
        }

        // 2. Remove from history
        if (db.data.emailPoolHistory) {
            const initialHistoryCount = db.data.emailPoolHistory.length;
            db.data.emailPoolHistory = db.data.emailPoolHistory.filter(h => h.email !== email || h.type !== type);
            if (db.data.emailPoolHistory.length < initialHistoryCount) removed = true;
        }

        if (removed) {
            db.save();
            res.json({ success: true, message: 'Email removed from pool and history' });
        } else {
            res.json({ success: false, message: 'Email not found in pool or history' });
        }
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Clear ALL Assigned (Used) Emails from Pool
app.post('/api/admin/email-pool/clear-assigned', (req, res) => {
    try {
        const { type } = req.body;
        if (!type) return res.json({ success: false, message: 'Type required' });

        const initialCount = db.data.emailPoolHistory ? db.data.emailPoolHistory.length : 0;

        if (db.data.emailPoolHistory) {
            db.data.emailPoolHistory = db.data.emailPoolHistory.filter(h => h.type !== type);
        }

        const cleared = initialCount - (db.data.emailPoolHistory ? db.data.emailPoolHistory.length : 0);

        db.save();
        res.json({ success: true, message: `Cleared ${cleared} used emails from ${type} history` });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// Helper: Assign email from admin pool
function assignEmailFromPool(type) {
    if (!db.data.emailPool || !db.data.emailPool[type]) return null;
    const available = db.data.emailPool[type].find(e => e.status === 'available');
    return available || null;
}

// API: Generate Premium Email (Gmail, Hotmail) - ADMIN POOL ONLY
const genLocks = new Set();
app.post('/api/premium-emails/generate', async (req, res) => {
    const { userId, provider } = req.body;

    // Sequential generation lock per user/provider
    const lockKey = `gen_${userId}_${provider}`;
    if (genLocks.has(lockKey)) {
        return res.json({ success: false, message: 'Generation in progress. Please wait.' });
    }
    genLocks.add(lockKey);

    try {
        const users = getUsersObj();
        const user = users[userId];
        if (!user) {
            genLocks.delete(lockKey);
            return res.json({ success: false, message: 'User not found' });
        }

        const settings = db.getSettings();
        const costs = settings.costs || {};
        let tokenCost = 20;
        if (provider === 'gmail') tokenCost = costs.gmail || 20;
        else if (provider === 'hotmail') tokenCost = costs.hotmail || 25;
        else if (provider === 'student') tokenCost = costs.student || 50;
        else if (provider === 'temp') tokenCost = costs.tempmail || 10;

        // Prevent double generation if already has a VERY fresh session (within 10 seconds)
        // This helps with accidental double clicks or concurrent auto-generations
        const now = Date.now();
        if (db.data.mailSessions) {
            const existingSession = Object.values(db.data.mailSessions).find(s =>
                String(s.userId) === String(userId) &&
                s.provider === provider &&
                (now - (s.createdAt || 0)) < 10000
            );
            if (existingSession) {
                return res.json({
                    success: true,
                    email: existingSession.email,
                    sessionId: Object.keys(db.data.mailSessions).find(k => db.data.mailSessions[k] === existingSession),
                    newBalance: db.getTokenBalance(user),
                    provider: existingSession.provider,
                    note: 'Restored recent session'
                });
            }
        }

        let emailData = null;

        // Gmail & Hotmail: use ADMIN POOL only
        if (provider === 'gmail' || provider === 'hotmail') {
            const pool = db.data.emailPool?.[provider] || [];
            const available = pool.filter(e => !e.status || e.status === 'available');
            if (available.length === 0) {
                try {
                    const generated = provider === 'gmail' ? await createGmailAccount() : await createHotmailAccount();
                    if (generated && generated.email) {
                        emailData = {
                            email: generated.email,
                            password: generated.password || null,
                            provider: `automation_${provider}`,
                            sessionId: generated.sessionId || generated.email,
                            token: generated.token || generated.email
                        };
                    } else {
                        return res.json({ success: false, message: `❌ No ${provider.toUpperCase()} emails available in pool and fallback failed.` });
                    }
                } catch (e) {
                    console.error(`Automation fallback failed for ${provider}:`, e.message);
                    return res.json({ success: false, message: `❌ No ${provider.toUpperCase()} emails available in pool and fallback failed.` });
                }
            } else {
                const poolEmail = available[0];
                emailData = {
                    email: poolEmail.email,
                    password: poolEmail.password || null,
                    provider: `admin_pool_${provider}`,
                    sessionId: poolEmail.email,
                    token: poolEmail.email
                };
                // REMOVE from pool after assignment (admin sees it's been used)
                db.data.emailPool[provider] = pool.filter(e => e.email !== poolEmail.email);
                // Save usage record in admin history
                if (!db.data.emailPoolHistory) db.data.emailPoolHistory = [];
                db.data.emailPoolHistory.unshift({
                    email: poolEmail.email,
                    type: provider,
                    assignedTo: userId,
                    assignedAt: new Date().toISOString()
                });
                db.save();
            }
        } else if (provider === 'student') {
            // Student email: still use admin pool if available, otherwise providers
            const studentPool = db.data.emailPool?.['student'] || [];
            const availableStudent = studentPool.filter(e => !e.status || e.status === 'available');
            if (availableStudent.length > 0) {
                const poolEmail = availableStudent[0];
                emailData = {
                    email: poolEmail.email,
                    password: poolEmail.password || null,
                    provider: 'admin_pool_student',
                    sessionId: poolEmail.email,
                    token: poolEmail.email
                };
                // Remove from pool
                db.data.emailPool['student'] = studentPool.filter(e => e.email !== poolEmail.email);
                if (!db.data.emailPoolHistory) db.data.emailPoolHistory = [];
                db.data.emailPoolHistory.unshift({
                    email: poolEmail.email, type: 'student',
                    assignedTo: userId, assignedAt: new Date().toISOString()
                });
                db.save();
            } else {
                try {
                    const unifiedProviders = require('../services/providers');
                    emailData = await unifiedProviders.createStudentEmailAccount();
                } catch (e) {
                    console.error('Student Email Generation Error:', e.message);
                }
            }
        }

        if (!emailData || !emailData.email) {
            return res.json({ success: false, message: 'No emails available in pool. Please contact admin.' });
        }

        // Deduct tokens
        db.setTokenBalance(user, db.getTokenBalance(user) - tokenCost);
        if (!user.history) user.history = [];

        let historyType = 'premium_email';
        if (provider === 'gmail') historyType = 'gmail_email';
        else if (provider === 'hotmail') historyType = 'hotmail_email';
        else if (provider === 'student') historyType = 'student_email';
        else if (provider === 'temp') historyType = 'temp_mail';

        user.history.unshift({
            type: historyType,
            amount: -tokenCost,
            date: new Date().toISOString(),
            reward: `-${tokenCost} Tokens`,
            detail: emailData.email
        });
        saveUsersObj(users);

        // Store session — userId stored as string for consistent comparison
        const sessionId = `premium_${provider}_${Date.now()}_${userId}`;
        if (!db.data.mailSessions) db.data.mailSessions = {};
        db.data.mailSessions[sessionId] = {
            ...emailData,
            userId: String(userId),
            provider,
            createdAt: Date.now()
        };
        db.save();

        // Return email as plain STRING (not object) to avoid [object Object] on frontend
        res.json({
            success: true,
            email: emailData.email,    // ← plain string!
            sessionId,
            newBalance: db.getTokenBalance(user),
            provider: emailData.provider
        });
    } catch (err) {
        console.error("Gen Error:", err);
        res.json({ success: false, message: err.message });
    } finally {
        genLocks.delete(lockKey);
    }
});


// API: Fetch Premium Email Inbox
app.get('/api/premium-emails/inbox', async (req, res) => {
    const { sessionId, userId, service } = req.query;

    if (!sessionId) {
        return res.json({ success: false, message: 'Session ID required' });
    }

    // Get session data
    const session = db.data.mailSessions?.[sessionId];
    if (!session) {
        return res.json({ success: false, messages: [], email: null, note: 'Session not found or expired' });
    }

    // Verify user owns this session (loose equality for number vs string)
    if (userId && session.userId != null && String(session.userId) !== String(userId)) {
        return res.json({ success: false, message: 'Unauthorized' });
    }

    // Extract email string (handle old sessions where email was stored as object)
    const targetEmail = (typeof session.email === 'object' && session.email !== null)
        ? (session.email.email || '')
        : (session.email || '');

    if (!targetEmail) {
        return res.json({ success: false, messages: [], note: 'No email address in session' });
    }

    const providerStr = (session.provider || '').toString();
    let messages = [];

    try {
        // ─── ADMIN POOL GMAIL → use IMAP Mother Email ───
        if (providerStr.startsWith('admin_pool_gmail') || providerStr === 'gmail') {
            if (imapService.isConnected('gmail')) {
                messages = await imapService.fetchMessagesForEmail('gmail', targetEmail, 60);
            } else {
                // Try auto-reconnect
                const saved = db.data.adminSettings?.motherEmailConfigs?.gmail;
                if (saved) {
                    const ok = await imapService.connect('gmail', saved);
                    if (ok) messages = await imapService.fetchMessagesForEmail('gmail', targetEmail, 60);
                }
                if (messages.length === 0) {
                    return res.json({
                        success: false,
                        messages: [],
                        message: '⚠️ Gmail Mother Email not connected. Go to Admin Panel → Email Pool → Connect Gmail.'
                    });
                }
            }

            // ─── ADMIN POOL HOTMAIL → use IMAP Mother Email ───
        } else if (providerStr.startsWith('admin_pool_hotmail') || providerStr === 'hotmail' || service === 'hotmail') {
            if (imapService.isConnected('hotmail')) {
                messages = await imapService.fetchMessagesForEmail('hotmail', targetEmail, 60);
            } else {
                const saved = db.data.adminSettings?.motherEmailConfigs?.hotmail;
                if (saved) {
                    const ok = await imapService.connect('hotmail', saved);
                    if (ok) messages = await imapService.fetchMessagesForEmail('hotmail', targetEmail, 60);
                }
                if (messages.length === 0) {
                    return res.json({
                        success: false,
                        messages: [],
                        message: '⚠️ Hotmail Mother Email not connected. Go to Admin Panel → Email Pool → Connect Hotmail.'
                    });
                }
            }

            // ─── STUDENT EMAIL → external provider ───
        } else if (providerStr.startsWith('admin_pool_student') || session.provider === 'student' || service === 'student') {
            const unifiedProviders = require('../services/providers');
            messages = await unifiedProviders.getStudentEmailMessages(
                session.sessionId || session.token,
                targetEmail,
                session.provider
            );
        }

        // Format messages consistently
        const formatted = (messages || []).map(m => ({
            id: m.id || m.uid,
            from: m.from || 'Unknown',
            to: m.to || targetEmail,
            subject: m.subject || '(No Subject)',
            body: m.body || m.snippet || '',
            preview: String(m.body || m.snippet || '').substring(0, 120),
            otp: m.otp || (function (text) {
                if (!text) return null;
                // Exclude common false positives like Microsoft Redmond Zip (98052) or Google MV Zip (94043)
                const blacklist = ['98052', '94043', '98034', '94040', '95014'];

                // Try to find code near "code" or "otp" keyword first (High confidence)
                const contextRegex = /(?:code|otp|verification|verify|pin|passcode|security)\D*(\d{4,8})\b/i;
                const contextMatch = text.match(contextRegex);
                if (contextMatch && !blacklist.includes(contextMatch[1])) return contextMatch[1];

                // Fallback to any 4-8 digit number that isn't blacklisted
                const allMatches = text.match(/\b\d{4,8}\b/g) || [];
                for (const match of allMatches) {
                    if (!blacklist.includes(match) && match.length >= 6) return match; // Prioritize 6+ digits
                }
                for (const match of allMatches) {
                    if (!blacklist.includes(match)) return match;
                }
                return null;
            })(m.body || m.snippet || '') || null,
            date: m.date || new Date().toISOString(),
            snippet: (m.snippet || m.body || '').substring(0, 100)
        }));

        // De-duplicate messages based on From, Subject and Snippet
        const uniqueMessages = [];
        const seen = new Set();
        for (const msg of formatted) {
            const key = `${msg.from}_${msg.subject}_${msg.snippet}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueMessages.push(msg);
            }
        }

        res.json({
            success: true,
            messages: uniqueMessages,
            email: targetEmail
        });
    } catch (e) {
        console.error('[Premium Inbox] Fetch error:', e.message);
        res.json({ success: true, messages: [], email: targetEmail });
    }
});


// API: Generate Temp/Hot/Student Email
app.post('/api/mail/generate', async (req, res) => {
    const { userId, cost, type, service } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });
    const settings = db.getSettings();
    const costs = settings.costs || {};
    const requestedService = (type || service || 'temp').toString().toLowerCase();

    let tokenCost = costs.tempmail || 10;
    if (requestedService === 'gmail' || requestedService === 'premium') tokenCost = costs.gmail || 20;
    else if (requestedService === 'hotmail' || requestedService === 'hot') tokenCost = costs.hotmail || 25;
    else if (requestedService === 'student') tokenCost = costs.student || 50;

    let currency = 'token';
    if (requestedService === 'gmail' || requestedService === 'premium') currency = costs.gmailCurrency || 'token';
    else if (requestedService === 'hotmail' || requestedService === 'hot') currency = costs.hotmailCurrency || 'token';
    else if (requestedService === 'student') currency = costs.studentCurrency || 'token';
    else currency = costs.tempmailCurrency || 'token';

    // Balance check based on currency
    if (currency === 'Gems' || currency === 'gem') {
        const userGems = user.Gems || 0;
        if (userGems < tokenCost) {
            return res.json({ success: false, message: `Insufficient Gems. Need ${tokenCost} Gems for ${requestedService}.` });
        }
    } else if (currency === 'usd' || currency === 'USD') {
        const userUsd = user.usd || 0;
        if (userUsd < tokenCost) {
            return res.json({ success: false, message: `Insufficient USD. Need $${tokenCost} for ${requestedService}.` });
        }
    } else {
        const mailTokens = db.getTokenBalance(user);
        if (mailTokens < tokenCost) return res.json({ success: false, message: `Insufficient tokens. Need ${tokenCost} TC for ${requestedService}.` });
    }

    let emailData = null;
    const sessionId = 'mail_' + requestedService + '_' + Date.now() + '_' + userId;

    try {
        if (requestedService === 'hotmail' || requestedService === 'hot') {
            // Hot Mail: ADMIN POOL ONLY - no website providers
            const poolEmail = assignEmailFromPool('hotmail');
            if (!poolEmail) {
                try {
                    const generated = await createHotmailAccount();
                    if (generated && generated.email) {
                        emailData = {
                            email: generated.email,
                            password: generated.password || null,
                            provider: 'automation_hotmail',
                            sessionId: generated.sessionId || generated.email,
                            token: generated.token || generated.email
                        };
                    } else {
                        return res.json({ success: false, message: 'No Hot Mail emails available in pool and fallback failed.' });
                    }
                } catch (e) {
                    console.error('Automation fallback failed for hotmail:', e.message);
                    return res.json({ success: false, message: 'No Hot Mail emails available in pool and fallback failed.' });
                }
            } else {
                emailData = {
                    email: poolEmail.email,
                    password: poolEmail.password || null,
                    provider: 'admin_pool_hotmail',
                    sessionId: poolEmail.email,
                    token: poolEmail.email
                };

                // Remove from pool
                db.data.emailPool['hotmail'] = db.data.emailPool['hotmail'].filter(e => e.email !== poolEmail.email);

                // Add to history
                if (!db.data.emailPoolHistory) db.data.emailPoolHistory = [];
                db.data.emailPoolHistory.push({
                    type: 'hotmail',
                    email: poolEmail.email,
                    assignedTo: userId,
                    assignedAt: Date.now()
                });
                db.save();
            }
        } else if (requestedService === 'gmail') {
            // Gmail: ADMIN POOL ONLY - no website providers
            const poolEmail = assignEmailFromPool('gmail');
            if (!poolEmail) {
                try {
                    const generated = await createGmailAccount();
                    if (generated && generated.email) {
                        emailData = {
                            email: generated.email,
                            password: generated.password || null,
                            provider: 'automation_gmail',
                            sessionId: generated.sessionId || generated.email,
                            token: generated.token || generated.email
                        };
                    } else {
                        return res.json({ success: false, message: 'No Gmail emails available in pool and fallback failed.' });
                    }
                } catch (e) {
                    console.error('Automation fallback failed for gmail:', e.message);
                    return res.json({ success: false, message: 'No Gmail emails available in pool and fallback failed.' });
                }
            } else {
                emailData = {
                    email: poolEmail.email,
                    password: poolEmail.password || null,
                    provider: 'admin_pool_gmail',
                    sessionId: poolEmail.email,
                    token: poolEmail.email
                };

                // Remove from pool
                db.data.emailPool['gmail'] = db.data.emailPool['gmail'].filter(e => e.email !== poolEmail.email);

                // Add to history
                if (!db.data.emailPoolHistory) db.data.emailPoolHistory = [];
                db.data.emailPoolHistory.push({
                    type: 'gmail',
                    email: poolEmail.email,
                    assignedTo: userId,
                    assignedAt: Date.now()
                });
                db.save();
            }
        } else if (requestedService === 'student') {
            const { createStudentEmailAccount } = require('../services/providers');
            emailData = await createStudentEmailAccount();
        } else {
            const tempMail = require('../services/tempmail-providers');
            emailData = await tempMail.createAccount();
        }
    } catch (e) {
        console.error('Mail createAccount error:', e.message);
    }

    if (!emailData || !emailData.email) {
        console.error('❌ Mail generation failed for:', requestedService);
        return res.json({ success: false, message: 'Email not available. Please try again later or contact admin.' });
    }

    if (currency === 'Gems' || currency === 'gem') {
        user.Gems = (user.Gems || 0) - tokenCost;
    } else if (currency === 'usd' || currency === 'USD') {
        user.usd = (user.usd || 0) - tokenCost;
    } else {
        db.setTokenBalance(user, db.getTokenBalance(user) - tokenCost);
    }

    if (!user.history) user.history = [];

    let historyType = 'temp_mail';
    if (requestedService === 'student') historyType = 'student_email';
    else if (requestedService === 'hotmail' || requestedService === 'hot') historyType = 'hotmail_email';
    else if (requestedService === 'gmail' || requestedService === 'premium') historyType = 'gmail_email';

    const curLabel = (currency === 'Gems' || currency === 'gem') ? 'Gems' : ((currency === 'usd' || currency === 'USD') ? 'USD' : 'Tokens');

    user.history.unshift({
        type: historyType,
        amount: -tokenCost,
        date: new Date().toISOString(),
        reward: `-${tokenCost} ${curLabel}`,
        detail: emailData.email
    });
    saveUsersObj(users);

    // Store session
    if (!db.data.mailSessions) db.data.mailSessions = {};
    db.data.mailSessions[sessionId] = {
        ...emailData,
        userId,
        createdAt: Date.now(),
        service: requestedService
    };
    db.save();

    res.json({ success: true, email: emailData.email, sessionId, newBalance: db.getTokenBalance(user) });
});

// API: Renew Custom Email
app.post('/api/mail/renew-custom', async (req, res) => {
    const { userId, email, type } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    const settings = db.getSettings();
    const costs = settings.costs || {};
    const tokenCost = costs.renewmail || 30;
    const bal = db.getTokenBalance(user);

    if (bal < tokenCost) return res.json({ success: false, message: `Insufficient tokens. Need ${tokenCost} TC.` });

    // Normalize type
    const requestedType = (type === 'premium' || type === 'gmail') ? 'gmail' : 'hotmail';

    // Find email in pool or history
    const pool = db.data.emailPool || {};
    const typePool = pool[requestedType] || [];
    let emailData = typePool.find(e => e.email.toLowerCase() === email.toLowerCase());

    if (!emailData) {
        const history = db.data.emailPoolHistory || [];
        const histItem = history.find(h => h.email.toLowerCase() === email.toLowerCase() && h.type === requestedType);
        if (histItem) {
            emailData = {
                email: histItem.email,
                provider: `admin_pool_${requestedType}`,
                sessionId: histItem.email
            };
        }
    }

    // Fallback: search in active sessions (allows renewing automation emails)
    if (!emailData) {
        const sessions = db.data.mailSessions || {};
        const sessionData = Object.values(sessions).find(s => s.email && s.email.toLowerCase() === email.toLowerCase() && String(s.userId) === String(userId));
        if (sessionData) {
            emailData = {
                email: sessionData.email,
                provider: sessionData.provider,
                sessionId: sessionData.sessionId || sessionData.token || sessionData.email,
                token: sessionData.token
            };
        }
    }

    if (!emailData) {
        return res.json({ success: false, message: 'Email not found. Only emails from our pool or your active sessions can be renewed.' });
    }

    // Deduct tokens
    db.setTokenBalance(user, bal - tokenCost);
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'mail_renew',
        amount: -tokenCost,
        date: new Date().toISOString(),
        reward: `-${tokenCost} Tokens`,
        detail: `Renewed ${emailData.email}`
    });
    saveUsersObj(users);

    // Create session
    const sessionId = 'mail_' + requestedType + '_renew_' + Date.now() + '_' + userId;
    if (!db.data.mailSessions) db.data.mailSessions = {};
    db.data.mailSessions[sessionId] = {
        ...emailData,
        userId,
        createdAt: Date.now(),
        service: requestedType,
        isRenewed: true
    };
    db.save();

    res.json({ success: true, email: emailData.email, sessionId, newBalance: db.getTokenBalance(user) });
});

app.get('/api/mail/active', async (req, res) => {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (!userId) return res.json({ success: false, message: 'User ID required' });

    // 24-hour retention for gmail and hotmail (premium)
    const activeSessions = {};
    const now = Date.now();
    const RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 24 hours

    if (db.data.mailSessions) {
        // Collect latest active session per service type
        for (const [sessionId, session] of Object.entries(db.data.mailSessions)) {
            if (String(session.userId) === String(userId)) {
                if (now - session.createdAt < RETENTION_PERIOD) {
                    const type = session.service || session.provider || 'temp';

                    // For premium mails, pick the most recent session
                    if (type === 'gmail' || type === 'hotmail' || type === 'premium' || type.startsWith('admin_pool_')) {
                        if (!activeSessions[type] || session.createdAt > activeSessions[type].createdAt) {
                            activeSessions[type] = {
                                id: sessionId,
                                sessionId: sessionId,
                                email: session.email,
                                type: type,
                                createdAt: session.createdAt
                            };
                        }
                    }
                }
            }
        }
    }

    res.json({ success: true, activeSessions });
});

// API: Check Mail Inbox
app.get('/api/mail/inbox', async (req, res) => {
    const { sessionId } = req.query;
    const userId = req.query.userId;
    const cost = parseInt(req.query.cost) || 0;
    const sessions = db.data.mailSessions || {};
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, messages: [] });

    // Optional billing per refresh
    if (cost > 0 && userId) {
        try {
            const users = getUsersObj();
            const user = users[userId];
            if (!user) return res.json({ success: false, message: 'User not found', messages: [] });
            const bal = db.getTokenBalance(user);
            if (bal < cost) return res.json({ success: false, message: 'Insufficient tokens', newBalance: bal, messages: [] });
            db.setTokenBalance(user, bal - cost);
            if (!user.history) user.history = [];
            user.history.unshift({ type: 'mail_inbox_refresh', amount: cost, currency: 'tokens', date: Date.now() });
            saveUsersObj(users);
        } catch (e) { }
    }

    try {
        const activeService = (req.query.type || req.query.service || session.service || 'temp').toString().toLowerCase();
        const providerStr = (session.provider || '').toString();
        let messages = [];

        // ─── ADMIN POOL EMAILS → use Mother Email IMAP ───
        if (providerStr.startsWith('admin_pool_') || activeService === 'hotmail' || activeService === 'hot' || activeService === 'gmail') {
            const targetType = (activeService === 'hotmail' || activeService === 'hot') ? 'hotmail' : 'gmail';
            if (session.email && imapService.isConnected(targetType)) {
                messages = await imapService.fetchMessagesForEmail(targetType, session.email, 120);
            } else if (session.email) {
                // Try reconnect
                const saved = db.data.settings?.motherEmails?.[targetType];
                if (saved) {
                    const ok = await imapService.connect(targetType, saved);
                    if (ok) messages = await imapService.fetchMessagesForEmail(targetType, session.email, 120);
                }
                if (messages.length === 0) {
                    return res.json({
                        success: false,
                        messages: [],
                        message: `⚠️ Mother Email for ${targetType} not connected. Contact admin.`
                    });
                }
            }
        } else if (activeService === 'student') {
            const { getStudentEmailMessages } = require('../services/providers');
            messages = await getStudentEmailMessages(session.sessionId || session.token || sessionId, session.email, session.provider);
        } else {
            const tempMail = require('../services/tempmail-providers');
            messages = await tempMail.getMessages(session.token || sessionId, session.email);
        }

        const formatted = (messages || []).map(m => ({
            id: m.id,
            from: m.from || m.sender || 'Unknown',
            subject: m.subject || '(No Subject)',
            preview: (m.body || m.snippet || m.preview || '').substring(0, 100),
            body: m.body || m.snippet || m.preview || '',
            time: m.date ? new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            otp: m.otp || (function (text) {
                if (!text) return null;
                const blacklist = ['98052', '94043', '98034', '94040', '95014'];
                const contextRegex = /(?:code|otp|verification|verify|pin|passcode|security)\D*(\d{4,8})\b/i;
                const contextMatch = text.match(contextRegex);
                if (contextMatch && !blacklist.includes(contextMatch[1])) return contextMatch[1];
                const allMatches = text.match(/\b\d{4,8}\b/g) || [];
                for (const match of allMatches) {
                    if (!blacklist.includes(match) && match.length >= 6) return match;
                }
                for (const match of allMatches) {
                    if (!blacklist.includes(match)) return match;
                }
                return null;
            })(m.body || m.snippet || '') || null
        }));

        let newBalance;
        if (cost > 0 && userId) {
            try {
                const user = getUsersObj()[userId];
                if (user) newBalance = db.getTokenBalance(user);
            } catch (e) { }
        }
        res.json({ success: true, messages: formatted, newBalance });
    } catch (e) {
        console.error('Inbox fetch error:', e.message);
        res.json({ success: true, messages: [] });
    }
});

// API: Admin - Get All Users
app.get('/api/admin/users', (req, res) => {
    try {
        const users = getUsersObj();
        const list = Object.entries(users).map(([id, u]) => ({
            id,
            username: u.username || `User_${id}`,
            firstName: u.firstName || u.first_name || '',
            tokens: u.tokens || u.balance_tokens || 0,
            Gems: (u.Gems !== undefined ? u.Gems : (u.balance_Gems !== undefined ? u.balance_Gems : (u.gems || 0))),
            usd: (u.usd !== undefined && u.usd !== null) ? u.usd : 0,
            invites: u.invites || u.referralCount || 0,
            verified: u.verified || false,
            adminVerified: u.adminVerified || false,
            apiStatus: u.apiStatus || 'allow',
            verifiedAt: u.verifiedAt || null,
            leftAt: u.leftAt || null,
            leftFrom: u.leftFrom || null,
            banned: u.banned || u.blocked || false,
            joinDate: u.joinDate || u.joinedAt || null,
            lastActive: u.lastActive || null
        }));
        res.json({ success: true, users: list, total: list.length });
    } catch (err) {
        console.error('[API] Error fetching users:', err);
        res.json({ success: false, message: err.message });
    }
});

// API: Admin - Update User Tokens
app.post('/api/admin/users/:userId/tokens', (req, res) => {
    const { userId } = req.params;
    const { tokens, action } = req.body;
    const users = getUsersObj();
    if (!users[userId]) return res.json({ success: false, message: 'User not found' });
    const u = users[userId];

    const cur = db.getTokenBalance(u);
    const amt = parseInt(tokens) || 0;

    if (action === 'add') db.setTokenBalance(u, cur + amt);
    else if (action === 'subtract') db.setTokenBalance(u, Math.max(0, cur - amt));
    else db.setTokenBalance(u, amt);

    saveUsersObj(users);
    res.json({ success: true, newBalance: db.getTokenBalance(u) });
});

// API: Admin - Ban/Unban User
app.post('/api/admin/users/:userId/ban', (req, res) => {
    const { userId } = req.params;
    const { ban } = req.body;
    const users = getUsersObj();
    const user = users[userId];

    if (!user) return res.json({ success: false, message: 'User not found' });

    // Ensure boolean value, never undefined
    const banStatus = ban === true || ban === 'true' || ban === 1 || ban === '1';
    user.banned = banStatus;
    user.blocked = banStatus; // Keep both in sync

    if (banStatus) {
        user.bannedAt = Date.now();
        user.status = 'banned';
    } else {
        user.status = 'active';
        delete user.bannedAt;
    }

    saveUsersObj(users);
    res.json({ success: true, banned: user.banned });
});

// API: Admin - Delete User
app.delete('/api/admin/users/:userId', (req, res) => {
    const { userId } = req.params;
    const users = getUsersObj();

    if (!users[userId]) {
        return res.json({ success: false, message: 'User not found' });
    }

    delete users[userId];
    saveUsersObj(users);
    res.json({ success: true, message: 'User deleted successfully' });
});

// API: Admin - User Detail + Full History
app.get('/api/admin/user-detail/:userId', (req, res) => {
    const { userId } = req.params;
    const users = getUsersObj();
    const u = users[userId];
    if (!u) return res.json({ success: false, message: 'User not found' });

    const userProfile = {
        id: userId,
        firstName: u.firstName || u.first_name || '',
        username: u.username || '',
        tokens: db.getTokenBalance(u),
        Gems: u.Gems || 0,
        usd: u.usd || 0,
        referralCount: u.referralCount || u.invites || 0,
        verified: u.verified || false,
        banned: u.banned || u.blocked || false,
        joinDate: u.joinDate || u.joinedAt || null,
        lastActive: u.lastActive || null,
        completedTasks: u.completedTasks || [],
        redeemedCodes: u.redeemedCodes || [],
        referredBy: u.referredBy || null,
        pendingReferrer: u.pendingReferrer || null,
    };

    const history = Array.isArray(u.history) ? u.history : [];
    res.json({ success: true, user: userProfile, history });
});

// API: Exchange - Convert Assets
app.post('/api/exchange/convert', (req, res) => {
    const { userId, from, to, amount } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.json({ success: false, message: 'Please enter a valid amount' });

    if (from === to) {
        return res.json({ success: false, message: 'Please select different currencies' });
    }

    // Currency field names
    const getField = (tokenType) => {
        if (tokenType === 'tokens') return user.tokens !== undefined ? 'tokens' : 'balance_tokens';
        return tokenType; // usd, Gems
    };

    const fromField = getField(from);
    const toField = getField(to);

    const balance = user[fromField] || 0;
    if (balance < amt) return res.json({ success: false, message: 'Insufficient balance' });

    // Rates (Sync with frontend)
    const rates = {
        usd_to_tokens: 100,
        Gems_to_tokens: 100
    };

    // 1. Convert source to a common base (Tokens)
    let tokensBase = 0;
    if (from === 'tokens') tokensBase = amt;
    else if (from === 'usd') tokensBase = amt * rates.usd_to_tokens;
    else if (from === 'Gems') tokensBase = amt * rates.Gems_to_tokens;

    // 2. Convert base to target
    let targetAmount = 0;
    if (to === 'tokens') targetAmount = tokensBase;
    else if (to === 'Gems') targetAmount = tokensBase / rates.Gems_to_tokens;
    else if (to === 'usd') targetAmount = tokensBase / rates.usd_to_tokens;

    // Apply rounding
    if (to === 'usd') targetAmount = Math.round(targetAmount * 1000) / 1000;
    else if (to === 'Gems') targetAmount = Math.floor(targetAmount * 10000) / 10000;
    else targetAmount = Math.floor(targetAmount);

    // Get exchange fee from config (default 2%)
    const settings = db.getSettings();
    const exchangeFeePercent = settings.exchangeFee || 2;
    const exchangeFee = Math.ceil((targetAmount * exchangeFeePercent) / 100);
    const amountAfterFee = targetAmount - exchangeFee;

    // Update balances
    if (from === 'tokens') db.setTokenBalance(user, db.getTokenBalance(user) - amt);
    else user[fromField] = Math.max(0, balance - amt);

    if (to === 'tokens') db.setTokenBalance(user, db.getTokenBalance(user) + amountAfterFee);
    else user[toField] = Math.max(0, (user[toField] || 0) + amountAfterFee);

    // History record (Two transactions for minus and plus)
    if (!user.history) user.history = [];

    // 1. Transaction for Deduction (-)
    user.history.unshift({
        type: 'exchange',
        amount: -amt,
        currency: from === 'tokens' ? 'TC' : (from === 'Gems' ? 'Gems' : from.toUpperCase()),
        date: Date.now(),
        detail: `Exchanged ${amt} ${from.toUpperCase()} to ${to.toUpperCase()}`
    });

    // 2. Transaction for Addition (+)
    user.history.unshift({
        type: 'exchange',
        amount: amountAfterFee,
        currency: to === 'tokens' ? 'TC' : (to === 'Gems' ? 'Gems' : to.toUpperCase()),
        date: Date.now(),
        detail: `Received from ${from.toUpperCase()} exchange`
    });

    saveUsersObj(users, true);
    res.json({
        success: true,
        message: `Successfully exchanged ${amt} ${from} to ${amountAfterFee} ${to} (Fee: ${exchangeFee} ${to} - ${exchangeFeePercent}%)`,
        fee: exchangeFee,
        feePercent: exchangeFeePercent,
        fromAmount: amt,
        toAmount: amountAfterFee,
        tokens: db.getTokenBalance(user),
        Gems: user.Gems || 0,
        usd: user.usd || 0
    });
});

// API: User Transfer Assets
app.post('/api/user/transfer', async (req, res) => {
    const { fromUserId, toUserId, amount, asset } = req.body;
    if (!fromUserId || !toUserId || isNaN(amount) || amount <= 0 || !asset) {
        return res.json({ success: false, message: 'Invalid transfer details' });
    }

    const users = getUsersObj();
    const fromUser = users[fromUserId.toString()];
    const toUser = users[toUserId.toString()];

    if (!fromUser) return res.json({ success: false, message: 'Sender not found' });
    if (!toUser) return res.json({ success: false, message: 'Recipient not found' });
    if (String(fromUserId) === String(toUserId)) return res.json({ success: false, message: 'Cannot transfer to yourself' });

    // Get transfer fee from config (default 5%)
    const settings = db.getSettings();
    const transferFeePercent = settings.transferFee || 5;

    // Calculate safely with floats
    const rawFee = (amount * transferFeePercent) / 100;
    // For tokens/Gems, ceil is okay. For USD, round to 2 decimals
    const transferFee = asset === 'usd' ? (Math.ceil(rawFee * 1000) / 1000) : Math.ceil(rawFee);
    const amountAfterFee = asset === 'usd' ? (amount - transferFee).toFixed(3) * 1 : (amount - transferFee);

    // Identify field names based on asset type
    let field = asset; // usd, Gems, tokens
    if (asset === 'tokens') {
        field = fromUser.tokens !== undefined ? 'tokens' : 'balance_tokens';
    }

    const balance = parseFloat(fromUser[field]) || 0;
    if (balance < amount) return res.json({
        success: false,
        message: `Insufficient balance.`
    });

    // Perform transfer - deduct full amount from sender
    if (asset === 'tokens') {
        db.setTokenBalance(fromUser, db.getTokenBalance(fromUser) - parseInt(amount));
    } else if (asset === 'usd') {
        fromUser[field] = Math.max(0, balance - parseFloat(amount));
    } else {
        fromUser[field] = Math.max(0, balance - parseInt(amount));
    }

    // Recipient receives amount after fee deduction
    let toField = asset;
    if (asset === 'tokens') {
        toField = toUser.tokens !== undefined ? 'tokens' : 'balance_tokens';
    }

    if (asset === 'tokens') {
        db.setTokenBalance(toUser, db.getTokenBalance(toUser) + amountAfterFee);
    } else if (asset === 'usd') {
        toUser[toField] = parseFloat(((toUser[toField] || 0) + amountAfterFee).toFixed(3));
    } else {
        toUser[toField] = (toUser[toField] || 0) + amountAfterFee;
    }

    // History Records
    if (!fromUser.history) fromUser.history = [];
    fromUser.history.unshift({
        type: 'transfer_out',
        amount,
        fee: transferFee,
        feePercent: transferFeePercent,
        asset,
        to: toUserId,
        date: Date.now()
    });

    if (!toUser.history) toUser.history = [];
    toUser.history.unshift({
        type: 'transfer_in',
        amount: amountAfterFee,
        asset,
        from: fromUserId,
        date: Date.now()
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: `Successfully transferred ${amountAfterFee} ${asset} to User #${toUserId} (Fee: ${transferFee} ${asset} - ${transferFeePercent}%)`,
        fee: transferFee,
        feePercent: transferFeePercent,
        amountSent: amount,
        amountReceived: amountAfterFee,
        newBalances: {
            tokens: db.getTokenBalance(fromUser),
            Gems: fromUser.Gems || 0,
            usd: fromUser.usd || 0
        }
    });
});

// API: Deduct Support Loan (Support System)
app.post('/api/user/deduct-support-loan', async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || isNaN(amount) || amount <= 0) {
        return res.json({ success: false, message: 'Invalid user ID or amount' });
    }

    const users = getUsersObj();
    const user = users[userId.toString()];

    if (!user) return res.json({ success: false, message: 'User not found' });

    // Get current balance
    const currentBalance = db.getTokenBalance(user) || 0;

    // Calculate new balance after deduction (can go negative)
    const newBalance = currentBalance - amount;

    // Check if this becomes a loan (negative balance)
    let supportLoan = user.supportLoan || 0;
    if (newBalance < 0) {
        // This is a loan - track how much is owed
        supportLoan += Math.abs(newBalance);
    }

    // Deduct tokens (allow negative balance)
    db.setTokenBalance(user, newBalance);

    // Update support loan tracking
    user.supportLoan = supportLoan;

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'support_contact',
        amount: amount,
        cost: amount,
        supportLoan: supportLoan,
        date: Date.now()
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: 'Support cost deducted successfully',
        newBalance: newBalance,
        supportLoan: supportLoan,
        tookLoan: newBalance < 0
    });
});

// API: Auto-repay support loan when user earns tokens
app.post('/api/user/repay-support-loan', async (req, res) => {
    const { userId, earnedAmount } = req.body;
    if (!userId || isNaN(earnedAmount) || earnedAmount <= 0) {
        return res.json({ success: false, message: 'Invalid user ID or earned amount' });
    }

    const users = getUsersObj();
    const user = users[userId.toString()];

    if (!user) return res.json({ success: false, message: 'User not found' });

    const supportLoan = user.supportLoan || 0;
    if (supportLoan <= 0) {
        return res.json({ success: false, message: 'No support loan to repay', repaid: 0 });
    }

    // Calculate how much to repay
    const repayAmount = Math.min(earnedAmount, supportLoan);

    // Get current balance
    const currentBalance = db.getTokenBalance(user) || 0;

    // User earns tokens first
    let newBalance = currentBalance + earnedAmount;

    // Then deduct the loan repayment
    newBalance = newBalance - repayAmount;

    // Update loan amount
    const newSupportLoan = supportLoan - repayAmount;

    // Update user data
    db.setTokenBalance(user, newBalance);
    user.supportLoan = newSupportLoan;

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'support_loan_repay',
        earned: earnedAmount,
        repaid: repayAmount,
        remainingLoan: newSupportLoan,
        date: Date.now()
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: `Repaid ${repayAmount} TC of support loan`,
        newBalance: newBalance,
        supportLoan: newSupportLoan,
        repaid: repayAmount
    });
});

// API: Deposit - Submit Request
app.post('/api/deposit/submit', (req, res) => {
    const { userId, method, amount, txnId } = req.body;
    if (!userId || !method || !amount || !txnId) {
        return res.json({ success: false, message: 'Missing required fields' });
    }

    db.data.pendingDeposits = db.data.pendingDeposits || [];

    // Check if txnId already exists (prevent duplicate submissions)
    const exists = db.data.pendingDeposits.find(d => d.txnId === txnId);
    if (exists) {
        return res.json({ success: false, message: 'Transaction ID already submitted for review.' });
    }

    const deposit = {
        id: 'dep_' + Date.now() + Math.random().toString(36).substr(2, 5),
        userId: userId.toString(),
        method,
        amount: parseFloat(amount),
        txnId,
        screenshot: req.body.screenshot || null,
        date: Date.now(),
        status: 'Submitted'
    };

    db.data.pendingDeposits.unshift(deposit);
    db.save();

    res.json({ success: true, message: 'Deposit submitted successfully! Admin will review it.' });
});

// API: Deposit - Get Config (QR/Addresses)
app.get('/api/deposit/config', (req, res) => {
    res.json({ success: true, cryptoMethods: db.data.cryptoMethods || {} });
});

// API: Admin - Get All Deposits (Pending & History)
app.get('/api/admin/deposits', (req, res) => {
    const pending = (db.data.pendingDeposits || []).filter(d => d.status === 'Submitted');
    const history = (db.data.pendingDeposits || []).filter(d => d.status !== 'Submitted').slice(0, 50);
    res.json({ success: true, pending, history });
});

// API: Admin - Deposit Action (Approve/Reject)
app.post('/api/admin/deposits/action', (req, res) => {
    const { depositId, action, note } = req.body;
    const deposits = db.data.pendingDeposits || [];
    const depositIndex = deposits.findIndex(d => d.id === depositId);

    if (depositIndex === -1) return res.json({ success: false, message: 'Deposit not found' });

    const deposit = deposits[depositIndex];
    if (deposit.status !== 'Submitted') return res.json({ success: false, message: 'Deposit already processed' });

    if (action === 'approve') {
        const users = getUsersObj();
        let user = users[deposit.userId];

        // If user doesn't exist, create them
        if (!user) {
            console.log(`[DEPOSIT] Creating missing user ${deposit.userId} for deposit approval`);
            user = {
                id: deposit.userId,
                userId: deposit.userId,
                firstName: 'User',
                username: 'user_' + deposit.userId,
                tokens: 0,
                balance_tokens: 0,
                Gems: 0,
                balance_Gems: 0,
                usd: 0,
                history: [],
                lastActive: Date.now()
            };
            users[deposit.userId] = user;
        }

        // Credit user with USD balance
        user.usd = parseFloat(((user.usd || 0) + deposit.amount).toFixed(3));

        // Add to history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'deposit',
            amount: deposit.amount,
            currency: 'usd',
            method: deposit.method,
            txnId: deposit.txnId,
            date: Date.now(),
            status: 'completed'
        });

        saveUsersObj(users);
        deposit.status = 'Approved';
    } else {
        deposit.status = 'Rejected';
        deposit.adminNote = note;
    }

    db.save();
    res.json({ success: true });
});

// API: Admin - Delete ALL Deposit History
app.post('/api/admin/deposits/delete-all', (req, res) => {
    try {
        if (!db.data.pendingDeposits) db.data.pendingDeposits = [];
        // Only keep the Submitted ones
        db.data.pendingDeposits = db.data.pendingDeposits.filter(d => d.status === 'Submitted');
        db.save();
        res.json({ success: true, message: 'Deposit history cleared (Submitted requests preserved)' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Auto Approve by Transaction IDs
app.post('/api/admin/deposits/auto-approve', (req, res) => {
    const { txnIds } = req.body; // Array of strings or newline separated string
    if (!txnIds) return res.json({ success: false, message: 'No IDs provided' });

    let idsArray = Array.isArray(txnIds) ? txnIds : txnIds.split('\n').map(s => s.trim()).filter(s => s);

    const deposits = db.data.pendingDeposits || [];
    const users = getUsersObj();
    let approvedCount = 0;

    idsArray.forEach(tid => {
        const deposit = deposits.find(d => d.txnId === tid && d.status === 'Submitted');
        if (deposit) {
            const user = users[deposit.userId];
            if (user) {
                user.usd = parseFloat(((user.usd || 0) + deposit.amount).toFixed(3));
                if (!user.history) user.history = [];
                user.history.unshift({
                    type: 'deposit',
                    amount: deposit.amount,
                    currency: 'usd',
                    method: deposit.method,
                    txnId: deposit.txnId,
                    date: Date.now(),
                    status: 'completed',
                    autoApproved: true
                });
                deposit.status = 'Approved';
                deposit.autoApproved = true;
                approvedCount++;
            }
        }
    });

    if (approvedCount > 0) {
        saveUsersObj(users);
        db.save();
    }

    res.json({ success: true, approvedCount, totalChecked: idsArray.length });
});

// API: Admin - Update Deposit Config
app.post('/api/admin/deposits/config', (req, res) => {
    const { cryptoMethods } = req.body;
    if (cryptoMethods) {
        db.data.cryptoMethods = cryptoMethods;
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/admin/services/:id/stock', (req, res) => {
    const { id } = req.params;
    let stock = 0;

    // Check cards
    if (db.data.cards && db.data.cards[id]) {
        stock = db.data.cards[id].length;
    }
    // Check VPN accounts
    else if (db.data.vpnAccounts && db.data.vpnAccounts[id]) {
        stock = db.data.vpnAccounts[id].length;
    }
    // Check shop items
    else if (db.data.shopItems && db.data.shopItems[id]) {
        stock = db.data.shopItems[id].stock || 0;
    }

    res.json({ success: true, stock, id });
});

// API: Admin - Dashboard Stats (Enhanced with proper user counting)
app.get('/api/admin/stats', async (req, res) => {
    const usersList = await db.getUsers();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    let active = 0;
    let revenue = 0;
    let totalTokens = 0;
    let totalGems = 0;
    let totalUsdt = 0;
    let verifiedUsers = 0;

    usersList.forEach(u => {
        if (u.lastActive && (now - u.lastActive < day)) active++;
        revenue += (u.balance || 0);
        totalTokens += db.getTokenBalance(u);
        totalGems += (u.balance_Gems !== undefined ? u.balance_Gems : (u.Gems !== undefined ? u.Gems : 0));
        totalUsdt += (u.usd !== undefined ? u.usd : 0);
        if (u.successfulVerifications > 0 || u.verified) verifiedUsers++;
    });

    const shopItems = Object.keys(db.data.shopItems || {}).length;
    const accounts = db.data.premiumAccounts ? db.data.premiumAccounts.length : 0;

    // Sum all VPNs
    let totalVpns = 0;
    if (db.data.vpnAccounts) {
        Object.values(db.data.vpnAccounts).forEach(arr => totalVpns += (arr ? arr.length : 0));
    }

    // Sum all Cards (Only for existing services)
    let totalCards = 0;
    if (db.data.cards && db.data.services) {
        Object.keys(db.data.services).forEach(serviceId => {
            const arr = db.data.cards[serviceId];
            totalCards += (arr ? arr.length : 0);
        });
    }

    // Count ALL Emails from Pool (Enhanced to include all categories)
    const pool = db.data.emailPool || {};
    const history = db.data.emailPoolHistory || [];

    let gmailTotal = 0;
    let gmailUsed = 0;

    ['gmail', 'hotmail', 'student'].forEach(t => {
        const typePool = pool[t] || [];
        const available = typePool.filter(e => !e.status || e.status === 'available').length;
        const used = history.filter(h => h.type === t).length;

        gmailTotal += (available + used);
        gmailUsed += used;
    });

    let gmailsUsed = 0;
    // Count total unique mail sessions that have been generated from history
    usersList.forEach(u => {
        if (u.history) {
            u.history.forEach(h => {
                if (h.type && h.type.includes('mail')) {
                    gmailsUsed++;
                }
            });
        }
    });

    // API Stats (Enhanced)
    let apiActiveKeys = 0;
    let apiTotalCalls = 0;
    usersList.forEach(u => {
        if (u.apiKey) {
            if (u.apiStatus === 'allow') apiActiveKeys++;
            apiTotalCalls += (u.apiTotalCalls || 0);
        }
    });

    // Count User API keys (Actual keys held by users)
    let apiKeys = usersList.filter(u => u.apiKey).length;

    // NEW: Calculate deposits, withdrawals, and service stats
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let pendingDeposits = 0;
    let totalServiceStock = 0;

    // Count pending deposits
    const pendingDeps = db.data.pendingDeposits || [];
    pendingDeposits = pendingDeps.length;

    // Calculate from user history
    usersList.forEach(u => {
        if (u.history) {
            u.history.forEach(h => {
                if (h.type === 'deposit' || h.type === 'addTokens') {
                    totalDeposits += h.amount || h.tokens || 0;
                } else if (h.type === 'withdraw' || h.type === 'deductTokens') {
                    totalWithdrawals += h.amount || h.tokens || 0;
                }
            });
        }
    });

    // NEW: Service categories count
    const serviceCategories = (db.data.serviceCategories || []).length;

    // NEW: Calculate total service stock
    const serviceItems = db.data.serviceItems || {};
    Object.values(serviceItems).forEach(item => {
        if (item.stock && Array.isArray(item.stock)) {
            totalServiceStock += item.stock.length;
        }
    });

    // NEW: Last backup time
    const lastBackup = db.data.lastBackup ? new Date(db.data.lastBackup).toLocaleString() : 'Never';

    // NEW: Calculate user growth (compare with last week)
    const weekAgo = now - (7 * day);
    const newUsersThisWeek = usersList.filter(u => u.joinDate && u.joinDate > weekAgo).length;
    const userGrowth = usersList.length > 0 ? Math.round((newUsersThisWeek / usersList.length) * 100) : 0;

    res.json({
        success: true,
        totalUsers: usersList.length,
        totalTokens,
        totalGems,
        totalUsdt,
        verifiedUsers,
        activeToday: active,
        shopItems,
        accounts,
        totalVpns,
        totalCards,
        gmailsUsed,
        apiKeys,
        gmails: {
            total: gmailTotal,
            used: gmailUsed,
            available: gmailTotal - gmailUsed,
            percent: gmailTotal > 0 ? Math.round((gmailUsed / gmailTotal) * 100) : 0
        },
        api: {
            totalKeys: apiKeys,
            activeKeys: apiActiveKeys,
            totalCalls: apiTotalCalls,
            activeUsers: active // Proxy for now
        },
        // New stats
        totalDeposits,
        totalWithdrawals,
        pendingDeposits,
        revenue: totalDeposits,
        serviceCategories,
        totalServiceStock,
        lastBackup,
        userGrowth,
        stats: {
            totalUsers: usersList.length,
            activeUsers: active,
            offlineUsers: usersList.length - active,
            revenue: totalDeposits,
            shopItems,
            accounts,
            totalVpns,
            totalCards,
            gmailsUsed,
            dbSize: (fs.existsSync(db.DB_FILE) ? (fs.statSync(db.DB_FILE).size / 1024).toFixed(2) : 0) + ' KB'
        }
    });
});

// API: Admin - System Info
app.get('/api/admin/system-info', async (req, res) => {
    const usersList = await db.getUsers();
    const groups = db.getGroups();
    const providers = db.getProviders ? db.getProviders().length : 0;
    const accountsCount = db.getAccounts ? db.getAccounts().length : 0;

    // Uptime calculation
    const uptimeInSeconds = process.uptime();
    const hours = Math.floor(uptimeInSeconds / 3600);
    const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
    const uptimeStr = `${hours}h ${minutes}m`;

    // Memory usage
    const mem = process.memoryUsage();
    const memStr = `${(mem.rss / 1024 / 1024).toFixed(2)} MB`;

    res.json({
        success: true,
        uptime: uptimeStr,
        memory: memStr,
        dbSize: (fs.existsSync(db.DB_FILE) ? (fs.statSync(db.DB_FILE).size / 1024).toFixed(2) : 0) + ' KB',
        stats: {
            totalTransactions: db.data.transactions ? db.data.transactions.length : 0,
            totalUsers: usersList.length,
            totalGroups: groups.length,
            totalProviders: providers,
            totalAccounts: accountsCount
        },
        dbSnapshot: {
            users: usersList.length,
            settings: db.data.settings,
            featureFlags: db.data.featureFlags
        }
    });
});

// API: Admin - Card Management
app.get('/api/admin/cards', (req, res) => {
    const cards = [];

    // Legacy card prices
    Object.keys(db.data.cardPrices || {}).forEach(key => {
        cards.push({
            id: key,
            name: db.data.serviceNames?.[key] || key.toUpperCase(),
            price: db.data.cardPrices[key] || 50,
            count: db.data.cards?.[key]?.length || 0,
            imageUrl: db.data.serviceIcons?.[key] || ''
        });
    });

    // Unified Service Items
    Object.keys(db.data.services || {}).forEach(key => {
        const item = db.data.services[key];
        if ((item.section === 'virtual-cards' || item.section === 'cards') && (!db.data.cardPrices || db.data.cardPrices[key] === undefined)) {
            cards.push({
                id: item.id,
                name: item.name || item.id.toUpperCase(),
                price: item.price || item.cost || 0,
                count: db.data.cards?.[item.id]?.length || 0,
                imageUrl: db.data.serviceIcons?.[item.id] || item.imageUrl || ''
            });
        }
    });

    res.json({ success: true, cards });
});

app.post('/api/admin/cards', (req, res) => {
    const { name, price, oldKey } = req.body;
    const key = name.toLowerCase().replace(/\s+/g, '');
    if (!db.data.cardPrices) db.data.cardPrices = {};
    if (!db.data.cards) db.data.cards = {};

    if (oldKey && oldKey !== key) {
        db.data.cardPrices[key] = db.data.cardPrices[oldKey];
        db.data.cards[key] = db.data.cards[oldKey];
        delete db.data.cardPrices[oldKey];
        delete db.data.cards[oldKey];
    }

    db.data.cardPrices[key] = parseInt(price);
    if (!db.data.cards[key]) db.data.cards[key] = [];
    db.save();
    res.json({ success: true });
});

app.delete('/api/admin/cards/:key', (req, res) => {
    const key = req.params.key;
    if (db.data.cardPrices) delete db.data.cardPrices[key];
    if (db.data.cards) delete db.data.cards[key];
    db.save();
    res.json({ success: true });
});

// API: Admin - Group Management
app.get('/api/admin/groups', (req, res) => {
    const groups = db.getGroups();
    res.json({ success: true, groups });
});

// API: Admin - Group Settings (GET)
app.get('/api/admin/group-settings', (req, res) => {
    res.json({ success: true, settings: db.getGroupSettings() });
});

// Compatibility endpoint
app.get('/api/admin/groups/settings', (req, res) => {
    res.json({ success: true, settings: db.getGroupSettings() });
});

// API: Admin - Group Management (POST)
app.post('/api/admin/group-management', (req, res) => {
    const newSettings = req.body;
    if (!db.data.adminSettings) db.data.adminSettings = {};
    db.data.adminSettings.groupManagement = {
        ...db.data.adminSettings.groupManagement,
        ...newSettings
    };
    db.save();
    res.json({ success: true, settings: db.data.adminSettings.groupManagement });
});

// API: Admin - Group Rule Toggle
app.post('/api/admin/groups/toggle', (req, res) => {
    const { key } = req.body;
    if (!key) return res.json({ success: false, message: 'Key required' });

    const settings = db.getGroupSettings();
    settings[key] = !settings[key];
    db.save();
    res.json({ success: true, settings });
});

// API: Admin - VPN Management
app.get('/api/admin/vpn', (req, res) => {
    const vpns = [];
    Object.keys(db.data.vpnPrices || {}).forEach(key => {
        vpns.push({
            id: key,
            name: db.data.vpnServiceNames?.[key] || key,
            price: db.data.vpnPrices[key],
            count: db.data.vpnAccounts?.[key]?.length || 0
        });
    });
    res.json({ success: true, vpns });
});

app.post('/api/admin/vpn', (req, res) => {
    const { name, price, key, oldKey } = req.body;
    const vpnKey = key || name.toLowerCase().replace(/\s+/g, '');

    if (!db.data.vpnPrices) db.data.vpnPrices = {};
    if (!db.data.vpnServiceNames) db.data.vpnServiceNames = {};
    if (!db.data.vpnAccounts) db.data.vpnAccounts = {};

    if (oldKey && oldKey !== vpnKey) {
        db.data.vpnPrices[vpnKey] = db.data.vpnPrices[oldKey];
        db.data.vpnServiceNames[vpnKey] = db.data.vpnServiceNames[oldKey];
        db.data.vpnAccounts[vpnKey] = db.data.vpnAccounts[oldKey];
        delete db.data.vpnPrices[oldKey];
        delete db.data.vpnServiceNames[oldKey];
        delete db.data.vpnAccounts[oldKey];
    }

    db.data.vpnPrices[vpnKey] = parseInt(price);
    db.data.vpnServiceNames[vpnKey] = name;
    if (!db.data.vpnAccounts[vpnKey]) db.data.vpnAccounts[vpnKey] = [];

    db.save();
    res.json({ success: true });
});

app.delete('/api/admin/vpn/:key', (req, res) => {
    const key = req.params.key;
    if (db.data.vpnPrices) delete db.data.vpnPrices[key];
    if (db.data.vpnServiceNames) delete db.data.vpnServiceNames[key];
    if (db.data.vpnAccounts) delete db.data.vpnAccounts[key];
    db.save();
    res.json({ success: true });
});

// API: Admin - App Management
app.get('/api/admin/apps', (req, res) => {
    const apps = Object.values(db.data.settings.premiumApps || {});
    res.json({ success: true, apps });
});

app.post('/api/admin/apps', (req, res) => {
    const { name, link, price, id } = req.body;
    const appId = id || Date.now().toString();
    db.addPremiumApp(appId, name, link, price);
    res.json({ success: true, id: appId });
});

app.delete('/api/admin/apps/:id', (req, res) => {
    const id = req.params.id;
    const success = db.deletePremiumApp(id);
    res.json({ success: success });
});

// API: Admin - Task Management
app.get('/api/admin/tasks', (req, res) => {
    try {
        // Ensure db.data exists
        if (!db.data) {
            db.data = {};
        }
        // Ensure tasks object exists
        if (!db.data.tasks) {
            db.data.tasks = {};
        }

        const tasks = Object.entries(db.data.tasks || {}).map(([id, t]) => ({ id, ...t }));
        res.json({ success: true, tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch tasks',
            tasks: []
        });
    }
});

app.post('/api/admin/tasks', (req, res) => {
    const { name, url, reward, gems, icon } = req.body;
    const id = db.createTask(name, url, reward, gems, icon);

    // Save the new task back to global DB explicitly to be safe
    db.save();

    res.json({ success: true, id });
});

// Update task (edit tokens, gems, name, url, and icon)
app.put('/api/admin/tasks/:id', (req, res) => {
    const id = req.params.id;
    const { reward, gems, name, url, icon } = req.body;

    if (!db.data.tasks || !db.data.tasks[id]) {
        return res.json({ success: false, message: 'Task not found' });
    }

    // Update task fields
    if (reward !== undefined) db.data.tasks[id].reward = parseInt(reward) || 0;
    if (gems !== undefined) db.data.tasks[id].gems = parseInt(gems) || 0;
    if (name !== undefined) db.data.tasks[id].name = name;
    if (url !== undefined) db.data.tasks[id].url = url;
    if (icon !== undefined) db.data.tasks[id].icon = icon;
    db.save();
});

// API: Admin - Payment Platforms Management
app.get('/api/admin/payment-platforms', (req, res) => {
    try {
        const platforms = db.data.paymentPlatforms || [];
        res.json({ success: true, platforms });
    } catch (error) {
        console.error('Error fetching payment platforms:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment platforms', platforms: [] });
    }
});

app.post('/api/admin/payment-platforms', (req, res) => {
    try {
        const { platforms } = req.body;
        if (!Array.isArray(platforms)) {
            return res.json({ success: false, message: 'Invalid platforms data' });
        }
        db.data.paymentPlatforms = platforms;
        db.save();
        res.json({ success: true, message: 'Payment platforms saved successfully' });
    } catch (error) {
        console.error('Error saving payment platforms:', error);
        res.status(500).json({ success: false, message: 'Failed to save payment platforms' });
    }
});

// API: Public - Get Payment Platforms (for user panel)
app.get('/api/payment-platforms', (req, res) => {
    try {
        const platforms = db.data.paymentPlatforms || [];
        res.json({ success: true, platforms });
    } catch (error) {
        console.error('Error fetching payment platforms:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment platforms', platforms: [] });
    }
});

// Reset task for all users (remove from completedTasks)
app.post('/api/admin/tasks/:id/reset', (req, res) => {
    const taskId = req.params.id;

    if (!db.data.tasks || !db.data.tasks[taskId]) {
        return res.json({ success: false, message: 'Task not found' });
    }

    let affectedUsers = 0;

    // Remove this task from all users' completedTasks
    Object.values(db.data.users || {}).forEach(user => {
        if (user.completedTasks && user.completedTasks.includes(taskId)) {
            user.completedTasks = user.completedTasks.filter(t => t !== taskId);
            affectedUsers++;
        }
        // Also remove legacy task IDs that might match
        const legacyIds = ['yt', 'tg', 'tg_ch', 'youtube', 'telegram', 'telegram_channel'];
        if (legacyIds.includes(taskId) && user.completedTasks) {
            const hadLegacy = user.completedTasks.some(t => legacyIds.includes(t));
            if (hadLegacy) {
                user.completedTasks = user.completedTasks.filter(t => !legacyIds.includes(t));
                if (!user.completedTasks.includes(taskId)) affectedUsers++;
            }
        }
    });

    db.save();

    res.json({
        success: true,
        message: `Task reset for ${affectedUsers} users`,
        affectedUsers: affectedUsers
    });
});

app.delete('/api/admin/tasks/:id', (req, res) => {
    const id = req.params.id;
    const success = db.deleteTask(id);
    res.json({ success });
});

// API: Reset/Seed Default Tasks
app.post('/api/admin/tasks/seed-defaults', (req, res) => {
    const defaultTasks = {
        "task_youtube": {
            name: "Youtube Channel",
            url: "https://www.youtube.com/@MamunIslamyts",
            reward: 10,
            gems: 1
        },
        "task_telegram_group": {
            name: "Telegram Group",
            url: "https://t.me/AutosVerifyCh",
            reward: 10,
            gems: 1
        },
        "task_telegram_channel": {
            name: "Telegram Channel",
            url: "https://t.me/AutosVerify",
            reward: 10,
            gems: 1
        }
    };

    if (!db.data.tasks) db.data.tasks = {};

    let addedCount = 0;
    let updatedCount = 0;

    // Add or update default tasks
    Object.entries(defaultTasks).forEach(([id, task]) => {
        if (!db.data.tasks[id]) {
            db.data.tasks[id] = task;
            addedCount++;
        } else {
            // Update existing task to ensure correct values
            db.data.tasks[id].name = task.name;
            db.data.tasks[id].url = task.url;
            db.data.tasks[id].reward = task.reward;
            db.data.tasks[id].gems = task.gems;
            updatedCount++;
        }
    });

    // Reset all tasks for all users so they can do them again
    const allTaskIds = Object.keys(db.data.tasks || {});
    let affectedUsers = 0;

    Object.values(db.data.users || {}).forEach(user => {
        if (user.completedTasks) {
            const initialLength = user.completedTasks.length;
            user.completedTasks = user.completedTasks.filter(t => !allTaskIds.includes(t));
            if (user.completedTasks.length < initialLength) {
                affectedUsers++;
            }
        }
    });

    // Remove old legacy task IDs that are no longer used
    const legacyIdsToRemove = ['tg_ch', 'telegram_channel'];
    legacyIdsToRemove.forEach(id => {
        if (db.data.tasks[id]) {
            delete db.data.tasks[id];
        }
    });

    db.save();
    res.json({
        success: true,
        message: `Added ${addedCount} new tasks, updated ${updatedCount} existing tasks. Reset for ${affectedUsers} users.`,
        totalTasks: Object.keys(db.data.tasks).length
    });
});

// Auto-seed default tasks on server startup (if no tasks exist, also fix existing ones)
(function autoSeedDefaultTasks() {
    const defaultTasks = {
        "task_youtube": {
            name: "Youtube Channel",
            url: "https://www.youtube.com/@MamunIslamyts",
            reward: 10,
            gems: 1
        },
        "task_telegram_group": {
            name: "Telegram Group",
            url: "https://t.me/AutosVerifyCh",
            reward: 10,
            gems: 1
        },
        "task_telegram_channel": {
            name: "Telegram Channel",
            url: "https://t.me/AutosVerify",
            reward: 10,
            gems: 1
        }
    };

    if (!db.data.tasks) db.data.tasks = {};

    let addedCount = 0;
    let updatedCount = 0;

    // Add missing tasks and fix existing ones
    Object.entries(defaultTasks).forEach(([id, task]) => {
        if (!db.data.tasks[id]) {
            db.data.tasks[id] = task;
            addedCount++;
        } else {
            // Fix existing task values
            db.data.tasks[id].name = task.name;
            db.data.tasks[id].url = task.url;
            db.data.tasks[id].reward = task.reward;
            db.data.tasks[id].gems = task.gems;
            updatedCount++;
        }
    });

    // Remove old legacy task IDs that are no longer used
    const legacyIdsToRemove = ['tg_ch', 'telegram_channel'];
    let removedCount = 0;
    legacyIdsToRemove.forEach(id => {
        if (db.data.tasks[id]) {
            delete db.data.tasks[id];
            removedCount++;
        }
    });

    if (addedCount > 0 || updatedCount > 0 || removedCount > 0) {
        db.save();
        console.log(`✅ Tasks synced: ${addedCount} added, ${updatedCount} updated, ${removedCount} removed`);
    }
})();

app.post('/api/admin/groups/leave', async (req, res) => {
    const { chatId } = req.body;
    if (!bot) return res.json({ success: false, message: 'Bot not ready' });
    try {
        await bot.leaveChat(chatId);
        // Remove from DB if needed, or wait for event
        // db.removeGroup(chatId); // Assuming db has this or we manipulate data directly
        if (db.data.groups && db.data.groups[chatId]) {
            delete db.data.groups[chatId];
            db.save();
        } else if (Array.isArray(db.data.groups)) {
            db.data.groups = db.data.groups.filter(g => g.id.toString() !== chatId.toString());
            db.save();
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// API: Cost Management (Get)
app.get('/api/admin/costs', (req, res) => {
    const settings = db.getSettings();
    const adminSettings = db.data.adminSettings || {};
    const costs = settings.costs || {};
    const cardPrices = db.data.cardPrices || {};
    const vpnPrices = db.data.vpnPrices || {};
    const creditRates = adminSettings.creditRates || { crypto: 0.01, bkash: 1, nagad: 1 };

    res.json({
        success: true,
        costs: {
            // Rewards & Bonuses
            quizReward: settings.quizReward || 0,
            spaceReward: settings.spaceReward || 0,
            inviteBonus: settings.refBonus || 0,
            welcomeBonus: adminSettings.welcomeCredits || 0,
            adReward: settings.adReward || 5,
            zeroBalanceAdReward: settings.zeroBalanceAdReward || 5,
            taskReward: settings.taskReward || 10,

            // System Costs
            premiumEmailCost: settings.premiumEmailCost || 0,

            // System Fees
            exchangeFee: settings.exchangeFee || 2,
            transferFee: settings.transferFee || 5,
            supportCost: settings.supportCost || 0,

            // Service Costs (Tokens)
            gmailCost: costs.gmail || 20,
            hotmailCost: costs.hotmail || 25,
            tempMailCost: costs.tempmail || 10,
            studentEmailCost: costs.student || 50,
            renewMailCost: costs.renewmail || 30,
            verificationCost: costs.verification || 10,
            numberCost: costs.number || 15,
            geminiCost: costs.gemini || 50,
            chatgptCost: costs.gpt || 100,
            spotifyCost: costs.spotify || 50,
            youtubeCost: costs.youtube || 50,
            teacherCost: costs.teacher || 100,
            militaryCost: costs.military || 100,
            live2fa: costs.live2fa || 10,
            liveInstagram: costs.liveInstagram || 10,
            liveFacebook: costs.liveFacebook || 10,
            liveTiktok: costs.liveTiktok || 10,
            liveTwitter: costs.liveTwitter || 10,
            liveThreads: costs.liveThreads || 10,
            live2faCurrency: costs.live2faCurrency || 'token',
            liveInstagramCurrency: costs.liveInstagramCurrency || 'token',
            liveFacebookCurrency: costs.liveFacebookCurrency || 'token',
            liveTiktokCurrency: costs.liveTiktokCurrency || 'token',
            liveTwitterCurrency: costs.liveTwitterCurrency || 'token',
            liveThreadsCurrency: costs.liveThreadsCurrency || 'token',

            // USD Costs
            accountsUSD: costs.accountsUSD || 1.00,
            vpnUSD: costs.vpnUSD || 2.00,
            vccUSD: costs.vccUSD || 5.00,
            premiumMailUSD: costs.premiumMailUSD || 0.50,

            // Credit Exchange Rates
            cryptoRate: creditRates.crypto || 0.01,
            bkashRate: creditRates.bkash || 1,
            nagadRate: creditRates.nagad || 1,

            // Local Payment Platforms
            bkashName: settings.bkashName || 'bKash Personal',
            bkashNumber: settings.bkashNumber || '',
            bkashType: settings.bkashType || 'Personal',
            nagadName: settings.nagadName || 'Nagad Personal',
            nagadNumber: settings.nagadNumber || '',
            nagadType: settings.nagadType || 'Personal',

            // Exchange Rates (USD/Tokens/Gems)
            usdToToken: settings.usdToToken || 100,
            gemToToken: settings.gemToToken || 100,
            tokenToGem: settings.tokenToGem || 1,
            takaToGem: settings.takaToGem || 100,
            platformFee: settings.platformFee || 20,

            // Card Prices (TC)
            geminiCardPrice: cardPrices.gemini || 150,
            chatgptCardPrice: cardPrices.chatgpt || 200,
            spotifyCardPrice: cardPrices.spotify || 50,

            // VPN Prices (TC)
            nordvpnPrice: vpnPrices.nordvpn || 100,
            expressvpnPrice: vpnPrices.expressvpn || 120,
            surfsharkPrice: vpnPrices.surfshark || 80,
            cyberghostPrice: vpnPrices.cyberghost || 70,
            protonvpnPrice: vpnPrices.protonvpn || 90
        },
        sellingRewards: db.data.sellingRewards || {},
        dbSize: (fs.existsSync(db.DB_FILE) ? (fs.statSync(db.DB_FILE).size / 1024).toFixed(2) : 0) + ' KB'
    });
});

// Public API: Get Costs (for user panel)
app.get('/api/public/costs', (req, res) => {
    const settings = db.getSettings();
    const adminSettings = db.data.adminSettings || {};
    const costs = settings.costs || {};
    const creditRates = adminSettings.creditRates || { crypto: 0.01, bkash: 1, nagad: 1 };

    res.json({
        success: true,
        costs: {
            quizReward: settings.quizReward || 0,
            spaceReward: settings.spaceReward || 0,
            inviteBonus: settings.refBonus || 0,
            welcomeBonus: adminSettings.welcomeCredits || 0,
            adReward: settings.adReward || 5,
            zeroBalanceAdReward: settings.zeroBalanceAdReward || 5,
            taskReward: settings.taskReward || 10,
            transferFee: settings.transferFee || 0,
            supportCost: settings.supportCost || 0,
            gmailCost: costs.gmail || 0,
            verificationCost: costs.verification || 0,
            numberCost: costs.number || 0,
            live2fa: costs.live2fa || 10,
            liveInstagram: costs.liveInstagram || 10,
            liveFacebook: costs.liveFacebook || 10,
            liveTiktok: costs.liveTiktok || 10,
            liveTwitter: costs.liveTwitter || 10,
            liveThreads: costs.liveThreads || 10,
            live2faCurrency: costs.live2faCurrency || 'token',
            liveInstagramCurrency: costs.liveInstagramCurrency || 'token',
            liveFacebookCurrency: costs.liveFacebookCurrency || 'token',
            liveTiktokCurrency: costs.liveTiktokCurrency || 'token',
            liveTwitterCurrency: costs.liveTwitterCurrency || 'token',
            liveThreadsCurrency: costs.liveThreadsCurrency || 'token',
            usdToToken: settings.usdToToken || 100,
            gemToToken: settings.gemToToken || 100,
            tokenToGem: settings.tokenToGem || 1,
            takaToGem: settings.takaToGem || 100,
            platformFee: settings.platformFee || 20,
            cryptoRate: creditRates.crypto || 0.01,
            bkashRate: creditRates.bkash || 1,
            nagadRate: creditRates.nagad || 1
        }
    });
});

// API: Cost Management (Save)
app.post('/api/admin/costs', (req, res) => {
    const payload = req.body;
    if (!payload) return res.json({ success: false, message: 'Invalid payload' });

    if (!db.data.settings) db.data.settings = {};
    if (!db.data.adminSettings) db.data.adminSettings = {};

    // Base Settings & Rewards
    if (payload.quizReward !== undefined) db.data.settings.quizReward = parseInt(payload.quizReward);
    if (payload.spaceReward !== undefined) db.data.settings.spaceReward = parseInt(payload.spaceReward);
    if (payload.inviteBonus !== undefined) db.data.settings.refBonus = parseInt(payload.inviteBonus);
    if (payload.adReward !== undefined) db.data.settings.adReward = parseInt(payload.adReward);
    if (payload.zeroBalanceAdReward !== undefined) db.data.settings.zeroBalanceAdReward = parseInt(payload.zeroBalanceAdReward);
    if (payload.taskReward !== undefined) db.data.settings.taskReward = parseInt(payload.taskReward);

    // System Costs
    if (payload.premiumEmailCost !== undefined) db.data.settings.premiumEmailCost = parseInt(payload.premiumEmailCost);

    if (payload.exchangeFee !== undefined) db.data.settings.exchangeFee = parseInt(payload.exchangeFee);
    if (payload.transferFee !== undefined) db.data.settings.transferFee = parseInt(payload.transferFee);
    if (payload.supportCost !== undefined) db.data.settings.supportCost = parseInt(payload.supportCost);

    if (payload.welcomeBonus !== undefined) {
        db.data.adminSettings.welcomeCredits = parseInt(payload.welcomeBonus);
    }

    // Credit Exchange Rates
    if (!db.data.adminSettings.creditRates) db.data.adminSettings.creditRates = {};
    if (payload.cryptoRate !== undefined) db.data.adminSettings.creditRates.crypto = parseFloat(payload.cryptoRate);
    if (payload.bkashRate !== undefined) db.data.adminSettings.creditRates.bkash = parseFloat(payload.bkashRate);
    if (payload.nagadRate !== undefined) db.data.adminSettings.creditRates.nagad = parseFloat(payload.nagadRate);

    // Local Payment Platforms
    if (payload.bkashName !== undefined) db.data.settings.bkashName = payload.bkashName;
    if (payload.bkashNumber !== undefined) db.data.settings.bkashNumber = payload.bkashNumber;
    if (payload.bkashType !== undefined) db.data.settings.bkashType = payload.bkashType;
    if (payload.nagadName !== undefined) db.data.settings.nagadName = payload.nagadName;
    if (payload.nagadNumber !== undefined) db.data.settings.nagadNumber = payload.nagadNumber;
    if (payload.nagadType !== undefined) db.data.settings.nagadType = payload.nagadType;

    // Exchange Rates (USD/Tokens/Gems)
    if (payload.usdToToken !== undefined) db.data.settings.usdToToken = parseInt(payload.usdToToken) || 100;
    if (payload.gemToToken !== undefined) db.data.settings.gemToToken = parseInt(payload.gemToToken) || 100;
    if (payload.tokenToGem !== undefined) db.data.settings.tokenToGem = parseFloat(payload.tokenToGem) || 1;
    if (payload.takaToGem !== undefined) db.data.settings.takaToGem = parseInt(payload.takaToGem) || 100;
    if (payload.platformFee !== undefined) db.data.settings.platformFee = parseInt(payload.platformFee) || 20;

    // Service Costs (Nested in costs)
    if (!db.data.settings.costs) db.data.settings.costs = {};
    if (payload.gmailCost !== undefined) db.data.settings.costs.gmail = parseInt(payload.gmailCost);
    if (payload.hotmailCost !== undefined) db.data.settings.costs.hotmail = parseInt(payload.hotmailCost);
    if (payload.tempMailCost !== undefined) db.data.settings.costs.tempmail = parseInt(payload.tempMailCost);
    if (payload.studentEmailCost !== undefined) db.data.settings.costs.student = parseInt(payload.studentEmailCost);
    if (payload.renewMailCost !== undefined) db.data.settings.costs.renewmail = parseInt(payload.renewMailCost);
    if (payload.verificationCost !== undefined) db.data.settings.costs.verification = parseInt(payload.verificationCost);
    if (payload.numberCost !== undefined) db.data.settings.costs.number = parseInt(payload.numberCost);
    if (payload.geminiCost !== undefined) db.data.settings.costs.gemini = parseInt(payload.geminiCost);
    if (payload.chatgptCost !== undefined) db.data.settings.costs.gpt = parseInt(payload.chatgptCost);
    if (payload.spotifyCost !== undefined) db.data.settings.costs.spotify = parseInt(payload.spotifyCost);
    if (payload.youtubeCost !== undefined) db.data.settings.costs.youtube = parseInt(payload.youtubeCost);
    if (payload.teacherCost !== undefined) db.data.settings.costs.teacher = parseInt(payload.teacherCost);
    if (payload.militaryCost !== undefined) db.data.settings.costs.military = parseInt(payload.militaryCost);
    if (payload.live2faCost !== undefined) db.data.settings.costs.live2fa = parseInt(payload.live2faCost);
    if (payload.liveInstagramCost !== undefined) db.data.settings.costs.liveInstagram = parseInt(payload.liveInstagramCost);
    if (payload.liveFacebookCost !== undefined) db.data.settings.costs.liveFacebook = parseInt(payload.liveFacebookCost);
    if (payload.liveTiktokCost !== undefined) db.data.settings.costs.liveTiktok = parseInt(payload.liveTiktokCost);
    if (payload.liveTwitterCost !== undefined) db.data.settings.costs.liveTwitter = parseInt(payload.liveTwitterCost);
    if (payload.liveThreadsCost !== undefined) db.data.settings.costs.liveThreads = parseInt(payload.liveThreadsCost);
    if (payload.live2faCurrency !== undefined) db.data.settings.costs.live2faCurrency = payload.live2faCurrency;
    if (payload.liveInstagramCurrency !== undefined) db.data.settings.costs.liveInstagramCurrency = payload.liveInstagramCurrency;
    if (payload.liveFacebookCurrency !== undefined) db.data.settings.costs.liveFacebookCurrency = payload.liveFacebookCurrency;
    if (payload.liveTiktokCurrency !== undefined) db.data.settings.costs.liveTiktokCurrency = payload.liveTiktokCurrency;
    if (payload.liveTwitterCurrency !== undefined) db.data.settings.costs.liveTwitterCurrency = payload.liveTwitterCurrency;
    if (payload.liveThreadsCurrency !== undefined) db.data.settings.costs.liveThreadsCurrency = payload.liveThreadsCurrency;

    // USD Costs
    if (payload.accountsUSD !== undefined) db.data.settings.costs.accountsUSD = parseFloat(payload.accountsUSD);
    if (payload.vpnUSD !== undefined) db.data.settings.costs.vpnUSD = parseFloat(payload.vpnUSD);
    if (payload.vccUSD !== undefined) db.data.settings.costs.vccUSD = parseFloat(payload.vccUSD);
    if (payload.premiumMailUSD !== undefined) db.data.settings.costs.premiumMailUSD = parseFloat(payload.premiumMailUSD);

    // Card Prices
    if (!db.data.cardPrices) db.data.cardPrices = {};
    if (payload.geminiCardPrice !== undefined) db.data.cardPrices.gemini = parseInt(payload.geminiCardPrice);
    if (payload.chatgptCardPrice !== undefined) db.data.cardPrices.chatgpt = parseInt(payload.chatgptCardPrice);
    if (payload.spotifyCardPrice !== undefined) db.data.cardPrices.spotify = parseInt(payload.spotifyCardPrice);

    // VPN Prices
    if (!db.data.vpnPrices) db.data.vpnPrices = {};
    if (payload.nordvpnPrice !== undefined) db.data.vpnPrices.nordvpn = parseInt(payload.nordvpnPrice);
    if (payload.expressvpnPrice !== undefined) db.data.vpnPrices.expressvpn = parseInt(payload.expressvpnPrice);
    if (payload.surfsharkPrice !== undefined) db.data.vpnPrices.surfshark = parseInt(payload.surfsharkPrice);
    if (payload.cyberghostPrice !== undefined) db.data.vpnPrices.cyberghost = parseInt(payload.cyberghostPrice);
    if (payload.protonvpnPrice !== undefined) db.data.vpnPrices.protonvpn = parseInt(payload.protonvpnPrice);

    // Selling Rewards
    if (payload.sellingRewards) {
        db.data.sellingRewards = { ...db.data.sellingRewards, ...payload.sellingRewards };
    }

    db.save(true);
    res.json({ success: true, message: 'All cost configurations saved successfully' });
});

// API: User - Send Message to Admin
app.post('/api/user/send-message', async (req, res) => {
    const { userId, message } = req.body;
    if (!userId || !message) return res.json({ success: false, message: 'User ID and message are required' });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    // Store message for Admin UI
    if (!user.supportMessages) user.supportMessages = [];
    user.supportMessages.push({
        sender: 'user',
        message: message,
        timestamp: new Date().toISOString()
    });

    // Notify Admin via Telegram if available
    const config = db.data.apiKeys || {};
    if (config.botToken && config.ADMIN_ID) {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(config.botToken);
        const name = user.firstName || user.username || userId;
        const msg = `📬 <b>New User Message</b>\n\nUser: <b>${name}</b> (<code>${userId}</code>)\nMessage: ${message}\n\n<i>Reply from Web Admin Panel.</i>`;
        bot.sendMessage(config.ADMIN_ID, msg, { parse_mode: 'HTML' }).catch(e => console.error('Support notify error:', e.message));
    }

    res.json({ success: true, message: 'Message sent to support' });
});

// API: User - Get Messages
app.get('/api/user/messages', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, message: 'User ID required' });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, messages: [] });

    // Consolidate admin replies (from pendingWebMessages) and user messages
    // (Deprecated old pendingWebMessages queue)

    res.json({ success: true, messages: user.supportMessages || [] });
});

// API: Admin - Send Message to User
app.post('/api/admin/send-message', async (req, res) => {
    const { userId, message } = req.body;
    if (!userId || !message) return res.json({ success: false, message: 'User ID and message are required' });

    // Store message for Web UI
    const user = await db.getUser(userId);
    if (user) {
        if (!user.supportMessages) user.supportMessages = [];
        user.supportMessages.push({
            sender: 'admin',
            message: message,
            timestamp: new Date().toISOString()
        });

        // Notifications System push
        if (!user.notifications) user.notifications = [];
        user.notifications.unshift({
            id: Date.now().toString() + Math.random().toString(36).substring(7),
            type: 'message',
            title: 'New Message from Admin',
            message: message,
            timestamp: new Date().toISOString(),
            read: false
        });

        await db.updateUser(user);
    }

    if (!bot) {
        // If bot is not fully active, just return success since we saved it for web
        return res.json({ success: true, message: 'Saved to web panel (Bot offline)' });
    }

    bot.sendMessage(userId, message)
        .then(() => res.json({ success: true }))
        .catch(err => res.json({ success: true, message: 'Message sent to web UI but bot failed: ' + err.message }));
});

// API: Admin - Send Gift to User
app.post('/api/admin/send-gift', async (req, res) => {
    const { userId, currency, amount, note } = req.body;
    if (!userId || !currency || !amount || amount <= 0) {
        return res.json({ success: false, message: 'User ID, currency, and valid amount are required' });
    }

    const validCurrencies = ['tokens', 'Gems', 'usd'];
    if (!validCurrencies.includes(currency)) {
        return res.json({ success: false, message: 'Invalid currency. Use tokens, Gems, or usd' });
    }

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    // Store as pending gift (user must claim via ad)
    if (!user.pendingGifts) user.pendingGifts = [];
    const giftId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    user.pendingGifts.push({
        id: giftId,
        currency: currency,
        amount: parseFloat(amount),
        note: note || 'Admin Gift',
        timestamp: Date.now(),
        claimed: false
    });

    if (!user.notifications) user.notifications = [];
    user.notifications.unshift({
        id: 'gift-' + giftId,
        type: 'gift',
        title: '🎁 You received a gift!',
        message: `${amount} ${currency === 'tokens' ? 'Tokens' : currency === 'Gems' ? 'Gems' : 'USD'}${note ? ' — ' + note : ''}`,
        timestamp: new Date().toISOString(),
        read: false,
        giftId: giftId,
        currency: currency,
        amount: parseFloat(amount)
    });

    await db.updateUser(user);
    res.json({ success: true, giftId, message: `Gift of ${amount} ${currency} sent to user ${userId}` });
});

// API: User - Get Pending Gifts
app.get('/api/user/gifts', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, gifts: [] });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, gifts: [] });

    const pendingGifts = (user.pendingGifts || []).filter(g => !g.claimed);
    res.json({ success: true, gifts: pendingGifts });
});

// API: User - Get Notifications
app.get('/api/user/notifications', async (req, res) => {
    const { userId } = req.query;
    console.log(`[GET_NOTIFICATIONS] Requested for user: ${userId}`);
    if (!userId) return res.json({ success: false, notifications: [] });

    const user = await db.getUser(userId);
    if (!user) {
        console.log(`[GET_NOTIFICATIONS] User not found: ${userId}`);
        return res.json({ success: false, notifications: [] });
    }

    console.log(`[GET_NOTIFICATIONS] Found ${user.notifications ? user.notifications.length : 0} notifications for user: ${userId}`);

    // Mark gift notifications with claimed state
    const notifs = (user.notifications || []).map(n => {
        if (n.type === 'gift') {
            const gift = (user.pendingGifts || []).find(g => g.id === n.giftId);
            if (gift) {
                n.claimed = gift.claimed;
            } else {
                n.claimed = true; // if missing, assume claimed
            }
        }
        return n;
    });

    res.json({ success: true, notifications: notifs });
});

// API: User - Mark Notification Read
app.post('/api/user/notifications/read', async (req, res) => {
    const { userId, notificationId } = req.body;
    if (!userId || !notificationId) return res.json({ success: false });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false });

    if (user.notifications) {
        let n = user.notifications.find(n => n.id === notificationId);
        if (n) {
            n.read = true;
            await db.updateUser(user);
        }
    }
    res.json({ success: true });
});

// API: Claim Gift (after ad watch)
app.post('/api/gift/claim', async (req, res) => {
    const { userId, giftId } = req.body;
    if (!userId || !giftId) return res.json({ success: false, message: 'User ID and Gift ID required' });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    if (!user.pendingGifts) return res.json({ success: false, message: 'No gifts found' });

    const gift = user.pendingGifts.find(g => g.id === giftId);
    if (!gift) return res.json({ success: false, message: 'Gift not found' });
    if (gift.claimed) return res.json({ success: false, message: 'Gift already claimed' });

    // Add balance based on currency
    const { currency, amount } = gift;
    if (currency === 'tokens') {
        const current = db.getTokenBalance(user);
        db.setTokenBalance(user, current + parseInt(amount));
    } else if (currency === 'Gems') {
        user.Gems = (user.Gems || 0) + parseInt(amount);
    } else if (currency === 'usd') {
        user.usd = parseFloat(((user.usd || 0) + parseFloat(amount)).toFixed(3));
    }

    // Mark as claimed
    gift.claimed = true;
    gift.claimedAt = Date.now();

    // Add to user history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'gift_claimed',
        amount: amount,
        currency: currency,
        date: Date.now(),
        detail: gift.note || 'Admin Gift'
    });

    // Add global transaction
    db.addTransaction(userId, 'gift', amount, currency === 'tokens' ? 'TC' : currency === 'Gems' ? 'JS' : 'USD', `Gift Claimed: ${gift.note || 'Admin Gift'}`, 'gift');

    await db.updateUser(user);

    const currencyLabel = currency === 'tokens' ? 'Tokens' : currency === 'Gems' ? 'Gems' : 'USD';
    res.json({
        success: true,
        message: `Gift claimed! +${amount} ${currencyLabel}`,
        currency: currency,
        amount: amount,
        newTokens: db.getTokenBalance(user),
        newGems: user.Gems || 0,
        newUsd: user.usd || 0
    });
});

// API: Admin - Delete Single History Item
app.delete('/api/admin/history-item/:userId/:date', (req, res) => {
    const { userId, date } = req.params;
    const users = db.data.users || {};
    const user = users[userId];

    if (!user || !user.history) {
        return res.json({ success: false, message: 'User or history not found' });
    }

    const decodedDate = decodeURIComponent(date);
    const initialLength = user.history.length;

    // Filter out the item with matching date
    // We compare strings to be safe across types
    user.history = user.history.filter(h => {
        if (!h.date) return true;
        const hDateStr = String(h.date);
        return hDateStr !== decodedDate && hDateStr !== date;
    });

    if (user.history.length !== initialLength) {
        db.save();
        res.json({ success: true, message: 'Item deleted' });
    } else {
        // Fallback: If no exact match, try comparing as numbers if applicable
        const dateNum = Number(decodedDate);
        if (!isNaN(dateNum)) {
            user.history = user.history.filter(h => Number(h.date) !== dateNum);
            if (user.history.length !== initialLength) {
                db.save();
                return res.json({ success: true, message: 'Item deleted (matched as number)' });
            }
        }
        res.json({ success: false, message: 'Item not found in user history' });
    }
});

// API: Admin - Reset Only History Logs (Transactions)
app.post('/api/admin/reset-history', (req, res) => {
    try {
        db.data.transactions = [];
        const users = db.data.users || {};
        Object.keys(users).forEach(uid => {
            if (users[uid].history) {
                users[uid].history = [];
            }
        });
        db.save();
        res.json({ success: true, message: 'Transaction history log cleared' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Reset Leaderboard Stats (Ranking Data)
app.post('/api/admin/reset-leaderboards', (req, res) => {
    try {
        const users = db.data.users || {};
        Object.keys(users).forEach(uid => {
            const user = users[uid];
            user.successfulVerifications = 0;
            user.failedVerifications = 0;
            user.cardsPurchased = 0;
            user.referralCount = 0;
            // Also reset points/spending if needed
            if (user.history) {
                // If user wants to keep history but clear leaderboard, 
                // we might need to filter or keep it.
                // But usually leaderboards are calculated from history in this app.
                // To clear leaderboards specifically, we reset the cumulative stats.
            }
        });
        db.save();
        res.json({ success: true, message: 'Leaderboard and user stats reset' });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - Clear All Transactions (Old Alias)
app.post('/api/admin/reset-transactions', (req, res) => {
    db.data.transactions = [];
    const users = db.data.users || {};
    Object.keys(users).forEach(uid => {
        if (users[uid].history) users[uid].history = [];
    });
    db.save();
    res.json({ success: true, message: 'All transactions cleared' });
});

// API: Reset / Clear Database (Use with caution)
app.post('/api/admin/db/reset', (req, res) => {
    // Only allow if authenticated adequately (simple Admin check handled by UI mostly, backend should verify token in real app)
    // For now, we clear users or groups? User asked for "Control". 
    // Maybe just Clear Cache or Logs?
    // Let's implemented "Clear Transactions"
    db.data.transactions = [];
    db.save();
    res.json({ success: true, message: 'Transactions cleared' });
});

// API: Database Export (Send to Admin)
app.get('/api/admin/db/export', async (req, res) => {
    try {
        const result = await _runBackup('manual');
        res.json({ success: true, message: 'Manual backup generated and sent to Telegram', file: result.fileName });
    } catch (e) {
        console.error('Export error:', e);
        res.json({ success: false, message: e.message });
    }
});

// API: Database Import
app.post('/api/admin/db/import', async (req, res) => {
    try {
        const newData = req.body.data;
        if (!newData || typeof newData !== 'object') {
            return res.json({ success: false, message: 'Invalid JSON data' });
        }

        // Merge or Replace core objects
        db.data.users = { ...(db.data.users || {}), ...(newData.users || {}) };
        if (newData.settings) db.data.settings = { ...(db.data.settings || {}), ...newData.settings };
        if (newData.cardPrices) db.data.cardPrices = { ...(db.data.cardPrices || {}), ...newData.cardPrices };
        if (newData.vpnPrices) db.data.vpnPrices = { ...(db.data.vpnPrices || {}), ...newData.vpnPrices };
        if (newData.cards) db.data.cards = { ...(db.data.cards || {}), ...newData.cards };
        if (newData.vpnAccounts) db.data.vpnAccounts = { ...(db.data.vpnAccounts || {}), ...newData.vpnAccounts };
        if (newData.tasks) db.data.tasks = { ...(db.data.tasks || {}), ...newData.tasks };
        Object.keys(newData).forEach(key => {
            if (!db.data[key]) db.data[key] = newData[key];
        });

        db.save();

        const adminId = process.env.ADMIN_ID;
        if (bot && adminId) {
            await bot.sendMessage(adminId, '✅ <b>Database Imported & Merged</b>\n\nA new JSON database file was uploaded via Web Admin.', { parse_mode: 'HTML' });
        }

        res.json({ success: true, message: 'Database updated successfully' });
    } catch (e) {
        console.error('Import error:', e);
        res.json({ success: false, message: e.message });
    }
});

// API: Database Wipe
app.post('/api/admin/db/wipe', async (req, res) => {
    try {
        // Resetting the data to empty objects for test and user data
        db.data.users = {};
        db.data.transactions = [];
        db.data.payments = [];
        db.data.tickets = [];
        db.data.mailSessions = {};
        db.data.numberSessions = {};
        db.data.gmails = [];

        db.save();

        const adminId = process.env.ADMIN_ID;
        if (bot && adminId) {
            await bot.sendMessage(adminId, '⚠️ <b>Database Wiped</b>\n\nAll users, test, and demo data were permanently deleted via Web Admin.', { parse_mode: 'HTML' });
        }

        res.json({ success: true, message: 'Database wiped successfully' });
    } catch (e) {
        console.error('Wipe error:', e);
        res.json({ success: false, message: e.message });
    }
});

// Duplicate database routes removed to resolve conflicts and prevent server restart loops.
// The primary implementations remain active at lines 252-288.

// API: Admin - Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = typeof getUsersObj === 'function' ? getUsersObj() : {};
        const totalUsers = Object.keys(users).length;

        res.json({
            success: true,
            totalUsers: totalUsers,
            activeToday: 0,
            totalTokens: 0,
            totalGems: 0,
            totalUsdt: 0,
            verifiedUsers: 0,
            shopItems: 0,
            accounts: 0,
            gmailsUsed: 0,
            totalVpns: 0,
            totalCards: 0,
            apiKeys: 0,
            totalDeposits: 0,
            totalWithdrawals: 0,
            pendingDeposits: 0,
            revenue: 0,
            serviceCategories: 0,
            totalServiceStock: 0,
            lastBackup: 'Never',
            gmails: { used: 0, total: 0 },
            api: { activeKeys: 0, totalCalls: 0, activeUsers: 0 }
        });
    } catch (e) {
        console.error('Error in /api/admin/stats:', e);
        res.json({ success: false, message: e.message });
    }
});



// API: Admin - Provider Management
app.get('/api/admin/providers', (req, res) => {
    const providers = db.data.providers || {};
    // Hide real API keys partially
    const list = Object.entries(providers).map(([id, p]) => ({
        id: p.id || id,
        name: p.name || 'Unknown',
        type: p.type || 'sms',
        apiUrl: p.apiUrl || '',
        apiKey: '***' + (p.apiKey ? p.apiKey.slice(-4) : ''),
        status: p.status || 'active',
        priority: p.priority || 0
    }));
    res.json({ success: true, providers: list });
});

app.post('/api/admin/providers', (req, res) => {
    const provider = req.body;
    if (!provider.id) return res.json({ success: false, message: 'ID required' });

    if (!db.data.providers) db.data.providers = {};

    // If updating and apiKey is '***...', keep old key
    if (provider.apiKey && provider.apiKey.startsWith('***')) {
        const old = db.data.providers[provider.id];
        if (old) provider.apiKey = old.apiKey;
    }

    db.data.providers[provider.id] = {
        ...db.data.providers[provider.id],
        ...provider,
        updatedAt: Date.now()
    };
    db.save();
    res.json({ success: true });
});

// =============================================
// MANUAL NUMBERS MANAGEMENT API
// =============================================

app.post('/api/admin/manual-numbers/bulk', (req, res) => {
    const { numbers, platform, countryCode, otpApi } = req.body;
    if (!numbers || !Array.isArray(numbers)) return res.status(400).json({ success: false, message: 'Invalid data' });

    if (!db.data.manualNumbers) db.data.manualNumbers = [];

    let added = 0;
    numbers.forEach(num => {
        // Prevent duplicate numbers in the same platform/country
        const exists = db.data.manualNumbers.find(n => n.number === num && n.platform === platform && n.countryCode === countryCode);
        if (!exists) {
            db.data.manualNumbers.push({
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                number: num,
                platform: platform.toLowerCase(),
                countryCode,
                otpApi: otpApi || null,
                status: 'available',
                otp: null,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            added++;
        } else if (otpApi) {
            // Update OTP API if it already exists
            exists.otpApi = otpApi;
            exists.updatedAt = Date.now();
        }
    });

    db.save();
    res.json({ success: true, added });
});

app.delete('/api/admin/manual-numbers/group/:platform', (req, res) => {
    const { platform } = req.params;
    if (!db.data.manualNumbers) return res.json({ success: true });

    const initialCount = db.data.manualNumbers.length;
    db.data.manualNumbers = db.data.manualNumbers.filter(n => n.platform !== platform.toLowerCase());

    db.save();
    res.json({ success: true, count: initialCount - db.data.manualNumbers.length });
});

app.post('/api/admin/manual-numbers/otp-api', (req, res) => {
    const { platform, otpApi } = req.body;
    if (!platform) return res.status(400).json({ success: false, message: 'Platform required' });

    if (!db.data.manualNumbers) db.data.manualNumbers = [];

    let updated = 0;
    db.data.manualNumbers.forEach(n => {
        if (n.platform === platform.toLowerCase()) {
            n.otpApi = otpApi || null;
            n.updatedAt = Date.now();
            updated++;
        }
    });

    if (updated > 0) {
        db.save();
        res.json({ success: true, message: `Updated ${updated} numbers` });
    } else {
        res.json({ success: false, message: 'No numbers found for this platform' });
    }
});

// Auto-cleanup for manual numbers (Remove if finished/cancelled for > 1 hour)
setInterval(() => {
    if (!db.data.manualNumbers) return;
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    const initialCount = db.data.manualNumbers.length;
    db.data.manualNumbers = db.data.manualNumbers.filter(n => {
        if (n.status === 'finished' || n.status === 'cancelled') {
            return (now - (n.updatedAt || n.createdAt)) < oneHour;
        }
        return true;
    });

    if (db.data.manualNumbers.length !== initialCount) {
        db.save();
        console.log(`[CLEANUP] Removed ${initialCount - db.data.manualNumbers.length} used manual numbers.`);
    }
}, 10 * 60 * 1000); // Every 10 minutes

app.get('/api/admin/manual-numbers/summary', (req, res) => {
    const list = db.data.manualNumbers || [];
    const summary = {};

    list.forEach(n => {
        if (n.status === 'available') {
            const key = n.platform;
            if (!summary[key]) {
                summary[key] = {
                    total: 0,
                    countries: {},
                    hasOtpApi: false,
                    isPopular: (db.data.popularPlatforms || []).includes(key)
                };
            }
            summary[key].total++;
            summary[key].countries[n.countryCode] = (summary[key].countries[n.countryCode] || 0) + 1;
            if (n.otpApi) summary[key].hasOtpApi = true;
        }
    });

    res.json({ success: true, summary });
});

app.post('/api/admin/platforms/toggle-popular', (req, res) => {
    const { platform } = req.body;
    if (!platform) return res.json({ success: false, message: 'Platform required' });

    if (!db.data.popularPlatforms) db.data.popularPlatforms = [];

    const index = db.data.popularPlatforms.indexOf(platform.toLowerCase());
    if (index === -1) {
        db.data.popularPlatforms.push(platform.toLowerCase());
    } else {
        db.data.popularPlatforms.splice(index, 1);
    }

    res.json({ success: true, isPopular: index === -1 });
});

app.get('/api/admin/manual-numbers', (req, res) => {
    const list = db.data.manualNumbers || [];
    res.json({ success: true, numbers: list });
});

app.post('/api/admin/manual-numbers', (req, res) => {
    const { number, platform, countryCode } = req.body;
    if (!number || !platform) return res.json({ success: false, message: 'Number and platform required' });

    if (!db.data.manualNumbers) db.data.manualNumbers = [];

    const newNum = {
        id: 'mn_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        number,
        platform: platform.toLowerCase(),
        countryCode: countryCode || '1',
        status: 'available',
        otp: null,
        addedAt: Date.now()
    };

    db.data.manualNumbers.push(newNum);
    db.save();
    res.json({ success: true, number: newNum });
});

app.post('/api/admin/manual-numbers/otp', (req, res) => {
    const { id, otp } = req.body;
    if (!id || !otp) return res.json({ success: false, message: 'ID and OTP required' });

    const manualNumbers = db.data.manualNumbers || [];
    const num = manualNumbers.find(n => n.id === id);
    if (num) {
        num.otp = otp;
        // Also find if there is an active session for this number
        if (num.currentSessionId && db.data.numberSessions && db.data.numberSessions[num.currentSessionId]) {
            db.data.numberSessions[num.currentSessionId].otp = otp;
        }
        db.save();
        return res.json({ success: true });
    }
    res.json({ success: false, message: 'Number not found' });
});

app.delete('/api/admin/manual-numbers/:id', (req, res) => {
    const { id } = req.params;
    if (db.data.manualNumbers) {
        db.data.manualNumbers = db.data.manualNumbers.filter(n => n.id !== id);
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// =============================================

app.delete('/api/admin/providers/:id', (req, res) => {
    const { id } = req.params;
    if (db.data.providers && db.data.providers[id]) {
        delete db.data.providers[id];
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// =============================================
// GROUP MANAGEMENT API
// =============================================

// GET: Group Management Settings
app.get('/api/admin/group-management', (req, res) => {
    const settings = db.data?.adminSettings?.groupManagement || {};
    res.json({
        success: true,
        settings: {
            autoDeleteSystemMessages: settings.autoDeleteSystemMessages !== false,
            deleteJoinMessages: settings.deleteJoinMessages !== false,
            deleteLeaveMessages: settings.deleteLeaveMessages !== false,
            deletePinMessages: settings.deletePinMessages === true,
            deleteVoiceChatStarted: settings.deleteVoiceChatStarted === true,
            deleteVoiceChatEnded: settings.deleteVoiceChatEnded === true,
            deleteVideoChatStarted: settings.deleteVideoChatStarted === true,
            deleteVideoChatEnded: settings.deleteVideoChatEnded === true,
            deleteVideoChatScheduled: settings.deleteVideoChatScheduled === true,
            deleteVideoChatParticipantsInvited: settings.deleteVideoChatParticipantsInvited === true,
            deleteProximityAlertTriggered: settings.deleteProximityAlertTriggered === true,
            deleteAutoDeleteTimerChanged: settings.deleteAutoDeleteTimerChanged === true,
            deleteMigrateToChat: settings.deleteMigrateToChat === true,
            deleteMigrateFromChat: settings.deleteMigrateFromChat === true,
            deleteChannelChatCreated: settings.deleteChannelChatCreated === true,
            deleteSupergroupChatCreated: settings.deleteSupergroupChatCreated === true,
            deleteDeleteGroupPhoto: settings.deleteDeleteGroupPhoto === true,
            deleteGroupPhotoChanged: settings.deleteGroupPhotoChanged === true,
            deleteTitleChanged: settings.deleteTitleChanged === true,
            deleteForumTopicCreated: settings.deleteForumTopicCreated === true,
            deleteForumTopicEdited: settings.deleteForumTopicEdited === true,
            deleteForumTopicClosed: settings.deleteForumTopicClosed === true,
            deleteForumTopicReopened: settings.deleteForumTopicReopened === true,
            deleteGeneralForumTopicHidden: settings.deleteGeneralForumTopicHidden === true,
            deleteGeneralForumTopicUnhidden: settings.deleteGeneralForumTopicUnhidden === true,
            deleteGiveawayCreated: settings.deleteGiveawayCreated === true,
            deleteGiveawayWinners: settings.deleteGiveawayWinners === true,
            deleteGiveawayCompleted: settings.deleteGiveawayCompleted === true,
            deleteBoostAdded: settings.deleteBoostAdded === true,
            deleteChatBackgroundSet: settings.deleteChatBackgroundSet === true,
            requireTelegram: db.data.adminSettings.requireTelegram === true // Added field
        }
    });
});

// POST: Update Group Management Settings
app.post('/api/admin/group-management', (req, res) => {
    const updates = req.body;

    if (!db.data.adminSettings) db.data.adminSettings = {};
    if (!db.data.adminSettings.groupManagement) db.data.adminSettings.groupManagement = {};

    const gm = db.data.adminSettings.groupManagement;

    // Update all provided settings
    if (updates.autoDeleteSystemMessages !== undefined) gm.autoDeleteSystemMessages = updates.autoDeleteSystemMessages;
    if (updates.deleteJoinMessages !== undefined) gm.deleteJoinMessages = updates.deleteJoinMessages;
    if (updates.deleteLeaveMessages !== undefined) gm.deleteLeaveMessages = updates.deleteLeaveMessages;
    if (updates.deletePinMessages !== undefined) gm.deletePinMessages = updates.deletePinMessages;
    if (updates.deleteVoiceChatStarted !== undefined) gm.deleteVoiceChatStarted = updates.deleteVoiceChatStarted;
    if (updates.deleteVoiceChatEnded !== undefined) gm.deleteVoiceChatEnded = updates.deleteVoiceChatEnded;
    if (updates.deleteVideoChatStarted !== undefined) gm.deleteVideoChatStarted = updates.deleteVideoChatStarted;
    if (updates.deleteVideoChatEnded !== undefined) gm.deleteVideoChatEnded = updates.deleteVideoChatEnded;
    if (updates.deleteVideoChatScheduled !== undefined) gm.deleteVideoChatScheduled = updates.deleteVideoChatScheduled;
    if (updates.deleteVideoChatParticipantsInvited !== undefined) gm.deleteVideoChatParticipantsInvited = updates.deleteVideoChatParticipantsInvited;
    if (updates.deleteProximityAlertTriggered !== undefined) gm.deleteProximityAlertTriggered = updates.deleteProximityAlertTriggered;
    if (updates.deleteAutoDeleteTimerChanged !== undefined) gm.deleteAutoDeleteTimerChanged = updates.deleteAutoDeleteTimerChanged;
    if (updates.deleteMigrateToChat !== undefined) gm.deleteMigrateToChat = updates.deleteMigrateToChat;
    if (updates.deleteMigrateFromChat !== undefined) gm.deleteMigrateFromChat = updates.deleteMigrateFromChat;
    if (updates.deleteChannelChatCreated !== undefined) gm.deleteChannelChatCreated = updates.deleteChannelChatCreated;
    if (updates.deleteSupergroupChatCreated !== undefined) gm.deleteSupergroupChatCreated = updates.deleteSupergroupChatCreated;
    if (updates.deleteDeleteGroupPhoto !== undefined) gm.deleteDeleteGroupPhoto = updates.deleteDeleteGroupPhoto;
    if (updates.deleteGroupPhotoChanged !== undefined) gm.deleteGroupPhotoChanged = updates.deleteGroupPhotoChanged;
    if (updates.deleteTitleChanged !== undefined) gm.deleteTitleChanged = updates.deleteTitleChanged;
    if (updates.deleteForumTopicCreated !== undefined) gm.deleteForumTopicCreated = updates.deleteForumTopicCreated;
    if (updates.deleteForumTopicEdited !== undefined) gm.deleteForumTopicEdited = updates.deleteForumTopicEdited;
    if (updates.deleteForumTopicClosed !== undefined) gm.deleteForumTopicClosed = updates.deleteForumTopicClosed;
    if (updates.deleteForumTopicReopened !== undefined) gm.deleteForumTopicReopened = updates.deleteForumTopicReopened;
    if (updates.deleteGeneralForumTopicHidden !== undefined) gm.deleteGeneralForumTopicHidden = updates.deleteGeneralForumTopicHidden;
    if (updates.deleteGeneralForumTopicUnhidden !== undefined) gm.deleteGeneralForumTopicUnhidden = updates.deleteGeneralForumTopicUnhidden;
    if (updates.deleteGiveawayCreated !== undefined) gm.deleteGiveawayCreated = updates.deleteGiveawayCreated;
    if (updates.deleteGiveawayWinners !== undefined) gm.deleteGiveawayWinners = updates.deleteGiveawayWinners;
    if (updates.deleteGiveawayCompleted !== undefined) gm.deleteGiveawayCompleted = updates.deleteGiveawayCompleted;
    if (updates.deleteBoostAdded !== undefined) gm.deleteBoostAdded = updates.deleteBoostAdded;
    if (updates.deleteChatBackgroundSet !== undefined) gm.deleteChatBackgroundSet = updates.deleteChatBackgroundSet;

    if (updates.requireTelegram !== undefined) {
        db.data.adminSettings.requireTelegram = updates.requireTelegram;
    }

    db.save();
    res.json({ success: true, settings: gm });
});

// =============================================
// AI ASSISTANT API
// =============================================

app.get('/api/admin/ai-assistant', (req, res) => {
    const settings = db.data?.adminSettings?.aiAssistant || {};
    res.json(settings);
});

app.post('/api/admin/ai-assistant', (req, res) => {
    if (!db.data.adminSettings) db.data.adminSettings = {};
    db.data.adminSettings.aiAssistant = req.body;
    db.save();
    res.json({ success: true });
});

// =============================================

// API: Detailed System Info
app.get('/api/admin/system/info', (req, res) => {
    const stats = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        dbFile: db.DB_FILE,
        dbSize: fs.existsSync(db.DB_FILE) ? fs.statSync(db.DB_FILE).size : 0,
        usage: {
            users: Object.keys(db.data.users || {}).length,
            groups: Array.isArray(db.data.groups) ? db.data.groups.length : Object.keys(db.data.groups || {}).length,
            transactions: (db.data.transactions || []).length,
            providers: Object.keys(db.data.providers || {}).length,
            accounts: (db.data.premiumAccounts || []).length
        }
    };
    res.json({ success: true, stats });
});

// API: Admin - Mass Gift
app.post('/api/admin/mass-gift', async (req, res) => {
    try {
        const { asset, amount, messageFormat } = req.body;
        if (!asset || !amount || amount <= 0) {
            return res.json({ success: false, message: 'Invalid asset or amount' });
        }

        const users = await db.getUsers();
        const userArray = Object.values(users);
        console.log(`[MASS_GIFT] Found ${userArray.length} users for mass gift.`);
        let affected = 0;
        const giftId = 'gift_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        for (const user of userArray) {
            // DO NOT apply balances directly! User must claim it.

            // Create a pending gift
            if (!user.pendingGifts) user.pendingGifts = [];
            user.pendingGifts.push({
                id: giftId,
                currency: asset === 'tokens' ? 'tokens' : (asset === 'gems' ? 'Gems' : 'usd'),
                amount: amount,
                claimed: false,
                date: Date.now()
            });

            // Create a notification
            if (!user.notifications) user.notifications = [];

            const assetLabel = asset === 'tokens' ? 'TC' : (asset === 'usd' ? '$' : 'Gems');
            const amtStr = asset === 'usd' ? amount.toFixed(3) : amount;
            let finalMsg = messageFormat || `🎁 You received a gift of {AMOUNT} {ASSET} from Admin!`;
            finalMsg = finalMsg.replace(/\{AMOUNT\}/g, asset === 'usd' ? '$' + amtStr : amtStr)
                .replace(/\{ASSET\}/g, assetLabel);

            user.notifications.unshift({
                id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                type: 'gift',
                title: 'Admin Gift',
                message: finalMsg,
                giftId: giftId,
                date: Date.now(),
                read: false
            });

            await db.updateUser(user);
            affected++;
        }
        res.json({ success: true, affectedUsers: affected });
    } catch (e) {
        console.error('[MASS_GIFT]', e);
        res.json({ success: false, message: 'Server error: ' + e.message });
    }
});

// API: Admin - Get Broadcast History
app.get('/api/admin/broadcasts', (req, res) => {
    try {
        const broadcasts = db.data.broadcasts || [];
        // Sort by date descending (newest first)
        const sorted = broadcasts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({ success: true, broadcasts: sorted.slice(0, 50) }); // Return last 50
    } catch (e) {
        console.error('[BROADCAST] Error loading history:', e);
        res.json({ success: false, broadcasts: [], message: e.message });
    }
});

// API: Admin - Delete Broadcast
app.delete('/api/admin/broadcasts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const broadcasts = db.data.broadcasts || [];
        const index = broadcasts.findIndex(b => b.id === id);

        if (index === -1) {
            return res.json({ success: false, message: 'Broadcast not found' });
        }

        const broadcast = broadcasts[index];

        // Delete from Telegram if messages tracked
        if (broadcast.telegramMessages && Array.isArray(broadcast.telegramMessages)) {
            const TelegramBot = require('node-telegram-bot-api');
            const config = require('../config');
            const botToken = config.TELEGRAM_BOT_TOKEN;

            let activeBot = bot;
            if (!activeBot && botToken) {
                try {
                    activeBot = new TelegramBot(botToken, { polling: false });
                } catch (e) {
                    console.error('[BROADCAST_DELETE] Failed to create bot:', e.message);
                }
            }

            if (activeBot) {
                for (const msg of broadcast.telegramMessages) {
                    try {
                        await activeBot.deleteMessage(msg.chatId, msg.messageId);
                        console.log(`[BROADCAST_DELETE] Deleted message ${msg.messageId} from ${msg.chatId}`);
                    } catch (e) {
                        console.error(`[BROADCAST_DELETE] Failed to delete from ${msg.chatId}:`, e.message);
                        // Ignore failure (message might be too old or bot kicked)
                    }
                }
            }
        }

        // Remove from history
        broadcasts.splice(index, 1);
        db.data.broadcasts = broadcasts;
        db.save();

        res.json({ success: true, message: 'Broadcast deleted from history and Telegram (if possible)' });
    } catch (e) {
        console.error('[BROADCAST_DELETE] Error:', e);
        res.json({ success: false, message: 'Server error: ' + e.message });
    }
});

// API: Admin - Advanced Broadcast
app.post('/api/admin/broadcast', async (req, res) => {
    const { message, mediaType, mediaUrl, buttons, target } = req.body;

    // Track if requested by helper admin
    const adminUserId = req.headers['x-user-id'];
    const adminUser = adminUserId ? db.getUser(adminUserId) : null;
    const isHelper = adminUser && adminUser.role === 'helper_admin';

    // Normalize UI targets to backend targets
    // UI: bot/group/channel/all
    // Backend: users/groups/channels/all
    const normalizedTarget = (function () {
        const t = String(target || '').toLowerCase();
        if (t === 'bot') return 'users';
        if (t === 'group') return 'groups';
        if (t === 'channel') return 'channels';
        return t;
    })();

    if (!message && !mediaUrl) return res.json({ success: false, message: 'Message or Media required' });

    // Prepare Targets
    let targetIds = [];
    const apiKeys = db.data.apiKeys || {};
    const requiredChannel = apiKeys.requiredChannel || '';

    if (normalizedTarget === 'web') {
        const users = await db.getUsers();
        const userArray = Object.values(users);
        console.log(`[BROADCAST] Found ${userArray.length} users for web broadcast.`);
        let successCount = 0;
        for (let u of userArray) {
            u.notifications = u.notifications || [];
            u.notifications.unshift({
                id: Date.now().toString() + Math.random().toString(36).substring(7),
                type: 'broadcast',
                title: 'System Announcement',
                message: message || (mediaUrl ? '[Media Attached]' : ''),
                timestamp: new Date().toISOString(),
                read: false
            });
            await db.updateUser(u, null, true);
            successCount++;
        }

        // Save to broadcast history
        if (!db.data.broadcasts) db.data.broadcasts = [];
        db.data.broadcasts.push({
            id: Date.now().toString(),
            message, mediaType, mediaUrl, target: 'web',
            sent: successCount, failed: 0,
            createdAt: Date.now()
        });
        db.save();

        return res.json({ success: true, sent: successCount, failed: 0, total: userArray.length, channelSuccess: false, mainChannel: null, note: 'Sent exclusively to Web Panel notifications' });
    }

    // Parse channel ID from requiredChannel (can be @username or -100xxx or https://t.me/xxx)
    let mainChannelId = null;
    if (requiredChannel) {
        if (requiredChannel.startsWith('-100')) {
            mainChannelId = requiredChannel;
        } else if (requiredChannel.startsWith('@')) {
            mainChannelId = requiredChannel;
        } else if (requiredChannel.includes('t.me/')) {
            const match = requiredChannel.match(/t\.me\/(\w+)/);
            if (match) mainChannelId = '@' + match[1];
        }
    }

    if (normalizedTarget === 'users') {
        const users = await db.getUsers();
        if (users.length > 0) targetIds.push(...users.map(u => u.id));
    }

    if (normalizedTarget === 'channels' || normalizedTarget === 'all') {
        // Priority: Use main channel from API Management
        if (mainChannelId) {
            targetIds.push(mainChannelId);
            console.log(`[BROADCAST] Using main channel from API Management: ${mainChannelId}`);
        } else {
            // Fallback: Get channels from database
            const groups = db.getGroups();
            const onlyChannels = groups.filter(g => g.type === 'channel');
            if (onlyChannels.length > 0) targetIds.push(...onlyChannels.map(g => g.id));
        }
    }

    if (normalizedTarget === 'groups') {
        // Only send to groups if explicitly selected (not when 'all' is selected)
        // Because if channel is linked to group, channel post will auto appear in group
        const groups = db.getGroups();
        const onlyGroups = groups.filter(g => g.type === 'group' || g.type === 'supergroup');
        if (onlyGroups.length > 0) targetIds.push(...onlyGroups.map(g => g.id));
    }

    if (normalizedTarget === 'all') {
        // For 'all' target: Send to users + main channel only (not individual groups)
        // Because channel posts auto-forward to linked groups
        const users = await db.getUsers();
        if (users.length > 0) targetIds.push(...users.map(u => u.id));

        // Add main channel
        if (mainChannelId) {
            targetIds.push(mainChannelId);
        } else {
            const groups = db.getGroups();
            const onlyChannels = groups.filter(g => g.type === 'channel');
            if (onlyChannels.length > 0) targetIds.push(...onlyChannels.map(g => g.id));
        }
    }

    // Unique IDs only
    targetIds = [...new Set(targetIds)];

    if (targetIds.length === 0 && normalizedTarget !== 'web') {
        let msg = 'No targets found';
        if (normalizedTarget === 'channels') {
            msg = 'No channels found. Please add a channel in Group Management or set a required channel in API Management.';
        } else if (normalizedTarget === 'groups') {
            msg = 'No groups found. Please add a group in Group Management.';
        }
        return res.json({ success: false, message: msg });
    }

    // Prepare Keyboard
    let reply_markup = undefined;
    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        const rows = [];
        let currentRow = [];
        buttons.forEach((btn, i) => {
            let bUrl = btn.url || '';
            // Auto-fix @usernames to t.me links
            if (bUrl.startsWith('@')) {
                bUrl = 'https://t.me/' + bUrl.slice(1);
            } else if (bUrl && !bUrl.includes('://')) {
                bUrl = 'https://' + bUrl;
            }

            // Fix: Replace localhost with PUBLIC_URL for Telegram buttons
            if (bUrl.includes('localhost:') || bUrl.includes('127.0.0.1:')) {
                const publicUrl = config.PUBLIC_URL || 'https://autosverifybot-production.up.railway.app/';
                bUrl = bUrl.replace(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, publicUrl);
            }

            currentRow.push({ text: btn.text, url: bUrl });
            if (currentRow.length === 2 || i === buttons.length - 1) {
                rows.push(currentRow);
                currentRow = [];
            }
        });
        reply_markup = { inline_keyboard: rows };
    }

    // Resolve Local Paths for Media
    let actualMedia = mediaUrl;
    if (mediaUrl && mediaUrl.startsWith('/uploads/')) {
        actualMedia = path.join(__dirname, '..', 'web', mediaUrl);
        if (!fs.existsSync(actualMedia)) {
            console.error(`[BROADCAST] Media file not found locally: ${actualMedia}`);
            // Fallback to URL if file missing? (unlikely)
        }
    }

    // Send
    let successCount = 0;
    let failCount = 0;
    let channelSuccess = false;

    try {
        const TelegramBot = require('node-telegram-bot-api');
        const config = require('../config');

        // Validate bot token
        const botToken = config.TELEGRAM_BOT_TOKEN;
        if (!botToken || botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE' || botToken === 'undefined') {
            console.error('[BROADCAST] ERROR: TELEGRAM_BOT_TOKEN is not set in environment variables');
            return res.json({
                success: false,
                message: 'Bot token not configured. Please set TELEGRAM_BOT_TOKEN in environment variables.'
            });
        }

        // Use Global Bot if available (set via setBot), otherwise create stateless instance
        let activeBot;
        if (bot) {
            activeBot = bot;
            console.log('[BROADCAST] Using global bot instance');
        } else {
            try {
                activeBot = new TelegramBot(botToken, { polling: false });
                console.log('[BROADCAST] Created new bot instance for broadcast');
            } catch (botError) {
                console.error('[BROADCAST] Failed to create bot instance:', botError.message);
                return res.json({
                    success: false,
                    message: 'Failed to initialize bot: ' + botError.message
                });
            }
        }

        // Verify bot is working by getting bot info
        try {
            const botInfo = await activeBot.getMe();
            console.log(`[BROADCAST] Bot verified: @${botInfo.username} (${botInfo.id})`);
        } catch (verifyError) {
            console.error('[BROADCAST] Bot token verification failed:', verifyError.message);
            return res.json({
                success: false,
                message: 'Bot token invalid or bot not responding. Please check TELEGRAM_BOT_TOKEN.'
            });
        }

        console.log(`[BROADCAST] Starting broadcast to ${targetIds.length} targets`);

        const telegramMessages = [];

        for (const chatId of targetIds) {
            try {
                console.log(`[BROADCAST] Sending to ${chatId}...`);

                let sentMsg;
                if (mediaType === 'photo' && actualMedia) {
                    sentMsg = await activeBot.sendPhoto(chatId, actualMedia, { caption: message, reply_markup });
                } else if (mediaType === 'video' && actualMedia) {
                    sentMsg = await activeBot.sendVideo(chatId, actualMedia, { caption: message, reply_markup });
                } else {
                    sentMsg = await activeBot.sendMessage(chatId, message || 'Broadcast', { reply_markup });
                }
                successCount++;

                if (sentMsg) {
                    telegramMessages.push({ chatId, messageId: sentMsg.message_id });
                }

                // Track message if sent by helper admin
                if (isHelper && sentMsg) {
                    adminUser.helperAdminMessages = adminUser.helperAdminMessages || [];
                    adminUser.helperAdminMessages.push({ chatId, messageId: sentMsg.message_id });
                }

                // Track if channel was successful
                if (mainChannelId && String(chatId) === String(mainChannelId)) {
                    channelSuccess = true;
                }

                // If target is a user, add to their web notifications
                const u = db.data.users && db.data.users[chatId];
                if (u) {
                    u.notifications = u.notifications || [];
                    u.notifications.unshift({
                        id: Date.now().toString() + Math.random().toString(36).substring(7),
                        type: 'broadcast',
                        title: 'System Announcement',
                        message: message || (mediaUrl ? '[Media Attached]' : ''),
                        timestamp: new Date().toISOString(),
                        read: false
                    });
                    // We don't await updateUser here because it's in a loop, but memory is updated.
                    // Actually, db.save() is better done once after the loop.
                }

                console.log(`[BROADCAST] ✓ Successfully sent to ${chatId}`);
            } catch (e) {
                failCount++;
                console.error(`[BROADCAST] ✗ Failed to send to ${chatId}: ${e.message}`);
                console.error(`[BROADCAST] Error code: ${e.code || 'N/A'}, response: ${e.response?.body || 'N/A'}`);
            }
            // Tiny delay to be polite to API
            await new Promise(r => setTimeout(r, 50));
        }

        if (isHelper) {
            await db.updateUser(adminUser);
        }

        console.log(`[BROADCAST] Complete: ${successCount} sent, ${failCount} failed out of ${targetIds.length}`);

        // Save to broadcast history
        if (!db.data.broadcasts) db.data.broadcasts = [];
        db.data.broadcasts.push({
            id: Date.now().toString(),
            message,
            mediaType,
            mediaUrl,
            target: normalizedTarget,
            sent: successCount,
            failed: failCount,
            createdAt: Date.now(),
            telegramMessages: telegramMessages
        });

        // Save any web notification updates
        db.save();

        res.json({
            success: true,
            sent: successCount,
            failed: failCount,
            total: targetIds.length,
            channelSuccess: channelSuccess,
            mainChannel: mainChannelId,
            note: channelSuccess ? 'Posted to channel. If channel is linked to group, message will auto-appear in group.' : ''
        });

        // NEW: Immediate cleanup of broadcast media file
        if (mediaUrl && mediaUrl.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, '..', 'web', mediaUrl);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    console.log(`[CLEANUP] Broadcast media deleted immediately: ${filePath}`);
                } catch (err) {
                    console.error(`[CLEANUP] Immediate delete failed: ${err.message}`);
                }
            }
        }

    } catch (e) {
        console.error('[BROADCAST] System Error:', e);
        res.json({ success: false, message: 'Broadcast System Error: ' + e.message });
    }
});


// Multer setup for large files
const multer = require('multer');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '..', 'web', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, 'media_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: Infinity } // Set to Infinity as requested
});

app.post('/api/admin/upload-media', upload.single('file'), (req, res) => {
    if (req.file) console.log(`[UPLOAD] Admin Media: ${req.file.filename} (${req.file.size} bytes)`);
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// Public API: Upload Screenshot (for deposits)
app.post('/api/upload/screenshot', upload.single('file'), (req, res) => {
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
});

// API: Admin - Upload Image (Base64) - Legacy/Small images
app.post('/api/admin/upload', (req, res) => {
    const { image } = req.body;
    if (!image) return res.json({ success: false, message: 'No image data' });

    try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const uploadDir = path.join(__dirname, '..', 'web', 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const filename = 'img_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + '.png';
        const filepath = path.join(uploadDir, filename);

        fs.writeFileSync(filepath, buffer);
        res.json({ success: true, url: '/uploads/' + filename });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Server error: ' + e.message });
    }
});

// API: Admin - Premium Accounts Inventory
app.get('/api/admin/accounts', (req, res) => {
    const accounts = db.data.premiumAccounts || [];
    res.json({ success: true, accounts });
});

app.post('/api/admin/accounts', (req, res) => {
    const { id, type, email, password, price, instructions } = req.body;
    if (!email || !password) return res.json({ success: false, message: 'Email and password required' });

    if (!db.data.premiumAccounts) db.data.premiumAccounts = [];

    if (id) {
        // Edit existing
        const idx = db.data.premiumAccounts.findIndex(a => a.id === id);
        if (idx !== -1) {
            db.data.premiumAccounts[idx].type = type || 'other';
            db.data.premiumAccounts[idx].email = email;
            db.data.premiumAccounts[idx].password = password;
            db.data.premiumAccounts[idx].price = parseInt(price) || 0;
            db.data.premiumAccounts[idx].instructions = instructions || '';
            db.save();
            return res.json({ success: true, id });
        }
    }

    const account = {
        id: 'acc_' + Date.now(),
        type: type || 'other',
        email,
        password,
        price: parseInt(price) || 0,
        instructions: instructions || '',
        sold: false,
        addedAt: Date.now()
    };
    db.data.premiumAccounts.push(account);
    db.save();
    res.json({ success: true, id: account.id });
});

// API: User - Get Available Accounts
app.get('/api/accounts', (req, res) => {
    const accounts = (db.data.premiumAccounts || []).filter(a => !a.sold).map(a => ({
        id: a.id,
        type: a.type,
        price: a.price,
        // Hide password and instructions
        email: a.email.replace(/(.{2})(.*)(?=@)/, (gp1, gp2, gp3) => {
            return gp2 + gp3.replace(/./g, '*');
        })
    }));
    res.json({ success: true, accounts });
});

// API: User - Buy Account
app.post('/api/accounts/buy', async (req, res) => {
    const { userId, accountId } = req.body;
    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    const allAccounts = db.data.premiumAccounts || [];
    const idx = allAccounts.findIndex(a => a.id === accountId && !a.sold);
    if (idx === -1) return res.json({ success: false, message: 'Account not found or already sold' });

    const account = allAccounts[idx];
    const userTokens = db.getTokenBalance(user);

    if (userTokens < account.price) {
        return res.json({ success: false, message: `Insufficient tokens. Need ${account.price} TC.` });
    }

    // Deduct tokens
    const price = parseInt(account.price || 0);
    db.setTokenBalance(user, userTokens - price);

    // Mark sold
    account.sold = true;
    account.soldTo = userId;
    account.soldAt = Date.now();

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'email', // using email to show in gmails used as per user request
        date: new Date().toISOString(),
        details: `Bought ${account.type} Account: ${account.email}`,
        reward: `-${account.price}`
    });

    db.save();

    res.json({
        success: true,
        account: account, // Return full object so cards work
        newBalance: user.tokens !== undefined ? user.tokens : user.balance_tokens
    });
});

app.delete('/api/admin/accounts/:id', (req, res) => {
    const { id } = req.params;
    if (!db.data.premiumAccounts) return res.json({ success: false });
    const before = db.data.premiumAccounts.length;
    db.data.premiumAccounts = db.data.premiumAccounts.filter(a => a.id !== id);
    db.save();
    res.json({ success: db.data.premiumAccounts.length < before });
});

// API: Admin - Get all daily bonus claims
app.get('/api/admin/daily-stats', async (req, res) => {
    const users = await db.getUsers();
    const totalClaims = users.filter(u => u.lastDaily > 0).length;
    const totalStreak = users.reduce((acc, u) => acc + (u.dailyStreak || 0), 0);
    res.json({ success: true, totalClaims, avgStreak: users.length ? (totalStreak / users.length).toFixed(1) : 0 });
});

// SERVER LOGS API
app.get('/api/admin/logs', (req, res) => {
    res.json({ success: true, logs: db.data.serverLogs || [] });
});

app.post('/api/admin/logs/clear', (req, res) => {
    db.clearLogs();
    res.json({ success: true, message: 'Server logs cleared' });
});

app.post('/api/admin/logs/solve', (req, res) => {
    const { logId } = req.body;
    db.solveLog(logId);
    res.json({ success: true, message: 'Log marked as solved' });
});

// API: Admin - Get Settings
app.get('/api/admin/settings', (req, res) => {
    const settings = db.getSettings();
    const cardPrices = db.data.cardPrices || {};
    const vpnPrices = db.data.vpnPrices || {};
    const adminSettings = db.data.adminSettings || {};
    const serviceCosts = db.data.settings.costs || {};
    const apiKeys = db.data.apiKeys || {};

    res.json({
        success: true,
        settings,
        cardPrices,
        vpnPrices,
        adminSettings,
        serviceCosts,
        apiKeys: {
            smtpLabsKey: apiKeys.smtpLabsKey || '',
            gmailClientId: apiKeys.gmailClientId || '',
            gmailClientSecret: apiKeys.gmailClientSecret || '',
            miniAppUrl: apiKeys.miniAppUrl || '',
            backupBotToken: apiKeys.backupBotToken || ''
        }
    });
});

// API: Admin - Update Settings
app.post('/api/admin/settings', (req, res) => {
    const {
        dailyBonus, refBonus, welcomeBonus, supportCost, gmailCost, gems,
        transferCost, verificationCost, numberCost, mailCost, tradingMinBet, adReward
    } = req.body;
    const s = db.getSettings();

    if (dailyBonus !== undefined) s.dailyBonus = parseInt(dailyBonus);
    if (refBonus !== undefined) s.refBonus = parseInt(refBonus);
    if (transferCost !== undefined) s.transferCost = parseInt(transferCost);
    if (adReward !== undefined) s.adReward = parseInt(adReward);

    // Save to settings.costs
    if (!s.costs) s.costs = {};
    if (verificationCost !== undefined) s.costs.verify = parseInt(verificationCost);
    if (numberCost !== undefined) s.costs.number = parseInt(numberCost);
    if (mailCost !== undefined) s.costs.mail = parseInt(mailCost);

    if (welcomeBonus !== undefined) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        db.data.adminSettings.welcomeCredits = parseInt(welcomeBonus);
    }
    if (supportCost !== undefined) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        db.data.adminSettings.supportCost = parseInt(supportCost);
    }
    if (gmailCost !== undefined) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        db.data.adminSettings.gmailCost = parseInt(gmailCost);
    }
    if (tradingMinBet !== undefined) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        db.data.adminSettings.tradingMinBet = parseInt(tradingMinBet);
    }

    if (gems) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        if (!db.data.adminSettings.gems) db.data.adminSettings.gems = {};
        if (gems.price !== undefined) db.data.adminSettings.gems.currentPrice = parseFloat(gems.price);
        if (gems.enabled !== undefined) db.data.adminSettings.gems.enabled = (gems.enabled === true || gems.enabled === 'true');
    }

    db.save();
    db.triggerSystemUpdate();
    res.json({ success: true, message: 'Admin settings updated successfully' });
});

// API: Admin - Get API Keys
app.get('/api/admin/apikeys', (req, res) => {
    const apiKeys = db.data.apiKeys || {};
    res.json({
        success: true,
        apiKeys: {
            botToken: apiKeys.botToken || '',
            backupBotToken: apiKeys.backupBotToken || '',
            mainboardApiKey: apiKeys.mainboardApiKey || '',
            smtpLabsKey: apiKeys.smtpLabsKey || '',
            gmailClientId: apiKeys.gmailClientId || '',
            gmailClientSecret: apiKeys.gmailClientSecret || '',
            miniAppUrl: apiKeys.miniAppUrl || '',
            requiredChannel: apiKeys.requiredChannel || '',
            requiredGroup: apiKeys.requiredGroup || '',
            requiredYoutube: apiKeys.requiredYoutube || '',
            supportLink: apiKeys.supportLink || '',
            adReward: apiKeys.adReward || '5',
            welcomeMessage: apiKeys.welcomeMessage || ''
        },
        dbConfig: db.data.firebaseConfig || null
    });
});

// API: Admin - Update API Keys
app.post('/api/admin/apikeys', (req, res) => {
    const { botToken, backupBotToken, mainboardApiKey, smtpLabsKey, gmailClientId, gmailClientSecret, miniAppUrl, requiredChannel, requiredGroup, requiredYoutube, supportLink, adReward, welcomeMessage, welcomeCredits } = req.body;

    if (!db.data.apiKeys) db.data.apiKeys = {};

    if (botToken !== undefined) db.data.apiKeys.botToken = botToken;
    if (backupBotToken !== undefined) db.data.apiKeys.backupBotToken = backupBotToken;
    if (mainboardApiKey !== undefined) db.data.apiKeys.mainboardApiKey = mainboardApiKey;
    if (smtpLabsKey !== undefined) db.data.apiKeys.smtpLabsKey = smtpLabsKey;
    if (gmailClientId !== undefined) db.data.apiKeys.gmailClientId = gmailClientId;
    if (gmailClientSecret !== undefined) db.data.apiKeys.gmailClientSecret = gmailClientSecret;
    if (miniAppUrl !== undefined) db.data.apiKeys.miniAppUrl = miniAppUrl;
    if (requiredChannel !== undefined) db.data.apiKeys.requiredChannel = requiredChannel;
    if (requiredGroup !== undefined) db.data.apiKeys.requiredGroup = requiredGroup;
    if (requiredYoutube !== undefined) db.data.apiKeys.requiredYoutube = requiredYoutube;
    if (supportLink !== undefined) db.data.apiKeys.supportLink = supportLink;
    if (adReward !== undefined) db.data.apiKeys.adReward = adReward;
    if (welcomeMessage !== undefined) db.data.apiKeys.welcomeMessage = welcomeMessage;

    if (welcomeCredits !== undefined) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        db.data.adminSettings.welcomeCredits = welcomeCredits;
    }

    db.save();
    res.json({ success: true, message: 'API Keys and Settings updated successfully' });
});

// API: Admin - Get Database Config
app.get('/api/admin/dbconfig', (req, res) => {
    res.json({
        success: true,
        dbConfig: db.data.firebaseConfig || {}
    });
});

// API: Admin - Update Database Config (JSON Upload)
app.post('/api/admin/dbconfig', (req, res) => {
    try {
        // The body should be the Firebase/Database config object
        const config = req.body;

        if (!config || typeof config !== 'object') {
            return res.json({ success: false, message: 'Invalid config format. Expected JSON object.' });
        }

        // Store the config
        db.data.firebaseConfig = config;
        db.save();

        res.json({ success: true, message: 'Database configuration updated successfully' });
    } catch (e) {
        res.json({ success: false, message: 'Error updating database config: ' + e.message });
    }
});

// API: Admin - Restart Bot
app.post('/api/admin/restart-bot', (req, res) => {
    res.json({ success: true, message: 'Bot restart initiated' });

    // Trigger restart after a short delay to allow response to be sent
    setTimeout(() => {
        console.log('[ADMIN] Bot restart triggered via API');
        process.exit(0); // Exit and let process manager (PM2/nodemon) restart
    }, 1000);
});

// =============================================
// FEATURE FLAGS (BUTTON MANAGEMENT)
// =============================================
function getDefaultFeatureFlags() {
    return {
        // Core services
        tempMail: true,
        virtualNumber: true,
        premiumMail: true,
        accountsShop: true,
        cardsVcc: true,
        joinRequired: true,
        requireTelegram: true,

        // Home service cards
        home_verify: true,
        home_mail: true,
        home_number: true,
        home_gemini: true,
        home_chatgpt: true,
        home_accounts: true,
        home_vcc: true,
        home_premiumMail: true,

        // AI Tools
        aiPhotoGen: true,
        aiVideoGen: true,
        bgRemover: true,

        // Media & Download
        videoDownloader: true,
        vpnServices: true,

        // Rewards & Engagement
        dailyCheckin: true,
        tasksSystem: true,
        redeemCodes: true,
        referralSystem: true,
        quizFeature: true,
        exchange: true,

        // Home Grid Buttons
        home_aiPhoto: true,
        home_aiVideo: true,
        home_bgRemover: true,
        home_videoDownload: true,
        home_vpn: true,
        home_accountsShop: true,
        home_vccShop: true
    };
}

function getFeatureFlags() {
    if (!db.data.featureFlags) db.data.featureFlags = {};
    const defaults = getDefaultFeatureFlags();
    // Merge defaults (keeps newly added keys enabled by default)
    db.data.featureFlags = { ...defaults, ...db.data.featureFlags };

    // Include global requirement flags
    const flags = { ...db.data.featureFlags };

    return flags;
}

// Public endpoint: mini app fetches enabled/disabled features
app.get('/api/features', (req, res) => {
    const flags = getFeatureFlags();

    // Provide dynamic join requirements info
    const apiKeys = db.data.apiKeys || {};
    const requiredJoins = {
        channel: {
            id: apiKeys.requiredChannelId || config.REQUIRED_CHANNEL_ID || '-1002088203586',
            username: (apiKeys.requiredChannel || config.REQUIRED_CHANNEL || '@AutosVerify').replace('@', ''),
            name: '📢 AutosVerify Channel'
        },
        group: {
            id: apiKeys.requiredGroupId || config.REQUIRED_GROUP_ID || '-1002188442004',
            username: (apiKeys.requiredGroup || config.REQUIRED_GROUP || '@AutosVerifyCh').replace('@', ''),
            name: '💬 AutosVerify Group'
        }
    };

    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        features: flags,
        requiredJoins: requiredJoins
    });
});

// Admin: get feature flags
app.get('/api/admin/features', (req, res) => {
    const flags = getFeatureFlags();
    res.json({ success: true, features: flags });
});

// Admin: update feature flags (partial update allowed)
app.post('/api/admin/features', (req, res) => {
    const incoming = req.body || {};
    const current = getFeatureFlags();
    const updated = { ...current };

    Object.keys(incoming).forEach((k) => {
        // Accept booleans or 'true'/'false'
        const v = incoming[k];
        if (typeof v === 'boolean') updated[k] = v;
        else if (v === 'true' || v === 'false') updated[k] = (v === 'true');
    });

    db.data.featureFlags = updated;
    db.save();
    db.triggerSystemUpdate();
    res.json({ success: true, features: updated });
});

// API: Admin - Get System Metrics
app.get('/api/admin/metrics', (req, res) => {
    try {
        const cpus = os.cpus();
        const mem = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        let cpuUsage = 0;
        if (cpus && cpus.length > 0) {
            let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
            for (let cpu of cpus) {
                user += cpu.times.user;
                nice += cpu.times.nice;
                sys += cpu.times.sys;
                idle += cpu.times.idle;
                irq += cpu.times.irq;
            }
            const total = user + nice + sys + idle + irq;
            const active = total - idle;
            cpuUsage = Math.round((active / total) * 100);
        }

        const memUsage = Math.round((usedMem / totalMem) * 100);
        const uptimeSeconds = process.uptime();
        const dbSize = fs.existsSync(db.DB_FILE) ? (fs.statSync(db.DB_FILE).size / 1024).toFixed(2) + ' KB' : '0 KB';

        // Disk usage (best-effort)
        let disk = null;
        try {
            const { execSync } = require('child_process');
            // Windows: use WMIC
            const out = execSync('wmic logicaldisk get size,freespace,caption', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
            // Pick system drive (first with a caption like C:)
            const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const dataLines = lines.slice(1);
            const first = dataLines.map(l => l.split(/\s+/)).find(parts => parts[0] && parts[0].includes(':'));
            if (first && first.length >= 3) {
                const caption = first[0];
                const free = parseInt(first[1]);
                const size = parseInt(first[2]);
                if (!isNaN(free) && !isNaN(size) && size > 0) {
                    const used = size - free;
                    disk = {
                        drive: caption,
                        sizeBytes: size,
                        freeBytes: free,
                        usedBytes: used,
                        usedPercent: Math.round((used / size) * 100)
                    };
                }
            }
        } catch (e) { }

        // Active users calculation (last 24 hours)
        const usersList = Object.values(db.data.users || {});
        let activeUsers = 0;
        const now = Date.now();
        usersList.forEach(u => {
            if (u.lastActive && (now - u.lastActive < 24 * 60 * 60 * 1000)) activeUsers++;
        });

        res.json({
            success: true,
            metrics: {
                cpu: cpuUsage,
                memory: memUsage,
                dbSize: dbSize,
                uptime: uptimeSeconds,
                dbUptime: uptimeSeconds,
                callbacks: totalCallbacks,
                activeUsers: activeUsers,
                disk
            }
        });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Admin - API Keys
app.get('/api/admin/email-services', (req, res) => {
    const emailServices = db.data.emailServices || {};
    res.json({
        success: true,
        emailService: emailServices.emailService !== false, // default true
        tempMail: emailServices.tempMail !== false // default true
    });
});

app.post('/api/admin/email-services', (req, res) => {
    const { emailService, tempMail } = req.body;
    if (!db.data.emailServices) db.data.emailServices = {};

    if (emailService !== undefined) {
        db.data.emailServices.emailService = emailService === true || emailService === 'true';
    }
    if (tempMail !== undefined) {
        db.data.emailServices.tempMail = tempMail === true || tempMail === 'true';
    }

    db.save();
    res.json({ success: true, emailServices: db.data.emailServices });
});

// API: Ad Network Settings (GET & POST)
app.get('/api/admin/ads', (req, res) => {
    const ads = db.data.adSettings || {};
    res.json({ success: true, ads });
});

app.post('/api/admin/ads', (req, res) => {
    const { network, publisherId, adUnitId, directUrl, enabled } = req.body;
    if (!network) return res.json({ success: false, message: 'Network required' });
    if (!db.data.adSettings) db.data.adSettings = {};

    // All networks now support directUrl (including MoneyTag, AdSense, Adsterra)
    db.data.adSettings[network] = {
        publisherId: publisherId || '',
        adUnitId: adUnitId || '',
        directUrl: directUrl || '',
        enabled: enabled !== false
    };
    db.save();
    res.json({ success: true, adSettings: db.data.adSettings });
});

// Public endpoint - mini app fetches active ad config
app.get('/api/ads/config', (req, res) => {
    const ads = db.data.adSettings || {};
    // Return only enabled networks
    const active = {};
    Object.entries(ads).forEach(([network, cfg]) => {
        if (cfg.enabled) active[network] = cfg;
    });
    res.json({ success: true, ads: active });
});

// API: Admin - Delete/Disable Ad Network
app.delete('/api/admin/ads/:network', (req, res) => {
    const { network } = req.params;
    if (!db.data.adSettings || !db.data.adSettings[network]) {
        return res.json({ success: false, message: 'Ad network not found' });
    }

    // Remove the ad network from settings (or set enabled to false)
    delete db.data.adSettings[network];
    db.save();

    res.json({ success: true, message: `Ad network ${network} deleted successfully` });
});

// API: Admin - Services (UNIFIED FOR COST MANAGEMENT)
app.get('/api/admin/services', (req, res) => {
    const services = db.data.services || {};
    const toDelete = [];
    const normalizedNames = new Set();

    // Find duplicates and demo data
    Object.keys(services).forEach(id => {
        const s = services[id];
        const nameLower = s.name ? s.name.toLowerCase() : id.toLowerCase();

        // Criteria 1: Zero price (likely demo)
        // Criteria 2: Specific junk names
        // Criteria 3: Duplicate names (case insensitive)
        if (s.price === 0 || nameLower === 'mamun islam' || id.toLowerCase().includes('demo')) {
            toDelete.push(id);
        } else if (normalizedNames.has(nameLower)) {
            toDelete.push(id); // Duplicate!
        } else {
            normalizedNames.add(nameLower);
        }
    });

    // Delete them
    toDelete.forEach(id => {
        db.deleteService(id);
    });

    // Also check legacy items in cardPrices
    if (db.data.cardPrices) {
        Object.keys(db.data.cardPrices).forEach(id => {
            if (id.toLowerCase().includes('demo') || id.toLowerCase() === 'mamun islam') {
                delete db.data.cardPrices[id];
            }
        });
    }

    // Update VPN sections for known VPNs
    Object.keys(services).forEach(id => {
        if (id.toLowerCase().includes('vpn') || ['cyberghost', 'nordvpn', 'expressvpn', 'surfshark', 'protonvpn'].includes(id.toLowerCase())) {
            db.updateServiceSection(id, 'vpn');
        }
    });

    db.save();

    // Proceed with loaded services after cleanup
    const updatedServices = db.data.services || {};
    const shopItems = db.data.shopItems || {};

    // Convert services to array
    const servicesList = Object.values(updatedServices).map(s => {
        const cardStock = db.data.cards?.[s.id]?.length || 0;
        const vpnStock = db.data.vpnAccounts?.[s.id]?.length || 0;
        return {
            ...s,
            section: db.getServiceSection(s.id),
            imageUrl: db.data.serviceIcons?.[s.id] || s.imageUrl || '',
            stock: cardStock || vpnStock || 0
        };
    });

    // Convert shopItems to array (if they haven't been merged into services yet)
    const shopItemsList = Object.values(shopItems).map(i => {
        const cardStock = db.data.cards?.[i.id]?.length || 0;
        const vpnStock = db.data.vpnAccounts?.[i.id]?.length || 0;
        return {
            id: i.id,
            name: i.name,
            price: i.price || 0,
            section: i.section || 'shop',
            imageUrl: db.data.serviceIcons?.[i.id] || i.imageUrl || '',
            stock: cardStock || vpnStock || 0
        };
    });

    // Add legacy items if they are missing
    const legacyItems = [];
    if (db.data.cardPrices) {
        Object.entries(db.data.cardPrices).forEach(([id, price]) => {
            if (!services[id] && !shopItems[id]) {
                legacyItems.push({
                    id,
                    name: db.data.serviceNames?.[id] || id.toUpperCase(),
                    price,
                    section: 'cards',
                    imageUrl: db.data.serviceIcons?.[id] || '',
                    stock: db.data.cards?.[id]?.length || 0
                });
            }
        });
    }
    if (db.data.vpnPrices) {
        Object.entries(db.data.vpnPrices).forEach(([id, price]) => {
            if (!services[id] && !shopItems[id]) {
                legacyItems.push({
                    id,
                    name: db.data.vpnServiceNames?.[id] || id.toUpperCase(),
                    price,
                    section: 'vpn',
                    stock: db.data.vpnAccounts?.[id]?.length || 0
                });
            }
        });
    }

    // Add items from settings.costs (gemini, gpt, etc.)
    const settingCosts = [];
    if (db.data.settings && db.data.settings.costs) {
        Object.entries(db.data.settings.costs).forEach(([id, price]) => {
            settingCosts.push({
                id,
                name: id.charAt(0).toUpperCase() + id.slice(1) + " (Bot Access)",
                price,
                section: 'settings',
                stock: 0 // Settings costs usually don't have stock
            });
        });
    }

    res.json({
        success: true,
        services: [...servicesList, ...shopItemsList, ...legacyItems]
    });
});

// Public API: Get Services (for user panel) - Filters out 0 stock items
app.get('/api/public/services', (req, res) => {
    // Get service items with stock
    const serviceItems = db.data.serviceItems || {};
    const availableItems = Object.entries(serviceItems)
        .filter(([id, item]) => (item.stock || 0) > 0) // Only items with stock > 0
        .map(([id, item]) => ({
            id,
            ...item,
            section: item.categoryId,
            imageUrl: db.data.serviceIcons?.[id] || item.imageUrl || ''
        }));

    // Also get legacy services (if still using old system)
    const services = db.data.services || {};
    const servicesWithSections = Object.values(services)
        .map(s => {
            const cardStock = db.data.cards?.[s.id]?.length || 0;
            const vpnStock = db.data.vpnAccounts?.[s.id]?.length || 0;
            const realStock = cardStock || vpnStock || s.stock || 0;
            return {
                ...s,
                section: db.getServiceSection(s.id),
                imageUrl: db.data.serviceIcons?.[s.id] || s.imageUrl || '',
                stock: realStock
            };
        })
        .filter(s => s.stock > 0 || s.stock === undefined);

    // Combine both systems
    res.json({
        success: true,
        services: [...availableItems, ...servicesWithSections],
        categories: db.getServiceCategories()
    });
});

app.post('/api/admin/services', (req, res) => {
    const item = req.body;
    db.data.services = db.data.services || {};
    db.data.services[item.id] = item;

    // Save section assignment
    if (item.section) {
        db.updateServiceSection(item.id, item.section);
    }

    db.save();
    res.json({ success: true });
});

app.post('/api/admin/cleanup-services', (req, res) => {
    const services = db.data.services || {};
    const toDelete = [];
    const normalizedNames = new Set();

    // Find duplicates and demo data
    Object.keys(services).forEach(id => {
        const s = services[id];
        const nameLower = s.name ? s.name.toLowerCase() : id.toLowerCase();

        // Criteria 1: Zero price (likely demo)
        // Criteria 2: Specific junk names
        // Criteria 3: Duplicate names (case insensitive)
        if (s.price === 0 || nameLower === 'mamun islam' || id.toLowerCase().includes('demo')) {
            toDelete.push(id);
        } else if (normalizedNames.has(nameLower)) {
            toDelete.push(id); // Duplicate!
        } else {
            normalizedNames.add(nameLower);
        }
    });

    // Delete them
    toDelete.forEach(id => {
        db.deleteService(id);
    });

    // Also check legacy items in cardPrices
    if (db.data.cardPrices) {
        Object.keys(db.data.cardPrices).forEach(id => {
            if (id.toLowerCase().includes('demo') || id.toLowerCase() === 'mamun islam') {
                delete db.data.cardPrices[id];
            }
        });
    }

    // Update VPN sections for known VPNs
    Object.keys(services).forEach(id => {
        if (id.toLowerCase().includes('vpn') || ['cyberghost', 'nordvpn', 'expressvpn', 'surfshark', 'protonvpn'].includes(id.toLowerCase())) {
            db.updateServiceSection(id, 'vpn');
        }
    });

    db.save();

    res.json({ success: true, deleted: toDelete });
});

app.delete('/api/admin/services/:id', (req, res) => {
    const { id } = req.params;
    const deleted = db.deleteService(id);
    if (deleted) {
        res.json({ success: true, message: 'Service deleted from all systems' });
    } else {
        res.json({ success: false, message: 'Service not found or already deleted' });
    }
});

// API: Admin - Shop Items
app.get('/api/admin/shop', (req, res) => {
    const items = db.data.shopItems || {};
    const itemsWithStock = Object.values(items).map(item => {
        const stock = db.data.shopStock?.[item.id] || [];
        const available = stock.filter(s => !s.sold).length;
        return { ...item, stockCount: available };
    });
    res.json({ success: true, shopItems: itemsWithStock });
});

// Public API: Get Shop Items (for user panel)
app.get('/api/shop', (req, res) => {
    const items = db.data.shopItems || {};
    const itemsWithStock = Object.values(items).map(item => {
        const stock = db.data.shopStock?.[item.id] || [];
        const available = stock.filter(s => !s.sold).length;
        return { ...item, stockCount: available };
    });
    res.json({ success: true, shopItems: itemsWithStock });
});

app.post('/api/admin/shop', (req, res) => {
    const item = req.body;
    db.data.shopItems = db.data.shopItems || {};
    db.data.shopItems[item.id] = item;
    db.save();
    res.json({ success: true });
});

app.delete('/api/admin/shop/:id', (req, res) => {
    const { id } = req.params;
    if (db.data.shopItems && db.data.shopItems[id]) {
        delete db.data.shopItems[id];
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// =============================================
// SHOP STOCK API
// =============================================

app.get('/api/admin/shop-stock/:shopId', (req, res) => {
    const { shopId } = req.params;
    const stock = db.data.shopStock?.[shopId] || [];
    // Return only unsold stock for admin to view
    const unsold = stock.filter(s => !s.sold);
    res.json({ success: true, stock: unsold });
});

app.post('/api/admin/shop-stock', (req, res) => {
    const { shopId, type, email, password, twoFactor, key } = req.body;
    if (!shopId) return res.json({ success: false, message: 'Shop ID required' });
    
    if (!db.data.shopStock) db.data.shopStock = {};
    if (!db.data.shopStock[shopId]) db.data.shopStock[shopId] = [];

    const newItem = {
        id: 'stock_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        type,
        email,
        password,
        twoFactor,
        key,
        sold: false,
        addedAt: Date.now()
    };

    db.data.shopStock[shopId].push(newItem);
    db.save();
    res.json({ success: true, item: newItem });
});

app.delete('/api/admin/shop-stock/:shopId/:stockId', (req, res) => {
    const { shopId, stockId } = req.params;
    if (db.data.shopStock && db.data.shopStock[shopId]) {
        db.data.shopStock[shopId] = db.data.shopStock[shopId].filter(s => s.id !== stockId);
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.delete('/api/admin/shop-stock/:shopId/clear', (req, res) => {
    const { shopId } = req.params;
    if (db.data.shopStock && db.data.shopStock[shopId]) {
        // Only keep sold stock, delete unsold
        db.data.shopStock[shopId] = db.data.shopStock[shopId].filter(s => s.sold);
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Google OAuth Login Start
app.get('/auth/google', (req, res) => {
    const { state } = req.query; // state = userId OR 'admin'
    if (!state) {
        return res.send('Error: Missing state parameter (userId or admin)');
    }
    // Redirect to Google Consent Screen
    const authUrl = oauth.getAuthUrl(state);
    res.redirect(authUrl);
});

// Google OAuth Callback
app.get('/auth/google/callback', async (req, res) => {
    const { code, state } = req.query; // state = userId OR 'admin'

    if (!code || !state) {
        return res.send('Error: Missing code or state');
    }

    try {
        const success = await oauth.handleCallback(code, state);
        if (success) {
            res.send('<h1>✅ Google Account Connected Successfully!</h1><p>You can close this window and return to the Telegram bot or Admin Panel.</p>');
        } else {
            res.send('<h1>❌ Connection Failed</h1><p>Please try again.</p>');
        }
    } catch (error) {
        console.error('OAuth Error:', error);
        res.send('<h1>❌ Error Occurred</h1><p>' + error.message + '</p>');
    }
});

app.post('/api/admin/services/items', (req, res) => {
    const { itemId, category, cost, items, vpnName } = req.body;

    if (!itemId || !items || !Array.isArray(items)) {
        return res.json({ success: false, message: 'Invalid request data' });
    }

    try {
        let addedCount = 0;

        if (category === 'vpn' || itemId === 'new') {
            // Handle VPN items
            const providerId = vpnName ? vpnName.toLowerCase().replace(/\s+/g, '-') : itemId;

            items.forEach(item => {
                if (db.addVPN) {
                    db.addVPN(providerId, {
                        email: item.value,
                        password: item.info,
                        addedAt: Date.now()
                    });
                    addedCount++;
                } else {
                    // Fallback if addVPN doesn't exist
                    if (!db.data.vpnAccounts) db.data.vpnAccounts = {};
                    if (!db.data.vpnAccounts[providerId]) db.data.vpnAccounts[providerId] = [];
                    db.data.vpnAccounts[providerId].push({
                        email: item.value,
                        password: item.info,
                        addedAt: Date.now()
                    });
                    addedCount++;
                }
            });

            // Set VPN price if cost provided
            if (cost && db.data.vpnPrices) {
                db.data.vpnPrices[providerId] = parseInt(cost);
            }

        } else {
            // Handle Card/Key items (for gemini, chatgpt, spotify, 4jibit, etc.)
            const serviceId = itemId;

            items.forEach(item => {
                // Create card details - store value and info as card details
                const cardDetails = {
                    key: item.value,
                    info: item.info,
                    addedAt: Date.now()
                };

                if (db.addCard) {
                    db.addCard(serviceId, cardDetails);
                    addedCount++;
                }
            });

            // Set card price if cost provided and different from current
            if (cost && db.data.cardPrices) {
                db.data.cardPrices[serviceId] = parseInt(cost);
            }

            // Ensure service name exists
            if (db.data.serviceNames && !db.data.serviceNames[serviceId]) {
                db.data.serviceNames[serviceId] = serviceId.charAt(0).toUpperCase() + serviceId.slice(1);
            }
        }

        db.save();

        res.json({
            success: true,
            message: `Added ${addedCount} items`,
            addedCount,
            itemId,
            category
        });
    } catch (error) {
        console.error('Error saving service items:', error);
        res.json({ success: false, message: error.message });
    }
});

// Admin: Update service item details
app.post('/api/admin/services/update', (req, res) => {
    const { id, name, price, desc, icon } = req.body;
    if (!id) return res.json({ success: false, message: 'Missing item ID' });

    // Update names if available
    if (db.data.serviceNames && name) {
        db.data.serviceNames[id] = name;
    }

    // Update prices
    if (price !== undefined) {
        const p = parseInt(price) || 0;
        if (db.data.cardPrices) db.data.cardPrices[id] = p;
        if (db.data.vpnPrices) db.data.vpnPrices[id] = p;
    }

    // Update icon
    if (icon) {
        db.data.serviceIcons = db.data.serviceIcons || {};
        db.data.serviceIcons[id] = icon;
    }

    // Update description
    if (desc !== undefined) {
        db.data.serviceDescriptions = db.data.serviceDescriptions || {};
        db.data.serviceDescriptions[id] = desc;
    }

    db.save(true); // Force save
    res.json({ success: true });
});

// Admin: Upload database config json
app.post('/api/admin/dbconfig/upload', (req, res) => {
    try {
        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.json({ success: false, message: 'No valid config provided' });
        }

        // Merge config into db.data.apiKeys (common spot for configuration)
        if (!db.data.apiKeys) db.data.apiKeys = {};
        Object.assign(db.data.apiKeys, config);

        db.save();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// API: Toggle service item active status
app.post('/api/admin/services/:id/toggle', (req, res) => {
    const { id } = req.params;
    const { active } = req.body;

    // For cards/VPN, we don't really have an active flag,
    // but we can clear stock to "deactivate"
    if (!active) {
        if (db.data.cards && db.data.cards[id]) {
            db.data.cards[id] = [];
        }
        if (db.data.vpnAccounts && db.data.vpnAccounts[id]) {
            db.data.vpnAccounts[id] = [];
        }
        db.save();
    }

    res.json({ success: true, id, active });
});

// =============================================
// NEW SERVICE CATEGORIES & ITEMS API
// =============================================

// Get all service categories
app.get('/api/admin/service-categories', (req, res) => {
    const categories = db.getServiceCategories();
    res.json({ success: true, categories });
});

// Create new category
app.post('/api/admin/service-categories', (req, res) => {
    const categoryData = req.body;
    const newCategory = db.createServiceCategory(categoryData);
    res.json({ success: true, category: newCategory });
});

// Update category
app.put('/api/admin/service-categories/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const updated = db.updateServiceCategory(id, updates);
    if (updated) {
        res.json({ success: true, category: updated });
    } else {
        res.status(404).json({ success: false, message: 'Category not found' });
    }
});

// Delete category
app.delete('/api/admin/service-categories/:id', (req, res) => {
    const { id } = req.params;
    const deleted = db.deleteServiceCategory(id);
    if (deleted) {
        res.json({ success: true, message: 'Category deleted' });
    } else {
        res.status(404).json({ success: false, message: 'Category not found' });
    }
});

// Get all service items (optionally filtered by category)
app.get('/api/admin/service-items', (req, res) => {
    const { categoryId } = req.query;
    const items = db.getServiceItems(categoryId);

    // Add stock count to each item
    const itemsWithStock = {};
    Object.keys(items).forEach(key => {
        itemsWithStock[key] = {
            ...items[key],
            stock: db.getServiceItemStock(key),
            id: key
        };
    });

    res.json({ success: true, items: itemsWithStock });
});

// Create new service item
app.post('/api/admin/service-items', (req, res) => {
    const { itemId, itemData } = req.body;
    const newItem = db.createServiceItem(itemId, itemData);
    res.json({ success: true, item: newItem });
});

// Update service item
app.put('/api/admin/service-items/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const updated = db.updateServiceItem(id, updates);
    if (updated) {
        res.json({ success: true, item: updated });
    } else {
        res.status(404).json({ success: false, message: 'Item not found' });
    }
});

// Delete service item
app.delete('/api/admin/service-items/:id', (req, res) => {
    const { id } = req.params;
    const deleted = db.deleteService(id); // Use the unified delete method
    if (deleted) {
        res.json({ success: true, message: 'Item deleted' });
    } else {
        res.status(404).json({ success: false, message: 'Item not found' });
    }
});

// Clear all stock for a specific item
app.delete('/api/admin/service-items/:id/clear', (req, res) => {
    const { id } = req.params;
    let cleared = false;

    if (db.data.cards && db.data.cards[id]) {
        db.data.cards[id] = [];
        cleared = true;
    }
    if (db.data.vpnAccounts && db.data.vpnAccounts[id]) {
        db.data.vpnAccounts[id] = [];
        cleared = true;
    }
    if (db.data.premiumAccounts) {
        const before = db.data.premiumAccounts.length;
        db.data.premiumAccounts = db.data.premiumAccounts.filter(a => a.type !== id);
        if (db.data.premiumAccounts.length < before) {
            cleared = true;
        }
    }

    if (cleared) {
        db.save();
        res.json({ success: true, message: 'All stock cleared' });
    } else {
        res.json({ success: true, message: 'No stock to clear' }); // Still return success since it's already empty
    }
});

// Get stock for specific item
app.get('/api/admin/service-items/:id/stock', (req, res) => {
    const { id } = req.params;
    const stock = db.getServiceItemStock(id);
    res.json({ success: true, stock, id });
});

// Add stock items to a service (cards, accounts, or api keys)
app.post('/api/admin/service-items/:id/stock', (req, res) => {
    const { id } = req.params;
    const { items } = req.body;

    const serviceItem = db.data.serviceItems?.[id];
    if (!serviceItem) {
        return res.status(404).json({ success: false, message: 'Service item not found' });
    }

    let addedCount = 0;

    if (serviceItem.type === 'card' || serviceItem.type === 'apikey') {
        if (!db.data.cards[id]) db.data.cards[id] = [];
        items.forEach(item => {
            db.data.cards[id].push({
                ...item,
                addedAt: Date.now(),
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
            });
            addedCount++;
        });
    } else if (serviceItem.type === 'account') {
        if (!db.data.vpnAccounts[id]) db.data.vpnAccounts[id] = [];
        items.forEach(item => {
            db.data.vpnAccounts[id].push({
                ...item,
                addedAt: Date.now(),
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
            });
            addedCount++;
        });
    }

    db.save();
    res.json({
        success: true,
        message: `Added ${addedCount} items`,
        addedCount,
        currentStock: db.getServiceItemStock(id)
    });
});

// Delete individual stock item
app.delete('/api/admin/service-items/:id/stock/:index', (req, res) => {
    const { id, index } = req.params;
    const item = db.data.serviceItems?.[id];
    if (!item) {
        return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Get the appropriate stock array based on item type
    let stockArray = null;
    if (item.type === 'card') {
        stockArray = db.data.cards?.[id];
    } else if (item.type === 'account') {
        stockArray = db.data.vpnAccounts?.[id];
    } else if (item.type === 'apikey') {
        stockArray = db.data.apiKeys?.[id];
    }

    if (!stockArray || !Array.isArray(stockArray)) {
        return res.status(404).json({ success: false, message: 'Stock not found' });
    }

    const idx = parseInt(index);
    if (idx < 0 || idx >= stockArray.length) {
        return res.status(400).json({ success: false, message: 'Invalid index' });
    }

    // Remove the item at index
    stockArray.splice(idx, 1);

    // Update item stock count
    item.stock = stockArray.length;

    db.save();
    res.json({ success: true, message: 'Item deleted' });
});

// =============================================
// INVENTORY & COST MANAGEMENT
// =============================================

app.post('/api/admin/services/:id/price', (req, res) => {
    const { id } = req.params;
    const { price } = req.body;
    if (db.data.services && db.data.services[id]) {
        db.data.services[id].price = parseInt(price);
        db.save();
        res.json({ success: true });
    } else if (db.data.shopItems && db.data.shopItems[id]) {
        db.data.shopItems[id].price = parseInt(price);
        db.save();
        res.json({ success: true });
    } else if (db.data.settings && db.data.settings.costs && db.data.settings.costs[id] !== undefined) {
        db.data.settings.costs[id] = parseInt(price);
        db.save();
        res.json({ success: true });
    } else {
        // Fallback to legacy cardPrices/vpnPrices if they exist
        if (db.updatePrice) db.updatePrice(id, price);
        res.json({ success: true });
    }
});

app.get('/api/admin/inventory/:type', (req, res) => {
    const { type } = req.params;
    let items = [];

    if (type === 'cards') {
        const services = db.getServices();
        items = services.filter(s => db.getServiceSection(s.id) === 'cards' || s.id === 'gemini' || s.id === 'chatgpt' || s.id === 'spotify');
    } else if (type === 'vpn') {
        // Map vpnAccounts from db.js structure
        const vpnData = db.data.vpnAccounts || {};
        items = Object.keys(vpnData).map(vid => ({
            id: vid,
            name: db.data.vpnServiceNames?.[vid] || vid.toUpperCase(),
            price: db.data.vpnPrices?.[vid] || 0,
            stock: vpnData[vid].length
        }));
    } else if (type === 'accounts' || type === 'apikeys') {
        // For accounts and apikeys, we use the services/shopItems structure but filter by section
        const all = { ...(db.data.services || {}), ...(db.data.shopItems || {}) };
        items = Object.values(all)
            .filter(s => s.section === type)
            .map(s => ({
                id: s.id,
                name: s.name,
                price: s.price || 0,
                stock: s.stock || 0
            }));
    }

    res.json({ success: true, items });
});

app.post('/api/admin/inventory/:type', (req, res) => {
    const { type } = req.params;
    const body = req.body;

    if (type === 'cards') {
        const { serviceId, details } = body;
        if (db.addCard) {
            db.addCard(serviceId, details);
            res.json({ success: true });
        } else {
            res.json({ success: false, message: 'Database method not found' });
        }
    } else if (type === 'vpn') {
        const { providerId, email, pass } = body;
        if (!db.data.vpnAccounts) db.data.vpnAccounts = {};
        if (!db.data.vpnAccounts[providerId]) db.data.vpnAccounts[providerId] = [];
        db.data.vpnAccounts[providerId].push({ email, pass, date: Date.now() });
        db.save();
        res.json({ success: true });
    } else if (type === 'accounts') {
        const { service, login, pass } = body;
        const id = 'acc_' + Date.now();
        if (!db.data.shopItems) db.data.shopItems = {};
        db.data.shopItems[id] = { id, name: service, login, pass, section: 'accounts', price: 0, stock: 1 };
        db.save();
        res.json({ success: true });
    } else if (type === 'apikeys') {
        const { service, key } = body;
        const id = 'api_' + Date.now();
        if (!db.data.shopItems) db.data.shopItems = {};
        db.data.shopItems[id] = { id, name: service, key, section: 'apikeys', price: 0, stock: 1 };
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Invalid type' });
    }
});

app.delete('/api/admin/inventory/:type/:id', (req, res) => {
    const { type, id } = req.params;
    if (type === 'cards') {
        // Clear all cards for a service or delete specific? 
        // Admin UI shows service row, so we'll clear cards for that service
        if (db.clearCards) db.clearCards(id);
    } else if (type === 'vpn') {
        if (db.data.vpnAccounts && db.data.vpnAccounts[id]) {
            db.data.vpnAccounts[id] = [];
            db.save();
        }
    } else {
        if (db.data.shopItems && db.data.shopItems[id]) {
            delete db.data.shopItems[id];
            db.save();
        }
    }
    res.json({ success: true });
});

// =============================================
// USER VERIFICATION SYSTEM
// =============================================

// Helper: Get verification requirements settings
function getVerificationRequirements() {
    return db.data.settings?.verificationRequirements || {
        minInvites: 3,
        minTokens: 100,
        minDaysActive: 7,
        requireChannelJoin: true,
        requireGroupJoin: true,
        enabled: true
    };
}

// Helper: Check if user meets verification requirements
async function checkUserVerificationRequirements(userId) {
    const user = await db.getUser(userId);
    if (!user) return { met: false, reason: 'User not found' };

    // Admin verified users bypass all checks
    if (user.adminVerified) {
        return { met: true, adminVerified: true, reason: 'Admin verified' };
    }

    const reqs = getVerificationRequirements();
    if (!reqs.enabled) {
        return { met: true, reason: 'Verification system disabled' };
    }

    const checks = {
        invites: (user.referralCount || 0) >= reqs.minInvites,
        tokens: db.getTokenBalance(user) >= reqs.minTokens,
        daysActive: user.joinDate && (Date.now() - user.joinDate) >= (reqs.minDaysActive * 24 * 60 * 60 * 1000),
        channelJoin: !reqs.requireChannelJoin || (user.joinedChannel || user.channelJoined),
        groupJoin: !reqs.requireGroupJoin || (user.joinedGroup || user.groupJoined)
    };

    const allMet = Object.values(checks).every(v => v === true);

    return {
        met: allMet,
        checks,
        requirements: reqs,
        userData: {
            invites: user.referralCount || 0,
            tokens: db.getTokenBalance(user),
            joinDate: user.joinDate,
            channelJoined: user.joinedChannel || user.channelJoined || false,
            groupJoined: user.joinedGroup || user.groupJoined || false
        }
    };
}

// API: Get verification requirements (Admin)
app.get('/api/admin/verification/requirements', (req, res) => {
    res.json({
        success: true,
        requirements: getVerificationRequirements()
    });
});

// API: Update verification requirements (Admin)
app.post('/api/admin/verification/requirements', (req, res) => {
    const {
        minInvites,
        minTokens,
        minDaysActive,
        requireChannelJoin,
        requireGroupJoin,
        enabled
    } = req.body;

    if (!db.data.settings) db.data.settings = {};
    if (!db.data.settings.verificationRequirements) db.data.settings.verificationRequirements = {};

    const reqs = db.data.settings.verificationRequirements;

    if (minInvites !== undefined) reqs.minInvites = parseInt(minInvites) || 3;
    if (minTokens !== undefined) reqs.minTokens = parseInt(minTokens) || 100;
    if (minDaysActive !== undefined) reqs.minDaysActive = parseInt(minDaysActive) || 7;
    if (requireChannelJoin !== undefined) reqs.requireChannelJoin = !!requireChannelJoin;
    if (requireGroupJoin !== undefined) reqs.requireGroupJoin = !!requireGroupJoin;
    if (enabled !== undefined) reqs.enabled = !!enabled;

    db.save();
    res.json({ success: true, requirements: reqs });
});

// API: Check user verification status
app.get('/api/user/:userId/verification-status', async (req, res) => {
    const { userId } = req.params;
    const user = await db.getUser(userId);

    if (!user) return res.json({ success: false, message: 'User not found' });

    const result = await checkUserVerificationRequirements(userId);

    res.json({
        success: true,
        userId,
        verified: user.verified || false,
        adminVerified: user.adminVerified || false,
        ...result
    });
});

// API: Admin verify/unverify user
app.post('/api/admin/users/:userId/verify', async (req, res) => {
    const { userId } = req.params;
    const { adminVerified, verified } = req.body;

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    if (adminVerified !== undefined) {
        user.adminVerified = !!adminVerified;
    }
    if (verified !== undefined) {
        user.verified = !!verified;
    }

    await db.updateUser(user);
    res.json({
        success: true,
        message: 'User verification updated',
        userId,
        adminVerified: user.adminVerified,
        verified: user.verified
    });
});

// =============================================
// MISSING API ENDPOINTS (Added to fix 404 errors)
// =============================================

// API: Check Required Joins (Telegram Channel/Group verification)
app.post('/api/check-required-joins', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.json({ success: false, message: 'User ID required' });
    }

    const user = await db.getUser(userId);

    // 1. Check if user is Admin Verified
    if (user && user.adminVerified) {
        return res.json({
            success: true,
            allJoined: true,
            canProceed: true,
            verified: true,
            adminVerified: true,
            message: 'Admin Verified'
        });
    }

    // 2. Check verification requirements
    const reqs = getVerificationRequirements();

    // 3. Real-time strict membership check
    const apiKeys = db.data.apiKeys || {};
    const channelId = apiKeys.requiredChannelId || config.REQUIRED_CHANNEL_ID;
    const groupId = apiKeys.requiredGroupId || config.REQUIRED_GROUP_ID;
    const channelName = apiKeys.requiredChannel || config.REQUIRED_CHANNEL;
    const groupName = apiKeys.requiredGroup || config.REQUIRED_GROUP;

    let channelJoined = true;
    let groupJoined = true;

    if (bot) {
        const checkMembership = async (chatId) => {
            if (!chatId) return true;
            try {
                const member = await bot.getChatMember(chatId, userId);
                const valid = ['creator', 'administrator', 'member', 'restricted'];
                return valid.includes(member.status);
            } catch (e) {
                if (e.message.includes('chat not found') || e.message.includes('PARTICIPANT_ID_INVALID')) {
                    // Chat doesn't exist, ID is wrong, or user is unknown to bot - silence logging and apply fallback if skip is allowed
                    return config.SKIP_MANDATORY_JOIN || false;
                }
                console.error(`[CHAT_CHECK] Error for ${chatId}:`, e.message);
                return false;
            }
        };

        if (reqs.requireChannelJoin) {
            channelJoined = await checkMembership(channelId);
            // If primary ID fails with 'chat not found', try the username fallback
            if (!channelJoined && channelName && channelName !== channelId) {
                channelJoined = await checkMembership(channelName);
            }
        }
        if (reqs.requireGroupJoin) {
            groupJoined = await checkMembership(groupId);
            // If primary ID fails with 'chat not found', try the username fallback
            if (!groupJoined && groupName && groupName !== groupId) {
                groupJoined = await checkMembership(groupName);
            }
        }

        // Update user record
        if (user) {
            user.joinedChannel = channelJoined;
            user.joinedGroup = groupJoined;

            // Auto revoke if they left
            if (!channelJoined || !groupJoined) {
                user.verified = false;
            }
            db.updateUser(user);
        }
    }

    // 4. Verification Check (optional, separate from join requirement)
    const vStatus = await checkUserVerificationRequirements(userId);

    // Auto-verify if they meet full criteria and have joined chats
    if (vStatus.met && channelJoined && groupJoined && user && !user.verified) {
        user.verified = true;
        db.updateUser(user);
    }

    // canProceed is ONLY based on join status (channel + group)
    // Full verification requirements are a separate premium feature
    const canProceed = channelJoined && groupJoined;

    res.json({
        success: true,
        allJoined: channelJoined && groupJoined,
        canProceed: canProceed,
        channelJoined,
        groupJoined,
        verified: user?.verified || false,
        adminVerified: user?.adminVerified || false,
        requirements: vStatus
    });
});

// API: User Activity (for broadcast ticker)
app.get('/api/user-activity', (req, res) => {
    try {
        // Get recent user activities from database
        // Collect recent activity from ALL users, then sort
        let allActivities = [];
        const userList = Object.values(db.data.users || {});

        userList.forEach(user => {
            if (user.history && user.history.length > 0) {
                // Take last 5 from each user to ensure we find enough recently
                user.history.slice(0, 5).forEach(h => {
                    let action = 'spend';
                    let item = h.type || 'activity';
                    let amount = h.amount || 0;
                    let currency = (h.asset || h.currency || 'TC').toUpperCase();

                    // Map types to actions
                    if (['ad_reward', 'mission_reward', 'daily_bonus', 'redeem', 'transfer_in', 'quiz_reward', 'bonus', 'deposit', 'scratch_reward'].includes(h.type)) {
                        action = 'reward';
                    }

                    if (h.type === 'mail') item = 'Temp Mail';
                    else if (h.type === 'number') item = 'Number';
                    else if (h.type === 'account_purchase') item = h.category || 'Account';
                    else if (h.type === 'verification') item = 'Verify';
                    else if (h.type === 'transfer_out') { item = 'Transfer'; action = 'spend'; }
                    else if (h.type === 'transfer_in') { item = 'Receive'; action = 'reward'; }
                    else if (h.type === 'exchange') { item = 'Exchange'; action = 'spend'; }

                    // Fallback for amount parsing if h.amount is missing
                    if (!amount && h.reward) {
                        if (typeof h.reward === 'string') {
                            const m = h.reward.match(/-?(\d+)/);
                            if (m) amount = parseInt(m[1]);
                        } else if (typeof h.reward === 'number') {
                            amount = h.reward;
                        }
                    }

                    allActivities.push({
                        username: user.username || user.firstName || 'User',
                        action: action,
                        item: item,
                        amount: amount,
                        currency: currency,
                        date: h.date || Date.now()
                    });
                });
            }
        });

        // Filter out zero amounts if possible, but keep if it's all we have
        let validActivities = allActivities.filter(a => a.amount > 0);
        if (validActivities.length === 0) validActivities = allActivities;

        // Sort by date (newest first) and take top 12
        validActivities.sort((a, b) => (b.date || 0) - (a.date || 0));
        const recentActivities = validActivities.slice(0, 12);

        // If no activities found, return empty success
        if (recentActivities.length === 0) {
            return res.json({
                success: true,
                activities: [],
                message: 'No recent activities found'
            });
        }

        res.json({
            success: true,
            activities: recentActivities
        });
    } catch (error) {
        console.error('[USER ACTIVITY] Error:', error);
        res.json({
            success: false,
            message: 'Error fetching user activity',
            activities: []
        });
    }
});

// API: Claim Daily Reward (Tiered Streak System)
app.post('/api/daily/claim', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.json({ success: false, message: 'User ID required' });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    const now = Date.now();
    const lastClaim = user.lastDaily || 0;
    const oneDay = 24 * 60 * 60 * 1000;

    // Check if already claimed today
    if (now - lastClaim < oneDay) {
        const remaining = oneDay - (now - lastClaim);
        const hours = Math.floor(remaining / (60 * 60 * 1000));
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
        return res.json({
            success: false,
            message: `Already claimed today. Next claim in ${hours}h ${minutes}m`,
            remainingTime: remaining
        });
    }

    // Calculate streak (reset if missed a day)
    let streak = user.dailyStreak || 0;
    if (now - lastClaim > 2 * oneDay) {
        streak = 0; // Reset streak if missed a day
    }
    streak++;
    if (streak > 7) {
        streak = 1; // Reset to day 1 after completing a week
    }

    // Calculate reward based on streak
    const rewards = [10, 20, 30, 40, 50, 60, 100];
    const reward = rewards[streak - 1] || 10;

    let gemsReward = 0;
    if (streak === 5 || streak === 6) gemsReward = 1;
    if (streak === 7) gemsReward = 2;

    // Update user data
    user.lastDaily = now;
    user.dailyStreak = streak;

    // Add reward and handle support loan auto-repayment
    const currentBalance = db.getTokenBalance(user) || 0;
    const supportLoan = user.supportLoan || 0;

    let newBalance = currentBalance + reward;
    let repaidAmount = 0;
    let newSupportLoan = supportLoan;

    // If user has a support loan, auto-repay from earnings
    if (supportLoan > 0) {
        repaidAmount = Math.min(reward, supportLoan);
        newBalance = newBalance - repaidAmount;
        newSupportLoan = supportLoan - repaidAmount;
        user.supportLoan = newSupportLoan;

        // Add loan repayment history
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'support_loan_repay',
            earned: reward,
            repaid: repaidAmount,
            remainingLoan: newSupportLoan,
            date: Date.now()
        });
    }

    const currentGems = user.balance_Gems !== undefined ? user.balance_Gems : (user.Gems || 0);
    user.Gems = currentGems + gemsReward;
    user.balance_Gems = currentGems + gemsReward;
    db.setTokenBalance(user, newBalance);

    // Add daily bonus history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'daily_bonus',
        amount: reward,
        streak: streak,
        date: now
    });

    await db.updateUser(user);

    res.json({
        success: true,
        reward: reward,
        streak: streak,
        newBalance: newBalance,
        supportLoanRepaid: repaidAmount,
        remainingLoan: newSupportLoan
    });
});

// API: Leaderboard (Top Referrers and Earners)
app.get('/api/leaderboard', (req, res) => {
    const { userId, type = 'refer', period = 'week' } = req.query; // Optional: to get personal rank

    let top = [];
    let userRank = null;
    let userScore = 0;

    const allUsersList = Object.values(db.data.users);

    if (type === 'earn') {
        const sortedEarners = [...allUsersList]
            .map(u => ({ ...u, _cycleTokens: db.getTokenBalance(u) }))
            .filter(u => u._cycleTokens > 0)
            .sort((a, b) => b._cycleTokens - a._cycleTokens);

        top = sortedEarners.slice(0, 100).map(u => ({
            id: u.id,
            name: u.firstName || u.username || `User ${String(u.id).slice(-4)}`,
            score: u._cycleTokens,
            photo_url: u.photo_url || ''
        }));

        if (userId) {
            const idx = sortedEarners.findIndex(u => String(u.id) === String(userId));
            userRank = idx >= 0 ? idx + 1 : null;
            const thisUser = db.data.users[String(userId)];
            if (thisUser) userScore = db.getTokenBalance(thisUser);
        }
    } else if (type === 'quiz') {
        const sortedQuizPlayers = [...allUsersList]
            .filter(u => (u.quizPoints || 0) > 0)
            .sort((a, b) => (b.quizPoints || 0) - (a.quizPoints || 0));

        top = sortedQuizPlayers.slice(0, 100).map(u => ({
            id: u.id,
            name: u.firstName || u.username || `User ${String(u.id).slice(-4)}`,
            score: u.quizPoints || 0,
            photo_url: u.photo_url || ''
        }));

        if (userId) {
            const idx = sortedQuizPlayers.findIndex(u => String(u.id) === String(userId));
            userRank = idx >= 0 ? idx + 1 : null;
            const thisUser = db.data.users[String(userId)];
            if (thisUser) userScore = thisUser.quizPoints || 0;
        }
    } else {
        const sortedReferrers = [...allUsersList]
            .map(u => ({ ...u, _cycleReferrals: u.referralCount || 0 }))
            .filter(u => u._cycleReferrals > 0)
            .sort((a, b) => b._cycleReferrals - a._cycleReferrals);

        top = sortedReferrers.slice(0, 100).map(u => ({
            id: u.id,
            name: u.firstName || u.username || `User ${String(u.id).slice(-4)}`,
            score: u._cycleReferrals,
            photo_url: u.photo_url || ''
        }));

        if (userId) {
            const idx = sortedReferrers.findIndex(u => String(u.id) === String(userId));
            userRank = idx >= 0 ? idx + 1 : null;
            const thisUser = db.data.users[String(userId)];
            if (thisUser) userScore = thisUser.referralCount || 0;
        }
    }

    res.json({ success: true, top, userRank, userScore, type });
});

// API: Get User Referrals (for invite page)
app.get('/api/referrals/:userId', async (req, res) => {
    const { userId } = req.params;

    // Validate userId
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    if (isNaN(numericId) || numericId <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const user = await db.getUser(userId);

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    const refBonus = (db.data.settings && db.data.settings.refBonus) || 50;
    const botUsername = (db.data.settings && db.data.settings.botUsername) || 'AutosVerify_bot';

    // Get or generate referral code for user
    const referralCode = db.getReferralCode(userId);

    // Get referred users with Pending/Verified status and photo
    const referredUsers = (await Promise.all((user.referredUsers || []).map(async ref => {
        const refUser = await db.getUser(ref.userId);
        return {
            userId: ref.userId,
            name: refUser ? (refUser.firstName || refUser.username || `User ${String(ref.userId).slice(-4)}`) : `User ${String(ref.userId).slice(-4)}`,
            photo_url: refUser ? (refUser.photoUrl || refUser.photo_url || null) : null,
            date: ref.date || Date.now(),
            status: ref.rewarded ? 'Verified' : 'Pending',
            reward: ref.rewarded ? `+${refBonus}` : 'Pending'
        };
    }))).reverse(); // Most recent first

    // Calculate stats
    const totalInvited = referredUsers.length;
    const totalEarned = referredUsers.filter(r => r.status === 'Verified').length * refBonus;

    res.json({
        success: true,
        referrals: referredUsers,
        stats: {
            invited: totalInvited,
            earned: totalEarned
        },
        referralCode: referralCode,
        referralLink: `https://t.me/${botUsername}?start=${referralCode}`
    });
});


// API: Proxy Telegram Avatar (so we don't expose bot token)
app.get('/api/proxy-avatar', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).send('userId required');

    try {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) return res.status(500).send('Bot token not configured');

        // Fetch user profile photos
        const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`);
        const photosData = await photosRes.json();

        if (photosData.ok && photosData.result.total_count > 0) {
            const fileId = photosData.result.photos[0][0].file_id;

            // Get file path
            const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
            const fileData = await fileRes.json();

            if (fileData.ok) {
                const filePath = fileData.result.file_path;
                const photoUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

                // Fetch image and send
                const imgRes = await fetch(photoUrl);
                const buffer = await imgRes.buffer();
                res.set('Content-Type', imgRes.headers.get('content-type'));
                res.send(buffer);
                return;
            }
        }
    } catch (e) {
        console.error('Failed to proxy avatar:', e.message);
    }

    // Fallback to 404 so frontend can use letter avatar
    res.status(404).send('Not found');
});


// =============================================
// ITEM SELLING (USER SUBMISSIONS)
// =============================================

app.get('/api/user/item-sales/rewards', (req, res) => {
    const rewards = db.data.sellingRewards || {
        "Gmail": 50,
        "TikTok": 100,
        "Facebook": 80,
        "Telegram": 120,
        "Discord": 150,
        "Other": 40,
        "2faMultiplier": 1.5
    };
    res.json({ success: true, rewards });
});

// User: Submit item for sale
app.post('/api/user/item-sales/submit', (req, res) => {
    const { userId, itemType, isSubscription, rewardCurrency, accountName, accountLogo,
        email, password, is2fa, twoFA,
        customName, iconBase64, appUrl,
        serviceName, apiKey, apiQuota, extraInfo,
        vpnName, vpnPlan, cardType, cardNumber, cardExpiry, cardCVV, cardHolder, cardCountry, cardBillingAddress } = req.body;
    if (!userId || !itemType) return res.json({ success: false, message: 'Missing fields' });

    if (!db.getItemSales()) return res.json({ success: false, message: 'Database not ready' });

    const saleId = 'sale_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const saleData = {
        id: saleId,
        userId: userId.toString(),
        itemType,
        isSubscription: !!isSubscription,
        rewardCurrency: rewardCurrency || (itemType === 'Card' ? 'Tokens' : 'USD'),
        accountName: accountName || '',
        accountLogo: accountLogo || '',
        // Account fields
        email: email || '',
        password: password || '',
        is2fa: !!is2fa,
        twoFA: twoFA || null,
        // ... other fields remain ...
        customName: customName || '',
        iconBase64: iconBase64 || '',
        appUrl: appUrl || '',
        serviceName: serviceName || '',
        apiKey: apiKey || '',
        apiQuota: apiQuota || '',
        extraInfo: extraInfo || '',
        vpnName: vpnName || '',
        vpnPlan: vpnPlan || '',
        cardType: cardType || '',
        cardNumber: cardNumber || '',
        cardExpiry: cardExpiry || '',
        cardCVV: cardCVV || '',
        cardHolder: cardHolder || '',
        cardCountry: cardCountry || '',
        cardBillingAddress: cardBillingAddress || '',
        status: 'pending',
        stock: 1,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    db.saveItemSale(saleData);

    res.json({ success: true, message: 'Item submitted successfully! Waiting for admin approval.', sale: saleData });
});


// User: Get my sale submissions
app.get('/api/user/item-sales/my', (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, items: [] });

    const sales = Object.values(db.data.itemSales || {}).filter(s => s.userId === userId.toString());
    // Sort by newest first
    sales.sort((a, b) => b.createdAt - a.createdAt);

    res.json({ success: true, items: sales });
});

// Public: Get all approved user items with stock > 0 (for shop display)
app.get('/api/user/item-sales/approved', (req, res) => {
    const items = Object.values(db.data.itemSales || {})
        .filter(s => s.status === 'approved' && (s.stock || 0) > 0)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50);
    res.json({ success: true, items });
});

// Admin: Delete an approved item
app.delete('/api/admin/item-sales/:id', (req, res) => {
    const { id } = req.params;

    if (!db.data.itemSales || !db.data.itemSales[id]) {
        return res.json({ success: false, message: 'Item not found' });
    }

    // Get item details for notification
    const item = db.data.itemSales[id];
    const itemName = item.itemName || 'Item';
    const sellerId = item.userId;

    // Delete the item
    delete db.data.itemSales[id];
    db.save();

    // Notify seller if bot is available
    if (bot && sellerId) {
        const deleteMsg = `🗑️ <b>Item Deleted by Admin</b>\n\nYour item <b>${itemName}</b> has been removed from the marketplace by an admin.\n\nIf you have questions, please contact support.`;
        bot.sendMessage(sellerId, deleteMsg, { parse_mode: 'HTML' }).catch(e => console.error('Delete notify error:', e.message));
    }

    res.json({ success: true, message: 'Item deleted successfully' });
});

// Admin: Get all sale submissions (pending/approved/rejected)
app.get('/api/admin/item-sales/all', (req, res) => {
    const itemSales = db.getItemSales ? db.getItemSales() : (db.data.itemSales || {});
    const sales = Object.values(itemSales);
    // Filter/Sort
    const pending = sales.filter(s => s.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
    const history = sales.filter(s => s.status !== 'pending').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);

    res.json({ success: true, pending, history });
});

// Admin: Update sale status (Approve/Reject/Offer) + set listing price
app.post('/api/admin/item-sales/update', (req, res) => {
    const { saleId, status, rewardAmount, sellingPrice, stock } = req.body;
    if (!saleId || !status) return res.json({ success: false, message: 'Missing fields' });

    const itemSales = db.getItemSales ? db.getItemSales() : (db.data.itemSales || {});
    if (!itemSales[saleId]) {
        return res.json({ success: false, message: 'Submission not found' });
    }

    const sale = itemSales[saleId];
    sale.status = status;
    sale.updatedAt = Date.now();

    // Set listing price if provided
    if (sellingPrice !== undefined) sale.price = parseInt(sellingPrice) || 0;
    // Set stock if provided
    if (stock !== undefined) sale.stock = parseInt(stock) || 1;
    // Store proposed reward if it's an offer or approval
    if (rewardAmount !== undefined) sale.rewardOffer = parseInt(rewardAmount) || 0;
    // Set expiration date (7 days from approval) - item expires if not sold
    if (status === 'approved') {
        sale.expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
    }

    // NOTE: Seller does NOT get paid immediately on approval.
    // They will only receive payment when the item is actually sold to a buyer.
    // Platform fee will be deducted from the reward (configurable percentage).
    // If item expires unsold after 7 days, it will be removed and seller gets nothing.

    // Get platform fee % for notifications
    const platformFeePercent = db.data.settings?.platformFee || 20;
    const sellerReceives = Math.floor(sale.rewardOffer * (100 - platformFeePercent) / 100);

    db.save();

    // Notify User
    if (bot) {
        let msg = '';
        const itemName = sale.accountName || sale.customName || sale.itemType || 'Item';
        if (status === 'offer_sent') {
            msg = `📩 <b>Price Offer Received!</b>\n\nAdmin has proposed a reward of <b>${sale.rewardOffer} ${sale.rewardCurrency || 'Tokens'}</b> for your item: <b>${itemName}</b>.\n\n💡 <b>Important:</b> If you accept and the item sells, you will receive <b>${sellerReceives} ${sale.rewardCurrency || 'Tokens'}</b> (after ${platformFeePercent}% platform fee).\n\nPlease open the app to Accept or Reject this price.`;
        } else if (status === 'approved') {
            msg = `✅ <b>Item Approved!</b>\n\nYour item <b>${itemName}</b> has been approved and is now listed for sale.\n\n💰 <b>Payment:</b> You will receive <b>${sellerReceives} ${sale.rewardCurrency || 'Tokens'}</b> after sale (${platformFeePercent}% platform fee deducted).\n⏰ <b>Expiration:</b> Your item will be available for <b>7 days</b>. If not sold by then, it will expire and be removed.\n\nYou'll be notified when someone purchases it.`;
        } else if (status === 'rejected') {
            msg = `❌ <b>Item Rejected</b>\n\nYour item <b>${itemName}</b> was rejected by Admin. (Reason: Quality or Policy).`;
        }

        if (msg) {
            bot.sendMessage(sale.userId, msg, { parse_mode: 'HTML' }).catch(e => console.error('Notify error:', e.message));
        }
    }

    res.json({ success: true, message: `Submission ${status} successfully.` });
});

// User: Accept or Reject Admin Offer
app.post('/api/user/item-sales/offer-action', (req, res) => {
    const { saleId, action, userId } = req.body; // action: 'accept' or 'reject'
    if (!saleId || !action || !userId) return res.json({ success: false, message: 'Missing fields' });

    const itemSales = db.getItemSales ? db.getItemSales() : (db.data.itemSales || {});
    if (!itemSales[saleId]) {
        return res.json({ success: false, message: 'Submission not found' });
    }

    const sale = itemSales[saleId];
    if (sale.userId !== userId.toString()) return res.json({ success: false, message: 'Unauthorized' });
    if (sale.status !== 'offer_sent') return res.json({ success: false, message: 'No pending offer for this item' });

    if (action === 'accept') {
        sale.status = 'approved';
        sale.updatedAt = Date.now();
        sale.expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days expiration
        // NOTE: Seller does NOT get paid immediately when accepting offer.
        // They will only receive payment when the item is actually sold to a buyer.
        // Platform fee will be deducted (configurable percentage).
        // Item expires after 7 days if not sold.
        db.save();
        const platformFeePercent = db.data.settings?.platformFee || 20;
        return res.json({ success: true, message: `Offer accepted! Your item is now listed for sale. You will receive ${100 - platformFeePercent}% of the price after sale (${platformFeePercent}% platform fee). Item expires in 7 days if not sold.` });
    } else if (action === 'reject') {
        const itemName = sale.accountName || sale.customName || sale.itemType || 'Item';
        const sellerName = sale.username || 'User';

        // Notify Admin of rejection
        if (bot) {
            const adminMsg = `⚠️ <b>Offer Rejected</b>\n\nUser @${sellerName} (#${userId}) has rejected your price offer for <b>${itemName}</b>. The item data has been deleted.`;
            bot.sendMessage(config.ADMIN_ID, adminMsg, { parse_mode: 'HTML' }).catch(e => console.error('Admin notify error:', e.message));
        }

        // Delete the item immediately as requested
        delete db.data.itemSales[saleId];
        db.save();
        return res.json({ success: true, message: 'Offer rejected. Item deleted.' });
    }

    return res.json({ success: false, message: 'Invalid action' });
});

// User: Buy approved item
app.post('/api/user/item-sales/buy', async (req, res) => {
    const { userId, saleId } = req.body;
    if (!userId || !saleId) return res.json({ success: false, message: 'Missing fields' });

    const user = await db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    const itemSales = db.getItemSales ? db.getItemSales() : (db.data.itemSales || {});
    if (!itemSales[saleId]) {
        return res.json({ success: false, message: 'Item not found' });
    }

    const sale = itemSales[saleId];
    if (sale.status !== 'approved' || (sale.stock || 0) <= 0) {
        return res.json({ success: false, message: 'Item no longer available' });
    }

    const price = parseFloat(sale.price) || 0;

    // Deduction logic: Always USD as requested
    const balance = user.usd || 0;
    if (balance < price) return res.json({ success: false, message: `Insufficient balance. Need $${price.toFixed(3)}.` });

    user.usd = parseFloat((balance - price).toFixed(3));
    db.addTransaction(userId, 'service', price, 'USD', `Bought ${sale.itemType}: ${sale.accountName || sale.customName || sale.cardType}`, 'shopping-cart');

    // Process Purchase
    sale.stock = (sale.stock || 1) - 1;
    if (sale.stock <= 0) sale.status = 'sold';

    // PAY SELLER - Only when item is actually sold to a buyer
    if (sale.rewardOffer > 0) {
        const seller = await db.getUser(sale.userId);
        if (seller) {
            const currency = sale.rewardCurrency || (sale.itemType === 'Card' ? 'Tokens' : 'USD');
            // Get platform fee % from settings (default 20%)
            const platformFeePercent = db.data.settings?.platformFee || 20;
            // Calculate seller payment: (100 - fee)% of reward
            const platformFee = Math.floor(sale.rewardOffer * (platformFeePercent / 100));
            const sellerPayment = sale.rewardOffer - platformFee;

            db.addCredit(sale.userId, sellerPayment, currency);
            db.addTransaction(sale.userId, 'bonus', sellerPayment, currency, `Payment for sold ${sale.itemType}: ${sale.accountName || sale.customName || sale.cardType || 'Item'} (after ${platformFeePercent}% fee)`, 'gift');

            // Notify seller that their item was sold
            if (bot) {
                const itemName = sale.accountName || sale.customName || sale.cardType || sale.itemType || 'Item';
                const sellerMsg = `🎉 <b>Item Sold!</b>\n\nYour item <b>${itemName}</b> has been purchased by a buyer.\n\n💰 Listed Price: <b>${sale.rewardOffer} ${currency}</b>\n💸 Platform Fee (${platformFeePercent}%): <b>-${platformFee} ${currency}</b>\n✅ You Received: <b>${sellerPayment} ${currency}</b>\n\nThank you for using our marketplace!`;
                bot.sendMessage(sale.userId, sellerMsg, { parse_mode: 'HTML' }).catch(e => console.error('Seller notify error:', e.message));
            }
        }
    }

    // Record purchase for buyer
    if (!user.purchasedItems) user.purchasedItems = [];
    user.purchasedItems.push({
        saleId: sale.id,
        itemType: sale.itemType,
        details: {
            email: sale.email,
            password: sale.password,
            twoFA: sale.twoFA,
            cardNumber: sale.cardNumber,
            cardExpiry: sale.cardExpiry,
            cardCVV: sale.cardCVV
        },
        boughtAt: Date.now()
    });

    db.save();

    res.json({
        success: true,
        message: 'Purchase successful! Check your history for details.',
        details: {
            email: sale.email,
            password: sale.password,
            twoFA: sale.twoFA,
            cardNumber: sale.cardNumber,
            cardExpiry: sale.cardExpiry,
            cardCVV: sale.cardCVV
        }
    });
});

app.get('/api/admin/global-history', (req, res) => {
    const users = db.data.users || {};
    let allHistory = [];

    Object.keys(users).forEach(userId => {
        const user = users[userId];
        const userHistory = user.history || [];
        userHistory.forEach(item => {
            allHistory.push({
                ...item,
                userId: userId,
                username: user.firstName ? user.firstName + (user.lastName ? ' ' + user.lastName : '') : (user.username || 'User')
            });
        });
    });

    // Sort by date descending
    allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, history: allHistory.slice(0, 500) });
});

// ==========================================
// AI MEDIA SERVICES - File Upload & Missing Routes
// ==========================================

// Upload file for watermark removal (returns hosted URL, uses existing disk upload middleware)
app.post('/api/ai/upload-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

        const baseUrl = process.env.APP_URL || 'http://localhost:3000';
        const fileUrl = baseUrl + '/uploads/' + req.file.filename;

        res.json({ success: true, url: fileUrl, filename: req.file.filename });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Single-step Watermark Removal — accepts file directly, no localhost URL issues
app.post('/api/watermark/remove-file', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const fileType = req.body.type || 'image';
        const bytezKey = process.env.BYTEZ_API_KEY || (db.data.apiKeys && db.data.apiKeys.bytezApiKey);
        const openrouterKey = process.env.OPENROUTER_API_KEY || (db.data.apiKeys && db.data.apiKeys.openrouterApiKey);

        // If we have API keys, try real watermark removal
        if (bytezKey || openrouterKey) {
            try {
                // Upload to a temporary public URL first via our own server
                const baseUrl = process.env.APP_URL || ('http://localhost:' + (process.env.PORT || 3000));
                const fileUrl = baseUrl + '/uploads/' + req.file.filename;

                const { removeWatermark } = require('../services/automation');
                const result = await removeWatermark(fileUrl, fileType, {
                    provider: bytezKey ? 'bytez' : 'openrouter'
                });

                if (result.success && result.url) {
                    return res.json({ success: true, resultUrl: result.url });
                }
                if (result.success && result.jobId) {
                    // Poll for result (max 30 seconds)
                    let attempts = 0;
                    const poll = async () => {
                        attempts++;
                        if (attempts > 10) {
                            // Return uploaded file as-is if job takes too long
                            return res.json({ success: true, resultUrl: '/uploads/' + req.file.filename, message: 'Processing in background. Job ID: ' + result.jobId });
                        }
                        const status = await result.checkStatus();
                        if (status.url) {
                            return res.json({ success: true, resultUrl: status.url });
                        }
                        setTimeout(poll, 3000);
                    };
                    return poll();
                }
            } catch (apiErr) {
                console.warn('[Watermark] API error, using demo mode:', apiErr.message);
            }
        }

        // Demo mode: return the uploaded file itself with a note
        const relPath = '/uploads/' + req.file.filename;
        res.json({
            success: true,
            resultUrl: relPath,
            message: 'Demo mode: File processed. To enable real watermark removal, add BYTEZ_API_KEY in your .env file.'
        });

    } catch (e) {
        console.error('[Watermark Remove-File Error]', e.message);
        res.status(500).json({ success: false, message: 'Server error: ' + e.message });
    }
});


// Video Downloader - uses RapidAPI if configured, else returns direct URL
app.post('/api/video-downloader/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

    try {
        // Detect platform
        let platform = 'unknown';
        if (url.includes('tiktok.com')) platform = 'tiktok';
        else if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'youtube';
        else if (url.includes('instagram.com')) platform = 'instagram';
        else if (url.includes('facebook.com') || url.includes('fb.watch')) platform = 'facebook';
        else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';

        // Check if a RapidAPI key is configured
        const rapidApiKey = process.env.RAPIDAPI_KEY || (db.data.settings && db.data.settings.rapidApiKey) || (db.data.apiKeys && db.data.apiKeys.rapidApiKey);

        if (rapidApiKey && platform !== 'unknown') {
            try {
                const apiHost = 'social-media-video-downloader.p.rapidapi.com';
                const response = await axios.get('https://' + apiHost + '/smvd/get/all', {
                    params: { url: url },
                    headers: { 'X-RapidAPI-Key': rapidApiKey, 'X-RapidAPI-Host': apiHost },
                    timeout: 15000
                });
                const data = response.data;
                if (data && data.links && data.links.length > 0) {
                    return res.json({
                        success: true,
                        title: data.title || 'Video',
                        thumbnail: data.picture || '',
                        platform,
                        formats: data.links.map(l => ({ quality: l.quality || 'HD', url: l.link, type: l.type || 'mp4' })),
                        downloadUrl: data.links[0].link
                    });
                }
            } catch (apiErr) {
                console.warn('[Video Downloader] RapidAPI failed:', apiErr.message);
            }
        }

        // Fallback
        return res.json({
            success: true,
            title: 'Video from ' + platform,
            platform,
            formats: [{ quality: 'Auto', url: url, type: 'mp4' }],
            downloadUrl: url,
            message: rapidApiKey ? 'API extraction failed, returning direct URL' : 'Add RAPIDAPI_KEY to settings for social media downloads'
        });

    } catch (e) {
        console.error('[Video Downloader Error]', e.message);
        res.status(500).json({ success: false, message: e.message || 'Failed to fetch video info' });
    }
});

async function startServer() {


    // CRITICAL: Wait for database to load before accepting requests
    // This prevents race conditions where users log in before data is fetched from Firebase
    console.log(`[DEBUG] Waiting for database readiness...`);
    const dbTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Database ready timeout')), 5000));
    try {
        await Promise.race([db.dbReady, dbTimeout]);
        console.log(`[DEBUG] Database is ready.`);
    } catch (e) {
        console.warn(`⚠️ [DEBUG] ${e.message}. Starting server with local data/fresh.`);
    }

    console.log(`[DEBUG] Attempting to start server on PORT: ${PORT}`);
    try {
        // AI Service API Endpoints
        // OpenRouter and Bytez providers for Photo/Video Generation and Watermark Removal

        // AI Provider Configuration endpoint
        app.get('/api/ai/providers', (req, res) => {
            res.json({
                success: true,
                providers: ['openrouter', 'bytez'],
                default: 'bytez'
            });
        });

        // Get available models for a provider
        app.get('/api/ai/models/:provider/:type', (req, res) => {
            const { provider, type } = req.params;
            try {
                const models = aiService.getAvailableModels(provider, type);
                res.json({
                    success: true,
                    provider,
                    type,
                    models
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate Photo
        app.post('/api/ai/generate-photo', async (req, res) => {
            const { prompt, provider, model, size, style, userId } = req.body;
            const users = getUsersObj();
            const user = users[userId];
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const settings = db.getSettings();
            const costs = settings.costs || {};
            const cost = costs.gemini || 50;

            if (db.getTokenBalance(user) < cost) {
                return res.status(403).json({ success: false, error: `Insufficient tokens. Need ${cost} TC.` });
            }

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt is required'
                });
            }

            try {
                const result = await generatePhoto(prompt, {
                    provider,
                    model,
                    size,
                    style
                });

                if (result.success) {
                    if (userId) {
                        console.log(`[AI Photo] User ${userId} generated image with ${result.provider}`);

                        // Deduct tokens
                        db.setTokenBalance(user, db.getTokenBalance(user) - cost);
                        if (!user.history) user.history = [];
                        user.history.unshift({
                            type: 'ai_photo',
                            amount: -cost,
                            date: new Date().toISOString(),
                            reward: `-${cost} Tokens`,
                            detail: `Generated AI Photo: ${prompt.substring(0, 30)}...`
                        });
                        saveUsersObj(users);
                    }

                    res.json({
                        success: true,
                        provider: result.provider,
                        data: {
                            url: result.url,
                            urls: result.urls,
                            jobId: result.jobId,
                            status: result.status
                        }
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error || 'Generation failed'
                    });
                }
            } catch (error) {
                console.error('Photo generation error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Generate Video
        app.post('/api/ai/generate-video', async (req, res) => {
            const { prompt, provider, model, duration, fps, userId } = req.body;
            const users = getUsersObj();
            const user = users[userId];
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const settings = db.getSettings();
            const costs = settings.costs || {};
            const cost = (costs.gemini || 50) * 2; // Video costs more

            if (db.getTokenBalance(user) < cost) {
                return res.status(403).json({ success: false, error: `Insufficient tokens. Need ${cost} TC.` });
            }

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt is required'
                });
            }

            try {
                const result = await generateVideo(prompt, {
                    provider,
                    model,
                    duration,
                    fps
                });

                if (result.success) {
                    if (userId) {
                        console.log(`[AI Video] User ${userId} generated video with ${result.provider}`);

                        // Deduct tokens
                        db.setTokenBalance(user, db.getTokenBalance(user) - cost);
                        if (!user.history) user.history = [];
                        user.history.unshift({
                            type: 'ai_video',
                            amount: -cost,
                            date: new Date().toISOString(),
                            reward: `-${cost} Tokens`,
                            detail: `Generated AI Video: ${prompt.substring(0, 30)}...`
                        });
                        saveUsersObj(users);
                    }

                    res.json({
                        success: true,
                        provider: result.provider,
                        data: {
                            url: result.url,
                            thumbnail: result.thumbnail,
                            jobId: result.jobId,
                            status: result.status
                        }
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error || 'Generation failed'
                    });
                }
            } catch (error) {
                console.error('Video generation error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Remove Watermark from Image or Video
        app.post('/api/ai/remove-watermark', async (req, res) => {
            const { fileUrl, type, provider, model, userId } = req.body;

            if (!fileUrl) {
                return res.status(400).json({
                    success: false,
                    error: 'File URL is required'
                });
            }

            try {
                const result = await removeWatermark(fileUrl, type || 'image', {
                    provider,
                    model
                });

                if (result.success) {
                    if (userId) {
                        console.log(`[AI Watermark] User ${userId} removed watermark with ${result.provider}`);
                    }

                    res.json({
                        success: true,
                        provider: result.provider,
                        type: result.type,
                        data: {
                            url: result.url,
                            jobId: result.jobId,
                            status: result.status
                        }
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        error: result.error || 'Watermark removal failed'
                    });
                }
            } catch (error) {
                console.error('Watermark removal error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Check job status (for async operations)
        app.get('/api/ai/job-status/:jobId', async (req, res) => {
            const { jobId } = req.params;
            const { provider } = req.query;

            try {
                const result = await aiService.checkJobStatus(jobId, provider || 'bytez');
                res.json({
                    success: true,
                    jobId,
                    status: result.status,
                    progress: result.progress,
                    url: result.url
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        // Get job result
        app.get('/api/ai/job-result/:jobId', async (req, res) => {
            const { jobId } = req.params;
            const { provider } = req.query;

            try {
                const result = await aiService.getJobResult(jobId, provider || 'bytez');
                res.json({
                    success: true,
                    jobId,
                    url: result.url,
                    urls: result.urls,
                    metadata: result.metadata
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        console.log('[AI Services] OpenRouter and Bytez API endpoints registered');

        console.log(`[DEBUG] Finalizing server setup, binding to port ${PORT}...`);

        // Initialize "Free World" data for first-time use
        if (Object.keys(db.data.users || {}).length === 0) {
            console.log('🌍 [FREE WORLD] Initializing sample data...');

            // Sample Admin Data
            db.data.users["12345678"] = {
                id: 12345678,
                username: "SampleUser",
                first_name: "Sample",
                tokens: 5000,
                gems: 100,
                isPremium: true,
                registrationDate: new Date().toLocaleString(),
                lastActive: Date.now()
            };

            // Sample Transactions
            if (db.data.transactions) {
                db.data.transactions.push({
                    id: 'tx_init',
                    userId: 12345678,
                    amount: 500,
                    type: 'deposit',
                    status: 'completed',
                    timestamp: new Date().toLocaleString()
                });
            }

            // Sample Logs
            db.logError('info', 'System initialization successful. Free world data applied.');
            db.logError('warn', 'Database size initial check: Minimum size met.');
            db.logError('error', 'API Connection Timeout (Mock): Reflected in logs for testing.', { endpoint: '/api/test' });

            db.solveLog(db.data.serverLogs[0]?.id); // Mark initialization log as solved

            db.save();
        }

        const server = app.listen(PORT, '0.0.0.0', async () => {
            console.log('🚀 Unified Bot & Web Server running on http://localhost:' + PORT);
            console.log('📍 User Panel: http://localhost:' + PORT + '/');
            console.log('📍 Admin Panel: http://localhost:' + PORT + '/admin');
        });

        server.on('error', (e) => {
            if (e.code === 'EADDRINUSE') {
                console.log(`⚠️ Port ${PORT} is already in use. Server skipped.`);
            } else {
                console.error('❌ Server Internal Error:', e);
            }
        });
    } catch (e) {
        console.error('❌ FAILING to start server:', e);
    }
}

// If run directly
if (false) {
    startServer();
}

// --- AI SYSTEM MONITOR ----------------------------------------------------
async function monitorSystemWithAI() {
    const ai = getOpenAI();
    if (!ai || !bot) return;

    try {
        const users = Object.values(db.data.users || {});
        const stats = {
            totalUsers: users.length,
            activeToday: users.filter(u => Date.now() - (u.lastActive || 0) < 86400000).length,
            failedVerifications: users.reduce((acc, u) => acc + (u.failedVerifications || 0), 0),
            successfulVerifications: users.reduce((acc, u) => acc + (u.successfulVerifications || 0), 0),
            highBalances: users.filter(u => (u.tokens || 0) > 2000).map(u => ({ id: u.id, username: u.username, tokens: u.tokens })),
            systemLoad: {
                freeMem: Math.round(os.freemem() / 1024 / 1024) + 'MB',
                totalMem: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
                cpuCount: os.cpus().length,
                uptimeMinutes: Math.round(os.uptime() / 60)
            }
        };

        const completion = await ai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a professional security and system Auditor for a Telegram Bot ecosystem. Review the incoming stats JSON and look for patterns of fraud (suspiciously high balances), high failure rates in verifications, or low server memory. Return a concise bullet-point summary of any issues. If everything is optimal, return 'SYSTEM_HEALTHY'." },
                { role: "user", content: JSON.stringify(stats) }
            ]
        });

        const report = completion.choices[0].message.content;

        if (report && report.trim() !== 'SYSTEM_HEALTHY' && report.trim() !== '"SYSTEM_HEALTHY"') {
            bot.sendMessage(config.ADMIN_ID,
                `🛡️ **AI SECURITY AUDITOR REPORT**\n\n` +
                `${report}\n\n` +
                `🔍 *Stats based on ${users.length} total users.*`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });
        }
    } catch (e) {
        console.error('AI Auditor Error:', e.message);
    }
}

// Check every 4 hours
setInterval(monitorSystemWithAI, 1000 * 60 * 60 * 4);

// --- EXPIRED ITEMS CLEANUP ------------------------------------------------
// Items that are not sold within 7 days will be removed and seller loses them
async function cleanupExpiredItems() {
    const itemSales = db.getItemSales ? db.getItemSales() : (db.data.itemSales || {});
    if (!itemSales || Object.keys(itemSales).length === 0) return;

    const now = Date.now();
    const sales = Object.values(itemSales);
    let expiredCount = 0;

    for (const sale of sales) {
        // Check if item is approved but not sold, and has expired
        if (sale.status === 'approved' && sale.expiresAt && sale.expiresAt < now) {
            const itemName = sale.accountName || sale.customName || sale.itemType || 'Item';

            // Notify seller that item expired
            if (bot) {
                const expiredMsg = `⏰ <b>Item Expired</b>\n\nYour item <b>${itemName}</b> was not sold within 7 days and has been removed from the marketplace.\n\n❌ The item has been permanently deleted.\n\nTip: You can submit a new item for sale anytime!`;
                bot.sendMessage(sale.userId, expiredMsg, { parse_mode: 'HTML' }).catch(e => console.error('Expired item notify error:', e.message));
            }

            // Delete the expired item
            if (db.deleteItemSale) {
                db.deleteItemSale(sale.id);
            } else {
                delete db.data.itemSales[sale.id];
            }
            expiredCount++;

            console.log(`[CLEANUP] Expired item removed: ${sale.id} - ${itemName}`);
        }
    }

    if (expiredCount > 0) {
        db.save();
        console.log(`[CLEANUP] Removed ${expiredCount} expired items`);
    }
}

// Run cleanup every 6 hours
setInterval(cleanupExpiredItems, 1000 * 60 * 60 * 6);
// Also run on startup
cleanupExpiredItems();

// --- HISTORY AUTO-DELETE (OLDER THAN 2 DAYS) ---
function cleanupOldHistory() {
    const users = db.data.users || {};
    const now = Date.now();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    let modified = false;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    // 1. Cleanup User history and apiUsageHistory
    for (const userId in users) {
        const user = users[userId];
        if (!user) continue;

        // Cleanup main history
        if (user.history && Array.isArray(user.history)) {
            const originalLength = user.history.length;
            user.history = user.history.filter(entry => {
                let entryTimestamp = entry.date || entry.timestamp || 0;
                if (typeof entryTimestamp === 'string') entryTimestamp = new Date(entryTimestamp).getTime();
                return entryTimestamp > 0 ? (now - entryTimestamp) <= TWO_DAYS : true;
            });
            if (user.history.length !== originalLength) modified = true;
        }

        // Cleanup apiUsageHistory
        if (user.apiUsageHistory && Array.isArray(user.apiUsageHistory)) {
            const originalLength = user.apiUsageHistory.length;
            user.apiUsageHistory = user.apiUsageHistory.filter(entry => {
                let timestamp = entry.timestamp || entry.date || 0;
                if (typeof timestamp === 'string') timestamp = new Date(timestamp).getTime();
                return timestamp > 0 ? (now - timestamp) <= TWO_DAYS : true;
            });
            if (user.apiUsageHistory.length !== originalLength) modified = true;
        }
    }

    // 2. Cleanup Mail Sessions older than 24h
    if (db.data.mailSessions) {
        const initialCount = Object.keys(db.data.mailSessions).length;
        for (const [sid, session] of Object.entries(db.data.mailSessions)) {
            const createdAt = session.createdAt || 0;
            if (now - createdAt > ONE_DAY) {
                delete db.data.mailSessions[sid];
            }
        }
        if (Object.keys(db.data.mailSessions).length !== initialCount) modified = true;
    }

    // 3. Cleanup Email Pool History older than 24h (As requested by user)
    if (db.data.emailPoolHistory && Array.isArray(db.data.emailPoolHistory)) {
        const originalPoolHistLen = db.data.emailPoolHistory.length;
        db.data.emailPoolHistory = db.data.emailPoolHistory.filter(h => {
            const assignedAt = h.assignedAt || h.date || h.timestamp || 0;
            let ts = (typeof assignedAt === 'string') ? new Date(assignedAt).getTime() : assignedAt;
            return ts > 0 ? (now - ts) <= ONE_DAY : true;
        });
        if (db.data.emailPoolHistory.length !== originalPoolHistLen) modified = true;
    }

    // 4. Recycle Email Pool assignments older than 24h
    if (db.data.emailPool) {
        for (const type in db.data.emailPool) {
            if (Array.isArray(db.data.emailPool[type])) {
                db.data.emailPool[type].forEach(item => {
                    const assignedAt = item.assignedAt;
                    if (assignedAt) {
                        let ts = (typeof assignedAt === 'string') ? new Date(assignedAt).getTime() : assignedAt;
                        if (ts > 0 && (now - ts > ONE_DAY)) {
                            item.assignedTo = null;
                            item.assignedAt = null;
                            modified = true;
                        }
                    }
                });
            }
        }
    }

    if (modified) {
        db.save();
        console.log(`[CLEANUP] Deleted histories older than requested period.`);
    }
}

// Check every hour (As requested for the pool logic)
setInterval(cleanupOldHistory, 1000 * 60 * 60);
// Also run on startup
cleanupOldHistory();

// API: Video Downloader - Download Video
app.post('/api/video-downloader/download', async (req, res) => {
    try {
        const { url, quality, type, userId } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL is required'
            });
        }

        // Detect platform from URL
        let platform = 'unknown';
        if (url.includes('tiktok.com')) platform = 'tiktok';
        else if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'youtube';
        else if (url.includes('facebook.com') || url.includes('fb.watch')) platform = 'facebook';
        else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';
        else if (url.includes('instagram.com')) platform = 'instagram';
        else if (url.includes('snapchat.com')) platform = 'snapchat';
        else if (url.includes('pinterest.com')) platform = 'pinterest';

        // Use video downloader modules directly
        let downloadResult = null;

        try {
            if (platform === 'tiktok') {
                downloadResult = await tiktokDownloader.downloadTikTok(url);
            } else if (platform === 'facebook') {
                downloadResult = await facebookDownloader.downloadFacebook(url);
            } else {
                // For other platforms, return video info with direct URL
                downloadResult = {
                    success: true,
                    downloadUrl: url,
                    title: 'Video from ' + platform,
                    platform: platform
                };
            }

            if (downloadResult && downloadResult.success) {
                res.json({
                    success: true,
                    message: 'Download ready',
                    downloadUrl: downloadResult.downloadUrl || downloadResult.url || url,
                    thumbnail: downloadResult.thumbnail || '',
                    title: downloadResult.title || 'Video from ' + platform,
                    quality: quality,
                    type: type,
                    platform: platform,
                    filename: downloadResult.filename || `video_${Date.now()}.mp4`
                });
            } else {
                // Fallback: return the URL for direct download
                res.json({
                    success: true,
                    message: 'Video info retrieved. Click to download.',
                    downloadUrl: url,
                    quality: quality,
                    type: type,
                    platform: platform,
                    filename: `video_${Date.now()}.mp4`
                });
            }
        } catch (serviceError) {
            console.error('Video download error:', serviceError.message);
            // Fallback: return the URL for direct download
            res.json({
                success: true,
                message: 'Video ready for download',
                downloadUrl: url,
                quality: quality,
                type: type,
                platform: platform,
                filename: `video_${Date.now()}.mp4`
            });
        }

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            message: 'Download failed: ' + error.message
        });
    }
});

// =============================================
// REMOVE.BG API INTEGRATION
// =============================================

// Helper: Get remove.bg API keys with usage tracking
function getRemoveBgApiKeys() {
    if (!db.data.removeBgApiKeys) db.data.removeBgApiKeys = [];
    return db.data.removeBgApiKeys;
}

// Helper: Check and update API key status based on monthly usage
function updateApiKeyStatus() {
    const keys = getRemoveBgApiKeys();
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    keys.forEach(key => {
        // Check if we need to reset (new month)
        const lastReset = key.lastReset ? new Date(key.lastReset) : null;
        if (!lastReset || lastReset.getMonth() !== currentMonth || lastReset.getFullYear() !== currentYear) {
            // Reset for new month
            key.usageCount = 0;
            key.active = true;
            key.lastReset = now.toISOString();
        }

        // Check if limit reached
        if (key.usageCount >= 50) {
            key.active = false;
        }
    });

    db.data.removeBgApiKeys = keys;
    db.save();
    return keys;
}

// Helper: Get next active API key
function getNextActiveApiKey() {
    updateApiKeyStatus();
    const keys = getRemoveBgApiKeys();
    return keys.find(k => k.active && k.usageCount < 50);
}

// API: Get remove.bg API keys (Admin)
app.get('/api/admin/removebg-keys', (req, res) => {
    const keys = updateApiKeyStatus();
    res.json({
        success: true,
        keys: keys.map(k => ({
            id: k.id,
            name: k.name,
            apiKey: k.apiKey.substring(0, 10) + '...', // Mask for security
            active: k.active,
            usageCount: k.usageCount,
            limit: 50,
            lastReset: k.lastReset
        }))
    });
});

// API: Add remove.bg API key (Admin)
app.post('/api/admin/removebg-keys', (req, res) => {
    const { name, apiKey } = req.body;

    if (!name || !apiKey) {
        return res.json({ success: false, message: 'Name and API key are required' });
    }

    const keys = getRemoveBgApiKeys();
    const newKey = {
        id: 'rbg_' + Date.now(),
        name: name.trim(),
        apiKey: apiKey.trim(),
        active: true,
        usageCount: 0,
        limit: 50,
        lastReset: new Date().toISOString()
    };

    keys.push(newKey);
    db.data.removeBgApiKeys = keys;
    db.save();

    res.json({
        success: true,
        key: {
            id: newKey.id,
            name: newKey.name,
            apiKey: newKey.apiKey.substring(0, 10) + '...',
            active: newKey.active,
            usageCount: newKey.usageCount,
            limit: 50,
            lastReset: newKey.lastReset
        }
    });
});

// API: Delete remove.bg API key (Admin)
app.delete('/api/admin/removebg-keys/:id', (req, res) => {
    const { id } = req.params;
    let keys = getRemoveBgApiKeys();

    const index = keys.findIndex(k => k.id === id);
    if (index === -1) {
        return res.json({ success: false, message: 'API key not found' });
    }

    keys.splice(index, 1);
    db.data.removeBgApiKeys = keys;
    db.save();

    res.json({ success: true, message: 'API key deleted successfully' });
});

// API: Reset API key manually (Admin - for testing)
app.post('/api/admin/removebg-keys/:id/reset', (req, res) => {
    const { id } = req.params;
    const keys = getRemoveBgApiKeys();

    const key = keys.find(k => k.id === id);
    if (!key) {
        return res.json({ success: false, message: 'API key not found' });
    }

    key.usageCount = 0;
    key.active = true;
    key.lastReset = new Date().toISOString();

    db.data.removeBgApiKeys = keys;
    db.save();

    res.json({ success: true, message: 'API key reset successfully' });
});

// API: Background removal endpoint for users
app.post('/api/bg-remover/remove', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, message: 'No image uploaded' });
        }

        const imagePath = req.file.path;

        // Get next active API key
        const activeKey = getNextActiveApiKey();

        if (!activeKey) {
            // No remove.bg API key — clean up and return clear message
            if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            return res.json({
                success: false,
                message: '⚠️ Background Remover requires a Remove.bg API key. Go to Admin Panel → BG Remover → Add API Key to enable this feature.'
            });
        }

        const imageBuffer = fs.readFileSync(imagePath);

        // Call remove.bg API
        try {
            const response = await axios.post(
                'https://api.remove.bg/v1.0/removebg',
                {
                    image_file_b64: imageBuffer.toString('base64'),
                    size: 'auto'
                },
                {
                    headers: {
                        'X-Api-Key': activeKey.apiKey,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );

            // Save result image
            const resultFilename = 'bg_removed_' + Date.now() + '.png';
            const resultPath = path.join(__dirname, '..', 'web', 'uploads', resultFilename);
            fs.writeFileSync(resultPath, response.data);

            // Update usage count
            activeKey.usageCount++;
            if (activeKey.usageCount >= 50) {
                activeKey.active = false;
            }
            db.save();

            // Clean up uploaded file
            fs.unlinkSync(imagePath);

            res.json({
                success: true,
                resultUrl: '/uploads/' + resultFilename,
                apiKeyUsed: activeKey.name,
                remainingCredits: 50 - activeKey.usageCount
            });

        } catch (apiError) {
            // If this key fails, mark it inactive and try next
            console.error(`[remove.bg] API key ${activeKey.name} failed:`, apiError.message);

            activeKey.active = false;
            db.save();

            // Clean up uploaded file
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }

            // Try to get next key
            const nextKey = getNextActiveApiKey();
            if (nextKey) {
                // Return error but suggest retry
                return res.json({
                    success: false,
                    message: 'Primary API key failed, switching to backup. Please retry.',
                    retry: true
                });
            } else {
                return res.json({
                    success: false,
                    message: 'All API keys are currently unavailable. Please try again later.'
                });
            }
        }

    } catch (error) {
        console.error('[remove.bg] Error:', error);
        res.json({ success: false, message: 'Background removal failed: ' + error.message });
    }
});

// API: Check remove.bg API status (for admin dashboard)
app.get('/api/admin/removebg-status', (req, res) => {
    const keys = updateApiKeyStatus();
    const totalKeys = keys.length;
    const activeKeys = keys.filter(k => k.active).length;
    const totalUsage = keys.reduce((sum, k) => sum + k.usageCount, 0);
    const totalLimit = totalKeys * 50;

    res.json({
        success: true,
        status: {
            totalKeys,
            activeKeys,
            totalUsage,
            totalLimit,
            remainingCredits: totalLimit - totalUsage
        }
    });
});

// ==========================================
// EMAIL POOL ROUTES
// ==========================================

app.get('/api/admin/email-pool/list', (req, res) => {
    const { type } = req.query;
    if (!db.data.emailPool) db.data.emailPool = { gmail: [], hotmail: [] };

    if (type) {
        const emails = db.data.emailPool[type] || [];
        const available = emails.filter(e => !e.assignedTo).length;
        const totalUsed = emails.filter(e => e.assignedTo).length;
        res.json({ success: true, emails: emails.filter(e => !e.assignedTo), stats: { available, totalUsed, recentHistory: emails.filter(e => e.assignedTo).slice(-50) } });
    } else {
        const stats = {};
        ['gmail', 'hotmail'].forEach(t => {
            const list = db.data.emailPool[t] || [];
            stats[t] = {
                available: list.filter(e => !e.assignedTo).length,
                totalUsed: list.filter(e => e.assignedTo).length
            };
        });
        res.json({ success: true, stats });
    }
});

app.post('/api/admin/email-pool/add', (req, res) => {
    const { type, email, password, note } = req.body;
    if (!db.data.emailPool) db.data.emailPool = { gmail: [], hotmail: [] };
    if (!db.data.emailPool[type]) db.data.emailPool[type] = [];

    // Duplicate check
    if (db.data.emailPool[type].some(e => e.email === email)) {
        return res.json({ success: false, message: 'Email already exists in pool' });
    }

    db.data.emailPool[type].push({
        email,
        password,
        note,
        addedAt: new Date().toISOString(),
        assignedTo: null,
        assignedAt: null
    });
    db.save();
    res.json({ success: true, message: 'Email added to pool' });
});

app.delete('/api/admin/email-pool/delete', (req, res) => {
    const { type, email } = req.body;
    if (db.data.emailPool && db.data.emailPool[type]) {
        db.data.emailPool[type] = db.data.emailPool[type].filter(e => e.email !== email);
        db.save();
    }
    res.json({ success: true, message: 'Email deleted from pool' });
});

app.post('/api/admin/email-pool/clear-assigned', (req, res) => {
    const { type } = req.body;
    if (db.data.emailPool && db.data.emailPool[type]) {
        const count = db.data.emailPool[type].filter(e => e.assignedTo).length;
        db.data.emailPool[type] = db.data.emailPool[type].filter(e => !e.assignedTo);
        db.save();
        res.json({ success: true, message: `Cleared ${count} assigned emails` });
    } else {
        res.json({ success: false, message: 'Pool not found' });
    }
});

// ==========================================
// MANUAL NUMBERS ROUTES
// ==========================================

app.get('/api/admin/manual-numbers/list', (req, res) => {
    res.json({ success: true, numbers: db.data.manualNumbers || [] });
});

app.post('/api/admin/manual-numbers/add', (req, res) => {
    const { platform, values, otpApi } = req.body;
    if (!db.data.manualNumbers) db.data.manualNumbers = [];

    const lines = values.split('\n').filter(l => l.trim());
    lines.forEach(num => {
        db.data.manualNumbers.push({
            id: 'MN' + Date.now() + Math.random().toString(36).substr(2, 5),
            platform,
            number: num.trim(),
            otp: null,
            otpApi: otpApi || null,
            status: 'available',
            addedAt: new Date().toISOString()
        });
    });
    db.save();
    res.json({ success: true, message: `Added ${lines.length} numbers` });
});

app.delete('/api/admin/manual-numbers/:id', (req, res) => {
    const { id } = req.params;
    if (db.data.manualNumbers) {
        db.data.manualNumbers = db.data.manualNumbers.filter(n => n.id !== id);
        db.save();
    }
    res.json({ success: true });
});

app.post('/api/admin/manual-numbers/otp', (req, res) => {
    const { id, otp } = req.body;
    const num = db.data.manualNumbers?.find(n => n.id === id);
    if (num) {
        num.otp = otp;
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Number not found' });
    }
});

app.delete('/api/admin/manual-numbers/group/:platform', (req, res) => {
    const { platform } = req.params;
    if (db.data.manualNumbers) {
        db.data.manualNumbers = db.data.manualNumbers.filter(n => n.platform !== platform);
        db.save();
    }
    res.json({ success: true });
});

// Global Error Handler for Express
app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err.message);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'A network or server error occurred'
    });
});

module.exports = { app, startServer, setBot, monitorSystemWithAI };
