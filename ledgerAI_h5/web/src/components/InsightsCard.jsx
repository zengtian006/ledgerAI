import { SparkleIcon } from './Icons.jsx';

const VELOCITY = {
  under_control: { label: 'Under control', color: '#34c759' },
  normal: { label: 'On track', color: '#007aff' },
  high_alert: { label: 'High alert', color: '#ff3b30' },
};
const TYPE = {
  anomaly: { icon: '⚠️', color: '#ff9500' },
  trend: { icon: '📈', color: '#007aff' },
  tip: { icon: '💡', color: '#ffcc00' },
  savings_opportunity: { icon: '💰', color: '#34c759' },
};

export default function InsightsCard({ insights, loading, onRefresh, refreshing }) {
  const v = insights && (VELOCITY[insights.spending_velocity] ?? VELOCITY.normal);
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between px-4">
        <h2 className="ios-header !p-0 flex items-center gap-1">
          <SparkleIcon width={13} height={13} className="text-ios-blue" /> AI Insights
        </h2>
        {v && (
          <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: `${v.color}1f`, color: v.color }}>
            {v.label}
          </span>
        )}
      </div>

      <div className="ios-group">
        {loading && !insights ? (
          <p className="px-4 py-3 text-[15px] text-ios-secondary">Analysing your spending…</p>
        ) : !insights ? (
          <p className="px-4 py-3 text-[15px] text-ios-secondary">Add a receipt to get your first insights.</p>
        ) : (
          <>
            <p className="px-4 py-3 text-[17px] font-semibold leading-snug">{insights.summary_headline}</p>
            {insights.key_insights.map((i, idx) => {
              const t = TYPE[i.type] ?? TYPE.tip;
              return (
                <div key={idx} className="flex gap-3 px-4 py-2.5">
                  <span className="mt-0.5 grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[7px] text-[16px]" style={{ background: t.color }}>
                    {t.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium leading-snug">{i.title}</span>
                    <span className="block text-[13px] leading-snug text-ios-secondary">{i.detail}</span>
                  </span>
                </div>
              );
            })}
            {insights.suggested_budget_adjustment && (
              <p className="bg-ios-blue/5 px-4 py-2.5 text-[13px] text-ios-blue">{insights.suggested_budget_adjustment}</p>
            )}
            <button onClick={onRefresh} disabled={refreshing} className="ios-press w-full px-4 py-2.5 text-left text-[15px] text-ios-blue disabled:opacity-40">
              {refreshing ? 'Refreshing…' : 'Refresh Insights'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
