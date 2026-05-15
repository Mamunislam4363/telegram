const axios = require('axios');
const cheerio = require('cheerio');

/**
 * UNIFIED PROVIDERS
 * Combines: Gmail Providers + Bytez Provider + OpenRouter Provider
 * 
 * Sections:
 * 1. Email Providers (Gmail, Hotmail, Student)
 * 2. Bytez AI Provider (Image/Video/Watermark)
 * 3. OpenRouter AI Provider (Image/Video/Chat)
 */

// ==========================================
// SECTION 1: EMAIL PROVIDERS (from gmail-providers.js)
// ==========================================

// EMAILNATOR PROVIDER
const EMAILNATOR_BASE = 'https://www.emailnator.com';

async function tryEmailNator() {
    try {
        const sessionRes = await axios.get(EMAILNATOR_BASE, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@gmail.com`;

        const createRes = await axios.post(`${EMAILNATOR_BASE}/api/generate`, {
            email: email,
            type: 'gmail'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.sessionId || email,
                provider: 'emailnator',
                password: null
            };
        }
    } catch (e) {
        console.error('EmailNator Error:', e.message);
    }
    return null;
}

async function fetchEmailNatorMessages(sessionId, email) {
    try {
        const res = await axios.post(`${EMAILNATOR_BASE}/api/inbox`, {
            email: email,
            token: sessionId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 15000
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || '',
                body: msg.body || msg.preview || '',
                date: msg.date || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('EmailNator Fetch Error:', e.message);
    }
    return [];
}

// MAILTICKING PROVIDER
const MAILTICKING_BASE = 'https://www.mailticking.com';

async function tryMailTicking() {
    try {
        const domainsRes = await axios.get(`${MAILTICKING_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['mailticking.com', 'tempmail.com'];
        const gmailDomains = domains.filter(d => d.includes('gmail') || d.includes('google'));
        const domain = gmailDomains.length > 0 ? gmailDomains[0] : domains[0];

        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        const createRes = await axios.post(`${MAILTICKING_BASE}/api/inbox/create`, {
            email: email
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.inboxId || email,
                provider: 'mailticking',
                password: null
            };
        }
    } catch (e) {
        console.error('MailTicking Error:', e.message);
    }
    return null;
}

async function fetchMailTickingMessages(sessionId, email) {
    try {
        const res = await axios.get(`${MAILTICKING_BASE}/api/inbox/${sessionId}/messages`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || msg.sender || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || msg.snippet || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || msg.receivedAt || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('MailTicking Fetch Error:', e.message);
    }
    return [];
}

// SMAILPRO PROVIDER
const SMAILPRO_BASE = 'https://smailpro.com';

async function trySmailPro() {
    try {
        const sessionRes = await axios.get(`${SMAILPRO_BASE}/api/session`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': `${SMAILPRO_BASE}/temporary-email`
            }
        });

        const session = sessionRes.data?.session;
        if (!session) return null;

        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@gmail.com`;

        const createRes = await axios.post(`${SMAILPRO_BASE}/api/email/create`, {
            email: email,
            session: session,
            type: 'gmail'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${SMAILPRO_BASE}/temporary-email`
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: session,
                sessionId: createRes.data.emailId || email,
                provider: 'smailpro',
                password: null
            };
        }
    } catch (e) {
        console.error('SmailPro Error:', e.message);
    }
    return null;
}

