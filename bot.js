const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { verifySheerID } = require('./verifier');
const config = require('./config');
const tempMail = require('./services/tempmail-providers');
const oauth = require('./oauth');
const db = require('./db.js');
const { languages, getText, getUserLanguage } = require('./languages');
const fs = require('fs');
const path = require('path');
const apiGateway = require('./services/api-gateway');

// Validate Config
const token = config.TELEGRAM_BOT_TOKEN;

// 🟢 START WEB PANEL AUTOMATICALLY
try {
    const server = require('./database/server.js'); // Import Web Server
    server.startServer();
} catch (e) {
    console.error('⚠️ Web Server Start Error:', e);
}
if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('❌ ERROR: Please set TELEGRAM_BOT_TOKEN in config.js');
    process.exit(1);
}

// SmtpLabs Integration

// REVISING LOGIC BASED ON USER INPUT: "automatic give and work"
// Most likely: GET https://api.smtp.dev/v1/account?token=... to get a new email?
// OR, we just generate `random@smtp.dev` and check it?
// Let's implement a 'random' generator first, then check via API.







// SMTP.DEV API Integration (Full Implementation)
const SMTP_API_BASE = 'https://api.smtp.dev';
const SMTP_API_KEY = config.SMTPLABS_API_KEY;

// Helper: Extract OTP from text
function extractOTP(text) {
    if (!text) return null;
    // Look for 4-8 digit codes
    const otpMatch = text.match(/\b\d{4,8}\b/);
    return otpMatch ? otpMatch[0] : null;
}

// Create a new email account via SMTP.DEV API
// Create a new email account via API Gateway (Generic Email Provider)
async function fetchSmtpLabsEmail() {
    try {
        const result = await apiGateway.executeWithFailover('email', async (provider) => {
            const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const randomPass = `Pass${Date.now()}!`;

            // Note: This logic assumes the provider supports creating @smtp.dev emails 
            // OR the provider ignores the domain in the address field if strict.
            // Ideally we query provider domains first, but for now we follow SMTP.DEV pattern.
            const domain = '@smtp.dev';
            const emailAddress = randomUser + domain;

            // Execute Request
            const response = await axios.post(`${provider.apiUrl}/accounts`, {
                address: emailAddress,
                password: randomPass
            }, {
                headers: {
                    'X-API-KEY': provider.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 8000
            });

            if (response.data && response.data.id) {
                const accountData = response.data;
                const inbox = accountData.mailboxes?.find(m => m.path === 'INBOX');

                return {
                    id: accountData.id,
                    email: accountData.address,
                    password: randomPass,
                    mailboxId: inbox?.id || null,
                    providerId: provider.id
                };
            }
            throw new Error('Invalid API Response Structure');
        });

        return result;

    } catch (e) {
        console.error('Email Service Error:', e.message);
        return null;
    }
}

// Get OTP from email inbox
// Get OTP from email inbox (Supports Multiple Providers)
// Get OTP from email inbox (Supports Multiple Providers)
async function getSmtpLabsOtp(email, accountId = null, mailboxId = null, providerId = null) {
    let apiBase = SMTP_API_BASE;
    let apiKey = SMTP_API_KEY;

    if (providerId) {
        const p = db.getProviderDecrypted(providerId);
        if (p) {
            apiBase = p.apiUrl;
            apiKey = p.apiKey;
        }
    }

    try {
        if (!email || !email.includes('@')) return null;

        const headers = { 'X-API-KEY': apiKey, 'Accept': 'application/json' };

        // 1. Resolve Account ID
        if (!accountId) {
            const res = await axios.get(`${apiBase}/accounts?address=${email}`, { headers, timeout: 5000 });
            if (res.data?.member?.length > 0) accountId = res.data.member[0].id;
            else return null;
        }

        // 2. Resolve Mailbox ID
        if (!mailboxId) {
            const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes`, { headers, timeout: 5000 });
            const inbox = res.data?.member?.find(m => m.path === 'INBOX');
            if (inbox) mailboxId = inbox.id;
            else return null;
        }

        // 3. Get Messages
        const msgRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages`, { headers, timeout: 5000 });

        if (msgRes.data?.member?.length > 0) {
            const latestMsg = msgRes.data.member[0];

            // 4. Fetch Full Message
            const fullRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages/${latestMsg.id}`, { headers, timeout: 5000 });
            const fullMsg = fullRes.data;

            // Extract OTP
            // Prefer Body Text > Subject
            const body = fullMsg.body?.text || '';
            const subject = fullMsg.subject || latestMsg.subject || '';
            const textContent = `${subject} ${body}`;

            const otp = extractOTP(textContent);

            return {
                otp: otp,
                subject: subject,
                from: fullMsg.from?.address || 'Unknown',
                date: fullMsg.createdAt || latestMsg.createdAt,
                fullMessage: textContent.substring(0, 500)
            };
        }

        return null;

    } catch (e) {
        // console.error('SMTP OTP Fetch Error:', e.message);
        return null;
    }
}


const bot = new TelegramBot(token, {
    polling: false, // Wait for DB load
    polling_timeout: 10,
    polling_options: {
        allowed_updates: [
            'message',
            'callback_query',
            'chat_member',
            'my_chat_member',
            'inline_query'
        ]
    }
});

// Start Polling ONLY after DB is ready (Unlocks Phase 1 & 2)
db.dbReady.then(() => {
    console.log("🚀 Database Ready (Firebase/Local). Starting Bot...");
    bot.startPolling();

    // Link Bot to Web Server for Broadcasts
    try {
        require('./database/server.js').setBot(bot);
    } catch (e) {
        console.error("⚠️ Server Bot Link Error:", e.message);
    }

}).catch(err => {
    console.error("❌ Critical DB Init Error:", err);
    // Fallback? Or crash?
    // Start anyway with defaults if critical?
    console.warn("⚠️ Starting empty bot due to DB error.");
    bot.startPolling();
});

// Suppress polling error logs
bot.on('polling_error', (err) => {
    // Only log actual errors, not conflict warnings
    if (err.code !== 'ETELEGRAM' || !err.message.includes('409')) {
        console.log(`⚠️ Bot connection issue: ${err.message}`);
    }
});

// Clean console logging - only show user activities
const originalConsoleLog = console.log;
console.log = function (...args) {
    const msg = args.join(' ');
    // Filter out polling/technical messages, only show user activities
    if (msg.includes('👤 User:') || msg.includes('💬 Chat:') || msg.includes('✅ Verification:') || msg.includes('📊 Activity:')) {
        originalConsoleLog.apply(console, args);
    }
};

console.log('🤖 Telegram Verification Bot Started');
console.log('📊 Activity: Bot is running and waiting for users...');

bot.getMe().then(me => {
    console.log(`📊 Activity: Bot connected as @${me.username}`);
    if (!db.data.settings) db.data.settings = {};
    db.data.settings.botUsername = me.username;
    db.save();
}).catch(err => {
    // Silently handle connection errors
});

// Global Error Handlers - silent
process.on('unhandledRejection', () => { /* silent */ });
process.on('uncaughtException', () => { /* silent */ });

// Manage State 
const userState = {};

// Helper: Check authorization
function isAdmin(userId) {
    return String(userId) === String(config.ADMIN_ID) || config.ALLOWED_USER_IDS.includes(String(userId));
}

// Helper: Generate user authentication token for web panel
function generateUserAuthToken(userId) {
    const crypto = require('crypto');
    const secret = config.TELEGRAM_BOT_TOKEN || 'secret_key';
    const timestamp = Date.now();
    const data = `${userId}:${timestamp}`;
    const hash = crypto.createHmac('sha256', secret).update(data).digest('hex');
    return `${hash}:${timestamp}`;
}

// Helper: Verify user authentication token
function verifyUserAuthToken(userId, token) {
    const crypto = require('crypto');
    const secret = config.TELEGRAM_BOT_TOKEN || 'secret_key';
    const [hash, timestamp] = token.split(':');

    if (!hash || !timestamp) return false;

    // Check if token is expired (24 hours)
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > 24 * 60 * 60 * 1000) return false;

    const data = `${userId}:${timestamp}`;
    const expectedHash = crypto.createHmac('sha256', secret).update(data).digest('hex');

    return hash === expectedHash;
}

// Helper: Check if feature is enabled - returns true if enabled, sends Coming Soon message if disabled
function checkFeatureEnabled(bot, chatId, userId, featureKey, query) {
    const isEnabled = db.isFeatureEnabled(featureKey);
    if (!isEnabled) {
        const comingSoonMsg = `⏳ **Coming Soon!**\n\nThis feature is currently under development.\nStay tuned for updates!`;

        if (query) {
            bot.answerCallbackQuery(query.id, {
                text: "⏳ Coming Soon!",
                show_alert: true
            });
        }

        bot.sendMessage(chatId, comingSoonMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main_menu' }]]
            }
        });
        return false;
    }
    return true;
}

// Helper: Show Broadcast Options
async function showBroadcastOptions(chatId, userId) {
    const state = userState[userId];
    if (!state) return;

    // Message is required only if no media
    if (!state.mediaType && !state.message) return;

    const buttonsCount = state.buttons.length;
    const mediaInfo = state.mediaType ? `📎 ${state.mediaType === 'photo' ? 'Photo' : 'Video'} attached\n` : '';

    const msg = `✅ **Message Received!**\n\n` +
        `${mediaInfo}` +
        `📝 Message: ${state.message.substring(0, 100)}${state.message.length > 100 ? '...' : ''}\n` +
        `🔘 Buttons: ${buttonsCount}\n\n` +
        `**What's next?**`;

    const keyboard = {
        inline_keyboard: [
            [
                { text: '➕ Add Button', callback_data: 'broadcast_add_button' },
                { text: '👁️ Preview', callback_data: 'broadcast_preview' }
            ],
            [
                { text: '📤 Send Now', callback_data: 'broadcast_send_confirm' },
                { text: '🕒 Schedule', callback_data: 'broadcast_schedule' }
            ],
            [
                { text: '❌ Cancel', callback_data: 'broadcast_cancel' }
            ]
        ]
    };

    try {
        if (state.optionsMessageId) {
            // Edit existing message
            await bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: state.optionsMessageId,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else {
            // Send new message and store ID
            const sentMsg = await bot.sendMessage(chatId, msg, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            userState[userId].optionsMessageId = sentMsg.message_id;
        }
    } catch (error) {
        console.error('Error showing broadcast options:', error);
        // If edit fails, send new message
        const sentMsg = await bot.sendMessage(chatId, msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
        userState[userId].optionsMessageId = sentMsg.message_id;
    }
}

// Helper: Check if user is member of required channel and group
async function checkMembership(userId) {
    try {
        const results = {
            channel: false,
            group: false
        };
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];

        // Check channel membership
        if (config.REQUIRED_CHANNEL) {
            try {
                const channelMember = await bot.getChatMember(config.REQUIRED_CHANNEL, userId);
                results.channel = validStatuses.includes(channelMember.status);
            } catch (error) {
                console.error(`Check Channel Error (${userId}):`, error.message);
                results.channel = false;
            }
        } else {
            results.channel = true; // No channel required
        }

        // Check group membership
        if (config.REQUIRED_GROUP) {
            try {
                const groupMember = await bot.getChatMember(config.REQUIRED_GROUP, userId);
                results.group = validStatuses.includes(groupMember.status);
            } catch (error) {
                console.error(`Check Group Error (${userId}):`, error.message);
                results.group = false;
            }
        } else {
            results.group = true; // No group required
        }

        return results;
    } catch (error) {
        console.error('Membership check error:', error);
        return { channel: false, group: false };
    }
}

// Helper: Show mandatory join message (smart - shows only missing items)
function showMandatoryJoin(chatId, membership, msgId = null) {
    const requiredChannel = (config.REQUIRED_CHANNEL || '').toString().trim();
    const requiredGroup = (config.REQUIRED_GROUP || '').toString().trim();

    // Determine what's missing
    const missingItems = [];
    if (requiredChannel && !membership.channel) {
        missingItems.push({ label: '📢 Channel', username: requiredChannel });
    }
    if (requiredGroup && !membership.group) {
        missingItems.push({ label: '💬 Group', username: requiredGroup });
    }

    // Build message
    let msg = `🚫 *Access Restricted!*\n\n`;
    if (missingItems.length === 1) {
        const item = missingItems[0];
        msg += `You left our ${item.label} and your access has been *revoked*\n\n`;
        msg += `Please rejoin to continue using the bot:\n\n`;
        msg += `❌ ${item.label}: \`${item.username}\``;
    } else {
        msg += `You are not a member of our required communities.\n\n`;
        msg += `Please join to use the bot:\n\n`;
        missingItems.forEach(item => {
            msg += `❌ ${item.label}: \`${item.username}\`\n`;
        });
    }
    msg += `\n\n✅ After joining, click *I Joined* below to verify.`;

    // Build join buttons (only for missing items)
    const buttons = [];
    const joinRow = missingItems.map(item => ({
        text: `Join ${item.label}`,
        url: `https://t.me/${item.username.replace('@', '')}`
    }));
    if (joinRow.length) buttons.push(joinRow);
    buttons.push([{ text: '✅ I Joined - Verify Now', callback_data: 'verify_membership' }]);

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    };

    if (msgId) {
        bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => {
            bot.sendMessage(chatId, msg, opts).catch(() => { });
        });
    } else {
        bot.sendMessage(chatId, msg, opts).catch(() => { });
    }
}

// Global Logger Override 
let currentChatId = null;
const originalEmitLog = global.emitLog;

global.emitLog = (message, type = 'info') => {
    if (currentChatId) {
        if (message.includes('Step') || message.includes('Success') || message.includes('Error') || message.includes('Reward') || message.includes('http')) {
            const emoji = type === 'error' ? '❌' : (message.includes('Reward') ? '🎁' : 'ℹ️');
            bot.sendMessage(currentChatId, `${emoji} ${message}`);
        }
    }
    console.log(`[BOT] ${message}`);
    if (originalEmitLog) originalEmitLog(message, type);
};

// ================= COMMAND HANDLERS =================

// /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name || 'Unknown';
    const user = db.getUser(userId);

    try {
        // Log user activity
        originalConsoleLog(`👤 User: ${userId} (${username}) | 🚀 Started bot | ⏰ ${new Date().toLocaleTimeString()}`);

        // Referral Logic (Pending Verification)
        const refMatch = msg.text.split(' ')[1];
        if (refMatch) {
            const cleanRef = String(refMatch).replace(/^ref_/, '');
            if (cleanRef !== String(userId)) {
                // Store pending referrer if not already referred
                if (!user.referredBy && !user.pendingReferrer) {
                    user.pendingReferrer = cleanRef;
                    db.updateUser(user);
                }
            }
        }

        // Check mandatory membership
        const membership = await checkMembership(userId);

        if (!membership.channel || !membership.group) {
            // User not joined, show mandatory join screen

            // Remove lingering keyboard if it exists
            const cleanupMsg = await bot.sendMessage(chatId, "⏳ Initializing...", { reply_markup: { remove_keyboard: true } });
            bot.deleteMessage(chatId, cleanupMsg.message_id).catch(() => { });

            showMandatoryJoin(chatId, membership);
            return;
        }

        // Cleanup old persistent keyboards before sending the menu
        const cleanupMsg2 = await bot.sendMessage(chatId, "⏳ Initializing...", { reply_markup: { remove_keyboard: true } });
        bot.deleteMessage(chatId, cleanupMsg2.message_id).catch(() => { });

        // User is member, show main menu
        await sendMainMenu(chatId, user, msg.from);
    } catch (e) {
        console.error('Error handling /start:', e);
        bot.sendMessage(chatId, '❌ Bot error. Please try again in a moment.').catch(() => { });
    }
});

// Removed /admin and sendAdminMainMenu function per user request
async function sendMainMenu(chatId, user, msgFrom) {
    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Get fresh name from Telegram message context if available, else use stored
    const firstName = (msgFrom && msgFrom.first_name) ? msgFrom.first_name :
        (user.firstName || user.first_name || 'Friend');
    const tokens = user.balance_tokens !== undefined ? user.balance_tokens :
        (user.tokens || user.balance || 0);

    // Welcome message matching screenshot style
    const welcomeText = `👋 *Hello, ${firstName}!*\n\n` +
        `Welcome to Gemini Verified! 🚀\n\n` +
        `Launch our Mini App to start earning rewards, invite friends, and manage your assets.`;

    const appUrl = `${publicUrl}`;

    // Keyboard matching screenshot style - vertical layout, 1 button per row
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Launch App', web_app: { url: appUrl } }],
                [{ text: '📢 Join Channel', url: `https://t.me/${(config.REQUIRED_CHANNEL || '').replace('@', '')}` }],
                [{ text: '👥 Join Group', url: `https://t.me/${(config.REQUIRED_GROUP || '').replace('@', '')}` }],
                [{ text: '📺 YouTube Channel', url: 'https://youtube.com/@MamunIslamyts' }]
            ]
        }
    };

    try {
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
        console.error('Error sending main menu:', e);
    }
}

// Debounce Maps
const callbackThrottle = new Map();
const messageThrottle = new Map();

// Track Group Memberships & User Activity
bot.on('my_chat_member', (update) => {
    const chat = update.chat;
    const newStatus = update.new_chat_member.status;

    if (['member', 'administrator'].includes(newStatus)) {
        // Bot added to group/channel
        db.saveGroup(chat.id, chat.title, chat.type);
        console.log(`[GROUP] Added to ${chat.type}: ${chat.title} (${chat.id})`);
    } else if (['left', 'kicked'].includes(newStatus)) {
        // Bot removed
        if (db.data.groups && db.data.groups[chat.id]) {
            delete db.data.groups[chat.id];
            db.save();
            console.log(`[GROUP] Removed from ${chat.type}: ${chat.title} (${chat.id})`);
        }
    }
});

// Update User Activity on Message (Any Type)
bot.on('message', async (msg) => {
    if (msg.from && msg.from.id) db.updateUserActivity(msg.from.id);
    if (['group', 'supergroup', 'channel'].includes(msg.chat.type)) {
        db.saveGroup(msg.chat.id, msg.chat.title, msg.chat.type);
    }

    // Admin inputs removed per user request
}); // Fix: Close the message handler here!

// 🚨 Auto-detect when user leaves/is kicked from required channel or group
bot.on('chat_member', async (update) => {
    try {
        const chatId = update.chat.id;
        const chatUsername = update.chat.username ? '@' + update.chat.username : String(chatId);
        const newStatus = update.new_chat_member.status;
        const userId = update.new_chat_member.user.id;
        const isBot = update.new_chat_member.user.is_bot;
        if (isBot) return; // Ignore bot status changes

        const requiredChannel = (config.REQUIRED_CHANNEL || '').toString().trim().toLowerCase();
        const requiredGroup = (config.REQUIRED_GROUP || '').toString().trim().toLowerCase();
        const chatTag = chatUsername.toLowerCase();

        const isRequiredChat = (chatTag === requiredChannel || chatTag === requiredGroup ||
            String(chatId) === requiredChannel || String(chatId) === requiredGroup);

        if (!isRequiredChat) return; // Not a monitored chat

        const leftStatuses = ['left', 'kicked', 'banned', 'restricted'];
        if (!leftStatuses.includes(newStatus)) return; // User is still in (joined, etc)
        if (newStatus === 'restricted' && update.new_chat_member.is_member) return; // Still member

        // User left or was kicked from a required chat - notify them
        originalConsoleLog(`🚨 User ${userId} left monitored chat: ${chatUsername}`);

        // Re-check full membership status
        const membership = await checkMembership(userId);

        // Only notify if actually missing something
        if (!membership.channel || !membership.group) {
            showMandatoryJoin(userId, membership);
        }
    } catch (e) {
        // Silently handle errors
    }
});

