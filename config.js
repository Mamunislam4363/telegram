require('dotenv').config();

module.exports = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    APP_URL: process.env.APP_URL,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    BOT_USERNAME: process.env.BOT_USERNAME,
    ADMIN_ID: process.env.ADMIN_ID,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
    REQUIRED_CHANNEL_NAME: process.env.REQUIRED_CHANNEL_NAME,
    REQUIRED_GROUP_NAME: process.env.REQUIRED_GROUP_NAME,
    REQUIRED_CHANNEL_ID: process.env.REQUIRED_CHANNEL_ID,
    REQUIRED_GROUP_ID: process.env.REQUIRED_GROUP_ID,
    REQUIRED_CHANNEL: process.env.REQUIRED_CHANNEL_NAME,
    REQUIRED_GROUP: process.env.REQUIRED_GROUP_NAME,
    SKIP_MANDATORY_JOIN: process.env.SKIP_MANDATORY_JOIN === 'true',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SMTPLABS_API_KEY: process.env.SMTPLABS_API_KEY,
    BACKUP_BOT_TOKEN: process.env.BACKUP_BOT_TOKEN,
    BACKUP_CHAT_ID: process.env.BACKUP_CHAT_ID,
    USE_PROXY: process.env.USE_PROXY === 'true',
    PROXY_URL: process.env.PROXY_URL,
    PUBLIC_URL: process.env.APP_URL,
    MINI_APP_URL: process.env.APP_URL
};
