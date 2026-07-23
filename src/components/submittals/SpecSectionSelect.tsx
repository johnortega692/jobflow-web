import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { loadSpecSections, specSectionSelectOptions, withEnsuredSpecSection, DEFAULT_PAINT_SECONDARY_SPEC_SECTION } from "../../lib/specSections";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  optional?: boolean;
  id?: string;
};

export function SpecSectionSelect({ value, onChange, disabled, optional = true, id }: Props) {
  const { user } = useAuth();
  const [options, setOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadSpecSections(user?.id)
      .then((list) => {
        if (!cancelled) {
          // Keep exterior paint CSI available even if a custom org list omitted it.
          setOptions(withEnsuredSpecSection(list, DEFAULT_PAINT_SECONDARY_SPEC_SECTION));
        }
      })
      .catch(() => {
        if (!cancelled) setOptions([DEFAULT_PAINT_SECONDARY_SPEC_SECTION]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const selectOptions = specSectionSelectOptions(options, value);

  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {optional && <option value="">None / not applicable</option>}
      {selectOptions.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
