type Props = {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export function CorFlagButton({ on, disabled, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`filter-chip project-notes-cor-toggle${on ? " project-notes-cor-toggle--on" : ""}`}
      aria-pressed={on}
      disabled={disabled}
      title="Change order request. An open COR note shows in Needs attention."
      onClick={onToggle}
    >
      COR
    </button>
  );
}
