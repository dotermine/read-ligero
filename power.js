/**
 * Power — keeps the app usable while reading.
 *
 *  keepAwake  Screen Wake Lock API: the screen stays on while a book is open and visible. The browser releases the lock
 *             whenever the page is hidden, so it is requested again every time the app becomes visible.
 *  keepAlive  Best-effort protection against the OS freezing/closing the page in the background. A web page cannot force
 *             this; what is permitted — and done here — is holding a shared Web Lock for as long as a book is open
 *             (Chrome does not freeze pages that hold one). The persistent-storage request and the "restore the book after
 *             a restart" feature (app.js) complete the strategy.
 */
var Power = (function () {
  'use strict';
  var cfg = { keepAwake: true, keepAlive: false };
  var reading = false, wake = null, wakePending = false, aliveRelease = null, alivePending = false;

  function releaseWake() { if (wake) { try { wake.release(); } catch (e) {} wake = null; } }

  function syncWake() {
    var need = reading && cfg.keepAwake && document.visibilityState === 'visible' && 'wakeLock' in navigator;
    if (!need) { releaseWake(); return; }
    if (wake || wakePending) return;
    wakePending = true;
    navigator.wakeLock.request('screen').then(function (l) {
      wakePending = false; wake = l;
      l.addEventListener('release', function () { if (wake === l) wake = null; });
      if (!(reading && cfg.keepAwake)) releaseWake();
    }).catch(function () { wakePending = false; });         // e.g. battery saver: try again at the next visibility change
  }

  function syncAlive() {
    var need = reading && cfg.keepAlive && !!navigator.locks;
    if (!need) { if (aliveRelease) { aliveRelease(); aliveRelease = null; } return; }
    if (aliveRelease || alivePending) return;
    alivePending = true;
    navigator.locks.request('readligero-keepalive', { mode: 'shared' }, function () {
      alivePending = false;
      return new Promise(function (resolve) { aliveRelease = resolve; if (!(reading && cfg.keepAlive)) { resolve(); aliveRelease = null; } });
    }).catch(function () { alivePending = false; });
  }

  function sync() { syncWake(); syncAlive(); }
  document.addEventListener('visibilitychange', sync);

  return {
    /** { keepAwake, keepAlive } */
    configure: function (c) { for (var k in c) if (k in cfg) cfg[k] = !!c[k]; sync(); },
    /** true while a book is open and the Read tab is showing */
    setReading: function (b) { reading = !!b; sync(); },
    status: function () { return { wake: !!wake, alive: !!aliveRelease, wakeSupported: 'wakeLock' in navigator, locksSupported: !!navigator.locks }; }
  };
})();
