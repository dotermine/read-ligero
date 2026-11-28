/* global db, saveBook, listBooks, deleteBook, getBook, getBookFile, getProgress, saveProgress,
   addBookmark, getSetting, setSetting, enforcePersistentStorage, saveBookCover, setBookFavorite,
   Reader, Quiz, I18N, UI, Display, Backup, ExtLinks, DictCore, Bookmarks,
   addWord, listWords, listWordsForBook, deleteWord, updateWordSrs, addLookup, listLookups,
   listLanguages, getLanguage, addLanguage, updateLanguage, deleteLanguage, getDictionaryMeta,
   lookupWord, lookupEntries, storageEstimate */

(function () {
  'use strict';

  // Flashcard fields: id, word property, CSS class, i18n label key
  var FIELDS = [
    { id: 'word',       key: 'foreign',             cls: 'fc-word',    label: 'fieldWord' },
    { id: 'transcr',    key: 'transcription',       cls: 'fc-ipa',     label: 'fieldTranscription' },
    { id: 'wordTr',     key: 'translation',         cls: 'fc-tr',      label: 'fieldWordTr' },
    { id: 'sentence',   key: 'context',             cls: 'fc-sent',    label: 'fieldSentence' },
    { id: 'sentenceTr', key: 'sentenceTranslation', cls: 'fc-sent-tr', label: 'fieldSentenceTr' }
  ];
  var DEFAULT_FRONT = ['word'];
  var DEFAULT_BACK = ['wordTr', 'sentence', 'sentenceTr'];

  // Study languages offered in the "New language" dialog: [ISO 639-1 code, name]
  var LANGUAGES = [
    ['ar', 'Arabic'], ['bg', 'Bulgarian'], ['zh', 'Chinese'], ['hr', 'Croatian'], ['cs', 'Czech'],
    ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English'], ['et', 'Estonian'], ['fi', 'Finnish'],
    ['fr', 'French'], ['de', 'German'], ['el', 'Greek'], ['he', 'Hebrew'], ['hi', 'Hindi'],
    ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'],
    ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['no', 'Norwegian'], ['fa', 'Persian'], ['pl', 'Polish'],
    ['pt', 'Portuguese'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'], ['sk', 'Slovak'],
    ['sl', 'Slovenian'], ['es', 'Spanish'], ['sv', 'Swedish'], ['th', 'Thai'], ['tr', 'Turkish'],
    ['uk', 'Ukrainian'], ['vi', 'Vietnamese']
  ];

  // Interface languages in their own script (endonyms)
  var ENDONYMS = {
    en: 'English', ru: 'Русский', ar: 'العربية', zh: '中文', fr: 'Français', de: 'Deutsch', hi: 'हिन्दी',
    it: 'Italiano', ja: '日本語', ko: '한국어', pt: 'Português', es: 'Español', tr: 'Türkçe', vi: 'Tiếng Việt'
  };

  // Curated palettes. Gloss colors have a light-theme and a dark-theme variant so they stay readable everywhere.
  var GLOSS_COLORS = [
    { id: 'amber',  name: 'colAmber',  light: '#a15c00', dark: '#ffcc66' },
    { id: 'red',    name: 'colRed',    light: '#c62828', dark: '#ff8a80' },
    { id: 'blue',   name: 'colBlue',   light: '#1565c0', dark: '#82b1ff' },
    { id: 'green',  name: 'colGreen',  light: '#2e7d32', dark: '#a5d6a7' },
    { id: 'purple', name: 'colPurple', light: '#6a1b9a', dark: '#ce93d8' },
    { id: 'teal',   name: 'colTeal',   light: '#00695c', dark: '#80cbc4' },
    { id: 'gray',   name: 'colGray',   light: '#555555', dark: '#bdbdbd' },
    { id: 'contrast', name: 'colContrast', light: '#000000', dark: '#ffffff' }
  ];
  var HILITE_COLORS = [
    { id: 'none',   name: 'colNone',   light: 'transparent', dark: 'transparent' },
    { id: 'yellow', name: 'colYellow', light: 'rgba(255,235,59,.50)', dark: 'rgba(255,235,59,.38)' },
    { id: 'amber',  name: 'colAmber',  light: 'rgba(255,193,7,.40)',  dark: 'rgba(255,193,7,.38)' },
    { id: 'orange', name: 'colOrange', light: 'rgba(255,152,0,.36)',  dark: 'rgba(255,152,0,.40)' },
    { id: 'pink',   name: 'colPink',   light: 'rgba(240,98,146,.34)', dark: 'rgba(240,98,146,.42)' },
    { id: 'purple', name: 'colPurple', light: 'rgba(171,71,188,.30)', dark: 'rgba(171,71,188,.45)' },
    { id: 'blue',   name: 'colBlue',   light: 'rgba(66,165,245,.30)', dark: 'rgba(66,165,245,.40)' },
    { id: 'teal',   name: 'colTeal',   light: 'rgba(38,166,154,.34)', dark: 'rgba(38,166,154,.42)' },
    { id: 'green',  name: 'colGreen',  light: 'rgba(102,187,106,.38)', dark: 'rgba(102,187,106,.40)' },
    { id: 'gray',   name: 'colGray',   light: 'rgba(158,158,158,.36)', dark: 'rgba(189,189,189,.34)' }
  ];

  var STEPPERS = {
    glossSize:     { min: 30, max: 100, step: 5, fmt: function (v) { return v + '%'; } },
    newPerSession: { min: 0,  max: 200, step: 1, fmt: function (v) { return String(v); } }
  };

  var state = {
    tab: 'library',
    viewMode: 'large',
    filter: 'all',
    sortKey: 'addedAt',      // 'addedAt' | 'title'
    sortDir: -1,             // -1 = descending (↓), 1 = ascending (↑)
    settings: {
      theme: 'light', accent: '#1a73e8', fontSize: 18,
      align: 'left', lineHeight: 1.6, readingMode: 'scroll', lang: 'en',
      longPressMs: 500,
      glossOn: true, glossSize: 55, glossColor: 'amber', lookColor: 'blue', vocabColor: 'amber',
      newPerSession: 10, studyLang: '', nativeLang: '',
      hlVocab: true, hlLook: true, keepAwake: true, keepAlive: false, floatApps: false, immersiveInstall: false
    },
    openBookId: null,
    lastBookId: null,
    pendingProgress: null,
    saveTimer: null,
    currentLangCode: 'en',
    chrome: false, chromeTimer: null,
    selection: null,
    marks: { vocab: new Map(), looked: new Set() },
    dictBookId: null,
    // quiz
    cardFront: DEFAULT_FRONT.slice(),
    cardBack: DEFAULT_BACK.slice(),
    wordSortKey: 'createdAt', // 'createdAt' | 'foreign'
    wordSortDir: -1,
    quiz: {
      words: [], booksList: [], counts: {},
      books: new Set(),        // selected book keys (0 = words without a book)
      knownBooks: new Set(),
      checked: new Set(),      // checked word ids
      knownWords: new Set()
    },
    srs: null, srsWrites: Promise.resolve(),
    sheet: null, langEdit: null, dictWorker: null
  };

  window.__closeWordModal = function () { var m = document.getElementById('wordModal'); if (m) m.hidden = true; };
  window.__closeLangModal = function () { cancelDictImport(); var m = document.getElementById('langModal'); if (m) m.hidden = true; state.langEdit = null; };

  // ===================== BOOT =====================
  function boot() {
    if (typeof Dexie === 'undefined') {
      console.error('[boot] Dexie not loaded');
      var ab = document.getElementById('addBookBtn');
      if (ab) ab.disabled = true;
      return;
    }
    I18N.set('en'); // English by default; a language picked in Settings is restored below

    bindTabs();
    bindLibrary();
    bindReader();
    bindQuiz();
    bindSettings();
    bindWordModal();
    bindLangModal();
    bindDictSheet();
    bindBookLang();
    bindOffline();
    bindDictionaryView();
    bindSettingsEvents();
    bindDisplaySettings();
    bindBackup();
    CustomSelect.enhanceAll();                 // themed dropdowns instead of the platform pickers
    bindLifecycle();
    Display.bind();

    applyTheme(state.settings.theme);
    applyFontSettings();

    var KEYS = [
      ['theme', 'light'], ['accent', '#1a73e8'], ['fontSize', 18], ['align', 'left'], ['lineHeight', 1.6],
      ['readingMode', 'scroll'], ['lang', 'en'], ['viewMode', 'large'], ['sortKey', 'addedAt'], ['sortDir', -1],
      ['longPressMs', 500], ['menuTapMode', 'center'], ['cardFront', DEFAULT_FRONT], ['cardBack', DEFAULT_BACK],
      ['wordSortKey', 'createdAt'], ['wordSortDir', -1],
      ['glossOn', true], ['glossSize', 55], ['glossColor', 'amber'], ['lookColor', 'blue'], ['vocabColor', 'amber'],
      ['newPerSession', 10], ['studyLang', ''], ['nativeLang', ''],
      ['hlVocab', true], ['hlLook', true], ['keepAwake', true], ['keepAlive', false], ['floatApps', false], ['immersiveInstall', false],
      ['lastOpenBookId', null]
    ];

    Promise.all(KEYS.map(function (k) { return getSetting(k[0], k[1]); })).then(function (arr) {
      var s = {};
      KEYS.forEach(function (k, i) { s[k[0]] = arr[i]; });
      state.settings.theme = s.theme;
      state.settings.accent = s.accent;
      state.settings.fontSize = Number(s.fontSize) || 18;
      state.settings.align = s.align;
      state.settings.lineHeight = Number(s.lineHeight) || 1.6;
      state.settings.readingMode = s.readingMode;
      state.settings.lang = s.lang || 'en';
      state.settings.longPressMs = Number(s.longPressMs) || 500;
      state.settings.menuTapMode = s.menuTapMode === 'edges' ? 'edges' : 'center';
      var menuTapControl = $('menuTapMode'); if (menuTapControl) menuTapControl.value = state.settings.menuTapMode;
      state.settings.glossOn = s.glossOn !== false;
      state.settings.glossSize = clampNum(s.glossSize, 30, 100, 55);
      state.settings.glossColor = paletteHas(GLOSS_COLORS, s.glossColor) ? s.glossColor : 'amber';
      state.settings.lookColor = paletteHas(HILITE_COLORS, s.lookColor) ? s.lookColor : 'blue';
      state.settings.vocabColor = paletteHas(HILITE_COLORS, s.vocabColor) ? s.vocabColor : 'amber';
      state.settings.newPerSession = clampNum(s.newPerSession, 0, 200, 10);
      ['hlVocab', 'hlLook', 'keepAwake'].forEach(function (k) { state.settings[k] = s[k] !== false; });
      ['keepAlive', 'floatApps', 'immersiveInstall'].forEach(function (k) { state.settings[k] = s[k] === true; });
      state.lastOpenBookId = s.lastOpenBookId != null ? Number(s.lastOpenBookId) : null;
      state.settings.studyLang = String(s.studyLang || '');
      state.settings.nativeLang = String(s.nativeLang || '') || state.settings.lang;     // default: the interface language
      if (!s.nativeLang) setSetting('nativeLang', state.settings.nativeLang);
      state.viewMode = s.viewMode === 'list' ? 'list' : 'large'; // the old "small" grid no longer exists
      state.sortKey = s.sortKey === 'title' ? 'title' : 'addedAt';
      state.sortDir = Number(s.sortDir) === 1 ? 1 : -1;
      state.cardFront = cleanFields(s.cardFront, DEFAULT_FRONT);
      state.cardBack = cleanFields(s.cardBack, DEFAULT_BACK);
      state.wordSortKey = s.wordSortKey === 'foreign' ? 'foreign' : 'createdAt';
      state.wordSortDir = Number(s.wordSortDir) === 1 ? 1 : -1;

      Reader.setLongPressDuration(state.settings.longPressMs);
      I18N.set(state.settings.lang);
      applyTheme(state.settings.theme);
      applyFontSettings();
      applyMarkStyles();
      applySystem();
      applyViewMode(state.viewMode);
      renderLangSelect();
      renderNativeSelect();
      renderSettingsControls();
      applyReadingMode();
      updateSortUI();
      updateWordSortUI();
      renderSides();
      return Display.load();
    }).catch(function (e) { console.error('[settings]', e); }).then(function () {
      refreshLibrary();
      refreshWords();
      refreshLanguages();
      // "Keep alive": if the system closed the app while a book was open, come back to that book at its saved position
      if (state.settings.keepAlive && state.lastOpenBookId) {
        getBook(state.lastOpenBookId).then(function (b) { if (b) openReader(b.id); }).catch(function () {});
      }
    });

    enforcePersistentStorage().then(refreshStorageInfo).catch(function () {});
    registerServiceWorker();
    setTimeout(function () { refreshOfflineStatus(true); }, 3000);    // finish caching optional files in the background

    var addBtn = document.getElementById('addBookBtn');
    if (addBtn) addBtn.disabled = false;

    showTab('library');
  }

  /** Offline-first: registers the service worker and asks before switching to a new version (never mid-session). */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller, reloading = false;
    function offer(w) {
      UI.confirm(I18N.t('updateReady'), { ok: I18N.t('reload'), title: I18N.t('updateTitle') }).then(function (y) {
        if (y) w.postMessage({ type: 'SKIP_WAITING' });
      });
    }
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (w) w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
    }).catch(function (e) { console.warn('[sw] registration failed', e); });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;   // first install: nothing to reload
      reloading = true; location.reload();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  function cleanFields(arr, def) {
    var ids = FIELDS.map(function (f) { return f.id; });
    var out = Array.isArray(arr) ? arr.filter(function (x) { return ids.indexOf(x) > -1; }) : [];
    return out.length ? out : def.slice();
  }

  // ===================== LIFECYCLE (reading position is never lost) =====================
  function bindLifecycle() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushProgress();
    });
    window.addEventListener('pagehide', flushProgress);
    document.addEventListener('freeze', flushProgress);        // Chrome freezes a backgrounded page without any further event
  }

  /** Writes the latest reading position to IndexedDB immediately (cancels the debounce timer). */
  function flushProgress() {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    if (state.openBookId) {
      var snap = Reader.snapshot();                         // exact scroll anchor / CFI right now (null while the book is still loading)
      if (snap) state.pendingProgress = Object.assign({}, state.pendingProgress || {}, snap);
      if (state.pendingProgress) saveProgress(state.openBookId, state.pendingProgress).catch(function () {});
    }
  }

  // ===================== THEME / FONT =====================
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('.chip[data-theme]').forEach(function (b) {
      b.classList.toggle('chip-active', b.getAttribute('data-theme') === t);
    });
    applyMarkStyles();
    updateThemeColor();
  }

  /** Status / navigation bars take the colour of the page (never the icon colour), so they follow light / dark / sepia / AMOLED. */
  function updateThemeColor() {
    var bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '').trim() || '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) { m.setAttribute('content', bg); });
    document.documentElement.style.colorScheme = isDarkTheme() ? 'dark' : 'light';
  }

  /** Wake lock, background lock, floating external windows, launch mode of the installed app. */
  function applySystem() {
    var st = state.settings;
    Power.configure({ keepAwake: st.keepAwake, keepAlive: st.keepAlive });
    ExtLinks.setFloating(st.floatApps);
    var ml = $('manifestLink'); if (ml) ml.setAttribute('href', st.immersiveInstall ? 'manifest-fullscreen.json' : 'manifest.json');
    var ps = Power.status(), hint = [];
    if (!ps.wakeSupported) hint.push(I18N.t('noWakeLock'));
    if (!ps.locksSupported) hint.push(I18N.t('noWebLocks'));
    var h = $('powerHint'); if (h) h.textContent = hint.join(' ');
  }
  function applyFontSettings() {
    document.documentElement.style.setProperty('--font-size', state.settings.fontSize + 'px');
    document.documentElement.style.setProperty('--line-height', state.settings.lineHeight);
    document.documentElement.style.setProperty('--text-align', state.settings.align);
    var fsVal = document.getElementById('fsVal');
    if (fsVal) fsVal.textContent = state.settings.fontSize;
    var al = document.getElementById('setAlign');
    if (al) al.value = state.settings.align;
    var lh = document.getElementById('setLineHeight');
    if (lh) lh.value = state.settings.lineHeight;
    var lhVal = document.getElementById('lhVal');
    if (lhVal) lhVal.textContent = Number(state.settings.lineHeight).toFixed(1);
    var lp = document.getElementById('setLongPress');
    var menuTap = document.getElementById('menuTapMode');
    if (menuTap) { menuTap.value = state.settings.menuTapMode || 'center'; menuTap.addEventListener('change', function () { state.settings.menuTapMode = this.value === 'edges' ? 'edges' : 'center'; setSetting('menuTapMode', state.settings.menuTapMode); }); }
    if (lp) lp.value = state.settings.longPressMs;
    var lpVal = document.getElementById('lpVal');
    if (lpVal) lpVal.textContent = state.settings.longPressMs;
    Reader.updateStyles();
  }

  // ===================== TABS =====================
  function bindTabs() {
    document.querySelectorAll('.nb').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showTab(this.getAttribute('data-tab'));
      });
    });
  }

  function showTab(name) {
    if (state.tab === 'read' && name !== 'read') flushProgress();
    state.tab = name;
    ['library', 'read', 'quiz', 'settings', 'dict'].forEach(function (t) {
      var el = document.getElementById('tab-' + t);
      if (el) el.hidden = t !== name;
    });
    document.querySelectorAll('.nb').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.body.setAttribute('data-active-tab', name);
    if (name === 'read' && state.openBookId) Display.enterReader(false); else Display.leaveReader();
    updateImmersive();
    Power.setReading(name === 'read' && !!state.openBookId);
    if (name !== 'read') { Reader.clearSelection(); closeDictSheet(); }
    if (name !== 'quiz') { var bm = $('bookMenu'); if (bm) bm.hidden = true; }
    if (name === 'library') refreshLibrary();
    if (name === 'quiz') refreshWords();
    if (name === 'settings') { refreshLanguages(); refreshStorageInfo(); refreshOfflineStatus(false); }
  }

  // ===================== LIBRARY =====================
  function bindLibrary() {
    var addBtn = document.getElementById('addBookBtn');
    var fileInput = document.getElementById('fileInput');
    if (addBtn) addBtn.addEventListener('click', function () { fileInput.click(); });

    /** Generates and stores a cover for one imported book (best effort, never throws). */
    function makeCover(id) {
      return Promise.all([getBook(id), getBookFile(id)]).then(function (r) {
        return r[0] && r[1] ? Reader.generateCoverForBook(id, r[0].format, r[1].data) : null;
      }).catch(function () {});
    }

    if (fileInput) fileInput.addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      var ok = files.filter(function (f) { return ['pdf', 'epub', 'fb2', 'txt'].indexOf(f.name.split('.').pop().toLowerCase()) > -1; });
      e.target.value = '';
      if (!files.length) return;
      if (!ok.length) { UI.toast(I18N.t('unsupportedFile'), 'warn'); return; }
      Promise.all(ok.map(saveBook)).then(function (ids) {
        refreshLibrary();
        showTab('library');
        return ids.reduce(function (p, id) { return p.then(function () { return makeCover(id); }); }, Promise.resolve()).then(refreshLibrary);
      }).catch(function (err) { UI.toast(I18N.t('importError') + ': ' + err.message, 'error'); });
    });

    document.querySelectorAll('.vt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = this.getAttribute('data-view');
        state.viewMode = v;
        applyViewMode(v);
        setSetting('viewMode', v);
      });
    });

    document.querySelectorAll('.ftab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.filter = this.getAttribute('data-filter');
        document.querySelectorAll('.ftab').forEach(function (b) {
          b.classList.toggle('ftab-active', b.getAttribute('data-filter') === state.filter);
        });
        refreshLibrary();
      });
    });

    // Two independent toggles inside one button: the arrow flips the order, the label flips the type
    var sortBtn = document.getElementById('sortBtn');
    if (sortBtn) sortBtn.addEventListener('click', function (e) {
      if (e.target.closest('#sortDir')) {
        state.sortDir = -state.sortDir;
        setSetting('sortDir', state.sortDir);
      } else {
        state.sortKey = state.sortKey === 'addedAt' ? 'title' : 'addedAt';
        setSetting('sortKey', state.sortKey);
      }
      updateSortUI();
      refreshLibrary();
    });
  }

  function updateSortUI() {
    var label = document.getElementById('sortLabel');
    var dir = document.getElementById('sortDir');
    if (!label || !dir) return;
    label.textContent = state.sortKey === 'title' ? 'Title' : 'Added';
    dir.textContent = state.sortDir === -1 ? '↓' : '↑';
  }

  function applyViewMode(mode) {
    var grid = document.getElementById('booksGrid');
    if (!grid) return;
    grid.classList.remove('grid-large', 'grid-list');
    grid.classList.add('grid-' + mode);
    document.querySelectorAll('.vt-btn').forEach(function (b) {
      b.classList.toggle('vt-active', b.getAttribute('data-view') === mode);
    });
  }

  function refreshLibrary() {
    return listBooks().then(function (books) {
      var filtered = books.filter(function (b) {
        return state.filter === 'fav' ? !!b.favorite : true;
      });
      filtered.sort(function (a, b) {
        var r;
        if (state.sortKey === 'title') {
          r = String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true });
        } else {
          r = (a.addedAt || 0) - (b.addedAt || 0);
        }
        return r * state.sortDir;
      });

      var grid = document.getElementById('booksGrid');
      var empty = document.getElementById('emptyLib');
      if (!grid) return;
      grid.innerHTML = '';
      if (empty) empty.hidden = filtered.length > 0;

      filtered.forEach(function (b) { grid.appendChild(buildBookTile(b)); });
    });
  }

  function buildBookTile(b) {
    var tile = document.createElement('div');
    tile.className = 'tile';

    var coverInner;
    if (b.cover) {
      coverInner = '<div class="cover"><img src="' + b.cover + '" alt=""></div>';
    } else {
      coverInner = '<div class="cover cover-gen" style="--gen:' + colorFromTitle(b.title) + ';background:' + colorFromTitle(b.title) + '">' +
        '<span class="cover-gen-initial">' + esc((b.title || '?').charAt(0).toUpperCase()) + '</span>' +
        '<span class="cover-gen-fmt">' + (b.format || '').toUpperCase() + '</span></div>';
    }

    var favIcon = b.favorite
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

    tile.innerHTML =
      coverInner +
      '<span class="tname">' + esc(b.title) + '</span>' +
      '<span class="tmeta">' + (b.format || '').toUpperCase() + '</span>' +
      '<div class="tile-actions">' +
        '<button class="tact" data-act="words" title="Words">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' +
        '</button>' +
        '<button class="tact' + (b.favorite ? ' tact-active' : '') + '" data-act="fav" title="Favorite">' + favIcon + '</button>' +
        '<button class="tact tact-danger" data-act="del" title="Delete">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
        '</button>' +
      '</div>';

    tile.querySelector('.cover').addEventListener('click', function () { openReader(b.id); });
    tile.querySelector('.tname').addEventListener('click', function () { openReader(b.id); });

    tile.querySelector('[data-act="words"]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      openDictionaryView(b.id);
    });
    tile.querySelector('[data-act="fav"]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      setBookFavorite(b.id, !b.favorite).then(refreshLibrary);
    });
    tile.querySelector('[data-act="del"]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      UI.confirm(tf('deleteBookQ', b.title), { danger: true, ok: I18N.t('delete') }).then(function (y) {
        if (y) deleteBook(b.id).then(refreshLibrary);
      });
    });

    return tile;
  }

  function colorFromTitle(str) {
    str = String(str || '');
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ',55%,60%)';
  }

  // ===================== READER =====================
  function bindReader() {
    var back = $('backBtn'), pop = $('selPopup');

    if (back) back.addEventListener('click', function () { closeReader(); showTab('library'); });
    window.addEventListener('popstate', function (e) {
      if (state.openBookId) { closeReader(); showTab('library'); }
    });
    var qb = $('qbarBtn'); if (qb) qb.addEventListener('click', function () { setQbar($('qbarPanel').hidden); });
    if ($('errBackBtn')) $('errBackBtn').addEventListener('click', function () { closeReader(); showTab('library'); });
    if ($('retryBtn')) $('retryBtn').addEventListener('click', function () { if (state.openBookId) openReader(state.openBookId); });
    Bookmarks.init({ bookId: function () { return state.openBookId; }, pending: function () { return state.pendingProgress; } });

    /** Places the popup above the selection (flips below when there is no room) and clamps it inside the viewport. */
    function place(r) {
      pop.style.visibility = 'hidden';
      pop.hidden = false;
      var w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
      var top = r.top - h - 10;
      if (top < m + 48) top = r.bottom + 14;
      pop.style.left = Math.max(m, Math.min(window.innerWidth - w - m, r.x - w / 2)) + 'px';
      pop.style.top = Math.max(m, Math.min(window.innerHeight - h - m, top)) + 'px';
      pop.style.visibility = '';
    }

    // Reader -> UI: one popup, repositioned on every new selection, hidden on every clear
    Reader.onSelection(function (info) { state.selection = info; place(info.rect); });
    Reader.onClear(function () { pop.hidden = true; });
    // ReadEra style: bars are hidden while reading; tapping the very top / bottom edge brings them back,
    // tapping the middle of the page hides them again.
    Reader.onBlankTap(function (pt) {
      if (!$('qbarPanel').hidden) { setQbar(false); return; }   // first tap just collapses the display bar
      var zone = Reader.EDGE;
      var edgeMode = state.settings.menuTapMode === 'edges';
      var inEdge = pt && (pt.y <= zone || pt.y >= window.innerHeight - zone);
      var inCenter = pt && pt.y > window.innerHeight * 0.30 && pt.y < window.innerHeight * 0.70;
      if ((edgeMode && inEdge) || (!edgeMode && inCenter)) setChrome(!state.chrome);

    });

    if (pop) {
      pop.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // keep selection alive until the click
      pop.addEventListener('click', function (e) {
        var btn = e.target.closest('.sel-btn');
        if (!btn) return;
        var s = state.selection;
        Reader.clearSelection();
        handleSelectionAction(btn.getAttribute('data-action'), s);
      });
    }
    // Outside press (toolbar, nav, anywhere but the reader body / popup) and Esc / resize dismiss the popup
    document.addEventListener('pointerdown', function (e) {
      if (!pop || pop.hidden || pop.contains(e.target) || e.target.closest('#rbody, .sel-handle')) return;     // the selection handles belong to the selection
      Reader.clearSelection();
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') Reader.clearSelection(); });
    window.addEventListener('resize', function () { Reader.clearSelection(); });
  }

  /** Copies text to the clipboard (Clipboard API with a textarea fallback). */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy')); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /**
   * Remembers a word that was looked up (not added) and highlights it right away.
   * Only single words are tracked, because marks are applied per word.
   */
  function trackLookup(sel) {
    if (!state.openBookId || !sel || !sel.text || /\s/.test(sel.text)) return;
    var k = Reader.markKey(sel.text);
    if (!k || state.marks.vocab.has(k) || state.marks.looked.has(k)) return;
    state.marks.looked.add(k);
    addLookup(state.openBookId, k).catch(function () {});
    Reader.refreshMarks();
  }

  function languageEnglishName(code) { return languageName(code); }

  /** Opens an external dictionary / translator (native app or web, see extlinks.js) for the selection. */
  function openExternal(kind, sel) {
    var lang = state.currentLangCode || 'en', to = nativeCode();
    if (kind === 'translator' && lang === to) {           // e.g. English → English: tell the user how to fix it instead of opening a useless page
      UI.toast(tf('sameLang', languageName(lang)), 'warn', 7000);
      return;
    }
    trackLookup(sel);
    flushProgress();                                      // leaving the app for a translator: the reading position is saved first
    Promise.all([getLanguage(lang), listLanguages()]).then(function (r) {
      var cfgOf = function (l) { return l && (kind === 'dict' ? (l.extDict || l.externalDict) : (l.extTrans || l.externalTranslator)); };
      var has = function (c) { return c && (typeof c === 'string' ? c : c.preset); };
      var cfg = cfgOf(r[0]);
      // the book's language has no app/service of its own: use the one chosen for any other language (source/target still come from the book)
      if (!has(cfg)) { var other = r[1].filter(function (l) { return has(cfgOf(l)); })[0]; cfg = cfgOf(other); }
      var r = ExtLinks.build(kind === 'dict' ? 'dict' : 'translator', cfg, {
        word: sel.text, from: lang, to: to, nameOf: languageEnglishName
      });
      if (r.error === 'unsupported') { UI.toast(I18N.t('platformUnsupported'), 'warn'); return; }
      if (r.error) { UI.toast(I18N.t('notConfigured'), 'warn'); return; }
      ExtLinks.open(r.url, r.fallback);
    });
  }

  function handleSelectionAction(action, sel) {
    if (!sel) return;
    if (action === 'internal') openDictSheet(sel);
    else if (action === 'external') openExternal('dict', sel);
    else if (action === 'translator') openExternal('translator', sel);
    else if (action === 'add') openWordModal(sel.text, sel.context, state.openBookId);
    else if (action === 'copy') {
      copyText(sel.text).then(function () { UI.toast(I18N.t('copied'), 'success', 1800); })
        .catch(function () { UI.toast(I18N.t('copyFailed'), 'error'); });
    } else if (action === 'share') {
      if (!navigator.share) { UI.toast(I18N.t('shareNA'), 'warn'); return; }
      navigator.share({ text: sel.text }).catch(function (e) {
        if (e && e.name !== 'AbortError') UI.toast(I18N.t('errorGeneric') + ': ' + e.message, 'error');
      });
    }
  }

  // ===================== LOCAL DICTIONARY BOTTOM SHEET =====================
  function bindDictSheet() {
    var sheet = $('dictSheet'); if (!sheet) return;
    $('dsBackdrop').addEventListener('click', closeDictSheet);
    $('dsClose').addEventListener('click', closeDictSheet);
    $('dsAdd').addEventListener('click', function () {
      var sh = state.sheet; if (!sh) return;
      closeDictSheet();
      // the "New word" form opens with the translation already filled in from the dictionary entry
      openWordModal(sh.text, sh.context, state.openBookId, { translation: sh.gloss || '', transcription: sh.ipa || '', example: sh.example || '' });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closeDictSheet(); });
    // swipe the grab handle / header down to dismiss
    var y0 = null, panel = $('dsPanel');
    ['dsGrab'].forEach(function (id) {
      var g = $(id);
      g.addEventListener('pointerdown', function (e) { y0 = e.clientY; g.setPointerCapture(e.pointerId); });
      g.addEventListener('pointermove', function (e) { if (y0 != null) panel.style.transform = 'translateY(' + Math.max(0, e.clientY - y0) + 'px)'; });
      g.addEventListener('pointerup', function (e) {
        var dy = y0 == null ? 0 : e.clientY - y0; y0 = null; panel.style.transform = '';
        if (dy > 70) closeDictSheet();
      });
    });
  }

  function closeDictSheet() {
    var sheet = $('dictSheet'); if (!sheet || sheet.hidden) return;
    sheet.hidden = true; state.sheet = null;
  }

  function openDictSheet(sel) {
    var lang = state.currentLangCode || 'en', token = {};
    trackLookup(sel);
    document.querySelectorAll('.toast').forEach(function (t) { t.remove(); });   // never let a toast cover the sheet
    state.sheet = { text: sel.text, context: sel.context, gloss: '', token: token };
    $('dsWord').textContent = sel.text;
    $('dsIpa').textContent = '';
    $('dsBody').textContent = '…';
    $('dictSheet').hidden = false;
    var panel = $('dsPanel'); panel.style.transform = '';
    Promise.all([lookupEntries(lang, sel.text, nativeCode()), getDictionaryMeta(lang)]).then(function (r) {
      if (!state.sheet || state.sheet.token !== token) return;        // closed / replaced meanwhile
      var res = r[0], body = $('dsBody'); body.textContent = '';
      if (!res) {
        var m = document.createElement('div'); m.className = 'ds-empty';
        m.textContent = r[1] ? I18N.t('notFoundDict') : I18N.t('noDictionary');
        body.appendChild(m); return;
      }
      var first = res.entries.filter(function (e) { return e[1]; })[0];
      var ex = res.entries.filter(function (e) { return e[3]; })[0];
      // two separate pieces of data: the translation and the transcription (each goes into its own field of "New word")
      state.sheet.gloss = DictCore.shortGloss(res.entries);
      state.sheet.ipa = first ? first[1] : '';
      state.sheet.example = ex ? ex[3] : '';
      $('dsIpa').textContent = state.sheet.ipa;
      res.entries.forEach(function (e, i) {
        var blk = document.createElement('div'); blk.className = 'ds-entry';
        if (res.entries.length > 1 || DictCore.norm(e[0]).key !== DictCore.norm(sel.text).key) {
          var h = document.createElement('div'); h.className = 'ds-head'; h.textContent = e[0] + (i && e[1] ? '  ' + e[1] : '');
          blk.appendChild(h);
        }
        String(e[2] || '').split('\n').forEach(function (line) {
          if (!line.trim()) return;
          var d = document.createElement('div'); d.className = 'ds-def'; d.textContent = line; blk.appendChild(d);
        });
        if (e[3]) { var xs = document.createElement('div'); xs.className = 'ds-example'; xs.textContent = e[3]; blk.appendChild(xs); }
        body.appendChild(blk);
      });
    }).catch(function (err) {
      if (state.sheet && state.sheet.token === token) $('dsBody').textContent = I18N.t('errorGeneric') + ': ' + err.message;
    });
  }

  /** Loads the vocabulary + look-ups of a book and hands them to the reader for highlighting. */
  function loadMarks(bookId) {
    return Promise.all([listWordsForBook(bookId), listLookups(bookId)]).then(function (r) {
      var vocab = new Map(), looked = new Set();
      r[0].forEach(function (w) {
        var k = Reader.markKey(w.foreign);
        if (!k || /\s/.test(k)) return; // phrases are not highlighted
        vocab.set(k, w.translation && w.translation !== '-' ? w.translation : '');
      });
      r[1].forEach(function (l) { looked.add(l.word); });
      state.marks = { vocab: vocab, looked: looked };
      Reader.setMarks(state.marks);
    });
  }

  /** Re-reads marks for the open book and repaints the text (after a word was added / deleted). */
  function syncMarks() {
    if (!state.openBookId) return;
    loadMarks(state.openBookId).then(function () { Reader.refreshMarks(); }).catch(function () {});
  }

  /** Shows exactly one of: loading spinner / error fallback / the book. */
  function setReaderState(st, msg) {
    $('readerLoading').hidden = st !== 'loading';
    $('readerError').hidden = st !== 'error';
    if (st === 'error') { $('readerErrorMsg').textContent = msg || ''; state.chrome = true; updateImmersive(); }
  }

  function openReader(bookId) {
    var id = Number(bookId);
    if (!state.openBookId) { try { history.pushState({ readligeroReader: true }, ''); } catch (e) {} }
    state.openBookId = id;
    state.lastBookId = id; state.lastOpenBookId = id; setSetting('lastOpenBookId', id);
    state.pendingProgress = null;
    $('noOpenBook').hidden = true;
    $('readerRoot').hidden = false;
    state.chrome = false; clearTimeout(state.chromeTimer);
    showTab('read');
    Display.enterReader(true);                       // a book was opened by a tap: (re-)apply the saved fullscreen + orientation
    setReaderState('loading');

    var engineTimeout = new Promise(function (_, rej) {
      setTimeout(function () {
        rej(new Error('Reader engine timeout — check that pdf.min.js / epub.min.js / jszip.min.js exist.'));
      }, 20000);
    });

    var opening = loadMarks(id).catch(function () {}).then(function () {
      return Reader.open(id, function (p) {
        state.pendingProgress = Object.assign({}, state.pendingProgress || {}, p);
        var prog = $('rprog');
        if (prog) prog.style.width = Math.round((state.pendingProgress.percentage || 0) * 100) + '%';
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () {
          state.saveTimer = null;
          saveProgress(state.openBookId, state.pendingProgress).catch(function () {});
        }, 400);
      }, function (book) {
        $('rtitle').textContent = book.title;
        applyBookLang(book);
      });
    });

    Promise.race([opening, engineTimeout]).then(function () {
      if (state.openBookId === id) setReaderState('ok');
    }).catch(function (err) {
      console.error('[reader]', err);
      if (state.openBookId !== id) return;
      setReaderState('error', err && err.message);
      UI.toast(I18N.t('openError'), 'error');
    });
  }

  function closeReader() {
    flushProgress();
    Reader.close();
    setReaderState('ok');
    setQbar(false);
    closeDictSheet();
    state.openBookId = null;
    state.pendingProgress = null;
    updateImmersive();
    document.getElementById('readerRoot').hidden = true;
    document.getElementById('noOpenBook').hidden = false;
    Power.setReading(false);
    state.lastOpenBookId = null; setSetting('lastOpenBookId', null);      // closed on purpose: do not restore it
    Display.leaveReader();
    refreshLibrary();
  }

  // ===================== READER CHROME (auto-hide) =====================
  function updateImmersive() {
    var on = document.body.getAttribute('data-active-tab') === 'read' && !!state.openBookId && !state.chrome;
    document.body.classList.toggle('reader-immersive', on);
  }

  /** Shows / hides the top bar and the tab bar. Shown bars hide again by themselves after 5 s (unless the display bar is open). */
  function setChrome(visible) {
    state.chrome = !!visible;
    clearTimeout(state.chromeTimer);
    updateImmersive();
    if (visible && $('qbarPanel').hidden) {
      state.chromeTimer = setTimeout(function () {
        if (!$('qbarPanel').hidden) return;
        state.chrome = false; updateImmersive();
      }, 5000);
    }
  }

  /** Collapsible display bar (ReadEra-style): opened from the toolbar button; sits above the tab bar. */
  function setQbar(open) {
    var panel = $('qbarPanel'); if (!panel) return;
    panel.hidden = !open;
    $('qbar').setAttribute('data-open', String(!!open));
    var b = $('qbarBtn'); if (b) b.setAttribute('aria-expanded', String(!!open));
    if (open) { state.chrome = true; clearTimeout(state.chromeTimer); updateImmersive(); }
    else setChrome(true);
  }

  // ===================== LANGUAGES OF A BOOK =====================
  function nativeCode() { return state.settings.nativeLang || state.settings.lang || 'en'; }

  /** Source language of a book: its own setting, else the default chosen in Settings, else the first configured language. */
  function bookLangFor(book, langs) {
    if (book && book.langCode) return book.langCode;
    var want = state.settings.studyLang;
    if (want && langs.some(function (l) { return l.code === want; })) return want;
    return langs.length ? langs[0].code : 'en';
  }

  function applyBookLang(book) {
    return Promise.all([listLanguages(), db.dictionaries.toArray()]).then(function (r) {
      state.currentLangCode = bookLangFor(book, r[0]);
      Reader.setLanguage(state.currentLangCode);          // word boundaries for zh / ja / th …
      fillBookLang(r[1]);
    }).catch(function () { state.currentLangCode = 'en'; });
  }

  /** Re-evaluates the language of the open book (e.g. after the languages list changed). */
  function resolveStudyLang() {
    return (state.openBookId ? getBook(state.openBookId) : Promise.resolve(null)).then(applyBookLang);
  }

  function fillBookLang(dicts) {
    var sel = $('bookLang'); if (!sel) return;
    var have = {}; (dicts || []).forEach(function (d) { have[d.langCode] = 1; });
    sel.textContent = '';
    LANGUAGES.forEach(function (l) {
      var o = document.createElement('option'); o.value = l[0];
      o.textContent = l[1] + ' (' + l[0] + ')' + (have[l[0]] ? ' ✓' : '');
      sel.appendChild(o);
    });
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === state.currentLangCode; })) {
      var x = document.createElement('option'); x.value = x.textContent = state.currentLangCode; sel.appendChild(x);
    }
    sel.value = state.currentLangCode;
  }

  function bindBookLang() {
    var sel = $('bookLang'); if (!sel) return;
    sel.addEventListener('change', function () {
      state.currentLangCode = sel.value;                       // dictionary + translation pair follow at once
      Reader.setLanguage(sel.value); Reader.refreshMarks();
      if (state.openBookId) db.books.update(Number(state.openBookId), { langCode: sel.value }).catch(function () {});
    });
  }

  function renderNativeSelect() {
    var sel = $('setNative'); if (!sel) return;
    sel.textContent = '';
    LANGUAGES.forEach(function (l) {
      var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1] + ' (' + l[0] + ')'; sel.appendChild(o);
    });
    sel.value = nativeCode();
  }

  // ===================== OFFLINE STATUS =====================
  function swMessage(type) {
    return navigator.serviceWorker.ready.then(function (reg) {
      return new Promise(function (resolve) {
        if (!reg.active) { resolve(null); return; }
        var ch = new MessageChannel();
        ch.port1.onmessage = function (e) { resolve(e.data); };
        reg.active.postMessage({ type: type }, [ch.port2]);
      });
    });
  }

  /** Shows whether the app is fully cached for offline use; fill=true also downloads whatever is still missing. */
  function refreshOfflineStatus(fill) {
    var el = $('offlineStatus'); if (!el) return;
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { el.textContent = I18N.t('offlineNoSW'); return; }
    el.textContent = '…';
    var timeout = new Promise(function (r) { setTimeout(function () { r(null); }, fill ? 90000 : 8000); });
    Promise.race([swMessage(fill ? 'FILL' : 'STATUS'), timeout]).then(function (st) {
      if (!st) { el.textContent = I18N.t('offlineNotReady'); return; }
      el.textContent = st.ready ? tf('offlineReady', st.cached, st.total) : tf('offlineMissing', st.coreMissing);
    }).catch(function () { el.textContent = I18N.t('offlineNotReady'); });
  }

  function bindOffline() {
    var b = $('offlineBtn'); if (b) b.addEventListener('click', function () { refreshOfflineStatus(true); });
  }

  // ===================== SETTINGS =====================
  function bindSettings() {
    document.querySelectorAll('.chip[data-theme]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = this.getAttribute('data-theme');
        state.settings.theme = t;
        applyTheme(t);
        setSetting('theme', t);
      });
    });
    document.querySelectorAll('.chip[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = this.getAttribute('data-mode');
        state.settings.readingMode = m;
        document.querySelectorAll('.chip[data-mode]').forEach(function (x) {
          x.classList.toggle('chip-active', x.getAttribute('data-mode') === m);
        });
        setSetting('readingMode', m);
        applyReadingMode();
      });
    });
  }

  function bindSettingsEvents() {
    var fsMinus = document.getElementById('fsMinus');
    var fsPlus = document.getElementById('fsPlus');
    var align = document.getElementById('setAlign');
    var lh = document.getElementById('setLineHeight');
    var langSel = document.getElementById('setLang');
    var lp = document.getElementById('setLongPress');
    var menuTap = document.getElementById('menuTapMode');
    if (menuTap) { menuTap.value = state.settings.menuTapMode || 'center'; menuTap.addEventListener('change', function () { state.settings.menuTapMode = this.value === 'edges' ? 'edges' : 'center'; setSetting('menuTapMode', state.settings.menuTapMode); }); }

    if (fsMinus) fsMinus.addEventListener('click', function () {
      state.settings.fontSize = Math.max(12, state.settings.fontSize - 1);
      applyFontSettings(); setSetting('fontSize', state.settings.fontSize);
    });
    if (fsPlus) fsPlus.addEventListener('click', function () {
      state.settings.fontSize = Math.min(32, state.settings.fontSize + 1);
      applyFontSettings(); setSetting('fontSize', state.settings.fontSize);
    });
    if (align) align.addEventListener('change', function () {
      state.settings.align = this.value;
      applyFontSettings(); setSetting('align', this.value);
    });
    if (lh) lh.addEventListener('input', function () {
      state.settings.lineHeight = Number(this.value);
      applyFontSettings(); setSetting('lineHeight', state.settings.lineHeight);
    });
    if (langSel) langSel.addEventListener('change', function () {
      state.settings.lang = this.value;
      I18N.set(this.value);
      setSetting('lang', this.value);
      // re-render dynamic, JS-built UI in the new language
      renderSides(); renderQuizHome(); updateSortUI(); updateWordSortUI(); refreshLanguages(); renderSettingsControls(); refreshStorageInfo();
    });
    if (lp) lp.addEventListener('input', function () {
      state.settings.longPressMs = Number(this.value);
      Reader.setLongPressDuration(state.settings.longPressMs);
      applyFontSettings();
      setSetting('longPressMs', state.settings.longPressMs);
    });

    var addLang = document.getElementById('addLanguageBtn');
    if (addLang) addLang.addEventListener('click', openLangModal);
  }

  function renderLangSelect() {
    var sel = document.getElementById('setLang');
    if (!sel) return;
    sel.innerHTML = '';
    I18N.list().forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = ENDONYMS[code] || code.toUpperCase();   // every language in its own script
      opt.lang = code;
      if (code === state.settings.lang) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function applyReadingMode() {
    var m = state.settings.readingMode;
    document.documentElement.setAttribute('data-reading-mode', m);
    document.querySelectorAll('.chip[data-mode]').forEach(function (b) {
      b.classList.toggle('chip-active', b.getAttribute('data-mode') === m);
    });
    Reader.setReadingMode(m);
  }

  // ===================== SETTINGS: vocabulary highlighting, steppers, switches, display, backup =====================
  function clampNum(v, lo, hi, def) { var n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; }
  function paletteHas(list, id) { return list.some(function (c) { return c.id === id; }); }
  function paletteGet(list, id) { return list.filter(function (c) { return c.id === id; })[0] || list[0]; }
  function isDarkTheme() { return state.settings.theme === 'dark' || state.settings.theme === 'amoled'; }

  /** Pushes the highlight / gloss settings into CSS variables (main document) and into the EPUB frames. */
  function applyMarkStyles() {
    var st = state.settings, dk = isDarkTheme(), r = document.documentElement.style;
    var g = paletteGet(GLOSS_COLORS, st.glossColor), l = paletteGet(HILITE_COLORS, st.lookColor), v = paletteGet(HILITE_COLORS, st.vocabColor);
    r.setProperty('--mk-rt', dk ? g.dark : g.light);
    r.setProperty('--mk-look', dk ? l.dark : l.light);
    r.setProperty('--mk-vocab', dk ? v.dark : v.light);
    r.setProperty('--gloss-size', (st.glossSize / 100) + 'em');
    document.documentElement.classList.toggle('no-gloss', !st.glossOn);
    document.documentElement.classList.toggle('no-hl-vocab', !st.hlVocab);     // two independent highlight switches
    document.documentElement.classList.toggle('no-hl-look', !st.hlLook);
    Reader.updateStyles();
  }

  function setSwitchLabels() {
    var r = document.documentElement.style;
    r.setProperty('--t-on', JSON.stringify(I18N.t('on')));
    r.setProperty('--t-off', JSON.stringify(I18N.t('off')));
  }

  function renderSettingsControls() {
    setSwitchLabels();
    document.querySelectorAll('[data-switch]').forEach(function (el) { el.setAttribute('aria-checked', String(!!state.settings[el.getAttribute('data-switch')])); });
    document.querySelectorAll('[data-stepper]').forEach(function (el) {
      var k = el.getAttribute('data-stepper'), cfg = STEPPERS[k], out = el.querySelector('.stepper-val');
      if (!cfg || !out) return;
      var val = state.settings[k];
      out.textContent = cfg.fmt(val);
      el.querySelector('[data-step="-1"]').disabled = val <= cfg.min;
      el.querySelector('[data-step="1"]').disabled = val >= cfg.max;
    });
    document.querySelectorAll('[data-colorsel]').forEach(buildColorSelect);
    renderQuizHome();
  }

  /** Accessible dropdown with colour swatches (a native <select> cannot show them reliably on mobile). */
  function buildColorSelect(host) {
    var key = host.getAttribute('data-colorsel');
    var palette = key === 'glossColor' ? GLOSS_COLORS : HILITE_COLORS, dk = isDarkTheme();
    var cur = paletteGet(palette, state.settings[key]);
    host.textContent = '';
    var swatch = function (c) {
      var sp = document.createElement('span'); sp.className = 'swatch' + (c.id === 'none' ? ' swatch-none' : '');
      sp.style.background = dk ? c.dark : c.light; if (palette === GLOSS_COLORS) sp.style.borderColor = 'transparent'; return sp;
    };
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'colorsel-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    btn.appendChild(swatch(cur));
    var nm = document.createElement('span'); nm.textContent = I18N.t(cur.name); btn.appendChild(nm);
    var car = document.createElement('span'); car.className = 'colorsel-caret'; car.textContent = '▾'; btn.appendChild(car);
    var list = document.createElement('ul');
    list.className = 'colorsel-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
    palette.forEach(function (c) {
      var li = document.createElement('li'); li.setAttribute('role', 'option'); li.tabIndex = 0;
      li.setAttribute('aria-selected', String(c.id === cur.id));
      li.appendChild(swatch(c));
      var t = document.createElement('span'); t.textContent = I18N.t(c.name); li.appendChild(t);
      var pick = function () {
        state.settings[key] = c.id; setSetting(key, c.id); applyMarkStyles(); buildColorSelect(host);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      list.appendChild(li);
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      document.querySelectorAll('.colorsel-list').forEach(function (l) { if (l !== list) l.hidden = true; });
      list.hidden = !list.hidden; btn.setAttribute('aria-expanded', String(!list.hidden));
    });
    host.appendChild(btn); host.appendChild(list);
  }

  function bindDisplaySettings() {
    var nat = $('setNative');
    if (nat) nat.addEventListener('change', function () { state.settings.nativeLang = nat.value; setSetting('nativeLang', nat.value); });
    var onSwitch = { glossOn: applyMarkStyles, hlVocab: applyMarkStyles, hlLook: applyMarkStyles, keepAwake: applySystem, keepAlive: applySystem, floatApps: applySystem, immersiveInstall: applySystem };
    document.querySelectorAll('[data-switch]').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-switch');
        state.settings[k] = !state.settings[k];
        setSetting(k, state.settings[k]); renderSettingsControls();
        if (onSwitch[k]) onSwitch[k]();
      });
    });
    document.querySelectorAll('[data-stepper]').forEach(function (el) {
      var k = el.getAttribute('data-stepper'), cfg = STEPPERS[k];
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-step]'); if (!b || b.disabled || !cfg) return;
        var v = clampNum(state.settings[k] + cfg.step * Number(b.getAttribute('data-step')), cfg.min, cfg.max, state.settings[k]);
        state.settings[k] = v; setSetting(k, v); renderSettingsControls();
        if (k === 'glossSize') applyMarkStyles();
      });
    });
    document.addEventListener('click', function (e) {         // outside click closes any open color dropdown
      document.querySelectorAll('.colorsel').forEach(function (h) {
        if (h.contains(e.target)) return;
        var l = h.querySelector('.colorsel-list'), b = h.querySelector('.colorsel-btn');
        if (l && !l.hidden) { l.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); }
      });
    });
  }

  // ----- storage + backup -----
  function fmtBytes(n) {
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function refreshStorageInfo() {
    var el = $('persistStatus'), us = $('storageUsage');
    if (el && navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) { el.textContent = p ? I18N.t('persistOn') : I18N.t('persistOff'); });
    } else if (el) el.textContent = I18N.t('persistNA');
    if (us) storageEstimate().then(function (e) { us.textContent = e ? fmtBytes(e.usage) + ' / ' + fmtBytes(e.quota) : '—'; });
  }

  function bindBackup() {
    var pb = $('persistBtn'), eb = $('exportBtn'), ib = $('importBtn'), f = $('importFile');
    if (pb) pb.addEventListener('click', function () {
      enforcePersistentStorage().then(function (r) {
        refreshStorageInfo();
        UI.toast(r.persisted ? I18N.t('persistGranted') : I18N.t('persistDenied'), r.persisted ? 'success' : 'warn', 5000);
      });
    });
    if (eb) eb.addEventListener('click', function () {
      UI.choose(I18N.t('exportBackup'), I18N.t('exportAsk'), [
        { label: I18N.t('cancel'), value: null },
        { label: I18N.t('exportLight'), value: 'light' },
        { label: I18N.t('exportFull'), value: 'full', cls: 'accent' }
      ]).then(function (mode) {
        if (!mode) return;
        var dismiss = UI.toast(I18N.t('working'), 'info', 60000);
        Backup.exportAll({ includeBooks: mode === 'full' }).then(function (blob) {
          dismiss();
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'readligero-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          UI.toast(I18N.t('exportDone'), 'success');
        }).catch(function (err) { dismiss(); UI.toast(I18N.t('errorGeneric') + ': ' + err.message, 'error', 6000); });
      });
    });
    if (ib && f) {
      ib.addEventListener('click', function () { f.click(); });
      f.addEventListener('change', function () {
        var file = f.files && f.files[0]; f.value = '';
        if (!file) return;
        Backup.importFile(file).then(function (r) {
          return UI.alert(tf('importDone', r.words, r.books, r.bookmarks, r.languages)).then(function () { location.reload(); });
        }).catch(function (err) { UI.toast(I18N.t('importError') + ': ' + err.message, 'error', 6000); });
      });
    }
  }

  // ===================== LANGUAGES =====================
  function languageName(code) {
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i][0] === code) return LANGUAGES[i][1];
    return code.toUpperCase();
  }

  function presetLabel(kind, cfg) {
    if (typeof cfg === 'string') return cfg ? I18N.t('customUrl') : '—';
    if (!cfg || !cfg.preset) return '—';
    if (cfg.preset === 'custom') return I18N.t('customUrl');
    var p = ExtLinks.find(kind === 'dict' ? ExtLinks.DICTIONARIES : ExtLinks.TRANSLATORS, cfg.preset);
    return p ? p.label : '—';
  }

  function refreshLanguages() {
    return Promise.all([listLanguages(), db.dictionaries.toArray()]).then(function (r) {
      var langs = r[0], dicts = {};
      r[1].forEach(function (d) { dicts[d.langCode] = d; });
      var list = document.getElementById('langList');
      if (!list) return;
      list.innerHTML = '';
      if (!langs.length) {
        list.innerHTML = '<div class="empty" style="padding:20px 0;font-size:13px">' + esc(I18N.t('noLanguages')) + '</div>';
        return;
      }
      var active = state.settings.studyLang && langs.some(function (l) { return l.code === state.settings.studyLang; })
        ? state.settings.studyLang : langs[0].code;
      langs.forEach(function (l) {
        var d = dicts[l.code], row = document.createElement('div');
        row.className = 'word-row';
        var dictTxt = d ? (d.count + ' ' + I18N.t('entries')) : I18N.t('noDictShort');
        var iconBtn = function (act, label, path) {
          return '<button class="tbtn" data-act="' + act + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg></button>';
        };
        row.innerHTML =
          '<input type="radio" name="activeLang" class="wchk" value="' + esc(l.code) + '"' + (l.code === active ? ' checked' : '') + ' aria-label="' + esc(I18N.t('useForReading')) + '">' +
          '<div class="word-main"><div class="word-foreign">' + esc(languageName(l.code)) + ' (' + esc(l.code.toUpperCase()) + ')</div>' +
          '<div class="word-sub">' + esc(dictTxt) + ' · ' + esc(presetLabel('dict', l.extDict || l.externalDict)) + ' · ' +
          esc(presetLabel('translator', l.extTrans || l.externalTranslator)) + '</div></div>' +
          iconBtn('edit', I18N.t('edit'), '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>') +
          iconBtn('del', I18N.t('delete'), '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>');
        row.querySelector('input').addEventListener('change', function () {
          state.settings.studyLang = l.code; setSetting('studyLang', l.code); resolveStudyLang();
        });
        row.querySelector('[data-act="edit"]').addEventListener('click', function () { openLangModal(l); });
        row.querySelector('[data-act="del"]').addEventListener('click', function () {
          UI.confirm(tf('deleteLangQ', l.code), { danger: true, ok: I18N.t('delete') }).then(function (y) {
            if (y) deleteLanguage(l.id).then(refreshLanguages);
          });
        });
        list.appendChild(row);
      });
    });
  }

  /** Fills a <select> with presets grouped as Apps / Web / Local, plus "Custom URL scheme". */
  function fillPresetSelect(sel, list, cfg) {
    var labels = { app: 'grpApps', local: 'grpLocal', web: 'grpWeb' }, groups = {}, order = [];
    sel.textContent = '';
    var none = document.createElement('option'); none.value = ''; none.textContent = '— ' + I18N.t('none') + ' —'; sel.appendChild(none);
    list.forEach(function (p) {
      if (!groups[p.group]) {
        groups[p.group] = document.createElement('optgroup'); groups[p.group].label = I18N.t(labels[p.group]); order.push(p.group);
      }
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.label; groups[p.group].appendChild(o);
    });
    order.forEach(function (g) { sel.appendChild(groups[g]); });
    var c = document.createElement('option'); c.value = 'custom'; c.textContent = I18N.t('customUrl'); sel.appendChild(c);
    var pre = typeof cfg === 'string' ? (cfg ? 'custom' : '') : (cfg && cfg.preset) || '';
    sel.value = Array.prototype.some.call(sel.options, function (o) { return o.value === pre; }) ? pre : '';
  }

  function syncCustomInputs() {
    [['lExtDictSel', 'lExtDict'], ['lExtTransSel', 'lExtTrans']].forEach(function (p) {
      $(p[1]).hidden = $(p[0]).value !== 'custom';
    });
  }

  function extCfgFromForm(selId, inpId) {
    var preset = $(selId).value, custom = $(inpId).value.trim();
    return { preset: preset, custom: custom };
  }

  // ----- dictionary import (Web Worker: unzip / untar / xz / parse / index, UI stays responsive) -----
  function cancelDictImport() {
    if (state.dictWorker) { try { state.dictWorker.terminate(); } catch (e) {} state.dictWorker = null; }
    var pr = $('lDictProg'); if (pr) pr.hidden = true;
    var sv = $('langSave'); if (sv) sv.disabled = false;
  }

  /** Runs the import worker. Resolves { count, name, format } or rejects with a readable message. */
  function importDictionary(code, file) {
    return new Promise(function (resolve, reject) {
      if (!window.Worker) { reject(new Error(I18N.t('noWorker'))); return; }
      var w = new Worker('dictworker.js');
      state.dictWorker = w;
      var prog = $('lDictProg'), bar = $('lDictBar'), txt = $('lDictTxt');
      prog.hidden = false; bar.style.width = '0%'; txt.textContent = I18N.t('impRead');
      $('langSave').disabled = true;
      w.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === 'progress') {
          bar.style.width = m.pct + '%';
          txt.textContent = I18N.t('imp_' + m.stage) + ' ' + m.pct + '%';
        } else if (m.type === 'done') { cancelDictImport(); resolve(m); }
        else if (m.type === 'error') { cancelDictImport(); reject(new Error(m.message)); }
      };
      w.onerror = function (e) { cancelDictImport(); reject(new Error(e.message || 'Worker error')); };
      w.postMessage({ type: 'import', file: file, lang: code, native: nativeCode() });
    });
  }

  function bindLangModal() {
    var save = document.getElementById('langSave');
    if (!save) return;
    ['lExtDictSel', 'lExtTransSel'].forEach(function (id) { $(id).addEventListener('change', syncCustomInputs); });
    save.addEventListener('click', function () {
      var edit = state.langEdit;
      var code = edit ? edit.code : document.getElementById('lCode').value;
      if (!code) { UI.toast(I18N.t('enterLangCode'), 'warn'); return; }
      var d = extCfgFromForm('lExtDictSel', 'lExtDict'), t = extCfgFromForm('lExtTransSel', 'lExtTrans');
      var data = {
        code: code, extDict: d, extTrans: t,
        externalDict: d.preset === 'custom' ? d.custom : '', externalTranslator: t.preset === 'custom' ? t.custom : ''
      };
      var dictFile = document.getElementById('lDict').files[0];
      var saved = edit
        ? updateLanguage(edit.id, { extDict: d, extTrans: t, externalDict: data.externalDict, externalTranslator: data.externalTranslator })
        : addLanguage(data);
      saved.then(function () {
        refreshLanguages(); resolveStudyLang();
        if (!dictFile) { window.__closeLangModal(); return; }
        return importDictionary(code, dictFile).then(function (r) {
          UI.toast(tf('dictImported', r.count, r.name), 'success', 5000);
          window.__closeLangModal(); refreshLanguages(); resolveStudyLang();
        });
      }).catch(function (err) { UI.toast(I18N.t('importError') + ': ' + err.message, 'error', 7000); });
    });
  }

  /** Opens the "New language" dialog (or edits an existing language); languages already added are shown disabled. */
  function openLangModal(existing) {
    state.langEdit = existing && existing.code ? existing : null;
    var f = document.getElementById('lDict'); if (f) f.value = '';
    $('lDictProg').hidden = true; $('langSave').disabled = false;
    listLanguages().then(function (langs) {
      var have = langs.map(function (l) { return l.code; });
      var sel = document.getElementById('lCode'), firstFree = '';
      sel.innerHTML = '';
      LANGUAGES.forEach(function (l) {
        var opt = document.createElement('option');
        opt.value = l[0];
        var added = have.indexOf(l[0]) > -1;
        opt.textContent = l[1] + ' (' + l[0] + ')' + (added ? ' ✓' : '');
        opt.disabled = added && !(state.langEdit && state.langEdit.code === l[0]);
        if (!opt.disabled && !firstFree) firstFree = l[0];
        sel.appendChild(opt);
      });
      var e = state.langEdit;
      sel.value = e ? e.code : firstFree;
      sel.disabled = !!e;
      $('lExtDict').value = e && e.extDict ? (e.extDict.custom || '') : (e ? e.externalDict || '' : '');
      $('lExtTrans').value = e && e.extTrans ? (e.extTrans.custom || '') : (e ? e.externalTranslator || '' : '');
      fillPresetSelect($('lExtDictSel'), ExtLinks.DICTIONARIES, e ? (e.extDict || e.externalDict) : null);
      fillPresetSelect($('lExtTransSel'), ExtLinks.TRANSLATORS, e ? (e.extTrans || e.externalTranslator) : null);
      syncCustomInputs();
      var info = $('lDictInfo'); info.textContent = '';
      if (e) getDictionaryMeta(e.code).then(function (m) {
        info.textContent = m ? tf('dictCurrent', m.name || m.source || '', m.count) : '';
      });
      document.getElementById('langModal').hidden = false;
    });
  }

  // ===================== WORD MODAL =====================
  function bindWordModal() {
    var saveBtn = document.getElementById('wordSave');
    if (!saveBtn) return;
    saveBtn.addEventListener('click', function () {
      var foreign = (document.getElementById('wForeign').value || '').trim() || '-';
      var translation = (document.getElementById('wTranslation').value || '').trim() || '-';
      var transcription = (document.getElementById('wTranscription').value || '').trim();
      var context = (document.getElementById('wContext').value || '').trim() || '-';
      var sentenceTranslation = (document.getElementById('wSentenceTranslation').value || '').trim() || '-';
      var bookId = state._wordModalBookId != null ? state._wordModalBookId : state.openBookId;
      addWord({
        foreign: foreign, translation: translation, transcription: transcription,
        context: context, sentenceTranslation: sentenceTranslation,
        langCode: state.currentLangCode || 'en',
        bookId: bookId
      }).then(function () {
        window.__closeWordModal();
        state._wordModalBookId = null;
        refreshWords();
        syncMarks();
        if (state.dictBookId) refreshDictionaryView();
      }).catch(function (err) { UI.toast(I18N.t('errorGeneric') + ': ' + err.message, 'error'); });
    });
  }

  /**
   * Opens the "New word" form. opts.translation pre-fills the translation (from the dictionary bottom sheet);
   * without it the internal dictionary is consulted. NOTHING is focused on open, so the mobile on-screen keyboard
   * does not pop up and cover the form: the user taps the field they want to edit.
   */
  function openWordModal(word, sentence, bookId, opts) {
    opts = opts || {};
    word = word || '-';
    sentence = (sentence && sentence !== '-') ? sentence : (opts.example || '-');
    var lang = state.currentLangCode || 'en';
    state._wordModalBookId = bookId || null;
    var active = document.activeElement;
    if (active && active !== document.body && active.blur) active.blur();     // drop any focused input (keyboard)
    // translation and transcription are separate: from the bottom sheet they arrive ready; otherwise ask the dictionary
    var pre = opts.translation != null
      ? Promise.resolve({ tr: opts.translation, ipa: opts.transcription || '' })
      : lookupEntries(lang, word, nativeCode()).then(function (r) {
          var ipa = r && r.entries.filter(function (e) { return e[1]; })[0];
          return { tr: r ? DictCore.shortGloss(r.entries) : '', ipa: ipa ? ipa[1] : '' };
        }).catch(function () { return { tr: '', ipa: '' }; });
    pre.then(function (x) {
      document.getElementById('wForeign').value = word;
      document.getElementById('wTranscription').value = x.ipa || '';
      document.getElementById('wTranslation').value = x.tr || '-';
      document.getElementById('wContext').value = sentence;
      document.getElementById('wSentenceTranslation').value = '-';
      document.getElementById('wordModal').hidden = false;
      var box = document.getElementById('wordBox');          // focus the dialog container itself (not an input)
      if (box) box.focus({ preventScroll: true });
    });
  }

  // ===================== DICTIONARY VIEW =====================
  function bindDictionaryView() {
    var back = document.getElementById('dictBackBtn');
    var exp = document.getElementById('exportTsvBtn');
    if (back) back.addEventListener('click', function () {
      state.dictBookId = null;
      showTab('library');
    });
    if (exp) exp.addEventListener('click', exportCurrentDictionary);
  }

  function openDictionaryView(bookId) {
    state.dictBookId = Number(bookId);
    showTab('dict');
    getBook(bookId).then(function (b) {
      var t = document.getElementById('dictTitle');
      if (t) t.textContent = b ? b.title : I18N.t('dictTitle');
    });
    refreshDictionaryView();
  }

  function refreshDictionaryView() {
    if (!state.dictBookId) return;
    listWordsForBook(state.dictBookId).then(function (words) {
      var box = document.getElementById('dictList');
      var empty = document.getElementById('emptyDict');
      if (!box) return;
      box.innerHTML = '';
      if (!words.length) {
        if (empty) { box.appendChild(empty); empty.hidden = false; }
        return;
      }
      if (empty) empty.hidden = true;
      words.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      words.forEach(function (w) {
        var row = document.createElement('div');
        row.className = 'dict-row';
        row.innerHTML =
          '<div class="dict-cell"><strong>' + esc(w.foreign) + '</strong></div>' +
          '<div class="dict-cell">' + esc(w.translation) + '</div>' +
          '<div class="dict-cell dict-muted">' + esc(w.context) + '</div>' +
          '<div class="dict-cell dict-muted">' + esc(w.sentenceTranslation || '-') + '</div>';
        box.appendChild(row);
      });
    });
  }

  function exportCurrentDictionary() {
    if (!state.dictBookId) return;
    listWordsForBook(state.dictBookId).then(function (words) {
      if (!words.length) { UI.toast(I18N.t('dictEmpty'), 'warn'); return; }
      var lines = words.map(function (w) {
        return [
          cleanTsv(w.foreign),
          cleanTsv(w.translation),
          cleanTsv(w.context),
          cleanTsv(w.sentenceTranslation || '-')
        ].join('\t');
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      getBook(state.dictBookId).then(function (b) {
        var safeTitle = (b && b.title ? b.title : 'dictionary').replace(/[\\/:*?"<>|]+/g, '_');
        var a = document.createElement('a');
        a.href = url;
        a.download = safeTitle + '.tsv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
      });
    });
  }

  function cleanTsv(s) {
    return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
  }

  // ===================== QUIZ =====================
  function bindQuiz() {
    var addWordBtn = $('addWordBtn'), startBtn = $('startQuizBtn'), quitBtn = $('quitQuiz');
    if (addWordBtn) addWordBtn.addEventListener('click', function () {
      openWordModal('-', '-', state.openBookId);
    });
    if (startBtn) startBtn.addEventListener('click', startQuiz);
    if (quitBtn) quitBtn.addEventListener('click', quitQuiz);

    // Word sorting: arrow = order, label = type (same pattern as the bookshelf)
    var ws = $('wordSortBtn');
    if (ws) ws.addEventListener('click', function (e) {
      if (e.target.closest('#wordSortDir')) {
        state.wordSortDir = -state.wordSortDir;
        setSetting('wordSortDir', state.wordSortDir);
      } else {
        state.wordSortKey = state.wordSortKey === 'createdAt' ? 'foreign' : 'createdAt';
        setSetting('wordSortKey', state.wordSortKey);
      }
      updateWordSortUI();
      renderQuizHome();
    });

    // Book menu
    var menu = $('bookMenu');
    $('bookSelBtn').addEventListener('click', function () { menu.hidden = !menu.hidden; });
    document.addEventListener('pointerdown', function (e) {
      if (menu.hidden || menu.contains(e.target) || e.target.closest('#bookSelBtn')) return;
      menu.hidden = true;
    }, true);
    $('booksAll').addEventListener('click', function () { setAllBooks(true); });
    $('booksNone').addEventListener('click', function () { setAllBooks(false); });

    // Word selection
    $('wordsAll').addEventListener('click', function () { setVisibleChecked(true); });
    $('wordsNone').addEventListener('click', function () { setVisibleChecked(false); });
  }

  function updateWordSortUI() {
    var l = $('wordSortLabel'), d = $('wordSortDir');
    if (!l || !d) return;
    l.textContent = state.wordSortKey === 'foreign' ? I18N.t('sortName') : I18N.t('sortAdded');
    d.textContent = state.wordSortDir === -1 ? '↓' : '↑';
  }

  /** Front/back field pickers (two columns). Every side keeps at least one field. */
  function renderSides() {
    [['sideFront', 'cardFront'], ['sideBack', 'cardBack']].forEach(function (p) {
      var box = $(p[0]);
      if (!box) return;
      box.innerHTML = '';
      FIELDS.forEach(function (f) {
        var lab = document.createElement('label');
        lab.className = 'side-opt';
        var chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = state[p[1]].indexOf(f.id) > -1;
        chk.addEventListener('change', function () {
          var next = FIELDS.map(function (x) { return x.id; }).filter(function (id) {
            return id === f.id ? chk.checked : state[p[1]].indexOf(id) > -1;
          });
          if (!next.length) { chk.checked = true; UI.toast(I18N.t('keepOneField'), 'warn'); return; }
          state[p[1]] = next;
          setSetting(p[1], next);
        });
        var span = document.createElement('span');
        span.textContent = I18N.t(f.label);
        lab.appendChild(chk);
        lab.appendChild(span);
        box.appendChild(lab);
      });
    });
  }

  function wkey(w) { return w.bookId == null ? 0 : Number(w.bookId); }

  /** Words of the selected books, ordered by the chosen word sort. */
  function sortedVisible() {
    var q = state.quiz, k = state.wordSortKey, d = state.wordSortDir;
    var arr = q.words.filter(function (w) { return q.books.has(wkey(w)); });
    arr.sort(function (a, b) {
      var r = k === 'foreign'
        ? String(a.foreign).localeCompare(String(b.foreign), undefined, { sensitivity: 'base' })
        : (a.createdAt || 0) - (b.createdAt || 0);
      return r * d;
    });
    return arr;
  }

  /** Reloads words + books, keeps the user's selection and auto-selects new books / words. */
  function refreshWords() {
    return Promise.all([listWords(), listBooks()]).then(function (r) {
      var q = state.quiz, words = r[0];
      q.words = words;
      q.booksList = r[1];
      q.counts = {};
      words.forEach(function (w) { var k = wkey(w); q.counts[k] = (q.counts[k] || 0) + 1; });

      var keys = q.booksList.map(function (b) { return b.id; });
      if (q.counts[0]) keys.push(0);
      keys.forEach(function (k) {
        if (!q.knownBooks.has(k)) { q.knownBooks.add(k); q.books.add(k); }
      });
      Array.from(q.knownBooks).forEach(function (k) {
        if (keys.indexOf(k) < 0) { q.knownBooks.delete(k); q.books.delete(k); }
      });

      var ids = new Set(words.map(function (w) { return w.id; }));
      words.forEach(function (w) {
        if (!q.knownWords.has(w.id)) { q.knownWords.add(w.id); if (q.books.has(wkey(w))) q.checked.add(w.id); }
      });
      Array.from(q.knownWords).forEach(function (id) {
        if (!ids.has(id)) { q.knownWords.delete(id); q.checked.delete(id); }
      });
      renderQuizHome();
    });
  }

  function setAllBooks(on) {
    var q = state.quiz;
    Object.keys(q.counts).concat(q.booksList.map(function (b) { return b.id; })).forEach(function (k) {
      setBookSelected(Number(k), on, true);
    });
    renderQuizHome();
  }

  function setBookSelected(key, on, silent) {
    var q = state.quiz;
    if (on) q.books.add(key); else q.books.delete(key);
    q.words.forEach(function (w) {
      if (wkey(w) !== key) return;
      if (on) q.checked.add(w.id); else q.checked.delete(w.id);
    });
    if (!silent) renderQuizHome();
  }

  function setVisibleChecked(on) {
    var q = state.quiz;
    sortedVisible().forEach(function (w) { if (on) q.checked.add(w.id); else q.checked.delete(w.id); });
    renderQuizHome();
  }

  function renderBookMenu() {
    var q = state.quiz, list = $('bookMenuList'), total = 0, sel = 0;
    list.innerHTML = '';
    var entries = q.booksList.map(function (b) { return { key: b.id, title: b.title }; });
    if (q.counts[0]) entries.push({ key: 0, title: I18N.t('noBook') });
    entries.forEach(function (e) {
      total++;
      if (q.books.has(e.key)) sel++;
      var row = document.createElement('label');
      row.className = 'menu-row';
      row.innerHTML = '<input type="checkbox"' + (q.books.has(e.key) ? ' checked' : '') + '>' +
        '<span class="menu-name">' + esc(e.title) + '</span>' +
        '<span class="menu-count">' + (q.counts[e.key] || 0) + '</span>';
      row.querySelector('input').addEventListener('change', function () { setBookSelected(e.key, this.checked); });
      list.appendChild(row);
    });
    $('bookSelLabel').textContent = I18N.t('books') + ' (' + sel + '/' + total + ')';
  }

  function renderQuizHome() {
    var q = state.quiz, box = $('wordsList');
    if (!box) return;
    var titles = {};
    q.booksList.forEach(function (b) { titles[b.id] = b.title; });
    var vis = sortedVisible(), now = Date.now();
    var statusLbl = { 'new': 'new', learning: 'learning', relearning: 'learning', review: 'due' };

    box.innerHTML = '';
    $('emptyWords').hidden = q.words.length > 0;

    vis.forEach(function (w) {
      var st = Quiz.statusOf(w), due = st === 'new' || (w.nextReviewDate || 0) <= now;
      var row = document.createElement('div');
      row.className = 'word-row';
      row.innerHTML =
        '<input type="checkbox" class="wchk" aria-label="Select word"' + (q.checked.has(w.id) ? ' checked' : '') + '>' +
        '<div class="word-main">' +
          '<div class="word-foreign">' + esc(w.foreign) +
            (due ? ' <span class="word-due' + (st === 'new' ? ' new' : '') + '">' + esc(I18N.t(st === 'new' ? 'statNew' : (st === 'review' ? 'dueWords' : 'statLearning'))) + '</span>' : '') +
          '</div>' +
          '<div class="word-sub">' + esc(w.translation) + ' · ' + esc(w.bookId != null && titles[w.bookId] ? titles[w.bookId] : I18N.t('noBook')) + '</div>' +
        '</div>' +
        '<button class="tbtn" type="button" aria-label="Delete">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>' +
        '</button>';
      row.querySelector('.wchk').addEventListener('change', function () {
        if (this.checked) q.checked.add(w.id); else q.checked.delete(w.id);
        updateQuizCounts();
      });
      row.querySelector('.tbtn').addEventListener('click', function () {
        UI.confirm(I18N.t('deleteWordQ'), { danger: true, ok: I18N.t('delete') }).then(function (y) {
          if (y) deleteWord(w.id).then(function () { refreshWords(); syncMarks(); });
        });
      });
      box.appendChild(row);
    });

    renderBookMenu();
    $('statTotal').textContent = q.words.length;
    updateQuizCounts(vis);
  }

  function srsCfg() { return { newPerSession: state.settings.newPerSession }; }

  /** Updates the Due / New / Learning counters, the "Selected n / m" header and the Start button state. */
  function updateQuizCounts(vis) {
    var q = state.quiz, now = Date.now();
    vis = vis || sortedVisible();
    var chosen = vis.filter(function (w) { return q.checked.has(w.id); });
    var c = Quiz.counts(chosen, now, srsCfg());
    var sb = $('startQuizBtn');
    sb.disabled = c.queue === 0;
    $('statDue').textContent = c.due;
    $('statNew').textContent = c.newCount;
    $('statLearning').textContent = c.learning;
    $('wordsHeadCount').textContent = I18N.t('selected') + ': ' + chosen.length + ' / ' + vis.length;
    var hint = $('quizHint');
    if (chosen.length && c.queue === 0) {
      var next = Quiz.nextDueAt(chosen, now);
      hint.textContent = next ? tf('nextReviewIn', Quiz.formatInterval(next - now)) : I18N.t('newLimitZero');
      hint.hidden = false;
    } else hint.hidden = true;
  }

  // ----- SRS study session (SM-2 / Anki-style; see quiz.js) -----
  function startQuiz() {
    var q = state.quiz;
    var words = sortedVisible().filter(function (w) { return q.checked.has(w.id); });
    if (!words.length) return;
    var sess = new Quiz.Session(words, Date.now(), srsCfg());
    if (sess.finished()) { UI.toast(I18N.t('nothingDue'), 'info'); return; }
    state.srs = sess;
    state.srsWrites = Promise.resolve();
    $('bookMenu').hidden = true;
    $('quizHome').hidden = true;
    $('quizSession').hidden = false;
    renderQuestion();
  }

  function renderQuestion() {
    var sess = state.srs;
    if (!sess) return;
    var card = sess.current();
    if (!card) { finishQuiz(); return; }
    var pt = $('quizProgressText');
    if (pt) pt.textContent = tf('quizLeft', sess.remaining());
    var bar = $('quizBar');
    if (bar) bar.style.width = Math.round(100 * sess.graduated / Math.max(1, sess.total)) + '%';
    renderFC(card);
  }

  /** Stacks the enabled fields of one side vertically (word → translation → sentence → sentence translation). */
  function faceHtml(w, ids) {
    var html = FIELDS.filter(function (f) { return ids.indexOf(f.id) > -1; }).map(function (f) {
      var v = w[f.key];
      if (v == null || String(v).trim() === '' || String(v).trim() === '-') return '';
      return '<div class="fc-field ' + f.cls + '">' + esc(v) + '</div>';
    }).join('');
    return html || '<div class="fc-field fc-tr">—</div>';
  }

  function renderFC(w) {
    var revealed = false, sess = state.srs;
    var body = $('quizBody'), footer = $('quizFooter');
    var st = Quiz.statusOf(w);
    var stLabel = I18N.t(st === 'new' ? 'statNew' : (st === 'review' ? 'stReview' : (st === 'learning' ? 'statLearning' : 'stRelearning')));
    body.innerHTML = '<div class="flashcard" id="fcCard" role="button" tabindex="0" aria-label="' + esc(I18N.t('tapReveal')) + '">' +
      '<span class="fc-status fc-status-' + st + '">' + esc(stLabel) + '</span>' +
      '<div class="fc-face" id="fcFace">' + faceHtml(w, state.cardFront) + '</div>' +
      '<div class="fc-hint" id="fcHint">' + esc(I18N.t('tapReveal')) + '</div></div>' +
      '<div class="fc-actions" id="fcActions" hidden></div>';
    footer.innerHTML = '';
    var card = $('fcCard'), acts = $('fcActions');
    function reveal() {
      if (revealed) return;
      revealed = true;
      $('fcFace').innerHTML = faceHtml(w, state.cardBack); // flip to the back side
      $('fcHint').hidden = true;
      var labels = Quiz.previewLabels(w, Date.now(), srsCfg());   // next interval under each button
      acts.innerHTML = [['again', 1], ['hard', 2], ['good', 3], ['easy', 4]].map(function (b, i) {
        return '<button class="btn ' + b[0] + '" data-g="' + b[1] + '"><span class="gl">' + esc(I18N.t(b[0])) + '</span><span class="gi">' + esc(labels[i]) + '</span></button>';
      }).join('');
      acts.hidden = false;
      Array.prototype.forEach.call(acts.children, function (btn) {
        btn.addEventListener('click', function () { rate(Number(btn.getAttribute('data-g'))); });
      });
    }
    card.addEventListener('click', reveal);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
    function rate(g) {
      var res = sess.answer(g, Date.now());
      if (res) {                                              // saved immediately: quitting mid-session loses nothing
        state.srsWrites = state.srsWrites.then(function () { return updateWordSrs(res.id, res.patch); }).catch(function () {});
      }
      renderQuestion();
    }
  }

  function finishQuiz() {
    var sess = state.srs;
    state.srsWrites.then(function () {
      state.srs = null;
      $('quizSession').hidden = true;
      $('quizHome').hidden = false;
      refreshWords();
      if (sess) {
        var r = sess.ratings, ok = r[2] + r[3] + r[4];
        UI.alert(tf('quizDoneSrs', sess.answers, r[1], ok, sess.total));
      }
    });
  }

  function quitQuiz() {
    UI.confirm(I18N.t('quitQuizQ')).then(function (y) {
      if (!y) return;
      state.srsWrites.then(function () {
        state.srs = null;
        $('quizSession').hidden = true;
        $('quizHome').hidden = false;
        refreshWords();
      });
    });
  }

  // ===================== UTIL =====================
  function $(id) { return document.getElementById(id); }
  /** I18N.t with {0},{1}… placeholders. */
  function tf(key) {
    var out = I18N.t(key);
    for (var i = 1; i < arguments.length; i++) out = out.replace('{' + (i - 1) + '}', arguments[i]);
    return out;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
