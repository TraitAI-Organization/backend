const config = {
  port: process.env.PORT || '3001',
  host: process.env.HOST || '127.0.0.1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  pythonBackendUrl: process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000'
};

module.exports = config;
