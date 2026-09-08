import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "@/components/relay/primitives";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type BurndownPoint = { date: string; remaining: number };

type BurndownResponse = {
  sprint: { id: number; name: string; state: string; start: string; end: string } | null;
  total_issues: number;
  remaining_issues: number;
  ideal: BurndownPoint[];
  actual: BurndownPoint[];
};

type ChartRow = { date: string; dateLabel: string; ideal: number; actual: number | null };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SprintBurndown() {
  const [data, setData] = useState<BurndownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`${API_URL}/api/analytics/burndown`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json: BurndownResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load burndown data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  if (error) {
    return (
      <Panel title="Sprint burndown">
        <p className="text-[13px] text-danger">{error}</p>
        <button
          type="button"
          onClick={() => setRetryTick((t) => t + 1)}
          className="mt-2 text-[12px] font-medium text-brand hover:underline"
        >
          Retry
        </button>
      </Panel>
    );
  }

  if (!data) {
    return (
      <Panel title="Sprint burndown">
        <p className="text-[13px] text-mute">Loading…</p>
      </Panel>
    );
  }

  if (!data.sprint) {
    return (
      <Panel title="Sprint burndown">
        <p className="text-[13px] text-mute">No active sprint on the board right now.</p>
      </Panel>
    );
  }

  const actualByDate = new Map(data.actual.map((p) => [p.date, p.remaining]));
  // Single real data point, deliberately — no changelog ingestion means no
  // history of remaining-count-per-day, so only "today" is genuinely known;
  // a fabricated daily-actual series would misrepresent that (see
  // backend/api/analytics.py). It still overlays on the same ideal-line
  // chart as one dot, rather than a second disconnected chart.
  const chartData: ChartRow[] = data.ideal.map((p) => ({
    date: p.date,
    dateLabel: formatDate(p.date),
    ideal: p.remaining,
    actual: actualByDate.get(p.date) ?? null,
  }));

  return (
    <Panel
      title="Sprint burndown"
      action={
        <span className="text-[11px] text-mute">
          {data.sprint.name} · {data.remaining_issues}/{data.total_issues} remaining
        </span>
      }
    >
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: "var(--mute)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--mute)" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--foreground)" }}
            />
            <Line
              type="monotone"
              dataKey="ideal"
              name="Ideal"
              stroke="var(--mute)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual"
              stroke="var(--success)"
              strokeWidth={0}
              dot={{ r: 5, fill: "var(--success)", strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-mute">
        Dashed line is the ideal linear burn. The dot is today&apos;s real remaining-ticket count
        — there&apos;s no daily history to plot a full actual line yet.
      </p>
    </Panel>
  );
}
