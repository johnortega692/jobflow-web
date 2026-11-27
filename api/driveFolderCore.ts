import { driveFolderId, folderNeedsAccess, parseDriveFolderPage, type DriveFolderFile } from "../src/lib/driveFolder.js";

const MAX_PDF_BYTES = 20_000_000;

export async function listSharedDrivePdfs(folder: string): Promise<DriveFolderFile[]> {
  const id = driveFolderId(folder);
  if (!id) throw new Error("Paste a Google Drive folder link.");
  const key = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  if (key) return listWithApiKey(id, key);
  return listPublicFolder(id);
}

async function listPublicFolder(id: string): Promise<DriveFolderFile[]> {
  const response = await fetch(`https://drive.google.com/drive/folders/${encodeURIComponent(id)}?usp=sharing`, {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  const html = await response.text();
  if (!response.ok || folderNeedsAccess(html)) {
    throw new Error("Share that folder as Anyone with the link can view.");
  }
  const files = parseDriveFolderPage(html);
  if (!files.length) throw new Error("No PDFs are waiting in that folder.");
  return files;
}

export async function downloadSharedDrivePdf(fileId: string): Promise<Uint8Array> {
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) throw new Error("That Drive file is not valid.");
  const key = process.env.GOOGLE_DRIVE_API_KEY?.trim();
  const url = key
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(key)}`
    : `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  const first = await readDriveResponse(url);
  if (isPdf(first)) return first;
  const html = Buffer.from(first).toString("utf8");
  if (folderNeedsAccess(html)) throw new Error("Share that folder as Anyone with the link can view.");
  const confirm = /confirm=([0-9A-Za-z_-]+)/.exec(html)?.[1];
  if (confirm && confirm !== "t") {
    const second = await readDriveResponse(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirm)}`,
    );
    if (isPdf(second)) return second;
  }
  throw new Error("That Drive file is not a PDF JobFlow can open. Share it as Anyone with the link can view.");
}

async function listWithApiKey(id: string, key: string): Promise<DriveFolderFile[]> {
  const query = encodeURIComponent(`'${id}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not open that Drive folder.");
  const body = (await response.json()) as { files?: { id?: string; name?: string; mimeType?: string }[] };
  const files = (body.files ?? [])
    .filter((file) => file.id && file.name && (file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")))
    .map((file) => ({ id: file.id as string, name: file.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) throw new Error("No PDFs are waiting in that folder.");
  return files;
}

async function readDriveResponse(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "JobFlow/1.0" } });
  if (!response.ok) throw new Error("Could not open that Drive PDF.");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_PDF_BYTES) throw new Error("That PDF is too large to open here.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error("That PDF is too large to open here.");
  return bytes;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 5 && Buffer.from(bytes.subarray(0, 5)).toString("utf8") === "%PDF-";
}
