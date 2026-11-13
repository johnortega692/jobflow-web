export const MEETING_GROUP_TITLES = [
  "Active Projects",
  "Next Starting Projects",
  "Upcoming Projects",
  "Recent Completed Projects",
  "Incoming Projects",
] as const;

export const MEETING_TOPIC_TITLES = [
  "Manpower / Labor / Hours",
  "Tools / Equipment / Material",
  "Office Paperwork",
  "Clients and Emails",
  "Safety Issues",
] as const;

export type MeetingAttendee = {
  id: string;
  name: string;
  company: string;
  position: string;
  phone: string;
  email: string;
  present: boolean;
};

export type MeetingJobLine = {
  id: string;
  company: string;
  job: string;
  /** Discussion column. */
  notes: string;
  /** Updates / Action Item column. */
  action: string;
};

export type MeetingTopicItem = {
  id: string;
  title: string;
  notes: string;
  action: string;
};

export type MeetingSort = "entered" | "company" | "job" | "name";

export type MeetingGroup = {
  id: string;
  title: string;
  sort: MeetingSort;
  lines: MeetingJobLine[];
};

export type MeetingTopic = {
  id: string;
  title: string;
  items: MeetingTopicItem[];
};

export type PaintMeetingContent = {
  title: string;
  meetingDate: string;
  meetingTime: string;
  purpose: string;
  nextMeeting: string;
  attendeeSort: MeetingSort;
  attendees: MeetingAttendee[];
  groups: MeetingGroup[];
  topics: MeetingTopic[];
};

export type PaintMeetingRecord = PaintMeetingContent & {
  id: string;
  updatedAt: string;
};

function newId(): string {
  return crypto.randomUUID();
}

export function emptyAttendee(): MeetingAttendee {
  return { id: newId(), name: "", company: "ICBI", position: "", phone: "", email: "", present: true };
}

export function emptyJobLine(): MeetingJobLine {
  return { id: newId(), company: "", job: "", notes: "", action: "" };
}

export function emptyTopicItem(): MeetingTopicItem {
  return { id: newId(), title: "", notes: "", action: "" };
}

export function blankMeetingContent(date = localMeetingDate()): PaintMeetingContent {
  return {
    title: "Meeting Agenda – ICBI Paint Division",
    meetingDate: date,
    meetingTime: "1:00 PM PST",
    purpose: "Weekly Paint Meeting",
    nextMeeting: "",
    attendeeSort: "entered",
    attendees: [emptyAttendee()],
    groups: MEETING_GROUP_TITLES.map((title) => ({ id: newId(), title, sort: "entered" as const, lines: [emptyJobLine()] })),
    topics: MEETING_TOPIC_TITLES.map((title) => ({ id: newId(), title, items: [emptyTopicItem()] })),
  };
}

export function copyMeetingForNextWeek(content: PaintMeetingContent, today = localMeetingDate()): PaintMeetingContent {
  const shifted = shiftMeetingDate(content.meetingDate, 7);
  return {
    ...content,
    meetingDate: shifted && shifted >= today ? shifted : today,
    nextMeeting: "",
  };
}

function shiftMeetingDate(iso: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + days);
  return localMeetingDate(date);
}

export function localMeetingDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatMeetingDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso.trim();
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asAttendee(value: unknown): MeetingAttendee | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MeetingAttendee>;
  return {
    id: asString(row.id) || newId(),
    name: asString(row.name),
    company: asString(row.company),
    position: asString(row.position),
    phone: asString(row.phone),
    email: asString(row.email),
    present: row.present !== false,
  };
}

function asJobLine(value: unknown): MeetingJobLine | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MeetingJobLine>;
  return {
    id: asString(row.id) || newId(),
    company: asString(row.company),
    job: asString(row.job),
    notes: asString((row as { discussion?: unknown }).discussion) || asString(row.notes),
    action: asString(row.action),
  };
}

function asTopicItem(value: unknown): MeetingTopicItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<MeetingTopicItem>;
  return {
    id: asString(row.id) || newId(),
    title: asString(row.title),
    notes: asString(row.notes),
    action: asString(row.action),
  };
}

