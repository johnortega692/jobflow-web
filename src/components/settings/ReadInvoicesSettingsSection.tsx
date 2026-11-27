import { useEffect, useState } from "react";
import { deleteCustomInvoiceReader, listCustomInvoiceReaders, saveCustomInvoiceReader } from "../../lib/invoiceReaders/customInvoiceReaders";
import { customReaderId, reservedInvoiceVendor, type CustomInvoiceReader } from "../../lib/invoiceReaders/genericInvoice";
import { readCustomInvoicePreview } from "../../lib/invoiceReaders/readInvoiceAi";
import { invoiceReaderChoices } from "../../lib/invoiceReaders/readInvoice";
import type { ParsedInvoice } from "../../lib/invoiceReaders/types";
import { extractPdfTextPages } from "../../lib/pdfTextExtract";
import type { SettingsSectionBindings } from "./settingsSectionTypes";
import { SharedSettingsNotice } from "./SharedSettingsNotice";

function lineCount(invoices: ParsedInvoice[]): number {
  return invoices.reduce((sum, invoice) => sum + invoice.lines.length, 0);
}

export function ReadInvoicesSettingsSection({
  readOnly = false,
  onDirtyChange,
  onBindActions,
}: SettingsSectionBindings) {
  const [readers, setReaders] = useState<CustomInvoiceReader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [catalog, setCatalog] = useState(false);
  const [sampleName, setSampleName] = useState("");
  const [preview, setPreview] = useState<ParsedInvoice[] | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onDirtyChange?.(false);
    onBindActions?.({
      save: async () => true,
      discard() {},
      getIsDirty: () => false,
    });
  }, [onBindActions, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    listCustomInvoiceReaders()
      .then((rows) => {
        if (!cancelled) setReaders(rows);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load invoice vendors.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function readSample(file: File) {
    setReading(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    setPreviewNote(null);
    setSampleName(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pages = await extractPdfTextPages(bytes.buffer);
      const pdfText = pages.flat().map((row) => row.map((frag) => frag.str).join(" ")).join("\n");
      const vendorName = name.trim();
      const { file: parsed, nameMatches } = await readCustomInvoicePreview(bytes, {
        id: customReaderId(vendorName) || "custom-preview",
        vendorName,
        catalog,
      }, pdfText);
      const invoices = parsed.invoices;
      if (invoices.length === 0 || lineCount(invoices) === 0) {
        setPreviewNote("No priced lines were found on this invoice.");
        return;
      }
      setPreview(invoices);
      if (!nameMatches) {
        setPreviewNote("These lines were read, and the PDF does not show that vendor name. Later invoices are recognized by the name printed on them.");
      }
    } catch (reason: unknown) {
      setPreviewNote(reason instanceof Error ? reason.message : "Could not read that PDF.");
    } finally {
      setReading(false);
    }
  }

  async function addVendor() {
    const vendorName = name.trim();
    if (!preview || lineCount(preview) === 0) return;
    if (reservedInvoiceVendor(vendorName)) {
      setError(`${vendorName} already has a reader.`);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveCustomInvoiceReader(vendorName, catalog);
      setReaders((current) => [saved, ...current.filter((reader) => reader.id !== saved.id)]);
      setName("");
      setCatalog(false);
      setPreview(null);
      setPreviewNote(null);
      setSampleName("");
      setMessage(`${saved.vendorName} is ready in Invoice Check.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not save that vendor.");
    } finally {
      setSaving(false);
    }
  }

  async function removeVendor(reader: CustomInvoiceReader) {
    if (!window.confirm(`Remove ${reader.vendorName} from Invoice Check?`)) return;
    setError(null);
    setMessage(null);
    try {
      await deleteCustomInvoiceReader(reader.id);
      setReaders((current) => current.filter((item) => item.id !== reader.id));
      setMessage(`${reader.vendorName} was removed.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not remove that vendor.");
    }
  }

  const canSave = Boolean(preview && lineCount(preview) > 0 && name.trim().length >= 2 && !previewNote && !readOnly && !saving);

  return (
    <div className="stack">
      <h2>Read invoices</h2>
      <p className="muted small">
        Add a vendor from a sample PDF. Claude reads the invoice, and you check the lines before saving.
        Later invoices from that vendor are read the same way.
        Paint vendors compare with the catalog. Others keep stamp, print, and the copy buttons.
      </p>
      {readOnly ? <SharedSettingsNotice /> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}
      {message ? <div className="banner banner-ok">{message}</div> : null}

      <section className="stack">
        <h3>Vendors</h3>
        {loading ? <p className="muted">Loading invoice vendors…</p> : null}
        <table className="material-prices-table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Use</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invoiceReaderChoices.map((choice) => (
              <tr key={choice.id}>
                <td>{choice.vendorName}</td>
                <td>{choice.catalog ? "Paint" : "Others"}</td>
                <td className="muted small">Built in</td>
              </tr>
            ))}
            {readers.map((reader) => (
              <tr key={reader.id}>
                <td>{reader.vendorName}</td>
                <td>{reader.catalog ? "Paint" : "Others"}</td>
                <td>
                  <button type="button" className="btn btn-ghost" disabled={readOnly} onClick={() => void removeVendor(reader)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="stack">
        <h3>Add a vendor</h3>
        <label>
          Vendor name
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setPreview(null);
              setPreviewNote(null);
            }}
            placeholder="Vendor name as printed on the invoice"
            disabled={readOnly || saving}
          />
        </label>
        <label>
          Use
          <select
            value={catalog ? "paint" : "others"}
            disabled={readOnly || saving}
            onChange={(event) => setCatalog(event.target.value === "paint")}
          >
            <option value="paint">Paint, compare with the catalog</option>
            <option value="others">Others, stamp and print</option>
          </select>
        </label>
        <label>
          Sample PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={readOnly || reading || saving || name.trim().length < 2}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readSample(file);
            }}
          />
        </label>
        {sampleName ? <p className="muted small">{reading ? `Claude is reading ${sampleName}…` : sampleName}</p> : null}
        {previewNote ? <p className="muted small">{previewNote}</p> : null}
        {preview && lineCount(preview) > 0 ? (
          <table className="material-prices-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Qty</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {preview.flatMap((invoice) => invoice.lines).slice(0, 12).map((line, index) => (
                <tr key={`${line.description}-${index}`}>
                  <td>{line.description}</td>
                  <td>{line.qty}</td>
                  <td>${line.netPrice.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void addVendor()}>
          {saving ? "Saving…" : "Add vendor"}
        </button>
      </section>
    </div>
  );
}
