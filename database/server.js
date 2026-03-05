const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const oauth = require('../oauth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '10mb' }));

const db = require('../db');
const config = require('../config');
const os = require('os');

let bot = null;
let totalCallbacks = 0;

function setBot(instance) {
    bot = instance;

    // The Netlify URL is the public-facing Mini App URL (no localtunnel warning page!)
    const NETLIFY_URL = 'https://mamunislam.netlify.app';

    // Automatically create a secure tunnel for API connectivity only
    setTimeout(async () => {
        try {
            const localtunnel = require('localtunnel');
            const tunnel = await localtunnel({ port: PORT, local_https: false, local_host: '127.0.0.1' });

            console.log(`\n🚀 [AUTO-TUNNEL] API Tunnel URL: ${tunnel.url}`);
            console.log(`📱 [MINI APP] Frontend URL: ${NETLIFY_URL}`);
            console.log(`\n⚠️  IMPORTANT: Update netlify.toml - replace YOUR_BACKEND_URL with: ${tunnel.url}`);

            // Store tunnel URL for API routing only (NOT for Mini App!)
            global._tunnelUrl = tunnel.url;

            // Keep PUBLIC_URL and MINI_APP_URL as the Netlify URL!
            // This prevents the localtunnel warning page from appearing in the Mini App
            config.PUBLIC_URL = NETLIFY_URL;
            config.MINI_APP_URL = NETLIFY_URL;
            process.env.PUBLIC_URL = NETLIFY_URL;

            // Set the Web App Menu Button to the NETLIFY URL (no tunnel warning!)
            await bot.setChatMenuButton({
                menu_button: {
                    type: 'web_app',
                    text: 'Launch Bot',
                    web_app: { url: NETLIFY_URL }
                }
            });
            console.log(`✅ [MINI APP] Telegram Menu Button set to: ${NETLIFY_URL}`);

            tunnel.on('close', () => {
                console.log('⚠️ [AUTO-TUNNEL] Tunnel closed. API calls will fail until tunnel restarts.');
            });
        } catch (e) {
            console.error('❌ [AUTO-TUNNEL] Failed to create tunnel:', e.message);
            // Even without tunnel, keep Netlify as the Mini App URL
            config.PUBLIC_URL = NETLIFY_URL;
            config.MINI_APP_URL = NETLIFY_URL;
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

// CORS middleware - allows Netlify frontend to call tunnel API directly
app.use((req, res, next) => {
    const allowedOrigins = ['https://mamunislam.netlify.app', 'http://localhost:3000'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Bypass-Tunnel-Reminder, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// API: Get the current tunnel URL (for dynamic API discovery)
app.get('/api/tunnel-url', (req, res) => {
    res.json({ success: true, tunnelUrl: global._tunnelUrl || null });
});

// Additional middleware to block invalid userId early
app.use((req, res, next) => {
    // Extract userId from various request sources
    let userId = req.params.userId || req.body?.userId || req.query?.userId;

    // Skip validation for non-user endpoints
    const skipPaths = ['/', '/admin', '/api/admin/login', '/api/services', '/api/ads/config', '/api/tunnel-url'];
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
        tokens: user.balance_tokens !== undefined ? user.balance_tokens : (user.tokens || 0),
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
    const user = db.getUser(userId);

    if (!user) {
        return res.json({ success: false, history: [] });
    }

    const history = user.history || [];
    res.json({ success: true, history: history });
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
        const costs = db.data.costs || {};
        const adReward = parseInt(costs.adReward) || 5;
        const now = Date.now();
        const lastWatched = user.lastAdWatch || 0;
        const cooldownMs = 5 * 60 * 1000; // 5 minutes cooldown per ad

        if (now - lastWatched < cooldownMs) {
            const waitMin = Math.ceil((cooldownMs - (now - lastWatched)) / 60000);
            return res.json({ success: false, message: `Please wait ${waitMin} more minute(s) before watching another ad.` });
        }

        user.lastAdWatch = now;
        user.tokens = (user.tokens || user.balance_tokens || 0) + adReward;
        if (user.balance_tokens !== undefined) user.balance_tokens = user.tokens;
        if (!user.history) user.history = [];
        user.history.unshift({ type: 'ad_reward', amount: adReward, currency: 'tokens', date: now });
        db.updateUser(user);
        return res.json({ success: true, reward: adReward, newBalance: user.tokens });
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
    user.tokens = (user.tokens || user.balance_tokens || 0) + rewardAmount;
    if (user.balance_tokens !== undefined) user.balance_tokens = user.tokens;

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

    console.log(`[DEBUG] Task completed successfully: ${taskType}, newBalance: ${user.tokens}`);
    return res.json({ success: true, reward: rewardAmount, newBalance: user.tokens });

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

    const userTokens = user.tokens !== undefined ? user.tokens : (user.balance_tokens || 0);
    if (userTokens < parseInt(price)) {
        return res.json({ success: false, message: 'Insufficient tokens' });
    }

    // Deduct tokens
    if (user.tokens !== undefined) user.tokens -= parseInt(price);
    if (user.balance_tokens !== undefined) user.balance_tokens -= parseInt(price);

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
        newBalance: user.tokens !== undefined ? user.tokens : user.balance_tokens,
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

    const userTokens = user.tokens !== undefined ? user.tokens : (user.balance_tokens || 0);
    if (userTokens < cost) {
        return res.json({ success: false, message: `Insufficient tokens. Need ${cost} TC.` });
    }

    // Deduct tokens
    if (user.tokens !== undefined) user.tokens -= cost;
    else user.balance_tokens = (user.balance_tokens || 0) - cost;

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
        newBalance: user.tokens !== undefined ? user.tokens : user.balance_tokens
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
    user.tokens = (user.tokens || 0) + reward;
    if (user.balance_tokens !== undefined) user.balance_tokens = user.tokens;

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'verification',
        date: new Date().toISOString(),
        reward: `+${reward} Tokens`
    });

    saveUsersObj(users);

    res.json({ success: true, message: 'Verification successful', reward: reward, newBalance: user.tokens || user.balance_tokens || 0 });
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
    if (user.tokens !== undefined) user.tokens = (user.tokens || 0) + (parseInt(finalReward) || 0);
    else user.balance_tokens = (user.balance_tokens || 0) + (parseInt(finalReward) || 0);

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
        newBalance: user.tokens !== undefined ? user.tokens : user.balance_tokens
    });
});

// Helper: get users object
function getUsersObj() { return db.data.users || {}; }
function saveUsersObj(users) { db.data.users = users; db.save(); }

// API: Generate Virtual Number
app.post('/api/number/generate', async (req, res) => {
    const { userId, platform, cost } = req.body;
    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });
    const tokenCost = cost || 15;
    const userTokens = user.tokens || user.balance_tokens || 0;
    if (userTokens < tokenCost) return res.json({ success: false, message: 'Insufficient tokens' });

    // Try real SMS provider via bot's apiGateway
    let number = null;
    let sessionId = 'num_' + Date.now() + '_' + userId;
    try {
        const apiGateway = require('../services/api-gateway');
        const result = await apiGateway.executeWithFailover('sms', async (provider) => {
            const axios = require('axios');
            const r = await axios.post(`${provider.apiUrl}/numbers`, { platform }, {
                headers: { 'X-API-KEY': provider.apiKey }, timeout: 8000
            });
            return r.data;
        });
        if (result && result.number) number = result.number;
    } catch (e) { }

    // Demo fallback: generate a realistic US phone number when no SMS provider is configured
    if (!number) {
        const areaCodes = ['201', '202', '212', '213', '310', '312', '347', '404', '415', '469', '503', '512', '614', '617', '646', '702', '713', '718', '786', '818', '917', '929'];
        const area = areaCodes[Math.floor(Math.random() * areaCodes.length)];
        const mid = String(Math.floor(Math.random() * 900) + 100);
        const last = String(Math.floor(Math.random() * 9000) + 1000);
        number = `+1 ${area} ${mid} ${last}`;
        sessionId = 'demo_' + sessionId;
    }

    if (user.tokens !== undefined) user.tokens -= tokenCost;
    else user.balance_tokens = (user.balance_tokens || 0) - tokenCost;
    if (!user.history) user.history = [];
    user.history.unshift({ type: 'number', date: new Date().toISOString(), reward: `-${tokenCost} Tokens`, detail: number });
    saveUsersObj(users);

    // Store session
    if (!db.data.numberSessions) db.data.numberSessions = {};
    db.data.numberSessions[sessionId] = { number, userId, platform, createdAt: Date.now(), otp: null };
    db.save();

    res.json({ success: true, number, sessionId, newBalance: user.tokens || user.balance_tokens || 0 });
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
    const mailTokens = user.tokens || user.balance_tokens || 0;
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

    if (user.tokens !== undefined) user.tokens -= tokenCost;
    else user.balance_tokens = (user.balance_tokens || 0) - tokenCost;
    if (!user.history) user.history = [];
    user.history.unshift({ type: 'mail', date: new Date().toISOString(), reward: `-${tokenCost} Tokens`, detail: emailData.email });
    saveUsersObj(users);

    // Store session
    if (!db.data.mailSessions) db.data.mailSessions = {};
    db.data.mailSessions[sessionId] = { ...emailData, userId, createdAt: Date.now() };
    db.save();

    res.json({ success: true, email: emailData.email, sessionId, newBalance: user.tokens || user.balance_tokens || 0 });
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

            const field = user.tokens !== undefined ? 'tokens' : 'balance_tokens';
            const bal = user[field] || 0;
            if (bal < cost) {
                return res.json({ success: false, message: 'Insufficient tokens', newBalance: bal, messages: [] });
            }

            user[field] = bal - cost;
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
            time: m.date ? new Date(m.date).toLocaleTimeString() : '',
            otp: m.text ? (m.text.match(/\b\d{4,8}\b/) || [])[0] : null
        }));
        let newBalance;
        if (cost > 0 && userId) {
            try {
                const users = getUsersObj();
                const user = users[userId];
                if (user) {
                    newBalance = user.tokens !== undefined ? user.tokens : user.balance_tokens;
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
        verified: u.verified || false, banned: u.banned || u.blocked || false,
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

    const field = u.tokens !== undefined ? 'tokens' : 'balance_tokens';
    const cur = u[field] || 0;
    const amt = parseInt(tokens) || 0;

    if (action === 'add') u[field] = cur + amt;
    else if (action === 'subtract') u[field] = Math.max(0, cur - amt);
    else u[field] = amt;

    saveUsersObj(users);
    res.json({ success: true, newBalance: u[field] });
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
        tokens: u.tokens || u.balance_tokens || 0,
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
        totalTokens += (u.balance_tokens || u.tokens || 0);
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
                if (h.type === 'email' || h.type === 'gmail') gmailsUsed++;
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

    res.json({
        success: true,
        settings: {
            dailyBonus: settings.dailyBonus || 0,
            refBonus: settings.refBonus || 0,
            welcomeCredits: adminSettings.welcomeCredits || 0,
            transferFee: settings.transferCost || settings.transferFee || 0
        },
        costs: {
            services: settings.costs || {},
            cards: db.data.cardPrices || {},
            vpns: db.data.vpnPrices || {}
        },
        dbSize: (fs.existsSync(db.DB_FILE) ? (fs.statSync(db.DB_FILE).size / 1024).toFixed(2) : 0) + ' KB'
    });
});

// API: Cost Management (Save - Consolidated)
app.post('/api/admin/costs', (req, res) => {
    // Structure from admin.html payload
    const { settings, costs } = req.body;

    if (!db.data.settings) db.data.settings = {};

    if (settings) {
        if (settings.dailyBonus !== undefined) db.data.settings.dailyBonus = parseInt(settings.dailyBonus);
        if (settings.refBonus !== undefined) db.data.settings.refBonus = parseInt(settings.refBonus);
        if (settings.transferFee !== undefined) db.data.settings.transferCost = parseInt(settings.transferFee);

        if (settings.welcomeCredits !== undefined) {
            if (!db.data.adminSettings) db.data.adminSettings = {};
            db.data.adminSettings.welcomeCredits = parseInt(settings.welcomeCredits);
        }
    }

    if (costs) {
        if (costs.services) {
            db.data.settings.costs = { ...db.data.settings.costs, ...costs.services };
        }
        if (costs.cards) {
            db.data.cardPrices = { ...db.data.cardPrices, ...costs.cards };
        }
        if (costs.vpns) {
            db.data.vpnPrices = { ...db.data.vpnPrices, ...costs.vpns };
        }
    }

    db.save();
    res.json({ success: true, message: 'Settings saved successfully' });
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
        const adminId = process.env.ADMIN_ID;
        if (!adminId) return res.json({ success: false, message: 'ADMIN_ID not configured' });

        const backupFile = './backups/manual_backup_' + Date.now() + '.json';
        const fs = require('fs');
        if (!fs.existsSync('./backups')) fs.mkdirSync('./backups');

        fs.writeFileSync(backupFile, JSON.stringify(db.data, null, 2));

        if (bot) {
            await bot.sendDocument(adminId, backupFile, {
                caption: '📥 Automated Database Backup\n\nGenerated from Web Admin panel.',
                parse_mode: 'HTML'
            });
            res.json({ success: true, message: 'Backup sent to Telegram' });
        } else {
            res.json({ success: false, message: 'Bot Telegram instance not available' });
        }
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
        targetIds.push(...users.map(u => u.id));
    }

    if (target === 'groups' || target === 'all') {
        const groups = db.getGroups();
        targetIds.push(...groups.map(g => g.id));
    }

    // Unique IDs only
    targetIds = [...new Set(targetIds)];

    if (targetIds.length === 0) return res.json({ success: false, message: 'No targets found' });

    // Prepare Keyboard
    let reply_markup = undefined;
    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        // Format: [[{text, url}], [{text, url}]] (rows)
        // Client sends simple array? Let's assume client sends array of objects {text, url}
        // We can stack them 1 per row or 2. Let's do 1 per row for simplicity or 2.
        const rows = [];
        let currentRow = [];
        buttons.forEach((btn, i) => {
            currentRow.push({ text: btn.text, url: btn.url });
            if (currentRow.length === 2 || i === buttons.length - 1) {
                rows.push(currentRow);
                currentRow = [];
            }
        });
        reply_markup = { inline_keyboard: rows };
    }

    // Send
    let successCount = 0;
    let failCount = 0;

    try {
        const TelegramBot = require('node-telegram-bot-api');
        const config = require('../config');
        const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN); // Stateless sender

        // Batch processing to avoid rate limits? 
        // For now simple loop with slight delay

        for (const chatId of targetIds) {
            try {
                if (mediaType === 'photo' && mediaUrl) {
                    await bot.sendPhoto(chatId, mediaUrl, { caption: message, reply_markup });
                } else if (mediaType === 'video' && mediaUrl) {
                    await bot.sendVideo(chatId, mediaUrl, { caption: message, reply_markup });
                } else {
                    await bot.sendMessage(chatId, message || 'Broadcast', { reply_markup });
                }
                successCount++;
            } catch (e) {
                failCount++;
                // console.error(`Failed to send to ${chatId}: ${e.message}`);
            }
            // Tiny delay to be polite to API
            await new Promise(r => setTimeout(r, 50));
        }

        res.json({ success: true, sent: successCount, failed: failCount, total: targetIds.length });

    } catch (e) {
        console.error('Broadcast Error:', e);
        res.json({ success: false, message: 'Broadcast System Error' });
    }
});


