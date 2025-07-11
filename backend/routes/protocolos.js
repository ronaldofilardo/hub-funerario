const express = require('express');
const router = express.Router();
const pool = require('../db');
const upload = require('../multerConfig');
const notificationService = require('../services/notificationService'); // <<< 1. IMPORTAR O SERVIÇO

// =============================================================================
// CAMADA DE SERVIÇO (Lógica de Negócio e Banco de Dados)
// =============================================================================

class ProtocoloService {
  async _verificarEFinalizarProtocolo(protocoloId, client) {
    const res = await client.query(
      'SELECT status, status_documentacao, status_sepultamento FROM protocolos WHERE id = $1;',
      [protocoloId]
    );
    if (res.rows.length === 0) return;

    const { status, status_documentacao, status_sepultamento } = res.rows[0];
    if (status === 'em_execucao_paralela' && status_documentacao === 'concluido' && status_sepultamento === 'concluido') {
      await client.query(
        "UPDATE protocolos SET status = 'finalizado', data_finalizado = NOW() WHERE id = $1;",
        [protocoloId]
      );
      console.log(`Protocolo ${protocoloId} transicionado para 'finalizado'.`);
    }
  }

  async listarTodos() {
    const { rows } = await pool.query('SELECT * FROM protocolos ORDER BY data_criacao DESC;');
    return rows;
  }

  async buscarPorId(id) {
    const { rows } = await pool.query('SELECT * FROM protocolos WHERE id = $1;', [id]);
    if (rows.length === 0) {
      const error = new Error('Protocolo não encontrado.');
      error.statusCode = 404;
      throw error;
    }
    return rows[0];
  }

  async atualizarParcialmente(id, campos) {
    const chaves = Object.keys(campos);
    if (chaves.length === 0) {
      const error = new Error('Nenhum campo fornecido para atualização.');
      error.statusCode = 400;
      throw error;
    }
    const setString = chaves.map((chave, index) => `"${chave}" = $${index + 1}`).join(', ');
    const valores = Object.values(campos);
    const { rows } = await pool.query(`UPDATE protocolos SET ${setString} WHERE id = $${chaves.length + 1} RETURNING *;`, [...valores, id]);
    if (rows.length === 0) {
        const error = new Error('Protocolo não encontrado para atualização.');
        error.statusCode = 404;
        throw error;
    }
    return rows[0];
  }

