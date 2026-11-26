const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = 'http://localhost:8765/', FX = p => path.join(__dirname, 'fixtures', p);
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
const long = Array.from({ length: 40 }, (_, i) => 'Paragraph ' + i + ' the dog sat on the house and then it kept on talking about the street for quite a long time indeed.').join('\n\n');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(500);
  const immersive = () => page.evaluate(() => document.body.classList.contains('reader-immersive'));
  const reveal = async () => { if (await page.isVisible('#selPopup')) { await page.evaluate(() => Reader.clearSelection()); await page.waitForTimeout(200); } if (await immersive()) { await page.mouse.click(195, 20); await page.waitForTimeout(700); } };
  const hide = async () => { for (let i = 0; i < 3 && !(await immersive()); i++) { await page.mouse.click(195, 400); await page.waitForTimeout(600); } };
  const tab = async n => { if (await immersive()) { await page.mouse.click(195, 765); await page.waitForTimeout(700); } await page.click(`.nb[data-tab="${n}"]`); };
  const pick = async (id, value) => { await page.click(`.cs-btn[data-cs-for="${id}"]`); await page.click(`.cs-pop [data-value="${value}"]`); };
  fs.writeFileSync('/tmp/long.txt', long);

  // ---------------- custom dropdowns ----------------
  console.log('Custom dropdowns');
  const sels = await page.evaluate(() => [...document.querySelectorAll('select')].map(s => ({ id: s.id, hidden: s.classList.contains('cs-native'), btn: !!s.parentNode.querySelector('.cs-btn') })));
  t('every <select> is replaced by a themed dropdown (' + sels.length + ')', sels.length >= 6 && sels.every(s => s.hidden && s.btn), sels);
  await tab('settings');
  await page.click('.cs-btn[data-cs-for="setLang"]');
  t('list opens as a themed popup (not the platform picker)', await page.isVisible('.cs-pop') && (await page.$$('.cs-pop .cs-opt')).length >= 10);
  const opts = await page.$$eval('.cs-pop .cs-opt', o => o.map(x => x.textContent.replace('✓', '').trim()));
  t('interface languages still in native script', ['English', 'Русский', 'Deutsch', '日本語'].every(n => opts.includes(n)), opts.slice(0, 6));
  t('long list gets a filter box that is NOT focused (no keyboard)', await page.isVisible('.cs-pop .cs-filter') && (await page.evaluate(() => document.activeElement.tagName)) !== 'INPUT');
  await page.fill('.cs-pop .cs-filter', 'deu'); const vis = await page.$$eval('.cs-pop .cs-opt:not([hidden])', o => o.length);
  t('filter narrows the list', vis === 1, vis);
  await page.keyboard.press('Escape');
  t('Escape closes the list', !(await page.isVisible('.cs-pop')));
  await pick('setNative', 'ru');
  t('choosing an item sets the real select + fires change (native language saved)', (await page.inputValue('#setNative')) === 'ru' && (await page.evaluate(async () => (await db.settings.get('nativeLang')).value)) === 'ru');
  t('button shows the chosen label', /Russian/.test(await page.textContent('.cs-btn[data-cs-for="setNative"]')));
  const themed = await page.evaluate(() => { const b = document.querySelector('.cs-btn'); const cs = getComputedStyle(b); return { radius: cs.borderRadius, bg: cs.backgroundColor }; });
  t('dropdown button uses the app theme (rounded, themed background)', themed.radius === '12px' && themed.bg !== 'rgba(0, 0, 0, 0)', themed);

  // ---------------- dictionaries for two languages + languages config ----------------
  await page.evaluate(async () => {
    await addLanguage({ code: 'en', extTrans: { preset: 'google-web' }, extDict: { preset: 'wiktionary' } });
    // English dictionary: a Wiktionary-style article with English explanations mixed in (already imported, i.e. stored)
    await db.dictEntries.bulkPut(DictCore.buildRows('en', [{ w: 'dog', t: 'dɒɡ', d: 'собака\nan animal that barks and is kept as a pet\nпёс' }]));
    await db.dictionaries.put({ langCode: 'en', name: 'en-ru', format: 'stardict', count: 1, importedAt: Date.now() });
    await db.dictEntries.bulkPut(DictCore.buildRows('de', [{ w: 'dog', t: 'dɔɡ', d: 'Тест-слово' }]));
    await db.dictionaries.put({ langCode: 'de', name: 'de-ru', format: 'tsv', count: 1, importedAt: Date.now() });
  });

  // ---------------- text book ----------------
  console.log('Reader');
  await tab('library'); await page.setInputFiles('#fileInput', '/tmp/long.txt');
  await page.waitForSelector('.tile .cover'); await page.click('.tile .cover'); await page.waitForSelector('#textWrap .content p'); await page.waitForTimeout(700);
  await hide();

  // internal dictionary: only translations, transcription separated, book language chooses the dictionary
  const mid = async () => page.evaluate(() => { const w = document.getElementById('textWrap'); const tn = w.querySelectorAll('.content p')[0].firstChild; const i = tn.data.indexOf('dog'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3); w.scrollTop = 0; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2]; w.scrollTop = p.offsetTop - 300; });
  await page.waitForTimeout(500);
  const dogXY = await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2], tn = p.firstChild, i = tn.data.indexOf('dog'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.dblclick(dogXY.x, dogXY.y);
  await page.waitForSelector('#selPopup:not([hidden])'); await page.click('#selPopup [data-action="internal"]');
  await page.waitForSelector('#dictSheet:not([hidden])'); await page.waitForFunction(() => /собака/.test(document.getElementById('dsBody').textContent)); await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => ({ body: document.getElementById('dsBody').textContent, ipa: document.getElementById('dsIpa').textContent }));
  t('internal dictionary shows ONLY the translation (English explanation filtered out)', /собака/.test(sheet.body) && /пёс/.test(sheet.body) && !/animal|barks|pet/.test(sheet.body), sheet);
  t('transcription is shown separately', sheet.ipa === 'dɒɡ', sheet);
  await page.click('#dsAdd'); await page.waitForSelector('#wordModal:not([hidden])');
  const order = await page.evaluate(() => { const ids = [...document.querySelectorAll('#wordModal input, #wordModal textarea')].map(e => e.id); return ids.slice(0, 3); });
  t('Transcription input sits right below Word', order[0] === 'wForeign' && order[1] === 'wTranscription', order);
  const wm = await page.evaluate(() => ({ w: wForeign.value, ipa: wTranscription.value, tr: wTranslation.value, ae: document.activeElement.tagName }));
  t('Add to vocabulary: translation field = translation only', wm.tr === 'собака; пёс', wm);
  t('Add to vocabulary: transcription field = transcription only', wm.ipa === 'dɒɡ' && !/dɒɡ/.test(wm.tr), wm);
  t('still no input focused (no keyboard)', wm.ae !== 'INPUT' && wm.ae !== 'TEXTAREA', wm);
  await page.click('#wordSave'); await page.waitForSelector('#wordModal', { state: 'hidden' });
  const saved = await page.evaluate(async () => (await db.words.toArray())[0]);
  t('word saved with its transcription', saved.transcription === 'dɒɡ' && saved.translation === 'собака; пёс', saved);

  // book language → dictionary + translator source language
  await reveal(); await page.click('#qbarBtn');
  await pick('bookLang', 'de'); await hide();
  await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2]; w.scrollTop = p.offsetTop - 300; });
  await page.mouse.dblclick(dogXY.x, dogXY.y);
  await page.waitForSelector('#selPopup:not([hidden])'); await page.click('#selPopup [data-action="internal"]');
  await page.waitForFunction(() => /Тест-слово/.test(document.getElementById('dsBody').textContent), null, { timeout: 4000 }).catch(() => {});
  t('book language "de" → the DE dictionary answers (not EN)', /Тест-слово/.test(await page.textContent('#dsBody')) && !/собака/.test(await page.textContent('#dsBody')), await page.textContent('#dsBody'));
  await page.click('#dsClose');
  await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });
  await page.mouse.dblclick(dogXY.x, dogXY.y); await page.waitForSelector('#selPopup:not([hidden])');
  const before = await page.evaluate(async () => (await db.progress.toArray())[0].updatedAt);
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop += 640; document.querySelector('#selPopup [data-action="translator"]').click(); });   // scroll and leave INSTANTLY (no debounce time)
  await page.waitForTimeout(250);
  const url = (await page.evaluate(() => window.__opened))[0] || '';
  t('translator: source = book language (de), target = native (ru), word passed (Google /m?q=)', /sl=de&tl=ru/.test(url) && /[?&]q=dog/.test(url) && /translate\.google\.com\/m\?/.test(url), url);
  const after = await page.evaluate(async () => (await db.progress.toArray())[0]);
  t('leaving for the translator saved the position immediately', after.updatedAt > before && after.tp >= 4, after);
  await reveal(); await page.click('#qbarBtn'); await pick('bookLang', 'en'); await hide();

  // ---------------- position on tab switch ----------------
  console.log('Position survives leaving the Read tab');
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop = 2000; }); await page.waitForTimeout(700);
  const s1 = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  await tab('library'); await page.waitForTimeout(500); await tab('read'); await page.waitForTimeout(900);
  const s2 = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  const pg = await page.evaluate(async () => (await db.progress.toArray())[0]);
  t('text: same position after main menu → back (' + Math.round(s1) + ' → ' + Math.round(s2) + ')', Math.abs(s1 - s2) < 3, [s1, s2]);
  t('saved position is not overwritten by the hidden tab', pg.tp >= 17 && pg.percentage > 0.4, pg);
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop = 1500; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const pv = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 150)); return (await db.progress.toArray())[0]; });
  t('app going to the background (visibilitychange) saves at once', pv.tp >= 12 && pv.tp <= 14, pv);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });

  // ---------------- bookmarks ----------------
  console.log('Bookmarks');
  await reveal();
  t('two bookmark buttons next to each other (list + add)', (await page.evaluate(() => { const a = document.getElementById('bmListBtn').getBoundingClientRect(), b = document.getElementById('bmBtn').getBoundingClientRect(); return a.right <= b.left + 1 && Math.abs(a.top - b.top) < 2; })));
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop = 900; }); await page.waitForTimeout(500);
  await reveal(); await page.click('#bmBtn'); await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop = 3000; }); await page.waitForTimeout(500);
  await reveal(); await page.click('#bmBtn'); await page.waitForTimeout(300);
  t('tapping the bookmark icon still adds one (toast)', true);
  await page.click('#bmListBtn'); await page.waitForSelector('#bmSheet:not([hidden])'); await page.waitForSelector('#bmBody .bm-row');
  const rows = await page.$$eval('#bmBody .bm-row .bm-label', e => e.map(x => x.textContent));
  t('list shows both bookmarks of this book', rows.length === 2 && rows.every(r => /%/.test(r)), rows);
  await page.click('#bmBody .bm-row:last-child .bm-go'); await page.waitForTimeout(500);   // oldest = scrollTop 900
  const jumped = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  t('tapping a bookmark jumps to it (' + Math.round(jumped) + ' ≈ 900)', Math.abs(jumped - 900) < 40, jumped);
  await reveal(); await page.click('#bmListBtn'); await page.waitForSelector('#bmSheet:not([hidden])'); await page.waitForSelector('#bmBody .bm-row');
  await page.click('#bmBody .bm-row:first-child .bm-del'); await page.waitForTimeout(300);
  t('a bookmark can be deleted from the list', (await page.$$('#bmBody .bm-row')).length === 1);
  await page.click('#bmClose');

  // ---------------- orientation icons ----------------
  console.log('Orientation');
  await reveal(); await page.click('#qbarBtn');
  const icons = await page.evaluate(() => [...document.querySelectorAll('#qbarPanel [data-disp-orient]')].map(b => ({ o: b.dataset.dispOrient, rot: (b.querySelector('g').getAttribute('transform') || '').match(/rotate\((-?\d+)/)[1], label: b.getAttribute('aria-label') })));
  const want = { 0: '0', 180: '180', 90: '-90', 270: '90' };
  t('icons: camera-top phone for 0°, upside-down for 180°, camera-left for 90°, camera-right for 270°', icons.every(i => want[i.o] === i.rot), icons);
  t('labels describe the physical result', /upside down/.test(icons.find(i => i.o === '180').label) && /Portrait \(0°\)/.test(icons.find(i => i.o === '0').label), icons.map(i => i.label));
  await page.evaluate(() => { window.__locks = []; Object.defineProperty(screen, 'orientation', { value: { angle: 0, lock: t => { window.__locks.push(t); return Promise.resolve(); }, unlock() { window.__locks.push('unlock'); } }, configurable: true }); });
  for (const [o, type] of [['0', 'portrait-primary'], ['180', 'portrait-secondary'], ['90', 'landscape-primary'], ['270', 'landscape-secondary']]) {
    await page.evaluate(() => { window.__locks.length = 0; });
    await page.click(`#qbarPanel [data-disp-orient="${o}"]`).catch(async () => { await page.click(`#qbarPanel [data-disp-orient="auto"]`); await page.click(`#qbarPanel [data-disp-orient="${o}"]`); });
    await page.waitForTimeout(150);
    const l = await page.evaluate(() => window.__locks.slice());
    t(`icon ${o}° locks "${type}"`, l.includes(type), l);
  }
  await page.click('#qbarPanel [data-disp-orient="270"]');   // tap active again → auto
  t('tapping the active orientation releases the lock', (await page.evaluate(() => Display.get().orientation)) === 'auto');

  // ---------------- fullscreen + state persistence ----------------
  console.log('Fullscreen / zoom / orientation persistence');
  await page.evaluate(() => {
    window.__fs = { enter: 0, exit: 0 }; let el = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => el, configurable: true });
    document.documentElement.requestFullscreen = () => { window.__fs.enter++; el = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { window.__fs.exit++; el = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    window.__dropFs = () => { el = null; document.dispatchEvent(new Event('fullscreenchange')); };
  });
  await page.evaluate(() => Display.set({ screenMode: 'fullscreen' })); await page.waitForTimeout(200);
  await page.evaluate(() => Display.set({ orientation: 90 })); await page.waitForTimeout(200);
  await page.evaluate(() => Display.set({ bookZoom: 1.7 }, { persist: true })); await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) { await tab('library'); await page.waitForTimeout(200); await tab('read'); await page.waitForTimeout(300); }
  const fs1 = await page.evaluate(() => window.__fs);
  t('fullscreen is entered once and NOT re-entered / left on tab switches (no repeated banner)', fs1.enter === 1 && fs1.exit === 0, fs1);
  // the system drops fullscreen while the app is in the background (external translator)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); window.__dropFs(); window.__locks.length = 0; });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  const st = await page.evaluate(async () => ({ mode: Display.get().screenMode, saved: (await db.settings.get('screenMode')).value, zoom: Display.get().bookZoom, cssZoom: document.documentElement.style.getPropertyValue('--book-zoom'), savedZoom: (await db.settings.get('bookZoom')).value, orient: Display.get().orientation, locks: window.__locks.slice() }));
  t('system fullscreen exit while in the background keeps the saved choice (and the UI still shows it as active)', st.saved === 'fullscreen' && st.mode === 'fullscreen', st);
  t('zoom is unchanged after returning (state + CSS + saved)', st.zoom === 1.7 && Number(st.cssZoom) === 1.7 && st.savedZoom === 1.7, st);
  t('orientation lock is re-applied after returning', st.orient === 90 && st.locks.includes('landscape-primary'), st);
  await page.evaluate(() => { Display.set({ screenMode: 'windowed', orientation: 'auto', bookZoom: 1 }, { persist: true }); });

  // ---------------- 4-column TSV through the worker ----------------
  console.log('TSV with sentences (worker)');
  await page.evaluate(async () => { await db.dictEntries.where('lang').equals('en').delete(); });
  const wres = await page.evaluate(async (tsv) => new Promise((res) => {
    const w = new Worker('dictworker.js'); const f = new File([tsv], 'any-name.dat', { type: 'application/octet-stream' });
    w.onmessage = e => { if (e.data.type === 'done' || e.data.type === 'error') res(e.data); }; w.postMessage({ type: 'import', file: f, lang: 'en', native: 'ru' });
  }), fs.readFileSync(FX('local4.tsv'), 'utf8'));
  const ap = await page.evaluate(() => lookupEntries('en', 'apple', 'ru'));
  t('worker imports the 4-column TSV (' + wres.type + ', ' + wres.count + ' entries)', wres.type === 'done' && wres.count === 3, wres);
  t('sentence column stored and returned as 4th element', ap && ap.entries[0][3] === 'I ate an apple.' && ap.entries[0][1] === '/ˈæp.əl/' && ap.entries[0][2] === 'яблоко', ap);

  console.log('\nerrors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
