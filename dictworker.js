/* Dictionary import Web Worker.
 * Receives { type:'import', file: File, lang, replace } → decompresses + parses (zip / tar.xz / tar.gz / tsv),
 * writes indexed rows to IndexedDB in chunks and reports progress. The UI thread never blocks.
 *
 * Messages out:  { type:'progress', stage, pct }  ·  { type:'done', count, format, name }  ·  { type:'error', message }
 */
'use strict';
importScripts('lib/dexie.min.js', 'lib/jszip.min.js', 'lib/fflate.js', 'lib/xz-decompress.min.js', 'dictcore.js', 'dbschema.js');
DictCore.setLibs({ fflate: self.fflate, JSZip: self.JSZip, xz: self['xz-decompress'] });

var CHUNK = 2000;

function post(stage, pct) { self.postMessage({ type: 'progress', stage: stage, pct: Math.round(pct) }); }

function run(msg) {
  var db = defineReaderSchema(new Dexie(READER_DB_NAME));
  var lang = String(msg.lang || '').toLowerCase();
  if (!lang) return Promise.reject(new Error('No language selected.'));
  var count = 0, meta;

  post('read', 2);
  return msg.file.arrayBuffer().then(function (buf) {
    post('unpack', 8);
    return DictCore.parseFile(new Uint8Array(buf), msg.file.name, function (f) { post('parse', 25 + f * 30); });
  }).then(function (res) {
    meta = res;
    if (!res.entries.length) throw new Error('No dictionary entries were found in this file.');
    post('index', 58);
    var rows = DictCore.buildRows(lang, res.entries);
    res.entries = null;                                   // release the parsed copy before writing
    count = rows.length;
    // replace any previous dictionary of this language
    return db.transaction('rw', db.dictEntries, db.dictionaries, function () {
      return db.dictEntries.where('lang').equals(lang).delete().then(function () {
        return db.dictionaries.where('langCode').equals(lang).delete();
      });
    }).then(function () {
      var i = 0;
      function next() {
        if (i >= rows.length) return null;
        var part = rows.slice(i, i + CHUNK); i += CHUNK;
        return db.dictEntries.bulkPut(part).then(function () {
          post('store', 60 + 38 * Math.min(1, i / rows.length));
          return next();
        });
      }
      return next();
    });
  }).then(function () {
    return db.dictionaries.put({
      langCode: lang, source: msg.file.name, name: meta.name || msg.file.name, format: meta.format,
      count: count, importedAt: Date.now()
    });
  }).then(function () {
    db.close();
    self.postMessage({ type: 'done', count: count, format: meta.format, name: meta.name || msg.file.name });
  }).catch(function (e) {
    try { db.close(); } catch (x) {}
    throw e;
  });
}

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type !== 'import') return;
  run(m).catch(function (e) {
    self.postMessage({ type: 'error', message: (e && e.message) ? e.message : String(e) });
  });
};
