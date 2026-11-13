using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Packet B2's proof for the vertical families. Every expectation below is derived
/// from the TypeScript owners (`render/models/pieces/{StairModel,EscalatorModel,
/// LiftModel}.ts`, `sim/{stairs,escalators,lifts}.ts`) and re-derived from the saved
/// Zoo records by `unity/plan/11-evidence/B2/vertical-oracle.mjs`; the values are
/// quoted in `unity/plan/11-evidence/B2.md`.
///
/// The Zoo fixture has 14 escalators, 5 stairs and 2 lifts. All 14 escalators are the
/// canonical 9-cell / 5 m / 30Ãƒâ€šÃ‚Â° / narrow run, so they instance the promoted
/// `Escalator.prefab` exactly. The three straight stairs are also the promoted
/// geometry, but each has a wall side that suppresses one handrail in the source, so
/// they are assembled at the authored dimensions instead (the prefab always carries
/// both rails). Both lifts are longer than the five-metre `Lift.prefab` and are
/// assembled at 9 m and 13 m. No reference prefab is ever scaled.
/// </summary>
public class VerticalModuleViewTests {
    const string ZooPath = "Assets/StationDesigner/Zoo/ZooSave.json";
    const string PrefabFolder = "Assets/StationDesigner/Generated/Prefabs/";

    static readonly List<GameObject> Parents = new List<GameObject>();
    static readonly List<VerticalModuleView> Built = new List<VerticalModuleView>();

    [TearDown]
    public void TearDown() {
        for (int i = 0; i < Built.Count; i++) Built[i]?.Dispose();
        Built.Clear();
        for (int i = 0; i < Parents.Count; i++) if (Parents[i]) UnityEngine.Object.DestroyImmediate(Parents[i]);
        Parents.Clear();
    }

    /* ------------------------------------------------------------- fixtures */

    static JObject Zoo() => JObject.Parse(File.ReadAllText(ZooPath));

    static IEnumerable<JObject> Modules(JObject save, string type) =>
        save["static"]["modules"].Children<JObject>().Where(module => (string)module["type"] == type);

    static JObject Module(JObject save, string id) =>
        save["static"]["modules"].Children<JObject>().FirstOrDefault(module => (string)module["id"] == id);

