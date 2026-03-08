const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const oauth = require('../oauth');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '10mb' }));

const db = require('../db');
const config = require('../config');
const os = require('os');
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

let bot = null;
let backupBot = null;
let totalCallbacks = 0;

function getBackupBot() {
    if (!backupBot && config.BACKUP_BOT_TOKEN) {
        try {
            const TelegramBot = require('node-telegram-bot-api');
            backupBot = new TelegramBot(config.BACKUP_BOT_TOKEN, { polling: false });
        } catch (e) {
            console.error('❌ Failed to initialize Backup Bot:', e.message);
        }
    }
    return backupBot;
}

function setBot(instance) {
    bot = instance;

    // The Public URL is the public-facing Mini App URL
    const publicUrl = config.PUBLIC_URL || 'https://mamunislam.netlify.app';

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
}

// Helper: Validate userId
function isValidUserId(userId) {
    if (!userId) return false;
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    return !isNaN(numericId) && numericId > 0;
}

// Request counter middleware
app.use((req, res, next) => {
    totalCallbacks++;
    next();
});

// CORS middleware - allows Netlify frontend to call API directly
app.use((req, res, next) => {
    const allowedOrigins = ['https://mamunislam.netlify.app', 'http://localhost:3000'];
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
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// ROUTES
// 1. User Panel (Default)
app.get('/', (req, res) => {
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

    // NEW: Cloud Backup (Google Drive)
    try {
        const driveStorage = require('./google-drive-storage');
        if (driveStorage.connected) {
            await driveStorage.saveData(fileName, db.data);
            console.log(`☁️ Backup ${fileName} uploaded to Google Drive`);
        }
    } catch (e) {
        console.error('Drive Cloud backup error:', e.message);
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
app.get('/api/admin/codes', (req, res) => {
    // codes stored in db.data.codes (primary)
    const codes = db.data.codes || {};
    const codeList = Object.keys(codes).map(key => ({
        code: key,
        ...codes[key],
        amount: codes[key].amount,
        maxUses: codes[key].maxUses || codes[key].uses
    }));
    res.json({ success: true, codes: codeList });
});

// API: Create Code
app.post('/api/admin/codes', (req, res) => {
    const { code, amount, maxUses } = req.body;
    if (!code) return res.json({ success: false, message: 'Code required' });
    db.createCode(code, parseInt(amount) || 0, parseInt(maxUses) || 0);
    res.json({ success: true });
});

// API: Delete Code
app.delete('/api/admin/codes/:code', (req, res) => {
    const { code } = req.params;
    const success = db.deleteCode(code);
    res.json({ success });
});

// API: Update User Data (Admin)
app.post('/api/admin/users/:userId', (req, res) => {
    const { userId } = req.params;
    const { balance, referralCount, verified, Gems } = req.body;
    const user = db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    if (balance !== undefined) {
        // sync all balance fields
        db.setTokenBalance(user, parseInt(balance));
    }
    if (Gems !== undefined) {
        user.Gems = parseInt(Gems);
        user.balance_Gems = parseInt(Gems);
    }
    if (referralCount !== undefined) user.referralCount = parseInt(referralCount);
    if (verified !== undefined) user.verified = (verified === true || verified === 'true');
    if (req.body.adminVerified !== undefined) user.adminVerified = (req.body.adminVerified === true || req.body.adminVerified === 'true');

    db.updateUser(user);
    res.json({ success: true });
});

// API: Get User Data (For Mini App)
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = db.getUser(userId);

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    res.json({
        success: true,
        userId: userId,
        username: user.username || user.firstName || 'User',
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        photo_url: user.photo_url || '',
        tokens: db.getTokenBalance(user),
        balance_tokens: db.getTokenBalance(user),
        Gems: user.balance_Gems !== undefined ? user.balance_Gems : (user.Gems || 0),
        invites: user.referralCount || user.invites || 0,
        lastClaim: user.lastDaily || 0,
        dailyStreak: user.dailyStreak || 0,
        completedTasks: user.completedTasks || [],
        verified: user.successfulVerifications > 0 || user.verified || false,
        banned: user.banned || user.blocked || false
    });
});

// API: Register / Sync user from Telegram WebApp
app.post('/api/register', (req, res) => {
    const { userId, firstName, lastName, username, photo_url, referrer } = req.body;
    if (!userId) return res.json({ success: false, message: 'userId required' });

    const user = db.getUser(userId); // creates if not exists
    if (!user) return res.json({ success: false, message: 'Failed to create user' });

    // Update Telegram profile data
    if (firstName) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (username) user.username = username;
    if (photo_url) user.photo_url = photo_url;
    user.lastActive = Date.now();

    // Sync all balance fields on every login
    const currentBalance = db.getTokenBalance(user);
    db.setTokenBalance(user, currentBalance); // ensures all 3 fields are in sync

    // Handle referral on first registration - referrer is raw userId (no prefix)
    if (referrer && !user.referredBy) {
        const cleanReferrer = String(referrer).replace(/^ref_/, ''); // strip ref_ prefix if present
        if (cleanReferrer && cleanReferrer !== String(userId)) {
            db.handleReferral(userId, cleanReferrer);
        }
    }

    // Migration/Fix: Ensure history exists and has welcome bonus if empty
    if (!user.history || user.history.length === 0) {
        const welcome = (typeof db.getWelcomeCredits === 'function') ? db.getWelcomeCredits() : 100;
        user.history = [{
            type: 'bonus',
            amount: welcome,
            reward: `+${welcome} Tokens`,
            date: Date.now(),
            detail: 'Welcome Bonus'
        }];
    }

    db.updateUser(user);

    // Always return the synced balance
    const tokens = db.getTokenBalance(user);

    res.json({
        success: true,
        userId,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        username: user.username || '',
        photo_url: user.photo_url || '',
        tokens,
        balance_tokens: tokens,
        Gems: user.balance_Gems || user.Gems || 0,
        invites: user.referralCount || 0,
        lastClaim: user.lastDaily || 0,
        dailyStreak: user.dailyStreak || 0,
        completedTasks: user.completedTasks || [],
        verified: user.successfulVerifications > 0 || user.verified || false,
        banned: user.banned || user.blocked || false
    });
});

// API: Get User History
app.get('/api/history/:userId', (req, res) => {
    const userId = req.params.userId;
    let user = db.getUser(userId);

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
        if (!config.OPENAI_API_KEY) {
            // No key configured; use fallback question
            return res.json({
                success: true,
                question: 'What is the capital of France?',
                options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
                correctIndex: 2
            });
        }
        const completion = await openai.chat.completions.create({
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
app.post('/api/quiz/submit', (req, res) => {
    const { userId, correct } = req.body;
    const user = db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    // 10 for correct, 5 for wrong as per user request
    const amount = correct ? 10 : 5;
    const isCorrect = correct; // Store this for history detail

    db.setTokenBalance(user, db.getTokenBalance(user) + amount);

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

    db.updateUser(user);
    res.json({ success: true, newBalance: db.getTokenBalance(user) });
});

// API: Claim Ad Reward
app.post('/api/ad/claim', (req, res) => {
    const { userId, context } = req.body;
    const user = db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    let amount = 0;
    let detail = 'Ad Reward';

    if (context === 'watch_ad') {
        amount = 5;
        detail = 'Watched Ad';
    } else if (context === 'quiz_direct' || context === 'scratch_ad' || context === 'scratch_retry') {
        // Just unlocking, no tokens yet
        return res.json({ success: true });
    } else {
        amount = 2; // Default
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
        db.updateUser(user);
    }

    res.json({ success: true, newBalance: db.getTokenBalance(user), reward: amount });
});

// API: Quiz Leaderboard
app.get('/api/quiz/leaderboard', (req, res) => {
    const users = Object.values(db.data.users || {});
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
app.post('/api/scratch/claim', (req, res) => {
    const { userId, reward } = req.body;
    const user = db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    db.setTokenBalance(user, db.getTokenBalance(user) + parseInt(reward));

    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'scratch_reward',
        amount: parseInt(reward),
        currency: 'tokens',
        date: Date.now()
    });

    db.updateUser(user);
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

    const user = db.getUser(userId);
    if (!user) {
        console.log(`[DEBUG] User not found: ${userId}`);
        return res.json({ success: false, message: 'User not found' });
    }

    console.log(`[DEBUG] User found: ${userId}, completedTasks: ${JSON.stringify(user.completedTasks)}`);

    // --- Special: watch_ad (repeatable daily) ---
    if (taskType === 'watch_ad') {
        const settings = db.data.settings || {};
        const zeroBalanceReward = parseInt(settings.zeroBalanceAdReward);
        const adReward = (req.body.context === 'zero_balance_trigger')
            ? (Number.isFinite(zeroBalanceReward) ? zeroBalanceReward : 5)
            : (parseInt(settings.adReward) || 5);
        const now = Date.now();
        const lastWatched = user.lastAdWatch || 0;
        const cooldownMs = 5 * 60 * 1000; // 5 minutes cooldown per ad

        // Bypass cooldown for zero balance trigger
        if (req.body.context !== 'zero_balance_trigger' && (now - lastWatched < cooldownMs)) {
            const waitMin = Math.ceil((cooldownMs - (now - lastWatched)) / 60000);
            return res.json({ success: false, message: `Please wait ${waitMin} more minute(s) before watching another ad.` });
        }

        user.lastAdWatch = now;
        db.setTokenBalance(user, db.getTokenBalance(user) + adReward);
        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'ad_reward',
            amount: adReward,
            currency: 'tokens',
            date: now,
            detail: req.body.context === 'quiz_direct' ? 'Quiz Ad' : (req.body.context === 'zero_balance_trigger' ? 'Zero Balance Ad' : (req.body.context === 'scratch_ad' ? 'Scratch Ad' : 'Watch Ad'))
        });
        db.updateUser(user);
        return res.json({ success: true, reward: adReward, newBalance: db.getTokenBalance(user) });
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
    db.setTokenBalance(user, db.getTokenBalance(user) + rewardAmount);

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'mission_reward',
        amount: rewardAmount,
        currency: 'tokens',
        taskId: taskType,
        date: Date.now()
    });

    db.updateUser(user);

    console.log(`[DEBUG] Task completed successfully: ${taskType}, newBalance: ${db.getTokenBalance(user)}`);
    return res.json({ success: true, reward: rewardAmount, newBalance: db.getTokenBalance(user) });

});

// API: Buy Account by Category
app.post('/api/accounts/buy-category', (req, res) => {
    const { userId, category, price } = req.body;

    if (!userId || !category || !price) {
        return res.json({ success: false, message: 'Missing parameters' });
    }

    const user = db.getUser(userId);
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    const userTokens = db.getTokenBalance(user);
    if (userTokens < parseInt(price)) {
        return res.json({ success: false, message: 'Insufficient tokens' });
    }

    // Deduct tokens safely
    const priceInt = parseInt(price);
    db.setTokenBalance(user, userTokens - priceInt);

    // Generate account credentials (admin can add real ones later)
    const accountData = {
        email: `premium_${category}_${Date.now()}@email.com`,
        password: `Pass_${Math.random().toString(36).slice(2, 10)}`,
        category: category,
        purchasedAt: Date.now()
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

    db.updateUser(user);

    return res.json({
        success: true,
        newBalance: db.getTokenBalance(user),
        account: {
            email: accountData.email,
            password: accountData.password
        }
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

    const userTokens = db.getTokenBalance(user);
    if (userTokens < cost) {
        return res.json({ success: false, message: `Insufficient tokens. Need ${cost} TC.` });
    }

    // Deduct tokens
    db.setTokenBalance(user, db.getTokenBalance(user) - cost);

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
app.post('/api/redeem', (req, res) => {
    const { userId, code } = req.body;

    if (!userId || !code) {
        return res.json({ success: false, message: 'Missing parameters' });
    }

    const result = db.redeemCode(userId, code);

    if (result && result.success) {
        res.json({
            success: true,
            message: 'Code redeemed successfully',
            reward: result.amount,
            newTokens: result.newBalance,
            newBalance: result.newBalance
        });
    } else {
        res.json({
            success: false,
            message: result ? result.msg : 'Invalid code'
        });
    }
});

// Redundant daily-claim endpoint removed (use /api/daily)

// API: Complete Task / Earn
app.post(['/api/complete-task', '/api/earn'], (req, res) => {
    const { userId, taskId, reward, taskType, amount } = req.body;

    // Support both frontend variable names
    const finalTaskId = taskId || taskType;
    const finalReward = reward || amount;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Prevent duplicate task completion (simple implementation)
    if (!user.completedTasks) user.completedTasks = [];

    const oneTimeTasks = ['join_channel', 'follow_twitter', 'subscribe_youtube', 'yt', 'tg', 'tg_ch'];
    if (oneTimeTasks.includes(finalTaskId) && user.completedTasks.includes(finalTaskId)) {
        return res.json({ success: false, message: 'Task already completed' });
    }

    // Add reward
    db.setTokenBalance(user, db.getTokenBalance(user) + (parseInt(finalReward) || 0));

    if (oneTimeTasks.includes(finalTaskId)) {
        user.completedTasks.push(finalTaskId);
    }

    // History
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'tasks',
        date: new Date().toISOString(),
        reward: `+${finalReward} Tokens`,
        detail: finalTaskId
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: 'Task Completed!',
        reward: finalReward,
        newBalance: db.getTokenBalance(user)
    });
});

// Helper: get users object
function getUsersObj() { return db.data.users || {}; }
function saveUsersObj(users) { db.data.users = users; db.save(); }

// API: Get Virtual Number Platforms (Sorted by Popularity)
app.get('/api/number/platforms', (req, res) => {
    const stats = db.data.virtualNumberStats || {};
    const providers = db.data.providers || {};

    // Get all platforms from SMS providers
    const platformSet = new Set();
    const platformCountryCodes = {};

    Object.values(providers).forEach(provider => {
        if (provider.type === 'sms' && provider.status === 'active' && provider.platforms) {
            Object.keys(provider.platforms).forEach(platform => {
                platformSet.add(platform);
                // Store country codes for this platform
                if (!platformCountryCodes[platform]) {
                    platformCountryCodes[platform] = provider.platforms[platform];
                }
            });
        }
    });

    // Default platforms if none configured
    const defaultPlatforms = ['telegram', 'whatsapp', 'instagram', 'twitter', 'tiktok', 'other'];
    if (platformSet.size === 0) {
        defaultPlatforms.forEach(p => platformSet.add(p));
    }

    // Platform metadata for display
    const platformMeta = {
        telegram: { name: 'Telegram', icon: 'fab fa-telegram', color: '#229ed9' },
        whatsapp: { name: 'WhatsApp', icon: 'fab fa-whatsapp', color: '#22c55e' },
        instagram: { name: 'Instagram', icon: 'fab fa-instagram', color: '#e1306c' },
        twitter: { name: 'Twitter', icon: 'fab fa-twitter', color: '#1da1f2' },
        tiktok: { name: 'TikTok', icon: 'fab fa-tiktok', color: '#fff' },
        facebook: { name: 'Facebook', icon: 'fab fa-facebook', color: '#1877f2' },
        other: { name: 'Other', icon: 'fas fa-ellipsis-h', color: 'var(--text-sub)' }
    };

    // Build platforms array with usage stats
    const platforms = Array.from(platformSet).map(id => ({
        id,
        name: platformMeta[id]?.name || id.charAt(0).toUpperCase() + id.slice(1),
        icon: platformMeta[id]?.icon || 'fas fa-mobile-alt',
        color: platformMeta[id]?.color || '#f59e0b',
        usage: stats[id] || 0,
        countryCodes: platformCountryCodes[id] || ['1'] // Default to US
    }));

    // Sort by usage (popularity) - descending
    platforms.sort((a, b) => b.usage - a.usage);

    res.json({
        success: true,
        platforms
    });
});

// API: Generate Virtual Number
app.post('/api/number/generate', async (req, res) => {
    const { userId, platform, cost } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });
    const tokenCost = cost || 15;
    const userTokens = db.getTokenBalance(user);
    if (userTokens < tokenCost) return res.json({ success: false, message: 'Insufficient tokens' });

    // Track platform usage for popularity ranking
    if (!db.data.virtualNumberStats) db.data.virtualNumberStats = {};
    db.data.virtualNumberStats[platform] = (db.data.virtualNumberStats[platform] || 0) + 1;
    db.save();

    // Get country code for this platform from provider settings
    let countryCode = '1'; // Default to US
    const providers = db.data.providers || {};
    const smsProviders = Object.values(providers).filter(p => p.type === 'sms' && p.status === 'active');

    // Find the first provider that has country codes configured for this platform
    for (const provider of smsProviders) {
        if (provider.platforms && provider.platforms[platform] && provider.platforms[platform].length > 0) {
            countryCode = provider.platforms[platform][0]; // Use first country code
            break;
        }
    }

    // Try real SMS provider via bot's apiGateway
    let number = null;
    let sessionId = 'num_' + Date.now() + '_' + userId;

    try {
        const apiGateway = require('../services/api-gateway');
        const result = await apiGateway.executeWithFailover('sms', async (provider) => {
            const axios = require('axios');
            const r = await axios.post(`${provider.apiUrl}/numbers`, {
                platform,
                countryCode
            }, {
                headers: { 'X-API-KEY': provider.apiKey }, timeout: 8000
            });
            return r.data;
        });
        if (result && result.number) number = result.number;
    } catch (e) {
        console.error('[NUMBER] API error:', e.message);
    }

    // No demo! Return error if no provider available
    if (!number) {
        return res.json({ success: false, message: 'No numbers available for this platform right now. Please try again later.' });
    }

    db.setTokenBalance(user, db.getTokenBalance(user) - tokenCost);
    if (!user.history) user.history = [];
    user.history.unshift({ type: 'number', date: new Date().toISOString(), reward: `-${tokenCost} Tokens`, detail: number });
    saveUsersObj(users);

    // Store session
    if (!db.data.numberSessions) db.data.numberSessions = {};
    db.data.numberSessions[sessionId] = { number, userId, platform, createdAt: Date.now(), otp: null };
    db.save();

    res.json({ success: true, number, sessionId, newBalance: db.getTokenBalance(user) });
});

// API: Check OTP for Number
app.get('/api/number/otp', (req, res) => {
    const { sessionId } = req.query;
    const sessions = db.data.numberSessions || {};
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, otp: null });
    res.json({ success: true, otp: session.otp || null });
});

// API: Generate Temp Email
app.post('/api/mail/generate', async (req, res) => {
    const { userId, cost } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });
    const tokenCost = cost || 10;
    const mailTokens = db.getTokenBalance(user);
    if (mailTokens < tokenCost) return res.json({ success: false, message: 'Insufficient tokens' });

    let emailData = null;
    const sessionId = 'mail_' + Date.now() + '_' + userId;
    try {
        const tempMail = require('../services/tempmail-providers');
        emailData = await tempMail.createAccount();
    } catch (e) { console.error('TempMail createAccount error:', e.message); }

    // If all providers failed, return error (no demo for live system)
    if (!emailData || !emailData.email) {
        console.error('❌ All tempmail providers failed');
        return res.json({ success: false, message: 'All email providers temporarily unavailable. Please try again later.' });
    }

    db.setTokenBalance(user, db.getTokenBalance(user) - tokenCost);
    if (!user.history) user.history = [];
    user.history.unshift({ type: 'mail', date: new Date().toISOString(), reward: `-${tokenCost} Tokens`, detail: emailData.email });
    saveUsersObj(users);

    // Store session
    if (!db.data.mailSessions) db.data.mailSessions = {};
    db.data.mailSessions[sessionId] = { ...emailData, userId, createdAt: Date.now() };
    db.save();

    res.json({ success: true, email: emailData.email, sessionId, newBalance: db.getTokenBalance(user) });
});

// API: Check Mail Inbox
app.get('/api/mail/inbox', async (req, res) => {
    const { sessionId } = req.query;
    const userId = req.query.userId;
    const cost = parseInt(req.query.cost) || 0;
    const sessions = db.data.mailSessions || {};
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, messages: [] });

    // Optional billing per refresh (used by temp mail)
    if (cost > 0 && userId) {
        try {
            const users = getUsersObj();
            const user = users[userId];
            if (!user) return res.json({ success: false, message: 'User not found', messages: [] });

            const bal = db.getTokenBalance(user);
            if (bal < cost) {
                return res.json({ success: false, message: 'Insufficient tokens', newBalance: bal, messages: [] });
            }

            db.setTokenBalance(user, bal - cost);
            if (!user.history) user.history = [];
            user.history.unshift({ type: 'mail_inbox_refresh', amount: cost, currency: 'tokens', date: Date.now() });
            saveUsersObj(users);
        } catch (e) {
            // If billing fails, do not block inbox view
        }
    }

    try {
        const tempMail = require('../services/tempmail-providers');
        const messages = await tempMail.getMessages(session.token || sessionId, session.email);
        const formatted = (messages || []).map(m => ({
            id: m.id,
            from: m.from || m.sender || 'Unknown',
            subject: m.subject || '(No Subject)',
            preview: m.text ? m.text.substring(0, 100) : '',
            body: m.text || '',
            time: m.date ? new Date(m.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            otp: m.text ? (m.text.match(/\b\d{4,8}\b/) || [])[0] : null
        }));
        let newBalance;
        if (cost > 0 && userId) {
            try {
                const users = getUsersObj();
                const user = users[userId];
                if (user) {
                    newBalance = db.getTokenBalance(user);
                }
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
    const users = getUsersObj();
    const list = Object.entries(users).map(([id, u]) => ({
        id, username: u.username || 'Unknown', firstName: u.firstName || u.first_name || '',
        tokens: u.tokens || u.balance_tokens || 0,
        invites: u.invites || u.referralCount || 0,
        verified: u.verified || false,
        adminVerified: u.adminVerified || false,
        banned: u.banned || u.blocked || false,
        joinDate: u.joinDate || u.joinedAt || null, lastActive: u.lastActive || null
    }));
    res.json({ success: true, users: list, total: list.length });
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
    const { banned } = req.body;
    const users = getUsersObj();
    if (!users[userId]) return res.json({ success: false });
    users[userId].banned = banned;
    users[userId].blocked = banned;
    saveUsersObj(users);
    res.json({ success: true });
});

// API: Admin - Delete User
app.delete('/api/admin/users/:userId', (req, res) => {
    const { userId } = req.params;
    const users = getUsersObj();
    delete users[userId];
    saveUsersObj(users);
    res.json({ success: true });
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

// API: Exchange - Convert Assets (One-way USD restriction)
app.post('/api/exchange/convert', (req, res) => {
    const { userId, from, to, amount } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return res.json({ success: false, message: 'Please enter a valid amount' });

    // Restriction: Tokens and Gems cannot be converted back to USD
    if (to === 'usd' && from !== 'usd') {
        return res.json({ success: false, message: 'Convert to USD is not allowed. USD can only be converted to Tokens or Gems.' });
    }

    if (from === to) {
        return res.json({ success: false, message: 'Please select different currencies' });
    }

    // Restriction: Cannot convert Tokens/Gems back to USD
    if (to === 'usd' && from !== 'usd') {
        return res.json({ success: false, message: 'Converting back to USD is not allowed.' });
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
    if (to === 'usd') targetAmount = Math.round(targetAmount * 100) / 100;
    else if (to === 'Gems') targetAmount = Math.floor(targetAmount * 10000) / 10000;
    else targetAmount = Math.floor(targetAmount);

    // Update balances
    if (from === 'tokens') db.setTokenBalance(user, db.getTokenBalance(user) - amt);
    else user[fromField] = Math.max(0, balance - amt);

    if (to === 'tokens') db.setTokenBalance(user, db.getTokenBalance(user) + targetAmount);
    else user[toField] = Math.max(0, (user[toField] || 0) + targetAmount);

    // History record
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'exchange',
        from, to,
        fromAmount: amt,
        toAmount: targetAmount,
        date: Date.now()
    });

    saveUsersObj(users);
    res.json({
        success: true,
        tokens: db.getTokenBalance(user),
        Gems: user.Gems || 0,
        usd: user.usd || 0,
        toAmount: targetAmount
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

    // Identify field names based on asset type
    let field = asset; // usd, Gems, tokens
    if (asset === 'tokens') {
        field = fromUser.tokens !== undefined ? 'tokens' : 'balance_tokens';
    }

    const balance = fromUser[field] || 0;
    if (balance < amount) return res.json({ success: false, message: 'Insufficient balance' });

    // Perform transfer
    if (asset === 'tokens') {
        db.setTokenBalance(fromUser, db.getTokenBalance(fromUser) - (asset === 'usd' ? parseFloat(amount.toFixed(2)) : parseInt(amount)));
    } else {
        fromUser[field] = Math.max(0, balance - (asset === 'usd' ? parseFloat(amount.toFixed(2)) : parseInt(amount)));
    }

    // Recipient might use a different field name for tokens
    let toField = asset;
    if (asset === 'tokens') {
        toField = toUser.tokens !== undefined ? 'tokens' : 'balance_tokens';
    }
    if (asset === 'tokens') {
        db.setTokenBalance(toUser, db.getTokenBalance(toUser) + (asset === 'usd' ? parseFloat(amount.toFixed(2)) : parseInt(amount)));
    } else {
        toUser[toField] = (toUser[toField] || 0) + (asset === 'usd' ? parseFloat(amount.toFixed(2)) : parseInt(amount));
    }

    // History Records
    if (!fromUser.history) fromUser.history = [];
    fromUser.history.unshift({
        type: 'transfer_out',
        amount, asset,
        to: toUserId,
        date: Date.now()
    });

    if (!toUser.history) toUser.history = [];
    toUser.history.unshift({
        type: 'transfer_in',
        amount, asset,
        from: fromUserId,
        date: Date.now()
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: `Successfully transferred ${amount} ${asset} to User #${toUserId}`,
        newBalances: {
            tokens: db.getTokenBalance(fromUser),
            Gems: fromUser.Gems || 0,
            usd: fromUser.usd || 0
        }
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
        status: 'pending'
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
    const pending = (db.data.pendingDeposits || []).filter(d => d.status === 'pending');
    const history = (db.data.pendingDeposits || []).filter(d => d.status !== 'pending').slice(0, 50);
    res.json({ success: true, pending, history });
});

// API: Admin - Deposit Action (Approve/Reject)
app.post('/api/admin/deposits/action', (req, res) => {
    const { depositId, action, note } = req.body;
    const deposits = db.data.pendingDeposits || [];
    const depositIndex = deposits.findIndex(d => d.id === depositId);

    if (depositIndex === -1) return res.json({ success: false, message: 'Deposit not found' });

    const deposit = deposits[depositIndex];
    if (deposit.status !== 'pending') return res.json({ success: false, message: 'Deposit already processed' });

    if (action === 'approve') {
        const users = getUsersObj();
        const user = users[deposit.userId];
        if (user) {
            // Credit user with USD balance (since deposits are in USD usually)
            user.usd = (user.usd || 0) + deposit.amount;

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
            deposit.status = 'approved';
        } else {
            return res.json({ success: false, message: 'User not found' });
        }
    } else {
        deposit.status = 'rejected';
        deposit.adminNote = note;
    }

    db.save();
    res.json({ success: true });
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
        const deposit = deposits.find(d => d.txnId === tid && d.status === 'pending');
        if (deposit) {
            const user = users[deposit.userId];
            if (user) {
                user.usd = (user.usd || 0) + deposit.amount;
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
                deposit.status = 'approved';
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

// API: Admin - Dashboard Stats
app.get('/api/admin/stats', (req, res) => {
    const usersList = db.getUsers();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    let active = 0;
    let revenue = 0;
    let totalTokens = 0;
    let verifiedUsers = 0;

    usersList.forEach(u => {
        if (u.lastActive && (now - u.lastActive < day)) active++;
        revenue += (u.balance || 0);
        totalTokens += db.getTokenBalance(u);
        if (u.successfulVerifications > 0 || u.verified) verifiedUsers++;
    });

    const shopItems = Object.keys(db.data.shopItems || {}).length;
    const accounts = db.data.premiumAccounts ? db.data.premiumAccounts.length : 0;

    // Sum all VPNs
    let totalVpns = 0;
    if (db.data.vpnAccounts) {
        Object.values(db.data.vpnAccounts).forEach(arr => totalVpns += (arr ? arr.length : 0));
    }

    // Sum all Cards
    let totalCards = 0;
    if (db.data.cards) {
        Object.values(db.data.cards).forEach(arr => totalCards += (arr ? arr.length : 0));
    }

    // Count generated Gmails (from user transaction history or a general metric)
    let gmailsUsed = 0;
    usersList.forEach(u => {
        if (u.history) {
            u.history.forEach(h => {
                if (h.type === 'email' || h.type === 'gmail' || h.type === 'mail') gmailsUsed++;
            });
        }
    });

    res.json({
        success: true,
        totalUsers: usersList.length,
        totalTokens,
        verifiedUsers,
        activeToday: active,
        shopItems,
        accounts,
        totalVpns,
        totalCards,
        gmailsUsed,
        stats: {
            totalUsers: usersList.length,
            activeUsers: active,
            offlineUsers: usersList.length - active,
            revenue: revenue,
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
app.get('/api/admin/system-info', (req, res) => {
    const usersList = db.getUsers();
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
    Object.keys(db.data.cardPrices || {}).forEach(key => {
        cards.push({
            id: key,
            name: key.toUpperCase(),
            price: db.data.cardPrices[key],
            count: db.data.cards?.[key]?.length || 0
        });
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
app.get('/api/admin/groups/settings', (req, res) => {
    const settings = db.getGroupSettings();
    res.json({ success: true, settings });
});

// API: Admin - Group Settings (POST)
app.post('/api/admin/groups/settings', (req, res) => {
    const newSettings = req.body;
    if (!db.data.settings) db.data.settings = {};
    db.data.settings.groupRules = { ...db.data.settings.groupRules, ...newSettings };
    db.save();
    res.json({ success: true, settings: db.data.settings.groupRules });
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
    const tasks = Object.entries(db.data.tasks || {}).map(([id, t]) => ({ id, ...t }));
    res.json({ success: true, tasks });
});

app.post('/api/admin/tasks', (req, res) => {
    const { name, url, reward } = req.body;
    const id = db.createTask(name, url, reward);
    res.json({ success: true, id });
});

app.delete('/api/admin/tasks/:id', (req, res) => {
    const id = req.params.id;
    const success = db.deleteTask(id);
    res.json({ success });
});

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
            transferFee: settings.transferFee || 0,
            supportCost: settings.supportCost || 0,

            // Service Costs (Tokens)
            gmailCost: costs.gmail || 0,
            verificationCost: costs.verification || 0,
            numberCost: costs.number || 0,
            geminiCost: costs.gemini || 50,
            chatgptCost: costs.gpt || 100,
            spotifyCost: costs.spotify || 50,
            youtubeCost: costs.youtube || 50,
            teacherCost: costs.teacher || 100,
            militaryCost: costs.military || 100,

            // USD Costs
            accountsUSD: costs.accountsUSD || 1.00,
            vpnUSD: costs.vpnUSD || 2.00,
            vccUSD: costs.vccUSD || 5.00,
            premiumMailUSD: costs.premiumMailUSD || 0.50,

            // Credit Exchange Rates
            cryptoRate: creditRates.crypto || 0.01,
            bkashRate: creditRates.bkash || 1,
            nagadRate: creditRates.nagad || 1,

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

    // Exchange Rates (USD/Tokens/Gems)
    if (payload.usdToToken !== undefined) db.data.settings.usdToToken = parseInt(payload.usdToToken) || 100;
    if (payload.gemToToken !== undefined) db.data.settings.gemToToken = parseInt(payload.gemToToken) || 100;
    if (payload.tokenToGem !== undefined) db.data.settings.tokenToGem = parseFloat(payload.tokenToGem) || 1;
    if (payload.takaToGem !== undefined) db.data.settings.takaToGem = parseInt(payload.takaToGem) || 100;
    if (payload.platformFee !== undefined) db.data.settings.platformFee = parseInt(payload.platformFee) || 20;

    // Service Costs (Nested in costs)
    if (!db.data.settings.costs) db.data.settings.costs = {};
    if (payload.gmailCost !== undefined) db.data.settings.costs.gmail = parseInt(payload.gmailCost);
    if (payload.verificationCost !== undefined) db.data.settings.costs.verification = parseInt(payload.verificationCost);
    if (payload.numberCost !== undefined) db.data.settings.costs.number = parseInt(payload.numberCost);
    if (payload.geminiCost !== undefined) db.data.settings.costs.gemini = parseInt(payload.geminiCost);
    if (payload.chatgptCost !== undefined) db.data.settings.costs.gpt = parseInt(payload.chatgptCost);
    if (payload.spotifyCost !== undefined) db.data.settings.costs.spotify = parseInt(payload.spotifyCost);
    if (payload.youtubeCost !== undefined) db.data.settings.costs.youtube = parseInt(payload.youtubeCost);
    if (payload.teacherCost !== undefined) db.data.settings.costs.teacher = parseInt(payload.teacherCost);
    if (payload.militaryCost !== undefined) db.data.settings.costs.military = parseInt(payload.militaryCost);

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

    db.save();
    res.json({ success: true, message: 'All cost configurations saved successfully' });
});

// API: Admin - Reset Transactions (alias)
app.post('/api/admin/reset-transactions', (req, res) => {
    db.data.transactions = [];
    db.save();
    res.json({ success: true, message: 'Transactions cleared' });
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

        // Also clear marketplace/user-generated content
        db.data.itemSales = {};

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

// Admin: Delete any item sale (approved/pending/etc.)
app.delete('/api/admin/item-sales/:id', (req, res) => {
    try {
        const id = (req.params.id || '').trim();
        if (!id) return res.json({ success: false, message: 'Missing id' });

        if (!db.data.itemSales || !db.data.itemSales[id]) {
            return res.json({ success: false, message: 'Item not found' });
        }

        delete db.data.itemSales[id];
        db.save();

        return res.json({ success: true, message: 'Item deleted' });
    } catch (e) {
        console.error('Delete error:', e);
        res.json({ success: false, message: e.message });
    }
});

// Health check endpoint for Railway and monitoring
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        firebase: db.data ? 'connected' : 'disconnected'
    });
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: 'online',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        users: Object.keys(db.data.users || {}).length
    });
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
            deleteChatBackgroundSet: settings.deleteChatBackgroundSet === true
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

    db.save();
    res.json({ success: true, settings: gm });
});

// =============================================
// PREMIUM EMAIL MANAGEMENT API
// =============================================

// GET: List all premium emails
app.get('/api/admin/premium-emails', (req, res) => {
    const emails = db.data.premiumEmails || [];
    res.json({
        success: true,
        emails: emails.map(e => ({
            id: e.id,
            email: e.email,
            password: e.password,
            imap: e.imap || '',
            active: e.active !== false,
            messageCount: (e.messages || []).length,
            addedAt: e.addedAt
        }))
    });
});

// POST: Add or update a premium email
app.post('/api/admin/premium-emails', (req, res) => {
    const { id, email, password, imap, active } = req.body;

    if (!email || !password) {
        return res.json({ success: false, message: 'Email and password required' });
    }

    if (!db.data.premiumEmails) db.data.premiumEmails = [];

    if (id) {
        // Update existing
        const idx = db.data.premiumEmails.findIndex(e => e.id === id);
        if (idx !== -1) {
            db.data.premiumEmails[idx].email = email;
            db.data.premiumEmails[idx].password = password;
            db.data.premiumEmails[idx].imap = imap || db.data.premiumEmails[idx].imap;
            db.data.premiumEmails[idx].active = active !== false;
            db.save();
            return res.json({ success: true, id });
        }
    }

    // Add new
    const newEmail = {
        id: 'pe_' + Date.now(),
        email,
        password,
        imap: imap || '',
        active: active !== false,
        messages: [],
        addedAt: Date.now()
    };
    db.data.premiumEmails.push(newEmail);
    db.save();
    res.json({ success: true, id: newEmail.id });
});

// POST: Bulk import premium emails
app.post('/api/admin/premium-emails/import', (req, res) => {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
        return res.json({ success: false, message: 'No emails to import' });
    }

    if (!db.data.premiumEmails) db.data.premiumEmails = [];

    let imported = 0;
    for (const item of emails) {
        if (item.email && item.password) {
            db.data.premiumEmails.push({
                id: 'pe_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                email: item.email,
                password: item.password,
                imap: item.imap || '',
                active: true,
                messages: [],
                addedAt: Date.now()
            });
            imported++;
        }
    }

    db.save();
    res.json({ success: true, imported });
});

// POST: Toggle email active status
app.post('/api/admin/premium-emails/:id/toggle', (req, res) => {
    const { id } = req.params;
    const { active } = req.body;

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails found' });
    }

    const idx = db.data.premiumEmails.findIndex(e => e.id === id);
    if (idx === -1) {
        return res.json({ success: false, message: 'Email not found' });
    }

    db.data.premiumEmails[idx].active = active === true;
    db.save();
    res.json({ success: true });
});

// DELETE: Remove a premium email
app.delete('/api/admin/premium-emails/:id', (req, res) => {
    const { id } = req.params;

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails found' });
    }

    const before = db.data.premiumEmails.length;
    db.data.premiumEmails = db.data.premiumEmails.filter(e => e.id !== id);
    db.save();

    res.json({ success: db.data.premiumEmails.length < before });
});

// GET: Get messages for a specific email
app.get('/api/admin/premium-emails/:id/messages', (req, res) => {
    const { id } = req.params;

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails found' });
    }

    const email = db.data.premiumEmails.find(e => e.id === id);
    if (!email) {
        return res.json({ success: false, message: 'Email not found' });
    }

    res.json({
        success: true,
        messages: email.messages || [],
        email: email.email
    });
});

// =============================================
// USER PREMIUM EMAIL API
// =============================================

// API: User - Get available premium emails (only active ones, without passwords)
app.get('/api/premium-emails', (req, res) => {
    const emails = (db.data.premiumEmails || []).filter(e => e.active !== false);
    res.json({
        success: true,
        emails: emails.map(e => ({
            id: e.id,
            email: e.email,
            messageCount: (e.messages || []).length,
            addedAt: e.addedAt
        }))
    });
});

// API: User - Get a single premium email by ID
app.get('/api/premium-emails/:id', (req, res) => {
    const { id } = req.params;

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails found' });
    }

    const email = db.data.premiumEmails.find(e => e.id === id && e.active !== false);
    if (!email) {
        return res.json({ success: false, message: 'Email not found or inactive' });
    }

    res.json({
        success: true,
        email: {
            id: email.id,
            email: email.email,
            messageCount: (email.messages || []).length,
            addedAt: email.addedAt
        }
    });
});

// API: User - Get messages for a specific premium email
app.get('/api/premium-emails/:id/messages', (req, res) => {
    const { id } = req.params;

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails found' });
    }

    const email = db.data.premiumEmails.find(e => e.id === id && e.active !== false);
    if (!email) {
        return res.json({ success: false, message: 'Email not found or inactive' });
    }

    res.json({
        success: true,
        email: email.email,
        messages: email.messages || []
    });
});

// API: User - Assign a premium email to user (mark as assigned)
app.post('/api/premium-emails/assign', (req, res) => {
    const { userId, emailId } = req.body;

    if (!userId || !emailId) {
        return res.json({ success: false, message: 'User ID and Email ID required' });
    }

    const user = db.getUser(userId);
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    if (!db.data.premiumEmails) {
        return res.json({ success: false, message: 'No premium emails available' });
    }

    const email = db.data.premiumEmails.find(e => e.id === emailId && e.active !== false);
    if (!email) {
        return res.json({ success: false, message: 'Email not found or inactive' });
    }

    // Check if already assigned to someone else
    if (email.assignedTo && email.assignedTo !== userId) {
        return res.json({ success: false, message: 'Email already assigned to another user' });
    }

    // Assign email to user
    email.assignedTo = userId;
    email.assignedAt = Date.now();
    db.save();

    res.json({
        success: true,
        email: {
            id: email.id,
            email: email.email,
            password: email.password // Only returned when assigned
        }
    });
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

// API: Admin - Advanced Broadcast
app.post('/api/admin/broadcast', async (req, res) => {
    const { message, mediaType, mediaUrl, buttons, target } = req.body;

    if (!message && !mediaUrl) return res.json({ success: false, message: 'Message or Media required' });

    // Prepare Targets
    let targetIds = [];

    if (target === 'users' || target === 'all') {
        const users = db.getUsers();
        if (users.length > 0) targetIds.push(...users.map(u => u.id));
    }

    if (target === 'groups' || target === 'all') {
        const groups = db.getGroups();
        if (groups.length > 0) targetIds.push(...groups.map(g => g.id));
    }

    // Unique IDs only
    targetIds = [...new Set(targetIds)];

    if (targetIds.length === 0) return res.json({ success: false, message: 'No targets found' });

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
                const publicUrl = config.PUBLIC_URL || 'https://mamunislam.netlify.app';
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

    try {
        const TelegramBot = require('node-telegram-bot-api');
        const config = require('../config');

        // Use Global Bot if available (set via setBot), otherwise create stateless instance
        const activeBot = bot || new TelegramBot(config.TELEGRAM_BOT_TOKEN);

        for (const chatId of targetIds) {
            try {
                if (mediaType === 'photo' && actualMedia) {
                    await activeBot.sendPhoto(chatId, actualMedia, { caption: message, reply_markup });
                } else if (mediaType === 'video' && actualMedia) {
                    await activeBot.sendVideo(chatId, actualMedia, { caption: message, reply_markup });
                } else {
                    await activeBot.sendMessage(chatId, message || 'Broadcast', { reply_markup });
                }
                successCount++;
            } catch (e) {
                failCount++;
                console.error(`[BROADCAST] Failed to send to ${chatId}: ${e.message}`);
                // Optional: Log more details for first few failures
                if (failCount < 5) console.error(e);
            }
            // Tiny delay to be polite to API
            await new Promise(r => setTimeout(r, 50));
        }

        res.json({ success: true, sent: successCount, failed: failCount, total: targetIds.length });

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
        console.error('Broadcast Error:', e);
        res.json({ success: false, message: 'Broadcast System Error' });
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
app.post('/api/accounts/buy', (req, res) => {
    const { userId, accountId } = req.body;
    const user = db.getUser(userId);
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
        account: {
            email: account.email,
            password: account.password,
            instructions: account.instructions
        },
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
app.get('/api/admin/daily-stats', (req, res) => {
    const users = db.getUsers();
    const totalClaims = users.filter(u => u.lastDaily > 0).length;
    const totalStreak = users.reduce((acc, u) => acc + (u.dailyStreak || 0), 0);
    res.json({ success: true, totalClaims, avgStreak: users.length ? (totalStreak / users.length).toFixed(1) : 0 });
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

});

// API: Admin - Update API Keys
app.post('/api/admin/apikeys', (req, res) => {
    const { smtpLabsKey, gmailClientId, gmailClientSecret, miniAppUrl, backupBotToken } = req.body;

    if (!db.data.apiKeys) db.data.apiKeys = {};

    if (smtpLabsKey !== undefined) db.data.apiKeys.smtpLabsKey = smtpLabsKey;
    if (gmailClientId !== undefined) db.data.apiKeys.gmailClientId = gmailClientId;
    if (gmailClientSecret !== undefined) db.data.apiKeys.gmailClientSecret = gmailClientSecret;
    if (miniAppUrl !== undefined) db.data.apiKeys.miniAppUrl = miniAppUrl;
    if (backupBotToken !== undefined) db.data.apiKeys.backupBotToken = backupBotToken;

    db.save();
    res.json({ success: true, message: 'API Keys updated successfully' });
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

        // Home service cards
        home_verify: true,
        home_mail: true,
        home_number: true,
        home_gemini: true,
        home_chatgpt: true
    };
}

function getFeatureFlags() {
    if (!db.data.featureFlags) db.data.featureFlags = {};
    const defaults = getDefaultFeatureFlags();
    // Merge defaults (keeps newly added keys enabled by default)
    db.data.featureFlags = { ...defaults, ...db.data.featureFlags };
    return db.data.featureFlags;
}

// Public endpoint: mini app fetches enabled/disabled features
app.get('/api/features', (req, res) => {
    const flags = getFeatureFlags();
    res.json({ success: true, features: flags });
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
    const { network, publisherId, adUnitId, enabled } = req.body;
    if (!network) return res.json({ success: false, message: 'Network required' });
    if (!db.data.adSettings) db.data.adSettings = {};
    db.data.adSettings[network] = {
        publisherId: publisherId || '',
        adUnitId: adUnitId || '',
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

// API: Admin - Services
app.get('/api/admin/services', (req, res) => {
    const services = db.data.services || {};
    res.json({ success: true, services: Object.values(services) });
});

app.post('/api/admin/services', (req, res) => {
    const item = req.body;
    db.data.services = db.data.services || {};
    db.data.services[item.id] = item;
    db.save();
    res.json({ success: true });
});

app.delete('/api/admin/services/:id', (req, res) => {
    const { id } = req.params;
    if (db.data.services && db.data.services[id]) {
        delete db.data.services[id];
        db.save();
        res.json({ success: true });
    } else {
        res.json({ success: false, message: 'Not found' });
    }
});

// API: Admin - Shop Items
app.get('/api/admin/shop', (req, res) => {
    const items = db.data.shopItems || {};
    res.json({ success: true, shopItems: Object.values(items) });
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

// Google OAuth Login Start
app.get('/auth/google', (req, res) => {
    const { state } = req.query; // state = userId OR 'admin'
    if (!state) {
        return res.send('Error: Missing state parameter (userId or admin)');
    }
    // Redirect to Google Consent Screen
    // Use getDriveAuthUrl for admin (storage) and getAuthUrl for users (Gmail)
    const authUrl = (state === 'admin') ? oauth.getDriveAuthUrl(state) : oauth.getAuthUrl(state);
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

// =============================================
// MISSING API ENDPOINTS (Added to fix 404 errors)
// =============================================

// API: Check Required Joins (Telegram Channel/Group verification)
app.post('/api/check-required-joins', async (req, res) => {
    const { userId } = req.body;

    // 1. Check if user is Admin Verified (Highest Tier - bypasses all join checks)
    const user = db.getUser(userId);
    if (user && user.adminVerified) {
        return res.json({
            success: true,
            allJoined: true,
            canProceed: true,
            channelJoined: true,
            groupJoined: true,
            message: 'Admin Verified - Join Check Bypassed'
        });
    }

    // Channel and Group IDs
    const requiredChannel = config.REQUIRED_CHANNEL;
    const requiredGroup = config.REQUIRED_GROUP;

    try {
        let channelJoined = false;
        let groupJoined = false;

        if (bot) {
            try {
                const channelMember = await bot.getChatMember(requiredChannel, userId);
                const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
                channelJoined = validStatuses.includes(channelMember.status);
            } catch (e) {
                console.log('[JOIN CHECK] Channel check failed:', e.message);
            }

            try {
                const groupMember = await bot.getChatMember(requiredGroup, userId);
                const validStatuses = ['creator', 'administrator', 'member', 'restricted'];
                groupJoined = validStatuses.includes(groupMember.status);
            } catch (e) {
                console.log('[JOIN CHECK] Group check failed:', e.message);
            }
        }

        // If bot not available, allow access (fail-open for better UX)
        if (!bot) {
            return res.json({
                success: true,
                allJoined: true,
                canProceed: true,
                channelJoined: true,
                groupJoined: true,
                message: 'Bot not available - allowing access'
            });
        }

        res.json({
            success: true,
            allJoined: channelJoined && groupJoined,
            canProceed: channelJoined && groupJoined,
            channelJoined: channelJoined,
            groupJoined: groupJoined,
            channelLink: `https://t.me/${(config.REQUIRED_CHANNEL_NAME || '').replace('@', '')}`,
            groupLink: `https://t.me/${(config.REQUIRED_GROUP_NAME || '').replace('@', '')}`
        });
    } catch (error) {
        console.error('[JOIN CHECK] Error:', error);
        // Fail-open: allow access on error
        res.json({
            success: true,
            allJoined: true,
            canProceed: true,
            channelJoined: true,
            groupJoined: true,
            message: 'Error occurred - allowing access'
        });
    }
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
                        const m = h.reward.match(/-?(\d+)/);
                        if (m) amount = parseInt(m[1]);
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

// API: Get Google Drive Status (For Admin)
app.get('/api/admin/storage/status', async (req, res) => {
    const driveStorage = require('./google-drive-storage');
    const info = await driveStorage.getStorageInfo();
    res.json({
        success: true,
        connected: driveStorage.connected,
        info: info
    });
});

// API: Disconnect Google Drive
app.post('/api/admin/storage/disconnect', async (req, res) => {
    const driveStorage = require('./google-drive-storage');
    const result = await driveStorage.disconnect();
    res.json(result);
});

// API: Claim Daily Reward (Tiered Streak System)
app.post('/api/daily/claim', (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.json({ success: false, message: 'User ID required' });
    const result = db.claimDaily(userId);
    res.json(result);
});

// API: Leaderboard (Top Referrers)
app.get('/api/leaderboard', (req, res) => {
    const { userId } = req.query; // Optional: to get personal rank
    const top = db.getTopReferrers(10).map(u => ({
        id: u.id,
        name: u.firstName || u.username || `User ${String(u.id).slice(-4)}`,
        refs: u.referralCount || 0,
        photo_url: u.photo_url || '',
        tokens: db.getTokenBalance(u)
    }));

    let userRank = null;
    let userRefs = 0;
    if (userId) {
        const allUsers = Object.values(db.data.users)
            .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0));
        const idx = allUsers.findIndex(u => String(u.id) === String(userId));
        userRank = idx >= 0 ? idx + 1 : null;
        const thisUser = db.data.users[String(userId)];
        if (thisUser) userRefs = thisUser.referralCount || 0;
    }

    res.json({ success: true, top, userRank, userRefs });
});

// API: Get User Referrals (for invite page)
app.get('/api/referrals/:userId', (req, res) => {
    const { userId } = req.params;

    // Validate userId
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    if (isNaN(numericId) || numericId <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid userId' });
    }

    const user = db.getUser(userId);

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    const refBonus = (db.data.settings && db.data.settings.refBonus) || 50;
    const botUsername = (db.data.settings && db.data.settings.botUsername) || 'AutosVerify_bot';

    // Get referred users
    const referredUsers = (user.referredUsers || []).map(ref => {
        const refUser = db.getUser(ref.userId);
        return {
            name: refUser ? (refUser.firstName || refUser.username || `User ${String(ref.userId).slice(-4)}`) : `User ${String(ref.userId).slice(-4)}`,
            date: ref.date || Date.now(),
            status: ref.rewarded ? 'Active' : 'Pending',
            reward: ref.rewarded ? `+${refBonus}` : '0'
        };
    }).reverse(); // Most recent first

    // Calculate stats
    const totalInvited = referredUsers.length;
    const totalEarned = referredUsers.filter(r => r.status === 'Active').length * refBonus;

    res.json({
        success: true,
        referrals: referredUsers,
        stats: {
            invited: totalInvited,
            earned: totalEarned
        },
        referralLink: `https://t.me/${botUsername}?start=${userId}`
    });
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

    if (!db.data.itemSales) db.data.itemSales = {};

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

    db.data.itemSales[saleId] = saleData;
    db.save();

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
        .map(s => ({
            id: s.id,
            itemType: s.itemType,
            customName: s.customName || '',
            serviceName: s.serviceName || '',
            vpnName: s.vpnName || '',
            vpnPlan: s.vpnPlan || '',
            cardType: s.cardType || '',
            iconBase64: s.iconBase64 || '',
            appUrl: s.appUrl || '',
            is2fa: s.is2fa,
            twoFA: s.twoFA ? { appCode: s.twoFA.appCode ? '***' : '' } : null,
            stock: s.stock || 1,
            price: s.price || s.sellingPrice || 0,
            createdAt: s.createdAt
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ success: true, items });
});

// Admin: Get all sale submissions (pending/approved/rejected)
app.get('/api/admin/item-sales/all', (req, res) => {
    const sales = Object.values(db.data.itemSales || {});
    // Filter/Sort
    const pending = sales.filter(s => s.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
    const history = sales.filter(s => s.status !== 'pending').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);

    res.json({ success: true, pending, history });
});

// Admin: Update sale status (Approve/Reject/Offer) + set listing price
app.post('/api/admin/item-sales/update', (req, res) => {
    const { saleId, status, rewardAmount, sellingPrice, stock } = req.body;
    if (!saleId || !status) return res.json({ success: false, message: 'Missing fields' });

    if (!db.data.itemSales || !db.data.itemSales[saleId]) {
        return res.json({ success: false, message: 'Submission not found' });
    }

    const sale = db.data.itemSales[saleId];
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

    if (!db.data.itemSales || !db.data.itemSales[saleId]) {
        return res.json({ success: false, message: 'Submission not found' });
    }

    const sale = db.data.itemSales[saleId];
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
app.post('/api/user/item-sales/buy', (req, res) => {
    const { userId, saleId } = req.body;
    if (!userId || !saleId) return res.json({ success: false, message: 'Missing fields' });

    const user = db.getUser(userId);
    if (!user) return res.json({ success: false, message: 'User not found' });

    if (!db.data.itemSales || !db.data.itemSales[saleId]) {
        return res.json({ success: false, message: 'Item not found' });
    }

    const sale = db.data.itemSales[saleId];
    if (sale.status !== 'approved' || (sale.stock || 0) <= 0) {
        return res.json({ success: false, message: 'Item no longer available' });
    }

    const price = parseFloat(sale.price) || 0;

    // Deduction logic: Always USD as requested
    const balance = user.usd || 0;
    if (balance < price) return res.json({ success: false, message: `Insufficient balance. Need $${price.toFixed(2)}.` });

    user.usd = parseFloat((balance - price).toFixed(2));
    db.addTransaction(userId, 'service', price, 'USD', `Bought ${sale.itemType}: ${sale.accountName || sale.customName || sale.cardType}`, 'shopping-cart');

    // Process Purchase
    sale.stock = (sale.stock || 1) - 1;
    if (sale.stock <= 0) sale.status = 'sold';

    // PAY SELLER - Only when item is actually sold to a buyer
    if (sale.rewardOffer > 0) {
        const seller = db.getUser(sale.userId);
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
                username: user.first_name || 'User'
            });
        });
    });

    // Sort by date descending
    allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, history: allHistory.slice(0, 500) });
});

async function startServer() {
    // CRITICAL: Wait for database to load before accepting requests
    // This prevents race conditions where users log in before data is fetched from Firebase
    console.log(`[DEBUG] Waiting for database readiness...`);
    await db.dbReady;

    console.log(`[DEBUG] Attempting to start server on PORT: ${PORT}`);
    try {
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🌐 Web Panel running on http://localhost:${PORT}`);
            console.log(`   ├─ User Panel:  http://localhost:${PORT}/`);
            console.log(`   ├─ Admin Panel: http://localhost:${PORT}/admin`);
            console.log(`   └─ API Base:    http://localhost:${PORT}/api`);
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
if (require.main === module) {
    startServer();
    // Bot runs separately to avoid circular dependency
    console.log('[INFO] Server started. Bot should be started separately via node bot.js');
}

// --- AI SYSTEM MONITOR ----------------------------------------------------
async function monitorSystemWithAI() {
    if (!openai || !bot) return;

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

        const completion = await openai.chat.completions.create({
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
    if (!db.data.itemSales) return;

    const now = Date.now();
    const sales = Object.values(db.data.itemSales);
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
            delete db.data.itemSales[sale.id];
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

module.exports = { startServer, setBot, monitorSystemWithAI };

