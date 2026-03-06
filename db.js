const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

// Default initial data
const defaultData = {
    users: {},
    groups: {}, // Store Group/Channel IDs
    codes: {},
    settings: {
        dailyBonus: 50,
        refBonus: 50, // Updated to 50
        taskReward: 10,
        costs: {
            spotify: 50,
            youtube: 50,
            teacher: 100, // Bolt.new
            gpt: 100,
            military: 100,
            gemini: 50
        },
        transferCost: 5 // Default transfer fee
    },
    tasks: {
        "channel": { name: "Join Official Channel", url: "https://t.me/AutosVerifyCh", reward: 20 }
    },
    cards: {
        "gemini": [],
        "chatgpt": [],
        "spotify": []
    },
    cardPrices: {
        "gemini": 150,
        "chatgpt": 200,
        "spotify": 50
    },
    serviceNames: {},
    scheduledBroadcasts: [],
    tickets: [],
    payments: [],
    transactions: [], // NEW: Transaction history
    vpnAccounts: {
        "nordvpn": [],
        "expressvpn": [],
        "surfshark": [],
        "cyberghost": [],
        "protonvpn": []
    },
    vpnPrices: {
        "nordvpn": 100,
        "expressvpn": 120,
        "surfshark": 80,
        "cyberghost": 70,
        "protonvpn": 90
    },
    vpnServiceNames: {
        "nordvpn": "🛡️ NordVPN",
        "expressvpn": "⚡ ExpressVPN",
        "surfshark": "🦈 Surfshark",
        "cyberghost": "👻 CyberGhost",
        "protonvpn": "🔒 ProtonVPN"
    },
    adminSettings: {
        supportCost: 10,
        gmailCost: 50, // Default Gmail Cost
        creditRates: {
            crypto: 0.01,
            bkash: 1,
            nagad: 1
        },
        // Welcome credits for new users
        welcomeCredits: 50
    },
    featureFlags: {
        // Admin Panel Buttons
        admin_manage_user: true,
        admin_manage_cards: true,
        admin_manage_apps: true,
        admin_manage_vpn: true,
        admin_manage_codes: true,
        admin_manage_tasks: true,
        admin_manage_costs: true,
        admin_payments: true,
        admin_backup: true,
        admin_settings: true,
        admin_stats: true,
        admin_broadcast: true,
        admin_upload_file: true,
        admin_group_controller: true,
        admin_number_services: true, // New Module
        // User Features
        buy_cards: true,
        buy_vpn: true,
        buy_premium_app: true,
        verification: true,
        support: true,
        referral: true,
        daily_bonus: true,
        tasks: true,
        transfer: true,
        redeem_code: true,
        number_services: true
    },
    // Legit SMS Providers (Number Service Module)
    numberServices: {},
    services: {},
    shopItems: {},
    // Generic API Providers (New System)
    providers: {}, // { id: { title, type, apiUrl, apiKey (enc), priority, status, healthStats... } }
    broadcasts: [], // Ensure broadcast storage structure
    pendingDeposits: [], // { id, userId, method, amount, txnId, screenshot, date, status: 'pending'|'approved'|'rejected', autoApproved: true|false }
    cryptoMethods: {
        binance: { name: "Binance Pay", details: "39996280", email: "boyearn705@gmail.com", qr: "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=39996280", status: "active" },
        bitget: { name: "Bitget", details: "748839201", email: "", qr: "", status: "active" },
        gateio: { name: "Gate.io", details: "12345678", email: "", qr: "", status: "active" },
        usdt: { name: "Web3 (USDT TRC20)", details: "TR7NHqkeu71v7otNDV352u653nqYBg7KkZ", email: "", qr: "", status: "active" },
        bitcoin: { name: "Web3 (Bitcoin)", details: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", email: "", qr: "", status: "active" }
    }
};

/* Encryption Helper */
const crypto = require('crypto');
const ENCRYPTION_KEY = (process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_long____').padEnd(32, '0').slice(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return null;
    try {
        let iv = crypto.randomBytes(IV_LENGTH);
        let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) { console.error("Encrypt Error:", e); return null; }
}

function decrypt(text) {
    if (!text) return null;
    try {
        let textParts = text.split(':');
        let iv = Buffer.from(textParts.shift(), 'hex');
        let encryptedText = Buffer.from(textParts.join(':'), 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) { console.error("Decrypt Error:", e); return null; }
}


const firebaseManager = require('./database/firebase-manager');
const googleDriveStorage = require('./database/google-drive-storage'); // Integrated Drive

class Database {
    constructor() {
        this.data = defaultData;
        this.ready = false;
        this.DB_FILE = DB_FILE; // Expose for server.js file size stats

        // Initialize Asynchronously
        this.dbReady = this.init();
    }



    async init() {
        // 1. Connect to Firebase
        await firebaseManager.connect();

        // 2. Check Remote Data
        const remoteData = await firebaseManager.getData();
        let localData = null;

        // 3. Check Local Data (Migration Source)
        if (fs.existsSync(DB_FILE)) {
            try {
                localData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            } catch (e) {
                console.error("Local DB Read Error:", e);
            }
        }

        if (remoteData) {
            // Remote exists -> Use it (Primary)
            this.data = { ...defaultData, ...remoteData, settings: { ...defaultData.settings, ...(remoteData.settings || {}) } };
            console.log("✅ Database loaded from Firebase.");
        } else if (localData) {
            // Remote empty but Local exists -> MIGRATE
            console.log("📤 Migrating Local Data to Firebase...");
            this.data = { ...defaultData, ...localData };
            // Upload immediately
            await firebaseManager.setData(this.data);
            console.log("✅ Migration Complete.");
        } else {
            console.warn("⚠️ No Data Found (Local or Remote). Starting Fresh.");
        }

        this.ready = true;

        // 4. Safety Cleanup: Move Local File to Backups instead of deleting
        if (fs.existsSync(DB_FILE)) {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupName = `migrated_backup_${timestamp}.json`;
                const backupPath = path.join(BACKUP_DIR, backupName);

                if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

                // Copy to backup first
                fs.copyFileSync(DB_FILE, backupPath);
                // Then remove original (only after successful copy)
                fs.unlinkSync(DB_FILE);

                console.log(`📦 Local database migrated and moved to: ${backupPath}`);
            } catch (err) {
                console.error("❌ Failed to move local database to backups:", err.message);
            }
        }
    }

    deleteLocalBackup() {
        if (fs.existsSync(DB_FILE)) {
            try {
                fs.unlinkSync(DB_FILE);
                console.log("🗑️ Legacy Local Backup DELETED (Migrated to Firebase).");
            } catch (e) {
                console.error("❌ Failed to delete legacy backup:", e.message);
            }
        }
    }

    async save() {
        if (!this.ready) return;

        // 1. Sync to Firebase (Primary & Critical)
        if (firebaseManager.connected) {
            try {
                await firebaseManager.setData(this.data);

                // If we successfully saved to Firebase, we can clear the local "offline backup"
                // This keeps the local storage clean and light as requested by the user.
                if (fs.existsSync(DB_FILE)) {
                    try {
                        fs.unlinkSync(DB_FILE);
                        console.log("🧹 Firebase Synced: Local cache cleared to save storage.");
                    } catch (err) {
                        // Silent fail for unlink
                    }
                }
            } catch (e) {
                console.error("Firebase Sync Error:", e.message);
                this.saveLocalBackup();
            }
        } else {
            // Fallback: Save to local disk if Firebase is not connected
            this.saveLocalBackup();
        }

        // 2. Sync to Google Drive (Secondary & Background)
        if (googleDriveStorage && googleDriveStorage.connected) {
            (async () => {
                try {
                    await googleDriveStorage.saveData('users.json', this.data.users);
                    await googleDriveStorage.saveData('gmails.json', this.data.gmails);
                    await googleDriveStorage.saveData('services.json', this.data.emailServices);
                } catch (e) {
                    console.error("Drive Sync Error:", e.message);
                }
            })();
        }
    }

    saveLocalBackup() {
        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error("❌ Failed to save local backup:", e.message);
        }
    }

    getUser(userId) {
        // Validate userId - must be a number or numeric string
        const numericId = typeof userId === 'number' ? userId : parseInt(userId);
        if (isNaN(numericId) || numericId <= 0) {
            console.error(`[DB] Invalid userId rejected: ${userId}`);
            return null;
        }

        const id = numericId.toString();

        if (!this.data.users[id]) {
            const welcomeCredits = this.getWelcomeCredits();
            this.data.users[id] = {
                id: numericId,
                balance: welcomeCredits,  // Welcome credits for new users (legacy)
                balance_tokens: welcomeCredits, // New: Tokens (TC) currency
                joinedAt: Date.now(),
                referrer: null,
                lastDaily: null,
                tasksDone: [],
                referralCount: 0,
                referredBy: null,
                // New Stats
                username: null,
                successfulVerifications: 0,
                failedVerifications: 0,
                cardsPurchased: 0,
                blocked: false,
                adminVerified: false,
                language: 'en',  // Default language
                lastActive: Date.now(), // New: Activity tracking
                dailyStreak: 0,
                lastDaily: 0
            };
            this.save();
        }
        return this.data.users[id];
    }

    updateUserActivity(userId) {
        if (!this.data.users) return;
        const id = userId.toString();
        if (this.data.users[id]) {
            this.data.users[id].lastActive = Date.now();
            this.save();
        }
    }

    saveGroup(chatId, title, type) {
        if (!this.data.groups) this.data.groups = {};
        const id = chatId.toString();

        this.data.groups[id] = {
            id: chatId,
            title: title,
            type: type,
            addedAt: this.data.groups[id]?.addedAt || Date.now(),
            lastActive: Date.now()
        };
        this.save();
    }

    getGroups() {
        return Object.values(this.data.groups || {});
    }

    updateUser(userOrId, updates = null) {
        // Handle both formats: updateUser(userObject) or updateUser(userId, updates)
        let userId, userData;

        if (typeof userOrId === 'object' && userOrId.id !== undefined) {
            // First format: updateUser(userObject)
            userId = userOrId.id;
            userData = userOrId;
        } else {
            // Second format: updateUser(userId, updates)
            userId = userOrId;
            userData = updates;
        }

        // Validate userId
        const numericId = typeof userId === 'number' ? userId : parseInt(userId);
        if (isNaN(numericId) || numericId <= 0) {
            console.error(`[DB] updateUser: Invalid userId rejected: ${userId}`);
            return false;
        }

        const id = numericId.toString();

        // If user doesn't exist, create it
        if (!this.data.users[id]) {
            this.data.users[id] = {
                id: numericId,
                balance: 0,
                balance_tokens: 0, // New: Tokens (TC) currency
                joinedAt: Date.now(),
                referrer: null,
                lastDaily: null,
                tasksDone: [],
                referralCount: 0,
                referredBy: null,
                username: null,
                successfulVerifications: 0,
                failedVerifications: 0,
                cardsPurchased: 0,
                blocked: false,
                language: 'en'
            };
        }

        // Apply updates
        if (userData && typeof userData === 'object') {
            Object.keys(userData).forEach(key => {
                if (key !== 'id') { // Don't overwrite ID
                    this.data.users[id][key] = userData[key];
                }
            });
        }

        this.save();
        return true;
    }

    getUsers() {
        return Object.values(this.data.users || {});
    }

    // Helper: get canonical token balance
    getTokenBalance(user) {
        if (user.tokens !== undefined) return user.tokens;
        if (user.balance_tokens !== undefined) return user.balance_tokens;
        return user.balance || 0;
    }

    // Helper: set canonical token balance (keeps all fields in sync)
    setTokenBalance(user, amount) {
        const val = Math.max(0, Math.round(amount));
        user.tokens = val;
        user.balance_tokens = val;
        user.balance = val;
    }

    addCredit(userId, amount) {
        const user = this.getUser(userId);
        if (!user) return 0;

        const current = this.getTokenBalance(user);
        this.setTokenBalance(user, current + amount);

        this.save();
        return user.tokens;
    }

    setLanguage(userId, lang) {
        const user = this.getUser(userId);
        user.language = lang;
        this.save();
    }

    // Referrals
    handleReferral(newUserId, referrerId) {
        const newUser = this.getUser(newUserId);
        // If already referred or self-referral, ignore
        if (newUser.referredBy || String(newUserId) === String(referrerId)) return false;

        const referrer = this.getUser(referrerId);
        if (!referrer) return false;

        // Set referral relationship
        newUser.referredBy = String(referrerId);

        // Track in referrer's list
        if (!referrer.referredUsers) referrer.referredUsers = [];
        referrer.referredUsers.push({
            userId: String(newUserId),
            date: Date.now(),
            rewarded: true
        });

        // Increment count
        if (!referrer.referralCount) referrer.referralCount = 0;
        referrer.referralCount++;

        // Add bonus to referrer (keep all balance fields in sync)
        const refBonus = (this.data.settings && this.data.settings.refBonus) || 50;
        const referrerBalance = this.getTokenBalance(referrer);
        this.setTokenBalance(referrer, referrerBalance + refBonus);

        // Add welcome bonus to new user
        const newUserBalance = this.getTokenBalance(newUser);
        this.setTokenBalance(newUser, newUserBalance + refBonus);

        // Add to referrer's history
        if (!referrer.history) referrer.history = [];
        referrer.history.unshift({
            type: 'referral',
            amount: refBonus,
            currency: 'tokens',
            date: Date.now(),
            details: `Referred user #${newUserId}`,
            reward: `+${refBonus} Tokens`
        });

        // Add to new user's history
        if (!newUser.history) newUser.history = [];
        newUser.history.unshift({
            type: 'welcome_bonus',
            amount: refBonus,
            currency: 'tokens',
            date: Date.now(),
            details: `Joined via referral from #${referrerId}`,
            reward: `+${refBonus} Tokens`
        });

        // Add transaction record
        this.addTransaction(referrerId, 'referral', refBonus, 'Tokens', `Referral bonus from #${newUserId}`, 'user-plus');
        this.addTransaction(newUserId, 'bonus', refBonus, 'Tokens', 'Welcome referral bonus', 'gift');

        this.save();
        return true;
    }

    getTopReferrers(limit = 10) {
        const users = Object.values(this.data.users);
        // Filter users with > 0 referrals and sort
        const top = users
            .filter(u => u.referralCount > 0)
            .sort((a, b) => b.referralCount - a.referralCount)
            .slice(0, limit);
        return top;
    }

    deductCredit(userId, amount) {
        const user = this.getUser(userId);
        if (!user) return false;

        const currentBalance = this.getTokenBalance(user);
        if (currentBalance < amount) return false;

        this.setTokenBalance(user, currentBalance - amount);

        this.save();
        return true;
    }

    getSettings() {
        if (!this.data.settings) this.data.settings = {};
        if (!this.data.settings.paymentMethods) {
            const config = require('./config');
            this.data.settings.paymentMethods = JSON.parse(JSON.stringify(config.PAYMENT_METHODS));
            this.save();
        }
        return this.data.settings;
    }

    updateSetting(key, value) {
        this.data.settings[key] = value;
        this.save();
    }

    updateCost(service, cost) {
        this.data.settings.costs[service] = cost;
        this.save();
    }

    // Codes
    createCode(code, amount, maxUses) {
        this.data.codes[code] = { amount, uses: 0, maxUses, valid: true };
        this.save();
    }

    deleteCode(code) {
        if (this.data.codes[code]) {
            delete this.data.codes[code];
            this.save();
            return true;
        }
        return false;
    }

    redeemCode(userId, code) {
        const c = this.data.codes[code];
        if (!c || !c.valid) return { success: false, msg: "Invalid code" };
        if (c.maxUses > 0 && c.uses >= c.maxUses) return { success: false, msg: "Code fully redeemed" };

        const user = this.getUser(userId);
        if (user.redeemed && user.redeemed.includes(code)) return { success: false, msg: "Already redeemed" };

        c.uses++;
        const currentBalance = this.getTokenBalance(user);
        this.setTokenBalance(user, currentBalance + c.amount);
        if (!user.redeemed) user.redeemed = [];
        user.redeemed.push(code);

        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'redeem',
            amount: c.amount,
            currency: 'tokens',
            date: Date.now(),
            details: `Redeemed code: ${code}`
        });

        this.save();
        return { success: true, amount: c.amount, newBalance: user.tokens };
    }

    // Daily
    claimDaily(userId) {
        const user = this.getUser(userId);
        if (!user) return { success: false, message: "User not found" };

        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const lastClaim = user.lastDaily || 0;

        // Check if 24h passed
        if (lastClaim > 0 && (now - lastClaim < oneDay)) {
            const remaining = oneDay - (now - lastClaim);
            const hours = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            return { success: false, msg: `Come back in ${hours}h ${mins}m`, message: `Come back in ${hours}h ${mins}m` };
        }

        // Streak Logic: Reset if missed a day (more than 48h)
        if (lastClaim > 0 && (now - lastClaim > oneDay * 2)) {
            user.dailyStreak = 0;
        }

        user.dailyStreak = (user.dailyStreak || 0) + 1;
        if (user.dailyStreak > 7) user.dailyStreak = 1; // Reset to Day 1 after Day 7

        user.lastDaily = now;

        // Reward Calculation
        const dailyBonus = (this.data.settings && this.data.settings.dailyBonus) || 50;
        const rewards = [dailyBonus, dailyBonus * 2, dailyBonus * 3, dailyBonus * 4, dailyBonus * 5, dailyBonus * 6, dailyBonus * 10];
        const reward = rewards[user.dailyStreak - 1] || dailyBonus;

        const currentBalance = this.getTokenBalance(user);
        this.setTokenBalance(user, currentBalance + reward);

        if (!user.history) user.history = [];
        user.history.unshift({
            type: 'daily_bonus',
            amount: reward,
            currency: 'tokens',
            date: now
        });

        this.save();
        return {
            success: true,
            amount: reward,
            reward: reward,
            newStreak: user.dailyStreak,
            newBalance: user.tokens
        };
    }

    // Tasks
    getTasks() {
        return this.data.tasks || {};
    }

    createTask(name, url, reward) {
        if (!this.data.tasks) this.data.tasks = {};
        const id = 'task_' + Date.now();
        this.data.tasks[id] = { name, url, reward: parseInt(reward) };
        this.save();
        return id;
    }

    deleteTask(taskId) {
        if (this.data.tasks && this.data.tasks[taskId]) {
            delete this.data.tasks[taskId];
            this.save();
            return true;
        }
        return false;
    }

    completeTask(userId, taskId) {
        const user = this.getUser(userId);
        const task = this.data.tasks ? this.data.tasks[taskId] : null;

        if (!task) return { success: false, msg: "Task not found" };

        if (!user.tasksDone) user.tasksDone = [];
        if (user.tasksDone.includes(taskId)) return { success: false, msg: "Already completed" };

        user.tasksDone.push(taskId);
        user.balance += task.reward;
        this.save();
        return { success: true, reward: task.reward };
    }

    // Card Management
    addCard(service, details) {
        if (!this.data.cards) this.data.cards = { "gemini": [], "chatgpt": [], "spotify": [] };
        if (!this.data.cards[service]) this.data.cards[service] = [];
        this.data.cards[service].push(details);
        this.save();
        return true;
    }

    getCard(service) {
        if (!this.data.cards || !this.data.cards[service] || this.data.cards[service].length === 0) {
            return null;
        }
        const card = this.data.cards[service].shift(); // Remove first available card

        // Check if stock is now empty - auto delete service and promo codes
        if (this.data.cards[service].length === 0) {
            console.log(`[DB] Stock depleted for service: ${service}. Auto-deleting service and promo codes...`);

            // Delete associated promo codes (codes that start with service name)
            if (this.data.settings && this.data.settings.codes) {
                const codesToDelete = Object.keys(this.data.settings.codes).filter(code => {
                    // Delete codes that match the service ID or contain service name
                    return code.toLowerCase().includes(service.toLowerCase());
                });

                codesToDelete.forEach(code => {
                    delete this.data.settings.codes[code];
                    console.log(`[DB] Deleted promo code: ${code}`);
                });
            }

            // Delete the service completely
            this.deleteService(service);
            console.log(`[DB] Service ${service} auto-deleted due to zero stock`);
        }

        this.save();
        return card;
    }

    getCardCounts() {
        const counts = {};
        const services = Object.keys(this.data.cards || {});
        services.forEach(s => {
            counts[s] = this.data.cards[s].length;
        });
        return counts;
    }

    clearCards(service) {
        if (this.data.cards && this.data.cards[service]) {
            this.data.cards[service] = [];
            this.save();
            return true;
        }
        return false;
    }

    getCardPrice(service) {
        if (this.data.cardPrices && this.data.cardPrices[service]) return this.data.cardPrices[service];
        return 100; // Default fallback
    }

    updatePrice(service, price) {
        if (!this.data.cardPrices) this.data.cardPrices = {};
        this.data.cardPrices[service] = parseInt(price);
        this.save();
    }

    getServices() {
        const fromPrices = Object.keys(this.data.cardPrices || {});
        const fromStock = Object.keys(this.data.cards || {});
        const fromNames = Object.keys(this.data.serviceNames || {});

        // Merge all known service IDs
        const allIds = [...new Set([...fromPrices, ...fromStock, ...fromNames])];

        // Filter out empty or invalid IDs just in case
        const validIds = allIds.filter(id => id && typeof id === 'string' && id.length > 0);

        return validIds.map(sid => {
            const stock = (this.data.cards && this.data.cards[sid]) ? this.data.cards[sid].length : 0;
            const price = (this.data.cardPrices && this.data.cardPrices[sid]) ? this.data.cardPrices[sid] : 100;
            const name = (this.data.serviceNames && this.data.serviceNames[sid]) ? this.data.serviceNames[sid] : sid.toUpperCase();

            return { id: sid, name: name, price: price, stock: stock };
        });
    }

    // Service Management


    createService(id, name, price) {
        if (!this.data.cards) this.data.cards = {};
        if (!this.data.serviceNames) this.data.serviceNames = {};
        if (!this.data.cardPrices) this.data.cardPrices = {};

        if (!this.data.cards[id]) this.data.cards[id] = [];
        this.data.serviceNames[id] = name;
        this.data.cardPrices[id] = parseInt(price);
        this.save();
    }

    deleteService(id) {
        if (this.data.cards && this.data.cards[id]) delete this.data.cards[id];
        if (this.data.serviceNames && this.data.serviceNames[id]) delete this.data.serviceNames[id];
        if (this.data.cardPrices && this.data.cardPrices[id]) delete this.data.cardPrices[id];
        this.save();
    }

    // ==================== TRANSACTION HISTORY ====================

    addTransaction(userId, type, amount, currency, title, icon = 'circle') {
        if (!this.data.transactions) this.data.transactions = [];

        const transaction = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            user_id: userId.toString(),
            type: type, // 'deposit', 'withdraw', 'service', 'exchange', 'bonus'
            amount: amount,
            currency: currency, // 'Tokens', 'Gems', 'USD'
            title: title,
            icon: icon,
            timestamp: Date.now()
        };

        this.data.transactions.unshift(transaction); // Add to beginning

        // Limit history size per user or globally to prevent bloat (keep last 1000 globally)
        if (this.data.transactions.length > 1000) {
            this.data.transactions = this.data.transactions.slice(0, 1000);
        }

        this.save();
        return transaction;
    }

    // ==================== NUMBER SERVICES (SMS GATEWAYS) ====================

    getNumberServices() {
        if (!this.data.numberServices) this.data.numberServices = {};
        return this.data.numberServices;
    }

    saveNumberService(id, config) {
        if (!this.data.numberServices) this.data.numberServices = {};
        this.data.numberServices[id] = config;
        this.save();
    }

    deleteNumberService(id) {
        if (this.data.numberServices && this.data.numberServices[id]) {
            delete this.data.numberServices[id];
            this.save();
            return true;
        }
        return false;
    }

    // ==================== SMS GATEWAYS (PROVIDERS) ====================

    getSmsGateways() {
        if (!this.data.smsGateways) this.data.smsGateways = {};
        return this.data.smsGateways;
    }

    saveSmsGateway(id, config) {
        if (!this.data.smsGateways) this.data.smsGateways = {};
        this.data.smsGateways[id] = config;
        this.save();
    }

    deleteSmsGateway(id) {
        if (this.data.smsGateways && this.data.smsGateways[id]) {
            delete this.data.smsGateways[id];
            this.save();
            return true;
        }
        return false;
    }

    // ==================== EMAIL GATEWAYS (PROVIDERS) ====================

    getEmailGateways() {
        if (!this.data.emailGateways) this.data.emailGateways = {};
        return this.data.emailGateways;
    }

    saveEmailGateway(id, config) {
        if (!this.data.emailGateways) this.data.emailGateways = {};
        this.data.emailGateways[id] = config;
        this.save();
    }

    deleteEmailGateway(id) {
        if (this.data.emailGateways && this.data.emailGateways[id]) {
            delete this.data.emailGateways[id];
            this.save();
            return true;
        }
        return false;
    }

    // ==================== ACTIVE ORDERS (NUMBERS) ====================

    getActiveOrders() {
        if (!this.data.activeOrders) this.data.activeOrders = {};
        return this.data.activeOrders;
    }

    saveActiveOrder(order) {
        if (!this.data.activeOrders) this.data.activeOrders = {};
        this.data.activeOrders[order.id] = order;
        this.save();
    }

    updateActiveOrder(id, updates) {
        if (!this.data.activeOrders) this.data.activeOrders = {};
        if (this.data.activeOrders[id]) {
            this.data.activeOrders[id] = { ...this.data.activeOrders[id], ...updates };
            this.save();
            return true;
        }
        return false;
    }

    // Scheduled Broadcasts
    getScheduledBroadcasts() {
        if (!this.data.scheduledBroadcasts) this.data.scheduledBroadcasts = [];
        return this.data.scheduledBroadcasts;
    }

    addScheduledBroadcast(broadcast) {
        if (!this.data.scheduledBroadcasts) this.data.scheduledBroadcasts = [];
        broadcast.id = Date.now().toString();
        this.data.scheduledBroadcasts.push(broadcast);
        this.save();
        return broadcast.id;
    }

    removeScheduledBroadcast(id) {
        if (!this.data.scheduledBroadcasts) return false;
        const index = this.data.scheduledBroadcasts.findIndex(b => b.id === id);
        if (index !== -1) {
            this.data.scheduledBroadcasts.splice(index, 1);
            this.save();
            return true;
        }
        return false;
    }

    // ==================== SUPPORT TICKETS ====================

    createTicket(userId, subject, message) {
        if (!this.data.tickets) this.data.tickets = [];

        const ticket = {
            id: `TICKET-${Date.now()}`,
            userId: userId,
            subject: subject,
            message: message,
            status: 'open', // open, replied, closed
            createdAt: Date.now(),
            replies: []
        };

        this.data.tickets.push(ticket);
        this.save();
        return ticket.id;
    }

    getTickets(userId = null) {
        if (!this.data.tickets) this.data.tickets = [];
        if (userId) {
            return this.data.tickets.filter(t => t.userId === userId);
        }
        return this.data.tickets;
    }

    getTicket(ticketId) {
        if (!this.data.tickets) return null;
        return this.data.tickets.find(t => t.id === ticketId);
    }

    replyToTicket(ticketId, message, isAdmin = false) {
        const ticket = this.getTicket(ticketId);
        if (!ticket) return false;

        ticket.replies.push({
            message: message,
            timestamp: Date.now(),
            isAdmin: isAdmin
        });

        ticket.status = isAdmin ? 'replied' : 'open';
        this.save();
        return true;
    }

    closeTicket(ticketId) {
        const ticket = this.getTicket(ticketId);
        if (!ticket) return false;

        ticket.status = 'closed';
        this.save();
        return true;
    }

    // ==================== PAYMENT SYSTEM ====================

    createPayment(userId, amount, method, trxId = null) {
        if (!this.data.payments) this.data.payments = [];

        const payment = {
            id: `PAY-${Date.now()}`,
            userId: userId,
            amount: amount,
            method: method, // crypto, bkash, nagad, etc.
            status: 'pending', // pending, confirmed, rejected
            createdAt: Date.now(),
            trxId: trxId
        };

        this.data.payments.push(payment);
        this.save();
        return payment;
    }

    // ==================== EMAIL SERVICES SYSTEM ====================

    getEmailServices() {
        if (!this.data.emailServices) this.data.emailServices = {};
        return this.data.emailServices; // { "gemini": { name: "Gemini AI", price: 10, stock: [] } }
    }

    createEmailService(id, name, price) {
        if (!this.data.emailServices) this.data.emailServices = {};
        if (!this.data.emailServices[id]) {
            this.data.emailServices[id] = {
                name: name,
                price: parseInt(price),
                stock: []
            };
            this.save();
            return true;
        }
        return false;
    }

    deleteEmailService(id) {
        if (this.data.emailServices && this.data.emailServices[id]) {
            delete this.data.emailServices[id];
            this.save();
            return true;
        }
        return false;
    }

    addEmailStock(serviceId, emails) {
        // emails = [{ email, password }]
        if (!this.data.emailServices) this.data.emailServices = {};
        if (!this.data.emailServices[serviceId]) return false;

        this.data.emailServices[serviceId].stock.push(...emails);
        this.save();
        return true;
    }

    getAvailableEmailForUser(userId, serviceId) {
        const user = this.getUser(userId); // Ensure user object exists (though passed logic usually handles it)

        // 1. Check OAuth Pool (Priority)
        if (this.data.gmails) {
            // Find an OAuth email assigned to this SERVICE, which is NOT assigned to ANY USER yet.
            const oauthEmail = this.data.gmails.find(g =>
                g.oauth === true &&
                g.service === serviceId &&
                !g.assignedTo
            );

            if (oauthEmail) {
                // Initialize user.usedEmails if needed
                if (!user.usedEmails) user.usedEmails = [];
                user.usedEmails.push(oauthEmail.email);

                oauthEmail.assignedTo = userId;
                oauthEmail.assignedAt = Date.now();
                this.save();

                // Return compatible object
                return {
                    email: oauthEmail.email,
                    password: 'OAuth-Secured', // No password shown
                    oauth: true,
                    refreshToken: oauthEmail.refreshToken,
                    source: 'oauth'
                };
            }
        }

        // 2. Check Legacy Stock (service.stock)
        if (!this.data.emailServices || !this.data.emailServices[serviceId]) return null;

        const service = this.data.emailServices[serviceId];
        const usedEmails = user.usedEmails || [];

        // Find first email in stock that hasn't been used by this user
        let selectedIndex = -1;

        for (let i = 0; i < service.stock.length; i++) {
            if (!usedEmails.includes(service.stock[i].email)) {
                selectedIndex = i;
                break;
            }
        }

        if (selectedIndex === -1) return null;

        // Extract the email
        const emailObj = service.stock.splice(selectedIndex, 1)[0];

        // Add to global gmails list implementation
        this.addGmail(emailObj.email, emailObj.password);
        const saved = this.getGmail(emailObj.email);
        if (saved) {
            saved.assignedTo = userId;
            // saved.service = serviceId; // Optional tracking
            saved.source = 'start_stock';
            this.save();
        }

        // Update user used list
        if (!user.usedEmails) user.usedEmails = [];
        user.usedEmails.push(emailObj.email);
        this.updateUser(user);

        return saved; // Return the full object
    }


    getPayments(userId = null) {
        if (!this.data.payments) this.data.payments = [];
        if (userId) {
            return this.data.payments.filter(p => p.userId === userId);
        }
        return this.data.payments;
    }

    getPayment(paymentId) {
        if (!this.data.payments) return null;
        return this.data.payments.find(p => p.id === paymentId);
    }

    confirmPayment(paymentId, txnId = null) {
        const payment = this.getPayment(paymentId);
        if (!payment || payment.status !== 'pending') return false;

        payment.status = 'confirmed';
        payment.confirmedAt = Date.now();
        if (txnId) payment.txnId = txnId;

        // Add balance to user
        this.addCredit(payment.userId, payment.amount);
        this.save();
        return true;
    }

    rejectPayment(paymentId) {
        const payment = this.getPayment(paymentId);
        if (!payment || payment.status !== 'pending') return false;

        payment.status = 'rejected';
        this.save();
        return true;
    }

    // Undo payment (admin can reverse decision)
    undoPayment(paymentId) {
        const payment = this.getPayment(paymentId);
        if (!payment) return false;

        // If was confirmed, remove credits
        if (payment.status === 'confirmed') {
            this.addCredit(payment.userId, -payment.amount);
        }

        payment.status = 'pending';
        payment.confirmedAt = null;
        this.save();
        return true;
    }

    // ==================== ADMIN SETTINGS ====================

    getSupportCost() {
        if (!this.data.adminSettings) {
            this.data.adminSettings = { supportCost: 10, creditRates: { crypto: 0.01, bkash: 1, nagad: 1 } };
        }
        return this.data.adminSettings.supportCost || 10;
    }

    setSupportCost(cost) {
        if (!this.data.adminSettings) {
            this.data.adminSettings = { supportCost: 10, creditRates: { crypto: 0.01, bkash: 1, nagad: 1 } };
        }
        this.data.adminSettings.supportCost = cost;
        this.save();
    }

    getCreditRate(method) {
        if (!this.data.adminSettings || !this.data.adminSettings.creditRates) {
            this.data.adminSettings = { supportCost: 10, creditRates: { crypto: 0.01, bkash: 1, nagad: 1 } };
        }
        return this.data.adminSettings.creditRates[method] || 1;
    }

    setCreditRate(method, rate) {
        if (!this.data.adminSettings) {
            this.data.adminSettings = { supportCost: 10, creditRates: { crypto: 0.01, bkash: 1, nagad: 1 } };
        }
        if (!this.data.adminSettings.creditRates) {
            this.data.adminSettings.creditRates = {};
        }
        this.data.adminSettings.creditRates[method] = rate;
        this.save();
    }

    // ==================== BACKUP & RESTORE ====================

    createBackup(isAuto = false) {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }

        // Clean old AUTO backups if isAuto is true
        if (isAuto) {
            try {
                const files = fs.readdirSync(backupDir).filter(f => f.startsWith('auto_backup_'));
                // Sort by time, newest first
                files.sort((a, b) => {
                    return fs.statSync(path.join(backupDir, b)).mtime.getTime() -
                        fs.statSync(path.join(backupDir, a)).mtime.getTime();
                });

                // Keep latest 1, delete rest
                if (files.length >= 1) {
                    files.slice(0).forEach(f => fs.unlinkSync(path.join(backupDir, f))); // Delete ALL old ones first, or keep 1? User said "old backup auto delete", implies only keeping the new one.
                    // Let's keep the logic simple: Delete ALL previous auto_backups before creating new one.
                    // Or maybe safer: create new one, then delete old ones.
                }
            } catch (e) {
                console.error("Error cleaning old backups:", e);
            }
        }

        const prefix = isAuto ? 'auto_backup_' : 'backup_';
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const backupFile = path.join(backupDir, `${prefix}${timestamp}.json`);

        // Create backup with all data
        fs.writeFileSync(backupFile, JSON.stringify(this.data, null, 2));

        // Cleanup old files logic (Post-creation cleanup to be safe)
        if (isAuto) {
            try {
                const files = fs.readdirSync(backupDir).filter(f => f.startsWith('auto_backup_') && f !== path.basename(backupFile));
                files.forEach(f => fs.unlinkSync(path.join(backupDir, f)));
            } catch (e) { }
        }

        return backupFile;
    }

    restoreBackup(backupFilePath) {
        if (!fs.existsSync(backupFilePath)) {
            return { success: false, msg: 'Backup file not found' };
        }

        try {
            const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf8'));
            this.data = backupData;
            this.save();
            return { success: true, msg: 'Backup restored successfully' };
        } catch (error) {
            return { success: false, msg: `Error: ${error.message}` };
        }
    }

    getBackupsList() {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            return [];
        }

        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
            .map(f => {
                const filePath = path.join(backupDir, f);
                const stats = fs.statSync(filePath);
                return {
                    name: f,
                    path: filePath,
                    size: stats.size,
                    created: stats.mtime
                };
            })
            .sort((a, b) => b.created - a.created);

        return files;
    }

    restoreBackup(backupPath) {
        try {
            if (!fs.existsSync(backupPath)) {
                return { success: false, msg: 'Backup file not found' };
            }

            const data = fs.readFileSync(backupPath, 'utf8');
            const parsed = JSON.parse(data);

            // Basic Validation
            if (!parsed.users || !parsed.settings) {
                return { success: false, msg: 'Invalid backup file structure' };
            }

            // Restore with MERGE (Keep new structures if missing in backup)
            // 1. Restore Users completely (Users data is critical)
            this.data.users = parsed.users;

            // 2. Restore Settings but merge with default settings to keep new features
            // If backup doesn't have 'groupRules', use existing/default ones.
            this.data.settings = { ...this.data.settings, ...parsed.settings };

            // Ensure groupRules exist even if backup didn't have them
            if (!this.data.settings.groupRules) {
                this.data.settings.groupRules = {
                    welcome: true, cleanService: true, allowLinks: false,
                    allowPhotos: true, allowFiles: true, allowVoice: true,
                    allowForward: true, blockEmails: true, blockCC: true
                };
            }

            // 3. Restore VPN and Cards independently if they exist, or keep defaults
            if (parsed.cards) this.data.cards = parsed.cards;
            if (parsed.cardPrices) this.data.cardPrices = parsed.cardPrices;

            if (parsed.vpnAccounts) this.data.vpnAccounts = parsed.vpnAccounts;
            else if (!this.data.vpnAccounts) this.data.vpnAccounts = defaultData.vpnAccounts; // Init if missing

            if (parsed.vpnPrices) this.data.vpnPrices = parsed.vpnPrices;
            else if (!this.data.vpnPrices) this.data.vpnPrices = defaultData.vpnPrices; // Init if missing

            if (parsed.vpnServiceNames) this.data.vpnServiceNames = parsed.vpnServiceNames;
            else if (!this.data.vpnServiceNames) this.data.vpnServiceNames = defaultData.vpnServiceNames; // Init if missing


            this.save();
            return { success: true };
        } catch (error) {
            console.error(error);
            return { success: false, msg: 'Restore failed: ' + error.message };
        }
    }

    // === NEW: DYNAMIC PAYMENT METHODS ===
    // Get full settings including paymentMethods


    // Add or Update Payment Method
    addPaymentMethod(key, details) {
        this.getSettings(); // Ensure initialized
        this.data.settings.paymentMethods[key] = details;
        this.save();
    }

    // Delete Payment Method
    deletePaymentMethod(key) {
        this.getSettings(); // Ensure initialized
        if (this.data.settings.paymentMethods[key]) {
            delete this.data.settings.paymentMethods[key];
            this.save();
            return true;
        }
        return false;
    }


    // ==================== GROUP CONTROLLER SYSTEM ====================

    getGroupSettings() {
        if (!this.data.settings.groupRules) {
            this.data.settings.groupRules = {
                welcome: true,          // Welcome new members
                cleanService: true,     // Delete joined/left messages
                allowLinks: false,      // Block links/mentions
                allowPhotos: true,      // Allow photos
                allowFiles: true,       // Allow files/documents
                allowVoice: true,       // Allow voice notes
                allowForward: true,      // Allow forwards
                blockEmails: true,      // Block Email addresses
                blockCC: true,          // Block Card numbers
                blockBusiness: true     // Block Buying/Selling keywords
            };
            this.save();
        }
        return this.data.settings.groupRules;
    }

    toggleGroupSetting(key) {
        const rules = this.getGroupSettings();
        if (rules.hasOwnProperty(key)) {
            rules[key] = !rules[key];
            this.save();
            return rules[key];
        }
        return null;
    }

    // Warning System for Links
    addWarning(chatId, userId) {
        if (!this.data.groupWarnings) this.data.groupWarnings = {};
        const key = `${chatId}_${userId}`;

        if (!this.data.groupWarnings[key]) this.data.groupWarnings[key] = 0;
        this.data.groupWarnings[key]++;

        this.save();
        return this.data.groupWarnings[key];
    }

    resetWarnings(chatId, userId) {
        if (!this.data.groupWarnings) return;
        const key = `${chatId}_${userId}`;
        delete this.data.groupWarnings[key];
        this.save();
    }

    // ==================== PREMIUM APPS ====================

    getPremiumApps() {
        if (!this.data.settings.premiumApps) {
            this.data.settings.premiumApps = {}; // { id: { name, link, addedAt } }
            this.save();
        }
        return this.data.settings.premiumApps;
    }

    addPremiumApp(id, name, link, price = 0) {
        this.getPremiumApps(); // Ensure init
        this.data.settings.premiumApps[id] = {
            id: id,
            name: name,
            link: link,
            price: parseInt(price),
            addedAt: Date.now()
        };
        this.save();
    }

    deletePremiumApp(id) {
        this.getPremiumApps();
        if (this.data.settings.premiumApps[id]) {
            delete this.data.settings.premiumApps[id];
            this.save();
            return true;
        }
        return false;
    }

    // ==================== PROMO CODE SYSTEM ====================

    createCode(code, amount, uses) {
        this.getSettings();
        if (!this.data.settings.codes) this.data.settings.codes = {};

        this.data.settings.codes[code] = {
            amount: amount,
            uses: uses,
            createdAt: Date.now(),
            redeemedBy: []
        };
        this.save();
    }

    deleteCode(code) {
        this.getSettings();
        if (this.data.settings.codes && this.data.settings.codes[code]) {
            delete this.data.settings.codes[code];
            this.save();
            return true;
        }
        return false;
    }

    redeemCode(userId, code) {
        this.getSettings();
        if (!this.data.settings.codes) return { success: false, msg: 'Invalid Code' };

        const promo = this.data.settings.codes[code];

        if (!promo) {
            return { success: false, msg: '❌ This promo code does not exist or has expired.' };
        }

        if (promo.uses <= 0) {
            // Auto-delete expired code
            delete this.data.settings.codes[code];
            this.save();
            return { success: false, msg: '❌ This promo code has expired and is no longer available.' };
        }

        if (!promo.redeemedBy) promo.redeemedBy = [];
        if (promo.redeemedBy.includes(userId)) {
            return { success: false, msg: 'You have already redeemed this code!' };
        }

        promo.uses--;
        promo.redeemedBy.push(userId);

        // Auto-delete code if uses reached 0
        if (promo.uses <= 0) {
            delete this.data.settings.codes[code];
            console.log(`[DB] Promo code ${code} auto-deleted (uses exhausted)`);
        }

        // Add Balance
        const newBalance = this.addCredit(userId, promo.amount);
        this.save();
        return { success: true, amount: promo.amount, msg: 'Redeemed Successfully' };
    }

    // ==================== VPN ACCOUNT SYSTEM (Card System Clone) ====================

    // Add VPN Account
    addVPN(service, vpnData) {
        if (!this.data.vpnAccounts) this.data.vpnAccounts = {};
        if (!this.data.vpnAccounts[service]) this.data.vpnAccounts[service] = [];

        this.data.vpnAccounts[service].push({
            email: vpnData.email,
            password: vpnData.password,
            addedAt: Date.now()
        });
        this.save();
    }

    // Get VPN Account (for purchase)
    getVPN(service) {
        if (!this.data.vpnAccounts || !this.data.vpnAccounts[service]) return null;
        if (this.data.vpnAccounts[service].length === 0) return null;

        // Remove and return first account
        const account = this.data.vpnAccounts[service].shift();

        // Check if stock is now empty - auto delete service and promo codes
        if (this.data.vpnAccounts[service].length === 0) {
            console.log(`[DB] VPN stock depleted for service: ${service}. Auto-deleting service and promo codes...`);

            // Delete associated promo codes
            if (this.data.settings && this.data.settings.codes) {
                const codesToDelete = Object.keys(this.data.settings.codes).filter(code => {
                    return code.toLowerCase().includes(service.toLowerCase());
                });

                codesToDelete.forEach(code => {
                    delete this.data.settings.codes[code];
                    console.log(`[DB] Deleted promo code: ${code}`);
                });
            }

            // Delete the VPN service completely
            this.deleteVPNService(service);
            console.log(`[DB] VPN Service ${service} auto-deleted due to zero stock`);
        }

        this.save();
        return account;
    }

    // Get VPN Stock Counts
    getVPNCounts() {
        const counts = {};
        const services = Object.keys(this.data.vpnAccounts || {});
        services.forEach(s => {
            counts[s] = this.data.vpnAccounts[s].length;
        });
        return counts;
    }

    // Clear VPN Stock
    clearVPNAccounts(service) {
        if (this.data.vpnAccounts && this.data.vpnAccounts[service]) {
            this.data.vpnAccounts[service] = [];
            this.save();
            return true;
        }
        return false;
    }

    // Get VPN Price
    getVPNPrice(service) {
        if (this.data.vpnPrices && this.data.vpnPrices[service]) return this.data.vpnPrices[service];
        return 100; // Default fallback
    }

    // Update VPN Price
    updateVPNPrice(service, price) {
        if (!this.data.vpnPrices) this.data.vpnPrices = {};
        this.data.vpnPrices[service] = parseInt(price);
        this.save();
    }

    // Set VPN Price (alias for updateVPNPrice)
    setVPNPrice(service, price) {
        this.updateVPNPrice(service, price);
    }

    // Get all VPN Services (Returns array like getServices())
    getVPNServices() {
        const fromPrices = Object.keys(this.data.vpnPrices || {});
        const fromStock = Object.keys(this.data.vpnAccounts || {});
        const fromNames = Object.keys(this.data.vpnServiceNames || {});

        // Merge all known service IDs
        const allIds = [...new Set([...fromPrices, ...fromStock, ...fromNames])];

        // Filter out empty or invalid IDs
        const validIds = allIds.filter(id => id && typeof id === 'string' && id.length > 0);

        return validIds.map(sid => {
            const stock = (this.data.vpnAccounts && this.data.vpnAccounts[sid]) ? this.data.vpnAccounts[sid].length : 0;
            const price = (this.data.vpnPrices && this.data.vpnPrices[sid]) ? this.data.vpnPrices[sid] : 100;
            const name = (this.data.vpnServiceNames && this.data.vpnServiceNames[sid]) ? this.data.vpnServiceNames[sid] : sid.toUpperCase();

            return { id: sid, name: name, price: price, stock: stock };
        });
    }

    // Create VPN Service
    createVPNService(id, name, price) {
        if (!this.data.vpnAccounts) this.data.vpnAccounts = {};
        if (!this.data.vpnServiceNames) this.data.vpnServiceNames = {};
        if (!this.data.vpnPrices) this.data.vpnPrices = {};

        if (!this.data.vpnAccounts[id]) this.data.vpnAccounts[id] = [];
        this.data.vpnServiceNames[id] = name;
        this.data.vpnPrices[id] = parseInt(price);
        this.save();
    }

    // Delete VPN Service
    deleteVPNService(id) {
        if (this.data.vpnAccounts && this.data.vpnAccounts[id]) delete this.data.vpnAccounts[id];
        if (this.data.vpnServiceNames && this.data.vpnServiceNames[id]) delete this.data.vpnServiceNames[id];
        if (this.data.vpnPrices && this.data.vpnPrices[id]) delete this.data.vpnPrices[id];
        this.save();
    }

    // Update VPN Service Name
    updateVPNName(id, name) {
        if (!this.data.vpnServiceNames) this.data.vpnServiceNames = {};
        this.data.vpnServiceNames[id] = name;
        this.save();
    }

    // Get VPN Service by ID
    getVPNService(id) {
        const services = this.getVPNServices();
        return services.find(s => s.id === id) || null;
    }

    // ==================== FEATURE FLAGS / BUTTON MANAGEMENT ====================

    getFeatureFlags() {
        if (!this.data.featureFlags) {
            // Initialize with defaults if not exists
            this.data.featureFlags = {
                admin_manage_user: true,
                admin_manage_cards: true,
                admin_manage_apps: true,
                admin_manage_vpn: true,
                admin_manage_codes: true,
                admin_manage_tasks: true,
                admin_manage_costs: true,
                admin_payments: true,
                admin_backup: true,
                admin_settings: true,
                admin_stats: true,
                admin_broadcast: true,
                admin_upload_file: true,
                admin_group_controller: true,
                buy_cards: true,
                buy_vpn: true,
                buy_premium_app: true,
                verification: true,
                support: true,
                referral: true,
                daily_bonus: true,
                tasks: true,
                transfer: true,
                redeem_code: true
            };
            this.save();
        }
        return this.data.featureFlags;
    }

    isFeatureEnabled(featureKey) {
        const flags = this.getFeatureFlags();
        return flags[featureKey] !== false; // Default to true if not set
    }

    toggleFeature(featureKey) {
        const flags = this.getFeatureFlags();
        if (flags.hasOwnProperty(featureKey)) {
            flags[featureKey] = !flags[featureKey];
            this.save();
            return flags[featureKey];
        }
        return null;
    }

    setFeatureState(featureKey, state) {
        const flags = this.getFeatureFlags();
        flags[featureKey] = !!state;
        this.save();
        return flags[featureKey];
    }

    // ==================== WEB PANEL AUTHENTICATION ====================

    createWebLoginToken(userId) {
        if (!this.data.webTokens) this.data.webTokens = {};

        // Clean expired tokens first
        const now = Date.now();
        Object.keys(this.data.webTokens).forEach(t => {
            if (this.data.webTokens[t].expires < now) {
                delete this.data.webTokens[t];
            }
        });

        // Generate simple random token
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        this.data.webTokens[token] = {
            userId: userId,
            expires: now + 60 * 60 * 1000 // 1 hour validity
        };

        this.save();
        return token;
    }

    verifyWebLoginToken(token) {
        if (!this.data.webTokens || !this.data.webTokens[token]) return null;

        const info = this.data.webTokens[token];
        if (Date.now() > info.expires) {
            delete this.data.webTokens[token];
            this.save();
            return null;
        }

        return this.getUser(info.userId);
    }

    // ==================== BACKUP MANAGEMENT ====================

    getBackupsList() {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, 'backups');

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            return [];
        }

        const files = fs.readdirSync(backupDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stat = fs.statSync(path.join(backupDir, f));
                return {
                    name: f,
                    path: path.join(backupDir, f),
                    created: stat.mtime,
                    size: stat.size
                };
            })
            .sort((a, b) => b.created - a.created);

        return files;
    }

    createBackup(auto = false) {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, 'backups');

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const prefix = auto ? 'auto_backup_' : 'backup_';
        const backupFile = path.join(backupDir, `${prefix}${timestamp}.json`);

        fs.writeFileSync(backupFile, JSON.stringify(this.data, null, 2));
        return backupFile;
    }

    deleteAllBackups() {
        const fs = require('fs');
        const path = require('path');
        const backupDir = path.join(__dirname, 'backups');

        if (fs.existsSync(backupDir)) {
            const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    fs.unlinkSync(path.join(backupDir, file));
                } catch (e) {
                    console.error('Failed to delete backup file:', file, e);
                }
            }
        }
    }

    restoreBackup(backupPath) {
        const fs = require('fs');

        try {
            if (!fs.existsSync(backupPath)) {
                return { success: false, msg: 'Backup file not found' };
            }

            const backupData = fs.readFileSync(backupPath, 'utf8');
            const parsed = JSON.parse(backupData);

            // Validate basic structure
            if (!parsed.users || !parsed.settings) {
                return { success: false, msg: 'Invalid backup file structure' };
            }

            this.data = parsed;
            this.save();

            return { success: true, msg: 'Backup restored successfully' };
        } catch (err) {
            return { success: false, msg: err.message };
        }
    }

    // ==================== APPS MANAGEMENT ====================
    getApps() {
        return this.data.apps || [];
    }

    createApp(name, price, description, type = 'account', content = '') {
        if (!this.data.apps) this.data.apps = [];
        const id = 'app_' + Date.now();
        const newApp = {
            id,
            name,
            price: parseInt(price),
            description,
            type, // 'account' or 'link'
            content, // URL if link
            stock: type === 'link' ? 9999 : 0,
            createdAt: new Date().toISOString()
        };
        this.data.apps.push(newApp);
        this.save();
        return newApp;
    }

    buyApp(userId, appId) {
        const user = this.getUser(userId);
        const app = (this.data.apps || []).find(a => a.id === appId);
        if (!app) return { success: false, error: 'App not found' };
        if (user.balance < app.price) return { success: false, error: 'Insufficient balance' };

        let deliveredContent = '';

        if (app.type === 'link') {
            deliveredContent = app.content;
        } else {
            if (!this.data.appStock || !this.data.appStock[appId] || this.data.appStock[appId].length === 0) {
                return { success: false, error: 'Out of stock' };
            }
            deliveredContent = this.data.appStock[appId].shift();
        }

        this.deductCredit(userId, app.price);
        if (!user.purchaseHistory) user.purchaseHistory = [];
        user.purchaseHistory.push({
            item: app.name,
            category: 'App',
            amount: app.price,
            date: new Date().toISOString(),
            details: deliveredContent,
            isLink: app.type === 'link'
        });

        this.save();
        return { success: true, content: deliveredContent, type: app.type };
    }

    // ==================== GEMS TOKEN SYSTEM ====================

    // ==================== WELCOME CREDITS ====================

    getWelcomeCredits() {
        if (!this.data.adminSettings) {
            this.data.adminSettings = { welcomeCredits: 50 };
        }
        return this.data.adminSettings.welcomeCredits || 50;
    }

    setWelcomeCredits(amount) {
        if (!this.data.adminSettings) {
            this.data.adminSettings = {};
        }
        this.data.adminSettings.welcomeCredits = parseInt(amount);
        this.save();
        return { success: true, welcomeCredits: this.data.adminSettings.welcomeCredits };
    }

    // ==================== MONETAG AD SDK SETTINGS ====================

    getAdSdkSettings() {
        if (!this.data.adminSettings) {
            this.data.adminSettings = {};
        }
        return {
            enabled: this.data.adminSettings.adSdkEnabled || false,
            sdkUrl: this.data.adminSettings.adSdkUrl || '',
            zoneId: this.data.adminSettings.adZoneId || '',
            sdkKey: this.data.adminSettings.adSdkKey || '',
            rewardAmount: this.data.adminSettings.adRewardAmount || 5
        };
    }

    setAdSdkSettings(settings) {
        if (!this.data.adminSettings) {
            this.data.adminSettings = {};
        }

        this.data.adminSettings.adSdkEnabled = settings.enabled || false;
        this.data.adminSettings.adSdkUrl = settings.sdkUrl || '';
        this.data.adminSettings.adZoneId = settings.zoneId || '';
        this.data.adminSettings.adSdkKey = settings.sdkKey || '';
        this.data.adminSettings.adRewardAmount = parseInt(settings.rewardAmount) || 5;

        this.save();
        return {
            success: true,
            settings: this.getAdSdkSettings()
        };
    }

    // Parse SDK link and extract zone ID and SDK key
    parseSdkLink(sdkLink) {
        // Extract from: <script src='//libtl.com/sdk.js' data-zone='9716370' data-sdk='show_9716370'></script>
        const zoneMatch = sdkLink.match(/data-zone=['"](\d+)['"]/);
        const sdkMatch = sdkLink.match(/data-sdk=['"]([^'"]+)['"]/);

        return {
            zoneId: zoneMatch ? zoneMatch[1] : '',
            sdkKey: sdkMatch ? sdkMatch[1] : '',
            sdkUrl: '//libtl.com/sdk.js'
        };
    }

    // ==================== GMAIL SYSTEM ====================

    getGmails() {
        return this.data.gmails || [];
    }

    addOAuthGmail(email, refreshToken, serviceId) {
        if (!this.data.gmails) this.data.gmails = [];

        // Check if exists
        const existing = this.data.gmails.find(g => g.email === email);
        if (existing) {
            existing.refreshToken = refreshToken; // Update token
            existing.oauth = true;
            existing.provider = 'google';
            if (serviceId) existing.service = serviceId; // Auto-assign service
            this.save();
            return;
        }

        const newGmail = {
            email: email,
            password: 'OAUTH-TOKEN-SECURE', // Placeholder
            refreshToken: refreshToken,
            oauth: true,
            provider: 'google',
            service: serviceId || null, // Auto-assign service
            addedAt: Date.now(),
            stockAdded: true
        };

        this.data.gmails.push(newGmail);
        this.save();
    }

    addGmail(email, password) {
        if (!this.data.gmails) this.data.gmails = [];
        this.data.gmails.push({
            email,
            password,
            otp: null,
            assignedTo: null,
            date: new Date().toISOString()
        });
        this.save();
        return true;
    }

    // Modifying this to check balance first would be circular here.
    // Instead we just return available account, bot handles balance check.
    getAvailableGmail(userId) {
        if (!this.data.gmails) return null;
        // Find one not assigned
        const account = this.data.gmails.find(g => !g.assignedTo);
        if (account) {
            account.assignedTo = userId;
            account.date = new Date().toISOString();
            this.save();
        }
        return account;
    }

    getGmailCost() {
        return this.data.adminSettings.gmailCost || 50;
    }

    setGmailCost(amount) {
        if (!this.data.adminSettings) this.data.adminSettings = {};
        this.data.adminSettings.gmailCost = amount;
        this.save();
    }

    getGmail(email) {
        if (!this.data.gmails) return null;
        return this.data.gmails.find(g => g.email === email);
    }

    // Get last gmail assigned to user
    getUserLastGmail(userId) {
        if (!this.data.gmails) return null;
        // Find last one assigned to this user
        // We'll search simply for any assigned to this user. Ideally sort by date.
        const userGmails = this.data.gmails.filter(g => String(g.assignedTo) === String(userId));
        if (userGmails.length === 0) return null;
        return userGmails[userGmails.length - 1]; // Return last one
    }

    updateGmailOtp(email, otp) {
        const account = this.getGmail(email);
        if (account) {
            account.otp = otp;
            account.otpTime = Date.now();
            this.save();
            return true;
        }
        return false;
    }

    deleteGmail(email) {
        if (!this.data.gmails) return false;
        const initial = this.data.gmails.length;
        this.data.gmails = this.data.gmails.filter(g => g.email !== email);
        this.save();
        return this.data.gmails.length < initial;
    }

    // ==================== GENERIC PROVIDER MANAGER ====================
    getProviders(showSecrets = false) {
        if (!this.data.providers) return {};
        if (showSecrets) return this.data.providers; // Use carefully (e.g. for backup)

        // Return Masked for UI
        const masked = {};
        Object.entries(this.data.providers).forEach(([id, p]) => {
            masked[id] = {
                ...p,
                apiKey: (p.apiKey ? '✅ Secret Set' : '❌ Missing'), // Masked Indicator
                apiKeyStatus: (p.apiKey ? true : false)
            };
        });
        return masked;
    }

    getProviderDecrypted(providerId) {
        if (!this.data.providers || !this.data.providers[providerId]) return null;
        const p = this.data.providers[providerId];
        // Decrypt logic relying on global 'decrypt' function we added earlier
        const rawKey = p.apiKey ? decrypt(p.apiKey) : null;
        return { ...p, apiKey: rawKey };
    }

    saveProvider(id, config) {
        if (!this.data.providers) this.data.providers = {};

        // Handle Key Encryption
        // Logic: If apiKey is provided and looks like plaintext (no ':'), encrypt it.
        // If apiKey is undefined/null/empty strings, keep existing if ID exists.

        // Get existing to preserve key if not updating
        const existing = this.data.providers[id] || {};

        let finalKey = existing.apiKey;

        if (config.apiKey && config.apiKey.length > 0 && config.apiKey !== '***') {
            // New key provided
            finalKey = encrypt(config.apiKey);
        }

        this.data.providers[id] = {
            ...config,
            apiKey: finalKey,
            updatedAt: Date.now()
        };
        this.save();
        return id;
    }

    deleteProvider(id) {
        if (this.data.providers && this.data.providers[id]) {
            delete this.data.providers[id];
            this.save();
            return true;
        }
        return false;
    }

    // ==================== AUTO CLEANUP SYSTEM ====================
    cleanupOldHistory(days = 7) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        let cleanedCount = 0;

        // 1. Clean User History (Purchase, etc.)
        Object.values(this.data.users).forEach(user => {
            // Purchase History
            if (user.purchaseHistory && user.purchaseHistory.length > 0) {
                const initial = user.purchaseHistory.length;
                user.purchaseHistory = user.purchaseHistory.filter(h => new Date(h.date).getTime() > cutoff);
                if (user.purchaseHistory.length < initial) cleanedCount++;
            }

            // Tasks Done (Optional: maybe keep tasks history longer? User said "history of what they buy/trade")
            // Not touching tasksDone for now as it tracks completion status.
        });

        // 2. Clean Global Payments
        if (this.data.payments) {
            const initial = this.data.payments.length;
            this.data.payments = this.data.payments.filter(p => p.createdAt > cutoff);
            if (this.data.payments.length < initial) cleanedCount++;
        }

        // 3. Clean Support Tickets (Closed ones older than 7 days)
        if (this.data.tickets) {
            this.data.tickets = this.data.tickets.filter(t => {
                return t.status !== 'closed' || t.createdAt > cutoff;
            });
        }

        if (cleanedCount > 0) {
            this.save();
            console.log(`[CLEANUP] Removed old history entries (> ${days} days)`);
        }
        return cleanedCount;
    }
}

module.exports = new Database();
