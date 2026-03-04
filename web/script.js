// ============================================
// TELEGRAM WEBAPP AUTO-LOGIN
// ============================================
var tg = window.Telegram?.WebApp || {
    initDataUnsafe: { user: null, start_param: '' },
    ready: () => { },
    expand: () => { },
    HapticFeedback: {
        impactOccurred: (s) => { },
        notificationOccurred: (s) => { }
    },
    showAlert: (msg) => alert(msg),
    showConfirm: (msg, cb) => cb(confirm(msg)),
    showPopup: (params, cb) => { const r = confirm(params.title + '\n' + params.message); if (cb && r) cb(params.buttons[0].id); },
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
var userData = {
    id: _tgUser.id || 0,
    username: _tgUser.first_name || _tgUser.username || 'User',
    firstName: _tgUser.first_name || '',
    lastName: _tgUser.last_name || '',
    photo_url: _tgUser.photo_url || '',
    tokens: 0,
    Gems: 0,
    usd: 0.00,
    verified: false,
    dailyStreak: 0,
    lastDailyClaim: 0,
    completedTasks: []
};

// Show profile photo immediately from Telegram data
function applyProfilePhoto(photoUrl) {
    const name = encodeURIComponent(userData.firstName || userData.username || 'U');
    const fallback = `https://ui-avatars.com/api/?name=${name}&background=fbbf24&color=000&size=80&bold=true&rounded=true`;
    const src = (photoUrl && photoUrl.trim()) ? photoUrl : fallback;

    // Target all possible avatar img elements
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
        tg.showAlert('Entering Admin Panel...');
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

    // Save current scroll position before navigating away
    try {
        const mainScroll = document.getElementById('mainScroll');
        if (mainScroll && currentPage) {
            pageScrollPositions[currentPage] = mainScroll.scrollTop;
        }
    } catch (e) { }

    // BAN CHECK (Moved to showPage for better centralization)
    if (userStatus === 'banned') {
        tg.showPopup({
            title: 'ACCOUNT BANNED',
            message: 'You have been banned by the admin.\nPlease contact support to resolve this issue.',
            buttons: [{ type: 'destructive', text: 'Contact Support', id: 'support' }, { type: 'close' }]
        }, (btn) => {
            if (btn === 'support') window.open('https://t.me/Onlin_Income_Support');
        });
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
};

function showPage(targetId) {
    if (!targetId) return;

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

    // Hide all pages
    document.querySelectorAll('.page').forEach(e => {
        e.classList.remove('active');
        e.style.display = 'none';
    });

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
        // TODO: Differentiate Email Service vs Temp Mail UI
    }
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
    }

    // Update current page tracker
    currentPage = targetId;

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
    // Update virtual number balance when entering the number service page
    if (targetId === 'numberService') {
        updateNumBalance();
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
        'geminiProduct', 'chatgptProduct', 'checkout', 'deposit',
        'exchange', 'binancePay', 'faucetPay', 'history', 'redeem',
        'invite', 'tasks', 'earn', 'daily', 'verify', 'admin',
        'geminiVerification', 'leaderboard', 'support', 'emailMessage'];

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
            headerTitle.textContent = PAGE_TITLES[normalizedId] || (title || targetId.toUpperCase());
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
        if (headerContainer) headerContainer.style.display = 'block'; // Ensure visible for others
        if (avatar) avatar.style.display = 'none';
        if (headerBack) {
            headerBack.style.display = 'flex';
            headerBack.innerHTML = '<i class="fas fa-arrow-left" style="color:#fff; font-size:16px;"></i>';
        }
        if (headerTitle) {
            headerTitle.textContent = title || targetId.toUpperCase();
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
        if (headerTitle) headerTitle.textContent = title || targetId.toUpperCase();
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
    else if (['profile', 'history', 'redeem', 'transfer', 'support', 'verify', 'geminiVerification', 'admin'].includes(targetId)) activeNavGroup = 'profile';

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

// EXCHANGE LOGIC
function exchangeTokens() {
    const fromCur = document.getElementById('exFromCurrency')?.value;
    const toCur = document.getElementById('exToCurrency')?.value;
    const amt = parseFloat(document.getElementById('exFromAmount')?.value || '0');

    if (!fromCur || !toCur) {
        tg.showAlert('Exchange UI not ready. Please reload.');
        return;
    }
    if (fromCur === toCur) {
        tg.showAlert('Please choose two different currencies.');
        return;
    }
    if (!isFinite(amt) || amt <= 0) {
        tg.showAlert('Please enter a valid amount.');
        return;
    }

    const preview = calculateExchange(fromCur, toCur, amt);
    if (!preview.success) {
        tg.showAlert(preview.message || 'Invalid exchange.');
        return;
    }

    if (!hasSufficientBalance(fromCur, amt)) {
        tg.showAlert('Insufficient balance.');
        return;
    }

    tg.showPopup({
        title: 'CONFIRM EXCHANGE',
        message: `${formatCurrencyAmount(amt, fromCur)}  ➜  ${formatCurrencyAmount(preview.toAmount, toCur)}\n\nRate: ${preview.rateText}`,
        buttons: [{ type: 'ok', id: 'ok', text: 'CONFIRM' }, { type: 'cancel', id: 'cancel' }]
    }, (btnId) => {
        if (btnId !== 'ok') return;

        fetch('/api/exchange/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userData.id,
                from: fromCur,
                to: toCur,
                amount: amt
            })
        })
            .then(r => r.json())
            .then(res => {
                if (!res.success) {
                    tg.showAlert(res.message || 'Exchange failed.');
                    return;
                }

                // Sync balances from response
                if (typeof res.tokens === 'number') userData.tokens = res.tokens;
                if (typeof res.Gems === 'number') userData.Gems = res.Gems;
                if (typeof res.usd === 'number') userData.usd = res.usd;
                renderBalances();
                updateExchangeBalances();
                updateExchangePreview();

                tg.showPopup({
                    title: '✅ EXCHANGE SUCCESSFUL',
                    message: `${formatCurrencyAmount(amt, fromCur)} ➜ ${formatCurrencyAmount(res.toAmount ?? preview.toAmount, toCur)}`,
                    buttons: [{ type: 'ok' }]
                });
            })
            .catch(() => {
                tg.showAlert('Network error. Please try again.');
            });
    });
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
        toEl.value = '0';
        rateEl.textContent = 'RATE: -';
        if (feeEl) feeEl.textContent = 'Choose different currencies.';
        return;
    }

    const maxVal = fromCur === 'tokens' ? (userData.tokens || 0) : fromCur === 'Gems' ? (userData.Gems || 0) : (userData.usd || 0);
    if (fromHint) fromHint.textContent = `MAX: ${fromCur === 'usd' ? '$' + (Math.round(maxVal * 100) / 100).toFixed(2) : maxVal}`;

    const preview = calculateExchange(fromCur, toCur, isFinite(amt) ? amt : 0);
    if (!preview.success) {
        toEl.value = '0';
        rateEl.textContent = 'RATE: -';
        if (feeEl) feeEl.textContent = preview.message || '';
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
}

