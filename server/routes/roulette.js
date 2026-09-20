// Ruleta europea: juego individual, sin varios pasos — se eligen una o
// varias fichas puestas en el paño (como en una mesa de verdad) y se gira
// una sola vez; el servidor sortea el número (nunca el cliente) y liquida
// todas las apuestas juntas contra ese mismo número. No hace falta guardar
// ninguna partida en curso.
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { validateBet, resolveMultiSpin } = require('../roulette');

const router = express.Router();
const MAX_BETS_PER_SPIN = 40; // de sobra para cualquier combinación real del paño

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}
function parseBetValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map((v) => parseInt(v, 10)); // caballo/cuadro
  return parseInt(raw, 10);
}

router.post('/spin', requireAuth, async (req, res) => {
  const betsRaw = Array.isArray(req.body.bets) ? req.body.bets : null;
  if (!betsRaw || betsRaw.length === 0) return res.status(400).json({ error: 'Poné al menos una ficha en el paño' });
  if (betsRaw.length > MAX_BETS_PER_SPIN) return res.status(400).json({ error: 'Demasiadas apuestas en un solo giro' });

  const bets = [];
  for (const raw of betsRaw) {
    const amount = Number(raw && raw.amount);
    const betType = String((raw && raw.type) || '');
    const betValue = parseBetValue(raw && raw.value);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Poné un monto válido en cada ficha' });
    if (!validateBet(betType, betValue)) return res.status(400).json({ error: 'Apuesta inválida' });
    bets.push({ type: betType, value: betValue, amount });
  }
  const totalStake = Math.round(bets.reduce((s, b) => s + b.amount, 0) * 100) / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (totalStake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -totalStake);

    const spin = resolveMultiSpin(bets);
    if (spin.totalPayout > 0) await applyBalanceDelta(client, req.userName, spin.totalPayout);
    await resetIfDepletedAndNoPendingBets(client, req.userName);

    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({
      winningNumber: spin.winningNumber, color: spin.color, results: spin.results,
      totalStake, totalPayout: spin.totalPayout, balance,
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
