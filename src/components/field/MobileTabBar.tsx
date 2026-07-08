import { NavLink } from "react-router-dom";
import { FIELD_NAV_ITEMS } from "./fieldNavItems";

type Props = {
  onOpenManpower: () => void;
};

export function MobileTabBar({ onOpenManpower }: Props) {
  return (
    <nav className="field-mobile-tab-bar" aria-label="Field view sections">
      {FIELD_NAV_ITEMS.map((item) =>
        item.external ? (
          <button
            key={item.id}
            type="button"
            className="field-mobile-tab"
            onClick={onOpenManpower}
          >
            {item.icon}
            <span className="field-mobile-tab-label">{item.shortLabel}</span>
          </button>
        ) : (
          <NavLink
            key={item.id}
            to={item.to!}
            className={({ isActive }) => `field-mobile-tab${isActive ? " active" : ""}`}
          >
            {item.icon}
            <span className="field-mobile-tab-label">{item.shortLabel}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}
