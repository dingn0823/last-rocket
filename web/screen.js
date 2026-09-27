// Big screen: every rocket on one arcing Earth→Moon route, live bursts, round clock, launch countdown, podium.
import { escapeHtml, poll } from './fx.js';

const $ = (id) => document.getElementById(id);
const route = $('route');
const LANES = 12;
const rockets = new Map();
const lanes = new Map();
let state = null;
let clockOffset = 0;
let lastJoin = '';
let lastPhase = null;
let ceremonyShown = 0;
let countShown = null;
let refreshQueued = false;
const shownFeed = new Set();
/** pid → until when its name tag is highlighted (something just happened to them). */
const hotUntil = new Map();
const CROWD = 8;

// ---------- starfield: three layers drifting at different speeds ----------
(function stars() {
  const sky = $('sky');
  [[160, 'rgba(255,255,255,.55)', 1], [90, 'rgba(255,255,255,.75)', 1.5], [40, 'rgba(180,220,255,.9)', 2]].forEach(([n, color, size], i) => {
    const shadows = [];
    for (let k = 0; k < n; k++) {
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      shadows.push(`${x}vw ${y}vh ${color}`, `${x + 100}vw ${y}vh ${color}`);
    }
    const el = document.createElement('i');
    el.className = `s${i + 1}`;
    el.style.width = el.style.height = `${size}px`;
    el.style.boxShadow = shadows.join(',');
    sky.appendChild(el);
  });
})();

// ---------- geometry (percent of the route panel) ----------
const EARTH = { x: 7, y: 58 };
const MOON = { x: 93, y: 58 };
const ARC_H = 18;
const arc = (t) => ({ x: 11 + t * 78, y: 58 - Math.sin(Math.PI * t) * ARC_H });

