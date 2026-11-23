using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Deterministic EditMode parity tests for Track 5 (plan 37 §5):
    /// both-bank train doors, 5 m catenary & PSD safety vinyl, contact-shadow blobs,
    /// and equipment <c>lineSpacing</c> run planning.
    /// </summary>
    public sealed class StationTrainAndPlatformVisualsTests {
        readonly List<GameObject> cleanup = new List<GameObject>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanup.Count - 1; i >= 0; i--) {
                if (cleanup[i] != null) UnityEngine.Object.DestroyImmediate(cleanup[i]);
            }
            cleanup.Clear();
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationScenePicker.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        /* --------------------------------------------- 5A: both-bank train doors */

        [Test]
        public void BothBankMaskCoversZeroOneAndTwoBanksForBothHeadings() {
            // Up heading (+1): left platform -> bit 0 (1), right platform -> bit 1 (2), both -> 3.
            Assert.AreEqual(0, StationTrainPose.ConsistDoorBankMask(0, +1));
            Assert.AreEqual(1, StationTrainPose.ConsistDoorBankMask(1, +1));
            Assert.AreEqual(2, StationTrainPose.ConsistDoorBankMask(2, +1));
            Assert.AreEqual(3, StationTrainPose.ConsistDoorBankMask(3, +1));

            // Down heading (-1): flips bit 0 <-> bit 1; zero and both stay symmetric.
            Assert.AreEqual(0, StationTrainPose.ConsistDoorBankMask(0, -1));
            Assert.AreEqual(2, StationTrainPose.ConsistDoorBankMask(1, -1));
            Assert.AreEqual(1, StationTrainPose.ConsistDoorBankMask(2, -1));
            Assert.AreEqual(3, StationTrainPose.ConsistDoorBankMask(3, -1));

            // Document-level TrackDoorSides with both left and right platform-edge modules.
            var bothDoc = BuildSessionTrackDoc(new[] { ("edge-l", "left", "track-1"), ("edge-r", "right", "track-1") });
            var track = bothDoc.ModulesOfType("track")[0];
            Assert.AreEqual(3, StationTrainPose.TrackDoorSides(bothDoc, track, "1", "up"),
                "left + right edges => both banks (mask 3)");

            // Legacy platform edge without cfg.from still binds via ResolveEdgeTrack.
            var legacyDoc = BuildSessionTrackDoc(new[] { ("edge-legacy", "left", "") });
            var legacyEdge = legacyDoc.ModulesOfType("platform-edge")[0];
            var legacyTrack = legacyDoc.ModulesOfType("track")[0];
            Assert.AreEqual("track-1", StationServiceDoors.ResolveEdgeTrack(legacyDoc, legacyEdge, legacyDoc.Lines[0], true));
            Assert.AreEqual(1, StationTrainPose.TrackDoorSides(legacyDoc, legacyTrack, "1", "up"));
        }

        [Test]
        public void TrainDoorRigMovesZeroOneOrBothBanksIndependently() {
            var root = new GameObject("both-bank-rig-test");
            cleanup.Add(root);

            var leafL0 = new GameObject("Door0");
            leafL0.transform.SetParent(root.transform, false);
            leafL0.transform.localPosition = new Vector3(-0.35f, 0f, -1.4f);
            var leafL1 = new GameObject("Door1");
            leafL1.transform.SetParent(root.transform, false);
            leafL1.transform.localPosition = new Vector3(+0.35f, 0f, -1.4f);

            var leafR0 = new GameObject("Door2");
            leafR0.transform.SetParent(root.transform, false);
            leafR0.transform.localPosition = new Vector3(-0.35f, 0f, +1.4f);
            var leafR1 = new GameObject("Door3");
            leafR1.transform.SetParent(root.transform, false);
            leafR1.transform.localPosition = new Vector3(+0.35f, 0f, +1.4f);

            var rig = new TrainDoorRig(root, TrainDoorRig.Anchors.FromScale(1f), platformBank: 1);
            Assert.AreEqual(2, rig.Banks, "two opposing banks detected");

            // Zero banks: neither side moves.
            rig.SetActiveBankMask(0);
            rig.ApplyMask(1f);
            Assert.AreEqual(0f, rig.Plus, 1e-4f);
            Assert.AreEqual(0f, rig.Minus, 1e-4f);

            // Single bank (bit 0 = plus): only plus bank moves.
            rig.SetActiveBankMask(1);
            rig.ApplyMask(1f);
            Assert.AreEqual(1f, rig.Plus, 1e-4f);
            Assert.AreEqual(0f, rig.Minus, 1e-4f);
            Assert.AreEqual(0f, rig.InactiveFraction, 1e-4f);

            // Both banks (mask 3): both sides move together and InactiveFraction stays 0.
            rig.SetActiveBankMask(3);
            rig.ApplyMask(1f);
            Assert.AreEqual(1f, rig.Plus, 1e-4f);
            Assert.AreEqual(1f, rig.Minus, 1e-4f);
            Assert.AreEqual(0f, rig.InactiveFraction, 1e-4f);
        }

        /* ---------------------------------------- 5B: 5 m catenary & PSD vinyl */

        [Test]
        public void FiveMetreCatenaryMatchesContactHeightRigidAndOpenGantryProfiles() {
            float contact = StationRailGeometry.TrainContactWireZ(StationRailGeometry.DefaultScale);
            Assert.AreEqual(3.903f, contact, 1e-3f, "5 m contact wire centre at scale 0.98");
            Assert.AreEqual(3.891f, contact - StationRailGeometry.ContactWireRadius, 1e-3f, "wire underside meets pantograph carbon");

            // Rigid overhead under cover / tunnel fits in <= 4.0 m recess and reaches both seams.
            foreach (bool tunnel in new[] { false, true }) {
                var rigid = RailRunGeometry.Build(16f, 4f, StationRailGeometry.DefaultScale, -1, catenary: true,
                    bridge: null, catenaryOptions: new RailCatenaryOptions { Tunnel = tunnel, CeilingZ = 4f });
                Assert.IsTrue(rigid.RigidCatenary);
                Assert.AreEqual(0, rigid.GantryMastCount);
                Assert.AreEqual(0, rigid.MessengerSpanCount);
                Assert.Greater(rigid.Copper.VertexCount, 0, "copper contact wire emitted");
                float minX = rigid.Copper.Vertices.Min(v => v.x);
                float maxX = rigid.Copper.Vertices.Max(v => v.x);
                float minY = rigid.Copper.Vertices.Min(v => v.y);
                Assert.AreEqual(-0.5f, minX, 1e-3f, "wire starts at -0.5 module seam");
                Assert.AreEqual(15.5f, maxX, 1e-3f, "wire ends at w - 0.5 module seam");
                Assert.AreEqual(3.891f, minY, 2e-3f, "copper underside at 3.891 m");
                Assert.LessOrEqual(rigid.Steel.Vertices.Max(v => v.y), 4.0f + 1e-3f, "rigid assembly stays below 4 m ceiling");
                Assert.IsFalse(rigid.Notes.Any(n => n.Contains("simplified gantry")), "no simplified gantry placeholder");
            }

            // Open gantry on bridge builds masts, sagging messenger spans, droppers, and seam joins.
            var gantry = RailRunGeometry.Build(24f, 3f, StationRailGeometry.DefaultScale, -1, catenary: true,
                bridge: new RailBridgeOptions { Railing = "railing", VehicleWidth = 2.8f },
                catenaryOptions: new RailCatenaryOptions { Style = "gantry", VehicleWidth = 2.8f, CeilingZ = 5f });
            Assert.IsFalse(gantry.RigidCatenary);
            Assert.GreaterOrEqual(gantry.GantryMastCount, 3, "24 m bridge gantry has >= 3 masts");
            Assert.GreaterOrEqual(gantry.MessengerSpanCount, 3, "sagging messenger spans emitted");
            Assert.GreaterOrEqual(gantry.DropperCount, 8, "droppers emitted across spans");
            Assert.Greater(gantry.Copper.VertexCount, 0);
            Assert.IsFalse(gantry.Notes.Any(n => n.Contains("simplified gantry")));
        }

        [Test]
        public void PsdEmitsYellowSafetyLineOnAllModesAndFourPrintedVinylDecalsOnFullHeight() {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var palette = new OpeningPalette(shader);
            var root = new GameObject("psd-vinyl-test");
            cleanup.Add(root);

            foreach (string mode in new[] { "full", "half", "none" }) {
                var read = ReadTrackDocument(new[] { ("edge-" + mode, "left", "track-1") }, psdMode: mode);
                var set = new OpeningModuleSet();
                OpeningModuleViews.BuildAll(read.Document.Modules, read.Index, null, root.transform, palette, set, null, null);
                Assert.IsTrue(set.TryGet("edge-" + mode, out var view), "built " + mode);
                Assert.IsNotNull(view.Part("platform-yellow-line"), mode + " must draw platform-yellow-line");
                if (mode == "full") {
                    Assert.IsFalse((view.Diagnostic ?? "").Contains("decals-unported"),
                        "full PSD must no longer report decals-unported: " + view.Diagnostic);
                    Assert.IsTrue(view.Decals.Any(d => d.Kind == PsdHeaderKind.FixedBand && d.RepeatU > 0f), "fixed-band decal");
                    Assert.IsTrue(view.Decals.Any(d => d.Kind == PsdHeaderKind.DoorBand && d.Node != null), "door-band decal");
                    Assert.IsTrue(view.Decals.Any(d => d.Kind == PsdHeaderKind.DoorWarning && d.Transparent), "door-warning decal");
                    Assert.IsTrue(view.Decals.Any(d => d.Kind == PsdHeaderKind.DoorArrowLeft && d.Transparent), "door-arrow-left decal");
                    Assert.IsTrue(view.Decals.Any(d => d.Kind == PsdHeaderKind.DoorArrowRight && d.Transparent), "door-arrow-right decal");
                    var doorBand = view.Decals.First(d => d.Kind == PsdHeaderKind.DoorBand);
                    Assert.IsTrue(doorBand.Node.parent != null && doorBand.Node.parent.name.StartsWith("psd-leaf-", StringComparison.Ordinal),
                        "door-band must be parented to a moving leaf");
                    Assert.GreaterOrEqual(Mathf.Abs(doorBand.Node.localPosition.z), 0.0105f,
                        "leaf decal sits proud of the 0.02 m glass thickness");
                }
            }
            palette.Release();
        }

        /* ---------------------------------------- 5C: contact-shadow blobs */

        [Test]
        public void ContactShadowsRespectEligibilityVisibilityAndUnpickability() {
            var read = ReadContactShadowDocument();
            var index = read.Index;

            // Eligibility rules match SceneSystem.ts:blobRadius + ceiling/wall exclusion.
            Assert.IsTrue(StationContactShadowRules.IsEligible(index.GetModule("bench-1")));
            Assert.IsTrue(StationContactShadowRules.IsEligible(index.GetModule("gate-1")));
            Assert.IsTrue(StationContactShadowRules.IsEligible(index.GetModule("tree-1")));
            Assert.IsFalse(StationContactShadowRules.IsEligible(index.GetModule("fence-1")));
            Assert.IsFalse(StationContactShadowRules.IsEligible(index.GetModule("tactile-1")));
            Assert.IsFalse(StationContactShadowRules.IsEligible(index.GetModule("sign-1")));

            // Build world with ContactShadowRenderer and verify batching + visibility + unpickable.
            var worldRoot = new GameObject("contact-shadow-world");
            cleanup.Add(worldRoot);
            var renderer = new StationContactShadowRenderer();
            var world = new StationWorldView(worldRoot.transform, "shadows", new IStationViewRenderer[] { renderer });
            world.Build(read.Document, read.Index);

            var shadowRecords = world.Records.Where(r => r.Role == StationContactShadowRenderer.RoleName).ToList();
            Assert.AreEqual(2, shadowRecords.Count, "two storey/grade buckets (-5 and 0 grade)");
            var allSourceIds = shadowRecords.SelectMany(r => r.SourceIds).ToList();
            CollectionAssert.Contains(allSourceIds, "bench-1");
            CollectionAssert.Contains(allSourceIds, "gate-1");
            CollectionAssert.Contains(allSourceIds, "tree-1");
            CollectionAssert.DoesNotContain(allSourceIds, "fence-1");
            CollectionAssert.DoesNotContain(allSourceIds, "tactile-1");

            // Visibility uses target.LevelZs[0] (not rounded WorldBounds.center.z) and is unpickable.
            var visibility = new StationVisibilityRegistry();
            StationViewFeature.RegisterWorld(visibility, world);
            visibility.State.ActiveLevel = -5;
            visibility.State.Cutaway = false;
            visibility.State.HideUi = false;
            visibility.Apply();

            var subTarget = shadowRecords.First(r => r.LevelBands[0] == -5).View.GetComponent<StationVisibilityTarget>();
            var gradeTarget = shadowRecords.First(r => r.LevelBands[0] == 0).View.GetComponent<StationVisibilityTarget>();
            Assert.IsNotNull(subTarget);
            Assert.IsTrue(subTarget.ContactShadow);
            Assert.AreEqual(StationDrawMode.Base, visibility.Decide(subTarget), "active storey shadow is visible");
            Assert.AreEqual(StationDrawMode.Hidden, visibility.Decide(gradeTarget), "inactive storey shadow is hidden");
            Assert.IsFalse(visibility.IsTargetPickable(subTarget), "contact shadows are never pickable");

            // Cutaway shows shadows on all kept storeys.
            visibility.State.Cutaway = true;
            visibility.Apply();
            Assert.AreEqual(StationDrawMode.Base, visibility.Decide(gradeTarget), "cutaway reveals kept-storey shadow");

            world.Dispose();
            renderer.Release();
        }

        /* ---------------------------------------- 5D: equipment lineSpacing */

        [Test]
        public void LineSpacingMatchesPreviewPlacementAndSweepEraseInOneUndo() {
            Assert.AreEqual(0, StationModuleRuns.ClampSpacing(-3));
            Assert.AreEqual(6, StationModuleRuns.ClampSpacing(99));
            Assert.IsTrue(StationModuleRuns.SupportsLineSpacing("fence"));
            Assert.IsTrue(StationModuleRuns.SupportsLineSpacing("floor-mark-boarding"));
            Assert.IsTrue(StationModuleRuns.SupportsLineSpacing("court-divider"));
            Assert.IsTrue(StationModuleRuns.SupportsLineSpacing("bench-steel-1"));
            Assert.IsFalse(StationModuleRuns.SupportsLineSpacing("tactile-guide"));
            Assert.IsFalse(StationModuleRuns.SupportsLineSpacing("stair-straight"));
            Assert.IsFalse(StationModuleRuns.SupportsLineSpacing("lift"));

            var hostGo = new GameObject("line-spacing-host");
            cleanup.Add(hostGo);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var floorDoc = BuildFlatFloorJson(0, 12, 0, 4, z: 0);
            Assert.IsTrue(host.OpenDocument(floorDoc, "test").Accepted);

            StationToolSelection.TrySelect("module", out _, out _);
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = "fence",
                ["rotation"] = 0,
                ["lineSpacing"] = 2,
            });
            Assert.AreEqual("erase", StationToolSelection.RightClaim, "line palette owns secondary erase");

            // Drag fence from x=0 to x=6 with spacing=2 -> slots at x=0, 3, 6.
            var downHit = TopHit(0, 1, 0, true);
            var endHit = TopHit(6, 1, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, downHit, "module", 0,
                StationPointerEvent.Synthetic(100, 100, 800, 600, timeMs: 0), out var reason), reason);
            StationCellTool.Aim(host, endHit, StationPointerEvent.Synthetic(220, 100, 800, 600, timeMs: 220));
            var previewXs = StationCellTool.Preview.Check.Accepted.Select(c => c.X).ToArray();
            CollectionAssert.AreEqual(new[] { 0, 3, 6 }, previewXs, "preview uses gap=2 (pitch 3)");

            int revBefore = host.CurrentRevision;
            Assert.IsTrue(StationCellTool.Finish(host, endHit,
                StationPointerEvent.Synthetic(220, 100, 800, 600, timeMs: 260), out var code, out reason), code ?? reason);
            Assert.AreEqual(revBefore + 1, host.CurrentRevision, "gapped run commits in 1 revision");
            var placedXs = host.Index.Document.Modules.Where(m => m.Type == "fence").Select(m => m.X).OrderBy(x => x).ToArray();
            CollectionAssert.AreEqual(new[] { 0, 3, 6 }, placedXs, "placement matches preview cells exactly");

            // Matching right-drag erase with the same spacing=2 yields exact same cells and removes all 3 in 1 commit.
            Assert.IsTrue(StationCellTool.Begin(host, downHit, "module", 2,
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 2, timeMs: 0), out reason), reason);
            StationCellTool.Aim(host, endHit, StationPointerEvent.Synthetic(220, 100, 800, 600, button: 2, timeMs: 220));
            CollectionAssert.AreEqual(new[] { 0, 3, 6 },
                StationCellTool.Preview.Check.Accepted.Select(c => c.X).ToArray(),
                "matching erase preview uses exact same gapped cells with zero spurious blocks");
            Assert.AreEqual(0, StationCellTool.Preview.Check.Blocked.Count);
            Assert.IsTrue(StationCellTool.Finish(host, endHit,
                StationPointerEvent.Synthetic(220, 100, 800, 600, button: 2, timeMs: 260), out code, out reason), code ?? reason);
            Assert.AreEqual(0, host.Index.Document.Modules.Count(m => m.Type == "fence"), "all 3 fences removed");

            // Single undo restores all 3 fences.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            CollectionAssert.AreEqual(new[] { 0, 3, 6 },
                host.Index.Document.Modules.Where(m => m.Type == "fence").Select(m => m.X).OrderBy(x => x).ToArray());

            // Multi-cell piece (floor-mark-boarding, width 3) at spacing=1 steps by 3 + 1 = 4 cells.
            var fmTemplate = new StationPlacementRequest { ToolType = "floor-mark-boarding", Rotation = 0, LineSpacing = 1 };
            var fmSlots = StationModuleRuns.RunSlots(host.Index, fmTemplate,
                new StationCellKey(0, 3, 1), new StationCellKey(8, 3, 1), dragging: true, remove: false,
                out _, out int fmStep);
            Assert.AreEqual(4, fmStep, "3 m floor-mark + gap 1 = step 4");
            CollectionAssert.AreEqual(new[] { 0, 4, 8 }, fmSlots.Select(c => c.X).ToArray());
        }

        /* ------------------------------------------------------------ fixtures */

        static StationSceneHit TopHit(int x, int y, int z, bool solid) {
            var point = new StationPoint(x + 0.5, y + 0.5, z + 1);
            return new StationSceneHit {
                CellKey = new StationCellKey(x, y, z),
                CellFace = StationFace.Top,
                CellNormal = new StationPoint(0, 0, 1),
                Level = z,
                Point = point,
                Cell = new StationPlacementHit(x, y, z, x, y, z + 1, solid, point, z + 1, new StationPoint(0, 0, 1)),
            };
        }

        static StationSessionDocument BuildSessionTrackDoc((string id, string side, string from)[] edges) {
            var doc = new StationSessionDocument { StationId = "both-bank-test", LevelBase = 0 };
            doc.Lines.Add(new StationLineFact { Id = "1", Direction = "up", Stock = "B", Cars = 6 });
            doc.Modules.Add(new StationModuleFact {
                Id = "track-1", Type = "track", X = 0, Y = 0, Z = -5, Rot = 0, Width = 36, Depth = 3,
                LineId = "1", Dir = "up",
            });
            foreach (var (id, side, from) in edges) {
                doc.Modules.Add(new StationModuleFact {
                    Id = id, Type = "platform-edge", X = 0, Y = side == "left" ? -1 : 3, Z = -5, Rot = 0, Width = 36, Depth = 1,
                    LineId = "1", Dir = "up", Side = side, RailId = from,
                });
            }
            return doc;
        }

        static StationReadResult ReadTrackDocument((string id, string side, string from)[] edges, string psdMode = "full") {
            var modules = new JArray {
                new JObject {
                    ["id"] = "track-1", ["type"] = "track", ["x"] = 0, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["w"] = 36, ["d"] = 3,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "catenary" },
                },
            };
            foreach (var (id, side, from) in edges) {
                var cfg = new JObject { ["line"] = "1", ["dir"] = "up", ["side"] = side, ["psd"] = psdMode };
                if (!string.IsNullOrEmpty(from)) cfg["from"] = from;
                modules.Add(new JObject {
                    ["id"] = id, ["type"] = "platform-edge", ["x"] = 0, ["y"] = side == "left" ? -1 : 3, ["z"] = -5, ["rot"] = 0, ["w"] = 36,
                    ["cfg"] = cfg,
                });
            }
            var json = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["name"] = "Visuals Test",
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = modules,
                    ["lines"] = new JArray {
                        new JObject {
                            ["id"] = "1", ["name"] = "Line 1", ["colour"] = "#e3002b", ["stock"] = "B",
                            ["cars"] = 6, ["power"] = "overhead", ["psd"] = psdMode,
                        },
                    },
                },
            };
            return StationDocumentReader.Read(json.ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
        }

        static StationReadResult ReadContactShadowDocument() {
            var cells = new JArray();
            for (int x = 0; x < 10; x++) {
                cells.Add(new JObject { ["x"] = x, ["y"] = 0, ["z"] = -5, ["fill"] = "solid" });
                cells.Add(new JObject { ["x"] = x, ["y"] = 0, ["z"] = 0, ["fill"] = "solid" });
            }
            var modules = new JArray {
                new JObject { ["id"] = "bench-1", ["type"] = "bench", ["x"] = 1, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject() },
                new JObject { ["id"] = "gate-1", ["type"] = "gate", ["x"] = 3, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject() },
                new JObject { ["id"] = "fence-1", ["type"] = "fence", ["x"] = 5, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject() },
                new JObject { ["id"] = "tactile-1", ["type"] = "tactile", ["x"] = 6, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject { ["variant"] = "guide" } },
                new JObject { ["id"] = "sign-1", ["type"] = "sign", ["x"] = 7, ["y"] = 0, ["z"] = -5, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "ceiling" } },
                new JObject { ["id"] = "tree-1", ["type"] = "tree", ["x"] = 2, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject() },
            };
            var json = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["name"] = "Shadows Test",
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            };
            return StationDocumentReader.Read(json.ToString(Newtonsoft.Json.Formatting.None), StationSource.None);
        }

        static string BuildFlatFloorJson(int x0, int x1, int y0, int y1, int z) {
            var cells = new JArray();
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                }
            }
            return new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["name"] = "Run Test",
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }
    }
}
