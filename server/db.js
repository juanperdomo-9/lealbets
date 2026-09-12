const { Pool } = require('pg');
const { computeOdds } = require('./oddsEngine');
const { SEED_TEAMS, SEED_FIXTURE, seedRating } = require('./lealProps');
const { STARTING_CHIPS } = require('./constants');

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable de entorno DATABASE_URL (connection string de Postgres).');
  process.exit(1);
}

// Neon/Render suelen requerir SSL; en local (postgres://localhost) no hace falta.
const useSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rating INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL REFERENCES teams(id),
  away_id TEXT NOT NULL REFERENCES teams(id),
  home_name TEXT NOT NULL,
  away_name TEXT NOT NULL,
  odds JSONB NOT NULL,
  player_props JSONB,
  status TEXT NOT NULL DEFAULT 'upcoming',
  result JSONB,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 30000,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bets (
  id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL REFERENCES users(name),
  stake NUMERIC NOT NULL,
  combined_odds NUMERIC NOT NULL,
  legs JSONB NOT NULL,
  settled BOOLEAN NOT NULL DEFAULT FALSE,
  won BOOLEAN,
  voided BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  effective_odds NUMERIC,
  placed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_history (
  id SERIAL PRIMARY KEY,
  player_name TEXT NOT NULL,
  match_id TEXT NOT NULL,
  stats JSONB NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS super_boosts (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  legs JSONB NOT NULL,
  boosted_odds NUMERIC NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL
);
`;

// Migraciones chiquitas y seguras para bases ya desplegadas (no tocan datos existentes).
const MIGRATIONS = `
ALTER TABLE bets ADD COLUMN IF NOT EXISTS super_boost_id TEXT REFERENCES super_boosts(id);
`;

async function initSchema() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
}

async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM teams');
  if (rows[0].n > 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teamsByName = {};
    for (const t of SEED_TEAMS) {
      const id = uid();
      const rating = seedRating(t);
      teamsByName[t.name] = { id, rating };
      await client.query('INSERT INTO teams (id, name, rating) VALUES ($1,$2,$3)', [id, t.name, rating]);
    }
    for (const [homeName, awayName] of SEED_FIXTURE) {
      const home = teamsByName[homeName];
      const away = teamsByName[awayName];
      const odds = computeOdds(home.rating, away.rating);
      await client.query(
        `INSERT INTO matches (id, home_id, away_id, home_name, away_name, odds, status, result, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'upcoming',NULL,$7)`,
        [uid(), home.id, away.id, homeName, awayName, JSON.stringify(odds), Date.now()]
      );
    }
    await client.query('COMMIT');
    console.log('Base de datos sembrada con equipos y fixture inicial.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Suma (o resta) `delta` al saldo del usuario (debe llamarse dentro de una
// transacción, con el cliente de esa transacción). No restablece fichas acá:
// eso se decide aparte con resetIfDepletedAndNoPendingBets, para no devolver
// fichas mientras todavía tiene una combinada pendiente que podría salvarlo.
async function applyBalanceDelta(client, userName, delta) {
  await client.query('UPDATE users SET balance = balance + $1 WHERE name=$2', [delta, userName]);
}

// Si el usuario quedó con 0 fichas o menos Y no le queda ninguna apuesta
// pendiente (todas sus combinadas ya se resolvieron, perdidas o no), recién
// ahí se le restablecen las fichas iniciales para que pueda seguir jugando.
// Llamar siempre DESPUÉS de dejar reflejado en la tabla bets el resultado de
// la apuesta que se acaba de resolver (si no, esa apuesta todavía cuenta como
// "pendiente" y no se restablece nada). Devuelve true si hubo restablecimiento.
async function resetIfDepletedAndNoPendingBets(client, userName) {
  const { rows } = await client.query(
    `UPDATE users SET balance=$1
     WHERE name=$2 AND balance <= 0
       AND NOT EXISTS (SELECT 1 FROM bets WHERE user_name=$2 AND settled=FALSE AND cancelled=FALSE)
     RETURNING balance`,
    [STARTING_CHIPS, userName]
  );
  return rows.length > 0;
}

module.exports = { pool, uid, initSchema, seedIfEmpty, applyBalanceDelta, resetIfDepletedAndNoPendingBets };
