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
    accent: "#C084FC",
    accentSoft: "rgba(192,132,252,0.12)",
    isDark: true,
  },
  day: {
    label: "Afternoon",
    greeting: "Sunshine",
    accent: "#1A1FCC",
    accentSoft: "#E8EAFF",
    isDark: false,
  },
  evening: {
    label: "Evening",
    greeting: "Winding down",
    accent: "#F97316",
    accentSoft: "rgba(249,115,22,0.10)",
    isDark: true,
  },
  night: {
    label: "Night",
    greeting: "Late night",
    accent: "#818CF8",
    accentSoft: "rgba(129,140,248,0.10)",
    isDark: true,
  },
} satisfies Record<
  Period,
  { label: string; greeting: string; accent: string; accentSoft: string; isDark: boolean }
>;
