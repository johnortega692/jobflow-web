import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

/** Route state that tells the Projects page to open the New project form. */
export type ProjectsRouteState = { newProject?: boolean } | null;

function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <MenuIcon>
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </MenuIcon>
  );
}

function PaintBucketIcon() {
  return (
    <MenuIcon>
      <path d="M11 7 6 2" />
      <path d="M18.992 12H2.041" />
      <path d="M21.145 18.38A3.34 3.34 0 0 1 20 16.5a3.3 3.3 0 0 1-1.145 1.88c-.575.46-.855 1.02-.855 1.595A2 2 0 0 0 20 22a2 2 0 0 0 2-2.025c0-.58-.285-1.13-.855-1.595" />
      <path d="m8.5 4.5 2.148-2.148a1.205 1.205 0 0 1 1.704 0l7.296 7.296a1.205 1.205 0 0 1 0 1.704l-7.592 7.592a3.615 3.615 0 0 1-5.112 0l-3.888-3.888a3.615 3.615 0 0 1 0-5.112L5.67 7.33" />
    </MenuIcon>
  );
}

function CirclePlusIcon() {
  return (
    <MenuIcon>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M12 8v8" />
    </MenuIcon>
  );
}

export function ProjectsNavMenu() {
  const navigate = useNavigate();
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
      if (rootRef.current && target && !rootRef.current.contains(target)) setOpen(false);
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

  return (
    <div className="projects-nav-menu" ref={rootRef}>
      <Link to="/projects">Projects</Link>
      <button
        type="button"
        className="projects-nav-caret"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Projects menu"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {open ? <path d="M6 15l6 -6l6 6" /> : <path d="M6 9l6 6l6 -6" />}
        </svg>
      </button>
      {open ? (
        <div id={menuId} className="user-account-menu-dropdown projects-nav-dropdown" role="menu">
          <Link to="/projects/by-gc" role="menuitem" className="user-account-menu-item" onClick={() => setOpen(false)}>
            <BriefcaseIcon />
            <span>Projects by GC</span>
          </Link>
          <Link to="/projects/materials" role="menuitem" className="user-account-menu-item" onClick={() => setOpen(false)}>
            <PaintBucketIcon />
            <span>Materials</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className="user-account-menu-item projects-nav-item--accent"
            onClick={() => {
              setOpen(false);
              navigate("/projects", { state: { newProject: true } satisfies ProjectsRouteState });
            }}
          >
            <CirclePlusIcon />
            <span>New project</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
