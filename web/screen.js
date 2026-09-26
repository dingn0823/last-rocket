// Big screen: everyone at once. Refreshes on every game update (long poll) and every 15s as a fallback.
import { escapeHtml, poll } from './fx.js';

const $ = (id) => document.getElementById(id);
const LANES = 12;
const chips = new Map();
let lastJoin = '';
let refreshQueued = false;

// Route geometry in % of the panel: Earth on the left, five stage columns, the Moon on the right.
const stageX = (n) => 10 + n * 13.5;
const MOON_X = 91;

// Each player keeps the lane they got when they first appeared, so chips never jump or pile up.
const lanes = new Map();
function lane(id) {
  if (!lanes.has(id)) {
    const used = new Set(lanes.values());
    let l = 0;
    while (used.has(l) && l < LANES) l++;
    lanes.set(id, l < LANES ? l : lanes.size % LANES);
  }
  return lanes.get(id);
}

function drawColumns(names) {
  const route = $('route');
  if (route.querySelector('.col')) return;
  names.forEach((name, i) => {
    const col = document.createElement('div');
    col.className = 'col';
    col.style.left = `${stageX(i + 1)}%`;
    col.innerHTML = `<span>${escapeHtml(name.toUpperCase())}</span>`;
    route.appendChild(col);
  });
}

function renderPlayers(players) {
  const route = $('route');
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    const done = p.ending?.kind === 'success';
    const l = lane(p.id);
    const x = done ? MOON_X - 5 + (l % 3) * 3 : stageX(p.stage) + (p.phase === 'pick' ? 5 : 0);
    const y = 15 + l * (79 / (LANES - 1));
    let el = chips.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'chip new';
      el.style.left = `${stageX(0)}%`;
      el.style.top = `${y}%`;
      route.appendChild(el);
      chips.set(p.id, el);
      setTimeout(() => el.classList.remove('new'), 900);
    }
    el.classList.toggle('combo', p.combos > 0 && !p.ending);
    el.classList.toggle('landed', done);
    el.classList.toggle('lost', !!p.ending && !done);
    const badge = p.ending ? { success: '🌕', rescue: '🛰️', failure: '💥' }[p.ending.kind] : p.combos > 0 ? '⚡' : '';
    el.innerHTML = `<span class="i">${escapeHtml(p.icon)}</span>${escapeHtml(p.nickname)}${badge ? ` ${badge}` : ''}`;
    // Force a layout so a new chip animates from Earth; no requestAnimationFrame (paused in hidden tabs).
    void el.offsetWidth;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
  }
  for (const [id, el] of chips) {
    if (seen.has(id)) continue;
    el.remove();
    chips.delete(id);
    lanes.delete(id);
  }
  $('empty').style.display = players.length ? 'none' : 'grid';
}

function renderBoard(rows) {
  $('board').innerHTML = rows.length
    ? rows.map((r, i) => `<li><span class="rank">${i + 1}</span><span class="n">${escapeHtml(r.icon)} ${escapeHtml(r.nickname)}${r.kept ? ' 💎' : ''}</span><span class="s">${r.score}</span></li>`).join('')
    : '<li class="none">No landings yet. Who will be first?</li>';
}

// Only lines that weren't on screen before slide in; re-rendering must not replay the animation.
const shownFeed = new Set();
function renderFeed(items) {
  const top = items.slice(0, 12);
  $('feed').innerHTML = top.map((f) => {
    const key = `${f.at}|${f.text}`;
    const fresh = shownFeed.size > 0 && !shownFeed.has(key);
    return `<li class="${fresh ? 'fresh' : ''}"><span class="i">${escapeHtml(f.icon)}</span><span>${escapeHtml(f.text)}</span></li>`;
  }).join('');
  shownFeed.clear();
  for (const f of top) shownFeed.add(`${f.at}|${f.text}`);
  if (!top.length) shownFeed.add('');
}

async function refresh() {
  refreshQueued = false;
  let s;
  try {
    s = await (await fetch(`/api/screen/state${location.search.includes('sim=1') ? '?sim=1' : ''}`, { cache: 'no-store' })).json();
  } catch {
    return null;
  }
  drawColumns(s.stageNames);
  renderPlayers(s.players);
  renderBoard(s.leaderboard);
  renderFeed(s.feed);
  $('nFly').textContent = s.counts.flying;
  $('nLand').textContent = s.counts.landed;
  $('nLost').textContent = s.counts.lost;
  if (s.joinUrl !== lastJoin) {
    lastJoin = s.joinUrl;
    $('qr').src = `/api/qr?text=${encodeURIComponent(s.joinUrl)}`;
    $('url').textContent = (s.shortUrl ?? s.joinUrl).replace(/^https?:\/\//, '');
  }
  return s;
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(refresh, 400);
}

const first = await refresh();
poll('/api/screen/poll', first?.cursor ?? 0, () => queueRefresh(), (ok) => $('live').classList.toggle('on', ok));
setInterval(refresh, 15_000);
