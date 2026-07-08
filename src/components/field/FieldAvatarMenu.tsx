import { useEffect, useId, useRef, useState } from "react";
import { FieldDesktopIcon, FieldMobileIcon, FieldMoonIcon, FieldSunIcon } from "./FieldViewIcons";
import { userInitials } from "./fieldNavItems";

type Props = {
  name: string;
  role: string;
  darkMode: boolean;
  setDarkMode: (value: boolean) => void;
  mobileView: boolean;
  setMobileView: (value: boolean) => void;
  onSignOut: () => void;
};

export function FieldAvatarMenu({
  name,
  role,
  darkMode,
  setDarkMode,
  mobileView,
  setMobileView,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const initials = userInitials(name);

  return (
    <div className="field-avatar-menu" ref={rootRef}>
      <button
        type="button"
        className="field-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="field-avatar-btn-initials">{initials}</span>
      </button>

      {open ? (
        <div id={menuId} className="field-avatar-dropdown" role="menu">
          <div className="field-avatar-dropdown-header" role="presentation">
            <strong>{name}</strong>
            {role ? <span>{role}</span> : null}
          </div>

          <button
            type="button"
            role="menuitem"
            className="field-avatar-dropdown-item"
            onClick={() => setDarkMode(!darkMode)}
          >
            {darkMode ? <FieldSunIcon /> : <FieldMoonIcon />}
            <span>{darkMode ? "Light mode" : "Dark mode"}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className="field-avatar-dropdown-item"
            onClick={() => setMobileView(!mobileView)}
          >
            {mobileView ? <FieldDesktopIcon /> : <FieldMobileIcon />}
            <span>{mobileView ? "Desktop view" : "Mobile view"}</span>
          </button>

          <div className="field-avatar-dropdown-divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="field-avatar-dropdown-item field-avatar-dropdown-item--danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
