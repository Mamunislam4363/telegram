// Helper: Check if userId is valid before making API calls
function isValidUserId(userId) {
    if (!userId) return false;
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    return !isNaN(numericId) && numericId > 0;
}

// Success modal for code redemption
function showRedeemSuccessModal(rewardAmount) {
    // Create modal if doesn't exist
    let modal = document.getElementById('redeem-success-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'redeem-success-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        modal.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                border: 2px solid #22c55e;
                border-radius: 20px;
                padding: 40px 30px;
                text-align: center;
                transform: scale(0.8);
                transition: transform 0.3s ease;
                max-width: 280px;
                width: 90%;
            ">
                <div style="
                    width: 80px;
                    height: 80px;
                    background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto 20px;
                    animation: checkmarkPop 0.5s ease;
                ">
                    <i class="fas fa-check" style="font-size: 40px; color: white;"></i>
                </div>
                <h3 style="color: #22c55e; font-size: 24px; margin: 0 0 10px 0; font-weight: 700;">Successful!</h3>
                <p style="color: #fff; font-size: 16px; margin: 0 0 8px 0;">You received</p>
                <p style="color: #22c55e; font-size: 32px; margin: 0 0 20px 0; font-weight: 800;">+${typeof formatCompact === 'function' ? formatCompact(rewardAmount) : rewardAmount} Tokens</p>
                <button onclick="closeRedeemModal()" style="
                    background: #22c55e;
                    color: white;
                    border: none;
                    padding: 12px 30px;
                    border-radius: 25px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    width: 100%;
                ">OK</button>
            </div>
        `;
        document.body.appendChild(modal);

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes checkmarkPop {
                0% { transform: scale(0); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }

    // Update reward amount
    const rewardEl = modal.querySelector('p:nth-of-type(2)');
    if (rewardEl) rewardEl.textContent = `+${rewardAmount} Tokens`;

    // Show modal
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.querySelector('div').style.transform = 'scale(1)';
    }, 10);

    // Auto close after 3 seconds
    setTimeout(() => {
        closeRedeemModal();
    }, 3000);
}

function closeRedeemModal() {
    const modal = document.getElementById('redeem-success-modal');
    if (modal) {
        modal.style.opacity = '0';
        modal.querySelector('div').style.transform = 'scale(0.8)';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

function openPremiumGmailDirect() {
    openPremiumMailDirect();
}

// Fallback showToast in case it's not defined yet (prevents blank screen errors)
if (typeof window.showToast !== 'function') {
    window.showToast = function (message, duration = 3000) {
        // Create toast element if it doesn't exist
        let toast = document.getElementById('global-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'global-toast';
            toast.style.cssText = `
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.85);
                color: #fff;
                padding: 12px 24px;
                border-radius: 24px;
                font-size: 14px;
                z-index: 9999;
                text-align: center;
                max-width: 80%;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1);
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                transition: opacity 0.3s, transform 0.3s;
                opacity: 0;
                pointer-events: none;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
        }, duration);
    };
}

// Wrapper for fetch that blocks invalid userId calls
function apiFetch(url, options = {}) {
    let body = {};
    try {
        if (options.body) {
            if (typeof options.body === 'string') {
                body = JSON.parse(options.body);
            } else {
                body = options.body;
                options.body = JSON.stringify(options.body);
            }
        }
    } catch (e) {
        body = {};
    }

    // Ultimate userId discovery
    const userId = body.userId ||
        userData.id ||
        (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) ||
        null;

    if (!userId) {
        console.warn('[apiFetch] Blocked: No userId discovered');
        return Promise.resolve({
            json: () => Promise.resolve({ success: false, message: 'Auth Error: No User ID' }),
            ok: false
        });
    }

    // Auto-inject headers
    options.headers = options.headers || {};
    if (!options.headers['X-User-Id'] && !options.headers['x-user-id']) {
        options.headers['X-User-Id'] = String(userId);
    }

    // Auto-inject Content-Type for requests with body
    if (options.body && !options.headers['Content-Type'] && !options.headers['content-type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    return fetch(url, options).catch(err => {
        console.error('Fetch error:', err);
        return {
            json: () => Promise.resolve({ success: false, message: 'Network error. Please check your internet connection.' }),
            ok: false
        };
    });
}
var tg = window.Telegram?.WebApp || {
    initDataUnsafe: { user: null, start_param: '' },
    ready: () => { },
    expand: () => { },
    HapticFeedback: {
        impactOccurred: (s) => { },
        notificationOccurred: (s) => { }
    },
    showAlert: (msg) => window.showToast(msg),
    showConfirm: (msg, cb) => cb((function () { return true; })(msg)),
    showAlert: (params, cb) => { const r = (function () { return true; })(params.title + '\n' + params.message); if (cb && r) cb(params.buttons[0].id); },
    BackButton: { show: () => { }, hide: () => { }, onClick: () => { } },
    close: () => { }
};
tg.ready();
tg.expand();

// REAL-TIME UPDATES - Poll for admin-pushed version changes (every 30s)
let currentSystemVersion = 0;
setInterval(async () => {
    try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json();
        if (d.version) {
            if (currentSystemVersion && d.version > currentSystemVersion) {
                console.log('[VERSION] New server version detected, reloading...');
                window.location.reload();
            }
            currentSystemVersion = d.version;
        }
    } catch(e) {}
}, 30000);


if (tg.BackButton && tg.BackButton.onClick) {
    tg.BackButton.onClick(goBack);
}

// Global fetch override to handle network errors gracefully
const originalFetch = window.fetch;
window.fetch = function () {
    return originalFetch.apply(this, arguments).catch(err => {
        console.error('Global Fetch error:', err);
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'Network error', 
            message: 'Network error. Please check your internet connection.' 
        }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
        });
    });
};

// Extract Telegram user from WebApp
const _rawTgUser = tg.initDataUnsafe?.user || {};
const _tgUser = _rawTgUser.id ? _rawTgUser : { id: '123', first_name: 'Test', username: 'TestUser' };
const _startParam = tg.initDataUnsafe?.start_param || '';

// APP CONFIG
var appConfig = {
    dailyReward: 10,
    dailyGems: 0,
    inviteBonus: 50,
    inviteGems: 0,
    welcomeBonus: 100
};

// EMAIL SERVICE CONFIG
var emailServiceConfig = {
    emailServiceEnabled: true,
    tempMailEnabled: true
};

const DEMO_MODE = false;
const DEMO_BALANCE = 0;

var currentPage = 'home';
var historyStack = ['home'];
var pageScrollPositions = {};
var userStatus = 'active';

// GLOBAL USER STATE - populated from Telegram + Server
const isDemoMode = false;

var userData = {
    id: _tgUser.id,
    username: _tgUser.first_name || _tgUser.username || 'User',
    firstName: _tgUser.first_name || 'User',
    lastName: _tgUser.last_name || '',
    photo_url: _tgUser.photo_url || '',
    tokens: 0,
    Gems: 0,
    usd: 0.00,
    verified: true,
    banned: false, // Track banned status
    dailyStreak: 0,
    lastDailyClaim: 0,
    completedTasks: [],
    history: []
};

// FEATURE FLAGS (Button Management)
var featureFlags = null;
function applyFeatureFlagsToHome() {
    const mappings = [
        { key: 'home_verify', selector: '[onclick="nav(\'verify\')"]' },
        { key: 'home_mail', selector: '[onclick="nav(\'emailMenu\')"]' },
        { key: 'home_number', selector: '[onclick="nav(\'numberService\')"]' },
        { key: 'home_accountsShop', selector: '[onclick="nav(\'itemSell\')"]' },
        { key: 'home_videoDownload', selector: '[onclick="nav(\'videoDownload\')"]' },
        { key: 'home_aiPhoto', selector: '[onclick="nav(\'aiPhotoGenerator\')"]' },
        { key: 'home_aiVideo', selector: '[onclick="nav(\'aiVideoGenerator\')"]' },
        { key: 'home_bgRemover', selector: '[onclick="nav(\'bgRemover\')"]' },
        { key: 'dailyCheckin', selector: '[onclick="nav(\'daily\')"]' },
        { key: 'tasksSystem', selector: '[onclick="nav(\'tasks\')"]' },
        { key: 'referralSystem', selector: '[onclick="nav(\'invite\')"]' },
        { key: 'exchange', selector: '[onclick="nav(\'earnMenuPage\')"]' },
        { key: 'home_vpn', selector: '[onclick="nav(\'vpnServices\')"]' },
        { key: 'home_vcc', selector: '[onclick="nav(\'vccCards\')"]' },
        { key: 'home_accounts', selector: '[onclick="nav(\'services\')"]' },
        { key: 'home_gemini', selector: '[onclick="nav(\'geminiVerification\')"]' }
    ];
    mappings.forEach(item => {
        const els = document.querySelectorAll(item.selector);
        els.forEach(el => {
            const enabled = !featureFlags || featureFlags[item.key] !== false;
            el.style.display = enabled ? '' : 'none';
        });
    });
}

function loadFeatureFlags() {
    return fetch('/api/features')
        .then(r => r.json())
        .then(data => {
            if (data && data.success && data.features) {
                featureFlags = data.features;
                applyFeatureFlagsToHome();
            }
            return featureFlags;
        })
        .catch(() => featureFlags);
}

function ensureFeatureFlagsLoaded() {
    if (featureFlags && (Date.now() - (window._lastFeatureFlagsLoad || 0) < 60000)) return Promise.resolve(featureFlags);
    return loadFeatureFlags();
}

function checkFeatureOrComingSoon(flagKey, title) {
    // Default enabled when flags not loaded
    const enabled = !featureFlags || featureFlags[flagKey] !== false;
    if (enabled) return true;
    // Use showAlert instead of showPopup for v6.0 compatibility
    if (tg && typeof window.showToast === 'function') {
        window.showToast('⏳ Coming soon: ' + (title || 'This feature') + ' is currently disabled by admin.');
    }
    return false;
}

// Show profile photo immediately from Telegram data
function applyProfilePhoto(photoUrl) {
    const isMale = Math.random() > 0.5;
    const boyUrl = 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?q=80&w=200&auto=format&fit=crop';
    const girlUrl = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=200&auto=format&fit=crop';

    // Default high-quality avatars if no photo provided
    const fallback = isMale ? boyUrl : girlUrl;
    const src = (photoUrl && photoUrl.trim()) ? photoUrl : fallback;

    const selectors = ['#home-avatar', '#profile-avatar-img', '.wc-avatar', '.prof-avatar', '.pui-avatar'];
    selectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (el.tagName === 'IMG') {
                el.src = src;
                el.onerror = function () { this.src = fallback; };
            } else if (el.style !== undefined) {
                el.style.backgroundImage = `url('${src}')`;
            }
        });
    });
}

// Utility: Upload Deposit Screenshot
async function uploadDepositScreenshot(input, targetId) {
    const file = input.files[0];
    if (!file) return;

    const targetInput = document.getElementById(targetId);
    if (!targetInput) return;
    const originalPlaceholder = targetInput.placeholder;
    targetInput.value = 'Uploading...';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload/screenshot', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            targetInput.value = data.url;
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        } else {
            if (typeof window.showToast === 'function') window.showToast('Upload failed: ' + data.message);
            targetInput.value = '';
        }
    } catch (e) {
        if (typeof window.showToast === 'function') window.showToast('Upload failed: Network error');
        targetInput.value = '';
    } finally {
        input.value = '';
    }
}

function copyText(text, btnElement) {
    if (!text) return;

    // Copy with fallback
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopyTextToClipboard(text));
    } else {
        fallbackCopyTextToClipboard(text);
    }

    function fallbackCopyTextToClipboard(text) {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "absolute";
        ta.style.left = "-999999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand("copy"); } catch (err) { }
        document.body.removeChild(ta);
    }

    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
        Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }

    if (btnElement) {
        const icon = btnElement.querySelector('i');
        if (icon) {
            const originalClass = icon.className;
            const originalStyle = icon.style.color;
            icon.className = 'fas fa-check';
            icon.style.color = '#22c55e';
            setTimeout(() => {
                icon.className = originalClass;
                icon.style.color = originalStyle;
            }, 2000);
        }
    }
}



// THEME MANAGEMENT
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    updateThemeIcon(newTheme);

    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('.sh-btn i.fa-sun, .sh-btn i.fa-moon');
    if (icon) {
        icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }
}

// HEADER INTERACTION
let adminClickCount = 0;
let adminClickTimer;

function handleHeaderClick() {
    // Admin Access Simulation (Tap 5 times on Header)
    adminClickCount++;
    clearTimeout(adminClickTimer);

    if (adminClickCount >= 5) {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        window.showToast('Entering Admin Panel...');
        // Directly show admin page
        showPage('admin');
        adminClickCount = 0;
        return;
    }

    adminClickTimer = setTimeout(() => {
        adminClickCount = 0;
    }, 1000);

    // Normal Navigation
    const homePage = document.getElementById('homePage');
    const isHome = homePage ? homePage.style.display !== 'none' : false;

    if (isHome) {
        nav('profile');
    } else {
        goBack();
    }
}

// NAVIGATION
function nav(p) {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

    // --- START PROGRESS BAR ---
    startLoading();

    // Feature gating (pre-check)
    // Note: if flags aren't loaded yet, we allow navigation and will re-check inside showPage.
    if (p === 'mailService' && !checkFeatureOrComingSoon('tempMail', 'Temp Mail')) return;
    if (p === 'numberService' && !checkFeatureOrComingSoon('virtualNumber', 'Virtual Number')) return;
    if (p === 'premiumMail' && !checkFeatureOrComingSoon('premiumMail', 'Premium Mail')) return;
    // if (p === 'accountsStore' && !checkFeatureOrComingSoon('accountsShop', 'Accounts Shop')) return;
    if (p === 'vccCards' && !checkFeatureOrComingSoon('cardsVcc', 'Cards / VCC')) return;

    // Save current scroll position before navigating away
    try {
        const mainScroll = document.getElementById('mainScroll');
        if (mainScroll && currentPage) {
            pageScrollPositions[currentPage] = mainScroll.scrollTop;
        }
    } catch (e) { }

    // BAN CHECK - Show ban modal if user is banned
    if (checkBanStatus()) {
        return;
    }

    // Always push to history stack
    historyStack.push(p);

    // All navigation now goes through showPage
    showPage(p);
}

const PAGE_TITLES = {
    'home': 'AUTOVERIFY',
    'tasks': 'TASKS',
    'earn': 'EARN REWARDS',
    'earnMenu': 'EARN REWARDS',
    'invite': 'INVITE',
    'profile': 'PROFILE',
    'shop': 'SHOP',
    'services': 'SERVICES',
    'numberService': 'VIRTUAL NUMBER',
    'mailService': 'TEMP EMAIL',
    'premiumMail': 'PREMIUM EMAIL',
    'emailMenu': 'EMAIL',
    'emailMessage': 'MESSAGE',
    'emailService': 'EMAIL SERVICE',
    'vccCards': 'VCC CARDS',
    'vpnServices': 'VPN SERVICES',
    'admin': 'ADMIN PANEL',
    'history': 'HISTORY',
    'notifications': 'NOTIFICATIONS',
    'leaderboard': 'LEADERBOARD',
    'earnedLeaderboard': 'LEADERBOARD',
    'referralLeaderboard': 'LEADERBOARD',
    'daily': 'DAILY BONUS',
    'verify': 'VERIFICATION',
    'geminiVerification': 'GEMINI VERIFY',
    'deposit': 'DEPOSIT',
    'exchange': 'EXCHANGE',
    'binancePay': 'BINANCE PAY',
    'faucetPay': 'FAUCETPAY',
    'serviceGenerate': 'SERVICE',
    'geminiProduct': 'GEMINI',
    'chatgptProduct': 'CHATGPT',
    'redeem': 'REDEEM CODE',
    'transfer': 'TRANSFER',
    'accountsStore': 'PREMIUM ACCOUNTS',
    'accountDetail': 'ACCOUNT DETAILS',
    'support': 'SUPPORT',
    'messages': 'MESSAGES',
    'cryptoMethods': 'CRYPTO DEPOSIT',
    'cryptoPayment': 'PAYMENT DETAILS',
    'itemSell': 'SELL ITEMS',
    'quiz': 'DAILY QUIZ',
    'quizLeaderboard': 'QUIZ KINGS',
    'scratch': 'LUCKY SCRATCH',
    'watermarkRemover': 'WATERMARK REMOVER',
    'videoDownload': 'VIDEO DOWNLOADER',
    'aiPhotoGenerator': 'AI PHOTO',
    'aiVideoGenerator': 'AI VIDEO',
    'bgRemover': 'BG REMOVER',
    'apiKey': 'API MANAGEMENT'
};

function showPage(targetId) {
    console.log('[DEBUG] showPage called with:', targetId);
    if (!targetId) return;

    // --- TELEGRAM REQUIREMENT CHECK ---
    const isRestrictedGuest = featureFlags?.requireTelegram === true && isDemoMode;
    if (isRestrictedGuest && targetId !== 'home') {
        window.showToast('🚀 Please access via Telegram to unlock all features!');
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
        return;
    }

    // Ensure flags are loaded once (non-blocking)
    ensureFeatureFlagsLoaded().then(() => {
        // If user is already on a disabled page, bounce them to home
        if (currentPage === 'mailService' && featureFlags && featureFlags.tempMail === false) nav('home');
        if (currentPage === 'numberService' && featureFlags && featureFlags.virtualNumber === false) nav('home');
    });

    // Normalize calls that pass DOM page ids (e.g. 'mailServicePage') into logical ids
    if (typeof targetId === 'string' && targetId.endsWith('Page')) {
        targetId = targetId.slice(0, -4);
    }
    if (targetId === 'earn') targetId = 'earnMenu';

    const mainTabs = ['home', 'tasks', 'shop', 'invite', 'profile'];
    // Handle back button visibility & Bottom Navigation bar
    if (targetId === 'home') {
        if (tg.BackButton && tg.BackButton.hide) tg.BackButton.hide();
    } else {
        if (tg.BackButton && tg.BackButton.show) tg.BackButton.show();
    }

    const bottomNav = document.querySelector('.bottom-nav');
    const mainScroll = document.getElementById('mainScroll');
    if (bottomNav && mainScroll) {
        if (mainTabs.includes(targetId)) {
            bottomNav.style.display = 'flex';
            mainScroll.style.paddingBottom = '130px';
        } else {
            bottomNav.style.display = 'none';
            mainScroll.style.paddingBottom = '20px';
        }
    }

    // Hide ALL pages including home
    document.querySelectorAll('.page').forEach(e => {
        e.classList.remove('active');
        e.style.display = 'none';
    });

    // Explicitly hide home page when not on home
    const homePage = document.getElementById('homePage');
    if (homePage && targetId !== 'home') {
        homePage.style.display = 'none';
        homePage.classList.remove('active');
    }

    // Explicitly hide mail pages when not on mail pages
    if (targetId !== 'mailService' && targetId !== 'premiumMail') {
        const mailPages = ['mailServicePage', 'premiumMailPage'];
        mailPages.forEach(id => {
            const page = document.getElementById(id);
            if (page) page.style.display = 'none';
        });
    }

    // Email Service availability check - after hide all pages
    if (targetId === 'emailService') {
        targetId = 'mailService'; // Use same page for now with different provider
    }

    // Enforce gating (authoritative)
    if (targetId === 'mailService' && !checkFeatureOrComingSoon('tempMail', 'Temp Mail')) {
        targetId = 'home';
    }
    if (targetId === 'numberService' && !checkFeatureOrComingSoon('virtualNumber', 'Virtual Number')) {
        targetId = 'home';
    }
    if (targetId === 'premiumMail' && !checkFeatureOrComingSoon('premiumMail', 'Premium Mail')) {
        targetId = 'home';
    }
    // if (targetId === 'accountsStore' && !checkFeatureOrComingSoon('accountsShop', 'Accounts Shop')) {
    //     targetId = 'home';
    // }
    if (targetId === 'vccCards' && !checkFeatureOrComingSoon('cardsVcc', 'Cards / VCC')) {
        targetId = 'home';
    }

    // Show target page
    const targetPage = document.getElementById(targetId + 'Page') || document.getElementById(targetId) || document.getElementById('page-' + targetId);
    if (targetPage) {
        // Check if page has flex-direction in inline style - use display:flex for those pages
        const inlineStyle = targetPage.getAttribute('style') || '';
        if (inlineStyle.includes('flex-direction')) {
            targetPage.style.display = 'flex';
        } else {
            targetPage.style.display = 'block';
        }
        targetPage.classList.add('active');

        // Restore scroll position (so Back keeps you at the same place)
        const mainScroll = document.getElementById('mainScroll');
        const savedTop = (targetId === 'home') ? 0 : (pageScrollPositions[targetId] ?? 0);
        if (mainScroll) {
            setTimeout(() => {
                mainScroll.scrollTop = savedTop;
            }, 0);
        }
    } else {
        console.error('Page not found:', targetId);
        // Fallback to home if page not found
        if (targetId !== 'home') {
            nav('home');
            return;
        }
    }

    // Initialize specific page content
    if (targetId === 'quiz') loadQuiz();
    if (targetId === 'referralLeaderboard') renderReferralLeaderboard();
    if (targetId === 'earnedLeaderboard') renderEarnedLeaderboard();
    if (targetId === 'quizLeaderboard') renderQuizLeaderboard();
    if (targetId === 'apiKey') loadApiKey();
    if (targetId === 'notifications') loadNotifications();

    if (targetId === 'profile') {
        const apiKeyItem = document.getElementById('profileApiKeyItem');
        if (apiKeyItem) {
            apiKeyItem.style.display = (userData.apiStatus === 'disallow') ? 'none' : 'flex';
        }
    }

    // Force refresh service data on navigation for better user experience
    if (targetId === 'vpnServices') {
        fetch('/api/admin/vpn').then(r => r.json()).then(data => {
            if (data.success) {
                localStorage.setItem('adminVPNs', JSON.stringify(data.vpns));
                renderVPN();
            }
        });
    }
    if (targetId === 'vccCards') {
        fetch('/api/admin/cards').then(r => r.json()).then(data => {
            if (data.success) {
                localStorage.setItem('adminCards', JSON.stringify(data.cards));
                renderCards();
            }
        });
    }

    // Service button states initialization
    if (['videoDownload', 'aiPhoto', 'aiVideo'].includes(targetId)) {
        validateServiceInput(targetId);
    }
    if (['watermarkRemover', 'bgRemover'].includes(targetId)) {
        // For file uploads, we just keep the state unless cleared manually
        // but let's ensure the button reflects the current file input state if needed
        const input = document.getElementById(targetId + 'File');
        if (input && input.files && input.files.length > 0) {
            handleServiceFileUpload(targetId);
        }
    }

    if (targetId === 'scratch') {
        // Cleanup any previous scratch handlers before reinitializing
        if (window._scratchCleanup) window._scratchCleanup();
        // Setup scroll blocker (only for scratch page)
        if (!window._scratchScrollBlocker) {
            window._scratchScrollBlocker = function (e) {
                try {
                    if (currentPage === 'scratch') {
                        if (e && typeof e.preventDefault === 'function') e.preventDefault();
                        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                        return false;
                    }
                } catch (_) { }
            };
        }

        const canvas = document.getElementById('scratchCanvas');
        if (canvas) canvas.style.display = 'block';
        if (canvas) canvas.style.opacity = '1';
        initScratchCard();
        // Disable scrolling on scratch page to prevent accidental scroll/pull-to-refresh
        const mainScroll = document.getElementById('mainScroll');
        if (mainScroll) {
            mainScroll.style.overflow = 'hidden';
            mainScroll.style.touchAction = 'none';
            // Force scroll position to top on scratch page
            mainScroll.scrollTop = 0;
        }
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';

        // Block wheel/touchmove scrolling (some devices still scroll even with overflow hidden)
        try {
            document.addEventListener('wheel', window._scratchScrollBlocker, { passive: false });
            document.addEventListener('touchmove', window._scratchScrollBlocker, { passive: false });
        } catch (e) {
            // Fallback for older browsers
            document.addEventListener('wheel', window._scratchScrollBlocker);
            document.addEventListener('touchmove', window._scratchScrollBlocker);
        }
    } else {
        // Re-enable scrolling when leaving scratch page
        const mainScroll = document.getElementById('mainScroll');
        if (mainScroll) {
            mainScroll.style.overflow = '';
            mainScroll.style.touchAction = '';
        }
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
        // Cleanup scratch handlers when leaving scratch page
        if (window._scratchCleanup) window._scratchCleanup();
        // Remove scroll blockers when leaving scratch page
        if (window._scratchScrollBlocker) {
            try {
                document.removeEventListener('wheel', window._scratchScrollBlocker, { passive: false });
                document.removeEventListener('touchmove', window._scratchScrollBlocker, { passive: false });
            } catch (e) {
                document.removeEventListener('wheel', window._scratchScrollBlocker);
                document.removeEventListener('touchmove', window._scratchScrollBlocker);
            }
        }
    }

    // Update current page tracker
    currentPage = targetId;

    // --- END PROGRESS BAR ---
    endLoading();

    // Trigger sync on navigation to ensure fresh data
    smartSync();

    if (targetId === 'home') loadRecentActivity();

    // Auto-update mail balances and start/stop polling
    stopInboxPolling();
    if (targetId === 'mailService') {
        window._currentMailType = 'temp';
        updateMailBalance('temp');
        startInboxPolling('temp');
    } else if (targetId === 'premiumMail') {
        window._currentMailType = 'premium';
        updateMailBalance('premium');
        startInboxPolling('premium');
    } else {
        const title = PAGE_TITLES[targetId] || 'AUTOVERIFY';
        const ht = document.getElementById('headerTitle');
        if (ht) ht.textContent = title;
    }

    // Refresh Daily Rewards UI when entering daily page
    if (targetId === 'daily') {
        renderDailyGrid();
        startDailyCountdown();
    }
    // Load accounts when entering accounts store page
    if (targetId === 'accountsStore') {
        renderAccounts();
    }
    // Load messages when entering messages page
    if (targetId === 'messages' || targetId === 'support') {
        loadUserMessages();
    }
    // Update virtual number balance when entering the number service page
    if (targetId === 'numberService') {
        updateNumBalance();
    }
    // Update balances when entering service pages with balance displays
    if (targetId === 'mailService' || targetId === 'premiumMail' || targetId === 'accountsStore' ||
        targetId === 'vpnServices' || targetId === 'vccCards') {
        renderBalances();
    }

    // Refresh API Key UI when entering API key page
    if (targetId === 'apiKeyPage') {
        const pageNoKey = document.getElementById('apiKeyNoKey');
        const pageActive = document.getElementById('apiKeyActive');
        const pageDisplay = document.getElementById('userApiKeyDisplay');

        if (userData && userData.apiKey) {
            if (pageActive) pageActive.style.display = 'block';
            if (pageNoKey) pageNoKey.style.display = 'none';
            if (pageDisplay) pageDisplay.value = userData.apiKey;
        }
        loadApiKey();
    }

    if (targetId === 'home') {
        try {
            pageScrollPositions.home = 0;
        } catch (e) { }
    }

    // Immediate render from cache for VCC and VPN
    if (targetId === 'vccCards') renderCards();
    if (targetId === 'vpnServices') renderVPN();

    // Background sync administrative data for future visits
    if (['vccCards', 'vpnServices', 'shop', 'services'].includes(targetId)) {
        syncAdminData();
    }
    // Refresh History when entering history page
    if (targetId === 'history') {
        loadRecentActivity(); // Refresh from server
    }
    // Refresh Notifications when entering notifications page
    if (targetId === 'notifications') {
        loadNotifications();
    }
    // Refresh Item Sales when entering item sell page
    if (targetId === 'itemSell') {
        loadMySales();
        resetSellCategory();
    }
    // Refresh Exchange UI when entering exchange page
    if (targetId === 'exchange') {
        initExchangeUI();
    }
    // Load Deposit Config when entering deposit pages
    if (targetId === 'deposit' || targetId === 'cryptoMethods') {
        fetchCryptoConfig();
    }
    // Update Header Style based on page type
    const headerContainer = document.querySelector('.sticky-header-container');
    const mainHeader = document.getElementById('mainHeader');
    const avatar = document.getElementById('headerAvatar');
    const headerBack = document.getElementById('headerBack');
    const headerTitle = document.getElementById('headerTitle');
    const headerLeft = document.getElementById('headerLeft');
    const headerStatus = document.getElementById('headerStatus');

    // Define service pages that need simple header
    const servicePages = ['profile', 'notifications', 'services', 'numberService', 'mailService', 'premiumMail', 'emailMenu',
        'emailService', 'vccCards', 'vpnServices', 'accountsStore', 'serviceGenerate',
        'geminiProduct', 'chatgptProduct', 'checkout', 'deposit', 'shop', 'itemSell',
        'exchange', 'binancePay', 'faucetPay', 'history', 'redeem',
        'invite', 'tasks', 'earn', 'daily', 'verify', 'admin',
        'geminiVerification', 'leaderboard', 'support', 'emailMessage',
        'cryptoMethods', 'cryptoPayment', 'apiKeyPage'];

    if (targetId === 'home') {
        // Home style: Avatar + Auto Verify + bolt + settings
        if (avatar) avatar.style.display = 'flex';
        if (headerBack) headerBack.style.display = 'none';
        if (headerTitle) {
            headerTitle.innerHTML = '<span class="cb-text">Auto Verify</span>';
            headerTitle.style.fontSize = '';
            headerTitle.style.fontWeight = '';
            headerTitle.style.letterSpacing = '';
        }
        if (headerLeft) headerLeft.onclick = handleHeaderClick;
        if (headerStatus) headerStatus.style.display = 'flex';

        // Remove service header style
        if (headerContainer) {
            headerContainer.style.background = '';
            headerContainer.style.borderRadius = '';
            headerContainer.style.margin = '';
            headerContainer.style.position = '';
            headerContainer.style.display = 'block'; // Ensure visible for home
        }
    } else if (targetId === 'mailService' || targetId === 'premiumMail' || targetId === 'emailMenu' || targetId.includes('emailMessage')) {
        if (headerContainer) headerContainer.style.display = 'block';
        if (avatar) avatar.style.display = 'none';
        if (headerBack) {
            headerBack.style.display = 'flex';
            headerBack.innerHTML = '<i class="fas fa-arrow-left" style="color:#fff; font-size:16px;"></i>';
        }
        if (headerTitle) {
            const normalizedId = targetId.includes('emailMessage') ? 'emailMessage' : targetId;
            headerTitle.textContent = PAGE_TITLES[normalizedId] || targetId.toUpperCase();
            headerTitle.style.fontSize = '14px';
            headerTitle.style.fontWeight = '700';
            headerTitle.style.letterSpacing = '1px';
        }
        if (headerLeft) headerLeft.onclick = goBack;
        if (headerStatus) headerStatus.style.display = 'none';

        if (targetId === 'emailMenu') {
            handleEmailMenuNavigation();
        }
    } else if (servicePages.includes(targetId)) {
        // Service style: Back button + Title + theme toggle only
        const pageTitle = PAGE_TITLES[targetId] || targetId.toUpperCase();
        if (headerContainer) headerContainer.style.display = 'block'; // Ensure visible for others
        if (avatar) avatar.style.display = 'none';
        if (headerBack) {
            headerBack.style.display = 'flex';
            headerBack.innerHTML = '<i class="fas fa-arrow-left" style="color:#fff; font-size:16px;"></i>';
        }
        if (headerTitle) {
            headerTitle.textContent = pageTitle;
            headerTitle.style.fontSize = '14px';
            headerTitle.style.fontWeight = '700';
            headerTitle.style.letterSpacing = '1px';
        }
        if (headerLeft) headerLeft.onclick = goBack;
        if (headerStatus) headerStatus.style.display = 'none';
    } else {
        // Default style
        if (avatar) avatar.style.display = 'none';
        if (headerBack) headerBack.style.display = 'flex';
        if (headerTitle) headerTitle.textContent = PAGE_TITLES[targetId] || targetId.toUpperCase();
        if (headerLeft) headerLeft.onclick = goBack;
        if (headerStatus) headerStatus.style.display = 'flex';
    }

    // Bottom Nav Active State Logic using data-page for reliability
    document.querySelectorAll('.nav-item, .nav-center').forEach(n => n.classList.remove('active'));

    let activeNavGroup = 'home';
    if (['home'].includes(targetId)) activeNavGroup = 'home';
    else if (['tasks', 'earn', 'earnMenu', 'daily'].includes(targetId)) activeNavGroup = 'tasks';
    else if (['shop', 'exchange', 'deposit', 'binancePay', 'faucetPay', 'geminiProduct', 'chatgptProduct', 'services', 'numberService', 'mailService', 'emailMenu', 'emailService', 'vccCards', 'vpnServices', 'accountsStore', 'accountDetail', 'serviceGenerate', 'checkout'].includes(targetId)) activeNavGroup = 'shop';
    else if (['invite', 'leaderboard'].includes(targetId)) activeNavGroup = 'invite';
    else if (['profile', 'history', 'notifications', 'redeem', 'transfer', 'support', 'verify', 'geminiVerification', 'admin', 'quizLeaderboard'].includes(targetId)) activeNavGroup = 'profile';

    const activeItem = document.querySelector(`.bottom-nav [data-page="${activeNavGroup}"]`);
    if (activeItem) activeItem.classList.add('active');
}

function startLoading() {
    const bar = document.getElementById('nav-loading-bar');
    if (bar) {
        bar.style.width = '30%';
        bar.style.opacity = '1';
    }
}

function endLoading() {
    const bar = document.getElementById('nav-loading-bar');
    if (bar) {
        bar.style.width = '100%';
        setTimeout(() => {
            bar.style.opacity = '0';
            setTimeout(() => { bar.style.width = '0%'; }, 300);
        }, 300);
    }
}

function goBack() {
    if (historyStack.length > 1) {
        historyStack.pop(); // Remove current
        const prev = historyStack.pop(); // Get previous
        nav(prev);
    } else {
        nav('home');
    }
}
// EXCHANGE SYSTEM
function exchangeTokens() {
    const fromSel = document.getElementById('exFromCurrency');
    const toSel = document.getElementById('exToCurrency');
    const fromAmtEl = document.getElementById('exFromAmount');
    if (!fromSel || !toSel || !fromAmtEl) return;

    const fromCur = fromSel.value;
    const toCur = toSel.value;
    const amt = parseFloat(fromAmtEl.value);

    if (!isFinite(amt) || amt <= 0) {
        window.showToast('Please enter a valid amount.');
        return;
    }

    if (!hasSufficientBalance(fromCur, amt)) {
        window.showToast('Insufficient balance for exchange.');
        return;
    }

    const preview = calculateExchange(fromCur, toCur, amt);
    if (!preview.success) {
        window.showToast(preview.message);
        return;
    }

    const overlay = document.createElement('div');
    overlay.style = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
        <div style="background:#1a100a;border:1px solid rgba(245,158,11,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center;">
            <div style="color:#ef4444;font-size:36px;margin-bottom:16px;"><i class="fas fa-exclamation-triangle"></i></div>
            <h3 style="color:#fff;margin:0 0 12px 0;font-size:20px;">Confirm Exchange</h3>
            <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:24px;line-height:1.5;">Exchange of ${formatCurrencyAmount(amt, fromCur)} to ${formatCurrencyAmount(preview.toAmount, toCur)}?</p>
            <div style="display:flex;gap:10px;">
                <button id="cancelExBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:rgba(255,255,255,0.1);color:#fff;font-weight:bold;cursor:pointer;">CANCEL</button>
                <button id="confirmExBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:#22c55e;color:#fff;font-weight:bold;cursor:pointer;">CONFIRM</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('cancelExBtn').onclick = () => overlay.remove();
    document.getElementById('confirmExBtn').onclick = () => {
        overlay.remove();
        fetch('/api/exchange/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, from: fromCur, to: toCur, amount: amt })
        })
            .then(r => r.json())
            .then(res => {
                if (!res.success) {
                    window.showToast(res.message || 'Exchange failed.');
                    return;
                }

                // Sync balances from response
                if (typeof res.tokens === 'number') userData.tokens = Math.max(0, res.tokens);
                if (typeof res.Gems === 'number') userData.Gems = Math.max(0, res.Gems);
                userData.usd = (res.usd !== undefined && res.usd !== null) ? res.usd : 0;
                renderBalances();
                loadRecentActivity(); // Refresh history after exchange
                updateExchangeBalances();
                updateExchangePreview();

                // Save to history locally
                saveExchangeHistory(fromCur, toCur, amt, res.toAmount ?? preview.toAmount);

                window.showToast('✅ EXCHANGE SUCCESSFUL\n\n' + formatCurrencyAmount(amt, fromCur) + ' ➔ ' + formatCurrencyAmount(res.toAmount ?? preview.toAmount, toCur));
            })
            .catch(() => {
                window.showToast('Network error. Please try again.');
            });
    };
}

function saveExchangeHistory(from, to, fAmt, tAmt) {
    let history = JSON.parse(localStorage.getItem('exHistory') || '[]');
    history.unshift({
        from, to, fAmt, tAmt, date: new Date().toISOString()
    });
    // Keep last 10
    if (history.length > 10) history = history.slice(0, 10);
    localStorage.setItem('exHistory', JSON.stringify(history));
    renderExchangeHistory();
}

function renderExchangeHistory() {
    const container = document.getElementById('exchangeHistoryList');
    if (!container) return;
    const history = JSON.parse(localStorage.getItem('exHistory') || '[]');
    if (history.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:12px; padding:20px;">No recent exchanges.</div>';
        return;
    }

    container.innerHTML = history.map(h => {
        const dateStr = new Date(h.date).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
        return `
        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:14px; border-radius:16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-size:12px; font-weight:900; color:#fff; display:flex; align-items:center; gap:6px;">
                    ${formatCurrencyAmount(h.fAmt, h.from)} 
                    <i class="fas fa-arrow-right" style="font-size:10px; color:#10b981;"></i> 
                    ${formatCurrencyAmount(h.tAmt, h.to)}
                </div>
                <div style="font-size:9px; color:var(--text-sub); margin-top:4px; font-weight:700; text-transform:uppercase;">${dateStr}</div>
            </div>
            <div style="width:32px; height:32px; background:rgba(16,185,129,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center;">
                <i class="fas fa-check" style="color:#10b981; font-size:12px;"></i>
            </div>
        </div>
        `;
    }).join('');
}

const exchangeRates = {
    usd_to_tokens: 100,
    Gems_to_tokens: 100
};

function tokensToUsd(tokens) {
    return tokens / exchangeRates.usd_to_tokens;
}

function usdToTokens(usd) {
    return usd * exchangeRates.usd_to_tokens;
}

function tokensToGems(tokens) {
    return tokens / exchangeRates.Gems_to_tokens;
}

function GemsToTokens(Gems) {
    return Gems * exchangeRates.Gems_to_tokens;
}

function calculateExchange(from, to, amount) {
    let toAmount = 0;
    let rateText = '-';

    // Convert from -> tokens base
    let tokensBase = 0;
    if (from === 'tokens') tokensBase = amount;
    else if (from === 'usd') tokensBase = usdToTokens(amount);
    else if (from === 'Gems') tokensBase = GemsToTokens(amount);
    else return { success: false, message: 'Invalid source currency' };

    // Restriction: Removed Cannot convert Tokens/Gems back to USD restriction
    // if (to === 'usd' && from !== 'usd') {
    //    return { success: false, message: 'Convert back to USD is not allowed.' };
    // }

    // Convert tokens base -> to
    if (to === 'tokens') {
        toAmount = tokensBase;
        rateText = '1 Token = 1 Token';
    } else if (to === 'usd') {
        toAmount = tokensToUsd(tokensBase);
        rateText = `1 USD = ${exchangeRates.usd_to_tokens} Tokens`;
    } else if (to === 'Gems') {
        toAmount = tokensToGems(tokensBase);
        rateText = `1 Gems = ${exchangeRates.Gems_to_tokens} Tokens`;
    } else {
        return { success: false, message: 'Invalid target currency' };
    }

    // Display rounding rules
    if (to === 'usd') toAmount = Math.round(toAmount * 100) / 100;
    else toAmount = Math.floor(toAmount * 10000) / 10000;

    return { success: true, toAmount, rateText };
}

function formatCurrencyAmount(amount, cur) {
    if (cur === 'usd') {
        const val = Math.round(amount * 100) / 100;
        return val === 0 ? '$0' : `$${val.toFixed(2)}`;
    }
    if (cur === 'tokens') return `${Math.floor(amount)} TOKENS`;
    if (cur === 'Gems') return `${Math.floor(amount * 10000) / 10000} Gems`;
    return `${amount}`;
}

function hasSufficientBalance(cur, amount) {
    if (cur === 'tokens') return (userData.tokens || 0) >= amount;
    if (cur === 'Gems') return (userData.Gems || 0) >= amount;
    if (cur === 'usd') return (userData.usd || 0) >= amount;
    return false;
}

function updateExchangeBalances() {
    const t = document.getElementById('exBalTokens');
    const j = document.getElementById('exBalGems');
    const u = document.getElementById('exBalUsd');
    if (t) t.textContent = formatCompact(userData.tokens || 0);
    if (j) j.textContent = formatCompact(userData.Gems || 0);
    if (u) u.textContent = (Math.round((userData.usd || 0) * 100) / 100).toFixed(2);
}

function updateExchangePreview() {
    const fromCur = document.getElementById('exFromCurrency')?.value;
    let toCur = document.getElementById('exToCurrency')?.value;
    const amt = parseFloat(document.getElementById('exFromAmount')?.value || '0');

    const toEl = document.getElementById('exToAmount');
    const rateEl = document.getElementById('exRateHint');
    const fromHint = document.getElementById('exFromHint');
    const feeEl = document.getElementById('exFeeHint');

    if (!fromCur || !toCur || !toEl || !rateEl) return;

    if (fromCur === toCur) {
        // Since To only has Tokens and Gems now, if From is one of them, switch To to the other.
        if (fromCur === 'tokens') document.getElementById('exToCurrency').value = 'Gems';
        else if (fromCur === 'Gems') document.getElementById('exToCurrency').value = 'tokens';

        // Refresh toCur after potential change
        toCur = document.getElementById('exToCurrency').value;
    }

    // Disable the same currency in To dropdown
    const toOptions = document.getElementById('exToCurrency').querySelectorAll('option');
    toOptions.forEach(opt => {
        opt.disabled = (opt.value === fromCur);
    });

    const maxVal = fromCur === 'tokens' ? (userData.tokens || 0) : fromCur === 'Gems' ? (userData.Gems || 0) : (userData.usd || 0);
    if (fromHint) fromHint.textContent = `MAX: ${fromCur === 'usd' ? '$' + (Math.round(maxVal * 100) / 100).toFixed(2) : formatCompact(maxVal)}`;

    const preview = calculateExchange(fromCur, toCur, isFinite(amt) ? amt : 0);
    if (!preview.success) {
        toEl.value = '0';
        rateEl.textContent = 'RATE: -';
        if (feeEl) {
            feeEl.textContent = preview.message || '';
            feeEl.style.color = '#ef4444';
        }
        return;
    }

    toEl.value = preview.toAmount;
    rateEl.textContent = `RATE: ${preview.rateText}`;
    if (feeEl) feeEl.textContent = '';
}

function initExchangeUI() {
    const fromSel = document.getElementById('exFromCurrency');
    const toSel = document.getElementById('exToCurrency');
    const fromAmt = document.getElementById('exFromAmount');
    if (!fromSel || !toSel || !fromAmt) return;

    updateExchangeBalances();
    updateExchangePreview();

    fromSel.addEventListener('change', () => updateExchangePreview());
    toSel.addEventListener('change', () => updateExchangePreview());
    fromAmt.addEventListener('input', () => updateExchangePreview());

    renderExchangeHistory();
}

// Swap FROM and TO currencies
function swapExchangeCurrencies() {
    const fromSel = document.getElementById('exFromCurrency');
    const toSel = document.getElementById('exToCurrency');
    const fromAmt = document.getElementById('exFromAmount');

    if (!fromSel || !toSel) return;

    // Special logic for USD as requested: 
    // USD always stays at top. If USD is selected, clicking swap toggles the target.
    if (fromSel.value === 'usd') {
        toSel.value = (toSel.value === 'Gems') ? 'tokens' : 'Gems';
    } else {
        // Normal swap for Tokens/Gems
        const temp = fromSel.value;
        const currentTo = toSel.value;

        fromSel.value = currentTo;
        toSel.value = temp;
    }

    // Clear amount
    if (fromAmt) fromAmt.value = '';

    // Update preview
    updateExchangePreview();

    // Haptic feedback
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}
window.swapExchangeCurrencies = swapExchangeCurrencies;

// Set max amount (all tokens)
function setMaxExchangeAmount() {
    const fromSel = document.getElementById('exFromCurrency');
    const fromAmt = document.getElementById('exFromAmount');

    if (!fromSel || !fromAmt) return;

    const fromCur = fromSel.value;
    let maxVal = 0;

    if (fromCur === 'tokens') maxVal = userData.tokens || 0;
    else if (fromCur === 'Gems') maxVal = userData.Gems || 0;
    else if (fromCur === 'usd') maxVal = userData.usd || 0;

    fromAmt.value = maxVal;
    updateExchangePreview();

    // Haptic feedback
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}
window.setMaxExchangeAmount = setMaxExchangeAmount;

// CHECKOUT LOGIC
let checkoutQty = 1;
const checkoutUnitPrice = 3.00;

function changeQty(delta) {
    checkoutQty = Math.max(1, checkoutQty + delta);
    const qtyEl = document.getElementById('checkoutQty');
    const totalEl = document.getElementById('checkoutTotal');
    if (qtyEl) qtyEl.textContent = checkoutQty;
    if (totalEl) totalEl.textContent = '$' + (checkoutQty * checkoutUnitPrice).toFixed(2);
}

function selectPayMethod(method) {
    if (method === 'faucet') {
        nav('localPayment');
    }
}

let cryptoConfig = null;
let currentCryptoMethod = null;

async function fetchCryptoConfig() {
    try {
        const res = await fetch('/api/deposit/config');
        const data = await res.json();
        if (data.success) {
            cryptoConfig = data.cryptoMethods;
            renderCryptoMethods();
        }
    } catch (e) { console.error('Error fetching crypto config:', e); }
}

function renderCryptoMethods() {
    window.cryptoConfig = cryptoConfig; // Export to window for inline scripts to use

    const cryptoContainer = document.getElementById('cryptoMethodsList');
    const localContainer = document.getElementById('localPaymentMethodsGrid');

    if (cryptoContainer) cryptoContainer.innerHTML = '';
    if (localContainer) localContainer.innerHTML = '';

    if (!cryptoConfig) return;

    const icons = {
        binance: { bg: '#FCD535', icon: '<span style="font-size:20px; font-weight:900; color:#000;">B</span>' },
        bitget: { bg: '#00f0ff', icon: '<i class="fas fa-bolt" style="color:#000;"></i>' },
        gateio: { bg: '#f23e5c', icon: '<i class="fas fa-g" style="color:#fff; font-weight:900;"></i>' },
        usdt: { bg: '#26A17B', icon: '<i class="fas fa-t" style="color:#fff; font-weight:900;"></i>' },
        bitcoin: { bg: '#f7931a', icon: '<i class="fab fa-bitcoin" style="color:#fff;"></i>' },
        web3: { bg: 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)', icon: '<i class="fas fa-link" style="color:#fff;"></i>' }
    };

    Object.entries(cryptoConfig).forEach(([id, meta]) => {
        if (meta.status !== 'active') return;

        const isLocal = meta.type === 'local';

        if (isLocal && localContainer) {
            let color = '#22c55e';
            let shortName = meta.name.substring(0, 1).toUpperCase();
            const lcName = meta.name.toLowerCase();
            if (lcName.includes('bkash')) { color = '#dc2626'; shortName = 'bKash'; }
            if (lcName.includes('nagad')) { color = '#eab308'; shortName = 'Nagad'; }
            if (lcName.includes('rocket')) { color = '#3b82f6'; shortName = 'Rocket'; }
            if (lcName.includes('upay')) { color = '#a855f7'; shortName = 'Upay'; }

            const card = document.createElement('button');
            card.onclick = () => window.showPaymentDetails(id);
            card.style.cssText = `
                display:flex; flex-direction:column; align-items:center; gap:8px;
                padding:20px 12px;
                border-radius:16px;
                border:1.5px solid ${color}4d;
                cursor:pointer;
                transition:all 0.22s ease;
                background:${color}14;
                text-align:center;
                width:100%;
            `;
            card.innerHTML = `
                <div style="width:56px; height:56px; border-radius:16px; background:${color}33; display:flex; align-items:center; justify-content:center;">
                    <span style="color:${color}; font-size:14px; font-weight:800;">${shortName}</span>
                </div>
                <div style="font-size:13px; font-weight:700; color:var(--text-main,#fff);">${meta.name}</div>
                <div style="font-size:10px; color:var(--text-sub,#888);">Send Money</div>
            `;
            localContainer.appendChild(card);

        } else if (!isLocal && cryptoContainer) {
            const style = icons[id] || { bg: '#444', icon: '<i class="fas fa-wallet"></i>' };

            const card = document.createElement('div');
            card.className = 'pm-card';
            card.onclick = () => openCryptoPayment(id);
            card.innerHTML = `
                <div class="pm-icon" style="background:${style.bg};">${style.icon}</div>
                <div class="pm-info">
                    <div class="pm-title">${meta.name}</div>
                    <div class="pm-desc">${id === 'web3' ? 'USDT TRC20/ERC20' : 'Exchange Deposit'}</div>
                </div>
                <div class="pm-arrow"><i class="fas fa-chevron-right"></i></div>
            `;
            cryptoContainer.appendChild(card);
        }
    });
}

function openCryptoPayment(methodId) {
    currentCryptoMethod = methodId;
    const meta = cryptoConfig[methodId];
    if (!meta) return;

    document.getElementById('cpMethodName').textContent = meta.name;

    // QR
    const qrBox = document.getElementById('cpQrBox');
    const qrImg = document.getElementById('cpQrImg');
    if (meta.qr) {
        qrImg.src = meta.qr;
        qrBox.style.display = 'block';
    } else {
        qrBox.style.display = 'none';
    }

    // Reset screenshot
    document.getElementById('cpScreenshotUrl').value = '';

    // ID
    const idBox = document.getElementById('cpIdBox');
    const idVal = document.getElementById('cpIdVal');
    const idLabel = document.getElementById('cpIdLabel');
    if (meta.details) {
        idVal.textContent = meta.details;
        const lowerName = meta.name.toLowerCase();
        let label = 'UID / ID';
        if (lowerName.includes('binance')) label = 'BINANCE PAY ID';
        else if (lowerName.includes('bitget')) label = 'BITGET UID';
        else if (lowerName.includes('gate')) label = 'GATE.IO UID';
        else if (lowerName.includes('web3') || lowerName.includes('usdt') || lowerName.includes('address') || lowerName.includes('wallet')) label = 'WALLET ADDRESS';

        idLabel.textContent = label;
        idBox.style.display = 'flex';
        document.getElementById('cpIdCopy').onclick = (e) => {
            copyText(meta.details, e.currentTarget);
        };
    } else {
        idBox.style.display = 'none';
    }

    // Email
    const emailBox = document.getElementById('cpEmailBox');
    const emailVal = document.getElementById('cpEmailVal');
    if (meta.email) {
        emailVal.textContent = meta.email;
        emailBox.style.display = 'flex';
        document.getElementById('cpEmailCopy').onclick = (e) => {
            copyText(meta.email, e.currentTarget);
        };
    } else {
        emailBox.style.display = 'none';
    }

    nav('cryptoPayment');
}

async function submitCryptoDeposit() {
    const amount = document.getElementById('cpAmountInput').value;
    const txnId = document.getElementById('cpTxnIdInput').value;

    if (!amount || amount <= 0) return window.showToast('Please enter a valid amount.');
    if (!txnId || txnId.length < 5) return window.showToast('Please enter a valid Transaction ID / Hash.');

    try {
        const res = await fetch('/api/deposit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                method: currentCryptoMethod,
                amount: amount,
                txnId: txnId,
                screenshot: document.getElementById('cpScreenshotUrl').value
            })
        });
        const data = await res.json();
        if (data.success) {
            window.showToast(data.message);
            nav('deposit');
            // Clear inputs
            document.getElementById('cpAmountInput').value = '';
            document.getElementById('cpTxnIdInput').value = '';
            document.getElementById('cpScreenshotUrl').value = '';
        } else {
            window.showToast(data.message || 'Error submitting deposit.');
        }
    } catch (e) {
        window.showToast('Network error. Please try again.');
    }
}

let activeLocalPayMethod = 'bkash';

function selectLocalMethod(method) {
    activeLocalPayMethod = method;
    const btnBkash = document.getElementById('btnBkash');
    const btnNagad = document.getElementById('btnNagad');
    const nameLabel = document.getElementById('localPaymentMethodName');
    const numberLabel = document.getElementById('localPaymentNumber');
    const submitBtn = document.getElementById('btnLocalSubmit');

    if (method === 'bkash') {
        btnBkash.style.background = '#e1147e';
        btnBkash.style.opacity = '1';
        btnBkash.style.border = 'none';

        btnNagad.style.background = 'rgba(255,255,255,0.05)';
        btnNagad.style.opacity = '0.6';
        btnNagad.style.border = '1px solid rgba(255,255,255,0.1)';

        nameLabel.innerText = 'BKASH NUMBER (PERSONAL)';
        numberLabel.innerText = '01700000000'; // Set default or dynamic Bkash num here
        if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg,#e1147e,#f7931e)';
    } else {
        btnNagad.style.background = '#f7931e';
        btnNagad.style.opacity = '1';
        btnNagad.style.border = 'none';

        btnBkash.style.background = 'rgba(255,255,255,0.05)';
        btnBkash.style.opacity = '0.6';
        btnBkash.style.border = '1px solid rgba(255,255,255,0.1)';

        nameLabel.innerText = 'NAGAD NUMBER (PERSONAL)';
        numberLabel.innerText = '01800000000'; // Set default or dynamic Nagad num here
        if (submitBtn) submitBtn.style.background = 'linear-gradient(135deg,#f7931e,#e1147e)';
    }
}

async function submitFaucetDeposit() {
    const amount = document.getElementById('fpAmountInput').value;
    const txnId = document.getElementById('fpTxnIdInput').value;

    if (!amount || amount <= 0) return window.showToast('Please enter a valid amount.');
    if (!txnId) return window.showToast(`Please enter your ${activeLocalPayMethod.toUpperCase()} Transaction ID.`);

    try {
        const res = await fetch('/api/deposit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                method: activeLocalPayMethod,
                amount: amount,
                txnId: txnId,
                screenshot: document.getElementById('fpScreenshotUrl').value
            })
        });
        const data = await res.json();
        if (data.success) {
            window.showToast(data.message);
            nav('deposit');
            document.getElementById('fpAmountInput').value = '';
            document.getElementById('fpTxnIdInput').value = '';
            document.getElementById('fpScreenshotUrl').value = '';
        } else {
            window.showToast(data.message || 'Error submitting deposit.');
        }
    } catch (e) {
        window.showToast('Network error.');
    }
}

function submitPayment() {
    const txnId = document.getElementById('txnIdInput')?.value || document.getElementById('fpTxnIdInput')?.value;
    if (!txnId || txnId.trim() === '') {
        window.showToast('Please enter your Transaction ID to confirm payment.');
        return;
    }
    window.showToast('Payment Submitted!\n\nYour payment has been submitted for review.\n\nTransaction ID: ' + txnId + '\n\nWe will verify and credit your account within 24 hours.');
}

// TASK LOGIC
const IN_PROGRESS_TASKS = {};

// Fetch and render tasks from API
async function loadUserTasks(silent = false) {
    const container = document.getElementById('tasksListContainer');
    if (!container) return;

    // Fast feedback: show skeleton or "Loading..." instantly only if not silent
    if (!silent) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; width:100%;">
                <div class="skeleton-task" style="height:80px; background:rgba(255,255,255,0.05); border-radius:15px; animation:pulse 1.5s infinite;"></div>
                <div class="skeleton-task" style="height:80px; background:rgba(255,255,255,0.05); border-radius:15px; animation:pulse 1.5s infinite; animation-delay:0.2s;"></div>
                <div class="skeleton-task" style="height:80px; background:rgba(255,255,255,0.05); border-radius:15px; animation:pulse 1.5s infinite; animation-delay:0.4s;"></div>
            </div>`;
    }

    try {
        const res = await fetch('/api/admin/tasks');
        const data = await res.json();

        if (!data.success || !data.tasks || data.tasks.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#666;">
                    <i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px;"></i>
                    <p>No tasks available</p>
                </div>`;
            return;
        }

        // Render tasks
        const completedSet = new Set(userData.completedTasks || []);

        container.innerHTML = data.tasks.map(task => {
            const isDone = completedSet.has(task.id);
            const inProgress = IN_PROGRESS_TASKS[task.id];
            const icon = getTaskIcon(task.name, task.icon);
            const bg = getTaskBg(task.name);
            const border = getTaskBorder(task.name);

            return `
            <div class="task-card-new ${isDone ? 'task-done' : ''}" data-task-id="${task.id}" style="${isDone ? 'opacity: 0.6; pointer-events:none;' : ''}">
                <div class="tcn-left">
                    <div class="tcn-icon" style="background:${bg}; border:1px solid ${border}; padding:0; overflow:hidden;">
                        ${isDone ? '<i class="fas fa-check-circle" style="color:#22c55e; font-size:24px;"></i>' : icon}
                    </div>
                    <div class="tcn-info">
                        <h4 style="${isDone ? 'text-decoration: line-through;' : ''}">${task.name}</h4>
                        <div class="tcn-rewards">
                            <div class="tcn-badge" style="color:#fbbf24"><i class="fas fa-coins"></i> +${task.reward || 10}</div>
                            <div class="tcn-badge" style="color:#38bdf8"><i class="fas fa-gem"></i> +${task.gems || 1}</div>
                        </div>
                    </div>
                </div>
                ${isDone ?
                    '<button class="tcn-btn" style="background:#22c55e; color:white;"><i class="fas fa-check"></i></button>' :
                    (inProgress === 'VERIFY' ?
                        `<button class="tcn-btn" style="background:#22c55e; color:white;" onclick="completeTask('${task.id}', ${task.reward || 10}, this, '${task.url}')">VERIFY</button>` :
                        `<button class="tcn-btn" onclick="startTask(this, '${task.id}', '${task.url}', ${task.reward || 10})">START</button>`
                    )
                }
            </div>`;
        }).join('');

    } catch (e) {
        console.error('Error loading tasks:', e);
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:#666;">
                <i class="fas fa-exclamation-triangle" style="font-size:24px; margin-bottom:10px;"></i>
                <p>Failed to load tasks</p>
            </div>`;
    }
}

// Helper function to get task icon
function getTaskIcon(name, customIcon = null) {
    // If custom icon is provided, use it
    if (customIcon) {
        return `<img src="${customIcon}" alt="icon" style="width:40px; height:40px; object-fit:contain; border-radius:8px;" onerror="this.parentElement.innerHTML='<i class=\'fas fa-tasks\' style=\'color:#f59e0b; font-size:20px;\'></i>'">`;
    }

    const lower = name.toLowerCase();
    if (lower.includes('youtube')) {
        return `<img src="https://img.icons8.com/color/48/youtube-play.png" alt="YT" style="width:28px; height:28px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\'fab fa-youtube\' style=\'color:#ff0000; font-size:22px\'></i>'">`;
    } else if (lower.includes('telegram')) {
        return `<img src="https://img.icons8.com/color/48/telegram-app.png" alt="TG" style="width:28px; height:28px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\'fab fa-telegram\' style=\'color:#229ed9; font-size:22px\'></i>'">`;
    } else {
        return `<i class="fas fa-tasks" style="color:#f59e0b; font-size:20px;"></i>`;
    }
}

// Helper function to get task background color
function getTaskBg(name) {
    const lower = name.toLowerCase();
    if (lower.includes('youtube')) return '#1a0000';
    if (lower.includes('telegram')) return '#003a4a';
    return '#1a1a2e';
}

// Helper function to get task border color
function getTaskBorder(name) {
    const lower = name.toLowerCase();
    if (lower.includes('youtube')) return '#ff0000';
    if (lower.includes('telegram')) return '#229ed9';
    return '#333';
}

let activeTaskButton = null;
let activeTaskData = null;

// Start task - open URL and track
function startTask(button, taskId, url, reward) {
    if (!url) {
        showToast('Task URL not configured');
        return;
    }

    activeTaskButton = button;
    if (button) {
        button.dataset.originalText = button.innerHTML;
    }
    activeTaskData = { taskId, url, reward };

    // Immediately show VERIFY
    button.textContent = 'VERIFY';
    button.style.background = '#22c55e';
    button.disabled = false;

    const currentTaskData = { ...activeTaskData };
    const currentBtn = button;

    button.onclick = function () {
        window.open(currentTaskData.url, '_blank');
        
        // Update onclick to actually verify on next click
        currentBtn.onclick = function () {
            completeTask(currentTaskData.taskId, currentTaskData.reward, currentBtn, currentTaskData.url);
        };
    };
}

// Complete task and claim reward
async function completeTask(taskId, reward, button, url) {
    try {
        if (!button) return;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const res = await fetch('/api/complete-task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData?.id,
                taskId: taskId,
                reward: reward
            })
        });

        const data = await res.json();

        if (data.success) {
            button.textContent = 'DONE';
            button.style.background = '#666';
            button.disabled = true;
            
            delete IN_PROGRESS_TASKS[taskId];

            if (data.newBalance !== undefined) {
                userData.tokens = data.newBalance;
            } else {
                userData.tokens += parseInt(reward) || 0;
            }

            showToast(`✅ Task completed! +${reward} tokens`);
            renderBalances();

            if (!userData.completedTasks) userData.completedTasks = [];
            if (!userData.completedTasks.includes(taskId)) {
                userData.completedTasks.push(taskId);
            }
            localStorage.setItem(`userData_${userData.id}`, JSON.stringify(userData));

            if (window.confetti) confetti({ particleCount: 50, spread: 60 });
        } else if (data.message === 'Task already completed') {
            button.textContent = 'DONE';
            button.style.background = '#666';
            button.disabled = true;
            showToast('Task already completed');

            if (!userData.completedTasks) userData.completedTasks = [];
            if (!userData.completedTasks.includes(taskId)) {
                userData.completedTasks.push(taskId);
            }
        } else {
            showToast(data.message || 'Verification failed');
            button.disabled = false;
            button.textContent = 'VERIFY';
            button.style.background = '#22c55e';
        }
    } catch (e) {
        console.error('Error completing task:', e);
        if (button) {
            button.disabled = false;
            button.textContent = 'START';
            button.style.background = ''; // reset to default
            button.onclick = function() {
                startTask(button, taskId, url, reward);
            };
        }
        showToast('Network error verifying task');
    }
}

function earn(buttonElement, type, amount) {
    console.log(`[DEBUG] earn() called - type: ${type}, state: ${IN_PROGRESS_TASKS[type]}, userId: ${userData.id}`);

    if (IN_PROGRESS_TASKS[type] === 'completed') {
        window.showToast('You have already completed this task!');
        return;
    }

    if (IN_PROGRESS_TASKS[type] === 'checking') {
        console.log(`[DEBUG] Already checking ${type}`);
        return;
    }

    // For Telegram tasks (tg and tg_ch), verify membership
    if (type === 'tg' || type === 'tg_ch') {
        const checkUrl = type === 'tg' ? 'https://t.me/AutosVerifych' : 'https://t.me/AutosVerify';

        // Open the link first
        window.open(checkUrl);

        // Show checking state
        IN_PROGRESS_TASKS[type] = 'checking';
        buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CHECKING...';
        buttonElement.style.pointerEvents = 'none';
        buttonElement.style.background = '#333';

        // Check membership after 15 seconds (give user time to join)
        setTimeout(() => {
            verifyAndComplete(type, buttonElement, amount);
        }, 15000);

        return;
    }

    // YouTube task - countdown then auto-complete (NO CLAIM BUTTON)
    if (type === 'yt') {
        window.open('https://www.youtube.com/@MamunIslamyts', '_blank');

        IN_PROGRESS_TASKS[type] = 'waiting';
        buttonElement.style.pointerEvents = 'none';
        buttonElement.style.background = '#333';
        buttonElement.style.color = '#aaa';

        let timeLeft = 30;
        buttonElement.innerHTML = `${timeLeft}s...`;

        const timer = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(timer);
                // Auto-complete after countdown (NO CLAIM)
                verifyAndComplete(type, buttonElement, amount);
            } else {
                buttonElement.innerHTML = `${timeLeft}s...`;
            }
        }, 1000);
    }
}

// Verify membership and auto-complete task
function verifyAndComplete(type, buttonElement, amount) {
    console.log(`[DEBUG] Verifying and completing ${type}`);

    // Update button to show verifying
    buttonElement.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> VERIFYING...';
    buttonElement.style.pointerEvents = 'none';

    // For Telegram tasks, verify membership first
    if (type === 'tg' || type === 'tg_ch') {
        fetch('/api/verify-membership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                taskType: type
            })
        })
            .then(res => res.json())
            .then(data => {
                console.log(`[DEBUG] Membership check:`, data);

                if (data.success && data.isMember) {
                    // User joined - complete task
                    completeTaskReward(type, buttonElement, amount);
                } else {
                    // Not joined - reset to START
                    IN_PROGRESS_TASKS[type] = null;
                    buttonElement.innerHTML = 'START';
                    buttonElement.style.pointerEvents = 'auto';
                    buttonElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';

                    const channel = type === 'tg' ? '@AutosVerifych' : '@AutosVerify';
                    window.showToast(`❌ Verification failed.\nPlease join ${channel} then click START again.`);
                }
            })
            .catch(err => {
                console.error('Verify error:', err);
                IN_PROGRESS_TASKS[type] = null;
                buttonElement.innerHTML = 'START';
                buttonElement.style.pointerEvents = 'auto';
                buttonElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                window.showToast('⚠️ Network Error. Please ensure bot connection is active.');
            });
    } else {
        // Other tasks (YouTube, etc) - direct complete
        completeTaskReward(type, buttonElement, amount);
    }
}

// Give reward and mark complete
function completeTaskReward(type, buttonElement, amount) {
    buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CLAIMING...';

    fetch('/api/earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: userData.id,
            type: type,
            amount: amount
        })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Success
                buttonElement.innerHTML = '<i class="fas fa-check"></i>';
                buttonElement.style.background = '#22c55e';
                buttonElement.style.color = 'white';
                buttonElement.style.pointerEvents = 'none';

                // Add to completed set
                if (!userData.completedTasks) userData.completedTasks = [];
                if (!userData.completedTasks.includes(type)) {
                    userData.completedTasks.push(type);
                }

                userData.tokens = data.newBalance;
                renderBalances();

                // Update local in-progress state for checkAllTasksCompleted
                IN_PROGRESS_TASKS[type] = 'completed';

                window.showToast(`🎉 Task Completed! +${amount} Tokens`);

                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                checkAllTasksCompleted();

                // Refresh task list after a delay
                setTimeout(loadUserTasks, 1500);
            } else {
                window.showToast(data.message || 'Error claiming reward');
                IN_PROGRESS_TASKS[type] = null;
                buttonElement.innerHTML = 'START';
                buttonElement.style.pointerEvents = 'auto';
            }
        })
        .catch(err => {
            console.error('Earn error:', err);
            window.showToast('Network error claiming reward');
            IN_PROGRESS_TASKS[type] = null;
            buttonElement.innerHTML = 'START';
            buttonElement.style.pointerEvents = 'auto';
        });
}

// Check if all 3 tasks are completed and show overlay
function checkAllTasksCompleted() {
    const requiredTasks = ['yt', 'tg', 'tg_ch'];
    const allCompleted = requiredTasks.every(task => IN_PROGRESS_TASKS[task] === 'completed');

    if (allCompleted) {
        // Create overlay if it doesn't exist
        let overlay = document.getElementById('allTasksCompletedOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'allTasksCompletedOverlay';
            overlay.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.95); z-index:99999; justify-content:center; align-items:center; flex-direction:column;';
            overlay.innerHTML = `
                <div style="width:100px; height:100px; background:#22c55e; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-bottom:20px; animation:scaleIn 0.5s ease;">
                    <i class="fas fa-check" style="font-size:50px; color:#fff;"></i>
                </div>
                <div style="font-size:22px; font-weight:900; color:#fff; margin-bottom:10px;">All Missions Complete!</div>
                <div style="font-size:14px; color:#888; text-align:center; max-width:260px; line-height:1.5;">You have completed all tasks and earned bonus rewards!</div>
                <button onclick="document.getElementById('allTasksCompletedOverlay').style.display='none'" style="margin-top:28px; padding:14px 28px; background:#f59e0b; border:none; border-radius:25px; color:#000; font-weight:800; font-size:15px; cursor:pointer;">Continue</button>
            `;
            document.body.appendChild(overlay);
        }

        // Show overlay
        overlay.style.display = 'flex';

        // Trigger confetti celebration
        if (typeof confetti !== 'undefined') {
            confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors: ['#22c55e', '#f59e0b', '#3b82f6'] });
        }
    }
}

// ==========================================
// ==========================================
// AD VIEWER (Watch & Earn)
// ==========================================

let adWatchTimer = null;
let adRewardClaimed = false;
let currentAdContext = 'watch_ad';

function showAdAndEarn(context = 'watch_ad') {
    currentAdContext = context;
    adRewardClaimed = false;

    // Show explicit loading state
    if (window.showToast) {
        window.showToast('🚀 Fetching Reward Ad...');
    }

    // Ensure ad overlay is ready and visible immediately
    let overlay = document.getElementById('ad-watching-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ad-watching-overlay';
        document.body.appendChild(overlay);
    }

    // Clear and show overlay
    overlay.style.cssText = 'display:flex; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.98); z-index:9999999; flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(15px); color:white; font-family:sans-serif; text-align:center;';
    overlay.innerHTML = `
        <div id="ad-content-box" style="padding:30px; width:100%; max-width:320px; transition: all 0.3s ease; z-index: 10000000;">
            <div class="loader-spinner" style="width:40px; height:40px; border:3px solid rgba(255,255,255,0.1); border-top-color:#f59e0b; border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 20px;"></div>
            <h2 style="font-size:22px; font-weight:800; margin-bottom:12px;">Loading Ad...</h2>
            <p style="color:#888; font-size:14px; line-height:1.5;">We are connecting to the best ad server to unlock your reward.</p>
            <button onclick="document.getElementById('ad-watching-overlay').style.display='none'; resetAdButtons();" style="margin-top:30px; color:#555; background:none; border:none; font-size:13px; cursor:pointer; text-decoration:underline;">Cancel</button>
        </div>
    `;
    overlay.style.display = 'flex'; // Ensure it's shown

    // Safety Timeout: if nothing happens in 20s, fallback or close
    const safetyTimeout = setTimeout(() => {
        if (overlay.style.display !== 'none' && !adRewardClaimed) {
            const content = document.getElementById('ad-content-box');
            if (content && content.innerHTML.includes('Loading Ad...')) {
                window.showToast('⚠️ Taking too long. Switching to reward...');
                // Attempt auto-reward instead of just closing
                overlay.style.display = 'none';
                claimAdReward();
            }
        }
    }, 20000);

    // Step 1: Fetch Ad Config
    fetch('/api/ads/config')
        .then(r => r.json())
        .then(data => {
            clearTimeout(safetyTimeout);
            const ads = data.ads || {};

            // Identify networks
            const enabledAds = Object.entries(ads).filter(([k, c]) => c.enabled);

            // ONLY use Adsgram SDK if network is explicitly 'adsgram'
            const adsgramCfg = ads['adsgram'] && ads['adsgram'].enabled ? ads['adsgram'] : null;
            const adsgramBlockId = adsgramCfg ? (adsgramCfg.publisherId || adsgramCfg.adUnitId || '') : '';

            // Get Monetag or any other direct URL / publisher ID for link-based ads
            const monetagCfg = (ads['moneytag'] || ads['monetag']) && (ads['moneytag'] || ads['monetag'])?.enabled
                ? (ads['moneytag'] || ads['monetag']) : null;
            const monetagPublisherId = monetagCfg ? (monetagCfg.publisherId || monetagCfg.adUnitId || '') : '';
            const monetagDirectUrl = monetagCfg ? (monetagCfg.directUrl || '') : '';

            // Any direct URL from any enabled network
            let anyDirectUrl = '';
            for (const [, cfg] of enabledAds) {
                if (cfg.directUrl) { anyDirectUrl = cfg.directUrl; break; }
            }

            const contentBox = document.getElementById('ad-content-box');
            if (contentBox) {
                contentBox.innerHTML =
                    '<div style="width:80px; height:80px; background:linear-gradient(135deg, #f59e0b, #d97706); border-radius:24px; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; box-shadow:0 12px 24px rgba(245,158,11,0.4);">' +
                    '<i class="fas fa-play text-white text-3xl"></i>' +
                    '</div>' +
                    '<div style="font-size:24px; font-weight:900; margin-bottom:12px;">Ad is Ready!</div>' +
                    '<p style="font-size:15px; color:#aaa; margin-bottom:32px; line-height:1.5;">TAP the button below to watch the ad and earn your tokens instantly.</p>' +
                    '<button id="ad-watch-btn" style="width:100%; padding:18px; background:#f59e0b; color:#000; font-weight:900; border-radius:30px; border:none; cursor:pointer; font-size:17px; box-shadow:0 8px 20px rgba(245,158,11,0.3); outline:none;">TAP TO WATCH AD</button>' +
                    '<button onclick="document.getElementById(\'ad-watching-overlay\').style.display=\'none\'; resetAdButtons();" style="margin-top:24px; color:#666; background:none; border:none; font-size:13px; cursor:pointer;">Not now</button>';

                const watchBtn = document.getElementById('ad-watch-btn');
                if (watchBtn) {
                    watchBtn.onclick = async () => {
                        watchBtn.disabled = true;
                        watchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading Ad...';

                        function showAdPlayingUI() {
                            const AD_DURATION = 5; // Reduced to 5 seconds as requested

                            contentBox.innerHTML =
                                '<div style="width:70px; height:70px; border:4px solid rgba(245,158,11,0.15); border-top-color:#f59e0b; border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 24px;"></div>' +
                                '<div style="font-size:20px; font-weight:800; margin-bottom:6px;">Ad is Playing...</div>' +
                                '<p style="font-size:13px; color:#888; margin-bottom:20px; line-height:1.5;">Watch the ad appearing on screen<br>to earn your reward</p>' +
                                '<div style="width:100%; height:8px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden; margin-bottom:16px;">' +
                                '<div id="ad-timer-progress" style="height:100%; width:0%; background:linear-gradient(90deg,#f59e0b,#22c55e); border-radius:4px; transition:width 0.25s linear;"></div>' +
                                '</div>' +
                                '<div id="ad-timer-text" style="font-size:50px; font-weight:900; color:#f59e0b; line-height:1;">' + AD_DURATION + '</div>' +
                                '<p style="font-size:11px; color:#444; margin-top:12px;">seconds remaining</p>';

                            const adStartTime = Date.now();
                            const adEndTime = adStartTime + AD_DURATION * 1000;
                            let adDone = false;

                            function tickAd() {
                                if (adDone) return;
                                const now = Date.now();
                                const remaining = Math.max(0, adEndTime - now);
                                const elapsed = now - adStartTime;
                                const secsLeft = Math.ceil(remaining / 1000);
                                const pct = Math.min(100, (elapsed / (AD_DURATION * 1000)) * 100);
                                const progEl = document.getElementById('ad-timer-progress');
                                const txtEl = document.getElementById('ad-timer-text');
                                if (progEl) progEl.style.width = pct + '%';
                                if (txtEl) txtEl.textContent = secsLeft;
                                if (remaining <= 0) {
                                    adDone = true;
                                    showAdCompletionScreen();
                                    return;
                                }
                                setTimeout(tickAd, 250);
                            }
                            tickAd();
                            setTimeout(() => { if (!adDone) { adDone = true; showAdCompletionScreen(); } }, (AD_DURATION + 3) * 1000);
                        }

                        // ============================================
                        // OPTION 1: Adsgram SDK
                        // ============================================
                        if (adsgramBlockId && window.Adsgram) {
                            try {
                                const AdController = window.Adsgram.init({ blockId: String(adsgramBlockId) });
                                let handled = false;
                                await AdController.show()
                                    .then(() => {
                                        handled = true;
                                        showAdCompletionScreen();
                                    })
                                    .catch((result) => {
                                        handled = true;
                                        if (result && result.done) {
                                            showAdCompletionScreen();
                                        } else {
                                            watchBtn.disabled = false;
                                            watchBtn.innerHTML = 'TAP TO WATCH AD';
                                            window.showToast('Please watch the full ad to earn your reward.');
                                        }
                                    });
                                if (handled) return;
                            } catch (err) {
                                console.warn('[Adsgram] SDK error:', err.message);
                            }
                        }

                        // ============================================
                        // OPTION 2: Monetag / Direct Links Fallback
                        // ============================================
                        if (monetagPublisherId) {
                            try {
                                const monetagSDK = document.createElement('script');
                                monetagSDK.src = '//libtl.com/sdk.js';
                                monetagSDK.setAttribute('data-zone', monetagPublisherId);
                                monetagSDK.setAttribute('data-sdk', 'show_' + monetagPublisherId);
                                document.body.appendChild(monetagSDK);
                                setTimeout(() => {
                                    const inpageScript = document.createElement('script');
                                    inpageScript.src = 'https://thubanoa.com/1?z=' + monetagPublisherId;
                                    inpageScript.async = true;
                                    document.body.appendChild(inpageScript);
                                }, 500);
                            } catch (e) { }

                            if (monetagDirectUrl) {
                                if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(monetagDirectUrl);
                                else window.open(monetagDirectUrl, '_blank');
                            }
                            showAdPlayingUI();
                            return;
                        }

                        if (anyDirectUrl) {
                            if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(anyDirectUrl);
                            else window.open(anyDirectUrl, '_blank');
                            showAdPlayingUI();
                            return;
                        }

                        // If no ad found, fallback to silent timer to ensure reward
                        showAdPlayingUI();
                    }; // end watchBtn.onclick
                } // end if (watchBtn)
            } // end if (contentBox)

            function showAdCompletionScreen() {
                const contentBox = document.getElementById('ad-content-box');
                const overlay = document.getElementById('ad-watching-overlay');
                if (!contentBox) return;

                if (currentAdContext === 'quiz_direct' || currentAdContext === 'scratch_ad' || currentAdContext === 'scratch_retry') {
                    if (overlay) overlay.style.display = 'none';
                    claimAdReward();
                    return;
                }

                contentBox.innerHTML =
                    '<div style="width:80px; height:80px; background:linear-gradient(135deg, #22c55e, #16a34a); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; box-shadow:0 12px 32px rgba(34,197,94,0.4);">' +
                    '<i class="fas fa-check" style="font-size:36px; color:#fff;"></i>' +
                    '</div>' +
                    '<div style="font-size:22px; font-weight:900; margin-bottom:8px; color:#22c55e;">Ad Complete!</div>' +
                    '<p style="font-size:14px; color:#aaa; margin-bottom:28px; line-height:1.5;">Your reward is ready. Tap below to claim it now!</p>' +
                    '<button id="ad-claim-btn" style="width:100%; padding:18px; background:linear-gradient(135deg, #22c55e, #16a34a); color:#fff; font-weight:900; border-radius:30px; border:none; cursor:pointer; font-size:17px; box-shadow:0 8px 20px rgba(34,197,94,0.3);">' +
                    '<i class="fas fa-gift" style="margin-right:8px;"></i>CLAIM REWARD' +
                    '</button>' +
                    '<button onclick="document.getElementById(\'ad-watching-overlay\').style.display=\'none\'; resetAdButtons();" style="margin-top:16px; color:#666; background:none; border:none; font-size:13px; cursor:pointer;">Not now</button>';

                const claimBtn = document.getElementById('ad-claim-btn');
                if (claimBtn) {
                    claimBtn.onclick = () => {
                        if (overlay) overlay.style.display = 'none';
                        claimAdReward();
                    };
                }
            }
        })
        .catch(err => {
            clearTimeout(safetyTimeout);
            console.error('Ad config fetch failed:', err);
            // Show timer anyway so user isn't stuck
            const box = document.getElementById('ad-content-box');
            if (box) {
                box.innerHTML = '<div style="font-size:16px; color:#aaa; margin-bottom:20px;">Loading ad...</div>' +
                    '<div style="width:50px; height:50px; border:4px solid rgba(255,255,255,0.1); border-top-color:#f59e0b; border-radius:50%; animation:spin 1s linear infinite; margin:0 auto;"></div>';
                setTimeout(() => {
                    if (overlay) overlay.style.display = 'none';
                    claimAdReward();
                }, 5000);
            }
        });
}




function resetAdButtons() {
    const dailyBtn = document.getElementById('claimDailyBtn');
    if (dailyBtn && dailyBtn.innerHTML.includes('AD LOADING...')) {
        dailyBtn.innerHTML = '<i class="fas fa-gift"></i> CLAIM DAILY REWARD';
        dailyBtn.style.opacity = '1';
    }

    if (activeTaskButton && activeTaskButton.innerHTML.includes('fa-spinner')) {
        activeTaskButton.disabled = false;
        activeTaskButton.innerHTML = activeTaskButton.dataset.originalText || 'START';
    }
}

function closeAdModal() { }

async function claimAdReward() {
    // Reset buttons first
    resetAdButtons();
    if (adRewardClaimed) return;
    adRewardClaimed = true;

    try {
        const res = await fetch('/api/ad/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, context: currentAdContext })
        });
        const data = await res.json();

        if (data.success) {
            if (window.confetti && currentAdContext === 'watch_ad') {
                confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
            }

            let msg = `🎉 Reward claimed!`;
            if (currentAdContext === 'watch_ad' || currentAdContext === 'zero_balance_trigger') msg = `📺 +${data.reward || parseInt(window.appCostConfig?.zeroBalanceAdReward) || 5} Tokens rewarded for Watching Ad!`;
            else if (currentAdContext === 'quiz_direct') msg = `🧠 Quiz unlocked! Good luck.`;
            else if (currentAdContext === 'scratch_ad' || currentAdContext === 'scratch_retry') msg = `✨ Scratch card unlocked!`;
            else if (currentAdContext === 'task_verification') msg = `✅ Ad verification complete. Please Verify the task.`;
            else if (currentAdContext === 'gift_claim') msg = `🎁 Gift ad verified! Claiming your gift...`;

            window.showToast(msg);

            if (data.newBalance !== undefined) {
                userData.tokens = data.newBalance;
                updateBalanceUI();
                loadRecentActivity(); // Refresh history after ad reward
            }

            // Navigation
            if (currentAdContext === 'quiz_direct') {
                showPage('quiz');
                loadQuiz();
            } else if (currentAdContext === 'scratch_ad' || currentAdContext === 'scratch_retry') {
                showPage('scratch');
                initScratchCard();
            } else if (currentAdContext === 'task_verification' && activeTaskButton) {
                // Task Ad Completed - Now show OPEN LINK button
                activeTaskButton.textContent = 'VERIFY';
                activeTaskButton.style.background = '#22c55e';
                activeTaskButton.style.display = 'block';
                
                if (activeTaskData && activeTaskData.taskId) {
                    IN_PROGRESS_TASKS[activeTaskData.taskId] = 'VERIFY';
                }
                activeTaskButton.disabled = false;
                
                const currentTaskData = { ...activeTaskData }; // copy data
                const currentBtn = activeTaskButton;
                
                activeTaskButton.onclick = function () {
                    window.open(currentTaskData.url, '_blank');
                    
                    // Update onclick to actually verify on next click
                    currentBtn.onclick = function () {
                        completeTask(currentTaskData.taskId, currentTaskData.reward, currentBtn, currentTaskData.url);
                    };
                };

                // Timer to reset to START after 1 minute if not completed
                setTimeout(() => {
                    if (currentBtn.textContent === 'VERIFY') {
                        currentBtn.textContent = 'START';
                        currentBtn.style.background = ''; // reset to default
                        currentBtn.onclick = function() {
                            startTask(currentBtn, currentTaskData.taskId, currentTaskData.url, currentTaskData.reward);
                        };
                    }
                }, 60000); // 1 minute
            } else if (currentAdContext === 'gift_claim' && pendingGiftId) {
                // Gift Ad Completed - Now claim the gift
                claimGiftReward(pendingGiftId);
            } else if (currentAdContext === 'watch_ad' || currentAdContext === 'zero_balance_trigger') {
                // Ensure user goes back to the home page or previous active page to prevent blank screen
                if (!currentPage || document.querySelectorAll('.page.active').length === 0) {
                    showPage('home');
                }
            }
        } else {
            window.showToast(data.message || 'Error claiming ad reward');
            adRewardClaimed = false;
        }
    } catch (e) {
        console.error('Ad Claim Error:', e);
        adRewardClaimed = false;
    }
}

// ==========================================
// GIFT POPUP SYSTEM
// ==========================================
let pendingGiftId = null;

async function checkPendingGifts() {
    if (!userData || !userData.id) return;
    try {
        const res = await fetch('/api/user/gifts?userId=' + userData.id);
        const data = await res.json();
        if (data.success && data.gifts && data.gifts.length > 0) {
            // Show popup for the first unclaimed gift
            showGiftPopup(data.gifts[0]);
        }
    } catch (e) {
        console.error('Gift check error:', e);
    }
}

function showGiftPopup(gift) {
    const currencyLabel = gift.currency === 'tokens' ? 'Tokens' : gift.currency === 'Gems' ? 'Gems' : 'USD';
    const currencyIcon = gift.currency === 'tokens' ? 'fa-coins' : gift.currency === 'Gems' ? 'fa-gem' : 'fa-dollar-sign';
    const currencyColor = gift.currency === 'tokens' ? '#fbbf24' : gift.currency === 'Gems' ? '#38bdf8' : '#22c55e';

    // Remove existing gift popup if any
    const existing = document.getElementById('giftPopupOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'giftPopupOverlay';
    overlay.style.cssText = 'display:flex; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.92); z-index:9999999; flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(15px); color:white; font-family:sans-serif; text-align:center;';

    overlay.innerHTML = `
        <div style="padding:30px; width:100%; max-width:320px;">
            <div style="width:90px; height:90px; background:linear-gradient(135deg,#f59e0b,#d97706); border-radius:28px; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; box-shadow:0 12px 32px rgba(245,158,11,0.4); animation: pulse 2s ease-in-out infinite;">
                <i class="fas fa-gift" style="font-size:40px; color:#fff;"></i>
            </div>
            <div style="font-size:24px; font-weight:900; margin-bottom:8px; color:#f59e0b;">🎁 You Got a Gift!</div>
            <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:20px; margin-bottom:20px;">
                <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:8px;">
                    <i class="fas ${currencyIcon}" style="font-size:28px; color:${currencyColor};"></i>
                    <span style="font-size:32px; font-weight:900; color:${currencyColor};">${gift.amount}</span>
                    <span style="font-size:16px; font-weight:700; color:${currencyColor};">${currencyLabel}</span>
                </div>
                ${gift.note ? `<div style="font-size:13px; color:rgba(255,255,255,0.6); margin-top:8px;">${gift.note}</div>` : ''}
            </div>
            <p style="font-size:13px; color:#888; margin-bottom:24px; line-height:1.5;">Watch a short ad to claim your gift!</p>
            <button id="giftReadingNowBtn" style="width:100%; padding:16px; background:linear-gradient(135deg,#f59e0b,#d97706); color:#000; font-weight:900; border-radius:30px; border:none; cursor:pointer; font-size:16px; box-shadow:0 8px 20px rgba(245,158,11,0.3);">
                <i class="fas fa-play mr-2"></i>Reading Now
            </button>
            <button onclick="document.getElementById('giftPopupOverlay').style.display='none'" style="margin-top:16px; color:#666; background:none; border:none; font-size:13px; cursor:pointer;">Later</button>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('giftReadingNowBtn').onclick = () => {
        overlay.style.display = 'none';
        pendingGiftId = gift.id;
        showAdAndEarn('gift_claim');
    };
}

async function claimGiftReward(giftId) {
    if (!giftId || !userData || !userData.id) return;
    try {
        const res = await fetch('/api/gift/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, giftId: giftId })
        });
        const data = await res.json();

        if (data.success) {
            if (window.confetti) {
                confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 }, colors: ['#f59e0b', '#fbbf24', '#22c55e'] });
            }

            // Update local balances
            if (data.newTokens !== undefined) userData.tokens = data.newTokens;
            if (data.newGems !== undefined) userData.Gems = data.newGems;
            if (data.newUsd !== undefined) userData.usd = data.newUsd;
            updateBalanceUI();
            loadRecentActivity();

            window.showToast(`🎁 Gift claimed! +${data.amount} ${data.currency === 'tokens' ? 'Tokens' : data.currency === 'Gems' ? 'Gems' : 'USD'}`);

            // Check for more pending gifts
            pendingGiftId = null;
            setTimeout(checkPendingGifts, 2000);
        } else {
            window.showToast(data.message || 'Failed to claim gift');
            pendingGiftId = null;
        }
    } catch (e) {
        console.error('Gift claim error:', e);
        window.showToast('Network error claiming gift');
        pendingGiftId = null;
    }
}

// ==========================================

function checkZeroBalanceAdTrigger(requiredAmount = 1) {
    const currentTokens = userData.tokens || 0;
    if (currentTokens < requiredAmount) {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');

        const needed = requiredAmount - currentTokens;
        const perAd = (window.appCostConfig && Number.isFinite(parseInt(window.appCostConfig.zeroBalanceAdReward)))
            ? parseInt(window.appCostConfig.zeroBalanceAdReward)
            : 5;
        const adsNeeded = Math.ceil(needed / perAd);

        if (adsNeeded > 1) {
            window.showToast(`Insufficient balance! You need ${requiredAmount} tokens. Watch ${adsNeeded} ads to earn tokens.`);
        } else {
            window.showToast(`Insufficient balance! Watch a short ad to get ${perAd} tokens.`);
        }

        setTimeout(() => {
            showAdAndEarn('zero_balance_trigger');
        }, 1500);
        return true;
    }
    return false;
}

window.showAdAndEarn = showAdAndEarn;
window.closeAdModal = closeAdModal;
window.claimAdReward = claimAdReward;

// ==========================================
// DAILY BONUS SYSTEM (PREMIUM)
// ==========================================

function renderDailyGrid() {
    const grid = document.getElementById('dailyRewardsGrid');
    if (!grid) return;

    // Fixed 7-day rewards
    const rewards = [10, 20, 30, 40, 50, 60, 100];
    let userClaimedDay = userData.dailyStreak || 0; // Days completed
    const lastClaim = userData.lastDailyClaim || 0; // Timestamp
    const now = Date.now();
    const canClaim = (now - lastClaim) >= 24 * 60 * 60 * 1000;

    // Reset local view if streak is broken (> 48h) or starting a new week after day 7
    if (lastClaim > 0 && (now - lastClaim > 48 * 60 * 60 * 1000)) {
        userClaimedDay = 0;
    } else if (userClaimedDay === 7 && canClaim) {
        userClaimedDay = 0; // Reset visual cycle to day 1
    }

    let html = '';
    for (let i = 1; i <= 7; i++) {
        const isClaimed = i <= userClaimedDay;
        const isActive = i === userClaimedDay + 1 && canClaim;
        const isDay7 = i === 7;

        // Show green checkmark for claimed days, otherwise show coins/crown
        let iconHtml;
        if (isClaimed) {
            iconHtml = `<i class="fas fa-check-circle" style="color: #22c55e; font-size: 28px;"></i>`; // Green checkmark
        } else if (isDay7) {
            iconHtml = `
                <i class="fas fa-crown" style="color: #fbbf24; font-size: 32px;"></i>
                <div style="display: flex; flex-direction: column; align-items: flex-start;">
                    <span style="font-size:18px; color: #fbbf24;">BIG REWARD</span>
                    <span style="font-size:12px; color: #aaa;">100 Tokens + 2 Gems</span>
                </div>
            `;
        } else {
            iconHtml = `<i class="fas fa-coins" style="color: #fbbf24; font-size: 24px;"></i>`;
        }

        let rewardText = `${rewards[i - 1]} tokens`;

        if (i === 5 || i === 6) {
            rewardText = `${rewards[i - 1]} tokens + <i class="fas fa-gem" style="color:#38bdf8;"></i> 1`;
        } else if (i === 7) {
            rewardText = `2 <i class="fas fa-gem" style="color:#38bdf8;"></i>`;
        }

        // Styling for claimed days
        const claimedStyle = isClaimed ? 'background: rgba(34, 197, 94, 0.1) !important; border-color: #22c55e !important;' : '';
        const claimedLabelStyle = isClaimed ? 'color: #22c55e !important;' : '';
        const claimedRewardStyle = isClaimed ? 'color: #22c55e !important;' : '';

        html += `
        <div class="ds-day ${isClaimed ? 'claimed' : ''} ${isActive ? 'active' : ''} ${isDay7 ? 'day-7' : ''}" style="${claimedStyle}">
            <div class="ds-day-label" style="${claimedLabelStyle}">DAY ${i}</div>
            <div class="ds-day-icon" style="${isDay7 ? 'flex-direction: row; gap: 10px;' : ''}">
                ${iconHtml}
            </div>
            <div class="ds-day-reward" style="${isDay7 ? 'text-align: right;' : ''} ${claimedRewardStyle}">${rewardText}</div>
        </div>`;
    }
    grid.innerHTML = html;

    // Update button text
    const btn = document.getElementById('claimDailyBtn');
    const lbl = document.getElementById('dailyLabel');
    if (btn) {
        if (!canClaim) {
            btn.innerHTML = 'ALREADY CLAIMED';
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.background = '#222';
            btn.style.color = '#555';
            btn.style.boxShadow = 'none';
            if (lbl) {
                lbl.style.background = 'rgba(255,255,255,0.05)';
                lbl.style.border = '1px solid rgba(255,255,255,0.1)';
                lbl.style.color = '#666';
            }
        } else {
            btn.innerHTML = 'CLAIM REWARD';
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.background = 'linear-gradient(135deg, #fbbf24, #f59e0b)';
            btn.style.color = '#000';
            btn.style.boxShadow = '0 12px 30px rgba(245, 158, 11, 0.3)';
            if (lbl) {
                lbl.style.background = 'rgba(251, 191, 36, 0.1)';
                lbl.style.border = '1px solid rgba(251, 191, 36, 0.2)';
                lbl.style.color = '#fbbf24';
            }
        }
    }
}
var dailyInterval = null;
function startDailyCountdown() {
    const el = document.getElementById('dailyCountdown');
    if (!el) return;

    if (dailyInterval) clearTimeout(dailyInterval);

    function update() {
        const lastClaim = userData.lastDailyClaim || 0;
        const nextClaim = lastClaim + (24 * 60 * 60 * 1000);
        const now = Date.now();
        const diff = nextClaim - now;

        if (diff <= 0) {
            el.textContent = 'READY';
            const textEl = document.getElementById('dailyCountdownText');
            if (textEl) textEl.textContent = 'READY';
            renderDailyGrid(); // Re-render if state changes
            return;
        }

        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        const timeStr = `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        el.textContent = timeStr;
        const textEl = document.getElementById('dailyCountdownText');
        if (textEl) textEl.textContent = timeStr;
        dailyInterval = setTimeout(update, 1000);
    }
    update();
}

function claimDaily() {
    const btn = document.getElementById('claimDailyBtn');
    if (!btn || btn.disabled) return;

    // The user wants mandatory ad watching for daily reward
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AD LOADING...';
    btn.style.opacity = '0.7';

    window.showToast("📺 Please watch a short ad to claim your Daily Reward");

    // We replace the original function with an ad-triggered one
    showAdAndEarn('daily_claim_ad');

    // We override claimAdReward once for this specific context
    const originalClaimAdReward = window.claimAdReward;
    window.claimAdReward = async function () {
        // Restore original after one use
        window.claimAdReward = originalClaimAdReward;

        if (currentAdContext !== 'daily_claim_ad') {
            return originalClaimAdReward();
        }

        // Now actually claim the daily reward
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CLAIMING...';
        btn.disabled = true;

        try {
            const res = await fetch('/api/daily/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: userData.id })
            });
            const data = await res.json();

            if (data.success) {
                userData.tokens = data.newBalance;
                userData.dailyStreak = data.streak;
                userData.lastDailyClaim = Date.now();
                window.showToast(`✅ Daily reward claimed! +${data.reward} Tokens`);
                renderDailyGrid();
                renderBalances();
                startDailyCountdown();
            } else {
                window.showToast(data.message || 'Failed to claim daily reward');
                renderDailyGrid();
            }
        } catch (err) {
            console.error('Error claiming daily:', err);
            window.showToast('❌ Error claiming daily reward');
            renderDailyGrid();
        }
    };
}

async function redeemCode() {
    const input = document.getElementById('redeemCodeInput');
    if (!input) return;
    const code = input.value.trim();
    if (!code) {
        window.showToast('Please enter a code');
        return;
    }

    const btn = document.querySelector('#redeemPage .gv-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> REDEEMING...';
    }

    try {
        const res = await fetch('/api/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, code: code })
        });
        const data = await res.json();
        if (data.success) {
            // Show success checkmark modal
            showRedeemSuccessModal(data.reward);
            userData.tokens = data.newTokens;
            renderBalances();
            loadRecentActivity(); // Refresh history
            input.value = '';
        } else {
            window.showToast(`❌ ${data.message || 'Invalid code'}`);
        }
    } catch (e) {
        window.showToast('Network error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'REDEEM NOW';
        }
    }
}

// ==========================================
// LEADERBOARD SYSTEM (PREMIUM)
// ==========================================

let currentLeaderboardTab = 'refer';

function renderReferralLeaderboard() {
    if (typeof renderPodiumLeaderboard !== 'undefined') {
        renderPodiumLeaderboard('refer', currentReferPeriod, {
            podiumId: 'referralPodium',
            listId: 'referralLeadList',
            rankId: 'referralPersonalRank',
            timeId: 'referralTimeLeft',
            cycleId: 'referralCycleInfo',
            progressId: 'referralProgressBar'
        });
    } else {
        renderGenericLeaderboard('refer', 'referralLeadList');
    }
}

// Global variables to keep track of current period tab
let currentEarnEarnPeriod = 'week';
let currentReferPeriod = 'week';

function renderEarnedLeaderboard() {
    renderPodiumLeaderboard('earn', currentEarnEarnPeriod, {
        podiumId: 'earnedPodium',
        listId: 'earnedLeadList',
        rankId: 'earnedPersonalRank',
        timeId: 'earnedTimeLeft',
        cycleId: 'earnedCycleInfo',
        progressId: 'earnedProgressBar'
    });
}

function renderPodiumLeaderboard(type, period, ids) {
    const podiumEl = document.getElementById(ids.podiumId);
    const listEl = document.getElementById(ids.listId);
    const personalRankEl = document.getElementById(ids.rankId);

    if (!podiumEl || !listEl) return;

    podiumEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub); width:100%;"><i class="fas fa-spinner fa-spin"></i> Loading Top 3...</div>';
    listEl.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);"><i class="fas fa-spinner fa-spin"></i> Loading others...</div>';

    // Simple client-side cache for leaderboard
    window._leaderboardCache = window._leaderboardCache || {};
    const cacheKey = `${userData.id}-${type}-${period}`;
    const nowMs = Date.now();
    let fetchPromise;

    if (window._leaderboardCache[cacheKey] && nowMs - window._leaderboardCache[cacheKey].time < 2000) {
        // Use cached data
        fetchPromise = Promise.resolve(window._leaderboardCache[cacheKey].data);
    } else {
        fetchPromise = fetch(`/api/leaderboard?userId=${userData.id}&type=${type}&period=${period}`)
            .then(r => r.json())
            .then(data => {
                window._leaderboardCache[cacheKey] = { time: nowMs, data: data };
                return data;
            });
    }

    fetchPromise.then(data => {
        if (!data.success || !data.top) {
            podiumEl.innerHTML = '<div style="text-align:center; padding:20px; color:#666; width:100%;">No rankings available.</div>';
            listEl.innerHTML = '';
            return;
        }

        // Update 7-day Countdown Timer
        const now = new Date();
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        let cycleStartTime = startOfWeek.getTime();
        let cycleEndTime = endOfWeek.getTime();

        if (period === 'month') {
            cycleStartTime = startOfMonth.getTime();
            cycleEndTime = endOfMonth.getTime();
        }

        const cycleDuration = cycleEndTime - cycleStartTime;
        const elapsedTimeInCycle = now.getTime() - cycleStartTime;
        const timeLeft = cycleEndTime - now.getTime();

        const daysLeft = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hoursLeft = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const percentage = Math.floor((elapsedTimeInCycle / cycleDuration) * 100);

        const tlEl = document.getElementById(ids.timeId);
        const cycleEl = document.getElementById(ids.cycleId);
        const progressEl = document.getElementById(ids.progressId);

        if (tlEl) tlEl.textContent = `${daysLeft}d ${hoursLeft}h left`;
        if (cycleEl) cycleEl.textContent = `Current cycle • ${percentage}% complete`;
        if (progressEl) progressEl.style.width = `${percentage}%`;

        const top3 = data.top.slice(0, 3);
        const others = data.top.slice(3, 100);

        // Structure: 2nd, 1st, 3rd for podium display
        let podiumHTML = '';
        const podiumOrder = [1, 0, 2]; // index 1 (2nd), index 0 (1st), index 2 (3rd)

        const styles = [
            { color: '#f59e0b', size: 76, badge: '#1', showCrown: true, width: '33.33%', reward: type === 'earn' ? '1,000 Tokens' : type === 'quiz' ? '1,000 Points' : 'Premium Box' }, // 1st
            { color: '#cbd5e1', size: 60, badge: '#2', showCrown: false, width: '33.33%', reward: type === 'earn' ? '800 Tokens' : type === 'quiz' ? '800 Points' : 'Gold Box' }, // 2nd
            { color: '#d97706', size: 60, badge: '#3', showCrown: false, width: '33.33%', reward: type === 'earn' ? '600 Tokens' : type === 'quiz' ? '600 Points' : 'Silver Box' }  // 3rd
        ];

        const scoreIcon = type === 'earn' ?
            `<svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b"><path d="M12 2L2 9.5L5.5 22H18.5L22 9.5L12 2Z"/></svg>` :
            type === 'quiz' ? `<i class="fas fa-bolt" style="color:#22c55e; font-size:12px;"></i>` :
                `<i class="fas fa-users" style="color:#f59e0b; font-size:12px;"></i>`;

        podiumOrder.forEach(idx => {
            const u = top3[idx];
            const style = styles[idx];
            if (!u) {
                // Placeholder if less than 3
                podiumHTML += `
                    <div style="display: flex; flex-direction: column; align-items: center; width: ${style.width}; opacity: 0.8;">
                        ${style.showCrown ? '<i class="fas fa-crown" style="color: rgba(255,255,255,0.3); font-size: 28px; margin-bottom: -8px; z-index: 10;"></i>' : '<div style="height: 20px;"></div>'}
                        <div style="position: relative; margin-bottom: 12px; z-index: 5;">
                            <div style="width: ${style.size}px; height: ${style.size}px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 24px; color: rgba(255,255,255,0.2);">?</div>
                            <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #333; color: #888; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 10px;">${style.badge}</div>
                        </div>
                        <div style="font-size: 13px; font-weight: 800; color: #555; margin-bottom: 4px; text-align: center;">---</div>
                        <div style="display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: rgba(255,255,255,0.2); margin-bottom: 8px;">
                            ---
                        </div>
                        <div style="background: rgba(255, 255, 255, 0.05); border: 1px dashed rgba(255, 255, 255, 0.1); color: #888; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 800; margin-top: auto;">${style.reward}</div>
                    </div>`;
                return;
            }

            const avatarUrl = u.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&color=fff&size=80`;
            const glowClass = style.showCrown ? 'box-shadow: 0 0 20px rgba(245,158,11,0.6), 0 4px 12px rgba(0,0,0,0.5);' : 'box-shadow: 0 4px 12px rgba(0,0,0,0.5);';

            podiumHTML += `
                <div style="display: flex; flex-direction: column; align-items: center; width: ${style.width};">
                    ${style.showCrown ? '<i class="fas fa-crown" style="color: #f59e0b; font-size: 28px; margin-bottom: -8px; z-index: 10; text-shadow: 0 2px 10px rgba(245,158,11,0.5);"></i>' : '<div style="height: 20px;"></div>'}
                    <div style="position: relative; margin-bottom: 12px; z-index: 5;">
                        <img src="${avatarUrl}" style="width: ${style.size}px; height: ${style.size}px; border-radius: 50%; border: 3px solid ${style.color}; object-fit: cover; ${glowClass}">
                        <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: ${style.showCrown ? '#f59e0b' : '#fff'}; color: #000; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${style.badge}</div>
                    </div>
                    <div style="font-size: 13px; font-weight: 800; color: #fff; margin-bottom: 4px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; padding: 0 4px;">${u.name}</div>
                    <div style="display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 13px; font-weight: 800; color: ${type === 'quiz' ? '#22c55e' : '#f59e0b'}; margin-bottom: 8px;">
                        ${scoreIcon}
                        ${formatCompact(u.score || 0)}
                    </div>
                    <div style="background: rgba(${type === 'quiz' ? '34, 197, 94' : '245, 158, 11'}, 0.15); border: 1px solid rgba(${type === 'quiz' ? '34, 197, 94' : '245, 158, 11'}, 0.3); color: ${type === 'quiz' ? '#22c55e' : '#f59e0b'}; padding: 4px 10px; border-radius: 12px; font-size: 10px; font-weight: 800; margin-top: auto; white-space: nowrap;">${style.reward}</div>
                </div>`;
        });

        podiumEl.innerHTML = podiumHTML;

        // Render rest of the list
        if (others.length > 0) {
            let html = others.slice(0, 96).map((u, i) => {
                const rank = i + 4;
                const isMe = String(u.id) === String(userData.id);

                return `
                    <div class="lead-row" style="background: var(--bg-card); border-radius: 16px; margin-bottom: 0; padding: 12px 16px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); ${isMe ? 'border-color: #f59e0b; background: rgba(245,158,11,0.05);' : ''}">
                        <div style="font-size: 14px; font-weight: 800; color: var(--text-sub); width: 24px; text-align: center;">${rank}</div>
                        <img src="${u.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&color=fff&size=40`}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                        <div style="flex-grow: 1;">
                            <div style="font-size: 14px; font-weight: 700; color: #fff;">${u.name}${isMe ? ' <span style="color:#f59e0b; font-size:10px;">(YOU)</span>' : ''}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; font-weight: 800; color: #fff;">
                            ${scoreIcon}
                            ${formatCompact(u.score || 0)}
                        </div>
                    </div>`;
            }).join('');

            if (others.length >= 96) {
                html += `
                    <div class="lead-row" style="background: transparent; border-radius: 16px; margin-bottom: 0; padding: 16px; display: flex; justify-content: center; align-items: center; gap: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                        <div style="font-size: 14px; font-weight: 800; color: #888;">99+</div>
                        <div style="font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4);">More users contending</div>
                    </div>`;
            }

            listEl.innerHTML = html;
        } else {
            listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#666; font-size:12px;">No more contenders.</div>';
        }

        // Update Personal Rank Footer
        if (personalRankEl) {
            let userRank = data.userRank || '-';
            if (userRank > 99) userRank = '99+';
            const userScore = data.userScore || 0;
            const pointsToNext = '--'; // Difficult to calculate without full data points, maybe just mock or omit. Let's omit subtitle or say "Complete tasks to earn points" if rank is '-'

            let actionWord = type === 'earn' ? 'earning' : type === 'quiz' ? 'playing' : 'referring';
            let subtitleHtml = `<div style="font-size: 11px; color: rgba(255,255,255,0.5);">Keep ${actionWord} to climb the ranks!</div>`;
            if (userRank === '-' || data.userRank > 100) {
                if (type === 'refer') {
                    subtitleHtml = `<div style="font-size: 11px; color: rgba(255,255,255,0.5);">Invite friends to enter the leaderboard.</div>`;
                } else if (type === 'earn') {
                    subtitleHtml = `<div style="font-size: 11px; color: rgba(255,255,255,0.5);">Complete tasks and earn tokens to enter.</div>`;
                } else {
                    subtitleHtml = `<div style="font-size: 11px; color: rgba(255,255,255,0.5);">Play quiz to enter the leaderboard.</div>`;
                }
            }

            personalRankEl.innerHTML = `
                    <div style="width: 44px; height: 44px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); overflow: hidden; flex-shrink: 0;">
                        <img src="${userData.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.firstName)}&background=random&color=fff`}" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div style="flex-grow: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <div style="font-weight: 700; color: #fff; font-size: 15px;">Your Rank</div>
                            <div style="background: rgba(${type === 'quiz' ? '34, 197, 94' : '245, 158, 11'}, 0.2); color: ${type === 'quiz' ? '#22c55e' : '#f59e0b'}; padding: 2px 8px; border-radius: 8px; font-size: 12px; font-weight: 800;">${userRank}</div>
                        </div>
                        ${subtitleHtml}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 16px; color: #fff;">
                        ${scoreIcon}
                        ${formatCompact(userScore)}
                    </div>
                `;
        }

    })
        .catch((e) => {
            console.error("Leaderboard Error:", e);
            podiumEl.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444; width:100%;">Failed to load rankings.</div>';
            listEl.innerHTML = '';
        });
}

function renderGenericLeaderboard(type, listId) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    // Simple client-side cache for leaderboard
    window._leaderboardGenericCache = window._leaderboardGenericCache || {};
    const cacheKey = `${userData.id}-${type}`;
    const nowMs = Date.now();
    let fetchPromise;

    if (window._leaderboardGenericCache[cacheKey] && nowMs - window._leaderboardGenericCache[cacheKey].time < 2000) {
        // Use cached data
        fetchPromise = Promise.resolve(window._leaderboardGenericCache[cacheKey].data);
    } else {
        fetchPromise = fetch(`/api/leaderboard?userId=${userData.id}&type=${type}`)
            .then(r => r.json())
            .then(data => {
                window._leaderboardGenericCache[cacheKey] = { time: nowMs, data: data };
                return data;
            });
    }

    fetchPromise.then(data => {
        if (!data.success || !data.top) {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">No rankings available.</div>';
            return;
        }

        let renderedHtml = data.top.slice(0, 99).map((u, i) => {
            const rank = i + 1;
            let rankClass = 'rank-other';
            if (rank === 1) rankClass = 'rank-1';
            else if (rank === 2) rankClass = 'rank-2';
            else if (rank === 3) rankClass = 'rank-3';

            const isMe = String(u.id) === String(userData.id);

            const scoreLabel = type === 'earn' ? 'TOKENS' : 'REFERRALS';
            const scoreValue = u.score || 0;

            return `
            <div class="lead-row" style="${isMe ? 'border: 1px solid #f59e0b; background: rgba(245,158,11,0.08);' : ''}">
                <div class="lead-rank ${rankClass}">#${rank}</div>
                <div class="lead-avatar">
                   <img src="${u.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&color=fff&size=40`}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=f59e0b&color=000&size=40'">
                </div>
                <div class="lead-info">
                    <div class="lead-name">${u.name}${isMe ? ' <span style="color:#f59e0b;font-size:10px;">YOU</span>' : ''}</div>
                    <div class="lead-uid">ID: ${u.id}</div>
                </div>
                <div class="lead-count-box">
                    <div class="lead-count">${scoreLabel === 'TOKENS' ? formatCompact(scoreValue) : scoreValue}</div>
                    <div class="lead-label">${scoreLabel}</div>
                </div>
            </div>`;
        }).join('');

        if (data.top.length >= 99) {
            renderedHtml += `
            <div class="lead-row" style="background: transparent; border-radius: 16px; margin-bottom: 0; padding: 16px; display: flex; justify-content: center; align-items: center; gap: 12px; border: 1px dashed rgba(255,255,255,0.1);">
                <div style="font-size: 14px; font-weight: 800; color: #888;">99+</div>
                <div style="font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.4);">More users contending</div>
            </div>`;
        }

        list.innerHTML = renderedHtml;

        // Update personal rank if available in profile display
        const rankEl = document.getElementById('profile-rank');
        if (rankEl && data.userRank && type === 'refer') {
            rankEl.textContent = `#${data.userRank}`;
        }
    })
        .catch(() => {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444;">Failed to load rankings.</div>';
        });
}

// Keep old functions for compatibility but redirected
function switchLeaderboardTab(tab) {
    if (tab === 'refer') nav('referralLeaderboard');
    else nav('earnedLeaderboard');
}

function renderLeaderboard() {
    nav('referralLeaderboard');
}

// UPDATE INVITE UI
function updateInviteUI() {
    const banner = document.getElementById('inviteBonusBanner');
    if (banner) {
        banner.innerHTML = `Invite a friend and get <span style="color:#f59e0b; font-weight:800">${appConfig.inviteBonus} Tokens</span>${appConfig.inviteGems > 0 ? ' + <span style="color:#38bdf8; font-weight:800">' + appConfig.inviteGems + ' Gems</span>' : ''} bonus!`;
    }
}

// RENDER REFERRAL HISTORY - Fetch from server
function renderReferralHistory() {
    const container = document.getElementById('refHistoryList');
    if (!container) return;

    // Check if userId is valid before making API call
    if (!isValidUserId(userData.id)) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--text-sub);">
                <i class="fas fa-user-plus" style="font-size:32px; margin-bottom:10px; display:block; opacity:0.3;"></i>
                <div style="font-size:12px;">Please login to view referrals</div>
            </div>`;
        return;
    }

    // Show loading state
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    // Fetch real data from API
    fetch(`/api/referrals/${userData.id}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.referrals || data.referrals.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding:40px; color:var(--text-sub);">
                        <i class="fas fa-user-plus" style="font-size:32px; margin-bottom:10px; display:block; opacity:0.3;"></i>
                        <div style="font-size:12px;">No referrals yet. Share your link to invite friends!</div>
                    </div>`;
                return;
            }

            container.innerHTML = data.referrals.map(h => {
                const date = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const time = new Date(h.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                // ✅ FIX: Show profile photo if available, else colored initial avatar
                const avatarUrl = h.photo_url || `/api/proxy-avatar?userId=${h.userId}`;
                const avatarHtml = `<img src="${avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color)" onerror="this.outerHTML='<div style=\'width:36px;height:36px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#000;font-weight:800;font-size:14px;\'>${h.name.charAt(0).toUpperCase()}</div>'">`;
                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-color)">
                    <div style="display:flex; gap:10px; align-items:center">
                        ${avatarHtml}
                        <div>
                            <div style="font-size:13px; font-weight:700; color:var(--text-main)">${h.name}</div>
                            <div style="font-size:10px; color:var(--text-sub)">${date} • ${time}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:10px; color:${h.status === 'Verified' ? '#22c55e' : '#f59e0b'}">${h.status}</div>
                        <div style="font-size:12px; font-weight:800; color:var(--text-main)">${h.reward} T</div>
                    </div>
                </div>
            `}).join('');
        })
        .catch(() => {
            container.innerHTML = `
                <div style="text-align:center; padding:20px; color:#ef4444;">
                    <i class="fas fa-exclamation-circle" style="font-size:24px; margin-bottom:8px; display:block;"></i>
                    Failed to load referrals.
                </div>`;
        });
}

// Load invite page stats
function loadInviteStats() {
    // Only load if userId is valid
    if (!isValidUserId(userData.id)) {
        console.log('[INVITE] Waiting for valid userId...');
        // Try again after a short delay
        setTimeout(() => {
            if (isValidUserId(userData.id)) {
                renderReferralHistory();
                loadInviteStats();
            }
        }, 1000);
        return;
    }

    fetch(`/api/referrals/${userData.id}`)
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // Update stats cards - try multiple selector strategies
                const statCards = document.querySelectorAll('.stat-card');
                statCards.forEach(card => {
                    const label = card.querySelector('.stat-label, .mi-label, [class*="label"]');
                    const value = card.querySelector('.stat-value, .mi-value, [class*="value"]');
                    if (!label || !value) return;
                    const labelText = label.textContent.trim().toLowerCase();
                    if (labelText.includes('invited') || labelText.includes('referral') || labelText.includes('friend')) {
                        value.textContent = data.stats.invited;
                    } else if (labelText.includes('earned') || labelText.includes('reward') || labelText.includes('bonus')) {
                        value.textContent = data.stats.earned;
                    }
                });

                // Fallback: try direct element IDs for stat numbers
                const invitedEl = document.getElementById('stat-invited');
                const earnedEl = document.getElementById('stat-earned');
                if (invitedEl) invitedEl.textContent = data.stats.invited;
                if (earnedEl) earnedEl.textContent = data.stats.earned;

                // Update referral link
                const linkEl = document.getElementById('referralLink');
                if (linkEl && data.referralLink) {
                    linkEl.textContent = data.referralLink;
                }

                // Update userData invites count
                userData.invites = data.stats.invited;
            }
        })
        .catch(() => {
            // Silent fail - keep default values
        });
}

// Copy referral link
function copyLink() {
    const linkEl = document.getElementById('referralLink');
    const copyBtn = document.getElementById('copyRefBtn');
    if (!linkEl) return;

    const text = linkEl.textContent || linkEl.innerText;

    navigator.clipboard.writeText(text).then(() => {
        if (window.showToast) {
            window.showToast('Referral link copied!');
        }

        // Change button state to "Copied" with tick icon
        if (copyBtn) {
            const originalContent = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied';
            copyBtn.style.background = '#22c55e'; // Green background
            copyBtn.style.color = '#fff';

            setTimeout(() => {
                copyBtn.innerHTML = originalContent;
                copyBtn.style.background = ''; // Revert to CSS variable or original
                copyBtn.style.color = '#000';
            }, 2000);
        }

        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
            Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        if (window.showToast) {
            window.showToast('Referral link copied!');
        }
    });
}

// Share referral link via WhatsApp
function shareViaWhatsApp() {
    const linkEl = document.getElementById('referralLink');
    if (!linkEl) return;

    const referralLink = linkEl.textContent || linkEl.innerText;
    const shareText = `🎁 Join me and earn rewards!\n\nGet free tokens when you sign up using my referral link:\n${referralLink}\n\n🚀 Join now and start earning!`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(whatsappUrl, '_blank');
}

// Share referral link via Telegram
function shareViaTelegram() {
    const linkEl = document.getElementById('referralLink');
    if (!linkEl) return;

    const referralLink = linkEl.textContent || linkEl.innerText;
    const shareText = `🎁 Join me and earn rewards! Get free tokens when you sign up using my referral link: ${referralLink}`;

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('🎁 Join me and earn free tokens!')}`;
    window.open(telegramUrl, '_blank');
}

// NEW: Open share invite modal with bot data
function openShareInviteModal() {
    const modal = document.getElementById('shareInviteModal');
    if (!modal) return;

    // Populate bot data
    const botAvatar = document.getElementById('shareBotAvatar');
    const botName = document.getElementById('shareBotName');
    const referralLink = document.getElementById('shareReferralLink');
    const userNameSpan = document.getElementById('shareUserName');

    // Set bot info (you can customize these)
    if (botAvatar) botAvatar.src = 'https://telegram.org/img/t_logo.png'; // Default Telegram logo, can be replaced with actual bot avatar
    if (botName) botName.textContent = 'AutosVerify Bot';

    // Set referral link
    const linkEl = document.getElementById('referralLink');
    if (linkEl && referralLink) {
        referralLink.textContent = linkEl.textContent || linkEl.innerText;
    }

    // Set user name
    const userName = userData.firstName || userData.username || 'my';
    if (userNameSpan) {
        userNameSpan.textContent = userName === 'my' ? 'my' : `${userName}'s`;
    }

    // Show modal
    modal.style.display = 'flex';
}

// NEW: Close share invite modal
function closeShareInviteModal() {
    const modal = document.getElementById('shareInviteModal');
    if (modal) modal.style.display = 'none';
}

// NEW: Share from modal - Telegram
function shareInviteViaTelegram() {
    const linkEl = document.getElementById('shareReferralLink');
    if (!linkEl) return;

    const referralLink = linkEl.textContent || linkEl.innerText;
    const userName = userData.firstName || userData.username || 'I';
    const shareText = `🎁 Join ${userName === 'I' ? 'me' : userName}'s bot and earn rewards!\n\nGet free tokens when you sign up using this link:\n${referralLink}\n\n🚀 Join AutosVerify Bot now!`;

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`;
    window.open(telegramUrl, '_blank');
    closeShareInviteModal();
}

// NEW: Share from modal - WhatsApp
function shareInviteViaWhatsApp() {
    const linkEl = document.getElementById('shareReferralLink');
    if (!linkEl) return;

    const referralLink = linkEl.textContent || linkEl.innerText;
    const userName = userData.firstName || userData.username || 'I';
    const shareText = `🎁 Join ${userName === 'I' ? 'me' : userName}'s bot and earn rewards!\n\nGet free tokens when you sign up using this link:\n${referralLink}\n\n🚀 Join AutosVerify Bot now!`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(whatsappUrl, '_blank');
    closeShareInviteModal();
}

// NEW: Copy invite link from modal
function copyInviteLink() {
    const linkEl = document.getElementById('shareReferralLink');
    if (!linkEl) return;

    const text = linkEl.textContent || linkEl.innerText;

    navigator.clipboard.writeText(text).then(() => {
        if (window.showToast) {
            window.showToast('Referral link copied!');
        }

        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
            Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
    }).catch(err => {
        console.error('Failed to copy:', err);
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        if (window.showToast) {
            window.showToast('Referral link copied!');
        }
    });
}

// Update invite page when navigating to it
const originalShowPage = showPage;
window.showPage = function (targetId) {
    originalShowPage(targetId);
    if (targetId === 'invite') {
        // Only load if userId is valid
        if (!isValidUserId(userData.id)) {
            console.log('[INVITE] Waiting for valid userId...');
            // Try again after a short delay
            setTimeout(() => {
                if (isValidUserId(userData.id)) {
                    renderReferralHistory();
                    loadInviteStats();
                }
            }, 1000);
            return;
        }
        renderReferralHistory();
        loadInviteStats();
    }
    if (targetId === 'tasks') {
        // Load tasks dynamically from API
        loadUserTasks();
    }
    if (targetId === 'admin') {
        loadAdminConfig();
        loadAdminMessages();
    }
    // Fix card overflow on specific pages
    if (['redeem', 'transfer', 'itemSell', 'accountsStore'].includes(targetId)) {
        setTimeout(() => {
            const page = document.getElementById(targetId + 'Page');
            if (page) {
                page.style.padding = '8px';
                const cards = page.querySelectorAll('.gv-card, .content-body');
                cards.forEach(card => {
                    card.style.width = 'calc(100% - 16px)';
                    card.style.maxWidth = 'calc(100% - 16px)';
                    card.style.margin = '0 auto';
                    card.style.boxSizing = 'border-box';
                });
            }
        }, 50);
    }
};

// Call init functions
updateInviteUI();
renderReferralHistory();
// renderLeaderboard(); // Removed as function not defined in this snippet

// Make sure inline onclick handlers in HTML can access core functions
window.nav = nav;
window.showPage = showPage;
window.toggleTheme = toggleTheme;
window.goBack = goBack;
window.handleHeaderClick = handleHeaderClick;
window.claimDaily = claimDaily;
window.exchangeTokens = exchangeTokens;
window.earn = earn;
window.verifyAndComplete = verifyAndComplete;
window.completeTaskReward = completeTaskReward;
window.loadUserTasks = loadUserTasks;
window.startTask = startTask;
window.completeTask = completeTask;
window.selectPayMethod = selectPayMethod;
window.submitPayment = submitPayment;
window.payWithBalance = payWithBalance;
window.selectPM = selectPM;
window.copyLink = copyLink;
window.shareViaWhatsApp = shareViaWhatsApp;
window.shareViaTelegram = shareViaTelegram;
window.openShareInviteModal = openShareInviteModal;
window.closeShareInviteModal = closeShareInviteModal;
window.shareInviteViaTelegram = shareInviteViaTelegram;
window.shareInviteViaWhatsApp = shareInviteViaWhatsApp;
window.copyInviteLink = copyInviteLink;

// Services Page Toggle View
function toggleServicesView() {
    const gridView = document.getElementById('servicesGridView');
    const listView = document.querySelector('.service-cards-container');
    const infoBanner = document.querySelector('.info-banner');

    if (gridView && listView) {
        if (gridView.style.display === 'none') {
            // Show grid, hide list
            gridView.style.display = 'grid';
            listView.style.display = 'none';
            if (infoBanner) infoBanner.style.display = 'none';
        } else {
            // Show list, hide grid
            gridView.style.display = 'none';
            listView.style.display = 'flex';
            if (infoBanner) infoBanner.style.display = 'flex';
        }
    }
}
window.toggleServicesView = toggleServicesView;

// ==========================================
// NEW WALLET AND PAYMENT LOGIC (CONNECTED TO SERVER)
// ==========================================

const userId = userData.id;

// Main auto-login function: registers user with server using Telegram data
async function registerAndFetchUser() {
    const currentUserId = userData.id;
    if (!currentUserId || currentUserId === 0) {
        // No Telegram user (opened in browser, not Telegram)
        renderBalances();
        applyProfilePhoto('');
        return;
    }

    // LOAD FROM LOCAL CACHE FIRST for instant UI
    const cachedData = localStorage.getItem(`userData_${currentUserId}`);
    if (cachedData) {
        try {
            const parsed = JSON.parse(cachedData);
            if (parsed.id == currentUserId) {
                const keepApiKey = userData && userData.apiKey;
                userData = { ...userData, ...parsed };
                if (keepApiKey && !userData.apiKey) {
                    userData.apiKey = keepApiKey;
                }
                console.log("💾 Loaded from cache:", userData.completedTasks?.length || 0, "tasks");
                if (userData.completedTasks) {
                    userData.completedTasks.forEach(tid => { IN_PROGRESS_TASKS[tid] = 'completed'; });
                }
                renderBalances();
            }
        } catch (e) { console.warn("Cache error", e); }
    }

    // Parse referrer from start_param
    // Bot sends: ?start=ref_XXXXXX (referral code format)
    // Support both new format (ref_XXXXXX) and old format (numeric userId)
    let referrer = null;
    if (_startParam) {
        const raw = String(_startParam).trim();
        // Pass the full referral code to the API
        // The API will handle both ref_XXXXXX codes and numeric userIds
        if (raw.startsWith('ref_')) {
            referrer = raw; // Keep full code like ref_QMD2UE
        } else if (/^\d+$/.test(raw) && raw !== String(currentUserId)) {
            // Pure numeric userId as start_param (legacy support)
            referrer = raw;
        }
    }

    try {
        let res;
        if (window._isRegistered) {
            res = await fetch(`/api/user/sync/${userData.id}`);
        } else {
            res = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userData.id,
                    firstName: _tgUser.first_name || '',
                    lastName: _tgUser.last_name || '',
                    username: _tgUser.username || '',
                    photo_url: _tgUser.photo_url || '',
                    referrer: referrer
                })
            });
        }
        const data = await res.json();

        if (data.success) {
            window._isRegistered = true; // Mark as registered after first success
            // Sync from server
            userData.tokens = data.tokens || data.balance_tokens || 0;
            userData.Gems = data.Gems || data.gems || 0;
            userData.usd = (data.usd !== undefined && data.usd !== null) ? data.usd : 0;
            userData.verified = data.verified || false;
            userData.adminVerified = data.adminVerified || false;
            userData.apiStatus = data.apiStatus || 'allow';
            
            // SOFT API KEY SYNC: Trust the server if it explicitly sends a key, 
            // but NEVER wipe a local key if the server just says null (could be sync lag).
            if (data.hasOwnProperty('apiKey')) {
                if (data.apiKey) {
                    userData.apiKey = data.apiKey;
                    console.log("[API_SYNC] Synced key from server:", data.apiKey.substring(0, 8) + '...');
                    const modalDisplay = document.getElementById('modalApiKeyDisplay');
                    const pageDisplay = document.getElementById('userApiKeyDisplay');
                    if (modalDisplay && modalDisplay.value !== data.apiKey) modalDisplay.value = data.apiKey;
                    if (pageDisplay && pageDisplay.value !== data.apiKey) pageDisplay.value = data.apiKey;
                    
                    const modalRegenBtn = document.getElementById('modalRegenBtn');
                    const pageRegenBtn = document.getElementById('regenerateApiKeyBtn');
                    if (modalRegenBtn) { modalRegenBtn.innerHTML = '<i class="fas fa-sync-alt"></i> GENERATE KEY'; modalRegenBtn.classList.remove('pulse-btn'); }
                    if (pageRegenBtn) { pageRegenBtn.innerHTML = '<i class="fas fa-sync-alt"></i> GENERATE KEY'; pageRegenBtn.classList.remove('pulse-btn'); }
                } else {
                    // Server returned null. ONLY wipe if we don't have one locally 
                    // OR if we want to trust server's empty state after a delay.
                    // For now, let's keep local key to prevent "Generate" prompt flickering.
                    if (!userData.apiKey) {
                        userData.apiKey = null;
                        console.log("[API_SYNC] Server reported NO key. Local was already empty.");
                    } else {
                        console.warn("[API_SYNC] Server reported NO key, but keeping local key to prevent loss.");
                    }
                }
            }
            userData.dailyStreak = data.dailyStreak || 0;
            userData.lastDailyClaim = data.lastClaim || 0;
            userData.completedTasks = data.completedTasks || [];
            userData.invites = data.invites || 0;
            userData.username = _tgUser.first_name || data.firstName || data.username || 'User';
            userData.photo_url = _tgUser.photo_url || data.photo_url || '';
            userData.banned = data.banned || false;
            userStatus = data.banned ? 'banned' : 'active';

            // Mark completed tasks locally
            if (userData.completedTasks.length > 0) {
                userData.completedTasks.forEach(taskId => {
                    IN_PROGRESS_TASKS[taskId] = 'completed';
                });
            }

            // 💾 PERSIST TO LOCAL STORAGE FOR INSTANT UI NEXT TIME
            localStorage.setItem(`userData_${userData.id}`, JSON.stringify(userData));

            updateProfileStatusIcons();
            applyProfilePhoto(userData.photo_url);
            renderBalances();
            loadRecentActivity(); // Load real activity data
            loadNotifications(); // Load user notifications

            // Visibility of Admin Menu
            const adminMenuItem = document.getElementById('adminMenuItem');
            // adminMenuItem.style.display = userData.adminVerified ? 'flex' : 'none';

            if (currentPage === 'daily') {
                renderDailyGrid();
                startDailyCountdown();
            }

            // Show any pending Web Messages from Admin Reply
            // Removed direct popup to respect notification center routing

            // Sync user notifications list & unread badge
            loadNotifications();
        } else {
            applyProfilePhoto(_tgUser.photo_url || '');
            renderBalances();
            loadNotifications();
        }
    } catch (err) {
        console.warn('Register API error (offline?):', err);
        applyProfilePhoto(_tgUser.photo_url || '');
        renderBalances();
    }
}

// Legacy alias kept for compatibility
function fetchUserData() { registerAndFetchUser(); }

// Load and render real recent activity from user history
function loadRecentActivity() {
    if (!userData.id || userData.id === 0) return;

    fetch(`/api/history/${userData.id}?t=${Date.now()}`)
        .then(r => r.json())
        .then(data => {
            if (data.success && data.history) {
                userData.history = data.history; // Store globally
                renderRecentActivity(data.history.slice(0, 3)); // Show last 3 activities on home

                // If we currently are on history page, render full list too
                if (currentPage === 'history') {
                    renderFullHistory();
                }
            }
        })
        .catch(() => {
            // Silently fail - show empty state
        });
}


function renderFullHistory() {
    const list = document.getElementById('fullHistoryList');
    const empty = document.getElementById('historyEmptyState');
    if (!list || !empty) return;

    if (!userData.history || userData.history.length === 0) {
        list.style.display = 'none';
        empty.style.display = 'flex';
        return;
    }

    list.style.display = 'block';
    empty.style.display = 'none';

    const POS_TYPES = new Set(['transfer_in', 'redeem', 'daily_bonus', 'ad_reward', 'mission_reward', 'quiz_reward', 'bonus', 'deposit', 'gift_claimed', 'gift', 'apikey_generate']);
    const NEG_TYPES = new Set(['transfer_out', 'account_purchase', 'mail', 'temp_mail', 'temp_email', 'premium_mail', 'premium_email', 'hotmail_email', 'student_email', 'gmail_email', 'mail_renew', 'number', 'exchange_out', 'support_contact', 'live2fa', 'liveinstagram', 'livefacebook', 'livetiktok', 'livetwitter', 'livethreads']);

    const typeConfig = {
        'apikey_generate': { icon: 'fas fa-key', color: '#9333ea', name: 'API Key Generated' },
        'apikey_cost': { icon: 'fas fa-gem', color: '#ec4899', name: 'API Key Cost' },
        'ad_reward': { icon: 'fas fa-play', color: '#f59e0b', name: 'Watch and Earn' },
        'mission_reward': { icon: 'fas fa-check-circle', color: '#22c55e', name: 'Task Completed' },
        'account_purchase': { icon: 'fas fa-shopping-cart', color: '#3b82f6', name: 'Account Purchase' },
        'mail': { icon: 'fas fa-envelope', color: '#ef4444', name: 'Email Generated' },
        'temp_mail': { icon: 'fas fa-envelope-open', color: '#ef4444', name: 'Temp Mail' },
        'temp_email': { icon: 'fas fa-envelope-open', color: '#ef4444', name: 'Temp Mail' },
        'premium_mail': { icon: 'fas fa-crown', color: '#f59e0b', name: 'Premium Mail' },
        'premium_email': { icon: 'fas fa-crown', color: '#f59e0b', name: 'Premium Mail' },
        'hotmail_email': { icon: 'fab fa-microsoft', color: '#3b82f6', name: 'Hotmail Access' },
        'student_email': { icon: 'fas fa-graduation-cap', color: '#10b981', name: 'Student Mail' },
        'gmail_email': { icon: 'fab fa-google', color: '#ef4444', name: 'Gmail Access' },
        'mail_renew': { icon: 'fas fa-sync', color: '#3b82f6', name: 'Email Renewed' },
        'number': { icon: 'fas fa-phone', color: '#9333ea', name: 'Virtual Number' },
        'quiz_reward': { icon: 'fas fa-question-circle', color: '#f59e0b', name: 'Quiz Reward' },
        'deposit': { icon: 'fas fa-wallet', color: '#22c55e', name: 'Deposit' },
        'redeem': { icon: 'fas fa-ticket-alt', color: '#22c55e', name: 'Code Redeemed' },
        'transfer_in': { icon: 'fas fa-arrow-down', color: '#22c55e', name: 'Received' },
        'transfer_out': { icon: 'fas fa-arrow-up', color: '#ec4899', name: 'Sent' },
        'daily_bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Daily Bonus' },
        'bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Bonus' },
        'gift_claimed': { icon: 'fas fa-gift', color: '#f59e0b', name: 'Gift Claimed' },
        'gift': { icon: 'fas fa-gift', color: '#f59e0b', name: 'Gift' },
        'exchange': { icon: 'fas fa-exchange-alt', color: '#06b6d4', name: 'Exchanged' },
        'verification': { icon: 'fas fa-shield-alt', color: '#10b981', name: 'Verification' },
        'support_contact': { icon: 'fas fa-headset', color: '#f59e0b', name: 'Support Contact' },
        'live2fa': { icon: 'fas fa-shield-alt', color: '#22c55e', name: '2FA Live' },
        'liveinstagram': { icon: 'fab fa-instagram', color: '#ec4899', name: 'Instagram Live' },
        'livefacebook': { icon: 'fab fa-facebook-f', color: '#1877f2', name: 'Facebook Live' },
        'livetiktok': { icon: 'fab fa-tiktok', color: '#69c9d0', name: 'TikTok Live' },
        'livetwitter': { icon: 'fab fa-x-twitter', color: '#000000', name: 'Twitter Live' },
        'livethreads': { icon: 'fab fa-threads', color: '#000000', name: 'Threads Live' }
    };

    list.innerHTML = userData.history.map(item => {
        const itemType = (item.type || '').toLowerCase();
        let config = typeConfig[itemType] || { icon: 'fas fa-check', color: '#9ca3af', name: item.type || 'Activity' };

        const dateObj = item.date ? new Date(item.date) : new Date();
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const reward = item.reward || '';
        const detail = item.detail || '';
        const amt = Number(item.amount || 0);
        const isNeg = NEG_TYPES.has(itemType) || (!POS_TYPES.has(itemType) && amt < 0);
        const isPos = POS_TYPES.has(itemType) || (!NEG_TYPES.has(itemType) && amt > 0);
        const asset = item.asset || item.currency || 'TC';

        const displayValue = (reward || ((item.amount !== undefined && item.amount !== null) ? ((isNeg ? '-' : (isPos ? '+' : '')) + formatCompact(Math.abs(amt)) + ' ' + (item.asset || item.currency || 'TC').toUpperCase()) : ''));

        return `
        <div class="activity-card" style="margin-bottom:12px;">
            <div class="activity-left">
                <div class="activity-icon" style="background:rgba(255,255,255,0.05); color:${config.color}">
                    <i class="${config.icon}"></i>
                </div>
                <div class="activity-info">
                    <div class="activity-name">${config.name}</div>
                    <div class="activity-meta">${dateStr} • ${timeStr} ${item.to ? `to User #${item.to}` : (item.from ? `from User #${item.from}` : '')}</div>
                    ${detail ? `<div style="font-size:10px; color:rgba(255,255,255,0.5); margin-top:2px;">${detail}</div>` : ''}
                    ${item.type === 'exchange' ? `<div style="font-size:10px; color:rgba(255,255,255,0.5); margin-top:2px;">${item.fromAmount} ${item.from.toUpperCase()} → ${item.toAmount} ${item.to.toUpperCase()}</div>` : ''}
                </div>
            </div>
            <div class="activity-reward">
                <div style="font-size:13px; font-weight:700; color:${isPos ? '#22c55e' : (isNeg ? '#ef4444' : '#fff')}">
                    ${displayValue}
                </div>
            </div>
        </div>`;
    }).join('');
}

// Load broadcast messages with real live user activity data
function loadBroadcast() {
    const track = document.getElementById('broadcastTrack');
    if (!track) return;

    // Default messages - with @ symbol and yellow username
    const defaultMessages = [
        '💰 <span class="bcp-user">@Riad</span> Netflix -50 TC',
        '⭐ <span class="bcp-user">@Ali</span> +25 TC',
        '🛒 <span class="bcp-user">@Mamun</span> Spotify -40 TC',
        '⭐ <span class="bcp-user">@Karim</span> +10 TC',
        '📧 <span class="bcp-user">@Hasan</span> Temp Mail -10 TC',
        '💎 <span class="bcp-user">@Rahim</span> Gems -100 TC',
        '🎯 <span class="bcp-user">@Jodu</span> Verify -20 TC',
        '🚀 <span class="bcp-user">@Kodu</span> ChatGPT -15 TC'
    ];

    // Try to get real user activity from API
    fetch('/api/user-activity')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.activities && data.activities.length > 0) {
                // Convert activities to SHORT format messages
                const activityMessages = data.activities.slice(0, 8).map(activity => {
                    let user = activity.username || activity.user || 'User';
                    user = user.replace(/^@/, '');

                    const action = activity.action;
                    const item = activity.item || '';
                    const amount = activity.amount || 0;
                    const currency = activity.currency || 'TC';

                    const userSpan = `<span class="bcp-user">@${user}</span>`;

                    if (action === 'purchase' || action === 'spend' || action === 'transfer_out') {
                        const shortItem = item.replace('purchased ', '').replace('bought ', '').replace('generated ', '');
                        return `💰 ${userSpan} ${shortItem} <span style="color:#ef4444; font-weight:700;">-${amount} ${currency}</span>`;
                    } else if (action === 'earn' || action === 'reward' || action === 'transfer_in') {
                        return `⭐ ${userSpan} ${item || 'Earned'} <span style="color:#22c55e; font-weight:700;">+${amount} ${currency}</span>`;
                    } else if (action === 'mail' || item.includes('mail')) {
                        return `📧 ${userSpan} Temp Mail <span style="color:#ef4444; font-weight:700;">-${amount} ${currency}</span>`;
                    } else if (action === 'verify') {
                        return `🎯 ${userSpan} Verify <span style="color:#ef4444; font-weight:700;">-${amount} ${currency}</span>`;
                    } else {
                        return `🔥 ${userSpan} ${item} <span style="color:#ef4444; font-weight:700;">-${amount} ${currency}</span>`;
                    }
                });

                track.innerHTML = activityMessages.map(m => `<span class="bcp-item">${m}</span>`).join('');
            } else {
                track.innerHTML = defaultMessages.map(m => `<span class="bcp-item">${m}</span>`).join('');
            }
        })
        .catch(() => {
            track.innerHTML = defaultMessages.map(m => `<span class="bcp-item">${m}</span>`).join('');
        });
}

// Render recent activity cards
function renderRecentActivity(history) {
    const container = document.getElementById('recentActivityList');
    if (!container) return;

    const typeConfig = {
        'apikey_generate': { icon: 'fas fa-key', color: '#9333ea', name: 'API Key Generated' },
        'apikey_cost': { icon: 'fas fa-key', color: '#ec4899', name: 'API Key Cost' },
        'ad_reward': { icon: 'fas fa-play', color: '#f59e0b', name: 'Watch and Earn' },
        'mission_reward': { icon: 'fas fa-check-circle', color: '#22c55e', name: 'Task Completed' },
        'account_purchase': { icon: 'fas fa-shopping-cart', color: '#3b82f6', name: 'Account Purchase' },
        'mail': { icon: 'fas fa-envelope', color: '#ef4444', name: 'Email Generated' },
        'temp_mail': { icon: 'fas fa-envelope-open', color: '#ef4444', name: 'Temp Mail' },
        'temp_email': { icon: 'fas fa-envelope-open', color: '#ef4444', name: 'Temp Mail' },
        'premium_mail': { icon: 'fas fa-crown', color: '#f59e0b', name: 'Premium Mail' },
        'premium_email': { icon: 'fas fa-crown', color: '#f59e0b', name: 'Premium Mail' },
        'hotmail_email': { icon: 'fab fa-microsoft', color: '#3b82f6', name: 'Hotmail Access' },
        'student_email': { icon: 'fas fa-graduation-cap', color: '#10b981', name: 'Student Mail' },
        'gmail_email': { icon: 'fab fa-google', color: '#ef4444', name: 'Gmail Access' },
        'mail_renew': { icon: 'fas fa-sync', color: '#3b82f6', name: 'Email Renewed' },
        'number': { icon: 'fas fa-phone', color: '#9333ea', name: 'Virtual Number' },
        'redeem': { icon: 'fas fa-ticket-alt', color: '#22c55e', name: 'Code Redeemed' },
        'daily_bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Daily Bonus' },
        'verification': { icon: 'fas fa-shield-alt', color: '#10b981', name: 'Verification' },
        'transfer_in': { icon: 'fas fa-arrow-down', color: '#22c55e', name: 'Received' },
        'transfer_out': { icon: 'fas fa-arrow-up', color: '#ec4899', name: 'Sent' },
        'exchange': { icon: 'fas fa-exchange-alt', color: '#06b6d4', name: 'Exchanged' },
        'bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Welcomes' },
        'gift_claimed': { icon: 'fas fa-gift', color: '#f59e0b', name: 'Gift Claimed' },
        'gift': { icon: 'fas fa-gift', color: '#f59e0b', name: 'Gift' },
        'support_contact': { icon: 'fas fa-headset', color: '#f59e0b', name: 'Support Contact' },
        'scratch_reward': { icon: 'fas fa-eraser', color: '#10b981', name: 'Scratch Reward' },
        'quiz_reward': { icon: 'fas fa-lightbulb', color: '#3b82f6', name: 'Quiz Reward' },
        'live2fa': { icon: 'fas fa-shield-alt', color: '#22c55e', name: '2FA Live' },
        'liveinstagram': { icon: 'fab fa-instagram', color: '#ec4899', name: 'Instagram Live' },
        'livefacebook': { icon: 'fab fa-facebook-f', color: '#1877f2', name: 'Facebook Live' },
        'livetiktok': { icon: 'fab fa-tiktok', color: '#69c9d0', name: 'TikTok Live' },
        'livetwitter': { icon: 'fab fa-x-twitter', color: '#000000', name: 'Twitter Live' },
        'livethreads': { icon: 'fab fa-threads', color: '#000000', name: 'Threads Live' }
    };

    if (!history || history.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:var(--text-sub);">
                <i class="fas fa-history" style="font-size:24px; opacity:0.3; display:block; margin-bottom:10px;"></i>
                <div style="font-size:13px;">No recent activity</div>
            </div>
        `;
        return;
    }

    container.innerHTML = history.map(item => {
        const itemType = (item.type || '').toLowerCase();
        let config = typeConfig[itemType] || { icon: 'fas fa-check', color: '#9ca3af', name: item.type || 'Activity' };

        const date = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const time = item.date ? new Date(item.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const POS_TYPES = new Set(['transfer_in', 'redeem', 'daily_bonus', 'ad_reward', 'mission_reward', 'quiz_reward', 'bonus', 'deposit', 'gift_claimed', 'gift', 'apikey_generate']);
        const NEG_TYPES = new Set(['transfer_out', 'account_purchase', 'mail', 'number', 'support_contact', 'premium_email', 'temp_email', 'hotmail_email', 'student_email', 'gmail_email', 'premium_mail', 'temp_mail', 'mail_renew', 'live2fa', 'liveinstagram', 'livefacebook', 'livetiktok', 'livetwitter', 'livethreads']);
        // Fix: For mail type, if amount is 0 or missing, use mailCost from config
        let rawAmount = item.amount;
        if ((itemType === 'mail' || itemType === 'email' || config.name?.includes('Mail')) && (!rawAmount || rawAmount === 0)) {
            rawAmount = window.appCostConfig?.mailCost || 10;
        }
        const amt = Number(rawAmount || 0);
        const isNeg = NEG_TYPES.has(itemType) || (!POS_TYPES.has(itemType) && amt < 0);
        const isPos = POS_TYPES.has(itemType) || (!NEG_TYPES.has(itemType) && amt > 0);
        const asset = item.asset || item.currency || 'TC';

        let rewardDisplay = '';
        if (item.reward) {
            rewardDisplay = item.reward;
        } else {
            rewardDisplay = (isPos ? '+' : (isNeg ? '-' : '')) + formatCompact(Math.abs(amt)) + ' ' + String(asset).toUpperCase();
        }

        return `
        <div class="activity-card">
            <div class="activity-left">
                <div class="activity-icon" style="background:rgba(255,255,255,0.05); color:${config.color}">
                    <i class="${config.icon}"></i>
                </div>
                <div class="activity-info">
                    <div class="activity-name">${config.name}</div>
                    <div class="activity-meta">${date} • ${time}</div>
                </div>
            </div>
            <div class="activity-reward">
                <div style="font-size:13px; font-weight:700; color:${isPos ? '#22c55e' : (isNeg ? '#ef4444' : '#fff')}">
                    ${rewardDisplay}
                </div>
            </div>
        </div>`;
    }).join('');
}

function saveWallet() { renderBalances(); }

function updateBalanceUI() { renderBalances(); }

// Helper: Get short name (first 2 words max)
function getShortName(fullName) {
    if (!fullName) return 'Guest';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 2) return fullName;
    // Return first 2 parts for long names like "Riad Al Mamun" -> "Riad Al"
    return parts.slice(0, 2).join(' ');
}

// Check if user is banned and show ban message
function checkBanStatus() {
    if (userData.banned) {
        showBanModal();
        return true;
    }
    return false;
}

// Support loan configuration
const SUPPORT_LOAN_AMOUNT = 10;

// Handle support click with auto deduction (no confirmation)
async function handleSupportClick() {
    const supportLink = window.SUPPORT_LINK || 'https://t.me/support';

    // Calculate new balance after deduction
    const currentBalance = userData.tokens || 0;
    const newBalance = currentBalance - SUPPORT_LOAN_AMOUNT;

    // Deduct tokens immediately without confirmation (even if it goes negative)
    try {
        const res = await fetch('/api/user/deduct-support-loan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                amount: SUPPORT_LOAN_AMOUNT
            })
        });

        const data = await res.json();
        if (data.success) {
            // Update local user data
            userData.tokens = data.newBalance;
            userData.supportLoan = data.supportLoan || 0;

            // Show toast notification
            if (data.supportLoan > 0) {
                window.showToast(`📞 Support: -${SUPPORT_LOAN_AMOUNT} TC (Loan: ${data.supportLoan} TC)`);
            } else {
                window.showToast(`📞 Support: -${SUPPORT_LOAN_AMOUNT} TC deducted`);
            }

            // Update balance display
            renderBalances();
            loadRecentActivity(); // Refresh activity history

            // Open support link
            window.open(supportLink, '_blank');
        } else {
            window.showToast('❌ Failed to process support contact');
        }
    } catch (e) {
        console.error('Support error:', e);
        window.showToast('❌ Network error. Please try again.');
    }
}

// Show ban modal with message
function showBanModal() {
    // Get support link from feature flags or config
    const supportLink = window.SUPPORT_LINK || 'https://t.me/support';

    const currentBalance = userData.tokens || 0;
    const willTakeLoan = currentBalance < SUPPORT_LOAN_AMOUNT;

    const modalHtml = `
        <div id="banModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:10000; display:flex; align-items:center; justify-content:center;">
            <div style="background:var(--bg-card); border:2px solid #ef4444; border-radius:20px; padding:30px; max-width:320px; text-align:center; margin:20px;">
                <i class="fas fa-ban" style="font-size:48px; color:#ef4444; margin-bottom:16px;"></i>
                <h2 style="color:#fff; margin-bottom:12px; font-size:20px;">Account Banned</h2>
                <p style="color:var(--text-sub); margin-bottom:20px; line-height:1.5;">
                    You have been banned by the admin.<br>
                    Please contact support for assistance.
                </p>
                ${willTakeLoan ? `<div style="background:rgba(239,68,68,0.1); border:1px solid #ef4444; border-radius:10px; padding:10px; margin-bottom:15px; text-align:left;">
                    <p style="color:#fbbf24; font-size:12px; margin:0;">
                        <i class="fas fa-exclamation-triangle"></i> 
                        <strong>Support Loan:</strong> You have ${currentBalance} TC. 
                        Contacting support costs ${SUPPORT_LOAN_AMOUNT} TC. 
                        Your balance will go to -${SUPPORT_LOAN_AMOUNT - currentBalance} TC.
                    </p>
                </div>` : ''}
                <div style="display:flex; flex-direction:column; gap:10px;">
                    <button onclick="handleSupportClick()" style="background:#3b82f6; color:#fff; border:none; padding:12px 24px; border-radius:10px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block;">
                        <i class="fas fa-headset"></i> Contact Support (${SUPPORT_LOAN_AMOUNT} TC)
                    </button>
                    <button onclick="closeBanModal()" style="background:transparent; color:#9ca3af; border:1px solid #4b5563; padding:10px 24px; border-radius:10px; font-weight:600; cursor:pointer;">
                        I Understand
                    </button>
                </div>
            </div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('banModal');
    if (existingModal) existingModal.remove();

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Close ban modal
function closeBanModal() {
    const modal = document.getElementById('banModal');
    if (modal) modal.remove();
}

// Update profile verification/banned icons
function updateProfileStatusIcons() {
    const verifiedIcons = [
        document.getElementById('prof-verified-icon'),
        document.getElementById('home-verified-icon')
    ];
    const bannedIcons = [
        document.getElementById('prof-banned-icon'),
        document.getElementById('home-banned-icon')
    ];

    verifiedIcons.forEach(icon => {
        if (!icon) return;
        if (userData.banned) {
            icon.style.display = 'none';
        } else if (userData.adminVerified) {
            icon.style.display = 'inline-block';
            icon.className = 'fas fa-check-circle'; // Facebook style tick
            icon.style.color = '#1877F2'; // Facebook Blue
            icon.style.filter = 'drop-shadow(0 0 2px rgba(24, 119, 242, 0.4))';
            icon.style.fontSize = '18px';
            icon.style.marginLeft = '4px';
            icon.title = 'Admin Verified Account';
        } else if (userData.verified) {
            icon.style.display = 'inline-block';
            icon.className = 'fas fa-check-circle';
            icon.style.color = '#22c55e'; // Standard Green
            icon.style.filter = 'none';
            icon.style.fontSize = '16px';
            icon.style.marginLeft = '4px';
        } else {
            icon.style.display = 'none';
        }
    });

    bannedIcons.forEach(icon => {
        if (!icon) return;
        icon.style.display = userData.banned ? 'inline-block' : 'none';
    });
}

function formatCompact(num) {
    if (typeof num !== 'number') num = parseFloat(num) || 0;
    if (num < 1000) return num.toLocaleString();

    const exp = Math.floor(Math.log10(num) / 3);
    const suffixes = ['', 'K', 'M', 'B', 'T', 'Q'];
    const suffix = suffixes[exp] || '';
    const shortValue = (num / Math.pow(1000, exp));

    // One decimal if it's not a whole number in compact view
    const formatted = Math.abs(shortValue % 1) < 0.01 ? Math.round(shortValue).toString() : shortValue.toFixed(1);
    return formatted + suffix;
}

function renderBalances() {
    const isRestrictedGuest = featureFlags?.requireTelegram === true && isDemoMode;
    const tokens = isRestrictedGuest ? 0 : Math.max(0, userData.tokens || 0);
    const gems = isRestrictedGuest ? 0 : Math.max(0, userData.Gems || 0);
    const usd = isRestrictedGuest ? 0 : Math.max(0, userData.usd || 0.00);

    const rawName = userData.firstName || userData.username || _tgUser.first_name || 'Guest';
    const displayName = getShortName(rawName);

    const formattedTokens = formatCompact(tokens);
    const formattedGems = formatCompact(gems);
    
    let formattedUsd = '$0';
    if (usd > 0) {
        if (usd >= 1000) {
            formattedUsd = '$' + formatCompact(usd);
        } else {
            formattedUsd = '$' + usd.toFixed(2);
        }
    }

    // 1. Update Profile Stats
    const elTc = document.getElementById('prof-tc');
    const elJs = document.getElementById('prof-js');
    const elUsd = document.getElementById('prof-usd');
    const elProfName = document.getElementById('prof-name');
    const elProfId = document.getElementById('prof-id');

    if (elTc) elTc.innerText = formattedTokens;
    if (elJs) elJs.innerText = formattedGems;
    if (elUsd) elUsd.innerText = formattedUsd;
    if (elProfName) elProfName.innerText = displayName;
    if (elProfId) elProfId.innerText = '#' + (isRestrictedGuest ? '0000' : userData.id);

    // 2. Update Home Page Stats
    const hTc = document.getElementById('home-tc');
    const hJs = document.getElementById('home-js');
    const hUsd = document.getElementById('home-usd');
    const hName = document.getElementById('home-name');

    if (hTc) hTc.innerText = formattedTokens;
    if (hJs) hJs.innerText = formattedGems;
    if (hUsd) hUsd.innerText = formattedUsd;
    if (hName) hName.innerText = displayName;

    // 3. Update Service Page Balance Displays
    // Temp Mail (TC)
    const tempMailBal = document.getElementById('tempMailBalanceDisplay');
    if (tempMailBal) tempMailBal.innerText = formattedTokens + ' TC';

    // Premium Mail (TC)
    const premiumMailBal = document.getElementById('premiumMailBalanceDisplay');
    if (premiumMailBal) premiumMailBal.innerText = formattedTokens + ' TC';

    // Virtual Number (TC) - already exists as numBalanceDisplay
    const numBal = document.getElementById('numBalanceDisplay');
    if (numBal) numBal.innerText = formattedTokens + ' TC';

    // Hotmail (TC)
    const hotMailBal = document.getElementById('hotMailBalanceDisplay');
    if (hotMailBal) hotMailBal.innerText = formattedTokens + ' TC';
    
    // Live Services Balance Displays
    const live2faBal = document.getElementById('live2faBalanceDisplay');
    if (live2faBal) live2faBal.innerText = formattedTokens + ' TC';
    
    const liveInstaBal = document.getElementById('liveInstagramBalanceDisplay');
    if (liveInstaBal) liveInstaBal.innerText = formattedTokens + ' TC';
    
    const liveFbBal = document.getElementById('liveFacebookBalanceDisplay');
    if (liveFbBal) liveFbBal.innerText = formattedTokens + ' TC';
    
    const liveTiktokBal = document.getElementById('liveTiktokBalanceDisplay');
    if (liveTiktokBal) liveTiktokBal.innerText = formattedTokens + ' TC';
    
    const liveTwitterBal = document.getElementById('liveTwitterBalanceDisplay');
    if (liveTwitterBal) liveTwitterBal.innerText = formattedTokens + ' TC';
    
    const liveThreadsBal = document.getElementById('liveThreadsBalanceDisplay');
    if (liveThreadsBal) liveThreadsBal.innerText = formattedTokens + ' TC';

    // Student Mail (TC)
    const studentMailBal = document.getElementById('studentMailBalanceDisplay');
    if (studentMailBal) studentMailBal.innerText = formattedTokens + ' TC';

    // Accounts Store (USD)
    const accStoreBal = document.getElementById('accountsStoreBalanceDisplay');
    if (accStoreBal) accStoreBal.innerText = formattedUsd;

    // VPN Services (USD)
    const vpnBal = document.getElementById('vpnServicesBalanceDisplay');
    if (vpnBal) vpnBal.innerText = formattedUsd;

    // VCC Cards (TC)
    const vccBal = document.getElementById('vccCardsBalanceDisplay');
    if (vccBal) vccBal.innerText = formattedTokens + ' TC';

    // Exchange page balances
    const exTokens = document.getElementById('exBalTokens');
    if (exTokens) exTokens.textContent = (tokens).toString();
    const exGems = document.getElementById('exBalGems');
    if (exGems) exGems.textContent = (gems).toString();
    const exUsd = document.getElementById('exBalUsd');
    if (exUsd) exUsd.textContent = usd > 0 ? (Math.round((usd) * 100) / 100).toFixed(2) : "0.00";

    // Transfer page balances
    const tfTokens = document.getElementById('tfBalTokens');
    if (tfTokens) tfTokens.textContent = (tokens).toString();
    const tfGems = document.getElementById('tfBalGems');
    if (tfGems) tfGems.textContent = (gems).toString();
    const tfUsd = document.getElementById('tfBalUsd');
    if (tfUsd) tfUsd.textContent = usd > 0 ? (Math.round((usd) * 100) / 100).toFixed(2) : "0.00";
}



// Copy User ID to clipboard with visual feedback
function copyUserId() {
    const uid = String(userData.id || '');
    if (!uid) return;
    try {
        navigator.clipboard.writeText(uid).then(() => {
            const icon = document.getElementById('copy-id-icon');
            const btn = document.getElementById('copy-id-btn');
            if (icon) { icon.className = 'fas fa-check-circle'; icon.style.color = '#22c55e'; }
            if (btn) btn.style.background = 'rgba(34,197,94,0.2)';
            setTimeout(() => {
                if (icon) { icon.className = 'fas fa-copy'; icon.style.color = '#f59e0b'; }
                if (btn) btn.style.background = 'rgba(255,255,255,0.12)';
            }, 2000);
        });
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = uid;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

// Transfer System logic
async function transferTokens() {
    const targetUserId = document.getElementById('transferToUser').value.trim();
    const amountOrig = document.getElementById('transferAmount').value;
    const amount = parseFloat(amountOrig);
    const assetType = document.getElementById('transferAssetType').value; // 'tokens', 'usd', 'Gems'

    if (!targetUserId || isNaN(amount) || amount <= 0) {
        window.showToast("Please enter a valid User ID and amount.");
        return;
    }

    if (String(targetUserId) === String(userData.id)) {
        window.showToast("You cannot transfer to yourself.");
        return;
    }

    // Confirmation
    const assetNames = { tokens: 'Tokens', usd: 'USD', Gems: 'Gems' };
    
    const overlay = document.createElement('div');
    overlay.style = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;";
    overlay.innerHTML = `
        <div style="background:#1a100a;border:1px solid rgba(245,158,11,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center;">
            <div style="color:#ef4444;font-size:36px;margin-bottom:16px;"><i class="fas fa-exclamation-triangle"></i></div>
            <h3 style="color:#fff;margin:0 0 12px 0;font-size:20px;">Confirm Transfer</h3>
            <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:24px;line-height:1.5;">Transfer ${amount} ${assetNames[assetType]} to User #${targetUserId}?</p>
            <div style="display:flex;gap:10px;">
                <button id="cancelTrxBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:rgba(255,255,255,0.1);color:#fff;font-weight:bold;cursor:pointer;">CANCEL</button>
                <button id="confirmTrxBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:#22c55e;color:#fff;font-weight:bold;cursor:pointer;">CONFIRM</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('cancelTrxBtn').onclick = () => overlay.remove();
    document.getElementById('confirmTrxBtn').onclick = async () => {
        overlay.remove();
        try {
            const response = await fetch('/api/user/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromUserId: userData.id,
                    toUserId: targetUserId,
                    amount: amount,
                    asset: assetType
                })
            });

            const res = await response.json();
        if (res.success) {
            window.showToast(res.message || "Transfer successful!", "success");
            // Update local user data
            if (res.newBalances) {
                userData.tokens = res.newBalances.tokens;
                userData.Gems = res.newBalances.Gems;
                userData.usd = res.newBalances.usd;
                renderBalances();
                loadRecentActivity(); // Refresh history after transfer
            }
            // Clear inputs
            document.getElementById('transferToUser').value = '';
            document.getElementById('transferAmount').value = '';
            // Nav back to profile
            setTimeout(() => nav('profile'), 2000);
        } else {
            window.showToast(res.message || "Transfer failed.");
        }
    } catch (e) {
        console.error("Transfer error:", e);
        window.showToast("Server error during transfer.");
    }
    };
}

function payWithBalance() {
    if (userData.usd >= 3.00) {
        // Process directly without confirmation
        window.showToast('Purchase request sent to server!');
    } else {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        window.showToast('Insufficient Balance ($' + userData.usd.toFixed(2) + '). Please deposit funds.');
    }
}

function selectPM(method) {
    if (method === 'binance') nav('binancePay');
    if (method === 'faucet') nav('faucetPay');
}

// =============================================
// DYNAMIC SERVICES & SHOP SYSTEM
// =============================================

// Default data (used if admin hasn't set anything yet)
const defaultServices = [
    { id: 'verify', name: 'Verification', desc: 'Get verified badge', icon: 'fas fa-check-circle', color: '#166534,#15803d', cost: 20, page: 'verify' },
    { id: 'gemini', name: 'Gemini Card', desc: 'Generate custom cards', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/60px-Google_Gemini_logo.svg.png', color: '#1e3a5f,#2563eb', cost: 10, page: 'serviceGenerate', serviceKey: 'gemini' },
    { id: 'chatgpt', name: 'ChatGPT', desc: 'AI Assistant Access', icon: 'fas fa-robot', color: '#7c3f00,#d97706', cost: 15, page: 'serviceGenerate', serviceKey: 'chatgpt' },
    { id: 'number', name: 'Number Service', desc: 'Virtual phone numbers', icon: 'fas fa-phone', color: '#4a044e,#9333ea', cost: 15, page: 'numberService' },
    { id: 'mail', name: 'Mail Service', desc: 'Temporary email inbox', icon: 'fas fa-envelope', color: '#7f1d1d,#dc2626', cost: 10, page: 'mailService' },
];

// Admin-configurable runtime config (filled from /api/admin/costs when possible)
window.appCostConfig = window.appCostConfig || {
    adReward: 5,
    zeroBalanceAdReward: 5,
    mailCost: 10,
    premiumMailCost: 50,
    hotMailCost: 15,
    studentMailCost: 20
};

async function loadAppCostConfig() {
    try {
        const res = await fetch('/api/admin/costs');
        const data = await res.json();
        if (!data?.success || !data.costs) return;
        const c = data.costs;
        window.appCostConfig.adReward = parseInt(c.adReward) || 5;
        window.appCostConfig.zeroBalanceAdReward = parseInt(c.zeroBalanceAdReward) || 5;
        window.appCostConfig.mailCost = parseInt(c.mailCost) || 10;
        // Premium mail cost uses token-based cost if present; otherwise fallback to 50
        window.appCostConfig.premiumMailCost = parseInt(c.premiumMailCost || c.gmailCost || 0) || 50;
        // Hot mail cost
        window.appCostConfig.hotMailCost = parseInt(c.hotMailCost) || 15;
        // Student mail cost
        window.appCostConfig.studentMailCost = parseInt(c.studentMailCost) || 20;

        const tempBadge = document.getElementById('tempMailCostBadge');
        if (tempBadge) tempBadge.textContent = `${window.appCostConfig.mailCost} TC / Email`;
        const premBadge = document.getElementById('premiumMailCostBadge');
        if (premBadge) premBadge.textContent = `${window.appCostConfig.premiumMailCost} TC / Email`;
        const hotBadge = document.getElementById('hotMailCostBadge');
        if (hotBadge) hotBadge.textContent = `${window.appCostConfig.hotMailCost} TC / Email`;
        const studentBadge = document.getElementById('studentMailCostBadge');
        if (studentBadge) studentBadge.textContent = `${window.appCostConfig.studentMailCost} TC / Email`;
    } catch (e) {
        // silent
    }
}

// Global state syncer for real-time updates from admin
var _lastSyncTime = 0;
var _lastUserSyncTime = 0;

async function smartSync(force = false) {
    const now = Date.now();
    if (!force && now - _lastSyncTime < 5000) return; // Minimum 5s between syncs (was 2s)

    _lastSyncTime = now;

    // Always sync admin config (features, services, costs)
    const adminSyncPromises = [
        typeof loadFeatureFlags === 'function' ? loadFeatureFlags() : Promise.resolve(),
        typeof syncAdminData === 'function' ? syncAdminData() : Promise.resolve()
    ];

    // Sync user balance every 15 seconds for real-time balance updates
    if (force || (now - _lastUserSyncTime > 15000)) {
        _lastUserSyncTime = now;
        if (userData.id && userData.id !== 0) {
            adminSyncPromises.push(
                fetch(`/api/user/${userData.id}?t=${now}`, { cache: 'no-store' })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success && data.user) {
                            const u = data.user;
                            // Only update if server value differs (prevent flicker)
                            if (typeof u.balance_tokens === 'number') userData.tokens = Math.max(0, u.balance_tokens);
                            if (typeof u.gems === 'number') userData.Gems = Math.max(0, u.gems);
                            if (typeof u.usd !== 'undefined') userData.usd = Math.max(0, u.usd || 0);
                            if (typeof u.banned !== 'undefined') {
                                userData.banned = u.banned;
                                userStatus = u.banned ? 'banned' : 'active';
                            }
                            if (u.apiKey !== undefined) {
                                if (u.apiKey) userData.apiKey = u.apiKey;
                            }
                            if (u.apiStatus) userData.apiStatus = u.apiStatus;
                            renderBalances();
                            // Persist to cache
                            try { localStorage.setItem(`userData_${userData.id}`, JSON.stringify(userData)); } catch(e){}
                        }
                    })
                    .catch(() => { /* silent – no network = keep cached */ })
            );
        }
    }

    return Promise.allSettled(adminSyncPromises).catch(() => {});
}

// Start auto-syncer (every 5 seconds – balanced for real-time feel without hammering server)
setInterval(() => smartSync(), 5000);


// Load cost config early so UI shows correct costs (email/ad reward, etc.)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadAppCostConfig();
    });
} else {
    loadAppCostConfig();
}

const defaultShopItems = [
    { id: 'gemini1y', name: 'GEMINI 1 YEAR', price: '$3.00', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/200px-Google_Gemini_logo.svg.png', bgColor: '#0d0d0d', btnColor: '#f59e0b', page: 'deposit' },
    { id: 'chatgptplus', name: 'CHATGPT PLUS', price: '$5.00', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/200px-ChatGPT_logo.svg.png', bgColor: '#0d0d0d', btnColor: '#22c55e', page: 'deposit' },
];

function getServices() {
    // Return cached or default for immediate render, then update from server
    const saved = localStorage.getItem('adminServices');
    return saved ? JSON.parse(saved) : defaultServices;
}

function getShopItems() {
    const saved = localStorage.getItem('adminShopItems');
    return saved ? JSON.parse(saved) : defaultShopItems;
}

// Fetch from backend and update UI
function syncAdminData() {
    window._lastSyncTime = Date.now();
    // Sync features too
    loadFeatureFlags();

    // Sync services
    fetch('/api/public/services')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.services) {
                localStorage.setItem('adminServices', JSON.stringify(data.services));
                renderServicesList();
            }
        });

    // Sync shop items
    fetch('/api/shop')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.shopItems) {
                localStorage.setItem('adminShopItems', JSON.stringify(data.shopItems));
            }
        });

    // Sync costs/rewards
    fetch('/api/public/costs')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.costs) {
                localStorage.setItem('adminCosts', JSON.stringify(data.costs));
                // Update global config if needed
                window.ADMIN_CONFIG = data.costs;
                
                const c = data.costs || {};
                const getCurrencyLabel = (val) => {
                    if (val === 'Gems' || val === 'gem') return 'Gems';
                    if (val === 'usd' || val === 'USD') return 'USD';
                    return 'TC';
                };

                if (document.getElementById('cost-live2fa')) document.getElementById('cost-live2fa').innerText = `${c.live2fa || 10} ${getCurrencyLabel(c.live2faCurrency)} / Request`;
                if (document.getElementById('cost-liveInstagram')) document.getElementById('cost-liveInstagram').innerText = `${c.liveInstagram || 10} ${getCurrencyLabel(c.liveInstagramCurrency)} / Request`;
                if (document.getElementById('cost-liveFacebook')) document.getElementById('cost-liveFacebook').innerText = `${c.liveFacebook || 10} ${getCurrencyLabel(c.liveFacebookCurrency)} / Request`;
                if (document.getElementById('cost-liveTiktok')) document.getElementById('cost-liveTiktok').innerText = `${c.liveTiktok || 10} ${getCurrencyLabel(c.liveTiktokCurrency)} / Request`;
                if (document.getElementById('cost-liveTwitter')) document.getElementById('cost-liveTwitter').innerText = `${c.liveTwitter || 10} ${getCurrencyLabel(c.liveTwitterCurrency)} / Request`;
                if (document.getElementById('cost-liveThreads')) document.getElementById('cost-liveThreads').innerText = `${c.liveThreads || 10} ${getCurrencyLabel(c.liveThreadsCurrency)} / Request`;
            }
        });

    // Also fetch approved user-submitted items
    fetch('/api/user/item-sales/approved')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                localStorage.setItem('approvedUserItems', JSON.stringify(data.items || []));
            }
        })
        .catch(() => { })
        .finally(() => renderShopItems());
    fetch('/api/admin/cards').then(r => r.json()).then(data => {
        if (data.success) {
            localStorage.setItem('adminCards', JSON.stringify(data.cards));
            if (typeof currentPage !== 'undefined' && currentPage === 'vccCards') renderCards();
        }
    });
    fetch('/api/admin/vpn').then(r => r.json()).then(data => {
        if (data.success) {
            localStorage.setItem('adminVPNs', JSON.stringify(data.vpns));
            if (typeof currentPage !== 'undefined' && currentPage === 'vpnServices') renderVPN();
        }
    });
}
syncAdminData();

function renderServicesList() {
    const list = document.getElementById('servicesList');
    if (!list) return;
    const services = getServices();
    list.innerHTML = services.map(s => {
        let iconHtml = '';
        if (s.imageUrl) {
            iconHtml = `<img src="${s.imageUrl}" style="width:32px; height:32px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-cog\\' style=\\'font-size:22px; color:#fff\\'></i>'">`;
        } else if (s.icon && (s.icon.includes('/') || s.icon.includes('http'))) {
            iconHtml = `<img src="${s.icon}" style="width:32px; height:32px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-cog\\' style=\\'font-size:22px; color:#fff\\'></i>'">`;
        } else {
            iconHtml = `<i class="${s.icon || 'fas fa-cog'}" style="font-size:22px; color:#fff;"></i>`;
        }
        return `
        <div onclick="openService('${s.id}')"
            style="background:var(--bg-card); border-radius:18px; padding:16px 18px; display:flex; align-items:center; gap:16px; border:1px solid var(--border-color); cursor:pointer; transition:0.2s;"
            onmousedown="this.style.background='var(--accent-bg)'" onmouseup="this.style.background='var(--bg-card)'">
            <div style="width:48px; height:48px; background:linear-gradient(135deg,${s.color || '#1e3a5f,#2563eb'}); border-radius:14px; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden;">
                ${iconHtml}
            </div>
            <div style="flex:1; min-width:0;">
                <div style="font-size:15px; font-weight:700; color:var(--text-main);">${s.name}</div>
                <div style="font-size:12px; color:var(--text-sub); margin-top:2px;">${s.desc}</div>
            </div>
            <i class="fas fa-chevron-right" style="color:var(--text-sub); font-size:13px;"></i>
        </div>`;
    }).join('');
}

function renderShopItems() {
    const grid = document.getElementById('shopGrid');

    // User-submitted approved items (with stock > 0)
    const userItems = JSON.parse(localStorage.getItem('approvedUserItems') || '[]')
        .filter(item => (item.stock || 0) > 0);

    let shopCardsHtml = '';
    let appCardsHtml = '';
    let vpnCardsHtml = '';
    let accountCardsHtml = '';
    let cardCardsHtml = '';

    const adminItems = getShopItems();

    // 1. Process Admin Items (Always in main shop)
    if (grid) {
        shopCardsHtml += adminItems.map(item => {
            const imgHtml = item.imageUrl
                ? `<img src="${item.imageUrl}" style="width:70px; height:auto; object-fit:contain;" onerror="this.style.display='none'">`
                : `<i class="fas fa-box" style="font-size:36px; color:#f59e0b;"></i>`;

            // Fix price display to ensure $ if not present
            let priceDisp = item.price || '$0.00';
            if (typeof priceDisp === 'number') priceDisp = '$' + priceDisp.toFixed(2);
            else if (!priceDisp.includes('$') && !priceDisp.toLowerCase().includes('tc')) priceDisp = '$' + priceDisp;

            return `
            <div onclick="nav('${item.page || 'deposit'}')"
                style="background:var(--bg-card); border-radius:16px; overflow:hidden; border:1px solid var(--border-color); cursor:pointer; transition:0.2s;"
                onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
                <div style="background:${item.bgColor || '#0d0d0d'}; padding:16px; display:flex; align-items:center; justify-content:center; min-height:80px;">
                    ${imgHtml}
                </div>
                <div style="padding:10px;">
                    <div style="font-size:10px; font-weight:700; color:var(--text-main); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name}</div>
                    <div style="font-size:14px; font-weight:800; color:#22c55e; margin-bottom:8px;">${priceDisp}</div>
                    <div style="background:rgba(245,158,11,0.1); border:1px solid ${item.btnColor || '#f59e0b'}; border-radius:8px; padding:6px; text-align:center; font-size:10px; font-weight:700; color:${item.btnColor || '#f59e0b'}; display:flex; align-items:center; justify-content:center; gap:4px;">
                        <i class="fas fa-shopping-cart"></i> BUY
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // 2. Process User Items
    userItems.forEach(item => {
        const displayName = item.accountName || item.customName || item.vpnName || item.serviceName || item.itemType;
        const iconHtml = item.accountLogo
            ? `<img src="${item.accountLogo}" style="width:60px; height:60px; object-fit:cover; border-radius:12px;" onerror="this.src='https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${displayName}'">`
            : (item.iconBase64
                ? `<img src="${item.iconBase64}" style="width:60px; height:60px; object-fit:cover; border-radius:12px;">`
                : (item.itemType === 'VPN' ? `<i class="fas fa-shield-alt" style="font-size:36px; color:#0ea5e9;"></i>`
                    : (item.itemType === 'Card' ? `<i class="fas fa-credit-card" style="font-size:36px; color:#8b5cf6;"></i>`
                        : (item.itemType === 'Account' ? `<i class="fas fa-user-circle" style="font-size:36px; color:#6366f1;"></i>`
                            : `<i class="fas fa-box" style="font-size:36px; color:#f59e0b;"></i>`))));

        const has2fa = item.is2fa;

        // Use $ for everything as requested
        let price = item.price || item.sellingPrice || 0;
        let priceDisp = '$' + parseFloat(price).toFixed(2);
        // if (item.itemType === 'Card') priceDisp = price + ' TC'; // User wants dollars now

        const cardHtml = `
        <div onclick="viewUserItem('${item.id}')"
            style="background:var(--bg-card); border-radius:16px; overflow:hidden; border:1px solid var(--border-color); cursor:pointer; transition:0.2s; position:relative;"
            onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
            ${has2fa ? `<div style="position:absolute; top:8px; right:8px; background:rgba(16,185,129,0.9); color:#fff; font-size:9px; font-weight:800; padding:2px 6px; border-radius:6px; z-index:2;">2FA</div>` : ''}
            <div style="background:#111; padding:16px; display:flex; align-items:center; justify-content:center; min-height:80px; position:relative;">
                ${iconHtml}
            </div>
            <div style="padding:10px;">
                <div style="font-size:10px; font-weight:700; color:var(--text-main); margin-bottom:2px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
                <div style="font-size:10px; color:#888; font-weight:600; margin-bottom:4px;">Stock: ${item.stock}</div>
                <div style="font-size:14px; font-weight:800; color:#22c55e; margin-bottom:8px;">${priceDisp}</div>
                <div style="background:rgba(245,158,11,0.1); border:1px solid #f59e0b; border-radius:8px; padding:6px; text-align:center; font-size:10px; font-weight:700; color:#f59e0b; display:flex; align-items:center; justify-content:center; gap:4px;">
                    <i class="fas fa-shopping-cart"></i> BUY
                </div>
            </div>
        </div>`;

        const listStyleCardHtml = `
        <div class="service-card" onclick="viewUserItem('${item.id}')" style="margin-bottom:12px; cursor:pointer;">
            <div class="sc-icon" style="background:#111;">${iconHtml.replace('60px', '40px')}</div>
            <div class="sc-info" style="flex:1;">
                <h3 style="font-size:14px;">${displayName}</h3>
                <p style="font-size:11px;">STOCK: ${item.stock} | PRICE: ${priceDisp}</p>
            </div>
            <div class="sc-arrow"><i class="fas fa-chevron-right"></i></div>
        </div>`;

        // Logic: if users select subscription then it will list in all section shop (main grid)
        // if user select not subscription (Premium Account) then it will list in premium account section
        if (item.isSubscription) {
            shopCardsHtml += cardHtml;
        } else {
            // Non-subscription items go to their respective tabs in Accounts Store
            if (item.itemType === 'Other' || item.itemType === 'Card') {
                // Both 'Other' and 'Card' now go to SHOP tab
                appCardsHtml += (item.itemType === 'Other' ? cardHtml : listStyleCardHtml);
            } else if (item.itemType === 'VPN') {
                vpnCardsHtml += listStyleCardHtml;
            } else if (item.itemType === 'Account') {
                accountCardsHtml += listStyleCardHtml;
            } else {
                // Fallback to Account tab if unclear
                accountCardsHtml += listStyleCardHtml;
            }
        }
    });

    if (grid) {
        grid.innerHTML = shopCardsHtml || '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-sub);">No items available</div>';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        grid.style.gap = '12px';
    }

    // Inject to premium tabs if elements exist
    const pAppGrid = document.getElementById('premiumAppsGrid');
    if (pAppGrid) pAppGrid.innerHTML = appCardsHtml || '<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-sub);">No apps available</div>';

    const pVpnList = document.getElementById('premiumVPNList');
    if (pVpnList) pVpnList.innerHTML = vpnCardsHtml || '<div style="text-align:center; padding:40px; color:var(--text-sub);">No VPNs available</div>';

    const pAccList = document.getElementById('userApprovedAccounts');
    if (pAccList) pAccList.innerHTML = accountCardsHtml || '';

    // For Cards, since renderCards is called separately, we might just append or handle it within renderCards.
    // However, if we do it here it's cleaner to append. Let's let renderCards handle its own logic, or append.
    // For now, let's store user cards in global var or just let renderCards run and append.
    window._userCardHtml = cardCardsHtml;
}

window.renderShopItems = renderShopItems;




function renderCards() {
    const container = document.getElementById('cardsList');
    if (!container) return;

    // Get admin cards
    const adminCards = JSON.parse(localStorage.getItem('adminCards') || '[]');

    // Get user-submitted approved cards
    const approvedUserItems = JSON.parse(localStorage.getItem('approvedUserItems') || '[]');
    const userCards = approvedUserItems.filter(item => item.itemType === 'Card');

    let html = '';

    // Render admin cards
    if (adminCards.length > 0) {
        html += adminCards.map(c => `
        <div class="service-card" style="margin-bottom:12px; cursor:default; padding:16px;">
            <div class="sc-icon" style="background:linear-gradient(135deg,#f59e0b,#d97706); width:50px; height:50px; border-radius:16px; flex-shrink:0;">
                <i class="fas fa-credit-card"></i>
            </div>
            <div class="sc-info" style="flex:1; margin-left:14px;">
                <h3 style="font-size:15px; font-weight:700; color:var(--text-main); margin:0;">${c.name}</h3>
                <p style="font-size:11px; color:var(--text-sub); margin:4px 0 0 0; font-weight:600;">Stock: ${c.count}</p>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <div style="font-weight:900; color:#22c55e; font-size:15px; letter-spacing:0.5px;">${c.price} TC</div>
                <button onclick="buyAccount('card', ${c.price}, '${c.id}')" 
                    style="padding:6px 16px; border-radius:12px; background:#fbbf24; color:#000; font-weight:800; font-size:11px; border:none; cursor:pointer; box-shadow:0 4px 10px rgba(251,191,36,0.2);">
                    BUY
                </button>
            </div>
        </div>`).join('');
    }

    // Render user-submitted cards with custom name and logo
    if (userCards.length > 0) {
        html += userCards.map(card => {
            const cardData = card.cards && card.cards[0] ? card.cards[0] : {};
            const cardNumber = cardData.number ? '**** ' + cardData.number.slice(-4) : '**** ****';
            const cardLogo = card.cardLogo || null;

            return `
            <div class="service-card" onclick="showCardDetail({cardName: '${card.cardName || 'Virtual Card'}', holderName: '${cardData.holderName || 'CARD HOLDER'}', number: '${cardData.displayNumber || cardNumber}', month: '${cardData.month || 'MM'}', year: '${cardData.year || 'YYYY'}', cvv: '${cardData.cvv || '***'}', country: '${(card.cardBillingAddress && card.cardBillingAddress.Country) || 'N/A'}'})" 
                style="margin-bottom:12px; cursor:pointer; padding:16px; background:linear-gradient(135deg, #1a1f71 0%, #4a5568 100%); border:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; align-items:center; gap:12px; flex:1;">
                    ${cardLogo ? `<div style="width:50px; height:50px; border-radius:12px; overflow:hidden; flex-shrink:0; background:#fff;"><img src="${cardLogo}" style="width:100%; height:100%; object-fit:cover;"></div>` :
                    `<div class="sc-icon" style="background:linear-gradient(135deg,#8b5cf6,#6d28d9); width:50px; height:50px; border-radius:16px; flex-shrink:0;">
                        <i class="fas fa-credit-card"></i>
                    </div>`}
                    <div class="sc-info" style="flex:1;">
                        <h3 style="font-size:15px; font-weight:700; color:#fff; margin:0;">${card.cardName || 'Virtual Card'}</h3>
                        <p style="font-size:12px; color:rgba(255,255,255,0.7); margin:4px 0 0 0; font-family:monospace; letter-spacing:1px;">${cardNumber}</p>
                        <p style="font-size:10px; color:rgba(255,255,255,0.5); margin:2px 0 0 0;">Type: ${card.cardType || 'Visa'} • IP: ${card.cardIP || 'N/A'}</p>
                    </div>
                </div>
                <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                    <div style="font-weight:900; color:#22c55e; font-size:15px; letter-spacing:0.5px;">${card.rewardOffer || 0} TC</div>
                    <button onclick="event.stopPropagation(); buyUserCard('${card.id}', ${card.rewardOffer || 0})" 
                        style="padding:6px 16px; border-radius:12px; background:#22c55e; color:#fff; font-weight:800; font-size:11px; border:none; cursor:pointer; box-shadow:0 4px 10px rgba(34,197,94,0.3);">
                        BUY
                    </button>
                </div>
            </div>`;
        }).join('');
    }

    if (window._userCardHtml) html += window._userCardHtml;

    container.innerHTML = html || '<div style="text-align:center; padding:40px 0; color:var(--text-sub); opacity:0.5;">No cards available</div>';
}
window.renderCards = renderCards;

// Buy user-submitted card
async function buyUserCard(cardId, price) {
    const userId = userData.id;
    const balance = userData.tokens || 0;

    if (balance < price) {
        window.showToast('❌ Insufficient balance!');
        return;
    }

    try {
        const res = await fetch('/api/user/item-sales/buy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, cardId })
        });
        const data = await res.json();

        if (data.success) {
            userData.tokens = data.newBalance;
            renderBalances();
            window.showToast('✅ Card purchased successfully!');
            loadRecentActivity();

            // Show details if it's a card
            if (data.details && (data.details.cardNumber || data.details.email)) {
                // Parse expiry
                let month = 'MM', year = 'YYYY';
                if (data.details.cardExpiry && data.details.cardExpiry.includes('/')) {
                    const parts = data.details.cardExpiry.split('/');
                    month = parts[0];
                    year = parts[1].length === 2 ? '20' + parts[1] : parts[1];
                }

                showCardDetail({
                    cardName: 'MARKETPLACE CARD',
                    holderName: 'CARD HOLDER',
                    number: data.details.cardNumber || data.details.email || '**** **** **** ****',
                    cvv: data.details.cardCVV || data.details.password || '***',
                    month: month,
                    year: year,
                    country: 'Marketplace'
                });
            }

            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } else {
            window.showToast('❌ ' + data.message);
        }
    } catch (e) {
        window.showToast('Error purchasing card');
    }
}
window.buyUserCard = buyUserCard;

// Copy to clipboard function with visual feedback
function copyToClipboard(elementId, button) {
    const element = document.getElementById(elementId);
    if (!element) return;

    let textToCopy = '';

    // Check if element is input/textarea or standard element
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        textToCopy = element.value;
        element.select();
        element.setSelectionRange(0, 99999); // For mobile devices
    } else {
        textToCopy = element.textContent.trim();
    }

    // Modern clipboard API with fallback
    const copyPromise = navigator.clipboard ? 
        navigator.clipboard.writeText(textToCopy) : 
        new Promise((resolve, reject) => {
            try {
                // Fallback for older browsers
                const textArea = document.createElement("textarea");
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                document.body.removeChild(textArea);
                resolve();
            } catch (err) {
                reject(err);
            }
        });

    copyPromise.then(() => {
        // Visual feedback if button provided
        if (button) {
            const icon = button.querySelector('i');
            if (icon) {
                const originalClass = icon.className;
                icon.className = 'fas fa-check';
                icon.style.color = '#22c55e';

                // Revert after 2 seconds
                setTimeout(() => {
                    icon.className = originalClass;
                    icon.style.color = ''; // Reset color
                }, 2000);
            }
        }

        // Show toast
        if (window.showToast) {
            window.showToast('✅ Copied to clipboard!');
        }

        // Haptic feedback
        if (window.tg && tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
    }).catch(() => {
        if (window.showToast) {
            window.showToast('❌ Failed to copy');
        }
    });
}
window.copyToClipboard = copyToClipboard;

// Show card details page with data
function showCardDetail(cardData) {
    if (!cardData) return;

    // Populate card details
    document.getElementById('cardDetailLabel').textContent = cardData.cardName || 'VIRTUAL CARD';
    document.getElementById('cardDetailHolder').textContent = cardData.holderName || 'CARD HOLDER';
    document.getElementById('cardDetailNumber').textContent = cardData.number || '**** **** **** ****';
    document.getElementById('cardDetailExpiry').textContent = `${cardData.month || 'MM'}/${cardData.year || 'YYYY'}`;
    document.getElementById('cardDetailCVV').textContent = cardData.cvv || '***';
    document.getElementById('cardDetailCountry').textContent = cardData.country || 'N/A';

    // Navigate to card detail page
    nav('cardDetail');
}
window.showCardDetail = showCardDetail;

function renderVPN() {
    const container = document.getElementById('vpnList');
    if (!container) return;
    const vpns = JSON.parse(localStorage.getItem('adminVPNs') || '[]');
    let html = '';

    if (vpns.length > 0) {
        html += vpns.map(v => `
        <div class="service-card" style="margin-bottom:12px; cursor:default; padding:16px;">
            <div class="sc-icon" style="background:linear-gradient(135deg,#3b82f6,#1d4ed8); width:50px; height:50px; border-radius:16px; flex-shrink:0;">
                <i class="fas fa-shield-alt"></i>
            </div>
            <div class="sc-info" style="flex:1; margin-left:14px;">
                <h3 style="font-size:15px; font-weight:700; color:var(--text-main); margin:0;">${v.name}</h3>
                <p style="font-size:11px; color:var(--text-sub); margin:4px 0 0 0; font-weight:600;">Location: Premium</p>
            </div>
            <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <div style="font-weight:900; color:#22c55e; font-size:15px; letter-spacing:0.5px;">${v.price} TC</div>
                <button onclick="buyAccount('vpn', ${v.price}, '${v.id}')" 
                    style="padding:6px 16px; border-radius:12px; background:#3b82f6; color:#fff; font-weight:800; font-size:11px; border:none; cursor:pointer; box-shadow:0 4px 10px rgba(59,130,246,0.2);">
                    BUY
                </button>
            </div>
        </div>`).join('');
    }

    if (window._userVpnHtml) html += window._userVpnHtml; // In case we export it differently

    container.innerHTML = html || '<div style="text-align:center; padding:40px 0; color:var(--text-sub); opacity:0.5;">No VPN accounts available</div>';
}

// ========================
// ACCOUNTS STORE
// ========================
function renderAccounts() {
    const container = document.getElementById('accountsStoreList');
    if (!container) return;

    fetch('/api/accounts')
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.accounts || data.accounts.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding:40px 0; color:var(--text-sub);">
                        <i class="fas fa-box-open" style="font-size:32px; margin-bottom:12px; display:block;"></i>
                        <p>No accounts available right now</p>
                    </div>`;
                return;
            }

            const typeIcons = {
                'netflix': { icon: 'fas fa-tv', color: '#e50914', bg: 'rgba(229,9,20,0.1)' },
                'spotify': { icon: 'fas fa-music', color: '#1db954', bg: 'rgba(29,185,84,0.1)' },
                'prime': { icon: 'fas fa-play', color: '#00a8e1', bg: 'rgba(0,168,225,0.1)' },
                'crunchyroll': { icon: 'fas fa-play-circle', color: '#f47521', bg: 'rgba(244,117,33,0.1)' },
                'nordvpn': { icon: 'fas fa-shield-alt', color: '#4687ff', bg: 'rgba(70,135,255,0.1)' },
                'expressvpn': { icon: 'fas fa-lock', color: '#da3940', bg: 'rgba(218,57,64,0.1)' },
                'chatgpt': { icon: 'fas fa-robot', color: '#10a37f', bg: 'rgba(16,163,127,0.1)' },
                'other': { icon: 'fas fa-user-circle', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' }
            };

            container.innerHTML = data.accounts.map(acc => {
                const t = typeIcons[acc.type] || typeIcons['other'];
                return `
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:16px; padding:16px; display:flex; align-items:center; gap:14px;">
                    <div style="width:48px; height:48px; border-radius:12px; background:${t.bg}; display:flex; align-items:center; justify-content:center; color:${t.color}; font-size:22px; flex-shrink:0;">
                        <i class="${t.icon}"></i>
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; color:var(--text-main); text-transform:capitalize; font-size:14px;">${acc.type}</div>
                        <div style="font-size:11px; color:var(--text-sub); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${acc.email}</div>
                    </div>
                    <div style="text-align:right; flex-shrink:0;">
                        <div style="font-weight:800; color:#22c55e; font-size:14px;">${acc.price} TC</div>
                        <button onclick="buyPremiumAccount('${acc.id}', '${acc.type}', ${acc.price})" style="margin-top:4px; padding:5px 14px; border-radius:8px; background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; font-weight:700; font-size:10px; border:none; cursor:pointer;">BUY</button>
                    </div>
                </div>`;
            }).join('');
        })
        .catch(() => {
            container.innerHTML = `<div style="text-align:center; padding:40px 0; color:var(--text-sub);">Failed to load accounts</div>`;
        });
}

function buyPremiumAccount(accountId, type, price) {
    if (!userData || !userData.id) {
        window.showToast('Please login first.');
        return;
    }

    if (checkZeroBalanceAdTrigger(price)) return;

    if (userTokens < price) {
        nav('earn');
        return;
    }

    // Purchase directly without confirmation
    fetch('/api/accounts/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, accountId })
    })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                userData.tokens = res.newBalance;
                renderBalances();

                // Special handling for VCC cards
                if (type === 'card' || (res.account && res.account.type === 'card')) {
                    const card = res.account;
                    showCardDetail({
                        cardName: card.name || 'VIRTUAL CARD',
                        holderName: 'CARD HOLDER',
                        number: card.email || card.number || '**** **** **** ****',
                        cvv: card.password || card.cvv || '***',
                        expiry: card.instructions || (card.month ? `${card.month}/${card.year}` : 'MM/YYYY'),
                        country: card.country || 'Global'
                    });
                    window.showToast('✅ Card purchased! Details shown below.');
                } else {
                    // Show regular account details
                    window.showToast(`✅ Account purchased!\n\nEmail: ${res.account.email}\nPassword: ${res.account.password}${res.account.instructions ? '\nNotes: ' + res.account.instructions : ''}\n\nPlease save these details!`);
                }

                renderAccounts(); // Refresh
                if (typeof renderCards === 'function') renderCards();
            } else {
                window.showToast(res.message || 'Purchase failed');
            }
        })
        .catch(() => window.showToast('Network error'));
}

// ==========================================
// ACCOUNT STORE CATEGORY DETAIL
// ==========================================

const ACCOUNT_CATEGORIES = {
    gmail: {
        name: 'Gmail Accounts',
        icon: 'fas fa-envelope',
        color: '#ea4335',
        gradient: 'linear-gradient(135deg, #ea4335, #c5221f)',
        desc: 'Verified Gmail accounts ready for use. Phone-verified and aged accounts available.',
        price: 50,
        features: ['Phone Verified', 'Aged Account', 'Recovery Email Set', 'Instant Delivery']
    },
    netflix: {
        name: 'Netflix Premium',
        icon: 'fas fa-film',
        color: '#e50914',
        gradient: 'linear-gradient(135deg, #e50914, #b81d24)',
        desc: 'Premium Netflix accounts with UHD streaming. Shared and private accounts available.',
        price: 80,
        features: ['4K UHD Streaming', '1 Month Warranty', 'Auto-Renew Option', 'Instant Delivery']
    },
    spotify: {
        name: 'Spotify Premium',
        icon: 'fab fa-spotify',
        color: '#1db954',
        gradient: 'linear-gradient(135deg, #1db954, #15873d)',
        desc: 'Premium Spotify accounts with ad-free music. Individual and family plans available.',
        price: 40,
        features: ['Ad-Free Music', 'Offline Downloads', 'High Quality Audio', 'Instant Delivery']
    },
    disney: {
        name: 'Disney+ Premium',
        icon: 'fas fa-star',
        color: '#113ccf',
        gradient: 'linear-gradient(135deg, #113ccf, #0b25a0)',
        desc: 'Premium Disney+ accounts with full content library access including Marvel and Star Wars.',
        price: 60,
        features: ['Full Content Library', '4K Streaming', '4 Screens', 'Instant Delivery']
    },
    youtube: {
        name: 'YouTube Premium',
        icon: 'fab fa-youtube',
        color: '#ff0000',
        gradient: 'linear-gradient(135deg, #ff0000, #cc0000)',
        desc: 'Ad-free YouTube with background play, YouTube Music, and offline downloads.',
        price: 45,
        features: ['Ad-Free Videos', 'Background Play', 'YouTube Music', 'Instant Delivery']
    },
    amazon: {
        name: 'Amazon Prime',
        icon: 'fab fa-amazon',
        color: '#ff9900',
        gradient: 'linear-gradient(135deg, #ff9900, #cc7a00)',
        desc: 'Amazon Prime with free shipping, Prime Video, and Prime Music included.',
        price: 70,
        features: ['Free Shipping', 'Prime Video', 'Prime Music', 'Instant Delivery']
    }
};

let currentAccountCategory = null;

function showAccountCategory(category) {
    currentAccountCategory = category;
    const cat = ACCOUNT_CATEGORIES[category];
    if (!cat) return;

    const container = document.getElementById('accountDetailContent');
    if (!container) return;

    container.innerHTML = `
        <!-- Category Header Card -->
        <div style="background:${cat.gradient}; border-radius:24px; padding:28px 20px; margin-bottom:20px; text-align:center; position:relative; overflow:hidden;">
            <div style="position:absolute; top:0; left:0; right:0; bottom:0; background:radial-gradient(circle at 30% 50%, rgba(255,255,255,0.1), transparent 70%);"></div>
            <div style="position:relative; z-index:1;">
                <div style="width:70px; height:70px; background:rgba(255,255,255,0.2); border-radius:20px; display:flex; align-items:center; justify-content:center; margin:0 auto 14px; backdrop-filter:blur(10px);">
                    <i class="${cat.icon}" style="font-size:32px; color:#fff;"></i>
                </div>
                <div style="font-size:20px; font-weight:900; color:#fff; margin-bottom:6px;">${cat.name}</div>
                <div style="font-size:12px; color:rgba(255,255,255,0.8); max-width:260px; margin:0 auto; line-height:1.5;">${cat.desc}</div>
            </div>
        </div>

        <!-- Price Card -->
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:20px; padding:20px; margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <div style="font-size:12px; font-weight:700; color:var(--text-sub); text-transform:uppercase; letter-spacing:1px;">Price</div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <i class="fas fa-coins" style="color:#fbbf24; font-size:14px;"></i>
                    <span style="font-size:22px; font-weight:900; color:#fbbf24;">${cat.price}</span>
                    <span style="font-size:12px; color:var(--text-sub); font-weight:600;">TOKENS</span>
                </div>
            </div>
            <div style="height:1px; background:var(--border-color); margin-bottom:16px;"></div>
            <div style="font-size:11px; font-weight:700; color:var(--text-sub); margin-bottom:10px; text-transform:uppercase; letter-spacing:1px;">What you get</div>
            ${cat.features.map(f => `
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
                    <i class="fas fa-check-circle" style="color:${cat.color}; font-size:14px;"></i>
                    <span style="font-size:13px; color:var(--text-main); font-weight:600;">${f}</span>
                </div>
            `).join('')}
        </div>

        <!-- Credentials Box (Hidden by default, shown after purchase) -->
        <div id="accountCredentialsBox" style="display:none; margin-bottom:16px;">
            <div style="background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.3); border-radius:20px; padding:20px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">
                    <i class="fas fa-check-circle" style="color:#22c55e; font-size:16px;"></i>
                    <span style="font-size:14px; font-weight:800; color:#22c55e;">PURCHASE SUCCESSFUL</span>
                </div>
                <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:14px; padding:16px;">
                    <div style="margin-bottom:12px;">
                        <div style="font-size:10px; font-weight:700; color:var(--text-sub); margin-bottom:4px; text-transform:uppercase;">Email</div>
                        <div id="accCredEmail" style="font-size:14px; font-weight:700; color:var(--text-main); background:rgba(255,255,255,0.05); padding:10px 12px; border-radius:10px; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                            <span id="accEmailText">-</span>
                            <i class="fas fa-copy" style="color:${cat.color}; cursor:pointer;" onclick="copyAccCred('email')"></i>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:10px; font-weight:700; color:var(--text-sub); margin-bottom:4px; text-transform:uppercase;">Password</div>
                        <div id="accCredPass" style="font-size:14px; font-weight:700; color:var(--text-main); background:rgba(255,255,255,0.05); padding:10px 12px; border-radius:10px; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                            <span id="accPassText">-</span>
                            <i class="fas fa-copy" style="color:${cat.color}; cursor:pointer;" onclick="copyAccCred('pass')"></i>
                        </div>
                    </div>
                </div>
                <div style="margin-top:12px; font-size:11px; color:#888; text-align:center; font-weight:600;">
                    <i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> Save these credentials! They won't be shown again.
                </div>
            </div>
        </div>

        <!-- Buy Button -->
        <button id="buyAccountBtn" onclick="buyAccountFromCategory('${category}')"
            style="width:100%; padding:16px; border:none; border-radius:16px; font-weight:900; font-size:15px; color:#fff; background:${cat.gradient}; cursor:pointer; text-transform:uppercase; letter-spacing:1px; box-shadow:0 8px 24px ${cat.color}44; transition:all 0.3s ease;">
            <i class="fas fa-shopping-cart"></i> BUY FOR ${cat.price} TOKENS
        </button>

        <!-- Availability Note -->
        <div style="margin-top:16px; text-align:center;">
            <div style="font-size:11px; color:var(--text-sub); font-weight:600;">
                <i class="fas fa-circle" style="color:#22c55e; font-size:8px;"></i> Available &bull; Instant Delivery &bull; 24/7 Support
            </div>
        </div>
    `;
}
window.showAccountCategory = showAccountCategory;

function buyAccountFromCategory(category) {
    const cat = ACCOUNT_CATEGORIES[category];
    if (!cat) return;

    if (checkZeroBalanceAdTrigger()) return;

    if (userTokens < cat.price) {
        nav('earn');
        return;
    }

    // Execute purchase directly without confirmation
    const btn = document.getElementById('buyAccountBtn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PROCESSING...';
        btn.style.pointerEvents = 'none';
    }

    fetch('/api/accounts/buy-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, category: category, price: cat.price })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                userData.tokens = data.newBalance;
                updateBalanceUI();

                // Show credentials
                const credBox = document.getElementById('accountCredentialsBox');
                const emailEl = document.getElementById('accEmailText');
                const passEl = document.getElementById('accPassText');

                if (credBox) credBox.style.display = 'block';
                if (emailEl) emailEl.textContent = data.account.email;
                if (passEl) passEl.textContent = data.account.password;

                if (btn) {
                    btn.innerHTML = '<i class="fas fa-check"></i> PURCHASED';
                    btn.style.background = '#22c55e';
                    btn.style.boxShadow = '0 8px 24px rgba(34,197,94,0.3)';
                    btn.style.pointerEvents = 'none';
                }

                // Confetti
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                if (typeof confetti !== 'undefined') {
                    var duration = 3 * 1000;
                    var animationEnd = Date.now() + duration;
                    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 99999 };
                    var interval = setInterval(function () {
                        var timeLeft = animationEnd - Date.now();
                        if (timeLeft <= 0) return clearInterval(interval);
                        var particleCount = 50 * (timeLeft / duration);
                        confetti(Object.assign({}, defaults, { particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } }));
                    }, 250);
                }
            } else {
                window.showToast(data.message || 'Purchase failed.');
                if (btn) {
                    btn.innerHTML = `<i class="fas fa-shopping-cart"></i> BUY FOR ${cat.price} TOKENS`;
                    btn.style.pointerEvents = 'auto';
                }
            }
        })
        .catch(() => {
            window.showToast('Network error. Please try again.');
            if (btn) {
                btn.innerHTML = `<i class="fas fa-shopping-cart"></i> BUY FOR ${cat.price} TOKENS`;
                btn.style.pointerEvents = 'auto';
            }
        });
}
window.buyAccountFromCategory = buyAccountFromCategory;

function copyAccCred(type) {
    const el = type === 'email' ? document.getElementById('accEmailText') : document.getElementById('accPassText');
    if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            window.showToast(`${type === 'email' ? 'Email' : 'Password'} copied!`);
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        }).catch(() => {
            window.showToast('Copy failed. Please copy manually.');
        });
    }
}
window.copyAccCred = copyAccCred;
let currentServiceData = null;

function openService(serviceId) {
    const services = getServices();
    const s = services.find(x => x.id === serviceId);
    if (!s) return;

    if (s.page === 'serviceGenerate') {
        currentServiceData = s;
        // Populate the generate page
        const nameEl = document.getElementById('sgServiceName');
        const costEl = document.getElementById('sgServiceCost');
        const descEl = document.getElementById('sgServiceDesc');
        const iconEl = document.getElementById('sgServiceIcon');

        if (nameEl) nameEl.textContent = s.name;
        if (costEl) costEl.textContent = (s.cost || 10) + ' TC';
        if (descEl) descEl.textContent = s.desc || 'Generate your service account instantly.';
        if (iconEl) {
            if (s.imageUrl) {
                iconEl.innerHTML = `<img src="${s.imageUrl}" style="width:44px; height:44px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\\'${s.icon || 'fas fa-cog'}\\' style=\\'font-size:28px; color:#fff\\'></i>'">`;
                iconEl.style.background = `linear-gradient(135deg,${s.color || '#1e3a5f,#2563eb'})`;
            } else {
                iconEl.innerHTML = `<i class="${s.icon || 'fas fa-cog'}" style="font-size:28px; color:#fff;"></i>`;
                iconEl.style.background = `linear-gradient(135deg,${s.color || '#1e3a5f,#2563eb'})`;
            }
        }
        nav('serviceGenerate');
        // Update header title to service name
        setTimeout(() => {
            const ht = document.getElementById('headerTitle');
            if (ht) ht.textContent = s.name.toUpperCase();
        }, 20);
    } else {
        nav(s.page || serviceId);
    }
}

function generateService(type) {
    const s = type ? null : currentServiceData;
    const cost = s ? (s.cost || 10) : (type === 'number' ? 15 : 10);
    const name = s ? s.name : (type === 'number' ? 'Number Service' : 'Mail Service');

    if (Math.max(0, userData.tokens || 0) < cost) {
        nav('earn');
        return;
    }

    // Generate directly without confirmation
    userData.tokens -= cost;
    renderBalances();
    window.showToast(` ${name} generated successfully!\n\nYour balance: ${Math.max(0, userData.tokens || 0)} TC`);
}

// =============================================
// NUMBER SERVICE
// =============================================
let currentNumSession = null;
let numOtpPollInterval = null;
let selectedNumPlatform = 'telegram';

// Load platforms from API (sorted by popularity)
function loadNumPlatforms() {
    const list = document.getElementById('numPlatformList');
    if (!list) return;

    fetch('/api/number/platforms')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.platforms) {
                list.innerHTML = '';
                data.platforms.forEach((p, idx) => {
                    // Most popular (first item) gets selected by default if nothing selected
                    const isActive = idx === 0;
                    if (isActive) {
                        if (!selectedNumPlatform) {
                            selectedNumPlatform = p.id;
                            updateSelectedService(p.id, p.name, p.icon, p.color);
                        }
                        // Update country dropdown for the default selected platform
                        setTimeout(() => updateCountryDropdown(p.availableCountries), 100);
                    }

                    const btn = document.createElement('button');
                    btn.className = 'num-platform-btn';
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        selectNumPlatform(btn, p.id);
                        updateSelectedService(p.id, p.name, p.icon, p.color);
                        updateCountryDropdown(p.availableCountries);
                    };
                    btn.style.cssText = `background:${isActive ? 'rgba(147,51,234,0.15)' : 'var(--accent-bg)'}; border:2px solid ${isActive ? '#9333ea' : 'var(--border-color)'}; border-radius:12px; padding:12px 8px; display:flex; flex-direction:column; align-items:center; gap:6px; cursor:pointer; position:relative; transition:all 0.2s;`;

                    // Add "POPULAR" badge for platforms marked as popular
                    let badge = '';
                    if (p.isPopular) {
                        badge = `<div style="position:absolute; top:-6px; right:-6px; background:#9333ea; color:#fff; font-size:8px; padding:2px 6px; border-radius:10px; font-weight:900;">🔥 POPULAR</div>`;
                    }

                    btn.innerHTML = `
                        ${badge}
                        <i class="${p.icon}" style="font-size:20px; color:${p.color};"></i>
                        <span style="font-size:10px; font-weight:700; color:var(--text-main);">${p.name}${p.availableCount ? ` (${p.availableCount})` : ''}</span>
                    `;
                    list.appendChild(btn);

                    if (isActive) selectedNumPlatform = p.id;
                });
            }
        }).catch(err => console.error('Error loading platforms:', err));
}

function updateCountryDropdown(availableCountries) {
    const select = document.getElementById('numCountrySelect');
    if (!select) return;

    // Read full list from existing options first to preserve names and flags
    if (!window._fullCountryOptions) {
        window._fullCountryOptions = Array.from(select.options).map(opt => ({
            value: opt.value,
            text: opt.text
        }));
    }

    select.innerHTML = '';
    let added = 0;
    window._fullCountryOptions.forEach(opt => {
        if (availableCountries && availableCountries.includes(opt.value)) {
            const newOpt = document.createElement('option');
            newOpt.value = opt.value;
            newOpt.text = opt.text;
            select.appendChild(newOpt);
            added++;
        }
    });

    // If no countries available, show a placeholder
    if (added === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.text = 'No countries available';
        select.appendChild(opt);
    }
}

function selectNumPlatform(el, platform) {
    selectedNumPlatform = platform;
    document.querySelectorAll('.num-platform-btn').forEach(b => {
        b.style.border = '2px solid var(--border-color)';
        b.style.background = 'var(--accent-bg)';
    });
    el.style.border = '2px solid #9333ea';
    el.style.background = 'rgba(147,51,234,0.15)';
}

function updateNumBalance() {
    const el = document.getElementById('numBalanceDisplay');
    if (el) el.textContent = formatCompact(Math.max(0, userData.tokens || 0)) + ' TC';
}

// Number session tracking
let activeVirtualNumbers = [];
let hasShownLimitInfo = false;
let numGlobalInterval = null;
let numSessionCost = 15;

function initActiveVirtualNumbers() {
    try {
        const stored = localStorage.getItem('activeVirtualNumbers');
        if (stored) {
            activeVirtualNumbers = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error loading active numbers:', e);
        activeVirtualNumbers = [];
    }

    if (numGlobalInterval) clearInterval(numGlobalInterval);
    numGlobalInterval = setInterval(updateActiveNumbersTick, 1000);

    renderActiveNumbers();
}

function saveActiveNumbers() {
    localStorage.setItem('activeVirtualNumbers', JSON.stringify(activeVirtualNumbers));
}

function updateActiveNumbersTick() {
    const now = Date.now();
    let changed = false;

    activeVirtualNumbers.forEach(session => {
        if (session.status === 'pending') {
            if (now >= session.expiry) {
                session.status = 'failed';
                userData.tokens += numSessionCost;
                updateNumBalance();
                updateNumHistoryStatus(session.number, 'failed');
                window.showToast?.(`Number ${session.number} expired. Tokens refunded.`);
                changed = true;

                // Notify server about expiry
                fetch('/api/number/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: session.sessionId, userId: userData.id })
                });
            } else {
                // Poll server for OTP if it's been more than 3 seconds since last poll
                if (!session.lastPoll || now - session.lastPoll > 3000) {
                    session.lastPoll = now;
                    if (session.sessionId) {
                        fetch(`/api/number/otp?sessionId=${session.sessionId}`)
                            .then(res => res.json())
                            .then(data => {
                                if (data.success && data.otp && data.otp !== 'Waiting...') {
                                    session.status = 'success';
                                    session.otp = data.otp;
                                    updateNumHistoryStatus(session.number, 'success');
                                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                                    window.showToast?.(`OTP received for ${session.number}!`);
                                    saveActiveNumbers();
                                    renderActiveNumbers();
                                }
                            }).catch(e => console.error('OTP poll error:', e));
                    }
                }
            }
        }
    });

    if (changed) {
        saveActiveNumbers();
        renderActiveNumbers();
    }
    updateActiveNumbersUI();
}

function renderActiveNumbers() {
    const container = document.getElementById('activeNumbersContainer');
    if (!container) return;

    container.innerHTML = activeVirtualNumbers.map(session => {
        const isSuccess = session.status === 'success';
        const isFailed = session.status === 'failed';
        const statusColor = isSuccess ? '#22c55e' : (isFailed ? '#ef4444' : 'var(--text-sub)');
        let statusText = isSuccess ? 'SUCCESS ✓' : (isFailed ? 'FAIL ✗ - 15 TC Refunded' : 'Waiting for OTP...');

        return `
            <div data-session-id="${session.id}" class="active-number-card" style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:12px; margin-bottom:12px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1; overflow:hidden;">
                        <div style="width:36px; height:36px; background:rgba(147,51,234,0.1); border-radius:10px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                            <i class="fas fa-phone" style="color:#9333ea; font-size:14px;"></i>
                        </div>
                        <div style="flex:1; overflow:hidden;">
                            <div style="font-size:10px; color:var(--text-sub); font-weight:700; margin-bottom:2px; text-transform:uppercase; letter-spacing:0.5px;">${(session.platform || 'Telegram').toUpperCase()} NUMBER</div>
                            <div style="font-size:15px; font-weight:800; color:var(--text-main); font-family:monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${session.number}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <button onclick="copyNumByValue('${session.number}')" style="width:36px; height:36px; border-radius:10px; background:rgba(147,51,234,0.1); border:1px solid rgba(147,51,234,0.3); display:flex; align-items:center; justify-content:center; cursor:pointer;" title="Copy Number">
                            <i class="fas fa-copy" style="color:#9333ea; font-size:13px;"></i>
                        </button>
                        <button onclick="cancelNumberBySessionId('${session.id}')" style="width:36px; height:36px; border-radius:10px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); display:flex; align-items:center; justify-content:center; cursor:pointer;" title="Close">
                            <i class="fas fa-times" style="color:#ef4444; font-size:13px;"></i>
                        </button>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:center; gap:6px; background:rgba(0,0,0,0.2); border-radius:10px; padding:10px;">
                    <div style="font-size:10px; color:var(--text-sub); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">SMS / OTP</div>
                    <div class="otp-display" style="text-align:center; font-size:20px; letter-spacing:2px; font-weight:800; color:${statusColor}; font-family:monospace; ${isSuccess ? 'cursor:pointer' : ''}" ${isSuccess ? `onclick="copyNumOtp('${session.otp}')"` : ''}>
                        ${isSuccess ? session.otp : '--:--'}
                    </div>
                    <div style="text-align:center; font-size:10px; font-weight:700; margin-top:2px;">
                        <span class="status-text" style="color:${statusColor};">${statusText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function updateActiveNumbersUI() {
    const now = Date.now();
    activeVirtualNumbers.forEach(session => {
        const card = document.querySelector(`.active-number-card[data-session-id="${session.id}"]`);
        if (!card) return;

        if (session.status === 'pending') {
            const otpDisplay = card.querySelector('.otp-display');
            const remaining = Math.max(0, Math.floor((session.expiry - now) / 1000));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timerStr = `${mins}:${secs.toString().padStart(2, '0')}`;

            if (otpDisplay) {
                otpDisplay.textContent = timerStr;
                otpDisplay.style.color = (remaining < 30) ? '#ef4444' : '#9333ea';
            }
        }
    });
}

function copyNumByValue(val) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(val).then(() => {
            window.showToast?.('Copied: ' + val);
        });
    } else {
        const textArea = document.createElement("textarea");
        textArea.value = val;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            window.showToast?.('Copied: ' + val);
        } catch (err) {
            console.error('Fallback copy failed', err);
        }
        document.body.removeChild(textArea);
    }
}

function cancelNumberBySessionId(sessionId) {
    const idx = activeVirtualNumbers.findIndex(s => s.id == sessionId);
    if (idx !== -1) {
        const session = activeVirtualNumbers[idx];
        if (session.status === 'pending') {
            userData.tokens += numSessionCost;
            updateNumBalance();
            window.showToast?.('Cancelled! Tokens refunded.');
        }

        // Notify server
        fetch('/api/number/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, userId: userData.id })
        }).catch(err => console.error('Cancel number error:', err));

        activeVirtualNumbers.splice(idx, 1);
        saveActiveNumbers();
        renderActiveNumbers();
    }
}

function generateVirtualNumber() {
    if (checkZeroBalanceAdTrigger()) return;
    const cost = 15;
    if (Math.max(0, userData.tokens || 0) < cost) { nav('earn'); return; }

    // Deduct tokens immediately
    userData.tokens -= cost;
    updateNumBalance();

    const btn = document.getElementById('numGenerateBtn');
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...'; btn.disabled = true; }

    const platformName = typeof selectedNumPlatform !== 'undefined' ? selectedNumPlatform : 'Telegram';
    const countryCode = document.getElementById('numCountrySelect').value;

    fetch('/api/number/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, platform: platformName, countryCode: countryCode, cost: cost })
    })
        .then(res => res.json())
        .then(data => {
            if (btn) { btn.innerHTML = '<i class="fas fa-phone-alt"></i> GET VIRTUAL NUMBER'; btn.disabled = false; }

            if (data.success) {
                const now = Date.now();

                if (data.notifyLimit) {
                    window.showToast?.('আপনি একসাথে সর্বোচ্চ ৭টি নাম্বার জেনারেট করতে পারবেন। পরবর্তী থেকে নতুন নাম্বার নিলে পুরনো নাম্বার ক্লোজ হয়ে যাবে।');
                }

                const newSession = {
                    id: now,
                    sessionId: data.sessionId,
                    number: data.number,
                    platform: platformName,
                    status: 'pending',
                    expiry: now + 600000,
                    otp: null
                };

                if (activeVirtualNumbers.length >= 7) {
                    const oldest = activeVirtualNumbers.pop();
                    if (oldest && oldest.status === 'pending') {
                        userData.tokens += numSessionCost;
                        updateNumBalance();

                        // Notify server about auto-cancellation
                        fetch('/api/number/cancel', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionId: oldest.sessionId, userId: userData.id })
                        });
                    }
                }

                activeVirtualNumbers.unshift(newSession);
                saveActiveNumbers();
                renderActiveNumbers();
                addNumHistory(data.number, 'pending');
                if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
                window.showToast?.(`Number generated successfully!`);

                // If balance changed, sync it
                if (data.newBalance !== undefined) {
                    userData.tokens = data.newBalance;
                    updateNumBalance();
                }
            } else {
                // Refund tokens if failed
                userData.tokens += cost;
                updateNumBalance();
                window.showToast?.(data.message || 'Generation failed. Please try again.');
            }
        })
        .catch(err => {
            if (btn) { btn.innerHTML = '<i class="fas fa-phone-alt"></i> GET VIRTUAL NUMBER'; btn.disabled = false; }
            userData.tokens += cost;
            updateNumBalance();
            window.showToast?.('Network error. Tokens refunded.');
            console.error('Generate number error:', err);
        });
}

// History section
function addNumHistory(number, status) {
    const list = document.getElementById('numHistoryList');
    if (!list) return;
    // ... (rest of the code remains the same)

    const time = new Date().toLocaleTimeString();
    const statusIcon = status === 'pending' ? '<i class="fas fa-clock" style="color:#f59e0b;"></i>' :
        status === 'success' ? '<i class="fas fa-check-circle" style="color:#22c55e;"></i>' :
            '<i class="fas fa-times-circle" style="color:#ef4444;"></i>';

    const item = `<div id="num-hist-${number.replace(/[^0-9]/g, '')}" style="background:var(--bg-card);border-radius:12px;padding:12px 14px;border:1px solid rgba(147,51,234,0.2);display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:36px;height:36px;background:rgba(147,51,234,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9333ea;font-size:16px;">📱</div>
        <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;color:var(--text-main);">${number}</div>
            <div style="font-size:10px;color:var(--text-sub);">${selectedNumPlatform} • ${time}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;font-weight:700;color:#ef4444;">-15 TC</span>
            <span style="font-size:14px;">${statusIcon}</span>
        </div>
    </div>`;

    if (list.querySelector('.fa-history')) list.innerHTML = '';
    list.insertAdjacentHTML('afterbegin', item);
}

function updateNumHistoryStatus(number, status) {
    const histItem = document.getElementById(`num-hist-${number.replace(/[^0-9]/g, '')}`);
    if (histItem) {
        const statusIcon = status === 'success'
            ? '<i class="fas fa-check-circle" style="color:#22c55e;"></i>'
            : '<i class="fas fa-times-circle" style="color:#ef4444;"></i>';
        const statusEl = histItem.querySelector('span:last-child');
        if (statusEl) statusEl.innerHTML = statusIcon;
    }
}

function pollForOTP() {
    if (!currentNumSession) { clearInterval(numOtpPollInterval); return; }

    // userId needed for validation
    const uid = (typeof userData !== 'undefined' && userData.id) ? userData.id : 'guest';

    fetch(`/api/number/otp?sessionId=${currentNumSession.id}&userId=${uid}`)
        .then(r => r.json())
        .then(data => {
            const box = document.getElementById('numOtpBox');
            if (!box) return;

            if (data.otp) {
                clearInterval(numOtpPollInterval);
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

                box.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center;">
                    <div style="font-size:32px; font-weight:900; color:#22c55e; letter-spacing:8px; font-family:monospace; margin-bottom:12px;" id="numOtpValText">${data.otp}</div>
                    <button onclick="copyNumOtp('${data.otp}')" style="background:#22c55e; color:#fff; border:none; border-radius:10px; padding:8px 20px; font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                        <i class="fas fa-copy"></i> COPY OTP
                    </button>
                    <div style="font-size:10px; color:#22c55e; font-weight:700; margin-top:10px; text-transform:uppercase;">OTP RECEIVED ✅</div>
                </div>`;
            } else if (data.text) {
                // Try manual extract if otp field missing
                const extracted = extractOtp(data.text);
                if (extracted) {
                    clearInterval(numOtpPollInterval);
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                    box.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center;">
                        <div style="font-size:32px; font-weight:900; color:#22c55e; letter-spacing:8px; font-family:monospace; margin-bottom:12px;" id="numOtpValText">${extracted}</div>
                        <button onclick="copyNumOtp('${extracted}')" style="background:#22c55e; color:#fff; border:none; border-radius:10px; padding:8px 20px; font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:8px;">
                            <i class="fas fa-copy"></i> COPY OTP
                        </button>
                        <div style="font-size:11px; color:#22c55e; font-weight:700; margin-top:10px; text-transform:uppercase;">EXTRACTED CODE ✅</div>
                    </div>`;
                }
            }
        }).catch(() => { });
}

// Helper: Extract OTP from text
function extractOtp(text) {
    if (!text) return null;
    
    // 1. Try common labels first
    const patterns = [
        /(?:code|otp|verification|pin|🔑|验证码)[:\s-]*([0-9]{4,8})/i,
        /(?:is|密码为)[:\s-]*([0-9]{4,8})/i,
        /([0-9]{4,8})(?:\s)*(?:is your|is the)/i
    ];
    
    for (const p of patterns) {
        const m = text.match(p);
        if (m && m[1]) return m[1].trim();
    }

    // 2. Fallback to any 4-8 digit number (skip if preceded by a dot like in usernames)
    const fallbackRegex = /(?:^|[^.])\b([0-9]{4,8})\b/g;
    const matches = [];
    let m;
    while ((m = fallbackRegex.exec(text)) !== null) {
        matches.push(m[1]);
    }
    if (matches.length === 0) return null;

    const blacklist = ['98052', '94043', '98034', '94040', '95014', '2022', '2023', '2024', '2025', '2026'];
    const filtered = matches.filter(m => !blacklist.includes(m));
    if (filtered.length === 0) return null;

    // Prefer 6 digits, then 4, then longest
    const sixDigit = filtered.find(m => m.length === 6);
    if (sixDigit) return sixDigit;
    
    const fourDigit = filtered.find(m => m.length === 4);
    if (fourDigit) return fourDigit;

    return filtered[0];
}

function copyNumResult() {
    // Use the existing copyNumberWithTick function
    copyNumberWithTick();
}

function selectNumCountry(countryCode) {
    console.log('Selected country:', countryCode);
    // Store selected country for API call
    window.selectedNumCountry = countryCode;
}

function toggleServiceDropdown() {
    const options = document.getElementById('serviceOptions');
    const icon = document.getElementById('serviceDropdownIcon');

    if (options.style.display === 'none' || !options.style.display) {
        options.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
    } else {
        options.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    }
}

// Update selected service display
function updateSelectedService(platformId, platformName, platformIcon, platformColor) {
    selectedNumPlatform = platformId;

    const iconEl = document.getElementById('selectedServiceIcon');
    const nameEl = document.getElementById('selectedServiceName');

    if (iconEl) {
        iconEl.innerHTML = `<i class="${platformIcon}" style="color:${platformColor}; font-size:20px;"></i>`;
    }
    if (nameEl) {
        nameEl.textContent = platformName;
    }

    // Close dropdown after selection
    toggleServiceDropdown();
}

// Make functions available globally
window.copyNumResult = copyNumResult;
window.selectNumCountry = selectNumCountry;
window.toggleServiceDropdown = toggleServiceDropdown;
window.updateSelectedService = updateSelectedService;

function refreshOTP() {
    const icon = document.querySelector('#numResultBox .fa-sync-alt');
    if (icon) { icon.classList.add('fa-spin'); setTimeout(() => icon.classList.remove('fa-spin'), 1000); }
    pollForOTP();
}



function copyNumberWithTick() {
    const el = document.getElementById('numResultValue');
    if (!el) {
        console.log('copyNumberWithTick: numResultValue element not found');
        return;
    }

    const text = el.textContent.trim();
    console.log('copyNumberWithTick: Copying text:', text);

    // Find the copy button - look for button near the numResultBox
    const numResultBox = document.getElementById('numResultBox');
    let copyBtn = null;

    if (numResultBox) {
        // Try to find button with onclick containing copyNumber
        copyBtn = numResultBox.querySelector('button[onclick*="copyNumber"]');
        // If not found, try any button inside numResultBox
        if (!copyBtn) {
            copyBtn = numResultBox.querySelector('button');
        }
    }

    // Fallback: find any button with copy icon
    if (!copyBtn) {
        copyBtn = document.querySelector('button:has(.fa-copy), button i.fa-copy');
    }

    // Final fallback: look for button next to numResultValue
    if (!copyBtn && numResultBox) {
        const buttons = numResultBox.querySelectorAll('button');
        for (let btn of buttons) {
            if (btn.innerHTML.includes('copy') || btn.innerHTML.includes('Copy')) {
                copyBtn = btn;
                break;
            }
        }
    }

    console.log('copyNumberWithTick: Found button:', copyBtn);

    navigator.clipboard.writeText(text).then(() => {
        // Show tick icon on button
        if (copyBtn) {
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
            copyBtn.style.background = '#10b981';
            copyBtn.style.color = '#fff';
            // Reset after 2 seconds
            setTimeout(() => {
                copyBtn.innerHTML = originalIcon || '<i class="fas fa-copy"></i>';
                copyBtn.style.background = '';
                copyBtn.style.color = '';
            }, 2000);
        }
        window.showToast('✅ Number copied: ' + text);
    }).catch((err) => {
        console.log('copyNumberWithTick: Clipboard error', err);
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);

        // Show tick even on fallback
        if (copyBtn) {
            const originalIcon = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
            copyBtn.style.background = '#10b981';
            copyBtn.style.color = '#fff';
            setTimeout(() => {
                copyBtn.innerHTML = originalIcon || '<i class="fas fa-copy"></i>';
                copyBtn.style.background = '';
                copyBtn.style.color = '';
            }, 2000);
        }
        window.showToast('✅ Number copied: ' + text);
    });
}

window.copyNumberWithTick = copyNumberWithTick;

function copyTextById(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
        window.showToast('✅ Copied to clipboard!');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = el.textContent;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.showToast('✅ Copied!');
    });
}

// =============================================
// EMAIL SERVICE REWAMP (TEMP & PREMIUM)
// =============================================
var mailSessions = {
    temp: null,
    premium: null
};

var previousMailSessions = {
    temp: null,
    premium: null
};

var mailRefreshInterval = null;
window._currentMailType = 'temp'; // helper to know context

function startInboxPolling(type) {
    if (mailRefreshInterval) clearInterval(mailRefreshInterval);
    refreshInbox(type); // Initial refresh
    mailRefreshInterval = setInterval(() => {
        refreshInbox(type);
    }, 5000);
}

function stopInboxPolling() {
    if (mailRefreshInterval) {
        clearInterval(mailRefreshInterval);
        mailRefreshInterval = null;
    }
}

function updateMailBalance(type) {
    if (!type) {
        // Fallback for generic calls
        type = window._currentMailType || 'temp';
    }

    // Ensure mailSessions is initialized (prevents crashes if script execution was interrupted)
    if (typeof mailSessions === 'undefined' || !mailSessions) {
        mailSessions = { temp: null, premium: null };
    }
    const tokens = Math.max(0, (typeof userData !== "undefined" && userData.tokens) ? userData.tokens : 0);
    const balEl = document.getElementById(type + "MailBalance");
    if (balEl) balEl.textContent = tokens + " TC";

    const noActive = document.getElementById(type + "MailNoActive");
    const activeState = document.getElementById(type + "MailActive");

    if (mailSessions[type]) {
        // Session active - show email address
        if (noActive) noActive.style.display = "none";
        if (activeState) activeState.style.display = "block";
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) {
            addrEl.textContent = mailSessions[type].email;
            addrEl.style.fontStyle = "normal";
            addrEl.style.opacity = "1";
        }
    } else {
        // No session yet - still show the page with placeholder text
        if (noActive) noActive.style.display = "none"; // hide noActive (we use inline placeholder instead)
        if (activeState) activeState.style.display = "block"; // ALWAYS show the mail page
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) { addrEl.textContent = "loading..."; addrEl.style.fontStyle = "italic"; addrEl.style.opacity = "0.7"; }
    }
}

function generateTempMail(type) {
    if (checkZeroBalanceAdTrigger()) return;
    if (!type) type = 'temp';

    // ✅ FIX: Premium/hotmail types must use premium email API, NOT temp mail API
    // Clear any existing session so NEW EMAIL always generates fresh
    if (type === 'premium') {
        // Clear session to force new email generation
        mailSessions.premium = null;
        window._isAutoGeneratingPremium = false;
        generatePremiumMail('gmail');
        return;
    }
    if (type === 'hot' || type === 'hotmail') {
        mailSessions.hot = null;
        generatePremiumMail('hotmail');
        return;
    }
    if (type === 'student') {
        mailSessions.student = null;
        generatePremiumMail('student');
        return;
    }

    const cost = parseInt(window.appCostConfig?.mailCost) || 10;

    // If no user login, cannot generate
    if (!userData.id || userData.id === 0) {
        window.showToast("Please login via Telegram to use this service");
        nav('home');
        return;
    }

    if (Math.max(0, userData.tokens || 0) < cost) { nav('earn'); return; }

    // Show loading state immediately
    const addrEl = document.getElementById(type + "MailAddr");
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = "italic";
        addrEl.style.opacity = "0.8";
    }

    fetch("/api/mail/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userData.id, cost, type })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                userData.tokens = (typeof data.newBalance === 'number') ? data.newBalance : (Math.max(0, userData.tokens || 0) - cost);
                renderBalances();
                if (mailSessions[type]) {
                    previousMailSessions[type] = mailSessions[type];
                }
                mailSessions[type] = data;
                // Reset style and show email
                if (addrEl) {
                    addrEl.style.fontStyle = "normal";
                    addrEl.style.opacity = "1";
                }
                updateMailBalance(type);
                startInboxPolling(type);
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            } else {
                if (addrEl) {
                    addrEl.innerHTML = '<span style="color:#f87171;">Failed. Tap to retry</span>';
                    addrEl.style.fontStyle = "normal";
                    addrEl.style.opacity = "1";
                }
                window.showToast("❌ " + (data.message || "Email generation failed. Please try again."));
            }
        })
        .catch(() => {
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">Network error. Retry</span>';
                addrEl.style.fontStyle = "normal";
                addrEl.style.opacity = "1";
            }
            window.showToast("❌ Network error. Please check your connection and try again.");
        });
}

function renewTempMail(type) {
    if (!type) type = 'temp';

    // If no user login, use demo mode
    if (!userData.id || userData.id === 0) {
        window.showToast("Please login via Telegram to use this service");
        nav('home');
        return;
    }

    // For Premium (Gmail) and Hotmail, show the custom renew modal
    if (type === 'premium' || type === 'hotmail' || type === 'hot') {
        openRenewMailModal(type);
        return;
    }

    if (!previousMailSessions[type]) {
        window.showToast(`❌ No previous ${type} session found to restore.`);
        return;
    }

    // Direct restore without confirmation or success alert for standard temp mail
    const current = mailSessions[type];
    mailSessions[type] = previousMailSessions[type];
    previousMailSessions[type] = current;

    updateMailBalance(type);
    startInboxPolling(type);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

// ─── Custom Renew Modal Logic ──────────────────────────────────────────────
let currentRenewType = '';

function openRenewMailModal(type) {
    currentRenewType = type;
    const modal = document.getElementById('renewMailModal');
    const sheet = document.getElementById('renewMailSheet');
    const costDisplay = document.getElementById('renewMailCostDisplay');
    const input = document.getElementById('renewCustomEmailInput');

    // Clear input
    if (input) input.value = '';

    // Set cost from config
    const cost = (window.serviceConfig && window.serviceConfig.renewMailCost) || 30;
    if (costDisplay) costDisplay.textContent = cost + ' TC';

    modal.style.display = 'flex';
    setTimeout(() => { sheet.style.transform = 'translateY(0)'; }, 20);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeRenewMailModal() {
    const modal = document.getElementById('renewMailModal');
    const sheet = document.getElementById('renewMailSheet');
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => { modal.style.display = 'none'; }, 380);
}

async function confirmRenewCustomEmail() {
    const email = document.getElementById('renewCustomEmailInput').value.trim();
    const btn = document.getElementById('confirmRenewBtn');

    if (!email) {
        window.showToast('Please enter an email address');
        return;
    }

    if (!email.includes('@')) {
        window.showToast('Invalid email address format');
        return;
    }

    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Renewing...';
    btn.style.pointerEvents = 'none';

    try {
        const res = await fetch('/api/mail/renew-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                email: email,
                type: currentRenewType
            })
        });
        const data = await res.json();

        if (data.success) {
            window.showToast('✅ Email renewed successfully!', 'success');

            // Set the new session properly
            const type = currentRenewType === 'premium' ? 'premium' : (currentRenewType === 'hot' ? 'hot' : 'student');
            
            // Update session with new email
            const newEmail = data.email || email; // email from input
            mailSessions[type] = {
                email: newEmail,
                id: data.sessionId || (mailSessions[type]?.id),
                type: currentPremiumTab || (type === 'premium' ? 'gmail' : type),
                sessionId: data.sessionId || (mailSessions[type]?.sessionId)
            };

            // ✅ FIX: Only replace the email address in the UI, no page reload
            const addrElId = type === 'premium' ? 'premiumMailAddr' : (type === 'hot' ? 'hotMailAddr' : 'studentMailAddr');
            const addrEl = document.getElementById(addrElId);
            if (addrEl) {
                addrEl.textContent = newEmail;
                addrEl.style.fontStyle = 'normal';
                addrEl.style.opacity = '1';
            }
            renderBalances();
            // Reload active emails to update the UI box
            loadPremiumEmailsFromAdmin();

            // Update balance and start polling
            if (data.newBalance !== undefined) {
                userData.balance_tokens = data.newBalance;
                userData.tokens = data.newBalance;
                updateMailBalance(type);
            }

            closeRenewMailModal();
            startInboxPolling(type);

            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        } else {
            window.showToast('❌ ' + (data.message || 'Renewal failed'), 'error');
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        }
    } catch (e) {
        console.error('Renew Error:', e);
        window.showToast('Network error. Please try again.');
    } finally {
        btn.innerHTML = originalHtml;
        btn.style.pointerEvents = 'auto';
    }
}

function deleteMail(type) {
    // Delete directly without confirmation
    mailSessions[type] = null;
    updateMailBalance(type);
}

function refreshInbox(type) {
    if (!type) type = window._currentMailType || 'temp';

    // If no session and no user login, just show demo inbox
    if (!mailSessions[type] && (!userData.id || userData.id === 0)) {
        console.log('refreshInbox: No session and no user login');
        const listEl = document.getElementById(type + "InboxList");
        if (listEl) {
            listEl.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i><div style="font-size:12px;">Generate email first to see inbox</div></div>`;
        }
        return;
    }

    if (!mailSessions[type]) return;

    // Deduct 1 token per inbox refresh (temp only)
    const refreshCost = 0; // Auto-poll should not charge tokens
    if (refreshCost > 0 && Math.max(0, userData.tokens || 0) < refreshCost) {
        window.showToast(`❌ Insufficient tokens!\n\nYou need ${refreshCost} TC to refresh inbox.\nYour balance: ${Math.max(0, userData.tokens || 0)} TC`);
        return;
    }

    const listEl = document.getElementById(type + "InboxList");
    const refreshIcon = document.getElementById(type + "RefreshIcon");
    if (refreshIcon) refreshIcon.classList.add("fa-spin");

    // Clear list if it's been empty for a while to show loading state
    if (listEl && listEl.children.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-spinner fa-spin" style="font-size:24px; margin-bottom:10px;"></i><div style="font-size:12px;">Checking for new messages...</div></div>`;
    }

    const sessionId = mailSessions[type].id || mailSessions[type].sessionId;

    // Choose endpoint based on type
    let endpoint = `/api/mail/inbox?sessionId=${sessionId}&userId=${userData.id}&cost=${refreshCost}`;
    // ✅ FIX: Premium, hotmail, hot and student all use the premium emails inbox (IMAP-based)
    if (type === 'premium' || type === 'hotmail' || type === 'hot' || type === 'student') {
        endpoint = `/api/premium-emails/inbox?sessionId=${sessionId}&userId=${userData.id}`;
    }

    fetch(endpoint)
        .then(r => r.json())
        .then(data => {
            if (refreshIcon) refreshIcon.classList.remove("fa-spin");
            if (refreshCost > 0 && data && typeof data.newBalance === 'number') {
                userData.tokens = data.newBalance;
                renderBalances();
                updateMailBalance(type);
            } else if (refreshCost > 0) {
                userData.tokens = Math.max(0, (userData.tokens || 0) - refreshCost);
                renderBalances();
                updateMailBalance(type);
            }
            renderInbox(data.messages || [], type, data.message || data.note);
        })
        .catch((err) => {
            if (refreshIcon) refreshIcon.classList.remove("fa-spin");
            renderInbox([], type, "Connection error: " + (err.message || "Unknown"));
        });
}

function getTimeAgo(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

function renderInbox(emails, type, serverMsg = null) {
    const listEl = document.getElementById(type + "InboxList");
    const otpListEl = document.getElementById(type + "OtpList");
    if (!listEl) return;

    // Show at most 10 messages
    if (Array.isArray(emails) && emails.length > 10) {
        emails = emails.slice(0, 10);
    }

    if (emails.length === 0) {
        const emptyMsg = serverMsg ? `<div style="color:#ef4444; font-weight:600; margin-bottom:5px; font-size:11px;">${serverMsg}</div>` : "";
        listEl.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);">
            <i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i>
            ${emptyMsg}
            <div style="font-size:12px;">Waiting for incoming emails...</div>
        </div>`;
        if (otpListEl) otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
        return;
    }

    // OTP EXTRACTION
    let otps = [];

    emails.forEach(email => {
        // If backend already successfully extracted OTP, use it directly
        if (email.otp) {
            if (!otps.some(o => o.code === email.otp)) {
                otps.push({ code: email.otp, from: email.from || email.sender || 'Unknown' });
            }
        } else {
            const combined = ((email.subject || '') + " " + (email.body || email.preview || '')).toUpperCase();
            const extracted = extractOtp(combined);
            if (extracted) {
                if (!otps.some(o => o.code === extracted)) {
                    otps.push({ code: extracted, from: email.from || email.sender || 'Unknown' });
                }
            }
        }
    });

    // Render OTP chips - Show only the LATEST OTP in a single box
    if (otpListEl) {
        if (otps.length > 0) {
            // Get the most recent OTP (first in the list from newest email)
            const latestOtp = otps[0];
            otpListEl.innerHTML = `
                <div class="otp-chip" style="padding: 10px 16px; height: 50px; display: flex; align-items: center; justify-content: space-between; background: rgba(34, 197, 94, 0.2); border: 2px solid #22c55e; border-radius: 12px; box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="font-size:10px; color:#22c55e; font-weight:900; text-transform:uppercase; background:rgba(34,197,94,0.1); padding:2px 6px; border-radius:4px;">CODE</span>
                        <span class="oc-code" style="font-size: 24px; font-weight: 900; color: #fff; letter-spacing: 2px; font-family: monospace;">${latestOtp.code}</span>
                    </div>
                    <button class="oc-copy" onclick="copyOtpFromChip(this, '${latestOtp.code}')" 
                        style="width:36px; height:36px; border-radius:10px; background:#22c55e; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(34, 197, 94, 0.3);">
                        <i class="fas fa-copy" style="color:#000; font-size:14px;"></i>
                    </button>
                </div>
            `;
        } else {
            otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px; text-align:left; font-style:italic;">Waiting for code...</div>`;
        }
    }

    // Render Inbox List
    listEl.innerHTML = emails.map(email => `
        <div class="inbox-item" onclick="openEmailMessage('${email.id}', '${type}')" style="cursor:pointer; transition:all 0.2s; border-left: 3px solid transparent;">
            <div class="ii-icon" style="background:rgba(245,158,11,0.1);"><i class="fas fa-envelope" style="color:#f59e0b;"></i></div>
            <div class="ii-body" style="flex:1; min-width:0;">
                <div class="ii-top" style="margin-bottom:2px; display:flex; justify-content:space-between; align-items:center;">
                    <div class="ii-sender" style="font-weight:800; color:#fff; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; padding-right:10px;">${email.from || email.sender || 'Unknown'}</div>
                    <div class="ii-time" style="font-size:10px; opacity:0.6; flex-shrink:0;">${email.time || getTimeAgo(email.date) || ''}</div>
                </div>
                <div class="ii-subject" style="font-size:11px; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;">${email.subject}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
                <button class="ii-quick-copy" onclick="event.stopPropagation(); quickCopyEmailContent('${email.id}', '${type}', this)" 
                    style="width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; justify-content:center; color:var(--text-sub);">
                    <i class="fas fa-copy" style="font-size:12px;"></i>
                </button>
                <i class="fas fa-chevron-right" style="font-size:10px; color:var(--text-sub); opacity:0.5;"></i>
            </div>
        </div>
    `).join("");

    window[`_emails_${type}`] = emails;
}

function quickCopyEmailContent(msgId, type, btn) {
    const emails = window[`_emails_${type}`] || [];
    const msg = emails.find(e => e.id == msgId);
    if (!msg) return;

    const content = (msg.subject || '') + " " + (msg.body || msg.preview || '');

    // Extract OTP (4-8 digits)
    const otpMatch = content.match(/\b\d{4,8}\b/);

    // Extract URL/Link
    const urlRegex = /(https?:\/\/[^\s<>'"{}|\^`\[\]]+)/i;
    const urlMatch = content.match(urlRegex);

    let textToCopy = '';
    if (otpMatch) {
        textToCopy = otpMatch[0];
    } else if (urlMatch) {
        textToCopy = urlMatch[0];
    }

    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

            // Visual feedback on button
            const icon = btn.querySelector('i');
            if (icon) {
                const originalClass = icon.className;
                icon.className = 'fas fa-check';
                btn.style.background = '#22c55e';
                setTimeout(() => {
                    icon.className = originalClass;
                    btn.style.background = '';
                }, 1000);
            }
        });
    } else {
        // Fallback or nothing found
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    }
}

function openEmailMessage(msgId, type) {
    const emails = window[`_emails_${type}`] || [];
    const msg = emails.find(e => e.id == msgId);
    if (!msg) return;

    document.getElementById("mdSubject").textContent = msg.subject;
    document.getElementById("mdFrom").textContent = msg.from || msg.sender || "Unknown";
    document.getElementById("mdTo").textContent = mailSessions[type] ? mailSessions[type].email : "...";
    document.getElementById("mdDate").textContent = msg.time || "Recent";
    document.getElementById("mdBody").innerHTML = msg.body || msg.preview;

    const content = msg.subject + " " + (msg.body || msg.preview);

    // Extract OTP (4-8 digits)
    const otpMatch = content.match(/\b\d{4,8}\b/);

    // Extract URL/Link
    const urlRegex = /(https?:\/\/[^\s<>'"{}|\^`\[\]]+)/i;
    const urlMatch = content.match(urlRegex);

    const otpContainer = document.getElementById("mdOtpContainer");
    const linkContainer = document.getElementById("mdLinkContainer");

    // Show OTP if found
    if (otpMatch) {
        otpContainer.style.display = "block";
        document.getElementById("mdOtpCode").textContent = otpMatch[0];
    } else {
        otpContainer.style.display = "none";
    }

    // Show Link if found
    if (urlMatch) {
        linkContainer.style.display = "block";
        document.getElementById("mdLinkUrl").textContent = urlMatch[0];
        document.getElementById("mdLinkUrl").href = urlMatch[0];
    } else {
        linkContainer.style.display = "none";
    }

    nav("emailMessage");
}

function copyTextSilent(txt) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
        // Silent copy - no alert
    }).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
        // Silent copy - no alert
    });
}

function copySimpleText(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = el.textContent || el.href || '';
    copyTextSilent(text);

    // Find the button that was clicked and show checkmark feedback
    const buttons = document.querySelectorAll('.oc-copy');
    buttons.forEach(btn => {
        if (btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(id)) {
            const icon = btn.querySelector('i');
            if (icon) {
                const originalClass = icon.className;
                const originalBg = btn.style.background;

                // Change to checkmark
                icon.className = 'fas fa-check';
                btn.style.background = '#22c55e';

                // Revert after 1 second
                setTimeout(() => {
                    icon.className = originalClass;
                    btn.style.background = originalBg || '';
                }, 1000);
            }
        }
    });
}

function copyRichText(id) {
    copyTextSilent(document.getElementById(id).innerText);
}

function copyEmailToClipboard(id) {
    const text = document.getElementById(id).textContent;
    copyTextSilent(text);

    // Find the button that was clicked and show checkmark feedback
    const buttons = document.querySelectorAll('button[onclick*="copyEmailToClipboard" i]');
    buttons.forEach(btn => {
        if (btn.getAttribute('onclick').includes(id)) {
            const icon = btn.querySelector('i');
            if (icon) {
                // Change to checkmark
                icon.className = 'fas fa-check';
                btn.style.background = '#22c55e';

                // Revert after 1 second
                setTimeout(() => {
                    icon.className = 'fas fa-copy';
                    btn.style.background = '#f59e0b';
                }, 1000);
            }
        }
    });
}



// Initial Render & Auto Login
renderBalances();
applyProfilePhoto(_tgUser.photo_url || ''); // Immediately show photo from Telegram
// NOTE: registerAndFetchUser is now called inside DOMContentLoaded to prevent race conditions

// Poll for balance updates (every 2s)
setInterval(registerAndFetchUser, 2000);
setInterval(syncAdminData, 2000);
setInterval(() => {
    if (currentPage === 'tasks') {
        loadUserTasks(true); // pass true to indicate silent refresh so we don't show loaders
    }
    if (currentPage === 'admin') {
        loadAdminMessages(); // silently refresh admin messages
    }
    if (currentPage === 'support' && typeof loadUserMessages === 'function') {
        loadUserMessages();
    }
}, 3000);


// ---- PURCHASE RECEIPT CLOSE ----
function closeReceiptModal() {
    const m = document.getElementById('purchaseReceiptModal');
    if (m) m.style.display = 'none';
}

function copyReceiptField(fieldId) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const text = el.textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
    }
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    window.showToast('✅ Copied!');
}

// ---- EMAIL SERVICE TOGGLES & NAVIGATION ----

// Check which email services are available and navigate accordingly
function handleEmailMenuNavigation() {
    // Get cards and show them (always show both for now)
    const emailServiceCard = document.getElementById('emailServiceCard');
    const tempMailCard = document.getElementById('tempMailCard');
    const premiumGmailCard = document.getElementById('premiumGmailCard');

    if (emailServiceCard) {
        emailServiceCard.style.display = 'block';
    }
    if (tempMailCard) {
        tempMailCard.style.display = 'block';
    }
    if (premiumGmailCard) {
        premiumGmailCard.style.display = 'block';
    }
}

// Keep old function name for backward compatibility but use new implementation
function checkEmailServicesAndNavigate() {
    handleEmailMenuNavigation();
}

// Fetch config on load (fetchEmailServiceConfig is defined below)
if (typeof fetchEmailServiceConfig === 'function') fetchEmailServiceConfig();
// Refresh config periodically
setInterval(function () { if (typeof fetchEmailServiceConfig === 'function') fetchEmailServiceConfig(); }, 5000);

// --------------------------------------------------------
// CHECKOUT PAGE FUNCTIONS
// --------------------------------------------------------
let checkoutData = {
    qty: 1,
    price: 3.00,
    paymentMethod: 'binance'
};

function updateCheckoutQty(change) {
    checkoutData.qty += change;
    if (checkoutData.qty < 1) checkoutData.qty = 1;
    if (checkoutData.qty > 10) checkoutData.qty = 10;

    const qtyEl = document.getElementById('checkoutQty');
    const totalEl = document.getElementById('checkoutTotal');

    if (qtyEl) qtyEl.textContent = checkoutData.qty;
    if (totalEl) totalEl.textContent = '$' + (checkoutData.qty * checkoutData.price).toFixed(2);
}

function selectCheckoutPM(method) {
    checkoutData.paymentMethod = method;

    // Update UI
    const binanceCard = document.getElementById('pm_binance');
    const faucetCard = document.getElementById('pm_faucet');
    const checkBinance = document.getElementById('check_binance');
    const checkFaucet = document.getElementById('check_faucet');

    if (method === 'binance') {
        if (binanceCard) {
            binanceCard.style.border = '2px solid #FCD535';
            binanceCard.style.background = 'var(--bg-card)';
        }
        if (faucetCard) {
            faucetCard.style.border = '1px solid var(--border-color)';
            faucetCard.style.background = 'var(--bg-card)';
        }
        if (checkBinance) {
            checkBinance.style.background = '#FCD535';
            checkBinance.style.color = '#000';
            checkBinance.innerHTML = '<i class="fas fa-check"></i>';
        }
        if (checkFaucet) {
            checkFaucet.style.background = 'transparent';
            checkFaucet.style.border = '2px solid var(--border-color)';
            checkFaucet.style.color = 'transparent';
            checkFaucet.innerHTML = '';
        }
    } else {
        if (faucetCard) {
            faucetCard.style.border = '2px solid #3b82f6';
            faucetCard.style.background = 'var(--bg-card)';
        }
        if (binanceCard) {
            binanceCard.style.border = '1px solid var(--border-color)';
            binanceCard.style.background = 'var(--bg-card)';
        }
        if (checkFaucet) {
            checkFaucet.style.background = '#3b82f6';
            checkFaucet.style.border = 'none';
            checkFaucet.style.color = '#fff';
            checkFaucet.innerHTML = '<i class="fas fa-check"></i>';
        }
        if (checkBinance) {
            checkBinance.style.background = 'transparent';
            checkBinance.style.color = 'transparent';
            checkBinance.innerHTML = '';
        }
    }
}

function submitCheckoutPayment() {
    const txnId = document.getElementById('checkoutTxnId')?.value;
    if (!txnId || txnId.trim() === '') {
        window.showToast('Please enter your Transaction ID to confirm payment.');
        return;
    }

    window.showToast('✅ Payment submitted!\n\nWe will verify your transaction and deliver your order shortly.');
    nav('home');
}

// Export checkout functions
window.updateCheckoutQty = updateCheckoutQty;
window.selectCheckoutPM = selectCheckoutPM;
window.submitCheckoutPayment = submitCheckoutPayment;

// Export Email Functions
function openTempMailDirect() {
    if (!checkFeatureOrComingSoon('tempMail', 'Temp Mail')) return;
    nav('mailService');
    window._currentMailType = 'temp';
    updateMailBalance('temp');

    // Check if email needs auto-generation (first time or 24hr expired)
    const session = mailSessions.temp;
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (!session || !session.email) {
        // First time - no email exists, auto-generate
        console.log('First time user - auto-generating email');
        setTimeout(() => {
            autoGenerateTempMail();
        }, 500);
    } else if (session.createdAt && (now - session.createdAt > TWENTY_FOUR_HOURS)) {
        // 24 hours passed - auto-generate new email
        console.log('24 hours passed - auto-generating new email');
        mailSessions.temp = null; // Clear old session
        setTimeout(() => {
            autoGenerateTempMail();
        }, 500);
    }
    // Otherwise: Email exists and is fresh, user keeps current email
}

function autoGenerateTempMail() {
    if (checkZeroBalanceAdTrigger()) return;
    const type = 'temp';
    const cost = (parseInt(window.appCostConfig?.mailCost) || 10);

    // Check user login
    if (!userData.id || userData.id === 0) {
        console.log('AutoGenerate: No user login');
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Please login first</span>';
        }
        return;
    }

    // Check tokens
    if (Math.max(0, userData.tokens || 0) < cost) {
        console.log('AutoGenerate: Insufficient tokens');
        nav('earn');
        return;
    }

    const addrEl = document.getElementById(type + "MailAddr");
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = 'italic';
        addrEl.style.opacity = '0.7';
    }

    console.log('AutoGenerate: Fetching live email for user', userData.id);

    fetch("/api/mail/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userData.id, cost, type })
    })
        .then(r => r.json())
        .then(data => {
            console.log('AutoGenerate: Response', data);
            if (data.success && data.email) {
                // Success - real email from provider
                userData.tokens = (typeof data.newBalance === 'number') ? data.newBalance : Math.max(0, (userData.tokens || 0) - cost);
                renderBalances();
                mailSessions[type] = { ...data, createdAt: Date.now() };
                // Show email
                if (addrEl) {
                    addrEl.textContent = data.email;
                    addrEl.style.fontStyle = "normal";
                    addrEl.style.opacity = "1";
                }
                updateMailBalance(type);
                refreshInbox(type);
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            } else {
                // Failed - show error
                console.log('AutoGenerate: Failed -', data.message);
                if (addrEl) {
                    addrEl.innerHTML = '<span style="color:#f87171;">Failed: ' + (data.message || 'Try again') + '</span>';
                    addrEl.style.fontStyle = "normal";
                }
            }
        })
        .catch((err) => {
            console.log('AutoGenerate: Network error', err);
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">Network error. Tap NEW GMAIL</span>';
                addrEl.style.fontStyle = "normal";
            }
        });
}

function generateDemoTempMail(type, cost) {
    console.log('DemoMail: Generating demo email for', type);
    const domains = type === "temp" ? ["tempmail.dev", "mailnull.com", "inboxkitten.com"] : ["premium-inbox.com", "private-mail.net"];
    const email = "user" + Math.floor(Math.random() * 99999) + "@" + domains[Math.floor(Math.random() * domains.length)];
    console.log('DemoMail: Generated email', email);
    mailSessions[type] = { email, id: "demo_" + Date.now(), type, sessionId: "demo_" + Date.now() };
    userData.tokens = Math.max(0, (userData.tokens || 0) - (parseInt(cost) || 0));
    renderBalances();
    // Clear loading state and show email
    const addrEl = document.getElementById(type + "MailAddr");
    console.log('DemoMail: addrEl found?', !!addrEl);
    if (addrEl) {
        addrEl.innerHTML = email; // Use innerHTML to ensure display
        addrEl.style.fontStyle = "normal";
        addrEl.style.opacity = "1";
        console.log('DemoMail: Email set to element');
    }
    updateMailBalance(type);
    refreshInbox(type);
}

var assignedPremiumEmail = null;
var currentPremiumTab = 'gmail';

function switchPremiumTab(tabStr) {
    // Handle both Mail and Subscriptions tabs
    const mailTabs = ['gmail', 'hotmail', 'student'];
    const subTabs = ['vpn', 'account'];

    if (mailTabs.includes(tabStr)) {
        currentPremiumTab = tabStr;
        mailTabs.forEach(t => {
            const btn = document.getElementById('tab-' + t);
            if (!btn) return;
            if (t === tabStr) {
                btn.style.background = 'rgba(245,158,11,0.2)';
                btn.style.color = '#f59e0b';
                btn.classList.add('active');
            } else {
                btn.style.background = 'var(--bg-card)';
                btn.style.color = 'var(--text-sub)';
                btn.classList.remove('active');
            }
        });

        // Update display info
        const typeEl = document.getElementById('premiumMailType');
        if (typeEl) typeEl.textContent = tabStr.charAt(0).toUpperCase() + tabStr.slice(1);

        const costBadge = document.getElementById('premiumMailCostBadge');
        if (costBadge && window.appCostConfig) {
            const cost = tabStr === 'gmail' ? window.appCostConfig.gmailCost :
                tabStr === 'hotmail' ? window.appCostConfig.hotmailCost :
                    window.appCostConfig.studentEmailCost;
            costBadge.textContent = `${cost || 50} TC / ${tabStr.charAt(0).toUpperCase() + tabStr.slice(1)}`;
        }

        // Trigger loading or refresh
        loadPremiumEmailsFromAdmin();
    } else {
        // Original VPN/Account switch logic
        subTabs.forEach(t => {
            const btn = document.getElementById('ptab-' + t);
            const content = document.getElementById('premiumTab-' + t);
            if (btn && content) {
                if (t === tabStr) {
                    btn.style.background = 'var(--accent-color)';
                    btn.style.color = '#000';
                    content.style.display = 'block';
                } else {
                    btn.style.background = 'transparent';
                    btn.style.color = 'var(--text-sub)';
                    content.style.display = 'none';
                }
            }
        });
    }
}
window.switchPremiumTab = switchPremiumTab;

async function loadPremiumEmailsFromAdmin() {
    const addrEl = document.getElementById('premiumMailAddr');
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>searching...';
    }

    // Try to fetch active emails from server if local is not set
    try {
        const uid = (window.userData && window.userData.id) ? window.userData.id : 0;
        if (uid && (!mailSessions || !mailSessions.premium || mailSessions.premium.type !== currentPremiumTab)) {
            const res = await fetch('/api/mail/active?userId=' + uid);
            const data = await res.json();
            if (data.success && data.activeSessions) {
                // Determine internal type mapping
                let internalCheckType = currentPremiumTab; // 'gmail', 'hotmail', 'student'
                if (internalCheckType === 'gmail') internalCheckType = 'gmail';
                // Find matching active session block
                let foundSession = data.activeSessions[internalCheckType] || data.activeSessions['admin_pool_' + internalCheckType];
                if (!foundSession && internalCheckType === 'gmail') foundSession = data.activeSessions['premium'];
                
                if (foundSession) {
                    if (!mailSessions) { mailSessions = { temp: null, premium: null }; }
                    mailSessions.premium = {
                        id: foundSession.id,
                        email: foundSession.email,
                        type: currentPremiumTab,
                        sessionId: foundSession.sessionId
                    };
                }
            }
        }
    } catch (e) {
        console.warn('Could not fetch active emails:', e);
    }

    // Check if we have an existing session for this type
    if (mailSessions && mailSessions.premium && mailSessions.premium.type === currentPremiumTab) {
        assignedPremiumEmail = mailSessions.premium;
        // Extract email string if it's an object
        const emailStr = (typeof assignedPremiumEmail.email === 'object' && assignedPremiumEmail.email !== null)
            ? (assignedPremiumEmail.email.email || '')
            : (assignedPremiumEmail.email || '');
        if (addrEl) {
            if (emailStr) {
                addrEl.textContent = emailStr;
                addrEl.style.fontStyle = "normal";
                addrEl.style.opacity = "1";
            } else {
                addrEl.innerHTML = '<span style="color:#94a3b8;">No Active Email</span>';
            }
        }
        loadPremiumEmailMessages(assignedPremiumEmail.id);
        return;
    }

    // If no session, wait a brief moment and auto-generate
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:8px;"></i>generating...';
    }
    
    // Prevent overlapping auto-generations
    if (window._isAutoGeneratingPremium) return;
    window._isAutoGeneratingPremium = true;

    setTimeout(async () => {
        try {
            await autoGeneratePremiumMailWrapper();
        } finally {
            window._isAutoGeneratingPremium = false;
        }
    }, 500);
}

async function generatePremiumMail(provider) {
    let addrElId = 'premiumMailAddr';
    if (provider === 'hotmail') addrElId = 'hotMailAddr';
    else if (provider === 'student') addrElId = 'studentMailAddr';

    const addrEl = document.getElementById(addrElId);
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = "italic";
        addrEl.style.opacity = "0.8";
    }

    try {
        const res = await fetch('/api/premium-emails/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                provider: provider || 'gmail'
            })
        });
        const data = await res.json();
        if (data.success) {
            // data.email can be an object {email, id} or a string — extract string
            const emailStr = (typeof data.email === 'object' && data.email !== null)
                ? (data.email.email || JSON.stringify(data.email))
                : (data.email || '');

            let assignedPremiumEmail = {
                id: data.sessionId,
                email: emailStr,
                type: provider || 'gmail'
            };
            
            // Map the provider to the correct frontend type string usually used in mailSessions
            let sessionType = 'premium';
            if (provider === 'hotmail') sessionType = 'hot';
            if (provider === 'student') sessionType = 'student';
            
            mailSessions[sessionType] = assignedPremiumEmail;

            if (addrEl) {
                if (emailStr) {
                    addrEl.textContent = emailStr;
                } else {
                    addrEl.innerHTML = '<span style="color:#f87171;">Email generation failed.</span>';
                }
                addrEl.style.fontStyle = "normal";
                addrEl.style.opacity = "1";
            }
            if (typeof data.newBalance === 'number') {
                userData.tokens = data.newBalance;
                renderBalances();
            }

            refreshInbox(sessionType);
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            window.showToast('✅ ' + (provider === 'hotmail' ? 'Hotmail' : (provider === 'student' ? 'Student Email' : 'Gmail')) + ' generated successfully!');
        } else {
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">' + (data.message || 'No email available.') + '</span>';
                addrEl.style.fontStyle = "normal";
                addrEl.style.opacity = "1";
            }
            window.showToast('❌ ' + (data.message || 'No email in pool. Admin needs to add more.'));
        }
    } catch (e) {
        console.error('Error generating premium mail:', e);
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Network error. Retry later</span>';
            addrEl.style.fontStyle = "normal";
            addrEl.style.opacity = "1";
        }
        window.showToast('❌ Network error. Please try again.');
    }
}


async function loadPremiumEmailMessages(sessionId) {
    const listEl = document.getElementById('premiumInboxList');
    if (!listEl) return;

    listEl.innerHTML = '<div style="padding:20px; text-align:center;"><i class="fas fa-spinner fa-spin"></i> Loading messages...</div>';

    try {
        const uid = (window.userData && window.userData.id) ? window.userData.id : (userData && userData.id ? userData.id : 0);
        const res = await fetch(`/api/premium-emails/inbox?sessionId=${sessionId}&userId=${uid}`);
        const data = await res.json();

        if (data.success && data.messages) {
            if (data.messages.length === 0) {
                listEl.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-sub); font-size:13px;">No messages received matching your filters yet.</div>';
            } else {
                listEl.innerHTML = '';
                data.messages.forEach(msg => {
                    const item = document.createElement('div');
                    item.className = 'inbox-item';
                    item.style.padding = '15px';
                    item.style.borderBottom = '1px solid var(--border-color)';
                    item.onclick = () => openPremiumEmailMessage(msg);
                    item.innerHTML = `
                        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                            <span style="font-weight:700; color:var(--text-main); font-size:14px;">${msg.from || 'Unknown'}</span>
                            <span style="font-size:11px; color:var(--text-sub);">${msg.date || ''}</span>
                        </div>
                        <div style="font-weight:600; font-size:13px; color:var(--text-main); margin-bottom:4px;">${msg.subject || '(No Subject)'}</div>
                        <div style="font-size:12px; color:var(--text-sub); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${msg.snippet || msg.body?.substring(0, 50) || ''}</div>
                    `;
                    listEl.appendChild(item);
                });
            }
        } else {
            listEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">Error loading inbox.</div>';
        }
    } catch (e) {
        listEl.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">Connection error.</div>';
    }
}

function openPremiumEmailMessage(msg) {
    const modal = document.getElementById('emailMessageModal');
    if (!modal) return;

    document.getElementById('msgFrom').textContent = msg.from;
    document.getElementById('msgSubject').textContent = msg.subject;
    document.getElementById('msgDate').textContent = msg.date;
    document.getElementById('msgBody').innerHTML = msg.html || msg.body;

    modal.style.display = 'block';
}

function selectPremiumEmail(id) {
    // Utility for selection if multiple provided
}

function openPremiumMailDirect() {
    if (!checkFeatureOrComingSoon('premiumMail', 'Premium Mail')) return;
    nav('premiumMail');
    window._currentMailType = 'premium';
    updateMailBalance('premium');

    // Make sure we select 'gmail' (the default) if no currentPremiumTab is set
    if (!currentPremiumTab) currentPremiumTab = 'gmail';
    
    // We delegate completely to loadPremiumEmailsFromAdmin which will fetch active 
    // sessions from the server, and only generate an email if none is found.
    loadPremiumEmailsFromAdmin();
}

async function autoGeneratePremiumMailWrapper() {
    if (checkZeroBalanceAdTrigger()) return;
    
    // Check if we already have an active session for this specific tab before generating
    if (mailSessions && mailSessions.premium && mailSessions.premium.type === (currentPremiumTab || 'gmail')) {
        return;
    }

    const cost = parseInt(window.appCostConfig?.premiumMailCost) || 50;

    if (!userData.id || userData.id === 0) {
        const addrEl = document.getElementById('premiumMailAddr');
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Please login first</span>';
        }
        return;
    }

    // Balance check removed to allow unlimited usage as requested

    const addrEl = document.getElementById('premiumMailAddr');
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = 'italic';
        addrEl.style.opacity = '0.7';
    }

    await generatePremiumMail(currentPremiumTab || 'gmail', cost);
}

function openHotmailDirect() {
    if (!checkFeatureOrComingSoon('hotMail', 'Hot Mail')) return;
    nav('hotMail');
    window._currentMailType = 'hot';
    updateMailBalance('hot');

    // Check if email needs auto-generation
    const session = mailSessions.hot;
    if (!session || !session.email) {
        setTimeout(() => {
            autoGenerateHotMail();
        }, 500);
    } else {
        const addrEl = document.getElementById('hotMailAddr');
        if (addrEl) addrEl.textContent = session.email;
        refreshInbox('hot');
    }
}

function autoGenerateHotMail() {
    if (checkZeroBalanceAdTrigger()) return;
    const type = 'hot';
    const cost = parseInt(window.appCostConfig?.hotMailCost) || 15;

    if (!userData.id || userData.id === 0) {
        const addrEl = document.getElementById(type + 'MailAddr');
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Please login first</span>';
        }
        return;
    }

    if (Math.max(0, userData.tokens || 0) < cost) {
        nav('earn');
        return;
    }

    const addrEl = document.getElementById(type + 'MailAddr');
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = 'italic';
        addrEl.style.opacity = '0.7';
    }

    fetch('/api/mail/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, cost, type })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success && data.email) {
                userData.tokens = (typeof data.newBalance === 'number') ? data.newBalance : Math.max(0, (userData.tokens || 0) - cost);
                renderBalances();
                mailSessions[type] = { ...data, createdAt: Date.now() };
                if (addrEl) {
                    addrEl.textContent = data.email;
                    addrEl.style.fontStyle = 'normal';
                    addrEl.style.opacity = '1';
                }
                updateMailBalance(type);
                refreshInbox(type);
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            } else {
                if (addrEl) {
                    addrEl.innerHTML = '<span style="color:#f87171;">Failed: ' + (data.message || 'Try again') + '</span>';
                    addrEl.style.fontStyle = 'normal';
                }
            }
        })
        .catch(() => {
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">Network error. Tap NEW EMAIL</span>';
                addrEl.style.fontStyle = 'normal';
            }
        });
}

function openStudentEmailDirect() {
    if (!checkFeatureOrComingSoon('studentMail', 'Student Mail')) return;
    nav('studentMail');
    window._currentMailType = 'student';
    updateMailBalance('student');

    // Check if email needs auto-generation
    const session = mailSessions.student;
    if (!session || !session.email) {
        setTimeout(() => {
            autoGenerateStudentMail();
        }, 500);
    } else {
        const addrEl = document.getElementById('studentMailAddr');
        if (addrEl) addrEl.textContent = session.email;
        refreshInbox('student');
    }
}

function autoGenerateStudentMail() {
    if (checkZeroBalanceAdTrigger()) return;
    const type = 'student';
    const cost = parseInt(window.appCostConfig?.studentMailCost) || 20;

    if (!userData.id || userData.id === 0) {
        const addrEl = document.getElementById(type + 'MailAddr');
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Please login first</span>';
        }
        return;
    }

    if (Math.max(0, userData.tokens || 0) < cost) {
        nav('earn');
        return;
    }

    const addrEl = document.getElementById(type + 'MailAddr');
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = 'italic';
        addrEl.style.opacity = '0.7';
    }

    fetch('/api/mail/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, cost, type })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success && data.email) {
                userData.tokens = (typeof data.newBalance === 'number') ? data.newBalance : Math.max(0, (userData.tokens || 0) - cost);
                renderBalances();
                mailSessions[type] = { ...data, createdAt: Date.now() };
                if (addrEl) {
                    addrEl.textContent = data.email;
                    addrEl.style.fontStyle = 'normal';
                    addrEl.style.opacity = '1';
                }
                updateMailBalance(type);
                refreshInbox(type);
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            } else {
                if (addrEl) {
                    addrEl.innerHTML = '<span style="color:#f87171;">Failed: ' + (data.message || 'Try again') + '</span>';
                    addrEl.style.fontStyle = 'normal';
                }
            }
        })
        .catch(() => {
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">Network error. Tap NEW EMAIL</span>';
                addrEl.style.fontStyle = 'normal';
            }
        });
}

function refreshPremiumInbox() {
    refreshInbox('premium');
}

// Export new functions
window.loadPremiumEmailsFromAdmin = loadPremiumEmailsFromAdmin;
window.selectPremiumEmail = selectPremiumEmail;
window.loadPremiumEmailMessages = loadPremiumEmailMessages;
window.refreshPremiumInbox = refreshPremiumInbox;
window.openPremiumEmailMessage = openPremiumEmailMessage;
window.generatePremiumMail = generatePremiumMail;

function autoGeneratePremiumMail() {
    // Replaced by loadPremiumEmailsFromAdmin
    loadPremiumEmailsFromAdmin();
}

function generateDemoPremiumMail(type, cost) {
    const domains = ["premium-inbox.com", "private-mail.net"];
    const email = "user" + Math.floor(Math.random() * 99999) + "@" + domains[Math.floor(Math.random() * domains.length)];
    mailSessions[type] = { email, id: "demo_" + Date.now(), type, sessionId: "demo_" + Date.now() };
    userData.tokens = Math.max(0, (userData.tokens || 0) - cost);
    renderBalances();
    updateMailBalance(type);
    refreshInbox(type);
}

function changeMailEmail(type) {
    // Clear current email and generate new one
    mailSessions[type] = null;
    generateTempMail(type);
}

function cancelMail(type) {
    // Cancel/close mail service
    mailSessions[type] = null;
    updateMailBalance(type);
    nav('home');
}

function copyMailEmail(type) {
    const email = mailSessions[type]?.email;
    if (email) {
        copyText(email);
        window.showToast('✅ Email copied: ' + email);
    } else {
        window.showToast('❌ No email to copy');
    }
}

function copyMailOtp(otp) {
    if (otp) {
        copyText(otp);
        window.showToast('✅ OTP copied: ' + otp);
    } else {
        window.showToast('❌ No OTP to copy');
    }
}

window.openTempMailDirect = openTempMailDirect;
window.generateTempMail = generateTempMail;
window.renewTempMail = renewTempMail;
window.autoGenerateTempMail = autoGenerateTempMail;
window.generateDemoTempMail = generateDemoTempMail;
window.openPremiumMailDirect = openPremiumMailDirect;
window.openPremiumGmailDirect = openPremiumGmailDirect;
window.autoGeneratePremiumMail = autoGeneratePremiumMail;
window.autoGeneratePremiumMailWrapper = autoGeneratePremiumMailWrapper;
window.generateDemoPremiumMail = generateDemoPremiumMail;
window.openHotmailDirect = openHotmailDirect;
window.autoGenerateHotMail = autoGenerateHotMail;
window.openStudentEmailDirect = openStudentEmailDirect;
window.autoGenerateStudentMail = autoGenerateStudentMail;
window.changeMailEmail = changeMailEmail;
window.cancelMail = cancelMail;
window.copyMailEmail = copyMailEmail;
window.refreshInbox = refreshInbox;
window.copyMailOtp = copyMailOtp;
window.updateMailBalance = updateMailBalance;

// REQUIRED CHANNELS/GROUPS CONFIG
let REQUIRED_JOINS = {
    channel: {
        id: '-1002188442004', // @AutosVerifych
        username: 'AutosVerifych',
        name: '📢 AutosVerify Channel'
    },
    group: {
        id: '-1002088203586', // @AutosVerify
        username: 'AutosVerify',
        name: '💬 AutosVerify Group'
    }
};

// Check if user joined required channels/groups
async function checkRequiredJoins() {
    if (!userData.id || userData.id === 0) {
        // Demo mode - skip check
        return { canProceed: true };
    }

    try {
        const response = await fetch('/api/check-required-joins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                channelId: REQUIRED_JOINS.channel.id,
                groupId: REQUIRED_JOINS.group.id
            })
        });

        const data = await response.json();
        return data;
    } catch (err) {
        console.error('Join check error:', err);
        // On error, allow proceed (fail open)
        return { canProceed: true };
    }
}

// Show join required modal
function showJoinRequiredModal(missing) {
    // SECURITY FIX: Do not show if feature is disabled
    if (featureFlags && featureFlags.joinRequired === false) return;

    // Create modal if not exists
    let modal = document.getElementById('joinRequiredModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'joinRequiredModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.95);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;
        document.body.appendChild(modal);
    }

    const items = [
        { ...REQUIRED_JOINS.channel, joined: missing.channelJoined },
        { ...REQUIRED_JOINS.group, joined: missing.groupJoined }
    ];

    modal.innerHTML = `
        <div style="
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            border: 1px solid rgba(249,115,22,0.5);
            border-radius: 20px;
            padding: 30px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        ">
            <div style="font-size: 48px; margin-bottom: 15px;">🔒</div>
            <h2 style="color: #f97316; margin-bottom: 10px; font-size: 22px;">Join Required</h2>
            <p style="color: #aaa; margin-bottom: 25px; font-size: 14px;">
                You must join our channel and group to use the web panel.
            </p>
            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                ${items.map(item => {
                    const isJoined = item.joined;
                    const style = isJoined ? 
                        'background: #333; color: #888; text-decoration: line-through; pointer-events: none; opacity: 0.6;' : 
                        'background: linear-gradient(135deg, #f59e0b, #d97706); color: #000;';
                    
                    return `
                        <a href="https://t.me/${item.username.replace('@', '')}" target="_blank" style="
                            ${style}
                            padding: 10px 15px;
                            border-radius: 10px;
                            text-decoration: ${isJoined ? 'line-through' : 'none'};
                            font-weight: 700;
                            font-size: 14px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            gap: 8px;
                            transition: 0.2s;
                        ">
                            <span>Join ${item.name}</span>
                            ${isJoined ? '<i class="fas fa-check-circle" style="font-size: 12px; color: #22c55e;"></i>' : '<i class="fas fa-external-link-alt" style="font-size: 12px;"></i>'}
                        </a>
                    `;
                }).join('')}
            </div>
            <button onclick="verifyJoinsAndProceed()" style="
                background: linear-gradient(135deg, #22c55e, #16a34a);
                color: #fff;
                border: none;
                padding: 12px 25px;
                border-radius: 10px;
                font-weight: 700;
                font-size: 15px;
                cursor: pointer;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: 0.2s;
            ">
                <span>✓ I've Joined</span>
            </button>
            <p style="color: #666; margin-top: 15px; font-size: 12px;">
                Click "I've Joined" after joining both
            </p>
        </div>
    `;

    modal.style.display = 'flex';
}

// Verify joins and proceed
async function verifyJoinsAndProceed() {
    const btn = document.querySelector('#joinRequiredModal button');
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span> Checking...';
    btn.disabled = true;

    const result = await checkRequiredJoins();

    if (result.canProceed) {
        const jrm = document.getElementById('joinRequiredModal');
        if (jrm) jrm.style.display = 'none';
        // Show verification toast if user was just verified
        if (result.verified && !result.adminVerified) {
            showToast('✅ You are now verified! Full access granted.');
        }
        // Continue with normal initialization
        continueInitialization();
    } else {
        btn.innerHTML = '<span>✗ Not Joined Yet</span>';
        btn.style.background = '#ef4444';
        
        // Brief delay then update the modal UI to reflect which ones are now joined
        setTimeout(() => {
            showJoinRequiredModal(result);
        }, 1500);
    }
}

// Continue with normal initialization after join check
async function continueInitialization() {
    showPage('home');
    applyProfilePhoto(userData.photo_url || _tgUser.photo_url || '');
    renderBalances();

    // Load all app config data immediately on startup
    await Promise.allSettled([
        loadFeatureFlags(),
        loadAppCostConfig(),
        syncAdminData()
    ]);

    // Apply feature flags immediately after loading
    applyFeatureFlagsToHome();

    // Load broadcasts and email service config
    loadBroadcast();
    fetchEmailServiceConfig();

    // Apply saved theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // Initialize virtual numbers
    if (typeof initActiveVirtualNumbers === 'function') initActiveVirtualNumbers();

    // Force a fresh user sync to ensure balances are up-to-date
    smartSync(true);

    // Check user verification status and show welcome toast
    try {
        const joinCheck = await checkRequiredJoins();
        if (joinCheck.adminVerified) {
            showToast('👑 Welcome Admin! You have full verified access.');
        } else if (joinCheck.verified) {
            showToast('✅ Welcome! You are verified and have full access.');
        }
    } catch (e) {
        // Silently ignore errors
    }
}


document.addEventListener('DOMContentLoaded', async function () {
    try {
        // Re-initialize Telegram WebApp data in case SDK loaded after initial parse
        if (window.Telegram && window.Telegram.WebApp) {
            tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            const freshUser = tg.initDataUnsafe?.user || {};
            if (freshUser.id) {
                // Update global user data with fresh Telegram data
                userData.id = freshUser.id;
                userData.username = freshUser.first_name || freshUser.username || 'User';
                userData.firstName = freshUser.first_name || '';
                userData.lastName = freshUser.last_name || '';
                userData.photo_url = freshUser.photo_url || '';
                // Also update the module-level references
                Object.assign(_tgUser, freshUser);
            }
        }

        // Fetch user data
        if (userData.id && userData.id !== 0) {
            try {
                console.log('[INIT] Fetching user data...');
                await registerAndFetchUser();
                console.log('[INIT] User data fetched, adminVerified:', userData.adminVerified);
                // Check for pending gifts after user data is loaded
                setTimeout(checkPendingGifts, 3000);
            } catch (e) {
                console.error('[INIT] Failed to fetch user data:', e);
            }
        }

        // FETCH FEATURE FLAGS & CHECK JOIN REQUIREMENT
        const featuresRes = await fetch('/api/features').catch(() => ({ json: () => ({ success: false }) }));
        const featuresData = await featuresRes.json();
        const joinRequired = featuresData.success ? featuresData.features.joinRequired : false;

        // Update REQUIRED_JOINS with dynamic data from server
        if (featuresData.success && featuresData.requiredJoins) {
            REQUIRED_JOINS = featuresData.requiredJoins;
            console.log('[INIT] Required Joins updated from server:', REQUIRED_JOINS);
        }

        if (joinRequired && !userData.adminVerified) {
            console.log('[INIT] Join check enabled - verifying membership...');
            const joinCheck = await checkRequiredJoins();
            if (!joinCheck.canProceed) {
                showJoinRequiredModal(joinCheck);
                return;
            }
            console.log('[INIT] Membership verified - proceeding to app');
        } else {
            console.log('[INIT] Join check skipped (disabled or admin) - proceeding to app');
        }

        continueInitialization();
    } catch (error) {
        console.error('[INIT] Critical initialization error:', error);
        // Show error message instead of blank screen
        document.body.innerHTML = `
            <div style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 20px;
                text-align: center;
                color: #fff;
                font-family: system-ui, -apple-system, sans-serif;
            ">
                <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
                <h2 style="color: #f97316; margin-bottom: 10px;">Something went wrong</h2>
                <p style="color: #aaa; margin-bottom: 20px; max-width: 300px;">
                    The app failed to load. Please try refreshing or check your connection.
                </p>
                <button onclick="location.reload()" style="
                    background: linear-gradient(135deg, #f59e0b, #d97706);
                    color: #000;
                    border: none;
                    padding: 14px 30px;
                    border-radius: 12px;
                    font-weight: 600;
                    font-size: 16px;
                    cursor: pointer;
                ">🔄 Reload App</button>
                <p style="color: #666; margin-top: 15px; font-size: 12px;">
                    Error: ${error.message || 'Unknown error'}
                </p>
            </div>
        `;
    }
});

window.verifyJoinsAndProceed = verifyJoinsAndProceed;

function fetchEmailServiceConfig() {
    fetch('/api/admin/email-services')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                emailServiceConfig.emailServiceEnabled = data.emailServiceEnabled !== false;
                emailServiceConfig.tempMailEnabled = data.tempMailEnabled !== false;
            }
        })
        .catch(() => { });
}



function toggleAccountsView() {
    const gv = document.getElementById('accountsGridView');
    const lv = document.getElementById('accountsListView');
    if (gv.style.display === 'none') {
        gv.style.display = 'grid';
        lv.style.display = 'none';
    } else {
        gv.style.display = 'none';
        lv.style.display = 'flex';
    }
}

// Alias for legacy calls
function updateBalanceDisplay() { renderBalances(); }

// ==========================================
// MISSING WINDOW EXPORTS (for onclick handlers)
// ==========================================
window.generateService = generateService;
window.generateVirtualNumber = generateVirtualNumber;
window.selectNumPlatform = selectNumPlatform;
window.loadNumPlatforms = loadNumPlatforms;
window.refreshOTP = refreshOTP;
window.copyNumByValue = copyNumByValue;
window.cancelNumberBySessionId = cancelNumberBySessionId;
window.cancelNumber = cancelNumberBySessionId;
window.openService = openService;
window.copyText = copyText;
window.copyTextById = copyTextById;
window.copySimpleText = copySimpleText;
window.copyRichText = copyRichText;
window.copyToClipboard = copyToClipboard;
window.renderLeaderboard = renderLeaderboard;
window.closeReceiptModal = closeReceiptModal;
window.copyReceiptField = copyReceiptField;
window.openEmailMessage = openEmailMessage;
window.quickCopyEmailContent = quickCopyEmailContent;
window.deleteMail = deleteMail;
window.changeMailEmail = changeMailEmail;
window.renderAccounts = renderAccounts;
window.buyPremiumAccount = buyPremiumAccount;

function buyAccount(type, price, id) {
    buyPremiumAccount(id, type, price);
}
window.buyAccount = buyAccount;
window.toggleAccountsView = toggleAccountsView;
window.updateBalanceDisplay = updateBalanceDisplay;
window.renderCards = renderCards;
window.renderVPN = renderVPN;
window.renderServicesList = renderServicesList;
window.renderShopItems = renderShopItems;
window.copyUserId = copyUserId;

// Copy OTP function
function copyNumOtp(otp) {
    if (!otp) return;
    copyText(otp);
    window.showToast('✅ OTP copied!');
}

window.copyNumOtp = copyNumOtp;
window.extractOtp = extractOtp;

// =============================================
// LIVE PAGES — Routing & Titles
// =============================================
PAGE_TITLES['live2fa']        = '2FA LIVE';
PAGE_TITLES['liveInstagram']  = 'INSTAGRAM LIVE';
PAGE_TITLES['liveFacebook']   = 'FACEBOOK LIVE';
PAGE_TITLES['liveTiktok']     = 'TIKTOK LIVE';
PAGE_TITLES['liveTwitter']    = 'TWITTER LIVE';
PAGE_TITLES['liveThreads']    = 'THREADS LIVE';

// =============================================
// 2FA TOTP LIVE — START / RESTART Logic
// =============================================
var _twofaInterval = null;

/**
 * Minimal TOTP generator (RFC 6238 / Base32 HMAC-SHA1)
 * Works in-browser without any library dependency.
 */
function generateTOTP(secretBase32) {
    // Base32 decode
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const base32 = secretBase32.toUpperCase().replace(/\s/g,'').replace(/=/g,'');
    let bits = '';
    for (const c of base32) {
        const idx = alphabet.indexOf(c);
        if (idx < 0) continue;
        bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }

    // Counter = floor(epoch / 30)
    const counter = Math.floor(Date.now() / 30000);
    const msg = new Uint8Array(8);
    let c = counter;
    for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c >>>= 8; }

    // HMAC-SHA1 via SubtleCrypto (async – handled via Promise)
    return window.crypto.subtle.importKey(
        'raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    ).then(key => window.crypto.subtle.sign('HMAC', key, msg))
     .then(sig => {
        const h = new Uint8Array(sig);
        const offset = h[19] & 0xf;
        const code = (((h[offset] & 0x7f) << 24) |
                      ((h[offset+1] & 0xff) << 16) |
                      ((h[offset+2] & 0xff) << 8)  |
                       (h[offset+3] & 0xff)) % 1000000;
        return String(code).padStart(6, '0');
     });
}

function start2faLive() {
    const startBtn = document.getElementById('twofa-start-btn');
    
    // Toggle STOP functionality if already running
    if (_twofaInterval) {
        clearInterval(_twofaInterval);
        _twofaInterval = null;
        
        if (startBtn) {
            startBtn.innerHTML = '<i class="fas fa-play"></i> START';
            startBtn.style.background = 'linear-gradient(135deg,#4f46e5,#7c3aed)';
        }
        
        const result = document.getElementById('twofa-result');
        const timer  = document.getElementById('twofa-timer');
        if (result) result.textContent = '------';
        if (timer)  timer.textContent  = 'Waiting...';
        
        const copyBtn = document.getElementById('twofa-restart-btn');
        if (copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-paste"></i> PASTE';
            copyBtn.onclick = pasteFromClipboard;
        }
        
        const input = document.getElementById('twofa-input');
        if (input) {
            input.value = '';
            const clearBtn = document.getElementById('twofa-clear-btn');
            if (clearBtn) clearBtn.style.display = 'none';
        }
        
        window.showToast('🛑 2FA service stopped and data cleared.');
        return;
    }
    
    const input = document.getElementById('twofa-input');
    const secret = input ? input.value.trim() : '';
    if (!secret) {
        window.showToast('⚠️ Please enter a 2FA secret key first!');
        return;
    }

    // Call server to deduct tokens
    if (!userData || !userData.id) {
        window.showToast('⚠️ User data not found. Please reload.');
        return;
    }

    if (startBtn) startBtn.disabled = true;

    fetch('/api/generate/live2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id })
    })
    .then(r => r.json())
    .then(data => {
        if (startBtn) startBtn.disabled = false;
        
        if (!data.success) {
            window.showToast(`❌ ${data.message}`);
            return;
        }

        // Success! Tokens deducted. Start service.
        updateTwoFA(secret);
        _twofaInterval = setInterval(() => updateTwoFA(secret), 1000);

        // Update button states to STOP
        if (startBtn) {
            startBtn.innerHTML = '<i class="fas fa-stop"></i> STOP';
            startBtn.style.background = 'linear-gradient(135deg,#dc2626,#ef4444)'; // Red for Stop
        }
        
        const copyBtn = document.getElementById('twofa-restart-btn');
        if (copyBtn) {
            copyBtn.innerHTML = '<i class="fas fa-copy"></i> COPY';
            copyBtn.onclick = copy2faCode;
        }
        
        window.showToast('🚀 2FA service started.');
        
        // Refresh balance and history
        if (typeof checkUserStatus === 'function') checkUserStatus();
        if (typeof loadRecentActivity === 'function') loadRecentActivity();
    })
    .catch(err => {
        if (startBtn) startBtn.disabled = false;
        window.showToast('❌ Failed to start service. Try again.');
        console.error(err);
    });
}

function copy2faCode() {
    const result = document.getElementById('twofa-result');
    const code = result ? result.textContent.trim() : '';
    if (code && code !== '------' && code !== 'ERROR') {
        navigator.clipboard.writeText(code).then(() => {
            window.showToast('📋 Code copied to clipboard!');
        }).catch(() => {
            window.showToast('❌ Failed to copy!');
        });
    } else {
        window.showToast('⚠️ No code to copy!');
    }
}

function pasteFromClipboard() {
    navigator.clipboard.readText().then(text => {
        const input = document.getElementById('twofa-input');
        if (input) {
            input.value = text;
            const btn = document.getElementById('twofa-clear-btn');
            if (btn) btn.style.display = text ? 'block' : 'none';
        }
        window.showToast('📋 Pasted from clipboard!');
    }).catch(err => {
        window.showToast('❌ Failed to read clipboard!');
        console.error(err);
    });
}

function toggleClearBtn(input) {
    const btn = document.getElementById('twofa-clear-btn');
    if (btn) {
        btn.style.display = input.value ? 'block' : 'none';
    }
}

function clearTwoFAInput() {
    const input = document.getElementById('twofa-input');
    if (input) {
        input.value = '';
        toggleClearBtn(input);
    }
}

window.pasteFromClipboard = pasteFromClipboard;
window.toggleClearBtn = toggleClearBtn;
window.clearTwoFAInput = clearTwoFAInput;

function updateTwoFA(secret) {
    const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    const timer = document.getElementById('twofa-timer');
    if (timer) timer.textContent = `Refreshes in ${remaining}s`;

    generateTOTP(secret)
        .then(code => {
            const result = document.getElementById('twofa-result');
            if (result) result.textContent = code;
        })
        .catch(() => {
            const result = document.getElementById('twofa-result');
            if (result) result.textContent = 'ERROR';
            if (timer)  timer.textContent  = 'Invalid secret key';
        });
}

window.start2faLive   = start2faLive;
window.copy2faCode    = copy2faCode;


function copyOtpFromChip(btn, code) {
    if (!code) return;

    copyText(code);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

    const icon = btn.querySelector('i');
    if (icon) {
        const originalClass = icon.className;
        icon.className = 'fas fa-check';
        btn.style.background = '#22c55e';
        btn.style.transform = 'scale(1.1)';

        setTimeout(() => {
            icon.className = originalClass;
            btn.style.background = '#10b981';
            btn.style.transform = '';
        }, 1000);
    }
}
window.copyOtpFromChip = copyOtpFromChip;

// =============================================
// =============================================
// ITEM SELLING MODULE
// =============================================
let sellingRewards = {};

async function fetchSellingRewards() {
    try {
        const res = await fetch('/api/user/item-sales/rewards');
        const data = await res.json();
        if (data.success) {
            sellingRewards = data.rewards;
        }
    } catch (e) {
        console.error('Error fetching selling rewards:', e);
    }
}

// Item Selling Helper: Set Selection Type
function setSellItemType(type) {
    const isSub = (type === 'subscription');
    document.getElementById('selIsSubscription').value = isSub;

    const btnSub = document.getElementById('btnSellTypeSub');
    const btnAcc = document.getElementById('btnSellTypeAcc');

    if (isSub) {
        btnSub.style.background = 'var(--accent-color)';
        btnSub.style.color = '#000';
        btnSub.innerText = 'SHOP'; // Changed from SUBSCRIPTIONS
        btnAcc.style.background = 'rgba(255,255,255,0.05)';
        btnAcc.style.color = 'var(--text-sub)';
        btnAcc.innerText = 'ACCOUNTS';
    } else {
        btnAcc.style.background = 'var(--accent-color)';
        btnAcc.style.color = '#000';
        btnAcc.innerText = 'ACCOUNTS';
        btnSub.style.background = 'rgba(255,255,255,0.05)';
        btnSub.style.color = 'var(--text-sub)';
        btnSub.innerText = 'SHOP'; // Changed from SUBSCRIPTIONS
    }

    // Filter Category Grid based on type
    const grid = document.getElementById('itemSellCategoryGrid');
    if (grid) {
        const cards = grid.getElementsByClassName('sell-cat-card');
        for (let card of cards) {
            const cardType = card.getAttribute('data-sell-type');
            if (isSub) {
                card.style.display = (cardType === 'subscription' || cardType === 'both') ? 'flex' : 'none';
            } else {
                card.style.display = (cardType === 'account' || cardType === 'both') ? 'flex' : 'none';
            }
        }

        // AUTO-RESET IF FORM IS OPEN:
        // If they click the toggle while the form is open, take them back to the grid
        const form = document.getElementById('itemSellFormContainer');
        const selCat = document.getElementById('selItemCategory').value;
        if (form && form.style.display === 'block' && selCat) {
            // Only reset if they click the opposite of what they selected
            // But for simplicity, reset always so they see the fresh list
            const isfc = document.getElementById('itemSellFormContainer');
            const iscg = document.getElementById('itemSellCategoryGrid');
            if (isfc) isfc.style.display = 'none';
            if (iscg) iscg.style.display = 'grid';
            document.getElementById('selItemCategory').value = '';
        }
    }

    updateSellRewardPreview();
}
window.setSellItemType = setSellItemType;



function selectSellCategory(cat, icon, gradient) {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

    document.getElementById('selItemCategory').value = cat;
    const iscg = document.getElementById('itemSellCategoryGrid');
    const isfc = document.getElementById('itemSellFormContainer');
    if (iscg) iscg.style.display = 'none';
    if (isfc) isfc.style.display = 'block';

    // Header for form
    const catName = document.getElementById('selectedCatName');
    const catIcon = document.getElementById('selectedCatIcon');
    if (catName) catName.innerText = cat.toUpperCase();
    if (catIcon) {
        catIcon.innerHTML = `<i class="${icon}"></i>`;
        catIcon.style.background = gradient;
    }

    // Toggle logic for fields
    const apiFields = document.getElementById('apiKeyFields');
    const vpnFields = document.getElementById('vpnFields');
    const cardFields = document.getElementById('cardFields');
    const accountFields = document.getElementById('accountFields');
    const accountExtraFields = document.getElementById('accountExtraFields');
    const otherFields = document.getElementById('otherItemFields');

    if (apiFields) apiFields.style.display = (cat === 'API Key') ? 'block' : 'none';
    if (vpnFields) vpnFields.style.display = (cat === 'VPN') ? 'block' : 'none';
    if (cardFields) cardFields.style.display = (cat === 'Card') ? 'block' : 'none';
    if (otherFields) otherFields.style.display = (cat === 'Other' || cat === 'App') ? 'block' : 'none';

    // Show account generic fields for most categories except Card and API Key
    if (accountFields) accountFields.style.display = (cat !== 'Card' && cat !== 'API Key') ? 'block' : 'none';

    // Account Name/Logo for 'Account' category
    if (accountExtraFields) accountExtraFields.style.display = (cat === 'Account') ? 'block' : 'none';

    // Update Email/Password labels based on category
    const lblEmail = document.getElementById('lblSelItemEmail');
    if (lblEmail) {
        if (cat === 'Telegram') lblEmail.textContent = 'PHONE NUMBER *';
        else if (cat === 'Discord') lblEmail.textContent = 'DISCORD TOKEN *';
        else lblEmail.textContent = 'LOGIN EMAIL / USERNAME *';
    }

    // Show duration only for relevant items
    const subscriptionFields = document.getElementById('subscriptionFields');
    const hideDurationFor = ['Gmail', 'TikTok', 'Facebook', 'Telegram', 'Discord', 'Card'];
    if (subscriptionFields) subscriptionFields.style.display = hideDurationFor.includes(cat) ? 'none' : 'block';

    // Custom price field for 'Other' or 'App' (if added)
    const requestedPriceField = document.getElementById('requestedPriceField');
    if (requestedPriceField) requestedPriceField.style.display = (cat === 'Other' || cat === 'App') ? 'block' : 'none';

    updateSellRewardPreview();
}

function toggle2FAFields() {
    const is2fa = document.getElementById('selItem2FA').checked;
    const fields = document.getElementById('twoFAFields');
    if (fields) {
        fields.style.display = is2fa ? 'block' : 'none';
        if (!is2fa) {
            const authCode = document.getElementById('sel2FAAuthCode');
            const backupCode = document.getElementById('sel2FABackupCode');
            const appCode = document.getElementById('sel2FAAppCode');
            if (authCode) authCode.value = '';
            if (backupCode) backupCode.value = '';
            if (appCode) appCode.value = '';
        }
    }
}

function previewCustomIcon(input) {
    const preview = document.getElementById('customIconPreview');
    if (!preview || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
}

function previewCardLogo(input) {
    const preview = document.getElementById('cardLogoPreview');
    if (!preview || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:10px;">`;
    preview.style.border = '2px solid #8b5cf6';
}
window.previewCardLogo = previewCardLogo;

function resetSellCategory() {
    const iscg = document.getElementById('itemSellCategoryGrid');
    const isfc = document.getElementById('itemSellFormContainer');
    if (iscg) iscg.style.display = 'grid';
    if (isfc) isfc.style.display = 'none';
    document.getElementById('selItemCategory').value = '';

    // Reset all form fields
    const fields = ['selItemEmail', 'selItemPassword', 'selItemCustomName', 'apiServiceName', 'apiKeyValue', 'apiQuota', 'apiExtraInfo', 'sel2FAAuthCode', 'sel2FABackupCode', 'sel2FAAppCode', 'vpnName', 'vpnEmail', 'vpnPassword', 'vpnPlan', 'cardNumber', 'cardName', 'cardIP', 'cardHolderNames', 'cardBillingAddress', 'selItemCustomDuration', 'selItemRequestedPrice'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    // Reset Card Types
    const cardTypeRadios = document.getElementsByName('cardType');
    if (cardTypeRadios) cardTypeRadios.forEach(r => r.checked = false);
    selectCardType(''); // Reset visual selection

    const twofa = document.getElementById('selItem2FA');
    if (twofa) twofa.checked = false;

    const twoFAFields = document.getElementById('twoFAFields');
    if (twoFAFields) {
        twoFAFields.style.opacity = '0';
        twoFAFields.style.display = 'none';
    }

    // Reset icon preview
    const iconPreview = document.getElementById('customIconPreview');
    if (iconPreview) iconPreview.innerHTML = '<i class="fas fa-image"></i>';

    const iconFile = document.getElementById('selItemIconFile');
    if (iconFile) iconFile.value = '';

    // Reset card logo preview
    const cardLogoPreview = document.getElementById('cardLogoPreview');
    if (cardLogoPreview) {
        cardLogoPreview.innerHTML = '<i class="fas fa-image" style="color:var(--text-sub); font-size:24px;"></i>';
        cardLogoPreview.style.border = '2px dashed var(--border-color)';
    }
    const cardLogoFile = document.getElementById('cardLogoFile');
    if (cardLogoFile) cardLogoFile.value = '';

    setSellDuration(30); // Reset to 30 days default

    // Refresh filter based on current type
    const isSub = (document.getElementById('selIsSubscription').value === 'true');
    setSellItemType(isSub ? 'subscription' : 'account');
}

function setSellDuration(days) {
    const hidden = document.getElementById('selItemDurationDays');
    const custom = document.getElementById('selItemCustomDuration');
    const btns = [7, 30, 90, 365];

    if (days === 'custom') {
        hidden.value = custom.value || 30;
        days = null; // deselect buttons
    } else {
        hidden.value = days;
        if (custom) custom.value = '';
    }

    btns.forEach(b => {
        const btn = document.getElementById('btnDur' + b);
        if (btn) {
            if (b === days) {
                btn.style.borderColor = 'var(--accent-color)';
                btn.style.background = 'rgba(234,179,8,0.15)';
                btn.style.color = 'var(--accent-color)';
            } else {
                btn.style.borderColor = 'var(--border-color)';
                btn.style.background = 'rgba(0,0,0,0.2)';
                btn.style.color = 'var(--text-sub)';
            }
        }
    });

    updateSellRewardPreview();
}

function updateSellRewardPreview() {
    const cat = document.getElementById('selItemCategory').value;
    const is2fa = document.getElementById('selItem2FA')?.checked;
    const appCode = document.getElementById('sel2FAAppCode')?.value?.trim();
    const preview = document.getElementById('sellRewardPreview');

    if (!cat || !sellingRewards[cat]) {
        preview.innerText = '0 TC';
        return;
    }

    if (cat === 'Other') {
        preview.innerText = 'Admin Review';
        return;
    }

    let reward = sellingRewards[cat];
    if (is2fa) {
        reward = Math.round(reward * (sellingRewards['2faMultiplier'] || 1.5));
    }
    // App code gives +25% on top
    if (is2fa && appCode) {
        reward = Math.round(reward * 1.25);
    }
    // Pro-rate by duration if it's a duration-based item
    const hideDurationFor = ['Gmail', 'TikTok', 'Facebook', 'Telegram', 'Discord', 'Card'];
    if (!hideDurationFor.includes(cat)) {
        let dur = parseInt(document.getElementById('selItemDurationDays')?.value || '30', 10);
        if (isNaN(dur) || dur < 1) dur = 30; // default 30 days for calculations if invalid
        reward = Math.round((reward / 30) * dur);
    }

    // Currency display: Card -> TC, Others -> USD
    if (cat === 'Card') {
        preview.innerText = reward + ' TC';
    } else {
        // Assume 100 TC = $1.00 for calculation if needed, or if rewards are already in currency
        // User stated: "Profile's dollar system fix... Cards processed as tokens... Others in dollars"
        // Let's assume the sellingRewards are currently in some 'reward points' that we map to dollars
        // or just show them as raw values with $ sign for now.
        preview.innerText = '$' + (reward / 10).toFixed(2); // Example mapping: 10 units = $1
    }
}

async function submitItemForSale() {
    const userId = userData.id;
    const itemType = document.getElementById('selItemCategory').value;

    if (!itemType) {
        window.showToast('Please select a category first');
        return;
    }

    const isApiKey = itemType === 'API Key';
    const isOther = itemType === 'Other' || itemType === 'App';
    const isVpn = itemType === 'VPN';
    const isCard = itemType === 'Card';
    const isSubscription = document.getElementById('selIsSubscription').value === 'true';
    let payload = { userId, itemType, isSubscription };

    // Process Duration
    const hideDurationFor = ['Gmail', 'TikTok', 'Facebook', 'Telegram', 'Discord', 'Card'];
    if (!hideDurationFor.includes(itemType)) {
        let dur = parseInt(document.getElementById('selItemDurationDays')?.value || '0', 10);
        if (dur > 0) payload.durationDays = dur;
    }

    if (isApiKey) {
        const serviceName = document.getElementById('apiServiceName')?.value.trim();
        const apiKey = document.getElementById('apiKeyValue')?.value.trim();
        if (!serviceName || !apiKey) {
            window.showToast('Please enter service name and API key');
            return;
        }
        payload.serviceName = serviceName;
        payload.apiKey = apiKey;
        payload.apiQuota = document.getElementById('apiQuota')?.value.trim() || '';
        payload.extraInfo = document.getElementById('apiExtraInfo')?.value.trim() || '';
    } else if (isVpn) {
        const vpnName = document.getElementById('vpnName')?.value.trim();
        const vpnEmail = document.getElementById('vpnEmail')?.value.trim();
        const vpnPassword = document.getElementById('vpnPassword')?.value.trim();
        if (!vpnName || !vpnEmail || !vpnPassword) {
            window.showToast('Please fill all required VPN fields');
            return;
        }
        payload.vpnName = vpnName;
        // Map VPN email/pass to standard email/pass for consistency or keep separate
        payload.email = vpnEmail;
        payload.password = vpnPassword;
        payload.vpnPlan = document.getElementById('vpnPlan')?.value.trim() || '';
    } else if (isCard) {
        const cardTypeInput = document.querySelector('input[name="cardType"]:checked');
        if (!cardTypeInput) {
            window.showToast('Please select a Card Type');
            return;
        }
        const cardName = document.getElementById('cardName')?.value.trim();
        const cardNumber = document.getElementById('cardNumber')?.value.trim();
        const cardIP = document.getElementById('cardIP')?.value.trim();
        const cardHolderNames = document.getElementById('cardHolderNames')?.value.trim();
        const cardBillingAddress = document.getElementById('cardBillingAddress')?.value.trim();

        if (!cardName) {
            window.showToast('Please enter card name');
            return;
        }
        if (!cardNumber) {
            window.showToast('Please enter card data');
            return;
        }
        if (!cardIP) {
            window.showToast('Please enter IP address');
            return;
        }
        if (!cardHolderNames) {
            window.showToast('Please enter cardholder names');
            return;
        }
        if (!cardBillingAddress) {
            window.showToast('Please enter full address');
            return;
        }

        // Parse card data from format: number|month|year|cvv
        const cards = parseCardData(document.getElementById('cardNumber'));
        if (cards.length === 0) {
            window.showToast('Please enter valid card data in format: number|month|year|cvv');
            return;
        }

        // Parse cardholder names (one per line)
        const holderNames = cardHolderNames.split('\n').filter(name => name.trim().length > 0);

        const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Gregory', 'Frank', 'Alexander', 'Raymond', 'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Jose', 'Adam', 'Nathan', 'Henry', 'Douglas', 'Zachary', 'Peter', 'Kyle', 'Ethan', 'Walter', 'Noah', 'Jeremy', 'Christian', 'Keith', 'Roger', 'Terry', 'Gerald', 'Harold', 'Sean', 'Austin', 'Carl', 'Arthur', 'Lawrence', 'Dylan', 'Jesse', 'Jordan', 'Bryan', 'Billy', 'Joe', 'Bruce', 'Gabriel', 'Logan', 'Albert', 'Willie', 'Alan', 'Juan', 'Wayne', 'Elijah', 'Randy', 'Roy', 'Vincent', 'Ralph', 'Eugene', 'Russell', 'Bobby', 'Mason', 'Philip', 'Louis'];
        const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'];

        // Generate random name function
        function generateRandomName() {
            const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
            const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
            return `${firstName} ${lastName}`.toUpperCase();
        }

        // Assign names to cards - use provided names first, then auto-generate
        cards.forEach((card, index) => {
            if (index < holderNames.length && holderNames[index].trim()) {
                card.holderName = holderNames[index].trim().toUpperCase();
            } else {
                // Auto-generate random name for this card
                card.holderName = generateRandomName();
            }
        });

        // Parse address dynamically using colon separator
        // Format: "FieldName: Value" - whatever is before colon is field name, after is value
        const addressLines = cardBillingAddress.split('\n').filter(line => line.trim().length > 0);
        const parsedAddress = {};

        addressLines.forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const fieldName = line.substring(0, colonIndex).trim();
                const fieldValue = line.substring(colonIndex + 1).trim();
                if (fieldName && fieldValue) {
                    parsedAddress[fieldName] = fieldValue;
                }
            }
        });

        payload.cardType = cardTypeInput.value;
        payload.cardName = cardName;
        payload.cardIP = cardIP;
        payload.cards = cards; // Array of card objects with number, month, year, cvv, holderName
        payload.cardBillingAddress = parsedAddress; // Dynamic object with field names as keys

        // Get card logo if uploaded
        const logoPreview = document.getElementById('cardLogoPreview');
        const logoImg = logoPreview?.querySelector('img');
        if (logoImg) {
            payload.cardLogo = logoImg.src;
        }
    } else {
        const email = document.getElementById('selItemEmail')?.value.trim();
        const password = document.getElementById('selItemPassword')?.value.trim();
        if (!email || !password) {
            window.showToast('Please fill in both email and password');
            return;
        }
        payload.email = email;
        payload.password = password;

        if (isOther) {
            const customName = document.getElementById('selItemCustomName')?.value.trim();
            if (!customName) {
                window.showToast('Please enter an item name');
                return;
            }
            const requestedPrice = document.getElementById('selItemRequestedPrice')?.value.trim();
            if (!requestedPrice) {
                window.showToast('Please enter your requested price');
                return;
            }
            payload.customName = customName;
            payload.requestedPrice = parseFloat(requestedPrice);
            // Reward currency for Other: TC if it's card-like, USD otherwise
            payload.rewardCurrency = (itemType === 'Card') ? 'TC' : 'USD';
        }

        // Account Name/Logo for category 'Account'
        if (itemType === 'Account') {
            payload.accountName = document.getElementById('selAccountName')?.value.trim();
            payload.accountLogo = document.getElementById('selAccountLogo')?.value.trim();
            if (!payload.accountName) {
                window.showToast('Please enter account name');
                return;
            }
        }

        const is2fa = document.getElementById('selItem2FA')?.checked;
        payload.is2fa = is2fa;
        if (is2fa) {
            const authCode = document.getElementById('sel2FAAuthCode')?.value.trim();
            const backupCode = document.getElementById('sel2FABackupCode')?.value.trim();
            const appCode = document.getElementById('sel2FAAppCode')?.value.trim();
            if (!authCode || !backupCode) {
                window.showToast('Please fill in Authenticator Code and Backup Code');
                return;
            }
            payload.twoFA = { authCode, backupCode, appCode };
        }
    }

    try {
        const res = await fetch('/api/user/item-sales/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            window.showToast('✅ ' + data.message);
            resetSellCategory();
            loadMySales();
            if (window.Telegram?.WebApp?.HapticFeedback) {
                window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
            }
        } else {
            window.showToast('❌ ' + data.message);
        }
    } catch (e) {
        window.showToast('Error submitting item');
    }
}

async function loadMySales() {
    const userId = userData.id;
    try {
        const res = await fetch(`/api/user/item-sales/my?userId=${userId}`);
        const data = await res.json();
        const list = document.getElementById('mySalesList');
        const empty = document.getElementById('noSalesPlaceholder');

        if (data.items && data.items.length > 0) {
            if (empty) empty.style.display = 'none';
            if (list) {
                list.innerHTML = data.items.map(item => {
                    let statusColor = '#f59e0b';
                    let statusText = 'PENDING';
                    let statusMessage = '⏳ Waiting for a buyer...';

                    if (item.status === 'pending') {
                        statusColor = '#f59e0b';
                        statusText = 'UNDER REVIEW';
                        statusMessage = '⏳ Admin is reviewing your item...';
                    }
                    else if (item.status === 'approved') {
                        statusColor = '#10b981';
                        statusText = 'LISTED';
                        statusMessage = `💰 You will receive ${item.rewardOffer || 0} ${item.rewardCurrency || 'Tokens'} after sale`;
                    }
                    else if (item.status === 'sold') {
                        statusColor = '#3b82f6';
                        statusText = 'SOLD ✓';
                        statusMessage = `✅ Payment of ${item.rewardOffer || 0} ${item.rewardCurrency || 'Tokens'} received!`;
                    }
                    else if (item.status === 'rejected') {
                        statusColor = '#ef4444';
                        statusText = 'REJECTED';
                        statusMessage = '❌ Item was not approved';
                    }
                    else if (item.status === 'offer_sent') {
                        statusColor = '#8b5cf6';
                        statusText = 'COUNTER OFFER';
                        statusMessage = '💬 Admin sent a price offer';
                    }

                    const displayName = item.customName || item.serviceName || item.itemType;

                    let offerBlock = '';
                    if (item.status === 'offer_sent') {
                        offerBlock = `
                            <div style="background:rgba(139,92,246,0.1); border:1px solid rgba(139,92,246,0.2); border-radius:12px; padding:12px; margin-top:12px;">
                                <div style="font-size:12px; color:#c4b5fd; font-weight:700; margin-bottom:8px;">
                                    Admin offered: <span style="font-size:16px; color:#8b5cf6; font-weight:900;">${item.rewardOffer || 0} ${item.rewardCurrency || 'Tokens'}</span>
                                </div>
                                <div style="font-size:11px; color:#a78bfa; margin-bottom:12px;">
                                    💡 Tip: You will only get paid AFTER your item sells to a buyer
                                </div>
                                <div style="display:flex; gap:8px;">
                                    <button onclick="respondToOffer('${item.id}', 'accept')" style="flex:1; padding:8px; border-radius:10px; border:none; background:#10b981; color:#fff; font-weight:800; cursor:pointer; font-size:12px;">ACCEPT</button>
                                    <button onclick="respondToOffer('${item.id}', 'reject')" style="flex:1; padding:8px; border-radius:10px; border:none; background:rgba(239,68,68,0.2); color:#ef4444; border:1px solid rgba(239,68,68,0.5); font-weight:800; cursor:pointer; font-size:12px;">REJECT</button>
                                </div>
                            </div>
                        `;
                    }

                    return `
                    <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:18px; padding:18px; border-left:5px solid ${statusColor}; position:relative; overflow:hidden; margin-bottom:12px;">
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div>
                                <div style="font-size:16px; font-weight:900; color:#fff; display:flex; align-items:center; gap:8px;">
                                    ${displayName}
                                    ${item.is2fa ? '<span style="font-size:10px; color:#10b981; background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:6px; border:1px solid rgba(16,185,129,0.2);">2FA</span>' : ''}
                                    ${item.twoFA?.appCode ? '<span style="font-size:10px; color:#eab308; background:rgba(234,179,8,0.1); padding:2px 6px; border-radius:6px; border:1px solid rgba(234,179,8,0.2);">APP</span>' : ''}
                                </div>
                                <div style="font-size:13px; color:var(--text-sub); margin-top:2px; font-family:monospace;">${item.email || item.apiKey?.slice(0, 12) + '...' || ''}</div>
                            </div>
                            <div style="font-size:10px; font-weight:900; padding:4px 10px; border-radius:10px; background:rgba(0,0,0,0.4); color:${statusColor}; border:1px solid ${statusColor}44; text-transform:uppercase;">
                                ${statusText}
                            </div>
                        </div>
                        
                        <div style="font-size:12px; color:var(--text-sub); margin-top:12px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px;">
                            ${statusMessage}
                        </div>
                        
                        ${offerBlock}
                        
                        <div style="font-size:10px; color:var(--text-muted); margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
                            <span>${new Date(item.createdAt).toLocaleDateString()}</span>
                            <span>ID: ${item.id.slice(-6).toUpperCase()}</span>
                        </div>
                    </div>
                    `;
                }).join('');
            }
        } else {
            if (list) list.innerHTML = '';
            if (empty) empty.style.display = 'block';
        }
    } catch (e) {
        console.error('Error loading my sales:', e);
    }
}

async function respondToOffer(saleId, action) {
    try {
        const res = await fetch('/api/user/item-sales/offer-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saleId, action, userId: userData.id })
        });
        const data = await res.json();
        window.showToast(data.success ? '✅ ' + data.message : '❌ ' + data.message);
        loadMySales();
    } catch (e) {
        console.error(e);
        window.showToast('❌ Error responding to offer');
    }
}

// Initial fetch
fetchSellingRewards();

window.selectSellCategory = selectSellCategory;
window.resetSellCategory = resetSellCategory;
window.updateSellRewardPreview = updateSellRewardPreview;
window.submitItemForSale = submitItemForSale;
window.loadMySales = loadMySales;
window.toggle2FAFields = toggle2FAFields;
window.previewCustomIcon = previewCustomIcon;
window.respondToOffer = respondToOffer;

function selectCardType(type) {
    const types = ['visa', 'mastercard', 'amex', 'discover', 'jcb', 'unionpay'];
    const idMap = { 'visa': 'Visa', 'mastercard': 'MC', 'amex': 'Amex', 'discover': 'Discover', 'jcb': 'JCB', 'unionpay': 'UnionPay' };

    types.forEach(t => {
        const el = document.getElementById('cardType' + idMap[t]);
        const checkIcon = el?.querySelector('.check-icon');

        if (el) {
            if (t === type) {
                el.style.borderColor = '#8b5cf6';
                el.style.background = 'rgba(139,92,246,0.2)';
                el.style.color = '#fff';
                if (checkIcon) checkIcon.style.display = 'flex';
            } else {
                el.style.borderColor = 'var(--border-color)';
                el.style.background = 'rgba(0,0,0,0.2)';
                el.style.color = 'var(--text-sub)';
                if (checkIcon) checkIcon.style.display = 'none';
            }
        }
    });

    // Update slide indicators based on selection
    const dots = document.querySelectorAll('.slide-dot');
    const selectedIndex = types.indexOf(type);
    dots.forEach((dot, index) => {
        if (index === selectedIndex) {
            dot.style.background = 'rgba(139,92,246,0.8)';
            dot.style.transform = 'scale(1.2)';
        } else {
            dot.style.background = 'rgba(255,255,255,0.3)';
            dot.style.transform = 'scale(1)';
        }
    });
}
window.selectCardType = selectCardType;

// Auto Fill Card Details with sample data
function autoFillCardDetails() {
    // Sample card data in new format: number|month|year|cvv
    const sampleCards = [
        '6258142602558823|06|2030|282',
        '6258142602534378|06|2030|140',
        '6258142602526754|05|2030|191',
        '6258142602507390|04|2026|578',
        '6258142602589349|08|2028|410'
    ];

    // Select mastercard as default for these cards
    const radio = document.querySelector('input[name="cardType"][value="mastercard"]');
    if (radio) {
        radio.checked = true;
        selectCardType('mastercard');
    }

    // Fill card name
    document.getElementById('cardName').value = 'Business Platinum Card';

    // Fill card data
    const cardData = sampleCards.slice(0, 3).join('\n');
    document.getElementById('cardNumber').value = cardData;
    parseCardData(document.getElementById('cardNumber'));

    // Fill Country
    document.getElementById('cardIP').value = 'Bangladesh';

    // Generate random names for ALL cards automatically
    // Large name database for variety
    const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Gregory', 'Frank', 'Alexander', 'Raymond', 'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Jose', 'Adam', 'Nathan', 'Henry', 'Douglas', 'Zachary', 'Peter', 'Kyle', 'Ethan', 'Walter', 'Noah', 'Jeremy', 'Christian', 'Keith', 'Roger', 'Terry', 'Gerald', 'Harold', 'Sean', 'Austin', 'Carl', 'Arthur', 'Lawrence', 'Dylan', 'Jesse', 'Jordan', 'Bryan', 'Billy', 'Joe', 'Bruce', 'Gabriel', 'Logan', 'Albert', 'Willie', 'Alan', 'Juan', 'Wayne', 'Elijah', 'Randy', 'Roy', 'Vincent', 'Ralph', 'Eugene', 'Russell', 'Bobby', 'Mason', 'Philip', 'Louis', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Nancy', 'Lisa', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Laura', 'Sharon', 'Cynthia', 'Kathleen', 'Amy', 'Shirley', 'Angela', 'Helen', 'Anna', 'Brenda', 'Pamela', 'Nicole', 'Emma', 'Samantha', 'Katherine', 'Christine', 'Debra', 'Rachel', 'Catherine', 'Carolyn', 'Janet', 'Ruth', 'Maria', 'Heather', 'Diane', 'Virginia', 'Julie', 'Joyce', 'Victoria', 'Olivia', 'Kelly', 'Christina', 'Lauren', 'Joan', 'Evelyn', 'Judith', 'Megan', 'Cheryl', 'Andrea', 'Hannah', 'Martha', 'Jacqueline', 'Frances', 'Gloria', 'Ann', 'Teresa', 'Kathryn', 'Sara', 'Janice', 'Jean', 'Alice', 'Madison', 'Doris', 'Abigail', 'Julia', 'Judy', 'Grace', 'Denise', 'Amber', 'Marilyn', 'Beverly', 'Danielle', 'Theresa', 'Sophia', 'Marie', 'Diana', 'Brittany', 'Natalie', 'Isabella', 'Charlotte', 'Rose', 'Alexis', 'Kayla'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson', 'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry', 'Russell', 'Sullivan', 'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Gonzales', 'Fisher', 'Vasquez', 'Simpson', 'Romero', 'Jordan', 'Patterson', 'Alexander', 'Hamilton', 'Graham', 'Reynolds', 'Griffin', 'Wallace', 'Moreno', 'West', 'Cole', 'Hayes', 'Bryant', 'Herrera', 'Gibson', 'Ellis', 'Tran', 'Medina', 'Aguilar', 'Stevens', 'Murray', 'Ford', 'Castro', 'Marshall', 'Owens', 'Harrison', 'Fernandez', 'Mcdonald', 'Woods', 'Washington', 'Kennedy', 'Wells', 'Vargas', 'Henry', 'Chen', 'Freeman', 'Webb', 'Tucker', 'Guerrero', 'Burns', 'Crawford', 'Olson', 'Simpson', 'Porter', 'Hunter', 'Gordon', 'Mendez', 'Silva', 'Shaw', 'Snyder', 'Mason', 'Dixon', 'Munoz', 'Hunt', 'Hicks', 'Holmes', 'Palmer', 'Wagner', 'Black', 'Boyd', 'Ramos', 'Rose', 'Stone', 'Salazar', 'Fox', 'Warren', 'Mills', 'Meyer', 'Rice', 'Schmidt', 'Garza', 'Daniels', 'Ferguson', 'Nichols', 'Stephens', 'Soto', 'Weaver', 'Ryan', 'Gardner', 'Payne', 'Grant', 'Dunn', 'Kelley', 'Spencer', 'Hawkins', 'Arnold', 'Pierce', 'Vazquez', 'Hansen', 'Peters', 'Santos', 'Hart', 'Bradley', 'Knight', 'Elliott', 'Cunningham', 'Duncan', 'Olson'];

    // Generate random name function
    function generateRandomName() {
        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
        return `${firstName} ${lastName}`.toUpperCase();
    }

    // Generate names for all 3 sample cards
    const cardCount = 3;
    const autoNames = [];
    for (let i = 0; i < cardCount; i++) {
        autoNames.push(generateRandomName());
    }

    // Fill Cardholder Names (auto-generated for all cards)
    document.getElementById('cardHolderNames').value = autoNames.join('\n');

    // Fill address
    document.getElementById('cardBillingAddress').value = `Country: Bangladesh
Type: MASTER CARD
State: Dhaka
City: Dhaka
District: Dhaka
Address: Gulshan Avenue, Dhaka
Postal Code: 1212`;

    // Show toast notification
    if (window.showToast) {
        window.showToast(' Card details auto-filled with random names!');
    }

    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}
window.autoFillCardDetails = autoFillCardDetails;

// Parse card data in format: number|month|year|cvv
function parseCardData(textarea) {
    let value = textarea.value.trim();

    // Parse cards in format: number|month|year|cvv
    const lines = value.split('\n').filter(line => line.trim().length > 0);
    const cards = [];

    lines.forEach(line => {
        const parts = line.split('|');
        if (parts.length >= 4) {
            const number = parts[0].trim();
            const month = parts[1].trim();
            const year = parts[2].trim();
            const cvv = parts[3].trim();

            // Validate basic card number (16 digits)
            if (number.length >= 15 && /^\d+$/.test(number.replace(/\s/g, ''))) {
                cards.push({
                    number: number.replace(/\s/g, ''),
                    month: month,
                    year: year,
                    cvv: cvv,
                    displayNumber: formatCardNumber(number.replace(/\s/g, ''))
                });
            }
        }
    });

    const count = cards.length;

    // Update badge
    const badge = document.getElementById('cardCountBadge');
    if (badge) {
        badge.textContent = `${count} card${count !== 1 ? 's' : ''}`;
        badge.style.background = count > 0 ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.2)';
        badge.style.color = count > 0 ? '#8b5cf6' : '#8b5cf6';
    }

    // Show/hide card preview
    const previewContainer = document.getElementById('cardPreviewContainer');
    if (previewContainer) {
        if (count > 0) {
            previewContainer.style.display = 'block';
            // Update preview with first card
            updateCardPreview(cards[0]);
        } else {
            previewContainer.style.display = 'none';
        }
    }

    return cards;
}
window.parseCardData = parseCardData;

// Copy text from card preview with visual feedback
function copyCardPreviewText(elementId, btn) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const text = el.textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
        // Change icon to checkmark
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = 'fas fa-check';
            icon.style.color = '#22c55e';
        }

        // Show toast notification
        if (window.showToast) {
            window.showToast('Copied!');
        }

        // Revert back to copy icon after 2 seconds
        setTimeout(() => {
            if (icon) {
                icon.className = 'fas fa-copy';
                icon.style.color = '#fbbf24';
            }
        }, 2000);
    }).catch(() => {
        if (window.showToast) {
            window.showToast('Failed to copy');
        }
    });
}
window.copyCardPreviewText = copyCardPreviewText;

// Update address preview to show how it will look after purchase
function updateAddressPreview() {
    const addressTextarea = document.getElementById('cardBillingAddress');
    const previewContainer = document.getElementById('addressPreviewContainer');
    const previewBox = document.getElementById('addressPreviewBox');

    if (!addressTextarea || !previewContainer || !previewBox) return;

    const addressText = addressTextarea.value.trim();

    if (!addressText) {
        previewContainer.style.display = 'none';
        return;
    }

    // Parse address lines (format: "FieldName: Value")
    const lines = addressText.split('\n').filter(line => line.trim().length > 0);
    const addressFields = [];

    lines.forEach(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
            const fieldName = line.substring(0, colonIndex).trim();
            const fieldValue = line.substring(colonIndex + 1).trim();
            if (fieldName && fieldValue) {
                addressFields.push({ name: fieldName.toUpperCase(), value: fieldValue });
            }
        }
    });

    if (addressFields.length === 0) {
        previewContainer.style.display = 'none';
        return;
    }

    // Generate preview HTML
    previewBox.innerHTML = addressFields.map(field => `
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:12px; padding:14px 16px;">
            <div style="font-size:9px; font-weight:700; color:var(--text-sub); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                ${field.name}
            </div>
            <div style="font-size:15px; font-weight:600; color:#fff;">
                ${field.value}
            </div>
        </div>
    `).join('');

    previewContainer.style.display = 'block';
}
window.updateAddressPreview = updateAddressPreview;

// Format card number with spaces
function formatCardNumber(number) {
    return number.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

// Update card preview
function updateCardPreview(card) {
    const numberEl = document.getElementById('previewCardNumber');
    const expiryEl = document.getElementById('previewCardExpiry');
    const cvvEl = document.getElementById('previewCardCVV');
    const holderEl = document.getElementById('previewCardHolder');
    const nameEl = document.getElementById('previewCardCustomName');
    const logoEl = document.getElementById('previewCardLogo');

    if (numberEl) numberEl.textContent = card.displayNumber || formatCardNumber(card.number);
    if (expiryEl) expiryEl.textContent = `${card.month}/${card.year.slice(-2)}`;
    if (cvvEl) cvvEl.textContent = card.cvv;

    // Read holder name from cardHolderNames textarea
    const holderNamesTextarea = document.getElementById('cardHolderNames');
    if (holderEl && holderNamesTextarea) {
        const holderNames = holderNamesTextarea.value.split('\n').filter(name => name.trim().length > 0);
        if (holderNames.length > 0) {
            holderEl.textContent = holderNames[0].trim().toUpperCase();
        } else {
            holderEl.textContent = 'CARD HOLDER';
        }
    } else if (holderEl) {
        holderEl.textContent = card.holderName || 'CARD HOLDER';
    }

    // Update custom card name from input
    const cardNameInput = document.getElementById('cardName');
    if (nameEl && cardNameInput && cardNameInput.value.trim()) {
        nameEl.textContent = cardNameInput.value.trim().toUpperCase();
    }

    // Update logo from uploaded image
    const logoPreview = document.getElementById('cardLogoPreview');
    if (logoEl && logoPreview) {
        const img = logoPreview.querySelector('img');
        if (img) {
            logoEl.innerHTML = `<img src="${img.src}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;">`;
        } else {
            logoEl.innerHTML = '<i class="fas fa-credit-card" style="color:#fff; font-size:16px;"></i>';
        }
    }
}

// Format card numbers (legacy function for compatibility)
function formatCardNumbers(textarea) {
    parseCardData(textarea);
}

// =============================================
// SERVICE PAGES LOGIC (Video, AI, Remover)
// =============================================
function validateServiceInput(type) {
    let input, btn;
    if (type === 'videoDownload') {
        input = document.getElementById('videoDownloadInput');
        btn = document.getElementById('videoDownloadBtn');
    } else if (type === 'aiPhoto') {
        input = document.getElementById('aiPhotoPrompt');
        btn = document.getElementById('aiPhotoBtn');
    } else if (type === 'aiVideo') {
        input = document.getElementById('aiVideoPrompt');
        btn = document.getElementById('aiVideoBtn');
    }

    if (!input || !btn) return;

    const val = input.value.trim();
    if (val.length > 0) {
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        btn.style.filter = 'drop-shadow(0 0 8px rgba(255,255,255,0.2))';
    } else {
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
        btn.style.filter = 'none';
    }
}

function handleServiceFileUpload(type) {
    const input = document.getElementById(type + 'File');
    const btn = document.getElementById(type + 'Btn');
    const dropzone = document.getElementById(type + 'Dropzone');
    const placeholder = document.getElementById(type + 'Placeholder');
    const preview = document.getElementById(type + 'Preview');
    const textEl = document.getElementById(type + 'Text');

    if (!input || !btn || !input.files || input.files.length === 0) return;

    const file = input.files[0];

    // Visual feedback
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function (e) {
            if (preview && placeholder) {
                preview.src = e.target.result;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
                if (dropzone) {
                    dropzone.style.padding = '10px';
                    dropzone.style.minHeight = 'auto';
                }
            } else if (textEl) {
                // Fallback for types without separate preview/placeholder structure
                textEl.innerHTML = `<span style="color:#22c55e"><i class="fas fa-check-circle"></i> File selected: ${file.name}</span>`;
                textEl.innerHTML += `<br><img src="${e.target.result}" style="max-width: 100px; max-height: 100px; margin-top: 10px; border-radius: 8px; border: 2px solid white;">`;
            }
        }
        reader.readAsDataURL(file);
    } else {
        // Handle non-image files (e.g., MP4 for watermark remover)
        if (placeholder) {
            if (textEl) {
                textEl.innerHTML = `<span style="color:#22c55e"><i class="fas fa-check-circle"></i> File selected: ${file.name}</span>`;
            }
        }
    }

    if (dropzone) {
        dropzone.style.borderColor = '#22c55e';
        dropzone.style.background = 'rgba(34, 197, 94, 0.05)';
    }

    // Enable action button
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';

    if (window.showToast) {
        window.showToast('✅ File ready for processing!');
    }

    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

window.validateServiceInput = validateServiceInput;
window.handleServiceFileUpload = handleServiceFileUpload;

function openMonitorChannel() {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    window.showToast('🚀 Running Monitor... Redirecting to Bot');
    setTimeout(() => {
        const botUrl = `https://t.me/AutoVerify_Monitor_Bot`;
        tg.openTelegramLink(botUrl);
    }, 1500);
}
window.openMonitorChannel = openMonitorChannel;

// Ends here.
window.switchPremiumTab = switchPremiumTab;


// =============================================
// QUIZ SYSTEM
// =============================================
// Utility for cooldowns
function isActionOnCooldown(key, seconds) {
    const last = localStorage.getItem('cooldown_' + key);
    if (!last) return false;
    const now = Date.now();
    const diff = (now - parseInt(last, 10)) / 1000;
    if (diff < seconds) {
        const remaining = Math.ceil(seconds - diff);
        window.showToast(`⏱️ Please wait ${remaining}s...`);
        return true;
    }
    return false;
}

function setActionCooldown(key) {
    localStorage.setItem('cooldown_' + key, Date.now().toString());
}

let currentQuiz = null;

function startQuizFlow() {
    // ALLOW DEMO USER (999999) for testing as requested
    if (!userData || !userData.id) {
        window.showToast('User not initialized');
        return;
    }
    if (isActionOnCooldown('quiz', 5)) return;

    // Set immediate cooldown to prevent double clicks
    localStorage.setItem('cooldown_quiz', Date.now());

    window.showToast("🎬 Preparing Quiz...");
    showAdAndEarn('quiz_direct');
}

async function loadQuiz() {
    const qEl = document.getElementById('quizQuestion');
    const oEl = document.getElementById('quizOptions');
    if (!qEl || !oEl) return;

    qEl.textContent = '🧠 Generating dynamic question...';
    oEl.innerHTML = '';

    try {
        const res = await fetch('/api/quiz/generate');
        const data = await res.json();

        if (data.success) {
            currentQuiz = {
                q: data.question,
                a: data.options,
                c: data.correctIndex
            };

            qEl.textContent = currentQuiz.q;
            oEl.innerHTML = '';

            currentQuiz.a.forEach((opt, idx) => {
                const btn = document.createElement('button');
                btn.className = 'gv-btn';
                btn.style.background = 'rgba(255,255,255,0.05)';
                btn.style.border = '1px solid rgba(255,255,255,0.1)';
                btn.style.color = '#fff';
                btn.style.marginTop = '0';
                btn.textContent = opt;
                btn.onclick = () => submitQuizAnswer(idx);
                oEl.appendChild(btn);
            });
        } else {
            window.showToast('Failed to load quiz');
        }
    } catch (e) {
        window.showToast('Network error loading quiz');
    }
}

async function submitQuizAnswer(idx) {
    const isCorrect = idx === currentQuiz.c;
    const reward = isCorrect ? 10 : 5;

    if (tg.HapticFeedback) {
        tg.HapticFeedback.notificationOccurred(isCorrect ? 'success' : 'error');
    }

    // ADD DELAY AS REQUESTED (2 SECONDS WAIT)
    window.showToast(isCorrect ? 'Checking answer...' : 'Processing reward...');
    await new Promise(r => setTimeout(r, 2000));

    setActionCooldown('quiz');

    try {
        const res = await fetch('/api/quiz/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, correct: isCorrect, reward })
        });
        const data = await res.json();

        if (data.success) {
            if (isCorrect && window.confetti) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

            window.showToast(isCorrect ? `✅ CORRECT! +10 Tokens` : `❌ WRONG! +5 Tokens for trying.`);
            userData.tokens = data.newBalance;
            renderBalances();
            loadRecentActivity(); // Refresh history after quiz
            nav('home');
        } else {
            window.showToast(data.message || 'Error submitting answer');
        }
    } catch (e) {
        window.showToast('Network error');
    }
}

async function renderQuizLeaderboard() {
    if (typeof renderPodiumLeaderboard !== 'undefined') {
        renderPodiumLeaderboard('quiz', 'all', {
            podiumId: 'quizPodium',
            listId: 'quizLeaderboardList',
            rankId: 'quizPersonalRank',
            timeId: null,
            cycleId: null,
            progressId: null
        });
    }
}

// =============================================
// SCRATCH CARD SYSTEM
// =============================================
let isScratchActive = false;

function initScratchCard() {
    const canvas = document.getElementById('scratchCanvas');
    const ctx = canvas?.getContext('2d');
    const resultDiv = document.getElementById('scratchResult');
    const valueEl = document.getElementById('scratchValue');
    const newBtn = document.getElementById('newScratchBtn');

    if (!canvas || !ctx) return;
    if (!valueEl) return;

    // Cleanup any existing global handlers first
    window.onmouseup = null;
    window.ontouchend = null;

    // Reset state
    isScratchActive = true;
    if (newBtn) newBtn.style.display = 'none';
    canvas.style.display = 'block';
    canvas.style.opacity = '1';

    // Set random reward
    const rewards = [1, 1, 1, 5, 5, 10];
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    valueEl.textContent = reward;

    // Fill with cover
    try {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#C0C0C0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add texture
        ctx.fillStyle = '#A0A0A0';
        for (let i = 0; i < 100; i++) {
            ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 2, 2);
        }

        ctx.font = 'bold 24px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'center';
        ctx.fillText('SCRATCH HERE', canvas.width / 2, canvas.height / 2 + 10);
    } catch (e) {
        console.error('Canvas init error:', e);
        return;
    }

    let isDrawing = false;

    function getEventCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        let clientX, clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function scratch(e) {
        if (!isDrawing || !isScratchActive) return;
        e.preventDefault();

        try {
            const coords = getEventCoords(e);
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(coords.x, coords.y, 20, 0, Math.PI * 2);
            ctx.fill();
            checkScratchPercentage();
        } catch (err) {
            console.error('Scratch error:', err);
        }
    }

    function checkScratchPercentage() {
        if (!isScratchActive) return;

        try {
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let transparent = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] === 0) transparent++;
            }

            const percent = (transparent / (canvas.width * canvas.height)) * 100;

            if (percent > 65) {
                isScratchActive = false;
                claimScratchReward(reward);
            }
        } catch (err) {
            console.error('Check percentage error:', err);
        }
    }

    // Store handlers for cleanup
    const handlers = {
        mousedown: (e) => { isDrawing = true; scratch(e); },
        touchstart: (e) => { isDrawing = true; scratch(e); },
        mouseup: () => { isDrawing = false; },
        touchend: () => { isDrawing = false; },
        mousemove: scratch,
        touchmove: scratch
    };

    canvas.onmousedown = handlers.mousedown;
    canvas.ontouchstart = handlers.touchstart;
    window.onmouseup = handlers.mouseup;
    window.ontouchend = handlers.touchend;
    canvas.onmousemove = handlers.mousemove;
    canvas.ontouchmove = handlers.touchmove;

    // Store cleanup function globally for page change
    window._scratchCleanup = function () {
        canvas.onmousedown = null;
        canvas.ontouchstart = null;
        window.onmouseup = null;
        window.ontouchend = null;
        canvas.onmousemove = null;
        canvas.ontouchmove = null;
        isDrawing = false;
        isScratchActive = false;
    };
}

async function claimScratchReward(reward) {
    // 2s delay
    window.showToast('Claiming scratch reward...');
    await new Promise(r => setTimeout(r, 2000));

    setActionCooldown('scratch'); // Apply cooldown after delay

    const canvas = document.getElementById('scratchCanvas');
    const newBtn = document.getElementById('newScratchBtn');
    canvas.style.opacity = '0';
    setTimeout(() => { canvas.style.display = 'none'; }, 500);
    newBtn.style.display = 'block';

    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if (window.confetti) confetti({ particleCount: 50, spread: 50 });

    try {
        const res = await fetch('/api/scratch/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, reward })
        });
        const data = await res.json();
        if (data.success) {
            window.showToast(`🎁 You won ${reward} tokens!`);
            userData.tokens = data.newBalance;
            renderBalances();
        } else {
            window.showToast(data.message || 'Error claiming scratch reward.');
        }
    } catch (e) {
        window.showToast('Network error claiming scratch reward.');
    }
}

// Export new functions
window.startQuizFlow = startQuizFlow;
function startScratchFlow() {
    if (isActionOnCooldown('scratch', 5)) return; // Check cooldown before showing ad
    showAdAndEarn('scratch_ad');
}
window.startScratchFlow = startScratchFlow;
window.initScratchCard = initScratchCard;

// Function to show Admin Reply on Web UI
function showWebAdminMessage(message) {
    if (message && typeof message === 'object' && message.isGift && message.giftId) {
        const overlayId = 'admin-gift-' + Date.now();
        const text = message.message || '🎁 You received a gift!';
        const html = `
        <div id="${overlayId}" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);">
            <div style="background: linear-gradient(to bottom right, #1e1e38, #13132b); border: 2px solid rgba(245, 158, 11, 0.45); border-radius: 20px; padding: 24px; max-width: 90%; width: 400px; position: relative; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.18); animation: scaleIn 0.3s ease-out;">
                <button onclick="document.getElementById('${overlayId}').remove()" style="position: absolute; top: 12px; right: 12px; background: rgba(255,255,255,0.1); border: none; width: 32px; height: 32px; border-radius: 16px; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px;">
                    <i class="fas fa-times"></i>
                </button>
                <div style="text-align: center; margin-bottom: 16px;">
                    <div style="width: 56px; height: 56px; border-radius: 18px; background: rgba(245, 158, 11, 0.18); color: #f59e0b; font-size: 26px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                        <i class="fas fa-gift"></i>
                    </div>
                    <h3 style="color: white; font-weight: bold; font-size: 18px; margin: 0;">Gift from Admin</h3>
                </div>
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 12px; color: #e2e8f0; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">${text}</div>
                <div style="text-align: center; margin-top: 20px; display:flex; gap:10px;">
                    <button onclick="document.getElementById('${overlayId}').remove()" style="flex:1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); font-weight: bold; padding: 12px 16px; border-radius: 12px; font-size: 14px;">Later</button>
                    <button id="${overlayId}-claim" style="flex:1; background: linear-gradient(135deg, #f59e0b, #d97706); border: none; color: #000; font-weight: 900; padding: 12px 16px; border-radius: 12px; font-size: 14px; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.25);">CLAIM REWARD</button>
                </div>
                <div style="text-align: center; margin-top: 12px;">
                    <span style="font-size: 10px; color: rgba(255,255,255,0.4);">Auto dismissing in 30s...</span>
                </div>
            </div>
        </div>
        <style>
            @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        </style>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        const claimBtn = document.getElementById(`${overlayId}-claim`);
        if (claimBtn) {
            claimBtn.onclick = async () => {
                document.getElementById(overlayId)?.remove();
                claimGiftReward(message.giftId);
            };
        }

        setTimeout(() => {
            const el = document.getElementById(overlayId);
            if (el) el.remove();
        }, 30000);
        return;
    }

    const text = (message && typeof message === 'object') ? (message.message || '') : String(message || '');
    const overlayId = 'admin-msg-' + Date.now();
    const html = `
    <div id="${overlayId}" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);">
        <div style="background: linear-gradient(to bottom right, #1e1e38, #13132b); border: 2px solid rgba(139, 92, 246, 0.4); border-radius: 20px; padding: 24px; max-width: 90%; width: 400px; position: relative; box-shadow: 0 10px 30px rgba(139, 92, 246, 0.2); animation: scaleIn 0.3s ease-out;">
            <button onclick="document.getElementById('${overlayId}').remove()" style="position: absolute; top: 12px; right: 12px; background: rgba(255,255,255,0.1); border: none; width: 32px; height: 32px; border-radius: 16px; color: white; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px;">
                <i class="fas fa-times"></i>
            </button>
            <div style="text-align: center; margin-bottom: 16px;">
                <div style="width: 50px; height: 50px; border-radius: 25px; background: rgba(139, 92, 246, 0.2); color: #a78bfa; font-size: 24px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px;">
                    <i class="fas fa-bell"></i>
                </div>
                <h3 style="color: white; font-weight: bold; font-size: 18px; margin: 0;">Message from Admin</h3>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 12px; color: #e2e8f0; font-size: 15px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">${text}</div>
            <div style="text-align: center; margin-top: 20px;">
                <button onclick="document.getElementById('${overlayId}').remove()" style="background: linear-gradient(90deg, #8b5cf6, #ec4899); border: none; color: white; font-weight: bold; padding: 12px 24px; border-radius: 12px; width: 100%; font-size: 16px; box-shadow: 0 4px 15px rgba(236, 72, 153, 0.3);">Dismiss</button>
            </div>
            <div style="text-align: center; margin-top: 12px;">
                <span style="font-size: 10px; color: rgba(255,255,255,0.4);">Auto dismissing in 30s...</span>
            </div>
        </div>
    </div>
    <style>
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    </style>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    // Auto dismiss after 30 seconds
    setTimeout(() => {
        const el = document.getElementById(overlayId);
        if (el) el.remove();
    }, 30000);
}

async function showGiftPopupFromId(giftId) {
    if (!userData || !userData.id) return;
    try {
        const res = await fetch(`/api/user/gifts?userId=${userData.id}`);
        const data = await res.json();
        if (data.success && data.gifts) {
            const giftObj = data.gifts.find(g => g.id === giftId);
            if (giftObj) {
                showGiftPopup(giftObj);
            } else {
                window.showToast("Gift already claimed or no longer available.");
            }
        }
    } catch (e) {
        window.showToast("Error loading gift details.");
    }
}

// Notifications handling
async function loadNotifications() {
    if (!userData || !userData.id) return;
    try {
        const res = await fetch(`/api/user/notifications?userId=${userData.id}`);
        const data = await res.json();
        
        const list = document.getElementById('notificationsList');
        const empty = document.getElementById('notificationsEmptyState');
        const badge = document.getElementById('notificationBadge');

        if (data.success && data.notifications) {
            const notifs = data.notifications;
            const unreadCount = notifs.filter(n => !n.read).length;
            
            if (badge) {
                if (unreadCount > 0) {
                    badge.style.display = 'flex';
                    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                } else {
                    badge.style.display = 'none';
                }
            }

            if (notifs.length === 0) {
                if (list) list.innerHTML = '';
                if (empty) empty.style.display = 'block';
            } else {
                if (empty) empty.style.display = 'none';
                if (list) {
                    list.innerHTML = notifs.map(n => {
                        const isUnread = !n.read;
                        let icon = 'fa-bell';
                        let color = '#a78bfa';
                        let bg = 'rgba(139, 92, 246, 0.1)';
                        let onClick = `markNotificationRead('${n.id}')`;
                        
                        if (n.type === 'gift') {
                            icon = 'fa-gift';
                            color = '#f59e0b';
                            bg = 'rgba(245, 158, 11, 0.1)';
                            if (!n.claimed) {
                                onClick = `showGiftPopupFromId('${n.giftId}'); markNotificationRead('${n.id}');`;
                            }
                        } else if (n.type === 'message') {
                            icon = 'fa-comment-alt';
                            color = '#38bdf8';
                            bg = 'rgba(56, 189, 248, 0.1)';
                            onClick = `markNotificationRead('${n.id}'); nav('support');`;
                        } else if (n.type === 'broadcast') {
                            icon = 'fa-bullhorn';
                            color = '#ec4899';
                            bg = 'rgba(236, 72, 153, 0.1)';
                        }
                        
                        return `
                        <div onclick="${onClick}" style="background: ${isUnread ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)'}; border: 1px solid ${isUnread ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}; border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s; position: relative;">
                            ${isUnread ? `<div style="position: absolute; top: 12px; right: 12px; width: 8px; height: 8px; background: #ef4444; border-radius: 50%;"></div>` : ''}
                            <div style="display: flex; gap: 12px;">
                                <div style="width: 40px; height: 40px; border-radius: 10px; background: ${bg}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                    <i class="fas ${icon}" style="color: ${color}; font-size: 18px;"></i>
                                </div>
                                <div style="flex: 1;">
                                    <h4 style="color: #fff; font-size: 14px; font-weight: 700; margin: 0 0 4px 0;">${n.title || ''}</h4>
                                    <p style="color: var(--text-sub); font-size: 13px; line-height: 1.4; margin: 0 0 8px 0; word-break: break-word;">${n.message || ''}</p>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span style="color: rgba(255,255,255,0.3); font-size: 11px;">${new Date(n.timestamp || n.date || Date.now()).toLocaleString()}</span>
                                        ${n.type === 'gift' && !n.claimed ? `<span style="color: #f59e0b; font-size: 12px; font-weight: bold; background: rgba(245, 158, 11, 0.1); padding: 4px 8px; border-radius: 6px;">CLAIM NOW</span>` : ''}
                                        ${n.type === 'gift' && n.claimed ? `<span style="color: #22c55e; font-size: 12px; font-weight: bold; opacity: 0.6;"><i class="fas fa-check"></i> CLAIMED</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('');
                }
            }
        }
    } catch (e) {
        console.error('Failed to load notifications', e);
    }
}

async function markNotificationRead(id) {
    if (!userData || !userData.id) return;
    try {
        await fetch('/api/user/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, notificationId: id })
        });
        loadNotifications(); // Reload to update UI
    } catch (e) {
        console.error('Failed to mark notification read', e);
    }
}

// ==========================================
// ADMIN PANEL LOGIC
// ==========================================

async function loadAdminConfig() {
    try {
        const res = await fetch('/api/admin/config');
        const data = await res.json();
        if (data.success) {
            document.getElementById('adm-daily-val').value = data.config.dailyBonus || 100;
            document.getElementById('adm-welcome-val').value = data.config.welcomeCredits || 500;
            const maintBtn = document.getElementById('adm-maint');
            const knob = document.getElementById('adm-knob');
            if (data.config.maintenance) {
                maintBtn.style.background = '#10b981';
                knob.style.left = '24px';
            } else {
                maintBtn.style.background = '#333';
                knob.style.left = '2px';
            }
            // Country Rewards
            document.getElementById('adm-country-rewards').value = JSON.stringify(data.config.countryAdRewards || {}, null, 2);
        }
    } catch (e) { console.error("Error loading admin config", e); }
}

async function saveAdminConfig() {
    const daily = document.getElementById('adm-daily-val').value;
    const welcome = document.getElementById('adm-welcome-val').value;
    let countryRewards = {};
    try {
        countryRewards = JSON.parse(document.getElementById('adm-country-rewards').value);
    } catch (e) {
        return window.showToast('Invalid Country Rewards JSON!');
    }

    try {
        const res = await fetch('/api/admin/update-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                dailyBonus: parseInt(daily),
                welcomeCredits: parseInt(welcome),
                countryAdRewards: countryRewards
            })
        });
        const data = await res.json();
        if (data.success) {
            window.showToast('Config saved successfully!');
            smartSync(true);
        }
        else window.showToast(data.message || 'Error saving config');
    } catch (e) { window.showToast('Network error saving config'); }
}

async function sendAdminBroadcast() {
    const text = document.getElementById('adm-broadcast-text').value;
    if (!text) return window.showToast('Please enter message');
    try {
        const res = await fetch('/api/admin/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, message: text })
        });
        const data = await res.json();
        if (data.success) {
            window.showToast('Broadcast sent!');
            document.getElementById('adm-broadcast-text').value = '';
        } else window.showToast(data.message || 'Broadcast failed');
    } catch (e) { window.showToast('Network error broadcasting'); }
}

async function toggleAdminMeta(type) {
    try {
        const res = await fetch('/api/admin/toggle-maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id })
        });
        const data = await res.json();
        if (data.success) {
            loadAdminConfig(); // Refresh status
        }
    } catch (e) { window.showToast('Error toggling maintenance'); }
}

async function loadAdminMessages() {
    const list = document.getElementById('adminMessagesList');
    try {
        const res = await fetch('/api/admin/all-messages?userId=' + userData.id);
        const data = await res.json();
        if (data.success) {
            renderAdminMessages(data.messages);
        } else {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-sub);">${data.message || 'Failed to load'}</div>`;
        }
    } catch (e) { list.innerHTML = '<div style="color:red; text-align:center;">Network error</div>'; }
}

function renderAdminMessages(messages) {
    const list = document.getElementById('adminMessagesList');
    
    // Save current input values to prevent losing them during auto-refresh
    const currentInputs = {};
    if (list) {
        const inputs = list.querySelectorAll('input[type="text"]');
        inputs.forEach(inp => {
            if (inp.id && inp.value) {
                currentInputs[inp.id] = inp.value;
            }
        });
    }

    if (!messages || Object.keys(messages).length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);">No active support threads</div>';
        return;
    }
    let html = '';
    for (const uId in messages) {
        const userMsgs = messages[uId];
        const lastMsg = userMsgs[userMsgs.length - 1];
        const savedValue = currentInputs['reply-to-' + uId] || '';
        html += `
            <div style="background:rgba(255,255,255,0.05); padding:15px; border-radius:15px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-weight:bold; color:var(--accent-color);">User: ${uId}</span>
                    <span style="font-size:10px; color:var(--text-sub);">${new Date(lastMsg.timestamp).toLocaleString()}</span>
                </div>
                <div style="font-size:14px; margin-bottom:10px; opacity:0.8;">Last: ${lastMsg.message}</div>
                <div style="display:flex; gap:8px;">
                    <input type="text" id="reply-to-${uId}" placeholder="Type reply..." value="${savedValue.replace(/"/g, '&quot;')}"
                        style="flex:1; background:var(--bg-body); border:1px solid var(--border-color); color:var(--text-main); padding:8px; border-radius:8px; font-size:12px;">
                    <button onclick="replyToUser('${uId}')" 
                        style="background:var(--accent-color); color:#000; border:none; padding:8px 15px; border-radius:8px; font-weight:bold; font-size:12px;">SEND</button>
                </div>
            </div>
        `;
    }
    
    // Check if anything actually changed besides inputs
    // Wait, the new HTML includes the saved input values, so it's safe to just assign innerHTML
    // but assignment breaks cursor focus. Let's just avoid re-rendering if no new messages.
    // A simple hack: compare without input values. Or just re-render but focus might be lost. 
    // To preserve focus, don't re-render if the last messages are identical.
    
    // Simple state tracking:
    const newHtmlState = JSON.stringify(messages);
    if (list.dataset.lastState !== newHtmlState) {
        list.innerHTML = html;
        list.dataset.lastState = newHtmlState;
        
        // Restore focus if needed? Actually let's just let it be. If a message comes in, focus is lost, but it's acceptable for a live admin panel.
        // Re-apply focus to the right element if it was focused:
        const activeId = document.activeElement ? document.activeElement.id : null;
        if (activeId && currentInputs[activeId] !== undefined) {
            setTimeout(() => {
                const el = document.getElementById(activeId);
                if (el) { el.focus(); el.selectionStart = el.value.length; }
            }, 10);
        }
    }
}

async function replyToUser(targetUserId) {
    const input = document.getElementById('reply-to-' + targetUserId);
    const message = input.value;
    if (!message) return;
    try {
        const res = await fetch('/api/admin/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: targetUserId, message: message }) // targetUserId is the user to reply to
        });
        const data = await res.json();
        if (data.success) {
            window.showToast('Reply sent!');
            input.value = '';
            loadAdminMessages(); // Refresh
        } else window.showToast(data.message || 'Reply failed');
    } catch (e) { window.showToast('Network error replying'); }
}

// Ensure functions are global
window.saveAdminConfig = saveAdminConfig;
window.sendAdminBroadcast = sendAdminBroadcast;
window.loadAdminMessages = loadAdminMessages;
window.replyToUser = replyToUser;
window.toggleAdminMeta = toggleAdminMeta;
window.loadAdminConfig = loadAdminConfig;

// ==========================================
// AI & MEDIA SERVICES LOGIC
// ==========================================

function showResultWithDownload(containerId, imageUrl, label, isVideo) {
    var existing = document.getElementById(containerId);
    if (existing) existing.remove();

    var mediaTag = isVideo
        ? '<video controls style="width:100%; border-radius:12px; max-height:300px; background:#000;" src="' + imageUrl + '"></video>'
        : '<img src="' + imageUrl + '" style="width:100%; border-radius:12px; max-height:350px; object-fit:contain; background:rgba(0,0,0,0.3);">';

    var div = document.createElement('div');
    div.id = containerId;
    div.style.cssText = 'margin-top:20px; padding:16px; background:rgba(255,255,255,0.05); border-radius:16px; border:1px solid rgba(255,255,255,0.1);';
    div.innerHTML = '<p style="color:#22c55e; font-size:12px; font-weight:700; text-transform:uppercase; margin-bottom:12px;">' + label + '</p>' +
        mediaTag +
        '<a href="' + imageUrl + '" download target="_blank" style="display:flex; align-items:center; justify-content:center; gap:8px; margin-top:12px; padding:12px; background:linear-gradient(135deg,#22c55e,#16a34a); color:#fff; border-radius:10px; text-decoration:none; font-weight:700; font-size:14px;">' +
        '<i class="fas fa-download"></i> Download</a>';

    var pageEl = document.querySelector('.page[style*="block"]') || document.querySelector('.page:not([style*="none"])');
    if (pageEl) pageEl.querySelector('.content-body').appendChild(div);
}

async function pollJobResult(jobId, provider, onReady, maxTries) {
    maxTries = maxTries || 20;
    var tries = 0;
    var interval = setInterval(async function () {
        tries++;
        if (tries > maxTries) {
            clearInterval(interval);
            window.showToast('Processing timed out. Please try again.');
            return;
        }
        try {
            var res = await fetch('/api/ai/job-status/' + jobId + '?provider=' + (provider || 'bytez'));
            var data = await res.json();
            if (data.url) {
                clearInterval(interval);
                if (onReady) onReady(data.url);
            }
        } catch (e) { /* keep polling */ }
    }, 3000);
}

async function generateAIPhoto() {
    var prompt = document.getElementById('aiPhotoPrompt').value.trim();
    var style = document.getElementById('aiPhotoStyle').value;
    var btn = document.getElementById('aiPhotoBtn');

    if (!prompt) { window.showToast('Please enter a prompt!'); return; }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    btn.disabled = true;

    // Remove old result
    var old = document.getElementById('aiPhotoResult');
    if (old) old.remove();

    try {
        var res = await fetch('/api/ai/generate-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData ? userData.id : 0, prompt: prompt, style: style })
        });
        var data = await res.json();
        if (data.success) {
            if (data.data && data.data.url) {
                // Immediate result (OpenRouter)
                showResultWithDownload('aiPhotoResult', data.data.url, 'Generated Image', false);
                window.showToast('Photo generated!');
            } else if (data.data && data.data.jobId) {
                // Async job (Bytez)
                window.showToast('Generating image... Please wait');
                pollJobResult(data.data.jobId, data.provider, function (url) {
                    showResultWithDownload('aiPhotoResult', url, 'Generated Image', false);
                    window.showToast('Photo ready!');
                });
            } else {
                window.showToast('Processing started. Check back shortly.');
            }
        } else {
            window.showToast(data.error || data.message || 'Generation failed. Check API key in settings.');
        }
    } catch (e) { window.showToast('Network error. Is the server running?'); }

    btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Image';
    btn.disabled = false;
}

async function generateAIVideo() {
    var prompt = document.getElementById('aiVideoPrompt').value.trim();
    var quality = document.getElementById('aiVideoQuality').value;
    var btn = document.getElementById('aiVideoBtn');

    if (!prompt) { window.showToast('Please enter a video prompt!'); return; }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    btn.disabled = true;

    var old = document.getElementById('aiVideoResult');
    if (old) old.remove();

    try {
        var res = await fetch('/api/ai/generate-video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData ? userData.id : 0, prompt: prompt, quality: quality })
        });
        var data = await res.json();
        if (data.success) {
            if (data.data && data.data.url) {
                showResultWithDownload('aiVideoResult', data.data.url, 'Generated Video', true);
                window.showToast('Video generated!');
            } else if (data.data && data.data.jobId) {
                window.showToast('Generating video... This may take a few minutes');
                pollJobResult(data.data.jobId, data.provider, function (url) {
                    showResultWithDownload('aiVideoResult', url, 'Generated Video', true);
                    window.showToast('Video ready!');
                }, 40);
            } else {
                window.showToast('Processing started. Check back shortly.');
            }
        } else {
            window.showToast(data.error || data.message || 'Generation failed. Check API key in settings.');
        }
    } catch (e) { window.showToast('Network error. Is the server running?'); }

    btn.innerHTML = '<i class="fas fa-play"></i> Generate Video';
    btn.disabled = false;
}

async function removeWatermark() {
    var fileInput = document.getElementById('watermarkRemoverFile');
    var btn = document.getElementById('watermarkRemoverBtn');

    if (!fileInput.files || fileInput.files.length === 0) {
        window.showToast('Please select a file first!');
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    var old = document.getElementById('watermarkResult');
    if (old) old.remove();

    var fileType = fileInput.files[0].type.startsWith('video') ? 'video' : 'image';

    try {
        // Single-step: upload file and process watermark removal together
        var formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('type', fileType);
        formData.append('userId', userData ? userData.id : 0);

        var res = await fetch('/api/watermark/remove-file', { method: 'POST', body: formData });
        var data = await res.json();

        if (data.success && data.resultUrl) {
            showResultWithDownload('watermarkResult', data.resultUrl, 'Watermark Removed', fileType === 'video');
            window.showToast(data.message || 'Done! Download your file below.');
        } else {
            window.showToast(data.message || data.error || 'Processing failed. Add BYTEZ_API_KEY or OPENROUTER_API_KEY in settings.');
        }
    } catch (e) {
        console.error('Watermark error:', e);
        window.showToast('Network error. Is the server running?');
    }

    btn.innerHTML = '<i class="fas fa-magic"></i> Remove Watermark';
    btn.disabled = false;
}

async function removeBackground() {
    var fileInput = document.getElementById('bgRemoverFile');
    var btn = document.getElementById('bgRemoverBtn');

    if (!fileInput.files || fileInput.files.length === 0) {
        window.showToast('Please select an image first!');
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing Background...';
    btn.disabled = true;

    var old = document.getElementById('bgRemoveResult');
    if (old) old.remove();

    try {
        var formData = new FormData();
        formData.append('image', fileInput.files[0]);
        formData.append('userId', userData ? userData.id : 0);

        var res = await fetch('/api/bg-remover/remove', { method: 'POST', body: formData });
        var data = await res.json();

        if (data.success && data.resultUrl) {
            // Show result in existing preview area
            var preview = document.getElementById('bgRemoverPreview');
            var placeholder = document.getElementById('bgRemoverPlaceholder');
            if (preview) { preview.src = data.resultUrl; preview.style.display = 'block'; }
            if (placeholder) placeholder.style.display = 'none';

            // Also show downloadable result
            showResultWithDownload('bgRemoveResult', data.resultUrl, 'Background Removed', false);
            window.showToast(data.message || 'Background removed successfully!');
        } else {
            window.showToast(data.message || 'Failed. Add REMOVE_BG_API_KEY in .env for real results.');
        }
    } catch (e) { window.showToast('Network error removing background'); }

    btn.innerHTML = '<i class="fas fa-magic"></i> Remove Background';
    btn.disabled = false;
}

async function downloadVideo() {
    var urlInput = document.getElementById('videoDownloadInput');
    var btn = document.getElementById('videoDownloadBtn');
    var url = urlInput ? urlInput.value.trim() : '';

    if (!url) { window.showToast('Please paste a video URL!'); return; }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
    btn.disabled = true;

    // Remove old results
    var old = document.getElementById('videoDownloadResult');
    if (old) old.remove();

    try {
        var res = await fetch('/api/video-downloader/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData ? userData.id : 0, url: url })
        });
        var data = await res.json();

        if (data.success) {
            window.showToast('Video info fetched!');

            // Build format buttons
            var formats = data.formats || [];
            var formatsHtml = '';
            formats.forEach(function (f) {
                formatsHtml += '<a href="' + f.url + '" download target="_blank" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; background:rgba(255,255,255,0.05); border-radius:10px; color:#fff; text-decoration:none; margin-bottom:8px;">' +
                    '<span style="font-size:14px; font-weight:600;">' + (f.quality || 'HD') + '</span>' +
                    '<span style="background:#ec4899; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700;"><i class="fas fa-download"></i> Download</span>' +
                    '</a>';
            });

            var resultDiv = document.createElement('div');
            resultDiv.id = 'videoDownloadResult';
            resultDiv.style.cssText = 'margin-top:20px; padding:16px; background:rgba(255,255,255,0.05); border-radius:16px; border:1px solid rgba(255,255,255,0.1);';
            resultDiv.innerHTML = (data.thumbnail ? '<img src="' + data.thumbnail + '" style="width:100%; border-radius:10px; margin-bottom:12px; max-height:200px; object-fit:cover;">' : '') +
                '<p style="color:#fff; font-weight:700; margin-bottom:12px; font-size:14px;">' + (data.title || 'Video') + '</p>' +
                (formatsHtml || '<a href="' + (data.downloadUrl || url) + '" download target="_blank" style="display:flex; align-items:center; justify-content:center; gap:8px; padding:12px; background:linear-gradient(135deg,#ec4899,#8b5cf6); color:#fff; border-radius:10px; text-decoration:none; font-weight:700;">Download Video</a>') +
                (data.message ? '<p style="color:#888; font-size:11px; margin-top:8px; text-align:center;">' + data.message + '</p>' : '');

            var pageBody = document.getElementById('videoDownloadPage');
            if (pageBody) pageBody.querySelector('.content-body').appendChild(resultDiv);
        } else {
            window.showToast(data.message || 'Failed to fetch video. Add RAPIDAPI_KEY for social media downloads.');
        }
    } catch (e) { window.showToast('Network error downloading video'); }

    btn.innerHTML = '<i class="fas fa-download"></i> Download Video';
    btn.disabled = false;
}

window.generateAIPhoto = generateAIPhoto;
window.generateAIVideo = generateAIVideo;
window.removeWatermark = removeWatermark;
window.removeBackground = removeBackground;
window.downloadVideo = downloadVideo;

// API KEY MANAGEMENT
window.openApiManagementModal = async function () {
    console.log('[API_UI] openApiManagementModal triggered');
    try {
        // If membership join gating is enabled, enforce it here too (not only on init)
        if (featureFlags && featureFlags.joinRequired === true && typeof checkRequiredJoins === 'function' && typeof showJoinRequiredModal === 'function') {
            console.log('[API_UI] Checking required joins...');
            try {
                const joinCheck = await checkRequiredJoins();
                console.log('[API_UI] joinCheck result:', joinCheck);
                if (joinCheck && joinCheck.canProceed === false) {
                    console.log('[API_UI] Join check failed, showing modal');
                    showJoinRequiredModal(joinCheck);
                    return;
                }
                console.log('[API_UI] Join check passed (or not needed)');
            } catch (e) {
                console.error('[API_UI] Join check error:', e);
                // If join check fails, don't hard-block API management UI
            }
        }
        
        console.log('[API_UI] Preparing to show API modal...');

        const modal = document.getElementById('apiManagementModal');
        if (modal) {
            console.log('[API_UI] Found modal, showing...');
            const modalNoKey = document.getElementById('apiModalNoKey');
            const modalActive = document.getElementById('apiModalActive');
            const modalBanned = document.getElementById('apiModalBanned');
            const modalLoading = document.getElementById('apiModalLoading');
            const modalDisplay = document.getElementById('modalApiKeyDisplay');

            // Reset visibility immediately
            if (modalLoading) modalLoading.style.display = 'none';
            if (modalNoKey) modalNoKey.style.display = 'none';
            if (modalActive) modalActive.style.display = 'none';
            if (modalBanned) modalBanned.style.display = 'none';

            // STRICT POLICY: If key exists in memory, show active screen INSTANTLY
            if (userData && userData.apiKey) {
                if (modalActive) modalActive.style.display = 'block';
                if (modalDisplay) modalDisplay.value = userData.apiKey;
                // No need for loading screen at all
            } else {
                // Only show loading if we are absolutely sure there is no local key
                if (modalLoading) modalLoading.style.display = 'block';
            }

            modal.style.display = 'flex';
            loadApiKey(); // This will sync with server in background
        } else {
            console.error('[API_UI] Modal element not found!');
        }
    } catch (e) {
        console.error('[API_UI] openApiManagementModal error:', e);
    }
};

window.closeApiManagementModal = function () {
    const modal = document.getElementById('apiManagementModal');
    if (modal) modal.style.display = 'none';
};

async function loadApiKey() {
    console.log('[API_UI] loadApiKey called. Unified Syncing...');
    
    // Elements for Unified Modal & Page
    const modalLoading = document.getElementById('apiModalLoading');
    const modalBanned = document.getElementById('apiModalBanned');
    const modalActive = document.getElementById('apiModalActive');
    const modalDisplay = document.getElementById('modalApiKeyDisplay');
    const modalRegenBtn = document.getElementById('modalRegenBtn');

    const pageActive = document.getElementById('apiKeyActive');
    const pageBanned = document.getElementById('apiKeyBannedNotice');
    const pageContent = document.getElementById('apiKeyContent');
    const pageDisplay = document.getElementById('userApiKeyDisplay');
    const pageRegenBtn = document.getElementById('regenerateApiKeyBtn');

    // 1. Initial State: Show Loading only if not already active
    if (modalBanned) modalBanned.style.display = 'none';
    if (pageBanned) pageBanned.style.display = 'none';
    if (!userData || !userData.apiKey) {
        if (modalLoading) modalLoading.style.display = 'block';
    }

    try {
        const userId = userData.id || (window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
        if (!userId) return;

        const res = await apiFetch(`/api/user/apikey?userId=${userId}&_=${Date.now()}`, { method: 'GET' });
        const data = await res.json();

        if (modalLoading) modalLoading.style.display = 'none';
        if (!data || !data.success) {
            if (modalActive) modalActive.style.display = 'block';
            if (pageActive) pageActive.style.display = 'block';
            if (pageContent) pageContent.style.display = 'block';
            return;
        }

        // Handle Ban
        if (data.status === 'ban') {
            if (modalBanned) modalBanned.style.display = 'block';
            if (pageBanned) pageBanned.style.display = 'block';
            if (modalActive) modalActive.style.display = 'none';
            if (pageActive) pageActive.style.display = 'none';
            if (pageContent) pageContent.style.display = 'none';
            return;
        }

        // Update memory
        if (userData) {
            userData.apiKey = data.apiKey || null;
            userData.apiStatus = data.status || 'pending';
            try { localStorage.setItem(`userData_${userId}`, JSON.stringify(userData)); } catch (e) {}
        }

        // Show Content
        if (modalActive) modalActive.style.display = 'block';
        if (pageActive) pageActive.style.display = 'block';
        if (pageContent) pageContent.style.display = 'block';

        const buttonText = data.apiKey ? '<i class="fas fa-sync-alt"></i> GENERATE KEY' : '<i class="fas fa-magic"></i> GENERATE NOW';
        const displayValue = data.apiKey || '--- CLICK BELOW TO GENERATE ---';

        if (modalDisplay) modalDisplay.value = displayValue;
        if (pageDisplay) pageDisplay.value = displayValue;

        // Set Unified Button Appearance
        const updateBtn = (btn) => {
            if (!btn) return;
            btn.innerHTML = buttonText;
            btn.style.background = 'linear-gradient(135deg, #9333ea 0%, #6366f1 100%)';
            btn.style.color = '#fff';
            btn.style.border = 'none';
            btn.style.boxShadow = '0 4px 15px rgba(147, 51, 234, 0.3)';
            if (!data.apiKey) btn.classList.add('pulse-btn');
            else btn.classList.remove('pulse-btn');
        };

        updateBtn(modalRegenBtn);
        updateBtn(pageRegenBtn);

    } catch (e) {
        console.error('Unified Sync error:', e);
        if (modalLoading) modalLoading.style.display = 'none';
        if (modalActive) modalActive.style.display = 'block';
        if (pageActive) pageActive.style.display = 'block';
        if (pageContent) pageContent.style.display = 'block';
    }
}

// Export to window for HTML onclick
window.generateNewApiKey = async function (btnElement) {
    console.log('[API_UI] generateNewApiKey clicked');
    const btn = btnElement || document.getElementById('regenerateApiKeyBtn');
    const btnText = btn ? btn.textContent.trim().toUpperCase() : '';
    const isFirstTime = btnText.includes('GENERATE NOW');
    const originalContent = btn ? btn.innerHTML : '';

    // Check if user is logged in
    const userId = userData.id || (window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
    if (!userId) {
        console.warn('[API_UI] No userId found yet');
        window.showToast('Please wait for account data to load...');
        return;
    }

    const startRegen = async () => {
        try {
            window.showToast('⏳ Initializing Key Regeneration...');
            console.log(`[API_UI] Starting generation for ${userId}. First time: ${isFirstTime}`);
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> GENERATING...';
            }

            const res = await apiFetch('/api/user/apikey/generate', {
                method: 'POST',
                body: { userId: userId }
            });

            const data = await res.json();
            if (data.success) {
                window.showToast('✅ API Key generated successfully!');
                
                // Update local storage and memory
                if (userData) userData.apiKey = data.apiKey;
                try { localStorage.setItem(`userData_${userId}`, JSON.stringify(userData)); } catch (e) {}

                // Immediate UI update 
                const modalDisplay = document.getElementById('modalApiKeyDisplay');
                const pageDisplay = document.getElementById('userApiKeyDisplay');
                if (modalDisplay) modalDisplay.value = data.apiKey;
                if (pageDisplay) pageDisplay.value = data.apiKey;

                if (btn) {
                    btn.innerHTML = '<i class="fas fa-sync-alt"></i> GENERATE KEY';
                    btn.classList.remove('pulse-btn');
                }

                // Call loadApiKey to update the Unified UI parts
                loadApiKey().catch(e => console.error(e));
                loadRecentActivity(); // Refresh history

                if (window.Telegram?.WebApp?.HapticFeedback) {
                    window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
                }
            } else {
                window.showToast('❌ Failed: ' + (data.message || 'Server error'));
                if (btn) btn.innerHTML = originalContent; // Restore on failure
            }
        } catch (e) {
            console.error('[API_UI] Fatal Exception:', e);
            window.showToast('❌ ' + (e.message || 'Connection error.'));
            if (btn) btn.innerHTML = originalContent; // Restore on failure
        } finally {
            if (btn) btn.disabled = false;
        }
    };

    // Auto-proceed if it's the first time
    if (isFirstTime || !userData.apiKey) {
        startRegen();
    } else {
        // Custom simple confirm for iframe/web fallback since confirm() is often blocked
        const overlay = document.createElement('div');
        overlay.style = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;";
        overlay.innerHTML = `
            <div style="background:#1a100a;border:1px solid rgba(245,158,11,0.3);border-radius:16px;padding:24px;width:100%;max-width:320px;text-align:center;">
                <div style="color:#ef4444;font-size:36px;margin-bottom:16px;"><i class="fas fa-exclamation-triangle"></i></div>
                <h3 style="color:#fff;margin:0 0 12px 0;font-size:20px;">Regenerate Key?</h3>
                <p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:24px;line-height:1.5;">Your old API key will stop working immediately.</p>
                <div style="display:flex;gap:10px;">
                    <button id="cancelRegenBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:rgba(255,255,255,0.1);color:#fff;font-weight:bold;cursor:pointer;">CANCEL</button>
                    <button id="confirmRegenBtn" style="flex:1;padding:14px;border-radius:12px;border:none;background:#ef4444;color:#fff;font-weight:bold;cursor:pointer;">REGENERATE</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('cancelRegenBtn').onclick = () => overlay.remove();
        document.getElementById('confirmRegenBtn').onclick = () => { overlay.remove(); startRegen(); };
    }
};

function showApiDocs() {
    const modal = document.getElementById('apiDocsModal');
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function closeApiDocs() {
    const modal = document.getElementById('apiDocsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
    }
}
