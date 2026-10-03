import io
import hashlib
import json
import os
import re
import socket
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import boto3

IDENTITY = "applypack-document-worker-v1"
MAX_SOURCE = 10 * 1024 * 1024
s3 = boto3.client("s3")


def _runtime_attestation(context):
    image_uri = os.environ.get("APPLYPACK_WORKER_IMAGE_URI", "")
    digest = re.search(r"@sha256:([0-9a-f]{64})$", image_uri)
    function_arn = getattr(context, "invoked_function_arn", "")
    if not digest or not re.fullmatch(r"arn:aws:lambda:us-east-1:[0-9]{12}:function:[A-Za-z0-9-_]+:[1-9][0-9]*", function_arn):
        raise ValueError("worker_attestation_missing")
    network_isolation_verified = False
    try:
        connection = socket.create_connection(("1.1.1.1", 443), timeout=0.5)
        connection.close()
    except OSError:
        network_isolation_verified = True
    if not network_isolation_verified:
        raise ValueError("worker_outbound_network_available")
    return {
        "identity": IDENTITY,
        "functionVersionArn": function_arn,
        "imageDigest": digest.group(1),
        "networkIsolationVerified": True,
    }


def _bounded(event):
    limits = event.get("limits") or {}
    return {
        "expanded": min(int(limits.get("maxExpandedBytes", 52_428_800)), 52_428_800),
        "pages": min(int(limits.get("maxPages", 40)), 40),
        "milliseconds": min(int(limits.get("maxMilliseconds", 30_000)), 30_000),
    }


def _read(event):
    if not re.fullmatch(r"ephemeral/[0-9a-f-]{36}", str(event.get("key", ""))):
        raise ValueError("invalid_object_key")
    body = s3.get_object(Bucket=event["bucket"], Key=event["key"])["Body"].read(MAX_SOURCE + 1)
    if not body or len(body) > MAX_SOURCE:
        raise ValueError("source_bound")
    return body


def _docx_text(data, expanded):
    total = 0
    texts = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.file_size > expanded or ".." in Path(info.filename).parts:
                raise ValueError("archive_bound")
            total += info.file_size
            if total > expanded:
                raise ValueError("archive_bound")
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    for node in root.iter():
        if node.tag.endswith("}t") and node.text:
            texts.append(node.text)
    return "\n".join(texts)


def _pdf_text(data, limits):
    with tempfile.TemporaryDirectory(prefix="applypack-worker-") as work:
        source = Path(work) / "source.pdf"
        source.write_bytes(data)
        timeout = max(1, limits["milliseconds"] / 1000)
        info = subprocess.run(["pdfinfo", str(source)], capture_output=True, text=True, timeout=timeout, check=True)
        match = re.search(r"^Pages:\s+(\d+)\s*$", info.stdout, re.MULTILINE)
        pages = int(match.group(1)) if match else 0
        if pages < 1 or pages > limits["pages"]:
            raise ValueError("page_bound")
        text = subprocess.run(["pdftotext", "-layout", str(source), "-"], capture_output=True, text=True, timeout=timeout, check=True).stdout
        if len(text.encode("utf-8")) > min(limits["expanded"], 2_097_152):
            raise ValueError("text_bound")
        return text, pages


def _render_probe(data, limits):
    with tempfile.TemporaryDirectory(prefix="applypack-render-") as work:
        source = Path(work) / "probe.html"
        source.write_text("<html lang='en'><body><h1>ApplyPack readiness</h1><p>" + data.decode("utf-8", "replace") + "</p></body></html>", encoding="utf-8")
        subprocess.run([
            os.environ.get("LIBREOFFICE_BIN", "libreoffice"), "--headless", "--nologo", "--nodefault", "--nofirststartwizard",
            "--convert-to", "pdf", "--outdir", work, str(source)
        ], capture_output=True, timeout=max(1, limits["milliseconds"] / 1000), check=True,
            env={**os.environ, "HOME": work})
        rendered = (Path(work) / "probe.pdf").read_bytes()
        if len(rendered) < 5 or rendered[:5] != b"%PDF-":
            raise ValueError("render_invalid")
        return rendered[:5].decode("ascii")


