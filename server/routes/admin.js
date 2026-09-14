const express = require('express');
const { pool, uid } = require('../db');
const { requireAdmin } = require('../auth');
const { computeOdds, oddsFor } = require('../oddsEngine');
const { syncLealProps, rowToMatch } = require('../state');
const { broadcastStateUpdate } = require('../realtime');
const { httpErr, undoMatchSettlement, applyMatchResult } = require('../matchSettlement');

const router = express.Router();
router.use(requireAdmin);

// Cargar (o quitar, con un número negativo) fichas a un jugador a mano.
router.post('/users/:name/chips', async (req, res) => {
  try {
    const name = req.params.name;
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'Poné una cantidad de fichas válida (distinta de cero)' });
    }
    const { rows } = await pool.query(
      'UPDATE users SET balance = GREATEST(balance + $1, 0) WHERE name=$2 RETURNING balance',
      [amount, name]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    broadcastStateUpdate();
    res.json({ ok: true, balance: Number(rows[0].balance) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Habilitar (o quitarle) a un usuario el permiso de cargar resultados en el
// historial de Leal FC del footer (por defecto nadie lo tiene, ni siquiera
// jugadores nuevos: el admin decide a quién se lo da).
router.post('/users/:name/leal-history-access', async (req, res) => {
  try {
    const name = req.params.name;
    const allowed = !!req.body.allowed;
    const { rows } = await pool.query(
      'UPDATE users SET can_log_leal_history=$1 WHERE name=$2 RETURNING name',
      [allowed, name]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    broadcastStateUpdate();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

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

function parseResultBody(req) {
  const hg = parseInt(req.body.homeGoals, 10);
  const ag = parseInt(req.body.awayGoals, 10);
  const rawPlayerStats = req.body.playerStats && typeof req.body.playerStats === 'object' ? req.body.playerStats : {};
  const didNotPlay = new Set(Array.isArray(req.body.didNotPlay) ? req.body.didNotPlay : []);
  return { hg, ag, rawPlayerStats, didNotPlay };
}

router.post('/matches/:id/result', async (req, res) => {
  const matchId = req.params.id;
  const { hg, ag, rawPlayerStats, didNotPlay } = parseResultBody(req);
  if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) {
    return res.status(400).json({ error: 'Cargá el marcador completo' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: mrows } = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId]);
    if (mrows.length === 0) throw httpErr(404, 'Partido no encontrado');
    const match = mrows[0];
    if (match.status !== 'upcoming') throw httpErr(400, 'Ese partido ya no está pendiente (¿lo querés editar en vez de cargarlo?)');
    await applyMatchResult(client, match, hg, ag, rawPlayerStats, didNotPlay);
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

// Corrige el marcador/estadísticas de un partido YA finalizado, sin pasar
// por 'upcoming' en ningún momento (no vuelve a quedar apostable). Deshace
// la liquidación anterior y la vuelve a aplicar con los valores corregidos,
// recalculando el Elo siempre desde el mismo snapshot pre-partido.
router.put('/matches/:id/result', async (req, res) => {
  const matchId = req.params.id;
  const { hg, ag, rawPlayerStats, didNotPlay } = parseResultBody(req);
  if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) {
    return res.status(400).json({ error: 'Cargá el marcador completo' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: mrows } = await client.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [matchId]);
    if (mrows.length === 0) throw httpErr(404, 'Partido no encontrado');
    const match = mrows[0];
    if (match.status !== 'finished') throw httpErr(400, 'Ese partido todavía no tiene resultado cargado');
    await undoMatchSettlement(client, matchId);
    await applyMatchResult(client, match, hg, ag, rawPlayerStats, didNotPlay);
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
    const match = mrows[0];

    await undoMatchSettlement(client, matchId);

    if (match.pre_match_ratings) {
      const pmr = match.pre_match_ratings;
      await client.query('UPDATE teams SET rating=$1 WHERE id=$2', [pmr.home, match.home_id]);
      await client.query('UPDATE teams SET rating=$1 WHERE id=$2', [pmr.away, match.away_id]);
    }
    await client.query("UPDATE matches SET status='upcoming', result=NULL, pre_match_ratings=NULL WHERE id=$1", [matchId]);

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
