// Shared helpers for the phone simulator and the bridge: UI strings, full-screen effects.

let UI = null;
let lang = 'en';

export async function loadUi() {
  UI = await (await fetch('/api/ui')).json();
  return UI;
}

export function setLang(l) {
  lang = l === 'zh' ? 'zh' : 'en';
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-ui]')) el.textContent = ui(el.dataset.ui);
}

export function getLang() {
  return lang;
}

/** UI string for the current run's language; falls back to English. */
export function ui(key, vars = {}) {
  const v = UI?.[lang]?.[key] ?? UI?.en?.[key] ?? key;
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : v;
}

export function playFx(fx, sub) {
  const el = document.createElement('div');
  el.className = 'fx-overlay';
  const text = document.createElement('div');
  text.className = `fx-text fx-${fx}`;
  text.textContent = ui('fx')?.[fx] ?? fx.toUpperCase();
  if (sub) {
    const s = document.createElement('span');
    s.className = 'fx-sub';
    s.textContent = sub;
    text.appendChild(s);
  }
  el.appendChild(text);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
