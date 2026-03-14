/**
 * UNIFIED DATABASE WRAPPER
 * Automatically routes to Google Drive or Local Storage
 * Based on connection status
 */

const localDb = require('../db');
const googleDriveStorage = require('./google-drive-storage');

class UnifiedDatabase {
    constructor() {
        this.storageType = 'local'; // 'local' or 'google_drive'
        this._tryAutoConnect();
    }

    async _tryAutoConnect() {
        try {
            const fs = require('fs');
            const path = require('path');
            const credPath = path.join(__dirname, '..', 'drive-credentials.json');

            if (fs.existsSync(credPath)) {
                console.log('🔄 Found Google Drive credentials, connecting...');
                const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
                const result = await this.connectGoogleDrive(credentials);
                if (result.success) {
                    console.log('✅ Auto-connected to Google Drive');
                } else {
                    console.error('❌ Failed to auto-connect to Drive:', result.message);
                }
            }
        } catch (e) {
            console.error('Auto-connect error:', e.message);
        }
    }

    /**
     * Connect to Google Drive
     */
    async connectGoogleDrive(credentials) {
        const result = await googleDriveStorage.connect(credentials);
        if (result.success) {
            this.storageType = 'google_drive';
        }
        return result;
    }

    /**
     * Disconnect from Google Drive
     */
    async disconnectGoogleDrive() {
        const result = await googleDriveStorage.disconnect();
        if (result.success) {
            this.storageType = 'local';
        }
        return result;
    }

    /**
     * Migrate data from local to Google Drive
     */
    async migrateToGoogleDrive() {
        if (this.storageType !== 'google_drive') {
            throw new Error('Google Drive not connected');
        }

        // Get local database path
        const dbPath = require('path').join(__dirname, '..', 'database.json');

        // Migrate
        const result = await googleDriveStorage.migrateFromLocal(dbPath);

        if (result.success) {
            // Clear local database after successful migration
            await this.clearLocalDatabase();
        }

        return result;
    }

    /**
     * Clear local database (keep only minimal config)
     */
    async clearLocalDatabase() {
        const fs = require('fs').promises;
        const dbPath = require('path').join(__dirname, '..', 'database.json');

        // Keep minimal structure
        const minimalDb = {
            users: {},
            emailServices: {},
            gmails: [],
            settings: localDb.getSettings(),
            promoCodes: {},
            migrated: true,
            migratedAt: Date.now()
        };

        await fs.writeFile(dbPath, JSON.stringify(minimalDb, null, 2));
    }

    /**
     * Get users (from active storage)
     */
    async getUsers() {
        if (this.storageType === 'google_drive') {
            const data = await googleDriveStorage.loadData('users.json');
            return data || {};
        } else {
            return localDb.getUsers();
        }
    }

    /**
     * Get user by ID
     */
    async getUser(userId) {
        const users = await this.getUsers();
        return users[userId] || null;
    }

    /**
     * Save user
     */
    async saveUser(userId, userData) {
        if (this.storageType === 'google_drive') {
            const users = await this.getUsers();
            users[userId] = userData;
            await googleDriveStorage.saveData('users.json', users);
        } else {
            localDb.getUsers()[userId] = userData;
            localDb.save();
        }
    }

    /**
     * Get services
     */
    async getServices() {
        if (this.storageType === 'google_drive') {
            const data = await googleDriveStorage.loadData('services.json');
            return data || {};
        } else {
            return localDb.getEmailServices();
        }
    }

    /**
     * Save service
     */
    async saveService(serviceId, serviceData) {
        if (this.storageType === 'google_drive') {
            const services = await this.getServices();
            services[serviceId] = serviceData;
            await googleDriveStorage.saveData('services.json', services);
        } else {
            localDb.getEmailServices()[serviceId] = serviceData;
            localDb.save();
        }
    }

    /**
     * Get gmails
     */
    async getGmails() {
        if (this.storageType === 'google_drive') {
            const data = await googleDriveStorage.loadData('gmails.json');
            return data || [];
        } else {
            return localDb.getGmails();
        }
    }

    /**
     * Add gmail
     */
    async addGmail(gmailData) {
        if (this.storageType === 'google_drive') {
            const gmails = await this.getGmails();
            gmails.push(gmailData);
            await googleDriveStorage.saveData('gmails.json', gmails);
        } else {
            localDb.getGmails().push(gmailData);
            localDb.save();
        }
    }

    /**
     * Get settings
     */
    async getSettings() {
        if (this.storageType === 'google_drive') {
            const data = await googleDriveStorage.loadData('settings.json');
            return data || {};
        } else {
            return localDb.getSettings();
        }
    }

    /**
     * Update settings
     */
    async updateSettings(updates) {
        if (this.storageType === 'google_drive') {
            const settings = await this.getSettings();
            Object.assign(settings, updates);
            await googleDriveStorage.saveData('settings.json', settings);
        } else {
            Object.assign(localDb.getSettings(), updates);
            localDb.save();
        }
    }

    /**
     * Create promo code
     */
    async createCode(code, amount, maxUses) {
        if (this.storageType === 'google_drive') {
            const settings = await this.getSettings();
            if (!settings.codes) settings.codes = {};
            settings.codes[code] = {
                amount: amount,
                maxUses: maxUses,
                used: 0,
                createdAt: Date.now()
            };
            await googleDriveStorage.saveData('settings.json', settings);
        } else {
            localDb.createCode(code, amount, maxUses);
        }
    }

    /**
     * Delete promo code
     */
    async deleteCode(code) {
        if (this.storageType === 'google_drive') {
            const settings = await this.getSettings();
            if (settings.codes && settings.codes[code]) {
                delete settings.codes[code];
                await googleDriveStorage.saveData('settings.json', settings);
                return true;
            }
            return false;
        } else {
            return localDb.deleteCode(code);
        }
    }

    /**
     * Get storage status
     */
    async getStorageStatus() {
        if (this.storageType === 'google_drive') {
            const info = await googleDriveStorage.getStorageInfo();
            return {
                type: 'Google Drive',
                connected: true,
                total: this._formatBytes(info.total),
                used: this._formatBytes(info.used),
                free: this._formatBytes(info.free),
                user: info.user
            };
        } else {
            const fs = require('fs');
            const dbPath = require('path').join(__dirname, '..', 'database.json');
            let size = 0;
            if (fs.existsSync(dbPath)) {
                size = fs.statSync(dbPath).size;
            }

            return {
                type: 'Local Storage',
                connected: false,
                size: this._formatBytes(size),
                path: dbPath
            };
        }
    }

    /**
     * Format bytes to human readable
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Is using Google Drive?
     */
    isUsingGoogleDrive() {
        return this.storageType === 'google_drive';
    }

    /**
     * Get current storage type
     */
    getStorageType() {
        return this.storageType;
    }

    /**
     * Get token balance from user object
     */
    getTokenBalance(user) {
        if (!user) return 0;
        if (user.tokens !== undefined) return user.tokens;
        if (user.balance_tokens !== undefined) return user.balance_tokens;
        return user.balance || 0;
    }

    /**
     * Set token balance (keeps all fields in sync)
     */
    setTokenBalance(user, amount) {
        if (!user) return;
        const val = Math.max(0, Math.round(amount));
        user.tokens = val;
        user.balance_tokens = val;
        user.balance = val;
    }
}

module.exports = new UnifiedDatabase();
