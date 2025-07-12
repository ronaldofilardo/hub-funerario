// /routes/protocolos.js

const express = require('express');
const router = express.Router();
const upload = require('../multerConfig');
const authMiddleware = require('../middleware/authMiddleware');

// --- INJEÇÃO DE DEPENDÊNCIA ---
// 1. Importa as CLASSES
const ProtocoloController = require('../controllers/protocoloController');
const { protocoloService } = require('../services'); // O service já é uma instância criada no services/index.js

// 2. Cria a instância do controller, injetando a instância do service
const protocoloController = new ProtocoloController(protocoloService);

// --- MIDDLEWARES ---
router.use(authMiddleware);

const cpUpload = upload.fields([
    { name: 'declaracao_obito', maxCount: 1 },
    { name: 'doc_falecido', maxCount: 1 },
    { name: 'doc_declarante', maxCount: 1 }
]);

// --- DEFINIÇÃO DAS ROTAS ---
router.post('/', cpUpload, protocoloController.criarProtocolo);
router.get('/', protocoloController.listarTodos);
router.get('/:id', protocoloController.buscarPorId);
router.patch('/:id', protocoloController.atualizarParcialmente);
router.post('/:id/confirmar-validacao', protocoloController.confirmarValidacao);
router.post('/:id/designar-stakeholders', protocoloController.designarStakeholders);
router.post('/:id/enviar-faf', upload.single('faf'), protocoloController.enviarFaf);
router.patch('/:id/progresso-funeral', protocoloController.atualizarProgressoFuneral);
router.post('/:id/enviar-minuta', upload.single('minuta'), protocoloController.enviarMinuta);
router.post('/:id/aceitar-minuta', protocoloController.aceitarMinuta);
router.post('/:id/recusar-minuta', protocoloController.recusarMinuta);
router.post('/:id/definir-previsao-retirada', protocoloController.definirPrevisaoRetirada);
router.post('/:id/anexar-certidao-final', upload.single('certidao_final'), protocoloController.anexarCertidaoFinal);

module.exports = router;
