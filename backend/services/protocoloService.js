const pool = require('../db');

class ProtocoloService {
  async aceitarMinuta(protocoloId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const protocoloQuery = 'SELECT status, status_documentacao FROM protocolos WHERE id = $1 FOR UPDATE;';
      const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

      if (protocoloResult.rows.length === 0) {
        throw new Error('Protocolo não encontrado.'); // Lança um erro que o controller vai tratar
      }

      const { status, status_documentacao } = protocoloResult.rows[0];

      if (status !== 'em_execucao_paralela' || status_documentacao !== 'aguardando_aprovacao_decl') {
        throw new Error('Ação inválida para o estado atual do protocolo.');
      }

      const updateQuery = `
        UPDATE protocolos
        SET status_documentacao = 'aguardando_emissao_certidao'
        WHERE id = $1
        RETURNING *;
      `;
      const { rows } = await client.query(updateQuery, [protocoloId]);
      
      await client.query('COMMIT');
      return rows[0]; // Retorna o protocolo atualizado

    } catch (error) {
      await client.query('ROLLBACK');
      throw error; // Re-lança o erro para ser capturado pelo controller
    } finally {
      client.release();
    }
  }

  // ... (outras funções de serviço como recusarMinuta, definirPrevisao, etc.)
}

module.exports = new ProtocoloService();
