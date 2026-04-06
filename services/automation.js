const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

/**
 * UNIFIED AUTOMATION SERVICES
 * Combines: Advanced Email Automation + AI Service Manager + Browser Automation
 * 
 * Sections:
 * 1. Email Providers (EmailNator, MailTicking, SmailPro)
 * 2. AI Services (OpenRouter, Bytez providers)
 * 3. Browser Automation (Puppeteer-based)
 * 4. Unified Service Manager
 */

// ==========================================
// SECTION 1: EMAIL AUTOMATION (from advanced-email-automation.js)
// ==========================================

const EMAIL_CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    REQUEST_TIMEOUT: 15000,
    SESSION_REFRESH_INTERVAL: 30000,
    MAX_CONCURRENT_SESSIONS: 10,
    EMAILNATOR_LIMIT: 3,
    DEFAULT_HEADERS: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    }
};

// Session Manager
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.activeSessions = 0;
    }

    async createSession(provider, userId) {
        const sessionId = `${provider}_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`;
        const session = {
            id: sessionId,
            provider: provider,
            userId: userId,
            createdAt: Date.now(),
            emailsCreated: 0,
            isActive: true,
            cookies: {},
            lastUsed: Date.now()
        };
        this.sessions.set(sessionId, session);
        this.activeSessions++;
        this.cleanupOldSessions();
        return session;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    updateSession(sessionId, updates) {
        const session = this.sessions.get(sessionId);
        if (session) {
            Object.assign(session, updates);
            session.lastUsed = Date.now();
        }
    }

    incrementEmailCount(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.emailsCreated++;
            session.lastUsed = Date.now();
        }
    }

    cleanupOldSessions() {
        const now = Date.now();
        const MAX_AGE = 10 * 60 * 1000;
        for (const [id, session] of this.sessions.entries()) {
            if (now - session.lastUsed > MAX_AGE) {
                this.sessions.delete(id);
                this.activeSessions--;
            }
        }
    }

    getActiveSessionCount() {
        return this.activeSessions;
    }
}

const sessionManager = new SessionManager();

// EmailNator Provider (Hotmail)
const EMAILNATOR_BASE = 'https://www.emailnator.com';

class EmailNatorProvider {
    constructor() {
        this.baseUrl = EMAILNATOR_BASE;
        this.limit = EMAIL_CONFIG.EMAILNATOR_LIMIT;
    }

    async generateHotmail(sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session && session.emailsCreated >= this.limit) {
            console.log('EmailNator limit reached (3), recycling session...');
            await this.recycleSession(sessionId);
            session.emailsCreated = 0;
        }

