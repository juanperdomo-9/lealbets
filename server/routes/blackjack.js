// Blackjack contra la casa: juego individual (no toca partidos, cuotas ni
// combinadas), pero el mazo, el reparto y el resultado los decide siempre
// el servidor — el cliente solo pide acciones (repartir/pedir/plantarse/
// doblar/dividir) y anima lo que el servidor ya resolvió. Así nadie puede
// "ganar" desde la consola del navegador.
const express = require('express');
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('../db');
const { requireAuth } = require('../auth');
const { freshShoe, classifyPair, classifyTrio, handTotal, isBlackjack, playDealer } = require('../blackjack');

const router = express.Router();

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

function publicView(state) {
  const done = state.phase === 'done';
  return {
    phase: state.phase,
    hands: state.hands.map((h) => ({
      cards: h.cards, bet: h.bet, status: h.status, isSplitResult: h.isSplitResult, resultMsg: h.resultMsg || null,
    })),
    currentHandIndex: state.currentHandIndex,
    dealerHand: done ? state.dealerHand : state.dealerHand.slice(0, 1),
    dealerHidden: !done,
    sideResultText: state.sideResultText || '',
    resultText: state.resultText || '',
    dealerRevealSequence: state.dealerRevealSequence || null,
  };
}

async function loadGame(client, userName) {
  const { rows } = await client.query('SELECT state FROM blackjack_games WHERE user_name=$1 FOR UPDATE', [userName]);
  return rows.length ? rows[0].state : null;
}
async function saveGame(client, userName, state) {
  await client.query(
    `INSERT INTO blackjack_games (user_name, state, updated_at) VALUES ($1,$2,$3)
     ON CONFLICT (user_name) DO UPDATE SET state=$2, updated_at=$3`,
    [userName, JSON.stringify(state), Date.now()]
  );
}
async function currentBalance(client, userName) {
  const { rows } = await client.query('SELECT balance FROM users WHERE name=$1', [userName]);
  return Number(rows[0].balance);
}

function advanceHandIndex(state) {
  state.currentHandIndex++;
  while (state.currentHandIndex < state.hands.length && state.hands[state.currentHandIndex].status !== 'playing') {
    state.currentHandIndex++;
  }
  return state.currentHandIndex >= state.hands.length;
}

// liquida todas las manos contra el dealer; devuelve el total a acreditar (0 si no ganó nada)
function settleAll(state) {
  const dealerTotal = handTotal(state.dealerHand);
  const dealerBJ = isBlackjack(state.dealerHand);
  let totalPayout = 0;
  const messages = [];
  state.hands.forEach((hand, i) => {
    const total = handTotal(hand.cards);
    const playerBJ = isBlackjack(hand.cards) && !hand.isSplitResult; // un 21 de un split no cuenta como blackjack
    let payout = 0;
    let msg;
    if (total > 21) {
      msg = 'te pasaste';
    } else if (playerBJ && dealerBJ) {
      msg = 'empate (blackjack)'; payout = hand.bet;
    } else if (playerBJ) {
      msg = '¡blackjack! (3 a 2)'; payout = hand.bet + Math.round(hand.bet * 1.5);
    } else if (dealerBJ) {
      msg = 'blackjack del dealer';
    } else if (dealerTotal > 21) {
      msg = 'ganaste (se pasó el dealer)'; payout = hand.bet * 2;
    } else if (total > dealerTotal) {
      msg = 'ganaste'; payout = hand.bet * 2;
    } else if (total < dealerTotal) {
      msg = 'perdiste';
    } else {
      msg = 'empate'; payout = hand.bet;
    }
    hand.resultMsg = msg;
    totalPayout += payout;
    messages.push(state.hands.length > 1 ? `Mano ${i + 1}: ${msg}` : msg.charAt(0).toUpperCase() + msg.slice(1));
  });
  state.resultText = messages.join(' · ');
  return totalPayout;
}

// si no queda ninguna mano jugable, hace jugar al dealer y liquida todo
async function maybeAdvanceAndSettle(client, userName, state) {
  const noMoreHands = advanceHandIndex(state);
  if (!noMoreHands) return;
  state.phase = 'done';
  state.dealerRevealSequence = state.hands.some((h) => h.status !== 'bust')
    ? playDealer(state.deck, state.dealerHand)
    : [];
  const payout = settleAll(state);
  if (payout > 0) await applyBalanceDelta(client, userName, payout);
  // recién si la mano quedó totalmente resuelta (y no le queda ninguna combinada
  // deportiva pendiente tampoco) se restablecen las fichas en caso de haber llegado a 0.
  await resetIfDepletedAndNoPendingBets(client, userName);
}

async function withGame(req, res, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await loadGame(client, req.userName);
    if (!state || state.phase !== 'playing') throw httpErr(400, 'No hay ninguna mano en juego');
    await action(client, state);
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
}

router.get('/state', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT state FROM blackjack_games WHERE user_name=$1', [req.userName]);
  if (rows.length === 0) return res.json({ phase: 'none' });
  res.json(publicView(rows[0].state));
});

