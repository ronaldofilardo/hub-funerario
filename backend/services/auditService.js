// /services/auditService.js

const db = require('../db'); // Importa a conexão com o banco de dados

/**
 * @description Registra uma ação no log de auditoria do sistema.
 * @param {object} logData - Os dados do log a serem registrados.
 * @param {number} logData.usuarioId - ID do usuário que realizou a ação (ou um ID de sistema).
 * @param {string} logData.acao - Um código que identifica a ação (ex: 'CRIAR_PROTOCOLO', 'REVOGACAO_ACESSO_DECL').
 * @param {number|null} logData.protocoloId - O ID do protocolo relacionado à ação, se houver.
 * @param {string} logData.detalhes - Uma descrição textual da ação.
 * @param {string|null} logData.ipAddress - O endereço IP da requisição.
 * @param {string|null} logData.userAgent - O User-Agent do cliente.
 */
async function registrarAcao(logData) {
  const {
    usuarioId,
    acao,
    protocoloId = null,
    detalhes,
    ipAddress = null,
    userAgent = null
  } = logData;

  const query = `
    INSERT INTO audit_log (usuario_id, acao, protocolo_id, detalhes, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id;
  `;

  try {
    // --- LINHA CORRIGIDA ---
    // A ordem dos valores agora corresponde à ordem das colunas na query INSERT.
    const { rows } = await db.query(query, [usuarioId, acao, protocoloId, detalhes, ipAddress, userAgent]);
    
    console.log(`INFO: Ação de auditoria registrada com sucesso. Log ID: ${rows[0].id}`);
    return rows[0];
  } catch (error) {
    console.error('ERROR: Falha ao registrar ação de auditoria:', error);
    throw error;
  }
}

module.exports = {
  registrarAcao,
};
