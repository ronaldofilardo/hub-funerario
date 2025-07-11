const express = require('express');
const router = express.Router();
const pool = require('../db');
const upload = require('../multerConfig');

// Define os campos de arquivo esperados para a rota de criação
const cpUpload = upload.fields([
  { name: 'declaracao_obito', maxCount: 1 },
  { name: 'doc_falecido', maxCount: 1 },
  { name: 'doc_declarante', maxCount: 1 }
]);

// Rota GET para LISTAR TODOS os protocolos
router.get('/', async (req, res) => {
  try {
    const todosProtocolos = await pool.query('SELECT * FROM protocolos ORDER BY data_criacao DESC;');
    res.status(200).json(todosProtocolos.rows);
  } catch (error) {
    console.error('Erro ao listar protocolos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota GET para BUSCAR UM protocolo específico pelo ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const protocolo = await pool.query('SELECT * FROM protocolos WHERE id = $1;', [id]);
    if (protocolo.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }
    res.status(200).json(protocolo.rows[0]);
  } catch (error) {
    console.error(`Erro ao buscar protocolo ${req.params.id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// Rota POST para CRIAR um novo protocolo
router.post('/', cpUpload, async (req, res) => {
  const {
    nome_completo_falecido, data_nascimento_falecido, nome_mae_falecido, cpf_falecido,
    criador_id, grupo_id, data_obito, data_sepultamento
  } = req.body;
  const arquivos = req.files;

  if (!arquivos || !arquivos.declaracao_obito) {
    return res.status(400).json({ error: 'O upload da declaração de óbito é obrigatório.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const falecidoQuery = `INSERT INTO falecidos (nome_completo, data_nascimento, nome_mae, cpf) VALUES ($1, $2, $3, $4) RETURNING id;`;
    const falecidoResult = await client.query(falecidoQuery, [nome_completo_falecido, new Date(data_nascimento_falecido), nome_mae_falecido, cpf_falecido]);
    const falecidoId = falecidoResult.rows[0].id;

    const protocoloQuery = `INSERT INTO protocolos (falecido_id, criador_id, grupo_id, status, data_obito, data_sepultamento) VALUES ($1, $2, $3, 'criando', $4, $5) RETURNING *;`;
    const protocoloResult = await client.query(protocoloQuery, [falecidoId, Number(criador_id), Number(grupo_id), data_obito, data_sepultamento]);
    const novoProtocolo = protocoloResult.rows[0];

    const docQuery = `INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) VALUES ($1, $2, $3, $4, $5, $6);`;
    for (const fieldName in arquivos) {
      const file = arquivos[fieldName][0];
      await client.query(docQuery, [novoProtocolo.id, fieldName, file.path, file.originalname, file.mimetype, file.size]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: "Protocolo e documentos criados com sucesso!", protocolo: novoProtocolo });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar protocolo com documentos:', error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

// Rota PATCH para ATUALIZAR um protocolo
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const camposParaAtualizar = req.body;
  const chaves = Object.keys(camposParaAtualizar);

  if (chaves.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo fornecido para atualização.' });
  }

  const setString = chaves.map((chave, index) => `"${chave}" = $${index + 1}`).join(', ');
  const valores = Object.values(camposParaAtualizar);

  try {
    const query = `UPDATE protocolos SET ${setString} WHERE id = $${chaves.length + 1} RETURNING *;`;
    const protocoloAtualizado = await pool.query(query, [...valores, id]);

    if (protocoloAtualizado.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado para atualização.' });
    }
    res.status(200).json(protocoloAtualizado.rows[0]);
  } catch (error) {
    console.error(`Erro ao atualizar protocolo ${id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor ao atualizar protocolo.' });
  }
});

// Rota POST para a AÇÃO de confirmar a validação
router.post('/:id/confirmar-validacao', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selectQuery = 'SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;';
    const protocoloResult = await client.query(selectQuery, [id]);

    if (protocoloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    const statusAtual = protocoloResult.rows[0].status;
    if (statusAtual !== 'aguardando_validacao') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Transição de estado inválida.',
        message: `Não é possível confirmar a validação de um protocolo que está no estado "${statusAtual}".`
      });
    }

    const updateQuery = `UPDATE protocolos SET status = 'aguardando_comparecimento' WHERE id = $1 RETURNING *;`;
    const protocoloValidado = await client.query(updateQuery, [id]);
    await client.query('COMMIT');
    res.status(200).json(protocoloValidado.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Erro ao confirmar validação do protocolo ${id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

// Rota POST para a AÇÃO de designar stakeholders
router.post('/:id/designar-stakeholders', async (req, res) => {
  const { id } = req.params;
  const { fun_id, cart_id } = req.body;

  if (!fun_id || !cart_id) {
    return res.status(400).json({ error: 'Os IDs da funerária (fun_id) e do cartório (cart_id) são obrigatórios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectQuery = 'SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;';
    const protocoloResult = await client.query(selectQuery, [id]);

    if (protocoloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    const statusAtual = protocoloResult.rows[0].status;
    if (statusAtual !== 'aguardando_comparecimento') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Transição de estado inválida.',
        message: `Não é possível designar stakeholders para um protocolo que está no estado "${statusAtual}".`
      });
    }

    const updateQuery = `
      UPDATE protocolos
      SET fun_id = $1, cart_id = $2, status = 'aguardando_assinaturas_para_FAF'
      WHERE id = $3
      RETURNING *;
    `;
    const protocoloAtualizado = await client.query(updateQuery, [fun_id, cart_id, id]);

    await client.query('COMMIT');
    res.status(200).json(protocoloAtualizado.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Erro ao designar stakeholders para o protocolo ${id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

// Rota POST para a AÇÃO de enviar a FAF
router.post('/:id/enviar-faf', upload.single('faf'), async (req, res) => {
  const { id } = req.params;
  const fafFile = req.file;

  if (!fafFile) {
    return res.status(400).json({ error: 'O arquivo da FAF é obrigatório.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const selectQuery = 'SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;';
    const protocoloResult = await client.query(selectQuery, [id]);

    if (protocoloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    const statusAtual = protocoloResult.rows[0].status;
    if (statusAtual !== 'aguardando_assinaturas_para_FAF') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Transição de estado inválida.',
        message: `Não é possível enviar a FAF para um protocolo que está no estado "${statusAtual}".`
      });
    }

    const docQuery = `
      INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) 
      VALUES ($1, $2, $3, $4, $5, $6);
    `;
    await client.query(docQuery, [id, 'faf', fafFile.path, fafFile.originalname, fafFile.mimetype, fafFile.size]);

    const updateQuery = `
      UPDATE protocolos
      SET status = 'em_execucao_paralela'
      WHERE id = $1
      RETURNING *;
    `;
    const protocoloAtualizado = await client.query(updateQuery, [id]);

    await client.query('COMMIT');

    res.status(200).json({
      message: "FAF enviada com sucesso e protocolo atualizado.",
      protocolo: protocoloAtualizado.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Erro ao enviar FAF para o protocolo ${id}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

// Rota PATCH para a Funerária atualizar o progresso do funeral
router.patch('/:id/progresso-funeral', async (req, res) => {
  const { id: protocoloId } = req.params;
  const camposParaAtualizar = req.body;
  const chaves = Object.keys(camposParaAtualizar);

  if (chaves.length === 0) {
    return res.status(400).json({ error: 'Nenhum campo fornecido para atualização.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const protocoloQuery = 'SELECT status FROM protocolos WHERE id = $1 FOR UPDATE;';
    const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

    if (protocoloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    const statusAtual = protocoloResult.rows[0].status;
    if (statusAtual !== 'em_execucao_paralela') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ação inválida.',
        message: `Não é possível atualizar o progresso do funeral para um protocolo que está no estado "${statusAtual}".`
      });
    }

    const setString = chaves.map((chave, index) => `"${chave}" = $${index + 2}`).join(', ');
    const upsertQuery = `
      INSERT INTO progresso_funeral (protocolo_id, ${chaves.join(', ')})
      VALUES ($1, ${chaves.map((_, i) => `$${i + 2}`).join(', ')})
      ON CONFLICT (protocolo_id) 
      DO UPDATE SET ${setString}
      RETURNING *;
    `;
    const valores = [protocoloId, ...Object.values(camposParaAtualizar)];
    const progressoResult = await client.query(upsertQuery, valores);

    if (camposParaAtualizar.status_sepultamento === 'realizado') {
      const updateProtocoloQuery = `
        UPDATE protocolos SET status_sepultamento = 'concluido' WHERE id = $1;
      `;
      await client.query(updateProtocoloQuery, [protocoloId]);
      console.log(`Sub-estado do protocolo ${protocoloId} atualizado para 'concluido'.`);
    }

    await client.query('COMMIT');
    res.status(200).json({
      message: "Progresso do funeral atualizado com sucesso.",
      progresso: progressoResult.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Erro ao atualizar progresso do funeral para o protocolo ${protocoloId}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

// NOVA ROTA DE AÇÃO para o Cartório enviar a minuta
router.post('/:id/enviar-minuta', upload.single('minuta'), async (req, res) => {
  const { id: protocoloId } = req.params;
  const minutaFile = req.file;

  if (!minutaFile) {
    return res.status(400).json({ error: 'O arquivo da minuta é obrigatório.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const protocoloQuery = 'SELECT status, status_documentacao FROM protocolos WHERE id = $1 FOR UPDATE;';
    const protocoloResult = await client.query(protocoloQuery, [protocoloId]);

    if (protocoloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Protocolo não encontrado.' });
    }

    const { status, status_documentacao } = protocoloResult.rows[0];

    // "Guard" de Negócio: Ação permitida apenas no estado principal correto e sub-estado de documentação
    if (status !== 'em_execucao_paralela' || (status_documentacao !== 'nao_iniciado' && status_documentacao !== 'aguardando_minuta' && status_documentacao !== 'aguardando_retificacao')) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ação inválida.',
        message: `Não é possível enviar a minuta para um protocolo no estado "${status}" com o sub-estado de documentação "${status_documentacao}".`
      });
    }

    // 1. Insere o registro do documento na tabela 'documentos'
    const docQuery = `
      INSERT INTO documentos (protocolo_id, tipo_documento, caminho_arquivo, nome_original, mimetype, tamanho_bytes) 
      VALUES ($1, $2, $3, $4, $5, $6);
    `;
    await client.query(docQuery, [
      protocoloId,
      'minuta', // Tipo do documento
      minutaFile.path,
      minutaFile.originalname,
      minutaFile.mimetype,
      minutaFile.size
    ]);

    // 2. Atualiza o sub-estado de documentação do protocolo
    const updateQuery = `
      UPDATE protocolos
      SET status_documentacao = 'aguardando_aprovacao_decl'
      WHERE id = $1
      RETURNING *;
    `;
    const protocoloAtualizado = await client.query(updateQuery, [protocoloId]);

    await client.query('COMMIT');

    res.status(200).json({
      message: "Minuta enviada com sucesso para aprovação do declarante.",
      protocolo: protocoloAtualizado.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Erro ao enviar minuta para o protocolo ${protocoloId}:`, error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    client.release();
  }
});

module.exports = router;
