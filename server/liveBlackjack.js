// Mesa de Blackjack EN VIVO: un solo estado compartido en memoria, no por
// usuario — varios amigos se sientan a la misma mesa y ven las jugadas de
// todos en tiempo real (server/routes/liveBlackjack.js expone las acciones,
// server/realtime.js avisa por socket cada vez que algo cambia). La mesa
// avanza sola: fase de apuestas con cuenta regresiva → reparto → cada
// asiento juega su turno (con límite de tiempo, se planta solo si no
// contesta) → juega el dealer → se paga → arranca la ronda siguiente sola.
//
// Las fichas de la apuesta NUNCA se descuentan al apostar, recién cuando se
// liquida la mano al final de la ronda (se resta la apuesta y se suma el
// pago en un solo paso) — así, si el servidor se reinicia a mitad de una
// ronda (deploy, etc.), nadie pierde fichas de verdad: la ronda en curso
// simplemente desaparece y la mesa vuelve a arrancar vacía.
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('./db');
const { freshShoe, handTotal, isBlackjack, playDealer } = require('./blackjack');
const { broadcastTableUpdate } = require('./realtime');

const NUM_SEATS = 5;
const BETTING_MS = 15000;
const TURN_MS = 20000;
const PAYOUT_MS = 7000;
const TICK_MS = 1000;

function createTable() {
  return {
    phase: 'waiting', // waiting | betting | playing | payout
    phaseEndsAt: null,
    roundNumber: 0,
    seats: new Array(NUM_SEATS).fill(null),
    dealerHand: [],
    dealerHidden: true,
    currentSeatIndex: null,
    deck: [],
  };
}
let table = createTable();

function findSeatIndexByUser(userName) {
  return table.seats.findIndex((s) => s && s.userName === userName);
}
function occupiedCount() {
  return table.seats.filter(Boolean).length;
}
function participantIndices() {
  const idxs = [];
  table.seats.forEach((s, i) => { if (s && s.bet > 0) idxs.push(i); });
  return idxs;
}

// lo que ve el cliente: nunca la carta tapada del dealer mientras no se reveló.
function publicState() {
  return {
    phase: table.phase,
    phaseEndsAt: table.phaseEndsAt,
    roundNumber: table.roundNumber,
    currentSeatIndex: table.currentSeatIndex,
    dealerHand: table.dealerHidden ? table.dealerHand.slice(0, 1) : table.dealerHand,
    dealerHidden: table.dealerHidden,
    seats: table.seats.map((s) => (s ? {
      userName: s.userName, bet: s.bet, cards: s.cards, status: s.status, result: s.result, payout: s.payout,
    } : null)),
  };
}
function broadcast() { broadcastTableUpdate(publicState()); }

function sitDown(userName) {
  if (findSeatIndexByUser(userName) !== -1) return; // ya está sentado
  const idx = table.seats.findIndex((s) => s === null);
  if (idx === -1) throw Object.assign(new Error('La mesa está llena'), { status: 400 });
  table.seats[idx] = { userName, bet: 0, cards: [], status: 'seated', result: null, payout: 0, leaving: false };
  if (table.phase === 'waiting') {
    table.phase = 'betting';
    table.phaseEndsAt = Date.now() + BETTING_MS;
  }
  broadcast();
}

async function standUp(userName) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1) return;
  const seat = table.seats[idx];
  const midRound = seat.bet > 0 && (table.phase === 'playing' || table.phase === 'payout');
  if (midRound) {
    // ya apostó esta ronda: se banca el resultado (se planta si le tocaba
    // jugar), pero al terminar la ronda el asiento se libera solo.
    seat.leaving = true;
    if (table.phase === 'playing' && seat.status === 'playing' && table.currentSeatIndex === idx) {
      seat.status = 'stood';
      await advanceTurn();
      return; // advanceTurn ya hizo su propio broadcast
    }
  } else {
    table.seats[idx] = null;
    if (occupiedCount() === 0 && table.phase === 'betting') {
      table.phase = 'waiting';
      table.phaseEndsAt = null;
    }
  }
  broadcast();
}