// Swap FROM and TO currencies
function swapExchangeCurrencies() {
    const fromSel = document.getElementById('exFromCurrency');
    const toSel = document.getElementById('exToCurrency');
    const fromAmt = document.getElementById('exFromAmount');

    if (!fromSel || !toSel) return;

    // Swap values
    const temp = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = temp;

    // Clear amount
    if (fromAmt) fromAmt.value = '0';

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
    const binanceCard = document.getElementById('pm-binance');
    const faucetCard = document.getElementById('pm-faucet');
    const checkBinance = document.getElementById('check-binance');
    const checkFaucet = document.getElementById('check-faucet');
    const binanceSection = document.getElementById('payViaBinanceSection');
    const faucetSection = document.getElementById('payViaFaucetSection');

    if (method === 'binance') {
        binanceCard?.classList.add('selected');
        faucetCard?.classList.remove('selected');
        if (checkBinance) checkBinance.innerHTML = '<i class="fas fa-check" style="font-size:10px;"></i>';
        if (checkFaucet) checkFaucet.innerHTML = '';
        if (binanceSection) binanceSection.style.display = 'block';
        if (faucetSection) faucetSection.style.display = 'none';
    } else {
        faucetCard?.classList.add('selected');
        binanceCard?.classList.remove('selected');
        if (checkFaucet) checkFaucet.innerHTML = '<i class="fas fa-check" style="font-size:10px;"></i>';
        if (checkBinance) checkBinance.innerHTML = '';
        if (faucetSection) faucetSection.style.display = 'block';
        if (binanceSection) binanceSection.style.display = 'none';
    }
}

function submitPayment() {
    const txnId = document.getElementById('txnIdInput')?.value || document.getElementById('fpTxnIdInput')?.value;
    if (!txnId || txnId.trim() === '') {
        tg.showAlert('Please enter your Transaction ID to confirm payment.');
        return;
    }
    tg.showPopup({
        title: 'Payment Submitted!',
        message: `Your payment has been submitted for review.\n\nTransaction ID: ${txnId}\n\nWe will verify and credit your account within 24 hours.`,
        buttons: [{ type: 'ok', id: 'ok' }]
    });
}

// TASK LOGIC
const IN_PROGRESS_TASKS = {};

