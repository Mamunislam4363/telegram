const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class GoogleDriveStorage {
    constructor() {
        this.drive = null;
        this.folderId = null;
        this.auth = null;
        this.connected = false;
        this.folderName = 'TelegramBotData';
        this.userInfo = null;
    }

    /**
     * Connect to Google Drive using credentials
     * @param {Object} credentials - OAuth2 client credentials
     */
    async connect(credentials) {
        try {
            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
            this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

            // Check if we have a saved token
            const tokenPath = path.join(__dirname, '..', 'drive-token.json');
            if (fs.existsSync(tokenPath)) {
                const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                this.auth.setCredentials(token);

                this.drive = google.drive({ version: 'v3', auth: this.auth });

                // Verify connection & get Folder ID
                await this._initFolder();

                // Get User Info
                const about = await this.drive.about.get({ fields: 'user' });
                this.userInfo = about.data.user;

                this.connected = true;
                return { success: true, message: 'Connected to Google Drive' };
            } else {
                return { success: false, message: 'Authentication required. No token found.' };
            }

        } catch (error) {
            console.error('Google Drive Connect Error:', error.message);
            return { success: false, message: error.message };
        }
    }

    /**
     * Disconnect
     */
    async disconnect() {
        this.drive = null;
        this.folderId = null;
        this.auth = null;
        this.connected = false;

        // Remove token file
        const tokenPath = path.join(__dirname, '..', 'drive-token.json');
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }

        return { success: true, message: 'Disconnected from Google Drive' };
    }

    /**
     * Initialize Data Folder
     */
    async _initFolder() {
        try {
            // Check if folder exists
            const res = await this.drive.files.list({
                q: `mimeType='application/vnd.google-apps.folder' and name='${this.folderName}' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (res.data.files.length > 0) {
                this.folderId = res.data.files[0].id;
                console.log(`📂 Found existing Drive folder: ${this.folderName} (${this.folderId})`);
            } else {
                // Create folder
                const fileMetadata = {
                    name: this.folderName,
                    mimeType: 'application/vnd.google-apps.folder'
                };
                const file = await this.drive.files.create({
                    resource: fileMetadata,
                    fields: 'id'
                });
                this.folderId = file.data.id;
                console.log(`📂 Created new Drive folder: ${this.folderName} (${this.folderId})`);
            }
        } catch (error) {
            console.error('Drive Folder Init Error:', error.message);
            throw error;
        }
    }

    /**
     * Save data to a JSON file in the folder
     */
    async saveData(filename, data) {
        if (!this.connected) return;

        try {
            const fileContent = JSON.stringify(data, null, 2);

            // Check if file exists
            const search = await this.drive.files.list({
                q: `name='${filename}' and '${this.folderId}' in parents and trashed=false`,
                fields: 'files(id, name)'
            });

            const fileMetadata = {
                name: filename,
                parents: [this.folderId]
            };

            const media = {
                mimeType: 'application/json',
                body: fileContent
            };

            if (search.data.files.length > 0) {
                // Update
                const fileId = search.data.files[0].id;
                await this.drive.files.update({
                    fileId: fileId,
                    media: media
                });
                // console.log(`💾 Updated ${filename} on Drive`);
            } else {
                // Create
                await this.drive.files.create({
                    resource: fileMetadata,
                    media: media,
                    fields: 'id'
                });
                console.log(`💾 Created ${filename} on Drive`);
            }
        } catch (error) {
            console.error(`Save to Drive Error (${filename}):`, error.message);
        }
    }

    /**
     * Load data from a JSON file in the folder
     */
    async loadData(filename) {
        if (!this.connected) return null;

        try {
            const search = await this.drive.files.list({
                q: `name='${filename}' and '${this.folderId}' in parents and trashed=false`,
                fields: 'files(id, name)'
            });

            if (search.data.files.length > 0) {
                const fileId = search.data.files[0].id;
                const response = await this.drive.files.get({
                    fileId: fileId,
                    alt: 'media'
                });
                return response.data;
            }
            return null; // Not found
        } catch (error) {
            console.error(`Load from Drive Error (${filename}):`, error.message);
            return null;
        }
    }

    /**
     * Get Storage Info (Quota)
     */
    async getStorageInfo() {
        if (!this.connected) return { total: 0, used: 0, free: 0, user: 'Unknown' };

        try {
            const about = await this.drive.about.get({ fields: 'storageQuota,user' });
            const quota = about.data.storageQuota;

            return {
                total: parseInt(quota.limit) || 0,
                used: parseInt(quota.usage) || 0,
                free: (parseInt(quota.limit) - parseInt(quota.usage)) || 0,
                user: about.data.user.emailAddress
            };
        } catch (error) {
            console.error('Get Drive Info Error:', error.message);
            return { total: 0, used: 0, free: 0, user: 'Unknown' };
        }
    }

    /**
     * Migrate local DB file to Drive
     */
    async migrateFromLocal(localDbPath) {
        if (!this.connected) return { success: false, message: 'Drive not connected' };

        try {
            if (fs.existsSync(localDbPath)) {
                const raw = fs.readFileSync(localDbPath, 'utf8');
                const data = JSON.parse(raw);

                // Split into multiple files for better performance
                if (data.users) await this.saveData('users.json', data.users);
                if (data.emailServices) await this.saveData('services.json', data.emailServices);
                if (data.gmails) await this.saveData('gmails.json', data.gmails);
                if (data.settings) await this.saveData('settings.json', data.settings);
                if (data.promoCodes) await this.saveData('promo_codes.json', data.promoCodes);

                return { success: true, message: 'Migration successful' };
            }
            return { success: false, message: 'Local DB not found' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }
}

module.exports = new GoogleDriveStorage();
