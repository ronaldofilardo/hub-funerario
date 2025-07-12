// /services/cronJobs.js
const cron = require('node-cron');
const db = require('../db');
const { notificationService } = require('./index'); // Importa o notificationService

// ===================================================================================
// FUNÇÃO PARA ENCERRAR PROTOCOLOS FINALIZADOS (Fallback de 72h)
// ===================================================================================
async function encerrarProtocolosFinalizados() {
  console.log('[CRON] Verificando protocolos finalizados para encerrar...');
  const client = await db.getClient();
  try {
    const tempoLimite = '72 hours';
    const query = `
      UPDATE protocolos 
      SET status = 'encerrado', data_encerramento = NOW()
      WHERE status = 'finalizado' AND updated_at < NOW() - INTERVAL '${tempoLimite}'
      RETURNING id;
    `;
    // Usamos updated_at para saber quando foi a última atualização (que o levou a 'finalizado')
    const res = await client.query(query);
    if (res.rowCount > 0) {
      console.log(`[CRON] ${res.rowCount} protocolos foram encerrados automaticamente por timeout de 72h.`);
      // Aqui você poderia adicionar uma notificação para os stakeholders, se desejado.
    }
  } catch (err) {
    console.error('[CRON] Erro ao encerrar protocolos finalizados:', err);
  } finally {
    client.release();
  }
}

// ===================================================================================
// FUNÇÃO PARA VERIFICAR INAÇÃO DO CARTÓRIO
// ===================================================================================
async function verificarInacaoCartorio() {
  console.log('[CRON] Verificando inação do Cartório em estados críticos...');
  const client = await db.getClient();
  try {
    const tempoLimite = '96 hours'; // Limite de 4 dias para ação
    const query = `
      SELECT id, grupo_id, cart_id, status_documentacao FROM protocolos
      WHERE status_documentacao IN ('aguardando_retificacao', 'aguardando_emissao_certidao')
      AND updated_at < NOW() - INTERVAL '${tempoLimite}';
    `;
    
    const res = await client.query(query);

    if (res.rowCount > 0) {
        console.log(`[CRON] Detectada inação em ${res.rowCount} protocolos do cartório.`);
    }

    for (const protocolo of res.rows) {
      // Supondo que o ADM tem um ID fixo ou uma forma de ser identificado. Usaremos 1 como exemplo.
      // Em um sistema real, você buscaria todos os usuários com role='ADM'.
      const admRole = 'ADM';
      const admUsers = await db.query('SELECT id FROM usuarios WHERE role = $1', [admRole]);

      const mensagem = `ALERTA CRÍTICO: Protocolo ${protocolo.id.substring(0,8)} está estagnado no estado '${protocolo.status_documentacao}' por mais de 96 horas. Cartório ID: ${protocolo.cart_id}. Necessária intervenção manual.`;
      
      for (const adm of admUsers.rows) {
        console.log(`[CRON] Enviando notificação de inação para ADM ID: ${adm.id}`);
        notificationService.enviarParaUsuario(
          adm.id,
          'ALERTA_INACAO_CARTORIO',
          { 
            protocoloId: protocolo.id,
            mensagem: mensagem
          }
        );
      }
    }
  } catch (err) {
    console.error('[CRON] Erro ao verificar inação do cartório:', err);
  } finally {
    client.release();
  }
}


// ===================================================================================
// INICIALIZADOR DAS TAREFAS AGENDADAS
// ===================================================================================
function initScheduledJobs() {
  // Roda a cada hora, no minuto 0.
  cron.schedule('0 * * * *', () => { 
    console.log('--- [CRON] Iniciando ciclo de tarefas agendadas ---');
    encerrarProtocolosFinalizados();
    verificarInacaoCartorio();
  });
  console.log('Tarefas agendadas (Encerramento e Inação) para rodar a cada hora.');
}

module.exports = { initScheduledJobs };
