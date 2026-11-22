/* global Dexie, defineReaderSchema, READER_DB_NAME, DictCore, Quiz */
// IndexedDB layer (Dexie). Schema + migrations live in dbschema.js (shared with the dictionary import worker).
var db = defineReaderSchema(new Dexie(READER_DB_NAME));

// ===================== PERSISTENT STORAGE =====================
/** Asks the browser not to evict our IndexedDB data under storage pressure. */
function enforcePersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return Promise.resolve({ supported: false, persisted: false });
  }
  return navigator.storage.persisted().then(function (p) {
    if (p) return { supported: true, persisted: true };
    return navigator.storage.persist().then(function (granted) {
      return { supported: true, persisted: granted };
    });
  }).catch(function () { return { supported: true, persisted: false }; });
}

/** { usage, quota } in bytes, or null when the Storage API has no estimate. */
function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().then(function (e) { return { usage: e.usage || 0, quota: e.quota || 0 }; })
    .catch(function () { return null; });
}

// ===================== BOOKS =====================
function saveBook(file) {
  return file.arrayBuffer().then(function (buf) {
    var ext = file.name.split('.').pop().toLowerCase();
    var title = file.name.replace(/\.[^/.]+$/, '');
    return db.transaction('rw', db.books, db.files, db.progress, function () {
      return db.books.add({
        title: title, format: ext, size: file.size,
        addedAt: Date.now(), lastOpenedAt: Date.now(),
        cover: null, favorite: false
      }).then(function (id) {
        return db.files.put({ bookId: id, data: buf }).then(function () {
          return db.progress.put({ bookId: id, percentage: 0, location: 1, updatedAt: Date.now() })
            .then(function () { return id; });
        });
      });
    });
  });
}

function listBooks() { return db.books.orderBy('lastOpenedAt').reverse().toArray(); }
function getBook(id) { return db.books.get(Number(id)); }
function getBookFile(id) { return db.files.get(Number(id)); }
function getProgress(id) { return db.progress.get(Number(id)); }

function saveProgress(id, patch) {
  var bid = Number(id);
  return db.progress.get(bid).then(function (p) {
    p = p || { bookId: bid, percentage: 0, location: 1 };
    for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
    p.updatedAt = Date.now();
    return db.progress.put(p).then(function () {
      return db.books.update(bid, { lastOpenedAt: Date.now() });
    });
  });
}

function saveBookCover(id, dataUrl) {
  return db.books.update(Number(id), { cover: dataUrl });
}

function setBookFavorite(id, value) {
  return db.books.update(Number(id), { favorite: !!value });
}

function deleteBook(id) {
  var bid = Number(id);
  return db.transaction('rw', db.books, db.files, db.progress, db.bookmarks, db.words, db.lookups, function () {
    return db.books.delete(bid)
      .then(function () { return db.files.delete(bid); })
      .then(function () { return db.progress.delete(bid); })
      .then(function () { return db.bookmarks.where('bookId').equals(bid).delete(); })
      .then(function () { return db.lookups.where('bookId').equals(bid).delete(); })
      .then(function () { return db.words.where('bookId').equals(bid).delete(); });
  });
}

function listBookmarks() { return db.bookmarks.orderBy('createdAt').reverse().toArray(); }
function addBookmark(bookId, label, percentage, cfi) {
  var bid = Number(bookId);
  return db.books.get(bid).then(function (b) {
    return db.bookmarks.add({
      bookId: bid, bookTitle: b ? b.title : 'Unknown',
      label: label, percentage: percentage || 0,
      cfi: cfi || null, createdAt: Date.now()
    });
  });
}
function removeBookmark(id) { return db.bookmarks.delete(Number(id)); }

// ===================== SETTINGS =====================
function getSetting(key, fb) {
  return db.settings.get(key).then(function (r) { return r ? r.value : fb; });
}
function setSetting(key, value) { return db.settings.put({ key: key, value: value }); }

// ===================== WORDS (with SM-2 spaced-repetition fields) =====================
function addWord(data) {
  var now = Date.now();
  var rec = {
    foreign: String(data.foreign || '').trim() || '-',
    translation: String(data.translation || '').trim() || '-',
    context: String(data.context || '').trim() || '-',
    sentenceTranslation: String(data.sentenceTranslation || '').trim() || '-',
    langCode: String(data.langCode || 'en').toLowerCase(),
    bookId: (data.bookId != null) ? Number(data.bookId) : null,
    createdAt: now,
    due: now                       // legacy field, kept equal to nextReviewDate for older code paths
  };
  var srs = Quiz.newCardFields(now);
  for (var k in srs) rec[k] = srs[k];
  return db.words.add(rec);
}

