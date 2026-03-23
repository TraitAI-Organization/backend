const express = require('express');
const { sendPredictionRequest } = require('../services/pythonClient');

const router = express.Router();

router.post('/', async (req, res) => {
  const inputData = req.body;

  if (!inputData || Object.keys(inputData).length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Request body is missing or empty'
    });
  }

  try {
    const predictionResult = await sendPredictionRequest(inputData);

    return res.status(200).json({
      status: 'success',
      message: 'Prediction completed successfully',
      data: predictionResult
    });
  } catch (error) {
    console.error('Error calling Python backend:', error.message);

    return res.status(502).json({
      status: 'error',
      message: 'Failed to get prediction from Python backend'
    });
  }
});

module.exports = router;
