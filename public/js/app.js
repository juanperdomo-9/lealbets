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
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}
function initials(name) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
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
    <div class="info">${CART.length} ${CART.length === 1 ? 'selección' : 'selecciones'}<small>cuota combinada ${combinedOdds}</small></div>
    <div class="toggle">${cartPanelOpen ? 'Cerrar' : 'Ver apuesta'}</div>
  </div>`;
  if (cartPanelOpen) {
    html += `<div class="cart-panel">`;
    CART.forEach((l, i) => {
      html += `<div class="cart-leg">
        <span>${l.matchLabel}<small>${l.label} · cuota ${l.odds}</small></span>
        <button class="remove" onclick="removeFromCart(${i})">✕</button>
      </div>`;
    });
    html += `<div class="slip" style="border-top:none;padding-top:12px;">
      <label>Monto a apostar (fichas)</label>
      <div class="slip-row">
        <input id="comboStake" type="number" min="1" placeholder="Fichas" oninput="updateComboPreview()">
        <button class="confirm" onclick="confirmCombo()">Confirmar</button>
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
  let html = `<div class="market-label">Jugadores de LEAL</div>`;
  for (const playerName of orderedPlayerNames(m.playerProps)) {
    const props = m.playerProps[playerName];
    html += `<div class="player-props"><div class="player-props-name">${playerName}</div>`;
    for (const [market, label] of THRESHOLD_MARKETS) {
      if (!props[market]) continue;
      const thresholds = Object.keys(props[market]);
      html += `<div class="prop-sublabel">${label}</div><div class="odds-row" style="grid-template-columns:repeat(${thresholds.length},1fr);">`;
      for (const t of thresholds) {
        const pick = `prop|${playerName}|${market}|${t}`;
        html += `<div class="odds-btn${sel(m, pick)}" onclick="toggleLeg('${m.id}','${pick}')"><span class="lbl">${t}+</span><span class="val">${props[market][t]}</span></div>`;
      }
      html += `</div>`;
    }
    const activeBinary = BINARY_MARKETS.filter(([market]) => props[market] !== undefined);
    if (activeBinary.length) {
      html += `<div class="odds-row" style="grid-template-columns:repeat(${activeBinary.length},1fr);margin-top:6px;">`;
      for (const [market, label] of activeBinary) {
        const pick = `prop|${playerName}|${market}`;
        html += `<div class="odds-btn${sel(m, pick)}" onclick="toggleLeg('${m.id}','${pick}')"><span class="lbl">${label}</span><span class="val">${props[market]}</span></div>`;
      }
      html += `</div>`;
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
    list.innerHTML = '<div class="empty">Todavía no hay partidos cargados.<br>Andá a la pestaña Equipos para programar el primero.</div>';
    return;
  }
  let html = '';
  for (const m of upcoming) {
    const isOpen = expandedMatches.has(m.id);
    html += `<div class="ticket">
      <div class="ticket-meta"><span>Próximo</span><span>#${m.id.slice(-4)}</span></div>
      <div class="ticket-teams" onclick="toggleMatchExpand('${m.id}')" style="cursor:pointer;">
        <div class="team-chip"><span class="crest">${initials(m.homeName)}</span><span class="name">${m.homeName}</span></div>
        <span class="vs">vs</span>
        <div class="team-chip"><span class="crest">${initials(m.awayName)}</span><span class="name">${m.awayName}</span></div>
      </div>
      <div class="expand-hint" onclick="toggleMatchExpand('${m.id}')">${isOpen ? 'Ocultar apuestas ▴' : 'Ver apuestas de este partido ▾'}</div>`;

    if (isOpen) {
      html += `
      <div class="market-label">Resultado</div>
      <div class="odds-row">
        <div class="odds-btn${sel(m, 'home')}" onclick="toggleLeg('${m.id}','home')"><span class="lbl">${m.homeName}</span><span class="val">${m.odds.home}</span></div>
        <div class="odds-btn${sel(m, 'draw')}" onclick="toggleLeg('${m.id}','draw')"><span class="lbl">Empate</span><span class="val">${m.odds.draw}</span></div>
        <div class="odds-btn${sel(m, 'away')}" onclick="toggleLeg('${m.id}','away')"><span class="lbl">${m.awayName}</span><span class="val">${m.odds.away}</span></div>
      </div>

      <div class="market-label">Doble oportunidad</div>
      <div class="odds-row">
        <div class="odds-btn${sel(m, 'dc_1x')}" onclick="toggleLeg('${m.id}','dc_1x')"><span class="lbl">${m.homeName} o X</span><span class="val">${m.odds.dc.oneX}</span></div>
        <div class="odds-btn${sel(m, 'dc_12')}" onclick="toggleLeg('${m.id}','dc_12')"><span class="lbl">1 o 2</span><span class="val">${m.odds.dc.oneTwo}</span></div>
        <div class="odds-btn${sel(m, 'dc_x2')}" onclick="toggleLeg('${m.id}','dc_x2')"><span class="lbl">X o ${m.awayName}</span><span class="val">${m.odds.dc.xTwo}</span></div>
      </div>

      <div class="market-label">Goles (línea ${m.odds.goals.line})</div>
      <div class="odds-row" style="grid-template-columns:1fr 1fr;">
        <div class="odds-btn${sel(m, 'goals_over')}" onclick="toggleLeg('${m.id}','goals_over')"><span class="lbl">Más de ${m.odds.goals.line}</span><span class="val">${m.odds.goals.over}</span></div>
        <div class="odds-btn${sel(m, 'goals_under')}" onclick="toggleLeg('${m.id}','goals_under')"><span class="lbl">Menos de ${m.odds.goals.line}</span><span class="val">${m.odds.goals.under}</span></div>
      </div>

      <div class="market-label">Ambos equipos anotan</div>
      <div class="odds-row" style="grid-template-columns:1fr 1fr;">
        <div class="odds-btn${sel(m, 'btts_yes')}" onclick="toggleLeg('${m.id}','btts_yes')"><span class="lbl">Sí</span><span class="val">${m.odds.btts.yes}</span></div>
        <div class="odds-btn${sel(m, 'btts_no')}" onclick="toggleLeg('${m.id}','btts_no')"><span class="lbl">No</span><span class="val">${m.odds.btts.no}</span></div>
      </div>${m.playerProps ? renderPlayerPropsBlock(m) : ''}`;
    }
    html += `</div>`;
  }
  for (const m of finished) {
    const r = m.result;
    html += `<div class="ticket" style="opacity:0.75;">
      <div class="ticket-meta"><span>Finalizado</span><span>#${m.id.slice(-4)}</span></div>
      <div class="ticket-teams">
        <div class="team-chip"><span class="crest">${initials(m.homeName)}</span><span class="name">${m.homeName}</span></div>
        <span class="vs">vs</span>
        <div class="team-chip"><span class="crest">${initials(m.awayName)}</span><span class="name">${m.awayName}</span></div>
      </div>
      <div class="ticket-result">${r.homeGoals} - ${r.awayGoals}</div>
      <div class="ticket-status">1x2: ${m.odds.home} / ${m.odds.draw} / ${m.odds.away} · Goles ${m.odds.goals.line}: ${m.odds.goals.over} / ${m.odds.goals.under} · Ambos anotan: ${m.odds.btts.yes} / ${m.odds.btts.no}</div>
      ${isAdmin ? `<div style="text-align:center;margin-top:10px;">
        <button onclick="reopenMatch('${m.id}')" style="background:none;border:1px solid var(--line);color:var(--chalk-dim);padding:7px 14px;font-family:'Work Sans',sans-serif;font-size:12px;cursor:pointer;">Reabrir partido (corregir resultado)</button>
      </div>` : ''}
    </div>`;
  }
  list.innerHTML = html;
}

