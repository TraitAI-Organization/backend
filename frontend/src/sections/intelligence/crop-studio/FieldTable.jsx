import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CloseOutlined from '@ant-design/icons/CloseOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import DownloadOutlined from '@ant-design/icons/DownloadOutlined';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import RightOutlined from '@ant-design/icons/RightOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import FieldDetailDrawer from 'sections/intelligence/crop-studio/FieldDetailDrawer';
import YieldDeltaChip from 'sections/intelligence/crop-studio/YieldDeltaChip';
import { formatCropName } from 'utils/cropName';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '');
const DOWNLOAD_PAGE_SIZE = 500;
const initialServerFilters = {
  crop: '',
  variety: '',
  season: '',
  state: '',
  county: ''
};

const columns = [
  { id: 'fieldId', label: 'Field ID' },
  { id: 'crop', label: 'Crop' },
  { id: 'acres', label: 'acres' },
  { id: 'variety', label: 'Variety' },
  { id: 'season', label: 'Season' },
  { id: 'location', label: 'Location' },
  { id: 'observedYield', label: 'Observed Yield (bu/ac)' },
  { id: 'predictedYield', label: 'Predicted Yield (bu/ac)' },
  { id: 'n', label: 'N (lb/ac)' },
  { id: 'p', label: 'P (lb/ac)' },
  { id: 'k', label: 'K (lb/ac)' }
];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toLocation(county, state) {
  const normalizedCounty = county?.trim();
  const normalizedState = state?.trim();
  if (normalizedCounty && normalizedState) return `${normalizedCounty}, ${normalizedState}`;
  return normalizedCounty || normalizedState || 'N/A';
}

function compareValues(left, right) {
  const leftIsNull = left === null || left === undefined;
  const rightIsNull = right === null || right === undefined;

  if (leftIsNull && rightIsNull) return 0;
  if (leftIsNull) return 1;
  if (rightIsNull) return -1;

  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

function getComparator(order, orderBy) {
  if (order === 'desc') {
    return (a, b) => compareValues(b[orderBy], a[orderBy]);
  }
  return (a, b) => compareValues(a[orderBy], b[orderBy]);
}

async function fetchFieldRows(signal, page, limit, filters = initialServerFilters, modelId = null) {
  const params = new URLSearchParams({
    page: String(page + 1),
    limit: String(limit)
  });
  if (filters.crop) params.set('crop', filters.crop);
  if (filters.variety) params.set('variety', filters.variety);
  if (filters.season) params.append('season', String(filters.season));
  if (filters.state) params.set('state', filters.state);
  if (filters.county) params.set('county', filters.county);
  if (modelId !== null && modelId !== undefined && modelId !== '') {
    params.set('model_id', String(modelId));
  }
  const response = await fetch(`${API_BASE_URL}/fields?${params.toString()}`, { signal });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load field records (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];

  return {
    rows: rows.map((row) => {
      const ci = Array.isArray(row.confidence_interval) ? row.confidence_interval : [null, null];
      return {
        rowId: row.field_season_id ?? `${row.field_number ?? 'unknown'}-${row.season ?? 'unknown'}`,
        fieldSeasonId: row.field_season_id ?? null,
        fieldId: row.field_number ?? row.field_season_id ?? 'N/A',
        crop: row.crop || 'N/A',
        acres: toNumberOrNull(row.acres),
        variety: row.variety || 'N/A',
        season: row.season ?? 'N/A',
        location: toLocation(row.county, row.state),
        observedYield: toNumberOrNull(row.yield_bu_ac),
        predictedYield: toNumberOrNull(row.predicted_yield),
        confidenceLower: toNumberOrNull(ci[0]),
        confidenceUpper: toNumberOrNull(ci[1]),
        regionalAvgYield: toNumberOrNull(row.regional_avg_yield),
        eventCount: Number.isFinite(Number(row.management_event_count)) ? Number(row.management_event_count) : 0,
        n: toNumberOrNull(row.totalN_per_ac),
        p: toNumberOrNull(row.totalP_per_ac),
        k: toNumberOrNull(row.totalK_per_ac)
      };
    }),
    total: Number(payload?.total) || 0
  };
}

function formatMetric(value, decimals = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

// Friendly display name for a raw model_type string. Mirrors the mapping in
// Analytics.jsx and ModelSelectionStep — if you add models there, mirror here.
function getModelDisplayName(modelType, fallbackTag) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) return 'Deep Learning';
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) return 'CatBoost';
  if (key.includes('forest') || key.includes('tree')) return 'Random Forest';
  if (key.includes('xgb')) return 'XGBoost';
  return modelType || fallbackTag || 'Unknown';
}

