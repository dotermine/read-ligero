/* global pdfjsLib, ePub, saveBookCover, getBook, getBookFile, getProgress, Display */
/**
 * Reader engine: PDF (pdf.js + self-built, pixel-aligned text layer), EPUB (epub.js), FB2/TXT.
 * Selection gestures use ONE Pointer-Events state machine for touch, pen and mouse:
 *   double-tap = word · triple-tap = sentence · long-press (or mouse drag) + drag = free multi-word selection.
 * Selection is drawn with the CSS Custom Highlight API (native selection is only a fallback).
 * Vocabulary marks: single words are wrapped in <span class="rt-mark rt-vocab|rt-look">; the saved translation of
 * vocabulary words is drawn above the word through a ::before pseudo-element (so it never pollutes the text content).
 */
const Reader = (() => {
  const $ = id => document.getElementById(id);
  const WORKER = 'lib/pdf.worker.min.js';
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
  // CMaps + standard fonts are shipped locally (and precached by the service worker) so every PDF renders offline
  const PDF_ASSETS = { cMapUrl: 'lib/cmaps/', cMapPacked: true, standardFontDataUrl: 'lib/standard_fonts/' };

  let lpMs = 500, mode = 'scroll', cur = null, seq = 0, sel = null, timer = 0;
  const cb = {}; // select / clear / blank callbacks

  const setLongPressDuration = ms => { lpMs = Math.max(200, Math.min(2000, Number(ms) || 500)); };
  const EDGE = 72;   // px: a tap this close to the top / bottom of the screen belongs to the toolbars, not to the text
  const setReadingMode = m => { mode = m === 'page' ? 'page' : 'scroll'; };

  // ===================== Vocabulary marks =====================
  let marks = { vocab: new Map(), looked: new Set() }; // vocab: key -> translation ('' if none); looked: Set of keys
  const markKey = s => String(s || '').toLowerCase().replace(/^['’]+|['’]+$/g, '');
  const setMarks = m => { marks = m || { vocab: new Map(), looked: new Set() }; };

  /** Removes all mark wrappers under `root` and merges the split text nodes back together. */
  function clearMarks(root) {
    const parents = new Set();
    root.querySelectorAll('span.rt-mark').forEach(s => { parents.add(s.parentNode); s.replaceWith(...s.childNodes); });
    parents.forEach(p => { if (p && p.isConnected) p.normalize(); });
  }

  /** (Re)applies marks to every word of `root` that is in the vocabulary or was looked up. */
  function applyMarks(root) {
    if (!root) return;
    clearMarks(root);
    if (!marks.vocab.size && !marks.looked.size) return;
    const doc = root.ownerDocument, tw = doc.createTreeWalker(root, 4), nodes = [], W = /[\p{L}\p{M}\p{N}'’]+/gu;
    let n; while ((n = tw.nextNode())) if (n.data.trim()) nodes.push(n);
    for (const node of nodes) {
      const hits = []; let m; W.lastIndex = 0;
      while ((m = W.exec(node.data))) {
        const raw = m[0], core = raw.replace(/^['’]+|['’]+$/g, ''), k = markKey(core);
        if (!k) continue;
        const inVocab = marks.vocab.has(k);
        if (!inVocab && !marks.looked.has(k)) continue;
        const a = m.index + (raw.length - raw.replace(/^['’]+/, '').length);
        hits.push([a, a + core.length, inVocab ? 'vocab' : 'look', inVocab ? marks.vocab.get(k) : '']);
      }
      for (let i = hits.length - 1; i >= 0; i--) { // reverse: earlier offsets stay valid after each split
        const [a, b, kind, tr] = hits[i], r = doc.createRange(), sp = doc.createElement('span');
        r.setStart(node, a); r.setEnd(node, b);
        sp.className = 'rt-mark rt-' + kind;
        if (tr) sp.dataset.tr = tr;
        r.surroundContents(sp);
      }
    }
  }

  /** Re-applies marks to everything currently rendered (call after the vocabulary / lookups changed). */
  function refreshMarks() {
    if (!cur) return;
    clearSel();
    if (cur.rend && cur.rend.getContents) cur.rend.getContents().forEach(ct => { if (ct.document) applyMarks(ct.document.body); });
    document.querySelectorAll('#pdfWrap .pdf-text-layer').forEach(applyMarks);
    const tb = document.querySelector('#textWrap .content');
    if (tb) applyMarks(tb);
  }

  // ===================== Sentence / word parsing =====================
  const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  const ABBR = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|fig|no|vol|inc|ltd|co|cf|al|approx|dept|est)$/i;
  const CLOSER = /["'»”’)\]]/;

  /** Word [start,end) around caret offset `i` in `t`, or null. Windowed so huge text nodes stay fast. */
  function wordBounds(t, i) {
    const lo = Math.max(0, i - 80), s = t.slice(lo, Math.min(t.length, i + 80)), p = i - lo, L = /[\p{L}\p{N}]/u;
    const k = p < s.length && L.test(s[p]) ? p : p > 0 && L.test(s[p - 1]) ? p - 1 : -1;
    if (k < 0) return null;
    if (SEG) {
      for (const g of SEG.segment(s)) if (k >= g.index && k < g.index + g.segment.length) return g.isWordLike ? [lo + g.index, lo + g.index + g.segment.length] : null;
      return null;
    }
    const W = /[\p{L}\p{M}\p{N}'’]/u; let a = k, b = k + 1;
    while (a > 0 && W.test(s[a - 1])) a--;
    while (b < s.length && W.test(s[b])) b++;
    while (a < b && /['’]/.test(s[a])) a++;
    while (b > a && /['’]/.test(s[b - 1])) b--;
    return [lo + a, lo + b];
  }

  /** True if the terminator at t[k] really ends a sentence (skips "3.5", "Dr.", "e.g.", initials, "...", lowercase continuation). */
  function isEnd(t, k) {
    const c = t[k];
    if (/[。！？]/.test(c)) return true;
    if (!/[.!?…]/.test(c) || /[.!?…]/.test(t[k + 1] || '')) return false;
    let j = k + 1;
    while (j < t.length && CLOSER.test(t[j])) j++;
    if (j < t.length && !/\s/.test(t[j])) return false;
    if (c === '.') {
      const m = /([\p{L}.]+)$/u.exec(t.slice(Math.max(0, k - 12), k)), w = m ? m[1] : '';
      if (ABBR.test(w) || /^\p{Lu}$/u.test(w)) return false;
      const n = /^\s*(\p{L})/u.exec(t.slice(j, j + 4));
      if (n && /\p{Ll}/u.test(n[1])) return false;
    }
    return true;
  }

  /** Sentence [start,end) containing index `i` of flat text `t` (closing quotes stay with their sentence). */
  function sentenceBounds(t, i) {
    let a = 0, b = t.length;
    for (let k = Math.min(i, t.length) - 1; k >= 0; k--) if (isEnd(t, k)) { a = k + 1; break; }
    while (a < b && CLOSER.test(t[a])) a++;
    while (a < b && /\s/.test(t[a])) a++;
    for (let k = Math.max(i, a); k < t.length; k++) if (isEnd(t, k)) { b = k + 1; while (b < t.length && CLOSER.test(t[b])) b++; break; }
    return [a, b];
  }

  // ===================== Flat text <-> DOM mapping =====================
  const scopeOf = n => {
    const el = n.nodeType === 1 ? n : n.parentElement;
    return el.closest('.pdf-text-layer,p,li,blockquote,h1,h2,h3,h4,h5,h6,dd,dt,td,pre') || el.ownerDocument.body;
  };

  /**
   * Concatenates all text nodes of `scope` into one string + node map, so a sentence can span
   * several PDF text items / lines. A space is inserted after end-of-line items (hyphenated breaks are glued).
   * A node counts as "end of line" when it is the last text of a [data-eol] span (also when wrapped in a mark span).
   */
  function flatten(scope) {
    const tw = scope.ownerDocument.createTreeWalker(scope, 4); // SHOW_TEXT
    let text = '', eol = false, n; const map = [];
    while ((n = tw.nextNode())) {
      const d = n.data; if (!d) continue;
      if (eol && text && !/\s$/.test(text) && !/^\s/.test(d) && !(/\w-$/.test(text) && /^\p{Ll}/u.test(d))) text += ' ';
      map.push({ n, s: text.length, e: text.length + d.length }); text += d;
      const q = n.parentElement && n.parentElement.closest('[data-eol]');
      eol = !!q && (n === q.lastChild || n.parentElement === q.lastChild);
    }
    return { text, map };
  }
  const idxOf = (f, node, off) => { const m = f.map.find(x => x.n === node); return m ? m.s + off : -1; };

  /** DOM point for flat index `i` (separator gaps snap to the nearest real text). */
  function pointOf(f, i, end) {
    let prev = null;
    for (const x of f.map) {
      if (i < x.s) return end && prev ? { n: prev.n, o: prev.e - prev.s } : { n: x.n, o: 0 };
      if (i < x.e || (end && i === x.e)) return { n: x.n, o: i - x.s };
      prev = x;
    }
    return prev ? { n: prev.n, o: prev.e - prev.s } : null;
  }

  function spanRange(f, a, b) {
    while (a < b && /\s/.test(f.text[a])) a++;
    while (b > a && /\s/.test(f.text[b - 1])) b--;
    const s = pointOf(f, a, false), e = pointOf(f, b, true);
    if (!s || !e || a >= b) return null;
    const r = f.map[0].n.ownerDocument.createRange(); r.setStart(s.n, s.o); r.setEnd(e.n, e.o); return r;
  }

  // ===================== Coordinate mapping (viewport point -> text) =====================
  /** Text-node caret at viewport point (x,y) of `doc`; null when the point isn't on a text node. */
  function caretAt(doc, x, y) {
    let n, o;
    if (doc.caretPositionFromPoint) { const p = doc.caretPositionFromPoint(x, y); if (p) { n = p.offsetNode; o = p.offset; } }
    else if (doc.caretRangeFromPoint) { const r = doc.caretRangeFromPoint(x, y); if (r) { n = r.startContainer; o = r.startOffset; } }
    return n && n.nodeType === 3 ? { n, o } : null;
  }
  const hit = (r, x, y, p = 6) => [...r.getClientRects()].some(k => x >= k.left - p && x <= k.right + p && y >= k.top - p && y <= k.bottom + p);
  const union = (a, b) => {
    const r = a.cloneRange();
    if (b.compareBoundaryPoints(0, a) < 0) r.setStart(b.startContainer, b.startOffset); // START_TO_START
    if (b.compareBoundaryPoints(2, a) > 0) r.setEnd(b.endContainer, b.endOffset);       // END_TO_END
    return r;
  };

  /**
   * Range under (x,y). kind 'word' | 'sentence'. Strict mode requires the point to be on the glyphs
   * (prevents "ghost" selections from taps in margins); `loose` (drag) snaps to the nearest caret.
   */
  function pick(doc, x, y, kind, loose) {
    const c = caretAt(doc, x, y); if (!c) return null;
    const wb = wordBounds(c.n.data, c.o), w = doc.createRange();
    if (!wb) { if (!loose) return null; w.setStart(c.n, c.o); w.collapse(true); return w; }
    w.setStart(c.n, wb[0]); w.setEnd(c.n, wb[1]);
    if (!loose && !hit(w, x, y)) return null;
    if (kind !== 'sentence') return w;
    const f = flatten(scopeOf(c.n)), i = idxOf(f, c.n, wb[0]);
    return (i >= 0 && spanRange(f, ...sentenceBounds(f.text, i))) || w;
  }

  // ===================== Selection state / popup feed =====================
  const wipe = w => { try { w.CSS.highlights.delete('reader-sel'); } catch (e) {} try { w.getSelection().removeAllRanges(); w.document.documentElement.classList.remove('native-sel'); } catch (e) {} };

  function clearSel() {
    clearTimeout(timer);
    if (!sel) return;
    wipe(sel.win); sel = null;
    if (cb.clear) cb.clear();
  }

  function paint(r) {
    const w = r.startContainer.ownerDocument.defaultView;
    if (sel && sel.win !== w) wipe(sel.win);
    sel = { r, win: w };
    if (w.CSS && w.CSS.highlights && w.Highlight) w.CSS.highlights.set('reader-sel', new w.Highlight(r));
    else { const s = w.getSelection(); s.removeAllRanges(); s.addRange(r.cloneRange()); w.document.documentElement.classList.add('native-sel'); }
  }

  /** Builds {text, context, rect} for the active selection and hands it to the UI. */
  function emit() {
    if (!sel) return;
    const r = sel.r, sc = r.startContainer, clean = s => s.replace(/\s+/g, ' ').trim();
    const f = flatten(scopeOf(sc)), a = idxOf(f, sc, r.startOffset), b = idxOf(f, r.endContainer, r.endOffset);
    const text = clean(a >= 0 && b >= a ? f.text.slice(a, b) : r.toString());
    if (!text) return clearSel();
    let ctx = text;
    if (a >= 0) ctx = clean(f.text.slice(sentenceBounds(f.text, a)[0], sentenceBounds(f.text, b >= a ? Math.max(a, b - 1) : a)[1])).slice(0, 600) || text;
    const rs = [...r.getClientRects()].filter(k => k.width > 0 || k.height > 0), fe = sel.win.frameElement, fr = fe ? fe.getBoundingClientRect() : { left: 0, top: 0 };
    if (!rs.length) return;
    const f0 = rs[0], l0 = rs[rs.length - 1];
    if (cb.select) cb.select({ text, context: ctx, rect: { top: f0.top + fr.top, bottom: l0.bottom + fr.top, left: f0.left + fr.left, x: (f0.left + f0.right) / 2 + fr.left } });
  }
  const emitSoon = ms => { clearTimeout(timer); timer = setTimeout(emit, ms); };

  // ===================== Unified pointer gestures =====================
  /**
   * Attaches the gesture state machine to `root` (main document element or an EPUB iframe body).
   * o.signal: AbortSignal for cleanup · o.onSwipe(dir): optional horizontal swipe (paged EPUB) ·
   * o.scroller(): scroll element panned when the page is dragged with the LEFT MOUSE BUTTON held down
   * (touch panning is native). A word is selected with a double click / long press (hold still, then drag to extend).
   */
  function attach(root, o = {}) {
    const doc = root.ownerDocument, opt = { signal: o.signal };
    const framePos = () => { const fe = doc.defaultView && doc.defaultView.frameElement; return fe ? fe.getBoundingClientRect() : { left: 0, top: 0 }; };
    let g = null, taps = 0, lastT = 0, lx = 0, ly = 0, raf = 0, blankT = 0;
    root.style.touchAction = o.onSwipe ? 'pan-y' : 'pan-x pan-y'; // scroll yes; browser pinch / double-tap zoom no (book zoom is handled by attachPinch)

    const end = () => { if (g) { clearTimeout(g.timer); g = null; } };
    const begin = G => { // enter free-selection mode at the press point
      if (g !== G || G.free) return;
      const w = pick(doc, G.x, G.y, 'word');
      if (!w) return;
      G.free = true; G.anchor = w; paint(w);
      try { root.setPointerCapture(G.id); } catch (e) {}
      if (navigator.vibrate) navigator.vibrate(25);
    };
    const extend = (x, y) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0; if (!g || !g.free) return;
        const f = pick(doc, x, y, 'word', true);
        if (f) paint(union(g.anchor, f));
      });
    };

    // Block native long-press menus / drag-selection / callouts
    ['contextmenu', 'selectstart', 'dragstart'].forEach(t => root.addEventListener(t, e => e.preventDefault(), opt));
    root.addEventListener('touchmove', e => { if (g && g.free && e.cancelable) e.preventDefault(); }, { passive: false, signal: o.signal });

    root.addEventListener('pointerdown', e => {
      if (!e.isPrimary || e.button > 0) return;
      end(); clearTimeout(blankT);                       // a new touch cancels a pending single-tap action
      const sc = o.scroller && o.scroller();
      const G = g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType, free: false, moved: false, sl: sc ? sc.scrollLeft : 0, st: sc ? sc.scrollTop : 0 };
      clearTimeout(timer); // pending popup of a previous tap
      G.timer = setTimeout(() => begin(G), lpMs);
    }, opt);

    root.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (g.free) { extend(e.clientX, e.clientY); return; }
      const d = Math.hypot(e.clientX - g.x, e.clientY - g.y);
      if (g.type === 'mouse') {
        if (e.buttons !== 1 || d <= 4) return;
        clearTimeout(g.timer); g.moved = true;
        const sc = o.scroller && o.scroller();
        if (sc) { // left button held + drag = pan the page, exactly like a finger
          sc.scrollTop = g.st - (e.clientY - g.y);
          if (!Display.get().bookLocked) sc.scrollLeft = g.sl - (e.clientX - g.x);
          root.style.cursor = 'grabbing';
        }
      } else if (d > 10) { clearTimeout(g.timer); g.moved = true; } // touch/pen: user is scrolling or swiping
    }, opt);

    root.addEventListener('pointerup', e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g; end(); root.style.cursor = '';
      if (G.free) { emitSoon(0); return; }             // long-press / drag selection already painted

      const dx = e.clientX - G.x, dy = e.clientY - G.y;
      if (G.moved || Math.hypot(dx, dy) > 10) {
        if (o.onSwipe && Math.abs(dx) > 50 && Math.abs(dy) < 40 && Date.now() - G.t < 600) o.onSwipe(dx < 0 ? 1 : -1);
        taps = 0; return;
      }

      const now = Date.now();
      const isDouble = now - lastT < 300 && Math.hypot(e.clientX - lx, e.clientY - ly) < 30;
      taps = isDouble ? taps + 1 : 1;
      lastT = now; lx = e.clientX; ly = e.clientY;

      // Single tap on a word that is already known (looked up or saved) opens the action menu at once.
      // Any other single tap dismisses the selection and is reported as a "blank tap" with its screen position
      // (the app uses it to show / hide the toolbars).
      if (taps < 2) {
        const known = e.target && e.target.closest ? e.target.closest('.rt-mark') : null;
        const fp = framePos(), py = e.clientY + fp.top, atEdge = py <= EDGE || py >= innerHeight - EDGE;
        if (known && !atEdge) {
          const r = pick(doc, e.clientX, e.clientY, 'word');
          if (r) { paint(r); emitSoon(0); return; }
        }
        if (sel) clearSel();
        // Reported after the double-tap window, so the 2nd tap of a double-tap near an edge never hits a freshly shown toolbar.
        if (cb.blank) { const f = framePos(), pt = { x: e.clientX + f.left, y: e.clientY + f.top }; blankT = setTimeout(() => { if (cb.blank) cb.blank(pt); }, 300); }
        return;
      }

      // Double tap → word selection + popup. Triple tap → sentence.
      const sent = taps >= 3;
      const r = pick(doc, e.clientX, e.clientY, sent ? 'sentence' : 'word');
      if (sent) taps = 0;
      if (r) { paint(r); emitSoon(0); }                // no debounce now: we already waited for the 2nd tap
      else { taps = 0; if (sel) clearSel(); }
    }, opt);

    root.addEventListener('pointercancel', e => {
      if (!g || e.pointerId !== g.id) return;
      const free = g.free; end(); root.style.cursor = '';
      if (free) emitSoon(0);
    }, opt);
  }

  // ===================== Isolated book zoom: pinch =====================
  /** Two-finger pinch on the book scales ONLY the book (Display.bookZoom). Ignored while the view is locked. */
  function attachPinch(root, signal) {
    let d0 = 0, z0 = 1, on = false;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    root.addEventListener('touchstart', e => {
      if (e.touches.length === 2 && !Display.get().bookLocked) { on = true; d0 = dist(e.touches) || 1; z0 = Display.get().bookZoom; clearSel(); }
    }, { passive: true, signal });
    root.addEventListener('touchmove', e => {
      if (!on || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      Display.set({ bookZoom: z0 * dist(e.touches) / d0 }, { live: true });
    }, { passive: false, signal });
    const end = e => { if (on && e.touches.length < 2) { on = false; Display.set({ bookZoom: Display.get().bookZoom }, { persist: true }); } };
    root.addEventListener('touchend', end, { signal });
    root.addEventListener('touchcancel', end, { signal });
  }

  // ===================== PDF =====================
  const mc = document.createElement('canvas').getContext('2d'), ascents = {};
  /** Ascent/(ascent+descent) of a font family, used to place text-layer spans exactly like pdf.js does. */
  function ascent(fam) {
    if (fam in ascents) return ascents[fam];
    mc.font = '30px ' + fam; const m = mc.measureText(''), a = m.fontBoundingBoxAscent, d = Math.abs(m.fontBoundingBoxDescent);
    return (ascents[fam] = a ? a / (a + d) : 0.8);
  }

  /**
   * Builds the transparent text layer for one page. `vp` is the SAME viewport used to render the canvas, and the
   * layer is a 100%×100% sibling of the canvas, so both share one CSS coordinate space at every zoom / devicePixelRatio.
   * Each span: left/top from viewport∘item transform (with font ascent offset), rotate(angle), scaleX to match glyph width.
   */
  function textLayer(tc, vp) {
    const div = document.createElement('div'), frag = document.createDocumentFragment(), T = pdfjsLib.Util.transform; let last = null;
    div.className = 'pdf-text-layer';
    for (const it of tc.items) {
      if (!it.str) { if (it.hasEOL && last) last.dataset.eol = '1'; continue; }
      const st = tc.styles[it.fontName] || {}, fam = st.fontFamily || 'sans-serif', tx = T(vp.transform, it.transform);
      let ang = Math.atan2(tx[1], tx[0]); if (st.vertical) ang += Math.PI / 2;
      const fh = Math.hypot(tx[2], tx[3]), fa = fh * ascent(fam);
      const left = ang ? tx[4] + fa * Math.sin(ang) : tx[4], top = ang ? tx[5] - fa * Math.cos(ang) : tx[5] - fa;
      const sp = document.createElement('span'); sp.textContent = it.str;
      let tr = ang ? `rotate(${ang}rad)` : '';
      if (!st.vertical && it.width > 0) { mc.font = `${fh}px ${fam}`; const w = mc.measureText(it.str).width; if (w > 0) tr += ` scaleX(${(it.width * vp.scale) / w})`; }
      sp.style.cssText = `left:${left}px;top:${top}px;font-size:${fh}px;font-family:${fam};transform:${tr}`;
      if (it.hasEOL) sp.dataset.eol = '1';
      frag.append(sp); last = sp;
    }
    div.append(frag); return div;
  }

  /** startPage + startFrac restore the exact scroll position (frac = fraction of the page height under the 30% line). */
  async function openPDF(buf, startPage, startFrac, prog, c) {
    if (!window.pdfjsLib) throw new Error('PDF engine is not loaded. Connect once to cache it for offline use.');
    const pdf = await pdfjsLib.getDocument(Object.assign({ data: new Uint8Array(buf.slice(0)) }, PDF_ASSETS)).promise; // copy: pdf.js may transfer the buffer
    if (cur !== c) { pdf.destroy(); return; }
    c.pdf = pdf;
    const wrap = $('pdfWrap'), N = pdf.numPages, base = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const mkInner = () => { const d = document.createElement('div'); d.className = 'pdf-inner'; return d; }; // relative box, as wide as the zoomed pages
    let inner = mkInner(); wrap.replaceChildren(inner);
    let W = 0, cw = 0, zoomBuilt = 1, raf = 0, zooming = false, busy = false, seqNo = 0;
    c.page = startPage || 1; c.frac = startFrac || 0;
    const clamp01 = x => Math.min(1, Math.max(0, x));

    const release = el => { if (!el._on) return; el._on = false; el._gen++; try { el._task && el._task.cancel(); } catch (e) {} el.replaceChildren(); };
    const draw = async el => { // canvas + text layer for one page (sizes come from `cw`)
      if (el._on) return; el._on = true; const gen = ++el._gen;
      try {
        const page = await pdf.getPage(+el.dataset.n); if (el._gen !== gen) return;
        const vp = page.getViewport({ scale: cw / page.getViewport({ scale: 1 }).width }), dpr = window.devicePixelRatio || 1;
        el.style.width = vp.width + 'px'; el.style.height = vp.height + 'px';
        const cv = document.createElement('canvas'); cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr);
        el.append(cv);
        const task = el._task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: [cv.width / vp.width, 0, 0, cv.height / vp.height, 0, 0] });
        const tc = await page.getTextContent(); if (el._gen !== gen) return;
        const layer = textLayer(tc, vp);
        applyMarks(layer); // vocabulary / lookup highlighting
        el.append(layer);
        await task.promise;
      } catch (e) { if (el._gen === gen) el._on = false; if (!e || e.name !== 'RenderingCancelledException') throw e; }
    };

    // ---- geometry helpers: a position is (page index, fraction of the page height) ----
    const pageAt = (box, y) => {
      const bx = box.children; let i = 0;
      while (i < bx.length - 1 && bx[i].offsetTop + bx[i].offsetHeight + 12 <= y) i++;
      const b = bx[i]; return { i, f: clamp01((y - b.offsetTop) / (b.offsetHeight || 1)) };
    };
    const yOf = (box, i, f) => { const b = box.children[Math.min(N, Math.max(1, i + 1)) - 1]; return b.offsetTop + f * b.offsetHeight; };
    const calc = () => { // saved reading position = what is under the 30 % line
      const a = pageAt(inner, wrap.scrollTop + wrap.clientHeight * 0.3);
      return { percentage: Math.min(1, (a.i + a.f) / N), location: a.i + 1, frac: a.f };
    };
    c.snap = calc;
    const sync = () => { // never while zooming / re-laying out / hidden (a hidden tab reports scrollTop 0)
      raf = 0; if (zooming || busy || !wrap.clientHeight) return;
      const p = calc(); c.page = p.location; c.frac = p.frac; if (prog) prog(p);
    };

    /** Creates the page boxes for the current width and the given zoom inside `box`. */
    const makePages = (box, zoom) => {
      zoomBuilt = zoom; W = wrap.clientWidth; cw = Math.max(200, Math.min(W - 8, 900)) * zoom;
      const h = (cw * base.height) / base.width, frag = document.createDocumentFragment();
      for (let n = 1; n <= N; n++) {
        const el = document.createElement('div'); el.className = 'pdf-page'; el.dataset.n = n; el._gen = 0;
        el.style.width = cw + 'px'; el.style.height = h + 'px'; frag.append(el);
      }
      box.append(frag);
    };
    const observe = () => { // lazy render + free far-away canvases
      if (c.io) c.io.disconnect();
      c.io = new IntersectionObserver(es => es.forEach(en => {
        if (en.isIntersecting) draw(en.target).catch(e => console.warn('PDF page', en.target.dataset.n, e));
        else release(en.target);
      }), { root: wrap, rootMargin: '1500px 0px' });
      [...inner.children].forEach(el => c.io.observe(el));
    };
    const restoreScroll = () => { wrap.scrollTop = Math.max(0, yOf(inner, c.page - 1, c.frac) - wrap.clientHeight * 0.3); };

    // ---- first layout ----
    makePages(inner, Display.get().bookZoom); observe(); restoreScroll();
    await draw(inner.children[Math.min(N, Math.max(1, c.page)) - 1]); // first visible page: errors surface to the fallback UI
    sync();

    wrap.addEventListener('scroll', () => { clearSel(); if (!raf) raf = requestAnimationFrame(sync); }, { passive: true, signal: c.ac.signal });

    // ---- smooth zoom ----
    // While a pinch / slider drag is running, the pages already on screen are only scaled with a GPU transform around the
    // viewport centre (instant, no re-render). When the gesture settles, the pages for the NEW size are built and rendered
    // in a hidden buffer; only when the visible ones are ready they replace the old ones in a single frame, with the same
    // point of the page still in the centre of the screen. Nothing is ever cleared before its replacement can be shown,
    // so there is no white flash and no jump.
    c.preview = z => {
      seqNo++;                                            // a commit that is still rendering is stale now
      if (!zooming) {
        zooming = true;
        inner.style.willChange = 'transform';
        inner.style.transformOrigin = (wrap.scrollLeft + wrap.clientWidth / 2) + 'px ' + (wrap.scrollTop + wrap.clientHeight / 2) + 'px';
      }
      inner.style.transform = 'scale(' + (z / zoomBuilt) + ')';
    };
    c.commit = async () => {
      if (cur !== c || !wrap.clientWidth || !wrap.clientHeight) return;
      const my = ++seqNo; busy = true;
      const a = pageAt(inner, wrap.scrollTop + wrap.clientHeight / 2);                                   // centre of the screen
      const fx = inner.scrollWidth ? (wrap.scrollLeft + wrap.clientWidth / 2) / inner.scrollWidth : 0.5;
      if (c.io) c.io.disconnect();                        // the old pages stay exactly as they are until the swap
      const next = mkInner();
      next.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none';
      wrap.append(next);
      makePages(next, Display.get().bookZoom);
      const top = yOf(next, a.i, a.f) - wrap.clientHeight / 2;
      const left = fx * Math.max(next.scrollWidth, wrap.clientWidth) - wrap.clientWidth / 2;
      const vis = [...next.children].filter(b => b.offsetTop + b.offsetHeight > top && b.offsetTop < top + wrap.clientHeight);
      try { await Promise.all(vis.map(draw)); } catch (e) { console.warn('PDF zoom render', e); }
      if (cur !== c || my !== seqNo) { next.remove(); if (my === seqNo) busy = false; return; }          // superseded: keep the old pages
      clearSel();
      inner.remove(); inner = next; inner.style.cssText = '';
      wrap.scrollTop = Math.max(0, top); wrap.scrollLeft = Math.max(0, left);
      zooming = false; busy = false;
      observe(); sync();
    };
    // Called (debounced) by the ResizeObserver on #bookStage (rotation, window size, bars) and after the tab was hidden.
    c.relayout = wasHidden => {
      if (cur !== c || !wrap.clientWidth) return;
      if (wasHidden) restoreScroll();                      // a hidden tab loses its scroll offset: put the saved position back
      if (wrap.clientWidth !== W || Display.get().bookZoom !== zoomBuilt) c.commit();
    };
    c.goTo = pos => { if (!pos || !pos.location) return; c.page = pos.location; c.frac = pos.frac || 0; restoreScroll(); sync(); };
    attach(wrap, { signal: c.ac.signal, scroller: () => wrap });
    attachPinch(wrap, c.ac.signal);
    return N;
  }

  // ===================== EPUB =====================
  /** CSS injected into every EPUB iframe: selection highlight + vocabulary marks. */
  const frameCss = () => {
    const v = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    return `html{-webkit-touch-callout:none}body{-webkit-tap-highlight-color:transparent}@media (pointer:coarse){html,body{-webkit-user-select:none;user-select:none}}html:not(.native-sel) ::selection{background:transparent}` +
      `::highlight(reader-sel){background-color:${v('--sel') || 'rgba(26,115,232,.35)'}}` +
      `.rt-mark{border-radius:3px;position:relative}.rt-vocab{background:${v('--mk-vocab')}}.rt-look{background:${v('--mk-look')}}` +
      `.rt-vocab[data-tr]::before{content:attr(data-tr);position:absolute;left:50%;bottom:100%;transform:translateX(-50%);font-size:${v('--gloss-size') || '.55em'};line-height:1;white-space:nowrap;color:${v('--mk-rt')};font-weight:600;pointer-events:none;max-width:12em;overflow:hidden;text-overflow:ellipsis}` +
      (document.documentElement.classList.contains('no-gloss') ? '.rt-vocab[data-tr]::before{display:none}' : '');
  };

  async function openEPUB(buf, cfi, prog, c) {
    if (!window.ePub) throw new Error('EPUB engine is not loaded.');
    if (!window.JSZip) throw new Error('JSZip is not loaded (needed by epub.js).');

    const paged = mode === 'page', cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim(), I = x => [x, true];
    const book = c.epub = ePub(buf.slice(0), { openAs: 'binary' });

    // Fail fast if the archive can't be opened
    await book.ready.catch(e => { throw new Error('EPUB parse failed: ' + (e && e.message ? e.message : e)); });

    const rend = c.rend = book.renderTo($('epubWrap'),
      paged
        ? { width: '100%', height: '100%', flow: 'paginated', spread: 'none' }
        : { width: '100%', height: '100%', flow: 'scrolled', manager: 'continuous' });

    const key = e => { if (e.key === 'ArrowRight') rend.next(); else if (e.key === 'ArrowLeft') rend.prev(); };
    if (paged) document.addEventListener('keydown', key, { signal: c.ac.signal });

    rend.themes.default({
      body: {
        color: I(v('--text')), background: I('transparent'),
        'line-height': I(v('--line-height')),
        'text-align': I(v('--text-align'))
      }
    });
    const eWrap = $('epubWrap');
    c.epubZoom = Display.get().bookZoom;
    c.applyEpubFont = () => { // book zoom = font scaling of the book only (the app UI is never touched)
      const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-size')) || 18, z = Display.get().bookZoom;
      c.epubZoom = z; eWrap.style.transform = '';
      try { rend.themes.override('font-size', Math.round(px * z * 10) / 10 + 'px', true); } catch (e) {}
    };
    c.applyEpubFont();
    c.relayout = wasHidden => { try { rend.resize(); if (wasHidden && c.lastCfi) rend.display(c.lastCfi); } catch (e) {} };
    // Smooth zoom: scale the rendered book with a transform while pinching, re-flow once at the end
    c.preview = z => { if (!c.zCfi) c.zCfi = c.exactCfi() || c.lastCfi; eWrap.style.willChange = 'transform'; eWrap.style.transformOrigin = '50% 50%'; eWrap.style.transform = 'scale(' + (z / c.epubZoom) + ')'; };
    c.commit = () => { // re-flow at the final size, then put the same text back at the top
      const cfi = c.zCfi || c.exactCfi() || c.lastCfi; c.zCfi = null;
      c.applyEpubFont(); eWrap.style.willChange = '';
      if (cfi) { c.lastCfi = cfi; setTimeout(() => { Promise.resolve().then(() => rend.display(cfi)).catch(() => {}); }, 120); }   // after the re-flow started
    };
    /** Character-level CFI of the text at the top of the viewport (scrolled flow); more exact than the paragraph-level start CFI. */
    c.exactCfi = () => {
      if (paged) return null;
      try {
        const cr = rend.manager.container.getBoundingClientRect();
        for (const ct of rend.getContents()) {
          const fe = ct.document.defaultView.frameElement; if (!fe) continue;
          const fr = fe.getBoundingClientRect(), y = cr.top - fr.top + 6;
          if (y < 0 || y > fr.height) continue;
          const rg = ct.document.caretRangeFromPoint ? ct.document.caretRangeFromPoint(12, y) : null;
          if (rg && rg.startContainer && rg.startContainer.nodeType === 3) return ct.cfiFromRange(rg);
        }
      } catch (e) {}
      return null;
    };
    c.goTo = pos => { if (pos && pos.cfi) { c.lastCfi = pos.cfi; Promise.resolve().then(() => rend.display(pos.cfi)).catch(() => {}); } };
    if (!paged) {
      let st = 0;
      const wireScroll = () => {
        const sc = rend.manager && rend.manager.container; if (!sc || sc._rlWired) return; sc._rlWired = true;
        sc.addEventListener('scroll', () => {
          clearTimeout(st);
          st = setTimeout(() => {
            if (cur !== c || !c.ready || !$('bookStage').clientHeight) return;
            const cfi = c.exactCfi(); if (!cfi) return;
            c.lastCfi = cfi; if (prog) prog({ cfi });
          }, 250);
        }, { passive: true, signal: c.ac.signal });
      };
      rend.on('rendered', wireScroll); wireScroll();
    }
    c.snap = () => {
      const l = rend.currentLocation && rend.currentLocation(); const s = l && l.start;
      const cfi = c.exactCfi() || (s && s.cfi) || c.lastCfi;
      if (cfi) c.lastCfi = cfi;                            // also the reference used to restore after a hidden tab / zoom
      return cfi ? { cfi } : null;
    };

    rend.hooks.content.register(ct => {
      const d = ct.document, st = d.createElement('style');
      st.id = 'rl-frame-css';
      st.textContent = frameCss();
      d.head.appendChild(st);
      d.documentElement.style.touchAction = paged ? 'pan-y' : 'pan-x pan-y';
      applyMarks(d.body);
      attach(d.body, { signal: c.ac.signal, onSwipe: paged ? s => (s > 0 ? rend.next() : rend.prev()) : null, scroller: () => (paged ? null : rend.manager.container) });
      attachPinch(d.body, c.ac.signal);
      if (paged) d.addEventListener('keydown', key);
      d.addEventListener('scroll', clearSel, { passive: true });
    });

    rend.on('relocated', l => {
      const s = l.start; if (!s) return; clearSel();
      if (!$('bookStage').clientHeight) return;                // hidden tab: the layout is meaningless, do not record it
      const pc = book.locations && book.locations.length() ? book.locations.percentageFromCfi(s.cfi) : s.percentage || 0;
      c.lastCfi = c.exactCfi() || s.cfi;
      if (prog) prog({ percentage: pc, cfi: c.lastCfi });
    });

    // Display the saved position. If the stored CFI fails, fall back to the start.
    try { await rend.display(cfi || undefined); }
    catch (e) { console.warn('[epub] display(cfi) failed, retrying from start', e); await rend.display(); }

    // Locations for progress % — do NOT await this before display, it's slow.
    book.ready.then(() => book.locations.generate(1600)).catch(() => {});
  }

  // ===================== FB2 / TXT =====================
  /** Decodes bytes honoring the XML encoding declaration; falls back utf-8 → windows-1251. */
  function decode(buf) {
    const u = new Uint8Array(buf), m = /encoding=["']([\w-]+)["']/i.exec(new TextDecoder('latin1').decode(u.subarray(0, 200)));
    for (const enc of [m && m[1], 'utf-8']) if (enc) { try { return new TextDecoder(enc, { fatal: true }).decode(u); } catch (e) {} }
    return new TextDecoder('windows-1251').decode(u);
  }

  async function openText(buf, fmt, saved, prog, c) {
    const wrap = $('textWrap'), box = document.createElement('div'), txt = decode(buf), add = (tag, s) => { s = s.replace(/\s+/g, ' ').trim(); if (s) { const p = document.createElement(tag); p.textContent = s; box.append(p); } };
    box.className = 'content';
    if (fmt === 'fb2') {
      const d = new DOMParser().parseFromString(txt, 'application/xml');
      if (d.querySelector('parsererror')) throw new Error('Invalid FB2 file.');
      d.querySelectorAll('body p, body v, body subtitle, body text-author').forEach(e => add(e.closest('title') ? 'h2' : 'p', e.textContent));
      if (!box.children.length) add('p', d.documentElement.textContent);
    } else txt.split(/\r?\n+/).forEach(l => add('p', l));
    if (!box.children.length) throw new Error('The file contains no readable text.');
    wrap.replaceChildren(box);
    applyMarks(box);
    // Exact position = paragraph index + fraction of that paragraph above the top edge. Unlike a plain scroll
    // percentage it survives zoom, font changes and rotation (the text re-flows, the anchor stays).
    const items = box.children;
    const anchorGet = () => {
      let lo = 0, hi = items.length - 1; const top = wrap.scrollTop;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (items[mid].offsetTop <= top) lo = mid; else hi = mid - 1; }
      return { tp: lo, tf: Math.min(1, Math.max(0, (top - items[lo].offsetTop) / span(lo))) };
    };
    // a paragraph "slot" runs from its top to the top of the next one (so the margin between paragraphs is part of it)
    const span = i => { const it = items[i], nx = items[i + 1]; return Math.max(1, nx ? nx.offsetTop - it.offsetTop : it.offsetHeight); };
    const anchorSet = a => { if (!a) return; const i = Math.min(items.length - 1, Math.max(0, a.tp)); wrap.scrollTop = items[i].offsetTop + (a.tf || 0) * span(i); };
    const calc = () => {
      const mx = wrap.scrollWidth - wrap.clientWidth, my = wrap.scrollHeight - wrap.clientHeight, vertical = my >= mx;
      const p = { percentage: vertical ? (my > 0 ? wrap.scrollTop / my : 1) : (mx > 0 ? wrap.scrollLeft / mx : 0) };
      if (vertical) Object.assign(p, anchorGet());
      return p;
    };
    let last = null, zA = null, touched = false;
    wrap.addEventListener('pointerdown', () => { touched = true; }, { passive: true, signal: c.ac.signal });
    const sync = () => { if (zA || !wrap.clientHeight) return; last = calc(); if (prog) prog(last); };   // hidden tab: scrollTop reads 0, never save that
    c.snap = calc;
    c.goTo = pos => {
      if (!pos) return;
      if (pos.tp != null) anchorSet(pos);
      else if (pos.percentage != null) { const my = wrap.scrollHeight - wrap.clientHeight; wrap.scrollTop = pos.percentage * my; }
      sync();
    };
    wrap.addEventListener('scroll', () => { clearSel(); sync(); }, { passive: true, signal: c.ac.signal });
    attach(wrap, { signal: c.ac.signal, scroller: () => wrap });
    attachPinch(wrap, c.ac.signal);
    // zoom re-flows the text through a CSS variable (real time); the anchor keeps the same words under the top edge
    c.preview = () => { if (!zA) zA = last || calc(); anchorSet(zA); };
    c.commit = () => { anchorSet(zA || last); zA = null; sync(); };     // `last` = position before the re-flow, also for non-gesture zoom changes
    c.relayout = () => { if (last && last.tp != null) anchorSet(last); };   // also after the tab was hidden
    const restore = () => { // saved position along whichever axis scrolls (paragraph anchor first, percentage as fallback)
      const mx = wrap.scrollWidth - wrap.clientWidth, my = wrap.scrollHeight - wrap.clientHeight;
      if (saved && saved.tp != null && my >= mx) anchorSet(saved);
      else if (saved && saved.percentage) { if (my >= mx && my > 0) wrap.scrollTop = saved.percentage * my; else if (mx > 0) wrap.scrollLeft = saved.percentage * mx; }
      sync();
    };
    requestAnimationFrame(() => { restore(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (cur === c && !touched) restore(); }); });
  }

  // ===================== Live style updates (settings changed while a book is open) =====================
  /** Re-injects the mark / gloss CSS into every EPUB frame and re-applies typography (font size, spacing, alignment). */
  function updateStyles() {
    if (!cur) return;
    if (cur.rend) {
      try {
        const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
        cur.rend.themes.default({ body: { color: [v('--text'), true], 'line-height': [v('--line-height'), true], 'text-align': [v('--text-align'), true] } });
        if (cur.applyEpubFont) cur.applyEpubFont();
        cur.rend.getContents().forEach(ct => { const st = ct.document.getElementById('rl-frame-css'); if (st) st.textContent = frameCss(); });
      } catch (e) {}
    }
  }

  /** Display (zoom / position / lock) changed. Text & PDF follow CSS / the stage resize; EPUB needs its font size updated. */
  let zt = 0;
  function applyDisplay(changed, opts) {
    if (!cur || !changed || !changed.bookZoom) return;
    const c = cur;
    if (opts && opts.live) {                       // pinch / slider drag: instant preview now, one sharp re-render when it settles
      if (c.preview) c.preview(Display.get().bookZoom);
      clearTimeout(zt); zt = setTimeout(() => { if (cur === c && c.commit) c.commit(); }, 350);
    } else {                                       // gesture ended / button / reset: commit immediately
      clearTimeout(zt); if (c.commit) c.commit();
    }
  }
  if (typeof Display !== 'undefined') Display.onChange((s, changed, opts) => applyDisplay(changed, opts));

  /** Freshest reading position of the open book (exact scroll anchor / CFI). Used when the book is closed or the app is hidden. */
  /** Jumps to a position taken earlier from snapshot() (bookmarks). */
  function goTo(pos) { try { if (cur && cur.goTo) cur.goTo(pos); } catch (e) { console.warn('goTo', e); } }

  function snapshot() { try { return cur && cur.ready && !cur.hidden && $('bookStage').clientHeight > 0 && cur.snap ? cur.snap() : null; } catch (e) { return null; } }

  // ===================== Public API =====================
  /**
   * File loader. Loads book + file + progress from IndexedDB, normalises the stored data to an ArrayBuffer,
   * then dispatches by format. Stale opens (user switched book) are dropped; any failure rejects so the UI can show a fallback.
   */
  async function open(id, onProgress, onReady) {
    close();
    const c = cur = { ac: new AbortController() }, my = ++seq;
    const [book, file, p] = await Promise.all([getBook(id), getBookFile(id), getProgress(id)]);
    if (cur !== c || my !== seq) return;
    if (!book) throw new Error('Book not found.');
    if (!file || !file.data) throw new Error('Book file is missing from storage.');
    let buf = file.data; if (buf instanceof Blob) buf = await buf.arrayBuffer();
    if (!buf.byteLength) throw new Error('Book file is empty.');
    if (onReady) onReady(book);
    ['pdfWrap', 'epubWrap', 'textWrap'].forEach(i => { $(i).hidden = true; });
    const pr = p || {}, wrapId = { pdf: 'pdfWrap', epub: 'epubWrap' }[book.format] || 'textWrap';
    $(wrapId).hidden = false;
    // Any change of the book area (rotation, window resize, bars) re-lays the book out. While the Read tab is hidden
    // (display:none) the size is 0: nothing is re-laid out and nothing is saved; when it is shown again the saved
    // position is restored (browsers reset the scroll offset of hidden elements).
    const stage = $('bookStage'), visible = () => stage.clientWidth > 0 && stage.clientHeight > 0;
    const safeProg = p => { if (visible() && onProgress) onProgress(p); };
    if (stage && window.ResizeObserver) {
      c.ro = new ResizeObserver(() => {
        clearTimeout(c.rt);
        if (!visible()) { c.hidden = true; return; }
        c.rt = setTimeout(() => {
          if (cur !== c || !visible()) return;
          const was = !!c.hidden; c.hidden = false;
          if (c.relayout) c.relayout(was);
        }, c.hidden ? 40 : 150);
      });
      c.ro.observe(stage);
    }
    if (book.format === 'pdf') await openPDF(buf, Number(pr.location) || 1, Number(pr.frac) || 0, safeProg, c);
    else if (book.format === 'epub') await openEPUB(buf, pr.cfi, safeProg, c);
    else await openText(buf, book.format, pr, safeProg, c);
    c.ready = true;                                  // from now on snapshot() may be saved (never before the saved position is restored)
  }

  function close() {
    clearSel();
    if (!cur) return;
    const c = cur; cur = null; seq++;
    c.ac.abort();
    clearTimeout(c.rt); if (c.ro) c.ro.disconnect();
    if (c.io) c.io.disconnect();
    [() => c.pdf && c.pdf.destroy(), () => c.rend && c.rend.destroy(), () => c.epub && c.epub.destroy()].forEach(f => { try { Promise.resolve(f()).catch(() => {}); } catch (e) {} });
    ['pdfWrap', 'epubWrap', 'textWrap'].forEach(i => { const e = $(i); if (e) e.replaceChildren(); });
  }

  // ===================== Covers =====================
  function generateCoverForBook(id, fmt, buf) {
    const f = { epub: epubCover, pdf: pdfCover, fb2: fb2Cover }[fmt];
    return f ? f(id, buf).catch(() => null) : Promise.resolve();
  }

  async function epubCover(id, buf) {
    const book = ePub(buf.slice(0));
    try {
      // Wait until the OPF is parsed — coverUrl() returns undefined before this.
      await book.ready.catch(function () {});
      const url = await book.coverUrl();
      if (!url) return;
      const d = await fetch(url)
        .then(function (r) { return r.blob(); })
        .then(function (b) {
          return new Promise(function (res) {
            const fr = new FileReader();
            fr.onload = function () { res(fr.result); };
            fr.onerror = function () { res(null); };
            fr.readAsDataURL(b);
          });
        })
        .catch(function () { return null; });
      if (d) await saveBookCover(id, d);
    } finally {
      try { book.destroy(); } catch (e) {}
    }
  }

  async function pdfCover(id, buf) {
    if (!window.pdfjsLib) return;
    const pdf = await pdfjsLib.getDocument(Object.assign({ data: new Uint8Array(buf.slice(0)) }, PDF_ASSETS)).promise;
    try {
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 0.6 });
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(vp.width));
      cv.height = Math.max(1, Math.round(vp.height));
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      await saveBookCover(id, cv.toDataURL('image/jpeg', 0.8));
    } finally {
      try { pdf.destroy(); } catch (e) {}
    }
  }

  async function fb2Cover(id, buf) {
    const doc = new DOMParser().parseFromString(decode(buf), 'application/xml');
    const im = doc.querySelector('coverpage image') || doc.querySelector('image');
    if (!im) return;
    const href = (im.getAttribute('l:href') || im.getAttribute('xlink:href') || im.getAttribute('href') || '').replace(/^#/, '');
    const bin = [...doc.querySelectorAll('binary')].find(b => b.getAttribute('id') === href);
    if (bin) await saveBookCover(id, `data:${bin.getAttribute('content-type') || 'image/jpeg'};base64,${(bin.textContent || '').replace(/\s+/g, '')}`);
  }

  return {
    open, close, generateCoverForBook, setLongPressDuration, setReadingMode,
    setMarks, refreshMarks, markKey, updateStyles, applyDisplay, snapshot, goTo,
    getLongPressDuration: () => lpMs,
    onSelection: f => { cb.select = f; }, onClear: f => { cb.clear = f; }, onBlankTap: f => { cb.blank = f; },
    clearSelection: clearSel, hasSelection: () => !!sel, EDGE
  };
})();
