import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(decimals);
}

export default function PredictionReviewStep({ selectedModel, predictionResult }) {
  return (
    <Stack spacing={2.5}>
      <Typography variant="h6">Step 3: Review Prediction</Typography>
      <Typography variant="body2" color="text.secondary">
        Review selected model, prediction values, and explainability output.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={0.75}>
          <Typography variant="subtitle1">Selected Model</Typography>
          <Typography variant="body2">
            <strong>Version:</strong> {selectedModel?.version_tag || 'Unknown'}
          </Typography>
          <Typography variant="body2">
            <strong>Type:</strong> {selectedModel?.model_type || 'Unknown'}
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="subtitle1">Prediction Summary</Typography>
          <Typography variant="body2">
            <strong>Predicted Yield:</strong> {formatNumber(predictionResult?.predicted_yield)} bu/ac
          </Typography>
          <Typography variant="body2">
            <strong>Confidence Interval:</strong> {formatNumber(predictionResult?.confidence_interval?.[0])} -{' '}
            {formatNumber(predictionResult?.confidence_interval?.[1])} bu/ac
          </Typography>
          <Typography variant="body2">
            <strong>Model Version Used:</strong> {predictionResult?.model_version || 'Unknown'}
          </Typography>
        </Stack>
      </Paper>

      {predictionResult?.explainability?.top_features?.length ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle1">Top Features</Typography>
            {predictionResult.explainability.top_features.map((feature, index) => (
              <Typography key={`${feature.feature}-${index}`} variant="body2" color="text.secondary">
                {feature.feature}: {String(feature.value)} ({feature.direction}, importance: {formatNumber(feature.importance, 3)})
              </Typography>
            ))}
          </Stack>
        </Paper>
      ) : null}

      <Divider />

      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="outlined" onClick={() => {}}>
          Predictions Table
        </Button>
      </Stack>
    </Stack>
  );
}
