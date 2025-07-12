// services/protocoloService.js

const db = require('../db');

class ProtocoloService {
  constructor(notificationService) {
    this.notificationService = notificationService;
  }

  // ===================================================================================
  // MOTOR DE WORKFLOW CENTRALIZADO
  // ===================================================================================
  async transitarEstado(protocoloId, acao, usuarioLogado, dados = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const res = await client.query('SELECT * FROM protocolos WHERE id = $1 FOR UPDATE;', [protocoloId]);
      if (res.rows.length === 0) {
        throw { statusCode: 404, message: 'Protocolo não encontrado.' };
      }
      const protocolo = res.rows[0];

      let queryUpdate;
      let valoresUpdate;
      let proximoEstado;

      switch (acao) {
        case 'CONFIRMAR_VALIDACAO':
          if (usuarioLogado.role !== 'Triagem') throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode confirmar a validação.' };
          if (protocolo.status !== 'aguardando_validacao') throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_validacao', mas está em '${protocolo.status}'.` };
          
          proximoEstado = 'aguardando_comparecimento';
          queryUpdate = "UPDATE protocolos SET status = $1 WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;

        case 'DESIGNAR_STAKEHOLDERS':
          if (usuarioLogado.role !== 'Triagem') throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode designar stakeholders.' };
          if (protocolo.status !== 'aguardando_comparecimento') throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_comparecimento', mas está em '${protocolo.status}'.` };
          if (!dados.fun_id || !dados.cart_id) throw { statusCode: 400, message: 'Os IDs da funerária (fun_id) e do cartório (cart_id) são obrigatórios.' };
          
          proximoEstado = 'aguardando_assinaturas_para_FAF';
          queryUpdate = "UPDATE protocolos SET fun_id = $1, cart_id = $2, status = $3 WHERE id = $4 RETURNING *;";
          valoresUpdate = [dados.fun_id, dados.cart_id, proximoEstado, protocoloId];
          break;

        case 'ENVIAR_FAF':
          if (usuarioLogado.role !== 'Triagem') throw { statusCode: 403, message: 'Acesso negado. Apenas a Triagem pode enviar a FAF.' };
          if (protocolo.status !== 'aguardando_assinaturas_para_FAF') throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'aguardando_assinaturas_para_FAF', mas está em '${protocolo.status}'.` };
          if (!dados.fafFile) throw { statusCode: 400, message: 'O arquivo da FAF é obrigatório.' };
          
          await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [protocoloId, 'faf', dados.fafFile.path, dados.fafFile.originalname, dados.fafFile.mimetype, dados.fafFile.size]);
          
          proximoEstado = 'em_execucao_paralela';
          queryUpdate = "UPDATE protocolos SET status = $1, status_documentacao = 'aguardando_minuta', status_sepultamento = 'em_andamento' WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;

        case 'ATUALIZAR_PROGRESSO_FUNERAL':
          if (usuarioLogado.role !== 'FUN') throw { statusCode: 403, message: 'Acesso negado. Apenas funerárias podem atualizar o progresso.' };
          if (usuarioLogado.id !== protocolo.fun_id) throw { statusCode: 403, message: 'Acesso negado. Você não é a funerária designada para este protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela') throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'em_execucao_paralela', mas está em '${protocolo.status}'.` };
          
          const chaves = Object.keys(dados.campos);
          if (chaves.length === 0) throw { statusCode: 400, message: 'Nenhum campo fornecido para atualização.' };

          const setString = chaves.map((chave, index) => `"${chave}" = $${index + 2}`).join(', ');
          const upsertQuery = `INSERT INTO progresso_funeral (protocolo_id, ${chaves.join(', ')}) VALUES ($1, ${chaves.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT (protocolo_id) DO UPDATE SET ${setString} RETURNING *;`;
          const valoresUpsert = [protocoloId, ...Object.values(dados.campos)];
          const progressoResult = await client.query(upsertQuery, valoresUpsert);

          if (dados.campos.status_sepultamento === 'realizado') {
            await client.query("UPDATE protocolos SET status_sepultamento = 'concluido' WHERE id = $1;", [protocoloId]);
          }
          
          await this._verificarEFinalizarProtocolo(protocoloId, client);
          
          await client.query('COMMIT');
          const protocoloFinal = await this.buscarPorId(protocoloId);
          return { progresso: progressoResult.rows[0], protocolo: protocoloFinal };

        case 'ENVIAR_MINUTA':
          if (usuarioLogado.role !== 'CART') throw { statusCode: 403, message: 'Acesso negado. Apenas o Cartório pode enviar a minuta.' };
          if (usuarioLogado.id !== protocolo.cart_id) throw { statusCode: 403, message: 'Acesso negado. Você não é o cartório designado para este protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela') throw { statusCode: 409, message: `Ação inválida. O protocolo precisa estar no estado 'em_execucao_paralela'.` };
          if (!['aguardando_minuta', 'aguardando_retificacao'].includes(protocolo.status_documentacao)) throw { statusCode: 409, message: `Ação inválida. O sub-fluxo de documentação precisa estar em 'aguardando_minuta' ou 'aguardando_retificacao', mas está em '${protocolo.status_documentacao}'.` };
          if (!dados.minutaFile) throw { statusCode: 400, message: 'O arquivo da minuta é obrigatório.' };

          await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [protocoloId, 'minuta', dados.minutaFile.path, dados.minutaFile.originalname, dados.minutaFile.mimetype, dados.minutaFile.size]);
          
