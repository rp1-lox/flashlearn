const test = require('node:test');
const assert = require('node:assert/strict');
const FL = require('../js/core.js');

function seq(vals) { let i = 0; return () => vals[i++ % vals.length]; }
const rng = seq([0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8]);

function deck(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'c' + i, term: 'term ' + i, def: 'definition number ' + i }));
}

// ---------- import ----------
test('parseImport splits on tab, skips blanks, keeps unicode', () => {
  const cards = FL.parseImport('CH₄\tmethane\r\n\n  \nA → B\tx ≡ y\n', 'tab');
  assert.deepEqual(cards, [{ term: 'CH₄', def: 'methane' }, { term: 'A → B', def: 'x ≡ y' }]);
});

test('parseImport custom separator splits on first occurrence only', () => {
  const cards = FL.parseImport('a - b - c\nd - e', ' - ');
  assert.deepEqual(cards, [{ term: 'a', def: 'b - c' }, { term: 'd', def: 'e' }]);
});

test('parseImport line with no separator becomes term-only', () => {
  assert.deepEqual(FL.parseImport('lonely', '\t'), [{ term: 'lonely', def: '' }]);
});

test('stripImageNote removes the add-image note', () => {
  const r = FL.stripImageNote('Structure 01 (add image 01.png): Name it. Count lone pairs.');
  assert.equal(r.term, 'Structure 01: Name it. Count lone pairs.');
  assert.equal(r.image, '01.png');
});

test('exportText round-trips through parseImport', () => {
  const cards = [{ term: 'a', def: 'b' }, { term: 'CH₄', def: 'x\ny' }];
  const back = FL.parseImport(FL.exportText(cards, 'tab'), 'tab');
  assert.deepEqual(back, [{ term: 'a', def: 'b' }, { term: 'CH₄', def: 'x y' }]);
});

test('splitSets: multiple pasted sets separated by header lines', () => {
  const text = '# Set One\na\tb\nc\td\n\n# Set Two\ne\tf\n';
  const sets = FL.splitSets(text, '\t', 'Imported');
  assert.equal(sets.length, 2);
  assert.equal(sets[0].name, 'Set One');
  assert.equal(sets[0].cards.length, 2);
  assert.equal(sets[1].name, 'Set Two');
  assert.deepEqual(sets[1].cards, [{ term: 'e', def: 'f' }]);
});

test('splitSets: no header gives one set with fallback name', () => {
  const sets = FL.splitSets('a\tb\n', '\t', 'My file');
  assert.equal(sets.length, 1);
  assert.equal(sets[0].name, 'My file');
});

// ---------- grading ----------
test('grade ignores case, punctuation, whitespace', () => {
  assert.equal(FL.grade('  methane!! ', 'Methane').correct, true);
  assert.equal(FL.grade('number of protons', 'Number of protons.').correct, true);
});

test('grade treats subscripts as digits', () => {
  assert.equal(FL.grade('ch4', 'CH₄').correct, true);
  assert.equal(FL.grade('h2o', 'H₂O').correct, true);
});

test('grade typo tolerance scales with length', () => {
  assert.equal(FL.grade('cat', 'car').correct, false); // short: exact
  assert.equal(FL.grade('ammonai', 'ammonia').correct, true); // 1 edit ok at len 7
  assert.equal(FL.grade('polystyrne', 'polystyrene').correct, true);
  assert.equal(FL.grade('polyethylene', 'polystyrene').correct, false);
});

test('grade accepts answer without parenthetical', () => {
  assert.equal(FL.grade('organic chemistry', 'Organic chemistry (carbon-based)').correct, true);
});

test('grade empty answer is wrong and not close', () => {
  const r = FL.grade('', 'x');
  assert.equal(r.correct, false);
  assert.equal(r.close, false);
});

test('grade flags near misses as close', () => {
  const r = FL.grade('methyl', 'methane');
  assert.equal(r.correct, false);
  assert.equal(r.close, true);
});

// ---------- multiple choice ----------
test('buildChoices includes correct answer, unique options, from same deck', () => {
  const cards = deck(10);
  const opts = FL.buildChoices(cards[3], cards, 'def', 4, rng);
  assert.equal(opts.length, 4);
  assert.ok(opts.some((o) => o.id === 'c3'));
  assert.equal(new Set(opts.map((o) => o.text)).size, 4);
});

