const express = require('express');
const router = express.Router();
const upload = require('../multerConfig');
const protocoloController = require('../controllers/protocoloController');

// Middleware para upload de múltiplos arquivos na criação
const cpUpload = upload.fields([
    { name: 'declaracao_obito', maxCount: 1 },
    { name: 'doc_falecido', maxCount: 1 },
    { name: 'doc_declarante', maxCount: 1 }
]);

// A rota de criação ainda não foi refatorada para o service/controller para manter a simplicidade do 'cpUpload'
router.post('/', cpUpload, async (req, res) => {
    const {
        nome_completo_falecido, data_nascimento_falecido, nome_mae_falecido, cpf_falecido,
        criador_id, grupo_id, data_obito, data_sepultamento
      } = req.body;
      const arquivos = req.files;
    
      if (!arquivos || !arquivos.declaracao_obito) {
        return res.status(400).json({ error: 'O upload da declaração de óbito é obrigatório.' });
      }
    
      const client = await require('../db').connect();
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

// Rotas de Leitura
router.get('/', (req, res) => protocoloController.listarTodos(req, res));
router.get('/:id', (req, res) => protocoloController.buscarPorId(req, res));

// Rota de Atualização Genérica
router.patch('/:id', (req, res) => protocoloController.atualizarParcialmente(req, res));

// Rotas de Ação (Transições de Estado)
router.post('/:id/confirmar-validacao', (req, res) => protocoloController.confirmarValidacao(req, res));
router.post('/:id/designar-stakeholders', (req, res) => protocoloController.designarStakeholders(req, res));
router.post('/:id/enviar-faf', upload.single('faf'), (req, res) => protocoloController.enviarFaf(req, res));
router.patch('/:id/progresso-funeral', (req, res) => protocoloController.atualizarProgressoFuneral(req, res));
router.post('/:id/enviar-minuta', upload.single('minuta'), (req, res) => protocoloController.enviarMinuta(req, res));
router.post('/:id/aceitar-minuta', (req, res) => protocoloController.aceitarMinuta(req, res));
router.post('/:id/recusar-minuta', (req, res) => protocoloController.recusarMinuta(req, res));
router.post('/:id/definir-previsao-retirada', (req, res) => protocoloController.definirPrevisaoRetirada(req, res));
router.post('/:id/anexar-certidao-final', upload.single('certidao_final'), (req, res) => protocoloController.anexarCertidaoFinal(req, res));

module.exports = router;
