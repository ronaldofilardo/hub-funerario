// /services/cronJobs.js
const cron = require('node-cron');
const db = require('../db');
const { notificationService } = require('./index'); // Importa o notificationService

// ===================================================================================
// FUNÇÃO PARA ENCERRAR PROTOCOLOS FINALIZADOS (Fallback de 72h)
// ===================================================================================
async function encerrarProtocolosFinalizados() {
  console.log('[CRON] Verificando protocolos finalizados para encerrar (fallback de 72h)...');
  const client = await db.getClient();
  try {
    // CORREÇÃO: O valor do intervalo é concatenado diretamente na string da query.
    // Isso é seguro porque 'tempoLimite' é uma constante controlada por nós, não uma entrada do usuário.
    const tempoLimite = '72 hours'; 
    const query = `
      UPDATE protocolos 
      SET status = 'encerrado', data_encerramento = NOW()
      WHERE status = 'finalizado' AND updated_at < NOW() - INTERVAL '${tempoLimite}'
      RETURNING id;
    `;
    
    // A query agora é executada sem parâmetros.
    const res = await client.query(query);

    if (res.rowCount > 0) {
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
// NOVA FUNÇÃO PARA LIMPEZA DE DADOS (LGPD)
// ===================================================================================
async function limparDadosSensiveis() {
  console.log('[CRON] Verificando protocolos para limpeza de dados sensíveis (72h após encerramento)...');
  const client = await db.getClient();
  try {
    const tempoLimite = '72 hours';
    // NOTA: Esta query deleta os documentos associados.
    // A deleção dos arquivos físicos no disco/S3 seria uma etapa adicional.
    const query = `
      DELETE FROM documentos 
      WHERE protocolo_id IN (
        SELECT id FROM protocolos 
        WHERE status = 'encerrado' AND data_encerramento < NOW() - INTERVAL $1
      )
      RETURNING protocolo_id;
    `;
    
    const res = await client.query(query, [tempoLimite]);

    if (res.rowCount > 0) {
      const idsLimpos = res.rows.map(r => r.protocolo_id.substring(0, 8)).join(', ');
      console.log(`[CRON] Dados sensíveis (documentos) de ${res.rowCount} protocolos foram deletados: ${idsLimpos}.`);
      // NOTA: Aqui também seria o local para deletar os arquivos do sistema de arquivos.
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
  cron.schedule('* * * * *', () => {
     console.log('--- [CRON] Iniciando ciclo de teste de encerramento ---');
    encerrarProtocolosFinalizados();
    verificarInacaoCartorio();
  });
  console.log('Tarefas agendadas (Encerramento e Inação) para rodar a cada hora.');
}

// ===================================================================================
// INICIALIZADOR DAS TAREFAS AGENDADAS
// ===================================================================================
function initScheduledJobs() {
  // Revertendo para rodar a cada hora para produção
  cron.schedule('0 * * * *', () => { 
    console.log('--- [CRON] Iniciando ciclo de tarefas agendadas ---');
    encerrarProtocolosFinalizados();
    verificarInacaoCartorio();
    limparDadosSensiveis(); // Adiciona a nova tarefa ao ciclo
  });
  console.log('Tarefas agendadas (Encerramento, Inação e Limpeza) para rodar a cada hora.');
}

module.exports = { initScheduledJobs };
