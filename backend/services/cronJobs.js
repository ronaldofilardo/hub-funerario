// /services/cronJobs.js
const cron = require('node-cron');
const db = require('../db');
const { notificationService } = require('./index');

// ===================================================================================
// FUNÇÃO PARA ENCERRAR PROTOCOLOS FINALIZADOS (Fallback de 72h)
// ===================================================================================
async function encerrarProtocolosFinalizados() {
  console.log('[CRON] Verificando protocolos finalizados para encerrar (fallback de 72h)...');
  const client = await db.getClient();
  try {
    const tempoLimite = '72 hours';
    const query = `
      UPDATE protocolos 
      SET status = 'encerrado', data_encerramento = NOW()
      WHERE status = 'finalizado' AND updated_at < (NOW() AT TIME ZONE 'UTC') - INTERVAL '${tempoLimite}'
      RETURNING id;
    `;
    const res = await client.query(query);
    if (res.rows && res.rows.length > 0) {
      const idsEncerrados = res.rows.map(r => r.id.substring(0, 8)).join(', ');
      console.log(`[CRON] ${res.rowCount} protocolos foram encerrados automaticamente por timeout: ${idsEncerrados}.`);
    }
  } catch (err) {
    console.error('[CRON] Erro ao encerrar protocolos finalizados:', err);
  } finally {
    client.release();
  }
}

// ===================================================================================
// FUNÇÃO PARA LIMPEZA DE DADOS (LGPD)
// ===================================================================================
async function limparDadosSensiveis() {
  console.log('[CRON] Verificando protocolos para limpeza de dados sensíveis (72h após encerramento)...');
  const client = await db.getClient();
  try {
    const tempoLimite = '72 hours';
    const query = `
      DELETE FROM documentos 
      WHERE protocolo_id IN (
        SELECT id FROM protocolos 
        WHERE status = 'encerrado' AND data_encerramento < (NOW() AT TIME ZONE 'UTC') - INTERVAL '${tempoLimite}'
      )
      RETURNING protocolo_id;
    `;
    const res = await client.query(query);
    if (res.rowCount > 0) {
      const idsLimpos = res.rows.map(r => r.protocolo_id.substring(0, 8)).join(', ');
      console.log(`[CRON] Dados sensíveis (documentos) de ${res.rowCount} protocolos foram deletados: ${idsLimpos}.`);
    }
  } catch (err) {
    console.error('[CRON] Erro ao limpar dados sensíveis:', err);
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
    const tempoLimite = '96 hours';
    const query = `
      SELECT id, grupo_id, cart_id, status_documentacao FROM protocolos
      WHERE status_documentacao IN ('aguardando_retificacao', 'aguardando_emissao_certidao')
      AND updated_at < (NOW() AT TIME ZONE 'UTC') - INTERVAL '${tempoLimite}';
    `;
    const res = await client.query(query);
    if (res.rowCount > 0) {
      console.log(`[CRON] Detectada inação em ${res.rowCount} protocolos do cartório.`);
      for (const protocolo of res.rows) {
        const admUsers = await db.query('SELECT id FROM usuarios WHERE role = $1', ['ADM']);
        const mensagem = `ALERTA CRÍTICO: Protocolo ${protocolo.id.substring(0,8)} está estagnado no estado '${protocolo.status_documentacao}' por mais de 96 horas. Cartório ID: ${protocolo.cart_id}. Necessária intervenção manual.`;
        for (const adm of admUsers.rows) {
          console.log(`[CRON] Enviando notificação de inação para ADM ID: ${adm.id}`);
          notificationService.enviarParaUsuario(adm.id, 'ALERTA_INACAO_CARTORIO', { protocoloId: protocolo.id, mensagem: mensagem });
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Erro ao verificar inação do cartório:', err);
  } finally {
    client.release();
  }
}

// ===================================================================================
// FUNÇÃO PARA REVOGAÇÃO DE ACESSO (LGPD)
// ===================================================================================
async function revogarAcessoDeclarante() {
  console.log('[CRON] Verificando acesso de declarantes para revogação (30 dias após encerramento)...');
  const client = await db.getClient();
  try {
    const tempoLimite = '30 days';
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - 30);

    const query = `
      UPDATE usuarios u
      SET acesso_revogado = TRUE
      FROM protocolos p
      WHERE 
        u.id = p.decl_id AND
        u.role = 'DECL' AND
        p.status = 'encerrado' AND
        p.data_encerramento < $1
      RETURNING u.id;
    `;
    
    const res = await client.query(query, [dataLimite]);

    if (res.rowCount > 0) {
      const idsRevogados = res.rows.map(r => r.id).join(', ');
      console.log(`[CRON] Acesso revogado para ${res.rowCount} declarantes: ${idsRevogados}.`);
    }
  } catch (err) {
    console.error('[CRON] Erro ao revogar acesso de declarantes:', err);
  } finally {
    client.release();
  }
}

// ===================================================================================
// INICIALIZADOR DAS TAREFAS AGENDADAS
// ===================================================================================
function initScheduledJobs() {
  // Para teste, mude para '* * * * *'
  cron.schedule('0 * * * *', () => { 
    console.log('--- [CRON] Iniciando ciclo de tarefas agendadas ---');
    encerrarProtocolosFinalizados();
    verificarInacaoCartorio();
    limparDadosSensiveis();
    revogarAcessoDeclarante();
  });
  console.log('Tarefas agendadas (Encerramento, Inação, Limpeza e Revogação) para rodar a cada hora.');
}

module.exports = { initScheduledJobs };