function listWords() { return db.words.orderBy('createdAt').reverse().toArray(); }
function listWordsForBook(bookId) {
  return db.words.where('bookId').equals(Number(bookId)).toArray();
}
function deleteWord(id) { return db.words.delete(Number(id)); }
function countWords() { return db.words.count(); }

/** Persists the result of one rating (the patch returned by Quiz.schedule). */
function updateWordSrs(id, patch) {
  var p = {};
  for (var k in patch) if (patch.hasOwnProperty(k)) p[k] = patch[k];
  if (p.nextReviewDate != null) p.due = p.nextReviewDate;
  return db.words.update(Number(id), p);
}

// ===================== LOOKUPS (dictionary look-ups that were not added to the vocabulary) =====================
function addLookup(bookId, word) {
  return db.lookups.put({ bookId: Number(bookId), word: String(word).toLowerCase(), createdAt: Date.now() });
}
function listLookups(bookId) { return db.lookups.where('bookId').equals(Number(bookId)).toArray(); }

// ===================== LANGUAGES =====================
function listLanguages() { return db.languages.orderBy('code').toArray(); }
function getLanguage(code) { return db.languages.where('code').equals(String(code || '').toLowerCase()).first(); }

/** data: { code, externalDict, externalTranslator, extDict:{preset,custom}, extTrans:{preset,custom} } */
function addLanguage(data) {
  return db.languages.add({
    code: String(data.code || '').toLowerCase().trim(),
    externalDict: String(data.externalDict || '').trim(),
    externalTranslator: String(data.externalTranslator || '').trim(),
    extDict: data.extDict || null,
    extTrans: data.extTrans || null,
    createdAt: Date.now()
  });
}
function updateLanguage(id, patch) { return db.languages.update(Number(id), patch); }

function deleteLanguage(id) {
  return db.transaction('rw', db.languages, db.dictionaries, db.dictEntries, function () {
    return db.languages.get(Number(id)).then(function (l) {
      if (!l) return null;
      return db.languages.delete(Number(id)).then(function () {
        return db.dictEntries.where('lang').equals(l.code).delete();
      }).then(function () {
        return db.dictionaries.where('langCode').equals(l.code).delete();
      });
    });
  });
}

// ===================== DICTIONARIES (indexed; imported by dictworker.js) =====================
function getDictionaryMeta(langCode) { return db.dictionaries.where('langCode').equals(langCode).first(); }

function deleteDictionary(langCode) {
  return db.transaction('rw', db.dictionaries, db.dictEntries, function () {
    return db.dictEntries.where('lang').equals(langCode).delete().then(function () {
      return db.dictionaries.where('langCode').equals(langCode).delete();
    });
  });
}

/**
 * Looks a word up in the local dictionary. Resolves { key, entries: [[headword, transcription, definition], ...] } or null.
 * Order: exact normalized key → simple variants (possessive, hyphen/space, elision) → accent-insensitive index.
 * Every step is an index lookup (O(log n)); synonym rows (.syn) are followed once.
 */
function lookupEntries(langCode, word) {
  var lang = String(langCode || '').toLowerCase();
  var cands = DictCore.candidates(word);
  if (!cands[0]) return Promise.resolve(null);

  function resolve(row) {
    if (!row) return null;
    if (row.e) return { key: row.key, entries: row.e };
    if (row.ref) return db.dictEntries.get([lang, row.ref]).then(function (r) { return r && r.e ? { key: r.key, entries: r.e } : null; });
    return null;
  }
  function byKey(i) {
    if (i >= cands.length) return byFold(0);
    return db.dictEntries.get([lang, cands[i]]).then(resolve).then(function (hit) { return hit || byKey(i + 1); });
  }
  function byFold(i) {
    if (i >= cands.length) return null;
    var fold = DictCore.norm(cands[i]).fold;
    return db.dictEntries.where('[lang+fold]').equals([lang, fold]).first().then(resolve).then(function (hit) { return hit || byFold(i + 1); });
  }
  return db.dictEntries.where('lang').equals(lang).limit(1).count().then(function (n) { return n ? byKey(0) : null; });
}

/** Short gloss (string) for pre-filling forms, or null when the word is unknown. */
function lookupWord(langCode, word) {
  return lookupEntries(langCode, word).then(function (r) { return r ? (DictCore.shortGloss(r.entries) || null) : null; });
}
