const multer = require('multer');
const path = require('path');

// Configuração de armazenamento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Filtro de arquivos para aceitar apenas PDF, JPG e PNG
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/png',
    'application/pdf'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo inválido. Apenas PDF, JPG e PNG são permitidos.'), false);
  }
};

// Cria a instância do Multer com as configurações
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024 // Limite de 2MB
  },
  fileFilter: fileFilter
});

module.exports = upload;
