import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

/** Route state that tells the Projects page to open the New project form. */
export type ProjectsRouteState = { newProject?: boolean } | null;

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
            Projects by GC
          </Link>
          <Link to="/projects/materials" role="menuitem" className="user-account-menu-item" onClick={() => setOpen(false)}>
            Materials
          </Link>
          <button
            type="button"
            role="menuitem"
            className="user-account-menu-item"
            onClick={() => {
              setOpen(false);
              navigate("/projects", { state: { newProject: true } satisfies ProjectsRouteState });
            }}
          >
            New project
          </button>
        </div>
      ) : null}
    </div>
  );
}
