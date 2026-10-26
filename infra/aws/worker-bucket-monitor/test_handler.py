import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import types
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch
import zipfile


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


handler = load("worker_bucket_monitor_handler", "handler.py")
packager = load("worker_bucket_monitor_package", "package.py")
META = {"ResponseMetadata": {"HTTPStatusCode": 200, "RequestId": "private-provider-request-id"}}


def policy(bucket):
    return {"Version": "2012-10-17", "Statement": [{"Sid": "NeverEnableTemporaryBucketVersioning", "Effect": "Deny", "Principal": "*",
            "Action": "s3:PutBucketVersioning", "Resource": f"arn:aws:s3:::{bucket}"}]}


class S3:
    def __init__(self):
        self.calls = []
        self.versioning = {bucket: copy.deepcopy(META) for bucket in handler.BUCKETS}
        self.policies = {bucket: {**META, "Policy": json.dumps(policy(bucket))} for bucket in handler.BUCKETS}
        self.after = lambda: None
        self.hooks = []
        self.meta = types.SimpleNamespace(events=types.SimpleNamespace(register_first=lambda *args: self.hooks.append(args)))

    def read(self, action, values, args):
        self.calls.append((action, args))
        self.after()
        value = values[args["Bucket"]]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)

    def get_bucket_versioning(self, **args):
        return self.read("GetBucketVersioning", self.versioning, args)

    def get_bucket_policy(self, **args):
        return self.read("GetBucketPolicy", self.policies, args)


class Cloudwatch:
    def __init__(self):
        self.calls = []
        self.response = copy.deepcopy(META)

    def put_metric_data(self, **args):
        self.calls.append(args)
        if isinstance(self.response, Exception):
            raise self.response
        return copy.deepcopy(self.response)


