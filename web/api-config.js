// API Configuration for Railway + Netlify deployment
// This file centralizes API base URL configuration

// For Railway deployment, use the Railway backend URL
// For local development, use http://localhost:3000

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) ||
    (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://autosverify-api.up.railway.app');

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_BASE };
}

// Global window export for HTML script tag usage
if (typeof window !== 'undefined') {
    window.API_BASE = API_BASE;
}

console.log('🌐 API_BASE configured:', API_BASE);