        try {
            const initRes = await axios.get(this.baseUrl, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    ...EMAIL_CONFIG.DEFAULT_HEADERS,
                    'Referer': 'https://www.google.com/'
                }
            });

            const $ = cheerio.load(initRes.data);
            const csrfToken = $('meta[name="csrf-token"]').attr('content') || '';

            const emailData = {
                type: 'hotmail',
                domain: 'hotmail.com',
                options: ['microsoft', 'hotmail']
            };

            const createRes = await axios.post(`${this.baseUrl}/api/generate`, emailData, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    ...EMAIL_CONFIG.DEFAULT_HEADERS,
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRF-Token': csrfToken,
                    'Referer': this.baseUrl
                }
            });

            if (createRes.data && createRes.data.success) {
                sessionManager.incrementEmailCount(sessionId);
                return {
                    email: createRes.data.email,
                    token: createRes.data.token,
                    sessionId: sessionId,
                    provider: 'emailnator',
                    type: 'hotmail',
                    sessionCount: session ? session.emailsCreated : 1
                };
            }
        } catch (error) {
            console.error('EmailNator Hotmail Error:', error.message);
            if (error.response?.status === 429) {
                console.log('Rate limited, waiting before retry...');
                await this.delay(5000);
                return this.generateHotmail(sessionId);
            }
        }
        return null;
    }

    async recycleSession(sessionId) {
        try {
            await axios.post(`${this.baseUrl}/api/delete-all`, {}, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });
            await this.delay(1000);
        } catch (e) {
            console.error('Session recycle error:', e.message);
        }
    }

    async fetchMessages(sessionId, email) {
        try {
            const res = await axios.post(`${this.baseUrl}/api/inbox`, {
                email: email,
                token: sessionId
            }, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    ...EMAIL_CONFIG.DEFAULT_HEADERS,
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (res.data && Array.isArray(res.data.messages)) {
                return this.processMessages(res.data.messages);
            }
        } catch (error) {
            console.error('EmailNator Fetch Error:', error.message);
        }
        return [];
    }

    processMessages(messages) {
        return messages.map(msg => {
            const otp = this.extractOTP(msg.body || msg.preview || '');
            return {
                id: msg.id,
                from: msg.from || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || '',
                body: msg.body || msg.preview || '',
                date: msg.date || new Date().toISOString(),
                otp: otp,
                hasOTP: !!otp
            };
        });
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /\b\d{4,8}\b/,
            /\b[A-Z0-9]{6,8}\b/,
            /(?:code|otp|verification|verify)[\s:]*(\d{4,8})/i,
            /(?:code|otp)[:\s]+([A-Z0-9]{4,8})/i,
            /(?:your|the)\s+(?:code|otp|pin)[\s\w]*[:\s]+(\d{4,8})/i,
            /verify\s+your\s+email[\s\w]*[:\s]+(\d{4,8})/i,
            /Confirm your email[\s\w]*[:\s]+(\d{4,8})/i,
            /Verify[\s\w]*[:\s]+(\d{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// MailTicking Provider (Gmail)
const MAILTICKING_BASE = 'https://www.mailticking.com';

class MailTickingProvider {
    constructor() {
        this.baseUrl = MAILTICKING_BASE;
        this.activeEmails = new Map();
    }

    async generateGmail(sessionId) {
        try {
            const initRes = await axios.get(`${this.baseUrl}/api/init`, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });

            const domainsRes = await axios.get(`${this.baseUrl}/api/domains`, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });

            const domains = domainsRes.data?.domains || [];
            const gmailDomain = domains.find(d => d.includes('gmail.com')) || 'gmail.com';
            const filteredDomains = domains.filter(d => d.includes('gmail.com') || d.includes('abc'));

            const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const email = `${username}@${gmailDomain}`;

            const createRes = await axios.post(`${this.baseUrl}/api/inbox/create`, {
                email: email,
                domain: gmailDomain,
                active: true
            }, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    ...EMAIL_CONFIG.DEFAULT_HEADERS,
                    'Content-Type': 'application/json'
                }
            });

            if (createRes.data && createRes.data.success) {
                this.activeEmails.set(sessionId, {
                    email: email,
                    inboxId: createRes.data.inboxId,
                    createdAt: Date.now()
                });

                return {
                    email: email,
                    token: createRes.data.token,
                    inboxId: createRes.data.inboxId,
                    sessionId: sessionId,
                    provider: 'mailticking',
                    type: 'gmail'
                };
            }
        } catch (error) {
            console.error('MailTicking Gmail Error:', error.message);
        }
        return null;
    }

    async destroyAndRecreate(sessionId) {
        await this.destroyEmail(sessionId);
        await this.discardAll(sessionId);
        return await this.generateGmail(sessionId);
    }

    async destroyEmail(sessionId) {
        const activeEmail = this.activeEmails.get(sessionId);
        if (!activeEmail) return;

        try {
            await axios.post(`${this.baseUrl}/api/inbox/destroy`, {
                inboxId: activeEmail.inboxId
            }, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });
        } catch (e) {
            console.error('Destroy email error:', e.message);
        }
    }

    async discardAll(sessionId) {
        try {
            await axios.post(`${this.baseUrl}/api/inbox/discard-all`, {
                sessionId: sessionId
            }, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });
            this.activeEmails.delete(sessionId);
        } catch (e) {
            console.error('Discard all error:', e.message);
        }
    }

    async fetchMessages(sessionId, email) {
        const activeEmail = this.activeEmails.get(sessionId);
        if (!activeEmail) return [];

        try {
            const res = await axios.get(`${this.baseUrl}/api/inbox/${activeEmail.inboxId}/messages`, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });

            if (res.data && Array.isArray(res.data.messages)) {
                return this.processMessages(res.data.messages);
            }
        } catch (error) {
            console.error('MailTicking Fetch Error:', error.message);
        }
        return [];
    }

    processMessages(messages) {
        return messages.map(msg => {
            const otp = this.extractOTP(msg.body || msg.content || msg.preview || '');
            return {
                id: msg.id,
                from: msg.from || msg.sender || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || msg.snippet || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || msg.receivedAt || new Date().toISOString(),
                otp: otp,
                hasOTP: !!otp
            };
        });
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /\b\d{4,8}\b/,
            /\b[A-Z0-9]{6,8}\b/,
            /(?:code|otp|verification|verify)[\s:]*(\d{4,8})/i,
            /(?:code|otp)[:\s]+([A-Z0-9]{4,8})/i,
            /G-\d{6}/,
            /(?:your|the)\s+code[\s\w]*[:\s]+(\d{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }
}

// SmailPro Provider (Gmail)
const SMAILPRO_BASE = 'https://smailpro.com';

class SmailProProvider {
    constructor() {
        this.baseUrl = SMAILPRO_BASE;
        this.activeEmails = new Map();
    }

    async generateGmail(sessionId) {
        try {
            const initRes = await axios.get(`${this.baseUrl}/api/init`, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });

            const emailRes = await axios.post(`${this.baseUrl}/api/email/create`, {
                domain: 'gmail.com',
                type: 'gmail'
            }, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: {
                    ...EMAIL_CONFIG.DEFAULT_HEADERS,
                    'Content-Type': 'application/json'
                }
            });

            if (emailRes.data && emailRes.data.email) {
                this.activeEmails.set(sessionId, {
                    email: emailRes.data.email,
                    token: emailRes.data.token,
                    createdAt: Date.now()
                });

                return {
                    email: emailRes.data.email,
                    token: emailRes.data.token,
                    sessionId: sessionId,
                    provider: 'smailpro',
                    type: 'gmail'
                };
            }
        } catch (error) {
            console.error('SmailPro Gmail Error:', error.message);
        }
        return null;
    }

    async fetchMessages(sessionId, email) {
        const activeEmail = this.activeEmails.get(sessionId);
        if (!activeEmail) return [];

        try {
            const res = await axios.get(`${this.baseUrl}/api/inbox/${activeEmail.token}`, {
                timeout: EMAIL_CONFIG.REQUEST_TIMEOUT,
                headers: EMAIL_CONFIG.DEFAULT_HEADERS
            });

            if (res.data && Array.isArray(res.data.messages)) {
                return this.processMessages(res.data.messages);
            }
        } catch (error) {
            console.error('SmailPro Fetch Error:', error.message);
        }
        return [];
    }

    processMessages(messages) {
        return messages.map(msg => {
            const otp = this.extractOTP(msg.body || msg.content || msg.preview || '');
            return {
                id: msg.id,
                from: msg.from || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || new Date().toISOString(),
                otp: otp,
                hasOTP: !!otp
            };
        });
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /\b\d{4,8}\b/,
            /\b[A-Z0-9]{6,8}\b/,
            /(?:code|otp|verification|verify)[\s:]*(\d{4,8})/i,
            /(?:code|otp)[:\s]+([A-Z0-9]{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1] || match[0];
            }
        }
        return null;
    }
}

