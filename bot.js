const TelegramBot = require('node-telegram-bot-api');
process.env.NTBA_FIX_350 = "1";

// CRITICAL: Global Error Handlers to prevent crashes from network issues
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit, just log. This prevents the bot from crashing on transient network errors.
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    if (err.stack) console.error(err.stack);
    // Only exit for truly critical errors, but keep it running for most
    if (err.message.includes('EBADF') || err.message.includes('ENOMEM')) {
        process.exit(1);
    }
});
const axios = require('axios');
const SocksProxyAgent = require('socks-proxy-agent');


console.log('🏁 Bot script starting...');
const config = require('./config.js');
const tempMail = require('./services/tempmail-providers.js');
const oauth = require('./oauth.js');
const db = require('./db.js');
const { languages, getText, getUserLanguage } = require('./languages.js');
const fs = require('fs');
const path = require('path');
const apiGateway = require('./services/api-gateway.js');

// Store original console.log for internal logging
const originalConsoleLog = console.log.bind(console);

// Validate Config
const isValidToken = (t) => t && t !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE' && t !== 'undefined' && t !== 'null' && t.trim() !== '';

let bot = {
    on: () => {},
    onText: () => {},
    getMe: () => Promise.resolve({ username: 'MockBot', id: 0 }),
    sendMessage: () => Promise.resolve({}),
    startPolling: () => Promise.resolve(),
    setChatMenuButton: () => Promise.resolve(),
    getChat: () => Promise.reject(new Error('No token')),
    getChatMember: () => Promise.reject(new Error('No token')),
    editMessageText: () => Promise.resolve({}),
    answerCallbackQuery: () => Promise.resolve({})
};
let botOptions = {
    polling: false, // Wait for DB load
    polling_timeout: 30, // Increased for better stability
    polling_options: {
        interval: 2000, // Wait 2s between polls to reduce network strain
        allowed_updates: [
            'message',
            'callback_query',
            'chat_member',
            'my_chat_member',
            'inline_query'
        ]
    },
    baseApiUrl: config.TELEGRAM_API_BASE || 'https://api.telegram.org'
};

// Start Polling ONLY after DB is ready (Unlocks Phase 1 & 2)
db.dbReady.then(() => {
    console.log("🚀 Database Ready (Firebase/Local). Starting Bot...");
    
    // Evaluate token priority: 1. ENV, 2. Database
    const finalToken = config.TELEGRAM_BOT_TOKEN || (db.data && db.data.apiKeys && db.data.apiKeys.botToken);
    
    if (isValidToken(finalToken)) {
        // Apply Proxy if enabled
        if (config.USE_PROXY && config.PROXY_URL) {
            console.log(`🌐 Using Proxy for Bot Connection: ${config.PROXY_URL}`);
            if (config.PROXY_URL.startsWith('socks')) {
                botOptions.request = {
                    agent: new SocksProxyAgent(config.PROXY_URL)
                };
            } else {
                botOptions.request = {
                    proxy: config.PROXY_URL
                };
            }
        }

        bot = new TelegramBot(finalToken, botOptions);

        // Inject bot into web server early
        try {
            const server = require('./database/server.js');
            server.setBot(bot);
        } catch (e) {
            console.error('⚠️ [ERROR] Failed to set bot in server:', e.message);
        }

        bot.startPolling();
        console.log('✅ Bot is now polling messages.');
        
        // Initialize all listeners
        setupBotListeners();
        
    } else {
        console.warn('⚠️ WARNING: TELEGRAM_BOT_TOKEN is missing or invalid in both ENV and DB. Bot functionality will be disabled.');
        // Mock bot object to prevent crashes
        bot = {
            on: () => {},
            onText: () => {},
            getMe: () => Promise.resolve({ username: 'MockBot', id: 0 }),
            sendMessage: () => Promise.resolve({}),
            startPolling: () => Promise.resolve(),
            setChatMenuButton: () => Promise.resolve(),
            getChat: () => Promise.reject(new Error('No token')),
            getChatMember: () => Promise.reject(new Error('No token')),
            editMessageText: () => Promise.resolve({}),
            answerCallbackQuery: () => Promise.resolve({})
        };
        
        // Inject mock bot into server too
        try {
            const server = require('./database/server.js');
            server.setBot(bot);
        } catch (e) {}
    }
});

// SMTP.DEV API Integration (Full Implementation)
const SMTP_API_BASE = 'https://api.smtp.dev';
const SMTP_API_KEY = config.SMTPLABS_API_KEY;

// Helper: Extract OTP from text — uses centralized robust extractor
const { extractOTP: _robustExtractOTP } = require('./services/otp-extractor');
function extractOTP(text, subject = '') {
    if (!text) return null;
    const result = _robustExtractOTP(text, subject);
    return result ? result.otp : null;
}


