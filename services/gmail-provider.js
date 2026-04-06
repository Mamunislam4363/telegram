/**
 * Gmail Provider Integration
 * Fetches Gmail addresses from external websites
 * Supports: mailticking.com, emailnator.com
 */

const axios = require('axios');
const cheerio = require('cheerio');

class GmailProvider {
    constructor() {
        this.providers = [
            {
                name: 'mailticking',
                url: 'https://www.mailticking.com/',
                enabled: true
            },
            {
                name: 'emailnator',
                url: 'https://www.emailnator.com/',
                enabled: true
            }
        ];
    }

    /**
     * Generate a Gmail address from available providers
     * @returns {Promise<Object>} Email data with address and session info
     */
    async generateEmail() {
        const errors = [];
        
        // Try each provider in order
        for (const provider of this.providers.filter(p => p.enabled)) {
            try {
                const result = await this.tryProvider(provider);
                if (result) {
                    return {
                        success: true,
                        email: result.email,
                        password: result.password || this.generatePassword(),
                        provider: provider.name,
                        sessionId: result.sessionId || `session_${Date.now()}`,
                        type: 'gmail'
                    };
                }
            } catch (e) {
                console.error(`[GmailProvider] ${provider.name} failed:`, e.message);
                errors.push(`${provider.name}: ${e.message}`);
            }
        }
        
        // All providers failed
        return {
            success: false,
            message: 'All Gmail providers failed. Errors: ' + errors.join('; ')
        };
    }

    /**
     * Try a specific provider
     */
    async tryProvider(provider) {
        switch (provider.name) {
            case 'mailticking':
                return await this.fetchFromMailTicking();
            case 'emailnator':
                return await this.fetchFromEmailNator();
            default:
                throw new Error('Unknown provider: ' + provider.name);
        }
    }

    /**
     * Fetch from mailticking.com
     */
    async fetchFromMailTicking() {
        // mailticking.com API - requires scraping or API endpoint
        // This is a placeholder implementation - actual implementation
        // would need to reverse engineer their API or use browser automation
        
        const response = await axios.get('https://www.mailticking.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        // Parse the HTML to find email address
        const $ = cheerio.load(response.data);
        const emailElement = $('#email-address, .email-address, [data-email]').first();
        const email = emailElement.text().trim() || emailElement.data('email');
        
        if (!email || !email.includes('@gmail.com')) {
            throw new Error('No Gmail address found on mailticking.com');
        }

        return {
            email: email,
            sessionId: `mt_${Date.now()}`
        };
    }

    /**
     * Fetch from emailnator.com
     */
    async fetchFromEmailNator() {
        // emailnator.com typically has an API endpoint
        // This is a placeholder - actual implementation would use their API
        
        try {
            // Try their API endpoint first
            const response = await axios.post('https://www.emailnator.com/api/generate', {
                type: 'gmail'
            }, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 15000
            });

            if (response.data && response.data.email) {
                return {
                    email: response.data.email,
                    sessionId: response.data.sessionId || `en_${Date.now()}`
                };
            }
        } catch (e) {
            console.log('[GmailProvider] emailnator API failed, trying fallback:', e.message);
        }

        // Fallback: scrape the webpage
        const response = await axios.get('https://www.emailnator.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const email = $('input[name="email"], #email, .email-display').first().val() || 
                      $('input[name="email"], #email, .email-display').first().text().trim();

        if (!email || !email.includes('@gmail.com')) {
            throw new Error('No Gmail address found on emailnator.com');
        }

        return {
            email: email,
            sessionId: `en_${Date.now()}`
        };
    }

    /**
     * Fetch inbox messages for a Gmail address
     * @param {string} email - The Gmail address
     * @param {string} providerName - Which provider to use
     * @returns {Promise<Array>} List of messages
     */
    async fetchInbox(email, providerName) {
        const provider = this.providers.find(p => p.name === providerName);
        if (!provider) {
            throw new Error('Provider not found: ' + providerName);
        }

        switch (provider.name) {
            case 'mailticking':
                return await this.fetchMailTickingInbox(email);
            case 'emailnator':
                return await this.fetchEmailNatorInbox(email);
            default:
                throw new Error('Unknown provider');
        }
    }

    /**
     * Fetch inbox from mailticking.com
     */
    async fetchMailTickingInbox(email) {
        const response = await axios.get(`https://www.mailticking.com/inbox/${encodeURIComponent(email)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        const messages = [];

        $('.message, .email-item, [data-message-id]').each((i, el) => {
            const from = $(el).find('.from, .sender').text().trim();
            const subject = $(el).find('.subject').text().trim();
            const preview = $(el).find('.preview, .body-preview').text().trim();
            const date = $(el).find('.date, .time').text().trim();
            const msgId = $(el).data('message-id') || `msg_${i}`;

            if (from || subject) {
                messages.push({
                    id: msgId,
                    from: from || 'Unknown',
                    subject: subject || 'No Subject',
                    preview: preview || '',
                    date: date || new Date().toLocaleString(),
                    body: null // Would need separate fetch for full body
                });
            }
        });

        return messages;
    }

    /**
     * Fetch inbox from emailnator.com
     */
    async fetchEmailNatorInbox(email) {
        const response = await axios.post('https://www.emailnator.com/api/inbox', {
            email: email
        }, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (response.data && Array.isArray(response.data.messages)) {
            return response.data.messages.map((m, i) => ({
                id: m.id || `en_msg_${i}`,
                from: m.from || 'Unknown',
                subject: m.subject || 'No Subject',
                preview: m.body ? m.body.substring(0, 100) + '...' : '',
                date: m.date || new Date().toLocaleString(),
                body: m.body || null
            }));
        }

        return [];
    }

    /**
     * Generate a random password for Gmail accounts
     */
    generatePassword() {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    /**
     * Check provider health
     */
    async checkHealth() {
        const results = [];
        
        for (const provider of this.providers) {
            try {
                const start = Date.now();
                await axios.head(provider.url, { timeout: 10000 });
                results.push({
                    name: provider.name,
                    status: 'online',
                    responseTime: Date.now() - start
                });
            } catch (e) {
                results.push({
                    name: provider.name,
                    status: 'offline',
                    error: e.message
                });
            }
        }
        
        return results;
    }
}

// Export singleton instance
module.exports = new GmailProvider();
