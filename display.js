/* global getSetting, setSetting */
/**
 * Display — global book display settings, shared by the reader's quick-settings bar and the Settings tab.
 *
 *   screenMode   'windowed' | 'fullscreen'      Fullscreen API (+ webkit prefix), pseudo-fullscreen fallback (iOS iPhone)
 *   orientation  'auto' | 0 | 90 | 180 | 270    Screen Orientation API lock, CSS rotation fallback (iOS Safari)
 *   bookZoom     0.5 … 4                        scales ONLY the book content (never the app chrome); continuous (0.01 steps)
 *   bookLocked   boolean                        freezes zoom + panning (also blocks pinch gestures)
 *
 * Horizontal position is not a setting: zoomed pages are panned by dragging (touch, or the left mouse button held down).
 *
 * Any control carrying one of these data attributes is wired automatically and kept in sync, wherever it lives:
 *   [data-disp="bookZoom"]   range input          [data-disp-val="bookZoom"]  value label
 *   [data-disp-screen="toggle|fullscreen|windowed"]          [data-disp-orient="auto|0|90|180|270"]
 *   [data-disp-lock]                                          [data-disp-reset="bookZoom"]
 */
var Display = (function () {
  'use strict';

  var KEYS = ['screenMode', 'orientation', 'bookZoom', 'bookLocked'];
  var DEFAULTS = { screenMode: 'windowed', orientation: 'auto', bookZoom: 1, bookLocked: false };
  var LIMITS = { bookZoom: [0.5, 4, 0.01] };
  // Screen.orientation.angle values → lock() types. 0° = portrait clockwise … 270° = landscape counter-clockwise.
  var LOCK_TYPE = { 0: 'portrait-primary', 90: 'landscape-primary', 180: 'portrait-secondary', 270: 'landscape-secondary' };

  var S = Object.assign({}, DEFAULTS);
  var subs = [];
  var active = false;            // true while the reader tab is showing (the orientation lock only applies then)
  var lastVisChange = 0;         // when the page last became hidden / visible\n  var lastConfigChange = 0; (system fullscreen exits happen around it)
  var root = document.documentElement;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var round = function (v, step) { return Math.round(v / step) * step; };

  function sanitize(k, v) {
    if (k === 'bookZoom') {
      var L = LIMITS[k], n = Number(v);
      if (!isFinite(n)) return DEFAULTS[k];
      return Number(clamp(round(n, L[2]), L[0], L[1]).toFixed(2));
    }
    if (k === 'orientation') return (v === 0 || v === 90 || v === 180 || v === 270) ? v : (/^(0|90|180|270)$/.test(String(v)) ? Number(v) : 'auto');
    if (k === 'screenMode') return v === 'fullscreen' ? 'fullscreen' : 'windowed';
    if (k === 'bookLocked') return !!v;
    return v;
  }

  function get() { return Object.assign({}, S); }
  function onChange(fn) { subs.push(fn); }
  function emit(changed, opts) { subs.forEach(function (fn) { try { fn(get(), changed, opts || {}); } catch (e) { console.error('[Display]', e); } }); }

  // ===================== Fullscreen =====================
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function setPseudo(on) { root.classList.toggle('pseudo-fs', !!on); }

  /**
   * Enters fullscreen. Resolves 'native' | 'pseudo' (no Fullscreen API at all, e.g. iPhone) | 'blocked' (the browser refused
   * because there was no user gesture — the caller arms a one-shot gesture hook and retries on the next tap).
   * navigationUI:'hide' asks the browser to keep its own navigation hints out of the way where it honours that.
   */
  function enterFullscreen() {
    var el = root, req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) { setPseudo(true); return Promise.resolve('pseudo'); }
    function call(opts) { return Promise.resolve(opts ? req.call(el, opts) : req.call(el)); }
    return call({ navigationUI: 'hide' })
      .catch(function (e) { return e && e.name === 'TypeError' ? call() : Promise.reject(e); })    // options not understood: plain request
      .then(function () { setPseudo(false); return 'native'; })
      .catch(function () { return 'blocked'; });
  }

  function exitFullscreen() {
    setPseudo(false);
    if (!fsElement()) return Promise.resolve();
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    try { return Promise.resolve(ex && ex.call(document)).catch(function () {}); } catch (e) { return Promise.resolve(); }
  }

  /** Fullscreen follows the user's choice everywhere (it is NOT left when switching tabs: every re-entry makes the browser show its
   *  own "viewing full screen" banner). */
  function applyScreen() {
    if (S.screenMode !== 'fullscreen') return exitFullscreen();
    if (fsElement() || root.classList.contains('pseudo-fs')) return Promise.resolve();
    return enterFullscreen().then(function (m) { if (m === 'blocked') armGesture(); return m; });
  }

  // The browser only allows fullscreen / orientation lock right after a user gesture. When the system dropped them while the
  // app was in the background, they are restored at once if possible, otherwise on the very next tap (invisible to the user).
  var gestureArmed = false;
  function armGesture() {
    if (gestureArmed) return; gestureArmed = true;
    var evs = ['pointerup', 'touchend', 'click', 'keydown'];
    function fire() {
      evs.forEach(function (t) { document.removeEventListener(t, fire, true); });
      gestureArmed = false;
      reapply(false);
    }
    evs.forEach(function (t) { document.addEventListener(t, fire, true); });
  }

  /** Re-applies the SAVED fullscreen + orientation state (the Settings always show the saved values). */
  function reapply(silent) {
    var jobs = [];
    if (S.screenMode === 'fullscreen' && !fsElement() && !root.classList.contains('pseudo-fs')) jobs.push(applyScreen());
    if (active && S.orientation !== 'auto') jobs.push(applyOrientation(silent));
    return Promise.all(jobs);
  }

  function onFsChange() {
    if (fsElement() || S.screenMode !== 'fullscreen' || root.classList.contains('pseudo-fs')) return;
    // Fullscreen ended. Around a visibility change (external dictionary / translator, app switcher) that is the system's doing:
    // keep the saved choice and restore it on return. Otherwise the user left fullscreen on purpose (system gesture / Back).
    var system = document.visibilityState === 'hidden' || Date.now() - lastVisChange < 2500 || Date.now() - lastConfigChange < 2500;
    if (system) { armGesture(); return; }
    set({ screenMode: 'windowed' });
  }

  // ===================== Orientation =====================
  function currentAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return (window.orientation + 360) % 360;
    return 0;
  }

  function cssRotate(deg) {
    if (deg) root.setAttribute('data-css-rotate', String(deg)); else root.removeAttribute('data-css-rotate');
  }

  function unlockOrientation() {
    cssRotate(0);
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
  }

  /** Locks to the chosen angle: Screen Orientation API (entering fullscreen first when Chrome requires it), else CSS rotation. */
  function applyOrientation(silent) {
    var o = S.orientation;
    if (!active || o === 'auto') { unlockOrientation(); return Promise.resolve('auto'); }
    cssRotate(0);
    var fallback = function () { if (silent) return 'none'; cssRotate(((o - currentAngle()) % 360 + 360) % 360); return 'css'; };
    if (!(screen.orientation && screen.orientation.lock)) return Promise.resolve(fallback());
    var type = LOCK_TYPE[o];
    return screen.orientation.lock(type).then(function () { return 'api'; }).catch(function () {
      if (silent) { armGesture(); return 'none'; }                   // not allowed right now (no gesture / not fullscreen): retry on the next tap
      if (!fsElement() && !root.classList.contains('pseudo-fs')) {
        // Chrome only allows lock() in fullscreen (outside an installed standalone window)
        return enterFullscreen().then(function (m) {
          if (m !== 'native') return fallback();
          return screen.orientation.lock(type).then(function () { return 'api'; }).catch(fallback);
        });
      }
      return fallback();
    });
  }

  // ===================== State =====================
  function applyCss() {
    root.style.setProperty('--book-zoom', S.bookZoom);
    root.classList.toggle('book-locked', S.bookLocked);
  }

  /**
   * Updates settings. opts.live: no persistence / side effects yet (used while dragging a slider or pinching;
   * the final value is persisted by the 'change' event / gesture end). opts.force: bypass the lock.
   */
  function set(patch, opts) {
    opts = opts || {};
    var changed = {}, any = false;
    KEYS.forEach(function (k) {
      if (!(k in patch)) return;
      if (S.bookLocked && !opts.force && k === 'bookZoom') return;   // locked: zoom is frozen
      var v = sanitize(k, patch[k]);
      if (v !== S[k]) { S[k] = v; changed[k] = true; any = true; }
    });
    // end of a gesture / slider drag: tell the reader to commit (re-render at the final zoom) even if the value did not change
    if (opts.persist && 'bookZoom' in patch && !S.bookLocked) { changed.bookZoom = true; any = true; }
    if (!any && !opts.persist) return Promise.resolve();
    applyCss();
    var jobs = [];
    if (changed.screenMode) jobs.push(applyScreen());
    if (changed.orientation) jobs.push(applyOrientation());
    if (opts.transient) { /* system-initiated: show it, keep the saved preference */ }
    else if (!opts.live) KEYS.forEach(function (k) { if (changed[k] || (opts.persist && k in patch)) setSetting(k, S[k]).catch(function () {}); });
    else if (changed.bookZoom) persistZoomSoon();     // a process kill in the middle of a pinch must not lose the zoom
    emit(changed, opts);
    render();
    return Promise.all(jobs);
  }

  var zoomTimer = 0;
  function persistZoomSoon() { clearTimeout(zoomTimer); zoomTimer = setTimeout(function () { setSetting('bookZoom', S.bookZoom).catch(function () {}); }, 500); }

  /** Loads the saved values (call once at boot). */
  function load() {
    return Promise.all(KEYS.map(function (k) { return getSetting(k, DEFAULTS[k]); })).then(function (vals) {
      KEYS.forEach(function (k, i) { S[k] = sanitize(k, vals[i]); });
      applyCss(); emit({}, { load: true }); render();
    });
  }

  /**
   * The reader tab is shown. `fresh` = a book was just opened by a tap: only then fullscreen is (re-)entered if it is the
   * saved choice and the system had left it; plain tab switches never touch fullscreen (no repeated banner).
   */
  function enterReader(fresh) {
    active = true; applyCss();
    return Promise.all([fresh ? applyScreen() : Promise.resolve(), applyOrientation()]);
  }
  /** The reader tab is hidden / closed: only the orientation lock is released. Fullscreen stays as the user left it. */
  function leaveReader() { active = false; unlockOrientation(); return Promise.resolve(); }

  /** Back from another app / the app switcher: re-assert what the system may have dropped (fullscreen, orientation lock, zoom, controls). */
  function resume() {
    lastVisChange = Date.now();
    applyCss(); render();
    reapply(true);
  }

  // ===================== Controls (reader bar + Settings tab) =====================
  function pct(k, v) { return Math.round(v * 100) + '%'; }

  function render() {
    document.querySelectorAll('[data-disp]').forEach(function (el) {
      var k = el.getAttribute('data-disp');
      if (document.activeElement !== el || el.disabled) el.value = S[k];
      el.disabled = S.bookLocked;
      el.setAttribute('aria-valuetext', pct(k, S[k]));
    });
    document.querySelectorAll('[data-disp-val]').forEach(function (el) {
      var k = el.getAttribute('data-disp-val'); el.textContent = pct(k, S[k]);
    });
    document.querySelectorAll('[data-disp-reset]').forEach(function (el) { el.disabled = S.bookLocked; });
    document.querySelectorAll('[data-disp-screen]').forEach(function (el) {
      var m = el.getAttribute('data-disp-screen'), full = S.screenMode === 'fullscreen';
      if (m === 'toggle') { el.setAttribute('aria-pressed', String(full)); el.classList.toggle('active', full); }
      else { var on = m === S.screenMode; el.setAttribute('aria-pressed', String(on)); el.classList.toggle('chip-active', on); el.classList.toggle('active', on); }
    });
    document.querySelectorAll('[data-disp-orient]').forEach(function (el) {
      var v = el.getAttribute('data-disp-orient'), on = String(S.orientation) === v;
      el.setAttribute('aria-pressed', String(on)); el.classList.toggle('active', on); el.classList.toggle('chip-active', on);
    });
    document.querySelectorAll('[data-disp-lock]').forEach(function (el) {
      el.setAttribute('aria-pressed', String(S.bookLocked));
      if (el.getAttribute('role') === 'switch') el.setAttribute('aria-checked', String(S.bookLocked));
      el.classList.toggle('active', S.bookLocked);
      el.classList.toggle('on', S.bookLocked);
    });
  }

  function bind() {
    document.addEventListener('input', function (e) {
      var el = e.target.closest && e.target.closest('input[data-disp]');
      if (el) set((function (o) { o[el.getAttribute('data-disp')] = el.value; return o; })({}), { live: true });
    });
    document.addEventListener('change', function (e) {          // slider released: persist the final value
      var el = e.target.closest && e.target.closest('input[data-disp]');
      if (el) { var k = el.getAttribute('data-disp'), p = {}; p[k] = el.value; set(p, { persist: true }); }
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-disp-screen],[data-disp-orient],[data-disp-lock],[data-disp-reset]');
      if (!t || t.disabled) return;
      if (t.hasAttribute('data-disp-screen')) {
        var m = t.getAttribute('data-disp-screen');
        set({ screenMode: m === 'toggle' ? (S.screenMode === 'fullscreen' ? 'windowed' : 'fullscreen') : m });
      } else if (t.hasAttribute('data-disp-orient')) {
        var v = t.getAttribute('data-disp-orient'), inBar = !!t.closest('.qbar');
        // in the reader bar, tapping the active rotation again releases the lock
        set({ orientation: inBar && String(S.orientation) === v ? 'auto' : v });
      } else if (t.hasAttribute('data-disp-lock')) {
        set({ bookLocked: !S.bookLocked }, { force: true });
      } else if (t.hasAttribute('data-disp-reset')) {
        var key = t.getAttribute('data-disp-reset'), pp = {}; pp[key] = DEFAULTS[key]; set(pp, { persist: true });
      }
    });
    document.addEventListener('visibilitychange', function () { lastVisChange = Date.now(); if (document.visibilityState === 'visible') resume(); });
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', function () { resume(); });
    window.addEventListener('orientationchange', function () { lastConfigChange = Date.now(); setTimeout(function () { resume(); }, 180); });
    window.addEventListener('resize', function () { lastConfigChange = Date.now(); });
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', function () { lastConfigChange = Date.now(); setTimeout(function () { if (active && S.orientation !== 'auto') applyOrientation(true); }, 180); });
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    render();
  }

  return {
    get: get, set: set, load: load, bind: bind, render: render, onChange: onChange,
    enterReader: enterReader, leaveReader: leaveReader, resume: resume, DEFAULTS: DEFAULTS, LIMITS: LIMITS
  };
})();
