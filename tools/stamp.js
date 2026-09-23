// Adds a content hash to each asset link in index.html (css/style.css?v=ab12cd34)
// so browsers fetch a fresh copy after every change instead of a cached one.
// Run after editing any asset: node tools/stamp.js   (npm run build does it)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8');

for (const asset of ['css/style.css', 'js/core.js', 'decks/seed.js', 'js/app.js']) {
  const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 8);
  const escaped = asset.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp('"' + escaped + '(\\?v=[^"]*)?"');
  if (!re.test(html)) throw new Error('index.html does not reference ' + asset);
  html = html.replace(re, '"' + asset + '?v=' + hash + '"');
}

fs.writeFileSync(file, html, 'utf8');
console.log('stamped index.html');
