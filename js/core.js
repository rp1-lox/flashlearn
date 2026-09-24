/* FlashLearn core logic: pure functions, no DOM.
 * Loaded as a classic <script> in the browser (exposes window.FL) and via
 * require() in Node tests. Classic script so index.html works under file://.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FL = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 24 * 60 * 60 * 1000;
  var NEW = 0, FAMILIAR = 1, MASTERED = 2;

  // ---------- small helpers ----------
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------- import / export ----------
  var IMG_NOTE = /\s*\(add image [^)]*\)\s*/i;

  /** Parse Quizlet export text: one card per line, separator between term and definition. */
  function parseImport(text, sep) {
    if (sep == null || sep === '' || sep === 'tab') sep = '\t';
    var cards = [];
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      if (!line.trim()) return;
      var i = line.indexOf(sep);
      var term, def;
      if (i === -1) { term = line; def = ''; }
      else { term = line.slice(0, i); def = line.slice(i + sep.length); }
      cards.push({ term: term.trim(), def: def.trim() });
    });
    return cards;
  }

  /**
   * Split pasted text holding several sets. A line starting with "#" names a
   * new set ("# Biology Ch 3"). Text before any header uses fallbackName.
   * Returns [{name, cards}] with empty sets dropped.
   */
  function splitSets(text, sep, fallbackName) {
    var sets = [], cur = { name: fallbackName || 'Imported deck', lines: [] };
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
      var m = /^\s*#+\s*(.+?)\s*$/.exec(line);
      if (m) { sets.push(cur); cur = { name: m[1], lines: [] }; }
      else cur.lines.push(line);
    });
    sets.push(cur);
    return sets.map(function (s) { return { name: s.name, cards: parseImport(s.lines.join('\n'), sep) }; })
      .filter(function (s) { return s.cards.length; });
  }

  /** Remove the "(add image NN.png)" note and return the image number, if any. */
  function stripImageNote(term) {
    var m = /\(add image\s+([^)]+)\)/i.exec(term);
    return { term: term.replace(IMG_NOTE, ' ').replace(/\s+:/, ':').replace(/\s{2,}/g, ' ').trim(), image: m ? m[1].trim() : null };
  }

  function exportText(cards, sep) {
    if (sep == null || sep === '' || sep === 'tab') sep = '\t';
    return cards.map(function (c) {
      return String(c.term).replace(/\n/g, ' ') + sep + String(c.def).replace(/\n/g, ' ');
    }).join('\n');
  }

  // ---------- grading ----------
  function normalize(s) {
    s = String(s || '');
    if (s.normalize) s = s.normalize('NFKC'); // CH₄ -> CH4, ² -> 2
    s = s.toLowerCase()
      .replace(/[→⟶]/g, ' to ')
      .replace(/&/g, ' and ')
      .replace(/\+/g, ' plus ')                       // "n + 1" must not equal "n - 1"
      .replace(/[×*]/g, ' times ')
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')          // 1,783 -> 1783 (but "2,8,8" stays a list)
      .replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 to $2')     // 2-10 -> 2 to 10
      .replace(/(\d)\.(\d)/g, '$1\u0001$2')            // keep decimal points
      .replace(/[^\p{L}\p{N}\s\u0001]/gu, ' ')
      .replace(/\u0001/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
  }

  // Words that carry no meaning in a short answer ("up and to the right" = "up and right").
  var FILLER = { the: 1, a: 1, an: 1, to: 1, of: 1, and: 1, or: 1, by: 1 };
  var NUMBER_WORDS = { zero: '0', none: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
    seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };
  // Element names typed for symbols ("sodium" for "Na").
  var ELEMENTS = { hydrogen: 'h', helium: 'he', carbon: 'c', nitrogen: 'n', oxygen: 'o', fluorine: 'f', neon: 'ne',
    sodium: 'na', aluminum: 'al', aluminium: 'al', sulfur: 's', chlorine: 'cl', argon: 'ar', potassium: 'k', iron: 'fe' };
  var KEEP_S = { plus: 1, this: 1, thus: 1, less: 1, gas: 1, has: 1, was: 1, yes: 1, its: 1, is: 1, as: 1 };

  function isNum(t) { return /^\d+(\.\d+)?$/.test(t); }

  /** Canonical answer tokens: normalized, filler dropped, plurals and number/element words unified. */
  function tokensOf(s) {
    return normalize(s).split(' ').filter(Boolean).map(function (t) {
      if (NUMBER_WORDS[t]) return NUMBER_WORDS[t];
      if (t.length > 3 && /s$/.test(t) && !/ss$/.test(t) && !KEEP_S[t] && !isNum(t)) t = t.slice(0, -1);
      return ELEMENTS[t] || t;
    }).filter(function (t) { return !FILLER[t]; });
  }

  /** A typed number matches if equal, or if it is the answer rounded to fewer decimals (226 for 226.32). */
  function numbersMatch(g, a) {
    if (parseFloat(g) === parseFloat(a)) return true;
    var dg = (g.split('.')[1] || '').length, da = (a.split('.')[1] || '').length;
    return dg < da && parseFloat(a).toFixed(dg) === parseFloat(g).toFixed(dg);
  }

  /**
   * Compare typed tokens G with answer tokens A. Returns {ok, d} where d is the
   * number of forgiven typos. Numbers, anything containing a digit, and short
   * tokens (symbols like Na, Cl) must match exactly; longer words get typo room.
   */
  function tokenMatch(G, A, listy) {
    var gj = G.join(' '), aj = A.join(' ');
    if (!aj) return { ok: false, d: Infinity };
    if (gj === aj || G.join('') === A.join('')) return { ok: true, d: 0 };
    if (listy && G.length === A.length && G.slice().sort().join(' ') === A.slice().sort().join(' ')) return { ok: true, d: 0 };
    if (G.length === A.length) {
      var d = 0;
      for (var i = 0; i < A.length; i++) {
        var a = A[i], g = G[i];
        if (g === a) continue;
        if (isNum(a) && isNum(g)) { if (numbersMatch(g, a)) continue; return { ok: false, d: Infinity }; }
        if (/\d/.test(a) || /\d/.test(g) || a.length < 4) return { ok: false, d: Infinity };
        var di = levenshtein(g, a);
        if (di > typoTolerance(a.length)) return { ok: false, d: Infinity };
        d += di;
      }
      return { ok: true, d: d };
    }
    // Different word counts: allow spacing differences plus typos on long answers.
    var gs = G.join(''), as = A.join('');
    if (as.length < 8 || digitsOf(gs) !== digitsOf(as)) return { ok: false, d: Infinity };
    var ds = levenshtein(gs, as);
    return ds <= typoTolerance(as.length) ? { ok: true, d: ds } : { ok: false, d: Infinity };
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var pp = new Array(b.length + 1), prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        // adjacent transposition counts as one typo (optimal string alignment)
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      }
      var t = pp; pp = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  /** Allowed typos for an answer of this (normalized) length. */
  function typoTolerance(len) {
    if (len < 4) return 0;
    if (len < 8) return 1;
    if (len < 15) return 2;
    return Math.min(6, Math.floor(len / 6));
  }

  /**
   * Accepted forms of an answer: the full text, and the text without a
   * spaced-off aside like "organic chemistry (carbon-based)". Parentheses that
   * are part of the answer itself, as in "C(=O)-NH" or "poly(acrylic acid)",
   * are never dropped.
   */
  function answerVariants(answer) {
    var raw = String(answer || '');
    var out = [raw];
    var noAside = raw.replace(/\s\([^)]*\)/g, ' ').trim();
    if (noAside && noAside !== raw) out.push(noAside);
    return out;
  }

  // Answers that are unordered lists ("polymers and colorants", "ionic and covalent").
  function isListy(answer) { return /\s(and|or)\s|,|&/i.test(answer) && !/\d/.test(answer); }

  function digitsOf(s) { return (s.match(/\d+/g) || []).join(','); }

  /**
   * Returns {correct, close, typo}. close = near miss worth showing an override for.
   * Typos are forgiven by length, except in numbers: "C2H4" is not "C2H6", and
   * "12.01" is not "14.01". `wrongs` (optional) lists known wrong answers (the
   * card's fakes, other cards' answers): a typo-level match that is at least as
   * close to one of them as to the answer is not accepted ("alkene" for "alkane").
   */
  function grade(given, answer, wrongs) {
    var G = tokensOf(given);
    if (!normalize(given)) return { correct: false, close: false };
    var variants = answerVariants(answer);
    var listy = isListy(answer);
    var best = Infinity, bestLen = 1;
    for (var i = 0; i < variants.length; i++) {
      var A = tokensOf(variants[i]);
      var m = tokenMatch(G, A, listy);
      if (m.ok) {
        if (m.d > 0 && wrongs && wrongs.length) {
          var aj = A.join(' ');
          for (var j = 0; j < wrongs.length; j++) {
            var W = tokensOf(wrongs[j]);
            if (!W.length || W.join(' ') === aj) continue;
            var mw = tokenMatch(G, W, isListy(wrongs[j]));
            if (mw.ok && mw.d <= m.d) return { correct: false, close: true, wrong: wrongs[j] };
          }
        }
        return { correct: true, close: false, typo: m.d > 0 };
      }
      var gj = G.join(' '), vj = A.join(' ');
      var dd = levenshtein(gj, vj);
      if (dd < best) { best = dd; bestLen = vj.length; }
    }
    return { correct: false, close: best <= Math.max(3, bestLen * 0.4) };
  }

  // ---------- multiple choice distractors ----------
  function words(s) {
    return normalize(s).split(' ').filter(function (w) { return w.length > 2; });
  }

  function plausibility(answer, other) {
    var a = String(answer || ''), o = String(other || '');
    var la = a.length || 1, lo = o.length || 1;
    var lenScore = 1 - Math.abs(la - lo) / Math.max(la, lo);
    var wa = words(a), wo = words(o);
    var shared = 0;
    wa.forEach(function (w) { if (wo.indexOf(w) !== -1) shared++; });
    var overlap = wa.length && wo.length ? shared / Math.min(wa.length, wo.length) : 0;
    var digits = (/\d/.test(a) === /\d/.test(o)) ? 0.3 : 0;
    var first = wa[0] && wa[0] === wo[0] ? 0.3 : 0;
    return lenScore + overlap * 1.5 + digits + first;
  }

  /**
   * Deck-based distractors for `card` on `side`: up to `need` other cards'
   * answers, favoring plausible ones. `seen` holds keys already used
   * (normalized text + '|' + image) and is updated.
   */
  function deckDistractors(card, cards, side, need, rng, seen) {
    if (need <= 0) return [];
    var imgKey = side === 'term' ? 'termImg' : 'defImg';
    var ans = card[side];
    var nAns = normalize(ans);
    var pool = [];
    cards.forEach(function (c) {
      if (c.id === card.id) return;
      var key = normalize(c[side]) + '|' + (c[imgKey] || '');
      if (seen[key] || (!c[side] && !c[imgKey])) return;
      // skip options that are a sub/superstring of the right answer ("Acetylene" vs "Acetylene, alkyne"): both would look correct
      var nc = normalize(c[side]);
      if (!c[imgKey] && !card[imgKey] && nc && nAns && (nc.indexOf(nAns) !== -1 || nAns.indexOf(nc) !== -1)) return;
      seen[key] = true;
      pool.push({ c: c, s: plausibility(ans, c[side]) + rng() * 0.3 });
    });
    pool.sort(function (a, b) { return b.s - a.s; });
    // take from the top plausible slice, randomized so options vary between asks
    var top = shuffle(pool.slice(0, need + 1), rng).slice(0, need);
    return top.map(function (p) { return { id: p.c.id, text: p.c[side], img: p.c[imgKey] || null }; });
  }

  /**
   * Build MC options for card `card` answering with `side` ('def' or 'term').
   * Returns array of {id, text, img} (length <= n) including the correct one.
   * When answering with the definition and the card has fake answers, the
   * least-shown fakes fill the wrong options first (option.fake = the fake's
   * text; `shown` maps fake text -> times shown). Remaining slots come from
   * the same deck, favoring plausible ones.
   */
  function buildChoices(card, cards, side, n, rng, shown) {
    rng = rng || Math.random;
    n = n || 4;
    var imgKey = side === 'term' ? 'termImg' : 'defImg';
    var ans = card[side];
    var seen = {};
    seen[normalize(ans) + '|' + (card[imgKey] || '')] = true;
    var opts = [];
    if (side === 'def') {
      pickFakes(cleanFakes(card.fakes, ans).fakes, shown, n - 1, rng).forEach(function (f, i) {
        var key = normalize(f) + '|';
        if (seen[key]) return;
        seen[key] = true;
        opts.push({ id: card.id + '#fake' + i, text: f, img: null, fake: f });
      });
    }
    opts = opts.concat(deckDistractors(card, cards, side, n - 1 - opts.length, rng, seen));
    opts.push({ id: card.id, text: ans, img: card[imgKey] || null });
    return shuffle(opts, rng);
  }

  // ---------- per-card fake answers ----------
  /**
   * Clean a card's fake answers: trim, drop blanks and duplicates, and drop
   * any fake that normalizes to the answer or that the written grader would
   * accept as the answer. Returns {fakes, dropped, dupes}.
   */
  function cleanFakes(fakes, answer) {
    var out = [], seen = {}, dropped = 0, dupes = 0;
    var nAns = normalize(answer);
    (Array.isArray(fakes) ? fakes : []).forEach(function (f) {
      f = String(f == null ? '' : f).trim();
      if (!f) return;
      var n = normalize(f);
      // A fake that is only a typo away from the answer ("alkene" for "alkane")
      // is kept: the written grader rejects it because it is a known wrong answer.
      if (!n || (nAns && (n === nAns || grade(f, answer, [f]).correct))) { dropped++; return; }
      if (seen[n]) { dupes++; return; }
      seen[n] = true;
      out.push(f);
    });
    return { fakes: out, dropped: dropped, dupes: dupes };
  }

  /** Up to k fakes, least shown first (shown: fake text -> count), ties broken randomly. */
  function pickFakes(fakes, shown, k, rng) {
    shown = shown || {};
    return shuffle(fakes || [], rng || Math.random)
      .map(function (f) { return { f: f, n: shown[f] || 0 }; })
      .sort(function (a, b) { return a.n - b.n; }) // stable sort keeps the shuffled order within ties
      .slice(0, Math.max(0, k))
      .map(function (x) { return x.f; });
  }

  /** Record that these fakes were shown. shown: fake text -> count (mutated). */
  function noteFakesShown(shown, list) {
    (list || []).forEach(function (f) { if (f) shown[f] = (shown[f] || 0) + 1; });
    return shown;
  }

  function hasFakes(card) {
    return Array.isArray(card.fakes) && card.fakes.some(function (f) { return String(f || '').trim(); });
  }

  /**
   * Whether a true/false question suits this card. Answering with the
   * definition, a card that has fakes needs at least 2 usable ones (its false
   * statements come only from its own fakes). Cards without fakes, and the
   * term side, use other cards' answers.
   */
  function trueFalseAllowed(card, side) {
    if (side !== 'def' || !hasFakes(card)) return true;
    return cleanFakes(card.fakes, card.def).fakes.length >= 2;
  }

  /**
   * True/false candidate for `card` answering with `side`. About half the time
   * the real answer. Otherwise, answering with the definition, one of the
   * card's fakes (least shown first) when it has any; cards without fakes,
   * and the term side, use another card's answer from the deck.
   * Returns {text, img, isTrue, fake?, otherId?}.
   */
  function trueFalseCandidate(card, cards, side, shown, rng) {
    rng = rng || Math.random;
    var imgKey = side === 'term' ? 'termImg' : 'defImg';
    var real = { text: card[side], img: card[imgKey] || null, isTrue: true };
    if (rng() < 0.5) return real;
    if (side === 'def' && hasFakes(card)) {
      var f = pickFakes(cleanFakes(card.fakes, card[side]).fakes, shown, 1, rng)[0];
      return f ? { text: f, img: null, isTrue: false, fake: f } : real;
    }
    var seen = {};
    seen[normalize(card[side]) + '|' + (card[imgKey] || '')] = true;
    var o = deckDistractors(card, cards, side, 1, rng, seen)[0];
    return o ? { text: o.text, img: o.img, isTrue: false, otherId: o.id } : real;
  }

  // ---------- spaced review (SM-2 style, applied to mastered cards) ----------
  function srsOnMastered(now) {
    return { interval: 1, ease: 2.5, reps: 1, due: now + DAY };
  }
  function srsOnReview(srs, correct, now) {
    if (!correct) return null;
    var interval = Math.max(1, Math.round(srs.interval * srs.ease));
    return { interval: interval, ease: Math.min(3, srs.ease + 0.05), reps: srs.reps + 1, due: now + interval * DAY };
  }

  // ---------- Learn ----------
  function defaultSettings() {
    return { answerWith: 'def', mc: true, tf: true, written: true, retype: true, starredOnly: false, roundSize: 7 };
  }

  function cardState(progress, id) {
    return progress[id] || { stage: NEW, misses: 0, seen: 0 };
  }

  function isDue(st, now) {
    return st.stage === MASTERED && st.srs && st.srs.due <= now;
  }

  /** Cards in scope for a study session given settings. */
  function scopeCards(cards, settings) {
    return cards.filter(function (c) {
      if (settings.starredOnly && !c.starred) return false;
      return (c.term || c.termImg) && (c.def || c.defImg);
    });
  }

  function learnCounts(cards, progress, now) {
    var out = { new: 0, familiar: 0, mastered: 0, due: 0, total: cards.length };
    cards.forEach(function (c) {
      var st = cardState(progress, c.id);
      if (st.stage === MASTERED) { out.mastered++; if (isDue(st, now)) out.due++; }
      else if (st.stage === FAMILIAR) out.familiar++;
      else out.new++;
    });
    return out;
  }

  /**
   * Build the next Learn round. Priority: mastered cards due for review, then
   * cards already in progress (familiar, most-missed first), then new cards in
   * deck order. Returns null if nothing is left to study right now.
   */
  function buildRound(cards, progress, settings, now, rng) {
    var size = Math.max(1, settings.roundSize | 0 || 7);
    var due = [], fam = [], fresh = [];
    cards.forEach(function (c, i) {
      var st = cardState(progress, c.id);
      if (isDue(st, now)) due.push(c.id);
      else if (st.stage === FAMILIAR) fam.push({ id: c.id, m: st.misses, i: i });
      else if (st.stage === NEW) fresh.push(c.id);
    });
    fam.sort(function (a, b) { return b.m - a.m || a.i - b.i; });
    var ids = due.concat(fam.map(function (f) { return f.id; }), fresh).slice(0, size);
    if (!ids.length) return null;
    return { queue: shuffle(ids, rng), size: ids.length, done: [], missed: [], answered: 0, correct: 0 };
  }

  /**
   * Recognition question type (multiple choice or true/false) given settings,
   * or null if both are off. With both on, about 1 in 3 is true/false.
   */
  function recognitionType(settings, rng) {
    var mc = settings.mc !== false, tf = settings.tf !== false;
    if (mc && tf) return (rng || Math.random)() < 1 / 3 ? 'tf' : 'mc';
    return mc ? 'mc' : tf ? 'tf' : null;
  }

  function isRecognition(type) { return type === 'mc' || type === 'tf'; }

  /** Question type for a card given its stage and enabled types. */
  function questionType(st, settings, now, rng) {
    var wr = settings.written !== false;
    var rec = recognitionType(settings, rng) || (wr ? null : 'mc');
    if (st.stage === NEW) return rec || 'written';
    return wr ? 'written' : rec; // familiar, or mastered-and-due review
  }

  /**
   * Apply an answer inside a round. Mutates round and progress.
   * Correct: promote one stage (New->Familiar->Mastered; due review stays
   * Mastered with a longer interval) and remove from this round.
   * Miss: demote one stage and requeue a few questions later in the round.
   */
  function learnAnswer(round, progress, id, correct, now, gap) {
    var st = Object.assign({ stage: NEW, misses: 0, seen: 0 }, progress[id]);
    st.seen++;
    st.last = now;
    var pos = round.queue.indexOf(id);
    if (pos !== -1) round.queue.splice(pos, 1);
    round.answered++;
    if (correct) {
      round.correct++;
      if (st.stage === NEW) st.stage = FAMILIAR;
      else if (st.stage === FAMILIAR) { st.stage = MASTERED; st.srs = srsOnMastered(now); }
      else if (st.stage === MASTERED) st.srs = srsOnReview(st.srs || srsOnMastered(now), true, now);
      if (round.done.indexOf(id) === -1) round.done.push(id);
    } else {
      st.misses++;
      if (st.stage === MASTERED) { st.stage = FAMILIAR; st.srs = null; }
      else if (st.stage === FAMILIAR) st.stage = NEW;
      if (round.missed.indexOf(id) === -1) round.missed.push(id);
      var g = gap == null ? 3 : gap;
      round.queue.splice(Math.min(g, round.queue.length), 0, id);
    }
    progress[id] = st;
    return st;
  }

  // ---------- Cram ----------
  /*
   * Cram: everything, now, no spacing. A small working set cycles; every card
   * must first be recognized (multiple choice, if enabled) then recalled
   * (written) to be "cleared". Misses return 2 questions later. When all cards
   * are cleared, a final shuffled pass over everything runs (written), with
   * misses requeued until each is answered right once more.
   */
  function cramInit(cards, settings, rng) {
    var ids = shuffle(cards.map(function (c) { return c.id; }), rng);
    var size = Math.max(2, settings.roundSize | 0 || 7);
    return {
      phase: 'drill', stage: {}, misses: {}, active: ids.slice(0, size), pending: ids.slice(size),
      final: [], finalDone: [], total: ids.length, answered: 0, correct: 0, windowSize: size,
    };
  }

  function cramNext(state, settings, rng) {
    var id = state.phase === 'drill' ? state.active[0] : state.phase === 'final' ? state.final[0] : null;
    if (!id) return null;
    var wr = settings.written !== false;
    var rec = recognitionType(settings, rng) || (wr ? null : 'mc');
    var type;
    if (state.phase === 'final') type = wr ? 'written' : rec;
    else type = (state.stage[id] || 0) === 0 && rec ? rec : (wr ? 'written' : rec);
    return { id: id, type: type };
  }

  function cramCleared(state) {
    var n = 0;
    for (var k in state.stage) if (state.stage[k] >= 2) n++;
    return n;
  }

  function cramAnswer(state, id, type, correct, settings, rng) {
    state.answered++;
    if (correct) state.correct++;
    else state.misses[id] = (state.misses[id] || 0) + 1;
    var wr = settings.written !== false;
    if (state.phase === 'drill') {
      var q = state.active;
      q.splice(q.indexOf(id), 1);
      var s = state.stage[id] || 0;
      if (correct) {
        // recognition (MC or true/false) correct -> needs written next (if written enabled); written correct -> cleared
        s = (isRecognition(type) && wr) ? 1 : 2;
      } else {
        s = 0; // back to recognition
      }
      state.stage[id] = s;
      if (s < 2) q.splice(Math.min(correct ? 3 : 2, q.length), 0, id);
      while (q.length < state.windowSize && state.pending.length) q.push(state.pending.shift());
      if (!q.length) {
        state.phase = 'final';
        state.final = shuffle(Object.keys(state.stage), rng);
        state.finalDone = [];
      }
    } else if (state.phase === 'final') {
      var f = state.final;
      f.splice(f.indexOf(id), 1);
      if (correct) state.finalDone.push(id);
      else f.splice(Math.min(3, f.length), 0, id);
      if (!f.length) state.phase = 'done';
    }
    return state;
  }

  /** Drop ids no longer in the deck and add new cards to pending. */
  function cramSync(state, cards) {
    var ids = {};
    cards.forEach(function (c) { ids[c.id] = true; });
    function keep(x) { return ids[x]; }
    state.active = state.active.filter(keep);
    state.pending = state.pending.filter(keep);
    state.final = state.final.filter(keep);
    Object.keys(state.stage).forEach(function (k) { if (!ids[k]) delete state.stage[k]; });
    var known = {};
    state.active.concat(state.pending, Object.keys(state.stage)).forEach(function (x) { known[x] = true; });
    cards.forEach(function (c) { if (!known[c.id]) state.pending.push(c.id); });
    state.total = cards.length;
    if (state.phase === 'drill') {
      while (state.active.length < state.windowSize && state.pending.length) state.active.push(state.pending.shift());
    }
    return state;
  }

  // ---------- Test (Quizlet Test mode) ----------
  /*
   * A test is generated once, answered on one page, and graded on submit.
   * It never touches Learn or Cram progress. Items are numbered in section
   * order: written, matching, multiple choice, true/false. Each matching pair
   * is its own item (graded separately); its block lists the shuffled options.
   * Choices and true/false candidates store card ids and text only, so stored
   * tests stay small; images are read from the live cards when shown.
   */
  var TEST_TYPES = ['written', 'match', 'mc', 'tf'];
  var MATCH_MAX = 6;

  function testDefaults(n) {
    return { count: Math.min(20, Math.max(1, n | 0)), answerWith: 'def', written: true, match: true, mc: true, tf: true, starredOnly: false };
  }

  /** Enabled question types in section order (multiple choice if none). */
  function testTypes(settings) {
    var t = TEST_TYPES.filter(function (k) { return settings[k] !== false; });
    return t.length ? t : ['mc'];
  }

  function answerKey(card, side) {
    var imgKey = side === 'term' ? 'termImg' : 'defImg';
    return normalize(card[side]) + '|' + (card[imgKey] || '');
  }

  /** Whether `type` suits this card answering with `side`. */
  function testEligible(card, type, side) {
    if (type === 'written') return String(card[side] || '').trim() !== ''; // image-only answers cannot be typed
    if (type === 'tf') return trueFalseAllowed(card, side);
    return true;
  }

  /** Split n into k near-equal parts, larger parts first. */
  function evenSplit(n, k) {
    var out = [];
    for (var i = 0; i < k; i++) out.push(Math.floor(n / k) + (i < n % k ? 1 : 0));
    return out;
  }

  /**
   * Pick the cards and question types for a test. `cards` is the deck (all
   * complete cards are used for distractors); settings: testDefaults() shape.
   * opts.only: card ids to draw from (retake missed). Returns
   * {side, written:[ids], blocks:[[ids]], mc:[ids], tf:[ids]}.
   * Types get near-equal shares; matching is one block of up to 6 cards (or
   * several blocks when it is the only type). Cards that cannot be typed or
   * lack enough fakes for true/false take the other types' slots.
   */
  function planTest(cards, settings, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var side = settings.answerWith === 'term' ? 'term' : 'def';
    var only = null;
    if (opts.only) { only = {}; opts.only.forEach(function (id) { only[id] = true; }); }
    var pool = scopeCards(cards, { starredOnly: !!settings.starredOnly && !only })
      .filter(function (c) { return !only || only[c.id]; });
    var n = Math.max(0, Math.min(pool.length, settings.count | 0 || pool.length));
    var picked = shuffle(pool, rng).slice(0, n);
    var types = testTypes(settings);
    var plan = { side: side, written: [], blocks: [], mc: [], tf: [] };
    if (!n) return plan;

    var rest = types.filter(function (t) { return t !== 'match'; });
    var matchN = 0;
    if (types.indexOf('match') !== -1) {
      matchN = rest.length ? Math.min(MATCH_MAX, Math.round(n / types.length)) : n;
      if (matchN < 2) matchN = 0;
    }
    if (!rest.length && matchN < n) rest = ['mc']; // matching only, but too few cards to match

    // matching: least flexible cards first (those that cannot take other types)
    function flex(c) { return rest.filter(function (t) { return testEligible(c, t, side); }).length; }
    var left = picked.slice();
    if (matchN) {
      var order = left.map(function (c, i) { return { c: c, f: flex(c), i: i }; })
        .sort(function (a, b) { return a.f - b.f || a.i - b.i; });
      var sizes = evenSplit(matchN, Math.ceil(matchN / MATCH_MAX));
      var blocks = sizes.map(function () { return { ids: [], keys: {} }; });
      var used = {};
      order.forEach(function (o) {
        var k = answerKey(o.c, side);
        for (var b = 0; b < blocks.length; b++) {
          // two cards with the same answer in one block would be ambiguous
          if (blocks[b].ids.length < sizes[b] && !blocks[b].keys[k]) {
            blocks[b].ids.push(o.c.id); blocks[b].keys[k] = true; used[o.c.id] = true; return;
          }
        }
      });
      blocks.forEach(function (b) {
        if (b.ids.length >= 2) plan.blocks.push(b.ids);
        else b.ids.forEach(function (id) { delete used[id]; });
      });
      left = left.filter(function (c) { return !used[c.id]; });
      if (!rest.length && left.length) rest = ['mc'];
    }

    // other types: near-equal quotas, most constrained cards first
    var quota = {};
    evenSplit(left.length, rest.length).forEach(function (q, i) { quota[rest[i]] = q; });
    left.map(function (c, i) { return { c: c, f: flex(c), i: i }; })
      .sort(function (a, b) { return a.f - b.f || a.i - b.i; })
      .forEach(function (o) {
        var ok = rest.filter(function (t) { return testEligible(o.c, t, side); });
        var t = null;
        ok.forEach(function (x) { if (quota[x] > 0 && (t === null || quota[x] > quota[t])) t = x; });
        if (t === null) t = ok.length ? ok[0] : 'mc';
        if (quota[t]) quota[t]--;
        plan[t].push(o.c.id);
      });
    // keep the random draw order inside each section
    var pos = {};
    picked.forEach(function (c, i) { pos[c.id] = i; });
    ['written', 'mc', 'tf'].forEach(function (t) { plan[t].sort(function (a, b) { return pos[a] - pos[b]; }); });
    return plan;
  }

  /**
   * Generate a test. opts: {rng, shown (card id -> fake-shown counts), only, now}.
   * Returns {created, settings, side, items, blocks}. items: [{key, n, type, id,
   * choices? (mc: [{id, text, fake?}]), cand? (tf: {isTrue, text, fake?, otherId?}),
   * block? (match: index into blocks)}]. blocks: [{ids, options}] with options
   * the block's card ids shuffled.
   */
  function buildTest(cards, settings, opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var shown = opts.shown || {};
    var plan = planTest(cards, settings, opts);
    var side = plan.side;
    var pool = scopeCards(cards, {});
    var byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });
    var items = [], blocks = [];
    function add(it) { it.n = items.length + 1; it.key = 'q' + it.n; items.push(it); }
    plan.written.forEach(function (id) { add({ type: 'written', id: id }); });
    plan.blocks.forEach(function (ids) {
      var b = blocks.length;
      blocks.push({ ids: ids.slice(), options: shuffle(ids, rng) });
      ids.forEach(function (id) { add({ type: 'match', id: id, block: b }); });
    });
    plan.mc.forEach(function (id) {
      var ch = buildChoices(byId[id], pool, side, 4, rng, shown[id]);
      add({ type: 'mc', id: id, choices: ch.map(function (o) { var x = { id: o.id, text: o.text }; if (o.fake) x.fake = o.fake; return x; }) });
    });
    plan.tf.forEach(function (id) {
      var c = trueFalseCandidate(byId[id], pool, side, shown[id], rng);
      var cand = { isTrue: c.isTrue, text: c.text };
      if (c.fake) cand.fake = c.fake;
      if (c.otherId) cand.otherId = c.otherId;
      add({ type: 'tf', id: id, cand: cand });
    });
    var s = {};
    Object.keys(testDefaults(1)).forEach(function (k) { s[k] = settings[k]; });
    s.count = items.length;
    return { created: opts.now || Date.now(), settings: s, side: side, items: items, blocks: blocks, only: opts.only ? opts.only.slice() : null };
  }

  /** Fakes a test shows, by card id, for updating fake-shown counts. */
  function testFakes(test) {
    var out = {};
    test.items.forEach(function (it) {
      var list = [];
      if (it.choices) it.choices.forEach(function (c) { if (c.fake) list.push(c.fake); });
      if (it.cand && it.cand.fake) list.push(it.cand.fake);
      if (list.length) out[it.id] = list;
    });
    return out;
  }

  /** Drop items and matching options whose card was deleted, and renumber. Mutates and returns test. */
  function testPrune(test, cards) {
    var ids = {};
    cards.forEach(function (c) { ids[c.id] = true; });
    var before = test.items.length;
    test.items = test.items.filter(function (it) { return ids[it.id]; });
    test.blocks.forEach(function (b) {
      b.ids = b.ids.filter(function (id) { return ids[id]; });
      b.options = b.options.filter(function (id) { return ids[id]; });
    });
    if (test.items.length !== before) {
      // keys stay stable (answers are stored by key); only the shown numbers change
      test.items.forEach(function (it, i) { it.n = i + 1; });
    }
    return test;
  }

  function testAnswered(item, answers) {
    var a = answers[item.key];
    if (item.type === 'written') return typeof a === 'string' && a.trim() !== '';
    if (item.type === 'tf') return a === true || a === false;
    if (item.type === 'mc') return typeof a === 'number' && a >= 0;
    return typeof a === 'string' && a !== '';
  }

  function testUnanswered(test, answers) {
    return test.items.filter(function (it) { return !testAnswered(it, answers || {}); }).length;
  }

  /**
   * Grade a test. answers: key -> written text | mc choice index | tf boolean |
   * match option card id. overrides: key -> true for written answers the
   * student marked right. Returns {items: [{key, n, type, id, correct, close,
   * overridden, given}], correct, total, pct, missed: [card ids]}.
   */
  function scoreTest(test, answers, cards, overrides) {
    answers = answers || {}; overrides = overrides || {};
    var side = test.side, byId = {};
    cards.forEach(function (c) { byId[c.id] = c; });
    var pool = scopeCards(cards, {});
    var res = [], correct = 0, missed = [];
    test.items.forEach(function (it) {
      var card = byId[it.id];
      if (!card) return;
      var a = answers[it.key], r = { key: it.key, n: it.n, type: it.type, id: it.id, given: a, correct: false, close: false, overridden: false };
      if (it.type === 'written') {
        var wrongs = (side === 'def' ? card.fakes || [] : []).concat(pool.filter(function (c) { return c.id !== card.id; }).map(function (c) { return c[side]; }));
        var g = grade(typeof a === 'string' ? a : '', card[side], wrongs);
        r.close = !!g.close;
        r.typo = !!g.typo;
        r.correct = !!g.correct;
        if (!r.correct && overrides[it.key] && typeof a === 'string' && a.trim()) { r.correct = true; r.overridden = true; }
      } else if (it.type === 'mc') {
        r.correct = typeof a === 'number' && !!it.choices[a] && it.choices[a].id === card.id;
      } else if (it.type === 'tf') {
        r.correct = (a === true || a === false) && a === it.cand.isTrue;
      } else if (it.type === 'match') {
        var o = typeof a === 'string' ? byId[a] : null;
        r.correct = !!o && (o.id === card.id || answerKey(o, side) === answerKey(card, side));
      }
      if (r.correct) correct++; else missed.push(it.id);
      res.push(r);
    });
    return { items: res, correct: correct, total: res.length, pct: res.length ? Math.round(100 * correct / res.length) : 0, missed: missed };
  }

  // ---------- built-in (seed) deck upgrades ----------
  /**
   * Upgrade a stored built-in deck to a newer seed version without wiping
   * progress. `incoming` is the new seed deck (cards already normalized).
   * Cards whose id, term and def are unchanged keep their Learn progress,
   * fake-shown counts and Cram state; changed or new cards start fresh.
   * Stars (by card id), settings and folder are kept. Cards the user added
   * themselves (ids not starting with "seed-") are kept at the end.
   * Mutates and returns `existing`; existing.upgrade = {kept, fresh}.
   */
  function mergeSeedDeck(existing, incoming) {
    var old = {}, inSeed = {}, kept = {}, fresh = [];
    (existing.cards || []).forEach(function (c) { old[c.id] = c; });
    var cards = incoming.cards.map(function (c) {
      inSeed[c.id] = true;
      var o = old[c.id], n = Object.assign({}, c);
      if (o) n.starred = !!o.starred;
      if (o && o.term === c.term && o.def === c.def) kept[c.id] = true;
      else fresh.push(c.id);
      return n;
    });
    (existing.cards || []).forEach(function (c) {
      if (!inSeed[c.id] && !/^seed-/.test(c.id)) { cards.push(c); kept[c.id] = true; }
    });
    function pick(obj) {
      var out = {};
      Object.keys(obj || {}).forEach(function (id) { if (kept[id]) out[id] = obj[id]; });
      return out;
    }
    function keep(id) { return kept[id]; }
    var present = {};
    cards.forEach(function (c) { present[c.id] = true; });
    function has(id) { return present[id]; }
    var L = existing.learn || {};
    var round = L.round || null;
    if (round) {
      round.queue = (round.queue || []).filter(has);
      if (round.ids) round.ids = round.ids.filter(has);
    }
    existing.learn = { progress: pick(L.progress), fakeShown: pick(L.fakeShown), round: round, roundNo: L.roundNo || 0 };
    var C = existing.cram;
    if (C) {
      C.active = (C.active || []).filter(keep);
      C.pending = (C.pending || []).filter(keep);
      C.final = (C.final || []).filter(keep);
      C.finalDone = (C.finalDone || []).filter(keep);
      C.stage = pick(C.stage);
      C.misses = pick(C.misses);
      // new or changed cards need drilling; cramSync adds them to the drill queue
      if (fresh.length && C.phase !== 'drill') C.phase = 'drill';
      cramSync(C, cards);
    }
    existing.cards = cards;
    existing.name = incoming.name;
    existing.upgrade = { kept: Object.keys(kept).length, fresh: fresh.length };
    return existing;
  }

  return {
    DAY: DAY, NEW: NEW, FAMILIAR: FAMILIAR, MASTERED: MASTERED,
    uid: uid, shuffle: shuffle,
    parseImport: parseImport, splitSets: splitSets, stripImageNote: stripImageNote, exportText: exportText,
    normalize: normalize, tokensOf: tokensOf, levenshtein: levenshtein, typoTolerance: typoTolerance, grade: grade,
    buildChoices: buildChoices, plausibility: plausibility, deckDistractors: deckDistractors,
    cleanFakes: cleanFakes, pickFakes: pickFakes, noteFakesShown: noteFakesShown, hasFakes: hasFakes,
    trueFalseAllowed: trueFalseAllowed, trueFalseCandidate: trueFalseCandidate,
    recognitionType: recognitionType, isRecognition: isRecognition, mergeSeedDeck: mergeSeedDeck,
    srsOnMastered: srsOnMastered, srsOnReview: srsOnReview,
    defaultSettings: defaultSettings, cardState: cardState, scopeCards: scopeCards, isDue: isDue,
    learnCounts: learnCounts, buildRound: buildRound, questionType: questionType, learnAnswer: learnAnswer,
    cramInit: cramInit, cramNext: cramNext, cramAnswer: cramAnswer, cramCleared: cramCleared, cramSync: cramSync,
    TEST_TYPES: TEST_TYPES, testDefaults: testDefaults, testTypes: testTypes, testEligible: testEligible,
    planTest: planTest, buildTest: buildTest, testFakes: testFakes, testPrune: testPrune,
    testAnswered: testAnswered, testUnanswered: testUnanswered, scoreTest: scoreTest,
  };
});