class Tests(unittest.TestCase):
    def observe(self, s3=None, monotonic=lambda: 0):
        s3, cloudwatch = s3 or S3(), Cloudwatch()
        result = handler.observe(s3, cloudwatch, monotonic)
        self.assertEqual(result, {"schemaVersion": "applypack-document-worker-bucket-monitor-v1", "status": "CHECKED", "metricCount": 1})
        self.assertEqual(len(cloudwatch.calls), 1)
        return s3, cloudwatch.calls[0]

    def assert_health(self, s3, value):
        _, result = self.observe(s3)
        self.assertEqual(result, {"Namespace": "ApplyPack/IndependentOperations", "MetricData": [{
            "MetricName": "DocumentWorkerBucketsHealthy", "Unit": "Count", "Value": value, "StorageResolution": 60}]})

    def test_both_exact_buckets_and_owner_are_read_with_only_four_metadata_calls(self):
        s3, result = self.observe()
        self.assertEqual(s3.calls, [(action, {"Bucket": bucket, "ExpectedBucketOwner": "838445019912"})
                                   for bucket in handler.BUCKETS for action in ("GetBucketVersioning", "GetBucketPolicy")])
        self.assertEqual(result["MetricData"][0]["Value"], 1)
        for private in (*handler.BUCKETS, handler.ACCOUNT, "private-provider-request-id", "Policy", "Resource"):
            self.assertNotIn(private, json.dumps(result))

    def test_enabled_suspended_unknown_and_mfa_versioning_states_fail_closed(self):
        for field, value in (("Status", "Enabled"), ("Status", "Suspended"), ("Status", ""), ("Status", None),
                             ("Status", "NeverEnabled"), ("MFADelete", "Disabled"), ("Unknown", True)):
            for bucket in handler.BUCKETS:
                with self.subTest(field=field, value=value, bucket=bucket):
                    s3 = S3()
                    s3.versioning[bucket][field] = value
                    self.assert_health(s3, 0)

    def test_missing_bucket_wrong_owner_missing_policy_and_unavailable_are_unhealthy_without_logs(self):
        output = io.StringIO()
        for failure in (PermissionError("AccessDenied wrong owner private details"), FileNotFoundError("NoSuchBucket private name"),
                        FileNotFoundError("NoSuchBucketPolicy private name"), TimeoutError("endpoint secret URL")):
            for kind in ("versioning", "policies"):
                s3 = S3()
                getattr(s3, kind)[handler.BUCKETS[0]] = failure
                with redirect_stdout(output), redirect_stderr(output):
                    self.assert_health(s3, 0)
                self.assertTrue(any(args["Bucket"] == handler.BUCKETS[1] for _, args in s3.calls))
        self.assertEqual(output.getvalue(), "")

    def test_conditional_scoped_or_other_bucket_denial_is_not_the_required_policy(self):
        changes = [{"Condition": {"StringEquals": {"aws:PrincipalAccount": handler.ACCOUNT}}}, {"Condition": {}}, {"Condition": None},
                   {"NotPrincipal": "*"}, {"NotAction": "s3:GetObject"}, {"NotResource": "*"}, {"Principal": {"AWS": "*"}},
                   {"Action": ["s3:PutBucketVersioning"]}, {"Effect": "Allow"}, {"Resource": "arn:aws:s3:::other-bucket"},
                   {"Sid": "DifferentPolicy"}]
        for changeset in changes:
            with self.subTest(changeset=changeset):
                s3 = S3()
                changed = policy(handler.BUCKETS[0])
                changed["Statement"][0].update(changeset)
                s3.policies[handler.BUCKETS[0]]["Policy"] = json.dumps(changed)
                self.assert_health(s3, 0)

    def test_malformed_ambiguous_duplicate_or_oversized_policy_is_unhealthy(self):
        exact = policy(handler.BUCKETS[0])
        values = [None, "", "[]", "null", "{bad", json.dumps({**exact, "Version": "2008-10-17"}),
                  json.dumps({**exact, "Statement": exact["Statement"] * 2}), json.dumps({**exact, "Statement": []}),
                  json.dumps({**exact, "Statement": exact["Statement"][0]}), json.dumps({**exact, "Extra": True}),
                  '{"Version":"2012-10-17","Version":"2012-10-17","Statement":[]}', '{"Version":NaN}', " " * 20481]
        for value in values:
            with self.subTest(value=str(value)[:70]):
                s3 = S3()
                s3.policies[handler.BUCKETS[0]]["Policy"] = value
                self.assert_health(s3, 0)

    def test_malformed_sdk_success_is_not_proof(self):
        for response in (None, {}, [], {"ResponseMetadata": {}}, {"ResponseMetadata": {"HTTPStatusCode": 403}},
                         {"ResponseMetadata": {"HTTPStatusCode": 200.0}}, {"ResponseMetadata": {"HTTPStatusCode": "200"}}):
            s3 = S3()
            s3.versioning[handler.BUCKETS[0]] = response
            self.assert_health(s3, 0)

    def test_expired_run_stops_later_reads_and_publishes_unhealthy(self):
        s3 = S3()
        clock = [0]
        s3.after = lambda: clock.__setitem__(0, 30)
        _, result = self.observe(s3, lambda: clock[0])
        self.assertEqual(len(s3.calls), 1)
        self.assertEqual(result["MetricData"][0]["Value"], 0)

    def test_metric_error_is_fixed_and_does_not_leak_provider_body(self):
        for response in (RuntimeError("private credentials and response"), {}, {**META, "Unexpected": "private"}):
            cloudwatch = Cloudwatch()
            cloudwatch.response = response
            with self.assertRaisesRegex(RuntimeError, "^BUCKET_MONITOR_METRIC_PUBLICATION_FAILED$"):
                handler.observe(S3(), cloudwatch, lambda: 0)

    def test_default_disabled_never_imports_or_constructs_clients(self):
        calls = []
        fake = types.SimpleNamespace(client=lambda *args, **kwargs: calls.append((args, kwargs)))
        for flag in (None, "false", "TRUE", "1"):
            values = {} if flag is None else {handler.ENABLE_FLAG: flag}
            with patch.dict(os.environ, values, clear=True), patch.dict(sys.modules, {"boto3": fake}):
                result = handler.handler({"enabled": True, "bucket": "arbitrary"}, None)
            self.assertEqual(result["status"], "DISABLED")
        self.assertEqual(calls, [])

    def test_enabled_handler_has_fixed_endpoints_config_and_rejects_redirects_before_fallback(self):
        s3, cloudwatch, calls, configs = S3(), Cloudwatch(), [], []
        def client(name, **kwargs):
            calls.append((name, kwargs))
            return s3 if name == "s3" else cloudwatch
        def config(**kwargs):
            configs.append(kwargs)
            return kwargs
        modules = {"boto3": types.SimpleNamespace(client=client), "botocore.config": types.SimpleNamespace(Config=config)}
        context = types.SimpleNamespace(invoked_function_arn=f"arn:aws:lambda:{handler.REGION}:{handler.ACCOUNT}:function:{handler.FUNCTION_NAME}:1")
        with patch.dict(os.environ, {handler.ENABLE_FLAG: "true", "AWS_ENDPOINT_URL": "https://untrusted.example", "HTTPS_PROXY": "https://untrusted.example"}, clear=True), patch.dict(sys.modules, modules):
            result = handler.handler({"bucket": "untrusted", "account": "123", "enabled": False}, context)
        self.assertEqual(result["status"], "CHECKED")
        self.assertEqual([name for name, _ in calls], ["s3", "cloudwatch"])
        self.assertEqual([args["endpoint_url"] for _, args in calls], ["https://s3.us-east-1.amazonaws.com", "https://monitoring.us-east-1.amazonaws.com"])
        self.assertEqual(configs[0]["retries"], {"total_max_attempts": 1})
        self.assertEqual((configs[0]["connect_timeout"], configs[0]["read_timeout"], configs[0]["proxies"]), (2, 3, {}))
        self.assertEqual(s3.hooks[0][0], "needs-retry.s3")
        for status in (301, 302, 307, 308):
            with self.assertRaisesRegex(ValueError, "BUCKET_MONITOR_REDIRECT_REJECTED"):
                s3.hooks[0][1](response=(types.SimpleNamespace(status_code=status), {}))
        with self.assertRaisesRegex(ValueError, "BUCKET_MONITOR_PROVIDER_RESPONSE_REJECTED"):
            s3.hooks[0][1](response=(types.SimpleNamespace(status_code=400), {
                "Error": {"Code": "AuthorizationHeaderMalformed", "Region": "us-west-2"}}))
        self.assertIsNone(s3.hooks[0][1](response=(types.SimpleNamespace(status_code=200), {})))

    def test_runtime_identity_mismatch_fails_before_client_creation(self):
        for arn in (None, "arn:aws:lambda:us-east-1:111111111111:function:applypack-worker-bucket-monitor",
                    "arn:aws:lambda:eu-west-1:838445019912:function:applypack-worker-bucket-monitor",
                    "arn:aws:lambda:us-east-1:838445019912:function:unrelated"):
            with patch.dict(os.environ, {handler.ENABLE_FLAG: "true"}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "^BUCKET_MONITOR_RUNTIME_IDENTITY_INVALID$"):
                    handler.handler({}, types.SimpleNamespace(invoked_function_arn=arn))

    def test_deterministic_package_has_only_the_reviewed_handler(self):
        first, receipt = packager.build_package()
        second, same = packager.build_package()
        self.assertEqual((first, receipt), (second, same))
        with zipfile.ZipFile(io.BytesIO(first)) as archive:
            self.assertEqual(archive.namelist(), ["handler.py"])
            self.assertEqual(archive.read("handler.py"), Path(__file__).with_name("handler.py").read_bytes())


if __name__ == "__main__":
    unittest.main()
