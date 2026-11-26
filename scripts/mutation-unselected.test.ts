import { describe, expect, it } from "vitest";
import { onlyArguments } from "./mutation-unselected.ts";

describe("onlyArguments", () => {
  it("runs each key with --only and the kill matrix, writing JSON to the directory", () => {
    expect(onlyArguments(["a", "b"], "/tmp/x")).toEqual([
      "exec",
      "mutator",
      "--only",
      "a",
      "--only",
      "b",
      "--kill-matrix",
      "--reporter",
      "json",
      "--report-dir",
      "/tmp/x",
    ]);
  });
});
