'use strict';
const assert = require('assert');
const X = require('../extlinks.js');
const names = { en: 'English', ru: 'Russian', de: 'German' };
const ctx = (o) => Object.assign({ word: 'Straße café', from: 'de', to: 'ru', nameOf: c => names[c] || c, platform: 'desktop' }, o);
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };
console.log('extlinks.js');

ok('web translators fill {text}/{from}/{to}/names', () => {
  assert.strictEqual(X.build('translator', { preset: 'google-web' }, ctx()).url, 'https://translate.google.com/m?sl=de&tl=ru&hl=ru&q=Stra%C3%9Fe%20caf%C3%A9');   // /m + q= : the word is always pre-filled
  assert.strictEqual(X.build('translator', { preset: 'reverso-web' }, ctx()).url, 'https://context.reverso.net/translation/german-russian/Stra%C3%9Fe%20caf%C3%A9');
  assert.strictEqual(X.build('translator', { preset: 'deepl-web' }, ctx()).url, 'https://www.deepl.com/translator#de/ru/Stra%C3%9Fe%20caf%C3%A9');
});
ok('Android app presets hand the word to the app through the SHARE SHEET (intent: links cannot carry text), with a web fallback', () => {
  for (const id of ['google-app', 'yandex-app', 'deepl-app', 'reverso-app', 'microsoft-app', 'share-translate']) {
    const r = X.build('translator', { preset: id }, ctx({ platform: 'android', word: 'Stra\u00dfe caf\u00e9' }));
    assert.strictEqual(r.url, 'webshare:Stra%C3%9Fe%20caf%C3%A9', id);
  }
  assert.strictEqual(X.build('translator', { preset: 'google-app' }, ctx({ platform: 'android' })).fallback, 'https://translate.google.com/m?sl=de&tl=ru&hl=ru&q=Stra%C3%9Fe%20caf%C3%A9');
  assert.ok(!/^intent:/.test(X.build('translator', { preset: 'google-app' }, ctx({ platform: 'android' })).url));
});
ok('floating / split-screen windows: launch flags are added to intent: URLs only when enabled', () => {
  const plain = X.build('dict', { preset: 'goldendict' }, ctx({ platform: 'android', word: 'dog' })).url;
  assert.strictEqual(plain, 'intent:#Intent;action=colordict.intent.action.SEARCH;S.EXTRA_QUERY=dog;end');
  X.setFloating(true);
  assert.strictEqual(X.build('dict', { preset: 'goldendict' }, ctx({ platform: 'android', word: 'dog' })).url, 'intent:#Intent;action=colordict.intent.action.SEARCH;S.EXTRA_QUERY=dog;launchFlags=0x10001000;end');
  assert.ok(!/launchFlags/.test(X.build('translator', { preset: 'google-web' }, ctx()).url));       // web URLs are untouched
  X.setFloating(false);
});
ok('open(): webshare uses navigator.share, falls back to the web page when unavailable', () => {
  const calls = []; global.window = { open: u => { calls.push(['open', u]); return {}; }, location: {} };
  const setNav = v => Object.defineProperty(global, 'navigator', { value: v, configurable: true, writable: true });
  setNav({ share: o => { calls.push(['share', o.text]); return Promise.resolve(); } });
  X.open('webshare:dog%20cat', 'https://x/y'); assert.deepStrictEqual(calls, [['share', 'dog cat']]);
  setNav({}); calls.length = 0; X.open('webshare:dog', 'https://x/y'); assert.deepStrictEqual(calls, [['open', 'https://x/y']]);
  delete global.window; setNav(undefined);
});
ok('generic share-sheet dictionary preset exists for Android and iOS', () => {
  assert.strictEqual(X.build('dict', { preset: 'share-dict' }, ctx({ platform: 'ios', word: 'a' })).url, 'webshare:a');
  assert.deepStrictEqual(X.build('dict', { preset: 'share-dict' }, ctx({ platform: 'desktop' })), { error: 'unsupported' });
});
ok('app presets fall back to the web URL on iOS / desktop', () => {
  assert.ok(X.build('translator', { preset: 'google-app' }, ctx({ platform: 'ios' })).url.startsWith('https://translate.google.com/'));
});
ok('local dictionaries: Android intent, desktop scheme, unsupported elsewhere', () => {
  assert.strictEqual(X.build('dict', { preset: 'goldendict' }, ctx({ platform: 'android' })).url, 'intent:#Intent;action=colordict.intent.action.SEARCH;S.EXTRA_QUERY=Stra%C3%9Fe%20caf%C3%A9;end');
  assert.strictEqual(X.build('dict', { preset: 'goldendict' }, ctx({ platform: 'desktop' })).url, 'goldendict://Stra%C3%9Fe%20caf%C3%A9');
  assert.deepStrictEqual(X.build('dict', { preset: 'goldendict' }, ctx({ platform: 'ios' })), { error: 'unsupported' });
  assert.ok(X.build('dict', { preset: 'mdict' }, ctx({ platform: 'ios' })).url.startsWith('mdict://'));
});
ok('online dictionaries', () => {
  assert.strictEqual(X.build('dict', { preset: 'wiktionary-ui' }, ctx()).url, 'https://ru.wiktionary.org/wiki/Stra%C3%9Fe%20caf%C3%A9');
  assert.strictEqual(X.build('dict', { preset: 'dictcc' }, ctx({ word: 'dog' })).url, 'https://www.dict.cc/?s=dog');
});
ok('custom URL + legacy string + not configured', () => {
  assert.strictEqual(X.build('dict', { preset: 'custom', custom: 'myapp://q?w={word}&l={from}' }, ctx({ word: 'a b' })).url, 'myapp://q?w=a%20b&l=de');
  assert.strictEqual(X.build('dict', 'goldendict://{word}', ctx({ word: 'x' })).url, 'goldendict://x');
  assert.deepStrictEqual(X.build('dict', { preset: '' }, ctx()), { error: 'notConfigured' });
  assert.deepStrictEqual(X.build('dict', { preset: 'custom', custom: '  ' }, ctx()), { error: 'notConfigured' });
});
ok('platform()', () => {
  assert.strictEqual(X.platform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120'), 'android');
  assert.strictEqual(X.platform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
  assert.strictEqual(X.platform('Mozilla/5.0 (X11; Linux x86_64) Chrome/120'), 'desktop');
});
console.log(n + ' tests passed');
