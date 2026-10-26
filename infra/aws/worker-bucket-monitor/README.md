# Temporary document bucket drift monitor

Local source only. This Lambda has not been provisioned, invoked in AWS or enabled.

`handler.handler` expects function name `applypack-worker-bucket-monitor`, account `838445019912` and region `us-east-1`. `APP_DOCUMENT_WORKER_BUCKET_MONITOR_ENABLED` defaults off and only the exact value `true` enables observations. Disabled invocation creates no SDK clients and performs no I/O. Events cannot override configuration.

The observer reads only `GetBucketVersioning` and `GetBucketPolicy` for:

- `applypack-838445019912-staging-document-worker-temp`
- `applypack-838445019912-production-document-worker-temp`

Every S3 call includes `ExpectedBucketOwner=838445019912`. The invariant matches `scripts/aws-document-worker-bucket-preflight.mjs`: versioning has never been enabled, and exactly one unconditional all-principal policy statement denies `s3:PutBucketVersioning` on the exact bucket. Suspended is unhealthy. Missing or malformed evidence, a conditional denial, a different owner, unavailable bucket, timeout or redirect is unhealthy. Duplicate policy JSON keys and ambiguous extra policy fields are rejected.

The only publication is one aggregate CloudWatch metric: namespace `ApplyPack/IndependentOperations`, name `DocumentWorkerBucketsHealthy`, unit `Count`, value `0` or `1`, no dimensions. Both buckets must pass to emit `1`. No names, policies, tokens, object keys or exception text enter metrics or logs. Metric publication failure raises a fixed error so missing-data alarm handling can detect the outage.

The separate role needs only the two bucket-level read actions above on those two exact bucket ARNs, plus `cloudwatch:PutMetricData` constrained to that namespace. No object reads, listing, writes, lifecycle mutation, KMS, SSM or application credentials are needed. The root monitoring template owns role, log group, disabled schedule, alarms and the approved cost quote. Configure a 30-second Lambda timeout, low reserved concurrency and an alarm treating missing metric data as unhealthy. Scheduling and activation remain separately approved.

Each enabled run makes at most four S3 reads and one metric publication. SDK connect/read timeouts are two/three seconds with one attempt; the observer has a 22-second read budget and stops later reads when insufficient time remains. Fixed regional endpoints, disabled environment proxies and a pre-redirect SDK hook prevent endpoint changes or fallback `HeadBucket` discovery.

Run local tests from this directory with `python -m unittest test_handler.py`. Build with `python package.py --output-directory <ignored-evidence-directory>`; the deterministic zip contains only `handler.py`. Local tests and package hashes do not prove AWS permissions, delivered alerts or actual scheduled operation.
