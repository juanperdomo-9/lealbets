// Mesa de Blackjack en vivo: acciones sobre el único estado compartido de
// server/liveBlackjack.js. El estado en sí viaja por socket (evento
// "table:update", ver server/realtime.js) cada vez que cambia algo — estas
// rutas solo devuelven "ok" o el error, el socket es la fuente de verdad
// para todos los que están mirando la mesa.
const express = require('express');
const { requireAuth } = require('../auth');
const table = require('../liveBlackjack');

const router = express.Router();

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
      res.json({ ok: true });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Error del servidor' });
    }
  };
}

router.get('/state', requireAuth, (req, res) => {
  res.json(table.publicState());
});
router.post('/sit', requireAuth, handle(async (req) => { table.sitDown(req.userName); }));
router.post('/stand-up', requireAuth, handle(async (req) => { await table.standUp(req.userName); }));
router.post('/bet', requireAuth, handle(async (req) => { await table.placeBet(req.userName, Number(req.body.amount)); }));
router.post('/hit', requireAuth, handle(async (req) => { await table.hit(req.userName); }));
router.post('/stand', requireAuth, handle(async (req) => { await table.stand(req.userName); }));
router.post('/double', requireAuth, handle(async (req) => { await table.doubleDown(req.userName); }));

module.exports = router;
