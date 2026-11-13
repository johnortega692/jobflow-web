import { supabase } from "./supabase.js";
import type { Json } from "../types/database.js";
import {
  blankMeetingContent,
  localMeetingDate,
  normalizeMeetingContent,
  type PaintMeetingContent,
  type PaintMeetingRecord,
} from "./paintMeeting.js";

type MeetingRow = {
  id: string;
  title: string;
  meeting_on: string | null;
  content: unknown;
  updated_at: string;
};

function toRecord(row: MeetingRow): PaintMeetingRecord {
  const content = normalizeMeetingContent(row.content, row.meeting_on ?? "");
  return {
    ...content,
    title: content.title || row.title,
    meetingDate: content.meetingDate || row.meeting_on || "",
    id: row.id,
    updatedAt: row.updated_at,
  };
}

export async function listPaintMeetings(): Promise<PaintMeetingRecord[]> {
  const { data, error } = await supabase
    .from("paint_meetings")
    .select("id, title, meeting_on, content, updated_at")
    .order("meeting_on", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as MeetingRow[]).map(toRecord);
}

export async function getPaintMeeting(id: string): Promise<PaintMeetingRecord | null> {
  const { data, error } = await supabase
    .from("paint_meetings")
    .select("id, title, meeting_on, content, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRecord(data as MeetingRow) : null;
}

export async function createPaintMeeting(content?: PaintMeetingContent): Promise<PaintMeetingRecord> {
  const next = content ?? blankMeetingContent(localMeetingDate());
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("paint_meetings")
    .insert({
      title: next.title.trim() || "Meeting Agenda",
      meeting_on: next.meetingDate || null,
      content: next as unknown as Json,
      created_by: userData.user?.id ?? null,
    })
    .select("id, title, meeting_on, content, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return toRecord(data as MeetingRow);
}

export async function savePaintMeeting(id: string, content: PaintMeetingContent): Promise<PaintMeetingRecord> {
  const { data, error } = await supabase
    .from("paint_meetings")
    .update({
      title: content.title.trim() || "Meeting Agenda",
      meeting_on: content.meetingDate || null,
      content: content as unknown as Json,
    })
    .eq("id", id)
    .select("id, title, meeting_on, content, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return toRecord(data as MeetingRow);
}

export async function deletePaintMeeting(id: string): Promise<void> {
  const { error } = await supabase.from("paint_meetings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
