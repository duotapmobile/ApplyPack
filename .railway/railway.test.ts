import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRailwayContext } from "railway/iac";

import program from "./railway.ts";

const AUTHORIZATION_ENV =
  "APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION";
const AUTHORIZATION_VALUE =
  "apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86";
const EXPECTED_CONTEXT = {
  projectId: "fb5a58c4-8ccb-4205-82f9-8b8738c84e56",
  projectName: "Apply Pack",
  environmentId: "6633e585-5bcd-4729-b167-2a99628daf86",
  environment: "staging",
  environmentName: "staging",
};

const originalAuthorization = process.env[AUTHORIZATION_ENV];

afterEach(() => {
  if (originalAuthorization === undefined) {
    delete process.env[AUTHORIZATION_ENV];
  } else {
    process.env[AUTHORIZATION_ENV] = originalAuthorization;
  }
});

async function evaluate(command?: string) {
  return program(
    createRailwayContext({ ...EXPECTED_CONTEXT, command }),
    undefined as never,
  );
}

test("plan evaluation remains available without the cutover marker", async () => {
  delete process.env[AUTHORIZATION_ENV];
  assert.equal((await evaluate("plan")).name, "Apply Pack");
});

test("apply evaluation rejects an absent or near-match cutover marker", async () => {
  for (const value of [
    undefined,
    "true",
    `${AUTHORIZATION_VALUE}:extra`,
    AUTHORIZATION_VALUE.toUpperCase(),
  ]) {
    if (value === undefined) {
      delete process.env[AUTHORIZATION_ENV];
    } else {
      process.env[AUTHORIZATION_ENV] = value;
    }

    await assert.rejects(evaluate("apply"), {
      message: "APPLYPACK_RAILWAY_IAC_APPLY_NOT_AUTHORIZED",
    });
  }
});

test("apply evaluation permits only the exact staging marker", async () => {
  process.env[AUTHORIZATION_ENV] = AUTHORIZATION_VALUE;
  assert.equal((await evaluate("apply")).name, "Apply Pack");
});

test("the identity guard remains active when apply is authorized", async () => {
  process.env[AUTHORIZATION_ENV] = AUTHORIZATION_VALUE;

  for (const field of Object.keys(EXPECTED_CONTEXT)) {
    const context = {
      ...createRailwayContext({ ...EXPECTED_CONTEXT, command: "apply" }),
      [field]: "unexpected",
    };
    await assert.rejects(async () => program(context, undefined as never), {
      message: "APPLYPACK_RAILWAY_IAC_STAGING_IDENTITY_MISMATCH",
    });
  }
});