function earn(buttonElement, type, amount) {
    if (IN_PROGRESS_TASKS[type] === 'completed') {
        tg.showAlert('You have already completed this task!');
        return;
    }

    if (IN_PROGRESS_TASKS[type] === 'claiming') {
        // User clicked CLAIM
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

                    // Update local balance
                    userData.tokens = data.newBalance || (userData.tokens + amount);
                    updateBalanceUI();

                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

                    // FIREWORKS ANIMATION (Bajimata Effect)
                    var duration = 5 * 1000;
                    var animationEnd = Date.now() + duration;
                    var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 99999 };

                    function randomInRange(min, max) {
                        return Math.random() * (max - min) + min;
                    }

                    var interval = setInterval(function () {
                        var timeLeft = animationEnd - Date.now();
                        if (timeLeft <= 0) {
                            return clearInterval(interval);
                        }
                        var particleCount = 50 * (timeLeft / duration);
                        if (typeof confetti !== 'undefined') {
                            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
                            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
                        }
                    }, 250);

                    tg.showPopup({
                        title: 'MISSION COMPLETE!',
                        message: `You earned +${amount} Tokens!\nAwesome work!`,
                        buttons: [{ type: 'ok' }]
                    });
                } else {
                    tg.showAlert(data.message || 'Error completing task.');
                    IN_PROGRESS_TASKS[type] = null; // reset
                    buttonElement.innerHTML = 'CLAIM';
                }
            })
            .catch(err => {
                tg.showAlert('Error verifying task.');
                IN_PROGRESS_TASKS[type] = null; // reset
                buttonElement.innerHTML = 'CLAIM';
            });
        return;
    }

    if (IN_PROGRESS_TASKS[type]) {
        return; // Already started
    }

    tg.showConfirm('Start this mission?', (ok) => {
        if (ok) {
            // Open Link
            if (type === 'yt') window.open('https://youtube.com/@MamunIslamyts');
            else if (type === 'tg') window.open('https://t.me/AutosVerifych');
            else if (type === 'tg_ch') window.open('https://t.me/AutosVerify');

            // Start 30s Countdown
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
                    IN_PROGRESS_TASKS[type] = 'claiming';
                    buttonElement.style.pointerEvents = 'auto';
                    buttonElement.style.background = '#22c55e'; // Green claim button
                    buttonElement.style.color = '#fff';
                    buttonElement.innerHTML = 'CLAIM';
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                } else {
                    buttonElement.innerHTML = `${timeLeft}s...`;
                }
            }, 1000);
        }
    });
}

// ==========================================
// ==========================================
// AD VIEWER (Watch & Earn)
// ==========================================

let adWatchTimer = null;
let adRewardClaimed = false;

function showAdAndEarn() {
    const modal = document.getElementById('adViewerModal');
    if (!modal) return;
    modal.style.display = 'flex';
    adRewardClaimed = false;

    const container = document.getElementById('adContainer');
    const loadingMsg = document.getElementById('adLoadingMsg');
    const timerText = document.getElementById('adTimerText');
    const claimBtn = document.getElementById('adClaimBtn');
    const closeBtn = document.getElementById('adCloseBtn');

    claimBtn.style.display = 'none';
    closeBtn.style.display = 'none';
    timerText.textContent = '';
    container.innerHTML = '<div id="adLoadingMsg" style="color:#888; font-size:13px; text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin" style="font-size:24px; color:#f59e0b; display:block; margin-bottom:8px;"></i>Loading Ad...</div>';

    // Fetch ad config from server
    fetch('/api/ads/config')
        .then(r => r.json())
        .then(data => {
            const ads = data.ads || {};
            let adInjected = false;

            // Priority: moneytag > adsense > adsterra
            if (!adInjected && ads.moneytag && ads.moneytag.publisherId) {
                adInjected = true;
                const cfg = ads.moneytag;
                container.innerHTML = '';
                // MoneyTag interstitial via invoke endpoint
                const script = document.createElement('script');
                script.innerHTML = `(function(d,z,s){s.src='https://'+d+'/401/'+z;try{(document.body||document.documentElement).appendChild(s)}catch(e){}})('glizauvo.net', '${cfg.adUnitId || cfg.publisherId}', document.createElement('script'))`;
                container.innerHTML = '<div style="padding:16px; color:#888; font-size:12px; text-align:center;">Ad loading... Please wait.</div>';
                document.body.appendChild(script);
            }

            if (!adInjected && ads.adsense && ads.adsense.publisherId) {
                adInjected = true;
                const cfg = ads.adsense;
                container.innerHTML = `
                    <ins class="adsbygoogle"
                        style="display:block; width:100%; min-height:90px;"
                        data-ad-client="${cfg.publisherId}"
                        data-ad-slot="${cfg.adUnitId}"></ins>`;
                const adScript = document.createElement('script');
                adScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.publisherId}`;
                adScript.crossOrigin = 'anonymous';
                adScript.async = true;
                document.head.appendChild(adScript);
                setTimeout(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { } }, 500);
            }

            if (!adInjected && ads.adsterra && ads.adsterra.publisherId) {
                adInjected = true;
                const cfg = ads.adsterra;
                container.innerHTML = `<div style="padding:16px; text-align:center; color:#888; font-size:12px;">Ad loading...</div>`;
                const atScript = document.createElement('script');
                atScript.async = true;
                atScript.setAttribute('data-cfasync', 'false');
                atScript.src = `//pl${cfg.adUnitId}.profitableratecpm.com/${cfg.publisherId}/invoke.js`;
                container.innerHTML = '';
                container.appendChild(atScript);
            }

            if (!adInjected) {
                // No ad configured — show placeholder
                container.innerHTML = `<div style="padding:30px; text-align:center; color:#888; font-size:13px;">
                    <i class="fas fa-tv" style="font-size:36px; color:#444; display:block; margin-bottom:10px;"></i>
                    No ads configured yet.<br>Admin needs to set up an ad network.
                </div>`;
            }

            // Start 30s countdown regardless
            let timeLeft = 30;
            timerText.textContent = `⏱ Please wait ${timeLeft}s...`;
            clearInterval(adWatchTimer);
            adWatchTimer = setInterval(() => {
                timeLeft--;
                if (timeLeft > 0) {
                    timerText.textContent = `⏱ Please wait ${timeLeft}s...`;
                } else {
                    clearInterval(adWatchTimer);
                    timerText.textContent = '✅ Ad watched! Claim your reward.';
                    claimBtn.style.display = 'block';
                    closeBtn.style.display = 'block';
                }
            }, 1000);
        })
        .catch(() => {
            container.innerHTML = '<div style="color:#f87171; text-align:center; padding:20px;">Failed to load ad. Please try again.</div>';
            closeBtn.style.display = 'block';
        });
}

