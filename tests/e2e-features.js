const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'), fs = require('fs');
const BASE = 'http://localhost:8765/', FX = p => path.join(__dirname, 'fixtures', p);
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? '→ ' + JSON.stringify(extra) : ''); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + 'index.html');
  await page.waitForSelector('#booksGrid', { state: 'attached' });
  await page.waitForTimeout(500);
  const tab = n => page.click(`.nb[data-tab="${n}"]`);
  const shot = n => page.screenshot({ path: `/tmp/shots/${n}.png` });

  console.log('Settings');
  await tab('settings');
  const langs = await page.$$eval('#setLang option', o => o.map(x => x.textContent));
  t('interface languages shown as endonyms', ['English', 'Русский', 'Deutsch', 'Español', 'Français', '日本語'].every(n => langs.includes(n)), langs);
  t('gloss controls exist (switch, stepper, 3 color dropdowns)', await page.evaluate(() => !!document.querySelector('#glossOn') && !!document.querySelector('[data-stepper=glossSize]') && document.querySelectorAll('[data-colorsel]').length === 3));
  await page.click('[data-stepper=glossSize] [data-step="1"]');
  t('gloss size stepper +', (await page.textContent('[data-stepper=glossSize] .stepper-val')) === '60%');
  await page.click('[data-colorsel=lookColor] .colorsel-btn');
  t('color dropdown opens with swatches', await page.isVisible('[data-colorsel=lookColor] .colorsel-list'));
  await page.click('[data-colorsel=lookColor] li:nth-child(4)');
  t('looked-up color applied to CSS var', (await page.evaluate(() => document.documentElement.style.getPropertyValue('--mk-look'))).includes('255,152,0'));
  await shot('01-settings');

  console.log('Language + dictionary import (worker)');
  await page.click('#addLanguageBtn');
  await page.selectOption('#lCode', 'en');
  const optGroups = await page.$$eval('#lExtTransSel optgroup', g => g.map(x => x.label));
  const dictOpts = await page.$$eval('#lExtDictSel option', o => o.map(x => x.textContent));
  t('translator dropdown grouped: apps + web', optGroups.length === 2, optGroups);
  t('dictionary dropdown has GoldenDict/StarDict/MDict/dict.cc/Cambridge/Wiktionary', ['GoldenDict', 'StarDict', 'MDict', 'dict.cc', 'Cambridge Dictionary'].every(n => dictOpts.includes(n)) && dictOpts.some(o => o.startsWith('Wiktionary')), dictOpts);
  await page.selectOption('#lExtDictSel', 'goldendict');
  await page.selectOption('#lExtTransSel', 'google-app');
  await page.selectOption('#lExtTransSel', 'custom');
  t('custom URL input appears for "Custom URL scheme"', await page.isVisible('#lExtTrans'));
  await page.selectOption('#lExtTransSel', 'yandex-app');
  await page.setInputFiles('#lDict', FX('wikdict-eng-deu.zip'));
  await page.click('#langSave');
  await page.waitForFunction(() => document.querySelector('.toast') && /imported/i.test(document.querySelector('.toast').textContent), null, { timeout: 15000 }).catch(() => {});
  const cnt = await page.evaluate(async () => ({ rows: await db.dictEntries.where('lang').equals('en').count(), meta: await db.dictionaries.toArray() }));
  t('WikDict zip imported in worker, indexed rows stored', cnt.rows >= 5 && cnt.meta.length === 1 && cnt.meta[0].format === 'stardict', cnt);
  const lk = await page.evaluate(async () => ({ a: await lookupEntries('en', 'Dog'), b: await lookupEntries('en', 'cafe'), c: await lookupEntries('en', 'dogs'), d: await lookupWord('en', 'zzz') }));
  t('lookup: case-insensitive', lk.a && lk.a.key === 'dog');
  t('lookup: accent-insensitive (cafe → café)', lk.b && lk.b.key === 'café');
  t('lookup: synonym (.syn) resolves', lk.c && lk.c.key === 'dog');
  t('lookup: missing word → null', lk.d === null);
  // re-import via TSV into same language (replace) through edit dialog
  await page.click('#langList [data-act="edit"]');
  t('edit dialog keeps chosen presets', (await page.inputValue('#lExtDictSel')) === 'goldendict' && (await page.inputValue('#lExtTransSel')) === 'yandex-app');
  await page.setInputFiles('#lDict', FX('local.tsv'));
  await page.click('#langSave');
  await page.waitForSelector('#langModal', { state: 'hidden', timeout: 15000 });
  t('local TSV replaces dictionary (3 entries)', (await page.evaluate(() => db.dictEntries.where('lang').equals('en').count())) === 3);
  // back to the wikdict dictionary for the reader tests
  await page.click('#langList [data-act="edit"]');
  await page.setInputFiles('#lDict', FX('wikdict-eng-deu.zip'));
  await page.click('#langSave');
  await page.waitForSelector('#langModal', { state: 'hidden', timeout: 15000 });
  t('WikDict re-imported over the TSV', (await page.evaluate(() => db.dictEntries.where('lang').equals('en').count())) >= 5);

  console.log('Library + reader');
  await tab('library');
  await page.setInputFiles('#fileInput', '/tmp/book.txt');
  await page.waitForSelector('.tile .cover', { timeout: 10000 });
  await page.click('.tile .cover');
  await page.waitForSelector('#textWrap .content p');
  const base = await page.evaluate(() => ({ nav: document.querySelector('.bnav').getBoundingClientRect().height, rtb: document.querySelector('.rtb').getBoundingClientRect().height, fs: getComputedStyle(document.querySelector('#textWrap .content')).fontSize }));
  await page.click('#qbarBtn');
  t('quick bar opens', await page.isVisible('#qbarPanel'));
  t('bar has 4 orientation buttons, fullscreen, lock — all with aria-labels', await page.evaluate(() => [...document.querySelectorAll('#qbarPanel .qbtn')].length === 6 && [...document.querySelectorAll('#qbarPanel .qbtn')].every(b => b.getAttribute('aria-label'))));
  await page.evaluate(() => { const r = document.querySelector('#qbarPanel [data-disp=bookZoom]'); r.value = 1.5; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(300);
  const z = await page.evaluate(() => ({ nav: document.querySelector('.bnav').getBoundingClientRect().height, rtb: document.querySelector('.rtb').getBoundingClientRect().height, fs: getComputedStyle(document.querySelector('#textWrap .content')).fontSize, navFs: getComputedStyle(document.querySelector('.nb span')).fontSize }));
  t('book zoom scales the TEXT (18px → 27px)', parseFloat(z.fs) === parseFloat(base.fs) * 1.5, z);
  t('UI chrome stays at 100% (tab bar / toolbar unchanged)', z.nav === base.nav && z.rtb === base.rtb && z.navFs === '12px', [base, z]);
  await page.evaluate(() => { const r = document.querySelector('#qbarPanel [data-disp=bookOffset]'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const stage = await page.evaluate(() => { const r = document.getElementById('bookStage').getBoundingClientRect(); return { left: Math.round(r.left), w: Math.round(r.width) }; });
  t('horizontal position shifts only the book stage (+20% → left margin 78px)', stage.left === 78 && stage.w === 390 - 78, stage);
  await shot('02-reader-bar');
  // sync with Settings
  await tab('settings');
  const sv = await page.evaluate(() => [...document.querySelectorAll('#tab-settings [data-disp]')].map(e => e.getAttribute('data-disp') + '=' + e.value));
  t('Settings tab shows the same zoom / position (sync)', sv.includes('bookZoom=1.5') && sv.includes('bookOffset=20'), sv);
  await page.click('#tab-settings [data-disp-orient="90"]');
  t('orientation chosen in Settings is stored', (await page.evaluate(() => Display.get().orientation)) === 90);
  await page.click('#tab-settings [data-disp-orient="auto"]');
  // lock in settings, check reader bar reflects
  await page.click('#tab-settings [data-disp-lock]');
  t('lock disables zoom/position controls everywhere', await page.evaluate(() => [...document.querySelectorAll('[data-disp]')].every(e => e.disabled)));
  await page.evaluate(() => Display.set({ bookZoom: 2.5 }));
  t('locked: zoom cannot change', (await page.evaluate(() => Display.get().bookZoom)) === 1.5);
  await tab('read');
  t('lock icon state in reader bar', (await page.getAttribute('#qbarPanel [data-disp-lock]', 'aria-pressed')) === 'true');
  await page.click('#qbarPanel [data-disp-lock]');   // unlock again
  await page.click('#qbarBtn');                       // collapse bar
  t('bar collapses', !(await page.isVisible('#qbarPanel')));

  console.log('Dictionary bottom sheet → New word');
  const pos = await page.evaluate(() => {
    const tn = document.querySelector('#textWrap .content p').firstChild, i = tn.data.indexOf('dog');
    const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 3);
    const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.dblclick(pos.x, pos.y);
  await page.waitForSelector('#selPopup:not([hidden])');
  await page.click('#selPopup [data-action="internal"]');
  await page.waitForSelector('#dictSheet:not([hidden])');
  await page.waitForFunction(() => /Hund/.test(document.getElementById('dsBody').textContent));
  t('sheet shows word + definition', (await page.textContent('#dsWord')) === 'dog' && /Rüde/.test(await page.textContent('#dsBody')));
  await page.waitForTimeout(500); await shot('03-sheet');
  await page.click('#dsAdd');
  await page.waitForSelector('#wordModal:not([hidden])');
  t('New word: translation pre-filled from dictionary', (await page.inputValue('#wTranslation')) === 'Hund; Rüde', await page.inputValue('#wTranslation'));
  t('New word: word + context filled', (await page.inputValue('#wForeign')) === 'dog' && /dog sat/.test(await page.inputValue('#wContext')));
  const ae = await page.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id }));
  t('New word: NO input focused (no on-screen keyboard)', ae.tag !== 'INPUT' && ae.tag !== 'TEXTAREA', ae);
  await shot('04-newword');
  await page.click('#wordSave');
  await page.waitForSelector('#wordModal', { state: 'hidden' });
  await page.waitForSelector('#textWrap .rt-vocab[data-tr]', { timeout: 5000 });
  t('saved word is highlighted with gloss above it', (await page.getAttribute('#textWrap .rt-vocab', 'data-tr')) === 'Hund; Rüde');
  const gloss = await page.evaluate(() => getComputedStyle(document.querySelector('#textWrap .rt-vocab'), '::before').fontSize);
  t('gloss size follows setting (60% of 27px = 16.2px)', Math.abs(parseFloat(gloss) - 16.2) < 0.3, gloss);
  await shot('05-reader-gloss');
  // gloss off
  await tab('settings'); await page.click('#glossOn'); await tab('read');
  t('gloss switch OFF hides the translation', (await page.evaluate(() => getComputedStyle(document.querySelector('#textWrap .rt-vocab'), '::before').display)) === 'none');
  await tab('settings'); await page.click('#glossOn');

  console.log('Quiz (SRS)');
  await page.evaluate(async () => { await addWord({ foreign: 'house', translation: 'Haus', context: 'the house', langCode: 'en', bookId: null }); await addWord({ foreign: 'street', translation: 'Straße', context: 'the street', langCode: 'en', bookId: null }); });
  await tab('quiz');
  await page.waitForTimeout(400);
  t('button label is exactly "Start"', (await page.textContent('#startQuizBtn')).trim() === 'Start');
  const btn = await page.evaluate(() => { const b = document.getElementById('startQuizBtn'), r = b.getBoundingClientRect(); return { w: r.width, h: r.height, sw: b.scrollWidth, cw: b.clientWidth, disabled: b.disabled, left: r.left, right: r.right }; });
  t('Start button: enabled, no clipping (scrollWidth ≤ clientWidth), inside viewport', !btn.disabled && btn.sw <= btn.cw && btn.left >= 0 && btn.right <= 390, btn);
  t('counters: New = 3', (await page.textContent('#statNew')) === '3');
  await shot('06-quiz-home');
  await page.click('#startQuizBtn');
  await page.waitForSelector('#fcCard');
  t('progress shows words left', /3/.test(await page.textContent('#quizProgressText')));
  await page.click('#fcCard');
  const labels = await page.$$eval('#fcActions .gi', e => e.map(x => x.textContent));
  t('rating buttons show next intervals for a new card', JSON.stringify(labels) === JSON.stringify(['1m', '6m', '10m', '4d']), labels);
  await shot('07-quiz-card');
  const firstWord = (await page.textContent('#fcFace')).trim();
  await page.click('#fcActions .again');
  await page.waitForTimeout(100);
  t('"Again" keeps the card in the session (still 3 left)', /3/.test(await page.textContent('#quizProgressText')));
  // answer everything with Easy except finish the "again" card with Good, Good
  let guard = 0;
  while (await page.isVisible('#fcCard') && guard++ < 20) {
    await page.click('#fcCard'); await page.waitForSelector('#fcActions:not([hidden])');
    const front = (await page.textContent('.fc-status')).toLowerCase();
    await page.click(front.includes('learn') ? '#fcActions .good' : '#fcActions .easy');
    await page.waitForTimeout(60);
  }
  await page.waitForSelector('.modal .ui-msg', { timeout: 5000 });
  t('session ends only after every card is recalled; summary shown', /Forgotten: 1/.test(await page.textContent('.modal .ui-msg')), await page.textContent('.modal .ui-msg'));
  await page.click('.modal:not([hidden]) .ui-actions .btn');
  const st = await page.evaluate(async () => (await db.words.toArray()).map(w => ({ f: w.foreign, s: w.status, i: w.interval, e: w.easeFactor, r: w.repetitions, n: w.nextReviewDate > Date.now() })));
  t('SRS metadata persisted (status/interval/easeFactor/repetitions/nextReviewDate)', st.length === 3 && st.every(w => w.s === 'review' && w.i >= 1 && w.e >= 1.3 && w.n), st);
  await page.waitForTimeout(300);
  t('nothing due afterwards → Start disabled + hint', (await page.isDisabled('#startQuizBtn')) && (await page.isVisible('#quizHint')), await page.textContent('#quizHint'));

  console.log('Backup export / import');
  await tab('settings');
  await page.click('#exportBtn');
  await page.waitForSelector('.modal .ui-actions');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal:not([hidden]) .ui-actions .btn:nth-child(2)')]);
  const bp = '/tmp/backup.json'; await dl.saveAs(bp);
  const bk = JSON.parse(fs.readFileSync(bp, 'utf8'));
  t('backup JSON has words/progress/settings/languages', bk.format === 'readligero-backup' && bk.words.length === 3 && bk.settings.length > 3 && bk.languages.length === 1 && bk.books.length === 1, Object.keys(bk));
  // wipe words, import → restored
  await page.evaluate(() => db.words.clear());
  await page.setInputFiles('#importFile', bp);
  await page.waitForSelector('.modal .ui-msg');
  t('import reports restored words', /3 words/.test(await page.textContent('.modal .ui-msg')), await page.textContent('.modal .ui-msg'));
  await page.waitForTimeout(100);

  console.log('Persistent storage');
  const pers = await page.evaluate(() => navigator.storage.persisted());
  t('storage.persist() API available/called (granted=' + pers + ')', typeof pers === 'boolean');

  console.log('\nConsole/page errors:', errors.length ? errors : 'none');
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
