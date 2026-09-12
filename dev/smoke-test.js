// Prueba de humo end-to-end contra el servidor de desarrollo (dev/dev-server.js).
// Corre el flujo real: alta de usuario, apuesta combinada (1x2 + prop de jugador
// de Leal), carga de resultado por admin, liquidación, cash out y reapertura.
const BASE = 'http://localhost:3000/api';
let failures = 0;

function assert(cond, msg) {
  if (cond) { console.log('OK   -', msg); }
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
  // 1. alta de usuario nuevo
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Juan Smoke', password: 'abcd' } });
  assert(r.status === 200 && r.data.balance === 30000, 'alta de usuario nueva con 30000 fichas');
  const token = r.data.token;

  // 2. re-entrar con la misma contraseña funciona, con otra falla
  r = await api('/auth/join', { method: 'POST', body: { name: 'Juan Smoke', password: 'abcd' } });
  assert(r.status === 200, 'reingresar con contraseña correcta funciona');
  r = await api('/auth/join', { method: 'POST', body: { name: 'Juan Smoke', password: 'mala' } });
  assert(r.status === 401, 'reingresar con contraseña incorrecta se rechaza');

  // 3. estado público: 8 equipos, 4 partidos, uno con Leal FC y props
  r = await api('/state');
  const state = r.data;
  assert(state.teams.length === 8, 'seed: 8 equipos');
  assert(state.matches.length === 4, 'seed: 4 partidos');
  const lealMatch = state.matches.find((m) => m.homeName === 'Leal FC' || m.awayName === 'Leal FC');
  assert(!!lealMatch && !!lealMatch.playerProps, 'el partido de Leal FC tiene playerProps');
  assert(
    Array.isArray(state.lealPlayerOrder) && state.lealPlayerOrder[0] === 'Alexis Villarreal' && state.lealPlayerOrder[1] === 'Luca Forteis',
    'el estado expone el orden fijo de jugadores de Leal (para que no lo desordene jsonb)'
  );
  const juanPerdomoProps = lealMatch.playerProps['Juan Perdomo'];
  assert(juanPerdomoProps && juanPerdomoProps.gol === 40, 'cuota base de "Juan Perdomo gol" = 40 (sin historial)');

  const otherMatch = state.matches.find((m) => m.id !== lealMatch.id);

  // 4. apuesta combinada: 1x2 de un partido cualquiera + gol de Juan Perdomo
  r = await api('/bets', {
    method: 'POST',
    token,
    body: {
      stake: 1000,
      legs: [
        { matchId: otherMatch.id, pick: 'home' },
        { matchId: lealMatch.id, pick: 'prop|Juan Perdomo|gol' },
      ],
    },
  });
  assert(r.status === 200, 'apuesta combinada aceptada: ' + JSON.stringify(r.data));
  const betId = r.data.id;
  const expectedCombined = Math.round(otherMatch.odds.home * juanPerdomoProps.gol * 100) / 100;
  assert(r.data.combinedOdds === expectedCombined, `cuota combinada calculada en el server (${r.data.combinedOdds} == ${expectedCombined})`);

  r = await api('/auth/me', { token });
  assert(r.data.balance === 29000, 'el saldo bajó exactamente el monto apostado (29000)');

  // 5. no se puede apostar más de lo que tenés
  r = await api('/bets', { method: 'POST', token, body: { stake: 999999, legs: [{ matchId: otherMatch.id, pick: 'away' }] } });
  assert(r.status === 400, 'rechaza apuesta por más fichas de las que hay');

  // 6. admin: contraseña incorrecta / correcta
  r = await api('/auth/admin', { method: 'POST', body: { password: 'incorrecta' } });
  assert(r.status === 401, 'admin: contraseña incorrecta rechazada');
  r = await api('/auth/admin', { method: 'POST', body: { password: 'leal2026' } });
  assert(r.status === 200, 'admin: contraseña correcta acepta');
  const adminToken = r.data.token;

  // 7. cargar resultado del partido "otherMatch": que gane home (cumple esa pata),
  //    y el de Leal FC: Juan Perdomo hace gol (cumple la otra pata) -> la combinada gana
  r = await api(`/admin/matches/${otherMatch.id}/result`, {
    method: 'POST',
    token: adminToken,
    body: { homeGoals: 2, awayGoals: 0, playerStats: {}, didNotPlay: [] },
  });
  assert(r.status === 200, 'resultado del primer partido cargado');

  r = await api(`/admin/matches/${lealMatch.id}/result`, {
    method: 'POST',
    token: adminToken,
    body: {
      homeGoals: 1,
      awayGoals: 1,
      playerStats: { 'Juan Perdomo': { gol: 1, remates: 2, faltas: 1 } },
      didNotPlay: [],
    },
  });
  assert(r.status === 200, 'resultado del partido de Leal FC cargado');

  r = await api('/bets/mine', { token });
  const bet = r.data.find((b) => b.id === betId);
  assert(bet.settled === true && bet.won === true, 'la combinada quedó liquidada como ganada');
  const expectedPayout = Math.round(1000 * expectedCombined);
  r = await api('/auth/me', { token });
  assert(r.data.balance === 29000 + expectedPayout, `el saldo subió el pago correcto (esperado ${29000 + expectedPayout}, real ${r.data.balance})`);

  // 8. las cuotas de Juan Perdomo deberían bajar (más probable) para el próximo partido de Leal,
  //    porque ya hizo un gol en el historial real.
  const teamsResp = await api('/state');
  const lealTeam = teamsResp.data.teams.find((t) => t.name === 'Leal FC');
  const rivalTeam = teamsResp.data.teams.find((t) => t.name !== 'Leal FC');
  r = await api('/admin/matches', { method: 'POST', token: adminToken, body: { homeId: lealTeam.id, awayId: rivalTeam.id } });
  assert(r.status === 200, 'admin puede programar un nuevo partido de Leal FC');
  r = await api('/state');
  const newLealMatch = r.data.matches.find((m) => m.status === 'upcoming' && (m.homeName === 'Leal FC' || m.awayName === 'Leal FC'));
  assert(!!newLealMatch && !!newLealMatch.playerProps, 'el nuevo partido de Leal FC trae playerProps');
  const newGolOdds = newLealMatch.playerProps['Juan Perdomo'].gol;
  assert(newGolOdds < 40, `la cuota de gol de Juan Perdomo bajó con el historial real (40 -> ${newGolOdds})`);

  // 9. reabrir el partido de Leal FC revierte la liquidación
  r = await api(`/admin/matches/${lealMatch.id}/reopen`, { method: 'POST', token: adminToken });
  assert(r.status === 200, 'reabrir partido de Leal FC');
  r = await api('/bets/mine', { token });
  const betAfterReopen = r.data.find((b) => b.id === betId);
  assert(betAfterReopen.settled === false, 'la combinada vuelve a estar pendiente tras reabrir');
  r = await api('/auth/me', { token });
  assert(r.data.balance === 29000, `el saldo vuelve a 29000 tras reabrir (real ${r.data.balance})`);

  // 10. cash out de una apuesta pendiente devuelve el monto exacto
  r = await api('/bets', { method: 'POST', token, body: { stake: 500, legs: [{ matchId: lealMatch.id, pick: 'draw' }] } });
  const simpleBetId = r.data.id;
  r = await api(`/bets/${simpleBetId}/cashout`, { method: 'POST', token });
  assert(r.status === 200, 'cash out aceptado');
  r = await api('/auth/me', { token });
  assert(r.data.balance === 29000, `tras cash out el saldo vuelve a 29000 (real ${r.data.balance})`);

  // 11. ranking incluye a Juan Smoke
  r = await api('/state');
  assert(r.data.ranking.some((u) => u.name === 'Juan Smoke'), 'el ranking incluye al usuario de prueba');

  // 12. si alguien apuesta TODAS sus fichas y las pierde (o queda en 0), se le restablecen solas
  r = await api('/auth/join', { method: 'POST', body: { name: 'Sin Suerte', password: 'abcd' } });
  const brokeToken = r.data.token;
  r = await api('/state');
  const anyMatch = r.data.matches.find((m) => m.status === 'upcoming');
  r = await api('/bets', { method: 'POST', token: brokeToken, body: { stake: 30000, legs: [{ matchId: anyMatch.id, pick: 'home' }] } });
  assert(r.status === 200 && r.data.wasReset === true, 'apostar todas las fichas dispara el auto-reset (wasReset=true)');
  r = await api('/auth/me', { token: brokeToken });
  assert(r.data.balance === 30000, `el saldo quedó restablecido a 30000 en vez de 0 (real ${r.data.balance})`);

  console.log('\n' + (failures === 0 ? `TODO OK (0 fallos)` : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Error corriendo la prueba de humo:', e);
  process.exit(1);
});
