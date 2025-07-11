const pool = require('../db'); // Importe sua conexão com o banco

async function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    // Se não houver ID, podemos parar aqui ou permitir que a rota decida.
    // Por segurança, é melhor parar.
    return res.status(401).json({ error: 'Acesso não autorizado. X-User-ID ausente.' });
  }

  try {
    // Busca o usuário completo no banco de dados
    const { rows } = await pool.query('SELECT id, role, grupo_id FROM usuarios WHERE id = $1', [userId]);

    if (rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado. Usuário não encontrado.' });
    }

    // Anexa o objeto de usuário completo à requisição
    req.user = rows[0];

    // Passa para o próximo middleware ou para o controller da rota
    next();
  } catch (error) {
    console.error('Erro no middleware de autenticação:', error);
    res.status(500).json({ error: 'Erro interno ao verificar o usuário.' });
  }
}

module.exports = authMiddleware;
