const axios = require('axios');
const cheerio = require('cheerio');

/**
 * GMAIL PROVIDER INTEGRATION
 * Premium Gmail providers: EmailNator, MailTicking, SmailPro
 */

// ==========================================
// EMAILNATOR PROVIDER
// ==========================================

const EMAILNATOR_BASE = 'https://www.emailnator.com';

async function tryEmailNator() {
    try {
        // Get session/cookies first
        const sessionRes = await axios.get(EMAILNATOR_BASE, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Generate Gmail address
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@gmail.com`;

        // Create session on EmailNator
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

// ==========================================
// MAILTICKING PROVIDER
// ==========================================

const MAILTICKING_BASE = 'https://www.mailticking.com';

async function tryMailTicking() {
    try {
        // Get available domains
        const domainsRes = await axios.get(`${MAILTICKING_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['mailticking.com', 'tempmail.com'];
        const gmailDomains = domains.filter(d => d.includes('gmail') || d.includes('google'));
        const domain = gmailDomains.length > 0 ? gmailDomains[0] : domains[0];

        // Generate email
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        // Create inbox
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

// ==========================================
// SMAILPRO PROVIDER
// ==========================================

const SMAILPRO_BASE = 'https://smailpro.com';

async function trySmailPro() {
    try {
        // Get session
        const sessionRes = await axios.get(`${SMAILPRO_BASE}/api/session`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': `${SMAILPRO_BASE}/temporary-email`
            }
        });

        const session = sessionRes.data?.session;
        if (!session) return null;

        // Generate Gmail
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@gmail.com`;

        // Create email
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

// ==========================================
// FALLBACK PROVIDERS (Generic Gmail-like)
// ==========================================

// If premium providers fail, use these fallback domains
const GMAIL_FALLBACK_DOMAINS = [
    'tempgmail.com',
    'gmailtemp.com',
    'tempmailgmail.com',
    'gmailgen.com',
    'fakegmail.com',
    'tempmail.org',
    'temp-mail.org',
    'tempmailaddress.com',
    'throwawaymail.com',
    'tempmail.ninja',
    'burnermail.io',
    'tempinbox.com',
    'mailinator.com',
    'guerrillamail.com',
    'sharklasers.com',
    'spam4.me'
];

async function tryFallbackGmail() {
    try {
        const domain = GMAIL_FALLBACK_DOMAINS[Math.floor(Math.random() * GMAIL_FALLBACK_DOMAINS.length)];
        const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        return {
            email: email,
            token: email,
            sessionId: email,
            provider: 'fallback_gmail',
            password: null,
            isFallback: true
        };
    } catch (e) {
        console.error('Fallback Gmail Error:', e.message);
    }
    return null;
}

// ==========================================
// MAIN GENERATOR - For Gmail specifically
// ==========================================

async function createGmailAccount() {
    console.log('🔄 Starting Gmail Generation Chain...');

    // Try EmailNator first (most reliable for Gmail)
    let account = await tryEmailNator();
    if (account) {
        console.log('✅ EmailNator provided Gmail:', account.email);
        return account;
    }

    // Try MailTicking
    console.log('🔄 Trying MailTicking...');
    account = await tryMailTicking();
    if (account) {
        console.log('✅ MailTicking provided email:', account.email);
        return account;
    }

    // Try SmailPro
    console.log('🔄 Trying SmailPro...');
    account = await trySmailPro();
    if (account) {
        console.log('✅ SmailPro provided Gmail:', account.email);
        return account;
    }

    // Fallback to generic temp mail
    console.log('🔄 Using fallback provider...');
    account = await tryFallbackGmail();
    if (account) {
        console.log('✅ Fallback provided email:', account.email);
        return account;
    }

    console.error('❌ All Gmail providers failed');
    return null;
}

// ==========================================
// MESSAGE FETCHER - For Gmail providers
// ==========================================

async function getGmailMessages(sessionId, email, provider) {
    if (!email || !sessionId) return [];

    // Route to correct provider
    switch (provider) {
        case 'emailnator':
            return await fetchEmailNatorMessages(sessionId, email);
        case 'mailticking':
            return await fetchMailTickingMessages(sessionId, email);
        case 'smailpro':
            return await fetchSmailProMessages(sessionId, email);
        default:
            // Try all providers
            let messages = await fetchEmailNatorMessages(sessionId, email);
            if (messages.length > 0) return messages;

            messages = await fetchMailTickingMessages(sessionId, email);
            if (messages.length > 0) return messages;

            messages = await fetchSmailProMessages(sessionId, email);
            if (messages.length > 0) return messages;

            return [];
    }
}

// ==========================================
// HOTMAIL PROVIDER (using similar approach)
// ==========================================

const HOTMAIL_FALLBACK_DOMAINS = [
    'hotmail.com',
    'outlook.com',
    'live.com',
    'msn.com',
    'passport.com'
];

async function createHotmailAccount() {
    console.log('🔄 Starting Hotmail Generation Chain...');

    // Try EmailNator with hotmail type
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

    // Fallback to Outlook domain
    const domain = 'outlook.com';
    const username = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `${username}@${domain}`;

    return {
        email: email,
        token: email,
        sessionId: email,
        provider: 'fallback_hotmail',
        password: null,
        isFallback: true
    };
}

// ==========================================
// STUDENT EMAIL PROVIDERS
// ==========================================

// LEVEL 1: eTempMail (https://etempmail.com/)
const ETEMPMAIL_BASE = 'https://etempmail.com';

async function tryETempMail() {
    try {
        // Get available domains
        const domainsRes = await axios.get(`${ETEMPMAIL_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['etempmail.com', 'tempmail.edu'];
        const eduDomains = domains.filter(d => d.includes('edu') || d.includes('student'));
        const domain = eduDomains.length > 0 ? eduDomains[0] : domains[0];

        // Generate student email
        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        // Create inbox
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

// LEVEL 2: Nullsto.edu.pl (https://nullsto.edu.pl/)
const NULLSTO_BASE = 'https://nullsto.edu.pl';

async function tryNullsto() {
    try {
        // This is a Polish student email service
        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const domain = 'nullsto.edu.pl';
        const email = `${username}@${domain}`;

        // Create session
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

// LEVEL 3: PostInbox.org (https://postinbox.org/)
const POSTINBOX_BASE = 'https://postinbox.org';

async function tryPostInbox() {
    try {
        // Get available domains
        const domainsRes = await axios.get(`${POSTINBOX_BASE}/api/domains`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const domains = domainsRes.data?.domains || ['postinbox.org', 'tempinbox.org'];
        const eduDomains = domains.filter(d => d.includes('edu') || d.includes('student'));
        const domain = eduDomains.length > 0 ? eduDomains[0] : domains[0];

        // Generate student email
        const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const email = `${username}@${domain}`;

        // Create inbox
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

// ==========================================
// FALLBACK STUDENT DOMAINS
// ==========================================

const STUDENT_DOMAINS = [
    'edu.pl',
    'edu.temp',
    'student.edu',
    'edu.mail',
    'campus.edu',
    'uni.edu',
    'college.edu',
    'school.edu'
];

// ==========================================
// MAIN STUDENT EMAIL GENERATOR
// ==========================================

async function createStudentEmailAccount() {
    console.log('🔄 Starting Student Email Generation Chain...');

    // Try eTempMail first
    let account = await tryETempMail();
    if (account) {
        console.log('✅ eTempMail provided student email:', account.email);
        return account;
    }

    // Try Nullsto.edu.pl
    console.log('🔄 Trying Nullsto.edu.pl...');
    account = await tryNullsto();
    if (account) {
        console.log('✅ Nullsto provided student email:', account.email);
        return account;
    }

    // Try PostInbox.org
    console.log('🔄 Trying PostInbox.org...');
    account = await tryPostInbox();
    if (account) {
        console.log('✅ PostInbox provided student email:', account.email);
        return account;
    }

    // Fallback to generic student domain
    console.log('🔄 Using fallback student provider...');
    const domain = STUDENT_DOMAINS[Math.floor(Math.random() * STUDENT_DOMAINS.length)];
    const username = `student${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const email = `${username}@${domain}`;

    return {
        email: email,
        token: email,
        sessionId: email,
        provider: 'fallback_student',
        password: null,
        isFallback: true
    };
}

// ==========================================
// FETCH STUDENT EMAIL MESSAGES
// ==========================================

async function getStudentEmailMessages(sessionId, email, provider) {
    if (!email || !sessionId) return [];

    // Route to correct provider
    switch (provider) {
        case 'etempmail':
            return await fetchETempMailMessages(sessionId, email);
        case 'nullsto':
            return await fetchNullstoMessages(sessionId, email);
        case 'postinbox':
            return await fetchPostInboxMessages(sessionId, email);
        default:
            // Try all providers
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
// EXPORTS
// ==========================================

module.exports = {
    // Gmail
    createGmailAccount,
    getGmailMessages,

    // Hotmail
    createHotmailAccount,

    // Student
    createStudentEmailAccount,
    getStudentEmailMessages,

    // Individual providers (for direct access)
    tryEmailNator,
    tryMailTicking,
    trySmailPro,
    tryETempMail,
    tryNullsto,
    tryPostInbox,

    // Fetchers
    fetchEmailNatorMessages,
    fetchMailTickingMessages,
    fetchSmailProMessages,
    fetchETempMailMessages,
    fetchNullstoMessages,
    fetchPostInboxMessages
};
