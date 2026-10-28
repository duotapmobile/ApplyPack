import assert from "node:assert/strict";
import test from "node:test";
import { requiredResultsPass } from "./assert-required-test-results.mjs";
test("rejects skipped, empty, failing and malformed Vitest receipts", () => {
  const passed = { success: true, numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0 };
  assert.equal(requiredResultsPass(passed), true);
  for (const patch of [{ success: false }, { numTotalTests: 0 }, { numPassedTests: 4 }, { numPendingTests: 1 }, { numTodoTests: 1 }]) {
    assert.equal(requiredResultsPass({ ...passed, ...patch }), false);
  }
  assert.equal(requiredResultsPass({}), false);
});
test("requires browser cases to pass without skip or flaky retry", () => {
  const stats = { expected: 5, unexpected: 0, skipped: 0, flaky: 0 };
  assert.equal(requiredResultsPass({ stats }), true);
  for (const patch of [{ expected: 0 }, { unexpected: 1 }, { skipped: 1 }, { flaky: 1 }]) {
    assert.equal(requiredResultsPass({ stats: { ...stats, ...patch } }), false);
  }
  assert.equal(requiredResultsPass({ stats, errors: [{}] }), false);
});
