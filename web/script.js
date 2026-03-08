// Helper: Check if userId is valid before making API calls
function isValidUserId(userId) {
    if (!userId) return false;
    const numericId = typeof userId === 'number' ? userId : parseInt(userId);
    return !isNaN(numericId) && numericId > 0;
}

// Wrapper for fetch that blocks invalid userId calls
function apiFetch(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};
    const userId = body.userId || userData.id;

    if (!isValidUserId(userId)) {
        console.log('[CLIENT BLOCKED] Invalid userId:', userId);
        return Promise.resolve({ json: () => Promise.resolve({ success: false, message: 'Invalid userId' }) });
    }

    return fetch(url, options);
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

// Extract Telegram user from WebApp
const _tgUser = tg.initDataUnsafe?.user || {};
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
// DEMO MODE: If no Telegram user, create demo user with 5000 credits
const isDemoMode = !_tgUser.id;
if (isDemoMode) {
    console.log('🎮 DEMO MODE: Creating demo user with 5000 credits');
}

var userData = {
    id: _tgUser.id || 999999, // Numeric demo ID
    username: _tgUser.first_name || _tgUser.username || 'Demo User',
    firstName: _tgUser.first_name || 'Demo',
    lastName: _tgUser.last_name || 'User',
    photo_url: _tgUser.photo_url || '',
    tokens: isDemoMode ? 5000 : 0, // 5000 credits for demo
    Gems: 0,
    usd: 0.00,
    verified: true,
    dailyStreak: 0,
    lastDailyClaim: 0,
    completedTasks: [],
    history: []
};

// FEATURE FLAGS (Button Management)
var featureFlags = null;
function applyFeatureFlagsToHome() {
    const ids = [
        { key: 'home_verify', el: 'verifyServiceCard' },
        { key: 'home_mail', el: 'mailServiceCard' },
        { key: 'home_number', el: 'numberServiceCard' },
        { key: 'home_gemini', el: 'geminiServiceCard' },
        { key: 'home_chatgpt', el: 'chatgptServiceCard' }
    ];
    ids.forEach(item => {
        const el = document.getElementById(item.el);
        if (!el) return;
        const enabled = !featureFlags || featureFlags[item.key] !== false;
        el.style.display = enabled ? '' : 'none';
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
    if (featureFlags) return Promise.resolve(featureFlags);
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
    const name = encodeURIComponent(userData.firstName || userData.username || 'U');
    const fallback = `https://ui-avatars.com/api/?name=${name}&background=fbbf24&color=000&size=80&bold=true&rounded=true`;
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
    if (!btnElement) return;
    navigator.clipboard.writeText(text);
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.HapticFeedback) {
        Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }

    const icon = btnElement.querySelector('i');
    if (icon) {
        const originalClass = icon.className;
        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = originalClass; }, 2000);
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
    const isHome = document.getElementById('homePage').style.display !== 'none';

    if (isHome) {
        nav('profile');
    } else {
        goBack();
    }
}

