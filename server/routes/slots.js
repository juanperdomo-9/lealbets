// Tragamonedas: juego individual. El servidor decide siempre qué sale en
// cada giro (nunca el cliente). Un giro normal se resuelve solo (se cobra
// la apuesta y se paga en el momento); si salen 3+ scatters se abre una
// ronda bonus de giros gratis que sí queda guardada en la base (como
// minas/penales) porque son varios pasos hasta que se cobra el premio final.
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { spinBase, spinBonus } = require('../slots');

const router = express.Router();
const BUY_BONUS_COST_MULT = 100; // comprar la ronda bonus cuesta 100x lo que apostás
const BUY_BONUS_FREE_SPINS = 8; // misma cantidad que el disparador natural más chico (3 scatters)

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadGame(client, userName) {
  const { rows } = await client.query('SELECT state FROM slots_games WHERE user_name=$1 FOR UPDATE', [userName]);
  return rows.length ? rows[0].state : null;
}
async function saveGame(client, userName, state) {
  await client.query(
    `INSERT INTO slots_games (user_name, state, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (user_name) DO UPDATE SET state=$2, updated_at=$3`,
    [userName, JSON.stringify(state), Date.now()]
  );
}
async function clearGame(client, userName) {
  await client.query('DELETE FROM slots_games WHERE user_name=$1', [userName]);
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}

function bonusView(state) {
  if (!state) return null;
  return {
    freeSpinsLeft: state.freeSpinsLeft,
    totalFreeSpins: state.totalFreeSpins,
    collected: state.collected,
    stake: state.stake,
  };
}

router.get('/state', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT state FROM slots_games WHERE user_name=$1', [req.userName]);
  if (rows.length === 0) return res.json({ bonus: null });
  res.json({ bonus: bonusView(rows[0].state) });
});

// un giro pagado del juego base. Si toca bonus, queda la ronda de giros
// gratis abierta (no se puede pedir otro giro pagado hasta terminarla).
router.post('/spin', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingBonus = await loadGame(client, req.userName);
    if (existingBonus) throw httpErr(400, 'Terminá primero los giros gratis');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (stake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -stake);

    const spin = spinBase(stake);
    if (spin.totalWin > 0) await applyBalanceDelta(client, req.userName, spin.totalWin);

    let bonus = null;
    if (spin.freeSpinsAwarded > 0) {
      const state = {
        stake, freeSpinsLeft: spin.freeSpinsAwarded, totalFreeSpins: spin.freeSpinsAwarded, collected: 0,
      };
      await saveGame(client, req.userName, state);
      bonus = bonusView(state);
    } else {
      await resetIfDepletedAndNoPendingBets(client, req.userName);
    }

    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({
      grid: spin.grid, lineWins: spin.lineWins, scatterCount: spin.scatterCount, scatterWin: spin.scatterWin,
      totalWin: spin.totalWin, bonus, balance,
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

// compra directo la ronda bonus (sin esperar a que salgan 3+ scatters solos):
// paga 100x la apuesta puesta y arranca con los mismos 8 giros gratis que el
// disparador natural más chico.
router.post('/buy-bonus', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido' });
  const cost = Math.round(stake * BUY_BONUS_COST_MULT * 100) / 100;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingBonus = await loadGame(client, req.userName);
    if (existingBonus) throw httpErr(400, 'Terminá primero los giros gratis');
    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (cost > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -cost);

    const state = { stake, freeSpinsLeft: BUY_BONUS_FREE_SPINS, totalFreeSpins: BUY_BONUS_FREE_SPINS, collected: 0 };
    await saveGame(client, req.userName, state);

    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({ bonus: bonusView(state), balance });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

// consume un giro gratis de la ronda bonus abierta. El último giro liquida
// el premio acumulado (apuesta original x multiplicador juntado).
router.post('/bonus-spin', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await loadGame(client, req.userName);
    if (!state || state.freeSpinsLeft <= 0) throw httpErr(400, 'No tenés ninguna ronda bonus en juego');

    const spin = spinBonus();
    state.collected += spin.collected;
    state.freeSpinsLeft -= 1;

    let finished = false;
    let payout = 0;
    if (state.freeSpinsLeft === 0) {
      finished = true;
      payout = Math.round(state.stake * state.collected * 100) / 100;
      if (payout > 0) await applyBalanceDelta(client, req.userName, payout);
      await clearGame(client, req.userName);
      await resetIfDepletedAndNoPendingBets(client, req.userName);
    } else {
      await saveGame(client, req.userName, state);
    }

    await client.query('COMMIT');
    const balance = await currentBalance(pool, req.userName);
    res.json({
      grid: spin.grid, hits: spin.hits, collectedThisSpin: spin.collected,
      freeSpinsLeft: state.freeSpinsLeft, totalFreeSpins: state.totalFreeSpins, totalCollected: state.collected,
      finished, payout, balance,
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
