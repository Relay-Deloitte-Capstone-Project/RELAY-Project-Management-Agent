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

export function SprintBurndown({ sprintId }: { sprintId?: number | undefined }) {
  const [data, setData] = useState<BurndownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [zoomWeek, setZoomWeek] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const query = sprintId !== undefined ? `?sprint_id=${sprintId}` : "";
        const res = await fetch(`${API_URL}/api/analytics/burndown${query}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json: BurndownResponse = await res.json();
        if (!cancelled) {
          setData(json);
          setZoomWeek(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load burndown data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick, sprintId]);

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
        <p className="text-[13px] text-mute">No sprint data to show.</p>
      </Panel>
    );
  }

  const actualByDate = new Map(data.actual.map((p) => [p.date, p.remaining]));
  // Real remaining-count-per-day, built from each issue's actual Jira status
  // changelog (see backend/api/analytics.py) — a step function, since a
  // ticket count only moves on the day a ticket's status actually changes.
  const chartData: ChartRow[] = data.ideal.map((p) => ({
    date: p.date,
    dateLabel: formatDate(p.date),
    ideal: p.remaining,
    actual: actualByDate.get(p.date) ?? null,
  }));

  // Chunk the sprint into 7-day weeks for the zoom chips. A sprint one week
  // or shorter has nothing to zoom into, so the chip row only appears once
  // there's more than one week to pick from.
  const weeks: ChartRow[][] = [];
  for (let i = 0; i < chartData.length; i += 7) weeks.push(chartData.slice(i, i + 7));
  const visibleData = zoomWeek !== null && weeks[zoomWeek] ? weeks[zoomWeek] : chartData;
  const realDayCount = data.actual.length;

  return (
    <Panel
      title="Sprint burndown"
      action={
        <span className="text-[11px] text-mute">
          {data.sprint.name} · {data.remaining_issues}/{data.total_issues} remaining
        </span>
      }
    >
      {weeks.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setZoomWeek(null)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
              zoomWeek === null ? "bg-brand text-brand-foreground" : "bg-surface-sunken text-mute hover:text-ink"
            }`}
          >
            Full sprint
          </button>
          {weeks.map((week, i) => (
            <button
              key={week[0]?.date ?? i}
              type="button"
              onClick={() => setZoomWeek(i)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
                zoomWeek === i ? "bg-brand text-brand-foreground" : "bg-surface-sunken text-mute hover:text-ink"
              }`}
            >
              {week[0]?.dateLabel} – {week[week.length - 1]?.dateLabel}
            </button>
          ))}
        </div>
      )}
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
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
              type="stepAfter"
              dataKey="actual"
              name="Actual"
              stroke="var(--success)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--success)", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-mute">
        Dashed line is the ideal linear burn. Solid line is the real remaining-ticket count per
        day, from Jira&apos;s own status history — {realDayCount} real day{realDayCount === 1 ? "" : "s"}{" "}
        of data for this sprint so far.
      </p>
    </Panel>
  );
}
