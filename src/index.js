const express = require('express');

const createApp = () => {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      servicio: 'auy1104-api-ejemplo',
      mensaje: 'El servicio está en ejecución',
    });
  });

  app.get('/api/saludo', (req, res) => {
    const nombre = req.query.nombre || 'estudiante';
    res.json({
      metodo: 'GET',
      ruta: '/api/saludo',
      mensaje: `Hola, ${nombre}. Esta es una respuesta JSON de ejemplo.`,
    });
  });

  app.post('/api/echo', (req, res) => {
    const cuerpo = req.body && typeof req.body === 'object' ? req.body : {};
    res.status(201).json({
      metodo: 'POST',
      ruta: '/api/echo',
      recibido: cuerpo,
      nota: 'El servidor devuelve lo que enviaste en el cuerpo (útil para practicar POST + JSON).',
    });
  });

  app.post('/api/suma', (req, res) => {
  const { a, b } = req.body;

  // Validación
  if (typeof a !== 'number' || typeof b !== 'number') {
    return res.status(400).json({
      error: 'a y b deben ser números'
    });
  }

  // Resultado
  const resultado = a + b;

  res.status(201).json({
    resultado
  });
});

app.get('/api/suma', (req, res) => {
  let { a, b } = req.query;

  // Convertir a número (porque vienen como string)
  a = Number(a);
  b = Number(b);

  // Validación
  if (isNaN(a) || isNaN(b)) {
    return res.status(400).json({
      error: 'a y b deben ser números válidos'
    });
  }

  const resultado = a + b;

  res.status(200).json({
    resultado
  });
});

  app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  return app;
};

module.exports = { createApp };

// test 