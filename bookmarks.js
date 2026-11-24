/* global Reader, UI, I18N, addBookmark, listBookmarksForBook, removeBookmark */
/**
 * Bookmarks of the open book: add one at the current position, list them in a bottom sheet, jump to one, delete one.
 * Positions are stored as the reader's own snapshot ({location, frac} | {cfi} | {tp, tf}) so a jump is exact.
 * Wiring (see app.js):  Bookmarks.init({ bookId: () => id, pending: () => lastKnownProgress })
 */
var Bookmarks = (function () {
  'use strict';
  var deps = null, $ = function (id) { return document.getElementById(id); };
  var fmt = function (key) {
    var a = arguments, s = I18N.t(key);
    return s.replace(/\{(\d+)\}/g, function (m, i) { return a[Number(i) + 1] != null ? a[Number(i) + 1] : m; });
  };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function currentPos() {
    var snap = Reader.snapshot(), pend = deps.pending() || {};
    return Object.assign({}, pend, snap || {});          // freshest exact position, plus the percentage the reader reported
  }

  /** Adds a bookmark at the current reading position. */
  function add() {
    var id = deps.bookId(); if (!id) return Promise.resolve();
    var pos = currentPos(), pct = Math.round((pos.percentage || 0) * 100);
    var label = pos.location ? fmt('bmLabelPage', pos.location, pct) : fmt('bmLabelPct', pct);
    return addBookmark(id, label, pos.percentage || 0, pos.cfi || null, pos)
      .then(function () { UI.toast(I18N.t('bookmarkAdded'), 'success'); })
      .catch(function (e) { UI.toast(e.message, 'error'); });
  }

  function close() { var s = $('bmSheet'); if (s) s.hidden = true; }

  function render(list) {
    var body = $('bmBody'); body.textContent = '';
    $('bmCount').textContent = list.length ? '(' + list.length + ')' : '';
    if (!list.length) {
      var e = document.createElement('div'); e.className = 'ds-empty'; e.textContent = I18N.t('bmEmpty'); body.appendChild(e); return;
    }
    list.forEach(function (b) {
      var row = document.createElement('div'); row.className = 'bm-row';
      var d = new Date(b.createdAt || Date.now());
      row.innerHTML =
        '<button type="button" class="bm-go"><span class="bm-label">' + esc(b.label || '') + '</span>' +
        '<span class="bm-meta">' + esc(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) + '</span></button>' +
        '<button type="button" class="tbtn bm-del" aria-label="' + esc(I18N.t('delete')) + '" title="' + esc(I18N.t('delete')) + '">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>';
      row.querySelector('.bm-go').addEventListener('click', function () {
        close();
        Reader.goTo(b.pos || (b.cfi ? { cfi: b.cfi } : { percentage: b.percentage }));
      });
      row.querySelector('.bm-del').addEventListener('click', function () {
        removeBookmark(b.id).then(function () { row.remove(); list = list.filter(function (x) { return x.id !== b.id; }); render(list); });
      });
      body.appendChild(row);
    });
  }

  /** Opens the list of all bookmarks of the current book. */
  function open() {
    var id = deps.bookId(); if (!id) return;
    document.querySelectorAll('.toast').forEach(function (t) { t.remove(); });
    $('bmBody').textContent = '…'; $('bmSheet').hidden = false;
    listBookmarksForBook(id).then(render).catch(function (e) { $('bmBody').textContent = e.message; });
  }

  function init(d) {
    deps = d;
    var add_ = $('bmBtn'), list_ = $('bmListBtn');
    if (add_) add_.addEventListener('click', add);
    if (list_) list_.addEventListener('click', open);
    if ($('bmBackdrop')) $('bmBackdrop').addEventListener('click', close);
    if ($('bmClose')) $('bmClose').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  return { init: init, add: add, open: open, close: close };
})();
