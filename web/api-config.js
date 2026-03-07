// API Configuration for Netlify deployment
// This file centralizes API base URL configuration
// When deploying to Netlify, set API_BASE in your environment variables
// For local development, use http://localhost:3000

const API_BASE = (typeof window !== 'undefined' && window.__API_BASE__) || 
                 (typeof process !== 'undefined' && process.env && process.env.API_BASE_URL) ||
                 'http://localhost:3000';

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_BASE };
}

// Global window export for HTML script tag usage
if (typeof window !== 'undefined') {
    window.API_BASE = API_BASE;
}
