// "Partidos jugados": un cuaderno TOTALMENTE APARTE de "Por rival"
// (leal_results). No comparten datos ni se sincronizan entre sí a propósito
// (el mismo partido real puede estar cargado en los dos lados, no pasa nada);
// acá se guarda resultado + goleadores + la formación dibujada (titulares,
// cambios, amarillas, rojas, figura del partido). La LECTURA es para todos;
// para escribir hace falta el mismo permiso que "Por rival"
// (users.can_log_leal_history) — el admin decide quién puede cargar.
const express = require('express');
const { pool, uid } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { broadcastStateUpdate } = require('../realtime');

const router = express.Router();

const MAX_OPPONENT_LEN = 60;
const MAX_PLAYED_ON_LEN = 40;
const MAX_SCORER_NAME_LEN = 60;
const MAX_SCORERS = 30;
const MAX_NAME_LEN = 40;
const VALID_FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '3-4-3', '5-3-2'];

async function requireLealHistoryAccess(req, res, next) {
  const { rows } = await pool.query('SELECT can_log_leal_history FROM users WHERE name=$1', [req.userName]);
  if (rows.length === 0 || !rows[0].can_log_leal_history) {
    return res.status(403).json({ error: 'No tenés permiso para cargar partidos. Pedile a un admin que te habilite.' });
  }
  next();
}
function cleanName(v) { return String(v || '').trim().slice(0, MAX_NAME_LEN); }
function parseScorers(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const entry of input.slice(0, MAX_SCORERS)) {
    const name = String((entry && entry.name) || '').trim().slice(0, MAX_SCORER_NAME_LEN);
    const goals = parseInt(entry && entry.goals, 10);
    if (!name || !Number.isInteger(goals) || goals < 1) continue;
    out.push({ name, goals });
  }
  return out;
}
// Cambios: solo "sale" / "entra" (sin minuto, a pedido). Cada jugador titular
// es {name, number}: el dorsal se muestra en la cancha en vez de iniciales.
function cleanNumber(v) {
  const s = String(v || '').trim().slice(0, 3);
  return /^[0-9]{1,3}$/.test(s) ? s : '';
}
function parseLineup(input) {
  if (!input || typeof input !== 'object') return null;
  const formation = VALID_FORMATIONS.includes(input.formation) ? input.formation : '4-4-2';
  const playersRaw = Array.isArray(input.players) ? input.players.slice(0, 11) : [];
  const players = [];
  for (let i = 0; i < 11; i++) {
    const p = playersRaw[i];
    players.push({ name: cleanName(p && p.name), number: cleanNumber(p && p.number) });
  }
  const subs = (Array.isArray(input.subs) ? input.subs.slice(0, 20) : [])
    .map((sub) => ({ out: cleanName(sub && sub.out), in: cleanName(sub && sub.in) }))
    .filter((sub) => sub.out || sub.in);
  const yellows = (Array.isArray(input.yellows) ? input.yellows.slice(0, 30) : []).map(cleanName).filter(Boolean);
  const reds = (Array.isArray(input.reds) ? input.reds.slice(0, 30) : []).map(cleanName).filter(Boolean);
  const figura = cleanName(input.figura);
  const captainIndexNum = parseInt(input.captainIndex, 10);
  const captainIndex = Number.isInteger(captainIndexNum) && captainIndexNum >= 0 && captainIndexNum <= 10 ? captainIndexNum : null;
  return { formation, players, subs, yellows, reds, figura, captainIndex };
}

router.post('/', requireAuth, requireLealHistoryAccess, async (req, res) => {
  const opponent = String(req.body.opponent || '').trim().slice(0, MAX_OPPONENT_LEN);
  const lealGoals = parseInt(req.body.lealGoals, 10);
  const opponentGoals = parseInt(req.body.opponentGoals, 10);
  const scorers = parseScorers(req.body.scorers);
  const playedOn = String(req.body.playedOn || '').trim().slice(0, MAX_PLAYED_ON_LEN);

  if (!opponent) return res.status(400).json({ error: 'Poné contra qué equipo jugó Leal' });
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    return res.status(400).json({ error: 'Cargá un marcador válido' });
  }

  const id = uid();
  await pool.query(
    `INSERT INTO leal_matches_played (id, opponent, leal_goals, opponent_goals, scorers_detail, played_on, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, opponent, lealGoals, opponentGoals, JSON.stringify(scorers), playedOn || null, req.userName, Date.now()]
  );
  broadcastStateUpdate();
  res.json({ ok: true, id });
});

router.put('/:id', requireAdmin, async (req, res) => {
  const opponent = String(req.body.opponent || '').trim().slice(0, MAX_OPPONENT_LEN);
  const lealGoals = parseInt(req.body.lealGoals, 10);
  const opponentGoals = parseInt(req.body.opponentGoals, 10);
  const scorers = parseScorers(req.body.scorers);
  const playedOn = String(req.body.playedOn || '').trim().slice(0, MAX_PLAYED_ON_LEN);

  if (!opponent) return res.status(400).json({ error: 'Poné contra qué equipo jugó Leal' });
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    return res.status(400).json({ error: 'Cargá un marcador válido' });
  }

  const { rows } = await pool.query(
    `UPDATE leal_matches_played SET opponent=$1, leal_goals=$2, opponent_goals=$3, scorers_detail=$4, played_on=$5
     WHERE id=$6 RETURNING id`,
    [opponent, lealGoals, opponentGoals, JSON.stringify(scorers), playedOn || null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'No se encontró ese partido' });
  broadcastStateUpdate();
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM leal_matches_played WHERE id=$1', [req.params.id]);
  broadcastStateUpdate();
  res.json({ ok: true });
});

router.put('/:id/lineup', requireAuth, requireLealHistoryAccess, async (req, res) => {
  const lineup = parseLineup(req.body.lineup);
  if (!lineup) return res.status(400).json({ error: 'Formación inválida' });
  const { rows } = await pool.query(
    'UPDATE leal_matches_played SET lineup=$1 WHERE id=$2 RETURNING id',
    [JSON.stringify(lineup), req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'No se encontró ese partido' });
  broadcastStateUpdate();
  res.json({ ok: true });
});

module.exports = router;
