const express = require('express');
const router = express.Router();
const upload = require('../multerConfig');

// Importa a CLASSE do controller, não a instância
const ProtocoloController = require('../controllers/protocoloController');
// Importa a INSTÂNCIA do service a partir do centralizador
const { protocoloService } = require('../services');

// Cria uma instância do controller, injetando a dependência do service
const protocoloController = new ProtocoloController(protocoloService);

// Middleware para upload de múltiplos arquivos na criação
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
