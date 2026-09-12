const express = require('express');
const { pool, uid, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { oddsFor } = require('../oddsEngine');
const { MAX_SUPERBOOST_STAKE } = require('../constants');
const { isMarketClosed } = require('../marketHours');
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
    superBoostId: r.super_boost_id || null,
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
  if (await isMarketClosed()) {
    return res.status(403).json({ error: 'Mercado cerrado hasta que se carguen los resultados del fin de semana' });
  }
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
    let combinedOdds = Math.round(legs.reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;

    // superaumento: si el combo enviado es exactamente el que armó el admin, se paga
    // a la cuota fija que puso (nunca se confía en una cuota que mande el cliente).
    let superBoostId = null;
    const requestedBoostId = req.body.superBoostId ? String(req.body.superBoostId) : null;
    if (requestedBoostId) {
      const { rows: brows } = await client.query(
        `SELECT sb.*, m.status AS match_status FROM super_boosts sb
         JOIN matches m ON m.id = sb.match_id WHERE sb.id=$1 AND sb.active=TRUE`,
        [requestedBoostId]
      );
      const boost = brows[0];
      if (boost && boost.match_status === 'upcoming') {
        const submitted = new Set(legs.map((l) => l.matchId + '::' + l.pick));
        const boostSet = new Set(boost.legs.map((pick) => boost.match_id + '::' + pick));
        const sameSize = submitted.size === boostSet.size;
        const allMatch = sameSize && [...boostSet].every((k) => submitted.has(k));
        if (allMatch) {
          const { rows: usedRows } = await client.query(
            'SELECT 1 FROM bets WHERE user_name=$1 AND super_boost_id=$2 LIMIT 1',
            [req.userName, boost.id]
          );
          if (usedRows.length > 0) {
            throw Object.assign(new Error('Ya usaste este superaumento'), { status: 400 });
          }
          if (stake > MAX_SUPERBOOST_STAKE) {
            throw Object.assign(new Error(`El superaumento tiene un tope de ${MAX_SUPERBOOST_STAKE} fichas`), { status: 400 });
          }
          combinedOdds = Number(boost.boosted_odds);
          superBoostId = boost.id;
        }
      }
    }

    const id = uid();
    const placedAt = Date.now();
    await client.query(
      `INSERT INTO bets (id, user_name, stake, combined_odds, legs, settled, won, voided, cancelled, super_boost_id, placed_at)
       VALUES ($1,$2,$3,$4,$5,FALSE,FALSE,FALSE,FALSE,$6,$7)`,
      [id, req.userName, stake, combinedOdds, JSON.stringify(legs), superBoostId, placedAt]
    );
    await applyBalanceDelta(client, req.userName, -stake);
    // esta apuesta recién insertada ya cuenta como pendiente, así que esto no
    // restablece nada todavía aunque el saldo haya quedado en 0: se espera a
    // que la combinada se resuelva (ver liquidación en admin.js).
    const wasReset = await resetIfDepletedAndNoPendingBets(client, req.userName);
    await client.query('COMMIT');

    broadcastStateUpdate();
    res.json({
      id, user: req.userName, stake, combinedOdds, legs, settled: false, won: false, voided: false, cancelled: false,
      superBoostId, boostApplied: !!superBoostId, placedAt, wasReset,
    });
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
  if (await isMarketClosed()) {
    return res.status(403).json({ error: 'Mercado cerrado hasta que se carguen los resultados del fin de semana' });
  }
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
    await resetIfDepletedAndNoPendingBets(client, req.userName);
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