// Per-model palette so the toggle pill visually changes when the user picks
// a different model. Mirrors the model-card tone mapping in
// ModelSelectionStep so a model's color is consistent across the app.
function getModelChipPalette(modelType, theme) {
  const key = String(modelType || '').toLowerCase();
  if (key.includes('deep') || key.includes('pytorch') || key.includes('neural')) {
    return {
      fg: theme.palette.primary.light,
      bg: alpha(theme.palette.primary.main, 0.18),
      border: alpha(theme.palette.primary.main, 0.5),
      hoverBg: alpha(theme.palette.primary.main, 0.32),
      hoverBorder: theme.palette.primary.main,
      dot: theme.palette.primary.main
    };
  }
  if (key.includes('catboost') || key.includes('lgbm') || key.includes('lightgbm') || key.includes('boost')) {
    return {
      fg: theme.palette.success.light,
      bg: alpha(theme.palette.success.main, 0.18),
      border: alpha(theme.palette.success.main, 0.5),
      hoverBg: alpha(theme.palette.success.main, 0.32),
      hoverBorder: theme.palette.success.main,
      dot: theme.palette.success.main
    };
  }
  if (key.includes('forest') || key.includes('tree')) {
    return {
      fg: theme.palette.info.light,
      bg: alpha(theme.palette.info.main, 0.18),
      border: alpha(theme.palette.info.main, 0.5),
      hoverBg: alpha(theme.palette.info.main, 0.32),
      hoverBorder: theme.palette.info.main,
      dot: theme.palette.info.main
    };
  }
  if (key.includes('xgb')) {
    return {
      fg: theme.palette.warning.light,
      bg: alpha(theme.palette.warning.main, 0.18),
      border: alpha(theme.palette.warning.main, 0.5),
      hoverBg: alpha(theme.palette.warning.main, 0.32),
      hoverBorder: theme.palette.warning.main,
      dot: theme.palette.warning.main
    };
  }
  return {
    fg: theme.palette.primary.light,
    bg: alpha(theme.palette.primary.main, 0.14),
    border: alpha(theme.palette.primary.main, 0.4),
    hoverBg: alpha(theme.palette.primary.main, 0.24),
    hoverBorder: theme.palette.primary.main,
    dot: theme.palette.primary.main
  };
}

const MODEL_PREF_STORAGE_KEY = 'traitharvest:fieldtable:modelId';

function readStoredModelId() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MODEL_PREF_STORAGE_KEY);
    if (raw === null || raw === '' || raw === 'null') return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function writeStoredModelId(value) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(MODEL_PREF_STORAGE_KEY);
    } else {
      window.localStorage.setItem(MODEL_PREF_STORAGE_KEY, String(value));
    }
  } catch {
    // localStorage unavailable (privacy mode etc.) — silently no-op.
  }
}

