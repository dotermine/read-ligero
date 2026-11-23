// Cold-start offline test: visit online once, go offline, open a NEW page (like launching the installed PWA).
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = process.argv[2] || 'http://localhost:8777/';
let pass = 0, fail = 0;
const t = (n, c, x) => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x !== undefined ? '→ ' + JSON.stringify(x) : '')); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('#booksGrid', { state: 'attached' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);                      // let the precache finish
  const st = await page.evaluate(async () => { const k = await caches.keys(); const c = k.length ? await caches.open(k[0]) : null; return { keys: k, n: c ? (await c.keys()).length : 0, sw: !!navigator.serviceWorker.controller }; });
  console.log('  cache:', JSON.stringify(st));
  await page.close();
  await ctx.setOffline(true);
  const p2 = await ctx.newPage();
  const errs = []; p2.on('pageerror', e => errs.push(e.message));
  let ok = true;
  for (const url of [BASE, BASE + 'index.html', BASE + '?utm=1']) {
    try { const r = await p2.goto(url, { timeout: 8000 }); await p2.waitForSelector('#booksGrid', { state: 'attached', timeout: 5000 }); } catch (e) { ok = false; console.log('    offline load failed for', url, '-', String(e.message).split('\n')[0]); }
  }
  t('offline cold start works for /, /index.html and ?query', ok);
  t('app boots offline (Dexie + Display + DictCore available)', ok && await p2.evaluate(() => typeof Dexie === 'function' && typeof Display === 'object' && typeof DictCore === 'object'));
  t('no page errors offline', errs.length === 0, errs);
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
