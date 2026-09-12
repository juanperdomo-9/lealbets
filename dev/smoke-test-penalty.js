// Prueba de humo de "Tanda de penaltis". Jugamos muchas tandas seguidas y en
// cada paso recalculamos de forma independiente (con las mismas funciones
// puras del motor) qué saldo tendría que haber, para detectar cualquier
// diferencia entre lo que dice el servidor y lo que matemáticamente
// corresponde.
const { DIFFICULTIES, multiplierForRound } = require('../server/penalty');

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
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Penalty Tester', password: 'abcd' } });
  const token = r.data.token;
  assert(r.data.balance === 30000, 'usuario nuevo arranca con 30000');

  // ---------- validaciones ----------
  r = await api('/penalty/start', { method: 'POST', token, body: { stake: 0, difficulty: 'media' } });
  assert(r.status === 400, 'rechaza apostar 0');
  r = await api('/penalty/start', { method: 'POST', token, body: { stake: 100, difficulty: 'imposible' } });
  assert(r.status === 400, 'rechaza una dificultad inválida');
  r = await api('/penalty/kick', { method: 'POST', token });
  assert(r.status === 400, 'no se puede patear sin haber empezado');
  r = await api('/penalty/cashout', { method: 'POST', token });
  assert(r.status === 400, 'no se puede cobrar sin haber empezado');
  r = await api('/penalty/state', { token });
  assert(r.data.phase === 'none', 'sin ninguna tanda todavía, el estado es "none"');

  // ---------- jugar muchas tandas, verificando cada centavo ----------
  let sawCashout = false, sawMiss = false;
  for (let i = 0; i < 60 && (!sawCashout || !sawMiss); i++) {
    const stake = 100;
    const difficulty = ['facil', 'media', 'dificil'][i % 3];
    const p = DIFFICULTIES[difficulty];
    const balanceBefore = (await api('/auth/me', { token })).data.balance;

    r = await api('/penalty/start', { method: 'POST', token, body: { stake, difficulty } });
    assert(r.status === 200, `tanda ${i}: empieza ok`);
    assert(r.data.balance === balanceBefore - stake, `tanda ${i}: se descontó la apuesta`);
    // la escalera de cuotas que manda el server tiene que coincidir con la fórmula pública
    const expectedLadder = Array.from({ length: 10 }, (_, k) => multiplierForRound(p, k + 1));
    assert(JSON.stringify(r.data.ladder) === JSON.stringify(expectedLadder), `tanda ${i}: la escalera de cuotas es la esperada para "${difficulty}"`);

    // pateamos hasta que ataje o hasta 2 conversiones (para no jugar para siempre)
    let g = r.data;
    let kicks = 0;
    while (g.phase === 'active' && kicks < 8) {
      kicks++;
      r = await api('/penalty/kick', { method: 'POST', token });
      assert(r.status === 200, `tanda ${i}: patada ${kicks} aceptada`);
      g = r.data;
      if (g.lastKickResult === 'missed') {
        sawMiss = true;
        assert(g.phase === 'done', `tanda ${i}: atajada termina la tanda`);
        assert(g.balance === balanceBefore - stake, `tanda ${i}: atajada no paga nada (${g.balance} == ${balanceBefore - stake})`);
        break;
      }
      // convirtió: el round tiene que haber subido y la cuota coincidir con la fórmula
      const expectedMult = multiplierForRound(p, g.round);
      assert(Math.abs(g.multiplier - expectedMult) < 1e-9, `tanda ${i}: cuota del round ${g.round} correcta (${g.multiplier} == ${expectedMult})`);
      if (!sawCashout && g.round >= 2) {
        sawCashout = true;
        const expectedPayout = Math.round(stake * expectedMult);
        r = await api('/penalty/cashout', { method: 'POST', token });
        assert(r.status === 200, `tanda ${i}: cobrar aceptado`);
        g = r.data;
        assert(g.balance === balanceBefore - stake + expectedPayout, `tanda ${i}: cobro correcto (${g.balance} == ${balanceBefore - stake + expectedPayout})`);
        assert(g.phase === 'done', `tanda ${i}: cobrar termina la tanda`);
        break;
      }
      if (kicks >= 8 && g.phase === 'active') {
        // no se probó cashout en esta tanda por el límite: cobramos para no dejarla colgada
        r = await api('/penalty/cashout', { method: 'POST', token });
        g = r.data;
      }
    }
  }
  assert(sawMiss, 'en 60 tandas hubo al menos una atajada');
  assert(sawCashout, 'en 60 tandas se probó cobrar después de convertir al menos 2 penales');

  // no se puede empezar una tanda nueva con una ya en juego
  r = await api('/penalty/start', { method: 'POST', token, body: { stake: 100, difficulty: 'media' } });
  assert(r.status === 200, 'arranca una tanda nueva (la anterior ya había terminado)');
  const r2 = await api('/penalty/start', { method: 'POST', token, body: { stake: 100, difficulty: 'media' } });
  assert(r2.status === 400, 'rechaza empezar otra tanda mientras hay una en juego');
  // la cerramos para no dejar el estado colgado
  await api('/penalty/kick', { method: 'POST', token });

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de penales:', e); process.exit(1); });
