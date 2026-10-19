import os
import subprocess
import sys
import tempfile
import types
import zipfile
from pathlib import Path

# The container includes boto3, but this offline render check never contacts AWS.
# Keep the local smoke independent of a developer-machine SDK installation.
sys.modules.setdefault("boto3", types.SimpleNamespace(client=lambda _service: None))
if os.name == "nt":
    os.environ.setdefault("LIBREOFFICE_BIN", r"C:\Program Files\LibreOffice\program\soffice.exe")
    fonts = Path(os.environ.get("APPLYPACK_LIBERATION_SANS_DIRECTORY", r"C:\Windows\Fonts"))
    os.environ.setdefault("LIBERATION_SANS_REGULAR_FONT_PATH", str(fonts / "LiberationSans-Regular.ttf"))
    os.environ.setdefault("LIBERATION_SANS_BOLD_FONT_PATH", str(fonts / "LiberationSans-Bold.ttf"))
    os.environ.setdefault("LIBERATION_SANS_ITALIC_FONT_PATH", str(fonts / "LiberationSans-Italic.ttf"))
    os.environ.setdefault("LIBERATION_SANS_BOLD_ITALIC_FONT_PATH", str(fonts / "LiberationSans-BoldItalic.ttf"))

import handler


class MemoryS3:
    def __init__(self):
        self.objects = {}

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = bytes(kwargs["Body"])


with tempfile.TemporaryDirectory(prefix="applypack-worker-smoke-") as work:
    odt = Path(work) / "synthetic.odt"
    with zipfile.ZipFile(odt, "w") as package:
        package.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
        package.writestr("META-INF/manifest.xml", """<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>""", compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("content.xml", """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">
  <office:body><office:text>
    <text:h text:outline-level="1">Synthetic Candidate</text:h>
    <text:p>Operations coordinator</text:p>
    <text:h text:outline-level="1">Experience</text:h>
    <text:p>Coordinated accurate records and customer follow-up. This document contains synthetic test data only.</text:p>
    <text:p>ApplyPack synthetic extraction and render probe</text:p>
  </office:text></office:body>
</office:document-content>""", compress_type=zipfile.ZIP_DEFLATED)
    profile = Path(work) / "profile"
    profile.mkdir()
    conversion = subprocess.run(
        [os.environ.get("LIBREOFFICE_BIN", "libreoffice"), "--headless", "--convert-to", "docx", "--outdir", work, str(odt)],
        check=True,
        capture_output=True,
        env={**os.environ, "HOME": str(profile)},
    )
    source = Path(work) / "synthetic.docx"
    if not source.is_file():
        raise RuntimeError(f"DOCX conversion failed: {conversion.stdout}\n{conversion.stderr}\n{list(Path(work).iterdir())}")
    docx = source.read_bytes()
    memory = MemoryS3()
    handler.s3 = memory
    result = handler._render_docx(
        docx,
        {
            "bucket": "offline-smoke",
            "key": "ephemeral/00000000-0000-4000-8000-000000000001",
            "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "expectedPages": 1,
            "artifactType": "RESUME",
        },
        {"expanded": 52_428_800, "pages": 2, "milliseconds": 30_000},
    )
    pdf = memory.objects["ephemeral/00000000-0000-4000-8000-000000000001.render.pdf"]
    assert pdf.startswith(b"%PDF-")
    assert memory.objects["ephemeral/00000000-0000-4000-8000-000000000001.page-1.png"].startswith(b"\x89PNG")
    # Offline rendering validates output determinism only. Network isolation and
    # immutable Lambda identity require the deployed provider-backed probe.
    assert result["pageCount"] == 1
    assert "LiberationSans" in result["fontInfo"]
    assert result["documentFontFamily"] == "Liberation Sans"
    assert result["documentFontVersion"] == "2.1.5"
    assert result["documentFontManifestSha256"] == "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb"
    assert result["documentFontStyleSha256"] == {
        "regular": "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
        "bold": "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173",
        "italic": "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0",
        "boldItalic": "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee",
    }
    probe = handler._probe_document(
        docx,
        {"expanded": 2_097_152, "pages": 2, "milliseconds": 30_000},
    )
    assert probe == {
        "renderedPdfHeader": "%PDF-",
        "pageCount": 1,
        "docxExtractionVerified": True,
        "renderedTextVerified": True,
    }
    print("OFFLINE_RENDER_OK")
    print("FONT_SHA256=" + result["documentFontSha256"])
