// Motor de "Ruleta europea": cálculo puro (un solo cero, como una ruleta de
// verdad — nada de doble cero ni pagos inventados). El servidor sortea
// siempre el número ganador; el cliente solo elige qué apostar.
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// orden real de los casilleros en la rueda física (no es 0,1,2,3...): se usa
// para calcular a qué ángulo tiene que frenar la bola y que la animación
// quede prolija. Mismo orden que public/js/app.js (RL_WHEEL_ORDER) — ahí es
// solo para dibujar, acá es la fuente de verdad del sorteo.
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// posición de un número (1-36) en el paño de apuestas (no en la rueda física):
// 3 filas x 12 columnas, fila 1 = arriba (múltiplos de 3), fila 3 = abajo —
// mismo layout que arma public/js/app.js (rlFeltHtml), para poder validar acá
// que un caballo/cuadro pedido sea geométricamente real y no cualquier cosa.
function feltNumber(col, row) {
  if (row === 1) return col * 3;
  if (row === 2) return col * 3 - 1;
  return col * 3 - 2;
}
// (como feltNumber(col,1)=3col, feltNumber(col,2)=3col-1, feltNumber(col,3)=3col-2,
// el resto de dividir n por 3 identifica la fila sin ambigüedad: resto 0 → fila 1,
// resto 2 → fila 2, resto 1 → fila 3)
function feltPositionOf(n) {
  const col = Math.ceil(n / 3);
  const rem = n % 3;
  const row = rem === 0 ? 1 : rem === 2 ? 2 : 3;
  return { col, row };
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// ¿son "a" y "b" geométricamente vecinos en el paño? (para validar un caballo)
function areSplitNeighbors(a, b) {
  if (a === b) return false;
  if (a === 0 || b === 0) {
    const other = a === 0 ? b : a;
    return other === 1 || other === 2 || other === 3; // el 0 solo linda con la primera columna
  }
  const pa = feltPositionOf(a);
  const pb = feltPositionOf(b);
  if (pa.row === pb.row) return Math.abs(pa.col - pb.col) === 1; // vecinos en la misma fila
  if (pa.col === pb.col) return Math.abs(pa.row - pb.row) === 1; // vecinos en la misma columna
  return false;
}
// ¿los 4 números pedidos forman un cuadro real (2x2) en el paño?
function isValidCorner(nums) {
  if (nums.length !== 4 || nums.some((n) => n === 0)) return false;
  if (new Set(nums).size !== 4) return false;
  for (let col = 1; col <= 11; col++) {
    for (let row = 1; row <= 2; row++) {
      const block = [feltNumber(col, row), feltNumber(col + 1, row), feltNumber(col, row + 1), feltNumber(col + 1, row + 1)];
      if (sameSet(block, nums)) return true;
    }
  }
  return false;
}

// tipos de apuesta soportados y su multiplicador de pago TOTAL (ya incluye
// devolver la ficha apostada, no es "a favor"): pleno paga 36 (35 a 1 + la
// apuesta), caballo 18 (17 a 1), cuadro 9 (8 a 1), los de afuera 1 a 1 pagan
// 2, docena/columna (2 a 1) pagan 3 — son los pagos reales de la ruleta
// europea.
const BET_TYPES = ['number', 'split', 'corner', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column'];

function isWinningBet(betType, betValue, winningNumber) {
  switch (betType) {
    case 'number': return betValue === winningNumber;
    case 'split': return Array.isArray(betValue) && betValue.includes(winningNumber);
    case 'corner': return Array.isArray(betValue) && betValue.includes(winningNumber);
    case 'red': return colorOf(winningNumber) === 'red';
    case 'black': return colorOf(winningNumber) === 'black';
    case 'even': return winningNumber !== 0 && winningNumber % 2 === 0;
    case 'odd': return winningNumber % 2 === 1;
    case 'low': return winningNumber >= 1 && winningNumber <= 18;
    case 'high': return winningNumber >= 19 && winningNumber <= 36;
    case 'dozen': return winningNumber !== 0 && betValue === Math.ceil(winningNumber / 12);
    case 'column': return winningNumber !== 0 && betValue === (((winningNumber - 1) % 3) + 1);
    default: return false;
  }
}
function payoutMultiplier(betType) {
  switch (betType) {
    case 'number': return 36;
    case 'split': return 18;
    case 'corner': return 9;
    case 'red': case 'black': case 'even': case 'odd': case 'low': case 'high': return 2;
    case 'dozen': case 'column': return 3;
    default: return 0;
  }
}

function validateBet(betType, betValue) {
  if (!BET_TYPES.includes(betType)) return false;
  if (betType === 'number') return Number.isInteger(betValue) && betValue >= 0 && betValue <= 36;
  if (betType === 'split') {
    if (!Array.isArray(betValue) || betValue.length !== 2) return false;
    const [a, b] = betValue;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 36 || b < 0 || b > 36) return false;
    return areSplitNeighbors(a, b);
  }
  if (betType === 'corner') {
    if (!Array.isArray(betValue) || betValue.length !== 4) return false;
    if (!betValue.every((n) => Number.isInteger(n) && n >= 1 && n <= 36)) return false;
    return isValidCorner(betValue);
  }
  if (betType === 'dozen') return [1, 2, 3].includes(betValue);
  if (betType === 'column') return [1, 2, 3].includes(betValue);
  return true; // red/black/even/odd/low/high no llevan betValue
}

// sortea el número ganador (0 a 36, cada uno con la misma chance).
function spinWheel() {
  return Math.floor(Math.random() * 37);
}

function resolveSpin(betType, betValue, stake) {
  const winningNumber = spinWheel();
  const won = isWinningBet(betType, betValue, winningNumber);
  const mult = won ? payoutMultiplier(betType) : 0;
  const payout = Math.round(stake * mult * 100) / 100;
  return { winningNumber, color: colorOf(winningNumber), won, payout };
}

module.exports = {
  WHEEL_ORDER, RED_NUMBERS, colorOf, BET_TYPES, isWinningBet, payoutMultiplier, validateBet, spinWheel, resolveSpin,
  feltNumber, feltPositionOf, areSplitNeighbors, isValidCorner,
};
