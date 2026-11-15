using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Metro.App.Views;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>One rendered module, an actual Zoo binding row: view, provenance, placement, motion.</summary>
    public sealed class StationBindingRow {
        /// <summary>`module` or `train` (the one non-module row family).</summary>
        public string Kind = "module";
        public string Id = "";
        public string Type = "";
        /// <summary>The report family bucket (`stairs`, `escalators`, `psd`, `other`, …).</summary>
        public string Family = "";
        /// <summary>`cfg.mount`, or empty when the record names none.</summary>
        public string Mount = "";
        public int LevelMin, LevelMax;
        /// <summary>The key `ModuleViews.Resolve` chose for the record.</summary>
        public string ResolutionKey = "";
        /// <summary>`asset:&lt;path&gt;`, `dimensioned:&lt;inputs&gt;`, `generated:&lt;key&gt;` or empty.</summary>
        public string Provenance = "";
        /// <summary>The family builder and variant that actually took the module.</summary>
        public string RendererPath = "";
        /// <summary>Unity placement: `(x,y,z) yaw=deg rot=n`.</summary>
        public string Placement = "";
        /// <summary>`bound:&lt;channel&gt;`, `static:source`, `unbound` or `none`.</summary>
        public string Motion = "";
        public string MotionDetail = "";
        /// <summary>`bound`, `fallback` or `no-view: &lt;reason&gt;`.</summary>
        public string Status = "";
        /// <summary>True when the module has a live view in the committed world.</summary>
        public bool Drawn;
        /// <summary>The dispatch actually drove this binding from a frame or a direct opening state.</summary>
        public bool Applied;
        /// <summary>Metres of leaf/cabin travel plus hinge degrees measured on the transforms.</summary>
        public float Moved;
        /// <summary>
        /// False for a moving family whose authored variant has nothing to move (a fare
        /// gate whose lane is a fixed fence panel: `gateHasLane` is false, so it has no
        /// leaves). Such a row is bound and correctly immobile.
        /// </summary>
        public bool Movable = true;
        public string Note = "";

        public bool IsFallback => string.Equals(Status, "fallback", StringComparison.Ordinal);
        public bool IsNoView => Status != null && Status.StartsWith("no-view", StringComparison.Ordinal);
        public bool IsBound => string.Equals(Status, "bound", StringComparison.Ordinal);

        public const string CsvHeader =
            "kind,moduleId,type,family,mount,levelMin,levelMax,resolutionKey,provenance,rendererPath,placement,motion,motionDetail,status,movedMeters,note";

        public string ToCsv() {
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            text.Append(Kind).Append(',');
            text.Append(Escape(Id)).Append(',');
            text.Append(Escape(Type)).Append(',');
            text.Append(Escape(Family)).Append(',');
            text.Append(Escape(Mount)).Append(',');
            text.Append(LevelMin.ToString(id)).Append(',');
            text.Append(LevelMax.ToString(id)).Append(',');
            text.Append(Escape(ResolutionKey)).Append(',');
            text.Append(Escape(Provenance)).Append(',');
            text.Append(Escape(RendererPath)).Append(',');
            text.Append(Escape(Placement)).Append(',');
            text.Append(Escape(Motion)).Append(',');
            text.Append(Escape(MotionDetail)).Append(',');
            text.Append(Escape(Status)).Append(',');
            text.Append(Moved.ToString("0.###", id)).Append(',');
            text.Append(Escape(Note));
            return text.ToString();
        }

        /// <summary>CSV-escape one field: quote when it carries a comma, quote or newline.</summary>
        public static string Escape(string value) {
            var text = value ?? "";
            if (text.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0) return text;
            return "\"" + text.Replace("\"", "\"\"") + "\"";
        }

        public override string ToString() => Kind + " " + Id + " " + Type + " " + Status + " " + Motion;
    }

    /// <summary>Per-family counts and the verdict for one family bucket.</summary>
    public sealed class StationBindingFamily {
        public string Family = "";
        /// <summary>The brief's named families: a row may not be a fallback and a moving row must be bound.</summary>
        public bool Gated;
        public bool Moving;
        public int Rows, Bound, Fallback, NoView, Deliberate, Static, PendingFeed;
        public int MovingRows, Unbound, Applied, Immovable;
        public int Moved;
        public bool ViewsPass, BindingPass;
        public string Verdict = "";
        public override string ToString() =>
            Family + " rows=" + Rows + " bound=" + Bound + " fallback=" + Fallback + " no-view=" + NoView +
            " moving=" + MovingRows + " unbound=" + Unbound + " moved=" + Moved + " -> " + Verdict;
    }

    /// <summary>One consist's door-bank binding, measured independently of a module row.</summary>
    public sealed class StationTrainBindingRow {
        public string Id = "";
        public string LineId = "", TrackId = "";
        public string FormationKey = "", PrefabPath = "";
        public string Rig = "";
        /// <summary>`bound`, `no-view: …` — what the built world actually draws.</summary>
        public string Status = "";
        public string Motion = "";
        /// <summary>True when the committed world has a consist view for this id.</summary>
        public bool Drawn;
        /// <summary>The renderer that drew it (`trains:TrainConsistRenderer`), or the gap.</summary>
        public string RendererPath = "";
        /// <summary>Consist-origin placement in document axes.</summary>
        public string Placement = "";
        public bool Applied;
        public float Moved;
        public float Door;
        public string Note = "";
    }

    /// <summary>
    /// Plan 11 B4: the per-module binding report of one **actual** Zoo load. It walks
    /// the committed document in order and answers, for every saved module id: which
    /// resolution key was chosen, what the prefab/part provenance is, which family
    /// builder (and which variant) actually took it, where it was placed in Unity, and
    /// whether its motion channel is bound and driven.
    ///
    /// Three statuses, never two:
    /// <list type="bullet">
    /// <item><c>bound</c> — the world has a live view for the module;</item>
    /// <item><c>fallback</c> — a renderer owns the type and reported an unresolved
    /// diagnostic for it (or silently produced nothing), which is the failure signal
    /// <see cref="StationWorldView.ReportUnresolved"/> exists for;</item>
    /// <item><c>no-view: &lt;reason&gt;</c> — the module draws nothing, split into
    /// <c>deliberate:</c> (the design does not draw it, e.g. the second half of a 电视
    /// pair) and <c>no-renderer:</c> (no registered renderer claims the type — a gap,
    /// reported by name rather than hidden as a fallback).</item>
    /// </list>
    ///
    /// Motion is proven from the objects, not from a counter: the report builds one
    /// <see cref="ModuleMotionDispatch"/> over the world's own views, replays the
    /// frames the real <see cref="StationSimulationSession"/> publishes for the
    /// committed document (40 fixed ticks from the 06:30 boot), and records how far
    /// each binding's first moving part actually travelled. A family with no published
    /// channel yet (a gate, a swing door) is driven through its own module state and
    /// labelled <c>pending-crowd</c>, never called bound on the strength of a bool.
    /// </summary>
    public sealed class StationBindingReport {
        public string DemoId = "";
        public string DocumentName = "";
        public string SourceHash = "";
        public int Cells, Modules, Lines;
        public int FrameTicks;
        public double SimSeconds;
        public string FrameSource = "";
        public string GeneratedAt = "";
        public StationBindingStatusCounts Status = new StationBindingStatusCounts();
        public readonly List<StationBindingRow> Rows = new List<StationBindingRow>();
        public readonly List<StationBindingFamily> Families = new List<StationBindingFamily>();
        public readonly List<StationTrainBindingRow> Trains = new List<StationTrainBindingRow>();
        public readonly List<string> Reasons = new List<string>();
        public bool Passed;
        public string Verdict = "";

        readonly List<GameObject> transient = new List<GameObject>();

        /// <summary>The families the brief names: each must be fully drawn and, when moving, bound.</summary>
        public static readonly string[] NamedFamilies = {
            "stairs", "escalators", "walkways", "lifts", "fences", "trees", "psd", "gates", "doors", "train-doors",
        };

        /// <summary>Bucket every saved module type into one report family.</summary>
        public static string FamilyOf(string type) {
            switch (type) {
                case "stair": return "stairs";
                case "escalator": return "escalators";
                case "walkway": return "walkways";
                case "lift": return "lifts";
                case "fence": return "fences";
                case "tree": return "trees";
                case "platform-edge":
                case "psd-end": return "psd";
                case "gate": return "gates";
                case "door":
                case "cubicle": return "doors";
                case "sign": return "signs";
                case "road": return "roads";
                default: return "other";
            }
        }

        /// <summary>True when the source animates this saved type (`unity/plan/motion-inventory.md`).</summary>
        public static bool IsMovingType(string type) {
            switch (type) {
                case "escalator":
                case "walkway":
                case "lift":
                case "platform-edge":
                case "gate":
                case "door":
                case "cubicle": return true;
                default: return false;
            }
        }

        static bool IsGated(string family) => Array.IndexOf(NamedFamilies, family) >= 0;
        static bool IsMovingFamily(string family) {
            switch (family) {
                case "escalators":
                case "walkways":
                case "lifts":
                case "psd":
                case "gates":
                case "doors":
                case "train-doors": return true;
                default: return false;
            }
        }

        public int Fallbacks {
            get {
                int count = 0;
                for (int i = 0; i < Rows.Count; i++) if (Rows[i].IsFallback) count++;
                return count;
            }
        }

        /// <summary>
        /// Build the report from a built world. The world must be the **committed** one
        /// (the actual load); the report never fabricates a view, a prefab or a path.
        /// </summary>
        public static StationBindingReport Build(string demoId, StationWorldView world,
            IReadOnlyList<IStationViewRenderer> renderers, RuntimeCatalogue catalogue, TrainCatalogue trains,
            int frameTicks = 40) {
            if (world == null) throw new ArgumentNullException(nameof(world));
            var document = world.Document;
            if (document == null) throw new ArgumentNullException(nameof(world), "the world has no committed document");
            var report = new StationBindingReport {
                DemoId = demoId ?? "",
                DocumentName = document.Name,
                SourceHash = document.Source.Hash,
                Cells = document.CellCount, Modules = document.ModuleCount, Lines = document.LineCount,
                GeneratedAt = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            };

            // What the world actually registered, and what it refused.
            var drawn = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int i = 0; i < world.Records.Count; i++) {
                var record = world.Records[i];
                if (record == null || record.View == null) continue;
                if (record.ModuleId.Length > 0) {
                    if (!drawn.ContainsKey(record.ModuleId)) drawn[record.ModuleId] = record.Role;
                    continue;
                }
                // A combined batch owns one transform for many authored modules; the
                // contributing ids it registered are what proves they were drawn.
                if (record.SourceIds == null) continue;
                for (int id = 0; id < record.SourceIds.Length; id++) {
                    var moduleId = record.SourceIds[id];
                    if (!string.IsNullOrEmpty(moduleId) && !drawn.ContainsKey(moduleId)) drawn[moduleId] = record.Role;
                }
            }
            var diagnostics = new Dictionary<string, StationDiagnostic>(StringComparer.Ordinal);
            for (int i = 0; i < world.Unresolved.Count; i++) {
                var diagnostic = world.Unresolved[i];
                if (diagnostic == null || string.IsNullOrEmpty(diagnostic.RecordId)) continue;
                if (!diagnostics.ContainsKey(diagnostic.RecordId)) diagnostics[diagnostic.RecordId] = diagnostic;
            }

            var verticalRenderer = Find<VerticalModuleRenderer>(renderers);
            var openingRenderer = Find<OpeningModuleRenderer>(renderers);
            var verticalViews = new Dictionary<string, VerticalModuleView>(StringComparer.Ordinal);
            if (verticalRenderer != null) {
                var views = verticalRenderer.Views;
                for (int i = 0; i < views.Count; i++) {
                    var view = views[i];
                    if (view != null && !string.IsNullOrEmpty(view.ModuleId)) verticalViews[view.ModuleId] = view;
                }
            }
            var openingViews = new Dictionary<string, OpeningView>(StringComparer.Ordinal);
            if (openingRenderer != null) {
                foreach (var view in openingRenderer.Views.Views) {
                    if (view != null && !string.IsNullOrEmpty(view.ModuleId)) openingViews[view.ModuleId] = view;
                }
            }

            // A previous world's Release() clears the shared opening renderer's view set, so
            // a re-opened station can have live opening GameObjects the renderer no longer
            // lists. Name that instead of reporting a silent per-module gap.
            bool openingsLost = openingRenderer != null && openingRenderer.Views.Count == 0 && HasRole(drawn, "openings");
            var dispatch = new ModuleMotionDispatch();
            foreach (var view in verticalViews.Values) dispatch.Bind(view);
            foreach (var view in openingViews.Values) dispatch.Bind(view);

            // Replay the real session's frames over the committed document. Nothing here
            // reads a clock: one frame is one simulated second, exactly like the player.
            report.FrameSource = "StationSimulationSession from boot " +
                StationClock.ReferenceBootSeconds.ToString("0", CultureInfo.InvariantCulture) +
                "s, " + frameTicks + " fixed ticks";
            StationMotionFrame finalFrame = default;
            StationSimulationSession session = null;
            // The rolling-stock family's own view: a train row is `bound` only when the
            // committed world really holds the consist (the same `trains` role the
            // player registers), never on the strength of a transient rig.
            var trainRenderer = Find<TrainConsistRenderer>(renderers);
            try {
                session = new StationSimulationSession(StationSessionProjection.Setup(document, world.Index, "binding:" + report.SourceHash));
                session.SeekToSimTime(StationClock.ReferenceBootSeconds);
                session.Restart();
                session.SetPlaying(true);
                // One controlled gate case: queue entry riders at the first working lane so
                // the replay proves the service's own published lane cycle moves a gate,
                // instead of depending on a chance walk from an entrance within 40 ticks.
                SeedGateForReport(report, session, openingViews);
                bool trainsBound = false;
                for (int tick = 0; tick < Mathf.Max(1, frameTicks); tick++) {
                    if (session.Advance(1.0) != 1) break;
                    finalFrame = session.Snapshot();
                    if (!trainsBound) {
                        trainsBound = true;
                        report.BindTrains(finalFrame, document, trains, dispatch, trainRenderer);
                    }
                    dispatch.Apply(finalFrame);
                    report.FrameTicks++;
                }
                session.SetPlaying(false);
                if (report.FrameTicks == 0) {
                    finalFrame = session.Snapshot();
                    report.BindTrains(finalFrame, document, trains, dispatch, trainRenderer);
                    dispatch.Apply(finalFrame);
                }
            } finally {
                session?.SetPlaying(false);
            }
            report.SimSeconds = finalFrame.Clock.SimTimeSeconds;

            // The families with no published channel yet are proven through their own
            // module state: drive the bound leaves, measure, and put them back.
            report.ProbePendingOpenings(dispatch, openingViews);
            // A swing door answers the crowd's own proximity rule. The natural 40-tick
            // replay may keep every body away from a room door, so the report drives one
            // controlled published passenger frame at the first movable hinge.
            report.ProbeSwingDoor(dispatch, openingViews, finalFrame);

            var factsArray = new ModuleFacts[document.Modules.Count];
            for (int i = 0; i < factsArray.Length; i++) factsArray[i] = document.Modules[i].Facts;
            for (int i = 0; i < document.Modules.Count; i++) {
                report.Rows.Add(report.BuildRow(document.Modules[i], factsArray, catalogue, drawn, diagnostics,
                    verticalViews, openingViews, dispatch, openingsLost));
            }
            for (int i = 0; i < report.Trains.Count; i++) report.Rows.Add(report.TrainRow(report.Trains[i], dispatch));

            report.Summarise();
            return report;
        }

        /// <summary>
        /// The report's one controlled gate case. It queues three entry riders at the first
        /// gate whose drawn view really has a lane, so the published gate leaf curve has
        /// something to open for and the probe measures a real wing travel. The seeding is
        /// named in the frame source; nothing is written to the document.
        /// </summary>
        static void SeedGateForReport(StationBindingReport report, StationSimulationSession session,
            Dictionary<string, OpeningView> views) {
            if (report == null || session == null || views == null) return;
            var gates = session.GateFrames();
            for (int i = 0; i < gates.Length; i++) {
                if (!views.TryGetValue(gates[i].Id, out var view) || view == null || !view.Movable) continue;
                int seeded = session.Services.SeedGateRiders(gates[i].Id, 3);
                if (seeded <= 0) continue;
                report.FrameSource += "; " + seeded + " entry riders seeded at gate " + gates[i].Id;
                return;
            }
        }

        /// <summary>
        /// One controlled swing-door case: a published walking passenger at the first
        /// movable hinge's own document position must turn that door's leaves. It uses the
        /// frame channel the player uses (<see cref="StationMotionFrame.Passengers"/>), not
        /// the direct module seam, so the row's `frame.Passengers` label is real.
        /// </summary>
        void ProbeSwingDoor(ModuleMotionDispatch dispatch, Dictionary<string, OpeningView> openings,
            StationMotionFrame frame) {
            if (dispatch == null || openings == null) return;
            foreach (var view in openings.Values) {
                if (view == null || !view.Movable || view.Holder == null) continue;
                if (view.Kind != OpeningKind.SwingDoor && view.Kind != OpeningKind.Cubicle) continue;
                var at = StationCoordinates.WorldToDocument(view.Holder.position);
                var probe = frame;
                probe.Clock.Tick = frame.Clock.Tick + 1;
                probe.Passengers = new[] {
                    new Metro.Sim.StationPassengerFrame {
                        SimId = 90001, X = at.x + .4, Y = at.y, Z = at.z,
                        State = Metro.Sim.StationPassengerState.Walking, Visible = true,
                    },
                };
                dispatch.Apply(probe, 1f);
                FrameSource += "; door proximity probe at " + view.ModuleId;
                return;
            }
        }

        /// <summary>Destroy the transient consist instances a report built to measure train doors.</summary>
        public void Dispose() {
            for (int i = 0; i < transient.Count; i++) {
                var instance = transient[i];
                if (!instance) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(instance);
                else UnityEngine.Object.DestroyImmediate(instance);
            }
            transient.Clear();
        }

        /* ------------------------------------------------------------- assembly */

        void BindTrains(StationMotionFrame frame, StationDocument document, TrainCatalogue trains,
            ModuleMotionDispatch dispatch, TrainConsistRenderer trainRenderer) {
            if (frame.Trains == null || frame.Trains.Length == 0) return;
            for (int i = 0; i < frame.Trains.Length; i++) {
                var train = frame.Trains[i];
                if (string.IsNullOrEmpty(train.Id)) continue;
                if (FindTrain(train.Id) != null) continue;
                var row = new StationTrainBindingRow { Id = train.Id, LineId = train.LineId, TrackId = train.TrackId };
                Trains.Add(row);
                var line = LineOf(document, train.LineId);
                if (line == null) { row.Status = "no-view: no-line"; continue; }
                if (trains == null) { row.Status = "no-view: no-train-catalogue"; row.Motion = "unbound"; continue; }
                row.FormationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, trains);
                if (!trains.TryGet(row.FormationKey, out var entry) || entry == null || entry.prefab == null) {
                    row.Status = "no-view: no-formation-prefab:" + row.FormationKey;
                    row.Motion = "unbound";
                    continue;
                }
                row.PrefabPath = entry.prefabPath ?? "";
                // The committed world's own consist is the only proof the family is
                // drawn: bind the rig the player can see, not a transient lookalike.
                if (trainRenderer != null && trainRenderer.TryGetConsist(train.Id, out var consist) && consist != null) {
                    row.Drawn = true;
                    row.RendererPath = "trains:TrainConsistRenderer";
                    row.Placement = TrainPlacement(consist);
                    if (consist.Rig == null) {
                        row.Status = "no-view: train-rig-missing";
                        row.Motion = "unbound";
                        continue;
                    }
                    row.Rig = consist.Rig.Describe();
                    if (!dispatch.BindTrain(train.Id, consist.Rig, consist.PlatformBank)) {
                        row.Status = "no-view: train-rig-unbound";
                        row.Motion = "unbound";
                        continue;
                    }
                    row.Status = "bound";
                    row.Motion = "bound:frame.Trains";
                    row.Note = "drawn by trains:TrainConsistRenderer, " + consist.Cars + " cars of " +
                        row.FormationKey + " at " + row.Placement;
                    continue;
                }
                // No consist view in the committed world. Measure the promoted rig
                // anyway, so the row can say the doors work while the view is missing.
                var transientConsist = UnityEngine.Object.Instantiate(entry.prefab);
                transientConsist.name = "binding " + train.Id;
                transient.Add(transientConsist);
                var rig = new TrainDoorRig(transientConsist, TrainDoorRig.ForLine(line.Stock, line.Cars, entry.bakedScale));
                row.Rig = rig.Describe();
                if (!dispatch.BindTrain(train.Id, rig, 1)) { row.Status = "no-view: train-rig-unbound"; row.Motion = "unbound"; continue; }
                row.Status = trainRenderer != null ? "no-view: train-consist-missing" : "no-view: no-rolling-stock-renderer";
                row.Motion = "bound:frame.Trains";
                row.Note = trainRenderer != null
                    ? "the trains renderer is installed but built no consist for this service"
                    : "TrainDoorRig built on the promoted formation; the generic player has no consist view (C3)";
            }
        }

        /// <summary>The consist origin in document axes, for the row's placement column.</summary>
        static string TrainPlacement(TrainConsistView consist) {
            var position = consist.DocumentPosition;
            return "(" + position.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                position.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                position.z.ToString("0.###", CultureInfo.InvariantCulture) + ") cars=" + consist.Cars;
        }

        StationTrainBindingRow FindTrain(string id) {
            for (int i = 0; i < Trains.Count; i++) if (string.Equals(Trains[i].Id, id, StringComparison.Ordinal)) return Trains[i];
            return null;
        }

        void ProbePendingOpenings(ModuleMotionDispatch dispatch, Dictionary<string, OpeningView> openings) {
            foreach (var view in openings.Values) {
                if (view == null || string.IsNullOrEmpty(view.ModuleId)) continue;
                if (dispatch.ChannelOf(view.ModuleId) != ModuleMotionChannel.PendingCrowd) continue;
                if (!view.Movable) continue;
                dispatch.ApplyOpening(view.ModuleId, 1f);
                dispatch.ApplyOpening(view.ModuleId, .5f);
                dispatch.ApplyOpening(view.ModuleId, 0f);
            }
        }

        StationBindingRow BuildRow(StationModuleRecord record, ModuleFacts[] facts, RuntimeCatalogue catalogue,
            Dictionary<string, string> drawn, Dictionary<string, StationDiagnostic> diagnostics,
            Dictionary<string, VerticalModuleView> verticalViews, Dictionary<string, OpeningView> openingViews,
            ModuleMotionDispatch dispatch, bool openingsLost) {
            var row = new StationBindingRow {
                Kind = "module",
                Id = record.Id,
                Type = record.Type,
                Family = FamilyOf(record.Type),
                Mount = record.Config.Text("mount"),
                LevelMin = LevelMin(record),
                LevelMax = LevelMax(record),
            };
            ModuleVisual visual = ModuleVisual.None;
            RuntimeCatalogue.Entry entry = null;
            if (catalogue != null) {
                visual = ModuleViews.Resolve(record.Facts, facts, catalogue);
                if (visual.Key.Length > 0) catalogue.TryGet(visual.Key, out entry);
            }
            row.ResolutionKey = visual.Key;
            var position = ModulePlacement.Position(record.Facts, entry);
            row.Placement = "(" + position.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                position.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
                position.z.ToString("0.###", CultureInfo.InvariantCulture) + ") yaw=" +
                ModulePlacement.Yaw(record.Rotation).ToString("0.###", CultureInfo.InvariantCulture) +
                " rot=" + record.Rotation.ToString(CultureInfo.InvariantCulture);

            bool hasDiagnostic = diagnostics.TryGetValue(record.Id, out var diagnostic);
            drawn.TryGetValue(record.Id, out var role);
            row.Drawn = !string.IsNullOrEmpty(role);

            verticalViews.TryGetValue(record.Id, out var vertical);
            openingViews.TryGetValue(record.Id, out var opening);
            row.Provenance = ProvenanceOf(record, visual, entry, vertical, opening, catalogue);
            row.RendererPath = RendererPathOf(role, vertical, opening);

            if (row.Drawn) {
                row.Status = "bound";
                // A renderer may register a view and still note a caveat on it (a hung sign's
                // ceiling anchor, a dimensioned assembly where a prefab was supplied). That is
                // not a fallback: the module is drawn, and the caveat rides the row's note.
                if (hasDiagnostic) row.Note = "caveat " + diagnostic.Code + ": " + diagnostic.Message;
            } else if (hasDiagnostic) {
                row.Status = "fallback";
                row.Note = diagnostic.Code + ": " + diagnostic.Message;
            } else if (vertical != null || opening != null) {
                // A built view that never reached the world's registry is still a silent drop.
                row.Status = "fallback";
                row.Note = "silent-drop: a view was built but not registered";
            } else if (visual.Kind == ModuleViewKind.None) {
                row.Status = "no-view: deliberate:" + (visual.Detail.Length > 0 ? visual.Detail : "none");
                row.Note = "the design does not draw this record (its partner does)";
            } else if (!OwnedByRenderer(record.Type)) {
                row.Status = "no-view: no-renderer:" + record.Type;
                row.Note = "no registered station renderer claims this type";
            } else {
                row.Status = "fallback";
                // A renderer may refuse a whole family for a missing scene asset (a shader, a
                // catalogue); name that reason instead of inventing a per-module one.
                var roleDiagnostic = RoleDiagnostic(diagnostics, record.Type);
                row.Note = roleDiagnostic != null
                    ? "owned-type-without-view: " + roleDiagnostic.Code + ": " + roleDiagnostic.Message
                    : "owned-type-without-view";
            }

            // Only an opening view that says it has no moving fitting makes a moving row
            // immovable. A row whose view object is unreachable is movable but unbound.
            row.Movable = !IsMovingType(record.Type) || opening == null || opening.Movable;
            MotionOf(record.Type, dispatch, record.Id, row);
            if (row.Motion == "unbound" && openingsLost && IsMovingType(record.Type))
                row.MotionDetail += " (the opening renderer's view registry is empty in this load — a previous " +
                    "world's Release() cleared it; plan 11 B3)";
            return row;
        }

        StationBindingRow TrainRow(StationTrainBindingRow train, ModuleMotionDispatch dispatch) {
            var probe = dispatch.Probe(train.Id);
            var row = new StationBindingRow {
                Kind = "train", Id = train.Id, Type = "train", Family = "train-doors",
                ResolutionKey = train.FormationKey,
                Provenance = string.IsNullOrEmpty(train.PrefabPath) ? "" : "asset:" + train.PrefabPath,
                RendererPath = string.IsNullOrEmpty(train.RendererPath)
                    ? "none:StationGame has no rolling-stock renderer"
                    : train.RendererPath,
                Placement = train.Placement ?? "",
                Status = train.Status,
                Motion = train.Motion,
                MotionDetail = train.Rig,
                Note = train.Note,
                Drawn = train.Drawn,
                Applied = probe.Applied > 0,
                Moved = probe.Moved,
            };
            if (row.Status.Length == 0) row.Status = row.Drawn ? "bound" : "no-view: no-rolling-stock-renderer";
            return row;
        }

        static void MotionOf(string type, ModuleMotionDispatch dispatch, string id, StationBindingRow row) {
            var probe = dispatch.Probe(id);
            row.Applied = probe.Applied > 0;
            row.Moved = probe.Moved;
            string channel = ChannelName(probe.Channel);
            if (!IsMovingType(type)) {
                row.Motion = IsStaticType(type) ? "static:source" : "none";
                row.MotionDetail = probe.Bound ? "bound:" + channel : "";
                return;
            }
            if (!probe.Bound) {
                row.Motion = "unbound";
                row.MotionDetail = "no target registered for this module id";
                return;
            }
            row.Motion = "bound:" + channel;
            row.MotionDetail = "applied=" + probe.Applied.ToString(CultureInfo.InvariantCulture) +
                " moved=" + probe.Moved.ToString("0.###", CultureInfo.InvariantCulture);
            if (probe.Channel == ModuleMotionChannel.PendingCrowd)
                row.MotionDetail += " (a legacy screen bank with no published platform id; driven through its own module state)";
        }

        /// <summary>Types the source never animates (`unity/plan/motion-inventory.md`).</summary>
        static bool IsStaticType(string type) {
            switch (type) {
                case "stair":
                case "fence":
                case "tree":
                case "psd-end": return true;
                default: return false;
            }
        }

        /// <summary>The renderer role that owns a type, for a family-level diagnostic lookup.</summary>
        static string RoleOf(string type) {
            switch (type) {
                case "tree":
                case "fence": return "modules";
                case "stair":
                case "escalator":
                case "walkway":
                case "lift": return "vertical";
                case "platform-edge":
                case "psd-end":
                case "gate":
                case "door":
                case "cubicle": return "openings";
                case "sign": return "signs";
                case "road": return "roads";
                default: return "";
            }
        }

        static StationDiagnostic RoleDiagnostic(Dictionary<string, StationDiagnostic> diagnostics, string type) {
            var role = RoleOf(type);
            if (role.Length == 0) return null;
            return diagnostics.TryGetValue(role, out var diagnostic) ? diagnostic : null;
        }

        static string ChannelName(ModuleMotionChannel channel) {
            switch (channel) {
                case ModuleMotionChannel.FrameEscalators: return "frame.Escalators";
                case ModuleMotionChannel.FrameLifts: return "frame.Lifts";
                case ModuleMotionChannel.FrameDoors: return "frame.Doors";
                case ModuleMotionChannel.FrameTrains: return "frame.Trains";
                case ModuleMotionChannel.FrameGates: return "frame.Gates";
                case ModuleMotionChannel.FrameCrowd: return "frame.Passengers";
                case ModuleMotionChannel.FrameClock: return "frame.Clock";
                case ModuleMotionChannel.PendingCrowd: return "pending-crowd";
                case ModuleMotionChannel.StaticSource: return "static";
                default: return "none";
            }
        }

        /// <summary>True when a registered family renderer claims this saved type.</summary>
        public static bool OwnedByRenderer(string type) {
            switch (type) {
                case "tree":
                case "fence": return true;
                case "stair":
                case "escalator":
                case "walkway":
                case "lift": return true;
                case "platform-edge":
                case "psd-end":
                case "gate":
                case "door":
                case "cubicle": return true;
                case "sign": return true;
                case "road": return true;
                default:
                    // Plan 13 §3: surfaces, street furniture, equipment and live displays
                    // are claimed by the four `StationModule*Renderer`s. Keep this in step
                    // with `StationModuleClaims.AllTypes` — the coverage gate fails on a
                    // type that has a renderer but is not listed here.
                    return Metro.App.Views.StationModuleClaims.Owns(type);
            }
        }

        static string RendererPathOf(string role, VerticalModuleView vertical, OpeningView opening) {
            if (!string.IsNullOrEmpty(role)) {
                switch (role) {
                    case "modules": return "modules:OutdoorModuleViews(prefab)";
                    case "vertical": return "vertical:VerticalModuleViews(" + (vertical != null && vertical.UsedPrefab ? "prefab:" + vertical.PrefabKey : "dimensioned") + ")";
                    case "openings": return "openings:OpeningModuleViews(" + (opening != null ? opening.Kind.ToString() : "opening") + ")";
                    case "signs": return "signs:StationSignView";
                    case "roads": return "roads:StationRoadView";
                    case "surfaces": return "surfaces:StationSurfaceModuleRenderer";
                    case "street": return "street:StationStreetModuleRenderer";
                    case "equipment": return "equipment:StationEquipmentModuleRenderer";
                    case "displays": return "displays:StationDisplayModuleRenderer";
                    default: return role + ":registered";
                }
            }
            if (vertical != null) return "vertical:VerticalModuleViews(" + (vertical.UsedPrefab ? "prefab" : "dimensioned") + "):unregistered";
            if (opening != null) return "openings:OpeningModuleViews(" + opening.Kind + "):unregistered";
            return "";
        }

        static string ProvenanceOf(StationModuleRecord record, ModuleVisual visual, RuntimeCatalogue.Entry entry,
            VerticalModuleView vertical, OpeningView opening, RuntimeCatalogue catalogue) {
            if (vertical != null) {
                if (vertical.UsedPrefab) {
                    var path = PrefabPath(catalogue, vertical.PrefabKey);
                    return path.Length > 0 ? "asset:" + path : "asset:key:" + vertical.PrefabKey;
                }
                return "dimensioned:" + VerticalInputs(vertical, record);
            }
            if (opening != null) {
                if (!string.IsNullOrEmpty(opening.PrefabPath)) return "asset:" + opening.PrefabPath;
                var text = new StringBuilder("dimensioned:");
                text.Append(opening.Kind.ToString());
                text.Append(" openings=").Append(opening.OpeningCount.ToString(CultureInfo.InvariantCulture));
                if (opening.Run != null) {
                    text.Append(" doorW=").Append(opening.Run.DoorWidth.ToString("0.###", CultureInfo.InvariantCulture));
                    text.Append(" travel=").Append(opening.Run.Travel.ToString("0.###", CultureInfo.InvariantCulture));
                }
                if (opening.Leaves.Count > 0) text.Append(" leaves=").Append(opening.Leaves.Count.ToString(CultureInfo.InvariantCulture));
                if (opening.AxisConvention.Length > 0) text.Append(" axis=").Append(opening.AxisConvention);
                return text.ToString();
            }
            if (entry != null && !string.IsNullOrEmpty(entry.prefabPath)) return "asset:" + entry.prefabPath;
            if (visual.Key.Length > 0) {
                switch (visual.Kind) {
                    case ModuleViewKind.Generated: return "generated:" + visual.Key;
                    case ModuleViewKind.Live: return "live:" + visual.Key;
                    case ModuleViewKind.None: return "none:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view");
                    default: return visual.Kind + ":" + visual.Key;
                }
            }
            return visual.Detail.Length > 0 ? "unresolved:" + visual.Detail : "";
        }

        static string PrefabPath(RuntimeCatalogue catalogue, string key) {
            if (catalogue == null || string.IsNullOrEmpty(key)) return "";
            return catalogue.TryGet(key, out var entry) && entry != null ? entry.prefabPath ?? "" : "";
        }

        /// <summary>The authored inputs a dimensioned assembly was built from.</summary>
        static string VerticalInputs(VerticalModuleView view, StationModuleRecord record) {
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            switch (view.Kind) {
                case VerticalModuleKind.Stair:
                    text.Append("stair");
                    break;
                case VerticalModuleKind.Escalator:
                case VerticalModuleKind.Walkway:
                    text.Append(view.Kind == VerticalModuleKind.Escalator ? "escalator" : "walkway");
                    if (view.Band != null) {
                        text.Append(" run=").Append(view.Band.AuthoredHorizontal.ToString("0.###", id));
                        text.Append(" rise=").Append(view.Band.AuthoredRise.ToString("0.###", id));
                        text.Append(" incline=").Append(view.Band.InclineDegrees.ToString("0.###", id));
                        text.Append(" chain=").Append(view.Band.ChainLength.ToString("0.###", id));
                        text.Append(" steps=").Append(view.Band.Count.ToString(id));
                    }
                    break;
                case VerticalModuleKind.Lift:
                    if (view.Lift != null) {
                        text.Append("lift");
                        text.Append(" height=").Append(view.Lift.Height.ToString("0.###", id));
                        text.Append(" stops=").Append(view.Lift.Stops.Count.ToString(id));
                        text.Append(" portals=").Append(view.PortalCount.ToString(id));
                    }
                    break;
            }
            if (record.HasFrom && record.HasTo) {
                text.Append(" from=").Append(record.From.Value.ToString());
                text.Append(" to=").Append(record.To.Value.ToString());
            }
            if (view.PrefabRejectReason.Length > 0) text.Append(" prefab-rejected=").Append(view.PrefabRejectReason);
            return text.ToString();
        }

        static int LevelMin(StationModuleRecord record) {
            int z = record.Z;
            if (record.HasFrom) z = Mathf.Min(z, Mathf.RoundToInt((float)record.From.Value.Z));
            if (record.HasTo) z = Mathf.Min(z, Mathf.RoundToInt((float)record.To.Value.Z));
            return z;
        }

        static int LevelMax(StationModuleRecord record) {
            int z = record.Z + Mathf.Max(1, record.Height) - 1;
            if (record.HasFrom) z = Mathf.Max(z, Mathf.RoundToInt((float)record.From.Value.Z));
            if (record.HasTo) z = Mathf.Max(z, Mathf.RoundToInt((float)record.To.Value.Z));
            return z;
        }

        static bool HasRole(Dictionary<string, string> drawn, string role) {
            foreach (var value in drawn.Values) if (string.Equals(value, role, StringComparison.Ordinal)) return true;
            return false;
        }

        static StationLineRecord LineOf(StationDocument document, string lineId) {
            if (document == null || string.IsNullOrEmpty(lineId)) return null;
            for (int i = 0; i < document.Lines.Count; i++)
                if (string.Equals(document.Lines[i].Id, lineId, StringComparison.Ordinal)) return document.Lines[i];
            return null;
        }

        static T Find<T>(IReadOnlyList<IStationViewRenderer> renderers) where T : class, IStationViewRenderer {
            if (renderers == null) return null;
            for (int i = 0; i < renderers.Count; i++) if (renderers[i] is T typed) return typed;
            return null;
        }

        /* ------------------------------------------------------------- verdicts */

        void Summarise() {
            var byFamily = new Dictionary<string, StationBindingFamily>(StringComparer.Ordinal);
            Status = new StationBindingStatusCounts();
            for (int i = 0; i < Rows.Count; i++) {
                var row = Rows[i];
                if (!byFamily.TryGetValue(row.Family, out var family)) {
                    byFamily[row.Family] = family = new StationBindingFamily {
                        Family = row.Family, Gated = IsGated(row.Family), Moving = IsMovingFamily(row.Family),
                    };
                }
                family.Rows++;
                if (row.IsBound) family.Bound++;
                else if (row.IsFallback) family.Fallback++;
                else if (row.IsNoView) {
                    family.NoView++;
                    if (row.Status.StartsWith("no-view: deliberate:", StringComparison.Ordinal)) family.Deliberate++;
                }
                switch (row.Motion) {
                    case "static:source": family.Static++; break;
                    case "unbound": family.Unbound++; break;
                }
                if (!string.IsNullOrEmpty(row.Motion) && row.Motion.StartsWith("bound:", StringComparison.Ordinal)) {
                    if (row.Motion.EndsWith(":pending-crowd", StringComparison.Ordinal) || row.Motion == "bound:pending-crowd") {
                        family.PendingFeed++;
                    }
                }
                if (IsMovingType(row.Type) || row.Kind == "train") family.MovingRows++;
                if (IsMovingType(row.Type) && !row.Movable) family.Immovable++;
                if (row.Applied) family.Applied++;
                if (row.Moved > 1e-4f) family.Moved++;
                if (row.IsBound) Status.Bound++;
                else if (row.IsFallback) Status.Fallback++;
                else if (row.IsNoView) {
                    Status.NoView++;
                    if (row.Status.StartsWith("no-view: deliberate:", StringComparison.Ordinal)) Status.Deliberate++;
                }
            }
            Families.Clear();
            var names = new List<string>(byFamily.Keys);
            names.Sort(StringComparer.Ordinal);
            for (int i = 0; i < names.Count; i++) {
                var family = byFamily[names[i]];
                family.ViewsPass = family.Fallback == 0 && family.NoView - family.Deliberate == 0;
                // A moving variant with no moving fitting (a fence-door gate lane) is bound
                // and correctly immobile; every other moving row must have been driven.
                family.BindingPass = !family.Moving ||
                    (family.Unbound == 0 && family.Applied + family.Immovable >= family.MovingRows);
                family.Verdict = VerdictOf(family);
                Families.Add(family);
            }
            Reasons.Clear();
            for (int i = 0; i < Families.Count; i++) {
                var family = Families[i];
                if (!family.Gated) continue;
                if (!family.ViewsPass) Reasons.Add(family.Family + ": " + family.Fallback + " fallback, " +
                    (family.NoView - family.Deliberate) + " without a view");
                if (!family.BindingPass) Reasons.Add(family.Family + ": " + family.Unbound + " unbound of " +
                    family.MovingRows + " moving row(s)");
            }
            Passed = Reasons.Count == 0;
            Verdict = Passed
                ? "PASS: every named family is drawn (no fallback) and every moving row is bound"
                : "FAIL: " + string.Join("; ", Reasons.ToArray());
        }

        static string VerdictOf(StationBindingFamily family) {
            if (!family.Gated) return family.Fallback == 0 ? "not-gated" : "not-gated (fallback)";
            if (!family.ViewsPass) return "fail:views";
            if (!family.BindingPass) return "fail:binding";
            return family.Moving ? "pass" : "pass:static";
        }

        /* ---------------------------------------------------------------- output */

        public string ToCsv() {
            var text = new StringBuilder();
            text.Append(StationBindingRow.CsvHeader).Append('\n');
            for (int i = 0; i < Rows.Count; i++) text.Append(Rows[i].ToCsv()).Append('\n');
            return text.ToString();
        }

        public JObject ToJson() {
            var json = new JObject {
                ["schemaVersion"] = 1,
                ["packet"] = "B4",
                ["demo"] = DemoId,
                ["document"] = new JObject {
                    ["name"] = DocumentName, ["sourceHash"] = SourceHash,
                    ["cells"] = Cells, ["modules"] = Modules, ["lines"] = Lines,
                },
                ["frames"] = new JObject {
                    ["source"] = FrameSource, ["ticks"] = FrameTicks, ["simSeconds"] = SimSeconds,
                },
                ["generatedAt"] = GeneratedAt,
                ["status"] = new JObject {
                    ["bound"] = Status.Bound, ["fallback"] = Status.Fallback,
                    ["noView"] = Status.NoView, ["noViewDeliberate"] = Status.Deliberate,
                    ["rows"] = Rows.Count,
                },
                ["verdict"] = new JObject {
                    ["passed"] = Passed, ["text"] = Verdict,
                    ["reasons"] = new JArray(Reasons.ToArray()),
                },
                ["families"] = new JArray(Families.ConvertAll(family => (object)new JObject {
                    ["family"] = family.Family, ["gated"] = family.Gated, ["moving"] = family.Moving,
                    ["rows"] = family.Rows, ["bound"] = family.Bound, ["fallback"] = family.Fallback,
                    ["noView"] = family.NoView, ["noViewDeliberate"] = family.Deliberate,
                    ["static"] = family.Static, ["movingRows"] = family.MovingRows,
                    ["unbound"] = family.Unbound, ["applied"] = family.Applied, ["moved"] = family.Moved,
                    ["immovable"] = family.Immovable,
                    ["pendingFeed"] = family.PendingFeed, ["viewsPass"] = family.ViewsPass,
                    ["bindingPass"] = family.BindingPass, ["verdict"] = family.Verdict,
                }).ToArray()),
                ["trains"] = new JArray(Trains.ConvertAll(train => (object)new JObject {
                    ["id"] = train.Id, ["line"] = train.LineId, ["track"] = train.TrackId,
                    ["formation"] = train.FormationKey, ["prefab"] = train.PrefabPath,
                    ["status"] = train.Status, ["motion"] = train.Motion, ["rig"] = train.Rig,
                    ["drawn"] = train.Drawn, ["renderer"] = train.RendererPath,
                    ["placement"] = train.Placement,
                }).ToArray()),
            };
            return json;
        }

        /// <summary>The short summary written next to the CSV and into `B4.md`.</summary>
        public string SummaryText() {
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            text.Append("demo=").Append(DemoId).Append(" document=\"").Append(DocumentName).Append("\"")
                .Append(" cells=").Append(Cells.ToString(id))
                .Append(" modules=").Append(Modules.ToString(id))
                .Append(" lines=").Append(Lines.ToString(id))
                .Append(" sourceHash=").Append(SourceHash).Append('\n');
            text.Append("frames=").Append(FrameTicks.ToString(id)).Append(" (").Append(FrameSource).Append(")")
                .Append(" sim=").Append(SimSeconds.ToString("0.###", id)).Append("s\n");
            text.Append("rows=").Append(Rows.Count.ToString(id))
                .Append(" bound=").Append(Status.Bound.ToString(id))
                .Append(" fallback=").Append(Status.Fallback.ToString(id))
                .Append(" no-view=").Append(Status.NoView.ToString(id))
                .Append(" (deliberate ").Append(Status.Deliberate.ToString(id)).Append(")\n");
            for (int i = 0; i < Families.Count; i++) {
                var family = Families[i];
                text.Append("  ").Append(family.Family.PadRight(12))
                    .Append(" rows=").Append(family.Rows.ToString(id).PadLeft(5))
                    .Append(" bound=").Append(family.Bound.ToString(id).PadLeft(5))
                    .Append(" fallback=").Append(family.Fallback.ToString(id).PadLeft(4))
                    .Append(" no-view=").Append(family.NoView.ToString(id).PadLeft(5))
                    .Append(" moving=").Append(family.MovingRows.ToString(id).PadLeft(4))
                    .Append(" unbound=").Append(family.Unbound.ToString(id).PadLeft(3))
                    .Append(" immovable=").Append(family.Immovable.ToString(id).PadLeft(3))
                    .Append(" moved=").Append(family.Moved.ToString(id).PadLeft(4))
                    .Append("  ").Append(family.Verdict).Append('\n');
            }
            text.Append("verdict: ").Append(Verdict);
            return text.ToString();
        }
    }

    /// <summary>Row status counts for one report.</summary>
    public sealed class StationBindingStatusCounts {
        public int Bound, Fallback, NoView, Deliberate;
    }
}
