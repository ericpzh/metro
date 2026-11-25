using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// End-to-end regression suite closing the four Unity editor testing gaps:
    /// 1. Fence snapping and sealing flush to escalators (narrow/wide), walkways, stairs,
    ///    lane gates, doorless gates, and continuous one-axis runs across all four fence variants.
    /// 2. Drag previews drawing ONLY translucent 3D models / live-composed sealed fence runs
    ///    (never solid 1x1x1 blue cell cubes), plus doorless gate ghost panels and live adjacent
    ///    fence recomposition with clean restore on cancel.
    /// 3. Press-and-drag line placement (with and without <c>lineSpacing</c>) and right-drag line
    ///    removal across every supported equipment, decor, wall-mounted, and ceiling-hung palette.
    /// 4. Post-placement and right-click state leaving ZERO blue selection highlight or wireframe
    ///    box on newly placed modules while keeping explicit <c>select</c> highlights intact.
    /// </summary>
    public sealed class StationFenceAndDragPlacementTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        GameObject hostObject;
        GameObject cameraObject;
        StationGameHost host;
        StationViewRig rig;
        Camera camera;
        RuntimeCatalogue catalogue;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationPillarTool.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationRoadTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationEditHost.ResetForTests();

            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "RuntimeCatalogue missing at " + RuntimeCatalogue.AssetPath);

            // Build a 16x12 floor slab at z = -5 with a north wall along y = 11 (z = -4..-1)
            // and a ceiling slab at z = 0 over x = 0..15, y = 0..10 so floor, wall, and ceiling
            // mounts can all be driven through real camera rays.
            var cells = new JArray();
            for (int x = 0; x < 16; x++) {
                for (int y = 0; y < 12; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -5, ["fill"] = "solid" });
                }
                for (int z = -4; z <= -1; z++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = 11, ["z"] = z, ["fill"] = "solid" });
                }
                for (int y = 0; y < 11; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            // One pre-placed fence at (2, 4, -5) and one blocking bin at (5, 4, -5) for live
            // neighbour recomposition and blocked-cell preview tests.
            var modules = new JArray {
                new JObject {
                    ["id"] = "fence-existing", ["type"] = "fence", ["x"] = 2, ["y"] = 4, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "glass" },
                },
                new JObject {
                    ["id"] = "bin-blocker", ["type"] = "bin", ["x"] = 5, ["y"] = 4, ["z"] = -5, ["rot"] = 0,
                },
            };

            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "测试站",
                ["city"] = "guangzhou",
                ["seed"] = 11,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = new JArray(),
                },
            }.ToString(Newtonsoft.Json.Formatting.None);

            hostObject = new GameObject(StationGameHost.ObjectName);
            cameraObject = new GameObject("fence-drag-test-camera");
            camera = cameraObject.AddComponent<Camera>();
            camera.orthographic = true;
            camera.orthographicSize = 14f;
            camera.nearClipPlane = 0.5f;
            camera.farClipPlane = 400f;

            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = catalogue;
            host.trainCatalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color");
            host.stationCamera = camera;
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.Coordinator.RegisterRenderer(new StationCellRenderer());
            host.Coordinator.RegisterRenderer(new OutdoorModuleRenderer());
            host.Coordinator.RegisterRenderer(new VerticalModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationDisplayModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationStructureModuleRenderer());
            host.Coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
            host.Coordinator.RegisterRenderer(new OpeningModuleRenderer());

            var opened = host.OpenDocument(envelope, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            rig = StationViewFeature.Attach(host);
            StationEditFeature.Attach(host);
            Exec("camera.snap", new JObject { ["face"] = "top", ["ortho"] = true });
            Exec("camera.zoom", new JObject { ["factor"] = 4 });
            Exec("view.set", new JObject { ["key"] = "level", ["value"] = -5 });
            Exec("view.set", new JObject { ["key"] = "ground", ["value"] = true });
            rig.Tick(0f);
            host.SetActiveLevel(rig.Visibility.State.ActiveLevel);
        }

        [TearDown]
        public void TearDown() {
            StationSectionDrag.Reset();
            StationEditHost.ResetForTests();
            if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            cameraObject = null;
            hostObject = null;
            host = null;
            rig = null;
            camera = null;
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationPillarTool.Reset();
            StationRoofTool.Reset();
            StationSurfaceTool.Reset();
            StationZoneTool.Reset();
            StationPaintTool.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationRoadTool.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        // ----------------------------------------------------------- 1. Fence sealing & escalator pillars

        [Test]
        public void ZooEscalatorAdjacentFencesMeetIntegralEscalatorPillarsWithoutHandrailClipping() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read, "Zoo fixture missing");
            var zooFacts = read.Document.Modules.Select(m => m.Facts).ToArray();
            var conns = StationFenceConnections.For(zooFacts);

            // 1. Escalator-adjacent fences (both lower landing fence-4080 beside escalator-4074 and
            //    upper landing fence-367 beside escalator-4077) stop strictly at the cell boundary
            //    (Seal* == 0, Pillar* == true) so glass/rail NEVER stab through the moving rubber handrail.
            var fence4080 = zooFacts.First(m => m.Id == "fence-4080");
            var n4080 = OutdoorModuleViews.Neighbours(fence4080, conns);
            Assert.IsTrue(n4080.West && n4080.PillarWest, "fence-4080 meets escalator-4074's integral east pillar");
            Assert.IsTrue(n4080.South, "fence-4080 connects south along its fence run");
            Assert.AreEqual(0f, n4080.SealWest, 1e-4f, "fence-4080 must NOT extend past x=52.0 into the moving handrail");

            var fenceView4080 = BuildFenceView(fence4080, zooFacts, out var fHolder4080);
            try {
                Assert.AreEqual(2, fenceView4080.ComposedArms);
                Assert.AreEqual(52.0f, fenceView4080.Bounds.min.x, 0.005f,
                    "fence-4080 west arm must stop flush at cell boundary x=52.00");
            } finally {
                UnityEngine.Object.DestroyImmediate(fHolder4080);
            }

            var fence367 = zooFacts.First(m => m.Id == "fence-367");
            var n367 = OutdoorModuleViews.Neighbours(fence367, conns);
            Assert.IsTrue(n367.West && n367.PillarWest, "fence-367 meets escalator-4077's integral upper-landing pillar");
            Assert.AreEqual(0f, n367.SealWest, 1e-4f, "fence-367 must NOT stab into escalator-4077's black rubber handrail");

            var fenceView367 = BuildFenceView(fence367, zooFacts, out var fHolder367);
            try {
                Assert.AreEqual(54.0f, fenceView367.Bounds.min.x, 0.005f,
                    "fence-367 west arm stops flush at cell boundary x=54.00");
            } finally {
                UnityEngine.Object.DestroyImmediate(fHolder367);
            }

            // 2. The prefab escalators themselves build the vertical steel receiver pillar flush
            //    between the outer edge of the black rubber handrail (halfW - 0.095) and cell edge (halfW).
            var esc4077 = zooFacts.First(m => m.Id == "escalator-4077");
            var escView4077 = BuildVerticalView(esc4077, zooFacts, out var eHolder4077);
            try {
                Assert.IsTrue(escView4077.UsedPrefab, "escalator-4077 still instances the promoted Escalator prefab");
                Assert.IsTrue(escView4077.TryGetPart("fence-pillar", out var pillar), "escalator-4077 must build fence-pillar for fence-367");
                var pillarBounds = WorldBoundsOf(pillar);
                // escalator-4077 sits at x=53..54, upper landing y=23..24 (center y=23.5), floor z=-14.
                // Black rubber handrail outer edge is at x=53.905; pillar spans x=53.906..54.000, flush with fence-367 at x=54.000!
                Assert.AreEqual(53.906f, pillarBounds.min.x, 0.004f, "pillar clears the black rubber handrail at x=53.905 without clipping");
                Assert.AreEqual(54.000f, pillarBounds.max.x, 0.004f, "pillar outer face sits flush at cell edge x=54.000 meeting fence-367");
                Assert.AreEqual(23.5f, pillarBounds.center.z, 0.01f, "pillar aligns along-run with fence-367 centerline y=23.5");
                Assert.AreEqual(-14.0f, pillarBounds.min.y, 0.005f, "pillar rests on upper landing deck");
                Assert.AreEqual(-12.985f, pillarBounds.max.y, 0.01f, "pillar rises to ~1.015 m capping fence top rail");
            } finally {
                escView4077.Dispose();
                UnityEngine.Object.DestroyImmediate(eHolder4077);
            }

            // Escalator with NO adjacent fence must NOT emit a stray pillar.
            var esc4076 = zooFacts.First(m => m.Id == "escalator-4076");
            var escView4076 = BuildVerticalView(esc4076, zooFacts, out var eHolder4076);
            try {
                Assert.IsFalse(escView4076.TryGetPart("fence-pillar", out _), "middle escalator-4076 has no adjacent fence and must not build a pillar");
            } finally {
                escView4076.Dispose();
                UnityEngine.Object.DestroyImmediate(eHolder4076);
            }

            // Every one of Zoo's 8 rail-landing-adjacent fences (4 beside escalators + 4 beside stairs)
            // stops flush at ±0.50 m with HasPillar == true and HasSeal == false, while the escalator
            // or stair builds the matching vertical steel receiver pillar.
            var expectedRailLandingFences = new[] {
                "fence-219", "fence-220", "fence-231", "fence-367",
                "fence-377", "fence-4080", "fence-4081", "fence-4292",
            };
            foreach (var id in expectedRailLandingFences) {
                var f = zooFacts.First(m => m.Id == id);
                var n = OutdoorModuleViews.Neighbours(f, conns);
                Assert.IsTrue(n.HasPillar, id + " beside a Zoo escalator/stair must flag HasPillar");
                Assert.IsFalse(n.HasSeal, id + " beside a Zoo escalator/stair must stop flush at the pillar seam");
            }

            // 3. Zoo stairs build vertical steel receiver pillars on their fenced landing edges
            //    (both straight stair-straight-4078 for fence-219 and turning stair-right180-4075 for fence-4081).
            var zooSolids = new HashSet<StationCellKey>(read.Document.Cells.Where(c => c.IsSolid).Select(c => c.Key));
            Func<int, int, int, bool> zooSolid = (x, y, z) => zooSolids.Contains(new StationCellKey(x, y, z));

            var stair4078 = zooFacts.First(m => m.Id == "stair-straight-4078");
            var stairView4078 = BuildVerticalView(stair4078, zooFacts, out var sHolder4078, zooSolid);
            try {
                Assert.IsTrue(stairView4078.TryGetPart("fence-pillar", out var pillar),
                    "stair-straight-4078 must build fence-pillar for fence-219");
                var pb = WorldBoundsOf(pillar);
                Assert.AreEqual(3.0f, pb.min.z, 0.005f, "stair-straight-4078 pillar flush at y=3.000 meeting fence-219");
                Assert.AreEqual(34.5f, pb.center.x, 0.01f, "stair-straight-4078 pillar aligns with fence-219 x=34.5");
            } finally {
                stairView4078.Dispose();
                UnityEngine.Object.DestroyImmediate(sHolder4078);
            }

            var stair4075 = zooFacts.First(m => m.Id == "stair-right180-4075");
            var stairView4075 = BuildVerticalView(stair4075, zooFacts, out var sHolder4075, zooSolid);
            try {
                Assert.IsTrue(stairView4075.TryGetPart("fence-pillar", out var pillar),
                    "stair-right180-4075 must build fence-pillar for fence-4081");
                var pb = WorldBoundsOf(pillar);
                Assert.AreEqual(52.0f, pb.max.x, 0.005f, "stair-right180-4075 pillar flush at x=52.000 meeting fence-4081");
                Assert.AreEqual(14.5f, pb.center.z, 0.01f, "stair-right180-4075 pillar aligns with fence-4081 y=14.5");
            } finally {
                stairView4075.Dispose();
                UnityEngine.Object.DestroyImmediate(sHolder4075);
            }

            // 4. Tianhe walled pit stair (`stair-centerForward-138` + `fence-480`): even though the
            //    pit wall below the concourse floor suppresses the stair's inclined flight handrail,
            //    the stair MUST still build its vertical steel receiver pillar at the upper landing
            //    edge so fence-480 never ends with floating clamps in midair.
            var tianheRead = StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/tianhe.metro.json");
            Assert.IsNotNull(tianheRead, "Tianhe fixture missing");
            var tianheFacts = tianheRead.Document.Modules.Select(m => m.Facts).ToArray();
            var tianheConns = StationFenceConnections.For(tianheFacts);
            var tianheSolids = new HashSet<StationCellKey>(tianheRead.Document.Cells.Where(c => c.IsSolid).Select(c => c.Key));
            Func<int, int, int, bool> tianheSolid = (x, y, z) => tianheSolids.Contains(new StationCellKey(x, y, z));

            var fence480 = tianheFacts.First(m => m.Id == "fence-480");
            var n480 = OutdoorModuleViews.Neighbours(fence480, tianheConns);
            Assert.IsTrue(n480.South && n480.PillarSouth, "fence-480 meets stair-centerForward-138's integral pillar");
            Assert.AreEqual(0f, n480.SealSouth, 1e-4f, "fence-480 stops strictly at y=-99.000");

            var stair138 = tianheFacts.First(m => m.Id == "stair-centerForward-138");
            var stairView138 = BuildVerticalView(stair138, tianheFacts, out var sHolder138, tianheSolid);
            try {
                Assert.IsTrue(stairView138.TryGetPart("fence-pillar", out var pillar),
                    "walled pit stair-centerForward-138 must still build fence-pillar for fence-480");
                var pb = WorldBoundsOf(pillar);
                Assert.AreEqual(-99.094f, pb.min.z, 0.005f, "pillar clears 3-block stair treads at y=-99.105");
                Assert.AreEqual(-99.000f, pb.max.z, 0.005f, "pillar meets fence-480 flush at y=-99.000");
                Assert.AreEqual(89.5f, pb.center.x, 0.01f, "pillar aligns with fence-480 centerline x=89.5");
                Assert.AreEqual(-4.0f, pb.min.y, 0.005f, "pillar sits on concourse floor z=-4.0");
                Assert.AreEqual(-2.985f, pb.max.y, 0.01f, "pillar rises to ~1.015 m capping fence top rail");
            } finally {
                stairView138.Dispose();
                UnityEngine.Object.DestroyImmediate(sHolder138);
            }
        }

        [Test]
        public void FenceSealsAgainstWideEscalatorWalkwayStairAndGatesAcrossAllVariants() {
            // 1. Wide 2-lane escalator climbing +Y at x=4..5, y=2..11: fences on west (x=3) and east (x=6)
            //    stop flush at the cell edges (x=4.0 / x=6.0) with HasPillar == true, while the escalator
            //    builds matching vertical steel receiver pillars on both lateral sides and NONE at the comb mouth.
            var wideEsc = Run("escalator", "esc-wide", 4, 2, 0, 4, 11, 5, width: 2);
            var westFence = Fence("f-west", 3, 2, 0, 0, "glass");
            var eastFence = Fence("f-east", 6, 2, 0, 0, "iron");
            var mouthFence = Fence("f-mouth", 4, 1, 0, 0, "glass");
            var escFacts = new[] { wideEsc, westFence, eastFence, mouthFence };
            var escConns = StationFenceConnections.For(escFacts);

            var nWest = OutdoorModuleViews.Neighbours(westFence, escConns);
            Assert.IsTrue(nWest.East && nWest.PillarEast && nWest.SealEast == 0f, "west fence meets wide escalator west pillar at x=4.0");
            var nEast = OutdoorModuleViews.Neighbours(eastFence, escConns);
            Assert.IsTrue(nEast.West && nEast.PillarWest && nEast.SealWest == 0f, "east fence meets wide escalator east pillar at x=6.0");
            var nMouth = OutdoorModuleViews.Neighbours(mouthFence, escConns);
            Assert.IsTrue(nMouth.North, "mouth fence still detects landing adjacency");
            Assert.IsFalse(nMouth.PillarNorth, "open escalator comb mouth must NOT get a pillar");
            Assert.AreEqual(0f, nMouth.SealNorth, 1e-4f, "open escalator comb mouth must NOT have a seal protrusion");

            var eastView = BuildFenceView(eastFence, escFacts, out var eastHolder);
            try {
                Assert.AreEqual(1, eastView.ComposedArms);
                Assert.AreEqual(6.0f, eastView.Bounds.min.x, 0.005f, "east iron fence stops flush at x=6.0");
            } finally {
                UnityEngine.Object.DestroyImmediate(eastHolder);
            }

            var wideView = BuildVerticalView(wideEsc, escFacts, out var wideHolder);
            try {
                Assert.IsTrue(wideView.TryGetPart("fence-pillar", out var pillar), "wide escalator builds fence pillars on both fenced sides");
                var pb = WorldBoundsOf(pillar);
                Assert.AreEqual(4.0f, pb.min.x, 0.005f, "west pillar flush at x=4.0 meeting westFence");
                Assert.AreEqual(6.0f, pb.max.x, 0.005f, "east pillar flush at x=6.0 meeting eastFence");
                Assert.AreEqual(2.5f, pb.center.z, 0.01f, "pillars align at lower landing y=2.5 (none at comb mouth y=1.5)");
            } finally {
                wideView.Dispose();
                UnityEngine.Object.DestroyImmediate(wideHolder);
            }

            // 2. Walkway climbing +X at x=2..12, y=5 with 2 m tall steel-blue fence at (2, 6, 0):
            //    fence stops flush at y=6.0 and walkway builds a matching 2.015 m tall steel pillar!
            var walkway = Run("walkway", "walk-1", 2, 5, 0, 12, 5, 0, width: 1);
            var northWalkFence = Fence("f-walk", 2, 6, 0, 0, "steel-blue");
            var walkFacts = new[] { walkway, northWalkFence };
            var nWalk = OutdoorModuleViews.Neighbours(northWalkFence, StationFenceConnections.For(walkFacts));
            Assert.IsTrue(nWalk.South && nWalk.PillarSouth && nWalk.SealSouth == 0f, "steel-blue fence meets walkway pillar at y=6.0");
            var walkFenceView = BuildFenceView(northWalkFence, walkFacts, out var walkFenceHolder);
            try {
                Assert.AreEqual(1, walkFenceView.ComposedArms, "steel-blue connected fence composes its arm");
                Assert.AreEqual(6.0f, walkFenceView.Bounds.min.z, 0.005f, "steel-blue fence stops flush at y=6.0");
            } finally {
                UnityEngine.Object.DestroyImmediate(walkFenceHolder);
            }
            var walkView = BuildVerticalView(walkway, walkFacts, out var walkHolder);
            try {
                Assert.IsTrue(walkView.TryGetPart("fence-pillar", out var walkPillar), "walkway builds fence pillar");
                var wpb = WorldBoundsOf(walkPillar);
                Assert.AreEqual(5.910f, wpb.min.z, 0.005f, "walkway pillar clears straight handrail outer face at y=5.910");
                Assert.AreEqual(6.000f, wpb.max.z, 0.005f, "walkway pillar outer face flush at y=6.000");
                Assert.AreEqual(2.015f, wpb.size.y, 0.01f, "walkway pillar matches 2 m tall steel-blue fence");
            } finally {
                walkView.Dispose();
                UnityEngine.Object.DestroyImmediate(walkHolder);
            }

            // 3. Straight stair (catalogue 2-block stair `width = 2 * EscalatorBand = 1.36` -> 1.79 m tread width
            //    spanning x=4..5, y=2..10): fence stops flush at x=4.0 with PillarEast == true, while the stair
            //    builds its vertical steel receiver pillar flush at x=4.0.
            var stair = Run("stair", "stair-1", 4, 2, 0, 4, 10, 5, width: 2 * StationRunGeometry.EscalatorBand, style: "straight");
            var stairFence = Fence("f-stair", 3, 2, 0, 0, "glass");
            var stairFacts = new[] { stair, stairFence };
            var nStair = OutdoorModuleViews.Neighbours(stairFence, StationFenceConnections.For(stairFacts));
            Assert.IsTrue(nStair.East && nStair.PillarEast, "fence connects to straight stair landing pillar");
            Assert.AreEqual(0f, nStair.SealEast, 1e-4f, "fence beside stair stops flush at cell edge x=4.0");
            var stairView = BuildVerticalView(stair, stairFacts, out var stairHolder);
            try {
                Assert.IsTrue(stairView.TryGetPart("fence-pillar", out var sp), "straight stair builds fence-pillar");
                var spb = WorldBoundsOf(sp);
                Assert.AreEqual(4.0f, spb.min.x, 0.005f, "straight stair pillar meets fence flush at x=4.000");
                Assert.AreEqual(2.5f, spb.center.z, 0.01f, "straight stair pillar aligns with fence centerline y=2.5");
            } finally {
                stairView.Dispose();
                UnityEngine.Object.DestroyImmediate(stairHolder);
            }

            // 4. Lane gate at (5, 5, 0) rot=0 (machine on -x face): west fence seals +0.012 m, east does not connect.
            //    Doorless gate (door="fence") at (8, 5, 0) rot=0: north fence seals south by 0.50 m into interior barrier.
            var laneGate = Gate("gate-lane", 5, 5, 0, 0, "lane");
            var gateWest = Fence("f-gw", 4, 5, 0, 0, "glass");
            var gateEast = Fence("f-ge", 6, 5, 0, 0, "glass");
            var laneConns = StationFenceConnections.For(new[] { laneGate, gateWest, gateEast });
            var nGw = OutdoorModuleViews.Neighbours(gateWest, laneConns);
            var nGe = OutdoorModuleViews.Neighbours(gateEast, laneConns);
            Assert.IsTrue(nGw.East && nGw.SealEast > 0.01f, "fence seals flush into gate machine cabinet");
            Assert.IsFalse(nGe.West, "fence must not connect into open lane gate doorway");

            var doorlessGate = Gate("gate-fence", 8, 5, 0, 0, "fence");
            var gateNorth = Fence("f-gn", 8, 6, 0, 0, "glass");
            var nGn = OutdoorModuleViews.Neighbours(gateNorth, StationFenceConnections.For(new[] { doorlessGate, gateNorth }));
            Assert.IsTrue(nGn.South, "fence connects to doorless gate from +-y side");
            Assert.AreEqual(0.50f, nGn.SealSouth, 1e-4f,
                "fence on +-y side of doorless gate seals 0.50 m to reach the interior barrier plane");

            // 5. Straight 3-cell run across all 4 fence variants: middle cell has ComposedArms == 1
            //    and fewer triangles than isolated prefab (zero doubled end posts).
            foreach (var variant in new[] { "glass", "iron", "gate", "steel-blue" }) {
                var a = Fence("r0-" + variant, 0, 0, 0, 0, variant);
                var b = Fence("r1-" + variant, 1, 0, 0, 0, variant);
                var c = Fence("r2-" + variant, 2, 0, 0, 0, variant);
                var run = new[] { a, b, c };
                var iso = BuildFenceView(b, new[] { b }, out var isoHolder);
                var mid = BuildFenceView(b, run, out var midHolder);
                try {
                    Assert.AreEqual(0, iso.ComposedArms, variant + " isolated stays uncomposed");
                    Assert.AreEqual(1, mid.ComposedArms, variant + " straight middle cell composes");
                    if (variant != "gate") {
                        Assert.Less(mid.TriangleCount, iso.TriangleCount,
                            variant + " straight middle cell must drop doubled end posts");
                    }
                    float expectedSpan = variant == "gate" ? 1.03f : 1.0f;
                    Assert.AreEqual(expectedSpan, mid.Bounds.size.x, 0.02f, variant + " middle span matches composed geometry");
                } finally {
                    UnityEngine.Object.DestroyImmediate(isoHolder);
                    UnityEngine.Object.DestroyImmediate(midHolder);
                }
            }
        }

        [Test]
        public void LocalEditDeltaRefreshesEscalatorPillarsAndAdjacentFencesInBothDirections() {
            // A. Place a wide 2-lane escalator first at (4, 2, -5) -> (4, 11, 0) (occupying x=4..5):
            //    with no adjacent fence it has NO fence-pillar.
            var escDraft = new StationEditDraft {
                Id = "esc-delta-wide", Type = "escalator", X = 4, Y = 2, Z = -5, Rotation = 0,
                From = new StationPoint(4, 2, -5), To = new StationPoint(4, 11, 0),
            };
            escDraft.Set("incline", "30");
            escDraft.Set("dir", "up");
            escDraft.Set(2, "width");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, escDraft, null, "add wide esc", null,
                out _, out var code), code);
            Assert.IsTrue(host.Coordinator.World.TryGetModule("esc-delta-wide", out var escRecBefore));
            Assert.IsNull(escRecBefore.View.transform.Find("fence-pillar"),
                "unfenced wide escalator must not draw a fence-pillar");

            // B. Add a glass fence beside its east landing at (6, 2, -5):
            //    local delta must rebuild the escalator WITH fence-pillar flush at x=6.000, while
            //    the fence stops cleanly at x=6.000 (not clipping into the escalator handrail).
            var fenceDraft = new StationEditDraft { Id = "fence-delta-1", Type = "fence", X = 6, Y = 2, Z = -5, Rotation = 0 };
            fenceDraft.Set("variant", "glass");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, fenceDraft, null, "add fence", null,
                out _, out code), code);
            Assert.IsTrue(TryWorldModuleBounds("fence-delta-1", out var fenceBounds));
            Assert.AreEqual(6.0f, fenceBounds.min.x, 0.005f, "fence beside wide escalator stops flush at x=6.000");

            Assert.IsTrue(host.Coordinator.World.TryGetModule("esc-delta-wide", out var escRecWithFence));
            var pillar = escRecWithFence.View.transform.Find("fence-pillar");
            Assert.IsNotNull(pillar, "local delta for adding fence must immediately spawn fence-pillar on adjacent escalator");
            var pb = WorldBoundsOf(pillar);
            Assert.AreEqual(5.906f, pb.min.x, 0.005f, "pillar clears handrail outer face at x=5.905");
            Assert.AreEqual(6.000f, pb.max.x, 0.005f, "pillar meets fence flush at x=6.000");

            // C. Undo removing the fence immediately removes the escalator's fence-pillar via local delta.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(host.Coordinator.World.TryGetModule("esc-delta-wide", out var escRecUndone));
            Assert.IsNull(escRecUndone.View.transform.Find("fence-pillar"),
                "undoing adjacent fence must remove escalator fence-pillar immediately");

            // D. Same live local-delta check for a straight stair at (9, 2, -5) -> (9, 10, 0) + fence at (8, 2, -5).
            var stairDraft = new StationEditDraft {
                Id = "stair-delta-1", Type = "stair", X = 9, Y = 2, Z = -5, Rotation = 0,
                From = new StationPoint(9, 2, -5), To = new StationPoint(9, 10, 0),
            };
            stairDraft.Set("style", "straight");
            stairDraft.Set("width", "0.68");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, stairDraft, null, "add stair", null,
                out _, out code), code);
            Assert.IsTrue(host.Coordinator.World.TryGetModule("stair-delta-1", out var stairRecBefore));
            Assert.IsNull(stairRecBefore.View.transform.Find("fence-pillar"),
                "unfenced stair must not draw a fence-pillar");

            var stairFenceDraft = new StationEditDraft { Id = "fence-delta-stair", Type = "fence", X = 8, Y = 2, Z = -5, Rotation = 0 };
            stairFenceDraft.Set("variant", "glass");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, stairFenceDraft, null, "add stair fence", null,
                out _, out code), code);
            Assert.IsTrue(host.Coordinator.World.TryGetModule("stair-delta-1", out var stairRecWithFence));
            var stairPillar = stairRecWithFence.View.transform.Find("fence-pillar");
            Assert.IsNotNull(stairPillar, "local delta for adding fence beside stair must spawn fence-pillar immediately");
            Assert.AreEqual(9.0f, WorldBoundsOf(stairPillar).min.x, 0.005f, "stair pillar meets fence flush at x=9.000");

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(host.Coordinator.World.TryGetModule("stair-delta-1", out var stairRecUndone));
            Assert.IsNull(stairRecUndone.View.transform.Find("fence-pillar"),
                "undoing fence beside stair removes fence-pillar immediately");
        }

        // ----------------------------------------------------- 2. Drag preview visuals

        [Test]
        public void DragPreviewDrawsOnlyModelAndFenceGhostsWithoutFullBlueCubes() {
            var editHost = StationEditHost.Ensure();

            // A. Glass fence drag from (3, 4, -5) to (6, 4, -5):
            //    - (2, 4, -5) has committed `fence-existing` (must recompose live!)
            //    - (5, 4, -5) has committed `bin-blocker` (only this cell gets a red refused box + outline!)
            //    - (3, 4), (4, 4), (6, 4) get translucent fence ghosts and ZERO full blue cubes!
            ArmModule("fence", new JObject { ["rotation"] = 0, ["lineSpacing"] = 0 });
            int revBefore = host.CurrentRevision;
            Assert.IsTrue(Handle("pointer.down", PointerAtFloor(3, 4, -5, button: 0, buttons: 1, timeMs: 1000)));
            Assert.IsTrue(Handle("pointer.move", PointerAtFloor(6, 4, -5, button: -1, buttons: 1, timeMs: 1300)));

            var preview = editHost.Preview;
            Assert.IsNotNull(preview);
            AssertZeroBluePreviewBoxes(preview, "fence drag must NEVER draw full 1x1x1 blue cell cubes");

            var names = ChildNames(preview.transform);
            Assert.IsTrue(names.Any(n => n.StartsWith("ghost ", StringComparison.Ordinal) && n.Contains("fence")),
                "fence drag must draw translucent composed fence ghosts: " + string.Join(", ", names));
            Assert.IsTrue(names.Contains("preview adj fence fence-existing"),
                "adjacent committed fence must be live-recomposed during drag preview");
            Assert.AreEqual(1, CountBoxesWithRedTint(preview),
                "only the single blocked cell at (5, 4) may draw a red refusal box");
            Assert.AreEqual(revBefore, host.CurrentRevision, "preview never mutates revision");

            // Cancelling the drag cleanly restores the hidden original committed fence.
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));
            Assert.IsTrue(host.Coordinator.World.TryGetModule("fence-existing", out var existingRecord));
            Assert.IsTrue(existingRecord.View.activeSelf, "cancel restores original adjacent fence view");

            // B. Doorless fare gate drag (`gate` + `gateDoor="fence"`):
            //    - ZERO blue preview cubes
            //    - Ghost gates hide wing/leaf parts and include `ghost doorless gate panel`!
            ArmModule("gate", new JObject { ["rotation"] = 0, ["gateDoor"] = "fence", ["lineSpacing"] = 0 });
            Assert.IsTrue(Handle("pointer.down", PointerAtFloor(2, 7, -5, button: 0, buttons: 1, timeMs: 2000)));
            Assert.IsTrue(Handle("pointer.move", PointerAtFloor(5, 7, -5, button: -1, buttons: 1, timeMs: 2300)));

            AssertZeroBluePreviewBoxes(preview, "gate drag must NEVER draw full 1x1x1 blue cell cubes");
            var gateGhosts = preview.GetComponentsInChildren<Transform>(true)
                .Where(t => t.name.StartsWith("ghost ", StringComparison.Ordinal) && t.name.EndsWith(" gate", StringComparison.Ordinal))
                .ToArray();
            Assert.AreEqual(4, gateGhosts.Length, "4 gate model ghosts for a 4-cell drag");
            foreach (var g in gateGhosts) {
                Assert.IsTrue(g.GetComponentsInChildren<Transform>(true).Any(t => t.name == "ghost doorless gate panel"),
                    "doorless gate ghost must draw its fence barrier panel instead of gate wings");
                foreach (var child in g.GetComponentsInChildren<Transform>(true)) {
                    if (child.name == "wing" || child.name == "left-leaf" || child.name == "right-leaf") {
                        Assert.IsFalse(child.gameObject.activeSelf, "doorless gate ghost must hide " + child.name);
                    }
                }
            }
            Assert.IsTrue(Handle("pointer.cancel", new JObject()));

            // C. Bench, light, tactile, and floor-mark drags also produce ZERO full blue cell cubes.
            foreach (var palette in new[] { "bench-steel-1", "light-circular", "tactile-guide", "floor-mark-boarding" }) {
                ArmModule(palette, new JObject { ["rotation"] = 0, ["lineSpacing"] = 0 });
                Assert.IsTrue(Handle("pointer.down", PointerAtFloor(2, 2, -5, button: 0, buttons: 1, timeMs: 3000)));
                Assert.IsTrue(Handle("pointer.move", PointerAtFloor(4, 2, -5, button: -1, buttons: 1, timeMs: 3300)));
                AssertZeroBluePreviewBoxes(preview, palette + " drag must NEVER draw full 1x1x1 blue cell cubes");
                Assert.IsTrue(Handle("pointer.cancel", new JObject()));
            }
        }

        // -------------------------------- 3. Full drag placement across all palettes

        [Test]
        public void SupportsDragPlacementAndRightClaimCoverAllExpectedPalettes() {
            var draggable = new[] {
                "gate", "gate-new", "bench-steel-1", "bench-steel-2", "tvm", "vending", "bin",
                "pillar-slim", "pillar-thick", "psd-end", "curtain-wall", "door-steel-1",
                "billboard-wide", "sign-wall", "sign-ceiling", "light-circular", "light-rectangular",
                "tv", "tv-double", "clock", "clock-digital", "cctv", "cctv-post", "shelf-dark-tall",
                "checkout", "tree", "busstop-short", "desk", "guidepost", "urinal", "sink", "vent",
                "cubicle", "court-pickleball", "court-divider", "ac-unit", "electrical-cabinet",
                "rail-signal", "hanger-roof", "linemap-wall", "linemap-stand", "monitor-wall",
                "monitor-ceiling", "extinguisher", "calligraphy-kai-h", "glass-1x1",
                "fence", "fence-iron", "fence-gate", "fence-steel-blue",
                "noise-barrier", "noise-barrier-half", "noise-barrier-railing",
                "tactile-guide", "tactile-warning", "tactile-warning-strip",
                "floor-mark-boarding", "floor-mark-waiting", "floor-mark-direction",
            };
            foreach (var id in draggable) {
                Assert.IsTrue(StationModuleRuns.SupportsDragPlacement(id), id + " must support drag placement");
                ArmModule(id);
                Assert.AreEqual("erase", StationToolSelection.RightClaim, id + " must claim right button for line erase");
            }

            var excludedFromSpacing = new[] {
                "road", "bridge", "track", "lift", "sidewalk", "lawn", "psd-end-cover",
                "stair", "stair-straight", "stair-block", "escalator", "walkway",
                "exit", "exit-covered-2", "roof", "roof-truss",
            };
            foreach (var id in excludedFromSpacing) {
                Assert.IsFalse(StationModuleRuns.SupportsLineSpacing(id), id + " must remain excluded from line spacing");
                Assert.IsFalse(StationModuleRuns.SupportsDragPlacement(id), id + " must not hijack generic module runs");
            }
        }

        [Test]
        public void DragPlacementCommitsRowsWithSpacingAcrossEquipmentWallAndCeilingMounts() {
            // 1. Doorless fare gates dragged with lineSpacing = 1 (step 2): places at x = 2, 4, 6 in 1 commit.
            ArmModule("gate", new JObject { ["rotation"] = 0, ["gateDoor"] = "fence", ["lineSpacing"] = 1 });
            int rev = host.CurrentRevision;
            DragFloor(2, 6, -5, 6, 6, -5, button: 0);
            Assert.AreEqual(rev + 1, host.CurrentRevision, "dragged gate row commits in one revision");
            var gates = host.Index.Document.Modules.Where(m => m.Type == "gate").OrderBy(m => m.X).ToArray();
            CollectionAssert.AreEqual(new[] { 2, 4, 6 }, gates.Select(g => g.X).ToArray(), "lineSpacing=1 places at x=2,4,6");
            foreach (var g in gates) {
                Assert.AreEqual("fence", g.Config.Text("door"), "every dragged doorless gate keeps cfg.door='fence'");
            }
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var code), code);
            Assert.AreEqual(0, host.Index.Document.Modules.Count(m => m.Type == "gate"), "one undo removes entire dragged gate row");

            // 2. 2 m benches (`bench-steel-2`) dragged along Y with lineSpacing = 1 (step 2 + 1 = 3):
            //    auto-turns long axis onto Y and places 3 benches at y = 1, 4, 7.
            ArmModule("bench-steel-2", new JObject { ["rotation"] = 0, ["lineSpacing"] = 1 });
            DragFloor(9, 1, -5, 9, 7, -5, button: 0);
            var benches = host.Index.Document.Modules.Where(m => m.Type == "bench").OrderBy(m => m.Y).ToArray();
            CollectionAssert.AreEqual(new[] { 1, 4, 7 }, benches.Select(b => b.Y).ToArray(),
                "2m bench + spacing 1 steps by 3 cells along Y");
            foreach (var b in benches) {
                Assert.AreEqual(1, b.Rotation % 2, "bench long axis turns to follow Y drag");
            }
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);

            // 3. Slim pillars dragged with rot = 5 (preserving 0..8 in-cell spot!) and clicking an existing
            //    pillar extends it from 2 m to 4 m (fitting beneath the z=0 ceiling slab) instead of starting a row.
            ArmModule("pillar-slim", new JObject { ["rotation"] = 5, ["pillarLength"] = 2, ["lineSpacing"] = 1 });
            DragFloor(2, 8, -5, 6, 8, -5, button: 0);
            var pillars = host.Index.Document.Modules.Where(m => m.Type == "pillar").OrderBy(m => m.X).ToArray();
            CollectionAssert.AreEqual(new[] { 2, 4, 6 }, pillars.Select(p => p.X).ToArray(), "pillar row with spacing=1");
            foreach (var p in pillars) {
                Assert.AreEqual(5, p.Rotation, "slim pillar preserves its 0..8 in-cell spot during drag");
                Assert.AreEqual(2, (int)p.Config.Number("height", 0), "pillar height follows pillarLength");
            }
            // Clicking directly on existing pillar at (2, 8, -5) extends its height from 2 to 4.
            ClickFloor(2, 8, -5, button: 0);
            var extended = host.Index.Document.Modules.First(m => m.Type == "pillar" && m.X == 2 && m.Y == 8);
            Assert.AreEqual(4, (int)extended.Config.Number("height", 0), "clicking existing pillar extends it in place");
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);

            // 4. Ceiling-hung lights (`light-circular`) dragged across floor at z = -5 under ceiling at z = 0:
            //    hangs at z = -1 with lineSpacing = 2 (step 3) at x = 2, 5, 8.
            ArmModule("light-circular", new JObject { ["rotation"] = 0, ["lineSpacing"] = 2 });
            DragFloor(2, 2, -5, 8, 2, -5, button: 0);
            var lights = host.Index.Document.Modules.Where(m => m.Type == "light").OrderBy(m => m.X).ToArray();
            CollectionAssert.AreEqual(new[] { 2, 5, 8 }, lights.Select(l => l.X).ToArray(), "ceiling light row with spacing=2");
            foreach (var l in lights) {
                Assert.AreEqual(-1, l.Z, "ceiling lights hang below the z=0 slab at z=-1");
                Assert.IsTrue(l.CeilingAnchored, "ceiling lights mark CeilingAnchored");
            }
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);

            // 5. Wall-mounted billboards (`billboard-wide`, width 1, rot = 2 facing south with wall north at y=11):
            //    dragged along y = 10 with lineSpacing = 1 places at x = 2, 4, 6 against the y=11 wall,
            //    keeping rot = 2 and rolling posters for each billboard.
            ArmModule("billboard-wide", new JObject { ["rotation"] = 2, ["lineSpacing"] = 1 });
            DragFloor(2, 10, -5, 6, 10, -5, button: 0);
            var boards = host.Index.Document.Modules.Where(m => m.Type == "billboard").OrderBy(m => m.X).ToArray();
            CollectionAssert.AreEqual(new[] { 2, 4, 6 }, boards.Select(b => b.X).ToArray(), "wall billboard row along north wall");
            foreach (var b in boards) {
                Assert.AreEqual(2, b.Rotation, "wall billboard keeps its wall-facing rotation");
                Assert.IsNotEmpty(b.Config.Text("poster"), "each dragged billboard rolls a poster");
            }
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);

            // 6. PSD end panels (`psd-end` with `psdEndHeight="full"`) dragged with spacing=0 lays a 3-cell grid row.
            ArmModule("psd-end", new JObject { ["rotation"] = 0, ["psdEndHeight"] = "full", ["lineSpacing"] = 0 });
            DragFloor(11, 2, -5, 13, 2, -5, button: 0);
            var ends = host.Index.Document.Modules.Where(m => m.Type == "psd-end").OrderBy(m => m.X).ToArray();
            CollectionAssert.AreEqual(new[] { 11, 12, 13 }, ends.Select(e => e.X).ToArray(), "dragged psd-end lays grid row");
            foreach (var e in ends) {
                Assert.AreEqual("full", e.Config.Text("psd"), "dragged psd-end preserves psdEndHeight='full'");
            }
        }

        // ----------------------- 4. No blue selection highlight after place / right-click

        [Test]
        public void PlacementAndRightClickNeverLeaveBlueSelectionHighlight() {
            var editHost = StationEditHost.Ensure();

            // 1. Single-click place a doorless fare gate: must commit cleanly with ZERO selection / blue highlight.
            ArmModule("gate", new JObject { ["rotation"] = 0, ["gateDoor"] = "fence", ["lineSpacing"] = 0 });
            int rev0 = host.CurrentRevision;
            ClickFloor(7, 6, -5, button: 0);
            Assert.AreEqual(rev0 + 1, host.CurrentRevision, "single click commits gate");
            var placedGate = host.Index.Document.Modules.FirstOrDefault(m => m.Type == "gate" && m.X == 7 && m.Y == 6 && m.Z == -5);
            Assert.IsNotNull(placedGate, "gate committed at (7, 6, -5)");
            Assert.AreEqual("fence", placedGate.Config.Text("door"));
            AssertNoSelectionHighlight(editHost.Preview, "after single-click placing a gate");

            // 2. Drag-place a row of 3 more gates: still ZERO selection / blue highlight.
            DragFloor(8, 6, -5, 10, 6, -5, button: 0);
            Assert.AreEqual(4, host.Index.Document.Modules.Count(m => m.Type == "gate"), "4 gates total after drag");
            AssertNoSelectionHighlight(editHost.Preview, "after drag-placing gates");

            // 3. Quick right-click on the gate at (7, 6, -5) deletes it and leaves ZERO blue highlight.
            int revBeforeRightClick = host.CurrentRevision;
            ClickFloor(7, 6, -5, button: 2);
            Assert.AreEqual(revBeforeRightClick + 1, host.CurrentRevision, "right-click deletes placed gate");
            Assert.IsNull(host.Index.GetModule(placedGate.Id), "pointed gate removed by right-click");
            AssertNoSelectionHighlight(editHost.Preview, "after right-click deleting a gate");

            // 4. Right-drag across the remaining 3 gates (8..10, 6, -5) removes all 3 in ONE commit with ZERO blue highlight.
            int revBeforeRightDrag = host.CurrentRevision;
            DragFloor(8, 6, -5, 10, 6, -5, button: 2);
            Assert.AreEqual(revBeforeRightDrag + 1, host.CurrentRevision, "right-drag deletes row in one commit");
            Assert.AreEqual(0, host.Index.Document.Modules.Count(m => m.Type == "gate"), "all 3 remaining gates removed");
            AssertNoSelectionHighlight(editHost.Preview, "after right-drag deleting gates");

            // 5. Undo brings the 3 gates back; explicit `select` click STILL highlights as intended.
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var code), code);
            var survivingGate = host.Index.Document.Modules.First(m => m.Type == "gate" && m.X == 8 && m.Y == 6);
            Assert.IsTrue(StationToolSelection.TrySelect("select", out _, out code), code);
            Assert.IsTrue(Handle("pointer.down", PointerAtDoc(8.5, 6.5, -3.5, button: 0, buttons: 1)));
            Assert.AreEqual("module", StationEditSession.SelectionKind, "select tool explicitly selects module");
            Assert.AreEqual(survivingGate.Id, StationEditSession.SelectionKey);
            Assert.AreEqual(survivingGate.Id, editHost.Preview.SelectedId);
            Assert.IsTrue(ChildNames(editHost.Preview.transform).Contains("selection box"),
                "explicit select tool still renders selection box");
        }

        // ------------------------------------------------------------------ helpers

        void Exec(string type, JObject payload) {
            Assert.IsTrue(rig.Execute(new JObject { ["type"] = type, ["payload"] = payload }
                .ToString(Newtonsoft.Json.Formatting.None), out var code), type + ": " + code);
        }

        void ArmModule(string moduleType, JObject extra = null) {
            var settings = new JObject { ["moduleType"] = moduleType };
            if (extra != null) {
                foreach (var pair in extra) settings[pair.Key] = pair.Value.DeepClone();
            }
            var cmd = new StationCommand {
                SchemaVersion = StationCommandRouter.SchemaVersion,
                Id = "arm-" + moduleType,
                SessionId = "fence-drag-test",
                Type = "tool.set",
                Payload = new JObject { ["tool"] = "module", ["settings"] = settings },
            };
            var handler = new StationToolCommandHandler();
            Assert.IsTrue(handler.TryHandle(cmd, cmd.Payload, out var code, out var reason), code + ": " + reason);
        }

        bool Handle(string type, JObject payload) =>
            StationPointerRouter.Handle(host, type, payload, new JObject(), out _, out _);

        JObject PointerAtFloor(int x, int y, int z, int button, int buttons, double timeMs = -1) =>
            PointerAtDoc(x + 0.5, y + 0.5, z + 1.0, button, buttons, timeMs);

        JObject PointerAtDoc(double docX, double docY, double docZ, int button, int buttons, double timeMs = -1) {
            var world = StationCoordinates.Point(new Vector3((float)docX, (float)docY, (float)docZ));
            var screen = camera.WorldToScreenPoint(world);
            float w = Mathf.Max(1f, Screen.width);
            float h = Mathf.Max(1f, Screen.height);
            var obj = new JObject {
                ["x"] = screen.x,
                ["y"] = h - screen.y,
                ["w"] = w,
                ["h"] = h,
                ["pointerId"] = 7,
                ["button"] = button,
                ["buttons"] = buttons,
                ["modifiers"] = 0,
                ["toolGeneration"] = StationToolSelection.Generation,
                ["documentRevision"] = host.CurrentRevision,
            };
            if (timeMs >= 0) obj["time"] = timeMs;
            return obj;
        }

        void ClickFloor(int x, int y, int z, int button) {
            int downMask = button == 2 ? 2 : 1;
            Assert.IsTrue(Handle("pointer.down", PointerAtFloor(x, y, z, button, downMask, timeMs: 100)));
            Assert.IsTrue(Handle("pointer.up", PointerAtFloor(x, y, z, button, 0, timeMs: 120)));
        }

        void DragFloor(int x0, int y0, int z0, int x1, int y1, int z1, int button) {
            int downMask = button == 2 ? 2 : 1;
            Assert.IsTrue(Handle("pointer.down", PointerAtFloor(x0, y0, z0, button, downMask, timeMs: 1000)));
            Assert.IsTrue(Handle("pointer.move", PointerAtFloor(x1, y1, z1, -1, downMask, timeMs: 1300)));
            Assert.IsTrue(Handle("pointer.up", PointerAtFloor(x1, y1, z1, button, 0, timeMs: 1350)));
        }

        static string[] ChildNames(Transform root) {
            var list = new List<string>();
            for (int i = 0; i < root.childCount; i++) {
                var child = root.GetChild(i);
                if (child != null && child.gameObject.activeSelf) list.Add(child.name);
            }
            return list.ToArray();
        }

        static void AssertZeroBluePreviewBoxes(StationPlacementPreview preview, string message) {
            for (int i = 0; i < preview.transform.childCount; i++) {
                var child = preview.transform.GetChild(i);
                if (child == null || !child.gameObject.activeSelf || child.name != "preview box") continue;
                var renderer = child.GetComponent<MeshRenderer>();
                var mat = renderer != null ? renderer.sharedMaterial : null;
                var col = mat != null && mat.HasProperty("_BaseColor") ? mat.GetColor("_BaseColor")
                    : mat != null && mat.HasProperty("_Color") ? mat.GetColor("_Color")
                    : Color.clear;
                bool isRedRefusal = col.r > 0.7f && col.b < 0.4f;
                Assert.IsTrue(isRedRefusal, message + " (found non-red preview box with color=" + col + ", scale=" + child.localScale + ")");
            }
        }

        static int CountBoxesWithRedTint(StationPlacementPreview preview) {
            int count = 0;
            for (int i = 0; i < preview.transform.childCount; i++) {
                var child = preview.transform.GetChild(i);
                if (child == null || !child.gameObject.activeSelf || child.name != "preview box") continue;
                var renderer = child.GetComponent<MeshRenderer>();
                var mat = renderer != null ? renderer.sharedMaterial : null;
                var col = mat != null && mat.HasProperty("_BaseColor") ? mat.GetColor("_BaseColor")
                    : mat != null && mat.HasProperty("_Color") ? mat.GetColor("_Color")
                    : Color.clear;
                if (col.r > 0.7f && col.b < 0.4f) count++;
            }
            return count;
        }

        static void AssertNoSelectionHighlight(StationPlacementPreview preview, string context) {
            Assert.AreEqual("", StationEditSession.SelectionKind, "SelectionKind must be empty " + context);
            Assert.AreEqual("", StationEditSession.SelectionKey, "SelectionKey must be empty " + context);
            if (preview == null) return;
            Assert.AreEqual("", preview.SelectedId, "Preview.SelectedId must be empty " + context);
            var activeNames = ChildNames(preview.transform);
            Assert.IsFalse(activeNames.Contains("selection box"),
                "no selection box wireframe may remain " + context + " (found: " + string.Join(", ", activeNames) + ")");
            Assert.IsFalse(activeNames.Any(n => n.StartsWith("surface highlight ", StringComparison.Ordinal)),
                "no blue surface highlight may remain " + context + " (found: " + string.Join(", ", activeNames) + ")");
        }

        bool TryWorldModuleBounds(string moduleId, out Bounds bounds) {
            bounds = default;
            if (!host.Coordinator.World.TryGetModule(moduleId, out var record) || record?.View == null) return false;
            return TryWorldBoundsOf(record.View.transform, out bounds);
        }

        static Bounds WorldBoundsOf(Transform root) {
            Assert.IsTrue(TryWorldBoundsOf(root, out var bounds), "no mesh bounds on " + (root ? root.name : "<null>"));
            return bounds;
        }

        static bool TryWorldBoundsOf(Transform root, out Bounds bounds) {
            bounds = default;
            if (root == null) return false;
            bool any = false;
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true)) {
                if (filter == null || filter.sharedMesh == null) continue;
                var local = filter.sharedMesh.bounds;
                var matrix = filter.transform.localToWorldMatrix;
                for (int c = 0; c < 8; c++) {
                    var pt = matrix.MultiplyPoint3x4(new Vector3(
                        (c & 1) == 0 ? local.min.x : local.max.x,
                        (c & 2) == 0 ? local.min.y : local.max.y,
                        (c & 4) == 0 ? local.min.z : local.max.z));
                    if (!any) { bounds = new Bounds(pt, Vector3.zero); any = true; }
                    else bounds.Encapsulate(pt);
                }
            }
            return any;
        }

        VerticalModuleView BuildVerticalView(ModuleFacts mod, IReadOnlyList<ModuleFacts> all, out GameObject holder,
            Func<int, int, int, bool> solid = null) {
            holder = new GameObject("vertical-view-holder-" + mod.Id);
            GameObject prefab = null;
            string prefabKey = null;
            var visual = ModuleViews.Resolve(mod, Array.Empty<ModuleFacts>(), catalogue);
            if (visual.HasModel && catalogue.TryGet(visual.Key, out var entry) && entry != null) {
                prefab = entry.prefab;
                prefabKey = visual.Key;
            }
            var req = VerticalModuleRequest.FromFacts(mod, prefab, prefabKey, solid: solid, neighbours: all);
            Assert.IsTrue(VerticalModuleViews.TryBuild(req, holder.transform, out var built), "VerticalModuleViews.TryBuild failed: " + mod.Id);
            return built;
        }

        OutdoorModuleView BuildFenceView(ModuleFacts fence, IReadOnlyList<ModuleFacts> all, out GameObject holder) {
            var visual = ModuleViews.Resolve(fence, all, catalogue);
            Assert.IsTrue(catalogue.TryGet(visual.Key, out var entry) && entry.prefab != null, "missing prefab " + visual.Key);
            holder = new GameObject("fence-view-holder-" + fence.Id);
            holder.transform.SetPositionAndRotation(ModulePlacement.Position(fence, entry), ModulePlacement.Rotation(fence.Rotation));
            var req = new OutdoorModuleRequest {
                ModuleId = fence.Id,
                Type = fence.Type,
                ViewKey = visual.Key,
                Variant = fence.Config.Text("variant"),
                X = fence.X, Y = fence.Y, Z = fence.Z,
                Rotation = fence.Rotation,
                Width = fence.Width, Depth = fence.Depth,
                Prefab = entry.prefab,
                Catalogue = catalogue,
                Placement = OutdoorPlacement.ParentPlaced,
                Neighbours = OutdoorModuleViews.Neighbours(fence, StationFenceConnections.For(all)),
            };
            Assert.IsTrue(OutdoorModuleViews.TryBuild(req, holder.transform, null, out var built), built.Diagnostic);
            return built;
        }

        static ModuleFacts.Point At(int x, int y, int z) => new ModuleFacts.Point { X = x, Y = y, Z = z, HasValue = true };

        static ModuleConfig Config(params (string key, string value)[] values) {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in values) map[pair.key] = pair.value;
            return new ModuleConfig(map);
        }

        static ModuleFacts Fence(string id, int x, int y, int z, int rotation, string variant) =>
            new ModuleFacts {
                Id = id, Type = "fence", X = x, Y = y, Z = z, Rotation = rotation,
                Config = string.IsNullOrEmpty(variant) ? ModuleConfig.Empty : Config(("variant", variant)),
            };

        static ModuleFacts Gate(string id, int x, int y, int z, int rotation, string door) =>
            new ModuleFacts {
                Id = id, Type = "gate", X = x, Y = y, Z = z, Rotation = rotation,
                Config = Config(("door", door)),
            };

        static ModuleFacts Run(string type, string id, int fromX, int fromY, int fromZ,
            int toX, int toY, int toZ, double width = 1, string style = null) {
            var values = new List<(string, string)>();
            if (width > 0) values.Add(("width", width.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)));
            if (!string.IsNullOrEmpty(style)) values.Add(("style", style));
            return new ModuleFacts {
                Id = id, Type = type, X = fromX, Y = fromY, Z = fromZ, Rotation = 0,
                From = At(fromX, fromY, fromZ), To = At(toX, toY, toZ),
                Config = Config(values.ToArray()),
            };
        }
    }
}
