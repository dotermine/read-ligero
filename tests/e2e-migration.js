const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = 'http://localhost:8765/';
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // 1) seed a v4 database exactly like the previous app version created it
  await page.goto(BASE + 'manifest.json');
  await page.addScriptTag({ url: BASE + 'lib/dexie.min.js' });
  await page.evaluate(async () => {
    const db = new Dexie('ReaderQuizDB');
    db.version(1).stores({ books: '++id, title, format, lastOpenedAt', files: 'bookId', progress: 'bookId', bookmarks: '++id, bookId, createdAt', settings: 'key' });
    db.version(2).stores({ words: '++id, foreign, translation, due, createdAt, *tags' });
    db.version(3).stores({ languages: '++id, &code', dictionaries: '++id, langCode', books: '++id, title, format, lastOpenedAt, cover, favorite', words: '++id, foreign, translation, due, createdAt, langCode, bookId, *tags' });
    db.version(4).stores({ books: '++id, title, format, lastOpenedAt, addedAt, cover, favorite', lookups: '[bookId+word], bookId' });
    const now = Date.now();
    await db.words.bulkAdd([
      { foreign: 'alpha', translation: 'A', context: '-', sentenceTranslation: '-', langCode: 'en', bookId: null, createdAt: now - 3, due: now, state: 'new', reps: 0, stability: 0 },
      { foreign: 'beta', translation: 'B', context: '-', sentenceTranslation: '-', langCode: 'en', bookId: null, createdAt: now - 2, due: now - 86400000, state: 'review', reps: 4, stability: 9.4, difficulty: 5 },
      { foreign: 'gamma', translation: 'C', context: '-', sentenceTranslation: '-', langCode: 'en', bookId: null, createdAt: now - 1, due: now + 5 * 86400000, state: 'learning', reps: 1, stability: 0.5 }
    ]);
    await db.languages.add({ code: 'en', externalDict: 'goldendict://{word}', externalTranslator: '', createdAt: now });
    await db.dictionaries.add({ langCode: 'en', entries: [{ word: 'Hello', translation: 'Привет' }, { word: 'Café', translation: 'кафе' }] });
    db.close();
  });
  // 2) boot the new app on top of it
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => ({
    ver: db.verno,
    words: (await db.words.orderBy('createdAt').toArray()).map(w => ({ f: w.foreign, s: w.status, i: w.interval, e: w.easeFactor, r: w.repetitions, d: w.nextReviewDate })),
    dict: await lookupEntries('en', 'cafe'), hello: await lookupWord('en', 'HELLO'),
    meta: await db.dictionaries.toArray(), lang: await getLanguage('en')
  }));
  t('database upgraded to v5', r.ver === 5, r.ver);
  t('new word → status new, ease 2.5', r.words[0].s === 'new' && r.words[0].e === 2.5 && r.words[0].i === 0, r.words[0]);
  t('FSRS review word → status review, interval ≈ stability (9), repetitions kept', r.words[1].s === 'review' && r.words[1].i === 9 && r.words[1].r === 4, r.words[1]);
  t('learning word → status learning', r.words[2].s === 'learning', r.words[2]);
  t('nextReviewDate carried over from old "due"', r.words.every(w => typeof w.d === 'number' && w.d > 0));
  t('legacy dictionary moved into indexed table (accent-insensitive lookup works)', r.dict && r.dict.entries[0][2] === 'кафе', r.dict);
  t('legacy lookup case-insensitive', r.hello === 'Привет', r.hello);
  t('dictionary metadata row rewritten (no huge entries array)', r.meta.length === 1 && !r.meta[0].entries && r.meta[0].count === 2, r.meta);
  t('legacy language keeps external URL; presets resolve it as custom', r.lang.externalDict === 'goldendict://{word}');
  await page.click('.nb[data-tab="quiz"]'); await page.waitForTimeout(400);
  t('quiz home counts migrated words (due 1, new 1)', (await page.textContent('#statDue')) === '1' && (await page.textContent('#statNew')) === '1', [await page.textContent('#statDue'), await page.textContent('#statNew')]);
  console.log('errors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
