export type DriveFolderFile = {
  id: string;
  name: string;
};

const FOLDER_IN_PATH = /\/folders\/([a-zA-Z0-9_-]+)/;
const ID_PARAM = /[?&]id=([a-zA-Z0-9_-]+)/;
const FILE_ID = /^[a-zA-Z0-9_-]{10,}$/;

export function driveFolderId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fromPath = FOLDER_IN_PATH.exec(trimmed)?.[1];
  if (fromPath && FILE_ID.test(fromPath)) return fromPath;
  const fromQuery = ID_PARAM.exec(trimmed)?.[1];
  if (fromQuery && FILE_ID.test(fromQuery)) return fromQuery;
  if (FILE_ID.test(trimmed)) return trimmed;
  return null;
}

/** File names from the public Google Drive folder page. */
export function parseDriveFolderPage(html: string): DriveFolderFile[] {
  const files = new Map<string, string>();
  const rows = /data-id="([a-zA-Z0-9_-]{20,})"[^>]*data-tooltip="([^"]+?)\s+PDF"/g;
  for (const match of html.matchAll(rows)) {
    const id = match[1];
    const name = decodeFolderName(match[2] ?? "");
    if (id && name.toLowerCase().endsWith(".pdf") && FILE_ID.test(id)) files.set(id, name);
  }
  for (const file of parseEmbeddedFolder(html)) files.set(file.id, file.name);
  return [...files.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Older public folder markup. */
export function parseEmbeddedFolder(html: string): DriveFolderFile[] {
  const files = new Map<string, string>();
  const entries = /id="entry-([a-zA-Z0-9_-]+)"[\s\S]{0,800}?class="flip-entry-title">([^<]+)/g;
  for (const match of html.matchAll(entries)) {
    const id = match[1];
    const name = decodeFolderName(match[2] ?? "");
    if (id && name && FILE_ID.test(id)) files.set(id, name);
  }
  const links = /\/file\/d\/([a-zA-Z0-9_-]+)\/[^"'<\s]*[\s\S]{0,240}?([^<>"']+\.pdf)/gi;
  for (const match of html.matchAll(links)) {
    const id = match[1];
    const name = decodeFolderName(match[2] ?? "");
    if (id && name && FILE_ID.test(id) && !files.has(id)) files.set(id, name);
  }
  return [...files.entries()]
    .map(([id, name]) => ({ id, name }))
    .filter((file) => file.name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function folderNeedsAccess(html: string): boolean {
  return /you need access|request access|sign in to continue|access denied/i.test(html);
}

function decodeFolderName(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
