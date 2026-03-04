const fs = require('fs');

const text = fs.readFileSync('c:/Users/mtmam/Desktop/telegram/web/index.html', 'utf8');
const lines = text.split('\n');

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('padding-bottom') || lines[i].includes('margin-bottom')) {
        console.log(`Line ${i + 1}: ${lines[i].trim()}`);
    }
}