function renderMyBets() {
  const list = document.getElementById('myBetsList');
  if (!ME) { list.innerHTML = '<div class="empty">Entrá con tu usuario para ver tus apuestas.</div>'; return; }
  const mine = MY_BETS.slice().sort((a, b) => b.placedAt - a.placedAt);
  if (mine.length === 0) {
    list.innerHTML = '<div class="empty">Todavía no hiciste ninguna apuesta.</div>';
    return;
  }
  list.innerHTML = mine.map((b) => {
    const legsDesc = b.legs.map((l) => {
      const m = STATE.matches.find((mm) => mm.id === l.matchId);
      const label = m ? `${pickLabel(l.pick, m)} (${m.homeName} vs ${m.awayName})` : pickLabel(l.pick, { homeName: '?', awayName: '?', odds: { goals: { line: 2.5 } } });
      return l.result === 'void' ? `${label} — anulada` : label;
    }).join(' + ');
    const payoutOdds = b.effectiveOdds || b.combinedOdds;
    const tag = b.cancelled ? `<span class="bet-tag pending">Cancelada</span>` :
      b.voided ? `<span class="bet-tag pending">Anulada (devuelto)</span>` :
      !b.settled ? `<span class="bet-tag pending">Pendiente</span>` :
      b.won ? `<span class="bet-tag win">+${Math.round(b.stake * payoutOdds)}</span>` :
      `<span class="bet-tag lose">-${b.stake}</span>`;
    const comboTag = b.legs.length > 1 ? 'Combinada · ' : '';
    const potentialOdds = Math.round(b.legs.filter((l) => l.result !== 'void').reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;
    const potentialText = (!b.settled && !b.cancelled) ? ` · si ganás, cobrás ${Math.round(b.stake * potentialOdds)} fichas` : '';
    const cashOutBtn = (!b.settled && !b.cancelled)
      ? `<button onclick="cashOutBet('${b.id}')" style="margin-top:8px;background:none;border:1px solid var(--line);color:var(--chalk-dim);padding:6px 12px;font-family:'Work Sans',sans-serif;font-size:12px;cursor:pointer;">Cerrar apuesta (devolver ${b.stake} fichas)</button>`
      : '';
    return `<div class="bet-row" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
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
  body.innerHTML = rows.map((r, i) => `<tr>
    <td class="pos">${i + 1}</td>
    <td>${r.name}${r.name === ME ? ' (vos)' : ''}</td>
    <td class="bal">${Math.round(r.balance)}</td>
  </tr>`).join('');
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
    html += `</div><label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--chalk-dim);margin-top:8px;"><input type="checkbox" class="statDidNotPlay" data-player="${playerName}">No jugó este partido</label></div>`;
  }
  container.innerHTML = html;
}

function renderAdmin() {
  const teamsList = document.getElementById('teamsList');
  teamsList.innerHTML = STATE.teams.length
    ? STATE.teams.slice().sort((a, b) => b.rating - a.rating).map((t) =>
        `<div class="team-line"><span class="crest">${initials(t.name)}</span><span class="name">${t.name}</span><span class="rating">${t.rating}</span></div>`
      ).join('')
    : '<div class="empty" style="padding:16px;">Agregá al menos dos equipos.</div>';

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
      document.getElementById('nameInput').value = name;
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
