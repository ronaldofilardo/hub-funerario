const pool = require('../db');

// Este middleware simula a autenticação para o MVP.
// Ele lê um cabeçalho customizado 'X-User-ID' para identificar o usuário.
const authSimulado = async (req, res, next) => {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    // Em um sistema real, isso seria um erro 401 Unauthorized.
    // Para o MVP, podemos deixar passar ou retornar um erro.
    // Vamos retornar um erro para forçar o teste correto.
    return res.status(401).json({ error: 'Cabeçalho X-User-ID é obrigatório para simulação de auth.' });
  }

  try {
    // Busca o usuário no banco para obter seu papel (role) e grupo (grupo_id)
    const userRes = await pool.query('SELECT id, role, grupo_id FROM usuarios WHERE id = $1', [userId]);

    if (userRes.rows.length === 0) {
      return res.status(403).json({ error: `Usuário simulado com ID ${userId} não encontrado.` });
    }

    // Anexa as informações do usuário ao objeto da requisição (req)
    // para que as próximas camadas (controller, service) possam usá-las.
    req.user = {
      id: userRes.rows[0].id,
      role: userRes.rows[0].role,
      grupo_id: userRes.rows[0].grupo_id
    };

    next(); // Passa para a próxima função no pipeline (a rota real)
  } catch (error) {
    console.error("Erro no middleware de autenticação simulado:", error);
    res.status(500).json({ error: 'Erro interno ao simular autenticação.' });
  }
};

module.exports = authSimulado;
