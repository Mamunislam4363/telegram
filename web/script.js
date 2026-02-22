// Telegram WebApp Safe Init
var tg = window.Telegram?.WebApp || {
    initDataUnsafe: {
        user: {
            first_name: 'Test',
            last_name: 'User',
            id: 999999999,
            username: 'test_user',
            photo_url: ''
        }
    },
    ready: () => console.log('TG Ready'),
    expand: () => console.log('TG Expand'),
    HapticFeedback: {
        impactOccurred: (s) => console.log('Haptic:', s),
        notificationOccurred: (s) => console.log('Haptic Notif:', s)
    },
    showAlert: (msg) => alert(msg),
    showConfirm: (msg, cb) => cb(confirm(msg)),
    showPopup: (params, cb) => { const r = confirm(params.title + '\n' + params.message); if (cb && r) cb(params.buttons[0].id); },
    BackButton: { show: () => { }, hide: () => { }, onClick: () => { } },
    close: () => console.log('TG Close')
};
tg.ready();
tg.expand();

// APP CONFIG (Admin Control Simulation)
var appConfig = {
    dailyReward: parseInt(localStorage.getItem('adm_daily') || '100'),
    dailyGems: parseInt(localStorage.getItem('adm_daily_gems') || '0'),
    inviteBonus: parseInt(localStorage.getItem('adm_invite_bonus') || '10'),
    inviteGems: parseInt(localStorage.getItem('adm_invite_gems') || '0'),
    welcomeBonus: parseInt(localStorage.getItem('adm_welcome') || '500')
};

// EMAIL SERVICE CONFIG
var emailServiceConfig = {
    emailServiceEnabled: true,
    tempMailEnabled: true
};

// DEMO MODE - Set to true for testing with demo balance
const DEMO_MODE = true;
const DEMO_BALANCE = 100000000000000;

// Fetch email service config from server
function fetchEmailServiceConfig() {
    fetch('/api/admin/email-services')
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                emailServiceConfig.emailServiceEnabled = data.emailServiceEnabled !== false;
                emailServiceConfig.tempMailEnabled = data.tempMailEnabled !== false;
            }
        })
        .catch(() => {
            // Use defaults if server error
            console.log('Using default email service config');
        });
}

var currentPage = 'home';

var historyStack = ['home'];
var pageScrollPositions = {};
var userStatus = 'verified'; // 'banned' to test

// GLOBAL USER STATE
var userData = {
    id: tg.initDataUnsafe?.user?.id || 999999999,
    username: tg.initDataUnsafe?.user?.first_name || tg.initDataUnsafe?.user?.username || 'User',
    tokens: DEMO_MODE ? DEMO_BALANCE : 0,
    james: DEMO_MODE ? DEMO_BALANCE : 0,
    usd: DEMO_MODE ? 1000000000000.00 : 0.00,
    verified: DEMO_MODE ? true : false,
    dailyStreak: 0,
    lastDailyClaim: 0
};

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
            if (btn === 'support') window.open('https://t.me/support');
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
        'emailService', 'vccCards', 'vpnServices', 'serviceGenerate',
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

    // Bottom Nav Active State Logic
    // Bottom Nav Active State Logic using data-page for reliability
    document.querySelectorAll('.nav-item, .nav-center').forEach(n => n.classList.remove('active'));

    let activeNavGroup = 'home';
    if (['tasks', 'earn', 'earnMenu', 'daily'].includes(targetId)) activeNavGroup = 'tasks';
    else if (['shop', 'exchange', 'deposit', 'binancePay', 'faucetPay', 'geminiProduct', 'chatgptProduct', 'services', 'numberService', 'mailService', 'emailMenu', 'emailService', 'vccCards', 'vpnServices', 'serviceGenerate', 'checkout'].includes(targetId)) activeNavGroup = 'shop';
    else if (['invite', 'leaderboard'].includes(targetId)) activeNavGroup = 'invite';
    else if (['profile', 'history', 'redeem', 'transfer', 'support', 'verify', 'geminiVerification', 'admin'].includes(targetId)) activeNavGroup = 'profile';

    const activeItem = document.querySelector(`[data-page="${activeNavGroup}"]`);
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
                if (typeof res.james === 'number') userData.james = res.james;
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
    james_to_tokens: 100
};

function tokensToUsd(tokens) {
    return tokens / exchangeRates.usd_to_tokens;
}

function usdToTokens(usd) {
    return usd * exchangeRates.usd_to_tokens;
}

function tokensToJames(tokens) {
    return tokens / exchangeRates.james_to_tokens;
}

function jamesToTokens(james) {
    return james * exchangeRates.james_to_tokens;
}

