import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectFiles } from "./vitest-config-files.ts";

const root = join("/", "repo");

describe("projectFiles", () => {
  it("lists config, setup and global setup files inside the root", () => {
    expect(
      projectFiles(root, [
        {
          configFile: join(root, "vitest.config.ts"),
          setupFiles: [join(root, "test", "setup.ts")],
          globalSetup: join(root, "test", "global.ts"),
        },
        {
          configFile: join(root, "vitest.config.ts"),
          setupFiles: [],
          globalSetup: [join(root, "a-global.ts")],
        },
      ]),
    ).toEqual([
      "a-global.ts",
      "test/global.ts",
      "test/setup.ts",
      "vitest.config.ts",
    ]);
  });

  it("leaves out files outside the root, in node_modules or relative", () => {
    expect(
      projectFiles(root, [
        {
          configFile: false,
          setupFiles: [
            join("/", "elsewhere", "setup.ts"),
            join(root, "node_modules", "pkg", "setup.js"),
            "relative/setup.ts",
            root,
          ],
          globalSetup: undefined,
        },
      ]),
    ).toEqual([]);
  });
});
