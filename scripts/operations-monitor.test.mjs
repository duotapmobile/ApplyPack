import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import { operationsMonitorTemplate } from "./build-operations-monitor-template.mjs";

test("reviewed template remains reproducible, disabled, outside Railway, with no NAT or new keys", () => {
  const template = operationsMonitorTemplate();
  assert.deepEqual(JSON.parse(readFileSync(new URL("../infra/aws/operations-monitor/template.json", import.meta.url), "utf8")), template);
  assert.equal(template.Parameters.ActivateMonitoring.Default, "false");
  assert.equal(template.Resources.Observer.Properties.ReservedConcurrentExecutions, 1);
  assert.equal(template.Resources.Observer.Properties.Timeout, 45);
  assert.equal(template.Resources.Schedule.Properties.ScheduleExpression, "rate(1 minute)");
  assert.equal(template.Resources.Schedule.DependsOn, "InvocationPolicy");
  assert.deepEqual(template.Resources.ObserverVersion.Properties.CodeSha256, { Ref: "ExpectedCodeSha256" });
  assert.deepEqual(template.Resources.Schedule.Properties.Targets[0].Arn, { Ref: "ObserverVersion" });
  assert.deepEqual(template.Resources.SchedulePermission.Properties.FunctionName, { Ref: "ObserverVersion" });
  assert.deepEqual(template.Resources.InvocationPolicy.Properties, { FunctionName: { Ref: "Observer" },
    Qualifier: { "Fn::GetAtt": ["ObserverVersion", "Version"] }, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 });
  assert.equal(template.Resources.Observer.Properties.VpcConfig, undefined);
  assert.ok(!Object.values(template.Resources).some((resource) => /NATGateway|CertificateAuthority|KMS::Key|SSM::Parameter/.test(resource.Type)));
  assert.deepEqual(Object.keys(template.Resources.Observer.Properties.Environment.Variables).sort(), ["PRODUCTION_RELEASE_SHA", "STAGING_RELEASE_SHA"]);
});

test("all five application checks alarm on missing observer data and have separate completed-work thresholds", () => {
  const alarms = Object.values(operationsMonitorTemplate().Resources).filter((r) => r.Type === "AWS::CloudWatch::Alarm" && r.Properties.MetricName === "VerifiedHealthy");
  assert.equal(alarms.length, 5);
  for (const { Properties: p } of alarms) {
    assert.equal(p.TreatMissingData, "breaching"); assert.equal(p.Statistic, "Minimum"); assert.equal(p.Period, 60);
    assert.equal(p.DatapointsToAlarm, p.Dimensions.some((d) => d.Value === "maintenance") ? 5 : 2);
    assert.deepEqual(p.AlarmActions, [{ Ref: "Alerts" }]); assert.deepEqual(p.OKActions, [{ Ref: "Alerts" }]);
  }
});

test("separate bucket observer has no object or key access and uses pinned code with bounded delivery", () => {
  const template = operationsMonitorTemplate(), resources = template.Resources;
  const statements = resources.BucketRole.Properties.Policies[0].PolicyDocument.Statement;
  assert.deepEqual(statements.flatMap((s) => s.Action).sort(), ["s3:GetBucketVersioning", "s3:GetBucketPolicy", "cloudwatch:PutMetricData", "logs:CreateLogStream", "logs:PutLogEvents"].sort());
  assert.deepEqual(statements[0].Resource, ["arn:aws:s3:::applypack-838445019912-staging-document-worker-temp", "arn:aws:s3:::applypack-838445019912-production-document-worker-temp"]);
  assert.deepEqual(resources.BucketObserver.Properties.Environment.Variables, { APP_DOCUMENT_WORKER_BUCKET_MONITOR_ENABLED: { Ref: "ActivateMonitoring" } });
  assert.equal(resources.BucketObserver.Properties.ReservedConcurrentExecutions, 1);
  assert.equal(resources.BucketObserver.Properties.Timeout, 30);
  assert.equal(resources.BucketObserver.Properties.VpcConfig, undefined);
  assert.deepEqual(resources.BucketObserverVersion.Properties.CodeSha256, { Ref: "ExpectedBucketCodeSha256" });
  assert.deepEqual(resources.BucketObserverVersion.Properties.Description["Fn::Join"][1].slice(-1), [{ Ref: "ActivateMonitoring" }]);
  assert.equal(resources.BucketSchedule.Properties.ScheduleExpression, "rate(5 minutes)");
  assert.equal(resources.BucketSchedule.DependsOn, "BucketInvocationPolicy");
  assert.deepEqual(resources.BucketSchedule.Properties.Targets[0].Arn, { Ref: "BucketObserverVersion" });
  assert.deepEqual(resources.BucketSchedulePermission.Properties.FunctionName, { Ref: "BucketObserverVersion" });
  assert.deepEqual(resources.BucketInvocationPolicy.Properties, { FunctionName: { Ref: "BucketObserver" },
    Qualifier: { "Fn::GetAtt": ["BucketObserverVersion", "Version"] }, MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 });
  assert.equal(resources.BucketIsolationAlarm.Properties.TreatMissingData, "breaching");
  assert.equal(resources.BucketIsolationAlarm.Properties.Period, 300);
  assert.equal(resources.BucketIsolationAlarm.Properties.DatapointsToAlarm, 2);
});

test("worker error alarms observe existing fixed functions without treating an idle worker as failed", () => {
  const resources = operationsMonitorTemplate().Resources;
  assert.equal(Object.values(resources).filter((r) => r.Type === "AWS::CloudWatch::Alarm").length, 8);
  for (const environment of ["staging", "production"]) {
    const p = resources[`${environment}DocumentWorkerErrorsAlarm`].Properties;
    assert.equal(p.Namespace, "AWS/Lambda"); assert.equal(p.MetricName, "Errors");
    assert.deepEqual(p.Dimensions, [{ Name: "FunctionName", Value: `applypack-${environment}-document-worker` }]);
    assert.equal(p.TreatMissingData, "notBreaching"); assert.equal(p.Statistic, "Sum");
    assert.equal(p.Threshold, 1); assert.equal(p.DatapointsToAlarm, 1);
    assert.deepEqual(p.ActionsEnabled, { "Fn::If": ["MonitoringEnabled", true, false] });
  }
});

test("observer IAM can neither read customer archives nor mutate operational state", () => {
  const statements = operationsMonitorTemplate().Resources.Role.Properties.Policies[0].PolicyDocument.Statement;
  const actions = statements.flatMap((statement) => statement.Action);
  assert.deepEqual(actions.sort(), ["cloudwatch:PutMetricData", "kms:Decrypt", "logs:CreateLogStream", "logs:PutLogEvents", "ssm:GetParameter"].sort());
  assert.deepEqual(statements.find((s) => s.Action === "kms:Decrypt").Condition.StringEquals["kms:ViaService"], "ssm.us-east-1.amazonaws.com");
  assert.equal(statements.find((s) => s.Action === "ssm:GetParameter").Resource.length, 2);
});

test("actual Python observer rejects stale/mismatched/offline evidence without disclosing tokens", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "unittest", "discover", "-s", "infra/aws/operations-monitor", "-p", "test_handler.py"], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 11 tests/);
});

test("bucket observer rejects versioning, policy, owner and transport drift with metadata-only clients", () => {
  const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "unittest", "discover", "-s", "infra/aws/worker-bucket-monitor", "-p", "test_handler.py"], { encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  assert.match(result.stderr, /Ran 12 tests/);
});
