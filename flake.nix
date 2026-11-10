{
  description = "Chrome MV3 extension starter (WXT + Effect v4)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
  };

  outputs =
    { self, nixpkgs }:
    let
      # Systems we provide a devShell for.
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      # Playwright Chromium only. The package name and version must stay in
      # sync with the pinned `@playwright/test` (see README).
      playwright-browsers =
        pkgs:
        pkgs.playwright-driver.browsers.override {
          withFirefox = false;
          withWebkit = false;
        };

      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.shellcheck
            pkgs.actionlint
          ];

          env = {
            PLAYWRIGHT_BROWSERS_PATH = "${playwright-browsers pkgs}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          };
        };
      });

      # `nix flake check` builds these. The devShell is the single source of
      # truth for the toolchain, so we expose it as a check to keep the flake
      # meaningful without duplicating the Node/pnpm setup.
      checks = forAllSystems (pkgs: {
        devShell = self.devShells.${pkgs.stdenv.hostPlatform.system}.default;
      });
    };
}
