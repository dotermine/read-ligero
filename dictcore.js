/* DictCore — dictionary parsing + key normalization.
 * Shared by the import Web Worker (dictworker.js), the main thread (lookups) and the Node tests.
 *
 * Supported inputs:
 *   - StarDict (.ifo + .idx + .dict[.dz] [+ .syn]) inside .zip (WikDict), .tar.xz / .tar.gz / .tar / .zip (FreeDict)
 *   - Local TSV, headerless:  Word<TAB>Transcription<TAB>Translation
 *   - Legacy .json / .csv / .txt word lists (word, translation)
 *
 * Stored row shape (IndexedDB table dictEntries, primary key [lang+key], index [lang+fold]):
 *   { lang, key, fold, e: [[headword, transcription, definition], ...] }      normal row
 *   { lang, key, fold, ref: '<headword key>' }                                  synonym row (.syn) pointing at another row
 */
(function (root) {
  'use strict';

  var libs = { fflate: null, JSZip: null, xz: null };
  /** Injects decompression libraries (globals in a worker, require() in Node tests). */
  function setLibs(l) { for (var k in l) libs[k] = l[k]; }

  // ===================== Normalization =====================
  var EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
  var MARKS = /\p{M}/gu;

  /** key: lower-cased, NFC, unified apostrophes/dashes, trimmed. fold: key without diacritics (case + accent insensitive). */
  function norm(s) {
    var k = String(s == null ? '' : s)
      .normalize('NFC')
      .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(EDGE, '')
      .toLowerCase();
    var fold = k.normalize('NFD').replace(MARKS, '').replace(/\u00DF/g, 'ss').replace(/\u0131/g, 'i').normalize('NFC');
    return { key: k, fold: fold };
  }

  /** Lookup attempts for a tapped word, most specific first (exact → possessive stripped → hyphen/space variants). */
  function candidates(word) {
    var n = norm(word), out = [n.key];
    var add = function (s) { if (s && out.indexOf(s) < 0) out.push(s); };
    if (/'s$/.test(n.key)) add(n.key.slice(0, -2));
    if (/s'$/.test(n.key)) add(n.key.slice(0, -1));
    if (n.key.indexOf('-') > -1) add(n.key.replace(/-/g, ' '));
    if (n.key.indexOf(' ') > -1) add(n.key.replace(/ /g, '-'));
    // l'homme / d'un → homme / un (elision) — only when the part before the apostrophe is a single letter
    var el = /^[a-z\u00C0-\u024F]'(.+)$/i.exec(n.key); if (el) add(el[1]);
    return out;
  }

  // ===================== Text helpers =====================
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»' };
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        var c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(c); } catch (x) { return ''; }
      }
      var v = ENT[e.toLowerCase()]; return v != null ? v : m;
    });
  }

  /** HTML / XDXF / Pango → readable plain text (list items and <br> become line breaks). */
  function stripMarkup(s) {
    s = String(s || '');
    s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    s = s.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\s*\/\s*(p|div|li|tr|dd|dt|h\d|blockquote|ex|def|sense)\s*>/gi, '\n');
    s = s.replace(/<\s*li[^>]*>/gi, '• ').replace(/<\s*\/\s*(k|dtrn|co|kref)\s*>/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = decodeEntities(s);
    return s.replace(/[ \t\u00A0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  }

  /** Picks an IPA-like transcription out of the raw markup / text when the dictionary has no dedicated field. */
  function sniffTranscription(raw, text) {
    var m = /<\s*tr\s*>([^<]{1,80})<\s*\/\s*tr\s*>/i.exec(raw) ||
            /class=["'](?:ipa|transcription|pron|phon)[^"']*["'][^>]*>([^<]{1,80})</i.exec(raw);
    if (m) return decodeEntities(m[1]).trim();
    m = /^\s*(?:\/([^\/\n]{1,60})\/|\[([^\]\n]{1,60})\])\s*/.exec(text);
    return m ? (m[1] || m[2]).trim() : '';
  }

  var TEXT_TYPES = 'mlgxhwn';
  var PHON_TYPES = 'tky';
  var u8dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8(u8) { return u8dec.decode(u8); }

  /** Decodes text files of unknown encoding: BOMs (UTF-8 / UTF-16), strict UTF-8, then windows-1251 / windows-1252. */
  function decodeText(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) {}
    var hi = 0, cyr = 0;                                   // many bytes in 0xC0–0xFF → most likely Cyrillic windows-1251
    for (var i = 0; i < Math.min(u8.length, 4000); i++) { if (u8[i] >= 0x80) hi++; if (u8[i] >= 0xC0) cyr++; }
    return new TextDecoder(hi && cyr / hi > 0.6 ? 'windows-1251' : 'windows-1252').decode(u8);
  }

  /** True when the text looks like a tab-separated word list, whatever the file is called. */
  function looksLikeTsv(text) {
    var lines = text.split(/\r?\n/).slice(0, 50).filter(function (l) { return l.trim(); });
    return lines.length > 0 && lines.filter(function (l) { return l.indexOf('\t') > 0; }).length >= Math.ceil(lines.length / 2);
  }

  // ===================== TSV =====================
  /** Word<TAB>Transcription<TAB>Translation. Two columns are tolerated (Word<TAB>Translation). */
  function parseTsv(text) {
    var out = [], lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) continue;
      var c = line.split('\t');
      var w = (c[0] || '').trim(), t = '', d = '';
      if (c.length >= 3) { t = (c[1] || '').trim(); d = c.slice(2).join(' ').trim(); }
      else if (c.length === 2) { d = (c[1] || '').trim(); }
      else continue;
      if (w && (d || t)) out.push({ w: w, t: t, d: d });
    }
    return out;
  }

  /** Legacy formats: .json ({word: translation} | [{word, translation}]) and .csv/.txt (word<sep>translation). */
  function parseLegacy(text, ext) {
    var out = [];
    if (ext === 'json') {
      var data; try { data = JSON.parse(text); } catch (e) { return out; }
      if (Array.isArray(data)) data.forEach(function (it) {
        if (it && it.word && it.translation) out.push({ w: String(it.word), t: String(it.transcription || ''), d: String(it.translation) });
        else if (it && it.source && it.target) out.push({ w: String(it.source), t: '', d: String(it.target) });
      });
      else if (data && typeof data === 'object') Object.keys(data).forEach(function (k) { out.push({ w: k, t: '', d: String(data[k]) }); });
      return out;
    }
    String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var m = line.indexOf('\t') > -1 ? line.split('\t') : line.split(/[,;|]/);
      if (m.length >= 2 && m[0].trim() && m[1].trim()) out.push({ w: m[0].trim(), t: '', d: m.slice(1).join(' ').trim() });
    });
    return out;
  }

  // ===================== StarDict =====================
  function parseIfo(text) {
    var o = {};
    String(text).split(/\r?\n/).forEach(function (l, i) {
      if (!i && /^StarDict/i.test(l)) return;
      var p = l.indexOf('=');
      if (p > 0) o[l.slice(0, p).trim()] = l.slice(p + 1).trim();
    });
    return o;
  }

  function be32(dv, p) { return dv.getUint32(p, false); }
  function be64(dv, p) { return dv.getUint32(p, false) * 4294967296 + dv.getUint32(p + 4, false); }

  /** Splits the raw article bytes into typed fields according to sametypesequence (or the per-field type bytes). */
  function readFields(buf, seq) {
    var fields = [], pos = 0, dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    function nul(from) { var e = buf.indexOf(0, from); return e < 0 ? buf.length : e; }
    if (seq) {
      for (var i = 0; i < seq.length && pos <= buf.length; i++) {
        var type = seq[i], last = i === seq.length - 1, data;
        if (type >= 'A' && type <= 'Z') {
          if (last) { data = buf.subarray(pos); pos = buf.length; }
          else { var sz = be32(dv, pos); data = buf.subarray(pos + 4, pos + 4 + sz); pos += 4 + sz; }
        } else if (last) { data = buf.subarray(pos); pos = buf.length; }
        else { var e = nul(pos); data = buf.subarray(pos, e); pos = e + 1; }
        fields.push({ type: type, data: data });
      }
    } else {
      while (pos < buf.length) {
        var t = String.fromCharCode(buf[pos++]), d;
        if (t >= 'A' && t <= 'Z') { var s2 = be32(dv, pos); d = buf.subarray(pos + 4, pos + 4 + s2); pos += 4 + s2; }
        else { var e2 = nul(pos); d = buf.subarray(pos, e2); pos = e2 + 1; }
        fields.push({ type: t, data: d });
      }
    }
    return fields;
  }

  // ----- minimal output: ONLY the phonetic transcription and the translations (no long definitions) -----
  var POS = '(?:noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|numeral|particle|article|prefix|suffix|abbreviation|' +
            'adj|adv|pron|prep|conj|interj|num|art|abbr|n|v|a|m|f|mf|nt|neut|pl|sg|sing|plural|masc|fem|vt|vi|vr|vb)';
  var POS_LEAD = new RegExp('^' + POS + '\\b[.:)]?\\s*', 'i');
  var POS_ONLY = new RegExp('^(?:' + POS + '[.,;:)\\s/]*)+$', 'i');

  /**
   * Turns the readable text of one article into a short list of translations.
   * Drops: part-of-speech labels, numbering, (parenthetical glosses), [brackets], example sentences and
   * over-long explanations (when shorter alternatives exist). Result: ['Hund', 'Rüde'].
   */
  function minimizeText(text, headword) {
    var out = [], seen = {}, longLines = [];
    String(text || '').split('\n').forEach(function (line) {
      line = line.replace(/^[\s•·\-–—*\u25CF]+/, '').replace(/^(?:\d+|[a-z])[.)]\s+/i, '');
      var raw = line;
      line = line.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>|\u27E8[^\u27E9]*\u27E9/g, ' ').replace(/\s+/g, ' ').trim();
      if (!line) return;
      if (/^(?:example|examples|e\.g\.|usage|synonyms?|see also|cf\.|ant\.)\b/i.test(line)) return;
      if (/[\u201C\u201D\u00AB\u00BB"]/.test(raw) && line.split(' ').length > 3) return;      // quoted example sentence
      if (/^[–—»]/.test(raw)) return;
      line = line.replace(POS_LEAD, '').trim();
      if (!line || POS_ONLY.test(line)) return;
      // an explanation, not a translation: many words per comma/semicolon piece (or simply very long)
      var words = line.split(' ').length, pieces = line.split(/[;,\u3001\u060C]/).length;
      if (words > 14 || (words > 8 && words / pieces >= 3)) { longLines.push(line); return; }
      line.split(/[;,\u3001\u060C]/).forEach(function (c) {
        c = c.replace(POS_LEAD, '').replace(/[\s.:]+$/, '').trim();
        if (!c || POS_ONLY.test(c)) return;
        var k = norm(c).key;
        if (!k || seen[k]) return;                                   // (cognates equal to the headword are valid translations)
        seen[k] = 1; out.push(c);
      });
    });
    var short = out.filter(function (c) { return c.split(' ').length <= 6; });
    if (short.length) out = short;                                    // explanations only when nothing short exists
    if (!out.length && longLines.length) out = [longLines[0]];        // only an explanation exists: keep its start
    out = out.slice(0, 10).map(function (c) { return c.length > 80 ? c.slice(0, 79).replace(/\s+\S*$/, '') + '…' : c; });
    return out;
  }

  /** One article → { t: transcription, d: translations (one per line) }. */
  function articleToEntry(buf, seq, headword) {
    var fields = readFields(buf, seq), phon = '', texts = [], sniff = '', sniffRaw = '';
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i], raw = utf8(f.data).replace(/\0+$/, '');
      if (PHON_TYPES.indexOf(f.type) > -1) { if (!phon) phon = raw.trim(); continue; }
      if (TEXT_TYPES.indexOf(f.type) < 0) continue;       // images, sounds, resource lists
      if (f.type !== 'm' && f.type !== 'l') raw = raw.replace(/<\s*(ex|example|exm)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');   // example sentences
      var text = (f.type === 'm' || f.type === 'l') ? raw.replace(/\r/g, '').trim() : stripMarkup(raw);
      if (!sniff) { sniff = sniffTranscription(raw, text); sniffRaw = sniff; }
      if (text) texts.push(text);
    }
    var all = texts.join('\n');
    if (!phon && sniff) {
      phon = sniff;
      // remove the sniffed transcription from the text so it is neither shown twice nor taken for a translation
      var i0 = all.indexOf(sniffRaw);
      if (i0 > -1) all = (all.slice(0, i0).replace(/[\/\[]\s*$/, '') + all.slice(i0 + sniffRaw.length).replace(/^\s*[\/\]]/, '')).trim();
    }
    var tr = minimizeText(all, headword);
    if (!tr.length && all) tr = [all.split('\n')[0].replace(/\s+/g, ' ').slice(0, 80)];   // nothing parsable: keep the first line, shortened
    return { t: phon.replace(/^[\/\[]|[\/\]]$/g, '').trim(), d: tr.join('\n') };
  }

  /**
   * files: { ifo: string|Uint8Array, idx: Uint8Array (decompressed), dict: Uint8Array (decompressed), syn?: Uint8Array }
   * Returns [{ w, t, d, ref? }] — `ref` entries are synonyms: { w: synonym, ref: headword }.
   * onProgress(fraction 0..1) is optional.
   */
  function parseStarDict(files, onProgress) {
    var ifo = parseIfo(typeof files.ifo === 'string' ? files.ifo : decodeText(files.ifo));
    var seq = ifo.sametypesequence || '';
    var off64 = String(ifo.idxoffsetbits || '32') === '64';
    var idx = files.idx, dict = files.dict, dv = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
    var out = [], heads = [], pos = 0, n = 0, total = Number(ifo.wordcount) || 0, step = off64 ? 12 : 8;
    while (pos < idx.length) {
      var e = idx.indexOf(0, pos);
      if (e < 0 || e + 1 + step > idx.length) break;
      var word = utf8(idx.subarray(pos, e));
      var off = off64 ? be64(dv, e + 1) : be32(dv, e + 1);
      var size = be32(dv, e + 1 + (off64 ? 8 : 4));
      pos = e + 1 + step;
      heads.push(word);
      if (off + size <= dict.length && size > 0) {
        var ent = articleToEntry(dict.subarray(off, off + size), seq, word);
        if (word && (ent.d || ent.t)) out.push({ w: word, t: ent.t, d: ent.d });
      }
      if (onProgress && (++n & 4095) === 0 && total) onProgress(Math.min(1, n / total));
    }
    if (files.syn && files.syn.length) {                      // synonyms: word\0 + uint32 index into the idx entries
      var syn = files.syn, sdv = new DataView(syn.buffer, syn.byteOffset, syn.byteLength), sp = 0;
      while (sp < syn.length) {
        var se = syn.indexOf(0, sp);
        if (se < 0 || se + 5 > syn.length) break;
        var sw = utf8(syn.subarray(sp, se)), ix = be32(sdv, se + 1);
        sp = se + 5;
        if (sw && heads[ix] != null && heads[ix] !== sw) out.push({ w: sw, ref: heads[ix] });
      }
    }
    return out;
  }

  // ===================== Containers =====================
  function ends(name, suf) { return name.toLowerCase().slice(-suf.length) === suf; }

  function gunzip(u8) {
    if (libs.fflate) return libs.fflate.gunzipSync(u8);
    throw new Error('gzip support (fflate) is not available');
  }

  function xzDecompress(u8) {
    var X = libs.xz;
    if (!X || !X.XzReadableStream) return Promise.reject(new Error('xz support is not available'));
    var src = new ReadableStream({ start: function (c) { c.enqueue(u8); c.close(); } });
    var reader = new X.XzReadableStream(src).getReader(), chunks = [], len = 0;
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(len), p = 0;
          chunks.forEach(function (c) { out.set(c, p); p += c.length; });
          return out;
        }
        chunks.push(r.value); len += r.value.length; return pump();
      });
    })();
  }

  /** Minimal tar reader (ustar / GNU long names / pax headers are skipped). → [{ name, data }] */
  function untar(u8) {
    var files = [], pos = 0, longName = null;
    function str(a, b) { var s = utf8(u8.subarray(a, b)); var z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); }
    while (pos + 512 <= u8.length) {
      if (u8[pos] === 0) break;
      var name = str(pos, pos + 100), prefix = str(pos + 345, pos + 500);
      var size = parseInt(str(pos + 124, pos + 136).trim() || '0', 8) || 0;
      var type = String.fromCharCode(u8[pos + 156] || 48);
      pos += 512;
      if (type === 'L') { longName = str(pos, pos + size); }
      else if (type === 'x' || type === 'g') { /* pax header: ignore */ }
      else if (type === '0' || type === '\0') {
        var full = longName || (prefix ? prefix + '/' + name : name);
        longName = null;
        files.push({ name: full, data: u8.subarray(pos, pos + size) });
      } else { longName = null; }
      pos += Math.ceil(size / 512) * 512;
    }
    return files;
  }

  function isTar(u8) { return u8.length > 262 && String.fromCharCode(u8[257], u8[258], u8[259], u8[260], u8[261]) === 'ustar'; }
  function magic(u8) {
    if (u8[0] === 0x50 && u8[1] === 0x4B) return 'zip';
    if (u8[0] === 0xFD && u8[1] === 0x37 && u8[2] === 0x7A && u8[3] === 0x58 && u8[4] === 0x5A) return 'xz';
    if (u8[0] === 0x1F && u8[1] === 0x8B) return 'gz';
    if (isTar(u8)) return 'tar';
    return 'plain';
  }

  /**
   * Unpacks any supported container to a flat [{ name, data }] list.
   * `hint` is the original file name (only used to name single-file results).
   */
  function unpack(u8, hint) {
    var kind = magic(u8);
    if (kind === 'zip') {
      if (!libs.JSZip) return Promise.reject(new Error('zip support (JSZip) is not available'));
      return libs.JSZip.loadAsync(u8).then(function (zip) {
        var list = [];
        zip.forEach(function (path, f) { if (!f.dir) list.push(f); });
        return list.reduce(function (p, f) {
          return p.then(function (acc) { return f.async('uint8array').then(function (d) { acc.push({ name: f.name, data: d }); return acc; }); });
        }, Promise.resolve([])).then(function (flat) {
          // an archive inside the archive (e.g. zip → tar.xz) is unpacked as well
          return Promise.all(flat.map(function (f) {
            var k = magic(f.data);
            return (k === 'xz' || k === 'tar' || (k === 'gz' && /\.(tar\.gz|tgz|tar)$/i.test(f.name))) ? unpack(f.data, f.name) : [f];
          })).then(function (parts) { return [].concat.apply([], parts); });
        });
      });
    }
    if (kind === 'xz') return xzDecompress(u8).then(function (d) { return unpack(d, hint && hint.replace(/\.xz$/i, '')); });
    if (kind === 'gz') {
      var d = gunzip(u8);
      if (isTar(d)) return Promise.resolve(untar(d));
      return Promise.resolve([{ name: (hint || 'file').replace(/\.gz$/i, ''), data: d }]);
    }
    if (kind === 'tar') return Promise.resolve(untar(u8));
    return Promise.resolve([{ name: hint || 'file', data: u8 }]);
  }

  /** Reads a decompressed or compressed (.dz / .gz) StarDict member. */
  function maybeGunzip(f) {
    var d = f.data;
    return (d[0] === 0x1F && d[1] === 0x8B) ? gunzip(d) : d;
  }

  var baseName = function (n) { return String(n).replace(/\\/g, '/').split('/').pop(); };
  var dirName = function (n) { n = String(n).replace(/\\/g, '/'); var i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i); };
  /** Archive junk that must never be mistaken for dictionary files (macOS resource forks, hidden files). */
  var isJunk = function (n) { var b = baseName(n); return /(^|\/)__MACOSX\//.test(n) || b.charAt(0) === '.' || b === 'Thumbs.db'; };
  var stemOf = function (n) {
    var b = baseName(n).toLowerCase();
    return dirName(n).toLowerCase() + '/' + b.replace(/\.(ifo|idx\.gz|idx|dict\.dz|dict\.gz|dict|syn\.dz|syn\.gz|syn)$/, '');
  };
  var kindOf = function (n) {
    var b = baseName(n).toLowerCase();
    if (/\.ifo$/.test(b)) return 'ifo';
    if (/\.idx(\.gz)?$/.test(b)) return 'idx';
    if (/\.dict(\.dz|\.gz)?$/.test(b)) return 'dict';
    if (/\.syn(\.dz|\.gz)?$/.test(b)) return 'syn';
    return '';
  };

  /**
   * Finds the dictionary inside an unpacked file list — independent of file names, letter case, folders or junk.
   * Files are grouped by folder + stem (name without the StarDict suffix); if the names of the parts do not match
   * (e.g. renamed files), the unique .ifo/.idx/.dict files of the archive are used instead.
   * → { format: 'stardict', entries, name, wordcount } | { format: 'tsv', entries } — or throws a readable Error.
   */
  function entriesFromFiles(list, onProgress) {
    list = list.filter(function (f) { return !isJunk(f.name); });
    var groups = {}, byKind = { ifo: [], idx: [], dict: [], syn: [] };
    list.forEach(function (f) {
      var k = kindOf(f.name); if (!k) return;
      byKind[k].push(f);
      var g = groups[stemOf(f.name)] || (groups[stemOf(f.name)] = {}); g[k] = f;
    });
    var best = null;
    Object.keys(groups).forEach(function (k) { var g = groups[k]; if (g.ifo && g.idx && g.dict && (!best || g.dict.data.length > best.dict.data.length)) best = g; });
    if (!best && byKind.idx.length && byKind.dict.length) {            // names do not match: take the largest of each kind
      var big = function (a) { return a.slice().sort(function (x, y) { return y.data.length - x.data.length; })[0]; };
      best = { ifo: byKind.ifo[0] || null, idx: big(byKind.idx), dict: big(byKind.dict), syn: byKind.syn[0] || null };
    }
    if (best) {
      var info = best.ifo ? parseIfo(decodeText(best.ifo.data).replace(/\0/g, '')) : {};
      var entries = parseStarDict({
        ifo: best.ifo ? decodeText(best.ifo.data) : '', idx: maybeGunzip(best.idx), dict: maybeGunzip(best.dict),
        syn: best.syn ? maybeGunzip(best.syn) : null
      }, onProgress);
      return { format: 'stardict', entries: entries, name: info.bookname || (best.ifo ? baseName(best.ifo.name) : baseName(best.idx.name)), wordcount: Number(info.wordcount) || entries.length };
    }
    // no StarDict: a text word list inside the archive (any name; tsv first)
    var cand = list.filter(function (f) { return /\.(tsv|tab|txt|csv|json)$/i.test(f.name); })
      .sort(function (a, b) { return (/\.tsv$/i.test(b.name) ? 1 : 0) - (/\.tsv$/i.test(a.name) ? 1 : 0) || b.data.length - a.data.length; })[0];
    if (cand) return textDictionary(cand.data, cand.name);
    var found = list.slice(0, 8).map(function (f) { return baseName(f.name); }).join(', ');
    throw new Error('No dictionary found. Expected StarDict files (.ifo, .idx, .dict.dz) or a .tsv. The file contains: ' + (found || 'nothing') + '.');
  }

  /** Word list from raw bytes: TSV (Word<TAB>Transcription<TAB>Translation) detected by content, else legacy json/csv/txt. */
  function textDictionary(u8, name) {
    var text = decodeText(u8), ext = String(name).split('.').pop().toLowerCase(), entries, format;
    if (ext === 'json') { entries = parseLegacy(text, 'json'); format = 'legacy'; }
    else if (ext === 'tsv' || ext === 'tab' || looksLikeTsv(text)) { entries = parseTsv(text); format = 'tsv'; }
    else { entries = parseLegacy(text, ext); format = 'legacy'; }
    return { format: format, entries: entries, name: baseName(name), wordcount: entries.length };
  }

  /** Whole pipeline for one picked file (bytes + name). The file name only matters as a hint for plain text files. */
  function parseFile(u8, fileName, onProgress) {
    var name = String(fileName || 'dictionary');
    if (magic(u8) === 'plain') return Promise.resolve(textDictionary(u8, name));
    return unpack(u8, name).then(function (list) { return entriesFromFiles(list, onProgress); });
  }

  // ===================== Rows =====================
  var MAX_DEF = 4000, MAX_PER_KEY = 8;

  /** Entries → compact, merged rows keyed by normalized headword (homographs share one row; synonyms use `ref`). */
  function buildRows(lang, entries) {
    var map = new Map(), refs = [];
    for (var i = 0; i < entries.length; i++) {
      var en = entries[i], n = norm(en.w);
      if (!n.key) continue;
      if (en.ref) { refs.push({ n: n, ref: norm(en.ref).key }); continue; }
      var row = map.get(n.key);
      if (!row) { row = { lang: lang, key: n.key, fold: n.fold, e: [] }; map.set(n.key, row); }
      if (row.e.length < MAX_PER_KEY) {
        var d = String(en.d || '');
        row.e.push([String(en.w).trim(), en.t || '', d.length > MAX_DEF ? d.slice(0, MAX_DEF) + '…' : d]);
      }
    }
    for (var j = 0; j < refs.length; j++) {
      var r = refs[j];
      if (r.ref === r.n.key || map.has(r.n.key) || !map.has(r.ref)) continue;
      map.set(r.n.key, { lang: lang, key: r.n.key, fold: r.n.fold, ref: r.ref });
    }
    return Array.from(map.values());
  }

  /** Short gloss for pre-filling the "New word" form: first entry, lines joined with "; ", length-limited. */
  function shortGloss(entries, max) {
    max = max || 160;
    if (!entries || !entries.length) return '';
    var s = String(entries[0][2] || '').split('\n').map(function (x) { return x.replace(/^[•\-\d.)\s]+/, '').trim(); })
      .filter(Boolean).join('; ');
    return s.length > max ? s.slice(0, max - 1).replace(/[;,\s]+\S*$/, '') + '…' : s;
  }

  var api = {
    setLibs: setLibs, norm: norm, candidates: candidates, stripMarkup: stripMarkup,
    parseTsv: parseTsv, parseLegacy: parseLegacy, parseStarDict: parseStarDict, parseIfo: parseIfo,
    untar: untar, unpack: unpack, parseFile: parseFile, entriesFromFiles: entriesFromFiles,
    buildRows: buildRows, shortGloss: shortGloss, magic: magic, decodeText: decodeText, minimizeText: minimizeText
  };
  root.DictCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