/** Older meetings stored a topic as one text box. The first line of each block is the item title. */
function itemsFromBody(body: string): MeetingTopicItem[] {
  const blocks = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return [emptyTopicItem()];
  return blocks.map((block) => {
    const [first, ...rest] = block.split(/\n/);
    const title = (first ?? "").trim();
    const notes = rest.join("\n").trim();
    if (title.length <= 60 && (notes || title.length <= 40)) return { id: newId(), title, notes, action: "" };
    return { id: newId(), title: "", notes: block, action: "" };
  });
}

export function normalizeMeetingContent(value: unknown, fallbackDate = ""): PaintMeetingContent {
  const blank = blankMeetingContent(fallbackDate);
  if (!value || typeof value !== "object") return blank;
  const raw = value as Partial<PaintMeetingContent>;
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.map(asAttendee).filter((row) => row !== null) : [];
  const incomingGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = MEETING_GROUP_TITLES.map((title) => {
    const found = incomingGroups.find((group) => group && typeof group === "object" && asString((group as MeetingGroup).title) === title);
    const lines = found && Array.isArray((found as MeetingGroup).lines)
      ? (found as MeetingGroup).lines.map(asJobLine).filter((row) => row !== null)
      : [];
    const rawSort = found ? asString((found as MeetingGroup).sort) : "entered";
    const sort: MeetingSort = rawSort === "company" || rawSort === "job" || rawSort === "name" ? rawSort : "entered";
    return {
      id: found ? asString((found as MeetingGroup).id) || newId() : newId(),
      title,
      sort,
      lines,
    };
  });
  const incomingTopics = Array.isArray(raw.topics) ? raw.topics : [];
  const topics = MEETING_TOPIC_TITLES.map((title) => {
    const found = incomingTopics.find((topic) => topic && typeof topic === "object" && asString((topic as MeetingTopic).title) === title);
    const raw = found as { id?: unknown; items?: unknown; body?: unknown } | undefined;
    const stored = raw && Array.isArray(raw.items) ? raw.items.map(asTopicItem).filter((item) => item !== null) : [];
    return {
      id: raw ? asString(raw.id) || newId() : newId(),
      title,
      items: stored.length ? stored : itemsFromBody(raw ? asString(raw.body) : ""),
    };
  });
  return {
    title: asString(raw.title) || blank.title,
    meetingDate: asString(raw.meetingDate) || fallbackDate,
    meetingTime: asString(raw.meetingTime),
    purpose: asString(raw.purpose) || blank.purpose,
    nextMeeting: asString(raw.nextMeeting),
    attendeeSort: asString(raw.attendeeSort) === "name" || asString(raw.attendeeSort) === "company" ? (asString(raw.attendeeSort) as MeetingSort) : "entered",
    attendees: attendees.length ? attendees : [emptyAttendee()],
    groups,
    topics,
  };
}

