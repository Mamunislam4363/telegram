const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { extractOTP: robustExtractOTP } = require('./otp-extractor');


/**
 * MOTHER EMAIL IMAP SERVICE (MULTI-ACCOUNT)
 * ─────────────────────────
 * Category/Type (e.g., 'gmail', 'hotmail') অনুযায়ী আলাদা Moth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er Email connect করে।
 */

// Map of connections: type -> { imapConnection, config, reconnectTimer }
const connections = new Map();

// ==========================================
// IMAP CONFIG
// ==========================================

function buildImapConfig(cfg) {
    return {
        imap: {
            user: cfg.email,
            password: cfg.password,
            host: cfg.host || detectHost(cfg.email),
            port: cfg.port || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
            connTimeout: 15000,
        }
    };
}

function detectHost(email) {
    if (email.includes('@gmail.com')) return 'imap.gmail.com';
    if (email.includes('@hotmail.com') || email.includes('@outlook.com') || email.includes('@live.com'))
        return 'imap-mail.outlook.com';
    if (email.includes('@yahoo.com')) return 'imap.mail.yahoo.com';
    return 'imap.gmail.com';
}

// ==========================================
// CONNECT / DISCONNECT
// ==========================================

async function connect(type, cfg) {
    if (!type || !cfg || !cfg.email) return false;

    // Disconnect existing if any for this type
    if (connections.has(type)) {
        disconnect(type);
    }

    try {
        console.log(`[IMAP] Connecting to mother email for [${type}]:`, cfg.email);

        const config = buildImapConfig(cfg);
        const imapConnection = await imapSimple.connect(config);

        const connData = {
            imapConnection,
            config: cfg,
            reconnectTimer: null
        };

        connections.set(type, connData);

        // Handle unexpected disconnection
        imapConnection.on('error', (err) => {
            console.error(`[IMAP] Connection error for [${type}]:`, err.message);
            handleDisconnect(type);
        });

        imapConnection.on('end', () => {
            console.warn(`[IMAP] Connection ended for [${type}]. Reconnecting...`);
            handleDisconnect(type);
        });

        console.log(`[IMAP] ✅ Connected to mother email for [${type}]:`, cfg.email);
        return true;
    } catch (err) {
        console.error(`[IMAP] ❌ Connection failed for [${type}]:`, err.message);
        return false;
    }
}

function handleDisconnect(type) {
    const connData = connections.get(type);
    if (!connData) return;

    if (connData.imapConnection) {
        try { connData.imapConnection.end(); } catch (e) { }
        connData.imapConnection = null;
    }

    if (connData.reconnectTimer) clearTimeout(connData.reconnectTimer);

    // Auto reconnect
    connData.reconnectTimer = setTimeout(async () => {
        console.log(`[IMAP] Attempting reconnect for [${type}]...`);
        const cfg = connData.config;
        connections.delete(type); // clear old state
        await connect(type, cfg);
    }, 15000); // 15 seconds
}

function disconnect(type) {
    const connData = connections.get(type);
    if (connData) {
        if (connData.reconnectTimer) clearTimeout(connData.reconnectTimer);
        if (connData.imapConnection) {
            try { connData.imapConnection.end(); } catch (e) { }
        }
        connections.delete(type);
        console.log(`[IMAP] Disconnected [${type}]`);
    }
}

// ==========================================
// FETCH MESSAGES
// ==========================================

/**
 * Fetch recent messages from INBOX for a specific type
 */
