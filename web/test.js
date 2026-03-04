const fs = require('fs');
const html = fs.readFileSync('admin.html', 'utf8');
const lines = html.split('\n');
console.log(lines.filter(l => l.includes('class=')).slice(0, 10).join('\n'));
