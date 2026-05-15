/**
 * CORE SERVICES
 * Unified platform services: optimization, Firebase sync, IMAP, API gateway, document generator
 */

const express = require('express');
const compression = require('compression');
const EventEmitter = require('events');
const axios = require('axios');
const puppeteer = require('puppeteer');
const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const db = require('../db');
const firebaseManager = require('../firebase-manager');
let UNIVERSITIES = [];
try {
    UNIVERSITIES = require('../universities-data');
} catch {
    UNIVERSITIES = [{ name: 'Default University', country: 'USA' }];
}
const { extractOTP: robustExtractOTP } = require('./otp-extractor');


// =============================================================================
// API GATEWAY
// =============================================================================

class ApiGateway {

    /**
     * Get a list of healthy providers sorted by priority
     * @param {string} type - Provider type (e.g. 'sms', 'email')
     * @returns {Array} List of decrypted provider configs
     */
    getHealthyProviders(type) {
        if (!db.data || !db.data.providers) return [];

        const all = db.getProviders(true); // Get raw (encrypted values)

        return Object.entries(all)
            .map(([id, p]) => {
                // Get decrypted version
                return db.getProviderDecrypted(id);
            })
            .filter(p => p && p.type === type && (p.status === 'online' || p.status === 'active'))
            .sort((a, b) => (a.priority || 10) - (b.priority || 10));
    }

    /**
     * Execute a request with automatic failover mechanism
     * @param {string} type - Provider type
     * @param {Function} requestFn - Async function (provider) => result. 
     *                               Should throw if request fails to trigger failover.
     * @returns {Promise<any>} Result from the first successful provider
     */
    async executeWithFailover(type, requestFn) {
        const providers = this.getHealthyProviders(type);

        if (providers.length === 0) {
            console.warn(`[ApiGateway] No online providers found for type: ${type}`);
            throw new Error('SERVICE_UNAVAILABLE'); // Specific error for stealth handling
        }

        let lastError = null;

        for (const provider of providers) {
            try {
                // Execute the request function with the current provider
                const result = await requestFn(provider);
                return result; // Success

            } catch (e) {
                console.warn(`[ApiGateway] Provider ${provider.title} failed: ${e.message}`);
                lastError = e;
                // Update stats if needed (failures count, timestamp) via DB?
                // For now, HealthCheck updates periodicaly.
                // We can mark "suspect" but let HealthCheck confirm.
            }
        }

        throw lastError || new Error('All providers failed.');
    }
}

// =============================================================================
// DATABASE INDEXING
// =============================================================================

// This file documents recommended database indexes for optimal query performance

/**
 * RECOMMENDED INDEXES
 * 
 * For JSON database files, consider adding these field indexes:
 */

// Users Table Indexes
const userIndexes = {
    // Primary identifier
    'id': 'PRIMARY_KEY',           // Unique, always indexed
    
    // Search and filter
    'username': 'SECONDARY',       // For user search
    'phone': 'SECONDARY',          // For phone lookup
    'referrerUserId': 'SECONDARY', // For referral tracking
    
    // Status filtering
    'verified': 'SECONDARY',       // For verified users filter
    'banned': 'SECONDARY',         // For ban checking
    'adminVerified': 'SECONDARY',  // For admin verified users
    
    // Financial queries
    'balance_Tokens': 'SECONDARY', // For wallet/balance queries
    'usd': 'SECONDARY',            // For USD balance queries
    'lastDaily': 'SECONDARY'       // For daily bonus dedup check
};

// Transactions Table Indexes
const transactionIndexes = {
    'id': 'PRIMARY_KEY',
    'userId': 'SECONDARY',         // Query transactions by user
    'timestamp': 'SECONDARY',      // Time range queries
    'type': 'SECONDARY',           // Filter by transaction type
    'status': 'SECONDARY'          // Find pending transactions
};

// Tasks Table Indexes
const taskIndexes = {
    'id': 'PRIMARY_KEY',
    'userId': 'SECONDARY',         // Completed tasks by user
    'taskId': 'SECONDARY',         // Task completion tracking
    'completedAt': 'SECONDARY'     // Time-based queries
};

/**
 * QUERY PATTERNS TO OPTIMIZE
 */

const queryPatterns = {
    // Frequently used queries
    'getUserById': {
        description: 'Get user by ID',
        indexRequired: 'users.id',
        frequency: 'VERY_HIGH',
        estimatedQueries: '1000+/hour'
    },
    
    'getUserByPhone': {
        description: 'Get user by phone number',
        indexRequired: 'users.phone',
        frequency: 'HIGH',
        estimatedQueries: '100+/hour'
    },
    
    'getVerifiedUsers': {
        description: 'Get all verified users',
        indexRequired: 'users.verified',
        frequency: 'HIGH',
        estimatedQueries: '50+/hour'
    },
    
    'getUserTransactions': {
        description: 'Get transactions for user',
        indexRequired: 'transactions.userId + timestamp',
        frequency: 'MEDIUM',
        estimatedQueries: '200+/hour'
    },
    
    'getTaskCompletion': {
        description: 'Check if user completed task',
        indexRequired: 'tasks.userId + taskId',
        frequency: 'HIGH',
        estimatedQueries: '500+/hour'
    },
    
    'getLeaderboard': {
        description: 'Get top users by quiz points',
        indexRequired: 'users.quizPoints DESC',
        frequency: 'MEDIUM',
        estimatedQueries: '20+/hour'
    }
};

/**
 * IMPLEMENTATION RECOMMENDATIONS FOR JSON DATABASE
 */

