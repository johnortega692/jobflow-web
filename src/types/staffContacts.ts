/** Named contact used on new projects and upcoming field apps. */
export type StaffContact = {
  id: string;
  name: string;
  email: string;
};

/** Office PM roster (Settings → Project staff). Supers/foremen live in Field Tools profiles. */
export type ProjectStaffSettings = {
  /** @deprecated Legacy — supers are managed in Field Tools. Ignored on save. */
  project_staff_supers?: StaffContact[];
  /** @deprecated Legacy — foremen are managed in Field Tools. Ignored on save. */
  project_staff_foremen?: StaffContact[];
  project_staff_pms: StaffContact[];
};