// Create a new email account via API Gateway (Generic Email Provider)
async function fetchSmtpLabsEmail() {
    try {
        const result = await apiGateway.executeWithFailover('email', async (provider) => {
            const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const randomPass = `Pass${Date.now()}!`;
            const domain = '@smtp.dev';
            const emailAddress = randomUser + domain;

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

        if (!accountId) {
            const res = await axios.get(`${apiBase}/accounts?address=${email}`, { headers, timeout: 5000 });
            if (res.data?.member?.length > 0) accountId = res.data.member[0].id;
            else return null;
        }

        if (!mailboxId) {
            const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes`, { headers, timeout: 5000 });
            const inbox = res.data?.member?.find(m => m.path === 'INBOX');
            if (inbox) mailboxId = inbox.id;
            else return null;
        }

        const msgRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages`, { headers, timeout: 5000 });
        if (msgRes.data?.member?.length > 0) {
            const latestMsg = msgRes.data.member[0];
            const fullRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages/${latestMsg.id}`, { headers, timeout: 5000 });
            const fullMsg = fullRes.data;
            const body = fullMsg.body?.text || '';
            const subject = fullMsg.subject || latestMsg.subject || '';
            const textContent = `${subject} ${body}`;
            const otp = extractOTP(body, subject);


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
        return null;
    }
}

function setupBotListeners() {
    if (!bot) return;

    // Suppress polling error logs with retry logic
    let retryCount = 0;
    let retryTimeout = null;

    bot.on('polling_error', (err) => {
        // Only log actual errors, not conflict warnings (409)
        if (err.code !== 'ETELEGRAM' || !err.message.includes('409')) {
            const isNetworkError = err.message.includes('ECONNRESET') || 
                                   err.message.includes('ETIMEDOUT') || 
                                   err.message.includes('ECONNREFUSED') ||
                                   err.message.includes('ENOTFOUND') ||
                                   err.message.includes('socket disconnected') ||
                                   err.message.includes('EHOSTUNREACH');

            if (isNetworkError) {
                retryCount++;
                // Exponential backoff: 5s, 10s, 20s, 30s... max 1 minute
                const delay = Math.min(60000, retryCount * 5000);
                
                console.log(`⚠️ Network issue: ${err.message}. Retrying in ${delay / 1000}s (Attempt ${retryCount})...`);
                
                if (err.message.includes('ENOTFOUND')) {
                    console.warn('💡 DNS Error: If this persists, Telegram might be blocked. Try setting USE_PROXY=true in config.js');
                }

                if (retryTimeout) clearTimeout(retryTimeout);
                
                retryTimeout = setTimeout(async () => {
                    try {
                        console.log('🔄 Attempting to reconnect bot...');
                        if (bot.isPolling()) {
                            await bot.stopPolling();
                            await new Promise(r => setTimeout(r, 1000));
                        }
                        await bot.startPolling();
                        console.log('✅ Bot reconnected successfully.');
                        retryCount = 0; // Reset count on success
                    } catch (e) {
                        console.log('⚠️ Reconnection attempt failed:', e.message);
                    }
                }, delay);
            } else {
                console.log(`❌ Bot error: ${err.message}`);
            }
        }
    });

    // Reset retry count on successful message
    bot.on('message', () => { retryCount = 0; });

    // File logging disabled as requested by user

    console.log('🤖 Telegram Verification Bot Started');
    console.log('📊 Activity: Bot is running and waiting for users...');

    bot.getMe().then(me => {
        console.log(`📊 Activity: Bot connected as @${me.username}`);
        if (!db.data.settings) db.data.settings = {};
        db.data.settings.botUsername = me.username;
        db.save();

        // Validate mandatory channels
        validateMandatoryChannels();
    }).catch(err => {
        // Silently handle connection errors
    });

// Validate mandatory channels on startup
let channelsValidated = false;
let channelsAccessible = false;

async function validateMandatoryChannels() {
    if (config.SKIP_MANDATORY_JOIN) {
        console.log('⏭️ Mandatory join check is DISABLED (SKIP_MANDATORY_JOIN=true)');
        channelsValidated = true;
        channelsAccessible = false;
        return;
    }

    try {
        let channelOk = false;
        let groupOk = false;

        if (config.REQUIRED_CHANNEL) {
            try {
                const chat = await bot.getChat(config.REQUIRED_CHANNEL);
                console.log(`✅ Channel accessible: ${chat.title || config.REQUIRED_CHANNEL}`);
                channelOk = true;
            } catch (e) {
                console.warn(`⚠️ Channel not accessible: ${config.REQUIRED_CHANNEL} - ${e.message}`);
                console.warn('   Users will be blocked until this is fixed or SKIP_MANDATORY_JOIN is enabled');
            }
        } else {
            channelOk = true;
        }

        if (config.REQUIRED_GROUP) {
            try {
                const chat = await bot.getChat(config.REQUIRED_GROUP);
                console.log(`✅ Group accessible: ${chat.title || config.REQUIRED_GROUP}`);
                groupOk = true;
            } catch (e) {
                console.warn(`⚠️ Group not accessible: ${config.REQUIRED_GROUP} - ${e.message}`);
                console.warn('   Users will be blocked until this is fixed or SKIP_MANDATORY_JOIN is enabled');
            }
        } else {
            groupOk = true;
        }

        channelsValidated = true;
        channelsAccessible = channelOk && groupOk;

        if (!channelsAccessible) {
            console.warn('\n⚠️⚠️⚠️ MANDATORY CHANNELS NOT ACCESSIBLE ⚠️⚠️⚠️');
            console.warn('To fix this, either:');
            console.warn('1. Create the channels and add the bot as admin');
            console.warn('2. Update REQUIRED_CHANNEL and REQUIRED_GROUP in config.js');
            console.warn('3. Set SKIP_MANDATORY_JOIN=true in config.js to disable this check\n');
        }
    } catch (e) {
        console.error('Error validating channels:', e.message);
    }
}

// Helper: Check if membership check should be skipped
function shouldSkipMembershipCheck() {
    // 1. Check hardcoded config (Emergency override)
    if (config.SKIP_MANDATORY_JOIN === true || config.SKIP_MANDATORY_JOIN === 'true') return true;

    // 2. Check dynamic database flag (Feature Flags from Admin Panel)
    const flags = db.data?.featureFlags || {};
    if (flags.joinRequired === false) return true;

    // 3. If no channel/group configured, skip
    const apiKeys = db.data?.apiKeys || {};
    const settings = db.data?.settings || {};
    const channel = apiKeys.requiredChannel || settings.requiredChannel || config.REQUIRED_CHANNEL;
    const group = apiKeys.requiredGroup || settings.requiredGroup || config.REQUIRED_GROUP;
    
    if (!channel && !group) return true;

    return false;
}

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
    if (!userId) return false;
    const adminId = String(config.ADMIN_ID || '');
    const allowedIds = config.ALLOWED_USER_IDS || [];
    return String(userId) === adminId || allowedIds.includes(String(userId));
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
    // Skip check if disabled in config
    if (shouldSkipMembershipCheck()) {
        return { channel: true, group: true, skipped: true };
    }

    try {
        const results = {
            channel: false,
            group: false,
            channelError: null,
            groupError: null
        };
        const validStatuses = ['creator', 'administrator', 'member', 'restricted'];

        // Get dynamic config from DB
        const apiKeys = db.data?.apiKeys || {};
        const settings = db.data?.settings || {};
        
        const requiredChannelId = apiKeys.requiredChannelId || config.REQUIRED_CHANNEL_ID;
        const requiredChannelName = apiKeys.requiredChannel || settings.requiredChannel || config.REQUIRED_CHANNEL;
        
        const requiredGroupId = apiKeys.requiredGroupId || config.REQUIRED_GROUP_ID;
        const requiredGroupName = apiKeys.requiredGroup || settings.requiredGroup || config.REQUIRED_GROUP;

        // Check channel membership
        if (requiredChannelId || requiredChannelName) {
            try {
                // Try ID first if it looks like one, otherwise use name
                const targetChannel = requiredChannelId || requiredChannelName;
                const channelMember = await bot.getChatMember(targetChannel, userId);
                results.channel = validStatuses.includes(channelMember.status);
            } catch (error) {
                results.channelError = error.message;
                if ((error.message.includes('chat not found') || error.message.includes('PARTICIPANT_ID_INVALID')) && requiredChannelName && requiredChannelName !== requiredChannelId) {
                    try {
                        const channelMember = await bot.getChatMember(requiredChannelName, userId);
                        results.channel = validStatuses.includes(channelMember.status);
                    } catch (e2) {
                        results.channel = (config.SKIP_MANDATORY_JOIN === true || config.SKIP_MANDATORY_JOIN === 'true');
                    }
                } else {
                    if (!error.message.includes('chat not found') && !error.message.includes('PARTICIPANT_ID_INVALID')) {
                        console.log(`[MEMBERSHIP] Channel check for ${userId} (${requiredChannelId}): ${error.message}`);
                    }
                    results.channel = (config.SKIP_MANDATORY_JOIN === true || config.SKIP_MANDATORY_JOIN === 'true');
                }
            }
        } else {
            results.channel = true; // No channel required
        }

        // Check group membership
        if (requiredGroupId || requiredGroupName) {
            try {
                const targetGroup = requiredGroupId || requiredGroupName;
                const groupMember = await bot.getChatMember(targetGroup, userId);
                results.group = validStatuses.includes(groupMember.status);
            } catch (error) {
                results.groupError = error.message;
                if ((error.message.includes('chat not found') || error.message.includes('PARTICIPANT_ID_INVALID')) && requiredGroupName && requiredGroupName !== requiredGroupId) {
                    try {
                        const groupMember = await bot.getChatMember(requiredGroupName, userId);
                        results.group = validStatuses.includes(groupMember.status);
                    } catch (e2) {
                        results.group = (config.SKIP_MANDATORY_JOIN === true || config.SKIP_MANDATORY_JOIN === 'true');
                    }
                } else {
                    if (!error.message.includes('chat not found') && !error.message.includes('PARTICIPANT_ID_INVALID')) {
                        console.log(`[MEMBERSHIP] Group check for ${userId} (${requiredGroupId}): ${error.message}`);
                    }
                    results.group = (config.SKIP_MANDATORY_JOIN === true || config.SKIP_MANDATORY_JOIN === 'true');
                }
            }
        } else {
            results.group = true; // No group required
        }

        return results;
    } catch (error) {
        console.error('Membership check fatal error:', error);
        // Fail-open strategy: if bot is broken, let users through to prevent total outage
        return { channel: true, group: true, skipped: true };
    }
}

function showMandatoryJoin(chatId, membership, msgId = null, isFirstTime = false) {
    // Get settings from database (admin panel configured)
    const settings = db.getSettings ? db.getSettings() : (db.data.settings || {});
    const apiKeys = db.data?.apiKeys || {};

    // Use admin panel configured channel/group names or fallbacks
    const channelName = apiKeys.requiredChannel || settings.requiredChannel || config.REQUIRED_CHANNEL_NAME || '@AutosVerify';
    const groupName = apiKeys.requiredGroup || settings.requiredGroup || config.REQUIRED_GROUP_NAME || '@AutosVerifyCh';

    // Determine what's missing and what's joined
    const missingItems = [];
    const joinedItems = [];

    if (!membership.channel) {
        missingItems.push({ label: '📢 Channel', name: channelName });
    } else {
        joinedItems.push({ label: '📢 Channel', name: channelName });
    }

    if (!membership.group) {
        missingItems.push({ label: '💬 Group', name: groupName });
    } else {
        joinedItems.push({ label: '💬 Group', name: groupName });
    }

    // Build message
    let msg = `🚫 *Access Restricted!*\n\n`;

    if (missingItems.length === 1 && joinedItems.length === 1) {
        // One missing, one joined - show which one they left
        const missing = missingItems[0];
        const joined = joinedItems[0];

        msg += `You left our ${missing.label} and your access has been *revoked*.\n\n`;
        msg += `Please rejoin to continue using the bot:\n\n`;
        msg += `✅ ${joined.label}: \`${joined.name}\` *(Already joined)*\n`;
        msg += `❌ ${missing.label}: \`${missing.name}\` *(Missing)*`;
    } else if (missingItems.length === 1) {
        // Only one item configured, and it's missing
        const item = missingItems[0];
        if (isFirstTime) {
            msg += `To use this bot, you need to join our ${item.label}.\n\n`;
            msg += `Please join to continue:\n\n`;
        } else {
            msg += `You left our ${item.label} and your access has been *revoked*.\n\n`;
            msg += `Please rejoin to continue using the bot:\n\n`;
        }
        msg += `❌ ${item.label}: \`${item.name}\``;
    } else if (missingItems.length === 2) {
        // Both missing
        if (isFirstTime) {
            msg += `To use this bot, you need to join our communities.\n\n`;
            msg += `Please join both to continue:\n\n`;
        } else {
            msg += `You are not a member of our required communities.\n\n`;
            msg += `Please join to use the bot:\n\n`;
        }
        missingItems.forEach(item => {
            msg += `❌ ${item.label}: \`${item.name}\`\n`;
        });
    }
    msg += `\n\n✅ After joining, click *Verify* below.`;

    // Build join buttons - only show buttons for missing items
    const buttons = [];

    // Add join buttons for missing items only
    missingItems.forEach(item => {
        let url = item.name;
        if (!url.startsWith('http')) {
            url = `https://t.me/${url.replace('@', '')}`;
        }
        buttons.push([{
            text: `Join ${item.label} ↗`,
            url: url
        }]);
    });

    // Add verify button
    buttons.push([{ text: '✅ Verify Membership', callback_data: 'verify_membership' }]);

    const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    };

    if (msgId) {
        // Try to edit existing message
        bot.editMessageText(msg, { chat_id: chatId, message_id: msgId, ...opts })
            .then(() => console.log(`[JOIN] Updated message ${msgId} for ${chatId}`))
            .catch((e) => {
                console.log(`[JOIN] Could not edit message ${msgId}: ${e.message}`);
                // Don't send new message - just log error
            });
    } else {
        bot.sendMessage(chatId, msg, opts)
            .then((sent) => console.log(`[JOIN] Sent new message ${sent.message_id} to ${chatId}`))
            .catch(e => console.error('Mandatory Join Msg Error:', e));
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

console.log('[BOT] Registering command handlers...');

// Debug: Log bot info on startup
bot.getMe().then(botInfo => {
    console.log(`[BOT] Bot initialized: @${botInfo.username} (ID: ${botInfo.id})`);
}).catch(err => {
    console.error('[BOT] Failed to get bot info:', err.message);
});

// /start
const startThrottle = new Map();
const startChatSendLock = new Map();
bot.onText(/\/start/, async (msg) => {
    console.log(`[BOT] /start command received from ${msg.from?.id}`);
    const chatId = msg.chat.id;
    try {
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

        // Ensure user exists in database
        let user = db.getUser(userId);
        if (!user) {
            console.log(`[DEBUG] Creating new user: ${userId}`);
            user = db.getUser(userId); // This should create the user
        }

        // Log user activity
        console.log(`👤 User: ${userId} (${username}) | 🚀 Started bot | ⏰ ${new Date().toLocaleTimeString()}`);

        // Referral Logic (Pending Verification)
        const refMatch = msg.text.split(' ')[1];
        if (refMatch) {
            const refCode = String(refMatch).trim();
            // Check if it's a valid referral code format (ref_XXXXXX or numeric userId)
            if (refCode !== String(userId)) {
                // Store pending referrer if not already referred
                if (!user.referredBy && !user.pendingReferrer) {
                    user.pendingReferrer = refCode; // Store the full code
                    db.updateUser(user);

                    // Immediately create pending referral record
                    db.handleReferral(userId, refCode);
                }
            }
        }

        // Check mandatory membership
        let membership = { channel: true, group: true };
        try {
            membership = await checkMembership(userId);
        } catch (membershipError) {
            console.error('[ERROR] checkMembership failed:', membershipError.message);
            membership = { channel: true, group: true, error: membershipError.message };
        }

        console.log(`[DEBUG] Membership check result: ${JSON.stringify(membership)}`);

        if (!membership.channel || !membership.group) {
            // User not joined, show mandatory join screen (first time)

            // Remove lingering keyboard if it exists
            const cleanupMsg = await bot.sendMessage(chatId, "⏳ Initializing...", { reply_markup: { Remove_keyboard: true } });
            bot.deleteMessage(chatId, cleanupMsg.message_id).catch(() => { });

            showMandatoryJoin(chatId, membership, null, true);
            return;
        }

        // PROCESS PENDING REFERRAL - If user is already a member and has a pending referrer
        if (user.pendingReferrer) {
            db.verifyReferral(userId);
            user.pendingReferrer = null;
            db.updateUser(user);
            console.log(`[REFERRAL] Auto-verified referral for user ${userId} on start (already member)`);
        }

        // Cleanup old persistent keyboards before sending the menu
        const cleanupMsg2 = await bot.sendMessage(chatId, "⏳ Initializing...", { reply_markup: { Remove_keyboard: true } });
        bot.deleteMessage(chatId, cleanupMsg2.message_id).catch(() => { });

        // User is member, show main menu
        await sendMainMenu(chatId, user, msg.from);
    } catch (e) {
        console.error('Error handling /start:', e);
        bot.sendMessage(chatId, `❌ Bot error: ${e.message || 'Please try again in a moment.'}`).catch(() => { });
    }
});

// /api
bot.onText(/\/api/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = db.getUser(userId);

    if (!user) return bot.sendMessage(chatId, "❌ User not found. Please /start first.");

    if (user.apiStatus === 'ban') {
        return bot.sendMessage(chatId, "🚫 **Access Denied**\n\nYour API access has been restricted.", { parse_mode: 'Markdown' });
    }

    if (!user.apiKey) {
        return bot.sendMessage(chatId, 
            "🔑 **API Access**\n\nYou haven't generated an API key yet.\n\nPlease open the **Mini App > Profile > API Access** to generate your key.", 
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🚀 Open Mini App', web_app: { url: config.PUBLIC_URL } }]]
                }
            }
        );
    }

    const msgText = 
        `🔑 **Your API Access**\n\n` +
        `👤 **User ID:** \`${userId}\`\n` +
        `🔐 **API Key:** \`${user.apiKey}\`\n\n` +
        `⚠️ **Security Warning:**\n` +
        `Do not share this key with anyone. It gives full access to your account balances and services via API.`;

    bot.sendMessage(chatId, msgText, { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Regenerate in App', web_app: { url: config.PUBLIC_URL } }],
                [{ text: '📚 API Documentation', url: 'https://docs.autosverify.com' }] // Placeholder
            ]
        }
    });
});