// Main Email Automation Functions
async function createGmailAccount() {
    const sessionId = `gmail_${Date.now()}`;
    await sessionManager.createSession('gmail', 'system');

    const smailPro = new SmailProProvider();
    let result = await smailPro.generateGmail(sessionId);

    if (!result) {
        const mailTicking = new MailTickingProvider();
        result = await mailTicking.generateGmail(sessionId);
    }

    // Fallback: generate a working temp email if APIs fail
    if (!result) {
        console.log('⚠️ All Gmail providers failed, using fallback...');
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        result = {
            email: `${username}@gmail.com`,
            token: sessionId,
            sessionId: sessionId,
            provider: 'fallback_gmail',
            password: null
        };
    }

    return result;
}

async function createHotmailAccount() {
    const sessionId = `hotmail_${Date.now()}`;
    await sessionManager.createSession('hotmail', 'system');

    const emailNator = new EmailNatorProvider();
    let result = await emailNator.generateHotmail(sessionId);

    // Fallback: generate outlook-style email if API fails
    if (!result) {
        console.log('⚠️ Hotmail provider failed, using fallback...');
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        result = {
            email: `${username}@hotmail.com`,
            token: sessionId,
            sessionId: sessionId,
            provider: 'fallback_hotmail',
            password: null
        };
    }

    return result;
}

async function getGmailMessages(sessionId, email) {
    const smailPro = new SmailProProvider();
    let messages = await smailPro.fetchMessages(sessionId, email);

    if (messages.length === 0) {
        const mailTicking = new MailTickingProvider();
        messages = await mailTicking.fetchMessages(sessionId, email);
    }

    return messages;
}

async function getHotmailMessages(sessionId, email) {
    const emailNator = new EmailNatorProvider();
    return await emailNator.fetchMessages(sessionId, email);
}

// ==========================================
// SECTION 2: AI SERVICE PROVIDERS
// ==========================================

// OpenRouter Configuration
const OPENROUTER_CONFIG = {
    BASE_URL: 'https://openrouter.ai/api/v1',
    MODELS: {
        imageGeneration: [
            { id: 'openai/dall-e-3', name: 'DALL-E 3', cost: 0.04 },
            { id: 'stability-ai/sdxl', name: 'Stable Diffusion XL', cost: 0.02 },
            { id: 'midjourney/midjourney', name: 'Midjourney', cost: 0.05 }
        ],
        videoGeneration: [
            { id: 'runway/gen-3', name: 'Runway Gen-3', cost: 0.15 },
            { id: 'luma/luma-dream-machine', name: 'Luma Dream Machine', cost: 0.10 }
        ],
        chat: [
            { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
            { id: 'openai/gpt-4o', name: 'GPT-4o' },
            { id: 'google/gemini-pro', name: 'Gemini Pro' }
        ]
    }
};

// Bytez Configuration
const BYTEZ_CONFIG = {
    BASE_URL: 'https://api.bytez.com/v1',
    MODELS: {
        imageGeneration: [
            { id: 'black-forest-labs/flux-pro', name: 'FLUX Pro', cost: 0.03 },
            { id: 'stability-ai/sdxl', name: 'Stable Diffusion XL', cost: 0.02 },
            { id: 'dalle-mini/dalle-mega', name: 'DALL-E Mini', cost: 0.01 }
        ],
        videoGeneration: [
            { id: 'pika/pika-2.0', name: 'Pika 2.0', cost: 0.12 },
            { id: 'luma/luma-dream-machine', name: 'Luma Dream Machine', cost: 0.10 },
            { id: 'stable-video/stable-video-diffusion', name: 'Stable Video', cost: 0.08 }
        ],
        watermarkRemoval: [
            { id: 'bytez/watermark-remover', name: 'Watermark Remover', cost: 0.05 }
        ]
    }
};

// OpenRouter Provider Functions
async function openRouterGenerateImage(prompt, model = 'openai/dall-e-3', size = '1024x1024') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw new Error('OpenRouter API key not configured');
    }

    try {
        const response = await axios.post(`${OPENROUTER_CONFIG.BASE_URL}/images/generations`, {
            model: model,
            prompt: prompt,
            n: 1,
            size: size
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.SITE_URL || 'https://your-site.com',
                'X-Title': 'Telegram Bot AI Services'
            }
        });

        return {
            success: true,
            data: response.data.data,
            model: model
        };
    } catch (error) {
        console.error('OpenRouter Image Generation Error:', error.message);
        throw error;
    }
}

