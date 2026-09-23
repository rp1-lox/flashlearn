// Merges fake-answer files (fakes_*.json, each {"<exact source term line>": ["fake", ...]})
// into decks/src/pcc101-fakes.json. Run: node tools/merge-fakes.js [dir]
// Then run `node tools/build-seed.js` to attach them to the seed cards.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'D:/Nautilus/data/pcc101/fakes';
const out = path.join(__dirname, '..', 'decks/src/pcc101-fakes.json');
const files = fs.readdirSync(dir).filter((f) => /^fakes_\d+\.json$/.test(f)).sort();
const merged = {};
files.forEach((f) => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  let n = 0;
  Object.keys(data).forEach((k) => {
    if (!Array.isArray(data[k])) throw new Error(f + ': value for "' + k + '" is not an array');
    const list = merged[k] || (merged[k] = []);
    data[k].forEach((x) => { x = String(x).trim(); if (x && !list.includes(x)) list.push(x); });
    n++;
  });
  console.log(f + ': ' + n + ' terms');
});
fs.writeFileSync(out, JSON.stringify(merged, null, 1) + '\n', 'utf8');
console.log('wrote decks/src/pcc101-fakes.json: ' + Object.keys(merged).length + ' terms from ' + files.length + ' files (' + files.join(', ') + ')');
