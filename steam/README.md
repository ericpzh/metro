# Steam Release Directory (`steam/`)

Dedicated directory for Station Designer's Steam Windows x64 release artifacts and
SteamPipe configuration (separate from disposable `.preview/` scratch builds).

## Layout & Git Protection

`.gitignore` ignores everything in `steam/*` except this `README.md` and
`steam-config.example.json`:

| Path | Purpose | Tracked in Git |
| --- | --- | --- |
| `steam/README.md` | Directory guide | Yes |
| `steam/steam-config.example.json` | Placeholder config template (`480`/`481`) | Yes |
| `steam/steam-config.local.json` | Real `appId`, `depotId`, branch, `requireSteamRestart` | **No** (gitignored) |
| `steam/sdk/steam_api64.dll` | Official Valve Steamworks SDK 1.65 binary (auto-extracted from `steamworks_sdk_*.zip`) | **No** (gitignored) |
| `steam/depot/` | Unpacked public Windows x64 Steam depot (`MetroStation.exe`, `steam_api64.dll`, self-contained WebView2) | **No** (gitignored) |
| `steam/depot-manifest.json` | Build summary & Steam Auto-Cloud metadata | **No** (gitignored) |
| `steam/pipe/` | Generated `app_build_<appId>.vdf`, `depot_build_<depotId>.vdf`, `installscript.vdf`, and SteamCMD logs | **No** (gitignored) |

## Workflow

1. Copy `steam/steam-config.example.json` to `steam/steam-config.local.json` and fill in your real Steam `appId`, `depotId`, and optional `steamUser` (never put a password in this file).
2. Build and verify the unpacked Steam depot + VDFs:
   ```powershell
   npm run build:unity:steam -- --version 0.1.0
   ```
3. Build + upload in one command via SteamCMD (prompts interactively for password / Steam Guard only when no cached token exists):
   ```powershell
   npm run deploy:unity:steam -- --version 0.1.0
   # Or upload the already-built steam/depot/ without rebuilding Unity:
   npm run deploy:unity:steam -- --skip-build
   # Preview the exact steamcmd invocation without uploading:
   npm run deploy:unity:steam -- --skip-build --dry-run
   ```
4. Configure Steam Auto-Cloud in Steamworks:
   - Root: `WinAppDataLocalLow`
   - Subdirectory: `Erikaze/Station Designer`
   - Pattern: `*.metro.json`