// /admin command - Admin Panel Access
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    // Check if user is admin
    if (!isAdmin(userId)) {
        // Send response to non-admins
        return bot.sendMessage(chatId, "⚠️ *Admin Access Only*\n\nThis command is restricted to administrators only.", { parse_mode: 'Markdown' });
    }

    const publicUrl = (process.env.PUBLIC_URL || '').trim();
    if (!publicUrl) {
        console.error('PUBLIC_URL environment variable is not set.');
        return bot.sendMessage(chatId, "❌ Error: PUBLIC_URL is not configured. Please contact the administrator.");
    }

    const adminUrl = `${publicUrl}/admin`;
    console.log(`Admin Panel URL: ${adminUrl}`);

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
        bot.sendMessage(chatId, "❌ Error opening admin panel. Please try again.");
    }
});
async function sendMainMenu(chatId, user, msgFrom) {
    // Get settings from database (admin panel configured)
    const settings = db.getSettings ? db.getSettings() : (db.data.settings || {});
    const apiKeys = db.data?.apiKeys || {};

    // Use admin panel configured URLs or fallbacks
    const miniAppUrl = (apiKeys.miniAppUrl || settings.miniAppUrl || process.env.PUBLIC_URL || `http://localhost:3000`).trim();
    const requiredChannel = apiKeys.requiredChannel || settings.requiredChannel || config.REQUIRED_CHANNEL || '@AutosVerify';
    const requiredGroup = apiKeys.requiredGroup || settings.requiredGroup || config.REQUIRED_GROUP || '@AutosVerifyCh';
    const requiredYoutube = apiKeys.requiredYoutube || settings.requiredYoutube || 'https://youtube.com/@MamunIslamyts';

    // Get fresh name from Telegram message context if available, else use stored
    const firstName = (msgFrom && msgFrom.first_name) ? msgFrom.first_name :
        (user.firstName || user.first_name || 'Friend');

    // Welcome message - can be customized via admin panel
    let welcomeText = apiKeys.welcomeMessage ||
        `👋 *Hello, ${firstName}!*\n\n` +
        `Welcome to Gemini Verified! 🚀\n\n` +
        `Launch our Mini App to start earning rewards, invite friends, and manage your assets.`;

    // Replace {name} placeholder if present in custom message
    welcomeText = welcomeText.replace(/{name}/g, firstName);

    // Keyboard with admin-configurable links
    let channelUrl = requiredChannel;
    if (!channelUrl.startsWith('http')) {
        channelUrl = `https://t.me/${channelUrl.replace('@', '')}`;
    }
    let groupUrl = requiredGroup;
    if (!groupUrl.startsWith('http')) {
        groupUrl = `https://t.me/${groupUrl.replace('@', '')}`;
    }

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Launch App', web_app: { url: miniAppUrl } }],
                [
                    { text: '🔑 API Access', callback_data: 'view_api_key' },
                    { text: '📊 Profile', web_app: { url: miniAppUrl + '#profile' } }
                ],
                [{ text: '📢 Join Channel', url: channelUrl }],
                [{ text: '👥 Join Group', url: groupUrl }],
                [{ text: '📺 YouTube Channel', url: requiredYoutube }]
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

        // Notify Admin of new group/channel ID
        if (config.ADMIN_ID) {
            bot.sendMessage(config.ADMIN_ID, `🤖 **Bot Added to New ${chat.type.toUpperCase()}**\n\n📌 **Title:** ${chat.title}\n🆔 **Chat ID:** \`${chat.id}\`\n\n_Use this ID in config.js if you want to set it as a backup chat._`, { parse_mode: 'Markdown' }).catch(() => { });
        }
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
    
    // Strict Membership Check for Private Chats
    if (msg.chat && msg.chat.type === 'private' && (!msg.text || !msg.text.startsWith('/start'))) {
        const userId = msg.from.id;
        const user = db.getUser(userId);
        
        const settings = db.getSettings ? db.getSettings() : {};
        const joinRequired = settings.joinRequired !== undefined ? settings.joinRequired : true;
        
        if (joinRequired && (!user || !user.verified)) {
            const membership = await checkMembership(userId);
            if (!membership.channel || !membership.group) {
                showMandatoryJoin(userId, membership);
                return; // Stop processing further
            } else if (user) {
                user.verified = true;
                user.verifiedAt = new Date().toISOString();
                db.updateUser(user);
            }
        }
    }

    if (['group', 'supergroup', 'channel'].includes(msg.chat.type)) {
        db.saveGroup(msg.chat.id, msg.chat.title, msg.chat.type);
    }

    // Chat reward logic: Award 5 tokens per message in the required group
    const requiredGroup = String(config.REQUIRED_GROUP || '').toLowerCase();
    const chatUsername = (msg.chat && msg.chat.username) ? '@' + msg.chat.username.toLowerCase() : '';
    const chatId = String(msg.chat.id);

    if ((chatUsername === requiredGroup || chatId === requiredGroup) && msg.from && !msg.from.is_bot) {
        const userId = msg.from.id;
        const user = db.getUser(userId);
        if (user) {
            const reward = 5;
            db.setTokenBalance(user, db.getTokenBalance(user) + reward);

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
});

// ==================== GROUP MANAGEMENT: AUTO-DELETE SYSTEM MESSAGES ====================
// Auto-delete join/leave messages and other system messages in groups
bot.on('message', async (msg) => {
    // Only process group and channel messages
    if (!msg.chat || !['group', 'supergroup', 'channel'].includes(msg.chat.type)) return;

    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    // Get group management settings
    const settings = db.data?.adminSettings?.groupManagement || {};
    const autoDeleteEnabled = settings.autoDeleteSystemMessages !== false; // Default true

    if (!autoDeleteEnabled) return; // Feature disabled globally

    // Check if this is a system message that should be deleted
    let shouldDelete = false;
    let deleteReason = '';

    // Check for new chat members (join messages)
    if (msg.new_chat_members && msg.new_chat_members.length > 0) {
        // Welcome new members before deleting the system message
        for (const newMember of msg.new_chat_members) {
            // Don't welcome bots
            if (newMember.is_bot) continue;

            const welcomeText = `👋 Welcome ${newMember.first_name || 'New Member'} to ${msg.chat.title || 'our group'}!\n\n🎉 We're glad to have you here. Feel free to introduce yourself and enjoy the community!`;

            try {
                const sentMsg = await bot.sendMessage(chatId, welcomeText, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Start Bot', url: `https://t.me/${db.data.settings?.botUsername || 'YourBot'}?start=welcome` }]
                        ]
                    }
                });
                console.log(`[WELCOME] Sent welcome to ${newMember.first_name} (${newMember.id})`);

                // Auto-delete welcome message after 1 minute (60 seconds)
                setTimeout(() => {
                    bot.deleteMessage(chatId, sentMsg.message_id).catch(() => { });
                    console.log(`[WELCOME] Auto-deleted welcome message for ${newMember.first_name} after 1 minute`);
                }, 60000);
            } catch (e) {
                console.log(`[WELCOME] Failed to send welcome: ${e.message}`);
            }
        }

        if (settings.deleteJoinMessages !== false) {
            shouldDelete = true;
            deleteReason = 'join';
        }
    }

    // Check for left chat member (leave messages)
    if (msg.left_chat_member) {
        if (settings.deleteLeaveMessages !== false) {
            shouldDelete = true;
            deleteReason = 'leave';
        }
    }

    // Check for pinned message
    if (msg.pinned_message) {
        if (settings.deletePinMessages !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'pin';
        }
    }

    // Check for voice chat started
    if (msg.voice_chat_started) {
        if (settings.deleteVoiceChatStarted !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'voice_chat_started';
        }
    }

    // Check for voice chat ended
    if (msg.voice_chat_ended) {
        if (settings.deleteVoiceChatEnded !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'voice_chat_ended';
        }
    }

    // Check for video chat started
    if (msg.video_chat_started) {
        if (settings.deleteVideoChatStarted !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'video_chat_started';
        }
        
        // Auto-join live stream feature (Requested by user)
        // Note: Standard Bots cannot join voice/video chats or unmute users.
        // This requires a Userbot (MTProto API).
        if (settings.autoJoinLiveStream !== false) {
            console.log(`[LIVE-STREAM] Video chat started in ${chatId}. Bot cannot join directly via Bot API. Requires Userbot.`);
            // Placeholder for future implementation if a userbot is integrated
        }
    }

    // Check for video chat ended
    if (msg.video_chat_ended) {
        if (settings.deleteVideoChatEnded !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'video_chat_ended';
        }
    }

    // Check for video chat scheduled
    if (msg.video_chat_scheduled) {
        if (settings.deleteVideoChatScheduled !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'video_chat_scheduled';
        }
    }

    // Check for video chat participants invited
    if (msg.video_chat_participants_invited) {
        if (settings.deleteVideoChatParticipantsInvited !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'video_chat_participants_invited';
        }
    }

    // Check for proximity alert triggered
    if (msg.proximity_alert_triggered) {
        if (settings.deleteProximityAlertTriggered !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'proximity_alert';
        }
    }

    // Check for auto delete timer changed
    if (msg.message_auto_delete_timer_changed) {
        if (settings.deleteAutoDeleteTimerChanged !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'auto_delete_timer';
        }
    }

    // Check for migrate to chat
    if (msg.migrate_to_chat_id) {
        if (settings.deleteMigrateToChat !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'migrate';
        }
    }

    // Check for migrate from chat
    if (msg.migrate_from_chat_id) {
        if (settings.deleteMigrateFromChat !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'migrate';
        }
    }

    // Check for channel chat created
    if (msg.channel_chat_created) {
        if (settings.deleteChannelChatCreated !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'channel_created';
        }
    }

    // Check for supergroup chat created
    if (msg.supergroup_chat_created) {
        if (settings.deleteSupergroupChatCreated !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'supergroup_created';
        }
    }

    // Check for delete chat photo
    if (msg.delete_chat_photo) {
        if (settings.deleteDeleteGroupPhoto !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'photo_deleted';
        }
    }

    // Check for group photo changed
    if (msg.new_chat_photo && msg.new_chat_photo.length > 0) {
        if (settings.deleteGroupPhotoChanged !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'photo_changed';
        }
    }

    // Check for group title changed
    if (msg.new_chat_title) {
        if (settings.deleteTitleChanged !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'title_changed';
        }
    }

    // Check for group description changed (handled in new_chat_description or edited message)
    // Check for forum topic related messages
    if (msg.forum_topic_created) {
        if (settings.deleteForumTopicCreated !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_created';
        }
    }

    if (msg.forum_topic_edited) {
        if (settings.deleteForumTopicEdited !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_edited';
        }
    }

    if (msg.forum_topic_closed) {
        if (settings.deleteForumTopicClosed !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_closed';
        }
    }

    if (msg.forum_topic_reopened) {
        if (settings.deleteForumTopicReopened !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_reopened';
        }
    }

    if (msg.general_forum_topic_hidden) {
        if (settings.deleteGeneralForumTopicHidden !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_hidden';
        }
    }

    if (msg.general_forum_topic_unhidden) {
        if (settings.deleteGeneralForumTopicUnhidden !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'forum_topic_unhidden';
        }
    }

    // Check for giveaway messages
    if (msg.giveaway_created) {
        if (settings.deleteGiveawayCreated !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'giveaway_created';
        }
    }

    if (msg.giveaway_winners) {
        if (settings.deleteGiveawayWinners !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'giveaway_winners';
        }
    }

    if (msg.giveaway_completed) {
        if (settings.deleteGiveawayCompleted !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'giveaway_completed';
        }
    }

    // Check for boost added
    if (msg.boost_added) {
        if (settings.deleteBoostAdded !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'boost_added';
        }
    }

    // Check for chat background set
    if (msg.chat_background_set) {
        if (settings.deleteChatBackgroundSet !== false) { // Default true
            shouldDelete = true;
            deleteReason = 'background_set';
        }
    }

    // If message should be deleted, delete it
    if (shouldDelete) {
        try {
            await bot.deleteMessage(chatId, messageId);
            console.log(`[GROUP-MGMT] Deleted ${deleteReason} message in chat ${chatId}`);
        } catch (e) {
            // Silently fail - bot might not have permission to delete
            console.log(`[GROUP-MGMT] Failed to delete ${deleteReason} message in chat ${chatId}: ${e.message}`);
        }
    }
}); // Fix: Close the group management handler here!

