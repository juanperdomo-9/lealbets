const { pool } = require('./db');
const { LEAL_TEAM_NAME, LEAL_PROPS } = require('./lealProps');
const { buildDynamicLealProps } = require('./oddsEngine');

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

async function getPublicState() {
  const [teams, matches, ranking] = await Promise.all([loadTeams(), loadMatches(), loadRanking()]);
  return { teams, matches, ranking };
}

module.exports = {
  rowToMatch,
  loadTeams,
  loadMatches,
  loadRanking,
  loadPlayerHistoryMap,
  syncLealProps,
  getPublicState,
};
