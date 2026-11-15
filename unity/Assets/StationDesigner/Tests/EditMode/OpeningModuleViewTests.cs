using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// B3 proof for the opening families: platform screen doors, their fixed ends and covers,
/// fare gates, standing/room doors, toilet cubicles and the train's own door banks.
///
/// The fixture is the shipped `ZooSave.json` read through the ordinary v1 document path,
/// so every count and every opening centre comes from that exact document. The expected
/// numbers in the PSD tests are the TypeScript arithmetic (`doorCentres`,
/// `doorRunOffsets`, `doorWidthAt`, `PSD_FULL_DOOR_WIDTH_SCALE`) evaluated for Line 5's
/// stock — L, 6 cars, model scale 0.98 — and recorded with the derivation in
/// `unity/plan/11-evidence/B3.md`.
///
/// Every motion assertion goes through one module ID at a time. There is no
/// station-wide door flag to exercise: if a fitting moved without its own module being
/// commanded, one of these tests fails.
/// </summary>
public class OpeningModuleViewTests {
    const string SavePath = "Assets/StationDesigner/Zoo/ZooSave.json";

    // Zoo opening-family counts, from the exact document.
    const int PsdEnds = 226;
    const int PsdCovers = 214;
    const int Gates = 15;
    const int Doors = 6;
    const int Cubicles = 4;
    const int Runs = 2;
    const int TotalViews = PsdEnds + Runs + Gates + Doors + Cubicles;
    const int LaneGates = 12;

    // `buildPsd` for Line 5 at Zoo: L / 6 cars / modelScale 0.98.
    const float DoorWidth = 2.058f;      // 1.4 x 0.98 x PSD_FULL_DOOR_WIDTH_SCALE 1.5
    const float Travel = 1.029f;         // doorWidth / 2
    const float LeafWidth = 1.229f;      // doorWidth / 2 + 0.20
    const float LeafY = -0.41f;          // yWall (-0.34) + toward (-1) x slideOffset (0.07)
    const float LeafMid = 2.175f;        // 1 + doorHeight / 2, doorHeight = 3 - 0.05 - 0.6
    const int RunOpenings = 18;
    const float FirstOpening = 3.352f;   // doorRunOffsets[0] - 0.5: 50.5 - 46.648 - 0.5
    const float OpeningPitch = 5.488f;   // 5.6 m car pitch x 0.98

    static StationReadResult zoo;
    static RuntimeCatalogue catalogue;
    static Shader shader;

    readonly List<GameObject> roots = new List<GameObject>();
    readonly List<StationWorldView> worlds = new List<StationWorldView>();
    readonly List<OpeningPalette> palettes = new List<OpeningPalette>();

    [OneTimeSetUp]
    public void LoadZoo() {
        zoo = StationDocumentReader.ReadFile(SavePath);
        Assert.IsNotNull(zoo.Document, "the Zoo document must load");
        catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        shader = FindShader();
        Assert.AreEqual(PsdEnds, zoo.Document.Modules.Count(module => module.Type == "psd-end"), "the Zoo psd-end count changed");
        Assert.AreEqual(Runs, zoo.Document.Modules.Count(module => module.Type == "platform-edge"), "the Zoo platform-edge count changed");
        Assert.AreEqual(Gates, zoo.Document.Modules.Count(module => module.Type == "gate"), "the Zoo gate count changed");
        Assert.AreEqual(Doors, zoo.Document.Modules.Count(module => module.Type == "door"), "the Zoo door count changed");
        Assert.AreEqual(Cubicles, zoo.Document.Modules.Count(module => module.Type == "cubicle"), "the Zoo cubicle count changed");
        Assert.AreEqual(LaneGates, zoo.Document.Modules.Count(module =>
            module.Type == "gate" && OpeningModuleViews.GateHasLane(module.Config.Text("door"))),
            "the Zoo lane-gate count changed");
    }

    [TearDown]
    public void Release() {
        foreach (var world in worlds) world.Dispose();
        worlds.Clear();
        foreach (var root in roots) if (root) UnityEngine.Object.DestroyImmediate(root);
        roots.Clear();
        foreach (var palette in palettes) palette.Release();
        palettes.Clear();
    }

    static Shader FindShader() {
        foreach (var name in new[] { "Universal Render Pipeline/Lit", "Sprites/Default", "Unlit/Texture" }) {
            var found = Shader.Find(name);
            if (found) return found;
        }
        return null;
    }

    /* --------------------------------------------------------------- harness */

    Transform Root(string name) {
        var root = new GameObject(name);
        roots.Add(root);
        return root.transform;
    }

    /// <summary>Build every opening module of the loaded Zoo document under a fresh root.</summary>
    List<OpeningView> BuildAll(Transform parent) {
        var set = new OpeningModuleSet();
        var built = new List<OpeningView>();
        var palette = new OpeningPalette(shader);
        palettes.Add(palette);
        int count = OpeningModuleViews.BuildAll(zoo.Document.Modules, zoo.Index, catalogue, parent, palette, set,
            (module, view) => built.Add(view), (module, diagnostic) => Assert.Fail(module.Id + ": " + diagnostic));
        Assert.AreEqual(TotalViews, count, "not every opening module built");
        Assert.AreEqual(TotalViews, set.Count, "the set lost a module");
        lastSet = set;
        return built;
    }

    OpeningModuleSet lastSet;

    OpeningModuleSet Set() {
        Assert.IsNotNull(lastSet, "build the station first");
        return lastSet;
    }

    OpeningView View(OpeningModuleSet set, string moduleId) {
        Assert.IsTrue(set.TryGet(moduleId, out var view), "no opening view for " + moduleId);
        Assert.IsNotNull(view.Instance, moduleId + " built no instance: " + view.Diagnostic);
        return view;
    }

    static OpeningLeaf Slide(OpeningView view, int opening, int side) {
        var leaf = view.Leaves.FirstOrDefault(candidate =>
            candidate.Opening == opening && candidate.LeafKind == OpeningLeafKind.Slide &&
            Mathf.Approximately(candidate.Sign, side == 0 ? -1f : 1f));
        Assert.IsNotNull(leaf, "no slide leaf for opening " + opening + " side " + side);
        return leaf;
    }

    static void AssertNear(string what, float expected, float actual, float tolerance = 1e-3f) =>
        Assert.AreEqual(expected, actual, tolerance, what);

    /// <summary>Document-metre (double) variant, for the `Metro.Build`/mesher evidence.</summary>
    static void AssertNear(string what, double expected, double actual, double tolerance) =>
        Assert.AreEqual(expected, actual, tolerance, what);

    static void AssertPose(string what, Vector3 expected, Vector3 actual, float tolerance = 1e-4f) {
        AssertNear(what + " x", expected.x, actual.x, tolerance);
        AssertNear(what + " y", expected.y, actual.y, tolerance);
        AssertNear(what + " z", expected.z, actual.z, tolerance);
    }

    /* ------------------------------------------------------------ the PSD run */

    [Test]
    public void EveryOpeningFamilyBuildsOneViewPerModule() {
        var built = BuildAll(Root("B3 zoo"));
        Assert.AreEqual(TotalViews, built.Count);
        Assert.AreEqual(Runs, built.Count(view => view.Kind == OpeningKind.PsdRun), "screen runs");
        Assert.AreEqual(PsdEnds - PsdCovers, built.Count(view => view.Kind == OpeningKind.PsdEnd), "screen ends");
        Assert.AreEqual(PsdCovers, built.Count(view => view.Kind == OpeningKind.PsdCover), "cover courses");
        Assert.AreEqual(Gates, built.Count(view => view.Kind == OpeningKind.Gate), "fare gates");
        Assert.AreEqual(Doors, built.Count(view => view.Kind == OpeningKind.SwingDoor), "standing doors");
        Assert.AreEqual(Cubicles, built.Count(view => view.Kind == OpeningKind.Cubicle), "cubicles");
        // Two runs + the lane gates + the doors and cubicles carry a moving part; a fence
        // machine and a fixed end are legitimately static.
        Assert.AreEqual(Runs + LaneGates + Doors + Cubicles, Set().MovableCount, "movable module count: " + Set().Describe());
        Assert.AreEqual(Runs * RunOpenings,
            Set().Views.Where(view => view.Kind == OpeningKind.PsdRun).Sum(view => view.OpeningCount),
            "opening count: " + Set().Describe());
    }

    [Test]
    public void PsdRunRebuildsTheSourceDoorCadenceFromTheRailAndTheLine() {
        BuildAll(Root("B3 cadence"));
        var run = View(Set(), "edge-track-1-left");
        Assert.AreEqual(OpeningKind.PsdRun, run.Kind);
        Assert.AreEqual("5", run.LineId, "the run must keep its saved line");
        Assert.AreEqual("track-1", run.TrackId, "the run must keep the rail it follows");
        Assert.IsNotNull(run.Run, "the run layout is missing");
        Assert.AreEqual(RunOpenings, run.Run.Openings.Count, "Zoo's 101 m Line 5 run carries 18 openings");
        Assert.AreEqual(RunOpenings, run.OpeningCount);
        AssertNear("door width", DoorWidth, run.Run.DoorWidth);
        AssertNear("travel", Travel, run.Run.Travel);
        AssertNear("leaf width", LeafWidth, run.Run.LeafWidth);
        AssertNear("leaf lane y", LeafY, run.Run.LeafY);
        AssertNear("leaf mid height", LeafMid, run.Run.LeafMid);
        AssertNear("first opening", FirstOpening, run.Run.Openings[0].Centre, 5e-3f);
        for (int i = 1; i < run.Run.Openings.Count; i++)
            AssertNear("opening " + i + " pitch", OpeningPitch,
                run.Run.Openings[i].Centre - run.Run.Openings[i - 1].Centre, 5e-3f);
        Assert.AreEqual(RunOpenings * 2, run.Leaves.Count, "two leaves per opening");
        // The leaves sit on the source's own closed centres: dx ± leafWidth / 2 along the run.
        var left = Slide(run, 0, 0);
        var right = Slide(run, 0, 1);
        AssertNear("opening 0 left leaf", FirstOpening - LeafWidth * .5f, left.Closed.x, 5e-3f);
        AssertNear("opening 0 right leaf", FirstOpening + LeafWidth * .5f, right.Closed.x, 5e-3f);
        AssertNear("left leaf lane", LeafY, left.Closed.z);
        AssertNear("left leaf height", LeafMid, left.Closed.y);
        AssertNear("left leaf travel", Travel, left.Travel);
        AssertNear("last opening", FirstOpening + 17 * OpeningPitch, run.Run.Openings[17].Centre, 5e-3f);
    }

    [Test]
    public void TheRunsDrawFixedGlassJambsAndPillarsBetweenTheirOpenings() {
        BuildAll(Root("B3 fixed"));
        var run = View(Set(), "edge-track-1-left");
        // `buildPsd`: one fixed pane between every pair of openings, plus one at each end.
        Assert.AreEqual(RunOpenings + 1, run.Run.Panels.Count, "fixed pane count");
        Assert.AreEqual(RunOpenings * 2 + 2, run.Run.Posts.Count, "a jamb at each opening edge and one at each end");
        // One section pillar between sections plus one at each end.
        Assert.AreEqual(RunOpenings + 1, run.Run.Pillars.Count, "section pillar count");
        for (int i = 1; i < run.Run.Panels.Count - 1; i++)
            AssertNear("pane between openings", OpeningPitch - DoorWidth,
                run.Run.Panels[i].y - run.Run.Panels[i].x, 5e-3f);
        // A hub: every opening centre is inside the run and no pane crosses one.
        foreach (var opening in run.Run.Openings) {
            Assert.Greater(opening.Centre - opening.Width * .5f, -.4f, "an opening starts before the run");
            Assert.Less(opening.Centre + opening.Width * .5f, run.Run.End + .4f, "an opening runs past the end");
        }
    }

    [Test]
    public void CommandingOneRunLeavesTheOtherBankAndEveryOtherOpeningStill() {
        BuildAll(Root("B3 isolation"));
        var set = Set();
        var north = View(set, "edge-track-1-left");
        var south = View(set, "edge-track-5-left");
        var southLeft = Slide(south, 0, 0);
        var southClosed = southLeft.Closed;
        var gate = View(set, "gate-240");
        var gateClosed = gate.Leaves[0].Node.localPosition;
        var door = View(set, "door-steel-1-391");
        var doorClosed = door.Leaves[0].Node.localRotation;

        Assert.IsTrue(set.Apply("edge-track-1-left", OpeningState.Uniform(1f)), "the commanded run must accept its state");

        var northLeft = Slide(north, 0, 0);
        AssertNear("the commanded run opened", northLeft.Closed.x - Travel, northLeft.Node.localPosition.x);
        // The other platform's screen is a different run on a different rail: it stays shut.
        AssertPose("the opposite bank stayed shut", southClosed, southLeft.Node.localPosition);
        Assert.AreEqual(0f, southLeft.Fraction, "the opposite bank's fraction must stay 0");
        // Unrelated families are untouched.
        Assert.AreEqual(gateClosed, gate.Leaves[0].Node.localPosition, "a fare gate moved with a screen");
        Assert.AreEqual(doorClosed, door.Leaves[0].Node.localRotation, "a door moved with a screen");
        // And the gate can be commanded without disturbing the screen.
        Assert.IsTrue(set.Apply("gate-240", OpeningState.Uniform(1f)));
        AssertNear("the screen held", northLeft.Closed.x - Travel, northLeft.Node.localPosition.x);
    }

    [Test]
    public void AnUnknownModuleIdNeverMovesAnything() {
        BuildAll(Root("B3 unknown"));
        var run = View(Set(), "edge-track-1-left");
        var closed = Slide(run, 3, 0).Node.localPosition;
        Assert.IsFalse(Set().Apply("no-such-module", OpeningState.Uniform(1f)), "an unknown module must be refused");
        AssertPose("a refused command moved geometry", closed, Slide(run, 3, 0).Node.localPosition);
    }

    [Test]
    public void OneOpeningCanBeAddressedWithoutItsSiblings() {
        BuildAll(Root("B3 per opening"));
        var set = Set();
        var run = View(set, "edge-track-1-left");
        Assert.IsTrue(set.Apply("edge-track-1-left", 4, 1f));
        var left = Slide(run, 4, 0);
        var right = Slide(run, 4, 1);
        // `setDoors` with side omitted: the left leaf slides toward −x by the travel and the
        // right leaf toward +x, so the pair parts by one door width.
        AssertNear("the addressed opening's left leaf opened", -Travel, left.Node.localPosition.x - left.Closed.x);
        AssertNear("the addressed opening's right leaf opened", Travel, right.Node.localPosition.x - right.Closed.x);
        for (int opening = 0; opening < RunOpenings; opening++) {
            if (opening == 4) continue;
            var leaf = Slide(run, opening, 0);
            AssertPose("opening " + opening + " moved unasked", leaf.Closed, leaf.Node.localPosition);
        }
    }

    [Test]
    public void AFullyOpenPairPartsByExactlyOneDoorWidth() {
        BuildAll(Root("B3 travel"));
        var set = Set();
        var run = View(set, "edge-track-1-left");
        Assert.IsTrue(set.Apply("edge-track-1-left", OpeningState.Uniform(1f)));
        for (int opening = 0; opening < RunOpenings; opening++) {
            var left = Slide(run, opening, 0);
            var right = Slide(run, opening, 1);
            float part = right.Node.localPosition.x - left.Node.localPosition.x;
            // The source parts the pair by one door width. The leaf centres start two
            // quarters apart, so the clear growth is the full door width.
            AssertNear("opening " + opening + " clear width", LeafWidth + DoorWidth, part, 1e-3f);
            AssertNear("opening " + opening + " leaf clears the jamb", Travel,
                Mathf.Abs(left.Node.localPosition.x - left.Closed.x), 1e-3f);
        }
        // Shut again: the pair meets at the seam and leaves no residual.
        Assert.IsTrue(set.Apply("edge-track-1-left", OpeningState.Shut));
        AssertPose("shut left", Slide(run, 0, 0).Closed, Slide(run, 0, 0).Node.localPosition);
        AssertPose("shut right", Slide(run, 0, 1).Closed, Slide(run, 0, 1).Node.localPosition);
    }

    /* ----------------------------------------------------------- fixed PSD ends */

    [Test]
    public void FullHeightScreenEndsAreAssembledAndCoversKeepThePrefabWhereItMatches() {
        var built = BuildAll(Root("B3 ends"));
        var ends = built.Where(view => view.Kind == OpeningKind.PsdEnd).ToList();
        var covers = built.Where(view => view.Kind == OpeningKind.PsdCover).ToList();
        Assert.AreEqual(PsdEnds - PsdCovers, ends.Count, "full-height ends");
        Assert.AreEqual(PsdCovers, covers.Count, "cover courses");
        // The promoted PsdEnd is the exporter's half-height course, so every full-height
        // end is generated at its own saved span; each says why.
        Assert.IsTrue(ends.All(view => view.ViewKey == OpeningModuleViews.PsdEndGeneratedKey),
            "a full-height end claimed the half-height prefab");
        Assert.IsTrue(ends.All(view => !view.Movable), "a fixed screen end must not move");
        // 204 covers are the prefab's own 1 x 0.24 box; the ten saved at 0.72 x 0.12 or
        // 1 x 0.12 are a different course and must not be a scaled prefab.
        int fromPrefab = covers.Count(view => view.ViewKey == OpeningModuleViews.PsdCoverPrefabKey);
        int generated = covers.Count(view => view.ViewKey != OpeningModuleViews.PsdCoverPrefabKey);
        Assert.AreEqual(10, generated, "the ten trimmed covers must not be scaled prefabs");
        Assert.AreEqual(204, fromPrefab, "the plain covers keep the prefab");
        var corner = View(Set(), "psd-end-654");
        Assert.IsTrue(corner.Diagnostic.Contains("prefab-half-height"), corner.Diagnostic);
        // A corner end is trimmed at its tile boundary: span [-0.5, 0.34], not a full metre.
        var span = OpeningModuleViews.PsdEndSpan(0.16f);
        AssertNear("corner span start", -0.5f, span.x);
        AssertNear("corner span end", 0.34f, span.y, 1e-5f);
    }

    /* ------------------------------------------------ the fixed return (18 §3) */

