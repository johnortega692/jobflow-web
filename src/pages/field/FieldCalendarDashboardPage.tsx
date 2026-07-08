import { useMemo, useState } from "react";
import {
  buildFieldCalendarEvents,
  buildMonthGrid,
  groupEventsByDate,
  monthLabel,
  type FieldCalendarEvent,
} from "../../lib/fieldCalendarEvents";
import { FieldLoadingPanel, useFieldDashboard } from "./FieldDashboardLayout";
import { useFieldCompactLayout } from "../../lib/useMediaQuery";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_EVENTS = 3;

function shiftMonth(viewMonth: Date, delta: number): Date {
  return new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
}

function EventChip({ event }: { event: FieldCalendarEvent }) {
  return (
    <div className={`field-cal-event field-cal-event--${event.kind}`} title={`${event.jobNumber} · ${event.jobName}`}>
      <span className="field-cal-event-job">{event.jobNumber}</span>
      <span className="field-cal-event-detail">{event.detail}</span>
    </div>
  );
}

export function FieldCalendarDashboardPage() {
  const { paintRows, wcRows, loading, mobileView } = useFieldDashboard();
  const compactLayout = useFieldCompactLayout(mobileView);
  const [viewMonth, setViewMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const events = useMemo(() => buildFieldCalendarEvents(paintRows, wcRows), [paintRows, wcRows]);
  const byDate = useMemo(() => groupEventsByDate(events), [events]);
  const cells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const selectedEvents = selectedKey ? (byDate.get(selectedKey) ?? []) : [];
  const startCount = events.filter((e) => e.kind === "start").length;
  const installCount = events.filter((e) => e.kind === "install").length;

  if (loading) return <FieldLoadingPanel message="Loading calendar…" />;

  return (
    <div className="field-cal">
      <div className="field-cal-toolbar">
        <div className="field-cal-nav">
          <button type="button" className="field-cal-nav-btn" onClick={() => setViewMonth((m) => shiftMonth(m, -1))}>
            ‹
          </button>
          <h2 className="field-cal-month">{monthLabel(viewMonth)}</h2>
          <button type="button" className="field-cal-nav-btn" onClick={() => setViewMonth((m) => shiftMonth(m, 1))}>
            ›
          </button>
          <button
            type="button"
            className="field-cal-today-btn"
            onClick={() => {
              const now = new Date();
              setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedKey(null);
            }}
          >
            Today
          </button>
        </div>
        <div className="field-cal-legend">
          <span className="field-cal-legend-item">
            <span className="field-cal-legend-dot field-cal-legend-dot--start" />
            Job start ({startCount})
          </span>
          <span className="field-cal-legend-item">
            <span className="field-cal-legend-dot field-cal-legend-dot--install" />
            WC install ({installCount})
          </span>
        </div>
      </div>

      <div className={`field-cal-body${compactLayout ? " field-cal-body--mobile" : ""}`}>
        <div className="field-cal-grid-wrap">
          <div className="field-cal-weekdays">
            {WEEKDAYS.map((day) => (
              <div key={day} className="field-cal-weekday">
                {day}
              </div>
            ))}
          </div>
          <div className="field-cal-grid">
            {cells.map((cell) => {
              const dayEvents = byDate.get(cell.dateKey) ?? [];
              const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
              const overflow = dayEvents.length - visible.length;
              const isSelected = selectedKey === cell.dateKey;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  className={`field-cal-day${cell.inMonth ? "" : " field-cal-day--muted"}${cell.isToday ? " field-cal-day--today" : ""}${isSelected ? " field-cal-day--selected" : ""}${dayEvents.length ? " field-cal-day--has-events" : ""}`}
                  onClick={() => setSelectedKey(cell.dateKey)}
                >
                  <span className="field-cal-day-num">{cell.date.getDate()}</span>
                  <div className="field-cal-day-events">
                    {visible.map((event) => (
                      <EventChip key={event.id} event={event} />
                    ))}
                    {overflow > 0 && <div className="field-cal-overflow">+{overflow} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className={`field-cal-detail${selectedKey ? " field-cal-detail--open" : ""}`}>
          <div className="field-cal-detail-head">
            <h3>
              {selectedKey
                ? new Date(`${selectedKey}T12:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : "Select a day"}
            </h3>
            {selectedKey && (
              <button type="button" className="field-cal-detail-close" onClick={() => setSelectedKey(null)}>
                ✕
              </button>
            )}
          </div>
          {selectedKey ? (
            selectedEvents.length ? (
              <ul className="field-cal-detail-list">
                {selectedEvents.map((event) => (
                  <li key={event.id} className={`field-cal-detail-item field-cal-detail-item--${event.kind}`}>
                    <div className="field-cal-detail-kind">{event.kind === "start" ? "Job start" : "WC install"}</div>
                    <div className="field-cal-detail-title">
                      #{event.jobNumber} · {event.jobName}
                    </div>
                    <div className="field-cal-detail-sub">{event.detail}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-cal-detail-empty">No scheduled jobs on this day.</p>
            )
          ) : (
            <p className="field-cal-detail-empty">Tap a day to see job start and wallcovering install dates.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