// Callback Query Handler
bot.on('callback_query', async (query) => {
    // Update Activity
    if (query.from && query.from.id) db.updateUserActivity(query.from.id);

    // ----------------------------------------------------
    // DEBOUNCE LOGIC (Prevent Double Click)
    // ----------------------------------------------------

    const userId = query.from.id;
    const now = Date.now();
    const lastTime = callbackThrottle.get(userId) || 0;

    if (now - lastTime < 1500) {
        // Prevent spam clicking (1.5s delay)
        return bot.answerCallbackQuery(query.id);
    }
    callbackThrottle.set(userId, now);

    try {
        const chatId = query.message.chat.id;
        const userId = query.from.id;
        const data = query.data;
        const msgId = query.message.message_id;
        const username = query.from.username || query.from.first_name || 'Unknown';

        // Log user activity
        originalConsoleLog(`👤 User: ${userId} (${username}) | 💬 Action: ${data} | ⏰ ${new Date().toLocaleTimeString()}`);

        // Ensure User Exists
        // Ensure User Exists
        const user = db.getUser(userId);
        const lang = getUserLanguage(userId, db);

        // Admin callback queries removed
        // VERIFY MEMBERSHIP (Mandatory Join Check)
        if (data === 'verify_membership') {
            await bot.answerCallbackQuery(query.id, { text: "🔍 Checking membership...", show_alert: false }).catch(() => { });

            const membership = await checkMembership(userId);
            const allJoined = membership.channel && membership.group;

            if (!allJoined) {
                // Still not joined - update existing message with accurate status
                showMandatoryJoin(chatId, membership, msgId);
            } else {
                // Successfully joined both
                await bot.answerCallbackQuery(query.id, {
                    text: "✅ Verified! Welcome!",
                    show_alert: true
                }).catch(() => { });

                // PROCESS PENDING REFERRAL
                if (user.pendingReferrer) {
                    if (db.handleReferral(userId, user.pendingReferrer)) {
                        bot.sendMessage(user.pendingReferrer, `🎉 *Referral Bonus!*\n\nUser ${user.first_name || userId} joined and verified!\n💰 +${db.getSettings().refBonus} Credits added!`, { parse_mode: 'Markdown' }).catch(() => { });
                    }
                    user.pendingReferrer = null;
                    db.updateUser(user);
                }

                bot.deleteMessage(chatId, msgId).catch(() => { });
                sendMainMenu(chatId, user);
            }
            return;
        }

        if (data === 'main_menu') {
            bot.deleteMessage(chatId, msgId).catch(() => { });
            sendMainMenu(chatId, user);
        }

        // START VERIFICATION -> SHOW SERVICES
        else if (data === 'start_verify') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'verification', query)) return;

            const costs = db.getSettings().costs;
            const serviceMap = {
                spotify: 'Spotify Student',
                youtube: 'YouTube Student',
                teacher: 'Bolt.new (Teacher)',
                gpt: 'ChatGPT Teacher',
                military: 'ChatGPT Military',
                gemini: 'Gemini Student'
            };

            const buttons = [];
            Object.keys(serviceMap).forEach(key => {
                const cost = costs[key] || 100; // Default fallback
                buttons.push([{
                    text: getText(lang, 'serviceInfo', serviceMap[key], cost),
                    callback_data: `service_${key}_${cost}`
                }]);
            });

            buttons.push([{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]);

            bot.editMessageText(getText(lang, 'selectService'), {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // REFERRAL STATS & LEADERBOARD
        else if (data === 'referral') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'referral', query)) return;
            let botName = 'YourBot';
            try { botName = (await bot.getMe()).username; } catch (e) { }

            const refLink = `https://t.me/${botName}?start=${userId}`;
            const totalRefs = user.referralCount || 0;
            const refBonus = db.getSettings().refBonus || 25;
            const earnings = totalRefs * refBonus;

            let msg = `🎁 **Referral Program**\n\n` +
                `💰 **Earn ${refBonus} Credits per Referral!**\n\n` +
                `📊 **Your Stats:**\n` +
                `👥 Total Referrals: **${totalRefs}**\n` +
                `💵 Total Earned: **${earnings} Credits**\n\n` +
                `🔗 **Your Referral Link:**\n` +
                `\`${refLink}\`\n\n` +
                `📢 Share your link and earn **${refBonus} Credits** for each friend who joins!\n\n` +
                `🏆 **Top Referrers:**\n`;

            const top = db.getTopReferrers(5);

            if (top.length === 0) {
                msg += `_No data yet. Be the first!_`;
            } else {
                top.forEach((u, i) => {
                    const name = u.first_name || `User ${u.id.toString().slice(-4)}`;
                    msg += `${i + 1}. ${name} - **${u.referralCount}** Refs\n`;
                });
            }

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [[{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]]
                },
                parse_mode: 'Markdown'
            });
        }

        // MY BALANCE
        else if (data === 'my_balance') {
            bot.answerCallbackQuery(query.id).catch(() => { });

            const freshUser = db.getUser(userId);
            const balance = freshUser.balance || 0;
            const msg = getText(lang, 'balanceMsg', balance);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: getText(lang, 'addBalance'), callback_data: 'add_balance_menu' }],
                        [{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // DAILY REWARD
        else if (data === 'daily') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'daily_bonus', query)) return;

            const result = db.claimDaily(userId);
            if (result.success) {
                bot.answerCallbackQuery(query.id, {
                    text: `✅ Claimed ${result.amount} Credits!`,
                    show_alert: true
                });
            } else {
                bot.answerCallbackQuery(query.id, {
                    text: `⏳ ${result.msg}`,
                    show_alert: true
                });
            }
            bot.deleteMessage(chatId, msgId).catch(() => { });
            setTimeout(() => sendMainMenu(chatId, db.getUser(userId)), 500);
        }


        // ==================== SUPPORT (WITH COST) ====================

        // SUPPORT MENU
        else if (data === 'support_menu') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'support', query)) return;

            const supportCost = db.getSupportCost();
            const balance = user.balance || 0;

            if (balance < supportCost) {
                const msg = getText(lang, 'insufficientBalance', supportCost) + `\n\n` + getText(lang, 'balanceMsg', balance);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: getText(lang, 'addBalance'), callback_data: 'add_balance_menu' }],
                            [{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                const msg = getText(lang, 'supportMenu', supportCost, balance);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: getText(lang, 'accessSupport', supportCost), callback_data: 'access_support' }],
                            [{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            }
        }

        // ACCESS SUPPORT (DEDUCT CREDITS)
        else if (data === 'access_support') {
            const supportCost = db.getSupportCost();
            const balance = user.balance || 0;

            if (balance < supportCost) {
                bot.answerCallbackQuery(query.id, {
                    text: getText(lang, 'insufficientBalance', supportCost),
                    show_alert: true
                });
                return;
            }

            // Deduct credits
            db.addCredit(userId, -supportCost);

            const supportChannel = config.SUPPORT_CHANNEL;
            const msg = getText(lang, 'supportGranted', supportCost);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: getText(lang, 'goToSupport'), url: `https://t.me/${supportChannel.replace('@', '')}` }],
                        [{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]
                    ]
                },
                parse_mode: 'Markdown'
            });

            bot.answerCallbackQuery(query.id, {
                text: `✅ ${supportCost} credits deducted. Support access granted!`,
                show_alert: false
            });
        }

        // SERVICE SELECTED
        else if (data.startsWith('service_')) {
            const parts = data.split('_');
            const serviceId = parts[1];

            // Fetch Real-time Cost
            const settings = db.getSettings();
            const cost = settings.costs[serviceId] || 100;

            if (user.balance < cost) {
                return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Credits! Need ${cost}`, show_alert: true });
            }

            userState[userId] = { action: 'awaiting_link', service: serviceId, cost: cost };

            bot.editMessageText(`🔗 **Paste your SheerID Link for ${serviceId.toUpperCase()}:**\n\n` +
                `💰 Cost: **${cost} Credits**\n\n` +
                `📝 **Example:**\n` +
                `\`https://services.sheerid.com/verify/xxxxx/\``, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_verify' }]] },
                parse_mode: 'Markdown'
            });
        }

        // CANCEL VERIFICATION
        else if (data === 'cancel_verify') {
            delete userState[userId];
            bot.editMessageText('🚫 Verification Canceled.', { chat_id: chatId, message_id: msgId });
            setTimeout(() => sendMainMenu(chatId, user), 1000);
        }

        // BALANCE
        else if (data === 'balance') {
            bot.answerCallbackQuery(query.id, { text: `💰 Your Balance: ${user.balance} Credits`, show_alert: true });
        }

        // BUY CARDS MENU
        else if (data === 'buy_cards_menu') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'buy_cards', query)) return;

            const services = db.getServices(); // Returns array of { id, name, price, stock }

            let msg = `💳 **${getText(lang, 'buyCards')}**\n\n`;
            const buttons = [];

            if (services.length === 0) {
                buttons.push([{ text: getText(lang, 'outOfStock'), callback_data: 'ignore' }]);
            } else {
                services.forEach(s => {
                    let buttonText;
                    const priceText = `${s.price} cr`;

                    if (s.stock > 0) {
                        buttonText = `${s.name} - ${priceText}`;
                    } else {
                        buttonText = `${s.name} - ${getText(lang, 'outOfStock')}`;
                    }

                    buttons.push([{
                        text: buttonText,
                        callback_data: s.stock > 0 ? `buy_card_confirm_${s.id}` : 'no_stock'
                    }]);
                });
            }

            buttons.push([{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // CONFIRM CARD PURCHASE (Directly from menu)
        else if (data.startsWith('buy_card_confirm_')) {
            const serviceId = data.replace('buy_card_confirm_', '');
            const services = db.getServices();
            const service = services.find(s => s.id === serviceId);

            if (!service) {
                bot.answerCallbackQuery(query.id, { text: '❌ Service not found!', show_alert: true });
                return;
            }

            if (service.stock === 0) {
                bot.answerCallbackQuery(query.id, { text: '❌ Out of stock!', show_alert: true });
                return;
            }

            if (user.balance < service.price) {
                bot.answerCallbackQuery(query.id, { text: '❌ Insufficient balance!', show_alert: true });
                return;
            }

            const card = db.getCard(serviceId);

            if (!card) {
                bot.answerCallbackQuery(query.id, { text: '❌ System error: Stock mismatch. Contact Admin.', show_alert: true });
                return;
            }

            user.balance -= service.price;
            user.cardsPurchased = (user.cardsPurchased || 0) + 1;
            db.updateUser(user);

            let detailsMsg = `💎 **${service.name} Premium**\n\n`; // HEADER

            if (typeof card === 'string') {
                const parts = card.split('|');
                if (parts.length >= 2) {
                    detailsMsg += `📧 **Email:** \`${parts[0].trim()}\`\n`;
                    detailsMsg += `🔑 **Password:** \`${parts[1].trim()}\`\n`;
                    if (parts.length > 2) detailsMsg += `📝 **Info:** \`${parts.slice(2).join('|')}\`\n`;
                } else {
                    detailsMsg += `📦 **Credentials:** \`${card}\`\n`;
                }
            } else if (typeof card === 'object') {
                // Card object with full details
                if (card.number) {
                    // Full card with billing info
                    detailsMsg += `📍 **Billing Address:**\n`;
                    detailsMsg += `\`\`\`\n`;
                    detailsMsg += `Type: ${card.type || 'N/A'}\n`;
                    detailsMsg += `Name: ${card.name || 'N/A'}\n`;
                    detailsMsg += `State: ${card.state || 'N/A'}\n`;
                    detailsMsg += `City: ${card.city || 'N/A'}\n`;
                    detailsMsg += `Address: ${card.address || 'N/A'}\n`;
                    detailsMsg += `Zip: ${card.zip || 'N/A'}\n`;
                    detailsMsg += `\`\`\`\n\n`;

                    detailsMsg += `💳 **Card Details:**\n`;
                    detailsMsg += `\`\`\`\n`;
                    detailsMsg += `Number: ${card.number}\n`;
                    detailsMsg += `Expiry: ${card.expiry}\n`;
                    detailsMsg += `CVV: ${card.cvv}\n`;
                    detailsMsg += `\`\`\`\n\n`;

                    if (card.vpn || card.country) {
                        detailsMsg += `🌐 **VPN Info:**\n`;
                        detailsMsg += `VPN: ${card.vpn || 'N/A'}\n`;
                        detailsMsg += `Country: ${card.country || 'N/A'}\n\n`;
                    }
                } else if (card.email) {
                    // Account style (email/password)
                    detailsMsg += `📧 **Email:** \`${card.email}\`\n`;
                    detailsMsg += `🔑 **Password:** \`${card.password}\`\n`;
                    if (card.data) detailsMsg += `📝 **Data:** \`${card.data}\`\n`;
                }
            }

            detailsMsg += `\n________________________\n\n` +
                `⚠️ **Instructions:**\n` +
                `• Login to ${service.name} using these details.\n` +
                `• Keep this info safe.`;

            bot.answerCallbackQuery(query.id, { text: "✅ Purchase Successful!", show_alert: false }).catch(() => { });

            bot.sendMessage(chatId, `✅ **Purchase Successful!**\n` +
                `💸 **${service.price} Credits deducted**\n` +
                `💰 Remaining Balance: **${user.balance} Credits**\n\n` +
                `${detailsMsg}`, {
                parse_mode: 'Markdown'
            });

            console.log(`[PURCHASE] User ${userId} bought ${service.name}`);
        }

        // ==================== VPN PURCHASE SYSTEM ====================

        // BUY VPN MENU
        else if (data === 'buy_vpn_menu') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'buy_vpn', query)) return;

            const vpnServices = db.getVPNServices(); // Returns array like getServices()

            let msg = `🛡️ **Buy Premium VPN**\n\nselect a service to protect your privacy:\n`;
            const buttons = [];

            if (vpnServices.length === 0) {
                buttons.push([{ text: '🚫 Out of Stock', callback_data: 'ignore' }]);
            } else {
                vpnServices.forEach(s => {
                    let buttonText;
                    const priceText = `${s.price} Cr`;

                    if (s.stock > 0) {
                        buttonText = `🔐 ${s.name} • ${priceText}`;
                    } else {
                        buttonText = `❌ ${s.name} (Sold Out)`;
                    }

                    buttons.push([{
                        text: buttonText,
                        callback_data: s.stock > 0 ? `buy_vpn_confirm_${s.id}` : 'no_stock'
                    }]);
                });
            }

            buttons.push([{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // CONFIRM VPN PURCHASE (Directly from menu, matching card flow)
        else if (data.startsWith('buy_vpn_confirm_')) {
            const serviceId = data.replace('buy_vpn_confirm_', '');
            const vpnService = db.getVPNService(serviceId);

            if (!vpnService) {
                bot.answerCallbackQuery(query.id, { text: '❌ Service not found!', show_alert: true });
                return;
            }

            if (vpnService.stock === 0) {
                bot.answerCallbackQuery(query.id, { text: '❌ Out of stock!', show_alert: true });
                return;
            }

            if (db.deductCredit(userId, vpnService.price)) {
                const vpnAccount = db.getVPN(serviceId);
                if (vpnAccount) {
                    user.cardsPurchased = (user.cardsPurchased || 0) + 1;
                    db.save();

                    const detailsMsg = `🔒 **${vpnService.name}**\n\n` +
                        `📧 **Email:** \`${vpnAccount.email}\`\n` +
                        `🔑 **Password:** \`${vpnAccount.password}\`\n\n` +
                        `________________________\n\n` +
                        `⚠️ **Important:**\n` +
                        `• Login to your VPN app with these credentials\n` +
                        `• Keep this information secure\n` +
                        `• Do not share with others`;

                    bot.sendMessage(chatId, `✅ **Purchase Successful!**\n` +
                        `💸 **${vpnService.price} Credits deducted**\n` +
                        `💰 Remaining Balance: **${user.balance} Credits**\n\n` +
                        `________________________\n\n` +
                        `${detailsMsg}`, {
                        parse_mode: 'Markdown'
                    });

                    bot.deleteMessage(chatId, msgId).catch(() => { });
                } else {
                    bot.answerCallbackQuery(query.id, { text: '❌ VPN account not available!', show_alert: true });
                }
            } else {
                bot.answerCallbackQuery(query.id, { text: '❌ Insufficient balance!', show_alert: true });
            }
        }

        // NO STOCK CALLBACK
        else if (data === 'no_stock') {
            bot.answerCallbackQuery(query.id, {
                text: '❌ This item is currently out of stock. Please check back later!',
                show_alert: true
            });
        }

        // ==================== PREMIUM APP SYSTEM ====================

        // MENU
        else if (data === 'buy_premium_app') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'buy_premium_app', query)) return;

            const apps = db.getPremiumApps();
            const keys = Object.keys(apps);

            let msg = `📱 **Premium Apps**\n\nSelect an app to get access:`;
            const buttons = [];

            if (keys.length === 0) {
                msg += `\n\n❌ No apps available currently.`;
            } else {
                keys.forEach(k => {
                    const app = apps[k];
                    const priceText = app.price ? `(${app.price} cr)` : '(Free)';
                    buttons.push([{ text: `📱 ${app.name} ${priceText}`, callback_data: `get_premium_app_${app.id}` }]);
                });
            }

            buttons.push([{ text: '🔙 Main Menu', callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // CONFIRM PURCHASE
        else if (data.startsWith('get_premium_app_')) {
            const appId = data.replace('get_premium_app_', '');
            const apps = db.getPremiumApps();
            const app = apps[appId];

            if (!app) {
                bot.answerCallbackQuery(query.id, { text: "❌ App not found", show_alert: true });
                return;
            }

            const price = app.price || 0;

            // If free, give directly
            if (price === 0) {
                // Direct Button
                bot.sendMessage(chatId, `🔥 **${app.name}**\n\nTap below to access:`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '📥 Download / Access', url: app.link }]]
                    }
                });
                return;
            }

            // Ask for confirmation
            bot.editMessageText(`📱 **${app.name}**\n\nPrice: **${price} Credits**\n\nDo you want to purchase access?`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `📥 Buy Access (${price} Cr)`, callback_data: `confirm_app_${appId}` }],
                        [{ text: '🔙 Go Back', callback_data: 'buy_premium_app' }]
                    ]
                }
            });
        }

        // EXECUTE PURCHASE
        else if (data.startsWith('confirm_app_')) {
            const appId = data.replace('confirm_app_', '');
            const apps = db.getPremiumApps();
            const app = apps[appId];

            if (!app) {
                bot.answerCallbackQuery(query.id, { text: "❌ App not found", show_alert: true });
                return;
            }

            const price = app.price || 0;

            if (user.balance < price) {
                return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Balance. Need ${price} cr`, show_alert: true });
            }

            // Deduct
            db.deductCredit(userId, price);

            bot.deleteMessage(chatId, msgId).catch(() => { });

            // Send Link Button
            bot.sendMessage(chatId, `✅ **Purchase Successful!**\n\n📱 **${app.name}**\n💰 Cost: ${price} cr\n\nTap below to access:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '📥 Download / Access', url: app.link }]]
                }
            });
        }

        // TASKS
        else if (data === 'tasks') {
            const tasks = db.getTasks();
            const taskKeys = Object.keys(tasks);

            const markup = [];
            taskKeys.forEach(taskId => {
                const t = tasks[taskId];
                // Only show tasks not done yet
                if (!user.tasksDone.includes(taskId)) {
                    markup.push([{ text: `🔗 ${t.name} (+${t.reward})`, url: t.url }]);
                    markup.push([{ text: `✅ Check: ${t.name}`, callback_data: `check_task_${taskId}` }]);
                }
            });

            if (markup.length === 0) {
                markup.push([{ text: getText(lang, 'noTasks'), callback_data: 'ignore' }]);
            }

            markup.push([{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]);

            bot.editMessageText(getText(lang, 'taskList'), {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: markup },
                parse_mode: 'Markdown'
            });
        }

        // CHECK TASK
        else if (data.startsWith('check_task_')) {
            const taskId = data.replace('check_task_', '');
            const result = db.completeTask(userId, taskId);

            if (result.success) {
                bot.answerCallbackQuery(query.id, { text: `✅ Task Completed! +${result.reward} Credits`, show_alert: true });
                bot.deleteMessage(chatId, msgId).catch(() => { });
                sendMainMenu(chatId, db.getUser(userId));
            } else {
                bot.answerCallbackQuery(query.id, { text: `❌ ${result.msg}`, show_alert: true });
            }
        }

        // BUY CARD (Ensure it's not confirm)
        else if (data.startsWith('buy_card_') && !data.startsWith('buy_card_confirm_')) {
            const serviceId = data.replace('buy_card_', '');
            const serviceName = db.data.serviceNames[serviceId] || serviceId;
            const price = db.data.cardPrices[serviceId] || 0;
            const stock = (db.data.cards[serviceId] || []).length;

            if (stock === 0) {
                bot.answerCallbackQuery(query.id, {
                    text: '❌ Out of stock!',
                    show_alert: true
                });
                return;
            }

            const msg = `💳 **Purchase Card**\n\n` +
                `Service: **${serviceName}**\n` +
                `Price: **${price} Credits**\n` +
                `Your Balance: **${user.balance} Credits**\n` +
                `Stock Available: **${stock}**\n\n` +
                `Confirm purchase?`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Confirm Purchase', callback_data: `buy_card_confirm_${serviceId}` },
                            { text: '❌ Cancel', callback_data: 'buy_cards_menu' }
                        ]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ==================== SUPPORT TICKET SYSTEM ====================



        // CREATE TICKET
        else if (data === 'create_ticket') {
            userState[userId] = { action: 'ticket_subject' };
            bot.sendMessage(chatId,
                `📝 **Create Support Ticket**\n\n` +
                `Step 1: Send the **subject** of your issue\n\n` +
                `Example: "Need help with verification"`,
                { parse_mode: 'Markdown' }
            );
        }

        // MY TICKETS
        else if (data === 'my_tickets') {
            const tickets = db.getTickets(userId);

            if (tickets.length === 0) {
                bot.editMessageText('📂 **Your Tickets**\n\nYou haven\'t created any tickets yet.', {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Create Ticket', callback_data: 'create_ticket' }],
                            [{ text: '🔙 Back', callback_data: 'support_menu' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                let msg = '📂 **Your Support Tickets:**\n\n';
                const buttons = [];

                tickets.reverse().slice(0, 10).forEach(ticket => {
                    const statusEmoji = ticket.status === 'open' ? '🟡' : ticket.status === 'replied' ? '🟢' : '🔵';
                    const date = new Date(ticket.createdAt).toLocaleDateString();
                    msg += `${statusEmoji} **${ticket.id}**\n`;
                    msg += `   Subject: ${ticket.subject}\n`;
                    msg += `   Status: ${ticket.status.toUpperCase()}\n`;
                    msg += `   Date: ${date}\n\n`;

                    buttons.push([{ text: `${statusEmoji} ${ticket.subject}`, callback_data: `view_ticket_${ticket.id}` }]);
                });

                buttons.push([{ text: '🔙 Back', callback_data: 'support_menu' }]);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: 'Markdown'
                });
            }
        }

        // VIEW TICKET
        else if (data.startsWith('view_ticket_')) {
            const ticketId = data.replace('view_ticket_', '');
            const ticket = db.getTicket(ticketId);

            if (!ticket) {
                bot.answerCallbackQuery(query.id, { text: '❌ Ticket not found', show_alert: true });
                return;
            }

            let msg = `🎫 **Ticket Details**\n\n`;
            msg += `ID: \`${ticket.id}\`\n`;
            msg += `Subject: **${ticket.subject}**\n`;
            msg += `Status: **${ticket.status.toUpperCase()}**\n`;
            msg += `Created: ${new Date(ticket.createdAt).toLocaleString()}\n\n`;
            msg += `**Your Message:**\n${ticket.message}\n\n`;

            if (ticket.replies.length > 0) {
                msg += `**Replies:**\n`;
                ticket.replies.forEach((reply, index) => {
                    const sender = reply.isAdmin ? '👤 Admin' : '👨 You';
                    const time = new Date(reply.timestamp).toLocaleString();
                    msg += `\n${sender} (${time}):\n${reply.message}\n`;
                });
            }

            const buttons = [];
            if (ticket.status !== 'closed') {
                buttons.push([{ text: '💬 Reply', callback_data: `reply_ticket_${ticket.id}` }]);
            }
            buttons.push([{ text: '🔙 Back to Tickets', callback_data: 'my_tickets' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // REPLY TO TICKET
        else if (data.startsWith('reply_ticket_')) {
            const ticketId = data.replace('reply_ticket_', '');
            userState[userId] = { action: 'ticket_reply', ticketId: ticketId };
            bot.sendMessage(chatId, '💬 **Reply to Ticket**\n\nSend your message:', { parse_mode: 'Markdown' });
        }

        // TRANSFER CREDITS
        else if (data === 'transfer_init') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'transfer', query)) return;

            const settings = db.getSettings();
            const fee = settings.transferCost || 0;

            bot.editMessageText(`💸 **Transfer Credits**\n\n` +
                `Send credits to another user instantly.\n` +
                `⚠️ Fee: **${fee} Credits** per transaction.\n\n` +
                `Send the **Recipient User ID** to continue:`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'main_menu' }]]
                },
                parse_mode: 'Markdown'
            });

            userState[userId] = { action: 'transfer_input_id' };
        }

        // ==================== PAYMENT GATEWAY ====================



        // MY PAYMENTS
        else if (data === 'my_payments') {
            const payments = db.getPayments(userId);

            if (payments.length === 0) {
                bot.editMessageText('📜 **Payment History**\n\nNo payment records found.', {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💵 Add Balance', callback_data: 'add_balance_menu' }],
                            [{ text: '🔙 Back', callback_data: 'main_menu' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                let msg = '📜 **Your Payment History:**\n\n';

                payments.reverse().slice(0, 10).forEach(payment => {
                    const statusEmoji = payment.status === 'pending' ? '⏳' : payment.status === 'confirmed' ? '✅' : '❌';
                    const date = new Date(payment.createdAt).toLocaleDateString();
                    msg += `${statusEmoji} **${payment.id}**\n`;
                    msg += `   Amount: ${payment.amount} Credits\n`;
                    msg += `   Method: ${payment.method.toUpperCase()}\n`;
                    msg += `   Status: ${payment.status.toUpperCase()}\n`;
                    msg += `   Date: ${date}\n\n`;
                });

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Back', callback_data: 'add_balance_menu' }]]
                    },
                    parse_mode: 'Markdown'
                });
            }
        }

        // ADD BALANCE MENU - Show preset amounts with prices
        else if (data === 'add_balance_menu') {
            const lang = getUserLanguage(userId, db);
            const cryptoRate = db.getCreditRate('crypto');

            let msg = `💳 **Top Up Balance**\n\n`;
            msg += `Current Rate: **${cryptoRate} USDT** per credit\n\n`;
            msg += `Select an amount package:`;

            // Calculate prices for each preset amount
            const amounts = [500, 1000, 2000, 5000];
            const buttons = [];

            for (let i = 0; i < amounts.length; i += 2) {
                const row = [];
                [amounts[i], amounts[i + 1]].forEach(amt => {
                    if (amt) {
                        const price = (amt * cryptoRate).toFixed(2);
                        row.push({
                            text: `💎 ${amt} Cr ($${price})`,
                            callback_data: `pay_select_amount_${amt}`
                        });
                    }
                });
                buttons.push(row);
            }

            buttons.push([{ text: '✏️ Custom Amount', callback_data: 'pay_custom_amount' }]);
            buttons.push([{ text: '📜 Payment History', callback_data: 'my_payments' }]);
            buttons.push([{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // SELECTED AMOUNT - Now show payment methods with calculated price
        else if (data.startsWith('pay_select_amount_')) {
            const amount = data.replace('pay_select_amount_', '');
            userState[userId] = { pendingPaymentAmount: amount };

            const cryptoRate = db.getCreditRate('crypto');
            const totalPrice = (parseInt(amount) * cryptoRate).toFixed(2);

            const methods = db.getSettings().paymentMethods || {};
            let msg = `💳 **Topup ${amount} Credits**\n\n`;
            msg += `Total Cost: **$${totalPrice} USDT**\n\n`;
            msg += `Select a payment method:`;

            const buttons = [];
            Object.keys(methods).forEach(key => {
                const m = methods[key];
                if (m.enabled) {
                    buttons.push([{ text: `💳 ${m.name}`, callback_data: `pay_method_${key}_${amount}` }]);
                }
            });

            buttons.push([{ text: '🔙 Back', callback_data: 'add_balance_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // CUSTOM AMOUNT INPUT - Show calculated price
        else if (data === 'pay_custom_amount') {
            const cryptoRate = db.getCreditRate('crypto');
            userState[userId] = { action: 'pay_custom_amount_input' };
            bot.sendMessage(chatId,
                `✏️ **Enter Custom Amount**\n\n` +
                `Current Rate: **${cryptoRate} USDT** per credit\n\n` +
                `Send the number of credits you want to buy:\n` +
                `(e.g., 500 = $${(500 * cryptoRate).toFixed(2)} USDT)`,
                { parse_mode: 'Markdown' }
            );
            bot.answerCallbackQuery(query.id);
        }

        // PAYMENT METHOD SELECTED (with amount) - Show price details
        else if (data.startsWith('pay_method_')) {
            const parts = data.split('_');
            const amount = parts.pop();
            const key = parts.slice(2).join('_');

            const methods = db.getSettings().paymentMethods || {};
            const method = methods[key];

            if (!method) return bot.answerCallbackQuery(query.id, { text: '❌ Error', show_alert: true });

            const cryptoRate = db.getCreditRate('crypto');
            const totalPrice = (parseInt(amount) * cryptoRate).toFixed(2);

            let detailMsg = `💳 **Payment Details**\n\n` +
                `Credits: **${amount}**\n` +
                `Rate: **${cryptoRate} USDT/credit**\n` +
                `Total: **$${totalPrice} USDT**\n\n` +
                `Method: **${method.name}**\n`;

            if (method.number) detailMsg += `📱 **Number:** \`${method.number}\`\n`;
            if (method.address) detailMsg += `📍 **Address:** \`${method.address}\`\n`;

            detailMsg += `\n⚠️ **Instructions:**\n` +
                `1. Send **$${totalPrice} USDT** to the address above.\n` +
                `2. Keep the Transaction ID (TrxID).\n` +
                `3. Click below to submit TrxID.`;

            userState[userId] = { pendingPayment: { method: key, amount: amount } };

            bot.editMessageText(detailMsg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ I Have Paid', callback_data: `pay_submit_trx` }],
                        [{ text: '🔙 Back', callback_data: `pay_select_amount_${amount}` }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // SUBMIT TRX INIT
        else if (data === 'pay_submit_trx') {
            const state = userState[userId];
            if (!state || !state.pendingPayment) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Session expired. Start again.", show_alert: true });
            }

            userState[userId].action = 'awaiting_trx_id';

            bot.sendMessage(chatId,
                `📝 **Enter Transaction ID**\n\n` +
                `Please send the TrxID now.\n` +
                `Method: ${state.pendingPayment.method.toUpperCase()}\n` +
                `Amount: ${state.pendingPayment.amount} Credits`,
                { parse_mode: 'Markdown' }
            );
            bot.answerCallbackQuery(query.id);
        }

        // REDEEM MENU
        else if (data === 'redeem_menu') {
            // Check if feature is enabled
            if (!checkFeatureEnabled(bot, chatId, userId, 'redeem_code', query)) return;

            userState[userId] = { action: 'awaiting_code' };
            bot.editMessageText('🎟 **Enter Redeem Code:**\n\nSend the code to claim credits.', {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'main_menu' }]] },
                parse_mode: 'Markdown'
            });
        }

        // ==================== LANGUAGE SETTINGS ====================

        // CHANGE LANGUAGE
        else if (data === 'change_language') {
            const currentLang = getUserLanguage(userId, db);

            let msg = '🌍 **Select Language / ভাষা নির্বাচন করুন**\n\n';
            msg += `Current / বর্তমান: **${languages[currentLang].name}**\n\n`;
            msg += 'Choose your preferred language:';

            const buttons = [];
            Object.keys(languages).forEach(lang => {
                const isSelected = lang === currentLang ? '✅ ' : '';
                buttons.push([{
                    text: `${isSelected}${languages[lang].flag} ${languages[lang].name}`,
                    callback_data: `set_lang_${lang}`
                }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // SET LANGUAGE
        else if (data.startsWith('set_lang_')) {
            const lang = data.replace('set_lang_', '');
            db.setLanguage(userId, lang);

            bot.answerCallbackQuery(query.id, {
                text: `✅ Language changed to ${languages[lang].name}!`,
                show_alert: true
            });

            bot.deleteMessage(chatId, msgId).catch(() => { });
            setTimeout(() => sendMainMenu(chatId, db.getUser(userId)), 500);
        }

        // ==================== GMAIL SYSTEM ====================
        else if (data === 'gmail_menu') {
            const gmailCost = db.getGmailCost();

            const msg = `📧 **Email System**\n\n` +
                `Select an option:\n` +
                `• **Temp Mail:** Random disposable email for general use.\n` +
                `• **Service Mail:** Specific emails for services (e.g. Gemini, Netflix).\n\n` +
                `💰 Cost: ${gmailCost} Credits`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🗑 Temp Mail', callback_data: 'gmail_temp_gen' }],
                        [{ text: '🏷 Service Mail', callback_data: 'gmail_service_list' }],
                        [{ text: '🔄 Renew / Last Email', callback_data: 'gmail_renew' }],
                        [{ text: '🔙 Back', callback_data: 'main_menu' }]
                    ]
                }
            });
        }

        // ==================== NUMBER SERVICE SYSTEM ====================
        else if (data === 'number_service_menu') {
            const numServices = db.getNumberServices();
            const serviceList = Object.values(numServices).filter(s => s.status === 'online');

            let msg = `📱 **Number Services Panel**\n\n` +
                `Select a service to generate numbers:`;

            const buttons = [];
            if (serviceList.length === 0) {
                msg += `\n\n🚫 *No services available.*`;
            } else {
                serviceList.forEach(s => {
                    const country = s.countries && s.countries.length > 0 ? s.countries[0].toUpperCase() : 'US';
                    const flag = getFlagEmoji(country);
                    buttons.push([{ text: `${flag} ${s.title} • ${s.cost} Cr`, callback_data: `ns_buy_${s.id}` }]);
                });
            }
            buttons.push([{ text: '🔙 Back', callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }
        else if (data.startsWith('ns_provider_')) {
            const providerId = data.split('ns_provider_')[1];
            const service = db.getNumberServices()[providerId];

            if (!service) {
                bot.answerCallbackQuery(query.id, { text: 'Service unavailable', show_alert: true });
                return;
            }

            const country = service.countries && service.countries.length > 0 ? service.countries[0].toUpperCase() : 'US';
            const flag = getFlagEmoji(country);
            const prefix = getPhoneCode(country);

            const msg = `${flag} **${service.title}**\n\n` +
                `💰 **Price:** ${service.cost} Credits\n` +
                `🌍 **Country:** ${country} (+${prefix})\n` +
                `⚡ **Status:** Online\n\n` +
                `Click **Generate Number** below to order immediately.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎲 Generate Number', callback_data: `ns_buy_${providerId}` }],
                        [{ text: '🔙 Back', callback_data: 'number_service_menu' }]
                    ]
                }
            });
        }
        else if (data.startsWith('ns_buy_')) {
            const providerId = data.split('ns_buy_')[1];
            const service = db.getNumberServices()[providerId];

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: 'Service error or deleted', show_alert: true });
            }

            // 1. Get Gateway
            const gateway = service.gatewayId ? db.getSmsGateways()[service.gatewayId] : null;

            // 2. Prepare Order Data
            let apiId = null;
            let phoneNumber = null;
            let isSimulated = false;

            try {
                if (gateway && gateway.apiHost && gateway.apiHost.startsWith('http')) {
                    // Try Real API Call (Generic RapidAPI / Standard Pattern)
                    // URL: Host + ?api_key=...&action=getNumber&country=...
                    // NOTE: Since endpoint varies, we try a standard GET or fallback.
                    // For now, if Host is just "https://rapidapi.com", this will fail naturally.

                    const response = await axios.get(gateway.apiHost, {
                        params: {
                            api_key: gateway.apiKey,
                            action: 'getNumber',
                            country: service.countryCode,
                            service: 'any' // Default
                        },
                        timeout: 5000 // 5s timeout
                    });

                    const d = response.data;
                    if (d && d.number) {
                        phoneNumber = d.number;
                        apiId = d.id || `API-${Date.now()}`;
                    } else if (d && d.phone) {
                        phoneNumber = d.phone;
                        apiId = d.id || `API-${Date.now()}`;
                    } else if (d && d.value) {
                        phoneNumber = d.value;
                        apiId = d.id || `API-${Date.now()}`;
                    } else if (typeof d === 'string' && d.length > 5) {
                        phoneNumber = d;
                        apiId = `API-${Date.now()}`;
                    } else {
                        throw new Error("Invalid API Response: " + JSON.stringify(d));
                    }
                } else {
                    throw new Error("No Gateway Configured");
                }
            } catch (err) {
                console.error("API Error or No Stock:", err.message);
                return bot.answerCallbackQuery(query.id, { text: '🔜 Service Unavailable / Coming Soon!', show_alert: true });
            }
            if (false) { // DISABLED SIMULATION BLOCK
                // FALLBACK TO SIMULATION (If API fails or not configured)
                // This ensures the user sees the flow working even if API is wrong.
                isSimulated = true;
                const country = service.countries && service.countries.length > 0 ? service.countries[0].toUpperCase() : 'US';
                const prefix = getPhoneCode(country); // e.g., 880, 44, 1

                let randomBody;

                // DATA: Length of phone number (excluding prefix) and optional start digits
                // This ensures "Correct and Exact" numbers for every country.
                switch (prefix) {
                    case '1':   // USA / Canada
                        randomBody = Math.floor(2000000000 + Math.random() * 8000000000).toString(); // 10 digits
                        break;
                    case '44':  // UK
                        randomBody = '7' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits, starts with 7
                        break;
                    case '7':   // Russia / Kazakhstan
                        randomBody = '9' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits, starts with 9
                        break;
                    case '880': // Bangladesh
                        const opBD = ['17', '18', '19', '13', '14', '16', '15'][Math.floor(Math.random() * 7)];
                        randomBody = opBD + Math.floor(10000000 + Math.random() * 90000000).toString(); // 10 digits total
                        break;
                    case '91':  // India
                        const startIN = Math.floor(6 + Math.random() * 4); // 6,7,8,9
                        randomBody = startIN.toString() + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits
                        break;
                    case '62':  // Indonesia
                        randomBody = '8' + Math.floor(Math.random() * 10000000000).toString().slice(0, Math.floor(9 + Math.random() * 2)); // 10-11 digits, starts with 8
                        break;
                    case '86':  // China
                        randomBody = '1' + Math.floor(3000000000 + Math.random() * 7000000000).toString(); // 11 digits, starts with 1
                        break;
                    case '84':  // Vietnam
                        randomBody = '9' + Math.floor(Math.random() * 100000000); // 9 digits
                        break;
                    case '63':  // Philippines
                        randomBody = '9' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits
                        break;
                    case '55':  // Brazil
                        randomBody = '9' + Math.floor(Math.random() * 1000000000).toString().padStart(10, '0'); // 11 digits (Mobile)
                        break;
                    case '20':  // Egypt
                        randomBody = '1' + Math.floor(Math.random() * 100000000).toString().padStart(9, '0'); // 10 digits
                        break;
                    case '92':  // Pakistan
                        randomBody = '3' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits
                        break;
                    case '90':  // Turkey
                        randomBody = '5' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'); // 10 digits
                        break;
                    default:
                        // General Fallback: Generate 10 digits (common globally)
                        randomBody = Math.floor(1000000000 + Math.random() * 9000000000).toString();
                        break;
                }

                phoneNumber = `+${prefix}${randomBody}`;
                apiId = `SIM-${Date.now()}`;
            }

            // 3. Create & Save Order
            const orderId = `ORD-${Date.now().toString().slice(-6)}`;
            const order = {
                id: orderId,
                userId: userId,
                serviceId: service.id,
                serviceName: service.title,
                cost: service.cost,
                phoneNumber: phoneNumber,
                apiId: apiId, // ID from Provider
                gatewayId: service.gatewayId || null,
                status: 'PENDING', // PENDING, COMPLETED, CANCELLED
                smsCode: null,
                startTime: Date.now(),
                isSimulated: isSimulated,
                history: []
            };

            // Deduct Balance (Reserve)
            const user = db.getUser(userId);
            if (user.balance < service.cost) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Insufficient Balance!', show_alert: true });
            }
            // db.updateUser(userId, { balance: user.balance - service.cost }); // Optional: Deduct now or later

            db.saveActiveOrder(order);

            // 4. Send Message
            const buyMsg = `✅ **Number Generated Successfully!**\n\n` +
                `Service: **${service.title}**\n` +
                `Price: **${service.cost} Credits**\n\n` +
                `Phone Number:\n\`${phoneNumber}\`\n` +
                `(Tap to Copy)\n\n` +
                `⏳ *Waiting for SMS...*` +
                (isSimulated ? `\n_(Simulation Mode)_` : ``);

            bot.editMessageText(buyMsg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📥 Inbox', callback_data: `ns_check_${orderId}` }, { text: '📨 Read SMS', callback_data: `ns_view_${orderId}` }],
                        [{ text: '⚡ New Number', callback_data: `ns_buy_${service.id}` }],
                        [{ text: '🔙 Back', callback_data: 'number_service_menu' }]
                    ]
                }
            });
        }
        else if (data.startsWith('ns_check_')) {
            const orderId = data.split('ns_check_')[1];
            const order = db.getActiveOrders()[orderId];

            if (!order) return bot.answerCallbackQuery(query.id, { text: '❌ Order not found or expired.', show_alert: true });

            if (!order) return bot.answerCallbackQuery(query.id, { text: '❌ Order not found or expired.', show_alert: true });

            // REMOVED BLOCKING CHECK
            // We want to continue to check for NEW messages even if we have one.

            // CHECK LOGIC
            let newCode = null;
            let fullText = null;

            // FORCE REAL API CHECK (Simulation Removed)
            if (true) {
                // Real API Check
                try {
                    const gateway = db.getSmsGateways()[order.gatewayId];
                    if (gateway) {
                        const response = await axios.get(gateway.apiHost, {
                            params: {
                                api_key: gateway.apiKey,
                                action: 'getSMS',
                                id: order.apiId
                            },
                            timeout: 5000
                        });

                        const d = response.data;
                        if (d) {
                            if (d.sms) {
                                newCode = d.sms;
                                // FORCE FULL TEXT if missing
                                fullText = d.text || `Your verification code is ${newCode}. Do not share this code with anyone.`;
                            } else if (d.text) {
                                fullText = d.text;
                                const match = fullText.match(/\d{4,8}/);
                                if (match) newCode = match[0];
                            } else if (typeof d === 'string' && /^\d+$/.test(d)) {
                                newCode = d;
                            }
                        }
                    }
                } catch (e) {
                    console.error("API Check Failed:", e.message);
                }
            }


            // KEYWORD FILTERING / SPAM PROTECTION
            if (newCode) {
                const service = db.getNumberServices()[order.serviceId];
                if (service) {
                    const titleLower = service.title.toLowerCase();
                    const filters = {
                        'facebook': ['facebook', 'fb', 'meta'],
                        'whatsapp': ['whatsapp', 'wa'],
                        'telegram': ['telegram', 'tg', 'teiegram'],
                        'tiktok': ['tiktok'],
                        'instagram': ['instagram', 'ig', 'meta'],
                        'google': ['google', 'gmail', 'youtube'],
                        'discord': ['discord'],
                        'microsoft': ['microsoft', 'office'],
                        'snapchat': ['snapchat'],
                        'twitter': ['twitter', 'x.com', 'x corp'],
                        'uber': ['uber'],
                        'amazon': ['amazon', 'aws'],
                        'netflix': ['netflix'],
                        'apple': ['apple', 'icloud', 'itunes'],
                        'imo': ['imo'],
                        'line': ['line'],
                        'viber': ['viber'],
                        'wechat': ['wechat', 'tencent']
                    };

                    let requiredKeywords = [];
                    for (const [app, keywords] of Object.entries(filters)) {
                        // Check keys AND values (so "FB" in title matches "facebook" filter)
                        if (titleLower.includes(app) || keywords.some(k => titleLower.includes(k))) {
                            requiredKeywords.push(...keywords);
                            // Add the app name itself if not in keywords
                            if (!requiredKeywords.includes(app)) requiredKeywords.push(app);
                        }
                    }

                    // If filters apply, check the message
                    if (requiredKeywords.length > 0) {
                        const textLower = (fullText || '').toLowerCase();
                        const matchFound = requiredKeywords.some(k => textLower.includes(k));

                        if (!matchFound) {
                            console.log(`[Filter] 🛡️ Ignored Spam SMS for ${service.title}: "${fullText}"`);
                            newCode = null; // DISCARD
                        }
                    }
                }
            }

            if (newCode) {
                // Prevent duplicates if same code returned
                if (order.smsCode === newCode && (!order.history || order.history.length > 0 && order.history[0].code === newCode)) {
                    return bot.answerCallbackQuery(query.id, { text: `✅ Latest Code: ${newCode}`, show_alert: true });
                }

                // Add to history
                const entry = { code: newCode, text: fullText || newCode, time: Date.now() };
                const newHistory = [entry, ...(order.history || [])].slice(0, 5);

                // UPDATE ORDER
                db.updateActiveOrder(orderId, {
                    smsCode: newCode,
                    fullMessage: fullText || newCode,
                    history: newHistory,
                    status: 'ACTIVE' // Stay Active
                });

                // GENERATE MESSAGE LIST
                let codesDisplay = "";
                newHistory.forEach((h, i) => {
                    codesDisplay += `📩 **From ${i === 0 ? 'Latest' : 'Prev'}:** \`${h.code}\`\n`;
                });

                const service = db.getNumberServices()[order.serviceId];
                const msg = `✅ **INBOX REFRESHED!**\n\n` +
                    `Service: **${service ? service.title : 'Unknown'}**\n` +
                    `Number: \`${order.phoneNumber}\`\n\n` +
                    `📥 **Messages:**\n${codesDisplay}\n` +
                    `Click **Read SMS** to see content.`;

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📥 Inbox', callback_data: `ns_check_${orderId}` }, { text: '📨 Read SMS', callback_data: `ns_view_${orderId}` }],
                            [{ text: '⚡ New Number', callback_data: `ns_buy_${service.id}` }],
                            [{ text: '🔙 Back', callback_data: 'number_service_menu' }]
                        ]
                    }
                });

                // Notify User
                bot.answerCallbackQuery(query.id, { text: `✅ New Code: ${newCode}`, show_alert: true });

            } else {
                // STILL WAITING
                bot.answerCallbackQuery(query.id, { text: '⏳ Waiting for SMS... (Click again in 5s)', show_alert: true });
            }
        }
        else if (data.startsWith('ns_view_')) {
            const orderId = data.split('ns_view_')[1];
            const order = db.getActiveOrders()[orderId];

            if (!order) return bot.answerCallbackQuery(query.id, { text: '❌ Order not found.', show_alert: true });

            if (order.fullMessage || (order.history && order.history.length > 0)) {
                // Get Latest Message
                const latest = (order.history && order.history.length > 0) ? order.history[0] : { text: order.fullMessage, code: order.smsCode, time: Date.now() };

                const timeStr = new Date(latest.time || Date.now()).toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
                const dateStr = new Date(latest.time || Date.now()).toLocaleDateString('en-CA'); // YYYY-MM-DD

                const msg = `✅ **OTP Received!**\n\n` +
                    `⏰ Time: \`${dateStr} ${timeStr}\`\n` +
                    `📞 Number: \`${order.phoneNumber}\`\n\n` +
                    `🔑 OTP Code: \`${latest.code || order.smsCode}\`\n\n` +
                    `⚙️ Service: **${order.serviceName}**\n\n` +
                    `📖 **Full Message:**\n` +
                    `> ${latest.text || order.fullMessage}`;

                bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                bot.answerCallbackQuery(query.id); // Clear loading state
            } else {
                bot.answerCallbackQuery(query.id, { text: '📭 Inbox is empty. Waiting for SMS...', show_alert: true });
            }
        }


        // ==================== NEW ADMIN GATEWAY SYSTEM ====================

        // ADMIN MANAGE NUMBERS (GATEWAYS MENU)
        else if (data === 'admin_manage_numbers') {
            if (!isAdmin(userId)) return;

            const gateways = db.getSmsGateways();
            const list = Object.values(gateways);

            let msg = `🏢 **SMS Gateways (Providers)**\n\n` +
                `Configure your API connections here.\n` +
                `Then add Services (Countries) under each Gateway.`;

            const buttons = [];
            if (list.length === 0) {
                msg += `\n\n_No API Gateways configured._`;
            } else {
                list.forEach(g => {
                    buttons.push([{ text: `🔌 ${g.name}`, callback_data: `admin_gateway_view_${g.id}` }]);
                });
            }
            buttons.push([{ text: '➕ Add New Gateway', callback_data: 'admin_gateway_add' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // VIEW GATEWAY
        else if (data.startsWith('admin_gateway_view_')) {
            const id = data.split('admin_gateway_view_')[1];
            const gateway = db.getSmsGateways()[id];

            if (!gateway) return bot.answerCallbackQuery(query.id, { text: 'Gateway not found', show_alert: true });

            const allServices = db.getNumberServices();
            const linkedServices = Object.values(allServices).filter(s => s.gatewayId === id);

            let msg = `🔌 **Gateway: ${gateway.name}**\n\n` +
                `🔑 **Host:** \`${gateway.apiHost || 'N/A'}\`\n` +
                `📦 **Linked Services:** ${linkedServices.length}\n\n` +
                `Select a Service to Manage or Add New:`;

            const buttons = [];
            linkedServices.forEach(s => {
                buttons.push([
                    { text: `🗑 Del`, callback_data: `admin_ns_del_${s.id}` },
                    { text: `🇧🇩 ${s.title} (${s.countryCode})`, callback_data: 'noop' }
                ]);
            });

            buttons.push([{ text: '➕ Add Country Service', callback_data: `admin_service_add_${id}` }]);
            buttons.push([{ text: '🗑 Delete Gateway', callback_data: `admin_gateway_del_${id}` }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_manage_numbers' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // START ADD GATEWAY WIZARD
        else if (data === 'admin_gateway_add') {
            userState[userId] = { action: 'admin_gw_name', data: {} };
            bot.sendMessage(chatId, `➕ **Add New SMS Gateway**\n\nEnter a **Name** for this provider:\n(e.g. "RapidAPI Main")`, { parse_mode: 'Markdown' });
        }

        // START ADD SERVICE WIZARD
        else if (data.startsWith('admin_service_add_')) {
            const gatewayId = data.split('admin_service_add_')[1];
            userState[userId] = { action: 'admin_svc_title', data: { gatewayId } };
            bot.sendMessage(chatId, `➕ **Add Country Service**\n\nEnter the **Display Name**:\n(e.g. "🇺🇸 United States")`, { parse_mode: 'Markdown' });
        }

        // DELETE GATEWAY
        else if (data.startsWith('admin_gateway_del_')) {
            const id = data.split('admin_gateway_del_')[1];
            db.deleteSmsGateway(id);
            bot.answerCallbackQuery(query.id, { text: '🗑 Gateway Deleted!', show_alert: true });

            // Refresh list (Copy logic from admin_manage_numbers)
            const gateways = db.getSmsGateways();
            const list = Object.values(gateways);
            let msg = `🏢 **SMS Gateways (Providers)**\n\nGateway deleted.`;
            const buttons = [];
            list.forEach(g => {
                buttons.push([{ text: `🔌 ${g.name}`, callback_data: `admin_gateway_view_${g.id}` }]);
            });
            buttons.push([{ text: '➕ Add New Gateway', callback_data: 'admin_gateway_add' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN MANAGE NUMBERS (OLD/DEPRECATED)
        else if (data === 'admin_manage_numbers_OLD') {
            if (!isAdmin(userId)) return;

            const providerCount = Object.keys(db.getNumberServices()).length;

            bot.editMessageText(`📱 **Manage Number Services**\n\n` +
                `Current Providers: **${providerCount}**\n\n` +
                `Select an action:`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 List Providers', callback_data: 'admin_ns_list' }],
                        [{ text: '➕ Add Provider', callback_data: 'admin_ns_add' }],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                }
            });
        }

        // ADMIN LIST PROVIDERS
        else if (data === 'admin_ns_list') {
            const services = db.getNumberServices();
            const serviceList = Object.values(services);

            const btnList = [];
            if (serviceList.length === 0) {
                btnList.push([{ text: 'No providers found', callback_data: 'noop' }]);
            } else {
                serviceList.forEach(s => {
                    btnList.push([
                        { text: `🗑 Del`, callback_data: `admin_ns_del_${s.id}` },
                        { text: `${s.title} ($${s.cost})`, callback_data: 'noop' }
                    ]);
                });
            }
            btnList.push([{ text: '🔙 Back', callback_data: 'admin_manage_numbers' }]);

            bot.editMessageText(`📋 **Provider List**\n\nTap 'Del' to remove immediately.`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: btnList }
            });
        }

        // ADMIN DELETE PROVIDER
        else if (data.startsWith('admin_ns_del_')) {
            const id = data.split('admin_ns_del_')[1];
            db.deleteNumberService(id);
            bot.answerCallbackQuery(query.id, { text: '🗑 Provider Deleted!', show_alert: true });

            // Refresh list
            const services = db.getNumberServices();
            const serviceList = Object.values(services);
            const btnList = [];
            if (serviceList.length === 0) {
                btnList.push([{ text: 'No providers found', callback_data: 'noop' }]);
            } else {
                serviceList.forEach(s => {
                    btnList.push([
                        { text: `🗑 Del`, callback_data: `admin_ns_del_${s.id}` },
                        { text: `${s.title} ($${s.cost})`, callback_data: 'noop' }
                    ]);
                });
            }
            btnList.push([{ text: '🔙 Back', callback_data: 'admin_manage_numbers' }]);

            bot.editMessageText(`📋 **Provider List**\n\nTap 'Del' to remove immediately.`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: btnList }
            });
        }

        // ADMIN ADD PROVIDER (Step 1)
        else if (data === 'admin_ns_add') {
            userState[userId] = { action: 'admin_ns_title', data: {} };
            bot.sendMessage(chatId, `➕ **Add New Country Service**\n\nEnter the **Display Name** for this country/service:\n(e.g. "🇺🇸 United States")`, { parse_mode: 'Markdown' });
        }

        // SERVICE MAIL LIST
        else if (data === 'gmail_service_list') {
            const services = db.getEmailServices();
            const serviceIds = Object.keys(services);

            if (serviceIds.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: '⚠️ No services available yet!', show_alert: true });
            }

            const msg = `🏷 <b>Service Mail</b>\n\nSelect a service to get a unique email for:`;
            const buttons = [];

            serviceIds.forEach(id => {
                const s = services[id];
                buttons.push([{ text: `${s.name} (${s.price} Cr)`, callback_data: `gmail_service_${id}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'gmail_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // TEMP MAIL GENERATOR
        // TEMP MAIL GENERATOR
        else if (data === 'gmail_temp_gen') {
            const cost = db.getGmailCost();
            if (user.balance < cost) {
                return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Credits! Need ${cost}`, show_alert: true });
            }

            // COOLDOWN CHECK (Rate Limiting)
            const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
            if (user.tempMailCooldown && (Date.now() - user.tempMailCooldown) < COOLDOWN_MS) {
                const remainingMs = COOLDOWN_MS - (Date.now() - user.tempMailCooldown);
                const remainingMin = Math.ceil(remainingMs / 60000);

                const cooldownMsg = `⚠️ <b>System Busy</b>\n\n` +
                    `Please wait ${remainingMin} minute(s) and try again.\n\n` +
                    `<i>Our email system is processing requests.</i>`;

                return bot.editMessageText(cooldownMsg, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Try Again', callback_data: 'gmail_temp_gen' }]
                        ]
                    }
                });
            }

            // 1. Check Custom Gateways (Admin Configured)
            const gateways = db.getEmailGateways();
            const gatewayIds = Object.keys(gateways);
            let apiAccount = null;

            if (gatewayIds.length > 0) {
                // Use first available gateway for now (Random selection logic could be added)
                const gw = gateways[gatewayIds[0]];
                try {
                    // Generic API Call pattern: host?api_key=...&action=getEmail
                    // Expected response: { email: "...", id: "...", token: "..." }
                    const response = await axios.get(gw.apiHost, {
                        params: {
                            api_key: gw.apiKey,
                            action: 'getEmail'
                        },
                        timeout: 8000
                    });

                    if (response.data && response.data.email) {
                        apiAccount = {
                            email: response.data.email,
                            token: response.data.token || response.data.id, // Store ID/Token for checking
                            password: 'API-Managed',
                            source: 'custom_gateway',
                            gatewayId: gw.id,
                            date: new Date().toISOString()
                        };
                    }
                } catch (err) {
                    console.error(`[Gmail] Gateway Error (${gw.name}):`, err.message);
                }
            }

            // 2. Fallback to Built-in Providers
            if (!apiAccount) {
                const providers = require('./services/tempmail-providers.js');
                apiAccount = await providers.createAccount();
            }

            if (!apiAccount) {
                const failMsg = `⚠️ <b>System Currently Busy</b>


` +
                    `Please wait a short time and try again.

` +
                    `<i>Thank you for your patience.</i>`;

                // Set cooldown on failure to prevent spam
                user.tempMailCooldown = Date.now();
                db.updateUser(user);

                return bot.editMessageText(failMsg, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Try Again', callback_data: 'gmail_temp_gen' }]
                        ]
                    }
                });
            }

            const account = {
                email: apiAccount.email,
                password: apiAccount.password || 'N/A',
                token: apiAccount.token,
                date: new Date().toISOString(),
                source: apiAccount.provider || apiAccount.source,
                service: 'temp'
            };

            db.addGmail(account.email, account.password);
            const saved = db.getGmail(account.email);
            if (saved) {
                saved.assignedTo = userId;
                saved.source = account.source;
                saved.service = 'temp';
                saved.token = apiAccount.token;
                db.save();
            }

            db.addCredit(userId, -cost);

            // Clear cooldown on success
            if (user.tempMailCooldown) {
                user.tempMailCooldown = null;
                db.updateUser(user);
            }

            const msg = `✅ <b>Temp Mail Generated</b>\n\n` +
                `💰 <b>Cost:</b> -${cost} Credits\n\n` +
                `📧 <b>Email:</b> <code>${account.email}</code>\n\n` +
                `👇 Click check below for OTP.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔢 Get OTP', callback_data: `check_otp_${account.email}` }, { text: '📨 Read Email', callback_data: `check_full_sms_${account.email}` }],
                        [{ text: '⚡ New Email', callback_data: 'gmail_temp_gen' }],
                        [{ text: '🔙 Main Menu', callback_data: 'gmail_menu' }]
                    ]
                }
            });
        }

        // SERVICE SELECTION HANDLER
        else if (data.startsWith('gmail_service_')) {
            const serviceId = data.replace('gmail_service_', '');
            const services = db.getEmailServices();

            // Handle 'general' explicitly or just look up
            let service = services[serviceId];

            // Fallback for general/random if not defined
            if (!service && serviceId === 'general') {
                service = { name: 'General Email', price: db.getGmailCost(), stock: [], id: 'general' };
            }

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Service not found', show_alert: true });
            }

            const stockCount = service.stock ? service.stock.length : 0;
            const msg = `📧 <b>${service.name}</b>\n\n` +
                `💰 Price: <b>${service.price} Credits</b>\n` +
                `📦 Stock: <b>${stockCount > 0 ? stockCount : 'Empty (Wait for Admin)'}</b>\n\n` +
                `Click Generate to get a fresh email for this service.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Generate Email', callback_data: `gmail_gen_${serviceId}` }],
                        [{ text: '🔙 Back', callback_data: 'gmail_service_list' }]
                    ]
                }
            });
        }
        else if (data.startsWith('gmail_gen_')) {
            const serviceId = data.replace('gmail_gen_', '');
            const services = db.getEmailServices();

            // Handle 'general' explicitly
            let service = services[serviceId];
            if (!service && serviceId === 'general') {
                service = { name: 'General Email', price: db.getGmailCost(), stock: [], id: 'general' };
            }

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Service not found', show_alert: true });
            }

            const cost = service.price;

            // 1. Check Balance
            if (user.balance < cost) {
                return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Credits! Need ${cost}`, show_alert: true });
            }

            // 2. Try to get from Stock (Unique per user)
            let account = db.getAvailableEmailForUser(userId, serviceId);

            // 3. If no stock, try API (if configured/allowed)
            // For now, let's allow API fallback for ANY service if stock is empty, OR restricts it.
            // User requirement: "Admin's customer post... only generated email".
            // If stock is empty, we should probably fail unless it's 'General' or specific config.
            // Let's assume fallback is okay for now, using the service name as tag or just random.

            if (!account) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Out of Stock! Contact Admin.', show_alert: true });
            }

            // 3. Deduct Balance
            db.addCredit(userId, -cost);

            const msg = `✅ <b>Generated for ${service.name}</b>\n\n` +
                `📧 <b>Email:</b> <code>${account.email}</code>\n` +
                `💰 <b>Cost:</b> -${cost} Credits\n\n` +
                `👇 Click below to check for OTP codes/messages directly.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔢 Get OTP', callback_data: `check_otp_${account.email}` }],
                        [{ text: '📨 Read Email', callback_data: `check_full_sms_${account.email}` }],
                        [{ text: '🔙 Back', callback_data: `gmail_service_${serviceId}` }],
                        [{ text: '📧 Service List', callback_data: 'gmail_service_list' }]
                    ]
                }
            });
        }
        // CHECK OTP DYNAMIC HANDLER
        else if (data.startsWith('check_otp_')) {
            const email = data.replace('check_otp_', '');
            const account = db.getGmail(email);

            if (!account) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Email not found', show_alert: true });
            }

            // Ensure history array exists
            if (!account.history) account.history = [];

            let otpMsg = '';
            let newOtpFound = false;

            // Multi-Provider Support (Mail.tm, 1SecMail, TMailor, etc.)
            if (account.source && account.token) {
                const providers = require('./services/tempmail-providers.js');
                const result = await providers.getOtp(account.token, account.source);

                if (result) {
                    if (result.otp) {
                        // Check if this OTP is new (not in history)
                        const isNew = !account.history.some(h => h.code === result.otp);
                        if (isNew) {
                            account.otp = result.otp;
                            account.otpTime = new Date().getTime();
                            account.history.unshift({ code: result.otp, time: account.otpTime, sender: result.sender });
                            if (account.history.length > 5) account.history.pop(); // Keep last 5
                            db.save();
                            newOtpFound = true;
                        }
                    }
                    // (Handling text-only emails could be added to history too if needed)
                }
            }
            // 2. OAuth Integration
            else if (account.oauth && account.refreshToken) {
                const message = await oauth.getLatestEmail(account.refreshToken);
                if (message) {
                    const otpMatch = message.text.match(/\b\d{4,8}\b/);
                    if (otpMatch) {
                        const code = otpMatch[0];
                        const isNew = !account.history.some(h => h.code === code);
                        if (isNew) {
                            account.otp = code;
                            account.otpTime = new Date(message.date).getTime();
                            account.history.unshift({ code: code, time: account.otpTime, sender: message.sender || 'Service' });
                            if (account.history.length > 5) account.history.pop();
                            db.save();
                            newOtpFound = true;
                        }
                    }
                }
            }
            // 3. OAuth Alias
            else if (!account.password && !account.oauth) {
                // ... (Alias logic would need similar history update)
                // Keeping it simple for now or copying history logic if heavily used.
                const connectedAccounts = db.getGmails().filter(g => g.oauth && g.refreshToken);

                if (connectedAccounts.length > 0) {
                    // Check all accounts in parallel
                    let foundMessage = null;
                    try {
                        const checks = connectedAccounts.map(g => oauth.getLatestEmail(g.refreshToken, account.email));
                        const results = await Promise.all(checks);
                        foundMessage = results.find(msg => msg !== null);
                    } catch (e) {
                        console.error("Error checking oauth aliases:", e);
                    }

                    if (foundMessage) {
                        const message = foundMessage;
                        const otpMatch = message.text.match(/\b\d{4,8}\b/);
                        if (otpMatch) {
                            const code = otpMatch[0];
                            const isNew = !account.history.some(h => h.code === code);
                            if (isNew) {
                                account.otp = code;
                                account.otpTime = new Date(message.date).getTime();
                                account.history.unshift({ code: code, time: account.otpTime, sender: message.sender || 'Service' });
                                if (account.history.length > 5) account.history.pop();
                                db.save();
                                newOtpFound = true;
                            }
                        }
                    }
                }
            }
            // 4. Fallback (This section is now mostly covered by history display)
            // If no new OTP was found by the above, and history is empty, then show a waiting message.

            // Construct Message from History
            // Construct Message from History
            if (account.history && account.history.length > 0) {
                otpMsg = `\n<b>📬 Inbox (Latest 5):</b>\n\n`;
                account.history.forEach((h, i) => {
                    const time = new Date(h.time || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
                    // Format: Icon Time -> Newline -> Code (Monospace for easy copy)
                    otpMsg += `${i === 0 ? '🟢' : '⚪'} ${time}\n<code>${h.code}</code>\n\n`;
                });
            } else {
                otpMsg = `\n⏳ <b>No OTPs received yet.</b>\nWaiting for new emails...`;
            }

            const msg = `📧 <b>OTP Inbox</b>\n\n` +
                `<b>Email Address:</b>\n` +
                `<code>${account.email}</code>\n` +
                `(Tap to Copy)\n` +
                `${otpMsg}`;

            if (newOtpFound) {
                bot.answerCallbackQuery(query.id, { text: `✅ New OTP: ${account.otp}`, show_alert: true });
            } else {
                bot.answerCallbackQuery(query.id, { text: '🔄 Inbox Refreshed (No new OTP)', show_alert: false });
            }

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh Inbox', callback_data: `check_otp_${email}` }, { text: '📨 Read Email', callback_data: `check_full_sms_${email}` }],
                        [{ text: '⚡ New Email', callback_data: 'gmail_temp_gen' }],
                        [{ text: '🔙 Main Menu', callback_data: 'gmail_menu' }]
                    ]
                }
            });
        }

        // CHECK FULL SMS HANDLER
        else if (data.startsWith('check_full_sms_')) {
            const email = data.replace('check_full_sms_', '');
            const account = db.getGmail(email);

            if (!account) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Email not found', show_alert: true });
            }

            let fullMsg = '⏳ <b>No messages found yet.</b>';

            if (account.token) {
                // Using generic temp mail checker
                const result = await tempMail.getOtp(account.token, account.email);
                if (result) {
                    // Sanitize HTML a bit or just use text
                    // Telegram HTML supports: b, i, u, s, a, code, pre
                    // We'll use text to avoid breaking HTML, but wrap links if possible?
                    // Let's just dump the text content.
                    const content = result.text || 'No text content.';
                    const preview = content.length > 3500 ? content.substring(0, 3500) + '... (Truncated)' : content;

                    fullMsg = `📩 <b>Full Message</b>\n\n` +
                        `<b>Subject:</b> ${result.subject}\n` +
                        `<b>Date:</b> ${new Date(result.date).toLocaleString()}\n\n` +
                        `====================\n` +
                        `${preview}\n` +
                        `====================`;
                }
            } else if (account.oauth && account.refreshToken) {
                const message = await oauth.getLatestEmail(account.refreshToken);
                if (message) {
                    const content = message.text || 'No text content.';
                    const preview = content.length > 3500 ? content.substring(0, 3500) + '... (Truncated)' : content;

                    fullMsg = `📩 <b>Full Message</b>\n\n` +
                        `<b>Subject:</b> ${message.subject}\n` +
                        `<b>Date:</b> ${message.date}\n\n` +
                        `====================\n` +
                        `${preview}\n` +
                        `====================`;
                } else {
                    fullMsg = `⏳ <b>No new unread emails found.</b>`;
                }
            } else {
                fullMsg = `⚠️ <b>Full SMS not supported for this account type.</b>\nTry checking OTP only.`;
            }

            bot.editMessageText(fullMsg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML', // Warning: ensure text doesn't contain unescaped < >
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📩 Back to OTP', callback_data: `check_otp_${email}` }],
                        [{ text: '🔙 Menu', callback_data: 'gmail_menu' }]
                    ]
                }
            }).catch(async (e) => {
                // Fallback if HTML fails (often due to special chars in email body)
                await bot.editMessageText(fullMsg.replace(/<[^>]*>/g, ''), {
                    chat_id: chatId,
                    message_id: msgId,
                    remove_keyboard: true
                });
                bot.sendMessage(chatId, "⚠️ Message displayed as raw text due to formatting issues.", {
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 Back', callback_data: `check_otp_${email}` }]]
                    }
                });
            });
        }
        else if (data === 'gmail_otp') {
            const account = db.getUserLastGmail(userId);
            if (!account) {
                bot.answerCallbackQuery(query.id, { text: '❌ No Gmail found for you!', show_alert: true });
                return;
            }

            let otpMsg = '';

            // Check API if source is smtplabs
            if (account.source === 'smtplabs' || account.email.includes('@smtp.dev')) { // fallback check
                const apiOtp = await getSmtpLabsOtp(account.email, account.accountId, account.mailboxId);
                if (apiOtp) {
                    account.otp = apiOtp.otp;
                    account.otpTime = apiOtp.date || Date.now();
                    db.save(); // Cache it
                }
            }

            otpMsg = account.otp ? `🔢 <b>OTP:</b> <code>${account.otp}</code>\n🕒 Received: ${new Date(account.otpTime).toLocaleString()}` : `⏳ <b>No OTP received yet.</b>\nTry again later.`;

            const msg = `📧 <b>Gmail OTP Check</b>\n\n` +
                `Email: <code>${account.email}</code>\n\n` +
                `${otpMsg}`;

            // Add Refresh Button
            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'gmail_otp' }],
                        [{ text: '🔙 Back', callback_data: 'gmail_menu' }]
                    ]
                }
            });
        }
        else if (data === 'gmail_renew') {

            const account = db.getUserLastGmail(userId);

            if (!account) {
                return bot.answerCallbackQuery(query.id, {
                    text: '❌ No previous Gmail found! Please generate a new one first.',
                    show_alert: true
                });
            }

            let otpMsg = account.otp
                ? `🔢 <b>OTP:</b> <code>${account.otp}</code>\n🕒 Received: ${new Date(account.otpTime).toLocaleString()}`
                : `⏳ <b>No OTP received yet.</b>\nWaiting for message...`;

            // If it's an API account, maybe try to fetch latest OTP now?
            // Optional: trigger a fetch here if needed, but 'Check OTP' button does that too.

            const msg = `🔄 <b>Renew / Last Gmail</b>\n\n` +
                `📧 <b>Email:</b> <code>${account.email}</code>\n` +
                `📅 <b>Generated:</b> ${new Date(account.date).toLocaleDateString()}\n\n` +
                `${otpMsg}\n\n` +
                `👇 Click below to check for new messages.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📩 Check OTP / Refresh', callback_data: `check_otp_${account.email}` }],
                        [{ text: '📨 Check SMS', callback_data: `check_full_sms_${account.email}` }],
                        [{ text: '🆕 Generate New', callback_data: 'gmail_menu' }],
                        [{ text: '🔙 Back', callback_data: 'gmail_menu' }]
                    ]
                }
            });
        }

        // ==================== FILE UPLOAD (ADMIN) ====================

        // FILE UPLOAD MENU
        else if (data === 'admin_upload_file') {
            if (!isAdmin(userId)) return;

            const msg = `📂 **Bulk Upload System**\n\n` +
                `Upload a text file to add multiple items at once.\n\n` +
                `**Supported formats:**\n` +
                `• **Cards:** One card per line (State|City|Address|Zip|Number|Exp|CVV)\n` +
                `• **Codes:** Code Amount Uses (e.g., WELCOME100 500 10)\n\n` +
                `Select upload type:`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Upload Cards File', callback_data: 'upload_cards_file' }],
                        [{ text: '🎟 Upload Codes File', callback_data: 'upload_codes_file' }],
                        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ==================== EMAIL GATEWAYS ADMIN ====================

        // MANAGE GATEWAYS LIST
        else if (data === 'admin_manage_email_gateways') {
            if (!isAdmin(userId)) return;

            const gateways = db.getEmailGateways();
            const list = Object.keys(gateways);

            let msg = `🔌 **Email Gateways (API)**\n\n` +
                `Configure external APIs for Temp Mail usage.\n` +
                `The system will prioritize these gateways over built-in providers.\n\n` +
                `**Active Gateways:** ${list.length}`;

            const buttons = [];
            list.forEach(id => {
                const gw = gateways[id];
                buttons.push([{ text: `🗑 Del ${gw.name}`, callback_data: `admin_del_email_gw_${id}` }]);
                msg += `\n• **${gw.name}**\n  Host: \`${gw.apiHost}\`\n  Key: ...${gw.apiKey.slice(-4)}\n`;
            });

            buttons.push([{ text: '➕ Add New Gateway', callback_data: 'admin_add_email_gw' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_gmail_services' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADD GATEWAY START
        else if (data === 'admin_add_email_gw') {
            userState[userId] = { action: 'admin_email_gw_input' };
            bot.sendMessage(chatId, `➕ **Add Email Gateway**\n\nFormat:\n\`Name|API_Host|API_Key\`\n\nExample:\n\`MyAPI|https://api.mysite.com/v1|secret_key_123\``, { parse_mode: 'Markdown' });
        }

        // DELETE GATEWAY
        else if (data.startsWith('admin_del_email_gw_')) {
            const id = data.replace('admin_del_email_gw_', '');
            db.deleteEmailGateway(id);
            bot.answerCallbackQuery(query.id, { text: "✅ Gateway Deleted", show_alert: true });

            // Refresh
            setTimeout(() => {
                bot.emit('callback_query', { ...query, data: 'admin_manage_email_gateways', id: query.id + '_ref' });
            }, 200);
        }

        // UPLOAD CARDS FILE
        else if (data === 'upload_cards_file') {
            if (!isAdmin(userId)) return;

            userState[userId] = { action: 'upload_cards_file' };
            bot.sendMessage(chatId,
                `💳 **Upload Cards File**\n\n` +
                `Send a .txt file with cards.\n\n` +
                `Format (one per line):\n` +
                `\`State|City|Address|Zip|CardNum|Exp|CVV\`\n\n` +
                `Example:\n` +
                `\`CA|Los Angeles|123 Main St|90001|4111111111111111|12/25|123\``,
                { parse_mode: 'Markdown' }
            );
        }

        // UPLOAD CODES FILE
        else if (data === 'upload_codes_file') {
            if (!isAdmin(userId)) return;

            userState[userId] = { action: 'upload_codes_file' };
            bot.sendMessage(chatId,
                `🎟 **Upload Codes File**\n\n` +
                `Send a .txt file with promo codes.\n\n` +
                `Format (one per line):\n` +
                `\`CODE AMOUNT USES\`\n\n` +
                `Example:\n` +
                `\`WELCOME100 500 10\`\n` +
                `\`MEGA2000 2000 1\``,
                { parse_mode: 'Markdown' }
            );
        }

        // ==================== ADMIN PANEL ====================

        // ADMIN PANEL MAIN
        else if (data === 'admin_panel') {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ Admin Access Only", show_alert: true });
            }

            // Delete previous message to avoid edit errors
            bot.deleteMessage(chatId, msgId).catch(() => { });

            const msg = `⚙️ <b>Admin Panel</b>\n\nManage your bot from here:`;

            bot.sendMessage(chatId, msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Manage Payments', callback_data: 'admin_payments' }],
                        [{ text: '⚙️ Bot Settings', callback_data: 'admin_settings' }],
                        [{ text: '🗄️ Database / Storage', callback_data: 'admin_database' }],
                        [{ text: '💾 Backup & Restore', callback_data: 'admin_backup' }],
                        [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }],
                        [{ text: '🔘 Button Management', callback_data: 'admin_button_management' }],
                        [{ text: '👥 Manage Users', callback_data: 'admin_manage_user' }],
                        [{ text: '📋 Manage Tasks', callback_data: 'admin_manage_tasks' }],
                        [{ text: '👮 Group Controller', callback_data: 'admin_group_controller' }],
                        [{ text: '💳 Manage Cards', callback_data: 'admin_manage_cards' }],
                        [{ text: '🔒 Manage VPN', callback_data: 'admin_manage_vpn' }],
                        [{ text: '📧 Manage Gmails', callback_data: 'admin_manage_gmails' }],
                        [{ text: '📱 Manage Numbers', callback_data: 'admin_manage_numbers' }],
                        [{ text: '📱 Manage Apps', callback_data: 'admin_manage_apps' }],
                        [{ text: '💰 Manage Costs', callback_data: 'admin_manage_costs' }],
                        [{ text: '🎟️ Manage Promo Codes', callback_data: 'admin_manage_codes' }],
                        [{ text: '📊 Statistics', callback_data: 'admin_stats' }],
                        [{ text: '🔙 Back', callback_data: 'main_menu' }]
                    ]
                }
            }).catch(e => console.error('Admin Panel Error:', e.message));
        }



        // ADMIN: MANAGE GMAILS MENU
        else if (data === 'admin_manage_gmails') {
            if (!isAdmin(userId)) return;

            const services = db.getEmailServices();
            let msg = "**Current Stock:**\n";

            const markup = [];

            if (Object.keys(services).length > 0) {
                Object.keys(services).forEach(serviceId => {
                    const service = services[serviceId];
                    // Count stock (legacy + OAuth pool for this service)
                    const legacyStock = service.stock || 0;
                    const oauthEmails = db.getGmails().filter(g => g.oauth && g.service === serviceId);
                    const totalStock = legacyStock + oauthEmails.length;

                    msg += `- ${service.name}: **${totalStock}** (Price: ${service.price})\n`;

                    // Add button to manage this specific service
                    markup.push([{ text: `📧 Manage ${service.name}`, callback_data: `admin_gmail_svc_manage_${serviceId}` }]);
                });
            } else {
                msg += "_No services configured._\n";
            }

            // Add special buttons
            markup.push([{ text: '➕ Create New Service', callback_data: 'admin_create_email_svc' }]);
            markup.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: markup },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CONNECT OAUTH (GMAIL)
        else if (data === 'admin_connect_gmail_oauth') {
            if (!isAdmin(userId)) return;
            // Generic state: just userId
            const authUrl = oauth.getAuthUrl(userId.toString());
            const msg = `🔗 <b>Connect Gmail Account</b>\n\n` +
                `Click the button below to authorize a Gmail account.\n` +
                `Once authorized, the email will appear in the "Connected Email Pool".\n\n` +
                `<i>Note: You must have configured GMAIL_CLIENT_ID and SECRET in config.js</i>`;

            // Send new message as URL button cannot be edited into text sometimes if diff domain?
            // Actually it is fine.
            bot.sendMessage(chatId, msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👉 Login with Google', url: authUrl }],
                        [{ text: '🔙 Back', callback_data: 'admin_manage_gmails' }]
                    ]
                }
            });
            // answer callback to stop spinner
            bot.answerCallbackQuery(query.id);
        }

        // ADMIN: GMAIL POOL
        else if (data === 'admin_gmail_pool') {
            if (!isAdmin(userId)) return;
            // Get only OAuth emails
            const gmails = db.getGmails().filter(g => g.oauth);

            let msg = `📧 <b>Connected Email Pool (OAuth)</b>\n\n`;
            if (gmails.length === 0) {
                msg += `No connected accounts found. Click 'Connect Gmail' to add one.`;
            } else {
                msg += `Total Connected: ${gmails.length}\n\n`;
                gmails.forEach((g, i) => {
                    const svcName = g.service ? (db.getEmailServices()[g.service]?.name || g.service) : 'Unassigned';
                    msg += `${i + 1}. <b>${g.email}</b>\n   └ Service: <b>${svcName}</b>\n`;
                });
            }

            const buttons = [];
            // Add assign button if there are unassigned emails? Or allow reassign.
            if (gmails.length > 0) {
                buttons.push([{ text: '🏷 Assign Service to Email', callback_data: 'admin_assign_oauth_select' }]);
            }
            buttons.push([{ text: '🔗 Connect Another', callback_data: 'admin_connect_gmail_oauth' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_manage_gmails' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: SELECT EMAIL TO ASSIGN SYSTEM
        else if (data === 'admin_assign_oauth_select') {
            const gmails = db.getGmails().filter(g => g.oauth);
            if (gmails.length === 0) return bot.answerCallbackQuery(query.id, { text: "No emails in pool", show_alert: true });

            const buttons = [];
            gmails.forEach(g => {
                buttons.push([{ text: g.email, callback_data: `admin_assign_oauth_email_${g.email}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_gmail_pool' }]);

            bot.editMessageText('<b>Select Email to Assign:</b>', {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: SELECT SERVICE FOR EMAIL
        else if (data.startsWith('admin_assign_oauth_email_')) {
            const email = data.replace('admin_assign_oauth_email_', '');
            userState[userId] = { temp_assign_email: email }; // Store selected email

            const services = db.getEmailServices();
            const buttons = [];
            Object.keys(services).forEach(k => {
                buttons.push([{ text: services[k].name, callback_data: `admin_assign_oauth_confirm_${k}` }]);
            });
            // Add "Unassign" option
            buttons.push([{ text: '🚫 Unassign (Free Pool)', callback_data: `admin_assign_oauth_confirm_unassign` }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_assign_oauth_select' }]);

            bot.editMessageText(`<b>Assigning Service to:</b> ${email}\n\nSelect Service:`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: CONFIRM ASSIGNMENT
        else if (data.startsWith('admin_assign_oauth_confirm_')) {
            const serviceId = data.replace('admin_assign_oauth_confirm_', '');
            const email = userState[userId] ? userState[userId].temp_assign_email : null;

            if (!email) {
                return bot.answerCallbackQuery(query.id, { text: "Session expired, try again", show_alert: true });
            }

            // Update DB
            const gmails = db.getGmails();
            const gmail = gmails.find(g => g.email === email);
            if (gmail) {
                gmail.service = (serviceId === 'unassign') ? null : serviceId;
                db.save();

                // Also, we need to update the SERVICE STOCK count?
                // The service stock in db is `service.stock`.
                // My new logic relies on `gmails` list filtering by `service`.
                // So I don't need to push to `service.stock` anymore?
                // Wait! Current `gmail_gen` logic checks `service.stock`.
                // I should migrate `gmail_gen` to check `gmails` table for `service`.
                // OR I should double-write to `service.stock`.

                // If I double write, I have duplicates.
                // Better: Update `gmail_gen` to query `db.getGmails().filter(...)`.

                bot.answerCallbackQuery(query.id, { text: "✅ Assigned Successfully!", show_alert: true });
                // Go back to pool
                const newEvent = { ...query, data: 'admin_gmail_pool' };
                bot.emit('callback_query', newEvent);
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ Email not found", show_alert: true });
            }
        }

        // ADMIN: MANAGE SPECIFIC EMAIL SERVICE (Like "Manage GOOGLE")
        else if (data.startsWith('admin_gmail_svc_manage_')) {
            if (!isAdmin(userId)) return;

            const serviceId = data.replace('admin_gmail_svc_manage_', '');
            const services = db.getEmailServices();
            const service = services[serviceId];

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });
            }

            // Count stock
            const legacyStock = service.stock || 0;
            const oauthEmails = db.getGmails().filter(g => g.oauth && g.service === serviceId);
            const totalStock = legacyStock + oauthEmails.length;

            const msg = `⚙️ **Managing: ${service.name.toUpperCase()}**\n\n` +
                `Total Stock: **${totalStock}**\n` +
                `Price: ${service.price} Credits\n\n` +
                `Select action:`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Add Stock', callback_data: `admin_gmail_add_stock_${serviceId}` }],
                        [{ text: '📋 View Stock', callback_data: `admin_gmail_view_stock_${serviceId}` }],
                        [{ text: '✏️ Edit Service', callback_data: `admin_gmail_edit_svc_${serviceId}` }],
                        [{ text: '🗑 Delete Service', callback_data: `admin_gmail_delete_svc_${serviceId}` }],
                        [{ text: `🔗 Connect Gmail (For ${service.name})`, callback_data: `admin_connect_gmail_for_${serviceId}` }],
                        [{ text: `📬 ${service.name} Email Pool`, callback_data: `admin_gmail_pool_for_${serviceId}` }],
                        [{ text: '🔙 Back', callback_data: 'admin_manage_gmails' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // CREATE NEW EMAIL SERVICE
        else if (data === 'admin_create_email_svc') {
            if (!isAdmin(userId)) return;
            userState[userId] = { action: 'admin_create_email_svc_name' };
            bot.sendMessage(chatId, "📝 **Enter Service Name** (e.g. GOOGLE, FACEBOOK):", { parse_mode: 'Markdown' });
        }

        // ADMIN: CONNECT GMAIL FOR SPECIFIC SERVICE
        else if (data.startsWith('admin_connect_gmail_for_')) {
            if (!isAdmin(userId)) return;

            const serviceId = data.replace('admin_connect_gmail_for_', '');
            const services = db.getEmailServices();
            const service = services[serviceId];

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });
            }

            // Store service ID for later assignment in OAuth callback
            userState[userId] = { oauth_target_service: serviceId };

            // Encode State: userId|serviceId
            const stateParam = `${userId}|${serviceId}`;
            const authUrl = oauth.getAuthUrl(stateParam);
            const msg = `🔗 <b>Connect Gmail for ${service.name}</b>\n\n` +
                `Click below to authorize a Gmail account.\n` +
                `This email will be automatically assigned to <b>${service.name}</b> service.\n\n` +
                `<i>Note: Make sure GMAIL_CLIENT_ID and SECRET are configured.</i>`;

            bot.sendMessage(chatId, msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👉 Login with Google', url: authUrl }],
                        [{ text: '🔙 Back', callback_data: `admin_gmail_svc_manage_${serviceId}` }]
                    ]
                }
            });
            bot.answerCallbackQuery(query.id);
        }

        // ADMIN: VIEW EMAIL POOL FOR SPECIFIC SERVICE
        else if (data.startsWith('admin_gmail_pool_for_')) {
            if (!isAdmin(userId)) return;

            const serviceId = data.replace('admin_gmail_pool_for_', '');
            const services = db.getEmailServices();
            const service = services[serviceId];

            if (!service) {
                return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });
            }

            // Get only OAuth emails for THIS service
            const gmails = db.getGmails().filter(g => g.oauth && g.service === serviceId);

            let msg = `📬 <b>${service.name} Email Pool (OAuth)</b>\n\n`;
            if (gmails.length === 0) {
                msg += `No Gmail accounts connected for ${service.name} yet.\n\n`;
                msg += `Click "Connect Gmail" to add one.`;
            } else {
                msg += `Total Connected: ${gmails.length}\n\n`;
                gmails.forEach((g, i) => {
                    const status = g.assignedTo ? '🔴 In Use' : '🟢 Available';
                    msg += `${i + 1}. <code>${g.email}</code>\n   ${status}\n\n`;
                });
            }

            const buttons = [];
            if (gmails.length > 0) {
                buttons.push([{ text: '🔄 Refresh Status', callback_data: `admin_gmail_pool_for_${serviceId}` }]);
            }
            buttons.push([{ text: '🔗 Connect Another', callback_data: `admin_connect_gmail_for_${serviceId}` }]);
            buttons.push([{ text: '🔙 Back', callback_data: `admin_gmail_svc_manage_${serviceId}` }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: DELETE SERVICE
        else if (data.startsWith('admin_gmail_delete_svc_')) {
            if (!isAdmin(userId)) return;
            const serviceId = data.replace('admin_gmail_delete_svc_', '');
            db.deleteEmailService(serviceId);
            bot.answerCallbackQuery(query.id, { text: "✅ Service Deleted", show_alert: true });

            bot.editMessageText("✅ Service Deleted.", {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Manage Services', callback_data: 'admin_manage_gmails' }]]
                }
            });
        }

        // ADMIN: ADD STOCK (Start Input)
        else if (data.startsWith('admin_gmail_add_stock_')) {
            if (!isAdmin(userId)) return;
            const serviceId = data.replace('admin_gmail_add_stock_', '');
            const service = db.getEmailServices()[serviceId];
            if (!service) return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });

            userState[userId] = { action: 'admin_input_gmail_stock', svcId: serviceId };
            bot.sendMessage(chatId, `📝 **Add Stock for ${service.name}**\n\nEnter emails (One per line):\n\`email\`\n\n(No password needed if connected to OAuth)`, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }

        // ADMIN: VIEW STOCK
        else if (data.startsWith('admin_gmail_view_stock_')) {
            if (!isAdmin(userId)) return;
            const serviceId = data.replace('admin_gmail_view_stock_', '');
            const service = db.getEmailServices()[serviceId];
            if (!service) return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });

            let msg = `📋 **Stock for ${service.name}**\n\n`;
            if (service.stock && service.stock.length > 0) {
                service.stock.slice(0, 20).forEach(acc => {
                    msg += `• \`${acc.email}\`\n`;
                });
                if (service.stock.length > 20) msg += `\n...and ${service.stock.length - 20} more.`;
            } else {
                msg += "_No Legacy Stock Available._";
            }

            const oauthCount = db.getGmails().filter(g => g.oauth && g.service === serviceId).length;
            msg += `\n\n🔹 **OAuth Pool:** ${oauthCount} accounts connected.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: `admin_gmail_svc_manage_${serviceId}` }]]
                }
            });
        }

        // ADMIN: EDIT SERVICE
        else if (data.startsWith('admin_gmail_edit_svc_')) {
            if (!isAdmin(userId)) return;
            const serviceId = data.replace('admin_gmail_edit_svc_', '');
            const service = db.getEmailServices()[serviceId];
            if (!service) return bot.answerCallbackQuery(query.id, { text: "Service not found", show_alert: true });

            userState[userId] = { action: 'admin_edit_email_svc_price', svcId: serviceId };
            bot.sendMessage(chatId, `💰 **Enter New Price for ${service.name}** (in Credits):`, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }

        // ADMIN: MANAGE SERVICES LIST
        else if (data === 'admin_gmail_services') {
            const services = db.getEmailServices();
            const keys = Object.keys(services);
            const allGmails = db.getGmails();

            let msg = `🏷 <b>Email Services</b>\n\nList of active services:\n`;
            if (keys.length === 0) msg += `<i>No services found.</i>`;

            const buttons = [];
            keys.forEach(k => {
                const s = services[k];
                // Count legacy stock
                const legacyStock = s.stock ? s.stock.length : 0;
                // Count OAuth pool (unassigned)
                const oauthStock = allGmails.filter(g => g.service === k && g.oauth && !g.assignedTo).length;
                const totalStock = legacyStock + oauthStock;

                msg += `• <b>${s.name}</b> (${s.price} Cr) - Stock: ${totalStock}\n`;
                buttons.push([{ text: `❌ Delete ${s.name}`, callback_data: `admin_del_gmail_svc_${k}` }]);
            });

            buttons.push([{ text: '➕ Add New Service', callback_data: 'admin_add_gmail_svc' }]);
            buttons.push([{ text: '🔌 Manage API Gateways', callback_data: 'admin_manage_email_gateways' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_manage_gmails' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: ADD SERVICE
        else if (data === 'admin_add_gmail_svc') {
            userState[userId] = { action: 'admin_add_gmail_svc_input' };
            bot.sendMessage(chatId, "Enter Service Details:\nFormat: `ID Name Price`\nExample: `gemini Gemini_AI 20`", { parse_mode: 'Markdown' });
        }

        // ADMIN: DELETE SERVICE
        else if (data.startsWith('admin_del_gmail_svc_')) {
            const id = data.replace('admin_del_gmail_svc_', '');
            db.deleteEmailService(id);
            bot.answerCallbackQuery(query.id, { text: "✅ Service Deleted", show_alert: true });
            // Refresh list
            // Trigger admin_gmail_services manually or just redirect
            const newEvent = { ...query, data: 'admin_gmail_services' };
            bot.emit('callback_query', newEvent); // Simple re-emit to refresh
        }

        // ADMIN: UPLOAD STOCK MENU
        else if (data === 'admin_upload_gmail_stock_menu') {
            const services = db.getEmailServices();
            const keys = Object.keys(services);

            if (keys.length === 0) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ No services created yet!", show_alert: true });
            }

            const buttons = [];
            keys.forEach(k => {
                buttons.push([{ text: `📂 ${services[k].name}`, callback_data: `admin_upload_gmail_stock_${k}` }]);
            });
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_manage_gmails' }]);

            bot.editMessageText(`<b>Select Service to Upload Stock:</b>`, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }

        // ADMIN: UPLOAD STOCK INPUT
        else if (data.startsWith('admin_upload_gmail_stock_')) {
            const serviceId = data.replace('admin_upload_gmail_stock_', '');
            userState[userId] = { action: 'admin_upload_gmail_stock_input', serviceId: serviceId };
            bot.sendMessage(chatId, `📧 <b>Upload Stock for ${serviceId}</b>\n\nSend email|password list (one per line).`, { parse_mode: 'HTML' });
        }
        // ADMIN: BUTTON MANAGEMENT
        else if (data === 'admin_button_management') {
            if (!isAdmin(userId)) return;

            const flags = db.getFeatureFlags();

            let msg = `🔘 **User Button Management**\n\n`;
            msg += `Toggle user-facing features ON/OFF.\n`;
            msg += `Disabled features show "⏳ Coming Soon" to users.\n\n`;
            msg += `🟢 = ON (Working)\n🔴 = OFF (Coming Soon)\n\n`;

            const buttons = [];

            // User Features Only
            const userFeatures = [
                ['buy_cards', '💳 Buy Cards'],
                ['buy_vpn', '🔒 Buy VPN'],
                ['buy_premium_app', '📱 Premium Apps'],
                ['verification', '✅ Verification'],
                ['support', '💬 Support'],
                ['referral', '🔗 Referral'],
                ['daily_bonus', '🎁 Daily Bonus'],
                ['tasks', '📋 Tasks'],
                ['transfer', '💸 Transfer'],
                ['redeem_code', '🎟️ Redeem Code']
            ];

            userFeatures.forEach(([key, label]) => {
                const isOn = flags[key] !== false;
                const emoji = isOn ? '🟢' : '🔴';
                buttons.push([{ text: `${emoji} ${label}`, callback_data: `toggle_feature_${key}` }]);
            });

            buttons.push([{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // TOGGLE FEATURE
        else if (data.startsWith('toggle_feature_')) {
            if (!isAdmin(userId)) return;

            const featureKey = data.replace('toggle_feature_', '');
            const newState = db.toggleFeature(featureKey);

            const status = newState ? 'ENABLED' : 'DISABLED';
            const emoji = newState ? '✅' : '🔴';

            bot.answerCallbackQuery(query.id, {
                text: `${emoji} Feature ${status}!`,
                show_alert: false
            });

            // Refresh the menu
            setTimeout(() => {
                bot.emit('callback_query', {
                    ...query,
                    data: 'admin_button_management',
                    id: query.id + '_refresh'
                });
            }, 300);
        }

        // ADMIN: MANAGE USERS MENU
        else if (data === 'admin_manage_user') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled for admin (always allow for admin)

            bot.editMessageText(`👥 **User Management**\n\nSelect an option to manage users:`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 Search User by ID', callback_data: 'admin_search_user' }],
                        [{ text: '👥 All Users List', callback_data: 'admin_show_all_users' }],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: SHOW ALL USERS
        else if (data === 'admin_show_all_users') {
            const users = db.getUsers();
            let msg = `👥 **All Users List** (${users.length})\n\n`;
            msg += `Format: \`User ID\` | Credits | Status\n\n`;

            // Sort by Join Date (Newest First)
            const sortedUsers = users.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));

            let listText = "";
            sortedUsers.forEach((u, i) => {
                const status = u.blocked ? '🔴 Inactive' : '✅ Active';
                // Format: 1. `12345` | 💰 500 | ✅ Active
                listText += `${i + 1}. \`${u.id}\` | 💰 ${u.balance} | ${status}\n`;
            });

            // Check length (Telegram limit ~4096)
            if ((msg.length + listText.length) > 4000) {
                const fs = require('fs');
                const filePath = './users_list.txt';
                const fileContent = `ALL USERS LIST (${new Date().toLocaleString()})\n\nFormat: ID | Name | Balance | Status\n\n` +
                    sortedUsers.map((u, i) => `${i + 1}. ${u.id} | ${u.first_name || 'User'} | ${u.balance} | ${u.blocked ? 'Inactive' : 'Active'}`).join('\n');

                fs.writeFileSync(filePath, fileContent);

                await bot.sendDocument(chatId, filePath, {
                    caption: `👥 **User List**\nTotal: ${users.length}\n(List too long for message, sent as file)`
                });

                fs.unlinkSync(filePath);
                bot.answerCallbackQuery(query.id, { text: "✅ Sent as file!" });
            } else {
                msg += listText;
                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Refresh', callback_data: 'admin_show_all_users' }],
                            [{ text: '🔙 Back', callback_data: 'admin_manage_user' }]
                        ]
                    }
                });
            }
        }

        // ADMIN: SEARCH USER PROMPT
        else if (data === 'admin_search_user') {
            userState[userId] = { action: 'admin_search_user_input' };
            bot.sendMessage(chatId, `🔍 **Search User**\n\nEnter the **User ID** to find:`, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }

        // ADMIN: MANAGE PROMO CODES
        else if (data === 'admin_manage_codes') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled
            if (!db.isFeatureEnabled('admin_manage_codes')) {
                return bot.answerCallbackQuery(query.id, { text: "⏳ Feature temporarily disabled", show_alert: true });
            }

            const settings = db.getSettings();
            const codes = settings.codes || {};

            // Filter out expired codes (uses <= 0)
            const activeCodes = Object.entries(codes).filter(([code, info]) => info.uses > 0);

            let msg = `🎟️ **Promo Code Management**\n\n`;

            if (activeCodes.length === 0) {
                msg += `_No active codes found._\n`;
            } else {
                msg += `**Active Codes:**\n`;
                activeCodes.slice(0, 15).forEach(([code, c]) => {
                    msg += `• \`${code}\`: ${c.amount} cr (${c.uses} uses)\n`;
                });
            }

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Create Code', callback_data: 'admin_create_code' }],
                        [{ text: '📤 Bulk Upload', callback_data: 'upload_codes_file' }],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN PAYMENTS
        else if (data === 'admin_payments') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled
            if (!db.isFeatureEnabled('admin_payments')) {
                return bot.answerCallbackQuery(query.id, { text: "⏳ Feature temporarily disabled", show_alert: true });
            }

            const payments = db.getPayments();
            const pending = payments.filter(p => p.status === 'pending');
            const confirmed = payments.filter(p => p.status === 'confirmed');
            const rejected = payments.filter(p => p.status === 'rejected');

            let msg = `💳 **Payment Management**\n\n`;
            msg += `⏳ Pending: ${pending.length}\n`;
            msg += `✅ Confirmed: ${confirmed.length}\n`;
            msg += `❌ Rejected: ${rejected.length}\n`;
            msg += `📊 Total: ${payments.length}\n`;

            const buttons = [];
            if (pending.length > 0) {
                buttons.push([{ text: `⏳ View Pending (${pending.length})`, callback_data: 'admin_pending_payments' }]);
            }
            buttons.push([{ text: '📜 Payment History', callback_data: 'admin_payment_history' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // PENDING PAYMENTS
        else if (data === 'admin_pending_payments') {
            if (!isAdmin(userId)) return;

            const payments = db.getPayments().filter(p => p.status === 'pending');

            if (payments.length === 0) {
                bot.editMessageText('📭 No pending payments.', {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_payments' }]] }
                });
                return;
            }

            let msg = `⏳ **Pending Payments:**\n\n`;
            const buttons = [];

            payments.slice(0, 10).forEach(payment => {
                const date = new Date(payment.createdAt).toLocaleDateString();
                msg += `💰 **${payment.id}**\n`;
                msg += `   User: ${payment.userId}\n`;
                msg += `   Amount: ${payment.amount} cr\n`;
                msg += `   Method: ${payment.method.toUpperCase()}\n`;
                msg += `   Date: ${date}\n\n`;

                buttons.push([
                    { text: `✅ Approve ${payment.id}`, callback_data: `admin_confirm_payment_${payment.id}` },
                    { text: `❌ Reject`, callback_data: `admin_reject_payment_${payment.id}` }
                ]);
            });

            buttons.push([{ text: '🔙 Back', callback_data: 'admin_payments' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // CONFIRM PAYMENT
        else if (data.startsWith('admin_confirm_payment_')) {
            if (!isAdmin(userId)) return;

            const paymentId = data.replace('admin_confirm_payment_', '');
            const payment = db.getPayment(paymentId);

            if (!payment) {
                bot.answerCallbackQuery(query.id, { text: '❌ Payment not found', show_alert: true });
                return;
            }

            if (payment.status === 'confirmed') {
                bot.answerCallbackQuery(query.id, { text: '⚠️ Already confirmed!', show_alert: true });
                return;
            }

            db.confirmPayment(paymentId);

            // Notify user
            bot.sendMessage(payment.userId,
                `✅ **Payment Approved!**\n\n` +
                `Payment ID: \`${paymentId}\`\n` +
                `Amount: ${payment.amount} Credits\n\n` +
                `Credits have been added to your balance!`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });

            bot.answerCallbackQuery(query.id, { text: '✅ Payment confirmed!', show_alert: true });
            bot.editMessageText(`✅ Payment ${paymentId} confirmed!\n\n${payment.amount} credits added to User ${payment.userId}.`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Undo', callback_data: `admin_undo_payment_${paymentId}` }],
                        [{ text: '🔙 Back', callback_data: 'admin_pending_payments' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // REJECT PAYMENT
        else if (data.startsWith('admin_reject_payment_')) {
            if (!isAdmin(userId)) return;

            const paymentId = data.replace('admin_reject_payment_', '');
            const payment = db.getPayment(paymentId);

            if (!payment) {
                bot.answerCallbackQuery(query.id, { text: '❌ Payment not found', show_alert: true });
                return;
            }

            db.rejectPayment(paymentId);

            // Notify user
            bot.sendMessage(payment.userId,
                `❌ **Payment Rejected**\n\n` +
                `Payment ID: \`${paymentId}\`\n` +
                `Amount: ${payment.amount} Credits\n\n` +
                `Your payment was not approved. Please contact support if you believe this is an error.`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });

            bot.answerCallbackQuery(query.id, { text: '❌ Payment rejected', show_alert: true });
            bot.editMessageText(`❌ Payment ${paymentId} rejected.`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Undo', callback_data: `admin_undo_payment_${paymentId}` }],
                        [{ text: '🔙 Back', callback_data: 'admin_pending_payments' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // UNDO PAYMENT
        else if (data.startsWith('admin_undo_payment_')) {
            if (!isAdmin(userId)) return;

            const paymentId = data.replace('admin_undo_payment_', '');
            db.undoPayment(paymentId);

            bot.answerCallbackQuery(query.id, { text: '🔄 Payment reset to pending', show_alert: true });
            bot.deleteMessage(chatId, msgId).catch(() => { });

            setTimeout(() => {
                bot.sendMessage(chatId, `🔄 Payment ${paymentId} reset to pending status.`, {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Payments', callback_data: 'admin_payments' }]] }
                });
            }, 500);
        }

        // ADMIN SETTINGS


        // CHANGE SUPPORT COST
        else if (data === 'admin_change_support_cost') {
            if (!isAdmin(userId)) return;

            userState[userId] = { action: 'admin_set_support_cost' };
            bot.sendMessage(chatId, '💬 **Change Support Cost**\n\nSend new cost in credits:', { parse_mode: 'Markdown' });
        }

        // ==================== DATABASE CONNECTION ====================

        // DATABASE MAIN MENU
        else if (data === 'admin_database') {
            if (!isAdmin(userId)) return;

            let status = { connected: false };
            let driveConnected = false;

            // Check Unified DB (Google Drive)
            try {
                const unifiedDb = require('./database/unified-db');
                if (unifiedDb.isUsingGoogleDrive()) {
                    driveConnected = true;
                    status = {
                        connected: true,
                        dbType: 'Google Drive',
                        connectionName: 'Google Cloud',
                        host: 'Cloud',
                        database: 'TelegramBotData'
                    };
                }
            } catch (e) {
                console.error('UnifiedDB Error:', e.message);
            }

            // Check SQL DB (if not drive)
            if (!driveConnected) {
                try {
                    // Try to load connection manager (may fail if packages not installed)
                    const connectionManager = require('./database/connection-manager');
                    status = connectionManager.getStatus();
                } catch (error) {
                    // SQL drivers missing - running in limited mode
                    // console.log('SQL drivers not installed');
                }
            }

            let msg = `🗄️ **Database / Storage**\n\n`;

            if (status.connected) {
                msg += `✅ **Status:** Connected\n`;
                msg += `📊 **Database:** ${status.dbType || 'N/A'}\n`;
                if (status.dbType === 'Google Drive') {
                    msg += `📁 **Storage:** 2TB Cloud Storage\n`;
                } else {
                    msg += `🏷️ **Name:** ${status.connectionName || 'N/A'}\n`;
                    msg += `📁 **Database:** ${status.database || 'N/A'}\n`;
                }
                msg += `\nAll bot data is being saved to external database.\n`;
            } else {
                msg += `❌ **Status:** Using Local Storage\n\n`;
                msg += `All data is currently saved on the server disk.\n`;
                msg += `Connect **Google Drive** for 2TB free cloud storage & auto-backups!\n`;
            }

            const buttons = [];

            if (status.connected) {
                buttons.push([{ text: '🔌 Disconnect Database', callback_data: 'db_disconnect' }]);
                buttons.push([{ text: '📊 View Details', callback_data: 'db_check_status' }]);
            } else {
                // Show Google Drive prominently
                buttons.push([{ text: '☁️ Connect Google Drive (Recommended)', callback_data: 'db_setup_google_drive' }]);
                buttons.push([{ text: '🗄️ More Options (SQL/NoSQL)', callback_data: 'db_connect_menu' }]);
            }

            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            }).catch(e => console.error('Database menu error:', e.message));
        }

        // DATABASE CONNECTION MENU
        else if (data === 'db_connect_menu') {
            if (!isAdmin(userId)) return;

            const msg = `🔗 **Connect Database**\n\n` +
                `Select storage type:\n\n` +
                `• **Google Drive** - 2TB FREE! (Recommended) 🔥\n` +
                `• **PostgreSQL** - Traditional database\n` +
                `• **MySQL** - Popular choice\n` +
                `• **MongoDB** - NoSQL option\n` +
                `• **SQLite** - File-based (simple)`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '☁️ Google Drive (2TB FREE!)', callback_data: 'db_setup_google_drive' }],
                        [{ text: '🔌 Disconnect Google Drive', callback_data: 'db_disconnect' }],
                        [{ text: '🔙 Back', callback_data: 'admin_database' }]
                    ]
                }
            }).catch(e => console.error(e));
        }


        // DATABASE SETUP (Google Drive)
        else if (data === 'db_setup_google_drive') {
            if (!isAdmin(userId)) return;

            // AUTOMATIC GOOGLE DRIVE SETUP
            if (!config.GMAIL_CLIENT_ID || config.GMAIL_CLIENT_ID.includes('YOUR_')) {
                return bot.sendMessage(chatId, "⚠️ **Configuration Missing**\n\nPlease set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in config.js (or .env) first.\nUse your Google Cloud Console to create credentials.");
            }

            const authUrl = oauth.getDriveAuthUrl('drive_setup');

            const msg = `☁️ **Google Drive Auto-Connect**\n\n` +
                `The bot will use your existing Google Cloud credentials.\n\n` +
                `**Instructions:**\n` +
                `1️⃣ Click the **Authorize** button below\n` +
                `2️⃣ Login with your Google Account\n` +
                `3️⃣ Allow access to "Drive API"\n` +
                `4️⃣ Wait for "Success" message on the web page\n\n` +
                `_After authorization, click "Check Status" below!_`;

            bot.sendMessage(chatId, msg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔗 Authorize Google Drive', url: authUrl }],
                        [{ text: '🔄 Check Connection Status', callback_data: 'db_check_status' }],
                        [{ text: '🔙 Back', callback_data: 'db_connect_menu' }]
                    ]
                }
            });

            // Clear state (no manual input needed)
            if (userState[userId]) delete userState[userId];
        }

        // CHECK DATABASE STATUS
        else if (data === 'db_check_status') {
            if (!isAdmin(userId)) return;

            const unifiedDb = require('./database/unified-db');
            const status = await unifiedDb.getStorageStatus();

            let statusMsg = `📊 **Database Status**\n\n` +
                `**Type:** ${status.type}\n` +
                `**Connected:** ${status.connected ? '✅ Yes' : '❌ No'}\n`;

            if (status.type === 'Google Drive' && status.connected) {
                statusMsg += `**User:** ${status.user}\n` +
                    `**Total Space:** ${status.total}\n` +
                    `**Used Space:** ${status.used}\n` +
                    `**Free Space:** ${status.free}\n`;
            } else {
                statusMsg += `**Size:** ${status.size || 'Unknown'}\n` +
                    `**Path:** ${status.path || 'Local'}\n`;
            }

            bot.sendMessage(chatId, statusMsg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'db_connect_menu' }]]
                }
            });
        }

        // DATABASE DISCONNECT
        // DATABASE DISCONNECT
        else if (data === 'db_disconnect') {
            if (!isAdmin(userId)) return;

            const unifiedDb = require('./database/unified-db');

            try {
                await unifiedDb.disconnectGoogleDrive();

                bot.sendMessage(chatId,
                    `✅ **Google Drive Disconnected**\n\n` +
                    `Bot switched to local file storage.\n` +
                    `Data will be saved locally in \`database.json\`.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_database' }]]
                        }
                    }
                );
            } catch (error) {
                bot.sendMessage(chatId, '❌ Error: ' + error.message);
            }
        }



        // ==================== BACKUP & RESTORE ====================

        // BACKUP MENU
        else if (data === 'admin_backup') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled
            if (!db.isFeatureEnabled('admin_backup')) {
                return bot.answerCallbackQuery(query.id, { text: "⏳ Feature temporarily disabled", show_alert: true });
            }

            const msg = `💾 **Backup System**\n\n` +
                `✅ **Auto-Backup:** Enabled\n` +
                `⏱️ **Interval:** Every 5 Hours\n` +
                `📦 **Destination:** Backup Bot\n` +
                `🗑️ **Status:** Files deleted after sending (Zero Trace)\n\n` +
                `Click below to manually backup now.`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Create Backup Now', callback_data: 'admin_create_backup' }],
                        [{ text: '📤 Upload & Restore', callback_data: 'admin_upload_restore' }],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // CREATE BACKUP NOW
        else if (data === 'admin_create_backup') {
            if (!isAdmin(userId)) return;

            try {
                const backupFile = db.createBackup();
                const backupName = require('path').basename(backupFile);

                if (config.BACKUP_BOT_TOKEN) {
                    const TelegramBot = require('node-telegram-bot-api');
                    const backupBot = new TelegramBot(config.BACKUP_BOT_TOKEN, { polling: false });

                    // Send via Backup Bot to ADMIN_ID
                    await backupBot.sendDocument(config.ADMIN_ID, fs.createReadStream(backupFile), {
                        caption: `✅ **Manual Backup Created!**\n\n` +
                            `File: \`${backupName}\`\n` +
                            `Time: ${new Date().toLocaleString()}\n` +
                            `Requested by: Admin (Manual)`,
                        parse_mode: 'Markdown'
                    });

                    // Notify Admin in Main Bot
                    bot.sendMessage(chatId, `✅ **Backup Sent Successfully!**\n\nThe file has been sent via your **Backup Bot** (Security Mode).\n\n_Local file deleted from server._`, { parse_mode: 'Markdown' });

                    // Delete ALL local files (Zero Trace)
                    try {
                        db.deleteAllBackups();
                        console.log('🗑️ All backup files cleaned up.');
                    } catch (dErr) { console.error('Failed to cleanup backups:', dErr); }

                } else {
                    // Fallback to sending in chat if Backup Bot not configured
                    bot.sendDocument(chatId, backupFile, {
                        caption: `✅ **Backup Created!**\n\n` +
                            `File: \`${backupName}\`\n` +
                            `Time: ${new Date().toLocaleString()}\n\n` +
                            `Download this file to restore later if needed.`,
                        parse_mode: 'Markdown'
                    });
                }

                bot.answerCallbackQuery(query.id, { text: '✅ Backup processed!', show_alert: false });
            } catch (error) {
                console.error(error);
                bot.answerCallbackQuery(query.id, { text: '❌ Backup failed!', show_alert: true });
            }
        }



        // UPLOAD & RESTORE
        else if (data === 'admin_upload_restore') {
            if (!isAdmin(userId)) return;

            userState[userId] = { action: 'admin_upload_backup' };
            bot.sendMessage(chatId,
                `📤 **Upload Backup File**\n\n` +
                `Send a backup JSON file to restore.\n\n` +
                `⚠️ **Warning:** This will replace all current data!`,
                { parse_mode: 'Markdown' }
            );
        }

        // CHANGE RATES
        else if (data.startsWith('admin_change_rate_')) {
            if (!isAdmin(userId)) return;

            const method = data.replace('admin_change_rate_', '');
            userState[userId] = { action: 'admin_set_rate', method: method };

            const unit = method === 'crypto' ? 'USDT' : 'BDT';
            bot.sendMessage(chatId, `💵 **Change ${method.toUpperCase()} Rate**\n\nSend new rate (${unit} per credit):`, { parse_mode: 'Markdown' });
        }

        // ==================== TASKS & CARDS ====================

        // TASKS MENU
        else if (data === 'tasks') {
            const tasksData = db.getTasks();
            const userTasks = user.tasksDone || [];

            let msg = `📋 **Available Tasks**\n\nComplete tasks to earn credits!\n\n`;
            const buttons = [];

            tasksData.forEach(task => {
                const isDone = userTasks.includes(task.id);
                const statusEmoji = isDone ? '✅' : '📌';

                msg += `${statusEmoji} **${task.name}**\n`;
                msg += `   Reward: ${task.reward} credits\n`;
                msg += `   Status: ${isDone ? 'Completed' : 'Available'}\n\n`;

                if (!isDone) {
                    buttons.push([{ text: `${task.name} (+${task.reward} cr)`, callback_data: `do_task_${task.id}` }]);
                }
            });

            buttons.push([{ text: '🔙 Back', callback_data: 'main_menu' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // DO TASK
        else if (data.startsWith('do_task_')) {
            const taskId = data.replace('do_task_', '');
            const task = db.getTask(taskId);

            if (!task) {
                bot.answerCallbackQuery(query.id, { text: '❌ Task not found', show_alert: true });
                return;
            }

            const msg = `📋 **${task.name}**\n\n` +
                `${task.description}\n\n` +
                `Reward: **${task.reward} Credits**\n\n` +
                `Click the button below to complete:`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: task.buttonText || 'Complete Task', url: task.url }],
                        [{ text: '✅ Claim Reward', callback_data: `claim_task_${taskId}` }],
                        [{ text: '🔙 Back', callback_data: 'tasks' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // CLAIM TASK
        else if (data.startsWith('claim_task_')) {
            const taskId = data.replace('claim_task_', '');
            const result = db.completeTask(userId, taskId);

            if (result.success) {
                bot.answerCallbackQuery(query.id, {
                    text: `✅ Earned ${result.reward} Credits!`,
                    show_alert: true
                });
                bot.deleteMessage(chatId, msgId).catch(() => { });
                setTimeout(() => sendMainMenu(chatId, db.getUser(userId)), 500);
            } else {
                bot.answerCallbackQuery(query.id, {
                    text: result.msg || '❌ Task already completed',
                    show_alert: true
                });
            }
        }

        // ==================== ADD BALANCE (USER SIDE) ====================

        // ADD BALANCE MENU
        else if (data === 'add_balance_menu') {
            const msg = `💎 **Top Up Balance**\n\nSelect a package or enter a custom amount:`;

            const buttons = [
                [
                    { text: '💎 100', callback_data: 'pay_amount_100' },
                    { text: '💎 250', callback_data: 'pay_amount_250' },
                    { text: '💎 500', callback_data: 'pay_amount_500' }
                ],
                [
                    { text: '💎 1000', callback_data: 'pay_amount_1000' },
                    { text: '💎 2500', callback_data: 'pay_amount_2500' },
                    { text: '💎 5000', callback_data: 'pay_amount_5000' }
                ],
                [{ text: '✏️ Custom Amount', callback_data: 'pay_amount_custom' }],
                [{ text: getText(lang, 'paymentHistory') || '📜 History', callback_data: 'my_payments' }],
                [{ text: getText(lang, 'backButton') || '🔙 Back', callback_data: 'main_menu' }]
            ];

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }



        // PAYMENT CUSTOM AMOUNT
        else if (data === 'pay_amount_custom') {
            userState[userId] = { action: 'payment_custom_amount' };
            bot.sendMessage(chatId, '✏️ **Enter Amount**\n\nHow many credits do you want to calculate price for?', { parse_mode: 'Markdown' });
        }

        // PAYMENT AMOUNT SELECTED
        else if (data.startsWith('pay_amount_') && data !== 'pay_amount_custom') {
            const amount = parseInt(data.replace('pay_amount_', ''));
            userState[userId] = { action: 'payment_method_select', amount: amount };

            // Calculate discounts
            let discountPercent = 0;
            if (amount > 5000) discountPercent = 10;
            else if (amount >= 5000) discountPercent = 8;
            else if (amount >= 2000) discountPercent = 6;
            else if (amount >= 1000) discountPercent = 4;
            else if (amount >= 500) discountPercent = 2;

            const discount = discountPercent / 100;
            const cryptoRate = db.getCreditRate('crypto');

            let usdPrice = (amount * cryptoRate * (1 - discount)).toFixed(2);

            const msg = getText(lang, 'paymentSelectMethod', amount, discountPercent, usdPrice);

            const buttons = [
                [{ text: '💎 Cryptocurrency (USDT)', callback_data: `pay_method_crypto_${amount}` }],
                [{ text: getText(lang, 'cancelButton'), callback_data: 'add_balance_menu' }]
            ];

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // PAYMENT METHOD SELECTED
        else if (data.startsWith('pay_method_')) {
            const parts = data.replace('pay_method_', '').split('_');
            const method = parts[0];
            const amount = parseInt(parts[1]);

            // Re-calculate price just to be safe/display
            let discountPercent = 0;
            if (amount > 5000) discountPercent = 10;
            else if (amount >= 5000) discountPercent = 8;
            else if (amount >= 2000) discountPercent = 6;
            else if (amount >= 1000) discountPercent = 4;
            else if (amount >= 500) discountPercent = 2;

            const rate = db.getCreditRate(method === 'crypto' ? 'crypto' : 'bkash'); // Simplify rate fetch
            const specificRate = db.getCreditRate(method); // Fetch properly
            const finalPrice = amount * specificRate * (1 - discountPercent / 100);

            const symbol = method === 'crypto' ? '$' : '৳';
            const currency = method === 'crypto' ? 'USDT (TRC20)' : 'BDT';

            const configMethods = config.PAYMENT_METHODS;
            const address = configMethods[method] ? configMethods[method].number || configMethods[method].address : 'Contact Admin';

            const msg = getText(lang, 'paymentInstruction', method.toUpperCase(), amount, finalPrice.toFixed(2), currency, address);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: getText(lang, 'submitProof'), callback_data: `submit_proof_${amount}_${method}` }],
                        [{ text: getText(lang, 'backButton'), callback_data: `pay_amount_${amount}` }] // Fixed back button
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // SUBMIT PROOF PROMPT
        else if (data.startsWith('submit_proof_')) {
            const parts = data.replace('submit_proof_', '').split('_');
            const amount = parseInt(parts[0]);
            const method = parts[1];

            userState[userId] = {
                action: 'payment_proof',
                amount: amount,
                method: method
            };

            bot.editMessageText(getText(lang, 'submitProofPrompt'), {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [[{ text: getText(lang, 'cancelButton'), callback_data: 'add_balance_menu' }]] },
                parse_mode: 'Markdown'
            });
        }

        // LIST USER PAYMENTS
        else if (data === 'my_payments') {
            const payments = db.getPayments(userId) || [];

            if (payments.length === 0) {
                bot.editMessageText(getText(lang, 'noPayments'), {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: [[{ text: getText(lang, 'backButton'), callback_data: 'add_balance_menu' }]] },
                    parse_mode: 'Markdown'
                });
                return;
            }

            let msg = getText(lang, 'paymentHistory') + '\n\n';
            payments.slice(-5).reverse().forEach(p => {
                const date = new Date(p.createdAt).toLocaleDateString();
                msg += `💰 **${p.amount} cr** (${p.method})\n`;
                msg += `   Status: ${p.status === 'confirmed' ? '✅' : p.status === 'rejected' ? '❌' : '⏳'}\n`;
                msg += `   Date: ${date}\n\n`;
            });

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [[{ text: getText(lang, 'backButton'), callback_data: 'add_balance_menu' }]] },
                parse_mode: 'Markdown'
            });
        }

        // REMOVED DUPLICATE BUY CARDS HANDLER

        // CONFIRM PURCHASE
        else if (data.startsWith('buy_card_confirm_')) {
            const serviceId = data.split('_')[3];
            const price = db.getCardPrice(serviceId);

            const counts = db.getCardCounts();
            if (!counts[serviceId] || counts[serviceId] <= 0) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Out of Stock!", show_alert: true });
            }

            // Check Balance
            if (user.balance < price) {
                return bot.answerCallbackQuery(query.id, { text: `❌ Insufficient Balance! Need ${price} Credits`, show_alert: true });
            }

            // Deduct & Get Card
            if (db.deductCredit(userId, price)) {
                const card = db.getCard(serviceId);
                if (card) {
                    const freshUser = db.getUser(userId); // Fetch updated balance
                    freshUser.cardsPurchased = (freshUser.cardsPurchased || 0) + 1;
                    db.save();

                    let detailsMsg = "";
                    if (typeof card === 'string') {
                        detailsMsg = `\n\`\`\`\n${card}\n\`\`\``;
                    } else {
                        // Try to parse if stored as JSON string
                        let c = card;

                        // Fallback for old data with empty fields but full_billing_text
                        if ((!c.state || c.state === 'N/A') && c.full_billing_text) {
                            const lines = c.full_billing_text.split('\n');
                            lines.forEach(l => {
                                const line = l.trim();
                                const lower = line.toLowerCase();
                                if (lower.startsWith('state:')) c.state = line.split(':')[1]?.trim() || '';
                                else if (lower.startsWith('city:')) c.city = line.split(':')[1]?.trim() || '';
                                else if (lower.startsWith('address')) c.address = line.split(':')[1]?.trim() || '';
                                else if (lower.startsWith('postal') || lower.startsWith('zip')) c.zip = line.split(':')[1]?.trim() || '';
                                else if (lower.startsWith('type:')) c.type = line.split(':')[1]?.trim() || '';
                                else if (lower.startsWith('name:')) c.name = line.split(':')[1]?.trim() || '';
                            });
                        }

                        /* 
                           If card is object: { state, city, address, zip, number, expiry, cvv }
                           Map these to the view.
                        */
                        detailsMsg = `
📍 **Billing Address:**
\`\`\`
Type: ${c.type || 'N/A'}
Name: ${c.name || 'N/A'}
State: ${c.state || 'N/A'}
City: ${c.city || 'N/A'}
Address: ${c.address || 'N/A'}
Zip: ${c.zip || 'N/A'}
\`\`\`

💳 **Card Details:**
\`\`\`
Number: ${c.number || 'N/A'}
Expiry: ${c.expiry || 'N/A'}
CVV: ${c.cvv || 'N/A'}
\`\`\`
`;
                    }

                    const msg = `🤖 **${serviceId.toUpperCase()} Card Details**\n\n` +
                        `✅ **Purchase Successful!**\n` +
                        `💸 ${price} credits deducted\n` +
                        `💰 Remaining: ${freshUser.balance} credits\n` +
                        `_____________________________\n` +
                        detailsMsg +
                        `_____________________________\n\n` +
                        `⚠️ **Important:**\n` +
                        `• Use these details immediately.\n` +
                        `• Keep this info secure.`;

                    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
                    bot.deleteMessage(chatId, msgId).catch(() => { });
                } else {
                    db.addCredit(userId, price); // Refund
                    bot.answerCallbackQuery(query.id, { text: "❌ Error: Stock unavailable (Refunded)", show_alert: true });
                }
            }
        }

        // CHANGE LANGUAGE
        else if (data === 'change_language') {
            const buttons = [
                [{ text: '🇺🇸 English', callback_data: 'set_lang_en' }],
                [{ text: '🇧🇩 বাংলা', callback_data: 'set_lang_bn' }],
                [{ text: getText(lang, 'backButton'), callback_data: 'main_menu' }]
            ];

            bot.editMessageText(getText(lang, 'selectLanguage'), {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // SET LANGUAGE
        else if (data.startsWith('set_lang_')) {
            const newLang = data.replace('set_lang_', '');
            db.updateUser(userId, { language: newLang });

            const successMsg = newLang === 'bn' ? '✅ ভাষা পরিবর্তন করা হয়েছে!' : '✅ Language changed successfully!';

            bot.answerCallbackQuery(query.id, { text: successMsg, show_alert: true });

            const updatedUser = db.getUser(userId);
            sendMainMenu(chatId, updatedUser);
            bot.deleteMessage(chatId, msgId).catch(() => { });
        }

        // ADMIN PANEL
        else if (data === 'admin_panel') {
            if (!isAdmin(userId)) return;

            bot.editMessageText('⚙️ **Admin Panel**\nSelect an action:', {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👤 Manage Users', callback_data: 'admin_manage_user' }, { text: '💳 Manage Cards', callback_data: 'admin_manage_cards' }],
                        [{ text: '📧 Email Services', callback_data: 'admin_manage_gmails' }, { text: '📱 Number Services', callback_data: 'admin_manage_numbers' }],
                        [{ text: '💰 Manage Costs', callback_data: 'admin_manage_costs' }, { text: '🎟 Create Code', callback_data: 'admin_create_code' }],
                        [{ text: '📋 Manage Tasks', callback_data: 'admin_manage_tasks' }, { text: '⚙️ Settings', callback_data: 'admin_settings' }],
                        [{ text: '📊 Global Stats', callback_data: 'admin_stats' }, { text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
                        [{ text: '🔘 Button Manager', callback_data: 'admin_button_management' }, { text: '🔙 Back', callback_data: 'main_menu' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: SETTINGS MENU
        else if (data === 'admin_settings') {
            if (!isAdmin(userId)) return;

            const settings = db.getSettings();
            const refBonus = settings.referralBonus || 50;
            const transferCost = settings.transferCost || 5;
            const supportCost = settings.supportCost || 100;
            const webPanelUrl = settings.webPanelUrl || config.PUBLIC_URL || 'Not set';

            const msg = `⚙️ **Bot Settings**\n\n` +
                `📊 Current Configuration:\n\n` +
                `• Referral Bonus: ${refBonus} credits\n` +
                `• Transfer Fee: ${transferCost} credits\n` +
                `• Support Access Cost: ${supportCost} credits\n` +
                `• Web Panel URL: ${webPanelUrl}\n\n` +
                `Select an option to modify:`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎁 Set Referral Bonus', callback_data: 'admin_set_ref_bonus' }],
                        [{ text: '💸 Change Transfer Fee', callback_data: 'admin_change_transfer_cost' }],
                        [{ text: '🎫 Change Support Cost', callback_data: 'admin_change_support_cost' }],
                        [{ text: '🌐 Set Web Panel URL', callback_data: 'admin_set_webpanel_url' }],
                        [{ text: '💱 Change Crypto Rate', callback_data: 'admin_change_rate_crypto' }],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                }
            }).catch(e => console.error('Settings display error:', e.message));
        }

        // ADMIN: SET REF BONUS INPUT
        else if (data === 'admin_set_ref_bonus') {
            userState[userId] = { action: 'admin_input_ref_bonus' };
            bot.sendMessage(chatId, "Enter new **Referral Bonus Amount** (e.g. 50):", { parse_mode: 'Markdown' });
        }

        // ADMIN: CHANGE TRANSFER COST
        else if (data === 'admin_change_transfer_cost') {
            userState[userId] = { action: 'admin_set_transfer_cost' };
            bot.sendMessage(chatId, "Enter new **Transfer Fee Cost** in Credits (e.g. 5):", { parse_mode: 'Markdown' });
        }

        // ADMIN: CHANGE SUPPORT COST
        else if (data === 'admin_change_support_cost') {
            userState[userId] = { action: 'admin_set_support_cost' };
            bot.sendMessage(chatId, "Enter new **Support Access Cost** in Credits (e.g. 100):", { parse_mode: 'Markdown' });
        }

        // ADMIN: CHANGE CRYPTO RATE
        else if (data === 'admin_change_rate_crypto') {
            userState[userId] = { action: 'admin_set_rate', method: 'crypto' };
            bot.sendMessage(chatId, "Enter new **Crypto Rate** (USDT per credit, e.g. 0.01):", { parse_mode: 'Markdown' });
        }

        // ADMIN: SET WEB PANEL URL
        else if (data === 'admin_set_webpanel_url') {
            userState[userId] = { action: 'admin_set_webpanel_url' };
            bot.sendMessage(chatId, "🌐 **Set Web Panel URL**\n\nEnter the full URL for the web panel:\n\nExample: `http://217.154.212.66:12139`\n\nCurrent: " + (db.getSettings().webPanelUrl || config.PUBLIC_URL || 'Not set'), { parse_mode: 'Markdown' });
        }

        // ADMIN: MANAGE USER (Interactive List)
        else if (data === 'admin_manage_user') {
            // Immediate feedback to stop loading spinner
            bot.answerCallbackQuery(query.id, { text: "Loading users..." }).catch(() => { });
            console.log('>>> MANAGE USER CLICKED');

            try {
                // Determine users
                let usersObj = db.getUsers();
                console.log('>>> Users Obj exists:', !!usersObj);
                if (usersObj) console.log('>>> User Count:', Object.keys(usersObj).length);

                if (!usersObj) usersObj = {};

                const users = Object.values(usersObj);

                // Sort by joinedAt desc
                const sortedUsers = users.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0)).slice(0, 10);

                let msg = `👥 **Manage Users**\n\nTotal Users: **${users.length}**\n\nShowing last 10 joined users:`;
                const buttons = [];

                sortedUsers.forEach(u => {
                    const status = u.blocked ? '🔴' : '🟢';
                    let name = u.username ? `@${u.username}` : (u.firstName || `User ${u.id}`);
                    if (name && name.length > 20) name = name.substring(0, 17) + '...';

                    const cbData = `adm_usr_${u.id}`;
                    if (cbData.length > 60) {
                        console.error(`[ERROR] Skipping button for User ${u.id}: Callback data too long (${cbData.length} chars).`);
                        return;
                    }

                    console.log(`[DEBUG] Adding Button: ${cbData}`);
                    buttons.push([{ text: `${status} ${name} | ${u.balance} cr`, callback_data: cbData }]);
                });

                buttons.push([{ text: '🔍 Search User', callback_data: 'admin_search_user_prompt' }]);
                buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: 'Markdown'
                }).catch((err) => {
                    // Fallback if edit fails (e.g. message too old)
                    bot.sendMessage(chatId, msg, { reply_markup: { inline_keyboard: buttons }, parse_mode: 'Markdown' });
                });

                // Important: Answer callback
                bot.answerCallbackQuery(query.id);

            } catch (error) {
                console.error('[ERROR] admin_manage_user:', error);
                bot.sendMessage(chatId, "❌ Error loading user list.");
                bot.answerCallbackQuery(query.id, { text: "Error loading users", show_alert: true });
            }
        }


        // ADMIN: SHOW USER DETAIL (From List Button)
        else if (data.startsWith('adm_usr_')) {
            try {
                const targetId = data.replace('adm_usr_', '');

                const targetUser = db.getUser(targetId);
                if (!targetUser) return bot.answerCallbackQuery(query.id, { text: "User not found", show_alert: true });

                // Ensure stats
                if (!targetUser.successfulVerifications) targetUser.successfulVerifications = 0;
                if (!targetUser.failedVerifications) targetUser.failedVerifications = 0;
                if (!targetUser.cardsPurchased) targetUser.cardsPurchased = 0;
                if (!targetUser.blocked) targetUser.blocked = false;

                const joinDate = new Date(targetUser.joinedAt).toLocaleDateString();
                const blockStatus = targetUser.blocked ? "🔴 BLOCKED" : "🟢 ACTIVE";
                const blockBtnText = targetUser.blocked ? "✅ Unblock User" : "🚫 Block User";
                const blockCallback = targetUser.blocked ? `admin_unblock_usr_${targetId}` : `admin_block_usr_${targetId}`;

                const msg = `👤 **User Details**\n\n` +
                    `🆔 ID: \`${targetUser.id}\`\n` +
                    `👤 Name: ${targetUser.username ? `@${targetUser.username}` : 'No Username'}\n` +
                    `💰 Balance: **${targetUser.balance} Credits**\n` +
                    `📅 Joined: ${joinDate}\n\n` +
                    `📊 **Activity Stats:**\n` +
                    `👥 Referrals: ${targetUser.referralCount || 0}\n` +
                    `✅ Verified: **${targetUser.successfulVerifications}**\n` +
                    `❌ Failed: **${targetUser.failedVerifications}**\n` +
                    `💳 Cards Bought: **${targetUser.cardsPurchased}**\n\n` +
                    `⚠️ Status: **${blockStatus}**`;

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '➕ Add Credits', callback_data: `admin_credit_add_${targetUser.id}` },
                                { text: '➖ Deduct Credits', callback_data: `admin_credit_sub_${targetUser.id}` }
                            ],
                            [
                                { text: blockBtnText, callback_data: blockCallback }
                            ],
                            [{ text: '🔙 Back to List', callback_data: 'admin_manage_user' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                }).catch(err => {
                    console.error('Error editing message:', err);
                });
            } catch (error) {
                console.error('Error in admin_msg_usr_:', error);
                bot.answerCallbackQuery(query.id, { text: "❌ Error loading user details", show_alert: true });
            }
        }

        // ADMIN: SEARCH PROMPT
        else if (data === 'admin_search_user_prompt') {
            userState[userId] = { action: 'admin_search_user' };
            bot.sendMessage(chatId, "🔍 **Enter User ID** to manage:", { parse_mode: 'Markdown' });
        }

        // ADMIN: STATS
        else if (data === 'admin_stats') {
            const users = Object.values(db.data.users || {});
            const totalUsers = users.length;
            const totalReferrals = users.reduce((acc, u) => acc + (u.referralCount || 0), 0);
            const totalBalance = users.reduce((acc, u) => acc + (u.balance || 0), 0);

            const cards = db.getCardCounts();
            let stockMsg = "";
            for (let s in cards) stockMsg += `- ${s}: ${cards[s]}\n`;

            const msg = `📊 **Global Statistics**\n\n` +
                `👥 Total Users: **${totalUsers}**\n` +
                `🔗 Total Referrals: **${totalReferrals}**\n` +
                `💰 Total User Balance: **${totalBalance}**\n\n` +
                `📦 **Card Stock:**\n${stockMsg}`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_panel' }]] },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: MANAGE COSTS
        else if (data === 'admin_manage_costs') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled
            if (!db.isFeatureEnabled('admin_manage_costs')) {
                return bot.answerCallbackQuery(query.id, { text: "⏳ Feature temporarily disabled", show_alert: true });
            }

            const settings = db.getSettings();
            const cardServices = db.getServices(); // dynamic card services

            let msg = "💰 **Manage Service Costs**\n\n__Verification Services:__\n";
            const buttons = [];

            // Verification Costs (Hardcoded keys for now or loop settings.costs)
            for (let s in settings.costs) {
                msg += `- ${s.toUpperCase()}: **${settings.costs[s]}** cr\n`;
                buttons.push([{ text: `✏️ Edit ${s.toUpperCase()}`, callback_data: `admin_edit_verify_cost_${s}` }]);
            }

            msg += "\n__Card Services:__\n";
            cardServices.forEach(s => {
                msg += `- ${s.name}: **${s.price}** cr\n`;
                buttons.push([{ text: `✏️ Edit ${s.name}`, callback_data: `admin_edit_card_cost_${s.id}` }]);
            });

            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: EDIT COST PROMPTS
        else if (data.startsWith('admin_edit_verify_cost_')) {
            const svc = data.replace('admin_edit_verify_cost_', '');
            userState[userId] = { action: 'admin_input_verify_cost', service: svc };
            bot.sendMessage(chatId, `💰 Enter new cost for **${svc.toUpperCase()}** verification:`, { parse_mode: 'Markdown' });
        }
        else if (data.startsWith('admin_edit_card_cost_')) {
            const svc = data.replace('admin_edit_card_cost_', '');
            userState[userId] = { action: 'admin_input_card_cost', service: svc };
            bot.sendMessage(chatId, `💰 Enter new price for **${svc.toUpperCase()}** card:`, { parse_mode: 'Markdown' });
        }

        // ADMIN: USER ACTIONS (ADD/REMOVE)
        else if (data.startsWith('admin_credit_')) {
            const parts = data.split('_'); // admin, credit, [add/sub], [targetId]
            const action = parts[2];
            const targetId = parts[3];

            userState[userId] = { action: 'admin_edit_balance', target: targetId, mode: action };
            bot.sendMessage(chatId, `Enter amount to ${action === 'add' ? '➕ ADD to' : '➖ DEDUCT from'} User \`${targetId}\`:`, { parse_mode: 'Markdown' });
        }

        // ADMIN: BLOCK/UNBLOCK USER
        else if (data.startsWith('admin_block_toggle_')) {
            const targetId = data.replace('admin_block_toggle_', '');
            const targetUser = db.getUser(targetId);

            targetUser.blocked = !targetUser.blocked; // Toggle
            db.updateUser(targetUser); // Ensure save

            bot.answerCallbackQuery(query.id, {
                text: targetUser.blocked ? '🔴 User Blocked' : '✅ User Unblocked',
                show_alert: true
            });

            // Refresh details view
            const status = targetUser.blocked ? '🔴 Inactive (Blocked)' : '✅ Active';
            const joined = targetUser.joinedAt ? new Date(targetUser.joinedAt).toLocaleString() : 'N/A';

            let reply = `👤 **User Details**\n\n` +
                `🆔 ID: \`${targetId}\`\n` +
                `👤 Name: ${targetUser.first_name || 'N/A'}\n` +
                `💰 Balance: **${targetUser.balance}** Credits\n` +
                `📅 Joined: ${joined}\n` +
                `📊 Status: ${status}\n` +
                `🛒 Purchased: ${targetUser.cardsPurchased || 0} items\n` +
                `🔗 Referrals: ${targetUser.referralCount || 0}\n\n` +
                `Select Action:`;

            bot.editMessageText(reply, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '➕ Add Credit', callback_data: `admin_credit_add_${targetId}` },
                            { text: '➖ Deduct Credit', callback_data: `admin_credit_sub_${targetId}` }
                        ],
                        [
                            { text: targetUser.blocked ? '✅ Unblock User' : '🔴 Block User', callback_data: `admin_block_toggle_${targetId}` }
                        ],
                        [{ text: '🔙 Back to Users', callback_data: 'admin_manage_user' }]
                    ]
                }
            });
        }


        // ADMIN: MANAGE PAYMENT METHODS
        else if (data === 'admin_manage_payments_menu') {
            const settings = db.getSettings();
            const methods = settings.paymentMethods || {};

            let msg = `💳 **Payment Methods Manager**\n\nExisting Methods:\n`;
            const buttons = [];

            Object.keys(methods).forEach(key => {
                const m = methods[key];
                const status = m.enabled ? '✅' : '🔴';
                msg += `${status} **${m.name}** (${key})\n`;
                if (m.address) msg += `   Adrs: \`${m.address}\`\n`;
                if (m.number) msg += `   Num: \`${m.number}\`\n`;
                msg += '\n';

                buttons.push([
                    { text: `✏️ Edit ${m.name}`, callback_data: `admin_edit_pay_${key}` },
                    { text: `❌ Del`, callback_data: `admin_del_pay_${key}` }
                ]);
            });

            if (Object.keys(methods).length === 0) msg += "_No methods configured._\n";

            buttons.push([{ text: '➕ Add New Method', callback_data: 'admin_add_payment_method' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_settings' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: ADD METHOD - ASK ID
        else if (data === 'admin_add_payment_method') {
            userState[userId] = { action: 'admin_new_pay_id' };
            bot.sendMessage(chatId, "Enter unique **ID** for new method (e.g. `rocket`, `binance`):", { parse_mode: 'Markdown' });
        }

        // ADMIN: DELETE METHOD
        else if (data.startsWith('admin_del_pay_')) {
            const key = data.replace('admin_del_pay_', '');
            const settings = db.getSettings();
            if (settings.paymentMethods && settings.paymentMethods[key]) {
                delete settings.paymentMethods[key];
                db.save();
                bot.answerCallbackQuery(query.id, { text: `✅ Method ${key} deleted.` });

                // Refresh menu
                // (Simulate clicking menu button again)
                // We can't easily recurse here without extracting function, so just edit message
                bot.sendMessage(chatId, "✅ Method Deleted. Go back to refresh.");
            }
        }

        // ADMIN: EDIT METHOD (Actually just edit address/number for now)
        else if (data.startsWith('admin_edit_pay_')) {
            const key = data.replace('admin_edit_pay_', '');
            userState[userId] = { action: 'admin_edit_pay_val', key: key };
            bot.sendMessage(chatId, `Enter new **Number** or **Address** for ${key}:`, { parse_mode: 'Markdown' });
        }


        // ADMIN: MANAGE CARDS MENU (Updated Dynamic)
        else if (data === 'admin_manage_cards') {
            if (!isAdmin(userId)) return;

            // Check if feature is enabled
            if (!db.isFeatureEnabled('admin_manage_cards')) {
                return bot.answerCallbackQuery(query.id, { text: "⏳ Feature temporarily disabled", show_alert: true });
            }

            const services = db.getServices();
            let msg = "**Current Stock:**\n";

            const markup = [];

            if (services.length > 0) {
                services.forEach(s => {
                    const count = db.getCardCounts()[s.id] || 0;
                    msg += `- ${s.name}: **${count}** (Price: ${s.price})\n`;

                    // Add button to manage this specific service (Add Stock / Delete)
                    markup.push([{ text: `✏️ Manage ${s.name}`, callback_data: `admin_svc_manage_${s.id}` }]);
                });
            } else {
                msg += "_No services configured._\n";
            }

            markup.push([{ text: '➕ Create New Service', callback_data: 'admin_create_svc' }]);
            markup.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: markup },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CREATE SERVICE FLOW
        else if (data === 'admin_create_svc') {
            userState[userId] = { action: 'admin_create_svc_name' };
            bot.sendMessage(chatId, "📝 **Enter Service Name** (e.g. Netflix Premium):", { parse_mode: 'Markdown' });
        }

        // ADMIN: MANAGE SPECIFIC SERVICE
        else if (data.startsWith('admin_svc_manage_')) {
            const svcId = data.replace('admin_svc_manage_', '');
            // Show options: Add Cards, Delete Service
            bot.editMessageText(`⚙️ **Managing: ${svcId.toUpperCase()}**\nSelect action:`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Add Cards (Bulk)', callback_data: `admin_add_cards_bulk_${svcId}` }],
                        [{ text: '🗑 Clear Stock (Reset)', callback_data: `admin_clear_stock_ask_${svcId}` }],
                        [{ text: '🗑 Delete Service', callback_data: `admin_delete_svc_${svcId}` }],
                        [{ text: '🔙 Back', callback_data: 'admin_manage_cards' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CLEAR STOCK ASK
        else if (data.startsWith('admin_clear_stock_ask_')) {
            const svcId = data.replace('admin_clear_stock_ask_', '');
            bot.editMessageText(`⚠️ **Are you sure?**\n\nThis will delete ALL cards in **${svcId.toUpperCase()}**.\nThis cannot be undone.`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Yes, Clear All', callback_data: `admin_clear_stock_confirm_${svcId}` }],
                        [{ text: '❌ Cancel', callback_data: `admin_svc_manage_${svcId}` }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CLEAR STOCK CONFIRM
        else if (data.startsWith('admin_clear_stock_confirm_')) {
            const svcId = data.replace('admin_clear_stock_confirm_', '');
            db.clearCards(svcId);
            bot.answerCallbackQuery(query.id, { text: "✅ Stock Cleared!", show_alert: true });
            // Go back to manage menu
            bot.deleteMessage(chatId, msgId).catch(() => { });
            bot.sendMessage(chatId, `🗑 **Stock Cleared** for ${svcId.toUpperCase()}. You can add new cards now.`);
            // Or simply send main menu / manage
        }

        // ADMIN: DELETE SERVICE
        else if (data.startsWith('admin_delete_svc_')) {
            const svcId = data.replace('admin_delete_svc_', '');
            db.deleteService(svcId);
            bot.answerCallbackQuery(query.id, { text: "✅ Service Deleted", show_alert: true });
            // Refresh menu
            // Trigger admin_manage_cards logic again? simpler to just send message or edit
            bot.deleteMessage(chatId, msgId).catch(() => { });
            bot.sendMessage(chatId, "✅ Service has been deleted.");
        }

        // ADMIN: ADD CARDS BULK INPUT
        else if (data.startsWith('admin_add_cards_bulk_')) {
            const svcId = data.split('_')[4];
            userState[userId] = { action: 'admin_input_cards_bulk', service: svcId };

            const example =
                `VPN: Nordvpn
Country: India
Type: VISA
Name: John Doe
State: Delhi
District: North Delhi
Zip: 110001
Address: 123 Main St

4242424242424242|12|2030|123
5555555555555555|11|2028|456`;

            bot.sendMessage(chatId, `📝 **Enter Bulk Data for ${svcId.toUpperCase()}**\n\n` +
                `Paste the full text (Info + Cards).\n` +
                `Bot will extract key-value pairs (e.g. \`VPN: Nordvpn\`) and attach them to each card found below.\n\n` +
                `Example:\n\`${example}\``,
                { parse_mode: 'Markdown' });
        }

        // ==================== ADMIN: MANAGE VPN (Exact Card System Clone) ====================

        else if (data === 'admin_manage_vpn') {
            if (!isAdmin(userId)) return;

            const services = db.getVPNServices();
            let msg = "🔒 **VPN Management**\n\n**Current Stock:**\n";

            const markup = [];

            if (services.length > 0) {
                services.forEach(s => {
                    const count = db.getVPNCounts()[s.id] || 0;
                    msg += `- ${s.name}: **${count}** (Price: ${s.price})\n`;

                    // Add button to manage this specific service
                    markup.push([{ text: `✏️ Manage ${s.name}`, callback_data: `admin_vpn_svc_${s.id}` }]);
                });
            } else {
                msg += "_No VPN services configured._\n";
            }

            markup.push([{ text: '➕ Create New VPN Service', callback_data: 'admin_create_vpn_svc' }]);
            markup.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: markup },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CREATE VPN SERVICE FLOW
        else if (data === 'admin_create_vpn_svc') {
            if (!isAdmin(userId)) return;

            userState[userId] = { action: 'admin_create_vpn_svc_name' };
            bot.sendMessage(chatId, "📝 **Enter VPN Service Name** (e.g. NordVPN Premium):", { parse_mode: 'Markdown' });
        }

        // ADMIN: MANAGE SPECIFIC VPN SERVICE
        else if (data.startsWith('admin_vpn_svc_')) {
            if (!isAdmin(userId)) return;

            const svcId = data.replace('admin_vpn_svc_', '');

            bot.editMessageText(`⚙️ **Managing: ${svcId.toUpperCase()}**\nSelect action:`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➕ Add Accounts (Bulk)', callback_data: `admin_vpn_add_bulk_${svcId}` }],
                        [{ text: '🗑 Clear Stock (Reset)', callback_data: `admin_clear_vpn_ask_${svcId}` }],
                        [{ text: '🗑 Delete Service', callback_data: `admin_delete_vpn_${svcId}` }],
                        [{ text: '🔙 Back', callback_data: 'admin_manage_vpn' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CLEAR VPN STOCK ASK
        else if (data.startsWith('admin_clear_vpn_ask_')) {
            if (!isAdmin(userId)) return;

            const svcId = data.replace('admin_clear_vpn_ask_', '');
            bot.editMessageText(`⚠️ **Are you sure?**\n\nThis will delete ALL accounts in **${svcId.toUpperCase()}**.\nThis cannot be undone.`, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Yes, Clear All', callback_data: `admin_clear_vpn_confirm_${svcId}` }],
                        [{ text: '❌ Cancel', callback_data: `admin_vpn_svc_${svcId}` }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CLEAR VPN STOCK CONFIRM
        else if (data.startsWith('admin_clear_vpn_confirm_')) {
            if (!isAdmin(userId)) return;

            const svcId = data.replace('admin_clear_vpn_confirm_', '');
            db.clearVPNAccounts(svcId);
            bot.answerCallbackQuery(query.id, { text: "✅ Stock Cleared!", show_alert: true });

            bot.deleteMessage(chatId, msgId).catch(() => { });
            bot.sendMessage(chatId, `🗑 **Stock Cleared** for ${svcId.toUpperCase()}. You can add new accounts now.`);
        }

        // ADMIN: DELETE VPN SERVICE
        else if (data.startsWith('admin_delete_vpn_')) {
            if (!isAdmin(userId)) return;

            const svcId = data.replace('admin_delete_vpn_', '');
            db.deleteVPNService(svcId);
            bot.answerCallbackQuery(query.id, { text: "✅ Service Deleted", show_alert: true });

            bot.deleteMessage(chatId, msgId).catch(() => { });
            bot.sendMessage(chatId, "✅ VPN Service has been deleted.");
        }

        // ADMIN: ADD VPN ACCOUNTS BULK INPUT (redirecting to existing handler)
        else if (data.startsWith('admin_vpn_add_bulk_')) {
            if (!isAdmin(userId)) return;

            const svcId = data.split('_')[4];
            userState[userId] = { action: 'admin_input_vpn_bulk', service: svcId };

            bot.sendMessage(chatId,
                `📦 **Bulk Add VPN Accounts for ${svcId.toUpperCase()}**\n\n` +
                `Send multiple accounts, one per line:\n` +
                `\`email1@example.com|password1\`\n` +
                `\`email2@example.com|password2\`\n\n` +
                `Example:\n` +
                `\`user1@proton.me|Pass123\`\n` +
                `\`user2@gmail.com|Secret456\``,
                { parse_mode: 'Markdown' }
            );
        }

        // ==================== ADMIN: PREMIUM APPS MANAGEMENT ====================

        else if (data === 'admin_manage_apps') {
            if (!isAdmin(userId)) return;

            const apps = db.getPremiumApps();
            const keys = Object.keys(apps);

            let msg = `📱 **Manage Premium Apps**\n\n`;
            const buttons = [];

            if (keys.length === 0) {
                msg += `_No apps added yet._\n\nClick **Add New App** to start.`;
            } else {
                msg += `Current Apps:\n`;
                keys.forEach(k => {
                    const app = apps[k];
                    msg += `• **${app.name}**\n`;
                    buttons.push([{ text: `🗑 Delete: ${app.name}`, callback_data: `admin_delete_app_${app.id}` }]);
                });
            }

            buttons.push([{ text: '➕ Add New App', callback_data: 'admin_add_app' }]);
            buttons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: { inline_keyboard: buttons },
                parse_mode: 'Markdown'
            });
        }

        else if (data === 'admin_add_app') {
            if (!isAdmin(userId)) return;
            userState[userId] = { action: 'admin_add_app_input' };
            bot.sendMessage(chatId,
                `➕ **Add New Premium App**\n\n` +
                `Send the details in this format:\n` +
                `\`AppName|Price|Link\`\n\n` +
                `Example:\n` +
                `\`Spotify Premium|50|https://t.me/MyCh/123\`\n` +
                `_(Set Price to 0 for free)_`,
                { parse_mode: 'Markdown' }
            );
        }

        else if (data.startsWith('admin_delete_app_')) {
            if (!isAdmin(userId)) return;
            const appId = data.replace('admin_delete_app_', '');

            if (db.deletePremiumApp(appId)) {
                bot.answerCallbackQuery(query.id, { text: "✅ App Deleted", show_alert: false });
                // Refresh list
                // To refresh, we simulate calling 'admin_manage_apps' logic again or just delete message
                bot.deleteMessage(chatId, msgId).catch(() => { });
                bot.sendMessage(chatId, "✅ App deleted successfully.");
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ App not found", show_alert: true });
            }
        }



        // ==================== ADMIN: GROUP CONTROLLER ====================

        else if (data === 'admin_group_controller') {
            if (!isAdmin(userId)) return;

            const rules = db.getGroupSettings();
            const getIcon = (val) => val ? '✅' : '❌';

            const msg = `👮 **Group Controller System**\n\n` +
                `Manage automated moderation for groups.\n` +
                `_Tap to toggle settings:_\n\n` +
                `👋 **Welcome Msg:** ${rules.welcome ? 'ON' : 'OFF'}\n` +
                `🧹 **Clean Service Msg:** ${rules.cleanService ? 'ON' : 'OFF'}\n` +
                `🔗 **Allow Links/Mentions:** ${rules.allowLinks ? 'YES' : 'BLOCK & WARN'}\n` +
                `📷 **Allow Photos:** ${rules.allowPhotos ? 'YES' : 'NO'}\n` +
                `📂 **Allow Files:** ${rules.allowFiles ? 'YES' : 'NO'}\n` +
                `🎤 **Allow Voice:** ${rules.allowVoice ? 'YES' : 'NO'}\n` +
                `↪️ **Allow Forwards:** ${rules.allowForward ? 'YES' : 'NO'}\n` +
                `📧 **Block Emails:** ${rules.blockEmails ? 'ON (Delete Only)' : 'OFF'}\n` +
                `💳 **Block CC/Numbers:** ${rules.blockCC ? 'ON (Delete Only)' : 'OFF'}\n` +
                `💼 **Block Business:** ${rules.blockBusiness ? 'ON (Delete Only)' : 'OFF'}`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `${getIcon(rules.welcome)} Welcome`, callback_data: 'admin_toggle_grp_welcome' },
                            { text: `${getIcon(rules.cleanService)} Clean Join/Left`, callback_data: 'admin_toggle_grp_cleanService' }
                        ],
                        [
                            { text: `${getIcon(rules.allowLinks)} Allow Links`, callback_data: 'admin_toggle_grp_allowLinks' },
                            { text: `${getIcon(rules.allowPhotos)} Allow Photos`, callback_data: 'admin_toggle_grp_allowPhotos' }
                        ],
                        [
                            { text: `${getIcon(rules.allowFiles)} Allow Files`, callback_data: 'admin_toggle_grp_allowFiles' },
                            { text: `${getIcon(rules.allowVoice)} Allow Voice`, callback_data: 'admin_toggle_grp_allowVoice' }
                        ],
                        [
                            { text: `${getIcon(rules.allowForward)} Allow Forwards`, callback_data: 'admin_toggle_grp_allowForward' }
                        ],
                        [
                            { text: `${getIcon(rules.blockEmails)} Block Emails`, callback_data: 'admin_toggle_grp_blockEmails' },
                            { text: `${getIcon(rules.blockCC)} Block CC`, callback_data: 'admin_toggle_grp_blockCC' }
                        ],
                        [
                            { text: `${getIcon(rules.blockBusiness)} Block Business`, callback_data: 'admin_toggle_grp_blockBusiness' }
                        ],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // TOGGLE GROUP SETTINGS
        else if (data.startsWith('admin_toggle_grp_')) {
            if (!isAdmin(userId)) return;

            const key = data.replace('admin_toggle_grp_', '');
            db.toggleGroupSetting(key);

            // Refresh menu
            const rules = db.getGroupSettings(); // Get updated rules

            // Re-render the menu (Copy-paste logic from above to refresh inline buttons)
            // But efficiently, we can just trigger the main menu content again
            // Or better, just call the edit logic again.
            // Since this is inside 'callback_query', we can just recursively call with 'admin_group_controller' data?
            // No, recursion here is tricky with `data`. Let's just update the message.

            const getIcon = (val) => val ? '✅' : '❌';
            const msg = `👮 **Group Controller System**\n\n` +
                `Manage automated moderation for groups.\n` +
                `_Tap to toggle settings:_\n\n` +
                `👋 **Welcome Msg:** ${rules.welcome ? 'ON' : 'OFF'}\n` +
                `🧹 **Clean Service Msg:** ${rules.cleanService ? 'ON' : 'OFF'}\n` +
                `🔗 **Allow Links/Mentions:** ${rules.allowLinks ? 'YES' : 'BLOCK & WARN'}\n` +
                `📷 **Allow Photos:** ${rules.allowPhotos ? 'YES' : 'NO'}\n` +
                `📂 **Allow Files:** ${rules.allowFiles ? 'YES' : 'NO'}\n` +
                `🎤 **Allow Voice:** ${rules.allowVoice ? 'YES' : 'NO'}\n` +
                `↪️ **Allow Forwards:** ${rules.allowForward ? 'YES' : 'NO'}\n` +
                `📧 **Block Emails:** ${rules.blockEmails ? 'ON (Delete Only)' : 'OFF'}\n` +
                `💳 **Block CC/Numbers:** ${rules.blockCC ? 'ON (Delete Only)' : 'OFF'}`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: `${getIcon(rules.welcome)} Welcome`, callback_data: 'admin_toggle_grp_welcome' },
                            { text: `${getIcon(rules.cleanService)} Clean Join/Left`, callback_data: 'admin_toggle_grp_cleanService' }
                        ],
                        [
                            { text: `${getIcon(rules.allowLinks)} Allow Links`, callback_data: 'admin_toggle_grp_allowLinks' },
                            { text: `${getIcon(rules.allowPhotos)} Allow Photos`, callback_data: 'admin_toggle_grp_allowPhotos' }
                        ],
                        [
                            { text: `${getIcon(rules.allowFiles)} Allow Files`, callback_data: 'admin_toggle_grp_allowFiles' },
                            { text: `${getIcon(rules.allowVoice)} Allow Voice`, callback_data: 'admin_toggle_grp_allowVoice' }
                        ],
                        [
                            { text: `${getIcon(rules.allowForward)} Allow Forwards`, callback_data: 'admin_toggle_grp_allowForward' }
                        ],
                        [
                            { text: `${getIcon(rules.blockEmails)} Block Emails`, callback_data: 'admin_toggle_grp_blockEmails' },
                            { text: `${getIcon(rules.blockCC)} Block CC`, callback_data: 'admin_toggle_grp_blockCC' }
                        ],
                        [
                            { text: `${getIcon(rules.blockBusiness)} Block Business`, callback_data: 'admin_toggle_grp_blockBusiness' }
                        ],
                        [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: MANAGE TASKS
        else if (data === 'admin_manage_tasks') {
            if (!isAdmin(userId)) return;

            // List tasks with edit/delete options
            const tasks = db.getTasks();
            const taskKeys = Object.keys(tasks);

            if (taskKeys.length === 0) {
                bot.editMessageText("📋 **No active tasks.**\n\nCreate a new task to get started.", {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➕ Create New Task', callback_data: 'admin_new_task' }],
                            [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                let msg = "📋 **Current Tasks:**\n\n";
                const taskButtons = [];

                taskKeys.forEach(k => {
                    msg += `• **${tasks[k].name}**\n  Reward: ${tasks[k].reward} credits\n  ID: \`${k}\`\n\n`;
                    taskButtons.push([
                        { text: `✏️ ${tasks[k].name}`, callback_data: `admin_edit_task_${k}` }
                    ]);
                });

                taskButtons.push([{ text: '➕ Create New Task', callback_data: 'admin_new_task' }]);
                taskButtons.push([{ text: '🔙 Back', callback_data: 'admin_panel' }]);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: taskButtons },
                    parse_mode: 'Markdown'
                });
            }
        }

        // ADMIN: EDIT TASK (Show Options)
        else if (data.startsWith('admin_edit_task_')) {
            const taskId = data.replace('admin_edit_task_', '');
            const tasks = db.getTasks();
            const task = tasks[taskId];

            if (!task) {
                bot.answerCallbackQuery(query.id, { text: "Task not found", show_alert: true });
                return;
            }

            const msg = `**Edit Task**\n\n` +
                `📝 Name: ${task.name}\n` +
                `🔗 Link: ${task.url}\n` +
                `💰 Current Reward: **${task.reward} credits**\n\n` +
                `What would you like to do?`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Change Reward', callback_data: `admin_change_reward_${taskId}` }],
                        [{ text: '🗑 Delete Task', callback_data: `admin_delete_task_confirm_${taskId}` }],
                        [{ text: '🔙 Back to Tasks', callback_data: 'admin_manage_tasks' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: CHANGE TASK REWARD
        else if (data.startsWith('admin_change_reward_')) {
            const taskId = data.replace('admin_change_reward_', '');
            userState[userId] = { action: 'admin_input_task_reward', taskId: taskId };
            bot.sendMessage(chatId, "💰 **Enter new reward amount** (e.g., 50):", { parse_mode: 'Markdown' });
        }

        // ADMIN: DELETE TASK CONFIRM
        else if (data.startsWith('admin_delete_task_confirm_')) {
            const taskId = data.replace('admin_delete_task_confirm_', '');
            const success = db.deleteTask(taskId);

            if (success) {
                bot.answerCallbackQuery(query.id, { text: "✅ Task deleted successfully", show_alert: true });
                bot.deleteMessage(chatId, msgId).catch(() => { });
                bot.sendMessage(chatId, "✅ Task has been deleted.");
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ Task not found", show_alert: true });
            }
        }

        // ADMIN: SEARCH USER PROMPT
        else if (data === 'admin_search_user_prompt') {
            userState[userId] = { action: 'admin_search_user' };
            bot.sendMessage(chatId, "🔍 **Search User**\n\nEnter the User ID:", { parse_mode: 'Markdown' });
        }

        // ADMIN: NEW TASK
        else if (data === 'admin_new_task') {
            userState[userId] = { action: 'admin_input_task_name' };
            bot.sendMessage(chatId, "📝 **Create New Task**\n\nEnter the Task Name (e.g. Join Channel):", { parse_mode: 'Markdown' });
        }

        // ADMIN: BLOCK USER
        else if (data.startsWith('admin_block_usr_')) {
            const targetId = data.replace('admin_block_usr_', '');
            const targetUser = db.getUser(targetId);
            if (targetUser) {
                targetUser.blocked = true;
                db.save();
                bot.answerCallbackQuery(query.id, { text: "✅ User blocked successfully", show_alert: true });
                bot.editMessageText(`🚫 User \`${targetId}\` has been **BLOCKED**.`, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Unblock User', callback_data: `admin_unblock_usr_${targetId}` }],
                            [{ text: '🔙 Back to User', callback_data: `admin_msg_usr_${targetId}` }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ User not found", show_alert: true });
            }
        }

        // ADMIN: UNBLOCK USER
        else if (data.startsWith('admin_unblock_usr_')) {
            const targetId = data.replace('admin_unblock_usr_', '');
            const targetUser = db.getUser(targetId);
            if (targetUser) {
                targetUser.blocked = false;
                db.save();
                bot.answerCallbackQuery(query.id, { text: "✅ User unblocked successfully", show_alert: true });
                bot.editMessageText(`✅ User \`${targetId}\` has been **UNBLOCKED**.`, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚫 Block User', callback_data: `admin_block_usr_${targetId}` }],
                            [{ text: '🔙 Back to User', callback_data: `admin_msg_usr_${targetId}` }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ User not found", show_alert: true });
            }
        }

        // ==================== BROADCAST SYSTEM ====================

        // ADMIN: BROADCAST MENU
        else if (data === 'admin_broadcast') {
            if (!isAdmin(userId)) return;

            const scheduled = db.getScheduledBroadcasts();
            const scheduledCount = scheduled.length;

            const msg = `📣 **Broadcast System**\n\n` +
                `Send messages to all bot users with custom buttons and links.\n\n` +
                `**Features:**\n` +
                `• Text, Photo, Video support\n` +
                `• Custom inline buttons\n` +
                `• Preview before sending\n` +
                `• Schedule for later\n` +
                `• Real-time progress tracking\n\n` +
                `📅 Scheduled: **${scheduledCount}** broadcasts`;

            bot.editMessageText(msg, {
                chat_id: chatId,
                message_id: msgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 New Broadcast', callback_data: 'admin_broadcast_new' }],
                        [{ text: '📅 View Scheduled', callback_data: 'admin_broadcast_scheduled' }],
                        [{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]
                    ]
                },
                parse_mode: 'Markdown'
            });
        }

        // ADMIN: START NEW BROADCAST
        else if (data === 'admin_broadcast_new') {
            userState[userId] = {
                action: 'broadcast_compose',
                message: null,
                buttons: [],
                mediaType: null,
                mediaId: null
            };

            const msg = `📝 **Compose Broadcast Message**\n\n` +
                `**Step 1:** Send your message content\n\n` +
                `You can send:\n` +
                `• Text message\n` +
                `• Photo with caption\n` +
                `• Video with caption\n\n` +
                `After sending, you'll be able to add buttons.`;

            bot.sendMessage(chatId, msg, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '❌ Cancel', callback_data: 'admin_broadcast' }]
                    ]
                }
            });
        }

        // ADMIN: ADD BUTTON TO BROADCAST
        else if (data === 'broadcast_add_button') {
            const state = userState[userId];
            if (!state || state.action !== 'broadcast_compose') return;

            // Edit the options message to show button input instruction
            if (state.optionsMessageId) {
                try {
                    await bot.editMessageText(
                        `🔘 **Add Button - Step 1/2**\n\n📝 Send the button text (e.g., "Visit Website"):`,
                        {
                            chat_id: chatId,
                            message_id: state.optionsMessageId,
                            parse_mode: 'Markdown'
                        }
                    );
                } catch (e) {
                    bot.sendMessage(chatId, `🔘 **Add Button - Step 1/2**\n\n📝 Send the button text (e.g., "Visit Website"):`, { parse_mode: 'Markdown' });
                }
            }
            userState[userId].action = 'broadcast_button_text';
        }

        // ADMIN: PREVIEW BROADCAST
        else if (data === 'broadcast_preview') {
            const state = userState[userId];
            if (!state) return;
            if (!state.mediaType && !state.message) return;

            try {
                const buttons = state.buttons.length > 0 ? { inline_keyboard: state.buttons } : null;

                if (state.mediaType === 'photo') {
                    bot.sendPhoto(chatId, state.mediaId, {
                        caption: `📋 **PREVIEW**\n\n${state.message || ''}`,
                        parse_mode: 'Markdown',
                        reply_markup: buttons
                    });
                } else if (state.mediaType === 'video') {
                    bot.sendVideo(chatId, state.mediaId, {
                        caption: `📋 **PREVIEW**\n\n${state.message || ''}`,
                        parse_mode: 'Markdown',
                        reply_markup: buttons
                    });
                } else {
                    bot.sendMessage(chatId, `📋 **PREVIEW**\n\n${state.message}`, {
                        parse_mode: 'Markdown',
                        reply_markup: buttons
                    });
                }

                bot.sendMessage(chatId, "Preview sent above ☝️");
            } catch (error) {
                bot.sendMessage(chatId, `❌ Preview error: ${error.message}`);
            }
        }

        // ADMIN: SEND BROADCAST
        else if (data === 'broadcast_send_confirm') {
            const state = userState[userId];
            if (!state) return;

            if (!state.mediaType && !state.message) {
                return bot.answerCallbackQuery(query.id, { text: "❌ No message to send", show_alert: true });
            }

            bot.answerCallbackQuery(query.id, { text: "📤 Starting broadcast...", show_alert: false });

            const users = Object.values(db.data.users || {});
            const totalUsers = users.length;
            let successCount = 0;
            let failCount = 0;

            const buttons = state.buttons.length > 0 ? { inline_keyboard: state.buttons } : null;

            bot.sendMessage(chatId, `📣 **Broadcasting...**\n\nTotal Users: ${totalUsers}\n\n⏳ Please wait...`, { parse_mode: 'Markdown' });

            // Send to all users
            (async () => {
                for (const user of users) {
                    try {
                        const opts = {
                            caption: state.message,
                            parse_mode: 'Markdown',
                            reply_markup: buttons
                        };

                        if (state.mediaType === 'photo') {
                            await bot.sendPhoto(user.id, state.mediaId, opts);
                        } else if (state.mediaType === 'video') {
                            await bot.sendVideo(user.id, state.mediaId, opts);
                        } else {
                            await bot.sendMessage(user.id, state.message, { ...opts, caption: undefined });
                        }
                        successCount++;
                    } catch (error) {
                        // Retry without Markdown if parse error
                        if (error.response && error.response.body && error.response.body.description.includes('parse')) {
                            try {
                                const plainOpts = {
                                    caption: state.message,
                                    reply_markup: buttons
                                };
                                if (state.mediaType === 'photo') {
                                    await bot.sendPhoto(user.id, state.mediaId, plainOpts);
                                } else if (state.mediaType === 'video') {
                                    await bot.sendVideo(user.id, state.mediaId, plainOpts);
                                } else {
                                    await bot.sendMessage(user.id, state.message, { ...plainOpts, caption: undefined });
                                }
                                successCount++;
                            } catch (e) {
                                failCount++;
                                console.log(`Failed retry to user ${user.id}:`, e.message);
                            }
                        } else {
                            failCount++;
                            console.log(`Failed to send to user ${user.id}:`, error.message);
                        }
                    }

                    // Delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Send report
                bot.sendMessage(chatId,
                    `✅ **Broadcast Complete!**\n\n` +
                    `📊 **Results:**\n` +
                    `✅ Successful: ${successCount}\n` +
                    `❌ Failed: ${failCount}\n` +
                    `📈 Total: ${totalUsers}`,
                    { parse_mode: 'Markdown' }
                );

                delete userState[userId];
            })();
        }

        // ADMIN: CANCEL BROADCAST
        else if (data === 'broadcast_cancel') {
            delete userState[userId];
            bot.answerCallbackQuery(query.id, { text: "❌ Broadcast cancelled", show_alert: false });
            bot.deleteMessage(chatId, msgId).catch(() => { });
        }

        // ADMIN: SCHEDULE BROADCAST
        else if (data === 'broadcast_schedule') {
            const state = userState[userId];
            if (!state || !state.message) {
                return bot.answerCallbackQuery(query.id, { text: "❌ No message to schedule", show_alert: true });
            }

            userState[userId].action = 'broadcast_schedule_datetime';
            bot.sendMessage(chatId,
                `🕒 **Schedule Broadcast**\n\n` +
                `Send the date and time when you want to broadcast.\n\n` +
                `**Format:** \`DD/MM/YYYY HH:MM\`\n` +
                `**Example:** \`09/02/2026 15:30\`\n\n` +
                `Current time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Shanghai' })}`,
                { parse_mode: 'Markdown' }
            );
        }

        // ADMIN: VIEW SCHEDULED BROADCASTS
        else if (data === 'admin_broadcast_scheduled') {
            const scheduled = db.getScheduledBroadcasts();

            if (scheduled.length === 0) {
                bot.editMessageText('📅 **No scheduled broadcasts**\n\nAll broadcasts have been sent or there are no schedules.', {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔙 Back', callback_data: 'admin_broadcast' }]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } else {
                let msg = '📅 **Scheduled Broadcasts:**\n\n';
                const buttons = [];

                scheduled.forEach((b, index) => {
                    const scheduleTime = new Date(b.scheduledTime).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai' });
                    const preview = b.message.substring(0, 50) + (b.message.length > 50 ? '...' : '');
                    msg += `${index + 1}. **${scheduleTime}**\n   ${preview}\n\n`;

                    buttons.push([
                        { text: `❌ Cancel #${index + 1}`, callback_data: `broadcast_cancel_scheduled_${b.id}` }
                    ]);
                });

                buttons.push([{ text: '🔙 Back', callback_data: 'admin_broadcast' }]);

                bot.editMessageText(msg, {
                    chat_id: chatId,
                    message_id: msgId,
                    reply_markup: { inline_keyboard: buttons },
                    parse_mode: 'Markdown'
                });
            }
        }

        // ADMIN: CANCEL SCHEDULED BROADCAST
        else if (data.startsWith('broadcast_cancel_scheduled_')) {
            const broadcastId = data.replace('broadcast_cancel_scheduled_', '');
            const success = db.removeScheduledBroadcast(broadcastId);

            if (success) {
                bot.answerCallbackQuery(query.id, { text: "✅ Scheduled broadcast cancelled", show_alert: true });
                // Refresh the list
                bot.deleteMessage(chatId, msgId).catch(() => { });
                bot.sendMessage(chatId, "✅ Scheduled broadcast has been cancelled.");
            } else {
                bot.answerCallbackQuery(query.id, { text: "❌ Broadcast not found", show_alert: true });
            }
        }

        // ADMIN: NEW TASK FLOW
        else if (data === 'admin_new_task') {
            userState[userId] = { action: 'admin_new_task_name' };
            bot.sendMessage(chatId, "Enter **Task Description/Name** (e.g. 'Join Channel'):", { parse_mode: 'Markdown' });
        }

        // ADMIN: DELETE TASK FLOW
        else if (data === 'admin_delete_task') {
            userState[userId] = { action: 'admin_delete_task_id' };
            bot.sendMessage(chatId, "Enter **Task ID** to delete (copy from list):", { parse_mode: 'Markdown' });
        }

        // ADMIN: CREATE CODE
        else if (data === 'admin_create_code') {
            userState[userId] = { action: 'admin_create_code_input' };
            bot.sendMessage(chatId, "Format: `CODE AMOUNT USES`\nExample: `SALE50 500 10`", { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Callback Error:', error);
        try {
            if (query && query.id) {
                bot.answerCallbackQuery(query.id, { text: "❌ Error: " + error.message, show_alert: true });
            }
        } catch (e) { }
    }
});

// MESSAGE HANDLER
bot.on('message', async (msg) => {
    // ----------------------------------------------------
    // DEBOUNCE LOGIC (Prevent Double Message)
    // ----------------------------------------------------
    if (!msg.from) return;
    const userId = msg.from.id;
    const now = Date.now();
    const lastMsgTime = messageThrottle.get(userId) || 0;

    // Ignore messages sent within 1s of each other (Spam Prevention)
    if (now - lastMsgTime < 1000) {
        return;
    }
    messageThrottle.set(userId, now);
    const chatId = msg.chat.id;

    const text = msg.text || '';
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    // Log user message activity (but not commands)
    if (text && !text.startsWith('/') && text.length > 0) {
        originalConsoleLog(`👤 User: ${userId} (${username}) | 📝 Message: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''} | ⏰ ${new Date().toLocaleTimeString()}`);
    }

    // Allow (empty text + document) OR (text not starting with /)
    // If text is empty AND no document, ignore.
    if ((!text && !msg.document) || text.startsWith('/')) return;

    const state = userState[userId];

    // ADMIN: ADD GMAIL SERVICE
    if (state && state.action === 'admin_add_gmail_svc_input') {
        const parts = text.split(' ');
        if (parts.length < 3) {
            return bot.sendMessage(chatId, "❌ Invalid Format. Use: `ID Name Price`\nExample: `gemini Gemini_AI 20`", { parse_mode: 'Markdown' });
        }

        const id = parts[0].toLowerCase();
        const name = parts[1].replace(/_/g, ' ');
        const price = parseInt(parts[2]);

        if (isNaN(price)) return bot.sendMessage(chatId, "❌ Price must be a number.");

        const success = db.createEmailService(id, name, price);
        if (success) {
            delete userState[userId];
            bot.sendMessage(chatId, `✅ Service **${name}** created!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "❌ Service ID already exists.");
        }
        return;
    }

    // ==================== ADMIN ADD NUMBER SERVICE WIZARD ====================

    // Step 1: Title
    if (state && state.action === 'admin_ns_title') {
        const title = text.trim();
        if (title.length < 3) return bot.sendMessage(chatId, "⚠️ Title too short. Try again:");

        userState[userId] = { ...state, action: 'admin_ns_url', data: { ...state.data, title } };
        bot.sendMessage(chatId, `✅ Title set: **${title}**\n\nNow enter the **API URL**:\n(e.g. \`https://api.sms-provider.com/request\`)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 2: URL
    if (state && state.action === 'admin_ns_url') {
        let url = text.trim();
        if (!url.startsWith('http')) return bot.sendMessage(chatId, "⚠️ Invalid URL. Must start with http/https. Try again:");

        userState[userId] = { ...state, action: 'admin_ns_key', data: { ...state.data, url } };
        bot.sendMessage(chatId, `✅ URL set.\n\nNow enter the **API Key**:\n(Send 'none' if empty)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 3: Key
    if (state && state.action === 'admin_ns_key') {
        const key = text.trim();
        userState[userId] = { ...state, action: 'admin_ns_cost', data: { ...state.data, apiKey: key === 'none' ? '' : key } };
        bot.sendMessage(chatId, `✅ Key set.\n\nNow enter the **Cost (Credits per SMS)**:\n(e.g. \`0.5\`)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 4: Cost
    if (state && state.action === 'admin_ns_cost') {
        const cost = parseFloat(text);
        if (isNaN(cost) || cost < 0) return bot.sendMessage(chatId, "⚠️ Invalid cost. Enter a number (e.g. 0.5):");

        userState[userId] = { ...state, action: 'admin_ns_countries', data: { ...state.data, cost } };
        bot.sendMessage(chatId, `✅ Cost set: ${cost} Cr.\n\nFinally, enter the **Country Code** for this service:\n(e.g. \`US\` for USA, \`BD\` for Bangladesh)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 5: Countries & Finish
    if (state && state.action === 'admin_ns_countries') {
        const raw = text.trim().toUpperCase();
        const countries = raw === 'ALL' ? [] : raw.split(',').map(c => c.trim()).filter(c => c.length > 0);

        const finalData = {
            id: `NS-${Date.now()}`,
            title: state.data.title,
            type: 'sms_gateway', // Default for now
            apiUrl: state.data.url,
            apiKey: state.data.apiKey,
            cost: state.data.cost,
            countries: countries,
            status: 'online', // Default online
            lastCheck: Date.now()
        };

        db.saveNumberService(finalData.id, finalData);
        delete userState[userId];

        bot.sendMessage(chatId, `🎉 **Provider Added Successfully!**\n\nTitle: ${finalData.title}\nID: ${finalData.id}`, { parse_mode: 'Markdown' });
        // Optionally redirect back to menu
        return;
    }

    // ==================== ADMIN SMS GATEWAY WIZARD (NEW) ====================

    // Step 1: Name
    if (state && state.action === 'admin_gw_name') {
        const name = text.trim();
        if (name.length < 3) return bot.sendMessage(chatId, "⚠️ Name too short.");

        userState[userId] = { ...state, action: 'admin_gw_host', data: { ...state.data, name } };
        bot.sendMessage(chatId, `✅ Name set: **${name}**\n\nNow enter the **API Host URL**:\n(e.g. \`https://rapidapi.com/...\`)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 2: Host
    if (state && state.action === 'admin_gw_host') {
        const host = text.trim();
        userState[userId] = { ...state, action: 'admin_gw_key', data: { ...state.data, apiHost: host } };
        bot.sendMessage(chatId, `✅ Host set.\n\nNow enter the **API Key**:\n(Send 'none' if empty)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 3: Key (Finish)
    if (state && state.action === 'admin_gw_key') {
        const key = text.trim();
        const gatewayData = {
            id: `GW-${Date.now()}`,
            name: state.data.name,
            apiHost: state.data.apiHost,
            apiKey: key === 'none' ? '' : key,
            type: 'generic_rapidapi' // Default type
        };

        db.saveSmsGateway(gatewayData.id, gatewayData);
        delete userState[userId];
        bot.sendMessage(chatId, `🎉 **Gateway Added!**\n\nName: ${gatewayData.name}`, { parse_mode: 'Markdown' });
        return;
    }

    // ==================== ADMIN COUNTRY SERVICE WIZARD (NEW) ====================

    // Step 1: Title
    if (state && state.action === 'admin_svc_title') {
        const title = text.trim();

        // Ensure gatewayId exists in state
        if (!state.data.gatewayId) return bot.sendMessage(chatId, "❌ Error: No Gateway ID found.");

        userState[userId] = { ...state, action: 'admin_svc_cost', data: { ...state.data, title } };
        bot.sendMessage(chatId, `✅ Title set.\n\nNow enter the **Price (Credits)**:\n(e.g. 0.5)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 2: Cost
    if (state && state.action === 'admin_svc_cost') {
        const cost = parseFloat(text);
        if (isNaN(cost)) return bot.sendMessage(chatId, "⚠️ Invalid cost.");

        userState[userId] = { ...state, action: 'admin_svc_code', data: { ...state.data, cost } };
        bot.sendMessage(chatId, `✅ Cost set.\n\nFinally, enter the **Country Code/ID**:\n(e.g. US, BD, 187)`, { parse_mode: 'Markdown' });
        return;
    }

    // Step 3: Code (Finish)
    if (state && state.action === 'admin_svc_code') {
        const code = text.trim().toUpperCase();

        const serviceData = {
            id: `NS-${Date.now()}`,
            gatewayId: state.data.gatewayId, // Linked to Gateway
            title: state.data.title,
            cost: state.data.cost,
            countryCode: code,
            countries: [code], // For backward compatibility
            status: 'online',
            type: 'sms_gateway_linked'
        };

        db.saveNumberService(serviceData.id, serviceData);
        delete userState[userId];
        bot.sendMessage(chatId, `🎉 **Service Created!**\n\nLinked to Gateway.`, { parse_mode: 'Markdown' });
        return;
    }



    // DATABASE: GOOGLE DRIVE CREDENTIALS INPUT
    if (state && state.action === 'db_input_config' && state.dbType === 'google_drive') {
        const lines = text.trim().split('\n');
        const config = {};

        for (const line of lines) {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                config[key.trim()] = valueParts.join('=').trim();
            }
        }

        // Validate required fields
        if (!config.clientId || !config.clientSecret || !config.accessToken || !config.refreshToken) {
            return bot.sendMessage(chatId,
                `❌ **Missing credentials!**\n\n` +
                `Required fields:\n` +
                `• clientId\n` +
                `• clientSecret\n` +
                `• accessToken\n` +
                `• refreshToken\n\n` +
                `Please send again in correct format.`,
                { parse_mode: 'Markdown' }
            );
        }

        // Try to connect
        bot.sendMessage(chatId, '🔄 **Connecting to Google Drive...**', { parse_mode: 'Markdown' });

        try {
            const unifiedDb = require('./database/unified-db');
            const result = await unifiedDb.connectGoogleDrive({
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                accessToken: config.accessToken,
                refreshToken: config.refreshToken
            });

            if (result.success) {
                // Connection successful, now migrate data
                bot.sendMessage(chatId, '✅ **Connected!**\n\n🔄 **Migrating data to Google Drive...**', { parse_mode: 'Markdown' });

                const migrateResult = await unifiedDb.migrateToGoogleDrive();

                if (migrateResult.success) {
                    const status = await unifiedDb.getStorageStatus();

                    bot.sendMessage(chatId,
                        `🎉 **Google Drive Connected Successfully!**\n\n` +
                        `📊 **Storage Info:**\n` +
                        `• Total: ${status.total}\n` +
                        `• Used: ${status.used}\n` +
                        `• Free: ${status.free}\n` +
                        `• User: ${status.user}\n\n` +
                        `✅ All data migrated to Google Drive\n` +
                        `✅ Local storage cleared\n` +
                        `✅ Bot now using Google Drive!\n\n` +
                        `🗂️ Data folder: "TelegramBotData"`,
                        { parse_mode: 'Markdown' }
                    );
                } else {
                    bot.sendMessage(chatId, `❌ Migration failed: ${migrateResult.message}`, { parse_mode: 'Markdown' });
                }
            } else {
                bot.sendMessage(chatId, `❌ Connection failed: ${result.message}`, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`, { parse_mode: 'Markdown' });
        }

        delete userState[userId];
        return;
    }

    // DATABASE: POSTGRESQL/MYSQL/MONGODB CREDENTIALS INPUT
    if (state && state.action === 'db_input_config' && ['postgresql', 'mysql', 'mongodb'].includes(state.dbType)) {
        const lines = text.trim().split('\n');
        const config = { dbType: state.dbType };

        for (const line of lines) {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
                const value = valueParts.join('=').trim();
                config[key.trim()] = value === 'true' ? true : value === 'false' ? false : value;
            }
        }

        // Set defaults
        if (!config.port) {
            config.port = state.dbType === 'postgresql' ? 5432 : state.dbType === 'mysql' ? 3306 : 27017;
        }
        if (config.ssl === undefined) config.ssl = false;
        if (!config.connectionName) config.connectionName = `${state.dbType}_${Date.now()}`;

        // Validate
        if (!config.host || !config.database || !config.username || !config.password) {
            return bot.sendMessage(chatId,
                `❌ **Missing required fields!**\n\n` +
                `Required:\n• host\n• database\n• username\n• password`,
                { parse_mode: 'Markdown' }
            );
        }

        // Try to connect
        bot.sendMessage(chatId, `🔄 **Connecting to ${state.dbType}...**`, { parse_mode: 'Markdown' });

        try {
            const connectionManager = require('./database/connection-manager');
            const result = await connectionManager.connect(config);

            if (result.success) {
                // Initialize schema
                const repository = require('./database/repository');
                await repository.initialize();

                bot.sendMessage(chatId,
                    `✅ **${state.dbType.toUpperCase()} Connected!**\n\n` +
                    `🌐 Host: ${config.host}\n` +
                    `📁 Database: ${config.database}\n\n` +
                    `✅ Schema initialized\n` +
                    `✅ Ready to use!`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                bot.sendMessage(chatId, `❌ Connection failed: ${result.message}`, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`, { parse_mode: 'Markdown' });
        }

        delete userState[userId];
        return;
    }

    // DATABASE: SQLITE INPUT
    if (state && state.action === 'db_input_config' && state.dbType === 'sqlite') {
        const dbPath = text.trim().includes('=') ? text.trim().split('=')[1] : text.trim();

        bot.sendMessage(chatId, '🔄 **Setting up SQLite...**', { parse_mode: 'Markdown' });

        try {
            const connectionManager = require('./database/connection-manager');
            const result = await connectionManager.connect({
                dbType: 'sqlite',
                database: dbPath,
                connectionName: 'sqlite_local'
            });

            if (result.success) {
                const repository = require('./database/repository');
                await repository.initialize();

                bot.sendMessage(chatId,
                    `✅ **SQLite Connected!**\n\n` +
                    `📁 Database: ${dbPath}\n\n` +
                    `✅ Schema initialized\n` +
                    `✅ Ready to use!`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                bot.sendMessage(chatId, `❌ Connection failed: ${result.message}`, { parse_mode: 'Markdown' });
            }

        } catch (error) {
            bot.sendMessage(chatId, `❌ Error: ${error.message}`, { parse_mode: 'Markdown' });
        }

        delete userState[userId];
        return;
    }

    // ADMIN: UPLOAD GMAIL STOCK
    if (state && state.action === 'admin_upload_gmail_stock_input') {
        const lines = text.split('\n');
        const emails = [];
        let added = 0;

        lines.forEach(line => {
            let parts = line.split('|');
            if (parts.length < 2) parts = line.split(':'); // Try colon

            if (parts.length >= 2) {
                const em = parts[0].trim();
                const pw = parts[1].trim();
                if (em && pw) {
                    emails.push({ email: em, password: pw });
                    added++;
                }
            }
        });

        if (added > 0) {
            db.addEmailStock(state.serviceId, emails);
            bot.sendMessage(chatId, `✅ Added **${added}** emails to **${state.serviceId}** stock.`, { parse_mode: 'Markdown' });
            delete userState[userId];
        } else {
            bot.sendMessage(chatId, "❌ No valid `email|password` pairs found.");
        }
        return;
    }

    // ==================== GROUP CONTROLLER LOGIC ====================
    if (msg.chat.type === 'supergroup' || msg.chat.type === 'group') {
        const rules = db.getGroupSettings();

        // Skip channel posts (messages sent via connected channel)
        // msg.sender_chat exists when message is from a channel
        if (msg.sender_chat) {
            return; // Don't process any filters for channel posts
        }

        let isGroupAdmin = false;
        try {
            const member = await bot.getChatMember(chatId, userId);
            isGroupAdmin = (member.status === 'administrator' || member.status === 'creator');
        } catch (e) { }

        // 1. DELETE SERVICE MESSAGES
        if (rules.cleanService) {
            // Join/Leave -> Always delete to keep chat clean
            if (msg.new_chat_members || msg.left_chat_member) {
                bot.deleteMessage(chatId, msg.message_id).catch(() => { });
            }
            // Admin Actions (Pin, Title, Photo) -> Protect if Admin
            else if (msg.pinned_message || msg.new_chat_title || msg.new_chat_photo || msg.delete_chat_photo) {
                if (!isGroupAdmin && !isAdmin(userId)) {
                    bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                }
            }
            // Group Created -> Delete
            else if (msg.group_chat_created || msg.supergroup_chat_created) {
                bot.deleteMessage(chatId, msg.message_id).catch(() => { });
            }
        }

        // 2. WELCOME MESSAGE (Separate from Admin Check to welcome everyone)
        if (rules.welcome && msg.new_chat_members) {
            msg.new_chat_members.forEach(newUser => {
                if (!newUser.is_bot) {
                    bot.sendMessage(chatId, `👋 Welcome to the group, ${newUser.first_name}!`).catch(() => { });
                }
            });
        }

        // Allow Admins to bypass CONTENT POLICING
        if (!isGroupAdmin && !isAdmin(userId)) {

            // 3. CONTENT POLICING
            let deleteReason = null;

            if (!rules.allowPhotos && msg.photo) deleteReason = "Photos are not allowed.";
            else if (!rules.allowFiles && msg.document) deleteReason = "Files are not allowed.";
            else if (!rules.allowVoice && (msg.voice || msg.audio)) deleteReason = "Voice messages are not allowed.";
            else if (!rules.allowForward && (msg.forward_from || msg.forward_from_chat)) deleteReason = "Forwarding is not allowed.";

            if (deleteReason) {
                bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                return;
            }

            // Check Text Content (Text or Caption)
            const contentOriginal = (msg.text || msg.caption || '');
            const content = contentOriginal.toLowerCase();

            if (content) {
                // 4. BUSINESS / ADS FILTER (New)
                if (rules.blockBusiness) {
                    const businessKeywords = [
                        'sell', 'selling', 'sold', 'bikri', 'sale',
                        'buy', 'buying', 'kinbo', 'kinte', 'chai',
                        'price', 'dam', 'cost', 'rate', 'taka',
                        'inbox', 'dm me', 'pm me', 'check ib',
                        'payment', 'bkash', 'nagad', 'rocket', 'usdt', 'binance', 'crypto',
                        'stock', 'available', 'offer', 'deal', 'cheap', 'discount'
                    ];

                    const isBusiness = businessKeywords.some(kw => {
                        // Use word boundary for short common words to avoid false positives
                        if (['dam', 'buy', 'sell', 'cost', 'pay', 'rate', 'chai'].includes(kw)) {
                            return new RegExp(`\\b${kw}\\b`, 'i').test(contentOriginal);
                        }
                        return content.includes(kw);
                    });

                    if (isBusiness) {
                        let isAllowed = false;

                        // Exception 1: Message contains 'admin'
                        if (content.includes('admin')) {
                            isAllowed = true;
                        }

                        // Exception 2: Replying to an Admin
                        if (!isAllowed && msg.reply_to_message) {
                            try {
                                const repliedUserId = msg.reply_to_message.from.id;
                                const repliedMember = await bot.getChatMember(chatId, repliedUserId);
                                if (repliedMember.status === 'administrator' || repliedMember.status === 'creator') {
                                    isAllowed = true;
                                }
                            } catch (e) { }
                        }

                        if (!isAllowed) {
                            bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                            return; // Stop processing
                        }
                    }
                }

                // 5. SENSITIVE DATA (Email & CC) - NO BAN, JUST DELETE
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
                const ccRegex = /\d{15,16}[|/]\d{2}[|/]\d{2,4}[|/]\d{3,4}/;
                const multiNumRegex = /(\d{4,}\s*){4,}/;

                if (rules.blockEmails && emailRegex.test(contentOriginal)) {
                    bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                    return;
                }

                if (rules.blockCC && (ccRegex.test(contentOriginal) || multiNumRegex.test(contentOriginal))) {
                    bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                    return;
                }

                // 6. LINK & MENTION HANDLING (WARN -> BLOCK)
                if (!rules.allowLinks) {
                    const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)/i;
                    const mentionRegex = /@\w+/;

                    if (linkRegex.test(contentOriginal) || mentionRegex.test(contentOriginal)) {
                        bot.deleteMessage(chatId, msg.message_id).catch(() => { });

                        const warnings = db.addWarning(chatId, userId);
                        const maxWarnings = 3;

                        if (warnings >= maxWarnings) {
                            // Restrict User (Mute FOREVER)
                            bot.restrictChatMember(chatId, userId, {
                                permissions: { can_send_messages: false }
                                // until_date removed = Permanent
                            }).then(() => {
                                bot.sendMessage(chatId, `🚫 **Banned:** ${msg.from.first_name} has been muted permanently for spamming links.`);
                                db.resetWarnings(chatId, userId);
                            }).catch(e => {
                                // bot.sendMessage(chatId, `❌ I need admin permissions to mute users!`);
                            });
                        } else {
                            const warnMsg = await bot.sendMessage(chatId,
                                `⚠️ **Warning (${warnings}/${maxWarnings}):** ${msg.from.first_name}, links and mentions are not allowed!\n` +
                                `Next violation will result in a PERMANENT mute.`);

                            setTimeout(() => {
                                bot.deleteMessage(chatId, warnMsg.message_id).catch(() => { });
                            }, 5000);
                        }
                        return;
                    }
                }
            }
        }
    }

    // Get or create user
    const user = db.getUser(userId);

    // Update Username and Initialize Stats if missing
    user.username = msg.from.username || null;
    if (user.successfulVerifications === undefined) user.successfulVerifications = 0;
    if (user.failedVerifications === undefined) user.failedVerifications = 0;
    if (user.cardsPurchased === undefined) user.cardsPurchased = 0;
    if (user.blocked === undefined) user.blocked = false;
    db.save();

    // Check if Blocked
    if (user.blocked && !isAdmin(userId)) {
        return bot.sendMessage(chatId, "🚫 **Access Denied.** Your account has been blocked by the admin.", { parse_mode: 'Markdown' });
    }

    if (!userState[userId]) userState[userId] = {};

    // ADMIN: SEARCH USER
    if (state && state.action === 'admin_search_user') {
        const targetId = text.trim();

        // Validate that targetId is numeric
        if (!/^\d+$/.test(targetId)) {
            delete userState[userId];
            return bot.sendMessage(chatId, "❌ Invalid User ID. Please enter numbers only.");
        }

        const targetUser = db.getUser(targetId);

        // Check if user exists
        if (!targetUser) {
            delete userState[userId];
            return bot.sendMessage(chatId, "❌ User not found.");
        }

        // Ensure properties exist
        if (!targetUser.successfulVerifications) targetUser.successfulVerifications = 0;
        if (!targetUser.failedVerifications) targetUser.failedVerifications = 0;
        if (!targetUser.cardsPurchased) targetUser.cardsPurchased = 0;
        if (!targetUser.blocked) targetUser.blocked = false;

        delete userState[userId];

        const joinDate = new Date(targetUser.joinedAt).toLocaleDateString();
        const blockStatus = targetUser.blocked ? "🔴 BLOCKED" : "🟢 ACTIVE";
        const blockBtnText = targetUser.blocked ? "✅ Unblock User" : "🚫 Block User";
        const blockCallback = targetUser.blocked ? `admin_unblock_usr_${targetId}` : `admin_block_usr_${targetId}`;

        const msg = `👤 **User Details**\n\n` +
            `🆔 ID: \`${targetUser.id}\`\n` +
            `👤 Name: ${targetUser.username ? `@${targetUser.username}` : 'No Username'}\n` +
            `💰 Balance: **${targetUser.balance} Credits**\n` +
            `📅 Joined: ${joinDate}\n\n` +
            `📊 **Activity Stats:**\n` +
            `👥 Referrals: ${targetUser.referralCount || 0}\n` +
            `✅ Verified: **${targetUser.successfulVerifications}**\n` +
            `❌ Failed: **${targetUser.failedVerifications}**\n` +
            `💳 Cards Bought: **${targetUser.cardsPurchased}**\n\n` +
            `⚠️ Status: **${blockStatus}**`;

        bot.sendMessage(chatId, msg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '➕ Add Credits', callback_data: `admin_credit_add_${targetUser.id}` },
                        { text: '➖ Deduct Credits', callback_data: `admin_credit_sub_${targetUser.id}` }
                    ],
                    [
                        { text: blockBtnText, callback_data: blockCallback }
                    ],
                    [{ text: '🔙 Cancel', callback_data: 'admin_panel' }]
                ]
            }
        });
        return;
    }

    // ADMIN: EDIT BALANCE
    else if (state && state.action === 'admin_edit_balance') {
        const amount = parseInt(text);
        if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, "❌ Invalid amount. Enter a positive number.");

        const finalAmount = state.mode === 'add' ? amount : -amount;
        const newBalance = db.addCredit(state.target, finalAmount);

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Success!**\nUser \`${state.target}\` new balance: **${newBalance} Credits**`, { parse_mode: 'Markdown' });

        // Notify user
        try {
            bot.sendMessage(state.target, `🔔 Admin ${state.mode === 'add' ? 'added' : 'deducted'} **${amount} Credits** from your balance.\n💰 Current: ${newBalance}`);
        } catch (e) { }
        return;
    }

    // ADMIN: SET REFERRAL BONUS
    else if (state && state.action === 'admin_input_ref_bonus') {
        const amount = parseInt(text.trim());
        if (isNaN(amount) || amount < 0) {
            return bot.sendMessage(chatId, "❌ Invalid amount. Enter a positive number.");
        }

        db.updateSetting('refBonus', amount);
        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Referral Bonus Updated!**\n\nNew bonus: **${amount} Credits**`, { parse_mode: 'Markdown' });
    }

    // ADMIN: CREATE SERVICE (NAME)
    else if (state && state.action === 'admin_create_svc_name') {
        userState[userId] = { action: 'admin_create_svc_price', name: text.trim() };
        bot.sendMessage(chatId, "💰 **Enter Price** (e.g. 150):");
    }

    // ADMIN: CREATE SERVICE (PRICE)
    else if (state && state.action === 'admin_create_svc_price') {
        const price = parseInt(text);
        if (isNaN(price)) return bot.sendMessage(chatId, "❌ Invalid Price.");

        const serviceId = state.name.toLowerCase().replace(/[^a-z0-9]/g, ''); // simple slug
        db.createService(serviceId, state.name, price);

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Service Created:** ${state.name} (${price} cr)\nID: \`${serviceId}\``, { parse_mode: 'Markdown' });
    }

    // ADMIN: BULK ADD CARDS
    else if (state && state.action === 'admin_input_cards_bulk') {
        const lines = text.split('\n');
        const billingLines = [];
        const cardLines = [];

        // Simple heuristic: lines with '|' are cards, others are billing info
        lines.forEach(line => {
            if (line.includes('|')) cardLines.push(line.trim());
            else if (line.trim().length > 0) billingLines.push(line.trim());
        });

        if (cardLines.length === 0) {
            return bot.sendMessage(chatId, "❌ No card lines found (must contain '|'). Try again.");
        }

        const billingInfo = billingLines.join('\n');

        // Parse Billing Details
        let bState = 'N/A', bCity = 'N/A', bAddress = 'N/A', bZip = 'N/A', bType = 'N/A', bName = 'N/A';
        let bVpn = 'N/A', bCountry = 'N/A', bDistrict = 'N/A';

        billingLines.forEach(l => {
            const line = l.trim();
            const lower = line.toLowerCase();
            const parts = line.split(':');
            const val = parts.length > 1 ? parts.slice(1).join(':').trim() : '';

            if (!val) return;

            // Flexible matching
            if (lower.startsWith('vpn:')) bVpn = val;
            else if (lower.startsWith('country:')) bCountry = val;
            else if (lower.startsWith('district:')) bDistrict = val;
            else if (lower.startsWith('state:')) bState = val;
            else if (lower.startsWith('city:')) bCity = val;
            else if (lower.startsWith('address') || lower.startsWith('street')) bAddress = val;
            else if (lower.startsWith('postal') || lower.startsWith('zip')) bZip = val;
            else if (lower.startsWith('type:') || lower.startsWith('card type:')) bType = val;
            else if (lower.startsWith('name:') || lower.startsWith('full name:')) bName = val;
        });

        // Debug/Feedback String
        const billingSummary = `VPN: ${bVpn}, Country: ${bCountry}, Type: ${bType}, Name: ${bName}`;

        let count = 0;
        cardLines.forEach(line => {
            const parts = line.split('|').map(p => p.trim());
            // Support formats: Num|Exp|Year|CVV or Num|Exp|CVV
            let number, expiry, cvv, fullCard;

            if (parts.length >= 4) {
                number = parts[0];
                expiry = `${parts[1]}/${parts[2].slice(-2)}`; // MM/YYYY -> MM/YY
                cvv = parts[3];
                fullCard = `${number}|${parts[1]}|${parts[2]}|${cvv}`;
            } else if (parts.length === 3) {
                number = parts[0];
                expiry = parts[1];
                cvv = parts[2];
                fullCard = `${number}|${expiry}|${cvv}`;
            }

            if (number && number.length > 5) {
                db.addCard(state.service, {
                    full_billing_text: billingInfo,
                    vpn: bVpn,
                    country: bCountry,
                    district: bDistrict,
                    state: bState,
                    city: bCity,
                    address: bAddress,
                    zip: bZip,
                    type: bType,
                    name: bName,
                    number: number,
                    expiry: expiry,
                    cvv: cvv,
                    full_card: fullCard
                });
                count++;
            }
        });

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Success!** Added **${count}** cards to ${state.service.toUpperCase()}.\n\n🔍 **Captured Info:**\n\`${billingSummary}\``, { parse_mode: 'Markdown' });
    }

    // ==================== VPN INPUT HANDLERS ====================

    // ADMIN: CREATE EMAIL SERVICE (Step 1: Get Name, Ask Price)
    else if (state && state.action === 'admin_create_email_svc_name') {
        const name = text.trim();
        const id = name.toLowerCase().replace(/\s+/g, '_');

        userState[userId] = { action: 'admin_create_email_svc_price', svcName: name, svcId: id };

        bot.sendMessage(chatId, `💰 **Enter Price for ${name}** (in Credits):`, { parse_mode: 'Markdown' });
    }

    // ADMIN: CREATE EMAIL SERVICE (Step 2: Get Price, Save)
    else if (state && state.action === 'admin_create_email_svc_price') {
        const price = parseInt(text.trim());
        if (isNaN(price)) {
            return bot.sendMessage(chatId, "❌ Invalid price! Please enter a number.", { parse_mode: 'Markdown' });
        }

        db.createEmailService(state.svcId, state.svcName, price);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Service Created Successfully!**\n\n📌 **Name:** ${state.svcName}\n🆔 **ID:** ${state.svcId}\n💰 **Price:** ${price} Credits`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Manage Services', callback_data: 'admin_manage_gmails' }]
                ]
            }
        });
    }

    // ADMIN: ADD STOCK INPUT (Bulk)
    else if (state && state.action === 'admin_input_gmail_stock') {
        const lines = text.trim().split('\n');
        const newStock = [];

        lines.forEach(line => {
            const parts = line.split('|');
            const email = parts[0].trim();
            // Allow password to be optional (null)
            const password = parts.length > 1 ? parts[1].trim() : null;

            if (email.includes('@')) {
                newStock.push({ email, password });
            }
        });

        if (newStock.length > 0) {
            db.addEmailStock(state.svcId, newStock);
            bot.sendMessage(chatId, `✅ **Stock Added!**\n\nService ID: \`${state.svcId}\`\nAdded: **${newStock.length}** accounts.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "⚠️ No valid accounts found. Ensure format is `email|password`, one per line.");
        }
        delete userState[userId];
    }

    // ADMIN: EDIT SERVICE PRICE
    else if (state && state.action === 'admin_edit_email_svc_price') {
        const price = parseInt(text.trim());
        if (isNaN(price)) return bot.sendMessage(chatId, "❌ Invalid price. Please enter a number.");

        const services = db.getEmailServices();
        if (services && services[state.svcId]) {
            services[state.svcId].price = price;
            db.save();
            bot.sendMessage(chatId, `✅ **Price Updated!**\n\nNew Price: **${price} Credits**`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "❌ Service not found (might have been deleted).");
        }

        delete userState[userId];
    }

    // ADMIN: ADD SINGLE VPN ACCOUNT
    else if (state && state.action === 'admin_input_vpn') {
        const parts = text.trim().split('|');
        if (parts.length !== 2) {
            return bot.sendMessage(chatId, "❌ Invalid format! Use: `email|password`", { parse_mode: 'Markdown' });
        }

        const email = parts[0].trim();
        const password = parts[1].trim();

        db.addVPN(state.service, { email, password });
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **VPN Account Added!**\n\nService: ${state.service.toUpperCase()}\nEmail: \`${email}\``, { parse_mode: 'Markdown' });
    }

    // ADMIN: ADD BULK VPN ACCOUNTS
    else if (state && state.action === 'admin_input_vpn_bulk') {
        const lines = text.split('\n');
        let count = 0;
        lines.forEach(line => {
            const parts = line.split('|');
            if (parts.length >= 2) {
                db.addVPN(state.service, { email: parts[0].trim(), password: parts[1].trim() });
                count++;
            }
        });

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Success!** Added **${count}** accounts to ${state.service.toUpperCase()}.`, { parse_mode: 'Markdown' });
    }

    // ==================== GMAIL HANDLERS ====================

    // USER: RENEW CHECK
    else if (state && state.step === 'waiting_for_gmail_renew') {
        const email = text.trim();
        // Allow user to cancel
        if (email.toLowerCase() === 'cancel') {
            delete userState[userId];
            return bot.sendMessage(chatId, "❌ Action cancelled.");
        }

        const account = db.getGmail(email);
        delete userState[userId];

        if (!account) {
            bot.sendMessage(chatId, "❌ **Email Not Found!**\nMake sure it belongs to our bot service.", { parse_mode: 'Markdown' });
            return;
        }

        // Check if assigned to this user (optional security check)
        /*
        if (account.assignedTo && String(account.assignedTo) !== String(userId)) {
             bot.sendMessage(chatId, "❌ **Access Denied!** This email is not assigned to you.");
             return;
        }
        */

        // Check API
        if (account.source === 'smtplabs' || account.email.includes('@smtp.dev')) {
            const apiOtp = await getSmtpLabsOtp(account.email);
            if (apiOtp) {
                account.otp = apiOtp.otp;
                account.otpTime = apiOtp.date || Date.now();
                db.save();
            }
        }

        let otpMsg = account.otp ? `🔢 **OTP:** \`${account.otp}\`\n🕒 Received: ${new Date(account.otpTime).toLocaleString()}` : `⏳ **No OTP received yet.**`;

        const msg = `📧 **Gmail Check:** \`${email}\`\n\n${otpMsg}`;
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }

    // ADMIN: UPLOAD GMAILS
    else if (state && state.action === 'admin_upload_gmails_bulk') {
        const lines = text.split('\n');
        let count = 0;

        lines.forEach(line => {
            const parts = line.split('|'); // email|password
            if (parts.length >= 2) {
                db.addGmail(parts[0].trim(), parts[1].trim());
                count++;
            }
        });

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Success!** Added **${count}** Gmail accounts.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: SEARCH GMAIL FOR OTP UPDATE
    else if (state && state.action === 'admin_input_vpn_bulk') {
        const lines = text.trim().split('\n').filter(l => l.trim().length > 0);
        let count = 0;

        lines.forEach(line => {
            const parts = line.trim().split('|');
            if (parts.length === 2) {
                const email = parts[0].trim();
                const password = parts[1].trim();
                db.addVPN(state.service, { email, password });
                count++;
            }
        });

        delete userState[userId];

        if (count > 0) {
            bot.sendMessage(chatId, `✅ **Success!** Added **${count}** VPN accounts to ${state.service.toUpperCase()}.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "❌ No valid accounts found! Format: `email|password`", { parse_mode: 'Markdown' });
        }
    }

    // ADMIN: SET VPN PRICE
    else if (state && state.action === 'admin_set_vpn_price') {
        const price = parseInt(text);
        if (isNaN(price) || price < 0) {
            return bot.sendMessage(chatId, "❌ Invalid price! Please send a number.");
        }

        db.setVPNPrice(state.service, price);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Price Updated!**\n\nService: ${state.service.toUpperCase()}\nNew Price: **${price}** Credits`, { parse_mode: 'Markdown' });
    }

    // ADMIN: CREATE VPN SERVICE (NAME)
    else if (state && state.action === 'admin_create_vpn_svc_name') {
        userState[userId] = { action: 'admin_create_vpn_svc_price', name: text.trim() };
        bot.sendMessage(chatId, "💰 **Enter Price** (e.g. 100):");
    }

    // ADMIN: CREATE VPN SERVICE (PRICE)
    else if (state && state.action === 'admin_create_vpn_svc_price') {
        const price = parseInt(text);
        if (isNaN(price)) return bot.sendMessage(chatId, "❌ Invalid Price.");

        const serviceId = state.name.toLowerCase().replace(/[^a-z0-9]/g, ''); // simple slug
        db.createVPNService(serviceId, state.name, price);

        delete userState[userId];
        bot.sendMessage(chatId, `✅ **VPN Service Created:** ${state.name} (${price} cr)\nID: \`${serviceId}\``, { parse_mode: 'Markdown' });
    }

    // ADMIN: UPDATE VERIFY COST
    else if (state && state.action === 'admin_input_verify_cost') {
        const cost = parseInt(text);
        if (isNaN(cost) || cost < 0) return bot.sendMessage(chatId, "❌ Invalid Cost.");

        db.updateCost(state.service, cost);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ Updated **${state.service.toUpperCase()}** verification cost to **${cost}** credits.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: UPDATE CARD COST
    else if (state && state.action === 'admin_input_card_cost') {
        const cost = parseInt(text);
        if (isNaN(cost) || cost < 0) return bot.sendMessage(chatId, "❌ Invalid Price.");

        db.updatePrice(state.service, cost);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ Updated **${state.service.toUpperCase()}** card price to **${cost}** credits.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: NEW PAYMENT - ID Input
    else if (state && state.action === 'admin_new_pay_id') {
        const key = text.trim();
        // Remove spaces and special chars
        const safeKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

        // Check if exists
        const methods = db.getSettings().paymentMethods || {};
        if (methods[safeKey]) return bot.sendMessage(chatId, "❌ ID already exists! Please allow overwrite or choose different ID.");

        userState[userId] = { action: 'admin_new_pay_name', key: safeKey };
        bot.sendMessage(chatId, "Enter **Display Name** (e.g. `Rocket`):", { parse_mode: 'Markdown' });
    }

    // ADMIN: NEW PAYMENT - Name Input
    else if (state && state.action === 'admin_new_pay_name') {
        const name = text.trim();
        userState[userId] = { action: 'admin_new_pay_val', key: state.key, name: name };
        bot.sendMessage(chatId, "Enter **Number** or **Address** for the method:", { parse_mode: 'Markdown' });
    }

    // ADMIN: NEW PAYMENT - Value Input
    else if (state && state.action === 'admin_new_pay_val') {
        const val = text.trim();
        const key = state.key;
        const name = state.name;

        const settings = db.getSettings();
        if (!settings.paymentMethods) settings.paymentMethods = {};

        // Simple heuristic: if likely crypto address (>20 chars), store as address. Else number.
        const isAddress = val.length > 20 || val.startsWith('T') || val.startsWith('0x');

        settings.paymentMethods[key] = {
            name: name,
            enabled: true,
            address: isAddress ? val : undefined,
            number: !isAddress ? val : undefined
        };
        db.save();
        delete userState[userId];
        bot.sendMessage(chatId, `✅ Payment Method **${name}** Added! Go to Manage Payments to see it.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: EDIT PAYMENT VALUE
    else if (state && state.action === 'admin_edit_pay_val') {
        const val = text.trim();
        const key = state.key;

        const settings = db.getSettings();
        if (settings.paymentMethods && settings.paymentMethods[key]) {
            const m = settings.paymentMethods[key];
            const isAddress = val.length > 20 || val.startsWith('T') || val.startsWith('0x');

            if (isAddress) { m.address = val; delete m.number; }
            else { m.number = val; delete m.address; }

            db.save();
            bot.sendMessage(chatId, `✅ Updated **${m.name}** details.`);
        } else {
            bot.sendMessage(chatId, `❌ Error: Method not found.`);
        }
        delete userState[userId];
    }

    // ADMIN: CREATE CODE
    else if (state && state.action === 'admin_create_code_input') {
        const parts = text.split(' ');
        if (parts.length < 3) return bot.sendMessage(chatId, "Invalid format. Use: CODE AMOUNT USES");

        db.createCode(parts[0], parseInt(parts[1]), parseInt(parts[2]));
        delete userState[userId];
        bot.sendMessage(chatId, `✅ **Code Created!**\nCode: \`${parts[0]}\`\nAmount: ${parts[1]} cr\nUses: ${parts[2]}`, { parse_mode: 'Markdown' });
    }

    // ADMIN: SET TRANSFER COST
    else if (state && state.action === 'admin_set_transfer_cost') {
        const cost = parseInt(text.trim());
        if (isNaN(cost) || cost < 0) return bot.sendMessage(chatId, "❌ Invalid Cost.");

        const settings = db.getSettings();
        settings.transferCost = cost;
        db.save();
        delete userState[userId];

        bot.sendMessage(chatId, `✅ Transfer Cost updated to **${cost} Credits** per transaction.`, { parse_mode: 'Markdown' });
    }

    // USER: TRANSFER - INPUT ID
    else if (state && state.action === 'transfer_input_id') {
        const targetId = text.trim();

        // Validate numeric ID
        if (!/^\d+$/.test(targetId)) {
            return bot.sendMessage(chatId, "❌ Invalid User ID. Please enter numbers only.");
        }

        if (targetId === userId.toString()) {
            return bot.sendMessage(chatId, "❌ You cannot transfer credits to yourself!");
        }

        const targetUser = db.getUser(targetId);
        if (!targetUser) {
            return bot.sendMessage(chatId, "❌ User not found! Please check the ID.");
        }

        userState[userId] = { action: 'transfer_input_amount', targetId: targetId };
        bot.sendMessage(chatId, `✅ User Found: **${targetUser.firstName || 'User'}**\n\nEnter amount to transfer:`, { parse_mode: 'Markdown' });
    }

    // USER: TRANSFER - INPUT AMOUNT
    else if (state && state.action === 'transfer_input_amount') {
        const amount = parseInt(text.trim());
        const targetId = state.targetId;
        const targetUser = db.getUser(targetId);

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, "❌ Invalid amount.");
        }

        const settings = db.getSettings();
        const fee = settings.transferCost || 0;
        const totalDeduct = amount + fee;

        if (user.balance < totalDeduct) {
            return bot.sendMessage(chatId, `❌ Insufficient Balance!\n\nYou need **${totalDeduct} Credits** (Amount: ${amount} + Fee: ${fee})`);
        }

        // Execute Transfer
        db.deductCredit(userId, totalDeduct);
        db.addCredit(targetId, amount);

        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Transfer Successful!**\n\nSent: **${amount} Credits**\nFee: **${fee} Credits**\nTo: \`${targetId}\``, { parse_mode: 'Markdown' });

        // Notify Recipient
        bot.sendMessage(targetId, `🎁 **You received ${amount} Credits!**\n\nFrom User: \`${userId}\``, { parse_mode: 'Markdown' }).catch(() => { });
    }

    // ADMIN: SET SUPPORT COST
    else if (state && state.action === 'admin_set_support_cost') {
        const cost = parseInt(text.trim());

        if (isNaN(cost) || cost < 0) {
            return bot.sendMessage(chatId, '❌ Invalid amount. Please send a valid number.');
        }

        db.setSupportCost(cost);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Support Cost Updated!**\n\nNew cost: **${cost} Credits**`, { parse_mode: 'Markdown' });
    }

    // ADMIN: SET CREDIT RATE
    else if (state && state.action === 'admin_set_rate') {
        const rate = parseFloat(text.trim());
        const method = state.method;

        if (isNaN(rate) || rate <= 0) {
            return bot.sendMessage(chatId, '❌ Invalid rate. Please send a valid number.');
        }

        db.setCreditRate(method, rate);
        delete userState[userId];

        const unit = method === 'crypto' ? 'USDT' : 'BDT';
        bot.sendMessage(chatId,
            `✅ **${method.toUpperCase()} Rate Updated!**\n\n` +
            `New rate: **${rate} ${unit} per credit**`,
            { parse_mode: 'Markdown' }
        );
    }

    // ADMIN: DELETE TASK
    else if (state && state.action === 'admin_delete_task_id') {
        const taskId = text.trim();
        const result = db.deleteTask(taskId);

        delete userState[userId];

        if (result) {
            bot.sendMessage(chatId, `✅ Task \`${taskId}\` deleted successfully!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `❌ Task not found!`);
        }
    }

    // ADMIN: ADD PREMIUM APP

    else if (state && state.action === 'admin_add_app_input') {
        const parts = text.split('|');
        if (parts.length < 3) {
            return bot.sendMessage(chatId, "❌ Invalid format. Use: `Name|Price|Link`\nExample: `Spotify|50|https://t.me/xx`", { parse_mode: 'Markdown' });
        }

        const name = parts[0].trim();
        const price = parseInt(parts[1].trim());
        const link = parts.slice(2).join('|').trim(); // Join rest
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (isNaN(price) || price < 0) {
            return bot.sendMessage(chatId, "❌ Invalid Price. Please use a positive number.");
        }

        db.addPremiumApp(id, name, link, price);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **App Added!**\n\n📱 Name: ${name}\n💰 Price: ${price} cr\n🔗 Link: ${link}`, { parse_mode: 'Markdown' });
    }

    // ADMIN: BLOCK/UNBLOCK USER ID
    else if (state && state.action === 'admin_block_user_id') {
        const targetId = text.trim();

        // Validate numeric ID
        if (!/^\d+$/.test(targetId)) {
            delete userState[userId];
            return bot.sendMessage(chatId, `❌ Invalid User ID. Please enter numbers only.`);
        }

        const targetUser = db.getUser(targetId);

        if (!targetUser) {
            delete userState[userId];
            return bot.sendMessage(chatId, `❌ User not found.`);
        }

        targetUser.blocked = true;
        db.save();
        bot.sendMessage(chatId, `✅ User \`${targetId}\` has been BLOCKED.`, { parse_mode: 'Markdown' });
        delete userState[userId];
    }


    else if (state && state.action === 'admin_input_card') {
        // Expected: State|City|Address|Zip|CardNumber|Expiry|CVV
        const parts = text.split('|');
        if (parts.length < 7) {
            return bot.sendMessage(chatId, "❌ Invalid Format! Use: `State|City|Address|Zip|Card|Exp|CVV`", { parse_mode: 'Markdown' });
        }

        const cardData = {
            state: parts[0].trim(),
            city: parts[1].trim(),
            address: parts[2].trim(),
            zip: parts[3].trim(),
            number: parts[4].trim(),
            expiry: parts[5].trim(),
            cvv: parts[6].trim()
        };

        db.addCard(state.service, cardData);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Success!** Added 1 Card to ${state.service.toUpperCase()}.`, { parse_mode: 'Markdown' });
        return;
    }

    // ADMIN: TASK CREATION & EDIT FLOW
    else if (state && state.action === 'admin_input_task_name') {
        userState[userId].name = text.trim();
        userState[userId].action = 'admin_input_task_url';
        bot.sendMessage(chatId, "🔗 **Enter Task URL** (e.g. https://t.me/channel):", { parse_mode: 'Markdown' });
    }
    else if (state && state.action === 'admin_input_task_url') {
        userState[userId].url = text.trim();
        userState[userId].action = 'admin_input_task_reward';
        bot.sendMessage(chatId, "💰 **Enter Reward Amount** (e.g. 50):", { parse_mode: 'Markdown' });
    }
    else if (state && state.action === 'admin_input_task_reward') {
        const reward = parseInt(text.trim());
        if (isNaN(reward) || reward <= 0) return bot.sendMessage(chatId, "❌ Invalid reward amount.");

        if (state.taskId) {
            // EDIT MODE
            const tasks = db.getTasks();
            if (tasks[state.taskId]) {
                tasks[state.taskId].reward = reward;
                db.data.tasks = tasks;
                db.save();
                bot.sendMessage(chatId, `✅ Task reward updated to **${reward} cr**!`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, "❌ Task not found.");
            }
            delete userState[userId];
        } else {
            // CREATE MODE
            const id = db.createTask(state.name, state.url, reward);
            delete userState[userId];
            bot.sendMessage(chatId, `✅ **Task Created!**\n\nName: ${state.name}\nReward: ${reward} cr\nID: \`${id}\``, { parse_mode: 'Markdown' });
        }
    }

    // BROADCAST: BUTTON TEXT (Step 1)
    else if (state && state.action === 'broadcast_button_text') {
        const btnText = text.trim();
        if (btnText.length < 1) {
            return bot.sendMessage(chatId, "❌ Button text cannot be empty.");
        }

        userState[userId].buttonText = btnText;
        userState[userId].action = 'broadcast_button_url';

        // Edit the options message to show URL input instruction
        if (state.optionsMessageId) {
            try {
                await bot.editMessageText(
                    `🔘 **Add Button - Step 2/2**\n\n🔗 Send the button URL:\n\nExample: \`https://example.com\``,
                    {
                        chat_id: chatId,
                        message_id: state.optionsMessageId,
                        parse_mode: 'Markdown'
                    }
                );
            } catch (e) {
                bot.sendMessage(chatId, `🔘 **Add Button - Step 2/2**\n\n🔗 Send the button URL:\n\nExample: \`https://example.com\``, { parse_mode: 'Markdown' });
            }
        }
    }

    // BROADCAST: BUTTON URL (Step 2)
    else if (state && state.action === 'broadcast_button_url') {
        const btnUrl = text.trim();

        if (!btnUrl.startsWith('http')) {
            return bot.sendMessage(chatId, "❌ Invalid URL. Must start with http or https.");
        }

        userState[userId].buttons.push([{ text: state.buttonText, url: btnUrl }]);
        userState[userId].action = 'broadcast_compose';
        delete userState[userId].buttonText; // cleanup

        // Show updated options with the new button count
        await showBroadcastOptions(chatId, userId);
    }

    // ADMIN: SEARCH USER INPUT
    else if (state && state.action === 'admin_search_user_input') {
        if (isAdmin(userId)) {
            const targetId = msg.text.trim();

            // Validate numeric ID or username (if supported later)
            // For now assume ID
            if (!/^\d+$/.test(targetId)) {
                bot.sendMessage(chatId, "❌ Invalid User ID. Please enter numbers only.");
                return;
            }

            const targetUser = db.getUser(targetId);

            // Check if user actually exists (has ioinedAt)
            if (!targetUser.joinedAt) {
                bot.sendMessage(chatId, "❌ User not found in database.");
                delete userState[userId];
                return;
            }

            delete userState[userId];

            const status = targetUser.blocked ? '🔴 Inactive (Blocked)' : '✅ Active';
            const joined = new Date(targetUser.joinedAt).toLocaleString();

            let reply = `👤 **User Details**\n\n` +
                `🆔 ID: \`${targetId}\`\n` +
                `👤 Name: ${targetUser.first_name || 'N/A'}\n` +
                `💰 Balance: **${targetUser.balance}** Credits\n` +
                `📅 Joined: ${joined}\n` +
                `📊 Status: ${status}\n` +
                `🛒 Purchased: ${targetUser.cardsPurchased || 0} items\n` +
                `🔗 Referrals: ${targetUser.referralCount || 0}\n\n` +
                `Select Action:`;

            bot.sendMessage(chatId, reply, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '➕ Add Credit', callback_data: `admin_credit_add_${targetId}` },
                            { text: '➖ Deduct Credit', callback_data: `admin_credit_sub_${targetId}` }
                        ],
                        [
                            { text: targetUser.blocked ? '✅ Unblock User' : '🔴 Block User', callback_data: `admin_block_toggle_${targetId}` }
                        ],
                        [{ text: '🔙 Back to Users', callback_data: 'admin_manage_user' }]
                    ]
                }
            });
        }
    }



    // VERIFICATION FLOW
    if (state && state.action === 'awaiting_link') {
        const url = text.trim();
        const type = state.service;
        const cost = state.cost;

        if (!url.includes('sheerid')) {
            return bot.sendMessage(chatId, '❌ Invalid Link!');
        }

        const user = db.getUser(userId);
        if (user.balance < cost) {
            delete userState[userId];
            return bot.sendMessage(chatId, '❌ Insufficient balance!');
        }

        // COOLDOWN CHECK (Rate Limiting)
        const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
        if (user.tempMailCooldown && (Date.now() - user.tempMailCooldown) < COOLDOWN_MS) {
            const remainingMs = COOLDOWN_MS - (Date.now() - user.tempMailCooldown);
            const remainingMin = Math.ceil(remainingMs / 60000);

            const cooldownMsg = `⚠️ <b>System Busy</b>

` +
                `Please wait ${remainingMin} minute(s) and try again.

` +
                `<i>Our email system is processing requests.</i>`;

            return bot.editMessageText(cooldownMsg, {
                chat_id: chatId,
                message_id: msgId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Try Again', callback_data: 'gmail_temp_gen' }]
                    ]
                }
            });
        }


        user.balance -= cost;
        db.save();

        delete userState[userId];

        const procMsg = await bot.sendMessage(chatId,
            `⏳ **Processing Verification...**\n\n` +
            `🔄 Verifying your SheerID link for **${type.toUpperCase()}**...\n` +
            `💰 Cost: **${cost} Credits** (Deducted)\n` +
            `Please wait, this may take a moment...`,
            { parse_mode: 'Markdown' }
        );

        const previousChatId = currentChatId;
        currentChatId = chatId;

        try {
            const result = await verifySheerID(url, type);

            if (result.success) {
                user.successfulVerifications = (user.successfulVerifications || 0) + 1;
                db.save();

                let successMsg = `✅ **VERIFICATION SUCCESSFUL!**\n\n`;
                successMsg += `🔹 **Service:** ${type.toUpperCase()}\n`;

                if (result.rewardCode) {
                    successMsg += `🎁 **Reward Code:**\n\`${result.rewardCode}\`\n\n`;
                    successMsg += `✅ _Tap the code to copy!_`;
                } else {
                    successMsg += `📧 **Status:** Check your email for the reward!\n`;
                }

                await bot.editMessageText(successMsg, {
                    chat_id: chatId,
                    message_id: procMsg.message_id,
                    parse_mode: 'Markdown'
                });

            } else {
                user.failedVerifications = (user.failedVerifications || 0) + 1;
                db.save();

                await bot.editMessageText(`❌ **VERIFICATION FAILED**\n\nReason: ${result.error || 'Unknown Error'}\n\n⚠️ _Please ensure the link is valid and try again._`, {
                    chat_id: chatId,
                    message_id: procMsg.message_id,
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            await bot.editMessageText(`❌ **System Error:** ${e.message}`, {
                chat_id: chatId,
                message_id: procMsg.message_id,
                parse_mode: 'Markdown'
            });
        } finally {
            currentChatId = previousChatId;
        }
    }

    // REDEEM CODE
    else if (state && state.action === 'awaiting_code') {
        const result = db.redeemCode(userId, text.trim());
        delete userState[userId];
        if (result.success) bot.sendMessage(chatId, `🎉 Success! +${result.amount} Credits.`);
        else bot.sendMessage(chatId, `❌ ${result.msg}`);
    }

    // ==================== FILE UPLOAD HANDLERS ====================

    // UPLOAD CARDS FILE
    else if (state && state.action === 'upload_cards_file' && msg.document) {
        if (!isAdmin(userId)) return;

        const file = msg.document;
        if (!file.file_name.endsWith('.txt')) {
            return bot.sendMessage(chatId, '❌ Please upload a .txt file only.');
        }

        try {
            const fileLink = await bot.getFileLink(file.file_id);
            const response = await fetch(fileLink);
            const fileContent = await response.text();

            const lines = fileContent.split('\n').filter(l => l.trim());
            let successCount = 0;
            let failCount = 0;

            lines.forEach(line => {
                const parts = line.trim().split('|');
                if (parts.length === 7) {
                    const cardData = {
                        state: parts[0].trim(),
                        city: parts[1].trim(),
                        address: parts[2].trim(),
                        zip: parts[3].trim(),
                        number: parts[4].trim(),
                        expiry: parts[5].trim(),
                        cvv: parts[6].trim()
                    };

                    // Assuming a default service, you can modify this
                    db.addCard('uploaded', cardData);
                    successCount++;
                } else {
                    failCount++;
                }
            });

            delete userState[userId];
            bot.sendMessage(chatId,
                `✅ **Upload Complete!**\n\n` +
                `✅ Successful: ${successCount}\n` +
                `❌ Failed: ${failCount}\n` +
                `📄 Total Lines: ${lines.length}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error processing file: ${error.message}`);
        }
        return;
    }

    // PAYMENT: CUSTOM AMOUNT INPUT - Show calculated price
    else if (state && state.action === 'pay_custom_input') {
        const amount = parseInt(text.trim());
        const methodKey = state.method;

        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, "❌ Invalid amount. Please enter a valid number (e.g. 500).");
        }

        const cryptoRate = db.getCreditRate('crypto');
        const totalPrice = (amount * cryptoRate).toFixed(2);

        // Show details same as pay_amount_
        const methods = db.getSettings().paymentMethods || {};
        const method = methods[methodKey];

        if (!method) {
            delete userState[userId];
            return bot.sendMessage(chatId, "❌ Payment method error.");
        }

        let detailMsg = `💳 **Payment Details**\n\n` +
            `Credits: **${amount}**\n` +
            `Rate: **${cryptoRate} USDT/credit**\n` +
            `Total: **$${totalPrice} USDT**\n\n` +
            `Method: **${method.name}**\n`;

        if (method.number) detailMsg += `📱 **Number:** \`${method.number}\`\n`;
        if (method.address) detailMsg += `📍 **Address:** \`${method.address}\`\n`;

        detailMsg += `\n⚠️ **Instructions:**\n` +
            `1. Send **$${totalPrice} USDT** to the address above.\n` +
            `2. Keep the Transaction ID (TrxID).\n` +
            `3. Click below to submit TrxID.`;

        userState[userId] = { pendingPayment: { method: methodKey, amount: amount } };

        bot.sendMessage(chatId, detailMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ I Have Paid', callback_data: `pay_submit_trx` }],
                    [{ text: '🔙 Back', callback_data: `pay_method_${methodKey}` }]
                ]
            }
        });
    }

    // PAYMENT: SUBMIT TRX ID
    else if (state && state.action === 'awaiting_trx_id') {
        const trxId = text.trim();
        const pending = state.pendingPayment;

        if (!trxId) return;

        const payId = db.createPayment(userId, pending.amount, pending.method, trxId);

        delete userState[userId];

        bot.sendMessage(chatId,
            `✅ **Payment Submitted!**\n\n` +
            `Payment ID: #${payId}\n` +
            `Amount: ${pending.amount} Credits\n` +
            `TrxID: \`${trxId}\`\n\n` +
            `Please wait for admin approval. You will be notified.`,
            { parse_mode: 'Markdown' }
        );
    }

    // UPLOAD CODES FILE
    else if (state && state.action === 'upload_codes_file' && msg.document) {
        if (!isAdmin(userId)) return;

        const file = msg.document;
        if (!file.file_name.endsWith('.txt')) {
            return bot.sendMessage(chatId, '❌ Please upload a .txt file only.');
        }

        try {
            const fileLink = await bot.getFileLink(file.file_id);
            const response = await fetch(fileLink);
            const fileContent = await response.text();

            const lines = fileContent.split('\n').filter(l => l.trim());
            let successCount = 0;
            let failCount = 0;

            lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length === 3) {
                    const code = parts[0];
                    const amount = parseInt(parts[1]);
                    const uses = parseInt(parts[2]);

                    if (!isNaN(amount) && !isNaN(uses)) {
                        db.createCode(code, amount, uses);
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            });

            delete userState[userId];
            bot.sendMessage(chatId,
                `✅ **Upload Complete!**\n\n` +
                `✅ Codes Created: ${successCount}\n` +
                `❌ Failed: ${failCount}\n` +
                `📄 Total Lines: ${lines.length}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            bot.sendMessage(chatId, `❌ Error processing file: ${error.message}`);
        }
        return;
    }

    // UPLOAD & RESTORE BACKUP
    else if (state && state.action === 'admin_upload_backup' && msg.document) {
        if (!isAdmin(userId)) return;

        const file = msg.document;
        if (!file.file_name.toLowerCase().endsWith('.json')) {
            return bot.sendMessage(chatId, '❌ Please upload a .json file (database backup).');
        }

        bot.sendMessage(chatId, '⏳ **Downloading and validating backup...**', { parse_mode: 'Markdown' });

        try {
            const fileLink = await bot.getFileLink(file.file_id);
            const response = await fetch(fileLink);
            const fileContent = await response.text();

            // Validate JSON
            let parsed;
            try {
                parsed = JSON.parse(fileContent);
            } catch (e) {
                return bot.sendMessage(chatId, '❌ Invalid JSON file. Restore aborted.');
            }

            // Save to temp file
            const tempPath = path.join(__dirname, 'temp_restore.json');
            fs.writeFileSync(tempPath, fileContent);

            // Restore via DB
            const result = db.restoreBackup(tempPath);

            // Cleanup temp
            try { fs.unlinkSync(tempPath); } catch (e) { }

            delete userState[userId];

            if (result.success) {
                bot.sendMessage(chatId,
                    `✅ **System Restored Successfully!**\n\n` +
                    `📂 Source: \`${file.file_name}\`\n` +
                    `📅 Time: ${new Date().toLocaleString()}\n\n` +
                    `The bot database has been updated.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                bot.sendMessage(chatId, `❌ **Restore Failed:** ${result.msg}`);
            }

        } catch (error) {
            bot.sendMessage(chatId, `❌ Error processing restore: ${error.message}`);
        }
        return;
    }

    // ADMIN: CREATE CODE INPUT
    else if (state && state.action === 'admin_create_code_input') {
        const parts = text.trim().split(/\s+/);
        if (parts.length !== 3) {
            return bot.sendMessage(chatId, "❌ Invalid format. Use: `CODE AMOUNT USES`\nExample: `SALE50 500 10`", { parse_mode: 'Markdown' });
        }

        const code = parts[0];
        const amount = parseInt(parts[1]);
        const uses = parseInt(parts[2]);

        if (isNaN(amount) || isNaN(uses)) {
            return bot.sendMessage(chatId, "❌ Amount and Uses must be numbers.");
        }

        db.createCode(code, amount, uses);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Code Created!**\n\nCode: \`${code}\`\nAmount: ${amount}\nUses: ${uses}`, { parse_mode: 'Markdown' });
    }

    // ==================== SUPPORT TICKET MESSAGES ====================

    // TICKET: Subject
    else if (state && state.action === 'ticket_subject') {
        const subject = text.trim();
        if (subject.length < 5) {
            return bot.sendMessage(chatId, '❌ Subject too short. Minimum 5 characters required.');
        }
        userState[userId] = { action: 'ticket_message', subject: subject };
        bot.sendMessage(chatId, `📝 Subject: **${subject}**\n\nNow send the detailed message:`, { parse_mode: 'Markdown' });
    }

    // TICKET: Message
    else if (state && state.action === 'ticket_message') {
        const message = text.trim();
        if (message.length < 10) {
            return bot.sendMessage(chatId, '❌ Message too short. Minimum 10 characters required.');
        }

        const ticketId = db.createTicket(userId, state.subject, message);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Ticket Created!**\n\nTicket ID: \`${ticketId}\`\n\nSupport team will respond soon.`, { parse_mode: 'Markdown' });

        // Notify admin
        bot.sendMessage(config.ADMIN_ID,
            `🎫 **New Ticket**\n\`${ticketId}\`\nUser: ${userId}\n${state.subject}\n\n${message}`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Reply', callback_data: `admin_reply_ticket_${ticketId}` }]] } }
        ).catch(() => { });
    }

    // TICKET: Reply
    else if (state && state.action === 'ticket_reply') {
        const message = text.trim();
        db.replyToTicket(state.ticketId, message, false);
        delete userState[userId];
        bot.sendMessage(chatId, `✅ Reply sent to ticket \`${state.ticketId}\``, { parse_mode: 'Markdown' });
    }

    // ==================== PAYMENT MESSAGES ====================

    // PAYMENT: Custom Amount
    else if (state && state.action === 'payment_custom_amount') {
        const lang = getUserLanguage(userId, db);
        const amount = parseInt(text.trim());

        if (isNaN(amount) || amount < 10) {
            return bot.sendMessage(chatId, getText(lang, 'invalidAmount') || '❌ Invalid amount. Minimum 10 credits.');
        }

        userState[userId] = { action: 'payment_method_select', amount: amount };

        // Calculate discounts
        let discountPercent = 0;
        if (amount > 5000) discountPercent = 10;
        else if (amount >= 5000) discountPercent = 8;
        else if (amount >= 2000) discountPercent = 6;
        else if (amount >= 1000) discountPercent = 4;
        else if (amount >= 500) discountPercent = 2;

        const discount = discountPercent / 100;

        const cryptoRate = db.getCreditRate('crypto');

        let usdPrice = (amount * cryptoRate * (1 - discount)).toFixed(2);

        const msg = getText(lang, 'paymentSelectMethod', amount, discountPercent, usdPrice);

        const buttons = [
            [{ text: '💎 Cryptocurrency (USDT)', callback_data: `pay_method_crypto_${amount}` }],
            [{ text: getText(lang, 'cancelButton'), callback_data: 'add_balance_menu' }]
        ];

        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'Markdown'
        });
    }

    // PAYMENT: Proof
    else if (state && state.action === 'payment_proof') {
        const paymentId = state.paymentId;
        const payment = db.getPayment(paymentId);
        if (!payment) {
            delete userState[userId];
            return bot.sendMessage(chatId, '❌ Payment not found.');
        }

        delete userState[userId];

        // Forward to admin
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1];
            bot.sendPhoto(config.ADMIN_ID, photo.file_id, {
                caption: `📸 Payment Proof\n\`${paymentId}\`\nUser: ${userId}\nAmount: ${payment.amount} cr`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Approve', callback_data: `admin_confirm_payment_${paymentId}` },
                        { text: '❌ Reject', callback_data: `admin_reject_payment_${paymentId}` }
                    ]]
                }
            }).catch(() => { });
        } else if (text) {
            bot.sendMessage(config.ADMIN_ID,
                `📝 Payment Proof\n\`${paymentId}\`\nUser: ${userId}\nAmount: ${payment.amount} cr\n\nTXN: ${text}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '✅ Approve', callback_data: `admin_confirm_payment_${paymentId}` },
                            { text: '❌ Reject', callback_data: `admin_reject_payment_${paymentId}` }
                        ]]
                    }
                }
            ).catch(() => { });
        }

        bot.sendMessage(chatId, `✅ Proof submitted for \`${paymentId}\`\n\nWaiting for admin approval.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: CREATE CODE
    else if (state && state.action === 'admin_create_code_input') {
        const parts = text.split(' ');
        if (parts.length < 3) return bot.sendMessage(chatId, "Invalid format. Use: CODE AMOUNT USES");

        db.createCode(parts[0], parseInt(parts[1]), parseInt(parts[2]));
        delete userState[userId];
        bot.sendMessage(chatId, `✅ Code created: ${parts[0]}`);
    }

    // ==================== ADMIN SETTINGS MESSAGE HANDLERS ====================

    // ADMIN: SET SUPPORT COST
    else if (state && state.action === 'admin_set_support_cost') {
        const cost = parseInt(text.trim());

        if (isNaN(cost) || cost < 0) {
            return bot.sendMessage(chatId, '❌ Invalid amount. Please send a valid number.');
        }

        db.setSupportCost(cost);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Support Cost Updated!**\n\nNew cost: **${cost} Credits**`, { parse_mode: 'Markdown' });
    }

    // ADMIN: SET CREDIT RATE
    else if (state && state.action === 'admin_set_rate') {
        const rate = parseFloat(text.trim());
        const method = state.method;

        if (isNaN(rate) || rate <= 0) {
            return bot.sendMessage(chatId, '❌ Invalid rate. Please send a valid number.');
        }

        db.setCreditRate(method, rate);
        delete userState[userId];

        const unit = method === 'crypto' ? 'USDT' : 'BDT';
        bot.sendMessage(chatId,
            `✅ **${method.toUpperCase()} Rate Updated!**\n\n` +
            `New rate: **${rate} ${unit} per credit**`,
            { parse_mode: 'Markdown' }
        );
    }

    // ADMIN: SET WEB PANEL URL
    else if (state && state.action === 'admin_set_webpanel_url') {
        const url = text.trim();

        // Validate URL format
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return bot.sendMessage(chatId, '❌ Invalid URL! Must start with http:// or https://');
        }

        db.updateSetting('webPanelUrl', url);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Web Panel URL Updated!**\n\nNew URL: **${url}**\n\nUsers will now be redirected to this URL when they click the Web Panel button.`, { parse_mode: 'Markdown' });
    }

    // ADMIN: SEARCH USER LOGIC
    else if (state && state.action === 'admin_search_user_id') {
        const targetId = text.trim();
        const targetUser = db.getUser(targetId);

        delete userState[userId];

        if (!targetUser) {
            return bot.sendMessage(chatId, `❌ User with ID \`${targetId}\` not found.`, { parse_mode: 'Markdown' });
        }

        const status = targetUser.banned ? '🔴 Banned' : '🟢 Active';
        const msg = `👤 **User Details**\n\n` +
            `🆔 ID: \`${targetUser.id}\`\n` +
            `👤 Name: ${targetUser.firstName || 'N/A'}\n` +
            `📧 Username: @${targetUser.username || 'N/A'}\n` +
            `💰 Balance: **${targetUser.balance} Credits**\n\n` +
            `📅 Joined: ${new Date(targetUser.joinedAt).toLocaleDateString()}\n` +
            `🎁 Daily Claimed: **${targetUser.dailyClaimCount || 0} times**\n` +
            `👥 Referrals: **${targetUser.referralCount || 0}**\n` +
            `❌ Failed: **${targetUser.failedVerifications || 0}**\n` +
            `⚠️ Status: **${status}**`;

        const buttons = [
            [
                { text: '➕ Add Credits', callback_data: `admin_credit_add_${targetUser.id}` },
                { text: '➖ Deduct Credits', callback_data: `admin_credit_sub_${targetUser.id}` }
            ],
            [
                { text: targetUser.banned ? '🔓 Unban User' : '🚫 Ban User', callback_data: targetUser.banned ? `admin_unblock_${targetUser.id}` : `admin_block_${targetUser.id}` }
            ],
            [{ text: '🔙 Back to List', callback_data: 'admin_manage_user' }]
        ];

        bot.sendMessage(chatId, msg, {
            reply_markup: { inline_keyboard: buttons },
            parse_mode: 'Markdown'
        });
    }

    // ==================== BROADCAST MESSAGE HANDLERS ====================

    // BROADCAST: Compose Message (Text/Photo/Video)
    else if (state && state.action === 'broadcast_compose') {
        // Handle photo
        if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1]; // Get highest quality
            userState[userId].message = msg.caption || '';
            userState[userId].mediaType = 'photo';
            userState[userId].mediaId = photo.file_id;

            showBroadcastOptions(chatId, userId);
            return;
        }

        // Handle video
        if (msg.video) {
            userState[userId].message = msg.caption || '';
            userState[userId].mediaType = 'video';
            userState[userId].mediaId = msg.video.file_id;

            showBroadcastOptions(chatId, userId);
            return;
        }

        // Handle text
        if (msg.text) {
            userState[userId].message = msg.text;
            showBroadcastOptions(chatId, userId);
            return;
        }
    }

    // ==================== BACKUP FILE UPLOAD ====================

    // ADMIN: UPLOAD BACKUP FILE
    else if (state && state.action === 'admin_upload_backup' && msg.document) {
        if (!isAdmin(userId)) return;

        const file = msg.document;
        if (!file.file_name.endsWith('.json')) {
            return bot.sendMessage(chatId, '❌ Please upload a JSON backup file only.');
        }

        try {
            const fileLink = await bot.getFileLink(file.file_id);
            const response = await fetch(fileLink);
            const fileContent = await response.text();

            // Save to temp file
            const fs = require('fs');
            const path = require('path');
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            const tempFile = path.join(tempDir, `restore_${Date.now()}.json`);
            fs.writeFileSync(tempFile, fileContent);

            // Restore from file
            const result = db.restoreBackup(tempFile);

            delete userState[userId];

            if (result.success) {
                bot.sendMessage(chatId,
                    `✅ **Backup Restored Successfully!**\n\n` +
                    `File: \`${file.file_name}\`\n\n` +
                    `All data has been restored from the uploaded backup.`,
                    { parse_mode: 'Markdown' }
                );

                // Clean up temp file
                fs.unlinkSync(tempFile);
            } else {
                bot.sendMessage(chatId,
                    `❌ **Restore Failed!**\n\n${result.msg}`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            delete userState[userId];
            bot.sendMessage(chatId, `❌ Error processing backup file: ${error.message}`);
        }
        return;
    }

    // BROADCAST: Schedule DateTime Input
    else if (state && state.action === 'broadcast_schedule_datetime') {
        const dateTimeStr = text.trim();

        // Parse DD/MM/YYYY HH:MM
        const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;
        const match = dateTimeStr.match(regex);

        if (!match) {
            return bot.sendMessage(chatId, "❌ Invalid format. Please use: DD/MM/YYYY HH:MM\nExample: 09/02/2026 15:30");
        }

        const [, day, month, year, hours, minutes] = match;
        const scheduledDate = new Date(year, month - 1, day, hours, minutes);

        // Validate future date
        if (scheduledDate <= new Date()) {
            return bot.sendMessage(chatId, "❌ Please enter a future date and time.");
        }

        // Save scheduled broadcast
        const broadcastData = {
            message: state.message,
            buttons: state.buttons,
            mediaType: state.mediaType,
            mediaId: state.mediaId,
            scheduledTime: scheduledDate.getTime(),
            createdBy: userId
        };

        const broadcastId = db.addScheduledBroadcast(broadcastData);

        delete userState[userId];

        bot.sendMessage(chatId,
            `✅ **Broadcast Scheduled!**\n\n` +
            `📅 Date: ${scheduledDate.toLocaleDateString('en-GB')}\n` +
            `🕒 Time: ${scheduledDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}\n\n` +
            `Your broadcast will be sent automatically at the scheduled time.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // BROADCAST: Add Button Text
    else if (state && state.action === 'broadcast_button_text') {
        userState[userId].tempButtonText = text;
        userState[userId].action = 'broadcast_button_url';
        bot.sendMessage(chatId, `🔗 **Add Button Link**\n\nSend the URL for the button (e.g., https://t.me/yourchannel):`, { parse_mode: 'Markdown' });
        return;
    }

    // BROADCAST: Add Button URL
    else if (state && state.action === 'broadcast_button_url') {
        const buttonText = state.tempButtonText;
        const buttonUrl = text.trim();

        // Validate URL
        if (!buttonUrl.startsWith('http://') && !buttonUrl.startsWith('https://') && !buttonUrl.startsWith('t.me/')) {
            return bot.sendMessage(chatId, "❌ Invalid URL. Please send a valid URL starting with http://, https://, or t.me/");
        }

        // Add button to the array
        userState[userId].buttons.push([{ text: buttonText, url: buttonUrl }]);
        userState[userId].action = 'broadcast_compose';
        delete userState[userId].tempButtonText;

        bot.sendMessage(chatId, `✅ Button added: **${buttonText}**\n\nYou can add more buttons or send the broadcast.`, { parse_mode: 'Markdown' });
        showBroadcastOptions(chatId, userId);
        return;
    }

    // ADMIN: TASK CREATION STEPS
    else if (state && state.action === 'admin_new_task_name') {
        userState[userId] = { action: 'admin_new_task_url', name: text };
        bot.sendMessage(chatId, "Enter **Task URL** (e.g. https://t.me/...):", { parse_mode: 'Markdown' });
    }
    else if (state && state.action === 'admin_new_task_url') {
        userState[userId] = { ...state, action: 'admin_new_task_reward', url: text };
        bot.sendMessage(chatId, "Enter **Reward Amount** (e.g. 50):", { parse_mode: 'Markdown' });
    }
    else if (state && state.action === 'admin_new_task_reward') {
        const reward = parseInt(text);
        if (isNaN(reward)) return bot.sendMessage(chatId, "Please enter a valid number.");

        db.createTask(state.name, state.url, reward);
        delete userState[userId];
        bot.sendMessage(chatId, `✅ Task Created: **${state.name}**`, { parse_mode: 'Markdown' });
    }

    // ADMIN: UPDATE TASK REWARD
    else if (state && state.action === 'admin_input_task_reward') {
        const reward = parseInt(text);
        if (isNaN(reward) || reward < 0) {
            return bot.sendMessage(chatId, "❌ Please enter a valid positive number.");
        }

        const taskId = state.taskId;
        const tasks = db.getTasks();

        if (tasks[taskId]) {
            tasks[taskId].reward = reward;
            db.data.tasks = tasks;
            db.save();

            delete userState[userId];
            bot.sendMessage(chatId, `✅ Task reward updated to **${reward} credits**!`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, "❌ Task not found.");
        }
    }

    // ADMIN: DELETE TASK
    else if (state && state.action === 'admin_delete_task_id') {
        const success = db.deleteTask(text.trim());
        delete userState[userId];
        if (success) bot.sendMessage(chatId, "✅ Task deleted.");
        else bot.sendMessage(chatId, "❌ Task ID not found.");
    }

    // ADMIN: SET REF BONUS
    else if (state && state.action === 'admin_input_ref_bonus') {
        const bonus = parseInt(text);
        if (isNaN(bonus) || bonus < 0) {
            return bot.sendMessage(chatId, "❌ Please enter a valid number.");
        }

        db.updateSetting('refBonus', bonus);
        delete userState[userId];

        bot.sendMessage(chatId, `✅ Referral Bonus updated to **${bonus} Credits**!`, { parse_mode: 'Markdown' });
    }

    // ADMIN: ADD EMAIL GATEWAY INPUT
    else if (state && state.action === 'admin_email_gw_input') {
        const parts = text.split('|');
        if (parts.length < 3) {
            return bot.sendMessage(chatId, "❌ Invalid format.\nUse: `Name|Host|Key`", { parse_mode: 'Markdown' });
        }

        const name = parts[0].trim();
        const host = parts[1].trim();
        const key = parts[2].trim();

        const id = 'gw_' + Date.now();
        db.saveEmailGateway(id, { id, name, apiHost: host, apiKey: key });
        delete userState[userId];

        bot.sendMessage(chatId, `✅ **Email Gateway Added!**\n\nName: ${name}\nHost: ${host}`, { parse_mode: 'Markdown' });
    }
});

// ==================== BROADCAST SCHEDULER ====================
// Check for scheduled broadcasts every minute
setInterval(() => {
    const scheduled = db.getScheduledBroadcasts();
    const now = Date.now();

    scheduled.forEach(async (broadcast) => {
        if (broadcast.scheduledTime <= now) {
            console.log(`📣 Sending scheduled broadcast: ${broadcast.id}`);

            const users = Object.values(db.data.users || {});
            const buttons = broadcast.buttons.length > 0 ? { inline_keyboard: broadcast.buttons } : null;
            let successCount = 0;
            let failCount = 0;

            for (const user of users) {
                try {
                    const opts = {
                        caption: broadcast.message,
                        parse_mode: 'Markdown',
                        reply_markup: buttons
                    };

                    if (broadcast.mediaType === 'photo') {
                        await bot.sendPhoto(user.id, broadcast.mediaId, opts);
                    } else if (broadcast.mediaType === 'video') {
                        await bot.sendVideo(user.id, broadcast.mediaId, opts);
                    } else {
                        await bot.sendMessage(user.id, broadcast.message, { ...opts, caption: undefined });
                    }
                    successCount++;
                } catch (error) {
                    // Retry without Markdown if parse error
                    if (error.response && error.response.body && error.response.body.description.includes('parse')) {
                        try {
                            const plainOpts = {
                                caption: broadcast.message,
                                reply_markup: buttons
                            };
                            if (broadcast.mediaType === 'photo') {
                                await bot.sendPhoto(user.id, broadcast.mediaId, plainOpts);
                            } else if (broadcast.mediaType === 'video') {
                                await bot.sendVideo(user.id, broadcast.mediaId, plainOpts);
                            } else {
                                await bot.sendMessage(user.id, broadcast.message, { ...plainOpts, caption: undefined });
                            }
                            successCount++;
                        } catch (e) {
                            failCount++;
                            console.log(`Failed retry to user ${user.id}:`, e.message);
                        }
                    } else {
                        failCount++;
                        console.log(`Failed to send to user ${user.id}:`, error.message);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Notify admin
            if (broadcast.createdBy) {
                bot.sendMessage(broadcast.createdBy,
                    `✅ **Scheduled Broadcast Sent!**\n\n` +
                    `📊 **Results:**\n` +
                    `✅ Successful: ${successCount}\n` +
                    `❌ Failed: ${failCount}\n` +
                    `📈 Total: ${users.length}`,
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
            }

            // Remove from scheduled list
            db.removeScheduledBroadcast(broadcast.id);
        }
    });
}, 60000); // Check every minute

console.log('📅 Broadcast scheduler started');

// ==================== AUTO BACKUP SYSTEM ====================

// Helper: Clean old backups (keep only latest 5)
function cleanOldBackups() {
    try {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, 'backups');

        if (!fs.existsSync(backupDir)) return;

        // Get all backup files
        const allFiles = fs.readdirSync(backupDir);
        const files = allFiles
            .filter(f => (f.startsWith('auto_backup_') || f.startsWith('backup_')) && f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(backupDir, f),
                time: fs.statSync(path.join(backupDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time); // Sort by newest first

        console.log(`[BACKUP CLEANUP] Found ${files.length} valid backup files.`);

        // Keep only latest 3, delete the rest
        if (files.length > 3) {
            const filesToDelete = files.slice(3);
            console.log(`[BACKUP CLEANUP] Deleting ${filesToDelete.length} old files...`);

            filesToDelete.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    console.log(`🗑️ Deleted old backup: ${file.name}`);
                } catch (err) {
                    console.error(`❌ Failed to delete ${file.name}:`, err.message);
                }
            });
        } else {
            console.log(`[BACKUP CLEANUP] No files to delete (Limit: 3).`);
        }
    } catch (error) {
        console.error('❌ Backup cleanup failed:', error.message);
    }
}

// Auto backup every 12 hours
setInterval(() => {
    try {
        console.log('🔄 Creating automatic backup...');

        const backupFile = db.createBackup(true);
        const backupName = require('path').basename(backupFile);

        // Clean old backups (keep only latest 5)
        cleanOldBackups();

        // Send backup to admin
        const adminId = config.ADMIN_ID;
        if (adminId) {
            bot.sendDocument(adminId, backupFile, {
                caption: `🔄 **Automatic Backup**\n\n` +
                    `File: \`${backupName}\`\n` +
                    `Time: ${new Date().toLocaleString()}\n\n` +
                    `This backup is created every 12 hours automatically.\n` +
                    `Use Admin Panel → Backup & Restore to restore this backup if needed.`,
                parse_mode: 'Markdown'
            }).then(() => {
                console.log('✅ Backup sent to admin successfully');
            }).catch(err => {
                console.error('❌ Failed to send backup to admin:', err.message);
            });
        }
    } catch (error) {
        console.error('❌ Backup creation failed:', error);
    }
}, 12 * 60 * 60 * 1000); // 12 hours

// Create initial backup on startup
setTimeout(() => {
    try {
        console.log('🔄 Creating initial backup on startup...');
        const backupFile = db.createBackup(true);
        console.log('✅ Initial backup created:', require('path').basename(backupFile));

        // Clean old backups
        cleanOldBackups();
    } catch (error) {
        console.error('❌ Initial backup failed:', error);
    }
}, 5000); // 5 seconds after startup

console.log('💾 Auto backup system started (every 12 hours)');

// Auto Cleanup History (Every 24 Hours)
setInterval(() => {
    try {
        console.log('🧹 Running daily cleanup...');
        const count = db.cleanupOldHistory(7); // Keep 7 days
        if (count > 0) console.log(`✅ Cleaned up ${count} old records.`);
    } catch (e) {
        console.error('❌ Cleanup failed:', e);
    }
}, 24 * 60 * 60 * 1000);



/* ==========================================================================================
 * AUTOMATED BACKUP SERVICE
 * Runs every 5 hours. Sends database.json to Admin via Backup Bot. Deletes file after success.
 * ========================================================================================= */
if (config.BACKUP_BOT_TOKEN) {
    const backupBot = new TelegramBot(config.BACKUP_BOT_TOKEN, { polling: false });

    const runAutoBackup = async () => {
        try {
            console.log('⏳ Starting Auto-Backup...');
            const backupPath = db.createBackup(true); // true = auto mode
            if (!fs.existsSync(backupPath)) {
                console.error('❌ Backup generation failed: File not found');
                return;
            }

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB'); // DD/MM/YYYY
            const timeStr = now.toLocaleTimeString('en-US'); // HH:MM:SS AM/PM

            const caption = `📦 **Auto Backup**\n\n📅 **Date:** ${dateStr}\n⏰ **Time:** ${timeStr}\n\n_File stored securely._`;

            // Wait for file stream availability
            await new Promise(r => setTimeout(r, 1000));

            if (config.ADMIN_ID) {
                await backupBot.sendDocument(config.ADMIN_ID, fs.createReadStream(backupPath), {
                    caption: caption,
                    parse_mode: 'Markdown'
                });

                console.log('✅ Auto-Backup sent successfully!');

                // Delete Local File (Privacy/Space)
                try {
                    db.deleteAllBackups();
                    console.log('🗑️ Local backup files deleted as per security policy.');
                } catch (delErr) {
                    console.error('⚠️ Failed to clean local backups:', delErr);
                }
            } else {
                console.error('❌ Admin ID not set for backups.');
            }

        } catch (error) {
            console.error('❌ Auto-Backup Error:', error.message);
        }
    };

    // Schedule: Every 15 Days
    const BACKUP_INTERVAL = 15 * 24 * 60 * 60 * 1000; // 15 Days
    setInterval(runAutoBackup, BACKUP_INTERVAL);
    console.log(`🛡️ Auto-Backup Service initialized (Interval: 15 days).`);
} else {
    console.warn('⚠️ BACKUP_BOT_TOKEN missing. Auto-Backup disabled.');
}

// Export bot for web panel notifications
module.exports = { bot };

// ==================== HELPERS ====================

function getFlagEmoji(countryCode) {
    if (!countryCode) return '🌍';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

function getPhoneCode(countryCode) {
    if (!countryCode) return '00';
    const upper = countryCode.toUpperCase();

    // If it's already a number (e.g. "1", "880"), return it
    if (/^\d+$/.test(upper)) return upper;
    // If it starts with +, strip it
    if (upper.startsWith('+')) return upper.substring(1);

    const codes = {
        'US': '1', 'CA': '1', 'UK': '44', 'GB': '44', 'RU': '7', 'UA': '380',
        'KZ': '7', 'CN': '86', 'IN': '91', 'BD': '880', 'ID': '62',
        'VN': '84', 'PH': '63', 'MY': '60', 'TH': '66', 'EG': '20',
        'SA': '966', 'AE': '971', 'TR': '90', 'BR': '55', 'NG': '234'
    };
    return codes[upper] || '00';
}

// Web Panel Removed.
// Server is started via index.js for OAuth handling.

// ==================== BROADCAST COMMAND ====================
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) return;

    const message = match[1];
    bot.sendMessage(chatId, `📢 Starting broadcast...`);

    const users = db.getUsers();
    const targetIds = Object.keys(users);

    let sent = 0;
    let failed = 0;

    for (const tid of targetIds) {
        try {
            await bot.sendMessage(tid, message);
            sent++;
            await new Promise(r => setTimeout(r, 50)); // Rate limit 20msg/sec
        } catch (e) {
            failed++;
        }
    }

    bot.sendMessage(chatId, `✅ Broadcast Complete.\nSent: ${sent}\nFailed: ${failed}`);
});
