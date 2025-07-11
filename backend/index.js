const express = require('express');
const protocolosRouter = require('./routes/protocolos');

const app = express();
const PORT = 3001;

const { initScheduledJobs } = require('./services/cronJobs');

app.use(express.json());

app.get('/', (req, res) => {
  res.send('<h1>Servidor do Hub Funerário está no ar!</h1>');
});

app.use('/api/protocolos', protocolosRouter);

initScheduledJobs(); // Inicia as tarefas agendadas

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}.`);
});
