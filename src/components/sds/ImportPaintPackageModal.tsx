import { useMemo, useState } from "react";
import {
  paintPackageUseField,
  suggestPaintPackageTargets,
  type PaintPackageGroup,
} from "../../lib/paintPackageLink";
import { sectionHasAnyAttachment } from "../../lib/sdsSectionModel";
import type { SdsSection } from "../../types/tradeDocuments";

type Props = {
  groups: PaintPackageGroup[];
  sections: SdsSection[];
  onConfirm: (targets: Record<string, string | null>) => void;
  onClose: () => void;
};

function sectionChoiceLabel(section: SdsSection, index: number): string {
  const title = [section.manufacturer.trim(), section.product.trim()].filter(Boolean).join(" · ") || "Untitled";
  const finish = section.finish_type.trim();
  const spec = section.spec_section.trim();
  const sheets = sectionHasAnyAttachment(section) ? "has sheets" : "no sheets";
  return [`${index + 1}. ${title}`, finish, spec, sheets].filter(Boolean).join(" · ");
}

export function ImportPaintPackageModal({ groups, sections, onConfirm, onClose }: Props) {
  const suggested = useMemo(() => suggestPaintPackageTargets(groups, sections), [groups, sections]);
  const [targets, setTargets] = useState<Record<string, string | null>>(suggested);

  function choose(groupKey: string, value: string) {
    const nextId = value || null;
    setTargets((current) => {
      const next = { ...current, [groupKey]: nextId };
      if (nextId) {
        for (const key of Object.keys(next)) {
          if (key !== groupKey && next[key] === nextId) next[key] = null;
        }
      }
      return next;
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal card sds-paint-import"
        role="dialog"
        aria-labelledby="sds-paint-import-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sds-section-editor-header">
          <h3 id="sds-paint-import-title">Import from color schedule</h3>
          <p className="muted small">
            Put each product on a section already in this package, or add a new one. Sheets on the section you pick
            stay attached.
          </p>
        </header>
        <ul className="sds-paint-import-list">
          {groups.map((group) => {
            const marks = paintPackageUseField(group);
            const taken = new Set(
              Object.entries(targets)
                .filter(([key, id]) => key !== group.key && id)
                .map(([, id]) => id),
            );
            return (
              <li key={group.key} className="sds-paint-import-row">
                <div className="sds-paint-import-product">
                  <strong>{[group.product || group.manufacturer, group.sheen].filter(Boolean).join(" · ")}</strong>
                  {marks ? <p className="muted small">{marks}</p> : null}
                </div>
                <label className="sds-paint-import-target">
                  <span className="muted small">Use section</span>
                  <select
                    value={targets[group.key] ?? ""}
                    onChange={(event) => choose(group.key, event.target.value)}
                  >
                    <option value="">Add as new section</option>
                    {sections.map((section, index) => (
                      <option key={section.id} value={section.id} disabled={taken.has(section.id)}>
                        {sectionChoiceLabel(section, index)}
                      </option>
                    ))}
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="sds-paint-import-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(targets)}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
