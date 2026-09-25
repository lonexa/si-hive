import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/api-config';

interface ChartConfig {
  type: 'line' | 'bar' | 'area';
  xField: string;
  yFields: string[];
}

interface Props {
  workflowId: number;
  chartConfig?: ChartConfig;
}

interface DataPoint {
  timestamp: string;
  [key: string]: unknown;
}

export function WorkflowChart({ workflowId, chartConfig }: Props) {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/workflows/${workflowId}/data`)
      .then((res) => res.json())
      .then((json) => setData(json.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading chart data...</div>;
  }

  if (data.length < 2) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Need at least 2 data points to chart. Run the workflow a few more times.
      </div>
    );
  }

  if (!chartConfig) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No chart configuration defined for this workflow.
      </div>
    );
  }

  // Simple SVG chart since recharts may not be installed yet
  const yFields = chartConfig.yFields;
  const values = data.flatMap((d) => yFields.map((f) => Number(d[f]) || 0));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[600px]">
        {/* Y axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padding.top + chartH * (1 - t);
          const val = minVal + range * t;
          return (
            <g key={t}>
              <line x1={padding.left} y1={y} x2={padding.left + chartW} y2={y}
                stroke="currentColor" strokeOpacity={0.1} />
              <text x={padding.left - 8} y={y + 3} textAnchor="end"
                fill="currentColor" fillOpacity={0.5} fontSize={10}>
                {val.toFixed(val % 1 === 0 ? 0 : 2)}
              </text>
            </g>
          );
        })}

        {/* Lines */}
        {yFields.map((field, fi) => {
          const points = data.map((d, i) => {
            const x = padding.left + (i / (data.length - 1)) * chartW;
            const v = Number(d[field]) || 0;
            const y = padding.top + chartH * (1 - (v - minVal) / range);
            return `${x},${y}`;
          });
          return (
            <polyline
              key={field}
              points={points.join(' ')}
              fill="none"
              stroke={colors[fi % colors.length]}
              strokeWidth={2}
            />
          );
        })}

        {/* X axis labels (first, middle, last) */}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => {
          if (!data[i]) return null;
          const x = padding.left + (i / (data.length - 1)) * chartW;
          const label = new Date(data[i].timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <text key={i} x={x} y={height - 8} textAnchor="middle"
              fill="currentColor" fillOpacity={0.5} fontSize={10}>
              {label}
            </text>
          );
        })}

        {/* Legend */}
        {yFields.map((field, fi) => (
          <g key={field} transform={`translate(${padding.left + fi * 100}, ${height - 22})`}>
            <rect width={8} height={8} rx={1} fill={colors[fi % colors.length]} />
            <text x={12} y={8} fill="currentColor" fillOpacity={0.7} fontSize={10}>{field}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
