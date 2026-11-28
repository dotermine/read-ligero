/* ExtLinks — presets for external dictionaries and translators (native apps and web services).
 *
 * Each preset has `urls` per platform: android | ios | desktop | web. Resolution order for the current platform:
 *   urls[platform] → urls.web → unsupported.
 * Placeholders: {word} / {text} (URL-encoded selection), {from} / {to} (ISO 639-1 codes: study language / interface
 * language), {fromName} / {toName} (lower-case English names, e.g. "english", for sites that need them).
 *
 * Android native apps are launched with Chrome "intent:" URLs. For translators the intent carries
 * S.browser_fallback_url, so when the app is not installed Chrome opens the web page instead.
 * IMPORTANT (why translators use the share sheet on Android): Chrome only launches `intent:` URLs whose target activity is
 * BROWSABLE. The "text" entry points of Google Translate / Yandex / DeepL (ACTION_SEND, PROCESS_TEXT) are not, so such a link
 * silently falls back to the web URL — which the app then intercepts and opens EMPTY. The Web Share API hands the word to the
 * installed app through the system share sheet instead (the same path as "Share → Translate"), which pre-fills and translates it.
 * The scheme / package details of third-party apps are NOT under our control and differ between app versions:
 * every preset can be overridden with the "Custom URL scheme" option. Edit this file to add more presets.
 */
(function (root) {
  'use strict';

  /** Android: hand the word to an installed app through the system share sheet (see the note above). */
  var SHARE = 'webshare:{text}';

  // The /m (mobile web) page reads ?q= reliably and is not claimed by the Android app, so the word is always pre-filled.
  var G = 'https://translate.google.com/m?sl={from}&tl={to}&hl={to}&q={text}';
  var Y = 'https://translate.yandex.com/?source_lang={from}&target_lang={to}&text={text}';
  var D = 'https://www.deepl.com/translator#{from}/{to}/{text}';
  var R = 'https://context.reverso.net/translation/{fromName}-{toName}/{text}';
  var M = 'https://www.bing.com/translator?from={from}&to={to}&text={text}';

  var TRANSLATORS = [
    // --- native apps (Android intent with web fallback; elsewhere the web page / universal link) ---
    { id: 'yandex-app',   group: 'app', label: 'Yandex Translate',     urls: { android: SHARE, web: Y }, web: Y },
    { id: 'google-app',   group: 'app', label: 'Google Translate',     urls: { android: SHARE, web: G }, web: G },
    { id: 'deepl-app',    group: 'app', label: 'DeepL',                urls: { android: SHARE, web: D }, web: D },
    { id: 'reverso-app',  group: 'app', label: 'Reverso Context',      urls: { android: SHARE, web: R }, web: R },
    { id: 'microsoft-app', group: 'app', label: 'Microsoft Translator', urls: { android: SHARE, web: M }, web: M },
    { id: 'share-translate', group: 'app', label: 'Share sheet (any translator app)', urls: { android: SHARE } },
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
    { id: 'share-dict', group: 'local', label: 'Share sheet (any dictionary app)', urls: { android: SHARE, ios: SHARE } },
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

  var floating = false;
  /** Android: ask for a split-screen / adjacent window (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_LAUNCH_ADJACENT). Best effort. */
  function setFloating(on) { floating = !!on; }
  var withFlags = function (u) { return floating && /^intent:/.test(u) ? u.replace(/;end$/, ';launchFlags=0x10001000;end') : u; };

  /**
   * cfg: { preset: '<id>' | 'custom' | '', custom: 'url template' } (or a legacy plain string = custom template)
   * ctx: { word, from, to, nameOf(code) -> English name, platform? }
   * → { url, fallback } or { error: 'notConfigured' | 'unsupported' }
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
    var out = fill(tpl.replace('{@web}', fb ? encodeURIComponent(fill(fb)) : ''));
    return { url: withFlags(out), fallback: fb ? fill(fb) : '' };
  }

  /**
   * Opens the target: http(s) in a new tab/window, `webshare:` through the system share sheet (falls back to the web page
   * when sharing is unavailable), everything else (intent:, custom schemes) via navigation.
   */
  function open(url, fallback) {
    if (/^webshare:/.test(url)) {
      var text = decodeURIComponent(url.slice(9));
      if (navigator.share) { navigator.share({ text: text }).catch(function (e) { if (e && e.name !== 'AbortError' && fallback) open(fallback); }); }
      else if (fallback) open(fallback);
      return;
    }
    if (/^https?:/i.test(url)) {
      var w = window.open(url, '_blank', 'noopener');
      if (!w) window.location.href = url;
    } else {
      window.location.href = url;
    }
  }

  var api = { TRANSLATORS: TRANSLATORS, DICTIONARIES: DICTIONARIES, platform: platform, build: build, open: open, find: find, setFloating: setFloating };
  root.ExtLinks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
