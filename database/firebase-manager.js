const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

class FirebaseManager {
    constructor() {
        this.db = null;
        this.connected = false;
    }

    async connect() {
        try {
            let serviceAccount = null;

            // 1. Try Environment Variable (Best for Render/VPS)
            if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                try {
                    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
                } catch (e) {
                    console.error('❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON format');
                }
            }

            // 2. Try Local Files (Fallback)
            if (!serviceAccount) {
                const paths = [
                    path.join(__dirname, '..', 'serviceAccountKey.json'),
                    path.join(__dirname, 'serviceAccountKey.json')
                ];

                for (const p of paths) {
                    if (fs.existsSync(p)) {
                        serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
                        break;
                    }
                }
            }

            if (!serviceAccount) {
                console.warn('⚠️ No Firebase credentials found (ENV or JSON)! Firebase connection skipped.');
                return false;
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
            });

            this.db = admin.database();
            this.connected = true;
            console.log('✅ Firebase Connected Successfully!');
            return true;
        } catch (error) {
            console.error('❌ Firebase Connection Error:', error.message);
            return false;
        }
    }

    // Get all data (Snapshot)
    async getData() {
        if (!this.connected) return null;
        try {
            const snapshot = await this.db.ref('/').once('value');
            return snapshot.val();
        } catch (error) {
            console.error('❌ Firebase Read Error:', error.message);
            return null;
        }
    }

    // Save all data (Overwrite) - Use sparingly!
    async setData(data) {
        if (!this.connected) return;
        try {
            await this.db.ref('/').set(data);
        } catch (error) {
            console.error('❌ Firebase Write Error:', error.message);
        }
    }

    // Update specific path
    async update(path, data) {
        if (!this.connected) return;
        try {
            await this.db.ref(path).update(data);
        } catch (error) {
            console.error('❌ Firebase Update Error:', error.message);
        }
    }
}

module.exports = new FirebaseManager();