test('buildChoices prefers plausible distractors', () => {
  const cards = [
    { id: 'a', term: 'x', def: 'Methane, CH4' },
    { id: 'b', term: 'y', def: 'Ethane, C2H6' },
    { id: 'c', term: 'z', def: 'A very long definition about the history of the textile industry in the region' },
    { id: 'd', term: 'w', def: 'Propane, C3H8' },
    { id: 'e', term: 'v', def: 'Butane, C4H10' },
    { id: 'f', term: 'u', def: 'Another really long unrelated sentence that talks about many different things' },
    { id: 'g', term: 't', def: 'Yet another long rambling definition text about unrelated matters of the day' },
  ];
  let hits = 0;
  for (let i = 0; i < 20; i++) {
    const opts = FL.buildChoices(cards[0], cards, 'def', 4);
    hits += opts.filter((o) => ['b', 'd', 'e'].includes(o.id)).length;
  }
  assert.ok(hits / 20 > 2, 'mostly plausible distractors, got ' + hits / 20);
});

test('buildChoices with tiny deck returns what exists', () => {
  const cards = deck(2);
  assert.equal(FL.buildChoices(cards[0], cards, 'def', 4, rng).length, 2);
});

// ---------- learn ----------
test('buildRound picks up to roundSize non-mastered cards', () => {
  const cards = deck(20);
  const round = FL.buildRound(cards, {}, { roundSize: 7 }, 0, rng);
  assert.equal(round.queue.length, 7);
});

test('buildRound prioritizes familiar cards, then new', () => {
  const cards = deck(10);
  const progress = { c8: { stage: 1, misses: 2, seen: 3 }, c9: { stage: 1, misses: 0, seen: 1 } };
  const round = FL.buildRound(cards, progress, { roundSize: 3 }, 0, rng);
  assert.deepEqual(round.queue.slice().sort(), ['c0', 'c8', 'c9']);
});

test('question type: new -> mc, familiar -> written, respects settings', () => {
  const s = Object.assign(FL.defaultSettings(), { tf: false });
  assert.equal(FL.questionType({ stage: 0 }, s), 'mc');
  assert.equal(FL.questionType({ stage: 1 }, s), 'written');
  assert.equal(FL.questionType({ stage: 0 }, { mc: false, tf: false, written: true }), 'written');
  assert.equal(FL.questionType({ stage: 1 }, { mc: true, tf: false, written: false }), 'mc');
  assert.equal(FL.questionType({ stage: 0 }, { mc: false, tf: false, written: false }), 'mc');
});

test('learnAnswer: correct promotes New -> Familiar -> Mastered with SRS', () => {
  const progress = {};
  let round = { queue: ['c0'], done: [], missed: [], answered: 0, correct: 0 };
  FL.learnAnswer(round, progress, 'c0', true, 1000);
  assert.equal(progress.c0.stage, FL.FAMILIAR);
  assert.equal(round.queue.length, 0);
  round = { queue: ['c0'], done: [], missed: [], answered: 0, correct: 0 };
  FL.learnAnswer(round, progress, 'c0', true, 1000);
  assert.equal(progress.c0.stage, FL.MASTERED);
  assert.equal(progress.c0.srs.due, 1000 + FL.DAY);
});

test('learnAnswer: miss demotes and requeues later in round', () => {
  const progress = { c0: { stage: 1, misses: 0, seen: 1 } };
  const round = { queue: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], done: [], missed: [], answered: 0, correct: 0 };
  FL.learnAnswer(round, progress, 'c0', false, 0);
  assert.equal(progress.c0.stage, FL.NEW);
  assert.equal(progress.c0.misses, 1);
  assert.deepEqual(round.queue, ['c1', 'c2', 'c3', 'c0', 'c4', 'c5']);
  assert.deepEqual(round.missed, ['c0']);
});

test('full learn simulation: all correct masters everything in two passes', () => {
  const cards = deck(14);
  const progress = {};
  const s = FL.defaultSettings();
  let rounds = 0, round;
  while ((round = FL.buildRound(cards, progress, s, 0, rng)) && rounds < 50) {
    rounds++;
    while (round.queue.length) FL.learnAnswer(round, progress, round.queue[0], true, 0);
  }
  assert.equal(FL.learnCounts(cards, progress, 0).mastered, 14);
  assert.equal(rounds, 4); // 14 cards x 2 stages / 7 per round
});

