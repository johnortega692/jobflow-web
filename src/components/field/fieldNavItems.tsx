import type { ReactNode } from "react";
import {
  FieldNavCalendarIcon,
  FieldNavManpowerIcon,
  FieldNavPaintIcon,
  FieldNavWallcoveringIcon,
  FieldNavWorkloadIcon,
} from "./FieldViewIcons";

export type FieldNavItem = {
  id: string;
  label: string;
  shortLabel: string;
  to?: string;
  external?: boolean;
  icon: ReactNode;
};

export const FIELD_NAV_ITEMS: FieldNavItem[] = [
  {
    id: "paint",
    label: "Paint",
    shortLabel: "Paint",
    to: "/field/paint",
    icon: <FieldNavPaintIcon />,
  },
  {
    id: "wallcovering",
    label: "Wallcovering",
    shortLabel: "Wallcvr",
    to: "/field/wallcovering",
    icon: <FieldNavWallcoveringIcon />,
  },
  {
    id: "calendar",
    label: "Calendar",
    shortLabel: "Calendar",
    to: "/field/calendar",
    icon: <FieldNavCalendarIcon />,
  },
  {
    id: "manpower",
    label: "Manpower",
    shortLabel: "Manpwr",
    external: true,
    icon: <FieldNavManpowerIcon />,
  },
  {
    id: "workload",
    label: "Workload",
    shortLabel: "Workload",
    to: "/field/workload",
    icon: <FieldNavWorkloadIcon />,
  },
];

export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
