/**
 * In-app notifications that replace alert()/confirm()/prompt().
 * Styled only with the app's CSS variables/classes (.modal, .modal-box, .btn, .inp), so every theme matches.
 */
const UI = (() => {
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const tr = (k, d) => (window.I18N && I18N.t(k) !== k ? I18N.t(k) : d);
  let host;

  /** Non-blocking toast. type: info | success | error | warn. Click to dismiss. Returns a dismiss function. */
  function toast(msg, type = 'info', ms = 3200) {
    if (!host || !host.isConnected) { host = el('div', 'toast-host'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
    const t = el('div', 'toast toast-' + type, msg); t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    let tm;
    const kill = () => { clearTimeout(tm); t.classList.add('toast-out'); setTimeout(() => t.remove(), 180); };
    t.onclick = kill; host.append(t);
    while (host.children.length > 3) host.firstChild.remove();
    tm = setTimeout(kill, ms);
    return kill;
  }

  /** Themed modal. Resolves with the clicked button's value; Esc / backdrop resolve `esc`. */
  function dlg(title, msg, btns, esc, input) {
    return new Promise(res => {
      const prev = document.activeElement, m = el('div', 'modal'), box = el('div', 'modal-box'), row = el('div', 'ui-actions');
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      if (title) box.append(el('h3', 'ui-title', title));
      if (msg) box.append(el('p', 'ui-msg', msg));
      let inp; if (input) { inp = el('input', 'inp'); inp.value = input.value || ''; inp.placeholder = input.placeholder || ''; box.append(inp); }
      const done = v => { document.removeEventListener('keydown', key, true); m.remove(); if (prev && prev.focus) prev.focus(); res(v); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(esc); } else if (e.key === 'Enter' && inp) { e.preventDefault(); done(inp.value); } };
      btns.forEach(b => { const x = el('button', 'btn ' + (b.cls || ''), b.label); x.type = 'button'; x.onclick = () => done(inp && b.value === true ? inp.value : b.value); row.append(x); });
      box.append(row); m.append(box); m.onclick = e => { if (e.target === m) done(esc); };
      document.body.append(m); document.addEventListener('keydown', key, true);
      (inp || row.querySelector('.accent,.danger') || row.lastChild).focus();
    });
  }

  const cancel = () => ({ label: tr('cancel', 'Cancel'), value: false });
  const ok = (o = {}) => ({ label: o.ok || tr('ok', 'OK'), value: true, cls: o.danger ? 'danger' : 'accent' });

  return {
    toast,
    /** confirm(msg,{title,ok,danger}) → Promise<boolean> */
    confirm: (msg, o = {}) => dlg(o.title || tr('confirmTitle', 'Confirm'), msg, [cancel(), ok(o)], false),
    /** alert(msg,{title}) → Promise<true> */
    alert: (msg, o = {}) => dlg(o.title || '', msg, [ok()], true),
    /** prompt(msg,{value,placeholder}) → Promise<string|null> */
    prompt: (msg, o = {}) => dlg(o.title || '', msg, [{ label: tr('cancel', 'Cancel'), value: null }, ok()], null, o),
    /** choose(title,msg,[{label,value,cls}]) → Promise<value|null> (3+ buttons, Esc/backdrop = null) */
    choose: (title, msg, btns) => dlg(title, msg, btns, null),
    t: tr
  };
})();
// Safety net: any stray native alert() becomes a non-blocking toast.
window.alert = m => { UI.toast(String(m), 'info', 4500); };
