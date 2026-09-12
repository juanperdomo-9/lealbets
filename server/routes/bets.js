const express = require('express');
const { pool, uid, applyBalanceDelta } = require('../db');
const { requireAuth } = require('../auth');
const { oddsFor } = require('../oddsEngine');
const { broadcastStateUpdate } = require('../realtime');
const { rowToMatch } = require('../state');

const router = express.Router();

function rowToBet(r) {
  return {
    id: r.id,
    user: r.user_name,
    stake: Number(r.stake),
    combinedOdds: Number(r.combined_odds),
    legs: r.legs,
    settled: r.settled,
    won: r.won,
    voided: r.voided,
    cancelled: r.cancelled,
    effectiveOdds: r.effective_odds === null || r.effective_odds === undefined ? null : Number(r.effective_odds),
    placedAt: Number(r.placed_at),
  };
}

router.get('/mine', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM bets WHERE user_name=$1 ORDER BY placed_at DESC',
    [req.userName]
  );
  res.json(rows.map(rowToBet));
});

// Confirmar una apuesta (simple o combinada). El servidor recalcula las cuotas
// vigentes de cada selección: nunca confía en la cuota que mande el cliente.
router.post('/', requireAuth, async (req, res) => {
  const legsInput = Array.isArray(req.body.legs) ? req.body.legs : [];
  const stake = Number(req.body.stake);
  if (legsInput.length === 0) return res.status(400).json({ error: 'Elegí al menos una selección' });
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT * FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (userRes.rows.length === 0) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
    const user = userRes.rows[0];
    if (stake > Number(user.balance)) {
      throw Object.assign(new Error('No tenés esa cantidad de fichas'), { status: 400 });
    }

    const legs = [];
    for (const l of legsInput) {
      const matchId = String(l.matchId || '');
      const pick = String(l.pick || '');
      const { rows: mrows } = await client.query('SELECT * FROM matches WHERE id=$1', [matchId]);
      if (mrows.length === 0) throw Object.assign(new Error('Ese partido ya no existe'), { status: 400 });
      const match = rowToMatch(mrows[0]);
      if (match.status !== 'upcoming') {
        throw Object.assign(new Error('Ese partido ya no admite apuestas'), { status: 400 });
      }
      const odds = oddsFor(match, pick);
      if (odds === null || odds === undefined) {
        throw Object.assign(new Error('Selección inválida'), { status: 400 });
      }
      legs.push({ matchId, pick, oddsAtBet: odds, result: null });
    }
    const combinedOdds = Math.round(legs.reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;
    const id = uid();
    const placedAt = Date.now();
    await client.query(
      `INSERT INTO bets (id, user_name, stake, combined_odds, legs, settled, won, voided, cancelled, placed_at)
       VALUES ($1,$2,$3,$4,$5,FALSE,FALSE,FALSE,FALSE,$6)`,
      [id, req.userName, stake, combinedOdds, JSON.stringify(legs), placedAt]
    );
    const wasReset = await applyBalanceDelta(client, req.userName, -stake);
    await client.query('COMMIT');

    broadcastStateUpdate();
    res.json({ id, user: req.userName, stake, combinedOdds, legs, settled: false, won: false, voided: false, cancelled: false, placedAt, wasReset });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// Cerrar apuesta (cash out simple): mientras sigue pendiente, se devuelve el monto exacto.
router.post('/:id/cashout', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bets WHERE id=$1 FOR UPDATE', [req.params.id]);
    const bet = rows[0];
    if (!bet || bet.user_name !== req.userName) {
      throw Object.assign(new Error('Apuesta no encontrada'), { status: 404 });
    }
    if (bet.settled || bet.cancelled) {
      throw Object.assign(new Error('Esa apuesta ya no se puede cerrar'), { status: 400 });
    }
    await client.query('UPDATE bets SET cancelled=TRUE WHERE id=$1', [bet.id]);
    await applyBalanceDelta(client, req.userName, Number(bet.stake));
    await client.query('COMMIT');
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