    /// <summary>
    /// 18 §3 — the four saved returns (`psd-end-654`/`728` against `edge-track-1-left`,
    /// `psd-end-753`/`725` against `edge-track-5-left`) are trimmed back to their parent
    /// screen's housing, slice by slice, with the fixed glass left on the shared centreline.
    /// Before the trim the return's threshold, foundation, fascia and posts ran untrimmed
    /// into the parent block and shared opaque top faces with it (the broken dark strip at
    /// the base), and the glass floated a clearance away from the fascia.
    /// </summary>
    [Test]
    public void TheFixedReturnIsTrimmedAtItsParentHousingForBothCornerSigns() {
        BuildAll(Root("B3 return trim"));
        var joins = new[] {
            ("psd-end-654", "edge-track-1-left", 1),
            ("psd-end-728", "edge-track-1-left", -1),
            ("psd-end-753", "edge-track-5-left", 1),
            ("psd-end-725", "edge-track-5-left", -1),
        };
        var signs = new HashSet<int>();
        foreach (var (endId, cornerId, sign) in joins) {
            var end = View(Set(), endId);
            var record = zoo.Document.Modules.First(module => module.Id == endId);
            var corner = zoo.Document.Modules.First(module => module.Id == cornerId);
            var ox = (float)(record.OffsetX);
            Assert.AreEqual(sign, Math.Sign(Math.Round(ox, 3)), endId + " corner sign");
            signs.Add(sign);
            Assert.Greater(end.Housing.Count, 0, endId + " resolved no parent housing: " + end.Diagnostic);
            StringAssert.Contains("psd-end-housing:boxes=", end.Diagnostic, endId + " trim note");
            Assert.Greater(end.Boxes.Count, 8, endId + " emitted its fixed boxes");
            // Opaque boxes may touch the housing plane but never share volume with it.
            foreach (var box in end.Boxes) {
                if (box.Glass) continue;
                foreach (var house in end.Housing) {
                    float x = Math.Min(box.Max.x, house.Max.x) - Math.Max(box.Min.x, house.Min.x);
                    float y = Math.Min(box.Max.y, house.Max.y) - Math.Max(box.Min.y, house.Min.y);
                    float z = Math.Min(box.Max.z, house.Max.z) - Math.Max(box.Min.z, house.Min.z);
                    Assert.IsFalse(x > 1e-5f && y > 1e-5f && z > 1e-5f,
                        endId + " " + box.Part + " overlaps the parent housing (" +
                        x.ToString("0.####") + "," + y.ToString("0.####") + "," + z.ToString("0.####") + ")");
                }
            }
            // The fixed glazing is continuous across the return's span, on one plane.
            var glass = end.Boxes.Where(box => box.Glass).ToList();
            Assert.IsNotEmpty(glass, endId + " drew no fixed glass");
            float plane = (glass[0].Min.z + glass[0].Max.z) * .5f;
            Assert.IsTrue(glass.All(box => Math.Abs((box.Min.z + box.Max.z) * .5f - plane) < 1e-4f),
                endId + " fixed glass is not on one plane");
            float glassLo = glass.Min(box => box.Min.x), glassHi = glass.Max(box => box.Max.x);
            var span = OpeningModuleViews.PsdEndSpan(ox);
            // The glass keeps its full shifted span, reaching the screen centreline on the
            // parent side.
            Assert.AreEqual(ox > 0 ? span.x + ox : span.y + ox, ox > 0 ? glassLo : glassHi, .02f,
                endId + " glazing reaches the screen centreline");
            // The opaque return stops at the parent face it actually meets — the housing volume
            // overlapping that box in height and depth, exactly the rule the trim reads — while
            // the glass keeps reaching past it toward the screen centreline.
            float? FaceFor(OpeningBox target) {
                bool any = false;
                float face = ox > 0 ? float.MinValue : float.MaxValue;
                foreach (var house in end.Housing) {
                    if (Math.Min(target.Max.y, house.Max.y) - Math.Max(target.Min.y, house.Min.y) < 1e-6f) continue;
                    if (Math.Min(target.Max.z, house.Max.z) - Math.Max(target.Min.z, house.Min.z) < 1e-6f) continue;
                    any = true;
                    face = ox > 0 ? Math.Max(face, house.Max.x) : Math.Min(face, house.Min.x);
                }
                return any ? face : (float?)null;
            }
            foreach (var box in end.Boxes) {
                if (box.Glass) continue;
                var face = FaceFor(box);
                if (!face.HasValue) {
                    // Nothing overlaps it: it keeps its authored box inside the tile.
                    Assert.GreaterOrEqual(box.Min.x, -.5f - 1e-4f, endId + " " + box.Part + " leaves the tile");
                    Assert.LessOrEqual(box.Max.x, .5f + 1e-4f, endId + " " + box.Part + " leaves the tile");
                    continue;
                }
                if (ox > 0) {
                    Assert.GreaterOrEqual(box.Min.x, face.Value - 1e-4f,
                        endId + " " + box.Part + " crosses the parent housing face");
                } else {
                    Assert.LessOrEqual(box.Max.x, face.Value + 1e-4f,
                        endId + " " + box.Part + " crosses the parent housing face");
                }
            }
            var threshold = end.Boxes.Where(box => box.Part == "psd-threshold").ToList();
            Assert.IsNotEmpty(threshold, endId + " drew no threshold");
            var thresholdFace = FaceFor(threshold[0]);
            Assert.IsTrue(thresholdFace.HasValue, endId + " threshold meets no housing");
            if (ox > 0) Assert.Less(glassLo, thresholdFace.Value, endId + " the glass must reach past the opaque face");
            else Assert.Greater(glassHi, thresholdFace.Value, endId + " the glass must reach past the opaque face");
            // The threshold floors the return from the tile edge to the parent face: no hole.
            if (ox > 0) {
                Assert.AreEqual(thresholdFace.Value, threshold.Min(box => box.Min.x), 1e-3f,
                    endId + " the threshold stops at the parent face");
                Assert.AreEqual(.5f, threshold.Max(box => box.Max.x), .02f,
                    endId + " the threshold reaches the tile edge");
            } else {
                Assert.AreEqual(thresholdFace.Value, threshold.Max(box => box.Max.x), 1e-3f,
                    endId + " the threshold stops at the parent face");
                Assert.AreEqual(-.5f, threshold.Min(box => box.Min.x), .02f,
                    endId + " the threshold reaches the tile edge");
            }
        }
        CollectionAssert.AreEquivalent(new[] { -1, 1 }, signs,
            "both saved corner signs were exercised");
    }

