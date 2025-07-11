const pool = require('../db');

const up = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Iniciando a criação da tabela progresso_funeral e seu trigger de auditoria...');

    // 1. Criar a tabela progresso_funeral
    const createTableQuery = `
      CREATE TABLE progresso_funeral (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        protocolo_id UUID NOT NULL REFERENCES protocolos(id) ON DELETE CASCADE,
        data_retirada_corpo TIMESTAMP,
        status_remocao BOOLEAN DEFAULT FALSE,
        data_chegada_velorio TIMESTAMP,
        status_sepultamento VARCHAR(50) CHECK (status_sepultamento IN ('agendado', 'em_andamento', 'realizado')),
        data_encerramento_sepultamento TIMESTAMP,
        UNIQUE(protocolo_id)
      );
    `;
    await client.query(createTableQuery);
    console.log('Tabela "progresso_funeral" criada com sucesso.');

    // 2. Criar a função de trigger para auditoria
    const createTriggerFunctionQuery = `
      CREATE OR REPLACE FUNCTION log_progresso_funeral_changes() RETURNS TRIGGER AS $$
      BEGIN
          IF TG_OP = 'INSERT' THEN
              INSERT INTO audit_log (usuario_id, tabela_afetada, operacao, valores_novos)
              VALUES (current_setting('app.user_id', true)::integer, 'progresso_funeral', 'INSERT', to_jsonb(NEW));
          ELSIF TG_OP = 'UPDATE' THEN
              INSERT INTO audit_log (usuario_id, tabela_afetada, operacao, valores_antigos, valores_novos)
              VALUES (current_setting('app.user_id', true)::integer, 'progresso_funeral', 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;
    await client.query(createTriggerFunctionQuery);
    console.log('Função de trigger "log_progresso_funeral_changes" criada/atualizada com sucesso.');

    // 3. Criar o trigger que usa a função
    const createTriggerQuery = `
      CREATE TRIGGER progresso_funeral_audit
      AFTER INSERT OR UPDATE ON progresso_funeral
      FOR EACH ROW EXECUTE FUNCTION log_progresso_funeral_changes();
    `;
    await client.query(createTriggerQuery);
    console.log('Trigger "progresso_funeral_audit" criado com sucesso.');

    await client.query('COMMIT');
    console.log('Migração concluída com sucesso! Tabela e trigger de progresso do funeral criados.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro durante a migração:', err);
    throw err;
  } finally {
    client.release();
  }
};

// Executa a migração
up().catch(err => {
  process.exit(1);
});