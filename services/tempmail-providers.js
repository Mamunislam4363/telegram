const axios = require('axios');
const otpExtractor = require('./otp-extractor');
const config = require('../config');

// SmtpLabs Config from bot's config
const SMTP_API_BASE = 'https://api.smtp.dev';
const SMTP_API_KEY = config.SMTPLABS_API_KEY;

/**
 * TEMP MAIL PROVIDER CHAIN
 * Tries providers in order until one succeeds
 * Returns: { email, token, password, provider } or null
 */

// LEVEL 1: Mail.tm
async function tryMailTm() {
    try {
        const domain = (await axios.get('https://api.mail.tm/domains')).data['hydra:member'][0].domain;
        const username = Math.random().toString(36).substring(7);
        const password = Math.random().toString(36).substring(7);
        const email = `${username}@${domain}`;

        await axios.post('https://api.mail.tm/accounts', { address: email, password: password });
        const tokenRes = await axios.post('https://api.mail.tm/token', { address: email, password: password });

        if (tokenRes.data.token) {
            return {
                email,
                password,
                token: tokenRes.data.token,
                provider: 'mail.tm'
            };
        }
    } catch (e) {
        // console.error('Mail.tm Failed:', e.message);
    }
    return null;
}

// LEVEL 0: SmtpLabs (Premium Real-time Provider)
// Known by user as "MB Mail" or internal generator
async function trySmtpLabs() {
    if (!SMTP_API_KEY || SMTP_API_KEY.includes('YOUR_')) return null;

    try {
        const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const randomPass = `Pass${Date.now()}!`;
        const email = `${randomUser}@smtp.dev`;

        const headers = {
            'X-API-KEY': SMTP_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        const res = await axios.post(`${SMTP_API_BASE}/accounts`, {
            address: email,
            password: randomPass
        }, { headers, timeout: 10000 });

        if (res.data && res.data.id) {
            const inbox = res.data.mailboxes?.find(m => m.path === 'INBOX');
            return {
                email: res.data.address,
                password: randomPass,
                accountId: res.data.id,
                mailboxId: inbox ? inbox.id : null,
                token: res.data.id, // Store account ID as token
                provider: 'smtplabs'
            };
        }
    } catch (e) {
        console.error('SmtpLabs Account Creation Failed:', e.message);
    }
    return null;
}

// LEVEL 0.5: ApiGateway Failover (Database Providers)
async function tryApiGateway() {
    try {
        const apiGateway = require('./api-gateway');
        const db = require('../db');

        return await apiGateway.executeWithFailover('email', async (provider) => {
            const randomUser = `user${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const randomPass = `Pass${Date.now()}!`;
            const email = `${randomUser}@smtp.dev`; // Fallback domain

            const response = await axios.post(`${provider.apiUrl}/accounts`, {
                address: email,
                password: randomPass
            }, {
                headers: {
                    'X-API-KEY': provider.apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            if (response.data && response.data.id) {
                const inbox = response.data.mailboxes?.find(m => m.path === 'INBOX');
                return {
                    id: response.data.id,
                    email: response.data.address,
                    password: randomPass,
                    mailboxId: inbox?.id || null,
                    providerId: provider.id,
                    token: response.data.id,
                    provider: 'smtplabs_gateway'
                };
            }
            throw new Error('Invalid Provider Response');
        });
    } catch (e) {
        return null;
    }
}

// LEVEL 2: 1SecMail (Internxt fallback)
async function try1SecMail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['1secmail.com', '1secmail.org', '1secmail.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;

        return {
            email,
            password: 'No-Password',
            token: `${username}@${domain}`,
            provider: '1secmail'
        };
    } catch (e) {
        // console.error('1SecMail Failed:', e.message);
    }
    return null;
}

// LEVEL 3: Mail.gw (Same engine as Mail.tm)
async function tryMailGw() {
    try {
        const domainRes = await axios.get('https://api.mail.gw/domains');
        const domain = domainRes.data['hydra:member'][0].domain;
        const username = Math.random().toString(36).substring(7);
        const password = Math.random().toString(36).substring(7);
        const email = `${username}@${domain}`;

        await axios.post('https://api.mail.gw/accounts', { address: email, password: password });
        const tokenRes = await axios.post('https://api.mail.gw/token', { address: email, password: password });

        if (tokenRes.data.token) {
            return {
                email,
                password,
                token: tokenRes.data.token,
                provider: 'mail.gw'
            };
        }
    } catch (e) {
        // console.error('Mail.gw Failed:', e.message);
    }
    return null;
}

// LEVEL 4: GuerrillaMail (Fakemail System)
async function tryGuerrilla() {
    try {
        const res = await axios.get('http://api.guerrillamail.com/ajax.php?f=get_email_address');
        if (res.data && res.data.email_addr) {
            return {
                email: res.data.email_addr,
                password: 'No-Password',
                token: res.data.sid_token, // Session ID needed for checking mail
                provider: 'guerrilla'
            };
        }
    } catch (e) {
        // console.error('Guerrilla Failed:', e.message);
    }
    return null;
}

// LEVEL 5: TempMail.org
async function tryTempMailOrg() {
    try {
        const res = await axios.get('https://api.temp-mail.org/request/domains/format/json');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'tempmailorg'
            };
        }
    } catch (e) {
        // console.error('TempMail.org Failed:', e.message);
    }
    return null;
}

// LEVEL 6: 10MinuteMail
async function try10MinuteMail() {
    try {
        const res = await axios.get('https://10minutemail.com/session/email', { timeout: 10000 });
        if (res.data && res.data.address) {
            return {
                email: res.data.address,
                password: 'No-Password',
                token: res.data.sessionId || res.data.address,
                provider: '10minutemail'
            };
        }
    } catch (e) {
        // console.error('10MinuteMail Failed:', e.message);
    }
    return null;
}

// LEVEL 7: Yopmail
async function tryYopmail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const email = `${username}@yopmail.com`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'yopmail'
        };
    } catch (e) {
        // console.error('Yopmail Failed:', e.message);
    }
    return null;
}

// LEVEL 8: Mailinator
async function tryMailinator() {
    try {
        const username = Math.random().toString(36).substring(7);
        const email = `${username}@mailinator.com`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'mailinator'
        };
    } catch (e) {
        // console.error('Mailinator Failed:', e.message);
    }
    return null;
}

// LEVEL 9: TempMailAsia
async function tryTempMailAsia() {
    try {
        const res = await axios.get('https://api.temp-mail.asia/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'tempmailasia'
            };
        }
    } catch (e) {
        // console.error('TempMailAsia Failed:', e.message);
    }
    return null;
}

// LEVEL 10: EmailOnDeck
async function tryEmailOnDeck() {
    try {
        const res = await axios.get('https://api.emailondeck.com/v1/generate', { timeout: 10000 });
        if (res.data && res.data.email) {
            return {
                email: res.data.email,
                password: 'No-Password',
                token: res.data.token || res.data.email,
                provider: 'emailondeck'
            };
        }
    } catch (e) {
        // console.error('EmailOnDeck Failed:', e.message);
    }
    return null;
}

// LEVEL 11: DropMail.me
async function tryDropMail() {
    try {
        const res = await axios.get('https://dropmail.me/api/graphql/query?query=mutation%20%7BintroduceSession%20%7Bid%2C%20expiresAt%2C%20addresses%20%7Baddress%7D%7D%7D');
        if (res.data && res.data.data && res.data.data.introduceSession) {
            const session = res.data.data.introduceSession;
            const email = session.addresses[0].address;
            return {
                email,
                password: 'No-Password',
                token: session.id,
                provider: 'dropmail'
            };
        }
    } catch (e) {
        // console.error('DropMail Failed:', e.message);
    }
    return null;
}

// LEVEL 12: TempMailo
async function tryTempMailo() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tempmailo.com', 'tempmailo.org', 'tempmailo.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tempmailo'
        };
    } catch (e) {
        // console.error('TempMailo Failed:', e.message);
    }
    return null;
}

// LEVEL 13: MailDrop.cc
async function tryMailDrop() {
    try {
        const username = Math.random().toString(36).substring(7);
        const email = `${username}@maildrop.cc`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'maildrop'
        };
    } catch (e) {
        // console.error('MailDrop Failed:', e.message);
    }
    return null;
}

// LEVEL 14: TempMail.lol
async function tryTempMailLol() {
    try {
        const res = await axios.get('https://api.tempmail.lol/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'tempmaillol'
            };
        }
    } catch (e) {
        // console.error('TempMail.lol Failed:', e.message);
    }
    return null;
}

// LEVEL 15: TempMail.pw
async function tryTempMailPw() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tempmail.pw', 'tempmail.top', 'tempmail.pro'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tempmailpw'
        };
    } catch (e) {
        // console.error('TempMail.pw Failed:', e.message);
    }
    return null;
}

// LEVEL 16: FakeMailGenerator
async function tryFakeMailGenerator() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['fakemailgenerator.com', 'fakemail.net', 'tempmailaddress.com'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'fakemailgenerator'
        };
    } catch (e) {
        // console.error('FakeMailGenerator Failed:', e.message);
    }
    return null;
}

// LEVEL 17: Spam4.me
async function trySpam4Me() {
    try {
        const username = Math.random().toString(36).substring(7);
        const email = `${username}@spam4.me`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'spam4me'
        };
    } catch (e) {
        // console.error('Spam4.me Failed:', e.message);
    }
    return null;
}

// LEVEL 18: TempMail.co
async function tryTempMailCo() {
    try {
        const res = await axios.get('https://api.tempmail.co/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'tempmailco'
            };
        }
    } catch (e) {
        // console.error('TempMail.co Failed:', e.message);
    }
    return null;
}

// LEVEL 19: Mohmal
async function tryMohmal() {
    try {
        const res = await axios.get('https://www.mohmal.com/api/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'mohmal'
            };
        }
    } catch (e) {
        // console.error('Mohmal Failed:', e.message);
    }
    return null;
}

// LEVEL 20: Mailnesia
async function tryMailnesia() {
    try {
        const username = Math.random().toString(36).substring(7);
        const email = `${username}@mailnesia.com`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'mailnesia'
        };
    } catch (e) {
        // console.error('Mailnesia Failed:', e.message);
    }
    return null;
}

// LEVEL 21: Tmailor
async function tryTmailor() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tmailor.com', 'tmailor.net', 'tmailor.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tmailor'
        };
    } catch (e) {
        // console.error('Tmailor Failed:', e.message);
    }
    return null;
}

// LEVEL 22: TrashMail
async function tryTrashMail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['trashmail.com', 'trashmail.net', 'trashmail.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: username,
            provider: 'trashmail'
        };
    } catch (e) {
        // console.error('TrashMail Failed:', e.message);
    }
    return null;
}

// LEVEL 23: AdGuard Temp Mail
async function tryAdGuardTemp() {
    try {
        const res = await axios.get('https://api.adguard.com/temp-mail/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'adguardtemp'
            };
        }
    } catch (e) {
        // console.error('AdGuard Temp Failed:', e.message);
    }
    return null;
}

// LEVEL 24: Internxt Temp Mail
async function tryInternxtTemp() {
    try {
        const res = await axios.get('https://api.internxt.com/temporary-email/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'internxttemp'
            };
        }
    } catch (e) {
        // console.error('Internxt Temp Failed:', e.message);
    }
    return null;
}

// LEVEL 25: Typewire
async function tryTypewire() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['typewire.com', 'typewire.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'typewire'
        };
    } catch (e) {
        // console.error('Typewire Failed:', e.message);
    }
    return null;
}

// LEVEL 26: AtomicMail
async function tryAtomicMail() {
    try {
        const res = await axios.get('https://api.atomicmail.io/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'atomicmail'
            };
        }
    } catch (e) {
        // console.error('AtomicMail Failed:', e.message);
    }
    return null;
}

// LEVEL 27: TinyHost
async function tryTinyHost() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tinyhost.shop', 'tinyhost.top', 'tinyhost.xyz'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tinyhost'
        };
    } catch (e) {
        // console.error('TinyHost Failed:', e.message);
    }
    return null;
}

// LEVEL 28: WabblyWabble
async function tryWabblyWabble() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['wabblywabble.com', 'wabblywabble.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'wabblywabble'
        };
    } catch (e) {
        // console.error('WabblyWabble Failed:', e.message);
    }
    return null;
}

// LEVEL 29: Addy.io
async function tryAddyIo() {
    try {
        const res = await axios.get('https://api.addy.io/api/v1/domains', {
            headers: { 'Authorization': 'Bearer demo' }
        });
        if (res.data && res.data.data && res.data.data.length > 0) {
            const domain = res.data.data[0].domain;
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'addyio'
            };
        }
    } catch (e) {
        // console.error('Addy.io Failed:', e.message);
    }
    return null;
}

// LEVEL 30: EmailFake
async function tryEmailFake() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['email-fake.com', 'fake-email.com', 'emailfake.com'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'emailfake'
        };
    } catch (e) {
        // console.error('EmailFake Failed:', e.message);
    }
    return null;
}

// LEVEL 31: Tempm
async function tryTempm() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tempm.com', 'tempm.net', 'tempm.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tempm'
        };
    } catch (e) {
        // console.error('Tempm Failed:', e.message);
    }
    return null;
}

// LEVEL 32: Generator.email
async function tryGeneratorEmail() {
    try {
        const res = await axios.get('https://generator.email/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'generatoremail'
            };
        }
    } catch (e) {
        // console.error('Generator.email Failed:', e.message);
    }
    return null;
}

// LEVEL 33: MailTemp
async function tryMailTemp() {
    try {
        const res = await axios.get('https://mail-temp.com/api/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'mailtemp'
            };
        }
    } catch (e) {
        // console.error('MailTemp Failed:', e.message);
    }
    return null;
}

// LEVEL 34: CyberTemp
async function tryCyberTemp() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['cybertemp.xyz', 'cybertemp.net', 'cybertemp.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'cybertemp'
        };
    } catch (e) {
        // console.error('CyberTemp Failed:', e.message);
    }
    return null;
}

// LEVEL 35: Moakt
async function tryMoakt() {
    try {
        const res = await axios.get('https://www.moakt.com/api/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'moakt'
            };
        }
    } catch (e) {
        // console.error('Moakt Failed:', e.message);
    }
    return null;
}

// LEVEL 36: Plingest
async function tryPlingest() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['plingest.com', 'plingest.net', 'plingest.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'plingest'
        };
    } catch (e) {
        // console.error('Plingest Failed:', e.message);
    }
    return null;
}

// LEVEL 37: TmailDelivery
async function tryTmailDelivery() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['tmail.delivery', 'tmail.cloud', 'tmail.site'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'tmaildelivery'
        };
    } catch (e) {
        // console.error('TmailDelivery Failed:', e.message);
    }
    return null;
}

// LEVEL 38: KukuLu
async function tryKukuLu() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['m.kuku.lu', 'kuku.lu', 'kukulu.com'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'kukulu'
        };
    } catch (e) {
        // console.error('KukuLu Failed:', e.message);
    }
    return null;
}

// LEVEL 39: PriyoEmail
async function tryPriyoEmail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['priyo.email', 'priyomail.com', 'priyo.net'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'priyoemail'
        };
    } catch (e) {
        // console.error('PriyoEmail Failed:', e.message);
    }
    return null;
}

// LEVEL 40: BurnerMail
async function tryBurnerMail() {
    try {
        const res = await axios.get('https://api.burnermail.io/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'burnermail'
            };
        }
    } catch (e) {
        // console.error('BurnerMail Failed:', e.message);
    }
    return null;
}

// LEVEL 41: MainnetMail
async function tryMainnetMail() {
    try {
        const username = Math.random().toString(36).substring(7);
        const domains = ['mainnetmail.com', 'mainnetmail.net', 'mainnetmail.org'];
        const domain = domains[Math.floor(Math.random() * domains.length)];
        const email = `${username}@${domain}`;
        return {
            email,
            password: 'No-Password',
            token: email,
            provider: 'mainnetmail'
        };
    } catch (e) {
        // console.error('MainnetMail Failed:', e.message);
    }
    return null;
}

// LEVEL 42: MailTempSite
async function tryMailTempSite() {
    try {
        const res = await axios.get('https://mail-temp.site/api/domains');
        if (res.data && res.data.length > 0) {
            const domain = res.data[0];
            const username = Math.random().toString(36).substring(7);
            const email = `${username}@${domain}`;
            return {
                email,
                password: 'No-Password',
                token: email,
                provider: 'mailtempsite'
            };
        }
    } catch (e) {
        // console.error('MailTempSite Failed:', e.message);
    }
    return null;
}

/**
 * MAIN GENERATOR FUNCTION
 * Tries providers in sequence - prioritizes free providers when API/gateway unavailable
 */
async function createAccount() {
    console.log('🔄 Starting Live Email Generation Chain...');

    // 0. Try SmtpLabs (Premium - if configured)
    let account = await trySmtpLabs();
    if (account) {
        console.log('✅ SmtpLabs provided email:', account.email);
        return account;
    }

    // 0.5. Try ApiGateway (only if providers configured in DB)
    // Check if any email providers exist before trying
    const db = require('../db');
    const hasEmailProviders = db.data?.providers &&
        Object.values(db.data.providers).some(p => p.type === 'email' && p.status === 'active');

    if (hasEmailProviders) {
        account = await tryApiGateway();
        if (account) {
            console.log('✅ ApiGateway provider provided email:', account.email);
            return account;
        }
    } else {
        console.log('ℹ️ No email providers configured in DB, skipping ApiGateway...');
    }

    // FREE PROVIDER FALLBACK CHAIN
    console.log('🔄 Trying free temp mail providers...');

    // 1. Mail.tm (Most reliable free provider)
    console.log('  → Trying Mail.tm...');
    account = await tryMailTm();
    if (account) {
        console.log('✅ Mail.tm provided email:', account.email);
        return account;
    }

    // 2. 1SecMail (No authentication required)
    console.log('  → Trying 1SecMail...');
    account = await try1SecMail();
    if (account) {
        console.log('✅ 1SecMail provided email:', account.email);
        return account;
    }

    // 3. Mail.gw (Mail.tm alternative)
    console.log('  → Trying Mail.gw...');
    account = await tryMailGw();
    if (account) {
        console.log('✅ Mail.gw provided email:', account.email);
        return account;
    }

    // 4. GuerrillaMail
    console.log('  → Trying GuerrillaMail...');
    account = await tryGuerrilla();
    if (account) {
        console.log('✅ GuerrillaMail provided email:', account.email);
        return account;
    }

    // 5. TempMail.org
    console.log('  → Trying TempMail.org...');
    account = await tryTempMailOrg();
    if (account) {
        console.log('✅ TempMail.org provided email:', account.email);
        return account;
    }

    console.error('❌ All free providers failed! Trying additional fallbacks...');

    // Continue with additional fallbacks...
    account = await try10MinuteMail();
    if (account) return account;

    // 7. Yopmail
    account = await tryYopmail();
    if (account) return account;

    // 8. Mailinator
    account = await tryMailinator();
    if (account) return account;

    // 9. TempMailAsia
    account = await tryTempMailAsia();
    if (account) return account;

    // 10. EmailOnDeck
    account = await tryEmailOnDeck();
    if (account) return account;

    // 11. DropMail
    account = await tryDropMail();
    if (account) return account;

    // 12. TempMailo
    account = await tryTempMailo();
    if (account) return account;

    // 13. MailDrop
    account = await tryMailDrop();
    if (account) return account;

    // 14. TempMail.lol
    account = await tryTempMailLol();
    if (account) return account;

    // 15. TempMail.pw
    account = await tryTempMailPw();
    if (account) return account;

    // 16. FakeMailGenerator
    account = await tryFakeMailGenerator();
    if (account) return account;

    // 17. Spam4.me
    account = await trySpam4Me();
    if (account) return account;

    // 18. TempMail.co
    account = await tryTempMailCo();
    if (account) return account;

    // 19. Mohmal
    account = await tryMohmal();
    if (account) return account;

    // 20. Mailnesia
    account = await tryMailnesia();
    if (account) return account;

    // 21. Tmailor
    account = await tryTmailor();
    if (account) return account;

    // 22. TrashMail
    account = await tryTrashMail();
    if (account) return account;

    // 23. AdGuard Temp
    account = await tryAdGuardTemp();
    if (account) return account;

    // 24. Internxt Temp
    account = await tryInternxtTemp();
    if (account) return account;

    // 25. Typewire
    account = await tryTypewire();
    if (account) return account;

    // 26. AtomicMail
    account = await tryAtomicMail();
    if (account) return account;

    // 27. TinyHost
    account = await tryTinyHost();
    if (account) return account;

    // 28. WabblyWabble
    account = await tryWabblyWabble();
    if (account) return account;

    // 29. Addy.io
    account = await tryAddyIo();
    if (account) return account;

    // 30. EmailFake
    account = await tryEmailFake();
    if (account) return account;

    // 31. Tempm
    account = await tryTempm();
    if (account) return account;

    // 32. Generator.email
    account = await tryGeneratorEmail();
    if (account) return account;

    // 33. MailTemp
    account = await tryMailTemp();
    if (account) return account;

    // 34. CyberTemp
    account = await tryCyberTemp();
    if (account) return account;

    // 35. Moakt
    account = await tryMoakt();
    if (account) return account;

    // 36. Plingest
    account = await tryPlingest();
    if (account) return account;

    // 37. TmailDelivery
    account = await tryTmailDelivery();
    if (account) return account;

    // 38. KukuLu
    account = await tryKukuLu();
    if (account) return account;

    // 39. PriyoEmail
    account = await tryPriyoEmail();
    if (account) return account;

    // 40. BurnerMail
    account = await tryBurnerMail();
    if (account) return account;

    // 41. MainnetMail
    account = await tryMainnetMail();
    if (account) return account;

    // 42. MailTempSite
    account = await tryMailTempSite();
    if (account) return account;

    console.error('❌ All providers failed!');
    return null;
}

// Helper for Mail.tm/gw message fetching
async function fetchMailTmMessage(baseUrl, token, msgId) {
    const fullMsgRes = await axios.get(`${baseUrl}/messages/${msgId}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const fullMsg = fullMsgRes.data;
    const subject = fullMsg.subject || '';
    const body = fullMsg.text || fullMsg.html || '';

    // Use advanced OTP extractor
    const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

    return {
        otp: result.otp,
        confidence: result.confidence,
        fullMessage: body,
        // Added for compatibility
        text: body,
        subject: subject,
        date: fullMsg.createdAt || new Date().toISOString(),
        sender: fullMsg.from ? (fullMsg.from.address || fullMsg.from.name) : 'Unknown'
    };
}

/**
 * OTP CHECKER FUNCTION
 */
async function getOtp(token, email) {
    if (!token) return null;

    // 1. Mail.tm / Mail.gw (JWT Tokens checking)
    // JWT starts with "ey..." usually and is long.
    if (token.length > 50 && !token.includes('@') && !token.startsWith('sid')) {
        // Try Mail.tm first
        try {
            const res = await axios.get('https://api.mail.tm/messages', { headers: { Authorization: `Bearer ${token}` } });
            if (res.data['hydra:member'] && res.data['hydra:member'].length > 0) {
                return await fetchMailTmMessage('https://api.mail.tm', token, res.data['hydra:member'][0].id);
            }
        } catch (e) { }

        // Try Mail.gw
        try {
            const res = await axios.get('https://api.mail.gw/messages', { headers: { Authorization: `Bearer ${token}` } });
            if (res.data['hydra:member'] && res.data['hydra:member'].length > 0) {
                return await fetchMailTmMessage('https://api.mail.gw', token, res.data['hydra:member'][0].id);
            }
        } catch (e) { }
    }

    // 2. GuerrillaMail (Session Token)
    // Heuristic: token length ~32, alphanumeric, no @
    if (token.length > 20 && !token.includes('@') && !token.startsWith('ey')) {
        try {
            const res = await axios.get(`http://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${token}`);
            const list = res.data.list;
            // Guerrilla returns list of emails. Need to find new ones.
            if (list && list.length > 0) {
                // Return latest
                const mail = list[list.length - 1];
                const mailId = mail.mail_id;

                // Fetch body
                const bodyRes = await axios.get(`http://api.guerrillamail.com/ajax.php?f=fetch_email&sid_token=${token}&email_id=${mailId}`);
                const body = bodyRes.data.mail_body;
                const subject = bodyRes.data.mail_subject || '';

                // Use advanced OTP extractor
                const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

                return {
                    otp: result.otp,
                    confidence: result.confidence,
                    fullMessage: body,
                    // Added for compatibility
                    text: body,
                    subject: subject,
                    date: bodyRes.data.mail_date || new Date().toISOString(),
                    sender: bodyRes.data.mail_from
                };
            }
        } catch (e) { }
    }

    // 3. 1SecMail and similar email-based providers
    if (token.includes('@') || (email && email.includes('@'))) {
        try {
            const checkEmail = email || token;
            if (checkEmail.includes('@')) {
                const [user, domain] = checkEmail.split('@');

                // Try 1SecMail API first (works for many providers)
                try {
                    const res = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${user}&domain=${domain}`, { timeout: 5000 });
                    if (res.data && res.data.length > 0) {
                        const id = res.data[0].id;
                        const msgRes = await axios.get(`https://www.1secmail.com/api/v1/?action=readMessage&login=${user}&domain=${domain}&id=${id}`, { timeout: 5000 });
                        const body = msgRes.data.textBody || msgRes.data.body || '';
                        const subject = msgRes.data.subject || '';

                        // Use advanced OTP extractor
                        const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);

                        return {
                            otp: result.otp,
                            confidence: result.confidence,
                            fullMessage: body,
                            text: body,
                            subject: subject,
                            date: msgRes.data.date || new Date().toISOString(),
                            sender: msgRes.data.from
                        };
                    }
                } catch (e) { }

                // Try Mail.tm API for temp-mail.org style emails
                try {
                    // Some providers use mail.tm compatible APIs
                    const tmRes = await axios.get(`https://api.mail.tm/addresses/${user}@${domain}/messages`, { timeout: 5000 });
                    if (tmRes.data && tmRes.data.length > 0) {
                        const msg = tmRes.data[0];
                        const body = msg.text || msg.html || '';
                        const subject = msg.subject || '';
                        const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);
                        return {
                            otp: result.otp,
                            confidence: result.confidence,
                            fullMessage: body,
                            text: body,
                            subject: subject,
                            date: msg.createdAt || new Date().toISOString(),
                            sender: msg.from || 'Unknown'
                        };
                    }
                } catch (e) { }

                // Try temp-mail.org API
                try {
                    const tmoRes = await axios.get(`https://api.temp-mail.org/request/mail/id/${Buffer.from(checkEmail).toString('base64')}/format/json`, { timeout: 5000 });
                    if (tmoRes.data && tmoRes.data.length > 0) {
                        const msg = tmoRes.data[0];
                        const body = msg.mail_text || msg.mail_html || '';
                        const subject = msg.mail_subject || '';
                        const result = otpExtractor.extractOTP(subject + '\n\n' + body, subject);
                        return {
                            otp: result.otp,
                            confidence: result.confidence,
                            fullMessage: body,
                            text: body,
                            subject: subject,
                            date: msg.mail_timestamp || new Date().toISOString(),
                            sender: msg.mail_from || 'Unknown'
                        };
                    }
                } catch (e) { }
            }
        } catch (e) { }
    }

    return null;
}

// Helper to fetch full message list for Mail.tm/gw
async function fetchMailTmMessages(baseUrl, token) {
    try {
        const res = await axios.get(`${baseUrl}/messages`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const messages = res.data['hydra:member'] || [];
        return await Promise.all(messages.map(async (msg) => {
            const fullMsg = await axios.get(`${baseUrl}/messages/${msg.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return {
                id: msg.id,
                from: fullMsg.data.from ? (fullMsg.data.from.address || fullMsg.data.from.name) : 'Unknown',
                subject: fullMsg.data.subject || '(No Subject)',
                text: fullMsg.data.text || fullMsg.data.html || '',
                date: fullMsg.data.createdAt || new Date().toISOString()
            };
        }));
    } catch (e) {
        return [];
    }
}

// Helper for 1SecMail messages
async function fetch1SecMailMessages(email) {
    try {
        if (!email.includes('@')) return [];
        const [user, domain] = email.split('@');
        const res = await axios.get(`https://www.1secmail.com/api/v1/?action=getMessages&login=${user}&domain=${domain}`);
        const messages = res.data || [];
        return await Promise.all(messages.map(async (msg) => {
            const fullMsg = await axios.get(`https://www.1secmail.com/api/v1/?action=readMessage&login=${user}&domain=${domain}&id=${msg.id}`);
            return {
                id: msg.id,
                from: fullMsg.data.from || 'Unknown',
                subject: fullMsg.data.subject || '(No Subject)',
                text: fullMsg.data.textBody || fullMsg.data.body || '',
                date: fullMsg.data.date || new Date().toISOString()
            };
        }));
    } catch (e) {
        return [];
    }
}

// Helper for GuerrillaMail messages
async function fetchGuerrillaMessages(token) {
    try {
        const res = await axios.get(`http://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${token}`);
        const list = res.data.list || [];
        return list.map(m => ({
            id: m.mail_id,
            from: m.mail_from,
            subject: m.mail_subject || '(No Subject)',
            text: '', // Would need separate fetch for body
            date: m.mail_date || new Date().toISOString()
        }));
    } catch (e) {
        return [];
    }
}

// Helper for SmtpLabs messages
async function fetchSmtpLabsMessages(apiBase, apiKey, accountId, mailboxId) {
    try {
        const headers = { 'X-API-KEY': apiKey, 'Accept': 'application/json' };

        // 1. Resolve Mailbox if missing
        if (!mailboxId) {
            const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes`, { headers });
            const inbox = res.data?.member?.find(m => m.path === 'INBOX');
            if (inbox) mailboxId = inbox.id;
            else return [];
        }

        // 2. Get Messages
        const res = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages`, { headers });
        const messages = res.data?.member || [];

        return await Promise.all(messages.map(async (msg) => {
            // Fetch full content
            try {
                const fullRes = await axios.get(`${apiBase}/accounts/${accountId}/mailboxes/${mailboxId}/messages/${msg.id}`, { headers });
                const fullMsg = fullRes.data;
                return {
                    id: msg.id,
                    from: fullMsg.from?.address || 'Unknown',
                    subject: fullMsg.subject || '(No Subject)',
                    text: fullMsg.body?.text || '(Empty)',
                    date: fullMsg.createdAt || new Date().toISOString()
                };
            } catch (e) {
                return {
                    id: msg.id,
                    from: msg.from?.address || 'Unknown',
                    subject: msg.subject || '(No Subject)',
                    text: '',
                    date: msg.createdAt || new Date().toISOString()
                };
            }
        }));
    } catch (e) {
        console.error('SmtpLabs Fetch Error:', e.message);
        return [];
    }
}

/**
 * GET MESSAGES FUNCTION - for inbox fetching
 */
async function getMessages(sessionId, email) {
    // Detect provider from sessionId metadata if possible
    // We need to look up the session in DB? No, sessionId might be the account ID.
    // Let's check the global DB mailSessions if we can.

    // 0. Detect SmtpLabs (MB Mail)
    // Heuristic: If we have an email and the session ID is numeric/short ID
    // Check if we can get the session info from the database
    try {
        const db = require('../db');
        let session = db.data.mailSessions ? db.data.mailSessions[sessionId] : null;

        if (!session && db.data.mailSessions) {
            // If the passed sessionId is actually a token, find by token or id
            session = Object.values(db.data.mailSessions).find(s => s.token === sessionId || s.id === sessionId);
        }

        if (session && (session.provider === 'smtplabs' || session.provider === 'smtplabs_gateway')) {
            let apiBase = SMTP_API_BASE;
            let apiKey = SMTP_API_KEY;

            if (session.providerId) {
                const p = db.getProviderDecrypted(session.providerId);
                if (p) {
                    apiBase = p.apiUrl;
                    apiKey = p.apiKey;
                }
            }

            return await fetchSmtpLabsMessages(apiBase, apiKey, session.accountId || session.id, session.mailboxId);
        }
    } catch (e) { }
    // Try to detect provider from session/token format

    // 1. JWT tokens (Mail.tm/Mail.gw)
    if (sessionId && sessionId.length > 50 && !sessionId.includes('@')) {
        // Try Mail.tm
        try {
            const msgs = await fetchMailTmMessages('https://api.mail.tm', sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }

        // Try Mail.gw
        try {
            const msgs = await fetchMailTmMessages('https://api.mail.gw', sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }
    }

    // 2. Guerrilla Mail
    if (sessionId && sessionId.length > 20 && !sessionId.includes('@') && !sessionId.startsWith('ey')) {
        try {
            const msgs = await fetchGuerrillaMessages(sessionId);
            if (msgs.length > 0) return msgs;
        } catch (e) { }
    }

    // 3. 1SecMail
    const checkEmail = email || sessionId;
    if (checkEmail && checkEmail.includes('@')) {
        try {
            return await fetch1SecMailMessages(checkEmail);
        } catch (e) { }
    }

    return [];
}

module.exports = {
    createAccount,
    getOtp,
    getMessages
};
