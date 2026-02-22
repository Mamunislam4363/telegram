require('dotenv').config();

module.exports = {
    // Get your token from @BotFather on Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8160315112:AAFXkQvshWwMqNaPYFX7T6mgOjtDK9W8GKw',

    // Bot Username (needed for webapp links) - Get from @BotFather
    BOT_USERNAME: process.env.BOT_USERNAME || 'AutosVerify_bot',

    // Allowed users (optional, leave empty to allow everyone)
    ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : ['8125978050'],

    // Admin ID for notifications
    ADMIN_ID: process.env.ADMIN_ID || '8125978050',

    // Admin Panel Password
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',

    // Public URL for web panel (your domain or IP)
    PUBLIC_URL: process.env.PUBLIC_URL || 'https://autosverify-bot.onrender.com',  // Domain URL

    // OAUTH CONFIGURATION (FOR GMAIL SERVICE SYSTEM)
    // Create credentials at: https://console.cloud.google.com/apis/credentials
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID || '144971511452-tb0ohi6g0o4q3metmsrtj7ev2vadipi4.apps.googleusercontent.com',
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET || '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',
    // Dynamic Redirect URI based on Public URL
    get OAUTH_REDIRECT_URI() {
        return (process.env.OAUTH_REDIRECT_URI || `${this.PUBLIC_URL}/auth/google/callback`);
    },

    // Mini App Subdomain (Telegram Mini App URL)
    MINI_APP_URL: process.env.MINI_APP_URL || 'https://autosverify-bot.onrender.com',  // Telegram Mini App subdomain

    // Mandatory Channel & Group (users MUST join to use the bot)
    REQUIRED_CHANNEL: '@AutosVerifyCh',  // Channel username or ID
    REQUIRED_GROUP: '@AutosVerify',  // Group username or ID

    // Payment Methods (Enable/Disable)
    PAYMENT_METHODS: {
        crypto: {
            enabled: true,
            name: 'Cryptocurrency (USDT TRC20)',
            address: process.env.USDT_ADDRESS || 'YOUR_USDT_TRC20_ADDRESS_HERE',
            ratePerCredit: 0.01  // 1 credit = 0.01 USDT
        },
    },

    // Support Settings
    SUPPORT_CHANNEL: '@Onlin_Income_Support',  // Support channel/group
    SUPPORT_COST: 10,  // Credits required to access support (editable by admin)

    // Default Referral Bonus
    REFERRAL_BONUS: 50, // Default credits per referral

    // Command settings
    DEFAULT_TYPE: 'spotify',

    // Remote API Access (Frontend on Hostinger)
    API_KEY: process.env.API_KEY || 'tg_bot_remote_access_key_123', // CHANGE THIS!
    API_BASE_URL: process.env.API_BASE_URL || 'https://autosverify-bot.onrender.com', // Your VPS URL

    // SmtpLabs API (Gmail Automation)
    SMTPLABS_API_KEY: 'smtplabs_SQGEMA1yD2cEgFJFJn38Uh7dGcDydAWYut7R7RzZQD3Hbvox',

    // Automated Backup Bot
    BACKUP_BOT_TOKEN: '8395111217:AAEGWAPDvBbWThgZ6FGB_5ok58l_B3X3Zqo'
};
