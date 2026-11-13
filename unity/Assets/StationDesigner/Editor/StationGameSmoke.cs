using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Metro.App;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;

namespace Metro.Editor {
    /// <summary>
    /// Live, repeatable verification for the generic StationGame scene.
    ///
    /// The check uses the same path the browser does: one <c>station.openDemo</c>
    /// command through <see cref="StationGameHost.BrowserCommand"/>, the host's
    /// command router, the normal load transaction, and the real simulation session.
    /// It then freezes the frame at a fixed tick so a following
    /// <c>capture game_view</c> sees a deterministic state. <c>station_smoke_finish</c>
    /// restores the camera, time scale and play state captured before the run.
    ///
    /// Registered as <c>metro station_smoke</c> and <c>metro station_smoke_finish</c>
    /// for the Pipeline CLI (see <c>unity/scripts/metro-editor.ps1</c>).
    /// </summary>
    public static class StationGameSmoke {
        const string Group = "metro";
        const string SceneName = "StationGame";

        sealed class SmokeFailure : Exception {
            public SmokeFailure(string stage, string message) : base(message) { Stage = stage; }
            public string Stage { get; }
        }

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
            "Load a StationGame demo through StationGameHost, verify live frames, step a fixed simulation tick count, and leave a deterministic paused frame for capture. Run station_smoke_finish afterwards.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static async Task<ExitCode> StationSmoke(
            CommandContext cmd,
            [CliArg("demo", "Demo id serialized in StationGame.unity: zoo, tanwei or tianhe.")] string demo = "zoo",
            [CliArg("ticks", "Fixed simulation ticks to step after the live-frame check.")] int ticks = 30,
            [CliArg("scene", "Scene the run must be in: StationGame (public profile) or StationGameLocal (local passenger profile).")] string sceneName = SceneName,
            [CliArg("output-path", "Optional path for the JSON result, e.g. .preview/unity/editor/<run>/smoke-run1.json.")] string outputPath = null,
            [CliArg("timeout", "Seconds allowed for the check.")] double timeoutInSeconds = 120) {
            var result = new JObject {
                ["schemaVersion"] = 1,
                ["command"] = "metro station_smoke",
                ["status"] = "running",
                ["demo"] = demo,
                ["requestedTicks"] = ticks,
                ["startedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            };
            var checks = new JArray();
            var stages = new JObject();
            result["checks"] = checks;
            result["stages"] = stages;
            var total = Stopwatch.StartNew();

            try {
                if (!EditorApplication.isPlaying) throw new SmokeFailure("scene", "Unity Editor is not in Play Mode.");
                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (host == null) throw new SmokeFailure("scene", "No StationGameHost is loaded in the active scene.");

                var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
                if (!string.Equals(scene.name, sceneName, StringComparison.Ordinal))
                    throw new SmokeFailure("scene", "Active scene is '" + scene.name + "', expected '" + sceneName + "'.");
                result["scene"] = sceneName;

                var fixture = FindDemo(host, demo);
                if (fixture == null)
                    throw new SmokeFailure("fixture", "Demo '" + demo + "' is not serialized in StationGame.unity. Loaded demos: " + Join(host.DemoIds));

                var fixtureText = fixture.text ?? "";
                var fixtureHash = Hash(fixtureText);
                var fixturePath = AssetDatabase.GetAssetPath(fixture);
                result["fixture"] = new JObject {
                    ["id"] = demo,
                    ["path"] = fixturePath,
                    ["sourceHash"] = fixtureHash,
                    ["textBytes"] = Encoding.UTF8.GetByteCount(fixtureText),
                    ["assetBytes"] = fixture.bytes != null ? fixture.bytes.Length : 0,
                };
                stages["fixture"] = Ms(total);

                var baseline = CaptureBaseline(host);
                pending = baseline;
                StationEditorReactOverlay.SmokeSuppressed = true;
                result["baseline"] = new JObject {
                    ["timeScale"] = baseline.TimeScale,
                    ["simulationPlaying"] = baseline.WasPlaying,
                    ["camera"] = baseline.Camera != null ? CameraJson(baseline.Camera) : null,
                };

                // Prove the Play Mode frame loop is alive before opening anything.
                // Four frames are not a simulated tick, but they are enough to show
                // that an unfocused Editor is still rendering the frozen frame the
                // capture command will read.
                var liveStarted = Stopwatch.StartNew();
                int frameBefore = Time.frameCount;
                Time.timeScale = 1f;
                for (int i = 0; i < 4; i++) await Task.Yield();
                int liveFrameDelta = Time.frameCount - frameBefore;
                Time.timeScale = 0f;
                stages["liveFrames"] = Ms(liveStarted);
                result["live"] = new JObject {
                    ["frameCountBefore"] = frameBefore,
                    ["frameCountAfter"] = Time.frameCount,
                    ["frameDelta"] = liveFrameDelta,
                };
                Require(checks, "frames-advance", liveFrameDelta >= 1, "Play Mode frame count advanced by " + liveFrameDelta + ".");

                // Nothing may tick between the open and the fixed-step run.
                var openStarted = Stopwatch.StartNew();
                result["commit"] = OpenDemoChecked(host, demo, fixtureHash);
                stages["openDemo"] = Ms(openStarted);

                var document = host.Document;
                if (document == null || document.ModuleCount == 0 || document.CellCount == 0)
                    throw new SmokeFailure("fixture", "Committed document is empty.");
                if (document.DroppedCells != 0 || document.DroppedModules != 0)
                    throw new SmokeFailure("fixture", "Committed document dropped cells/modules: " + document.DroppedCells + "/" + document.DroppedModules + ".");
                result["document"] = new JObject {
                    ["name"] = document.Name,
                    ["city"] = document.City,
                    ["cells"] = document.CellCount,
                    ["modules"] = document.ModuleCount,
                    ["lines"] = document.LineCount,
                    ["levelBase"] = document.LevelBase,
                    ["storeyHeight"] = document.StoreyHeight,
                    ["seed"] = document.Seed,
                    ["normalizedBytes"] = Encoding.UTF8.GetByteCount(document.NormalizedJson ?? ""),
                };

                var simulationHost = host.Simulation as StationSimulationHost;
                var session = simulationHost != null ? simulationHost.Session : null;
                if (session == null) throw new SmokeFailure("simulation", "StationGameHost has no committed simulation session.");

                var rig = host.GetComponent<StationViewRig>();
                if (rig == null) rig = StationViewFeature.Attach(host);
                if (rig != null && rig.Configured) {
                    // The station-open home view, independent of wherever a previous
                    // interactive session left the camera.
                    rig.CameraController.Home();
                    rig.CameraController.ZoomBy(2f / 3f);
                    rig.Commands.ApplyCamera();
                }

                // Reset clock, RNG and service actors, then step exactly the requested
                // number of fixed ticks. Advance(1) is one whole simulated second at 1x.
                var fixedStarted = Stopwatch.StartNew();
                session.SeekToSimTime(StationClock.ReferenceBootSeconds);
                session.Restart();
                session.SetPlaying(true);
                long expectedTick = session.Tick;
                int advanced = 0;
                for (int i = 0; i < ticks; i++) {
                    int stepped = session.Advance(1.0);
                    if (stepped != 1)
                        throw new SmokeFailure("simulation", "Advance(1.0) stepped " + stepped + " ticks at index " + i + ".");
                    advanced += stepped;
                }
                session.SetPlaying(false);
                var fixedMs = Ms(fixedStarted);
                stages["fixedTicks"] = fixedMs;
                var expectedSimTime = StationClock.ReferenceBootSeconds + ticks;
                result["simulation"] = new JObject {
                    ["tick"] = session.Tick,
                    ["expectedTick"] = expectedTick + ticks,
                    ["advancedTicks"] = advanced,
                    ["simTimeSeconds"] = session.Clock.SimTime,
                    ["expectedSimTimeSeconds"] = expectedSimTime,
                    ["playing"] = session.Playing,
                    ["speed"] = session.Speed,
                    ["elapsedMs"] = fixedMs,
                };
                Require(checks, "fixed-tick-count", session.Tick == expectedTick + ticks,
                    "Simulation tick is " + session.Tick + ", expected " + (expectedTick + ticks) + ".");
                Require(checks, "fixed-sim-time", Math.Abs(session.Clock.SimTime - expectedSimTime) < 1e-6,
                    "Simulation time is " + session.Clock.SimTime + ", expected " + expectedSimTime + ".");

                var snapshotText = session.SnapshotJson();
                var snapshot = JObject.Parse(snapshotText);
                int trains = (snapshot["services"] != null && snapshot["services"]["trains"] is JArray trainRows)
                    ? trainRows.Count : 0;
                result["snapshot"] = new JObject {
                    ["bytes"] = snapshotText.Length,
                    ["trains"] = trains,
                    ["sessionRevision"] = snapshot["sessionRevision"],
                };
                if (string.Equals(demo, "zoo", StringComparison.Ordinal)) {
                    Require(checks, "zoo-service-dispatched", trains > 0,
                        "Zoo dispatched " + trains + " train(s) after " + ticks + " fixed ticks.");
                }

                // Local passenger profile: only a scene that binds the internal catalogue
                // (StationGameLocal) can show the soft-human crowd. When it does, the
                // crowd is part of the contract and an empty station is a failure; the
                // public scene reports the truthful zero with no catalogue bound.
                //
                // The fixed-tick loop above is synchronous: no frame runs between it and
                // this read, and the renderer poses in StationGameHost.Update -> frame
                // sinks. Yield a few frames first, exactly like the capture wait below,
                // or a complete crowd still reads as zero visible actors.
                for (int i = 0; i < 8; i++) await Task.Yield();
                var crowd = Metro.App.Views.PassengerCrowdRenderer.Current;
                bool catalogueBound = PassengerCatalogueAnchor.Resolve() != null;
                int visibleActors = crowd != null ? crowd.VisibleActors : 0;
                int spawnedActors = crowd != null ? crowd.Spawned : 0;
                result["crowd"] = new JObject {
                    ["catalogueBound"] = catalogueBound,
                    ["visible"] = visibleActors,
                    ["spawned"] = spawnedActors,
                };
                if (catalogueBound) {
                    Require(checks, "local-crowd-visible", visibleActors > 0,
                        "The local passenger profile bound a catalogue but the crowd published " + visibleActors + " visible actor(s).");
                }

                // Session-scoped evidence view: the same cutaway the web view-tools
                // check uses. It must not move the document revision.
                var view = ApplyEvidenceView(host);
                result["view"] = view.DeepClone();

                var state = host.BuildStatePayload();
                var fingerprint = Hash(state.ToString(Formatting.None) + "\n" + snapshotText);
                result["state"] = new JObject {
                    ["hash"] = fingerprint,
                    ["bytes"] = state.ToString(Formatting.None).Length,
                    ["camera"] = state["camera"] != null ? state["camera"].DeepClone() : null,
                    ["clock"] = state["clock"] != null ? state["clock"].DeepClone() : null,
                    ["view"] = state["view"] != null ? state["view"].DeepClone() : null,
                };

                // A fresh frame at the frozen state must render before the capture
                // command reads the Game view.
                var captureFrameStarted = Stopwatch.StartNew();
                int captureFrameBefore = Time.frameCount;
                for (int i = 0; i < 8; i++) await Task.Yield();
                int captureFrameDelta = Time.frameCount - captureFrameBefore;
                stages["captureFrames"] = Ms(captureFrameStarted);
                result["capture"] = new JObject {
                    ["frameCountBefore"] = captureFrameBefore,
                    ["frameCountAfter"] = Time.frameCount,
                    ["frameDelta"] = captureFrameDelta,
                    ["timeScale"] = Time.timeScale,
                    ["pausedSession"] = !session.Playing,
                    ["ready"] = captureFrameDelta >= 1,
                };
                Require(checks, "capture-frame-advance", captureFrameDelta >= 1,
                    "Frame count advanced by " + captureFrameDelta + " before capture.");
                if (!AllChecksPass(checks)) throw new SmokeFailure("simulation", "One or more simulation checks failed.");

                result["status"] = "passed";
                result["finishedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                result["elapsedMs"] = Ms(total);
                WriteResult(cmd, result, outputPath);
                return ExitCode.Success;
            } catch (SmokeFailure failure) {
                StationEditorReactOverlay.SmokeSuppressed = false;
                result["status"] = "failed";
                result["stage"] = failure.Stage;
                result["error"] = failure.Message;
                result["finishedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                result["elapsedMs"] = Ms(total);
                WriteResult(cmd, result, outputPath);
                cmd.Log.Error("stage=" + failure.Stage + ": " + failure.Message);
                return ExitCode.Failed;
            } catch (Exception error) {
                StationEditorReactOverlay.SmokeSuppressed = false;
                result["status"] = "failed";
                result["stage"] = "editor";
                result["error"] = error.GetType().Name + ": " + error.Message;
                result["stack"] = error.StackTrace;
                result["finishedAt"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
                result["elapsedMs"] = Ms(total);
                WriteResult(cmd, result, outputPath);
                cmd.Log.Error("stage=editor: " + error);
                return ExitCode.Failed;
            }
        }

        [CliGroupCommand(Group,
            "Restore the camera, time scale and play state captured by metro station_smoke. Call this after capturing the Game view.",
            Effect = CommandEffect.Destructive, Tags = new[] { "tests" })]
        internal static ExitCode StationSmokeFinish(CommandContext cmd) {
            if (pending == null) {
                cmd.Log.Error("No pending station smoke baseline. Run metro station_smoke first in the same Play Mode session.");
                return ExitCode.Failed;
            }
            var baseline = pending;
            pending = null;
            var restored = new JObject {
                ["camera"] = baseline.Camera != null,
                ["timeScale"] = baseline.TimeScale,
                ["simulationPlaying"] = baseline.WasPlaying,
            };
            try {
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
                var simulationHost = host != null ? host.Simulation as StationSimulationHost : null;
                if (simulationHost != null && simulationHost.Session != null)
                    simulationHost.Session.SetPlaying(baseline.WasPlaying);
                Time.timeScale = baseline.TimeScale;
                StationEditorReactOverlay.SmokeSuppressed = false;
                restored["timeScale"] = Time.timeScale;
                restored["simulationPlaying"] = simulationHost != null && simulationHost.Session != null && simulationHost.Session.Playing;
                restored["restored"] = true;
                cmd.Result.Write(restored);
                return ExitCode.Success;
            } catch (Exception error) {
                cmd.Log.Error("Could not restore the station smoke baseline: " + error);
                return ExitCode.Failed;
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

        static JObject ApplyEvidenceView(StationGameHost host) {
            int revisionBefore = host.CurrentRevision;
            SendViewChecked(host, "ceiling", true);
            SendViewChecked(host, "walls", false);
            SendViewChecked(host, "ground", true);
            SendViewChecked(host, "roof", true);
            if (host.CurrentRevision != revisionBefore)
                throw new SmokeFailure("view", "view.set changed the document revision.");
            var state = host.BuildStatePayload();
            var view = state["view"] as JObject;
            if (view == null) throw new SmokeFailure("view", "Host did not publish a view state.");
            if ((bool?)view["ceiling"] != true || (bool?)view["walls"] != false ||
                (bool?)view["ground"] != true || (bool?)view["roof"] != true)
                throw new SmokeFailure("view", "Evidence view did not reach ceiling/walls/ground/roof state: " + view.ToString(Formatting.None));
            return view;
        }

        static void SendViewChecked(StationGameHost host, string key, bool value) {
            var envelope = new JObject {
                ["schemaVersion"] = StationCommandRouter.SchemaVersion,
                ["id"] = "editor-smoke-view-" + key,
                ["sessionId"] = "editor-smoke",
                ["type"] = "view.set",
                ["payload"] = new JObject { ["key"] = key, ["value"] = value },
            };
            string reply = host.SendForTest(envelope.ToString(Formatting.None));
            if (string.IsNullOrEmpty(reply))
                throw new SmokeFailure("view", "view.set " + key + " produced no reply.");
            JObject parsed;
            try { parsed = JObject.Parse(reply); }
            catch (JsonException error) { throw new SmokeFailure("view", "view.set " + key + " reply is not JSON: " + error.Message); }
            if ((string)parsed["kind"] != "ack" || !(bool)parsed["accepted"]) {
                var code = (string)parsed["code"] ?? "unknown";
                throw new SmokeFailure("view", "view.set " + key + " was rejected: " + code + ".");
            }
        }

        static JObject OpenDemoChecked(StationGameHost host, string demo, string fixtureHash) {
            int revisionBefore = host.CurrentRevision;
            string sourceBefore = host.CurrentSourceId;
            string reply = SendOpenDemo(host, demo);
            if (string.IsNullOrEmpty(reply))
                throw new SmokeFailure("fixture", "station.openDemo produced no reply through StationGameHost.BrowserCommand.");
            JObject parsed;
            try { parsed = JObject.Parse(reply); }
            catch (JsonException error) { throw new SmokeFailure("fixture", "station.openDemo reply is not JSON: " + error.Message); }
            if ((string)parsed["kind"] != "commit" || !(bool)parsed["accepted"]) {
                var code = (string)parsed["code"] ?? "unknown";
                var reasonToken = parsed["payload"] != null ? parsed["payload"]["reason"] : null;
                var reason = reasonToken != null ? (string)reasonToken : reply;
                throw new SmokeFailure("fixture", "station.openDemo was rejected: " + code + " (" + reason + ").");
            }
            var payload = parsed["payload"] as JObject;
            var sourceHash = payload != null ? (string)payload["sourceHash"] : null;
            int revisionAfter = host.CurrentRevision;
            if (!string.Equals(host.CurrentSourceId, demo, StringComparison.Ordinal))
                throw new SmokeFailure("fixture", "Committed source is '" + host.CurrentSourceId + "', expected '" + demo + "'.");
            if (!string.Equals(sourceHash, fixtureHash, StringComparison.Ordinal))
                throw new SmokeFailure("fixture", "Committed source hash does not match the fixture text hash.");
            if (revisionAfter != revisionBefore + 1)
                throw new SmokeFailure("fixture", "Open committed revision " + revisionAfter + " from " + revisionBefore + "; expected exactly one revision bump.");
            return new JObject {
                ["revisionBefore"] = revisionBefore,
                ["revisionAfter"] = revisionAfter,
                ["revisionDelta"] = revisionAfter - revisionBefore,
                ["sourceIdBefore"] = sourceBefore,
                ["sourceIdAfter"] = host.CurrentSourceId,
                ["sourceHash"] = sourceHash,
                ["bodyBytes"] = reply.Length,
                ["accepted"] = true,
            };
        }

        static string SendOpenDemo(StationGameHost host, string demo) {
            string reply = null;
            Action<string> onReply = value => reply = value;
            host.ReplyPublished += onReply;
            try {
                var envelope = new JObject {
                    ["schemaVersion"] = StationCommandRouter.SchemaVersion,
                    ["id"] = "editor-smoke-" + Guid.NewGuid().ToString("N"),
                    ["sessionId"] = "editor-smoke",
                    ["type"] = "station.openDemo",
                    ["payload"] = new JObject { ["id"] = demo },
                };
                host.BrowserCommand(envelope.ToString(Formatting.None));
            } finally {
                host.ReplyPublished -= onReply;
            }
            return reply;
        }

        static TextAsset FindDemo(StationGameHost host, string demo) {
            if (host.demos == null) return null;
            for (int i = 0; i < host.demos.Length; i++) {
                var row = host.demos[i];
                if (row != null && string.Equals(row.id, demo, StringComparison.Ordinal)) return row.document;
            }
            return null;
        }

        static string Join(System.Collections.Generic.IReadOnlyList<string> values) =>
            values == null || values.Count == 0 ? "(none)" : string.Join(", ", values);

        static void Require(JArray checks, string name, bool ok, string detail) {
            checks.Add(new JObject { ["name"] = name, ["ok"] = ok, ["detail"] = detail });
            if (!ok) throw new SmokeFailure("simulation", name + ": " + detail);
        }

        static bool AllChecksPass(JArray checks) {
            for (int i = 0; i < checks.Count; i++) {
                if (checks[i]["ok"] != null && !(bool)checks[i]["ok"]) return false;
            }
            return true;
        }

        static void WriteResult(CommandContext cmd, JObject result, string outputPath) {
            if (!string.IsNullOrEmpty(outputPath)) {
                try {
                    var full = Path.GetFullPath(outputPath);
                    var parent = Path.GetDirectoryName(full);
                    if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                    File.WriteAllText(full, result.ToString(Formatting.Indented));
                } catch (Exception error) {
                    cmd.Log.Warning("Could not write smoke result to " + outputPath + ": " + error.Message);
                }
            }
            cmd.Result.Write(result);
        }

        static JObject CameraJson(Camera camera) {
            var transform = camera.transform;
            return new JObject {
                ["position"] = VectorJson(transform.position),
                ["rotation"] = QuaternionJson(transform.rotation),
                ["orthographic"] = camera.orthographic,
                ["orthographicSize"] = camera.orthographicSize,
                ["fieldOfView"] = camera.fieldOfView,
                ["nearClipPlane"] = camera.nearClipPlane,
                ["farClipPlane"] = camera.farClipPlane,
            };
        }

        static JObject VectorJson(Vector3 value) =>
            new JObject { ["x"] = value.x, ["y"] = value.y, ["z"] = value.z };

        static JObject QuaternionJson(Quaternion value) =>
            new JObject { ["x"] = value.x, ["y"] = value.y, ["z"] = value.z, ["w"] = value.w };

        static long Ms(Stopwatch stopwatch) => stopwatch.ElapsedMilliseconds;

        static string Hash(string text) {
            using (var sha = SHA256.Create()) {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? ""));
                var builder = new StringBuilder(bytes.Length * 2);
                for (int i = 0; i < bytes.Length; i++) builder.Append(bytes[i].ToString("x2", CultureInfo.InvariantCulture));
                return builder.ToString();
            }
        }
    }
}