          proximoEstado = 'aguardando_aprovacao_decl';
          queryUpdate = "UPDATE protocolos SET status_documentacao = $1 WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;

        case 'ACEITAR_MINUTA':
          if (usuarioLogado.role !== 'DECL') throw { statusCode: 403, message: 'Acesso negado. Apenas o Declarante pode aceitar a minuta.' };
          if (usuarioLogado.id !== protocolo.decl_id) throw { statusCode: 403, message: 'Acesso negado. Você não é o declarante deste protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela' || protocolo.status_documentacao !== 'aguardando_aprovacao_decl') throw { statusCode: 409, message: `Ação inválida. O sub-fluxo de documentação precisa estar em 'aguardando_aprovacao_decl'.` };

          proximoEstado = 'aguardando_emissao_certidao';
          queryUpdate = "UPDATE protocolos SET status_documentacao = $1 WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;

        case 'RECUSAR_MINUTA':
          if (usuarioLogado.role !== 'DECL') throw { statusCode: 403, message: 'Acesso negado. Apenas o Declarante pode recusar a minuta.' };
          if (usuarioLogado.id !== protocolo.decl_id) throw { statusCode: 403, message: 'Acesso negado. Você não é o declarante deste protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela' || protocolo.status_documentacao !== 'aguardando_aprovacao_decl') throw { statusCode: 409, message: `Ação inválida. O sub-fluxo de documentação precisa estar em 'aguardando_aprovacao_decl'.` };
          if (protocolo.minuta_recusas_count >= 1) throw { statusCode: 403, message: 'Limite de uma recusa por protocolo já foi atingido.' };
          if (!dados.observacoes || dados.observacoes.trim() === '') throw { statusCode: 400, message: 'As observações para a recusa são obrigatórias.' };

          proximoEstado = 'aguardando_retificacao';
          queryUpdate = "UPDATE protocolos SET status_documentacao = $1, minuta_recusas_count = minuta_recusas_count + 1 WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;

