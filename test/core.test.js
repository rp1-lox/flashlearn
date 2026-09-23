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
  const s = FL.defaultSettings();
  assert.equal(FL.questionType({ stage: 0 }, s), 'mc');
  assert.equal(FL.questionType({ stage: 1 }, s), 'written');
  assert.equal(FL.questionType({ stage: 0 }, { mc: false, written: true }), 'written');
  assert.equal(FL.questionType({ stage: 1 }, { mc: true, written: false }), 'mc');
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
  const s = FL.defaultSettings();
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
  const s = Object.assign(FL.defaultSettings(), { mc: false });
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
