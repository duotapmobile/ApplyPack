import { readFileSync } from "node:fs";

export function requiredResultsPass(report) {
  if (report?.stats) {
    return report.stats.expected > 0 && report.stats.unexpected === 0
      && report.stats.skipped === 0 && report.stats.flaky === 0 && (report.errors?.length || 0) === 0;
  }
  return report?.success === true && report.numTotalTests > 0
    && report.numPassedTests === report.numTotalTests && report.numFailedTests === 0
    && report.numPendingTests === 0 && (report.numTodoTests || 0) === 0;
}

if (process.argv[2]) {
  try {
    if (!requiredResultsPass(JSON.parse(readFileSync(process.argv[2], "utf8")))) {
      throw new Error("required-test-results-not-passing");
    }
    process.stdout.write("Required tests passed with zero skipped, failed, todo or flaky cases.\n");
  } catch {
    process.stderr.write("Required test receipt missing, malformed, empty, skipped, flaky or failing.\n");
    process.exitCode = 1;
  }
}
