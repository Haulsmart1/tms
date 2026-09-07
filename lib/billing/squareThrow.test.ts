import { describe, expect, it } from "vitest";
import { SquareError, SquareTimeoutError } from "square";
import { classifySquareThrow } from "./squareThrow";

// Every error below is a REAL SDK error object built the way
// node_modules/square/errors/handleNonStatusCodeError.js builds it, not a
// duck-typed stand-in. A duck-typed object would pass an `instanceof` test
// nowhere and would let the classifier be wrong about the one thing these
// tests exist to pin down: which SDK failures are declines.

describe("classifySquareThrow", () => {
  it("treats a 4xx with a parsed error code as a decline", () => {
    // What an actual card refusal looks like: Square answered with a status
    // and its own error body.
    const error = new SquareError({
      statusCode: 402,
      body: {
        errors: [
          { category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED" },
        ],
      },
    });
    expect(classifySquareThrow(error)).toEqual({
      kind: "declined",
      failureCode: "CARD_DECLINED",
    });
  });

  it("treats a SquareError with no statusCode as indeterminate", () => {
    // reason: "unknown" in handleNonStatusCodeError, which is what the fetcher
    // produces for a socket reset, a DNS failure or a TLS error. This is the
    // case the old code recorded as a decline, which let the retry charge the
    // card a second time.
    const error = new SquareError({ message: "socket hang up" });
    const result = classifySquareThrow(error);
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({ reason: expect.stringContaining("NO_STATUS_CODE") });
  });

  it("treats an unparseable 2xx body as indeterminate", () => {
    // reason: "non-json" on a 200. The payment very likely SUCCEEDED and we
    // just could not read the answer.
    const error = new SquareError({
      statusCode: 200,
      body: "<html>gateway</html>",
    });
    const result = classifySquareThrow(error);
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({
      reason: expect.stringContaining("UNREADABLE_RESPONSE_200"),
    });
  });

  it("treats a null 2xx body as indeterminate", () => {
    // reason: "body-is-null".
    const error = new SquareError({ statusCode: 200 });
    expect(classifySquareThrow(error)).toEqual({
      kind: "indeterminate",
      reason: "UNREADABLE_RESPONSE_200",
    });
  });

  it("treats a 4xx with no parsed body as indeterminate", () => {
    // The SDK synthesises errors[0].code = "Unknown" here, so a classifier that
    // trusted the errors array would call this a decline with a meaningless
    // code.
    const nonJson = new SquareError({ statusCode: 400, body: "not json" });
    expect(classifySquareThrow(nonJson)).toEqual({
      kind: "indeterminate",
      reason: "UNPARSED_BODY_400",
    });

    const bodyIsNull = new SquareError({ statusCode: 409 });
    expect(classifySquareThrow(bodyIsNull)).toEqual({
      kind: "indeterminate",
      reason: "UNPARSED_BODY_409",
    });
  });

  it("treats a 429 as indeterminate even with a parsed error code", () => {
    const error = new SquareError({
      statusCode: 429,
      body: { errors: [{ category: "RATE_LIMIT_ERROR", code: "RATE_LIMITED" }] },
    });
    expect(classifySquareThrow(error)).toEqual({
      kind: "indeterminate",
      reason: "RATE_LIMITED_429",
    });
  });

  it("treats a 5xx as indeterminate even with a parsed error code", () => {
    const error = new SquareError({
      statusCode: 503,
      body: { errors: [{ category: "API_ERROR", code: "SERVICE_UNAVAILABLE" }] },
    });
    expect(classifySquareThrow(error)).toEqual({
      kind: "indeterminate",
      reason: "SERVER_ERROR_503",
    });
  });

  it("treats a timeout as indeterminate", () => {
    // SquareTimeoutError does NOT extend SquareError, so this must be matched
    // on its own class or it falls through as a generic throw.
    const error = new SquareTimeoutError("Timeout exceeded when calling POST /v2/payments.");
    expect(error instanceof SquareError).toBe(false);
    const result = classifySquareThrow(error);
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({ reason: expect.stringContaining("TIMEOUT") });
  });

  it("treats a plain Error as indeterminate", () => {
    const result = classifySquareThrow(new TypeError("fetch failed"));
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({
      reason: expect.stringContaining("NON_SQUARE_THROW"),
    });
  });

  it("treats a non-Error throw as indeterminate", () => {
    const result = classifySquareThrow("boom");
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({
      reason: expect.stringContaining("NON_ERROR_THROW"),
    });
  });

  it("never reports a decline without a failure code", () => {
    // Any decline that reaches the audit row must carry something an operator
    // can act on, because that code is what the customer is shown.
    const declined = classifySquareThrow(
      new SquareError({
        statusCode: 400,
        body: { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CVV_FAILURE" }] },
      })
    );
    expect(declined).toEqual({ kind: "declined", failureCode: "CVV_FAILURE" });
  });
});
