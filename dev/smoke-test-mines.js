// Prueba de humo de "Minas". Jugamos varias partidas revelando casilleros
// y en cada paso recalculamos de forma independiente (con la misma fórmula
// pública del motor) qué cuota y qué saldo corresponden, comparando contra
// lo que devuelve el servidor.
const { GRID_SIZE, multiplierForReveals } = require('../server/mines');

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
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Mines Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones ----------
  r = await api('/mines/start', { method: 'POST', token, body: { stake: 0, mines: 3 } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/mines/start', { method: 'POST', token, body: { stake: 100, mines: 0 } });
  assert(r.status === 400, 'rechaza 0 minas');
  r = await api('/mines/start', { method: 'POST', token, body: { stake: 100, mines: 25 } });
  assert(r.status === 400, 'rechaza 25 minas (tiene que quedar al menos un casillero seguro)');
  r = await api('/mines/reveal', { method: 'POST', token, body: { index: 0 } });
  assert(r.status === 400, 'no se puede revelar sin haber empezado');
  r = await api('/mines/cashout', { method: 'POST', token });
  assert(r.status === 400, 'no se puede cobrar sin haber empezado');

  // ---------- jugar varias partidas, verificando la cuota y el saldo en cada paso ----------
  let sawMineHit = false, sawCashout = false;
  for (let i = 0; i < 40 && (!sawMineHit || !sawCashout); i++) {
    const stake = 100;
    const mines = 5;
    const balanceBefore = (await api('/auth/me', { token })).data.balance;

    r = await api('/mines/start', { method: 'POST', token, body: { stake, mines } });
    assert(r.status === 200, `partida ${i}: empieza ok`);
    assert(r.data.balance === balanceBefore - stake, `partida ${i}: se descontó la apuesta`);
    assert(r.data.grid === null, `partida ${i}: no se revela dónde están las minas mientras sigue activa`);

    let g = r.data;
    const order = [...Array(GRID_SIZE).keys()].sort(() => Math.random() - 0.5);
    let revealed = 0;
    for (const idx of order) {
      if (g.phase !== 'active') break;
      r = await api('/mines/reveal', { method: 'POST', token, body: { index: idx } });
      assert(r.status === 200, `partida ${i}: revelar casillero ${idx} aceptado`);
      g = r.data;

      if (g.phase === 'done' && g.grid && g.grid[idx] === true) {
        // pisó una mina
        sawMineHit = true;
        assert(g.balance === balanceBefore - stake, `partida ${i}: pisar una mina no paga nada (${g.balance} == ${balanceBefore - stake})`);
        break;
      }
      revealed++;
      const expectedMult = multiplierForReveals(mines, revealed);
      assert(Math.abs(g.multiplier - expectedMult) < 1e-9, `partida ${i}: cuota tras ${revealed} casillero(s) correcta (${g.multiplier} == ${expectedMult})`);

      if (!sawCashout && revealed >= 2 && g.phase === 'active') {
        sawCashout = true;
        const expectedPayout = Math.round(stake * expectedMult);
        r = await api('/mines/cashout', { method: 'POST', token });
        assert(r.status === 200, `partida ${i}: cobrar aceptado`);
        g = r.data;
        assert(g.balance === balanceBefore - stake + expectedPayout, `partida ${i}: cobro correcto (${g.balance} == ${balanceBefore - stake + expectedPayout})`);
        assert(g.phase === 'done', `partida ${i}: cobrar termina la partida`);
        break;
      }
    }
    // si la partida quedó activa (no tocamos mina ni cobramos, p. ej. si el loop de índices
    // se agotó de forma rara), la cerramos para no dejar estado colgado.
    if (g.phase === 'active') await api('/mines/cashout', { method: 'POST', token });
  }
  assert(sawMineHit, 'en 40 partidas se pisó al menos una mina');
  assert(sawCashout, 'en 40 partidas se probó cobrar después de revelar al menos 2 casilleros');

  // no se puede empezar una partida nueva con una ya en juego
  r = await api('/mines/start', { method: 'POST', token, body: { stake: 100, mines: 5 } });
  assert(r.status === 200, 'arranca una partida nueva (la anterior ya había terminado)');
  const r2 = await api('/mines/start', { method: 'POST', token, body: { stake: 100, mines: 5 } });
  assert(r2.status === 400, 'rechaza empezar otra partida mientras hay una en juego');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de minas:', e); process.exit(1); });
