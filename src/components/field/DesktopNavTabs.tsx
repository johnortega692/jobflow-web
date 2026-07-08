import { NavLink } from "react-router-dom";
import { FIELD_NAV_ITEMS } from "./fieldNavItems";

type Props = {
  onOpenManpower: () => void;
};

export function DesktopNavTabs({ onOpenManpower }: Props) {
  return (
    <nav className="field-desktop-nav" aria-label="Field view sections">
      {FIELD_NAV_ITEMS.map((item) =>
        item.external ? (
          <button
            key={item.id}
            type="button"
            className="field-desktop-nav-link"
            onClick={onOpenManpower}
          >
            {item.label}
          </button>
        ) : (
          <NavLink
            key={item.id}
            to={item.to!}
            className={({ isActive }) => `field-desktop-nav-link${isActive ? " active" : ""}`}
          >
            {item.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}
