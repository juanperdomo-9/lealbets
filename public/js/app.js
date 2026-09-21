// Leal Bets - frontend. Habla con la API propia (server/routes/*) en vez de
// window.storage, y recibe avisos en tiempo real por socket.io en vez de
// hacer polling cada 7 segundos.

let TOKEN = null;
let ADMIN_TOKEN = null;
let ME = null;
let isAdmin = false;
let STATE = { teams: [], matches: [], ranking: [], lealPlayerOrder: [], lealResults: [], lealMatchesPlayed: [] };
let MY_BETS = [];
let CART = [];
let cartPanelOpen = false;
let expandedMatches = new Set();
let expandedPlayers = new Set();
let expandedHistoryTeams = new Set();
let expandedLealMatches = new Set(); // qué partidos del historial tienen su detalle/formación abierto
let activeBoostId = null; // superaumento cargado en el carrito actual (se pierde si se toca algo a mano)
let boostDraftMatchId = null; // admin: partido elegido para armar un superaumento nuevo
let boostDraftLegs = []; // admin: selecciones elegidas para ese superaumento

// ---------- íconos (SVG en línea, sin dependencias externas) ----------
const ICONS = {
  chevron: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  login: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 5H5a3 3 0 0 0 3 3"/><path d="M16 5h3a3 3 0 0 1-3 3"/><path d="M9 19h6"/><path d="M12 12v7"/></svg>`,
  ball: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8l3.3 2.4-1.3 3.9H10L8.7 10.4z"/><path d="M12 8V4.5M15.3 10.4l3-2M14 14.3l1.7 3.4M10 14.3L8.3 17.7M8.7 10.4l-3-2"/></svg>`,
  shuffle: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  goal: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V6h16v14"/><path d="M4 10h16"/><path d="M4 6l3 4M20 6l-3 4"/></svg>`,
  handshake: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13l4-4 4 2 4-2 4 4-4 4-4-2-4 2z"/><path d="M9 11l3 3 7-7"/></svg>`,
  users: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.7.5 5 2.6 5 5.8"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/></svg>`,
  ticket: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><line x1="10" y1="6.5" x2="10" y2="8" stroke-dasharray="1 2"/><line x1="10" y1="16" x2="10" y2="17.5" stroke-dasharray="1 2"/><line x1="10" y1="11" x2="10" y2="13" stroke-dasharray="1 2"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c2 4-2 5-2 9a2 2 0 0 0 4 0c0-1-.5-2-.5-2s1.5 1.2 1.5 4.2a4 4 0 0 1-8 0C7 8 10 6 12 2z"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  dice: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
  card: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2" transform="rotate(-8 12 12)"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="{s}" height="{s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5 1.5-7-5-5 7-1z"/></svg>`,
};
function icon(name, size) {
  const s = size || 14;
  return `<span class="icon">${(ICONS[name] || '').split('{s}').join(s)}</span>`;
}

// rellena los íconos de los elementos estáticos del HTML (gate + header + nav de abajo)
document.getElementById('userIcon').innerHTML = ICONS.user.split('{s}').join(16);
document.getElementById('lockIcon').innerHTML = ICONS.lock.split('{s}').join(16);
document.getElementById('enterIcon').innerHTML = ICONS.login.split('{s}').join(16);
document.getElementById('walletIcon').innerHTML = ICONS.wallet.split('{s}').join(14);
const NAV_ICONS = {
  matches: 'ball', mybets: 'ticket', casino: 'dice', historial: 'clock', ranking: 'trophy', admin: 'users',
};
for (const [tab, name] of Object.entries(NAV_ICONS)) {
  const el = document.getElementById('navIcon-' + tab);
  if (el) el.innerHTML = ICONS[name].split('{s}').join(20);
}
document.getElementById('navIcon-more').innerHTML = ICONS.menu.split('{s}').join(20);

// ---------- api helper ----------
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = opts.admin ? ADMIN_TOKEN : TOKEN;
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && opts.admin) {
      ADMIN_TOKEN = null; isAdmin = false;
      localStorage.removeItem('lb_admin_token');
      document.getElementById('adminGate').style.display = 'block';
      document.getElementById('adminContent').style.display = 'none';
    }
    throw new Error((data && data.error) || 'Error del servidor');
  }
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = `${icon('check', 13)}<span>${msg}</span>`;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
function initials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
const LEAL_TEAM_NAME = 'Leal FC';
// escudos reales de los equipos del torneo (si un equipo nuevo no tiene logo cargado, cae en las iniciales)
const TEAM_LOGOS = {
  'Canilla Libre': '/img/teams/canilla-libre.jpg',
  'Leal FC': '/img/teams/leal-fc.jpg',
  'La Sede': '/img/teams/la-sede.jpg',
  'Cementerio FC': '/img/teams/cementerio-fc.jpg',
  'Retruco': '/img/teams/retruco.jpg',
  'Carlos Casares': '/img/teams/carlos-casares.jpg',
  'DDFC': '/img/teams/ddfc.jpg',
  'Vaya al frente': '/img/teams/vaya-al-frente.jpg',
};
function crestHtml(name) {
  const logo = TEAM_LOGOS[name];
  if (logo) return `<span class="crest has-logo"><img src="${logo}" alt="${name}" loading="lazy"></span>`;
  return `<span class="crest">${initials(name)}</span>`;
}
function myBalance() {
  const row = STATE.ranking.find((r) => r.name === ME);
  return row ? row.balance : 0;
}

// ---------- picks: mismo vocabulario que el motor de cuotas del server ----------
const PROP_MARKET_LABEL = {
  atajadas: 'atajadas', faltas: 'faltas cometidas', remates: 'remates',
  remates_arco: 'remates al arco', gol: 'gol', asistencia: 'asistencia',
  amarilla: 'tarjeta amarilla', roja: 'tarjeta roja',
};
function parsePropPick(pick) {
  const [, playerName, market, threshold] = pick.split('|');
  return { playerName, market, threshold: threshold ? parseInt(threshold, 10) : null };
}
function pickLabel(pick, m) {
  if (pick.startsWith('prop|')) {
    const { playerName, market, threshold } = parsePropPick(pick);
    return threshold !== null
      ? `${playerName}: ${threshold}+ ${PROP_MARKET_LABEL[market]}`
      : `${playerName}: ${PROP_MARKET_LABEL[market]}`;
  }
  if (pick === 'home') return m.homeName;
  if (pick === 'away') return m.awayName;
  if (pick === 'draw') return 'Empate';
  if (pick === 'dc_1x') return m.homeName + ' o empate';
  if (pick === 'dc_12') return m.homeName + ' o ' + m.awayName;
  if (pick === 'dc_x2') return 'Empate o ' + m.awayName;
  if (pick === 'goals_over') return 'Más de ' + m.odds.goals.line + ' goles';
  if (pick === 'goals_under') return 'Menos de ' + m.odds.goals.line + ' goles';
  if (pick === 'btts_yes') return 'Ambos anotan: sí';
  if (pick === 'btts_no') return 'Ambos anotan: no';
  return pick;
}
function oddsFor(m, pick) {
  if (pick.startsWith('prop|')) {
    const { playerName, market, threshold } = parsePropPick(pick);
    const props = m.playerProps[playerName];
    return threshold !== null ? props[market][threshold] : props[market];
  }
  if (pick === 'home') return m.odds.home;
  if (pick === 'away') return m.odds.away;
  if (pick === 'draw') return m.odds.draw;
  if (pick === 'dc_1x') return m.odds.dc.oneX;
  if (pick === 'dc_12') return m.odds.dc.oneTwo;
  if (pick === 'dc_x2') return m.odds.dc.xTwo;
  if (pick === 'goals_over') return m.odds.goals.over;
  if (pick === 'goals_under') return m.odds.goals.under;
  if (pick === 'btts_yes') return m.odds.btts.yes;
  if (pick === 'btts_no') return m.odds.btts.no;
  return null;
}
function sel(m, pick) {
  return CART.some((l) => l.matchId === m.id && l.pick === pick) ? ' selected' : '';
}
function isSelected(matchId, pick) {
  return CART.some((l) => l.matchId === matchId && l.pick === pick);
}
function oddsBtn(matchId, pick, label, value) {
  const selected = isSelected(matchId, pick);
  const closed = STATE.marketClosed ? ' closed' : '';
  return `<div class="odds-btn${selected ? ' selected' : ''}${closed}" onclick="toggleLeg('${matchId}','${pick}')">
    <span class="lbl">${label}</span><span class="val">${value}</span>
    ${selected ? `<span class="check">${icon('check', 9)}</span>` : ''}
  </div>`;
}
// El orden de las claves de un objeto que pasó por jsonb en Postgres no está
// garantizado, así que el orden de exhibición de los jugadores de Leal viaja
// aparte (STATE.lealPlayerOrder) y se aplica acá siempre que se recorren.
function orderedPlayerNames(playerProps) {
  const names = Object.keys(playerProps || {});
  const order = STATE.lealPlayerOrder || [];
  const known = order.filter((n) => names.includes(n));
  const unknown = names.filter((n) => !order.includes(n));
  return known.concat(unknown);
}

// ---------- auth ----------
function showApp() {
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}
function showGate() {
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function joinAsPlayer() {
  const name = document.getElementById('nameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  if (!name) { toast('Escribí un nombre de usuario'); return; }
  if (!password) { toast('Escribí una contraseña'); return; }
  try {
    const data = await apiFetch('/auth/join', { method: 'POST', body: { name, password } });
    TOKEN = data.token;
    ME = data.name;
    localStorage.setItem('lb_token', TOKEN);
    localStorage.setItem('lb_name', ME);
    showApp();
    await loadState();
    await loadMyBets();
    renderAll();
  } catch (e) {
    toast(e.message);
  }
}
function switchPlayer() {
  TOKEN = null; ME = null; MY_BETS = []; CART = []; cartPanelOpen = false;
  localStorage.removeItem('lb_token');
  localStorage.removeItem('lb_name');
  document.getElementById('nameInput').value = '';
  document.getElementById('passwordInput').value = '';
  showGate();
}

async function checkAdminPassword() {
  const input = document.getElementById('adminPasswordInput');
  try {
    const data = await apiFetch('/auth/admin', { method: 'POST', body: { password: input.value } });
    ADMIN_TOKEN = data.token;
    localStorage.setItem('lb_admin_token', ADMIN_TOKEN);
    isAdmin = true;
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    renderAdmin();
    renderLealHistory(); // para que aparezca ya el botón de borrar/editar en "Por rival"...
    renderAllMatchesList(); // ...y en "Partidos jugados"
  } catch (e) {
    toast(e.message);
  }
}

// ---------- tabs (nav de abajo + menú "Más") ----------
// "Historial" y "Equipos" viven adentro del desplegable "Más" (no entran cómodos
// como pestañas sueltas en una pantalla de celular angosta); cuando alguna de las
// dos está activa, el botón "Más" se marca resaltado para que no parezca que no
// hay ninguna sección seleccionada.
const MORE_TAB_NAMES = ['historial', 'admin'];
function toggleMoreMenu(e) {
  if (e) e.stopPropagation();
  document.getElementById('moreMenu').hidden = !document.getElementById('moreMenu').hidden;
}
function closeMoreMenu() {
  document.getElementById('moreMenu').hidden = true;
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('moreMenu');
  const moreBtn = document.getElementById('navMoreBtn');
  if (!menu.hidden && !menu.contains(e.target) && !moreBtn.contains(e.target)) closeMoreMenu();
});
document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn[data-tab]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('main section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('navMoreBtn').classList.toggle('active', MORE_TAB_NAMES.includes(btn.dataset.tab));
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    closeMoreMenu();
    window.scrollTo({ top: 0 });
    if (btn.dataset.tab === 'admin' && isAdmin) renderAdmin();
    if (btn.dataset.tab === 'historial') { renderLealHistory(); renderAllMatchesList(); }
    if (btn.dataset.tab === 'casino') {
      if (casinoView === 'blackjack') bjLoadState();
      else if (casinoView === 'penalty') pnLoadState();
      else if (casinoView === 'mines') mnLoadState();
    }
  });
});

// ---------- state loading ----------
async function loadState() {
  STATE = await apiFetch('/state');
}
async function loadMyBets() {
  if (!ME) { MY_BETS = []; return; }
  MY_BETS = await apiFetch('/bets/mine');
}

// ---------- admin: quién puede cargar el historial de Leal ----------
async function toggleLealHistoryAccess(name, checkbox) {
  const allowed = checkbox.checked;
  try {
    await apiFetch(`/admin/users/${encodeURIComponent(name)}/leal-history-access`, { method: 'POST', admin: true, body: { allowed } });
    await loadState();
    renderAll();
  } catch (e) {
    checkbox.checked = !allowed; // revertir si falló
    toast(e.message);
  }
}
function renderLealHistoryAccessList() {
  const container = document.getElementById('lealHistoryAccessList');
  if (!container) return;
  const users = STATE.ranking.slice().sort((a, b) => a.name.localeCompare(b.name));
  container.innerHTML = users.length
    ? users.map((u) => `
        <div class="leal-access-row">
          <span>${u.name}</span>
          <input type="checkbox" ${u.canLogLealHistory ? 'checked' : ''} onchange="toggleLealHistoryAccess('${u.name.replace(/'/g, "\\'")}', this)">
        </div>
      `).join('')
    : `<div class="empty" style="padding:20px;">Todavía no hay jugadores.</div>`;
}

// ---------- admin: cargar fichas ----------
function onChipsUserChange() {
  const name = document.getElementById('chipsUserSelect').value;
  const row = STATE.ranking.find((r) => r.name === name);
  document.getElementById('chipsCurrentBalance').textContent = row ? `Saldo actual: ${Math.round(row.balance)} fichas` : '';
}
async function adjustUserChips() {
  const name = document.getElementById('chipsUserSelect').value;
  const amount = parseInt(document.getElementById('chipsAmount').value, 10);
  if (!name) { toast('Elegí un jugador'); return; }
  if (!amount) { toast('Poné una cantidad distinta de cero'); return; }
  try {
    const result = await apiFetch(`/admin/users/${encodeURIComponent(name)}/chips`, { method: 'POST', admin: true, body: { amount } });
    document.getElementById('chipsAmount').value = '';
    await loadState();
    renderAll();
    toast(`Listo: ${name} ahora tiene ${Math.round(result.balance)} fichas`);
  } catch (e) { toast(e.message); }
}

// ---------- admin: equipos / partidos ----------
async function addTeam() {
  const input = document.getElementById('newTeamName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await apiFetch('/admin/teams', { method: 'POST', admin: true, body: { name } });
    input.value = '';
    await loadState();
    renderAdmin();
    toast('Equipo agregado');
  } catch (e) { toast(e.message); }
}

async function createMatch() {
  const homeId = document.getElementById('matchHome').value;
  const awayId = document.getElementById('matchAway').value;
  if (!homeId || !awayId || homeId === awayId) { toast('Elegí dos equipos distintos'); return; }
  try {
    await apiFetch('/admin/matches', { method: 'POST', admin: true, body: { homeId, awayId } });
    await loadState();
    renderAll();
    toast('Partido creado con cuotas');
  } catch (e) { toast(e.message); }
}

async function reopenMatch(matchId) {
  try {
    await apiFetch(`/admin/matches/${matchId}/reopen`, { method: 'POST', admin: true });
    await loadState();
    await loadMyBets();
    renderAll();
    toast('Partido reabierto');
  } catch (e) { toast(e.message); }
}

async function submitResult() {
  const matchId = document.getElementById('pendingMatchSelect').value;
  const hg = document.getElementById('scoreHome').value;
  const ag = document.getElementById('scoreAway').value;
  if (!matchId || hg === '' || ag === '') { toast('Cargá el marcador completo'); return; }
  const { playerStats, didNotPlay } = collectStatsFromContainer('playerStatsForm');
  try {
    await apiFetch(`/admin/matches/${matchId}/result`, {
      method: 'POST', admin: true, body: { homeGoals: hg, awayGoals: ag, playerStats, didNotPlay },
    });
    document.getElementById('scoreHome').value = '';
    document.getElementById('scoreAway').value = '';
    await loadState();
    await loadMyBets();
    renderAll();
    toast('Resultado cargado, fichas actualizadas');
  } catch (e) { toast(e.message); }
}

// ---------- combinada (carrito de selecciones) ----------
function toggleMatchExpand(matchId) {
  if (expandedMatches.has(matchId)) expandedMatches.delete(matchId);
  else expandedMatches.add(matchId);
  renderMatches();
}
function togglePlayerExpand(key) {
  if (expandedPlayers.has(key)) expandedPlayers.delete(key);
  else expandedPlayers.add(key);
  renderMatches();
}
function toggleLeg(matchId, pick) {
  if (!ME) { toast('Entrá con tu usuario para apostar'); return; }
  if (STATE.marketClosed) { toast('🔒 Mercado cerrado hasta que se carguen los resultados'); return; }
  activeBoostId = null; // tocar algo a mano rompe el combo fijo del superaumento
  const m = STATE.matches.find((mm) => mm.id === matchId);
  const odds = oddsFor(m, pick);
  const label = pickLabel(pick, m);
  const matchLabel = `${m.homeName} vs ${m.awayName}`;
  const existingIndex = CART.findIndex((l) => l.matchId === matchId && l.pick === pick);
  if (existingIndex > -1) CART.splice(existingIndex, 1);
  else CART.push({ matchId, pick, odds, label, matchLabel });
  renderMatches();
  renderCartBar();
}
function removeFromCart(i) {
  activeBoostId = null;
  CART.splice(i, 1);
  if (CART.length === 0) cartPanelOpen = false;
  renderMatches();
  renderCartBar();
}
function toggleCartPanel() {
  cartPanelOpen = !cartPanelOpen;
  renderCartBar();
}
function activeBoost() {
  if (!activeBoostId) return null;
  const b = (STATE.superBoosts || []).find((x) => x.id === activeBoostId);
  if (!b) { activeBoostId = null; return null; }
  return b;
}
function combinedOddsValue() {
  const boost = activeBoost();
  if (boost) return boost.boostedOdds;
  return Math.round(CART.reduce((p, l) => p * l.odds, 1) * 100) / 100;
}
function updateComboPreview() {
  const val = parseInt(document.getElementById('comboStake').value, 10) || 0;
  const odds = combinedOddsValue();
  document.getElementById('comboPreview').textContent =
    val > 0 ? `Si acertás todo, cobrás ${Math.round(val * odds)} fichas` : `Si acertás todo, cobrás fichas × ${odds}`;
}
function applyBoostToCart(boostId) {
  if (!ME) { toast('Entrá con tu usuario para apostar'); return; }
  if (STATE.marketClosed) { toast('🔒 Mercado cerrado hasta que se carguen los resultados'); return; }
  if (MY_BETS.some((bet) => bet.superBoostId === boostId)) { toast('Ya usaste este superaumento'); return; }
  const boost = (STATE.superBoosts || []).find((b) => b.id === boostId);
  if (!boost) { toast('Ese superaumento ya no está disponible'); return; }
  CART = boost.legs.map((l) => ({
    matchId: boost.matchId, pick: l.pick, odds: l.odds, label: l.label,
    matchLabel: `${boost.homeName} vs ${boost.awayName}`,
  }));
  activeBoostId = boost.id;
  cartPanelOpen = true;
  renderMatches();
  renderCartBar();
  toast(`Superaumento cargado: cuota ${boost.boostedOdds}`);
}
async function confirmCombo() {
  if (STATE.marketClosed) { toast('🔒 Mercado cerrado hasta que se carguen los resultados'); return; }
  const stakeInput = document.getElementById('comboStake');
  const stake = parseInt(stakeInput.value, 10);
  if (CART.length === 0) { toast('Elegí al menos una selección'); return; }
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }
  const boost = activeBoost();
  const maxBoostStake = STATE.maxSuperBoostStake || 10000;
  if (boost && stake > maxBoostStake) {
    toast(`El superaumento tiene un tope de ${maxBoostStake} fichas`);
    return;
  }
  try {
    const legs = CART.map((l) => ({ matchId: l.matchId, pick: l.pick }));
    const result = await apiFetch('/bets', { method: 'POST', body: { legs, stake, superBoostId: boost ? boost.id : null } });
    const wasCombo = CART.length > 1;
    CART = [];
    cartPanelOpen = false;
    activeBoostId = null;
    await loadState();
    await loadMyBets();
    renderAll();
    toast(result.wasReset
      ? 'Te quedaste sin fichas — se te recargó la cuenta'
      : result.boostApplied ? `¡Superaumento aplicado! Cuota ${result.combinedOdds}`
      : (wasCombo ? 'Combinada confirmada' : 'Apuesta confirmada'));
  } catch (e) { toast(e.message); }
}
async function cashOutBet(betId) {
  if (STATE.marketClosed) { toast('🔒 Mercado cerrado hasta que se carguen los resultados'); return; }
  try {
    await apiFetch(`/bets/${betId}/cashout`, { method: 'POST' });
    await loadState();
    await loadMyBets();
    renderAll();
    toast('Apuesta cerrada, se te devolvieron las fichas');
  } catch (e) { toast(e.message); }
}

