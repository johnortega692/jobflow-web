import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
  type Plugin,
} from "chart.js";
import { useEffect, useMemo, useRef } from "react";
import { HOURS_PER_MAN_WEEK } from "../../lib/manpowerCalendar";
import {
  buildWorkloadChartModel,
  chartVisibleSundayWeekStarts,
  formatWorkloadWeekLabel,
  type CompanyWorkloadWeek,
  type WorkloadChartSegment,
} from "../../lib/companyManpowerWorkload";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const OVER_CAPACITY_COLOR = "#e34948";
const MAX_BAR_THICKNESS = 90;
const BAR_PERCENTAGE = 0.9;
const CATEGORY_PERCENTAGE = 0.85;
const LABEL_PADDING_TOP = 22;

type Props = {
  weeks: CompanyWorkloadWeek[];
  viewMonth: Date;
  /** Live active roster count; null = unavailable (zero/failed); undefined = still loading. */
  crewCapacity?: number | null;
  selectedWeekStart: string | null;
  onSelectWeek: (weekStart: string) => void;
  mobileView?: boolean;
};

type WeekStack = {
  weekStart: string;
  labelWeekStart: string;
  jobSegments: WorkloadChartSegment[];
  overflowPeople: number;
  totalPeople: number;
};

type ChartPalette = {
  text: string;
  muted: string;
  grid: string;
};

function splitWeekStack(
  segments: WorkloadChartSegment[],
  capacity: number,
): Omit<WeekStack, "weekStart" | "labelWeekStart"> {
  const totalPeople = segments.reduce((sum, segment) => sum + segment.people, 0);
  if (capacity <= 0 || totalPeople <= capacity) {
    return { jobSegments: segments, overflowPeople: 0, totalPeople };
  }

  let remaining = capacity;
  const jobSegments: WorkloadChartSegment[] = [];
  for (const segment of segments) {
    if (remaining <= 0) break;
    const take = Math.min(segment.people, remaining);
    if (take > 0) {
      jobSegments.push({
        ...segment,
        people: take,
        hours: take * HOURS_PER_MAN_WEEK,
      });
    }
    remaining -= take;
  }

  return {
    jobSegments,
    overflowPeople: totalPeople - capacity,
    totalPeople,
  };
}

function readChartPalette(container: HTMLElement | null): ChartPalette {
  const host = container?.closest(".field-dashboard") ?? container;
  const styles = host ? getComputedStyle(host) : null;
  return {
    text: styles?.getPropertyValue("--fd-text").trim() || "#202124",
    muted: styles?.getPropertyValue("--fd-muted").trim() || "#5f6368",
    grid: styles?.getPropertyValue("--fd-border-soft").trim() || "#e8eaed",
  };
}

function formatTooltipJobLine(segment: WorkloadChartSegment): string {
  const hours = Math.round(segment.hours);
  const people = segment.people;
  const peopleLabel = Number.isInteger(people) ? String(people) : people.toFixed(1);
  return `${segment.label} — ${hours}h (${peopleLabel})`;
}

