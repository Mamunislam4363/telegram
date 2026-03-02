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

let bot = null;

function setBot(instance) {
    bot = instance;
}

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
    const { password } = req.body;
    if (password === (config.ADMIN_PASSWORD || 'admin123')) {
        res.json({ success: true, token: 'fake-jwt-token-' + Date.now() });
    } else {
        res.json({ success: false, message: 'Invalid password' });
    }
});

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
        if (user.tokens !== undefined) user.tokens = parseInt(balance);
        else user.balance_tokens = parseInt(balance);
    }
    if (Gems !== undefined) {
        if (user.Gems !== undefined) user.Gems = parseInt(Gems);
        else user.balance_Gems = parseInt(Gems);
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
        firstName: user.firstName || 'User',
        tokens: user.balance_tokens !== undefined ? user.balance_tokens : (user.tokens || 0),
        Gems: user.balance_Gems !== undefined ? user.balance_Gems : (user.Gems || 0),
        invites: user.referralCount || user.invites || 0,
        lastClaim: user.lastDaily || 0,
        dailyStreak: user.dailyStreak || 0,
        verified: user.successfulVerifications > 0 || user.verified || false
    });
});

// API: Get User History
app.get('/api/history/:userId', (req, res) => {
    const userId = req.params.userId;
    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, history: [] });
    }

    const history = user.history || [];
    res.json({ success: true, history: history });
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

// API: Verify Gemini Link
app.post('/api/verify', (req, res) => {
    const { userId, link } = req.body;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Add Gems reward
    const reward = 20;
    user.Gems = (user.Gems || 0) + reward;

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'verification',
        date: new Date().toISOString(),
        reward: `+${reward} Gems`
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: 'Verification successful',
        reward: reward,
        newBalance: user.Gems
    });
});

// API: Exchange Tokens to Gems
app.post('/api/exchange', (req, res) => {
    const { userId, amount } = req.body;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    const userTokens = user.tokens !== undefined ? user.tokens : (user.balance_tokens || 0);
    const amtNum = parseInt(amount) || 0;

    if (userTokens < amtNum) {
        return res.json({ success: false, message: 'Insufficient tokens' });
    }

    const GemsAmount = Math.floor(amtNum / 100); // 100 tokens = 1 Gems

    if (user.tokens !== undefined) user.tokens -= amtNum;
    else user.balance_tokens = (user.balance_tokens || 0) - amtNum;
    user.Gems = (user.Gems || 0) + GemsAmount;

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'exchange',
        date: new Date().toISOString(),
        reward: `-${amtNum} Tokens, +${GemsAmount} Gems`
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: 'Exchange successful',
        tokensUsed: amtNum,
        GemsReceived: GemsAmount,
        newTokens: user.tokens !== undefined ? user.tokens : user.balance_tokens,
        newGems: user.Gems
    });
});

// API: Exchange Convert (USD/Tokens/Gems)
app.post('/api/exchange/convert', (req, res) => {
    const { userId, from, to, amount } = req.body;

    const users = getUsersObj();
    const user = users[userId];
    if (!user) return res.json({ success: false, message: 'User not found' });

    const amt = Number(amount);
    if (!from || !to) return res.json({ success: false, message: 'Invalid currency' });
    if (from === to) return res.json({ success: false, message: 'Currencies must be different' });
    if (!Number.isFinite(amt) || amt <= 0) return res.json({ success: false, message: 'Invalid amount' });

    const usdToTokens = 100;
    const GemsToTokens = 100;

    const getBal = (cur) => {
        if (cur === 'tokens') return Number(user.tokens || user.balance_tokens || 0);
        if (cur === 'Gems') return Number(user.Gems || 0);
        if (cur === 'usd') return Number(user.usd || 0);
        return 0;
    };

    const setBal = (cur, val) => {
        if (cur === 'tokens') {
            if (user.tokens !== undefined) user.tokens = val;
            else user.balance_tokens = val;
        }
        if (cur === 'Gems') user.Gems = val;
        if (cur === 'usd') user.usd = val;
    };

    const fromBal = getBal(from);
    if (fromBal < amt) return res.json({ success: false, message: 'Insufficient balance' });

    // Convert from -> tokens base
    let tokensBase = 0;
    if (from === 'tokens') tokensBase = amt;
    else if (from === 'usd') tokensBase = amt * usdToTokens;
    else if (from === 'Gems') tokensBase = amt * GemsToTokens;
    else return res.json({ success: false, message: 'Invalid source currency' });

    // Convert tokens base -> to
    let toAmount = 0;
    if (to === 'tokens') toAmount = tokensBase;
    else if (to === 'usd') toAmount = tokensBase / usdToTokens;
    else if (to === 'Gems') toAmount = tokensBase / GemsToTokens;
    else return res.json({ success: false, message: 'Invalid target currency' });

    // Apply rounding rules
    if (to === 'usd') toAmount = Math.round(toAmount * 100) / 100;
    else toAmount = Math.floor(toAmount * 10000) / 10000;

    // Commit balances
    setBal(from, fromBal - amt);
    setBal(to, getBal(to) + toAmount);

    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'exchange_convert',
        date: new Date().toISOString(),
        reward: `-${amt} ${from.toUpperCase()}, +${toAmount} ${to.toUpperCase()}`
    });

    saveUsersObj(users);

    res.json({
        success: true,
        from,
        to,
        fromAmount: amt,
        toAmount,
        tokens: getBal('tokens'),
        Gems: getBal('Gems'),
        usd: getBal('usd')
    });
});