export default function FieldTable({
  // Show the per-model toggle pill in the table header (the
  // CatBoost / Deep Learning selector). The Overview tab now hides
  // this — there's no per-model swap there.
  showModelSelector = true,
  // Include the "Predicted Yield (bu/ac)" column. Hidden on the
  // Overview tab's simplified table where the observed yield is the
  // only yield signal of interest.
  showPredictedYieldColumn = true,
  // Render the right-edge affordance chevron on each row AND make
  // rows clickable (opens the FieldDetailDrawer). When false, both
  // the chevron and the click behaviour disappear — the table reads
  // as a static reference rather than an interactive list.
  showChevron = true,
  // Banner above the table. `undefined` uses the built-in default
  // ("Why is predicting yields on harvests important?"). Pass `null`
  // to suppress the banner entirely. Pass a ReactNode to render
  // custom banner content in the same Paper shell.
  banner,
  // Optional DOM id forwarded to the outermost wrapper so callers
  // can anchor smooth-scroll links to this table (e.g. the min/max
  // yield tooltip's "field detail view" link).
  id
}) {
  const theme = useTheme();
  const accentBlue = alpha(theme.palette.primary.main, 0.45);
  // Scrollbar styling — softer primary tints so the bar visually belongs
  // to the metric-card / table-header surface theme rather than punching
  // through it with a saturated rail.
  const tableScrollbarSx = {
    scrollbarWidth: 'thin',
    scrollbarColor: `${alpha(theme.palette.primary.main, 0.32)} transparent`,
    '&::-webkit-scrollbar': {
      width: 10,
      height: 10
    },
    '&::-webkit-scrollbar-track': {
      background: alpha(theme.palette.primary.main, 0.06),
      borderRadius: 8
    },
    '&::-webkit-scrollbar-thumb': {
      background: alpha(theme.palette.primary.main, 0.28),
      borderRadius: 8,
      border: `2px solid transparent`,
      backgroundClip: 'padding-box'
    },
    '&::-webkit-scrollbar-thumb:hover': {
      background: alpha(theme.palette.primary.main, 0.5),
      backgroundClip: 'padding-box'
    }
  };
  // Shared filter-input styling — pulls each TextField (Crop / Variety /
  // Season / State / County) out of MUI's neutral-gray default into the
  // page's Deep-Learning-pill family. Kept subtle: low-alpha primary
  // background, faint primary border at rest, brighter on hover and
  // saturated on focus. Disabled state also rendered in the primary family
  // (instead of MUI's gray) so the look stays cohesive when a chained
  // filter is locked (e.g. Variety before Crop is chosen).
  const filterFieldSx = {
    '& .MuiOutlinedInput-root': {
      bgcolor: alpha(theme.palette.primary.main, 0.08),
      transition: 'background 0.18s ease, border-color 0.18s ease',
      '& .MuiOutlinedInput-notchedOutline': {
        borderColor: alpha(theme.palette.primary.main, 0.3),
        transition: 'border-color 0.18s ease'
      },
      '&:hover': {
        bgcolor: alpha(theme.palette.primary.main, 0.14)
      },
      '&:hover .MuiOutlinedInput-notchedOutline': {
        borderColor: alpha(theme.palette.primary.main, 0.55)
      },
      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.primary.main,
        borderWidth: 1
      },
      '&.Mui-disabled': {
        bgcolor: alpha(theme.palette.primary.main, 0.04)
      },
      '&.Mui-disabled .MuiOutlinedInput-notchedOutline': {
        borderColor: alpha(theme.palette.primary.main, 0.18)
      }
    },
    // Selected-value text and placeholder — subtle primary-light tint so
    // the inputs still read as part of the blue family even before they
    // have a value.
    '& .MuiSelect-select': {
      color: alpha(theme.palette.common.white, 0.92),
      fontWeight: 500
    },
    '& .MuiSelect-select.MuiInputBase-input::placeholder': {
      color: alpha(theme.palette.primary.light, 0.7),
      opacity: 1
    },
    // Dropdown caret — themed instead of MUI's default neutral.
    '& .MuiSelect-icon': {
      color: alpha(theme.palette.primary.light, 0.85),
      transition: 'color 0.18s ease'
    },
    '&:hover .MuiSelect-icon': {
      color: theme.palette.primary.light
    },
    '& .Mui-disabled .MuiSelect-icon, & .MuiSelect-icon.Mui-disabled': {
      color: alpha(theme.palette.primary.light, 0.35)
    }
  };
  // Match the dropdown popup paper to the Deep-Learning-pill family so the
  // open menu doesn't break visual continuity with the closed input.
  const filterMenuProps = {
    PaperProps: {
      sx: {
        bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
        borderRadius: 1.25,
        backgroundImage: 'none',
        mt: 0.5,
        '& .MuiMenuItem-root': {
          color: alpha(theme.palette.common.white, 0.88),
          fontSize: '0.85rem',
          minHeight: 32,
          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
          '&.Mui-selected': {
            bgcolor: alpha(theme.palette.primary.main, 0.24),
            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.32) }
          }
        }
      }
    }
  };
  const [rows, setRows] = useState([]);
  const [order, setOrder] = useState('asc');
  const [orderBy, setOrderBy] = useState('fieldId');
  const [filters, setFilters] = useState(initialServerFilters);
  // Drawer state.
  const [selectedFieldSeasonId, setSelectedFieldSeasonId] = useState(null);
  // Hint banner ("Why predicted yield on rows we already harvested?") starts
  // collapsed so the page is clean on first paint; user can expand it for
  // context and dismiss it when they're done.
  const [bannerOpen, setBannerOpen] = useState(false);
  // Model toggle: which model's predictions to show in the Predicted Yield
  // column. Initial value is restored from localStorage so the user's last
  // choice persists between visits.
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState(() => readStoredModelId());
  // Use a ref for the anchor (always points to the live button DOM node) and
  // a separate boolean for open-state. This decoupled pattern is the most
  // robust against re-render edge-cases that could otherwise leave Popper
  // holding a stale anchor.
  const modelButtonRef = useRef(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [cropOptions, setCropOptions] = useState([]);
  const [varietyOptions, setVarietyOptions] = useState([]);
  const [seasonOptions, setSeasonOptions] = useState([]);
  const [stateOptions, setStateOptions] = useState([]);
  const [countyOptions, setCountyOptions] = useState([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [totalRows, setTotalRows] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterOptionsLoading, setIsFilterOptionsLoading] = useState(true);
  const [isVarietyLoading, setIsVarietyLoading] = useState(false);
  const [isCountyLoading, setIsCountyLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    const loadFilterOptions = async () => {
      setIsFilterOptionsLoading(true);
      try {
        const [cropsResponse, seasonsResponse, statesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/fields/crops/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/seasons/`, { signal: controller.signal }),
          fetch(`${API_BASE_URL}/fields/states/`, { signal: controller.signal })
        ]);

        if (!cropsResponse.ok || !seasonsResponse.ok || !statesResponse.ok) {
          throw new Error('Failed to load table filter options.');
        }

        const [cropsPayload, seasonsPayload, statesPayload] = await Promise.all([
          cropsResponse.json(),
          seasonsResponse.json(),
          statesResponse.json()
        ]);

        const crops = Array.from(
          new Set((Array.isArray(cropsPayload) ? cropsPayload : []).map((item) => item?.crop_name_en).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        const seasons = Array.from(
          new Set((Array.isArray(seasonsPayload) ? seasonsPayload : []).map((item) => item?.season_year).filter((value) => value !== null))
        ).sort((a, b) => Number(b) - Number(a));
        const states = Array.from(
          new Set((Array.isArray(statesPayload) ? statesPayload : []).map((item) => item?.state).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        setCropOptions(crops);
        setSeasonOptions(seasons);
        setStateOptions(states);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load table filter options.');
          setCropOptions([]);
          setSeasonOptions([]);
          setStateOptions([]);
        }
      } finally {
        setIsFilterOptionsLoading(false);
      }
    };

    loadFilterOptions();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadVarieties = async () => {
      if (!filters.crop) {
        setVarietyOptions([]);
        return;
      }

      setIsVarietyLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/fields/varieties/?crop=${encodeURIComponent(filters.crop)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load variety options.');
        }

        const payload = await response.json();
        const varieties = Array.from(
          new Set((Array.isArray(payload) ? payload : []).map((item) => item?.variety_name_en).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        setVarietyOptions(varieties);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load variety options.');
          setVarietyOptions([]);
        }
      } finally {
        setIsVarietyLoading(false);
      }
    };

    loadVarieties();

    return () => controller.abort();
  }, [filters.crop]);

  useEffect(() => {
    const controller = new AbortController();

    const loadCounties = async () => {
      if (!filters.state) {
        setCountyOptions([]);
        return;
      }

      setIsCountyLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/fields/counties/?state=${encodeURIComponent(filters.state)}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error('Failed to load county options.');
        }

        const payload = await response.json();
        const counties = Array.from(
          new Set((Array.isArray(payload) ? payload : []).map((item) => item?.county).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        setCountyOptions(counties);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load county options.');
          setCountyOptions([]);
        }
      } finally {
        setIsCountyLoading(false);
      }
    };

    loadCounties();

    return () => controller.abort();
  }, [filters.state]);

  // Fetch the registered model versions so the Predicted Yield column header
  // can offer them as options. Falls back to an empty list on error — the
  // toggle simply hides itself when there's nothing to switch between.
  useEffect(() => {
    const controller = new AbortController();
    const loadModelVersions = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/models/versions?limit=200`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json();
        setAvailableModels(Array.isArray(payload) ? payload : []);
      } catch (error) {
        if (error.name !== 'AbortError') setAvailableModels([]);
      }
    };
    loadModelVersions();
    return () => controller.abort();
  }, []);

  // Persist the user's chosen model so it survives page reloads / tab switches.
  useEffect(() => {
    writeStoredModelId(selectedModelId);
  }, [selectedModelId]);

  // When the model list arrives, make sure we have a valid selection. If the
  // user has nothing stored (or their stored choice no longer exists), default
  // to the production model — falling back to the first model if none is
  // flagged production. Ensures we never display "no model selected".
  useEffect(() => {
    if (availableModels.length === 0) return;
    const isCurrentValid =
      selectedModelId !== null &&
      selectedModelId !== undefined &&
      availableModels.some((m) => m.model_version_id === selectedModelId);
    if (isCurrentValid) return;
    const production = availableModels.find((m) => m.is_production);
    const fallback = production || availableModels[0];
    if (fallback) {
      setSelectedModelId(fallback.model_version_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels]);

  useEffect(() => {
    const controller = new AbortController();

    const loadRows = async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const result = await fetchFieldRows(controller.signal, page, rowsPerPage, filters, selectedModelId);
        setRows(result.rows);
        setTotalRows(result.total);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setLoadError(error.message || 'Failed to load field records.');
          setRows([]);
          setTotalRows(0);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadRows();

    return () => {
      controller.abort();
    };
  }, [page, rowsPerPage, filters, selectedModelId]);

  const sortedRows = useMemo(() => [...rows].sort(getComparator(order, orderBy)), [rows, order, orderBy]);

  const handleRequestSort = (columnId) => {
    const isAsc = orderBy === columnId && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(columnId);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const allRows = [];
      let currentPage = 0;
      let total = 0;

      do {
        const result = await fetchFieldRows(undefined, currentPage, DOWNLOAD_PAGE_SIZE, filters, selectedModelId);
        if (currentPage === 0) total = result.total;
        allRows.push(...result.rows);
        currentPage += 1;
        if (result.rows.length === 0) break;
      } while (allRows.length < total);

      const exportRows = allRows.sort(getComparator(order, orderBy));

      const header = columns.map((column) => column.label).join(',');
      const body = exportRows
      .map((row) =>
        columns
          .map((column) => {
            const rawValue = row[column.id];
            const cell = rawValue === null || rawValue === undefined ? '' : String(rawValue);
            return `"${cell.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');

      const csv = `${header}\n${body}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'field-season-records.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      setLoadError(error.message || 'Failed to download field records.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleChangePage = (_, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleFilterChange = (name, value) => {
    setFilters((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'crop') next.variety = '';
      if (name === 'state') next.county = '';
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = () => {
    setFilters(initialServerFilters);
    setPage(0);
  };

  const visibleRows = sortedRows;
  const hasActiveFilters = Boolean(filters.crop || filters.variety || filters.season || filters.state || filters.county);
  const downloadLabel = hasActiveFilters ? 'Download Filtered CSV' : 'Download CSV';

  // Currently selected model + its palette (color tokens) for the toggle pill.
  const selectedModel = availableModels.find((m) => m.model_version_id === selectedModelId) || null;
  const modelPalette = getModelChipPalette(selectedModel?.model_type, theme);
  const modelLabel = selectedModel ? getModelDisplayName(selectedModel.model_type, selectedModel.version_tag) : 'Select model';
  // Stable handlers — useCallback ensures the Button's onClick reference
  // doesn't churn across renders, and the Menu's onClose stays consistent.
  const handleOpenModelMenu = useCallback(() => setModelMenuOpen(true), []);
  const handleCloseModelMenu = useCallback(() => setModelMenuOpen(false), []);
  const handleSelectModel = useCallback((modelVersionId) => {
    setSelectedModelId(modelVersionId);
    setModelMenuOpen(false);
  }, []);

  return (
    <Stack id={id} spacing={2}>
      {loadError ? (
        <Typography variant="body2" color="error.main">
          {loadError}
        </Typography>
      ) : null}

      {/* Banner slot above the table. Callers can pass a custom
          ReactNode via `banner`, pass `null` to suppress entirely, or
          leave it undefined to fall through to the default "Why
          predict yields" explainer below. */}
      {banner === null ? null : banner !== undefined ? (
        banner
      ) : (
      // Why-predict explainer card — matches the Deep-Learning-pill palette
      // used by the rest of the Overview cards (saturated primary surface +
      // half-alpha primary border + soft drop shadow) so it reads as a
      // first-class card rather than an inline hint. Collapsed by default.
      <Paper
        variant="outlined"
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.18),
          borderColor: alpha(theme.palette.primary.main, 0.5),
          borderRadius: 2,
          backgroundImage: 'none',
          overflow: 'hidden',
          boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'center',
            px: 2.25,
            py: 1.5,
            cursor: 'pointer',
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.08)
            }
          }}
          onClick={() => setBannerOpen((prev) => !prev)}
          role="button"
          aria-expanded={bannerOpen}
          aria-label="Toggle predicted yield explanation"
        >
          <Box
            sx={{
              color: alpha(theme.palette.primary.light, 0.95),
              fontSize: '1.05rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <InfoCircleOutlined />
          </Box>
          <Typography
            sx={{
              flex: 1,
              fontWeight: 700,
              color: theme.palette.common.white,
              fontSize: '0.92rem',
              letterSpacing: '0.01em'
            }}
          >
            Why is predicting yields on harvests important?
          </Typography>
          <IconButton
            size="small"
            aria-label={bannerOpen ? 'Close explanation' : 'Open explanation'}
            onClick={(event) => {
              event.stopPropagation();
              setBannerOpen((prev) => !prev);
            }}
            sx={{
              color: alpha(theme.palette.common.white, 0.7),
              '&:hover': {
                color: theme.palette.common.white,
                bgcolor: alpha(theme.palette.primary.main, 0.18)
              }
            }}
          >
            {bannerOpen ? (
              <CloseOutlined style={{ fontSize: '0.85rem' }} />
            ) : (
              <DownOutlined style={{ fontSize: '0.85rem' }} />
            )}
          </IconButton>
        </Stack>
        <Collapse in={bannerOpen} unmountOnExit>
          <Box sx={{ px: 2.25, pb: 2, pl: 5.25 }}>
            <Typography sx={{ color: alpha(theme.palette.common.white, 0.78), fontSize: '0.88rem', lineHeight: 1.6 }}>
              Comparing{' '}
              <Box component="span" sx={{ fontWeight: 700, color: theme.palette.common.white }}>
                predicted vs. observed
              </Box>{' '}
              shows how accurate the model is on real outcomes. It surfaces fields where predictions diverge from reality, which usually
              signals unusual conditions, data quality issues, or model blind spots, and it builds trust in the forecast for in-progress
              fields that haven't been harvested yet.
            </Typography>
          </Box>
        </Collapse>
      </Paper>
      )}

      <Paper
        variant="outlined"
        sx={{
          // Match the Deep-Learning-pill / metric-tile palette so the table
          // card reads as part of the same "primary" family of surfaces
          // (Overview metric tiles, Coverage card, Why Predict banner).
          bgcolor: alpha(theme.palette.primary.main, 0.18),
          borderColor: alpha(theme.palette.primary.main, 0.5),
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.35)}`
        }}
      >
        <Stack
          direction="row"
          sx={{
            px: 2.5,
            py: 1.75,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            flexWrap: 'wrap',
            gap: 1
          }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, color: theme.palette.text.primary, letterSpacing: '0.01em' }}>
              Field &amp; Harvest Records
            </Typography>
            {showModelSelector && availableModels.length > 0 ? (
              <Button
                ref={modelButtonRef}
                size="small"
                onClick={handleOpenModelMenu}
                endIcon={<DownOutlined style={{ fontSize: '0.7rem' }} />}
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.72rem',
                  letterSpacing: '0.02em',
                  minHeight: 0,
                  whiteSpace: 'nowrap',
                  py: 0.3,
                  px: 1.25,
                  borderRadius: 999,
                  color: modelPalette.fg,
                  bgcolor: modelPalette.bg,
                  border: `1px solid ${modelPalette.border}`,
                  transition: 'background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, color 0.18s ease',
                  '&:hover': {
                    color: theme.palette.common.white,
                    bgcolor: modelPalette.hoverBg,
                    borderColor: modelPalette.hoverBorder,
                    boxShadow: `0 0 0 2px ${alpha(modelPalette.dot, 0.18)}`
                  }
                }}
              >
                {modelLabel}
              </Button>
            ) : null}
          </Stack>
          <Typography variant="body2" sx={{ color: alpha(theme.palette.primary.light, 0.85), fontWeight: 500 }}>
            {totalRows.toLocaleString()} record{totalRows === 1 ? '' : 's'}
          </Typography>
        </Stack>

        {/* Filters live permanently above the table now (no Collapse
            toggle). The previous toggleable filters used to expose a
            sticky-header bleed-through bug when collapsed; keeping the
            filters always rendered both simplifies the UX and ensures
            the head sits cleanly anchored. */}
        <Box
          sx={{
            px: 2.5,
            py: 2,
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            bgcolor: alpha(theme.palette.background.paper, 0.4)
          }}
        >
          <Stack direction="row" sx={{ width: '100%', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          value={filters.crop}
          onChange={(event) => handleFilterChange('crop', event.target.value)}
          disabled={isFilterOptionsLoading}
          sx={[filterFieldSx, { minWidth: { xs: '100%', sm: 180 }, flex: '1 1 180px' }]}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => (selected ? formatCropName(selected) : 'All crops'),
            MenuProps: filterMenuProps
          }}
        >
          <MenuItem value="">All crops</MenuItem>
          {cropOptions.map((crop) => (
            <MenuItem key={crop} value={crop}>
              {formatCropName(crop)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          value={filters.variety}
          onChange={(event) => handleFilterChange('variety', event.target.value)}
          disabled={!filters.crop || isVarietyLoading}
          sx={[filterFieldSx, { minWidth: { xs: '100%', sm: 180 }, flex: '1 1 180px' }]}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => selected || 'All varieties',
            MenuProps: filterMenuProps
          }}
        >
          <MenuItem value="">All varieties</MenuItem>
          {varietyOptions.map((variety) => (
            <MenuItem key={variety} value={variety}>
              {variety}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          value={filters.season}
          onChange={(event) => handleFilterChange('season', event.target.value)}
          disabled={isFilterOptionsLoading}
          sx={[filterFieldSx, { minWidth: { xs: '100%', sm: 140 }, flex: '1 1 140px' }]}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => (selected ? String(selected) : 'All seasons'),
            MenuProps: filterMenuProps
          }}
        >
          <MenuItem value="">All seasons</MenuItem>
          {seasonOptions.map((season) => (
            <MenuItem key={season} value={String(season)}>
              {season}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          value={filters.state}
          onChange={(event) => handleFilterChange('state', event.target.value)}
          disabled={isFilterOptionsLoading}
          sx={[filterFieldSx, { minWidth: { xs: '100%', sm: 160 }, flex: '1 1 160px' }]}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => selected || 'All states',
            MenuProps: filterMenuProps
          }}
        >
          <MenuItem value="">All states</MenuItem>
          {stateOptions.map((state) => (
            <MenuItem key={state} value={state}>
              {state}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          value={filters.county}
          onChange={(event) => handleFilterChange('county', event.target.value)}
          disabled={!filters.state || isCountyLoading}
          sx={[filterFieldSx, { minWidth: { xs: '100%', sm: 160 }, flex: '1 1 160px' }]}
          SelectProps={{
            displayEmpty: true,
            renderValue: (selected) => selected || 'All counties',
            MenuProps: filterMenuProps
          }}
        >
          <MenuItem value="">All counties</MenuItem>
          {countyOptions.map((county) => (
            <MenuItem key={county} value={county}>
              {county}
            </MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          onClick={clearAllFilters}
          disabled={!hasActiveFilters || isLoading}
          sx={{
            borderColor: accentBlue,
            color: theme.palette.primary.light,
            bgcolor: alpha(theme.palette.primary.main, 0.08),
            minWidth: 120,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            ml: { lg: 'auto' },
            // Disabled state stays in the primary-blue family (instead of
            // MUI's neutral gray) so the toolbar reads as cohesive when
            // there's nothing to clear.
            '&.Mui-disabled': {
              bgcolor: alpha(theme.palette.primary.main, 0.04),
              color: alpha(theme.palette.primary.light, 0.4),
              borderColor: alpha(theme.palette.primary.main, 0.18)
            },
            '&:hover': {
              borderColor: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.2),
              boxShadow: `0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`
            }
          }}
        >
          Clear Filters
        </Button>
          </Stack>
        </Box>

        {/* Pure stale-while-revalidate: no loading bar above the table.
            Filter / page / model changes keep the previous rows on
            screen and silently swap them when the new response lands.
            The empty-body row inside the TableBody (gated on
            `isLoading && visibleRows.length === 0`) handles the very
            first paint and the empty-result cases, so the bar above
            was redundant — and worse, it flashed whenever a filter
            change followed a zero-result state (rows.length === 0
            + isLoading=true momentarily satisfied the old condition).
            Removing it eliminates that flash entirely. */}

        <TableContainer
          sx={{
            maxHeight: { xs: 420, md: 500 },
            ...tableScrollbarSx
          }}
        >
          <Table
            size="small"
            stickyHeader
            sx={{
              minWidth: 1100,
              '& .MuiTableCell-root': { textAlign: 'center !important', whiteSpace: 'nowrap' }
            }}
          >
            <TableHead>
              <TableRow
                sx={{
                  '& .MuiTableCell-root': {
                    // Equivalent to alpha(primary.main, 0.08) but fully opaque, so
                    // rows can't bleed through the sticky header while scrolling.
                    bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
                    borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
                    color: alpha(theme.palette.primary.light, 0.85),
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    py: 1.25,
                    textAlign: 'center'
                  },
                  // Force the TableSortLabel itself to occupy the full cell width
                  // and center its content. Without this, MUI's inline-flex
                  // TableSortLabel renders only as wide as label + (hidden) icon,
                  // and the reserved icon space pushes the visible label off-center.
                  '& .MuiTableSortLabel-root': {
                    color: `${alpha(theme.palette.primary.light, 0.85)} !important`,
                    width: '100%',
                    justifyContent: 'center'
                  },
                  '& .MuiTableSortLabel-root:hover, & .MuiTableSortLabel-root.Mui-active': {
                    color: `${theme.palette.primary.light} !important`
                  },
                  // When a column isn't actively sorted, collapse the icon's
                  // width so it doesn't shove the label off-center. When active,
                  // restore natural width so the asc/desc arrow can show.
                  '& .MuiTableSortLabel-root:not(.Mui-active) .MuiTableSortLabel-icon': {
                    width: 0,
                    marginLeft: 0,
                    marginRight: 0,
                    opacity: 0
                  },
                  '& .MuiTableSortLabel-icon': {
                    color: `${alpha(theme.palette.primary.light, 0.85)} !important`
                  }
                }}
              >
                {columns
                  .filter((column) => showPredictedYieldColumn || column.id !== 'predictedYield')
                  .map((column) => (
                    <TableCell key={column.id} sortDirection={orderBy === column.id ? order : false}>
                      <TableSortLabel
                        active={orderBy === column.id}
                        direction={orderBy === column.id ? order : 'asc'}
                        onClick={() => handleRequestSort(column.id)}
                      >
                        {column.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
              </TableRow>
            </TableHead>

            <TableBody>
              {visibleRows.map((row) => {
                const mutedAccent = alpha(theme.palette.primary.light, 0.85);
                const subtleText = theme.palette.text.secondary;
                const hasObservedYield = typeof row.observedYield === 'number' && Number.isFinite(row.observedYield);
                const hasPredictedYield = typeof row.predictedYield === 'number' && Number.isFinite(row.predictedYield);
                const hasConfidence =
                  typeof row.confidenceLower === 'number' &&
                  typeof row.confidenceUpper === 'number' &&
                  Number.isFinite(row.confidenceLower) &&
                  Number.isFinite(row.confidenceUpper);
                // Row click → opens the detail drawer. Gated on both
                // (a) the row having a real field_season_id (some
                // legacy rows don't), and (b) the parent allowing the
                // chevron — when chevron is hidden the row click is
                // suppressed too, since clickable-without-affordance is
                // a discoverability footgun.
                const isClickable =
                  showChevron && row.fieldSeasonId !== null && row.fieldSeasonId !== undefined;
                return (
                  <TableRow
                    key={row.rowId}
                    hover
                    onClick={isClickable ? () => setSelectedFieldSeasonId(row.fieldSeasonId) : undefined}
                    sx={{
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'background 0.15s ease',
                      '& .MuiTableCell-root': {
                        borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`
                      },
                      // Idle chevron sits faint; on hover we brighten and
                      // slide it slightly to suggest "click to open".
                      '& .row-chevron': {
                        color: alpha(theme.palette.primary.light, 0.45),
                        transition: 'color 0.15s ease, transform 0.15s ease, opacity 0.15s ease',
                        opacity: 0.7
                      },
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.16),
                        boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}`
                      },
                      '&:hover .row-chevron': {
                        color: theme.palette.primary.light,
                        transform: 'translateY(-50%) translateX(2px)',
                        opacity: 1
                      }
                    }}
                  >
                    <TableCell sx={{ color: mutedAccent, fontWeight: 600 }}>{row.fieldId}</TableCell>
                    <TableCell>{formatCropName(row.crop)}</TableCell>
                    <TableCell>
                      <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: 'baseline', justifyContent: 'center' }}>
                        <Typography component="span" sx={{ fontSize: 'inherit' }}>
                          {formatMetric(row.acres, 2)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          ac
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{row.variety}</TableCell>
                    <TableCell sx={{ color: mutedAccent }}>{row.season}</TableCell>
                    <TableCell sx={{ color: mutedAccent }}>{row.location}</TableCell>
                    <TableCell>
                      {hasObservedYield ? (
                        <Stack component="span" direction="row" spacing={0.75} sx={{ alignItems: 'baseline', justifyContent: 'center' }}>
                          <Typography component="span" sx={{ color: theme.palette.success.main, fontWeight: 700, fontSize: '0.9rem' }}>
                            {formatMetric(row.observedYield)}
                          </Typography>
                          <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                            bu/ac
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography component="span" sx={{ color: subtleText }}>—</Typography>
                      )}
                    </TableCell>
                    {showPredictedYieldColumn ? (
                      <TableCell>
                        {hasPredictedYield ? (
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline' }}>
                              <Typography
                                component="span"
                                sx={{ color: alpha(theme.palette.primary.light, 0.95), fontWeight: 700, fontSize: '0.9rem' }}
                              >
                                {formatMetric(row.predictedYield)}
                              </Typography>
                              <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                                bu/ac
                              </Typography>
                            </Stack>
                            <YieldDeltaChip predicted={row.predictedYield} observed={row.observedYield} />
                          </Stack>
                        ) : (
                          <Typography component="span" sx={{ color: subtleText }}>—</Typography>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: 'baseline', justifyContent: 'center' }}>
                        <Typography
                          component="span"
                          sx={{ color: alpha(theme.palette.info.light, 0.9), fontWeight: 600, fontSize: 'inherit' }}
                        >
                          {formatMetric(row.n)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          lb/ac
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: 'baseline', justifyContent: 'center' }}>
                        <Typography
                          component="span"
                          sx={{ color: alpha(theme.palette.warning.light, 0.9), fontWeight: 600, fontSize: 'inherit' }}
                        >
                          {formatMetric(row.p)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          lb/ac
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ position: 'relative' }}>
                      <Stack component="span" direction="row" spacing={0.5} sx={{ alignItems: 'baseline', justifyContent: 'center' }}>
                        <Typography
                          component="span"
                          sx={{ color: alpha(theme.palette.error.light, 0.9), fontWeight: 600, fontSize: 'inherit' }}
                        >
                          {formatMetric(row.k)}
                        </Typography>
                        <Typography component="span" sx={{ color: subtleText, fontSize: '0.72rem' }}>
                          lb/ac
                        </Typography>
                      </Stack>
                      {/* Affordance chevron — absolutely positioned so it
                          floats over the right edge of the row without
                          claiming any column width. Because the headers are
                          centered via TableSortLabel width: 100% +
                          justifyContent: center, the chevron has no effect
                          on header alignment. */}
                      {isClickable ? (
                        <Box
                          className="row-chevron"
                          aria-hidden
                          sx={{
                            position: 'absolute',
                            right: 8,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            pointerEvents: 'none'
                          }}
                        >
                          <RightOutlined />
                        </Box>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    {/* Empty state — phrased differently depending on whether
                        any filters are active, so the user can tell "the
                        filter knocked everything out" apart from "there's
                        nothing in the system yet". */}
                    {hasActiveFilters ? (
                      <Stack spacing={0.5} sx={{ alignItems: 'center', py: 2 }}>
                        <Typography sx={{ color: alpha(theme.palette.common.white, 0.85), fontWeight: 600, fontSize: '0.9rem' }}>
                          No matches for the current filters
                        </Typography>
                        <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                          Try clearing one or more filters above to widen the search.
                        </Typography>
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: 'center' }}>
                        No field-season records found.
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ) : null}
              {isLoading && visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      Loading field records for selected filters...
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>

        <Stack
          direction="row"
          sx={{
            px: 2.5,
            py: 1.75,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            flexWrap: 'wrap',
            gap: 1.25
          }}
        >
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            {isLoading && sortedRows.length === 0
              ? 'Loading records...'
              : `${sortedRows.length.toLocaleString()} shown on page ${page + 1} · ${totalRows.toLocaleString()} total`}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<DownloadOutlined />}
            onClick={handleDownload}
            disabled={isDownloading || isLoading}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.78rem',
              letterSpacing: '0.02em',
              borderRadius: 999,
              py: 0.5,
              px: 1.75,
              color: alpha(theme.palette.primary.light, 0.95),
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: alpha(theme.palette.primary.main, 0.4),
              transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease',
              '&:hover': {
                color: theme.palette.common.white,
                bgcolor: alpha(theme.palette.primary.main, 0.22),
                borderColor: theme.palette.primary.main
              },
              '&.Mui-disabled': {
                color: alpha(theme.palette.common.white, 0.4),
                bgcolor: alpha(theme.palette.primary.main, 0.06),
                borderColor: alpha(theme.palette.primary.main, 0.18)
              }
            }}
          >
            {isDownloading ? 'Downloading...' : downloadLabel}
          </Button>
        </Stack>
      </Paper>

      <TablePagination
        component="div"
        count={totalRows}
        page={page}
        onPageChange={handleChangePage}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        rowsPerPageOptions={[25, 50, 100, 250, 500]}
        sx={{ mt: -0.75 }}
      />


      <FieldDetailDrawer
        fieldSeasonId={selectedFieldSeasonId}
        onClose={() => setSelectedFieldSeasonId(null)}
        availableModels={availableModels}
        selectedModelId={selectedModelId}
        onModelChange={setSelectedModelId}
      />

      {/* Top-level Menu — anchored to the button via a ref (always points to the
          live DOM node), opened by an independent boolean state. This decoupled
          pattern is the most robust against re-render edge-cases that could
          otherwise leave Popper holding a stale anchor. */}
      <Menu
        anchorEl={modelButtonRef.current}
        open={modelMenuOpen}
        onClose={handleCloseModelMenu}
        slotProps={{
          paper: {
            sx: {
              bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 8%, ${theme.palette.background.paper})`,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.32)}`,
              borderRadius: 1.25,
              backgroundImage: 'none',
              mt: 0.5,
              '& .MuiMenuItem-root': {
                color: alpha(theme.palette.common.white, 0.88),
                fontSize: '0.85rem',
                minHeight: 32,
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.16) },
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.24),
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.32) }
                }
              }
            }
          }
        }}
      >
        {availableModels.map((model) => {
          const itemPalette = getModelChipPalette(model.model_type, theme);
          return (
            <MenuItem
              key={model.model_version_id}
              selected={selectedModelId === model.model_version_id}
              onClick={() => handleSelectModel(model.model_version_id)}
            >
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: itemPalette.dot,
                  mr: 1.25,
                  display: 'inline-block',
                  flexShrink: 0
                }}
              />
              {getModelDisplayName(model.model_type, model.version_tag)}
            </MenuItem>
          );
        })}
      </Menu>
    </Stack>
  );
}