  async confirmarValidacao(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
      if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
      if (res.rows[0].status !== 'aguardando_validacao') throw new Error('Transição de estado inválida.');
      
      const { rows } = await client.query(`UPDATE protocolos SET status = 'aguardando_comparecimento' WHERE id = $1 RETURNING *;`, [id]);
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async designarStakeholders(id, fun_id, cart_id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
      if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
      if (res.rows[0].status !== 'aguardando_comparecimento') throw new Error('Transição de estado inválida.');

      const { rows } = await client.query(`UPDATE protocolos SET fun_id = $1, cart_id = $2, status = 'aguardando_assinaturas_para_FAF' WHERE id = $3 RETURNING *;`, [fun_id, cart_id, id]);
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  async enviarFaf(id, fafFile) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query('SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        if (res.rows[0].status !== 'aguardando_assinaturas_para_FAF') throw new Error('Transição de estado inválida.');

        await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [id, 'faf', fafFile.path, fafFile.originalname, fafFile.mimetype, fafFile.size]);
        const { rows } = await client.query(`UPDATE protocolos SET status = 'em_execucao_paralela', status_documentacao = 'aguardando_minuta' WHERE id = $1 RETURNING *;`, [id]);
        
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  async atualizarProgressoFuneral(id, campos) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query('SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        if (res.rows[0].status !== 'em_execucao_paralela') throw new Error('Ação inválida para o estado atual.');

        const chaves = Object.keys(campos);
        const setString = chaves.map((chave, index) => `"${chave}" = $${index + 2}`).join(', ');
        const upsertQuery = `INSERT INTO progresso_funeral (protocolo_id, ${chaves.join(', ')}) VALUES ($1, ${chaves.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT (protocolo_id) DO UPDATE SET ${setString} RETURNING *;`;
        const valores = [id, ...Object.values(campos)];
        const progressoResult = await client.query(upsertQuery, valores);

        if (campos.status_sepultamento === 'realizado') {
            await client.query(`UPDATE protocolos SET status_sepultamento = 'concluido' WHERE id = $1;`, [id]);
        }

        await this._verificarEFinalizarProtocolo(id, client);
        await client.query('COMMIT');
        
        const protocoloFinal = await this.buscarPorId(id);
        return { progresso: progressoResult.rows[0], protocolo: protocoloFinal };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  async enviarMinuta(id, minutaFile) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // <<< Precisamos buscar o decl_id para saber para quem enviar a notificação
        const res = await client.query('SELECT status, status_documentacao, decl_id FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        
        const { status, status_documentacao, decl_id } = res.rows[0];
        
        if (status !== 'em_execucao_paralela' || !['nao_iniciado', 'aguardando_minuta', 'aguardando_retificacao'].includes(status_documentacao)) {
            throw new Error('Ação inválida para o estado atual.');
        }

        await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [id, 'minuta', minutaFile.path, minutaFile.originalname, minutaFile.mimetype, minutaFile.size]);
        
        const { rows } = await client.query(`UPDATE protocolos SET status_documentacao = 'aguardando_aprovacao_decl' WHERE id = $1 RETURNING *;`, [id]);
        
        await client.query('COMMIT');

        // <<< 2. CHAMAR O SERVIÇO DE NOTIFICAÇÃO APÓS O SUCESSO
        if (decl_id) {
          notificationService.enviarParaUsuario(
            decl_id, 
            'NOVA_MINUTA', // Nome do evento
            { 
              protocoloId: id,
              mensagem: `Você recebeu uma nova minuta para aprovação no protocolo ${id}.`
            }
          );
        }
        
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  // <<< INÍCIO DA ALTERAÇÃO 19.2
  async aceitarMinuta(protocoloId, usuarioLogado) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const protocoloQuery = 'SELECT status, status_documentacao, decl_id FROM protocolos WHERE id = $1 FOR UPDATE;';
        const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

        if (protocoloResult.rows.length === 0) {
            throw new Error('Protocolo não encontrado.');
        }

        const { status, status_documentacao, decl_id } = protocoloResult.rows[0];

        // GUARD DE AUTORIZAÇÃO
        if (usuarioLogado.id !== decl_id) {
            const error = new Error('Acesso negado. Apenas o declarante do protocolo pode aceitar a minuta.');
            error.statusCode = 403; // Forbidden
            throw error;
        }

        // GUARD DE ESTADO
        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_aprovacao_decl') {
            const error = new Error('Ação inválida para o estado atual do protocolo.');
            error.statusCode = 409; // Conflict
            throw error;
        }

        const { rows } = await client.query(`UPDATE protocolos SET status_documentacao = 'aguardando_emissao_certidao' WHERE id = $1 RETURNING *;`, [protocoloId]);
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  async recusarMinuta(protocoloId, observacoes, usuarioLogado) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const protocoloQuery = 'SELECT status, status_documentacao, decl_id, minuta_recusas_count FROM protocolos WHERE id = $1 FOR UPDATE;';
        const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

        if (protocoloResult.rows.length === 0) {
            throw new Error('Protocolo não encontrado.');
        }

        const { status, status_documentacao, decl_id, minuta_recusas_count } = protocoloResult.rows[0];

        // GUARD DE AUTORIZAÇÃO
        if (usuarioLogado.id !== decl_id) {
            const error = new Error('Acesso negado. Apenas o declarante do protocolo pode recusar a minuta.');
            error.statusCode = 403;
            throw error;
        }

        // GUARD DE ESTADO
        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_aprovacao_decl') {
            const error = new Error('Ação inválida para o estado atual do protocolo.');
            error.statusCode = 409;
            throw error;
        }

        // GUARD DE REGRA DE NEGÓCIO
        if (minuta_recusas_count >= 1) {
            const error = new Error('Limite de recusas da minuta atingido.');
            error.statusCode = 403;
            throw error;
        }

        const { rows } = await client.query(`UPDATE protocolos SET status_documentacao = 'aguardando_retificacao', minuta_recusas_count = minuta_recusas_count + 1 WHERE id = $1 RETURNING *;`, [protocoloId]);
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }
  // <<< FIM DA ALTERAÇÃO 19.2

  async definirPrevisaoRetirada(id, data_previsao_retirada) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query('SELECT status, status_documentacao FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        const { status, status_documentacao } = res.rows[0];
        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_emissao_certidao') throw new Error('Ação inválida para o estado atual.');

        const { rows } = await client.query(`UPDATE protocolos SET status_documentacao = 'aguardando_retirada_certidao', data_previsao_retirada = $2 WHERE id = $1 RETURNING *;`, [id, new Date(data_previsao_retirada)]);
        await client.query('COMMIT');
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  async anexarCertidaoFinal(id, certidaoFile) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await client.query('SELECT status, status_documentacao FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        const { status, status_documentacao } = res.rows[0];
        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_retirada_certidao') throw new Error('Ação inválida para o estado atual.');

        await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [id, 'certidao_final', certidaoFile.path, certidaoFile.originalname, certidaoFile.mimetype, certidaoFile.size]);
        await client.query(`UPDATE protocolos SET status_documentacao = 'concluido' WHERE id = $1;`, [id]);
        
        await this._verificarEFinalizarProtocolo(id, client);
        await client.query('COMMIT');
        
        return await this.buscarPorId(id);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }
}
const protocoloService = new ProtocoloService();

