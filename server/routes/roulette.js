// Ruleta europea: juego individual, sin varios pasos — se elige qué apostar
// y se gira, el servidor sortea el número (nunca el cliente) y liquida todo
// en el momento. No hace falta guardar ninguna partida en curso.
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { validateBet, resolveSpin } = require('../roulette');

const router = express.Router();

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}

router.post('/spin', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  const betType = String(req.body.betType || '');
  const betValueRaw = req.body.betValue;
  let betValue;
  if (betValueRaw === null || betValueRaw === undefined) betValue = null;
  else if (Array.isArray(betValueRaw)) betValue = betValueRaw.map((v) => parseInt(v, 10)); // caballo/cuadro
  else betValue = parseInt(betValueRaw, 10);
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });
  if (!validateBet(betType, betValue)) return res.status(400).json({ error: 'Apuesta inválida' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (stake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -stake);

    const result = resolveSpin(betType, betValue, stake);
    if (result.payout > 0) await applyBalanceDelta(client, req.userName, result.payout);
    await resetIfDepletedAndNoPendingBets(client, req.userName);

    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({
      winningNumber: result.winningNumber, color: result.color, won: result.won, payout: result.payout,
      betType, betValue, stake, balance,
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

module.exports = router;
