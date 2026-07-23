import { NavLink } from "react-router-dom";
import { FIELD_NAV_ITEMS } from "./fieldNavItems";

export function MobileTabBar() {
  return (
    <nav className="field-mobile-tab-bar" aria-label="Field view sections">
      {FIELD_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.id}
          to={item.to!}
          className={({ isActive }) => `field-mobile-tab${isActive ? " active" : ""}`}
        >
          {item.icon}
          <span className="field-mobile-tab-label">{item.shortLabel}</span>
        </NavLink>
      ))}
    </nav>
  );
}
