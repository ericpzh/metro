using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Metro.App;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Plan 11 B4's regeneration entry points. The report is produced from the
    /// **live** committed station the editor is playing (the same world the smoke
    /// loaded through <c>station.openDemo</c>), so every row is evidence of the load
    /// that just happened, not of a second, synthetic build.
    ///
    /// <c>metro station_binding_report</c> writes the CSV plus its summary.
    /// <c>metro station_family_view</c> frames one named family for a Game-view
    /// capture (and can hold the platform screen doors open or shut).
    /// </summary>
    public static class StationBindingReportCommand {
        const string Group = "metro";

        /// <summary>`unity/plan/11-evidence/B4`: outside `Assets`, so nothing imports it.</summary>
        public static string EvidenceFolder =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "plan", "11-evidence", "B4"));

        static StationGameHost Host() => UnityEngine.Object.FindAnyObjectByType<StationGameHost>();

        [CliGroupCommand(Group,
            "Write the plan-11 B4 per-module binding report for the station the editor has loaded (CSV + JSON + text summary). Run after metro station_smoke so the committed world is the actual demo load.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationBindingReport(
            CommandContext cmd,
            [CliArg("demo", "The demo id the committed station must be (zoo, tanwei or tianhe).")] string demo = "zoo",
            [CliArg("output-path", "CSV path; defaults to unity/plan/11-evidence/B4/<demo>-binding.csv.")] string outputPath = null,
            [CliArg("ticks", "Fixed simulation ticks replayed over the committed document to produce the frames.")] int ticks = 40) {
            var host = Host();
            if (host == null) {
                cmd.Log.Error("No StationGameHost in the open scene. Open Assets/StationDesigner/Scenes/StationGame.unity and enter Play Mode.");
                return ExitCode.Failed;
            }
            if (!host.IsLoaded || host.Coordinator == null || host.Coordinator.World == null) {
                cmd.Log.Error("No committed station. Run 'metro station_smoke --demo " + demo + "' first (or open the demo from the player).");
                return ExitCode.Failed;
            }
            if (!string.Equals(host.CurrentSourceId, demo, StringComparison.Ordinal)) {
                cmd.Log.Error("The committed station is '" + host.CurrentSourceId + "', not '" + demo + "'. Open the expected demo first.");
                return ExitCode.Failed;
            }
            var world = host.Coordinator.World;
            if (!world.IsBuilt) {
                cmd.Log.Error("The committed world has not finished building.");
                return ExitCode.Failed;
            }
            var folder = EvidenceFolder;
            var csvPath = string.IsNullOrEmpty(outputPath) ? Path.Combine(folder, demo + "-binding.csv") : Path.GetFullPath(outputPath);
            var jsonPath = Path.ChangeExtension(csvPath, ".summary.json");
            var textPath = Path.ChangeExtension(csvPath, ".summary.txt");
            Metro.App.StationBindingReport report = null;
            try {
                report = global::Metro.App.StationBindingReport.Build(demo, world, host.Coordinator.Renderers, host.catalogue, host.trainCatalogue, ticks);
                var directory = Path.GetDirectoryName(csvPath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(csvPath, report.ToCsv());
                var json = report.ToJson();
                json["csv"] = csvPath;
                json["summaryText"] = textPath;
                File.WriteAllText(jsonPath, json.ToString(Newtonsoft.Json.Formatting.Indented));
                File.WriteAllText(textPath, report.SummaryText() + Environment.NewLine);
                cmd.Result.Write(json);
                cmd.Log.Info("B4 binding report: " + report.Rows.Count + " rows, " + report.Status.Bound + " bound, " +
                    report.Status.Fallback + " fallback, " + report.Status.NoView + " no-view. " + report.Verdict);
                cmd.Log.Info("CSV: " + csvPath);
                return ExitCode.Success;
            } catch (Exception error) {
                cmd.Log.Error("Binding report failed: " + error.GetType().Name + ": " + error.Message + Environment.NewLine + error.StackTrace);
                return ExitCode.Failed;
            } finally {
                report?.Dispose();
            }
        }

        [CliGroupCommand(Group,
            "Frame one named module family on the loaded station for a Game-view capture, optionally holding the platform screen doors open or shut.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationFamilyView(
            CommandContext cmd,
            [CliArg("family", "stairs, escalators, lifts, fences, trees, psd, gates or doors.")] string family = "escalators",
            [CliArg("psd", "hold, open or closed: the platform screen door state the capture should show.")] string psd = "hold",
            [CliArg("zoom", "Extra zoom factor after the family framing (2 closes in twice).")] double zoom = 2.2,
            [CliArg("module", "Frame one module id instead of the whole family (a real close-up).")] string moduleId = null,
            [CliArg("count", "Frame only the first N drawn modules of the family (0 = all).")] int count = 0,
            [CliArg("output-path", "Optional JSON result path.")] string outputPath = null) {
            var host = Host();
            if (host == null || !host.IsLoaded || host.Coordinator == null || host.Coordinator.World == null) {
                cmd.Log.Error("No committed station to frame. Run metro station_smoke first.");
                return ExitCode.Failed;
            }
            var world = host.Coordinator.World;
            var document = world.Document;
            var rig = host.GetComponent<StationViewRig>() ?? StationViewFeature.Attach(host);
            if (rig == null || !rig.Configured) {
                cmd.Log.Error("The station view rig is not configured in this scene.");
                return ExitCode.Failed;
            }
            var types = TypesOf(family);
            if (types == null) {
                cmd.Log.Error("Unknown family '" + family + "'. Known: stairs, escalators, lifts, fences, trees, psd, gates, doors.");
                return ExitCode.Failed;
            }
            var ids = new List<string>();
            int level = int.MaxValue;
            var drawn = new List<GameObject>();
            bool anyBounds = false;
            Bounds worldBounds = default;
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (Array.IndexOf(types, module.Type) < 0) continue;
                if (!string.IsNullOrEmpty(moduleId) && !string.Equals(module.Id, moduleId, StringComparison.Ordinal)) continue;
                ids.Add(module.Id);
                if (!world.TryGetModule(module.Id, out var record) || record.View == null) continue;
                level = Mathf.Min(level, module.Z);
                drawn.Add(record.View);
                var renderers = record.View.GetComponentsInChildren<Renderer>(true);
                for (int r = 0; r < renderers.Length; r++) {
                    var renderer = renderers[r];
                    if (renderer == null || !renderer.enabled) continue;
                    if (!anyBounds) { worldBounds = renderer.bounds; anyBounds = true; } else worldBounds.Encapsulate(renderer.bounds);
                }
                if (!string.IsNullOrEmpty(moduleId)) continue;
                if (count > 0 && drawn.Count >= count) break;
            }
            if (ids.Count == 0 || !anyBounds) {
                cmd.Log.Error("Family '" + family + "' has no drawn modules in this station.");
                return ExitCode.Failed;
            }
            int doors = 0;
            if (!string.Equals(psd, "hold", StringComparison.OrdinalIgnoreCase)) {
                var openings = StationOpeningRenderers.Current;
                if (openings == null) {
                    cmd.Log.Error("No opening renderer is installed on this station.");
                    return ExitCode.Failed;
                }
                float fraction = string.Equals(psd, "open", StringComparison.OrdinalIgnoreCase) ? 1f : 0f;
                foreach (var view in openings.Views.Views) {
                    if (view == null || string.IsNullOrEmpty(view.ModuleId)) continue;
                    if (view.Kind != OpeningKind.PsdRun) continue;
                    if (!openings.Views.Apply(view.ModuleId, OpeningState.Uniform(fraction))) continue;
                    doors++;
                }
            }
            // The capture frames the family's own world bounds, converted once through the
            // shared coordinate contract (never a hand-built box).
            Vector3 min = worldBounds.min, max = worldBounds.max;
            Vector3 documentMin = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            Vector3 documentMax = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var worldPoint = new Vector3((corner & 1) == 0 ? min.x : max.x, (corner & 2) == 0 ? min.y : max.y, (corner & 4) == 0 ? min.z : max.z);
                var documentPoint = StationCoordinates.WorldToDocument(worldPoint);
                documentMin = Vector3.Min(documentMin, documentPoint);
                documentMax = Vector3.Max(documentMax, documentPoint);
            }
            var bounds = new Bounds((documentMin + documentMax) * .5f, documentMax - documentMin);
            level = level == int.MaxValue ? 0 : level;
            rig.CameraController.SetStation(bounds, level);
            rig.CameraController.SetPreset(StationCameraPreset.Iso);
            rig.CameraController.ZoomBy((float)Math.Max(.05, zoom) * (2f / 3f));
            rig.Commands.ApplyCamera();
            var camera = host.stationCamera != null ? host.stationCamera : Camera.main;
            var result = new JObject {
                ["schemaVersion"] = 1,
                ["command"] = "metro station_family_view",
                ["family"] = family,
                ["types"] = new JArray(types),
                ["modules"] = ids.Count,
                ["module"] = moduleId,
                ["count"] = count,
                ["drawn"] = anyBounds,
                ["level"] = level,
                ["documentBounds"] = new JObject {
                    ["min"] = Vector(bounds.min), ["max"] = Vector(bounds.max),
                },
                ["psd"] = psd,
                ["psdDoorsApplied"] = doors,
                ["camera"] = camera != null
                    ? new JObject {
                        ["position"] = Vector(camera.transform.position),
                        ["rotation"] = RotationJson(camera.transform.rotation),
                        ["orthographic"] = camera.orthographic,
                        ["orthographicSize"] = camera.orthographicSize,
                    }
                    : null,
                ["sampleIds"] = new JArray(ids.Count > 5 ? new[] { ids[0], ids[1], ids[2], ids[3], ids[4] } : ids.ToArray()),
            };
            if (!string.IsNullOrEmpty(outputPath)) {
                var full = Path.GetFullPath(outputPath);
                var directory = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(full, result.ToString(Newtonsoft.Json.Formatting.Indented));
            }
            cmd.Result.Write(result);
            return ExitCode.Success;
        }

        static string[] TypesOf(string family) {
            switch ((family ?? "").Trim().ToLowerInvariant()) {
                case "stairs": return new[] { "stair" };
                case "escalators": return new[] { "escalator", "walkway" };
                case "lifts": return new[] { "lift" };
                case "fences": return new[] { "fence" };
                case "trees": return new[] { "tree" };
                case "psd": return new[] { "platform-edge", "psd-end" };
                case "gates": return new[] { "gate" };
                case "doors": return new[] { "door", "cubicle" };
                default: return null;
            }
        }

        static JObject Vector(Vector3 value) => new JObject {
            ["x"] = value.x, ["y"] = value.y, ["z"] = value.z,
        };

        static JObject RotationJson(UnityEngine.Quaternion value) => new JObject {
            ["x"] = value.x, ["y"] = value.y, ["z"] = value.z, ["w"] = value.w,
        };

        /// <summary>A menu entry so the report can be regenerated without the CLI.</summary>
        [MenuItem("Tools/Metro/Write B4 Binding Report (loaded station)")]
        public static void WriteReportFromMenu() {
            var host = Host();
            if (host == null || !host.IsLoaded) {
                EditorUtility.DisplayDialog("Metro B4",
                    "Load a station first (Play Mode, then open a demo).", "OK");
                return;
            }
            var demo = string.IsNullOrEmpty(host.CurrentSourceId) ? "station" : host.CurrentSourceId;
            Metro.App.StationBindingReport report = null;
            try {
                report = global::Metro.App.StationBindingReport.Build(demo, host.Coordinator.World, host.Coordinator.Renderers,
                    host.catalogue, host.trainCatalogue, 40);
                Directory.CreateDirectory(EvidenceFolder);
                var csv = Path.Combine(EvidenceFolder, demo + "-binding.csv");
                File.WriteAllText(csv, report.ToCsv());
                File.WriteAllText(Path.ChangeExtension(csv, ".summary.json"), report.ToJson().ToString(Newtonsoft.Json.Formatting.Indented));
                File.WriteAllText(Path.ChangeExtension(csv, ".summary.txt"), report.SummaryText() + Environment.NewLine);
                Debug.Log("B4 binding report written to " + csv + ": " + report.SummaryText());
            } finally {
                report?.Dispose();
            }
        }
    }
}
