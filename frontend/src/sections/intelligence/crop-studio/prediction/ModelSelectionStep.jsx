import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

function formatTrainingDate(value) {
  if (!value) return 'Unknown training date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown training date';
  return date.toLocaleDateString();
}

export default function ModelSelectionStep({ models, selectedModelId, onSelect, isLoading, loadError, actionError }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h6">Step 1: Select Prediction Model</Typography>
      <Typography variant="body2" color="text.secondary">
        Choose which registered model should be set as the production model. Predictions in the next step will use this model.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Model type describes the algorithm family, and metrics help compare expected performance.
      </Typography>

      {loadError ? <Alert severity="error">{loadError}</Alert> : null}
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      {isLoading ? (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Loading available models...
          </Typography>
        </Stack>
      ) : null}

      {!isLoading && models.length === 0 ? (
        <Alert severity="warning">No model versions found. Register a model version before running predictions.</Alert>
      ) : null}

      <Stack spacing={1.5}>
        {models.map((model) => {
          const metrics = model.performance_metrics || {};
          const rmse = metrics.rmse;
          const r2 = metrics.r2;
          return (
            <Paper
              key={model.model_version_id}
              variant={selectedModelId === model.model_version_id ? 'elevation' : 'outlined'}
              elevation={selectedModelId === model.model_version_id ? 3 : 0}
              sx={{ p: 2, cursor: 'pointer' }}
              onClick={() => onSelect(model.model_version_id)}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Stack spacing={0.75}>
                  <FormControlLabel
                    control={
                      <Radio checked={selectedModelId === model.model_version_id} onChange={() => onSelect(model.model_version_id)} />
                    }
                    label={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle1">{model.version_tag}</Typography>
                        {model.is_production ? <Chip label="Current Production" color="success" size="small" /> : null}
                      </Stack>
                    }
                  />
                  <Typography variant="body2" color="text.secondary">
                    Type: {model.model_type || 'Unknown'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Trained: {formatTrainingDate(model.training_date)}
                  </Typography>
                  <Box>
                    {typeof r2 === 'number' ? (
                      <Typography variant="caption" color="text.secondary" sx={{ mr: 1.5 }}>
                        R2: {r2.toFixed(3)}
                      </Typography>
                    ) : null}
                    {typeof rmse === 'number' ? (
                      <Typography variant="caption" color="text.secondary">
                        RMSE: {rmse.toFixed(3)}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
