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
const MAX_SCORERS_LEN = 300;
const MAX_PLAYED_ON_LEN = 40;

async function requireLealHistoryAccess(req, res, next) {
  const { rows } = await pool.query('SELECT can_log_leal_history FROM users WHERE name=$1', [req.userName]);
  if (rows.length === 0 || !rows[0].can_log_leal_history) {
    return res.status(403).json({ error: 'No tenés permiso para cargar resultados. Pedile a un admin que te habilite.' });
  }
  next();
}

router.post('/', requireAuth, requireLealHistoryAccess, async (req, res) => {
  const opponent = String(req.body.opponent || '').trim().slice(0, MAX_OPPONENT_LEN);
  const lealGoals = parseInt(req.body.lealGoals, 10);
  const opponentGoals = parseInt(req.body.opponentGoals, 10);
  const scorers = String(req.body.scorers || '').trim().slice(0, MAX_SCORERS_LEN);
  const playedOn = String(req.body.playedOn || '').trim().slice(0, MAX_PLAYED_ON_LEN);

  if (!opponent) return res.status(400).json({ error: 'Poné contra qué equipo jugó Leal' });
  if (!Number.isInteger(lealGoals) || lealGoals < 0 || !Number.isInteger(opponentGoals) || opponentGoals < 0) {
    return res.status(400).json({ error: 'Cargá un marcador válido' });
  }

  const id = uid();
  await pool.query(
    `INSERT INTO leal_results (id, opponent, leal_goals, opponent_goals, scorers, played_on, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, opponent, lealGoals, opponentGoals, scorers || null, playedOn || null, req.userName, Date.now()]
  );
  broadcastStateUpdate();
  res.json({ ok: true, id });
});

// Borrar una fila del historial es una acción de moderación (por si alguien carga
// algo mal o hace una broma pesada); se deja solo para admin, como el resto de las
// acciones "destructivas" de la app.
router.delete('/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM leal_results WHERE id=$1', [req.params.id]);
  broadcastStateUpdate();
  res.json({ ok: true });
});

module.exports = router;