// ==================== CHAT JOIN REQUEST HANDLER ====================
// Handle "Request to Join" updates for private channels/groups
bot.on('chat_join_request', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    
    console.log(`[JOIN_REQUEST] Received join request from ${firstName} (${userId}) for ${msg.chat.title || chatId}`);

    // Check settings
    const settings = db.data?.adminSettings || {};
    const autoApprove = settings.autoApproveJoinRequests !== false; // Default true

    if (autoApprove) {
        try {
            // Approve the request
            await bot.approveChatJoinRequest(chatId, userId);
            console.log(`[JOIN_REQUEST] Approved ${firstName} for ${msg.chat.title}`);

            // Send a welcome message directly to the user
            const welcomeText = `✅ **Congratulations!**\n\nYour request to join **${msg.chat.title}** has been approved. \n\n🚀 Click below to start using the bot and access all features!`;
            
            await bot.sendMessage(userId, welcomeText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💎 Open Bot', url: `https://t.me/${db.data.settings?.botUsername || 'YourBot'}?start=approved` }]
                    ]
                }
            }).catch(() => {
                // User might have blocked the bot, ignore
            });

        } catch (e) {
            console.log(`[JOIN_REQUEST] Error approving user: ${e.message}`);
        }
    } else {
        console.log(`[JOIN_REQUEST] Auto-approval is OFF. Request left pending.`);
    }
});


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

        const leftStatuses = ['left', 'kicked', 'banned'];
        const joinStatuses = ['member', 'administrator', 'creator'];
        const oldStatus = update.old_chat_member ? update.old_chat_member.status : null;

        if (joinStatuses.includes(newStatus) && (!oldStatus || leftStatuses.includes(oldStatus))) {
            // User JOINED!
            console.log(`🎉 User ${userId} joined monitored chat: ${chatUsername}`);

            const user = db.getUser(userId);
            if (user) {
                user.verified = true;
                user.verifiedAt = new Date().toISOString();
                db.updateUser(user);
                console.log(`[VERIFICATION] User ${userId} marked as VERIFIED (joined ${chatUsername})`);

                const botUsername = db.data.settings?.botUsername || 'YourBot';
                const welcomeText = `🎉 **Welcome to our Channel!**\n\nThanks for joining **${chatUsername}**.\n\n🚀 You are now verified! Click below to open the bot and use all features!`;

                bot.sendMessage(userId, welcomeText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '💎 Open Bot', url: `https://t.me/${botUsername}?start=joined` }]
                        ]
                    }
                }).catch(() => { });
            }
            return; // Done for join
        }

        if (!leftStatuses.includes(newStatus)) return; // Not leaving

        // User left or was kicked from a required chat - update status
        console.log(`🚨 User ${userId} left monitored chat: ${chatUsername}`);

        // Update user verification status in database
        const user = db.getUser(userId);
        if (user) {
            user.verified = false;
            user.verifiedAt = null;
            user.leftAt = new Date().toISOString();
            user.leftFrom = chatUsername;
            db.updateUser(user);
            console.log(`[VERIFICATION] User ${userId} marked as UNVERIFIED (left ${chatUsername})`);
        }

        // Notify admin immediately
        const adminId = config.ADMIN_ID;
        if (adminId) {
            bot.sendMessage(adminId,
                `⚠️ *User Left Community*\n\n` +
                `User ID: \`${userId}\`\n` +
                `Left from: ${chatUsername}\n` +
                `Status: ${newStatus}\n` +
                `Time: ${new Date().toLocaleString()}\n\n` +
                `User marked as UNVERIFIED in database.`,
                { parse_mode: 'Markdown' }
            ).catch(() => { });
        }

        // Re-check full membership status
        const membership = await checkMembership(userId);

        // Only notify if actually missing something
        if (!membership.channel || !membership.group) {
            showMandatoryJoin(userId, membership);
        }
    } catch (e) {
        // Silently handle errors
        console.error('[chat_member] Error:', e.message);
    }
});

