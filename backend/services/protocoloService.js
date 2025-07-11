const pool = require('../db');

class ProtocoloService {
  // O construtor recebe as dependências necessárias
  constructor(notificationService) {
    this.notificationService = notificationService;
  }

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
  
  async criarProtocolo(dados, arquivos) {
    const {
      nome_completo_falecido, data_nascimento_falecido, nome_mae_falecido, cpf_falecido,
      criador_id, grupo_id, data_obito, data_sepultamento, decl_id
    } = dados;

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

      // Dispara as notificações
      this.notificationService.enviarParaUsuario(
        novoProtocolo.grupo_id,
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
        const res = await client.query('SELECT status, status_documentacao, decl_id FROM protocolos WHERE id = $1 FOR UPDATE;', [id]);
        if (res.rows.length === 0) throw new Error('Protocolo não encontrado.');
        
        const { status, status_documentacao, decl_id } = res.rows[0];
        if (status !== 'em_execucao_paralela' || !['nao_iniciado', 'aguardando_minuta', 'aguardando_retificacao'].includes(status_documentacao)) {
            throw new Error('Ação inválida para o estado atual.');
        }

        await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [id, 'minuta', minutaFile.path, minutaFile.originalname, minutaFile.mimetype, minutaFile.size]);
        const { rows } = await client.query(`UPDATE protocolos SET status_documentacao = 'aguardando_aprovacao_decl' WHERE id = $1 RETURNING *;`, [id]);
        
        await client.query('COMMIT');

        if (decl_id) {
          this.notificationService.enviarParaUsuario(decl_id, 'NOVA_MINUTA', { 
            protocoloId: id,
            mensagem: `Você recebeu uma nova minuta para aprovação no protocolo ${id}.`
          });
        }
        
        return rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  }

  async aceitarMinuta(protocoloId, usuarioLogado) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const protocoloQuery = 'SELECT status, status_documentacao, decl_id FROM protocolos WHERE id = $1 FOR UPDATE;';
        const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

        if (protocoloResult.rows.length === 0) throw new Error('Protocolo não encontrado.');
        
        const { status, status_documentacao, decl_id } = protocoloResult.rows[0];

        if (usuarioLogado.id !== decl_id) {
            const error = new Error('Acesso negado. Apenas o declarante do protocolo pode aceitar a minuta.');
            error.statusCode = 403;
            throw error;
        }

        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_aprovacao_decl') {
            const error = new Error('Ação inválida para o estado atual do protocolo.');
            error.statusCode = 409;
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

        if (protocoloResult.rows.length === 0) throw new Error('Protocolo não encontrado.');
        
        const { status, status_documentacao, decl_id, minuta_recusas_count } = protocoloResult.rows[0];

        if (usuarioLogado.id !== decl_id) {
            const error = new Error('Acesso negado. Apenas o declarante do protocolo pode recusar a minuta.');
            error.statusCode = 403;
            throw error;
        }

        if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_aprovacao_decl') {
            const error = new Error('Ação inválida para o estado atual do protocolo.');
            error.statusCode = 409;
            throw error;
        }

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
} // <<< ESTA CHAVE ESTAVA FALTANDO

module.exports = ProtocoloService;
