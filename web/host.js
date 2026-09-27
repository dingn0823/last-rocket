// Host console (laptop only): join QR for the big screen, service status, live list of players.
import { escapeHtml } from './fx.js';

const $ = (id) => document.getElementById(id);
let lastJoinUrl = '';
let eventMode = false;
let roundPhase = 'off';
let round = null;
let offset = 0;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function roundText() {
  if (!round) return '…';
  const now = Date.now() + offset;
  switch (round.phase) {
    case 'off': return 'off (free play)';
    case 'waiting': return `#${round.no} · waiting for the first player`;
    case 'boarding': return `#${round.no} · boarding, liftoff in ${mmss(round.boardingEndsAt - now)}`;
    case 'flying': return `#${round.no} · flying, ${mmss(round.endsAt - now)} left`;
    case 'ceremony': return `#${round.no} · podium, next round in ${mmss(round.ceremonyEndsAt - now)}`;
  }
  return round.phase;
}
setInterval(() => round && ($('sRound').textContent = roundText()), 500);

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

function stageLabel(r) {
  if (r.phase === 'ended') return { success: '🌕 Landed', rescue: '🛰️ Adrift', failure: '💥 Lost' }[r.ending?.kind] ?? 'Ended';
  if (r.stage === 0) return r.phase === 'pick' ? 'Picking' : 'Choosing cargo';
  return `Stage ${r.stage}/5${r.phase === 'pick' ? ' · picking' : ''}`;
}

function set(el, text, cls) {
  $(el).textContent = text;
  $(el).className = cls;
}

async function refresh() {
  let s;
  try {
    s = await (await fetch('/api/host/state', { cache: 'no-store' })).json();
  } catch {
    return;
  }
  if (s.joinUrl !== lastJoinUrl) {
    lastJoinUrl = s.joinUrl;
    const qr = `/api/qr?text=${encodeURIComponent(s.joinUrl)}`;
    $('qr').src = qr;
    $('qrBig').src = qr;
    $('joinUrl').textContent = s.joinUrl;
    $('joinUrlBig').textContent = s.shortUrl ? s.shortUrl.replace(/^https?:\/\//, '') : s.joinUrl;
  }
  $('shortUrl').textContent = s.shortUrl ? `Short link (type this): ${s.shortUrl.replace(/^https?:\/\//, '')}` : '';
  set('sTunnel', s.publicUrl ? 'online' : 'local only (starting…)', s.publicUrl ? 'ok' : 'warn');
  set('sPhoton', s.photon.ok ? `ready · ${s.photon.users}/${s.photon.limit} seats` : `OFF · ${s.photon.error ?? ''}`, s.photon.ok ? (s.photon.users >= s.photon.limit ? 'bad' : 'ok') : 'bad');
  set('sAi', s.ai, s.ai === 'on' ? 'ok' : s.ai === 'rate-limited' ? 'warn' : 'bad');
  set('sMode', s.eventMode ? 'EVENT (numbered options)' : 'single player (free text)', s.eventMode ? 'warn' : 'ok');
  eventMode = s.eventMode;
  round = s.round;
  offset = s.round.now - Date.now();
  roundPhase = s.round.phase;
  $('sRound').textContent = roundText();
  $('sRound').className = roundPhase === 'off' ? '' : 'ok';
  $('roundBtn').textContent = roundPhase === 'off' ? '🔁 Turn on auto rounds' : '⏹ Turn off rounds (free play)';
  $('launchBtn').disabled = !(roundPhase === 'waiting' || roundPhase === 'boarding');
  $('endBtn').disabled = roundPhase !== 'flying';
  $('modeBtn').textContent = s.eventMode ? '↩ Back to free-text mode' : '👥 Switch to event mode (many players)';
  $('runs').innerHTML = s.runs.length
    ? s.runs.map((r) => `
      <tr class="${r.current ? '' : 'old'}">
        <td>${escapeHtml(r.nickname)} <span style="color:var(--muted)">${r.lang === 'zh' ? '中' : 'EN'}</span></td>
        <td>${r.channel === 'imessage' ? '📱 iMessage' : '🖥 simulator'}</td>
        <td>${escapeHtml(stageLabel(r))}</td>
        <td>${r.res.fuel} · ${r.res.oxygen} · ${r.res.hull}</td>
        <td>${ago(r.updatedAt)}</td>
        <td><a class="open" href="${escapeHtml(r.bridge)}" target="_blank">Bridge</a></td>
      </tr>`).join('')
    : '<tr><td colspan="6">No runs yet.</td></tr>';
}

$('modeBtn').onclick = async () => {
  $('modeBtn').disabled = true;
  await fetch('/api/host/event-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: !eventMode }) });
  $('modeBtn').disabled = false;
  refresh();
};
const roundAction = async (action, ask) => {
  if (ask && !confirm(ask)) return;
  await fetch('/api/host/rounds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  refresh();
};
$('roundBtn').onclick = () => roundAction(roundPhase === 'off' ? 'auto' : 'off', roundPhase === 'off' ? '' : 'Turn off rounds? Players waiting on the launch list will start when they next text.');
$('launchBtn').onclick = () => roundAction('launch');
$('endBtn').onclick = () => roundAction('end', 'End this round now and show the podium?');
$('clearBtn').onclick = async () => {
  if (!confirm('Clear the big screen? Leaderboard and feed start from zero (no runs are deleted).')) return;
  await fetch('/api/host/clear-screen', { method: 'POST' });
};
$('bigBtn').onclick = () => $('big').classList.add('on');
$('big').onclick = () => $('big').classList.remove('on');
refresh();
setInterval(refresh, 3000);
