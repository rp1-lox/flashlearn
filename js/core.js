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
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
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

  /** Accepted forms of an answer: full text, and text with (parentheticals) removed. */
  function answerVariants(answer) {
    var out = [normalize(answer)];
    var noParen = normalize(String(answer || '').replace(/\([^)]*\)/g, ' '));
    if (noParen && out.indexOf(noParen) === -1) out.push(noParen);
    return out.filter(Boolean);
  }

  function digitsOf(s) { return (s.match(/\d+/g) || []).join(','); }

  /**
   * Returns {correct, close, typo}. close = near miss worth showing an override for.
   * Typos are forgiven by length, except in numbers: "C2H4" is not "C2H6", and
   * "12.01" is not "14.01". `wrongs` (optional) lists known wrong answers (the
   * card's fakes, other cards' answers): a typo-level match that is at least as
   * close to one of them as to the answer is not accepted ("alkene" for "alkane").
   */
  function grade(given, answer, wrongs) {
    var g = normalize(given);
    var variants = answerVariants(answer);
    if (!g) return { correct: false, close: false };
    var best = Infinity, bestLen = 1;
    for (var i = 0; i < variants.length; i++) {
      var v = variants[i];
      var d = levenshtein(g, v);
      var tol = digitsOf(g) === digitsOf(v) ? typoTolerance(v.length) : 0;
      if (d <= tol) {
        if (d > 0 && wrongs && wrongs.length) {
          for (var j = 0; j < wrongs.length; j++) {
            var w = normalize(wrongs[j]);
            if (w && w !== v && levenshtein(g, w) <= d) return { correct: false, close: true, wrong: wrongs[j] };
          }
        }
        return { correct: true, close: false, typo: d > 0 };
      }
      if (d < best) { best = d; bestLen = v.length; }
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
      if (!n || (nAns && (n === nAns || grade(f, answer).correct))) { dropped++; return; }
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
    return { answerWith: 'def', mc: true, tf: true, written: true, starredOnly: false, roundSize: 7 };
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
    normalize: normalize, levenshtein: levenshtein, typoTolerance: typoTolerance, grade: grade,
    buildChoices: buildChoices, plausibility: plausibility, deckDistractors: deckDistractors,
    cleanFakes: cleanFakes, pickFakes: pickFakes, noteFakesShown: noteFakesShown, hasFakes: hasFakes,
    trueFalseAllowed: trueFalseAllowed, trueFalseCandidate: trueFalseCandidate,
    recognitionType: recognitionType, isRecognition: isRecognition, mergeSeedDeck: mergeSeedDeck,
    srsOnMastered: srsOnMastered, srsOnReview: srsOnReview,
    defaultSettings: defaultSettings, cardState: cardState, scopeCards: scopeCards, isDue: isDue,
    learnCounts: learnCounts, buildRound: buildRound, questionType: questionType, learnAnswer: learnAnswer,
    cramInit: cramInit, cramNext: cramNext, cramAnswer: cramAnswer, cramCleared: cramCleared, cramSync: cramSync,
  };
});
