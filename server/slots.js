// Motor de "Tragamonedas": cálculo puro (como mines.js), 5 rodillos x 3 filas,
// 10 líneas de pago fijas, comodín, scatter y una ronda bonus de giros gratis
// con multiplicador acumulado (juego original de Leal Bets — no es ninguna
// tragamonedas real ni copia de ninguna marca).
const REELS = 5;
const ROWS = 3;

// símbolos base (los que aparecen en el juego normal). El peso decide qué tan
// seguido sale cada uno; los "ficha de color" son los de menos pago (guiño a
// que la moneda del casino son fichas), después pelota/copa/escudo, y arriba
// el comodín y el scatter.
const SYMBOLS = {
  CHIP_W: { weight: 26, pay: { 3: 4, 4: 9, 5: 27 } },
  CHIP_G: { weight: 22, pay: { 3: 5, 4: 14, 5: 36 } },
  CHIP_B: { weight: 18, pay: { 3: 7, 4: 18, 5: 45 } },
  CHIP_R: { weight: 14, pay: { 3: 9, 4: 22, 5: 54 } },
  BALL: { weight: 9, pay: { 3: 14, 4: 36, 5: 90 } },
  CUP: { weight: 5, pay: { 3: 22, 4: 54, 5: 144 } },
  CREST: { weight: 3, pay: { 3: 36, 4: 90, 5: 270 } },
  WILD: { weight: 2, pay: { 3: 45, 4: 108, 5: 360 } }, // sustituye a cualquiera; si la línea es toda comodines, paga esto
  SCATTER: { weight: 3, pay: {} }, // no paga por línea: paga por cantidad total en cualquier lado (ver SCATTER_PAY)
};
const BASE_WEIGHTS = Object.entries(SYMBOLS).map(([id, s]) => [id, s.weight]);
const BASE_TOTAL_WEIGHT = BASE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

// en la ronda bonus (giros gratis) no hay líneas de pago: solo importa el
// símbolo "multiplicador" (MULT), que junta valor en el marcador acumulado.
// Aparece bastante más seguido que en el juego normal para que la ronda
// bonus se sienta especial.
const BONUS_WEIGHTS = [
  ['CHIP_W', 22], ['CHIP_G', 18], ['CHIP_B', 15], ['CHIP_R', 12],
  ['BALL', 8], ['CUP', 5], ['CREST', 3], ['WILD', 2],
  ['MULT', 15],
];
const BONUS_TOTAL_WEIGHT = BONUS_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

// valor que suma cada símbolo MULT que sale en un giro gratis (ponderado: los
// valores altos son raros)
const MULT_VALUES = [
  [1, 42], [2, 26], [3, 15], [5, 10], [10, 5], [20, 2],
];
const MULT_TOTAL_WEIGHT = MULT_VALUES.reduce((sum, [, w]) => sum + w, 0);

// scatter (trofeo): paga como múltiplo de la apuesta TOTAL (no de línea) según
// cuántos salieron en cualquier parte de la grilla, y además dispara giros
// gratis.
const SCATTER_PAY = { 3: 4, 4: 18, 5: 90 };
const SCATTER_FREE_SPINS = { 3: 8, 4: 10, 5: 12 };

// 10 líneas de pago clásicas sobre una grilla de 5 columnas x 3 filas
// (0=arriba, 1=medio, 2=abajo); cada línea es la fila que ocupa en cada
// columna, de izquierda a derecha.
const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];
const NUM_LINES = PAYLINES.length;

function weightedPick(weights, totalWeight) {
  let r = Math.random() * totalWeight;
  for (const [id, w] of weights) {
    r -= w;
    if (r <= 0) return id;
  }
  return weights[weights.length - 1][0];
}

// grilla[columna][fila]
function generateGrid(weights, totalWeight) {
  const grid = [];
  for (let c = 0; c < REELS; c++) {
    const col = [];
    for (let r = 0; r < ROWS; r++) col.push(weightedPick(weights, totalWeight));
    grid.push(col);
  }
  return grid;
}

// evalúa las 10 líneas fijas sobre la grilla del juego base: cuenta, para
// cada línea, cuántos símbolos iguales (contando comodines) hay seguidos
// desde la columna 0, y paga si son 3 o más.
function evaluateLines(grid, lineBet) {
  const lineWins = [];
  for (let li = 0; li < NUM_LINES; li++) {
    const rowsForLine = PAYLINES[li];
    const symbols = rowsForLine.map((row, col) => grid[col][row]);
    // símbolo objetivo: el primero que no sea comodín (si son todos
    // comodines, la línea paga como comodín)
    let target = symbols.find((s) => s !== 'WILD' && s !== 'SCATTER');
    if (!target) target = 'WILD';
    if (target === 'SCATTER') continue; // el scatter no arma línea, paga aparte
    let count = 0;
    for (const s of symbols) {
      if (s === target || s === 'WILD') count++;
      else break;
    }
    if (count >= 3) {
      const mult = SYMBOLS[target].pay[count] || 0;
      if (mult > 0) {
        const amount = Math.round(lineBet * mult * 100) / 100;
        lineWins.push({ line: li, symbol: target, count, multiplier: mult, amount });
      }
    }
  }
  return lineWins;
}

function countScatters(grid) {
  let n = 0;
  for (let c = 0; c < REELS; c++) for (let r = 0; r < ROWS; r++) if (grid[c][r] === 'SCATTER') n++;
  return n;
}

// un giro del juego base: cobra por línea + por scatter, y si salen 3+
// scatters además devuelve cuántos giros gratis se ganaron.
function spinBase(stake) {
  const lineBet = stake / NUM_LINES;
  const grid = generateGrid(BASE_WEIGHTS, BASE_TOTAL_WEIGHT);
  const lineWins = evaluateLines(grid, lineBet);
  const scatterCount = countScatters(grid);
  const scatterMult = SCATTER_PAY[scatterCount] || 0;
  const scatterWin = Math.round(stake * scatterMult * 100) / 100;
  const lineWinTotal = lineWins.reduce((sum, w) => sum + w.amount, 0);
  const totalWin = Math.round((lineWinTotal + scatterWin) * 100) / 100;
  const freeSpinsAwarded = SCATTER_FREE_SPINS[scatterCount] || 0;
  return { grid, lineWins, scatterCount, scatterWin, totalWin, freeSpinsAwarded };
}

// un giro de la ronda bonus: sin líneas, solo suma lo que traigan los
// símbolos MULT que salieron.
function spinBonus() {
  const grid = generateGrid(BONUS_WEIGHTS, BONUS_TOTAL_WEIGHT);
  const hits = [];
  for (let c = 0; c < REELS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (grid[c][r] === 'MULT') {
        const value = weightedPick(MULT_VALUES, MULT_TOTAL_WEIGHT);
        hits.push({ col: c, row: r, value });
      }
    }
  }
  const collected = hits.reduce((sum, h) => sum + h.value, 0);
  return { grid, hits, collected };
}

module.exports = {
  REELS, ROWS, NUM_LINES, PAYLINES, SYMBOLS, SCATTER_PAY, SCATTER_FREE_SPINS,
  spinBase, spinBonus,
};
