// Builds dist/flashlearn.html: the whole app (CSS, JS, seed decks, seed images) in one file,
// for a phone or anywhere a folder is awkward. Run: node tools/build-single.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const imgDir = path.join(root, 'decks/pcc-structures');
const images = {};
fs.readdirSync(imgDir).filter((f) => f.endsWith('.png')).forEach((f) => {
  images['decks/pcc-structures/' + f] = 'data:image/png;base64,' + fs.readFileSync(path.join(imgDir, f)).toString('base64');
});

const inline = (code) => '<script>\n' + code.replace(/<\/script/gi, '<\/script') + '\n</script>';
let html = read('index.html')
  .replace(/<link rel="stylesheet" href="css\/style\.css(\?v=[^"]*)?">/, () => '<style>\n' + read('css/style.css') + '\n</style>')
  .replace(/<script src="js\/core\.js(\?v=[^"]*)?"><\/script>/, () => inline(read('js/core.js')))
  .replace(/<script src="decks\/seed\.js(\?v=[^"]*)?"><\/script>/, () => inline(read('decks/seed.js') + '\nwindow.SEED_IMAGES = ' + JSON.stringify(images) + ';'))
  .replace(/<script src="js\/app\.js(\?v=[^"]*)?"><\/script>/, () => inline(read('js/app.js')));
if (/src="(js|decks)\//.test(html) || html.includes('css/style.css')) throw new Error('an asset was not inlined');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/flashlearn.html'), html, 'utf8');
console.log('dist/flashlearn.html', Math.round(html.length / 1024) + ' KB');
