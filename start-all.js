/**
 * Combined startup script for Railway
 * Starts both: Web Server + Telegram Bot
 */
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting AutoVerify Bot Services...\n');

// Start Web Server
const server = spawn('node', ['database/server.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

console.log('✅ Web Server starting on port (from env or 3000)...\n');

// Start Bot (after short delay to let server initialize)
setTimeout(() => {
    const bot = spawn('node', ['bot.js'], {
        stdio: 'inherit',
        cwd: __dirname
    });

    console.log('✅ Telegram Bot starting...\n');

    // Handle bot crash
    bot.on('exit', (code) => {
        console.error(`⚠️ Bot exited with code ${code}`);
        console.log('🔄 Restarting bot in 5 seconds...');
        setTimeout(() => {
            spawn('node', ['bot.js'], { stdio: 'inherit', cwd: __dirname });
        }, 5000);
    });
}, 3000);

// Handle server crash
server.on('exit', (code) => {
    console.error(`⚠️ Server exited with code ${code}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down services...');
    server.kill();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down services...');
    server.kill();
    process.exit(0);
});
