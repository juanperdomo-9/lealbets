const { Pool } = require('pg');
const { computeOdds } = require('./oddsEngine');
const { SEED_TEAMS, SEED_FIXTURE, seedRating } = require('./lealProps');

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
`;

async function initSchema() {
  await pool.query(SCHEMA);
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

module.exports = { pool, uid, initSchema, seedIfEmpty };
