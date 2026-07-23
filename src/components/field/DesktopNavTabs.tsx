import { NavLink } from "react-router-dom";
import { FIELD_NAV_ITEMS } from "./fieldNavItems";

export function DesktopNavTabs() {
  return (
    <nav className="field-desktop-nav" aria-label="Field view sections">
      {FIELD_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.to!}
          className={({ isActive }) => `field-desktop-nav-link${isActive ? " active" : ""}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
