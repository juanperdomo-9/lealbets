// Historial de Leal FC (footer, visible para todos los usuarios logueados): un
// cuaderno de resultados contra cualquier rival, esté o no cargado como equipo
// "oficial" del torneo. No toca la tabla matches ni el motor de cuotas/apuestas:
// es un registro histórico aparte. La LECTURA es para todos; para CARGAR una fila
// hace falta que el admin le haya dado permiso a ese usuario puntual
// (users.can_log_leal_history), así el admin controla quién puede escribir ahí.
const express = require('express');
const { pool, uid } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { broadcastStateUpdate } = require('../realtime');

const router = express.Router();

const MAX_OPPONENT_LEN = 60;
const MAX_PLAYED_ON_LEN = 40;
const MAX_SCORER_NAME_LEN = 60;
const MAX_SCORERS = 30; // tope generoso, solo para no permitir un array gigante

async function requireLealHistoryAccess(req, res, next) {
  const { rows } = await pool.query('SELECT can_log_leal_history FROM users WHERE name=$1', [req.userName]);
  if (rows.length === 0 || !rows[0].can_log_leal_history) {
    return res.status(403).json({ error: 'No tenés permiso para cargar resultados. Pedile a un admin que te habilite.' });
  }
  next();
}

// Los goleadores se cargan estructurados (nombre + goles), no como texto libre:
// así la tabla de goleadores se puede sumar de verdad en vez de tener que
// re-interpretar un texto escrito a mano.
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
    `INSERT INTO leal_results (id, opponent, leal_goals, opponent_goals, scorers_detail, played_on, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, opponent, lealGoals, opponentGoals, JSON.stringify(scorers), playedOn || null, req.userName, Date.now()]
  );
  broadcastStateUpdate();
  res.json({ ok: true, id });
});

// Editar o borrar una fila del historial es una acción de moderación (por si
// alguien carga algo mal o hace una broma pesada); se deja solo para admin,
// como el resto de las acciones "destructivas" de la app.
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
    `UPDATE leal_results SET opponent=$1, leal_goals=$2, opponent_goals=$3, scorers_detail=$4, played_on=$5
     WHERE id=$6 RETURNING id`,
    [opponent, lealGoals, opponentGoals, JSON.stringify(scorers), playedOn || null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'No se encontró ese resultado' });
  broadcastStateUpdate();
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM leal_results WHERE id=$1', [req.params.id]);
  broadcastStateUpdate();
  res.json({ ok: true });
});

// Formación dibujada de un partido: titulares por posición, cambios, amarillas
// y rojas. Es un dato aparte del resultado/goleadores, y lo carga quien tenga
// el mismo permiso de historial (no hace falta ser admin puntualmente para
// esto, es la misma persona de confianza que ya puede cargar resultados).
const VALID_FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '3-4-3', '5-3-2'];
const MAX_NAME_LEN = 40;
function cleanName(v) { return String(v || '').trim().slice(0, MAX_NAME_LEN); }
function parseLineup(input) {
  if (!input || typeof input !== 'object') return null;
  const formation = VALID_FORMATIONS.includes(input.formation) ? input.formation : '4-4-2';
  const players = Array.isArray(input.players) ? input.players.slice(0, 11).map(cleanName) : [];
  while (players.length < 11) players.push('');
  const subs = (Array.isArray(input.subs) ? input.subs.slice(0, 20) : [])
    .map((sub) => ({
      out: cleanName(sub && sub.out),
      in: cleanName(sub && sub.in),
      minute: Number.isInteger(parseInt(sub && sub.minute, 10)) ? Math.max(0, Math.min(120, parseInt(sub.minute, 10))) : null,
    }))
    .filter((sub) => sub.out || sub.in);
  const yellows = (Array.isArray(input.yellows) ? input.yellows.slice(0, 30) : []).map(cleanName).filter(Boolean);
  const reds = (Array.isArray(input.reds) ? input.reds.slice(0, 30) : []).map(cleanName).filter(Boolean);
  const figura = cleanName(input.figura);
  return { formation, players, subs, yellows, reds, figura };
}

router.put('/:id/lineup', requireAuth, requireLealHistoryAccess, async (req, res) => {
  const lineup = parseLineup(req.body.lineup);
  if (!lineup) return res.status(400).json({ error: 'Formación inválida' });
  const { rows } = await pool.query(
    'UPDATE leal_results SET lineup=$1 WHERE id=$2 RETURNING id',
    [JSON.stringify(lineup), req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'No se encontró ese partido' });
  broadcastStateUpdate();
  res.json({ ok: true });
});

module.exports = router;
