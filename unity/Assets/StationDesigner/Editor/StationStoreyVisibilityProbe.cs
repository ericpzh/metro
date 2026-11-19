using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Live Editor inspection probe for storey visibility across stationary geometry,
    /// soft-human crowd actors, train formations and pooled road vehicles.
    ///
    /// Registered as <c>metro station_storey_probe</c> and
    /// <c>metro station_storey_probe_finish</c> for serialized CLI verification via
    /// <c>unity/scripts/metro-editor.ps1</c>.
    /// </summary>
    public static class StationStoreyVisibilityProbe {
        const string Group = "metro";
        const string SceneName = "StationGameLocal";

        sealed class Baseline {
            public Camera Camera;
            public Vector3 Position;
            public Quaternion Rotation;
            public bool Orthographic;
            public float OrthographicSize;
            public float FieldOfView;
            public float NearClipPlane;
            public float FarClipPlane;
            public bool Enabled;
            public float TimeScale;
            public float FixedDeltaTime;
            public bool WasPlaying;
        }

        static Baseline pending;

        [CliGroupCommand(Group,
            "Open or reuse a paused StationGameLocal session, apply storey/view settings, and inspect live draw state of passengers, trains, road vehicles and supporting geometry.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> StationStoreyProbe(
            CommandContext cmd,
            [CliArg("demo", "Demo id serialized in StationGameLocal.unity: zoo, tanwei or tianhe.")] string demo = "zoo",
            [CliArg("ticks", "Fixed simulation ticks from 06:30:00 when reopen is true (85 = 06:31:25).")] int ticks = 85,
            [CliArg("reopen", "True to reload the demo and step fixed ticks; false to reuse the current paused frame.")] bool reopen = true,
            [CliArg("level", "Active storey level in metres (e.g. -20, -15, -10, 0).")] int level = -20,
            [CliArg("show-levels", "Show Other Floors toggle.")] bool showLevels = true,
            [CliArg("hide-ground", "Hide Ground toggle.")] bool hideGround = false,
            [CliArg("hide-ui", "Hide UI toggle.")] bool hideUi = false,
            [CliArg("cutaway", "Section cutaway toggle.")] bool cutaway = false,
            [CliArg("output-path", "Optional path for the JSON report beneath .preview/unity/.")] string outputPath = null) {
            var result = new JObject {
                ["schemaVersion"] = 1,
                ["command"] = "metro station_storey_probe",
                ["status"] = "running",
                ["demo"] = demo,
                ["ticks"] = ticks,
                ["reopen"] = reopen,
                ["requestedView"] = new JObject {
                    ["level"] = level,
                    ["showLevels"] = showLevels,
                    ["hideGround"] = hideGround,
                    ["hideUi"] = hideUi,
                    ["cutaway"] = cutaway,
                },
            };

            try {
                if (!EditorApplication.isPlaying) {
                    throw new InvalidOperationException("Unity Editor is not in Play Mode.");
                }
                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (host == null) {
                    throw new InvalidOperationException("No StationGameHost is loaded in the active scene.");
                }
                var activeScene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
                if (!string.Equals(activeScene.name, SceneName, StringComparison.Ordinal)) {
                    throw new InvalidOperationException("Active scene is '" + activeScene.name + "', expected '" + SceneName + "'.");
                }

                if (PassengerCatalogueAnchor.Resolve() == null) {
                    LocalPassengerInjection.InjectNow();
                }

                if (pending == null) {
                    pending = CaptureBaseline(host);
                }
                StationEditorReactOverlay.SmokeSuppressed = true;

                Time.timeScale = 1f;
                for (int i = 0; i < 2; i++) await Task.Yield();
                Time.timeScale = 0f;

                if (reopen || !host.IsLoaded || !string.Equals(host.CurrentSourceId, demo, StringComparison.Ordinal)) {
                    SendCommandChecked(host, "station.openDemo", new JObject { ["id"] = demo }, expectCommit: true);

                    var simHost = host.Simulation as StationSimulationHost;
                    var session = simHost?.Session ?? throw new InvalidOperationException("No simulation session after openDemo.");
                    session.SeekToSimTime(StationClock.ReferenceBootSeconds);
                    session.Restart();
                    session.SetPlaying(true);
                    for (int i = 0; i < ticks; i++) {
                        int stepped = session.Advance(1.0);
                        if (stepped != 1) {
                            throw new InvalidOperationException("Advance(1.0) stepped " + stepped + " ticks at index " + i + ".");
                        }
                    }
                    session.SetPlaying(false);

                    var rigInit = host.GetComponent<StationViewRig>() ?? StationViewFeature.Attach(host);
                    if (rigInit != null && rigInit.Configured) {
                        rigInit.CameraController.Home();
                        rigInit.CameraController.ZoomBy(0.55f);
                        rigInit.Commands.ApplyCamera();
                    }

                    // Let frame sinks pose the paused frame once before applying view slicing.
                    for (int i = 0; i < 6; i++) await Task.Yield();
                }

                SendViewBool(host, "ceiling", false);
                SendViewBool(host, "walls", false);
                SendViewBool(host, "ground", hideGround);
                SendViewBool(host, "roof", false);
                SendViewBool(host, "hideUi", hideUi);
                SendViewBool(host, "cutaway", cutaway);
                SendViewBool(host, "showLevels", showLevels);
                SendViewInt(host, "level", level);

                for (int i = 0; i < 8; i++) await Task.Yield();

                var simulationHost = host.Simulation as StationSimulationHost;
                var liveSession = simulationHost?.Session ?? throw new InvalidOperationException("No committed simulation session.");
                var rig = host.GetComponent<StationViewRig>();
                var visibility = rig?.Visibility ?? throw new InvalidOperationException("No StationVisibilityRegistry on StationViewRig.");
                var world = host.Coordinator?.World ?? throw new InvalidOperationException("No committed StationWorldView.");
                var document = host.Document;
                var grid = visibility.State.Grid;

                var registeredSet = new HashSet<IStationVisibilityTarget>();
                for (int i = 0; i < visibility.Targets.Count; i++) {
                    if (visibility.Targets[i] != null) registeredSet.Add(visibility.Targets[i]);
                }

                var frameById = new Dictionary<int, StationPassengerFrame>();
                var passengerFrames = liveSession.PassengerFrames();
                if (passengerFrames != null) {
                    for (int i = 0; i < passengerFrames.Length; i++) {
                        frameById[passengerFrames[i].SimId] = passengerFrames[i];
                    }
                }

                int simSeconds = Mathf.RoundToInt((float)liveSession.Clock.SimTime);
                int hh = (simSeconds / 3600) % 24;
                int mm = (simSeconds / 60) % 60;
                int ss = simSeconds % 60;
                result["clock"] = new JObject {
                    ["tick"] = liveSession.Tick,
                    ["simTimeSeconds"] = liveSession.Clock.SimTime,
                    ["formatted"] = string.Format(CultureInfo.InvariantCulture, "{0:D2}:{1:D2}:{2:D2}", hh, mm, ss),
                    ["playing"] = liveSession.Playing,
                };

                result["visibility"] = new JObject {
                    ["activeLevel"] = visibility.State.ActiveLevel,
                    ["showLevels"] = visibility.State.ShowLevels,
                    ["hideGround"] = visibility.State.HideGround,
                    ["hideUi"] = visibility.State.HideUi,
                    ["cutaway"] = visibility.State.Cutaway,
                    ["activeBuilt"] = visibility.ActiveBuilt,
                    ["registeredTargets"] = visibility.RegisteredTargets,
                    ["visibleTargets"] = visibility.VisibleTargets,
                    ["hiddenTargets"] = visibility.HiddenTargets,
                    ["ghostTargets"] = visibility.GhostTargets,
                };

                var crowd = PassengerCrowdRenderer.Current;
                var crowdView = crowd?.View;
                var bandSummary = new SortedDictionary<int, JObject>();
                var actorRows = new JArray();
                JObject upperComparison = null;
                JObject activeComparison = null;
                int enabledSkinsTotal = 0;
                int activeActorsTotal = 0;

                if (crowdView != null) {
                    foreach (var actor in crowdView.Actors) {
                        if (actor == null || actor.Root == null) continue;
                        bool inFrame = frameById.TryGetValue(actor.SimId, out var pFrame) && pFrame.Visible;
                        bool rootActive = actor.Root.activeInHierarchy;
                        bool skinEnabled = rootActive && actor.Skin != null && actor.Skin.enabled;
                        if (!inFrame && !rootActive && !skinEnabled) continue;

                        if (inFrame) activeActorsTotal++;
                        if (skinEnabled) enabledSkinsTotal++;

                        var docPos = StationCoordinates.WorldToDocument(actor.Position);
                        int resolvedBand = ResolvePassengerBandForProbe(docPos, hasFrame: frameById.ContainsKey(actor.SimId), pFrame, document, grid);
                        var target = actor.Root.GetComponent<StationVisibilityTarget>();
                        bool isRegistered = target != null && registeredSet.Contains(target);
                        string modeName = target != null ? target.LastMode.ToString() : "Unregistered";
                        float matAlpha = ReadMaterialAlpha(actor.Skin);
                        float blockAlpha = ReadPropertyBlockAlpha(actor.Skin);

                        if (!bandSummary.TryGetValue(resolvedBand, out var bucket)) {
                            bucket = new JObject {
                                ["band"] = resolvedBand,
                                ["inFrame"] = 0,
                                ["skinEnabled"] = 0,
                                ["registered"] = 0,
                                ["unregistered"] = 0,
                                ["modeBase"] = 0,
                                ["modeGhost"] = 0,
                                ["modeHidden"] = 0,
                            };
                            bandSummary[resolvedBand] = bucket;
                        }
                        if (inFrame) bucket["inFrame"] = (int)bucket["inFrame"] + 1;
                        if (skinEnabled) bucket["skinEnabled"] = (int)bucket["skinEnabled"] + 1;
                        if (isRegistered) bucket["registered"] = (int)bucket["registered"] + 1;
                        else bucket["unregistered"] = (int)bucket["unregistered"] + 1;
                        if (target != null) {
                            switch (target.LastMode) {
                                case StationDrawMode.Base: bucket["modeBase"] = (int)bucket["modeBase"] + 1; break;
                                case StationDrawMode.Ghost: bucket["modeGhost"] = (int)bucket["modeGhost"] + 1; break;
                                case StationDrawMode.Hidden: bucket["modeHidden"] = (int)bucket["modeHidden"] + 1; break;
                            }
                        }

                        var actorJson = new JObject {
                            ["simId"] = actor.SimId,
                            ["recipe"] = actor.Recipe,
                            ["footX"] = Math.Round(docPos.x, 3),
                            ["footY"] = Math.Round(docPos.y, 3),
                            ["footZ"] = Math.Round(docPos.z, 3),
                            ["resolvedBand"] = resolvedBand,
                            ["state"] = frameById.ContainsKey(actor.SimId) ? pFrame.State.ToString() : "None",
                            ["server"] = frameById.ContainsKey(actor.SimId) ? (pFrame.ServerId ?? "") : "",
                            ["hasTarget"] = target != null,
                            ["registered"] = isRegistered,
                            ["targetLevels"] = target != null ? new JArray(target.LevelZs) : new JArray(),
                            ["gradeOwned"] = target != null && target.gradeOwned,
                            ["drawMode"] = modeName,
                            ["rootActive"] = rootActive,
                            ["skinEnabled"] = skinEnabled,
                            ["materialAlpha"] = Math.Round(matAlpha, 3),
                            ["propertyBlockAlpha"] = Math.Round(blockAlpha, 3),
                        };
                        actorRows.Add(actorJson);

                        if (upperComparison == null && resolvedBand > level) {
                            var support = FindSupportGeometry(world, grid, docPos, resolvedBand);
                            if (support != null) {
                                upperComparison = new JObject {
                                    ["passenger"] = actorJson,
                                    ["supportGeometry"] = support,
                                };
                            }
                        }
                        if (activeComparison == null && resolvedBand == level) {
                            var support = FindSupportGeometry(world, grid, docPos, resolvedBand);
                            if (support != null) {
                                activeComparison = new JObject {
                                    ["passenger"] = actorJson,
                                    ["supportGeometry"] = support,
                                };
                            }
                        }
                    }
                }

                var bandsArray = new JArray();
                foreach (var kv in bandSummary) bandsArray.Add(kv.Value);

                var worldSummary = world.Summary();
                int passengerWorldRecords = 0;
                for (int i = 0; i < world.Records.Count; i++) {
                    var rec = world.Records[i];
                    if (rec != null && rec.ModuleId != null && rec.ModuleId.StartsWith("passenger:", StringComparison.Ordinal)) {
                        passengerWorldRecords++;
                    }
                }

                result["crowd"] = new JObject {
                    ["catalogueBound"] = PassengerCatalogueAnchor.Resolve() != null,
                    ["spawnedActors"] = crowd != null ? crowd.Spawned : 0,
                    ["reportedVisibleActors"] = crowd != null ? crowd.VisibleActors : 0,
                    ["inFrameActors"] = activeActorsTotal,
                    ["actualSkinEnabledCount"] = enabledSkinsTotal,
                    ["passengerRecordsInWorld"] = passengerWorldRecords,
                    ["worldModuleRecords"] = worldSummary.ModuleRecords,
                    ["byBand"] = bandsArray,
                    ["upperFloorSample"] = upperComparison,
                    ["activeFloorSample"] = activeComparison,
                    ["actors"] = actorRows,
                };

                var trainArray = new JArray();
                var trainRenderer = TrainConsistRenderer.Current;
                if (trainRenderer != null) {
                    foreach (var consist in trainRenderer.Consists) {
                        if (consist == null || consist.Root == null) continue;
                        var target = consist.Root.GetComponent<StationVisibilityTarget>();
                        var renderers = consist.Root.GetComponentsInChildren<Renderer>(true);
                        int enabledCount = 0;
                        for (int r = 0; r < renderers.Length; r++) {
                            if (renderers[r] != null && renderers[r].gameObject.activeInHierarchy && renderers[r].enabled) enabledCount++;
                        }
                        trainArray.Add(new JObject {
                            ["trainId"] = consist.TrainId,
                            ["phase"] = consist.Phase.ToString(),
                            ["bands"] = new JArray(consist.LevelBands),
                            ["rootActive"] = consist.Root.activeInHierarchy,
                            ["hasTarget"] = target != null,
                            ["parked"] = target != null && target.Parked,
                            ["drawMode"] = target != null ? target.LastMode.ToString() : "Unregistered",
                            ["enabledRenderers"] = enabledCount,
                            ["totalRenderers"] = renderers.Length,
                        });
                    }
                }
                result["trains"] = trainArray;

                var roadRenderer = StationRoadRenderer.Current;
                var roadVehicles = roadRenderer?.Vehicles;
                int vehicleEnabledRenderers = 0;
                int vehicleGhostSlots = 0;
                int vehicleBaseSlots = 0;
                int vehicleHiddenSlots = 0;
                if (roadVehicles != null) {
                    foreach (var tr in roadVehicles.GetComponentsInChildren<RoadVehicleKey>(true)) {
                        if (tr == null) continue;
                        var vTarget = tr.GetComponent<StationVisibilityTarget>();
                        if (vTarget != null && tr.gameObject.activeInHierarchy) {
                            if (vTarget.LastMode == StationDrawMode.Ghost) vehicleGhostSlots++;
                            else if (vTarget.LastMode == StationDrawMode.Base) vehicleBaseSlots++;
                            else if (vTarget.LastMode == StationDrawMode.Hidden) vehicleHiddenSlots++;
                        }
                        if (!tr.gameObject.activeInHierarchy) continue;
                        foreach (var mr in tr.GetComponentsInChildren<Renderer>(true)) {
                            if (mr != null && mr.gameObject.activeInHierarchy && mr.enabled) vehicleEnabledRenderers++;
                        }
                    }
                }
                result["roadVehicles"] = new JObject {
                    ["sampled"] = roadVehicles != null ? roadVehicles.SampledVehicles : 0,
                    ["reportedVisible"] = roadVehicles != null ? roadVehicles.VisibleVehicles : 0,
                    ["reportedFiltered"] = roadVehicles != null ? roadVehicles.FilteredVehicles : 0,
                    ["enabledRenderers"] = vehicleEnabledRenderers,
                    ["slotModeBase"] = vehicleBaseSlots,
                    ["slotModeGhost"] = vehicleGhostSlots,
                    ["slotModeHidden"] = vehicleHiddenSlots,
                };

                result["status"] = "passed";
                WriteResult(cmd, result, outputPath);
                return ExitCode.Success;
            } catch (Exception error) {
                result["status"] = "failed";
                result["error"] = error.GetType().Name + ": " + error.Message;
                result["stack"] = error.StackTrace;
                WriteResult(cmd, result, outputPath);
                cmd.Log.Error(error.ToString());
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand(Group,
            "Restore baseline camera, time scale and play state after metro station_storey_probe.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationStoreyProbeFinish(CommandContext cmd) {
            var baseline = pending;
            pending = null;
            StationEditorReactOverlay.SmokeSuppressed = false;
            if (baseline == null) {
                cmd.Result.Write(new JObject { ["restored"] = true, ["note"] = "no baseline pending" });
                return ExitCode.Success;
            }
            Time.fixedDeltaTime = baseline.FixedDeltaTime;
            if (baseline.Camera != null) {
                baseline.Camera.transform.position = baseline.Position;
                baseline.Camera.transform.rotation = baseline.Rotation;
                baseline.Camera.orthographic = baseline.Orthographic;
                baseline.Camera.orthographicSize = baseline.OrthographicSize;
                baseline.Camera.fieldOfView = baseline.FieldOfView;
                baseline.Camera.nearClipPlane = baseline.NearClipPlane;
                baseline.Camera.farClipPlane = baseline.FarClipPlane;
                baseline.Camera.enabled = baseline.Enabled;
            }
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            var simHost = host?.Simulation as StationSimulationHost;
            simHost?.Session?.SetPlaying(baseline.WasPlaying);
            Time.timeScale = baseline.TimeScale;
            cmd.Result.Write(new JObject { ["restored"] = true });
            return ExitCode.Success;
        }

        static int ResolvePassengerBandForProbe(Vector3 docPos, bool hasFrame, StationPassengerFrame frame,
            StationDocument document, StationLevelGrid grid) {
            if (hasFrame && !string.IsNullOrEmpty(frame.ServerId)) {
                if (frame.ServerId.StartsWith("lift:", StringComparison.Ordinal)) {
                    return StationModuleLevels.Band(grid, Math.Floor(docPos.z + 1e-3));
                }
                if (frame.ServerId.StartsWith("line:", StringComparison.Ordinal) && document != null) {
                    int pipe = frame.ServerId.IndexOf('|');
                    if (pipe >= 0 && pipe + 1 < frame.ServerId.Length) {
                        string trackId = frame.ServerId.Substring(pipe + 1);
                        for (int i = 0; i < document.Modules.Count; i++) {
                            var mod = document.Modules[i];
                            if (mod != null && string.Equals(mod.Id, trackId, StringComparison.Ordinal)) {
                                var bands = StationModuleLevels.Of(mod, grid);
                                if (bands.Length > 0) return bands[0];
                            }
                        }
                    }
                }
            }
            int supportCellZ = Mathf.FloorToInt(docPos.z - 1f + 1e-3f);
            return StationModuleLevels.Band(grid, supportCellZ);
        }

        static JObject FindSupportGeometry(StationWorldView world, StationLevelGrid grid, Vector3 docPos, int band) {
            StationViewRecord fallbackInBand = null;
            int fx = Mathf.FloorToInt(docPos.x);
            int fy = Mathf.FloorToInt(docPos.y);
            int supportZ = Mathf.FloorToInt(docPos.z - 1f + 1e-3f);
            string exactCellKey = fx + "," + fy + "," + supportZ;

            for (int i = 0; i < world.Records.Count; i++) {
                var rec = world.Records[i];
                if (rec?.View == null) continue;
                if (string.Equals(rec.Role, "actors", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(rec.Role, "trains", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(rec.Role, "grid", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(rec.Role, "cursor", StringComparison.OrdinalIgnoreCase)) {
                    continue;
                }
                var target = rec.View.GetComponent<StationVisibilityTarget>();
                if (target == null || target.Role == StationPartRole.Ceiling || target.Role == StationPartRole.Roof) continue;

                bool onBand = false;
                for (int b = 0; b < target.LevelZs.Count; b++) {
                    if (target.LevelZs[b] == band) { onBand = true; break; }
                }
                if (!onBand) continue;

                if (string.Equals(rec.CellKey, exactCellKey, StringComparison.Ordinal)) {
                    return DescribeSupportRecord(rec, target);
                }
                if (fallbackInBand == null && (target.Role == StationPartRole.Slab || target.Role == StationPartRole.Ground || target.Role == StationPartRole.Surface)) {
                    fallbackInBand = rec;
                }
            }
            if (fallbackInBand != null) {
                return DescribeSupportRecord(fallbackInBand, fallbackInBand.View.GetComponent<StationVisibilityTarget>());
            }
            return null;
        }

        static JObject DescribeSupportRecord(StationViewRecord rec, StationVisibilityTarget target) {
            var renderers = target.Renderers;
            int enabledCount = 0;
            for (int i = 0; i < renderers.Count; i++) {
                if (renderers[i] != null && renderers[i].gameObject.activeInHierarchy && renderers[i].enabled) enabledCount++;
            }
            return new JObject {
                ["recordRole"] = rec.Role,
                ["cellKey"] = rec.CellKey ?? "",
                ["moduleId"] = rec.ModuleId ?? "",
                ["partRole"] = target.Role.ToString(),
                ["levels"] = new JArray(target.LevelZs),
                ["gradeOwned"] = target.gradeOwned,
                ["drawMode"] = target.LastMode.ToString(),
                ["enabledRenderers"] = enabledCount,
                ["totalRenderers"] = renderers.Count,
            };
        }

        static float ReadMaterialAlpha(Renderer renderer) {
            if (renderer == null || renderer.sharedMaterial == null) return -1f;
            var mat = renderer.sharedMaterial;
            if (mat.HasProperty("baseColorFactor")) return mat.GetColor("baseColorFactor").a;
            if (mat.HasProperty("_BaseColor")) return mat.GetColor("_BaseColor").a;
            if (mat.HasProperty("_Color")) return mat.GetColor("_Color").a;
            return 1f;
        }

        static float ReadPropertyBlockAlpha(Renderer renderer) {
            if (renderer == null || !renderer.HasPropertyBlock()) return -1f;
            var block = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(block, 0);
            int gltfId = Shader.PropertyToID("baseColorFactor");
            if (block.HasColor(gltfId)) return block.GetColor(gltfId).a;
            int baseId = Shader.PropertyToID("_BaseColor");
            if (block.HasColor(baseId)) return block.GetColor(baseId).a;
            return -1f;
        }

        static void SendViewBool(StationGameHost host, string key, bool value) {
            SendCommandChecked(host, "view.set", new JObject { ["key"] = key, ["value"] = value }, expectCommit: false);
        }

        static void SendViewInt(StationGameHost host, string key, int value) {
            SendCommandChecked(host, "view.set", new JObject { ["key"] = key, ["value"] = value }, expectCommit: false);
        }

        static void SendCommandChecked(StationGameHost host, string type, JObject payload, bool expectCommit) {
            var envelope = new JObject {
                ["schemaVersion"] = StationCommandRouter.SchemaVersion,
                ["id"] = "probe-" + Guid.NewGuid().ToString("N"),
                ["sessionId"] = "editor-storey-probe",
                ["type"] = type,
                ["payload"] = payload,
            };
            string reply = host.SendForTest(envelope.ToString(Formatting.None));
            if (string.IsNullOrEmpty(reply)) {
                throw new InvalidOperationException(type + " produced no reply.");
            }
            var parsed = JObject.Parse(reply);
            string expectedKind = expectCommit ? "commit" : "ack";
            if ((string)parsed["kind"] != expectedKind || !(bool)parsed["accepted"]) {
                throw new InvalidOperationException(type + " rejected: " + reply);
            }
        }

        static Baseline CaptureBaseline(StationGameHost host) {
            var camera = host.stationCamera != null ? host.stationCamera : Camera.main;
            var baseline = new Baseline {
                Camera = camera,
                TimeScale = Time.timeScale,
                FixedDeltaTime = Time.fixedDeltaTime,
                WasPlaying = host.Simulation != null && host.Simulation.Playing,
            };
            if (camera != null) {
                var transform = camera.transform;
                baseline.Position = transform.position;
                baseline.Rotation = transform.rotation;
                baseline.Orthographic = camera.orthographic;
                baseline.OrthographicSize = camera.orthographicSize;
                baseline.FieldOfView = camera.fieldOfView;
                baseline.NearClipPlane = camera.nearClipPlane;
                baseline.FarClipPlane = camera.farClipPlane;
                baseline.Enabled = camera.enabled;
            }
            return baseline;
        }

        static void WriteResult(CommandContext cmd, JObject result, string outputPath) {
            if (!string.IsNullOrEmpty(outputPath)) {
                var full = Path.GetFullPath(outputPath);
                var parent = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                File.WriteAllText(full, result.ToString(Formatting.Indented));
            }
            cmd.Result.Write(result);
        }
    }
}