    /// <summary>
    /// The labelled evidence 18 §3 asks for, as data rather than a screenshot: every triangle
    /// the four saved returns draw, attributed to its **layer** — the return's own threshold,
    /// foundation, fascia, rails and posts, the parent screen's housing, and the floor it
    /// meets — with the pose it was drawn at. Each emitted box is one 24-vertex unit cube, so
    /// it is exactly twelve triangles. Written under `.preview/unity/plan18/` (a scratch
    /// artifact, never a document commit) so a reviewer can compare the capture poses against
    /// the same numbers.
    /// </summary>
    [Test]
    public void TheFixedReturnEvidenceIsLabelledByLayer() {
        BuildAll(Root("B3 return evidence"));
        var report = new System.Text.StringBuilder();
        report.Append("{\"schemaVersion\":1,\"source\":\"zoo.metro.json\",\"poses\":[");
        bool first = true;
        foreach (var (endId, cornerId) in new[] {
            ("psd-end-654", "edge-track-1-left"),
            ("psd-end-728", "edge-track-1-left"),
            ("psd-end-753", "edge-track-5-left"),
            ("psd-end-725", "edge-track-5-left"),
        }) {
            var end = View(Set(), endId);
            var record = zoo.Document.Modules.First(module => module.Id == endId);
            var corner = zoo.Document.Modules.First(module => module.Id == cornerId);
            if (!first) report.Append(',');
            first = false;
            report.Append('{')
                .Append("\"moduleId\":\"").Append(endId).Append("\",")
                .Append("\"corner\":\"").Append(cornerId).Append("\",")
                .Append("\"rotation\":").Append(record.Rotation).Append(',')
                .Append("\"offset\":[").Append(record.OffsetX.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture))
                .Append(',').Append(record.OffsetY.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture)).Append("],")
                .Append("\"layers\":[");
            bool firstBox = true;
            foreach (var box in end.Boxes) {
                if (!firstBox) report.Append(',');
                firstBox = false;
                string layer = box.Glass ? "return-glass" : "return-" + box.Part;
                report.Append("{\"layer\":\"").Append(layer).Append("\",")
                    .Append("\"triangles\":12,")
                    .Append("\"min\":[").Append(Number(box.Min.x)).Append(',').Append(Number(box.Min.y))
                    .Append(',').Append(Number(box.Min.z)).Append("],")
                    .Append("\"max\":[").Append(Number(box.Max.x)).Append(',').Append(Number(box.Max.y))
                    .Append(',').Append(Number(box.Max.z)).Append("]}");
            }
            foreach (var house in end.Housing) {
                if (!firstBox) report.Append(',');
                firstBox = false;
                report.Append("{\"layer\":\"parent-housing\",\"triangles\":12,")
                    .Append("\"min\":[").Append(Number(house.Min.x)).Append(',').Append(Number(house.Min.y))
                    .Append(',').Append(Number(house.Min.z)).Append("],")
                    .Append("\"max\":[").Append(Number(house.Max.x)).Append(',').Append(Number(house.Max.y))
                    .Append(',').Append(Number(house.Max.z)).Append("]}");
            }
            // The floor the return meets, from the composed floor cell at the return's own
            // storey: named so the base strip's owner is unambiguous.
            if (!firstBox) report.Append(',');
            report.Append("{\"layer\":\"floor\",\"triangles\":12,\"min\":[").Append(Number(record.X))
                .Append(',').Append(Number(record.Y)).Append(',').Append(Number(record.Z))
                .Append("],\"max\":[").Append(Number(record.X + 1)).Append(',').Append(Number(record.Y + 1))
                .Append(',').Append(Number(record.Z + 1)).Append("]}");
            report.Append("]}");
            Assert.Greater(end.Boxes.Count(box => !box.Glass), 0, endId + " has opaque boxes");
            Assert.Greater(end.Housing.Count, 0, endId + " has a parent housing");
        }
        report.Append("]}");
        var directory = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "../../.preview/unity/plan18"));
        System.IO.Directory.CreateDirectory(directory);
        var path = System.IO.Path.Combine(directory, "psd-return-boxes.json");
        System.IO.File.WriteAllText(path, report.ToString() + "\n");
        Assert.IsTrue(System.IO.File.Exists(path), "the labelled evidence is written: " + path);
    }

    static string Number(float value) => value.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// A continuation with no parent keeps its authored box exactly (nothing shares its
    /// faces) and says why it was not trimmed.
    /// </summary>
    [Test]
    public void AContinuationWithNoParentKeepsItsAuthoredBoxes() {
        BuildAll(Root("B3 continuation"));
        var end = View(Set(), "psd-end-655");
        Assert.AreEqual(0, end.Housing.Count, "a continuation resolves no parent housing");
        StringAssert.Contains("psd-end-housing-missing:no-corner", end.Diagnostic);
        var record = zoo.Document.Modules.First(module => module.Id == "psd-end-655");
        var span = OpeningModuleViews.PsdEndSpan(0f);
        var threshold = end.Boxes.Where(box => box.Part == "psd-threshold").ToList();
        Assert.AreEqual(1, threshold.Count, "an untrimmed threshold is one box, not a slice");
        var box = threshold[0];
        Assert.AreEqual(span.y - span.x, box.Max.x - box.Min.x, 1e-3f, "the authored threshold length is kept");
        Assert.AreEqual(.02f, box.Max.y - box.Min.y, 1e-3f, "the authored threshold thickness is kept");
        // A continuation may still carry a saved offset; `psdEndOffset` ignores it without a
        // corner, so the geometry is the unshifted span.
        Assert.AreEqual(span.y, box.Max.x, 1e-3f, "no corner means no length offset in the geometry");
    }

    /// <summary>
    /// The trim follows the machine's quarter turn: the housing is carried into the return's
    /// own frame, so every rotation resolves and trims (and never leaves an overlap).
    /// </summary>
    [Test]
    public void TheHousingTrimFollowsEveryQuarterTurn() {
        BuildAll(Root("B3 trim turns base"));
        var source = zoo.Document.Modules.First(module => module.Id == "psd-end-654");
        var corner = zoo.Document.Modules.First(module => module.Id == "edge-track-1-left");
        var station = new List<ModuleFacts> { source.Facts, corner.Facts };
        for (int rotation = 0; rotation < 4; rotation++) {
            var request = OpeningModuleViews.RequestFor(source, zoo.Index);
            request.ModuleId = "psd-end-654-r" + rotation;
            request.Rotation = rotation;
            var facts = new ModuleFacts {
                Id = request.ModuleId, Type = source.Facts.Type,
                X = source.Facts.X, Y = source.Facts.Y, Z = source.Facts.Z,
                Rotation = rotation, Width = source.Facts.Width, Depth = source.Facts.Depth,
                Config = source.Facts.Config,
            };
            var palette = new OpeningPalette(shader);
            palettes.Add(palette);
            Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, station, catalogue, Root("B3 trim turn " + rotation),
                palette, out var view), rotation + ": the return must build");
            Assert.Greater(view.Housing.Count, 0, rotation + ": the parent housing resolves: " + view.Diagnostic);
            foreach (var box in view.Boxes) {
                if (box.Glass) continue;
                foreach (var house in view.Housing) {
                    float overlap = Math.Min(box.Max.x, house.Max.x) - Math.Max(box.Min.x, house.Min.x);
                    overlap = Math.Min(overlap, Math.Min(box.Max.y, house.Max.y) - Math.Max(box.Min.y, house.Min.y));
                    overlap = Math.Min(overlap, Math.Min(box.Max.z, house.Max.z) - Math.Max(box.Min.z, house.Min.z));
                    Assert.LessOrEqual(overlap, 1e-5f,
                        rotation + ": " + box.Part + " overlaps the parent housing");
                }
            }
            // The moving parts of the run it continues are untouched: the return owns none,
            // and the run still owns its leaves (rendered by the same build).
            Assert.AreEqual(0, view.Leaves.Count, rotation + ": a fixed return has no moving leaf");
        }
        // The run's own leaves and the floor vinyls are untouched by the return trim.
        var run = View(Set(), "edge-track-1-left");
        Assert.AreEqual(RunOpenings * 2, run.Leaves.Count, "the parent run keeps its two leaf panels per door");
        Assert.AreEqual(RunOpenings, run.OpeningCount, "and its openings");
    }

    /* ------------------------------------------------------------------ gates */

    /// <summary>
    /// 18 §5 — a doorless (fence) machine carries the barrier through its lane. The source's
    /// `GateModel` doorless branch draws `drawFence` from the cabinet's inner jamb to the cell
    /// edge plus a jamb post, and caps the free end only when the neighbouring run does not
    /// carry on. `GateSolidFaces` already reports the gate solid all round, so without the
    /// panel the neighbouring fence ended at a gap.
    /// </summary>
    [Test]
    public void ADoorlessGateCarriesItsFencePanelToTheNeighbourAndCapsAlone() {
        BuildAll(Root("B5 gate fence"));
        int carriedVertices = 0;
        foreach (var (gateId, fenceId) in new[] {
            ("gate-244", "fence-87"), ("gate-245", "fence-81"), ("gate-284", "fence-279"),
        }) {
            var gate = View(Set(), gateId);
            Assert.IsFalse(gate.Movable, gateId + " is doorless and must not animate a leaf");
            Assert.AreEqual("fence-door:panel-carried", gate.Diagnostic,
                gateId + " must see " + fenceId + " carry the run on");
            var count = AssertGateFencePanel(gate, gateId);
            carriedVertices = count;
        }
        // Rebuild the same station without the lane neighbour: the free end caps itself, and
        // exactly one post is added — never a duplicate end post on a carried run.
        var modules = zoo.Document.Modules.Where(record => record.Id != "fence-87").ToList();
        var set = new OpeningModuleSet();
        var palette = new OpeningPalette(shader);
        palettes.Add(palette);
        OpeningModuleViews.BuildAll(modules, zoo.Index, catalogue, Root("B5 gate capped"), palette, set,
            (module, view) => { }, (module, diagnostic) => Assert.Fail(module.Id + ": " + diagnostic));
        Assert.IsTrue(set.TryGet("gate-244", out var capped), "the capped build still draws the gate");
        Assert.AreEqual("fence-door:panel-capped", capped.Diagnostic, "removing the neighbour caps the free end");
        var cappedVertices = AssertGateFencePanel(capped, "gate-244 without its neighbour");
        var postVertices = new List<Vector3>();
        var postTriangles = new List<int>();
        OutdoorModuleViews.AppendFencePost(postVertices, postTriangles, 0f, 0f);
        Assert.AreEqual(carriedVertices + postVertices.Count, cappedVertices,
            "a carried run adds exactly one end post over the jamb post, not a duplicate");
    }

    /// <summary>Assert one doorless gate's panel spans jamb to cell edge; return its steel vertices.</summary>
    static int AssertGateFencePanel(OpeningView gate, string what) {
        var panel = gate.Instance.transform.Find("fence panel");
        Assert.IsNotNull(panel, what + " drew no fence panel");
        var filters = panel.GetComponentsInChildren<MeshFilter>(true);
        var steel = filters.FirstOrDefault(filter => filter.name.IndexOf("steel", StringComparison.OrdinalIgnoreCase) >= 0);
        var glass = filters.FirstOrDefault(filter => filter.name.IndexOf("glass", StringComparison.OrdinalIgnoreCase) >= 0);
        Assert.IsNotNull(steel, what + " panel has no steel arm and posts");
        Assert.IsNotNull(glass, what + " panel has no glass pane");
        var glassRenderer = glass.GetComponent<MeshRenderer>();
        Assert.IsNotNull(glassRenderer?.sharedMaterial, what + " glass pane has no material");
        Assert.IsFalse(glassRenderer.sharedMaterial.name.IndexOf("tintedGlass", StringComparison.OrdinalIgnoreCase) >= 0,
            what + " fence panel glass must not borrow the scanner head's opaque tintedGlass");
        float glassAlpha = glassRenderer.sharedMaterial.HasProperty("_BaseColor")
            ? glassRenderer.sharedMaterial.GetColor("_BaseColor").a
            : glassRenderer.sharedMaterial.color.a;
        Assert.Less(glassAlpha, .7f, what + " fence panel glass must stay transparent");
        Assert.IsTrue(OpeningModuleViews.MeshBoundsIn(panel, gate.Holder, out var bounds), what + " panel bounds");
        Assert.IsTrue(OpeningModuleViews.MeshBoundsIn(glass.transform, gate.Holder, out var pane),
            what + " glass pane bounds");
        // The pane is the run proper (0.7 m from the jamb to the cell edge, 12 mm short at
        // each end); the steel rail and its clamps overhang the arm ends by ~27 mm, as the
        // source's `drawFence` does.
        Assert.AreEqual(.688f, pane.size.x, .03f, what + " glass pane spans the lane half (0.7 m)");
        Assert.AreEqual(.494f, Mathf.Max(Mathf.Abs(pane.min.x), Mathf.Abs(pane.max.x)), .03f,
            what + " pane reaches the cell edge");
        Assert.AreEqual(.206f, Mathf.Min(Mathf.Abs(pane.min.x), Mathf.Abs(pane.max.x)), .03f,
            what + " pane starts at the cabinet jamb");
        Assert.AreEqual(.755f, bounds.size.x, .04f, what + " steel rail and clamps overhang the pane ends");
        Assert.AreEqual(0f, bounds.size.z, .12f, what + " panel stays in the lane's plane");
        Assert.Greater(bounds.max.y, .95f, what + " panel reaches the fence's top rail height");
        // 18c §1 — the span is **signed** in the holder frame: the cabinet jamb on the lane's −X
        // side, the cell edge on +X. Every absolute-value check above also passes on the mirror,
        // which drew the panel a full tile edge away, so the side is what a probe has to read.
        Assert.AreEqual(OpeningModuleViews.GateJambInner + .012f, pane.min.x, .03f,
            what + " pane starts at the source's inner jamb on the −X side");
        Assert.AreEqual(OpeningModuleViews.GateCellEdge - .012f, pane.max.x, .03f,
            what + " pane reaches the +X cell edge the lane opens towards");
        Assert.Less(pane.min.x, 0f, what + " pane starts on the jamb side of the lane");
        Assert.Greater(pane.max.x, 0f, what + " pane reaches the lane-side cell edge");
        Assert.Greater((bounds.min.x + bounds.max.x) * .5f, .02f,
            what + " the panel spans toward the lane, not towards its mirror");
        Assert.AreEqual(OpeningModuleViews.GateCellEdge, gate.PanelEdge, 1e-4f,
            what + " the builder generated to the lane's own cell edge");
        Assert.Less(gate.PanelJamb, 0f, what + " the measured jamb is on the −X side");
        return steel.sharedMesh.vertexCount;
    }

    /// <summary>
    /// 18 §5 — the panel follows the machine's authored quarter turn: the neighbour is read at
    /// the gate's rotated local +x, and the panel always spans from its own jamb to that edge.
    /// </summary>
    [Test]
    public void ADoorlessGatePanelFollowsEveryQuarterTurn() {
        var source = zoo.Document.Modules.First(module => module.Id == "gate-244");
        var fenceFacts = zoo.Document.Modules.First(module => module.Type == "fence").Facts;
        for (int rotation = 0; rotation < 4; rotation++) {
            var request = OpeningModuleViews.RequestFor(source, zoo.Index);
            request.ModuleId = "gate-244-r" + rotation;
            request.Rotation = rotation;
            var facts = new ModuleFacts {
                Id = request.ModuleId, Type = source.Facts.Type,
                X = source.Facts.X, Y = source.Facts.Y, Z = source.Facts.Z,
                Rotation = rotation, Width = source.Facts.Width, Depth = source.Facts.Depth,
                Config = source.Facts.Config,
            };
            StationFootprints.RotateLocal(rotation, 1, 0, out var ox, out var oy);
            var neighbour = new ModuleFacts {
                Id = "fence-lane-" + rotation, Type = "fence",
                X = facts.X + (int)Math.Round(ox), Y = facts.Y + (int)Math.Round(oy), Z = facts.Z,
                Rotation = 0, Width = 1, Depth = 1, Config = ModuleConfig.Empty,
            };
            var station = new List<ModuleFacts> { facts, neighbour, fenceFacts };
            var palette = new OpeningPalette(shader);
            palettes.Add(palette);
            Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, station, catalogue, Root("B5 turn " + rotation),
                palette, out var view), rotation + ": the doorless gate must build");
            Assert.AreEqual("fence-door:panel-carried", view.Diagnostic,
                rotation + ": the fence on the rotated +x carries the run");
            AssertGateFencePanel(view, "rotation " + rotation);
        }
    }

    [Test]
    public void DoorlessAndDirectionalGatesShowRedCrossInsteadOfGreenArrowAndMatchFenceMaterials() {
        Assert.IsTrue(catalogue.TryGet("fence", out var fenceEntry) && fenceEntry.prefab != null, "Fence.prefab in catalogue");
        Assert.IsTrue(OutdoorModuleViews.TryExtractFenceMaterials(fenceEntry.prefab, out var fenceSteel, out var fenceGlass),
            "Fence.prefab must expose exact steel and glass materials");
        Assert.AreEqual("steel", OutdoorModuleViews.MaterialBaseName(fenceSteel.name));
        Assert.AreEqual("glass", OutdoorModuleViews.MaterialBaseName(fenceGlass.name));

        var palette = new OpeningPalette(shader);
        palettes.Add(palette);

        foreach (var variant in new[] { "old", "new" }) {
            foreach (var door in new[] { "fence", "none" }) {
                var id = "gate-" + variant + "-" + door;
                var facts = new ModuleFacts {
                    Id = id, Type = "gate", X = 0, Y = 0, Z = 0, Rotation = 0, Width = 1, Depth = 1,
                    Config = new ModuleConfig(new Dictionary<string, string> {
                        ["dir"] = "both", ["door"] = door, ["variant"] = variant,
                    }),
                };
                var request = new OpeningModuleViews.OpeningRequest {
                    ModuleId = id, Type = "gate", Rotation = 0, Width = 1, Depth = 1,
                    Dir = "both", Door = door, Variant = variant,
                };
                Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue,
                    Root("cross-" + id), palette, out var view), id + ": " + view.Diagnostic);

                var arrows = view.Instance.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(r => r && r.enabled && r.gameObject.name == "entry-arrow").ToList();
                var crosses = view.Instance.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(r => r && r.enabled && r.gameObject.name == "no-entry-cross").ToList();
                Assert.AreEqual(0, arrows.Count, id + " must not leave any green entry-arrow enabled");
                Assert.AreEqual(2, crosses.Count, id + " must place no-entry-cross on both approach faces");
                foreach (var cross in crosses) {
                    Assert.IsNotNull(cross.sharedMaterial, id + " cross material");
                    Assert.AreEqual("gateCross", cross.sharedMaterial.name);
                    var tex = cross.sharedMaterial.mainTexture as Texture2D;
                    Assert.IsNotNull(tex, id + " gateCross texture");
                    Assert.AreEqual(64, tex.width);
                    Assert.AreEqual(76, tex.height);
                    var centre = tex.GetPixel(32, 38);
                    var diag = tex.GetPixel(20, 25);
                    var corner = tex.GetPixel(2, 2);
                    Assert.Greater(centre.r, .85f, id + " red X centre R");
                    Assert.Less(centre.g, .35f, id + " red X centre G (never green arrow)");
                    Assert.Greater(diag.r, .85f, id + " red X diagonal R");
                    Assert.Less(corner.r, .10f, id + " #0b0d11 dark corner R");
                    Assert.Less(corner.g, .10f, id + " #0b0d11 dark corner G");
                }

                var panel = view.Instance.transform.Find("fence panel");
                Assert.IsNotNull(panel, id + " attached fence panel");
                var steelFilter = panel.Find("fence panel steel")?.GetComponent<MeshFilter>();
                var glassFilter = panel.Find("fence panel glass")?.GetComponent<MeshFilter>();
                Assert.IsNotNull(steelFilter);
                Assert.IsNotNull(glassFilter);
                Assert.AreSame(fenceSteel, steelFilter.GetComponent<MeshRenderer>().sharedMaterial,
                    id + " attached fence steel must use Fence.prefab's exact steel material (never darkSteel)");
                Assert.AreSame(fenceGlass, glassFilter.GetComponent<MeshRenderer>().sharedMaterial,
                    id + " attached fence glass must use Fence.prefab's exact glass material");

                var mesh = steelFilter.sharedMesh;
                var uvs = mesh.uv;
                Assert.AreEqual(mesh.vertexCount, uvs.Length, id + " steel mesh must carry planar UVs");
                Assert.IsTrue(uvs.Any(uv => uv.sqrMagnitude > 1e-4f), id + " steel UVs must be non-zero");

                var norms = mesh.normals;
                Assert.GreaterOrEqual(norms.Length, 24, id + " top rail cylinder barrel vertices");
                for (int i = 0; i < 24; i++) {
                    Assert.Less(Mathf.Abs(norms[i].x), 1e-4f,
                        id + " horizontal top rail barrel normal must stay purely radial (not bent toward end caps)");
                }
            }
        }

        // Directional lane gates: 'both' = 2 arrows, 'in' = 1 arrow + 1 cross, 'out' = 1 cross + 1 arrow.
        foreach (var (dir, expectedArrows, expectedCrosses) in new[] {
            ("both", 2, 0), ("in", 1, 1), ("out", 1, 1),
        }) {
            var id = "gate-dir-" + dir;
            var door = "flap";
            var facts = new ModuleFacts {
                Id = id, Type = "gate", X = 0, Y = 0, Z = 0, Rotation = 0, Width = 1, Depth = 1,
                Config = new ModuleConfig(new Dictionary<string, string> {
                    ["dir"] = dir, ["door"] = door, ["variant"] = "old",
                }),
            };
            var request = new OpeningModuleViews.OpeningRequest {
                ModuleId = id, Type = "gate", Rotation = 0, Width = 1, Depth = 1,
                Dir = dir, Door = door, Variant = "old",
            };
            Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue,
                Root("dir-" + dir), palette, out var view), id + ": " + view.Diagnostic);
            int arrows = view.Instance.GetComponentsInChildren<MeshRenderer>(true)
                .Count(r => r && r.enabled && r.gameObject.name == "entry-arrow");
            int crosses = view.Instance.GetComponentsInChildren<MeshRenderer>(true)
                .Count(r => r && r.enabled && r.gameObject.name == "no-entry-cross");
            Assert.AreEqual(expectedArrows, arrows, id + " entry-arrow count");
            Assert.AreEqual(expectedCrosses, crosses, id + " no-entry-cross count");
        }
    }

    [Test]
    public void GateWingsRetractWithSetGateWingAndTheCabinetStaysPut() {
        BuildAll(Root("B3 gate"));
        var set = Set();
        var gate = View(set, "gate-240");
        Assert.AreEqual(OpeningKind.Gate, gate.Kind);
        Assert.IsTrue(gate.Movable, "a lane gate must have moving wings");
        Assert.AreEqual("", gate.Diagnostic, "a lane gate's lane must match GATE_W");
        Assert.AreEqual(2, gate.Leaves.Count, "two wings per lane");
        var near = gate.Leaves.Single(leaf => leaf.Sign > 0f);
        var far = gate.Leaves.Single(leaf => leaf.Sign < 0f);
        // The measurement reproduces `GateModel`'s lane (inner −0.2, far 0.5, one wing 0.35)
        // up to the promoted content's handedness: glTFast bakes glTF's right-handed frame into
        // Unity's left-handed one, so the prefab may present the lane mirrored in x.
        Assert.IsTrue(OpeningModuleViews.TryMeasureGateLane(gate.Instance.transform,
            out var nearJamb, out var farJamb, out var wingWidth), "the exported lane is unmeasurable");
        AssertNear("wing width", 0.35f, wingWidth, 2e-2f);
        Assert.IsTrue(OpeningModuleViews.GateGeometryMatchesSource(nearJamb, farJamb, wingWidth),
            "the lane is neither GATE_W nor its mirror: " + nearJamb + ".." + farJamb);
        bool mirrored = OpeningModuleViews.GateLaneMirrored(nearJamb, farJamb);
        Assert.AreEqual(mirrored ? "x-negated" : "source-x", gate.AxisConvention, "the lane's x convention note");
        AssertNear("near wing jamb", nearJamb, near.GateEdge, 1e-4f);
        AssertNear("far wing jamb", farJamb, far.GateEdge, 1e-4f);
        AssertNear("near wing width", wingWidth, near.GateFullWidth, 1e-4f);
        // `setGateWing(0)` must write exactly the authored shut pose, or the first command
        // would pop the leaf.
        AssertNear("near shut centre", OpeningModuleViews.GateLeafCentre(near.GateEdge, near.Sign, wingWidth),
            near.Node.localPosition.x, 1e-3f);
        AssertNear("far shut centre", OpeningModuleViews.GateLeafCentre(far.GateEdge, far.Sign, wingWidth),
            far.Node.localPosition.x, 1e-3f);

        var cabinet = gate.Instance.GetComponentsInChildren<Transform>(true)
            .FirstOrDefault(node => node.name == "gate-body");
        Assert.IsNotNull(cabinet, "the gate prefab lost its cabinet");
        var cabinetPose = cabinet.localPosition;

        // Half open: width = full x 0.5 + 0.025 x 0.5, both wings compress symmetrically.
        Assert.IsTrue(set.Apply("gate-240", OpeningState.Uniform(.5f)));
        float half = OpeningModuleViews.GateLeafWidth(near.GateFullWidth, .5f);
        AssertNear("near half-open centre", OpeningModuleViews.GateLeafCentre(near.GateEdge, near.Sign, half),
            near.Node.localPosition.x);
        AssertNear("far half-open centre", OpeningModuleViews.GateLeafCentre(far.GateEdge, far.Sign, half),
            far.Node.localPosition.x);
        AssertNear("near half-open scale", half / near.GateFullWidth, near.Node.localScale.x);
        AssertNear("far half-open scale", half / far.GateFullWidth, far.Node.localScale.x);

        // Fully retracted: a 0.025 m wing parked at its jamb.
        Assert.IsTrue(set.Apply("gate-240", OpeningState.Uniform(1f)));
        AssertNear("near retracted centre", OpeningModuleViews.GateLeafCentre(near.GateEdge, near.Sign, .025f),
            near.Node.localPosition.x);
        AssertNear("near retracted width", .025f, near.Node.localScale.x * near.GateFullWidth, 2e-3f);
        AssertNear("far retracted centre", OpeningModuleViews.GateLeafCentre(far.GateEdge, far.Sign, .025f),
            far.Node.localPosition.x);

        // Repeated shut leaves no residual scale, and the machine never moves.
        Assert.IsTrue(set.Apply("gate-240", OpeningState.Shut));
        AssertPose("shut wing scale", near.AuthoredScale, near.Node.localScale);
        AssertNear("near shut again", OpeningModuleViews.GateLeafCentre(near.GateEdge, near.Sign, wingWidth),
            near.Node.localPosition.x, 1e-3f);
        Assert.AreEqual(cabinetPose, cabinet.localPosition, "the gate cabinet moved with its wings");
    }

    [Test]
    public void AFenceGateHasNoLeafChannelAndHidesItsExportedWings() {
        BuildAll(Root("B3 fence gate"));
        var set = Set();
        var gate = View(set, "gate-244");
        Assert.IsFalse(gate.Movable, "a fence machine must not animate");
        Assert.AreEqual(0, gate.Leaves.Count, "a fence machine registered wings");
        Assert.IsTrue(gate.Diagnostic.Contains("fence-door"), gate.Diagnostic);
        var wing = gate.Instance.GetComponentsInChildren<Transform>(true)
            .FirstOrDefault(node => node.name == "wing");
        Assert.IsNotNull(wing, "the gate prefab lost its wing group");
        Assert.IsFalse(wing.gameObject.activeSelf, "the exported wings must be hidden where the source draws fence");
        Assert.IsTrue(set.Apply("gate-244", OpeningState.Uniform(1f)), "the state is accepted but moves nothing");
        Assert.AreEqual(0, gate.Leaves.Count);
    }

    /* ------------------------------------------------------- swing doors */

    [Test]
    public void SwingDoorsAndCubiclesTurnTheirExportedPivotToTheSourceLimit() {
        BuildAll(Root("B3 swing"));
        var set = Set();
        foreach (var id in new[] { "door-steel-1-391", "cubicle-739" }) {
            var view = View(set, id);
            Assert.IsTrue(view.Movable, id + " lost its hinge: " + view.Diagnostic);
            Assert.AreEqual(1, view.Leaves.Count, id + " must expose one leaf");
            Assert.IsTrue(view.AxisConvention == "source-x" || view.AxisConvention.StartsWith("x-negated", StringComparison.Ordinal),
                id + " was built without reading its AxisX/Front/Up anchors: " + view.AxisConvention);
            var pivot = view.Leaves[0];
            Assert.AreEqual(OpeningLeafKind.SwingPivot, pivot.LeafKind);
            // `DoorModel`/`CubicleModel`: this leaf hangs at the source's −1 hinge.
            AssertNear(id + " hinge sign", -1f, pivot.Sign);
            // The leaf's centre, as a world point that follows the hinge.
            Assert.IsTrue(OpeningModuleViews.MeshBoundsIn(pivot.Node, pivot.Node, out var bounds),
                id + " has no leaf mesh to sample");
            var centre = bounds.center;
            var approach = view.Instance.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(node => node.name == "Approach");
            Assert.IsNotNull(approach, id + " lost the Approach anchor");
            var approachDir = (approach.position - approach.parent.position).normalized;
            Assert.Greater(approachDir.sqrMagnitude, .5f, id + " has no Approach direction");

            // The hinge is the piece's up axis, so it must be vertical (either sign) and square
            // to the approach face. Reading `SwingUp` through the pivot catches a law that turns
            // the leaf about the across axis instead — the 90° error this test exists for.
            var hingeWorld = pivot.Node.TransformDirection(pivot.SwingUp).normalized;
            Assert.Greater(Mathf.Abs(Vector3.Dot(hingeWorld, Vector3.up)), .9f,
                id + " hinges about " + hingeWorld + ", not the vertical");
            Assert.Less(Mathf.Abs(Vector3.Dot(hingeWorld, approachDir)), .2f,
                id + " hinges about the approach normal");

            Assert.IsTrue(set.Apply(id, OpeningState.Shut));
            AssertNear(id + " shut", 0f, Quaternion.Angle(Quaternion.identity, pivot.Node.localRotation), 1e-3f);
            var shutCentre = pivot.Node.TransformPoint(centre);

            Assert.IsTrue(set.Apply(id, OpeningState.Uniform(1f)));
            // The magnitude is the source's 81° limit ...
            AssertNear(id + " open", 81f, Quaternion.Angle(Quaternion.identity, pivot.Node.localRotation), .05f);
            // ... the leaf swings in the plan, not out of it ...
            var openCentre = pivot.Node.TransformPoint(centre);
            var delta = openCentre - shutCentre;
            Assert.Less(Mathf.Abs(delta.y), .05f, id + " swung out of the plan (" + delta + ")");
            Assert.Greater(new Vector3(delta.x, 0f, delta.z).magnitude, .1f, id + " barely moved (" + delta + ")");
            // ... and toward the doorway's approach face, which is the source's own direction
            // (`sign = −1` sends the free edge toward −y, the Approach anchor). This is the
            // check that depends on neither the prefab's handedness nor its up axis.
            float toward = Vector3.Dot(delta, approachDir);
            Assert.Greater(toward, .05f, id + " swung away from its approach face (" + toward + ")");

            Assert.IsTrue(set.Apply(id, OpeningState.Uniform(.5f)));
            AssertNear(id + " half", 40.5f, Quaternion.Angle(Quaternion.identity, pivot.Node.localRotation), .05f);
            Assert.IsTrue(set.Apply(id, OpeningState.Shut));
            AssertNear(id + " closed again", 0f, Quaternion.Angle(Quaternion.identity, pivot.Node.localRotation), 1e-3f);
        }
    }

    [Test]
    public void TheTwoLeavesOfADoubleDoorTurnOppositeWays() {
        // `DoorModel`: leaf 0's pivot stands on its left edge and gets sign -1; leaf 1's
        // stands on its right edge and gets +1. `SwingSign` recovers that from geometry, and
        // a piece with no anchors falls back to the document frame (determinant -1).
        AssertNear("left leaf", -1f, SwingSignOf(1f));
        AssertNear("right leaf", 1f, SwingSignOf(-1f));
        var document = new OpeningModuleViews.OpeningAxis {
            X = Vector3.right, Y = Vector3.forward, Z = Vector3.up, Determinant = -1f, Known = false,
        };
        AssertNear("left half angle", 40.5f, OpeningModuleViews.SwingLocalDegrees(document, -1f, .5f));
        AssertNear("right half angle", -40.5f, OpeningModuleViews.SwingLocalDegrees(document, 1f, .5f));
        var mirrored = new OpeningModuleViews.OpeningAxis {
            X = Vector3.left, Y = Vector3.forward, Z = Vector3.up, Determinant = 1f, Known = true,
        };
        AssertNear("mirrored left half angle", -40.5f, OpeningModuleViews.SwingLocalDegrees(mirrored, -1f, .5f));
    }

    /// <summary>`SwingSign` derives the source's hinge sign from the leaf's hang side.</summary>
    static float SwingSignOf(float leafHangX) {
        var pivotObject = new GameObject("passenger-swing-door");
        try {
            var leaf = GameObject.CreatePrimitive(PrimitiveType.Cube);
            leaf.transform.SetParent(pivotObject.transform, false);
            leaf.transform.localPosition = new Vector3(leafHangX, 0f, 0f);
            return OpeningModuleViews.SwingSign(pivotObject.transform);
        } finally {
            UnityEngine.Object.DestroyImmediate(pivotObject);
        }
    }

    /* --------------------------------------------------------------- the world */

    [Test]
    public void TheRendererRegistersEveryOpeningUnderTheOpeningsRole() {
        var renderer = new OpeningModuleRenderer();
        var world = new StationWorldView(Root("B3 world"), "B3 station", new IStationViewRenderer[] { renderer },
            new StationViewAssets { Catalogue = catalogue, Shader = shader });
        worlds.Add(world);
        world.Build(zoo.Document, zoo.Index);
        Assert.IsTrue(world.IsBuilt);
        Assert.AreEqual("openings", renderer.Role);
        Assert.AreEqual(TotalViews, renderer.Views.Count, "the renderer built " + renderer.Views.Count + " views");
        var summary = world.Summary();
        Assert.IsTrue(summary.ByRole.TryGetValue("openings", out var records), "the role has no records: " + summary);
        Assert.AreEqual(TotalViews, records, "every opening module must be one world record");
        // No module may be refused or silently static where the source moves.
        var refused = renderer.Views.Views
            .Where(view => view.Diagnostic.StartsWith("unresolved:", StringComparison.Ordinal)).ToArray();
        Assert.IsEmpty(refused, "refused modules: " + string.Join(" | ", refused.Select(view => view.Describe())));
        Assert.IsTrue(world.TryGetModule("edge-track-1-left", out var runRecord), "the run is not addressable by ID");
        Assert.AreEqual("openings", runRecord.Role);
        Assert.IsTrue(world.TryGetModule("gate-240", out var gateRecord));
        Assert.IsNotNull(gateRecord.View);
        Assert.IsTrue(world.TryGetModule("psd-end-654", out var endRecord));
        Assert.IsNotNull(endRecord.View);
        // The registered instance is the one the state drives.
        Assert.AreSame(runRecord.View, View(renderer.Views, "edge-track-1-left").Instance);
        // A station-wide switch does not exist: applying must name a module.
        Assert.IsFalse(renderer.Views.Apply("", OpeningState.Uniform(1f)));
        Assert.IsFalse(renderer.Views.Apply(null, OpeningState.Uniform(1f)));
    }

    /* ------------------------------------------------------------ train doors */

    [Test]
    public void TrainDoorStagesThePlugBeforeTheSlideAndKeepsBothBanksAddressable() {
        var consist = Consist();
        var rig = new TrainDoorRig(consist, TrainDoorRig.ForLine("L", 6, 1f));
        Assert.AreEqual(4, rig.Leaves, "two leaves on each bank: " + rig.Describe());
        Assert.AreEqual(1, rig.Doors, "one doorway: " + rig.Describe());
        Assert.AreEqual(2, rig.Banks);
        Assert.IsTrue(rig.UsesAnchors, "the formation's DoorCentre anchors must drive the binding: " + rig.Describe());
        Assert.IsFalse(rig.UsesMeasuredPair, "the rig fell back to a measured pair: " + rig.Describe());
        Assert.AreEqual(1, rig.PlatformBank);
        AssertNear("travel from STOCK.L", .7f, rig.ObservedTravel);

        var plus = BankLeaves(consist, 1);
        var minus = BankLeaves(consist, -1);
        var plusClosed = plus.Select(leaf => leaf.localPosition).ToArray();
        var minusClosed = minus.Select(leaf => leaf.localPosition).ToArray();

        // Stage 0: shut.
        rig.Apply(0f);
        for (int i = 0; i < plus.Length; i++) AssertPose("shut leaf " + i, plusClosed[i], plus[i].localPosition);

        // Stage 0.09: half the plug, no slide at all.
        rig.Apply(.09f);
        var halfPlug = TrainDoorRig.Stage.At(.09f);
        AssertNear("half plug", .5f, halfPlug.Plug);
        AssertNear("no slide yet", 0f, halfPlug.Slide, 1e-6f);
        AssertNear("no slide yet (x)", plusClosed[0].x, plus[0].localPosition.x, 1e-5f);
        AssertNear("plug out", .03f, Mathf.Abs(plus[0].localPosition.z - plusClosed[0].z), 1e-4f);

        // Stage 0.18: the plug is fully out and the slide has not started.
        rig.Apply(TrainDoorRig.PlugPhase);
        AssertNear("plug complete", .06f, Mathf.Abs(plus[0].localPosition.z - plusClosed[0].z), 1e-4f);
        AssertNear("slide still 0", 0f, plus[0].localPosition.x - plusClosed[0].x, 1e-5f);

        // Stage 0.59: the slide is half done, the plug stays out.
        rig.Apply(.59f);
        var halfSlide = TrainDoorRig.Stage.At(.59f);
        AssertNear("slide half", .5f, halfSlide.Slide, 1e-4f);
        AssertNear("left leaf slid", -.35f, plus[0].localPosition.x - plusClosed[0].x, 1e-3f);
        AssertNear("right leaf slid", .35f, plus[1].localPosition.x - plusClosed[1].x, 1e-3f);

        // Stage 1: fully open, and the opposite bank never moved.
        rig.Apply(1f);
        AssertNear("left leaf fully open", -.7f, plus[0].localPosition.x - plusClosed[0].x, 1e-3f);
        AssertNear("right leaf fully open", .7f, plus[1].localPosition.x - plusClosed[1].x, 1e-3f);
        for (int i = 0; i < minus.Length; i++)
            AssertPose("the tunnel-side bank moved with the platform bank", minusClosed[i], minus[i].localPosition);

        // The other bank is independently addressable.
        rig.SetBank(-1, 1f);
        AssertNear("plus held", 1f, rig.Plus);
        for (int i = 0; i < plus.Length; i++)
            AssertNear("plus leaf held " + i, .7f,
                Mathf.Abs(plus[i].localPosition.x - plusClosed[i].x), 1e-3f);
        AssertNear("the plus pair held its clear width",
            plus[1].localPosition.x - plus[0].localPosition.x,
            plusClosed[1].x - plusClosed[0].x + 1.4f, 1e-3f);
        for (int i = 0; i < minus.Length; i++)
            AssertNear("minus leaf opened " + i, .7f, Mathf.Abs(minus[i].localPosition.x - minusClosed[i].x), 1e-3f);
        rig.Reset();
        Assert.AreEqual(0f, rig.Plus);
        Assert.AreEqual(0f, rig.Minus);
    }

    [Test]
    public void TrainDoorsRampOverTwoSimSecondsAndHoldAtTheTarget() {
        var consist = Consist();
        var rig = new TrainDoorRig(consist, TrainDoorRig.ForLine("L", 6, 1f));
        Assert.IsTrue(rig.Advance(.5f, 1f, 0f), "the first half second must move the fraction");
        AssertNear("quarter open after 0.5 s", .25f, rig.Plus);
        Assert.IsTrue(rig.Advance(.5f, 1f, 0f));
        AssertNear("half open after 1 s", .5f, rig.Plus);
        Assert.IsTrue(rig.Advance(1f, 1f, 0f));
        AssertNear("open after 2 s", 1f, rig.Plus, 1e-5f);
        Assert.IsFalse(rig.Advance(1f, 1f, 0f), "a bank at its target must not report a change");
        AssertNear("still open", 1f, rig.Plus, 1e-5f);
        AssertNear("the opposite bank is still shut", 0f, rig.Minus);
    }

    [Test]
    public void ReversingTheFormationAtTheBerthFlipsThePlatformBank() {
        var consist = Consist();
        var platformPoint = new Vector3(0f, 0f, 10f);
        Assert.AreEqual(1, TrainDoorRig.BankFacing(consist.transform, platformPoint));
        var rig = new TrainDoorRig(consist, TrainDoorRig.ForLine("L", 6, 1f));
        rig.SetPlatformSide(platformPoint);
        Assert.AreEqual(1, rig.PlatformBank);
        var plus = BankLeaves(consist, 1);
        var minus = BankLeaves(consist, -1);
        var plusClosed = plus.Select(leaf => leaf.localPosition).ToArray();
        var minusClosed = minus.Select(leaf => leaf.localPosition).ToArray();
        rig.Apply(1f);
        AssertNear("the near bank opened", .7f, Mathf.Abs(plus[0].localPosition.x - plusClosed[0].x), 1e-3f);
        AssertPose("the far bank opened before the reversal", minusClosed[0], minus[0].localPosition);
        rig.Reset();

        // The same consist turned end for end at the same berth: its local +z now faces
        // away from the platform, so the other bank is the platform bank.
        consist.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
        Assert.AreEqual(-1, TrainDoorRig.BankFacing(consist.transform, platformPoint));
        rig.SetPlatformSide(platformPoint);
        Assert.AreEqual(-1, rig.PlatformBank);
        rig.Apply(1f);
        AssertNear("the reversed near bank opened", .7f, Mathf.Abs(minus[0].localPosition.x - minusClosed[0].x), 1e-3f);
        AssertPose("the bank away from the platform opened after the reversal", plusClosed[0], plus[0].localPosition);
        // The plug and slide law itself is local, so the leaf's own travel is unchanged.
        AssertNear("travel after reversal", .7f, rig.ObservedTravel);
        rig.Reset();
    }

    [Test]
    public void AConsistWithoutDoorCentreAnchorsFallsBackToTheMeasuredPair() {
        var consist = new GameObject("Measured consist");
        roots.Add(consist);
        var names = 0;
        for (int bank = -1; bank <= 1; bank += 2) {
            for (int side = 0; side < 2; side++) {
                var leaf = new GameObject("TrainLMidDoor" + (names++).ToString("00"));
                leaf.transform.SetParent(consist.transform, false);
                leaf.transform.localPosition = new Vector3(side == 0 ? -.35f : .35f, 0f, bank * 1.375f);
            }
        }
        var rig = new TrainDoorRig(consist, 1f);
        Assert.AreEqual(4, rig.Leaves);
        Assert.IsFalse(rig.UsesAnchors, "there are no DoorCentre anchors to use");
        Assert.IsTrue(rig.UsesMeasuredPair, "the rig must report the measured fallback");
        AssertNear("default STOCK width", .7f, rig.ObservedTravel);
        var leaf0 = BankLeaves(consist, 1).First();
        float closed = leaf0.localPosition.x;
        rig.Apply(1f);
        AssertNear("the measured pair opened by its own travel", .7f, Mathf.Abs(leaf0.localPosition.x - closed), 1e-3f);
    }

    /* ---------------------------------------- RCA 15 §5: measured PSD geometry */

    /// <summary>
    /// `PsdModel.ts` builds the run's threshold, foundation and fascia in one frame:
    /// <code>
    /// slab(g, mats.black, cx, sillY, z0 - 0.01, len, sillDepth, 0.02).name = 'psd-threshold'
    /// finishSlab(g, ctx.finish('floor.concrete'), cx, sillY,
    ///            (foundationTop + foundationBottom) / 2, len, sillDepth, foundationTop - foundationBottom)
    ///   .name = 'psd-concrete-foundation'      // foundationBottom = z0 - 1, foundationTop = z0 - .02
    /// slab(g, mats.white, cx, yWall, z0 + glassH + headerH / 2, len, 0.24, headerH)
    ///   .name = 'psd-info-housing'
    /// </code>
    /// with `z0 = 1` — i.e. one metre above the module's own elevation, which is where the
    /// platform floor is. The run group itself is at `(mod.x + .5, mod.y + .5, mod.z)`, so the
    /// plinth fills the cell **below** the floor and the glazing stands on the floor.
    /// </summary>
    [Test]
    public void ThePsdRunHangsAtTheSourceDatumAndMeasuresItsOwnParts() {
        BuildAll(Root("RCA 15 datum"));
        var run = View(Set(), "edge-track-1-left");
        var module = zoo.Document.Modules.First(candidate => candidate.Id == "edge-track-1-left");
        // The holder is the source group's origin, not the floor top one metre above it.
        var holder = StationCoordinates.WorldToDocument(run.Holder.position);
        AssertNear("run datum", module.Z, holder.z, 1e-3f);

        var threshold = run.Part("psd-threshold");
        Assert.IsNotNull(threshold, "the run must name its threshold: " + run.Describe());
        var foundation = run.Part("psd-concrete-foundation");
        Assert.IsNotNull(foundation, "the run must name its foundation: " + run.Describe());
        var fascia = run.Part("psd-info-housing");
        Assert.IsNotNull(fascia, "the run must name its fascia: " + run.Describe());
        Assert.AreEqual(OpeningPartRole.Threshold, threshold.Role);
        Assert.AreEqual(OpeningPartRole.Foundation, foundation.Role);
        Assert.AreEqual(OpeningPartRole.Fascia, fascia.Role);

        // Threshold: 2 cm tall, its base 0.98 m above the module (flush on the foundation's top)
        // and its top face the floor datum `z0`; the sill's own depth 0.29 m, the run's 101 m.
        AssertNear("threshold height", .02f, threshold.Local.size.y, 1e-3f);
        AssertNear("threshold base", .98f, threshold.Local.min.y, 1e-3f);
        AssertNear("threshold top is the floor datum", 1f, threshold.Local.max.y, 1e-3f);
        AssertNear("threshold depth", .29f, threshold.Local.size.z, 1e-3f);
        AssertNear("threshold length", 101f, threshold.Local.size.x, 1e-3f);
        // Foundation: the same plan extent, 0.98 m tall from the module's own elevation up to
        // 2 cm below the threshold. `PsdModel` is explicit: `z0 - 1 … z0 - .02`.
        AssertNear("foundation base", 0f, foundation.Local.min.y, 1e-3f);
        AssertNear("foundation top", .98f, foundation.Local.max.y, 1e-3f);
        AssertNear("foundation height", .98f, foundation.Local.size.y, 1e-3f);
        AssertNear("foundation depth", .29f, foundation.Local.size.z, 1e-3f);
        AssertNear("foundation length", 101f, foundation.Local.size.x, 1e-3f);
        AssertNear("foundation across", -.395f, foundation.Local.center.z, 1e-3f);
        // Fascia: `headerH` 0.6 m of white housing centred at `z0 + glassH + headerH / 2`, its
        // 0.24 m depth on the screen's own wall line.
        AssertNear("fascia height", .6f, fascia.Local.size.y, 1e-3f);
        AssertNear("fascia mid", 3.65f, fascia.Local.center.y, 1e-3f);
        AssertNear("fascia depth", .24f, fascia.Local.size.z, 1e-3f);
        AssertNear("fascia across", -.34f, fascia.Local.center.z, 1e-3f);

        // The document elevations follow from the holder datum: the plinth occupies the cell
        // under the floor and the threshold sits on the floor, not one metre above it.
        AssertNear("foundation doc base", module.Z, foundation.Document.min.z, 1e-3f);
        AssertNear("foundation doc top", module.Z + .98f, foundation.Document.max.z, 1e-3f);
        AssertNear("threshold doc base", module.Z + .98f, threshold.Document.min.z, 1e-3f);
        AssertNear("threshold doc top is the floor", module.Z + 1f, threshold.Document.max.z, 1e-3f);
        AssertNear("fascia doc mid", module.Z + 3.65f, fascia.Document.center.z, 1e-3f);
        // Every measured part shares the holder's datum, so none of them floats.
        foreach (var part in run.Parts) AssertNear(part.Name + " datum", holder.z, part.Datum, 1e-3f);

        // The full-height geometry constants both sides use.
        AssertNear("full height", 3f, OpeningModuleViews.PsdFullHeight);
        AssertNear("half height", 1.45f, OpeningModuleViews.PsdHalfHeight);
    }

    /// <summary>
    /// `PsdModel` draws the foundation with the station finish `floor.concrete`
    /// (`finishSlab(g, ctx.finish('floor.concrete'), …)`), so the host must hand that material
    /// to the palette. The test palette carries no library, so it must **say so** by leaving
    /// `FoundationFinish` empty rather than claiming the source finish.
    /// </summary>
    [Test]
    public void ThePsdFoundationUsesTheSourceConcreteFinish() {
        BuildAll(Root("RCA 15 flat foundation"));
        var flat = View(Set(), "edge-track-1-left");
        Assert.AreEqual("", flat.FoundationFinish, "a palette without the finish library must not claim floor.concrete");
        Assert.AreEqual("concrete", flat.Part("psd-concrete-foundation").Material,
            "the fallback foundation must still be identifiable as the concrete slot");

        var library = StationCellRenderer.AcquireLibrary(shader);
        if (library == null) Assert.Ignore("the station finish export is not staged in this checkout");
        using (library) {
            var renderer = new OpeningModuleRenderer();
            var world = new StationWorldView(Root("RCA 15 finish"), "RCA 15 station",
                new IStationViewRenderer[] { renderer }, new StationViewAssets { Catalogue = catalogue, Shader = shader });
            worlds.Add(world);
            world.Build(zoo.Document, zoo.Index);
            var run = View(renderer.Views, "edge-track-1-left");
            var expected = library.For(OpeningPalette.FoundationFinishId);
            Assert.AreSame(expected, library.For(OpeningPalette.FoundationFinishId), "the finish material must be cached");
            Assert.AreEqual(OpeningPalette.FoundationFinishId, run.FoundationFinish,
                "the renderer must resolve floor.concrete for the foundation");
            var foundation = run.Part("psd-concrete-foundation");
            Assert.AreEqual(OpeningPalette.FoundationFinishId, foundation.Material);
            Assert.IsTrue(foundation.Node, "the foundation part has no object to inspect");
            var rendererOfPart = foundation.Node.GetComponentInChildren<MeshRenderer>(true);
            Assert.IsNotNull(rendererOfPart, "the foundation part has no renderer");
            Assert.IsNotNull(rendererOfPart.sharedMaterial, "the foundation part has no material");
            StringAssert.Contains(OpeningPalette.FoundationFinishId, rendererOfPart.sharedMaterial.name,
                "the foundation must use the exported finish material");
            Assert.IsNotNull(rendererOfPart.sharedMaterial.mainTexture,
                "floor.concrete must carry its exported albedo, not a flat colour");
            // The finish is the library's material, never the palette's: a palette handed one
            // must not destroy it on release, or every other renderer loses its finish.
            var palette = new OpeningPalette(shader, expected, OpeningPalette.FoundationFinishId);
            Assert.AreSame(expected, palette[OpeningColour.Concrete], "the palette must use the handed-in finish");
            palette.Release();
            Assert.IsTrue(expected, "releasing the palette destroyed a host-owned finish material");
            world.Dispose();
            worlds.Remove(world);
        }
    }

    /// <summary>
    /// `PsdEndModel.ts` cover: `new THREE.BoxGeometry(width ?? 1, depth ?? 0.24, 1)` at
    /// `(offset[0], (side === 'right' ? 0.34 : -0.34) + offset[1], 0.5)` in a group at
    /// `(mod.x + .5, mod.y + .5, mod.z)`; `sim/psdEnds.ts:snapPsdEndCover` saves the row at
    /// `support.z + 1 + psdFullHeight(storey)` = four metres above its support. The promoted
    /// `PsdEndCover` panel is centred on its own pivot, so it must be placed at that panel
    /// centre before `PlanExtentsMatch` is allowed to accept it.
    /// </summary>
    [Test]
    public void CoverCoursesSitOnTheirSavedSpanAndNeverBelowIt() {
        BuildAll(Root("RCA 15 covers"));
        var covers = new[] { "psd-end-cover-4079", "psd-end-cover-4286" };
        foreach (var id in covers) {
            var cover = View(Set(), id);
            var module = zoo.Document.Modules.First(candidate => candidate.Id == id);
            var support = zoo.Document.Modules.First(candidate => candidate.Id == module.Config.Text("support"));
            Assert.AreEqual(OpeningKind.PsdCover, cover.Kind, id);
            // Saved Z and support: the row is four metres above the edge it caps.
            Assert.AreEqual(support.Z + 4, module.Z, id + " saved Z is not support.z + 1 + psdFullHeight(5)");
            var holder = StationCoordinates.WorldToDocument(cover.Holder.position);
            AssertNear(id + " holder datum", module.Z, holder.z, 1e-3f);
            // The cover's course and the opening datum are separate quantities: the course
            // starts at the support's top, the holder sits at the cover record's own elevation.
            AssertNear(id + " cover base is the support top", support.Z + 4f, module.Z + 0f, 1e-3f);

            var panel = cover.Part("psd-cover-panel");
            Assert.IsNotNull(panel, id + " must name its cover panel: " + cover.Describe());
            Assert.AreEqual(OpeningModuleViews.PsdCoverPrefabKey, cover.ViewKey, id + " lost the prefab: " + cover.Diagnostic);
            Assert.AreEqual(OpeningPartRole.Cover, panel.Role);
            // Measured in the holder frame: the box is 1 x 0.24 x 1 with its base at the
            // record's own elevation and its face on the left screen line.
            AssertNear(id + " width", 1f, panel.Local.size.x, .02f);
            AssertNear(id + " depth", .24f, panel.Local.size.z, .02f);
            AssertNear(id + " base", 0f, panel.Local.min.y, .02f);
            AssertNear(id + " top", 1f, panel.Local.max.y, .02f);
            AssertNear(id + " across", -.34f, panel.Local.center.z, .02f);
            // The actual prefab offset: the promoted course already bakes the source's panel
            // centre at source (0, −0.34, 0.5) — the left-bank course with its pivot at the
            // course base — so the saved cover needs no correction at all. A right-bank cover
            // or a `cfg.offset` moves it, and that shift is what `PrefabOffset` records.
            AssertPose(id + " prefab offset", Vector3.zero, panel.PrefabOffset, 1e-4f);
            // And in document space the course occupies exactly its saved metre.
            AssertNear(id + " doc base", module.Z, panel.Document.min.z, .02f);
            AssertNear(id + " doc top", module.Z + 1f, panel.Document.max.z, .02f);
        }
        // The run's own fascia top lands on the same course base: the cover stacks on it.
        var run = View(Set(), "edge-track-1-left");
        var supportEdge = zoo.Document.Modules.First(candidate => candidate.Id == "edge-track-1-left");
        AssertNear("run top is the course base", supportEdge.Z + 4f, run.Part("psd-fascia-cap").Document.max.z, .05f);
    }

    /// <summary>
    /// The cover acceptance rule: plan extents alone are not enough (RCA 15 §5). A prefab whose
    /// course does not sit on `[0, 1]` in the holder frame is refused, and the refusal names the
    /// measured span.
    /// </summary>
    [Test]
    public void ACoverPrefabIsRejectedWhenItsVerticalSpanMissesTheSavedCourse() {
        var holder = Root("RCA 15 cover rule");
        var prefab = GameObject.CreatePrimitive(PrimitiveType.Cube);
        roots.Add(prefab);
        prefab.transform.SetParent(holder, false);
        prefab.transform.localScale = new Vector3(1f, .5f, .24f);
        prefab.transform.localPosition = new Vector3(0f, .25f, -.34f);
        // The plan extents are right, so the old check would have accepted it.
        Assert.IsTrue(OpeningModuleViews.PlanExtentsMatch(prefab, holder, 1f, .24f),
            "the plan extents alone must still match, or this test proves nothing");
        Assert.IsFalse(OpeningModuleViews.PlanExtentsMatch(prefab, holder, 1f, .24f, 1f, out var diagnostic),
            "a half-height course must not be accepted as a 1 m cover");
        StringAssert.Contains("vertical", diagnostic, "the refusal must say which quantity failed: " + diagnostic);
        StringAssert.Contains("0.5", diagnostic, "the refusal must report the measured span: " + diagnostic);

        prefab.transform.localScale = new Vector3(1f, 1f, .24f);
        prefab.transform.localPosition = new Vector3(0f, .5f, -.34f);
        Assert.IsTrue(OpeningModuleViews.PlanExtentsMatch(prefab, holder, 1f, .24f, 1f, out var accepted),
            "a 1 m course on the saved span must be accepted: " + accepted);
        Assert.AreEqual("", accepted);
    }

    /* ------------------------------------- RCA 15 §5: the printed header band */

    /// <summary>
    /// `PsdModel.buildPsd` cuts the full-height fascia into printed panels: a **station** panel
    /// over every doorway (exactly its clear width) and **route** panels over the fixed spans
    /// before, between and after them. `PsdHeader.ts:psdHeaderInfo` decides what they print —
    /// the platform's own direction, its terminus and next station, the station's committed
    /// name and the line's ink. Zoo's two Line 5 runs face opposite ways, which is what pins
    /// the direction.
    /// </summary>
    [Test]
    public void TheRunEmitsPlatformFacingHeaderSlotsForBothLineDirections() {
        BuildAll(Root("RCA 15 headers"));
        var line = zoo.Document.Lines.First(candidate => candidate.Id == "5");
        var up = View(Set(), "edge-track-1-left");
        var down = View(Set(), "edge-track-5-left");

        Assert.AreEqual("up", up.Header.Direction, "edge-track-1-left is the up platform");
        Assert.AreEqual("down", down.Header.Direction, "edge-track-5-left is the down platform");
        // `psdHeaderInfo`: `destination = (down ? line.downTerminus : line.upTerminus)` and the
        // station plaque prints the next station, both with their English lines.
        Assert.AreEqual(line.UpTerminus, up.Header.Destination, "the up platform prints the up terminus");
        Assert.AreEqual("Wenchong", up.Header.DestinationEn);
        Assert.AreEqual(OpeningModuleViews.LineText(line, "upNextStation"), up.Header.Adjacent,
            "the station plaque prints the next station");
        Assert.AreEqual("Yangji", up.Header.AdjacentEn);
        Assert.AreEqual(line.DownTerminus, down.Header.Destination, "the down platform prints the down terminus");
        Assert.AreEqual("Jiaokou", down.Header.DestinationEn);
        Assert.AreEqual(OpeningModuleViews.LineText(line, "downNextStation"), down.Header.Adjacent);
        Assert.AreEqual("Ouzhuang", down.Header.AdjacentEn);
        Assert.AreNotEqual(up.Header.Destination, down.Header.Destination, "the two platforms must not print one terminus");
        // The committed station name and the line's ink.
        Assert.AreEqual(zoo.Document.Name, up.Header.StationName);
        Assert.AreEqual("Zoo", up.Header.StationNameEn);
        Assert.AreEqual(line.Colour, up.Header.Colour);
        Assert.IsFalse(up.Header.Terminal, "Zoo is not its own terminus");
        // `arrow = (down ? -1 : 1) × (cfg.side === 'right' ? 1 : -1)`; both runs are left bank.
        Assert.AreEqual(-1, up.Header.Arrow);
        Assert.AreEqual(1, down.Header.Arrow);
        // The request key covers painted data, so two directions cannot share pixels.
        Assert.AreNotEqual(up.HeaderKey, down.HeaderKey, "the two directions print different panels");
        Assert.AreEqual(up.Header.ContentKey, up.HeaderKey);

        // Eighteen doorways: one station panel each, and one route panel more than there are
        // doorways (before, between and after them).
        Assert.AreEqual(RunOpenings, up.HeaderCount(PsdHeaderKind.Station), "station panels: " + up.Describe());
        Assert.AreEqual(RunOpenings + 1, up.HeaderCount(PsdHeaderKind.Route), "route panels: " + up.Describe());
        Assert.AreEqual(0, up.HeaderCount(PsdHeaderKind.HalfSticker), "a full-height screen prints no sticker");

        for (int i = 0; i < RunOpenings; i++) {
            var slot = up.StationHeader(i);
            var opening = up.Run.Openings[i];
            Assert.AreEqual(i, slot.OpeningIndex, "station panel " + i + " is over the wrong doorway");
            AssertNear("station panel width " + i, opening.Width, slot.Width, 1e-3f);
            AssertNear("station panel centre " + i, opening.Centre, slot.Centre, 1e-3f);
            // `plate(g, mat, b - a, headerH, …, yWall - toward * 0.13, headerZ, platYaw)`.
            AssertNear("panel height " + i, OpeningModuleViews.PsdHeaderHeight, slot.Height, 1e-3f);
            AssertNear("panel mid " + i, 3.65f, slot.Mid, 1e-3f);
            AssertNear("panel plane " + i, -.21f, slot.Across, 1e-3f);
            Assert.AreEqual(1f, slot.Facing, "the printed face looks away from the track");
            Assert.AreEqual(1024, slot.Pixels, "a single panel is 1024 x PSD_HEADER_PIXELS");
            Assert.AreEqual(OpeningModuleViews.PsdHeaderKey(up.Header, PsdHeaderKind.Station), slot.Key);
            Assert.IsTrue(slot.Node, "a slot without a node cannot be painted");
        }

        // The slots tile the run end to end and alternate route / station.
        var ordered = up.Headers.OrderBy(slot => slot.Start).ToList();
        AssertNear("the band starts at the run", up.Run.RunStart, ordered[0].Start, 1e-3f);
        AssertNear("the band ends at the run", up.Run.End, ordered[ordered.Count - 1].End, 1e-3f);
        for (int i = 1; i < ordered.Count; i++)
            AssertNear("slot " + i + " must abut its neighbour", ordered[i - 1].End, ordered[i].Start, 1e-4f);
        for (int i = 0; i < ordered.Count; i++)
            Assert.AreEqual(i % 2 == 0 ? PsdHeaderKind.Route : PsdHeaderKind.Station, ordered[i].Kind,
                "slot " + i + " breaks the route/station alternation");

        // Viewed from the platform the panels face away from the rail: the slot's forward is
        // the printed normal, and the rail is on the screen's own side.
        var track = zoo.Document.Modules.First(candidate => candidate.Id == up.TrackId);
        var trackPoint = StationCoordinates.Point(new Vector3(track.X + .5f, track.Y + .5f, track.Z));
        var toTrack = trackPoint - up.Holder.position;
        toTrack.y = 0f;
        var printed = ordered[0].Node.TransformDirection(Vector3.forward);
        Assert.Less(Vector3.Dot(printed.normalized, toTrack.normalized), -.9f,
            "the printed face must look away from the track (dot " + Vector3.Dot(printed.normalized, toTrack.normalized) + ")");
        Assert.Less(Mathf.Abs(Vector3.Dot(printed.normalized, Vector3.up)), .05f,
            "the printed face must be vertical, not tipped");
        // Nothing paints the slots yet, and the view says so by name.
        StringAssert.Contains("psd-header-artwork-unported", up.Diagnostic, up.Diagnostic);
    }

    /// <summary>
    /// The half-height variant: `buildPsd` moves the top band down onto the glass, so every
    /// fixed pane carries one paired sticker (`psdHeaderInfo` for both prints, 2048 x 256
    /// canvas) inset by 0.12 m per side, capped at 2.8 m wide and skipped below 0.7 m. The
    /// fixture is a two-bay run, so the sticker arithmetic is exercised on spans the shipped
    /// Zoo save does not contain.
    /// </summary>
    [Test]
    public void AHalfHeightRunPrintsOneStickerPerFixedPanel() {
        // Two 1.4 m doorways at 2 m and 6 m in a 10 m run: [-0.5, 1.3], [2.7, 5.3], [6.7, 9.5].
        // The fixture is a **right-bank** run, so the printed faces look toward source −y and
        // the wall line is the other side of the cell.
        var layout = new PsdRunLayout {
            Length = 10f, RunStart = -.5f, Left = false, WallOffset = .34f, FixedFrameDepth = .10f, GlassMid = 2.4f,
        };
        layout.Openings.Add(new PsdOpening { Index = 0, Centre = 2f, Width = 1.4f, Travel = .7f, LeafWidth = .9f });
        layout.Openings.Add(new PsdOpening { Index = 1, Centre = 6f, Width = 1.4f, Travel = .7f, LeafWidth = .9f });
        layout.Panels.Add(new Vector2(-.5f, 1.3f));
        layout.Panels.Add(new Vector2(2.7f, 5.3f));
        layout.Panels.Add(new Vector2(6.7f, 9.5f));
        var plan = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
            ModuleId = "two-bay", Type = "platform-edge", Dir = "down", Side = "right",
            LineId = "9", LineColour = "#123456", StationName = "Fixture", StationNameEn = "Fixture",
            DownTerminus = "Far", DownTerminusEn = "Far", DownNextStation = "Near", DownNextStationEn = "Near",
        });
        Assert.AreEqual("down", plan.Direction);
        Assert.AreEqual(-1, plan.Arrow, "down on the right bank: `(down ? -1 : 1) x (right ? 1 : -1)`");

        var slots = new List<PsdHeaderSlot>();
        OpeningModuleViews.EmitHeaderSlots(null, layout, true, slots, plan);
        Assert.AreEqual(3, slots.Count, "one sticker per fixed pane");
        var widths = new[] { 1.8f - .24f, 2.6f - .24f, 2.8f - .24f };
        for (int i = 0; i < slots.Count; i++) {
            var slot = slots[i];
            Assert.AreEqual(PsdHeaderKind.HalfSticker, slot.Kind);
            Assert.AreEqual(-1, slot.OpeningIndex);
            // The slot is the **printed plate**, inset from the panel's mullions and centred.
            AssertNear("sticker width " + i, widths[i], slot.Width, 1e-3f);
            AssertNear("sticker centre " + i, (layout.Panels[i].x + layout.Panels[i].y) * .5f, slot.Centre, 1e-4f);
            AssertNear("sticker span start " + i, slot.Centre - widths[i] * .5f, slot.Start, 1e-4f);
            AssertNear("sticker span end " + i, slot.Centre + widths[i] * .5f, slot.End, 1e-4f);
            AssertNear("sticker print height " + i, widths[i] * (256f / 2048f), slot.Height, 1e-4f);
            AssertNear("sticker mid " + i, layout.GlassMid, slot.Mid, 1e-4f);
            AssertNear("sticker plane " + i, .34f - (.10f * .5f + .002f), slot.Across, 1e-4f);
            Assert.AreEqual(-1f, slot.Facing, "a right-bank screen faces source −y");
            Assert.AreEqual(2048, slot.Pixels, "the paired sticker canvas is 2048 x 256");
            Assert.AreEqual(OpeningModuleViews.PsdHeaderKey(plan, PsdHeaderKind.HalfSticker), slot.Key);
        }

        // The same fixture full height: the band alternates, station panels on the doorways.
        var full = new List<PsdHeaderSlot>();
        OpeningModuleViews.EmitHeaderSlots(null, layout, false, full, plan);
        Assert.AreEqual(2, full.Count(slot => slot.Kind == PsdHeaderKind.Station));
        Assert.AreEqual(3, full.Count(slot => slot.Kind == PsdHeaderKind.Route));
        foreach (var slot in full.Where(slot => slot.Kind == PsdHeaderKind.Station)) {
            var opening = layout.Openings[slot.OpeningIndex];
            AssertNear("full-height station panel width", opening.Width, slot.Width, 1e-4f);
            AssertNear("full-height station panel centre", opening.Centre, slot.Centre, 1e-4f);
        }
        foreach (var slot in full.Where(slot => slot.Kind == PsdHeaderKind.Route)) {
            AssertNear("full-height route panel height", OpeningModuleViews.PsdHeaderHeight, slot.Height, 1e-4f);
            AssertNear("full-height route panel across", .34f - .13f, slot.Across, 1e-4f);
            Assert.AreEqual(-1f, slot.Facing, "a right-bank screen prints toward source −y");
        }
    }

    /// <summary>The request key must move with the painted data and only with it.</summary>
    [Test]
    public void TheHeaderKeyCoversPaintedDataAndIgnoresGeometry() {
        var request = new OpeningModuleViews.OpeningRequest {
            ModuleId = "key", Type = "platform-edge", Dir = "up", Side = "left", LineId = "5",
            LineColour = "#c70541", StationName = "Zoo", StationNameEn = "Zoo",
            UpTerminus = "Wenchong", UpNextStation = "Yangji",
        };
        var before = OpeningModuleViews.PsdHeaderFor(request);
        Assert.AreEqual("Wenchong", before.Destination);
        Assert.AreEqual(-1, before.Arrow, "an up platform on the left bank points the other way");

        // A geometry-only change (the module moved) leaves the pixels alone.
        var moved = request;
        moved.X += 40;
        moved.Width = 61;
        Assert.AreEqual(before.ContentKey, OpeningModuleViews.PsdHeaderFor(moved).ContentKey,
            "moving a panel must not re-render it");

        // Any painted field changes the key.
        var changes = new (string what, Func<OpeningModuleViews.OpeningRequest, OpeningModuleViews.OpeningRequest> apply)[] {
            ("ink", next => { next.LineColour = "#000000"; return next; }),
            ("terminus", next => { next.UpTerminus = "Other"; return next; }),
            ("next station", next => { next.UpNextStation = "Other"; return next; }),
            ("station name", next => { next.StationName = "Other"; return next; }),
            ("station name (en)", next => { next.StationNameEn = "Other"; return next; }),
            ("direction", next => { next.Dir = "down"; next.DownTerminus = "Other"; return next; }),
            ("bank", next => { next.Side = "right"; return next; }),
        };
        foreach (var change in changes) {
            var changed = change.apply(request);
            Assert.AreNotEqual(before.ContentKey, OpeningModuleViews.PsdHeaderFor(changed).ContentKey,
                "the painted field '" + change.what + "' changed without moving the key");
        }
        // A terminal plaque suppresses the arrow, so it is painted data too.
        var terminal = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
            Dir = "up", Side = "left", LineId = "5", StationName = "Wenchong", UpTerminus = "Wenchong",
        });
        Assert.IsTrue(terminal.Terminal, "the platform's terminus is the station itself");
        Assert.AreNotEqual(before.ContentKey, terminal.ContentKey);
    }

    /* ---------------------------------- RCA 15 §5: the painted header transport */

    /// <summary>
    /// One bridge rig: the real `PsdHeaderWebProvider` capturing every published request,
    /// and a cache over it. Painted replies are fed through the provider exactly as the
    /// page's `psd.headerReady` / `psd.headerChunk` commands arrive in the player.
    /// </summary>
    sealed class HeaderRig : IDisposable {
        public readonly List<string> Sent = new List<string>();
        public readonly PsdHeaderWebProvider Provider;
        public readonly PsdHeaderTextureCache Cache;

        public HeaderRig(Material template, string session = "header-session", int revision = 7) {
            Provider = new PsdHeaderWebProvider(
                json => { Sent.Add(json); return true; },
                () => new PsdHeaderContext { SessionId = session, Revision = revision });
            Cache = new PsdHeaderTextureCache(Provider, template);
        }

        public JObject Envelope(int index = 0) => JObject.Parse(Sent[index]);
        public string RequestId(int index = 0) => (string)Envelope(index)["payload"]["requestId"];
        public JArray Panels(int index = 0) => (JArray)Envelope(index)["payload"]["panels"];

        /// <summary>Feed one complete reply: two chunks per panel, then the ready frame.</summary>
        public void Reply(string requestId, byte[] png, IEnumerable<JObject> panels,
            int revision = 7, string session = "header-session") {
            var base64 = Convert.ToBase64String(png);
            int split = base64.Length / 2;
            var painted = new JArray();
            foreach (var panel in panels) {
                var key = (string)panel["key"];
                var kind = (string)panel["kind"];
                int pixels = (int)panel["pixels"];
                for (int index = 0; index < 2; index++) {
                    Provider.Receive(new JObject {
                        ["schemaVersion"] = 2, ["type"] = "psd.headerChunk", ["id"] = "chunk",
                        ["sessionId"] = session,
                        ["payload"] = new JObject {
                            ["requestId"] = requestId, ["revision"] = revision, ["sessionId"] = session,
                            ["key"] = key, ["moduleId"] = (string)panel["moduleId"], ["kind"] = kind,
                            ["width"] = pixels, ["height"] = PsdHeaderPanel.PixelHeight,
                            ["index"] = index, ["count"] = 2,
                            ["data"] = index == 0 ? base64.Substring(0, split) : base64.Substring(split),
                        },
                    }.ToString(Formatting.None));
                }
                painted.Add(new JObject {
                    ["key"] = key, ["moduleId"] = (string)panel["moduleId"], ["kind"] = kind,
                    ["width"] = pixels, ["height"] = PsdHeaderPanel.PixelHeight,
                    ["chunks"] = 2, ["bytes"] = png.Length,
                });
            }
            Provider.Receive(new JObject {
                ["schemaVersion"] = 2, ["type"] = "psd.headerReady", ["id"] = "ready",
                ["sessionId"] = session,
                ["payload"] = new JObject {
                    ["requestId"] = requestId, ["revision"] = revision, ["sessionId"] = session,
                    ["artReady"] = true, ["painted"] = painted, ["pending"] = new JArray(),
                },
            }.ToString(Formatting.None));
        }

        public void Dispose() => Cache.Dispose();
    }

    /// <summary>A real PNG of the right panel size with the source's ink: a colour bar on paper.</summary>
    static byte[] HeaderPng(int width, int height = PsdHeaderPanel.PixelHeight) {
        var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
        var paper = new Color32(244, 246, 248, 255);
        var ink = new Color32(199, 5, 65, 255);
        var pixels = new Color32[width * height];
        for (int i = 0; i < pixels.Length; i++) pixels[i] = paper;
        for (int y = 0; y < 22; y++)
            for (int x = 0; x < width; x++) pixels[y * width + x] = ink;
        texture.SetPixels32(pixels);
        texture.Apply();
        var png = texture.EncodeToPNG();
        UnityEngine.Object.DestroyImmediate(texture);
        return png;
    }

    static JObject HeaderPanelOf(JArray panels, string moduleId, PsdHeaderKind kind) {
        var name = PsdHeaderVocabulary.Kind(kind);
        foreach (var token in panels) {
            if (!(token is JObject panel)) continue;
            if ((string)panel["moduleId"] == moduleId && (string)panel["kind"] == name) return panel;
        }
        Assert.Fail("no " + name + " panel for " + moduleId);
        return null;
    }

    static MeshRenderer HeaderQuad(PsdHeaderSlot slot) {
        Assert.IsTrue(slot.Node, "a slot without a posed node cannot be printed: " + slot);
        var quad = slot.Node.Find("psd-header-print");
        Assert.IsNotNull(quad, "no printed quad on " + slot);
        return quad.GetComponent<MeshRenderer>();
    }

    /// <summary>
    /// RCA 15 §5 sub-item 2's request half. The two Line 5 runs mint **one panel per painted
    /// key** — eighteen station panels share the station print, nineteen route spans share the
    /// route print, and the two directions print different termini — each carrying the resolved
    /// `psdHeaderInfo` fields, the kind, the canvas width, the printed metres and the run id.
    /// Every slot gets one quad at its slot node, sized to the printed plane and readable from
    /// the platform (never from the track).
    /// </summary>
    [Test]
    public void TheRunsMintOneHeaderRequestForThePaintedPanelsAndPoseEveryQuad() {
        BuildAll(Root("RCA 15 header transport"));
        var up = View(Set(), "edge-track-1-left");
        var down = View(Set(), "edge-track-5-left");
        var template = new Material(shader);
        try {
            using (var rig = new HeaderRig(template)) {
                int slots = 0;
                foreach (var view in new[] { up, down }) {
                    foreach (var slot in view.Headers) {
                        var binding = rig.Cache.Bind(view, slot);
                        Assert.IsNotNull(binding, "every minted slot must get a printed quad: " + slot);
                        slots++;
                    }
                }
                Assert.AreEqual(RunOpenings * 2 + (RunOpenings + 1) * 2, slots, "36 station + 38 route slots");
                Assert.AreEqual(up.Headers.Count + down.Headers.Count, rig.Cache.SlotCount);

                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Sent.Count, "seventy-four slots share four painted panels: one bounded request");
                var envelope = rig.Envelope();
                Assert.AreEqual(2, (int)envelope["schemaVersion"], "the v2 envelope discipline");
                Assert.AreEqual("psdHeaderRequest", (string)envelope["kind"]);
                Assert.AreEqual("psd.requestHeader", (string)envelope["type"]);
                Assert.AreEqual("header-session", (string)envelope["sessionId"]);
                Assert.AreEqual(7, (int)envelope["revision"], "the requesting revision rides the envelope");

                var panels = rig.Panels();
                Assert.AreEqual(4, panels.Count, "one panel per painted key, not one per slot");
                var upStation = HeaderPanelOf(panels, up.ModuleId, PsdHeaderKind.Station);
                var upRoute = HeaderPanelOf(panels, up.ModuleId, PsdHeaderKind.Route);
                var downStation = HeaderPanelOf(panels, down.ModuleId, PsdHeaderKind.Station);
                var downRoute = HeaderPanelOf(panels, down.ModuleId, PsdHeaderKind.Route);
                Assert.AreEqual((int)upStation["slots"], RunOpenings, "the doorways share one station print");
                Assert.AreEqual((int)upRoute["slots"], RunOpenings + 1, "the fixed spans share one route print");
                Assert.AreEqual(1024, (int)upStation["pixels"]);

                var upStationSlot = up.Headers.First(slot => slot.Kind == PsdHeaderKind.Station);
                var upRouteSlot = up.Headers.First(slot => slot.Kind == PsdHeaderKind.Route);
                Assert.AreEqual(upStationSlot.Key, (string)upStation["key"]);
                Assert.AreEqual(OpeningModuleViews.PsdHeaderKey(up.Header, PsdHeaderKind.Station), (string)upStation["key"],
                    "the panel key is the painted data plus the panel kind");
                AssertNear("request station width", upStationSlot.Width, (float)upStation["width"], 1e-3f);
                AssertNear("request route width", upRouteSlot.Width, (float)upRoute["width"], 1e-3f);
                AssertNear("request height", upStationSlot.Height, (float)upStation["height"], 1e-3f);
                // The painted fields `drawPsdHeader` reads.
                Assert.AreEqual(up.Header.LineId, (string)upStation["lineId"]);
                Assert.AreEqual(up.Header.Colour, (string)upStation["colour"]);
                Assert.AreEqual("up", (string)upStation["direction"]);
                Assert.AreEqual(zoo.Document.Name, (string)upStation["stationName"]);
                Assert.AreEqual("Zoo", (string)upStation["stationNameEn"]);
                Assert.AreEqual(up.Header.Destination, (string)upStation["destination"]);
                Assert.AreEqual(up.Header.DestinationEn, (string)upStation["destinationEn"]);
                Assert.AreEqual(up.Header.Adjacent, (string)upStation["adjacent"]);
                Assert.AreEqual(up.Header.Terminal, (bool)upStation["terminal"]);
                Assert.AreEqual(up.Header.Arrow, (int)upStation["arrow"]);
                // The two directions are distinct pictures and distinct keys.
                Assert.AreEqual("down", (string)downStation["direction"]);
                Assert.AreEqual(down.Header.Destination, (string)downStation["destination"]);
                Assert.AreNotEqual((string)upStation["destination"], (string)downStation["destination"],
                    "the two Line 5 platforms must not print one terminus");
                Assert.AreNotEqual((string)upStation["key"], (string)downStation["key"]);
                Assert.AreNotEqual((string)upRoute["key"], (string)downRoute["key"]);

                // Every slot has a quad sized to the printed plane and readable from the platform.
                var track = zoo.Document.Modules.First(candidate => candidate.Id == up.TrackId);
                var trackPoint = StationCoordinates.Point(new Vector3(track.X + .5f, track.Y + .5f, track.Z));
                var toTrack = trackPoint - up.Holder.position;
                toTrack.y = 0f;
                toTrack.Normalize();
                foreach (var slot in up.Headers) {
                    var renderer = HeaderQuad(slot);
                    var quad = renderer.transform;
                    AssertNear("quad width " + slot, slot.Width, quad.localScale.x, 1e-4f);
                    AssertNear("quad height " + slot, slot.Height, quad.localScale.y, 1e-4f);
                    var mesh = quad.GetComponent<MeshFilter>().sharedMesh;
                    Assert.Greater(Vector3.Dot(mesh.normals[0], Vector3.forward), .99f,
                        "the sheet's readable side is its local +z");
                    // Upright, and U runs toward local −x: (1,0) sits on the bottom-left corner
                    // and (0,1) on the top-right, so the canvas's top row prints at the top of
                    // the band (Unity maps a loaded PNG's top row to v = 1) and its left column
                    // prints on the platform viewer's left (RCA 16 §3.1).
                    Assert.AreEqual(new Vector2(1f, 0f), mesh.uv[0], "uv bottom-left " + slot);
                    Assert.AreEqual(new Vector2(0f, 0f), mesh.uv[1], "uv bottom-right " + slot);
                    Assert.AreEqual(new Vector2(0f, 1f), mesh.uv[2], "uv top-right " + slot);
                    Assert.AreEqual(new Vector2(1f, 1f), mesh.uv[3], "uv top-left " + slot);
                    Assert.Less(mesh.vertices[0].y, mesh.vertices[2].y, "the sheet must not be upside down");
                    var printed = quad.TransformDirection(Vector3.forward).normalized;
                    Assert.Less(Vector3.Dot(printed, toTrack), -.9f,
                        "the print must look away from the track (dot " + Vector3.Dot(printed, toTrack) + ")");
                    Assert.Less(Mathf.Abs(Vector3.Dot(printed, Vector3.up)), .05f, "the print must be vertical");
                    var material = renderer.sharedMaterial;
                    Assert.IsNotNull(material, "a printed slot must own a material");
                    Assert.IsNull(material.GetTexture("_BaseMap"), "an unpainted slot must not show a white sheet");
                }
                StringAssert.Contains("psd-header-artwork:pending:0/", up.Diagnostic,
                    "the run names the pixels it is waiting for: " + up.Diagnostic);
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /// <summary>
    /// The reply half: the assembled PNG is uploaded once per key, every bound slot switches to
    /// it, and the cache reports the painted pixels — the seam the browser verifier reads as
    /// `state.psd.headers.served` and the nonzero ink that proves the band is not blank.
    /// </summary>
    [Test]
    public void ThePaintedPanelsUploadOncePerKeyAndEverySlotShowsThem() {
        BuildAll(Root("RCA 15 header pixels"));
        var up = View(Set(), "edge-track-1-left");
        var down = View(Set(), "edge-track-5-left");
        var template = new Material(shader);
        try {
            using (var rig = new HeaderRig(template)) {
                foreach (var view in new[] { up, down })
                    foreach (var slot in view.Headers) Assert.IsNotNull(rig.Cache.Bind(view, slot));
                rig.Cache.Pump();
                var panels = rig.Panels();
                rig.Reply(rig.RequestId(), HeaderPng(1024), panels.OfType<JObject>());
                rig.Cache.Pump();

                Assert.AreEqual(0, rig.Cache.PendingCount, "every panel answered");
                Assert.AreEqual(4, rig.Cache.TextureCount, "route + station for each direction, one texture each");
                Assert.AreEqual(74, rig.Cache.ServedCount);
                Assert.Greater(rig.Cache.MinInk, .05f,
                    "a blank band would report no ink; the uploaded pixels carry the source's colour bar");
                StringAssert.Contains("psd-header-artwork:served:37", up.Diagnostic);
                StringAssert.Contains("psd-header-artwork:served:37", down.Diagnostic);

                // Slots that share a key share the texture; a different panel is a different one.
                var routeQuads = up.Headers.Where(slot => slot.Kind == PsdHeaderKind.Route)
                    .Select(slot => HeaderQuad(slot)).ToList();
                var routeTexture = routeQuads[0].sharedMaterial.GetTexture("_BaseMap");
                Assert.IsNotNull(routeTexture, "a served quad must carry the painted base map");
                Assert.AreSame(routeTexture, routeQuads[routeQuads.Count - 1].sharedMaterial.GetTexture("_BaseMap"),
                    "every route span of a run shares one upload");
                var stationTexture = HeaderQuad(up.StationHeader(0)).sharedMaterial.GetTexture("_BaseMap");
                Assert.AreNotSame(routeTexture, stationTexture, "a station panel is not the route panel");
                Assert.AreEqual(1024, stationTexture.width);
                Assert.AreEqual(PsdHeaderPanel.PixelHeight, stationTexture.height);

                var report = rig.Cache.Report();
                Assert.AreEqual(74, (int)report["slots"]);
                Assert.AreEqual(74, (int)report["served"]);
                Assert.AreEqual(4, (int)report["textures"]);
                Assert.AreEqual(0, (int)report["pending"]);
                Assert.AreEqual(0, (int)report["unported"]);
                Assert.AreEqual(4, ((JArray)report["panels"]).Count);
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /// <summary>
    /// The half-height fixture: `buildPsd` moves the top band down onto the glass and prints one
    /// paired 2048-px sticker per fixed pane. The request must ask for the 2048 canvas and the
    /// quad must be the printed plate (`sw × sw × 256/2048`), not the whole pane.
    /// </summary>
    [Test]
    public void AHalfHeightRunRequestsThePairedStickerAt2048Pixels() {
        var parent = Root("RCA 15 half header");
        var palette = new OpeningPalette(shader);
        palettes.Add(palette);
        var request = new OpeningModuleViews.OpeningRequest {
            ModuleId = "half-fixture", Type = "platform-edge", Width = 10, Depth = 1,
            Rotation = 0, Side = "right", Psd = "half", StoreyHeight = 5, Dir = "down",
            LineId = "9", LineColour = "#123456", HasLine = true, Stock = "B", Cars = 2, ModelScale = 1f,
            StationName = "Fixture", StationNameEn = "Fixture",
            DownTerminus = "Far", DownTerminusEn = "Far",
            DownNextStation = "Near", DownNextStationEn = "Near",
        };
        var facts = new ModuleFacts { Id = "half-fixture", Type = "platform-edge", Width = 10, Depth = 1 };
        Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue, parent, palette, out var view),
            view.Diagnostic);
        Assert.AreEqual(OpeningKind.PsdRun, view.Kind);
        Assert.Greater(view.Headers.Count, 0, "the half screen must print at least one sticker: " + view.Diagnostic);
        Assert.AreEqual(view.Headers.Count, view.HeaderCount(PsdHeaderKind.HalfSticker));
        foreach (var slot in view.Headers) {
            Assert.AreEqual(2048, slot.Pixels, "the paired sticker canvas is 2048 x 256");
            AssertNear("sticker print height", slot.Width * (256f / 2048f), slot.Height, 1e-4f);
        }

        var template = new Material(shader);
        try {
            using (var rig = new HeaderRig(template)) {
                foreach (var slot in view.Headers) Assert.IsNotNull(rig.Cache.Bind(view, slot));
                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Sent.Count, "one sticker panel for the run");
                var panels = rig.Panels();
                Assert.AreEqual(1, panels.Count);
                var panel = (JObject)panels[0];
                Assert.AreEqual(2048, (int)panel["pixels"]);
                Assert.AreEqual("sticker", (string)panel["kind"]);
                var slot0 = view.Headers[0];
                AssertNear("request sticker width", slot0.Width, (float)panel["width"], 1e-4f);

                rig.Reply(rig.RequestId(), HeaderPng(2048), new[] { panel });
                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Cache.TextureCount);
                var texture = HeaderQuad(slot0).sharedMaterial.GetTexture("_BaseMap");
                Assert.IsNotNull(texture, "the sticker's pixels must bind to its quad");
                Assert.AreEqual(2048, texture.width);
                Assert.AreEqual(PsdHeaderPanel.PixelHeight, texture.height);
                StringAssert.Contains("psd-header-artwork:served:", view.Diagnostic);
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /// <summary>
    /// A line-information edit changes the painted plan, so the run must re-key and reprint —
    /// while a geometry-only move leaves the key alone (the existing
    /// `TheHeaderKeyCoversPaintedDataAndIgnoresGeometry` pin). The superseded panel's pixels are
    /// retired, not left beside the new request.
    /// </summary>
    [Test]
    public void AChangedHeaderPlanReKeysAndRepaintsThePanel() {
        BuildAll(Root("RCA 15 header rekey"));
        var up = View(Set(), "edge-track-1-left");
        var template = new Material(shader);
        try {
            using (var rig = new HeaderRig(template)) {
                var slot = up.StationHeader(0);
                var binding = rig.Cache.Bind(up, slot);
                Assert.IsNotNull(binding);
                rig.Cache.Pump();
                rig.Reply(rig.RequestId(), HeaderPng(1024), rig.Panels().OfType<JObject>());
                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Cache.TextureCount);
                Assert.IsTrue(binding.HasTexture);
                var oldKey = binding.Key;
                int sent = rig.Sent.Count;

                // The line's ink changed (a line-information edit), so the panel is new pixels.
                up.Header.Colour = "#000000";
                Assert.AreNotEqual(oldKey, OpeningModuleViews.PsdHeaderKey(up.Header, PsdHeaderKind.Station));
                Assert.AreEqual(1, rig.Cache.RefreshHeaderKeys(up), "the changed plan must re-key the slot");
                Assert.AreNotEqual(oldKey, binding.Key);
                Assert.IsFalse(binding.HasTexture, "the superseded pixels must not stay on the slot");
                Assert.AreEqual(0, rig.Cache.TextureCount, "the old panel's texture is retired");
                Assert.AreEqual(0, rig.Cache.ServedCount);

                rig.Cache.Pump();
                Assert.AreEqual(sent + 1, rig.Sent.Count, "the new key is a new request");
                var panel = HeaderPanelOf(rig.Panels(sent), up.ModuleId, PsdHeaderKind.Station);
                Assert.AreEqual("#000000", (string)panel["colour"]);
                Assert.AreEqual(binding.Key, (string)panel["key"]);
                rig.Reply(rig.RequestId(sent), HeaderPng(1024), new[] { panel });
                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Cache.ServedCount);
                Assert.IsTrue(binding.HasTexture);
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /// <summary>
    /// No silent fallback: a slot that cannot be printed (no posed node) is counted and the view
    /// keeps a diagnostic that names the reason, and a reply from another revision or session is
    /// never painted — the fence the sign face transport also enforces.
    /// </summary>
    [Test]
    public void AnUnprintableHeaderSlotKeepsANamedDiagnosticAndStaleRepliesAreFenced() {
        BuildAll(Root("RCA 15 header fence"));
        var up = View(Set(), "edge-track-1-left");
        var template = new Material(shader);
        try {
            using (var rig = new HeaderRig(template)) {
                var orphan = new PsdHeaderSlot {
                    Kind = PsdHeaderKind.Station, Pixels = 1024, Key = "orphan", Start = 0f, End = 2f, Height = .53f,
                };
                Assert.IsNull(rig.Cache.Bind(up, orphan), "a slot with no node cannot be printed");
                Assert.AreEqual(1, rig.Cache.UnportedCount);
                OpeningModuleViews.SetHeaderArtwork(up,
                    OpeningModuleViews.HeaderArtworkUnported("no-slot-node", up.Headers.Count));
                StringAssert.Contains("psd-header-artwork-unported:no-slot-node(37 slot(s))", up.Diagnostic);
                StringAssert.Contains("decals-unported", up.Diagnostic, "the other diagnostics are preserved");
                int directives = up.Diagnostic.Split(';').Count(part => part.Trim().StartsWith("psd-header-artwork", StringComparison.Ordinal));
                Assert.AreEqual(1, directives, "exactly one header-artwork diagnostic: " + up.Diagnostic);

                var binding = rig.Cache.Bind(up, up.StationHeader(0));
                Assert.IsNotNull(binding);
                rig.Cache.Pump();
                rig.Reply(rig.RequestId(), HeaderPng(1024), rig.Panels().OfType<JObject>(), revision: 6);
                rig.Cache.Pump();
                Assert.AreEqual(0, rig.Cache.TextureCount, "a reply for an older revision is not painted");
                Assert.IsFalse(binding.HasTexture);

                // Ask again, answer from another session: still nothing.
                rig.Cache.RetryNow();
                rig.Cache.Pump();
                Assert.AreEqual(2, rig.Sent.Count, "one request was re-issued after the stale reply");
                rig.Reply(rig.RequestId(1), HeaderPng(1024), rig.Panels(1).OfType<JObject>(), session: "other-session");
                rig.Cache.Pump();
                Assert.AreEqual(0, rig.Cache.TextureCount, "a reply from another session is dropped");

                // The fence is not a dead end: the same revision + session paints.
                rig.Cache.RetryNow();
                rig.Cache.Pump();
                Assert.AreEqual(3, rig.Sent.Count);
                rig.Reply(rig.RequestId(2), HeaderPng(1024), rig.Panels(2).OfType<JObject>());
                rig.Cache.Pump();
                Assert.AreEqual(1, rig.Cache.TextureCount);
                Assert.IsTrue(binding.HasTexture);
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /* ---------------------------------- RCA 16 §3.1: the printed face direction */

    /// <summary>Repository root: the EditMode project's `Assets` folder is `unity/Assets`.</summary>
    static string RepositoryRoot() {
        var directory = new DirectoryInfo(Application.dataPath);
        while (directory != null && !File.Exists(Path.Combine(directory.FullName, "video/demo-station.metro.json")))
            directory = directory.Parent;
        return directory != null ? directory.FullName : Directory.GetCurrentDirectory();
    }

    /// <summary>
    /// The painter's LEFT/RIGHT plate: canvas x = 0 is the left half (red), canvas x = 1
    /// the right half (blue). A decoded PNG must sample canvas x at the same U, so this
    /// texture turns "which side does U = 0 land on" into a screen-space measurement.
    /// </summary>
    static byte[] LeftRightPng(int width) {
        var texture = new Texture2D(width, PsdHeaderPanel.PixelHeight, TextureFormat.RGBA32, false);
        var left = new Color32(220, 30, 40, 255);
        var right = new Color32(30, 60, 220, 255);
        var pixels = new Color32[width * texture.height];
        for (int y = 0; y < texture.height; y++)
            for (int x = 0; x < width; x++)
                pixels[y * width + x] = x < width / 2 ? left : right;
        texture.SetPixels32(pixels);
        texture.Apply();
        var png = texture.EncodeToPNG();
        UnityEngine.Object.DestroyImmediate(texture);
        return png;
    }

    /// <summary>One printed slot's screen-space reading, as a row of the orientation evidence.</summary>
    sealed class OrientationRow {
        public int Rotation;
        public string Side = "";
        public bool Half;
        public string Kind = "";
        public float Width;
        public float U0ScreenX;
        public float U1ScreenX;
        public bool Front;
        public bool TextureUpright;
        public bool Ok => Front && TextureUpright && U1ScreenX > U0ScreenX;

        public string Csv() => string.Join(",", new[] {
            Rotation.ToString(CultureInfo.InvariantCulture), Side, Half ? "half" : "full", Kind,
            Width.ToString("0.###", CultureInfo.InvariantCulture),
            U0ScreenX.ToString("0.###", CultureInfo.InvariantCulture),
            U1ScreenX.ToString("0.###", CultureInfo.InvariantCulture),
            Front ? "front" : "back", TextureUpright ? "u0=art-left" : "u0=art-right",
            Ok ? "readable" : "mirrored",
        });
    }

    /// <summary>
    /// The player's own lens (source `DEFAULT_FOV`), square on to a printed quad's readable
    /// face. A render texture gives `WorldToScreenPoint` a fixed 16:9 pixel rect in
    /// EditMode, where no game view is being presented.
    /// </summary>
    static Camera ProjectionCamera(out RenderTexture target) {
        target = new RenderTexture(640, 360, 16, RenderTextureFormat.ARGB32);
        var go = new GameObject("psd orientation camera");
        var camera = go.AddComponent<Camera>();
        camera.enabled = false;
        camera.fieldOfView = StationCameraMath.DefaultFov;
        camera.nearClipPlane = StationCameraMath.PerspectiveNear;
        camera.farClipPlane = StationCameraMath.Far;
        camera.targetTexture = target;
        camera.aspect = 16f / 9f;
        return camera;
    }

    /// <summary>Stand the viewer three metres off the printed face, on the platform side.</summary>
    static void FaceFromPlatform(Camera camera, Transform quad, out Vector3 eye) {
        var centre = quad.position;
        var normal = quad.forward.normalized;
        eye = centre + normal * 3f;
        camera.transform.SetPositionAndRotation(eye, Quaternion.LookRotation(centre - eye, Vector3.up));
    }

    /// <summary>
    /// RCA 16 §3.1: the printed band must read left-to-right for a player standing on the
    /// platform, at every saved quarter turn and on the half-height sticker. The proof is
    /// a LEFT/RIGHT texture carried through the real transport (bind → request → PNG
    /// upload) and projected with the player's camera: the vertex whose U = 0 must land
    /// left of the vertex whose U = 1, and the uploaded texture's U = 0 must still be the
    /// painter's left column. `TileMeshAssert` (unity/plan/motion-inventory) is not enough:
    /// the mesh can be wound correctly and still print mirrored.
    /// </summary>
    [Test]
    public void ThePrintedHeaderReadsLeftToRightFromThePlatformForEveryRotationAndSticker() {
        var parent = Root("RCA 16 header orientation");
        var palette = new OpeningPalette(shader);
        palettes.Add(palette);
        var rows = new List<OrientationRow>();
        var template = new Material(shader);
        Camera camera = null;
        RenderTexture target = null;
        try {
            camera = ProjectionCamera(out target);
            foreach (bool half in new[] { false, true }) {
                foreach (string side in new[] { "left", "right" }) {
                    for (int rotation = 0; rotation < 4; rotation++) {
                        var id = "orientation-" + side + "-" + rotation + (half ? "-half" : "-full");
                        var facts = new ModuleFacts { Id = id, Type = "platform-edge", Width = 10, Depth = 1, Rotation = rotation };
                        var request = new OpeningModuleViews.OpeningRequest {
                            ModuleId = id, Type = "platform-edge", Width = 10, Depth = 1, Rotation = rotation,
                            Side = side, Psd = half ? "half" : "full", StoreyHeight = 5, Dir = "up",
                            LineId = "9", LineColour = "#123456", HasLine = true, Stock = "B", Cars = 2, ModelScale = 1f,
                            StationName = "Fixture", StationNameEn = "Fixture",
                            UpTerminus = "Far", UpTerminusEn = "Far", UpNextStation = "Near", UpNextStationEn = "Near",
                        };
                        Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue, parent, palette, out var view),
                            id + ": " + view.Diagnostic);
                        Assert.Greater(view.Headers.Count, 0, id + " printed no slot");
                        using (var rig = new HeaderRig(template)) {
                            foreach (var slot in view.Headers) Assert.IsNotNull(rig.Cache.Bind(view, slot), id + " slot " + slot);
                            rig.Cache.Pump();
                            var panels = rig.Panels();
                            Assert.AreEqual(1, rig.Sent.Count, id + " one bounded request");
                            int pixels = (int)panels[0]["pixels"];
                            rig.Reply(rig.RequestId(), LeftRightPng(pixels), panels.OfType<JObject>());
                            rig.Cache.Pump();
                            Assert.AreEqual(0, rig.Cache.PendingCount, id + " every panel answered");
                            foreach (var slot in view.Headers) {
                                var renderer = HeaderQuad(slot);
                                var quad = renderer.transform;
                                var row = new OrientationRow {
                                    Rotation = rotation, Side = side, Half = half,
                                    Kind = slot.Kind.ToString(), Width = slot.Width,
                                };
                                var texture = renderer.sharedMaterial.GetTexture("_BaseMap") as Texture2D;
                                Assert.IsNotNull(texture, id + " " + slot + " has no painted texture");
                                // The painter's canvas x = 0 must arrive at u = 0 (red), and its
                                // right edge at u = 1 (blue). A horizontally flipped upload would
                                // swap them, which the screen projection below cannot detect.
                                var left = texture.GetPixel(0, texture.height / 2);
                                var right = texture.GetPixel(texture.width - 1, texture.height / 2);
                                row.TextureUpright = left.r > .8f && left.b < .3f && right.b > .8f && right.r < .3f;
                                var mesh = quad.GetComponent<MeshFilter>().sharedMesh;
                                var uvs = mesh.uv;
                                var vertices = mesh.vertices;
                                int at0 = -1, at1 = -1;
                                for (int i = 0; i < uvs.Length; i++) {
                                    if (Mathf.Abs(uvs[i].x) < 1e-5f) at0 = i;
                                    else if (Mathf.Abs(uvs[i].x - 1f) < 1e-5f) at1 = i;
                                }
                                Assert.IsTrue(at0 >= 0 && at1 >= 0, id + " " + slot + " lost its U edges");
                                FaceFromPlatform(camera, quad, out var eye);
                                var normal = quad.forward.normalized;
                                row.Front = Vector3.Dot(normal, (eye - quad.position).normalized) > .99f &&
                                    Vector3.Dot(normal, camera.transform.forward) < -.99f;
                                Assert.IsTrue(TryProject(camera, quad.TransformPoint(vertices[at0]), out var x0),
                                    id + " " + slot + " u = 0 is behind the camera");
                                Assert.IsTrue(TryProject(camera, quad.TransformPoint(vertices[at1]), out var x1),
                                    id + " " + slot + " u = 1 is behind the camera");
                                row.U0ScreenX = x0;
                                row.U1ScreenX = x1;
                                rows.Add(row);
                            }
                        }
                    }
                }
            }
            var csv = new StringBuilder();
            csv.AppendLine("rotation,side,screen,kind,width_m,u0_screen_x,u1_screen_x,facing,texture,reading");
            foreach (var row in rows) csv.AppendLine(row.Csv());
            var directory = Path.Combine(RepositoryRoot(), ".preview/unity/plan16");
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "psd-header-orientation.csv"), csv.ToString(), new UTF8Encoding(false));

            // Every run the fixture covers, so a skipped rotation or sticker fails by name.
            Assert.AreEqual(16, rows.Select(row => row.Rotation + "|" + row.Side + "|" + row.Half).Distinct().Count(),
                "each of the four rotations, on both banks, full height and half height");
            Assert.IsTrue(rows.Any(row => row.Kind == PsdHeaderKind.HalfSticker.ToString()),
                "the half-height sticker is part of the evidence");
            var mirrored = rows.Where(row => !row.Ok).Select(row => row.Csv()).ToList();
            Assert.IsEmpty(mirrored, "the printed header is mirrored from the platform (" + mirrored.Count +
                " of " + rows.Count + " slots):\n" + string.Join("\n", mirrored));
        } finally {
            if (camera) UnityEngine.Object.DestroyImmediate(camera.gameObject);
            if (target) { target.Release(); UnityEngine.Object.DestroyImmediate(target); }
            UnityEngine.Object.DestroyImmediate(template);
        }
    }

    /// <summary>True when `point` projects in front of the camera; returns its screen x.</summary>
    static bool TryProject(Camera camera, Vector3 point, out float screenX) {
        var projected = camera.WorldToScreenPoint(point);
        screenX = projected.x;
        return projected.z > 0f;
    }

    /* --------------------------------- RCA 16 §3.2: marks, PSD and train doorways */

    /// <summary>All document bounds of one instantiated prefab, in document metres.</summary>
    static StationBox DocumentBounds(GameObject instance) {
        var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
        var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
        foreach (var filter in instance.GetComponentsInChildren<MeshFilter>()) {
            var mesh = filter.sharedMesh;
            if (!mesh) continue;
            var bounds = mesh.bounds;
            for (int corner = 0; corner < 8; corner++) {
                var local = new Vector3(
                    (corner & 1) == 0 ? bounds.min.x : bounds.max.x,
                    (corner & 2) == 0 ? bounds.min.y : bounds.max.y,
                    (corner & 4) == 0 ? bounds.min.z : bounds.max.z);
                var document = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(local));
                min = Vector3.Min(min, document);
                max = Vector3.Max(max, document);
            }
        }
        return new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
    }

    /// <summary>A synthetic saved floor mark for the resolver/helper cases.</summary>
    static StationModuleRecord MarkRecord(string id, int x, int y, int z, int rotation, string variant,
        double offsetX, double offsetY, string edgeId = null, bool arrayOffset = false) {
        var values = new Dictionary<string, string>(StringComparer.Ordinal) { ["variant"] = variant };
        if (edgeId != null) values["edgeId"] = edgeId;
        if (offsetX != 0 || offsetY != 0) {
            if (arrayOffset) {
                values["offset"] = "[" + offsetX.ToString("0.######", CultureInfo.InvariantCulture) + "," +
                    offsetY.ToString("0.######", CultureInfo.InvariantCulture) + "]";
            } else {
                values["offset"] = "{\"x\":" + offsetX.ToString("0.######", CultureInfo.InvariantCulture) +
                    ",\"y\":" + offsetY.ToString("0.######", CultureInfo.InvariantCulture) + "}";
            }
        }
        var facts = new ModuleFacts {
            Id = id, Type = "floor-mark", X = x, Y = y, Z = z, Rotation = rotation,
            Width = 3, Depth = 1, Config = new ModuleConfig(values),
        };
        return new StationModuleRecord(id, "floor-mark", x, y, z, rotation, 3, 1, 1, false, null, null,
            null, "", facts, 0, offsetX, offsetY);
    }

    /// <summary>The catalogue key a saved floor mark resolves to (`ModuleViews.Resolve`).</summary>
    static string FloorMarkKey(StationModuleRecord mark) {
        var variant = mark.Config.Text("variant");
        return variant.Length > 0 ? "floor-mark-" + variant : "floor-mark-boarding";
    }

    /// <summary>
    /// RCA 16 §3.2. One doorway rule for all three families that meet at a platform
    /// screen: every Zoo PSD opening's document centre is `StationPlatformDoorways`'s,
    /// every printed station panel is centred on that same point, every saved boarding
    /// mark's authored offset puts its vinyl on the doorway's 2 cm plate line, and the
    /// train consist's own door cadence stops on the same along-run coordinate. The
    /// renderer's floor-mark pivot is measured through the real catalogue prefab.
    /// </summary>
    [Test]
    public void TheSavedBoardingMarksAndThePsdOpeningsShareOneDoorwayCentre() {
        var parent = Root("RCA 16 doorways");
        BuildAll(parent);
        var edges = zoo.Document.Modules.Where(module => module.Type == "platform-edge").ToList();
        Assert.AreEqual(Runs, edges.Count);

        var doorways = new List<StationDoorway>();
        var rows = new StringBuilder();
        rows.AppendLine("run,opening,cell,run_x,width,doc_x,doc_y,header_x,header_y,train_delta");
        foreach (var edge in edges) {
            var view = View(Set(), edge.Id);
            var line = zoo.Document.Lines.First(candidate => candidate.Id == edge.Config.Text("line"));
            var track = zoo.Document.Modules.First(candidate => candidate.Id == edge.Config.Text("from"));
            float scale = OpeningModuleViews.ModelScaleOf(line);
            Assert.IsTrue(TrainConsistGeometry.TryBerth(zoo.Document, line, track, scale, out var berth, out var failure),
                edge.Id + ": " + failure);
            Assert.IsTrue(berth.HasPlatform, edge.Id + " has no platform side");
            Assert.AreEqual(edge.Z + .5f, berth.PlatformPoint.z, 1e-4f, "the berth's platform point is on the edge's storey");

            // The source's cadence (`doorRunOffsets`), in the track's own frame. A down
            // track turns the consist end for end, so its door offsets flip sign; the
            // set is the same because the cadence is symmetric about the consist centre.
            var trainAlong = new List<double>();
            foreach (var at in TrainConsist.DoorRunOffsets(line.Stock, line.Cars, scale, track.Width))
                trainAlong.Add(berth.DirectionSign * (at - track.Width * .5f));

            foreach (var opening in view.Run.Openings) {
                var doorway = StationPlatformDoorways.At(edge, opening.Index, opening.Centre, opening.Width);
                doorways.Add(doorway);
                Assert.AreEqual(opening.Index, doorway.Index);
                AssertNear("psd opening doc x " + edge.Id + "#" + opening.Index, (float)doorway.X, opening.DocumentX, 1e-3f);
                AssertNear("psd opening doc y " + edge.Id + "#" + opening.Index, (float)doorway.Y, opening.DocumentY, 1e-3f);
                Assert.AreEqual(doorway.Cell, opening.Cell, "the seated run cell is round(runX)");
                Assert.AreEqual(Mathf.RoundToInt(opening.Centre), opening.Cell);

                // The printed station panel is centred on the doorway along the run, on
                // the fascia plane `buildPsd` prints it at (across is the panel's own
                // 0.21 m platform-side offset, not a second doorway centre).
                var slot = view.StationHeader(opening.Index);
                Assert.IsTrue(slot.Node, edge.Id + " station panel " + opening.Index + " has no node");
                AssertNear("header slot centre " + edge.Id + "#" + opening.Index, opening.Centre, slot.Centre, 1e-4f);
                StationFootprints.RotateLocal(edge.Rotation, opening.Centre, slot.Across, out var expectedX, out var expectedY);
                var header = StationCoordinates.WorldToDocument(slot.Node.position);
                AssertNear("header x " + edge.Id + "#" + opening.Index, edge.X + .5 + expectedX, header.x, 1e-3);
                AssertNear("header y " + edge.Id + "#" + opening.Index, edge.Y + .5 + expectedY, header.y, 1e-3);

                // The train door stops on the same along-run coordinate.
                var along = (opening.DocumentX - berth.DocumentPosition.x) * berth.Facing.x +
                    (opening.DocumentY - berth.DocumentPosition.y) * berth.Facing.y;
                double nearest = trainAlong.Min(value => Math.Abs(value - along));
                Assert.Less(nearest, 1e-3, "train door vs PSD opening " + edge.Id + "#" + opening.Index +
                    " along " + along.ToString("0.###", CultureInfo.InvariantCulture));
                rows.AppendLine(string.Join(",", new[] {
                    edge.Id, opening.Index.ToString(CultureInfo.InvariantCulture),
                    opening.Cell.ToString(CultureInfo.InvariantCulture),
                    opening.Centre.ToString("0.###", CultureInfo.InvariantCulture),
                    opening.Width.ToString("0.###", CultureInfo.InvariantCulture),
                    opening.DocumentX.ToString("0.###", CultureInfo.InvariantCulture),
                    opening.DocumentY.ToString("0.###", CultureInfo.InvariantCulture),
                    header.x.ToString("0.###", CultureInfo.InvariantCulture),
                    header.y.ToString("0.###", CultureInfo.InvariantCulture),
                    nearest.ToString("0.######", CultureInfo.InvariantCulture),
                }));
            }
        }
        Assert.AreEqual(RunOpenings * Runs, doorways.Count);

        // Every saved boarding vinyl sits on its doorway, through the renderer's own pivot.
        var marks = zoo.Document.Modules.Where(module => module.Type == "floor-mark").ToList();
        Assert.AreEqual(45, marks.Count, "Zoo floor marks");
        var markRows = new StringBuilder();
        markRows.AppendLine("id,variant,rot,edge,centre_x,centre_y,door_edge,door_index,door_x,door_y,delta,origin_x,origin_y,bounds_x0,bounds_y0,bounds_x1,bounds_y1");
        int boundMarks = 0;
        foreach (var mark in marks) {
            var centre = StationPlatformDoorways.MarkCentre(mark);
            var origin = StationPlatformDoorways.MarkOrigin(mark);
            AssertNear("authored origin x " + mark.Id, mark.X + .5 + mark.OffsetX, origin.X, 1e-9);
            AssertNear("authored origin y " + mark.Id, mark.Y + .5 + mark.OffsetY, origin.Y, 1e-9);
            var key = FloorMarkKey(mark);
            Assert.IsTrue(catalogue.TryGet(key, out var entry), mark.Id + " resolved to no catalogue entry: " + key);
            bool hasOffset = mark.Config.Has("offset");
            bool parsedOffset = StationPlatformDoorways.TryMarkOffset(mark.Facts.Config, out var parsedX, out var parsedY);
            Assert.AreEqual(hasOffset, parsedOffset, mark.Id + " cfg.offset parse: " + mark.Config.Json("offset"));
            if (parsedOffset) {
                AssertNear("cfg offset x " + mark.Id, mark.OffsetX, parsedX, 1e-9);
                AssertNear("cfg offset y " + mark.Id, mark.OffsetY, parsedY, 1e-9);
            } else {
                AssertNear("no offset x " + mark.Id, 0, mark.OffsetX, 1e-9);
                AssertNear("no offset y " + mark.Id, 0, mark.OffsetY, 1e-9);
            }

            // The renderer's placed pivot = the authored group origin (cell centre + offset).
            var pivot = StationSurfaceModuleRenderer.FloorMarkPivot(mark.Facts, entry);
            var pivotDocument = StationCoordinates.WorldToDocument(pivot);
            AssertNear("renderer pivot x " + mark.Id, origin.X, pivotDocument.x, 1e-4);
            AssertNear("renderer pivot y " + mark.Id, origin.Y, pivotDocument.y, 1e-4);
            AssertNear("renderer pivot z " + mark.Id, origin.Z, pivotDocument.z, 1e-4);

            // The placed vinyl's document bounds are `floorDecorBounds` exactly: this is
            // the saved offset projected through the prefab's own printed plate.
            var instance = UnityEngine.Object.Instantiate(entry.prefab, parent, false);
            StationBox measured;
            try {
                instance.transform.SetPositionAndRotation(pivot, ModulePlacement.Rotation(mark.Rotation));
                measured = DocumentBounds(instance);
            } finally {
                UnityEngine.Object.DestroyImmediate(instance);
            }
            var expected = StationFootprints.FloorDecorBounds(mark);
            AssertNear("vinyl x0 " + mark.Id, expected.X0, measured.X0, 2e-3);
            AssertNear("vinyl x1 " + mark.Id, expected.X1, measured.X1, 2e-3);
            AssertNear("vinyl y0 " + mark.Id, expected.Y0, measured.Y0, 2e-3);
            AssertNear("vinyl y1 " + mark.Id, expected.Y1, measured.Y1, 2e-3);
            AssertNear("vinyl top " + mark.Id, expected.Z1, measured.Z1, 2e-3);

            // An edge-bound mark is on its doorway's plate line; a deliberately unbound
            // one keeps exactly where the save put it.
            var edgeId = mark.Config.Text("edgeId");
            var storeyDoorways = doorways.Where(door => Math.Abs(door.Z - (mark.Z + 1)) < 1e-6).ToList();
            bool found = StationPlatformDoorways.TryNearest(mark, storeyDoorways, out var snapped);
            if (edgeId.Length > 0) {
                boundMarks++;
                Assert.IsTrue(found, mark.Id + " is bound to " + edgeId + " but has no doorway within 1.5 m");
                Assert.AreEqual(edgeId, snapped.EdgeId, mark.Id + " is nearest another run's doorway");
                Assert.AreEqual(mark.Rotation, snapped.MarkRotation, mark.Id + " saved rotation is not the doorway's");
                AssertNear("mark vs doorway x " + mark.Id, snapped.MarkX, centre.X, 2e-3);
                AssertNear("mark vs doorway y " + mark.Id, snapped.MarkY, centre.Y, 2e-3);
                markRows.AppendLine(string.Join(",", new[] {
                    mark.Id, mark.Config.Text("variant"), mark.Rotation.ToString(CultureInfo.InvariantCulture), edgeId,
                    centre.X.ToString("0.###", CultureInfo.InvariantCulture), centre.Y.ToString("0.###", CultureInfo.InvariantCulture),
                    snapped.EdgeId, snapped.Index.ToString(CultureInfo.InvariantCulture),
                    snapped.MarkX.ToString("0.###", CultureInfo.InvariantCulture), snapped.MarkY.ToString("0.###", CultureInfo.InvariantCulture),
                    Math.Sqrt(Math.Pow(snapped.MarkX - centre.X, 2) + Math.Pow(snapped.MarkY - centre.Y, 2))
                        .ToString("0.######", CultureInfo.InvariantCulture),
                    origin.X.ToString("0.###", CultureInfo.InvariantCulture), origin.Y.ToString("0.###", CultureInfo.InvariantCulture),
                    measured.X0.ToString("0.###", CultureInfo.InvariantCulture), measured.Y0.ToString("0.###", CultureInfo.InvariantCulture),
                    measured.X1.ToString("0.###", CultureInfo.InvariantCulture), measured.Y1.ToString("0.###", CultureInfo.InvariantCulture),
                }));
            } else {
                Assert.IsFalse(found, mark.Id + " is unbound in the save but a doorway is within 1.5 m");
                markRows.AppendLine(string.Join(",", new[] {
                    mark.Id, mark.Config.Text("variant"), mark.Rotation.ToString(CultureInfo.InvariantCulture), "",
                    centre.X.ToString("0.###", CultureInfo.InvariantCulture), centre.Y.ToString("0.###", CultureInfo.InvariantCulture),
                    "", "", "", "", "", origin.X.ToString("0.###", CultureInfo.InvariantCulture),
                    origin.Y.ToString("0.###", CultureInfo.InvariantCulture),
                    measured.X0.ToString("0.###", CultureInfo.InvariantCulture), measured.Y0.ToString("0.###", CultureInfo.InvariantCulture),
                    measured.X1.ToString("0.###", CultureInfo.InvariantCulture), measured.Y1.ToString("0.###", CultureInfo.InvariantCulture),
                }));
            }
        }
        Assert.AreEqual(36, boundMarks, "the Zoo save's boarding marks are edge-bound");
        var directory = Path.Combine(RepositoryRoot(), ".preview/unity/plan16");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "psd-doorways.csv"), rows.ToString(), new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(directory, "floor-marks.csv"), markRows.ToString(), new UTF8Encoding(false));
    }

    /// <summary>
    /// RCA 16 §3.2's preserve rule: `snapBoardingMark` returns the mark unchanged when no
    /// doorway is within 1.5 m, so an authored offset must survive untouched. The same
    /// helper rejects a PSD end cover's array offset (it is not a floor-mark object).
    /// </summary>
    [Test]
    public void AnUnboundFloorMarkKeepsItsAuthoredOffset() {
        var mark = MarkRecord("mark-unbound", 40, 40, -20, 1, "boarding", .4, -.3);
        Assert.IsTrue(StationPlatformDoorways.TryMarkOffset(mark.Facts.Config, out var x, out var y));
        AssertNear("parsed offset x", .4, x, 1e-9);
        AssertNear("parsed offset y", -.3, y, 1e-9);
        var origin = StationPlatformDoorways.MarkOrigin(mark);
        AssertNear("origin x", 40.9, origin.X, 1e-9);
        AssertNear("origin y", 40.2, origin.Y, 1e-9);
        // Local vinyl centre: (w-1)/2 = 1 along the mark's turn, across cy = 0.
        var centre = StationPlatformDoorways.MarkCentre(mark);
        AssertNear("centre x", 40.9, centre.X, 1e-9);
        AssertNear("centre y", 41.2, centre.Y, 1e-9);

        var doorways = new List<StationDoorway> {
            StationPlatformDoorways.At("probe-edge", 0, 0, 0, -20, 0, "left", 3.352, 2.058),
        };
        Assert.IsFalse(StationPlatformDoorways.TryNearest(mark, doorways, out _),
            "a mark 40 m away from the only doorway must stay unbound");
        // A bound one is found and reported; the helper never mutates the record.
        var bound = MarkRecord("mark-bound", 40, 40, -20, 2, "boarding", .648, .02, "probe-edge");
        var nearby = new List<StationDoorway> {
            // Rot 2 puts the vinyl's +1 m local run offset toward −x, so the doorway that
            // seats it is one third of a cell before the edge's first cell origin.
            StationPlatformDoorways.At("probe-edge", 0, 40, 40, -20, 0, "left", -.352, 2.058),
        };
        Assert.IsTrue(StationPlatformDoorways.TryNearest(bound, nearby, out var snapped));
        Assert.AreEqual("probe-edge", snapped.EdgeId);
        Assert.AreEqual(2, snapped.MarkRotation, "left bank vinyl turns end for end");

        // The track-side flip: on a left bank the vinyl's plate line is +y of the opening
        // (the platform), on a right bank −y, and only the left bank turns the vinyl.
        var leftBank = StationPlatformDoorways.At("left", 0, 0, 0, -20, 0, "left", 0, 2.058);
        var rightBank = StationPlatformDoorways.At("right", 0, 0, 0, -20, 0, "right", 0, 2.058);
        AssertNear("left bank plate line", leftBank.Y + StationPlatformDoorways.PlateOffset, leftBank.MarkY, 1e-9);
        AssertNear("right bank plate line", rightBank.Y - StationPlatformDoorways.PlateOffset, rightBank.MarkY, 1e-9);
        Assert.AreEqual(2, leftBank.MarkRotation);
        Assert.AreEqual(0, rightBank.MarkRotation, "a right-bank vinyl keeps the edge's own turn");

        // A PSD end cover's `[u, v]` offset is not a floor-mark object offset.
        var cover = MarkRecord("cover", 0, 0, -20, 0, "boarding", .16, -.16, null, arrayOffset: true);
        Assert.IsFalse(StationPlatformDoorways.TryMarkOffset(cover.Facts.Config, out _, out _),
            "an array offset belongs to a PSD end cover, not a floor vinyl");
    }

    /* ------------------------------- RCA 16 §3.3: the PSD threshold and the cell top */

    /// <summary>One saved cell for the platform probed through the real mesher input.</summary>
    static StationCellRecord ProbeCell(int x, int y, int z) =>
        new StationCellRecord(x, y, z, "full", "solid", "", null,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["top"] = "floor.concrete" }, "", "");

    /// <summary>The smallest document that carries one screened platform cell.</summary>
    static StationDocument PlatformProbeDocument() {
        var facts = new ModuleFacts {
            Id = "probe-edge", Type = "platform-edge", X = 0, Y = -1, Z = 0, Rotation = 0, Width = 1, Depth = 1,
            Config = new ModuleConfig(new Dictionary<string, string>(StringComparer.Ordinal) {
                ["psd"] = "full", ["side"] = "left", ["line"] = "5", ["dir"] = "up",
            }),
        };
        var module = new StationModuleRecord("probe-edge", "platform-edge", 0, -1, 0, 0, 1, 1, 1, false,
            null, null, null, "", facts);
        var cells = new[] { ProbeCell(0, -1, 0), ProbeCell(0, 0, 0), ProbeCell(0, 1, 0) };
        var day = new StationDay(new StationSpan(0, 86400), new StationSpan(0, 3600), new StationSpan(0, 3600),
            default, default, 2026, 1, 1, null);
        return new StationDocument("probe", "probe", "guangzhou", 1, 0, 5, day, cells,
            new[] { module }, Array.Empty<StationLineRecord>(), 0, 0, StationSource.None, "", "");
    }

    sealed class ProbeContext : IStationViewRenderer {
        public StationViewBuildContext Context { get; private set; }
        public string Role => "probe";
        public void Build(StationViewBuildContext context) => Context = context;
        public void Release() => Context = null;
    }

    /// <summary>
    /// RCA 16 §3.3 through the production path: `BuildInput` now derives
    /// `platformBlockInsets`, and the mesher consumes it — the screened cell's top stops
    /// at the PSD base line (cell-local .75) instead of continuing under the threshold.
    /// </summary>
    [Test]
    public void TheMesherStopsThePlatformTopAtThePsdBase() {
        var document = PlatformProbeDocument();
        var index = new StationIndex(document);
        var probe = new ProbeContext();
        var host = new GameObject("psd inset probe");
        StationWorldView world = null;
        var parent = Root("RCA 16 psd inset mesh");
        try {
            world = new StationWorldView(host.transform, "psd inset probe", new IStationViewRenderer[] { probe });
            world.Build(document, index);
            var notes = new List<string>();
            var input = StationCellRenderer.BuildInput(probe.Context, null, notes);
            Assert.AreEqual(1, input.Insets.Count, "one platform cell is cut");
            Assert.IsTrue(input.Insets.TryGetValue(new StationCellKey(0, -1, 0), out var inset));
            AssertNear("inset y0", 1 - StationPlatformInsets.Edge, inset.Y0, 1e-9);
            AssertNear("inset y1", 1, inset.Y1, 1e-9);
            Assert.AreEqual(0, inset.X0, "the cut is across the run, not along it");
            Assert.AreEqual(1, inset.X1);
            StringAssert.Contains("platform-inset-applied: 1 platform cell", string.Join("; ", notes));

            var material = new Material(shader);
            try {
                var view = StationCellView.Build(new StationCellViewRequest {
                    Mesh = input, Finishes = null, FallbackMaterial = material, Name = "psd inset probe",
                    ToWorld = StationCoordinates.Point, BuildPickMap = false,
                }, parent);
                try {
                    var top = TopFaceDocumentBounds(view, 0, -1, 0);
                    AssertNear("screened cell top starts at the PSD base", -.75, top.Y0, 1e-6);
                    AssertNear("screened cell top ends at its own edge", 0, top.Y1, 1e-6);
                    var neighbour = TopFaceDocumentBounds(view, 0, 0, 0);
                    AssertNear("an unscreened neighbour keeps its full top", 0, neighbour.Y0, 1e-6);
                    AssertNear("an unscreened neighbour keeps its full top", 1, neighbour.Y1, 1e-6);
                } finally {
                    view.Dispose();
                }
            } finally {
                UnityEngine.Object.DestroyImmediate(material);
            }
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /// <summary>The document Y span of one cell's drawn top face in a built cell view.</summary>
    static StationBox TopFaceDocumentBounds(StationCellView view, int x, int y, int z) {
        double y0 = double.PositiveInfinity, y1 = double.NegativeInfinity;
        bool any = false;
        foreach (var group in view.Groups) {
            var mesh = group.Mesh;
            if (!mesh || group.Data?.TriangleFaces == null) continue;
            var vertices = mesh.vertices;
            var indices = mesh.triangles;
            for (int triangle = 0; triangle < group.Data.TriangleFaces.Length; triangle++) {
                var face = view.Faces[group.Data.TriangleFaces[triangle]];
                if (face.X != x || face.Y != y || face.Z != z || face.Face != StationFace.Top) continue;
                for (int corner = 0; corner < 3; corner++) {
                    var document = StationCoordinates.WorldToDocument(vertices[indices[triangle * 3 + corner]]);
                    y0 = Math.Min(y0, document.y);
                    y1 = Math.Max(y1, document.y);
                    any = true;
                }
            }
        }
        Assert.IsTrue(any, "the cell has no drawn top face at " + x + "," + y + "," + z);
        return new StationBox(double.PositiveInfinity, y0, double.PositiveInfinity, double.NegativeInfinity, y1, double.NegativeInfinity);
    }

    /// <summary>
    /// RCA 16 §3.3's evidence: for both Zoo platforms the PSD threshold's top is the
    /// floor plane, its 0.29 m plate covers exactly the 0.25 m inset strip plus the
    /// source's 0.04 m track overhang, and the cell top that used to be coplanar with it
    /// now stops at the plinth line. The printed header is measured with its quads bound
    /// and unbound, so a remaining overlap cannot be blamed on the artwork.
    /// </summary>
    [Test]
    public void ThePsdThresholdOwnsThePlatformInsetStrip() {
        BuildAll(Root("RCA 16 psd threshold"));
        var insets = StationPlatformInsets.For(zoo.Document.Modules);
        int edgeCells = zoo.Document.Modules.Where(module => module.Type == "platform-edge")
            .Sum(module => module.Width);
        Assert.AreEqual(edgeCells, insets.Count, "one inset per platform-edge cell");
        var rows = new StringBuilder();
        rows.AppendLine("run,threshold_z0,threshold_z1,threshold_y0,threshold_y1,foundation_z0,foundation_z1," +
            "cell_top_before_y0,cell_top_after_y0,overlap_before,overlap_after,inset_cut,quad_plane_y,quad_z0,quad_z1,quad_gap");

        var template = new Material(shader);
        try {
            foreach (var edge in zoo.Document.Modules.Where(module => module.Type == "platform-edge")) {
                var view = View(Set(), edge.Id);
                var threshold = view.Part("psd-threshold");
                var foundation = view.Part("psd-concrete-foundation");
                var fascia = view.Part("psd-info-housing");
                Assert.IsNotNull(threshold, edge.Id + " has no threshold part");
                Assert.IsNotNull(foundation, edge.Id + " has no foundation part");
                Assert.IsNotNull(fascia, edge.Id + " has no fascia part");
                var sill = threshold.Document;
                var baseSlab = foundation.Document;
                AssertNear("threshold top is the floor plane", edge.Z + 1, sill.max.z, 1e-6);
                AssertNear("threshold is the source's 2 cm plate", .02, sill.size.z, 1e-6);
                AssertNear("threshold bottom", edge.Z + .98, sill.min.z, 1e-6);
                AssertNear("foundation top meets the plate", edge.Z + .98, baseSlab.max.z, 1e-6);
                AssertNear("foundation bottom is one metre down", edge.Z, baseSlab.min.z, 1e-6);
                AssertNear("foundation is the source's 0.98 m course", .98, baseSlab.size.z, 1e-6);
                AssertNear("the plate and the foundation share their depth", sill.size.y, baseSlab.size.y, 1e-6);
                AssertNear("the source sill depth: 0.09 + 0.20", .29, sill.size.y, 1e-6);
                Assert.AreEqual("concrete", foundation.Material, edge.Id + " foundation finish");

                // The inset mask: the cut strip is the last 0.25 m of every edge cell,
                // on the track side (both Zoo runs are left bank, local −y).
                int cutCells = 0;
                foreach (var point in StationFootprints.Footprint(edge)) {
                    var key = new StationCellKey((int)Math.Round(point.X), (int)Math.Round(point.Y), (int)Math.Round(point.Z));
                    Assert.IsTrue(insets.TryGetValue(key, out var inset), edge.Id + " cell " + key + " has no inset");
                    AssertNear("inset X0 " + key, 0, inset.X0, 1e-9);
                    AssertNear("inset X1 " + key, 1, inset.X1, 1e-9);
                    AssertNear("inset Y0 " + key, 1 - StationPlatformInsets.Edge, inset.Y0, 1e-9);
                    AssertNear("inset Y1 " + key, 1, inset.Y1, 1e-9);
                    // The cell top before the inset runs under the plate; after it, it
                    // stops exactly on the plate's platform-side edge.
                    double beforeY0 = point.Y, afterY0 = point.Y + (1 - StationPlatformInsets.Edge);
                    double overlapBefore = Math.Max(0, Math.Min(point.Y + 1, sill.max.y) - Math.Max(point.Y, sill.min.y));
                    double overlapAfter = Math.Max(0, Math.Min(point.Y + 1, sill.max.y) - Math.Max(afterY0, sill.min.y));
                    AssertNear("before-overlap " + key, StationPlatformInsets.Cut, overlapBefore, 1e-6);
                    AssertNear("after-overlap " + key, 0, overlapAfter, 1e-9);
                    AssertNear("plate inner edge == cell top edge " + key, sill.max.y, afterY0, 1e-6);
                    cutCells++;
                }
                Assert.AreEqual(edge.Width, cutCells, edge.Id + " run cells");

                // Artwork off: the geometry is the same before any header is bound.
                // Artwork on: the printed plane is 4 cm platform-side of the plate, and
                // sits far above it, so it can cover neither the sill nor the foundation.
                using (var rig = new HeaderRig(template, session: edge.Id)) {
                    var slot = view.StationHeader(0);
                    var hidden = threshold.Document;
                    Assert.IsNotNull(rig.Cache.Bind(view, slot));
                    AssertNear("binding a header does not move the threshold", hidden.max.z, threshold.Document.max.z, 1e-9);
                    var quad = HeaderQuad(slot).transform;
                    var quadDocument = StationCoordinates.WorldToDocument(quad.position);
                    Assert.Greater(quadDocument.y, sill.max.y + .03,
                        edge.Id + ": the printed plane overlaps the plate in plan");
                    Assert.Greater(quadDocument.z, sill.max.z + 1f,
                        edge.Id + ": the printed plane is not above the threshold");
                    rows.AppendLine(string.Join(",", new[] {
                        edge.Id,
                        sill.min.z.ToString("0.###", CultureInfo.InvariantCulture), sill.max.z.ToString("0.###", CultureInfo.InvariantCulture),
                        sill.min.y.ToString("0.###", CultureInfo.InvariantCulture), sill.max.y.ToString("0.###", CultureInfo.InvariantCulture),
                        baseSlab.min.z.ToString("0.###", CultureInfo.InvariantCulture), baseSlab.max.z.ToString("0.###", CultureInfo.InvariantCulture),
                        (edge.Z).ToString("0.###", CultureInfo.InvariantCulture),
                        (edge.Z + 1 - StationPlatformInsets.Cut).ToString("0.###", CultureInfo.InvariantCulture),
                        StationPlatformInsets.Cut.ToString("0.###", CultureInfo.InvariantCulture), "0",
                        StationPlatformInsets.Cut.ToString("0.###", CultureInfo.InvariantCulture),
                        quadDocument.y.ToString("0.###", CultureInfo.InvariantCulture),
                        quadDocument.z.ToString("0.###", CultureInfo.InvariantCulture),
                        (quadDocument.z + slot.Height * .5f).ToString("0.###", CultureInfo.InvariantCulture),
                        (quadDocument.y - sill.max.y).ToString("0.###", CultureInfo.InvariantCulture),
                    }));
                }
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(template);
        }

        // The half-height sticker plate: one paired print per fixed pane, printed on the
        // glass. It must not reach the threshold either, with the quad visible.
        var fixture = Root("RCA 16 half sticker plate");
        var palette = new OpeningPalette(shader);
        palettes.Add(palette);
        var facts = new ModuleFacts { Id = "half-plate", Type = "platform-edge", Width = 10, Depth = 1, Rotation = 0 };
        var request = new OpeningModuleViews.OpeningRequest {
            ModuleId = "half-plate", Type = "platform-edge", Width = 10, Depth = 1,
            Side = "left", Psd = "half", StoreyHeight = 5, Dir = "up",
            LineId = "9", LineColour = "#123456", HasLine = true, Stock = "B", Cars = 2, ModelScale = 1f,
            StationName = "Fixture", StationNameEn = "Fixture", UpTerminus = "Far", UpNextStation = "Near",
        };
        Assert.IsTrue(OpeningModuleViews.TryBuild(request, facts, new[] { facts }, catalogue, fixture, palette, out var halfView),
            halfView.Diagnostic);
        Assert.Greater(halfView.HeaderCount(PsdHeaderKind.HalfSticker), 0);
        var stickerTemplate = new Material(shader);
        try {
            using (var rig = new HeaderRig(stickerTemplate, session: "half-plate")) {
                foreach (var slot in halfView.Headers) Assert.IsNotNull(rig.Cache.Bind(halfView, slot));
                rig.Cache.Pump();
                var stickerSlot = halfView.Headers.First(slot => slot.Kind == PsdHeaderKind.HalfSticker);
                var quad = HeaderQuad(stickerSlot).transform;
                var quadDocument = StationCoordinates.WorldToDocument(quad.position);
                var threshold = halfView.Part("psd-threshold").Document;
                Assert.Greater(quadDocument.z, threshold.max.z + .5f,
                    "the sticker is printed on the glass, a storey above the sill: " + quadDocument);
                rows.AppendLine(string.Join(",", new[] {
                    "half-plate", threshold.min.z.ToString("0.###", CultureInfo.InvariantCulture),
                    threshold.max.z.ToString("0.###", CultureInfo.InvariantCulture),
                    threshold.min.y.ToString("0.###", CultureInfo.InvariantCulture),
                    threshold.max.y.ToString("0.###", CultureInfo.InvariantCulture),
                    halfView.Part("psd-concrete-foundation").Document.min.z.ToString("0.###", CultureInfo.InvariantCulture),
                    halfView.Part("psd-concrete-foundation").Document.max.z.ToString("0.###", CultureInfo.InvariantCulture),
                    "", "", StationPlatformInsets.Cut.ToString("0.###", CultureInfo.InvariantCulture), "0",
                    StationPlatformInsets.Cut.ToString("0.###", CultureInfo.InvariantCulture),
                    quadDocument.y.ToString("0.###", CultureInfo.InvariantCulture),
                    quadDocument.z.ToString("0.###", CultureInfo.InvariantCulture),
                    (quadDocument.z + stickerSlot.Height * .5f).ToString("0.###", CultureInfo.InvariantCulture),
                    (quadDocument.z - threshold.max.z).ToString("0.###", CultureInfo.InvariantCulture),
                }));
            }
        } finally {
            UnityEngine.Object.DestroyImmediate(stickerTemplate);
        }
        var directory = Path.Combine(RepositoryRoot(), ".preview/unity/plan16");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "psd-threshold.csv"), rows.ToString(), new UTF8Encoding(false));
    }

    /* --------------------------------------------------------------- helpers */

    /// <summary>
    /// A hand-built L consist: one `DoorCentre-0` anchor and four leaves at the source's
    /// closed pose (<c>dx ± doorWidth/4</c>, banks at <c>±(width/2 − 0.025)</c>). The rig's
    /// anchor binding must reproduce that from the anchor and `STOCK.L` alone.
    /// </summary>
    GameObject Consist() {
        var consist = new GameObject("Consist");
        roots.Add(consist);
        var anchor = new GameObject("DoorCentre-0");
        anchor.transform.SetParent(consist.transform, false);
        anchor.transform.localPosition = Vector3.zero;
        int names = 0;
        for (int side = 0; side < 2; side++) {
            float sign = side == 0 ? -1f : 1f;
            for (int bank = -1; bank <= 1; bank += 2) {
                var leaf = new GameObject("TrainLMidDoor" + (names++).ToString("00"));
                leaf.transform.SetParent(consist.transform, false);
                leaf.transform.localPosition = new Vector3(sign * .35f, 0f, bank * 1.375f);
            }
        }
        return consist;
    }

    /// <summary>The leaves of one bank, ordered along the consist so leaf 0 is the left one.</summary>
    static Transform[] BankLeaves(GameObject consist, int bank) => consist
        .GetComponentsInChildren<Transform>(true)
        .Where(node => node.name.StartsWith("TrainLMidDoor", StringComparison.Ordinal))
        .Where(node => Mathf.Sign(node.localPosition.z) == Mathf.Sign(bank))
        .OrderBy(node => node.localPosition.x)
        .ToArray();
}
