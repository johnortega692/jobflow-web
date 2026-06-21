export type SettingsSectionActions = {
  save: () => Promise<boolean>;
  discard: () => void | Promise<void>;
  getIsDirty: () => boolean;
};

export type SettingsSectionBindings = {
  /** When true, show shared org settings but disable saves (non-admin). */
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBindActions?: (actions: SettingsSectionActions) => void;
};
