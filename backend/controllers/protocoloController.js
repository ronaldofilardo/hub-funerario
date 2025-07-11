const { protocoloService } = require('../services'); // Importa a instância do service

class ProtocoloController {
  _handleError(res, error) {
    console.error(`Erro no controller: ${error.message}`);
    const statusCode = error.statusCode || 500;
    const errorMessage = statusCode < 500 ? error.message : 'Erro interno do servidor.';
    res.status(statusCode).json({ error: errorMessage });
  }

  async listarTodos(req, res) {
    try {
      const protocolos = await protocoloService.listarTodos();
      res.status(200).json(protocolos);
    } catch (error) {
      this._handleError(res, error);
    }
  }

  async buscarPorId(req, res) {
    try {
      const protocolo = await protocoloService.buscarPorId(req.params.id);
      res.status(200).json(protocolo);
    } catch (error) {
      this._handleError(res, error);
    }
  }

  async atualizarParcialmente(req, res) {
    try {
        const protocolo = await protocoloService.atualizarParcialmente(req.params.id, req.body);
        res.status(200).json(protocolo);
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async confirmarValidacao(req, res) {
    try {
        const protocolo = await protocoloService.confirmarValidacao(req.params.id);
        res.status(200).json(protocolo);
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async designarStakeholders(req, res) {
    try {
        const { fun_id, cart_id } = req.body;
        if (!fun_id || !cart_id) return res.status(400).json({ error: 'Os IDs da funerária (fun_id) e do cartório (cart_id) são obrigatórios.' });
        const protocolo = await protocoloService.designarStakeholders(req.params.id, fun_id, cart_id);
        res.status(200).json(protocolo);
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async enviarFaf(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'O arquivo da FAF é obrigatório.' });
        const protocolo = await protocoloService.enviarFaf(req.params.id, req.file);
        res.status(200).json({ message: "FAF enviada com sucesso e protocolo atualizado.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async atualizarProgressoFuneral(req, res) {
    try {
        if (Object.keys(req.body).length === 0) return res.status(400).json({ error: 'Nenhum campo fornecido para atualização.' });
        const resultado = await protocoloService.atualizarProgressoFuneral(req.params.id, req.body);
        res.status(200).json({ message: "Progresso do funeral atualizado com sucesso.", ...resultado });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async enviarMinuta(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'O arquivo da minuta é obrigatório.' });
        const protocolo = await protocoloService.enviarMinuta(req.params.id, req.file);
        res.status(200).json({ message: "Minuta enviada com sucesso para aprovação do declarante.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async aceitarMinuta(req, res) {
    try {
        const protocolo = await protocoloService.aceitarMinuta(req.params.id, req.user);
        res.status(200).json({ message: "Minuta aceita com sucesso. Cartório notificado para prosseguir.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async recusarMinuta(req, res) {
    try {
        const { observacoes } = req.body;
        if (!observacoes || observacoes.trim() === '') return res.status(400).json({ error: 'As observações para a recusa são obrigatórias.' });
        const protocolo = await protocoloService.recusarMinuta(req.params.id, observacoes, req.user);
        res.status(200).json({ message: "Minuta recusada com sucesso. Cartório notificado para realizar as correções.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async definirPrevisaoRetirada(req, res) {
    try {
        const { data_previsao_retirada } = req.body;
        if (!data_previsao_retirada || isNaN(new Date(data_previsao_retirada).getTime())) return res.status(400).json({ error: 'O campo data_previsao_retirada é obrigatório e deve ser uma data válida.' });
        const protocolo = await protocoloService.definirPrevisaoRetirada(req.params.id, data_previsao_retirada);
        res.status(200).json({ message: "Previsão de retirada da certidão definida com sucesso. Declarante notificado.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }

  async anexarCertidaoFinal(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'O arquivo da certidão final é obrigatório.' });
        const protocolo = await protocoloService.anexarCertidaoFinal(req.params.id, req.file);
        res.status(200).json({ message: "Certidão final anexada com sucesso. Fluxo de documentação concluído.", protocolo });
    } catch (error) {
        this._handleError(res, error);
    }
  }
}

module.exports = new ProtocoloController();
