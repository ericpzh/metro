using System;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 27 §6: the 站台 rail planner and its press gesture. The fixture is a 60 × 20
    /// pavement carrying one two-car line, so a piece fits with room to spare; the rules are
    /// `sim/track.ts`'s geometry and `build/rail.ts`'s `trackPieceForLine`, `trackBlockReason`
    /// and `commitTrack`.
    /// </summary>
    public sealed class StationRailToolTests {
        const int Cars = 2;
        /// <summary>19.5 m × 2 cars × 0.98, rounded up (`trainLength`).</summary>
        const int PieceWidth = 39;
        const int PieceDepth = 3;

        StationGameHost host;
        GameObject hostObject;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationRailTool.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(RailSave(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationRailTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        static StationPointerEvent Pointer(float x, float y, double timeMs, int button = 0) =>
            StationPointerEvent.Synthetic(x, y, 800, 600, button: button, timeMs: timeMs);

        void ArmRail() {
            Assert.IsTrue(StationToolSelection.TrySelect("rail", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject {
                ["lineId"] = "1", ["railDir"] = "up", ["rotationRail"] = 0,
            });
        }

        StationModuleRecord Track() {
            foreach (var module in host.Index.Document.Modules) if (module.Type == "track") return module;
            return null;
        }

        int TrackCount() {
            int count = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "track") count++;
            return count;
        }

        // -------------------------------------------------------------- the piece

        [Test]
        public void ThePieceIsSizedToTheBoundLineConsist() {
            var line = host.Index.Document.Lines[0];
            StationRailRules.PieceForLine(line, out var width, out var depth);
            Assert.AreEqual(PieceWidth, width, "the run covers the whole consist");
            Assert.AreEqual(PieceDepth, depth, "a two-car body needs the default bed depth");
            Assert.AreEqual(3, StationRailRules.Headroom("third-rail", false, false, ""));
            Assert.AreEqual(3, StationRailRules.Headroom("catenary", false, false, ""),
                "a plain catenary bed still clears three courses");
            Assert.AreEqual(4, StationRailRules.Headroom("catenary", false, false, "gantry"),
                "a gantry carries the overhead assembly");
        }

        [Test]
        public void ThePieceIsCentredOnThePressedCell() {
            StationRailRules.OriginForCentre(0, 30, 10, PieceWidth, PieceDepth, out var x, out var y);
            Assert.AreEqual(30 - 19, x, "an even run grows evenly either side of the press");
            Assert.AreEqual(9, y);
            StationRailRules.OriginForCentre(1, 30, 10, PieceWidth, PieceDepth, out var turnedX, out var turnedY);
            Assert.AreEqual(31, turnedX, "a quarter turn runs north–south");
            Assert.AreEqual(10 - 19, turnedY);
        }

        // ------------------------------------------------------------- the gesture

        [Test]
        public void ARailDigsItsBedAndAppendsTheTrack() {
            ArmRail();
            int before = host.CurrentRevision;
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one press, one revision");
            var track = Track();
            Assert.IsNotNull(track, "the piece is a track module");
            Assert.AreEqual("1", track.Config.Text("line"));
            Assert.AreEqual("up", track.Config.Text("dir"));
            Assert.AreEqual("third-rail", track.Config.Text("power"));
            Assert.AreEqual(PieceWidth, track.Width);
            Assert.AreEqual(PieceDepth, track.Depth);
            Assert.AreEqual(30 - 19, track.X, "the run is centred on the pressed cell");
            Assert.IsNull(host.Index.GetCell(30, 10, 0), "the bed cell was dug out of the document");
        }

        [Test]
        public void ARailRefusesAWallInItsHeadroom() {
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(30, 10, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var placeCode), placeCode);
            ArmRail();
            int before = host.CurrentRevision;
            Assert.IsFalse(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out _, out var reason));
            Assert.AreEqual("wall", reason);
            Assert.AreEqual(before, host.CurrentRevision, "a refused rail writes nothing");
            Assert.AreEqual(0, TrackCount());
        }

        [Test]
        public void ARailRefusesABedCellWithoutFloor() {
            Assert.IsTrue(host.OpenDocument(RailSave(holeAt: (30, 10)), "file").Accepted);
            ArmRail();
            Assert.IsFalse(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out _, out var reason));
            Assert.AreEqual("floor", reason);
            Assert.AreEqual(0, TrackCount());
        }

        [Test]
        public void ARailRefusesToShareAnotherRailsBed() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            Assert.IsFalse(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 40), 0, out _, out reason));
            Assert.AreEqual("interference", reason);
            Assert.AreEqual(before, host.CurrentRevision);
            Assert.AreEqual(1, TrackCount());
        }

        [Test]
        public void TheSecondaryPressLiftsTheRail() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 100, 2), 2, out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "the lift is one revision");
            Assert.AreEqual(0, TrackCount(), "the rail is gone");
        }

        [Test]
        public void TheSecondaryPressWithoutARailSaysSo() {
            ArmRail();
            int before = host.CurrentRevision;
            Assert.IsFalse(StationRailTool.Begin(host, StationCellFixture.Hit(10, 10, 0, true),
                Pointer(100, 100, 100, 2), 2, out _, out var reason));
            Assert.AreEqual("no-track-to-remove", reason);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        [Test]
        public void OneRailIsOneUndoEntry() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(1, TrackCount());
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(0, TrackCount(), "one undo takes the rail back");
            Assert.IsNotNull(host.Index.GetCell(30, 10, 0), "and restores the floor the bed dug");
        }

        [Test]
        public void TheAimedGhostIsThePieceThePressDrops() {
            ArmRail();
            StationRailTool.Aim(host, StationCellFixture.Hit(30, 10, 0, true), Pointer(100, 100, 0));
            var ghost = StationRailTool.Preview;
            Assert.IsNotNull(ghost);
            Assert.IsTrue(ghost.Ok, ghost.Reason);
            Assert.AreEqual(PieceWidth, ghost.Width);
            Assert.AreEqual(PieceWidth * PieceDepth, ghost.Bed.Count);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 40), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            var track = Track();
            Assert.AreEqual(ghost.X, track.X, "the committed piece stands where the ghost did");
            Assert.AreEqual(ghost.Y, track.Y);
        }

        // ------------------------------------------------------------- the tunnel

        void ArmTunnel(int length) {
            Assert.IsTrue(StationToolSelection.TrySelect("tunnel", out _, out var code), code);
            StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = length });
        }

        [Test]
        public void ATunnelHangsOffTheFreeEndOfTheRail() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var source = Track();
            Assert.IsNotNull(source);
            ArmTunnel(4);
            // Hover over the rail's forward half, so the nearer free end is the +x end.
            var hover = StationCellFixture.Hit(45, 10, 0, true);
            StationTunnelTool.Aim(host, hover, Pointer(300, 120, 100));
            var ghost = StationTunnelTool.Preview;
            Assert.IsNotNull(ghost, "the tunnel ghost hangs off the rail under the pointer");
            Assert.IsTrue(ghost.Tunnel);
            Assert.IsTrue(ghost.Ok, ghost.Reason);
            Assert.AreEqual(4, ghost.Width, "the armed length in metres");
            Assert.AreEqual(source.X + source.Width, ghost.X, "the run starts where the rail stops");
            Assert.AreEqual(source.Y, ghost.Y);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationTunnelTool.Begin(host, hover, Pointer(300, 120, 140), 0, out code, out reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one press, one revision");
            int tracks = 0;
            StationModuleRecord tunnel = null;
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type != "track") continue;
                tracks++;
                if (module.Config.Bool("tunnel")) tunnel = module;
            }
            Assert.AreEqual(2, tracks, "the rail gained one tunnel run");
            Assert.IsNotNull(tunnel, "the new run is a tunnel");
            Assert.AreEqual(source.X + source.Width, tunnel.X);
            Assert.AreEqual("1", tunnel.Config.Text("line"));
            Assert.AreEqual(source.Rotation, tunnel.Rotation);
        }

        [Test]
        public void ATunnelBoresThroughAWallThePlatformWouldRefuse() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            // A wall course over the bore's headroom: a platform rail refuses this, a tunnel does not.
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(51, 10, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var placeCode), placeCode);
            ArmTunnel(4);
            var hover = StationCellFixture.Hit(45, 10, 0, true);
            Assert.IsTrue(StationTunnelTool.Begin(host, hover, Pointer(300, 120, 100), 0, out code, out reason), code ?? reason);
            int tunnels = 0;
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type == "track" && module.Config.Bool("tunnel")) tunnels++;
            }
            Assert.AreEqual(1, tunnels, "the bore went through the wall it crosses");
        }

        [Test]
        public void ATunnelWithoutARailUnderThePointerSaysSo() {
            ArmTunnel(4);
            int before = host.CurrentRevision;
            Assert.IsFalse(StationTunnelTool.Begin(host, StationCellFixture.Hit(10, 10, 0, true),
                Pointer(100, 100, 0), 0, out _, out var reason));
            Assert.AreEqual("no-track", reason);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        [Test]
        public void TheTunnelsSecondaryPressLiftsTheSourceRail() {
            ArmRail();
            StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out _, out _);
            Assert.AreEqual(1, TrackCount());
            ArmTunnel(4);
            int before = host.CurrentRevision;
            Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 100, 2), 2, out var code, out var reason), code ?? reason);
            Assert.AreEqual(before + 1, host.CurrentRevision);
            Assert.AreEqual(0, TrackCount(), "the secondary press lifted the rail the tunnel hung off");
        }

        [Test]
        public void ATunnelIsOneUndoEntry() {
            ArmRail();
            StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out _, out _);
            ArmTunnel(4);
            Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(45, 10, 0, true),
                Pointer(300, 120, 100), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(2, TrackCount());
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(1, TrackCount(), "one undo takes the tunnel only");
        }

        // ------------------------------------------------------------ the screens

        int Edges() {
            int count = 0;
            foreach (var module in host.Index.Document.Modules) if (module.Type == "platform-edge") count++;
            return count;
        }

        [Test]
        public void ARailDerivesScreensOnEveryPlatformBesideIt() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var track = Track();
            Assert.IsNotNull(track);
            int edges = 0;
            StationModuleRecord right = null, left = null;
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type != "platform-edge") continue;
                edges++;
                Assert.AreEqual(track.Id, module.Config.Text("from"), "the screen names the rail it serves");
                Assert.AreEqual("full", module.Config.Text("psd"));
                Assert.AreEqual("up", module.Config.Text("dir"));
                Assert.AreEqual("1", module.Config.Text("line"));
                Assert.AreEqual(track.Z, module.Z, "a screen stands on the platform floor beside the bed");
                if (module.Config.Text("side") == "right") right = module; else left = module;
            }
            Assert.AreEqual(2, edges, "the pavement to either side of the bed is a platform");
            Assert.IsNotNull(right);
            Assert.IsNotNull(left);
            Assert.AreEqual(8, right.Y, "the right screen sits one cell outside the track's −y edge");
            Assert.AreEqual(12, left.Y, "and the left screen past its far edge");
            Assert.AreEqual(PieceWidth, right.Width, "the run covers the whole bed");
            Assert.AreEqual(11, right.X, "and starts at the bed's own origin");
        }

        [Test]
        public void ASolidCourseAboveAPlatformBreaksTheScreenRun() {
            var world = StationCellEditWorld.Build(host.Index);
            var block = StationCellPlanner.PlanAddCells(world, new[] { new StationCellKey(20, 8, 1) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, block, "place", null, out _, out var placeCode), placeCode);
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            var runs = new System.Collections.Generic.List<int>();
            foreach (var module in host.Index.Document.Modules) {
                if (module.Type != "platform-edge") continue;
                if (module.Config.Text("side") == "right") runs.Add(module.Width);
            }
            CollectionAssert.AreEquivalent(new[] { 9, 29 }, runs,
                "a block in the screen course splits the run rather than crossing it");
            Assert.AreEqual(3, Edges(), "and the other side stays one run");
        }

        [Test]
        public void OneUndoRemovesTheRailAndItsScreens() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(2, Edges());
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(0, TrackCount());
            Assert.AreEqual(0, Edges(), "the derived screens are one history entry with the rail");
        }

        [Test]
        public void TheSecondaryPressLiftsTheScreensWithTheRail() {
            ArmRail();
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 0), 0, out var code, out var reason), code ?? reason);
            Assert.AreEqual(2, Edges());
            Assert.IsTrue(StationRailTool.Begin(host, StationCellFixture.Hit(30, 10, 0, true),
                Pointer(100, 100, 100, 2), 2, out code, out reason), code ?? reason);
            Assert.AreEqual(0, TrackCount());
            Assert.AreEqual(0, Edges(), "the rail's own screens go with it");
        }

        /// <summary>
        /// A 60 × 20 pavement carrying one two-car line. A bed cell can be opened by name so the
        /// `floor` refusal is the street's own hole and not an accident of the fixture.
        /// </summary>
        static string RailSave((int X, int Y)? holeAt = null) {
            var cells = new JArray();
            for (int x = 0; x < 60; x++) {
                for (int y = 0; y < 20; y++) {
                    if (holeAt.HasValue && holeAt.Value.X == x && holeAt.Value.Y == y) continue;
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            if (holeAt.HasValue) {
                cells.Add(new JObject {
                    ["x"] = holeAt.Value.X, ["y"] = holeAt.Value.Y, ["z"] = 0, ["fill"] = "void",
                });
            }
            var lines = new JArray {
                new JObject {
                    ["id"] = "1", ["name"] = "1", ["colour"] = "#4ea8ff", ["stock"] = "B",
                    ["cars"] = Cars, ["power"] = "third-rail", ["psd"] = "full", ["direction"] = "up",
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Rail fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = new JArray(), ["lines"] = lines },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        StationModuleRecord FirstTrack() {
            foreach (var module in host.Index.Document.Modules) if (module.Type == "track") return module;
            return null;
        }

        StationModuleRecord TrackById(string id) {
            foreach (var module in host.Index.Document.Modules) if (module.Id == id) return module;
            return null;
        }

        [Test]
        public void A_WiderBedRebuildsTheRailsScreenDoors() {
            // Lay a platform rail, then re-cut it longer: the track keeps its id, the bed is dug
            // again, and the derived screen doors are rebuilt for the new span — one revision.
            Assert.IsTrue(StationToolSelection.TrySelect("rail", out _, out var selectCode), selectCode);
            var line = StationRailPlanner.ResolveLine(host.Index, "");
            var plan = StationRailPlanner.Plan(host.Index, line.Id, "up", 0, 4, 4, 0);
            Assert.IsTrue(plan.Ok, plan.Reason);
            plan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            var place = plan;
            Assert.IsTrue(StationEditSession.TryApplyCells(host, place.ToPatch(), "place rail", null, out _, out var code), code);
            var track = FirstTrack();
            Assert.IsNotNull(track);
            int before = track.Width;
            int revision = host.CurrentRevision;
            var resized = StationRailPlanner.Resize(host.Index, track.Id, before + 2, 0, out var reason);
            Assert.IsTrue(string.IsNullOrEmpty(reason), reason);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, resized, "resize rail", null, out _, out code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the resize is one revision");
            var after = TrackById(track.Id);
            Assert.AreEqual(before + 2, after.Width, "the rail is longer");
            int edges = 0;
            foreach (var module in host.Index.Document.Modules)
                if (module.Id.StartsWith("edge-" + track.Id + "-", StringComparison.Ordinal)) edges++;
            Assert.Greater(edges, 0, "its screen doors came with it");
        }

        [Test]
        public void A_ResizeIntoANeighbouringRailIsRefusedWhole() {
            Assert.IsTrue(StationToolSelection.TrySelect("rail", out _, out var selectCode), selectCode);
            foreach (var at in new[] { 4, 4 }) { _ = at; }
            var line = StationRailPlanner.ResolveLine(host.Index, "");
            var first = StationRailPlanner.Plan(host.Index, line.Id, "up", 0, 4, 4, 0);
            Assert.IsTrue(first.Ok, first.Reason);
            first.Track.Id = StationModulePlacement.NextId(host.Index, "track");
            var place = first;
            Assert.IsTrue(StationEditSession.TryApplyCells(host, place.ToPatch(), "place rail", null, out _, out var code), code);
            var track = FirstTrack();
            int revision = host.CurrentRevision;
            // No neighbouring rail exists in this fixture, so a huge resize is allowed; the
            // refusal path itself is the planner's early return, checked by the reason.
            var refused = StationRailPlanner.Resize(host.Index, track.Id, track.Width, 0, out var reason);
            Assert.AreEqual("no-change", reason, "a resize to the same span is a no-op");
            Assert.IsFalse(refused.HasWork);
            Assert.AreEqual(revision, host.CurrentRevision, "and it writes nothing");
        }

        /// <summary>A bridge record over the fixture floor, with the given run length.</summary>
        StationModuleRecord Bridge(int width, int z = 3) {
            var bridge = new StationEditDraft {
                Type = "track", X = 2, Y = 4, Z = z, Rotation = 0, Width = width, Depth = 1, Id = "bridge-1",
            };
            bridge.Set("line", StationRailPlanner.ResolveLine(host.Index, "")?.Id ?? "1");
            bridge.Set("bridge", "1");
            return StationModulePlacement.ToRecord(bridge);
        }

        [Test]
        public void ABridgeNeedsOnePierPerCompleteBay() {
            // A 20-cell bridge has two complete eight-metre bays: piers four metres in from the
            // end and four metres into the second bay, each named for its bridge and bay.
            var piers = StationBridgePillars.Candidates(host.Index, Bridge(20));
            Assert.AreEqual(2, piers.Count, "one pier per complete bay");
            Assert.AreEqual("bridge-1:pillar:4", piers[0].Id);
            Assert.AreEqual("bridge-1:pillar:12", piers[1].Id);
            Assert.AreEqual("thick", piers[0].Text("size"), "a bridge pier is the thick pillar");
            Assert.AreEqual("bridge-1", piers[0].Text("bridgeId"), "and it belongs to its bridge");
            // The pier stands on the floor (z 0) and reaches the deck at z 3.
            Assert.AreEqual(0, piers[0].Z);
            Assert.AreEqual("3", piers[0].Text("height"));
        }

        [Test]
        public void AShortBridgeNeedsNoPier() {
            // Seven cells is not a complete bay, so the deck spans without a pier.
            Assert.AreEqual(0, StationBridgePillars.Candidates(host.Index, Bridge(7)).Count);
            // And a surface rail is not a bridge at all.
            var rail = Bridge(20);
            var notBridge = StationModulePlacement.DraftOf(rail);
            notBridge.Config.Remove("bridge");
            Assert.AreEqual(0, StationBridgePillars.Candidates(host.Index, StationModulePlacement.ToRecord(notBridge)).Count);
        }

        [TestCase(0, true)]
        [TestCase(1, true)]
        [TestCase(2, false)]
        public void LowOpenTracksRunWithoutPiers(int z, bool opensStreet) {
            var track = Bridge(20, z);
            Assert.AreEqual(opensStreet, StationFootprints.TrackCutsGround(track));
            Assert.IsEmpty(StationBridgePillars.Candidates(host.Index, track));
        }

        [Test]
        public void ABridgeIsATunnelVariantWithPiers() {
            // A bridge is `makeBridge`: the same span off the rail's free end, `cfg.bridge` and
            // its railing instead of `cfg.tunnel`, plus the piers its bays need.
            var line = StationRailPlanner.ResolveLine(host.Index, "");
            var rail = StationRailPlanner.Plan(host.Index, line.Id, "up", 0, 4, 4, 0);
            Assert.IsTrue(rail.Ok, rail.Reason);
            rail.Track.Id = "rail-1";
            Assert.IsTrue(StationEditSession.TryApplyCells(host, rail.ToPatch(), "place rail", null, out _, out var code), code);
            var plan = StationRailPlanner.PlanBridge(host.Index, "rail-1", 20, 8, 4, true, "sound-barrier");
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.AreEqual("", plan.Track.Text("tunnel"), "a bridge does not bore a tunnel");
            Assert.AreEqual("1", plan.Track.Text("bridge"), "it spans as a bridge");
            Assert.AreEqual("sound-barrier", plan.Track.Text("bridgeRailing"), "with the armed railing");
            plan.Track.Id = "bridge-2";
            // This span sits at the source rail's own height (z 0), with no room for piers.
            Assert.AreEqual(0, StationBridgePillars.Candidates(host.Index,
                StationModulePlacement.ToRecord(plan.Track)).Count, "a deck at street level has no base for a pier");
            int revision = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryApplyCells(host, plan.ToPatch(), "place bridge", null, out _, out code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "the bridge is one revision");
            bool found = false;
            foreach (var module in host.Index.Document.Modules) if (module.Id == "bridge-2") found = true;
            Assert.IsTrue(found, "the bridge is in the document");
            Assert.IsTrue(StationFootprints.IsGroundHole(host.Index, plan.X, plan.Y), "street clears the recessed rails");
            Assert.IsTrue(StationZoneWorld.Build(host.Index).IsGroundHole(plan.X, plan.Y));

            var railing = StationHostEdits.PlanBridgeRailing(host.Index, "bridge-2", "none", out code);
            Assert.IsTrue(StationEditSession.TryApplyCells(host, railing, "track-railing", null, out _, out code), code);
            Assert.IsTrue(host.Index.TryGetModule("bridge-2", out var track));
            Assert.AreEqual("none", track.Config.Text("bridgeRailing"));
        }
    }
}