    static HashSet<string> Solids(JObject save) {
        var solids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var cell in save["static"]["cells"].Children<JObject>()) {
            if ((string)cell["fill"] != "solid") continue;
            solids.Add((int)cell["x"] + "," + (int)cell["y"] + "," + (int)cell["z"]);
        }
        return solids;
    }

    static Func<int, int, int, bool> SolidOf(JObject save) {
        var solids = Solids(save);
        return (x, y, z) => solids.Contains(x + "," + y + "," + z);
    }

    static GameObject LoadPrefab(string name) {
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabFolder + name + ".prefab");
        Assert.IsNotNull(prefab, "promoted prefab missing: " + name);
        return prefab;
    }

    static GameObject PrefabFor(JObject module) {
        switch ((string)module["type"]) {
            case "escalator": return LoadPrefab("Escalator");
            case "stair": return LoadPrefab((string)module["cfg"]?["style"] == "right180" ? "StairRight180" : "StairStraight");
            case "lift": return LoadPrefab("Lift");
            default: return null;
        }
    }

    static string KeyFor(JObject module) {
        switch ((string)module["type"]) {
            case "escalator": return "escalator";
            case "stair": return (string)module["cfg"]?["style"] == "right180" ? "stair-right180" : "stair-straight";
            case "lift": return "lift";
            default: return "";
        }
    }

    static VerticalModuleView Build(JObject save, JObject module, Func<int, int, int, bool> solid = null) {
        var parent = new GameObject("vertical test");
        Parents.Add(parent);
        var facts = ModuleFactsReader.Read(module);
        var request = VerticalModuleRequest.FromFacts(facts, PrefabFor(module), KeyFor(module), solid ?? SolidOf(save));
        Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view), "build failed: " + (string)module["id"]);
        Built.Add(view);
        return view;
    }

    static Vector3 Document(VerticalModuleView view, string part) {
        Assert.IsTrue(view.TryGetPart(part, out var transform), "missing part: " + part + " on " + view.ModuleId);
        return StationCoordinates.WorldToDocument(transform.position);
    }

    static bool Near(Vector3 actual, Vector3 expected, float tolerance) =>
        Mathf.Abs(actual.x - expected.x) <= tolerance &&
        Mathf.Abs(actual.y - expected.y) <= tolerance &&
        Mathf.Abs(actual.z - expected.z) <= tolerance;

    static ModuleMotionState EscalatorState(string id, double seconds, bool running = true, int sign = 1) =>
        ModuleMotionState.Escalator(id, seconds, running, sign);

    /* ----------------------------------------------------------- the census */

    [Test]
    public void ZooHasTheMeasuredVerticalModules() {
        var save = Zoo();
        Assert.AreEqual(4299, save["static"]["modules"].Count(), "Zoo module count");
        Assert.AreEqual(14, Modules(save, "escalator").Count(), "escalators");
        Assert.AreEqual(5, Modules(save, "stair").Count(), "stairs");
        Assert.AreEqual(2, Modules(save, "lift").Count(), "lifts");
        Assert.AreEqual(0, Modules(save, "walkway").Count(), "walkways (none authored)");
    }

    [Test]
    public void EverySavedVerticalModuleBuilds() {
        var save = Zoo();
        var built = new List<VerticalModuleView>();
        foreach (var type in new[] { "escalator", "stair", "lift" })
            foreach (var module in Modules(save, type)) built.Add(Build(save, module));
        Assert.AreEqual(21, built.Count, "14 escalators + 5 stairs + 2 lifts");
        Assert.AreEqual(14, built.Count(view => view.UsedPrefab && view.Kind == VerticalModuleKind.Escalator), "escalator prefab matches");
        Assert.AreEqual(0, built.Count(view => view.UsedPrefab && view.Kind == VerticalModuleKind.Stair), "Zoo stairs carry a wall side, so no exact stair prefab");
        Assert.AreEqual(0, built.Count(view => view.UsedPrefab && view.Kind == VerticalModuleKind.Lift), "Zoo lifts are longer than the 5 m reference");
        foreach (var view in built) {
            Assert.IsTrue(view.TryGetPart("pivot", out _), view.ModuleId + " pivot");
            Assert.IsTrue(view.TryGetPart("lower-landing", out _), view.ModuleId + " lower landing");
            Assert.IsTrue(view.TryGetPart("upper-landing", out _), view.ModuleId + " upper landing");
            Assert.Greater(view.DocumentBounds.X1 - view.DocumentBounds.X0, 0.0, view.ModuleId + " x bounds");
            Assert.Greater(view.DocumentBounds.Y1 - view.DocumentBounds.Y0, 0.0, view.ModuleId + " y bounds");
            Assert.Greater(view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 0.0, view.ModuleId + " z bounds");
        }
    }

    [Test]
    public void EscalatorsAreOneDimensionClassAndTwoTravelDirections() {
        var save = Zoo();
        var shapes = new HashSet<string>();
        int up = 0, down = 0;
        foreach (var module in Modules(save, "escalator")) {
            var from = module["from"];
            var to = module["to"];
            int planRun = Math.Max(Math.Abs((int)to["x"] - (int)from["x"]), Math.Abs((int)to["y"] - (int)from["y"]));
            shapes.Add(planRun + "," + Math.Abs((int)to["z"] - (int)from["z"]));
            if ((string)module["cfg"]["dir"] == "up") up++; else down++;
        }
        Assert.AreEqual(1, shapes.Count, "every Zoo escalator is 9 cells horizontal x 5 m rise");
        Assert.AreEqual("9,5", shapes.First(), "the one authored dimension class");
        Assert.AreEqual(8, up, "up escalators");
        Assert.AreEqual(6, down, "down escalators");
    }

    /* ------------------------------------------------------------- escalator */

    [Test]
    public void EscalatorPrefabsMatchTheAuthoredRunAndStepChain() {
        var save = Zoo();
        foreach (var module in Modules(save, "escalator")) {
            var view = Build(save, module);
            var id = (string)module["id"];
            Assert.IsTrue(view.UsedPrefab, id + " should instance the promoted Escalator prefab");
            Assert.AreEqual("escalator", view.PrefabKey);
            Assert.AreEqual(29, view.StepCount, id + " step count (TS chain/nSteps)");
            Assert.AreEqual(11.547005, view.RunLength, 1e-4f, id + " chain length");
            Assert.AreEqual(23.094010, view.LoopSeconds, 1e-4f, id + " loop seconds");
            Assert.AreEqual(0.3981726, view.StepPitch, 1e-5f, id + " pitch");
            var lower = Document(view, "band-lower");
            var upper = Document(view, "band-upper");
            Assert.AreEqual(10.0, Vector3.Distance(lower, upper), 1e-3f, id + " incline length");
            Assert.AreEqual(5.0, Math.Abs(upper.z - lower.z), 1e-3f, id + " authored rise");
            // The graph endpoints are the authored cells; the incline ends are inset by
            // `escalatorInclineRun`, so measure the authored 9-cell run between them.
            var fromCell = Document(view, "lower-landing");
            var toCell = Document(view, "upper-landing");
            Assert.AreEqual(9.0, new Vector2(toCell.x - fromCell.x, toCell.y - fromCell.y).magnitude, 1e-3f, id + " authored horizontal run");
            // The prefab's own extents: 10.3246 m along the run, 6.5525 m of elevation, 1.0 m across.
            var size = new Vector3((float)(view.DocumentBounds.X1 - view.DocumentBounds.X0),
                (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0), (float)(view.DocumentBounds.Z1 - view.DocumentBounds.Z0));
            Assert.AreEqual(10.3246, Mathf.Max(size.x, size.y), 0.02f, id + " measured run extent");
            Assert.AreEqual(1.0, Mathf.Min(size.x, size.y), 0.02f, id + " measured across extent");
            Assert.AreEqual(6.5525, size.z, 0.02f, id + " measured elevation extent");
        }
    }

    [Test]
    public void PausedEscalatorHoldsItsPose() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4059"));
        Assert.IsTrue(view.Apply(EscalatorState(view.ModuleId, 5.0)));
        var moving = Document(view, "tread-0");
        Assert.IsTrue(view.Apply(EscalatorState(view.ModuleId, 5.0, running: false)));
        Assert.IsTrue(Near(Document(view, "tread-0"), moving, 1e-4f), "paused mid-run must hold");
        Assert.IsTrue(view.Apply(EscalatorState(view.ModuleId, 9.0, running: false)));
        Assert.IsTrue(Near(Document(view, "tread-0"), moving, 1e-4f), "a frozen clock must not advance the band");
    }

    [Test]
    public void StoppedEscalatorDoesNotMove() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4061"));
        view.Apply(EscalatorState(view.ModuleId, 3.0, sign: 0));
        var held = Document(view, "tread-0");
        view.Apply(EscalatorState(view.ModuleId, 30.0, sign: 0));
        Assert.IsTrue(Near(Document(view, "tread-0"), held, 1e-4f), "direction 0 is a stopped band");
    }

    [Test]
    public void ReversedEscalatorMirrorsThePhase() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4059"));
        view.Apply(EscalatorState(view.ModuleId, 4.0, sign: 1));
        var forward = view.PhaseMeters;
        view.Apply(EscalatorState(view.ModuleId, 4.0, sign: -1));
        var reversed = view.PhaseMeters;
        Assert.AreEqual(2.0, forward, 1e-6f, "0.5 m/s x 4 s");
        Assert.AreEqual(view.RunLength - 2.0, reversed, 1e-6f, "the same distance the other way round the chain");
    }

    [Test]
    public void EscalatorLoopClosesExactlyAndNeverTeleportsInTheVisibleSpan() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4057"));
        view.Apply(EscalatorState(view.ModuleId, 0.0));
        var start = Document(view, "tread-0");
        view.Apply(EscalatorState(view.ModuleId, view.LoopSeconds));
        Assert.IsTrue(Near(Document(view, "tread-0"), start, 1e-3f), "one full loop returns the seated pose");
        // Walk one loop in small steps: every step visible in two consecutive samples
        // moves by at most two pitches, i.e. no visible tread jumps a whole loop.
        Vector3? previous = null;
        string previousName = null;
        for (int sample = 0; sample <= 120; sample++) {
            double seconds = view.LoopSeconds * sample / 120.0;
            view.Apply(EscalatorState(view.ModuleId, seconds));
            string currentName = null;
            Vector3 current = default;
            for (int i = 0; i < view.StepCount; i++) {
                if (!view.TryGetPart("tread-" + i, out var tread) || !tread.gameObject.activeSelf) continue;
                currentName = "tread-" + i; current = StationCoordinates.WorldToDocument(tread.position); break;
            }
            if (previous.HasValue && currentName == previousName)
                Assert.LessOrEqual(Vector3.Distance(current, previous.Value), view.StepPitch * 2.0 + 1e-3,
                    "visible tread jumped at sample " + sample);
            previous = current; previousName = currentName;
        }
    }

    [Test]
    public void FixedEscalatorPartsStayPut() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4059"));
        var truss = view.Root.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name.StartsWith("truss", StringComparison.Ordinal));
        Assert.IsNotNull(truss, "the promoted escalator keeps its named truss");
        var comb = Document(view, "comb-lower");
        var handrail = Document(view, "handrail-left");
        var trussPosition = truss.position;
        for (int i = 1; i <= 5; i++) view.Apply(EscalatorState(view.ModuleId, i * 2.0));
        Assert.AreEqual(trussPosition, truss.position, "truss must not move with the band");
        Assert.IsTrue(Near(Document(view, "comb-lower"), comb, 1e-5f), "comb plate must not move");
        Assert.IsTrue(Near(Document(view, "handrail-left"), handrail, 1e-5f), "handrail must not move (static in TS)");
    }

    [Test]
    public void UnrelatedModuleStateDoesNotMoveTheView() {
        var save = Zoo();
        var view = Build(save, Module(save, "escalator-4060"));
        view.Apply(EscalatorState(view.ModuleId, 3.0));
        var before = Document(view, "tread-0");
        Assert.IsFalse(view.Apply(EscalatorState("escalator-4059", 40.0)), "a state for another module is rejected");
        Assert.IsTrue(Near(Document(view, "tread-0"), before, 1e-5f), "the unrelated module must not move");
    }

    /* ----------------------------------------------------------------- stair */

    static void AssertHandrails(VerticalModuleView view, int flights, bool[] leftWalls, bool[] rightWalls) {
        for (int flight = 0; flight < flights; flight++) {
            Assert.AreEqual(!leftWalls[flight], view.TryGetPart("handrail-left-" + flight, out _),
                view.ModuleId + " flight " + flight + " left handrail (wall suppresses it)");
            Assert.AreEqual(!rightWalls[flight], view.TryGetPart("handrail-right-" + flight, out _),
                view.ModuleId + " flight " + flight + " right handrail (wall suppresses it)");
        }
    }

    [Test]
    public void ZooStairsKeepTheirAuthoredWidthAndWallSuppressedRails() {
        var save = Zoo();
        var wallSides = SolidOf(save);
        foreach (var module in Modules(save, "stair")) {
            var view = Build(save, module, wallSides);
            var id = (string)module["id"];
            var style = (string)module["cfg"]["style"];
            Assert.IsFalse(view.UsedPrefab, id + " must not use the two-rail reference prefab when a wall hugs it");
            Assert.AreEqual("wall-sides", view.PrefabRejectReason, id + " rejection reason");
            var flights = (JArray)module["cfg"]["flights"];
            Assert.AreEqual(flights.Count, view.Parts.Count(part => part.Name.StartsWith("flight-", StringComparison.Ordinal)), id + " flight count");
            switch (id) {
                case "stair-straight-4061":
                    Assert.AreEqual("straight", style);
                    AssertHandrails(view, 1, new[] { true }, new[] { false });
                    Assert.AreEqual(new Vector3(81.5f, 16.5f, -4f), Document(view, "lower-landing"), id + " lower landing");
                    Assert.AreEqual(new Vector3(89.5f, 16.5f, 1f), Document(view, "upper-landing"), id + " upper landing");
                    break;
                case "stair-straight-4077":
                    AssertHandrails(view, 1, new[] { false }, new[] { true });
                    break;
                case "stair-straight-4078":
                    AssertHandrails(view, 1, new[] { true }, new[] { false });
                    break;
                case "stair-right180-4075":
                    Assert.AreEqual("right180", style);
                    AssertHandrails(view, 2, new[] { true, true }, new[] { false, false });
                    Assert.AreEqual(new Vector3(53.5f, 14.5f, -9f), Document(view, "lower-landing"), id + " lower landing");
                    Assert.AreEqual(new Vector3(51.5f, 14.5f, -4f), Document(view, "upper-landing"), id + " upper landing");
                    // `stairLandingShape` for the 180: x 50.105..53.895, y 10..11, surface z -7.5.
                    Assert.IsTrue(Near(Document(view, "turn-landing"), new Vector3(52f, 10.5f, -6.5f), 1e-3f), id + " half landing centre");
                    break;
                case "stair-right180-4291":
                    AssertHandrails(view, 2, new[] { true, true }, new[] { false, false });
                    Assert.IsTrue(Near(Document(view, "turn-landing"), new Vector3(84.5f, 17f, -11.5f), 1e-3f), id + " half landing centre");
                    break;
                default:
                    Assert.Fail("unexpected Zoo stair " + id);
                    break;
            }
            var tread = Document(view, "tread-sample-0");
            var firstFlight = (JObject)flights[0];
            float flightRise = Mathf.Abs((float)firstFlight["to"]["z"] - (float)firstFlight["from"]["z"]);
            Assert.AreEqual((float)firstFlight["from"]["z"] + 1f + flightRise * .5f, tread.z, 0.45f, id + " tread sample sits mid-flight");
        }
    }

    [Test]
    public void ExactStairPrefabIsUsedWhenNoWallHugsTheFlight() {
        var save = Zoo();
        var module = Module(save, "stair-straight-4061");
        var view = Build(save, module, (x, y, z) => false);
        Assert.IsTrue(view.UsedPrefab, "an open straight stair is exactly the promoted StairStraight prefab");
        Assert.AreEqual("stair-straight", view.PrefabKey);
        Assert.AreEqual(new Vector3(81.5f, 16.5f, -4f), Document(view, "lower-landing"), "anchor from the authored cells");
        Assert.AreEqual(new Vector3(89.5f, 16.5f, 1f), Document(view, "upper-landing"), "anchor from the authored cells");
        var size = new Vector3((float)(view.DocumentBounds.X1 - view.DocumentBounds.X0),
            (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0), (float)(view.DocumentBounds.Z1 - view.DocumentBounds.Z0));
        // The promoted straight stair is 1 m across, 8.25 m up the run and 6.32 m tall.
        Assert.AreEqual(1.0, Mathf.Min(size.x, size.y), 0.02f, "measured across extent");
        Assert.AreEqual(8.25, Mathf.Max(size.x, size.y), 0.02f, "measured run extent");
        Assert.AreEqual(6.3201, size.z, 0.02f, "measured elevation extent");
    }

    [Test]
    public void DimensionedStairsMeasureTheirAuthoredDimensions() {
        var save = Zoo();
        foreach (var module in Modules(save, "stair")) {
            var view = Build(save, module);
            var id = (string)module["id"];
            var size = new Vector3((float)(view.DocumentBounds.X1 - view.DocumentBounds.X0),
                (float)(view.DocumentBounds.Y1 - view.DocumentBounds.Y0), (float)(view.DocumentBounds.Z1 - view.DocumentBounds.Z0));
            float across = Mathf.Min(size.x, size.y);
            float run = Mathf.Max(size.x, size.y);
            bool turning = (string)module["cfg"]["style"] == "right180";
            Assert.GreaterOrEqual(across, turning ? 3.7f : 0.98f, id + " measured across extent covers the authored band");
            Assert.LessOrEqual(across, turning ? 4.1f : 1.02f, id + " measured across extent");
            Assert.GreaterOrEqual(run, turning ? 4.0f : 8.0f, id + " measured run extent");
            Assert.LessOrEqual(run, 8.8f, id + " measured run extent");
            Assert.GreaterOrEqual(size.z, 5.9f, id + " measured height reaches the handrail");
            Assert.LessOrEqual(size.z, 6.5f, id + " measured height");
        }
    }

    /* ------------------------------------------------------------------ lift */

    [Test]
    public void LiftsMatchTheirAuthoredStopsLevelsAndShaftHeight() {
        var save = Zoo();
        var shortLift = Build(save, Module(save, "lift-15"));
        CollectionAssert.AreEqual(new[] { -20.0, -15.0, -11.0 }, shortLift.Stops.ToArray(), "lift-15 stops");
        CollectionAssert.AreEqual(new[] { -20, -15 }, shortLift.Levels.ToArray(), "lift-15 levels");
        Assert.AreEqual(2, shortLift.PortalCount, "lift-15 portals");
        Assert.AreEqual(3, shortLift.Parts.Count(part => part.Name.StartsWith("stop-", StringComparison.Ordinal)), "lift-15 stop anchors");
        var tallLift = Build(save, Module(save, "lift-4076"));
        CollectionAssert.AreEqual(new[] { -15.0, -10.0, -5.0, -2.0 }, tallLift.Stops.ToArray(), "lift-4076 stops");
        CollectionAssert.AreEqual(new[] { -15, -10, -5 }, tallLift.Levels.ToArray(), "lift-4076 levels");
        Assert.AreEqual(3, tallLift.PortalCount, "lift-4076 portals");
        Assert.AreEqual(4, tallLift.Parts.Count(part => part.Name.StartsWith("stop-", StringComparison.Ordinal)), "lift-4076 stop anchors");
        foreach (var view in new[] { shortLift, tallLift }) {
            Assert.IsFalse(view.UsedPrefab, view.ModuleId + " is longer than the 5 m reference");
            Assert.AreEqual("dimensions", view.PrefabRejectReason, view.ModuleId + " rejection reason");
            double height = view.ModuleId == "lift-15" ? 9.0 : 13.0;
            Assert.AreEqual(height, view.DocumentBounds.Z1 - view.DocumentBounds.Z0, 0.05f, view.ModuleId + " shaft height");
            // The 2 x 2 shaft's posts are at Ãƒâ€šÃ‚Â±0.94 with a 0.14 section: 2.02 m plan.
            Assert.AreEqual(2.02, view.DocumentBounds.X1 - view.DocumentBounds.X0, 0.03f, view.ModuleId + " plan x");
            Assert.AreEqual(2.02, view.DocumentBounds.Y1 - view.DocumentBounds.Y0, 0.03f, view.ModuleId + " plan y");
        }
        // The landing door groups and their leaves are placed in the canonical lift
        // frame and must map document axes to Unity axes (a door leaf is 2.24 m tall in
        // world Y, never a horizontal plank, and its group sits on the storey, not at
        // the shaft side).
        var lowerDoorGroup = shortLift.Root.GetComponentsInChildren<Transform>(true).First(node => node.name == "landing-doors--20-front");
        var lowerLeaf = lowerDoorGroup.GetComponentsInChildren<MeshRenderer>(true).First();
        Assert.AreEqual(2.24, lowerLeaf.bounds.size.y, 0.02, "landing door leaf stands upright");
        Assert.AreEqual(-19.01, StationCoordinates.WorldToDocument(lowerDoorGroup.position).z, 0.06, "landing door group sits on the storey floor");
        // A landing-row cell anchor for the first served level (source liftLandingRows).
        Assert.IsTrue(Near(Document(shortLift, "stop--20"), new Vector3(86.5f, 10.5f, -19f), 1e-3f), "lift-15 lower landing anchor");
        Assert.IsTrue(Near(Document(tallLift, "stop--15"), new Vector3(78.5f, 14.5f, -14f), 1e-3f), "lift-4076 lower landing anchor");
    }

    [Test]
    public void LiftSnapshotMovesCabinAndOnlyTheAlignedLandingDoor() {
        var save = Zoo();
        var view = Build(save, Module(save, "lift-15"));
        // Parked at the bottom stop: cabin floor -19, doors shut.
        view.Apply(ModuleMotionState.Lift(view.ModuleId, 0f, 0f));
        var cabin = view.Root.GetComponentsInChildren<Transform>(true).First(node => node.name == "cabin");
        Assert.AreEqual(0.01f, cabin.localPosition.y, 1e-3f, "cabin floor sits on the lower landing");
        var lower = view.Root.GetComponentsInChildren<Transform>(true).First(node => node.name == "landing-doors--20-front");
        var upper = view.Root.GetComponentsInChildren<Transform>(true).First(node => node.name == "landing-doors--15-front");
        var lowerX = Leaves(lower).Select(leaf => leaf.localPosition.x).ToArray();
        var upperX = Leaves(upper).Select(leaf => leaf.localPosition.x).ToArray();
        // Move to the level -15 stop (cabin floor -14, fraction 5/9) and open.
        view.Apply(ModuleMotionState.Lift(view.ModuleId, 5f / 9f, 1f));
        Assert.AreEqual(5.01f, cabin.localPosition.y, 1e-3f, "cabin floor at the second level");
        CollectionAssert.AreEqual(lowerX, Leaves(lower).Select(leaf => leaf.localPosition.x).ToArray(), "the other landing stays shut");
        for (int i = 0; i < Leaves(upper).Count; i++) {
            float movement = Mathf.Abs(Leaves(upper)[i].localPosition.x - upperX[i]);
            Assert.Greater(movement, 0.09f, "aligned landing leaf " + i + " opens");
            Assert.LessOrEqual(movement, 0.51f, "aligned landing leaf " + i + " stays inside its travel");
        }
        var cabinDoor = view.Root.GetComponentsInChildren<Transform>(true).First(node => node.name == "cabin-door-front");
        Assert.IsTrue(Leaves(cabinDoor).Any(leaf => Mathf.Abs(leaf.localPosition.x) > 0.67f), "cabin doors open with the landing");
        // Between floors nothing opens.
        view.Apply(ModuleMotionState.Lift(view.ModuleId, 2.5f / 9f, 1f));
        Assert.AreEqual(lowerX.Length, Leaves(lower).Count);
        CollectionAssert.AreEqual(lowerX, Leaves(lower).Select(leaf => leaf.localPosition.x).ToArray(), "no door opens between floors");
        CollectionAssert.AreEqual(upperX, Leaves(upper).Select(leaf => leaf.localPosition.x).ToArray(), "no door opens between floors");
    }

    static List<Transform> Leaves(Transform group) =>
        group.Cast<Transform>().Where(child => child.name.StartsWith("lift-door-leaf", StringComparison.Ordinal)).ToList();

    [Test]
    public void LiftCycleHoldsTheDoorsThroughTheDwell() {
        var stops = new[] { -20.0, -15.0, -11.0 };
        var opening = VerticalModuleViews.SampleLiftCycle(stops, 1.0, true, 1);
        Assert.AreEqual("opening", opening.Phase);
        Assert.AreEqual(0.5f, opening.DoorFraction, 1e-4f);
        var dwellStart = VerticalModuleViews.SampleLiftCycle(stops, 2.0, true, 1);
        Assert.AreEqual("dwell", dwellStart.Phase);
        Assert.AreEqual(1f, dwellStart.DoorFraction, 1e-4f, "doors fully open for the six-second dwell");
        Assert.AreEqual(-20.0, dwellStart.CabinCellZ, 1e-6f);
        var dwellEnd = VerticalModuleViews.SampleLiftCycle(stops, 7.9, true, 1);
        Assert.AreEqual("dwell", dwellEnd.Phase);
        Assert.AreEqual(1f, dwellEnd.DoorFraction, 1e-4f);
        var closing = VerticalModuleViews.SampleLiftCycle(stops, 9.0, true, 1);
        Assert.AreEqual("closing", closing.Phase);
        Assert.AreEqual(0.5f, closing.DoorFraction, 1e-4f);
        var travel = VerticalModuleViews.SampleLiftCycle(stops, 12.0, true, 1);
        Assert.AreEqual("travel", travel.Phase);
        Assert.AreEqual(0f, travel.DoorFraction, 1e-4f, "doors shut before the car moves");
        Assert.Greater(travel.CabinCellZ, -20.0);
        Assert.Less(travel.CabinCellZ, -15.0);
        var paused = VerticalModuleViews.SampleLiftCycle(stops, 5.0, false, 1);
        Assert.AreEqual("idle", paused.Phase, "a paused lift holds its stop");
    }

    /* ------------------------------------------------------- no prefab scaling */

    [Test]
    public void NoWholePrefabOrDimensionedPieceIsScaled() {
        var save = Zoo();
        foreach (var type in new[] { "escalator", "stair", "lift" }) {
            foreach (var module in Modules(save, type)) {
                var view = Build(save, module);
                Assert.AreEqual(Vector3.one, view.Root.localScale, view.ModuleId + " view root scale");
                foreach (var transform in view.Root.GetComponentsInChildren<Transform>(true)) {
                    var scale = transform.lossyScale;
                    Assert.Greater(Mathf.Abs(scale.x) + Mathf.Abs(scale.y) + Mathf.Abs(scale.z), 0f, view.ModuleId + " degenerate scale on " + transform.name);
                    if (!view.UsedPrefab) continue;
                    // The driven escalator risers are legitimately height-scaled; the
                    // reference prefab itself is never scaled. The importer may carry a
                    // unit reflection on its root, so compare magnitudes.
                    if (transform.name.StartsWith("riser", StringComparison.Ordinal)) continue;
                    Assert.AreEqual(1f, Mathf.Abs(scale.x), 1e-4f, view.ModuleId + " prefab scale x on " + transform.name);
                    Assert.AreEqual(1f, Mathf.Abs(scale.y), 1e-4f, view.ModuleId + " prefab scale y on " + transform.name);
                    Assert.AreEqual(1f, Mathf.Abs(scale.z), 1e-4f, view.ModuleId + " prefab scale z on " + transform.name);
                }
            }
        }
    }
}








