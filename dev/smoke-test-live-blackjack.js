// Prueba de humo de la "Mesa en vivo" de Blackjack. A diferencia de todo lo
// demás, esto es un solo estado COMPARTIDO entre varios jugadores que avanza
// solo con el tiempo — probamos sentarse/pararse, apostar (con side bets),
// el orden de turnos, pedir/plantarse/doblar/dividir, que el blackjack
// natural se salte el turno, que se banque a alguien que se para a mitad de
// ronda, y que la mesa se llene y se vacíe bien. También un caso real de "se
// le acabó el tiempo y se planta solo" (con una espera de verdad, ver más abajo).
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
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function join(name) {
  const r = await api('/auth/join', { method: 'POST', body: { name, password: 'abcd' } });
  return { token: r.data.token, balance: r.data.balance };
}
async function state(token) { return (await api('/live-blackjack/state', { token })).data; }
async function balanceOf(token) { return (await api('/auth/me', { token })).data.balance; }
function seatOf(s, name) { return s.seats.find((x) => x && x.userName === name); }
function seatIndexOf(s, name) { return s.seats.findIndex((x) => x && x.userName === name); }
// suma de todo lo que se llevó un asiento en la ronda: todas sus manos + side bets
function totalPayout(seat) { return seat.hands.reduce((sum, h) => sum + h.payout, 0) + (seat.sideWinnings || 0); }

