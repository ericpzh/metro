---
name: metro-unity-steam
description: Build, configure, verify, and upload the Station Designer Unity 6 Windows x64 release for Steam — dedicated steam/ release layout, Steamworks SDK 1.65 flat C ABI bridge (StationSteamHost), Steam Overlay input pausing, Steam Auto-Cloud save paths, SteamPipe VDF generation, and SteamCMD deploys.
---

# Station Designer Steam Release (`metro-unity-steam`)

End-to-end Windows x64 Steam build, Steamworks SDK 1.65 runtime integration,
and SteamPipe upload workflow for Station Designer (`Erikaze / Station Designer`).

## Sibling skills

- [metro-unity](../metro-unity/SKILL.md) — Unity 6 URP C# runtime, `BuildWindows.cs`,
  `check-unity-compile.ps1`, and EditMode/PlayMode tests.
- [metro-unity-web](../metro-unity-web/SKILL.md) — `StationDesktopUiPresenter`,
  `MetroEditorWebView.exe`, `build-windows.mjs`, and `unity/tests/`.
- [metro-unity-assets](../metro-unity-assets/SKILL.md) — public vs `INTERNAL_REVIEW_ONLY`
  passenger asset isolation.
- [metro-repo](../metro-repo/SKILL.md) — top-level commands and routing.

## Dedicated `steam/` Directory & Git Protection

All Steam release artifacts live under the dedicated top-level `steam/` folder
(separate from disposable `.preview/` scratch builds). `.gitignore` ignores
`/steam/*` except `steam/README.md` and `steam/steam-config.example.json`:

| Path | Role | Tracked in Git |
| --- | --- | --- |
| `steam/README.md` | Directory layout & upload instructions | Yes |
| `steam/steam-config.example.json` | Placeholder config template (`480` / `481`) | Yes |
| `steam/steam-config.local.json` | Real `appId`, `depotId`, `steamUser`, `setLive`, `requireSteamRestart` | **No** (gitignored) |
| `steam/sdk/steam_api64.dll` | Official Valve Steamworks SDK 1.65 binary (auto-extracted from `steamworks_sdk_*.zip`) | **No** (gitignored) |
| `steam/depot/` | Unpacked public Windows x64 Steam depot (`MetroStation.exe`, `steam_api64.dll`, self-contained WebView2) | **No** (gitignored) |
| `steam/depot-manifest.json` | Build summary & Auto-Cloud metadata | **No** (gitignored) |
| `steam/pipe/` | Generated `app_build_<appId>.vdf`, `depot_build_<depotId>.vdf`, `installscript.vdf`, and SteamCMD logs | **No** (gitignored) |

## Commands

Run from the repository root:

```powershell
# 1. Build & verify unpacked Steam depot (+ SteamPipe VDFs when appId/depotId are configured)
npm run build:unity:steam -- [--version 0.1.0] [--app-id <id> --depot-id <id>] [--set-live <branch>]

# 2. One-command build + SteamPipe upload via SteamCMD
npm run deploy:unity:steam -- [--version 0.1.0] [--steam-user <account>] [--set-live <branch>]

# 3. Upload the already-built steam/depot/ without rebuilding Unity
npm run deploy:unity:steam -- --skip-build

# 4. Dry-run to inspect the resolved SteamCMD command & generated VDF paths without uploading
npm run deploy:unity:steam -- --skip-build --dry-run

# 5. Repack an existing raw windows-Release player folder directly into steam/depot/
node tools/unity-web/pack-windows-steam.mjs <player-dir> [output-dir] [--steam-sdk <zip|dir|dll>]
```

## Architecture & Load-Bearing Contracts

### 1. Unpacked Depot (Never SFX `.exe` or `.msix`)

- Steam distributes and delta-patches an unpacked directory (`steam/depot/`),
  never the self-extracting `StationDesigner.exe` (`pack-windows-exe.mjs`) or
  Microsoft Store `.msix` (`pack-windows-msix.mjs`).
- `build-windows.mjs --steam` always forces `--no-passengers` and `--no-bundle`,
  building the clean public `StationGameLocal.unity` scene.
- `pack-windows-steam.mjs` publishes self-contained `win-x64` `MetroEditorWebView.exe`
  into `MetroStation_Data/StreamingAssets/MetroUi/bin/`, strips `.pdb`/`.xml`,
  `*_BackUpThisFolder_ButDontShipItWithYourGame`, `*_BurstDebugInformation_DoNotShip`,
  and any `steam_appid.txt`, and gates the staged tree with
  `node unity/tests/passenger-profile.test.mjs --pack <stageDir>`.