export function CompanyWorkloadBarChart({
  weeks,
  viewMonth,
  crewCapacity,
  onSelectWeek,
  mobileView = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasCapacity = crewCapacity != null && crewCapacity > 0;
  const capacity = hasCapacity ? crewCapacity : 0;

  const visibleSundayWeeks = useMemo(() => chartVisibleSundayWeekStarts(viewMonth), [viewMonth]);

  const model = useMemo(
    () =>
      buildWorkloadChartModel(weeks, {
        capacityPeople: hasCapacity ? capacity : undefined,
        visibleSundayWeeks,
      }),
    [weeks, visibleSundayWeeks, hasCapacity, capacity],
  );

  const weekStacks = useMemo<WeekStack[]>(
    () =>
      model.weeks.map((week) => ({
        weekStart: week.weekStart,
        labelWeekStart: week.labelWeekStart,
        ...splitWeekStack(week.segments, capacity),
      })),
    [capacity, model.weeks],
  );

  const stats = useMemo(() => {
    const peakWeek = weekStacks.reduce(
      (best, week) => (week.totalPeople > best.totalPeople ? week : best),
      weekStacks[0] ?? { totalPeople: 0, labelWeekStart: "", weekStart: "" },
    );
    const peakDemand = Math.ceil(peakWeek.totalPeople);

    return {
      peakDemand,
      peakWeekLabel: peakWeek.labelWeekStart ? formatWorkloadWeekLabel(peakWeek.labelWeekStart) : "—",
      hiringGap: hasCapacity ? Math.max(0, peakDemand - capacity) : null,
    };
  }, [capacity, hasCapacity, weekStacks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !weekStacks.length) return;

    const palette = readChartPalette(container);
    const labels = weekStacks.map((week) => formatWorkloadWeekLabel(week.labelWeekStart));

    const jobDatasets: ChartDataset<"bar">[] = model.jobs.map((job) => ({
      label: job.label,
      data: weekStacks.map((week) => week.jobSegments.find((segment) => segment.key === job.key)?.people ?? 0),
      backgroundColor: job.color,
      stack: "workload",
      borderWidth: 0,
    }));

    const datasets: ChartDataset<"bar">[] = [...jobDatasets];
    if (hasCapacity) {
      datasets.push({
        label: "Over capacity",
        data: weekStacks.map((week) => week.overflowPeople),
        backgroundColor: OVER_CAPACITY_COLOR,
        stack: "workload",
        borderWidth: 0,
      });
    }

    const stackTotalLabelsPlugin: Plugin<"bar"> = {
      id: "stackTotalLabels",
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const yScale = chart.scales.y;
        if (!yScale) return;

        ctx.save();
        ctx.font = "500 12px Segoe UI, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        weekStacks.forEach((week, index) => {
          if (week.totalPeople <= 0) return;

          const baseMeta = chart.getDatasetMeta(0);
          const bar = baseMeta.data[index];
          if (!bar) return;

          const ceilTotal = Math.ceil(week.totalPeople);
          const overCapacity = hasCapacity && week.totalPeople > capacity;
          const label = overCapacity ? `${ceilTotal} (+${ceilTotal - capacity})` : String(ceilTotal);
          const y = yScale.getPixelForValue(week.totalPeople);

          ctx.fillStyle = overCapacity ? OVER_CAPACITY_COLOR : palette.text;
          ctx.fillText(label, bar.x, y - 6);
        });

        ctx.restore();
      },
    };

    const capacityLinePlugin: Plugin<"bar"> = {
      id: "capacityLine",
      afterDraw(chart) {
        if (!hasCapacity) return;
        const { ctx, chartArea } = chart;
        const yScale = chart.scales.y;
        if (!yScale || model.yMax < capacity) return;

        const y = yScale.getPixelForValue(capacity);
        ctx.save();
        ctx.strokeStyle = OVER_CAPACITY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.restore();
      },
    };

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        datasets: {
          bar: {
            barPercentage: BAR_PERCENTAGE,
            categoryPercentage: CATEGORY_PERCENTAGE,
            maxBarThickness: MAX_BAR_THICKNESS,
          },
        },
        layout: {
          padding: { top: LABEL_PADDING_TOP },
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        onClick: (_event, elements) => {
          if (!elements.length) return;
          const index = elements[0]?.index;
          if (index == null) return;
          const week = weekStacks[index];
          if (week) onSelectWeek(week.weekStart);
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => Number(item.raw) > 0,
            callbacks: {
              title(items) {
                const index = items[0]?.dataIndex ?? 0;
                return formatWorkloadWeekLabel(weekStacks[index]?.labelWeekStart ?? "");
              },
              label(context) {
                const index = context.dataIndex;
                const week = model.weeks[index];
                if (!week) return "";
                if (context.dataset.label === "Over capacity") {
                  const people = Number(context.raw) || 0;
                  if (people <= 0) return "";
                  const hours = Math.round(people * HOURS_PER_MAN_WEEK);
                  const peopleLabel = Number.isInteger(people) ? String(people) : people.toFixed(1);
                  return `Over capacity — ${hours}h (${peopleLabel})`;
                }
                const job = model.jobs[context.datasetIndex];
                if (!job) return "";
                const segment = week.segments.find((item) => item.key === job.key);
                if (!segment) return "";
                return formatTooltipJobLine(segment);
              },
              footer(items) {
                const index = items[0]?.dataIndex ?? 0;
                const week = weekStacks[index];
                if (!week || week.totalPeople <= 0) return "";
                const hours = Math.round(week.totalPeople * HOURS_PER_MAN_WEEK);
                const peopleLabel = Number.isInteger(week.totalPeople)
                  ? String(week.totalPeople)
                  : week.totalPeople.toFixed(1);
                return `Week total: ${hours}h (${peopleLabel})`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              color: palette.muted,
              font: { size: mobileView ? 10 : 11 },
              maxRotation: 0,
              autoSkip: false,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            max: model.yMax,
            title: {
              display: true,
              text: "People",
              color: palette.muted,
              font: { size: 12, weight: "bold" },
            },
            grid: { color: palette.grid },
            ticks: {
              color: palette.muted,
              font: { size: 11 },
              stepSize: model.yMax <= 5 ? 1 : model.yMax <= 10 ? 2 : 4,
            },
          },
        },
      },
      plugins: [stackTotalLabelsPlugin, capacityLinePlugin],
    };

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvas, config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [capacity, hasCapacity, mobileView, model.jobs, model.weeks, model.yMax, onSelectWeek, weekStacks]);

  const minChartWidth = mobileView ? undefined : Math.max(weekStacks.length * (MAX_BAR_THICKNESS + 12) + 80, 320);

  if (!weekStacks.length) {
    return <p className="field-cal-detail-empty">No weeks in this range.</p>;
  }

  const crewLabel =
    crewCapacity === undefined ? "—" : hasCapacity ? `${crewCapacity} painters` : "—";
  const hiringGapLabel =
    crewCapacity === undefined || !hasCapacity
      ? "—"
      : stats.hiringGap != null && stats.hiringGap > 0
        ? `+${stats.hiringGap} painters`
        : "0";

  return (
    <div ref={containerRef} className="field-workload-chart">
      <div className="field-workload-stat-cards">
        <div className="field-workload-stat-card">
          <div className="field-workload-stat-label">Current crew</div>
          <div className="field-workload-stat-value">{crewLabel}</div>
        </div>
        <div className="field-workload-stat-card">
          <div className="field-workload-stat-label">Peak demand</div>
          <div className="field-workload-stat-value">
            {stats.peakDemand > 0 ? `${stats.peakDemand} · wk of ${stats.peakWeekLabel}` : "—"}
          </div>
        </div>
        <div className="field-workload-stat-card">
          <div className="field-workload-stat-label">Hiring gap</div>
          <div
            className={[
              "field-workload-stat-value",
              hasCapacity && stats.hiringGap != null && stats.hiringGap > 0
                ? "field-workload-stat-value--danger"
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {hiringGapLabel}
          </div>
        </div>
      </div>

      <div className="field-workload-chart-legend">
        {model.jobs.map((job) => (
          <span key={job.key} className="field-workload-chart-legend-item">
            <span className="field-workload-chart-legend-swatch" style={{ background: job.color }} />
            {job.label}
          </span>
        ))}
        {hasCapacity ? (
          <>
            <span className="field-workload-chart-legend-item">
              <span className="field-workload-chart-legend-swatch" style={{ background: OVER_CAPACITY_COLOR }} />
              Over capacity
            </span>
            <span className="field-workload-chart-legend-item field-workload-chart-legend-item--capacity">
              <span className="field-workload-chart-legend-line" />
              Capacity ({capacity})
            </span>
          </>
        ) : null}
      </div>

      <div className="field-workload-chart-scroll field-workload-chart-scroll--canvas">
        <div
          className="field-workload-chart-canvas-wrap"
          style={minChartWidth ? { minWidth: minChartWidth } : undefined}
        >
          <canvas ref={canvasRef} className="field-workload-chart-canvas" />
        </div>
      </div>
    </div>
  );
}
