const { pool } = require('./db');
const { LEAL_TEAM_NAME, LEAL_PROPS, LEAL_PLAYER_ORDER } = require('./lealProps');
const { buildDynamicLealProps, pickLabel, oddsFor } = require('./oddsEngine');
const { MAX_SUPERBOOST_STAKE } = require('./constants');
const { isMarketClosed } = require('./marketHours');

function rowToMatch(r) {
  return {
    id: r.id,
    homeId: r.home_id,
    awayId: r.away_id,
    homeName: r.home_name,
    awayName: r.away_name,
    odds: r.odds,
    playerProps: r.player_props || null,
    status: r.status,
    result: r.result || null,
    createdAt: Number(r.created_at),
  };
}

async function loadTeams(client = pool) {
  const { rows } = await client.query('SELECT id, name, rating FROM teams ORDER BY rating DESC');
  return rows;
}

async function loadMatches(client = pool) {
  const { rows } = await client.query('SELECT * FROM matches ORDER BY created_at DESC');
  return rows.map(rowToMatch);
}

async function loadRanking(client = pool) {
  const { rows } = await client.query(
    'SELECT name, balance FROM users ORDER BY balance DESC, name ASC'
  );
  return rows.map((r) => ({ name: r.name, balance: Number(r.balance) }));
}

// { [playerName]: [ {atajadas, faltas, remates, remates_arco, gol, asistencia, amarilla, roja}, ... ] }
async function loadPlayerHistoryMap(client = pool) {
  const { rows } = await client.query(
    'SELECT player_name, stats FROM player_history ORDER BY created_at ASC'
  );
  const map = {};
  for (const r of rows) {
    map[r.player_name] = map[r.player_name] || [];
    map[r.player_name].push(r.stats);
  }
  return map;
}

// Recalcula las cuotas de jugador del próximo partido de Leal FC (si hay uno pendiente)
// en base a la lista base + historial real. Igual que syncLealProps() del prototipo.
async function syncLealProps(client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM matches WHERE status='upcoming' AND (home_name=$1 OR away_name=$1)
     ORDER BY created_at DESC LIMIT 1`,
    [LEAL_TEAM_NAME]
  );
  if (rows.length === 0) return;
  const match = rows[0];
  const history = await loadPlayerHistoryMap(client);
  const dynamicProps = buildDynamicLealProps(LEAL_PROPS, history);
  if (JSON.stringify(match.player_props) === JSON.stringify(dynamicProps)) return;
  await client.query('UPDATE matches SET player_props=$1 WHERE id=$2', [JSON.stringify(dynamicProps), match.id]);
}

// Superaumentos activos (banner promocional fijo arriba de los partidos): las cuotas y
// etiquetas de cada pata se recalculan siempre desde el partido actual (no se guardan
// duplicadas), así nunca quedan desactualizadas mientras el partido siga pendiente.
async function loadActiveSuperBoosts(client = pool) {
  const { rows } = await client.query(
    `SELECT sb.id, sb.match_id, sb.legs, sb.boosted_odds, sb.created_at,
            m.home_name, m.away_name, m.odds, m.player_props, m.status
     FROM super_boosts sb
     JOIN matches m ON m.id = sb.match_id
     WHERE sb.active = TRUE
     ORDER BY sb.created_at DESC`
  );
  return rows
    .filter((r) => r.status === 'upcoming')
    .map((r) => {
      const match = { id: r.match_id, homeName: r.home_name, awayName: r.away_name, odds: r.odds, playerProps: r.player_props };
      const legs = r.legs.map((pick) => ({ pick, label: pickLabel(pick, match), odds: oddsFor(match, pick) }));
      const naturalOdds = Math.round(legs.reduce((p, l) => p * (l.odds || 1), 1) * 100) / 100;
      return {
        id: r.id,
        matchId: r.match_id,
        homeName: r.home_name,
        awayName: r.away_name,
        legs,
        naturalOdds,
        boostedOdds: Number(r.boosted_odds),
        createdAt: Number(r.created_at),
      };
    });
}

async function getPublicState() {
  const [teams, matches, ranking, superBoosts, marketClosed] = await Promise.all([
    loadTeams(), loadMatches(), loadRanking(), loadActiveSuperBoosts(), isMarketClosed(),
  ]);
  return {
    teams, matches, ranking, lealPlayerOrder: LEAL_PLAYER_ORDER, superBoosts,
    maxSuperBoostStake: MAX_SUPERBOOST_STAKE, marketClosed,
  };
}

module.exports = {
  rowToMatch,
  loadTeams,
  loadMatches,
  loadRanking,
  loadPlayerHistoryMap,
  syncLealProps,
  loadActiveSuperBoosts,
  getPublicState,
};
