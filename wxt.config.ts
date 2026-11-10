import { defineConfig } from "wxt";

// WXT configuration for a Chrome MV3-only extension.
//
// Notes:
// - We disable the WXT runner (`webExt.disabled`) because development happens
//   inside WSL and the unpacked extension is loaded manually in Windows Chrome.
// - The output directory is left at the WXT default (`.output/`) so that
//   Windows can load `\\wsl.localhost\<distro>\...\.output\chrome-mv3-dev`.
export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  browser: "chrome",
  webExt: {
    disabled: true,
  },
  manifest: {
    name: "Chrome MV3 Template",
    description: "WXT + Effect v4 starter template for Chrome MV3 extensions.",
    version: "0.1.0",
    permissions: ["storage", "tabs"],
    action: {
      default_title: "Chrome MV3 Template",
    },
  },
});