// ---------- rendering ----------
function renderCartBar() {
  const bar = document.getElementById('cartBar');
  if (!bar) return;
  if (CART.length === 0) { bar.innerHTML = ''; return; }
  const boost = activeBoost();
  const combinedOdds = combinedOddsValue();
  const maxBoostStake = STATE.maxSuperBoostStake || 10000;
  let html = `<div class="cart-summary${boost ? ' boosted' : ''}" onclick="toggleCartPanel()">
    <div class="info"><span class="badge">${boost ? icon('fire', 13) : CART.length}</span>${boost ? 'Superaumento' : (CART.length === 1 ? 'selección' : 'selecciones')}<small>cuota combinada ${combinedOdds}</small></div>
    <div class="toggle${cartPanelOpen ? ' open' : ''}">${cartPanelOpen ? 'Cerrar' : 'Ver apuesta'}${icon('chevron', 13)}</div>
  </div>`;
  if (cartPanelOpen) {
    html += `<div class="cart-panel">`;
    if (boost) {
      html += `<div class="boost-cart-hint">${icon('fire', 13)}Superaumento activo: cuota fija ${boost.boostedOdds} · tope ${maxBoostStake} fichas</div>`;
    }
    CART.forEach((l, i) => {
      html += `<div class="cart-leg">
        <span>${l.matchLabel}<small>${l.label} · cuota ${l.odds}</small></span>
        <button class="remove" onclick="removeFromCart(${i})">${icon('close', 12)}</button>
      </div>`;
    });
    html += `<div class="slip" style="border-top:none;padding-top:12px;">
      <label>Monto a apostar (fichas)${boost ? ` — máximo ${maxBoostStake}` : ''}</label>
      <div class="slip-row">
        <input id="comboStake" type="number" min="1" ${boost ? `max="${maxBoostStake}"` : ''} placeholder="Fichas" oninput="updateComboPreview()" ${STATE.marketClosed ? 'disabled' : ''}>
        <button class="confirm" onclick="confirmCombo()" ${STATE.marketClosed ? 'disabled' : ''}>${icon(STATE.marketClosed ? 'lock' : 'check', 13)}${STATE.marketClosed ? 'Cerrado' : 'Confirmar'}</button>
      </div>
      <div class="payout" id="comboPreview">${STATE.marketClosed ? '🔒 Mercado cerrado hasta que se carguen los resultados' : `Si acertás todo, cobrás fichas × ${combinedOdds}`}</div>
    </div>`;
    html += `</div>`;
  }
  bar.innerHTML = html;
}

function renderMarketClosedBanner() {
  const box = document.getElementById('marketClosedBanner');
  if (!box) return;
  box.innerHTML = STATE.marketClosed
    ? `<div class="market-closed-banner">${icon('lock', 16)}<div><b>Mercado cerrado</b><small>No se pueden hacer apuestas nuevas ni cerrar las pendientes. Se reabre en cuanto se carguen los resultados del fin de semana.</small></div></div>`
    : '';
}

function renderSuperBoosts() {
  const bar = document.getElementById('superBoostBar');
  if (!bar) return;
  const boosts = STATE.superBoosts || [];
  if (boosts.length === 0) { bar.innerHTML = ''; return; }
  const maxBoostStake = STATE.maxSuperBoostStake || 10000;
  bar.innerHTML = boosts.map((b) => {
    // cada superaumento se puede usar una sola vez por jugador
    const alreadyUsed = ME && MY_BETS.some((bet) => bet.superBoostId === b.id);
    const cta = alreadyUsed
      ? `<button class="boost-cta boost-cta-used" disabled>${icon('check', 14)}Ya usaste este superaumento</button>`
      : STATE.marketClosed
      ? `<button class="boost-cta boost-cta-used" disabled>${icon('lock', 14)}Mercado cerrado</button>`
      : `<button class="boost-cta" onclick="applyBoostToCart('${b.id}')">${icon('check', 14)}Agregar esta combinada</button>`;
    return `
    <div class="ticket boost-ticket">
      <div class="ticket-body">
        <div class="ticket-meta">
          <span class="status-pill boost-pill"><span class="dot"></span>${icon('fire', 11)}Superaumento</span>
          <span class="match-id">Cuota especial</span>
        </div>
        <div class="ticket-teams" style="cursor:default;">
          <div class="team-chip">${crestHtml(b.homeName)}<span class="name">${b.homeName}</span></div>
          <span class="vs-badge">VS</span>
          <div class="team-chip">${crestHtml(b.awayName)}<span class="name">${b.awayName}</span></div>
        </div>
        <div class="boost-legs">${b.legs.map((l) => `<div class="boost-leg">${icon('check', 12)}${l.label}</div>`).join('')}</div>
        <div class="boost-odds-row"><span class="old">${b.naturalOdds}</span>${icon('login', 14)}<span class="new">${b.boostedOdds}</span></div>
        <div class="boost-cap">Máximo ${maxBoostStake} fichas con esta cuota especial · una vez por jugador</div>
        ${cta}
      </div>
    </div>
  `;
  }).join('');
}

