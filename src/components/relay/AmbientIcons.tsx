import {
  Cloud,
  CloudMoon,
  CloudSun,
  CloudSunRain,
  Coffee,
  Flame,
  Moon,
  Orbit,
  Sparkles,
  Stars,
  Sun,
  Sunset,
  Wind,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { Period } from "@/hooks/useTimePeriod";

type IconSpec = {
  Icon: typeof Moon;
  size: number;
  style: CSSProperties;
  opacity: number;
};

const SETS: Record<Period, IconSpec[]> = {
  dawn: [
    { Icon: Moon, size: 120, opacity: 0.07, style: { top: "40%", left: "0%", rotate: "-20deg" } },
    { Icon: Stars, size: 90, opacity: 0.05, style: { top: "15%", left: "20%" } },
    { Icon: Sparkles, size: 70, opacity: 0.06, style: { top: "65%", left: "8%" } },
    { Icon: Cloud, size: 100, opacity: 0.04, style: { top: "75%", left: "15%" } },
  ],
  day: [
    { Icon: Sun, size: 130, opacity: 0.07, style: { top: "20%", left: "5%", rotate: "15deg" } },
    { Icon: CloudSun, size: 90, opacity: 0.05, style: { top: "50%", left: "25%" } },
    { Icon: Wind, size: 80, opacity: 0.04, style: { top: "70%", left: "10%" } },
    { Icon: Sparkles, size: 60, opacity: 0.04, style: { top: "10%", left: "30%" } },
  ],
  evening: [
    { Icon: Sunset, size: 120, opacity: 0.09, style: { top: "25%", left: "5%" } },
    { Icon: CloudSunRain, size: 90, opacity: 0.06, style: { top: "55%", left: "22%" } },
    { Icon: Flame, size: 70, opacity: 0.07, style: { top: "80%", left: "12%" } },
    { Icon: Coffee, size: 60, opacity: 0.05, style: { top: "15%", left: "28%" } },
  ],
  night: [
    { Icon: Moon, size: 130, opacity: 0.09, style: { top: "15%", left: "8%" } },
    { Icon: Stars, size: 100, opacity: 0.06, style: { top: "40%", left: "20%" } },
    { Icon: CloudMoon, size: 90, opacity: 0.05, style: { top: "70%", left: "5%" } },
    { Icon: Orbit, size: 80, opacity: 0.04, style: { top: "10%", left: "25%" } },
  ],
};

export function AmbientIcons({ period }: { period: Period }) {
  return (
    <div className="ambient-icons" aria-hidden>
      {SETS[period].map(({ Icon, size, opacity, style }, i) => (
        <Icon key={i} size={size} style={{ opacity, ...style }} strokeWidth={1.25} />
      ))}
    </div>
  );
}
