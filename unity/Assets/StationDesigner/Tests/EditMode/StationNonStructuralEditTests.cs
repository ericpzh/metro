using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D2 parity tests closing <c>nonstructural-updates.test.mjs</c> and
    /// <c>performance-policy.test.mjs</c> edit classification invariants:
    /// exhaustive <see cref="StationEditClassifier.Classify"/> / <see cref="StationEditClassifier.ClassifyLocal"/>
    /// matrix, live exit <c>open: false</c> preservation of <see cref="StationWalkGraph"/> and
    /// <see cref="StationServiceRuntime.GraphEpoch"/>, and <see cref="StationSimulationSession.Restart"/>
    /// full snapshot parity against a freshly constructed session.
    /// </summary>
    public sealed class StationNonStructuralEditTests {
        GameObject rootObject;

        [SetUp]
        public void SetUp() {
            StationToolSelection.Reset();
            StationEditSession.Reset();
            rootObject = new GameObject("StationNonStructuralEditTests");
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (rootObject != null) UnityEngine.Object.DestroyImmediate(rootObject);
            rootObject = null;
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationToolSelection.Reset();
            StationEditSession.Reset();
            PassengerPoseFeeds.Clear();
        }

        static StationGameHost CreateHost() {
            var hostGo = new GameObject(StationGameHost.ObjectName);
            hostGo.transform.SetParent(GameObject.Find("StationNonStructuralEditTests").transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);
            StationEditFeature.Attach(host);
            StationEditHost.Ensure().Bind(host);
            return host;
        }

        static JObject BaseFixture() {
            var cells = new JArray();
            for (int x = 0; x <= 10; x++) {
                cells.Add(new JObject {
                    ["x"] = x, ["y"] = 0, ["z"] = 0, ["fill"] = "solid",
                    ["zone"] = "unpaid",
                    ["finish"] = new JObject { ["top"] = "floor.tile" },
                });
            }
            var lines = new JArray {
                new JObject {
                    ["id"] = "1",
                    ["name"] = "1号线",
                    ["nameEn"] = "Line 1",
                    ["colour"] = "#f3d03e",
                    ["stock"] = "A",
                    ["cars"] = 6,
                    ["power"] = "catenary",
                    ["psd"] = "full",
                    ["direction"] = "up",
                    ["upTerminus"] = "广州东站",
                    ["downTerminus"] = "西塱",
                    ["upTerminusEn"] = "Guangzhou East",
                    ["downTerminusEn"] = "Xilang",
                    ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
                },
            };
            var modules = new JArray {
                new JObject {
                    ["id"] = "exit-a", ["type"] = "exit", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["inRate"] = 1800, ["open"] = true, ["style"] = "virtual", ["headHouse"] = false },
                },
                new JObject {
                    ["id"] = "exit-b", ["type"] = "exit", ["x"] = 10, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "B", ["inRate"] = 1800, ["open"] = true, ["style"] = "virtual", ["headHouse"] = false },
                },
                new JObject {
                    ["id"] = "bench-1", ["type"] = "bench", ["x"] = 5, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1" },
                },
            };
            return new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "测试站",
                ["nameEn"] = "Test Station",
                ["city"] = "guangzhou",
                ["seed"] = 12345,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["service"] = new JObject { ["from"] = 21600, ["to"] = 84600 },
                ["peaks"] = new JArray {
                    new JObject { ["from"] = 27000, ["to"] = 32400 },
                    new JObject { ["from"] = 63000, ["to"] = 68400 },
                },
                ["demand"] = new JObject {
                    ["workday"] = new JObject { ["amPeak"] = 1.6, ["pmPeak"] = 1.4, ["sharpness"] = 1.0 },
                    ["offday"] = new JObject { ["amPeak"] = 0.8, ["pmPeak"] = 1.1, ["sharpness"] = 0.7 },
                },
                ["calendar"] = new JObject {
                    ["epoch"] = "2026-01-01",
                    ["holidays"] = new JArray { "2026-01-01" },
                },
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = lines,
                },
            };
        }

        static StationReadResult Read(JObject json) {
            var read = StationDocumentReader.Read(json.ToString(Formatting.None), new StationSource("nonstruct", ""));
            Assert.IsNotNull(read.Document, "read failed");
            return read;
        }

        static StationDocumentEditKind ClassifyMutated(JObject beforeJson, Action<JObject> mutate) {
            var afterJson = (JObject)beforeJson.DeepClone();
            mutate(afterJson);
            var before = Read(beforeJson);
            var after = Read(afterJson);
            return StationEditClassifier.Classify(before.Document, after.Document);
        }

        /* ---------------------------------------- exhaustive classifier matrix */

        [Test]
        public void ClassifierAcceptsAllCosmeticMetadataLineExitFinishAndInertDecorEdits() {
            var baseJson = BaseFixture();
            var baseRead = Read(baseJson);

            // Station metadata.
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["name"] = "体育西路"), "station name");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["nameEn"] = "Tiyu Xilu"), "station nameEn");

            // Line presentation fields.
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["name"] = "3号线"), "line name");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["colour"] = "#123456"), "line colour");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["upTerminus"] = "天河客运站"), "line upTerminus");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["downTerminus"] = "番禺广场"), "line downTerminus");

            // Exit name, inRate, open — verify Classify AND ClassifyLocal equivalence!
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["modules"][0]["cfg"]["name"] = "C"), "exit name");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["modules"][0]["cfg"]["inRate"] = 450), "exit inRate");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, ClassifyMutated(baseJson, j => j["static"]["modules"][0]["cfg"]["open"] = false), "exit open");

            var localExit = StationLocalEdit.TryApplyExitSettings(baseRead, "exit-a", true, "C", true, 450, true, false, "nonstruct", out var exitCode);
            Assert.IsNotNull(localExit, exitCode ?? "local exit edit failed");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, localExit), "ClassifyLocal exit settings");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.Classify(baseRead.Document, localExit.Document), "Classify exit settings");

            // Same-speed top finish (floor.tile -> floor.marble, both speed 1.0, cover=false, track=false) & wall side paint.
            Assert.AreEqual(StationDocumentEditKind.Cosmetic,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["finish"]["top"] = "floor.marble"),
                "same-speed top finish floor.tile -> floor.marble");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["finish"]["n"] = "wall.enamel#ffaa00"),
                "wall side face paint");

            var sameSpeedPatch = new StationCellPatch();
            sameSpeedPatch.Add(StationCellWrite.PaintFace(new StationCellKey(0, 0, 0), "top", "floor.marble"));
            var localTopPaint = StationLocalEdit.TryApplyCells(baseRead, sameSpeedPatch, "nonstruct", out var topCode);
            Assert.IsNotNull(localTopPaint, topCode ?? "local top paint failed");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, localTopPaint), "ClassifyLocal same-speed top");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.Classify(baseRead.Document, localTopPaint.Document), "Classify same-speed top");

            var sidePatch = new StationCellPatch();
            sidePatch.Add(StationCellWrite.PaintFace(new StationCellKey(0, 0, 0), "n", "wall.enamel"));
            var localSidePaint = StationLocalEdit.TryApplyCells(baseRead, sidePatch, "nonstruct", out var sideCode);
            Assert.IsNotNull(localSidePaint, sideCode ?? "local side paint failed");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, localSidePaint), "ClassifyLocal wall side paint");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.Classify(baseRead.Document, localSidePaint.Document), "Classify wall side paint");

            // Inert decor modules inside existing ground window (x=2, y=0): tactile, urinal, tree, billboard, roof hanger.
            var billboardDraft = new StationEditDraft { Id = "dec-billboard", Type = "billboard", X = 2, Y = 0, Z = 0 };
            billboardDraft.Set("poster", "ad-01");
            var inertDrafts = new[] {
                new StationEditDraft { Id = "dec-tactile", Type = "tactile", X = 2, Y = 0, Z = 0 },
                new StationEditDraft { Id = "dec-urinal", Type = "urinal", X = 2, Y = 0, Z = 0 },
                new StationEditDraft { Id = "dec-tree", Type = "tree", X = 2, Y = 0, Z = 0 },
                billboardDraft,
            };
            foreach (var draft in inertDrafts) {
                var localAdd = StationLocalEdit.TryApplyModule(baseRead, StationModuleEditMode.Add, draft, null, "nonstruct", out var modCode);
                Assert.IsNotNull(localAdd, $"{draft.Type}: {modCode}");
                Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, localAdd),
                    $"ClassifyLocal inert {draft.Type}");
                Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.Classify(baseRead.Document, localAdd.Document),
                    $"Classify inert {draft.Type}");
            }

            var roofHanger = new StationEditDraft { Id = "dec-hanger-roof", Type = "hanger", X = 2, Y = 0, Z = 0 };
            roofHanger.Set("mount", "roof");
            var localRoofHanger = StationLocalEdit.TryApplyModule(baseRead, StationModuleEditMode.Add, roofHanger, null, "nonstruct", out var rhCode);
            Assert.IsNotNull(localRoofHanger, rhCode);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, localRoofHanger), "ClassifyLocal roof hanger");
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.Classify(baseRead.Document, localRoofHanger.Document), "Classify roof hanger");
        }

        [Test]
        public void ClassifierMarksServicePeaksDemandAndCalendarAsDayOnlyAndLineHeadwayFailClosed() {
            var baseJson = BaseFixture();

            Assert.AreEqual(StationDocumentEditKind.DayOnly,
                ClassifyMutated(baseJson, j => j["service"]["from"] = 23400), "service window");
            Assert.AreEqual(StationDocumentEditKind.DayOnly,
                ClassifyMutated(baseJson, j => j["peaks"][0]["to"] = 34200), "peaks");
            Assert.AreEqual(StationDocumentEditKind.DayOnly,
                ClassifyMutated(baseJson, j => j["demand"]["workday"]["amPeak"] = 2.0), "demand");
            Assert.AreEqual(StationDocumentEditKind.DayOnly,
                ClassifyMutated(baseJson, j => ((JArray)j["calendar"]["holidays"]).Add("2026-05-01")), "calendar");

            // Unity's StationEditClassifier keeps line headwayProfile outside CosmeticLineKeys and DayEquals,
            // so a line headway change fails closed to Structural rather than silently skipping train cadence rebuilds.
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["lines"][0]["headwayProfile"]["peak"] = 120),
                "line headwayProfile fails closed to Structural in Unity StationEditClassifier");
        }

        [Test]
        public void ClassifierFailsClosedToStructuralForLineSpecsFinishBehaviourCellGeometryFunctionalModulesUnknownAndBoundsExpansion() {
            var baseJson = BaseFixture();
            var baseRead = Read(baseJson);

            // Line structural specs.
            Assert.AreEqual(StationDocumentEditKind.Structural, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["stock"] = "D"), "line stock");
            Assert.AreEqual(StationDocumentEditKind.Structural, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["cars"] = 8), "line cars");
            Assert.AreEqual(StationDocumentEditKind.Structural, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["power"] = "third-rail"), "line power");
            Assert.AreEqual(StationDocumentEditKind.Structural, ClassifyMutated(baseJson, j => j["static"]["lines"][0]["direction"] = "down"), "line direction");

            // Speed, cover, and track-changing top finishes (Classify AND ClassifyLocal).
            foreach (var topFinish in new[] { "floor.concrete", "floor.track", "floor.soil", "ceil.baffle" }) {
                Assert.AreEqual(StationDocumentEditKind.Structural,
                    ClassifyMutated(baseJson, j => j["static"]["cells"][0]["finish"]["top"] = topFinish),
                    $"Classify top finish -> {topFinish}");
                var patch = new StationCellPatch();
                patch.Add(StationCellWrite.PaintFace(new StationCellKey(0, 0, 0), "top", topFinish));
                var local = StationLocalEdit.TryApplyCells(baseRead, patch, "nonstruct", out var cCode);
                Assert.IsNotNull(local, $"{topFinish}: {cCode}");
                Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(baseRead, local),
                    $"ClassifyLocal top finish -> {topFinish}");
            }

            // Shape, zone, tags, room, fill changes on a cell.
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["tags"] = new JArray("half-wall:n")), "cell shape tag");
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["zone"] = "paid"), "cell zone");
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["tags"] = new JArray("wall")), "cell tags");
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["room"] = "store"), "cell room");
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["static"]["cells"][0]["fill"] = "void"), "cell fill void");

            var zonePatch = new StationCellPatch();
            zonePatch.Add(StationCellWrite.Labels(new StationCellKey(0, 0, 0), "paid", null));
            var localZone = StationLocalEdit.TryApplyCells(baseRead, zonePatch, "nonstruct", out _);
            Assert.IsNotNull(localZone);
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(baseRead, localZone), "ClassifyLocal zone");

            // Hanger mount="post" (obstacle) vs mount="roof" (inert).
            var postHanger = new StationEditDraft { Id = "hanger-post", Type = "hanger", X = 2, Y = 0, Z = 0 };
            postHanger.Set("mount", "post");
            var localPostHanger = StationLocalEdit.TryApplyModule(baseRead, StationModuleEditMode.Add, postHanger, null, "nonstruct", out _);
            Assert.IsNotNull(localPostHanger);
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(baseRead, localPostHanger), "ClassifyLocal post hanger");
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.Classify(baseRead.Document, localPostHanger.Document), "Classify post hanger");

            // Functional modules: shelf, sink, cubicle, door, bench, tvm, electrical-cabinet.
            foreach (var funcType in new[] { "shelf", "sink", "cubicle", "door", "bench", "tvm", "electrical-cabinet" }) {
                var draft = new StationEditDraft { Id = "func-" + funcType, Type = funcType, X = 3, Y = 0, Z = 0 };
                var localFunc = StationLocalEdit.TryApplyModule(baseRead, StationModuleEditMode.Add, draft, null, "nonstruct", out var fCode);
                Assert.IsNotNull(localFunc, $"{funcType}: {fCode}");
                Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(baseRead, localFunc),
                    $"ClassifyLocal functional {funcType}");
                Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.Classify(baseRead.Document, localFunc.Document),
                    $"Classify functional {funcType}");
            }

            // Unknown module type fails closed.
            var unknownFacts = new ModuleFacts {
                Id = "future-1", Type = "future-piece", X = 2, Y = 0, Z = 0,
                Rotation = 0, Width = 1, Depth = 1, CeilingAnchored = false, Config = ModuleConfig.Empty,
            };
            var unknownMod = new StationModuleRecord("future-1", "future-piece", 2, 0, 0, 0, 1, 1, 1, false,
                null, null, Array.Empty<string>(), "{\"id\":\"future-1\",\"type\":\"future-piece\",\"x\":2,\"y\":0,\"z\":0}", unknownFacts);
            Assert.IsFalse(StationEditClassifier.IsSimInertDecorModule(unknownMod), "unknown module type must never be inert");
            var modsWithUnknown = baseRead.Document.Modules.Concat(new[] { unknownMod }).ToArray();
            var docWithUnknown = new StationDocument(
                baseRead.Document.Name, baseRead.Document.NameEn, baseRead.Document.City,
                baseRead.Document.Seed, baseRead.Document.LevelBase, baseRead.Document.StoreyHeight,
                baseRead.Document.Day, baseRead.Document.Cells.ToArray(), modsWithUnknown, baseRead.Document.Lines.ToArray(),
                0, 0, baseRead.Document.Source, baseRead.Document.SavedAt, baseRead.Document.NormalizedJson);
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.Classify(baseRead.Document, docWithUnknown),
                "adding unknown module type must fail closed to Structural");

            // Unknown root key fails closed.
            Assert.AreEqual(StationDocumentEditKind.Structural,
                ClassifyMutated(baseJson, j => j["future"] = true),
                "unknown root key must fail closed to Structural");

            // Inert module expanding ground window (x=5000) fails closed on BOTH Classify and ClassifyLocal.
            var farBillboard = new StationEditDraft { Id = "far-bb", Type = "billboard", X = 5000, Y = 0, Z = 0 };
            farBillboard.Set("poster", "ad-01");
            var localFar = StationLocalEdit.TryApplyModule(baseRead, StationModuleEditMode.Add, farBillboard, null, "nonstruct", out var farCode);
            Assert.IsNotNull(localFar, farCode);
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.ClassifyLocal(baseRead, localFar),
                "ClassifyLocal ground-window expansion must fail closed to Structural");
            Assert.AreEqual(StationDocumentEditKind.Structural, StationEditClassifier.Classify(baseRead.Document, localFar.Document),
                "Classify ground-window expansion must fail closed to Structural");
        }

        /* ---------------------------------------- live exit open:false behavior */

        [Test]
        public void LiveExitOpenTogglePreservesWalkGraphAndGraphEpochKeepsActiveRoutesAndStopsClosedExitSpawns() {
            var host = CreateHost();
            var save = BaseFixture();
            save["static"]["lines"][0]["alightPerTrain"] = 0;
            // Add a track at y=-1 (x=2..8) and platform-edge at y=0 (x=2..8, Side="right") plus corridor cells at y=1 so spawned passengers walk freely between exits and platform.
            ((JArray)save["static"]["modules"]).Add(new JObject {
                ["id"] = "track-1", ["type"] = "track", ["x"] = 2, ["y"] = -1, ["z"] = 0, ["rot"] = 0, ["w"] = 7,
                ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up" },
            });
            ((JArray)save["static"]["modules"]).Add(new JObject {
                ["id"] = "edge-1", ["type"] = "platform-edge", ["x"] = 2, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["w"] = 7,
                ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-1", ["side"] = "right", ["dir"] = "up" },
            });
            for (int x = 0; x <= 10; x++) {
                ((JArray)save["static"]["cells"]).Add(new JObject {
                    ["x"] = x, ["y"] = 1, ["z"] = 0, ["fill"] = "solid", ["zone"] = "platform",
                    ["finish"] = new JObject { ["top"] = "floor.tile" },
                });
            }

            var opened = host.OpenDocument(save.ToString(Formatting.None), "exit-live-test");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            var simHost = host.Coordinator.Simulation as StationSimulationHost;
            Assert.IsNotNull(simHost);
            var session = simHost.Session;
            Assert.IsNotNull(session);

            session.SeekToSimTime(7 * 3600);
            session.SetPlaying(true);
            session.Advance(15);
            Assert.Greater(session.Services.PassengerCount, 0, "expected active passengers before toggling exit");

            var graphBefore = session.WalkGraph;
            int epochBefore = session.Services.GraphEpoch;
            var activeIdsBefore = new HashSet<int>(session.PassengerFrames().Select(p => p.SimId));
            Assert.Greater(activeIdsBefore.Count, 0);

            // Close exit-a live via StationEditSession.TryApplyExitSettings.
            Assert.IsTrue(StationEditSession.TryApplyExitSettings(host, "exit-a",
                hasName: false, name: null, hasInRate: false, inRate: 0, hasOpen: true, open: false,
                commandId: "close-a", out var resA, out var codeA), codeA ?? "TryApplyExitSettings exit-a failed");
            Assert.IsTrue(resA.Accepted);
            Assert.AreSame(graphBefore, session.WalkGraph, "closing an exit must preserve WalkGraph reference");
            Assert.AreEqual(epochBefore, session.Services.GraphEpoch, "closing an exit must preserve GraphEpoch");
            Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph(), "active passengers must retain valid routes");

            // Active passengers survive immediately after the toggle.
            var activeIdsAfter = new HashSet<int>(session.PassengerFrames().Select(p => p.SimId));
            Assert.IsTrue(activeIdsBefore.All(id => activeIdsAfter.Contains(id)),
                "closing an exit must not drop active passengers");

            // Close exit-b as well: ALL exits closed => 0 new spawns while WalkGraph/GraphEpoch stay unchanged.
            Assert.IsTrue(StationEditSession.TryApplyExitSettings(host, "exit-b",
                hasName: false, name: null, hasInRate: false, inRate: 0, hasOpen: true, open: false,
                commandId: "close-b", out var resB, out var codeB), codeB ?? "TryApplyExitSettings exit-b failed");
            Assert.IsTrue(resB.Accepted);
            Assert.AreSame(graphBefore, session.WalkGraph, "closing second exit must preserve WalkGraph reference");
            Assert.AreEqual(epochBefore, session.Services.GraphEpoch, "closing second exit must preserve GraphEpoch");

            int spawnedWhenAllClosed = session.Services.Spawned;
            session.Advance(60);
            Assert.AreEqual(spawnedWhenAllClosed, session.Services.Spawned,
                "closing all exits must spawn 0 new street passengers");

            // Verify isolated closed-exit station separately: only exit-a present with open=false spawns 0
            // (keep track-1 + edge-1 so reopening exit-a immediately has a reachable boarding destination).
            var soloClosed = (JObject)save.DeepClone();
            ((JArray)soloClosed["static"]["modules"]).RemoveAt(1); // remove exit-b
            soloClosed["static"]["modules"][0]["cfg"]["open"] = false;
            soloClosed["static"]["modules"][0]["cfg"]["inRate"] = 3600;
            var soloOpened = host.OpenDocument(soloClosed.ToString(Formatting.None), "solo-closed");
            Assert.IsTrue(soloOpened.Accepted, soloOpened.ToString());
            var soloSession = simHost.Session;
            soloSession.SeekToSimTime(7 * 3600);
            soloSession.SetPlaying(true);
            soloSession.Advance(120);
            Assert.AreEqual(0, soloSession.Services.Spawned, "a closed exit must spawn 0 passengers");

            // Reopening the sole exit resumes spawning without rebuilding the WalkGraph.
            var soloGraph = soloSession.WalkGraph;
            int soloEpoch = soloSession.Services.GraphEpoch;
            Assert.IsTrue(StationEditSession.TryApplyExitSettings(host, "exit-a",
                hasName: false, name: null, hasInRate: false, inRate: 0, hasOpen: true, open: true,
                commandId: "reopen-a", out var resReopen, out var reopenCode), reopenCode ?? "reopen failed");
            Assert.IsTrue(resReopen.Accepted);
            Assert.AreSame(soloGraph, soloSession.WalkGraph);
            Assert.AreEqual(soloEpoch, soloSession.Services.GraphEpoch);
            soloSession.Advance(30);
            Assert.Greater(soloSession.Services.Spawned, 0, "reopening exit must resume passenger spawning");
        }

        /* ---------------------------------------- Restart() full snapshot parity */

        static StationSessionDocument MultiStoreyServiceFixture() {
            var doc = new StationSessionDocument { StationId = "restart-parity", LevelBase = 0 };
            doc.Lines.Add(new StationLineFact {
                Id = "line-1", Direction = "up",
                HeadwayPeak = 45, HeadwayOffpeak = 60, HeadwayLate = 90,
                Stock = "A", Cars = 4, AlightPerTrain = 16, AuthoredAlight = true, ModelScale = 1,
            });
            // Concourse z=0: x=0..4 unpaid, x=5 ONLY at fare gate lanes y=2..4 (100% must pass gates!), x=6..14 paid.
            for (int x = 0; x <= 14; x++) {
                for (int y = 0; y <= 7; y++) {
                    if (x == 5 && (y < 2 || y > 4)) continue;
                    doc.Cells.Add(new StationCellFact {
                        X = x, Y = y, Z = 0, Solid = true,
                        Zone = x <= 4 ? 2 : 3, Speed = 1.0,
                    });
                }
            }
            // Platform z=-5: x=6..24, y=1..7 (track at y=0, platform-edge at y=1 Side="right").
            for (int x = 6; x <= 24; x++) {
                for (int y = 1; y <= 7; y++) {
                    doc.Cells.Add(new StationCellFact {
                        X = x, Y = y, Z = -5, Solid = true,
                        Zone = 4, Speed = 1.0,
                    });
                }
            }
            // Exit on concourse (high inflow so queues, gates, stairs, lifts all engage).
            doc.Modules.Add(new StationModuleFact {
                Id = "exit-1", Type = "exit", X = 1, Y = 3, Z = 0, Rot = 0,
                Width = 1, Depth = 1, Height = 1, Name = "A",
                ExitStyle = "virtual", HeadHouse = false,
                HasExitInRate = true, ExitInRate = 3600, ExitClosed = false,
            });
            // Fare gate line across x=5 (y=2,3,4), Rot=3 -> travel along +/-x.
            for (int y = 2; y <= 4; y++) {
                doc.Modules.Add(new StationModuleFact {
                    Id = "gate-" + y, Type = "gate", X = 5, Y = y, Z = 0, Rot = 3,
                    Width = 1, Depth = 1, Height = 1, GateDir = 0, GateOpen = true, GateHasLane = true,
                });
            }
            // Stair descending from (8,2,0) to (13,2,-5).
            doc.Modules.Add(new StationModuleFact {
                Id = "stair-1", Type = "stair", X = 8, Y = 2, Z = 0, Rot = 0,
                Width = 2, Depth = 1, Height = 1, RideWidth = 1.79, StairFlights = 1,
                HasEndpoints = true, FromX = 8, FromY = 2, FromZ = 0, ToX = 13, ToY = 2, ToZ = -5, RunLength = 7,
            });
            // Escalator descending from (8,4,0) to (13,4,-5).
            doc.Modules.Add(new StationModuleFact {
                Id = "esc-1", Type = "escalator", X = 8, Y = 4, Z = 0, Rot = 0,
                Width = 1, Depth = 1, Height = 1, RideWidth = 1, RideColumns = 1, Dir = "down",
                HasEndpoints = true, FromX = 8, FromY = 4, FromZ = 0, ToX = 13, ToY = 4, ToZ = -5, RunLength = 7,
            });
            // Lift shaft connecting z=-5 and z=0 at (8,5) (2x2 footprint x=8..9, y=5..6; landings at y=4 & y=7 clear of y=1 edge!).
            doc.Modules.Add(new StationModuleFact {
                Id = "lift-1", Type = "lift", X = 8, Y = 5, Z = -5, Rot = 0,
                Width = 2, Depth = 2, Height = 6,
                HasEndpoints = true, FromX = 8, FromY = 5, FromZ = -5, ToX = 8, ToY = 5, ToZ = 0,
                LiftRises = new[] { 5 },
                LiftDoorMasks = new Dictionary<int, int> { [-5] = 3, [0] = 3 },
            });
            // Track at y=0 and platform edge at y=1 (Side="right" matches GatePlatformDocument & LiftOnlyDocument).
            doc.Modules.Add(new StationModuleFact {
                Id = "track-1", Type = "track", X = 8, Y = 0, Z = -5, Rot = 0,
                Width = 16, Depth = 1, Height = 1, LineId = "line-1", Dir = "up",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "edge-1", Type = "platform-edge", X = 8, Y = 1, Z = -5, Rot = 0,
                Width = 16, Depth = 1, Height = 1, LineId = "line-1", RailId = "track-1", Side = "right", Dir = "up",
            });
            return doc;
        }

        static void AssertSnapshotsEqual(StationMotionFrame expected, StationMotionFrame actual,
            StationStatisticsSnapshot expectedStats, StationStatisticsSnapshot actualStats) {
            Assert.AreEqual(expected.Clock.SimTimeSeconds, actual.Clock.SimTimeSeconds, 1e-9, "SimTimeSeconds");
            Assert.AreEqual(expected.Clock.ClockSeconds, actual.Clock.ClockSeconds, "ClockSeconds");
            Assert.AreEqual(expected.Clock.Period, actual.Clock.Period, "Period");
            Assert.AreEqual(expected.Clock.DemandRate, actual.Clock.DemandRate, 1e-12, "DemandRate");

            Assert.AreEqual(expected.Trains.Length, actual.Trains.Length, "Trains.Length");
            for (int i = 0; i < expected.Trains.Length; i++) {
                Assert.AreEqual(expected.Trains[i].Id, actual.Trains[i].Id, $"Train[{i}].Id");
                Assert.AreEqual(expected.Trains[i].ServiceSequence, actual.Trains[i].ServiceSequence, $"Train[{i}].Sequence");
                Assert.AreEqual(expected.Trains[i].Phase, actual.Trains[i].Phase, $"Train[{i}].Phase");
                Assert.AreEqual(expected.Trains[i].PhaseSeconds, actual.Trains[i].PhaseSeconds, 1e-9, $"Train[{i}].PhaseSeconds");
                Assert.AreEqual(expected.Trains[i].DoorFraction, actual.Trains[i].DoorFraction, 1e-9, $"Train[{i}].DoorFraction");
                Assert.AreEqual(expected.Trains[i].Onboard, actual.Trains[i].Onboard, $"Train[{i}].Onboard");
                Assert.AreEqual(expected.Trains[i].NextDispatchSimTime, actual.Trains[i].NextDispatchSimTime, 1e-9, $"Train[{i}].NextDispatch");
            }

            Assert.AreEqual(expected.Escalators.Length, actual.Escalators.Length, "Escalators.Length");
            for (int i = 0; i < expected.Escalators.Length; i++) {
                Assert.AreEqual(expected.Escalators[i].Id, actual.Escalators[i].Id);
                Assert.AreEqual(expected.Escalators[i].PhaseMeters, actual.Escalators[i].PhaseMeters, 1e-9);
            }

            Assert.AreEqual(expected.Lifts.Length, actual.Lifts.Length, "Lifts.Length");
            for (int i = 0; i < expected.Lifts.Length; i++) {
                Assert.AreEqual(expected.Lifts[i].Id, actual.Lifts[i].Id, $"Lift[{i}].Id");
                Assert.AreEqual(expected.Lifts[i].Phase, actual.Lifts[i].Phase, $"Lift[{i}].Phase");
                Assert.AreEqual(expected.Lifts[i].DoorFraction, actual.Lifts[i].DoorFraction, 1e-9, $"Lift[{i}].Door");
                Assert.AreEqual(expected.Lifts[i].Stop, actual.Lifts[i].Stop, $"Lift[{i}].Stop");
                Assert.AreEqual(expected.Lifts[i].Call, actual.Lifts[i].Call, $"Lift[{i}].Call");
                Assert.AreEqual(expected.Lifts[i].Z, actual.Lifts[i].Z, 1e-9, $"Lift[{i}].Z");
            }

            Assert.AreEqual(expected.Doors.Length, actual.Doors.Length, "Doors.Length");
            for (int i = 0; i < expected.Doors.Length; i++) {
                Assert.AreEqual(expected.Doors[i].PlatformId, actual.Doors[i].PlatformId);
                Assert.AreEqual(expected.Doors[i].DoorFraction, actual.Doors[i].DoorFraction, 1e-9);
                Assert.AreEqual(expected.Doors[i].TrainPhase, actual.Doors[i].TrainPhase);
            }

            Assert.AreEqual(expected.Gates.Length, actual.Gates.Length, "Gates.Length");
            for (int i = 0; i < expected.Gates.Length; i++) {
                Assert.AreEqual(expected.Gates[i].Id, actual.Gates[i].Id, $"Gate[{i}].Id");
                Assert.AreEqual(expected.Gates[i].Queue, actual.Gates[i].Queue, $"Gate[{i}].Queue");
                Assert.AreEqual(expected.Gates[i].Served, actual.Gates[i].Served, $"Gate[{i}].Served");
                Assert.AreEqual(expected.Gates[i].State, actual.Gates[i].State, $"Gate[{i}].State");
                Assert.AreEqual(expected.Gates[i].Lane, actual.Gates[i].Lane, $"Gate[{i}].Lane");
            }

            Assert.AreEqual(expected.Passengers.Length, actual.Passengers.Length, "Passengers.Length");
            for (int i = 0; i < expected.Passengers.Length; i++) {
                Assert.AreEqual(expected.Passengers[i].SimId, actual.Passengers[i].SimId, $"Pax[{i}].SimId");
                Assert.AreEqual(expected.Passengers[i].X, actual.Passengers[i].X, 1e-9, $"Pax[{i}].X");
                Assert.AreEqual(expected.Passengers[i].Y, actual.Passengers[i].Y, 1e-9, $"Pax[{i}].Y");
                Assert.AreEqual(expected.Passengers[i].Z, actual.Passengers[i].Z, 1e-9, $"Pax[{i}].Z");
                Assert.AreEqual(expected.Passengers[i].Heading, actual.Passengers[i].Heading, 1e-9, $"Pax[{i}].Heading");
                Assert.AreEqual(expected.Passengers[i].Activity, actual.Passengers[i].Activity, $"Pax[{i}].Activity");
            }

            Assert.AreEqual(expectedStats.Population, actualStats.Population, "Stats.Population");
            Assert.AreEqual(expectedStats.CrowdLos, actualStats.CrowdLos, "Stats.CrowdLos");
            Assert.AreEqual(expectedStats.Boarded, actualStats.Boarded, "Stats.Boarded");
            Assert.AreEqual(expectedStats.Alighted, actualStats.Alighted, "Stats.Alighted");
            Assert.AreEqual(expectedStats.Exited, actualStats.Exited, "Stats.Exited");
            Assert.AreEqual(expectedStats.LeftBehind, actualStats.LeftBehind, "Stats.LeftBehind");
            Assert.AreEqual(expectedStats.TrainArrivals, actualStats.TrainArrivals, "Stats.TrainArrivals");
            Assert.AreEqual(expectedStats.GateQueue, actualStats.GateQueue, "Stats.GateQueue");
            Assert.AreEqual(expectedStats.EscalatorQueue, actualStats.EscalatorQueue, "Stats.EscalatorQueue");
            Assert.AreEqual(expectedStats.LiftQueue, actualStats.LiftQueue, "Stats.LiftQueue");
            Assert.AreEqual(expectedStats.DoorQueue, actualStats.DoorQueue, "Stats.DoorQueue");
            Assert.AreEqual(expectedStats.Stuck, actualStats.Stuck, "Stats.Stuck");
        }

        [Test]
        public void SessionRestartReusesWalkGraphAndMatchesFreshSessionAcrossGatesLiftsStairsQueuesAndTrains() {
            var day = StationDayData.Default;
            const uint seed = 9876543;
            var walkOpts = new StationWalkGraphOptions { IncludeGround = false };

            // 1. Legacy (exact A*) routing mode: Restart() matches a cold-booted fresh session bit-for-bit across
            //    gates, lifts, stairs, escalators, queues, passengers, trains, and statistics.
            var exactA = new StationSimulationSession(new StationSessionSetup {
                Document = MultiStoreyServiceFixture(),
                Day = day,
                StartSimTime = 7.5 * 3600, // AM peak
                StartPlaying = true,
                Seed = seed,
                WalkOptions = walkOpts,
                Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Legacy },
            });

            exactA.Advance(90);
            Assert.Greater(exactA.Services.Spawned, 0, "warm-up must spawn passengers");
            Assert.Greater(exactA.GateFrames().Sum(g => g.Served), 0, "warm-up must exercise fare gates");
            Assert.Greater(exactA.TrainArrivals, 0, "warm-up must receive train arrivals");

            var exactGraphBefore = exactA.WalkGraph;
            double simTimeAtRestart = exactA.Clock.SimTime;
            long tickAtRestart = exactA.Tick;

            exactA.Restart();
            Assert.AreSame(exactGraphBefore, exactA.WalkGraph, "Restart() must retain static WalkGraph");
            Assert.AreEqual(simTimeAtRestart, exactA.Clock.SimTime, 1e-9, "Restart() must keep Clock.SimTime");
            Assert.AreEqual(tickAtRestart, exactA.Tick, "Restart() must keep Tick");
            Assert.AreEqual(0, exactA.Services.PassengerCount, "Restart() must clear all passengers");
            Assert.AreEqual(0, exactA.Services.QueueTotal, "Restart() must clear all queues");
            Assert.AreEqual(0, exactA.TrainArrivals, "Restart() must reset TrainArrivals");

            var exactFresh = new StationSimulationSession(new StationSessionSetup {
                Document = MultiStoreyServiceFixture(),
                Day = day,
                StartSimTime = simTimeAtRestart,
                StartPlaying = true,
                Seed = seed,
                WalkOptions = walkOpts,
                Services = new StationServiceOptions { RoutingMode = StationRoutingMode.Legacy },
            });

            AssertSnapshotsEqual(exactFresh.Snapshot(), exactA.Snapshot(), exactFresh.Statistics, exactA.Statistics);
            foreach (int step in new[] { 15, 30, 45 }) {
                exactA.Advance(step);
                exactFresh.Advance(step);
                AssertSnapshotsEqual(exactFresh.Snapshot(), exactA.Snapshot(), exactFresh.Statistics, exactA.Statistics);
            }
            Assert.Greater(exactA.TrainArrivals, 0, "post-restart Legacy run must verify active train arrivals");
            Assert.Greater(exactA.GateFrames().Sum(g => g.Served), 0, "post-restart Legacy run must verify active gate service");

            // 2. Sparse routing mode (shipped default): Restart() retains both WalkGraph and validated
            //    reverse-field cache entries while clearing crowd, queues, and corridor claims, and
            //    repeated restarts from the same clock instant reproduce bit-for-bit identical trajectories.
            var sparseA = new StationSimulationSession(new StationSessionSetup {
                Document = MultiStoreyServiceFixture(),
                Day = day,
                StartSimTime = 7.5 * 3600,
                StartPlaying = true,
                Seed = seed,
                WalkOptions = walkOpts,
            });
            sparseA.Advance(90);
            var sparseGraphBefore = sparseA.WalkGraph;
            var sparseStatsBefore = sparseA.Services.SparseRoutingStats();
            Assert.IsNotNull(sparseStatsBefore, "Sparse session exposes SparseRoutingStats");
            Assert.Greater(sparseStatsBefore.FieldCacheEntries, 0, "warm-up populates sparse reverse-field cache");

            sparseA.Restart();
            Assert.AreSame(sparseGraphBefore, sparseA.WalkGraph, "Sparse Restart() must retain static WalkGraph");
            var sparseStatsAfter = sparseA.Services.SparseRoutingStats();
            Assert.AreEqual(sparseStatsBefore.FieldCacheEntries, sparseStatsAfter.FieldCacheEntries,
                "Sparse Restart() preserves validated reverse-field cache entries");
            Assert.AreEqual(0, sparseStatsAfter.ActiveClaims, "Sparse Restart() clears corridor claims");
            Assert.AreEqual(0, sparseA.Services.PassengerCount, "Sparse Restart() clears passengers");
            Assert.AreEqual(0, sparseA.Services.QueueTotal, "Sparse Restart() clears queues");

            var sparseTime = sparseA.Clock.SimTime;
            var firstRunSnaps = new List<(StationMotionFrame Frame, StationStatisticsSnapshot Stats)>();
            foreach (int step in new[] { 15, 30, 45 }) {
                sparseA.Advance(step);
                firstRunSnaps.Add((sparseA.Snapshot(), sparseA.Statistics));
            }
            Assert.Greater(sparseA.TrainArrivals, 0, "post-restart Sparse run must verify active train arrivals");
            Assert.Greater(sparseA.GateFrames().Sum(g => g.Served), 0, "post-restart Sparse run must verify active gate service");

            // Seek back to the same restart instant and Restart() a second time: warm-cache trajectory matches bit-for-bit.
            sparseA.SeekToSimTime(sparseTime);
            sparseA.Restart();
            Assert.AreSame(sparseGraphBefore, sparseA.WalkGraph, "repeated Sparse Restart() keeps reusing static WalkGraph");
            int idx = 0;
            foreach (int step in new[] { 15, 30, 45 }) {
                sparseA.Advance(step);
                AssertSnapshotsEqual(firstRunSnaps[idx].Frame, sparseA.Snapshot(), firstRunSnaps[idx].Stats, sparseA.Statistics);
                idx++;
            }
        }
    }
}
