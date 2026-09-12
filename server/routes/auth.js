const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { signUserToken, signAdminToken, requireAuth, ADMIN_PASSWORD } = require('../auth');
const { STARTING_CHIPS } = require('../constants');

const router = express.Router();

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Entrar como jugador: si el usuario no existe se crea con el saldo inicial;
// si existe, hay que acertar la contraseña.
router.post('/join', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 20);
    const password = String(req.body.password || '');
    if (!name) return res.status(400).json({ error: 'Escribí un nombre de usuario' });
    if (!password) return res.status(400).json({ error: 'Escribí una contraseña' });
    if (password.length > 30) return res.status(400).json({ error: 'Contraseña demasiado larga' });

    const { rows } = await pool.query('SELECT * FROM users WHERE name=$1', [name]);
    let user = rows[0];
    if (user) {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta para ese usuario' });
    } else {
      const hash = await bcrypt.hash(password, 10);
      const { rows: inserted } = await pool.query(
        'INSERT INTO users (name, password_hash, balance, created_at) VALUES ($1,$2,$3,$4) RETURNING *',
        [name, hash, STARTING_CHIPS, Date.now()]
      );
      user = inserted[0];
    }
    const token = signUserToken(user.name);
    res.json({ token, name: user.name, balance: Number(user.balance) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT name, balance FROM users WHERE name=$1', [req.userName]);
  if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ name: rows[0].name, balance: Number(rows[0].balance) });
});

// Acceso de administrador: contraseña separada (no crea cuenta de usuario).
router.post('/admin', async (req, res) => {
  const password = String(req.body.password || '');
  if (!password || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Contraseña de admin incorrecta' });
  }
  res.json({ token: signAdminToken() });
});

module.exports = router;
