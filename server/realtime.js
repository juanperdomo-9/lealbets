// Guarda la instancia de socket.io para que las rutas puedan avisar a todos
// los dispositivos conectados que hay estado nuevo, sin depender de polling.
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function broadcastStateUpdate() {
  if (ioInstance) ioInstance.emit('state:update');
}

module.exports = { setIo, broadcastStateUpdate };
