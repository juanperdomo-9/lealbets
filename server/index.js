require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const { initSchema, seedIfEmpty } = require('./db');
const { syncLealProps } = require('./state');
const { setIo } = require('./realtime');

const authRoutes = require('./routes/auth');
const stateRoutes = require('./routes/state');
const betsRoutes = require('./routes/bets');
const adminRoutes = require('./routes/admin');
const blackjackRoutes = require('./routes/blackjack');

const PORT = process.env.PORT || 3000;

async function main() {
  await initSchema();
  await seedIfEmpty();
  await syncLealProps();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/state', stateRoutes);
  app.use('/api/bets', betsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/blackjack', blackjackRoutes);

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  setIo(io);

  server.listen(PORT, () => {
    console.log(`Leal Bets escuchando en el puerto ${PORT}`);
  });
}

main().catch((e) => {
  console.error('No se pudo iniciar el servidor:', e);
  process.exit(1);
});
