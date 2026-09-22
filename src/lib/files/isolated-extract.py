"""Runs only inside the network-less, resource-limited extraction sandbox."""
import sys, io, json, zipfile, re, subprocess, tempfile, pathlib
import xml.etree.ElementTree as ET
MAX_BYTES=10*1024*1024
limits=json.loads(sys.argv[1]) if len(sys.argv)>1 else {}
MAX_EXPANDED=min(int(limits.get('maxExpandedBytes',50*1024*1024)),50*1024*1024)
MAX_PAGES=min(int(limits.get('maxPages',40)),40)
if MAX_EXPANDED<1 or MAX_PAGES<1: raise ValueError('invalid_limits')
raw=sys.stdin.buffer.read(MAX_BYTES+1)
if not raw or len(raw)>MAX_BYTES: raise ValueError("input_bound")
if raw.startswith(b"%PDF-"):
    with tempfile.TemporaryDirectory() as directory:
        source=pathlib.Path(directory)/"input.pdf"; normalized=pathlib.Path(directory)/"normalized.pdf"
        source.write_bytes(raw)
        subprocess.run(["/usr/bin/qpdf","--qdf","--object-streams=disable",str(source),str(normalized)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=8)
        if normalized.stat().st_size>MAX_EXPANDED: raise ValueError("expanded_bound")
        data=normalized.read_bytes()
        data=re.sub(rb"#([0-9a-fA-F]{2})",lambda m: bytes([int(m.group(1),16)]),data)
        if re.search(rb"/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction|AA|XFA|Encrypt)\b",data,re.I): raise ValueError("active_pdf")
        info=subprocess.check_output(["/usr/bin/pdfinfo",str(source)],stderr=subprocess.DEVNULL,timeout=5).decode("utf8","replace")
        pages=int(re.search(r"^Pages:\s+(\d+)",info,re.M).group(1))
        if pages<1 or pages>MAX_PAGES: raise ValueError("page_bound")
        text=subprocess.check_output(["/usr/bin/pdftotext","-layout",str(source),"-"],stderr=subprocess.DEVNULL,timeout=8).decode("utf8","strict")
else:
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries=archive.infolist()
        if len(entries)>500 or sum(e.file_size for e in entries)>MAX_EXPANDED: raise ValueError("archive_bound")
        if len({e.filename for e in entries})!=len(entries): raise ValueError("duplicate_entry")
        for entry in entries:
            if entry.flag_bits&1 or ".." in pathlib.PurePosixPath(entry.filename).parts: raise ValueError("unsafe_entry")
            if re.search(r"vbaProject|activeX|embeddings|customUI",entry.filename,re.I): raise ValueError("active_docx")
            if entry.filename.endswith((".xml",".rels")):
                xml=archive.read(entry)
                if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper(): raise ValueError("xml_entity")
                root=ET.fromstring(xml)
                if entry.filename.endswith(".rels") and any(e.attrib.get("TargetMode","").lower()=="external" for e in root): raise ValueError("external_relationship")
        root=ET.fromstring(archive.read("word/document.xml"))
        ns="{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        if any(e.tag in (ns+"altChunk",ns+"object",ns+"instrText") for e in root.iter()): raise ValueError("active_docx")
        text="\n".join("".join(e.text or "" for e in p.iter(ns+"t")) for p in root.iter(ns+"p"))
        pages=None # Container text extraction cannot measure rendered DOCX pagination.
if len(text.encode("utf8"))>min(MAX_EXPANDED,2*1024*1024) or not text.strip(): raise ValueError("text_bound")
print(json.dumps({"text":text,"pageCount":pages,"paginationStatus":"MEASURED" if pages is not None else "UNKNOWN","reference":"isolated-extractor-v1"}))
