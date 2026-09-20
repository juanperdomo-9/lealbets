// Prueba de humo de "Ruleta". Un solo cero, sin varios pasos: cada giro se
// resuelve solo. Probamos las validaciones, cada tipo de apuesta (incluidos
// caballo y cuadro), y que los pagos sean los reales de la ruleta europea.
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
// gira hasta encontrar un resultado ganador (o perdedor) para el bet dado
async function spinUntil(token, betType, betValue, stake, wantWin, maxTries) {
  for (let i = 0; i < maxTries; i++) {
    const r = await api('/roulette/spin', { method: 'POST', token, body: { stake, betType, betValue } });
    if (r.data.error) return { error: r.data.error };
    if (r.data.won === wantWin) return r.data;
  }
  return null;
}

(async () => {
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Roulette Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones ----------
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 0, betType: 'red' } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: -10, betType: 'red' } });
  assert(r.status === 400, 'rechaza apuesta negativa');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 100, betType: 'nada' } });
  assert(r.status === 400, 'rechaza un tipo de apuesta inválido');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 100, betType: 'number', betValue: 99 } });
  assert(r.status === 400, 'rechaza un número fuera de rango (99)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 100, betType: 'dozen', betValue: 5 } });
  assert(r.status === 400, 'rechaza una docena inválida (5)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 100, betType: 'split', betValue: [1, 9] } });
  assert(r.status === 400, 'rechaza un caballo entre números que no son vecinos (1-9)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 100, betType: 'corner', betValue: [1, 2, 3, 4] } });
  assert(r.status === 400, 'rechaza un cuadro que no forma un bloque real (1-2-3-4)');
  r = await api('/roulette/spin', { method: 'POST', token, body: { stake: 999999999, betType: 'red' } });
  assert(r.status === 400, 'rechaza apostar más fichas de las que hay');

  // ---------- pleno (número exacto): x36 ----------
  let win = await spinUntil(token, 'number', 17, 50, true, 500);
  assert(!!win, 'en 500 giros el pleno al 17 salió ganador al menos una vez');
  if (win) assert(win.payout === 50 * 36, `pleno paga x36 (real ${win.payout}, esperado 1800)`);

  // ---------- caballo (2 números vecinos): x18 ----------
  win = await spinUntil(token, 'split', [3, 6], 50, true, 500);
  assert(!!win, 'en 500 giros el caballo 3-6 salió ganador al menos una vez');
  if (win) assert(win.payout === 50 * 18, `caballo paga x18 (real ${win.payout}, esperado 900)`);
  // el caballo con el 0 también tiene que poder ganar con el 0 o con el 1
  win = await spinUntil(token, 'split', [0, 1], 50, true, 800);
  assert(!!win, 'en 800 giros el caballo 0-1 salió ganador al menos una vez');
  if (win) assert([0, 1].includes(win.winningNumber), 'el caballo 0-1 solo gana si sale 0 o 1');

  // ---------- cuadro (4 números): x9 ----------
  win = await spinUntil(token, 'corner', [1, 2, 4, 5], 50, true, 300);
  assert(!!win, 'en 300 giros el cuadro 1-2-4-5 salió ganador al menos una vez');
  if (win) {
    assert(win.payout === 50 * 9, `cuadro paga x9 (real ${win.payout}, esperado 450)`);
    assert([1, 2, 4, 5].includes(win.winningNumber), 'el cuadro 1-2-4-5 solo gana con uno de esos 4 números');
  }

  // ---------- apuestas de afuera: x2 y x3 ----------
  win = await spinUntil(token, 'red', null, 100, true, 40);
  assert(!!win, 'en 40 giros salió rojo al menos una vez');
  if (win) assert(win.payout === 100 * 2, `rojo paga x2 (real ${win.payout}, esperado 200)`);

  win = await spinUntil(token, 'dozen', 2, 100, true, 60);
  assert(!!win, 'en 60 giros ganó la 2ª docena al menos una vez');
  if (win) {
    assert(win.payout === 100 * 3, `docena paga x3 (real ${win.payout}, esperado 300)`);
    assert(win.winningNumber >= 13 && win.winningNumber <= 24, 'la 2ª docena solo gana con 13 a 24');
  }

  // el 0 no es par, impar, rojo, negro, ni entra en ninguna docena/columna
  const zeroSpin = await spinUntil(token, 'even', null, 10, true, 2000);
  // no hace falta que salga (ganar con "par" nunca debería pasar en el 0):
  // en cambio verificamos indirectamente que salir 0 nunca cuenta como par
  // revisando muchos giros seguidos.
  let sawZero = false, zeroCountedAsWin = false;
  for (let i = 0; i < 300; i++) {
    const s = await api('/roulette/spin', { method: 'POST', token, body: { stake: 10, betType: 'even', betValue: null } });
    if (s.data.winningNumber === 0) { sawZero = true; if (s.data.won) zeroCountedAsWin = true; }
  }
  assert(sawZero, 'en 300 giros salió el 0 al menos una vez (para poder chequear la regla)');
  assert(!zeroCountedAsWin, 'salir 0 nunca cuenta como ganador de "par"');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de ruleta:', e); process.exit(1); });