// NAVIGATION
function nav(p) {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

    // Feature gating (pre-check)
    // Note: if flags aren't loaded yet, we allow navigation and will re-check inside showPage.
    if (p === 'mailService' && !checkFeatureOrComingSoon('tempMail', 'Temp Mail')) return;
    if (p === 'numberService' && !checkFeatureOrComingSoon('virtualNumber', 'Virtual Number')) return;
    if (p === 'premiumMail' && !checkFeatureOrComingSoon('premiumMail', 'Premium Mail')) return;
    if (p === 'accountsStore' && !checkFeatureOrComingSoon('accountsShop', 'Accounts Shop')) return;
    if (p === 'vccCards' && !checkFeatureOrComingSoon('cardsVcc', 'Cards / VCC')) return;

    // Save current scroll position before navigating away
    try {
        const mainScroll = document.getElementById('mainScroll');
        if (mainScroll && currentPage) {
            pageScrollPositions[currentPage] = mainScroll.scrollTop;
        }
    } catch (e) { }

    // BAN CHECK (Moved to showPage for better centralization)
    if (userStatus === 'banned') {
        window.showToast('ACCOUNT BANNED\n\nYou have been banned by the admin.\nPlease contact support to resolve this issue.\n\nSupport: @Onlin_Income_Support');
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
    'earn': 'EARN',
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
    'leaderboard': 'LEADERBOARD',
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
    'cryptoMethods': 'CRYPTO DEPOSIT',
    'cryptoPayment': 'PAYMENT DETAILS',
    'itemSell': 'SELL ITEMS',
    'quiz': 'DAILY QUIZ',
    'quizLeaderboard': 'QUIZ KINGS',
    'scratch': 'LUCKY SCRATCH'
};

function showPage(targetId) {
    if (!targetId) return;

    // Ensure flags are loaded once (non-blocking)
    ensureFeatureFlagsLoaded().then(() => {
        // If user is already on a disabled page, bounce them to home
        if (currentPage === 'mailService' && featureFlags && featureFlags.tempMail === false) nav('home');
        if (currentPage === 'numberService' && featureFlags && featureFlags.virtualNumber === false) nav('home');
        if (currentPage === 'premiumMail' && featureFlags && featureFlags.premiumMail === false) nav('home');
        if (currentPage === 'accountsStore' && featureFlags && featureFlags.accountsShop === false) nav('home');
        if (currentPage === 'vccCards' && featureFlags && featureFlags.cardsVcc === false) nav('home');
    });

    // Normalize calls that pass DOM page ids (e.g. 'mailServicePage') into logical ids
    if (typeof targetId === 'string' && targetId.endsWith('Page')) {
        targetId = targetId.slice(0, -4);
    }

    // Handle back button visibility
    if (targetId === 'home') {
        tg.BackButton.hide();
    } else {
        tg.BackButton.show();
        tg.BackButton.onClick(() => goBack());
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
    if (targetId === 'accountsStore' && !checkFeatureOrComingSoon('accountsShop', 'Accounts Shop')) {
        targetId = 'home';
    }
    if (targetId === 'vccCards' && !checkFeatureOrComingSoon('cardsVcc', 'Cards / VCC')) {
        targetId = 'home';
    }

    // Show target page
    const targetPage = document.getElementById(targetId + 'Page') || document.getElementById(targetId);
    if (targetPage) {
        targetPage.style.display = 'block';
        setTimeout(() => targetPage.classList.add('active'), 20);

        // Restore scroll position (so Back keeps you at the same place)
        const mainScroll = document.getElementById('mainScroll');
        const savedTop = (pageScrollPositions[targetId] ?? 0);
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
    if (targetId === 'quizLeaderboard') renderQuizLeaderboard();
    if (targetId === 'scratch') {
        const canvas = document.getElementById('scratchCanvas');
        if (canvas) canvas.style.display = 'block';
        if (canvas) canvas.style.opacity = '1';
        initScratchCard();
    }

    // Update current page tracker
    currentPage = targetId;
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
    if (targetId === 'vccCards') {
        try { renderCards(); } catch (e) { }
        refreshVccCardsData();
    }
    if (targetId === 'vpnServices') {
        try { renderVPN(); } catch (e) { }
        refreshVpnData();
    }
    // Update virtual number balance when entering the number service page
    if (targetId === 'numberService') {
        updateNumBalance();
    }
    // Update balances when entering service pages with balance displays
    if (targetId === 'mailService' || targetId === 'premiumMail' || targetId === 'accountsStore' ||
        targetId === 'vpnServices' || targetId === 'vccCards' || targetId === 'transfer') {
        renderBalances();
        // Update transfer page specific balance display
        if (targetId === 'transfer') {
            updateTransferBalanceDisplay();
        }
    }
    // Refresh History when entering history page
    if (targetId === 'history') {
        loadRecentActivity(); // Refresh from server
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
    const servicePages = ['profile', 'services', 'numberService', 'mailService', 'premiumMail', 'emailMenu',
        'emailService', 'vccCards', 'vpnServices', 'accountsStore', 'serviceGenerate',
        'geminiProduct', 'chatgptProduct', 'checkout', 'deposit', 'shop', 'itemSell',
        'exchange', 'binancePay', 'faucetPay', 'history', 'redeem',
        'invite', 'tasks', 'earn', 'daily', 'verify', 'admin',
        'geminiVerification', 'leaderboard', 'support', 'emailMessage',
        'cryptoMethods', 'cryptoPayment'];

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
    else if (['profile', 'history', 'redeem', 'transfer', 'support', 'verify', 'geminiVerification', 'admin', 'quizLeaderboard'].includes(targetId)) activeNavGroup = 'profile';

    const activeItem = document.querySelector(`.bottom-nav [data-page="${activeNavGroup}"]`);
    if (activeItem) activeItem.classList.add('active');
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

    if (!confirm('Confirm exchange of ' + formatCurrencyAmount(amt, fromCur) + ' to ' + formatCurrencyAmount(preview.toAmount, toCur) + '?')) return;

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

    // Restriction: Cannot convert Tokens/Gems back to USD
    if (to === 'usd' && from !== 'usd') {
        return { success: false, message: 'Convert back to USD is not allowed.' };
    }

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
    if (cur === 'usd') return `$${(Math.round(amount * 100) / 100).toFixed(2)}`;
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
    if (t) t.textContent = (userData.tokens || 0).toString();
    if (j) j.textContent = (userData.Gems || 0).toString();
    if (u) u.textContent = (Math.round((userData.usd || 0) * 100) / 100).toFixed(2);
}

function updateTransferBalanceDisplay() {
    const tokenEl = document.getElementById('transferTokenBalance');
    const gemsEl = document.getElementById('transferGemsBalance');
    const usdEl = document.getElementById('transferUsdBalance');
    if (tokenEl) tokenEl.textContent = (userData.tokens || 0).toString();
    if (gemsEl) gemsEl.textContent = (userData.Gems || 0).toString();
    if (usdEl) usdEl.textContent = (Math.round((userData.usd || 0) * 100) / 100).toFixed(2);
}

function updateExchangePreview() {
    const fromCur = document.getElementById('exFromCurrency')?.value;
    const toCur = document.getElementById('exToCurrency')?.value;
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
    if (fromHint) fromHint.textContent = `MAX: ${fromCur === 'usd' ? '$' + (Math.round(maxVal * 100) / 100).toFixed(2) : maxVal}`;

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
    const faucetSection = document.getElementById('payViaFaucetSection');
    if (method === 'faucet') {
        if (faucetSection) faucetSection.style.display = faucetSection.style.display === 'block' ? 'none' : 'block';
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
    const container = document.getElementById('cryptoMethodsList');
    if (!container || !cryptoConfig) return;

    container.innerHTML = '';
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
        container.appendChild(card);
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

async function submitFaucetDeposit() {
    const amount = document.getElementById('fpAmountInput').value;
    const txnId = document.getElementById('fpTxnIdInput').value;

    if (!amount || amount <= 0) return window.showToast('Please enter a valid amount.');
    if (!txnId) return window.showToast('Please enter your FaucetPay Transaction ID.');

    try {
        const res = await fetch('/api/deposit/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                method: 'faucetpay',
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
        window.open('https://youtube.com/@MamunIslamyts');

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
                    window.showToast('Please join the channel/group first, then click START again.');
                }
            })
            .catch(err => {
                console.error('Verify error:', err);
                IN_PROGRESS_TASKS[type] = null;
                buttonElement.innerHTML = 'START';
                buttonElement.style.pointerEvents = 'auto';
                buttonElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                window.showToast('Error verifying. Please try again.');
            });
    } else {
        // YouTube - direct complete
        completeTaskReward(type, buttonElement, amount);
    }
}

// Give reward and mark complete
function completeTaskReward(type, buttonElement, amount) {
    buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> COMPLETING...';

    fetch('/api/earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, taskType: type, amount: amount })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                IN_PROGRESS_TASKS[type] = 'completed';
                buttonElement.innerHTML = '<i class="fas fa-check"></i> DONE';
                buttonElement.style.background = '#22c55e';
                buttonElement.style.color = '#fff';
                buttonElement.style.pointerEvents = 'none';

                userData.tokens = data.newBalance || (userData.tokens + amount);
                updateBalanceUI();

                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                checkAllTasksCompleted();

                window.showToast(`TASK COMPLETE!\n\nYou earned +${amount} Tokens!`);
                loadRecentActivity(); // Refresh history immediately
            } else {
                IN_PROGRESS_TASKS[type] = null;
                buttonElement.innerHTML = 'START';
                buttonElement.style.pointerEvents = 'auto';
                buttonElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
                window.showToast(data.message || 'Error completing task.');
            }
        })
        .catch(err => {
            console.error('Complete error:', err);
            IN_PROGRESS_TASKS[type] = null;
            buttonElement.innerHTML = 'START';
            buttonElement.style.pointerEvents = 'auto';
            buttonElement.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
            window.showToast('Error. Please try again.');
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
    // Check ad cooldown first (for all contexts except zero_balance_trigger which handles it differently)
    if (context !== 'zero_balance_trigger' && typeof checkAdCooldown !== 'undefined') {
        if (!checkAdCooldown()) {
            return;
        }
    }

    // Check ad limit for watch_ad context
    if (context === 'watch_ad') {
        const adLimit = window.appCostConfig?.adLimit || 50;
        const adRecovery = window.appCostConfig?.adRecoveryHours || 24;
        if (typeof checkActivityLimit !== 'undefined' && !checkActivityLimit('ad', adLimit, adRecovery, 'Watch Ad')) {
            return;
        }
    }

    currentAdContext = context;
    adRewardClaimed = false;

    window.showToast("🎬 Loading Ad...");

    fetch('/api/ads/config')
        .then(r => r.json())
        .then(data => {
            const ads = data.ads || {};
            let adInjected = false;

            if (!adInjected && ads.moneytag && ads.moneytag.publisherId) {
                adInjected = true;
                const cfg = ads.moneytag;
                const zoneId = cfg.adUnitId || cfg.publisherId;

                // MoneyTag Direct Link (optional): open link to monetize via direct link
                if (cfg.directLink && typeof cfg.directLink === 'string' && cfg.directLink.trim() !== '') {
                    try {
                        window.open(cfg.directLink.trim(), '_blank');
                    } catch (e) { }
                    setTimeout(claimAdReward, 2000);
                    return;
                }

                if (window[`show_${zoneId}`]) {
                    try { window[`show_${zoneId}`](); } catch (e) { }
                    setTimeout(claimAdReward, 2000);
                } else {
                    const script = document.createElement('script');
                    script.src = '//libtl.com/sdk.js';
                    script.setAttribute('data-zone', zoneId);
                    script.setAttribute('data-sdk', `show_${zoneId}`);

                    script.onload = () => {
                        if (window[`show_${zoneId}`]) {
                            try { window[`show_${zoneId}`](); } catch (e) { }
                        }
                        setTimeout(claimAdReward, 2000);
                    };
                    document.body.appendChild(script);
                }
            }

            if (!adInjected && ads.adsense && ads.adsense.publisherId) {
                adInjected = true;
                setTimeout(claimAdReward, 1500);
            }

            if (!adInjected && ads.adsterra && ads.adsterra.publisherId) {
                adInjected = true;
                const cfg = ads.adsterra;
                const atScript = document.createElement('script');
                atScript.async = true;
                atScript.setAttribute('data-cfasync', 'false');
                atScript.src = `//pl${cfg.adUnitId}.profitableratecpm.com/${cfg.publisherId}/invoke.js`;
                document.body.appendChild(atScript);
                setTimeout(claimAdReward, 2000);
            }

            if (!adInjected) {
                console.log('Ad: No provider ads injected, using fallback claim');
                setTimeout(claimAdReward, 1500);
            }
        })
        .catch((err) => {
            console.error('Ad Config Fetch Error:', err);
            window.showToast("Processing reward...");
            setTimeout(claimAdReward, 2000);
        });
}

function closeAdModal() { }

async function claimAdReward() {
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
            if (currentAdContext === 'watch_ad') msg = `📺 +${data.reward || 5} Tokens rewarded for Watching Ad!`;
            else if (currentAdContext === 'quiz_direct') msg = `🧠 Quiz unlocked! Good luck.`;
            else if (currentAdContext === 'scratch_ad' || currentAdContext === 'scratch_retry') msg = `✨ Scratch card unlocked!`;
            else if (currentAdContext === 'zero_balance_trigger') {
                const perAd = (window.appCostConfig && Number.isFinite(parseInt(window.appCostConfig.zeroBalanceAdReward)))
                    ? parseInt(window.appCostConfig.zeroBalanceAdReward)
                    : 5;
                msg = `📺 +${perAd} Tokens earned! Watching more ads...`;
            }

            window.showToast(msg);

            if (data.newBalance !== undefined) {
                userData.tokens = data.newBalance;
                updateBalanceUI();
                loadRecentActivity(); // Refresh history after ad reward
            }

            // Increment ad activity counter for watch_ad context
            if (currentAdContext === 'watch_ad' && typeof userActivityTracker !== 'undefined') {
                userActivityTracker.increment('ad');
            }

            // Set last ad time for cooldown tracking
            if (typeof adCooldownTracker !== 'undefined') {
                adCooldownTracker.setLastAdTime();
            }

            // Handle zero balance ad system - continue showing ads until enough tokens
            if (currentAdContext === 'zero_balance_trigger' && pendingServiceCost > 0) {
                const currentTokens = userData.tokens || 0;
                const perAd = (window.appCostConfig && Number.isFinite(parseInt(window.appCostConfig.zeroBalanceAdReward)))
                    ? parseInt(window.appCostConfig.zeroBalanceAdReward)
                    : 5;

                if (currentTokens < pendingServiceCost) {
                    // Still need more tokens - show another ad after short delay
                    const stillNeeded = pendingServiceCost - currentTokens;
                    const adsStillNeeded = Math.ceil(stillNeeded / perAd);

                    window.showToast(`⏳ ${stillNeeded} more tokens needed. Watching ad ${adsStillNeeded > 1 ? '(' + adsStillNeeded + ' more)' : '(last one)'}...`);

                    setTimeout(() => {
                        adRewardClaimed = false; // Reset to allow claiming again
                        showAdAndEarn('zero_balance_trigger');
                    }, 2000);
                    return; // Don't clear pending service yet
                } else {
                    // Now have enough tokens - execute the pending service
                    window.showToast(`✅ You now have ${currentTokens} tokens! Proceeding with ${pendingServiceType}...`);

                    setTimeout(() => {
                        if (pendingServiceCallback && typeof pendingServiceCallback === 'function') {
                            pendingServiceCallback();
                        }
                        // Clear pending service
                        pendingServiceCost = 0;
                        pendingServiceCallback = null;
                        pendingServiceType = null;
                    }, 1500);
                }
            }

            // Navigation
            if (currentAdContext === 'quiz_direct') {
                showPage('quiz');
                loadQuiz();
            } else if (currentAdContext === 'scratch_ad' || currentAdContext === 'scratch_retry') {
                showPage('scratch');
                initScratchCard();
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

// Global variables for zero balance ad system
let pendingServiceCost = 0;
let pendingServiceCallback = null;
let pendingServiceType = null;

function checkZeroBalanceAdTrigger(requiredAmount = 1, serviceCallback = null, serviceType = 'service') {
    const currentTokens = userData.tokens || 0;
    if (currentTokens < requiredAmount) {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');

        const needed = requiredAmount - currentTokens;
        const perAd = (window.appCostConfig && Number.isFinite(parseInt(window.appCostConfig.zeroBalanceAdReward)))
            ? parseInt(window.appCostConfig.zeroBalanceAdReward)
            : 5;
        const adsNeeded = Math.ceil(needed / perAd);

        // Store pending service info for after ads
        pendingServiceCost = requiredAmount;
        pendingServiceCallback = serviceCallback;
        pendingServiceType = serviceType;

        if (adsNeeded > 1) {
            window.showToast(`⚠️ Insufficient balance! You need ${requiredAmount} tokens. Watch ${adsNeeded} ads to earn ${adsNeeded * perAd} tokens.`);
        } else {
            window.showToast(`⚠️ Insufficient balance! Watch a short ad to get ${perAd} tokens.`);
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

    // Reset local view if streak is broken (> 48h)
    if (lastClaim > 0 && (now - lastClaim > 48 * 60 * 60 * 1000)) {
        userClaimedDay = 0;
    }

    let html = '';
    for (let i = 1; i <= 7; i++) {
        const isClaimed = i <= userClaimedDay;
        const isActive = i === userClaimedDay + 1 && canClaim;
        const isDay7 = i === 7;

        let iconHtml = `<i class="fas ${isClaimed ? 'fa-check-circle' : (i === 7 ? 'fa-crown' : 'fa-coins')}" style="${!isClaimed ? 'color: #fbbf24;' : ''}"></i>`;
        let rewardText = `${rewards[i - 1]} tokens`;

        if (i === 5 || i === 6) {
            rewardText = `${rewards[i - 1]} tokens + <i class="fas fa-gem" style="color:#38bdf8;"></i> 1`;
        } else if (i === 7) {
            rewardText = `2 <i class="fas fa-gem" style="color:#38bdf8;"></i>`;
            iconHtml = `
                <i class="fas fa-crown" style="color: #fbbf24; font-size: 32px;"></i>
                <div style="display: flex; flex-direction: column; align-items: flex-start;">
                    <span style="font-size:18px; color: #fbbf24;">BIG REWARD</span>
                    <span style="font-size:12px; color: #aaa;">100 Tokens + 2 Gems</span>
                </div>
            `;
        }

        html += `
        <div class="ds-day ${isClaimed ? 'claimed' : ''} ${isActive ? 'active' : ''} ${isDay7 ? 'day-7' : ''}">
            <div class="ds-day-label">DAY ${i}</div>
            <div class="ds-day-icon" style="${isDay7 ? 'flex-direction: row; gap: 10px;' : ''}">
                ${iconHtml}
            </div>
            <div class="ds-day-reward" style="${isDay7 ? 'text-align: right;' : ''}">${rewardText}</div>
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
    showAdAndEarn('daily_bonus');
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
            window.showToast(`✅ ${data.message}! +${data.reward} Tokens.`);
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

function renderLeaderboard() {
    const list = document.getElementById('leadList');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-sub);"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

    fetch(`/api/leaderboard?userId=${userData.id}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.top) {
                list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">No rankings available.</div>';
                return;
            }

            const medals = ['🥇', '🥈', '🥉'];

            list.innerHTML = data.top.map((u, i) => {
                const rank = i + 1;
                let rankClass = 'rank-other';
                if (rank === 1) rankClass = 'rank-1';
                else if (rank === 2) rankClass = 'rank-2';
                else if (rank === 3) rankClass = 'rank-3';

                const medal = rank <= 3 ? medals[rank - 1] : rank;
                const isMe = String(u.id) === String(userData.id);

                return `
            <div class="lead-row" style="${isMe ? 'border: 1px solid #f59e0b; background: rgba(245,158,11,0.08);' : ''}">
                <div class="lead-rank ${rankClass}">${medal}</div>
                <div class="lead-avatar">
                   <img src="${u.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=random&color=fff&size=40`}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=f59e0b&color=000&size=40'">
                </div>
                <div class="lead-info">
                    <div class="lead-name">${u.name}${isMe ? ' <span style="color:#f59e0b;font-size:10px;">YOU</span>' : ''}</div>
                    <div class="lead-uid">ID: ${u.id}</div>
                </div>
                <div class="lead-count-box">
                    <div class="lead-count">${u.refs || 0}</div>
                    <div class="lead-label">REFERRALS</div>
                </div>
            </div>`;
            }).join('');

            // Update personal rank if available
            const rankEl = document.getElementById('profile-rank');
            if (rankEl && data.userRank) {
                rankEl.textContent = `#${data.userRank}`;
            }

            // Update my referral stats on leaderboard page if elements exist
            const myRankEl = document.getElementById('my-leaderboard-rank');
            const myRefsEl = document.getElementById('my-leaderboard-refs');
            if (myRankEl) myRankEl.textContent = data.userRank ? `#${data.userRank}` : 'N/A';
            if (myRefsEl) myRefsEl.textContent = data.userRefs || userData.invites || 0;
        })
        .catch(() => {
            list.innerHTML = '<div style="text-align:center; padding:20px; color:#ef4444;">Failed to load rankings.</div>';
        });
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
                return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-color)">
                    <div style="display:flex; gap:10px; align-items:center">
                        <div style="width:32px; height:32px; background:#333; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700">
                            ${h.name.charAt(0)}
                        </div>
                        <div>
                            <div style="font-size:13px; font-weight:700; color:var(--text-main)">${h.name}</div>
                            <div style="font-size:10px; color:var(--text-sub)">${date} • ${time}</div>
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:10px; color:${h.status === 'Active' ? '#22c55e' : '#f59e0b'}">${h.status}</div>
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
    if (!linkEl) return;

    const text = linkEl.textContent || linkEl.innerText;
    navigator.clipboard.writeText(text).then(() => {
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        window.showToast('✅ Referral link copied!');
    }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.showToast('✅ Referral link copied!');
    });
}

// Update invite page when navigating to it
const originalShowPage = showPage;
showPage = function (targetId) {
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
window.selectPayMethod = selectPayMethod;
window.submitPayment = submitPayment;
window.payWithBalance = payWithBalance;
window.selectPM = selectPM;
window.copyLink = copyLink;

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
function registerAndFetchUser() {
    const currentUserId = userData.id;
    if (!currentUserId || currentUserId === 0) {
        // No Telegram user (opened in browser, not Telegram)
        renderBalances();
        applyProfilePhoto('');
        return;
    }

    // Parse referrer from start_param
    // Bot sends: ?start=USERID (raw userId, no prefix)
    // Web SDK also might send: ?start=ref_USERID
    let referrer = null;
    if (_startParam) {
        const raw = String(_startParam).trim();
        if (raw.startsWith('ref_')) {
            referrer = raw.replace('ref_', '');
        } else if (/^\d+$/.test(raw) && raw !== String(currentUserId)) {
            // Pure numeric userId as start_param (from bot's ?start=userId)
            referrer = raw;
        }
    }

    fetch('/api/register', {
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
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                // Sync from server - check both tokens and balance_tokens fields
                userData.tokens = data.tokens || data.balance_tokens || 0;
                userData.Gems = data.Gems || data.gems || 0;
                userData.usd = (data.usd !== undefined && data.usd !== null) ? data.usd : 0;
                userData.verified = data.verified || false;
                userData.dailyStreak = data.dailyStreak || 0;
                userData.lastDailyClaim = data.lastClaim || 0;
                userData.completedTasks = data.completedTasks || [];
                userData.invites = data.invites || 0;
                // Use Telegram name (always fresh from Telegram)
                userData.username = _tgUser.first_name || data.firstName || data.username || 'User';
                userData.firstName = _tgUser.first_name || data.firstName || '';
                userData.photo_url = _tgUser.photo_url || data.photo_url || '';

                // Handle banned users
                userStatus = data.banned ? 'banned' : 'active';

                // Mark completed tasks in UI
                if (userData.completedTasks.length > 0) {
                    userData.completedTasks.forEach(taskId => {
                        IN_PROGRESS_TASKS[taskId] = 'completed';
                        const btn = document.querySelector(`button[onclick*="'${taskId}',"]`) ||
                            document.querySelector(`button[onclick*="'${taskId}', "]`);
                        if (btn) {
                            btn.innerHTML = '<i class="fas fa-check"></i> DONE';
                            btn.style.background = '#22c55e';
                            btn.style.color = '#fff';
                            btn.style.pointerEvents = 'none';
                        }
                    });
                }

                applyProfilePhoto(userData.photo_url);
                renderBalances();
                loadRecentActivity(); // Load real activity data

                if (currentPage === 'daily') {
                    renderDailyGrid();
                    startDailyCountdown();
                }
            } else {
                // Server returned error - still show Telegram data
                applyProfilePhoto(_tgUser.photo_url || '');
                renderBalances();
            }
        })
        .catch(err => {
            console.warn('Register API error (offline?):', err);
            applyProfilePhoto(_tgUser.photo_url || '');
            renderBalances();
        });
}

// Legacy alias kept for compatibility
function fetchUserData() { registerAndFetchUser(); }

// Load and render real recent activity from user history
function loadRecentActivity() {
    if (!userData.id || userData.id === 0) return;

    fetch(`/api/history/${userData.id}`)
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

    const POS_TYPES = new Set(['transfer_in', 'redeem', 'daily_bonus', 'ad_reward', 'mission_reward', 'quiz_reward', 'bonus', 'deposit']);
    const NEG_TYPES = new Set(['transfer_out', 'account_purchase', 'mail', 'number', 'exchange_out']);

    const typeConfig = {
        'ad_reward': { icon: 'fas fa-play', color: '#f59e0b', name: 'Watch and Earn' },
        'mission_reward': { icon: 'fas fa-check-circle', color: '#22c55e', name: 'Task Completed' },
        'account_purchase': { icon: 'fas fa-shopping-cart', color: '#3b82f6', name: 'Account Purchase' },
        'mail': { icon: 'fas fa-envelope', color: '#ef4444', name: 'Email Generated' },
        'number': { icon: 'fas fa-phone', color: '#9333ea', name: 'Virtual Number' },
        'quiz_reward': { icon: 'fas fa-question-circle', color: '#f59e0b', name: 'Quiz Reward' },
        'deposit': { icon: 'fas fa-wallet', color: '#22c55e', name: 'Deposit' },
        'redeem': { icon: 'fas fa-ticket-alt', color: '#22c55e', name: 'Redeem Code' },
        'transfer_in': { icon: 'fas fa-arrow-down', color: '#22c55e', name: 'Transfer In' },
        'transfer_out': { icon: 'fas fa-arrow-up', color: '#ef4444', name: 'Transfer Out' },
        'daily_bonus': { icon: 'fas fa-gift', color: '#22c55e', name: 'Daily Bonus' },
        'bonus': { icon: 'fas fa-gift', color: '#22c55e', name: 'Bonus' },
        'exchange': { icon: 'fas fa-exchange-alt', color: '#06b6d4', name: 'Currency Exchange' },
    };

    list.innerHTML = userData.history.map(item => {
        const config = typeConfig[item.type] || { icon: 'fas fa-check', color: '#9ca3af', name: item.type || 'Activity' };
        const dateObj = item.date ? new Date(item.date) : new Date();
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const reward = item.reward || '';
        const detail = item.detail || '';
        const amt = Number(item.amount || 0);
        const isNeg = NEG_TYPES.has(item.type) || (!POS_TYPES.has(item.type) && amt < 0);
        const isPos = POS_TYPES.has(item.type) || (!NEG_TYPES.has(item.type) && amt > 0);
        const asset = item.asset || item.currency || 'TC';

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
                    ${reward || ((item.amount !== undefined && item.amount !== null) ? ((isNeg ? '-' : (isPos ? '+' : '')) + Math.abs(amt) + ' ' + (item.asset || item.currency || 'TC').toUpperCase()) : '')}
                </div>
            </div>
        </div>`;
    }).join('');
}

// Load broadcast messages with real live user activity data
function loadBroadcast() {
    const track = document.getElementById('broadcastTrack');
    const badge = document.getElementById('broadcastBadge');
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
                if (badge) badge.style.display = 'none';
            } else {
                track.innerHTML = defaultMessages.map(m => `<span class="bcp-item">${m}</span>`).join('');
                if (badge) badge.style.display = 'none';
            }
        })
        .catch(() => {
            track.innerHTML = defaultMessages.map(m => `<span class="bcp-item">${m}</span>`).join('');
            if (badge) badge.style.display = 'none';
        });
}

// Render recent activity cards
function renderRecentActivity(history) {
    const container = document.getElementById('recentActivityList');
    if (!container) return;

    const typeConfig = {
        'ad_reward': { icon: 'fas fa-play', color: '#f59e0b', name: 'Watch and Earn' },
        'mission_reward': { icon: 'fas fa-check-circle', color: '#22c55e', name: 'Task Completed' },
        'account_purchase': { icon: 'fas fa-shopping-cart', color: '#3b82f6', name: 'Account Purchase' },
        'mail': { icon: 'fas fa-envelope', color: '#ef4444', name: 'Email Generated' },
        'number': { icon: 'fas fa-phone', color: '#9333ea', name: 'Virtual Number' },
        'redeem': { icon: 'fas fa-ticket-alt', color: '#22c55e', name: 'Code Redeemed' },
        'daily_bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Daily Bonus' },
        'verification': { icon: 'fas fa-shield-alt', color: '#10b981', name: 'Verification' },
        'transfer_in': { icon: 'fas fa-arrow-down', color: '#22c55e', name: 'Received' },
        'transfer_out': { icon: 'fas fa-arrow-up', color: '#ec4899', name: 'Sent' },
        'exchange': { icon: 'fas fa-exchange-alt', color: '#06b6d4', name: 'Exchanged' },
        'bonus': { icon: 'fas fa-gift', color: '#fbbf24', name: 'Welcomes' }
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
        const config = typeConfig[item.type] || { icon: 'fas fa-check', color: '#9ca3af', name: item.type || 'Activity' };
        const date = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const time = item.date ? new Date(item.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const POS_TYPES = new Set(['transfer_in', 'redeem', 'daily_bonus', 'ad_reward', 'mission_reward', 'quiz_reward', 'bonus', 'deposit']);
        const NEG_TYPES = new Set(['transfer_out', 'account_purchase', 'mail', 'number']);
        const amt = Number(item.amount || 0);
        const isNeg = NEG_TYPES.has(item.type) || (!POS_TYPES.has(item.type) && amt < 0);
        const isPos = POS_TYPES.has(item.type) || (!NEG_TYPES.has(item.type) && amt > 0);
        const asset = item.asset || item.currency || 'TC';

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
                    ${(isPos ? '+' : (isNeg ? '-' : ''))}${Math.abs(amt)} ${String(asset).toUpperCase()}
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

function renderBalances() {
    const rawName = userData.firstName || userData.username || _tgUser.first_name || 'Guest';
    const displayName = getShortName(rawName);

    // 1. Update Profile Stats
    const elTc = document.getElementById('prof-tc');
    const elJs = document.getElementById('prof-js');
    const elUsd = document.getElementById('prof-usd');
    const elProfName = document.getElementById('prof-name');
    const elProfId = document.getElementById('prof-id');

    if (elTc) elTc.innerText = Math.max(0, userData.tokens || 0).toLocaleString();
    if (elJs) elJs.innerText = Math.max(0, userData.Gems || 0).toLocaleString();
    if (elUsd) elUsd.innerText = '$' + Math.max(0, userData.usd || 0.00).toFixed(2);
    if (elProfName) elProfName.innerText = displayName;
    if (elProfId) elProfId.innerText = '#' + userData.id;

    // 2. Update Home Page Stats
    const hTc = document.getElementById('home-tc');
    const hJs = document.getElementById('home-js');
    const hUsd = document.getElementById('home-usd');
    const hName = document.getElementById('home-name');

    if (hTc) hTc.innerText = Math.max(0, userData.tokens || 0).toLocaleString();
    if (hJs) hJs.innerText = Math.max(0, userData.Gems || 0).toLocaleString();
    if (hUsd) hUsd.innerText = '$' + Math.max(0, userData.usd || 0.00).toFixed(2);
    if (hName) hName.innerText = displayName;

    // 3. Update Service Page Balance Displays
    // Temp Mail (TC)
    const tempMailBal = document.getElementById('tempMailBalanceDisplay');
    if (tempMailBal) tempMailBal.innerText = Math.max(0, userData.tokens || 0).toLocaleString() + ' TC';

    // Premium Mail (TC)
    const premiumMailBal = document.getElementById('premiumMailBalanceDisplay');
    if (premiumMailBal) premiumMailBal.innerText = Math.max(0, userData.tokens || 0).toLocaleString() + ' TC';

    // Virtual Number (TC) - already exists as numBalanceDisplay
    const numBal = document.getElementById('numBalanceDisplay');
    if (numBal) numBal.innerText = Math.max(0, userData.tokens || 0).toLocaleString() + ' TC';

    // Accounts Store (USD)
    const accStoreBal = document.getElementById('accountsStoreBalanceDisplay');
    if (accStoreBal) accStoreBal.innerText = '$' + Math.max(0, userData.usd || 0.00).toFixed(2);

    // VPN Services (USD)
    const vpnBal = document.getElementById('vpnServicesBalanceDisplay');
    if (vpnBal) vpnBal.innerText = '$' + Math.max(0, userData.usd || 0.00).toFixed(2);

    // VCC Cards (USD)
    const vccBal = document.getElementById('vccCardsBalanceDisplay');
    if (vccBal) vccBal.innerText = '$' + Math.max(0, userData.usd || 0.00).toFixed(2);
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
    if (!confirm(`Are you sure you want to transfer ${amount} ${assetNames[assetType]} to User #${targetUserId}?`)) return;

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
                updateTransferBalanceDisplay(); // Update transfer page balance display
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
    premiumMailCost: 50
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

        const tempBadge = document.getElementById('tempMailCostBadge');
        if (tempBadge) tempBadge.textContent = `${window.appCostConfig.mailCost} TC / Email`;
        const premBadge = document.getElementById('premiumMailCostBadge');
        if (premBadge) premBadge.textContent = `${window.appCostConfig.premiumMailCost} TC / Email`;
    } catch (e) {
        // silent
    }
}

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
    fetch('/api/admin/services')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.services) {
                localStorage.setItem('adminServices', JSON.stringify(data.services));
                renderServicesList();
            }
        });
    fetch('/api/admin/shop')
        .then(r => r.json())
        .then(data => {
            if (data.success && data.shopItems) {
                localStorage.setItem('adminShopItems', JSON.stringify(data.shopItems));
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
        const iconHtml = s.imageUrl
            ? `<img src="${s.imageUrl}" style="width:32px; height:32px; object-fit:contain;" onerror="this.parentElement.innerHTML='<i class=\\'${s.icon || 'fas fa-cog'}\\' style=\\'font-size:22px; color:#fff\\'></i>'">`
            : `<i class="${s.icon || 'fas fa-cog'}" style="font-size:22px; color:#fff;"></i>`;
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
                style="background:var(--bg-card); border-radius:20px; overflow:hidden; border:1px solid var(--border-color); cursor:pointer; transition:0.2s;"
                onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
                <div style="background:${item.bgColor || '#0d0d0d'}; padding:20px; display:flex; align-items:center; justify-content:center; min-height:110px;">
                    ${imgHtml}
                </div>
                <div style="padding:12px;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-main); margin-bottom:4px;">${item.name}</div>
                    <div style="font-size:16px; font-weight:800; color:#22c55e; margin-bottom:10px;">${priceDisp}</div>
                    <div style="background:rgba(245,158,11,0.1); border:1px solid ${item.btnColor || '#f59e0b'}; border-radius:10px; padding:8px; text-align:center; font-size:11px; font-weight:700; color:${item.btnColor || '#f59e0b'}; display:flex; align-items:center; justify-content:center; gap:6px;">
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
            style="background:var(--bg-card); border-radius:20px; overflow:hidden; border:1px solid var(--border-color); cursor:pointer; transition:0.2s; position:relative;"
            onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
            ${has2fa ? `<div style="position:absolute; top:8px; right:8px; background:rgba(16,185,129,0.9); color:#fff; font-size:9px; font-weight:800; padding:2px 6px; border-radius:6px; z-index:2;">2FA</div>` : ''}
            <div style="background:#111; padding:20px; display:flex; align-items:center; justify-content:center; min-height:110px; position:relative;">
                ${iconHtml}
            </div>
            <div style="padding:12px;">
                <div style="font-size:11px; font-weight:800; color:var(--text-main); margin-bottom:2px; text-transform:uppercase;">${displayName}</div>
                <div style="font-size:10px; color:#888; font-weight:700; margin-bottom:6px;">Stock: ${item.stock}</div>
                <div style="font-size:16px; font-weight:800; color:#22c55e; margin-bottom:10px;">${priceDisp}</div>
                <div style="background:rgba(245,158,11,0.1); border:1px solid #f59e0b; border-radius:10px; padding:8px; text-align:center; font-size:11px; font-weight:700; color:#f59e0b; display:flex; align-items:center; justify-content:center; gap:6px;">
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
    const cards = JSON.parse(localStorage.getItem('adminCards') || '[]');
    let html = '';

    if (cards.length > 0) {
        html += cards.map(c => `
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

    if (window._userCardHtml) html += window._userCardHtml;

    container.innerHTML = html || '<div style="text-align:center; padding:40px 0; color:var(--text-sub); opacity:0.5;">No cards available</div>';
}

function refreshVccCardsData() {
    const container = document.getElementById('cardsList');
    if (container && (!localStorage.getItem('adminCards') || localStorage.getItem('adminCards') === '[]')) {
        container.innerHTML = '<div style="text-align:center; padding:40px 0; color:var(--text-sub); opacity:0.6;"><i class="fas fa-spinner fa-spin"></i><div style="margin-top:10px; font-size:12px;">Loading cards...</div></div>';
    }
    fetch('/api/admin/cards')
        .then(r => r.json())
        .then(data => {
            if (data && data.success) {
                localStorage.setItem('adminCards', JSON.stringify(data.cards || []));
                if (typeof currentPage !== 'undefined' && currentPage === 'vccCards') renderCards();
            }
        })
        .catch(() => { });
}

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

                // Show account details
                window.showToast(`✅ Account purchased!\n\nEmail: ${res.account.email}\nPassword: ${res.account.password}${res.account.instructions ? '\nNotes: ' + res.account.instructions : ''}\n\nPlease save these details!`);

                renderAccounts(); // Refresh
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

    // Check zero balance and show ads if needed
    if (checkZeroBalanceAdTrigger(cat.price, () => buyAccountFromCategory(category), cat.name)) return;

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

    // Check zero balance and show ads if needed
    if (checkZeroBalanceAdTrigger(cost, () => generateService(type), name)) return;

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
                    if (isActive && !selectedNumPlatform) selectedNumPlatform = p.id;

                    const btn = document.createElement('button');
                    btn.className = 'num-platform-btn';
                    btn.onclick = (e) => selectNumPlatform(btn, p.id);
                    btn.style.cssText = `background:${isActive ? 'rgba(147,51,234,0.15)' : 'var(--accent-bg)'}; border:2px solid ${isActive ? '#9333ea' : 'var(--border-color)'}; border-radius:14px; padding:14px 8px; display:flex; flex-direction:column; align-items:center; gap:8px; cursor:pointer; position:relative;`;

                    // Add "POPULAR" badge for first platform (most popular)
                    let badge = '';
                    if (idx === 0) {
                        badge = `<div style="position:absolute; top:-6px; right:-6px; background:#9333ea; color:#fff; font-size:8px; padding:2px 6px; border-radius:10px; font-weight:900;">🔥 POPULAR</div>`;
                    }

                    btn.innerHTML = `
                        ${badge}
                        <i class="${p.icon}" style="font-size:22px; color:${p.color};"></i>
                        <span style="font-size:10px; font-weight:700; color:var(--text-main);">${p.name}</span>
                    `;
                    list.appendChild(btn);

                    if (isActive) selectedNumPlatform = p.id;
                });
            }
        }).catch(err => console.error('Error loading platforms:', err));
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
    if (el) el.textContent = Math.max(0, userData.tokens || 0) + ' TC';
}

function generateVirtualNumber() {
    const cost = 15;

    // Check zero balance and show ads if needed
    if (checkZeroBalanceAdTrigger(cost, () => generateVirtualNumber(), 'Virtual Number')) return;

    if (Math.max(0, userData.tokens || 0) < cost) { nav('earn'); return; }
    // Get number directly without confirmation
    const btn = document.getElementById('numGenerateBtn');
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...'; btn.disabled = true; }

    fetch('/api/number/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, platform: selectedNumPlatform, cost })
    })
        .then(r => r.json())
        .then(data => {
            if (btn) { btn.innerHTML = '<i class="fas fa-phone-alt"></i> GET VIRTUAL NUMBER'; btn.disabled = false; }
            if (data.success) {
                userData.tokens -= cost;
                renderBalances();
                updateNumBalance();
                currentNumSession = data;
                document.getElementById('numResultValue').textContent = data.number || '+1 555 000 1234';
                document.getElementById('numResultBox').style.display = 'block';
                document.getElementById('numOtpBox').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Waiting for OTP...';
                // Poll for OTP
                if (numOtpPollInterval) clearInterval(numOtpPollInterval);
                numOtpPollInterval = setInterval(pollForOTP, 5000);
                addNumHistory(data.number);
            } else {
                window.showToast('❌ ' + (data.message || 'Failed to get number. Try again.'));
            }
        })
        .catch(() => {
            if (btn) { btn.innerHTML = '<i class="fas fa-phone-alt"></i> GET VIRTUAL NUMBER'; btn.disabled = false; }
            window.showToast('❌ Network error. Please try again.');
        });
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
    const otpMatch = text.match(/\b\d{4,8}\b/);
    return otpMatch ? otpMatch[0] : null;
}

function copyNumOtp(otp) {
    if (!otp) return;
    navigator.clipboard.writeText(otp).then(() => {
        window.showToast('OTP Copied: ' + otp);
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    });
}

function refreshOTP() {
    const icon = document.querySelector('#numResultBox .fa-sync-alt');
    if (icon) { icon.classList.add('fa-spin'); setTimeout(() => icon.classList.remove('fa-spin'), 1000); }
    pollForOTP();
}

function cancelNumber() {
    clearInterval(numOtpPollInterval);
    currentNumSession = null;
    document.getElementById('numResultBox').style.display = 'none';
}

function addNumHistory(number) {
    const list = document.getElementById('numHistoryList');
    if (!list) return;
    const time = new Date().toLocaleTimeString();
    const item = `<div style="background:var(--bg-card);border-radius:12px;padding:12px 14px;border:1px solid rgba(147,51,234,0.2);display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:36px;height:36px;background:rgba(147,51,234,0.15);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9333ea;font-size:16px;">📱</div>
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;color:var(--text-main);">${number}</div><div style="font-size:10px;color:var(--text-sub);">${selectedNumPlatform} • ${time}</div></div>
        <div style="font-size:11px;font-weight:700;color:#ef4444;">-15 TC</div>
    </div>`;
    if (list.querySelector('.fa-history')) list.innerHTML = '';
    list.insertAdjacentHTML('afterbegin', item);
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
    if (!type) type = 'temp';
    const cost = type === "temp"
        ? (parseInt(window.appCostConfig?.mailCost) || 10)
        : (parseInt(window.appCostConfig?.premiumMailCost) || 50);

    // If no user login, cannot generate
    if (!userData.id || userData.id === 0) {
        window.showToast("Please login via Telegram to use this service");
        nav('home');
        return;
    }

    // Check zero balance and show ads if needed
    if (checkZeroBalanceAdTrigger(cost, () => generateTempMail(type), type === 'temp' ? 'Gmail' : 'Premium Mail')) return;

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
                // API returned error - show error message, no demo
                if (addrEl) {
                    addrEl.innerHTML = '<span style="color:#f87171;">Failed. Tap NEW GMAIL to retry</span>';
                    addrEl.style.fontStyle = "normal";
                    addrEl.style.opacity = "1";
                }
                window.showToast("❌ " + (data.message || "Email generation failed. Please try again."));
            }
        })
        .catch(() => {
            // Network error - show error
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">Network error. Tap NEW GMAIL to retry</span>';
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

    if (!previousMailSessions[type]) {
        window.showToast(`❌ No previous ${type} session found to restore.`);
        return;
    }

    // Direct restore without confirmation or success alert
    const current = mailSessions[type];
    mailSessions[type] = previousMailSessions[type];
    previousMailSessions[type] = current;

    updateMailBalance(type);
    startInboxPolling(type);
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
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

    const sessionId = mailSessions[type].id || mailSessions[type].sessionId;
    fetch(`/api/mail/inbox?sessionId=${sessionId}&userId=${userData.id}&cost=${refreshCost}`)
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
            renderInbox(data.messages || [], type);
        })
        .catch(() => {
            if (refreshIcon) refreshIcon.classList.remove("fa-spin");
            renderInbox([], type);
        });
}

function renderInbox(emails, type) {
    const listEl = document.getElementById(type + "InboxList");
    const otpListEl = document.getElementById(type + "OtpList");
    if (!listEl) return;

    // Show at most 10 messages
    if (Array.isArray(emails) && emails.length > 10) {
        emails = emails.slice(0, 10);
    }

    if (emails.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i><div style="font-size:12px;">Waiting for incoming emails...</div></div>`;
        if (otpListEl) otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
        return;
    }

    // OTP EXTRACTION
    let otps = [];
    const otpRegex = /\b\d{4,8}\b/g;
    const keywords = ["otp", "code", "verification", "verify", "login", "security"];

    emails.forEach(email => {
        const combined = ((email.subject || '') + " " + (email.preview || '')).toLowerCase();
        const hasKeyword = keywords.some(k => combined.includes(k));
        if (hasKeyword) {
            const matches = combined.match(otpRegex);
            if (matches) {
                matches.forEach(code => {
                    if (!otps.some(o => o.code === code)) {
                        otps.push({ code, from: email.from || email.sender || 'Unknown' });
                    }
                });
            }
        }
    });

    // Render OTP chips
    if (otpListEl) {
        if (otps.length > 0) {
            otpListEl.innerHTML = otps.map(o => `
                <div class="otp-chip" style="padding: 6px 12px; height: auto; min-height: 44px; display: flex; align-items: center; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; margin-right: 8px; margin-bottom: 8px;">
                    <div style="flex:1;">
                        <div class="oc-code" style="font-size: 16px; font-weight: 800; color: var(--text-main); letter-spacing: 1px;">${o.code}</div>
                    </div>
                    <button class="oc-copy" onclick="copyOtpFromChip(this, '${o.code}')" 
                        style="width:32px; height:32px; border-radius:50%; background:#10b981; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; margin-left:10px; transition: all 0.2s; box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);">
                        <i class="fas fa-copy" style="color:#fff; font-size:12px;"></i>
                    </button>
                </div>
            `).join("");
        } else {
            otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
        }
    }

    // Render Inbox List
    listEl.innerHTML = emails.map(email => `
        <div class="inbox-item" onclick="openEmailMessage('${email.id}', '${type}')">
            <div class="ii-icon"><i class="fas fa-envelope"></i></div>
            <div class="ii-body">
                <div class="ii-top">
                    <div class="ii-sender">${email.from || email.sender || 'Unknown'}</div>
                    <div class="ii-time">${email.time || ''}</div>
                </div>
                <div class="ii-subject">${email.subject}</div>
            </div>
            <div style="display:flex; align-items:center; gap:12px;">
                <button class="ii-quick-copy" onclick="event.stopPropagation(); quickCopyEmailContent('${email.id}', '${type}', this)">
                    <i class="fas fa-copy"></i>
                </button>
                <i class="fas fa-chevron-right" style="font-size:12px; color:var(--text-sub);"></i>
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

function copyText(txt) {
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
    copyText(text);

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
    copyText(document.getElementById(id).innerText);
}

function copyToClipboard(id) {
    const text = document.getElementById(id).textContent;
    copyText(text);

    // Find the button that was clicked and show checkmark feedback
    const buttons = document.querySelectorAll('button[onclick*="copyToClipboard" i]');
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
                    // Restore original color based on button type
                    if (id.includes('temp')) {
                        btn.style.background = '#f59e0b';
                    } else if (id.includes('premium')) {
                        btn.style.background = '#f59e0b';
                    }
                }, 1000);
            }
        }
    });
}



// Initial Render & Auto Login
renderBalances();
applyProfilePhoto(_tgUser.photo_url || ''); // Immediately show photo from Telegram
registerAndFetchUser(); // Sync with server

// Poll for balance updates (every 30s)
setInterval(registerAndFetchUser, 30000);
setInterval(syncAdminData, 30000);


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

    if (emailServiceCard) {
        emailServiceCard.style.display = 'block';
    }
    if (tempMailCard) {
        tempMailCard.style.display = 'block';
    }
}

// Keep old function name for backward compatibility but use new implementation
function checkEmailServicesAndNavigate() {
    handleEmailMenuNavigation();
}

// Fetch config on load (fetchEmailServiceConfig is defined below)
if (typeof fetchEmailServiceConfig === 'function') fetchEmailServiceConfig();
// Refresh config periodically
setInterval(function () { if (typeof fetchEmailServiceConfig === 'function') fetchEmailServiceConfig(); }, 60000);

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

    // Show loading state
    const addrEl = document.getElementById(type + "MailAddr");
    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>generating...';
        addrEl.style.fontStyle = "italic";
        addrEl.style.opacity = "0.7";
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

function openPremiumMailDirect() {
    if (!checkFeatureOrComingSoon('premiumMail', 'Premium Mail')) return;
    nav('premiumMail');
    // Load premium emails from admin panel
    loadPremiumEmailsFromAdmin();
}

// Store assigned premium email
let assignedPremiumEmail = null;

// Load premium emails from admin panel
async function loadPremiumEmailsFromAdmin() {
    const addrEl = document.getElementById('premiumMailAddr');
    const inboxList = document.getElementById('premiumInboxList');
    const otpList = document.getElementById('premiumOtpList');

    if (addrEl) {
        addrEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:8px;"></i>loading...';
    }

    try {
        // Check if user already has an assigned premium email
        const userRes = await fetch(`/api/user/${userData.id}`);
        const userData2 = await userRes.json();

        if (userData2.success && userData2.user?.premiumEmailId) {
            // User has an assigned email, fetch its details
            const emailRes = await fetch(`/api/premium-emails/${userData2.user.premiumEmailId}`);
            const emailData = await emailRes.json();

            if (emailData.success) {
                assignedPremiumEmail = emailData.email;
                displayPremiumEmail(emailData.email);
                loadPremiumEmailMessages(userData2.user.premiumEmailId);
                return;
            }
        }

        // No assigned email, fetch available emails
        const res = await fetch('/api/premium-emails');
        const data = await res.json();

        if (!data.success || !data.emails || data.emails.length === 0) {
            if (addrEl) {
                addrEl.innerHTML = '<span style="color:#f87171;">No premium emails available</span>';
            }
            if (inboxList) {
                inboxList.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-envelope" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i><div style="font-size:12px;">No premium emails available. Please check back later.</div></div>`;
            }
            return;
        }

        // Show email selection or auto-assign first available
        const availableEmail = data.emails[0];

        // Try to assign this email to user
        const assignRes = await fetch('/api/premium-emails/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, emailId: availableEmail.id })
        });

        const assignData = await assignRes.json();

        if (assignData.success) {
            assignedPremiumEmail = assignData.email;
            displayPremiumEmail(assignData.email);
            loadPremiumEmailMessages(availableEmail.id);
            window.showToast('✅ Premium email assigned successfully!');
        } else {
            // Show available emails for selection
            displayPremiumEmailList(data.emails);
        }

    } catch (e) {
        console.error('Error loading premium emails:', e);
        if (addrEl) {
            addrEl.innerHTML = '<span style="color:#f87171;">Error loading emails</span>';
        }
    }
}

// Display assigned premium email
function displayPremiumEmail(email) {
    const addrEl = document.getElementById('premiumMailAddr');
    if (addrEl && email) {
        addrEl.textContent = email.email || email;
        addrEl.style.fontStyle = 'normal';
        addrEl.style.opacity = '1';
    }
}

// Display list of available premium emails for selection
function displayPremiumEmailList(emails) {
    const addrEl = document.getElementById('premiumMailAddr');
    const inboxList = document.getElementById('premiumInboxList');

    if (addrEl) {
        addrEl.innerHTML = '<span style="color:var(--text-sub);">Select an email</span>';
    }

    if (inboxList) {
        inboxList.innerHTML = emails.map(e => `
            <div style="padding:16px; border-bottom:1px solid var(--border-color); cursor:pointer;" onclick="selectPremiumEmail('${e.id}', '${e.email}')">
                <div style="font-size:14px; font-weight:600; color:var(--text-main); margin-bottom:4px;">${e.email}</div>
                <div style="font-size:11px; color:var(--text-sub);">${e.messageCount} messages</div>
            </div>
        `).join('');
    }
}

// Select and assign a premium email
async function selectPremiumEmail(emailId, emailAddress) {
    try {
        const res = await fetch('/api/premium-emails/assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userData.id, emailId: emailId })
        });

        const data = await res.json();

        if (data.success) {
            assignedPremiumEmail = data.email;
            displayPremiumEmail(data.email);
            loadPremiumEmailMessages(emailId);
            window.showToast('✅ Premium email assigned!');
        } else {
            window.showToast('❌ ' + (data.message || 'Failed to assign email'));
        }
    } catch (e) {
        window.showToast('❌ Error assigning email');
    }
}

// Load messages for assigned premium email
async function loadPremiumEmailMessages(emailId) {
    const inboxList = document.getElementById('premiumInboxList');
    const otpList = document.getElementById('premiumOtpList');

    if (!emailId) return;

    try {
        const res = await fetch(`/api/premium-emails/${emailId}/messages`);
        const data = await res.json();

        if (data.success && data.messages) {
            renderPremiumInbox(data.messages);
        } else {
            if (inboxList) {
                inboxList.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i><div style="font-size:12px;">No messages yet</div></div>`;
            }
            if (otpList) {
                otpList.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
            }
        }
    } catch (e) {
        console.error('Error loading messages:', e);
    }
}

// Render premium inbox messages
function renderPremiumInbox(messages) {
    const listEl = document.getElementById('premiumInboxList');
    const otpListEl = document.getElementById('premiumOtpList');

    if (!listEl) return;

    if (!messages || messages.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:40px; color:var(--text-sub);"><i class="fas fa-inbox" style="font-size:32px; margin-bottom:10px; opacity:0.3;"></i><div style="font-size:12px;">No messages yet</div></div>`;
        if (otpListEl) {
            otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
        }
        return;
    }

    // Extract OTPs
    let otps = [];
    const otpRegex = /\b\d{4,8}\b/g;
    const keywords = ["otp", "code", "verification", "verify", "login", "security"];

    messages.forEach(msg => {
        const combined = ((msg.subject || '') + " " + (msg.body || msg.preview || '')).toLowerCase();
        const hasKeyword = keywords.some(k => combined.includes(k));
        if (hasKeyword) {
            const matches = combined.match(otpRegex);
            if (matches) {
                matches.forEach(code => {
                    if (!otps.some(o => o.code === code)) {
                        otps.push({ code, from: msg.from || msg.sender || 'Unknown' });
                    }
                });
            }
        }
    });

    // Render OTP chips
    if (otpListEl) {
        if (otps.length > 0) {
            otpListEl.innerHTML = otps.map(o => `
                <div class="otp-chip" style="padding: 6px 12px; height: auto; min-height: 44px; display: flex; align-items: center; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 12px; margin-right: 8px; margin-bottom: 8px;">
                    <div style="flex:1;">
                        <div class="oc-code" style="font-size: 16px; font-weight: 800; color: var(--text-main); letter-spacing: 1px;">${o.code}</div>
                    </div>
                    <button class="oc-copy" onclick="copyOtpFromChip(this, '${o.code}')" 
                        style="width:32px; height:32px; border-radius:50%; background:#10b981; border:none; display:flex; align-items:center; justify-content:center; cursor:pointer; margin-left:10px; transition: all 0.2s; box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);">
                        <i class="fas fa-copy" style="color:#fff; font-size:12px;"></i>
                    </button>
                </div>
            `).join("");
        } else {
            otpListEl.innerHTML = `<div style="font-size:11px; color:var(--text-sub); padding:10px;">No OTP yet</div>`;
        }
    }

    // Render message list
    listEl.innerHTML = messages.map(msg => `
        <div class="inbox-item" onclick="openPremiumEmailMessage('${msg.id}')" style="display:grid; grid-template-columns:1fr 1fr 60px; padding:12px 16px; border-bottom:1px solid var(--border-color); cursor:pointer; align-items:center;">
            <div style="font-size:12px; color:var(--text-main); font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${msg.from || msg.sender || 'Unknown'}</div>
            <div style="font-size:12px; color:var(--text-sub); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${msg.subject || 'No Subject'}</div>
            <div style="text-align:center;">
                <i class="fas fa-eye" style="color:#f59e0b; font-size:14px;"></i>
            </div>
        </div>
    `).join('');

    window._premiumEmailMessages = messages;
}

// Open a premium email message
function openPremiumEmailMessage(msgId) {
    const messages = window._premiumEmailMessages || [];
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    document.getElementById("mdSubject").textContent = msg.subject || 'No Subject';
    document.getElementById("mdFrom").textContent = msg.from || msg.sender || "Unknown";
    document.getElementById("mdTo").textContent = assignedPremiumEmail?.email || "...";
    document.getElementById("mdDate").textContent = msg.time || msg.date || "Recent";
    document.getElementById("mdBody").innerHTML = msg.body || msg.preview || '';

    const content = (msg.subject || '') + " " + (msg.body || msg.preview || '');

    // Extract OTP
    const otpMatch = content.match(/\b\d{4,8}\b/);
    const urlRegex = /(https?:\/\/[^\s<>'"{}|\^`\[\]]+)/i;
    const urlMatch = content.match(urlRegex);

    const otpContainer = document.getElementById("mdOtpContainer");
    const linkContainer = document.getElementById("mdLinkContainer");

    if (otpMatch) {
        otpContainer.style.display = "block";
        document.getElementById("mdOtpCode").textContent = otpMatch[0];
    } else {
        otpContainer.style.display = "none";
    }

    if (urlMatch) {
        linkContainer.style.display = "block";
        document.getElementById("mdLinkUrl").textContent = urlMatch[0];
        document.getElementById("mdLinkUrl").href = urlMatch[0];
    } else {
        linkContainer.style.display = "none";
    }

    nav("emailMessage");
}

// Refresh premium email inbox
function refreshPremiumInbox() {
    if (assignedPremiumEmail && assignedPremiumEmail.id) {
        loadPremiumEmailMessages(assignedPremiumEmail.id);
        window.showToast('✅ Inbox refreshed');
    } else {
        loadPremiumEmailsFromAdmin();
    }
}

// Export new functions
window.loadPremiumEmailsFromAdmin = loadPremiumEmailsFromAdmin;
window.selectPremiumEmail = selectPremiumEmail;
window.loadPremiumEmailMessages = loadPremiumEmailMessages;
window.refreshPremiumInbox = refreshPremiumInbox;
window.openPremiumEmailMessage = openPremiumEmailMessage;

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
window.autoGeneratePremiumMail = autoGeneratePremiumMail;
window.generateDemoPremiumMail = generateDemoPremiumMail;
window.changeMailEmail = changeMailEmail;
window.cancelMail = cancelMail;
window.copyMailEmail = copyMailEmail;
window.refreshInbox = refreshInbox;
window.copyMailOtp = copyMailOtp;
window.updateMailBalance = updateMailBalance;

// REQUIRED CHANNELS/GROUPS CONFIG
const REQUIRED_JOINS = {
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

    const missingItems = [];
    if (!missing.channelJoined) missingItems.push(REQUIRED_JOINS.channel);
    if (!missing.groupJoined) missingItems.push(REQUIRED_JOINS.group);

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
            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
                ${missingItems.map(item => `
                    <a href="https://t.me/${item.username}" target="_blank" style="
                        background: linear-gradient(135deg, #f59e0b, #d97706);
                        color: #000;
                        padding: 14px 20px;
                        border-radius: 12px;
                        text-decoration: none;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                    ">
                        <span>Join ${item.name}</span>
                        <span style="font-size: 18px;">→</span>
                    </a>
                `).join('')}
            </div>
            <button onclick="verifyJoinsAndProceed()" style="
                background: linear-gradient(135deg, #22c55e, #16a34a);
                color: #fff;
                border: none;
                padding: 14px 30px;
                border-radius: 12px;
                font-weight: 600;
                font-size: 16px;
                cursor: pointer;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
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
        document.getElementById('joinRequiredModal').style.display = 'none';
        // Continue with normal initialization
        continueInitialization();
    } else {
        btn.innerHTML = '<span>✗ Not Joined Yet</span>';
        btn.style.background = '#ef4444';
        setTimeout(() => {
            btn.innerHTML = '<span>✓ I\'ve Joined</span>';
            btn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
            btn.disabled = false;
        }, 2000);
    }
}

// Continue with normal initialization after join check
function continueInitialization() {
    showPage('home');
    applyProfilePhoto(userData.photo_url || _tgUser.photo_url || '');
    renderBalances();
    registerAndFetchUser();
    loadBroadcast();
    fetchEmailServiceConfig();
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

document.addEventListener('DOMContentLoaded', async function () {
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

    // Load feature flags first to check if join required is enabled
    await loadFeatureFlags();

    // Check if Join Required feature is enabled (default OFF)
    const joinRequiredEnabled = featureFlags && featureFlags.joinRequired === true;

    if (!joinRequiredEnabled) {
        // Join check is disabled - proceed normally
        continueInitialization();
        return;
    }

    // Check if user joined required channel/group (MANDATORY only if enabled)
    const joinCheck = await checkRequiredJoins();

    if (!joinCheck.canProceed) {
        // Show join required modal - block access until joined
        showJoinRequiredModal(joinCheck);
        return; // Stop initialization until user joins
    }

    // User has joined - continue with normal initialization
    continueInitialization();
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
window.cancelNumber = cancelNumber;
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
window.copyNumOtp = copyNumOtp;
window.extractOtp = extractOtp;

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
            document.getElementById('itemSellFormContainer').style.display = 'none';
            document.getElementById('itemSellCategoryGrid').style.display = 'grid';
            document.getElementById('selItemCategory').value = '';
        }
    }

    updateSellRewardPreview();
}
window.setSellItemType = setSellItemType;



function selectSellCategory(cat, icon, gradient) {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');

    document.getElementById('selItemCategory').value = cat;
    document.getElementById('itemSellCategoryGrid').style.display = 'none';
    document.getElementById('itemSellFormContainer').style.display = 'block';

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

function resetSellCategory() {
    document.getElementById('itemSellCategoryGrid').style.display = 'grid';
    document.getElementById('itemSellFormContainer').style.display = 'none';
    document.getElementById('selItemCategory').value = '';

    // Reset all form fields
    const fields = ['selItemEmail', 'selItemPassword', 'selItemCustomName', 'apiServiceName', 'apiKeyValue', 'apiQuota', 'apiExtraInfo', 'sel2FAAuthCode', 'sel2FABackupCode', 'sel2FAAppCode', 'vpnName', 'vpnEmail', 'vpnPassword', 'vpnPlan', 'cardNumber', 'cardExpiry', 'cardCVV', 'cardHolder', 'cardCountry', 'cardBillingAddress', 'selItemCustomDuration', 'selItemRequestedPrice'];
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
        const cardNumber = document.getElementById('cardNumber')?.value.trim();
        const cardExpiry = document.getElementById('cardExpiry')?.value.trim();
        const cardCVV = document.getElementById('cardCVV')?.value.trim();
        const cardHolder = document.getElementById('cardHolder')?.value.trim();
        const cardCountry = document.getElementById('cardCountry')?.value.trim();
        if (!cardNumber || !cardExpiry || !cardCVV || !cardHolder || !cardCountry) {
            window.showToast('Please fill all required card fields');
            return;
        }
        payload.cardType = cardTypeInput.value;
        payload.cardNumber = cardNumber;
        payload.cardExpiry = cardExpiry;
        payload.cardCVV = cardCVV;
        payload.cardHolder = cardHolder;
        payload.cardCountry = cardCountry;
        payload.cardBillingAddress = document.getElementById('cardBillingAddress')?.value.trim() || '';
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
    const types = ['visa', 'mastercard', 'amex'];
    types.forEach(t => {
        const idMap = { 'visa': 'Visa', 'mastercard': 'MC', 'amex': 'Amex' };
        const el = document.getElementById('cardType' + idMap[t]);
        if (el) {
            if (t === type) {
                el.style.borderColor = '#8b5cf6';
                el.style.background = 'rgba(139,92,246,0.2)';
                el.style.color = '#fff';
            } else {
                el.style.borderColor = 'var(--border-color)';
                el.style.background = 'rgba(0,0,0,0.2)';
                el.style.color = 'var(--text-sub)';
            }
        }
    });
}
window.selectCardType = selectCardType;

function switchPremiumTab(tabStr) {
    const tabs = ['vpn', 'account'];
    tabs.forEach(t => {
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

    // Check quiz limit before starting
    const quizLimit = window.appCostConfig?.quizLimit || 5;
    const quizRecovery = window.appCostConfig?.quizRecoveryHours || 1;
    if (!checkActivityLimit('quiz', quizLimit, quizRecovery, 'Quiz')) {
        nav('earn');
        return;
    }

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

            // Increment quiz activity counter
            if (typeof userActivityTracker !== 'undefined') {
                userActivityTracker.increment('quiz');
            }

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
    const list = document.getElementById('quizLeaderboardList');
    if (!list) return;

    list.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">Loading...</div>';

    try {
        const res = await fetch('/api/quiz/leaderboard');
        const data = await res.json();

        if (data.success && data.leaderboard) {
            list.innerHTML = '';
            data.leaderboard.forEach((item, idx) => {
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.padding = '16px';
                row.style.borderBottom = '1px solid var(--border-color)';

                const rankColor = idx === 0 ? '#fbbf24' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#888';

                row.innerHTML = `
                    <div style="width:30px; font-weight:900; color:${rankColor};">#${idx + 1}</div>
                    <div style="width:40px; height:40px; border-radius:50%; background:rgba(255,255,255,0.05); margin:0 12px; overflow:hidden;">
                        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(item.name)}&background=random" style="width:100%; height:100%;">
                    </div>
                    <div style="flex:1;">
                        <div style="font-size:14px; font-weight:800; color:#fff;">${item.name}</div>
                        <div style="font-size:11px; color:var(--text-sub);">${item.correctCount} Correct Answers</div>
                    </div>
                    <div style="font-weight:900; color:#22c55e;">${item.points} TC</div>
                `;
                list.appendChild(row);
            });
        }
    } catch (e) {
        list.innerHTML = '<div style="padding:40px; text-align:center; color:#ef4444;">Failed to load leaderboard</div>';
    }
}

// =============================================
// SCRATCH CARD SYSTEM
// =============================================
let isScratchActive = false;

function initScratchCard() {
    const canvas = document.getElementById('scratchCanvas');
    const ctx = canvas.getContext('2d');
    const resultDiv = document.getElementById('scratchResult');
    const valueEl = document.getElementById('scratchValue');
    const newBtn = document.getElementById('newScratchBtn');

    if (!canvas) return;

    // Reset state
    isScratchActive = true;
    newBtn.style.display = 'none';

    // Reset result div - hide it and clear content
    if (resultDiv) {
        resultDiv.style.display = 'none';
        resultDiv.innerHTML = '';
        resultDiv.style.background = '';
    }

    canvas.style.display = 'block'; // Ensure canvas is visible
    canvas.style.opacity = '1'; // Ensure canvas is opaque

    // Set random reward
    const rewards = [1, 1, 1, 5, 5, 10];
    const reward = rewards[Math.floor(Math.random() * rewards.length)];
    valueEl.textContent = reward;

    // Fill with cover
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#C0C0C0'; // Silver
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

    let isDrawing = false;

    function scratch(e) {
        if (!isDrawing || !isScratchActive) return; // Only scratch if active

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const x = ((e.clientX || e.touches[0].clientX) - rect.left) * scaleX;
        const y = ((e.clientY || e.touches[0].clientY) - rect.top) * scaleY;

        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fill();

        checkScratchPercentage();
    }

    function checkScratchPercentage() {
        if (!isScratchActive) return;

        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] === 0) transparent++;
        }

        const percent = (transparent / (canvas.width * canvas.height)) * 100;

        if (percent > 65) { // If more than 65% scratched
            isScratchActive = false; // Deactivate scratching
            claimScratchReward(reward); // Call the new claim function
        }
    }

    canvas.onmousedown = (e) => { isDrawing = true; scratch(e); };
    canvas.ontouchstart = (e) => { isDrawing = true; scratch(e); };
    window.onmouseup = () => { isDrawing = false; };
    window.ontouchend = () => { isDrawing = false; };
    canvas.onmousemove = scratch;
    canvas.ontouchmove = scratch;
}

async function claimScratchReward(reward) {
    // 2s delay
    window.showToast('Claiming scratch reward...');
    await new Promise(r => setTimeout(r, 2000));

    setActionCooldown('scratch'); // Apply cooldown after delay

    const canvas = document.getElementById('scratchCanvas');
    const newBtn = document.getElementById('newScratchBtn');
    const resultDiv = document.getElementById('scratchResult');

    // Fade out canvas
    canvas.style.opacity = '0';
    setTimeout(() => { canvas.style.display = 'none'; }, 500);

    // Show the reward result prominently
    if (resultDiv) {
        resultDiv.style.display = 'flex';
        resultDiv.style.flexDirection = 'column';
        resultDiv.style.alignItems = 'center';
        resultDiv.style.justifyContent = 'center';
        resultDiv.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        resultDiv.style.borderRadius = '16px';
        resultDiv.style.padding = '20px';
        resultDiv.style.marginBottom = '16px';
        resultDiv.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 8px;">🎁</div>
            <div style="font-size: 24px; font-weight: bold; color: #fff;">+${reward} TOKENS</div>
            <div style="font-size: 14px; color: rgba(255,255,255,0.9); margin-top: 4px;">You Won!</div>
        `;
    }

    // Show the try again button
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

            // Increment scratch activity counter
            if (typeof userActivityTracker !== 'undefined') {
                userActivityTracker.increment('scratch');
            }
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
    // Check scratch limit before starting
    const scratchLimit = window.appCostConfig?.scratchLimit || 5;
    const scratchRecovery = window.appCostConfig?.scratchRecoveryHours || 1;
    if (typeof checkActivityLimit !== 'undefined' && !checkActivityLimit('scratch', scratchLimit, scratchRecovery, 'Scratch Card')) {
        return;
    }

    if (isActionOnCooldown('scratch', 5)) return; // Check cooldown before showing ad
    showAdAndEarn('scratch_ad');
}
window.startScratchFlow = startScratchFlow;
window.initScratchCard = initScratchCard;
