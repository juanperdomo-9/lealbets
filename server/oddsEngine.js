// Motor de cuotas: mismo comportamiento que el prototipo (leal-bets.html),
// portado tal cual para que las fórmulas no cambien.

const K_FACTOR = 24;
const HOME_ADV = 60;
const OVERROUND = 1.08; // margen de la "casa"
const PRIOR_WEIGHT = 3; // la lista base "pesa" como si fueran 3 partidos de referencia

function expectedHome(rHome, rAway) {
  return 1 / (1 + Math.pow(10, (rAway - (rHome + HOME_ADV)) / 400));
}

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPmf(k, lambda) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function toOdds(p) {
  return Math.max(1.05, Math.round((1 / p / OVERROUND) * 100) / 100);
}

function computeGoalsMarket(rHome, rAway) {
  const GOALS_LINE = 2.5;
  let expectedTotal = 2.6 + (rHome + rAway - 3000) / 500;
  expectedTotal = Math.min(4.6, Math.max(1.4, expectedTotal));
  const pUnder =
    poissonPmf(0, expectedTotal) + poissonPmf(1, expectedTotal) + poissonPmf(2, expectedTotal);
  const pOver = 1 - pUnder;
  return { line: GOALS_LINE, expectedTotal, over: toOdds(pOver), under: toOdds(pUnder) };
}

function computeBttsMarket(expectedTotal, eHome) {
  const shareHome = Math.min(0.75, Math.max(0.25, 0.5 + (eHome - 0.5) * 0.6));
  const lambdaHome = Math.max(0.3, expectedTotal * shareHome);
  const lambdaAway = Math.max(0.3, expectedTotal * (1 - shareHome));
  const pHomeScores = 1 - poissonPmf(0, lambdaHome);
  const pAwayScores = 1 - poissonPmf(0, lambdaAway);
  const pYes = pHomeScores * pAwayScores;
  return { yes: toOdds(pYes), no: toOdds(1 - pYes) };
}

function computeOdds(rHome, rAway) {
  const eHome = expectedHome(rHome, rAway);
  const closeness = 1 - Math.abs(eHome - 0.5) * 2; // 1 = parejo, 0 = muy dispar
  const pDraw = 0.22 + closeness * 0.14;
  const pHome = eHome * (1 - pDraw);
  const pAway = (1 - eHome) * (1 - pDraw);
  const dc = {
    oneX: toOdds(pHome + pDraw),
    oneTwo: toOdds(pHome + pAway),
    xTwo: toOdds(pDraw + pAway),
  };
  const goals = computeGoalsMarket(rHome, rAway);
  const btts = computeBttsMarket(goals.expectedTotal, eHome);
  return { home: toOdds(pHome), draw: toOdds(pDraw), away: toOdds(pAway), dc, goals, btts };
}

function updateElo(rHome, rAway, outcome) {
  // outcome: 1 = gana home, 0.5 = empate, 0 = gana away
  const eHome = expectedHome(rHome, rAway);
  const newHome = Math.round(rHome + K_FACTOR * (outcome - eHome));
  const newAway = Math.round(rAway + K_FACTOR * (1 - outcome - (1 - eHome)));
  return { newHome, newAway };
}

const impliedProb = (odds) => 1 / (odds * OVERROUND);

// baseline: LEAL_PROPS; history: { [playerName]: [ {atajadas, faltas, remates, remates_arco, gol, asistencia, amarilla, roja}, ... ] }
function buildDynamicLealProps(baseline, history) {
  const result = {};
  for (const playerName in baseline) {
    const base = baseline[playerName];
    const hist = history[playerName] || [];
    const n = hist.length;
    const out = {};
    for (const market of ['atajadas', 'faltas', 'remates', 'remates_arco']) {
      if (!base[market]) continue;
      out[market] = {};
      for (const k in base[market]) {
        const kNum = Number(k);
        const priorProb = impliedProb(base[market][k]);
        const successCount = hist.filter((h) => (h[market] || 0) >= kNum).length;
        const prob = (priorProb * PRIOR_WEIGHT + successCount) / (PRIOR_WEIGHT + n);
        out[market][k] = toOdds(prob);
      }
    }
    for (const market of ['gol', 'asistencia', 'amarilla', 'roja']) {
      if (base[market] === undefined) continue;
      const priorProb = impliedProb(base[market]);
      let successCount = 0;
      if (market === 'gol') successCount = hist.filter((h) => (h.gol || 0) >= 1).length;
      else if (market === 'asistencia') successCount = hist.filter((h) => (h.asistencia || 0) >= 1).length;
      else if (market === 'amarilla') successCount = hist.filter((h) => !!h.amarilla).length;
      else if (market === 'roja') successCount = hist.filter((h) => !!h.roja).length;
      const prob = (priorProb * PRIOR_WEIGHT + successCount) / (PRIOR_WEIGHT + n);
      out[market] = toOdds(prob);
    }
    result[playerName] = out;
  }
  return result;
}

// ---------- picks: mismo vocabulario que el prototipo (home/draw/away/dc_1x/.../prop|Nombre|market|umbral) ----------
function parsePropPick(pick) {
  const [, playerName, market, threshold] = pick.split('|');
  return { playerName, market, threshold: threshold ? parseInt(threshold, 10) : null };
}

const PROP_MARKET_LABEL = {
  atajadas: 'atajadas',
  faltas: 'faltas cometidas',
  remates: 'remates',
  remates_arco: 'remates al arco',
  gol: 'gol',
  asistencia: 'asistencia',
  amarilla: 'tarjeta amarilla',
  roja: 'tarjeta roja',
};

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

// Cuota vigente de una selección para un partido dado (server-side, fuente de verdad).
function oddsFor(m, pick) {
  if (pick.startsWith('prop|')) {
    const { playerName, market, threshold } = parsePropPick(pick);
    const props = m.playerProps && m.playerProps[playerName];
    if (!props || !props[market]) return null;
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

function evaluateBet(pick, result) {
  if (pick.startsWith('prop|')) {
    const { playerName, market, threshold } = parsePropPick(pick);
    const stats = result.playerStats && result.playerStats[playerName];
    if (!stats) return false;
    if (market === 'gol') return (stats.gol || 0) >= 1;
    if (market === 'asistencia') return (stats.asistencia || 0) >= 1;
    if (market === 'amarilla') return !!stats.amarilla;
    if (market === 'roja') return !!stats.roja;
    return (stats[market] || 0) >= threshold;
  }
  if (pick === 'home' || pick === 'draw' || pick === 'away') return pick === result.outcome;
  if (pick === 'dc_1x') return result.outcome === 'home' || result.outcome === 'draw';
  if (pick === 'dc_12') return result.outcome === 'home' || result.outcome === 'away';
  if (pick === 'dc_x2') return result.outcome === 'draw' || result.outcome === 'away';
  if (pick === 'goals_over') return result.totalGoals > 2.5;
  if (pick === 'goals_under') return result.totalGoals < 2.5;
  if (pick === 'btts_yes') return result.homeGoals > 0 && result.awayGoals > 0;
  if (pick === 'btts_no') return !(result.homeGoals > 0 && result.awayGoals > 0);
  return false;
}

module.exports = {
  OVERROUND,
  PRIOR_WEIGHT,
  computeOdds,
  computeGoalsMarket,
  computeBttsMarket,
  updateElo,
  buildDynamicLealProps,
  parsePropPick,
  pickLabel,
  oddsFor,
  evaluateBet,
};
