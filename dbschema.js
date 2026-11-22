/* Shared IndexedDB schema (main thread + dictionary import worker).
 * Database name kept as 'ReaderQuizDB' so existing installs keep their data; migrations run automatically.
 *
 * Lookup performance: dictEntries has a compound PRIMARY KEY [lang+key] (exact hit = one B-tree lookup, O(log n))
 * and a secondary index [lang+fold] for accent/case-insensitive fallback. No dictionary is ever scanned linearly.
 */
(function (root) {
  'use strict';

  var DB_NAME = 'ReaderQuizDB';

  /** v4 → v5 word migration: FSRS-lite fields → SM-2 fields (status, easeFactor, interval, repetitions, nextReviewDate). */
  function migrateWordSrs(w) {
    if (w.easeFactor != null && w.status) return;
    var st = w.state || 'new', reps = Number(w.reps) || 0, due = Number(w.due) || Number(w.createdAt) || Date.now();
    w.easeFactor = 2.5;
    w.lapses = Number(w.lapses) || 0;
    w.step = 0;
    w.lastReviewDate = Number(w.lastReview) || 0;
    if (st === 'new' || !reps) {
      w.status = 'new'; w.interval = 0; w.repetitions = 0; w.nextReviewDate = due;
    } else if (st === 'learning') {
      w.status = 'learning'; w.interval = 0; w.repetitions = 0; w.nextReviewDate = due;
    } else {
      w.status = 'review';
      w.interval = Math.max(1, Math.round(Number(w.stability) || 1));
      w.repetitions = reps; w.nextReviewDate = due;
    }
  }

  function defineReaderSchema(db) {
    db.version(1).stores({
      books:     '++id, title, format, lastOpenedAt',
      files:     'bookId',
      progress:  'bookId',
      bookmarks: '++id, bookId, createdAt',
      settings:  'key'
    });

    db.version(2).stores({
      words: '++id, foreign, translation, due, createdAt, *tags'
    });

    db.version(3).stores({
      languages:    '++id, &code',
      dictionaries: '++id, langCode',
      books:        '++id, title, format, lastOpenedAt, cover, favorite',
      words:        '++id, foreign, translation, due, createdAt, langCode, bookId, *tags'
    }).upgrade(function (tx) {
      return tx.table('words').toCollection().modify(function (w) {
        if (!w.langCode) w.langCode = 'en';
        if (typeof w.bookId === 'undefined') w.bookId = null;
      });
    });

    // v4: "addedAt" index for sorting, and "lookups" (words looked up but not added to the vocabulary)
    db.version(4).stores({
      books:   '++id, title, format, lastOpenedAt, addedAt, cover, favorite',
      lookups: '[bookId+word], bookId'
    }).upgrade(function (tx) {
      return tx.table('books').toCollection().modify(function (b) {
        if (!b.addedAt) b.addedAt = b.lastOpenedAt || Date.now();
      });
    });

    // v5: SM-2 spaced repetition fields (indexed: nextReviewDate, status) + indexed dictionary entries.
    //     `dictionaries` now only holds metadata (one row per imported dictionary); the entries live in dictEntries.
    db.version(5).stores({
      words:       '++id, foreign, translation, due, createdAt, langCode, bookId, nextReviewDate, status, *tags',
      dictEntries: '[lang+key], [lang+fold], lang'
    }).upgrade(function (tx) {
      return tx.table('words').toCollection().modify(migrateWordSrs).then(function () {
        // Legacy dictionaries stored one big `entries` array per language: move them into the indexed table.
        return tx.table('dictionaries').toArray();
      }).then(function (dicts) {
        var DC = root.DictCore;
        return dicts.reduce(function (p, d) {
          return p.then(function () {
            if (!Array.isArray(d.entries) || !DC) return null;
            var entries = d.entries.map(function (e) { return { w: e.word, t: '', d: e.translation }; });
            var rows = DC.buildRows(d.langCode, entries);
            return tx.table('dictEntries').bulkPut(rows).then(function () {
              return tx.table('dictionaries').put({
                id: d.id, langCode: d.langCode, source: d.source || '', format: 'legacy',
                count: rows.length, importedAt: Date.now()
              });
            });
          });
        }, Promise.resolve());
      });
    });
    return db;
  }

  root.READER_DB_NAME = DB_NAME;
  root.defineReaderSchema = defineReaderSchema;
  root.migrateWordSrs = migrateWordSrs;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DB_NAME: DB_NAME, defineReaderSchema: defineReaderSchema, migrateWordSrs: migrateWordSrs };
})(typeof self !== 'undefined' ? self : this);