const jsonOptimizations = {
    // Since we're using JSON files, implement in-app indexing
    // Create index objects that map field values to IDs for fast lookup
    
    indexes: {
        // Create these in db.js startup
        usersByPhone: new Map(),           // phone -> userId
        usersByUsername: new Map(),        // username -> userId
        usersByVerified: new Set(),        // Set of verified user IDs
        usersByReferrer: new Map(),        // referrerId -> [userIds]
        transactionsByUserId: new Map(),   // userId -> [transactionIds]
        taskCompletionsByUser: new Map()   // userId -> Set(taskIds)
    },
    
    // Maintain these indexes when data changes
    // This trades write performance for read performance (optimal for read-heavy apps)
    
    indexMaintenanceEvents: [
        'onUserCreated',
        'onUserUpdated',
        'onTransactionCreated',
        'onTaskCompleted'
    ]
};

/**
 * ESTIMATED PERFORMANCE IMPROVEMENTS
 */

const performanceGains = {
    'getUserById': {
        before: '10-50ms',           // Full scan
        after: '1-5ms',              // Direct lookup
        improvement: '80-90%'
    },
    
    'getUserByPhone': {
        before: '100-500ms',         // Full scan
        after: '5-20ms',             // Map lookup
        improvement: '95%+'
    },
    
    'getVerifiedUsers': {
        before: '1000-5000ms',       // Full scan + filter
        after: '50-200ms',           // Set iteration
        improvement: '90-95%'
    },
    
    'getLeaderboard': {
        before: '2000-10000ms',      // Full scan + sort
        after: '200-500ms',          // Cached + sorted
        improvement: '90-95%'
    }
};

/**
 * DATABASE QUERY OPTIMIZATION CHECKLIST
 */

const optimizationChecklist = [
    {
        priority: 'CRITICAL',
        item: 'Add phone index for user lookup',
        status: 'TODO',
        estimatedImpact: 'Very High'
    },
    {
        priority: 'CRITICAL',
        item: 'Add verification status index',
        status: 'TODO',
        estimatedImpact: 'Very High'
    },
    {
        priority: 'HIGH',
        item: 'Add user referrer index for referral tree',
        status: 'TODO',
        estimatedImpact: 'High'
    },
    {
        priority: 'HIGH',
        item: 'Add transaction userId index',
        status: 'TODO',
        estimatedImpact: 'High'
    },
    {
        priority: 'MEDIUM',
        item: 'Add timestamp index for time-based queries',
        status: 'TODO',
        estimatedImpact: 'Medium'
    },
    {
        priority: 'MEDIUM',
        item: 'Cache leaderboard rankings',
        status: 'DONE',
        estimatedImpact: 'High'
    },
    {
        priority: 'LOW',
        item: 'Implement result pagination',
        status: 'TODO',
        estimatedImpact: 'Medium'
    }
];

/**
 * SAMPLE CODE FOR INDEX IMPLEMENTATION IN db.js
 */

const indexImplementationExample = `
// Add this to db.js initialization

class DatabaseIndexes {
    constructor() {
        this.indexes = {
            usersByPhone: new Map(),
            usersByUsername: new Map(),
            usersByVerified: new Set(),
            usersByReferrer: new Map(),
            transactionsByUserId: new Map()
        };
    }

    // Index a user
    indexUser(user) {
        if (user.phone) {
            this.indexes.usersByPhone.set(user.phone, user.id);
        }
        if (user.username) {
            this.indexes.usersByUsername.set(user.username, user.id);
        }
        if (user.verified) {
            this.indexes.usersByVerified.add(user.id);
        }
        if (user.referrerUserId) {
            if (!this.indexes.usersByReferrer.has(user.referrerUserId)) {
                this.indexes.usersByReferrer.set(user.referrerUserId, []);
            }
            this.indexes.usersByReferrer.get(user.referrerUserId).push(user.id);
        }
    }

    // Query examples using indexes
    getUserByPhone(phone) {
        const userId = this.indexes.usersByPhone.get(phone);
        return userId ? db.data.users[userId] : null;
    }

    getVerifiedUsers() {
        const ids = Array.from(this.indexes.usersByVerified);
        return ids.map(id => db.data.users[id]);
    }

    getUserReferrals(userId) {
        return (this.indexes.usersByReferrer.get(userId) || [])
            .map(id => db.data.users[id]);
    }
}

// Initialize on startup
const dbIndexes = new DatabaseIndexes();

// Build indexes from existing data
Object.values(db.data.users).forEach(user => dbIndexes.indexUser(user));
`;

// =============================================================================
// DOCUMENT GENERATOR
// =============================================================================

// Shared browser instance for performance
let sharedBrowser = null;

async function getBrowser() {
    if (sharedBrowser) {
        if (sharedBrowser.isConnected()) {
            return sharedBrowser;
        }
        sharedBrowser = null;
    }

    global.emitLog('🚀 Launching Chrome browser...');
    sharedBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    sharedBrowser.on('disconnected', () => {
        global.emitLog('⚠️ Browser disconnected');
        sharedBrowser = null;
    });

    return sharedBrowser;
}

async function closeBrowser() {
    if (sharedBrowser) {
        await sharedBrowser.close();
        sharedBrowser = null;
    }
}

