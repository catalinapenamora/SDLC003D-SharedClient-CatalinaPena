const { createApp } = require('./src/lib/index');

const app = createApp();

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`API escuchando en http://0.0.0.0:${PORT}`);
  });
}