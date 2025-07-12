// /index.js
const express = require('express');
const cors = require('cors');
const http = require('http' );
const { initSocket } = require('./socket');

// --- Importações de Rotas e Middlewares ---
const authMiddleware = require('./middleware/authMiddleware');
const protocoloRoutes = require('./routes/protocolos');
const { initScheduledJobs } = require('./services/cronJobs');

const app = express();
const server = http.createServer(app );
const io = initSocket(server);
const PORT = 3001;

// --- Middlewares Globais ---
app.use(cors());
app.use(express.json());

// --- Aplicação de Middlewares de API ---
app.use('/api', authMiddleware); // Protege todas as rotas /api

// --- Definição das Rotas da API ---
app.use('/api/protocolos', protocoloRoutes);

// --- Lógica do Socket.io ---
io.on('connection', (socket) => {
  console.log(`Usuário conectado com ID do socket: ${socket.id}`);
  socket.on('join_room', (userId) => {
    const roomName = `user_${userId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} entrou no canal: ${roomName}`);
  });
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

// --- Inicialização de Serviços ---
initScheduledJobs();

// --- Inicialização do Servidor ---
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}.`);
});
