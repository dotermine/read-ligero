const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const BASE = 'http://localhost:8765/', FX = p => path.join(__dirname, 'fixtures', p);
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
const long = Array.from({ length: 40 }, (_, i) => 'Paragraph ' + i + ' the dog sat on the house and then it kept on talking about the street for quite a long time indeed.').join('\n\n');
fs.writeFileSync('/tmp/long.txt', long);
fs.writeFileSync('/tmp/cjk.txt', '我喜欢学习中文。今天天气很好。\n\n私は日本語を勉強しています。明日は雨です。\n\n' + 'Filler paragraph. '.repeat(5));

async function boot(ctxOpts, setup) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 780 } }, ctxOpts || {}));
  if (setup) await ctx.addInitScript(setup);
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(600);
  const H = {
    immersive: () => page.evaluate(() => document.body.classList.contains('reader-immersive')),
    reveal: async () => { if (await page.isVisible('#selPopup')) { await page.evaluate(() => Reader.clearSelection()); await page.waitForTimeout(200); } if (await H.immersive()) { await page.mouse.click(195, 20); await page.waitForTimeout(700); } },
    hide: async () => { for (let i = 0; i < 3 && !(await H.immersive()); i++) { await page.mouse.click(195, 400); await page.waitForTimeout(600); } },
    tab: async n => { if (await H.immersive()) { await page.mouse.click(195, 765); await page.waitForTimeout(700); } await page.click(`.nb[data-tab="${n}"]`); },
    openBook: async (file, sel) => { await H.tab('library'); await page.setInputFiles('#fileInput', file); await page.waitForTimeout(600); await page.evaluate(() => document.querySelector('.tile .cover').click()); await page.waitForSelector(sel, { timeout: 15000 }); await page.waitForTimeout(900); },
    pick: async (id, v) => { await page.click(`.cs-btn[data-cs-for="${id}"]`); await page.click(`.cs-pop [data-value="${v}"]`); }
  };
  return { browser, ctx, page, errors, H };
}

