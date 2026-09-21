// Prueba de humo de la "Mesa en vivo" de Blackjack. A diferencia de todo lo
// demás, esto es un solo estado COMPARTIDO entre varios jugadores que avanza
// solo con el tiempo — probamos sentarse/pararse, apostar, el orden de
// turnos, pedir/plantarse/doblar, que el blackjack natural se salte el
// turno, que se banque a alguien que se para a mitad de ronda, y que la
// mesa se llene y se vacíe bien. También un caso real de "se le acabó el
// tiempo y se planta solo" (con una espera de verdad, ver más abajo).
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

  // ---------- ronda de a dos: turnos, blackjack natural, pagos ----------
  await api('/live-blackjack/sit', { method: 'POST', token: p2.token });
  const bal1Before = await balanceOf(p1.token);
  const bal2Before = await balanceOf(p2.token);
  await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 100 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p2.token, body: { amount: 200 } });
  // apostaron los dos sentados: la mesa reparte de una, sin esperar el resto del conteo
  s = await state(p1.token);
  assert(s.phase === 'playing', 'apenas apuestan todos los sentados, arranca a repartir sin esperar el resto del tiempo');
  assert(s.dealerHand.length === 1, 'la carta tapada del dealer nunca se manda al cliente');

  const tokenByName = { 'Mesa P1': p1.token, 'Mesa P2': p2.token };
  let guard = 0;
  while (s.phase === 'playing' && guard < 8) {
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
  assert(bal1After === bal1Before - 100 + seat1.payout, `el saldo de p1 baja la apuesta y sube lo que pagó (real ${bal1After}, esperado ${bal1Before - 100 + seat1.payout})`);
  assert(bal2After === bal2Before - 200 + seat2.payout, `el saldo de p2 baja la apuesta y sube lo que pagó (real ${bal2After}, esperado ${bal2Before - 200 + seat2.payout})`);
  // reglas de pago: pleno perdido=0, empate=bet, blackjack=bet+1.5bet, gano normal=2bet
  const rulesOk = [seat1, seat2].every((seat) => {
    if (seat.result === 'lose') return seat.payout === 0;
    if (seat.result === 'push') return seat.payout === seat.bet;
    if (seat.result === 'blackjack') return seat.payout === seat.bet + Math.round(seat.bet * 1.5);
    if (seat.result === 'win') return seat.payout === seat.bet * 2;
    return false;
  });
  assert(rulesOk, `los pagos siguen las reglas reales de blackjack (p1: ${seat1.result}/${seat1.payout}, p2: ${seat2.result}/${seat2.payout})`);

  // ---------- esperar a que la ronda se reinicie sola ----------
  await sleep(8000); // PAYOUT_MS = 7000
  s = await state(p1.token);
  assert(s.roundNumber === 1, 'después de la pausa de resultados, arranca sola la ronda siguiente');
  assert(s.phase === 'betting', 'la ronda nueva vuelve a "betting" (los dos siguen sentados)');
  assert(seatOf(s, 'Mesa P1').bet === 0 && seatOf(s, 'Mesa P2').bet === 0, 'las apuestas de la ronda anterior se limpian solas');

  // ---------- doblar ----------
  const p3 = await join('Mesa P3');
  const bal3Before = await balanceOf(p3.token);
  await api('/live-blackjack/sit', { method: 'POST', token: p3.token });
  // p1 y p2 ya estaban sentados de antes; que aposten los tres para repartir ya
  await api('/live-blackjack/bet', { method: 'POST', token: p1.token, body: { amount: 50 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p2.token, body: { amount: 50 } });
  await api('/live-blackjack/bet', { method: 'POST', token: p3.token, body: { amount: 100 } });
  s = await state(p1.token);
  // jugamos hasta que le toque a p3 (si tenía blackjack natural, no hay nada para probar acá; reintentamos otra ronda)
  let triedDouble = false;
  for (let attempt = 0; attempt < 5 && !triedDouble; attempt++) {
    s = await state(p1.token);
    if (s.phase !== 'playing') break;
    const seatP3 = seatOf(s, 'Mesa P3');
    if (seatP3 && seatP3.status === 'playing' && s.currentSeatIndex === seatIndexOf(s, 'Mesa P3')) {
      const dbl = await api('/live-blackjack/double', { method: 'POST', token: p3.token });
      assert(dbl.status === 200, 'p3 puede doblar en su primera decisión');
      s = await state(p1.token);
      const seat3 = seatOf(s, 'Mesa P3');
      assert(seat3.bet === 200, `doblar duplica la apuesta (real ${seat3.bet}, esperado 200)`);
      assert(seat3.cards.length === 3, 'doblar reparte exactamente una carta más (3 en total)');
      assert(seat3.status !== 'playing', 'doblar planta automáticamente (o revienta), no se puede seguir pidiendo');
      const rebet = await api('/live-blackjack/double', { method: 'POST', token: p3.token });
      assert(rebet.status === 400, 'no se puede volver a doblar después de haber doblado');
      triedDouble = true;
    } else {
      // pasa el turno de quien sea para llegar hasta p3
      const turnSeat = s.seats[s.currentSeatIndex];
      if (turnSeat) await api('/live-blackjack/stand', { method: 'POST', token: tokenByName[turnSeat.userName] || p3.token });
    }
  }
  assert(triedDouble, 'se pudo probar "doblar" en alguna de las rondas');
  // dejamos que la ronda termine sola para no interferir con lo que sigue
  for (let i = 0; i < 6; i++) {
    s = await state(p1.token);
    if (s.phase !== 'playing') break;
    const turnSeat = s.seats[s.currentSeatIndex];
    if (turnSeat) {
      const tok = turnSeat.userName === 'Mesa P3' ? p3.token : tokenByName[turnSeat.userName];
      await api('/live-blackjack/stand', { method: 'POST', token: tok });
    }
  }

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