test('mastered card becomes due for review and returns to rounds', () => {
  const cards = deck(1);
  const progress = { c0: { stage: 2, misses: 0, seen: 2, srs: FL.srsOnMastered(0) } };
  assert.equal(FL.buildRound(cards, progress, { roundSize: 7 }, 1000, rng), null);
  const round = FL.buildRound(cards, progress, { roundSize: 7 }, FL.DAY + 1, rng);
  assert.deepEqual(round.queue, ['c0']);
  FL.learnAnswer(round, progress, 'c0', true, FL.DAY + 1);
  assert.equal(progress.c0.stage, FL.MASTERED);
  assert.ok(progress.c0.srs.interval >= 2);
});

test('missed review demotes mastered to familiar', () => {
  const progress = { c0: { stage: 2, misses: 0, seen: 2, srs: FL.srsOnMastered(0) } };
  const round = { queue: ['c0'], done: [], missed: [], answered: 0, correct: 0 };
  FL.learnAnswer(round, progress, 'c0', false, FL.DAY * 2);
  assert.equal(progress.c0.stage, FL.FAMILIAR);
  assert.equal(progress.c0.srs, null);
});

test('scopeCards honors starred only', () => {
  const cards = deck(3);
  cards[1].starred = true;
  assert.deepEqual(FL.scopeCards(cards, { starredOnly: true }).map((c) => c.id), ['c1']);
});

// ---------- cram ----------
test('cram: every card must be written correctly, then a final pass, then done', () => {
  const cards = deck(10);
  const s = FL.defaultSettings();
  const st = FL.cramInit(cards, s, rng);
  const writtenOk = new Set();
  let steps = 0, missedOnce = new Set();
  while (st.phase === 'drill' && steps < 500) {
    const q = FL.cramNext(st, s);
    // miss each card's first written attempt once
    let correct = true;
    if (q.type === 'written' && !missedOnce.has(q.id)) { correct = false; missedOnce.add(q.id); }
    FL.cramAnswer(st, q.id, q.type, correct, s, rng);
    if (q.type === 'written' && correct) writtenOk.add(q.id);
    steps++;
  }
  assert.equal(writtenOk.size, 10);
  assert.equal(FL.cramCleared(st), 10);
  assert.equal(st.phase, 'final');
  assert.equal(st.final.length, 10);
  while (st.phase === 'final') {
    const q = FL.cramNext(st, s);
    assert.equal(q.type, 'written');
    FL.cramAnswer(st, q.id, q.type, true, s, rng);
  }
  assert.equal(st.phase, 'done');
  assert.equal(FL.cramNext(st, s), null);
});

test('cram: a miss comes back within 2 questions', () => {
  const cards = deck(10);
  const s = FL.defaultSettings();
  const st = FL.cramInit(cards, s, rng);
  const first = FL.cramNext(st, s);
  FL.cramAnswer(st, first.id, first.type, false, s, rng);
  assert.equal(st.active.indexOf(first.id), 2);
  assert.equal(st.stage[first.id], 0);
});

test('cram: mc correct then written required', () => {
  const cards = deck(3);
  const s = Object.assign(FL.defaultSettings(), { tf: false });
  const st = FL.cramInit(cards, s, rng);
  const q = FL.cramNext(st, s);
  assert.equal(q.type, 'mc');
  FL.cramAnswer(st, q.id, 'mc', true, s, rng);
  assert.equal(st.stage[q.id], 1);
  // cycle until this card returns
  let q2;
  do { q2 = FL.cramNext(st, s); if (q2.id !== q.id) FL.cramAnswer(st, q2.id, q2.type, true, s, rng); } while (q2.id !== q.id);
  assert.equal(q2.type, 'written');
});

test('cram: written-only setting clears on one written answer', () => {
  const cards = deck(3);
  const s = Object.assign(FL.defaultSettings(), { mc: false, tf: false });
  const st = FL.cramInit(cards, s, rng);
  for (let i = 0; i < 3; i++) { const q = FL.cramNext(st, s); assert.equal(q.type, 'written'); FL.cramAnswer(st, q.id, q.type, true, s, rng); }
  assert.equal(st.phase, 'final');
});

test('cramSync adds new cards and drops deleted ones', () => {
  const cards = deck(3);
  const s = FL.defaultSettings();
  const st = FL.cramInit(cards, s, rng);
  FL.cramSync(st, [cards[0], cards[1], { id: 'new1', term: 'a', def: 'b' }]);
  assert.ok(st.active.includes('new1'));
  assert.ok(!st.active.includes('c2'));
  assert.equal(st.total, 3);
});

