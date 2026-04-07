import { useEffect, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';

import MainCard from 'components/MainCard';
import ModelSelectionStep from 'sections/intelligence/crop-studio/prediction/ModelSelectionStep';
import PredictionInputStep from 'sections/intelligence/crop-studio/prediction/PredictionInputStep';
import PredictionReviewStep from 'sections/intelligence/crop-studio/prediction/PredictionReviewStep';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const steps = ['Model Selection', 'Prediction Inputs', 'Review Result'];

const initialFormValues = {
  crop: '',
  latitude: '',
  longitude: '',
  totalN: '',
  totalP: '',
  totalK: '',
  acres: '',
  season: '',
  waterApplied: '',
  state: '',
  county: '',
  variety: ''
};

function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export default function PredictionWizard({ onOpenPredictionsTable }) {
  const [activeStep, setActiveStep] = useState(0);

  const [models, setModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [modelLoadError, setModelLoadError] = useState('');
  const [modelActionError, setModelActionError] = useState('');
  const [isSettingProduction, setIsSettingProduction] = useState(false);

  const [formValues, setFormValues] = useState(initialFormValues);
  const [cropOptions, setCropOptions] = useState([]);
  const [varietyOptions, setVarietyOptions] = useState([]);
  const [seasonOptions, setSeasonOptions] = useState([]);
  const [stateOptions, setStateOptions] = useState([]);
  const [countyOptions, setCountyOptions] = useState([]);
  const [optionLoadError, setOptionLoadError] = useState('');

  const [isSubmittingPrediction, setIsSubmittingPrediction] = useState(false);
  const [predictionResult, setPredictionResult] = useState(null);
  const [predictionError, setPredictionError] = useState('');

  const selectedModel = useMemo(
    () => models.find((model) => model.model_version_id === selectedModelId) || null,
    [models, selectedModelId]
  );

  useEffect(() => {
    const controller = new AbortController();

    const loadModels = async () => {
      setIsLoadingModels(true);
      setModelLoadError('');
      try {
        const response = await fetch(`${API_BASE_URL}/models/versions?limit=200`, { signal: controller.signal });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to load models (${response.status}): ${errorText}`);
        }

        const payload = await response.json();
        const list = Array.isArray(payload) ? payload : [];
        setModels(list);

        const production = list.find((model) => model.is_production);
        if (production) {
          setSelectedModelId(production.model_version_id);
        } else if (list.length > 0) {
          setSelectedModelId(list[0].model_version_id);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          setModelLoadError(error.message || 'Failed to load model versions.');
        }
      } finally {
        setIsLoadingModels(false);
      }
    };

    loadModels();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadOptions = async () => {
      setOptionLoadError('');
      try {
        const [cropsRes, seasonsRes, statesRes] = await Promise.all([
          fetch(`${API_BASE_URL}/fields/crops/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/seasons/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/states/`, { signal: controller.signal })
        ]);

        if (!cropsRes.ok || !seasonsRes.ok || !statesRes.ok) {
          throw new Error('Failed to load form options from backend.');
        }

        const [cropsPayload, seasonsPayload, statesPayload] = await Promise.all([cropsRes.json(), seasonsRes.json(), statesRes.json()]);

        const crops = Array.isArray(cropsPayload) ? cropsPayload.map((item) => item?.crop_name_en).filter(Boolean) : [];
        const seasons = Array.isArray(seasonsPayload)
          ? seasonsPayload.map((item) => item?.season_year).filter((v) => v !== null && v !== undefined)
          : [];
        const states = Array.isArray(statesPayload) ? statesPayload.map((item) => item?.state).filter(Boolean) : [];

        setCropOptions(Array.from(new Set(crops)).sort((a, b) => a.localeCompare(b)));
        setSeasonOptions(Array.from(new Set(seasons)).sort((a, b) => Number(b) - Number(a)));
        setStateOptions(Array.from(new Set(states)).sort((a, b) => a.localeCompare(b)));
        setOptionLoadError('');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setOptionLoadError(error.message || 'Failed to load form options.');
        }
      }
    };

    loadOptions();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadVarieties = async () => {
      if (!formValues.crop) {
        setVarietyOptions([]);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/fields/varieties/?crop=${encodeURIComponent(formValues.crop)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load varieties from backend.');
        }

        const payload = await response.json();
        const varieties = Array.isArray(payload) ? payload.map((item) => item?.variety_name_en).filter(Boolean) : [];
        setVarietyOptions(Array.from(new Set(varieties)).sort((a, b) => a.localeCompare(b)));
        setOptionLoadError('');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setVarietyOptions([]);
          setOptionLoadError(error.message || 'Failed to load variety options.');
        }
      }
    };

    loadVarieties();

    return () => controller.abort();
  }, [formValues.crop]);

  useEffect(() => {
    const controller = new AbortController();

    const loadCounties = async () => {
      if (!formValues.state) {
        setCountyOptions([]);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/fields/counties/?state=${encodeURIComponent(formValues.state)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load counties from backend.');
        }

        const payload = await response.json();
        const counties = Array.isArray(payload) ? payload.map((item) => item?.county).filter(Boolean) : [];
        setCountyOptions(Array.from(new Set(counties)).sort((a, b) => a.localeCompare(b)));
        setOptionLoadError('');
      } catch (error) {
        if (error.name !== 'AbortError') {
          setCountyOptions([]);
          setOptionLoadError(error.message || 'Failed to load county options.');
        }
      }
    };

    loadCounties();

    return () => controller.abort();
  }, [formValues.state]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormValues((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'crop' ? { variety: '' } : {}),
      ...(name === 'state' ? { county: '' } : {})
    }));
  };

  const buildPredictionPayload = () => ({
    crop: formValues.crop,
    variety: formValues.variety || null,
    acres: toNullableNumber(formValues.acres),
    lat: toNullableNumber(formValues.latitude),
    long: toNullableNumber(formValues.longitude),
    season: toNullableNumber(formValues.season),
    totalN_per_ac: toNullableNumber(formValues.totalN),
    totalP_per_ac: toNullableNumber(formValues.totalP),
    totalK_per_ac: toNullableNumber(formValues.totalK),
    water_applied_mm: toNullableNumber(formValues.waterApplied),
    state: formValues.state || null,
    county: formValues.county || null
  });

  const setProductionModel = async () => {
    if (!selectedModelId) {
      throw new Error('Select a model before continuing.');
    }

    const isAlreadyProduction = selectedModel?.is_production;
    if (isAlreadyProduction) return;

    const response = await fetch(`${API_BASE_URL}/models/versions/${selectedModelId}/set-production`, {
      method: 'POST'
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to set production model (${response.status}): ${errorText}`);
    }

    setModels((prev) =>
      prev.map((model) => ({
        ...model,
        is_production: model.model_version_id === selectedModelId
      }))
    );
  };

  const runPrediction = async () => {
    const payload = buildPredictionPayload();
    const response = await fetch(`${API_BASE_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Prediction request failed (${response.status}): ${errorText}`);
    }

    return response.json();
  };

  const handleContinue = async () => {
    if (activeStep === 0) {
      setModelActionError('');
      setPredictionError('');
      setIsSettingProduction(true);
      try {
        await setProductionModel();
        setActiveStep(1);
      } catch (error) {
        setModelActionError(error.message || 'Failed to set production model.');
      } finally {
        setIsSettingProduction(false);
      }
      return;
    }

    if (activeStep === 1) {
      setPredictionError('');
      setIsSubmittingPrediction(true);
      try {
        const result = await runPrediction();
        setPredictionResult(result);
        setActiveStep(2);
      } catch (error) {
        setPredictionError(error.message || 'Prediction failed.');
      } finally {
        setIsSubmittingPrediction(false);
      }
    }
  };

  const handleBack = () => {
    if (activeStep === 0) return;
    setActiveStep((prev) => prev - 1);
  };

  const handleResetWizard = () => {
    setActiveStep(0);
    setPredictionResult(null);
    setPredictionError('');
    setModelActionError('');
    setFormValues(initialFormValues);
  };

  const primaryButtonLabel =
    activeStep === 0
      ? isSettingProduction
        ? 'Setting Model...'
        : 'Continue'
      : isSubmittingPrediction
        ? 'Running Prediction...'
        : 'Run Prediction';

  const isPrimaryDisabled =
    activeStep === 0
      ? isLoadingModels || isSettingProduction || !selectedModelId || models.length === 0
      : activeStep === 1
        ? isSubmittingPrediction
        : true;

  return (
    <MainCard title="Yield Intelligence Prediction Wizard">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          Select a model, enter field inputs, and review prediction output in a guided workflow.
        </Typography>

        <Stepper activeStep={activeStep}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 ? (
          <ModelSelectionStep
            models={models}
            selectedModelId={selectedModelId}
            onSelect={setSelectedModelId}
            isLoading={isLoadingModels}
            loadError={modelLoadError}
            actionError={modelActionError}
          />
        ) : null}

        {activeStep === 1 ? (
          <>
            <PredictionInputStep
              formValues={formValues}
              onChange={handleInputChange}
              crops={cropOptions}
              varieties={varietyOptions}
              seasons={seasonOptions}
              states={stateOptions}
              counties={countyOptions}
            />
            {optionLoadError ? <Alert severity="warning">{optionLoadError}</Alert> : null}
            {predictionError ? <Alert severity="error">{predictionError}</Alert> : null}
          </>
        ) : null}

        {activeStep === 2 ? (
          predictionResult ? (
            <PredictionReviewStep
              selectedModel={selectedModel}
              predictionResult={predictionResult}
              onOpenPredictionsTable={onOpenPredictionsTable}
            />
          ) : (
            <Alert severity="warning">No prediction result is available yet.</Alert>
          )
        ) : null}

        <Divider />

        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={handleBack} disabled={activeStep === 0 || isSettingProduction || isSubmittingPrediction}>
            Back
          </Button>

          {activeStep < 2 ? (
            <Button variant="contained" onClick={handleContinue} disabled={isPrimaryDisabled}>
              {primaryButtonLabel}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleResetWizard}>
              Start New Prediction
            </Button>
          )}
        </Stack>

        {(isSettingProduction || isSubmittingPrediction) && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <CircularProgress size={16} />
            <Typography variant="caption" color="text.secondary">
              {isSettingProduction ? 'Setting selected model as production...' : 'Running prediction...'}
            </Typography>
          </Stack>
        )}
      </Stack>
    </MainCard>
  );
}
