// Host console (laptop only): join QR for the big screen, service status, live list of players.
import { escapeHtml } from './fx.js';

const $ = (id) => document.getElementById(id);
let lastJoinUrl = '';

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
  set('sMode', s.eventMode ? 'event (numbered options)' : 'single player (free text)', 'ok');
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

$('bigBtn').onclick = () => $('big').classList.add('on');
$('big').onclick = () => $('big').classList.remove('on');
refresh();
setInterval(refresh, 3000);