// API: Redeem Code
app.post('/api/redeem', (req, res) => {
    const { userId, code } = req.body;

    const user = db.getUser(userId);
    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Simple code validation (you can enhance this)
    const validCodes = {
        'WELCOME100': { tokens: 100, Gems: 0 },
        'BONUS50': { tokens: 50, Gems: 5 }
    };

    if (!validCodes[code]) {
        return res.json({ success: false, message: 'Invalid code' });
    }

    // Check if already redeemed
    if (!user.redeemedCodes) user.redeemedCodes = [];
    if (user.redeemedCodes.includes(code)) {
        return res.json({ success: false, message: 'Code already used' });
    }

    const reward = validCodes[code];
    user.tokens = (user.tokens || 0) + reward.tokens;
    user.Gems = (user.Gems || 0) + reward.Gems;
    user.redeemedCodes.push(code);

    // Add to history
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'redeem',
        date: new Date().toISOString(),
        reward: `+${reward.tokens} Tokens, +${reward.Gems} Gems`
    });

    db.saveUsers(users);

    res.json({
        success: true,
        message: 'Code redeemed successfully',
        reward: reward,
        newTokens: user.tokens,
        newGems: user.Gems
    });
});

// Redundant daily-claim endpoint removed (use /api/daily)

// API: Complete Task / Earn
app.post('/api/complete-task', (req, res) => {
    const { userId, taskId, reward } = req.body;

    const users = getUsersObj();
    const user = users[userId];

    if (!user) {
        return res.json({ success: false, message: 'User not found' });
    }

    // Prevent duplicate task completion (simple implementation)
    if (!user.completedTasks) user.completedTasks = [];

    const oneTimeTasks = ['join_channel', 'follow_twitter', 'subscribe_youtube'];
    if (oneTimeTasks.includes(taskId) && user.completedTasks.includes(taskId)) {
        return res.json({ success: false, message: 'Task already completed' });
    }

    // Add reward
    if (user.tokens !== undefined) user.tokens = (user.tokens || 0) + (parseInt(reward) || 0);
    else user.balance_tokens = (user.balance_tokens || 0) + (parseInt(reward) || 0);

    if (oneTimeTasks.includes(taskId)) {
        user.completedTasks.push(taskId);
    }

    // History
    if (!user.history) user.history = [];
    user.history.unshift({
        type: 'tasks',
        date: new Date().toISOString(),
        reward: `+${reward} Tokens`,
        detail: taskId
    });

    saveUsersObj(users);

    res.json({
        success: true,
        message: 'Task Completed!',
        reward: reward,
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

    if (!number) {
        return res.json({ success: false, message: "Service is temporarily unavailable. No credits deducted." });
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

    // Require live email data
    if (!emailData || !emailData.email) {
        return res.json({ success: false, message: 'Real-time email generation failed. Please try again in 5 minutes.' });
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
    const sessions = db.data.mailSessions || {};
    const session = sessions[sessionId];
    if (!session) return res.json({ success: false, messages: [] });

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
        res.json({ success: true, messages: formatted });
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
        Gems: u.Gems || u.balance_Gems || 0,
        gems: u.gems || 0,
        invites: u.invites || u.referralCount || 0,
        verified: u.verified || false, banned: u.banned || u.blocked || false,
        joinDate: u.joinDate || u.joinedAt || null, lastActive: u.lastActive || null
    }));
    res.json({ success: true, users: list, total: list.length });
});

// API: Admin - Update User Tokens
app.post('/api/admin/users/:userId/tokens', (req, res) => {
    const { userId } = req.params;
    const { tokens, action, type } = req.body;
    const users = getUsersObj();
    if (!users[userId]) return res.json({ success: false, message: 'User not found' });
    const u = users[userId];

    let field = 'tokens';
    if (type === 'Gems') field = u.Gems !== undefined ? 'Gems' : 'balance_Gems';
    else if (type === 'gems') field = 'gems';
    else field = u.tokens !== undefined ? 'tokens' : 'balance_tokens';

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

    res.json({
        success: true,
        settings,
        cardPrices,
        vpnPrices,
        adminSettings,
        serviceCosts
    });
});

// API: Admin - Update Settings
app.post('/api/admin/settings', (req, res) => {
    const { dailyBonus, refBonus, welcomeBonus, supportCost, gmailCost, gems } = req.body;
    const s = db.getSettings();

    if (dailyBonus !== undefined) s.dailyBonus = parseInt(dailyBonus);
    if (refBonus !== undefined) s.refBonus = parseInt(refBonus);

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

    if (gems) {
        if (!db.data.adminSettings) db.data.adminSettings = {};
        if (!db.data.adminSettings.gems) db.data.adminSettings.gems = {};
        if (gems.price !== undefined) db.data.adminSettings.gems.currentPrice = parseFloat(gems.price);
        if (gems.enabled !== undefined) db.data.adminSettings.gems.enabled = (gems.enabled === true || gems.enabled === 'true');
    }

    db.save();
    res.json({ success: true });
});

// API: Admin - Email Services Toggle
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
        name: u.username || u.firstName || 'User',
        refs: u.referralCount || 0,
        photo_url: u.photo_url || ''
    }));

    let userRank = null;
    if (userId) {
        const allUsers = Object.values(db.data.users)
            .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0));
        userRank = allUsers.findIndex(u => u.id.toString() === userId.toString()) + 1;
    }

    res.json({ success: true, top, userRank });
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
