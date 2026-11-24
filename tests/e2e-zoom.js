const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const BASE = 'http://localhost:8765/', FX = p => path.join(__dirname, 'fixtures', p);
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(500);
  const immersive = () => page.evaluate(() => document.body.classList.contains('reader-immersive'));
  const tab = async n => { if (await immersive()) { await page.mouse.click(195, 765); await page.waitForTimeout(700); } await page.click(`.nb[data-tab="${n}"]`); };
  const open = async (file, re, sel) => {
    await tab('library'); await page.setInputFiles('#fileInput', FX(file));
    await page.waitForFunction(() => document.querySelectorAll('.tile').length >= 1);
    await page.waitForTimeout(500);
    await page.evaluate(n => { const x = [...document.querySelectorAll('.tile')].filter(e => new RegExp(n, 'i').test(e.textContent)); (x[0]).querySelector('.cover').click(); }, re);
    await page.waitForSelector(sel, { timeout: 15000 }); await page.waitForTimeout(1200);
  };

  console.log('PDF: smooth, centred zoom');
  await open('test.pdf', 'test', '#pdfWrap .pdf-inner canvas');
  // park the 2nd page's middle in the centre of the screen
  await page.evaluate(() => { const w = document.getElementById('pdfWrap'), b = w.querySelectorAll('.pdf-inner > *')[1]; w.scrollTop = b.offsetTop + b.offsetHeight * 0.5 - w.clientHeight / 2; });
  await page.waitForTimeout(600);
  const center = () => page.evaluate(() => { const w = document.getElementById('pdfWrap'), inners = [...w.querySelectorAll('.pdf-inner')], inn = inners.find(i => i.style.visibility !== 'hidden'), y = w.scrollTop + w.clientHeight / 2; const bx = [...inn.children]; let i = 0; while (i < bx.length - 1 && bx[i].offsetTop + bx[i].offsetHeight + 12 <= y) i++; return { page: i + 1, frac: (y - bx[i].offsetTop) / bx[i].offsetHeight, w: bx[i].getBoundingClientRect().width }; });
  const c0 = await center();
  // frame sampler: the VISIBLE layer must always contain drawn pages (a blank frame = white flash)
  await page.evaluate(() => {
    window.__frames = []; const w = document.getElementById('pdfWrap');
    (function loop() {
      const vis = [...w.querySelectorAll('.pdf-inner')].filter(i => i.style.visibility !== 'hidden');
      const inn = vis[0];
      const onScreen = inn ? [...inn.children].filter(b => { const r = b.getBoundingClientRect(); return r.bottom > 60 && r.top < innerHeight - 60; }) : [];
      window.__frames.push({ layers: vis.length, onScreen: onScreen.length, drawn: onScreen.filter(b => b.querySelector('canvas')).length });
      if (!window.__stop) requestAnimationFrame(loop);
    })();
  });
  // a slider drag: many 'input' events, then 'change'
  await page.click('#bmBtn', { trial: true }).catch(() => {});
  await page.mouse.click(195, 20); await page.waitForTimeout(600); await page.click('#qbarBtn');
  for (let i = 0; i <= 40; i++) {
    await page.evaluate(i => { const r = document.querySelector('#qbarPanel [data-disp=bookZoom]'); r.value = 1 + i * 0.02; r.dispatchEvent(new Event('input', { bubbles: true })); }, i);
    await page.waitForTimeout(16);
  }
  const mid = await page.evaluate(() => ({ tr: document.querySelector('#pdfWrap .pdf-inner').style.transform, z: Display.get().bookZoom }));
  t('during the drag the pages follow instantly (GPU scale, zoom 1.8 → ' + mid.tr + ')', /scale\(1\.8/.test(mid.tr) && mid.z === 1.8, mid);
  await page.evaluate(() => { const r = document.querySelector('#qbarPanel [data-disp=bookZoom]'); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__stop = true; });
  const frames = await page.evaluate(() => window.__frames);
  const blank = frames.filter(f => f.layers < 1 || f.onScreen === 0 || f.drawn === 0);
  t('NO blank / white frame at any time (' + frames.length + ' frames sampled)', blank.length === 0, { blank: blank.length, sample: blank.slice(0, 3) });
  const c1 = await center();
  t('same point stays in the centre after zoom (page ' + c0.page + ' @' + c0.frac.toFixed(2) + ' → page ' + c1.page + ' @' + c1.frac.toFixed(2) + ')', c1.page === c0.page && Math.abs(c1.frac - c0.frac) < 0.02, [c0, c1]);
  t('pages are really re-rendered at the new size (' + Math.round(c0.w) + ' → ' + Math.round(c1.w) + 'px)', Math.abs(c1.w / c0.w - 1.8) < 0.03, [c0.w, c1.w]);
  const st = await page.evaluate(() => ({ layers: document.querySelectorAll('#pdfWrap .pdf-inner').length, tr: document.querySelector('#pdfWrap .pdf-inner').style.transform, sw: document.getElementById('pdfWrap').scrollWidth, cw: document.getElementById('pdfWrap').clientWidth }));
  t('only one page layer remains, no leftover transform, zoomed page is pannable', st.layers === 1 && st.tr === '' && st.sw > st.cw, st);
  await page.screenshot({ path: '/tmp/shots/30-pdf-zoomed.png' });
  // zoom back out quickly several times: only the last one wins, nothing breaks
  for (const z of [1.2, 0.8, 1.5, 1]) { await page.evaluate(z => Display.set({ bookZoom: z }, { live: true }), z); await page.waitForTimeout(40); }
  await page.evaluate(() => Display.set({ bookZoom: 1 }, { persist: true })); await page.waitForTimeout(1500);
  const c2 = await center();
  t('rapid zoom changes settle on the last value, centre kept', Math.abs(c2.w / c0.w - 1) < 0.03 && c2.page === c0.page && Math.abs(c2.frac - c0.frac) < 0.03, [c0, c2]);
  await page.mouse.click(195, 400); await page.waitForTimeout(500);

  console.log('PDF: leaving the Read tab');
  await page.evaluate(() => { const w = document.getElementById('pdfWrap'); w.scrollTop = 700; }); await page.waitForTimeout(800);
  const p1 = await page.evaluate(() => document.getElementById('pdfWrap').scrollTop);
  await tab('library'); await page.waitForTimeout(700); await tab('read'); await page.waitForTimeout(1500);
  const p2 = await page.evaluate(() => document.getElementById('pdfWrap').scrollTop);
  const pg = await page.evaluate(async () => (await db.progress.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  t('PDF position identical after main menu → back (' + Math.round(p1) + ' → ' + Math.round(p2) + ')', Math.abs(p1 - p2) < 4, [p1, p2]);
  t('saved PDF position is sane (not reset by the hidden tab)', pg.location >= 1 && pg.percentage > 0.15, pg);

  console.log('EPUB');
  await page.mouse.click(195, 765); await page.waitForTimeout(700);
  await open('test.epub', 'Test Epub|test', '#epubWrap iframe');
  const es = () => page.evaluate(() => { const c = document.querySelector('#epubWrap .epub-container'); return c ? c.scrollTop : -1; });
  await page.evaluate(() => { document.querySelector('#epubWrap .epub-container').scrollTop = 900; }); await page.waitForTimeout(1300);
  const e1 = await es();
  await tab('library'); await page.waitForTimeout(700); await tab('read'); await page.waitForTimeout(2000);
  const e2 = await es();
  t('EPUB position kept after main menu → back (' + Math.round(e1) + ' → ' + Math.round(e2) + ', within a line)', e1 > 300 && Math.abs(e1 - e2) < 50, [e1, e2]);
  const f0 = await page.evaluate(() => getComputedStyle(document.querySelector('#epubWrap iframe').contentDocument.body).fontSize);
  await page.evaluate(() => Display.set({ bookZoom: 1.5 }, { live: true }));
  await page.evaluate(() => Display.set({ bookZoom: 1.5 }, { persist: true })); await page.waitForTimeout(2000);
  const f1 = await page.evaluate(() => getComputedStyle(document.querySelector('#epubWrap iframe').contentDocument.body).fontSize);
  t('EPUB zoom applied as real font size (' + f0 + ' → ' + f1 + ')', Math.abs(parseFloat(f1) / parseFloat(f0) - 1.5) < 0.05, [f0, f1]);
  const cfiBefore = await page.evaluate(() => Reader.snapshot().cfi);
  await page.evaluate(() => Display.set({ bookZoom: 1 }, { persist: true })); await page.waitForTimeout(2200);
  const cfiAfter = await page.evaluate(() => Reader.snapshot().cfi);
  const para = c => (c.match(/\/4\/(\d+)/) || [])[1];
  t('EPUB zoom keeps the same paragraph at the top (' + cfiBefore + ' → ' + cfiAfter + ')', para(cfiBefore) && Math.abs(Number(para(cfiBefore)) - Number(para(cfiAfter))) <= 2, [cfiBefore, cfiAfter]);

  console.log('\nerrors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