async function fetchMessages(type, limit = 50, sinceMinutes = 60) {
    const connData = connections.get(type);
    if (!connData || !connData.imapConnection) {
        throw new Error(`IMAP not connected for type: ${type}. Please configure Mother Email first.`);
    }

    const { imapConnection } = connData;

    try {
        await imapConnection.openBox('INBOX');

        const since = new Date();
        since.setMinutes(since.getMinutes() - sinceMinutes);

        const searchCriteria = [['SINCE', since]];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: false,
            struct: true
        };

        const messages = await imapConnection.search(searchCriteria, fetchOptions);
        const parsed = [];

        for (const msg of messages.slice(-limit)) {
            try {
                const allParts = imapSimple.getParts(msg.attributes.struct);
                const bodyPart = msg.parts.find(p => p.which === '');
                const raw = bodyPart ? bodyPart.body : '';

                const parsed_mail = await simpleParser(raw);

                const body = parsed_mail.html || parsed_mail.text || '';
                const subject = parsed_mail.subject || '(No Subject)';
                const from = parsed_mail.from?.text || 'Unknown';
                const to = parsed_mail.to?.text || '';
                const date = parsed_mail.date || new Date();

                // Extract OTP using robust extractor
                const extracted = robustExtractOTP(body, subject);

                const otp = extracted ? extracted.otp : null;

                // JS side precise time filter (IMAP SINCE is only accurate to the day)
                const messageAgeMinutes = (new Date() - date) / (1000 * 60);
                if (messageAgeMinutes > sinceMinutes) {
                    continue; // skip this message
                }

                parsed.push({
                    id: msg.attributes.uid,
                    from,
                    to,
                    subject,
                    body: body.substring(0, 2000),
                    otp,
                    date: date.toISOString(),
                    snippet: body.substring(0, 100)
                });
            } catch (parseErr) {
                // Skip unparseable messages
            }
        }

        return parsed.reverse(); // newest first
    } catch (err) {
        console.error(`[IMAP] Fetch error for [${type}]:`, err.message);
        if (err.message.includes('socket') || err.message.includes('connect')) {
            handleDisconnect(type);
        }
        throw err;
    }
}

/**
 * Fetch messages for a specific email address (pool email) using the correct type's mother email
 */
async function fetchMessagesForEmail(type, targetEmail, sinceMinutes = 120) {
    const connData = connections.get(type);
    if (!connData || !connData.imapConnection) {
        throw new Error(`IMAP not connected for type: ${type}. Please configure Mother Email first.`);
    }

    const { imapConnection } = connData;

    try {
        await imapConnection.openBox('INBOX');

        const since = new Date();
        since.setMinutes(since.getMinutes() - sinceMinutes);

        // Optimize: Search by TO and SINCE directly in IMAP
        const searchCriteria = [
            ['SINCE', since],
            ['TO', targetEmail]
        ];
        const fetchOptions = {
            bodies: ['HEADER', 'TEXT', ''],
            markSeen: false,
            struct: true
        };

        const messages = await imapConnection.search(searchCriteria, fetchOptions);
        const parsed = [];

        for (const msg of messages.slice(-50)) { // limit to 50
            try {
                const bodyPart = msg.parts.find(p => p.which === '');
                const raw = bodyPart ? bodyPart.body : '';

                const parsed_mail = await simpleParser(raw);

                const body = parsed_mail.html || parsed_mail.text || '';
                const subject = parsed_mail.subject || '(No Subject)';
                const from = parsed_mail.from?.text || 'Unknown';
                const to = parsed_mail.to?.text || '';
                const date = parsed_mail.date || new Date();

                // Extract OTP using robust extractor
                const extracted = robustExtractOTP(body, subject);
                const otp = extracted ? extracted.otp : null;

                parsed.push({
                    id: msg.attributes.uid,
                    from,
                    to,
                    subject,
                    body: body.substring(0, 2000),
                    otp,
                    date: date.toISOString(),
                    snippet: body.substring(0, 100)
                });
            } catch (parseErr) {
                // Skip unparseable messages
            }
        }

        return parsed.reverse(); // newest first
    } catch (err) {
        console.error(`[IMAP] Fetch error for [${type}] email [${targetEmail}]:`, err.message);
        if (err.message.includes('socket') || err.message.includes('connect')) {
            handleDisconnect(type);
        }
        throw err;
    }
}

// ==========================================
// OTP EXTRACTOR
// ==========================================
// We now use the robust otp-extractor.js service

// ==========================================
// STATUS CHECK
// ==========================================

function getStatus() {
    const status = {};
    for (const [type, data] of connections.entries()) {
        status[type] = {
            connected: !!data.imapConnection,
            email: data.config.email,
            host: data.config.host
        };
    }
    return status;
}

function isConnected(type) {
    const connData = connections.get(type);
    return !!(connData && connData.imapConnection);
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    connect,
    disconnect,
    fetchMessages,
    fetchMessagesForEmail,
    getStatus,
    isConnected
};
