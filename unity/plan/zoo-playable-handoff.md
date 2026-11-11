# Playable Zoo handoff

Open the [Unity Web preview](http://127.0.0.1:8796/game/). **Level** cycles through 0, −5, −10, −15, and −20 m. Middle drag orbits, right drag pans, the wheel zooms, and **Reset view** reframes the selected level.

Choose **Service area** to frame the −15 m approach and Line 5 down platform. **Run** sends five passengers from Entrance B through gate 243. **Delete** on the yellow floor tile at (59, 19, −15) disconnects the route. **Floor** restores it. The teal gate slot at (59, 18, −15) accepts **Delete** and **Gate**. **Save** downloads the v1 document and **Open** loads it through the browser file picker.

## Verified in the browser

The Web smoke used pointer clicks and drags, wheel input, and the native file chooser. It verified camera controls, the level cutaway, a blocked route, gate and floor replacement, pause/resume, a visible queue, and five boarded passengers. The platform-facing train door moved 0.703 m. The downloaded save retained all station metadata, every module and line, and every cell except the intentionally removed floor tile. A fresh page reopened the save with the floor still missing. After restoring the floor, the five passengers boarded again.

- [Zoo browser report](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/zoo-playable-report.json)
- [Blocked approach](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-blocked.png), [queue](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-queue.png), [boarding](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-boarding.png)
- [Small-station browser report](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/small-station/first-playable-report.json). A fresh FirstPlayable release passed the starter, second layout and detour, including the save/reopen checks.

## Visual comparison

| View | Unity | TypeScript | Compared landmarks |
| --- | --- | --- | --- |
| Exterior, 0 m | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-exterior.png) | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/typescript-exterior.png) | Two entrance openings, planting beds, and the boulevard alignment |
| Concourse, −5 m | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-concourse.png) | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/typescript-concourse.png) | Entrance landings, connecting concourse and escalator openings |
| Down platform, −15 m | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/unity-platform.png) | [Screenshot](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/typescript-platform.png) | Gate row, escalator bank, rooms, platform strip, and rail alignment |

The comparisons use matched plan targets, elevations and orthographic angles. The renderers use different viewport sizes and level visibility treatments. Unity batches solid cells by chunk, elevation, and material, leaves authored voids empty, and approximates stair and escalator flights with stepped meshes between their authored landings. Surface finishes, signs, street markings, planting, screen doors, and much of the equipment have simplified geometry or colour. Unity uses the imported steel bench and bin for 29 matching records. The two-car Type A proxy stands in for Zoo’s Line 5 train. [Generated module ID inventory](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/generated-module-ids.json)

The service follows a 74-waypoint route from the TypeScript graph. The C# gate slice runs the five passengers, and the committed floor and gate records control whether the route can run. Editing is limited to the two marked slots. Boarding ends at the stopped train.

## Reproduce

Run from the repository root in PowerShell with Unity 6000.6.8f1 and Node 24.15.0. Commands use a fresh isolated project. Stop on any nonzero exit.

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
node tools/unity-parity/record-zoo-save.mjs
$run = '.preview/unity/zoo-playable-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$project = (New-Item -ItemType Directory -Path "$run/project" -Force).FullName
Copy-Item -LiteralPath unity/Assets,unity/Packages,unity/ProjectSettings -Destination $project -Recurse
./unity/scripts/metro-unity.ps1 doctor -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 bootstrap -Scene ZooPlayable -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 test -Mode EditMode -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 test -Mode PlayMode -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 build-web -Scene ZooPlayable -Configuration Release -ProjectPath $project -OutputDirectory $run
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath $project -OutputDirectory $run
npm --prefix game run build
node tools/unity-web/smoke-zoo-playable.mjs $run --compare

$small = "$run/small-station"
./unity/scripts/metro-unity.ps1 build-web -Scene FirstPlayable -Configuration Release -ProjectPath $project -OutputDirectory $small
./unity/scripts/metro-unity.ps1 pack-web -Configuration Release -ProjectPath $project -OutputDirectory $small
node tools/unity-web/smoke-first-playable.mjs $small --require-second --require-detour
node --test unity/tests/runtime-layering.test.mjs unity/tests/web-release-contract.test.mjs unity/tests/web-release-worker.test.mjs
```

For a persistent local preview, run the Zoo smoke script with the packed run directory and `--serve`. Set `METRO_ZOO_PORT` to select the port.

The recorded run used the root run directory for the isolated project and initial tests, then the `final` output directory for the verified Zoo build after a Unity Bee player-compilation retry and a toolbar refinement. The localhost worker streams oversized data and WASM from smaller assets. [Final build provenance](C:/Users/ericp/Desktop/metro/.preview/unity/zoo-playable-20261111-004134-059/final/web-Release.provenance.json)
