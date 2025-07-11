const cron = require('node-cron');
const pool = require('../db'); // Importa a conexão com o banco

// Função que busca e encerra os protocolos
const encerrarProtocolosFinalizados = async () => {
  console.log('Executando tarefa agendada: Verificando protocolos para encerrar...');
  const client = await pool.connect();
  try {
    // Busca protocolos que estão 'finalizados' há mais de 72 horas
    // ATENÇÃO: Usando 'data_finalizado' como nome do campo. Se for diferente, ajuste aqui.
    const query = `
      SELECT id FROM protocolos
      WHERE status = 'finalizado' AND data_finalizado < NOW() - INTERVAL '72 hours';
    `;
    const res = await client.query(query);

    if (res.rows.length === 0) {
      console.log('Nenhum protocolo para encerrar nesta execução.');
      return;
    }

    const protocolosParaEncerrar = res.rows.map(p => p.id);
    console.log(`Protocolos a serem encerrados: ${protocolosParaEncerrar.join(', ')}`);

    // Atualiza o status para 'encerrado' e registra a data de encerramento
    const updateQuery = `
      UPDATE protocolos
      SET status = 'encerrado',
          data_encerramento = NOW()
      WHERE id = ANY($1::uuid[]);
    `;
    await client.query(updateQuery, [protocolosParaEncerrar]);

    console.log(`${protocolosParaEncerrar.length} protocolo(s) encerrado(s) com sucesso.`);
    // TODO: Disparar notificações sobre o encerramento, se necessário.

  } catch (error) {
    console.error('Erro ao executar a tarefa de encerramento de protocolos:', error);
  } finally {
    client.release();
  }
};

// Agenda a tarefa para ser executada a cada hora
// A sintaxe é: 'minuto hora dia-do-mês mês dia-da-semana'
// '0 * * * *' significa "no minuto 0 de toda hora"
const initScheduledJobs = () => {
  cron.schedule('0 * * * *', encerrarProtocolosFinalizados);
  console.log('Tarefa de encerramento de protocolos agendada para rodar a cada hora.');
};

module.exports = { initScheduledJobs };