// =============================================================================
// CAMADA DE CONTROLLER (Orquestração da Requisição/Resposta)
// =============================================================================

class ProtocoloController {
  _handleError(res, error) {
    console.error(error.message);
    const statusCode = error.statusCode || 500;
    const errorMessage = statusCode === 500 ? 'Erro interno do servidor.' : error.message;
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

  // <<< INÍCIO DA ALTERAÇÃO 19.3
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
  // <<< FIM DA ALTERAÇÃO 19.3

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
const protocoloController = new ProtocoloController();

// =============================================================================
// CAMADA DE ROTAS (Definição de Endpoints)
// =============================================================================

const cpUpload = upload.fields([
    { name: 'declaracao_obito', maxCount: 1 },
    { name: 'doc_falecido', maxCount: 1 },
    { name: 'doc_declarante', maxCount: 1 }
]);

// Rota POST para CRIAR um novo protocolo (ainda não refatorada por causa do 'cpUpload')
router.post('/', cpUpload, async (req, res) => {
    // ... (manter a lógica original por enquanto)
    const {
        nome_completo_falecido, data_nascimento_falecido, nome_mae_falecido, cpf_falecido,
        criador_id, grupo_id, data_obito, data_sepultamento
      } = req.body;
      const arquivos = req.files;
    
      if (!arquivos || !arquivos.declaracao_obito) {
        return res.status(400).json({ error: 'O upload da declaração de óbito é obrigatório.' });
      }
    
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
    
        const falecidoQuery = `INSERT INTO falecidos (nome_completo, data_nascimento, nome_mae, cpf) VALUES ($1, $2, $3, $4) RETURNING id;`;
        const falecidoResult = await client.query(falecidoQuery, [nome_completo_falecido, new Date(data_nascimento_falecido), nome_mae_falecido, cpf_falecido]);
        const falecidoId = falecidoResult.rows[0].id;
    
        const protocoloQuery = `INSERT INTO protocolos (falecido_id, criador_id, grupo_id, status, data_obito, data_sepultamento) VALUES ($1, $2, $3, 'criando', $4, $5) RETURNING *;`;
        const protocoloResult = await client.query(protocoloQuery, [falecidoId, Number(criador_id), Number(grupo_id), data_obito, data_sepultamento]);
        const novoProtocolo = protocoloResult.rows[0];
    
        const docQuery = `INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`;
        for (const fieldName in arquivos) {
          const file = arquivos[fieldName][0];
          await client.query(docQuery, [novoProtocolo.id, fieldName, file.path, file.originalname, file.mimetype, file.size]);
        }
    
        await client.query('COMMIT');
        res.status(201).json({ message: "Protocolo e documentos criados com sucesso!", protocolo: novoProtocolo });
    
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao criar protocolo com documentos:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
      } finally {
        client.release();
      }
});

router.get('/', (req, res) => protocoloController.listarTodos(req, res));
router.get('/:id', (req, res) => protocoloController.buscarPorId(req, res));
router.patch('/:id', (req, res) => protocoloController.atualizarParcialmente(req, res));
router.post('/:id/confirmar-validacao', (req, res) => protocoloController.confirmarValidacao(req, res));
router.post('/:id/designar-stakeholders', (req, res) => protocoloController.designarStakeholders(req, res));
router.post('/:id/enviar-faf', upload.single('faf'), (req, res) => protocoloController.enviarFaf(req, res));
router.patch('/:id/progresso-funeral', (req, res) => protocoloController.atualizarProgressoFuneral(req, res));
router.post('/:id/enviar-minuta', upload.single('minuta'), (req, res) => protocoloController.enviarMinuta(req, res));
router.post('/:id/aceitar-minuta', (req, res) => protocoloController.aceitarMinuta(req, res));
router.post('/:id/recusar-minuta', (req, res) => protocoloController.recusarMinuta(req, res));
router.post('/:id/definir-previsao-retirada', (req, res) => protocoloController.definirPrevisaoRetirada(req, res));
router.post('/:id/anexar-certidao-final', upload.single('certidao_final'), (req, res) => protocoloController.anexarCertidaoFinal(req, res));

module.exports = router;
