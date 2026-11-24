const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
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
  const reveal = async () => {
    if (await page.isVisible('#selPopup')) { await page.evaluate(() => Reader.clearSelection()); await page.waitForTimeout(300); }   // dismiss a popup first (it may sit over the top edge)
    await page.mouse.click(195, 20); await page.waitForTimeout(700); };
  const hide = async () => { for (let i = 0; i < 3 && !(await immersive()); i++) { await page.mouse.click(195, 400); await page.waitForTimeout(600); } };
  const progress = () => page.evaluate(async () => (await db.progress.toArray())[0] || null);
  const closeBook = async () => { if (await immersive()) await reveal(); await page.click('#backBtn'); await page.waitForTimeout(300); };

  // fixtures: language + dictionary (inserted directly), a long text book, a PDF, an EPUB
  await page.evaluate(async () => {
    await addLanguage({ code: 'en', extTrans: { preset: 'yandex-web' }, extDict: { preset: 'wiktionary' } });
    await db.dictEntries.bulkPut(DictCore.buildRows('en', [{ w: 'dog', t: 'dɒɡ', d: 'Hund' }]));
    await db.dictionaries.put({ langCode: 'en', name: 't', format: 'tsv', count: 1, importedAt: Date.now() });
  });
  require('fs').writeFileSync('/tmp/long.txt', long);

  console.log('Text book: auto-hide bars, position, zoom, known-word tap');
  await page.setInputFiles('#fileInput', '/tmp/long.txt');
  await page.waitForSelector('.tile .cover'); await page.click('.tile .cover');
  await page.waitForSelector('#textWrap .content p'); await page.waitForTimeout(600);
  t('bars are hidden while reading (top bar + tab bar off-screen)', await immersive() && await page.evaluate(() => document.querySelector('.rtb').getBoundingClientRect().bottom <= 0 && document.querySelector('.bnav').getBoundingClientRect().top >= innerHeight));
  await page.mouse.click(195, 400); await page.waitForTimeout(700);
  t('tapping the middle does NOT show the bars', await immersive());
  await page.mouse.click(195, 765); await page.waitForTimeout(700);
  t('tapping the bottom edge shows the bars', !(await immersive()) && await page.evaluate(() => document.querySelector('.bnav').getBoundingClientRect().top < innerHeight));
  await hide();
  await page.mouse.click(195, 15); await page.waitForTimeout(700);
  t('tapping the top edge shows the bars', !(await immersive()));
  t('no qbarHandle in the reader', (await page.$$('#qbarHandle')).length === 0);
  await hide();

  // exact position: scroll to the middle of paragraph 20, close, reopen
  await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[20]; w.scrollTop = p.offsetTop + p.offsetHeight * 0.5; });
  await page.waitForTimeout(700);
  const pr1 = await progress();
  t('position saved with paragraph anchor (tp=20, tf≈0.5)', pr1 && pr1.tp === 20 && pr1.tf > 0.3 && pr1.tf < 0.6, pr1);
  const st1 = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  await closeBook();
  await page.click('.nb[data-tab="library"]'); await page.click('.tile .cover'); await page.waitForSelector('#textWrap .content p'); await page.waitForTimeout(900);
  const st2 = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  t('reopening resumes at the exact spot (' + Math.round(st1) + ' → ' + Math.round(st2) + 'px)', Math.abs(st1 - st2) < 3, [st1, st2]);
  // position survives zoom (reflow)
  await page.evaluate(() => Display.set({ bookZoom: 1.6 }, { persist: true })); await page.waitForTimeout(600);
  const after = await page.evaluate(() => { const w = document.getElementById('textWrap'), ps = [...w.querySelectorAll('.content p')]; let i = 0; while (i < ps.length - 1 && ps[i + 1].offsetTop <= w.scrollTop) i++; return i; });
  t('zoom keeps the same paragraph at the top (anchor)', after === 20, after);
  await page.evaluate(() => Display.set({ bookZoom: 1 }, { persist: true })); await page.waitForTimeout(500);

  // single tap on a known word
  await page.evaluate(async () => { await addWord({ foreign: 'dog', translation: 'Hund', context: 'the dog', langCode: 'en', bookId: (await db.books.toArray())[0].id }); });
  
  await closeBook(); await page.click('.nb[data-tab="library"]'); await page.click('.tile .cover');
  await page.waitForSelector('#textWrap .rt-vocab'); await page.waitForTimeout(900);
  await page.evaluate(() => { const w = document.getElementById('textWrap'), m = w.querySelectorAll('.rt-vocab')[3] || w.querySelector('.rt-vocab'); w.scrollTop = m.offsetTop - 300; });
  await page.waitForTimeout(700);
  const xy = await page.evaluate(() => { const r = [...document.querySelectorAll('#textWrap .rt-vocab')].map(e => e.getBoundingClientRect()).find(r => r.top > 150 && r.bottom < 600); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(xy.x, xy.y);
  await page.waitForSelector('#selPopup:not([hidden])', { timeout: 3000 }).catch(() => {});
  t('ONE tap on a saved word opens the action menu', await page.isVisible('#selPopup'));
  // native language guard + per-book language
  await reveal(); await page.click('#qbarBtn');
  t('book language selector in the display bar (default en)', (await page.inputValue('#bookLang')) === 'en');
  await hide();
  const xy2 = await page.evaluate(() => { const r = [...document.querySelectorAll('#textWrap .rt-vocab')].map(e => e.getBoundingClientRect()).find(r => r.top > 150 && r.bottom < 600); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(xy2.x, xy2.y); await page.waitForSelector('#selPopup:not([hidden])');
  await page.click('#selPopup [data-action="translator"]');
  await page.waitForSelector('.toast');
  t('English → English is refused with an explanation', /English/.test(await page.textContent('.toast')) && /Native language|native language/.test(await page.textContent('.toast')), await page.textContent('.toast'));
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach(x => x.remove()); });
  await reveal(); await page.click('.nb[data-tab="settings"]');
  await page.selectOption('#setNative', 'ru'); await page.click('.nb[data-tab="read"]'); await page.waitForTimeout(300); await hide();
  const xy3 = await page.evaluate(() => { const r = [...document.querySelectorAll('#textWrap .rt-vocab')].map(e => e.getBoundingClientRect()).find(r => r.top > 150 && r.bottom < 600); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(xy3.x, xy3.y); await page.waitForSelector('#selPopup:not([hidden])');
  await page.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });
  await page.click('#selPopup [data-action="translator"]'); await page.waitForTimeout(400);
  const purl = (await page.evaluate(() => window.__opened))[0] || '';
  t('translator opens with source=book language, target=native language', /source_lang=en&target_lang=ru/.test(purl) && /text=dog/.test(purl), purl);
  // switch this book to German → no dictionary there
  await reveal(); await page.click('#qbarBtn'); await page.selectOption('#bookLang', 'de'); await hide();
  const bl = await page.evaluate(async () => (await db.books.toArray())[0].langCode);
  t('book language is stored per book', bl === 'de', bl);
  await page.mouse.click(xy3.x, xy3.y); await page.waitForSelector('#selPopup:not([hidden])');
  await page.click('#selPopup [data-action="internal"]'); await page.waitForSelector('#dictSheet:not([hidden])'); await page.waitForTimeout(400);
  t('dictionary follows the book language (de has none)', /No dictionary|Not found|not found/i.test(await page.textContent('#dsBody')), await page.textContent('#dsBody'));
  // sheet scrolls
  await page.evaluate(() => { const b = document.getElementById('dsBody'); b.textContent = ''; for (let i = 0; i < 60; i++) { const d = document.createElement('div'); d.className = 'ds-def'; d.textContent = 'Line ' + i + ' a very long translation text that wraps around several times on a narrow phone screen'; b.appendChild(d); } });
  const sc = await page.evaluate(() => { const b = document.getElementById('dsBody'), p = document.getElementById('dsPanel'); b.scrollTop = 99999; return { sh: b.scrollHeight, ch: b.clientHeight, st: b.scrollTop, panel: p.getBoundingClientRect().height, vh: innerHeight, add: document.getElementById('dsAdd').getBoundingClientRect().bottom <= innerHeight }; });
  t('definition popup scrolls vertically and stays inside the screen', sc.sh > sc.ch && sc.st > 100 && sc.panel <= sc.vh * 0.71 && sc.add, sc);
  await page.click('#dsClose');
  await page.selectOption('#bookLang', 'en').catch(() => {});

  console.log('Flashcard scrolling');
  await page.evaluate(async () => { await addWord({ foreign: 'novel', translation: 'Roman '.repeat(120), context: 'An extremely long example sentence. '.repeat(60), sentenceTranslation: 'Ein sehr langer Satz. '.repeat(40), langCode: 'en' }); });
  await reveal(); await page.click('.nb[data-tab="quiz"]'); await page.waitForTimeout(500);
  await page.evaluate(() => { document.querySelectorAll('#wordsBox input[type=checkbox], #wordList input[type=checkbox]').forEach(c => { if (!c.checked) c.click(); }); });
  await page.click('#startQuizBtn'); await page.waitForSelector('#fcCard');
  let guard = 0; while (guard++ < 5) { const txt = await page.textContent('#fcFace'); if (/novel/.test(txt)) break; await page.click('#fcCard'); await page.click('#fcActions .easy'); await page.waitForTimeout(100); }
  await page.click('#fcCard'); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/shots/21-card-long.png' });
  const fc = await page.evaluate(() => { const c = document.getElementById('fcCard'), r = c.getBoundingClientRect(); const ov = getComputedStyle(c).overflowY; c.scrollTop = 99999; const last = c.querySelector('.fc-field:last-of-type, .fc-face > :last-child'); const lr = last.getBoundingClientRect(); return { sh: c.scrollHeight, ch: c.clientHeight, ov, cardBottom: r.bottom, vh: innerHeight, lastInside: lr.bottom <= r.bottom + 1, top0: (c.scrollTop = 0, c.querySelector('.fc-face').getBoundingClientRect().top >= r.top - 1), btn: document.getElementById('fcActions').getBoundingClientRect().bottom <= innerHeight }; });
  t('training card scrolls: content taller than card is reachable (top and bottom)', fc.sh > fc.ch && fc.ov === 'auto' && fc.lastInside && fc.top0, fc);
  t('rating buttons stay on screen under a tall card', fc.btn, fc);

  console.log('PDF');
  await page.evaluate(() => { document.getElementById('quizSession').hidden = true; });
  await page.reload(); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(600);
  await page.setInputFiles('#fileInput', FX('test.pdf'));
  await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 2, null, { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('.tile')].find(x => /test/i.test(x.textContent)).querySelector('.cover').click(); });
  await page.waitForSelector('#pdfWrap .pdf-inner canvas', { timeout: 15000 }); await page.waitForTimeout(500);
  const w1 = await page.evaluate(() => document.querySelector('#pdfWrap .pdf-inner > *').getBoundingClientRect().width);
  await page.evaluate(() => Display.set({ bookZoom: 1.237 }, { live: true }));
  const live = await page.evaluate(() => ({ tr: document.querySelector('#pdfWrap .pdf-inner').style.transform, z: Display.get().bookZoom }));
  t('zoom is continuous (1.237 → 1.24, not snapped to 5% steps)', live.z === 1.24, live);
  t('live zoom is an instant GPU scale preview (no re-render yet)', /scale\(1\.24/.test(live.tr), live);
  await page.waitForTimeout(900);
  const done = await page.evaluate(() => ({ tr: document.querySelector('#pdfWrap .pdf-inner').style.transform, w: document.querySelector('#pdfWrap .pdf-inner > *').getBoundingClientRect().width }));
  t('after the gesture the pages are re-rendered sharply at the final size', done.tr === '' && Math.abs(done.w - w1 * 1.24) < 3, [w1, done]);
  await page.evaluate(() => Display.set({ bookZoom: 2 }, { persist: true })); await page.waitForTimeout(800);
  await page.evaluate(() => { const w = document.getElementById('pdfWrap'); w.scrollLeft = 200; w.scrollTop = 300; });
  await page.mouse.move(250, 400); await page.mouse.down(); await page.mouse.move(180, 330, { steps: 6 }); await page.mouse.up();
  const pan = await page.evaluate(() => { const w = document.getElementById('pdfWrap'); return { l: w.scrollLeft, t: w.scrollTop }; });
  t('holding the left mouse button and dragging pans the page (←70 ↑70)', Math.abs(pan.l - 270) < 12 && Math.abs(pan.t - 370) < 12, pan);
  await page.evaluate(() => Display.set({ bookLocked: true }, { force: true }));
  await page.mouse.move(250, 400); await page.mouse.down(); await page.mouse.move(150, 400, { steps: 6 }); await page.mouse.up();
  t('locked view: horizontal drag does not move the page', (await page.evaluate(() => document.getElementById('pdfWrap').scrollLeft)) === Math.round(pan.l) || Math.abs((await page.evaluate(() => document.getElementById('pdfWrap').scrollLeft)) - pan.l) < 2);
  await page.evaluate(() => Display.set({ bookLocked: false }, { force: true }));
  await page.evaluate(() => Display.set({ bookZoom: 1 }, { persist: true })); await page.waitForTimeout(800);
  await page.evaluate(() => { const w = document.getElementById('pdfWrap'), b = w.querySelectorAll('.pdf-inner > *')[1]; w.scrollTop = b.offsetTop + b.offsetHeight * 0.4 - w.clientHeight * 0.3; });
  await page.waitForTimeout(700);
  const ppr = (await page.evaluate(async () => (await db.progress.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0]));
  t('PDF position saved (page 2, fraction ≈ 0.4)', ppr && ppr.location === 2 && Math.abs(ppr.frac - 0.4) < 0.05, ppr);
  const pst1 = await page.evaluate(() => document.getElementById('pdfWrap').scrollTop);
  await closeBook(); await page.click('.nb[data-tab="library"]');
  await page.evaluate(() => { [...document.querySelectorAll('.tile')].find(x => /test/i.test(x.textContent)).querySelector('.cover').click(); });
  await page.waitForSelector('#pdfWrap .pdf-inner canvas'); await page.waitForTimeout(800);
  const pst2 = await page.evaluate(() => document.getElementById('pdfWrap').scrollTop);
  t('PDF resumes at the same spot (' + Math.round(pst1) + ' → ' + Math.round(pst2) + ')', Math.abs(pst1 - pst2) < 3, [pst1, pst2]);
  await closeBook();

  console.log('EPUB');
  await page.click('.nb[data-tab="library"]');
  await page.setInputFiles('#fileInput', FX('test.epub'));
  await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 3, null, { timeout: 10000 });
  await page.evaluate(() => { [...document.querySelectorAll('.tile')].find(x => /Test Epub|test/i.test(x.textContent) && !/pdf/i.test(x.textContent) && !/long/i.test(x.textContent)).querySelector('.cover').click(); });
  await page.waitForSelector('#epubWrap iframe', { timeout: 15000 }); await page.waitForTimeout(1500);
  const es = () => page.evaluate(() => { const c = document.querySelector('#epubWrap .epub-container'); return c ? c.scrollTop : -1; });
  await page.evaluate(() => { document.querySelector('#epubWrap .epub-container').scrollTop = 700; });
  await page.waitForTimeout(1200);
  const e1 = await es(); const ep = await page.evaluate(async () => (await db.progress.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  t('EPUB position saved as a CFI', ep && /^epubcfi\(/.test(ep.cfi), ep);
  await closeBook(); await page.click('.nb[data-tab="library"]');
  await page.evaluate(() => { [...document.querySelectorAll('.tile')].find(x => /Test Epub|test/i.test(x.textContent) && !/pdf/i.test(x.textContent) && !/long/i.test(x.textContent)).querySelector('.cover').click(); });
  await page.waitForSelector('#epubWrap iframe', { timeout: 15000 }); await page.waitForTimeout(1800);
  const e2 = await es();
  t('EPUB resumes near the same spot (' + Math.round(e1) + ' → ' + Math.round(e2) + 'px, within a line)', e1 > 300 && Math.abs(e1 - e2) < 45, [e1, e2]);
  await page.evaluate(() => Display.set({ bookZoom: 1.3 }, { live: true }));
  t('EPUB live zoom = transform preview', /scale\(1\.3/.test(await page.evaluate(() => document.getElementById('epubWrap').style.transform)));
  await page.waitForTimeout(900);
  t('EPUB zoom committed as real font size', (await page.evaluate(() => getComputedStyle(document.querySelector('#epubWrap iframe').contentDocument.body).fontSize)) === '23.4px' && (await page.evaluate(() => document.getElementById('epubWrap').style.transform)) === '');

  console.log('Offline status in Settings');
  await closeBook(); await page.click('.nb[data-tab="settings"]'); await page.waitForTimeout(1500);
  const off = await page.textContent('#offlineStatus');
  t('offline status shows Ready with file counts (' + off + ')', /Ready ✓ \(\d+\/\d+ files\)/.test(off), off);

  console.log('\nerrors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
