const express = require('express');
const cors = require('cors');
const http = require('http' );
const { initSocket } = require('./socket');

const app = express();
const server = http.createServer(app );

// Inicializa o Socket.IO e exporta a instância
const io = initSocket(server);

const PORT = 3001;

// --- Importações de Rotas e Serviços ---
const protocoloRoutes = require('./routes/protocolos');
const { initScheduledJobs } = require('./services/cronJobs');
const authSimulado = require('./middleware/authSimulado');

// --- Middlewares Globais ---
app.use(cors());
app.use(express.json());

// --- Lógica do Socket.io ---
io.on('connection', (socket) => {
  console.log(`Usuário conectado com ID do socket: ${socket.id}`);

  socket.on('join_room', (userId) => {
    const roomName = `user_${userId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} entrou no canal: ${roomName}`);
  });

  // Novo listener para entrar em canais de grupo
  socket.on('join_group_room', (groupId) => {
    const roomName = `grupo_${groupId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} entrou no canal de grupo: ${roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`Usuário desconectado com ID do socket: ${socket.id}`);
  });
});

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