(async () => {
  let { browser, ctx, page, errors, H } = await boot({ hasTouch: true });

  // ===================== Settings: highlight toggles, z-index in modal =====================
  console.log('Settings');
  await H.tab('settings');
  t('two separate highlight switches exist (vocabulary / looked-up) + the gloss switch', await page.evaluate(() => ['hlVocab', 'hlLook', 'glossOn'].every(k => document.querySelector(`[data-switch="${k}"]`))));
  t('system section has wake-lock, keep-alive, floating-window and immersive switches', await page.evaluate(() => ['keepAwake', 'keepAlive', 'floatApps', 'immersiveInstall'].every(k => document.querySelector(`[data-switch="${k}"]`))));
  await page.click('#addLanguageBtn'); await page.waitForSelector('#langModal:not([hidden])');
  for (const id of ['lExtDictSel', 'lExtTransSel']) {
    await page.click(`.cs-btn[data-cs-for="${id}"]`); await page.waitForSelector('.cs-pop');
    const top = await page.evaluate(() => { const r = document.querySelector('.cs-pop').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(40, r.height / 2)); return { inPop: !!(e && e.closest('.cs-pop')), h: r.height, z: getComputedStyle(document.querySelector('.cs-pop')).zIndex }; });
    t(`${id}: dropdown renders ABOVE the modal and is fully usable (z-index ${top.z})`, top.inPop && top.h > 100, top);
    await page.click('.cs-pop .cs-opt:nth-child(3)'); await page.waitForTimeout(100);
  }
  await page.click('#langModal .btn:not(.accent)').catch(() => {}); await page.evaluate(() => window.__closeLangModal && window.__closeLangModal());

  // fixtures: English language + dictionary
  await page.evaluate(async () => {
    await addLanguage({ code: 'en', extTrans: { preset: 'google-app' }, extDict: { preset: 'goldendict' } });
    await db.dictEntries.bulkPut(DictCore.buildRows('en', [{ w: 'dog', t: 'dɒɡ', d: 'Hund' }]));
    await db.dictionaries.put({ langCode: 'en', name: 't', format: 'tsv', count: 1, importedAt: Date.now() });
    await setSetting('nativeLang', 'de');
  });

  // ===================== text book =====================
  console.log('Free selection with handles (touch)');
  await H.openBook('/tmp/long.txt', '#textWrap .content p'); await H.hide();
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const wordXY = (para, word, edge) => page.evaluate(([para, word, edge]) => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[para], tn = p.firstChild, i = tn.data.indexOf(word); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + word.length); const b = r.getBoundingClientRect(); return { x: edge === 'right' ? b.right - 1 : edge === 'left' ? b.left + 1 : b.left + b.width / 2, y: b.top + b.height / 2 }; }, [para, word, edge || 'mid']);
  await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2]; w.scrollTop = p.offsetTop - 300; });
  await page.waitForTimeout(500);
  const hs = () => page.evaluate(() => { const h = window.CSS && CSS.highlights && CSS.highlights.get('reader-sel'); return h ? [...h].map(r => r.toString()).join('') : ''; });
  const house = await wordXY(2, 'house');
  await touch('touchStart', house.x, house.y); await page.waitForTimeout(800); await touch('touchEnd');
  await page.waitForTimeout(400);
  t('long press selects the single word under the finger', (await hs()) === 'house', await hs());
  t('the action popup appears', await page.isVisible('#selPopup'));
  t('two selection handles appear', (await page.$$('.sel-handle')).length === 2);
  // drag the END handle to the right edge of "talking"
  const endH = await page.evaluate(() => { const r = document.querySelector('.sel-handle-end').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 24 }; });
  const talking = await wordXY(2, 'talking', 'right');
  await touch('touchStart', endH.x, endH.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', endH.x + (talking.x - endH.x) * i / 8, endH.y + (talking.y + 22 - endH.y) * i / 8);
  await touch('touchEnd'); await page.waitForTimeout(400);
  const s1 = await hs();
  t('dragging the end handle extends the selection letter by letter (“' + s1 + '”)', /^house and then it kept on talking/.test(s1), s1);
  t('popup returns after the drag', await page.isVisible('#selPopup'));
  const startH = await page.evaluate(() => { const r = document.querySelector('.sel-handle-start').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 24 }; });
  const sat = await wordXY(2, 'sat', 'left');
  await touch('touchStart', startH.x, startH.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', startH.x + (sat.x - startH.x) * i / 8, startH.y + (sat.y + 22 - startH.y) * i / 8);
  await touch('touchEnd'); await page.waitForTimeout(400);
  const s2 = await hs();
  t('dragging the start handle moves the other end (“' + s2.slice(0, 30) + '…”)', /^sat on the house/.test(s2) && /talking/.test(s2), s2);
  await page.evaluate(() => Reader.clearSelection());
  t('handles disappear with the selection', (await page.$$('.sel-handle')).length === 0);

  // ===================== highlight toggles =====================
  console.log('Highlight toggles');
  await page.evaluate(async () => { const b = (await db.books.toArray())[0]; await addWord({ foreign: 'dog', translation: 'Hund', context: 'the dog', langCode: 'en', bookId: b.id }); await addLookup(b.id, 'house'); });
  await H.reveal(); await H.tab('library'); await page.evaluate(() => document.querySelector('.tile .cover').click());
  await page.waitForSelector('#textWrap .rt-vocab'); await page.waitForTimeout(800);
  const bg = sel => page.evaluate(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : null; }, sel);
  t('both kinds of words are highlighted by default', (await bg('#textWrap .rt-vocab')) !== 'rgba(0, 0, 0, 0)' && (await bg('#textWrap .rt-look')) !== 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => document.querySelector('[data-switch="hlVocab"]').click());
  t('switch OFF "words added to vocabulary": only those lose their highlight', (await bg('#textWrap .rt-vocab')) === 'rgba(0, 0, 0, 0)' && (await bg('#textWrap .rt-look')) !== 'rgba(0, 0, 0, 0)');
  t('…and their translation above the word is a separate switch (still shown)', await page.evaluate(() => getComputedStyle(document.querySelector('#textWrap .rt-vocab'), '::before').display) !== 'none');
  await page.evaluate(() => { document.querySelector('[data-switch="hlVocab"]').click(); document.querySelector('[data-switch="hlLook"]').click(); });
  t('switch OFF "looked-up words": only those lose their highlight', (await bg('#textWrap .rt-look')) === 'rgba(0, 0, 0, 0)' && (await bg('#textWrap .rt-vocab')) !== 'rgba(0, 0, 0, 0)');
  t('switches are saved', await page.evaluate(async () => (await db.settings.get('hlLook')).value === false && (await db.settings.get('hlVocab')).value === true));
  await page.evaluate(() => document.querySelector('[data-switch="hlLook"]').click());

  // ===================== wake lock / keep alive / session restore =====================
  console.log('Wake lock, keep-alive, session restore');
  await page.evaluate(() => {
    window.__wl = { req: 0, rel: 0 };
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { window.__wl.req++; const l = new EventTarget(); l.release = () => { window.__wl.rel++; l.dispatchEvent(new Event('release')); return Promise.resolve(); }; return l; } } });
  });
  await page.evaluate(() => document.querySelector('[data-switch="keepAwake"]').click());   // off
  await page.evaluate(() => document.querySelector('[data-switch="keepAwake"]').click());   // on again → requested while reading
  await page.waitForTimeout(300);
  const wl1 = await page.evaluate(() => window.__wl);
  t('keep screen awake: wake lock requested while a book is open (' + JSON.stringify(wl1) + ')', wl1.req >= 1);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  const wl2 = await page.evaluate(() => window.__wl);
  t('…released in the background and requested again on return', wl2.rel >= 1 && wl2.req > wl1.req, wl2);
  await page.evaluate(() => document.querySelector('[data-switch="keepAwake"]').click());   // off
  await page.waitForTimeout(200);
  const wl3 = await page.evaluate(() => window.__wl);
  t('switch OFF releases the wake lock', wl3.rel > wl2.rel, wl3);
  await page.evaluate(() => document.querySelector('[data-switch="keepAlive"]').click());   // keep alive on
  await page.waitForTimeout(300);
  const held = () => page.evaluate(async () => (await navigator.locks.query()).held.some(l => l.name === 'readligero-keepalive'));
  t('keep-alive holds a Web Lock while a book is open', await held());
  await page.evaluate(() => document.querySelector('[data-switch="keepAlive"]').click());
  await page.waitForTimeout(300);
  t('…and releases it when switched off', !(await held()));
  await page.evaluate(() => document.querySelector('[data-switch="keepAlive"]').click());
  await page.evaluate(() => { document.getElementById('textWrap').scrollTop = 1800; }); await page.waitForTimeout(800);
  const st0 = await page.evaluate(() => document.getElementById('textWrap').scrollTop);
  await page.reload(); await page.waitForSelector('#textWrap .content p', { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => ({ open: !document.getElementById('readerRoot').hidden, st: (document.getElementById('textWrap') || {}).scrollTop }));
  t('app restarted by the system → the book is reopened at the saved position (' + Math.round(st0) + ' → ' + Math.round(restored.st) + ')', restored.open && Math.abs(restored.st - st0) < 5, restored);
  await H.reveal(); await page.click('#backBtn'); await page.waitForTimeout(300);
  await page.reload(); await page.waitForSelector('#booksGrid', { state: 'attached' }); await page.waitForTimeout(1200);
  t('a book closed on purpose is NOT reopened', await page.evaluate(() => document.getElementById('readerRoot').hidden));
  await page.evaluate(() => document.querySelector('[data-switch="keepAlive"]').click());

  // ===================== system bars =====================
  console.log('System bar colours');
  const mf = await page.evaluate(async () => ({ m: await (await fetch('manifest.json')).json(), f: await (await fetch('manifest-fullscreen.json')).json() }));
  t('manifest colours are neutral (not the amber icon colour)', mf.m.theme_color === '#ffffff' && mf.m.background_color === '#ffffff', [mf.m.theme_color, mf.m.background_color]);
  t('optional fullscreen manifest (no browser banner)', mf.f.display === 'fullscreen' && mf.f.display_override[0] === 'fullscreen');
  for (const th of ['light', 'dark', 'sepia', 'amoled']) {
    await H.tab('settings'); await page.click(`.chip[data-theme="${th}"]`); await page.waitForTimeout(150);
    const r = await page.evaluate(() => { const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); return { bg, metas: [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.getAttribute('content')) }; });
    t(`theme ${th}: system bars use the page colour (${r.bg})`, r.metas.length === 2 && r.metas.every(c => c === r.bg) && !/f59e0b/i.test(r.metas.join()), r);
  }
  await page.click('.chip[data-theme="light"]');
  await page.evaluate(() => document.querySelector('[data-switch="immersiveInstall"]').click());
  t('immersive install switch swaps the manifest link', (await page.getAttribute('#manifestLink', 'href')) === 'manifest-fullscreen.json');
  await page.evaluate(() => document.querySelector('[data-switch="immersiveInstall"]').click());

  // ===================== floating windows =====================
  console.log('External apps');
  await page.evaluate(() => document.querySelector('[data-switch="floatApps"]').click());
  const fl = await page.evaluate(() => ExtLinks.build('dict', { preset: 'goldendict' }, { word: 'dog', from: 'en', to: 'de', platform: 'android' }).url);
  t('floating-window setting adds the adjacent/new-task launch flags to Android intents', /launchFlags=0x10001000/.test(fl), fl);
  await page.evaluate(() => document.querySelector('[data-switch="floatApps"]').click());
  t('…and removes them when off', !/launchFlags/.test(await page.evaluate(() => ExtLinks.build('dict', { preset: 'goldendict' }, { word: 'dog', from: 'en', to: 'de', platform: 'android' }).url)));
  await browser.close();

  // ---- Google Translate app on an Android device: the word goes through the share sheet ----
  ({ browser, ctx, page, errors: errors, H } = await boot({ hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36' }, () => { window.__shared = []; navigator.share = o => { window.__shared.push(o.text); return Promise.resolve(); }; }));
  await page.evaluate(async () => { await addLanguage({ code: 'en', extTrans: { preset: 'google-app' } }); });
  await H.tab('settings'); await H.pick('setNative', 'de');                       // native language chosen in the UI
  await H.openBook('/tmp/long.txt', '#textWrap .content p'); await H.hide();
  await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2]; w.scrollTop = p.offsetTop - 300; }); await page.waitForTimeout(500);
  const dog = await page.evaluate(() => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[2], tn = p.firstChild, i = tn.data.indexOf('dog'); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await page.mouse.dblclick(dog.x, dog.y); await page.waitForSelector('#selPopup:not([hidden])');
  await page.click('#selPopup [data-action="translator"]'); await page.waitForTimeout(400);
  t('Google Translate (app) on Android: the selected word is handed over via the share sheet', JSON.stringify(await page.evaluate(() => window.__shared)) === '["dog"]', await page.evaluate(() => window.__shared));
  await browser.close();

  // ===================== PDF: highlight alignment + horizontal persistence =====================
  ({ browser, ctx, page, errors, H } = await boot({ hasTouch: true, deviceScaleFactor: 2 }));
  console.log('PDF highlight alignment');
  await H.openBook(FX('test.pdf'), '#pdfWrap .pdf-inner canvas'); await page.waitForTimeout(800);
  const align = async tag => {
    await page.evaluate(() => { Reader.setMarks({ vocab: new Map([['dog', 'Hund']]), looked: new Set(['house']) }); Reader.refreshMarks(); });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const pg = document.querySelector('#pdfWrap .pdf-inner .pdf-page'), cv = pg.querySelector('canvas'), cr = cv.getBoundingClientRect(), dpr = cv.width / cr.width;
      const out = {};
      for (const [cls, word] of [['.rt-vocab', 'dog'], ['.rt-look', 'house']]) {
        const mk = pg.querySelector(cls); if (!mk) { out[word] = null; continue; }
        const mr = mk.getBoundingClientRect(), x0 = Math.max(0, Math.floor((mr.left - cr.left - 20) * dpr)), x1 = Math.min(cv.width, Math.ceil((mr.right - cr.left + 20) * dpr));
        const y0 = Math.max(0, Math.floor((mr.top - cr.top) * dpr)), y1 = Math.min(cv.height, Math.ceil((mr.bottom - cr.top) * dpr));
        const img = cv.getContext('2d').getImageData(x0, y0, x1 - x0, Math.max(1, y1 - y0)).data, w = x1 - x0, h = y1 - y0, cols = [];
        for (let x = 0; x < w; x++) { let ink = false; for (let y = 0; y < h && !ink; y++) { const i = (y * w + x) * 4; if (img[i] < 110 && img[i + 3] > 200) ink = true; } cols.push(ink); }
        // ink runs separated by gaps wider than a word space (≈ 0.2 em)
        const em = (mr.bottom - mr.top) * dpr, gap = em * 0.22, runs = []; let s = -1, last = -1;
        for (let x = 0; x < w; x++) { if (cols[x]) { if (s < 0) s = x; else if (x - last > gap) { runs.push([s, last]); s = x; } last = x; } }
        if (s >= 0) runs.push([s, last]);
        // the run that overlaps the mark most
        const ml = (mr.left - cr.left) * dpr - x0, mrr = (mr.right - cr.left) * dpr - x0;
        let best = null, bo = 0; for (const r of runs) { const o = Math.min(r[1], mrr) - Math.max(r[0], ml); if (o > bo) { bo = o; best = r; } }
        out[word] = best ? { dLeft: Math.abs((best[0] - ml) / dpr), dRight: Math.abs((best[1] - mrr) / dpr), px: Math.round(em / dpr) } : { none: true };
      }
      return out;
    });
  };
  let a1 = await align('zoom 1');
  t('saved word "dog": the highlight box sits on the glyphs (left/right off by ' + (a1.dog && a1.dog.dLeft.toFixed(1)) + '/' + (a1.dog && a1.dog.dRight.toFixed(1)) + ' px)', a1.dog && !a1.dog.none && a1.dog.dLeft < 3.5 && a1.dog.dRight < 3.5, a1);
  t('looked-up word "house": same', a1.house && !a1.house.none && a1.house.dLeft < 3.5 && a1.house.dRight < 3.5, a1);
  await page.evaluate(() => Display.set({ bookZoom: 1.8 }, { persist: true })); await page.waitForTimeout(1800);
  const a2 = await align('zoom 1.8');
  t('still aligned after zoom 180% (off by ' + (a2.dog && a2.dog.dLeft.toFixed(1)) + '/' + (a2.dog && a2.dog.dRight.toFixed(1)) + ' px)', a2.dog && !a2.dog.none && a2.dog.dLeft < 4.5 && a2.dog.dRight < 4.5, a2);

  console.log('PDF horizontal position');
  await page.evaluate(() => Display.set({ bookZoom: 2.2 }, { persist: true })); await page.waitForTimeout(1500);
  await page.evaluate(() => { const w = document.getElementById('pdfWrap'); w.scrollLeft = 140; w.scrollTop = 120; }); await page.waitForTimeout(800);
  await page.evaluate(() => Display.set({ bookLocked: true }, { force: true }));      // horizontal scroll lock ON
  const sl1 = await page.evaluate(() => document.getElementById('pdfWrap').scrollLeft);
  const pg1 = await page.evaluate(async () => (await db.progress.toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  t('progress stores the horizontal offset (hx=' + pg1.hx + ') even with the lock on', typeof pg1.hx === 'number' && pg1.hx !== 0.5, pg1);
  await H.reveal(); await page.click('#backBtn'); await page.waitForTimeout(400);
  await page.click('.nb[data-tab="library"]'); await page.evaluate(() => document.querySelector('.tile .cover').click());
  await page.waitForSelector('#pdfWrap .pdf-inner canvas'); await page.waitForTimeout(1500);
  const sl2 = await page.evaluate(() => document.getElementById('pdfWrap').scrollLeft);
  t('reopened book: horizontal scroll restored (' + Math.round(sl1) + ' → ' + Math.round(sl2) + ')', Math.abs(sl1 - sl2) < 6, [sl1, sl2]);
  await browser.close();

  // ===================== CJK tokenization =====================
  ({ browser, ctx, page, errors, H } = await boot({ hasTouch: true }));
  console.log('Chinese / Japanese words');
  await page.evaluate(async () => { await addLanguage({ code: 'zh' }); await setSetting('studyLang', 'zh'); });
  await H.openBook('/tmp/cjk.txt', '#textWrap .content p'); await H.hide();
  const cjkWord = async (para, text) => page.evaluate(([para, text]) => { const w = document.getElementById('textWrap'), p = w.querySelectorAll('.content p')[para], tn = p.firstChild, i = tn.data.indexOf(text); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 1); w.scrollTop = Math.max(0, p.offsetTop - 200); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, [para, text]);
  await page.evaluate(() => Reader.setLanguage('zh'));
  let xy = await cjkWord(0, '学习'); await page.waitForTimeout(300); xy = await cjkWord(0, '学习');
  await page.mouse.dblclick(xy.x, xy.y); await page.waitForSelector('#selPopup:not([hidden])');
  const w1 = await hs();
  t('Chinese: double tap selects a WORD (“' + w1 + '”), not the whole run of characters', w1 === '学习', w1);
  await page.evaluate(() => Reader.clearSelection());
  await page.waitForTimeout(700);                       // leave the double-tap window of the previous step
  xy = await cjkWord(0, '学习'); await page.mouse.click(xy.x, xy.y); await page.mouse.click(xy.x, xy.y); await page.mouse.click(xy.x, xy.y);
  await page.waitForTimeout(500);
  const s3 = await hs();
  t('Chinese: triple tap selects the sentence (“' + s3 + '”)', s3 === '我喜欢学习中文。', s3);
  await page.evaluate(() => Reader.clearSelection());
  await page.evaluate(() => Reader.setLanguage('ja'));
  xy = await cjkWord(1, '日本語'); await page.waitForTimeout(300); xy = await cjkWord(1, '日本語');
  await page.mouse.dblclick(xy.x, xy.y); await page.waitForSelector('#selPopup:not([hidden])');
  const j1 = await hs();
  t('Japanese: double tap selects 日本語 (“' + j1 + '”)', j1 === '日本語', j1);
  await page.evaluate(() => Reader.clearSelection());
  // marks use the same tokenizer: saving 学习 highlights ONLY that word
  await page.evaluate(() => { Reader.setLanguage('zh'); Reader.setMarks({ vocab: new Map([['学习', '学习的翻译']]), looked: new Set() }); Reader.refreshMarks(); });
  await page.waitForTimeout(300);
  const marked = await page.$$eval('#textWrap .rt-vocab', e => e.map(x => x.textContent));
  t('saved Chinese word is highlighted alone (' + JSON.stringify(marked) + '), not the whole sentence', marked.length >= 1 && marked.every(m => m === '学习'), marked);

  // ===================== quiz quit button =====================
  console.log('Quiz layout');
  await page.evaluate(async () => { await addWord({ foreign: 'dog', translation: 'Hund', context: 'x', langCode: 'zh' }); });
  await H.reveal(); await page.click('.nb[data-tab="quiz"]'); await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.click('#startQuizBtn'); await page.waitForSelector('#fcCard');
  const q = await page.evaluate(() => { const b = document.getElementById('quitQuiz') || document.querySelector('#quizSession [id*="quit" i], #quizSession .quit, #quizSession button'); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { top: r.top, left: r.left, bottom: r.bottom, vh: innerHeight, hit: !!(e && b.contains(e)) }; });
  t('quit button is on screen and tappable even when the page was scrolled (top=' + Math.round(q.top) + ')', q.top >= 0 && q.bottom <= q.vh && q.hit, q);
  const pos = await page.evaluate(() => getComputedStyle(document.getElementById('quizSession')).position);
  t('study session is a fixed overlay (safe-area aware), not part of the scrolling page', pos === 'fixed', pos);
  await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { get: () => document.documentElement, configurable: true }); document.dispatchEvent(new Event('fullscreenchange')); });
  const q2 = await page.evaluate(() => { const b = document.querySelector('#quizSession button'); const r = b.getBoundingClientRect(); return { top: r.top }; });
  t('…and still on screen in fullscreen', q2.top >= 0, q2);
  await page.click('#quizSession button'); await page.waitForSelector('.modal:not([hidden]) .ui-actions').catch(() => {});

  console.log('\nerrors:', errors.length ? errors : 'none'); console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
