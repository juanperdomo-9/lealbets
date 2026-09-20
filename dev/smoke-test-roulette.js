// Prueba de humo de "Ruleta". Un solo cero, sin varios pasos: cada giro se
// resuelve solo. Se puede mandar varias fichas juntas en un solo giro (como
// en una mesa real) — probamos las validaciones, cada tipo de apuesta
// (incluidos caballo y cuadro), que los pagos sean los reales de la ruleta
// europea, y que varias apuestas a la vez se liquiden todas contra el mismo
// número sorteado.
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
function bet(type, value, amount) { return { type, value, amount }; }
// gira hasta encontrar un resultado donde la apuesta en la posición `idx`
// (del arreglo bets) haya ganado (o perdido, según wantWin)
async function spinUntil(token, bets, idx, wantWin, maxTries) {
  for (let i = 0; i < maxTries; i++) {
    const r = await api('/roulette/spin', { method: 'POST', token, body: { bets } });
    if (r.data.error) return { error: r.data.error };
    if (r.data.results[idx].won === wantWin) return r.data;
  }
  return null;
}

(async () => {
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Roulette Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones ----------
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [] } });
  assert(r.status === 400, 'rechaza girar sin ninguna ficha puesta');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('red', null, 0)] } });
  assert(r.status === 400, 'rechaza una ficha de 0');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('red', null, -10)] } });
  assert(r.status === 400, 'rechaza una ficha negativa');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('nada', null, 100)] } });
  assert(r.status === 400, 'rechaza un tipo de apuesta inválido');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('number', 99, 100)] } });
  assert(r.status === 400, 'rechaza un número fuera de rango (99)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('dozen', 5, 100)] } });
  assert(r.status === 400, 'rechaza una docena inválida (5)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('split', [1, 9], 100)] } });
  assert(r.status === 400, 'rechaza un caballo entre números que no son vecinos (1-9)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('corner', [1, 2, 3, 4], 100)] } });
  assert(r.status === 400, 'rechaza un cuadro que no forma un bloque real (1-2-3-4)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('red', null, 999999999)] } });
  assert(r.status === 400, 'rechaza apostar más fichas de las que hay');
  // si UNA sola ficha del combo es inválida, se rechaza el giro entero (no se cobra nada)
  const balanceBeforeBad = (await api('/auth/me', { token })).data.balance;
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('red', null, 100), bet('number', 99, 100)] } });
  assert(r.status === 400, 'si una ficha del combo es inválida, se rechaza el giro completo');
  const balanceAfterBad = (await api('/auth/me', { token })).data.balance;
  assert(balanceAfterBad === balanceBeforeBad, 'un giro rechazado no cobra nada, ni la parte válida del combo');

  // ---------- pleno (número exacto): x36 ----------
  let win = await spinUntil(token, [bet('number', 17, 50)], 0, true, 500);
  assert(!!win, 'en 500 giros el pleno al 17 salió ganador al menos una vez');
  if (win) assert(win.results[0].payout === 50 * 36, `pleno paga x36 (real ${win.results[0].payout}, esperado 1800)`);

  // ---------- caballo (2 números vecinos): x18 ----------
  win = await spinUntil(token, [bet('split', [3, 6], 50)], 0, true, 500);
  assert(!!win, 'en 500 giros el caballo 3-6 salió ganador al menos una vez');
  if (win) assert(win.results[0].payout === 50 * 18, `caballo paga x18 (real ${win.results[0].payout}, esperado 900)`);
  win = await spinUntil(token, [bet('split', [0, 1], 50)], 0, true, 800);
  assert(!!win, 'en 800 giros el caballo 0-1 salió ganador al menos una vez');
  if (win) assert([0, 1].includes(win.winningNumber), 'el caballo 0-1 solo gana si sale 0 o 1');

  // ---------- cuadro (4 números): x9 ----------
  win = await spinUntil(token, [bet('corner', [1, 2, 4, 5], 50)], 0, true, 300);
  assert(!!win, 'en 300 giros el cuadro 1-2-4-5 salió ganador al menos una vez');
  if (win) {
    assert(win.results[0].payout === 50 * 9, `cuadro paga x9 (real ${win.results[0].payout}, esperado 450)`);
    assert([1, 2, 4, 5].includes(win.winningNumber), 'el cuadro 1-2-4-5 solo gana con uno de esos 4 números');
  }

  // ---------- apuestas de afuera: x2 y x3 ----------
  win = await spinUntil(token, [bet('red', null, 100)], 0, true, 40);
  assert(!!win, 'en 40 giros salió rojo al menos una vez');
  if (win) assert(win.results[0].payout === 100 * 2, `rojo paga x2 (real ${win.results[0].payout}, esperado 200)`);

  win = await spinUntil(token, [bet('dozen', 2, 100)], 0, true, 60);
  assert(!!win, 'en 60 giros ganó la 2ª docena al menos una vez');
  if (win) {
    assert(win.results[0].payout === 100 * 3, `docena paga x3 (real ${win.results[0].payout}, esperado 300)`);
    assert(win.winningNumber >= 13 && win.winningNumber <= 24, 'la 2ª docena solo gana con 13 a 24');
  }

  // el 0 no es par, impar, rojo, negro, ni entra en ninguna docena/columna
  let sawZero = false, zeroCountedAsWin = false;
  for (let i = 0; i < 300; i++) {
    const s = await api('/roulette/spin', { method: 'POST', token, body: { bets: [bet('even', null, 10)] } });
    if (s.data.winningNumber === 0) { sawZero = true; if (s.data.results[0].won) zeroCountedAsWin = true; }
  }
  assert(sawZero, 'en 300 giros salió el 0 al menos una vez (para poder chequear la regla)');
  assert(!zeroCountedAsWin, 'salir 0 nunca cuenta como ganador de "par"');

  // ---------- varias fichas en un solo giro (como una mesa real) ----------
  const before = (await api('/auth/me', { token })).data.balance;
  const combo = [bet('red', null, 100), bet('number', 17, 100), bet('dozen', 2, 500)];
  r = await api('/roulette/spin', { method: 'POST', token, body: { bets: combo } });
  assert(r.status === 200, 'un giro con 3 fichas distintas se acepta');
  assert(r.data.results.length === 3, 'devuelve el resultado de cada una de las 3 fichas por separado');
  assert(r.data.totalStake === 700, `cobra la suma de las 3 fichas (real ${r.data.totalStake}, esperado 700)`);
  const expectedPayout = r.data.results.reduce((s, res) => s + res.payout, 0);
  assert(r.data.totalPayout === expectedPayout, 'el pago total es la suma de lo que pagó cada ficha por separado');
  assert(r.data.balance === before - 700 + r.data.totalPayout, 'el saldo baja el total apostado y sube el total pagado');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de ruleta:', e); process.exit(1); });