router.post('/deal', requireAuth, async (req, res) => {
  const stake = Number(req.body.stake);
  const pairsStake = Number(req.body.pairsStake) || 0;
  const trioStake = Number(req.body.trioStake) || 0;
  if (!Number.isFinite(stake) || stake <= 0) return res.status(400).json({ error: 'Poné un monto válido para la mano principal' });
  if (!Number.isFinite(pairsStake) || !Number.isFinite(trioStake) || pairsStake < 0 || trioStake < 0) {
    return res.status(400).json({ error: 'Las side bets no pueden ser negativas' });
  }
  const totalStake = stake + pairsStake + trioStake;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await loadGame(client, req.userName);
    if (existing && existing.phase === 'playing') throw httpErr(400, 'Ya tenés una mano en juego');

    const { rows: urows } = await client.query('SELECT balance FROM users WHERE name=$1 FOR UPDATE', [req.userName]);
    if (urows.length === 0) throw httpErr(404, 'Usuario no encontrado');
    if (totalStake > Number(urows[0].balance)) throw httpErr(400, 'No tenés esa cantidad de fichas');
    await applyBalanceDelta(client, req.userName, -totalStake);

    const deck = freshShoe();
    const playerCards = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];
    const state = {
      deck,
      hands: [{ cards: playerCards, bet: stake, status: 'playing', isSplitResult: false }],
      currentHandIndex: 0,
      dealerHand,
      phase: 'playing',
      pairsStake,
      trioStake,
      sideResultText: '',
      resultText: '',
      dealerRevealSequence: null,
    };

    // las side bets se liquidan de una, apenas se reparten las dos primeras cartas
    const [p1, p2] = playerCards;
    let sideWinnings = 0;
    const sideMsgs = [];
    if (pairsStake > 0) {
      const pair = classifyPair(p1, p2);
      if (pair.mult > 0) { sideWinnings += pairsStake * pair.mult; sideMsgs.push(`Pares: ${pair.name} (x${pair.mult})`); }
      else sideMsgs.push('Pares: sin premio');
    }
    if (trioStake > 0) {
      const trio = classifyTrio([p1, p2, dealerHand[0]]);
      if (trio.mult > 0) { sideWinnings += trioStake * trio.mult; sideMsgs.push(`21+3: ${trio.name} (x${trio.mult})`); }
      else sideMsgs.push('21+3: sin premio');
    }
    state.sideResultText = sideMsgs.join(' · ');
    if (sideWinnings > 0) await applyBalanceDelta(client, req.userName, sideWinnings);

    // blackjack natural (jugador y/o dealer): se liquida la mano principal de una
    if (isBlackjack(playerCards) || isBlackjack(dealerHand)) {
      state.hands[0].status = 'stand';
      state.phase = 'done';
      state.dealerRevealSequence = [];
      const payout = settleAll(state);
      if (payout > 0) await applyBalanceDelta(client, req.userName, payout);
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

router.post('/hit', requireAuth, (req, res) => withGame(req, res, async (client, state) => {
  const hand = state.hands[state.currentHandIndex];
  if (!hand || hand.status !== 'playing') throw httpErr(400, 'Esa mano no puede pedir carta');
  hand.cards.push(state.deck.pop());
  if (handTotal(hand.cards) > 21) {
    hand.status = 'bust';
    await maybeAdvanceAndSettle(client, req.userName, state);
  }
}));

router.post('/stand', requireAuth, (req, res) => withGame(req, res, async (client, state) => {
  const hand = state.hands[state.currentHandIndex];
  if (!hand || hand.status !== 'playing') throw httpErr(400, 'Esa mano ya no puede jugar');
  hand.status = 'stand';
  await maybeAdvanceAndSettle(client, req.userName, state);
}));

router.post('/double', requireAuth, (req, res) => withGame(req, res, async (client, state) => {
  const hand = state.hands[state.currentHandIndex];
  if (!hand || hand.status !== 'playing' || hand.cards.length !== 2) throw httpErr(400, 'No podés doblar esta mano');
  const balance = await currentBalance(client, req.userName);
  if (balance < hand.bet) throw httpErr(400, 'No tenés fichas suficientes para doblar');
  await applyBalanceDelta(client, req.userName, -hand.bet);
  hand.bet *= 2;
  hand.cards.push(state.deck.pop());
  hand.status = handTotal(hand.cards) > 21 ? 'bust' : 'stand';
  await maybeAdvanceAndSettle(client, req.userName, state);
}));

router.post('/split', requireAuth, (req, res) => withGame(req, res, async (client, state) => {
  const hand = state.hands[state.currentHandIndex];
  if (!hand || hand.status !== 'playing' || hand.cards.length !== 2 || hand.cards[0].r !== hand.cards[1].r) {
    throw httpErr(400, 'No podés dividir esta mano');
  }
  const balance = await currentBalance(client, req.userName);
  if (balance < hand.bet) throw httpErr(400, 'No tenés fichas suficientes para dividir');
  await applyBalanceDelta(client, req.userName, -hand.bet);
  const isAceSplit = hand.cards[0].r === 'A';
  const newHand1 = { cards: [hand.cards[0], state.deck.pop()], bet: hand.bet, status: 'playing', isSplitResult: true };
  const newHand2 = { cards: [hand.cards[1], state.deck.pop()], bet: hand.bet, status: 'playing', isSplitResult: true };
  if (isAceSplit) {
    // regla estándar: al dividir ases, cada mano recibe una sola carta más y queda plantada
    newHand1.status = 'stand';
    newHand2.status = 'stand';
  }
  state.hands.splice(state.currentHandIndex, 1, newHand1, newHand2);
  if (isAceSplit) await maybeAdvanceAndSettle(client, req.userName, state);
}));

module.exports = router;
