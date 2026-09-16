// Prueba de humo de "Tragamonedas". Giramos muchas veces con una apuesta
// chica hasta ver un giro base que gane, y hasta que toque la ronda bonus
// (scatter), y ahí jugamos los giros gratis completos verificando que el
// saldo y el multiplicador acumulado cierren en cada paso.
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

(async () => {
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Slots Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones ----------
  r = await api('/slots/spin', { method: 'POST', token, body: { stake: 0 } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/slots/spin', { method: 'POST', token, body: { stake: -50 } });
  assert(r.status === 400, 'rechaza apuesta negativa');
  r = await api('/slots/bonus-spin', { method: 'POST', token });
  assert(r.status === 400, 'no se puede pedir un giro gratis sin ronda bonus en juego');
  r = await api('/slots/state', { token });
  assert(r.data.bonus === null, 'sin ninguna ronda bonus todavía, el estado es null');

  // ---------- girar hasta ver un giro base que gane algo ----------
  const STAKE = 100;
  let sawBaseWin = false;
  let balanceBefore;
  for (let i = 0; i < 400 && !sawBaseWin; i++) {
    balanceBefore = (await api('/auth/me', { token })).data.balance;
    r = await api('/slots/spin', { method: 'POST', token, body: { stake: STAKE } });
    assert(r.status === 200, `giro base ${i}: aceptado`);
    assert(r.data.balance === balanceBefore - STAKE + r.data.totalWin, `giro base ${i}: el saldo baja la apuesta y suma lo ganado`);
    assert(r.data.grid.length === 5 && r.data.grid[0].length === 3, `giro base ${i}: la grilla es de 5x3`);
    if (r.data.totalWin > 0 && !r.data.bonus) sawBaseWin = true;
  }
  assert(sawBaseWin, 'en 400 giros hubo al menos uno que ganó algo sin tocar bonus');

  // no se puede pedir un giro gratis mientras no hay ronda bonus
  r = await api('/slots/bonus-spin', { method: 'POST', token });
  assert(r.status === 400, 'sigue sin poder pedir giro gratis (no hay bonus activo)');

  // ---------- girar hasta que toque la ronda bonus (3+ scatter) ----------
  let bonusSpin = null;
  for (let i = 0; i < 600 && !bonusSpin; i++) {
    r = await api('/slots/spin', { method: 'POST', token, body: { stake: STAKE } });
    if (r.data.bonus) bonusSpin = r.data;
  }
  assert(!!bonusSpin, 'en 600 giros tocó la ronda bonus al menos una vez');
  if (bonusSpin) {
    assert(bonusSpin.bonus.freeSpinsLeft === bonusSpin.bonus.totalFreeSpins, 'la ronda bonus arranca con todos los giros gratis disponibles');
    assert([8, 10, 12].includes(bonusSpin.bonus.totalFreeSpins), 'la cantidad de giros gratis es 8, 10 o 12 según cuántos scatters salieron');
    assert(bonusSpin.scatterCount >= 3, 'el giro que disparó el bonus tuvo 3 o más scatters');

    // durante la ronda bonus no se puede pedir un giro base pagado
    r = await api('/slots/spin', { method: 'POST', token, body: { stake: STAKE } });
    assert(r.status === 400, 'no se puede pedir un giro base mientras hay giros gratis pendientes');

    // ---------- consumir todos los giros gratis ----------
    let collectedTotal = 0;
    let last = null;
    for (let i = 0; i < bonusSpin.bonus.totalFreeSpins; i++) {
      const before = (await api('/auth/me', { token })).data.balance;
      last = (await api('/slots/bonus-spin', { method: 'POST', token })).data;
      assert(last !== undefined, `giro gratis ${i}: respuesta recibida`);
      collectedTotal += last.collectedThisSpin;
      assert(Math.abs(last.totalCollected - collectedTotal) < 1e-9, `giro gratis ${i}: el multiplicador acumulado coincide con lo que fue juntando`);
      if (!last.finished) {
        assert(last.balance === before, `giro gratis ${i}: el saldo no cambia hasta el último giro`);
      } else {
        const expectedPayout = Math.round(bonusSpin.bonus.stake * last.totalCollected * 100) / 100;
        assert(Math.abs(last.payout - expectedPayout) < 1e-6, 'el pago final es la apuesta original x el multiplicador acumulado');
        assert(Math.abs(last.balance - (before + expectedPayout)) < 1e-6, 'el saldo sube justo el pago final');
      }
    }
    assert(last.finished, 'el último giro gratis cierra la ronda bonus');
    assert(last.freeSpinsLeft === 0, 'no quedan giros gratis después del último');

    // ronda bonus ya cerrada: no se puede pedir otro giro gratis, y el estado vuelve a null
    r = await api('/slots/bonus-spin', { method: 'POST', token });
    assert(r.status === 400, 'terminada la ronda bonus, ya no se puede pedir otro giro gratis');
    r = await api('/slots/state', { token });
    assert(r.data.bonus === null, 'el estado vuelve a mostrar que no hay ninguna ronda bonus en juego');

    // y ahora sí se puede volver a girar pagando
    r = await api('/slots/spin', { method: 'POST', token, body: { stake: STAKE } });
    assert(r.status === 200, 'después de la ronda bonus se puede volver a girar normal');
  }

  // ---------- comprar la ronda bonus directo (sin esperar 3+ scatters) ----------
  r = await api('/slots/buy-bonus', { method: 'POST', token, body: { stake: 0 } });
  assert(r.status === 400, 'comprar bonus también rechaza apostar 0');
  const balanceBeforeBuy = (await api('/auth/me', { token })).data.balance;
  const buyStake = 50;
  const buyCost = buyStake * 100;
  r = await api('/slots/buy-bonus', { method: 'POST', token, body: { stake: buyStake } });
  assert(r.status === 200, 'comprar bonus aceptado');
  assert(r.data.balance === balanceBeforeBuy - buyCost, 'comprar bonus cobra 100x lo apostado');
  assert(r.data.bonus.totalFreeSpins === 8, 'comprar bonus siempre da 8 giros gratis');
  assert(r.data.bonus.freeSpinsLeft === 8, 'arranca con los 8 giros gratis completos');
  assert(r.data.bonus.collected === 0, 'arranca sin nada juntado todavía');

  // no se puede comprar otro bonus (ni girar) mientras el comprado sigue en juego
  r = await api('/slots/buy-bonus', { method: 'POST', token, body: { stake: buyStake } });
  assert(r.status === 400, 'no se puede comprar otro bonus mientras hay uno en juego');
  r = await api('/slots/spin', { method: 'POST', token, body: { stake: buyStake } });
  assert(r.status === 400, 'no se puede girar pagando mientras el bonus comprado sigue en juego');

  // consumir los 8 giros gratis del bonus comprado
  let boughtCollected = 0, boughtLast = null;
  for (let i = 0; i < 8; i++) {
    boughtLast = (await api('/slots/bonus-spin', { method: 'POST', token })).data;
    boughtCollected += boughtLast.collectedThisSpin;
  }
  assert(boughtLast.finished, 'el bonus comprado también termina después de sus 8 giros');
  const expectedBoughtPayout = Math.round(buyStake * boughtLast.totalCollected * 100) / 100;
  assert(Math.abs(boughtLast.payout - expectedBoughtPayout) < 1e-6, 'el pago del bonus comprado también es la apuesta puesta x lo juntado');
  r = await api('/slots/state', { token });
  assert(r.data.bonus === null, 'después del bonus comprado tampoco queda ninguna ronda en juego');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de tragamonedas:', e); process.exit(1); });
