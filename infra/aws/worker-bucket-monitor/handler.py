"""Metadata-only drift detection for ApplyPack's two temporary worker buckets."""
import json
import os
import re
import time

ACCOUNT = "838445019912"
REGION = "us-east-1"
BUCKETS = tuple(f"applypack-{ACCOUNT}-{environment}-document-worker-temp" for environment in ("staging", "production"))
NAMESPACE = "ApplyPack/IndependentOperations"
METRIC = "DocumentWorkerBucketsHealthy"
ENABLE_FLAG = "APP_DOCUMENT_WORKER_BUCKET_MONITOR_ENABLED"
FUNCTION_NAME = "applypack-worker-bucket-monitor"
READ_BUDGET_SECONDS = 22
CALL_BUDGET_SECONDS = 5
MAX_POLICY_BYTES = 20_480


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("BUCKET_MONITOR_POLICY_INVALID")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("BUCKET_MONITOR_POLICY_INVALID")


def successful_payload(response):
    if not isinstance(response, dict) or not isinstance(response.get("ResponseMetadata"), dict):
        raise ValueError("BUCKET_MONITOR_RESPONSE_INVALID")
    status = response["ResponseMetadata"].get("HTTPStatusCode")
    if type(status) is not int or status != 200:
        raise ValueError("BUCKET_MONITOR_RESPONSE_INVALID")
    return {key: value for key, value in response.items() if key != "ResponseMetadata"}


def versioning_deny_matches(response, bucket):
    """Same invariant as aws-document-worker-bucket-preflight.mjs: exactly one
    unconditional all-principal denial of versioning changes on this bucket.
    Strict JSON/key checks additionally refuse ambiguous or malformed evidence.
    """
    payload = successful_payload(response)
    if set(payload) != {"Policy"} or not isinstance(payload["Policy"], str) or len(payload["Policy"].encode("utf-8")) > MAX_POLICY_BYTES:
        return False
    policy = json.loads(payload["Policy"], object_pairs_hook=unique_object, parse_constant=reject_constant)
    if not isinstance(policy, dict) or set(policy) != {"Version", "Statement"} or policy["Version"] != "2012-10-17":
        return False
    statements = policy["Statement"]
    if not isinstance(statements, list) or len(statements) != 1:
        return False
    statement = statements[0]
    return isinstance(statement, dict) and statement == {
        "Sid": "NeverEnableTemporaryBucketVersioning", "Effect": "Deny", "Principal": "*",
        "Action": "s3:PutBucketVersioning", "Resource": f"arn:aws:s3:::{bucket}",
    }


def reject_redirect(response=None, **_kwargs):
    # Botocore's S3 region redirector can otherwise perform a further HeadBucket
    # request even with ordinary retries disabled. Never broaden this observer.
    if response is not None and 300 <= getattr(response[0], "status_code", 0) < 400:
        raise ValueError("BUCKET_MONITOR_REDIRECT_REJECTED")
    if response is not None and getattr(response[0], "status_code", 0) != 200:
        # Wrong-region errors can also be HTTP400 AuthorizationHeaderMalformed.
        # Reject every non-success before the S3 region redirector is consulted.
        raise ValueError("BUCKET_MONITOR_PROVIDER_RESPONSE_REJECTED")


def observe(s3, cloudwatch, monotonic=time.monotonic):
    deadline = monotonic() + READ_BUDGET_SECONDS
    healthy = True
    for bucket in BUCKETS:
        try:
            if monotonic() + CALL_BUDGET_SECONDS > deadline:
                raise ValueError("BUCKET_MONITOR_READ_TIMEOUT")
            versioning = successful_payload(s3.get_bucket_versioning(Bucket=bucket, ExpectedBucketOwner=ACCOUNT))
            if monotonic() > deadline or versioning != {}:
                # Status=Suspended can retain older versions. Only an absent
                # Status/MFADelete is the never-versioned state.
                raise ValueError("BUCKET_MONITOR_VERSIONING_DRIFT")
            if monotonic() + CALL_BUDGET_SECONDS > deadline:
                raise ValueError("BUCKET_MONITOR_READ_TIMEOUT")
            policy = s3.get_bucket_policy(Bucket=bucket, ExpectedBucketOwner=ACCOUNT)
            if monotonic() > deadline or not versioning_deny_matches(policy, bucket):
                raise ValueError("BUCKET_MONITOR_POLICY_DRIFT")
        except Exception:
            # Missing bucket/policy, wrong owner, timeout or malformed evidence
            # is unhealthy. Never return or log provider responses/errors.
            healthy = False
    try:
        result = cloudwatch.put_metric_data(Namespace=NAMESPACE, MetricData=[{
            "MetricName": METRIC, "Unit": "Count", "Value": int(healthy), "StorageResolution": 60,
        }])
        if successful_payload(result) != {}:
            raise ValueError("BUCKET_MONITOR_METRIC_RESPONSE_INVALID")
    except Exception:
        raise RuntimeError("BUCKET_MONITOR_METRIC_PUBLICATION_FAILED") from None
    return {"schemaVersion": "applypack-document-worker-bucket-monitor-v1", "status": "CHECKED", "metricCount": 1}


def handler(event, context):
    # Neither events nor environment values can choose an account, bucket,
    # endpoint, role, operation or metric namespace.
    if os.environ.get(ENABLE_FLAG) != "true":
        return {"schemaVersion": "applypack-document-worker-bucket-monitor-v1", "status": "DISABLED", "metricCount": 0}
    arn = getattr(context, "invoked_function_arn", "")
    if not isinstance(arn, str) or not re.fullmatch(rf"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION_NAME}(?::[A-Za-z0-9_-]+)?", arn):
        raise RuntimeError("BUCKET_MONITOR_RUNTIME_IDENTITY_INVALID")
    try:
        import boto3
        from botocore.config import Config
        config = Config(region_name=REGION, connect_timeout=2, read_timeout=3,
                        retries={"total_max_attempts": 1}, proxies={}, max_pool_connections=1,
                        s3={"addressing_style": "path", "use_accelerate_endpoint": False, "use_dualstack_endpoint": False})
        s3 = boto3.client("s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com", config=config)
        s3.meta.events.register_first("needs-retry.s3", reject_redirect)
        cloudwatch = boto3.client("cloudwatch", region_name=REGION,
                                  endpoint_url=f"https://monitoring.{REGION}.amazonaws.com", config=config)
    except Exception:
        raise RuntimeError("BUCKET_MONITOR_CLIENT_UNAVAILABLE") from None
    return observe(s3, cloudwatch)
