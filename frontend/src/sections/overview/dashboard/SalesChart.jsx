import { useEffect, useMemo, useState } from 'react';

// material-ui
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

import { BarChart } from '@mui/x-charts';

// project imports
import MainCard from 'components/MainCard';
import { withAlpha } from 'utils/colorUtils';

// ==============================|| SALES COLUMN CHART ||============================== //

export default function SalesChart() {
  const theme = useTheme();
  const downSM = useMediaQuery(theme.breakpoints.down('sm'));
  const valueFormatter = (value) => `$ ${value} Thousands`;
  const primaryColor = theme.vars.palette.primary.main;
  const primaryLightColor = theme.vars.palette.primary.lighter;
  const warningColor = theme.vars.palette.warning.main;
  const warningLightColor = theme.vars.palette.warning.lighter;

  const labels = ['07.06', '08.06', '09.06', '10.06', '11.06', '12.06', '13.06'];

  const initialSeries = [
    { id: 'Income', data: [180, 90, 135, 114, 120, 200, 145], stack: 'income', label: 'Income', color: warningColor, valueFormatter },
    { id: 'Income2', data: [20, 110, 65, 86, 80, 0, 55], stack: 'income', label: 'Income', color: warningLightColor, valueFormatter },
    {
      id: 'CostOfSales',
      data: [120, 45, 78, 150, 168, 145, 99],
      stack: 'cos',
      label: 'Cost of Sales',
      color: primaryColor,
      valueFormatter
    },
    {
      id: 'CostOfSales2',
      data: [80, 155, 122, 50, 32, 55, 101],
      stack: 'cos',
      label: 'Cost of Sales',
      color: primaryLightColor,
      valueFormatter
    }
  ];

  const initialSeriesCopy = [...initialSeries.slice(0, 1), ...initialSeries.slice(2, 3)];
  const [seriesVisibility, setSeriesVisibility] = useState({
    Income: true,
    'Cost of Sales': true
  });

  const [highlightedItem, setHighlightedItem] = useState(null);

  const toggleSeriesVisibility = (seriesLabel) => {
    setSeriesVisibility((prev) => ({ ...prev, [seriesLabel]: !prev[seriesLabel] }));
  };

  const handleHighlight = (seriesId) => {
    if (seriesId) {
      setHighlightedItem({ seriesId });
    } else {
      setHighlightedItem(null);
    }
  };

  return (
    <MainCard sx={{ mt: 1 }} content={false}>
      <Box sx={{ p: 2.5, pb: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }} color="text.secondary" gutterBottom>
              Net Profit
            </Typography>
            <Typography variant="h4">$1560</Typography>
          </Box>

          <Stack direction="row" sx={{ gap: 3 }}>
            {initialSeriesCopy.map((series) => (
              <Stack
                key={series.label}
                direction="row"
                onClick={() => toggleSeriesVisibility(series.label)}
                onMouseEnter={() => handleHighlight(series.id)}
                onMouseLeave={() => handleHighlight(null)}
                sx={{
                  gap: 1,
                  alignItems: 'center',
                  opacity: seriesVisibility[series.label] ? 1 : 0.45,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s ease-in-out'
                }}
              >
                <Box sx={{ height: 10, width: 10, borderRadius: '50%', backgroundColor: series.color }} />
                <Typography>{series.label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>

        <BarChart
          hideLegend
          height={380}
          grid={{ horizontal: true }}
          xAxis={[
            {
              id: 'sales-x-axis',
              data: labels,
              tickSize: 7,
              disableLine: true,
              categoryGapRatio: downSM ? 0.5 : 0.7,
              barGapRatio: downSM ? 0.4 : 0.7
            }
          ]}
          yAxis={[{ disableLine: true, tickSize: 7, tickMaxStep: 50 }]}
          series={initialSeries
            .map((series) => ({ ...series, type: 'bar', color: withAlpha(series.color, 0.85), visible: seriesVisibility[series.label] }))
            .filter((series) => series.visible)}
          highlightedItem={highlightedItem}
          slotProps={{ bar: { rx: 4, ry: 4 }, tooltip: { trigger: 'item' } }}
          axisHighlight={{ x: 'none' }}
          margin={{ top: 30, left: -5, bottom: 25, right: 10 }}
          sx={{
            '& .MuiBarElement-root:hover': { opacity: 0.6 },
            '& .MuiChartsGrid-line': { strokeDasharray: '4 4', stroke: theme.vars.palette.divider },
            '& .MuiBarElement-series-auto-generated-id-0, & .MuiBarElement-series-auto-generated-id-1': { width: 15 },
            '& .MuiChartsAxis-root.MuiChartsAxis-directionX .MuiChartsAxis-tick': { stroke: 'transparent' },
            '& .MuiChartsAxis-root.MuiChartsAxis-directionY .MuiChartsAxis-tick': { stroke: 'transparent' }
          }}
        />
      </Box>
    </MainCard>
  );
}

export function ReusableSalesChart({
  title = 'Market Trend',
  headline = '—',
  subtitle = '',
  labels = [],
  series = [],
  height = 320,
  valueFormatter = (value) => `$ ${value}`
}) {
  const theme = useTheme();
  const downSM = useMediaQuery(theme.breakpoints.down('sm'));

  const defaultLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const chartLabels = labels.length > 0 ? labels : defaultLabels;

  const fallbackSeries = [
    {
      id: 'CashPrice',
      label: 'Cash Price',
      data: [5.86, 5.81, 5.79, 5.88, 5.92, 5.9, 5.94],
      color: theme.vars.palette.warning.main
    },
    {
      id: 'Futures',
      label: 'Futures',
      data: [5.72, 5.7, 5.68, 5.75, 5.77, 5.76, 5.8],
      color: theme.vars.palette.primary.main
    }
  ];

  const chartSeries = series.length > 0 ? series : fallbackSeries;

  const legendSeries = useMemo(() => {
    const byLabel = new Map();
    chartSeries.forEach((item) => {
      if (!byLabel.has(item.label)) {
        byLabel.set(item.label, item);
      }
    });
    return Array.from(byLabel.values());
  }, [chartSeries]);

  const [seriesVisibility, setSeriesVisibility] = useState({});
  const [highlightedItem, setHighlightedItem] = useState(null);

  useEffect(() => {
    setSeriesVisibility((prev) => {
      const next = {};
      legendSeries.forEach((item) => {
        next[item.label] = prev[item.label] ?? true;
      });
      return next;
    });
  }, [legendSeries]);

  const toggleSeriesVisibility = (seriesLabel) => {
    setSeriesVisibility((prev) => ({ ...prev, [seriesLabel]: !prev[seriesLabel] }));
  };

  const handleHighlight = (seriesId) => {
    if (seriesId) {
      setHighlightedItem({ seriesId });
    } else {
      setHighlightedItem(null);
    }
  };

  return (
    <MainCard sx={{ mt: 1 }} content={false}>
      <Box sx={{ p: 2.5, pb: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography sx={{ fontSize: 14 }} color="text.secondary" gutterBottom>
              {title}
            </Typography>
            <Typography variant="h4">{headline}</Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            ) : null}
          </Box>

          <Stack direction="row" sx={{ gap: 3 }}>
            {legendSeries.map((chartItem) => (
              <Stack
                key={chartItem.id || chartItem.label}
                direction="row"
                onClick={() => toggleSeriesVisibility(chartItem.label)}
                onMouseEnter={() => handleHighlight(chartItem.id)}
                onMouseLeave={() => handleHighlight(null)}
                sx={{
                  gap: 1,
                  alignItems: 'center',
                  opacity: seriesVisibility[chartItem.label] !== false ? 1 : 0.45,
                  cursor: 'pointer',
                  transition: 'opacity 0.2s ease-in-out'
                }}
              >
                <Box sx={{ height: 10, width: 10, borderRadius: '50%', backgroundColor: chartItem.color }} />
                <Typography>{chartItem.label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>

        <BarChart
          hideLegend
          height={height}
          grid={{ horizontal: true }}
          xAxis={[
            {
              id: 'market-x-axis',
              data: chartLabels,
              tickSize: 7,
              disableLine: true,
              categoryGapRatio: downSM ? 0.45 : 0.65,
              barGapRatio: downSM ? 0.35 : 0.6
            }
          ]}
          yAxis={[{ disableLine: true, tickSize: 7 }]}
          series={chartSeries
            .filter((item) => seriesVisibility[item.label] !== false)
            .map((item) => ({
              ...item,
              type: 'bar',
              valueFormatter,
              color: withAlpha(item.color, 0.85)
            }))}
          highlightedItem={highlightedItem}
          slotProps={{ bar: { rx: 4, ry: 4 }, tooltip: { trigger: 'item' } }}
          axisHighlight={{ x: 'none' }}
          margin={{ top: 30, left: 10, bottom: 25, right: 10 }}
          sx={{
            '& .MuiBarElement-root:hover': { opacity: 0.6 },
            '& .MuiChartsGrid-line': { strokeDasharray: '4 4', stroke: theme.vars.palette.divider },
            '& .MuiChartsAxis-root.MuiChartsAxis-directionX .MuiChartsAxis-tick': { stroke: 'transparent' },
            '& .MuiChartsAxis-root.MuiChartsAxis-directionY .MuiChartsAxis-tick': { stroke: 'transparent' }
          }}
        />
      </Box>
    </MainCard>
  );
}
