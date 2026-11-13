using System;
using System.Collections.Generic;
using System.Linq;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
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

    /* ------------------------------------------------------------------ gates */

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
