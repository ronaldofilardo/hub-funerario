// /services/cronJobs.js
const cron = require('node-cron');
const db = require('../db'); // ALTERAÇÃO 1: Importar o objeto db

async function encerrarProtocolosFinalizados() {
  console.log('Executando tarefa agendada: Verificando protocolos para encerrar...');
  const client = await db.getClient(); // ALTERAÇÃO 2: Usar db.getClient()
  try {
    // A sua lógica de verificação de 72 horas vai aqui
    // Exemplo:
    const query = `
      UPDATE protocolos SET status = 'encerrado'
      WHERE status = 'finalizado' AND data_finalizado < NOW() - INTERVAL '72 hours'
      RETURNING id;
    `;
    const res = await client.query(query);
    if (res.rowCount > 0) {
      console.log(`[CRON] ${res.rowCount} protocolos foram encerrados automaticamente.`);
    }
  } catch (err) {
    // O erro que você viu no log foi capturado aqui
    console.error('[NODE-CRON] [ERROR]', err);
  } finally {
    client.release();
  }
}

function initScheduledJobs() {
  // Roda a cada hora
  cron.schedule('0 * * * *', encerrarProtocolosFinalizados);
  console.log('Tarefa de encerramento de protocolos agendada para rodar a cada hora.');
}

module.exports = { initScheduledJobs };
