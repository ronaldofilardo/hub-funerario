// routes/protocolos.js

const express = require('express');
const router = express.Router();

// 1. Importações primeiro
const upload = require('../multerConfig');
const authMiddleware = require('../middleware/authMiddleware');
const protocoloController = require('../controllers/protocoloController');

// 3. Definição de middlewares de upload específicos
const cpUpload = upload.fields([
    { name: 'declaracao_obito', maxCount: 1 },
    { name: 'doc_falecido', maxCount: 1 },
    { name: 'doc_declarante', maxCount: 1 }
]);
const fafUpload = upload.single('faf');
const minutaUpload = upload.single('minuta');
const certidaoUpload = upload.single('certidao_final');

// 4. Aplicação do middleware de autenticação global para estas rotas
router.use(authMiddleware);

// 5. Definição de TODAS as rotas
console.log('Registrando rotas de protocolo...');

router.post('/', cpUpload, (req, res) => protocoloController.criarProtocolo(req, res));
router.get('/', (req, res) => protocoloController.listarTodos(req, res));
router.get('/:id', (req, res) => protocoloController.buscarPorId(req, res));
router.patch('/:id', (req, res) => protocoloController.atualizarParcialmente(req, res));
router.post('/:id/confirmar-validacao', (req, res) => protocoloController.confirmarValidacao(req, res));
router.post('/:id/designar-stakeholders', (req, res) => protocoloController.designarStakeholders(req, res));
router.post('/:id/enviar-faf', fafUpload, (req, res) => protocoloController.enviarFaf(req, res));
router.patch('/:id/progresso-funeral', (req, res) => protocoloController.atualizarProgressoFuneral(req, res));
router.post('/:id/enviar-minuta', minutaUpload, (req, res) => protocoloController.enviarMinuta(req, res));
router.post('/:id/aceitar-minuta', (req, res) => protocoloController.aceitarMinuta(req, res));
router.post('/:id/recusar-minuta', (req, res) => protocoloController.recusarMinuta(req, res));
router.post('/:id/definir-previsao-retirada', (req, res) => protocoloController.definirPrevisaoRetirada(req, res));
router.post('/:id/anexar-certidao-final', certidaoUpload, (req, res) => protocoloController.anexarCertidaoFinal(req, res));

// 6. Código de Depuração
console.log('--- Rotas de Protocolo Registradas ---');
router.stack.forEach(function(layer) {
  if (layer.route) {
    const path = layer.route.path;
    const method = Object.keys(layer.route.methods)[0].toUpperCase();
    console.log(`${method} -> /api/protocolos${path}`);
  }
});
console.log('------------------------------------');

// 7. Exportação
module.exports = router;