test('buildChoices skips distractors that contain or are contained in the answer', () => {
  const cards = [
    { id: 'a', term: '1', def: 'Acetylene, C₂H₂. Alkyne (triple bond)' },
    { id: 'b', term: '2', def: 'Acetylene, C₂H₂.' },
    { id: 'c', term: '3', def: 'Ethane' }, { id: 'd', term: '4', def: 'Propane' }, { id: 'e', term: '5', def: 'Butane' },
  ];
  for (let i = 0; i < 10; i++) assert.ok(!FL.buildChoices(cards[0], cards, 'def', 4).some((o) => o.id === 'b'));
});

// ---------- per-card fake answers ----------
function fakeCard(n) {
  return { id: 'f', term: 'Q', def: 'polymers and colorants', fakes: Array.from({ length: n }, (_, i) => 'fake answer ' + i) };
}
function fakesOf(opts) { return opts.filter((o) => o.fake).map((o) => o.fake); }

test('buildChoices uses 3 of the card fakes when it has at least 3', () => {
  const card = fakeCard(8);
  const cards = [card].concat(deck(10));
  const opts = FL.buildChoices(card, cards, 'def', 4, rng, {});
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o.id === 'f').length, 1);
  assert.equal(fakesOf(opts).length, 3);
  opts.filter((o) => o.id !== 'f').forEach((o) => assert.ok(card.fakes.includes(o.text)));
});

test('buildChoices rotates through the least-shown fakes', () => {
  const card = fakeCard(8);
  const shown = {};
  const firstTwo = [];
  for (let i = 0; i < 2; i++) {
    const f = fakesOf(FL.buildChoices(card, [card], 'def', 4, Math.random, shown));
    FL.noteFakesShown(shown, f);
    firstTwo.push(...f);
  }
  assert.equal(new Set(firstTwo).size, 6, 'no fake repeats while unseen ones remain');
  const unseen = card.fakes.filter((f) => !shown[f]);
  assert.equal(unseen.length, 2);
  const third = fakesOf(FL.buildChoices(card, [card], 'def', 4, Math.random, shown));
  unseen.forEach((f) => assert.ok(third.includes(f), 'the never-shown fakes come next'));
  FL.noteFakesShown(shown, third);
  // 8 asks x 3 fakes = 24 slots over 8 fakes: every fake shown exactly 3 times
  for (let i = 0; i < 5; i++) FL.noteFakesShown(shown, fakesOf(FL.buildChoices(card, [card], 'def', 4, Math.random, shown)));
  assert.deepEqual(card.fakes.map((f) => shown[f]), [3, 3, 3, 3, 3, 3, 3, 3]);
});

test('pickFakes breaks ties randomly and prefers least shown', () => {
  const fakes = ['a', 'b', 'c', 'd', 'e', 'f'];
  const firsts = new Set();
  for (let i = 0; i < 60; i++) firsts.add(FL.pickFakes(fakes, { a: 1 }, 1)[0]);
  assert.ok(firsts.size > 2);
  assert.ok(!firsts.has('a'));
});

test('buildChoices fills with deck distractors when the card has fewer than 3 fakes', () => {
  const card = fakeCard(1);
  const cards = [card].concat(deck(10));
  const opts = FL.buildChoices(card, cards, 'def', 4, rng, {});
  assert.equal(opts.length, 4);
  assert.equal(fakesOf(opts).length, 1);
  assert.equal(opts.filter((o) => /^c\d$/.test(o.id)).length, 2);
  assert.equal(new Set(opts.map((o) => o.text)).size, 4);
  const none = FL.buildChoices({ id: 'f', term: 'Q', def: 'polymers and colorants' }, cards, 'def', 4, rng, {});
  assert.equal(none.filter((o) => /^c\d$/.test(o.id)).length, 3);
});

test('buildChoices ignores fakes when answering with the term', () => {
  const card = fakeCard(8);
  const cards = [card].concat(deck(10));
  const opts = FL.buildChoices(card, cards, 'term', 4, rng, {});
  assert.equal(fakesOf(opts).length, 0);
  opts.filter((o) => o.id !== 'f').forEach((o) => assert.match(o.text, /^term \d$/));
});

