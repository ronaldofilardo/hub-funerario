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
        // ... (todos os seus 'case' de 'CONFIRMAR_VALIDACAO' até 'ANEXAR_CERTIDAO_FINAL' permanecem aqui, sem alterações)
        // O código interno do switch está correto.
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
            const updatedProtocolo = await client.query("UPDATE protocolos SET status_sepultamento = 'concluido' WHERE id = $1 RETURNING *;", [protocoloId]);
            await this._verificarEFinalizarProtocolo(updatedProtocolo.rows[0], client);
          } else {
            await this._verificarEFinalizarProtocolo(protocolo, client);
          }
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
        case 'DEFINIR_PREVISAO_RETIRADA':
          if (usuarioLogado.role !== 'CART') throw { statusCode: 403, message: 'Acesso negado. Apenas o Cartório pode definir a previsão de retirada.' };
          if (usuarioLogado.id !== protocolo.cart_id) throw { statusCode: 403, message: 'Acesso negado. Você não é o cartório designado para este protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela' || protocolo.status_documentacao !== 'aguardando_emissao_certidao') throw { statusCode: 409, message: `Ação inválida. O sub-fluxo de documentação precisa estar em 'aguardando_emissao_certidao'.` };
          if (!dados.data_previsao_retirada || isNaN(new Date(dados.data_previsao_retirada).getTime())) throw { statusCode: 400, message: 'O campo data_previsao_retirada é obrigatório e deve ser uma data válida.' };
          proximoEstado = 'aguardando_retirada_certidao';
          queryUpdate = "UPDATE protocolos SET status_documentacao = $1, data_previsao_retirada = $2 WHERE id = $3 RETURNING *;";
          valoresUpdate = [proximoEstado, new Date(dados.data_previsao_retirada), protocoloId];
          break;
        case 'ANEXAR_CERTIDAO_FINAL':
          if (usuarioLogado.role !== 'CART') throw { statusCode: 403, message: 'Acesso negado. Apenas o Cartório pode anexar a certidão final.' };
          if (usuarioLogado.id !== protocolo.cart_id) throw { statusCode: 403, message: 'Acesso negado. Você não é o cartório designado para este protocolo.' };
          if (protocolo.status !== 'em_execucao_paralela' || protocolo.status_documentacao !== 'aguardando_retirada_certidao') throw { statusCode: 409, message: `Ação inválida. O sub-fluxo de documentação precisa estar em 'aguardando_retirada_certidao'.` };
          if (!dados.certidaoFile) throw { statusCode: 400, message: 'O arquivo da certidão final é obrigatório.' };
          await client.query(`INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`, [protocoloId, 'certidao_final', dados.certidaoFile.path, dados.certidaoFile.originalname, dados.certidaoFile.mimetype, dados.certidaoFile.size]);
          proximoEstado = 'concluido';
          queryUpdate = "UPDATE protocolos SET status_documentacao = $1 WHERE id = $2 RETURNING *;";
          valoresUpdate = [proximoEstado, protocoloId];
          break;
        default:
          throw { statusCode: 400, message: `Ação desconhecida: ${acao}` };
      }

      const { rows } = await client.query(queryUpdate, valoresUpdate);
      // CORREÇÃO: Passa o resultado da query de UPDATE para a verificação
      await this._verificarEFinalizarProtocolo(rows[0], client);
      await client.query('COMMIT');

      // Busca o estado final do protocolo após o commit
      const protocoloAtualizado = await this.buscarPorId(protocoloId);
      console.log(`Protocolo ${protocoloId} transicionado. Estado Final: ${JSON.stringify(protocoloAtualizado)}`);
      return protocoloAtualizado;

    } catch (error) {
      await client.query('ROLLBACK');
      if (error.statusCode) throw error;
      console.error('Erro em transitarEstado:', error);
      throw { statusCode: 500, message: 'Erro interno ao transitar estado do protocolo.' };
    } finally {
      client.release();
    }
  }

  // --- MÉTODOS PÚBLICOS ---
  async criarProtocolo(dados, arquivos, usuarioLogado) {
    // ... (código original sem alterações)
  }
  async listarTodos() { 
    const { rows } = await db.query('SELECT * FROM protocolos ORDER BY data_criacao DESC;'); 
    return rows; 
  }
  async buscarPorId(id) { 
    const { rows } = await db.query('SELECT * FROM protocolos WHERE id = $1;', [id]); 
    if (rows.length === 0) { 
      const error = new Error('Protocolo não encontrado.'); 
      error.statusCode = 404; 
      throw error; 
    } 
    return rows[0]; 
  }
  async atualizarParcialmente(id, campos) { 
    // ... (código original sem alterações)
  }
  async confirmarValidacao(protocoloId, usuarioLogado) { return this.transitarEstado(protocoloId, 'CONFIRMAR_VALIDACAO', usuarioLogado); }
  async designarStakeholders(protocoloId, fun_id, cart_id, usuarioLogado) { const dados = { fun_id, cart_id }; return this.transitarEstado(protocoloId, 'DESIGNAR_STAKEHOLDERS', usuarioLogado, dados); }
  async enviarFaf(protocoloId, fafFile, usuarioLogado) { const dados = { fafFile }; return this.transitarEstado(protocoloId, 'ENVIAR_FAF', usuarioLogado, dados); }
  async atualizarProgressoFuneral(protocoloId, campos, usuarioLogado) { const dados = { campos }; return this.transitarEstado(protocoloId, 'ATUALIZAR_PROGRESSO_FUNERAL', usuarioLogado, dados); }
  async enviarMinuta(protocoloId, minutaFile, usuarioLogado) { const dados = { minutaFile }; return this.transitarEstado(protocoloId, 'ENVIAR_MINUTA', usuarioLogado, dados); }
  async aceitarMinuta(protocoloId, usuarioLogado) { return this.transitarEstado(protocoloId, 'ACEITAR_MINUTA', usuarioLogado); }
  async recusarMinuta(protocoloId, observacoes, usuarioLogado) { const dados = { observacoes }; return this.transitarEstado(protocoloId, 'RECUSAR_MINUTA', usuarioLogado, dados); }
  async definirPrevisaoRetirada(protocoloId, data_previsao_retirada, usuarioLogado) { const dados = { data_previsao_retirada }; return this.transitarEstado(protocoloId, 'DEFINIR_PREVISAO_RETIRADA', usuarioLogado, dados); }
  async anexarCertidaoFinal(protocoloId, certidaoFile, usuarioLogado) { const dados = { certidaoFile }; return this.transitarEstado(protocoloId, 'ANEXAR_CERTIDAO_FINAL', usuarioLogado, dados); }
}

module.exports = ProtocoloService;
