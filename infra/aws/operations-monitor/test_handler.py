import datetime
import io
import json
import unittest
from email.message import Message
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
import handler

NOW = datetime.datetime(2026, 10, 26, 1, 0, tzinfo=datetime.timezone.utc)
RELEASE = "a" * 40
TOKEN = "S" * 43


def snapshot(environment, token, nonce):
    return {"schemaVersion": "applypack-independent-monitor-v1", "environment": environment, "releaseSha": RELEASE,
            "nonce": nonce, "observedAt": NOW.isoformat(), "checks": {name: {"state": "HEALTHY", "ageSeconds": 59} for name in handler.CHECKS[environment]}}


class Ssm:
    def __init__(self):
        self.calls = []

    def get_parameter(self, **kw):
        self.calls.append(kw)
        name = kw["Name"]
        return {"Parameter": {"Name": name, "Type": "SecureString", "ARN": f"arn:aws:ssm:us-east-1:838445019912:parameter{name}", "Value": TOKEN}}


class Cloudwatch:
    def __init__(self):
        self.result = None

    def put_metric_data(self, **kw):
        self.result = kw


class Tests(unittest.TestCase):
    def run_observer(self, fetch=snapshot):
        ssm, cloudwatch = Ssm(), Cloudwatch()
        result = handler.observe(ssm, cloudwatch, {"PRODUCTION_RELEASE_SHA": RELEASE, "STAGING_RELEASE_SHA": RELEASE}, fetch=fetch, now=NOW)
        self.assertEqual(result["metricCount"], 5)
        return ssm, cloudwatch

    def test_healthy_and_minimal_metrics(self):
        ssm, cloudwatch = self.run_observer()
        self.assertEqual(len(ssm.calls), 2)
        self.assertTrue(all(call["WithDecryption"] is True for call in ssm.calls))
        self.assertTrue(all(metric["Value"] == 1 for metric in cloudwatch.result["MetricData"]))
        serialized = json.dumps(cloudwatch.result)
        for private in (TOKEN, RELEASE, "customer", "manifest", "nonce"):
            self.assertNotIn(private, serialized)

    def test_outage_auth_failure_and_arbitrary_errors_are_fixed_unhealthy_without_logs(self):
        def broken(*args):
            raise RuntimeError("private error " + TOKEN)
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            _, cloudwatch = self.run_observer(broken)
        self.assertEqual(output.getvalue(), "")
        self.assertTrue(all(metric["Value"] == 0 for metric in cloudwatch.result["MetricData"]))

    def test_identity_freshness_shape_and_private_field_rejections(self):
        base = snapshot("production", TOKEN, "b" * 64)
        for key, value in [("nonce", "x"), ("releaseSha", "c" * 40), ("environment", "staging"), ("schemaVersion", "old"),
                           ("observedAt", (NOW - datetime.timedelta(seconds=16)).isoformat()), ("observedAt", (NOW + datetime.timedelta(seconds=6)).isoformat()),
                           ("observedAt", "2026-10-26T01:00:00"), ("customerContent", "private")]:
            with self.subTest(key=key, value=value):
                changed = {**base, key: value}
                with self.assertRaises((ValueError, TypeError)):
                    handler.snapshot_metrics(changed, "production", RELEASE, "b" * 64, NOW)

    def test_old_source_cannot_be_healthy_despite_new_verification_time(self):
        base = snapshot("production", TOKEN, "b" * 64)
        base["checks"]["fileRecovery"]["ageSeconds"] = 600
        base["checks"]["maintenance"]["ageSeconds"] = 1200
        result = handler.snapshot_metrics(base, "production", RELEASE, "b" * 64, NOW)
        self.assertEqual(result["fileRecovery"], 0)
        self.assertEqual(result["maintenance"], 0)

    def test_unknown_running_failed_stale_and_absent_age_never_healthy(self):
        for state in ("UNKNOWN", "RUNNING", "FAILED", "STALE"):
            base = snapshot("production", TOKEN, "b" * 64)
            base["checks"]["databaseRecovery"] = {"state": state, "ageSeconds": None}
            self.assertEqual(handler.snapshot_metrics(base, "production", RELEASE, "b" * 64, NOW)["databaseRecovery"], 0)

    def test_duplicate_json_redirect_and_credential_identity_fail_closed(self):
        with self.assertRaises(ValueError):
            json.loads('{"checks":{},"checks":{}}', object_pairs_hook=handler.unique_object)
        with self.assertRaises(ValueError):
            handler.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example")
        ssm = Ssm()
        original = ssm.get_parameter
        def wrong(**kw):
            result = original(**kw)
            result["Parameter"]["Type"] = "String"
            return result
        ssm.get_parameter = wrong
        with self.assertRaises(ValueError):
            handler.read_token(ssm, "production")

    def test_one_environment_failure_does_not_skip_the_other(self):
        def partial(environment, token, nonce):
            if environment == "production":
                raise ValueError("offline")
            return snapshot(environment, token, nonce)
        _, cloudwatch = self.run_observer(partial)
        self.assertEqual([item["Value"] for item in cloudwatch.result["MetricData"]], [0, 0, 0, 0, 1])

    def test_transport_uses_fixed_https_destination_no_proxy_and_bounded_body(self):
        class Response:
            status = 200
            headers = Message()
            headers["Content-Type"] = "application/json"
            headers["Cache-Control"] = "private, no-store"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read1(self, count):
                return b"x" * count
        with patch.object(handler.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = Response()
            with self.assertRaisesRegex(ValueError, "MONITOR_RESPONSE_LIMIT"):
                handler.fetch_snapshot("production", TOKEN, "b" * 64)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://applypack.work/api/internal/operations-monitor?nonce=" + "b" * 64)
            self.assertEqual(request.get_header("Authorization"), "Bearer " + TOKEN)
            self.assertEqual(build.call_args.args[0].proxies, {})
            self.assertIsInstance(build.call_args.args[1], handler.NoRedirect)

    def test_transport_total_deadline_and_bad_status_are_rejected(self):
        class Response:
            status = 200
            headers = Message()
            headers["Content-Type"] = "application/json"
            headers["Cache-Control"] = "no-store"

            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass
        with patch.object(handler.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = Response()
            with patch.object(handler.time, "monotonic", side_effect=[0, 7]):
                with self.assertRaisesRegex(ValueError, "MONITOR_RESPONSE_TIMEOUT"):
                    handler.fetch_snapshot("staging", TOKEN, "b" * 64)
            build.return_value.open.return_value.status = 302
            with self.assertRaisesRegex(ValueError, "MONITOR_RESPONSE_REJECTED"):
                handler.fetch_snapshot("staging", TOKEN, "b" * 64)

    def test_boolean_float_negative_and_extra_health_fields_are_rejected(self):
        for age in (True, 0.1, -1, "1"):
            base = snapshot("production", TOKEN, "b" * 64)
            base["checks"]["maintenance"]["ageSeconds"] = age
            with self.assertRaises(ValueError):
                handler.snapshot_metrics(base, "production", RELEASE, "b" * 64, NOW)
        base = snapshot("production", TOKEN, "b" * 64)
        base["checks"]["maintenance"]["privateDetails"] = "private"
        with self.assertRaises(ValueError):
            handler.snapshot_metrics(base, "production", RELEASE, "b" * 64, NOW)

    def test_missing_metric_publish_error_is_redacted(self):
        cloudwatch = Cloudwatch()
        def fail(**kwargs):
            raise RuntimeError(TOKEN)
        cloudwatch.put_metric_data = fail
        with self.assertRaisesRegex(RuntimeError, "^MONITOR_METRIC_PUBLICATION_FAILED$"):
            handler.observe(Ssm(), cloudwatch, {}, now=NOW)


if __name__ == "__main__":
    unittest.main()
