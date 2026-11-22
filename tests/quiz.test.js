'use strict';
const assert = require('assert');
const Q = require('../quiz.js');
const M = Q.MIN, D = Q.DAY, T0 = 1_700_000_000_000;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

console.log('quiz.js (SM-2 / Anki-style SRS)');

ok('new card: Again/Hard/Good/Easy previews', () => {
  const c = Object.assign({ id: 1, createdAt: T0 }, Q.newCardFields(T0));
  assert.deepStrictEqual(Q.previewLabels(c, T0), ['1m', '6m', '10m', '4d']); // 1m, avg(1,10)≈5.5→6m, 10m, easy 4d
});

ok('new card: Good → learning step 2 → Good → graduates to 1 day', () => {
  let c = Object.assign({ id: 1 }, Q.newCardFields(T0));
  let p = Q.schedule(c, 3, T0); assert.strictEqual(p.status, 'learning'); assert.strictEqual(p.step, 1);
  assert.strictEqual(p.nextReviewDate, T0 + 10 * M);
  c = Object.assign({}, c, p);
  p = Q.schedule(c, 3, T0 + 10 * M);
  assert.strictEqual(p.status, 'review'); assert.strictEqual(p.interval, 1); assert.strictEqual(p.repetitions, 1);
  assert.strictEqual(p.nextReviewDate, T0 + 10 * M + D);
});

ok('learning card: Again resets to step 0', () => {
  const c = { status: 'learning', step: 1, easeFactor: 2.5, interval: 0 };
  const p = Q.schedule(c, 1, T0); assert.strictEqual(p.step, 0); assert.strictEqual(p.nextReviewDate, T0 + M);
});

ok('review card: Good multiplies by ease, Hard < Good < Easy, ease changes', () => {
  const c = { status: 'review', interval: 10, easeFactor: 2.5, repetitions: 3, lapses: 0, nextReviewDate: T0 };
  const h = Q.schedule(c, 2, T0), g = Q.schedule(c, 3, T0), e = Q.schedule(c, 4, T0);
  assert.strictEqual(h.interval, 12); assert.strictEqual(g.interval, 25); assert.strictEqual(e.interval, 33);
  assert.ok(h.interval < g.interval && g.interval < e.interval);
  assert.strictEqual(h.easeFactor, 2.35); assert.strictEqual(g.easeFactor, 2.5); assert.strictEqual(e.easeFactor, 2.65);
  assert.strictEqual(g.repetitions, 4);
});

ok('review card: overdue cards get a bonus', () => {
  const c = { status: 'review', interval: 10, easeFactor: 2.5, nextReviewDate: T0 - 4 * D };
  const g = Q.schedule(c, 3, T0); assert.strictEqual(g.interval, Math.round((10 + 2) * 2.5)); // (10+4/2)*2.5 = 30
});

ok('review card: Again = lapse → relearning, ease −0.2 (min 1.3), reps reset', () => {
  const c = { status: 'review', interval: 20, easeFactor: 1.35, repetitions: 5, lapses: 1, nextReviewDate: T0 };
  const p = Q.schedule(c, 1, T0);
  assert.strictEqual(p.status, 'relearning'); assert.strictEqual(p.lapses, 2); assert.strictEqual(p.repetitions, 0);
  assert.strictEqual(p.easeFactor, 1.3); assert.strictEqual(p.interval, 10); assert.strictEqual(p.nextReviewDate, T0 + 10 * M);
});

ok('relearning: Good graduates back to review with the kept interval', () => {
  const c = { status: 'relearning', step: 0, interval: 10, easeFactor: 2.3, lapses: 2, repetitions: 0 };
  const p = Q.schedule(c, 3, T0); assert.strictEqual(p.status, 'review'); assert.strictEqual(p.interval, 10);
  assert.strictEqual(p.easeFactor, 2.3); assert.strictEqual(p.lapses, 2);
});

ok('formatInterval', () => {
  assert.strictEqual(Q.formatInterval(30 * 1000), '<1m'); assert.strictEqual(Q.formatInterval(10 * M), '10m');
  assert.strictEqual(Q.formatInterval(3 * 60 * M), '3h'); assert.strictEqual(Q.formatInterval(4 * D), '4d');
  assert.strictEqual(Q.formatInterval(75 * D), '2.5mo'); assert.strictEqual(Q.formatInterval(400 * D), '1.1y');
});

ok('buildQueue: learning first, then overdue reviews (most overdue first), then limited new words', () => {
  const mk = (id, o) => Object.assign({ id, createdAt: id }, o);
  const words = [
    mk(1, { status: 'new', nextReviewDate: T0 }), mk(2, { status: 'new', nextReviewDate: T0 }), mk(3, { status: 'new', nextReviewDate: T0 }),
    mk(4, { status: 'review', nextReviewDate: T0 - 1 * D }), mk(5, { status: 'review', nextReviewDate: T0 - 5 * D }),
    mk(6, { status: 'review', nextReviewDate: T0 + 3 * D }),                       // not due
    mk(7, { status: 'learning', nextReviewDate: T0 + 5 * M }),                     // within learn-ahead
    mk(8, { status: 'relearning', nextReviewDate: T0 + 3 * 60 * M })               // too far ahead
  ];
  const q = Q.buildQueue(words, T0, { newPerSession: 2 }).map(w => w.id);
  assert.deepStrictEqual(q, [7, 5, 4, 1, 2]);
  const c = Q.counts(words, T0, { newPerSession: 2 });
  assert.deepStrictEqual([c.newCount, c.learning, c.due, c.queue], [3, 1, 2, 5]);
  assert.strictEqual(Q.nextDueAt(words, T0), T0 + 5 * M);
});

ok('Session: Again re-queues within the session until recalled', () => {
  const words = [{ id: 1, createdAt: 1 }, { id: 2, createdAt: 2 }, { id: 3, createdAt: 3 }].map(w => Object.assign(w, Q.newCardFields(T0)));
  const s = new Q.Session(words, T0, { newPerSession: 10 });
  assert.strictEqual(s.total, 3);
  let r = s.answer(1, T0);                                   // card 1: Again
  assert.ok(r.requeued); assert.strictEqual(s.remaining(), 3);
  assert.deepStrictEqual(s.queue.map(c => c.id), [2, 3, 1]);
  s.answer(4, T0);                                           // card 2: Easy → leaves the queue
  s.answer(4, T0);                                           // card 3: Easy → leaves
  assert.strictEqual(s.remaining(), 1); assert.strictEqual(s.current().id, 1);
  r = s.answer(1, T0); assert.ok(r.requeued); assert.strictEqual(s.remaining(), 1);   // still not recalled
  r = s.answer(3, T0); assert.ok(r.requeued);                // Good → learning step 2, still in session
  r = s.answer(3, T0); assert.ok(!r.requeued); assert.ok(s.finished());              // Good → graduates
  assert.strictEqual(s.graduated, 3); assert.strictEqual(s.ratings[1], 2);
});

console.log(n + ' tests passed');
