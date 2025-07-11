const pool = require('../db');

class ProtocoloService {
  constructor(notificationService) {
    this.notificationService = notificationService;
  }

  // ===================================================================================
  // NOVO MOTOR DE WORKFLOW CENTRALIZADO
  // ===================================================================================
  async transitarEstado(protocoloId, acao, usuarioLogado, dados = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query('SELECT * FROM protocolos WHERE id = $1 FOR UPDATE;', [protocoloId]);
      if (res.rows.length === 0) {
        throw { statusCode: 404, message: 'Protocolo não encontrado.' };
      }
      const protocolo = res.rows[0];

      let queryUpdate;
      let valoresUpdate;

      // O CORAÇÃO DO MOTOR DE WORKFLOW
      switch (acao) {
        case 'CONFIRMAR_VALIDACAO':
          // Guard de Permissão
          if (usuarioLogado.role !== 'Triagem') {
            throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode confirmar a validação.' };
          }
          // Guard de Estado
          if (protocolo.status !== 'aguardando_validacao') {
            throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_validacao', mas está em '${protocolo.status}'.` };
          }
          // Lógica da Transição
          queryUpdate = "UPDATE protocolos SET status = 'aguardando_comparecimento' WHERE id = $1 RETURNING *;";
          valoresUpdate = [protocoloId];
          break;

        case 'DESIGNAR_STAKEHOLDERS':
          // Guard de Permissão
          if (usuarioLogado.role !== 'Triagem') {
            throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode designar stakeholders.' };
          }
          // Guard de Estado
          if (protocolo.status !== 'aguardando_comparecimento') {
            throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_comparecimento', mas está em '${protocolo.status}'.` };
          }
          // Guard de Dados
          if (!dados.fun_id || !dados.cart_id) {
            throw { statusCode: 400, message: 'Os IDs da funerária (fun_id) e do cartório (cart_id) são obrigatórios.' };
          }
          // Lógica da Transição
          queryUpdate = "UPDATE protocolos SET fun_id = $1, cart_id = $2, status = 'aguardando_assinaturas_para_FAF' WHERE id = $3 RETURNING *;";
          valoresUpdate = [dados.fun_id, dados.cart_id, protocoloId];
          break;

        case 'ENVIAR_FAF':
          // Guard de Permissão
          if (usuarioLogado.role !== 'Triagem') {
            throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode enviar a FAF.' };
          }
          // Guard de Estado
          if (protocolo.status !== 'aguardando_assinaturas_para_FAF') {
            throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_assinaturas_para_FAF', mas está em '${protocolo.status}'.` };
          }
          // Guard de Dados
          if (!dados.fafFile) {
            throw { statusCode: 400, message: 'O arquivo da FAF é obrigatório.' };
          }
          // Lógica da Transição (em duas etapas)
          await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [protocoloId, 'faf', dados.fafFile.path, dados.fafFile.originalname, dados.fafFile.mimetype, dados.fafFile.size]);
          queryUpdate = "UPDATE protocolos SET status = 'em_execucao_paralela', status_documentacao = 'aguardando_minuta', status_sepultamento = 'em_andamento' WHERE id = $1 RETURNING *;";
          valoresUpdate = [protocoloId];
          break;

        case 'ATUALIZAR_PROGRESSO_FUNERAL':
          // Guard de Permissão
          if (usuarioLogado.role !== 'FUN') {
            throw { statusCode: 403, message: 'Acesso negado. Apenas funerárias podem atualizar o progresso.' };
          }
          if (usuarioLogado.id !== protocolo.fun_id) {
            throw { statusCode: 403, message: 'Acesso negado. Você não é a funerária designada para este protocolo.' };
          }
          // Guard de Estado
          if (protocolo.status !== 'em_execucao_paralela') {
            throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'em_execucao_paralela', mas está em '${protocolo.status}'.` };
          }
          // Lógica da Transição (em várias etapas)
          const chaves = Object.keys(dados.campos);
          const setString = chaves.map((chave, index) => `"${chave}" = $${index + 2}`).join(', ');
          const upsertQuery = `INSERT INTO progresso_funeral (protocolo_id, ${chaves.join(', ')}) VALUES ($1, ${chaves.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT (protocolo_id) DO UPDATE SET ${setString} RETURNING *;`;
          const valoresUpsert = [protocoloId, ...Object.values(dados.campos)];
          const progressoResult = await client.query(upsertQuery, valoresUpsert);

          if (dados.campos.status_sepultamento === 'realizado') {
            await client.query("UPDATE protocolos SET status_sepultamento = 'concluido' WHERE id = $1;", [protocoloId]);
          }
          
          // Finaliza a transação e retorna um objeto composto
          await client.query('COMMIT');
          const protocoloFinal = await this.buscarPorId(protocoloId); // Busca o estado mais recente
          return { progresso: progressoResult.rows[0], protocolo: protocoloFinal };


        default:
          throw { statusCode: 400, message: `Ação desconhecida: ${acao}` };
      }

      const { rows } = await client.query(queryUpdate, valoresUpdate);
      await this._verificarEFinalizarProtocolo(protocoloId, client);
      await client.query('COMMIT');

      console.log(`Protocolo ${protocoloId} transicionado de '${protocolo.status}' para '${rows[0].status}' pela ação '${acao}'`);
      
      return rows[0];

    } catch (error) {
      await client.query('ROLLBACK');
      if (error.statusCode) throw error;
      console.error('Erro em transitarEstado:', error);
      throw { statusCode: 500, message: 'Erro interno ao transitar estado do protocolo.' };
    } finally {
      client.release();
    }
  }

  async _verificarEFinalizarProtocolo(protocoloId, client) {
    const res = await client.query(
      'SELECT status, status_documentacao, status_sepultamento FROM protocolos WHERE id = $1;',
      [protocoloId]
    );
    if (res.rows.length === 0) return;

    const { status, status_documentacao, status_sepultamento } = res.rows[0];
    if (status === 'em_execucao_paralela' && status_documentacao === 'concluido' && status_sepultamento === 'concluido') {
      // Usamos o client da transação principal para garantir a atomicidade
      await client.query(
        "UPDATE protocolos SET status = 'finalizado', data_finalizado = NOW() WHERE id = $1;",
        [protocoloId]
      );
      console.log(`Protocolo ${protocoloId} transicionado para 'finalizado'.`);
    }
  }

  // ===================================================================================
  // MÉTODOS ANTIGOS (AGORA REFATORADOS PARA USAR O MOTOR)
  // ===================================================================================

  async criarProtocolo(dados, arquivos, usuarioLogado) {
    const {
      nome_completo_falecido, data_nascimento_falecido, nome_mae_falecido, cpf_falecido,
      grupo_id, data_obito, data_sepultamento, decl_id
    } = dados;
    
    const criador_id = usuarioLogado.id;

    if (!arquivos || !arquivos.declaracao_obito) {
      const error = new Error('O upload da declaração de óbito é obrigatório.');
      error.statusCode = 400;
      throw error;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const falecidoQuery = `INSERT INTO falecidos (nome_completo, data_nascimento, nome_mae, cpf) VALUES ($1, $2, $3, $4) RETURNING id;`;
      const falecidoResult = await client.query(falecidoQuery, [nome_completo_falecido, new Date(data_nascimento_falecido), nome_mae_falecido, cpf_falecido]);
      const falecidoId = falecidoResult.rows[0].id;

      const protocoloQuery = `
        INSERT INTO protocolos (falecido_id, criador_id, grupo_id, status, data_obito, data_sepultamento, decl_id) 
        VALUES ($1, $2, $3, 'aguardando_validacao', $4, $5, $6) RETURNING *;
      `;
      const protocoloResult = await client.query(protocoloQuery, [falecidoId, Number(criador_id), Number(grupo_id), data_obito, data_sepultamento, Number(decl_id)]);
      const novoProtocolo = protocoloResult.rows[0];

      const docQuery = `INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`;
      for (const fieldName in arquivos) {
        const file = arquivos[fieldName][0];
        await client.query(docQuery, [novoProtocolo.id, fieldName, file.path, file.originalname, file.mimetype, file.size]);
      }

      await client.query('COMMIT');

      const canalTriagem = `grupo_${novoProtocolo.grupo_id}`;
      this.notificationService.enviarParaCanal(
        canalTriagem,
        'NOVO_PROTOCOLO_VALIDACAO',
        { protocoloId: novoProtocolo.id, mensagem: `Novo protocolo #${novoProtocolo.id.substring(0,8)} aguardando sua validação.` }
      );

      if (novoProtocolo.decl_id) {
        this.notificationService.enviarParaUsuario(
          novoProtocolo.decl_id,
          'PROTOCOLO_CRIADO_INFO',
          { protocoloId: novoProtocolo.id, mensagem: `Um protocolo foi criado para você. Acompanhe o andamento.` }
        );
      }

      return novoProtocolo;

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erro ao criar protocolo com documentos:', error);
      throw error;
    } finally {
      client.release();
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
    // Este método é perigoso sem guards. Deveria ser refatorado ou removido.
    // Por enquanto, mantemos como está.
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

  async confirmarValidacao(protocoloId, usuarioLogado) {
    return this.transitarEstado(protocoloId, 'CONFIRMAR_VALIDACAO', usuarioLogado);
  }

  async designarStakeholders(protocoloId, fun_id, cart_id, usuarioLogado) {
    const dados = { fun_id, cart_id };
    return this.transitarEstado(protocoloId, 'DESIGNAR_STAKEHOLDERS', usuarioLogado, dados);
  }
  
  async enviarFaf(protocoloId, fafFile, usuarioLogado) {
    const dados = { fafFile };
    return this.transitarEstado(protocoloId, 'ENVIAR_FAF', usuarioLogado, dados);
  }

  async atualizarProgressoFuneral(protocoloId, campos, usuarioLogado) {
    const dados = { campos };
    return this.transitarEstado(protocoloId, 'ATUALIZAR_PROGRESSO_FUNERAL', usuarioLogado, dados);
  }

  // ... Manter os métodos restantes (enviarMinuta, aceitarMinuta, etc.) como estão por agora.
  // Eles serão refatorados nos próximos passos para usar o motor de transição.
  
  async enviarMinuta(id, minutaFile) {
    // ... código original ...
  }

  async aceitarMinuta(protocoloId, usuarioLogado) {
    // ... código original ...
  }

  async recusarMinuta(protocoloId, observacoes, usuarioLogado) {
    // ... código original ...
  }

  async definirPrevisaoRetirada(id, data_previsao_retirada) {
    // ... código original ...
  }

  async anexarCertidaoFinal(id, certidaoFile) {
    // ... código original ...
  }
}

module.exports = ProtocoloService;
