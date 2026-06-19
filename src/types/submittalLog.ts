/** Canonical submittal log row — aligned with desktop submittal_log.py */

export type SubmittalLogRow = {
  id: string;
  line_number: string;
  spec: string;
  scope: string;
  section: string;
  submittal_type: string;
  submit_date: string;
  return_date: string;
  result: string;
  status: string;
  transmittal_number: string;
  notes: string;
  revises_line: string;
  trade_submittal_number: string;
  linked_files: string[];
};

export function emptySubmittalLogRow(lineNumber = "01"): SubmittalLogRow {
  return {
    id: "",
    line_number: lineNumber,
    spec: "",
    scope: "Paint",
    section: "",
    submittal_type: "",
    submit_date: "",
    return_date: "",
    result: "",
    status: "Draft",
    transmittal_number: "",
    notes: "",
    revises_line: "",
    trade_submittal_number: "",
    linked_files: [],
  };
}

export function newLogRowId(): string {
  return crypto.randomUUID();
}
