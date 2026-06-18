"""
WeasyPrint on Windows needs Pango/GTK DLLs (not installed by pip alone).

Call configure_weasyprint_environment() before importing weasyprint.
Set WEASYPRINT_DLL_DIRECTORIES in .env or install via scripts/install_weasyprint_windows.ps1

When distributing JobFlow.exe, copy a ``weasyprint_dlls`` folder next to the exe
(see scripts/copy_weasyprint_dlls_for_build.ps1).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_GOBJECT_DLL = "libgobject-2.0-0.dll"
_HARFBUZZ_SUBSET_DLL = "libharfbuzz-subset-0.dll"

# Known-good install locations (MSYS2, GTK3-Runtime installer).
_DLL_SEARCH_DIRS = (
    r"C:\msys64\mingw64\bin",
    r"C:\tools\msys64\mingw64\bin",
    r"C:\Program Files\GTK3-Runtime Win64\bin",
    r"C:\Program Files (x86)\GTK3-Runtime Win64\bin",
)

# Folders that often ship older HarfBuzz and break WeasyPrint (hb_calloc missing).
_UNTRUSTED_DLL_DIR_MARKERS = (
    os.path.join("inkscape", "bin"),
    os.path.join("gimp", "bin"),
)


def _dir_has_gobject(dll_dir: str) -> bool:
    return os.path.isfile(os.path.join(dll_dir, _GOBJECT_DLL))


def _is_untrusted_dll_dir(path: str) -> bool:
    norm = os.path.normpath(path).lower()
    return any(marker in norm for marker in _UNTRUSTED_DLL_DIR_MARKERS)


def _portable_weasyprint_dll_dirs() -> list[str]:
    """``weasyprint_dlls`` next to the exe or under the app folder (dev + frozen)."""
    candidates: list[str] = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.extend(
            [
                os.path.join(exe_dir, "weasyprint_dlls"),
                os.path.join(exe_dir, "gtk3_runtime", "bin"),
                os.path.join(exe_dir, "mingw64", "bin"),
            ]
        )
    try:
        from json_config import get_app_base_dir

        base = get_app_base_dir()
    except Exception:
        base = os.path.dirname(os.path.abspath(__file__))
    for rel in (
        "weasyprint_dlls",
        os.path.join("JobFlow", "weasyprint_dlls"),
        os.path.join("dist", "JobFlow", "weasyprint_dlls"),
    ):
        candidates.append(os.path.join(base, rel))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "weasyprint_dlls"))
    found: list[str] = []
    seen: set[str] = set()
    for path in candidates:
        path = os.path.normpath(path)
        if path in seen or not _dir_has_gobject(path):
            continue
        seen.add(path)
        found.append(path)
    return found


def _frozen_bundle_dll_dirs() -> list[str]:
    """DLL folders shipped beside JobFlow.exe (portable WeasyPrint runtime)."""
    return _portable_weasyprint_dll_dirs() if getattr(sys, "frozen", False) else []


def discover_weasyprint_dll_directories() -> list[str]:
    """Return existing directories that contain WeasyPrint's GTK/Pango DLLs."""
    found: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        path = os.path.normpath(path.strip().strip('"'))
        if not path or path in seen:
            return
        if _is_untrusted_dll_dir(path):
            return
        if _dir_has_gobject(path):
            seen.add(path)
            found.append(path)

    # Bundled copy beside exe / JobFlow folder — prefer over MSYS2 + Inkscape on PATH
    for candidate in _portable_weasyprint_dll_dirs():
        add(candidate)

    env_val = os.environ.get("WEASYPRINT_DLL_DIRECTORIES", "").strip()
    if env_val:
        for part in env_val.split(os.pathsep):
            add(part)

    for candidate in _DLL_SEARCH_DIRS:
        add(candidate)

    return found


def _build_weasyprint_subprocess_env(dll_dirs: list[str] | None = None) -> dict:
    """
    Child-process environment for PDF rendering.

    Inkscape/GIMP on PATH often ship older HarfBuzz DLLs that crash WeasyPrint
    (access violation). Prepend our DLL folders and strip those paths.
    """
    dirs = dll_dirs if dll_dirs is not None else discover_weasyprint_dll_directories()
    env = os.environ.copy()
    if dirs:
        env["WEASYPRINT_DLL_DIRECTORIES"] = os.pathsep.join(dirs)
    path_parts: list[str] = []
    for dll_dir in dirs:
        if dll_dir and dll_dir not in path_parts:
            path_parts.append(dll_dir)
    for part in env.get("PATH", "").split(os.pathsep):
        part = part.strip()
        if not part or part in path_parts:
            continue
        low = part.lower()
        if "inkscape" in low or "gimp" in low:
            continue
        path_parts.append(part)
    env["PATH"] = os.pathsep.join(path_parts)
    return env


