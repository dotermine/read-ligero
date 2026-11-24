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
ok('Android app presets hand the TEXT to the app (ACTION_SEND, like Share → Translate) with a web fallback', () => {
  const u = X.build('translator', { preset: 'google-app' }, ctx({ platform: 'android' })).url;
  assert.ok(u.startsWith('intent:#Intent;action=android.intent.action.SEND;type=text/plain;package=com.google.android.apps.translate;S.android.intent.extra.TEXT=Stra%C3%9Fe%20caf%C3%A9;'), u);
  const fb = /S\.browser_fallback_url=([^;]+);end$/.exec(u)[1];
  assert.strictEqual(decodeURIComponent(fb), 'https://translate.google.com/m?sl=de&tl=ru&hl=ru&q=Stra%C3%9Fe%20caf%C3%A9');
  for (const [id, pkg] of [['yandex-app', 'ru.yandex.translate'], ['deepl-app', 'com.deepl.mobiletranslator'], ['reverso-app', 'com.softissimo.reverso.context'], ['microsoft-app', 'com.microsoft.translator']]) {
    const v = X.build('translator', { preset: id }, ctx({ platform: 'android', word: 'dog' })).url;
    assert.ok(v.includes('package=' + pkg) && v.includes('S.android.intent.extra.TEXT=dog;') && v.includes('S.browser_fallback_url=https%3A%2F%2F'), v);
  }
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