async function placeBet(userName, amount) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1) throw Object.assign(new Error('Sentate primero'), { status: 400 });
  if (table.phase !== 'betting') throw Object.assign(new Error('No es momento de apostar'), { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Poné un monto válido'), { status: 400 });
  const { rows } = await pool.query('SELECT balance FROM users WHERE name=$1', [userName]);
  if (rows.length === 0 || Number(rows[0].balance) < amount) {
    throw Object.assign(new Error('No tenés esa cantidad de fichas'), { status: 400 });
  }
  table.seats[idx].bet = Math.round(amount * 100) / 100;
  table.seats[idx].status = 'betting';
  if (participantIndices().length === occupiedCount()) {
    await dealRound(); // ya apostaron todos los sentados: no hace falta esperar el resto de la cuenta
  } else {
    broadcast();
  }
}

// arranca el turno del primer asiento jugable a partir de `from` (inclusive)
// y avisa; si no queda ninguno, pasa a la fase del dealer (que avisa ella
// sola cuando termina de liquidar todo).
async function startNextTurn(from) {
  for (let i = from; i < table.seats.length; i++) {
    const s = table.seats[i];
    if (s && s.bet > 0 && s.status === 'playing') {
      table.currentSeatIndex = i;
      table.phaseEndsAt = Date.now() + TURN_MS;
      broadcast();
      return;
    }
  }
  await runDealerAndSettle();
}
async function advanceTurn() {
  await startNextTurn((table.currentSeatIndex ?? -1) + 1);
}

async function dealRound() {
  const participants = participantIndices();
  table.deck = freshShoe();
  table.dealerHand = [table.deck.pop(), table.deck.pop()];
  table.dealerHidden = true;
  participants.forEach((i) => {
    const seat = table.seats[i];
    seat.cards = [table.deck.pop(), table.deck.pop()];
    seat.status = isBlackjack(seat.cards) ? 'blackjack' : 'playing';
    seat.result = null;
    seat.payout = 0;
  });
  table.phase = 'playing';
  table.currentSeatIndex = null;
  await startNextTurn(0);
}

async function runDealerAndSettle() {
  table.dealerHidden = false;
  const participants = participantIndices();
  const anyoneStillIn = participants.some((i) => table.seats[i].status !== 'busted');
  if (anyoneStillIn) playDealer(table.deck, table.dealerHand);
  const dealerTotal = handTotal(table.dealerHand);
  const dealerBJ = isBlackjack(table.dealerHand);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const i of participants) {
      const seat = table.seats[i];
      const total = handTotal(seat.cards);
      let payout = 0, result;
      if (seat.status === 'busted') {
        result = 'lose';
      } else if (seat.status === 'blackjack' && dealerBJ) {
        result = 'push'; payout = seat.bet;
      } else if (seat.status === 'blackjack') {
        result = 'blackjack'; payout = seat.bet + Math.round(seat.bet * 1.5);
      } else if (dealerBJ) {
        result = 'lose';
      } else if (dealerTotal > 21) {
        result = 'win'; payout = seat.bet * 2;
      } else if (total > dealerTotal) {
        result = 'win'; payout = seat.bet * 2;
      } else if (total < dealerTotal) {
        result = 'lose';
      } else {
        result = 'push'; payout = seat.bet;
      }
      seat.result = result;
      seat.payout = payout;
      seat.status = 'done';
      const net = payout - seat.bet;
      if (net !== 0) await applyBalanceDelta(client, seat.userName, net);
      await resetIfDepletedAndNoPendingBets(client, seat.userName);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error liquidando la mesa en vivo:', e);
  } finally {
    client.release();
  }

  table.phase = 'payout';
  table.currentSeatIndex = null;
  table.phaseEndsAt = Date.now() + PAYOUT_MS;
  broadcast();
}

function resetForNextRound() {
  table.roundNumber++;
  table.dealerHand = [];
  table.dealerHidden = true;
  table.currentSeatIndex = null;
  table.seats = table.seats.map((s) => {
    if (!s || s.leaving) return null;
    return { userName: s.userName, bet: 0, cards: [], status: 'seated', result: null, payout: 0, leaving: false };
  });
  if (occupiedCount() > 0) {
    table.phase = 'betting';
    table.phaseEndsAt = Date.now() + BETTING_MS;
  } else {
    table.phase = 'waiting';
    table.phaseEndsAt = null;
  }
}

// player actions durante su turno ---------------------------------------
async function hit(userName) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1 || table.phase !== 'playing' || table.currentSeatIndex !== idx) {
    throw Object.assign(new Error('No es tu turno'), { status: 400 });
  }
  const seat = table.seats[idx];
  seat.cards.push(table.deck.pop());
  if (handTotal(seat.cards) > 21) {
    seat.status = 'busted';
    await advanceTurn();
  } else {
    table.phaseEndsAt = Date.now() + TURN_MS; // se renueva el tiempo con cada carta pedida
    broadcast();
  }
}
async function stand(userName) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1 || table.phase !== 'playing' || table.currentSeatIndex !== idx) {
    throw Object.assign(new Error('No es tu turno'), { status: 400 });
  }
  table.seats[idx].status = 'stood';
  await advanceTurn();
}
async function doubleDown(userName) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1 || table.phase !== 'playing' || table.currentSeatIndex !== idx) {
    throw Object.assign(new Error('No es tu turno'), { status: 400 });
  }
  const seat = table.seats[idx];
  if (seat.cards.length !== 2) throw Object.assign(new Error('Solo se puede doblar con las dos primeras cartas'), { status: 400 });
  const { rows } = await pool.query('SELECT balance FROM users WHERE name=$1', [userName]);
  if (rows.length === 0 || Number(rows[0].balance) < seat.bet * 2) {
    throw Object.assign(new Error('No tenés fichas para doblar'), { status: 400 });
  }
  seat.bet *= 2;
  seat.cards.push(table.deck.pop());
  seat.status = handTotal(seat.cards) > 21 ? 'busted' : 'stood';
  await advanceTurn();
}

// el reloj de la mesa: revisa cada un segundo si venció el plazo de la fase
// actual y avanza sola (así funciona igual para todos sin depender de que
// alguien haga una acción).
let tickHandle = null;
async function tick() {
  try {
    if (!table.phaseEndsAt || Date.now() < table.phaseEndsAt) return;
    if (table.phase === 'betting') {
      if (participantIndices().length > 0) {
        await dealRound(); // ya avisa sola (startNextTurn/runDealerAndSettle)
      } else if (occupiedCount() > 0) {
        table.phaseEndsAt = Date.now() + BETTING_MS; // nadie apostó, se da otra vuelta
        broadcast();
      } else {
        table.phase = 'waiting';
        table.phaseEndsAt = null;
        broadcast();
      }
    } else if (table.phase === 'playing') {
      // se venció el tiempo del que le tocaba: se planta solo
      if (table.currentSeatIndex !== null) table.seats[table.currentSeatIndex].status = 'stood';
      await advanceTurn(); // ya avisa sola
    } else if (table.phase === 'payout') {
      resetForNextRound();
      broadcast();
    }
  } catch (e) {
    console.error('Error en el reloj de la mesa en vivo:', e);
  }
}
function startClock() {
  if (tickHandle) return;
  tickHandle = setInterval(tick, TICK_MS);
}

module.exports = {
  NUM_SEATS, publicState, sitDown, standUp, placeBet, hit, stand, doubleDown, startClock,
};
