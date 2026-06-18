"""Build Jinja context for RFI PDF from web app project + RFI payload."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
_API_ROOT = Path(__file__).resolve().parent
_DESKTOP_ROOT = _API_ROOT.parents[1]
DEFAULT_COMPANY_NAME = os.environ.get("JOBFLOW_COMPANY_NAME", "Plan B Apps")
DEFAULT_COMPANY_ADDR = os.environ.get("JOBFLOW_COMPANY_ADDRESS", "")
DEFAULT_COMPANY_PHONE = os.environ.get("JOBFLOW_COMPANY_PHONE", "")


def _attachments_list(form: dict[str, Any]) -> list[str]:
    att: list[str] = []
    if form.get("attach_photos"):
        att.append("Field Photo(s)")
    if form.get("attach_markup"):
        att.append("Marked-up PDF / Clouded Drawing")
    if form.get("attach_submittal"):
        att.append("Submittal / Product Data Sheet")
    other = (form.get("attach_other") or "").strip()
    if other:
        att.append(other)
    return att


def _logo_path() -> str | None:
    for base in (ASSETS_DIR, _API_ROOT, _DESKTOP_ROOT):
        for name in ("companylogo.png", "logo.png", "logo.ico"):
            path = base / name
            if path.is_file():
                return str(path.resolve())
    return None


def build_rfi_template_context(project: dict[str, Any], rfi: dict[str, Any]) -> dict[str, Any]:
    form = rfi.get("data") or {}
    if not isinstance(form, dict):
        form = {}

    company_name = DEFAULT_COMPANY_NAME
    company_addr = DEFAULT_COMPANY_ADDR
    company_phone = DEFAULT_COMPANY_PHONE
    company_addr2 = ""
    company_lic = ""

    parts = [x.strip() for x in (company_addr, company_phone, company_lic) if x and str(x).strip()]
    company_contact_line = " | ".join(parts)
    letterhead = company_name
    safe_foot = letterhead.replace('"', "'").replace("\r", " ").replace("\n", " ")
    company_footer_sep = f"  |  {safe_foot}" if safe_foot else ""

    logo = _logo_path()

    return {
        "rfi_number": (rfi.get("rfi_number") or "001").strip(),
        "date_submitted": (form.get("rfi_date") or "").strip(),
        "due_date": (form.get("due_date") or "").strip(),
        "to_name": (form.get("to_name") or "").strip(),
        "attn_name": (form.get("attn_name") or "").strip(),
        "from_name": (form.get("from_name") or "").strip(),
        "subject": (rfi.get("subject") or "").strip(),
        "spec_ref": (form.get("spec_ref") or "").strip(),
        "drawing_ref": (form.get("drawing_ref") or "").strip(),
        "detail_no": (form.get("detail_no") or "").strip(),
        "project_name": (project.get("job_name") or "").strip(),
        "job_number": (project.get("job_number") or "").strip(),
        "project_address": (project.get("job_address") or "").strip(),
        "project_address2": (project.get("job_address2") or "").strip(),
        "contractor": (project.get("contractor") or "").strip(),
        "architect": (project.get("architect") or "").strip(),
        "owner": (project.get("owner") or "").strip(),
        "request_text": (form.get("question") or rfi.get("question") or "").strip(),
        "solution_text": (form.get("solution_text") or "").strip(),
        "impact_notes": (form.get("impact_notes") or "").strip(),
        "cost_change": form.get("cost_change") or "TBD",
        "sched_change": form.get("sched_change") or "TBD",
        "attachments": _attachments_list(form),
        "status": "Open",
        "pdf_show_solution": form.get("pdf_show_solution", True),
        "pdf_show_response": form.get("pdf_show_response", True),
        "reason_insufficient": bool(form.get("reason_insufficient")),
        "reason_conflict": bool(form.get("reason_conflict")),
        "reason_alternate": bool(form.get("reason_alternate")),
        "action_clarification": bool(form.get("action_clarification")),
        "action_direction": bool(form.get("action_direction")),
        "action_approval": bool(form.get("action_approval")),
        "effect_increase_cost": bool(form.get("effect_increase_cost")),
        "effect_decrease_cost": bool(form.get("effect_decrease_cost")),
        "effect_unknown_cost": bool(form.get("effect_unknown_cost")),
        "effect_increase_time": bool(form.get("effect_increase_time")),
        "effect_decrease_time": bool(form.get("effect_decrease_time")),
        "effect_unknown_time": bool(form.get("effect_unknown_time")),
        "company_display": letterhead,
        "company_addr": company_addr,
        "company_addr2": company_addr2,
        "company_phone": company_phone,
        "company_lic": company_lic,
        "company_contact_line": company_contact_line,
        "company_footer_sep": company_footer_sep,
        "logo_url": logo,
    }


def safe_pdf_filename(rfi_number: str, subject: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]', "_", subject or "RFI")[:35]
    return f"RFI-{rfi_number}_{safe}.pdf"
