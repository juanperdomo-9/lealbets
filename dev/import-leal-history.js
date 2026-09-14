// Importación única del historial de Leal FC que pasó el usuario por chat.
// Uso:
//   DATABASE_URL=... node dev/import-leal-history.js            (inserta)
//   DATABASE_URL=... node dev/import-leal-history.js --dry-run  (solo muestra qué haría)
//
// Los apodos se unifican con un nombre canónico (confirmados por el usuario:
// Tronce = Nahuel Troncellito, Yiyo = Enzo Bolivar, Martin = Martin Plini; el
// resto son abreviaturas obvias de Santi->Santiago / Mati->Matias / Cresci->
// Crescitelli / Tino->Valentino / Feli->Felipe / Juanpe->Juan Perdomo). Los
// apodos genuinamente ambiguos (Jota, Toty, Tuco, "Santi" sin apellido, "Santi
// Val") se dejan como están, para no adjudicarle mal un gol a alguien.
// Los autogoles ("En contra") no se cuentan como goleador de Leal.

const SCORER_ALIASES = {
  'santi suarez': 'Santiago Suarez',
  'santiago suarez': 'Santiago Suarez',
  'santi santana': 'Santiago Santana',
  'santiago santana': 'Santiago Santana',
  'mati brandan': 'Matias Brandan',
  'matias brandan': 'Matias Brandan',
  'mati b': 'Matias Brandan',
  'mati dabeni': 'Matias Dabeni',
  'matias dabeni': 'Matias Dabeni',
  'mati d': 'Matias Dabeni',
  'tino plini': 'Valentino Plini',
  'valentino plini': 'Valentino Plini',
  'tino': 'Valentino Plini',
  'elias peñaloza': 'Elias Peñaloza',
  'elias': 'Elias Peñaloza',
  'tronce': 'Nahuel Troncellito',
  'nahuel troncellito': 'Nahuel Troncellito',
  'cresci': 'Lautaro Crescitelli',
  'lautaro crescitelli': 'Lautaro Crescitelli',
  'feli': 'Felipe',
  'felipe': 'Felipe',
  'juanpe': 'Juan Perdomo',
  'juan perdomo': 'Juan Perdomo',
  'juani jurado': 'Juani Jurado',
  'juani': 'Juani Jurado',
  'yiyo': 'Enzo Bolivar',
  'enzo bolivar': 'Enzo Bolivar',
  'martin': 'Martin Plini',
  'martin plini': 'Martin Plini',
};
function canonicalScorerName(raw) {
  const key = raw.trim().toLowerCase();
  if (SCORER_ALIASES[key]) return SCORER_ALIASES[key];
  return raw.trim().replace(/\s+/g, ' ').split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}
function s(name, goals) { return { name: canonicalScorerName(name), goals }; }

