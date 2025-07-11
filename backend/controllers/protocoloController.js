const protocoloService = require('../services/protocoloService');

class ProtocoloController {
  async aceitarMinuta(req, res) {
    try {
      const { id } = req.params;
      const protocoloAtualizado = await protocoloService.aceitarMinuta(id);
      
      res.status(200).json({
        message: "Minuta aceita com sucesso. Cartório notificado para prosseguir.",
        protocolo: protocoloAtualizado
      });

    } catch (error) {
      // Trata os erros lançados pelo serviço
      console.error(`Erro ao aceitar minuta:`, error);
      if (error.message.includes('não encontrado') || error.message.includes('Ação inválida')) {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Erro interno do servidor.' });
      }
    }
  }

  // ... (outros handlers do controller)
}

module.exports = new ProtocoloController();
