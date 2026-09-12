// Lógica compartida de liquidación de partidos: la usan "cargar resultado",
// "editar resultado" (sin reabrir) y "reabrir partido", para no repetir tres
// veces la misma secuencia de deshacer/aplicar.
const { applyBalanceDelta, resetIfDepletedAndNoPendingBets } = require('./db');
const { updateElo, evaluateBet, parsePropPick } = require('./oddsEngine');
const { syncLealProps } = require('./state');

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

// Deshace la liquidación de un partido SIN tocar su status ni sus ratings:
// revierte el saldo de las apuestas que ya se habían liquidado con el
// resultado anterior (ganadas: se les resta lo pagado; anuladas: se les
// resta la devolución) y borra el historial de jugador cargado para ESE
// partido puntual (identificado por match_id, no toca el de otros partidos
// del mismo jugador). La usan tanto "reabrir" como "editar resultado".
async function undoMatchSettlement(client, matchId) {
  await client.query('DELETE FROM player_history WHERE match_id=$1', [matchId]);

  const { rows: betRows } = await client.query('SELECT * FROM bets WHERE cancelled=FALSE FOR UPDATE');
  for (const bet of betRows) {
    const legs = bet.legs;
    const touchedLegs = legs.filter((l) => l.matchId === matchId);
    if (touchedLegs.length === 0) continue;
    if (bet.settled) {
      if (bet.voided) {
        await applyBalanceDelta(client, bet.user_name, -Number(bet.stake));
      } else if (bet.won) {
        const paidOdds = bet.effective_odds || bet.combined_odds;
        await applyBalanceDelta(client, bet.user_name, -Number(bet.stake) * Number(paidOdds));
      }
    }
    touchedLegs.forEach((l) => (l.result = null));
    await client.query(
      'UPDATE bets SET legs=$1, settled=FALSE, won=FALSE, voided=FALSE, effective_odds=NULL WHERE id=$2',
      [JSON.stringify(legs), bet.id]
    );
  }
}

// Aplica un resultado (nuevo o corregido) a un partido: actualiza el rating
// Elo de ambos equipos, guarda el resultado, inserta el historial de
// jugador, y liquida las apuestas pendientes con alguna pata en ese
// partido. El rating siempre se recalcula desde `pre_match_ratings` (el
// valor que tenían los equipos ANTES del primer resultado cargado, guardado
// una sola vez) — así, si se edita un resultado varias veces, el cálculo
// siempre parte del mismo punto y no acumula error.
// `match` es la fila cruda de la tabla matches (ya con FOR UPDATE tomado).
async function applyMatchResult(client, match, hg, ag, rawPlayerStats, didNotPlay) {
  const { rows: trows } = await client.query('SELECT * FROM teams WHERE id IN ($1,$2) FOR UPDATE', [
    match.home_id,
    match.away_id,
  ]);
  const home = trows.find((t) => t.id === match.home_id);
  const away = trows.find((t) => t.id === match.away_id);

  const preMatchRatings = match.pre_match_ratings || { home: home.rating, away: away.rating };
  const outcome = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
  const eloOutcome = hg > ag ? 1 : hg < ag ? 0 : 0.5;
  const { newHome, newAway } = updateElo(preMatchRatings.home, preMatchRatings.away, eloOutcome);
  await client.query('UPDATE teams SET rating=$1 WHERE id=$2', [newHome, home.id]);
  await client.query('UPDATE teams SET rating=$1 WHERE id=$2', [newAway, away.id]);

  let playerStats = null;
  if (match.player_props) {
    playerStats = {};
    for (const playerName in match.player_props) {
      if (didNotPlay.has(playerName)) continue; // no jugó: no entra al historial ni al resultado
      const s = rawPlayerStats[playerName] || {};
      playerStats[playerName] = {
        atajadas: parseInt(s.atajadas, 10) || 0,
        faltas: parseInt(s.faltas, 10) || 0,
        remates: parseInt(s.remates, 10) || 0,
        remates_arco: parseInt(s.remates_arco, 10) || 0,
        gol: parseInt(s.gol, 10) || 0,
        asistencia: parseInt(s.asistencia, 10) || 0,
        amarilla: !!s.amarilla,
        roja: !!s.roja,
      };
    }
  }
  const result = { outcome, homeGoals: hg, awayGoals: ag, totalGoals: hg + ag, playerStats };
  await client.query(
    "UPDATE matches SET status='finished', result=$1, pre_match_ratings=$2 WHERE id=$3",
    [JSON.stringify(result), JSON.stringify(preMatchRatings), match.id]
  );

  if (playerStats) {
    const now = Date.now();
    for (const playerName in playerStats) {
      await client.query(
        'INSERT INTO player_history (player_name, match_id, stats, created_at) VALUES ($1,$2,$3,$4)',
        [playerName, match.id, JSON.stringify(playerStats[playerName]), now]
      );
    }
  }

  // liquidar apuestas (simples y combinadas) con alguna pata en este partido
  const { rows: betRows } = await client.query(
    'SELECT * FROM bets WHERE settled=FALSE AND cancelled=FALSE FOR UPDATE'
  );
  for (const bet of betRows) {
    const legs = bet.legs;
    let touched = false;
    for (const leg of legs) {
      if (leg.matchId === match.id && leg.result === null) {
        if (leg.pick.startsWith('prop|') && didNotPlay.has(parsePropPick(leg.pick).playerName)) {
          leg.result = 'void'; // el jugador no jugó: esta pata se anula
        } else {
          leg.result = evaluateBet(leg.pick, result);
        }
        touched = true;
      }
    }
    if (!touched) continue;
    const anyLost = legs.some((l) => l.result === false);
    const anyPending = legs.some((l) => l.result === null);
    let settled = false;
    let won = null;
    let voided = false;
    let effectiveOdds = null;
    if (anyLost) {
      settled = true;
      won = false;
    } else if (!anyPending) {
      const activeLegs = legs.filter((l) => l.result !== 'void');
      settled = true;
      if (activeLegs.length === 0) {
        won = null;
        voided = true;
        await applyBalanceDelta(client, bet.user_name, Number(bet.stake));
      } else {
        won = true;
        const allLegsActive = activeLegs.length === legs.length;
        effectiveOdds = (bet.super_boost_id && allLegsActive)
          ? Number(bet.combined_odds)
          : Math.round(activeLegs.reduce((p, l) => p * Number(l.oddsAtBet), 1) * 100) / 100;
        await applyBalanceDelta(client, bet.user_name, Number(bet.stake) * effectiveOdds);
      }
    }
    await client.query('UPDATE bets SET legs=$1, settled=$2, won=$3, voided=$4, effective_odds=$5 WHERE id=$6', [
      JSON.stringify(legs),
      settled,
      won,
      voided,
      effectiveOdds,
      bet.id,
    ]);
    if (settled) {
      await resetIfDepletedAndNoPendingBets(client, bet.user_name);
    }
  }

  await syncLealProps(client);
}

module.exports = { httpErr, undoMatchSettlement, applyMatchResult };
