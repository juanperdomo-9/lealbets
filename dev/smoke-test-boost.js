// Prueba de humo del superaumento: crear, apostar con la cuota fija, tope de
// fichas, que se pierda si se toca el combo, y desactivar.
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
  let r = await api('/auth/join', { method: 'POST', body: { name: 'Boost Tester', password: 'abcd' } });
  const token = r.data.token;

  r = await api('/auth/admin', { method: 'POST', body: { password: 'leal2026' } });
  const adminToken = r.data.token;

  r = await api('/state');
  const match = r.data.matches.find((m) => m.status === 'upcoming' && m.homeName !== 'Leal FC' && m.awayName !== 'Leal FC');
  const naturalHome = match.odds.home;

  // crear superaumento sobre "gana el local", cuota natural -> boosted
  const boostedOdds = Math.round((naturalHome + 1) * 100) / 100;
  r = await api('/admin/superboost', { method: 'POST', token: adminToken, body: { matchId: match.id, legs: ['home'], boostedOdds } });
  assert(r.status === 200, 'admin crea el superaumento: ' + JSON.stringify(r.data));

  r = await api('/state');
  const boost = r.data.superBoosts[0];
  assert(!!boost, 'el superaumento aparece en el estado público');
  assert(boost.boostedOdds === boostedOdds, 'la cuota boosted es la que puso el admin');
  assert(boost.naturalOdds === naturalHome, `la cuota natural coincide con la del partido (${boost.naturalOdds} == ${naturalHome})`);
  assert(r.data.maxSuperBoostStake === 10000, 'el tope de fichas del superaumento es 10000');

  // rechaza crear con cuota menor o igual a la natural
  r = await api('/admin/superboost', { method: 'POST', token: adminToken, body: { matchId: match.id, legs: ['home'], boostedOdds: naturalHome } });
  assert(r.status === 400, 'rechaza una cuota nueva que no sea mayor a la natural');

  // apostar con el superaumento: paga la cuota fija
  r = await api('/bets', { method: 'POST', token, body: { stake: 2000, legs: [{ matchId: match.id, pick: 'home' }], superBoostId: boost.id } });
  assert(r.status === 200 && r.data.boostApplied === true, 'la apuesta con superaumento se marca boostApplied');
  assert(r.data.combinedOdds === boostedOdds, `la apuesta se registra a la cuota boosted (${r.data.combinedOdds} == ${boostedOdds})`);
  const boostedBetId = r.data.id;

  // tope de 10000 fichas
  r = await api('/bets', { method: 'POST', token, body: { stake: 10001, legs: [{ matchId: match.id, pick: 'home' }], superBoostId: boost.id } });
  assert(r.status === 400, 'rechaza apostar más de 10000 fichas con el superaumento');

  // si se agrega una pata de más, ya no matchea el combo exacto -> cuota normal (no error)
  r = await api('/state');
  const otherMatch = r.data.matches.find((m) => m.id !== match.id && m.status === 'upcoming');
  r = await api('/bets', {
    method: 'POST', token,
    body: { stake: 500, legs: [{ matchId: match.id, pick: 'home' }, { matchId: otherMatch.id, pick: 'draw' }], superBoostId: boost.id },
  });
  assert(r.status === 200 && r.data.boostApplied === false, 'si el combo no matchea exacto, se ignora el boost y se cobra normal');

  // liquidar: el local gana -> la apuesta boosted paga a la cuota fija
  r = await api(`/admin/matches/${match.id}/result`, { method: 'POST', token: adminToken, body: { homeGoals: 3, awayGoals: 0, playerStats: {}, didNotPlay: [] } });
  assert(r.status === 200, 'resultado cargado (gana el local)');

  r = await api('/bets/mine', { token });
  const settledBoosted = r.data.find((b) => b.id === boostedBetId);
  assert(settledBoosted.won === true && settledBoosted.effectiveOdds === boostedOdds, `la apuesta boosted paga a la cuota fija (${settledBoosted.effectiveOdds} == ${boostedOdds})`);

  // desactivar
  r = await api(`/admin/superboost/${boost.id}/deactivate`, { method: 'POST', token: adminToken });
  assert(r.status === 200, 'admin desactiva el superaumento');
  r = await api('/state');
  assert(r.data.superBoosts.length === 0, 'el superaumento desactivado ya no aparece en el estado (y el partido ya terminó)');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo del superaumento:', e); process.exit(1); });
