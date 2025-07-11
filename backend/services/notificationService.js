const { getIo } = require('../socket'); // <<< IMPORTA A FUNÇÃO GETTER

class NotificationService {
  enviarParaUsuario(destinatarioId, tipoEvento, payload) {
    const io = getIo(); // <<< OBTÉM A INSTÂNCIA DO SOCKET AQUI
    
    const roomName = `user_${destinatarioId}`;
    io.to(roomName).emit(tipoEvento, payload);

    console.log(`Notificação enviada para o canal ${roomName}: Evento='${tipoEvento}'`);
  }
}

module.exports = new NotificationService();
