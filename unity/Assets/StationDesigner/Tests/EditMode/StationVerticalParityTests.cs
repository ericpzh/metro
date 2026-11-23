using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Parity tests covering vertical circulation, lifts, walkways, canopy/roofs, pillars,
    /// exits, and elevated/overground structures (<c>lift-interval</c>, <c>lift-doors</c>,
    /// <c>lift-extension</c>, <c>lift-size</c>, <c>lift-style</c>, <c>lift</c>, <c>walkways</c>,
    /// <c>canopy</c>, <c>bay</c>, <c>pillar-length</c>, <c>pillar-extension</c>, <c>exits</c>,
    /// <c>overground</c>, <c>structures-gaps</c>).
    /// </summary>
    public sealed class StationVerticalParityTests {
        readonly List<GameObject> gameObjects = new List<GameObject>();
        readonly List<VerticalModuleView> verticalViews = new List<VerticalModuleView>();
        readonly List<StationWorldView> worlds = new List<StationWorldView>();

        [TearDown]
        public void TearDown() {
            for (int i = 0; i < verticalViews.Count; i++) verticalViews[i]?.Dispose();
            verticalViews.Clear();
            for (int i = 0; i < worlds.Count; i++) worlds[i]?.Dispose();
            worlds.Clear();
            StationEditHost.ResetForTests();
            for (int i = 0; i < gameObjects.Count; i++) {
                if (gameObjects[i] != null) UnityEngine.Object.DestroyImmediate(gameObjects[i]);
            }
            gameObjects.Clear();
            StationEditSession.Reset();
            StationCellTool.Reset();
            StationRoofTool.Reset();
            StationPillarTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        /* ---------------------------------------------------------- helpers */

        static JObject WrapSave(string name, JArray cells, JArray modules, JArray lines = null) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["gameVersion"] = "0.2.0",
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = name, ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 7,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells,
                ["modules"] = modules,
                ["lines"] = lines ?? new JArray(),
            },
        };

        static JArray SolidFloor(int x0, int x1, int y0, int y1, params int[] levels) {
            var cells = new JArray();
            foreach (int z in levels) {
                for (int x = x0; x <= x1; x++)
                    for (int y = y0; y <= y1; y++)
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
            }
            return cells;
        }

        static StationIndex ReadIndex(JObject save, out StationDocument doc) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read.Document, "save failed to parse");
            doc = read.Document;
            Assert.IsTrue(StationIndex.TryCreate(doc, out var index, out var rejection), rejection?.ToString() ?? "");
            return index;
        }

        StationGameHost OpenHost(string saveJson) {
            var hostObj = new GameObject(StationGameHost.ObjectName);
            gameObjects.Add(hostObj);
            var host = hostObj.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var opened = host.OpenDocument(saveJson, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            return host;
        }

        VerticalModuleView BuildVertical(JObject module, Func<int, int, int, bool> solid = null) {
            var parent = new GameObject("vertical-parity-" + (string)module["id"]);
            gameObjects.Add(parent);
            var request = VerticalModuleRequest.FromFacts(ModuleFactsReader.Read(module), null, "", solid);
            Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view),
                "VerticalModuleViews.TryBuild failed for " + (string)module["id"]);
            verticalViews.Add(view);
            return view;
        }

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader ProbeShader() =>
            StationFinishLibrary.FindShader() ?? Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");

        StationWorldView BuildWorld(JObject save, params IStationViewRenderer[] renderers) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), StationSource.None);
            Assert.IsNotNull(read.Document);
            var root = new GameObject("world-parity-" + (string)save["name"]);
            gameObjects.Add(root);
            var world = new StationWorldView(root.transform, (string)save["name"], renderers,
                new StationViewAssets { Catalogue = Catalogue(), Shader = ProbeShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            worlds.Add(world);
            return world;
        }

        static StationDayData AlwaysOpenDay() => new StationDayData(
            new DaySpan(0, StationClock.ServiceLatest),
            new PeakSpans(new DaySpan(6 * 3600, 10 * 3600), new DaySpan(17 * 3600, 20 * 3600)),
            new DayDemand(new DemandKnobs(1.0, 0.8, 1), DemandKnobs.DefaultOffday),
            new SimCalendar(new SimDate(2026, 1, 1), Array.Empty<string>()));

        static StationCoarseItinerary PlanCoarse(StationSparseRouter router, int from, int to, StationRouteNeeds needs) {
            router.CaptureCostSnapshot(null, null);
            var status = router.StartCoarseSearch(from, to, needs, -1, 0, 1, out var ready, out int jobId);
            if (status == StationSparseRouter.CoarseJobStatus.Ready) return ready;
            if (status == StationSparseRouter.CoarseJobStatus.Failed) return null;
            var job = router.StepCoarseJobNow(jobId, 4000, 16000);
            return job != null && job.Status == StationSparseRouter.CoarseJobStatus.Ready ? job.Result : null;
        }

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        static Vector3 DocPoint(VerticalModuleView view, string part) {
            Assert.IsTrue(view.TryGetPart(part, out var tr), "missing part " + part + " on " + view.ModuleId);
            return StationCoordinates.WorldToDocument(tr.position);
        }

        #region Lifts

        [Test]
        public void LiftSupportsAllFiveIntervalsRecordingCfgRises() {
            var index = ReadIndex(WrapSave("lift-intervals", SolidFloor(0, 12, 0, 12, 0), new JArray()), out _);
            foreach (int interval in new[] { 3, 4, 5, 6, 7 }) {
                var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                    ToolType = "lift", Rotation = 0, LiftInterval = interval,
                    Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
                });
                Assert.IsTrue(plan.Ok, $"interval {interval}: {plan.Reason}");
                Assert.AreEqual(0, plan.Candidate.From.Value.Z, 1e-6);
                Assert.AreEqual(interval, plan.Candidate.To.Value.Z, 1e-6, $"interval {interval} spans exact rise");
                Assert.AreEqual("[" + interval + "]", plan.Candidate.Text("rises").Replace(" ", ""));
                var record = StationModulePlacement.ToRecord(plan.Candidate);
                CollectionAssert.AreEqual(new[] { interval }, StationLiftRules.Rises(record));
            }
        }

        [Test]
        public void MixedUnevenLiftStackingBuildsStopsBidirectionalEdgesRoundTripAndExactViewHeight() {
            // Start with 5 m lift at z = 0, stack +3 m up (to 8) and -7 m down (to -7): rises [7, 5, 3].
            var draft = new StationEditDraft {
                Id = "lift-mixed", Type = "lift", X = 2, Y = 2, Z = 0, Rotation = 0,
                From = new StationPoint(2, 2, 0), To = new StationPoint(2, 2, 5),
            };
            draft.SetJson("rises", "[5]");
            StationLiftRules.ExtendUp(draft, 3);
            StationLiftRules.ExtendDown(draft, 7);

            Assert.AreEqual(-7, draft.From.Value.Z, 1e-6);
            Assert.AreEqual(8, draft.To.Value.Z, 1e-6);
            Assert.AreEqual("[7,5,3]", draft.Text("rises").Replace(" ", ""));

            var modJson = StationModuleEdits.ToSaveRecord(draft);
            var save = WrapSave("lift-mixed", SolidFloor(0, 6, 0, 6, -7, 0, 5, 8), new JArray { modJson });
            var index = ReadIndex(save, out var doc);
            Assert.IsTrue(index.TryGetModule("lift-mixed", out var record));
            CollectionAssert.AreEqual(new[] { 7, 5, 3 }, StationLiftRules.Rises(record));

            // Save round-trip preserves mixed rises and exact span.
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(doc), StationSource.None);
            var rLift = reloaded.Document.Modules.First(m => m.Id == "lift-mixed");
            Assert.AreEqual(-7, rLift.From.Value.Z, 1e-6);
            Assert.AreEqual(8, rLift.To.Value.Z, 1e-6);
            CollectionAssert.AreEqual(new[] { 7, 5, 3 }, StationLiftRules.Rises(rLift));

            // Projected sim stops: -7, 0, 5 below cap 8; live sparse topology exposes bidirectional Lift arcs between all 3.
            var projected = StationSessionProjection.Document(doc, index);
            var fact = projected.Modules.First(m => m.Id == "lift-mixed");
            CollectionAssert.AreEqual(new[] { -7, 0, 5 }, StationLiftStops.Levels(fact),
                "stops are the three storey bases below top cap 8");

            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected, Day = AlwaysOpenDay(), Seed = 1,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 0 },
            });
            Assert.AreEqual(1, session.Services.LiftCount);
            var topo = session.Services.SparseRouter.Topology;
            Assert.IsTrue(topo.HasLifts);
            var liftArcs = topo.ExplicitArcs.Where(a => a.Kind == WalkEdgeKind.Lift && a.LiftId == "lift-mixed").ToList();
            int nMinus7 = session.WalkGraph.NodeIndex["2,1,-7"];
            int n0 = session.WalkGraph.NodeIndex["2,1,0"];
            int n5 = session.WalkGraph.NodeIndex["2,1,5"];
            int[] servedNodes = { nMinus7, n0, n5 };
            foreach (int a in servedNodes) {
                foreach (int b in servedNodes) {
                    if (a == b) continue;
                    Assert.IsTrue(liftArcs.Any(arc => arc.FromNode == a && arc.ToNode == b),
                        $"bidirectional lift arc missing between {a} and {b}");
                }
            }
            // Cap level 8 is NOT a lift stop.
            int nCap8 = session.WalkGraph.NodeIndex["2,1,8"];
            Assert.IsFalse(liftArcs.Any(arc => arc.FromNode == nCap8 || arc.ToNode == nCap8),
                "top cap 8 must not be a lift stop");

            // 3D view height is exact 15 m with 3 landing portals below cap 8.
            var solids = new HashSet<(int, int, int)>();
            foreach (var c in doc.Cells) if (c.IsSolid) solids.Add((c.X, c.Y, c.Z));
            var view = BuildVertical(modJson, (x, y, z) => solids.Contains((x, y, z)));
            Assert.AreEqual(15.0, view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 0.05,
                "mixed shaft height is exactly 7 + 5 + 3 = 15 m");
            Assert.AreEqual(3, view.PortalCount, "exactly 3 served landing portals below cap 8");
            CollectionAssert.AreEqual(new[] { -7.0, 0.0, 5.0, 8.0 }, view.Stops.ToArray());
            CollectionAssert.AreEqual(new[] { -7, 0, 5 }, view.Levels.ToArray());
        }

        [Test]
        public void BackOnlyLandingDoorBuildsOnlyBackDoorAndSkipsSealedNoneStop() {
            var liftJson = new JObject {
                ["id"] = "lift-doors", ["type"] = "lift", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                ["w"] = 2, ["d"] = 2,
                ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 15 },
                ["cfg"] = new JObject {
                    ["rises"] = new JArray(5, 5, 5),
                    ["doors"] = new JObject { ["0"] = "back", ["5"] = "none", ["10"] = "both" },
                },
            };

            var view = BuildVertical(liftJson, (x, y, z) => z == 0 || z == 5 || z == 10);
            Assert.AreEqual(2, view.PortalCount, "level 0 (back) + level 10 (both) = 2 served levels; sealed level 5 skipped");

            // Surgical fix #4: level 0 is back-only -> ONLY back door exists, NEVER front!
            Assert.IsFalse(view.TryGetPart("landing-doors-0-front", out _),
                "back-only floor must NOT create landing-doors-0-front");
            Assert.IsTrue(view.TryGetPart("landing-doors-0-back", out var back0),
                "back-only floor creates landing-doors-0-back");

            // Sealed intermediate floor 5 ("none") creates NEITHER front nor back doors.
            Assert.IsFalse(view.TryGetPart("landing-doors-5-front", out _), "none floor skips front door");
            Assert.IsFalse(view.TryGetPart("landing-doors-5-back", out _), "none floor skips back door");

            // Through-floor 10 ("both") creates BOTH front and back doors.
            Assert.IsTrue(view.TryGetPart("landing-doors-10-front", out _), "both floor creates front door");
            Assert.IsTrue(view.TryGetPart("landing-doors-10-back", out _), "both floor creates back door");
            Assert.IsTrue(view.TryGetPart("cabin-door-back", out _), "cabin carries back door when any level serves back");

            // Opening doors at back-only level 0 slides back leaves cleanly without null-ref on null Front list.
            var closedX = back0.Cast<Transform>().Select(t => t.localPosition.x).ToArray();
            Assert.IsTrue(view.Apply(ModuleMotionState.Lift("lift-doors", 0f, 1f)));
            var openX = back0.Cast<Transform>().Select(t => t.localPosition.x).ToArray();
            Assert.IsTrue(closedX.Zip(openX, (a, b) => Mathf.Abs(a - b) > 0.09f).All(moved => moved),
                "back landing door leaves open cleanly at level 0");

            // Sim walk graph / sparse topology: level 0 boards at back row (2, 4, 0), level 5 is not a stop.
            var index = ReadIndex(WrapSave("lift-doors", SolidFloor(0, 6, 0, 6, 0, 5, 10), new JArray { liftJson }), out var doc);
            var projected = StationSessionProjection.Document(doc, index);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected, Day = AlwaysOpenDay(), Seed = 1,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 0 },
            });
            var liftArcs = session.Services.SparseRouter.Topology.ExplicitArcs
                .Where(a => a.Kind == WalkEdgeKind.Lift).ToList();
            int back0Node = session.WalkGraph.NodeIndex["2,4,0"];
            int front0Node = session.WalkGraph.NodeIndex["2,1,0"];
            int mid5Front = session.WalkGraph.NodeIndex["2,1,5"];
            int mid5Back = session.WalkGraph.NodeIndex["2,4,5"];
            Assert.IsTrue(liftArcs.Any(a => a.FromNode == back0Node), "back-only level boards from back row (2,4,0)");
            Assert.IsFalse(liftArcs.Any(a => a.FromNode == front0Node || a.ToNode == front0Node),
                "back-only level does not board from front row");
            Assert.IsFalse(liftArcs.Any(a => a.FromNode == mid5Front || a.FromNode == mid5Back ||
                                             a.ToNode == mid5Front || a.ToNode == mid5Back),
                "sealed 'none' intermediate level is skipped by lift stops");
        }

        [Test]
        public void LiftInColumnEnforcesZGuardAndDownwardExtensionAcceptsExistingLowerFloorSlab() {
            // Surgical fix #1a: LiftInColumn(index, x, y, z) guards z against [lo, hi].
            var lowerLift = new JObject {
                ["id"] = "lift-low", ["type"] = "lift", ["x"] = 4, ["y"] = 4, ["z"] = -10, ["rot"] = 0,
                ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = -10 },
                ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = -5 },
                ["cfg"] = new JObject { ["rises"] = new JArray(5) },
            };
            var upperLift = new JObject {
                ["id"] = "lift-high", ["type"] = "lift", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 5 },
                ["cfg"] = new JObject { ["rises"] = new JArray(5) },
            };
            var save = WrapSave("lift-z-guard", SolidFloor(0, 8, 0, 8, -10, -5, 0), new JArray { lowerLift, upperLift });
            var index = ReadIndex(save, out _);

            Assert.AreEqual("lift-high", StationLiftRules.LiftInColumn(index, 4, 4, 0)?.Id, "base of upper shaft");
            Assert.AreEqual("lift-high", StationLiftRules.LiftInColumn(index, 5, 5, 5)?.Id, "far corner + cap of upper shaft");
            Assert.AreEqual("lift-low", StationLiftRules.LiftInColumn(index, 4, 4, -8)?.Id, "mid lower shaft");
            Assert.IsNull(StationLiftRules.LiftInColumn(index, 4, 4, 9), "above upper shaft returns null");
            Assert.IsNull(StationLiftRules.LiftInColumn(index, 4, 4, -2), "gap between shafts returns null");
            Assert.IsNull(StationLiftRules.LiftInColumn(index, 4, 4, -12), "below lower shaft returns null");

            // Surgical fix #1c: extending a lift down onto an existing lower floor slab at z = -5 is NOT blocked.
            var singleSave = WrapSave("lift-down-slab", SolidFloor(0, 8, 0, 8, -5, 0), new JArray { upperLift });
            var singleIndex = ReadIndex(singleSave, out _);
            var draft = StationModulePlacement.DraftOf(singleIndex.GetModule("lift-high"));
            StationLiftRules.ExtendDown(draft, 5);
            Assert.AreEqual(-5, draft.From.Value.Z, 1e-6);
            var blockers = StationLiftRules.Blockers(singleIndex, draft, oldLo: 0, oldHi: 5, up: false);
            Assert.AreEqual(0, blockers.Count,
                "existing lower floor slab at cell.Z == oldLo - interval must NOT block downward extension");

            // A solid block INSIDE the newly added shaft volume (z = -3) MUST still refuse the downward growth.
            var blockedCells = SolidFloor(0, 8, 0, 8, -5, 0);
            blockedCells.Add(new JObject { ["x"] = 4, ["y"] = 4, ["z"] = -3, ["fill"] = "solid" });
            var blockedIndex = ReadIndex(WrapSave("lift-down-blocked", blockedCells, new JArray { upperLift }), out _);
            var blocked = StationLiftRules.Blockers(blockedIndex, draft, oldLo: 0, oldHi: 5, up: false);
            Assert.Greater(blocked.Count, 0, "solid obstruction strictly inside downward extension volume must block");
        }

        [Test]
        public void LegacyMultiStoreyLiftWithoutCfgRisesDecomposesSpanForExtendTrimAndSingleIntervalRefusal() {
            // Surgical fix #1b: legacy lift spanning 0..10 without cfg.rises decomposes to [5, 5].
            var legacy = new JObject {
                ["id"] = "lift-legacy", ["type"] = "lift", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 10 },
                ["cfg"] = new JObject(),
            };
            var index = ReadIndex(WrapSave("lift-legacy", SolidFloor(0, 8, 0, 8, 0), new JArray { legacy }), out _);
            var rec = index.GetModule("lift-legacy");
            CollectionAssert.AreEqual(new[] { 5, 5 }, StationLiftRules.Rises(rec));

            // Extending up appends 3 onto [5, 5] -> [5, 5, 3] (NOT [5, 3]!).
            var extendDraft = StationModulePlacement.DraftOf(rec);
            StationLiftRules.ExtendUp(extendDraft, 3);
            Assert.AreEqual(13, extendDraft.To.Value.Z, 1e-6);
            Assert.AreEqual("[5,5,3]", extendDraft.Text("rises").Replace(" ", ""));

            // Trimming once shrinks 10 -> 5 ([5]), second trim refuses single-interval shaft.
            var trimDraft = StationModulePlacement.DraftOf(rec);
            Assert.IsTrue(StationLiftRules.TryTrim(trimDraft, bottom: false), "legacy 10 m shaft trims one 5 m segment");
            Assert.AreEqual(5, trimDraft.To.Value.Z, 1e-6);
            Assert.AreEqual("[5]", trimDraft.Text("rises").Replace(" ", ""));
            Assert.IsFalse(StationLiftRules.TryTrim(trimDraft, bottom: false),
                "single-interval shaft refuses further trimming");
        }

        [Test]
        public void LiftUndoRedoPreservesDoorsAndStyleConfig() {
            var lift = new JObject {
                ["id"] = "lift-styled", ["type"] = "lift", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 5 },
                ["cfg"] = new JObject {
                    ["rises"] = new JArray(5),
                    ["style"] = "steel",
                    ["doors"] = new JObject { ["0"] = "back" },
                },
            };
            var host = OpenHost(WrapSave("lift-undo", SolidFloor(0, 10, 0, 10, 0), new JArray { lift }).ToString(Formatting.None));
            Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out var selCode), selCode);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "lift", ["liftInterval"] = 4 });

            Assert.IsTrue(StationLiftTool.Begin(host, StationCellFixture.Hit(4, 4, 4, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var grown = host.Index.GetModule("lift-styled");
            Assert.AreEqual(9, grown.To.Value.Z, 1e-6);
            Assert.AreEqual("steel", grown.Config.Text("style"));
            StringAssert.Contains("back", grown.Config.Text("doors"));

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            var undone = host.Index.GetModule("lift-styled");
            Assert.AreEqual(5, undone.To.Value.Z, 1e-6);
            Assert.AreEqual("steel", undone.Config.Text("style"), "undo preserves cfg.style");
            StringAssert.Contains("back", undone.Config.Text("doors"), "undo preserves cfg.doors");

            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            var redone = host.Index.GetModule("lift-styled");
            Assert.AreEqual(9, redone.To.Value.Z, 1e-6);
            Assert.AreEqual("steel", redone.Config.Text("style"), "redo preserves cfg.style");
            StringAssert.Contains("back", redone.Config.Text("doors"), "redo preserves cfg.doors");
        }

        [Test]
        public void LargeThreeByThreeLiftFootprintGeometryCabinWalkGraphAndRoundTrip() {
            var largeLift = new JObject {
                ["id"] = "lift-large", ["type"] = "lift", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                ["w"] = 3, ["d"] = 3,
                ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 10 },
                ["cfg"] = new JObject { ["rises"] = new JArray(5, 5), ["size"] = 3 },
            };
            var save = WrapSave("lift-large", SolidFloor(0, 7, 0, 7, 0, 5), new JArray { largeLift });
            var index = ReadIndex(save, out var doc);
            var rec = index.GetModule("lift-large");

            // Footprint & clearance: 3x3 = 9 cells.
            Assert.AreEqual(3, StationFootprints.LiftSize(rec));
            Assert.AreEqual(9, StationFootprints.LiftFootprint(rec).Length, "large lift spans 9 plan cells");
            Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var unsup), unsup);
            Assert.AreEqual(3.0, box.X1 - box.X0, 1e-6);
            Assert.AreEqual(3.0, box.Y1 - box.Y0, 1e-6);

            // 3D view geometry & scaled 2.25 m cabin carriage.
            var view = BuildVertical(largeLift, (x, y, z) => z == 0 || z == 5);
            Assert.AreEqual(3.03, view.DocumentBounds.X1 - view.DocumentBounds.X0, 0.05, "3x3 shaft outer X span");
            Assert.AreEqual(3.03, view.DocumentBounds.Y1 - view.DocumentBounds.Y0, 0.05, "3x3 shaft outer Y span");
            Assert.AreEqual(10.0, view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 0.05, "10 m shaft height");
            var cabinMesh = view.Root.GetComponentsInChildren<MeshFilter>(true).First(f => f.name == "cabin-body");
            var cabinVerts = cabinMesh.sharedMesh.vertices
                .Select(v => StationCoordinates.WorldToDocument(cabinMesh.transform.TransformPoint(v))).ToArray();
            float cabinW = cabinVerts.Max(v => v.x) - cabinVerts.Min(v => v.x);
            Assert.AreEqual(2.31f, cabinW, 0.1f, "3x3 cabin scales to 1.5x (2.25-2.31 m)");

            // Walk graph excludes all 9 interior shaft cells on both levels and keeps all 3 front landing cells walkable.
            var projected = StationSessionProjection.Document(doc, index);
            Assert.AreEqual(3, projected.Modules.First(m => m.Id == "lift-large").Width);
            var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });
            foreach (int z in new[] { 0, 5 }) {
                for (int x = 2; x <= 4; x++)
                    for (int y = 2; y <= 4; y++)
                        Assert.IsFalse(graph.NodeIndex.ContainsKey($"{x},{y},{z}"),
                            $"3x3 cabin cell ({x},{y},{z}) must not be walkable");
                for (int x = 2; x <= 4; x++)
                    Assert.IsTrue(graph.NodeIndex.ContainsKey($"{x},1,{z}"),
                        $"3x3 front landing cell ({x},1,{z}) must be walkable");
            }

            // Save round-trip preserves cfg.size = 3.
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(doc), StationSource.None);
            Assert.AreEqual(3, StationFootprints.LiftSize(reloaded.Document.Modules.First(m => m.Id == "lift-large")));
        }

        [Test]
        public void SteelLiftHousingOmitsGlazedWallsAcrossFullHeightAndRoundTrips() {
            var steelLift = new JObject {
                ["id"] = "lift-steel", ["type"] = "lift", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 10 },
                ["cfg"] = new JObject { ["rises"] = new JArray(5, 5), ["style"] = "steel" },
            };
            var glassLift = (JObject)steelLift.DeepClone();
            glassLift["id"] = "lift-glass";
            glassLift["cfg"]["style"] = "glass";

            var steelView = BuildVertical(steelLift, (x, y, z) => z == 0 || z == 5);
            Assert.AreEqual(2, steelView.OpaqueShaftSidePanels);
            var steelNames = steelView.Root.GetComponentsInChildren<MeshRenderer>(true).Select(r => r.name).ToArray();
            CollectionAssert.DoesNotContain(steelNames, "shaft-glass", "steel housing omits shaft-glass across full height");
            CollectionAssert.DoesNotContain(steelNames, "portal-glass", "steel housing omits glazed portal transom");
            CollectionAssert.DoesNotContain(steelNames, "cabin-glass", "steel housing omits cabin glass");
            CollectionAssert.Contains(steelNames, "shaft");

            var glassView = BuildVertical(glassLift, (x, y, z) => z == 0 || z == 5);
            Assert.AreEqual(0, glassView.OpaqueShaftSidePanels);
            var glassNames = glassView.Root.GetComponentsInChildren<MeshRenderer>(true).Select(r => r.name).ToArray();
            CollectionAssert.Contains(glassNames, "shaft-glass");
            CollectionAssert.Contains(glassNames, "cabin-glass");

            // Save round-trip preserves cfg.style.
            ReadIndex(WrapSave("lift-style", SolidFloor(0, 5, 0, 5, 0, 5), new JArray { steelLift }), out var doc);
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(doc), StationSource.None);
            Assert.AreEqual("steel", reloaded.Document.Modules.First(m => m.Id == "lift-steel").Config.Text("style"));
        }

        [Test]
        public void StepFreePassengerChoosesLiftOverStairsAndLiftRotationAlignsLandings() {
            // 1. Two-storey hall connected by BOTH a straight stair and a lift: step-free chooses Lift, walking chooses Stair.
            var stairAndLift = new JArray {
                new JObject {
                    ["id"] = "stair-1", ["type"] = "stair", ["x"] = 1, ["y"] = 1, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 1, ["y"] = 1, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 1, ["y"] = 9, ["z"] = 5 },
                    ["cfg"] = new JObject { ["width"] = 0.68, ["style"] = "straight" },
                },
                new JObject {
                    ["id"] = "lift-1", ["type"] = "lift", ["x"] = 5, ["y"] = 4, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 5, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 5, ["y"] = 4, ["z"] = 10 },
                    ["cfg"] = new JObject { ["rises"] = new JArray(5, 5) },
                },
            };
            var index = ReadIndex(WrapSave("step-free", SolidFloor(0, 10, 0, 10, 0, 5), stairAndLift), out var doc);
            var projected = StationSessionProjection.Document(doc, index);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected, Day = AlwaysOpenDay(), Seed = 1,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 0 },
            });
            session.Advance(1.0); // capture initial cost snapshot for SparseRouter

            // Shaft interior (5..6, 4..5) is blocked in walk graph on both floors.
            foreach (int z in new[] { 0, 5 })
                for (int x = 5; x <= 6; x++)
                    for (int y = 4; y <= 5; y++)
                        Assert.IsFalse(session.WalkGraph.NodeIndex.ContainsKey($"{x},{y},{z}"),
                            $"shaft cell ({x},{y},{z}) must be non-walkable");

            int start = session.WalkGraph.NodeIndex["1,0,0"];
            int goal = session.WalkGraph.NodeIndex["1,10,5"];
            var router = session.Services.SparseRouter;
            Assert.IsTrue(router.Topology.CanReach(start, goal, stepFree: true), "step-free reaches upper floor via lift");

            var stepFreeItin = PlanCoarse(router, start, goal, new StationRouteNeeds { StepFree = true });
            Assert.IsNotNull(stepFreeItin, "step-free coarse itinerary resolves");
            Assert.IsTrue(stepFreeItin.Steps.Any(s => s.EdgeKind == WalkEdgeKind.Lift),
                "step-free passenger rides the lift");
            Assert.IsFalse(stepFreeItin.Steps.Any(s => s.EdgeKind == WalkEdgeKind.Stair),
                "step-free passenger never takes stairs");

            var walkingItin = PlanCoarse(router, start, goal, StationRouteNeeds.Walking);
            Assert.IsNotNull(walkingItin, "walking coarse itinerary resolves");
            Assert.IsTrue(walkingItin.Steps.Any(s => s.EdgeKind == WalkEdgeKind.Stair),
                "walking passenger prefers stairs over 300 s lift avoidance penalty");
            Assert.AreEqual(0.0, StationRoutePlanner.LiftPenalty(new StationRouteNeeds { StepFree = true }), 1e-6);
            Assert.AreEqual(StationRoutePlanner.LiftAvoidSeconds, StationRoutePlanner.LiftPenalty(StationRouteNeeds.Walking), 1e-6);

            // 2. Lift rotation 0..3 aligns front landing row on -y, +x, +y, -x respectively.
            var expectedLandingCells = new (int Rot, int Lx, int Ly)[] {
                (0, 4, 3), // rot 0: door faces -y -> cells (4,3) & (5,3)
                (1, 6, 4), // rot 1: door faces +x -> cells (6,4) & (6,5)
                (2, 5, 6), // rot 2: door faces +y -> cells (5,6) & (4,6)
                (3, 3, 5), // rot 3: door faces -x -> cells (3,5) & (3,4)
            };
            foreach (var (rot, lx, ly) in expectedLandingCells) {
                var rotLift = new JObject {
                    ["id"] = "lift-r" + rot, ["type"] = "lift", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = rot,
                    ["from"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 10 },
                    ["cfg"] = new JObject { ["rises"] = new JArray(5, 5) },
                };
                var rotIndex = ReadIndex(WrapSave("rot-" + rot, SolidFloor(0, 9, 0, 9, 0, 5), new JArray { rotLift }), out var rotDoc);
                var rotSession = new StationSimulationSession(new StationSessionSetup {
                    Document = StationSessionProjection.Document(rotDoc, rotIndex), Day = AlwaysOpenDay(), Seed = 1,
                    StartSimTime = 8 * 3600, StartPlaying = false,
                    WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                    Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 0 },
                });
                var arcs = rotSession.Services.SparseRouter.Topology.ExplicitArcs
                    .Where(a => a.Kind == WalkEdgeKind.Lift).ToList();
                Assert.Greater(arcs.Count, 0, $"rot={rot}: lift installs connector");
                // Check landing sits on the expected face row outside the 2x2 footprint (4..5, 4..5).
                int boardingNode = arcs.First(a => rotSession.WalkGraph.NodeZ[a.FromNode] == 1.0).FromNode;
                double bx = rotSession.WalkGraph.NodeX[boardingNode] - 0.5;
                double by = rotSession.WalkGraph.NodeY[boardingNode] - 0.5;
                bool onExpectedFace = (rot == 0 && by == 3 && (bx == 4 || bx == 5)) ||
                                      (rot == 1 && bx == 6 && (by == 4 || by == 5)) ||
                                      (rot == 2 && by == 6 && (bx == 4 || bx == 5)) ||
                                      (rot == 3 && bx == 3 && (by == 4 || by == 5));
                Assert.IsTrue(onExpectedFace, $"rot={rot}: expected face near ({lx},{ly}), got ({bx},{by})");

                var rotView = BuildVertical(rotLift, (x, y, z) => z == 0 || z == 5);
                var stop0 = DocPoint(rotView, "stop-0");
                Assert.IsTrue(
                    (rot == 0 && stop0.y < 4f) || (rot == 1 && stop0.x > 6f) ||
                    (rot == 2 && stop0.y > 6f) || (rot == 3 && stop0.x < 4f),
                    $"rot={rot}: view stop-0 anchor {stop0} aligns with door face");
            }
        }

        #endregion

        #region Walkways

        [Test]
        public void WalkwaysSpanAllThreeLengthsRotationsDirectionsWidthsWithSymmetricCentring() {
            // Big flat floor large enough for 90 m runs in all 4 directions from (100, 100).
            var floor = new JArray();
            for (int x = 8; x <= 192; x++) {
                floor.Add(new JObject { ["x"] = x, ["y"] = 100, ["z"] = 0, ["fill"] = "solid" });
                floor.Add(new JObject { ["x"] = x, ["y"] = 99, ["z"] = 0, ["fill"] = "solid" });
                floor.Add(new JObject { ["x"] = x, ["y"] = 101, ["z"] = 0, ["fill"] = "solid" });
            }
            for (int y = 8; y <= 192; y++) {
                if (y >= 99 && y <= 101) continue;
                floor.Add(new JObject { ["x"] = 100, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                floor.Add(new JObject { ["x"] = 99, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                floor.Add(new JObject { ["x"] = 101, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
            }
            var index = ReadIndex(WrapSave("walkway-grid", floor, new JArray()), out _);

            foreach (int length in new[] { 30, 60, 90 }) {
                for (int rot = 0; rot < 4; rot++) {
                    foreach (int width in new[] { 1, 2 }) {
                        var upPlan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                            ToolType = "walkway", Rotation = rot, WalkwayRun = length, WalkwayDown = false, Width = width,
                            Hit = StationCellFixture.Hit(100, 100, 0, true).Cell,
                        });
                        var downPlan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                            ToolType = "walkway", Rotation = rot, WalkwayRun = length, WalkwayDown = true, Width = width,
                            Hit = StationCellFixture.Hit(100, 100, 0, true).Cell,
                        });
                        Assert.IsTrue(upPlan.Ok, $"len={length} rot={rot} w={width} up: {upPlan.Reason}");
                        Assert.IsTrue(downPlan.Ok, $"len={length} rot={rot} w={width} down: {downPlan.Reason}");

                        var upRec = StationModulePlacement.ToRecord(upPlan.Candidate);
                        var downRec = StationModulePlacement.ToRecord(downPlan.Candidate);
                        Assert.AreEqual(0, upRec.From.Value.Z, 1e-6);
                        Assert.AreEqual(0, upRec.To.Value.Z, 1e-6, "walkway is strictly level");
                        Assert.AreEqual(length, Math.Sqrt(
                            Math.Pow(upRec.To.Value.X - upRec.From.Value.X, 2) +
                            Math.Pow(upRec.To.Value.Y - upRec.From.Value.Y, 2)), 1e-6);
                        Assert.AreEqual(upRec.From.Value.X, downRec.To.Value.X, 1e-6, "down swaps endpoints");
                        Assert.AreEqual(upRec.From.Value.Y, downRec.To.Value.Y, 1e-6);

                        // Envelope & EscalatorRun centring must be identical for up vs down.
                        Assert.IsTrue(StationRampRules.TryEnvelope(upRec, out var upEnv, out var unsup), unsup);
                        Assert.IsTrue(StationRampRules.TryEnvelope(downRec, out var downEnv, out unsup), unsup);
                        Assert.AreEqual(upEnv.X0, downEnv.X0, 1e-6, $"len={length} rot={rot} w={width}: symmetric X0");
                        Assert.AreEqual(upEnv.X1, downEnv.X1, 1e-6, $"len={length} rot={rot} w={width}: symmetric X1");
                        Assert.AreEqual(upEnv.Y0, downEnv.Y0, 1e-6, $"len={length} rot={rot} w={width}: symmetric Y0");
                        Assert.AreEqual(upEnv.Y1, downEnv.Y1, 1e-6, $"len={length} rot={rot} w={width}: symmetric Y1");
                        bool alongY = rot % 2 == 0;
                        Assert.AreEqual(length + 1, alongY ? upEnv.Y1 - upEnv.Y0 : upEnv.X1 - upEnv.X0, 1e-6);
                        Assert.AreEqual(width, alongY ? upEnv.X1 - upEnv.X0 : upEnv.Y1 - upEnv.Y0, 1e-6);

                        StationRunGeometry.EscalatorRun(upRec.Facts, out var upA, out var upB);
                        StationRunGeometry.EscalatorRun(downRec.Facts, out var downA, out var downB);
                        Assert.AreEqual(upA.X, downB.X, 1e-6, "centring shift matches in both directions");
                        Assert.AreEqual(upA.Y, downB.Y, 1e-6);
                    }
                }
            }
        }

        [Test]
        public void WalkwayNeverCarvesAboveBeltBuildsAnimatedFlatViewRoutesOneWayStepFreeAndRoundTrips() {
            var wk = new JObject {
                ["id"] = "wk-short", ["type"] = "walkway", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 1,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0 },
                ["to"] = new JObject { ["x"] = 32, ["y"] = 2, ["z"] = 0 },
                ["cfg"] = new JObject { ["dir"] = "up", ["width"] = 2 },
            };
            // Floor at z = 0 plus ceiling blocks directly over the belt at z = 1 and z = 2.
            var cells = SolidFloor(0, 35, 0, 4, 0);
            for (int x = 5; x <= 25; x++) {
                cells.Add(new JObject { ["x"] = x, ["y"] = 2, ["z"] = 1, ["fill"] = "solid" });
                cells.Add(new JObject { ["x"] = x, ["y"] = 2, ["z"] = 2, ["fill"] = "solid" });
            }
            var index = ReadIndex(WrapSave("walkway-carve", cells, new JArray { wk }), out var doc);
            var rec = index.GetModule("wk-short");

            // Surgical fix #2: StationRampCarve.ForModule & RunsFor & Carve return EMPTY for level walkways!
            Assert.IsNull(StationRampCarve.ForModule(rec), "level walkway must return null from ForModule");
            Assert.AreEqual(0, StationRampCarve.RunsFor(rec).Count, "level walkway produces zero carve runs");
            Assert.AreEqual(0, StationRampCarve.Carve(index).Count, "level walkway never carves blocks above it");
            Assert.AreEqual(0, StationRampOpenings.RampSlopeCuts(doc.Modules).Count, "level walkway cuts no slopes");

            // 3D view: flat height (< 2.6 m), spans full 30 m run, animated belt moves and closes loop.
            var view = BuildVertical(wk);
            Assert.Greater(view.DocumentBounds.X1 - view.DocumentBounds.X0, 30.0, "30 m walkway spans its full run");
            Assert.Less(view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 2.6, "walkway stays flat");
            view.Apply(ModuleMotionState.Escalator("wk-short", 0.0, true, 1));
            var t0 = DocPoint(view, "tread-0");
            view.Apply(ModuleMotionState.Escalator("wk-short", 4.0, true, 1));
            var t4 = DocPoint(view, "tread-0");
            Assert.Greater(Vector3.Distance(t0, t4), 0.1f, "moving belt advances treads");
            view.Apply(ModuleMotionState.Escalator("wk-short", view.LoopSeconds, true, 1));
            Assert.LessOrEqual(Vector3.Distance(t0, DocPoint(view, "tread-0")), 1e-3f, "belt loop closes cleanly");

            // Walk graph: one-way Walkway edge with 2x rate, accessible to StepFree passengers.
            // Use two disconnected floor islands at x=0..2 and x=32..34 joined ONLY by the walkway so
            // reverse direction strictly tests one-way rejection.
            var islandCells = new JArray();
            foreach (var xRange in new[] { (0, 2), (32, 34) })
                for (int x = xRange.Item1; x <= xRange.Item2; x++)
                    for (int y = 0; y <= 4; y++)
                        islandCells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
            var islandIndex = ReadIndex(WrapSave("walkway-route", islandCells, new JArray { wk }), out var islandDoc);
            var graph = StationWalkGraphBuilder.Build(StationSessionProjection.Document(islandDoc, islandIndex),
                new StationWalkGraphOptions { IncludeGround = false });
            var wkServer = graph.Servers.FirstOrDefault(s => s.Kind == "walkway");
            Assert.IsNotNull(wkServer, "walkway registers a server");
            Assert.AreEqual(StationWalkGraphBuilder.WalkwayRate * 2.0, wkServer.Rate, 1e-6, "2-wide walkway scales rate by 2x");

            var planner = new StationRoutePlanner(graph);
            var forward = planner.Search("0,2,0", "34,2,0", StationRouteNeeds.Walking);
            Assert.IsTrue(forward.Found && forward.Kinds.Contains(WalkEdgeKind.Walkway), "forward rides walkway");
            var stepFree = planner.Search("0,2,0", "34,2,0", new StationRouteNeeds { StepFree = true });
            Assert.IsTrue(stepFree.Found && stepFree.Kinds.Contains(WalkEdgeKind.Walkway), "step-free passenger rides level walkway");
            var reverse = planner.Search("34,2,0", "0,2,0", StationRouteNeeds.Walking);
            Assert.IsFalse(reverse.Found, "one-way walkway rejects reverse traversal");

            // Save round-trip preserves walkway endpoints, dir, width.
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(doc), StationSource.None);
            var rWk = reloaded.Document.Modules.First(m => m.Id == "wk-short");
            Assert.AreEqual(2, rWk.From.Value.X, 1e-6);
            Assert.AreEqual(32, rWk.To.Value.X, 1e-6);
            Assert.AreEqual("up", rWk.Config.Text("dir"));
            Assert.AreEqual(2, StationRampRules.Width(rWk));
        }

        #endregion

        #region Canopy, Roofs & Pillars

        [Test]
        public void RoofRulesSupportedWidthsPostRowsAndMultiBoxCanopyLeaveShelteredAisleOpen() {
            Assert.AreEqual(4, StationRoofRules.SupportedWidth(4));
            Assert.AreEqual(8, StationRoofRules.SupportedWidth(8));
            Assert.AreEqual(12, StationRoofRules.SupportedWidth(12));
            Assert.AreEqual(4, StationRoofRules.SupportedWidth(99), "unsupported width clamps to 4 m");
            Assert.AreEqual(10.0, StationRoofRules.Top, 1e-9);
            Assert.AreEqual(9.88, StationRoofRules.Ridge, 1e-9);

            Assert.AreEqual((0, 3), StationRoofRules.PostRows(4));
            Assert.AreEqual((1, 6), StationRoofRules.PostRows(8));
            Assert.AreEqual((2, 9), StationRoofRules.PostRows(12));

            // Surgical fix #3: CanopyBodyBoxes exposes 8 slender post boxes + 1 overhead shell box.
            for (int rot = 0; rot < 4; rot++) {
                var canopyDraft = new StationEditDraft {
                    Id = "canopy-" + rot, Type = "roof", X = 0, Y = 0, Z = 0, Rotation = rot, Width = 4, Depth = 8,
                };
                canopyDraft.Set("variant", "canopy");
                var rec = StationModulePlacement.ToRecord(canopyDraft);

                var postCells = StationRoofRules.PostCells(rec);
                Assert.AreEqual(8, postCells.Count, $"rot={rot}: 2 rows x 4 bay cells = 8 posts");
                var boxes = StationRoofRules.CanopyBodyBoxes(rec);
                Assert.AreEqual(9, boxes.Count, $"rot={rot}: 8 post boxes + 1 lowered overhead shell box");

                // Overhead shell spans z in [4.8, 6.0].
                var shell = boxes[boxes.Count - 1];
                Assert.AreEqual(4.8, shell.Z0, 1e-6, "lowered shell eave clearance starts at 4.8 m");
                Assert.AreEqual(6.0, shell.Z1, 1e-6, "lowered shell ridge closes at 6.0 m");

                if (rot == 0) {
                    // Sheltered aisle at (1, 3, z = 1..4) must NOT overlap any post or overhead shell!
                    var aisleBlock = new StationBox(1, 3, 1, 2, 4, 4);
                    Assert.IsFalse(boxes.Any(b => b.Overlaps(aisleBlock)),
                        "sheltered aisle between post rows stays clear for benches, gates, and 3 m lifts");
                    // A block on a post cell (1, 1, z = 1..2) MUST overlap a post box!
                    var postBlock = new StationBox(1, 1, 1, 2, 2, 2);
                    Assert.IsTrue(boxes.Any(b => b.Overlaps(postBlock)), "post column is reserved");
                    // A block at shell height (1, 3, z = 5..6) MUST overlap the overhead shell box!
                    var roofBlock = new StationBox(1, 3, 5, 2, 4, 6);
                    Assert.IsTrue(boxes.Any(b => b.Overlaps(roofBlock)), "lowered roof shell is reserved");
                }
            }
        }

        [Test]
        public void RoofShellTrussTaperedCanopyAndLowerPlateRenderWithNonDefaultWidthsRotationsAndFinish() {
            var modules = new JArray {
                new JObject {
                    ["id"] = "roof-shell-8", ["type"] = "roof", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["w"] = 4, ["d"] = 8, ["rot"] = 1,
                    ["cfg"] = new JObject { ["variant"] = "shell", ["finish"] = "wall.enamel#2266cc" },
                },
                new JObject {
                    ["id"] = "roof-truss-12", ["type"] = "roof", ["x"] = 20, ["y"] = 0, ["z"] = 0, ["w"] = 4, ["d"] = 12, ["rot"] = 2,
                    ["cfg"] = new JObject { ["variant"] = "truss", ["finish"] = "floor.tile" },
                },
                new JObject {
                    ["id"] = "roof-tapered-8", ["type"] = "roof", ["x"] = 40, ["y"] = 0, ["z"] = 0, ["w"] = 4, ["d"] = 8, ["rot"] = 3,
                    ["cfg"] = new JObject { ["variant"] = "tapered-truss", ["finish"] = "floor.concrete" },
                },
                new JObject {
                    ["id"] = "roof-canopy-8", ["type"] = "roof", ["x"] = 60, ["y"] = 0, ["z"] = 0, ["w"] = 4, ["d"] = 8, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "canopy", ["finish"] = "ceil.steel" },
                },
                new JObject {
                    ["id"] = "roof-plate-low", ["type"] = "roof", ["x"] = 80, ["y"] = 0, ["z"] = 5, ["w"] = 1, ["d"] = 1, ["rot"] = 0,
                    ["cfg"] = new JObject { ["plateSnap"] = "lower", ["finish"] = "ceil.steel" },
                },
            };
            var save = WrapSave("roof-variants", new JArray(), modules);
            var structure = new StationStructureModuleRenderer();
            var world = BuildWorld(save, structure);

            var byId = world.Document.Modules.ToDictionary(m => m.Id, StringComparer.Ordinal);
            foreach (var id in new[] { "roof-shell-8", "roof-truss-12", "roof-tapered-8", "roof-canopy-8", "roof-plate-low" }) {
                Assert.IsTrue(world.TryGetModule(id, out var rec), "roof registered: " + id);
                Assert.AreEqual("roof", rec.Part, id + " part name");
                Assert.AreEqual(StationPartRole.Roof, StationViewFeature.RoleOf(rec, byId),
                    id + " answers Hide Roof visibility role");
                Assert.Greater(rec.View.GetComponentsInChildren<MeshRenderer>(true).Count(r => r.enabled), 0,
                    id + " drew enabled geometry");
            }

            // Verify rotated dimensions & elevations.
            Assert.IsTrue(world.TryGetModule("roof-shell-8", out var shell));
            Assert.AreEqual(8.0, shell.Bounds.X1 - shell.Bounds.X0, 0.15, "rot=1 maps 8 m breadth onto X");
            Assert.AreEqual(4.0, shell.Bounds.Y1 - shell.Bounds.Y0, 0.15, "rot=1 maps 4 m bay onto Y");
            Assert.AreEqual(11.0, shell.Bounds.Z1, 0.15, "shell ridge tops at z+1+10 = 11 m");

            Assert.IsTrue(world.TryGetModule("roof-truss-12", out var truss));
            Assert.AreEqual(4.0, truss.Bounds.X1 - truss.Bounds.X0, 0.15);
            Assert.AreEqual(12.0, truss.Bounds.Y1 - truss.Bounds.Y0, 0.15);
            Assert.AreEqual(11.0, truss.Bounds.Z1, 0.15);

            Assert.IsTrue(world.TryGetModule("roof-tapered-8", out var tapered));
            Assert.AreEqual(8.0, tapered.Bounds.X1 - tapered.Bounds.X0, 0.15, "rot=3 maps 8 m breadth onto X");
            Assert.AreEqual(4.0, tapered.Bounds.Y1 - tapered.Bounds.Y0, 0.15);

            Assert.IsTrue(world.TryGetModule("roof-canopy-8", out var canopy));
            Assert.AreEqual(1.0, canopy.Bounds.Z0, 0.05, "canopy posts ground on floor top z+1");
            Assert.AreEqual(6.0, canopy.Bounds.Z1, 0.15, "canopy shell tops at 6 m");

            Assert.IsTrue(world.TryGetModule("roof-plate-low", out var plate));
            Assert.AreEqual(5.0, plate.Bounds.Z0, 0.02, "lower plate snap sits at module z");
            Assert.AreEqual(5.25, plate.Bounds.Z1, 0.02, "plate thickness is 0.25 m");
        }

        [Test]
        public void PillarLengthsTwoToSixAcrossGaugesBuildGeometryClearanceRoundTripAndRefuseHoleOrCeiling() {
            CollectionAssert.AreEqual(new[] { 2, 3, 4, 5, 6 }, StationPillarPlanning.Lengths);

            // Floor at z = 0 with a dug hole at (1, 1) and an overhead ceiling block at (8, 8, 3).
            var cells = new JArray();
            for (int x = 0; x <= 10; x++) {
                for (int y = 0; y <= 10; y++) {
                    if (x == 1 && y == 1) continue;
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            cells.Add(new JObject { ["x"] = 8, ["y"] = 8, ["z"] = 3, ["fill"] = "solid" });
            var index = ReadIndex(WrapSave("pillar-check", cells, new JArray()), out _);

            var placedModules = new JArray();
            int slotX = 2;
            foreach (var (toolType, expectedSize, expectedWidth) in new[] {
                ("pillar-slim", "slim", 0.3),
                ("pillar-thick", "thick", 1.0),
            }) {
                foreach (int len in StationPillarPlanning.Lengths) {
                    var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                        ToolType = toolType, Rotation = 0, PillarLength = len,
                        Hit = StationCellFixture.Hit(slotX, 4, 0, true).Cell,
                    });
                    Assert.IsTrue(plan.Ok, $"{toolType} len={len}: {plan.Reason}");
                    Assert.AreEqual(expectedSize, plan.Candidate.Text("size"));
                    Assert.AreEqual(len, plan.Candidate.Number("height", 0), 1e-6);

                    var rec = StationModulePlacement.ToRecord(plan.Candidate);
                    Assert.IsTrue(StationFootprints.TryClearance(rec, out var box, out var unsup), unsup);
                    Assert.AreEqual(expectedWidth, box.X1 - box.X0, 1e-6, $"{toolType} clearance width");
                    Assert.AreEqual(len, box.Z1 - box.Z0, 1e-6, $"{toolType} len={len} clearance height");

                    plan.Candidate.Id = $"p-{expectedSize}-{len}";
                    placedModules.Add(StationModuleEdits.ToSaveRecord(plan.Candidate));
                    slotX = Math.Min(9, slotX + 1);
                }

                // Refusal over dug hole at (1, 1, -5) (below virtual grade so missing cell is a real void).
                var holeIndex = ReadIndex(WrapSave("pillar-hole", SolidFloor(2, 5, 2, 5, -5), new JArray()), out _);
                var overHole = StationModulePlacement.Resolve(holeIndex, new StationPlacementRequest {
                    ToolType = toolType, Rotation = 0, PillarLength = 5,
                    Hit = StationCellFixture.Hit(1, 1, -5, true).Cell,
                });
                Assert.IsFalse(overHole.Ok, $"{toolType} over hole must be refused");
                Assert.AreEqual("floor", overHole.Reason);

                // Refusal when ceiling block at (8, 8, 3) overlaps a 5 m pillar (z 1..6), while a 2 m pillar (z 1..3) clears it.
                var tallBlocked = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                    ToolType = toolType, Rotation = 0, PillarLength = 5,
                    Hit = StationCellFixture.Hit(8, 8, 0, true).Cell,
                });
                Assert.IsFalse(tallBlocked.Ok, $"{toolType} 5 m pillar hitting ceiling block at z=3 must fail");
                Assert.AreEqual("occupied", tallBlocked.Reason);

                var shortClear = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                    ToolType = toolType, Rotation = 0, PillarLength = 2,
                    Hit = StationCellFixture.Hit(8, 8, 0, true).Cell,
                });
                Assert.IsTrue(shortClear.Ok, $"{toolType} 2 m pillar stops at z=3 underside cleanly: {shortClear.Reason}");
            }

            // Render every gauge & length via StationStructureModuleRenderer and verify round-trip.
            // Spread placements across distinct columns so bounds don't collide.
            for (int i = 0; i < placedModules.Count; i++) {
                placedModules[i]["x"] = i * 2;
                placedModules[i]["y"] = 4;
            }
            var renderSave = WrapSave("pillar-render", new JArray(), placedModules);
            var world = BuildWorld(renderSave, new StationStructureModuleRenderer());
            foreach (JObject m in placedModules) {
                string id = (string)m["id"];
                double h = (double)m["cfg"]["height"];
                double w = (string)m["cfg"]["size"] == "thick" ? 1.0 : 0.3;
                Assert.IsTrue(world.TryGetModule(id, out var viewRec), "rendered pillar " + id);
                Assert.AreEqual(1.0, viewRec.Bounds.Z0, 0.03, id + " base on floor top");
                Assert.AreEqual(1.0 + h, viewRec.Bounds.Z1, 0.03, id + " rendered height");
                Assert.AreEqual(w, viewRec.Bounds.X1 - viewRec.Bounds.X0, 0.04, id + " rendered cross-section width");
            }
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(world.Document), StationSource.None);
            Assert.AreEqual(placedModules.Count, reloaded.Document.Modules.Count);
        }

        [Test]
        public void PillarExtensionGrowsMixedSectionsRefusesCeilingAndRefusesBridgeOwnedPier() {
            var freePillar = new JObject {
                ["id"] = "pillar-free", ["type"] = "pillar", ["x"] = 4, ["y"] = 4, ["z"] = 0, ["rot"] = 3,
                ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 5 },
            };
            var bridgeTrack = new JObject {
                ["id"] = "track-b1", ["type"] = "track", ["x"] = 0, ["y"] = 8, ["z"] = 5, ["w"] = 16, ["d"] = 3, ["rot"] = 0,
                ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["bridge"] = true, ["bridgeRailing"] = "railing" },
            };
            var bridgePier = new JObject {
                ["id"] = "track-b1:pillar:4", ["type"] = "pillar", ["x"] = 4, ["y"] = 9, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["size"] = "thick", ["height"] = 5, ["bridgeId"] = "track-b1" },
            };
            var cells = SolidFloor(0, 16, 0, 12, 0);
            cells.Add(new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 11, ["fill"] = "solid" }); // overhead cap for refusal test

            var host = OpenHost(WrapSave("pillar-ext", cells, new JArray { freePillar, bridgeTrack, bridgePier })
                .ToString(Formatting.None));
            Assert.IsTrue(StationBridgePillars.PillarSupportsBridge(
                host.Index.GetModule("track-b1:pillar:4"), host.Index.GetModule("track-b1")),
                "bridge pier supports deck at exact elevation");

            // Grow free slim pillar by 2 m (5 -> 7) then 3 m (7 -> 10), keeping id and slim offset rot = 3.
            Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out var selCode), selCode);
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "pillar-slim", ["pillarLength"] = 2 });
            Assert.IsTrue(StationPillarTool.Begin(host, StationCellFixture.Hit(4, 4, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var h7 = host.Index.GetModule("pillar-free");
            Assert.AreEqual(7.0, h7.Config.Number("height", 0), 1e-6);
            Assert.AreEqual(3, h7.Rotation, "extension preserves slim in-cell offset");

            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "pillar-slim", ["pillarLength"] = 3 });
            Assert.IsTrue(StationPillarTool.Begin(host, StationCellFixture.Hit(4, 4, 0, true),
                Pointer(100, 100, 100), 0, out code, out reason), code ?? reason);
            Assert.AreEqual(10.0, host.Index.GetModule("pillar-free").Config.Number("height", 0), 1e-6);

            // Growing another 2 m hits the overhead block at z = 11 -> refused with "occupied", height unchanged.
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "pillar-slim", ["pillarLength"] = 2 });
            int revBefore = host.CurrentRevision;
            Assert.IsTrue(StationPillarTool.Begin(host, StationCellFixture.Hit(4, 4, 0, true),
                Pointer(100, 100, 200), 0, out _, out reason));
            Assert.AreEqual("occupied", reason, "overhead ceiling block refuses pillar growth");
            Assert.AreEqual(revBefore, host.CurrentRevision);
            Assert.AreEqual(10.0, host.Index.GetModule("pillar-free").Config.Number("height", 0), 1e-6);

            // Undo steps back 10 -> 7 cleanly.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(7.0, host.Index.GetModule("pillar-free").Config.Number("height", 0), 1e-6);

            // Extending a bridge-owned pier (cfg.bridgeId) MUST be refused with "bridge-pier".
            StationToolSelection.ApplySettings(new JObject { ["moduleType"] = "pillar-thick", ["pillarLength"] = 5 });
            int revPier = host.CurrentRevision;
            Assert.IsTrue(StationPillarTool.Begin(host, StationCellFixture.Hit(4, 9, 0, true),
                Pointer(100, 100, 300), 0, out _, out reason));
            Assert.AreEqual("bridge-pier", reason, "bridge-owned pier must refuse manual extension");
            Assert.AreEqual(revPier, host.CurrentRevision);
            Assert.AreEqual(5.0, host.Index.GetModule("track-b1:pillar:4").Config.Number("height", 0), 1e-6);

            // PillarAt finds slim pillars across all 9 in-cell offsets and distinguishes stacked storey bands.
            for (int rot = 0; rot < 9; rot++) {
                var slimRot = new JObject {
                    ["id"] = "slim-" + rot, ["type"] = "pillar", ["x"] = 3, ["y"] = 3, ["z"] = 0, ["rot"] = rot,
                    ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 5 },
                };
                var rotIdx = ReadIndex(WrapSave("slim-rot", SolidFloor(0, 6, 0, 6, 0), new JArray { slimRot }), out _);
                Assert.AreEqual("slim-" + rot, StationPillarPlanning.PillarAt(rotIdx, 3, 3, 0)?.Id,
                    $"slim in-cell offset rot={rot} resolves by anchor cell");
            }
            var loPillar = new JObject {
                ["id"] = "p-lo", ["type"] = "pillar", ["x"] = 3, ["y"] = 3, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 5 },
            };
            var hiPillar = new JObject {
                ["id"] = "p-hi", ["type"] = "pillar", ["x"] = 3, ["y"] = 3, ["z"] = 5, ["rot"] = 0,
                ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 5 },
            };
            var tallPillar = new JObject {
                ["id"] = "p-tall", ["type"] = "pillar", ["x"] = 5, ["y"] = 5, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject { ["size"] = "slim", ["height"] = 8 },
            };
            var stackIdx = ReadIndex(WrapSave("pillar-stack", SolidFloor(0, 8, 0, 8, 0, 5),
                new JArray { loPillar, hiPillar, tallPillar }), out _);
            Assert.AreEqual("p-lo", StationPillarPlanning.PillarAt(stackIdx, 3, 3, 0)?.Id);
            Assert.AreEqual("p-hi", StationPillarPlanning.PillarAt(stackIdx, 3, 3, 5)?.Id);
            Assert.AreEqual("p-tall", StationPillarPlanning.PillarAt(stackIdx, 5, 5, 0)?.Id);
            Assert.AreEqual("p-tall", StationPillarPlanning.PillarAt(stackIdx, 5, 5, 4)?.Id);
        }

        #endregion

        #region Exits & Overground

        [Test]
        public void ExitAutoLetteringIncrementsAndReusesDeletedGapAndHeadHouseRefusesUnderground() {
            var host = OpenHost(WrapSave("exit-letters", SolidFloor(0, 30, 0, 15, -5, 0, 5), new JArray())
                .ToString(Formatting.None));

            // Place three exits sequentially: A -> B -> C.
            var placedIds = new List<string>();
            int[] xs = { 4, 14, 24 };
            string[] expected = { "A", "B", "C" };
            for (int i = 0; i < 3; i++) {
                var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                    ToolType = "exit-covered-2", Rotation = 0,
                    Hit = StationCellFixture.Hit(xs[i], 8, 0, true).Cell,
                });
                Assert.IsTrue(plan.Ok, $"exit {expected[i]}: {plan.Reason}");
                Assert.AreEqual(expected[i], plan.Candidate.Text("name"), "auto-letter assigns " + expected[i]);
                plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "exit");
                Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null,
                    "place exit", null, out _, out var code), code);
                placedIds.Add(plan.Candidate.Id);
            }

            // Delete exit B and verify the next placed exit reuses "B" before advancing to "D".
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, placedIds[1],
                "delete B", null, out _, out var delCode), delCode);
            Assert.AreEqual("B", StationModuleFamilies.NextExitLetter(host.Index), "deleted gap B is reused");
            var reusePlan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "exit-covered-2", Rotation = 0,
                Hit = StationCellFixture.Hit(14, 8, 0, true).Cell,
            });
            Assert.IsTrue(reusePlan.Ok, reusePlan.Reason);
            Assert.AreEqual("B", reusePlan.Candidate.Text("name"));

            // Head-house exit placed underground (z = -5) or elevated (z = 5) is refused with "exit-on-slab".
            var underground = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "exit-covered-2", Rotation = 0,
                Hit = StationCellFixture.Hit(14, 8, -5, true).Cell,
            });
            Assert.IsFalse(underground.Ok, "head-house must be refused underground");
            Assert.AreEqual("exit-on-slab", underground.Reason);

            var elevated = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                ToolType = "exit-covered-2", Rotation = 0,
                Hit = StationCellFixture.Hit(14, 8, 5, true).Cell,
            });
            Assert.IsFalse(elevated.Ok, "head-house must be refused on elevated storey z = 5");
            Assert.AreEqual("exit-on-slab", elevated.Reason);
        }

        [Test]
        public void DoorwayAndVirtualExitsRegisterWalkGraphNodesAndSpawnOnGroundAndElevatedStoreys() {
            var cells = SolidFloor(0, 12, 0, 8, -5, 0, 5);
            var modules = new JArray {
                new JObject {
                    ["id"] = "exit-doorway-elev", ["type"] = "exit", ["x"] = 2, ["y"] = 4, ["z"] = 5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["style"] = "doorway", ["bays"] = 2, ["headHouse"] = false, ["inRate"] = 7200, ["open"] = true },
                },
                new JObject {
                    ["id"] = "exit-virtual-elev", ["type"] = "exit", ["x"] = 10, ["y"] = 4, ["z"] = 5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "B", ["style"] = "virtual", ["headHouse"] = false, ["inRate"] = 0, ["open"] = true },
                },
                new JObject {
                    ["id"] = "exit-virtual-under", ["type"] = "exit", ["x"] = 6, ["y"] = 4, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "C", ["style"] = "virtual", ["headHouse"] = false, ["inRate"] = 900, ["open"] = true },
                },
            };
            var index = ReadIndex(WrapSave("doorway-virtual", cells, modules), out var doc);
            var projected = StationSessionProjection.Document(doc, index);
            var graph = StationWalkGraphBuilder.Build(projected, new StationWalkGraphOptions { IncludeGround = false });

            Assert.AreEqual(3, graph.Exits.Count, "all three doorway/virtual exits resolve to walk-graph nodes");
            var elevA = graph.Exits.First(e => e.Id == "exit-doorway-elev");
            var elevB = graph.Exits.First(e => e.Id == "exit-virtual-elev");
            var underC = graph.Exits.First(e => e.Id == "exit-virtual-under");
            Assert.AreEqual(6.0, graph.NodeZ[elevA.Node], 1e-6, "elevated doorway sits on z = +5 floor top (6 m)");
            Assert.AreEqual(6.0, graph.NodeZ[elevB.Node], 1e-6, "elevated virtual exit sits on z = +5 floor top (6 m)");
            Assert.AreEqual(-4.0, graph.NodeZ[underC.Node], 1e-6, "underground virtual exit sits on z = -5 floor top (-4 m)");

            // Live simulation spawns passengers on the elevated z = +5 floor from exit A heading to exit B.
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected, Day = AlwaysOpenDay(), Seed = 11,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { AlightPerTrain = 0 },
            });
            for (int t = 0; t < 30; t++) session.Advance(1.0);
            Assert.Greater(session.Services.Spawned, 0, "elevated doorway/virtual exits spawn live crowd");
            Assert.IsTrue(session.PassengerFrames().Any(p => Math.Abs(p.Z - 6.0) < 0.25),
                "spawned passengers walk on the elevated z = +5 storey");
        }

        [Test]
        public void ElevatedStationServiceAndBridgeDeckRailingsRenderWithBridgeFinish() {
            // 1. Elevated station service at z = +5: floor, track (bridge), platform-edge, and crowd service.
            var cells = SolidFloor(0, 18, 2, 7, 5);
            var line = new JObject {
                ["id"] = "1", ["name"] = "Line 1", ["colour"] = "#c70541",
                ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail",
                ["direction"] = "up", ["psd"] = "full",
                ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
            };
            var serviceModules = new JArray {
                new JObject {
                    ["id"] = "exit-elev", ["type"] = "exit", ["x"] = 2, ["y"] = 5, ["z"] = 5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["style"] = "virtual", ["headHouse"] = false, ["inRate"] = 7200, ["open"] = true },
                },
                new JObject {
                    ["id"] = "track-elev", ["type"] = "track", ["x"] = 4, ["y"] = 0, ["z"] = 5, ["w"] = 14, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject {
                        ["line"] = "1", ["dir"] = "up", ["bridge"] = true,
                        ["bridgeRailing"] = "railing", ["bridgeFinish"] = "floor.concrete",
                    },
                },
                new JObject {
                    ["id"] = "edge-elev", ["type"] = "platform-edge", ["x"] = 4, ["y"] = 3, ["z"] = 5, ["w"] = 12, ["d"] = 1, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-elev", ["dir"] = "up", ["side"] = "right" },
                },
            };
            var serviceSave = WrapSave("elevated-service", cells, serviceModules, new JArray { line });
            var serviceIndex = ReadIndex(serviceSave, out var serviceDoc);
            var projected = StationSessionProjection.Document(serviceDoc, serviceIndex);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = projected, Day = AlwaysOpenDay(), Seed = 19,
                StartSimTime = 8 * 3600, StartPlaying = true,
                WalkOptions = new StationWalkGraphOptions { IncludeGround = false },
                Services = new StationServiceOptions { AlightPerTrain = 20 },
            });
            Assert.AreEqual(1, session.WalkGraph.Platforms.Count, "elevated platform edge registers on z = +5");
            for (int t = 0; t < 40; t++) session.Advance(1.0);
            Assert.Greater(session.Services.Spawned, 0, "elevated station spawns crowd");
            Assert.IsTrue(session.PassengerFrames().Any(p => Math.Abs(p.Z - 6.0) < 0.25),
                "crowd stands and walks on elevated platform surface z = 6 m");

            // 2. Bridge deck + all three railing modes ("railing", "sound-barrier-half", "sound-barrier") + bridgeFinish.
            var bridgeModules = new JArray {
                new JObject {
                    ["id"] = "bridge-railing", ["type"] = "track", ["x"] = 0, ["y"] = 0, ["z"] = 5, ["w"] = 16, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject {
                        ["line"] = "1", ["dir"] = "up", ["bridge"] = true,
                        ["bridgeRailing"] = "railing", ["bridgeFinish"] = "floor.concrete",
                    },
                },
                new JObject {
                    ["id"] = "bridge-half", ["type"] = "track", ["x"] = 0, ["y"] = 10, ["z"] = 5, ["w"] = 16, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject {
                        ["line"] = "1", ["dir"] = "up", ["bridge"] = true,
                        ["bridgeRailing"] = "sound-barrier-half", ["bridgeFinish"] = "floor.tile",
                    },
                },
                new JObject {
                    ["id"] = "bridge-full", ["type"] = "track", ["x"] = 0, ["y"] = 20, ["z"] = 5, ["w"] = 16, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject {
                        ["line"] = "1", ["dir"] = "up", ["bridge"] = true,
                        ["bridgeRailing"] = "sound-barrier", ["bridgeFinish"] = "wall.enamel#2266cc",
                    },
                },
                new JObject {
                    ["id"] = "track-ground", ["type"] = "track", ["x"] = 0, ["y"] = 30, ["z"] = 0, ["w"] = 16, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up" },
                },
            };
            var bridgeSave = WrapSave("bridge-variants", new JArray(), bridgeModules, new JArray { line });
            var world = BuildWorld(bridgeSave, new StationStreetModuleRenderer());

            bool HasChild(StationViewRecord rec, string name) =>
                rec.View.GetComponentsInChildren<Transform>(true).Any(t => t.name == name);

            Assert.IsTrue(world.TryGetModule("bridge-railing", out var bRail));
            Assert.IsTrue(HasChild(bRail, "track-deck"), "bridge draws deck");
            Assert.IsFalse(HasChild(bRail, "track-barrier-panel"), "railing variant draws rails, not barrier panels");
            Assert.AreEqual(5.0 + RailBridgeOptions.BridgeRailingTop, bRail.Bounds.Z1, 0.1, "railing top height");

            Assert.IsTrue(world.TryGetModule("bridge-half", out var bHalf));
            Assert.IsTrue(HasChild(bHalf, "track-deck"), "half-barrier bridge draws deck");
            Assert.IsTrue(HasChild(bHalf, "track-barrier-panel"), "half-barrier bridge draws barrier panels");
            Assert.AreEqual(5.0 + 2.0, bHalf.Bounds.Z1, 0.1, "half-height sound barrier tops at z + 2 m");

            Assert.IsTrue(world.TryGetModule("bridge-full", out var bFull));
            Assert.IsTrue(HasChild(bFull, "track-deck"), "full-barrier bridge draws deck");
            Assert.IsTrue(HasChild(bFull, "track-barrier-panel"), "full-barrier bridge draws barrier panels");
            Assert.AreEqual(5.0 + RailBridgeOptions.BridgeBarrierTop, bFull.Bounds.Z1, 0.1,
                "full-height sound barrier tops at z + 3.5 m");

            Assert.IsTrue(world.TryGetModule("track-ground", out var gTrack));
            Assert.IsFalse(HasChild(gTrack, "track-deck"), "non-bridge ground track has no bridge deck");
            Assert.IsFalse(HasChild(gTrack, "track-barrier-panel"), "non-bridge ground track has no barrier panels");

            // Save round-trip preserves cfg.bridge, cfg.bridgeRailing, and cfg.bridgeFinish.
            var reloaded = StationDocumentReader.Read(StationDocumentReader.Write(world.Document), StationSource.None);
            var rFull = reloaded.Document.Modules.First(m => m.Id == "bridge-full");
            Assert.IsTrue(rFull.Config.Bool("bridge"));
            Assert.AreEqual("sound-barrier", rFull.Config.Text("bridgeRailing"));
            Assert.AreEqual("wall.enamel#2266cc", rFull.Config.Text("bridgeFinish"));
        }

        #endregion
    }
}
