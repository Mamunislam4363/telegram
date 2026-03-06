const TelegramBot = require('node-telegram-bot-api');
process.env.NTBA_FIX_350 = 1;
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

// Force all logs to a file so we can see what the user sees
const fsLog = require('fs');
const logFile = require('path').join(__dirname, 'global_log.txt');
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function (...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    fsLog.appendFileSync(logFile, `[LOG] ${new Date().toISOString()} ${msg}\n`);
    originalConsoleLog.apply(console, args);
};

console.error = function (...args) {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
    fsLog.appendFileSync(logFile, `[ERR] ${new Date().toISOString()} ${msg}\n`);
    originalConsoleError.apply(console, args);
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

bot.on('message', (msg) => {
    console.log(`[DEBUG] RAW MESSAGE RECEIVED from ${msg.from?.id}: ${msg.text}`);
});

// Global Error Handlers - silent
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e); });
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e); });

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
            bot.sendMessage(chatId, msg, opts).catch(e => console.error('Mandatory Join Msg Error:', e));
        });
    } else {
        bot.sendMessage(chatId, msg, opts).catch(e => console.error('Mandatory Join Msg Error:', e));
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
const startThrottle = new Map();
const startChatSendLock = new Map();
bot.onText(/\/start/, async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Anti-duplicate protection for start command
        const now = Date.now();
        const lastStart = startThrottle.get(userId) || 0;
        if (now - lastStart < 5000) {
            console.log(`[DEBUG] Blocked duplicate /start from ${userId}`);
            return;
        }
        startThrottle.set(userId, now);

        // Extra guard: sometimes Telegram delivers updates twice; block duplicate sends per chat
        const lastChatSend = startChatSendLock.get(chatId) || 0;
        if (now - lastChatSend < 5000) {
            console.log(`[DEBUG] Blocked duplicate /start send to chat ${chatId}`);
            return;
        }
        startChatSendLock.set(chatId, now);

        const username = msg.from.username || msg.from.first_name || 'Unknown';
        const user = db.getUser(userId);

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

// /admin command - Admin Panel Access
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    // Check if user is admin - silently ignore for non-admins
    if (!isAdmin(userId)) {
        return;
    }

    const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
    const adminUrl = `${publicUrl}/admin`;

    const adminText = `👑 *Admin Panel Access*\n\n` +
        `Hello Admin *${username}*!\n\n` +
        `🚀 *Launch Admin Panel to:*\n` +
        `• Manage users & balances\n` +
        `• Add/remove accounts\n` +
        `• View analytics & stats\n` +
        `• Broadcast messages\n` +
        `• Configure settings\n\n` +
        `*Admin ID:* \`${userId}\``;

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Open Admin Panel', web_app: { url: adminUrl } }]
            ]
        }
    };

    try {
        await bot.sendMessage(chatId, adminText, { parse_mode: 'Markdown', ...adminKeyboard });
        console.log(`[ADMIN] Admin ${username} (${userId}) accessed admin panel`);
    } catch (e) {
        console.error('Error sending admin panel:', e);
    }
});
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

    // Chat reward logic: Award 5 tokens per message in the required group
    const requiredGroup = (config.REQUIRED_GROUP || '').replace('@', '').toLowerCase();
    const chatUsername = (msg.chat && msg.chat.username) ? msg.chat.username.toLowerCase() : '';

    if (chatUsername === requiredGroup && msg.from && !msg.from.is_bot) {
        const userId = msg.from.id;
        const user = db.getUser(userId);
        if (user) {
            const reward = 5;
            user.tokens = (user.tokens || user.balance_tokens || 0) + reward;
            if (user.balance_tokens !== undefined) user.balance_tokens = user.tokens;
            
            if (!user.history) user.history = [];
            user.history.unshift({
                type: 'chat_reward',
                amount: reward,
                currency: 'tokens',
                date: Date.now(),
                detail: 'Message reward'
            });
            db.updateUser(user);
            console.log(`[REWARD] User ${userId} earned 5 tokens for chatting in group.`);
        }
    }
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
        const data = query.data;
        const msgId = query.message.message_id;
        const username = query.from.username || query.from.first_name || 'Unknown';

        // Log user activity
        originalConsoleLog(`👤 User: ${userId} (${username}) | 💬 Action: ${data} | ⏰ ${new Date().toLocaleTimeString()}`);

        // Ensure User Exists
        const user = db.getUser(userId);

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

        // ==================== ADMIN PANEL ====================

        // ADMIN PANEL MAIN
        else if (data === 'admin_panel') {
            if (!isAdmin(userId)) {
                return bot.answerCallbackQuery(query.id, { text: "⚠️ Admin Access Only", show_alert: true });
            }

            // Delete previous message to avoid edit errors
            bot.deleteMessage(chatId, msgId).catch(() => { });

            const msg = `⚙️ <b>Admin Panel</b>\n\nManage your bot from here:`;

            const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
            const adminUrl = `${publicUrl}/admin`;

            bot.sendMessage(chatId, msg, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Open Admin Panel', web_app: { url: adminUrl } }]
                    ]
                }
            }).catch(e => console.error('Admin Panel Error:', e.message));
        }
    } catch (e) {
        console.error('Error handling callback query:', e);
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

// Initial backup on startup DISABLED to prevent nodemon restart loops
/*
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
}, 5000); 
*/

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
    // console.log(`🛡️ Auto-Backup Service initialized (Interval: 15 days).`);
} else {
    // console.warn('⚠️ BACKUP_BOT_TOKEN missing. Auto-Backup disabled.');
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