function renderPlayerPropsBlock(m) {
  const THRESHOLD_MARKETS = [
    ['atajadas', 'Atajadas'], ['faltas', 'Faltas cometidas'],
    ['remates', 'Remates'], ['remates_arco', 'Remates al arco'],
  ];
  const BINARY_MARKETS = [
    ['gol', 'Gol'], ['asistencia', 'Asistencia'], ['amarilla', 'Amarilla'], ['roja', 'Roja'],
  ];
  let html = `<div class="market-label">${icon('users')}Jugadores de LEAL</div>`;
  for (const playerName of orderedPlayerNames(m.playerProps)) {
    const props = m.playerProps[playerName];
    const key = m.id + '::' + playerName;
    const isPlayerOpen = expandedPlayers.has(key);
    // cuántas selecciones de este jugador ya están en la combinada (para mostrarlo aunque esté colapsado)
    const pickedCount = CART.filter((l) => l.matchId === m.id && l.pick.startsWith(`prop|${playerName}|`)).length;
    html += `<div class="player-props">
      <div class="player-props-name${isPlayerOpen ? ' open' : ''}" onclick="togglePlayerExpand('${key}')">
        <span class="player-props-left"><span class="player-avatar">${initials(playerName)}</span>${playerName}${pickedCount ? `<span class="player-picked-badge">${pickedCount}</span>` : ''}</span>
        <span class="player-props-toggle">${icon('chevron', 13)}</span>
      </div>`;
    if (isPlayerOpen) {
      for (const [market, label] of THRESHOLD_MARKETS) {
        if (!props[market]) continue;
        const thresholds = Object.keys(props[market]);
        html += `<div class="prop-sublabel">${label}</div><div class="odds-row" style="grid-template-columns:repeat(${thresholds.length},1fr);">`;
        for (const t of thresholds) {
          html += oddsBtn(m.id, `prop|${playerName}|${market}|${t}`, `${t}+`, props[market][t]);
        }
        html += `</div>`;
      }
      const activeBinary = BINARY_MARKETS.filter(([market]) => props[market] !== undefined);
      if (activeBinary.length) {
        html += `<div class="odds-row" style="grid-template-columns:repeat(${activeBinary.length},1fr);margin-top:6px;">`;
        for (const [market, label] of activeBinary) {
          html += oddsBtn(m.id, `prop|${playerName}|${market}`, label, props[market]);
        }
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  return html;
}

// grilla de estadísticas de jugador reutilizable entre "cargar resultado" y "editar resultado"
const STAT_COUNT_MARKETS = [
  ['atajadas', 'Atajadas'], ['faltas', 'Faltas cometidas'],
  ['remates', 'Remates'], ['remates_arco', 'Remates al arco'],
  ['gol', 'Goles'], ['asistencia', 'Asistencias'],
];
function buildStatsFormHtml(match, prefillStats) {
  if (!match.playerProps) return '';
  let html = '';
  for (const playerName of orderedPlayerNames(match.playerProps)) {
    const props = match.playerProps[playerName];
    const prev = (prefillStats && prefillStats[playerName]) || {};
    const didNotPlayBefore = !!prefillStats && !(playerName in prefillStats);
    html += `<div class="stat-player"><div class="stat-player-name">${playerName}</div><div class="stat-grid">`;
    for (const [market, label] of STAT_COUNT_MARKETS) {
      if (props[market] === undefined) continue;
      const val = prev[market] !== undefined ? prev[market] : '';
      html += `<div><label>${label}</label><input type="number" min="0" class="statInput" data-player="${playerName}" data-market="${market}" value="${val}" placeholder="0"></div>`;
    }
    html += `</div><div class="stat-checks">`;
    if (props.amarilla !== undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="amarilla" ${prev.amarilla ? 'checked' : ''}>Amarilla</label>`;
    if (props.roja !== undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="roja" ${prev.roja ? 'checked' : ''}>Roja</label>`;
    html += `</div><label class="dnp-row"><input type="checkbox" class="statDidNotPlay" data-player="${playerName}" ${didNotPlayBefore ? 'checked' : ''}>No jugó este partido</label></div>`;
  }
  return html;
}
function collectStatsFromContainer(containerId) {
  const playerStats = {};
  const didNotPlay = [];
  document.querySelectorAll(`#${containerId} .statInput`).forEach((inp) => {
    const player = inp.dataset.player, market = inp.dataset.market;
    playerStats[player] = playerStats[player] || {};
    playerStats[player][market] = parseInt(inp.value, 10) || 0;
  });
  document.querySelectorAll(`#${containerId} .statCheck`).forEach((chk) => {
    const player = chk.dataset.player, market = chk.dataset.market;
    playerStats[player] = playerStats[player] || {};
    playerStats[player][market] = chk.checked;
  });
  document.querySelectorAll(`#${containerId} .statDidNotPlay`).forEach((chk) => {
    if (chk.checked) didNotPlay.push(chk.dataset.player);
  });
  return { playerStats, didNotPlay };
}

// muestra las estadísticas cargadas de un partido finalizado (solo lectura)
function renderFinishedPlayerStats(m) {
  if (!m.result || !m.result.playerStats) return '';
  const STAT_LABELS = [
    ['gol', 'gol'], ['asistencia', 'asistencia'], ['remates', 'remates'],
    ['remates_arco', 'remates al arco'], ['faltas', 'faltas'], ['atajadas', 'atajadas'],
  ];
  const names = orderedPlayerNames(m.result.playerStats);
  if (names.length === 0) return '';
  let html = `<div class="finished-stats">`;
  for (const playerName of names) {
    const s = m.result.playerStats[playerName];
    const chips = [];
    for (const [key, label] of STAT_LABELS) {
      if (s[key]) chips.push(`${s[key]} ${label}`);
    }
    if (s.amarilla) chips.push('amarilla');
    if (s.roja) chips.push('roja');
    html += `<div class="finished-stat-row"><span class="player-avatar">${initials(playerName)}</span><span class="finished-stat-name">${playerName}</span><small>${chips.length ? chips.join(' · ') : 'sin estadísticas'}</small></div>`;
  }
  html += `</div>`;
  return html;
}

// historial de Leal FC (footer, visible para todos): un cuaderno de resultados que
// cualquier usuario puede completar, contra cualquier rival (esté cargado como
// equipo "oficial" del torneo o no). No tiene nada que ver con el sistema de
// apuestas/partidos programados: es solo un registro histórico de lectura y carga
// libre, agrupado por rival.
function lealHistoryRecordFor(entries) {
  let w = 0, d = 0, l = 0;
  for (const e of entries) {
    if (e.lealGoals > e.opponentGoals) w++;
    else if (e.lealGoals < e.opponentGoals) l++;
    else d++;
  }
  return { w, d, l };
}
function renderLealOverallRecord() {
  const container = document.getElementById('lealOverallRecord');
  if (!container) return;
  const results = STATE.lealResults || [];
  if (results.length === 0) { container.innerHTML = ''; return; }
  const { w, d, l } = lealHistoryRecordFor(results);
  container.innerHTML = `
    <div class="leal-overall-title">${crestHtml(LEAL_TEAM_NAME)}<span>Leal FC — histórico</span></div>
    <div class="leal-overall-stats">
      <div class="leal-overall-stat win"><b>${w}</b><span>Ganados</span></div>
      <div class="leal-overall-stat draw"><b>${d}</b><span>Empatados</span></div>
      <div class="leal-overall-stat loss"><b>${l}</b><span>Perdidos</span></div>
    </div>
  `;
}
function toggleHistoryTeam(key) {
  if (expandedHistoryTeams.has(key)) expandedHistoryTeams.delete(key);
  else expandedHistoryTeams.add(key);
  renderLealHistory();
}
function populateLealHistoryTeamSuggestions() {
  const datalist = document.getElementById('lhTeamSuggestions');
  if (!datalist) return;
  datalist.innerHTML = STATE.teams
    .filter((t) => t.name !== LEAL_TEAM_NAME)
    .map((t) => `<option value="${t.name}">`)
    .join('');
}
// si el nombre de un rival coincide (sin importar mayúsculas) con un equipo
// oficial del torneo, se muestra con el casing oficial (así el escudo real se
// reconoce aunque alguien lo haya tipeado en minúsculas); si no, tal cual está.
function resolveOpponentLabel(rawOpponent) {
  const key = rawOpponent.trim().toLowerCase();
  const official = STATE.teams.find((t) => t.name.toLowerCase() === key);
  return official ? official.name : rawOpponent.trim();
}
function currentUserCanLogHistory() {
  const myEntry = ME ? STATE.ranking.find((r) => r.name === ME) : null;
  return !!(myEntry && myEntry.canLogLealHistory);
}

// ---------- filas de goleadores (nombre + goles), reusadas para agregar y editar ----------
function scorerRowHtml(name, goals) {
  const safeName = (name || '').replace(/"/g, '&quot;');
  return `<div class="scorer-row">
    <input type="text" class="scorerName" placeholder="Nombre" maxlength="60" value="${safeName}">
    <input type="number" class="scorerGoals" min="1" value="${goals || 1}">
    <button type="button" class="scorer-remove" onclick="this.parentElement.remove()">${icon('close', 11)}</button>
  </div>`;
}
function addScorerRow(containerId, name, goals) {
  const container = document.getElementById(containerId || 'lhScorersRows');
  if (!container) return;
  container.insertAdjacentHTML('beforeend', scorerRowHtml(name, goals));
}
function collectScorerRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .scorer-row`))
    .map((row) => ({
      name: row.querySelector('.scorerName').value.trim(),
      goals: parseInt(row.querySelector('.scorerGoals').value, 10) || 1,
    }))
    .filter((s) => s.name);
}

// ---------- filas simples (un solo nombre): amarillas y rojas ----------
function simpleNameRowHtml(name) {
  const safe = (name || '').replace(/"/g, '&quot;');
  return `<div class="scorer-row">
    <input type="text" class="simpleName" placeholder="Nombre" maxlength="40" value="${safe}">
    <button type="button" class="scorer-remove" onclick="this.parentElement.remove()">${icon('close', 11)}</button>
  </div>`;
}
function addSimpleNameRow(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.insertAdjacentHTML('beforeend', simpleNameRowHtml(''));
}
function collectSimpleNameRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .simpleName`)).map((i) => i.value.trim()).filter(Boolean);
}

// ---------- filas de cambios (sale / entra / minuto) ----------
function subRowHtml(out, playerIn) {
  const safeOut = (out || '').replace(/"/g, '&quot;');
  const safeIn = (playerIn || '').replace(/"/g, '&quot;');
  return `<div class="sub-row">
    <input type="text" class="subOut" placeholder="Sale" maxlength="40" value="${safeOut}">
    <input type="text" class="subIn" placeholder="Entra" maxlength="40" value="${safeIn}">
    <button type="button" class="scorer-remove" onclick="this.parentElement.remove()">${icon('close', 11)}</button>
  </div>`;
}
function addSubRow(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.insertAdjacentHTML('beforeend', subRowHtml('', ''));
}
function collectSubRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .sub-row`))
    .map((row) => ({
      out: row.querySelector('.subOut').value.trim(),
      in: row.querySelector('.subIn').value.trim(),
    }))
    .filter((s) => s.out || s.in);
}

// ---------- formación dibujada: cancha + 11 posiciones por formación ----------
const FORMATIONS = {
  '4-4-2': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 15, y: 72, pos: 'DEF' }, { x: 38, y: 75, pos: 'DEF' }, { x: 62, y: 75, pos: 'DEF' }, { x: 85, y: 72, pos: 'DEF' },
    { x: 15, y: 45, pos: 'MED' }, { x: 38, y: 48, pos: 'MED' }, { x: 62, y: 48, pos: 'MED' }, { x: 85, y: 45, pos: 'MED' },
    { x: 35, y: 15, pos: 'DEL' }, { x: 65, y: 15, pos: 'DEL' },
  ],
  '4-3-3': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 15, y: 72, pos: 'DEF' }, { x: 38, y: 75, pos: 'DEF' }, { x: 62, y: 75, pos: 'DEF' }, { x: 85, y: 72, pos: 'DEF' },
    { x: 30, y: 48, pos: 'MED' }, { x: 50, y: 45, pos: 'MED' }, { x: 70, y: 48, pos: 'MED' },
    { x: 15, y: 15, pos: 'DEL' }, { x: 50, y: 10, pos: 'DEL' }, { x: 85, y: 15, pos: 'DEL' },
  ],
  '4-2-3-1': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 15, y: 72, pos: 'DEF' }, { x: 38, y: 75, pos: 'DEF' }, { x: 62, y: 75, pos: 'DEF' }, { x: 85, y: 72, pos: 'DEF' },
    { x: 38, y: 52, pos: 'MCD' }, { x: 62, y: 52, pos: 'MCD' },
    { x: 20, y: 30, pos: 'MED' }, { x: 50, y: 28, pos: 'MED' }, { x: 80, y: 30, pos: 'MED' },
    { x: 50, y: 10, pos: 'DEL' },
  ],
  '3-5-2': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 25, y: 75, pos: 'DEF' }, { x: 50, y: 78, pos: 'DEF' }, { x: 75, y: 75, pos: 'DEF' },
    { x: 12, y: 48, pos: 'MED' }, { x: 32, y: 45, pos: 'MED' }, { x: 50, y: 42, pos: 'MED' }, { x: 68, y: 45, pos: 'MED' }, { x: 88, y: 48, pos: 'MED' },
    { x: 38, y: 15, pos: 'DEL' }, { x: 62, y: 15, pos: 'DEL' },
  ],
  '3-4-3': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 25, y: 75, pos: 'DEF' }, { x: 50, y: 78, pos: 'DEF' }, { x: 75, y: 75, pos: 'DEF' },
    { x: 15, y: 48, pos: 'MED' }, { x: 38, y: 45, pos: 'MED' }, { x: 62, y: 45, pos: 'MED' }, { x: 85, y: 48, pos: 'MED' },
    { x: 15, y: 15, pos: 'DEL' }, { x: 50, y: 10, pos: 'DEL' }, { x: 85, y: 15, pos: 'DEL' },
  ],
  '5-3-2': [
    { x: 50, y: 92, pos: 'POR' },
    { x: 10, y: 72, pos: 'DEF' }, { x: 30, y: 78, pos: 'DEF' }, { x: 50, y: 80, pos: 'DEF' }, { x: 70, y: 78, pos: 'DEF' }, { x: 90, y: 72, pos: 'DEF' },
    { x: 30, y: 45, pos: 'MED' }, { x: 50, y: 42, pos: 'MED' }, { x: 70, y: 45, pos: 'MED' },
    { x: 35, y: 15, pos: 'DEL' }, { x: 65, y: 15, pos: 'DEL' },
  ],
};
const POSITION_NAMES = { POR: 'Arquero', DEF: 'Defensor', MCD: 'Volante de marca', MED: 'Mediocampista', DEL: 'Delantero' };
function formationInputLabels(formation) {
  const positions = FORMATIONS[formation] || FORMATIONS['4-4-2'];
  const counts = {};
  return positions.map((p) => {
    counts[p.pos] = (counts[p.pos] || 0) + 1;
    return `${POSITION_NAMES[p.pos] || p.pos} ${counts[p.pos]}`;
  });
}
// cancha con rayado de césped, áreas completas (chica + grande + arco) y
// banderines de córner, más realista que un rectángulo verde liso. En modo
// editable (opts.editable), cada jugador es tocable: tocarlo selecciona esa
// posición para escribirle el nombre (ver selectLineupSlot).
function pitchSvg(formation, players, opts) {
  opts = opts || {};
  const uid = String(opts.matchId || 'v').replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `pitchGrad-${uid}`;
  const vignetteId = `pitchVig-${uid}`;
  const positions = FORMATIONS[formation] || FORMATIONS['4-4-2'];
  const dots = positions.map((p, i) => {
    const player = (players && players[i]) || {};
    const name = String((typeof player === 'string' ? player : player.name) || '').trim();
    const number = String((typeof player === 'string' ? '' : player.number) || '').trim();
    const label = number || String(i + 1); // el dorsal se muestra en vez de iniciales
    const firstName = name ? name.split(' ')[0] : '';
    const isActive = opts.editable && opts.activeSlot === i;
    const isCaptain = opts.captainIndex === i;
    const clickAttr = opts.editable ? ` onclick="selectLineupSlot('${opts.matchId}', ${i})"` : '';
    // brazalete de capitán: una insignia chica arriba a la derecha del círculo
    const captainBadge = isCaptain
      ? `<circle id="pitchCaptain-${uid}-${i}" cx="${p.x + 4.6}" cy="${p.y - 4.6}" r="2.3" class="pitch-captain-badge"></circle>
         <text id="pitchCaptainText-${uid}-${i}" x="${p.x + 4.6}" y="${p.y - 4.6}" class="pitch-captain-text">C</text>`
      : `<circle id="pitchCaptain-${uid}-${i}" cx="${p.x + 4.6}" cy="${p.y - 4.6}" r="2.3" class="pitch-captain-badge" style="display:none;"></circle>
         <text id="pitchCaptainText-${uid}-${i}" x="${p.x + 4.6}" y="${p.y - 4.6}" class="pitch-captain-text" style="display:none;">C</text>`;
    // el nombre siempre va debajo del círculo, como en el resto de los
    // jugadores (el arco tiene lugar de sobra abajo gracias al margen extra
    // de césped que se agrega después de la línea de fondo).
    const nameY = p.y + 10.4;
    return `<g class="pitch-player${isActive ? ' active' : ''}"${clickAttr}>
      <circle cx="${p.x}" cy="${p.y}" r="6.3" fill="url(#${gradId})"></circle>
      <text id="pitchLabel-${uid}-${i}" x="${p.x}" y="${p.y}">${label}</text>
      <text id="pitchName-${uid}-${i}" x="${p.x}" y="${nameY}" text-anchor="middle" class="pitch-player-name">${firstName}</text>
      ${captainBadge}
    </g>`;
  }).join('');
  // franjas de césped cortado (alternadas) + viñeta suave en los bordes, como
  // en las gráficas de alineación de las apps de fútbol. El lienzo mide más
  // que la cancha dibujada (108 contra 100) para que quede un margen de
  // césped debajo de la línea de fondo: ahí es donde entra el nombre del
  // arquero sin quedar recortado ni pisado por su círculo.
  const PITCH_H = 108;
  let stripes = '';
  for (let i = 0; i < Math.ceil(PITCH_H / 12.5); i++) {
    const y = i * 12.5;
    stripes += `<rect x="0" y="${y}" width="100" height="${Math.min(12.5, PITCH_H - y)}" class="${i % 2 === 0 ? 'pitch-stripe-a' : 'pitch-stripe-b'}"></rect>`;
  }
  return `<svg viewBox="0 0 100 ${PITCH_H}" class="pitch-svg${opts.editable ? ' pitch-editable' : ''}" preserveAspectRatio="none">
    <defs>
      <radialGradient id="${gradId}" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#fbe7b8"></stop>
        <stop offset="45%" stop-color="#F0C25A"></stop>
        <stop offset="100%" stop-color="#C8912E"></stop>
      </radialGradient>
      <radialGradient id="${vignetteId}" cx="50%" cy="48%" r="72%">
        <stop offset="55%" stop-color="#000" stop-opacity="0"></stop>
        <stop offset="100%" stop-color="#000" stop-opacity="0.45"></stop>
      </radialGradient>
    </defs>
    ${stripes}
    <rect x="1" y="1" width="98" height="98" class="pitch-mark pitch-border"></rect>
    <line x1="1" y1="50" x2="99" y2="50" class="pitch-mark"></line>
    <circle cx="50" cy="50" r="9" class="pitch-mark"></circle>
    <circle cx="50" cy="50" r="0.8" class="pitch-spot"></circle>
    <!-- área grande y chica propia (arquero, abajo) -->
    <rect x="21" y="83" width="58" height="17" class="pitch-mark"></rect>
    <rect x="38" y="94" width="24" height="6" class="pitch-mark"></rect>
    <circle cx="50" cy="89" r="0.8" class="pitch-spot"></circle>
    <path d="M 39 83 A 11 11 0 0 0 61 83" class="pitch-mark"></path>
    <!-- área grande y chica rival (arriba) -->
    <rect x="21" y="0" width="58" height="17" class="pitch-mark"></rect>
    <rect x="38" y="0" width="24" height="6" class="pitch-mark"></rect>
    <circle cx="50" cy="11" r="0.8" class="pitch-spot"></circle>
    <path d="M 39 17 A 11 11 0 0 1 61 17" class="pitch-mark"></path>
    <!-- banderines de córner -->
    <path d="M 1 4 A 3 3 0 0 0 4 1" class="pitch-mark"></path>
    <path d="M 96 1 A 3 3 0 0 0 99 4" class="pitch-mark"></path>
    <path d="M 99 96 A 3 3 0 0 0 96 99" class="pitch-mark"></path>
    <path d="M 4 99 A 3 3 0 0 0 1 96" class="pitch-mark"></path>
    <rect x="0" y="0" width="100" height="${PITCH_H}" fill="url(#${vignetteId})"></rect>
    ${dots}
  </svg>`;
}

function toggleLealMatchDetail(id) {
  if (expandedLealMatches.has(id)) expandedLealMatches.delete(id);
  else expandedLealMatches.add(id);
  renderAllMatchesList();
}

// ---------- editor de formación (cancha + cambios + amarillas/rojas + figura) ----------
// La alineación se carga TOCANDO cada jugador en la cancha (no escribiendo en
// una lista): tocar un jugador lo selecciona, y un solo campo de texto abajo
// (con flechas para pasar al anterior/siguiente) sirve para escribirle el
// nombre. lineupPlayersDraft/lineupActiveSlot son el estado de ese editor
// mientras está abierto (no se guarda hasta tocar "Guardar formación").
let editingLineupId = null;
let lineupFormationDraft = '4-4-2';
function blankLineupPlayers() { return new Array(11).fill(0).map(() => ({ name: '', number: '' })); }
let lineupPlayersDraft = blankLineupPlayers();
let lineupActiveSlot = 0;
let lineupCaptainDraft = null;
function startEditLineup(id) {
  editingLealMatchId = null; // no mezclar con el editor de resultado del mismo partido
  editingLineupId = id;
  expandedLealMatches.add(id);
  const r = (STATE.lealMatchesPlayed || []).find((x) => x.id === id);
  lineupFormationDraft = (r && r.lineup && r.lineup.formation) || '4-4-2';
  const existing = (r && r.lineup && r.lineup.formation === lineupFormationDraft && r.lineup.players) || [];
  lineupPlayersDraft = blankLineupPlayers().map((blank, i) => ({
    name: (existing[i] && existing[i].name) || '',
    number: (existing[i] && existing[i].number) || '',
  }));
  lineupActiveSlot = 0;
  lineupCaptainDraft = (r && r.lineup && r.lineup.formation === lineupFormationDraft && Number.isInteger(r.lineup.captainIndex))
    ? r.lineup.captainIndex
    : null;
  renderAllMatchesList();
}
function cancelEditLineup() {
  editingLineupId = null;
  renderAllMatchesList();
}
function onLineupFormationChange(id) {
  // al cambiar de formación cambia la cantidad/orden de posiciones, así que
  // (por simpleza) se reinicia la alineación titular tipeada hasta ahora.
  lineupFormationDraft = document.getElementById(`lineupFormation-${id}`).value;
  lineupPlayersDraft = blankLineupPlayers();
  lineupActiveSlot = 0;
  lineupCaptainDraft = null;
  renderAllMatchesList();
}
// marca/desmarca al jugador actualmente seleccionado en la cancha como capitán
function toggleLineupCaptain(id, index) {
  lineupCaptainDraft = lineupCaptainDraft === index ? null : index;
  renderAllMatchesList();
}
function focusLineupSlotInput(id) {
  setTimeout(() => {
    const inp = document.getElementById(`lineupSlotNameInput-${id}`);
    if (inp) { inp.focus(); inp.select(); }
  }, 0);
}
// tocar un jugador en la cancha lo selecciona para escribirle el nombre
function selectLineupSlot(id, index) {
  lineupActiveSlot = index;
  renderAllMatchesList();
  focusLineupSlotInput(id);
}
function stepLineupSlot(id, delta) {
  const total = formationInputLabels(lineupFormationDraft).length;
  lineupActiveSlot = (lineupActiveSlot + delta + total) % total;
  renderAllMatchesList();
  focusLineupSlotInput(id);
}
// mientras se tipea, actualiza el dibujo de la cancha en vivo tocando solo los
// textos de esa posición (no se vuelve a renderizar todo, así no se pierde el
// foco del campo de texto en cada letra). El dorsal se muestra en el círculo;
// el nombre (primer nombre) va debajo.
function refreshPitchSlotVisual(id, index) {
  const player = lineupPlayersDraft[index] || { name: '', number: '' };
  const name = (player.name || '').trim();
  const number = (player.number || '').trim();
  const uid = String(id).replace(/[^a-zA-Z0-9]/g, '');
  const labelEl = document.getElementById(`pitchLabel-${uid}-${index}`);
  const nameEl = document.getElementById(`pitchName-${uid}-${index}`);
  if (labelEl) labelEl.textContent = number || String(index + 1);
  if (nameEl) nameEl.textContent = name ? name.split(' ')[0] : '';
}
function onLineupSlotNameInput(id, index) {
  const inp = document.getElementById(`lineupSlotNameInput-${id}`);
  if (!inp) return;
  lineupPlayersDraft[index].name = inp.value;
  refreshPitchSlotVisual(id, index);
}
function onLineupSlotNumberInput(id, index) {
  const inp = document.getElementById(`lineupSlotNumberInput-${id}`);
  if (!inp) return;
  lineupPlayersDraft[index].number = inp.value.replace(/[^0-9]/g, '').slice(0, 3);
  inp.value = lineupPlayersDraft[index].number;
  refreshPitchSlotVisual(id, index);
}
async function saveLineup(id) {
  const formation = document.getElementById(`lineupFormation-${id}`).value;
  const players = lineupPlayersDraft.slice(0, 11).map((p) => ({ name: (p.name || '').trim(), number: (p.number || '').trim() }));
  while (players.length < 11) players.push({ name: '', number: '' });
  const subs = collectSubRows(`lineupSubs-${id}`);
  const yellows = collectSimpleNameRows(`lineupYellows-${id}`);
  const reds = collectSimpleNameRows(`lineupReds-${id}`);
  const figura = document.getElementById(`lineupFigura-${id}`).value.trim();
  try {
    await apiFetch(`/leal-matches/${id}/lineup`, { method: 'PUT', body: { lineup: { formation, players, subs, yellows, reds, figura, captainIndex: lineupCaptainDraft } } });
    editingLineupId = null;
    await loadState();
    renderAll();
    toast('Formación guardada');
  } catch (e) { toast(e.message); }
}

// arma la sección de formación/cambios/tarjetas de un partido de "Partidos
// jugados" (modo lectura, modo edición, o el botón para cargarla si todavía
// no existe). Es un cuaderno aparte de "Por rival": no tiene formación.
function buildLineupSectionHtml(r) {
  const canLog = currentUserCanLogHistory();
  const lineup = r.lineup || null;
  if (editingLineupId === r.id) {
    const formation = lineupFormationDraft;
    const labels = formationInputLabels(formation);
    const activeSlot = Math.min(lineupActiveSlot, labels.length - 1);
    const subRows = (lineup && lineup.subs || []).map((s) => subRowHtml(s.out, s.in)).join('') || subRowHtml('', '');
    const yellowRows = (lineup && lineup.yellows || []).map((n) => simpleNameRowHtml(n)).join('') || simpleNameRowHtml('');
    const redRows = (lineup && lineup.reds || []).map((n) => simpleNameRowHtml(n)).join('') || simpleNameRowHtml('');
    return `<div class="lineup-editor">
      <label>Formación</label>
      <select id="lineupFormation-${r.id}" onchange="onLineupFormationChange('${r.id}')">
        ${Object.keys(FORMATIONS).map((f) => `<option value="${f}" ${f === formation ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
      <p class="lineup-tap-hint">${icon('users', 13)}Tocá un jugador en la cancha para escribirle el nombre</p>
      ${pitchSvg(formation, lineupPlayersDraft, { editable: true, matchId: r.id, activeSlot, captainIndex: lineupCaptainDraft })}
      <div class="lineup-slot-editor">
        <button type="button" class="lineup-slot-nav" onclick="stepLineupSlot('${r.id}', -1)">${icon('chevron', 14)}</button>
        <div class="lineup-slot-field">
          <label>${labels[activeSlot]}</label>
          <div class="lineup-slot-inputs">
            <input type="text" inputmode="numeric" class="lineup-slot-number" id="lineupSlotNumberInput-${r.id}" maxlength="3" placeholder="N°"
              value="${(lineupPlayersDraft[activeSlot].number || '').replace(/"/g, '&quot;')}" oninput="onLineupSlotNumberInput('${r.id}', ${activeSlot})">
            <input type="text" class="lineup-slot-name" id="lineupSlotNameInput-${r.id}" maxlength="40" placeholder="Nombre del jugador"
              value="${(lineupPlayersDraft[activeSlot].name || '').replace(/"/g, '&quot;')}" oninput="onLineupSlotNameInput('${r.id}', ${activeSlot})">
          </div>
        </div>
        <button type="button" class="lineup-slot-nav lineup-slot-nav-next" onclick="stepLineupSlot('${r.id}', 1)">${icon('chevron', 14)}</button>
      </div>
      <button type="button" class="reopen-btn" onclick="toggleLineupCaptain('${r.id}', ${activeSlot})">${icon('star', 13)}${lineupCaptainDraft === activeSlot ? 'Quitar de capitán' : 'Marcar como capitán'}</button>

      <label>Figura del partido (opcional)</label>
      <input type="text" id="lineupFigura-${r.id}" maxlength="40" placeholder="Ej: Santiago Suarez" value="${((lineup && lineup.figura) || '').replace(/"/g, '&quot;')}">

      <label>Cambios</label>
      <div id="lineupSubs-${r.id}">${subRows}</div>
      <button type="button" class="scorer-add-btn" onclick="addSubRow('lineupSubs-${r.id}')">+ Agregar cambio</button>

      <label>Amarillas</label>
      <div id="lineupYellows-${r.id}">${yellowRows}</div>
      <button type="button" class="scorer-add-btn" onclick="addSimpleNameRow('lineupYellows-${r.id}')">+ Agregar amarilla</button>

      <label>Rojas</label>
      <div id="lineupReds-${r.id}">${redRows}</div>
      <button type="button" class="scorer-add-btn" onclick="addSimpleNameRow('lineupReds-${r.id}')">+ Agregar roja</button>

      <div class="row2" style="margin-top:12px;">
        <button class="primary-btn" onclick="saveLineup('${r.id}')">Guardar formación</button>
        <button class="reopen-btn" onclick="cancelEditLineup()">Cancelar</button>
      </div>
    </div>`;
  }
  if (lineup && lineup.players && lineup.players.some((p) => p && (p.name || p.number))) {
    return `<div class="lineup-view">
      ${pitchSvg(lineup.formation, lineup.players, { matchId: r.id, captainIndex: lineup.captainIndex })}
      ${lineup.figura ? `<div class="lineup-events lineup-figura">${icon('star', 13)}Figura: <b>${lineup.figura}</b></div>` : ''}
      ${lineup.subs && lineup.subs.length ? `<div class="lineup-events">${icon('undo', 13)}<b>Cambios:</b> ${lineup.subs.map((s) => `${s.out || '?'} → ${s.in || '?'}`).join(', ')}</div>` : ''}
      ${lineup.yellows && lineup.yellows.length ? `<div class="lineup-events lineup-yellow">${icon('card', 13)}<b>Amarillas:</b> ${lineup.yellows.join(', ')}</div>` : ''}
      ${lineup.reds && lineup.reds.length ? `<div class="lineup-events lineup-red">${icon('card', 13)}<b>Rojas:</b> ${lineup.reds.join(', ')}</div>` : ''}
      ${canLog ? `<button class="reopen-btn" style="margin-top:4px;" onclick="startEditLineup('${r.id}')">${icon('undo', 13)}Editar formación</button>` : ''}
    </div>`;
  }
  if (canLog) {
    return `<div class="lineup-view"><button class="reopen-btn" onclick="startEditLineup('${r.id}')">${icon('undo', 13)}Cargar formación</button></div>`;
  }
  return `<div class="lineup-view"><div class="empty" style="padding:16px;">${icon('users', 20)}Todavía no cargaron la formación de este partido.</div></div>`;
}

async function addLealResult() {
  if (!ME) { toast('Entrá con tu usuario para cargar un resultado'); return; }
  const opponentInput = document.getElementById('lhOpponentInput');
  const lealGoalsInput = document.getElementById('lhLealGoals');
  const opponentGoalsInput = document.getElementById('lhOpponentGoals');
  const playedOnInput = document.getElementById('lhPlayedOnInput');
  const opponent = opponentInput.value.trim();
  const lealGoals = parseInt(lealGoalsInput.value, 10);
  const opponentGoals = parseInt(opponentGoalsInput.value, 10);
  if (!opponent) { toast('Poné contra qué equipo jugó Leal'); return; }
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    toast('Cargá un marcador válido'); return;
  }
  const scorers = collectScorerRows('lhScorersRows');
  try {
    await apiFetch('/leal-history', {
      method: 'POST',
      body: { opponent, lealGoals, opponentGoals, scorers, playedOn: playedOnInput.value.trim() },
    });
    opponentInput.value = ''; lealGoalsInput.value = ''; opponentGoalsInput.value = ''; playedOnInput.value = '';
    document.getElementById('lhScorersRows').innerHTML = '';
    addScorerRow('lhScorersRows');
    await loadState();
    renderAll();
    toast('Resultado agregado al historial');
  } catch (e) { toast(e.message); }
}
async function deleteLealResult(id) {
  try {
    await apiFetch(`/leal-history/${id}`, { method: 'DELETE', admin: true });
    await loadState();
    renderAll();
    toast('Resultado borrado');
  } catch (e) { toast(e.message); }
}

let editingLealResultId = null;
function startEditLealResult(id) {
  editingLineupId = null; // no mezclar con el editor de formación del mismo partido
  editingLealResultId = id;
  renderLealHistory();
}
function cancelEditLealResult() {
  editingLealResultId = null;
  renderLealHistory();
}
async function saveLealResultEdit(id) {
  const opponent = document.getElementById(`editLhOpponent-${id}`).value.trim();
  const lealGoals = parseInt(document.getElementById(`editLhLealGoals-${id}`).value, 10);
  const opponentGoals = parseInt(document.getElementById(`editLhOpponentGoals-${id}`).value, 10);
  const playedOn = document.getElementById(`editLhPlayedOn-${id}`).value.trim();
  if (!opponent) { toast('Poné contra qué equipo jugó Leal'); return; }
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    toast('Cargá un marcador válido'); return;
  }
  const scorers = collectScorerRows(`editLhScorers-${id}`);
  try {
    await apiFetch(`/leal-history/${id}`, { method: 'PUT', admin: true, body: { opponent, lealGoals, opponentGoals, scorers, playedOn } });
    editingLealResultId = null;
    await loadState();
    renderAll();
    toast('Resultado corregido');
  } catch (e) { toast(e.message); }
}

// ---------- estadísticas: varias tablas que se arman solas con lo cargado ----------
// Goleadores sale de scorers_detail (ya existía); partidos jugados/amarillas/
// rojas/figura salen de la formación (lineup) de cada partido, cuando está
// cargada. Todo se recalcula solo, no hay nada que mantener a mano.
function aggregateGoals() {
  const results = STATE.lealResults || [];
  const totals = {};
  for (const r of results) {
    for (const s of (r.scorersDetail || [])) {
      const name = (s.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!totals[key]) totals[key] = { label: name, count: 0, matches: 0 };
      totals[key].count += s.goals;
      totals[key].matches += 1;
    }
  }
  return Object.values(totals).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
function aggregateLineupStat(kind) {
  const results = STATE.lealMatchesPlayed || []; // las formaciones viven en "Partidos jugados", aparte de "Por rival"
  const totals = {};
  for (const r of results) {
    const lineup = r.lineup;
    if (!lineup) continue;
    let names = [];
    if (kind === 'played') {
      const starters = (lineup.players || []).map((p) => (p && p.name) || '').filter(Boolean);
      const subsIn = (lineup.subs || []).map((s) => s.in).filter(Boolean);
      names = Array.from(new Set([...starters, ...subsIn].map((n) => n.trim()).filter(Boolean)));
    } else if (kind === 'yellow') names = lineup.yellows || [];
    else if (kind === 'red') names = lineup.reds || [];
    else if (kind === 'figura') names = lineup.figura ? [lineup.figura] : [];
    for (const raw of names) {
      const name = (raw || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!totals[key]) totals[key] = { label: name, count: 0 };
      totals[key].count += 1;
    }
  }
  return Object.values(totals).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
const STATS_CONFIG = {
  goals: { icon: 'goal', empty: 'Todavía no hay goleadores cargados.' },
  played: { icon: 'users', empty: 'Todavía no hay partidos con formación cargada.' },
  yellow: { icon: 'card', empty: 'Todavía no hay amarillas cargadas.' },
  red: { icon: 'card', empty: 'Todavía no hay rojas cargadas.' },
  figura: { icon: 'star', empty: 'Todavía no eligieron ninguna figura del partido.' },
};
let statsView = 'goals';
function setStatsView(kind) {
  statsView = kind;
  document.querySelectorAll('#statsSubtabs button').forEach((b) => b.classList.toggle('active', b.dataset.stat === kind));
  renderStatsView();
}
function renderStatsView() {
  const container = document.getElementById('statsTableList');
  if (!container) return;
  const cfg = STATS_CONFIG[statsView] || STATS_CONFIG.goals;
  const rows = statsView === 'goals' ? aggregateGoals() : aggregateLineupStat(statsView);
  if (rows.length === 0) {
    container.innerHTML = `<div class="empty">${icon(cfg.icon, 26)}${cfg.empty}</div>`;
    return;
  }
  container.innerHTML = rows.map((r, i) => `
    <div class="scorer-rank-row${i === 0 ? ' top' : ''}">
      <div class="scorer-rank-pos">${i + 1}</div>
      <div class="scorer-rank-name">${r.label}${statsView === 'goals' ? `<small>${r.matches} partido${r.matches === 1 ? '' : 's'} convirtiendo</small>` : ''}</div>
      <div class="scorer-rank-goals${statsView === 'red' ? ' is-red' : ''}">${icon(cfg.icon, 13)}${r.count}</div>
    </div>
  `).join('');
}

// ---------- partidos jugados: todos los resultados, sin agrupar por rival ----------
// ---------- "Partidos jugados": cuaderno aparte de "Por rival" ----------
function populateLealMatchesTeamSuggestions() {
  const datalist = document.getElementById('lmTeamSuggestions');
  if (!datalist) return;
  datalist.innerHTML = STATE.teams
    .filter((t) => t.name !== LEAL_TEAM_NAME)
    .map((t) => `<option value="${t.name}">`)
    .join('');
}
async function addLealMatchPlayed() {
  if (!ME) { toast('Entrá con tu usuario para cargar un partido'); return; }
  const opponentInput = document.getElementById('lmOpponentInput');
  const lealGoalsInput = document.getElementById('lmLealGoals');
  const opponentGoalsInput = document.getElementById('lmOpponentGoals');
  const playedOnInput = document.getElementById('lmPlayedOnInput');
  const opponent = opponentInput.value.trim();
  const lealGoals = parseInt(lealGoalsInput.value, 10);
  const opponentGoals = parseInt(opponentGoalsInput.value, 10);
  if (!opponent) { toast('Poné contra qué equipo jugó Leal'); return; }
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    toast('Cargá un marcador válido'); return;
  }
  const scorers = collectScorerRows('lmScorersRows');
  try {
    await apiFetch('/leal-matches', {
      method: 'POST',
      body: { opponent, lealGoals, opponentGoals, scorers, playedOn: playedOnInput.value.trim() },
    });
    opponentInput.value = ''; lealGoalsInput.value = ''; opponentGoalsInput.value = ''; playedOnInput.value = '';
    document.getElementById('lmScorersRows').innerHTML = '';
    addScorerRow('lmScorersRows');
    await loadState();
    renderAll();
    toast('Partido agregado');
  } catch (e) { toast(e.message); }
}
async function deleteLealMatchPlayed(id) {
  try {
    await apiFetch(`/leal-matches/${id}`, { method: 'DELETE', admin: true });
    await loadState();
    renderAll();
    toast('Partido borrado');
  } catch (e) { toast(e.message); }
}
let editingLealMatchId = null;
function startEditLealMatchPlayed(id) {
  editingLineupId = null; // no mezclar con el editor de formación del mismo partido
  editingLealMatchId = id;
  renderAllMatchesList();
}
function cancelEditLealMatchPlayed() {
  editingLealMatchId = null;
  renderAllMatchesList();
}
async function saveLealMatchPlayedEdit(id) {
  const opponent = document.getElementById(`editLmOpponent-${id}`).value.trim();
  const lealGoals = parseInt(document.getElementById(`editLmLealGoals-${id}`).value, 10);
  const opponentGoals = parseInt(document.getElementById(`editLmOpponentGoals-${id}`).value, 10);
  const playedOn = document.getElementById(`editLmPlayedOn-${id}`).value.trim();
  if (!opponent) { toast('Poné contra qué equipo jugó Leal'); return; }
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    toast('Cargá un marcador válido'); return;
  }
  const scorers = collectScorerRows(`editLmScorers-${id}`);
  try {
    await apiFetch(`/leal-matches/${id}`, { method: 'PUT', admin: true, body: { opponent, lealGoals, opponentGoals, scorers, playedOn } });
    editingLealMatchId = null;
    await loadState();
    renderAll();
    toast('Partido corregido');
  } catch (e) { toast(e.message); }
}

// interpreta "Fecha (opcional)" en formato DD/MM/AAAA (lo que pide el placeholder
// del formulario); devuelve el timestamp o null si está vacío/mal escrito, para
// poder ordenar "Partidos jugados" por fecha real de partido.
function parsePlayedOnDate(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let day = parseInt(m[1], 10);
  let month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return dt.getTime();
}

function renderAllMatchesList() {
  const container = document.getElementById('allMatchesList');
  if (!container) return;
  populateLealMatchesTeamSuggestions();

  const formEl = document.getElementById('lealMatchAddForm');
  const canLog = currentUserCanLogHistory();
  if (formEl) formEl.style.display = canLog ? 'block' : 'none';
  const scorersRowsEl = document.getElementById('lmScorersRows');
  if (scorersRowsEl && canLog && scorersRowsEl.children.length === 0) addScorerRow('lmScorersRows');

  // ordenados por fecha del partido (más reciente primero); los que no tienen
  // fecha cargada quedan al final, en el orden en que se cargaron.
  const results = (STATE.lealMatchesPlayed || []).slice().sort((a, b) => {
    const da = parsePlayedOnDate(a.playedOn);
    const db = parsePlayedOnDate(b.playedOn);
    if (da != null && db != null) return db - da;
    if (da != null) return -1;
    if (db != null) return 1;
    return b.createdAt - a.createdAt;
  });
  if (results.length === 0) {
    container.innerHTML = `<div class="empty">${icon('trophy', 26)}Todavía no cargaron ningún partido acá. ¡Agregá el primero!</div>`;
    return;
  }
  container.innerHTML = results.map((r) => {
    const label = resolveOpponentLabel(r.opponent);
    if (isAdmin && editingLealMatchId === r.id) {
      const scorerRows = (r.scorersDetail || []).map((s) => scorerRowHtml(s.name, s.goals)).join('') || scorerRowHtml('', 1);
      return `<div class="history-match history-match-editing">
        <label>Rival</label>
        <input id="editLmOpponent-${r.id}" type="text" value="${r.opponent.replace(/"/g, '&quot;')}" maxlength="60">
        <label>Marcador (Leal FC primero)</label>
        <div class="result-inline">
          <input id="editLmLealGoals-${r.id}" type="number" min="0" value="${r.lealGoals}">
          <span class="dash">–</span>
          <input id="editLmOpponentGoals-${r.id}" type="number" min="0" value="${r.opponentGoals}">
        </div>
        <label>Goleadores de Leal</label>
        <div id="editLmScorers-${r.id}">${scorerRows}</div>
        <button type="button" class="scorer-add-btn" onclick="addScorerRow('editLmScorers-${r.id}')">+ Agregar goleador</button>
        <label style="margin-top:14px;">Fecha (opcional)</label>
        <input id="editLmPlayedOn-${r.id}" type="text" value="${(r.playedOn || '').replace(/"/g, '&quot;')}" maxlength="40">
        <div class="row2" style="margin-top:12px;">
          <button class="primary-btn" onclick="saveLealMatchPlayedEdit('${r.id}')">Guardar cambios</button>
          <button class="reopen-btn" onclick="cancelEditLealMatchPlayed()">Cancelar</button>
        </div>
      </div>`;
    }
    const isOpen = expandedLealMatches.has(r.id);
    return `<div class="history-match all-matches-row">
      <div class="history-match-score" onclick="toggleLealMatchDetail('${r.id}')" style="cursor:pointer;">
        <span class="history-team-left">${crestHtml(label)}<span class="history-team-title" style="text-transform:none;">${label}</span></span>
        <span class="player-props-toggle">${icon('chevron', 13)}</span>
      </div>
      <div class="history-match-score">
        <span class="match-id">${r.playedOn || ''}</span>
        <span>Leal FC <b>${r.lealGoals} – ${r.opponentGoals}</b> ${label}</span>
      </div>
      <div class="history-match-scorers">${icon('goal', 13)}${r.scorers || 'Sin goleadores cargados'}</div>
      ${isOpen ? buildLineupSectionHtml(r) : ''}
      ${isAdmin ? `<div class="row2" style="margin-top:8px;">
        <button class="reopen-btn" onclick="startEditLealMatchPlayed('${r.id}')">${icon('undo', 13)}Editar</button>
        <button class="reopen-btn" onclick="deleteLealMatchPlayed('${r.id}')">${icon('undo', 13)}Borrar</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function renderLealHistory() {
  const container = document.getElementById('lealHistoryList');
  if (!container) return;
  populateLealHistoryTeamSuggestions();
  renderStatsView();
  renderLealOverallRecord();

  // solo puede cargar un resultado (o una formación) quien el admin haya
  // habilitado puntualmente (users.can_log_leal_history); todos pueden ver el
  // historial igual. Si no tiene permiso, directamente no ve ni el formulario
  // ni ningún aviso: solo la lista, como cualquier otro usuario de lectura.
  const formEl = document.getElementById('lealHistoryAddForm');
  const canLog = currentUserCanLogHistory();
  if (formEl) formEl.style.display = canLog ? 'block' : 'none';
  // arranca con una fila vacía lista para escribir; si ya tiene filas (el usuario
  // las está completando) no se tocan en renders sucesivos.
  const scorersRowsEl = document.getElementById('lhScorersRows');
  if (scorersRowsEl && canLog && scorersRowsEl.children.length === 0) addScorerRow('lhScorersRows');

  const results = STATE.lealResults || [];
  if (results.length === 0) {
    container.innerHTML = `<div class="empty">${icon('trophy', 26)}Todavía no cargaron ningún partido. ¡Agregá el primero!</div>`;
    return;
  }
  // los resultados ya llegan ordenados del más nuevo al más viejo; se agrupan por
  // rival sin importar mayúsculas (para que "Canilla Libre" y "canilla libre" no
  // queden como dos grupos separados), usando el casing oficial del equipo
  // cuando existe (resolveOpponentLabel).
  const byOpponent = {};
  for (const r of results) {
    const key = r.opponent.trim().toLowerCase();
    if (!byOpponent[key]) byOpponent[key] = { label: resolveOpponentLabel(r.opponent), entries: [] };
    byOpponent[key].entries.push(r);
  }
  const groups = Object.keys(byOpponent).sort((a, b) => byOpponent[a].label.localeCompare(byOpponent[b].label));
  let html = '';
  for (const key of groups) {
    const { label, entries } = byOpponent[key];
    const { w, d, l } = lealHistoryRecordFor(entries);
    const isOpen = expandedHistoryTeams.has(key);
    const safeKey = key.replace(/'/g, "\\'");
    html += `<div class="history-team">
      <div class="history-team-name${isOpen ? ' open' : ''}" onclick="toggleHistoryTeam('${safeKey}')">
        <span class="history-team-left">${crestHtml(label)}<span class="history-team-title">${label}</span></span>
        <span class="history-team-record">${w}V ${d}E ${l}D</span>
        <span class="player-props-toggle">${icon('chevron', 13)}</span>
      </div>`;
    if (isOpen) {
      html += `<div class="history-matches">`;
      for (const r of entries) {
        if (isAdmin && editingLealResultId === r.id) {
          const scorerRows = (r.scorersDetail || []).map((s) => scorerRowHtml(s.name, s.goals)).join('') || scorerRowHtml('', 1);
          html += `<div class="history-match history-match-editing">
            <label>Rival</label>
            <input id="editLhOpponent-${r.id}" type="text" value="${r.opponent.replace(/"/g, '&quot;')}" maxlength="60">
            <label>Marcador (Leal FC primero)</label>
            <div class="result-inline">
              <input id="editLhLealGoals-${r.id}" type="number" min="0" value="${r.lealGoals}">
              <span class="dash">–</span>
              <input id="editLhOpponentGoals-${r.id}" type="number" min="0" value="${r.opponentGoals}">
            </div>
            <label>Goleadores de Leal</label>
            <div id="editLhScorers-${r.id}">${scorerRows}</div>
            <button type="button" class="scorer-add-btn" onclick="addScorerRow('editLhScorers-${r.id}')">+ Agregar goleador</button>
            <label style="margin-top:14px;">Fecha (opcional)</label>
            <input id="editLhPlayedOn-${r.id}" type="text" value="${(r.playedOn || '').replace(/"/g, '&quot;')}" maxlength="40">
            <div class="row2" style="margin-top:12px;">
              <button class="primary-btn" onclick="saveLealResultEdit('${r.id}')">Guardar cambios</button>
              <button class="reopen-btn" onclick="cancelEditLealResult()">Cancelar</button>
            </div>
          </div>`;
        } else {
          html += `<div class="history-match">
            <div class="history-match-score">
              <span class="match-id">${r.playedOn || ''}</span>
              <span>Leal FC <b>${r.lealGoals} – ${r.opponentGoals}</b> ${label}</span>
            </div>
            <div class="history-match-scorers">${icon('goal', 13)}${r.scorers || 'Sin goleadores cargados'}</div>
            ${isAdmin ? `<div class="row2" style="margin-top:8px;">
              <button class="reopen-btn" onclick="startEditLealResult('${r.id}')">${icon('undo', 13)}Editar</button>
              <button class="reopen-btn" onclick="deleteLealResult('${r.id}')">${icon('undo', 13)}Borrar</button>
            </div>` : ''}
          </div>`;
        }
      }
      html += `</div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = html;
}

let editingMatchId = null;
function startEditMatch(matchId) {
  editingMatchId = matchId;
  renderMatches();
}
function cancelEditMatch() {
  editingMatchId = null;
  renderMatches();
}
async function saveMatchEdit(matchId) {
  const hg = parseInt(document.getElementById(`editScoreHome-${matchId}`).value, 10);
  const ag = parseInt(document.getElementById(`editScoreAway-${matchId}`).value, 10);
  if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) { toast('Cargá el marcador completo'); return; }
  const { playerStats, didNotPlay } = collectStatsFromContainer(`editStatsForm-${matchId}`);
  try {
    await apiFetch(`/admin/matches/${matchId}/result`, { method: 'PUT', admin: true, body: { homeGoals: hg, awayGoals: ag, playerStats, didNotPlay } });
    editingMatchId = null;
    await loadState();
    await loadMyBets();
    renderAll();
    toast('Resultado corregido, fichas y cuotas recalculadas');
  } catch (e) { toast(e.message); }
}

function renderMatches() {
  const list = document.getElementById('matchesList');
  const upcoming = STATE.matches.filter((m) => m.status === 'upcoming').sort((a, b) => b.createdAt - a.createdAt);
  const finished = STATE.matches.filter((m) => m.status === 'finished').sort((a, b) => b.createdAt - a.createdAt);
  const showing = matchesView === 'upcoming' ? upcoming : finished;

  if (showing.length === 0) {
    list.innerHTML = matchesView === 'upcoming'
      ? `<div class="empty">${icon('ball', 30)}Todavía no hay partidos próximos.<br>Andá a la pestaña Equipos para programar uno.</div>`
      : `<div class="empty">${icon('trophy', 28)}Todavía no hay partidos finalizados.</div>`;
    return;
  }

  let html = '';
  if (matchesView === 'upcoming') {
    for (const m of upcoming) {
      const isOpen = expandedMatches.has(m.id);
      html += `<div class="ticket"><div class="ticket-body">
        <div class="ticket-meta">
          <span class="status-pill upcoming"><span class="dot"></span>Próximo</span>
          <span class="match-id">#${m.id.slice(-4)}</span>
        </div>
        <div class="ticket-teams" onclick="toggleMatchExpand('${m.id}')">
          <div class="team-chip">${crestHtml(m.homeName)}<span class="name">${m.homeName}</span></div>
          <span class="vs-badge">VS</span>
          <div class="team-chip">${crestHtml(m.awayName)}<span class="name">${m.awayName}</span></div>
        </div>
        <div class="expand-hint${isOpen ? ' open' : ''}" onclick="toggleMatchExpand('${m.id}')">${isOpen ? 'Ocultar apuestas' : 'Ver apuestas de este partido'}${icon('chevron', 13)}</div>`;

      if (isOpen) {
        html += `
        <div class="market-label">${icon('ball')}Resultado</div>
        <div class="odds-row">
          ${oddsBtn(m.id, 'home', m.homeName, m.odds.home)}
          ${oddsBtn(m.id, 'draw', 'Empate', m.odds.draw)}
          ${oddsBtn(m.id, 'away', m.awayName, m.odds.away)}
        </div>

        <div class="market-label">${icon('shuffle')}Doble oportunidad</div>
        <div class="odds-row">
          ${oddsBtn(m.id, 'dc_1x', m.homeName + ' o X', m.odds.dc.oneX)}
          ${oddsBtn(m.id, 'dc_12', '1 o 2', m.odds.dc.oneTwo)}
          ${oddsBtn(m.id, 'dc_x2', 'X o ' + m.awayName, m.odds.dc.xTwo)}
        </div>

        <div class="market-label">${icon('goal')}Goles (línea ${m.odds.goals.line})</div>
        <div class="odds-row" style="grid-template-columns:1fr 1fr;">
          ${oddsBtn(m.id, 'goals_over', 'Más de ' + m.odds.goals.line, m.odds.goals.over)}
          ${oddsBtn(m.id, 'goals_under', 'Menos de ' + m.odds.goals.line, m.odds.goals.under)}
        </div>

        <div class="market-label">${icon('handshake')}Ambos equipos anotan</div>
        <div class="odds-row" style="grid-template-columns:1fr 1fr;">
          ${oddsBtn(m.id, 'btts_yes', 'Sí', m.odds.btts.yes)}
          ${oddsBtn(m.id, 'btts_no', 'No', m.odds.btts.no)}
        </div>${m.playerProps ? renderPlayerPropsBlock(m) : ''}`;
      }
      html += `</div></div>`;
    }
  } else {
    for (const m of finished) {
      const r = m.result;
      const isEditing = isAdmin && editingMatchId === m.id;
      html += `<div class="ticket finished"><div class="ticket-body">
        <div class="ticket-meta">
          <span class="status-pill finished"><span class="dot"></span>Finalizado</span>
          <span class="match-id">#${m.id.slice(-4)}</span>
        </div>
        <div class="ticket-teams" style="cursor:default;">
          <div class="team-chip">${crestHtml(m.homeName)}<span class="name">${m.homeName}</span></div>
          <span class="vs-badge">VS</span>
          <div class="team-chip">${crestHtml(m.awayName)}<span class="name">${m.awayName}</span></div>
        </div>`;

      if (isEditing) {
        html += `
        <div class="result-inline" style="justify-content:center;margin:12px 0;">
          <input id="editScoreHome-${m.id}" type="number" min="0" value="${r.homeGoals}">
          <span class="dash">–</span>
          <input id="editScoreAway-${m.id}" type="number" min="0" value="${r.awayGoals}">
        </div>
        <div id="editStatsForm-${m.id}">${buildStatsFormHtml(m, r.playerStats)}</div>
        <div class="row2" style="margin-top:12px;">
          <button class="primary-btn" onclick="saveMatchEdit('${m.id}')">Guardar cambios</button>
          <button class="reopen-btn" onclick="cancelEditMatch()">Cancelar</button>
        </div>`;
      } else {
        html += `
        <div class="ticket-result-wrap"><div class="ticket-result">${r.homeGoals} – ${r.awayGoals}</div></div>
        <div class="ticket-status"><b>1x2</b> ${m.odds.home} / ${m.odds.draw} / ${m.odds.away} &nbsp;·&nbsp; <b>Goles ${m.odds.goals.line}</b> ${m.odds.goals.over} / ${m.odds.goals.under} &nbsp;·&nbsp; <b>Ambos anotan</b> ${m.odds.btts.yes} / ${m.odds.btts.no}</div>
        ${renderFinishedPlayerStats(m)}
        ${isAdmin ? `<div class="row2" style="margin-top:12px;">
          <button class="reopen-btn" onclick="startEditMatch('${m.id}')">${icon('undo', 13)}Editar resultado</button>
          <button class="reopen-btn" onclick="reopenMatch('${m.id}')">${icon('undo', 13)}Reabrir partido</button>
        </div>` : ''}`;
      }
      html += `</div></div>`;
    }
  }
  list.innerHTML = html;
}

let myBetsView = 'pending';
function setMyBetsView(view) {
  myBetsView = view;
  document.querySelectorAll('#myBetsSubtabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  renderMyBets();
}

let matchesView = 'upcoming';
function setMatchesView(view) {
  matchesView = view;
  document.querySelectorAll('#matchesSubtabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  renderMatches();
}

function setHistorialView(view) {
  document.querySelectorAll('#historialSubtabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.historial-view').forEach((el) => el.classList.toggle('active', el.id === 'historial-' + view));
  if (view === 'scorers') renderStatsView();
  if (view === 'matches') renderAllMatchesList();
}

function renderMyBets() {
  const list = document.getElementById('myBetsList');
  if (!ME) { list.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para ver tus apuestas.</div>`; return; }
  const isPendingView = myBetsView === 'pending';
  const mine = MY_BETS.filter((b) => {
    const isPending = !b.settled && !b.cancelled;
    return isPendingView ? isPending : !isPending;
  }).sort((a, b) => b.placedAt - a.placedAt);

  if (mine.length === 0) {
    list.innerHTML = isPendingView
      ? `<div class="empty">${icon('ticket', 28)}Todavía no tenés apuestas pendientes.</div>`
      : `<div class="empty">${icon('trophy', 28)}Todavía no tenés apuestas resueltas.</div>`;
    return;
  }

  let summaryHtml = '';
  if (!isPendingView) {
    let wins = 0, losses = 0, net = 0;
    for (const b of mine) {
      if (b.cancelled || b.voided) continue;
      const payoutOdds = b.effectiveOdds || b.combinedOdds;
      if (b.won) { wins++; net += Math.round(b.stake * payoutOdds) - b.stake; }
      else { losses++; net -= b.stake; }
    }
    summaryHtml = `<div class="bets-summary">
      <div class="bets-summary-item win"><span>${wins}</span>ganadas</div>
      <div class="bets-summary-item lose"><span>${losses}</span>perdidas</div>
      <div class="bets-summary-item ${net >= 0 ? 'win' : 'lose'}"><span>${net >= 0 ? '+' : ''}${net}</span>neto</div>
    </div>`;
  }

  list.innerHTML = summaryHtml + mine.map((b) => {
    const legsDesc = b.legs.map((l) => {
      const m = STATE.matches.find((mm) => mm.id === l.matchId);
      const label = m ? `${pickLabel(l.pick, m)} (${m.homeName} vs ${m.awayName})` : pickLabel(l.pick, { homeName: '?', awayName: '?', odds: { goals: { line: 2.5 } } });
      return l.result === 'void' ? `${label} — anulada` : label;
    }).join(' + ');
    const payoutOdds = b.effectiveOdds || b.combinedOdds;
    let statusClass = 'st-pending';
    let tag = `<span class="bet-tag pending">Pendiente</span>`;
    if (b.cancelled) { statusClass = 'st-void'; tag = `<span class="bet-tag pending">Cancelada</span>`; }
    else if (b.voided) { statusClass = 'st-void'; tag = `<span class="bet-tag pending">Anulada (devuelto)</span>`; }
    else if (!b.settled) { statusClass = 'st-pending'; tag = `<span class="bet-tag pending">Pendiente</span>`; }
    else if (b.won) { statusClass = 'st-win'; tag = `<span class="bet-tag win">+${Math.round(b.stake * payoutOdds)}</span>`; }
    else { statusClass = 'st-lose'; tag = `<span class="bet-tag lose">-${b.stake}</span>`; }
    const comboTag = b.legs.length > 1 ? 'Combinada · ' : '';
    const activeLegsPreview = b.legs.filter((l) => l.result !== 'void');
    // un superaumento paga a su cuota fija mientras ninguna pata se haya anulado
    // (sus patas son siempre del mismo partido, así que se resuelven todas juntas).
    const potentialOdds = (b.superBoostId && activeLegsPreview.length === b.legs.length)
      ? b.combinedOdds
      : Math.round(activeLegsPreview.reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;
    const potentialText = (!b.settled && !b.cancelled) ? ` · si ganás, cobrás ${Math.round(b.stake * potentialOdds)} fichas` : '';
    const cashOutBtn = (!b.settled && !b.cancelled)
      ? (STATE.marketClosed
        ? `<div class="bet-cashout-locked">${icon('lock', 11)}Cerrado hasta que se carguen los resultados</div>`
        : `<button class="bet-cashout" onclick="cashOutBet('${b.id}')">${icon('close', 11)}Cerrar apuesta (devolver ${b.stake} fichas)</button>`)
      : '';
    return `<div class="bet-row ${statusClass}">
      <div class="bet-row-top">
        <div class="desc">${legsDesc}<small>${comboTag}${b.stake} fichas a cuota ${b.combinedOdds}${potentialText}</small></div>
        ${tag}
      </div>
      ${cashOutBtn}
    </div>`;
  }).join('');
}

function renderRanking() {
  const body = document.getElementById('rankingBody');
  const rows = STATE.ranking;
  if (rows.length === 0) { body.innerHTML = `<div class="empty">${icon('trophy', 28)}Todavía no hay jugadores.</div>`; return; }
  body.innerHTML = rows.map((r, i) => `<div class="rank-row${r.name === ME ? ' me' : ''}">
    <div class="rank-pos">${i + 1}</div>
    <div class="rank-name">${r.name}${r.name === ME ? '<span class="you-tag">VOS</span>' : ''}</div>
    <div class="rank-bal">${icon('wallet', 14)}${Math.round(r.balance)}</div>
  </div>`).join('');
}

function renderPlayerStatsForm() {
  const container = document.getElementById('playerStatsForm');
  const matchId = document.getElementById('pendingMatchSelect').value;
  const match = STATE.matches.find((m) => m.id === matchId);
  if (!match || !match.playerProps) { container.innerHTML = ''; return; }
  container.innerHTML = buildStatsFormHtml(match, null);
}

function renderAdmin() {
  const chipsSel = document.getElementById('chipsUserSelect');
  const previousChipsSelection = chipsSel.value;
  const users = STATE.ranking.slice().sort((a, b) => a.name.localeCompare(b.name));
  chipsSel.innerHTML = users.length
    ? users.map((u) => `<option value="${u.name}">${u.name}</option>`).join('')
    : '<option value="">Todavía no hay jugadores</option>';
  if (users.some((u) => u.name === previousChipsSelection)) chipsSel.value = previousChipsSelection;
  onChipsUserChange();
  renderLealHistoryAccessList();

  const teamsList = document.getElementById('teamsList');
  teamsList.innerHTML = STATE.teams.length
    ? STATE.teams.slice().sort((a, b) => b.rating - a.rating).map((t) =>
        `<div class="team-line">${crestHtml(t.name)}<span class="name">${t.name}</span><span class="rating">${t.rating}</span></div>`
      ).join('')
    : `<div class="empty" style="padding:20px;">Agregá al menos dos equipos.</div>`;

  const homeSel = document.getElementById('matchHome');
  const awaySel = document.getElementById('matchAway');
  const opts = STATE.teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  homeSel.innerHTML = opts;
  awaySel.innerHTML = opts;

  const pendingSel = document.getElementById('pendingMatchSelect');
  const previousSelection = pendingSel.value;
  const pending = STATE.matches.filter((m) => m.status === 'upcoming');
  pendingSel.innerHTML = pending.length
    ? pending.map((m) => `<option value="${m.id}">${m.homeName} vs ${m.awayName}</option>`).join('')
    : '<option value="">No hay partidos pendientes</option>';
  if (pending.some((m) => m.id === previousSelection)) pendingSel.value = previousSelection;
  renderPlayerStatsForm();

  document.getElementById('boostMaxHint').textContent =
    `Máximo ${STATE.maxSuperBoostStake || 10000} fichas por apuesta con esta cuota especial.`;
  const boostSel = document.getElementById('boostMatchSelect');
  const previousBoostSelection = boostSel.value || boostDraftMatchId;
  boostSel.innerHTML = pending.length
    ? pending.map((m) => `<option value="${m.id}">${m.homeName} vs ${m.awayName}</option>`).join('')
    : '<option value="">No hay partidos pendientes</option>';
  if (pending.some((m) => m.id === previousBoostSelection)) boostSel.value = previousBoostSelection;
  boostDraftMatchId = boostSel.value || null;
  renderBoostMarkets();
  updateBoostNaturalPreview();
  renderActiveBoostsList();
}

// ---------- admin: superaumento ----------
function isBoostSelected(pick) {
  return boostDraftLegs.includes(pick);
}
function boostOddsBtn(pick, label, value) {
  const selected = isBoostSelected(pick);
  return `<div class="odds-btn${selected ? ' selected' : ''}" onclick="toggleBoostLeg('${pick}')">
    <span class="lbl">${label}</span><span class="val">${value}</span>
    ${selected ? `<span class="check">${icon('check', 9)}</span>` : ''}
  </div>`;
}
function toggleBoostLeg(pick) {
  const idx = boostDraftLegs.indexOf(pick);
  if (idx > -1) boostDraftLegs.splice(idx, 1);
  else boostDraftLegs.push(pick);
  renderBoostMarkets();
  updateBoostNaturalPreview();
}
function onBoostMatchChange() {
  boostDraftMatchId = document.getElementById('boostMatchSelect').value || null;
  boostDraftLegs = [];
  renderBoostMarkets();
  updateBoostNaturalPreview();
}
function renderBoostMarkets() {
  const container = document.getElementById('boostMarketsContainer');
  const m = STATE.matches.find((mm) => mm.id === boostDraftMatchId);
  if (!m) { container.innerHTML = ''; return; }
  let html = `
    <div class="market-label">${icon('ball')}Resultado</div>
    <div class="odds-row">
      ${boostOddsBtn('home', m.homeName, m.odds.home)}
      ${boostOddsBtn('draw', 'Empate', m.odds.draw)}
      ${boostOddsBtn('away', m.awayName, m.odds.away)}
    </div>
    <div class="market-label">${icon('shuffle')}Doble oportunidad</div>
    <div class="odds-row">
      ${boostOddsBtn('dc_1x', m.homeName + ' o X', m.odds.dc.oneX)}
      ${boostOddsBtn('dc_12', '1 o 2', m.odds.dc.oneTwo)}
      ${boostOddsBtn('dc_x2', 'X o ' + m.awayName, m.odds.dc.xTwo)}
    </div>
    <div class="market-label">${icon('goal')}Goles (línea ${m.odds.goals.line})</div>
    <div class="odds-row" style="grid-template-columns:1fr 1fr;">
      ${boostOddsBtn('goals_over', 'Más de ' + m.odds.goals.line, m.odds.goals.over)}
      ${boostOddsBtn('goals_under', 'Menos de ' + m.odds.goals.line, m.odds.goals.under)}
    </div>
    <div class="market-label">${icon('handshake')}Ambos equipos anotan</div>
    <div class="odds-row" style="grid-template-columns:1fr 1fr;">
      ${boostOddsBtn('btts_yes', 'Sí', m.odds.btts.yes)}
      ${boostOddsBtn('btts_no', 'No', m.odds.btts.no)}
    </div>`;
  if (m.playerProps) {
    const THRESHOLD_MARKETS = [['atajadas', 'Atajadas'], ['faltas', 'Faltas cometidas'], ['remates', 'Remates'], ['remates_arco', 'Remates al arco']];
    const BINARY_MARKETS = [['gol', 'Gol'], ['asistencia', 'Asistencia'], ['amarilla', 'Amarilla'], ['roja', 'Roja']];
    html += `<div class="market-label">${icon('users')}Jugadores de LEAL</div>`;
    for (const playerName of orderedPlayerNames(m.playerProps)) {
      const props = m.playerProps[playerName];
      html += `<div class="player-props-name" style="cursor:default;"><span class="player-props-left"><span class="player-avatar">${initials(playerName)}</span>${playerName}</span></div>`;
      for (const [market, label] of THRESHOLD_MARKETS) {
        if (!props[market]) continue;
        const thresholds = Object.keys(props[market]);
        html += `<div class="prop-sublabel">${label}</div><div class="odds-row" style="grid-template-columns:repeat(${thresholds.length},1fr);">`;
        for (const t of thresholds) html += boostOddsBtn(`prop|${playerName}|${market}|${t}`, `${t}+`, props[market][t]);
        html += `</div>`;
      }
      const activeBinary = BINARY_MARKETS.filter(([market]) => props[market] !== undefined);
      if (activeBinary.length) {
        html += `<div class="odds-row" style="grid-template-columns:repeat(${activeBinary.length},1fr);margin-top:6px;">`;
        for (const [market, label] of activeBinary) html += boostOddsBtn(`prop|${playerName}|${market}`, label, props[market]);
        html += `</div>`;
      }
    }
  }
  container.innerHTML = html;
}
function updateBoostNaturalPreview() {
  const preview = document.getElementById('boostNaturalPreview');
  const oddsEl = document.getElementById('boostNaturalOdds');
  const m = STATE.matches.find((mm) => mm.id === boostDraftMatchId);
  if (!m || boostDraftLegs.length === 0) { preview.style.display = 'none'; return; }
  const natural = Math.round(boostDraftLegs.reduce((p, pick) => p * oddsFor(m, pick), 1) * 100) / 100;
  oddsEl.textContent = natural;
  preview.style.display = 'flex';
}
async function createSuperBoost() {
  if (!boostDraftMatchId) { toast('Elegí un partido'); return; }
  if (boostDraftLegs.length === 0) { toast('Elegí al menos una selección'); return; }
  const boostedOdds = parseFloat(document.getElementById('boostNewOdds').value);
  if (!boostedOdds || boostedOdds <= 1) { toast('Poné una cuota nueva válida'); return; }
  try {
    await apiFetch('/admin/superboost', { method: 'POST', admin: true, body: { matchId: boostDraftMatchId, legs: boostDraftLegs, boostedOdds } });
    boostDraftLegs = [];
    document.getElementById('boostNewOdds').value = '';
    await loadState();
    renderAll();
    toast('Superaumento creado');
  } catch (e) { toast(e.message); }
}
async function deactivateSuperBoost(id) {
  try {
    await apiFetch(`/admin/superboost/${id}/deactivate`, { method: 'POST', admin: true });
    await loadState();
    renderAll();
    toast('Superaumento desactivado');
  } catch (e) { toast(e.message); }
}
function renderActiveBoostsList() {
  const container = document.getElementById('activeBoostsList');
  if (!container) return;
  const boosts = STATE.superBoosts || [];
  if (boosts.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = `<div class="section-title" style="margin-top:18px;">${icon('fire', 13)}Superaumentos activos</div>` + boosts.map((b) => `
    <div class="active-boost-row">
      <span>${b.homeName} vs ${b.awayName}<br><small style="color:var(--chalk-faint);">${b.legs.map((l) => l.label).join(' + ')} · ${b.naturalOdds} → ${b.boostedOdds}</small></span>
      <button class="deactivate-btn" onclick="deactivateSuperBoost('${b.id}')">Desactivar</button>
    </div>
  `).join('');
}

function renderAll(skipAdmin) {
  try {
    document.getElementById('playerNameLbl').textContent = ME || '—';
    document.getElementById('chipCount').textContent = ME ? Math.round(myBalance()) : 0;
    renderMarketClosedBanner();
    renderSuperBoosts();
    // durante un refresco de fondo (otro usuario hizo algo en otro lado), no
    // se toca la lista de partidos si hay una edición de resultado en curso:
    // si no, el formulario se reconstruye solo y se pierde lo que se venía tipeando.
    if (!(skipAdmin && editingMatchId)) renderMatches();
    renderMyBets();
    renderRanking();
    // mismo cuidado que con editingMatchId: si hay una edición en curso, un
    // refresco de fondo no debe reconstruir el formulario y perder lo que se
    // venía tipeando. "Por rival" y "Partidos jugados" son listas aparte, cada
    // una con su propio guard.
    if (!(skipAdmin && editingLealResultId)) renderLealHistory();
    if (!(skipAdmin && (editingLealMatchId || editingLineupId))) renderAllMatchesList();
    if (!skipAdmin && isAdmin) renderAdmin();
    renderCartBar();
  } catch (e) {
    console.error(e);
    toast('Hubo un error al mostrar los datos');
  }
}

// ---------- tiempo real ----------
async function refreshFromServer(skipAdmin) {
  try {
    await loadState();
    if (ME) await loadMyBets();
    renderAll(skipAdmin);
  } catch (e) {
    console.error('No se pudo refrescar el estado', e);
  }
}

function connectSocket() {
  const socket = io();
  socket.on('state:update', () => refreshFromServer(true));
  // la mesa en vivo manda su estado directo por socket (sin este ida y
  // vuelta a /api/state): así todos los sentados ven la jugada del otro en
  // el momento, no recién en el próximo refresco general.
  socket.on('table:update', (table) => { LB.table = table; renderLiveTable(); });
  // red de contención por si el socket se corta: refresco periódico igual.
  setInterval(() => refreshFromServer(true), 20000);
}

// ---------- blackjack ----------
// Juego individual: el servidor decide siempre el mazo, el reparto y el
// resultado (nunca el cliente) — acá solo se piden acciones y se anima lo
// que el servidor ya resolvió.
let BJ = { phase: 'none', hands: [], currentHandIndex: 0, dealerHand: [], dealerHidden: true, sideResultText: '', resultText: '' };
let casinoView = 'blackjack';
let bjDealingAnim = false;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function bjCardValue(card) {
  if (card.r === 'A') return 11;
  if (card.r === 'J' || card.r === 'Q' || card.r === 'K') return 10;
  return parseInt(card.r, 10);
}
function bjHandTotal(cards) {
  const real = cards.filter(Boolean);
  let total = real.reduce((s, c) => s + bjCardValue(c), 0);
  let aces = real.filter((c) => c.r === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function bjCardHtml(card) {
  if (!card) return `<div class="playing-card hidden"></div>`;
  const red = card.s === '♥' || card.s === '♦';
  return `<div class="playing-card${red ? ' red' : ''}">${card.r}${card.s}</div>`;
}
function applyBalanceUpdate(newBalance) {
  const row = STATE.ranking.find((r) => r.name === ME);
  if (row) row.balance = newBalance;
  const el = document.getElementById('chipCount');
  if (el) el.textContent = Math.round(newBalance);
}

async function bjLoadState() {
  if (!ME) { renderBlackjack(); return; }
  try {
    BJ = await apiFetch('/blackjack/state');
  } catch (e) { /* ignorar, se reintenta solo */ }
  renderBlackjack();
}

async function bjDeal() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  const stake = parseInt(document.getElementById('bjStakeInput').value, 10);
  const pairsStake = parseInt(document.getElementById('bjPairsStakeInput').value, 10) || 0;
  const trioStake = parseInt(document.getElementById('bj21plus3StakeInput').value, 10) || 0;
  if (!stake || stake <= 0) { toast('Poné un monto válido para la mano principal'); return; }
  try {
    const result = await apiFetch('/blackjack/deal', { method: 'POST', body: { stake, pairsStake, trioStake } });
    applyBalanceUpdate(result.balance);
    const finalPlayerCards = result.hands[0].cards.slice();
    const finalDealerCards = result.dealerHand.slice();
    BJ = {
      phase: 'playing',
      hands: [{ cards: [], bet: result.hands[0].bet, status: 'playing', isSplitResult: false, resultMsg: null }],
      currentHandIndex: 0, dealerHand: [], dealerHidden: true, sideResultText: '', resultText: '',
    };
    bjDealingAnim = true;
    renderBlackjack();
    // reparto de a una carta, alternando jugador y dealer, como en una mesa real
    const steps = [
      () => BJ.hands[0].cards.push(finalPlayerCards[0]),
      () => BJ.dealerHand.push(finalDealerCards[0]),
      () => BJ.hands[0].cards.push(finalPlayerCards[1]),
      () => BJ.dealerHand.push(result.dealerHidden ? null : finalDealerCards[1]),
    ];
    for (const step of steps) {
      await sleep(450);
      step();
      renderBlackjack();
    }
    bjDealingAnim = false;
    BJ = result; // estado real y completo (puede venir ya 'done' si hubo blackjack natural)
    renderBlackjack();
  } catch (e) { toast(e.message); }
}

async function bjApplyActionResult(result) {
  applyBalanceUpdate(result.balance);
  const wasHidden = BJ.dealerHidden;
  if (result.phase === 'done' && wasHidden) {
    // había una carta tapada del dealer: se revela y, si pide más, se anima de a una
    const priorLen = BJ.dealerHand.length;
    const fullDealer = result.dealerHand.slice();
    BJ = { ...BJ, dealerHand: fullDealer.slice(0, priorLen), dealerHidden: false };
    renderBlackjack();
    for (let i = priorLen; i < fullDealer.length; i++) {
      await sleep(600);
      BJ.dealerHand.push(fullDealer[i]);
      renderBlackjack();
    }
    await sleep(300);
  }
  BJ = result;
  renderBlackjack();
}
async function bjHit() {
  try { await bjApplyActionResult(await apiFetch('/blackjack/hit', { method: 'POST' })); }
  catch (e) { toast(e.message); }
}
async function bjStand() {
  try { await bjApplyActionResult(await apiFetch('/blackjack/stand', { method: 'POST' })); }
  catch (e) { toast(e.message); }
}
async function bjDouble() {
  try { await bjApplyActionResult(await apiFetch('/blackjack/double', { method: 'POST' })); }
  catch (e) { toast(e.message); }
}
async function bjSplit() {
  try { await bjApplyActionResult(await apiFetch('/blackjack/split', { method: 'POST' })); }
  catch (e) { toast(e.message); }
}

function renderBlackjack() {
  const container = document.getElementById('blackjackTable');
  const actionsBox = document.getElementById('bjActions');
  const dealBtn = document.getElementById('bjDealBtn');
  if (!container || !actionsBox || !dealBtn) return;

  const stakeInput = document.getElementById('bjStakeInput');
  const pairsInput = document.getElementById('bjPairsStakeInput');
  const trioInput = document.getElementById('bj21plus3StakeInput');

  if (!ME) {
    container.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para jugar.</div>`;
    actionsBox.style.display = 'none';
    dealBtn.style.display = 'none';
    stakeInput.disabled = pairsInput.disabled = trioInput.disabled = true;
    return;
  }

  let html = '';
  if (BJ.phase === 'none') {
    html = `<div class="empty">${icon('ball', 26)}Elegí cuánto apostar y tocá "Repartir".</div>`;
  } else {
    const dealerTotalDisplay = BJ.dealerHidden ? '?' : bjHandTotal(BJ.dealerHand);
    html += `<div class="bj-total">Dealer (${dealerTotalDisplay})</div><div class="card-hand">${BJ.dealerHand.map((c) => bjCardHtml(c)).join('')}</div>`;

    BJ.hands.forEach((hand, i) => {
      const isActive = BJ.phase === 'playing' && !bjDealingAnim && i === BJ.currentHandIndex;
      const label = BJ.hands.length > 1 ? `Mano ${i + 1} (${hand.bet} fichas)` : 'Vos';
      const statusNote = hand.status === 'bust' ? ' — se pasó' : '';
      html += `<div class="bj-total${isActive ? ' active' : ''}">${label} (${bjHandTotal(hand.cards)})${statusNote}</div><div class="card-hand">${hand.cards.map((c) => bjCardHtml(c)).join('')}</div>`;
      if (BJ.phase === 'done' && hand.resultMsg) html += `<div class="bj-total dim">${hand.resultMsg}</div>`;
    });

    if (BJ.sideResultText) html += `<div class="bj-total dim">${BJ.sideResultText}</div>`;
    if (BJ.phase === 'done' && BJ.hands.length > 1 && BJ.resultText) html += `<div class="bj-result">${BJ.resultText}</div>`;
  }
  container.innerHTML = html;

  const inProgress = BJ.phase === 'playing' || bjDealingAnim;
  dealBtn.style.display = inProgress ? 'none' : 'block';
  stakeInput.disabled = pairsInput.disabled = trioInput.disabled = inProgress;

  if (BJ.phase === 'playing' && !bjDealingAnim) {
    actionsBox.style.display = 'flex';
    const hand = BJ.hands[BJ.currentHandIndex];
    const balance = myBalance();
    const canDouble = !!hand && hand.cards.length === 2 && balance >= hand.bet;
    const canSplit = !!hand && hand.cards.length === 2 && hand.cards[0] && hand.cards[1] && hand.cards[0].r === hand.cards[1].r && balance >= hand.bet;
    document.getElementById('bjDoubleBtn').style.display = canDouble ? 'inline-flex' : 'none';
    document.getElementById('bjSplitBtn').style.display = canSplit ? 'inline-flex' : 'none';
  } else {
    actionsBox.style.display = 'none';
  }
}

// ---------- casino: selector de juego ----------
function setCasinoView(view) {
  casinoView = view;
  document.querySelectorAll('#casinoSubtabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.casino-game').forEach((el) => el.classList.toggle('active', el.id === 'casino-' + view));
  if (view === 'blackjack') bjLoadState();
  else if (view === 'penalty') pnLoadState();
  else if (view === 'mines') mnLoadState();
  else if (view === 'slots') slLoadState();
  else if (view === 'roulette') renderRoulette();
  else if (view === 'live-blackjack') lbLoadState();
}

// ---------- penales (tanda de penaltis) ----------
let PN = { phase: 'none', difficulty: 'media', ladder: [], round: 0, multiplier: 1, nextMultiplier: null, lastKickResult: null, resultText: '' };
let pnSelectedDifficulty = 'media';
// estado puramente visual del arco (pelota/arquero); el resultado real ya lo
// decidió el servidor en /penalty/kick, esto solo lo dramatiza en pantalla.
const PN_COLS = ['18%', '50%', '82%'];
const PN_ROW_BALL_BOTTOM = { high: 130, low: 62 }; // a dónde vuela la pelota, según la fila tocada
const PN_ROW_ZONE_BOTTOM = { high: 106, low: 38 }; // dónde se dibuja el círculo tocable
function pnRestingVisual() { return { ballIdx: 1, ballRow: 'low', keeperIdx: 1, kicked: false, scored: null, animating: false }; }
let pnVisual = pnRestingVisual();

// arquero dibujado en SVG (cuerpo humano real, no un rectángulo): la misma silueta
// se usa para las 3 posturas, solo cambia la transformación del grupo del cuerpo
// (parado en guardia, tirado a un palo, o achicándose al medio).
function pnKeeperMarkup(mode) {
  let bodyTransform = '';
  if (mode === 'dive-left') bodyTransform = 'rotate(-78 50 66) translate(-4 10)';
  else if (mode === 'dive-right') bodyTransform = 'rotate(78 50 66) translate(4 10)';
  else if (mode === 'block') bodyTransform = 'translate(0 4) scale(1.04)';
  return `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="97" rx="16" ry="3" fill="rgba(0,0,0,.35)"/>
    <g transform="${bodyTransform}">
      <rect x="38" y="60" width="10" height="28" rx="5" fill="#1c1c1c"/>
      <rect x="52" y="60" width="10" height="28" rx="5" fill="#1c1c1c"/>
      <rect x="35" y="85" width="14" height="7" rx="3" fill="#0c0c0c"/>
      <rect x="51" y="85" width="14" height="7" rx="3" fill="#0c0c0c"/>
      <rect x="32" y="32" width="36" height="32" rx="12" fill="#ff7a3d"/>
      <rect x="32" y="32" width="36" height="9" rx="4" fill="#ffb37a"/>
      <rect x="14" y="12" width="12" height="34" rx="6" fill="#ff7a3d" transform="rotate(-30 20 29)"/>
      <rect x="74" y="12" width="12" height="34" rx="6" fill="#ff7a3d" transform="rotate(30 80 29)"/>
      <circle cx="14" cy="14" r="8" fill="#fff"/>
      <circle cx="86" cy="14" r="8" fill="#fff"/>
      <circle cx="50" cy="19" r="13" fill="#e8a978"/>
      <path d="M37 15a13 13 0 0 1 26 0" fill="#241a12"/>
    </g>
  </svg>`;
}

async function pnLoadState() {
  if (!ME) { renderPenalty(); return; }
  try { PN = await apiFetch('/penalty/state'); } catch (e) { /* ignorar, se reintenta solo */ }
  if (PN.difficulty) pnSelectedDifficulty = PN.difficulty;
  pnVisual = pnRestingVisual();
  renderPenalty();
}

function pnSetDifficulty(d) {
  if (PN.phase === 'active') return;
  pnSelectedDifficulty = d;
  renderPenalty();
}

async function pnStart() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  const stake = parseInt(document.getElementById('pnStakeInput').value, 10);
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }
  try {
    const result = await apiFetch('/penalty/start', { method: 'POST', body: { stake, difficulty: pnSelectedDifficulty } });
    applyBalanceUpdate(result.balance);
    PN = result;
    pnVisual = pnRestingVisual();
    renderPenalty();
  } catch (e) { toast(e.message); }
}
// El jugador toca una de las 6 zonas del arco (3 columnas x alto/bajo) para apuntar
// y patear en un solo gesto. El servidor ya decidió si se ataja o se convierte con
// /penalty/kick (nunca depende de a dónde apuntó el cliente); acá solo se anima:
// la pelota vuela al lugar tocado y, según el resultado, el arquero se tira al
// mismo palo (atajada) o al contrario (gol).
async function pnKick(zoneIdx) {
  if (pnVisual.animating || PN.phase !== 'active') return;
  const col = zoneIdx % 3;
  const row = zoneIdx < 3 ? 'high' : 'low';
  pnVisual = { ballIdx: col, ballRow: row, keeperIdx: 1, kicked: true, scored: null, animating: true };
  renderPenalty(); // la pelota sale volando primero; el arquero todavía no reacciona
  try {
    const [result] = await Promise.all([
      apiFetch('/penalty/kick', { method: 'POST' }),
      sleep(380), // tiempo mínimo de "vuelo" antes de mostrar si atajó o no
    ]);
    applyBalanceUpdate(result.balance);
    const scored = result.lastKickResult === 'scored';
    let keeperIdx;
    if (scored) {
      const options = [0, 1, 2].filter((c) => c !== col);
      keeperIdx = options[Math.floor(Math.random() * options.length)];
    } else {
      keeperIdx = col; // el arquero adivinó el palo y ataja
    }
    PN = result;
    pnVisual = { ballIdx: col, ballRow: row, keeperIdx, kicked: true, scored, animating: true };
    renderPenalty();
    await sleep(1000);
    pnVisual = pnRestingVisual(); // pelota y arquero vuelven al centro, listos para el próximo pateo
    renderPenalty();
  } catch (e) {
    pnVisual = pnRestingVisual();
    renderPenalty();
    toast(e.message);
  }
}
async function pnCashout() {
  try {
    const result = await apiFetch('/penalty/cashout', { method: 'POST' });
    applyBalanceUpdate(result.balance);
    PN = result;
    renderPenalty();
  } catch (e) { toast(e.message); }
}

function renderPenalty() {
  const field = document.getElementById('penaltyField');
  const actionsBox = document.getElementById('pnActions');
  const startBtn = document.getElementById('pnStartBtn');
  const stakeInput = document.getElementById('pnStakeInput');
  if (!field || !actionsBox || !startBtn || !stakeInput) return;

  if (!ME) {
    field.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para jugar.</div>`;
    actionsBox.style.display = 'none';
    startBtn.style.display = 'none';
    stakeInput.disabled = true;
    return;
  }

  const active = PN.phase === 'active';
  document.querySelectorAll('#pnDifficultySubtabs button').forEach((b) => {
    b.disabled = active;
    b.classList.toggle('active', b.dataset.diff === pnSelectedDifficulty);
  });

  const ballLeft = PN_COLS[pnVisual.ballIdx];
  const keeperLeft = PN_COLS[pnVisual.keeperIdx];
  const revealed = pnVisual.kicked && pnVisual.scored !== null;
  const ballFlying = pnVisual.kicked && pnVisual.scored === null; // en el aire, todavía no se sabe el resultado
  const ballBottom = pnVisual.kicked ? PN_ROW_BALL_BOTTOM[pnVisual.ballRow || 'low'] + 'px' : '6px';

  // el arquero: parado en guardia (con un pequeño rebote) mientras espera o
  // mientras la pelota sigue en el aire; recién se tira una vez que se revela
  // el resultado real que ya decidió el servidor.
  let keeperMode = 'idle';
  let keeperWrapperCls = 'pn-keeper';
  if (revealed) {
    if (pnVisual.keeperIdx === 0) keeperMode = 'dive-left';
    else if (pnVisual.keeperIdx === 2) keeperMode = 'dive-right';
    else keeperMode = 'block';
  } else {
    keeperWrapperCls += ' idle';
  }

  let resultBanner = '';
  let rippleHtml = '';
  if (revealed) {
    resultBanner = pnVisual.scored
      ? `<div class="pn-goal-result pn-scored">¡GOL!</div>`
      : `<div class="pn-goal-result pn-missed">¡ATAJADA!</div>`;
    if (pnVisual.scored) rippleHtml = `<div class="pn-net-ripple" style="left:${ballLeft};bottom:${ballBottom};"></div>`;
  }
  // mientras hay una tanda activa y no se está resolviendo un pateo, se pueden tocar
  // las 6 zonas del arco (3 columnas x alto/bajo) para apuntar y patear.
  let zonesHtml = '';
  if (active && !pnVisual.animating) {
    const zones = [];
    ['high', 'low'].forEach((row, rIdx) => {
      PN_COLS.forEach((leftPct, cIdx) => {
        const zoneIdx = rIdx * 3 + cIdx;
        zones.push(`<div class="pn-zone" style="left:${leftPct};bottom:${PN_ROW_ZONE_BOTTOM[row]}px;" onclick="pnKick(${zoneIdx})"><span class="pn-zone-dot"></span></div>`);
      });
    });
    zonesHtml = zones.join('');
  }
  const keeperHtml = `<div class="${keeperWrapperCls}" style="left:${keeperLeft};">${pnKeeperMarkup(keeperMode)}</div>`;
  const ballHtml = `<div class="pn-ball${ballFlying ? ' flying' : ''}" style="left:${ballLeft};bottom:${ballBottom};"></div>`;
  let html = `<div class="pn-goal">${resultBanner}${keeperHtml}${ballHtml}${rippleHtml}${zonesHtml}</div>`;
  if (active && !pnVisual.animating) html += `<div class="pn-hint">Tocá una zona del arco para patear</div>`;

  if (!PN.ladder || PN.ladder.length === 0) {
    html += `<div class="empty">${icon('ball', 26)}Elegí la dificultad y cuánto apostar, y tocá "Empezar".</div>`;
  } else {
    const rows = PN.ladder.map((mult, i) => {
      const round = i + 1;
      let cls = '';
      if (round <= PN.round) cls = 'cleared';
      else if (active && round === PN.round + 1) cls = 'current';
      return `<div class="pn-step ${cls}"><span class="pn-round">Penal ${round}</span><span class="pn-mult">x${mult.toFixed(2)}</span></div>`;
    });
    html += `<div class="pn-ladder">${rows.join('')}</div>`;
    if (PN.phase === 'done' && PN.resultText) html += `<div class="pn-result">${PN.resultText}</div>`;
  }
  field.innerHTML = html;

  startBtn.style.display = active ? 'none' : 'block';
  stakeInput.disabled = active;
  actionsBox.style.display = active ? 'flex' : 'none';
  if (active) {
    const cashoutBtn = actionsBox.querySelector('.bj-secondary');
    if (cashoutBtn) cashoutBtn.disabled = PN.round === 0 || pnVisual.animating;
  }
}

// ---------- minas ----------
let MN = { phase: 'none', minesCount: 5, stake: 0, revealed: [], grid: null, revealedCount: 0, multiplier: 1, nextMultiplier: null, resultText: '' };
let mnSelectedMines = 5;

function mnPopulateMinesSelect() {
  const sel = document.getElementById('mnMinesSelect');
  if (!sel || sel.options.length) return;
  for (let i = 1; i <= 24; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i} mina${i > 1 ? 's' : ''}`;
    sel.appendChild(opt);
  }
  sel.value = mnSelectedMines;
  sel.addEventListener('change', () => { mnSelectedMines = parseInt(sel.value, 10); });
}

async function mnLoadState() {
  if (!ME) { renderMines(); return; }
  try { MN = await apiFetch('/mines/state'); } catch (e) { /* ignorar, se reintenta solo */ }
  if (MN.minesCount) mnSelectedMines = MN.minesCount;
  renderMines();
}

async function mnStart() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  const stake = parseInt(document.getElementById('mnStakeInput').value, 10);
  const mines = parseInt(document.getElementById('mnMinesSelect').value, 10) || mnSelectedMines;
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }
  try {
    const result = await apiFetch('/mines/start', { method: 'POST', body: { stake, mines } });
    applyBalanceUpdate(result.balance);
    MN = result;
    renderMines();
  } catch (e) { toast(e.message); }
}
async function mnReveal(index) {
  if (MN.phase !== 'active' || MN.revealed[index]) return;
  try {
    const result = await apiFetch('/mines/reveal', { method: 'POST', body: { index } });
    applyBalanceUpdate(result.balance);
    MN = result;
    renderMines();
  } catch (e) { toast(e.message); }
}
async function mnCashout() {
  try {
    const result = await apiFetch('/mines/cashout', { method: 'POST' });
    applyBalanceUpdate(result.balance);
    MN = result;
    renderMines();
  } catch (e) { toast(e.message); }
}

function renderMines() {
  const field = document.getElementById('minesField');
  const actionsBox = document.getElementById('mnActions');
  const startBtn = document.getElementById('mnStartBtn');
  const stakeInput = document.getElementById('mnStakeInput');
  const minesSelect = document.getElementById('mnMinesSelect');
  if (!field || !actionsBox || !startBtn || !stakeInput || !minesSelect) return;

  mnPopulateMinesSelect();

  if (!ME) {
    field.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para jugar.</div>`;
    actionsBox.style.display = 'none';
    startBtn.style.display = 'none';
    stakeInput.disabled = minesSelect.disabled = true;
    return;
  }

  const active = MN.phase === 'active';
  stakeInput.disabled = minesSelect.disabled = active;
  startBtn.style.display = active ? 'none' : 'block';
  if (!active) minesSelect.value = mnSelectedMines;

  if (MN.phase === 'none') {
    field.innerHTML = `<div class="empty">${icon('ball', 26)}Elegí cuántas minas y cuánto apostar, y tocá "Empezar".</div>`;
    actionsBox.style.display = 'none';
    return;
  }

  const revealed = MN.revealed || [];
  const grid = MN.grid; // solo viene del servidor cuando la partida terminó
  let tilesHtml = '';
  for (let i = 0; i < 25; i++) {
    const isRevealed = revealed[i];
    const isMineHere = MN.phase === 'done' && grid && grid[i];
    const clickable = MN.phase === 'active' && !isRevealed;
    let cls = 'mn-tile';
    let content = '';
    // el casillero que pisó la mina también queda "revelado" del lado del servidor,
    // así que hay que mostrarlo como mina (no como diamante) aunque revealed[i] sea true.
    if (isMineHere) {
      cls += ' mine';
      content = '💣';
    } else if (isRevealed) {
      cls += ' safe';
      content = '💎';
    } else if (!clickable) {
      cls += ' disabled';
    }
    tilesHtml += `<div class="${cls}"${clickable ? ` onclick="mnReveal(${i})"` : ''}>${content}</div>`;
  }

  const nextMultTxt = MN.nextMultiplier != null ? `x${MN.nextMultiplier.toFixed(2)}` : '—';
  const statusHtml = `<div class="mn-status"><span>Cuota actual: <b>x${MN.multiplier.toFixed(2)}</b></span><span>Próxima: ${nextMultTxt}</span></div>`;
  field.innerHTML = statusHtml + `<div class="mn-grid">${tilesHtml}</div>` + (MN.phase === 'done' && MN.resultText ? `<div class="pn-result">${MN.resultText}</div>` : '');

  actionsBox.style.display = active ? 'flex' : 'none';
  if (active) {
    const cashoutBtn = actionsBox.querySelector('button');
    if (cashoutBtn) cashoutBtn.disabled = (MN.revealedCount || 0) === 0;
  }
}

// ---------- tragamonedas ----------
// juego original de Leal Bets (5 rodillos x 3 filas, 10 líneas fijas), no es
// ninguna tragamonedas real: el servidor decide siempre qué sale (ver
// server/slots.js), acá solo se anima y se muestra.
// mismas 10 líneas que server/slots.js — SOLO para dibujar qué casilleros
// resaltar cuando gana una línea, no decide nada del juego.
const SL_PAYLINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2], [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
// mismos símbolos y pagos que server/slots.js — SOLO para mostrar la
// tablita de pagos y dibujar cada símbolo, no decide nada del juego.
const SL_SYMBOLS = {
  CHIP_W: { label: 'Ficha blanca', pay: { 3: 4, 4: 9, 5: 27 }, cls: 'sl-chip-w' },
  CHIP_G: { label: 'Ficha verde', pay: { 3: 5, 4: 14, 5: 36 }, cls: 'sl-chip-g' },
  CHIP_B: { label: 'Ficha azul', pay: { 3: 7, 4: 18, 5: 45 }, cls: 'sl-chip-b' },
  CHIP_R: { label: 'Ficha roja', pay: { 3: 9, 4: 22, 5: 54 }, cls: 'sl-chip-r' },
  BALL: { label: 'Pelota', pay: { 3: 14, 4: 36, 5: 90 }, icon: 'ball', cls: 'sl-ball' },
  CUP: { label: 'Copa', pay: { 3: 22, 4: 54, 5: 144 }, icon: 'trophy', cls: 'sl-cup' },
  CREST: { label: 'Escudo', pay: { 3: 36, 4: 90, 5: 270 }, crest: true },
  WILD: { label: 'Comodín', pay: { 3: 45, 4: 108, 5: 360 }, icon: 'star', cls: 'sl-wild' },
  SCATTER: { label: 'Arco (scatter)', pay: {}, icon: 'goal', cls: 'sl-scatter' },
};
const SL_SCATTER_PAY = { 3: 4, 4: 18, 5: 90 };
const SL_SCATTER_SPINS = { 3: 8, 4: 10, 5: 12 };

let SL = { spinning: false, bonus: null }; // bonus: {freeSpinsLeft, totalFreeSpins, collected, stake} | null
let slGridCache = null; // último grid mostrado (para no perderlo al re-renderizar entre giros gratis)

function slSymbolHtml(id, value) {
  const meta = SL_SYMBOLS[id];
  if (id === 'MULT') return `<div class="sl-sym sl-mult">×${value}</div>`;
  if (!meta) return `<div class="sl-sym"></div>`;
  if (meta.crest) return `<div class="sl-sym sl-crest"><img src="/img/icons/icon-152.png" alt=""></div>`;
  if (meta.icon) return `<div class="sl-sym ${meta.cls || ''}">${icon(meta.icon, 26)}</div>`;
  return `<div class="sl-sym ${meta.cls || ''}"></div>`;
}
function slRandomSymbolHtml() {
  const ids = Object.keys(SL_SYMBOLS);
  return slSymbolHtml(ids[Math.floor(Math.random() * ids.length)]);
}

function slPopulatePaytable() {
  const box = document.getElementById('slPaytable');
  if (!box || box.children.length) return;
  const rows = Object.values(SL_SYMBOLS).filter((s) => s.pay[3]).map((s) => `
    <div class="bj-pay-row"><b>${s.label}</b><span>x3 ${s.pay[3]} · x4 ${s.pay[4]} · x5 ${s.pay[5]}</span></div>
  `).join('');
  const scatterRow = `<div class="bj-pay-row"><b>Arco (en cualquier lado)</b><span>x3 ${SL_SCATTER_PAY[3]} · x4 ${SL_SCATTER_PAY[4]} · x5 ${SL_SCATTER_PAY[5]} + giros gratis</span></div>`;
  box.innerHTML = rows + scatterRow;
}

// arma la grilla de 15 casilleros (5x4... en realidad 5 columnas x 3 filas)
// en orden de lectura fila por fila; opts.winCells es un Set de "col-fila"
// para resaltar los casilleros de las líneas ganadoras.
function slGridHtml(grid, opts) {
  opts = opts || {};
  const winCells = opts.winCells || new Set();
  const valuesByCell = opts.valuesByCell || {};
  let html = '';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const sym = grid[c][r];
      const key = `${c}-${r}`;
      const value = valuesByCell[key];
      const cellHtml = sym === 'MULT' ? slSymbolHtml('MULT', value) : slSymbolHtml(sym);
      html += winCells.has(key) ? cellHtml.replace('class="sl-sym', 'class="sl-sym sl-win') : cellHtml;
    }
  }
  return html;
}
function slSpinningGridHtml() {
  let html = '';
  for (let i = 0; i < 15; i++) html += slRandomSymbolHtml();
  return html;
}

function slResultText(lineWins, scatterCount, scatterWin) {
  const parts = [];
  if (lineWins && lineWins.length) {
    parts.push(`${lineWins.length} línea${lineWins.length > 1 ? 's' : ''} ganadora${lineWins.length > 1 ? 's' : ''}`);
  }
  if (scatterCount >= 3) parts.push(`${scatterCount} arcos (${scatterWin} fichas)`);
  return parts.join(' + ');
}

const SL_BUY_BONUS_COST_MULT = 100; // mismo valor que server/routes/slots.js
function slUpdateBuyBonusLabel() {
  const btn = document.getElementById('slBuyBonusBtn');
  const stakeInput = document.getElementById('slStakeInput');
  if (!btn || !stakeInput) return;
  const stake = parseInt(stakeInput.value, 10);
  btn.textContent = stake > 0 ? `Comprar bonus — ${stake * SL_BUY_BONUS_COST_MULT} fichas` : 'Comprar bonus (100x la apuesta)';
}

async function slBuyBonus() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  if (SL.spinning || SL.bonus) return;
  const stake = parseInt(document.getElementById('slStakeInput').value, 10);
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }
  const cost = stake * SL_BUY_BONUS_COST_MULT;
  if (!confirm(`¿Comprar la ronda bonus por ${cost} fichas?`)) return;

  SL.spinning = true;
  renderSlots();
  try {
    const result = await apiFetch('/slots/buy-bonus', { method: 'POST', body: { stake } });
    applyBalanceUpdate(result.balance);
    slGridCache = null;
    SL.lastWinCells = new Set();
    SL.lastValuesByCell = {};
    SL.lastResultText = '';
    SL.bonus = result.bonus;
    SL.spinning = false;
    toast(`¡Ronda bonus comprada! ${result.bonus.totalFreeSpins} giros gratis`);
    slRunBonusLoop();
  } catch (e) {
    SL.spinning = false;
    renderSlots();
    toast(e.message);
  }
}

async function slLoadState() {
  if (!ME) { renderSlots(); return; }
  try {
    const state = await apiFetch('/slots/state');
    SL.bonus = state.bonus;
  } catch (e) { /* ignorar, se reintenta solo */ }
  renderSlots();
  if (SL.bonus && SL.bonus.freeSpinsLeft > 0 && !SL.spinning) slRunBonusLoop();
}

async function slSpin() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  if (SL.spinning || SL.bonus) return;
  const stake = parseInt(document.getElementById('slStakeInput').value, 10);
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }

  SL.spinning = true;
  renderSlots();
  try {
    const [result] = await Promise.all([
      apiFetch('/slots/spin', { method: 'POST', body: { stake } }),
      sleep(650), // tiempo mínimo de giro antes de mostrar el resultado real
    ]);
    applyBalanceUpdate(result.balance);
    slGridCache = result.grid;

    const winCells = new Set();
    (result.lineWins || []).forEach((w) => {
      const rowsForLine = SL_PAYLINES[w.line];
      for (let c = 0; c < w.count; c++) winCells.add(`${c}-${rowsForLine[c]}`);
    });
    SL.lastWinCells = winCells;
    SL.lastValuesByCell = {};
    SL.lastResultText = result.totalWin > 0 ? `¡Ganaste ${result.totalWin} fichas! ${slResultText(result.lineWins, result.scatterCount, result.scatterWin)}`.trim() : '';
    SL.bonus = result.bonus;
    SL.spinning = false;
    renderSlots();

    if (result.bonus) {
      toast(`¡Ronda bonus! ${result.bonus.totalFreeSpins} giros gratis`);
      await sleep(900);
      slRunBonusLoop();
    }
  } catch (e) {
    SL.spinning = false;
    renderSlots();
    toast(e.message);
  }
}

// consume los giros gratis uno atrás del otro, animando cada uno, hasta que
// se terminan y se liquida el premio acumulado.
async function slRunBonusLoop() {
  if (SL.spinning) return;
  SL.spinning = true;
  while (SL.bonus && SL.bonus.freeSpinsLeft > 0) {
    renderSlots();
    let result;
    try {
      [result] = await Promise.all([
        apiFetch('/slots/bonus-spin', { method: 'POST' }),
        sleep(600),
      ]);
    } catch (e) {
      toast(e.message);
      SL.bonus = null;
      break;
    }
    slGridCache = result.grid;
    const multCells = new Set();
    const valuesByCell = {};
    (result.hits || []).forEach((h) => { const key = `${h.col}-${h.row}`; multCells.add(key); valuesByCell[key] = h.value; });
    SL.lastWinCells = multCells;
    SL.lastValuesByCell = valuesByCell;
    SL.lastResultText = result.collectedThisSpin > 0 ? `+${result.collectedThisSpin}x acumulado` : '';
    applyBalanceUpdate(result.balance);
    if (result.finished) {
      SL.bonus = null;
      SL.lastResultText = result.payout > 0
        ? `¡Ronda bonus terminada! Cobraste ${result.payout} fichas (x${result.totalCollected})`
        : 'Ronda bonus terminada — no se juntó multiplicador';
      renderSlots();
      break;
    }
    SL.bonus = { freeSpinsLeft: result.freeSpinsLeft, totalFreeSpins: result.totalFreeSpins, collected: result.totalCollected, stake: SL.bonus.stake };
    renderSlots();
    await sleep(250);
  }
  SL.spinning = false;
  renderSlots();
}

function renderSlots() {
  const field = document.getElementById('slotsField');
  const spinBtn = document.getElementById('slSpinBtn');
  const stakeInput = document.getElementById('slStakeInput');
  const buyBonusBtn = document.getElementById('slBuyBonusBtn');
  if (!field || !spinBtn || !stakeInput || !buyBonusBtn) return;
  slPopulatePaytable();
  slUpdateBuyBonusLabel();

  if (!ME) {
    field.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para jugar.</div>`;
    spinBtn.disabled = true; stakeInput.disabled = true; buyBonusBtn.disabled = true;
    return;
  }

  const inBonus = !!SL.bonus;
  spinBtn.disabled = SL.spinning || inBonus;
  stakeInput.disabled = SL.spinning || inBonus;
  buyBonusBtn.disabled = SL.spinning || inBonus;
  spinBtn.textContent = inBonus ? 'Girando giros gratis…' : (SL.spinning ? 'Girando…' : 'Girar');

  const bonusBar = inBonus
    ? `<div class="sl-bonus-bar">${icon('goal', 15)}<span>Giros gratis: <b>${SL.bonus.freeSpinsLeft}</b> / ${SL.bonus.totalFreeSpins}</span><span>Multiplicador acumulado: <b>x${SL.bonus.collected}</b></span></div>`
    : '';

  let gridHtml;
  if (SL.spinning && !slGridCache) {
    gridHtml = slSpinningGridHtml();
  } else if (slGridCache) {
    gridHtml = slGridHtml(slGridCache, { winCells: SL.lastWinCells, valuesByCell: SL.lastValuesByCell });
  } else {
    gridHtml = slGridHtml([
      ['CHIP_W', 'BALL', 'CHIP_G'], ['CHIP_G', 'CUP', 'CHIP_B'], ['CHIP_B', 'WILD', 'CHIP_R'],
      ['CHIP_R', 'CREST', 'CHIP_W'], ['BALL', 'SCATTER', 'CUP'],
    ]);
  }

  field.innerHTML = bonusBar
    + `<div class="sl-reels${SL.spinning ? ' sl-spinning' : ''}${inBonus ? ' sl-bonus-active' : ''}">${gridHtml}</div>`
    + (SL.lastResultText ? `<div class="sl-result">${SL.lastResultText}</div>` : '');
}

// ---------- ruleta ----------
// ruleta europea (un solo cero) — el servidor sortea siempre el número, acá
// solo se arma la rueda, se elige qué apostar y se anima la bola. Mismo
// orden físico de casilleros que server/roulette.js (WHEEL_ORDER), para que
// la bola frene visualmente en el número correcto.
const RL_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RL_RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RL_SECTOR_ANGLE = 360 / 37;
function rlColorOf(n) { if (n === 0) return 'green'; return RL_RED_NUMBERS.has(n) ? 'red' : 'black'; }
function rlColorLabel(c) { return c === 'red' ? 'rojo' : c === 'black' ? 'negro' : 'verde'; }

const RL_CHIP_VALUES = [10, 50, 100, 500, 1000];
let RL = {
  bets: [], // {type, value, amount}[] — como fichas de verdad puestas en el paño, se puede tener varias a la vez
  chipValue: 100,
  showHotspots: false, // caballo/cuadro arrancan escondidos: menos cuadraditos, menos lío
  spinning: false, ballAngle: 0, history: [], lastResultText: '', lastWon: false,
};

function rlPolar(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}
// rueda dibujada una sola vez con SVG: 37 casilleros en forma de anillo (no
// un círculo entero), con los números rotados para que se lean "de adentro
// hacia afuera" como en una ruleta de verdad.
function rlWheelSvg() {
  const cx = 100, cy = 100, rOuter = 92, rInner = 56, rText = 76;
  let wedges = '';
  let labels = '';
  RL_WHEEL_ORDER.forEach((num, i) => {
    const center = i * RL_SECTOR_ANGLE;
    const a0 = center - RL_SECTOR_ANGLE / 2;
    const a1 = center + RL_SECTOR_ANGLE / 2;
    const p0o = rlPolar(cx, cy, rOuter, a0);
    const p1o = rlPolar(cx, cy, rOuter, a1);
    const p0i = rlPolar(cx, cy, rInner, a0);
    const p1i = rlPolar(cx, cy, rInner, a1);
    const color = rlColorOf(num);
    const cls = color === 'red' ? 'rl-wedge-red' : color === 'black' ? 'rl-wedge-black' : 'rl-wedge-green';
    wedges += `<path d="M ${p0i.x.toFixed(2)} ${p0i.y.toFixed(2)} L ${p0o.x.toFixed(2)} ${p0o.y.toFixed(2)} A ${rOuter} ${rOuter} 0 0 1 ${p1o.x.toFixed(2)} ${p1o.y.toFixed(2)} L ${p1i.x.toFixed(2)} ${p1i.y.toFixed(2)} A ${rInner} ${rInner} 0 0 0 ${p0i.x.toFixed(2)} ${p0i.y.toFixed(2)} Z" class="${cls}"></path>`;
    const tp = rlPolar(cx, cy, rText, center);
    labels += `<text x="${tp.x.toFixed(2)}" y="${tp.y.toFixed(2)}" transform="rotate(${center.toFixed(2)} ${tp.x.toFixed(2)} ${tp.y.toFixed(2)})" class="rl-wedge-num">${num}</text>`;
  });
  return `<svg viewBox="0 0 200 200" class="rl-wheel-svg">
    <defs>
      <radialGradient id="rlHubGrad" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#fbe7b8"></stop>
        <stop offset="45%" stop-color="#F0C25A"></stop>
        <stop offset="100%" stop-color="#C8912E"></stop>
      </radialGradient>
    </defs>
    <circle cx="100" cy="100" r="97" class="rl-wheel-rim"></circle>
    ${wedges}
    <circle cx="100" cy="100" r="${rInner - 2}" class="rl-hub-ring"></circle>
    ${labels}
    <circle cx="100" cy="100" r="${rInner - 10}" fill="url(#rlHubGrad)" class="rl-hub"></circle>
  </svg>`;
}

function rlHistoryHtml() {
  if (!RL.history.length) return '';
  return `<div class="rl-history">${RL.history.map((h) => `<span class="rl-chip rl-chip-sm rl-${h.color}">${h.number}</span>`).join('')}</div>`;
}

// paño real de la ruleta: los números van en 3 filas x 12 columnas (más el 0
// aparte) en el mismo orden que cualquier mesa de ruleta de verdad — no es
// el orden de la rueda (RL_WHEEL_ORDER), es el orden del paño para apostar.
// Fila de arriba: múltiplos de 3 (3,6,9...36); del medio: ...2 mod 3; abajo:
// ...1 mod 3 — así cada columna del paño coincide con una apuesta a columna.
function rlFeltNumber(col, row) { return row === 1 ? col * 3 : row === 2 ? col * 3 - 1 : col * 3 - 2; }
// serializa un valor de apuesta (número, null o arreglo) para meterlo en un
// atributo onclick="..." tal cual es válido en JS.
function rlOnclickVal(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.join(',')}]`;
  return v;
}
function rlValuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}
// se puede tener varias fichas puestas a la vez (una en un número, otra en
// rojo, otra en una docena...), así que en vez de "la apuesta actual" ahora
// es una lista — cada casillero del paño se fija si tiene una ficha propia.
function rlFindBet(type, value) { return RL.bets.find((b) => b.type === type && rlValuesEqual(b.value, value)); }
function rlHasBet(type, value) { return !!rlFindBet(type, value); }
function rlCompactAmount(n) { return n >= 1000 ? (n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(1)) + 'K' : String(n); }
function rlChipMark(type, value) {
  const bet = rlFindBet(type, value);
  return bet ? `<span class="rl-bet-chip">${rlCompactAmount(bet.amount)}</span>` : '';
}
// tocar un casillero pone una ficha del valor elegido; volver a tocarlo la
// saca (así se puede armar varias apuestas a la vez, como en una mesa real).
function rlToggleBet(type, value) {
  if (RL.spinning) return;
  const idx = RL.bets.findIndex((b) => b.type === type && rlValuesEqual(b.value, value));
  if (idx >= 0) RL.bets.splice(idx, 1);
  else RL.bets.push({ type, value, amount: RL.chipValue });
  renderRoulette();
}
function rlSetChipValue(v) {
  RL.chipValue = v;
  renderRoulette();
}
function rlClearBets() {
  if (RL.spinning || !RL.bets.length) return;
  RL.bets = [];
  renderRoulette();
}
function rlToggleHotspots() {
  RL.showHotspots = !RL.showHotspots;
  renderRoulette();
}
function rlTotalStake() { return RL.bets.reduce((s, b) => s + b.amount, 0); }
function rlBetLabel(type, value) {
  if (type === 'number') return `pleno ${value}`;
  if (type === 'split') return `caballo ${value[0]}-${value[1]}`;
  if (type === 'corner') return `cuadro ${value.join('-')}`;
  const labels = {
    red: 'rojo', black: 'negro', even: 'par', odd: 'impar', low: '1-18', high: '19-36',
    dozen: `${value}ª docena`, column: `columna ${value}`,
  };
  return labels[type] || type;
}

function rlFeltHtml() {
  const cell = (extraCls, gridCol, gridRow, type, value, label) => {
    return `<button type="button" class="rl-felt-cell ${extraCls}${rlHasBet(type, value) ? ' active' : ''}" style="grid-column:${gridCol};grid-row:${gridRow};" onclick="rlToggleBet('${type}', ${rlOnclickVal(value)})">${label}${rlChipMark(type, value)}</button>`;
  };

  let html = cell('rl-felt-zero', 1, '1/4', 'number', 0, '0');
  let numbersHtml = '';
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 3; r++) {
      const num = rlFeltNumber(c, r);
      const colorCls = `rl-felt-${rlColorOf(num)}`;
      numbersHtml += `<button type="button" class="rl-felt-cell ${colorCls}${rlHasBet('number', num) ? ' active' : ''}" style="grid-column:${c};grid-row:${r};" onclick="rlToggleBet('number', ${num})">${num}${rlChipMark('number', num)}</button>`;
    }
  }
  html += `<div class="rl-numbers-wrap" style="grid-column:2/14;grid-row:1/4;">
    <div class="rl-numbers-grid">${numbersHtml}</div>
    ${RL.showHotspots ? `<div class="rl-hotspots">${rlHotspotsHtml()}</div>` : ''}
  </div>`;
  // "2 a 1" (apuesta a columna), una por fila, a la derecha del todo
  for (let r = 1; r <= 3; r++) {
    const colBet = r === 1 ? 3 : r === 2 ? 2 : 1;
    html += cell('rl-felt-outside', 14, r, 'column', colBet, '2:1');
  }
  // docenas
  html += cell('rl-felt-outside', '2/6', 4, 'dozen', 1, '1ª doc.');
  html += cell('rl-felt-outside', '6/10', 4, 'dozen', 2, '2ª doc.');
  html += cell('rl-felt-outside', '10/14', 4, 'dozen', 3, '3ª doc.');
  // apuestas simples de afuera
  html += cell('rl-felt-outside', '2/4', 5, 'low', null, '1-18');
  html += cell('rl-felt-outside', '4/6', 5, 'even', null, 'Par');
  html += cell('rl-felt-red', '6/8', 5, 'red', null, 'Rojo');
  html += cell('rl-felt-black', '8/10', 5, 'black', null, 'Negro');
  html += cell('rl-felt-outside', '10/12', 5, 'odd', null, 'Impar');
  html += cell('rl-felt-outside', '12/14', 5, 'high', null, '19-36');
  return `<div class="rl-felt">${html}</div>`;
}
// caballo (entre 2 números vecinos) y cuadro (entre 4): puntitos tocables
// sobre las líneas/esquinas de la cuadrícula de números, calculados como
// porcentaje de esa cuadrícula (12 columnas x 3 filas parejas) — mismas
// reglas de vecindad que valida el servidor (server/roulette.js). Escondidos
// por defecto (RL.showHotspots) para no llenar el paño de puntitos.
function rlHotspotsHtml() {
  const dot = (leftPct, topPct, type, value, title) => {
    const active = rlHasBet(type, value) ? ' active' : '';
    return `<button type="button" class="rl-hotspot${active}" style="left:${leftPct}%;top:${topPct}%;" title="${title}" onclick="rlToggleBet('${type}', ${rlOnclickVal(value)})"></button>`;
  };
  let html = '';
  // caballo horizontal: entre columnas vecinas, misma fila
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 11; c++) {
      const a = rlFeltNumber(c, r), b = rlFeltNumber(c + 1, r);
      html += dot((c / 12) * 100, ((r - 0.5) / 3) * 100, 'split', [a, b], `Caballo ${a}-${b}`);
    }
  }
  // caballo vertical: entre filas vecinas, misma columna
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 2; r++) {
      const a = rlFeltNumber(c, r), b = rlFeltNumber(c, r + 1);
      html += dot(((c - 0.5) / 12) * 100, (r / 3) * 100, 'split', [a, b], `Caballo ${a}-${b}`);
    }
  }
  // caballo con el 0: en el borde izquierdo, contra la primera columna
  for (let r = 1; r <= 3; r++) {
    const b = rlFeltNumber(1, r);
    html += dot(0, ((r - 0.5) / 3) * 100, 'split', [0, b], `Caballo 0-${b}`);
  }
  // cuadro: en cada cruce interior (esquina de 4 números)
  for (let c = 1; c <= 11; c++) {
    for (let r = 1; r <= 2; r++) {
      const nums = [rlFeltNumber(c, r), rlFeltNumber(c + 1, r), rlFeltNumber(c, r + 1), rlFeltNumber(c + 1, r + 1)];
      html += dot((c / 12) * 100, (r / 3) * 100, 'corner', nums, `Cuadro ${nums.join('-')}`);
    }
  }
  return html;
}
function rlChipValueRowHtml() {
  return RL_CHIP_VALUES.map((v) => `<button type="button" class="rl-chip rl-chipvalue${v === RL.chipValue ? ' active' : ''}" onclick="rlSetChipValue(${v})">${v}</button>`).join('');
}
function rlBetSummaryText() {
  if (!RL.bets.length) return 'Todavía no pusiste ninguna ficha en el paño.';
  const items = RL.bets.map((b) => `${rlBetLabel(b.type, b.value)} (${b.amount})`).join(' · ');
  return `<b>${RL.bets.length}</b> ficha${RL.bets.length > 1 ? 's' : ''} puesta${RL.bets.length > 1 ? 's' : ''}: ${items} — total <b>${rlTotalStake()}</b>`;
}

