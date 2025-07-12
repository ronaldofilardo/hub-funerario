// /services/revocationService.js

const db = require('../db'); // Importa a conexão com o banco de dados
const { registrarAcao } = require('./auditService'); // Importa a função do nosso novo serviço

/**
 * @description Busca por protocolos que foram encerrados há mais de 30 dias
 * e revoga o acesso dos declarantes (DECL) associados.
 * Registra cada revogação na trilha de auditoria.
 */
async function revogarAcessoDeclarantesExpirados() {
  console.log('INFO: Iniciando job de revogação de acesso para declarantes...');

  try {
    // 1. Encontra declarantes de protocolos encerrados há mais de 30 dias
    //    e que ainda não tiveram o acesso revogado.
    const query = `
      SELECT
        p.decl_id
      FROM
        protocolos p
      JOIN
        usuarios u ON p.decl_id = u.id
      WHERE
        p.status = 'encerrado'
        AND p.data_encerramento <= NOW() - INTERVAL '30 days'
        AND u.acesso_revogado = FALSE
        AND u.role = 'DECL';
    `;

    const { rows: declarantesParaRevogar } = await db.query(query);

    if (declarantesParaRevogar.length === 0) {
      console.log('INFO: Nenhum declarante para ter o acesso revogado.');
      return;
    }

    const declIds = declarantesParaRevogar.map(d => d.decl_id);
    console.log(`INFO: ${declIds.length} declarante(s) serão revogados: ${declIds.join(', ')}`);

    // 2. Atualiza a tabela de usuários para revogar o acesso
    const updateQuery = `
      UPDATE usuarios
      SET acesso_revogado = TRUE
      WHERE id = ANY($1::int[]);
    `;
    await db.query(updateQuery, [declIds]);

    // 3. Registra a ação na trilha de auditoria para cada usuário revogado
    for (const id of declIds) {
      await registrarAcao({
        usuarioId: 1, // Usando ID 1 para representar o "SISTEMA"
        acao: 'REVOGACAO_ACESSO_DECL',
        protocoloId: null,
        detalhes: `Acesso do declarante (ID: ${id}) revogado automaticamente após 30 dias do encerramento.`
      });
    }

    console.log('SUCCESS: Job de revogação de acesso concluído com sucesso.');

  } catch (error) {
    console.error('ERROR: Falha ao executar o job de revogação de acesso:', error);
  }
}

module.exports = {
  revogarAcessoDeclarantesExpirados,
};