test('cleanFakes drops fakes equal to the answer or graded correct', () => {
  const r = FL.cleanFakes(['Polymers and colorants!', 'polymers and colorant', 'polymers & colorants', '  ', 'dyes and pigments', 'Dyes and pigments', 'resins'], 'polymers and colorants');
  assert.deepEqual(r.fakes, ['dyes and pigments', 'resins']);
  assert.equal(r.dropped, 3);
  assert.equal(r.dupes, 1);
  // the grader accepts the answer without its parenthetical, so that fake goes too
  assert.deepEqual(FL.cleanFakes(['organic chemistry', 'physical chemistry'], 'Organic chemistry (carbon-based)').fakes, ['physical chemistry']);
  // subscripts normalize to digits
  assert.deepEqual(FL.cleanFakes(['CH4', 'C2H6'], 'CH₄').fakes, ['C2H6']);
});

test('buildChoices never offers a fake that is the answer', () => {
  const card = { id: 'f', term: 'Q', def: 'methane', fakes: ['Methane', 'METHANE!', 'ethane', 'propane', 'butane'] };
  for (let i = 0; i < 20; i++) {
    const opts = FL.buildChoices(card, [card], 'def', 4, Math.random, {});
    assert.equal(opts.filter((o) => FL.normalize(o.text) === 'methane').length, 1);
  }
});

test('a one-letter-off fake is kept as a choice and graded wrong when typed', () => {
  const r = FL.cleanFakes(['alkene', 'alkyne', 'Alkane'], 'alkane');
  assert.deepEqual(r.fakes, ['alkene', 'alkyne']);
  assert.equal(FL.grade('alkene', 'alkane', r.fakes).correct, false);
  assert.equal(FL.grade('alkanne', 'alkane', r.fakes).correct, true);
});

// ---------- true / false ----------
test('trueFalseCandidate: about half true; false ones are the card fakes, least shown first', () => {
  const card = fakeCard(4);
  const cards = [card].concat(deck(10));
  const shown = {};
  let trues = 0;
  for (let i = 0; i < 400; i++) {
    const c = FL.trueFalseCandidate(card, cards, 'def', shown);
    if (c.isTrue) { trues++; assert.equal(c.text, card.def); continue; }
    assert.ok(card.fakes.includes(c.text), 'false candidate is one of the card fakes, never another card');
    FL.noteFakesShown(shown, [c.fake]);
    const counts = card.fakes.map((f) => shown[f] || 0);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'rotates least shown first');
  }
  assert.ok(trues > 150 && trues < 250, 'roughly half true, got ' + trues);
});

test('trueFalseCandidate falls back to another card answer when the card has no fakes', () => {
  const cards = deck(10);
  let falses = 0;
  for (let i = 0; i < 100; i++) {
    const c = FL.trueFalseCandidate(cards[0], cards, 'def', {});
    if (!c.isTrue) { falses++; assert.notEqual(c.text, cards[0].def); assert.ok(cards.some((x) => x.id === c.otherId && x.def === c.text)); }
  }
  assert.ok(falses > 20);
  // term side ignores fakes
  const card = fakeCard(8);
  for (let i = 0; i < 50; i++) {
    const c = FL.trueFalseCandidate(card, [card].concat(deck(5)), 'term', {});
    assert.ok(c.isTrue ? c.text === 'Q' : /^term \d$/.test(c.text));
  }
});

test('trueFalseAllowed: a card with fakes needs at least 2 usable ones', () => {
  assert.equal(FL.trueFalseAllowed(fakeCard(2), 'def'), true);
  assert.equal(FL.trueFalseAllowed(fakeCard(1), 'def'), false);
  assert.equal(FL.trueFalseAllowed({ id: 'x', term: 'a', def: 'methane', fakes: ['Methane', 'ethane'] }, 'def'), false);
  assert.equal(FL.trueFalseAllowed({ id: 'x', term: 'a', def: 'b' }, 'def'), true);
  assert.equal(FL.trueFalseAllowed(fakeCard(1), 'term'), true);
});

test('question type mixes true/false into recognition about 1 in 3', () => {
  const s = FL.defaultSettings();
  let tf = 0;
  for (let i = 0; i < 900; i++) {
    const t = FL.questionType({ stage: 0 }, s);
    assert.ok(t === 'mc' || t === 'tf');
    if (t === 'tf') tf++;
  }
  assert.ok(tf > 220 && tf < 380, 'got ' + tf);
  for (let i = 0; i < 50; i++) assert.equal(FL.questionType({ stage: 1 }, s), 'written');
  assert.equal(FL.questionType({ stage: 0 }, { mc: false, tf: true, written: true }), 'tf');
});

