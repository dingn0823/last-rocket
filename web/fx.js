// Shared full-screen effect, used by the phone simulator and the bridge.
export const FX_LABELS = {
  launch: '🚀 LIFTOFF',
  combo: '⚡ COMBO',
  legendary: '✨ LEGENDARY',
  shield: '🛡️ SAVED',
  landing: '🌕 TOUCHDOWN',
  drift: '🛰️ ADRIFT',
  crash: '💥 LOST',
};

export function playFx(fx, sub) {
  const el = document.createElement('div');
  el.className = 'fx-overlay';
  const text = document.createElement('div');
  text.className = `fx-text fx-${fx}`;
  text.textContent = FX_LABELS[fx] ?? fx.toUpperCase();
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