async function rlSpin() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  if (RL.spinning) return;
  if (!RL.bets.length) { toast('Poné al menos una ficha en el paño'); return; }

  RL.spinning = true;
  RL.lastResultText = '';
  renderRoulette();

  let result;
  try {
    result = await apiFetch('/roulette/spin', { method: 'POST', body: { bets: RL.bets } });
  } catch (e) {
    RL.spinning = false;
    renderRoulette();
    toast(e.message);
    return;
  }

  // la bola sigue girando siempre para adelante (nunca "salta" para atrás):
  // se calcula cuánto falta desde el ángulo actual para caer en el número
  // real, y se le suman varias vueltas enteras de más para que dure un rato.
  const winningIndex = RL_WHEEL_ORDER.indexOf(result.winningNumber);
  const currentMod = ((RL.ballAngle % 360) + 360) % 360;
  const desiredMod = winningIndex * RL_SECTOR_ANGLE;
  let diff = desiredMod - currentMod;
  if (diff < 0) diff += 360;
  const extraTurns = 6 + Math.floor(Math.random() * 3); // 6 a 8 vueltas de más
  const targetAngle = RL.ballAngle + diff + extraTurns * 360;

  const orbit = document.getElementById('rlBallOrbit');
  if (orbit) {
    orbit.style.transition = 'transform 4200ms cubic-bezier(0.14,0.7,0.19,1)';
    void orbit.offsetWidth; // fuerza el reflow para que la transición arranque desde el ángulo actual
    orbit.style.transform = `rotate(${targetAngle}deg)`;
  }
  await sleep(4300);

  RL.ballAngle = targetAngle;
  RL.spinning = false;
  RL.lastWon = result.totalPayout > 0;
  const winners = result.results.filter((r) => r.won);
  let text = `Salió el ${result.winningNumber} (${rlColorLabel(result.color)})`;
  text += result.totalPayout > 0
    ? ` — ¡Ganaste ${result.totalPayout} fichas! (${winners.length} de ${result.results.length} apuestas: ${winners.map((w) => rlBetLabel(w.type, w.value)).join(', ')})`
    : ` — ninguna de tus ${result.results.length} apuestas acertó`;
  RL.lastResultText = text;
  RL.history.unshift({ number: result.winningNumber, color: result.color });
  if (RL.history.length > 12) RL.history.length = 12;
  applyBalanceUpdate(result.balance);
  renderRoulette();
}

