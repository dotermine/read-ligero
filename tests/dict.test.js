'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const DC = require('../dictcore.js');
DC.setLibs({ fflate: require('../lib/fflate.js'), JSZip: require('../lib/jszip.min.js'), xz: require('../lib/xz-decompress.min.js') });
const FX = f => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', f)));
let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log('  ✓', name); };
const rowsOf = async (file, lang = 'en') => { const r = await DC.parseFile(FX(file), file); return { r, rows: DC.buildRows(lang, r.entries), map: new Map(DC.buildRows(lang, r.entries).map(x => [x.key, x])) }; };

(async () => {
  console.log('dictcore.js (dictionary import)');

  await ok('norm(): case, accents, apostrophes, edge punctuation', () => {
    assert.deepStrictEqual(DC.norm('  “Café,”  '), { key: 'café', fold: 'cafe' });
    assert.strictEqual(DC.norm('Straße').fold, 'strasse');
    assert.strictEqual(DC.norm('don’t').key, "don't");
    assert.deepStrictEqual(DC.candidates("Dog’s"), ["dog's", 'dog']);
    assert.ok(DC.candidates("l’homme").includes('homme'));
  });

  await ok('WikDict-style .zip (StarDict, HTML articles, .syn synonyms)', async () => {
    const { r, map } = await rowsOf('wikdict-eng-deu.zip');
    assert.strictEqual(r.format, 'stardict'); assert.strictEqual(r.name, 'WikDict eng-deu');
    assert.deepStrictEqual(map.get('dog').e[0].slice(0, 1), ['dog']);
    assert.ok(/Hund/.test(map.get('dog').e[0][2]) && /Rüde/.test(map.get('dog').e[0][2]));
    assert.strictEqual(map.get('café').fold, 'cafe');
    assert.strictEqual(map.get('café').e[0][2], 'Kaffeehaus\nCafé');
    assert.ok(map.get('café').e[0][1].includes('kaˈfeː'));
    assert.deepStrictEqual(map.get('straße').e[0][2].split('\n'), ['street & road', 'Weg']);
    assert.strictEqual(map.get('house').e.length, 2);                       // homographs merged into one row
    assert.strictEqual(map.get('house').e[0][1], 'haʊs');                   // class="ipa" sniffed
    assert.strictEqual(map.get('dogs').ref, 'dog');                         // synonym row
    assert.strictEqual(map.get("dog's").ref, 'dog');
  });

  await ok('FreeDict-style .tar.xz (leading /ipa/ moved to transcription)', async () => {
    const { r, map } = await rowsOf('freedict-eng-fra.tar.xz');
    assert.strictEqual(r.format, 'stardict'); assert.strictEqual(r.entries.length, 2);
    assert.strictEqual(map.get('cat').e[0][1], 'kæt'); assert.strictEqual(map.get('cat').e[0][2], 'chat');
    assert.strictEqual(map.get('water').e[0][1], 'ˈwɔːtə');
  });

  await ok('FreeDict .tar.gz and .zip give the same entries', async () => {
    const a = (await rowsOf('freedict-eng-fra.tar.gz')).rows, b = (await rowsOf('freedict-eng-fra.zip')).rows, c = (await rowsOf('freedict-eng-fra.tar.xz')).rows;
    assert.deepStrictEqual(a, c); assert.deepStrictEqual(b, c);
  });

  await ok('StarDict without sametypesequence, phonetic field, 64-bit offsets, Cyrillic', async () => {
    const { map } = await rowsOf('rus-eng.zip', 'ru');
    assert.deepStrictEqual(map.get('книга').e[0], ['книга', 'knʲiɡə', 'book']);
    assert.deepStrictEqual(map.get('вода').e[0], ['вода', 'vɐˈda', 'water']);
  });

  await ok('local .tsv: Word<TAB>Transcription<TAB>Translation (+ junk lines ignored)', async () => {
    const { r, map } = await rowsOf('local.tsv');
    assert.strictEqual(r.format, 'tsv'); assert.strictEqual(r.entries.length, 3);
    assert.deepStrictEqual(map.get('apple').e[0], ['apple', '/ˈæp.əl/', 'яблоко']);
    assert.deepStrictEqual(map.get('bread').e[0], ['Bread', '/bred/', 'хлеб']);
    assert.strictEqual(map.get('café').e[0][2], 'кафе; кофейня');
  });

  await ok('minimal output: only transcription + translations (no English definitions / examples / POS)', async () => {
    const { map } = await rowsOf('messy-names.zip', 'de');
    const run = map.get('run').e[0];
    assert.strictEqual(run[1], 'rʌn');
    assert.deepStrictEqual(run[2].split('\n'), ['laufen', 'rennen', 'betreiben', 'führen']);          // long English explanation + example dropped
    assert.deepStrictEqual(map.get('bank').e[0][2].split('\n'), ['Bank', 'Ufer', 'Böschung']);          // "noun", numbering, (gloss), quoted example dropped
  });

  await ok('file names do not matter: renamed parts, UPPERCASE extensions, folders, __MACOSX junk, real dictzip (FEXTRA)', async () => {
    const r = await DC.parseFile(FX('messy-names.zip'), 'whatever.zip');
    assert.strictEqual(r.format, 'stardict'); assert.strictEqual(r.entries.length, 2);
  });

  await ok('TSV: UTF-16 BOM, windows-1251, any file name / extension', async () => {
    for (const [f, n] of [['utf16.tsv', 2], ['cp1251.txt', 3], ['wordlist.dat', 2]]) {
      const r = await DC.parseFile(FX(f), f); assert.strictEqual(r.format, 'tsv', f); assert.strictEqual(r.entries.length, n, f);
    }
    const c = await DC.parseFile(FX('cp1251.txt'), 'cp1251.txt'); assert.strictEqual(c.entries[2].d, 'вода');
    const u = await DC.parseFile(FX('utf16.tsv'), 'utf16.tsv'); assert.strictEqual(u.entries[0].t, '/ˈæp.əl/');
  });

  await ok('shortGloss(): joins lines, strips bullets, limits length', async () => {
    const { map } = await rowsOf('wikdict-eng-deu.zip');
    assert.strictEqual(DC.shortGloss(map.get('dog').e), 'Hund; Rüde');
    assert.ok(DC.shortGloss([['x', '', 'a '.repeat(300)]], 50).length <= 51);
  });

  await ok('errors are readable', async () => {
    await assert.rejects(DC.parseFile(new Uint8Array([0x50, 0x4B, 3, 4, 0, 0]), 'broken.zip'));
    const empty = await DC.parseFile(new TextEncoder().encode('no tabs here\n'), 'x.tsv');
    assert.strictEqual(empty.entries.length, 0);
  });

  console.log(n + ' tests passed');
})().catch(e => { console.error(e); process.exit(1); });
