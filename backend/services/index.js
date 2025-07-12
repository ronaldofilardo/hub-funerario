// /services/index.js

const NotificationService = require('./notificationService');
const ProtocoloService = require('./protocoloService'); // Importa a CLASSE

// 1. Cria a instância do serviço de notificação
const notificationService = new NotificationService();

// 2. Cria a instância do serviço de protocolo, injetando a dependência
const protocoloService = new ProtocoloService(notificationService);

// 3. Exporta as INSTÂNCIAS prontas para uso
module.exports = {
  notificationService,
  protocoloService,
};
