const { Server } = require("socket.io");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on('connection', (socket) => {
    console.log(`Usuário conectado com ID do socket: ${socket.id}`);

    socket.on('join_room', (userId) => {
      const roomName = `user_${userId}`;
      socket.join(roomName);
      console.log(`Socket ${socket.id} entrou no canal: ${roomName}`);
    });

    socket.on('disconnect', () => {
      console.log(`Usuário desconectado: ${socket.id}`);
    });
  });

  console.log("Socket.IO inicializado com sucesso.");
  return io;
}

function getIo() {
  if (!io) {
    throw new Error("Socket.IO não foi inicializado!");
  }
  return io;
}

module.exports = { initSocket, getIo };
