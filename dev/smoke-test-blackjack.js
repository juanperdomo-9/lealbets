// Prueba de humo del Blackjack. Como las cartas son al azar, no se puede
// predecir el resultado de una mano — pero sí se puede RECALCULAR de forma
// independiente (con las mismas funciones puras que usa el servidor) qué
// tendría que haber pasado dadas las cartas que el servidor devolvió, y
// comparar contra el saldo real y el resultado declarado. Si el server
// hiciera trampa o tuviera un bug de cálculo, esto lo detecta.
const { handTotal, isBlackjack, classifyPair, classifyTrio } = require('../server/blackjack');

const BASE = 'http://localhost:3000/api';
let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('OK   -', msg);
  else { console.log('FAIL -', msg); failures++; }
}
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
async function balanceOf(token) {
  const r = await api('/auth/me', { token });
  return r.data.balance;
}
// misma lógica de liquidación que server/routes/blackjack.js, para verificar
// de forma independiente lo que el servidor dice que pasó.
function expectedPayout(hands, dealerHand) {
  const dealerTotal = handTotal(dealerHand);
  const dealerBJ = isBlackjack(dealerHand);
  let total = 0;
  for (const hand of hands) {
    const t = handTotal(hand.cards);
    const playerBJ = isBlackjack(hand.cards) && !hand.isSplitResult;
    if (t > 21) continue;
    if (playerBJ && dealerBJ) total += hand.bet;
    else if (playerBJ) total += hand.bet + Math.round(hand.bet * 1.5);
    else if (dealerBJ) continue;
    else if (dealerTotal > 21 || t > dealerTotal) total += hand.bet * 2;
    else if (t === dealerTotal) total += hand.bet;
  }
  return total;
}