function closeAdModal() {
    const modal = document.getElementById('adViewerModal');
    if (modal) modal.style.display = 'none';
    clearInterval(adWatchTimer);
}

function claimAdReward() {
    if (adRewardClaimed) return;
    adRewardClaimed = true;
    const claimBtn = document.getElementById('adClaimBtn');
    if (claimBtn) { claimBtn.disabled = true; claimBtn.textContent = 'Claiming...'; }

    fetch('/api/earn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId, type: 'watch_ad' })
    })
        .then(r => r.json())
        .then(data => {
            closeAdModal();
            if (data.success) {
                if (window.confetti) confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
                tg.showAlert(`🎉 +${data.reward} tokens earned! Keep watching to earn more.`);
                userData.tokens = (userData.tokens || 0) + (data.reward || 0);
                updateBalanceUI();
            } else {
                tg.showAlert(data.message || 'Could not claim reward. Try again later.');
                adRewardClaimed = false;
            }
        })
        .catch(() => {
            closeAdModal();
            tg.showAlert('Network error. Please try again.');
            adRewardClaimed = false;
        });
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

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CLAIMING...';
    btn.disabled = true;

    fetch('/api/daily/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

                // FIREWORKS ANIMATION (Bajimata Effect)
                var duration = 5 * 1000;
                var animationEnd = Date.now() + duration;
                var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 99999 };

                function randomInRange(min, max) {
                    return Math.random() * (max - min) + min;
                }

                var interval = setInterval(function () {
                    var timeLeft = animationEnd - Date.now();

                    if (timeLeft <= 0) {
                        return clearInterval(interval);
                    }

                    var particleCount = 50 * (timeLeft / duration);
                    // since particles fall down, start a bit higher than random
                    if (typeof confetti !== 'undefined') {
                        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
                        confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
                    }
                }, 250);

                tg.showPopup({
                    title: 'BONUS CLAIMED!',
                    message: `You received +${data.reward} Tokens!\nCome back in 24 hours for more.`,
                    buttons: [{ type: 'ok' }]
                });
                userData.lastDailyClaim = Date.now();
                userData.dailyStreak = data.newStreak;
                userData.tokens = data.newBalance;
                renderBalances();
                renderDailyGrid();
                startDailyCountdown();
            } else {
                tg.showAlert('❌ ' + (data.msg || 'Already claimed today!'));
                btn.innerHTML = 'ALREADY CLAIMED';
            }
        })
        .catch(e => {
            btn.innerHTML = 'CLAIM REWARD';
            btn.disabled = false;
            tg.showAlert('Network error. Check connection.');
        });
}

// ==========================================
// LEADERBOARD SYSTEM (PREMIUM)
// ==========================================

