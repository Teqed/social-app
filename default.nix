# stolen from https://github.com/tgirlcloud/nix-templates/blob/main/node/default.nix
{ lib, buildNpmPackage }:

buildNpmPackage {
  pname = "shatteredsky-social";
  version = "0.1.0";

  src = ./.;

  npmDepsHash = lib.fakeHash;

  meta = {
    description = "social-app fork with alternative appview; toggles from deer/zepplin; catppuccin'd ";
    homepage = "https://github.com/Teqed/social-app";
    license = lib.licenses.mit;
    maintainers = with lib.maintainers; [ ];
    mainProgram = "example";
  };
}
