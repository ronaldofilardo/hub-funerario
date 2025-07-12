// /db.js
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres', // Mantenha seus dados
  host: 'localhost',
  database: 'hubfunerario',
  password: '123456', // Mantenha seus dados
  port: 5432,
  // --- NOVAS CONFIGURAÇÕES DE ROBUSTEZ ---
  max: 20, // Número máximo de clientes no pool
  idleTimeoutMillis: 30000, // Tempo em ms que um cliente pode ficar ocioso antes de ser fechado
  connectionTimeoutMillis: 2000, // Tempo em ms para esperar por uma conexão antes de dar erro
});

// Adiciona um listener para erros no pool, para facilitar a depuração
pool.on('error', (err, client) => {
  console.error('Erro inesperado no cliente ocioso do pool', err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(), // Exporta um método para pegar um cliente para transações
  pool, // Exporta o pool em si, se necessário
};
