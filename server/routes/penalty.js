// Tanda de penaltis: juego individual. El servidor decide siempre si se
// convierte o se ataja cada penal (nunca el cliente).
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { DIFFICULTIES, multiplierForRound, rollKick } = require('../penalty');

const router = express.Router();
const LADDER_STEPS = 10;

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadGame(client, userName) {
  const { rows } = await client.query('SELECT state FROM penalty_games WHERE user_name=$1 FOR UPDATE', [userName]);
  return rows.length ? rows[0].state : null;
}
async function saveGame(client, userName, state) {
  await client.query(
    `INSERT INTO penalty_games (user_name, state, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (user_name) DO UPDATE SET state=$2, updated_at=$3`,
    [userName, JSON.stringify(state), Date.now()]
  );
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}

function publicView(state) {
  return {
    phase: state.phase, // 'active' | 'done'
    difficulty: state.difficulty,
    stake: state.stake,
    round: state.round,
    ladder: state.ladder,
    multiplier: state.round > 0 ? multiplierForRound(state.p, state.round) : 1,
    nextMultiplier: multiplierForRound(state.p, state.round + 1),
    lastKickResult: state.lastKickResult || null, // 'scored' | 'missed' | null
    resultText: state.resultText || '',
  };
}

router.get('/state', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT state FROM penalty_games WHERE user_name=$1', [req.userName]);
  if (rows.length === 0) return res.json({ phase: 'none' });
  res.json(publicView(rows[0].state));
});

router.post('/start', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  const difficulty = String(req.body.difficulty || 'media');
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });
  if (!DIFFICULTIES[difficulty]) return res.status(400).json({ error: 'Elegí una dificultad válida' });
  const p = DIFFICULTIES[difficulty];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await loadGame(client, req.userName);
    if (existing && existing.phase === 'active') throw httpErr(400, 'Ya tenés una tanda en juego');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (stake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -stake);

    const ladder = Array.from({ length: LADDER_STEPS }, (_, i) => multiplierForRound(p, i + 1));
    const state = {
      stake, difficulty, p, round: 0, phase: 'active', ladder,
      lastKickResult: null, resultText: '',
    };
    await saveGame(client, req.userName, state);
    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({ ...publicView(state), balance });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

router.post('/kick', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await loadGame(client, req.userName);
    if (!state || state.phase !== 'active') throw httpErr(400, 'No hay ninguna tanda en juego');

    if (rollKick(state.p)) {
      state.round += 1;
      state.lastKickResult = 'scored';
    } else {
      state.phase = 'done';
      state.lastKickResult = 'missed';
      state.resultText = 'Atajada — perdiste la apuesta';
      await resetIfDepletedAndNoPendingBets(client, req.userName);
    }
    await saveGame(client, req.userName, state);
    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({ ...publicView(state), balance });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

router.post('/cashout', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await loadGame(client, req.userName);
    if (!state || state.phase !== 'active') throw httpErr(400, 'No hay ninguna tanda en juego');
    if (state.round === 0) throw httpErr(400, 'Todavía no convertiste ningún penal');

    const mult = multiplierForRound(state.p, state.round);
    const payout = Math.round(state.stake * mult);
    await applyBalanceDelta(client, req.userName, payout);
    state.phase = 'done';
    state.resultText = `Cobraste ${payout} fichas (x${mult})`;
    await resetIfDepletedAndNoPendingBets(client, req.userName);
    await saveGame(client, req.userName, state);
    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({ ...publicView(state), balance });
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