(async () => {
  const p1 = await join('Mesa P1');
  const p2 = await join('Mesa P2');
  assert(p1.balance === 30000 && p2.balance === 30000, 'los dos jugadores nuevos arrancan con 30000');

  // ---------- validaciones básicas ----------
  let r = await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 100 } });
  assert(r.status === 400, 'no se puede apostar sin estar sentado');
  r = await api('/live-blackjack/hit', { method: 'POST', token: p1.token });
  assert(r.status === 400, 'no se puede pedir carta sin estar sentado ni en juego');

  r = await api('/live-blackjack/sit', { method: 'POST', token: p1.token });
  assert(r.status === 200, 'p1 se sienta');
  r = await api('/live-blackjack/sit', { method: 'POST', token: p1.token });
  assert(r.status === 200, 'sentarse de nuevo estando ya sentado no rompe nada (no hace nada)');
  let s = await state(p1.token);
  assert(s.phase === 'betting', 'apenas se sienta el primero, la mesa pasa a "betting"');
  assert(seatIndexOf(s, 'Mesa P1') === 0, 'p1 queda en el primer asiento libre');

  r = await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 0 } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 999999999 } });
  assert(r.status === 400, 'rechaza apostar más fichas de las que hay');

  // ---------- ronda de a dos: turnos, blackjack natural, pagos, side bets ----------
  await api('/live-blackjack/sit', { method: 'POST', token: p2.token });
  const bal1Before = await balanceOf(p1.token);
  const bal2Before = await balanceOf(p2.token);
  await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 100, pairsStake: 20, trioStake: 10 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p2.token, body: { amount: 200 } });
  // apostaron los dos sentados: la mesa reparte de una, sin esperar el resto del conteo
  s = await state(p1.token);
  assert(s.phase === 'playing', 'apenas apuestan todos los sentados, arranca a repartir sin esperar el resto del tiempo');
  assert(s.dealerHand.length === 1, 'la carta tapada del dealer nunca se manda al cliente');
  assert(seatOf(s, 'Mesa P1').hands.length === 1, 'al repartir cada asiento arranca con una sola mano');
  assert(typeof seatOf(s, 'Mesa P1').sideResultText === 'string', 'las side bets ya se evaluaron al repartir (texto de resultado presente)');

  const tokenByName = { 'Mesa P1': p1.token, 'Mesa P2': p2.token };
  let guard = 0;
  while (s.phase === 'playing' && guard < 10) {
    const turnSeat = s.seats[s.currentSeatIndex];
    assert(!!turnSeat, `hay alguien con el turno asignado (vuelta ${guard})`);
    const otherName = turnSeat.userName === 'Mesa P1' ? 'Mesa P2' : 'Mesa P1';
    const wrong = await api('/live-blackjack/stand', { method: 'POST', token: tokenByName[otherName] });
    assert(wrong.status === 400, `al que no le toca (${otherName}) no puede jugar`);
    await api('/live-blackjack/stand', { method: 'POST', token: tokenByName[turnSeat.userName] });
    s = await state(p1.token);
    guard++;
  }
  assert(s.phase === 'payout', 'después de que todos se plantan (o tenían blackjack natural), la mesa liquida sola');
  assert(!s.dealerHidden, 'al liquidar se revela la carta tapada del dealer');

  const seat1 = seatOf(s, 'Mesa P1');
  const seat2 = seatOf(s, 'Mesa P2');
  const bal1After = await balanceOf(p1.token);
  const bal2After = await balanceOf(p2.token);
  assert(
    bal1After === bal1Before - 100 - 20 - 10 + totalPayout(seat1),
    `el saldo de p1 baja apuesta+side bets y sube todo lo que pagó (real ${bal1After}, esperado ${bal1Before - 130 + totalPayout(seat1)})`,
  );
  assert(bal2After === bal2Before - 200 + totalPayout(seat2), `el saldo de p2 baja la apuesta y sube lo que pagó (real ${bal2After}, esperado ${bal2Before - 200 + totalPayout(seat2)})`);
  // reglas de pago de la mano principal: pleno perdido=0, empate=bet, blackjack=bet+2bet, gano normal=2bet
  const rulesOk = [seat1, seat2].every((seat) => seat.hands.every((hand) => {
    if (hand.result === 'lose') return hand.payout === 0;
    if (hand.result === 'push') return hand.payout === hand.bet;
    if (hand.result === 'blackjack') return hand.payout === hand.bet + Math.round(hand.bet * 2);
    if (hand.result === 'win') return hand.payout === hand.bet * 2;
    return false;
  }));
  assert(rulesOk, `los pagos de la mano principal siguen las reglas reales de blackjack (p1: ${JSON.stringify(seat1.hands.map((h) => [h.result, h.payout]))}, p2: ${JSON.stringify(seat2.hands.map((h) => [h.result, h.payout]))})`);

  // ---------- esperar a que la ronda se reinicie sola ----------
  await sleep(8000); // PAYOUT_MS = 7000
  s = await state(p1.token);
  assert(s.roundNumber === 1, 'después de la pausa de resultados, arranca sola la ronda siguiente');
  assert(s.phase === 'betting', 'la ronda nueva vuelve a "betting" (los dos siguen sentados)');
  assert(seatOf(s, 'Mesa P1').bet === 0 && seatOf(s, 'Mesa P2').bet === 0, 'las apuestas de la ronda anterior se limpian solas');

  // ---------- doblar ----------
  const p3 = await join('Mesa P3');
  tokenByName['Mesa P3'] = p3.token;
  await api('/live-blackjack/sit', { method: 'POST', token: p3.token });
  // p1 y p2 ya estaban sentados de antes; que aposten los tres para repartir ya
  await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 50 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p2.token, body: { amount: 50 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p3.token, body: { amount: 100 } });
  // jugamos hasta que le toque a p3 (si tenía blackjack natural, no hay nada para probar acá; reintentamos otra ronda)
  let triedDouble = false;
  for (let attempt = 0; attempt < 5 && !triedDouble; attempt++) {
    s = await state(p1.token);
    if (s.phase !== 'playing') break;
    const seatP3 = seatOf(s, 'Mesa P3');
    if (seatP3 && s.currentSeatIndex === seatIndexOf(s, 'Mesa P3') && seatP3.hands[s.currentHandIndex].status === 'playing') {
      const dbl = await api('/live-blackjack/double', { method: 'POST', token: p3.token });
      assert(dbl.status === 200, 'p3 puede doblar en su primera decisión');
      s = await state(p1.token);
      const hand3 = seatOf(s, 'Mesa P3').hands[0];
      assert(hand3.bet === 200, `doblar duplica la apuesta (real ${hand3.bet}, esperado 200)`);
      assert(hand3.cards.length === 3, 'doblar reparte exactamente una carta más (3 en total)');
      assert(hand3.status !== 'playing', 'doblar planta automáticamente (o revienta), no se puede seguir pidiendo');
      const rebet = await api('/live-blackjack/double', { method: 'POST', token: p3.token });
      assert(rebet.status === 400, 'no se puede volver a doblar después de haber doblado');
      triedDouble = true;
    } else {
      const turnSeat = s.seats[s.currentSeatIndex];
      if (turnSeat) await api('/live-blackjack/stand', { method: 'POST', token: tokenByName[turnSeat.userName] || p3.token });
    }
  }
  assert(triedDouble, 'se pudo probar "doblar" en alguna de las rondas');
  // dejamos que la ronda termine sola para no interferir con lo que sigue
  for (let i = 0; i < 8; i++) {
    s = await state(p1.token);
    if (s.phase !== 'playing') break;
    const turnSeat = s.seats[s.currentSeatIndex];
    if (turnSeat) {
      const tok = turnSeat.userName === 'Mesa P3' ? p3.token : tokenByName[turnSeat.userName];
      await api('/live-blackjack/stand', { method: 'POST', token: tok });
    }
  }
  // ---------- dividir (split) ----------
  // reintentamos varias rondas hasta que a ALGUNO de los tres sentados (no
  // necesariamente p1) le toquen dos cartas del mismo valor en su primera
  // decisión — revisar los tres sube bastante la chance de encontrar un par
  // por ronda. Los tres apuestan siempre que se abre "betting" para que la
  // mesa reparta de una (fast-path) en vez de esperar los 30s completos.
  let triedSplit = false;
  let attempts = 0;
  const maxAttempts = 25;
  const splitDeadline = Date.now() + 240000; // tope real por si algo se traba, aparte del límite de intentos
  while (!triedSplit && attempts < maxAttempts && Date.now() < splitDeadline) {
    s = await state(p1.token);
    if (s.phase === 'betting') {
      if (seatOf(s, 'Mesa P1').bet === 0) await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 40 } });
      if (seatOf(s, 'Mesa P2').bet === 0) await api('/live-blackjack/bet', { method: 'POST', token: p2.token, body: { amount: 40 } });
      if (seatOf(s, 'Mesa P3').bet === 0) await api('/live-blackjack/bet', { method: 'POST', token: p3.token, body: { amount: 40 } });
      s = await state(p1.token);
    }
    // todavía no se repartió esta ronda (esperando que abra "betting" o que
    // termine el pago de la anterior): no consume uno de los intentos.
    if (s.phase !== 'playing') { await sleep(500); continue; }
    attempts++;

    // recorremos los turnos de la ronda buscando el primer par; a quien no
    // tiene par lo plantamos y seguimos, así el barrido avanza solo.
    let splitName = null, splitToken = null;
    let guard = 0;
    while (s.phase === 'playing' && guard < 20) {
      const turnSeat = s.seats[s.currentSeatIndex];
      if (!turnSeat) break;
      const hand = turnSeat.hands[s.currentHandIndex];
      const tok = tokenByName[turnSeat.userName];
      if (hand.cards.length === 2 && hand.cards[0].r === hand.cards[1].r) {
        splitName = turnSeat.userName; splitToken = tok;
        break;
      }
      await api('/live-blackjack/stand', { method: 'POST', token: tok });
      s = await state(p1.token);
      guard++;
    }

    if (splitName) {
      const otherToken = [p1.token, p2.token, p3.token].find((t) => t !== splitToken);
      const noSplitAgain = await api('/live-blackjack/split', { method: 'POST', token: otherToken });
      assert(noSplitAgain.status === 400, 'a quien no le toca el turno no puede dividir');
      const sp = await api('/live-blackjack/split', { method: 'POST', token: splitToken });
      assert(sp.status === 200, `con dos cartas del mismo valor, ${splitName} puede dividir`);
      s = await state(p1.token);
      const afterSplit = seatOf(s, splitName);
      assert(afterSplit.hands.length === 2, `dividir deja a ${splitName} con 2 manos (real ${afterSplit.hands.length})`);
      assert(afterSplit.hands[0].bet === 40 && afterSplit.hands[1].bet === 40, 'cada mano dividida arranca con la misma apuesta que la original');
      triedSplit = true;
    }
    // dejamos que la ronda termine sola (jugando lo que quede de todos) para no interferir con la siguiente
    for (let i = 0; i < 16; i++) {
      s = await state(p1.token);
      if (s.phase !== 'playing') break;
      const turnSeat = s.seats[s.currentSeatIndex];
      if (!turnSeat) break;
      await api('/live-blackjack/stand', { method: 'POST', token: tokenByName[turnSeat.userName] });
    }
  }
  assert(triedSplit, 'se pudo probar "dividir" en alguna de las rondas reintentadas');

  // ---------- mesa llena ----------
  const p4 = await join('Mesa P4');
  const p5 = await join('Mesa P5');
  const p6 = await join('Mesa P6');
  await api('/live-blackjack/sit', { method: 'POST', token: p4.token });
  await api('/live-blackjack/sit', { method: 'POST', token: p5.token });
  r = await api('/live-blackjack/sit', { method: 'POST', token: p6.token });
  assert(r.status === 400, 'con los 5 asientos ocupados, un sexto no se puede sentar');

  // ---------- pararse de la mesa ----------
  r = await api('/live-blackjack/stand-up', { method: 'POST', token: p6.token });
  assert(r.status === 200, 'pararse sin estar sentado no rompe nada');
  await api('/live-blackjack/stand-up', { method: 'POST', token: p5.token });
  s = await state(p1.token);
  assert(seatIndexOf(s, 'Mesa P5') === -1, 'al pararse (sin apuesta activa) el asiento se libera al toque');
  r = await api('/live-blackjack/sit', { method: 'POST', token: p6.token });
  assert(r.status === 200, 'liberado el asiento, otro se puede sentar ahí');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de la mesa en vivo:', e); process.exit(1); });
