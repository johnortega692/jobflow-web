import { WEATHER_CHIP_COLORS, type WeatherChip, type WeatherChipKind } from "../../lib/projectWeatherDisplay";

type Props = {
  chip: WeatherChip;
  onOpen: () => void;
  /** Icon and text color only, with no pill fill. */
  plain?: boolean;
};

function WeatherIcon({ kind }: { kind: WeatherChipKind }) {
  if (kind === "dry") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === "stale") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 8.2V12l2.6 1.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "interior" || kind === "none") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4.2v-5.2H9.7V20H5.5a1 1 0 0 1-1-1v-8.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.2 16.2a3.6 3.6 0 0 1 .4-7.1 4.6 4.6 0 0 1 8.8-1.1 3.2 3.2 0 0 1 1.2 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8.2 18.2 7.2 20.4M12 18.2l-1 2.2M15.8 18.2l-1 2.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProjectWeatherChip({ chip, onOpen, plain = false }: Props) {
  const colors = WEATHER_CHIP_COLORS[chip.tone];
  return (
    <button
      type="button"
      className={`project-weather-chip project-weather-chip--${chip.tone}${plain ? " project-weather-chip--plain" : ""}`}
      style={plain ? { color: colors.color } : { background: colors.background, color: colors.color }}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <WeatherIcon kind={chip.kind} />
      <span>{chip.label}</span>
    </button>
  );
}
