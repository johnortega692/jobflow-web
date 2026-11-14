import { useCallback, useEffect, useState } from "react";
import { formatDateTime } from "../../lib/strings";
import {
  FILE_STORAGE_QUOTA_BYTES,
  formatStorageBytes,
  loadStorageUsage,
  storageBucketLabel,
  storageFileName,
  type StorageUsage,
} from "../../lib/storageUsage";

export function StorageSettingsSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await loadStorageUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load storage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const used = usage?.buckets.filter((row) => row.files > 0) ?? [];
  const widest = used.reduce((max, row) => Math.max(max, row.bytes), 0);

  return (
    <div className="stack">
      <div className="settings-section-head">
        <div>
          <h2>File storage</h2>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 640 }}>
            Uploaded files across the company, including SDS packets, receipts, work orders, and other
            attachments.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <div className="banner banner-error">{error}</div> : null}

      {loading && !usage ? <p className="muted">Loading storage…</p> : null}

      {usage ? (
        <>
          <div className="storage-usage-summary">
            <p className="storage-usage-total">
              <strong>{formatStorageBytes(usage.totalBytes)}</strong>
              <span className="muted">used of {formatStorageBytes(FILE_STORAGE_QUOTA_BYTES)}</span>
            </p>
            <span className="storage-usage-quota" aria-hidden>
              <span
                style={{
                  width: `${Math.min(100, Math.max(usage.totalBytes > 0 ? 2 : 0, (usage.totalBytes / FILE_STORAGE_QUOTA_BYTES) * 100))}%`,
                }}
              />
            </span>
            <p className="muted small storage-usage-left">
              {formatStorageBytes(Math.max(0, FILE_STORAGE_QUOTA_BYTES - usage.totalBytes))} left
              {" · "}
              {usage.totalFiles === 1 ? "1 file" : `${usage.totalFiles} files`}
            </p>
          </div>

          {used.length === 0 ? (
            <p className="muted">No uploaded files yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Files</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {used.map((row) => (
                    <tr key={row.bucket}>
                      <td>{storageBucketLabel(row.bucket)}</td>
                      <td>{row.files}</td>
                      <td>
                        <div className="storage-usage-size">
                          <span>{formatStorageBytes(row.bytes)}</span>
                          <span className="storage-usage-bar" aria-hidden>
                            <span style={{ width: `${widest > 0 ? Math.max(4, (row.bytes / widest) * 100) : 0}%` }} />
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {usage.largest.length > 0 ? (
            <>
              <h3 className="storage-usage-subhead">Largest files</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Area</th>
                      <th>Size</th>
                      <th>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.largest.map((file) => (
                      <tr key={`${file.bucket}/${file.path}`}>
                        <td title={file.path}>{storageFileName(file.path)}</td>
                        <td>{storageBucketLabel(file.bucket)}</td>
                        <td>{formatStorageBytes(file.bytes)}</td>
                        <td className="muted">{file.createdAt ? formatDateTime(file.createdAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
