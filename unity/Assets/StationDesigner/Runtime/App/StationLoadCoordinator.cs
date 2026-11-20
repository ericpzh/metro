using System;
using System.Collections;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The simulation side of one install transaction. Packet C's session is adapted
    /// to this by <see cref="StationSimulationHost"/>; a different implementation can
    /// be installed without the loader knowing about it. Staging must not touch the
    /// live session; Commit swaps it in; Abort leaves the old one running.
    /// </summary>
    public interface IStationSimulationHost {
        /// <summary>
        /// Stage an install. <paramref name="editKind"/> is the classification the coordinator
        /// already made against the committed document (plan 29 §3), so staging does not walk
        /// the whole document twice; null asks the host to classify it itself.
        /// </summary>
        void StageInstall(StationDocument document, StationIndex index, bool isEdit = false,
            StationDocumentEditKind? editKind = null);
        void CommitInstall();
        void AbortInstall();
        void Tick(double realSeconds);
        void Release();
        bool Playing { get; }
        int Speed { get; }
        /// <summary>Seconds since the station's day zero, for per-frame consumers.</summary>
        double SimTimeSeconds { get; }
        /// <summary>The fixed tick the session is on (authoritative, integer seconds).</summary>
        long SimulationTick { get; }
        /// <summary>
        /// The scheduler's fractional position toward the next fixed tick, 0 … 1. The
        /// presentation layer samples the adjacent tick frames at this fraction; it is
        /// never a simulation input.
        /// </summary>
        double PresentationFraction { get; }
        /// <summary>Bumped when presented history is invalid (seek, restart, rebuild).</summary>
        long PresentationEpoch { get; }
        string ClockPayloadJson();
        /// <summary>
        /// Which simulation transports this install honours, as the `payload.simulationCapabilities`
        /// object the shell reads beside the clock (session id + the capability booleans).
        /// Empty when the host has no session to describe.
        /// </summary>
        string CapabilitiesPayloadJson();
    }

    /// <summary>Optional simulation-command support on top of <see cref="IStationSimulationHost"/>.</summary>
    public interface IStationSimulationCommands {
        bool ApplySimCommand(string type, JObject payload, out string rejectCode);
    }

    /// <summary>
    /// Optional local-delta staging support on top of <see cref="IStationSimulationHost"/> so
    /// ordinary cell/module edits stage incremental topology without scanning the full document,
    /// while custom mock <see cref="IStationSimulationHost"/> implementations remain compatible.
    /// </summary>
    public interface IStationLocalSimulationHost : IStationSimulationHost {
        void StageLocalInstall(
            StationDocument document,
            StationIndex index,
            StationReadResult committedRead,
            StationReadResult nextRead,
            StationDocumentEditKind? editKind = null);
    }

    /// <summary>
    /// A snapshot key a packet owns (camera/view/finishes/…). The host merges every
    /// contributor into each `state`/commit payload, so no packet edits the host.
    /// </summary>
    public interface IStationStateContributor {
        string Key { get; }
        JObject BuildPayload(StationDocument document, StationIndex index);
    }

    /// <summary>Baseline camera framing for a committed document, in world metres.</summary>
    public readonly struct StationCameraBounds {
        public StationCameraBounds(StationBounds bounds, Vector3 centre, float radius, float orthoSize) {
            Bounds = bounds; Centre = centre; Radius = radius; OrthoSize = orthoSize;
        }
        public StationBounds Bounds { get; }
        public Vector3 Centre { get; }
        public float Radius { get; }
        public float OrthoSize { get; }
        public bool IsEmpty => Bounds.IsEmpty;
        public override string ToString() => Bounds + " centre " + Centre + " radius " + Radius;
    }

    /// <summary>What was committed: the document, its index, the new revision and source.</summary>
    public sealed class StationCommitInfo {
        public StationDocument Document;
        public StationIndex Index;
        public int Revision;
        public string SourceId;
        public string SourceHash;
        public bool IsEdit;
        /// <summary>
        /// What this edit can change in the simulation, classified **before** the world was
        /// staged (plan 29 §3). Null on a station open.
        /// </summary>
        public StationDocumentEditKind? EditKind;
        public StationCameraBounds CameraBounds;
        public StationViewSummary View;
        public StationLocalViewCommit LocalView;
        public IReadOnlyList<StationDiagnostic> Diagnostics;
    }

    /// <summary>The typed result of one install attempt.</summary>
    public sealed class StationLoadResult {
        public bool Accepted;
        public int Revision;
        public StationRejection Rejection;
        public IReadOnlyList<StationDiagnostic> Diagnostics = Array.Empty<StationDiagnostic>();
        public StationDocument Document;
        public StationIndex Index;
        public StationCameraBounds CameraBounds;
        public StationViewSummary View;
        public static StationLoadResult Rejected(StationRejection rejection, int revision) => new StationLoadResult {
            Accepted = false, Rejection = rejection, Revision = revision,
            Diagnostics = new[] { new StationDiagnostic(rejection.Code, StationDiagnosticSeverity.Error,
                rejection.RecordType, rejection.RecordId, rejection.Reason) },
        };
        public override string ToString() => Accepted ? "accepted revision " + Revision : "rejected: " + Rejection;
    }

    /// <summary>
    /// The station install transaction: parse/repair → document/index â†’ **staged**
    /// view root + staged simulation session → commit document, scene, camera bounds
    /// and simulation together. Any failure disposes the candidate and returns one
    /// typed rejection; the previous station keeps running.
    /// </summary>
    public sealed class StationLoadCoordinator : IDisposable {
        readonly Transform parent;
        readonly List<IStationViewRenderer> renderers = new List<IStationViewRenderer>();
        StationWorldView world;
        StationDocument document;
        StationIndex index;
        /// <summary>
        /// The committed read result, envelope included, so a local edit can patch the save tree
        /// and project only the records it touched (plan 30 §3).
        /// </summary>
        StationReadResult committedRead;
        StationReadResult previousCommittedRead;
        int previousCommittedRevision;
        StationCameraBounds cameraBounds;
        IStationSimulationHost simulation;
        int revision;
        string sourceId = "";
        string sourceHash = "";
        int sourceHashRevision = -1;
        bool disposed;

        public StationLoadCoordinator(Transform parent) {
            this.parent = parent;
        }

        /// <summary>
        /// Test seam: override the record-count threshold above which <see cref="OpenYielded"/>
        /// releases the previous visual world before building/parsing a huge replacement on Wasm32
        /// (restoring it from the untouched committed document+index on rollback).
        /// </summary>
        public static int? LowMemoryReplaceRecordThresholdOverride = null;

        public event Action<StationCommitInfo> Committed;
        /// <summary>
        /// Invoked if <see cref="OpenYielded"/> released the previous visual world under low-memory
        /// replacement and then rebuilt it from the untouched committed document after a rejected load.
        /// </summary>
        public event Action<StationWorldView> WorldRestored;
        /// <summary>
        /// Invoked during <see cref="Install"/> only after the incoming candidate world and
        /// simulation have succeeded and <c>world.Activate()</c> has run, immediately before
        /// <c>previous?.Dispose()</c>. Rejected loads return earlier and never fire this hook.
        /// </summary>
        public event Action<StationWorldView> BeforePreviousDispose;

        public StationDocument Document => document;
        public StationIndex Index => index;
        /// <summary>The committed read result, including the normalized envelope tree (plan 30 §3).</summary>
        public StationReadResult CommittedRead => committedRead;
        public StationReadResult PreviousCommittedRead => previousCommittedRead;
        public int PreviousCommittedRevision => previousCommittedRevision;
        public StationWorldView World => world;
        public StationCameraBounds CameraBounds => cameraBounds;
        public int Revision => revision;
        public string SourceId => sourceId;
        public string SourceHash => EnsureSourceHash();
        public int SourceHashRevision => sourceHashRevision;
        public bool HasCurrentSourceHash => !string.IsNullOrEmpty(sourceHash) && sourceHashRevision == revision;
        public string PeekSourceHash() => HasCurrentSourceHash ? sourceHash : null;

        public string EnsureSourceHash() {
            if (HasCurrentSourceHash) return sourceHash;
            if (document == null) return "";
            sourceHash = document.EnsureContentHash() ?? "";
            sourceHashRevision = revision;
            return sourceHash;
        }
        public bool IsLoaded => document != null;
        public IStationSimulationHost Simulation => simulation;
        /// <summary>Scene assets copied into every candidate world before Build().</summary>
        public StationViewAssets Assets { get; set; } = new StationViewAssets();
        public IReadOnlyList<IStationViewRenderer> Renderers => renderers;

        public void RegisterRenderer(IStationViewRenderer renderer) {
            if (renderer == null) throw new ArgumentNullException(nameof(renderer));
            UnregisterRenderer(renderer.Role);
            renderers.Add(renderer);
        }

        public bool UnregisterRenderer(string role) {
            for (int i = renderers.Count - 1; i >= 0; i--) {
                if (string.Equals(renderers[i].Role, role, StringComparison.Ordinal)) {
                    renderers.RemoveAt(i);
                    return true;
                }
            }
            return false;
        }

        public void SetSimulationHost(IStationSimulationHost host) => simulation = host;

        public StationLoadResult Open(string json, StationSource source, string id) {
            Action<string> markLoad = StationLoadProbe.Begin(id, document != null);
            StationReadResult read;
            try {
                read = StationDocumentReader.Read(json, source, markLoad);
            } catch (StationRejectedException rejection) {
                return StationLoadResult.Rejected(rejection.Rejection, revision);
            }
            return Install(read, string.IsNullOrEmpty(id) ? read.Document.Source.Hash : id, markLoad: markLoad);
        }

        static void RequestWebGlSweep() {
#if UNITY_WEBGL && !UNITY_EDITOR
            GC.Collect();
#endif
        }

        static int LowMemoryReplaceThreshold() {
            if (LowMemoryReplaceRecordThresholdOverride.HasValue) return LowMemoryReplaceRecordThresholdOverride.Value;
#if UNITY_WEBGL && !UNITY_EDITOR
            return 50000;
#else
            return int.MaxValue;
#endif
        }

        bool IsLargeStation(StationDocument doc) {
            if (doc == null) return false;
            int threshold = LowMemoryReplaceThreshold();
            return threshold <= 0 || (doc.CellCount + doc.ModuleCount) >= threshold;
        }

        void RestoreReleasedWorld() {
            if (disposed || world != null || document == null || index == null) return;
            var restored = new StationWorldView(parent, "Station " + (string.IsNullOrEmpty(sourceId) ? document.Name : sourceId), renderers, Assets);
            restored.Build(document, index);
            restored.Activate();
            world = restored;
            WorldRestored?.Invoke(world);
        }

        /// <summary>
        /// Frame-yielded station open for WebGL: yields frames between teardown, parse/repair,
        /// inactive world build, and commit so Boehm GC can sweep transient multi-hundred-MiB
        /// staging buffers on an empty stack while preserving atomic candidate install and rollback.
        /// </summary>
        public IEnumerator OpenYielded(string json, StationSource source, string id, Action<StationLoadResult> onComplete) {
            if (disposed) {
                onComplete?.Invoke(StationLoadResult.Rejected(new StationRejection("disposed", StationRecordKind.Document,
                    "station", "", "Station load coordinator is disposed."), revision));
                yield break;
            }
            if (document != null) {
                RequestWebGlSweep();
                yield return null;
            }

            Action<string> markLoad = StationLoadProbe.Begin(id, document != null);
            bool releasedPreviousVisual = false;
            // On 32-bit Wasm (4 GiB hard ceiling), replacing a huge station (e.g. Tianhe Park, ~152k
            // records) with another multi-MiB document cannot fit two full visual worlds plus a ~770 MiB
            // parse DOM simultaneously. Release only the visual world first while keeping the committed
            // document+index intact so any parse/render/sim refusal restores cleanly via RestoreReleasedWorld().
            if (world != null && IsLargeStation(document) &&
                ((json != null && json.Length >= 4_000_000) || LowMemoryReplaceRecordThresholdOverride.HasValue)) {
                markLoad?.Invoke("yield.release-previous-before-read");
                BeforePreviousDispose?.Invoke(world);
                world.Dispose();
                world = null;
                releasedPreviousVisual = true;
                yield return null;
                if (disposed) yield break;
                RequestWebGlSweep();
                yield return null;
                if (disposed) yield break;
                markLoad?.Invoke("yield.release-previous-before-read.resumed");
            }

            StationReadResult read = null;
            StationRejection readRejection = null;
            try {
                read = StationDocumentReader.Read(json, source, markLoad);
            } catch (StationRejectedException rejection) {
                readRejection = rejection.Rejection;
            }
            json = null;
            if (readRejection != null) {
                if (releasedPreviousVisual) RestoreReleasedWorld();
                onComplete?.Invoke(StationLoadResult.Rejected(readRejection, revision));
                yield break;
            }
            markLoad?.Invoke("yield.after-read");
            RequestWebGlSweep();
            yield return null;
            if (disposed) yield break;
            markLoad?.Invoke("yield.after-read.resumed");

            if (!releasedPreviousVisual && world != null && (IsLargeStation(document) || IsLargeStation(read.Document))) {
                markLoad?.Invoke("yield.release-previous-before-build");
                BeforePreviousDispose?.Invoke(world);
                world.Dispose();
                world = null;
                releasedPreviousVisual = true;
                yield return null;
                if (disposed) yield break;
                RequestWebGlSweep();
                yield return null;
                if (disposed) yield break;
                markLoad?.Invoke("yield.release-previous-before-build.resumed");
            }

            string resolvedId = string.IsNullOrEmpty(id) ? read.Document.Source.Hash : id;
            var candidate = new StationWorldView(parent, "Station " + (string.IsNullOrEmpty(resolvedId) ? read.Document.Name : resolvedId), renderers, Assets);
            StationRejection buildRejection = null;
            try {
                candidate.Build(read.Document, read.Index, markLoad);
            } catch (StationViewBuildException error) {
                candidate.Dispose();
                buildRejection = new StationRejection("render-failed", StationRecordKind.Document, "renderer", error.Role, error.Message);
            } catch (Exception error) {
                candidate.Dispose();
                buildRejection = new StationRejection("render-failed", StationRecordKind.Document, "renderer", "", error.Message);
            }
            if (buildRejection != null) {
                read = null;
                candidate = null;
                if (releasedPreviousVisual) RestoreReleasedWorld();
                onComplete?.Invoke(StationLoadResult.Rejected(buildRejection, revision));
                yield break;
            }
            markLoad?.Invoke("yield.after-build");
            RequestWebGlSweep();
            yield return null;
            if (disposed) {
                candidate.Dispose();
                yield break;
            }
            markLoad?.Invoke("yield.after-build.resumed");

            IStationSimulationHost stageTarget = simulation;
            StationRejection simRejection = null;
            try {
                if (stageTarget != null) {
                    markLoad?.Invoke("simulation.stage.begin");
                    stageTarget.StageInstall(read.Document, read.Index, isEdit: false, editKind: null);
                    markLoad?.Invoke("simulation.stage.end");
                    stageTarget.CommitInstall();
                }
            } catch (Exception error) {
                Abort(candidate, stageTarget);
                simRejection = new StationRejection("simulation-failed", StationRecordKind.Document, "simulation", "", error.Message);
            }
            if (simRejection != null) {
                read = null;
                candidate = null;
                if (releasedPreviousVisual) RestoreReleasedWorld();
                onComplete?.Invoke(StationLoadResult.Rejected(simRejection, revision));
                yield break;
            }

            var previous = world;
            previousCommittedRead = null;
            previousCommittedRevision = revision;
            var nextRevision = revision + 1;
            world = candidate;
            markLoad?.Invoke("activate.begin");
            world.Activate();
            markLoad?.Invoke("activate.end");
            if (previous != null) {
                BeforePreviousDispose?.Invoke(previous);
                previous.Dispose();
                previous = null;
                markLoad?.Invoke("previous.dispose-requested");
            }

            document = read.Document;
            index = read.Index;
            committedRead = read;
            revision = nextRevision;
            string materializedHash = read.Document.PeekMaterializedHash();
            sourceId = !string.IsNullOrEmpty(resolvedId) ? resolvedId : (!string.IsNullOrEmpty(materializedHash) ? materializedHash : sourceId);
            if (!string.IsNullOrEmpty(materializedHash)) {
                sourceHash = materializedHash;
                sourceHashRevision = revision;
            } else {
                sourceHash = "";
            }
            cameraBounds = ComputeCameraBounds(read.Index);

            var info = new StationCommitInfo {
                Document = document, Index = index, Revision = revision, SourceId = sourceId,
                SourceHash = PeekSourceHash() ?? "", IsEdit = false, EditKind = null,
                CameraBounds = cameraBounds, LocalView = null,
                View = world.Summary(), Diagnostics = Merge(read.Diagnostics, world.Unresolved),
            };
            Committed?.Invoke(info);
            if (markLoad != null) markLoad("committed revision=" + revision);
            var result = new StationLoadResult {
                Accepted = true, Revision = revision, Document = document, Index = index,
                CameraBounds = cameraBounds, View = info.View, Diagnostics = info.Diagnostics,
            };
            read = null;
            candidate = null;
            info = null;
            markLoad?.Invoke("yield.before-reply");
            // Yield one frame first so deferred Destroy(previous.Root) and OnDestroy() hooks run,
            // then sweep managed garbage on the next frame before streaming the commit reply.
            yield return null;
            if (disposed) yield break;
            RequestWebGlSweep();
            yield return null;
            if (disposed) yield break;
            markLoad?.Invoke("yield.before-reply.resumed");
            onComplete?.Invoke(result);
        }

        public StationLoadResult OpenFile(string path, string id) {
            StationReadResult read;
            try {
                read = StationDocumentReader.ReadFile(path);
            } catch (StationRejectedException rejection) {
                return StationLoadResult.Rejected(rejection.Rejection, revision);
            }
            return Install(read, string.IsNullOrEmpty(id) ? path : id);
        }

        /// <summary>
        /// A New station goes through the same file boundary as an opened one: the
        /// empty v1 envelope is read, repaired and indexed by the same reader.
        /// </summary>
        public StationLoadResult New(string name, string city, long seed) {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = string.IsNullOrEmpty(name) ? "未命名车站" : name,
                ["nameEn"] = "",
                ["city"] = string.IsNullOrEmpty(city) ? "guangzhou" : city,
                ["seed"] = seed,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = new JArray(), ["modules"] = new JArray(), ["lines"] = new JArray() },
            };
            return Open(envelope.ToString(Newtonsoft.Json.Formatting.None), StationSource.None, "new");
        }

        StationLoadResult Install(StationReadResult read, string id, bool isEdit = false, Action<string> markLoad = null) {
            if (disposed) throw new ObjectDisposedException(nameof(StationLoadCoordinator));
            // Classify the edit **before** any world work starts (plan 29 §3): the answer is
            // what a retained-dirty-chunk install and a skipped simulation projection read, and
            // the simulation host must not recompute it after the view staged the whole station.
            // An unclassifiable edit fails closed to Structural, the conservative rebuild.
            StationDocumentEditKind? editKind = null;
            if (isEdit && document != null) {
                try { editKind = ReferenceEquals(read.LocalParent, committedRead) && read.LocalDelta != null
                    ? StationEditClassifier.ClassifyLocal(committedRead, read)
                    : StationEditClassifier.Classify(document, read.Document); }
                catch (Exception) { editKind = StationDocumentEditKind.Structural; }
            }
            StationWorldView.LocalWorldStage localView = null;
            try {
                if (isEdit && world != null && ReferenceEquals(read.LocalParent, committedRead) && read.LocalDelta != null)
                    localView = world.StageLocalWorld(read.Document, read.Index, read.LocalDelta);
            } catch (StationViewBuildException error) {
                return StationLoadResult.Rejected(new StationRejection("render-failed", StationRecordKind.Document,
                    "renderer", error.Role, error.Message), revision);
            } catch (Exception error) {
                return StationLoadResult.Rejected(new StationRejection("render-failed", StationRecordKind.Document,
                    "renderer", "local-world", error.Message), revision);
            }
            bool isLocalChild = isEdit && document != null &&
                                ReferenceEquals(read.LocalParent, committedRead) &&
                                read.LocalDelta != null;
            bool retained = localView != null;
            var candidate = retained ? world : new StationWorldView(parent, "Station " + (string.IsNullOrEmpty(id) ? read.Document.Name : id), renderers, Assets);
            IStationSimulationHost stageTarget = simulation;
            try {
                if (!retained) candidate.Build(read.Document, read.Index, markLoad);
                if (stageTarget != null) {
                    markLoad?.Invoke("simulation.stage.begin");
                    if (isLocalChild && stageTarget is IStationLocalSimulationHost localSim) {
                        localSim.StageLocalInstall(read.Document, read.Index, committedRead, read, editKind);
                    } else {
                        stageTarget.StageInstall(read.Document, read.Index, isEdit && document != null, editKind);
                    }
                    markLoad?.Invoke("simulation.stage.end");
                }
            } catch (StationViewBuildException error) {
                AbortLocal(candidate, stageTarget, localView);
                return StationLoadResult.Rejected(new StationRejection("render-failed", StationRecordKind.Document,
                    "renderer", error.Role, error.Message), revision);
            } catch (Exception error) {
                AbortLocal(candidate, stageTarget, localView);
                return StationLoadResult.Rejected(new StationRejection("simulation-failed", StationRecordKind.Document,
                    "simulation", "", error.Message), revision);
            }

            try {
                if (stageTarget != null) stageTarget.CommitInstall();
            } catch (Exception error) {
                AbortLocal(candidate, stageTarget, localView);
                return StationLoadResult.Rejected(new StationRejection("simulation-failed", StationRecordKind.Document,
                    "simulation", "", error.Message), revision);
            }

            var previous = world;
            previousCommittedRead = isEdit ? committedRead : null;
            previousCommittedRevision = revision;
            var nextRevision = revision + 1;
            world = candidate;
            StationLocalViewCommit localCommit = null;
            if (retained) {
                localCommit = world.CommitLocalWorld(localView);
                StationScenePicker.ApplyLocalCommit(world, localCommit, read.LocalDelta);
            } else {
                markLoad?.Invoke("activate.begin");
                world.Activate();
                markLoad?.Invoke("activate.end");
                BeforePreviousDispose?.Invoke(previous);
                previous?.Dispose();
                markLoad?.Invoke("previous.dispose-requested");
            }
            document = read.Document;
            index = read.Index;
            committedRead = read;
            revision = nextRevision;
            string materializedHash = read.Document.PeekMaterializedHash();
            sourceId = !string.IsNullOrEmpty(id) ? id : (!string.IsNullOrEmpty(materializedHash) ? materializedHash : sourceId);
            if (!string.IsNullOrEmpty(materializedHash)) {
                sourceHash = materializedHash;
                sourceHashRevision = revision;
            } else {
                sourceHash = "";
            }
            cameraBounds = ComputeCameraBounds(read.Index);

            var info = new StationCommitInfo {
                Document = document, Index = index, Revision = revision, SourceId = sourceId,
                SourceHash = PeekSourceHash() ?? "", IsEdit = isEdit && previous != null, EditKind = editKind,
                CameraBounds = cameraBounds, LocalView = localCommit,
                View = world.Summary(), Diagnostics = Merge(read.Diagnostics, world.Unresolved),
            };
            Committed?.Invoke(info);
            if (markLoad != null) markLoad("committed revision=" + revision);
            return new StationLoadResult {
                Accepted = true, Revision = revision, Document = document, Index = index,
                CameraBounds = cameraBounds, View = info.View, Diagnostics = info.Diagnostics,
            };
        }

        static void AbortLocal(StationWorldView candidate, IStationSimulationHost simulation, StationWorldView.LocalWorldStage local) {
            if (local == null) { Abort(candidate, simulation); return; }
            try { simulation?.AbortInstall(); } catch (Exception) { }
            local.Dispose();
        }

        static void Abort(StationWorldView candidate, IStationSimulationHost stageTarget) {
            try { stageTarget?.AbortInstall(); } catch (Exception) { /* abort must not mask the original refusal */ }
            candidate.Dispose();
        }

        static IReadOnlyList<StationDiagnostic> Merge(IReadOnlyList<StationDiagnostic> read, IReadOnlyList<StationDiagnostic> view) {
            var all = new List<StationDiagnostic>();
            if (read != null) all.AddRange(read);
            if (view != null) all.AddRange(view);
            return all;
        }

        /// <summary>
        /// The world-space box the committed content occupies, with a baseline
        /// orthographic framing. Packet D's camera controller takes these bounds over;
        /// the numbers are derived from the document, never an authored layout.
        /// </summary>
        public static StationCameraBounds ComputeCameraBounds(StationIndex index) {
            var bounds = index?.Bounds ?? new StationBounds(0, 0, 0, -1, -1, -1);
            if (bounds.IsEmpty) return new StationCameraBounds(bounds, Vector3.zero, 0f, 10f);
            double centreX = bounds.MinX + bounds.Width / 2.0;
            double centreY = bounds.MinY + bounds.Depth / 2.0;
            double centreZ = bounds.MinZ + bounds.Height / 2.0;
            var centre = StationCoordinates.Point(new Vector3((float)centreX, (float)centreY, (float)centreZ));
            float radius = new Vector3(bounds.Width, bounds.Depth, bounds.Height).magnitude * 0.5f;
            float ortho = Mathf.Max(12f, Mathf.Max(bounds.Width, bounds.Depth) * 0.62f);
            return new StationCameraBounds(bounds, centre, radius, ortho);
        }

        public string Save(DateTimeOffset savedAt) {
            if (document == null) return "";
            return StationDocumentReader.Write(document, savedAt);
        }

        public string Save() => Save(DateTimeOffset.UtcNow);

        /// <summary>
        /// Install a document produced by an edit verb. The caller has already passed
        /// the revision check; this runs the same parse → index → staged world/session
        /// → commit transaction as an open, so an edit cannot half-commit either.
        /// </summary>
        public StationLoadResult InstallEditedDocument(string json, string sourceId) {
            StationReadResult read;
            try {
                read = StationDocumentReader.Read(json, new StationSource(sourceId ?? "", ""));
            } catch (StationRejectedException rejection) {
                return StationLoadResult.Rejected(rejection.Rejection, revision);
            }
            string id = string.IsNullOrEmpty(sourceId) ? read.Document.Source.Hash : sourceId;
            return Install(read, id, isEdit: true);
        }

        /// <summary>
        /// Install the read result a **local** edit built from the committed document and index
        /// (plan 30 §3): the same install transaction, the same one revision and the same
        /// staged world/simulation, without re-reading the whole envelope. Callers reach this
        /// through <see cref="TryInstallLocalCellEdit"/> / <see cref="TryInstallLocalModuleEdit"/>,
        /// which refuse anything outside the local whitelist.
        /// </summary>
        public StationLoadResult InstallLocalEdit(StationReadResult read, string sourceId) {
            if (read?.Document == null || read.Index == null)
                return StationLoadResult.Rejected(new StationRejection("no-document", StationRecordKind.Document, "", "",
                    "The local edit produced no document."), revision);
            string id = string.IsNullOrEmpty(sourceId) ? read.Document.Source.Hash : sourceId;
            return Install(read, id, isEdit: true);
        }

        /// <summary>
        /// Try the local path for one cell patch. Returns null when the patch is outside the
        /// local whitelist (or the committed document does not match it); the caller then runs
        /// the full envelope path, whose answer is identical. <paramref name="code"/> carries the
        /// refusal code for diagnostics.
        /// </summary>
        public StationLoadResult TryInstallLocalCellEdit(StationCellPatch patch, string sourceId, out string code) {
            code = null;
            if (disposed || document == null || committedRead == null) { code = "no-document"; return null; }
            var read = StationLocalEdit.TryApplyCells(committedRead, patch, sourceId, out code);
            if (read == null) return null;
            return InstallLocalEdit(read, sourceId);
        }

        /// <summary>Try the local path for one module add/replace/remove; null means fall back.</summary>
        public StationLoadResult TryInstallLocalModuleEdit(StationModuleEditMode mode, StationEditDraft draft,
            string removeId, string sourceId, out string code) {
            code = null;
            if (disposed || document == null || committedRead == null) { code = "no-document"; return null; }
            var read = StationLocalEdit.TryApplyModule(committedRead, mode, draft, removeId, sourceId, out code);
            if (read == null) return null;
            return InstallLocalEdit(read, sourceId);
        }

        /// <summary>Try the local path for patching one exit module's demand/open/name settings.</summary>
        public StationLoadResult TryInstallLocalExitSettings(string moduleId, bool hasName, string name,
            bool hasInRate, double inRate, bool hasOpen, bool open, string sourceId, out string code) {
            code = null;
            if (disposed || document == null || committedRead == null) { code = "no-document"; return null; }
            var read = StationLocalEdit.TryApplyExitSettings(committedRead, moduleId, hasName, name, hasInRate, inRate,
                hasOpen, open, sourceId, out code);
            if (read == null) return null;
            return InstallLocalEdit(read, sourceId);
        }

        public void Tick(double realSeconds) => simulation?.Tick(realSeconds);

        public void Dispose() {
            if (disposed) return;
            disposed = true;
            try { simulation?.Release(); } catch (Exception) { }
            world?.Dispose();
            world = null;
            document = null;
            index = null;
            committedRead = null;
        }
    }

    /// <summary>
    /// Packet A's adapter onto C's <see cref="StationSimulationSession"/>. It builds
    /// the session's flat projection from the typed document; the session itself
    /// never sees JSON, Prefabs or the scene.
    /// </summary>
    public sealed class StationSimulationHost : IStationLocalSimulationHost, IStationSimulationCommands {
        public static Action<StationDocument> SimStageFailureInjector { get; set; }

        StationSimulationSession pendingSession;
        StagedStationDocumentEdit pendingEdit;
        StationDocument pendingDocument;
        bool pendingIsEdit;
        StationSimulationSession session;
        StationDocument committedDocument;

        public StationSimulationSession Session => session;

        public void StageInstall(StationDocument document, StationIndex index, bool isEdit = false,
            StationDocumentEditKind? editKind = null) {
            using var editSample = StationEditProfiling.Measure("StationEdit.StageInstall");
            using var traceSample = StationEditTrace.Measure("Sim.StageInstall");
            pendingSession = null;
            pendingEdit = null;
            pendingDocument = document;
            pendingIsEdit = false;
            SimStageFailureInjector?.Invoke(document);
            if (isEdit && session != null && committedDocument != null) {
                StationEditTrace.NoteSimFallback("full-stage-install");
                var kind = editKind ?? StationEditClassifier.Classify(committedDocument, document);
                var projectedDoc = StationSessionProjection.Document(document, index);
                var projectedDay = StationSessionProjection.Day(document.Day);
                pendingEdit = session.StageDocumentEdit(projectedDoc, projectedDay, kind);
                pendingIsEdit = true;
                StationEditTrace.SetGraphCounts(pendingEdit.WalkGraph?.NodeCount ?? 0, pendingEdit.RebuiltNodeCount, 0);
                return;
            }
            var setup = StationSessionProjection.Setup(document, index, "sim-" + (document.Source.Hash ?? ""));
            pendingSession = new StationSimulationSession(setup);
        }

        public void StageLocalInstall(
            StationDocument document,
            StationIndex index,
            StationReadResult committedRead,
            StationReadResult nextRead,
            StationDocumentEditKind? editKind = null) {
            using var editSample = StationEditProfiling.Measure("StationEdit.StageLocalInstall");
            using var traceSample = StationEditTrace.Measure("Sim.StageLocalInstall");
            pendingSession = null;
            pendingEdit = null;
            pendingDocument = document;
            pendingIsEdit = false;
            SimStageFailureInjector?.Invoke(document);
            if (session == null || committedDocument == null || committedRead == null || nextRead == null ||
                !ReferenceEquals(committedDocument, committedRead.Document) || nextRead.LocalDelta == null) {
                StationEditTrace.NoteSimFallback("missing-local-parent");
                StageInstall(document, index, isEdit: true, editKind: editKind);
                return;
            }
            var kind = editKind ?? StationEditClassifier.ClassifyLocal(committedRead, nextRead);
            var simDelta = StationSessionProjection.Delta(nextRead.LocalDelta, document, committedRead.Index, index);
            var projectedDay = StationSessionProjection.Day(document.Day);
            string nextStationId = string.IsNullOrEmpty(document.Source.Hash) ? null : document.Source.Hash;
            pendingEdit = session.StageCellDelta(nextStationId, document.LevelBase, projectedDay, simDelta, kind);
            pendingIsEdit = true;
            if (pendingEdit.UsedIncrementalGraph) {
                StationEditTrace.NoteIncrementalGraph();
            } else if (!string.IsNullOrEmpty(pendingEdit.FallbackReason)) {
                StationEditTrace.NoteSimFallback(pendingEdit.FallbackReason);
            }
            StationEditTrace.SetGraphCounts(pendingEdit.WalkGraph?.NodeCount ?? 0, pendingEdit.RebuiltNodeCount, 0);
        }

        public void CommitInstall() {
            using var editSample = StationEditProfiling.Measure("StationEdit.CommitInstall");
            using var traceSample = StationEditTrace.Measure("Sim.CommitInstall");
            if (pendingIsEdit && session != null) {
                session.CommitDocumentEdit(pendingEdit);
                StationEditTrace.SetGraphCounts(session.WalkGraph?.NodeCount ?? 0, 0, session.Services?.LastReconciledPassengers ?? 0);
                committedDocument = pendingDocument;
                pendingEdit = null;
                pendingDocument = null;
                pendingIsEdit = false;
                BindPassengerFeed();
                return;
            }
            session = pendingSession;
            committedDocument = pendingDocument;
            pendingSession = null;
            pendingEdit = null;
            pendingDocument = null;
            pendingIsEdit = false;
            BindPassengerFeed();
        }

        public void AbortInstall() {
            if (pendingIsEdit && session != null) {
                session.AbortDocumentEdit();
            }
            pendingSession = null;
            pendingEdit = null;
            pendingDocument = null;
            pendingIsEdit = false;
        }

        /// <summary>
        /// Bind the crowd renderer's actor feed to the session that was just committed.
        /// A station switch replaces the feed in the same transaction that replaces the
        /// world, so the released session can never publish into the new station's
        /// crowd; disposing the host clears it again.
        /// </summary>
        void BindPassengerFeed() {
            if (session == null) { PassengerPoseFeeds.Clear(); return; }
            PassengerPoseFeeds.SetSource(new SessionPassengerFeed(session));
        }

        public void Tick(double realSeconds) {
            if (session != null && realSeconds > 0) session.Advance(realSeconds);
        }

        public void Release() {
            session = null;
            committedDocument = null;
            pendingSession = null;
            pendingEdit = null;
            pendingDocument = null;
            pendingIsEdit = false;
            PassengerPoseFeeds.Clear();
        }

        public bool Playing => session != null && session.Playing;
        public int Speed => session?.Speed ?? 1;
        public double SimTimeSeconds => session?.Clock?.SimTime ?? 0;
        public long SimulationTick => session?.Tick ?? 0;
        public double PresentationFraction => session?.PresentationFraction ?? 0;
        public long PresentationEpoch => session?.PresentationEpoch ?? 0;
        public string ClockPayloadJson() => session?.ClockPayloadJson() ?? "{}";
        public string CapabilitiesPayloadJson() => session?.CapabilitiesPayloadJson() ?? "";

        public bool ApplySimCommand(string type, JObject payload, out string rejectCode) {
            rejectCode = "";
            if (session == null) { rejectCode = "no-session"; return false; }
            var kind = StationSimulationSession.CommandFromType(type);
            if (kind == SimCommandKind.Unknown) { rejectCode = "unsupported-command"; return false; }
            if (kind == SimCommandKind.Seek && payload?["year"] != null && payload?["month"] != null && payload?["day"] != null) {
                try {
                    session.SeekToDate((int)payload["year"], (int)payload["month"], (int)payload["day"]);
                    return true;
                } catch (Exception) {
                    rejectCode = "invalid-seek";
                    return false;
                }
            }
            bool playing = payload?["playing"] != null && payload["playing"].Type == JTokenType.Boolean && (bool)payload["playing"];
            double value = 0;
            if (payload?["simTimeSeconds"] != null) value = (double)payload["simTimeSeconds"];
            else if (payload?["simTime"] != null) value = (double)payload["simTime"];
            else if (payload?["value"] != null) value = (double)payload["value"];
            else if (payload?["speed"] != null) value = (double)payload["speed"];
            string reason;
            if (!session.TryApplyCommand(kind, playing, value, out reason)) {
                rejectCode = string.IsNullOrEmpty(reason) ? "rejected" : reason;
                return false;
            }
            return true;
        }
    }

    /// <summary>
    /// The document → session projection. Only what C's session reads (flat facts,
    /// document order), so the session has no reference to Persistence or Newtonsoft.
    /// </summary>
    public static class StationSessionProjection {
        public static StationSessionSetup Setup(StationDocument document, StationIndex index, string sessionId) {
            return new StationSessionSetup {
                Document = Document(document, index),
                Day = Day(document.Day),
                Seed = unchecked((uint)document.Seed),
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = false,
                Speed = 1,
                SessionId = sessionId,
            };
        }

        public static StationDayData Day(StationDay day) {
            if (day == null) return StationDayData.Default;
            var raw = new StationDayData(
                new DaySpan((int)Math.Round(day.Service.From), (int)Math.Round(day.Service.To)),
                new PeakSpans(
                    new DaySpan((int)Math.Round(day.MorningPeak.From), (int)Math.Round(day.MorningPeak.To)),
                    new DaySpan((int)Math.Round(day.EveningPeak.From), (int)Math.Round(day.EveningPeak.To))),
                new DayDemand(
                    new DemandKnobs(day.Workday.AmPeak, day.Workday.PmPeak, day.Workday.Sharpness),
                    new DemandKnobs(day.Offday.AmPeak, day.Offday.PmPeak, day.Offday.Sharpness)),
                new SimCalendar(new SimDate(day.EpochYear, day.EpochMonth, day.EpochDay), day.Holidays != null ? ToArray(day.Holidays) : null));
            return StationClock.NormalizeDay(raw);
        }

        public static StationCellFact CellFact(StationCellRecord cell) {
            return new StationCellFact {
                X = cell.X, Y = cell.Y, Z = cell.Z,
                Solid = cell.IsSolid,
                Zone = ZoneIndex(cell.Zone),
                Speed = cell.IsSolid ? FloorSpeed(cell.FinishTop) : 0,
            };
        }

        public static StationModuleFact ModuleFact(StationModuleRecord module, IReadOnlyList<ModuleFacts> exits = null) {
            var cfg = module.Config;
            var fact = new StationModuleFact {
                Id = module.Id, Type = module.Type,
                X = module.X, Y = module.Y, Z = module.Z, Rot = module.Rotation,
                Width = module.Width, Depth = module.Depth, Height = module.Height,
                LineId = cfg.Text("line"),
                Name = cfg.Text("name"),
                HeadHouse = module.Type == "exit" && (!cfg.Has("headHouse") || cfg.Bool("headHouse")),
                ExitStyle = module.Type == "exit" ? cfg.Text("style") : "",
                ExitBays = module.Type == "exit" ? (int)Math.Round(cfg.Number("bays", 2)) : 0,
                ExitClosed = module.Type == "exit" && cfg.Has("open") && !cfg.Bool("open"),
                HasExitInRate = module.Type == "exit" && cfg.Has("inRate"),
                ExitInRate = module.Type == "exit" ? cfg.Number("inRate", 900) : 0,
                Dir = cfg.Text("dir"),
                Side = cfg.Text("side"),
                Variant = cfg.Text("variant"),
                RailId = cfg.Text("from"),
                GateDir = GateDir(cfg.Text("dir")),
                GateOpen = module.Type == "gate",
                GateHasLane = module.Type != "gate" || OpeningModuleViews.GateHasLane(cfg.Text("door")),
                Tunnel = cfg.Bool("tunnel"),
                Bridge = cfg.Bool("bridge"),
                Block = cfg.Bool("block"),
                HasEndpoints = module.HasFrom && module.HasTo,
                RunLength = 0,
            };
            if (module.HasFrom) {
                fact.FromX = (int)Math.Round(module.From.Value.X);
                fact.FromY = (int)Math.Round(module.From.Value.Y);
                fact.FromZ = (int)Math.Round(module.From.Value.Z);
            }
            if (module.HasTo) {
                fact.ToX = (int)Math.Round(module.To.Value.X);
                fact.ToY = (int)Math.Round(module.To.Value.Y);
                fact.ToZ = (int)Math.Round(module.To.Value.Z);
            }
            if (fact.Type == "lift") {
                fact.Width = cfg.Number("size", 2) == 3 ? 3 : 2;
                var riseObject = SafeLine("{\"rises\":" + cfg.Json("rises") + "}");
                var rises = new List<int>();
                if (riseObject?["rises"] is JArray riseArray)
                    foreach (var rise in riseArray) rises.Add(rise.Type == JTokenType.Integer ? (int)rise : 0);
                fact.LiftRises = rises.ToArray();
                var doors = SafeLine(cfg.Json("doors"));
                fact.LiftDoorMasks = new Dictionary<int, int>();
                if (doors != null) foreach (var entry in doors.Properties()) {
                    if (!int.TryParse(entry.Name, out int level) || entry.Value.Type != JTokenType.String) continue;
                    var side = (string)entry.Value;
                    fact.LiftDoorMasks[level] = side == "none" ? 0 : side == "back" ? 2 : side == "both" ? 3 : 1;
                }
            }
            if (fact.HasEndpoints && (fact.Type == "stair" || fact.Type == "escalator" || fact.Type == "walkway")) {
                fact.RidePath = RampWalkingLine(module, exits);
                if (fact.Type != "stair") {
                    int escWidth = StationRunGeometry.EscalatorWidth(module.Facts);
                    fact.Width = escWidth;
                    fact.RideWidth = escWidth;
                    fact.RideColumns = escWidth > 1 ? 2 : 1;
                } else {
                    double stairWidth = cfg.Number("width", StationRunGeometry.EscalatorBand);
                    fact.RideWidth = stairWidth > 0 ? stairWidth : Math.Max(1, module.Width);
                    fact.Width = StationRunGeometry.StairRunBlocks(StationRunGeometry.StairTreadWidth(module.Facts));
                    fact.StairFlights = Math.Max(1, StationRunGeometry.StairFlights(module.Facts).Count);
                }
            }
            return fact;
        }

        static StationRidePath RampWalkingLine(StationModuleRecord module, IReadOnlyList<ModuleFacts> exits) {
            var m = module.Facts;
            if (m == null || m.From.HasValue == false || m.To.HasValue == false) return null;
            var points = new List<(double X, double Y, double Z)>();
            void Add(StationRunPoint p, double lift = 0) {
                var point = (p.X + .5, p.Y + .5, p.Z + 1 + lift);
                if (points.Count == 0 || points[points.Count - 1] != point) points.Add(point);
            }

            var start = new StationRunPoint(m.From.X, m.From.Y, m.From.Z);
            var end = new StationRunPoint(m.To.X, m.To.Y, m.To.Z);
            if (module.Type == "stair") {
                Add(start);
                var flights = StationRunGeometry.StairFlights(m);
                var slides = StationRunGeometry.StairFlightSlides(m, flights);
                for (int i = 0; i < flights.Count; i++) {
                    var flight = flights[i];
                    var a = flight.From;
                    var b = flight.To;
                    double dx = b.X - a.X, dy = b.Y - a.Y;
                    double run = Math.Sqrt(dx * dx + dy * dy);
                    var slide = slides[i];
                    double trim = run > 0 && !module.Config.Bool("block") ? StationRunGeometry.StairTreadTrim(run) / run : 0;
                    double liftA = StationRampOpenings.ExitLandingHeight(exits, a);
                    double liftB = StationRampOpenings.ExitLandingHeight(exits, b);
                    Add(new StationRunPoint(a.X + slide.X, a.Y + slide.Y, a.Z), liftA);
                    Add(new StationRunPoint(a.X + slide.X + dx * trim, a.Y + slide.Y + dy * trim, a.Z), liftA);
                    Add(new StationRunPoint(b.X + slide.X - dx * trim, b.Y + slide.Y - dy * trim, b.Z), liftB);
                    Add(new StationRunPoint(b.X + slide.X, b.Y + slide.Y, b.Z), liftB);
                }
                Add(end);
            } else {
                double liftA = StationRampOpenings.ExitLandingHeight(exits, start);
                double liftB = StationRampOpenings.ExitLandingHeight(exits, end);
                StationRunGeometry.EscalatorRun(m, out var a, out var b);
                StationRunGeometry.EscalatorInclineRun(m, out var innerA, out var innerB, out _, liftB - liftA);
                Add(a, liftA);
                Add(innerA, liftA);
                Add(innerB, liftB);
                Add(b, liftB);
            }
            return points.Count > 1 ? new StationRidePath(points.ToArray()) : null;
        }

        static List<ModuleFacts> ExitFacts(StationDocument document, StationIndex index = null) {
            var result = new List<ModuleFacts>();
            if (index != null) {
                var exits = index.ModulesOfType("exit");
                for (int i = 0; i < exits.Count; i++) result.Add(exits[i].Facts);
                return result;
            }
            if (document != null) foreach (var m in document.Modules) if (m.Type == "exit") result.Add(m.Facts);
            return result;
        }

        public static StationSessionDelta Delta(
            StationIndexDelta delta,
            StationDocument nextDocument = null,
            StationIndex prevIndex = null,
            StationIndex nextIndex = null) {
            var result = new StationSessionDelta();
            if (delta == null) return result;
            for (int i = 0; i < delta.RemovedCells.Count; i++) {
                var key = delta.RemovedCells[i];
                result.RemovedCells.Add((key.X, key.Y, key.Z));
            }
            for (int i = 0; i < delta.ChangedCells.Count; i++) {
                result.ChangedCells.Add(CellFact(delta.ChangedCells[i]));
            }
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                result.RemovedModules.Add(delta.RemovedModules[i]);
            }

            bool hasModuleDelta = delta.ChangedModules.Count > 0 || delta.RemovedModules.Count > 0;
            bool exitChanged = false;
            if (hasModuleDelta) {
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    if (delta.ChangedModules[i].Type == "exit") { exitChanged = true; break; }
                    if (prevIndex != null && prevIndex.TryGetModule(delta.ChangedModules[i].Id, out var pm) && pm.Type == "exit") {
                        exitChanged = true; break;
                    }
                }
                if (!exitChanged && delta.RemovedModules.Count > 0) {
                    if (prevIndex != null) {
                        for (int i = 0; i < delta.RemovedModules.Count; i++) {
                            if (prevIndex.TryGetModule(delta.RemovedModules[i], out var rm) && rm.Type == "exit") {
                                exitChanged = true; break;
                            }
                        }
                    } else {
                        exitChanged = true;
                    }
                }
            }

            var exits = delta.ChangedModules.Count > 0 || exitChanged ? ExitFacts(nextDocument, nextIndex) : null;
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                result.ChangedModules.Add(ModuleFact(delta.ChangedModules[i], exits));
            }
            if (nextDocument != null && hasModuleDelta) {
                if (exitChanged) {
                    var ordered = new List<StationModuleFact>(nextDocument.Modules.Count);
                    for (int i = 0; i < nextDocument.Modules.Count; i++) {
                        ordered.Add(ModuleFact(nextDocument.Modules[i], exits));
                    }
                    result.OrderedModules = ordered;
                } else if (delta.ChangedModules.Count > 0) {
                    var ids = new string[nextDocument.Modules.Count];
                    for (int i = 0; i < ids.Length; i++) {
                        ids[i] = nextDocument.Modules[i].Id;
                    }
                    result.OrderedModuleIds = ids;
                }
            }
            StationEditTrace.AddScanned(
                delta.RemovedCells.Count + delta.ChangedCells.Count +
                delta.RemovedModules.Count + delta.ChangedModules.Count);
            return result;
        }

        public static StationSessionDocument Document(StationDocument document, StationIndex index) {
            var projected = new StationSessionDocument {
                StationId = document.Source.Hash ?? "",
                LevelBase = document.LevelBase,
            };
            foreach (var cell in document.Cells) {
                projected.Cells.Add(CellFact(cell));
            }
            var exits = ExitFacts(document, index);
            foreach (var module in document.Modules) {
                projected.Modules.Add(ModuleFact(module, exits));
            }
            foreach (var line in document.Lines) {
                var fact = new StationLineFact {
                    Id = line.Id, Direction = line.Direction,
                    HeadwayPeak = 150, HeadwayOffpeak = 240, HeadwayLate = 480,
                    Stock = line.Stock, Cars = line.Cars,
                    // −1 = the document authors no wave, so the service options' fallback
                    // applies; an authored 0 means "nobody gets off here".
                    AlightPerTrain = -1, ModelScale = 1,
                };
                var raw = SafeLine(line.RawJson);
                var profile = raw?["headwayProfile"];
                if (profile != null) {
                    fact.HeadwayPeak = Number(profile["peak"], fact.HeadwayPeak);
                    fact.HeadwayOffpeak = Number(profile["offpeak"], fact.HeadwayOffpeak);
                    fact.HeadwayLate = Number(profile["late"], fact.HeadwayLate);
                }
                // The live line's own alighting wave and model scale: a fixed
                // `options.AlightPerTrain` seated a wave the document never asked for.
                if (raw?["alightPerTrain"] != null) {
                    fact.AlightPerTrain = (int)Math.Round(Number(raw["alightPerTrain"], 0));
                    fact.AuthoredAlight = true;
                }
                fact.ModelScale = Number(raw?["modelScale"], 1);
                if (fact.Cars <= 0) fact.Cars = 6;
                projected.Lines.Add(fact);
            }
            return projected;
        }

        /// <summary>
        /// The save's zone label as the session's integer index. The session only uses
        /// the index as an identity; the fare-line rule itself is off in the source
        /// (`ZONE_LINES_BLOCK`), so no crossing decision depends on this mapping yet.
        /// </summary>
        public static int ZoneIndex(string zone) {
            // Matches game/src/sim/types.ts ZONES = ['none', 'outside', 'unpaid', 'paid', 'platform', 'restricted'].
            switch (zone) {
                case "outside": return StationWalkGraphBuilder.ZoneOutside;
                case "unpaid": return 2;
                case "paid": return 3;
                case "platform": return 4;
                case "restricted": return 5;
                default: return 0;
            }
        }

        public static void TopFinishBehaviour(string finishId, out double speed, out bool cover, out bool isTrack) {
            string raw = string.IsNullOrEmpty(finishId) ? "floor.concrete" : finishId;
            isTrack = string.Equals(raw, "floor.track", StringComparison.Ordinal);
            string baseId = BaseFinishId(raw);
            switch (baseId) {
                case "floor.track":
                case "floor.soil":
                    speed = 0.0;
                    cover = false;
                    return;
                case "floor.concrete":
                    speed = 0.9;
                    cover = false;
                    return;
                case "ceil.baffle":
                case "ceil.metal":
                case "ceil.steel":
                    speed = 1.0;
                    cover = true;
                    return;
                case "floor.granite":
                case "floor.marble":
                case "floor.limestone":
                case "floor.sandstone":
                case "floor.slate":
                case "floor.softwood":
                case "floor.hardwood":
                case "floor.tile":
                case "floor.obsidian":
                case "wall.plaster":
                case "wall.enamel":
                case "wall.stainless":
                case "wall.aluminum":
                case "wall.soil":
                    speed = 1.0;
                    cover = false;
                    return;
                default:
                    speed = 0.9;
                    cover = false;
                    return;
            }
        }

        public static double FloorSpeed(string finishTop) {
            TopFinishBehaviour(finishTop, out double speed, out _, out _);
            return speed;
        }

        internal static bool IsKnownStockFinish(string baseId) {
            switch (baseId) {
                case "floor.concrete":
                case "floor.granite":
                case "floor.marble":
                case "floor.limestone":
                case "floor.sandstone":
                case "floor.slate":
                case "floor.softwood":
                case "floor.hardwood":
                case "floor.tile":
                case "floor.obsidian":
                case "floor.track":
                case "floor.soil":
                case "ceil.baffle":
                case "ceil.metal":
                case "ceil.steel":
                case "wall.plaster":
                case "wall.enamel":
                case "wall.stainless":
                case "wall.aluminum":
                case "wall.soil":
                    return true;
                default:
                    return false;
            }
        }

        internal static string BaseFinishId(string finishId) {
            if (string.IsNullOrEmpty(finishId)) return "floor.concrete";
            int hash = finishId.IndexOf('#');
            if (hash < 0) return finishId;
            string hex = finishId.Substring(hash + 1);
            if (hex.Length == 0) return finishId;
            for (int i = 0; i < hex.Length; i++) {
                char c = hex[i];
                bool isHex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
                if (!isHex) return finishId;
            }
            return finishId.Substring(0, hash);
        }

        static int GateDir(string direction) => direction == "in" ? 1 : direction == "out" ? -1 : 0;

        static JObject SafeLine(string raw) {
            if (string.IsNullOrEmpty(raw)) return null;
            try { return JObject.Parse(raw); } catch (Exception) { return null; }
        }

        static double Number(JToken token, double fallback) {
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return (double)token;
            return fallback;
        }

        static string[] ToArray(IReadOnlyList<string> values) {
            var array = new string[values.Count];
            for (int i = 0; i < values.Count; i++) array[i] = values[i];
            return array;
        }
    }

    /// <summary>
    /// Classifies an edited document against the previously committed document into
    /// <see cref="StationDocumentEditKind.DayOnly"/>, <see cref="StationDocumentEditKind.Cosmetic"/>,
    /// or <see cref="StationDocumentEditKind.Structural"/> (<c>populationEdit.ts</c>,
    /// <c>cosmeticEdit.ts</c>, <c>decorInert.ts</c>, <c>finishes.ts</c>). Fails closed to
    /// <see cref="StationDocumentEditKind.Structural"/> on any unclassified simulation input.
    /// </summary>
    public static class StationEditClassifier {
        static readonly HashSet<string> InertModuleTypes = new HashSet<string>(StringComparer.Ordinal) {
            "urinal", "tactile", "floor-mark", "billboard", "glass", "calligraphy", "linemap",
            "sign", "tv", "monitor", "clock", "cctv", "light", "vent", "traffic-light", "rail-signal",
            "guidepost", "busstop", "desk", "checkout", "bin",
            "extinguisher", "sidewalk", "lawn", "tree",
        };

        static readonly HashSet<string> KnownRootKeys = new HashSet<string>(StringComparer.Ordinal) {
            "format", "formatVersion", "gameVersion", "savedAt",
            "name", "nameEn", "city", "cityStyle", "seed", "levelBase", "storeyHeight",
            "day", "service", "peaks", "demand", "calendar", "static",
        };

        static readonly HashSet<string> CosmeticLineKeys = new HashSet<string>(StringComparer.Ordinal) {
            "name", "nameEn", "color", "colour",
            "upTerminus", "downTerminus", "upTerminusEn", "downTerminusEn",
            "upNextStation", "upNextStationEn", "downNextStation", "downNextStationEn",
        };

        public static bool IsSimInertDecorModule(StationModuleRecord module) {
            if (module == null) return false;
            if (string.Equals(module.Type, "hanger", StringComparison.Ordinal)) {
                return string.Equals(module.Config.Text("mount"), "roof", StringComparison.Ordinal);
            }
            return InertModuleTypes.Contains(module.Type ?? "");
        }

        public static StationDocumentEditKind ClassifyLocal(StationReadResult before, StationReadResult after) {
            using var editSample = StationEditProfiling.Measure("StationEdit.ClassifyLocal");
            if (before == null || after == null || !ReferenceEquals(after.LocalParent, before) || after.LocalDelta == null)
                return Classify(before?.Document, after?.Document);
            if (!SameExtraRootTrees(before.Envelope, after.Envelope)) return StationDocumentEditKind.Structural;
            var delta = after.LocalDelta;
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var module = before.Index.GetModule(delta.RemovedModules[i]);
                StationEditTrace.AddScanned(1);
                if (module != null && !IsSimInertDecorModule(module)) return StationDocumentEditKind.Structural;
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var module = delta.ChangedModules[i];
                var old = before.Index.GetModule(module.Id);
                StationEditTrace.AddScanned(1);
                if (old != null &&
                    string.Equals(old.Type, "exit", StringComparison.Ordinal) &&
                    string.Equals(module.Type, "exit", StringComparison.Ordinal) &&
                    SameExitExceptSettings(old.RawJson, module.RawJson)) {
                    continue;
                }
                if (!IsSimInertDecorModule(module) || (old != null && !IsSimInertDecorModule(old))) return StationDocumentEditKind.Structural;
            }
            if (delta.RemovedCells.Count > 0) return StationDocumentEditKind.Structural;
            for (int i = 0; i < delta.ChangedCells.Count; i++) {
                var nextCell = delta.ChangedCells[i];
                var oldCell = before.Index.GetCell(nextCell.Key);
                StationEditTrace.AddScanned(1);
                if (oldCell == null || !IsCellChangeCosmetic(oldCell, nextCell)) return StationDocumentEditKind.Structural;
            }
            before.Index.GetGroundWindow(out var x0, out var y0, out var x1, out var y1);
            after.Index.GetGroundWindow(out var nx0, out var ny0, out var nx1, out var ny1);
            return x0 == nx0 && y0 == ny0 && x1 == nx1 && y1 == ny1
                ? StationDocumentEditKind.Cosmetic : StationDocumentEditKind.Structural;
        }

        public static StationDocumentEditKind Classify(StationDocument before, StationDocument after) =>
            ClassifyCore(before, after, before != null && after != null && SameExtraRootMetadata(before, after));

        static bool SameExtraRootMetadata(StationDocument before, StationDocument after) {
            if (before.RawRootJson != null && after.RawRootJson != null) {
                if (string.Equals(before.RawRootJson, after.RawRootJson, StringComparison.Ordinal)) return true;
                return SameExtraRootFields(before.RawRootJson, after.RawRootJson);
            }
            return SameExtraRootFields(before.NormalizedJson, after.NormalizedJson);
        }

        static StationDocumentEditKind ClassifyCore(StationDocument before, StationDocument after, bool extraRootsEqual) {
            if (before == null || after == null) return StationDocumentEditKind.Structural;
            if (before.Seed != after.Seed ||
                before.LevelBase != after.LevelBase ||
                before.StoreyHeight != after.StoreyHeight ||
                !string.Equals(before.City, after.City, StringComparison.Ordinal)) {
                return StationDocumentEditKind.Structural;
            }
            if (!extraRootsEqual) {
                return StationDocumentEditKind.Structural;
            }

            var beforeDay = StationSessionProjection.Day(before.Day);
            var afterDay = StationSessionProjection.Day(after.Day);
            bool dayChanged = !DayEquals(beforeDay, afterDay);

            bool cellsExact = SameCellsExact(before.Cells, after.Cells);
            bool cellsCosmetic = cellsExact || (!dayChanged && SameCellsCosmetic(before.Cells, after.Cells));
            if (!cellsCosmetic) return StationDocumentEditKind.Structural;

            bool linesExact = SameLinesExact(before.Lines, after.Lines);
            bool linesCosmetic = linesExact || SameLinesPresentationOnly(before.Lines, after.Lines);
            if (!linesCosmetic) return StationDocumentEditKind.Structural;

            bool modulesExact = SameModulesExact(before.Modules, after.Modules);
            bool modulesExitLabelsOnly = modulesExact || SameModulesExitNamesOnly(before.Modules, after.Modules);
            bool modulesInertOnly = false;
            if (!modulesExitLabelsOnly && !dayChanged && cellsExact && linesExact &&
                string.Equals(before.Name, after.Name, StringComparison.Ordinal) &&
                string.Equals(before.NameEn, after.NameEn, StringComparison.Ordinal)) {
                modulesInertOnly = IsSimInertModuleEdit(before, after);
            }
            if (!modulesExitLabelsOnly && !modulesInertOnly) {
                return StationDocumentEditKind.Structural;
            }

            if (dayChanged) {
                return cellsExact && modulesExitLabelsOnly
                    ? StationDocumentEditKind.DayOnly
                    : StationDocumentEditKind.Structural;
            }
            return StationDocumentEditKind.Cosmetic;
        }

        static bool SameExtraRootFields(string beforeJson, string afterJson) {
            if (string.Equals(beforeJson, afterJson, StringComparison.Ordinal)) return true;
            try {
                var a = string.IsNullOrEmpty(beforeJson) ? new JObject() : JObject.Parse(beforeJson);
                var b = string.IsNullOrEmpty(afterJson) ? new JObject() : JObject.Parse(afterJson);
                return SameExtraRootTrees(a, b);
            } catch (Exception) {
                return false;
            }
        }

        static bool SameExtraRootTrees(JObject a, JObject b) {
            if (a == null || b == null) return false;
            foreach (var prop in a.Properties()) {
                if (KnownRootKeys.Contains(prop.Name)) continue;
                if (!JToken.DeepEquals(prop.Value, b[prop.Name])) return false;
            }
            foreach (var prop in b.Properties()) {
                if (KnownRootKeys.Contains(prop.Name)) continue;
                if (!JToken.DeepEquals(a[prop.Name], prop.Value)) return false;
            }
            return true;
        }

        static bool DayEquals(StationDayData a, StationDayData b) {
            if (a.Service.From != b.Service.From || a.Service.To != b.Service.To) return false;
            if (a.Peaks.Early.From != b.Peaks.Early.From || a.Peaks.Early.To != b.Peaks.Early.To) return false;
            if (a.Peaks.Late.From != b.Peaks.Late.From || a.Peaks.Late.To != b.Peaks.Late.To) return false;
            if (a.Demand.Workday.AmPeak != b.Demand.Workday.AmPeak ||
                a.Demand.Workday.PmPeak != b.Demand.Workday.PmPeak ||
                a.Demand.Workday.Sharpness != b.Demand.Workday.Sharpness) return false;
            if (a.Demand.Offday.AmPeak != b.Demand.Offday.AmPeak ||
                a.Demand.Offday.PmPeak != b.Demand.Offday.PmPeak ||
                a.Demand.Offday.Sharpness != b.Demand.Offday.Sharpness) return false;
            if (a.Calendar.Epoch != b.Calendar.Epoch) return false;
            var ha = a.Calendar.Holidays ?? Array.Empty<string>();
            var hb = b.Calendar.Holidays ?? Array.Empty<string>();
            if (ha.Length != hb.Length) return false;
            for (int i = 0; i < ha.Length; i++) {
                if (!string.Equals(ha[i], hb[i], StringComparison.Ordinal)) return false;
            }
            return true;
        }

        static bool SameCellsExact(IReadOnlyList<StationCellRecord> a, IReadOnlyList<StationCellRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                if (!SameCellExact(a[i], b[i])) return false;
            }
            return true;
        }

        static bool SameCellExact(StationCellRecord a, StationCellRecord b) {
            if (ReferenceEquals(a, b)) return true;
            if (a.X != b.X || a.Y != b.Y || a.Z != b.Z) return false;
            if (!string.Equals(a.Shape, b.Shape, StringComparison.Ordinal)) return false;
            if (!string.Equals(a.Fill, b.Fill, StringComparison.Ordinal)) return false;
            if (!string.Equals(a.Zone, b.Zone, StringComparison.Ordinal)) return false;
            if (!string.Equals(a.Room, b.Room, StringComparison.Ordinal)) return false;
            if (!SameStringList(a.Tags, b.Tags)) return false;
            if (a.Finish.Count != b.Finish.Count) return false;
            foreach (var kv in a.Finish) {
                if (!b.Finish.TryGetValue(kv.Key, out string bv) || !string.Equals(kv.Value, bv, StringComparison.Ordinal)) {
                    return false;
                }
            }
            if (!string.Equals(a.RawJson, b.RawJson, StringComparison.Ordinal)) {
                return SameJsonExcept(a.RawJson, b.RawJson, null);
            }
            return true;
        }

        static bool SameCellsCosmetic(IReadOnlyList<StationCellRecord> a, IReadOnlyList<StationCellRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                if (!IsCellChangeCosmetic(a[i], b[i])) return false;
            }
            return true;
        }

        static bool IsCellChangeCosmetic(StationCellRecord oldCell, StationCellRecord nextCell) {
            if (SameCellExact(oldCell, nextCell)) return true;
            if (oldCell.X != nextCell.X || oldCell.Y != nextCell.Y || oldCell.Z != nextCell.Z) return false;
            if (!string.Equals(oldCell.Shape, nextCell.Shape, StringComparison.Ordinal)) return false;
            if (!string.Equals(oldCell.Fill, nextCell.Fill, StringComparison.Ordinal)) return false;
            if (!string.Equals(oldCell.Zone, nextCell.Zone, StringComparison.Ordinal)) return false;
            if (!string.Equals(oldCell.Room, nextCell.Room, StringComparison.Ordinal)) return false;
            if (!SameStringList(oldCell.Tags, nextCell.Tags)) return false;
            if (!SameJsonExcept(oldCell.RawJson, nextCell.RawJson, new HashSet<string>(StringComparer.Ordinal) { "finish" })) {
                return false;
            }
            string oldTop = string.IsNullOrEmpty(oldCell.FinishTop) ? "floor.concrete" : oldCell.FinishTop;
            string nextTop = string.IsNullOrEmpty(nextCell.FinishTop) ? "floor.concrete" : nextCell.FinishTop;
            string oldBase = StationSessionProjection.BaseFinishId(oldTop);
            string nextBase = StationSessionProjection.BaseFinishId(nextTop);
            if (!StationSessionProjection.IsKnownStockFinish(oldBase) ||
                !StationSessionProjection.IsKnownStockFinish(nextBase)) {
                if (!string.Equals(oldTop, nextTop, StringComparison.Ordinal)) return false;
            }
            StationSessionProjection.TopFinishBehaviour(oldTop, out double oldSpeed, out bool oldCover, out bool oldTrack);
            StationSessionProjection.TopFinishBehaviour(nextTop, out double nextSpeed, out bool nextCover, out bool nextTrack);
            return oldSpeed == nextSpeed && oldCover == nextCover && oldTrack == nextTrack;
        }

        static bool SameLinesExact(IReadOnlyList<StationLineRecord> a, IReadOnlyList<StationLineRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                if (!string.Equals(a[i].RawJson, b[i].RawJson, StringComparison.Ordinal) &&
                    !SameJsonExcept(a[i].RawJson, b[i].RawJson, null)) {
                    return false;
                }
            }
            return true;
        }

        static bool SameLinesPresentationOnly(IReadOnlyList<StationLineRecord> a, IReadOnlyList<StationLineRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                var la = a[i];
                var lb = b[i];
                if (!string.Equals(la.Id, lb.Id, StringComparison.Ordinal)) return false;
                if (!string.Equals(la.Stock, lb.Stock, StringComparison.Ordinal)) return false;
                if (la.Cars != lb.Cars) return false;
                if (!string.Equals(la.Power, lb.Power, StringComparison.Ordinal)) return false;
                if (!string.Equals(la.Psd, lb.Psd, StringComparison.Ordinal)) return false;
                if (!string.Equals(la.Direction, lb.Direction, StringComparison.Ordinal)) return false;
                if (!SameJsonExcept(la.RawJson, lb.RawJson, CosmeticLineKeys)) return false;
            }
            return true;
        }

        static bool SameModulesExact(IReadOnlyList<StationModuleRecord> a, IReadOnlyList<StationModuleRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                if (!SameModuleExact(a[i], b[i])) return false;
            }
            return true;
        }

        static bool SameModuleExact(StationModuleRecord a, StationModuleRecord b) {
            if (ReferenceEquals(a, b)) return true;
            if (!string.Equals(a.Id, b.Id, StringComparison.Ordinal)) return false;
            if (!string.Equals(a.Type, b.Type, StringComparison.Ordinal)) return false;
            if (a.X != b.X || a.Y != b.Y || a.Z != b.Z || a.ExactZ != b.ExactZ) return false;
            if (a.Rotation != b.Rotation || a.Width != b.Width || a.Depth != b.Depth || a.Height != b.Height) return false;
            if (a.CeilingAnchored != b.CeilingAnchored) return false;
            if (a.From != b.From || a.To != b.To) return false;
            if (!SameStringList(a.Tags, b.Tags)) return false;
            if (!string.Equals(a.RawJson, b.RawJson, StringComparison.Ordinal)) {
                return SameJsonExcept(a.RawJson, b.RawJson, null);
            }
            return true;
        }

        static bool SameModulesExitNamesOnly(IReadOnlyList<StationModuleRecord> a, IReadOnlyList<StationModuleRecord> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                var ma = a[i];
                var mb = b[i];
                if (SameModuleExact(ma, mb)) continue;
                if (!string.Equals(ma.Type, "exit", StringComparison.Ordinal) ||
                    !string.Equals(mb.Type, "exit", StringComparison.Ordinal)) {
                    return false;
                }
                if (!SameExitExceptSettings(ma.RawJson, mb.RawJson)) return false;
            }
            return true;
        }

        internal static bool SameExitExceptSettings(string beforeRaw, string afterRaw, bool allowName = true) {
            try {
                var a = JObject.Parse(beforeRaw);
                var b = JObject.Parse(afterRaw);
                var cfgA = a["cfg"] as JObject != null ? (JObject)a["cfg"].DeepClone() : new JObject();
                var cfgB = b["cfg"] as JObject != null ? (JObject)b["cfg"].DeepClone() : new JObject();
                if (allowName) {
                    cfgA.Remove("name");
                    cfgB.Remove("name");
                }
                cfgA.Remove("inRate");
                cfgB.Remove("inRate");
                cfgA.Remove("open");
                cfgB.Remove("open");
                var rootA = (JObject)a.DeepClone();
                var rootB = (JObject)b.DeepClone();
                rootA["cfg"] = cfgA;
                rootB["cfg"] = cfgB;
                return JToken.DeepEquals(rootA, rootB);
            } catch (Exception) {
                return false;
            }
        }

        static bool IsSimInertModuleEdit(StationDocument before, StationDocument after) {
            var afterById = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            for (int i = 0; i < after.Modules.Count; i++) {
                var mod = after.Modules[i];
                if (string.IsNullOrEmpty(mod.Id) || afterById.ContainsKey(mod.Id)) return false;
                afterById[mod.Id] = mod;
            }
            bool changed = false;
            for (int i = 0; i < before.Modules.Count; i++) {
                var oldMod = before.Modules[i];
                if (!afterById.TryGetValue(oldMod.Id, out StationModuleRecord nextMod)) {
                    if (!IsSimInertDecorModule(oldMod)) return false;
                    changed = true;
                    continue;
                }
                afterById.Remove(nextMod.Id);
                if (SameModuleExact(oldMod, nextMod)) continue;
                if (!IsSimInertDecorModule(oldMod) || !IsSimInertDecorModule(nextMod)) return false;
                changed = true;
            }
            foreach (var added in afterById.Values) {
                if (!IsSimInertDecorModule(added)) return false;
                changed = true;
            }
            if (!changed) return true;
            GroundWindow(before, out int bx0, out int by0, out int bx1, out int by1);
            GroundWindow(after, out int ax0, out int ay0, out int ax1, out int ay1);
            return bx0 == ax0 && by0 == ay0 && bx1 == ax1 && by1 == ay1;
        }

        internal static void GroundWindow(StationDocument doc, out int x0, out int y0, out int x1, out int y1) {
            x0 = int.MaxValue; y0 = int.MaxValue; x1 = int.MinValue; y1 = int.MinValue;
            int ex0 = x0, ey0 = y0, ex1 = x1, ey1 = y1;
            void Eat(int x, int y) {
                if (x < ex0) ex0 = x;
                if (y < ey0) ey0 = y;
                if (x > ex1) ex1 = x;
                if (y > ey1) ey1 = y;
            }
            for (int i = 0; i < doc.Cells.Count; i++) Eat(doc.Cells[i].X, doc.Cells[i].Y);
            for (int i = 0; i < doc.Modules.Count; i++) {
                var m = doc.Modules[i];
                Eat(m.X, m.Y);
                if (string.Equals(m.Type, "road", StringComparison.Ordinal)) {
                    Eat(m.X + Math.Max(1, m.Width) - 1, m.Y + Math.Max(1, m.Depth) - 1);
                }
                if (m.HasFrom && m.HasTo) {
                    Eat((int)Math.Round(m.From.Value.X), (int)Math.Round(m.From.Value.Y));
                    Eat((int)Math.Round(m.To.Value.X), (int)Math.Round(m.To.Value.Y));
                }
            }
            if (ex0 == int.MaxValue) { ex0 = ex1 = ey0 = ey1 = 0; }
            x0 = ex0; y0 = ey0; x1 = ex1; y1 = ey1;
        }

        static bool SameJsonExcept(string beforeRaw, string afterRaw, HashSet<string> ignoredKeys) {
            if (string.IsNullOrEmpty(beforeRaw) || string.IsNullOrEmpty(afterRaw)) return false;
            try {
                var a = JObject.Parse(beforeRaw);
                var b = JObject.Parse(afterRaw);
                if (ignoredKeys != null) {
                    foreach (string key in ignoredKeys) {
                        a.Remove(key);
                        b.Remove(key);
                    }
                }
                return JToken.DeepEquals(a, b);
            } catch (Exception) {
                return false;
            }
        }

        static bool SameStringList(IReadOnlyList<string> a, IReadOnlyList<string> b) {
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            }
            return true;
        }
    }
}
