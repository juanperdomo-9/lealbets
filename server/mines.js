// Motor de "Minas": cálculo puro. El servidor decide siempre dónde están las
// minas — el cliente solo pide revelar un casillero o cobrar.
const OVERROUND = 1.08; // mismo margen que el resto de la casa
const GRID_SIZE = 25; // tablero de 5x5

function generateGrid(minesCount) {
  const grid = new Array(GRID_SIZE).fill(false);
  let placed = 0;
  while (placed < minesCount) {
    const idx = Math.floor(Math.random() * GRID_SIZE);
    if (!grid[idx]) {
      grid[idx] = true;
      placed++;
    }
  }
  return grid; // true = mina
}

// cuota justa de revelar `revealedCount` casilleros seguros seguidos (sin reposición),
// con el margen de la casa
function multiplierForReveals(minesCount, revealedCount) {
  if (revealedCount <= 0) return 1;
  const N = GRID_SIZE;
  const M = minesCount;
  let fair = 1;
  for (let i = 0; i < revealedCount; i++) {
    fair *= (N - i) / (N - M - i);
  }
  return Math.max(1.01, Math.round((fair / OVERROUND) * 100) / 100);
}

module.exports = { OVERROUND, GRID_SIZE, generateGrid, multiplierForReveals };
