/* ExtLinks — presets for external dictionaries and translators (native apps and web services).
 *
 * Each preset has `urls` per platform: android | ios | desktop | web. Resolution order for the current platform:
 *   urls[platform] → urls.web → unsupported.
 * Placeholders: {word} / {text} (URL-encoded selection), {from} / {to} (ISO 639-1 codes: study language / interface
 * language), {fromName} / {toName} (lower-case English names, e.g. "english", for sites that need them).
 *
 * Android native apps are launched with Chrome "intent:" URLs. For translators the intent carries
 * S.browser_fallback_url, so when the app is not installed Chrome opens the web page instead.
 * The scheme / package details of third-party apps are NOT under our control and differ between app versions:
 * every preset can be overridden with the "Custom URL scheme" option. Edit this file to add more presets.
 */
(function (root) {
  'use strict';

  /** Builds an Android intent URL that opens `https` page `web` in app `pkg`, falling back to the browser. */
  function androidApp(pkg, web) {
    var m = /^https:\/\/([^\/?#]+)([^#]*)(#.*)?$/.exec(web);
    // An intent URI cannot carry a #fragment, so only host + path + query go into the intent itself
    // (the app opens; the full URL, fragment included, is kept in the browser fallback).
    var rest = m ? m[2] : '';
    // The fallback URL is itself a placeholder template; it is encoded after substitution (see build()).
    return 'intent://' + (m ? m[1] : '') + rest + '#Intent;scheme=https;package=' + pkg +
      ';S.browser_fallback_url={@web};end';
  }

  var G = 'https://translate.google.com/?sl={from}&tl={to}&text={text}&op=translate';
  var Y = 'https://translate.yandex.com/?source_lang={from}&target_lang={to}&text={text}';
  var D = 'https://www.deepl.com/translator#{from}/{to}/{text}';
  var R = 'https://context.reverso.net/translation/{fromName}-{toName}/{text}';
  var M = 'https://www.bing.com/translator?from={from}&to={to}&text={text}';

  var TRANSLATORS = [
    // --- native apps (Android intent with web fallback; elsewhere the web page / universal link) ---
    { id: 'yandex-app',   group: 'app', label: 'Yandex Translate',     urls: { android: androidApp('ru.yandex.translate', Y), web: Y }, web: Y },
    { id: 'google-app',   group: 'app', label: 'Google Translate',     urls: { android: androidApp('com.google.android.apps.translate', G), web: G }, web: G },
    { id: 'deepl-app',    group: 'app', label: 'DeepL',                urls: { android: androidApp('com.deepl.mobiletranslator', D), web: D }, web: D },
    { id: 'reverso-app',  group: 'app', label: 'Reverso Context',      urls: { android: androidApp('com.softissimo.reverso.context', R), web: R }, web: R },
    { id: 'microsoft-app', group: 'app', label: 'Microsoft Translator', urls: { android: androidApp('com.microsoft.translator', M), web: M }, web: M },
    // --- web services ---
    { id: 'yandex-web',   group: 'web', label: 'Yandex Translate',     urls: { web: Y } },
    { id: 'google-web',   group: 'web', label: 'Google Translate',     urls: { web: G } },
    { id: 'deepl-web',    group: 'web', label: 'DeepL',                urls: { web: D } },
    { id: 'reverso-web',  group: 'web', label: 'Reverso Context',      urls: { web: R } },
    { id: 'microsoft-web', group: 'web', label: 'Microsoft Translator', urls: { web: M } }
  ];

  // ColorDict API: understood by GoldenDict (Android), ColorDict and most StarDict-format readers on Android.
  var COLORDICT = 'intent:#Intent;action=colordict.intent.action.SEARCH;S.EXTRA_QUERY={word};end';

  var DICTIONARIES = [
    // --- offline / local apps ---
    { id: 'goldendict', group: 'local', label: 'GoldenDict', urls: { android: COLORDICT, desktop: 'goldendict://{word}' } },
    { id: 'stardict',   group: 'local', label: 'StarDict',   urls: { android: COLORDICT, desktop: 'stardict://{word}' } },
    { id: 'mdict',      group: 'local', label: 'MDict',      urls: { android: 'mdict://mdict.cn/search?text={word}', ios: 'mdict://mdict.cn/search?text={word}' } },
    // --- online services ---
    { id: 'dictcc',     group: 'web', label: 'dict.cc',             urls: { web: 'https://www.dict.cc/?s={word}' } },
    { id: 'cambridge',  group: 'web', label: 'Cambridge Dictionary', urls: { web: 'https://dictionary.cambridge.org/dictionary/english/{word}' } },
    { id: 'wiktionary', group: 'web', label: 'Wiktionary (English)', urls: { web: 'https://en.wiktionary.org/wiki/{word}' } },
    { id: 'wiktionary-ui', group: 'web', label: 'Wiktionary (interface language)', urls: { web: 'https://{to}.wiktionary.org/wiki/{word}' } }
  ];

  function platform(ua) {
    ua = ua || (typeof navigator !== 'undefined' ? navigator.userAgent : '');
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
    return 'desktop';
  }

  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  /**
   * cfg: { preset: '<id>' | 'custom' | '', custom: 'url template' } (or a legacy plain string = custom template)
   * ctx: { word, from, to, nameOf(code) -> English name, platform? }
   * → { url } or { error: 'notConfigured' | 'unsupported' }
   */
  function build(kind, cfg, ctx) {
    var list = kind === 'translator' ? TRANSLATORS : DICTIONARIES;
    if (typeof cfg === 'string') cfg = { preset: 'custom', custom: cfg };
    if (!cfg || !cfg.preset) return { error: 'notConfigured' };
    var tpl, fb = '';
    if (cfg.preset === 'custom') {
      tpl = String(cfg.custom || '').trim();
      if (!tpl) return { error: 'notConfigured' };
    } else {
      var p = find(list, cfg.preset);
      if (!p) return { error: 'notConfigured' };
      var pf = ctx.platform || platform();
      tpl = p.urls[pf] || p.urls.web;
      if (!tpl) return { error: 'unsupported' };
      fb = p.web || p.urls.web || '';
    }
    var nameOf = ctx.nameOf || function (c) { return c; };
    var enc = encodeURIComponent(ctx.word || '');
    var from = ctx.from || 'auto', to = ctx.to || 'en';
    function fill(s) {
      return s.replace(/\{(word|text)\}/g, enc)
        .replace(/\{from\}/g, encodeURIComponent(from))
        .replace(/\{to\}/g, encodeURIComponent(to))
        .replace(/\{fromName\}/g, encodeURIComponent(String(nameOf(from)).toLowerCase()))
        .replace(/\{toName\}/g, encodeURIComponent(String(nameOf(to)).toLowerCase()));
    }
    // Android intent: the browser fallback URL must be percent-encoded as a whole, after substitution
    var out = fill(tpl.replace('{@web}', fb ? encodeURIComponent(fill(fb)) : ''));
    return { url: out };
  }

  /** Opens the URL: http(s) in a new tab/window, everything else (intent:, custom schemes) via navigation. */
  function open(url) {
    if (/^https?:/i.test(url)) {
      var w = window.open(url, '_blank', 'noopener');
      if (!w) window.location.href = url;
    } else {
      window.location.href = url;
    }
  }

  var api = { TRANSLATORS: TRANSLATORS, DICTIONARIES: DICTIONARIES, platform: platform, build: build, open: open, find: find };
  root.ExtLinks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
