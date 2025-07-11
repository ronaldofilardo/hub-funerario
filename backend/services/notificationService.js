const { getIo } = require('../socket');

class NotificationService {
  enviarParaUsuario(destinatarioId, tipoEvento, payload) {
    const io = getIo();
    if (io) {
      const roomName = `user_${destinatarioId}`;
      io.to(roomName).emit(tipoEvento, payload);
      console.log(`Notificação enviada para o canal ${roomName}: Evento='${tipoEvento}'`);
    } else {
      console.error('Socket.IO não inicializado no NotificationService.');
    }
  }

  enviarParaCanal(canal, evento, dados) {
    const io = getIo();
    if (io) {
      io.to(canal).emit(evento, dados);
      console.log(`Notificação enviada para o canal ${canal}: Evento='${evento}'`);
    } else {
      console.error('Socket.IO não inicializado no NotificationService.');
    }
  }
}

module.exports = NotificationService;
