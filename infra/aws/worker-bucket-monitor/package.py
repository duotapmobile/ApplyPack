"""Build a deterministic local Lambda package. No provider calls or uploads."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile


def build_package():
    source = Path(__file__).with_name("handler.py").read_bytes()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        info = zipfile.ZipInfo("handler.py", date_time=(2026, 10, 25, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, source)
    data = output.getvalue()
    return data, {"schemaVersion": "applypack-document-worker-bucket-monitor-package-v1",
                  "sourceSha256": hashlib.sha256(source).hexdigest(), "zipSha256": hashlib.sha256(data).hexdigest(),
                  "lambdaCodeSha256": base64.b64encode(hashlib.sha256(data).digest()).decode("ascii"),
                  "bytes": len(data), "members": ["handler.py"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    data, receipt = build_package()
    output = Path(args.output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    target = output / (receipt["zipSha256"] + ".zip")
    receipt_path = output / "package-receipt.json"
    text = json.dumps(receipt, indent=2) + "\n"
    if target.exists() and target.read_bytes() != data:
        raise ValueError("BUCKET_MONITOR_PACKAGE_DESTINATION_MISMATCH")
    if receipt_path.exists() and receipt_path.read_text(encoding="utf-8") != text:
        raise ValueError("BUCKET_MONITOR_PACKAGE_RECEIPT_ALREADY_EXISTS")
    target.write_bytes(data)
    receipt_path.write_text(text, encoding="utf-8")
    print(json.dumps(receipt))