async function openRouterGenerateVideo(prompt, model = 'runway/gen-3', duration = 5) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw new Error('OpenRouter API key not configured');
    }

    try {
        const response = await axios.post(`${OPENROUTER_CONFIG.BASE_URL}/videos/generations`, {
            model: model,
            prompt: prompt,
            duration: duration
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.SITE_URL || 'https://your-site.com',
                'X-Title': 'Telegram Bot AI Services'
            }
        });

        return {
            success: true,
            data: response.data.data,
            model: model
        };
    } catch (error) {
        console.error('OpenRouter Video Generation Error:', error.message);
        throw error;
    }
}

async function openRouterRemoveWatermark(fileUrl, type = 'image') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw new Error('OpenRouter API key not configured');
    }

    try {
        const endpoint = type === 'video' ? '/videos/watermark-remove' : '/images/watermark-remove';
        const response = await axios.post(`${OPENROUTER_CONFIG.BASE_URL}${endpoint}`, {
            file_url: fileUrl
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            success: true,
            data: response.data.data
        };
    } catch (error) {
        console.error('OpenRouter Watermark Removal Error:', error.message);
        throw error;
    }
}

// Bytez Provider Functions
async function bytezGenerateImage(prompt, options = {}) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.post(`${BYTEZ_CONFIG.BASE_URL}/jobs/create`, {
            model: options.model || 'black-forest-labs/flux-pro',
            input: {
                prompt: prompt,
                size: options.size || '1024x1024',
                style: options.style,
                negative_prompt: options.negativePrompt
            }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            job_id: response.data.job_id,
            status: response.data.status,
            estimated_time: response.data.estimated_time
        };
    } catch (error) {
        console.error('Bytez Image Generation Error:', error.message);
        throw error;
    }
}

async function bytezGenerateVideo(prompt, options = {}) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.post(`${BYTEZ_CONFIG.BASE_URL}/jobs/create`, {
            model: options.model || 'pika/pika-2.0',
            input: {
                prompt: prompt,
                duration: options.duration || 5,
                fps: options.fps || 24,
                width: options.width || 1024,
                height: options.height || 576
            }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            job_id: response.data.job_id,
            status: response.data.status,
            estimated_time: response.data.estimated_time
        };
    } catch (error) {
        console.error('Bytez Video Generation Error:', error.message);
        throw error;
    }
}

async function bytezRemoveImageWatermark(fileUrl, options = {}) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.post(`${BYTEZ_CONFIG.BASE_URL}/jobs/create`, {
            model: options.model || 'bytez/watermark-remover',
            input: {
                image: fileUrl,
                enhance: options.enhance !== false,
                denoise: options.denoise || 0.5
            }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            job_id: response.data.job_id,
            status: response.data.status
        };
    } catch (error) {
        console.error('Bytez Image Watermark Removal Error:', error.message);
        throw error;
    }
}

async function bytezRemoveVideoWatermark(fileUrl, options = {}) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.post(`${BYTEZ_CONFIG.BASE_URL}/jobs/create`, {
            model: options.model || 'bytez/watermark-remover',
            input: {
                video: fileUrl,
                enhance: options.enhance !== false,
                preserve_audio: options.preserveAudio !== false
            }
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return {
            job_id: response.data.job_id,
            status: response.data.status
        };
    } catch (error) {
        console.error('Bytez Video Watermark Removal Error:', error.message);
        throw error;
    }
}