function tangentDeg(t) {
  const r = route.getBoundingClientRect();
  const dx = 78 * r.width;
  const dy = -ARC_H * Math.PI * Math.cos(Math.PI * t) * r.height;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function drawArc(stageNames) {
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const p = arc(t);
    pts.push(`${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
  }
  $('arc').setAttribute('d', `M ${pts.join(' L ')}`);
  if (route.querySelector('.mark')) return;
  stageNames.forEach((name, i) => {
    const p = arc((i + 1) / 6);
    const m = document.createElement('div');
    m.className = 'mark';
    m.style.left = `${p.x}%`;
    m.style.top = `${p.y}%`;
    m.innerHTML = `<i></i><span>${escapeHtml(name.toUpperCase())}</span>`;
    route.appendChild(m);
  });
}

// Each rocket keeps its lane for life, so nothing jumps or piles up.
function lane(id) {
  if (!lanes.has(id)) {
    const used = new Set(lanes.values());
    let l = 0;
    while (used.has(l) && l < LANES) l++;
    lanes.set(id, l < LANES ? l : lanes.size % LANES);
  }
  return lanes.get(id);
}

function placeFor(p, boardingIndex, boardingCount) {
  const l = lane(p.id);
  if (p.boarding) {
    // Orbit the right-hand side of Earth, ring after ring.
    const perRing = 7;
    const ring = Math.floor(boardingIndex / perRing);
    const k = boardingIndex % perRing;
    const n = Math.min(perRing, boardingCount - ring * perRing);
    const a = n === 1 ? 0 : -1.2 + (2.4 * k) / (n - 1);
    const rx = 15 + ring * 9;
    const r = route.getBoundingClientRect();
    const ry = Math.min(40, (rx * r.width) / r.height * 0.8);
    return { x: EARTH.x + Math.cos(a) * rx, y: EARTH.y + Math.sin(a) * ry, rot: -45 };
  }
  if (p.ending?.kind === 'success') {
    const a = Math.PI - 1.1 + (l / (LANES - 1)) * 2.2;
    return { x: MOON.x + Math.cos(a) * 7, y: MOON.y + Math.sin(a) * 16, rot: -45 };
  }
  const t = Math.min(0.92, p.stage === 0 ? 0.04 : p.stage / 6 + (p.phase === 'pick' ? 0.06 : 0));
  const base = arc(t);
  // Spread the lanes around the arc, and stagger neighbours sideways so tags don't touch.
  const y = base.y + (l - (LANES - 1) / 2) * 5.4;
  const x = base.x + ((l % 3) - 1) * 2.6;
  return { x, y, rot: p.ending ? 135 : tangentDeg(t) + 45 };
}

function renderRockets(players) {
  const seen = new Set();
  const boarding = players.filter((p) => p.boarding);
  const crowded = players.length > CROWD;
  const leaders = new Set((state?.leaderboard ?? []).slice(0, 3).map((b) => b.nickname));
  const t = Date.now();
  for (const p of players) {
    seen.add(p.id);
    const pos = placeFor(p, boarding.indexOf(p), boarding.length);
    let el = rockets.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'rk fresh';
      el.innerHTML = '<div class="ship">🚀</div><div class="tag"></div>';
      const start = p.boarding ? pos : { x: EARTH.x + 3, y: EARTH.y };
      el.style.left = `${start.x}%`;
      el.style.top = `${start.y}%`;
      route.appendChild(el);
      rockets.set(p.id, el);
      setTimeout(() => el.classList.remove('fresh'), 1000);
      // Newcomers get their name up in lights for a moment, so people can spot themselves.
      if (lanes.size > 1 || rockets.size > 1) {
        hotUntil.set(p.id, Date.now() + 6000);
        setTimeout(() => state && renderRockets(state.players), 6100);
      }
    }
    const done = p.ending?.kind === 'success';
    el.classList.toggle('board', p.boarding);
    el.classList.toggle('combo', p.combos > 0 && !p.ending);
    el.classList.toggle('landed', done);
    el.classList.toggle('lost', !!p.ending && !done);
    el.classList.toggle('eco', p.combos > 1);
    const badge = p.ending ? { success: ' 🌕', rescue: ' 🛰️', failure: ' 💥' }[p.ending.kind] : p.combos > 0 ? ' ⚡' : '';
    const hot = (hotUntil.get(p.id) ?? 0) > t;
    const leader = leaders.has(p.nickname);
    el.classList.toggle('hot', hot);
    el.classList.toggle('leader', leader);
    // Busy room: only leaders and players with something happening show their name.
    el.classList.toggle('quiet', crowded && !hot && !leader && !p.boarding);
    el.querySelector('.tag').innerHTML = `${escapeHtml(p.icon)}<span class="nm"> ${escapeHtml(p.nickname)}${badge}</span>`;
    void el.offsetWidth; // no requestAnimationFrame: it pauses when the tab is hidden
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.querySelector('.ship').style.transform = `rotate(${pos.rot}deg)`;
    el.dataset.x = pos.x;
    el.dataset.y = pos.y;
  }
  for (const [id, el] of rockets) {
    if (seen.has(id)) continue;
    el.remove();
    rockets.delete(id);
    lanes.delete(id);
  }
}

// ---------- bursts ----------
const WORDS = { combo: '⚡ COMBO!', legendary: '✨ LEGENDARY', shield: '🛡️ SAVED!', landed: '🌕 TOUCHDOWN', lost: '💥', rescue: '🛰️ ADRIFT' };

function burst(pid, kind) {
  const el = rockets.get(pid);
  if (!el) return;
  // Light up their name tag for a few seconds, then let them fade back into the fleet.
  hotUntil.set(pid, Date.now() + (kind === 'landed' ? 8000 : 6000));
  setTimeout(() => state && renderRockets(state.players), kind === 'landed' ? 8100 : 6100);
  if (!(kind in WORDS)) return;
  const fire = () => {
    const b = document.createElement('div');
    // Near the top of the panel the word would be clipped: show it under the rocket instead.
    b.className = `burst k-${kind}${Number(el.dataset.y) < 22 ? ' below' : ''}`;
    b.style.left = `${el.dataset.x}%`;
    b.style.top = `${el.dataset.y}%`;
    let html = `<div class="ring"></div><div class="word">${WORDS[kind]}</div>`;
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
      const d = 6 + Math.random() * 7;
      html += `<i class="p" style="--dx:${Math.cos(a) * d}vh;--dy:${Math.sin(a) * d}vh"></i>`;
    }
    b.innerHTML = html;
    route.appendChild(b);
    setTimeout(() => b.remove(), 2100);
  };
  // A landing bursts when the rocket arrives, not when it leaves.
  setTimeout(fire, kind === 'landed' ? 2300 : 150);
}

// ---------- side panels ----------
function renderFeed(items) {
  const top = items.slice(0, 11);
  const firstPaint = shownFeed.size === 0;
  $('feed').innerHTML = top.map((f) => {
    const key = `${f.at}|${f.text}`;
    const fresh = !firstPaint && !shownFeed.has(key);
    if (fresh) burst(f.pid, f.kind);
    return `<li class="${fresh ? 'fresh' : ''}"><span class="i">${escapeHtml(f.icon)}</span><span>${escapeHtml(f.text)}</span></li>`;
  }).join('');
  shownFeed.clear();
  shownFeed.add('painted');
  for (const f of top) shownFeed.add(`${f.at}|${f.text}`);
}

function renderBoard(rows, round) {
  const medal = ['🥇', '🥈', '🥉'];
  $('boardTitle').textContent = round.phase !== 'off' ? `ROUND ${round.no} · BEST LANDINGS` : 'BEST LANDINGS';
  $('board').innerHTML = rows.length
    ? rows.map((r, i) => `<li><span class="rank">${medal[i] ?? i + 1}</span><span class="n">${escapeHtml(r.icon)} ${escapeHtml(r.nickname)}${r.kept ? ' 💎' : ''}</span><span class="s">${r.score}</span></li>`).join('')
    : '<li class="none">No landings yet. Who will be first?</li>';
}

// ---------- clock, banner, overlays ----------
const now = () => Date.now() + clockOffset;
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function tick() {
  if (!state) return;
  const r = state.round;
  const b = $('banner');
  b.className = 'banner';
  let label = '';
  let clock = '';
  let hint = '';
  const flying = state.counts.flying + state.counts.landed + state.counts.lost;
  if (r.phase === 'off') {
    label = 'LIVE';
    hint = state.players.length ? '' : 'Scan the code to take the last rocket →';
  } else if (r.phase === 'waiting') {
    label = 'NEXT LAUNCH';
    clock = 'READY';
    b.classList.add('boarding');
    hint = 'Scan to board<small>the countdown starts when the first crew arrives</small>';
  } else if (r.phase === 'boarding') {
    const left = r.boardingEndsAt - now();
    label = 'BOARDING · LIFTOFF IN';
    clock = mmss(left);
    b.classList.add('boarding');
    hint = `${state.counts.boarding} on the launch list<small>scan now to make this launch</small>`;
    // Last three seconds: giant countdown over everything.
    const n = Math.ceil(left / 1000);
    if (left > 0 && n <= 3) showCount(String(n));
  } else if (r.phase === 'flying') {
    const left = r.endsAt - now();
    label = 'FLIGHT TIME LEFT';
    clock = mmss(left);
    if (left < 10_000) b.classList.add('final');
    else if (left < 60_000) b.classList.add('warn');
    hint = flying ? '' : 'Scan to join this flight';
  } else if (r.phase === 'ceremony') {
    label = 'MISSION COMPLETE';
    $('cSub').textContent = `${r.participants} crew flew this round · next launch opens in ${mmss(r.ceremonyEndsAt - now())}`;
  }
  $('bLabel').textContent = label;
  $('bClock').textContent = clock;
  $('hint').innerHTML = hint;
  $('hint').style.display = hint ? 'block' : 'none';
  $('cBrd').style.display = r.phase === 'waiting' || r.phase === 'boarding' || state.counts.boarding ? '' : 'none';
}

function showCount(text, go = false) {
  if (countShown === text) return;
  countShown = text;
  const box = $('count');
  box.classList.add('on');
  box.innerHTML = `<div class="n${go ? ' go' : ''}">${escapeHtml(text)}</div>`;
  if (go) setTimeout(() => { box.classList.remove('on'); countShown = null; }, 1700);
}

function showCeremony(r) {
  if (ceremonyShown === r.no) return;
  ceremonyShown = r.no;
  $('count').classList.remove('on');
  $('cTitle').textContent = `MISSION COMPLETE · ROUND ${r.no}`;
  const order = [[1, '🥈', '20vh', 1.2], [0, '🥇', '28vh', 2.2], [2, '🥉', '14vh', 0.3]];
  $('podium').innerHTML = r.podium.length
    ? order.filter(([i]) => r.podium[i]).map(([i, medal, h, delay]) => {
      const p = r.podium[i];
      return `<div class="step p${i + 1}">
        <div class="who" style="animation-delay:${delay + 0.8}s"><div class="medal">${medal}</div><div class="nm">${escapeHtml(p.nickname)}</div>
          <div class="it">${escapeHtml(p.icon)} ${escapeHtml(p.item)}${p.kept ? ' 💎' : ''}</div><div class="sc">${p.score}</div></div>
        <div class="block" style="--h:${h};animation-delay:${delay}s">${i + 1}</div></div>`;
    }).join('')
    : '<div class="nobody">Nobody reached the Moon this round.<br />The Moon is still waiting…</div>';
  $('ceremony').classList.add('on');
  if (r.podium.length) setTimeout(confetti, 2600);
}

function confetti() {
  const c = $('confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth;
  c.height = innerHeight;
  const colors = ['#ffd76a', '#4ff3ff', '#b98cff', '#7dff9b', '#ff5a6e', '#ffffff'];
  const bits = Array.from({ length: 220 }, () => ({
    x: Math.random() * c.width, y: -Math.random() * c.height, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10,
    vy: 2 + Math.random() * 4, vx: -1.5 + Math.random() * 3, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const until = Date.now() + 7000;
  (function frame() {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.x += b.vx; b.y += b.vy; b.r += b.vr;
      if (b.y > c.height && Date.now() < until) { b.y = -20; b.x = Math.random() * c.width; }
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.color; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (Date.now() < until + 4000) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, c.width, c.height);
  })();
}

// ---------- data ----------
async function refresh() {
  refreshQueued = false;
  let s;
  try {
    s = await (await fetch(`/api/screen/state${location.search.includes('sim=1') ? '?sim=1' : ''}`, { cache: 'no-store' })).json();
  } catch {
    return null;
  }
  clockOffset = s.round.now - Date.now();
  const prev = lastPhase;
  lastPhase = s.round.phase;
  state = s;
  drawArc(s.stageNames);
  renderFeed(s.feed);
  renderRockets(s.players);
  renderBoard(s.leaderboard, s.round);
  $('nBrd').textContent = s.counts.boarding;
  $('nFly').textContent = s.counts.flying;
  $('nLand').textContent = s.counts.landed;
  $('nLost').textContent = s.counts.lost;
  if (s.joinUrl !== lastJoin) {
    lastJoin = s.joinUrl;
    $('qr').src = `/api/qr?text=${encodeURIComponent(s.joinUrl)}`;
    $('url').textContent = (s.shortUrl ?? s.joinUrl).replace(/^https?:\/\//, '');
  }
  if (prev === 'boarding' && s.round.phase === 'flying') showCount('LIFTOFF!', true);
  else if (s.round.phase !== 'boarding' && countShown && countShown !== 'LIFTOFF!') { $('count').classList.remove('on'); countShown = null; }
  if (s.round.phase === 'ceremony') showCeremony(s.round);
  else $('ceremony').classList.remove('on');
  tick();
  return s;
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(refresh, 300);
}

addEventListener('resize', () => state && renderRockets(state.players));
const first = await refresh();
poll('/api/screen/poll', first?.cursor ?? 0, () => queueRefresh());
setInterval(tick, 250);
setInterval(refresh, 10_000);
