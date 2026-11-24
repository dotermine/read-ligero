/**
 * CustomSelect — themed replacement for native <select> menus (the platform picker ignores the app theme).
 *
 * `CustomSelect.enhance(select)` keeps the real <select> in the DOM (hidden): its value / options / change events stay the
 * single source of truth, so all existing code (`sel.value = x`, `sel.addEventListener('change', …)`) keeps working.
 * Options are read when the list opens, so selects that are re-populated later need no extra call.
 * Supports <optgroup>, disabled options, keyboard (↑ ↓ Home End Enter Esc, type-ahead) and a filter box for long lists
 * (never auto-focused, so no on-screen keyboard pops up).
 */
var CustomSelect = (function () {
  'use strict';

  var openState = null;                          // { close }
  var valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  var indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function closeOpen() { if (openState) openState.close(); }

  function enhance(sel) {
    if (!sel || sel._cs) return sel && sel._cs;
    var wrap = el('div', 'cs' + (sel.classList.contains('qselect') ? ' cs-flex' : '') + (sel.style.width === 'auto' ? ' cs-auto' : ''));
    var btn = el('button', 'cs-btn'); btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    if (sel.id) btn.setAttribute('data-cs-for', sel.id);
    var lab = el('span', 'cs-label'), caret = el('span', 'cs-caret'); caret.setAttribute('aria-hidden', 'true'); caret.textContent = '▾';
    btn.append(lab, caret);
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(btn, sel);
    sel.classList.add('cs-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');

    function update() {
      var o = sel.options[indexDesc.get.call(sel)];
      lab.textContent = o ? o.textContent : '';
      btn.disabled = sel.disabled;
      var name = sel.getAttribute('aria-label') || (sel.id && document.querySelector('label[for="' + sel.id + '"]') ? document.querySelector('label[for="' + sel.id + '"]').textContent : '');
      if (name) btn.setAttribute('aria-label', name + ': ' + lab.textContent);
      if (sel.lang) lab.lang = sel.lang;
    }
    // programmatic changes (sel.value = …) must refresh the button too
    Object.defineProperty(sel, 'value', { configurable: true, get: function () { return valueDesc.get.call(sel); }, set: function (v) { valueDesc.set.call(sel, v); update(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: function () { return indexDesc.get.call(sel); }, set: function (v) { indexDesc.set.call(sel, v); update(); } });
    sel.addEventListener('change', update);
    new MutationObserver(update).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label'] });
    update();

    var pop = null, items = [], active = -1, typed = '', typedT = 0;

    function open() {
      closeOpen();
      pop = el('div', 'cs-pop'); pop.setAttribute('role', 'listbox');
      var scroller = el('div', 'cs-scroll');
      var filter = null, all = [];
      Array.prototype.forEach.call(sel.children, function (ch) {
        if (ch.tagName === 'OPTGROUP') {
          var g = el('div', 'cs-group', ch.label); g._grp = true; scroller.appendChild(g); all.push(g);
          Array.prototype.forEach.call(ch.children, function (o) { add(o, true); });
        } else if (ch.tagName === 'OPTION') add(ch, false);
      });
      function add(o, grouped) {
        var it = el('div', 'cs-opt' + (grouped ? ' cs-grouped' : '') + (o.disabled ? ' cs-disabled' : ''), o.textContent);
        it.setAttribute('role', 'option'); it.setAttribute('data-value', o.value); it._opt = o;
        it.setAttribute('aria-selected', String(o.selected)); if (o.disabled) it.setAttribute('aria-disabled', 'true');
        if (o.lang || sel.lang) it.lang = o.lang || sel.lang;
        it.addEventListener('click', function () { if (!o.disabled) choose(o); });
        scroller.appendChild(it); all.push(it);
      }
      items = all.filter(function (x) { return !x._grp; });
      if (items.length > 12) {                              // long lists (languages): filter box, not auto-focused
        filter = el('input', 'cs-filter'); filter.type = 'search'; filter.placeholder = '🔍'; filter.setAttribute('aria-label', 'Filter');
        filter.addEventListener('input', function () {
          var q = filter.value.trim().toLowerCase(), lastGroup = null, any = false;
          all.forEach(function (x) {
            if (x._grp) { lastGroup = x; x.hidden = true; return; }
            var ok = !q || x.textContent.toLowerCase().indexOf(q) > -1; x.hidden = !ok;
            if (ok && lastGroup) lastGroup.hidden = false; any = any || ok;
          });
        });
        pop.appendChild(filter);
      }
      pop.appendChild(scroller);
      document.body.appendChild(pop);
      btn.setAttribute('aria-expanded', 'true');
      place(); 
      var cur = items.filter(function (x) { return x._opt.selected; })[0];
      if (cur) { setActive(items.indexOf(cur)); scroller.scrollTop = Math.max(0, cur.offsetTop - scroller.clientHeight / 2 + cur.offsetHeight / 2); }
      setTimeout(function () {
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('resize', closeOpen); window.addEventListener('scroll', onScroll, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
      openState = { close: close };
    }

    function place() {
      var r = btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth, gap = 4;
      var below = vh - r.bottom - 12, above = r.top - 12, up = below < 220 && above > below;
      var maxH = Math.max(140, Math.min(340, up ? above : below));
      var w = Math.min(Math.max(r.width, 200), vw - 16);
      pop.style.width = w + 'px'; pop.style.maxHeight = maxH + 'px';
      var left = Math.min(Math.max(8, r.left), vw - w - 8);
      pop.style.left = left + 'px';
      pop.querySelector('.cs-scroll').style.maxHeight = (maxH - (pop.querySelector('.cs-filter') ? 52 : 0)) + 'px';
      if (up) { pop.style.bottom = (vh - r.top + gap) + 'px'; pop.style.top = 'auto'; } else { pop.style.top = (r.bottom + gap) + 'px'; pop.style.bottom = 'auto'; }
    }
    function onScroll(e) { if (pop && !pop.contains(e.target)) closeOpen(); }
    function outside(e) { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close(); }

    function setActive(i) {
      if (!items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      if (active > -1 && items[active]) items[active].classList.remove('cs-active');
      active = i; var it = items[i]; it.classList.add('cs-active');
      var sc = pop.querySelector('.cs-scroll');
      if (it.offsetTop < sc.scrollTop) sc.scrollTop = it.offsetTop; else if (it.offsetTop + it.offsetHeight > sc.scrollTop + sc.clientHeight) sc.scrollTop = it.offsetTop + it.offsetHeight - sc.clientHeight;
    }
    function step(d) { var i = active; do { i += d; } while (items[i] && (items[i].hidden || items[i]._opt.disabled)); if (items[i]) setActive(i); }
    function onKey(e) {
      if (!pop) return;
      var inFilter = e.target && e.target.classList && e.target.classList.contains('cs-filter');
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home' && !inFilter) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && !inFilter) { e.preventDefault(); setActive(items.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active]._opt); }
      else if (!inFilter && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {      // type-ahead
        typed += e.key.toLowerCase(); clearTimeout(typedT); typedT = setTimeout(function () { typed = ''; }, 700);
        for (var i = 0; i < items.length; i++) if (!items[i].hidden && items[i].textContent.toLowerCase().indexOf(typed) === 0) { setActive(i); break; }
      }
    }
    function choose(o) {
      var changed = sel.value !== o.value;
      sel.value = o.value;
      close(); btn.focus({ preventScroll: true });
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function close() {
      if (!pop) return;
      pop.remove(); pop = null; items = []; active = -1;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', closeOpen); window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey, true);
      if (openState && openState.close === close) openState = null;
    }
    btn.addEventListener('click', function () { if (pop) close(); else open(); });
    btn.addEventListener('keydown', function (e) { if (!pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); open(); } });
    return (sel._cs = { open: open, close: close, update: update, button: btn });
  }

  function enhanceAll(root) { Array.prototype.forEach.call((root || document).querySelectorAll('select:not([data-native])'), enhance); }

  return { enhance: enhance, enhanceAll: enhanceAll, closeAll: closeOpen };
})();
