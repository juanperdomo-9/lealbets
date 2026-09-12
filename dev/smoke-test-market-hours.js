// Prueba de humo (con una base en memoria propia, sin levantar el server HTTP)
// de la nueva lógica de cierre de mercado: se cierra el sábado a las 13:00 ART
// SOLO si queda algún partido programado antes de ese corte sin resultado
// cargado; se reabre apenas se carga ese resultado (no espera al domingo), y
// los partidos programados después del corte no vuelven a cerrarlo.
const { newDb } = require('pg-mem');
const memDb = newDb();
const pgAdapter = memDb.adapters.createPg();
const pgPath = require.resolve('pg');
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: pgAdapter };

process.env.DATABASE_URL = 'postgres://localhost/test-market-hours';
process.env.JWT_SECRET = 'x';
process.env.ADMIN_PASSWORD = 'x';
delete process.env.DISABLE_MARKET_HOURS; // acá sí queremos probar la lógica real

const { pool } = require('../server/db');
const { isMarketClosed } = require('../server/marketHours');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('OK   -', msg);
  else { console.log('FAIL -', msg); failures++; }
}

function weekdayART(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short' }).format(d);
}
// Argentina es siempre UTC-3 (sin horario de verano desde 2009)
function artIso(y, m, d, hh, mm) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`;
}

(async () => {
  await pool.query('CREATE TABLE matches (id TEXT PRIMARY KEY, status TEXT, created_at BIGINT)');
  let nextId = 1;
  async function insertMatch(status, createdAt) {
    const id = 'm' + nextId++;
    await pool.query('INSERT INTO matches (id, status, created_at) VALUES ($1,$2,$3)', [id, status, createdAt]);
    return id;
  }

  // encontramos un sábado real (año-mes-día) para construir los horarios de prueba
  let probe = new Date();
  for (let i = 0; i < 8 && weekdayART(probe) !== 'Sat'; i++) probe = new Date(probe.getTime() + 24 * 3600 * 1000);
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(probe).split('-').map(Number);

  const satNoon = new Date(artIso(y, m, d, 12, 59));
  const sat13 = new Date(artIso(y, m, d, 13, 0));
  const sat18 = new Date(artIso(y, m, d, 18, 0));
  const cutoffMs = new Date(artIso(y, m, d, 13, 0)).getTime();

  assert(await isMarketClosed(pool, satNoon) === false, 'sábado antes de las 13: abierto aunque haya partidos viejos pendientes');
  // ↑ (todavía no insertamos ninguno, pero de más está probar el caso base)

  assert(await isMarketClosed(pool, sat13) === false, 'sábado 13:00 sin ningún partido pendiente: abierto');

  const oldMatch = await insertMatch('upcoming', cutoffMs - 3600 * 1000); // creado 1h antes del corte
  assert(await isMarketClosed(pool, sat13) === true, 'con un partido viejo todavía pendiente: CERRADO');
  assert(await isMarketClosed(pool, sat18) === true, 'sigue cerrado más tarde el mismo sábado, no espera al domingo');
  assert(await isMarketClosed(pool, satNoon) === false, 'pero antes de las 13 sigue abierto sin importar los partidos viejos');

  await pool.query("UPDATE matches SET status='finished' WHERE id=$1", [oldMatch]);
  assert(await isMarketClosed(pool, sat18) === false, 'se REABRE apenas se carga el resultado (no hace falta esperar al domingo)');

  await insertMatch('upcoming', cutoffMs + 3600 * 1000); // partido nuevo, programado DESPUÉS del corte
  assert(await isMarketClosed(pool, sat18) === false, 'un partido programado después del corte no vuelve a cerrar el mercado');

  await insertMatch('upcoming', cutoffMs - 60 * 1000); // otro partido viejo (justo antes del corte)
  assert(await isMarketClosed(pool, sat18) === true, 'un segundo partido viejo sin resultado vuelve a cerrarlo');

  console.log('\n' + (failures === 0 ? 'TODO OK (0 fallos)' : `${failures} FALLO(S)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('Error en la prueba de humo de horario de mercado:', e); process.exit(1); });