async function generateStudentCard(studentInfo) {
    global.emitLog('📸 Generating student card...');
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Find university object to get country
    const universityObj = UNIVERSITIES.find(u => u.name === studentInfo.university);
    const country = universityObj ? universityObj.country : 'USA'; // Default to USA
    const universityName = universityObj ? universityObj.name : studentInfo.university;

    try {
        await page.goto('https://thanhnguyxn.github.io/student-card-generator/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.waitForSelector('#countrySelect', { timeout: 30000 });

        await page.select('#countrySelect', country);

        await new Promise(r => setTimeout(r, 1000)); // Wait for options to update

        await page.waitForFunction((uniName) => {
            const select = document.querySelector('#universitySelect');
            return !select.disabled && Array.from(select.options).some(opt => opt.textContent === uniName);
        }, { timeout: 30000 }, universityName);

        // Get the value (index) for the selected university
        const universityValue = await page.evaluate((uniName) => {
            const select = document.querySelector('#universitySelect');
            const option = Array.from(select.options).find(opt => opt.textContent === uniName);
            return option ? option.value : null;
        }, universityName);

        if (!universityValue) throw new Error(`University not found in dropdown: ${universityName}`);

        await page.select('#universitySelect', universityValue);

        // Use evaluate for faster input (no typing delay)
        await page.evaluate((info) => {
            document.querySelector('#studentName').value = info.fullName || 'John Doe';
            document.querySelector('#studentId').value = info.studentId || '12345678';
            document.querySelector('#dateOfBirth').value = info.dob || '2000-01-01';
        }, studentInfo);

        // Shorter wait
        await new Promise(r => setTimeout(r, 1000));

        const cardElement = await page.$('#cardPreview');
        if (!cardElement) throw new Error('Card preview not found');

        const imageBuffer = await cardElement.screenshot({ type: 'png', encoding: 'binary' });
        global.emitLog('✅ Student card generated');
        return imageBuffer;

    } finally {
        if (page) await page.close();
        // Do not close browser here
    }
}

async function generatePayslip(teacherInfo) {
    global.emitLog('📸 Generating payslip...');
    const browser = await getBrowser();
    const page = await browser.newPage();

    // School rotation - 14 US universities
    // School rotation - use centralized list
    const universities = UNIVERSITIES.map(u => u.name);

    // Select university: Use provided one, or random from list
    const selectedUniversity = teacherInfo.university || universities[Math.floor(Math.random() * universities.length)];
    global.emitLog(`🎓 Payslip university: ${selectedUniversity}`);

    try {
        await page.goto('https://thanhnguyxn.github.io/payslip-generator/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise(r => setTimeout(r, 3000));
        await page.waitForSelector('.editor-panel', { timeout: 30000 });

        // Fast input using evaluate with random university
        await page.evaluate((info, university) => {
            const setInput = (label, value) => {
                const labels = Array.from(document.querySelectorAll('.input-group label'));
                const targetLabel = labels.find(l => l.textContent === label);
                if (targetLabel) {
                    const input = targetLabel.parentElement.querySelector('input');
                    if (input) {
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            };
            setInput('Company Name', university);
            setInput('Full Name', info.fullName || 'Jane Doe');
            setInput('Position', 'Professor');
            setInput('Employee ID', info.employeeId || 'E-1234567');
        }, teacherInfo, selectedUniversity);

        await new Promise(r => setTimeout(r, 1000));

        const cardElement = await page.$('.payslip-container');
        if (!cardElement) throw new Error('Payslip container not found');

        const imageBuffer = await cardElement.screenshot({ type: 'png', encoding: 'binary' });
        global.emitLog('✅ Payslip generated');
        return imageBuffer;

    } finally {
        await page.close();
    }
}

async function generateTeacherCard(teacherInfo, options = {}) {
    global.emitLog('📸 Generating Faculty ID Card...');
    const browser = await getBrowser();
    const page = await browser.newPage();

    // School rotation - 14 US universities
    // School rotation - use centralized list
    const universities = UNIVERSITIES.map(u => u.name);

    // Select university: Use provided one, or random from list
    const selectedUniversity = teacherInfo.university || universities[Math.floor(Math.random() * universities.length)];
    global.emitLog(`🎓 Selected university: ${selectedUniversity}`);

    try {
        await page.goto('https://thanhnguyxn.github.io/payslip-generator/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise(r => setTimeout(r, 3000));
        await page.waitForSelector('.editor-panel', { timeout: 30000 });

        // Fill in employee info with random university
        await page.evaluate((info, university) => {
            const setInput = (label, value) => {
                const labels = Array.from(document.querySelectorAll('.input-group label'));
                const targetLabel = labels.find(l => l.textContent === label);
                if (targetLabel) {
                    const input = targetLabel.parentElement.querySelector('input');
                    if (input) {
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            };
            setInput('Company Name', university);
            setInput('Full Name', info.fullName || 'Jane Doe');
            setInput('Position', 'Professor');
            setInput('Employee ID', info.employeeId || 'E-1234567');
        }, teacherInfo, selectedUniversity);

        await new Promise(r => setTimeout(r, 500));

        // Click Teacher ID tab
        const tabs = await page.$$('.tab-btn');
        for (const tab of tabs) {
            const text = await page.evaluate(el => el.textContent, tab);
            if (text.includes('Teacher ID')) {
                await tab.click();
                break;
            }
        }

        await new Promise(r => setTimeout(r, 1500));

        // Handle PDF generation if requested
        if (options.format === 'pdf') {
            global.emitLog('📄 Generating PDF...');

            try {
                // Wait for the exposed function to be available
                await page.waitForFunction(() => typeof window.getTeacherCardPdfBase64 === 'function', { timeout: 15000 });

                const pdfBase64 = await page.evaluate(async () => {
                    try {
                        return await window.getTeacherCardPdfBase64();
                    } catch (err) {
                        return { error: err.toString() };
                    }
                });

                if (!pdfBase64) throw new Error('PDF generation returned null');
                if (pdfBase64.error) throw new Error(`Browser error: ${pdfBase64.error}`);

                // Convert base64 to buffer (strip data:application/pdf;base64, prefix if present)
                const base64Data = pdfBase64.replace(/^data:.*,/, '');
                const pdfBuffer = Buffer.from(base64Data, 'base64');

                global.emitLog('✅ Faculty ID Card PDF generated');
                return pdfBuffer;
            } catch (err) {
                global.emitLog(`❌ PDF generation failed: ${err.message}`);
                throw err;
            }
        }

        // Screenshot front card only
        const cardElement = await page.$('#teacher-card-front');
        if (!cardElement) throw new Error('Faculty ID Card not found');

        const imageBuffer = await cardElement.screenshot({ type: 'png', encoding: 'binary' });
        global.emitLog('✅ Faculty ID Card generated');
        return imageBuffer;

    } finally {
        await page.close();
    }
}

async function generateMilitaryCard(militaryInfo) {
    global.emitLog('📸 Generating Military ID Card...');
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.goto('https://thanhnguyxn.github.io/payslip-generator/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await new Promise(r => setTimeout(r, 3000));
        await page.waitForSelector('.editor-panel', { timeout: 30000 });

        // Fill military info using payslip form
        await page.evaluate((info) => {
            const setInput = (label, value) => {
                const labels = Array.from(document.querySelectorAll('.input-group label'));
                const targetLabel = labels.find(l => l.textContent === label);
                if (targetLabel) {
                    const input = targetLabel.parentElement.querySelector('input');
                    if (input) {
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeInputValueSetter.call(input, value);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            };
            setInput('Company Name', info.branch);
            setInput('Full Name', info.fullName);
            setInput('Position', info.rank);
            setInput('Employee ID', info.serviceNumber);
        }, militaryInfo);

        await new Promise(r => setTimeout(r, 500));

        // Click Teacher ID tab (repurpose for Military ID)
        const tabs = await page.$$('.tab-btn');
        for (const tab of tabs) {
            const text = await page.evaluate(el => el.textContent, tab);
            if (text.includes('Teacher ID')) {
                await tab.click();
                break;
            }
        }

        await new Promise(r => setTimeout(r, 1500));

        const cardElement = await page.$('#teacher-card-front');
        if (!cardElement) throw new Error('Military ID Card not found');

        const imageBuffer = await cardElement.screenshot({ type: 'png', encoding: 'binary' });
        global.emitLog('✅ Military ID Card generated');
        return imageBuffer;

    } finally {
        await page.close();
    }
}


// Generate multiple documents in parallel
async function generateDocumentsParallel(info, docTypes = ['payslip', 'teacherCard']) {
    global.emitLog(`📸 Generating ${docTypes.length} documents in parallel...`);
    const startTime = Date.now();

    const promises = docTypes.map(type => {
        switch (type) {
            case 'studentCard': return generateStudentCard(info);
            case 'payslip': return generatePayslip(info);
            case 'teacherCard': return generateTeacherCard(info);
            default: return Promise.resolve(null);
        }
    });

    const results = await Promise.all(promises);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    global.emitLog(`✅ All documents generated in ${elapsed}s`);

    return results;
}

// =============================================================================
// IMAP SERVICE
// =============================================================================

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

// =============================================================================
// PERFORMANCE OPTIMIZER
// =============================================================================

class PerformanceOptimizer {
    constructor(app) {
        this.app = app;
        this.cache = new Map();
        this.cacheExpiry = new Map();
    }

    /**
     * Apply performance middleware
     */
    applyMiddleware() {
        // Compression
        this.app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));

        // Cache control headers
        this.app.use((req, res, next) => {
            if (req.path.startsWith('/static/') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else if (req.path.startsWith('/api/')) {
                res.setHeader('Cache-Control', 'private, max-age=60');
            } else {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
            next();
        });

        // Early hints for critical resources
        this.app.use((req, res, next) => {
            if (req.path === '/' || req.path === '/admin') {
                res.setHeader('Link', '<style.css>; rel=preload; as=style, <script.js>; rel=preload; as=script');
            }
            next();
        });

        // Disable unnecessary headers
        this.app.disable('x-powered-by');
    }

    /**
     * Memory caching with TTL
     */
    cacheSet(key, value, ttl = 60000) {
        this.cache.set(key, value);
        
        if (ttl > 0) {
            const expiryTime = Date.now() + ttl;
            this.cacheExpiry.set(key, expiryTime);
            
            // Auto cleanup
            setTimeout(() => {
                this.cache.delete(key);
                this.cacheExpiry.delete(key);
            }, ttl);
        }
        
        return { cached: true, key };
    }

    /**
     * Get from cache
     */
    cacheGet(key) {
        const expiry = this.cacheExpiry.get(key);
        
        if (expiry && Date.now() > expiry) {
            this.cache.delete(key);
            this.cacheExpiry.delete(key);
            return null;
        }
        
        return this.cache.get(key);
    }

    /**
     * Clear cache
     */
    cacheClear(pattern = null) {
        if (pattern) {
            const regex = new RegExp(pattern);
            for (const key of this.cache.keys()) {
                if (regex.test(key)) {
                    this.cache.delete(key);
                    this.cacheExpiry.delete(key);
                }
            }
        } else {
            this.cache.clear();
            this.cacheExpiry.clear();
        }
    }

    /**
     * Get cache stats
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            items: Array.from(this.cache.keys()),
            memoryUsage: JSON.stringify(Array.from(this.cache.entries())).length
        };
    }

    /**
     * Optimize API response time
     */
    optimizeResponse(data) {
        if (!data) return {};
        
        // Remove unnecessary fields
        const optimized = { ...data };
        const fieldsToRemove = ['_internal', '__proto__', 'constructor'];
        
        fieldsToRemove.forEach(field => delete optimized[field]);
        
        return optimized;
    }

    /**
     * Batch API requests
     */
    async batchRequests(requests, handler) {
        const results = [];
        const batchSize = 5;
        
        for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(req => handler(req))
            );
            results.push(...batchResults);
        }
        
        return results;
    }

    /**
     * Request deduplication
     */
    createDeduplicator() {
        const pending = new Map();
        
        return async (key, fn) => {
            if (pending.has(key)) {
                return pending.get(key);
            }
            
            const promise = fn().finally(() => pending.delete(key));
            pending.set(key, promise);
            return promise;
        };
    }
}

// =============================================================================
// REALTIME UPDATER
// =============================================================================

class RealtimeUpdater extends EventEmitter {
    constructor() {
        super();
        this.clients = new Map();
        this.changeLog = [];
        this.maxChangeLog = 1000;
        this.changeTracker = {};
    }

    /**
     * Register SSE client
     */
    registerClient(clientId, res) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        this.clients.set(clientId, {
            res,
            connected: Date.now(),
            subscriptions: new Set()
        });

        // Send initial connection message
        res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

        // Send recent changes
        if (this.changeLog.length > 0) {
            const recentChanges = this.changeLog.slice(-10);
            res.write(`data: ${JSON.stringify({ type: 'history', changes: recentChanges })}\n\n`);
        }

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            if (res.writableEnded) {
                clearInterval(heartbeat);
                this.clients.delete(clientId);
                return;
            }
            res.write(`: heartbeat\n\n`);
        }, 30000);

        res.on('close', () => {
            clearInterval(heartbeat);
            this.clients.delete(clientId);
        });

        return clientId;
    }

    /**
     * Subscribe client to updates
     */
    subscribe(clientId, eventType) {
        const client = this.clients.get(clientId);
        if (client) {
            client.subscriptions.add(eventType);
        }
    }

    /**
     * Broadcast update to all clients
     */
    broadcast(event) {
        const change = {
            type: event.type,
            data: event.data,
            timestamp: Date.now(),
            id: this.changeLog.length
        };

        // Add to change log
        this.changeLog.push(change);
        if (this.changeLog.length > this.maxChangeLog) {
            this.changeLog.shift();
        }

        // Track changes
        if (!this.changeTracker[event.type]) {
            this.changeTracker[event.type] = [];
        }
        this.changeTracker[event.type].push(change);

        // Send to subscribed clients
        for (const [clientId, client] of this.clients) {
            if (client.subscriptions.size === 0 || client.subscriptions.has(event.type)) {
                try {
                    client.res.write(`id: ${change.id}\n`);
                    client.res.write(`event: ${event.type}\n`);
                    client.res.write(`data: ${JSON.stringify(change)}\n\n`);
                } catch (error) {
                    // Client disconnected
                    this.clients.delete(clientId);
                }
            }
        }

        // Emit to listeners
        this.emit(event.type, change);
    }

    /**
     * Update user data
     */
    notifyUserUpdate(userId, data) {
        this.broadcast({
            type: 'user_update',
            data: { userId, ...data }
        });
    }

    /**
     * Update token balance
     */
    notifyTokenUpdate(userId, newBalance) {
        this.broadcast({
            type: 'token_update',
            data: { userId, balance: newBalance }
        });
    }

    /**
     * Update task completion
     */
    notifyTaskUpdate(userId, taskId, status) {
        this.broadcast({
            type: 'task_update',
            data: { userId, taskId, status }
        });
    }

    /**
     * Update admin panel
     */
    notifyAdminUpdate(event) {
        this.broadcast({
            type: 'admin_update',
            data: event
        });
    }

    /**
     * System notification
     */
    notifySystemAlert(message, severity = 'info') {
        this.broadcast({
            type: 'system_alert',
            data: { message, severity, timestamp: Date.now() }
        });
    }

    /**
     * Get active clients count
     */
    getActiveClients() {
        return this.clients.size;
    }

    /**
     * Get change history for event type
     */
    getChangeHistory(eventType, limit = 100) {
        if (eventType && this.changeTracker[eventType]) {
            return this.changeTracker[eventType].slice(-limit);
        }
        return this.changeLog.slice(-limit);
    }

    /**
     * Clear history
     */
    clearHistory() {
        this.changeLog = [];
        this.changeTracker = {};
    }

    /**
     * Disconnect all clients
     */
    disconnectAll() {
        for (const [clientId, client] of this.clients) {
            try {
                client.res.end();
            } catch (error) {
                // Already closed
            }
        }
        this.clients.clear();
    }
}

// =============================================================================
// FIREBASE SYNC
// =============================================================================

class FirebaseSync {
    constructor() {
        this.syncQueue = [];
        this.isSyncing = false;
        this.lastSyncTime = null;
        this.syncInterval = 5000; // Every 5 seconds
        this.maxQueueSize = 100;
    }

    /**
     * Initialize Firebase sync
     */
    async initialize() {
        console.log('🔥 Initializing Firebase Sync for Optimization System...');
        
        try {
            // Check if Firebase is connected
            if (firebaseManager.connected) {
                console.log('✅ Firebase connected - Real-time sync active');
                this.startSyncInterval();
            } else {
                console.log('⚠️ Firebase not connected - Local DB only');
            }
        } catch (error) {
            console.error('❌ Firebase sync initialization error:', error);
        }
    }

    /**
     * Queue data for Firebase sync
     */
    queueSync(path, data, priority = 'normal') {
        if (this.syncQueue.length >= this.maxQueueSize) {
            console.warn('⚠️ Sync queue full, dropping oldest item');
            this.syncQueue.shift();
        }

        this.syncQueue.push({
            path,
            data,
            priority,
            timestamp: Date.now(),
            retries: 0
        });

        // Prioritize high-priority items
        if (priority === 'critical') {
            this.syncQueue.sort((a, b) => {
                if (a.priority === 'critical') return -1;
                if (b.priority === 'critical') return 1;
                return b.timestamp - a.timestamp;
            });
        }
    }

    /**
     * Start background sync interval
     */
    startSyncInterval() {
        if (this._syncInterval) return;

        this._syncInterval = setInterval(() => {
            this.processSyncQueue();
        }, this.syncInterval);

        console.log('🔄 Firebase sync interval started');
    }

    /**
     * Stop sync interval
     */
    stopSyncInterval() {
        if (this._syncInterval) {
            clearInterval(this._syncInterval);
            this._syncInterval = null;
        }
    }

    /**
     * Process queued sync items
     */
    async processSyncQueue() {
        if (this.isSyncing || this.syncQueue.length === 0) return;
        if (!firebaseManager.connected) return;

        this.isSyncing = true;

        try {
            while (this.syncQueue.length > 0) {
                const item = this.syncQueue[0];

                try {
                    // Sync to Firebase
                    await firebaseManager.update(item.path, item.data);
                    this.lastSyncTime = Date.now();
                    
                    // Remove from queue on success
                    this.syncQueue.shift();

                    // Small delay between updates
                    await new Promise(r => setTimeout(r, 100));
                } catch (error) {
                    item.retries++;

                    if (item.retries >= 3) {
                        console.error(`❌ Sync failed after 3 retries: ${item.path}`);
                        this.syncQueue.shift();
                    } else {
                        console.warn(`⚠️ Sync retry ${item.retries}/3: ${item.path}`);
                        await new Promise(r => setTimeout(r, 1000 * item.retries));
                    }
                }
            }
        } catch (error) {
            console.error('❌ Sync queue processing error:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Sync user balance to Firebase
     */
    async syncUserBalance(userId, balance, reserved = 0, available = 0) {
        const path = `/users/${userId}/balance`;
        const data = {
            total: balance,
            reserved,
            available,
            lastUpdated: Date.now()
        };

        this.queueSync(path, data, 'high');
    }

    /**
     * Sync user transaction to Firebase
     */
    async syncUserTransaction(userId, transaction) {
        const path = `/users/${userId}/transactions/${transaction.id || Date.now()}`;
        const data = {
            ...transaction,
            timestamp: Date.now(),
            synced: true
        };

        this.queueSync(path, data, 'critical');
    }

    /**
     * Sync operation status to Firebase
     */
    async syncOperationStatus(operationId, status, userId, metadata = {}) {
        const path = `/operations/${operationId}`;
        const data = {
            status,
            userId,
            ...metadata,
            lastUpdated: Date.now()
        };

        this.queueSync(path, data, 'high');
    }

    /**
     * Sync token refund to Firebase
     */
    async syncRefund(operationId, userId, amount, reason) {
        const path = `/refunds/${operationId}`;
        const data = {
            operationId,
            userId,
            amount,
            reason,
            timestamp: Date.now(),
            processed: true
        };

        this.queueSync(path, data, 'critical');
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            connected: firebaseManager.connected,
            isSyncing: this.isSyncing,
            queuedItems: this.syncQueue.length,
            lastSyncTime: this.lastSyncTime,
            nextSyncIn: this._syncInterval ? this.syncInterval : 'disabled'
        };
    }

    /**
     * Force immediate sync
     */
    async forceSync() {
        console.log('🔥 Forcing Firebase sync...');
        await this.processSyncQueue();
        console.log('✅ Force sync complete');
        return this.getSyncStatus();
    }

    /**
     * Get queued items
     */
    getQueuedItems() {
        return this.syncQueue.map(item => ({
            path: item.path,
            retries: item.retries,
            age: Date.now() - item.timestamp
        }));
    }

    /**
     * Clear failed items from queue
     */
    clearFailedItems() {
        const beforeCount = this.syncQueue.length;
        this.syncQueue = this.syncQueue.filter(item => item.retries < 3);
        console.log(`🧹 Cleared ${beforeCount - this.syncQueue.length} failed items`);
    }

    /**
     * Manually sync user data to Firebase
     */
    async syncUserData(userId) {
        try {
            const user = db.getUser(userId);
            if (!user) return { success: false, error: 'User not found' };

            const userData = {
                ...user,
                lastSynced: Date.now()
            };

            await firebaseManager.update(`/users/${userId}`, userData);
            console.log(`✅ User ${userId} synced to Firebase`);
            
            return { success: true };
        } catch (error) {
            console.error(`❌ Error syncing user ${userId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Sync all users to Firebase (bulk sync)
     */
    async syncAllUsers() {
        try {
            console.log('🔄 Starting bulk user sync to Firebase...');
            const users = db.getUsers();
            
            if (!users || users.length === 0) {
                return { success: true, synced: 0 };
            }

            let synced = 0;
            for (const user of users) {
                await this.syncUserData(user.id);
                synced++;
                
                // Throttle bulk sync
                if (synced % 10 === 0) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            console.log(`✅ Bulk sync complete: ${synced} users synced`);
            return { success: true, synced };
        } catch (error) {
            console.error('❌ Bulk sync error:', error);
            return { success: false, error: error.message };
        }
    }
}

// =============================================================================
// TOKEN MANAGER
// =============================================================================

class TokenManager {
    constructor() {
        this.pendingOperations = new Map();
        this.failedOperations = new Map();
        this.tokenCache = new Map();
        this.updateInterval = null;
    }

    /**
     * Validate user has sufficient tokens
     */
    async validateBalance(userId, amount) {
        const user = db.getUser(userId);
        if (!user) return { success: false, error: 'User not found' };

        const balance = user.balance_tokens || user.balance || 0;
        const hasBalance = balance >= amount;

        return {
            success: hasBalance,
            balance,
            required: amount,
            sufficient: hasBalance
        };
    }

    /**
     * Reserve tokens (prevents double spending)
     */
    async reserveTokens(userId, operationId, amount) {
        try {
            const validation = await this.validateBalance(userId, amount);
            if (!validation.success) {
                return { success: false, error: 'Insufficient balance', validation };
            }

            // Store pending operation
            this.pendingOperations.set(operationId, {
                userId,
                amount,
                timestamp: Date.now(),
                status: 'reserved'
            });

            return { success: true, operationId, reserved: amount };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Confirm token deduction (after successful service)
     */
    async confirmDeduction(userId, operationId, amount, serviceDetails) {
        try {
            const user = db.getUser(userId);
            if (!user) return { success: false, error: 'User not found' };

            // Deduct tokens
            user.balance_tokens = (user.balance_tokens || user.balance || 0) - amount;
            user.balance = user.balance_tokens;

            // Add to history
            if (!user.history) user.history = [];
            user.history.unshift({
                type: serviceDetails.type,
                amount: -amount,
                date: new Date().toISOString(),
                reward: `-${amount} Tokens`,
                detail: serviceDetails.detail || 'Service',
                operationId: operationId,
                status: 'completed'
            });

            db.data.users[String(userId)] = user;
            db.save();

            // Sync to Firebase
            const fbSync = firebaseSync;
            if (fbSync) {
                fbSync.syncUserBalance(userId, user.balance_tokens, 0, user.balance_tokens);
                fbSync.syncUserTransaction(userId, {
                    id: operationId,
                    type: serviceDetails.type,
                    amount: -amount,
                    detail: serviceDetails.detail,
                    status: 'completed'
                });
            }

            // Mark operation as completed
            this.pendingOperations.delete(operationId);

            return { success: true, newBalance: user.balance_tokens };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Refund tokens (if service failed)
     */
    async refundTokens(userId, operationId, amount, reason) {
        try {
            const user = db.getUser(userId);
            if (!user) return { success: false, error: 'User not found' };

            // Refund tokens
            user.balance_tokens = (user.balance_tokens || user.balance || 0) + amount;
            user.balance = user.balance_tokens;

            // Add to history
            if (!user.history) user.history = [];
            user.history.unshift({
                type: 'refund',
                amount: amount,
                date: new Date().toISOString(),
                reward: `+${amount} Tokens (Refund)`,
                detail: reason || 'Service failed',
                operationId: operationId,
                status: 'refunded'
            });

            db.data.users[String(userId)] = user;
            db.save();

            // Sync to Firebase
            const fbSync = firebaseSync;
            if (fbSync) {
                fbSync.syncUserBalance(userId, user.balance_tokens, 0, user.balance_tokens);
                fbSync.syncRefund(operationId, userId, amount, reason);
            }

            // Mark operation as failed
            this.failedOperations.set(operationId, {
                userId,
                amount,
                reason,
                timestamp: Date.now(),
                synced: true
            });

            this.pendingOperations.delete(operationId);

            return { success: true, newBalance: user.balance_tokens, refunded: amount };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get pending operations for user
     */
    async getPendingOperations(userId) {
        const pending = [];
        for (const [opId, op] of this.pendingOperations) {
            if (op.userId === userId) {
                pending.push({ operationId: opId, ...op });
            }
        }
        return pending;
    }

    /**
     * Cancel pending operation
     */
    async cancelOperation(operationId) {
        const operation = this.pendingOperations.get(operationId);
        if (!operation) {
            return { success: false, error: 'Operation not found' };
        }

        // Refund if still pending
        if (operation.status === 'reserved') {
            await this.refundTokens(
                operation.userId,
                operationId,
                operation.amount,
                'Operation cancelled'
            );
        }

        return { success: true };
    }

    /**
     * Auto-clean expired pending operations (30 minutes timeout)
     */
    startCleanupInterval() {
        if (this.updateInterval) return;

        this.updateInterval = setInterval(() => {
            const now = Date.now();
            const timeout = 30 * 60 * 1000; // 30 minutes

            for (const [opId, op] of this.pendingOperations) {
                if (now - op.timestamp > timeout) {
                    // Refund expired operations
                    this.refundTokens(
                        op.userId,
                        opId,
                        op.amount,
                        'Operation timeout - automatic refund'
                    );
                }
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    /**
     * Stop cleanup interval
     */
    stopCleanupInterval() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    /**
     * Get user balance summary
     */
    async getBalanceSummary(userId) {
        const user = db.getUser(userId);
        if (!user) return { success: false, error: 'User not found' };

        const pending = await this.getPendingOperations(userId);
        const reservedTokens = pending.reduce((sum, op) => sum + op.amount, 0);

        return {
            success: true,
            balance: user.balance_tokens || user.balance || 0,
            reserved: reservedTokens,
            available: (user.balance_tokens || user.balance || 0) - reservedTokens,
            currency: 'TC (Token Coins)',
            lastUpdated: Date.now()
        };
    }
}

// =============================================================================
// OPTIMIZED API ROUTES
// =============================================================================

function createOptimizedRoutes(app, db, PerformanceOptimizer) {
    const perfOptimizer = new PerformanceOptimizer(app);
    perfOptimizer.applyMiddleware();

    const router = express.Router();

    /**
     * SSE: Real-time updates
     */
    router.get('/updates/stream', (req, res) => {
        const clientId = `client_${Date.now()}_${Math.random()}`;
        realtimeUpdater.registerClient(clientId, res);
    });

    /**
     * Subscribe to specific updates
     */
    router.post('/updates/subscribe', (req, res) => {
        const { clientId, events } = req.body;
        events.forEach(event => {
            realtimeUpdater.subscribe(clientId, event);
        });
        res.json({ success: true });
    });

    /**
     * GET: User balance with token protection info
     */
    router.get('/user/:userId/balance', async (req, res) => {
        try {
            const { userId } = req.params;
            
            // Check cache
            const cacheKey = `balance_${userId}`;
            let cached = perfOptimizer.cacheGet(cacheKey);
            
            if (cached) {
                return res.json({ ...cached, fromCache: true });
            }

            // Get balance summary
            const summary = await tokenManager.getBalanceSummary(userId);
            
            // Cache for 30 seconds
            perfOptimizer.cacheSet(cacheKey, summary, 30000);

            res.json(summary);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST: Reserve tokens before operation
     */
    router.post('/tokens/reserve', async (req, res) => {
        try {
            const { userId, amount, operationId } = req.body;
            
            if (!userId || !amount || !operationId) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const result = await tokenManager.reserveTokens(userId, operationId, amount);
            
            if (result.success) {
                // Notify in real-time
                realtimeUpdater.notifyTokenUpdate(userId, result.reserved);
            }

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST: Confirm token deduction
     */
    router.post('/tokens/confirm', async (req, res) => {
        try {
            const { userId, operationId, amount, serviceDetails } = req.body;
            
            if (!userId || !operationId || !amount) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const result = await tokenManager.confirmDeduction(userId, operationId, amount, serviceDetails);
            
            if (result.success) {
                // Clear cache
                perfOptimizer.cacheClear(`balance_${userId}`);
                
                // Notify real-time
                realtimeUpdater.notifyTokenUpdate(userId, result.newBalance);
                
                // Log update
                realtimeUpdater.broadcast({
                    type: 'service_completed',
                    data: { userId, operationId, newBalance: result.newBalance }
                });
            }

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST: Refund tokens
     */
    router.post('/tokens/refund', async (req, res) => {
        try {
            const { userId, operationId, amount, reason } = req.body;
            
            if (!userId || !operationId || !amount) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const result = await tokenManager.refundTokens(userId, operationId, amount, reason);
            
            if (result.success) {
                // Clear cache
                perfOptimizer.cacheClear(`balance_${userId}`);
                
                // Notify real-time
                realtimeUpdater.notifyTokenUpdate(userId, result.newBalance);
                
                // Log refund
                realtimeUpdater.notifySystemAlert(`User ${userId} refunded ${amount} tokens: ${reason}`, 'info');
            }

            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET: Pending operations
     */
    router.get('/tokens/pending/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const pending = await tokenManager.getPendingOperations(userId);
            res.json({ success: true, pending });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * POST: Cancel operation
     */
    router.post('/tokens/cancel', async (req, res) => {
        try {
            const { operationId } = req.body;
            const result = await tokenManager.cancelOperation(operationId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET: Cache stats (admin)
     */
    router.get('/admin/cache-stats', (req, res) => {
        const stats = perfOptimizer.getCacheStats();
        res.json(stats);
    });

    /**
     * GET: Realtime stats (admin)
     */
    router.get('/admin/realtime-stats', (req, res) => {
        res.json({
            activeClients: realtimeUpdater.getActiveClients(),
            changeLogSize: realtimeUpdater.changeLog.length,
            recentChanges: realtimeUpdater.changeLog.slice(-5)
        });
    });

    /**
     * DELETE: Clear cache (admin)
     */
    router.delete('/admin/cache', (req, res) => {
        const { pattern } = req.query;
        perfOptimizer.cacheClear(pattern);
        res.json({ success: true });
    });

    return router;
}

// =============================================================================
// FIREBASE SYNC API ROUTES
// =============================================================================

function createFirebaseSyncRoutes() {
    const router = express.Router();

    /**
     * GET: Firebase sync status
     */
    router.get('/sync-status', (req, res) => {
        const status = firebaseSync.getSyncStatus();
        res.json({ success: true, ...status });
    });

    /**
     * GET: Queued sync items
     */
    router.get('/queue', (req, res) => {
        const items = firebaseSync.getQueuedItems();
        res.json({ 
            success: true, 
            queuedItems: items,
            totalQueued: items.length
        });
    });

    /**
     * POST: Force immediate sync
     */
    router.post('/force-sync', async (req, res) => {
        try {
            const result = await firebaseSync.forceSync();
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST: Sync specific user data
     */
    router.post('/sync-user/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const result = await firebaseSync.syncUserData(userId);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * POST: Bulk sync all users
     */
    router.post('/sync-all-users', async (req, res) => {
        try {
            const result = await firebaseSync.syncAllUsers();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    /**
     * DELETE: Clear failed sync items
     */
    router.delete('/clear-failed', (req, res) => {
        firebaseSync.clearFailedItems();
        const status = firebaseSync.getSyncStatus();
        res.json({ success: true, ...status });
    });

    return router;
}

// =============================================================================
// EXPORTS
// =============================================================================

const apiGateway = new ApiGateway();
const realtimeUpdater = new RealtimeUpdater();
const firebaseSync = new FirebaseSync();
const tokenManager = new TokenManager();

const imapService = {
    connect,
    disconnect,
    fetchMessages,
    fetchMessagesForEmail,
    getStatus,
    isConnected
};

const documentGenerator = {
    generateStudentCard,
    generatePayslip,
    generateTeacherCard,
    generateMilitaryCard,
    generateDocumentsParallel,
    getBrowser,
    closeBrowser
};

const databaseIndexing = {
    userIndexes,
    transactionIndexes,
    taskIndexes,
    queryPatterns,
    jsonOptimizations,
    performanceGains,
    optimizationChecklist,
    indexImplementationExample
};

module.exports = {
    apiGateway,
    imapService,
    documentGenerator,
    databaseIndexing,
    PerformanceOptimizer,
    realtimeUpdater,
    tokenManager,
    firebaseSync,
    createOptimizedRoutes,
    createFirebaseSyncRoutes
};
