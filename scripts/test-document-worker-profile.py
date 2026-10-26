import importlib.util
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlsplit
from urllib.request import url2pathname

sys.modules.setdefault("boto3", types.SimpleNamespace(client=lambda _service: None))
spec = importlib.util.spec_from_file_location(
    "document_worker_profile_test", Path(__file__).resolve().parents[1] / "infra/aws/document-worker/handler.py"
)
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)


class DocumentWorkerProfileTests(unittest.TestCase):
    def check_failed_conversion(self, operation, failure):
        original_temporary_directory = tempfile.TemporaryDirectory
        directories = []
        profiles = []
        storage = Mock()

        def fail_conversion(arguments, **kwargs):
            work = Path(arguments[arguments.index("--outdir") + 1]).resolve()
            profile_arguments = [value for value in arguments if value.startswith("-env:UserInstallation=")]
            self.assertEqual(len(profile_arguments), 1)
            uri = urlsplit(profile_arguments[0].split("=", 1)[1])
            self.assertEqual(uri.scheme, "file")
            self.assertEqual((uri.netloc, uri.query, uri.fragment), ("", "", ""))
            profile = Path(url2pathname(uri.path)).resolve()
            self.assertEqual(profile.parent, work)
            self.assertIn("%23", profile_arguments[0])
            self.assertEqual(unquote(profile_arguments[0]).count("#"), 1)
            self.assertTrue(Path(kwargs["env"]["HOME"]).is_dir())
            # Simulate files LibreOffice creates before exiting or timing out.
            profile.mkdir()
            (profile / "private-profile.txt").write_text("synthetic private content", encoding="utf-8")
            directories.append(work)
            profiles.append(profile)
            raise failure

        with original_temporary_directory(prefix="applypack profile # ") as parent:
            with patch.object(handler.tempfile, "TemporaryDirectory", side_effect=lambda **kwargs: original_temporary_directory(dir=parent, **kwargs)), \
                    patch.object(handler.subprocess, "run", side_effect=fail_conversion), \
                    patch.object(handler, "s3", storage), \
                    patch.object(handler, "_docx_text", return_value="ApplyPack synthetic extraction and render probe"):
                for _ in range(2):
                    with self.assertRaises(type(failure)):
                        if operation == "render":
                            handler._render_docx(b"synthetic", {
                                "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                "expectedPages": 1, "artifactType": "RESUME", "bucket": "offline-only", "key": "synthetic",
                            }, {"milliseconds": 30_000})
                        else:
                            handler._probe_document(b"synthetic", {"milliseconds": 30_000, "expanded": 1024, "pages": 2})
                    self.assertFalse(directories[-1].exists())
                    self.assertFalse(profiles[-1].exists())
            self.assertEqual(list(Path(parent).iterdir()), [])
        self.assertEqual(len(set(profiles)), 2)
        storage.put_object.assert_not_called()

    def test_render_failure_cleans_unique_profiles(self):
        self.check_failed_conversion("render", subprocess.CalledProcessError(77, "synthetic-libreoffice"))

    def test_render_timeout_cleans_unique_profiles(self):
        self.check_failed_conversion("render", subprocess.TimeoutExpired("synthetic-libreoffice", 30))

    def test_probe_failure_cleans_unique_profiles(self):
        self.check_failed_conversion("probe", subprocess.CalledProcessError(77, "synthetic-libreoffice"))

    def test_probe_timeout_cleans_unique_profiles(self):
        self.check_failed_conversion("probe", subprocess.TimeoutExpired("synthetic-libreoffice", 30))

    def test_unknown_draft_profile_fails_before_conversion_or_storage(self):
        event = {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "expectedPages": 1, "artifactType": "RESUME"}
        for profile in (True, {}, {"schemaVersion": "applypack-reviewed-draft-pdf-v1", "generatorVersion": "legacy"}):
            with patch.object(handler.subprocess, "run") as run, patch.object(handler, "s3", Mock()) as storage:
                with self.assertRaisesRegex(ValueError, "render_profile"):
                    handler._render_docx(b"synthetic", {**event, "renderProfile": profile}, {"milliseconds": 30_000})
                run.assert_not_called()
                storage.put_object.assert_not_called()

    def test_exact_draft_reference_profile_reaches_isolated_conversion(self):
        event = {"mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "expectedPages": 1, "artifactType": "REFERENCE_SHEET", "renderProfile": handler.DRAFT_RENDER_PROFILE}
        with patch.object(handler.subprocess, "run", side_effect=subprocess.CalledProcessError(77, "synthetic")) as run, \
                patch.object(handler, "s3", Mock()) as storage:
            with self.assertRaises(subprocess.CalledProcessError):
                handler._render_docx(b"synthetic", event, {"milliseconds": 30_000})
            run.assert_called_once()
            storage.put_object.assert_not_called()


if __name__ == "__main__":
    unittest.main()
