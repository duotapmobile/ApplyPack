"""Independent metadata-only observer. Never logs tokens, URLs or responses."""
import datetime
import json
import os
import re
import secrets
import time
import urllib.request

ORIGINS = {
    "production": "https://applypack.work",
    "staging": "https://applypack-staging-staging.up.railway.app",
}
CHECKS = {"production": ("maintenance", "fileRecovery", "databaseRecovery", "archiveRetention"), "staging": ("maintenance",)}
NAMESPACE = "ApplyPack/IndependentOperations"
ACCOUNT = "838445019912"
REGION = "us-east-1"
PARAMETER_PREFIX = "/applypack/operations-monitor/"
TOKEN = re.compile(r"[A-Za-z0-9_-]{43,128}\Z")
SHA = re.compile(r"[a-f0-9]{40}\Z")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("MONITOR_REDIRECT_REJECTED")


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("MONITOR_DUPLICATE_FIELD")
        value[key] = item
    return value


def fetch_snapshot(environment, token, nonce):
    # Neither an event nor a parameter may choose the destination of the token.
    url = ORIGINS[environment] + "/api/internal/operations-monitor?nonce=" + nonce
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Accept": "application/json", "Cache-Control": "no-store"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + 6
    with opener.open(request, timeout=6) as response:
        if response.status != 200 or response.headers.get_content_type() != "application/json" or "no-store" not in response.headers.get("cache-control", "").lower():
            raise ValueError("MONITOR_RESPONSE_REJECTED")
        chunks = []
        size = 0
        while True:
            if time.monotonic() >= deadline:
                raise ValueError("MONITOR_RESPONSE_TIMEOUT")
            chunk = response.read1(min(1024, 8193 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > 8192:
                raise ValueError("MONITOR_RESPONSE_LIMIT")
    if time.monotonic() >= deadline:
        raise ValueError("MONITOR_RESPONSE_TIMEOUT")
    return json.loads(b"".join(chunks).decode("utf-8", errors="strict"), object_pairs_hook=unique_object)


def snapshot_metrics(value, environment, expected_sha, nonce, now):
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "environment", "releaseSha", "nonce", "observedAt", "checks"}:
        raise ValueError("MONITOR_SHAPE_REJECTED")
    if value["schemaVersion"] != "applypack-independent-monitor-v1" or value["environment"] != environment or value["releaseSha"] != expected_sha or value["nonce"] != nonce:
        raise ValueError("MONITOR_IDENTITY_REJECTED")
    observed = datetime.datetime.fromisoformat(value["observedAt"].replace("Z", "+00:00"))
    if observed.tzinfo is None or not -5 <= (now - observed).total_seconds() <= 15:
        raise ValueError("MONITOR_TIME_REJECTED")
    checks = value["checks"]
    if not isinstance(checks, dict) or set(checks) != set(CHECKS[environment]):
        raise ValueError("MONITOR_CHECKS_REJECTED")
    metrics = {}
    for name in CHECKS[environment]:
        check = checks[name]
        if not isinstance(check, dict) or set(check) != {"state", "ageSeconds"} or check["state"] not in ("HEALTHY", "RUNNING", "FAILED", "STALE", "UNKNOWN"):
            raise ValueError("MONITOR_CHECK_REJECTED")
        age = check["ageSeconds"]
        if age is not None and (type(age) is not int or not 0 <= age <= 2147483647):
            raise ValueError("MONITOR_AGE_REJECTED")
        metrics[name] = int(check["state"] == "HEALTHY" and age is not None and age < (1200 if name == "maintenance" else 600))
    return metrics


def read_token(ssm, environment):
    name = PARAMETER_PREFIX + environment
    result = ssm.get_parameter(Name=name, WithDecryption=True).get("Parameter", {})
    token = result.get("Value")
    if result.get("Name") != name or result.get("Type") != "SecureString" or result.get("ARN") != f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter{name}" or not isinstance(token, str) or not TOKEN.fullmatch(token):
        raise ValueError("MONITOR_CREDENTIAL_REJECTED")
    return token


def observe(ssm, cloudwatch, environment_values, fetch=fetch_snapshot, now=None):
    metrics = []
    for environment in CHECKS:
        values = {name: 0 for name in CHECKS[environment]}
        try:
            expected_sha = environment_values.get(environment.upper() + "_RELEASE_SHA", "")
            if not SHA.fullmatch(expected_sha):
                raise ValueError("MONITOR_RELEASE_MISSING")
            token = read_token(ssm, environment)
            nonce = secrets.token_hex(32)
            snapshot = fetch(environment, token, nonce)
            sampled_at = now or datetime.datetime.now(datetime.timezone.utc)
            values = snapshot_metrics(snapshot, environment, expected_sha, nonce, sampled_at)
        except Exception:
            # Any auth, TLS, DNS, timeout, malformed or missing evidence is unhealthy.
            # No exception/provider body is printed or returned.
            pass
        for name, value in values.items():
            metrics.append({"MetricName": "VerifiedHealthy", "Dimensions": [{"Name": "Environment", "Value": environment},
                            {"Name": "Check", "Value": name}], "Unit": "Count", "Value": value, "StorageResolution": 60})
    try:
        cloudwatch.put_metric_data(Namespace=NAMESPACE, MetricData=metrics)
    except Exception:
        raise RuntimeError("MONITOR_METRIC_PUBLICATION_FAILED") from None
    return {"schemaVersion": "applypack-independent-observer-v1", "metricCount": len(metrics)}


def handler(event, context):
    import boto3
    from botocore.config import Config
    config = Config(region_name=REGION, connect_timeout=2, read_timeout=3, retries={"total_max_attempts": 1})
    return observe(boto3.client("ssm", config=config), boto3.client("cloudwatch", config=config), os.environ)
