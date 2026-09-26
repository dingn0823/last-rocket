// Personal bridge: live view of one run, fed by SSE.
import { escapeHtml, playFx } from './fx.js';

const token = location.pathname.split('/').pop();
const $ = (id) => document.getElementById(id);
const STAGES = ['Liftoff', 'Debris Belt', 'Deep Space', 'Lunar Orbit', 'Landing'];
let prev = null;
let scanningPhoto = null;

// ---------- route ----------

const pos = (i) => `calc(90px + (100% - 180px) * ${i / 6})`;
STAGES.forEach((name, i) => {
  const n = document.createElement('div');
  n.className = 'node';
  n.style.left = pos(i + 1);
  n.innerHTML = `<span>${name.toUpperCase()}</span>`;
  $('route').appendChild(n);
});

function renderRoute(s) {
  const nodes = $('route').querySelectorAll('.node');
  nodes.forEach((n, i) => n.classList.toggle('done', i + 1 < s.stage || (s.phase === 'ended' && i + 1 <= s.stage)));
  let at = s.stage;
  if (s.ending?.kind === 'success') at = 6;
  const rocket = $('rocket');
  rocket.style.left = at === 0 ? '90px' : pos(at);
  rocket.classList.toggle('dead', s.ending?.kind === 'failure');
  rocket.classList.toggle('eco', s.reductions.fuel > 0);
}

// ---------- resources ----------

function renderBars(s) {
  for (const bar of document.querySelectorAll('.bar')) {
    const r = bar.dataset.r;
    const v = s.res[r];
    bar.querySelector('.val').textContent = v;
    bar.querySelector('.fill').style.width = `${(100 * v) / s.max}%`;
    bar.querySelector('.red').textContent = s.reductions[r] ? `  −${s.reductions[r]}% cost` : '';
    bar.classList.toggle('low', v <= 15);
    if (prev && prev.res[r] !== v) {
      const d = v - prev.res[r];
      bar.classList.remove('up', 'down');
      void bar.offsetWidth;
      bar.classList.add(d > 0 ? 'up' : 'down');
      setTimeout(() => bar.classList.remove('up', 'down'), 900);
      const tag = document.createElement('div');
      tag.className = `delta ${d > 0 ? 'plus' : 'minus'}`;
      tag.textContent = d > 0 ? `+${d}` : `${d}`;
      bar.querySelector('.track').appendChild(tag);
      setTimeout(() => tag.remove(), 1300);
    }
  }
}

// ---------- cargo ----------

function renderCargo(s) {
  const holo = $('holo');
  const info = $('itemInfo');
  if (scanningPhoto && !s.item && !s.pendingItem) {
    holo.className = 'holo scanning';
    holo.innerHTML = `<img src="${escapeHtml(scanningPhoto)}" alt="" /><div class="tag">SCANNING…</div>`;
    info.innerHTML = '';
  } else if (s.item) {
    holo.className = 'holo';
    holo.innerHTML = `<div class="icon">${escapeHtml(s.item.icon)}</div>${s.item.photoUrl ? `<img class="photo-mini" src="${escapeHtml(s.item.photoUrl)}" alt="" />` : ''}<div class="tag">${escapeHtml(s.item.label.toUpperCase())}</div>`;
    info.innerHTML = `<div class="c">${escapeHtml(s.item.category)}</div>
      <div class="n">${escapeHtml(s.item.name)}<span class="status ${s.item.status}">${s.item.status === 'kept' ? 'ON BOARD' : 'SACRIFICED'}</span></div>
      <div class="b">${escapeHtml(s.item.blurb)}</div>`;
  } else if (s.pendingItem) {
    holo.className = 'holo scanning';
    holo.innerHTML = `${s.pendingItem.photoUrl ? `<img src="${escapeHtml(s.pendingItem.photoUrl)}" alt="" />` : `<div class="icon">${escapeHtml(s.pendingItem.icon)}</div>`}<div class="tag">IDENTIFIED: ${escapeHtml(s.pendingItem.label.toUpperCase())}</div>`;
    info.innerHTML = `<div class="c">Awaiting confirmation</div><div class="n">${escapeHtml(s.pendingItem.name)}?</div>`;
  } else {
    holo.className = 'holo';
    holo.innerHTML = '<div class="empty">AWAITING SCAN</div>';
    info.innerHTML = '';
  }
  if (s.item || s.pendingItem) scanningPhoto = null;

  const slots = $('slots');
  slots.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const u = s.upgrades[i];
    const el = document.createElement('div');
    el.className = u ? `slot filled ${u.rarity}` : 'slot';
    el.innerHTML = u
      ? `<div class="i">${escapeHtml(u.icon)}</div><div class="n">${escapeHtml(u.name)}</div><div class="e">${escapeHtml(u.effectText)}</div>`
      : '<div class="e">EMPTY SLOT</div>';
    if (u && prev && prev.upgrades.some((p) => p.id === u.id)) el.style.animation = 'none';
    slots.appendChild(el);
  }
  $('combos').innerHTML = s.combos.map((k) => `<div class="combo">${escapeHtml(k.icon)} ${escapeHtml(k.name)}</div>`).join('');
}

// ---------- header + comms ----------

function renderTop(s) {
  let label;
  if (s.phase === 'ended') label = `<span class="ending ${s.ending.kind}">${{ success: 'TOUCHDOWN', rescue: 'ADRIFT', failure: 'LOST' }[s.ending.kind]}</span> · score <b>${s.ending.score}</b>`;
  else if (s.stage === 0) label = `<b>${escapeHtml(s.nickname)}</b> · Launch pad · choosing cargo`;
  else label = `<b>${escapeHtml(s.nickname)}</b> · Stage ${s.stage}/5 · <b>${escapeHtml(s.stageName)}</b>${s.eventTitle ? ` · ${escapeHtml(s.eventTitle)}` : ''}`;
  $('stage').innerHTML = label;
}

function addComms(msgs) {
  const box = $('comms');
  for (const m of msgs) {
    if (m.t !== 'text') continue;
    const d = document.createElement('div');
    d.textContent = m.text;
    box.appendChild(d);
  }
  while (box.children.length > 30) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

function render(s) {
  renderTop(s);
  renderRoute(s);
  renderBars(s);
  renderCargo(s);
  prev = s;
}

// ---------- boot ----------

async function boot() {
  const res = await fetch(`/api/bridge/${token}`);
  if (!res.ok) {
    $('stage').textContent = 'Unknown bridge link.';
    return;
  }
  const { snapshot, recent } = await res.json();
  render(snapshot);
  addComms(recent);

  const es = new EventSource(`/api/bridge/${token}/stream`);
  es.onopen = () => $('live').classList.add('on');
  es.onerror = () => $('live').classList.remove('on');
  es.addEventListener('scanning', (ev) => {
    scanningPhoto = JSON.parse(ev.data).photoUrl;
    if (prev) renderCargo(prev);
  });
  es.addEventListener('update', (ev) => {
    const { snapshot, out } = JSON.parse(ev.data);
    render(snapshot);
    addComms(out);
    const fx = out.filter((m) => m.t === 'fx');
    fx.forEach((m, i) => setTimeout(() => playFx(m.fx, m.text), i * 1500));
  });
}

boot();