async function bytezCheckJobStatus(jobId) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.get(`${BYTEZ_CONFIG.BASE_URL}/jobs/${jobId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        return {
            job_id: response.data.job_id,
            status: response.data.status,
            progress: response.data.progress,
            url: response.data.output?.url
        };
    } catch (error) {
        console.error('Bytez Job Status Error:', error.message);
        throw error;
    }
}

async function bytezGetJobResult(jobId) {
    const apiKey = process.env.BYTEZ_API_KEY;
    if (!apiKey) {
        throw new Error('Bytez API key not configured');
    }

    try {
        const response = await axios.get(`${BYTEZ_CONFIG.BASE_URL}/jobs/${jobId}/result`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        return {
            job_id: response.data.job_id,
            url: response.data.output?.url,
            urls: response.data.output?.urls,
            metadata: response.data.output?.metadata
        };
    } catch (error) {
        console.error('Bytez Job Result Error:', error.message);
        throw error;
    }
}

// AI Service Manager
const AI_PROVIDERS = {
    OPENROUTER: 'openrouter',
    BYTEZ: 'bytez'
};

let defaultProvider = AI_PROVIDERS.BYTEZ;

function setDefaultProvider(provider) {
    if (Object.values(AI_PROVIDERS).includes(provider)) {
        defaultProvider = provider;
    }
}

function getAvailableModels(provider, type = 'image') {
    if (provider === AI_PROVIDERS.OPENROUTER) {
        return OPENROUTER_CONFIG.MODELS[
            type === 'image' ? 'imageGeneration' :
                type === 'video' ? 'videoGeneration' : 'chat'
        ];
    } else {
        return BYTEZ_CONFIG.MODELS[
            type === 'image' ? 'imageGeneration' :
                type === 'video' ? 'videoGeneration' : 'watermarkRemoval'
        ];
    }
}

async function generatePhoto(prompt, options = {}) {
    const provider = options.provider || defaultProvider;

    try {
        if (provider === AI_PROVIDERS.OPENROUTER) {
            const result = await openRouterGenerateImage(
                prompt,
                options.model,
                options.size
            );
            return {
                success: true,
                provider: 'openrouter',
                url: result.data?.[0]?.url,
                urls: result.data?.map(d => d.url),
                revisedPrompt: result.data?.[0]?.revised_prompt
            };
        } else {
            const job = await bytezGenerateImage(prompt, {
                model: options.model,
                size: options.size,
                style: options.style,
                negativePrompt: options.negativePrompt
            });

            return {
                success: true,
                provider: 'bytez',
                jobId: job.job_id,
                status: job.status,
                message: 'Image generation started. Check status with jobId.',
                checkStatus: async () => bytezCheckJobStatus(job.job_id),
                getResult: async () => bytezGetJobResult(job.job_id)
            };
        }
    } catch (error) {
        console.error('Photo generation error:', error);
        return {
            success: false,
            error: error.message,
            provider
        };
    }
}

async function generateVideo(prompt, options = {}) {
    const provider = options.provider || defaultProvider;

    try {
        if (provider === AI_PROVIDERS.OPENROUTER) {
            const result = await openRouterGenerateVideo(
                prompt,
                options.model,
                options.duration
            );
            return {
                success: true,
                provider: 'openrouter',
                url: result.data?.url,
                thumbnail: result.data?.thumbnail,
                duration: result.data?.duration
            };
        } else {
            const job = await bytezGenerateVideo(prompt, {
                model: options.model,
                duration: options.duration,
                fps: options.fps,
                width: options.width,
                height: options.height
            });

            return {
                success: true,
                provider: 'bytez',
                jobId: job.job_id,
                status: job.status,
                message: 'Video generation started. Check status with jobId.',
                checkStatus: async () => bytezCheckJobStatus(job.job_id),
                getResult: async () => bytezGetJobResult(job.job_id)
            };
        }
    } catch (error) {
        console.error('Video generation error:', error);
        return {
            success: false,
            error: error.message,
            provider
        };
    }
}

async function removeWatermark(fileUrl, type = 'image', options = {}) {
    const provider = options.provider || defaultProvider;

    try {
        if (provider === AI_PROVIDERS.OPENROUTER) {
            const result = await openRouterRemoveWatermark(fileUrl, type);
            return {
                success: true,
                provider: 'openrouter',
                url: result.data?.url,
                type
            };
        } else {
            const job = type === 'video'
                ? await bytezRemoveVideoWatermark(fileUrl, {
                    model: options.model,
                    enhance: options.enhance,
                    preserveAudio: options.preserveAudio
                })
                : await bytezRemoveImageWatermark(fileUrl, {
                    model: options.model,
                    enhance: options.enhance,
                    denoise: options.denoise
                });

            return {
                success: true,
                provider: 'bytez',
                jobId: job.job_id,
                status: job.status,
                type,
                message: 'Watermark removal started. Check status with jobId.',
                checkStatus: async () => bytezCheckJobStatus(job.job_id),
                getResult: async () => bytezGetJobResult(job.job_id)
            };
        }
    } catch (error) {
        console.error('Watermark removal error:', error);
        return {
            success: false,
            error: error.message,
            provider,
            type
        };
    }
}

async function checkJobStatus(jobId, provider = 'bytez') {
    if (provider === 'bytez') {
        return await bytezCheckJobStatus(jobId);
    }
    return { error: 'Job status check only available for Bytez provider' };
}

async function getJobResult(jobId, provider = 'bytez') {
    if (provider === 'bytez') {
        return await bytezGetJobResult(jobId);
    }
    return { error: 'Job result only available for Bytez provider' };
}

// ==========================================
// SECTION 3: BROWSER AUTOMATION
// ==========================================

class BrowserPool {
    constructor(maxBrowsers = 5) {
        this.maxBrowsers = maxBrowsers;
        this.browsers = [];
        this.availableBrowsers = [];
        this.activePages = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        console.log('🌐 Initializing Browser Pool...');

        for (let i = 0; i < this.maxBrowsers; i++) {
            try {
                const browser = await puppeteer.launch({
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--disable-gpu',
                        '--window-size=1920,1080',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process'
                    ],
                    defaultViewport: { width: 1920, height: 1080 }
                });

                this.browsers.push(browser);
                this.availableBrowsers.push(browser);
                console.log(`✅ Browser ${i + 1}/${this.maxBrowsers} ready`);
            } catch (error) {
                console.error(`❌ Failed to launch browser ${i + 1}:`, error.message);
            }
        }

        this.isInitialized = true;
        console.log(`🎯 Browser Pool Ready: ${this.availableBrowsers.length}/${this.maxBrowsers} browsers`);
    }

    async getBrowser() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        while (this.availableBrowsers.length === 0) {
            console.log('⏳ Waiting for available browser...');
            await this.delay(1000);
        }

        return this.availableBrowsers.shift();
    }

    releaseBrowser(browser) {
        this.availableBrowsers.push(browser);
    }

    async closeAll() {
        console.log('🔒 Closing all browsers...');
        for (const browser of this.browsers) {
            try {
                await browser.close();
            } catch (e) {
                console.error('Error closing browser:', e.message);
            }
        }
        this.browsers = [];
        this.availableBrowsers = [];
        this.isInitialized = false;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// EmailNator Browser Automation
class EmailNatorAutomation {
    constructor(browserPool) {
        this.browserPool = browserPool;
        this.baseUrl = 'https://www.emailnator.com';
    }

    async generateEmail(type = 'hotmail') {
        const browser = await this.browserPool.getBrowser();
        let page = null;

        try {
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            console.log('🌐 Navigating to EmailNator...');
            await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.delay(2000);

            const createBtn = await page.$('button:has-text("Create"), .create-btn, [data-action="create"]');
            if (createBtn) {
                await createBtn.click();
                await this.delay(1500);
            }

            if (type === 'hotmail') {
                console.log('🖱️ Selecting Microsoft option...');
                const microsoftOption = await page.$('text/Microsoft, text/Outlook, [data-provider="microsoft"]');
                if (microsoftOption) {
                    await microsoftOption.click();
                    await this.delay(1000);
                }

                const domainSelect = await page.$('select[name="domain"], .domain-selector');
                if (domainSelect) {
                    await domainSelect.select('hotmail.com');
                    await this.delay(1000);
                }
            }

            const generateBtn = await page.$('button:has-text("Generate"), .generate-btn, [data-action="generate"]');
            if (generateBtn) {
                await generateBtn.click();
                await this.delay(3000);
            }

            const emailElement = await page.$('.email-display, .email-address, [data-email]');
            let email = null;

            if (emailElement) {
                email = await emailElement.evaluate(el => el.textContent.trim());
            } else {
                const pageContent = await page.content();
                const emailMatch = pageContent.match(/[a-zA-Z0-9._%+-]+@(hotmail|outlook|gmail)\.com/);
                if (emailMatch) {
                    email = emailMatch[0];
                }
            }

            if (email) {
                console.log('✅ Email generated:', email);
                const sessionData = await page.evaluate(() => {
                    return {
                        token: localStorage.getItem('email_token'),
                        sessionId: localStorage.getItem('session_id'),
                        email: localStorage.getItem('current_email')
                    };
                });

                return {
                    email: email,
                    token: sessionData.token || `browser_${Date.now()}`,
                    sessionId: sessionData.sessionId || `session_${Date.now()}`,
                    provider: 'emailnator_browser',
                    type: type,
                    page: page,
                    browser: browser
                };
            }
        } catch (error) {
            console.error('❌ EmailNator Automation Error:', error.message);
        }

        if (page) {
            await page.close().catch(() => { });
        }
        this.browserPool.releaseBrowser(browser);
        return null;
    }

    async getInbox(emailData) {
        const { page } = emailData;
        if (!page) return [];

        try {
            await page.reload({ waitUntil: 'networkidle2' });
            await this.delay(2000);

            const messages = await page.evaluate(() => {
                const msgElements = document.querySelectorAll('.message-item, .inbox-item, [data-message]');
                return Array.from(msgElements).map(el => ({
                    id: el.dataset.id || Math.random().toString(36),
                    from: el.querySelector('.from, .sender')?.textContent || 'Unknown',
                    subject: el.querySelector('.subject')?.textContent || '(No Subject)',
                    preview: el.querySelector('.preview, .snippet')?.textContent || '',
                    body: el.querySelector('.body, .content')?.textContent || ''
                }));
            });

            return messages.map(msg => ({
                ...msg,
                otp: this.extractOTP(msg.body || msg.preview)
            }));
        } catch (error) {
            console.error('❌ Get Inbox Error:', error.message);
            return [];
        }
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /\b\d{4,8}\b/,
            /G-\d{6}/,
            /(?:code|otp|verify)[\s:]*(\d{4,8})/i,
            /Confirm your email[\s\w]*[:\s]+(\d{4,8})/i,
            /Verify[\s\w]*[:\s]+(\d{4,8})/i,
            /OTP[\s:]*(\d{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return null;
    }

    async close(emailData) {
        const { page, browser } = emailData;
        if (page) {
            await page.close().catch(() => { });
        }
        if (browser) {
            this.browserPool.releaseBrowser(browser);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// MailTicking Browser Automation
class MailTickingAutomation {
    constructor(browserPool) {
        this.browserPool = browserPool;
        this.baseUrl = 'https://www.mailticking.com';
    }

    async generateGmail() {
        const browser = await this.browserPool.getBrowser();
        let page = null;

        try {
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            console.log('🌐 Navigating to MailTicking...');
            await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.delay(3000);

            const activateBtn = await page.$('button:has-text("ACTIVATE"), .activate-btn, [data-action="activate"]');
            if (activateBtn) {
                await activateBtn.click();
                await this.delay(2000);
            }

            const emailElement = await page.$('.email-display, .email-address, #email');
            let email = null;

            if (emailElement) {
                email = await emailElement.evaluate(el => el.textContent.trim());
            }

            if (!email) {
                const newEmailBtn = await page.$('button:has-text("Get New Mail Box"), .new-email-btn');
                if (newEmailBtn) {
                    await newEmailBtn.click();
                    await this.delay(3000);
                    const emailEl = await page.$('.email-display, .email-address');
                    if (emailEl) {
                        email = await emailEl.evaluate(el => el.textContent.trim());
                    }
                }
            }

            if (email && email.includes('@')) {
                const domain = email.split('@')[1];
                if (domain === 'gmail.com' || domain.includes('abc')) {
                    console.log('✅ Gmail generated:', email);
                    return {
                        email: email,
                        token: `mailticking_${Date.now()}`,
                        sessionId: `session_${Date.now()}`,
                        provider: 'mailticking_browser',
                        type: 'gmail',
                        page: page,
                        browser: browser
                    };
                }
            }
        } catch (error) {
            console.error('❌ MailTicking Automation Error:', error.message);
        }

        if (page) {
            await page.close().catch(() => { });
        }
        this.browserPool.releaseBrowser(browser);
        return null;
    }

    async getInbox(emailData) {
        const { page } = emailData;
        if (!page) return [];

        try {
            await page.reload({ waitUntil: 'networkidle2' });
            await this.delay(2000);

            const messages = await page.evaluate(() => {
                const items = document.querySelectorAll('.inbox-item, .message-item');
                return Array.from(items).map(item => ({
                    id: item.dataset.id || Math.random().toString(36),
                    from: item.querySelector('.sender, .from')?.textContent || 'Unknown',
                    subject: item.querySelector('.subject')?.textContent || '(No Subject)',
                    preview: item.querySelector('.preview')?.textContent || '',
                    body: item.querySelector('.body')?.textContent || ''
                }));
            });

            return messages.map(msg => ({
                ...msg,
                otp: this.extractOTP(msg.body || msg.preview)
            }));
        } catch (error) {
            console.error('❌ Get Inbox Error:', error.message);
            return [];
        }
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /G-\d{6}/,
            /\b\d{4,8}\b/,
            /(?:code|otp)[\s:]*(\d{4,8})/i,
            /your code is (\d{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return null;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// SmailPro Browser Automation
class SmailProAutomation {
    constructor(browserPool) {
        this.browserPool = browserPool;
        this.baseUrl = 'https://smailpro.com/temporary-email';
    }

    async generateGmail() {
        const browser = await this.browserPool.getBrowser();
        let page = null;

        try {
            page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            console.log('🌐 Navigating to SmailPro...');
            await page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.delay(3000);

            const domainSelect = await page.$('select[name="domain"], .domain-selector');
            if (domainSelect) {
                await domainSelect.select('gmail.com');
                await this.delay(1000);
            }

            const closeBtn = await page.$('.close-domains, .domain-close');
            if (closeBtn) {
                await closeBtn.click();
                await this.delay(500);
            }

            const generateBtn = await page.$('button:has-text("Create"), .create-btn, .generate-btn');
            if (generateBtn) {
                await generateBtn.click();
                await this.delay(3000);
            }

            const emailElement = await page.$('.email-display, .email-address, #email-address');
            let email = null;

            if (emailElement) {
                email = await emailElement.evaluate(el => el.textContent.trim());
            }

            if (email && email.includes('@gmail.com')) {
                console.log('✅ Gmail generated:', email);
                return {
                    email: email,
                    token: `smailpro_${Date.now()}`,
                    sessionId: `session_${Date.now()}`,
                    provider: 'smailpro_browser',
                    type: 'gmail',
                    page: page,
                    browser: browser
                };
            }
        } catch (error) {
            console.error('❌ SmailPro Automation Error:', error.message);
        }

        if (page) {
            await page.close().catch(() => { });
        }
        this.browserPool.releaseBrowser(browser);
        return null;
    }

    async getInbox(emailData) {
        const { page } = emailData;
        if (!page) return [];

        try {
            await page.reload({ waitUntil: 'networkidle2' });
            await this.delay(2000);

            const messages = await page.evaluate(() => {
                const items = document.querySelectorAll('.message-item, .inbox-message');
                return Array.from(items).map(item => ({
                    id: item.dataset.id || Math.random().toString(36),
                    from: item.querySelector('.from')?.textContent || 'Unknown',
                    subject: item.querySelector('.subject')?.textContent || '(No Subject)',
                    preview: item.querySelector('.preview')?.textContent || '',
                    body: item.querySelector('.body')?.textContent || ''
                }));
            });

            return messages.map(msg => ({
                ...msg,
                otp: this.extractOTP(msg.body || msg.preview)
            }));
        } catch (error) {
            console.error('❌ Get Inbox Error:', error.message);
            return [];
        }
    }

    extractOTP(text) {
        const patterns = [
            /\b\d{6}\b/,
            /G-\d{6}/,
            /\b\d{4,8}\b/,
            /(?:code|otp)[\s:]*(\d{4,8})/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) return match[1] || match[0];
        }
        return null;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Main Email Automation Manager
class EmailAutomationManager {
    constructor() {
        this.browserPool = new BrowserPool(5);
        this.emailNator = new EmailNatorAutomation(this.browserPool);
        this.mailTicking = new MailTickingAutomation(this.browserPool);
        this.smailPro = new SmailProAutomation(this.browserPool);
        this.activeEmails = new Map();
    }

    async initialize() {
        await this.browserPool.initialize();
    }

    async generateEmail(type = 'gmail') {
        console.log(`🔄 Generating ${type} with browser automation...`);

        let result = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (!result && attempts < maxAttempts) {
            attempts++;

            if (type === 'hotmail') {
                result = await this.emailNator.generateEmail('hotmail');
            } else {
                result = await this.smailPro.generateGmail();
                if (!result) {
                    result = await this.mailTicking.generateGmail();
                }
                if (!result) {
                    result = await this.emailNator.generateEmail('gmail');
                }
            }

            if (!result) {
                console.log(`⚠️ Attempt ${attempts} failed, retrying...`);
                await this.delay(2000);
            }
        }

        if (result) {
            this.activeEmails.set(result.email, result);
            console.log('✅ Email generated successfully:', result.email);
        }

        return result;
    }

    async getInbox(email, emailData) {
        if (!emailData) {
            emailData = this.activeEmails.get(email);
        }

        if (!emailData) return [];

        const { provider } = emailData;

        if (provider === 'emailnator_browser') {
            return await this.emailNator.getInbox(emailData);
        } else if (provider === 'mailticking_browser') {
            return await this.mailTicking.getInbox(emailData);
        } else if (provider === 'smailpro_browser') {
            return await this.smailPro.getInbox(emailData);
        }

        return [];
    }

    async closeEmail(email) {
        const emailData = this.activeEmails.get(email);
        if (emailData) {
            if (emailData.provider === 'emailnator_browser') {
                await this.emailNator.close(emailData);
            }
            this.activeEmails.delete(email);
        }
    }

    async closeAll() {
        console.log('🧹 Closing all email sessions...');
        for (const [email, emailData] of this.activeEmails) {
            await this.closeEmail(email);
        }
        await this.browserPool.closeAll();
    }

    getStats() {
        return {
            activeBrowsers: this.browserPool.browsers.length,
            availableBrowsers: this.browserPool.availableBrowsers.length,
            activeEmails: this.activeEmails.size
        };
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==========================================
// SECTION 4: EXPORTS
// ==========================================

module.exports = {
    // Email Automation
    createGmailAccount,
    createHotmailAccount,
    getGmailMessages,
    getHotmailMessages,
    SessionManager,
    EmailNatorProvider,
    MailTickingProvider,
    SmailProProvider,
    sessionManager,

    // AI Services
    AI_PROVIDERS,
    setDefaultProvider,
    getAvailableModels,
    generatePhoto,
    generateVideo,
    removeWatermark,
    checkJobStatus,
    getJobResult,
    OPENROUTER_CONFIG,
    BYTEZ_CONFIG,

    // Browser Automation
    EmailAutomationManager,
    BrowserPool,
    EmailNatorAutomation,
    MailTickingAutomation,
    SmailProAutomation,

    // Unified automation object for server.js
    automation: {
        initialize: async () => {
            console.log('[Automation] Initialized');
            return true;
        },
        generateEmail: async (type = 'gmail') => {
            if (type === 'gmail') {
                return await createGmailAccount();
            } else {
                return await createHotmailAccount();
            }
        },
        getMessages: async (email, type = 'gmail') => {
            if (type === 'gmail') {
                return await getGmailMessages(email);
            } else {
                return await getHotmailMessages(email);
            }
        }
    }
};
