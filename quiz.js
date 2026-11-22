/* Quiz engine: SM-2 / Anki-style spaced repetition (SRS).
 *
 * Pure logic (no DOM, no IndexedDB) so it can be unit-tested in Node (see tests/).
 * app.js drives the UI and persists the patches returned by Quiz.schedule().
 *
 * Per-word SRS metadata (stored on the word record in IndexedDB):
 *   status          'new' | 'learning' | 'review' | 'relearning'
 *   easeFactor      SM-2 ease (starts at 2.5, never below 1.3)
 *   interval        days; the current review interval (for learning cards: 0, for relearning: the interval
 *                   the card returns to after it graduates)
 *   repetitions     consecutive successful reviews (reset on a lapse)
 *   lapses          how many times the word was forgotten while in review
 *   step            index into the learning / relearning step list
 *   nextReviewDate  ms timestamp when the card is due
 *   lastReviewDate  ms timestamp of the last answer
 *
 * Ratings: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
 */
(function (root) {
  'use strict';

  var MIN = 60 * 1000, DAY = 24 * 60 * MIN;

  var DEFAULTS = {
    learningSteps: [1, 10],        // minutes, for new cards
    relearnSteps: [10],            // minutes, after a lapse
    graduatingInterval: 1,         // days, "Good" on the last learning step
    easyInterval: 4,               // days, "Easy" on a learning card
    startingEase: 2.5,
    minEase: 1.3,
    hardFactor: 1.2,
    easyBonus: 1.3,
    lapseIntervalFactor: 0.5,      // interval kept after a lapse (min 1 day)
    maxInterval: 36500,            // days
    learnAheadMs: 20 * MIN,        // learning cards due within this window are shown now
    newPerSession: 10,
    maxReviewsPerSession: 200
  };

  function cfgOf(c) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    if (c) for (k in c) if (c[k] != null) o[k] = c[k];
    return o;
  }

  /** Fresh SRS fields for a newly added word. */
  function newCardFields(now) {
    now = now || Date.now();
    return {
      status: 'new', easeFactor: DEFAULTS.startingEase, interval: 0, repetitions: 0, lapses: 0,
      step: 0, nextReviewDate: now, lastReviewDate: 0
    };
  }

  function statusOf(w) {
    if (w.status === 'new' || w.status === 'learning' || w.status === 'review' || w.status === 'relearning') return w.status;
    return 'new';
  }

  function clampInterval(d, cfg) { return Math.max(1, Math.min(cfg.maxInterval, Math.round(d))); }

  /**
   * Computes the new state of a card after a rating. Pure: returns a patch, does not mutate `card`.
   * `now` is injectable for tests and for the interval previews on the buttons.
   */
  function schedule(card, grade, now, config) {
    var cfg = cfgOf(config);
    now = now || Date.now();
    var st = statusOf(card);
    var ease = Number(card.easeFactor) || cfg.startingEase;
    var interval = Number(card.interval) || 0;
    var reps = Number(card.repetitions) || 0;
    var lapses = Number(card.lapses) || 0;
    var step = Number(card.step) || 0;
    var p = { lastReviewDate: now };

    function inMinutes(m) { return now + m * MIN; }
    function graduate(days) {
      p.status = 'review'; p.step = 0;
      p.interval = clampInterval(days, cfg);
      p.nextReviewDate = now + p.interval * DAY;
    }

    if (st === 'new' || st === 'learning') {
      var LS = cfg.learningSteps;
      if (st === 'new') step = 0;
      step = Math.min(step, LS.length - 1);
      p.status = 'learning'; p.easeFactor = ease; p.lapses = lapses; p.repetitions = reps;
      if (grade === 1) {
        p.step = 0; p.interval = 0; p.nextReviewDate = inMinutes(LS[0]);
      } else if (grade === 2) {
        // Hard: repeat the step (on the first step: halfway to the second step)
        var d = (step === 0 && LS.length > 1) ? (LS[0] + LS[1]) / 2 : (LS.length === 1 ? LS[0] * 1.5 : LS[step]);
        p.step = step; p.interval = 0; p.nextReviewDate = inMinutes(d);
      } else if (grade === 3) {
        if (step + 1 >= LS.length) { graduate(cfg.graduatingInterval); p.repetitions = 1; }
        else { p.step = step + 1; p.interval = 0; p.nextReviewDate = inMinutes(LS[step + 1]); }
      } else {
        graduate(cfg.easyInterval); p.repetitions = 1;
      }
      return p;
    }

    if (st === 'relearning') {
      var RL = cfg.relearnSteps;
      step = Math.min(step, RL.length - 1);
      p.status = 'relearning'; p.easeFactor = ease; p.lapses = lapses; p.repetitions = reps;
      if (grade === 1) {
        p.step = 0; p.interval = interval; p.nextReviewDate = inMinutes(RL[0]);
      } else if (grade === 2) {
        p.step = step; p.interval = interval; p.nextReviewDate = inMinutes(RL[step]);
      } else if (grade === 3) {
        if (step + 1 >= RL.length) { graduate(Math.max(1, interval)); p.easeFactor = ease; p.lapses = lapses; p.repetitions = reps; }
        else { p.step = step + 1; p.interval = interval; p.nextReviewDate = inMinutes(RL[step + 1]); }
      } else {
        graduate(Math.max(1, interval) + 1); p.easeFactor = ease; p.lapses = lapses; p.repetitions = reps;
      }
      return p;
    }

    // ---- review card ----
    var overdue = Math.max(0, (now - (Number(card.nextReviewDate) || now)) / DAY); // days late
    if (grade === 1) {
      p.status = 'relearning'; p.step = 0;
      p.lapses = lapses + 1; p.repetitions = 0;
      p.easeFactor = Math.max(cfg.minEase, ease - 0.2);
      p.interval = clampInterval(Math.max(1, interval * cfg.lapseIntervalFactor), cfg);
      p.nextReviewDate = inMinutes(cfg.relearnSteps[0]);
      return p;
    }
    var hard = Math.max(interval + 1, Math.round((interval + overdue / 4) * cfg.hardFactor));
    var good = Math.max(hard + 1, Math.round((interval + overdue / 2) * ease));
    var easy = Math.max(good + 1, Math.round((interval + overdue) * ease * cfg.easyBonus));
    p.status = 'review'; p.step = 0; p.lapses = lapses; p.repetitions = reps + 1;
    if (grade === 2) { p.easeFactor = Math.max(cfg.minEase, ease - 0.15); p.interval = clampInterval(hard, cfg); }
    else if (grade === 3) { p.easeFactor = ease; p.interval = clampInterval(good, cfg); }
    else { p.easeFactor = ease + 0.15; p.interval = clampInterval(easy, cfg); }
    p.nextReviewDate = now + p.interval * DAY;
    return p;
  }

  /** "<1m", "10m", "3h", "4d", "2.5mo", "1.2y" — the label shown under each rating button. */
  function formatInterval(ms) {
    var m = ms / MIN;
    if (m < 1) return '<1m';
    if (m < 60) return Math.round(m) + 'm';
    var h = m / 60;
    if (h < 24) return Math.round(h) + 'h';
    var d = h / 24;
    if (d < 30) return Math.round(d) + 'd';
    var tidy = function (x) { return String(Math.round(x * 10) / 10).replace(/\.0$/, ''); };
    if (d < 365) return tidy(d / 30) + 'mo';
    return tidy(d / 365) + 'y';
  }

  /** Interval labels for the four buttons of a card: ['<1m', '6m', '10m', '4d']. */
  function previewLabels(card, now, config) {
    now = now || Date.now();
    return [1, 2, 3, 4].map(function (g) { return formatInterval(schedule(card, g, now, config).nextReviewDate - now); });
  }

  /** Counts for the quiz home screen. A word counts as "due" when it is no longer new and its time has come. */
  function counts(words, now, config) {
    var cfg = cfgOf(config);
    now = now || Date.now();
    var c = { total: words.length, newCount: 0, learning: 0, due: 0, queue: 0 };
    words.forEach(function (w) {
      var st = statusOf(w);
      if (st === 'new') c.newCount++;
      else if (st === 'learning' || st === 'relearning') { if ((w.nextReviewDate || 0) <= now + cfg.learnAheadMs) c.learning++; }
      else if ((w.nextReviewDate || 0) <= now) c.due++;
    });
    c.queue = c.learning + c.due + Math.min(c.newCount, cfg.newPerSession);
    return c;
  }

  /** Earliest future review time among the given words (or 0). Used for the "nothing due" message. */
  function nextDueAt(words, now) {
    now = now || Date.now();
    var best = 0;
    words.forEach(function (w) {
      if (statusOf(w) === 'new') return;
      var t = w.nextReviewDate || 0;
      if (t > now && (!best || t < best)) best = t;
    });
    return best;
  }

  /**
   * Builds the study queue: due learning cards first, then overdue reviews (most overdue first),
   * then a configurable batch of new words (oldest first).
   */
  function buildQueue(words, now, config) {
    var cfg = cfgOf(config);
    now = now || Date.now();
    var learning = [], reviews = [], fresh = [];
    words.forEach(function (w) {
      var st = statusOf(w), due = w.nextReviewDate || 0;
      if (st === 'new') fresh.push(w);
      else if (st === 'learning' || st === 'relearning') { if (due <= now + cfg.learnAheadMs) learning.push(w); }
      else if (due <= now) reviews.push(w);
    });
    var byDue = function (a, b) { return (a.nextReviewDate || 0) - (b.nextReviewDate || 0); };
    learning.sort(byDue);
    reviews.sort(byDue);
    fresh.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0) || (a.id || 0) - (b.id || 0); });
    return learning.concat(reviews.slice(0, cfg.maxReviewsPerSession), fresh.slice(0, cfg.newPerSession));
  }

  /**
   * A live study session. Cards rated "Again" (and cards still inside their learning steps) are put back
   * into the queue a few cards later, so the session only ends when every card has been recalled.
   */
  function Session(words, now, config) {
    this.cfg = cfgOf(config);
    this.queue = buildQueue(words, now, config).map(function (w) { return Object.assign({}, w); });
    this.total = this.queue.length;
    this.graduated = 0;           // cards that left the queue for good
    this.answers = 0;
    this.ratings = { 1: 0, 2: 0, 3: 0, 4: 0 };
  }
  Session.prototype.current = function () { return this.queue[0] || null; };
  Session.prototype.remaining = function () { return this.queue.length; };
  Session.prototype.finished = function () { return this.queue.length === 0; };
  /** Applies a rating to the current card. Returns { id, patch, requeued }; the caller persists the patch. */
  Session.prototype.answer = function (grade, now) {
    var card = this.queue.shift();
    if (!card) return null;
    now = now || Date.now();
    var patch = schedule(card, grade, now, this.cfg);
    Object.assign(card, patch);
    this.answers++;
    this.ratings[grade] = (this.ratings[grade] || 0) + 1;
    var requeued = card.status === 'learning' || card.status === 'relearning';
    if (requeued) {
      var gap = grade === 1 ? 3 : 6;                          // Again comes back sooner than Good-in-learning
      this.queue.splice(Math.min(gap, this.queue.length), 0, card);
    } else {
      this.graduated++;
    }
    return { id: card.id, patch: patch, requeued: requeued };
  };

  var api = {
    DEFAULTS: DEFAULTS, schedule: schedule, previewLabels: previewLabels, formatInterval: formatInterval,
    counts: counts, nextDueAt: nextDueAt, buildQueue: buildQueue, Session: Session,
    newCardFields: newCardFields, statusOf: statusOf, DAY: DAY, MIN: MIN
  };
  root.Quiz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
