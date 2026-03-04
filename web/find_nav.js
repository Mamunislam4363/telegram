const fs = require('fs');
const lines = fs.readFileSync('c:/Users/mtmam/Desktop/telegram/web/index.html', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('EARN') || lines[i].includes('Earn') || lines[i].includes('earn')) {
        console.log(`L${i + 1}: ${lines[i].trim()}`);
    }
}
