// Guarda la instancia de socket.io para que las rutas puedan avisar a todos
// los dispositivos conectados que hay estado nuevo, sin depender de polling.
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function broadcastStateUpdate() {
  if (ioInstance) ioInstance.emit('state:update');
}

// la mesa de blackjack en vivo manda su estado directo (no solo un aviso de
// "refrescá"), porque cambia seguido y varios jugadores tienen que verse las
// jugadas entre sí sin el ida y vuelta extra de un GET.
function broadcastTableUpdate(tableState) {
  if (ioInstance) ioInstance.emit('table:update', tableState);
}

module.exports = { setIo, broadcastStateUpdate, broadcastTableUpdate };
