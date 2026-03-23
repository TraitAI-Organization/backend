const express = require('express');
const cors = require('cors');

const config = require('./config/env');
const healthRoutes = require('./routes/health');
const predictRoutes = require('./routes/predict');

const app = express();

app.use(
  cors({
    origin: config.corsOrigin
  })
);

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('Express server is running');
});

app.use('/health', healthRoutes);
app.use('/predict', predictRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found'
  });
});

module.exports = app;
