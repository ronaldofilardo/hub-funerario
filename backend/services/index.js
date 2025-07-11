const ProtocoloService = require('./protocoloService');
const NotificationService = require('./notificationService');

// Instancia o serviço que não tem dependências primeiro
const notificationService = new NotificationService();

// Agora, instancia o serviço de protocolo, injetando a dependência
const protocoloService = new ProtocoloService(notificationService);

// Exporta as instâncias prontas para uso
module.exports = {
  protocoloService,
  notificationService
};
