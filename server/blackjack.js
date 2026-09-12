// Motor de Blackjack: puro cálculo (mazo, valores de mano, pares/tríos,
// juego del dealer). Todo corre en el servidor — el cliente nunca decide
// qué cartas salen ni cuánto se paga, solo pide acciones (repartir, pedir,
// plantarse, doblar, dividir) y el servidor responde con el resultado.
const NUM_DECKS = 6; // varios mazos mezclados: hace falta para que puedan salir pares/tríos perfectos
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_ORDER = RANKS;

function freshShoe() {
  const deck = [];
  for (let d = 0; d < NUM_DECKS; d++) {
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function isRedSuit(s) {
  return s === '♥' || s === '♦';
}

function classifyPair(c1, c2) {
  if (c1.r !== c2.r) return { name: null, mult: 0 };
  if (c1.s === c2.s) return { name: 'Par perfecto', mult: 26 };
  if (isRedSuit(c1.s) === isRedSuit(c2.s)) return { name: 'Par color', mult: 13 };
  return { name: 'Par simple', mult: 7 };
}

function rankValue(r) {
  return RANK_ORDER.indexOf(r) + 1; // A=1 ... K=13
}
function isStraightVals(vals) {
  const low = [...vals].sort((a, b) => a - b);
  const seqLow = low[1] === low[0] + 1 && low[2] === low[1] + 1;
  const high = vals.map((v) => (v === 1 ? 14 : v)).sort((a, b) => a - b);
  const seqHigh = high[1] === high[0] + 1 && high[2] === high[1] + 1;
  return seqLow || seqHigh;
}
function classifyTrio(cards) {
  const suits = cards.map((c) => c.s);
  const ranks = cards.map((c) => c.r);
  const allSameSuit = suits.every((s) => s === suits[0]);
  const allSameRank = ranks.every((r) => r === ranks[0]);
  if (allSameRank && allSameSuit) return { name: 'Trío perfecto', mult: 101 };
  if (allSameRank) return { name: 'Trío', mult: 30 };
  const vals = ranks.map(rankValue);
  const distinct = new Set(vals).size === 3;
  const straight = distinct && isStraightVals(vals);
  if (straight && allSameSuit) return { name: 'Escalera perfecta', mult: 40 };
  if (straight) return { name: 'Escalera', mult: 11 };
  if (allSameSuit) return { name: 'Color', mult: 6 };
  return { name: null, mult: 0 };
}

function cardValue(card) {
  if (card.r === 'A') return 11;
  if (card.r === 'J' || card.r === 'Q' || card.r === 'K') return 10;
  return parseInt(card.r, 10);
}
function handTotal(cards) {
  let total = cards.reduce((s, c) => s + cardValue(c), 0);
  let aces = cards.filter((c) => c.r === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}
function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}

// hace jugar al dealer (pide hasta 17) y devuelve también la secuencia de
// cartas que fue sacando, para que el cliente pueda animar el reparto.
function playDealer(deck, dealerHand) {
  const drawn = [];
  while (handTotal(dealerHand) < 17) {
    const card = deck.pop();
    dealerHand.push(card);
    drawn.push(card);
  }
  return drawn;
}

module.exports = {
  freshShoe,
  classifyPair,
  classifyTrio,
  cardValue,
  handTotal,
  isBlackjack,
  playDealer,
};
