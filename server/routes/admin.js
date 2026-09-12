const express = require('express');
const { pool, uid, applyBalanceDelta } = require('../db');
const { requireAdmin } = require('../auth');
const { computeOdds, updateElo, evaluateBet, parsePropPick, oddsFor } = require('../oddsEngine');
const { syncLealProps, rowToMatch } = require('../state');
const { broadcastStateUpdate } = require('../realtime');

const router = express.Router();
router.use(requireAdmin);

function httpErr(status, message) {
  return Object.assign(new Error(message), { status });
}

router.post('/teams', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Escribí un nombre de equipo' });
    await pool.query('INSERT INTO teams (id, name, rating) VALUES ($1,$2,1500)', [uid(), name]);
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un equipo con ese nombre' });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/matches', async (req, res) => {
  try {
    const homeId = String(req.body.homeId || '');
    const awayId = String(req.body.awayId || '');
    if (!homeId || !awayId || homeId === awayId) {
      return res.status(400).json({ error: 'Elegí dos equipos distintos' });
    }
    const { rows } = await pool.query('SELECT * FROM teams WHERE id IN ($1,$2)', [homeId, awayId]);
    const home = rows.find((t) => t.id === homeId);
    const away = rows.find((t) => t.id === awayId);
    if (!home || !away) return res.status(400).json({ error: 'Equipo inválido' });
    const odds = computeOdds(home.rating, away.rating);
    await pool.query(
      `INSERT INTO matches (id, home_id, away_id, home_name, away_name, odds, status, result, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'upcoming',NULL,$7)`,
      [uid(), home.id, away.id, home.name, away.name, JSON.stringify(odds), Date.now()]
    );
    await syncLealProps();
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Superaumento: el admin arma una combinada de un solo partido y le pone una
// cuota fija más alta que la natural. Se muestra como cartel fijo arriba de
// los partidos hasta que se desactiva o el partido termina.
router.post('/superboost', async (req, res) => {
  try {
    const matchId = String(req.body.matchId || '');
    const picks = Array.isArray(req.body.legs) ? req.body.legs.map(String) : [];
    const boostedOdds = Math.round(Number(req.body.boostedOdds) * 100) / 100;
    if (picks.length === 0) return res.status(400).json({ error: 'Elegí al menos una selección' });
    if (!Number.isFinite(boostedOdds) || boostedOdds <= 1) {
      return res.status(400).json({ error: 'Poné una cuota nueva válida' });
    }
    const { rows } = await pool.query('SELECT * FROM matches WHERE id=$1', [matchId]);
    if (rows.length === 0) return res.status(400).json({ error: 'Partido inválido' });
    if (rows[0].status !== 'upcoming') return res.status(400).json({ error: 'Ese partido ya no está pendiente' });
    const match = rowToMatch(rows[0]);
    let naturalOdds = 1;
    for (const pick of picks) {
      const odds = oddsFor(match, pick);
      if (odds === null || odds === undefined) return res.status(400).json({ error: `Selección inválida: ${pick}` });
      naturalOdds *= odds;
    }
    naturalOdds = Math.round(naturalOdds * 100) / 100;
    if (boostedOdds <= naturalOdds) {
      return res.status(400).json({ error: `La cuota nueva tiene que ser mayor a la cuota natural (${naturalOdds})` });
    }
    await pool.query(
      'INSERT INTO super_boosts (id, match_id, legs, boosted_odds, active, created_at) VALUES ($1,$2,$3,$4,TRUE,$5)',
      [uid(), matchId, JSON.stringify(picks), boostedOdds, Date.now()]
    );
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/superboost/:id/deactivate', async (req, res) => {
  try {
    await pool.query('UPDATE super_boosts SET active=FALSE WHERE id=$1', [req.params.id]);
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.post('/matches/:id/result', async (req, res) => {
  const matchId = req.params.id;
  const hg = parseInt(req.body.homeGoals, 10);
  const ag = parseInt(req.body.awayGoals, 10);
  const rawPlayerStats = req.body.playerStats && typeof req.body.playerStats === 'object' ? req.body.playerStats : {};
  const didNotPlay = new Set(Array.isArray(req.body.didNotPlay) ? req.body.didNotPlay : []);
  if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) {
    return res.status(400).json({ error: 'Cargá el marcador completo' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: mrows } = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId]);
    if (mrows.length === 0) throw httpErr(404, 'Partido no encontrado');
    const match = mrows[0];
    if (match.status !== 'upcoming') throw httpErr(400, 'Ese partido ya no está pendiente');

    const { rows: trows } = await client.query('SELECT * FROM teams WHERE id IN ($1,$2) FOR UPDATE', [
      match.home_id,
      match.away_id,
    ]);
    const home = trows.find((t) => t.id === match.home_id);
    const away = trows.find((t) => t.id === match.away_id);
    const outcome = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
    const eloOutcome = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    const { newHome, newAway } = updateElo(home.rating, away.rating, eloOutcome);
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
    await client.query("UPDATE matches SET status='finished', result=$1 WHERE id=$2", [
      JSON.stringify(result),
      matchId,
    ]);

    if (playerStats) {
      const now = Date.now();
      for (const playerName in playerStats) {
        await client.query(
          'INSERT INTO player_history (player_name, match_id, stats, created_at) VALUES ($1,$2,$3,$4)',
          [playerName, matchId, JSON.stringify(playerStats[playerName]), now]
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
        if (leg.matchId === matchId && leg.result === null) {
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
          // se anularon todas las patas: se devuelve el monto apostado
          won = null;
          voided = true;
          await applyBalanceDelta(client, bet.user_name, Number(bet.stake));
        } else {
          won = true;
          // si es un superaumento y ninguna pata se anuló, se paga la cuota fija que
          // puso el admin; si alguna pata se anuló, no queda "el combo completo" y se
          // vuelve al cálculo normal (producto de las cuotas reales que sobrevivieron).
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
    }

    await syncLealProps(client);
    await client.query('COMMIT');
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

router.post('/matches/:id/reopen', async (req, res) => {
  const matchId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: mrows } = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId]);
    if (mrows.length === 0) throw httpErr(404, 'Partido no encontrado');

    await client.query("UPDATE matches SET status='upcoming', result=NULL WHERE id=$1", [matchId]);

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

    await syncLealProps(client);
    await client.query('COMMIT');
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
