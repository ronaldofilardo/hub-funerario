// /middleware/authMiddleware.js
const db = require('../db'); // Altere para importar o objeto db

async function authMiddleware(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(401).json({ error: 'Acesso não autorizado. X-User-ID ausente.' });
  }

  try {
    // Use o método query exportado
    const { rows } = await db.query('SELECT id, "role", grupo_id FROM usuarios WHERE id = $1', [userId]);

    if (rows.length === 0) {
      return res.status(403).json({ error: 'Acesso negado. Usuário não encontrado.' });
    }
    req.user = rows[0];
    next();
  } catch (error) {
    console.error('Erro no middleware de autenticação:', error);
    res.status(500).json({ error: 'Erro interno ao verificar o usuário.' });
  }
}

module.exports = authMiddleware;
