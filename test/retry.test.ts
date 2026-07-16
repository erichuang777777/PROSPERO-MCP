import assert from "node:assert/strict";
import test from "node:test";

import { ProsperoError } from "../src/errors.js";
import { withRetry } from "../src/retry.js";

test("withRetry retries retryable errors", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    if (calls < 3) {
      throw new ProsperoError({
        code: "NETWORK_TIMEOUT",
        message: "timeout",
        retryable: true,
        action: "retry",
      });
    }
    return "ok";
  }, { attempts: 3, delays_ms: [0, 0] });

  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry does not retry permanent errors", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls += 1;
      throw new ProsperoError({
        code: "VALIDATION_ERROR",
        message: "invalid",
        retryable: false,
        action: "fix input",
      });
    }, { attempts: 3, delays_ms: [0, 0] }),
    (error: unknown) => error instanceof ProsperoError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(calls, 1);
});
