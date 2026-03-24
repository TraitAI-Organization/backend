import { useMemo, useRef, useState } from 'react';

import EditOutlined from '@ant-design/icons/EditOutlined';
import UploadOutlined from '@ant-design/icons/UploadOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import uploadIllustration from 'assets/images/upload/upload.svg';
import MainCard from 'components/MainCard';

const cropOptions = ['Sorghum', 'Winter Wheat', 'Grain', 'Corn', 'Soybean'];
const operationTypeOptions = ['Planting', 'Fertilizer', 'Irrigation', 'Scouting', 'Harvest'];
const operationStatusOptions = ['Planned', 'In Progress', 'Completed', 'Cancelled'];
const stateOptions = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming'
];

const getToday = () => new Date().toISOString().slice(0, 10);

const defaultManualValues = {
  fieldId: 1,
  cropType: '',
  variety: '',
  acres: 50.0,
  growerId: 1,
  seasonYear: 2024,
  jobId: 1,
  startDate: getToday(),
  endDate: getToday(),
  county: '',
  state: '',
  opType: '',
  opStatus: '',
  lat: 0,
  long: 0,
  yieldBuAc: 0.0,
  totalN: 0.0,
  totalP: 0.0,
  totalK: 0.0
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function DataUpload() {
  const [uploadMode, setUploadMode] = useState('csv');
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [manualValues, setManualValues] = useState(defaultManualValues);
  const [formError, setFormError] = useState('');
  const [payloadPreview, setPayloadPreview] = useState(null);
  const inputRef = useRef(null);

  const acceptedTypes = useMemo(() => ['.csv'], []);
  const acceptString = acceptedTypes.join(',');
  const getSelectProps = (placeholder) => ({
    displayEmpty: true,
    renderValue: (selected) => selected || placeholder
  });

  const appendFiles = (incomingFiles) => {
    const nextFiles = Array.from(incomingFiles || []).filter((file) =>
      acceptedTypes.some((type) => file.name.toLowerCase().endsWith(type))
    );
    setFiles((prev) => [...prev, ...nextFiles]);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    appendFiles(event.dataTransfer.files);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (event) => {
    appendFiles(event.target.files);
    event.target.value = '';
  };

  const handleManualValueChange = (event) => {
    const { name, value } = event.target;
    setManualValues((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleModeChange = (nextMode) => {
    setUploadMode(nextMode);
  };

  const handleManualSubmit = (event) => {
    event.preventDefault();
    setFormError('');

    const requiredLabels = [
      { key: 'fieldId', label: 'Field ID' },
      { key: 'cropType', label: 'Crop' },
      { key: 'acres', label: 'Acres' },
      { key: 'growerId', label: 'Grower ID' },
      { key: 'seasonYear', label: 'Season year' },
      { key: 'jobId', label: 'Job ID' }
    ];

    const missing = requiredLabels.filter(
      ({ key }) => manualValues[key] === '' || manualValues[key] === null || manualValues[key] === undefined
    );
    if (missing.length > 0) {
      setFormError(`Missing required fields: ${missing.map(({ label }) => label).join(', ')}`);
      return;
    }

    const payload = {
      field_id: Number(manualValues.fieldId),
      crop_name_en: manualValues.cropType,
      variety_name_en: manualValues.variety || null,
      acres: Number(manualValues.acres),
      grower: Number(manualValues.growerId),
      season: Number(manualValues.seasonYear),
      job_id: Number(manualValues.jobId),
      start: `${manualValues.startDate}T00:00:00.000000+00:00`,
      end: `${manualValues.endDate}T00:00:00.000000+00:00`,
      type: manualValues.opType,
      status: manualValues.opStatus,
      state: manualValues.state || null,
      county: manualValues.county || null,
      lat: numberOrNull(manualValues.lat),
      long: numberOrNull(manualValues.long),
      yield_bu_ac: numberOrNull(manualValues.yieldBuAc),
      totalN_per_ac: numberOrNull(manualValues.totalN),
      totalP_per_ac: numberOrNull(manualValues.totalP),
      totalK_per_ac: numberOrNull(manualValues.totalK),
      filenames: 'manual_entry.csv'
    };

    setPayloadPreview(payload);
  };

  return (
    <MainCard title="Data Upload">
      <Stack spacing={2.5}>
        <Typography variant="body1" color="text.primary">
          CSV upload (preview + ingest), manual entry form, and recent ingestion logs.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            startIcon={<UploadOutlined />}
            variant={uploadMode === 'csv' ? 'contained' : 'outlined'}
            onClick={() => handleModeChange('csv')}
          >
            CSV Upload
          </Button>
          <Button
            startIcon={<EditOutlined />}
            variant={uploadMode === 'manual' ? 'contained' : 'outlined'}
            onClick={() => handleModeChange('manual')}
          >
            Manual Entry
          </Button>
        </Stack>

        {uploadMode === 'csv' ? (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2">Accepted files</Typography>
              <Typography variant="caption" color="text.secondary">
                Upload one or more files: {acceptedTypes.join(', ')}
              </Typography>
            </Box>

            <Paper
              variant="outlined"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              sx={{
                p: 3,
                width: '100%',
                minHeight: { xs: 240, md: 300 },
                borderStyle: 'dashed',
                borderWidth: 2,
                borderColor: isDragging ? '#376688' : 'rgb(64, 102, 140)',
                bgcolor: isDragging ? 'rgba(50, 103, 142, 0.28)' : '#06141D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                sx={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Box
                  component="img"
                  src={uploadIllustration}
                  alt="Upload illustration"
                  sx={{
                    flexShrink: 0,
                    width: { xs: 120, sm: 140, md: 180 },
                    height: { xs: 120, sm: 140, md: 180 },
                    objectFit: 'contain',
                    display: 'block'
                  }}
                />
                <Stack
                  spacing={1.5}
                  sx={{
                    alignItems: 'center',
                    textAlign: 'center',
                    width: { xs: '100%', sm: 'auto' }
                  }}
                >
                  <Typography variant="body1">Drag and drop CSV files here</Typography>
                  <Typography variant="caption" color="text.secondary">
                    or click to select multiple files
                  </Typography>
                  <Button variant="outlined" onClick={() => inputRef.current?.click()}>
                    Choose CSV Files
                  </Button>
                  <input ref={inputRef} type="file" hidden multiple accept={acceptString} onChange={handleFileSelect} />
                </Stack>
              </Stack>
            </Paper>

            {files.length > 0 ? (
              <List dense disablePadding>
                {files.map((file, index) => (
                  <ListItem key={`${file.name}-${index}`} sx={{ px: 0 }}>
                    <Typography variant="body2">{file.name}</Typography>
                  </ListItem>
                ))}
              </List>
            ) : null}
          </Stack>
        ) : null}

        {uploadMode === 'manual' ? (
          <Box component="form" onSubmit={handleManualSubmit}>
            <Stack spacing={2.5}>
              {formError ? <Alert severity="error">{formError}</Alert> : null}

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Field ID</Typography>
                    <TextField
                      required
                      fullWidth
                      type="number"
                      name="fieldId"
                      value={manualValues.fieldId}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Crop</Typography>
                    <TextField
                      required
                      select
                      fullWidth
                      name="cropType"
                      value={manualValues.cropType}
                      onChange={handleManualValueChange}
                      SelectProps={getSelectProps('Select Crop')}
                    >
                      <MenuItem value="" disabled>
                        Select Crop
                      </MenuItem>
                      {cropOptions.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Variety</Typography>
                    <TextField fullWidth name="variety" value={manualValues.variety} onChange={handleManualValueChange} />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Acres</Typography>
                    <TextField
                      required
                      fullWidth
                      type="number"
                      name="acres"
                      value={manualValues.acres}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 0.1, step: 0.01 } }}
                    />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Grower ID</Typography>
                    <TextField
                      required
                      fullWidth
                      type="number"
                      name="growerId"
                      value={manualValues.growerId}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Season Year</Typography>
                    <TextField
                      required
                      fullWidth
                      type="number"
                      name="seasonYear"
                      value={manualValues.seasonYear}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 2010, max: 2030, step: 1 } }}
                    />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Job ID</Typography>
                    <TextField
                      required
                      fullWidth
                      type="number"
                      name="jobId"
                      value={manualValues.jobId}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Start date</Typography>
                    <TextField fullWidth type="date" name="startDate" value={manualValues.startDate} onChange={handleManualValueChange} />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">End date</Typography>
                    <TextField fullWidth type="date" name="endDate" value={manualValues.endDate} onChange={handleManualValueChange} />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">County</Typography>
                    <TextField fullWidth name="county" value={manualValues.county} onChange={handleManualValueChange} />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">State</Typography>
                    <TextField
                      select
                      fullWidth
                      name="state"
                      value={manualValues.state}
                      onChange={handleManualValueChange}
                      SelectProps={getSelectProps('Select State')}
                    >
                      <MenuItem value="" disabled>
                        Select State
                      </MenuItem>
                      {stateOptions.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Operation Type</Typography>
                    <TextField
                      select
                      fullWidth
                      name="opType"
                      value={manualValues.opType}
                      onChange={handleManualValueChange}
                      SelectProps={getSelectProps('Select Operation Type')}
                    >
                      <MenuItem value="" disabled>
                        Select Operation Type
                      </MenuItem>
                      {operationTypeOptions.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Status</Typography>
                    <TextField
                      select
                      fullWidth
                      name="opStatus"
                      value={manualValues.opStatus}
                      onChange={handleManualValueChange}
                      SelectProps={getSelectProps('Select Status')}
                    >
                      <MenuItem value="" disabled>
                        Select Status
                      </MenuItem>
                      {operationStatusOptions.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Latitude</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="lat"
                      value={manualValues.lat}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: -90, max: 90, step: 0.000001 } }}
                    />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Longitude</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="long"
                      value={manualValues.long}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: -180, max: 180, step: 0.000001 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Yield (bu/ac)</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="yieldBuAc"
                      value={manualValues.yieldBuAc}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                    />
                  </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Total N (lb/ac)</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="totalN"
                      value={manualValues.totalN}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Total P (lb/ac)</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="totalP"
                      value={manualValues.totalP}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                    />
                  </Stack>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Total K (lb/ac)</Typography>
                    <TextField
                      fullWidth
                      type="number"
                      name="totalK"
                      value={manualValues.totalK}
                      onChange={handleManualValueChange}
                      slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                    />
                  </Stack>
                </Grid>
              </Grid>

              <Stack direction="row" spacing={1.5}>
                <Button type="submit" variant="contained">
                  Submit field data
                </Button>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => {
                    setManualValues(defaultManualValues);
                    setFormError('');
                    setPayloadPreview(null);
                  }}
                >
                  Reset
                </Button>
              </Stack>

              {payloadPreview ? (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Payload Preview
                  </Typography>
                  <Box component="pre" sx={{ m: 0, overflowX: 'auto', fontSize: '0.75rem', color: 'text.secondary' }}>
                    {JSON.stringify(payloadPreview, null, 2)}
                  </Box>
                </Paper>
              ) : null}
            </Stack>
          </Box>
        ) : null}
      </Stack>
    </MainCard>
  );
}
