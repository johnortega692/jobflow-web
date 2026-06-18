"""JobFlow PDF API — RFI export via WeasyPrint."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from jinja2 import Template
from pydantic import BaseModel, Field

_API_ROOT = Path(__file__).resolve().parent
_DESKTOP_ROOT = _API_ROOT.parents[1]  # local dev may still use desktop repo files

try:
    from weasyprint_env import configure_weasyprint_environment, get_weasyprint_html_class

    configure_weasyprint_environment()
except Exception:
    pass

from rfi_pdf import build_rfi_template_context, safe_pdf_filename

RFI_TEMPLATE = _API_ROOT / "rfi_template.html"
if not RFI_TEMPLATE.is_file():
    RFI_TEMPLATE = _DESKTOP_ROOT / "rfi_template.html"

app = FastAPI(title="JobFlow API", version="0.1.0")

_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$|https://[a-z0-9-]+\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RfiPdfRequest(BaseModel):
    project: dict = Field(default_factory=dict)
    rfi: dict = Field(default_factory=dict)


@app.get("/")
def root():
    return {"ok": True, "service": "jobflow-api", "health": "/health", "pdf": "POST /api/rfi/pdf"}


@app.get("/health")
def health():
    return {"ok": True, "service": "jobflow-api", "template": RFI_TEMPLATE.is_file()}


@app.post("/api/rfi/pdf")
def generate_rfi_pdf(body: RfiPdfRequest):
    project = body.project
    rfi = body.rfi
    subject = (rfi.get("subject") or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="RFI subject is required.")
    if not (project.get("job_name") or project.get("job_number")):
        raise HTTPException(status_code=400, detail="Project name or job number is required.")

    if not RFI_TEMPLATE.is_file():
        raise HTTPException(status_code=500, detail=f"Template missing: {RFI_TEMPLATE}")

    context = build_rfi_template_context(project, rfi)
    html_template = Template(RFI_TEMPLATE.read_text(encoding="utf-8"))
    html_str = html_template.render(**context)

    page_css = (
        "@page { size: Letter; margin-top: 0.25in; margin-right: 0.25in;"
        " margin-bottom: 0.75in; margin-left: 0.25in; }"
    )
    if "</head>" in html_str:
        html_str = html_str.replace("</head>", f"<style>{page_css}</style></head>", 1)
    else:
        html_str = f"<style>{page_css}</style>" + html_str

    try:
        WeasyHTML = get_weasyprint_html_class()
        pdf_bytes = WeasyHTML(string=html_str, base_url=str(_API_ROOT)).write_pdf()
    except Exception as exc:
        try:
            from weasyprint_env import weasyprint_import_error_message

            detail = weasyprint_import_error_message(exc)
        except Exception:
            detail = str(exc)
        raise HTTPException(status_code=500, detail=detail) from exc

    filename = safe_pdf_filename(context["rfi_number"], subject)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
