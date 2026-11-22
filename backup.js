/* global db */
/**
 * Backup — manual JSON export / import so users never lose vocabulary and reading progress.
 *
 * Exported: settings, languages (+ external dictionary/translator config), dictionary metadata, books (metadata,
 * optionally the files themselves as base64), reading progress, bookmarks, look-ups, vocabulary with SRS state.
 * NOT exported: dictionary entries (can be large — re-import the original dictionary file).
 *
 * Import MERGES into the current data. Books are matched by title + size, so for a full restore of progress
 * either export with book files, or add the same book files first and import afterwards.
 */
var Backup = (function () {
  'use strict';

  var FORMAT = 'readligero-backup', VERSION = 1;

  function bufToB64(buf) {
    var u8 = new Uint8Array(buf), CH = 0x8000, parts = [];
    for (var i = 0; i < u8.length; i += CH) parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + CH)));
    return btoa(parts.join(''));
  }
  function b64ToBuf(b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }
  var sig = function (b) { return String(b.title || '') + '|' + (b.size || 0); };

  /** → Promise<Blob> (application/json). */
  function exportAll(opts) {
    opts = opts || {};
    return Promise.all([
      db.settings.toArray(), db.languages.toArray(), db.dictionaries.toArray(), db.books.toArray(),
      db.progress.toArray(), db.bookmarks.toArray(), db.lookups.toArray(), db.words.toArray()
    ]).then(function (r) {
      var books = r[3];
      var filesP = opts.includeBooks
        ? Promise.all(books.map(function (b) {
            return db.files.get(b.id).then(function (f) { return f && f.data ? { id: b.id, data: bufToB64(f.data) } : null; });
          }))
        : Promise.resolve([]);
      return filesP.then(function (files) {
        var fileById = {}; files.forEach(function (f) { if (f) fileById[f.id] = f.data; });
        var out = {
          format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), includesBookFiles: !!opts.includeBooks,
          settings: r[0], languages: r[1].map(function (l) { delete l.id; return l; }),
          dictionaries: r[2].map(function (d) { return { langCode: d.langCode, source: d.source, name: d.name, format: d.format, count: d.count }; }),
          books: books.map(function (b) {
            var o = Object.assign({}, b); o.cover = b.cover || null;
            if (fileById[b.id]) o.fileBase64 = fileById[b.id];
            return o;
          }),
          progress: r[4], bookmarks: r[5], lookups: r[6], words: r[7]
        };
        return new Blob([JSON.stringify(out)], { type: 'application/json' });
      });
    });
  }

  function validate(o) {
    if (!o || o.format !== FORMAT) throw new Error('This is not a ReadLigero backup file.');
    if (o.version > VERSION) throw new Error('This backup was made by a newer version of the app.');
  }

  /** Merges a parsed backup into IndexedDB. → Promise<{ words, books, bookmarks, languages }> (counts of added items). */
  function importAll(o) {
    validate(o);
    var added = { words: 0, books: 0, bookmarks: 0, languages: 0 };
    var idMap = {};                                         // backup book id → current book id
    return db.transaction('rw', db.settings, db.languages, db.books, db.files, db.progress, db.bookmarks, db.lookups, db.words, function () {
      return db.books.toArray().then(function (existing) {
        var bySig = {}; existing.forEach(function (b) { bySig[sig(b)] = b.id; });
        return (o.books || []).reduce(function (p, b) {
          return p.then(function () {
            var s = sig(b);
            if (bySig[s] != null) { idMap[b.id] = bySig[s]; return null; }
            if (!b.fileBase64) return null;                 // metadata only and the file is not here: cannot recreate the book
            var rec = Object.assign({}, b); delete rec.id; delete rec.fileBase64;
            return db.books.add(rec).then(function (nid) {
              idMap[b.id] = nid; bySig[s] = nid; added.books++;
              return db.files.put({ bookId: nid, data: b64ToBuf(b.fileBase64) });
            });
          });
        }, Promise.resolve());
      }).then(function () {
        // reading progress: only for books that exist now; newer position wins
        return (o.progress || []).reduce(function (p, pr) {
          return p.then(function () {
            var nid = idMap[pr.bookId]; if (nid == null) return null;
            return db.progress.get(nid).then(function (cur) {
              if (cur && (cur.updatedAt || 0) >= (pr.updatedAt || 0)) return null;
              var rec = Object.assign({}, pr, { bookId: nid }); return db.progress.put(rec);
            });
          });
        }, Promise.resolve());
      }).then(function () {
        return db.bookmarks.toArray().then(function (cur) {
          var seen = {}; cur.forEach(function (b) { seen[b.bookId + '|' + b.createdAt] = 1; });
          var rows = [];
          (o.bookmarks || []).forEach(function (b) {
            var nid = idMap[b.bookId]; if (nid == null || seen[nid + '|' + b.createdAt]) return;
            var rec = Object.assign({}, b, { bookId: nid }); delete rec.id; rows.push(rec);
          });
          added.bookmarks = rows.length; return db.bookmarks.bulkAdd(rows);
        });
      }).then(function () {
        var rows = [];
        (o.lookups || []).forEach(function (l) { var nid = idMap[l.bookId]; if (nid != null) rows.push(Object.assign({}, l, { bookId: nid })); });
        return db.lookups.bulkPut(rows);
      }).then(function () {
        return db.words.toArray().then(function (cur) {
          var seen = {}; cur.forEach(function (w) { seen[w.langCode + '|' + String(w.foreign).toLowerCase() + '|' + w.context] = 1; });
          var rows = [];
          (o.words || []).forEach(function (w) {
            var k = w.langCode + '|' + String(w.foreign).toLowerCase() + '|' + w.context;
            if (seen[k]) return; seen[k] = 1;
            var rec = Object.assign({}, w); delete rec.id;
            rec.bookId = (w.bookId != null && idMap[w.bookId] != null) ? idMap[w.bookId] : null;
            if (typeof migrateWordSrs === 'function') migrateWordSrs(rec);       // backups from older versions
            rows.push(rec);
          });
          added.words = rows.length; return db.words.bulkAdd(rows);
        });
      }).then(function () {
        return db.languages.toArray().then(function (cur) {
          var have = {}; cur.forEach(function (l) { have[l.code] = 1; });
          var rows = (o.languages || []).filter(function (l) { return l.code && !have[l.code]; });
          added.languages = rows.length; return db.languages.bulkAdd(rows);
        });
      }).then(function () { return db.settings.bulkPut(o.settings || []); });
    }).then(function () { return added; });
  }

  function importFile(file) {
    return file.text().then(function (t) {
      var o; try { o = JSON.parse(t); } catch (e) { throw new Error('The file is not valid JSON.'); }
      return importAll(o);
    });
  }

  return { exportAll: exportAll, importAll: importAll, importFile: importFile };
})();
