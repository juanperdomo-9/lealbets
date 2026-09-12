// Cierre de mercado: se cierra el sábado a las 13:00 (hora Argentina) y se
// queda cerrado hasta que el admin cargue los resultados de los partidos
// que ya estaban programados para ese momento — no hasta una hora fija del
// domingo. Una vez cargados esos resultados (o si el admin programa
// partidos nuevos después del cierre), vuelve a estar abierto aunque
// todavía sea sábado, y así se queda hasta el sábado siguiente a las 13:00.
// No afecta al panel de admin ni al blackjack.
//
// Importante: el servidor corre en UTC (Render), así que hay que convertir
// explícitamente a America/Argentina/Buenos_Aires en vez de usar
// new Date().getDay()/.getHours() directo (eso compararía contra UTC).
const { pool } = require('./db');

function argentinaParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday').value; // 'Sat', 'Sun', ...
  let hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  if (hour === 24) hour = 0; // algunas versiones de ICU devuelven "24" en vez de "0" a la medianoche
  return { weekday, hour };
}

// Argentina no tiene horario de verano desde 2009 (siempre UTC-3), así que
// alcanza con el offset fijo "-03:00" para construir el corte de hoy a las 13:00.
function todaySaturday13ArtMs(date) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(date); // YYYY-MM-DD
  return new Date(`${ymd}T13:00:00-03:00`).getTime();
}

// `client` es opcional (pool por default); se puede pasar el cliente de una
// transacción en curso para leer un estado consistente con lo que se está
// por escribir.
async function isMarketClosed(client = pool, date = new Date()) {
  // pensado solo para dev/tests (dev/dev-server.js), nunca se setea en producción
  if (process.env.DISABLE_MARKET_HOURS === 'true') return false;

  const { weekday, hour } = argentinaParts(date);
  if (!(weekday === 'Sat' && hour >= 13)) return false;

  // cerrado solo si queda algún partido programado ANTES de este corte que
  // todavía no tenga resultado cargado; los partidos programados después
  // (los del próximo fin de semana) no cuentan para mantenerlo cerrado.
  const cutoffMs = todaySaturday13ArtMs(date);
  const { rows } = await client.query(
    "SELECT 1 FROM matches WHERE status='upcoming' AND created_at < $1 LIMIT 1",
    [cutoffMs]
  );
  return rows.length > 0;
}

module.exports = { isMarketClosed, argentinaParts, todaySaturday13ArtMs };
