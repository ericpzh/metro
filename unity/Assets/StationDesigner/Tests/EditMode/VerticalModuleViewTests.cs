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
/// canonical 9-cell / 5 m / 30Ã‚Â° / narrow run, so they instance the promoted
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
            // The 2 x 2 shaft's posts are at Ã‚Â±0.94 with a 0.14 section: 2.02 m plan.
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

    [Test]
    public void AGlassLiftKeepsItsSidesGlazedAndOnlyAStatedSteelHousingIsOpaque() {
        var save = Zoo();
        var glass = Build(save, Module(save, "lift-15"));
        // The Zoo save names no style on one lift and `glass` on the other; the source
        // defaults both to `buildGlassLift`, which has glazed panel bays and no side wall.
        Assert.AreEqual(0, glass.OpaqueShaftSidePanels,
            "a glazed lift has no full-height opaque side wall");
        var side = glass.Root.GetComponentsInChildren<MeshRenderer>(true)
            .First(renderer => renderer.name == "shaft-glass");
        Assert.IsNotNull(side, "the side panel bays are drawn");
        Assert.IsTrue(IsTransparent(side.sharedMaterial), "the side bays use the glass surface");
        int bays = Mathf.CeilToInt((float)(glass.DocumentBounds.Z1 - glass.DocumentBounds.Z0) / 2f);
        var sideMesh = side.GetComponent<MeshFilter>().sharedMesh;
        Assert.GreaterOrEqual(sideMesh.vertexCount, bays * 2 * 8,
            "one glazed bay on each side per two-metre story interval");

        var steelModule = (JObject)Module(save, "lift-15").DeepClone();
        ((JObject)steelModule["cfg"])["style"] = "steel";
        steelModule["id"] = "lift-steel";
        var steel = Build(save, steelModule);
        Assert.AreEqual(2, steel.OpaqueShaftSidePanels, "the solid steel style keeps its two side walls");
        Assert.AreNotEqual(glass.OpaqueShaftSidePanels, steel.OpaqueShaftSidePanels,
            "the style branch selects the housing, not a global default");
    }

    static bool IsTransparent(Material material) =>
        material != null && (material.renderQueue >= (int)UnityEngine.Rendering.RenderQueue.Transparent ||
            (material.HasProperty("_Surface") && material.GetFloat("_Surface") > .5f));

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

    /* --------------------------------------------------- block stair geometry */

    static VerticalModuleView BuildBlockStair(int rotation, double blockHeight, string finish,
        Func<string, (bool ok, Material material)> finishFor = null) {
        var module = JObject.Parse("{\"id\":\"stair-block\",\"type\":\"stair\",\"x\":2,\"y\":-29,\"z\":0," +
            "\"rot\":" + rotation + ",\"w\":1,\"d\":1," +
            "\"from\":{\"x\":2,\"y\":-30,\"z\":0},\"to\":{\"x\":2,\"y\":-28,\"z\":1}," +
            "\"cfg\":{\"width\":1,\"block\":true,\"blockHeight\":" +
            blockHeight.ToString(System.Globalization.CultureInfo.InvariantCulture) +
            ",\"finish\":\"" + finish + "\"}}");
        var parent = new GameObject("block stair test");
        Parents.Add(parent);
        var request = VerticalModuleRequest.FromFacts(ModuleFactsReader.Read(module), null, "stair-block",
            (x, y, z) => true, VerticalModuleViews.DefaultMaterial,
            finishFor == null ? null : new Func<string, Material>(id => finishFor(id).material));
        Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view), "the block stair did not build");
        Built.Add(view);
        return view;
    }

    /// <summary>
    /// Plan 22 §3: a 楼梯块 is a **solid** one-cell stair  four full-width treads for a 1 m rise,
    /// two for a 0.5 m one  built before any endpoint is read. Zoo/Tanwei's 56 block stairs used
    /// to go through the flight path, which drew thin treads, stringers and glass balustrades
    /// inside a one-metre cell (the magenta-caged tread cluster in the reference screenshot).
    /// </summary>
    [Test]
    public void ABlockStairIsASolidCellOfTreadsNotAFlight() {
        var view = BuildBlockStair(1, 1, "floor.concrete");
        Assert.IsFalse(view.UsedPrefab, "the block is assembled from its saved height, not a run prefab");
        var parts = view.Root.GetComponentsInChildren<Transform>(true)
            .Select(transform => transform.name).ToArray();
        CollectionAssert.Contains(parts, "treads");
        foreach (var forbidden in new[] { "handrails", "glass", "stringers", "soffit", "risers" }) {
            CollectionAssert.DoesNotContain(parts, forbidden, "a block stair draws no " + forbidden);
        }
        // The drawn cell: one metre square on its cell's floor top and exactly as tall as the rise.
        Assert.AreEqual(2f, view.DocumentBounds.X0, .02f);
        Assert.AreEqual(-29f, view.DocumentBounds.Y0, .02f);
        Assert.AreEqual(1f, view.DocumentBounds.Z0, .02f, "the block stands on its cell's floor top");
        Assert.AreEqual(2f, view.DocumentBounds.Z1, .02f, "a 1 m rise fills exactly one metre");
        Assert.AreEqual(1f, view.DocumentBounds.X1 - view.DocumentBounds.X0, .02f);
        Assert.AreEqual(1f, view.DocumentBounds.Y1 - view.DocumentBounds.Y0, .02f);
        // Four treads: the first is a quarter-metre deep and a quarter-metre high, the last a
        // full metre high. Read the mesh's own vertices rather than inferring it from a count.
        var treads = view.Root.GetComponentsInChildren<MeshFilter>(true).First(filter => filter.name == "treads");
        var heights = treads.sharedMesh.vertices.Select(vertex => treads.transform.TransformPoint(vertex))
            .Select(point => StationCoordinates.WorldToDocument(point).z).ToArray();
        Assert.AreEqual(1f, heights.Min(), .01f);
        Assert.AreEqual(2f, heights.Max(), .01f);
        var lowestTop = heights.Where(z => z > 1.1f).Min();
        Assert.AreEqual(1.25f, lowestTop, .01f, "the first tread's top is a quarter of the rise");
    }

    [Test]
    public void AHalfMetreBlockStairHasTwoTreads() {
        var view = BuildBlockStair(0, .5, "floor.concrete");
        Assert.AreEqual(1f, view.DocumentBounds.Z0, .02f, "the block stands on its cell's floor top");
        Assert.AreEqual(1.5f, view.DocumentBounds.Z1, .02f, "a 0.5 m rise is half a metre tall");
        var treads = view.Root.GetComponentsInChildren<MeshFilter>(true).First(filter => filter.name == "treads");
        var tops = treads.sharedMesh.vertices.Select(vertex => treads.transform.TransformPoint(vertex))
            .Select(point => StationCoordinates.WorldToDocument(point).z)
            .Where(z => z > 1.001f).Select(z => Mathf.Round(z * 100f) / 100f).Distinct().OrderBy(z => z).ToArray();
        CollectionAssert.AreEqual(new[] { 1.25f, 1.5f }, tops, "two treads fill a 0.5 m rise");
    }

    [Test]
    public void TheBlockStairWearsItsSavedFinishAndFallsBackToTheFloors() {
        var saved = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = "saved finish" };
        try {
            var view = BuildBlockStair(0, 1, "ceil.steel", _ => (true, saved));
            var renderer = view.Root.GetComponentsInChildren<MeshRenderer>(true).First();
            Assert.AreSame(saved, renderer.sharedMaterial, "`cfg.finish` wins");
            // With no saved override the block asks the floor it stands on, then the default.
            var asked = new List<string>();
            BuildBlockStair(0, 1, "", id => { asked.Add(id); return (false, null); });
            Assert.AreEqual(StationFinishIds.DefaultMaterial, asked.Last(),
                "a block with no override and no floor finish wears the documented default");
        } finally {
            UnityEngine.Object.DestroyImmediate(saved);
        }
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

    /* ----------------------------------------- Tanwei wide & multi-storey ramps */

    const string TanweiPath = "Assets/StationDesigner/Demos/tanwei.metro.json";

    static JObject Tanwei() => JObject.Parse(File.ReadAllText(TanweiPath));

    static VerticalModuleView BuildWithNeighbours(JObject save, JObject module, IReadOnlyList<ModuleFacts> neighbours) {
        var parent = new GameObject("vertical tanwei test");
        Parents.Add(parent);
        var facts = ModuleFactsReader.Read(module);
        var request = VerticalModuleRequest.FromFacts(facts, PrefabFor(module), KeyFor(module), SolidOf(save),
            null, null, null, neighbours);
        Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view), "build failed: " + (string)module["id"]);
        Built.Add(view);
        return view;
    }

    static List<ModuleFacts> AllFacts(JObject save) =>
        save["static"]["modules"].Children<JObject>().Select(m => ModuleFactsReader.Read(m)).Where(f => f != null).ToList();

    static Vector3[] MeshVerticesInDoc(Transform root, string childName) {
        var filter = root.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(f => f.name == childName);
        Assert.IsNotNull(filter, "missing mesh child '" + childName + "' under " + root.name);
        return filter.sharedMesh.vertices
            .Select(v => StationCoordinates.WorldToDocument(filter.transform.TransformPoint(v)))
            .ToArray();
    }

    static Vector3 TopSlopeNormalInDoc(Transform root, string childName) {
        var filter = root.GetComponentsInChildren<MeshFilter>(true).First(f => f.name == childName);
        var verts = filter.sharedMesh.vertices;
        var tris = filter.sharedMesh.triangles;
        var normals = filter.sharedMesh.normals;
        Vector3 bestNormal = Vector3.zero;
        float bestScore = float.MinValue;
        for (int i = 0; i + 2 < tris.Length; i += 3) {
            var a = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(verts[tris[i]]));
            var b = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(verts[tris[i + 1]]));
            var c = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(verts[tris[i + 2]]));
            float area = Vector3.Cross(b - a, c - a).magnitude * .5f;
            if (area < .5f) continue;
            var nWorld = filter.transform.TransformDirection(normals[tris[i]]).normalized;
            var nDoc = new Vector3(nWorld.x, nWorld.z, nWorld.y).normalized;
            float score = area * nDoc.z;
            if (score > bestScore) { bestScore = score; bestNormal = nDoc; }
        }
        return bestNormal;
    }

    [Test]
    public void ProceduralEscalatorsKeepTrussBelowTreadsAndLevelPlatesAcrossHeadingsAndOrders() {
        var headings = new (int dx, int dy, int rot)[] {
            (0, 9, 0), (9, 0, 1), (0, -9, 2), (-9, 0, 3),
        };
        foreach (var h in headings) {
            foreach (bool ascending in new[] { true, false }) {
                int ax = 10, ay = 10, az = 0;
                int bx = 10 + h.dx, by = 10 + h.dy, bz = 5;
                int fx = ascending ? ax : bx, fy = ascending ? ay : by, fz = ascending ? az : bz;
                int tx = ascending ? bx : ax, ty = ascending ? by : ay, tz = ascending ? bz : az;
                var json = JObject.Parse("{\"id\":\"probe-" + h.rot + "-" + (ascending ? "up" : "down") +
                    "\",\"type\":\"escalator\",\"x\":" + fx + ",\"y\":" + fy + ",\"z\":" + fz + ",\"rot\":" + h.rot +
                    ",\"from\":{\"x\":" + fx + ",\"y\":" + fy + ",\"z\":" + fz + "}," +
                    "\"to\":{\"x\":" + tx + ",\"y\":" + ty + ",\"z\":" + tz + "}," +
                    "\"cfg\":{\"incline\":30,\"dir\":\"" + (ascending ? "up" : "down") + "\",\"width\":2}}");
                var parent = new GameObject("heading probe");
                Parents.Add(parent);
                var req = VerticalModuleRequest.FromFacts(ModuleFactsReader.Read(json), LoadPrefab("Escalator"), "escalator", (x, y, z) => false);
                Assert.IsTrue(VerticalModuleViews.TryBuild(req, parent.transform, out var view));
                Built.Add(view);
                Assert.IsFalse(view.UsedPrefab, view.ModuleId + " wide run uses procedural builder");

                // Housing top normal points above the treads (+Z in document axes, cos(30°) ≈ 0.866).
                var trussTopNormal = TopSlopeNormalInDoc(view.Root, "truss");
                Assert.Greater(trussTopNormal.z, .8f, view.ModuleId + " truss top normal must point upward, got " + trussTopNormal);

                // Truss stays strictly below the walking line at the midpoint while treads sit on it.
                var lower = Document(view, "band-lower");
                var upper = Document(view, "band-upper");
                var mid = (lower + upper) * .5f;
                var trussVerts = MeshVerticesInDoc(view.Root, "truss");
                float trussMidZ = trussVerts.Average(v => v.z);
                Assert.Less(trussMidZ, mid.z - .2f, view.ModuleId + " truss must sit below the walking line");

                // Comb plates and U-shaped landing decks lie level on the lower and upper floors.
                var combVerts = MeshVerticesInDoc(view.Root, "comb-plate");
                Assert.LessOrEqual(combVerts.Where(v => v.z < mid.z).Max(v => v.z) - combVerts.Where(v => v.z < mid.z).Min(v => v.z), .055f,
                    view.ModuleId + " lower comb plate must lie flat (5 cm thick), never upright");
                Assert.LessOrEqual(combVerts.Where(v => v.z > mid.z).Max(v => v.z) - combVerts.Where(v => v.z > mid.z).Min(v => v.z), .055f,
                    view.ModuleId + " upper comb plate must lie flat (5 cm thick), never upright");
                var deckVerts = MeshVerticesInDoc(view.Root, "landing-deck");
                Assert.Greater(deckVerts.Length, 0, view.ModuleId + " landing-deck built");

                // Static shell and animated step band share the same endpoints in both travel orders.
                Assert.IsTrue(view.TryGetPart("band", out var bandGroup), view.ModuleId + " band group");
                var visibleTreads = Enumerable.Range(0, view.StepCount)
                    .Select(i => bandGroup.Find("tread-" + i))
                    .Where(t => t != null && t.gameObject.activeSelf)
                    .Select(t => StationCoordinates.WorldToDocument(t.position))
                    .ToArray();
                Assert.Greater(visibleTreads.Length, 10, view.ModuleId + " visible treads");
                Assert.AreEqual(lower.z, visibleTreads.Min(t => t.z), .05f, view.ModuleId + " treads start at lower landing");
                Assert.AreEqual(upper.z, visibleTreads.Max(t => t.z), .05f, view.ModuleId + " treads reach upper landing");
                var midTread = visibleTreads.OrderBy(t => new Vector2(t.x - mid.x, t.y - mid.y).sqrMagnitude).First();
                var spanPlan = new Vector2(upper.x - lower.x, upper.y - lower.y);
                float uAtTread = Vector2.Dot(new Vector2(midTread.x - lower.x, midTread.y - lower.y), spanPlan) / spanPlan.sqrMagnitude;
                float trussZAtTread = Mathf.Lerp(lower.z, upper.z, uAtTread) - (mid.z - trussMidZ);
                Assert.Greater(midTread.z, trussZAtTread + .2f, view.ModuleId + " treads sit above the truss");
            }
        }

        // Tanwei's ascending width-2 `escalator-9672` and descending width-2 control `escalator-9671`.
        var tanwei = Tanwei();
        var neighbours = AllFacts(tanwei);
        var ascWide = BuildWithNeighbours(tanwei, Module(tanwei, "escalator-9672"), neighbours);
        var descWide = BuildWithNeighbours(tanwei, Module(tanwei, "escalator-9671"), neighbours);
        Assert.AreEqual(3f, Document(ascWide, "lower-landing").x, 1e-3f, "escalator-9672 centres across X=2..4 at X=3");
        Assert.AreEqual(24f, Document(descWide, "lower-landing").x, 1e-3f, "escalator-9671 descending control centres across X=23..25 at X=24");
        Assert.IsTrue(Near(Document(descWide, "lower-landing"), new Vector3(24f, -13.5f, 2f), 1e-3f), "escalator-9671 lower-landing is z=2");
        Assert.IsTrue(Near(Document(descWide, "upper-landing"), new Vector3(24f, -4.5f, 7f), 1e-3f), "escalator-9671 upper-landing is z=7");
        Assert.Greater(TopSlopeNormalInDoc(ascWide.Root, "truss").z, .8f, "escalator-9672 truss normal upward");
        Assert.Greater(TopSlopeNormalInDoc(descWide.Root, "truss").z, .8f, "escalator-9671 truss normal upward");
        Assert.IsNotNull(ascWide.Root.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(f => f.name == "undercroft"),
            "escalator-9672 builds undercroft wedge");
        Assert.IsNotNull(ascWide.Root.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(f => f.name == "balustrade-left"),
            "escalator-9672 builds rounded balustrade glass");
    }

    [Test]
    public void TanweiTwinElevenMetreEscalatorsAlignAtUpperLandingAndShareOneRampJoin() {
        var tanwei = Tanwei();
        var neighbours = AllFacts(tanwei);
        var upRun = BuildWithNeighbours(tanwei, Module(tanwei, "escalator-9667"), neighbours);
        var downRun = BuildWithNeighbours(tanwei, Module(tanwei, "escalator-9668"), neighbours);

        Assert.IsFalse(upRun.UsedPrefab, "11 m rise uses procedural builder");
        Assert.IsFalse(downRun.UsedPrefab, "11 m rise uses procedural builder");
        Assert.AreEqual(upRun.StepCount, downRun.StepCount, "twin 11 m runs have matching step counts");
        Assert.GreaterOrEqual(upRun.StepCount, 55, "20 m / 11 m chain carries two-storey step count");

        // Aligned at both lower (-9) and upper (+2) landings for the full 11 m rise.
        Assert.IsTrue(Near(Document(upRun, "lower-landing"), new Vector3(8.5f, 4.5f, -9f), 1e-3f));
        Assert.IsTrue(Near(Document(upRun, "upper-landing"), new Vector3(8.5f, -15.5f, 2f), 1e-3f));
        Assert.IsTrue(Near(Document(downRun, "lower-landing"), new Vector3(9.5f, 4.5f, -9f), 1e-3f));
        Assert.IsTrue(Near(Document(downRun, "upper-landing"), new Vector3(9.5f, -15.5f, 2f), 1e-3f));

        // Independent step bands moving in opposite travel directions.
        int midStep = upRun.StepCount / 2;
        Assert.IsTrue(upRun.TryGetPart("band", out var upBand));
        Assert.IsTrue(downRun.TryGetPart("band", out var downBand));
        upRun.Apply(EscalatorState(upRun.ModuleId, 0.0));
        downRun.Apply(EscalatorState(downRun.ModuleId, 0.0));
        var upT0 = StationCoordinates.WorldToDocument(upBand.Find("tread-" + midStep).position);
        var downT0 = StationCoordinates.WorldToDocument(downBand.Find("tread-" + midStep).position);
        upRun.Apply(EscalatorState(upRun.ModuleId, 1.0));
        downRun.Apply(EscalatorState(downRun.ModuleId, 1.0));
        var upT1 = StationCoordinates.WorldToDocument(upBand.Find("tread-" + midStep).position);
        var downT1 = StationCoordinates.WorldToDocument(downBand.Find("tread-" + midStep).position);
        Assert.Greater(upT1.z - upT0.z, .15f, "escalator-9667 climbs upward");
        Assert.Less(downT1.z - downT0.z, -.15f, "escalator-9668 travels downward");

        // Single stainless-steel `ramp-join` + tactile domes on the boundary X = 9.0.
        Assert.IsTrue(upRun.TryGetPart("ramp-join", out _), "lexicographically first twin owns ramp-join");
        Assert.IsFalse(downRun.TryGetPart("ramp-join", out _), "second twin does not duplicate ramp-join");
        var joinVerts = MeshVerticesInDoc(upRun.Root, "ramp-join");
        Assert.AreEqual(9f, joinVerts.Average(v => v.x), .02f, "ramp-join straddles X = 9 between lanes 8 and 9");
        Assert.IsNotNull(upRun.Root.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(f => f.name == "ramp-join-dome"),
            "twin escalator seam carries anti-slide domes");
    }

    [Test]
    public void TanweiBuildInputDerivesSlopeCutsAndGradeOpeningsWithoutDeletingSavedSolids() {
        var read = StationDocumentReader.ReadFile(TanweiPath);
        Assert.IsNotNull(read?.Document, "Tanwei fixture must parse");
        var doc = read.Document;
        var notes = new List<string>();
        var input = StationCellRenderer.BuildInput(doc, null, notes, null);

        int docSolids = doc.Cells.Count(c => c.IsSolid);
        int meshSolids = input.Cells.Count(c => c.Solid);
        Assert.AreEqual(docSolids, meshSolids, "exact slope cuts retain every saved Tanwei solid cell");

        var pinnedSlopeCells = new[] {
            new StationCellKey(8, -4, -6),
            new StationCellKey(9, -4, -6),
            new StationCellKey(2, -13, 1),
            new StationCellKey(3, -13, 1),
            new StationCellKey(37, 40, 3),
        };
        foreach (var key in pinnedSlopeCells) {
            Assert.IsTrue(input.SlopeCuts.ContainsKey(key), "missing derived slope cut at " + key);
            var cut = input.SlopeCuts[key];
            Assert.Less(Math.Min(cut.Lo, cut.Hi), 1.0 - 1e-3, key + " slope patch shaves below full cell height");
        }

        for (int x = 8; x <= 9; x++) {
            for (int y = -12; y <= -9; y++) {
                var hole = new StationCellKey(x, y, 0);
                Assert.IsTrue(input.GroundHoles.Contains(hole), "missing grade corridor hole at " + hole);
            }
        }
        Assert.IsTrue(notes.Any(n => n.StartsWith("ramp-slope-applied:", StringComparison.Ordinal)), "slope note recorded");
        Assert.IsTrue(notes.Any(n => n.StartsWith("ramp-openings-applied:", StringComparison.Ordinal)), "grade opening note recorded");

        // Meshing the input emits sloped underside top caps strictly below `z + 1` on the retained cells.
        var meshed = StationCellMesher.Mesh(input);
        Assert.Greater(meshed.SlopeCutCells, 0, "mesher shaved slope-cut cells");
        foreach (var key in pinnedSlopeCells) {
            int faceIdx = meshed.Faces.FindIndex(f => f.CellKey.Equals(key) && f.Face == StationFace.Top);
            Assert.GreaterOrEqual(faceIdx, 0, "mesher must emit retained Top cap on " + key);
            float minCapZ = float.MaxValue;
            foreach (var group in meshed.Groups) {
                if (group.TriangleFaces == null) continue;
                for (int t = 0; t < group.TriangleFaces.Length; t++) {
                    if (group.TriangleFaces[t] != faceIdx) continue;
                    for (int v = 0; v < 3; v++)
                        minCapZ = Mathf.Min(minCapZ, group.Positions[group.Indices[t * 3 + v]].z);
                }
            }
            Assert.Less(minCapZ, key.Z + .99f, key + " retained cap must slope below uncut z + 1");
        }
    }

    [Test]
    public void TanweiWideQuarterTurnStairsKeepFractionalLandingsAndFittedSupport() {
        var tanwei = Tanwei();
        var neighbours = AllFacts(tanwei);

        var fractional = BuildWithNeighbours(tanwei, Module(tanwei, "stair-right90-9712"), neighbours);
        Assert.IsFalse(fractional.UsedPrefab);
        Assert.IsTrue(Near(Document(fractional, "turn-landing"), new Vector3(37f, 39f, -1.5f), 1e-3f),
            "fractional -2.5 landing places its platform top at z = -1.5 across (36..38, 38.105..39.895)");
        Assert.IsTrue(Near(Document(fractional, "lower-landing"), new Vector3(37.5f, 43.5f, -4f), 1e-3f));
        Assert.IsTrue(Near(Document(fractional, "upper-landing"), new Vector3(32.5f, 39.5f, 1f), 1e-3f));
        Assert.IsTrue(Near(Document(fractional, "flight-0"), new Vector3(37f, 43.5f, -4f), 1e-3f),
            "2-lane flight-0 slides onto X = 37 across lanes 36..38");
        Assert.IsTrue(Near(Document(fractional, "flight-1"), new Vector3(36.5f, 39f, -1.5f), 1e-3f),
            "2-lane flight-1 slides onto Y = 39 across lanes 38..40");
        var landingSurface = MeshVerticesInDoc(fractional.Root, "landing-surface");
        Assert.AreEqual(36f, landingSurface.Min(v => v.x), 1e-3f);
        Assert.AreEqual(38f, landingSurface.Max(v => v.x), 1e-3f);
        Assert.AreEqual(38.105f, landingSurface.Min(v => v.y), 1e-3f);
        Assert.AreEqual(39.895f, landingSurface.Max(v => v.y), 1e-3f);
        Assert.AreEqual(-1.5f, landingSurface.Max(v => v.z), 1e-3f);

        var sixMetre = BuildWithNeighbours(tanwei, Module(tanwei, "stair-right90-9516"), neighbours);
        Assert.IsFalse(sixMetre.UsedPrefab);
        Assert.IsTrue(Near(Document(sixMetre, "turn-landing"), new Vector3(38f, 42f, 4f), 1e-3f),
            "stair-right90-9516 intermediate landing sits at z = 4 across (37.105..38.895, 41..43)");
        Assert.AreEqual(6f, Document(sixMetre, "upper-landing").z - Document(sixMetre, "lower-landing").z, 1e-3f,
            "stair-right90-9516 spans the full 6 m rise");
    }
}








