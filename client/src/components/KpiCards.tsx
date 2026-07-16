import { Kpis } from '../api';

interface KpiCardsProps {
  kpis: Kpis;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

export function KpiCards({ kpis }: KpiCardsProps) {
  const items = [
    { title: 'Closed Won', value: formatCurrency(kpis.closedWon), subtitle: 'Captured actuals' },
    { title: 'Open Pipeline', value: formatCurrency(kpis.openPipeline), subtitle: 'Forecast still active' },
    { title: 'To-Go Revenue', value: formatCurrency(kpis.toGoRevenue), subtitle: `Margin ${kpis.marginPct.toFixed(1)}%` }
  ];

  return (
    <div className="kpi-grid">
      {items.map((item) => (
        <div className="card" key={item.title}>
          <div className="muted">{item.title}</div>
          <div className="kpi-value">{item.value}</div>
          <div className="muted">{item.subtitle}</div>
        </div>
      ))}
    </div>
  );
}
