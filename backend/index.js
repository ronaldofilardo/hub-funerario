const express = require('express');
const cors = require('cors');
const http = require('http' );
const { initSocket } = require('./socket'); // <<< IMPORTA A FUNÇÃO DE INICIALIZAÇÃO

const app = express();
const server = http.createServer(app );

// Inicializa o Socket.IO usando o módulo separado
initSocket(server);

const PORT = 3001;

// --- Importações de Rotas e Serviços ---
const protocoloRoutes = require('./routes/protocolos');
const { initScheduledJobs } = require('./services/cronJobs');
const authSimulado = require('./middleware/authSimulado');

// --- Middlewares Globais ---
app.use(cors());
app.use(express.json());

// --- Rota de Verificação de Saúde ---
app.get('/', (req, res) => {
  res.send('<h1>Servidor do Hub Funerário está no ar!</h1>');
});

// --- Definição das Rotas da API ---
app.use('/api/protocolos', authSimulado, protocoloRoutes);

// --- Inicialização de Serviços ---
initScheduledJobs();

// --- Inicialização do Servidor ---
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}.`);
});
