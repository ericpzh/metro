using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 28 §3: the Structure builder's three tile families below the cell tools — the
    /// 支柱 family and its grow gesture, the 屋顶 area/bay gestures, and the rail's default line
    /// on a document that has none. The rules are `sim/structures.ts` (`pillarAt`,
    /// `extendedPillar`, `PILLAR_LENGTHS`), `build/Equipment.ts:createModule` and `build/rail.ts`
    /// (`defaultLine`, `layTrack`), and the fixture is the shared 12 × 12 pavement.
    /// </summary>
    public sealed class StationStructureBuilderTests {
        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationCellTool.Reset();
            StationRoofTool.Reset();
            StationPillarTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(StationCellFixture.Save, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationRoofTool.Reset();
            StationPillarTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        void ArmModule(string paletteId) {
            Assert.IsTrue(StationToolSelection.TrySelect("module", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject {
                ["moduleType"] = paletteId, ["rotation"] = 0, ["roofWidth"] = 4, ["pillarLength"] = 5,
            });
        }

        // ----------------------------------------------------------------- pillars

        [Test]
        public void ThePillarPaletteBecomesACreatableFamily() {
            Assert.IsTrue(StationModuleFamilies.TryParse("pillar-slim", "", 0, out var slim));
            Assert.AreEqual("pillar", slim.Type);
            Assert.AreEqual("slim", slim.Variant);
            Assert.IsTrue(StationModuleFamilies.TryParse("pillar-thick", "", 0, out var thick));
            Assert.AreEqual("thick", thick.Variant);

            var request = new StationPlacementRequest {
                ToolType = "pillar-slim",
                Rotation = 0,
                PillarLength = 3,
                Hit = StationCellFixture.Hit(5, 5, 0, true).Cell,
            };
            Assert.IsTrue(StationModuleFamilies.TryCreate(host.Index, request, null, out var draft, out var reason), reason);
            Assert.AreEqual("pillar", draft.Type);
            Assert.AreEqual("slim", draft.Text("size"));
            Assert.AreEqual("3", draft.Text("height"));
        }

        [Test]
        public void ASlimPillarsNineTurnsSurviveTheSave() {
            for (int spot = 0; spot < 9; spot++) {
                var draft = new StationEditDraft {
                    Id = "pillar-" + (spot + 1), Type = "pillar", X = spot, Y = 2, Z = 0, Rotation = spot,
                };
                draft.Set("size", "slim");
                draft.Set(5, "height");
                var record = StationModuleEdits.ToSaveRecord(draft);
                Assert.AreEqual(spot, (int)record["rot"], "a slim post keeps its in-cell spot");
                var saved = new StationModuleRecord("pillar-" + (spot + 1), "pillar", spot, 2, 0, spot, 1, 1, 1,
                    false, null, null, Array.Empty<string>(), record.ToString(Newtonsoft.Json.Formatting.None),
                    ModuleFactsReader.Read(record), 0, 0, 0);
                StationFootprints.PillarOffset(saved, out var ox, out var oy);
                var positions = new[,] { { 0, 0 }, { -1, 1 }, { 0, 1 }, { 1, 1 }, { -1, 0 }, { 1, 0 }, { -1, -1 }, { 0, -1 }, { 1, -1 } };
                Assert.AreEqual(positions[spot, 0] * (1 - StationFootprints.PillarWidth(saved)) / 2, ox, 1e-9,
                    "the saved spot places spot " + spot);
                Assert.AreEqual(positions[spot, 1] * (1 - StationFootprints.PillarWidth(saved)) / 2, oy, 1e-9);
            }
        }

        [Test]
        public void APressOnAnExistingPostGrowsItInsteadOfDroppingASecondShaft() {
            ArmModule("pillar-thick");
            var first = new StationPlacementRequest {
                ToolType = "pillar-thick", Rotation = 0, PillarLength = 5,
                Hit = StationCellFixture.Hit(4, 4, 0, true).Cell,
            };
            Assert.IsTrue(StationModuleFamilies.TryCreate(host.Index, first, null, out var seed, out var createReason), createReason);
            seed.Id = StationModulePlacement.NextId(host.Index, "pillar");
            var patch = new StationCellPatch();
            patch.AddModule(seed);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "place pillar", null, out _, out var code), code);
            var post = host.Index.GetModule(seed.Id);
            Assert.IsNotNull(post);
            Assert.AreEqual(5.0, post.Config.Number("height", 0), 1e-6);

            // The grow press: the armed section (5 m) is added to the existing shaft, same id.
            int before = host.CurrentRevision;
            var hit = StationCellFixture.Hit(4, 4, 0, true);
            Assert.IsTrue(StationPillarTool.Begin(host, hit, Pointer(100, 100, 0), 0, out code, out var reason),
                code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the growth is one revision");
            var grown = host.Index.GetModule(seed.Id);
            Assert.IsNotNull(grown, "the post keeps its id");
            Assert.AreEqual(10.0, grown.Config.Number("height", 0), 1e-6);
            int pillars = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "pillar") pillars++;
            Assert.AreEqual(1, pillars, "no second shaft was dropped beside it");

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(5.0, host.Index.GetModule(seed.Id).Config.Number("height", 0), 1e-6,
                "one undo takes the growth only");
        }

        [Test]
        public void APressOnOpenFloorPlacesAFreshPostThroughTheOrdinaryPlacement() {
            ArmModule("pillar-slim");
            var hit = StationCellFixture.Hit(6, 6, 0, true);
            Assert.IsFalse(StationPillarTool.Begin(host, hit, Pointer(100, 100, 0), 0, out _, out _),
                "no post stands there, so the caller falls through to the placement");
            int before = host.CurrentRevision;
            var request = StationPlacementRequest(6, 6, "pillar-slim", 5);
            var plan = StationModulePlacement.Resolve(host.Index, request);
            Assert.IsTrue(plan.Ok, plan.Reason);
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, "pillar");
            var patch = new StationCellPatch();
            patch.AddModule(plan.Candidate);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "place", null, out _, out var code), code);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            var placed = host.Index.GetModule(plan.Candidate.Id);
            Assert.AreEqual("slim", placed.Config.Text("size"));
            Assert.AreEqual(5.0, placed.Config.Number("height", 0), 1e-6);
        }

        static StationPlacementRequest StationPlacementRequest(int x, int y, string paletteId, int section) =>
            new StationPlacementRequest {
                ToolType = paletteId,
                Rotation = 0,
                PillarLength = section,
                Hit = StationCellFixture.Hit(x, y, 0, true).Cell,
            };

        // ------------------------------------------------------------------- anchors

        [Test]
        public void APaverAnchorsOnItsOwnDrawnTopNotTheGroundBehindIt() {
            // The reported paver: a 人行道 tile drawn 0.1 m proud of `host.Z + 1`. The nearest drawn
            // surface wins the pick (`pickCells`), so the block brush aims one cell above the
            // paver's own cell rather than at the ground the ray passes through (plan 28 §1).
            ArmBlock();
            var paver = new StationModuleRecord("sidewalk-1", "sidewalk", 2, 2, 0, 0, 1, 1, 1, false,
                null, null, Array.Empty<string>(), "{\"cfg\":{}}", ModuleFactsReader.Read(
                    new JObject { ["id"] = "sidewalk-1", ["type"] = "sidewalk", ["x"] = 2, ["y"] = 2, ["z"] = 0 }),
                0, 0, 0);
            var hit = new StationSceneHit {
                Level = 0,
                Module = paver,
                ModuleExact = true,
                ModuleDistance = 1f,
                ModulePoint = new StationPoint(2.5, 2.5, 1.1),
                ModuleNormal = new StationPoint(0, 0, 1),
                Cell = StationPlacementHit.None,
            };
            Assert.IsTrue(StationCellTool.Begin(host, hit, "block", 0, Pointer(100, 100, 0), out var reason), reason);
            var preview = StationCellTool.Preview;
            Assert.IsTrue(preview.HasPlan, "the paver resolves a plan");
            Assert.AreEqual(2, preview.Cursor.Z, "the aim cell is above the paver's own drawn top");
            Assert.AreEqual(1, preview.Check.Accepted.Count, "the cell above the paver is a candidate");
            Assert.AreEqual(0, preview.Check.Ignored.Count);
            Assert.AreEqual(0, preview.Check.Blocked.Count);
        }

        [Test]
        public void ACutPieceHoverIsTheCutTheReleaseLays() {
            Assert.IsTrue(StationToolSelection.TrySelect("block", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["halfWall"] = true, ["wallSnapCycle"] = 0 });
            var hit = StationCellFixture.Hit(7, 7, 0, true);
            Assert.IsTrue(StationCellTool.Begin(host, hit, "block", 0, Pointer(100, 100, 0), out var reason), reason);
            var preview = StationCellTool.Preview;
            Assert.AreEqual("cut", preview.Kind);
            Assert.IsFalse(preview.Check.Shape.IsFull, "a 半墙 hover draws the half piece");
            Assert.AreEqual(Metro.Build.StationWallSide.N, preview.Check.Shape.Side);
            // A stationary R steps the side under the held press, ghost and release together.
            StationToolSelection.ApplySettings(new JObject { ["wallSnapCycle"] = 1 });
            StationCellTool.Aim(host, hit, Pointer(100, 100, 160));
            Assert.AreEqual(Metro.Build.StationWallSide.E, StationCellTool.Preview.Check.Shape.Side,
                "the held cut follows R");
            int before = host.CurrentRevision;
            Assert.IsTrue(StationCellTool.Finish(host, hit, Pointer(100, 100, 220), out code, out var finishReason),
                code ?? finishReason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            var cell = host.Index.GetCell(7, 7, 1);
            Assert.IsNotNull(cell, "the cut course is laid in the cell above the floor");
        }

        void ArmBlock() {
            Assert.IsTrue(StationToolSelection.TrySelect("block", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["halfWall"] = false, ["triangles"] = false });
        }

        // -------------------------------------------------------------------- roofs

        [Test]
        public void ASlabPressLaysThePriceTheGhostDrewInOneRevision() {
            ArmModule("roof");
            var hit = StationCellFixture.Hit(5, 5, 0, true);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationRoofTool.Begin(host, hit, Pointer(100, 100, 0), default, 0, out var reason), reason);
            Assert.AreEqual(1, StationRoofTool.Accepted.Count, "the hover ghost is the piece the release lays");
            Assert.IsTrue(StationRoofTool.Finish(host, hit, Pointer(100, 100, 40), default, out var code, out var finishReason),
                code ?? finishReason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one release, one revision");
            int roofs = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "roof") roofs++;
            Assert.AreEqual(1, roofs);
        }

        [Test]
        public void ATaperedBayDragStepsWholeBaysAlongItsCrestAxis() {
            ArmModule("roof-tapered");
            int level = 0;
            // The bay aim plane stands at `level + 1 + trussRoofTop`; a straight-down ray from above
            // it resolves the pointed cell, exactly as the camera's own ray would.
            float height = (float)(level + 1 + StationRoofRules.Top);
            var ray = new Ray(new Vector3(6f, height + 20f, 6f), Vector3.down);
            var hit = StationEditHit(6, 6, level);
            Assert.IsTrue(StationRoofTool.Begin(host, hit, Pointer(400, 300, 0), ray, 0, out var reason), reason);
            // Drag two whole bays along +x: three anchors, four metres apart.
            var dragRay = new Ray(new Vector3(14f, height + 20f, 6f), Vector3.down);
            StationRoofTool.AimAt(host, hit, dragRay, Pointer(500, 300, 220));
            var cells = StationRoofTool.Accepted.Count + StationRoofTool.Refused.Count;
            Assert.AreEqual(3, cells, "two bay steps make three whole bays");
            foreach (var plan in StationRoofTool.Accepted) {
                Assert.AreEqual("tapered-truss", plan.Candidate.Text("variant"));
                Assert.AreEqual(StationRoofRules.Bay, plan.Candidate.Width);
                Assert.AreEqual(4, plan.Candidate.Depth);
            }
        }

        [Test]
        public void TheSecondaryPressLiftsTheRoofPieceUnderThePointer() {
            ArmModule("roof");
            var hit = StationCellFixture.Hit(3, 6, 0, true);
            Assert.IsTrue(StationRoofTool.Begin(host, hit, Pointer(100, 100, 0), default, 0, out var reason), reason);
            Assert.IsTrue(StationRoofTool.Finish(host, hit, Pointer(100, 100, 20), default, out _, out _));
            var roof = FirstRoof();
            Assert.IsNotNull(roof);
            Assert.IsTrue(host.Index.TryGetModule(roof.Id, out _));
            // Aim at the roof's own drawn cell with a module hit, then remove it on the release.
            var onRoof = StationCellFixture.Hit(roof.X, roof.Y, roof.Z, true);
            onRoof.Module = roof;
            onRoof.ModuleExact = true;
            onRoof.ModuleDistance = 1f;
            int before = host.CurrentRevision;
            Assert.IsTrue(StationRoofTool.Begin(host, onRoof, Pointer(100, 100, 200), default, 2, out reason), reason);
            Assert.IsTrue(StationRoofTool.Finish(host, onRoof, Pointer(100, 100, 240), default, out var code, out var removeReason),
                code ?? removeReason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.IsNull(FirstRoof(), "the piece is gone");
        }

        StationModuleRecord FirstRoof() {
            foreach (var module in host.Index.Document.Modules) if (module.Type == "roof") return module;
            return null;
        }

        static StationSceneHit StationEditHit(int x, int y, int z) =>
            new StationSceneHit { Level = z, Cell = StationPlacementHit.None };

        // ------------------------------------------------------------------- rails

        [Test]
        public void AFirstRailOnALineLessDocumentCreatesItsDefaultLine() {
            Assert.AreEqual(0, host.Index.Document.Lines.Count, "the fixture carries no line");
            Assert.IsTrue(StationToolSelection.TrySelect("rail", out _, out var selectCode), selectCode);
            var plan = StationRailPlanner.Plan(host.Index, "", "up", 0, 4, 4, 0);
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.IsNotNull(plan.NewLine, "the plan carries the line it creates");
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            int before = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "place rail", null, out _, out var code), code);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the line and its rail are one revision");
            Assert.AreEqual(1, host.Index.Document.Lines.Count);
            var line = host.Index.Document.Lines[0];
            Assert.AreEqual("1", line.Id);
            Assert.AreEqual("B", line.Stock, "the reference's stock-B six-car default");
            Assert.AreEqual(6, line.Cars);
            Assert.AreEqual("full", line.Psd);
            Assert.AreEqual(1, host.Index.ModulesOfType("track").Count);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(0, host.Index.Document.Lines.Count, "one undo takes the line with the rail");
        }

        [Test]
        public void ABridgeAndATunnelReadOneExtensionAim() {
            Assert.IsTrue(StationToolSelection.TrySelect("rail", out _, out var selectCode), selectCode);
            var plan = StationRailPlanner.Plan(host.Index, "", "up", 0, 4, 4, 0);
            Assert.IsTrue(plan.Ok, plan.Reason);
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "place rail", null, out _, out var code), code);
            var source = host.Index.ModulesOfType("track")[0];

            StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = 4 });
            var hover = StationCellFixture.Hit(source.X + source.Width - 1, source.Y, 0, true);
            var tunnel = StationTunnelTool.Plan(host, hover, false);
            Assert.IsNotNull(tunnel, "a tunnel hangs off the rail under the pointer");
            Assert.IsTrue(tunnel.Tunnel);
            var bridge = StationTunnelTool.Plan(host, hover, true);
            Assert.IsNotNull(bridge, "the bridge reads the same aim");
            Assert.AreEqual("1", bridge.Track.Text("bridge"), "the bridge variant sets cfg.bridge");
            Assert.AreEqual(tunnel.X, bridge.X, "one aim, the same free end");
            Assert.AreEqual(tunnel.Y, bridge.Y);
        }
    }
}
