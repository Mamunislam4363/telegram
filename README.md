# 🤖 AutosVerify Telegram Bot

A powerful Telegram Verification Bot with an integrated Web Admin Panel, Google Drive backup, and Firebase Realtime Database persistence.

## 🚀 Features

- **Verification System**: Automated SheerID verification for Spotify, YouTube, Gemini, and more.
- **Document Generation**: Automated generation of student cards and payslips using Puppeteer.
- **Email System**: Integrated Temp Mail and Service Mail (SmtpLabs).
- **Payment & Credits**: Built-in credit system with USDT TRC20 payment support.
- **Admin Panel**: Web-based dashboard to manage users, settings, and view logs.
- **Persistence**: Hybrid storage using Firebase (Realtime Database) and Google Drive backups.
- **Dockerized**: Easy deployment using Docker and Docker Compose.

## 🛠️ Setup & Installation

### 1. Prerequisites
- Node.js (v20+)
- Docker & Docker Compose (optional, for containerized setup)
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Firebase Project (for database storage)
- Google Cloud Project (for Drive backups and Gmail OAuth)

### 2. Environment Variables (`.env`)
Create a `.env` file in the root directory:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_id
ALLOWED_USER_IDS=id1,id2
PUBLIC_URL=https://autosverifybot-production.up.railway.app/
FIREBASE_SERVICE_ACCOUNT={"type": "service_account", ...} # Paste full JSON here
GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
SMTPLABS_API_KEY=your_key
USDT_ADDRESS=your_trc20_address
TZ=Asia/Dhaka
```

### 3. Running with Docker (Recommended)
```bash
# Build and start the container
docker-compose up -d --build
```

### 4. Running Locally
```bash
# Install dependencies
npm install

# Start the bot
npm start
```

## 📂 Project Structure

- `bot.js`: Main Telegram bot logic.
- `database/server.js`: Web server and Admin Panel API.
- `database/firebase-manager.js`: Firebase connectivity.
- `database/google-drive-storage.js`: Google Drive integration.
- `services/generator.js`: Document (PDF/PNG) generation service.
- `web/`: Frontend files for the User and Admin panels.

## 🔗 OAuth Setup (Google Drive/Gmail)
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Configure **OAuth Consent Screen**.
3. Create **OAuth 2.0 Client ID** (Web application).
4. Add **Authorized Redirect URI**:
   `https://autosverifybot-production.up.railway.app/auth/google/callback`

## 📄 License
MIT License. Created by Mamun Islam.
