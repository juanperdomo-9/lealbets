// Lista base (creencia previa) de cuotas por jugador de Leal FC.
// Con cero partidos jugados, buildDynamicLealProps() reproduce exactamente esta lista.
const LEAL_TEAM_NAME = 'Leal FC';

const LEAL_PROPS = {
  'Alexis Villarreal': { atajadas: { 2: 1.4, 3: 2.5, 4: 3.75 } },
  'Luca Forteis': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.9, 2: 3, 3: 7 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 20, asistencia: 10, amarilla: 2.5, roja: 30,
  },
  'Nahuel Troncellito': {
    faltas: { 1: 1.3, 2: 2, 3: 3 },
    remates: { 1: 1.7, 2: 3, 3: 7 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 20, asistencia: 10, amarilla: 1.7, roja: 20,
  },
  'Juan Perdomo': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 2.5, 2: 5.5, 3: 13 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 40, asistencia: 20, amarilla: 2.5, roja: 30,
  },
  'Leo Figueroa': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.9, 2: 3, 3: 7 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 20, asistencia: 10, amarilla: 2.5, roja: 30,
  },
  'Tino Plini': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.9, 2: 3, 3: 7 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 20, asistencia: 10, amarilla: 2.5, roja: 30,
  },
  'Mati Dabeni': {
    faltas: { 1: 1.7, 2: 2.8, 3: 4.5 },
    remates: { 1: 1.5, 2: 2.75, 3: 5 },
    remates_arco: { 1: 2.8, 2: 7 },
    gol: 12, asistencia: 5, amarilla: 2, roja: 19,
  },
  'Lisandro Moretti': {
    faltas: { 1: 1.6, 2: 2.8, 3: 4.5 },
    remates: { 1: 1.5, 2: 2.75, 3: 5 },
    remates_arco: { 1: 2.8, 2: 7 },
    gol: 12, asistencia: 5, amarilla: 3, roja: 30,
  },
  'Lauti Crescitelli': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.4, 2: 2.2, 3: 4.2 },
    remates_arco: { 1: 2.5, 2: 7 },
    gol: 15, asistencia: 5, amarilla: 2, roja: 20,
  },
  'Nico Monteverde': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.8, 2: 3, 3: 7 },
    remates_arco: { 1: 3, 2: 10 },
    gol: 20, asistencia: 10, amarilla: 2.75, roja: 30,
  },
  'Feli Cantero': {
    faltas: { 1: 1.7, 2: 2.7, 3: 4.5 },
    remates: { 1: 1.3, 2: 2, 3: 4.33 },
    remates_arco: { 1: 2, 2: 5 },
    gol: 7, asistencia: 4, amarilla: 2, roja: 30,
  },
  'Eli Peñaloza': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 2: 1.7, 3: 3, 4: 7 },
    remates_arco: { 1: 2, 2: 4.5 },
    gol: 5, asistencia: 4, amarilla: 2, roja: 30,
  },
  'Grachi Bellagamba': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 2: 1.6, 3: 2.75, 4: 5 },
    remates_arco: { 1: 1.8, 2: 4 },
    gol: 5, asistencia: 5, amarilla: 3, roja: 30,
  },
  'Nacho Sarru': {
    faltas: { 1: 1.7, 2: 2.7, 3: 4.33 },
    remates: { 1: 1.4, 2: 2.5, 3: 6 },
    remates_arco: { 1: 2, 2: 5 },
    gol: 7, asistencia: 7, amarilla: 3.5, roja: 30,
  },
  'Jota Undagarin': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.6, 2: 2.9, 3: 6 },
    remates_arco: { 1: 2.8, 2: 7 },
    gol: 10, asistencia: 7, amarilla: 2.33, roja: 30,
  },
  'Axel Desiderio': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.4, 2: 2.33, 3: 4 },
    remates_arco: { 1: 2, 2: 7 },
    gol: 11, asistencia: 8, amarilla: 4, roja: 30,
  },
  'Bauti Marche': {
    faltas: { 1: 1.5, 2: 2.4, 3: 4 },
    remates: { 1: 1.4, 2: 2.33, 3: 4 },
    remates_arco: { 1: 2, 2: 7 },
    gol: 11, asistencia: 8, amarilla: 4, roja: 30,
  },
};

// Orden en el que se muestran los jugadores de Leal FC en la web (el mismo
// en el que se cargó la lista). No alcanza con el orden de las claves del
// objeto LEAL_PROPS: al guardarse como jsonb en Postgres y volver a leerse,
// Postgres NO garantiza conservar el orden de las claves — por eso el orden
// de exhibición se guarda acá aparte y se manda explícito al frontend.
const LEAL_PLAYER_ORDER = Object.keys(LEAL_PROPS);

const SEED_TEAMS = [
  { name: 'Canilla Libre', pts: 10, gd: 6 },
  { name: 'Leal FC', pts: 10, gd: 4 },
  { name: 'La Sede', pts: 9, gd: 9 },
  { name: 'Cementerio FC', pts: 7, gd: 5 },
  { name: 'Retruco', pts: 7, gd: 2 },
  { name: 'Carlos Casares', pts: 3, gd: -4 },
  { name: 'DDFC', pts: 0, gd: -9 },
  { name: 'Vaya al frente', pts: 0, gd: -13 },
];

const SEED_FIXTURE = [
  ['Retruco', 'Canilla Libre'],
  ['Leal FC', 'La Sede'],
  ['Cementerio FC', 'Carlos Casares'],
  ['DDFC', 'Vaya al frente'],
];

function seedRating(team) {
  const avgPts = SEED_TEAMS.reduce((s, t) => s + t.pts, 0) / SEED_TEAMS.length;
  return Math.round(1500 + (team.pts - avgPts) * 25 + team.gd * 10);
}

module.exports = { LEAL_TEAM_NAME, LEAL_PROPS, LEAL_PLAYER_ORDER, SEED_TEAMS, SEED_FIXTURE, seedRating };
