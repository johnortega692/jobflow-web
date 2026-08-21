export type MaterialVendor = {
  name: string;
  email: string;
  phone: string;
  products: string;
};

export type ArchitectEntry = {
  company: string;
  address: string;
};

export type GcEntry = {
  name: string;
  address: string;
  office_phone: string;
};

export type ContactDirectorySettings = {
  material_vendors: MaterialVendor[];
  architects: ArchitectEntry[];
  general_contractors: GcEntry[];
};

export function emptyMaterialVendor(): MaterialVendor {
  return { name: "", email: "", phone: "", products: "" };
}

export function emptyArchitectEntry(): ArchitectEntry {
  return { company: "", address: "" };
}

export function emptyGcEntry(): GcEntry {
  return { name: "", address: "", office_phone: "" };
}

export function defaultContactDirectory(): ContactDirectorySettings {
  return { material_vendors: [], architects: [], general_contractors: [] };
}