        default:
          throw { statusCode: 400, message: `Ação desconhecida: ${acao}` };
      }

      const { rows } = await client.query(queryUpdate, valoresUpdate);
      await this._verificarEFinalizarProtocolo(protocoloId, client);
      await client.query('COMMIT');

      const statusFinal = rows[0].status;
      const subDoc = rows[0].status_documentacao;
      const subSep = rows[0].status_sepultamento;
      console.log(`Protocolo ${protocoloId} transicionado. Estado Global: '${statusFinal}', Sepultamento: '${subSep}', Documentação: '${subDoc}' (Ação: '${acao}')`);
      
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
    const res = await client.query('SELECT status, status_documentacao, status_sepultamento FROM protocolos WHERE id = $1;', [protocoloId]);
    if (res.rows.length === 0) return;
    const { status, status_documentacao, status_sepultamento } = res.rows[0];
    if (status === 'em_execucao_paralela' && status_documentacao === 'concluido' && status_sepultamento === 'concluido') {
      await client.query("UPDATE protocolos SET status = 'finalizado', data_finalizado = NOW() WHERE id = $1;", [protocoloId]);
      console.log(`Protocolo ${protocoloId} transicionado para 'finalizado'.`);
    }
  }

  // --- MÉTODOS PÚBLICOS ---
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
    const client = await db.getClient();
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
      this.notificationService.enviarParaCanal(canalTriagem, 'NOVO_PROTOCOLO_VALIDACAO', { protocoloId: novoProtocolo.id, mensagem: `Novo protocolo #${novoProtocolo.id.substring(0,8)} aguardando sua validação.` });
      if (novoProtocolo.decl_id) {
        this.notificationService.enviarParaUsuario(novoProtocolo.decl_id, 'PROTOCOLO_CRIADO_INFO', { protocoloId: novoProtocolo.id, mensagem: `Um protocolo foi criado para você. Acompanhe o andamento.` });
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
  async listarTodos() { const { rows } = await db.query('SELECT * FROM protocolos ORDER BY data_criacao DESC;'); return rows; }
  async buscarPorId(id) { const { rows } = await db.query('SELECT * FROM protocolos WHERE id = $1;', [id]); if (rows.length === 0) { const error = new Error('Protocolo não encontrado.'); error.statusCode = 404; throw error; } return rows[0]; }
  async atualizarParcialmente(id, campos) { const chaves = Object.keys(campos); if (chaves.length === 0) { const error = new Error('Nenhum campo fornecido para atualização.'); error.statusCode = 400; throw error; } const setString = chaves.map((chave, index) => `"${chave}" = $${index + 1}`).join(', '); const valores = Object.values(campos); const { rows } = await db.query(`UPDATE protocolos SET ${setString} WHERE id = $${chaves.length + 1} RETURNING *;`, [...valores, id]); if (rows.length === 0) { const error = new Error('Protocolo não encontrado para atualização.'); error.statusCode = 404; throw error; } return rows[0]; }
  async confirmarValidacao(protocoloId, usuarioLogado) { return this.transitarEstado(protocoloId, 'CONFIRMAR_VALIDACAO', usuarioLogado); }
  async designarStakeholders(protocoloId, fun_id, cart_id, usuarioLogado) { const dados = { fun_id, cart_id }; return this.transitarEstado(protocoloId, 'DESIGNAR_STAKEHOLDERS', usuarioLogado, dados); }
  async enviarFaf(protocoloId, fafFile, usuarioLogado) { const dados = { fafFile }; return this.transitarEstado(protocoloId, 'ENVIAR_FAF', usuarioLogado, dados); }
  async atualizarProgressoFuneral(protocoloId, campos, usuarioLogado) { const dados = { campos }; return this.transitarEstado(protocoloId, 'ATUALIZAR_PROGRESSO_FUNERAL', usuarioLogado, dados); }
  async enviarMinuta(protocoloId, minutaFile, usuarioLogado) { const dados = { minutaFile }; return this.transitarEstado(protocoloId, 'ENVIAR_MINUTA', usuarioLogado, dados); }
  async aceitarMinuta(protocoloId, usuarioLogado) { return this.transitarEstado(protocoloId, 'ACEITAR_MINUTA', usuarioLogado); }
  async recusarMinuta(protocoloId, observacoes, usuarioLogado) { const dados = { observacoes }; return this.transitarEstado(protocoloId, 'RECUSAR_MINUTA', usuarioLogado, dados); }
  async definirPrevisaoRetirada(id, data_previsao_retirada) { /* ...código original... */ }
  async anexarCertidaoFinal(id, certidaoFile) { /* ...código original... */ }
}

module.exports = ProtocoloService;
