const { extractOTP } = require('./services/otp-extractor');

const emailText = `[https://static.xx.fbcdn.net/rsrc.php/v4/y/b/r/QTa-gpOyYBa.png] Hi, Someone tried to sign up for an Instagram account with mamunislam4363894@gmail.com. If it was you, enter this confirmation code in the app: 502431 Meta [https://static.xx.fbcdn.net/rsrc.php/v4/y/w/r/EK_fa82Ffa5.png] © Instagram. Meta Platforms, Inc., 1601 Willow Road, Menlo Park, CA 94025 This message was sent to mamunislam4363894@gmail.com.`;

const subject = `502431 is your Instagram code`;

console.log(extractOTP(emailText, ''));
