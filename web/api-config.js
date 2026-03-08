// API Configuration for Railway + Netlify deployment
// This file centralizes API base URL configuration

// Always use Railway production URL (localhost check fails in Telegram WebApp)
const API_BASE = 'https://autosverifybot-production.up.railway.app';

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_BASE };
}

// Global window export for HTML script tag usage
if (typeof window !== 'undefined') {
    window.API_BASE = API_BASE;
}

console.log('🌐 API_BASE configured:', API_BASE);
