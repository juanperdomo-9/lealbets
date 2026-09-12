// Motor de "Tanda de penaltis": cálculo puro. El servidor decide siempre si
// se convierte o se ataja cada penal — el cliente solo pide patear/cobrar.
const OVERROUND = 1.08; // mismo margen que el resto de la casa

const DIFFICULTIES = {
  facil: 0.75,
  media: 0.59,
  dificil: 0.4,
};

// cuota justa de llegar a `round` penales convertidos seguidos, con el margen de la casa
function multiplierForRound(p, round) {
  const fair = 1 / Math.pow(p, round);
  return Math.max(1.01, Math.round((fair / OVERROUND) * 100) / 100);
}

function rollKick(p) {
  return Math.random() < p;
}

module.exports = { OVERROUND, DIFFICULTIES, multiplierForRound, rollKick };