// { opponent, leal, opp, scorers: [ {name, goals} ] }
const MATCHES = [
  { opponent: 'Deportivo Tilcara', leal: 4, opp: 0, scorers: [s('Matias Dabeni', 1), s('Matias Coto', 1), s('Brian Polari', 2)] },

  { opponent: 'Kush', leal: 0, opp: 3, scorers: [] },

  { opponent: 'Resistencia', leal: 1, opp: 2, scorers: [s('Brian Polari', 1)] },
  { opponent: 'Resistencia', leal: 3, opp: 0, scorers: [s('Santiago Suarez', 2), s('Juani Jurado', 1)] },
  { opponent: 'Resistencia', leal: 4, opp: 0, scorers: [s('Matias Brandan', 1), s('Juani Jurado', 1), s('Nahuel Troncellito', 1), s('Cesar', 1)] },
  { opponent: 'Resistencia', leal: 3, opp: 0, scorers: [s('Santiago Suarez', 2), s('Valentino Plini', 1)] },

  { opponent: 'Ambulancia', leal: 0, opp: 8, scorers: [] },

  { opponent: 'Hot Pie', leal: 1, opp: 6, scorers: [s('Grachi Bellagamba', 1)] },
  { opponent: 'Hot Pie', leal: 3, opp: 0, scorers: [s('Matias Brandan', 1), s('Lautaro Crescitelli', 1), s('Santiago Suarez', 1)] },
  { opponent: 'Hot Pie', leal: 0, opp: 0, scorers: [] },
  { opponent: 'Hot Pie', leal: 0, opp: 5, scorers: [] },
  { opponent: 'Hot Pie', leal: 0, opp: 2, scorers: [] },

  { opponent: 'La Hendersoneta', leal: 3, opp: 4, scorers: [s('Juani Jurado', 2), s('Santiago Suarez', 1)] },

  { opponent: 'Ferro', leal: 0, opp: 2, scorers: [] },
  { opponent: 'Ferro', leal: 2, opp: 0, scorers: [s('Elias Peñaloza', 2)] },
  { opponent: 'Ferro', leal: 1, opp: 1, scorers: [s('Santiago Suarez', 1)] },
  { opponent: 'Ferro', leal: 1, opp: 0, scorers: [s('Santiago Suarez', 1)] },

  { opponent: 'Piquiniki', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Piquiniki', leal: 1, opp: 2, scorers: [s('Juani Jurado', 1)] },
  { opponent: 'Piquiniki', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Piquiniki', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Piquiniki', leal: 2, opp: 3, scorers: [s('Santiago Suarez', 2)] },

  { opponent: 'Necochea', leal: 0, opp: 4, scorers: [] },
  { opponent: 'Necochea', leal: 0, opp: 2, scorers: [] },

  { opponent: 'LPF', leal: 2, opp: 3, scorers: [s('Santiago Suarez', 2)] },
  { opponent: 'LPF', leal: 0, opp: 0, scorers: [] },

  { opponent: 'Cachorros', leal: 1, opp: 2, scorers: [s('Santiago Suarez', 1)] },

  { opponent: 'Guarani', leal: 2, opp: 2, scorers: [s('Santiago Suarez', 1), s('Fabri Forteis', 1)] },

  { opponent: 'Barrio UPCN', leal: 1, opp: 1, scorers: [s('Santiago Suarez', 1)] },

  { opponent: 'El Plantel', leal: 3, opp: 0, scorers: [] },
  { opponent: 'El Plantel', leal: 6, opp: 0, scorers: [s('Santiago Santana', 3), s('Enzo Bolivar', 1)] },

  { opponent: 'Los Piojos', leal: 2, opp: 1, scorers: [s('Juani Jurado', 1), s('Tuco', 1)] },
  { opponent: 'Los Piojos', leal: 1, opp: 2, scorers: [s('Tronce', 1)] },
  { opponent: 'Los Piojos', leal: 1, opp: 5, scorers: [s('Matias Brandan', 1)] },

  { opponent: 'Costillar', leal: 0, opp: 0, scorers: [] },
  { opponent: 'Costillar', leal: 1, opp: 2, scorers: [s('Juani Jurado', 1)] },

  { opponent: 'Semillero', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Semillero', leal: 0, opp: 5, scorers: [] },

  { opponent: 'Cacho Catania', leal: 0, opp: 3, scorers: [] },
  { opponent: 'Cacho Catania', leal: 0, opp: 0, scorers: [] },
  { opponent: 'Cacho Catania', leal: 1, opp: 4, scorers: [s('Tino Plini', 1)] },
  { opponent: 'Cacho Catania', leal: 1, opp: 1, scorers: [s('Juani Jurado', 1)] },
  { opponent: 'Cacho Catania', leal: 1, opp: 2, scorers: [s('Mati Dabeni', 1)] },

  { opponent: 'Los Monos', leal: 0, opp: 7, scorers: [] },

  { opponent: 'Clinica 17', leal: 4, opp: 3, scorers: [s('Cresci', 1), s('Santi Suarez', 2), s('Benjamin Rodriguez', 1)] },

  { opponent: 'Cochinae', leal: 1, opp: 3, scorers: [s('Juani Jurado', 1)] },

  { opponent: '20 de Mayo', leal: 2, opp: 2, scorers: [s('Nahuel Troncellito', 1), s('Nacho Sarru', 1)] },

  { opponent: 'La 57', leal: 1, opp: 4, scorers: [s('Nacho Sarru', 1)] },

  // ojo: "Vieja Guardia 2-4 (Santi Suarez, Tronce)" y "Vieja Guardia 4-6 (Mati
  // Brandan x2, Juani Jurado x2)" NO se listan acá: ya estaban cargados a mano
  // en producción por el propio usuario antes de esta importación (con el
  // sistema viejo de texto libre) — se actualizan más abajo en vez de
  // insertarlos de nuevo, para no duplicar esos 2 partidos.
  { opponent: 'Vieja Guardia', leal: 5, opp: 3, scorers: [s('Matias Brandan', 1), s('Nicolas Monteverde', 1), s('Juani Jurado', 1), s('Santiago Suarez', 2)] },
  { opponent: 'Vieja Guardia', leal: 4, opp: 0, scorers: [s('Valentino Plini', 1), s('Elias Peñaloza', 2), s('Luca Forteis', 1)] },
  { opponent: 'Vieja Guardia', leal: 2, opp: 1, scorers: [s('Santiago Suarez', 1), s('Lautaro Crescitelli', 1)] },
  { opponent: 'Vieja Guardia', leal: 2, opp: 1, scorers: [s('Santiago Suarez', 2)] },
  { opponent: 'Vieja Guardia', leal: 2, opp: 1, scorers: [s('Juani Jurado', 1), s('Feli', 1)] },

  { opponent: 'Mercado', leal: 1, opp: 2, scorers: [s('Santi Santana', 1)] },

  { opponent: 'En una Baldosa', leal: 0, opp: 8, scorers: [] },
  { opponent: 'En una Baldosa', leal: 0, opp: 2, scorers: [] },

  { opponent: 'Almagro', leal: 2, opp: 0, scorers: [s('Santi Santana', 1), s('Tuco', 1)] },
  { opponent: 'Almagro', leal: 1, opp: 1, scorers: [s('Cresci', 1)] },

  { opponent: 'Sarmiento', leal: 4, opp: 4, scorers: [s('Mati B', 1), s('Toty', 1), s('Cresci', 1), s('Mati D', 1)] },

  { opponent: 'Estrategas', leal: 1, opp: 1, scorers: [s('Santi Santana', 1)] },

  { opponent: 'ERES', leal: 1, opp: 1, scorers: [s('Tino', 1)] },

  { opponent: 'Canilla Libre', leal: 0, opp: 4, scorers: [] },
  { opponent: 'Canilla Libre', leal: 1, opp: 1, scorers: [s('Juani Jurado', 1)] },
  { opponent: 'Canilla Libre', leal: 1, opp: 3, scorers: [s('Matias Dabeni', 1)] },
  { opponent: 'Canilla Libre', leal: 1, opp: 2, scorers: [s('Juani Jurado', 1)] },
  { opponent: 'Canilla Libre', leal: 1, opp: 4, scorers: [s('Grachi Bellagamba', 1)] },
  { opponent: 'Canilla Libre', leal: 0, opp: 3, scorers: [] },
  { opponent: 'Canilla Libre', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Canilla Libre', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Canilla Libre', leal: 0, opp: 4, scorers: [] },

  { opponent: 'Don Satur', leal: 4, opp: 0, scorers: [s('Felipe', 1), s('Santi Santana', 1), s('Santi Suarez', 1), s('Juan Perdomo', 1)] },
  { opponent: 'Don Satur', leal: 2, opp: 1, scorers: [s('Tino', 1), s('Elias', 1)] },

  { opponent: 'Birren Fut', leal: 1, opp: 1, scorers: [s('Tuco', 1)] },
  { opponent: 'Birren Fut', leal: 1, opp: 1, scorers: [s('Yiyo', 1)] },

  { opponent: 'Vaya al frente', leal: 0, opp: 2, scorers: [] },
  { opponent: 'Vaya al frente', leal: 0, opp: 2, scorers: [] },
  { opponent: 'Vaya al frente', leal: 1, opp: 2, scorers: [s('Mati Brandan', 1)] },
  { opponent: 'Vaya al frente', leal: 3, opp: 4, scorers: [s('Santi Suarez', 2), s('Leo Figueroa', 1)] },
  { opponent: 'Vaya al frente', leal: 1, opp: 1, scorers: [s('Luca Strappini', 1)] },
  { opponent: 'Vaya al frente', leal: 0, opp: 3, scorers: [] },
  { opponent: 'Vaya al frente', leal: 0, opp: 0, scorers: [] },
  { opponent: 'Vaya al frente', leal: 0, opp: 3, scorers: [] },
  { opponent: 'Vaya al frente', leal: 1, opp: 3, scorers: [s('Mati Brandan', 1)] },
  { opponent: 'Vaya al frente', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Vaya al frente', leal: 0, opp: 1, scorers: [] },

  { opponent: 'Carlos Casares', leal: 2, opp: 1, scorers: [s('Feli', 1), s('Santi', 1)] },

  { opponent: 'Cementerio FC', leal: 3, opp: 3, scorers: [s('Mati Brandan', 3)] },
  { opponent: 'Cementerio FC', leal: 3, opp: 2, scorers: [s('Santi Suarez', 2), s('Mati Brandan', 1)] },
  { opponent: 'Cementerio FC', leal: 0, opp: 5, scorers: [] },
  { opponent: 'Cementerio FC', leal: 0, opp: 3, scorers: [] },
  { opponent: 'Cementerio FC', leal: 3, opp: 2, scorers: [s('Santi Santana', 2), s('Juani Jurado', 1)] },
  { opponent: 'Cementerio FC', leal: 2, opp: 3, scorers: [s('Santi Santana', 1)] }, // + 1 en contra (autogol, no cuenta)
  { opponent: 'Cementerio FC', leal: 1, opp: 0, scorers: [s('Santi Suarez', 1)] },
  { opponent: 'Cementerio FC', leal: 1, opp: 3, scorers: [s('Yiyo', 1)] },
  { opponent: 'Cementerio FC', leal: 2, opp: 1, scorers: [s('Mati Brandan', 1), s('Mati Dabeni', 1)] },

  { opponent: 'Los Hornos City', leal: 0, opp: 2, scorers: [] },

  { opponent: 'Retruco', leal: 0, opp: 1, scorers: [] },
  { opponent: 'Retruco', leal: 0, opp: 0, scorers: [] },

  { opponent: 'DDFC', leal: 2, opp: 1, scorers: [s('Santi Suarez', 1), s('Mati Dabeni', 1)] },
  { opponent: 'DDFC', leal: 0, opp: 1, scorers: [] },
  { opponent: 'DDFC', leal: 3, opp: 2, scorers: [s('Santi Suarez', 2), s('Cresci', 1)] },
  { opponent: 'DDFC', leal: 0, opp: 2, scorers: [] },
  { opponent: 'DDFC', leal: 4, opp: 5, scorers: [s('Martin Plini', 1), s('Juani Jurado', 1), s('Feli', 1), s('Santi Val', 1)] },
  { opponent: 'DDFC', leal: 2, opp: 4, scorers: [s('Juanpe', 1), s('Jota', 1)] },
  { opponent: 'DDFC', leal: 2, opp: 1, scorers: [s('Martin', 1), s('Cresci', 1)] },
  { opponent: 'DDFC', leal: 0, opp: 0, scorers: [] },
  { opponent: 'DDFC', leal: 1, opp: 1, scorers: [s('Yiyo', 1)] },
  { opponent: 'DDFC', leal: 1, opp: 0, scorers: [s('Tronce', 1)] },
];

// Estas 4 filas ya estaban cargadas a mano en producción (por el usuario real,
// con el sistema viejo de texto libre) antes de esta importación: se les
// completa scorers_detail (les faltaba, quedaba vacío) en vez de insertarlas
// de nuevo. Se identifican por opponent + marcador + created_by, sin tocar su
// id/fecha de carga original.
const EXISTING_ROW_FIXUPS = [
  { opponent: 'La Sede', leal: 2, opp: 1, scorers: [s('Nacho Sarru', 1), s('Grachi Bellagamba', 1)] },
  { opponent: 'La Sede', leal: 2, opp: 4, scorers: [s('Yiyo', 1), s('Juani', 1)] },
  { opponent: 'Vieja Guardia', leal: 2, opp: 4, scorers: [s('Santi Suarez', 1), s('Tronce', 1)] },
  { opponent: 'Vieja Guardia', leal: 4, opp: 6, scorers: [s('Mati Brandan', 2), s('Juani Jurado', 2)] },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const totalGoalsListed = MATCHES.reduce((acc, m) => acc + m.scorers.reduce((a, sc) => a + sc.goals, 0), 0);
  console.log(`${MATCHES.length} partidos para importar, ${totalGoalsListed} goles individuales listados.`);
  console.log(`${EXISTING_ROW_FIXUPS.length} filas ya existentes a completar con scorers_detail.`);
  if (dryRun) {
    console.log('Dry run: no se escribe nada. Primeros 3 partidos parseados:');
    console.log(JSON.stringify(MATCHES.slice(0, 3), null, 2));
    return;
  }

  const { pool, uid } = require('../server/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const f of EXISTING_ROW_FIXUPS) {
      const { rowCount } = await client.query(
        `UPDATE leal_results SET scorers_detail=$1
         WHERE opponent=$2 AND leal_goals=$3 AND opponent_goals=$4 AND created_by='juanperdomo' AND scorers_detail='[]'`,
        [JSON.stringify(f.scorers), f.opponent, f.leal, f.opp]
      );
      if (rowCount !== 1) {
        throw new Error(`Se esperaba actualizar exactamente 1 fila para ${f.opponent} ${f.leal}-${f.opp}, se actualizaron ${rowCount}. Abortando para no arriesgar un dato mal pisado.`);
      }
    }
    console.log(`${EXISTING_ROW_FIXUPS.length} filas existentes completadas con scorers_detail.`);

    let ts = Date.now() - MATCHES.length * 1000; // orden estable, se insertan en el orden de la lista
    for (const m of MATCHES) {
      const id = uid();
      await client.query(
        `INSERT INTO leal_results (id, opponent, leal_goals, opponent_goals, scorers_detail, played_on, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, m.opponent, m.leal, m.opp, JSON.stringify(m.scorers), null, 'Importación histórica', ts]
      );
      ts += 1000;
    }
    await client.query('COMMIT');
    console.log(`Listo: ${MATCHES.length} partidos insertados en leal_results.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('Error importando el historial:', e); process.exit(1); });
}

module.exports = { MATCHES };