def _register_dll_directories(dirs: list[str]) -> None:
    """
    Prefer our DLL folders over PATH (Inkscape, etc.) on Windows 10+.
    """
    if sys.platform != "win32" or not dirs:
        return
    add_dll = getattr(os, "add_dll_directory", None)
    if not add_dll:
        return
    for dll_dir in dirs:
        try:
            add_dll(dll_dir)
        except OSError:
            continue


def configure_weasyprint_environment() -> list[str]:
    """
    Set WEASYPRINT_DLL_DIRECTORIES and register DLL search paths (Windows).
    Returns the directories that were configured.
    """
    dirs = discover_weasyprint_dll_directories()
    if not dirs:
        return []

    existing = os.environ.get("WEASYPRINT_DLL_DIRECTORIES", "")
    merged: list[str] = []
    seen: set[str] = set()
    for part in (existing.split(os.pathsep) if existing else []) + dirs:
        part = part.strip()
        if part and part not in seen and not _is_untrusted_dll_dir(part):
            seen.add(part)
            merged.append(part)

    # WeasyPrint loads DLLs from this list; do not prepend mingw64 to PATH (that can
    # shadow the app's Python with MSYS2's python.exe).
    os.environ["WEASYPRINT_DLL_DIRECTORIES"] = os.pathsep.join(merged)
    _register_dll_directories(merged)

    return merged


def weasyprint_import_error_message(exc: BaseException | None = None) -> str:
    """User-facing instructions when WeasyPrint cannot load native libraries."""
    detail = f"\n\nTechnical detail: {exc}" if exc else ""
    inkscape_note = ""
    if sys.platform == "win32":
        inkscape_note = (
            "\n\nIf the error mentions Inkscape or hb_calloc, another program put an "
            "older HarfBuzz DLL on PATH. Fix: copy the weasyprint_dlls folder next to "
            "JobFlow.exe, or install GTK3-Runtime / MSYS2 Pango and set "
            "WEASYPRINT_DLL_DIRECTORIES in a .env file beside the exe.\n"
        )
    return (
        "PDF generation needs WeasyPrint's Windows libraries (Pango/GTK), which are "
        "not on this PC yet.\n\n"
        "Fix (one-time, ~5 minutes):\n"
        "  1. Copy the weasyprint_dlls folder into the JobFlow install folder, OR\n"
        "  2. Install GTK3-Runtime Win64 or run scripts/install_weasyprint_windows.ps1 "
        "on a dev machine and set WEASYPRINT_DLL_DIRECTORIES in .env next to JobFlow.exe\n"
        "  3. Restart JobFlow.\n\n"
        "Or set WEASYPRINT_DLL_DIRECTORIES in .env to the folder that contains "
        f"{_GOBJECT_DLL} (often C:\\msys64\\mingw64\\bin).\n"
        "Docs: https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#windows"
        f"{inkscape_note}{detail}"
    )


def _subprocess_no_console_kw() -> dict:
    if sys.platform == "win32":
        flag = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if flag:
            return {"creationflags": flag}
    return {}


def weasyprint_render_crash_message() -> str:
    return (
        "The PDF engine crashed while rendering. On Windows this usually means missing or "
        "conflicting WeasyPrint DLLs (Pango/GTK).\n\n"
        "Fix:\n"
        "  1. Copy the weasyprint_dlls folder next to JobFlow.exe, OR\n"
        "  2. Install GTK3-Runtime Win64 or run scripts/install_weasyprint_windows.ps1\n"
        "  3. Set WEASYPRINT_DLL_DIRECTORIES in a .env file beside JobFlow.exe\n"
        "  4. Restart JobFlow and try again."
    )


