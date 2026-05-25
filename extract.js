const fs = require('fs');
const html = fs.readFileSync('register.html', 'utf8');
const regex = /<option value="(\d+)">\s*([A-Z]{3})\(([^)]+)\)<\/option>/g;
let match;
const options = [];
while ((match = regex.exec(html)) !== null) {
  const code = match[2];
  const symbol = match[3];
  options.push(`<option value="${code}">${code} (${symbol})</option>`);
}
fs.writeFileSync('currencies.txt', options.join('\n'));
console.log('Done, found ' + options.length + ' currencies');