function jobNumber(job: string): number {
  const match = job.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function filledJob(line: MeetingJobLine): boolean {
  return Boolean(line.company.trim() || line.job.trim() || line.notes.trim() || line.action.trim());
}

/** Reorder a section. Empty rows stay at the bottom. "As entered" keeps the current order. */
export function sortMeetingLines(lines: MeetingJobLine[], sort: MeetingSort): MeetingJobLine[] {
  if (sort === "entered" || sort === "name") return lines;
  const filled = lines.filter(filledJob);
  const empty = lines.filter((line) => !filledJob(line));
  filled.sort((a, b) => {
    if (sort === "company") {
      const company = a.company.localeCompare(b.company, undefined, { sensitivity: "base" });
      if (company !== 0) return company;
    }
    const number = jobNumber(a.job) - jobNumber(b.job);
    if (number !== 0) return number;
    return a.job.localeCompare(b.job, undefined, { numeric: true, sensitivity: "base" });
  });
  return [...filled, ...empty];
}

export function sortAttendees(rows: MeetingAttendee[], sort: MeetingSort): MeetingAttendee[] {
  if (sort !== "name" && sort !== "company") return rows;
  const filled = rows.filter((row) => row.name.trim() || row.email.trim());
  const empty = rows.filter((row) => !row.name.trim() && !row.email.trim());
  filled.sort((a, b) => {
    const left = sort === "company" ? a.company : a.name;
    const right = sort === "company" ? b.company : b.name;
    const primary = left.localeCompare(right, undefined, { sensitivity: "base" });
    if (primary !== 0) return primary;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return [...filled, ...empty];
}

export function meetingContentOf(record: PaintMeetingRecord): PaintMeetingContent {
  return {
    title: record.title,
    meetingDate: record.meetingDate,
    meetingTime: record.meetingTime,
    purpose: record.purpose,
    nextMeeting: record.nextMeeting,
    attendeeSort: record.attendeeSort,
    attendees: record.attendees,
    groups: record.groups,
    topics: record.topics,
  };
}

export function meetingDateLine(content: PaintMeetingContent): string {
  const date = formatMeetingDate(content.meetingDate);
  const time = content.meetingTime.trim();
  if (date && time) return `${date} @ ${time}`;
  return date || time;
}

export type MeetingExportLine = {
  text: string;
  kind: "title" | "meta" | "heading" | "subhead" | "body";
};

export function meetingExportLines(content: PaintMeetingContent): MeetingExportLine[] {
  const lines: MeetingExportLine[] = [{ text: content.title.trim() || "Meeting Agenda", kind: "title" }];
  const when = meetingDateLine(content);
  if (when) lines.push({ text: `Meeting Date: ${when}`, kind: "meta" });
  if (content.purpose.trim()) lines.push({ text: `Meeting Purpose: ${content.purpose.trim()}`, kind: "meta" });
  if (content.nextMeeting.trim()) lines.push({ text: `Next Meeting Scheduled: ${content.nextMeeting.trim()}`, kind: "meta" });

  lines.push({ text: "Attendees", kind: "heading" });
  const people = content.attendees.filter((row) => row.name.trim() || row.email.trim());
  if (!people.length) {
    lines.push({ text: "None listed.", kind: "body" });
  } else {
    for (const person of people) {
      const bits = [person.name, person.company, person.position, person.phone, person.email]
        .map((part) => part.trim())
        .filter(Boolean);
      lines.push({ text: bits.join(" · ") || "Attendee", kind: "subhead" });
      lines.push({ text: person.present ? "Present" : "Absent", kind: "body" });
    }
  }

  for (const group of content.groups) {
    lines.push({ text: group.title, kind: "heading" });
    const jobs = group.lines.filter(filledJob);
    if (!jobs.length) {
      lines.push({ text: "None.", kind: "body" });
      continue;
    }
    for (const job of jobs) {
      if (job.company.trim()) lines.push({ text: job.company.trim(), kind: "subhead" });
      if (job.job.trim()) lines.push({ text: job.job.trim(), kind: "subhead" });
      const notes = job.notes.trim();
      if (notes) {
        for (const note of notes.split(/\r?\n/)) {
          const text = note.trim();
          if (text) lines.push({ text, kind: "body" });
        }
      }
      const action = job.action.trim();
      if (action) lines.push({ text: action, kind: "body" });
    }
  }

  for (const topic of content.topics) {
    lines.push({ text: topic.title, kind: "heading" });
    const items = topic.items.filter((item) => item.title.trim() || item.notes.trim() || item.action.trim());
    if (!items.length) {
      lines.push({ text: "None.", kind: "body" });
      continue;
    }
    for (const item of items) {
      if (item.title.trim()) lines.push({ text: item.title.trim(), kind: "subhead" });
      for (const note of item.notes.split(/\r?\n/)) {
        const text = note.trim();
        if (text) lines.push({ text, kind: "body" });
      }
      if (item.action.trim()) lines.push({ text: item.action.trim(), kind: "body" });
    }
  }

  return lines;
}

export function meetingFileStem(content: PaintMeetingContent): string {
  const date = formatMeetingDate(content.meetingDate).replace(/\//g, "-") || "undated";
  return `Meeting Agenda & Minutes - Paint ${date}`;
}
