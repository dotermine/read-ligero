const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const BASE = 'http://localhost:8765/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: false });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', r => errors.push('reqfail: ' + r.url()));
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => {});
  // wait for SW activation + precache
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    const reqs = await cache.keys();
    const m = await (await fetch('manifest.json')).json();
    return { active: !!reg.active, keys, cached: reqs.length, manifest: m.name, controller: !!navigator.serviceWorker.controller };
  });
  console.log('SW:', JSON.stringify(info));
  const pre = await page.evaluate(() => fetch('precache-manifest.js').then(r => r.text()));
  const expected = (pre.match(/"\.\/[^"]*"/g) || []).length;
  console.log('precache entries expected:', expected, 'cached:', info.cached);
  // manifest installability checks
  const mcheck = await page.evaluate(async () => {
    const m = await (await fetch('manifest.json')).json();
    const out = [];
    for (const i of m.icons) { const r = await fetch(i.src); out.push(i.src + ':' + r.status); }
    return { display: m.display, start: m.start_url, scope: m.scope, icons: out };
  });
  console.log('manifest:', JSON.stringify(mcheck));
  // reload offline
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('#booksGrid', { state: 'attached', timeout: 10000 });
  console.log('offline reload OK, title =', await page.title());
  const offlineLib = await page.evaluate(() => typeof Dexie + '/' + typeof pdfjsLib + '/' + typeof ePub + '/' + typeof Display + '/' + typeof DictCore);
  console.log('libs offline:', offlineLib);
  await ctx.setOffline(false);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
