const db = require('../db');
const driveStorage = require('./google-drive-storage');
const fs = require('fs');
const path = require('path');

// Configuration
const BACKUP_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 Hours

class BackupScheduler {
    constructor() {
        this.timer = null;
        this.isBackupRunning = false;
    }

    start() {
        console.log(`⏰ Backup Scheduler Started: Running every 5 hours.`);

        // Schedule Interval
        this.timer = setInterval(() => {
            this.performBackup();
        }, BACKUP_INTERVAL_MS);

        // Run immediately on start (after 10s delay to let everything settle)
        setTimeout(() => this.performBackup(), 10000);
    }

    async performBackup() {
        if (this.isBackupRunning) return;
        this.isBackupRunning = true;

        console.log("📦 Starting Scheduled Google Drive Backup...");

        try {
            // Check Drive Connection (Reconnect if needed)
            if (!driveStorage.connected) {
                // Try to reconnect using stored credentials
                const credPath = path.join(__dirname, '..', 'drive-credentials.json');
                if (fs.existsSync(credPath)) {
                    try {
                        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
                        await driveStorage.connect(creds);
                    } catch (e) {
                        console.warn("⚠️ Drive Config Error:", e.message);
                    }
                } else {
                    console.warn("⚠️ Drive Backup Skipped: No credentials found (drive-credentials.json).");
                    this.isBackupRunning = false;
                    return;
                }
            }

            if (!driveStorage.connected) {
                console.warn("❌ Drive Backup Failed: Could not connect to Google Drive.");
                this.isBackupRunning = false;
                return;
            }

            // 1. Prepare Data
            // Use current state from memory (synced with Firebase)
            const backupPayload = {
                metadata: {
                    timestamp: Date.now(),
                    date: new Date().toISOString(),
                    type: 'full_backup_auto',
                    userCount: Object.keys(db.data.users || {}).length
                },
                data: db.data
            };

            // 2. Upload New Backup
            // Unique name for upload first
            const newFileBaseName = `bot_backup_${Date.now()}`;
            const fileName = `${newFileBaseName}.json`;
            const uploadResult = await driveStorage.saveData(fileName, backupPayload);

            if (uploadResult.success) {
                console.log(`✅ Backup Uploaded Successfully: ${fileName}`);

                // 3. Retention Policy: Keep ONLY 2 MOST RECENT (Delete older backups)
                const files = await driveStorage.listFiles();
                if (files && files.length > 0) {
                    // Filter for backup files (our naming convention)
                    // We look for files starting with 'bot_backup_'
                    const backups = files.filter(f => f.name.startsWith('bot_backup_'));

                    if (backups.length > 2) {
                        // Sort by name (which includes timestamp) - oldest first
                        backups.sort((a, b) => a.name.localeCompare(b.name));

                        // Delete all except the 2 most recent
                        const filesToDelete = backups.slice(0, backups.length - 2);
                        console.log(`🧹 Cleaning up ${filesToDelete.length} old backups (keeping 2 most recent)...`);

                        for (const oldFile of filesToDelete) {
                            await driveStorage.deleteFile(oldFile.name);
                            console.log(`   🗑️ Deleted Old Backup: ${oldFile.name}`);
                        }
                    }
                }
            } else {
                console.error("❌ Backup Upload Failed:", uploadResult.message);
            }

        } catch (error) {
            console.error("❌ Backup System Error:", error.message);
        } finally {
            this.isBackupRunning = false;
        }
    }
}

module.exports = new BackupScheduler();
