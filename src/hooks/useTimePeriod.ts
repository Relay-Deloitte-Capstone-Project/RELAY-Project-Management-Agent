export type Period = "dawn" | "day" | "evening" | "night";

export function periodForHour(hour: number): Period {
  if (hour >= 5 && hour < 9) return "dawn";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "evening";
  return "night";
}

export function useTimePeriod(): Period {
  return periodForHour(new Date().getHours());
}

export const periodConfig = {
  dawn: {
    label: "Good morning",
    greeting: "Rise and shine",
    // Darkened from the raw palette's Accent (#C17F59) — this renders as
    // text on its own translucent accentSoft pill, which needs 4.5:1.
    accent: "#8F5E42",
    accentSoft: "rgba(143,94,66,0.12)",
    isDark: false,
  },
  day: {
    label: "Afternoon",
    greeting: "Sunshine",
    accent: "#376EA6",
    accentSoft: "rgba(55,110,166,0.10)",
    isDark: false,
  },
  evening: {
    label: "Evening",
    greeting: "Winding down",
    accent: "#A64D2E",
    accentSoft: "rgba(166,77,46,0.15)",
    isDark: false,
  },
  night: {
    label: "Night",
    greeting: "Late night",
    accent: "#8AB4C7",
    accentSoft: "rgba(138,180,199,0.10)",
    isDark: true,
  },
} satisfies Record<
  Period,
  { label: string; greeting: string; accent: string; accentSoft: string; isDark: boolean }
>;
