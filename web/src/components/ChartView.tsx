import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TickRecord } from '@/sim/simulation'

interface ChartViewProps {
  records: TickRecord[]
}

const AXIS_STYLE = { fontSize: 11, fill: '#9ca3af' } as const
const TOOLTIP_STYLE = {
  contentStyle: {
    background: '#1a2230',
    border: '1px solid #2a3445',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
  },
  cursor: { stroke: '#5ec9f5', strokeOpacity: 0.4, strokeWidth: 1 },
} as const

export function ChartView({ records }: ChartViewProps) {
  // Trim to last 365 days for performance / readability.
  const data = records.slice(-365)

  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-2 p-3">
      <Panel title="Infections">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2a3445" strokeDasharray="2 4" />
            <XAxis dataKey="tick" stroke="#9ca3af" tick={AXIS_STYLE} />
            <YAxis stroke="#9ca3af" tick={AXIS_STYLE} width={50} />
            <RTooltip {...TOOLTIP_STYLE} />
            <Line
              dataKey="susceptible"
              stroke="#9e9e9e"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Sus"
            />
            <Line
              dataKey="exposed"
              stroke="#f39c12"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Exp"
            />
            <Line
              dataKey="infectiousAsymptomatic"
              stroke="#f1c40f"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Asy"
            />
            <Line
              dataKey="infectiousSymptomatic"
              stroke="#e74c3c"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Sym"
            />
            <Line
              dataKey="recovered"
              stroke="#2ecc71"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Rec"
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="GDP">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2a3445" strokeDasharray="2 4" />
            <XAxis dataKey="tick" stroke="#9ca3af" tick={AXIS_STYLE} />
            <YAxis
              stroke="#9ca3af"
              tick={AXIS_STYLE}
              width={50}
              tickFormatter={(v: number) =>
                v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}k`
              }
            />
            <RTooltip {...TOOLTIP_STYLE} />
            <Line
              dataKey="gdp"
              stroke="#5ec9f5"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Hospital %">
        <ResponsiveContainer>
          <LineChart
            data={data.map((d) => ({
              tick: d.tick,
              pct:
                (d.healthcarePatients / Math.max(1, d.healthcareCapacity)) * 100,
            }))}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke="#2a3445" strokeDasharray="2 4" />
            <XAxis dataKey="tick" stroke="#9ca3af" tick={AXIS_STYLE} />
            <YAxis
              stroke="#9ca3af"
              tick={AXIS_STYLE}
              width={40}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <RTooltip {...TOOLTIP_STYLE} />
            <Line
              dataKey="pct"
              stroke="#e74c3c"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Wealth">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2a3445" strokeDasharray="2 4" />
            <XAxis dataKey="tick" stroke="#9ca3af" tick={AXIS_STYLE} />
            <YAxis
              stroke="#9ca3af"
              tick={AXIS_STYLE}
              width={50}
              tickFormatter={(v: number) =>
                v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
              }
            />
            <RTooltip {...TOOLTIP_STYLE} />
            <Line
              dataKey="meanWallet"
              stroke="#5ec9f5"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Mean"
            />
            <Line
              dataKey="medianWallet"
              stroke="#2ecc71"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Median"
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-border bg-card/60">
      <div className="border-b border-border px-3 py-1 text-xs font-bold uppercase tracking-wider text-accent">
        {title}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
