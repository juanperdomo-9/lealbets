// Leal Bets - frontend. Habla con la API propia (server/routes/*) en vez de
// window.storage, y recibe avisos en tiempo real por socket.io en vez de
// hacer polling cada 7 segundos.

let TOKEN = null;
let ADMIN_TOKEN = null;
let ME = null;
let isAdmin = false;
let STATE = { teams: [], matches: [], ranking: [], lealPlayerOrder: [] };
let MY_BETS = [];
let CART = [];
let cartPanelOpen = false;
let expandedMatches = new Set();
let expandedPlayers = new Set();

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
};
function icon(name, size) {
  const s = size || 14;
  return `<span class="icon">${(ICONS[name] || '').split('{s}').join(s)}</span>`;
}

// rellena los íconos de los elementos estáticos del HTML (gate + header)
document.getElementById('userIcon').innerHTML = ICONS.user.split('{s}').join(16);
document.getElementById('lockIcon').innerHTML = ICONS.lock.split('{s}').join(16);
document.getElementById('enterIcon').innerHTML = ICONS.login.split('{s}').join(16);
document.getElementById('walletIcon').innerHTML = ICONS.wallet.split('{s}').join(14);

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
  return `<div class="odds-btn${selected ? ' selected' : ''}" onclick="toggleLeg('${matchId}','${pick}')">
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
  } catch (e) {
    toast(e.message);
  }
}

// ---------- tabs ----------
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('main section').forEach((s) => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'admin' && isAdmin) renderAdmin();
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
  const playerStats = {};
  const didNotPlay = [];
  document.querySelectorAll('#playerStatsForm .statInput').forEach((inp) => {
    const player = inp.dataset.player, market = inp.dataset.market;
    playerStats[player] = playerStats[player] || {};
    playerStats[player][market] = parseInt(inp.value, 10) || 0;
  });
  document.querySelectorAll('#playerStatsForm .statCheck').forEach((chk) => {
    const player = chk.dataset.player, market = chk.dataset.market;
    playerStats[player] = playerStats[player] || {};
    playerStats[player][market] = chk.checked;
  });
  document.querySelectorAll('#playerStatsForm .statDidNotPlay').forEach((chk) => {
    if (chk.checked) didNotPlay.push(chk.dataset.player);
  });
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
  CART.splice(i, 1);
  if (CART.length === 0) cartPanelOpen = false;
  renderMatches();
  renderCartBar();
}
function toggleCartPanel() {
  cartPanelOpen = !cartPanelOpen;
  renderCartBar();
}
function combinedOddsValue() {
  return Math.round(CART.reduce((p, l) => p * l.odds, 1) * 100) / 100;
}
function updateComboPreview() {
  const val = parseInt(document.getElementById('comboStake').value, 10) || 0;
  const odds = combinedOddsValue();
  document.getElementById('comboPreview').textContent =
    val > 0 ? `Si acertás todo, cobrás ${Math.round(val * odds)} fichas` : `Si acertás todo, cobrás fichas × ${odds}`;
}
async function confirmCombo() {
  const stakeInput = document.getElementById('comboStake');
  const stake = parseInt(stakeInput.value, 10);
  if (CART.length === 0) { toast('Elegí al menos una selección'); return; }
  if (!stake || stake <= 0) { toast('Poné un monto válido'); return; }
  try {
    const legs = CART.map((l) => ({ matchId: l.matchId, pick: l.pick }));
    const result = await apiFetch('/bets', { method: 'POST', body: { legs, stake } });
    const wasCombo = CART.length > 1;
    CART = [];
    cartPanelOpen = false;
    await loadState();
    await loadMyBets();
    renderAll();
    toast(result.wasReset
      ? 'Te quedaste sin fichas — se te recargó la cuenta'
      : (wasCombo ? 'Combinada confirmada' : 'Apuesta confirmada'));
  } catch (e) { toast(e.message); }
}
async function cashOutBet(betId) {
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
  const combinedOdds = combinedOddsValue();
  let html = `<div class="cart-summary" onclick="toggleCartPanel()">
    <div class="info"><span class="badge">${CART.length}</span>${CART.length === 1 ? 'selección' : 'selecciones'}<small>cuota combinada ${combinedOdds}</small></div>
    <div class="toggle${cartPanelOpen ? ' open' : ''}">${cartPanelOpen ? 'Cerrar' : 'Ver apuesta'}${icon('chevron', 13)}</div>
  </div>`;
  if (cartPanelOpen) {
    html += `<div class="cart-panel">`;
    CART.forEach((l, i) => {
      html += `<div class="cart-leg">
        <span>${l.matchLabel}<small>${l.label} · cuota ${l.odds}</small></span>
        <button class="remove" onclick="removeFromCart(${i})">${icon('close', 12)}</button>
      </div>`;
    });
    html += `<div class="slip" style="border-top:none;padding-top:12px;">
      <label>Monto a apostar (fichas)</label>
      <div class="slip-row">
        <input id="comboStake" type="number" min="1" placeholder="Fichas" oninput="updateComboPreview()">
        <button class="confirm" onclick="confirmCombo()">${icon('check', 13)}Confirmar</button>
      </div>
      <div class="payout" id="comboPreview">Si acertás todo, cobrás fichas × ${combinedOdds}</div>
    </div>`;
    html += `</div>`;
  }
  bar.innerHTML = html;
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

function renderMatches() {
  const list = document.getElementById('matchesList');
  const upcoming = STATE.matches.filter((m) => m.status === 'upcoming').sort((a, b) => b.createdAt - a.createdAt);
  const finished = STATE.matches.filter((m) => m.status === 'finished').sort((a, b) => b.createdAt - a.createdAt);
  if (STATE.matches.length === 0) {
    list.innerHTML = `<div class="empty">${icon('ball', 30)}Todavía no hay partidos cargados.<br>Andá a la pestaña Equipos para programar el primero.</div>`;
    return;
  }
  let html = '';
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
  for (const m of finished) {
    const r = m.result;
    html += `<div class="ticket finished"><div class="ticket-body">
      <div class="ticket-meta">
        <span class="status-pill finished"><span class="dot"></span>Finalizado</span>
        <span class="match-id">#${m.id.slice(-4)}</span>
      </div>
      <div class="ticket-teams" style="cursor:default;">
        <div class="team-chip">${crestHtml(m.homeName)}<span class="name">${m.homeName}</span></div>
        <span class="vs-badge">VS</span>
        <div class="team-chip">${crestHtml(m.awayName)}<span class="name">${m.awayName}</span></div>
      </div>
      <div class="ticket-result-wrap"><div class="ticket-result">${r.homeGoals} – ${r.awayGoals}</div></div>
      <div class="ticket-status"><b>1x2</b> ${m.odds.home} / ${m.odds.draw} / ${m.odds.away} &nbsp;·&nbsp; <b>Goles ${m.odds.goals.line}</b> ${m.odds.goals.over} / ${m.odds.goals.under} &nbsp;·&nbsp; <b>Ambos anotan</b> ${m.odds.btts.yes} / ${m.odds.btts.no}</div>
      ${isAdmin ? `<button class="reopen-btn" onclick="reopenMatch('${m.id}')">${icon('undo', 13)}Reabrir partido (corregir resultado)</button>` : ''}
    </div></div>`;
  }
  list.innerHTML = html;
}

function renderMyBets() {
  const list = document.getElementById('myBetsList');
  if (!ME) { list.innerHTML = `<div class="empty">${icon('lock', 26)}Entrá con tu usuario para ver tus apuestas.</div>`; return; }
  const mine = MY_BETS.slice().sort((a, b) => b.placedAt - a.placedAt);
  if (mine.length === 0) {
    list.innerHTML = `<div class="empty">${icon('ticket', 28)}Todavía no hiciste ninguna apuesta.</div>`;
    return;
  }
  list.innerHTML = mine.map((b) => {
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
    const potentialOdds = Math.round(b.legs.filter((l) => l.result !== 'void').reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;
    const potentialText = (!b.settled && !b.cancelled) ? ` · si ganás, cobrás ${Math.round(b.stake * potentialOdds)} fichas` : '';
    const cashOutBtn = (!b.settled && !b.cancelled)
      ? `<button class="bet-cashout" onclick="cashOutBet('${b.id}')">${icon('close', 11)}Cerrar apuesta (devolver ${b.stake} fichas)</button>`
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
  const COUNT_MARKETS = [
    ['atajadas', 'Atajadas'], ['faltas', 'Faltas cometidas'],
    ['remates', 'Remates'], ['remates_arco', 'Remates al arco'],
    ['gol', 'Goles'], ['asistencia', 'Asistencias'],
  ];
  let html = '';
  for (const playerName of orderedPlayerNames(match.playerProps)) {
    const props = match.playerProps[playerName];
    html += `<div class="stat-player"><div class="stat-player-name">${playerName}</div><div class="stat-grid">`;
    for (const [market, label] of COUNT_MARKETS) {
      if (props[market] === undefined) continue;
      html += `<div><label>${label}</label><input type="number" min="0" class="statInput" data-player="${playerName}" data-market="${market}" placeholder="0"></div>`;
    }
    html += `</div><div class="stat-checks">`;
    if (props.amarilla !== undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="amarilla">Amarilla</label>`;
    if (props.roja !== undefined) html += `<label><input type="checkbox" class="statCheck" data-player="${playerName}" data-market="roja">Roja</label>`;
    html += `</div><label class="dnp-row"><input type="checkbox" class="statDidNotPlay" data-player="${playerName}">No jugó este partido</label></div>`;
  }
  container.innerHTML = html;
}

function renderAdmin() {
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
}

function renderAll(skipAdmin) {
  try {
    document.getElementById('playerNameLbl').textContent = ME || '—';
    document.getElementById('chipCount').textContent = ME ? Math.round(myBalance()) : 0;
    renderMatches();
    renderMyBets();
    renderRanking();
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
  // red de contención por si el socket se corta: refresco periódico igual.
  setInterval(() => refreshFromServer(true), 20000);
}

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
    } catch (e) {
      TOKEN = null;
      localStorage.removeItem('lb_token');
      localStorage.removeItem('lb_name');
      showGate();
    }
  } else {
    showGate();
  }

  const adminToken = localStorage.getItem('lb_admin_token');
  if (adminToken) {
    ADMIN_TOKEN = adminToken;
    isAdmin = true;
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminContent').style.display = 'block';
    renderAdmin();
  }

  connectSocket();
})();
