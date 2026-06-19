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

export type ContactDirectorySettings = {
  material_vendors: MaterialVendor[];
  architects: ArchitectEntry[];
};

export function emptyMaterialVendor(): MaterialVendor {
  return { name: "", email: "", phone: "", products: "" };
}

export function emptyArchitectEntry(): ArchitectEntry {
  return { company: "", address: "" };
}

export function defaultContactDirectory(): ContactDirectorySettings {
  return { material_vendors: [], architects: [] };
}