function renderLeaderboard() {
    const list = document.getElementById('leadList');
    if (!list) return;

    fetch(`/api/leaderboard?userId=${userData.id}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.top) {
                list.innerHTML = '<div style="text-align:center; padding:20px; color:#666;">No rankings available.</div>';
                return;
            }

            list.innerHTML = data.top.map((u, i) => {
                const rank = i + 1;
                let rankClass = 'rank-other';
                if (rank === 1) rankClass = 'rank-1';
                else if (rank === 2) rankClass = 'rank-2';
                else if (rank === 3) rankClass = 'rank-3';

                return `
            <div class="lead-row">
                <div class="lead-rank ${rankClass}">${rank}</div>
                <div class="lead-avatar">
                   <img src="${u.photo_url || `https://ui-avatars.com/api/?name=${u.name}&background=random`}" style="width:100%; height:100%; object-fit:cover;">
                </div>
                <div class="lead-info">
                    <div class="lead-name">${u.name}</div>
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

// RENDER REFERRAL HISTORY
function renderReferralHistory() {
    const container = document.getElementById('refHistoryList');
    if (!container) return;

    // Mock Data
    const history = [
        { name: 'Alice Wonderland', date: 'Today, 10:30 AM', status: 'Active', reward: '+10' },
        { name: 'Bob Builder', date: 'Yesterday, 05:45 PM', status: 'Pending', reward: '0' },
        { name: 'Charlie Chaplin', date: 'Feb 12, 09:00 AM', status: 'Active', reward: '+10' }
    ];

    container.innerHTML = history.map(h => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border-color)">
            <div style="display:flex; gap:10px; align-items:center">
                <div style="width:32px; height:32px; background:#333; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700">
                    ${h.name.charAt(0)}
                </div>
                <div>
                    <div style="font-size:13px; font-weight:700; color:var(--text-main)">${h.name}</div>
                    <div style="font-size:10px; color:var(--text-sub)">${h.date}</div>
                </div>
            </div>
            <div style="text-align:right">
                <div style="font-size:10px; color:${h.status === 'Active' ? '#22c55e' : '#f59e0b'}">${h.status}</div>
                <div style="font-size:12px; font-weight:800; color:var(--text-main)">${h.reward} T</div>
            </div>
        </div>
    `).join('');
}

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
window.selectPayMethod = selectPayMethod;
window.submitPayment = submitPayment;
window.payWithBalance = payWithBalance;
window.selectPM = selectPM;

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
    if (!userId || userId === 0) {
        // No Telegram user (opened in browser, not Telegram)
        renderBalances();
        applyProfilePhoto('');
        return;
    }

    // Parse referrer from start_param (e.g. ref_123456789)
    let referrer = null;
    if (_startParam && _startParam.startsWith('ref_')) {
        referrer = _startParam.replace('ref_', '');
    }

    fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: userId,
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
                // Sync from server
                userData.tokens = data.tokens || 0;
                userData.Gems = data.Gems || 0;
                userData.usd = data.usd || (data.tokens / 100);
                userData.verified = data.verified || false;
                userData.dailyStreak = data.dailyStreak || 0;
                userData.lastDailyClaim = data.lastClaim || 0;
                userData.completedTasks = data.completedTasks || [];
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

function saveWallet() { renderBalances(); }

function updateBalanceUI() { renderBalances(); }

function renderBalances() {
    const displayName = userData.firstName || userData.username || _tgUser.first_name || 'Guest';

    // 1. Update Profile Stats
    const elTc = document.getElementById('prof-tc');
    const elJs = document.getElementById('prof-js');
    const elUsd = document.getElementById('prof-usd');
    const elProfName = document.getElementById('prof-name');
    const elProfId = document.getElementById('prof-id');

    if (elTc) elTc.innerText = (userData.tokens || 0).toLocaleString();
    if (elJs) elJs.innerText = (userData.Gems || 0).toLocaleString();
    if (elUsd) elUsd.innerText = '$' + ((userData.tokens || 0) / 100).toFixed(2);
    if (elProfName) elProfName.innerText = displayName;
    if (elProfId) elProfId.innerText = '#' + userData.id;

    // 2. Update Home Page Stats
    const hTc = document.getElementById('home-tc');
    const hJs = document.getElementById('home-js');
    const hName = document.getElementById('home-name');

    if (hTc) hTc.innerText = (userData.tokens || 0).toLocaleString();
    if (hJs) hJs.innerText = (userData.Gems || 0).toLocaleString();
    if (hName) hName.innerText = displayName;
}



function payWithBalance() {
    if (userData.usd >= 3.00) {
        tg.showConfirm('Pay $3.00 from your balance for Gemini 1 Year?', (ok) => {
            if (ok) {
                tg.showAlert('Purchase request sent to server!');
            }
        });
    } else {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
        tg.showAlert('Insufficient Balance ($' + userData.usd.toFixed(2) + '). Please deposit funds.');
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
                renderShopItems();
            }
        });
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
    if (!grid) return;
    const items = getShopItems();
    grid.innerHTML = items.map(item => {
        const imgHtml = item.imageUrl
            ? `<img src="${item.imageUrl}" style="width:70px; height:auto; object-fit:contain;" onerror="this.style.display='none'">`
            : `<i class="fas fa-box" style="font-size:36px; color:#f59e0b;"></i>`;
        return `
        <div onclick="nav('${item.page || 'deposit'}')"
            style="background:var(--bg-card); border-radius:20px; overflow:hidden; border:1px solid var(--border-color); cursor:pointer; transition:0.2s;"
            onmousedown="this.style.transform='scale(0.97)'" onmouseup="this.style.transform='scale(1)'">
            <div style="background:${item.bgColor || '#0d0d0d'}; padding:20px; display:flex; align-items:center; justify-content:center; min-height:110px;">
                ${imgHtml}
            </div>
            <div style="padding:12px;">
                <div style="font-size:11px; font-weight:700; color:var(--text-main); margin-bottom:4px;">${item.name}</div>
                <div style="font-size:16px; font-weight:800; color:#22c55e; margin-bottom:10px;">${item.price}</div>
                <div style="background:rgba(245,158,11,0.1); border:1px solid ${item.btnColor || '#f59e0b'}; border-radius:10px; padding:8px; text-align:center; font-size:11px; font-weight:700; color:${item.btnColor || '#f59e0b'}; display:flex; align-items:center; justify-content:center; gap:6px;">
                    <i class="fas fa-shopping-cart"></i> BUY
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderCards() {
    const container = document.getElementById('cardsList');
    if (!container) return;
    const cards = JSON.parse(localStorage.getItem('adminCards') || '[]');
    container.innerHTML = cards.map(c => `
        <div class="glass-card p-4 rounded-xl flex items-center gap-4" style="background:var(--bg-card); border:1px solid var(--border-color);">
            <div style="width:48px; height:48px; border-radius:12px; background:rgba(251,191,36,0.1); display:flex; align-items:center; justify-content:center; color:#fbbf24; font-size:24px;">
                <i class="fas fa-credit-card"></i>
            </div>
            <div style="flex:1;">
                <div style="font-weight:700; color:var(--text-main);">${c.name}</div>
                <div style="font-size:11px; color:var(--text-sub);">Stock: ${c.count}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:800; color:#22c55e;">${c.price} TC</div>
                <button onclick="buyAccount('card', ${c.price}, '${c.id}')" style="margin-top:4px; padding:4px 12px; border-radius:8px; background:#fbbf24; color:#000; font-weight:700; font-size:10px; border:none;">BUY</button>
            </div>
        </div>`).join('');
}

function renderVPN() {
    const container = document.getElementById('vpnList');
    if (!container) return;
    const vpns = JSON.parse(localStorage.getItem('adminVPNs') || '[]');
    container.innerHTML = vpns.map(v => `
        <div class="glass-card p-4 rounded-xl flex items-center gap-4" style="background:var(--bg-card); border:1px solid var(--border-color);">
            <div style="width:48px; height:48px; border-radius:12px; background:rgba(59,130,246,0.1); display:flex; align-items:center; justify-content:center; color:#3b82f6; font-size:24px;">
                <i class="fas fa-shield-alt"></i>
            </div>
            <div style="flex:1;">
                <div style="font-weight:700; color:var(--text-main);">${v.name}</div>
                <div style="font-size:11px; color:var(--text-sub);">Locations: Premium</div>
            </div>
            <div style="text-align:right;">
                <div style="font-weight:800; color:#22c55e;">${v.price} TC</div>
                <button onclick="buyAccount('vpn', ${v.price}, '${v.id}')" style="margin-top:4px; padding:4px 12px; border-radius:8px; background:#3b82f6; color:#fff; font-weight:700; font-size:10px; border:none;">BUY</button>
            </div>
        </div>`).join('');
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
        alert('Please login first.');
        return;
    }

    const userTokens = userData.tokens || 0;
    if (userTokens < price) {
        alert(`Insufficient tokens! You have ${userTokens} TC but need ${price} TC.`);
        return;
    }

    if (!confirm(`Buy ${type} account for ${price} TC?`)) return;

    fetch('/api/accounts/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, accountId })
    })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                userData.tokens = res.newBalance;
                updateBalanceDisplay();

                // Show account details
                alert(`✅ Account purchased!\n\nEmail: ${res.account.email}\nPassword: ${res.account.password}${res.account.instructions ? '\nNotes: ' + res.account.instructions : ''}\n\nPlease save these details!`);

                renderAccounts(); // Refresh
            } else {
                alert(res.message || 'Purchase failed');
            }
        })
        .catch(() => alert('Network error'));
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

    const userTokens = userData.tokens || 0;
    if (userTokens < cat.price) {
        tg.showAlert(`Insufficient tokens! You have ${userTokens} TC but need ${cat.price} TC.`);
        return;
    }

    tg.showConfirm(`Buy ${cat.name} for ${cat.price} Tokens?`, (ok) => {
        if (!ok) return;

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
                    tg.showAlert(data.message || 'Purchase failed.');
                    if (btn) {
                        btn.innerHTML = `<i class="fas fa-shopping-cart"></i> BUY FOR ${cat.price} TOKENS`;
                        btn.style.pointerEvents = 'auto';
                    }
                }
            })
            .catch(() => {
                tg.showAlert('Network error. Please try again.');
                if (btn) {
                    btn.innerHTML = `<i class="fas fa-shopping-cart"></i> BUY FOR ${cat.price} TOKENS`;
                    btn.style.pointerEvents = 'auto';
                }
            });
    });
}
window.buyAccountFromCategory = buyAccountFromCategory;