def _weasyprint_worker_command(payload_path: str) -> list[str]:
    """Build argv for the isolated PDF worker (JobFlow.exe or python main.py)."""
    if getattr(sys, "frozen", False):
        # When running inside a PyInstaller-frozen bundle, using sys.executable
        # (JobFlow.exe) as the worker can crash again (nested bundle + DLL loading).
        #
        # Instead, run the render step using system Python so WeasyPrint uses the
        # DLL environment we sanitized in the parent process.
        #
        # We load modules from the extracted PyInstaller folder:
        #   <bundle_dir>\_internal\*.py
        bundle_dir = os.path.dirname(os.path.abspath(sys.executable))
        internal_dir = os.path.join(bundle_dir, "_internal")
        dll_dir = os.path.join(bundle_dir, "weasyprint_dlls")

        code = (
            "import json, os, sys; "
            f"sys.path.insert(0, {internal_dir!r});"
            f"sys.path.insert(0, {bundle_dir!r});"
            f"os.environ['WEASYPRINT_DLL_DIRECTORIES'] = {dll_dir!r};"
            f"os.environ['WEASYPRINT_DLL_DIRECTORIES'] = os.environ.get('WEASYPRINT_DLL_DIRECTORIES', {dll_dir!r});"
            "from json_config import load_env_file; "
            f"load_env_file(base_dir={bundle_dir!r}); "
            "from weasyprint_env import configure_weasyprint_environment, get_weasyprint_html_class; "
            "configure_weasyprint_environment(); "
            "payload=json.load(open(sys.argv[1], encoding='utf-8')); "
            "HTML=get_weasyprint_html_class(); "
            "HTML(string=payload['html'], base_url=payload.get('base_url')).write_pdf(payload['output']);"
        )
        # `py -3` ensures we hit a real Python install (not Inkscape's shim).
        return ["py", "-3", "-c", code, payload_path]
    main_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
    if os.path.isfile(main_script):
        return [sys.executable, main_script, "--weasyprint-write-pdf", payload_path]
    return [sys.executable, "--weasyprint-write-pdf", payload_path]


def write_pdf_from_html(
    html_content: str,
    output_path: str,
    base_url: str | None = None,
    *,
    isolated: bool | None = None,
    timeout_seconds: int = 300,
) -> tuple[bool, str | None]:
    """
    Render HTML to PDF. On Windows, uses a child process by default so native
    WeasyPrint crashes do not close JobFlow.
    Returns (ok, error_message).
    """
    if isolated is None:
        isolated = sys.platform == "win32"

    if not isolated:
        try:
            HTML = get_weasyprint_html_class()
            HTML(string=html_content, base_url=base_url).write_pdf(output_path)
        except Exception as exc:
            return False, weasyprint_import_error_message(exc)
    else:
        payload = {"html": html_content, "output": os.path.abspath(output_path), "base_url": base_url}
        fd, payload_path = tempfile.mkstemp(suffix=".json", prefix="jf_weasyprint_")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f)
            cmd = _weasyprint_worker_command(payload_path)
            wp_env = _build_weasyprint_subprocess_env()
            try:
                result = subprocess.run(
                    cmd,
                    timeout=timeout_seconds,
                    capture_output=True,
                    text=True,
                    env=wp_env,
                    **_subprocess_no_console_kw(),
                )
            except subprocess.TimeoutExpired:
                return False, f"PDF generation timed out after {timeout_seconds} seconds."
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or "").strip()
                if result.returncode < 0 or "access violation" in detail.lower():
                    return False, weasyprint_render_crash_message()
                if detail:
                    return False, f"PDF generation failed:\n\n{detail}"
                return False, weasyprint_render_crash_message()
        finally:
            try:
                os.remove(payload_path)
            except OSError:
                pass

    if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
        return False, "PDF file was not created."
    return True, None


def check_weasyprint_available() -> tuple[bool, str | None]:
    """
    Verify WeasyPrint can import and write a tiny test PDF.
    Returns (ok, error_message).
    """
    configure_weasyprint_environment()
    try:
        from weasyprint import HTML  # noqa: F401
    except Exception as e:
        return False, weasyprint_import_error_message(e)

    fd, tmp_path = tempfile.mkstemp(suffix=".pdf", prefix="jf_weasyprint_test_")
    os.close(fd)
    try:
        ok, err = write_pdf_from_html(
            "<html><body><p>JobFlow PDF test</p></body></html>",
            tmp_path,
            isolated=(sys.platform == "win32"),
            timeout_seconds=120,
        )
        if not ok:
            return False, err or weasyprint_render_crash_message()
        return True, None
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def get_weasyprint_html_class():
    """Import and return weasyprint.HTML after configuring DLL paths."""
    configure_weasyprint_environment()
    try:
        from weasyprint import HTML
        return HTML
    except Exception as e:
        raise RuntimeError(weasyprint_import_error_message(e)) from e
