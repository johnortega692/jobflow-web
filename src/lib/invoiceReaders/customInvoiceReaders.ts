import { supabase } from "../supabase";
import { customReaderId, reservedInvoiceVendor, type CustomInvoiceReader } from "./genericInvoice.ts";

type ReaderPayload = {
  ok?: boolean;
  error?: string;
  readers?: CustomInvoiceReader[];
  reader?: CustomInvoiceReader;
};

function payload(data: unknown): ReaderPayload {
  return data && typeof data === "object" ? data as ReaderPayload : {};
}

export async function listCustomInvoiceReaders(): Promise<CustomInvoiceReader[]> {
  const { data, error } = await supabase.rpc("jobflow_list_invoice_readers" as never);
  if (error) throw new Error(error.message);
  const body = payload(data);
  if (body.ok === false) throw new Error(body.error || "Could not load invoice vendors.");
  return (body.readers ?? []).filter((reader) => reader.id && reader.vendorName);
}

export async function saveCustomInvoiceReader(vendorName: string, catalog: boolean): Promise<CustomInvoiceReader> {
  const name = vendorName.trim();
  if (name.length < 2) throw new Error("Enter the vendor name.");
  if (!customReaderId(name)) throw new Error("Use a vendor name with letters or numbers.");
  if (reservedInvoiceVendor(name)) throw new Error(`${name} already has a reader.`);
  const { data, error } = await supabase.rpc("jobflow_admin_save_invoice_reader" as never, {
    p_vendor_name: name,
    p_catalog: catalog,
  } as never);
  if (error) throw new Error(error.message);
  const body = payload(data);
  if (!body.ok || !body.reader) throw new Error(body.error || "Could not save that vendor.");
  return body.reader;
}

export async function deleteCustomInvoiceReader(id: string): Promise<void> {
  const { data, error } = await supabase.rpc("jobflow_admin_delete_invoice_reader" as never, {
    p_id: id,
  } as never);
  if (error) throw new Error(error.message);
  const body = payload(data);
  if (body.ok === false) throw new Error(body.error || "Could not remove that vendor.");
}
