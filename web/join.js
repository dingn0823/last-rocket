// Join page: register phone → show QR / Open Messages → wait for "join 1234" → open this player's bridge.
import { escapeHtml, getLang, loadUi, poll, setLang, ui } from './fx.js';

const $ = (id) => document.getElementById(id);
const isMobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
if (isMobile) document.body.classList.add('mobile');

function applyLang(l) {
  setLang(l);
  localStorage.setItem('lr_join_lang', l);
  document.querySelectorAll('.langs button').forEach((b) => b.classList.toggle('on', b.dataset.lang === l));
  $('nick').placeholder = ui('nicknamePh');
  $('num').placeholder = ui('phonePh');
  document.title = ui('joinTitle');
  // Chinese players are more likely to have a +86 number; don't override a choice already made.
  if (!$('cc').dataset.touched) $('cc').value = l === 'zh' ? '+86' : '+1';
}

function showScan(j) {
  $('form').classList.add('hidden');
  $('scan').classList.remove('hidden');
  $('qr').src = j.qr;
  $('sms').href = j.sms;
  $('orText').innerHTML = escapeHtml(ui('orText', { text: '\u0000', number: '\u0001' }))
    .replace('\u0000', `<span class="code">${escapeHtml(j.text)}</span>`)
    .replace('\u0001', `<span class="code">${escapeHtml(j.number)}</span>`);
  poll(`/api/join/${j.token}/poll`, j.cursor ?? 0, (event, data) => {
    if (event === 'paired') open(data.path);
  });
}

function open(path) {
  $('wait').textContent = ui('paired');
  sessionStorage.removeItem('lr_join');
  setTimeout(() => location.replace(path), 800);
}

async function submit(e) {
  e.preventDefault();
  const cc = $('cc').value;
  const raw = $('num').value.trim();
  const phone = raw.startsWith('+') || !cc ? raw : `${cc}${raw.replace(/^0+/, '')}`;
  $('err').textContent = '';
  $('go').disabled = true;
  $('go').textContent = ui('registering');
  try {
    const r = await fetch('/api/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: $('nick').value.trim(), phone, lang: getLang() }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? 'generic');
    sessionStorage.setItem('lr_join', JSON.stringify(j));
    showScan(j);
  } catch (err) {
    const key = `err_${err.message}`;
    $('err').textContent = ui(key) === key ? ui('err_generic') : ui(key);
  } finally {
    $('go').disabled = false;
    $('go').textContent = ui('joinBtn');
  }
}

async function boot() {
  await loadUi();
  const saved = localStorage.getItem('lr_join_lang') ?? (navigator.language?.startsWith('zh') ? 'zh' : 'en');
  applyLang(saved);
  document.querySelectorAll('.langs button').forEach((b) => (b.onclick = () => applyLang(b.dataset.lang)));
  $('cc').onchange = () => ($('cc').dataset.touched = '1');
  $('form').onsubmit = submit;
  $('restart').onclick = () => {
    sessionStorage.removeItem('lr_join');
    location.reload();
  };
  // Page refreshed while waiting: keep the same boarding pass if it's still valid.
  const pending = sessionStorage.getItem('lr_join');
  if (pending) {
    const j = JSON.parse(pending);
    const r = await fetch(`/api/join/${j.token}`);
    if (r.ok) {
      const s = await r.json();
      if (s.paired) return open(s.paired);
      showScan({ ...j, cursor: s.cursor });
    } else sessionStorage.removeItem('lr_join');
  }
}

boot();