function renderRoulette() {
  const field = document.getElementById('rouletteField');
  const spinBtn = document.getElementById('rlSpinBtn');
  const feltBox = document.getElementById('rlFeltBox');
  const summaryEl = document.getElementById('rlBetSummary');
  const chipRow = document.getElementById('rlChipValueRow');
  const hotspotToggle = document.getElementById('rlHotspotToggle');
  const clearBtn = document.querySelector('.rl-clear-btn');
  if (!field || !spinBtn || !feltBox || !summaryEl || !chipRow || !hotspotToggle) return;

  chipRow.innerHTML = rlChipValueRowHtml();
  hotspotToggle.checked = RL.showHotspots;
  feltBox.innerHTML = rlFeltHtml();
  summaryEl.innerHTML = rlBetSummaryText();

  if (!ME) {
    field.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para jugar.</div>`;
    spinBtn.disabled = true;
    document.querySelectorAll('#rlFeltBox button, #rlChipValueRow button').forEach((b) => { b.disabled = true; });
    return;
  }

  spinBtn.disabled = RL.spinning || !RL.bets.length;
  spinBtn.textContent = RL.spinning ? 'Girando…' : 'Girar';
  if (clearBtn) clearBtn.disabled = RL.spinning || !RL.bets.length;
  document.querySelectorAll('#rlFeltBox button, #rlChipValueRow button').forEach((b) => { b.disabled = RL.spinning; });

  field.innerHTML = `
    <div class="rl-wheel-wrap">
      ${rlWheelSvg()}
      <div class="rl-ball-orbit" id="rlBallOrbit" style="transform:rotate(${RL.ballAngle}deg)"><div class="rl-ball"></div></div>
      <div class="rl-pointer"></div>
    </div>
    ${rlHistoryHtml()}
    ${RL.lastResultText ? `<div class="rl-result${RL.lastWon ? ' rl-win' : ''}">${RL.lastResultText}</div>` : ''}
  `;
}

// ---------- mesa de blackjack en vivo ----------
// a diferencia de todo lo demás en este archivo, esto NO es "pedís una
// acción, el servidor contesta": la mesa es un solo estado COMPARTIDO entre
// todos los que están sentados, que le llega a todo el mundo por socket
// (evento "table:update") apenas cambia algo — nadie necesita refrescar la
// página para ver la jugada de otro. LB.table es simplemente la última foto
// que mandó el servidor.
let LB = { table: null };

function lbCardHtml(card) {
  if (!card) return `<div class="lb-card lb-card-hidden"></div>`;
  const red = card.s === '♥' || card.s === '♦';
  return `<div class="lb-card${red ? ' lb-card-red' : ''}">${card.r}${card.s}</div>`;
}
function lbMySeat(table) {
  return ME ? table.seats.find((s) => s && s.userName === ME) : null;
}
function lbPhaseLabel(table) {
  if (table.phase === 'waiting') return 'Mesa vacía — sentate para arrancarla';
  if (table.phase === 'betting') return 'Apuestas abiertas';
  if (table.phase === 'playing') {
    const seat = table.currentSeatIndex != null ? table.seats[table.currentSeatIndex] : null;
    return seat ? `Turno de ${seat.userName}` : 'Jugando…';
  }
  if (table.phase === 'payout') return 'Resultados de la ronda';
  return '';
}
function lbSecondsLeft(table) {
  if (!table.phaseEndsAt) return null;
  return Math.max(0, Math.ceil((table.phaseEndsAt - Date.now()) / 1000));
}
function lbSeatStatusHtml(seat) {
  if (seat.status === 'seated') return `<span class="lb-status">sentado</span>`;
  if (seat.status === 'betting') return `<span class="lb-status">apostó ${seat.bet}</span>`;
  if (seat.status === 'playing') return `<span class="lb-status lb-status-live">jugando…</span>`;
  if (seat.status === 'stood') return `<span class="lb-status">plantado</span>`;
  if (seat.status === 'busted') return `<span class="lb-status lb-status-lose">se pasó</span>`;
  if (seat.status === 'blackjack') return `<span class="lb-status lb-status-win">¡blackjack!</span>`;
  if (seat.status === 'done') {
    if (seat.result === 'win') return `<span class="lb-status lb-status-win">ganó ${seat.payout}</span>`;
    if (seat.result === 'blackjack') return `<span class="lb-status lb-status-win">¡blackjack! ganó ${seat.payout}</span>`;
    if (seat.result === 'push') return `<span class="lb-status">empate</span>`;
    return `<span class="lb-status lb-status-lose">perdió</span>`;
  }
  return '';
}
function lbSeatHtml(seat, index, table) {
  if (!seat) {
    return `<div class="lb-seat lb-seat-empty">
      <div class="lb-seat-avatar lb-seat-avatar-empty">${icon('users', 16)}</div>
      ${ME ? `<button type="button" class="reopen-btn lb-sit-btn" onclick="lbSit()">Sentarme</button>` : `<span class="lb-status">vacío</span>`}
    </div>`;
  }
  const isMe = seat.userName === ME;
  const isTurn = table.phase === 'playing' && table.currentSeatIndex === index;
  const cardsHtml = seat.cards.length ? seat.cards.map((c) => lbCardHtml(c)).join('') : '';
  const total = seat.cards.length ? `<div class="lb-total">${bjHandTotal(seat.cards)}</div>` : '';
  return `<div class="lb-seat${isMe ? ' lb-seat-me' : ''}${isTurn ? ' lb-seat-turn' : ''}">
    <div class="lb-seat-avatar">${seat.userName.charAt(0).toUpperCase()}</div>
    <div class="lb-seat-name">${seat.userName}${isMe ? ' (vos)' : ''}</div>
    ${seat.bet > 0 ? `<div class="lb-seat-bet">${icon('wallet', 11)}${seat.bet}</div>` : ''}
    <div class="lb-seat-cards">${cardsHtml}</div>
    ${total}
    ${lbSeatStatusHtml(seat)}
  </div>`;
}

async function lbLoadState() {
  try { LB.table = await apiFetch('/live-blackjack/state'); } catch (e) { /* se reintenta con el próximo socket update */ }
  renderLiveTable();
}
async function lbSit() {
  if (!ME) { toast('Entrá con tu usuario para jugar'); return; }
  try { await apiFetch('/live-blackjack/sit', { method: 'POST' }); } catch (e) { toast(e.message); }
}
async function lbStandUp() {
  try { await apiFetch('/live-blackjack/stand-up', { method: 'POST' }); } catch (e) { toast(e.message); }
}
async function lbPlaceBet() {
  const amount = parseInt(document.getElementById('lbBetInput').value, 10);
  if (!amount || amount <= 0) { toast('Poné un monto válido'); return; }
  try { await apiFetch('/live-blackjack/bet', { method: 'POST', body: { amount } }); } catch (e) { toast(e.message); }
}
async function lbHit() { try { await apiFetch('/live-blackjack/hit', { method: 'POST' }); } catch (e) { toast(e.message); } }
async function lbStand() { try { await apiFetch('/live-blackjack/stand', { method: 'POST' }); } catch (e) { toast(e.message); } }
async function lbDouble() { try { await apiFetch('/live-blackjack/double', { method: 'POST' }); } catch (e) { toast(e.message); } }

function renderLiveTable() {
  const field = document.getElementById('liveTableField');
  if (!field) return;
  const table = LB.table;
  if (!table) { field.innerHTML = `<div class="lb-field"><div class="empty">${icon('clock', 24)}Conectando con la mesa…</div></div>`; return; }

  const secs = lbSecondsLeft(table);
  const mySeat = lbMySeat(table);
  const seatedIdx = mySeat ? table.seats.findIndex((s) => s === mySeat) : -1;
  const myTurn = table.phase === 'playing' && seatedIdx !== -1 && table.currentSeatIndex === seatedIdx;
  const tableFull = table.seats.every(Boolean);
  const dealing = table.phase === 'playing' || table.phase === 'payout';
  const dealerCardsHtml = table.dealerHand.map((c) => lbCardHtml(c)).join('') + (dealing && table.dealerHidden ? lbCardHtml(null) : '');
  const dealerTotal = table.dealerHidden ? '' : `<div class="lb-total">${bjHandTotal(table.dealerHand)}</div>`;

  let controlsHtml = '';
  if (!ME) {
    controlsHtml = `<div class="empty">${icon('lock', 22)}Entrá con tu usuario para sentarte.</div>`;
  } else if (!mySeat) {
    controlsHtml = `<button type="button" class="primary-btn lb-wide-btn" onclick="lbSit()" ${tableFull ? 'disabled' : ''}>${tableFull ? 'Mesa llena' : 'Sentarme a la mesa'}</button>`;
  } else {
    const parts = [];
    if (table.phase === 'betting' && mySeat.bet === 0) {
      parts.push(`<div class="lb-bet-form">
        <input id="lbBetInput" type="number" min="1" placeholder="Ej: 200">
        <button type="button" class="primary-btn" onclick="lbPlaceBet()">Apostar</button>
      </div>`);
    }
    if (myTurn) {
      const canDouble = mySeat.cards.length === 2;
      parts.push(`<div class="bj-actions lb-actions">
        <button type="button" onclick="lbHit()">Pedir carta</button>
        <button type="button" onclick="lbStand()">Plantarse</button>
        ${canDouble ? `<button type="button" class="bj-secondary" onclick="lbDouble()">Doblar</button>` : ''}
      </div>`);
    }
    if (!mySeat.leaving) parts.push(`<button type="button" class="reopen-btn" onclick="lbStandUp()">${icon('undo', 13)}Pararme de la mesa</button>`);
    else parts.push(`<p class="lb-help-note">Te vas a parar apenas termine esta ronda.</p>`);
    controlsHtml = parts.join('');
  }

  field.innerHTML = `<div class="lb-field">
    <div class="lb-phase-banner${table.phase === 'playing' ? ' lb-phase-live' : ''}">
      <span>${lbPhaseLabel(table)}</span>
      ${secs !== null ? `<b id="lbTimer">${secs}s</b>` : ''}
    </div>
    <div class="lb-table">
      <div class="lb-dealer">
        <div class="lb-dealer-label">Dealer</div>
        <div class="lb-seat-cards">${dealerCardsHtml}</div>
        ${dealerTotal}
      </div>
      <div class="lb-seats">${table.seats.map((s, i) => lbSeatHtml(s, i, table)).join('')}</div>
    </div>
    <div class="lb-controls">${controlsHtml}</div>
  </div>`;
}
// el contador de segundos se actualiza solo (sin pedir nada al servidor):
// el socket ya mandó cuándo termina la fase, así que alcanza con recalcular
// contra el reloj local cada un segundo, sin rehacer todo el HTML de la mesa
// (para no perder el foco si alguien está tipeando su apuesta).
setInterval(() => {
  if (!LB.table || casinoView !== 'live-blackjack') return;
  const secs = lbSecondsLeft(LB.table);
  const el = document.getElementById('lbTimer');
  if (el && secs !== null) el.textContent = secs + 's';
}, 1000);

// ---------- init ----------
(async function init() {
  await refreshFromServer(true);

  const token = localStorage.getItem('lb_token');
  const name = localStorage.getItem('lb_name');
  if (token && name) {
    TOKEN = token;
    try {
      const me = await apiFetch('/auth/me');
      ME = me.name;
      showApp();
      await loadMyBets();
      renderAll(true);
      await bjLoadState(); // por si había una mano de blackjack a mitad de jugar
      await pnLoadState(); // por si había una tanda de penales a mitad de jugar
      await mnLoadState(); // por si había una partida de minas a mitad de jugar
      await slLoadState(); // por si había una ronda bonus de tragamonedas a mitad de jugar
    } catch (e) {
      TOKEN = null;
      localStorage.removeItem('lb_token');
      localStorage.removeItem('lb_name');
      showGate();
    }
  } else {
    showGate();
  }
  renderBlackjack();
  renderPenalty();
  renderMines();
  renderSlots();
  renderRoulette();

  const adminToken = localStorage.getItem('lb_admin_token');
  if (adminToken) {
    ADMIN_TOKEN = adminToken;
    isAdmin = true;
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    renderAdmin();
    renderLealHistory(); // para que aparezca ya el botón de borrar/editar en "Por rival"...
    renderAllMatchesList(); // ...y en "Partidos jugados"
  }

  connectSocket();
})();
