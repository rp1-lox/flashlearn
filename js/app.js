/* FlashLearn UI. Classic script (works from file://). Depends on window.FL and window.SEED_DECKS. */
(function () {
  'use strict';
  var FL = window.FL;
  var KEY = 'flashlearn.v1';
  var app = document.getElementById('app');

  // ================= storage =================
  var db = loadDb();

  function loadDb() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.decks)) return s;
    } catch (e) { /* fall through */ }
    return { decks: [], seeded: false };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { toast('Could not save: browser storage is full. Remove some images or export a backup.', 6000); return false; }
  }

  function fixDeck(d) {
    d.id = d.id || FL.uid('d');
    d.name = d.name || 'Untitled deck';
    d.folder = d.folder || '';
    d.cards = (d.cards || []).map(function (c) {
      return { id: c.id || FL.uid('c'), term: c.term || '', def: c.def || '', termImg: c.termImg || null, defImg: c.defImg || null, starred: !!c.starred };
    });
    d.settings = Object.assign(FL.defaultSettings(), d.settings || {});
    d.learn = d.learn || { progress: {}, round: null, roundNo: 0 };
    d.learn.progress = d.learn.progress || {};
    d.cram = d.cram || null;
    d.updated = d.updated || Date.now();
    return d;
  }

  // Adds each built-in deck once. When a built-in deck ships a higher
  // `version`, the copy in storage is replaced (cards and progress reset).
  // A built-in deck the user deleted is not re-added. Retired built-in decks
  // are removed.
  function seed() {
    var changed = false;
    if (!Array.isArray(db.seedIds)) {
      // Storage from before seedIds existed: every built-in deck present then
      // was already offered once.
      db.seedIds = db.seeded ? ['seed-pcc101-exam1', 'seed-pcc101-structures'] : [];
      changed = true;
    }
    (window.SEED_RETIRED || []).forEach(function (id) {
      var before = db.decks.length;
      db.decks = db.decks.filter(function (d) { return d.id !== id; });
      if (db.decks.length !== before) changed = true;
    });
    (window.SEED_DECKS || []).forEach(function (s) {
      var version = s.version || 1;
      var existing = getDeck(s.id);
      if (existing && db.seedIds.indexOf(s.id) === -1) { db.seedIds.push(s.id); changed = true; }
      if (!existing) {
        if (db.seedIds.indexOf(s.id) !== -1) return;
        db.seedIds.push(s.id);
        var fresh = fixDeck(JSON.parse(JSON.stringify(s)));
        fresh.seedVersion = version;
        db.decks.push(fresh);
        changed = true;
      } else if ((existing.seedVersion || 1) < version) {
        var copy = fixDeck(JSON.parse(JSON.stringify(s)));
        existing.name = copy.name;
        existing.cards = copy.cards;
        existing.learn = copy.learn;
        existing.cram = null;
        existing.seedVersion = version;
        existing.updated = Date.now();
        changed = true;
      }
    });
    if (!db.seeded) { db.seeded = true; changed = true; }
    if (changed) save();
  }
  db.decks = db.decks.map(fixDeck);
  seed();

  function getDeck(id) { return db.decks.filter(function (d) { return d.id === id; })[0]; }
  function touch(deck) { deck.updated = Date.now(); save(); }

  // ================= helpers =================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, rootEl) { return (rootEl || app).querySelector(sel); }
  function $$(sel, rootEl) { return Array.prototype.slice.call((rootEl || app).querySelectorAll(sel)); }
  function on(sel, ev, fn) { var el = $(sel); if (el) el.addEventListener(ev, fn); return el; }

  var toastTimer;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2500);
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function safeName(s) { return String(s).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'deck'; }

  function readFileText(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = rej;
      r.readAsText(file);
    });
  }

  /** Downscale an image file to a data URL (max 900px) so it fits in browser storage. */
  function imageToDataUrl(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = rej;
      r.onload = function () {
        var img = new Image();
        img.onerror = rej;
        img.onload = function () {
          var max = 900, w = img.naturalWidth, h = img.naturalHeight;
          if (file.size < 120000 && w <= max && h <= max) return res(r.result);
          var k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.85));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function pickFiles(accept, multiple) {
    return new Promise(function (res) {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.onchange = function () { res(Array.prototype.slice.call(inp.files || [])); };
      inp.click();
    });
  }

  // The single-file build (dist/) embeds the seed images; map their relative paths to data URLs.
  function imgSrc(src) { return (window.SEED_IMAGES && window.SEED_IMAGES[src]) || src; }
  function imgTag(src, cls) { return src ? '<img class="' + (cls || 'card-img') + '" src="' + esc(imgSrc(src)) + '" alt="">' : ''; }

  // ================= modal =================
  function modal(html, onMount) {
    closeModal();
    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap);
    $$('[data-close]', wrap).forEach(function (b) { b.addEventListener('click', closeModal); });
    if (onMount) onMount(wrap);
    return wrap;
  }
  function closeModal() { var m = document.querySelector('.modal-wrap'); if (m) m.remove(); }

  // ================= router =================
  var keyHandler = null;
  var timers = [];
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function render() {
    clearTimers();
    closeModal();
    keyHandler = null;
    var parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    window.scrollTo(0, 0);
    if (parts[0] === 'd' && parts[1]) {
      var deck = getDeck(decodeURIComponent(parts[1]));
      if (!deck) return go('#/');
      if (parts[2] === 'learn') return viewLearn(deck);
      if (parts[2] === 'cram') return viewCram(deck);
      if (parts[2] === 'flash') return viewFlash(deck);
      return viewDeck(deck);
    }
    viewHome();
  }
  window.addEventListener('hashchange', render);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.querySelector('.modal-wrap')) { closeModal(); return; }
    if (document.querySelector('.modal-wrap')) return;
    if (keyHandler) keyHandler(e);
  });

  // ================= home =================
  var homeFilter = '';
  var collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem(KEY + '.collapsed')) || {}; } catch (e) { collapsed = {}; }

  function deckStats(d) {
    var c = FL.learnCounts(d.cards, d.learn.progress, Date.now());
    return c;
  }

  function viewHome() {
    document.title = 'FlashLearn';
    app.innerHTML =
      '<header class="topbar"><h1>FlashLearn</h1><div class="grow"></div>' +
      '<button class="btn ghost" id="backup">Backup / Sync</button></header>' +
      '<main class="page">' +
      '<div class="row gap wrap">' +
      '<button class="btn primary" id="newDeck">+ New deck</button>' +
      '<button class="btn" id="importSets">Import from Quizlet</button>' +
      '</div>' +
      '<input class="search" id="deckSearch" type="search" placeholder="Search decks" value="' + esc(homeFilter) + '">' +
      '<div id="deckList"></div>' +
      '</main>';
    on('#newDeck', 'click', function () {
      var name = prompt('Deck name');
      if (!name) return;
      var d = fixDeck({ name: name.trim(), folder: '' });
      db.decks.unshift(d); touch(d);
      go('#/d/' + d.id);
    });
    on('#importSets', 'click', function () { importDialog(null); });
    on('#backup', 'click', backupDialog);
    on('#deckSearch', 'input', function (e) { homeFilter = e.target.value; renderDeckList(); });
    renderDeckList();
  }

  function renderDeckList() {
    var list = $('#deckList');
    var q = FL.normalize(homeFilter);
    var decks = db.decks.filter(function (d) { return !q || FL.normalize(d.name + ' ' + d.folder).indexOf(q) !== -1; });
    if (!decks.length) { list.innerHTML = '<p class="muted center">No decks yet. Create one or import from Quizlet.</p>'; return; }
    var groups = {};
    decks.forEach(function (d) { (groups[d.folder || ''] = groups[d.folder || ''] || []).push(d); });
    var names = Object.keys(groups).sort(function (a, b) { return a === '' ? 1 : b === '' ? -1 : a.localeCompare(b); });
    list.innerHTML = names.map(function (f) {
      var label = f || 'No folder';
      var isCol = collapsed[f] && !q;
      return '<section class="folder">' +
        '<button class="folder-head" data-folder="' + esc(f) + '"><span class="caret">' + (isCol ? '▸' : '▾') + '</span>' + esc(label) +
        ' <span class="muted">(' + groups[f].length + ')</span></button>' +
        (isCol ? '' : groups[f].map(function (d) {
          var s = deckStats(d), pct = s.total ? Math.round(100 * s.mastered / s.total) : 0;
          return '<a class="deck-row" href="#/d/' + encodeURIComponent(d.id) + '">' +
            '<div class="deck-name">' + esc(d.name) + '</div>' +
            '<div class="muted small">' + s.total + ' cards · ' + pct + '% mastered' + (s.due ? ' · ' + s.due + ' due' : '') + '</div>' +
            '<div class="minibar"><span style="width:' + pct + '%"></span></div></a>';
        }).join('')) + '</section>';
    }).join('');
    $$('.folder-head', list).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-folder');
        collapsed[f] = !collapsed[f];
        try { localStorage.setItem(KEY + '.collapsed', JSON.stringify(collapsed)); } catch (e) { /* ignore */ }
        renderDeckList();
      });
    });
  }

  // ================= import (Quizlet text, many sets / files) =================
  function sepValue(sel, custom) {
    if (sel === 'tab') return '\t';
    if (sel === 'comma') return ',';
    if (sel === 'dash') return ' - ';
    return custom || '\t';
  }

  function importDialog(targetDeck) {
    var folders = folderNames();
    modal(
      '<h2>' + (targetDeck ? 'Add cards to “' + esc(targetDeck.name) + '”' : 'Import from Quizlet') + '</h2>' +
      '<p class="muted small">In Quizlet: open the set → ⋯ → Export → Copy text. Default format: Tab between term and definition, new line between cards. ' +
      (targetDeck ? '' : 'Paste several sets at once by putting a line like <code># Set name</code> before each one, or choose several .txt files (each file becomes a deck).') + '</p>' +
      '<textarea id="impText" rows="8" placeholder="term&#9;definition"></textarea>' +
      (targetDeck ? '' : '<div class="row gap wrap"><button class="btn" id="impFiles">Choose .txt files…</button><span class="muted small" id="impFileInfo"></span></div>') +
      '<div class="grid2">' +
      '<label>Between term and definition<select id="impSep"><option value="tab">Tab</option><option value="comma">Comma</option><option value="dash">" - "</option><option value="custom">Custom</option></select></label>' +
      '<label>Custom separator<input id="impCustom" placeholder="e.g. ::"></label>' +
      '<label>Between cards<select id="impRow"><option value="nl">New line</option><option value="semi">Semicolon</option><option value="custom">Custom</option></select></label>' +
      '<label>Custom card separator<input id="impRowCustom" placeholder="e.g. ||"></label>' +
      '</div>' +
      (targetDeck ? '' : '<label>Deck name (if no # header)<input id="impName" placeholder="Imported deck"></label>' +
        '<label>Folder (optional)<input id="impFolder" list="folderList" placeholder="e.g. PCC 101"></label>' +
        '<datalist id="folderList">' + folders.map(function (f) { return '<option value="' + esc(f) + '">'; }).join('') + '</datalist>') +
      '<p class="small" id="impPreview"></p>' +
      '<div class="row gap end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="impGo">Import</button></div>',
      function (w) {
        var files = [];
        function opts() {
          var sep = sepValue($('#impSep', w).value, $('#impCustom', w).value);
          var rowSel = $('#impRow', w).value;
          var row = rowSel === 'semi' ? ';' : rowSel === 'custom' ? ($('#impRowCustom', w).value || '\n') : '\n';
          return { sep: sep, row: row };
        }
        function prep(text, o) { return o.row === '\n' ? text : String(text).split(o.row).join('\n'); }
        function collect() {
          var o = opts(), sets = [];
          var text = $('#impText', w).value;
          if (text.trim()) {
            var fallback = targetDeck ? targetDeck.name : (($('#impName', w) || {}).value || 'Imported deck');
            sets = sets.concat(FL.splitSets(prep(text, o), o.sep, fallback));
          }
          files.forEach(function (f) { sets = sets.concat(FL.splitSets(prep(f.text, o), o.sep, f.name)); });
          return sets;
        }
        function preview() {
          var sets = collect();
          var n = sets.reduce(function (a, s) { return a + s.cards.length; }, 0);
          $('#impPreview', w).textContent = n ? (targetDeck ? n + ' cards will be added.' :
            sets.length + ' deck' + (sets.length > 1 ? 's' : '') + ', ' + n + ' cards: ' + sets.map(function (s) { return s.name + ' (' + s.cards.length + ')'; }).join(', ')) : '';
        }
        $$('textarea, select, input', w).forEach(function (el) { el.addEventListener('input', preview); });
        var fb = $('#impFiles', w);
        if (fb) fb.addEventListener('click', function () {
          pickFiles('.txt,.tsv,.csv,text/plain', true).then(function (list) {
            return Promise.all(list.map(function (f) {
              return readFileText(f).then(function (t) { return { name: f.name.replace(/\.[^.]+$/, ''), text: t }; });
            }));
          }).then(function (arr) {
            files = files.concat(arr);
            $('#impFileInfo', w).textContent = files.map(function (f) { return f.name; }).join(', ');
            preview();
          });
        });
        $('#impGo', w).addEventListener('click', function () {
          var sets = collect();
          if (!sets.length) { toast('Nothing to import yet.'); return; }
          if (targetDeck) {
            sets.forEach(function (s) { s.cards.forEach(function (c) { targetDeck.cards.push({ id: FL.uid('c'), term: c.term, def: c.def, termImg: null, defImg: null, starred: false }); }); });
            touch(targetDeck);
            closeModal(); toast('Cards added.'); render();
            return;
          }
          var folder = ($('#impFolder', w).value || '').trim();
          var made = sets.map(function (s) {
            return fixDeck({ name: s.name, folder: folder, cards: s.cards });
          });
          db.decks = made.concat(db.decks);
          save();
          closeModal();
          toast('Imported ' + made.length + ' deck' + (made.length > 1 ? 's' : '') + '.');
          go(made.length === 1 ? '#/d/' + made[0].id : '#/');
        });
      });
  }

  function folderNames() {
    var s = {};
    db.decks.forEach(function (d) { if (d.folder) s[d.folder] = 1; });
    return Object.keys(s).sort();
  }

  // ================= backup / sync =================
  function backupDialog() {
    modal(
      '<h2>Backup and sync</h2>' +
      '<p class="muted small">Everything lives in this browser. To move decks and progress to your phone (or back), export a file here, send it to the other device (Drive, email, AirDrop), then Import it there. Import merges by deck: the newer copy of each deck wins.</p>' +
      '<div class="stack">' +
      '<button class="btn primary" id="bkExport">Export everything (.json)</button>' +
      (navigator.canShare ? '<button class="btn" id="bkShare">Share backup file…</button>' : '') +
      '<button class="btn" id="bkImport">Import backup (.json)…</button>' +
      '</div>' +
      '<p class="muted small">' + db.decks.length + ' decks · ' + db.decks.reduce(function (a, d) { return a + d.cards.length; }, 0) + ' cards · ~' + Math.round(JSON.stringify(db).length / 1024) + ' KB</p>' +
      '<div class="row end"><button class="btn ghost" data-close>Close</button></div>',
      function (w) {
        function payload() { return JSON.stringify({ app: 'flashlearn', version: 1, exported: new Date().toISOString(), decks: db.decks }); }
        var fname = 'flashlearn-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        $('#bkExport', w).addEventListener('click', function () { download(fname, payload(), 'application/json'); });
        var sh = $('#bkShare', w);
        if (sh) sh.addEventListener('click', function () {
          var file = new File([payload()], fname, { type: 'application/json' });
          if (navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'FlashLearn backup' }).catch(function () {});
          else download(fname, payload(), 'application/json');
        });
        $('#bkImport', w).addEventListener('click', function () {
          pickFiles('.json,application/json', true).then(function (files) {
            return Promise.all(files.map(readFileText));
          }).then(function (texts) {
            var added = 0, updated = 0, kept = 0;
            texts.forEach(function (t) {
              var data;
              try { data = JSON.parse(t); } catch (e) { toast('That file is not valid JSON.'); return; }
              var decks = Array.isArray(data) ? data : (data.decks || (data.cards ? [data] : []));
              decks.forEach(function (inc) {
                inc = fixDeck(inc);
                var cur = getDeck(inc.id);
                if (!cur) { db.decks.push(inc); added++; }
                else if ((inc.updated || 0) > (cur.updated || 0)) { db.decks[db.decks.indexOf(cur)] = inc; updated++; }
                else kept++;
              });
            });
            save(); closeModal(); render();
            toast('Import: ' + added + ' new, ' + updated + ' updated, ' + kept + ' already current.', 4000);
          });
        });
      });
  }

  // ================= deck page =================
  var cardFilter = '';

  function viewDeck(deck) {
    document.title = deck.name + ' · FlashLearn';
    var s = deckStats(deck);
    var starred = deck.cards.filter(function (c) { return c.starred; }).length;
    var cramInfo = deck.cram ? (deck.cram.phase === 'done' ? 'Complete' : deck.cram.phase === 'final' ? 'Final pass' : FL.cramCleared(deck.cram) + '/' + deck.cram.total + ' cleared') : 'Not started';
    app.innerHTML =
      '<header class="topbar"><a class="btn ghost icon" href="#/" aria-label="Back">←</a><h1 class="truncate">' + esc(deck.name) + '</h1><div class="grow"></div>' +
      '<button class="btn ghost icon" id="deckMenu" aria-label="Deck options">⋯</button></header>' +
      '<main class="page">' +
      (deck.folder ? '<div class="muted small">Folder: ' + esc(deck.folder) + '</div>' : '') +
      progressBar(s) +
      '<div class="modes">' +
      '<a class="mode" href="#/d/' + encodeURIComponent(deck.id) + '/learn"><b>Learn</b><span>Adaptive rounds · ' + s.mastered + '/' + s.total + ' mastered' + (s.due ? ' · ' + s.due + ' due' : '') + '</span></a>' +
      '<a class="mode" href="#/d/' + encodeURIComponent(deck.id) + '/cram"><b>Cram</b><span>Test is soon · ' + cramInfo + '</span></a>' +
      '<a class="mode" href="#/d/' + encodeURIComponent(deck.id) + '/flash"><b>Flashcards</b><span>Flip through · ' + starred + ' starred</span></a>' +
      '</div>' +
      '<div class="row gap wrap between"><h2>Cards (' + deck.cards.length + ')</h2><button class="btn" id="addCard">+ Add card</button></div>' +
      '<input class="search" id="cardSearch" type="search" placeholder="Search cards" value="' + esc(cardFilter) + '">' +
      '<p class="muted small">Tip: click a text box and paste a screenshot to add it as an image.</p>' +
      '<div id="cardList"></div>' +
      '<button class="btn wide" id="addCard2">+ Add card</button>' +
      '</main>';
    on('#addCard', 'click', addCard);
    on('#addCard2', 'click', addCard);
    on('#deckMenu', 'click', function () { deckMenu(deck); });
    on('#cardSearch', 'input', function (e) { cardFilter = e.target.value; renderCards(deck); });
    renderCards(deck);

    function addCard() {
      deck.cards.push({ id: FL.uid('c'), term: '', def: '', termImg: null, defImg: null, starred: false });
      touch(deck);
      cardFilter = '';
      var si = $('#cardSearch'); if (si) si.value = '';
      renderCards(deck);
      var rows = $$('.card-row');
      var last = rows[rows.length - 1];
      if (last) { last.scrollIntoView({ block: 'center' }); $('textarea', last).focus(); }
    }
  }

  function progressBar(s) {
    var t = s.total || 1;
    return '<div class="progress" aria-label="Learn progress">' +
      '<div class="bar"><span class="p-mastered" style="width:' + (100 * s.mastered / t) + '%"></span><span class="p-familiar" style="width:' + (100 * s.familiar / t) + '%"></span></div>' +
      '<div class="legend small"><span><i class="dot new"></i>New ' + s.new + '</span><span><i class="dot familiar"></i>Familiar ' + s.familiar + '</span><span><i class="dot mastered"></i>Mastered ' + s.mastered + '</span></div></div>';
  }

  function renderCards(deck) {
    var list = $('#cardList');
    if (!list) return;
    var q = FL.normalize(cardFilter);
    var cards = deck.cards.filter(function (c) { return !q || FL.normalize(c.term + ' ' + c.def).indexOf(q) !== -1; });
    list.innerHTML = cards.map(function (c) {
      var n = deck.cards.indexOf(c) + 1;
      return '<div class="card-row" data-id="' + esc(c.id) + '">' +
        '<div class="row between"><span class="muted small">' + n + '</span><div class="row">' +
        '<button class="btn ghost icon star' + (c.starred ? ' on' : '') + '" data-act="star" aria-label="Star">' + (c.starred ? '★' : '☆') + '</button>' +
        '<button class="btn ghost icon" data-act="del" aria-label="Delete card">🗑</button></div></div>' +
        side(c, 'term', 'Term') + side(c, 'def', 'Definition') + '</div>';
    }).join('') || '<p class="muted center">No cards match.</p>';

    function side(c, key, label) {
      var img = c[key + 'Img'];
      return '<div class="side"><label class="small muted">' + label + '</label>' +
        '<textarea rows="1" data-side="' + key + '">' + esc(c[key]) + '</textarea>' +
        '<div class="img-row">' + (img ? '<div class="thumb">' + imgTag(img, 'thumb-img') + '<button class="btn ghost icon" data-act="rmimg" data-side="' + key + '" aria-label="Remove image">✕</button></div>' : '') +
        '<button class="btn ghost small" data-act="img" data-side="' + key + '">' + (img ? 'Replace image' : '+ Image') + '</button></div></div>';
    }

    $$('textarea', list).forEach(autoGrow);
    list.oninput = function (e) {
      var ta = e.target;
      if (ta.tagName !== 'TEXTAREA') return;
      var card = cardOf(ta);
      card[ta.getAttribute('data-side')] = ta.value;
      autoGrow(ta);
      clearTimeout(ta._t);
      ta._t = setTimeout(function () { touch(deck); }, 400);
    };
    list.onpaste = function (e) {
      var ta = e.target;
      if (ta.tagName !== 'TEXTAREA') return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
          e.preventDefault();
          setImage(cardOf(ta), ta.getAttribute('data-side'), items[i].getAsFile());
          return;
        }
      }
    };
    list.onclick = function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var card = cardOf(b), act = b.getAttribute('data-act');
      if (act === 'star') { card.starred = !card.starred; touch(deck); renderCards(deck); }
      if (act === 'del') {
        if (!confirm('Delete this card?')) return;
        deck.cards.splice(deck.cards.indexOf(card), 1);
        delete deck.learn.progress[card.id];
        touch(deck); renderCards(deck);
      }
      if (act === 'img') pickFiles('image/*').then(function (f) { if (f[0]) setImage(card, b.getAttribute('data-side'), f[0]); });
      if (act === 'rmimg') { card[b.getAttribute('data-side') + 'Img'] = null; touch(deck); renderCards(deck); }
    };
    function cardOf(el) {
      var id = el.closest('.card-row').getAttribute('data-id');
      return deck.cards.filter(function (c) { return c.id === id; })[0];
    }
    function setImage(card, key, file) {
      imageToDataUrl(file).then(function (url) {
        var prev = card[key + 'Img'];
        card[key + 'Img'] = url;
        if (!save()) { card[key + 'Img'] = prev; return; }
        deck.updated = Date.now(); save();
        renderCards(deck); toast('Image added.');
      }).catch(function () { toast('Could not read that image.'); });
    }
  }

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }

  function deckMenu(deck) {
    modal(
      '<h2>' + esc(deck.name) + '</h2><div class="stack">' +
      '<button class="btn" data-a="rename">Rename</button>' +
      '<button class="btn" data-a="folder">Move to folder…</button>' +
      '<button class="btn" data-a="import">Add cards from Quizlet text…</button>' +
      '<button class="btn" data-a="export">Export as Quizlet text</button>' +
      '<button class="btn" data-a="json">Export deck + progress (.json)</button>' +
      '<button class="btn" data-a="reset">Reset Learn and Cram progress</button>' +
      '<button class="btn danger" data-a="delete">Delete deck</button>' +
      '</div><div class="row end"><button class="btn ghost" data-close>Close</button></div>',
      function (w) {
        w.querySelector('.stack').addEventListener('click', function (e) {
          var a = e.target.getAttribute('data-a');
          if (a === 'rename') { var n = prompt('Deck name', deck.name); if (n && n.trim()) { deck.name = n.trim(); touch(deck); render(); } }
          if (a === 'folder') {
            var fs = folderNames();
            var f = prompt('Folder name (empty for none)' + (fs.length ? '\nExisting: ' + fs.join(', ') : ''), deck.folder);
            if (f !== null) { deck.folder = f.trim(); touch(deck); render(); }
          }
          if (a === 'import') { importDialog(deck); }
          if (a === 'export') exportTextDialog(deck);
          if (a === 'json') download(safeName(deck.name) + '.json', JSON.stringify({ app: 'flashlearn', version: 1, decks: [deck] }), 'application/json');
          if (a === 'reset' && confirm('Reset all Learn and Cram progress for this deck?')) {
            deck.learn = { progress: {}, round: null, roundNo: 0 }; deck.cram = null; touch(deck); render();
          }
          if (a === 'delete' && confirm('Delete “' + deck.name + '” and all its cards? Export it first if unsure.')) {
            db.decks.splice(db.decks.indexOf(deck), 1); save(); go('#/');
          }
        });
      });
  }

  function exportTextDialog(deck) {
    var text = FL.exportText(deck.cards, '\t');
    modal('<h2>Export</h2><p class="muted small">Tab between term and definition, one card per line (Quizlet import format). Images are not included in text.</p>' +
      '<textarea id="expText" rows="10" readonly>' + esc(text) + '</textarea>' +
      '<div class="row gap end"><button class="btn" id="expCopy">Copy</button><button class="btn" id="expDl">Download .txt</button><button class="btn ghost" data-close>Close</button></div>',
      function (w) {
        $('#expCopy', w).addEventListener('click', function () {
          var ta = $('#expText', w); ta.select();
          (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied.'); }, function () { document.execCommand('copy'); toast('Copied.'); });
        });
        $('#expDl', w).addEventListener('click', function () { download(safeName(deck.name) + '.txt', text); });
      });
  }

  // ================= shared study pieces =================
  function sides(settings) {
    return settings.answerWith === 'term'
      ? { q: 'def', a: 'term', qLabel: 'Definition', aLabel: 'Term' }
      : { q: 'term', a: 'def', qLabel: 'Term', aLabel: 'Definition' };
  }

  function studyHeader(deck, title) {
    return '<header class="topbar"><a class="btn ghost icon" href="#/d/' + encodeURIComponent(deck.id) + '" aria-label="Close">✕</a>' +
      '<h1 class="truncate">' + title + '</h1><div class="grow"></div>' +
      '<button class="btn ghost icon" id="settingsBtn" aria-label="Settings">⚙</button></header>';
  }

  function settingsDialog(deck, mode) {
    var s = deck.settings;
    modal('<h2>' + (mode === 'cram' ? 'Cram' : 'Learn') + ' options</h2>' +
      '<label>Answer with<select id="stAns"><option value="def">Definition</option><option value="term">Term</option></select></label>' +
      '<fieldset><legend class="small">Question types</legend>' +
      '<label class="check"><input type="checkbox" id="stMc"' + (s.mc ? ' checked' : '') + '> Multiple choice</label>' +
      '<label class="check"><input type="checkbox" id="stWr"' + (s.written ? ' checked' : '') + '> Written</label></fieldset>' +
      '<label class="check"><input type="checkbox" id="stStar"' + (s.starredOnly ? ' checked' : '') + '> Study starred cards only</label>' +
      '<label>Cards per round<input id="stSize" type="number" min="3" max="30" value="' + s.roundSize + '"></label>' +
      '<div class="stack"><button class="btn" id="stReset">' + (mode === 'cram' ? 'Restart Cram' : 'Reset Learn progress') + '</button></div>' +
      '<div class="row gap end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="stSave">Save</button></div>',
      function (w) {
        $('#stAns', w).value = s.answerWith;
        $('#stSave', w).addEventListener('click', function () {
          var ns = {
            answerWith: $('#stAns', w).value, mc: $('#stMc', w).checked, written: $('#stWr', w).checked,
            starredOnly: $('#stStar', w).checked, roundSize: Math.max(3, Math.min(30, parseInt($('#stSize', w).value, 10) || 7)),
          };
          if (!ns.mc && !ns.written) ns.mc = true;
          var scopeChanged = ns.starredOnly !== s.starredOnly;
          deck.settings = ns;
          deck.learn.round = null; // rebuild round with new settings
          if (deck.cram && (scopeChanged || ns.roundSize !== s.roundSize)) deck.cram = null;
          touch(deck); closeModal(); render();
        });
        $('#stReset', w).addEventListener('click', function () {
          if (mode === 'cram') { if (!confirm('Restart Cram from the beginning?')) return; deck.cram = null; }
          else { if (!confirm('Reset all Learn progress for this deck?')) return; deck.learn = { progress: {}, round: null, roundNo: 0 }; }
          touch(deck); closeModal(); render();
        });
      });
  }

  /**
   * Render one question into #q. opts: {deck, card, type, scope, onDone(correct)}.
   * The answer is only committed when the learner moves on, so "I was right" needs no undo.
   */
  function askQuestion(opts) {
    var deck = opts.deck, card = opts.card, sd = sides(deck.settings);
    var type = opts.type;
    if (type === 'written' && !card[sd.a]) type = 'mc'; // image-only answer
    var box = $('#q');
    var prompt = '<div class="prompt"><div class="label small muted">' + sd.qLabel + (card.starred ? ' ★' : '') + '</div>' +
      (card[sd.q] ? '<div class="prompt-text">' + esc(card[sd.q]) + '</div>' : '') + imgTag(card[sd.q + 'Img']) + '</div>';
    var answered = false;

    if (type === 'mc') {
      var choices = FL.buildChoices(card, opts.scope, sd.a, 4);
      box.innerHTML = prompt + '<div class="small muted">Choose the matching ' + sd.aLabel.toLowerCase() + '</div>' +
        '<div class="choices">' + choices.map(function (c, i) {
          return '<button class="choice" data-i="' + i + '"><span class="key">' + (i + 1) + '</span><span class="ctext">' + esc(c.text) + imgTag(c.img, 'choice-img') + '</span></button>';
        }).join('') + '</div><button class="linkbtn" id="dk">Don’t know?</button><div id="fb"></div>';
      $$('.choice', box).forEach(function (b) { b.addEventListener('click', function () { pick(+b.getAttribute('data-i')); }); });
      on('#dk', 'click', function () { pick(-1); });
      keyHandler = function (e) {
        if (answered) return;
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= choices.length) { e.preventDefault(); pick(n - 1); }
      };
      function pick(i) {
        if (answered) return;
        answered = true;
        var right = i >= 0 && choices[i].id === card.id;
        $$('.choice', box).forEach(function (b, j) {
          b.disabled = true;
          if (choices[j].id === card.id) b.classList.add('right');
          else if (j === i) b.classList.add('wrong');
        });
        if (right) {
          $('#fb').innerHTML = '<div class="fb good">Nice! ✓</div>';
          later(function () { opts.onDone(true); }, 800);
        } else {
          $('#fb').innerHTML = '<div class="fb bad">' + (i < 0 ? 'Here’s the answer — you’ll see it again soon.' : 'Not quite — you’ll see it again soon.') + '</div>' + continueBtn();
          wireContinue(function () { opts.onDone(false); });
          revealFeedback();
        }
      }
      return;
    }

    // written
    box.innerHTML = prompt +
      '<form id="wform" autocomplete="off"><label class="small muted" for="wans">Type the ' + sd.aLabel.toLowerCase() + '</label>' +
      '<textarea id="wans" rows="2" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Type your answer"></textarea>' +
      '<div class="row gap"><button type="button" class="btn ghost" id="wdk">Don’t know</button><div class="grow"></div><button class="btn primary" type="submit">Answer</button></div></form><div id="fb"></div>';
    var input = $('#wans');
    input.focus();
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    on('#wform', 'submit', function (e) { e.preventDefault(); submit(); });
    on('#wdk', 'click', function () { submit(true); });
    keyHandler = null;

    function submit(dontKnow) {
      if (answered) return;
      var given = dontKnow ? '' : input.value;
      if (!dontKnow && !given.trim()) { input.focus(); return; }
      answered = true;
      input.readOnly = true;
      $('#wform .row').remove();
      var g = FL.grade(given, card[sd.a]);
      var ans = '<div class="answer-box"><div class="small muted">Correct answer</div><div class="answer-text">' + esc(card[sd.a]) + '</div>' + imgTag(card[sd.a + 'Img']) + '</div>';
      if (g.correct) {
        $('#fb').innerHTML = '<div class="fb good">' + (g.typo ? 'Correct (small typo) ✓' : 'Correct ✓') + '</div>' + ans + continueBtn();
        wireContinue(function () { opts.onDone(true); });
        if (!g.typo) later(function () { opts.onDone(true); }, 1400);
      } else {
        $('#fb').innerHTML = '<div class="fb bad">' + (dontKnow ? 'No problem — study this one.' : g.close ? 'Close, but not quite.' : 'Not quite.') + '</div>' +
          (dontKnow ? '' : '<div class="small muted">You wrote</div><div class="yours">' + esc(given) + '</div>') + ans +
          '<div class="row gap wrap">' + (dontKnow ? '' : '<button class="btn" id="override">I was right</button>') + '<div class="grow"></div>' + continueBtn(true) + '</div>';
        on('#override', 'click', function () { finish(true); });
        revealFeedback();
        wireContinue(function () { finish(false); });
      }
    }
    var finished = false;
    function finish(ok) { if (finished) return; finished = true; opts.onDone(ok); }
  }

  function revealFeedback() {
    var fb = document.getElementById('fb');
    if (fb) fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function continueBtn(inline) {
    return (inline ? '' : '<div class="row end">') + '<button class="btn primary" id="cont">Continue <span class="kbd">Enter</span></button>' + (inline ? '' : '</div>');
  }
  function wireContinue(fn) {
    var done = false;
    function go2() { if (done) return; done = true; clearTimers(); fn(); }
    var b = $('#cont');
    if (b) { b.addEventListener('click', go2); b.focus({ preventScroll: true }); }
    // delay key capture so the Enter that submitted doesn't also continue
    setTimeout(function () {
      keyHandler = function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); go2(); }
      };
    }, 250);
  }

  // ================= Learn =================
  function viewLearn(deck) {
    document.title = 'Learn · ' + deck.name;
    var scope = FL.scopeCards(deck.cards, deck.settings);
    var byId = {};
    scope.forEach(function (c) { byId[c.id] = c; });
    var L = deck.learn;
    var now = Date.now();

    // drop stale ids from a saved round
    if (L.round) L.round.queue = L.round.queue.filter(function (id) { return byId[id]; });
    if (!L.round || (!L.round.queue.length && !L.round.showSummary)) {
      L.round = FL.buildRound(scope, L.progress, deck.settings, now);
      if (L.round) { L.roundNo = (L.roundNo || 0) + 1; L.round.ids = L.round.queue.slice(); }
      save();
    }

    var counts = FL.learnCounts(scope, L.progress, now);
    app.innerHTML = studyHeader(deck, 'Learn') + '<main class="page study">' + progressBar(counts) +
      (L.round ? '<div class="small muted center">Round ' + L.roundNo + ' · ' + L.round.done.length + ' of ' + L.round.size + ' learned' + '</div>' : '') +
      '<div id="q" tabindex="-1"></div></main>';
    on('#settingsBtn', 'click', function () { settingsDialog(deck, 'learn'); });

    if (!scope.length) { $('#q').innerHTML = emptyScope(deck); return; }
    if (!L.round) { return learnAllDone(deck, scope, counts); }
    if (L.round.showSummary) return learnSummary(deck, byId);

    var id = L.round.queue[0];
    var card = byId[id];
    var st = FL.cardState(L.progress, id);
    var type = FL.questionType(st, deck.settings, now);
    askQuestion({
      deck: deck, card: card, type: type, scope: scope,
      onDone: function (correct) {
        FL.learnAnswer(L.round, L.progress, id, correct, Date.now());
        if (!L.round.queue.length) L.round.showSummary = true;
        touch(deck); render();
      },
    });
  }

  function emptyScope(deck) {
    return '<div class="center stack"><p>' + (deck.settings.starredOnly ? 'No starred cards. Star some cards or turn off “starred only”.' : 'This deck has no complete cards yet.') + '</p>' +
      '<a class="btn" href="#/d/' + encodeURIComponent(deck.id) + '">Back to deck</a></div>';
  }

  function learnSummary(deck, byId) {
    var r = deck.learn.round;
    var P = deck.learn.progress;
    var missed = r.missed.filter(function (id) { return byId[id]; });
    var sd = sides(deck.settings);
    $('#q').innerHTML = '<div class="summary"><h2>Round ' + deck.learn.roundNo + ' complete</h2>' +
      '<p>' + r.correct + ' of ' + r.answered + ' answers right' + (missed.length ? ' · ' + missed.length + ' to keep practicing' : ' · no misses!') + '</p>' +
      (missed.length ? '<h3>Missed this round</h3><div class="review-list">' + missed.map(function (id) {
        var c = byId[id];
        return '<div class="review-item"><div><b>' + esc(c[sd.q]) + '</b>' + imgTag(c[sd.q + 'Img'], 'thumb-img') + '</div><div>' + esc(c[sd.a]) + '</div></div>';
      }).join('') + '</div>' : '') +
      '<h3>Cards in this round</h3><div class="review-list">' + (r.ids || []).filter(function (id) { return byId[id]; }).map(function (id) {
        var st = FL.cardState(P, id);
        var lab = ['New', 'Familiar', 'Mastered'][st.stage];
        return '<div class="review-item row between"><span class="truncate">' + esc(byId[id][sd.a] || byId[id][sd.q] || '(image)') + '</span><span class="tag t' + st.stage + '">' + lab + '</span></div>';
      }).join('') + '</div>' +
      '<div class="row end"><button class="btn primary" id="cont">Continue <span class="kbd">Enter</span></button></div></div>';
    wireContinue(function () { deck.learn.round = null; save(); render(); });
  }

  function learnAllDone(deck, scope, counts) {
    var next = Infinity;
    scope.forEach(function (c) { var st = FL.cardState(deck.learn.progress, c.id); if (st.srs && st.srs.due < next) next = st.srs.due; });
    $('#q').innerHTML = '<div class="summary center"><h2>All ' + counts.total + ' cards mastered 🎉</h2>' +
      (next < Infinity ? '<p>Next spaced review: <b>' + new Date(next).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</b>. Come back then and Learn will quiz the cards that are due.</p>' : '') +
      '<p class="muted">Test coming up? Cram drills everything again right now.</p><div class="stack">' +
      '<a class="btn primary" href="#/d/' + encodeURIComponent(deck.id) + '/cram">Cram now</a>' +
      '<button class="btn" id="relearn">Start Learn over</button></div></div>';
    on('#relearn', 'click', function () {
      if (!confirm('Reset Learn progress for this deck?')) return;
      deck.learn = { progress: {}, round: null, roundNo: 0 }; touch(deck); render();
    });
  }

  // ================= Cram =================
  function viewCram(deck) {
    document.title = 'Cram · ' + deck.name;
    var scope = FL.scopeCards(deck.cards, deck.settings);
    var byId = {};
    scope.forEach(function (c) { byId[c.id] = c; });
    var C = deck.cram;
    app.innerHTML = studyHeader(deck, 'Cram') + '<main class="page study"><div id="cramBar"></div><div id="q" tabindex="-1"></div></main>';
    on('#settingsBtn', 'click', function () { settingsDialog(deck, 'cram'); });
    if (!scope.length) { $('#q').innerHTML = emptyScope(deck); return; }

    if (!C) {
      $('#q').innerHTML = '<div class="summary"><h2>Cram ' + scope.length + ' cards</h2>' +
        '<p>For a test that is coming up soon. No waiting between reviews:</p><ol class="steps">' +
        '<li>Small batches of about ' + deck.settings.roundSize + ' cards cycle over and over.</li>' +
        (deck.settings.mc ? '<li>Each card starts as multiple choice, then you type it.</li>' : '<li>You type each answer.</li>') +
        '<li>Misses come back two questions later.</li>' +
        '<li>A card is cleared once you type it right.</li>' +
        '<li>When every card is cleared: one final shuffled pass over everything.</li></ol>' +
        '<p class="muted small">Cram progress is separate from Learn. You can leave and resume any time.</p>' +
        '<div class="row end"><button class="btn primary" id="cont">Start cram <span class="kbd">Enter</span></button></div></div>';
      wireContinue(function () { deck.cram = FL.cramInit(scope, deck.settings); touch(deck); render(); });
      return;
    }

    FL.cramSync(C, scope);
    var cleared = FL.cramCleared(C);
    var bar;
    if (C.phase === 'drill') {
      bar = barHtml(cleared, C.total, 'Cleared ' + cleared + ' of ' + C.total + (C.pending.length ? ' · ' + C.pending.length + ' not seen yet' : ''));
    } else {
      var fd = C.finalDone.length, ft = fd + C.final.length;
      bar = barHtml(fd, ft, 'Final pass · ' + fd + ' of ' + ft);
    }
    $('#cramBar').innerHTML = bar;

    if (C.phase === 'done') return cramDone(deck, byId);

    var nx = FL.cramNext(C, deck.settings);
    if (!nx || !byId[nx.id]) { save(); return render(); }
    askQuestion({
      deck: deck, card: byId[nx.id], type: nx.type, scope: scope,
      onDone: function (correct) {
        var before = C.phase;
        FL.cramAnswer(C, nx.id, nx.type, correct, deck.settings);
        touch(deck);
        if (before === 'drill' && C.phase === 'final') return cramInterstitial(deck);
        render();
      },
    });
  }

  function barHtml(n, t, label) {
    return '<div class="progress"><div class="bar"><span class="p-mastered" style="width:' + (t ? 100 * n / t : 0) + '%"></span></div><div class="small muted center">' + label + '</div></div>';
  }

  function cramInterstitial(deck) {
    $('#q').innerHTML = '<div class="summary center"><h2>Every card cleared ✓</h2><p>Last step: one shuffled pass through all ' + deck.cram.total + ' cards. Misses come back until you get them.</p>' +
      '<div class="row end"><button class="btn primary" id="cont">Start final pass <span class="kbd">Enter</span></button></div></div>';
    wireContinue(render);
  }

  function cramDone(deck, byId) {
    var C = deck.cram, sd = sides(deck.settings);
    var trouble = Object.keys(C.misses).filter(function (id) { return byId[id]; }).sort(function (a, b) { return C.misses[b] - C.misses[a]; });
    var acc = C.answered ? Math.round(100 * C.correct / C.answered) : 0;
    $('#q').innerHTML = '<div class="summary"><h2>Cram complete 🎉</h2><p>' + C.total + ' cards · ' + C.answered + ' answers · ' + acc + '% of answers right.</p>' +
      (trouble.length ? '<h3>Trouble cards (' + trouble.length + ')</h3><div class="review-list">' + trouble.slice(0, 40).map(function (id) {
        var c = byId[id];
        return '<div class="review-item"><div><b>' + esc(c[sd.q]) + '</b> <span class="muted small">missed ' + C.misses[id] + '×</span>' + imgTag(c[sd.q + 'Img'], 'thumb-img') + '</div><div>' + esc(c[sd.a]) + '</div></div>';
      }).join('') + '</div>' : '<p>No misses at all.</p>') +
      '<div class="stack">' +
      (trouble.length ? '<button class="btn" id="starTrouble">Star the trouble cards</button>' : '') +
      '<button class="btn primary" id="again">Cram again</button>' +
      '<a class="btn" href="#/d/' + encodeURIComponent(deck.id) + '">Back to deck</a></div></div>';
    on('#again', 'click', function () { deck.cram = null; touch(deck); render(); });
    on('#starTrouble', 'click', function () {
      trouble.forEach(function (id) { byId[id].starred = true; });
      touch(deck); toast(trouble.length + ' cards starred. Turn on “starred only” to drill just these.', 4000);
    });
  }

  // ================= Flashcards =================
  var flash = null;

  function viewFlash(deck) {
    document.title = 'Flashcards · ' + deck.name;
    if (!flash || flash.deckId !== deck.id) flash = { deckId: deck.id, i: 0, flipped: false, shuffled: false, starredOnly: false, order: null, front: 'term' };
    var cards = deck.cards.filter(function (c) { return !flash.starredOnly || c.starred; });
    if (!flash.order || flash.order.length !== cards.length) {
      flash.order = cards.map(function (c) { return c.id; });
      if (flash.shuffled) flash.order = FL.shuffle(flash.order);
      flash.i = Math.min(flash.i, Math.max(0, cards.length - 1));
    }
    var byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });
    var card = byId[flash.order[flash.i]];
    var sideKey = flash.flipped ? (flash.front === 'term' ? 'def' : 'term') : flash.front;

    app.innerHTML =
      '<header class="topbar"><a class="btn ghost icon" href="#/d/' + encodeURIComponent(deck.id) + '" aria-label="Close">✕</a><h1>Flashcards</h1><div class="grow"></div>' +
      '<span class="muted small">' + (cards.length ? flash.i + 1 : 0) + ' / ' + cards.length + '</span></header>' +
      '<main class="page study">' +
      (card ? '<button class="flashcard' + (flash.flipped ? ' flipped' : '') + '" id="fc" aria-label="Flip card">' +
        '<span class="label small muted">' + (sideKey === 'term' ? 'Term' : 'Definition') + '</span>' +
        (card[sideKey] ? '<span class="fc-text">' + esc(card[sideKey]) + '</span>' : '') + imgTag(card[sideKey + 'Img']) +
        '<span class="small muted hint">Tap or Space to flip</span></button>' :
        '<p class="center muted">' + (flash.starredOnly ? 'No starred cards.' : 'No cards.') + '</p>') +
      '<div class="row gap center-row">' +
      '<button class="btn icon big" id="prev" aria-label="Previous">←</button>' +
      (card ? '<button class="btn icon big star' + (card.starred ? ' on' : '') + '" id="fstar" aria-label="Star">' + (card.starred ? '★' : '☆') + '</button>' : '') +
      '<button class="btn icon big" id="next" aria-label="Next">→</button></div>' +
      '<div class="row gap wrap center-row">' +
      '<button class="btn toggle' + (flash.shuffled ? ' on' : '') + '" id="shuf">Shuffle</button>' +
      '<button class="btn toggle' + (flash.starredOnly ? ' on' : '') + '" id="sonly">Starred only</button>' +
      '<button class="btn" id="front">Front: ' + (flash.front === 'term' ? 'Term' : 'Definition') + '</button></div>' +
      '</main>';

    function move(d) {
      if (!cards.length) return;
      flash.i = (flash.i + d + cards.length) % cards.length; flash.flipped = false; viewFlash(deck);
    }
    function flip() { flash.flipped = !flash.flipped; viewFlash(deck); }
    on('#fc', 'click', flip);
    on('#prev', 'click', function () { move(-1); });
    on('#next', 'click', function () { move(1); });
    on('#fstar', 'click', function () { card.starred = !card.starred; touch(deck); viewFlash(deck); });
    on('#shuf', 'click', function () {
      flash.shuffled = !flash.shuffled;
      flash.order = flash.shuffled ? FL.shuffle(cards.map(function (c) { return c.id; })) : cards.map(function (c) { return c.id; });
      flash.i = 0; flash.flipped = false; viewFlash(deck);
    });
    on('#sonly', 'click', function () { flash.starredOnly = !flash.starredOnly; flash.order = null; flash.i = 0; flash.flipped = false; viewFlash(deck); });
    on('#front', 'click', function () { flash.front = flash.front === 'term' ? 'def' : 'term'; flash.flipped = false; viewFlash(deck); });

    // swipe on touch
    var fc = $('#fc');
    if (fc) {
      var sx = null;
      fc.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
      fc.addEventListener('touchend', function (e) {
        if (sx == null) return;
        var dx = e.changedTouches[0].clientX - sx; sx = null;
        if (Math.abs(dx) > 60) { e.preventDefault(); move(dx < 0 ? 1 : -1); }
      });
    }
    keyHandler = function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (e.key === 's' && card) { card.starred = !card.starred; touch(deck); viewFlash(deck); }
    };
  }

  // ================= start =================
  render();
  window.__flashlearn = { db: db, render: render }; // for debugging in the console
})();
