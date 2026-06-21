const CALENDAR_EMBED_URL =
  "https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FLos_Angeles&showPrint=0&src=am9ydGVnYWNyZWF0aXZlY2VpbGluZ3NAZ21haWwuY29t&src=NDRhNGNiYTUyMjQ2NTFmZDg2ZWVlNWM5YWQxYjVlZjgyNWQ3MDY2NTI4MjEyNDQ4YTdlY2VlM2JkZDY0NWM5NEBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=MzlhZGE1N2U0YTZjYTYwMDU0MjhiN2E5Zjg4YzRkODU1MzM5Njc0YzRmOWJmMzNhZThhOTliYmFiZjhjZTk2MkBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZW4udXNhI2hvbGlkYXlAZ3JvdXAudi5jYWxlbmRhci5nb29nbGUuY29t&color=%23039be5&color=%23f4511e&color=%23e67c73&color=%230b8043";

export function FieldCalendarDashboardPage() {
  return (
    <div className="calendar-container">
      <iframe src={CALENDAR_EMBED_URL} title="Installation calendar" />
    </div>
  );
}