function copyAccCred(type) {
    const el = type === 'email' ? document.getElementById('accEmailText') : document.getElementById('accPassText');
    if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            tg.showAlert(`${type === 'email' ? 'Email' : 'Password'} copied!`);
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        }).catch(() => {
            tg.showAlert('Copy failed. Please copy manually.');
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

    if ((userData.tokens || 0) < cost) {
        tg.showAlert(`Insufficient tokens! You need ${cost} TC to use ${name}.`);
        return;
    }

    tg.showPopup({
        title: `Generate ${name}`,
        message: `This will cost ${cost} TC from your balance.\n\nProceed?`,
        buttons: [
            { type: 'ok', id: 'confirm', text: 'GENERATE' },
            { type: 'cancel', id: 'cancel' }
        ]
    }, (btnId) => {
        if (btnId === 'confirm') {
            userData.tokens -= cost;
            renderBalances();
            tg.showAlert(` ${name} generated successfully!\n\nYour balance: ${userData.tokens} TC`);
        }
    });
}

// =============================================
// NUMBER SERVICE
// =============================================
let currentNumSession = null;
let numOtpPollInterval = null;
let selectedNumPlatform = 'telegram';

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
    if (el) el.textContent = (userData.tokens || 0) + ' TC';
}

function generateVirtualNumber() {
    const cost = 15;
    if ((userData.tokens || 0) < cost) {
        tg.showAlert(`❌ Insufficient tokens!\n\nYou need ${cost} TC.\nYour balance: ${userData.tokens || 0} TC`);
        return;
    }
    tg.showPopup({
        title: '📱 Get Virtual Number',
        message: `Platform: ${selectedNumPlatform.toUpperCase()}\nCost: ${cost} TC\n\nProceed?`,
        buttons: [{ type: 'ok', id: 'ok', text: 'GET NUMBER' }, { type: 'cancel' }]
    }, (btnId) => {
        if (btnId !== 'ok') return;
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
                    tg.showAlert('❌ ' + (data.message || 'Failed to get number. Try again.'));
                }
            })
            .catch(() => {
                if (btn) { btn.innerHTML = '<i class="fas fa-phone-alt"></i> GET VIRTUAL NUMBER'; btn.disabled = false; }
                tg.showAlert('❌ Network error. Please try again.');
            });
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
                        <div id="emailServiceCard" onclick="openPremiumMailDirect()" style="font-size:11px; color:#22c55e; font-weight:700; margin-top:10px; text-transform:uppercase;">EXTRACTED CODE ✅</div>
                    </div>`;
                }
            }
        }).catch(() => { });
}

function copyNumOtp(otp) {
    if (!otp) return;
    navigator.clipboard.writeText(otp).then(() => {
        tg.showPopup({ message: 'OTP Copied: ' + otp });
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

function copyText(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
        tg.showAlert('✅ Copied to clipboard!');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = el.textContent;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        tg.showAlert('✅ Copied!');
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
    const tokens = (typeof userData !== "undefined" && userData.tokens) ? userData.tokens : 0;
    const balEl = document.getElementById(type + "MailBalance");
    if (balEl) balEl.textContent = tokens + " TC";

    const noActive = document.getElementById(type + "MailNoActive");
    const activeState = document.getElementById(type + "MailActive");

    if (mailSessions[type]) {
        // Session active - show email address
        if (noActive) noActive.style.display = "none";
        if (activeState) activeState.style.display = "block";
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) addrEl.textContent = mailSessions[type].email;
    } else {
        // No session yet - still show the page with placeholder text
        if (noActive) noActive.style.display = "none"; // hide noActive (we use inline placeholder instead)
        if (activeState) activeState.style.display = "block"; // ALWAYS show the mail page
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) addrEl.textContent = "Tap 'NEW GMAIL' to generate";
    }
}

function generateTempMail(type) {
    if (!type) type = 'temp';
    const cost = type === "temp" ? 10 : 50;
    if ((userData.tokens || 0) < cost) {
        tg.showAlert(`❌ Insufficient tokens!\n\nYou need ${cost} TC.\nYour balance: ${userData.tokens || 0} TC`);
        return;
    }

    const performGenerate = () => {
        fetch("/api/mail/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: userData.id, cost, type })
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    userData.tokens -= cost;
                    renderBalances();
                    if (mailSessions[type]) {
                        previousMailSessions[type] = mailSessions[type];
                    }
                    mailSessions[type] = data;
                    updateMailBalance(type);
                    startInboxPolling(type);
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                } else {
                    tg.showAlert("❌ " + (data.message || "Failed. Try again."));
                }
            })
            .catch(() => {
                tg.showAlert("❌ Server connection error. Please try again in a few moments.");
            });
    };

    performGenerate();
}

function renewTempMail(type) {
    if (!type) type = 'temp';
    if (!previousMailSessions[type]) {
        tg.showAlert(`❌ No previous ${type} session found to restore.`);
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
    tg.showConfirm(`Delete current ${type} address? Previous inbox will be lost.`, (ok) => {
        if (ok) {
            mailSessions[type] = null;
            updateMailBalance(type);
        }
    });
}

function refreshInbox(type) {
    if (!type) type = window._currentMailType || 'temp';
    if (!mailSessions[type]) return;

    const listEl = document.getElementById(type + "InboxList");
    const refreshIcon = document.getElementById(type + "RefreshIcon");
    if (refreshIcon) refreshIcon.classList.add("fa-spin");

    const sessionId = mailSessions[type].id || mailSessions[type].sessionId;
    fetch(`/api/mail/inbox?sessionId=${sessionId}&userId=${userData.id}`)
        .then(r => r.json())
        .then(data => {
            if (refreshIcon) refreshIcon.classList.remove("fa-spin");
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
                        otps.push({ code, from: email.sender });
                    }
                });
            }
        }
    });

    // Render OTP chips
    if (otpListEl) {
        if (otps.length > 0) {
            otpListEl.innerHTML = otps.map(o => `
                <div class="otp-chip">
                    <span class="oc-code">${o.code}</span>
                    <button class="oc-copy" onclick="copyText('${o.code}')">COPY</button>
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
                    <div class="ii-sender">${email.sender}</div>
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
    document.getElementById("mdFrom").textContent = msg.sender;
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
                        btn.style.background = '#10b981';
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
    tg.showAlert('✅ Copied!');
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

