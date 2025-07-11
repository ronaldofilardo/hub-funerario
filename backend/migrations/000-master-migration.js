const pool = require('../db');

const masterMigration = async () => {
  console.log('INICIANDO MIGRAÇÃO MESTRE COMPLETA...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. Criando ENUMs...');
    await client.query(`
      CREATE TYPE protocolo_status AS ENUM ('criando', 'aguardando_validacao', 'aguardando_comparecimento', 'aguardando_assinaturas_para_FAF', 'em_execucao_paralela', 'finalizado', 'encerrado', 'cancelado');
      CREATE TYPE status_fluxo_sepultamento AS ENUM ('nao_iniciado', 'em_andamento', 'concluido');
      CREATE TYPE status_fluxo_documentacao AS ENum ('nao_iniciado', 'aguardando_minuta', 'aguardando_aprovacao_decl', 'aguardando_retificacao', 'minuta_recusada_timeout', 'aguardando_emissao_certidao', 'concluido');
      CREATE TYPE usuario_role AS ENUM ('ADM', 'PF', 'Triagem', 'FUN', 'CART', 'DECL');
    `);

    console.log('2. Criando tabelas de suporte (grupos, usuarios)...');
    await client.query(`
      CREATE TABLE grupos (id SERIAL PRIMARY KEY, nome_grupo VARCHAR(100) NOT NULL UNIQUE);
      CREATE TABLE usuarios (id SERIAL PRIMARY KEY, nome VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE, senha_hash VARCHAR(255) NOT NULL, role usuario_role NOT NULL, grupo_id INTEGER REFERENCES grupos(id), aprovado BOOLEAN NOT NULL DEFAULT FALSE, data_cadastro TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT statement_timestamp(), ultimo_login TIMESTAMP WITH TIME ZONE);
    `);

    console.log('3. Criando tabelas principais (falecidos, protocolos, documentos, audit_log)...');
    await client.query(`
      CREATE TABLE falecidos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome_completo VARCHAR(255) NOT NULL, data_nascimento DATE NOT NULL, nome_mae VARCHAR(255), cpf VARCHAR(14), CONSTRAINT falecidos_unicidade_robusta UNIQUE (nome_completo, data_nascimento, nome_mae));
      CREATE TABLE protocolos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), falecido_id UUID NOT NULL REFERENCES falecidos(id), criador_id INTEGER REFERENCES usuarios(id), fun_id INTEGER REFERENCES usuarios(id), cart_id INTEGER REFERENCES usuarios(id), decl_id INTEGER REFERENCES usuarios(id), grupo_id INTEGER NOT NULL REFERENCES grupos(id), status protocolo_status NOT NULL, status_sepultamento status_fluxo_sepultamento NOT NULL DEFAULT 'nao_iniciado', status_documentacao status_fluxo_documentacao NOT NULL DEFAULT 'nao_iniciado', data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT statement_timestamp(), data_encerramento TIMESTAMP WITH TIME ZONE, data_obito TIMESTAMP WITH TIME ZONE, data_sepultamento TIMESTAMP WITH TIME ZONE, minuta_recusas_count INTEGER NOT NULL DEFAULT 0, CONSTRAINT chk_data_obito CHECK (data_obito < statement_timestamp()), CONSTRAINT chk_data_sepultamento CHECK (data_sepultamento > statement_timestamp()));
      CREATE TABLE documentos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), protocolo_id UUID NOT NULL REFERENCES protocolos(id) ON DELETE CASCADE, tipo_documento VARCHAR(50) NOT NULL, caminho_arquivo TEXT NOT NULL, nome_original TEXT NOT NULL, mimetype VARCHAR(100) NOT NULL, tamanho_bytes BIGINT NOT NULL, data_upload TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT statement_timestamp());
      CREATE TABLE audit_log (id SERIAL PRIMARY KEY, usuario_id INTEGER, tabela_afetada VARCHAR(50) NOT NULL, operacao VARCHAR(10) NOT NULL, data_hora TIMESTAMP WITH TIME ZONE DEFAULT statement_timestamp(), valores_antigos JSONB, valores_novos JSONB, ip_address INET, user_agent TEXT);
    `);

    await client.query('COMMIT');
    console.log('MIGRAÇÃO MESTRE CONCLUÍDA COM SUCESSO!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('ERRO CRÍTICO DURANTE A MIGRAÇÃO MESTRE:', error);
    throw error;
  } finally {
    client.release();
  }
};

masterMigration().catch(err => {
  console.error('FALHA GERAL NO SCRIPT DE MIGRAÇÃO MESTRE:', err);
  process.exit(1);
});
