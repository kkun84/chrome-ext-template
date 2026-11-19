import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeRequestEnvelope,
  ListSavedUrlsRequest,
  ListSavedUrlsSuccess,
  RequestFailed,
  Response,
  SaveCurrentTabRequest,
  SaveCurrentTabSuccess,
} from "./messages.js";

const decodeResponse = Schema.decodeUnknownResult(Response);

const envelope = (payload: unknown): unknown => ({
  _tag: "RequestEnvelope",
  payload,
});

describe("decodeRequestEnvelope", () => {
  it("decodes a save-current-tab request", () => {
    const result = decodeRequestEnvelope(
      envelope({ _tag: "SaveCurrentTabRequest" }),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.payload).toBeInstanceOf(SaveCurrentTabRequest);
    }
  });

  it("decodes a list-saved-urls request", () => {
    const result = decodeRequestEnvelope(
      envelope({ _tag: "ListSavedUrlsRequest" }),
    );
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.payload).toBeInstanceOf(ListSavedUrlsRequest);
    }
  });

  it("rejects a payload with an unknown tag", () => {
    expect(decodeRequestEnvelope(envelope({ _tag: "Nope" }))._tag).toBe(
      "Failure",
    );
    expect(decodeRequestEnvelope(envelope({ _tag: "" }))._tag).toBe("Failure");
  });

  it("rejects anything that is not a request envelope", () => {
    expect(
      decodeRequestEnvelope({
        _tag: "",
        payload: { _tag: "SaveCurrentTabRequest" },
      })._tag,
    ).toBe("Failure");
    expect(decodeRequestEnvelope({ _tag: "RequestEnvelope" })._tag).toBe(
      "Failure",
    );
    expect(decodeRequestEnvelope("save")._tag).toBe("Failure");
  });
});

describe("Response", () => {
  it("decodes each kind of response", () => {
    const saved = decodeResponse({
      _tag: "SaveCurrentTabSuccess",
      saved: "https://a.example/",
      alreadySaved: false,
    });
    const listed = decodeResponse({
      _tag: "ListSavedUrlsSuccess",
      urls: ["https://a.example/"],
    });
    const failed = decodeResponse({ _tag: "RequestFailed", reason: "unknown" });

    expect(saved._tag === "Success" && saved.success).toBeInstanceOf(
      SaveCurrentTabSuccess,
    );
    expect(listed._tag === "Success" && listed.success).toBeInstanceOf(
      ListSavedUrlsSuccess,
    );
    expect(failed._tag === "Success" && failed.success).toBeInstanceOf(
      RequestFailed,
    );
  });

  it("rejects a save result without its fields", () => {
    expect(decodeResponse({ _tag: "SaveCurrentTabSuccess" })._tag).toBe(
      "Failure",
    );
    expect(
      decodeResponse({
        _tag: "SaveCurrentTabSuccess",
        saved: "chrome://extensions",
        alreadySaved: false,
      })._tag,
    ).toBe("Failure");
  });

  it("rejects a failure reason outside the closed set", () => {
    expect(decodeResponse({ _tag: "RequestFailed", reason: "" })._tag).toBe(
      "Failure",
    );
    expect(
      decodeResponse({ _tag: "RequestFailed", reason: "timeout" })._tag,
    ).toBe("Failure");
  });
});