function calculateExchange(from, to, amount) {
    let toAmount = 0;
    let rateText = '-';

    // Convert from -> tokens base
    let tokensBase = 0;
    if (from === 'tokens') tokensBase = amount;
    else if (from === 'usd') tokensBase = usdToTokens(amount);
    else if (from === 'james') tokensBase = jamesToTokens(amount);
    else return { success: false, message: 'Invalid source currency' };

    // Convert tokens base -> to
    if (to === 'tokens') {
        toAmount = tokensBase;
        rateText = '1 Token = 1 Token';
    } else if (to === 'usd') {
        toAmount = tokensToUsd(tokensBase);
        rateText = `1 USD = ${exchangeRates.usd_to_tokens} Tokens`;
    } else if (to === 'james') {
        toAmount = tokensToJames(tokensBase);
        rateText = `1 James = ${exchangeRates.james_to_tokens} Tokens`;
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
    if (cur === 'james') return `${Math.floor(amount * 10000) / 10000} JAMES`;
    return `${amount}`;
}

function hasSufficientBalance(cur, amount) {
    if (cur === 'tokens') return (userData.tokens || 0) >= amount;
    if (cur === 'james') return (userData.james || 0) >= amount;
    if (cur === 'usd') return (userData.usd || 0) >= amount;
    return false;
}

function updateExchangeBalances() {
    const t = document.getElementById('exBalTokens');
    const j = document.getElementById('exBalJames');
    const u = document.getElementById('exBalUsd');
    if (t) t.textContent = (userData.tokens || 0).toString();
    if (j) j.textContent = (userData.james || 0).toString();
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

    const maxVal = fromCur === 'tokens' ? (userData.tokens || 0) : fromCur === 'james' ? (userData.james || 0) : (userData.usd || 0);
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
    else if (fromCur === 'james') maxVal = userData.james || 0;
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

function payWithBalance() {
    tg.showAlert('Balance payment coming soon!');
}

// TASK LOGIC
function earn(type, amount) {
    tg.showConfirm('Start this mission?', (ok) => {
        if (ok) {
            // Open Link
            if (type === 'yt') window.open('https://youtube.com');
            else if (type === 'tg') window.open('https://t.me/telegram');

            // Simulate Verification
            setTimeout(() => {
                const r = confirm('Did you complete the task?');
                if (r) {
                    tg.showAlert(`Task Completed! +${amount} Tokens`);
                    // Update balance logic here...
                }
            }, 5000);
        }
    });
}

// ==========================================
// DAILY BONUS SYSTEM (PREMIUM)
// ==========================================

function renderDailyGrid() {
    const grid = document.getElementById('dailyRewardsGrid');
    if (!grid) return;

    // Fixed 7-day rewards
    const rewards = [10, 20, 30, 40, 50, 60, 100];
    const userClaimedDay = userData.dailyStreak || 0; // Days completed
    const lastClaim = userData.lastDailyClaim || 0; // Timestamp
    const now = Date.now();
    const canClaim = (now - lastClaim) >= 24 * 60 * 60 * 1000;

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
                    <span style="font-size:12px; color: #aaa;">100 Tokens + 2 James</span>
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
                    confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
                    confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
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

function fetchUserData() {
    fetch(`/api/user/${userId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                userData.tokens = data.tokens;
                userData.james = data.james;
                userData.verified = data.verified;
                // Use server name, fallback to Telegram name, then generic
                userData.username = data.username || data.firstName ||
                    tg.initDataUnsafe?.user?.first_name ||
                    tg.initDataUnsafe?.user?.username || 'User';
                userData.usd = data.usd || (data.tokens / 100);
                userData.dailyStreak = data.dailyStreak || 0;
                userData.lastDailyClaim = data.lastClaim || 0;
                renderBalances();
                if (currentPage === 'daily') {
                    renderDailyGrid();
                    startDailyCountdown();
                }
            } else {
                // Server error but we can still show Telegram name
                if (!userData.username || userData.username === 'User') {
                    userData.username = tg.initDataUnsafe?.user?.first_name ||
                        tg.initDataUnsafe?.user?.username || 'Guest';
                    renderBalances();
                }
            }
        })
        .catch(err => {
            console.error('API Error:', err);
            // Fallback: use Telegram data on network error
            if (!userData.username || userData.username === 'User') {
                userData.username = tg.initDataUnsafe?.user?.first_name ||
                    tg.initDataUnsafe?.user?.username || 'Guest';
                renderBalances();
            }
        });
}

function saveWallet() {
    renderBalances();
}

function renderBalances() {
    const displayName = userData.username || tg.initDataUnsafe?.user?.first_name || 'Guest';

    // 1. Update Profile Stats
    const elTc = document.getElementById('prof-tc');
    const elJs = document.getElementById('prof-js');
    const elUsd = document.getElementById('prof-usd');
    const elProfName = document.getElementById('prof-name');
    const elProfId = document.getElementById('prof-id');

    if (elTc) elTc.innerText = (userData.tokens || 0).toLocaleString();
    if (elJs) elJs.innerText = (userData.james || 0).toLocaleString();
    if (elUsd) elUsd.innerText = '$' + (userData.usd || 0).toFixed(2);
    if (elProfName) elProfName.innerText = displayName;
    if (elProfId) elProfId.innerText = '#' + userData.id;

    // 2. Update Home Page Stats
    const hTc = document.getElementById('home-tc');
    const hJs = document.getElementById('home-js');
    const hName = document.getElementById('home-name');

    if (hTc) hTc.innerText = (userData.tokens || 0).toLocaleString();
    if (hJs) hJs.innerText = (userData.james || 0).toLocaleString();
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

// Current active service for generate page
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
        if (noActive) noActive.style.display = "none";
        if (activeState) activeState.style.display = "block";
        const addrEl = document.getElementById(type + "MailAddr");
        if (addrEl) addrEl.textContent = mailSessions[type].email;
    } else {
        if (noActive) noActive.style.display = "block";
        if (activeState) activeState.style.display = "none";
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



// Initial Render & Fetch
renderBalances();
fetchUserData(); // Fetch real data on load

// Poll for updates (every 10s)
setInterval(fetchUserData, 10000);
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
                generateDemoPremiumMail(type, cost);
            }
        })
        .catch(() => {
            generateDemoPremiumMail(type, cost);
        });
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
    fetchUserData();
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
});