async function fetchSmailProMessages(sessionId, email) {
    try {
        const res = await axios.post(`${SMAILPRO_BASE}/api/email/inbox`, {
            email: email,
            emailId: sessionId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 15000
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || msg.sender || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || msg.snippet || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || msg.receivedAt || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('SmailPro Fetch Error:', e.message);
    }
    return [];
}

// FALLBACK DOMAINS
const GMAIL_FALLBACK_DOMAINS = [
    'tempgmail.com', 'gmailtemp.com', 'tempmailgmail.com', 'gmailgen.com',
    'fakegmail.com', 'tempmail.org', 'temp-mail.org', 'tempmailaddress.com',
    'throwawaymail.com', 'tempmail.ninja', 'burnermail.io', 'tempinbox.com',
    'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'spam4.me'
];

async function tryFallbackGmail() {
    const domain = GMAIL_FALLBACK_DOMAINS[Math.floor(Math.random() * GMAIL_FALLBACK_DOMAINS.length)];
    const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
    return {
        email: `${username}@${domain}`,
        token: `${username}@${domain}`,
        sessionId: `${username}@${domain}`,
        provider: 'fallback',
        password: null,
        isFallback: true
    };
}

// MAIN GMAIL GENERATOR
async function createGmailAccount() {
    console.log('🔄 Starting Gmail Generation Chain...');

    let account = await tryEmailNator();
    if (account) {
        console.log('✅ EmailNator provided Gmail:', account.email);
        return account;
    }

    console.log('🔄 Trying MailTicking...');
    account = await tryMailTicking();
    if (account) {
        console.log('✅ MailTicking provided email:', account.email);
        return account;
    }

    console.log('🔄 Trying SmailPro...');
    account = await trySmailPro();
    if (account) {
        console.log('✅ SmailPro provided Gmail:', account.email);
        return account;
    }

    console.log('🔄 Using fallback provider...');
    account = await tryFallbackGmail();
    if (account) {
        console.log('✅ Fallback provided email:', account.email);
        return account;
    }

    console.error('❌ All Gmail providers failed');
    return null;
}

// MESSAGE FETCHER
async function getGmailMessages(sessionId, email, provider) {
    if (!email || !sessionId) return [];

    switch (provider) {
        case 'emailnator':
            return await fetchEmailNatorMessages(sessionId, email);
        case 'mailticking':
            return await fetchMailTickingMessages(sessionId, email);
        case 'smailpro':
            return await fetchSmailProMessages(sessionId, email);
        default:
            let messages = await fetchEmailNatorMessages(sessionId, email);
            if (messages.length > 0) return messages;
            messages = await fetchMailTickingMessages(sessionId, email);
            if (messages.length > 0) return messages;
            messages = await fetchSmailProMessages(sessionId, email);
            if (messages.length > 0) return messages;
            return [];
    }
}

// HOTMAIL PROVIDER
const HOTMAIL_FALLBACK_DOMAINS = [
    'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'passport.com'
];

async function createHotmailAccount() {
    console.log('🔄 Starting Hotmail Generation Chain...');

    try {
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@outlook.com`;

        const createRes = await axios.post(`${EMAILNATOR_BASE}/api/generate`, {
            email: email,
            type: 'hotmail'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.sessionId || email,
                provider: 'emailnator_hotmail',
                password: null
            };
        }
    } catch (e) {
        console.error('EmailNator Hotmail Error:', e.message);
    }

    const domain = 'outlook.com';
    const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
    return {
        email: `${username}@${domain}`,
        token: `${username}@${domain}`,
        sessionId: `${username}@${domain}`,
        provider: 'fallback_hotmail',
        password: null,
        isFallback: true
    };
}

// STUDENT EMAIL PROVIDERS
const ETEMPMAIL_BASE = 'https://etempmail.com';
const NULLSTO_BASE = 'https://nullsto.edu.pl';
const POSTINBOX_BASE = 'https://postinbox.org';

async function tryETempMail() {
    try {
        const domainsRes = await axios.get(`${ETEMPMAIL_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['etempmail.com', 'tempmail.edu'];
        const eduDomains = domains.filter(d => d.includes('edu') || d.includes('student'));
        const domain = eduDomains.length > 0 ? eduDomains[0] : domains[0];

        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        const createRes = await axios.post(`${ETEMPMAIL_BASE}/api/inbox/create`, {
            email: email,
            type: 'student'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.inboxId || email,
                provider: 'etempmail',
                password: null
            };
        }
    } catch (e) {
        console.error('eTempMail Error:', e.message);
    }
    return null;
}

async function fetchETempMailMessages(sessionId, email) {
    try {
        const res = await axios.get(`${ETEMPMAIL_BASE}/api/inbox/${sessionId}/messages`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || msg.sender || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || msg.snippet || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || msg.receivedAt || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('eTempMail Fetch Error:', e.message);
    }
    return [];
}

async function tryNullsto() {
    try {
        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const domain = 'nullsto.edu.pl';
        const email = `${username}@${domain}`;

        const createRes = await axios.post(`${NULLSTO_BASE}/api/email/create`, {
            email: email,
            type: 'edu'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.sessionId || email,
                provider: 'nullsto',
                password: null
            };
        }
    } catch (e) {
        console.error('Nullsto Error:', e.message);
    }
    return null;
}

async function fetchNullstoMessages(sessionId, email) {
    try {
        const res = await axios.post(`${NULLSTO_BASE}/api/email/inbox`, {
            email: email,
            token: sessionId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 15000
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || '',
                body: msg.body || msg.preview || '',
                date: msg.date || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('Nullsto Fetch Error:', e.message);
    }
    return [];
}

async function tryPostInbox() {
    try {
        const domainsRes = await axios.get(`${POSTINBOX_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['postinbox.org', 'tempinbox.org'];
        const eduDomains = domains.filter(d => d.includes('edu') || d.includes('student'));
        const domain = eduDomains.length > 0 ? eduDomains[0] : domains[0];

        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        const createRes = await axios.post(`${POSTINBOX_BASE}/api/inbox/create`, {
            email: email
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (createRes.data && createRes.data.success) {
            return {
                email: email,
                token: createRes.data.token || email,
                sessionId: createRes.data.inboxId || email,
                provider: 'postinbox',
                password: null
            };
        }
    } catch (e) {
        console.error('PostInbox Error:', e.message);
    }
    return null;
}

async function fetchPostInboxMessages(sessionId, email) {
    try {
        const res = await axios.get(`${POSTINBOX_BASE}/api/inbox/${sessionId}/messages`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (res.data && Array.isArray(res.data.messages)) {
            return res.data.messages.map(msg => ({
                id: msg.id,
                from: msg.from || msg.sender || 'Unknown',
                subject: msg.subject || '(No Subject)',
                preview: msg.preview || msg.snippet || '',
                body: msg.body || msg.content || msg.preview || '',
                date: msg.date || msg.receivedAt || new Date().toISOString()
            }));
        }
    } catch (e) {
        console.error('PostInbox Fetch Error:', e.message);
    }
    return [];
}

const STUDENT_DOMAINS = [
    'edu.pl', 'edu.temp', 'student.edu', 'edu.mail',
    'campus.edu', 'uni.edu', 'college.edu', 'school.edu'
];

async function createStudentEmailAccount() {
    console.log('🔄 Starting Student Email Generation Chain...');

    let account = await tryETempMail();
    if (account) {
        console.log('✅ eTempMail provided student email:', account.email);
        return account;
    }

    console.log('🔄 Trying Nullsto.edu.pl...');
    account = await tryNullsto();
    if (account) {
        console.log('✅ Nullsto provided student email:', account.email);
        return account;
    }

    console.log('🔄 Trying PostInbox.org...');
    account = await tryPostInbox();
    if (account) {
        console.log('✅ PostInbox provided student email:', account.email);
        return account;
    }

    console.log('🔄 Using fallback student provider...');
    const domain = STUDENT_DOMAINS[Math.floor(Math.random() * STUDENT_DOMAINS.length)];
    const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
    return {
        email: `${username}@${domain}`,
        token: `${username}@${domain}`,
        sessionId: `${username}@${domain}`,
        provider: 'fallback_student',
        password: null,
        isFallback: true
    };
}

async function getStudentEmailMessages(sessionId, email, provider) {
    if (!email || !sessionId) return [];

    switch (provider) {
        case 'etempmail':
            return await fetchETempMailMessages(sessionId, email);
        case 'nullsto':
            return await fetchNullstoMessages(sessionId, email);
        case 'postinbox':
            return await fetchPostInboxMessages(sessionId, email);
        default:
            let messages = await fetchETempMailMessages(sessionId, email);
            if (messages.length > 0) return messages;
            messages = await fetchNullstoMessages(sessionId, email);
            if (messages.length > 0) return messages;
            messages = await fetchPostInboxMessages(sessionId, email);
            if (messages.length > 0) return messages;
            return [];
    }
}

// ==========================================
// SECTION 2: BYTEZ AI PROVIDER
// ==========================================

const BYTEZ_CONFIG = {
    baseUrl: 'https://api.bytez.com/v1',
    apiKey: process.env.BYTEZ_API_KEY || '',
    
    endpoints: {
        imageGenerate: '/images/generate',
        videoGenerate: '/videos/generate',
        watermarkRemove: '/watermark/remove',
        imageEdit: '/images/edit',
        videoEdit: '/videos/edit',
        status: '/jobs/status',
        result: '/jobs/result'
    },
    
    models: {
        imageGeneration: [
            { id: 'flux-pro', name: 'FLUX Pro', description: 'High-quality image generation' },
            { id: 'stable-diffusion-xl', name: 'Stable Diffusion XL', description: 'Versatile image model' },
            { id: 'midjourney-v6', name: 'Midjourney V6', description: 'Artistic style images' },
            { id: 'dalle-3', name: 'DALL-E 3', description: 'OpenAI image model' },
        ],
        videoGeneration: [
            { id: 'svd-xt', name: 'Stable Video Diffusion XT', description: 'High-quality video generation' },
            { id: 'pika-2.0', name: 'Pika 2.0', description: 'Cinematic video generation' },
            { id: 'runway-gen3', name: 'Runway Gen-3', description: 'Professional video creation' },
        ],
        watermarkRemoval: [
            { id: 'watermark-remover-v2', name: 'Watermark Remover V2', description: 'Advanced watermark detection' },
            { id: 'inpainting-pro', name: 'Inpainting Pro', description: 'Smart object removal' },
        ]
    },
    
    defaults: {
        imageModel: 'flux-pro',
        videoModel: 'svd-xt',
        watermarkModel: 'watermark-remover-v2'
    }
};

async function generateBytezImage(prompt, options = {}) {
    const model = options.model || BYTEZ_CONFIG.defaults.imageModel;
    const size = options.size || '1024x1024';
    const style = options.style || 'photorealistic';
    
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.imageGenerate}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            size: size,
            style: style,
            negative_prompt: options.negativePrompt || 'low quality, blurry, distorted',
            num_images: options.numImages || 1,
            seed: options.seed || Math.floor(Math.random() * 1000000)
        })
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

async function generateBytezVideo(prompt, options = {}) {
    const model = options.model || BYTEZ_CONFIG.defaults.videoModel;
    const duration = options.duration || 5;
    const fps = options.fps || 24;
    
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.videoGenerate}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            duration: duration,
            fps: fps,
            width: options.width || 1024,
            height: options.height || 576,
            motion_bucket_id: options.motion || 127,
            seed: options.seed || Math.floor(Math.random() * 1000000)
        })
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

async function removeBytezImageWatermark(imageUrl, options = {}) {
    const model = options.model || BYTEZ_CONFIG.defaults.watermarkModel;
    
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.watermarkRemove}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            image_url: imageUrl,
            type: 'image',
            remove_all_watermarks: true,
            enhance_quality: options.enhance !== false,
            denoise: options.denoise || 0.5
        })
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

async function removeBytezVideoWatermark(videoUrl, options = {}) {
    const model = options.model || BYTEZ_CONFIG.defaults.watermarkModel;
    
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.watermarkRemove}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            video_url: videoUrl,
            type: 'video',
            remove_all_watermarks: true,
            enhance_quality: options.enhance !== false,
            preserve_audio: options.preserveAudio !== false
        })
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

async function checkBytezJobStatus(jobId) {
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.status}/${jobId}`, {
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

async function getBytezJobResult(jobId) {
    const response = await fetch(`${BYTEZ_CONFIG.baseUrl}${BYTEZ_CONFIG.endpoints.result}/${jobId}`, {
        headers: {
            'Authorization': `Bearer ${BYTEZ_CONFIG.apiKey}`
        }
    });
    
    if (!response.ok) {
        throw new Error(`Bytez API error: ${response.status}`);
    }
    
    return await response.json();
}

// ==========================================
// SECTION 3: OPENROUTER AI PROVIDER
// ==========================================

const OPENROUTER_CONFIG = {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY || '',
    
    models: {
        imageGeneration: [
            { id: 'openai/dall-e-3', name: 'DALL-E 3', provider: 'OpenAI' },
            { id: 'stability-ai/stable-diffusion-xl', name: 'Stable Diffusion XL', provider: 'Stability AI' },
            { id: 'midjourney/midjourney', name: 'Midjourney', provider: 'Midjourney' },
            { id: 'recraft-ai/recraft-v3', name: 'Recraft V3', provider: 'Recraft' },
        ],
        videoGeneration: [
            { id: 'runway/gen-3', name: 'Runway Gen-3', provider: 'Runway' },
            { id: 'luma/luma-dream-machine', name: 'Luma Dream Machine', provider: 'Luma' },
            { id: 'pika/pika-labs', name: 'Pika Labs', provider: 'Pika' },
            { id: 'kling/kling-ai', name: 'Kling AI', provider: 'Kling' },
        ],
        chat: [
            { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
            { id: 'google/gemini-pro', name: 'Gemini Pro', provider: 'Google' },
            { id: 'meta-llama/llama-3.1-70b', name: 'Llama 3.1 70B', provider: 'Meta' },
        ]
    },
    
    defaults: {
        image: 'openai/dall-e-3',
        video: 'runway/gen-3',
        chat: 'openai/gpt-4o'
    }
};

async function generateOpenRouterImage(prompt, model = OPENROUTER_CONFIG.defaults.image, size = '1024x1024') {
    const response = await fetch(`${OPENROUTER_CONFIG.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'https://your-app.com',
            'X-Title': 'Telegram Bot'
        },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            n: 1,
            size: size,
            response_format: 'url'
        })
    });
    
    if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
    }
    
    return await response.json();
}

async function generateOpenRouterVideo(prompt, model = OPENROUTER_CONFIG.defaults.video, duration = 5) {
    const response = await fetch(`${OPENROUTER_CONFIG.baseUrl}/videos/generations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'https://your-app.com',
            'X-Title': 'Telegram Bot'
        },
        body: JSON.stringify({
            model: model,
            prompt: prompt,
            duration: duration,
            response_format: 'url'
        })
    });
    
    if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
    }
    
    return await response.json();
}

async function removeOpenRouterWatermark(fileUrl, type = 'image') {
    const model = type === 'video' 
        ? 'runway/gen-3'
        : 'stability-ai/stable-diffusion-xl';
    
    const response = await fetch(`${OPENROUTER_CONFIG.baseUrl}/images/edits`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_CONFIG.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'https://your-app.com',
            'X-Title': 'Telegram Bot'
        },
        body: JSON.stringify({
            model: model,
            image: fileUrl,
            prompt: 'Remove watermark, clean image, restore original quality, professional cleanup',
            response_format: 'url'
        })
    });
    
    if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status}`);
    }
    
    return await response.json();
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    // Email Providers
    createGmailAccount,
    createHotmailAccount,
    createStudentEmailAccount,
    getGmailMessages,
    getStudentEmailMessages,
    tryEmailNator,
    tryMailTicking,
    trySmailPro,
    tryETempMail,
    tryNullsto,
    tryPostInbox,
    fetchEmailNatorMessages,
    fetchMailTickingMessages,
    fetchSmailProMessages,
    fetchETempMailMessages,
    fetchNullstoMessages,
    fetchPostInboxMessages,
    
    // Bytez AI
    BYTEZ_CONFIG,
    generateBytezImage,
    generateBytezVideo,
    removeBytezImageWatermark,
    removeBytezVideoWatermark,
    checkBytezJobStatus,
    getBytezJobResult,
    
    // OpenRouter AI
    OPENROUTER_CONFIG,
    generateOpenRouterImage,
    generateOpenRouterVideo,
    removeOpenRouterWatermark
};
