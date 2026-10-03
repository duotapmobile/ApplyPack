import os
import subprocess
import tempfile
import zipfile
from pathlib import Path

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
  </office:text></office:body>
</office:document-content>""", compress_type=zipfile.ZIP_DEFLATED)
    profile = Path(work) / "profile"
    profile.mkdir()
    conversion = subprocess.run(
        ["libreoffice", "--headless", "--convert-to", "docx", "--outdir", work, str(odt)],
        check=True,
        capture_output=True,
        env={"HOME": str(profile), "PATH": os.environ.get("PATH", "")},
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
    assert result["outboundNetwork"] is False and result["pageCount"] == 1
    assert "LiberationSans" in result["fontInfo"]
    assert len(result["documentFontSha256"]) == 64
    print("OFFLINE_RENDER_OK")
    print("FONT_SHA256=" + result["documentFontSha256"])
