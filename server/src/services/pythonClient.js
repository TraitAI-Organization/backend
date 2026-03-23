const config = require('../config/env');

async function sendPredictionRequest(inputData) {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(inputData)
  });

  if (!response.ok) {
    throw new Error(`Python backend responded with status ${response.status}`);
  }

  const data = await response.json();
  return data;
}

module.exports = {
  sendPredictionRequest
};
