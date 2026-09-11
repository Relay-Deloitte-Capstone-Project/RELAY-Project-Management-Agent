import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel } from "@/components/relay/primitives";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type PersonRow = { assignee: string; to_do: number; in_progress: number; done: number };

type BreakdownResponse = {
  sprint: { id: number; name: string } | null;
  breakdown: PersonRow[];
};

// Sprint-level status counts only — no velocity, no completion ratio, no
// sort-by-workload ordering, no "behind schedule" flag on any individual.
// Those are all explicitly out of scope for this view (see
// backend/api/analytics.py).
export function EmployeeBreakdown({ sprintId }: { sprintId?: number | undefined }) {
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const query = sprintId !== undefined ? `?sprint_id=${sprintId}` : "";
        const res = await fetch(`${API_URL}/api/analytics/employee-breakdown${query}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json: BreakdownResponse = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load breakdown data.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick, sprintId]);

  if (error) {
    return (
      <Panel title="Team breakdown">
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
      <Panel title="Team breakdown">
        <p className="text-[13px] text-mute">Loading…</p>
      </Panel>
    );
  }

  if (!data.sprint || data.breakdown.length === 0) {
    return (
      <Panel title="Team breakdown">
        <p className="text-[13px] text-mute">No sprint data to show.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Team breakdown"
      action={<span className="text-[11px] text-mute">{data.sprint.name}</span>}
    >
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.breakdown}
            layout="vertical"
            margin={{ top: 8, right: 12, left: 8, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "var(--mute)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="assignee"
              tick={{ fontSize: 11, fill: "var(--foreground)" }}
              axisLine={false}
              tickLine={false}
              width={110}
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
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="to_do" name="To do" stackId="s" fill="var(--mute)" />
            <Bar dataKey="in_progress" name="In progress" stackId="s" fill="var(--warning)" />
            <Bar dataKey="done" name="Done" stackId="s" fill="var(--success)" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
