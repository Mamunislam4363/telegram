const axios = require('axios');
const otpExtractor = require('./otp-extractor');
const config = require('../config');

// SmtpLabs Config from bot's config
const SMTP_API_BASE = 'https://api.smtp.dev';
const SMTP_API_KEY = config.SMTPLABS_API_KEY;

/**
 * TEMP MAIL PROVIDER CHAIN
 * Tries providers in order until one succeeds
 * Returns: { email, token, password, provider } or null
 */

// LEVEL 1: Mail.tm
async function tryMailTm() {
    try {
        const domain = (await axios.get('https://api.mail.tm/domains')).data['hydra:member'][0].domain;
        const username = Math.random().toString(36).substring(7);
        const password = Math.random().toString(36).substring(7);
        const email = `${username}@${domain}`;

        await axios.post('https://api.mail.tm/accounts', { address: email, password: password });
        const tokenRes = await axios.post('https://api.mail.tm/token', { address: email, password: password });

        if (tokenRes.data.token) {
            return {
                email,
                password,
                token: tokenRes.data.token,
                provider: 'mail.tm'
            };
        }
    } catch (e) {
        // console.error('Mail.tm Failed:', e.message);
    }
    return null;
}

// LEVEL 0: SmtpLabs (Premium Real-time Provider)
// Known by user as "MB Mail" or internal generator
async function trySmtpLabs() {
    if (!SMTP_API_KEY || SMTP_API_KEY.includes('YOUR_')) return null;

    try {
        const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const randomPass = `Pass${Date.now()}!`;
        const email = `${randomUser}@smtp.dev`;

        const headers = {
            'X-API-KEY': SMTP_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const res = await axios.post(`${SMTP_API_BASE}/accounts`, {
            address: email,
            password: randomPass
        }, { headers, timeout: 10000 });

        if (res.data && res.data.id) {
            const inbox = res.data.mailboxes?.find(m => m.path === 'INBOX');
            return {
                email: res.data.address,
                password: randomPass,
                accountId: res.data.id,
                mailboxId: inbox ? inbox.id : null,
                token: res.data.id, // Store account ID as token
                provider: 'smtplabs'
            };
        }
    } catch (e) {
        console.error('SmtpLabs Account Creation Failed:', e.message);
    }
    return null;
}

// LEVEL 0.5: ApiGateway Failover (Database Providers)
async function tryApiGateway() {
    try {
        const apiGateway = require('./api-gateway');
        const db = require('../db');

        return await apiGateway.executeWithFailover('email', async (provider) => {
            const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const randomPass = `Pass${Date.now()}!`;
            const email = `${randomUser}@smtp.dev`; // Fallback domain

            const response = await axios.post(`${provider.apiUrl}/accounts`, {
                address: email,
                password: randomPass
            }, {
                headers: {
                    'X-API-KEY': provider.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            if (response.data && response.data.id) {
                const inbox = response.data.mailboxes?.find(m => m.path === 'INBOX');
                return {
                    id: response.data.id,
                    email: response.data.address,
                    password: randomPass,
                    mailboxId: inbox?.id || null,
                    providerId: provider.id,
                    token: response.data.id,
                    provider: 'smtplabs_gateway'
                };
            }
            throw new Error('Invalid Provider Response');
        });
    } catch (e) {
        return null;
    }
}

// LEVEL 2: 1SecMail (Internxt fallback)
async function try1SecMail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['1secmail.com', '1secmail.org', '1secmail.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;

        return {
            email,
            password: 'No-Password',
            token: `${username}@${domain}`,
            provider: '1secmail'
        };
    } catch (e) {
        // console.error('1SecMail Failed:', e.message);
    }
    return null;
}

// LEVEL 3: Mail.gw (Same engine as Mail.tm)
async function tryMailGw() {
    try {
        const domainRes = await axios.get('https://api.mail.gw/domains');
        const domain = domainRes.data['hydra:member'][0].domain;
        const username = Math.random().toString(36).substring(7);
        const password = Math.random().toString(36).substring(7);
        const email = `${username}@${domain}`;

        await axios.post('https://api.mail.gw/accounts', { address: email, password: password });
        const tokenRes = await axios.post('https://api.mail.gw/token', { address: email, password: password });

        if (tokenRes.data.token) {
            return {
                email,
                password,
                token: tokenRes.data.token,
                provider: 'mail.gw'
            };
        }
    } catch (e) {
        // console.error('Mail.gw Failed:', e.message);
    }
    return null;
}

// LEVEL 4: GuerrillaMail (Fakemail System)
async function tryGuerrilla() {
    try {
        const res = await axios.get('http://api.guerrillamail.com/ajax.php?f=get_email_address');
        if (res.data && res.data.email_addr) {
            return {
                email: res.data.email_addr,
                password: 'No-Password',
                token: res.data.sid_token, // Session ID needed for checking mail
                provider: 'guerrilla'
            };
        }
    } catch (e) {
        // console.error('Guerrilla Failed:', e.message);
    }
    return null;
}

/**
 * MAIN GENERATOR FUNCTION
 * Tries all providers in sequence
 */
async function createAccount() {
    console.log('🔄 Starting Live Email Generation Chain (MB Mail Mode)...');

    // 0. Try SmtpLabs (Direct or Gateway)
    let account = await trySmtpLabs();
    if (account) return account;

    account = await tryApiGateway();
    if (account) return account;

    // 1. Mail.tm fallback
    account = await tryMailTm();
    if (account) return account;

    // 2. 1SecMail
    account = await try1SecMail();
    if (account) return account;

    // 3. Mail.gw
    account = await tryMailGw();
    if (account) return account;

    // 4. GuerrillaMail
    account = await tryGuerrilla();
    if (account) return account;

    console.error('❌ All providers failed!');
    return null;
}

// Helper for Mail.tm/gw message fetching
async function fetchMailTmMessage(baseUrl, token, msgId) {
    const fullMsgRes = await axios.get(`${baseUrl}/messages/${msgId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const fullMsg = fullMsgRes.data;
    const subject = fullMsg.subject || '';
    const body = fullMsg.text || fullMsg.html || '';

    // Use advanced OTP extractor
    const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

    return {
        otp: result.otp,
        confidence: result.confidence,
        fullMessage: body,
        // Added for compatibility
        text: body,
        subject: subject,
        date: fullMsg.createdAt || new Date().toISOString(),
        sender: fullMsg.from ? (fullMsg.from.address || fullMsg.from.name) : 'Unknown'
    };
}

/**
 * OTP CHECKER FUNCTION
 */
async function getOtp(token, email) {
    if (!token) return null;

    // 1. Mail.tm / Mail.gw (JWT Tokens checking)
    // JWT starts with "ey..." usually and is long.
    if (token.length > 50 && !token.includes('@') && !token.startsWith('sid')) {
        // Try Mail.tm first
        try {
            const res = await axios.get('https://api.mail.tm/messages', { headers: { Authorization: `Bearer ${token}` } });
            if (res.data['hydra:member'] && res.data['hydra:member'].length > 0) {
                return await fetchMailTmMessage('https://api.mail.tm', token, res.data['hydra:member'][0].id);
            }
        } catch (e) { }

        // Try Mail.gw
        try {
            const res = await axios.get('https://api.mail.gw/messages', { headers: { Authorization: `Bearer ${token}` } });
            if (res.data['hydra:member'] && res.data['hydra:member'].length > 0) {
                return await fetchMailTmMessage('https://api.mail.gw', token, res.data['hydra:member'][0].id);
            }
        } catch (e) { }
    }

    // 2. GuerrillaMail (Session Token)
    // Heuristic: token length ~32, alphanumeric, no @
    if (token.length > 20 && !token.includes('@') && !token.startsWith('ey')) {
        try {
            const res = await axios.get(`http://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${token}`);
            const list = res.data.list;
            // Guerrilla returns list of emails. Need to find new ones.
            if (list && list.length > 0) {
                // Return latest
                const mail = list[list.length - 1];
                const mailId = mail.mail_id;

                // Fetch body
                const bodyRes = await axios.get(`http://api.guerrillamail.com/ajax.php?f=fetch_email&sid_token=${token}&email_id=${mailId}`);
                const body = bodyRes.data.mail_body;
                const subject = bodyRes.data.mail_subject || '';

                // Use advanced OTP extractor
                const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

                return {
                    otp: result.otp,
                    confidence: result.confidence,
                    fullMessage: body,
                    // Added for compatibility
                    text: body,
                    subject: subject,
                    date: bodyRes.data.mail_date || new Date().toISOString(),
                    sender: bodyRes.data.mail_from
                };
            }
        } catch (e) { }
    }

    // 3. 1SecMail
    if (token.includes('@') || (email && email.includes('@'))) {
        try {
            const checkEmail = email || token;
            if (checkEmail.includes('@')) {
                const [user, domain] = checkEmail.split('@');
                const res = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${user}&domain=${domain}`);
                if (res.data && res.data.length > 0) {
                    const id = res.data[0].id;
                    const msgRes = await axios.get(`https://www.1secmail.com/api/v1/?action=readMessage&login=${user}&domain=${domain}&id=${id}`);
                    const body = msgRes.data.textBody || msgRes.data.body || '';
                    const subject = msgRes.data.subject || '';

                    // Use advanced OTP extractor
                    const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

                    return {
                        otp: result.otp,
                        confidence: result.confidence,
                        fullMessage: body,
                        // Added for compatibility
                        text: body,
                        subject: subject,
                        date: msgRes.data.date || new Date().toISOString(),
                        sender: msgRes.data.from
                    };
                }
            }
        } catch (e) { }
    }

    return null;
}

// Helper to fetch full message list for Mail.tm/gw
async function fetchMailTmMessages(baseUrl, token) {
    try {
        const res = await axios.get(`${baseUrl}/messages`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const messages = res.data['hydra:member'] || [];
        return await Promise.all(messages.map(async (msg) => {
            const fullMsg = await axios.get(`${baseUrl}/messages/${msg.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return {
                id: msg.id,
                from: fullMsg.data.from ? (fullMsg.data.from.address || fullMsg.data.from.name) : 'Unknown',
                subject: fullMsg.data.subject || '(No Subject)',
                text: fullMsg.data.text || fullMsg.data.html || '',
                date: fullMsg.data.createdAt || new Date().toISOString()
            };
        }));
    } catch (e) {
        return [];
    }
}

// Helper for 1SecMail messages
async function fetch1SecMailMessages(email) {
    try {
        if (!email.includes('@')) return [];
        const [user, domain] = email.split('@');
        const res = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${user}&domain=${domain}`);
        const messages = res.data || [];
        return await Promise.all(messages.map(async (msg) => {
            const fullMsg = await axios.get(`https://www.1secmail.com/api/v1/?action=readMessage&login=${user}&domain=${domain}&id=${msg.id}`);
            return {
                id: msg.id,
                from: fullMsg.data.from || 'Unknown',
                subject: fullMsg.data.subject || '(No Subject)',
                text: fullMsg.data.textBody || fullMsg.data.body || '',
                date: fullMsg.data.date || new Date().toISOString()
            };
        }));
    } catch (e) {
        return [];
    }
}

// Helper for GuerrillaMail messages
async function fetchGuerrillaMessages(token) {
    try {
        const res = await axios.get(`http://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${token}`);
        const list = res.data.list || [];
        return list.map(m => ({
            id: m.mail_id,
            from: m.mail_from,
            subject: m.mail_subject || '(No Subject)',
            text: '', // Would need separate fetch for body
            date: m.mail_date || new Date().toISOString()
        }));
    } catch (e) {
        return [];
    }
}

// Helper for SmtpLabs messages
async function fetchSmtpLabsMessages(apiBase, apiKey, accountId, mailboxId) {
    try {
        const headers = { 'X-API-KEY': apiKey, 'Accept': 'application/json' };

        // 1. Resolve Mailbox if missing
        if (!mailboxId) {
            const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes`, { headers });
            const inbox = res.data?.member?.find(m => m.path === 'INBOX');
            if (inbox) mailboxId = inbox.id;
            else return [];
        }

        // 2. Get Messages
        const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages`, { headers });
        const messages = res.data?.member || [];

        return await Promise.all(messages.map(async (msg) => {
            // Fetch full content
            try {
                const fullRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages/${msg.id}`, { headers });
                const fullMsg = fullRes.data;
                return {
                    id: msg.id,
                    from: fullMsg.from?.address || 'Unknown',
                    subject: fullMsg.subject || '(No Subject)',
                    text: fullMsg.body?.text || '(Empty)',
                    date: fullMsg.createdAt || new Date().toISOString()
                };
            } catch (e) {
                return {
                    id: msg.id,
                    from: msg.from?.address || 'Unknown',
                    subject: msg.subject || '(No Subject)',
                    text: '',
                    date: msg.createdAt || new Date().toISOString()
                };
            }
        }));
    } catch (e) {
        console.error('SmtpLabs Fetch Error:', e.message);
        return [];
    }
}

/**
 * GET MESSAGES FUNCTION - for inbox fetching
 */
async function getMessages(sessionId, email) {
    // Detect provider from sessionId metadata if possible
    // We need to look up the session in DB? No, sessionId might be the account ID.
    // Let's check the global DB mailSessions if we can.

    // 0. Detect SmtpLabs (MB Mail)
    // Heuristic: If we have an email and the session ID is numeric/short ID
    // Check if we can get the session info from the database
    try {
        const db = require('../db');
        const session = db.data.mailSessions ? db.data.mailSessions[sessionId] : null;

        if (session && (session.provider === 'smtplabs' || session.provider === 'smtplabs_gateway')) {
            let apiBase = SMTP_API_BASE;
            let apiKey = SMTP_API_KEY;

            if (session.providerId) {
                const p = db.getProviderDecrypted(session.providerId);
                if (p) {
                    apiBase = p.apiUrl;
                    apiKey = p.apiKey;
                }
            }

            return await fetchSmtpLabsMessages(apiBase, apiKey, session.accountId || session.id, session.mailboxId);
        }
    } catch (e) { }
    // Try to detect provider from session/token format

    // 1. JWT tokens (Mail.tm/Mail.gw)
    if (sessionId && sessionId.length > 50 && !sessionId.includes('@')) {
        // Try Mail.tm
        try {
            const msgs = await fetchMailTmMessages('https://api.mail.tm', sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }

        // Try Mail.gw
        try {
            const msgs = await fetchMailTmMessages('https://api.mail.gw', sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }
    }

    // 2. Guerrilla Mail
    if (sessionId && sessionId.length > 20 && !sessionId.includes('@') && !sessionId.startsWith('ey')) {
        try {
            const msgs = await fetchGuerrillaMessages(sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }
    }

    // 3. 1SecMail
    const checkEmail = email || sessionId;
    if (checkEmail && checkEmail.includes('@')) {
        try {
            return await fetch1SecMailMessages(checkEmail);
        } catch (e) { }
    }

    return [];
}

module.exports = {
    createAccount,
    getOtp,
    getMessages
};
