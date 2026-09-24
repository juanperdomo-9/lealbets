// Mesa de Blackjack EN VIVO: un solo estado compartido en memoria, no por
// usuario — varios amigos se sientan a la misma mesa y ven las jugadas de
// todos en tiempo real (server/routes/liveBlackjack.js expone las acciones,
// server/realtime.js avisa por socket cada vez que algo cambia). La mesa
// avanza sola: fase de apuestas con cuenta regresiva → reparto → cada
// asiento juega su turno, mano por mano si dividió (con límite de tiempo,
// se planta solo si no contesta) → juega el dealer → se paga → arranca la
// ronda siguiente sola.
//
// Las fichas de la apuesta NUNCA se descuentan al apostar, recién cuando se
// liquida la mano al final de la ronda (se resta todo lo apostado —
// principal + side bets— y se suma todo lo pagado en un solo paso) — así,
// si el servidor se reinicia a mitad de una ronda (deploy, etc.), nadie
// pierde fichas de verdad: la ronda en curso simplemente desaparece y la
// mesa vuelve a arrancar vacía.
const { pool, applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('./db');
const { freshShoe, classifyPair, classifyTrio, handTotal, isBlackjack, playDealer } = require('./blackjack');
const { broadcastTableUpdate } = require('./realtime');

const NUM_SEATS = 5;
const BETTING_MS = 60000;
const TURN_MS = 20000;
const PAYOUT_MS = 7000;
const TICK_MS = 1000;
// reglas de ESTA mesa, un poco más a favor de los jugadores que el blackjack
// solo (simulado con Monte Carlo: un jugador casual pasa de perder ~3.5% de
// lo apostado a quedar casi parejo): el dealer se planta desde 15 y el
// blackjack natural paga 2 a 1 (en vez de 3 a 2).
const DEALER_STAND_AT = 15;
const BLACKJACK_PAYS = 2;

function createTable() {
  return {
    phase: 'waiting', // waiting | betting | playing | payout
    phaseEndsAt: null,
    roundNumber: 0,
    seats: new Array(NUM_SEATS).fill(null),
    dealerHand: [],
    dealerHidden: true,
    currentSeatIndex: null,
    currentHandIndex: null,
    deck: [],
  };
}
let table = createTable();

function emptySeat(userName) {
  return {
    userName, bet: 0, pairsStake: 0, trioStake: 0, sideResultText: '', sideWinnings: 0,
    hands: [], status: 'seated', leaving: false,
  };
}
function findSeatIndexByUser(userName) {
  return table.seats.findIndex((s) => s && s.userName === userName);
}
function occupiedCount() {
  return table.seats.filter(Boolean).length;
}
// asientos que van a jugar esta ronda (apostaron la mano principal)
function participantIndices() {
  const idxs = [];
  table.seats.forEach((s, i) => { if (s && s.bet > 0) idxs.push(i); });
  return idxs;
}
function currentHand() {
  if (table.currentSeatIndex == null || table.currentHandIndex == null) return null;
  const seat = table.seats[table.currentSeatIndex];
  return seat ? seat.hands[table.currentHandIndex] : null;
}

// lo que ve el cliente: nunca la carta tapada del dealer mientras no se reveló.
function publicState() {
  return {
    phase: table.phase,
    phaseEndsAt: table.phaseEndsAt,
    roundNumber: table.roundNumber,
    currentSeatIndex: table.currentSeatIndex,
    currentHandIndex: table.currentHandIndex,
    dealerHand: table.dealerHidden ? table.dealerHand.slice(0, 1) : table.dealerHand,
    dealerHidden: table.dealerHidden,
    seats: table.seats.map((s) => (s ? {
      userName: s.userName, bet: s.bet, pairsStake: s.pairsStake, trioStake: s.trioStake,
      sideResultText: s.sideResultText, sideWinnings: s.sideWinnings, status: s.status,
      hands: s.hands.map((h) => ({
        cards: h.cards, bet: h.bet, status: h.status, isSplitResult: h.isSplitResult, result: h.result, payout: h.payout,
      })),
    } : null)),
  };
}
function broadcast() { broadcastTableUpdate(publicState()); }

function sitDown(userName) {
  if (findSeatIndexByUser(userName) !== -1) return; // ya está sentado
  const idx = table.seats.findIndex((s) => s === null);
  if (idx === -1) throw Object.assign(new Error('La mesa está llena'), { status: 400 });
  table.seats[idx] = emptySeat(userName);
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
    // ya apostó esta ronda: se banca el resultado (se planta en lo que le
    // quede jugando), pero al terminar la ronda el asiento se libera solo.
    seat.leaving = true;
    if (table.phase === 'playing' && table.currentSeatIndex === idx) {
      seat.hands.forEach((h) => { if (h.status === 'playing') h.status = 'stood'; });
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

async function placeBet(userName, amount, pairsStake, trioStake) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1) throw Object.assign(new Error('Sentate primero'), { status: 400 });
  if (table.phase !== 'betting') throw Object.assign(new Error('No es momento de apostar'), { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('Poné un monto válido para la mano principal'), { status: 400 });
  const pairs = Number.isFinite(pairsStake) && pairsStake > 0 ? pairsStake : 0;
  const trio = Number.isFinite(trioStake) && trioStake > 0 ? trioStake : 0;
  const total = amount + pairs + trio;
  const { rows } = await pool.query('SELECT balance FROM users WHERE name=$1', [userName]);
  if (rows.length === 0 || Number(rows[0].balance) < total) {
    throw Object.assign(new Error('No tenés esa cantidad de fichas'), { status: 400 });
  }
  const seat = table.seats[idx];
  seat.bet = Math.round(amount * 100) / 100;
  seat.pairsStake = Math.round(pairs * 100) / 100;
  seat.trioStake = Math.round(trio * 100) / 100;
  seat.status = 'betting';
  if (participantIndices().length === occupiedCount()) {
    await dealRound(); // ya apostaron todos los sentados: no hace falta esperar el resto de la cuenta
  } else {
    broadcast();
  }
}

// arranca el turno de la primera mano jugable a partir del asiento
// `fromSeat`/mano `fromHand` (inclusive) y avisa; si no queda ninguna, pasa a
// la fase del dealer (que avisa ella sola cuando termina de liquidar todo).
async function startNextTurn(fromSeat, fromHand) {
  for (let i = fromSeat; i < table.seats.length; i++) {
    const seat = table.seats[i];
    if (!seat || seat.bet <= 0 || !seat.hands.length) continue;
    const startAt = i === fromSeat ? fromHand : 0;
    for (let h = startAt; h < seat.hands.length; h++) {
      if (seat.hands[h].status === 'playing') {
        table.currentSeatIndex = i;
        table.currentHandIndex = h;
        table.phaseEndsAt = Date.now() + TURN_MS;
        broadcast();
        return;
      }
    }
  }
  await runDealerAndSettle();
}
async function advanceTurn() {
  await startNextTurn(table.currentSeatIndex ?? 0, (table.currentHandIndex ?? -1) + 1);
}

async function dealRound() {
  const participants = participantIndices();
  table.deck = freshShoe();
  participants.forEach((i) => {
    const seat = table.seats[i];
    seat.hands = [{ cards: [], bet: seat.bet, status: 'playing', isSplitResult: false, result: null, payout: 0 }];
    seat.status = 'playing';
    seat.sideWinnings = 0;
  });
  table.dealerHand = [];
  table.dealerHidden = true;
  // reparto real de mesa: una carta para cada jugador (en orden de asiento),
  // después una para el dealer, y así dos vueltas — no todas las cartas de
  // un jugador de una, como en una mesa de verdad.
  for (let lap = 0; lap < 2; lap++) {
    participants.forEach((i) => { table.seats[i].hands[0].cards.push(table.deck.pop()); });
    table.dealerHand.push(table.deck.pop());
  }
  participants.forEach((i) => {
    const seat = table.seats[i];
    const hand = seat.hands[0];
    const cards = hand.cards;
    hand.status = isBlackjack(cards) ? 'blackjack' : 'playing';
    // side bets: se calculan ya (con las 2 cartas propias + la carta de
    // arriba del dealer) pero se pagan recién al liquidar, como todo lo demás.
    const sideMsgs = [];
    if (seat.pairsStake > 0) {
      const pair = classifyPair(cards[0], cards[1]);
      if (pair.mult > 0) { seat.sideWinnings += seat.pairsStake * pair.mult; sideMsgs.push(`Pares: ${pair.name} (x${pair.mult})`); }
      else sideMsgs.push('Pares: sin premio');
    }
    if (seat.trioStake > 0) {
      const trio = classifyTrio([cards[0], cards[1], table.dealerHand[0]]);
      if (trio.mult > 0) { seat.sideWinnings += seat.trioStake * trio.mult; sideMsgs.push(`21+3: ${trio.name} (x${trio.mult})`); }
      else sideMsgs.push('21+3: sin premio');
    }
    seat.sideResultText = sideMsgs.join(' · ');
  });
  table.phase = 'playing';
  table.currentSeatIndex = null;
  table.currentHandIndex = null;
  await startNextTurn(0, 0);
}

async function runDealerAndSettle() {
  table.dealerHidden = false;
  const participants = participantIndices();
  const anyoneStillIn = participants.some((i) => table.seats[i].hands.some((h) => h.status !== 'busted'));
  if (anyoneStillIn) playDealer(table.deck, table.dealerHand, DEALER_STAND_AT);
  const dealerTotal = handTotal(table.dealerHand);
  const dealerBJ = isBlackjack(table.dealerHand);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const i of participants) {
      const seat = table.seats[i];
      let totalBet = seat.pairsStake + seat.trioStake;
      let totalPayout = seat.sideWinnings;
      seat.hands.forEach((hand) => {
        totalBet += hand.bet;
        const total = handTotal(hand.cards);
        const playerBJ = hand.status === 'blackjack' && !hand.isSplitResult;
        let payout = 0, result;
        if (hand.status === 'busted') {
          result = 'lose';
        } else if (playerBJ && dealerBJ) {
          result = 'push'; payout = hand.bet;
        } else if (playerBJ) {
          result = 'blackjack'; payout = hand.bet + Math.round(hand.bet * BLACKJACK_PAYS);
        } else if (dealerBJ) {
          result = 'lose';
        } else if (dealerTotal > 21 || total > dealerTotal) {
          result = 'win'; payout = hand.bet * 2;
        } else if (total < dealerTotal) {
          result = 'lose';
        } else {
          result = 'push'; payout = hand.bet;
        }
        hand.result = result;
        hand.payout = payout;
        hand.status = 'done';
        totalPayout += payout;
      });
      seat.status = 'done';
      const net = totalPayout - totalBet;
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
  table.currentHandIndex = null;
  table.phaseEndsAt = Date.now() + PAYOUT_MS;
  broadcast();
}

function resetForNextRound() {
  table.roundNumber++;
  table.dealerHand = [];
  table.dealerHidden = true;
  table.currentSeatIndex = null;
  table.currentHandIndex = null;
  table.seats = table.seats.map((s) => (!s || s.leaving) ? null : emptySeat(s.userName));
  if (occupiedCount() > 0) {
    table.phase = 'betting';
    table.phaseEndsAt = Date.now() + BETTING_MS;
  } else {
    table.phase = 'waiting';
    table.phaseEndsAt = null;
  }
}

function assertMyTurn(userName) {
  const idx = findSeatIndexByUser(userName);
  if (idx === -1 || table.phase !== 'playing' || table.currentSeatIndex !== idx) {
    throw Object.assign(new Error('No es tu turno'), { status: 400 });
  }
  const hand = currentHand();
  if (!hand || hand.status !== 'playing') throw Object.assign(new Error('Esa mano ya no puede jugar'), { status: 400 });
  return hand;
}

// player actions durante su turno ---------------------------------------
async function hit(userName) {
  const hand = assertMyTurn(userName);
  hand.cards.push(table.deck.pop());
  if (handTotal(hand.cards) > 21) {
    hand.status = 'busted';
    await advanceTurn();
  } else {
    table.phaseEndsAt = Date.now() + TURN_MS; // se renueva el tiempo con cada carta pedida
    broadcast();
  }
}
async function stand(userName) {
  const hand = assertMyTurn(userName);
  hand.status = 'stood';
  await advanceTurn();
}
async function doubleDown(userName) {
  const hand = assertMyTurn(userName);
  if (hand.cards.length !== 2) throw Object.assign(new Error('Solo se puede doblar con las dos primeras cartas'), { status: 400 });
  const { rows } = await pool.query('SELECT balance FROM users WHERE name=$1', [userName]);
  if (rows.length === 0 || Number(rows[0].balance) < hand.bet) {
    throw Object.assign(new Error('No tenés fichas para doblar'), { status: 400 });
  }
  hand.bet *= 2;
  hand.cards.push(table.deck.pop());
  hand.status = handTotal(hand.cards) > 21 ? 'busted' : 'stood';
  await advanceTurn();
}
async function split(userName) {
  const hand = assertMyTurn(userName);
  if (hand.cards.length !== 2 || hand.cards[0].r !== hand.cards[1].r) {
    throw Object.assign(new Error('Solo se puede dividir con dos cartas del mismo valor'), { status: 400 });
  }
  const seat = table.seats[table.currentSeatIndex];
  if (seat.hands.length >= 4) throw Object.assign(new Error('No se puede dividir más de 3 veces'), { status: 400 });
  const { rows } = await pool.query('SELECT balance FROM users WHERE name=$1', [userName]);
  if (rows.length === 0 || Number(rows[0].balance) < hand.bet) {
    throw Object.assign(new Error('No tenés fichas para dividir'), { status: 400 });
  }
  const isAceSplit = hand.cards[0].r === 'A';
  const newHand1 = { cards: [hand.cards[0], table.deck.pop()], bet: hand.bet, status: 'playing', isSplitResult: true, result: null, payout: 0 };
  const newHand2 = { cards: [hand.cards[1], table.deck.pop()], bet: hand.bet, status: 'playing', isSplitResult: true, result: null, payout: 0 };
  if (isAceSplit) {
    // regla estándar: al dividir ases, cada mano recibe una sola carta más y queda plantada
    newHand1.status = 'stood';
    newHand2.status = 'stood';
  }
  seat.hands.splice(table.currentHandIndex, 1, newHand1, newHand2);
  if (isAceSplit) { await advanceTurn(); return; }
  table.phaseEndsAt = Date.now() + TURN_MS;
  broadcast();
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
      const hand = currentHand();
      if (hand) hand.status = 'stood';
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
  NUM_SEATS, publicState, sitDown, standUp, placeBet, hit, stand, doubleDown, split, startClock,
};