// Callback Query Handler
bot.on('callback_query', async (query) => {
    // Update Activity
    if (query.from && query.from.id) db.updateUserActivity(query.from.id);

    // Strict Membership Check
    const userId = query.from.id;
    const user = db.getUser(userId);
    
    const settings = db.getSettings ? db.getSettings() : {};
    const joinRequired = settings.joinRequired !== undefined ? settings.joinRequired : true;
    
    if (joinRequired && (!user || !user.verified)) {
        const membership = await checkMembership(userId);
        if (!membership.channel || !membership.group) {
            showMandatoryJoin(userId, membership);
            return; // Stop processing further
        } else if (user) {
            user.verified = true;
            user.verifiedAt = new Date().toISOString();
            db.updateUser(user);
        }
    }

    // ----------------------------------------------------
    // DEBOUNCE LOGIC (Prevent Double Click)
    // ----------------------------------------------------

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
        console.log(`👤 User: ${userId} (${username}) | 💬 Action: ${data} | ⏰ ${new Date().toLocaleTimeString()}`);

        // Ensure User Exists
        const user = db.getUser(userId);

        // CHECK MEMBERSHIP ON EVERY ACTION (except verify, main_menu, admin)
        const skipMembershipCheck = ['verify_membership', 'main_menu', 'admin_panel'].includes(data);
        // Skip if admin OR if user is manually verified by admin
        const isManuallyVerified = user && (user.adminVerified === true || user.verifiedByAdmin === true);
        if (!skipMembershipCheck && !isAdmin(userId) && !isManuallyVerified) {
            const membership = await checkMembership(userId);
            if (!membership.channel || !membership.group) {
                // User left group/channel - show join message immediately
                showMandatoryJoin(chatId, membership, msgId);
                return bot.answerCallbackQuery(query.id, {
                    text: "⚠️ Please join required communities first!",
                    show_alert: true
                });
            }
        }

        // VIEW API KEY
        if (data === 'view_api_key') {
            await bot.answerCallbackQuery(query.id);
            if (user.apiStatus === 'ban') {
                return bot.sendMessage(chatId, "🚫 **Access Denied**\n\nYour API access has been restricted.", { parse_mode: 'Markdown' });
            }

            if (!user.apiKey) {
                return bot.sendMessage(chatId, 
                    "🔑 **API Access**\n\nYou haven't generated an API key yet.\n\nPlease open the **Mini App > Profile > API Access** to generate your key.", 
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '🚀 Open Mini App', web_app: { url: config.PUBLIC_URL } }]]
                        }
                    }
                );
            }

            const msgText = 
                `🔑 **Your API Access**\n\n` +
                `👤 **User ID:** \`${userId}\`\n` +
                `🔐 **API Key:** \`${user.apiKey}\`\n\n` +
                `⚠️ **Security Warning:**\n` +
                `Do not share this key with anyone. It gives full access to your account balances and services via API.`;

            return bot.sendMessage(chatId, msgText, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Regenerate in App', web_app: { url: config.PUBLIC_URL } }],
                        [{ text: '📚 API Documentation', url: 'https://docs.autosverify.com' }]
                    ]
                }
            });
        }

        // VERIFY MEMBERSHIP (Mandatory Join Check)
        if (data === 'verify_membership') {
            await bot.answerCallbackQuery(query.id, { text: "🔍 Checking membership...", show_alert: false }).catch(() => { });

            const membership = await checkMembership(userId);
            const allJoined = membership.channel && membership.group;

            if (allJoined) {
                // Verification Success
                bot.editMessageText(`✅ *Verification Success!*\n\nTime: ${new Date().toLocaleString()}`, {
                    chat_id: chatId,
                    message_id: msgId,
                    parse_mode: 'Markdown'
                }).catch(() => { });

                // PROCESS PENDING REFERRAL - Verify and give reward
                if (user.pendingReferrer) {
                    db.verifyReferral(userId);
                    user.pendingReferrer = null;
                    db.updateUser(user);
                }

                bot.deleteMessage(chatId, msgId).catch(() => { });
                sendMainMenu(chatId, user);
            } else {
                // Still missing communities
                showMandatoryJoin(chatId, membership, msgId);
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

            const publicUrl = (process.env.PUBLIC_URL || '').trim();
            const adminUrl = `${publicUrl}/admin`;
            console.log(`Admin Panel URL: ${adminUrl}`);

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
                    `📢 **Scheduled Broadcast Sent!**\n\n` +
                    `📊 **Broadcast Results:**\n` +
                    `✅ **Successful:** \`${successCount}\` users\n` +
                    `❌ **Failed:** \`${failCount}\` users\n` +
                    `📈 **Total Attempted:** \`${users.length}\` users`,
                    { parse_mode: 'Markdown' }
                ).catch(() => { });
            }

            // Remove from scheduled list
            db.removeScheduledBroadcast(broadcast.id);
        }
    });
}, 60000); // Check every minute

console.log('📅 Broadcast scheduler started');



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
}
