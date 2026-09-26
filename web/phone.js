// iMessage simulator: talks to the same game service a real Photon channel would.
import { escapeHtml, loadUi, playFx, setLang, ui } from './fx.js';

const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('text');
const fileInput = document.getElementById('file');
const preview = document.getElementById('preview');
const bridgeLink = document.getElementById('bridge');

let address = localStorage.getItem('lr_address');
let pendingImage = null;
const queue = [];
let draining = false;
let typingEl = null;

// ---------- rendering ----------

function scrollDown() {
  log.scrollTop = log.scrollHeight;
}

function row(dir, el) {
  const r = document.createElement('div');
  r.className = `row ${dir}`;
  r.appendChild(el);
  log.appendChild(r);
  scrollDown();
}

function bubble(dir, text) {
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  row(dir, b);
}

function renderOut(m, live) {
  if (m.t === 'text') return bubble('in', m.text);
  if (m.t === 'scene') {
    const el = document.createElement('div');
    el.className = 'scene';
    el.innerHTML = `<div class="icon">${escapeHtml(m.icon)}</div><div class="title">${escapeHtml(m.title)}</div>`;
    return row('in', el);
  }
  if (m.t === 'gear_card') {
    const c = m.card;
    const el = document.createElement('div');
    el.className = `card ${c.rarity ?? ''}`;
    el.innerHTML = `
      ${c.photoUrl ? `<img class="thumb" src="${escapeHtml(c.photoUrl)}" alt="" />` : ''}
      <div class="top"><div class="gicon">${escapeHtml(c.icon)}</div>
        <div><div class="gname">${escapeHtml(c.name)}</div><div class="gsub">${escapeHtml(c.subtitle)}</div></div></div>
      <div class="geffect">${escapeHtml(c.effectText)}</div>
      ${c.blurb ? `<div class="gblurb">${escapeHtml(c.blurb)}</div>` : ''}`;
    return row('in', el);
  }
  if (m.t === 'fx') {
    if (live) playFx(m.fx, m.text);
    return;
  }
  if (m.t === 'report') {
    const r = m.report;
    const el = document.createElement('div');
    el.className = `report ${r.kind}`;
    el.innerHTML = `
      <h3>${escapeHtml(r.title)}</h3>
      <div class="score">${r.score}</div>
      <div class="res"><span>⛽ ${r.res.fuel}</span><span>🫁 ${r.res.oxygen}</span><span>🛠️ ${r.res.hull}</span></div>
      ${r.item ? `<div class="line">${escapeHtml(r.item.icon)} ${sameName(r.item) ? '' : `${escapeHtml(r.item.label)} → `}${escapeHtml(r.item.name)} · <b>${r.item.status === 'kept' ? ui('kept') : ui('sacrificed')}</b></div>` : ''}
      ${r.upgrades.length ? `<div class="line">${ui('gear')}: ${r.upgrades.map((u) => `${escapeHtml(u.icon)} ${escapeHtml(u.name)}`).join(', ')}</div>` : ''}
      ${r.combos.length ? `<div class="line">${ui('combos')}: ${r.combos.map((u) => `${escapeHtml(u.icon)} ${escapeHtml(u.name)}`).join(', ')}</div>` : ''}`;
    return row('in', el);
  }
}

// Standard Supplies: label and gear name are the same thing, show it once.
function sameName(item) {
  return item.label.trim().toLowerCase() === item.name.trim().toLowerCase();
}

function renderIn(m) {
  if (m.imageUrl) {
    const img = document.createElement('img');
    img.className = 'photo';
    img.src = m.imageUrl;
    img.onload = scrollDown;
    row('me', img);
  }
  if (m.text) bubble('me', m.text);
}

function showTyping(on) {
  if (on && !typingEl) {
    typingEl = document.createElement('div');
    typingEl.className = 'row in';
    typingEl.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
    log.appendChild(typingEl);
    scrollDown();
  } else if (!on && typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

// Paced delivery with a typing indicator, like a real chat.
async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const m = queue.shift();
    if (m.t !== 'fx') {
      showTyping(true);
      const len = m.t === 'text' ? m.text.length : 60;
      await new Promise((r) => setTimeout(r, Math.min(350 + len * 9, 1300)));
      showTyping(false);
    }
    renderOut(m, true);
    if (m.t === 'fx') await new Promise((r) => setTimeout(r, 700));
  }
  draining = false;
}

// ---------- networking ----------

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function sendMessage(text, image) {
  if (!text && !image) return;
  renderIn({ text, imageUrl: image });
  try {
    await api('/api/sim/message', { address, msgId: crypto.randomUUID(), text: text || undefined, image: image || undefined });
  } catch (e) {
    const s = document.createElement('div');
    s.className = 'sys';
    s.textContent = ui('notDelivered');
    log.appendChild(s);
  }
}

function setBridge(url) {
  if (url) bridgeLink.href = url;
}

function applyLang(l) {
  setLang(l);
  input.placeholder = ui('placeholder');
}

/** First visit: like scanning the QR code. The first message also picks the language. */
function showStart() {
  const box = document.createElement('div');
  box.className = 'start';
  box.innerHTML = `<span>${escapeHtml(ui('startHint'))}</span><div><button data-t="join">join</button><button data-t="加入">加入</button></div>`;
  box.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    box.remove();
    sendMessage(b.dataset.t);
  }));
  log.appendChild(box);
}

async function boot() {
  await loadUi();
  applyLang('en');
  if (address) {
    try {
      const h = await api(`/api/sim/history?address=${encodeURIComponent(address)}`);
      if (h.lang) applyLang(h.lang);
      for (const e of h.transcript) e.dir === 'in' ? renderIn(e.msg) : renderOut(e.msg, false);
      setBridge(h.bridgeUrl);
    } catch {
      address = null;
    }
  }
  if (!address) {
    address = (await api('/api/sim/new', { nickname: 'Crew' })).address;
    localStorage.setItem('lr_address', address);
  }
  const es = new EventSource(`/api/sim/stream?address=${encodeURIComponent(address)}`);
  es.addEventListener('out', (ev) => {
    queue.push(...JSON.parse(ev.data));
    drain();
  });
  es.addEventListener('typing', () => { if (!draining) showTyping(true); });
  es.addEventListener('run', (ev) => {
    const info = JSON.parse(ev.data);
    setBridge(info.bridgeUrl);
    applyLang(info.lang);
  });
  if (!log.querySelector('.row')) showStart();
}

// ---------- photos: downscale to JPEG before upload ----------

async function toJpegDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

document.getElementById('camBtn').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    pendingImage = await toJpegDataUrl(f);
    preview.querySelector('img').src = pendingImage;
    preview.style.display = 'flex';
    input.focus();
  } catch {
    alert(ui('badImage'));
  }
};
document.getElementById('clearPhoto').onclick = () => {
  pendingImage = null;
  preview.style.display = 'none';
};

form.onsubmit = (e) => {
  e.preventDefault();
  const text = input.value.trim();
  const image = pendingImage;
  input.value = '';
  pendingImage = null;
  preview.style.display = 'none';
  sendMessage(text, image);
};

document.getElementById('reset').onclick = () => {
  if (!confirm(ui('newConfirm'))) return;
  localStorage.removeItem('lr_address');
  location.reload();
};

boot();