test('learn: true/false moves New -> Familiar; mastery still needs a written answer', () => {
  const s = FL.defaultSettings();
  const progress = {};
  const round = { queue: ['c0'], done: [], missed: [], answered: 0, correct: 0 };
  assert.equal(FL.questionType(FL.cardState(progress, 'c0'), s, 0, () => 0.1), 'tf');
  FL.learnAnswer(round, progress, 'c0', true, 0);
  assert.equal(progress.c0.stage, FL.FAMILIAR);
  assert.equal(FL.questionType(progress.c0, s, 0, () => 0.1), 'written');
});

test('cram: a correct true/false answer counts as recognition, then written', () => {
  const cards = deck(3);
  const s = FL.defaultSettings();
  const st = FL.cramInit(cards, s, rng);
  const q = FL.cramNext(st, s, () => 0.1);
  assert.equal(q.type, 'tf');
  FL.cramAnswer(st, q.id, 'tf', true, s, rng);
  assert.equal(st.stage[q.id], 1);
});

// ---------- seed upgrades ----------
test('mergeSeedDeck keeps progress for unchanged cards and resets changed ones', () => {
  const oldDeck = {
    id: 'seed-x', name: 'Old name', folder: 'Mine', settings: { answerWith: 'term', mc: true, tf: false, written: true, roundSize: 9 },
    cards: [
      { id: 'seed-a', term: 'A', def: 'a', starred: true },
      { id: 'seed-b', term: 'B', def: 'b', starred: true },
      { id: 'seed-gone', term: 'G', def: 'g' },
      { id: 'c_user', term: 'U', def: 'u' },
    ],
    learn: {
      progress: { 'seed-a': { stage: 2, misses: 1, seen: 3 }, 'seed-b': { stage: 1, misses: 0, seen: 1 }, 'seed-gone': { stage: 1 }, c_user: { stage: 1, misses: 0, seen: 1 } },
      fakeShown: { 'seed-a': { x: 2 }, 'seed-b': { y: 1 } },
      round: { queue: ['seed-gone', 'seed-a'], ids: ['seed-gone', 'seed-a'], done: [], missed: [], answered: 0, correct: 0, size: 2 }, roundNo: 4,
    },
    cram: { phase: 'final', stage: { 'seed-a': 2, 'seed-b': 2 }, misses: { 'seed-a': 3, 'seed-b': 1 }, active: [], pending: [], final: ['seed-a', 'seed-b'], finalDone: [], total: 2, answered: 9, correct: 5, windowSize: 7 },
  };
  const incoming = {
    id: 'seed-x', name: 'New name', version: 2,
    cards: [
      { id: 'seed-a', term: 'A', def: 'a', fakes: ['f1', 'f2', 'f3'], starred: false },
      { id: 'seed-b', term: 'B', def: 'b changed', starred: false },
      { id: 'seed-new', term: 'N', def: 'n', starred: false },
    ],
  };
  const settingsBefore = JSON.parse(JSON.stringify(oldDeck.settings));
  const d = FL.mergeSeedDeck(oldDeck, incoming);
  assert.deepEqual(d.cards.map((c) => c.id), ['seed-a', 'seed-b', 'seed-new', 'c_user']);
  assert.deepEqual(d.cards[0].fakes, ['f1', 'f2', 'f3']);
  assert.equal(d.cards[1].def, 'b changed');
  assert.equal(d.cards[0].starred, true);
  assert.equal(d.cards[1].starred, true);
  assert.deepEqual(d.learn.progress, { 'seed-a': { stage: 2, misses: 1, seen: 3 }, c_user: { stage: 1, misses: 0, seen: 1 } });
  assert.deepEqual(d.learn.fakeShown, { 'seed-a': { x: 2 } });
  assert.deepEqual(d.learn.round.queue, ['seed-a']);
  assert.equal(d.learn.roundNo, 4);
  assert.deepEqual(d.settings, settingsBefore);
  assert.equal(d.folder, 'Mine');
  assert.equal(d.name, 'New name');
  assert.deepEqual(d.cram.stage, { 'seed-a': 2 });
  assert.deepEqual(d.cram.misses, { 'seed-a': 3 });
  assert.equal(d.cram.phase, 'drill');
  ['seed-b', 'seed-new', 'c_user'].forEach((id) => assert.ok(d.cram.active.includes(id), id + ' queued for drilling'));
  assert.deepEqual(d.upgrade, { kept: 2, fresh: 2 });
});

