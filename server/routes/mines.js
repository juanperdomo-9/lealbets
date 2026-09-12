// Minas: juego individual. El servidor decide siempre dónde están las minas
// (nunca el cliente); el cliente solo pide revelar un casillero o cobrar.
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { GRID_SIZE, generateGrid, multiplierForReveals } = require('../mines');

const router = express.Router();

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadGame(client, userName) {
  const { rows } = await client.query('SELECT state FROM mines_games WHERE user_name=$1 FOR UPDATE', [userName]);
  return rows.length ? rows[0].state : null;
}
async function saveGame(client, userName, state) {
  await client.query(
    `INSERT INTO mines_games (user_name, state, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (user_name) DO UPDATE SET state=$2, updated_at=$3`,
    [userName, JSON.stringify(state), Date.now()]
  );
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}

function publicView(state) {
  const done = state.phase === 'done';
  const revealedCount = state.revealed.filter(Boolean).length;
  return {
    phase: state.phase,
    minesCount: state.minesCount,
    stake: state.stake,
    revealed: state.revealed,
    grid: done ? state.grid : null, // solo se revela dónde estaban las minas al terminar
    revealedCount,
    multiplier: multiplierForReveals(state.minesCount, revealedCount),
    nextMultiplier: multiplierForReveals(state.minesCount, revealedCount + 1),
    resultText: state.resultText || '',
  };
}

router.get('/state', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT state FROM mines_games WHERE user_name=$1', [req.userName]);
  if (rows.length === 0) return res.json({ phase: 'none' });
  res.json(publicView(rows[0].state));
});

router.post('/start', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  const minesCount = parseInt(req.body.mines, 10);
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });
  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount > 24) {
    return res.status(400).json({ error: 'Elegí entre 1 y 24 minas' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await loadGame(client, req.userName);
    if (existing && existing.phase === 'active') throw httpErr(400, 'Ya tenés una partida de minas en juego');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (stake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -stake);

    const state = {
      stake, minesCount, grid: generateGrid(minesCount), revealed: new Array(GRID_SIZE).fill(false),
      phase: 'active', resultText: '',
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

router.post('/reveal', requireAuth, async (req, res) => {
  const index = parseInt(req.body.index, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await loadGame(client, req.userName);
    if (!state || state.phase !== 'active') throw httpErr(400, 'No hay ninguna partida en juego');
    if (!Number.isInteger(index) || index < 0 || index >= GRID_SIZE) throw httpErr(400, 'Casillero inválido');
    if (state.revealed[index]) throw httpErr(400, 'Ese casillero ya está revelado');

    if (state.grid[index]) {
      // mina: se pierde la apuesta (ya estaba descontada) y se revela el tablero completo
      state.revealed[index] = true;
      state.phase = 'done';
      state.resultText = 'Pisaste una mina — perdiste la apuesta';
      await resetIfDepletedAndNoPendingBets(client, req.userName);
    } else {
      state.revealed[index] = true;
      const revealedCount = state.revealed.filter(Boolean).length;
      const safeTilesLeft = GRID_SIZE - state.minesCount - revealedCount;
      if (safeTilesLeft === 0) {
        // encontró todos los casilleros seguros: se liquida automático a la cuota máxima
        const mult = multiplierForReveals(state.minesCount, revealedCount);
        const payout = Math.round(state.stake * mult);
        await applyBalanceDelta(client, req.userName, payout);
        state.phase = 'done';
        state.resultText = `¡Encontraste todos los casilleros seguros! Cobraste ${payout} fichas (x${mult})`;
        await resetIfDepletedAndNoPendingBets(client, req.userName);
      }
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
    if (!state || state.phase !== 'active') throw httpErr(400, 'No hay ninguna partida en juego');
    const revealedCount = state.revealed.filter(Boolean).length;
    if (revealedCount === 0) throw httpErr(400, 'Todavía no revelaste ningún casillero');

    const mult = multiplierForReveals(state.minesCount, revealedCount);
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