def _font_sha256():
    configured = os.environ.get("LIBERATION_SANS_FONT_PATH")
    if configured:
        path = Path(configured)
        if not path.is_file():
            raise ValueError("font_unavailable")
        return hashlib.sha256(path.read_bytes()).hexdigest()
    match = subprocess.run(
        ["fc-match", "--format=%{file}", "Liberation Sans"],
        capture_output=True, text=True, timeout=5, check=True,
    ).stdout.strip()
    path = Path(match)
    if not path.is_file():
        raise ValueError("font_unavailable")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _render_docx(data, event, limits):
    if event.get("mimeType") != "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        raise ValueError("mime_type")
    expected_pages = int(event.get("expectedPages", 0))
    if expected_pages not in (1, 2) or event.get("artifactType") not in ("RESUME", "COVER_LETTER", "REFERENCE_SHEET"):
        raise ValueError("render_contract")
    deadline = time.monotonic() + min(limits["milliseconds"], 28_000) / 1000

    def run(arguments):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("render_timeout")
        return subprocess.run(arguments, capture_output=True, text=True, timeout=remaining, check=True)

    with tempfile.TemporaryDirectory(prefix="applypack-render-") as work:
        source = Path(work) / "artifact.docx"
        pdf = Path(work) / "artifact.pdf"
        image_prefix = Path(work) / "page"
        source.write_bytes(data)
        environment = {**os.environ, "HOME": work}
        remaining = deadline - time.monotonic()
        subprocess.run([
            os.environ.get("LIBREOFFICE_BIN", "libreoffice"), "--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore",
            "--convert-to", 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}',
            "--outdir", work, str(source),
        ], capture_output=True, text=True, timeout=max(0.1, remaining), check=True, env=environment)
        pdf_bytes = pdf.read_bytes()
        if not pdf_bytes.startswith(b"%PDF-") or len(pdf_bytes) > MAX_SOURCE:
            raise ValueError("render_invalid")
        info = run(["pdfinfo", str(pdf)])
        pages_match = re.search(r"^Pages:\s+(\d+)\s*$", info.stdout, re.MULTILINE)
        pages = int(pages_match.group(1)) if pages_match else 0
        if pages != expected_pages:
            raise ValueError("page_bound")
        metadata = run(["pdfinfo", "-meta", str(pdf)])
        structure = run(["pdfinfo", "-struct", str(pdf)])
        fonts = run(["pdffonts", str(pdf)])
        bounds = run(["pdftotext", "-bbox-layout", str(pdf), "-"])
        extracted = run(["pdftotext", "-layout", "-nopgbrk", str(pdf), "-"])
        if len(bounds.stdout.encode("utf-8")) > 2_097_152 or len(extracted.stdout.encode("utf-8")) > 2_097_152:
            raise ValueError("render_output_bound")
        run(["pdftoppm", "-png", "-r", "144", str(pdf), str(image_prefix)])
        images = sorted(Path(work).glob("page-*.png"))
        if len(images) != pages or any(image.stat().st_size > MAX_SOURCE for image in images):
            raise ValueError("render_image_bound")
        bucket = event["bucket"]
        source_key = event["key"]
        s3.put_object(Bucket=bucket, Key=source_key + ".render.pdf", Body=pdf_bytes,
                      ContentType="application/pdf", ServerSideEncryption="AES256")
        for index, image in enumerate(images, start=1):
            s3.put_object(Bucket=bucket, Key=source_key + f".page-{index}.png", Body=image.read_bytes(),
                          ContentType="image/png", ServerSideEncryption="AES256")
        return {
            "ok": True,
            "pageCount": pages,
            "documentFontSha256": _font_sha256(),
            "pdfInfo": info.stdout + "\n" + info.stderr,
            "pdfMetadata": metadata.stdout + "\n" + metadata.stderr,
            "structureTree": structure.stdout + "\n" + structure.stderr,
            "fontInfo": fonts.stdout + "\n" + fonts.stderr,
            "boundingXml": bounds.stdout,
            "extractedText": extracted.stdout,
        }


def lambda_handler(event, context):
    if event.get("schemaVersion") != 1:
        raise ValueError("schema_version")
    limits = _bounded(event)
    data = _read(event)
    operation = event.get("operation")
    attestation = _runtime_attestation(context)
    if operation == "probe-render":
        return {"ok": True, "renderedPdfHeader": _render_probe(data, limits),
                "documentFontSha256": _font_sha256(), **attestation}
    if operation == "render-docx":
        return {**_render_docx(data, event, limits), **attestation}
    if operation != "extract":
        raise ValueError("operation")
    mime = event.get("mimeType")
    if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        text = _docx_text(data, limits["expanded"])
        pages, pagination = None, "UNKNOWN"
    elif mime == "application/pdf":
        text, pages = _pdf_text(data, limits)
        pagination = "MEASURED"
    else:
        raise ValueError("mime_type")
    return {"ok": True, "text": text, "pageCount": pages, "paginationStatus": pagination, **attestation}