### 2. Steamworks SDK 1.65 Flat C ABI (`StationSteamHost.cs`)

- `unity/Assets/StationDesigner/Runtime/App/StationSteamHost.cs` uses Valve's
  official Steamworks SDK 1.65 flat C ABI (`steam_api64.dll`) via P/Invoke — no
  third-party Unity packages and no `.asmdef` reference changes.
- Compiled under `#if UNITY_STANDALONE_WIN && !UNITY_EDITOR` and gated at
  runtime on `steam_api64.dll` existing beside `MetroStation.exe`, so WebGL,
  MSIX, portable `.exe`, and Editor sessions never load Steam binaries.
- Key entry points & constants verified against SDK 1.65 headers:
  - `SteamAPI_RestartAppIfNecessary` (only when `requireSteamRestart: true` in
    `StreamingAssets/MetroUi/steam-runtime.json`)
  - `SteamAPI_InitFlat` (`SteamErrMsg[1024]`, `0 == OK`)
  - `SteamAPI_ManualDispatch_Init`, `SteamAPI_GetHSteamPipe`,
    `SteamAPI_ManualDispatch_RunFrame`, `SteamAPI_ManualDispatch_GetNextCallback`
    (`CallbackMsg`, `Pack = 8`), `SteamAPI_ManualDispatch_FreeLastCallback`
  - `GameOverlayActivated_t`: `GameOverlayActivatedCallbackId = 331`
    (`k_iSteamFriendsCallbacks (300) + 31`), byte 0 = `m_bActive`
  - `SteamAPI_SteamUtils_v011` / `SteamAPI_ISteamUtils_GetAppID`
  - `SteamAPI_SteamApps_v009` / `SteamAPI_ISteamApps_GetCurrentGameLanguage`
  - `SteamAPI_Shutdown`
- `StationDesktopUiPresenter` subscribes to `StationSteamHost.OverlayActiveChanged`
  to pause physical mouse/keyboard/text forwarding, clear held mouse/key state,
  and restore the OS cursor while `Shift+Tab` Steam Overlay is active. On first
  launch (no CLI route and no saved `PlayerPrefs` language), `schinese`/`tchinese`
  defaults to `/game/` and all other Steam languages default to `/game/en/`.

### 3. Company Name, Save Paths & Steam Auto-Cloud

- `unity/ProjectSettings/ProjectSettings.asset` pins `companyName: Erikaze` and
  `bundleVersion: 0.1.0` (`build-windows.mjs` patches `productName: Station Designer`).
  Do not rename `companyName` after launch — it owns `Application.persistentDataPath`.
- Configure **Steam Auto-Cloud** in Steamworks with:
  - Root: `WinAppDataLocalLow`
  - Subdirectory: `Erikaze/Station Designer`
  - Pattern: `*.metro.json`
- WebView2 prerequisite: `steam/pipe/installscript.vdf` provides the Steamworks
  install-script template for `_CommonRedist\WebView2\MicrosoftEdgeWebview2Setup.exe`
  on older Windows 10 machines.

### 4. Security & Valve License Rules

- **Never commit** `steam/steam-config.local.json`, `steam/pipe/*`, `steam/sdk/*`,
  `steam/depot/*`, or `steam_api64.dll` to Git.
- **Never store passwords** in `steam-config.local.json` (`loadSteamConfig` rejects
  `password` / `steamPassword` keys). Authenticate interactively with `steamcmd`
  using a dedicated Steamworks Build Account so credentials stay inside SteamCMD's
  own `config/` cache outside the repo.
- **Never ship `steam_appid.txt`** inside `steam/depot/` (`pack-windows-steam.mjs`
  strips it and excludes it in `depot_build_*.vdf`).

## Verification Checklist

1. `powershell -NoProfile -ExecutionPolicy Bypass -File tools/unity-parity/check-unity-compile.ps1 -OutSuffix -steam`
2. `npm run test:unity` (includes `unity/tests/windows-steam.test.mjs`,
   `runtime-layering.test.mjs`, `asset-meta.test.mjs`, `passenger-profile.test.mjs`)
3. EditMode test: `StationSteamHostTests` via `metro-editor.ps1` or `metro-unity.ps1`
4. `npm run build:unity:steam` (confirm `PASSENGER_PROFILE_PACK ... clean` and
   `steam_api64.dll=bundled` in `steam/depot/`)
5. `git status -uall -- steam/` (confirm only `steam/README.md` and
   `steam/steam-config.example.json` appear)