test('mergeSeedDeck with only fakes added keeps every card, all progress and the whole cram', () => {
  const cards = deck(3).map((c) => Object.assign(c, { id: 'seed-' + c.id }));
  const s = FL.defaultSettings();
  const cram = FL.cramInit(cards, s, rng);
  FL.cramAnswer(cram, cram.active[0], 'mc', true, s, rng);
  const before = JSON.parse(JSON.stringify(cram));
  const progress = { 'seed-c0': { stage: 1, misses: 0, seen: 1 } };
  const oldDeck = { cards: cards.map((c) => Object.assign({}, c)), learn: { progress: progress, round: null, roundNo: 1 }, cram: cram };
  const incoming = { name: 'X', cards: cards.map((c) => Object.assign({}, c, { fakes: ['p', 'q', 'r'] })) };
  const d = FL.mergeSeedDeck(oldDeck, incoming);
  assert.deepEqual(d.learn.progress, { 'seed-c0': { stage: 1, misses: 0, seen: 1 } });
  assert.deepEqual(d.cram, before);
  assert.ok(d.cards.every((c) => c.fakes.length === 3));
  assert.deepEqual(d.upgrade, { kept: 3, fresh: 0 });
});

test('grade: a different number is never a typo', () => {
  assert.equal(FL.grade('C2H4', 'C2H6').correct, false);
  assert.equal(FL.grade('14.01', '12.01').correct, false);
  assert.equal(FL.grade('2, 8, 18', '2, 8, 8').correct, false);
  assert.equal(FL.grade('C2H6', 'C₂H₆').correct, true);
  assert.equal(FL.grade('polyethylen 6', 'polyethylene 6').correct, true);
});

test('grade: a typo that is as close to a known wrong answer is not accepted', () => {
  assert.equal(FL.grade('alkene', 'alkane').correct, true); // without context the grader forgives one letter
  const r = FL.grade('alkene', 'alkane', ['alkene', 'alkyne']);
  assert.equal(r.correct, false);
  assert.equal(r.close, true);
  assert.equal(FL.grade('alkanne', 'alkane', ['alkene', 'alkyne']).correct, true);
  assert.equal(FL.grade('alkane', 'alkane', ['alkene']).correct, true);
});

// ---------- grading: typed the way a student types ----------
test('grade accepts natural rewordings of the right answer', () => {
  const ok = (g, a) => assert.equal(FL.grade(g, a).correct, true, g + ' for ' + a);
  ok('colorants and polymers', 'polymers and colorants');   // list order
  ok('covalent and ionic', 'ionic and covalent');
  ok('double bond', 'the double bond');                     // articles
  ok('up and to the right', 'up and right');                // filler words
  ok('one valence electron', '1 valence electron');         // number words
  ok('zero', '0');
  ok('sodium', 'Na');                                       // element names
  ok('chlorine', 'Cl');
  ok('hydrogen', 'H');
  ok('2-10', '2 to 10');                                    // ranges
  ok('226', '226.32');                                      // rounding
  ok('16', '16.00');
  ok('1,783', '1783');
  ok('semisynthetic', 'semi-synthetic');                    // spacing
  ok('crosslinked', 'cross-linked');
  ok('polyacrylic acid', 'poly(acrylic acid)');
  ok('conh', 'C(=O)-NH');
  ok('h2c=chr', 'H2C=CHR');
  ok('hydrogen', 'hydrogens');                              // plurals
  ok('n+1', 'n + 1');
  ok('2 8 8', '2, 8, 8');
});

test('grade rejects answers that only look close', () => {
  const no = (g, a) => assert.equal(FL.grade(g, a).correct, false, g + ' for ' + a);
  no('n - 1', 'n + 1');
  no('F C O Na', 'F O C Na');            // ranking order matters
  no('poly', 'poly(acrylic acid)');     // parentheses in the answer itself are kept
  no('C NH', 'C(=O)-NH');
  no('227', '226.32');
  no('17', '16.00');
  no('1782', '1783');
  no('K', 'Na');
  no('2 8 18', '2, 8, 8');
});
