require('dotenv').config();

module.exports = {
    // Get your token from @BotFather on Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,

    // Bot Username (needed for webapp links) - Get from @BotFather
    BOT_USERNAME: process.env.BOT_USERNAME || 'AutosVerify_bot',

    // Allowed users (optional, leave empty to allow everyone)
    ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS ? process.env.ALLOWED_USER_IDS.split(',') : ['8125978050'],

    // Admin ID for notifications
    ADMIN_ID: process.env.ADMIN_ID || '8125978050',

    // Admin Panel Password
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Mamunislam4363@',

    // Public URL for web panel (your domain or IP)
    PUBLIC_URL: process.env.PUBLIC_URL || 'https://autosverifybot-production.up.railway.app',

    // OAUTH CONFIGURATION (FOR GMAIL SERVICE SYSTEM)
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    get OAUTH_REDIRECT_URI() {
        return (process.env.OAUTH_REDIRECT_URI || `${this.PUBLIC_URL}/auth/google/callback`);
    },

    // Mini App URL
    MINI_APP_URL: process.env.MINI_APP_URL || 'https://autosverifybot-production.up.railway.app',

    // Mandatory Channel & Group (IDs are preferred for stability)
    REQUIRED_CHANNEL: process.env.REQUIRED_CHANNEL_ID || '@AutosVerify',
    REQUIRED_GROUP: process.env.REQUIRED_GROUP_ID || '@AutosVerifyCh',
    REQUIRED_CHANNEL_NAME: process.env.REQUIRED_CHANNEL_NAME || '@AutosVerify',
    REQUIRED_GROUP_NAME: process.env.REQUIRED_GROUP_NAME || '@AutosVerifyCh',

    // Encryption Key for sensitive data in DB
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long____',

    // Payment Methods
    PAYMENT_METHODS: {
        crypto: {
            enabled: true,
            name: 'Cryptocurrency (USDT TRC20)',
            address: process.env.USDT_ADDRESS || 'YOUR_USDT_TRC20_ADDRESS_HERE',
            ratePerCredit: 0.01
        },
    },

    // Support Settings
    SUPPORT_CHANNEL: '@Onlin_Income_Support',
    SUPPORT_COST: 10,

    // Default Referral Bonus
    REFERRAL_BONUS: 50,

    // SmtpLabs API
    SMTPLABS_API_KEY: process.env.SMTPLABS_API_KEY,

    // Automated Backup Bot
    BACKUP_BOT_TOKEN: process.env.BACKUP_BOT_TOKEN,
    BACKUP_CHAT_ID: process.env.BACKUP_CHAT_ID || '8125978050',

    // OpenAI Configuration
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
};
