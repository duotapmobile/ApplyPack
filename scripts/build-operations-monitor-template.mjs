import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ref = (name) => ({ Ref: name });
const attr = (name, field) => ({ "Fn::GetAtt": [name, field] });
export function operationsMonitorTemplate() {
  const resources = {
    Alerts: { Type: "AWS::SNS::Topic", Properties: { TopicName: "applypack-operations-alerts",
      Subscription: [{ Protocol: "email", Endpoint: ref("AlertEmail") }] } },
    AlertPolicy: { Type: "AWS::SNS::TopicPolicy", Properties: { Topics: [ref("Alerts")], PolicyDocument: { Version: "2012-10-17", Statement: [{
      Effect: "Allow", Principal: { Service: "cloudwatch.amazonaws.com" }, Action: "sns:Publish", Resource: ref("Alerts"),
      Condition: { StringEquals: { "aws:SourceAccount": "838445019912" }, ArnLike: { "aws:SourceArn": "arn:aws:cloudwatch:us-east-1:838445019912:alarm:applypack-operations-*" } },
    }] } } },
    Logs: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: "/aws/lambda/applypack-operations-monitor", RetentionInDays: 7 } },
    Role: { Type: "AWS::IAM::Role", Properties: {
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] },
      Policies: [{ PolicyName: "read-fixed-health-and-publish-fixed-metrics", PolicyDocument: { Version: "2012-10-17", Statement: [
        { Effect: "Allow", Action: "ssm:GetParameter", Resource: ["production", "staging"].map((env) => `arn:aws:ssm:us-east-1:838445019912:parameter/applypack/operations-monitor/${env}`) },
        { Effect: "Allow", Action: "kms:Decrypt", Resource: ref("ExistingParameterKmsKeyArn"), Condition: { StringEquals: {
          "kms:ViaService": "ssm.us-east-1.amazonaws.com", "kms:EncryptionContext:PARAMETER_ARN": ["production", "staging"].map((env) => `arn:aws:ssm:us-east-1:838445019912:parameter/applypack/operations-monitor/${env}`),
        } } },
        { Effect: "Allow", Action: "cloudwatch:PutMetricData", Resource: "*", Condition: { StringEquals: { "cloudwatch:namespace": "ApplyPack/IndependentOperations" } } },
        { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: "arn:aws:logs:us-east-1:838445019912:log-group:/aws/lambda/applypack-operations-monitor:log-stream:*" },
      ] } }],
    } },
    Observer: { Type: "AWS::Lambda::Function", DependsOn: "Logs", Properties: {
      FunctionName: "applypack-operations-monitor", Runtime: "python3.13", Handler: "handler.handler", Architectures: ["arm64"],
      Role: attr("Role", "Arn"), MemorySize: 128, Timeout: 45, ReservedConcurrentExecutions: 1,
      Code: { S3Bucket: ref("ExistingCodeBucket"), S3Key: ref("CodeKey"), S3ObjectVersion: ref("CodeVersion") },
      Environment: { Variables: { PRODUCTION_RELEASE_SHA: ref("ProductionReleaseSha"), STAGING_RELEASE_SHA: ref("StagingReleaseSha") } },
    } },
    ObserverVersion: { Type: "AWS::Lambda::Version", Properties: { FunctionName: ref("Observer"),
      CodeSha256: ref("ExpectedCodeSha256"),
      Description: { "Fn::Join": [" ", ["Release-bound observer", ref("CodeKey"), ref("ProductionReleaseSha"), ref("StagingReleaseSha")]] },
    } },
    InvocationPolicy: { Type: "AWS::Lambda::EventInvokeConfig", Properties: { FunctionName: ref("Observer"),
      Qualifier: attr("ObserverVersion", "Version"), MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0,
    } },
    Schedule: { Type: "AWS::Events::Rule", DependsOn: "InvocationPolicy", Properties: { Name: "applypack-operations-observer", ScheduleExpression: "rate(1 minute)",
      State: { "Fn::If": ["MonitoringEnabled", "ENABLED", "DISABLED"] },
      Targets: [{ Id: "observer", Arn: ref("ObserverVersion"), RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }] } },
    SchedulePermission: { Type: "AWS::Lambda::Permission", Properties: { FunctionName: ref("ObserverVersion"), Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com", SourceArn: attr("Schedule", "Arn"), SourceAccount: "838445019912" } },
    BucketLogs: { Type: "AWS::Logs::LogGroup", Properties: { LogGroupName: "/aws/lambda/applypack-worker-bucket-monitor", RetentionInDays: 7 } },
    BucketRole: { Type: "AWS::IAM::Role", Properties: {
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] },
      Policies: [{ PolicyName: "read-fixed-bucket-controls-and-publish-health", PolicyDocument: { Version: "2012-10-17", Statement: [
        { Effect: "Allow", Action: ["s3:GetBucketVersioning", "s3:GetBucketPolicy"], Resource: ["staging", "production"].map((env) => `arn:aws:s3:::applypack-838445019912-${env}-document-worker-temp`) },
        { Effect: "Allow", Action: "cloudwatch:PutMetricData", Resource: "*", Condition: { StringEquals: { "cloudwatch:namespace": "ApplyPack/IndependentOperations" } } },
        { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents"], Resource: "arn:aws:logs:us-east-1:838445019912:log-group:/aws/lambda/applypack-worker-bucket-monitor:log-stream:*" },
      ] } }],
    } },
    BucketObserver: { Type: "AWS::Lambda::Function", DependsOn: "BucketLogs", Properties: {
      FunctionName: "applypack-worker-bucket-monitor", Runtime: "python3.13", Handler: "handler.handler", Architectures: ["arm64"],
      Role: attr("BucketRole", "Arn"), MemorySize: 128, Timeout: 30, ReservedConcurrentExecutions: 1,
      Code: { S3Bucket: ref("ExistingCodeBucket"), S3Key: ref("BucketCodeKey"), S3ObjectVersion: ref("BucketCodeVersion") },
      Environment: { Variables: { APP_DOCUMENT_WORKER_BUCKET_MONITOR_ENABLED: ref("ActivateMonitoring") } },
    } },
    BucketObserverVersion: { Type: "AWS::Lambda::Version", Properties: { FunctionName: ref("BucketObserver"),
      CodeSha256: ref("ExpectedBucketCodeSha256"),
      Description: { "Fn::Join": [" ", ["Fixed bucket controls observer", ref("BucketCodeKey"), ref("ActivateMonitoring")]] },
    } },
    BucketInvocationPolicy: { Type: "AWS::Lambda::EventInvokeConfig", Properties: { FunctionName: ref("BucketObserver"),
      Qualifier: attr("BucketObserverVersion", "Version"), MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0,
    } },
    BucketSchedule: { Type: "AWS::Events::Rule", DependsOn: "BucketInvocationPolicy", Properties: { Name: "applypack-worker-bucket-observer", ScheduleExpression: "rate(5 minutes)",
      State: { "Fn::If": ["MonitoringEnabled", "ENABLED", "DISABLED"] },
      Targets: [{ Id: "bucket-observer", Arn: ref("BucketObserverVersion"), RetryPolicy: { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 } }] } },
    BucketSchedulePermission: { Type: "AWS::Lambda::Permission", Properties: { FunctionName: ref("BucketObserverVersion"), Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com", SourceArn: attr("BucketSchedule", "Arn"), SourceAccount: "838445019912" } },
    BucketIsolationAlarm: { Type: "AWS::CloudWatch::Alarm", Properties: {
      AlarmName: "applypack-operations-document-worker-bucket-isolation",
      AlarmDescription: "Temporary document bucket control is missing, changed, or unverifiable. Pause new document work, inspect exact bucket controls, preserve paid obligations, and verify cleanup before resuming.",
      Namespace: "ApplyPack/IndependentOperations", MetricName: "DocumentWorkerBucketsHealthy", Unit: "Count",
      Period: 300, EvaluationPeriods: 2, DatapointsToAlarm: 2, Statistic: "Minimum", Threshold: 1,
      ComparisonOperator: "LessThanThreshold", TreatMissingData: "breaching",
      ActionsEnabled: { "Fn::If": ["MonitoringEnabled", true, false] }, AlarmActions: [ref("Alerts")], OKActions: [ref("Alerts")],
    } },
  };
  for (const environment of ["staging", "production"]) {
    resources[`${environment}DocumentWorkerErrorsAlarm`] = { Type: "AWS::CloudWatch::Alarm", Properties: {
      AlarmName: `applypack-operations-${environment}-document-worker-errors`,
      AlarmDescription: "A document worker invocation failed. Inspect redacted failure evidence and cleanup; reconcile the existing draft before retrying.",
      Namespace: "AWS/Lambda", MetricName: "Errors", Dimensions: [{ Name: "FunctionName", Value: `applypack-${environment}-document-worker` }],
      Unit: "Count", Period: 60, EvaluationPeriods: 1, DatapointsToAlarm: 1, Statistic: "Sum", Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold", TreatMissingData: "notBreaching",
      ActionsEnabled: { "Fn::If": ["MonitoringEnabled", true, false] }, AlarmActions: [ref("Alerts")], OKActions: [ref("Alerts")],
    } };
  }
  for (const [environment, checks] of Object.entries({ production: ["maintenance", "fileRecovery", "databaseRecovery", "archiveRetention"], staging: ["maintenance"] })) {
    for (const check of checks) {
      const periods = check === "maintenance" ? 5 : 2;
      resources[`${environment}${check}Alarm`] = { Type: "AWS::CloudWatch::Alarm", Properties: {
        AlarmName: `applypack-operations-${environment}-${check}`, AlarmDescription: "Verified evidence missing, stale, failed, or unavailable. Follow the independent operations runbook; preserve paid work.",
        Namespace: "ApplyPack/IndependentOperations", MetricName: "VerifiedHealthy",
        Dimensions: [{ Name: "Environment", Value: environment }, { Name: "Check", Value: check }], Unit: "Count",
        Period: 60, EvaluationPeriods: periods, DatapointsToAlarm: periods, Statistic: "Minimum", Threshold: 1,
        ComparisonOperator: "LessThanThreshold", TreatMissingData: "breaching",
        ActionsEnabled: { "Fn::If": ["MonitoringEnabled", true, false] }, AlarmActions: [ref("Alerts")], OKActions: [ref("Alerts")],
      } };
    }
  }
  return { AWSTemplateFormatVersion: "2010-09-09", Description: "ApplyPack independent operations observer. Local preparation only; cost and provider approval required before provisioning.",
    Parameters: {
      ActivateMonitoring: { Type: "String", AllowedValues: ["true", "false"], Default: "false" },
      AlertEmail: { Type: "String", AllowedPattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", MaxLength: 254, Description: "Owner-approved destination; SNS subscription must be confirmed and tested." },
      ExistingParameterKmsKeyArn: { Type: "String", AllowedPattern: "^arn:aws:kms:us-east-1:838445019912:key/[a-f0-9-]{36}$" },
      ExistingCodeBucket: { Type: "String", AllowedPattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$" },
      CodeKey: { Type: "String", AllowedPattern: "^operations-monitor/[a-f0-9]{64}\\.zip$" },
      CodeVersion: { Type: "String", MinLength: 1, MaxLength: 1024, AllowedPattern: "^(?!null$)[A-Za-z0-9._~+/=:-]+$" },
      ExpectedCodeSha256: { Type: "String", AllowedPattern: "^[A-Za-z0-9+/]{43}=$", Description: "Base64 SHA-256 of the exact reviewed zip, from the package receipt." },
      BucketCodeKey: { Type: "String", AllowedPattern: "^worker-bucket-monitor/[a-f0-9]{64}\\.zip$" },
      BucketCodeVersion: { Type: "String", MinLength: 1, MaxLength: 1024, AllowedPattern: "^(?!null$)[A-Za-z0-9._~+/=:-]+$" },
      ExpectedBucketCodeSha256: { Type: "String", AllowedPattern: "^[A-Za-z0-9+/]{43}=$", Description: "Base64 SHA-256 of the separate reviewed bucket observer zip." },
      ProductionReleaseSha: { Type: "String", AllowedPattern: "^[a-f0-9]{40}$" },
      StagingReleaseSha: { Type: "String", AllowedPattern: "^[a-f0-9]{40}$" },
    },
    Rules: { FixedAccountAndRegion: { Assertions: [{ Assert: { "Fn::And": [{ "Fn::Equals": [ref("AWS::AccountId"), "838445019912"] },
      { "Fn::Equals": [ref("AWS::Region"), "us-east-1"] }] }, AssertDescription: "Only the verified ApplyPack account and region are supported." }] } },
    Conditions: { MonitoringEnabled: { "Fn::Equals": [ref("ActivateMonitoring"), "true"] } }, Resources: resources,
    Outputs: { ObserverArn: { Value: ref("ObserverVersion") }, BucketObserverArn: { Value: ref("BucketObserverVersion") }, AlertTopicArn: { Value: ref("Alerts") },
      OperatorAction: { Value: "Confirm alert subscription and prove both failure and recovery delivery outside Railway before acceptance." } },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.slice(2).join(" ") !== "--write") throw new Error("Use --write to regenerate the local template; this command never provisions resources.");
  writeFileSync(new URL("../infra/aws/operations-monitor/template.json", import.meta.url), `${JSON.stringify(operationsMonitorTemplate(), null, 2)}\n`);
}
