import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { httpErrorHandler } from "../dist/server/server/http-errors.js";

// Exercise the error response contract without a listener, database or credentials.
function respond(error) {
  const headers = { "X-Request-Id": "test-request-id" };
  const result = { logs: [], headers };
  const res = {
    getHeader: name => headers[name],
    setHeader: (name, value) => { headers[name] = value; },
    status: value => { result.status = value; return res; },
    json: value => { result.body = JSON.parse(JSON.stringify(value)); },
  };
  const original = console.error;
  console.error = value => result.logs.push(value);
  try {
    httpErrorHandler(error, {}, res, () => assert.fail("Unexpected next()"));
  } finally {
    console.error = original;
  }
  assert.equal(result.body.requestId, headers["X-Request-Id"]);
  return result;
}

test("Express recognizes the four-argument error middleware", () => {
  assert.equal(httpErrorHandler.length, 4);
});

test("validation errors keep status, code and field issues", () => {
  const parsed = z.object({ name: z.string() }).safeParse({ name: 123 });
  assert.equal(parsed.success, false);
  const result = respond(parsed.error);
  assert.equal(result.status, 422);
  assert.equal(result.body.code, "INVALID_PAYLOAD");
  assert.equal(result.body.message, "Dữ liệu chưa hợp lệ");
  assert.deepEqual(result.body.fieldErrors, parsed.error.issues);
  assert.deepEqual(result.logs, []);
});

test("SQLite constraints take precedence and hide storage details", () => {
  const result = respond({ code: "SQLITE_CONSTRAINT_UNIQUE", status: 500, message: "private SQL" });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "CONFLICT");
  assert.equal(result.body.message, "Dữ liệu trùng hoặc đang được sử dụng");
  assert.deepEqual(result.logs, []);
});

test("JSON parse and upload errors keep their existing messages", () => {
  const invalid = respond({ status: 400, type: "entity.parse.failed", message: "private body" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_JSON");
  assert.equal(invalid.body.message, "Nội dung JSON không hợp lệ");
  const large = respond({ status: 413, type: "entity.parse.failed" });
  assert.equal(large.status, 413);
  assert.equal(large.body.code, "UPLOAD_TOO_LARGE");
  assert.equal(large.body.message, "Dữ liệu tải lên vượt dung lượng cho phép");
});

test("application errors preserve details and rate-limit retry headers", () => {
  const result = respond({ code: "RATE_LIMIT", status: 429, message: "Try later", details: { retry: true } });
  assert.equal(result.status, 429);
  assert.equal(result.body.code, "RATE_LIMIT");
  assert.equal(result.body.message, "Try later");
  assert.deepEqual(result.body.fieldErrors, { retry: true });
  assert.equal(result.headers["Retry-After"], "60");
});

test("internal errors hide diagnostics and log only the lookup code", () => {
  const result = respond(new Error("private diagnostic"));
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "INTERNAL_ERROR");
  assert.equal(result.body.message, "Không thể hoàn tất thao tác; thử lại với mã tra cứu");
  assert.deepEqual(result.logs.map(value => JSON.parse(value)), [
    { requestId: "test-request-id", code: "INTERNAL_ERROR" },
  ]);
  assert.equal(JSON.stringify(result).includes("private diagnostic"), false);
});

test("AI configuration and provider messages remain available", () => {
  for (const code of ["AI_NOT_CONFIGURED", "OPENROUTER_UNAVAILABLE", "GEMINI_UNAVAILABLE"]) {
    const result = respond({ code, status: 503, message: "Provider unavailable" });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, code);
    assert.equal(result.body.message, "Provider unavailable");
    assert.deepEqual(result.logs.map(value => JSON.parse(value)), [
      { requestId: "test-request-id", code },
    ]);
  }
});