// Fetch config on load
fetchEmailServiceConfig();
// Refresh config periodically
setInterval(fetchEmailServiceConfig, 60000);

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
        tg.showAlert('Please enter your Transaction ID to confirm payment.');
        return;
    }

    tg.showAlert('✅ Payment submitted!\n\nWe will verify your transaction and deliver your order shortly.');
    nav('home');
}

// Export checkout functions
window.updateCheckoutQty = updateCheckoutQty;
window.selectCheckoutPM = selectCheckoutPM;
window.submitCheckoutPayment = submitCheckoutPayment;

// Export Email Functions
function openTempMailDirect() {
    nav('mailService');
    if (!mailSessions.temp) {
        setTimeout(() => {
            autoGenerateTempMail();
        }, 300);
    }
}

function autoGenerateTempMail() {
    const type = 'temp';
    const cost = 10;
    if ((userData.tokens || 0) < cost) {
        return;
    }
    fetch("/api/mail/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userData.id, cost, type })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                userData.tokens -= cost;
                renderBalances();
                mailSessions[type] = data;
                updateMailBalance(type);
                refreshInbox(type);
            } else {
                generateDemoTempMail(type, cost);
            }
        })
        .catch(() => {
            generateDemoTempMail(type, cost);
        });
}

function generateDemoTempMail(type, cost) {
    const domains = type === "temp" ? ["tempmail.dev", "mailnull.com"] : ["premium-inbox.com", "private-mail.net"];
    const email = "user" + Math.floor(Math.random() * 99999) + "@" + domains[Math.floor(Math.random() * domains.length)];
    mailSessions[type] = { email, id: "demo_" + Date.now(), type, sessionId: "demo_" + Date.now() };
    userData.tokens -= cost;
    renderBalances();
    updateMailBalance(type);
    refreshInbox(type);
}

