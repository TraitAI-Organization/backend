const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Express server is healthy'
  });
});

module.exports = router;
