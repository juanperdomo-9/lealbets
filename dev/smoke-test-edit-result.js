// Prueba de humo de "editar resultado sin reabrir": el partido nunca pasa
// por 'upcoming', el Elo se recalcula siempre desde el mismo snapshot (no
// acumula error en ediciones repetidas), las apuestas se vuelven a liquidar
// bien, y el historial de jugador queda solo con los valores corregidos.
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
  r = await api('/auth/join', { method: 'POST', body: { name: 'Editor Tester', password: 'abcd' } });
  const token = r.data.token;

  r = await api('/state');
  const lealMatch = r.data.matches.find((m) => m.status === 'upcoming' && (m.homeName === 'Leal FC' || m.awayName === 'Leal FC'));
  const homeTeam = r.data.teams.find((t) => t.name === lealMatch.homeName);
  const awayTeam = r.data.teams.find((t) => t.name === lealMatch.awayName);
  const ratingsBefore = { home: homeTeam.rating, away: awayTeam.rating };

  // apuesta a "gana el local" + "Juan Perdomo gol"
  r = await api('/bets', {
    method: 'POST', token,
    body: { stake: 1000, legs: [{ matchId: lealMatch.id, pick: 'home' }, { matchId: lealMatch.id, pick: 'prop|Juan Perdomo|gol' }] },
  });
  assert(r.status === 200, 'combinada aceptada');
  const betId = r.data.id;

  // resultado inicial: pierde el local 0-2, Juan Perdomo NO hace gol -> la combinada pierde
  r = await api(`/admin/matches/${lealMatch.id}/result`, {
    method: 'POST', token: adminToken,
    body: { homeGoals: 0, awayGoals: 2, playerStats: { 'Juan Perdomo': { gol: 0 } }, didNotPlay: [] },
  });
  assert(r.status === 200, 'resultado inicial cargado (pierde el local)');

  r = await api('/bets/mine', { token });
  let bet = r.data.find((b) => b.id === betId);
  assert(bet.settled === true && bet.won === false, 'con el resultado inicial, la combinada perdió');
  r = await api('/auth/me', { token });
  assert(r.data.balance === 29000, `saldo tras perder: 29000 (real ${r.data.balance})`);

  r = await api('/state');
  let match = r.data.matches.find((m) => m.id === lealMatch.id);
  assert(match.status === 'finished', 'el partido queda finalizado');
  const ratingsAfterFirst = { home: r.data.teams.find((t) => t.name === lealMatch.homeName).rating, away: r.data.teams.find((t) => t.name === lealMatch.awayName).rating };
  assert(ratingsAfterFirst.home !== ratingsBefore.home, 'el Elo cambió respecto al valor pre-partido');

  // EDITAR (sin reabrir): en realidad ganó el local 3-0, y Juan Perdomo sí hizo gol
  r = await api(`/admin/matches/${lealMatch.id}/result`, {
    method: 'PUT', token: adminToken,
    body: { homeGoals: 3, awayGoals: 0, playerStats: { 'Juan Perdomo': { gol: 1 } }, didNotPlay: [] },
  });
  assert(r.status === 200, 'edición del resultado aceptada');

  r = await api('/state');
  match = r.data.matches.find((m) => m.id === lealMatch.id);
  assert(match.status === 'finished', 'el partido SIGUE finalizado (nunca pasó por upcoming)');
  assert(match.result.homeGoals === 3 && match.result.awayGoals === 0, 'el resultado corregido quedó guardado');

  r = await api('/bets/mine', { token });
  bet = r.data.find((b) => b.id === betId);
  assert(bet.settled === true && bet.won === true, 'con el resultado corregido, la combinada ahora GANA');
  const expectedOdds = Math.round(bet.legs.reduce((p, l) => p * l.oddsAtBet, 1) * 100) / 100;
  assert(bet.effectiveOdds === expectedOdds, `cuota efectiva correcta tras editar (${bet.effectiveOdds} == ${expectedOdds})`);
  r = await api('/auth/me', { token });
  const expectedBalance = 29000 + Math.round(1000 * expectedOdds);
  assert(r.data.balance === expectedBalance, `saldo corregido: se revirtió la pérdida y se pagó el premio (real ${r.data.balance}, esperado ${expectedBalance})`);

  // el Elo del segundo resultado tiene que salir del MISMO punto de partida que el primero
  // (no de ratingsAfterFirst) — como ahora ganó el local en vez de perder, el rating tiene
  // que haber subido respecto al valor ORIGINAL pre-partido, no encadenarse sobre el anterior.
  r = await api('/state');
  const ratingsAfterEdit = { home: r.data.teams.find((t) => t.name === lealMatch.homeName).rating, away: r.data.teams.find((t) => t.name === lealMatch.awayName).rating };
  assert(ratingsAfterEdit.home > ratingsBefore.home, `el rating del local subió respecto al valor pre-partido tras corregir a victoria (${ratingsAfterEdit.home} > ${ratingsBefore.home})`);

  // el historial de Juan Perdomo para ESTE partido debe reflejar solo el valor corregido (gol:1), no duplicado
  const golHistoryCount = 1; // no hay endpoint público de historial crudo; lo confirmamos indirectamente:
  // si hubiera quedado la fila vieja (gol:0) además de la nueva (gol:1), buildDynamicLealProps contaría
  // 2 partidos jugados en vez de 1 al armar el próximo partido de Leal.
  r = await api('/admin/matches', { method: 'POST', token: adminToken, body: { homeId: homeTeam.id, awayId: awayTeam.id } });
  assert(r.status === 200, 'se programa un partido nuevo de Leal para revisar el historial acumulado');
  r = await api('/state');
  const newLealMatch = r.data.matches.find((m) => m.status === 'upcoming' && (m.homeName === 'Leal FC' || m.awayName === 'Leal FC'));
  // con 1 solo partido jugado (gol:1) y prior 40: prob=(1/(40*1.08)*3 + 1)/(3+1)
  const priorProb = 1 / (40 * 1.08);
  const expectedProb = (priorProb * 3 + 1) / (3 + 1);
  const expectedGolOdds = Math.max(1.05, Math.round((1 / expectedProb / 1.08) * 100) / 100);
  assert(
    newLealMatch.playerProps['Juan Perdomo'].gol === expectedGolOdds,
    `el historial quedó con un solo registro corregido, no duplicado (cuota gol ${newLealMatch.playerProps['Juan Perdomo'].gol} == ${expectedGolOdds})`
  );

  // no se puede editar un partido que todavía está pendiente
  r = await api(`/admin/matches/${newLealMatch.id}/result`, { method: 'PUT', token: adminToken, body: { homeGoals: 1, awayGoals: 1, playerStats: {}, didNotPlay: [] } });
  assert(r.status === 400, 'no se puede editar un partido que todavía no tiene resultado');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de editar resultado:', e); process.exit(1); });
