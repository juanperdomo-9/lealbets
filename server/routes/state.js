const express = require('express');
const { getPublicState } = require('../state');

const router = express.Router();

// Estado público del tablero: equipos, partidos (con cuotas) y ranking.
// No incluye contraseñas ni nada sensible.
router.get('/', async (req, res) => {
  try {
    const state = await getPublicState();
    res.json(state);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
