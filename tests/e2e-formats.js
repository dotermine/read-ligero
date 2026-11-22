const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8765/', FX = p => path.join(__dirname, 'fixtures', p);
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(400);
  const zoom = async z => { await page.evaluate(v => Display.set({ bookZoom: v }, { persist: true }), z); await page.waitForTimeout(700); };

  console.log('PDF');
  await page.setInputFiles('#fileInput', FX('test.pdf'));
  await page.waitForSelector('.tile', { timeout: 10000 });
  await page.click('.tile .cover');
  await page.waitForSelector('#pdfWrap .pdf-inner canvas', { timeout: 15000 });
  const w1 = await page.evaluate(() => document.querySelector('#pdfWrap .pdf-page, #pdfWrap .pdf-inner > *').getBoundingClientRect().width);
  t('PDF renders pages inside .pdf-inner (3 pages)', (await page.$$eval('#pdfWrap .pdf-inner > *', e => e.length)) === 3);
  await zoom(2);
  await page.waitForSelector('#pdfWrap .pdf-inner canvas');
  const r = await page.evaluate(() => { const w = document.getElementById('pdfWrap'), p = w.querySelector('.pdf-inner > *'); return { pw: p.getBoundingClientRect().width, sw: w.scrollWidth, cw: w.clientWidth, nav: document.querySelector('.bnav').getBoundingClientRect().height }; });
  t('PDF zoom 200% doubles page width (' + Math.round(w1) + '→' + Math.round(r.pw) + ')', Math.abs(r.pw - 2 * w1) < 4, r);
  t('zoomed PDF scrolls horizontally inside the book area; tab bar unchanged', r.sw > r.cw && r.nav === 64, r);
  await page.evaluate(() => Display.set({ bookLocked: true }, { force: true }));
  t('locked PDF: horizontal panning disabled (overflow-x hidden)', (await page.evaluate(() => getComputedStyle(document.getElementById('pdfWrap')).overflowX)) === 'hidden');
  await page.evaluate(() => Display.set({ bookLocked: false }, { force: true }));
  await page.evaluate(() => Display.set({ bookOffset: 25 }, { persist: true })); await page.waitForTimeout(600);
  t('PDF horizontal offset narrows the stage (left margin 25%)', (await page.evaluate(() => Math.round(document.getElementById('bookStage').getBoundingClientRect().left))) === 98);
  await page.evaluate(() => Display.set({ bookZoom: 1, bookOffset: 0 }, { persist: true })); await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/shots/10-pdf.png' });
  await page.click('#backBtn'); await page.waitForTimeout(300);

  console.log('EPUB');
  await page.click('.nb[data-tab="library"]');
  await page.setInputFiles('#fileInput', FX('test.epub'));
  await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 2, null, { timeout: 10000 });
  await page.evaluate(() => { const tiles = [...document.querySelectorAll('.tile')]; const e = tiles.find(x => /test/i.test(x.textContent) && !/pdf/i.test(x.textContent)); (e || tiles[0]).querySelector('.cover').click(); });
  await page.waitForSelector('#epubWrap iframe', { timeout: 15000 });
  const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url().startsWith('blob:') || (f !== page.mainFrame() && f.url() === 'about:srcdoc'));
  await page.waitForTimeout(1200);
  const fsz = async () => page.evaluate(() => { const f = document.querySelector('#epubWrap iframe'); const d = f.contentDocument; return d && d.body ? getComputedStyle(d.body).fontSize : null; });
  const f1 = await fsz();
  t('EPUB renders in iframe (font ' + f1 + ')', !!f1, f1);
  await zoom(1.5);
  const f2 = await fsz();
  t('EPUB zoom 150% scales the book font (' + f1 + '→' + f2 + ')', f1 && Math.abs(parseFloat(f2) - parseFloat(f1) * 1.5) < 0.6, [f1, f2]);
  t('EPUB: UI chrome unchanged', (await page.evaluate(() => document.querySelector('.bnav').getBoundingClientRect().height)) === 64);
  await page.evaluate(() => Display.set({ bookOffset: -20 }, { persist: true })); await page.waitForTimeout(700);
  const iw = await page.evaluate(() => Math.round(document.querySelector('#epubWrap iframe').getBoundingClientRect().width));
  t('EPUB re-lays out when the stage narrows (iframe width ' + iw + ')', iw > 0 && iw < 390, iw);
  // gloss CSS reaches the iframe
  const hasCss = await page.evaluate(() => !!document.querySelector('#epubWrap iframe').contentDocument.getElementById('rl-frame-css'));
  t('EPUB frame has the mark/gloss stylesheet', hasCss);
  await page.screenshot({ path: '/tmp/shots/11-epub.png' });

  console.log('Orientation fallback (no Screen Orientation API)');
  await page.evaluate(() => { Object.defineProperty(screen, 'orientation', { value: undefined, configurable: true }); });
  await page.evaluate(() => Display.set({ orientation: 90 }, { persist: true })); await page.waitForTimeout(500);
  t('CSS rotation applied when lock() is unavailable', (await page.evaluate(() => document.documentElement.getAttribute('data-css-rotate'))) !== null);
  await page.evaluate(() => Display.set({ orientation: 'auto' }, { persist: true }));
  t('Auto removes the rotation', (await page.evaluate(() => document.documentElement.getAttribute('data-css-rotate'))) === null);

  console.log('Fullscreen');
  await page.evaluate(() => Display.set({ screenMode: 'fullscreen' }));
  await page.waitForTimeout(500);
  const fs = await page.evaluate(() => ({ native: !!document.fullscreenElement, pseudo: document.documentElement.classList.contains('pseudo-fs'), mode: Display.get().screenMode }));
  t('fullscreen: native API or pseudo fallback active', fs.native || fs.pseudo, fs);
  await page.evaluate(() => Display.set({ screenMode: 'windowed' })); await page.waitForTimeout(300);
  t('windowed restores', !(await page.evaluate(() => !!document.fullscreenElement || document.documentElement.classList.contains('pseudo-fs'))));

  console.log('\nerrors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
