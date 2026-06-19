import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  DEFAULT_DELIVERY_SCHEDULING,
  loadDeliverySettings,
  saveDeliverySettings,
  type DeliverySchedulingSettings,
} from "../../lib/deliverySettings";

export function DeliverySettingsSection() {
  const { user } = useAuth();
  const [data, setData] = useState<DeliverySchedulingSettings>(DEFAULT_DELIVERY_SCHEDULING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    void loadDeliverySettings(user.id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load delivery settings"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <p className="muted">Loading delivery settings…</p>;
  if (!user?.id) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    const err = await saveDeliverySettings(user!.id, data);
    setSaving(false);
    if (err) setError(err);
    else setMessage("Delivery address and warehouse info saved.");
  }

  function patch(partial: Partial<DeliverySchedulingSettings>) {
    setData((d) => ({ ...d, ...partial }));
  }

  return (
    <form className="stack delivery-settings" onSubmit={(e) => void onSave(e)}>
      <div>
        <h2>Order forms — delivery &amp; warehouse</h2>
        <p className="muted small">
          Used on wallcovering purchase order PDFs and as the default delivery address when ordering
          materials.
        </p>
      </div>

      {(error || message) && (
        <div className={`banner ${error ? "banner-error" : "banner-ok"}`}>{error ?? message}</div>
      )}

      <label>
        Default delivery address
        <input
          value={data.default_delivery_address}
          onChange={(e) => patch({ default_delivery_address: e.target.value })}
          placeholder={DEFAULT_DELIVERY_SCHEDULING.default_delivery_address}
        />
      </label>

      <div className="grid-2">
        <label>
          Warehouse contact name
          <input
            value={data.warehouse_contact_name}
            onChange={(e) => patch({ warehouse_contact_name: e.target.value })}
          />
        </label>
        <label>
          Warehouse contact email
          <input
            type="email"
            value={data.warehouse_contact_email}
            onChange={(e) => patch({ warehouse_contact_email: e.target.value })}
          />
        </label>
        <label>
          Warehouse cell
          <input
            value={data.warehouse_contact_cell}
            onChange={(e) => patch({ warehouse_contact_cell: e.target.value })}
          />
        </label>
        <label>
          Main office phone
          <input
            value={data.warehouse_main_office}
            onChange={(e) => patch({ warehouse_main_office: e.target.value })}
          />
        </label>
      </div>

      <label>
        Receiving hours
        <input
          value={data.receiving_hours}
          onChange={(e) => patch({ receiving_hours: e.target.value })}
        />
      </label>

      <label>
        Dock restrictions
        <textarea
          rows={2}
          value={data.dock_restrictions}
          onChange={(e) => patch({ dock_restrictions: e.target.value })}
        />
      </label>

      <label>
        Is a lift gate needed?
        <textarea
          rows={2}
          value={data.lift_gate_needed}
          onChange={(e) => patch({ lift_gate_needed: e.target.value })}
        />
      </label>

      <label>
        Closing note (printed at bottom of delivery section)
        <textarea
          rows={3}
          value={data.closing_note}
          onChange={(e) => patch({ closing_note: e.target.value })}
        />
      </label>

      <div className="row-gap">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save delivery settings"}
        </button>
      </div>
    </form>
  );
}
