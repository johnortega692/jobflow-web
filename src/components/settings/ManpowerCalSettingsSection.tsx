import { manpowerCalUrl } from "../../lib/manpowerCalUrl";

export function ManpowerCalSettingsSection() {
  const url = manpowerCalUrl();

  return (
    <section className="stack">
      <div className="settings-section-head">
        <div>
          <h2>Manpower</h2>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 520 }}>
            Field supers use this separate app for weekly crew scheduling, PIN login, and hours tracking.
            Share the link with Robert and John for iPad/iPhone access.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: "0.8rem", marginBottom: 4 }}>
            App URL
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all" }}>
            {url}
          </a>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">
            Open Manpower
          </a>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
          Default admin PIN is set in Supabase (<code>manpower_supers</code>). Change PINs in Manpower → Admin
          after first login. Override URL with <code>VITE_MANPOWER_CAL_URL</code> in .env.local.
        </p>
      </div>
    </section>
  );
}