(async () => {
  let r = await api('/auth/join', { method: 'POST', body: { name: 'BJ Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones básicas ----------
  r = await api('/blackjack/deal', { method: 'POST', token, body: { stake: 0 } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/blackjack/deal', { method: 'POST', token, body: { stake: 100, pairsStake: -5 } });
  assert(r.status === 400, 'rechaza side bet negativa');
  r = await api('/blackjack/deal', { method: 'POST', token, body: { stake: 999999 } });
  assert(r.status === 400, 'rechaza apostar más de lo que tiene');
  r = await api('/blackjack/state', { token });
  assert(r.data.phase === 'none', 'sin ninguna mano repartida todavía, el estado es "none"');

  // ---------- jugar varias manos, verificando cada movimiento de fichas ----------
  let sawSplit = false;
  let sawDouble = false;
  for (let hand = 0; hand < 80 && (!sawSplit || !sawDouble); hand++) {
    const stake = 100, pairsStake = 10, trioStake = 10;
    const balanceBeforeDeal = await balanceOf(token);

    r = await api('/blackjack/deal', { method: 'POST', token, body: { stake, pairsStake, trioStake } });
    assert(r.status === 200, `mano ${hand}: repartida ok`);
    let g = r.data;
    // (la resta de las apuestas y el pago de side bets pasan en la misma transacción del
    // reparto, así que lo que se puede observar y verificar es el resultado combinado —
    // eso se chequea abajo, incluyendo cuánto correspondía ganar por las side bets.)

    const [p1, p2] = g.hands[0].cards;
    const pair = classifyPair(p1, p2);
    const trio = classifyTrio([p1, p2, g.dealerHand[0]]);
    let expectedSideWin = 0;
    if (pair.mult > 0) expectedSideWin += pairsStake * pair.mult;
    if (trio.mult > 0) expectedSideWin += trioStake * trio.mult;
    const expectedAfterSideBets = balanceBeforeDeal - (stake + pairsStake + trioStake) + expectedSideWin;

    if (g.phase === 'done') {
      // blackjack natural (jugador y/o dealer): el deal liquida side bets Y mano
      // principal en la misma respuesta, así que el único estado observable es el combinado.
      const expectedMain = expectedPayout(g.hands, g.dealerHand);
      const expectedFinal = expectedAfterSideBets + expectedMain;
      assert(g.balance === expectedFinal, `mano ${hand} (blackjack natural): side bets + pago final combinados correctos (${g.balance} == ${expectedFinal}, pair=${pair.name}, trio=${trio.name})`);
      continue;
    }

    // no fue blackjack natural: acá sí se puede observar el estado "solo side bets" por separado
    assert(g.balance === expectedAfterSideBets, `mano ${hand}: side bets liquidadas correctamente en el reparto (${g.balance} == ${expectedAfterSideBets}, pair=${pair.name}, trio=${trio.name})`);

    // ojo: si doblar o dividir dejan la mano sin más jugadas posibles (p. ej. única
    // mano, o ambas manos de un split de ases quedan plantadas), esa misma respuesta
    // YA viene con la liquidación final incluida (fase 'done'), no solo el descuento
    // de la ficha extra. Por eso acá solo sumamos lo apostado de más y NO comparamos
    // el saldo intermedio — se compara todo junto una sola vez al final, sea cual sea
    // el momento en que la mano terminó de resolverse.
    let extraStaked = 0;

    if (!sawSplit && p1.r === p2.r) {
      sawSplit = true;
      r = await api('/blackjack/split', { method: 'POST', token });
      assert(r.status === 200, `mano ${hand}: split aceptado con un par inicial`);
      g = r.data;
      extraStaked += stake;
      assert(g.hands.length === 2, 'después de dividir hay 2 manos');
    }

    if (!sawDouble && g.phase === 'playing') {
      const activeHand = g.hands[g.currentHandIndex];
      if (activeHand && activeHand.cards.length === 2) {
        sawDouble = true;
        const betBefore = activeHand.bet;
        r = await api('/blackjack/double', { method: 'POST', token });
        assert(r.status === 200, `mano ${hand}: double aceptado con 2 cartas`);
        g = r.data;
        extraStaked += betBefore;
      }
    }

    // jugamos lo que quede pendiente: pedimos hasta 17+, después plantamos
    let guard = 0;
    while (g.phase === 'playing' && guard++ < 20) {
      const activeHand = g.hands[g.currentHandIndex];
      const total = handTotal(activeHand.cards);
      const action = total < 17 ? 'hit' : 'stand';
      r = await api(`/blackjack/${action}`, { method: 'POST', token });
      assert(r.status === 200, `mano ${hand}: ${action} aceptado`);
      g = r.data;
    }
    assert(g.phase === 'done', `mano ${hand}: terminó resuelta`);

    const expectedMain = expectedPayout(g.hands, g.dealerHand);
    const expectedFinal = expectedAfterSideBets - extraStaked + expectedMain;
    assert(g.balance === expectedFinal, `mano ${hand}: saldo final correcto (side bets + apuestas extra de split/double + liquidación) (${g.balance} == ${expectedFinal})`);
  }

  assert(sawSplit, 'en 80 manos apareció al menos un par inicial para probar split (si falla: mala suerte estadística, ~0.1% de chance)');
  assert(sawDouble, 'se probó doblar en alguna mano');

  // no se puede repartir de nuevo mientras hay una mano en juego
  r = await api('/blackjack/deal', { method: 'POST', token, body: { stake: 100 } });
  // en este punto la última mano del for ya quedó 'done', así que debería aceptar una nueva.
  // Forzamos el caso "en juego": repartimos y, sin jugarla, intentamos repartir de nuevo.
  if (r.status === 200 && r.data.phase === 'playing') {
    const r2 = await api('/blackjack/deal', { method: 'POST', token, body: { stake: 100 } });
    assert(r2.status === 400, 'rechaza repartir de nuevo mientras hay una mano en juego');
    // la cerramos jugándola para no dejar el estado colgado
    let g = r.data;
    let guard = 0;
    while (g.phase === 'playing' && guard++ < 20) {
      const activeHand = g.hands[g.currentHandIndex];
      const action = handTotal(activeHand.cards) < 17 ? 'hit' : 'stand';
      const rr = await api(`/blackjack/${action}`, { method: 'POST', token });
      g = rr.data;
    }
  }

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de blackjack:', e); process.exit(1); });