// API: Admin - Upload Image (Base64)
app.post('/api/admin/upload', (req, res) => {
    const { image } = req.body; // Expects base64 string
    if (!image) return res.json({ success: false, message: 'No image data' });

    try {
        // Strip header if present (e.g., "data:image/png;base64,...")
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');

        // Fixed: upload to project /web/uploads, not /database/web/uploads
        const uploadDir = path.join(__dirname, '..', 'web', 'uploads');
        if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

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
    const userTokens = user.tokens !== undefined ? user.tokens : (user.balance_tokens || 0);

    if (userTokens < account.price) {
        return res.json({ success: false, message: `Insufficient tokens. Need ${account.price} TC.` });
    }

    // Deduct tokens
    if (user.tokens !== undefined) {
        user.tokens -= account.price;
    } else {
        user.balance_tokens -= account.price;
    }

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
                callbacks: totalCallbacks,
                activeUsers: activeUsers
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

    if (!userId) {
        return res.json({ success: false, message: 'User ID required' });
    }

    // Channel and Group IDs
    const requiredChannel = '-1002188442004'; // @AutosVerifych
    const requiredGroup = '-1002088203586';   // @AutosVerify

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
                channelJoined: true,
                groupJoined: true,
                message: 'Bot not available - allowing access'
            });
        }

        res.json({
            success: true,
            allJoined: channelJoined && groupJoined,
            channelJoined: channelJoined,
            groupJoined: groupJoined,
            channelLink: 'https://t.me/AutosVerifych',
            groupLink: 'https://t.me/AutosVerify'
        });
    } catch (error) {
        console.error('[JOIN CHECK] Error:', error);
        // Fail-open: allow access on error
        res.json({
            success: true,
            allJoined: true,
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
        const users = db.getUsers();
        const activities = [];

        // Collect recent purchase/activity data from user histories
        users.slice(0, 20).forEach(user => {
            if (user.history && user.history.length > 0) {
                const recentHistory = user.history.slice(0, 2); // Last 2 activities per user
                recentHistory.forEach(h => {
                    let action = 'purchase';
                    let item = h.type || 'item';
                    let amount = 0;

                    // Parse amount from reward string
                    if (h.reward) {
                        const match = h.reward.match(/-?(\d+)/);
                        if (match) amount = parseInt(match[1]);
                    }

                    // Determine action type
                    if (h.reward && h.reward.includes('+')) {
                        action = 'earn';
                    } else if (h.type === 'mail') {
                        action = 'mail';
                        item = 'Temp Mail';
                    } else if (h.type === 'number') {
                        action = 'purchase';
                        item = 'Number';
                    } else if (h.type === 'account_purchase') {
                        action = 'purchase';
                        item = h.category || 'Account';
                    } else if (h.type === 'verification') {
                        action = 'verify';
                        item = 'Verify';
                    }

                    activities.push({
                        username: user.username || user.firstName || 'User',
                        user: user.username || user.firstName || 'User',
                        action: action,
                        item: item,
                        amount: amount,
                        currency: 'TC',
                        date: h.date || Date.now()
                    });
                });
            }
        });

        // Sort by date (newest first) and take top 10
        activities.sort((a, b) => (b.date || 0) - (a.date || 0));
        const recentActivities = activities.slice(0, 10);

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

function startServer() {
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
}

module.exports = { startServer, setBot };

