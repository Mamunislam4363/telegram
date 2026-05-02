// Global state
let currentEmail = null;
let currentInbox = [];
let selectedType = 'temp';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadUserData();
    fetchInitialEmail();
    
    // Auto-refresh inbox every 10 seconds
    setInterval(refreshInbox, 10000);
});

async function loadUserData() {
    try {
        // Use the existing userData from script.js (if available)
        // or fetch from server
        if (window.userData && window.userData.tokens !== undefined) {
            updateBalanceUI(window.userData.tokens);
        } else {
            const res = await fetch('/api/user-activity');
            const data = await res.json();
            if (data.success && data.user) {
                updateBalanceUI(data.user.balance_tokens || data.user.tokens || 0);
            }
        }
    } catch (e) {
        console.error('Balance load error:', e);
    }
}

function updateBalanceUI(balance) {
    const el = document.getElementById('balanceText');
    if (el) el.innerText = parseFloat(balance).toLocaleString();
}

async function fetchInitialEmail() {
    const display = document.getElementById('emailAddress');
    try {
        const res = await fetch('/api/email/current');
        const data = await res.json();
        
        if (data.success && data.email) {
            currentEmail = data.email;
            display.value = data.email;
            refreshInbox();
        } else {
            // No current email, generate a free temp mail
            generateEmail('temp');
        }
    } catch (e) {
        display.value = "Error loading mail";
    }
}

async function generateEmail(type) {
    const display = document.getElementById('emailAddress');
    display.value = "Generating...";
    
    try {
        const res = await fetch('/api/email/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type })
        });
        const data = await res.json();
        
        if (data.success) {
            currentEmail = data.email;
            display.value = data.email;
            if (data.newBalance !== undefined) updateBalanceUI(data.newBalance);
            window.showToast?.('✅ New email generated!');
            refreshInbox();
        } else {
            display.value = "Error generating";
            window.showToast?.('❌ ' + (data.message || 'Error'));
        }
    } catch (e) {
        display.value = "Network error";
    }
}

async function refreshInbox() {
    if (!currentEmail) return;
    
    try {
        const res = await fetch('/api/email/inbox?email=' + encodeURIComponent(currentEmail));
        const data = await res.json();
        
        if (data.success) {
            renderInbox(data.messages || []);
        }
    } catch (e) {
        console.error('Inbox refresh error:', e);
    }
}

function renderInbox(messages) {
    const list = document.getElementById('inboxList');
    if (messages.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="icon-circle"><i class="fas fa-envelope-open"></i></div>
                <p>Your inbox is empty</p>
                <span>Messages will appear here automatically</span>
            </div>
        `;
        return;
    }
    
    list.innerHTML = messages.map(msg => `
        <div class="message-item" onclick="viewMessage('${msg.id}')">
            <div class="msg-from">${msg.from}</div>
            <div class="msg-subject">${msg.subject}</div>
            <div class="msg-time">${formatDate(msg.date)}</div>
        </div>
    `).join('');
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Popup UI Actions
function openCreatePopup() {
    document.getElementById('createPopup').style.display = 'flex';
}

function closeCreatePopup() {
    document.getElementById('createPopup').style.display = 'none';
}

function selectType(type, element) {
    selectedType = type;
    document.querySelectorAll('.option-item').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
}

function processGeneration() {
    closeCreatePopup();
    generateEmail(selectedType);
}

function copyEmail() {
    const el = document.getElementById('emailAddress');
    el.select();
    document.execCommand('copy');
    window.showToast?.('📋 Copied to clipboard!');
}

function refreshEmail() {
    refreshInbox();
    window.showToast?.('🔄 Refreshing inbox...');
}

function changeDomain() {
    // Logic for changing domain (usually just a new temp mail)
    generateEmail('temp');
}
