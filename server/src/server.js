const app = require('./app');
const config = require('./config/env');

app.listen(config.port, config.host, () => {
  console.log(`Server running at http://${config.host}:${config.port}`);
  console.log(`Allowed CORS origin: ${config.corsOrigin}`);
  console.log(`Python backend URL: ${config.pythonBackendUrl}`);
});