function openPremiumMailDirect() {
    nav('premiumMail');
    if (!mailSessions.premium) {
        setTimeout(() => {
            autoGeneratePremiumMail();
        }, 300);
    }
}

function autoGeneratePremiumMail() {
    const type = 'premium';
    const cost = 50;
    // If user has enough tokens, try real API first
    if ((userData.tokens || 0) >= cost) {
        fetch("/api/mail/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: userData.id, cost, type })
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    userData.tokens -= cost;
                    renderBalances();
                    mailSessions[type] = data;
                    updateMailBalance(type);
                    refreshInbox(type);
                } else {
                    generateDemoPremiumMail(type, 0);
                }
            })
            .catch(() => {
                generateDemoPremiumMail(type, 0);
            });
    } else {
        // Not enough tokens - generate demo email (free preview)
        generateDemoPremiumMail(type, 0);
    }
}

function generateDemoPremiumMail(type, cost) {
    const domains = ["premium-inbox.com", "private-mail.net"];
    const email = "user" + Math.floor(Math.random() * 99999) + "@" + domains[Math.floor(Math.random() * domains.length)];
    mailSessions[type] = { email, id: "demo_" + Date.now(), type, sessionId: "demo_" + Date.now() };
    userData.tokens -= cost;
    renderBalances();
    updateMailBalance(type);
    refreshInbox(type);
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

document.addEventListener('DOMContentLoaded', function () {
    showPage('home');
    // Apply Telegram photo immediately before server responds
    applyProfilePhoto(_tgUser.photo_url || '');
    renderBalances();
    // Auto-login from Telegram WebApp data
    registerAndFetchUser();
    // Fetch other configs
    fetchEmailServiceConfig();
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
});

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
