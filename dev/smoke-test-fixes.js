// Prueba de humo de los tres ajustes pedidos:
// 1) no dejar usar el mismo superaumento dos veces (por usuario)
// 2) no restablecer fichas en 0 hasta que la combinada pendiente se resuelva (perdida)
// 3) "no jugó" anula solo esa pata, no toda la apuesta
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
  let r = await api('/auth/admin', { method: 'POST', body: { password: 'leal2026' } });
  const adminToken = r.data.token;

  // ---------- 1) superaumento: no se puede usar dos veces ----------
  r = await api('/auth/join', { method: 'POST', body: { name: 'Fix Tester 1', password: 'abcd' } });
  const token1 = r.data.token;
  r = await api('/state');
  const anyMatch = r.data.matches.find((m) => m.status === 'upcoming');
  r = await api('/admin/superboost', { method: 'POST', token: adminToken, body: { matchId: anyMatch.id, legs: ['home'], boostedOdds: anyMatch.odds.home + 5 } });
  assert(r.status === 200, 'admin crea superaumento de prueba');
  r = await api('/state');
  const boost = r.data.superBoosts.find((b) => b.matchId === anyMatch.id);

  r = await api('/bets', { method: 'POST', token: token1, body: { stake: 500, legs: [{ matchId: anyMatch.id, pick: 'home' }], superBoostId: boost.id } });
  assert(r.status === 200 && r.data.boostApplied === true, 'primera apuesta con el superaumento se acepta');

  r = await api('/bets', { method: 'POST', token: token1, body: { stake: 500, legs: [{ matchId: anyMatch.id, pick: 'home' }], superBoostId: boost.id } });
  assert(r.status === 400 && /ya usaste/i.test(r.data.error || ''), `un segundo intento del mismo usuario se rechaza (${JSON.stringify(r.data)})`);

  // otro usuario sí puede usarlo (el límite es por usuario, no global)
  r = await api('/auth/join', { method: 'POST', body: { name: 'Fix Tester 2', password: 'abcd' } });
  const token2 = r.data.token;
  r = await api('/bets', { method: 'POST', token: token2, body: { stake: 300, legs: [{ matchId: anyMatch.id, pick: 'home' }], superBoostId: boost.id } });
  assert(r.status === 200 && r.data.boostApplied === true, 'otro usuario distinto sí puede usar el mismo superaumento');

  // ---------- 2) no se restablece hasta que la combinada pendiente se resuelva (perdida) ----------
  r = await api('/auth/join', { method: 'POST', body: { name: 'Fix Tester 3', password: 'abcd' } });
  const token3 = r.data.token;
  r = await api('/state');
  const otherMatch = r.data.matches.find((m) => m.status === 'upcoming' && m.id !== anyMatch.id);
  r = await api('/bets', { method: 'POST', token: token3, body: { stake: 30000, legs: [{ matchId: otherMatch.id, pick: 'away' }] } });
  assert(r.status === 200, 'apuesta con TODAS las fichas aceptada');
  assert(r.data.wasReset === false, 'NO se restablece todavía: la combinada sigue pendiente');
  r = await api('/auth/me', { token: token3 });
  assert(r.data.balance === 0, `el saldo queda en 0 pero sin restablecerse (real ${r.data.balance})`);

  // resolvemos ese partido para que la pierda (home gana en vez de away)
  r = await api(`/admin/matches/${otherMatch.id}/result`, { method: 'POST', token: adminToken, body: { homeGoals: 2, awayGoals: 0, playerStats: {}, didNotPlay: [] } });
  assert(r.status === 200, 'se carga el resultado (pierde la apuesta)');
  r = await api('/auth/me', { token: token3 });
  assert(r.data.balance === 30000, `recién ahora que la combinada se resolvió perdida se restablece a 30000 (real ${r.data.balance})`);

  // ---------- 3) "no jugó" anula solo esa pata, no toda la apuesta ----------
  r = await api('/auth/join', { method: 'POST', body: { name: 'Fix Tester 4', password: 'abcd' } });
  const token4 = r.data.token;
  r = await api('/state');
  const lealMatch = r.data.matches.find((m) => m.status === 'upcoming' && (m.homeName === 'Leal FC' || m.awayName === 'Leal FC'));
  const otherUpcoming = r.data.matches.find((m) => m.status === 'upcoming' && m.id !== lealMatch.id);
  const juanGolOdds = lealMatch.playerProps['Juan Perdomo'].gol;
  const otherHomeOdds = otherUpcoming.odds.home;

  r = await api('/bets', {
    method: 'POST', token: token4, body: {
      stake: 1000,
      legs: [
        { matchId: lealMatch.id, pick: 'prop|Juan Perdomo|gol' },
        { matchId: otherUpcoming.id, pick: 'home' },
      ],
    },
  });
  assert(r.status === 200, 'combinada Juan Perdomo gol + otro partido aceptada');
  const comboBetId = r.data.id;

  // Leal FC juega: Juan Perdomo NO JUGÓ. El otro partido: gana el local (esa pata gana).
  r = await api(`/admin/matches/${lealMatch.id}/result`, {
    method: 'POST', token: adminToken,
    body: { homeGoals: 1, awayGoals: 1, playerStats: {}, didNotPlay: ['Juan Perdomo'] },
  });
  assert(r.status === 200, 'resultado del partido de Leal cargado con Juan Perdomo "no jugó"');

  r = await api('/bets/mine', { token: token4 });
  let combo = r.data.find((b) => b.id === comboBetId);
  const juanLeg = combo.legs.find((l) => l.pick.includes('Juan Perdomo'));
  assert(juanLeg.result === 'void', 'la pata de Juan Perdomo quedó anulada (no toda la apuesta)');
  assert(combo.settled === false, 'la apuesta sigue pendiente: falta resolver el otro partido');

  r = await api(`/admin/matches/${otherUpcoming.id}/result`, { method: 'POST', token: adminToken, body: { homeGoals: 2, awayGoals: 1, playerStats: {}, didNotPlay: [] } });
  assert(r.status === 200, 'resultado del segundo partido cargado (gana el local, esa pata gana)');

  r = await api('/bets/mine', { token: token4 });
  combo = r.data.find((b) => b.id === comboBetId);
  assert(combo.settled === true && combo.won === true, 'con la única pata activa ganadora, la combinada completa se gana');
  assert(combo.effectiveOdds === otherHomeOdds, `la cuota efectiva es solo la de la pata que sobrevivió, sin la anulada (${combo.effectiveOdds} == ${otherHomeOdds})`);
  const expectedPayout = Math.round(1000 * otherHomeOdds);
  r = await api('/auth/me', { token: token4 });
  assert(r.data.balance === 30000 - 1000 + expectedPayout, `el pago es solo con la cuota de la pata sobreviviente (real ${r.data.balance}, esperado ${30000 - 1000 + expectedPayout})`);

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de los ajustes:', e); process.exit(1); });
