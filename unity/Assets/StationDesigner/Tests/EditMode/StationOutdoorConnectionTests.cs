using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// RCA 15 §4 and §6 pins for the two connection rules the outdoor families were missing.
///
/// * `StationFenceConnections` — the document-level port of `fenceConnectionIndex`
///   (`game/src/sim/fences.ts`): a fence joins a fence, a **gate machine face** and a **rail
///   landing** (a stair's full-width band, an escalator's or walkway's landings). The
///   endpoints `FenceArms` derives from those sides are compared exactly, before and after
///   removing one neighbour, because a junction that keeps a cap overhangs the turn.
/// * `StationTactileArms` — the port of `tactileArms` (`game/src/sim/floorDecor.ts`), read in
///   the tile's own frame, including a join that crosses a 16×16 chunk boundary.
/// * `StationExitOpenings` — the port of `exitRunOpenings` / `exitLandingBack`
///   (`game/src/sim/exits.ts`) for both saved Zoo exits, and the proof that the ground mask and
///   the paver exclusion cover the same cells.
///
/// The Zoo expectations are the TypeScript oracle's own values, recorded by running
/// `fenceConnectionIndex` / `tactileArms` / `exitRunOpenings` over the shipped save.
/// </summary>
public class StationOutdoorConnectionTests {
    const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
    const int TwoAxisJunctions = 16;
    const int OneAxisRuns = 195;
    const int IsolatedPanels = 2;

    static StationDocument zoo;
    static ModuleFacts[] zooFacts;

    [OneTimeSetUp]
    public void LoadZoo() {
        var read = StationDocumentReader.ReadFile(ZooPath);
        Assert.IsNotNull(read, "Zoo fixture missing: " + ZooPath);
        zoo = read.Document;
        zooFacts = zoo.Modules.Select(module => module.Facts).ToArray();
        Assert.AreEqual(4299, zooFacts.Length, "the Zoo fixture's module count changed");
    }

    // ------------------------------------------------------------------ fixtures

    static ModuleFacts.Point At(int x, int y, int z) => new ModuleFacts.Point { X = x, Y = y, Z = z, HasValue = true };

    static ModuleConfig Config(params (string key, string value)[] values) {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var pair in values) map[pair.key] = pair.value;
        return new ModuleConfig(map);
    }

    static ModuleFacts Fence(string id, int x, int y, int z = 0, int rotation = 0, string variant = null) =>
        new ModuleFacts {
            Id = id, Type = "fence", X = x, Y = y, Z = z, Rotation = rotation,
            Config = variant == null ? ModuleConfig.Empty : Config(("variant", variant)),
        };

    static ModuleFacts Gate(string id, int x, int y, int z, int rotation, string door) =>
        new ModuleFacts { Id = id, Type = "gate", X = x, Y = y, Z = z, Rotation = rotation, Config = Config(("door", door)) };

    static ModuleFacts Run(string type, string id, int fromX, int fromY, int fromZ, int toX, int toY, int toZ,
        double width = 0, string style = null) {
        var values = new List<(string, string)>();
        if (width > 0) values.Add(("width", width.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)));
        if (style != null) values.Add(("style", style));
        return new ModuleFacts {
            Id = id, Type = type, X = fromX, Y = fromY, Z = fromZ, Rotation = 0,
            From = At(fromX, fromY, fromZ), To = At(toX, toY, toZ),
            Config = Config(values.ToArray()),
        };
    }

    static ModuleFacts Tactile(string id, int x, int y, int z, int rotation, string variant) =>
        new ModuleFacts {
            Id = id, Type = "tactile", X = x, Y = y, Z = z, Rotation = rotation,
            Config = Config(("variant", variant)),
        };


    static ModuleFacts Find(string id) => zooFacts.First(module => module.Id == id);

    static string Describe(OutdoorFenceArms arms) =>
        "x[" + arms.X0 + "," + arms.X1 + "] y[" + arms.Y0 + "," + arms.Y1 + "] caps " +
        (((arms.CapEast ? "E" : "") + (arms.CapWest ? "W" : "") + (arms.CapNorth ? "N" : "") + (arms.CapSouth ? "S" : "")) is var caps && caps.Length > 0 ? caps : "none");

    // ------------------------------------------------------- §4.1 fence index

    [Test]
    public void FenceIndexJoinsOnlyAGatesMachineFace() {
        // `gateMachineSide` is the gate's local −x, so a lane gate presents a solid face only
        // toward that side: a run butts into the machine and ends at the doorway on the other.
        var east = new[] { Fence("fence-a", 0, 0), Gate("gate-a", 1, 0, 0, 0, "lane") };
        var index = StationFenceConnections.For(east);
        index.Sides(east[0], out var e, out var w, out var n, out var s);
        Assert.IsTrue(e, "a gate whose machine stands toward the fence joins the run");
        Assert.IsFalse(w, "the outside cell holds nothing");
        Assert.IsFalse(n, "a diagonal cell is not a neighbour");
        Assert.IsFalse(s, "a diagonal cell is not a neighbour");

        // Turned a half turn, the same gate's body faces away: the run must end at its own post.
        var turned = new[] { Fence("fence-a", 0, 0), Gate("gate-a", 1, 0, 0, 2, "lane") };
        var turnedIndex = StationFenceConnections.For(turned);
        turnedIndex.Sides(turned[0], out e, out w, out n, out s);
        Assert.IsFalse(e, "a gate's lane side is a doorway, not a joint");

        // A doorless (fence) machine is solid all round, so both sides join.
        var doorless = new[] { Fence("fence-a", 0, 0), Gate("gate-a", 1, 0, 0, 2, "fence") };
        StationFenceConnections.For(doorless).Sides(doorless[0], out e, out _, out _, out _);
        Assert.IsTrue(e, "a fence gate is solid on every side");
        Assert.IsTrue(StationFenceConnections.GateSolidFaces(Gate("g", 0, 0, 0, 0, "fence"), 9, 9),
            "a doorless gate is solid on every face");
        Assert.IsFalse(StationFenceConnections.GateSolidFaces(Gate("g", 0, 0, 0, 0, "lane"), 9, 9),
            "a lane gate is solid only toward its body");
        Assert.IsTrue(StationFenceConnections.GateSolidFaces(Gate("g", 0, 0, 0, 0, "lane"), -1, 0),
            "rot 0 puts the machine on the local −x half");
    }

    [Test]
    public void FenceIndexJoinsARailLanding() {
        // A straight .68 m stair lands on its two end cells; its band is the whole cell across
        // the run, so a fence beside either end butts into the handrail.
        var stair = Run("stair", "stair-a", 0, 0, 0, 0, 4, 0, .68, "straight");
        var escalator = Run("escalator", "esc-a", 10, 0, 0, 10, 3, 0);
        var walkway = Run("walkway", "walk-a", 20, 0, 0, 20, 3, 0);
        var modules = new[] { stair, escalator, walkway, Fence("fence-stair", 1, 0), Fence("fence-esc", 11, 0), Fence("fence-walk", 21, 0) };
        var index = StationFenceConnections.For(modules);

        Assert.IsTrue(index.HasRailLanding(0, 0, 0), "the stair's lower landing opens the fence run");
        Assert.IsTrue(index.HasRailLanding(0, 4, 0), "the stair's upper landing opens the fence run");
        Assert.IsFalse(index.HasRailLanding(0, 2, 0), "the middle of the run is not a landing");
        Assert.IsTrue(index.HasRailLanding(10, 0, 0), "an escalator landing counts");
        Assert.IsTrue(index.HasRailLanding(20, 3, 0), "a walkway landing counts");

        index.Sides(modules[3], out _, out var west, out _, out _);
        Assert.IsTrue(west, "the fence beside the stair's lower landing butts into the rail");
        index.Sides(modules[4], out _, out west, out _, out _);
        Assert.IsTrue(west, "the fence beside the escalator's lower landing joins");
        index.Sides(modules[5], out _, out west, out _, out _);
        Assert.IsTrue(west, "the fence beside the walkway's lower landing joins");
    }

    [Test]
    public void FenceIndexReadsTheZooJunctionSetTheSourceDoes() {
        var index = StationFenceConnections.ForDocument(zoo);
        Assert.AreEqual(213, index.FenceModules, "every Zoo fence is in the index");
        Assert.AreEqual(15, index.GateModules, "every Zoo gate is in the index");
        Assert.Greater(index.LandingCells, 0, "Zoo's stairs and escalators contribute landings");

        int twoAxis = 0, oneAxis = 0, isolated = 0;
        foreach (var fence in zooFacts.Where(module => module.Type == "fence")) {
            index.Sides(fence, out var e, out var w, out var n, out var s);
            // Count the **sides**, not the arms: a degree-0 panel still draws a capped full
            // span, so `FenceArms` alone would call it a run.
            int alongX = (e ? 1 : 0) + (w ? 1 : 0), alongY = (n ? 1 : 0) + (s ? 1 : 0);
            if (alongX > 0 && alongY > 0) twoAxis++;
            else if (alongX > 0 || alongY > 0) oneAxis++;
            else isolated++;
        }
        // The oracle's own counts: `fenceConnectionIndex` over zoo.metro.json. The fence-only
        // scan the renderer used before this port saw 4 isolated / 36 end / 173 joined panels and
        // 12 fences with the wrong arms.
        Assert.AreEqual(TwoAxisJunctions, twoAxis, "L, T and + junctions in Zoo");
        Assert.AreEqual(OneAxisRuns, oneAxis, "straight runs and single arms in Zoo");
        Assert.AreEqual(IsolatedPanels, isolated, "isolated panels in Zoo");

        // The exact join: fence-81 stands beside gate-245 (a doorless machine) to its west and a
        // fence to its south, which is the corner the screenshot shows.
        var corner = Find("fence-81");
        index.Sides(corner, out var ce, out var cw, out var cn, out var cs);
        Assert.IsFalse(ce, "fence-81 has no east neighbour");
        Assert.IsTrue(cw, "fence-81's west neighbour is gate-245's machine face");
        Assert.IsFalse(cn, "fence-81 has no north neighbour");
        Assert.IsTrue(cs, "fence-81 joins the fence to its south");
        Assert.AreEqual("x[-0.5,0] y[-0.5,0] caps none", Describe(OutdoorModuleViews.FenceArms(corner.Rotation,
            new OutdoorNeighbours { Known = true, East = ce, West = cw, North = cn, South = cs })),
            "fence-81 is the SW corner of its join");
    }

    // ------------------------------------------------- §4.3 arm composition

    [Test]
    public void FenceArmsEndpointsChangeWhenOneNeighbourIsRemoved() {
        // A synthetic corner: one neighbour west, one south.
        var corner = Fence("fence-a", 0, 0, 0, 0);
        var neighbours = new[] { corner, Fence("fence-w", -1, 0), Fence("fence-s", 0, -1) };
        var index = StationFenceConnections.For(neighbours);
        index.Sides(corner, out var e, out var w, out var n, out var s);
        var before = OutdoorModuleViews.FenceArms(corner.Rotation, new OutdoorNeighbours { Known = true, East = e, West = w, North = n, South = s });
        Assert.AreEqual("x[-0.5,0] y[-0.5,0] caps none", Describe(before), "a corner draws a half panel per arm and no cap");

        // Remove the south neighbour and rebuild: the run now ends, so it reaches the far edge
        // and caps there — the end post the source puts on a dead end.
        var withoutSouth = neighbours.Where(module => module.Id != "fence-s").ToArray();
        var rebuilt = StationFenceConnections.For(withoutSouth);
        rebuilt.Sides(corner, out e, out w, out n, out s);
        var after = OutdoorModuleViews.FenceArms(corner.Rotation, new OutdoorNeighbours { Known = true, East = e, West = w, North = n, South = s });
        Assert.AreEqual("x[-0.5,0.5] y[0,0] caps E", Describe(after), "a run end caps the far edge opposite its neighbour");

        // The same rule on the shipped join: removing gate-245 turns fence-81's corner into a
        // straight run that caps its north end.
        var real = StationFenceConnections.ForDocument(zoo);
        real.Sides(Find("fence-81"), out e, out w, out n, out s);
        var realBefore = OutdoorModuleViews.FenceArms(Find("fence-81").Rotation,
            new OutdoorNeighbours { Known = true, East = e, West = w, North = n, South = s });
        Assert.AreEqual("x[-0.5,0] y[-0.5,0] caps none", Describe(realBefore), "fence-81 is the SW corner of its join");

        var withoutGate = zooFacts.Where(module => module.Id != "gate-245").ToArray();
        var realRebuilt = StationFenceConnections.For(withoutGate);
        realRebuilt.Sides(Find("fence-81"), out e, out w, out n, out s);
        var realAfter = OutdoorModuleViews.FenceArms(Find("fence-81").Rotation,
            new OutdoorNeighbours { Known = true, East = e, West = w, North = n, South = s });
        Assert.AreEqual("x[0,0] y[-0.5,0.5] caps N", Describe(realAfter),
            "with the gate gone the panel runs north/south to its far edge and caps north");
    }

    [Test]
    public void AJunctionComposesItsArmsInsteadOfClaimingOnePanel() {
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        Assert.IsTrue(catalogue.TryGet("fence", out var entry), "no glass fence prefab");
        var corner = Fence("fence-corner", 0, 0, 0, 0);
        var neighbourhood = new[] { corner, Fence("fence-w", -1, 0), Fence("fence-n", 0, 1) };
        var request = new OutdoorModuleRequest {
            ModuleId = corner.Id, Type = corner.Type, ViewKey = "fence", Variant = "",
            X = corner.X, Y = corner.Y, Z = corner.Z, Rotation = corner.Rotation,
            Width = 1, Depth = 1, Prefab = entry.prefab, Catalogue = catalogue,
            Placement = OutdoorPlacement.ParentPlaced,
            Neighbours = OutdoorModuleViews.Neighbours(corner, neighbourhood),
        };
        var holder = new GameObject("fence corner pivot");
        try {
            Assert.IsTrue(OutdoorModuleViews.TryBuild(request, holder.transform, null, out var view), view.Diagnostic);
            Assert.AreEqual(2, view.ComposedArms, "a corner composes two arms: " + view.Diagnostic);
            StringAssert.Contains("fence-arms-composed:2arms", view.Diagnostic, "the composition is reported by name");
            Assert.IsTrue(view.PanelExtentMatchesSource, "the composed geometry is exactly the arms the source draws");
            // The composed steel and glass parts exist and the isolated panel's end posts do not.
            var renderers = view.Instance.GetComponentsInChildren<MeshRenderer>(true);
            Assert.AreEqual(2, renderers.Length, "one steel mesh and one glass mesh");
            var steel = renderers.First(renderer => renderer.sharedMaterials.Any(material => material && material.name.ToLowerInvariant().Contains("steel")));
            Assert.IsNotNull(steel, "the composed arms keep the prefab's steel material");
            Assert.IsTrue(renderers.Any(renderer => renderer.sharedMaterials.Any(material => material && material.name.ToLowerInvariant().Contains("glass"))),
                "the composed arms keep the prefab's glass material");
            var bounds = steel.GetComponent<MeshFilter>().sharedMesh.bounds;
            Assert.AreEqual(-.5f, bounds.min.x, .01f, "the west arm reaches the cell edge");
            Assert.AreEqual(.5f, bounds.max.z, .01f, "the north arm reaches the cell edge");
        } finally {
            UnityEngine.Object.DestroyImmediate(holder);
        }
    }

    // ------------------------------------------------------- §4.4 tactile arms

    [Test]
    public void TactileArmMaskMatchesTheSourceCornerAndCrow() {
        // The oracle's own masks for four saved tiles: a corner, a T, a cross and a strip.
        AssertArms("tactile-4334", 0, 1, 1, 0);       // (72,16,-15) warning, rot 3: east + north
        AssertArms("tactile-4296", 0, -1, 0, 1, 1, 0); // (88,2,-15) warning, rot 1: a three-arm T
        AssertArms("tactile-4335", 0, 1);              // (80,16,-5) warning-strip, rot 1: crosswise only
        AssertArms("tactile-4278", 0, -1, 1, 0);       // (78,16,-15) warning, rot 3
        // A strip never grows an arm along its own run: its one-metre top already covers it.
        foreach (var strip in zooFacts.Where(module => module.Type == "tactile" && module.Config.Text("variant") == "warning-strip")) {
            foreach (var arm in StationTactileArms.Arms(strip, zooFacts)) {
                Assert.AreEqual(0, arm.DX, "a strip's arm is crosswise in its own frame at " + strip.Id);
            }
        }
        // A guide tile's model never consumes the rule (`TactileModel.build` draws its ribs), so
        // the geometry port must not add an arm to the 41 saved guides.
        var guide = Find("tactile-698");
        Assert.IsFalse(StationTactileArms.Applies(guide), "a guide tile has no arm geometry");
        Assert.AreEqual(0, StationTactileArms.Arms(guide, zooFacts).Count, "a guide tile composes nothing");
        Assert.IsTrue(StationTactileArms.Applies(Find("tactile-4335")), "a warning strip composes arms");
    }

    static void AssertArms(string id, params int[] expected) {
        var tile = Find(id);
        var arms = StationTactileArms.Arms(tile, zooFacts);
        var actual = string.Join(";", arms.Select(arm => arm.DX + "," + arm.DY));
        var want = string.Join(";", Enumerable.Range(0, expected.Length / 2).Select(i => expected[i * 2] + "," + expected[i * 2 + 1]));
        Assert.AreEqual(want, actual, "tactile arms for " + id);
    }

    [Test]
    public void TactileArmsCrossAChunkBoundary() {
        // x = 15 and x = 16 are in different 16×16 chunks. The mask is derived from the document,
        // so both tiles compose the arm the other meets — the batching cannot swallow it.
        var left = Tactile("tactile-left", 15, 0, 0, 0, "warning");
        var right = Tactile("tactile-right", 16, 0, 0, 0, "warning");
        var modules = new[] { left, right };
        var leftArms = StationTactileArms.Arms(left, modules);
        var rightArms = StationTactileArms.Arms(right, modules);
        Assert.AreEqual("1,0", string.Join(";", leftArms.Select(arm => arm.DX + "," + arm.DY)), "the west tile grows east");
        Assert.AreEqual("-1,0", string.Join(";", rightArms.Select(arm => arm.DX + "," + arm.DY)), "the east tile grows west");
        Assert.AreNotEqual(UnityEngine.Mathf.FloorToInt(15 / 16f), UnityEngine.Mathf.FloorToInt(16 / 16f),
            "the two tiles are in different chunks");
        // Drop the neighbour and the arm goes with it.
        Assert.AreEqual(0, StationTactileArms.Arms(left, new[] { left }).Count, "no neighbour, no arm");

        // The composed arm really reaches the cell edge, so the two tiles' arms meet: source slab
        // centred at 0.3625 m, 0.275 m long, and its dots 6–12 mm proud of the tile top.
        var mesh = StationSurfaceModuleRenderer.TactileArmMesh(false, 1, 0);
        Assert.IsNotNull(mesh, "the arm mesh is generated");
        Assert.AreEqual(.225f, mesh.bounds.min.x, .001f, "the arm starts at the centre square's edge");
        Assert.AreEqual(.5f, mesh.bounds.max.x, .001f, "the arm reaches the cell edge");
        Assert.AreEqual(-.225f, mesh.bounds.min.z, .001f, "the arm is .45 m across");
        Assert.AreEqual(.225f, mesh.bounds.max.z, .001f, "the arm is .45 m across");
        Assert.AreEqual(0f, mesh.bounds.min.y, .001f, "the slab sits on the tile");
        Assert.AreEqual(.012f, mesh.bounds.max.y, .001f, "the dots stand 6–12 mm proud");
        var strip = StationSurfaceModuleRenderer.TactileArmMesh(true, 0, 1);
        Assert.AreEqual(.5f, strip.bounds.max.z, .001f, "a strip's crosswise arm reaches the cell edge too");
    }

    // ------------------------------------------------------- §6 exit openings

    [Test]
    public void BothZooExitsReportTheOpeningTheSourceDerives() {
        foreach (var id in new[] { "exit-uncovered-2-258", "exit-uncovered-2-398" }) {
            var record = zoo.Modules.First(module => module.Facts.Id == id);
            var openings = StationExitOpenings.For(zoo.Modules, record);
            Assert.IsNotNull(openings, id + " has no opening description");
            Assert.IsTrue(openings.IsHeadHouse, id + " is a street head-house");
            Assert.AreEqual(2, openings.Runs.Count, id + " holds two runs");
            Assert.AreEqual(0.0, openings.Runs[0].Column, 1e-9, id + " run 0 column");
            Assert.AreEqual(1.0, openings.Runs[1].Column, 1e-9, id + " run 1 column");
            Assert.AreEqual(0.0, openings.Runs[0].Row, 1e-9, id + " run 0 row");
            Assert.AreEqual(.5, openings.Runs[0].Half, 1e-9, id + " run half-width (a 1.2 m escalator body)");
            Assert.AreEqual(.5, openings.LandingBack, 1e-9, id + " exitLandingBack");
            Assert.AreEqual(2.5, openings.YHi, 1e-9, id + " the cell-aligned street edge");
            Assert.AreEqual(2.2, openings.UpperEdge, 1e-9, id + " the upper floor stops one riser short");
            // 3 pads (upper floor, riser, mouth row) plus the two side strips between the runs.
            Assert.AreEqual(5, openings.Pads.Count, id + " floor strip count");
            // The two runs are flush, so the wellway is two whole blocks wide and five long.
            var cells = openings.WellwayCells().Select(key => key.X + "," + key.Y).OrderBy(text => text, StringComparer.Ordinal).ToArray();
            int startX = record.Facts.X - 4;
            var expected = new List<string>();
            for (int x = startX; x < startX + 5; x++) { expected.Add(x + ",15"); expected.Add(x + ",16"); }
            expected.Sort(StringComparer.Ordinal);
            CollectionAssert.AreEqual(expected, cells, id + " wellway cells");
        }
        // A doorway exit draws no head-house pad and opens nothing.
        var doorway = new StationModuleRecord("exit-doorway", "exit", 0, 0, 0, 0, 1, 1, 1, false, null, null,
            Array.Empty<string>(), "", new ModuleFacts {
                Id = "exit-doorway", Type = "exit", X = 0, Y = 0, Z = 0, Rotation = 0, Config = Config(("style", "doorway")),
            });
        var plain = StationExitOpenings.For(new[] { doorway }, doorway);
        Assert.IsFalse(plain.IsHeadHouse, "a doorway exit is not a head-house");
        Assert.AreEqual(0, plain.Pads.Count, "a doorway exit lays no pad");
        Assert.AreEqual(0, plain.WellwayCells().Count, "a doorway exit opens no wellway");
    }

    [Test]
    public void GroundAndPaversAreExcludedOverTheSameCells() {
        var record = zoo.Modules.First(module => module.Facts.Id == "exit-uncovered-2-258");
        var openings = StationExitOpenings.For(zoo.Modules, record);
        var wellway = openings.WellwayCells();
        Assert.AreEqual(10, wellway.Count, "two run columns over five rows");

        // The cell mesher's ground mask: the same description's plate is a hole, so the virtual
        // street is not drawn under the head-house at all (the pad is the floor there).
        var capture = new CaptureContext();
        var host = new GameObject("outdoor connection probe");
        StationWorldView world = null;
        try {
            world = new StationWorldView(host.transform, "probe", new IStationViewRenderer[] { capture });
            world.Build(zoo, new StationIndex(zoo));
            var notes = new List<string>();
            var input = StationCellRenderer.BuildInput(capture.Context, null, notes);
            foreach (var cell in wellway) {
                Assert.IsTrue(input.GroundHoles.Contains(cell),
                    "the street plane is open at " + cell.X + "," + cell.Y + " under the " + record.Facts.Id + " wellway");
            }
            var plate = new StationCellKey(record.Facts.X - 1, record.Facts.Y - 1, record.Facts.Z);
            Assert.IsTrue(input.GroundHoles.Contains(plate), "the head-house plate is a ground hole");
            StringAssert.Contains("exit-wellway-open: 20 run column cell(s) under 2 exit(s)", string.Join("; ", notes),
                "the opening description reaches the mesher by name");
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }

        // The paver exclusion: `outdoorSurfaceHidden` hides a tile over the same plate (the pad is
        // what shows there), and the wellway cells are inside it.
        var hidden = new StationSurfaceModuleRenderer.SurfaceHidden(zoo, zooFacts);
        foreach (var cell in wellway) {
            var tile = new ModuleFacts { Id = "probe-paver", Type = "sidewalk", X = cell.X, Y = cell.Y, Z = cell.Z };
            Assert.IsTrue(hidden.IsHidden(tile, out var reason), "a paver at " + cell.X + "," + cell.Y + " must not draw over the wellway");
            StringAssert.StartsWith("exit-floor:", reason, "the exit plate is what hides it");
        }
        var outside = new ModuleFacts { Id = "probe-paver", Type = "sidewalk", X = record.Facts.X - 6, Y = record.Facts.Y, Z = record.Facts.Z };
        Assert.IsFalse(hidden.IsHidden(outside, out var outsideReason), "a paver outside the plate still draws (" + outsideReason + ")");
        // A tactile tile is not a paved surface: `outdoorSurfaceHidden` is only the sidewalk/lawn rule.
        var tactileOverExit = new ModuleFacts { Id = "probe-tactile", Type = "tactile", X = wellway[0].X, Y = wellway[0].Y, Z = wellway[0].Z };
        Assert.IsFalse(hidden.IsHidden(tactileOverExit, out _), "the exclusion is the paved families' rule");
    }

    // ------------------------------------------------------- §6.1 BuildExit

    [Test]
    public void StreetRendererCutsTheExitPadAroundTheRuns() {
        // RCA 15 §6.1 end to end: the street renderer retires the promoted prefab's own plinth and
        // draws the strips `exitRunOpenings` describes, so the wellway is open and the pad covers
        // exactly the rest of the plan. The promoted canopy, frame, rail and header are untouched.
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        var street = new StationStreetModuleRenderer();
        var host = new GameObject("exit pad probe");
        StationWorldView world = null;
        try {
            world = new StationWorldView(host.transform, "probe", new IStationViewRenderer[] { street }, new StationViewAssets { Catalogue = catalogue, Shader = ProbeShader() });
            world.Build(zoo, new StationIndex(zoo));
            var composedNotes = street.ExitNotes
                .Where(note => note.StartsWith("exit-floor-composed:", StringComparison.Ordinal)).ToList();
            Assert.AreEqual(2, composedNotes.Count, "one note per head-house: " + string.Join("; ", street.ExitNotes));
            foreach (var note in composedNotes) {
                StringAssert.Contains("exit-floor-composed:5strips:2runs", note);
                StringAssert.Contains("retired", note);
            }
            foreach (var built in street.Current.Modules.Where(module => module.Type == "exit")) {
                var record = zoo.Modules.First(module => module.Facts.Id == built.ModuleId);
                var openings = StationExitOpenings.For(zoo.Modules, record);
                var filter = built.View.GetComponentsInChildren<MeshFilter>(true)
                    .FirstOrDefault(candidate => candidate.sharedMesh && candidate.sharedMesh.name.EndsWith(" pad"));
                Assert.IsNotNull(filter, built.ModuleId + " drew no composed pad");
                var bounds = filter.sharedMesh.bounds;
                Assert.AreEqual(0f, bounds.min.y, .001f, built.ModuleId + " pad sits on the walk");
                Assert.AreEqual((float)StationExitOpenings.BaseHeight, bounds.max.y, .001f,
                    built.ModuleId + " pad is the source's 0.25 m plinth");
                Assert.AreEqual((float)openings.Width, bounds.size.x, .01f, built.ModuleId + " pad width");
                Assert.AreEqual((float)(openings.YHi - StationExitOpenings.BackY), bounds.size.z, .01f,
                    built.ModuleId + " pad runs from the back wall to the cell-aligned street edge");
                // The strips and the wellway are an exact partition of the plan: 22 m² of pad plus
                // the 2 × 5 m wellway is the 4 × 8 m plate, so no concrete covers a run column.
                double padArea = 0;
                foreach (var pad in openings.Pads) padArea += pad.Width * pad.Length;
                double wellwayArea = openings.WellwayCells().Count * 1.0;
                Assert.AreEqual(22.0, padArea, .01, built.ModuleId + " pad area");
                Assert.AreEqual(openings.Width * (openings.YHi - StationExitOpenings.BackY),
                    padArea + wellwayArea, .01, built.ModuleId + " pad + wellway must tile the plate");
                // 18 §6: the prefab's baked plinth is taken **out of the drawn hierarchy**, not
                // merely switched off — a disabled renderer was still collected by the
                // visibility target and the next view-mode pass switched it back on, which is
                // how the street stayed capped over the wellway. Nothing concrete the prefab
                // owned may survive; the composed strips are the floor.
                int surviving = 0;
                foreach (var renderer in built.View.GetComponentsInChildren<MeshRenderer>(true)) {
                    // The composed strips are ours and must stay on.
                    if (renderer.transform.name == "exit pad strips") continue;
                    bool padPart = renderer.sharedMaterials.Any(material =>
                        material && material.name.IndexOf("concrete", StringComparison.OrdinalIgnoreCase) >= 0);
                    if (padPart) surviving++;
                }
                Assert.AreEqual(0, surviving, built.ModuleId + " prefab plinth parts must leave the hierarchy");
                var composedStrip = built.View.GetComponentsInChildren<MeshRenderer>(true)
                    .FirstOrDefault(renderer => renderer.transform.name == "exit pad strips");
                Assert.IsNotNull(composedStrip, built.ModuleId + " draws the composed strips");
                Assert.IsTrue(composedStrip.enabled, built.ModuleId + " composed strips draw");
            }

            // The per-layer owner record: after the explicit pad retirement no enabled
            // renderer may sit over a wellway, and each clear head-house says so by name.
            foreach (var built in street.Current.Modules.Where(module => module.Type == "exit")) {
                var record = zoo.Modules.First(module => module.Facts.Id == built.ModuleId);
                var openings = StationExitOpenings.For(zoo.Modules, record);
                int wells = openings.WellwayCells().Count;
                Assert.Greater(wells, 0, built.ModuleId + " has a wellway");
                Assert.IsTrue(street.WellwayOwners.Any(note => note.StartsWith(built.ModuleId + " clear wells=" + wells,
                    StringComparison.Ordinal)), built.ModuleId + " records its clear wellway: " +
                    string.Join("; ", street.WellwayOwners));
                Assert.IsFalse(street.WellwayOwners.Any(note => note.StartsWith(built.ModuleId + " well=",
                    StringComparison.Ordinal)), built.ModuleId + " has no covering layer: " +
                    string.Join("; ", street.WellwayOwners));
            }
            Assert.IsFalse(world.Unresolved.Any(note => note.Code == "exit-wellway-covered"),
                "no exit reports a covered wellway: " +
                string.Join("; ", world.Unresolved.Where(note => note.Code.StartsWith("exit-", StringComparison.Ordinal))));
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /// <summary>The scene shader a bare probe needs (the street group's track run and pads make
    /// their own materials from it).</summary>
    static Shader ProbeShader() {
        var shader = StationFinishLibrary.FindShader();
        if (shader) return shader;
        shader = Shader.Find("Universal Render Pipeline/Lit");
        return shader ? shader : Shader.Find("Standard");
    }

    // ------------------------------------------------- §4.3 pavers stay separate
    [Test]
    public void SidewalkIsARepeatedOneMetreTileWithNoNeighbourRule() {
        // The paved families are **not** tactile-like: `outdoorSurfaceGeometry` repeats one
        // immutable one-metre slab with deliberate small seams, so there is no arm shape to
        // compose and the seam width must not be touched (RCA 15 §4.3). What the renderer must
        // get right is the tile's measured envelope, its material and the hidden-cell rule.
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        foreach (var key in new[] { "sidewalk", "lawn" }) {
            Assert.IsTrue(catalogue.TryGet(key, out var entry), key + " has no catalogue entry");
            Assert.IsNotNull(entry.prefab, key + " has no prefab");
            var instance = UnityEngine.Object.Instantiate(entry.prefab);
            try {
                var bounds = new Bounds(Vector3.zero, Vector3.zero);
                bool any = false;
                var materials = new HashSet<string>(StringComparer.Ordinal);
                foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true)) {
                    if (!renderer) continue;
                    if (!any) { bounds = renderer.bounds; any = true; } else bounds.Encapsulate(renderer.bounds);
                    foreach (var material in renderer.sharedMaterials) if (material) materials.Add(material.name);
                }
                Assert.IsTrue(any, key + " exposes no renderer");
                Assert.AreEqual(1f, bounds.size.x, .02f, key + " is one cell across");
                Assert.AreEqual(1f, bounds.size.z, .02f, key + " is one cell along");
                Assert.AreEqual(.1f, bounds.size.y, .02f, key + " is the 0.1 m raised surface");
                Assert.AreEqual(1, materials.Count, key + " draws its pavers with one material: " + string.Join(",", materials));
            } finally {
                UnityEngine.Object.DestroyImmediate(instance);
            }
        }
        // An ordinary paver in the open is drawn: the exclusion is only the void, the exit plate
        // and a run landing, never a neighbour-shape rule.
        var hidden = new StationSurfaceModuleRenderer.SurfaceHidden(zoo, zooFacts);
        var open = new ModuleFacts { Id = "probe-paver", Type = "sidewalk", X = 0, Y = 0, Z = 0 };
        Assert.IsFalse(hidden.IsHidden(open, out var reason), "an open paver still draws (" + reason + ")");
    }

    // =========================================== plan 16 §2 connection oracle
    //
    // `tools/unity-parity/record-station-connections.mjs` writes
    // `station-connections-oracle.json` from the real TypeScript functions: the four-side
    // `fenceConnectionIndex` mask and ordered neighbour identities, `fenceArms` and its
    // document-metre endpoints, `tactileArms` as `TactileModel.build` consumes it, and the
    // triangle count / world bounds the real `FenceModel`, `TactileModel` and
    // `OutdoorSurfaceModel` builders emit. The tests below are pure equality checks against
    // that fixture. A TS rule that deliberately leaves a join open is listed with
    // `kind: "gap"` and asserted as an expectation, never reported as a defect.

    const string ConnectionOraclePath = "StationDesigner/Tests/EditMode/station-connections-oracle.json";

    static JObject connectionOracle;

    static JObject ConnectionOracle => connectionOracle ??= JObject.Parse(
        File.ReadAllText(Path.Combine(Application.dataPath, ConnectionOraclePath)));

    static JObject ConnectionFixture(string id) =>
        (JObject)((JArray)ConnectionOracle["fixtures"]).First(fixture => (string)fixture["id"] == id);

    static RuntimeCatalogue ConnectionCatalogue {
        get {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
            return catalogue;
        }
    }

    // ------------------------------------------------------------------ DTO read

    static ModuleFacts FactsOf(JObject row) {
        var facts = new ModuleFacts {
            Id = (string)row["id"], Type = (string)row["type"],
            X = (int)row["x"], Y = (int)row["y"], Z = (int)row["z"], Rotation = (int)row["rot"],
            Width = row["w"] == null ? 1 : (int)row["w"],
            Depth = row["d"] == null ? 1 : (int)row["d"],
        };
        if (row["from"] is JArray from)
            facts.From = new ModuleFacts.Point { X = (int)from[0], Y = (int)from[1], Z = (int)from[2], HasValue = true };
        if (row["to"] is JArray to)
            facts.To = new ModuleFacts.Point { X = (int)to[0], Y = (int)to[1], Z = (int)to[2], HasValue = true };
        var config = new Dictionary<string, string>(StringComparer.Ordinal);
        if (row["cfg"] is JObject values)
            foreach (var property in values.Properties()) config[property.Name] = (string)property.Value;
        facts.Config = new ModuleConfig(config);
        return facts;
    }

    static ModuleFacts[] FactsOf(JArray rows) => rows.Select(row => FactsOf((JObject)row)).ToArray();

    static double Number(JToken token) => (double)token;
    static int Integer(JToken token) => (int)token;

    // -------------------------------------------------------------- assertions

    static void AssertNeighbourIds(IReadOnlyList<ModuleFacts> station, int x, int y, int z, JArray expected, string where) {
        var ids = station.Where(module => module.X == x && module.Y == y && module.Z == z).Select(module => module.Id).ToList();
        var wanted = expected.Select(token => (string)token["id"]).ToList();
        CollectionAssert.AreEqual(wanted, ids, where + " ordered neighbours at " + x + "," + y + "," + z);
    }

    static void AssertFenceRecord(StationFenceConnections index, ModuleFacts module, IReadOnlyList<ModuleFacts> station,
        JObject record, string where) {
        index.Sides(module, out var east, out var west, out var north, out var south);
        var sides = (JObject)record["sides"];
        Assert.AreEqual((bool)sides["e"], east, where + ": east side");
        Assert.AreEqual((bool)sides["w"], west, where + ": west side");
        Assert.AreEqual((bool)sides["n"], north, where + ": north side");
        Assert.AreEqual((bool)sides["s"], south, where + ": south side");
        var neighbours = (JObject)record["neighbours"];
        AssertNeighbourIds(station, module.X + 1, module.Y, module.Z, (JArray)neighbours["e"], where + " east");
        AssertNeighbourIds(station, module.X - 1, module.Y, module.Z, (JArray)neighbours["w"], where + " west");
        AssertNeighbourIds(station, module.X, module.Y + 1, module.Z, (JArray)neighbours["n"], where + " north");
        AssertNeighbourIds(station, module.X, module.Y - 1, module.Z, (JArray)neighbours["s"], where + " south");

        var expected = (JObject)record["arms"];
        var arms = OutdoorModuleViews.FenceArms(module.Rotation,
            new OutdoorNeighbours { Known = true, East = east, West = west, North = north, South = south });
        Assert.AreEqual(Number(expected["x0"]), arms.X0, 1e-6, where + " arm x0");
        Assert.AreEqual(Number(expected["x1"]), arms.X1, 1e-6, where + " arm x1");
        Assert.AreEqual(Number(expected["y0"]), arms.Y0, 1e-6, where + " arm y0");
        Assert.AreEqual(Number(expected["y1"]), arms.Y1, 1e-6, where + " arm y1");
        Assert.AreEqual((bool)expected["capE"], arms.CapEast, where + " cap east");
        Assert.AreEqual((bool)expected["capW"], arms.CapWest, where + " cap west");
        Assert.AreEqual((bool)expected["capN"], arms.CapNorth, where + " cap north");
        Assert.AreEqual((bool)expected["capS"], arms.CapSouth, where + " cap south");

        // The arms as document-metre endpoints at the storey floor top.
        var cx = module.X + 0.5;
        var cy = module.Y + 0.5;
        var top = module.Z + 1;
        var endpoints = (JObject)record["endpoints"];
        if (endpoints["x"] is JArray x) {
            Assert.AreEqual(Number(x[0]), cx + arms.X0, 1e-6, where + " x endpoint start x");
            Assert.AreEqual(Number(x[1]), cy, 1e-6, where + " x endpoint start y");
            Assert.AreEqual(Number(x[2]), top, 1e-6, where + " x endpoint elevation");
            Assert.AreEqual(Number(x[3]), cx + arms.X1, 1e-6, where + " x endpoint end x");
        } else {
            Assert.AreEqual(0f, arms.XSpan, 1e-6, where + " draws no x arm");
        }
        if (endpoints["y"] is JArray y) {
            Assert.AreEqual(Number(y[0]), cx, 1e-6, where + " y endpoint start x");
            Assert.AreEqual(Number(y[1]), cy + arms.Y0, 1e-6, where + " y endpoint start y");
            Assert.AreEqual(Number(y[2]), top, 1e-6, where + " y endpoint elevation");
            Assert.AreEqual(Number(y[4]), cy + arms.Y1, 1e-6, where + " y endpoint end y");
        } else {
            Assert.AreEqual(0f, arms.YSpan, 1e-6, where + " draws no y arm");
        }

        if (record["solidFaces"] is JObject solid) {
            Assert.AreEqual((bool)solid["e"], StationFenceConnections.GateSolidFaces(module, 1, 0), where + " machine face east");
            Assert.AreEqual((bool)solid["w"], StationFenceConnections.GateSolidFaces(module, -1, 0), where + " machine face west");
            Assert.AreEqual((bool)solid["n"], StationFenceConnections.GateSolidFaces(module, 0, 1), where + " machine face north");
            Assert.AreEqual((bool)solid["s"], StationFenceConnections.GateSolidFaces(module, 0, -1), where + " machine face south");
        }
    }

    static void AssertTactileRecord(ModuleFacts module, IReadOnlyList<ModuleFacts> station, JObject record, string where) {
        Assert.AreEqual((bool)record["applies"], StationTactileArms.Applies(module), where + " applies");
        var arms = StationTactileArms.Arms(module, station);
        var expected = (JArray)record["arms"];
        Assert.AreEqual(expected.Count, arms.Count, where + " arm count");
        for (int i = 0; i < Math.Min(expected.Count, arms.Count); i++) {
            Assert.AreEqual(Integer(expected[i]["dx"]), arms[i].DX, where + " arm " + i + " dx");
            Assert.AreEqual(Integer(expected[i]["dy"]), arms[i].DY, where + " arm " + i + " dy");
        }
    }

    static void AssertWorldBounds(Bounds bounds, JArray expected, string where, float tolerance = .02f) {
        // Oracle bounds are document (x, y, elevation); the Unity world is (x, elevation, y).
        Assert.AreEqual((float)Number(expected[0]), bounds.min.x, tolerance, where + " min x");
        Assert.AreEqual((float)Number(expected[2]), bounds.min.y, tolerance, where + " min elevation");
        Assert.AreEqual((float)Number(expected[1]), bounds.min.z, tolerance, where + " min y");
        Assert.AreEqual((float)Number(expected[3]), bounds.max.x, tolerance, where + " max x");
        Assert.AreEqual((float)Number(expected[5]), bounds.max.y, tolerance, where + " max elevation");
        Assert.AreEqual((float)Number(expected[4]), bounds.max.z, tolerance, where + " max y");
    }

    static StationDocument DocumentOf(ModuleFacts[] facts) {
        var modules = new StationModuleRecord[facts.Length];
        for (int i = 0; i < facts.Length; i++) {
            var fact = facts[i];
            modules[i] = new StationModuleRecord(fact.Id, fact.Type, fact.X, fact.Y, fact.Z, fact.Rotation,
                fact.Width, fact.Depth, 1, fact.CeilingAnchored,
                fact.From.HasValue ? new StationPoint(fact.From.X, fact.From.Y, fact.From.Z) : (StationPoint?)null,
                fact.To.HasValue ? new StationPoint(fact.To.X, fact.To.Y, fact.To.Z) : (StationPoint?)null,
                Array.Empty<string>(), "", fact);
        }
        var day = new StationDay(new StationSpan(0, 86400), new StationSpan(0, 0), new StationSpan(0, 0),
            new StationDemand(1, 1, 1), new StationDemand(1, 1, 1), 2026, 1, 1, Array.Empty<string>());
        return new StationDocument("connection fixture", "", "guangzhou", 0, 0, 5, day,
            Array.Empty<StationCellRecord>(), modules, Array.Empty<StationLineRecord>(), 0, 0, StationSource.None, "", "");
    }

    static OutdoorModuleView BuildOutdoor(ModuleFacts module, IReadOnlyList<ModuleFacts> station,
        RuntimeCatalogue catalogue, out GameObject holder) {
        var visual = ModuleViews.Resolve(module, station, catalogue);
        Assert.IsTrue(visual.HasModel, module.Id + " did not resolve: " + visual.Detail);
        Assert.IsTrue(catalogue.TryGet(visual.Key, out var entry), module.Id + " has no catalogue entry for " + visual.Key);
        Assert.IsNotNull(entry.prefab, module.Id + " resolved to a key without a prefab");
        holder = new GameObject(module.Id + " pivot");
        holder.transform.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
        var request = new OutdoorModuleRequest {
            ModuleId = module.Id, Type = module.Type, ViewKey = visual.Key,
            Variant = module.Config.Text("variant"), Mount = module.Config.Text("mount"),
            X = module.X, Y = module.Y, Z = module.Z, Rotation = module.Rotation,
            Width = module.Width, Depth = module.Depth,
            Prefab = entry.prefab, Catalogue = catalogue,
            Placement = OutdoorPlacement.ParentPlaced,
            Neighbours = OutdoorModuleViews.Neighbours(module, station),
        };
        Assert.IsTrue(OutdoorModuleViews.TryBuild(request, holder.transform, out var view), module.Id + ": " + view.Diagnostic);
        return view;
    }

    static StationSurfaceModuleRenderer BuildSurface(StationDocument document, out StationWorldView world, out GameObject host) {
        host = new GameObject("connection surface probe");
        var renderer = new StationSurfaceModuleRenderer();
        world = new StationWorldView(host.transform, "probe", new IStationViewRenderer[] { renderer },
            new StationViewAssets { Catalogue = ConnectionCatalogue, Shader = ProbeShader() });
        world.Build(document, new StationIndex(document));
        return renderer;
    }

    static StationSurfaceModuleRenderer BuildSurface(ModuleFacts[] facts, out StationWorldView world, out GameObject host) =>
        BuildSurface(DocumentOf(facts), out world, out host);

    static List<Vector3> SurfaceVertices(StationSurfaceModuleRenderer renderer) {
        Assert.IsNotNull(renderer.Current, "the surface renderer built no world");
        var vertices = new List<Vector3>();
        foreach (var mesh in renderer.Current.Meshes) {
            if (!mesh) continue;
            vertices.AddRange(mesh.vertices);
        }
        var root = renderer.Current.World?.Root;
        if (root != null) {
            foreach (var batch in root.GetComponentsInChildren<StationInstancedSurfaceBatch>(true)) {
                if (batch == null || batch.SharedMesh == null || batch.Matrices == null || batch.Matrices.Length == 0) continue;
                var localVerts = batch.SharedMesh.vertices;
                for (int m = 0; m < batch.Matrices.Length; m++) {
                    var matrix = batch.Matrices[m];
                    for (int v = 0; v < localVerts.Length; v++) vertices.Add(matrix.MultiplyPoint3x4(localVerts[v]));
                }
            }
        }
        return vertices;
    }

    static int SurfaceTriangles(StationSurfaceModuleRenderer renderer) {
        int triangles = 0;
        if (renderer.Current == null) return 0;
        foreach (var mesh in renderer.Current.Meshes) {
            if (!mesh) continue;
            for (int subMesh = 0; subMesh < mesh.subMeshCount; subMesh++) triangles += (int)mesh.GetIndexCount(subMesh) / 3;
        }
        var root = renderer.Current.World?.Root;
        if (root != null) {
            foreach (var batch in root.GetComponentsInChildren<StationInstancedSurfaceBatch>(true)) {
                if (batch == null || batch.SharedMesh == null || batch.Matrices == null || batch.Matrices.Length == 0) continue;
                triangles += ((int)batch.SharedMesh.GetIndexCount(batch.SubmeshIndex) / 3) * batch.Matrices.Length;
            }
        }
        return triangles;
    }

    static List<Vector3> VerticesIn(List<Vector3> vertices, JObject box, float inset = 0f) {
        var min = (JArray)box["min"];
        var max = (JArray)box["max"];
        var lo = new Vector3((float)Number(min[0]) + inset, (float)Number(min[2]) + inset, (float)Number(min[1]) + inset);
        var hi = new Vector3((float)Number(max[0]) - inset, (float)Number(max[2]) - inset, (float)Number(max[1]) - inset);
        return vertices.Where(vertex =>
            vertex.x >= lo.x && vertex.x <= hi.x &&
            vertex.y >= lo.y && vertex.y <= hi.y &&
            vertex.z >= lo.z && vertex.z <= hi.z).ToList();
    }

    static void AssertSlabEmitted(List<Vector3> vertices, JObject slab, string where) {
        var inside = VerticesIn(vertices, slab, -.002f);
        Assert.Greater(inside.Count, 0, where + ": no arm geometry was emitted in the source slab");
        var min = (JArray)slab["min"];
        var max = (JArray)slab["max"];
        Assert.AreEqual((float)Number(min[0]), inside.Min(vertex => vertex.x), .01f, where + " slab min x");
        Assert.AreEqual((float)Number(min[2]), inside.Min(vertex => vertex.y), .01f, where + " slab min elevation");
        Assert.AreEqual((float)Number(min[1]), inside.Min(vertex => vertex.z), .01f, where + " slab min y");
        Assert.AreEqual((float)Number(max[0]), inside.Max(vertex => vertex.x), .01f, where + " slab max x");
        Assert.AreEqual((float)Number(max[2]), inside.Max(vertex => vertex.y), .01f, where + " slab max elevation");
        Assert.AreEqual((float)Number(max[1]), inside.Max(vertex => vertex.z), .01f, where + " slab max y");
    }

    // ------------------------------------------------------------- provenance

    [Test]
    public void ZooEnvelopeMatchesTheConnectionOracleBytes() {
        var bytes = File.ReadAllBytes(Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json"));
        using var sha = SHA256.Create();
        var hash = string.Concat(sha.ComputeHash(bytes).Select(value => value.ToString("x2")));
        Assert.AreEqual((string)ConnectionOracle["zoo"]["sha256"], hash,
            "the oracle must be recorded from the same save bytes Unity opens");
        Assert.AreEqual(4299, (int)ConnectionOracle["zoo"]["modules"], "Zoo module count changed");
        Assert.AreEqual(213, (int)ConnectionOracle["zoo"]["counts"]["fences"], "Zoo fence count changed");
        Assert.AreEqual(77, (int)ConnectionOracle["zoo"]["counts"]["tactiles"], "Zoo tactile count changed");
        Assert.AreEqual(16, (int)ConnectionOracle["zoo"]["counts"]["fenceJunctions"], "Zoo junction count changed");
        Assert.IsNotNull(ConnectionOracle["provenance"]["fixtureSha256"], "the fixture carries its own hash");
    }

    // ---------------------------------------------------------- fence masks

    [Test]
    public void ZooFenceMasksArmsAndEndpointsMatchTheSource() {
        var index = StationFenceConnections.ForDocument(zoo);
        int junctions = 0;
        foreach (JObject record in (JArray)ConnectionOracle["zoo"]["fences"]) {
            var module = Find((string)record["id"]);
            AssertFenceRecord(index, module, zooFacts, record, "zoo " + module.Id);
            var arms = (JObject)record["arms"];
            if (Number(arms["x1"]) > Number(arms["x0"]) && Number(arms["y1"]) > Number(arms["y0"])) junctions++;
        }
        Assert.AreEqual(16, junctions, "the two-axis fences the composer owns");
    }

    [Test]
    public void ZooGateFacesMatchTheSource() {
        var index = StationFenceConnections.ForDocument(zoo);
        foreach (JObject record in (JArray)ConnectionOracle["zoo"]["gates"]) {
            var gate = zooFacts.First(module => module.Id == (string)record["id"]);
            AssertFenceRecord(index, gate, zooFacts, record, "zoo gate " + gate.Id);
        }
    }

    [Test]
    public void ImageOneCornerIsFence81Gate245AndTheRunSouth() {
        var corner = (JObject)ConnectionOracle["zoo"]["image1Corner"];
        CollectionAssert.AreEqual(new[] { "gate-245", "fence-81", "fence-80", "fence-755", "fence-65", "fence-64" },
            ((JArray)corner["ids"]).Select(token => (string)token).ToArray(),
            "the gate-side corner ids in the plan's image 1");

        var index = StationFenceConnections.ForDocument(zoo);
        var fence81 = Find("fence-81");
        var record = ((JArray)corner["records"]).Cast<JObject>().First(entry => (string)entry["id"] == "fence-81");
        AssertFenceRecord(index, fence81, zooFacts, record, "fence-81");
        Assert.AreEqual("x[-0.5,0] y[-0.5,0] caps none", Describe(OutdoorModuleViews.FenceArms(fence81.Rotation,
            OutdoorModuleViews.Neighbours(fence81, index))), "fence-81 is the SW corner of its join");
        Assert.AreEqual(300, (int)record["sourceGeometry"]["triangles"], "the source composes a two-arm junction");
        Assert.AreEqual(276, (int)((JObject)corner["deletion"]["withoutGate"]["fence81"]["sourceGeometry"])["triangles"],
            "without the gate the same cell is a capped run end");
    }

    [Test]
    public void FixtureFenceMasksMatchTheSourceForEveryShape() {
        foreach (var id in new[] { "fence-straight", "fence-corner", "fence-tee", "fence-cross", "fence-gate-faces", "fence-rail-landings", "fence-rotations", "fence-deletion" }) {
            var fixture = ConnectionFixture(id);
            var facts = FactsOf((JArray)fixture["modules"]);
            var index = StationFenceConnections.For(facts);
            foreach (JObject record in (JArray)fixture["fences"]) {
                var module = facts.First(candidate => candidate.Id == (string)record["id"]);
                AssertFenceRecord(index, module, facts, record, id + " " + module.Id);
            }
        }

        // A lane gate's doorway side is not a join; the machine face is. The fixture
        // records both, so the two gates must differ.
        var gateFixture = ConnectionFixture("fence-gate-faces");
        var gateFacts = FactsOf((JArray)gateFixture["modules"]);
        var gateIndex = StationFenceConnections.For(gateFacts);
        gateIndex.Sides(gateFacts.First(module => module.Id == "ga-fence"), out var machineEast, out _, out _, out _);
        gateIndex.Sides(gateFacts.First(module => module.Id == "gb-fence"), out var doorwayEast, out _, out _, out _);
        Assert.IsTrue(machineEast, "a lane gate joins on the side its machine body stands on");
        Assert.IsFalse(doorwayEast, "a lane gate's doorway side is not a join");
        gateIndex.Sides(gateFacts.First(module => module.Id == "gc-fence"), out var doorlessEast, out _, out _, out _);
        Assert.IsTrue(doorlessEast, "a doorless gate is solid all round");
    }

    [Test]
    public void RailLandingFixturesMatchTheSourceAndTheDeliberateGapsStayOpen() {
        var fixture = ConnectionFixture("fence-rail-landings");
        var facts = FactsOf((JArray)fixture["modules"]);
        var index = StationFenceConnections.For(facts);
        foreach (JObject record in (JArray)fixture["fences"]) {
            var module = facts.First(candidate => candidate.Id == (string)record["id"]);
            AssertFenceRecord(index, module, facts, record, "rail landing " + module.Id);
        }

        // `kind: "gap"`: the source deliberately does not index a lift or a 楼梯块.
        var gaps = ((JArray)fixture["gaps"]).Cast<JObject>().ToArray();
        CollectionAssert.AreEqual(new[] { "lift-landing", "block-stair-landing" }, gaps.Select(gap => (string)gap["id"]).ToArray(),
            "the source's deliberate landing gaps");
        foreach (var id in new[] { "no-land-lift", "no-land-block" }) {
            var module = facts.First(candidate => candidate.Id == id);
            index.Sides(module, out var east, out var west, out var north, out var south);
            Assert.IsFalse(east || west || north || south, id + " must keep both end posts: the source does not join a " +
                (id.Contains("lift") ? "lift" : "楼梯块"));
        }
        Assert.IsTrue(index.HasRailLanding(12, 0, 0), "a wide stair's band reaches the far lane the record is not adjacent to");
    }

    [Test]
    public void FenceTurnsThroughAllFourRotationsDrawTheirArmsNotTheirSavedTurn() {
        var fixture = ConnectionFixture("fence-rotations");
        var facts = FactsOf((JArray)fixture["modules"]);
        var catalogue = ConnectionCatalogue;
        var shapes = new List<Vector3>();
        foreach (var id in new[] { "rot0", "rot1", "rot2", "rot3" }) {
            var record = ((JArray)fixture["fences"]).Cast<JObject>().First(entry => (string)entry["id"] == id);
            var module = facts.First(candidate => candidate.Id == id);
            var view = BuildOutdoor(module, facts, catalogue, out var holder);
            try {
                var arms = (JObject)record["arms"];
                Assert.AreEqual(2, view.ComposedArms, id + " composes two arms");
                Assert.AreEqual(300, view.TriangleCount, id + " composed glass junction triangles");
                Assert.AreEqual((int)record["sourceGeometry"]["triangles"], view.TriangleCount, id + " source triangles");
                AssertWorldBounds(view.Bounds, (JArray)record["sourceGeometry"]["bounds"], id);
                // The arms are west + north: the west edge and the far y edge are reached,
                // the east edge and the near y edge are not.
                Assert.LessOrEqual(view.Bounds.min.x, module.X + .01f, id + " west arm reaches its edge");
                Assert.GreaterOrEqual(view.Bounds.max.z, module.Y + .99f, id + " north arm reaches its edge");
                Assert.LessOrEqual(view.Bounds.max.x, module.X + .5f + .06f, id + " no east arm");
                Assert.GreaterOrEqual(view.Bounds.min.z, module.Y + .44f, id + " no south arm");
                Assert.AreEqual(-.5, Number(arms["x0"]), 1e-6, id + " x0");
                Assert.AreEqual(.5, Number(arms["y1"]), 1e-6, id + " y1");
                shapes.Add(view.Bounds.size);
            } finally {
                UnityEngine.Object.DestroyImmediate(holder);
            }
        }
        foreach (var size in shapes) {
            Assert.AreEqual(shapes[0].x, size.x, .01f, "every saved turn composes the same arms (no double turn)");
            Assert.AreEqual(shapes[0].z, size.z, .01f, "every saved turn composes the same arms (no swapped axis)");
        }
    }

    [Test]
    public void OneAxisFencesComposeToExactSourceGeometryWithSealExtensions() {
        // Connected one-axis fences now compose directly from `FenceArms` + seal extensions (no
        // residual doubled end posts at cell seams), while the two isolated panels keep their
        // promoted isolated prefab.
        var catalogue = ConnectionCatalogue;
        var isolatedTriangles = new Dictionary<string, int>(StringComparer.Ordinal) {
            ["fence"] = 360, ["fence-iron"] = 768, ["fence-gate"] = 432, ["fence-steel-blue"] = 1668,
        };
        int composed = 0, isolated = 0, sealedOneAxis = 0;
        foreach (JObject record in (JArray)ConnectionOracle["zoo"]["fences"]) {
            var arms = (JObject)record["arms"];
            bool junction = Number(arms["x1"]) > Number(arms["x0"]) && Number(arms["y1"]) > Number(arms["y0"]);
            if (junction) continue;
            var module = Find((string)record["id"]);
            var neighbours = OutdoorModuleViews.Neighbours(module, zooFacts);
            var view = BuildOutdoor(module, zooFacts, catalogue, out var holder);
            try {
                var key = ModuleViews.Resolve(module, zooFacts, catalogue).Key;
                Assert.IsTrue(isolatedTriangles.ContainsKey(key), module.Id + " has an unmeasured prefab key " + key);
                if (neighbours.Degree == 0) {
                    Assert.AreEqual(0, view.ComposedArms, module.Id + " is isolated and keeps the promoted panel");
                    Assert.AreEqual(isolatedTriangles[key], view.TriangleCount, module.Id + " isolated triangle count");
                    isolated++;
                } else {
                    Assert.AreEqual(1, view.ComposedArms, module.Id + " connected one-axis fence must compose");
                    int source = (int)record["sourceGeometry"]["triangles"];
                    Assert.AreEqual(source, view.TriangleCount,
                        module.Id + ": composed one-axis fence must match source triangles with zero residual end posts");
                    var expectedBounds = SealedOracleBounds((JArray)record["sourceGeometry"]["bounds"], neighbours);
                    AssertWorldBounds(view.Bounds, expectedBounds, module.Id);
                    if (neighbours.HasSeal || neighbours.HasPillar) sealedOneAxis++;
                    composed++;
                }
            } finally {
                UnityEngine.Object.DestroyImmediate(holder);
            }
        }
        Assert.AreEqual(OneAxisRuns, composed, "all 195 connected one-axis Zoo fences are composed");
        Assert.AreEqual(IsolatedPanels, isolated, "the 2 isolated Zoo fences keep the promoted prefab");
        Assert.Greater(sealedOneAxis, 0, "Zoo contains one-axis fences meeting gates or integral rail-landing pillars");
    }

    static JArray SealedOracleBounds(JArray sourceBounds, OutdoorNeighbours neighbours) =>
        new JArray(
            Number(sourceBounds[0]) - neighbours.SealWest,
            Number(sourceBounds[1]) - neighbours.SealSouth,
            Number(sourceBounds[2]),
            Number(sourceBounds[3]) + neighbours.SealEast,
            Number(sourceBounds[4]) + neighbours.SealNorth,
            Number(sourceBounds[5]));

    // -------------------------------------------------------- tactile masks

    [Test]
    public void ZooTactileMasksMatchTheSource() {
        int applying = 0, arms = 0;
        foreach (JObject record in (JArray)ConnectionOracle["zoo"]["tactiles"]) {
            var module = Find((string)record["id"]);
            AssertTactileRecord(module, zooFacts, record, "zoo " + module.Id);
            if ((bool)record["applies"]) applying++;
            arms += ((JArray)record["arms"]).Count;
        }
        Assert.AreEqual((int)ConnectionOracle["zoo"]["counts"]["tactileApplying"], applying, "applying Zoo tiles");
        Assert.AreEqual((int)ConnectionOracle["zoo"]["counts"]["tactileArms"], arms, "Zoo arm count");
    }

    [Test]
    public void FixtureTactileMasksMatchTheSourceForEveryShape() {
        foreach (var id in new[] { "tactile-straight", "tactile-corner", "tactile-tee", "tactile-strip", "tactile-rotations", "tactile-deletion", "tactile-chunk-boundary" }) {
            var fixture = ConnectionFixture(id);
            var facts = FactsOf((JArray)fixture["modules"]);
            foreach (JObject record in (JArray)fixture["tactiles"]) {
                var module = facts.First(candidate => candidate.Id == (string)record["id"]);
                AssertTactileRecord(module, facts, record, id + " " + module.Id);
            }
        }

        // `kind: "gap"`: the guide never grows an arm, and a strip skips a warning square.
        var strip = ConnectionFixture("tactile-strip");
        var gaps = ((JArray)strip["gaps"]).Cast<JObject>().ToArray();
        CollectionAssert.AreEqual(new[] { "strip-beside-warning-square", "guide-never-arms" },
            gaps.Select(gap => (string)gap["id"]).ToArray(), "the source's deliberate tactile gaps");
        var stripFacts = FactsOf((JArray)strip["modules"]);
        Assert.AreEqual(0, StationTactileArms.Arms(stripFacts.First(module => module.Id == "strip-square"), stripFacts).Count,
            "a strip beside a warning square stays unjoined");
        Assert.IsFalse(StationTactileArms.Applies(stripFacts.First(module => module.Id == "guide-crossing")),
            "a guide tile never composes an arm");
    }

    [Test]
    public void TactileArmMeshCarriesTheSignedLocalStep() {
        // The source slab sits at dx*0.3625 / dy*0.3625, so a negative local arm must be
        // emitted on the negative side; `alongX ? +x : +y` would mirror every west/south arm.
        int negative = 0;
        foreach (var id in new[] { "tactile-straight", "tactile-corner", "tactile-tee", "tactile-strip", "tactile-rotations", "tactile-chunk-boundary" }) {
            var fixture = ConnectionFixture(id);
            foreach (JObject record in (JArray)fixture["tactiles"]) {
                bool strip = (bool)record["strip"];
                foreach (JObject arm in (JArray)record["arms"]) {
                    int dx = Integer(arm["dx"]), dy = Integer(arm["dy"]);
                    if (dx < 0 || dy < 0) negative++;
                    var mesh = StationSurfaceModuleRenderer.TactileArmMesh(strip, dx, dy);
                    Assert.IsNotNull(mesh, id + " arm mesh");
                    bool alongX = dx != 0;
                    int sign = alongX ? dx : dy;
                    // `TactileModel.build`'s slab reaches the cell edge; a strip's dot field
                    // starts at 0.24, so its 0.025 m dot radius reaches 10 mm past the centre
                    // square's edge (.215). The mesh bounds are the union, on the signed side.
                    float alongMin = strip
                        ? (sign > 0 ? .215f : -.5f)
                        : (sign > 0 ? .225f : -.5f);
                    float alongMax = strip
                        ? (sign > 0 ? .5f : -.215f)
                        : (sign > 0 ? .5f : -.225f);
                    float minX = alongX ? alongMin : -.225f;
                    float maxX = alongX ? alongMax : .225f;
                    float minZ = alongX ? -.225f : alongMin;
                    float maxZ = alongX ? .225f : alongMax;
                    Assert.AreEqual(minX, mesh.bounds.min.x, 1e-4, id + " arm " + dx + "," + dy + " min x");
                    Assert.AreEqual(maxX, mesh.bounds.max.x, 1e-4, id + " arm " + dx + "," + dy + " max x");
                    Assert.AreEqual(minZ, mesh.bounds.min.z, 1e-4, id + " arm " + dx + "," + dy + " min z");
                    Assert.AreEqual(maxZ, mesh.bounds.max.z, 1e-4, id + " arm " + dx + "," + dy + " max z");
                    Assert.AreEqual(0f, mesh.bounds.min.y, 1e-4, id + " arm sits on the tile");
                    Assert.AreEqual(.012f, mesh.bounds.max.y, 1e-4, id + " arm dots stand proud");
                }
            }
        }
        Assert.Greater(negative, 0, "the fixtures include negative local arms, the case a sign-blind mesh gets wrong");
    }

    [Test]
    public void TactileArmEmissionFollowsTheDocumentRotation() {
        // An asymmetric north+east corner through the four saved turns. The oracle records the
        // emitted slab for each signed local arm and where the mirrored arm would land, so the
        // assembled batch must draw the arm on the document side, not the local +axis.
        var fixture = ConnectionFixture("tactile-rotations");
        var facts = FactsOf((JArray)fixture["modules"]);
        var renderer = BuildSurface(facts, out var world, out var host);
        try {
            var vertices = SurfaceVertices(renderer);
            Assert.Greater(vertices.Count, 0, "the tactile tiles must batch (the arm path, not the prefab fallback)");
            int checkedArms = 0;
            foreach (JObject record in (JArray)fixture["tactiles"]) {
                foreach (JObject arm in (JArray)record["arms"]) {
                    AssertSlabEmitted(vertices, (JObject)arm["slab"], (string)record["id"] + " arm " + (int)arm["dx"] + "," + (int)arm["dy"]);
                    var mirrored = VerticesIn(vertices, (JObject)arm["mirror"], .005f);
                    Assert.IsEmpty(mirrored, (string)record["id"] + " emitted its arm on the opposite side of the tile");
                    checkedArms++;
                }
            }
            Assert.AreEqual(16, checkedArms, "four main corners x two arms, plus each neighbour's one return arm");
        } finally {
            world.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    [Test]
    public void ZooTactileArmsAreEmittedAtTheSourceEndpoints() {
        var renderer = BuildSurface(zoo, out var world, out var host);
        try {
            Assert.AreEqual((int)ConnectionOracle["zoo"]["counts"]["tactileArms"], renderer.TactileArmParts,
                "every applying Zoo tile composes its arms in the surface batch");
            var vertices = SurfaceVertices(renderer);
            foreach (JObject record in (JArray)ConnectionOracle["zoo"]["tactiles"]) {
                if (!(bool)record["applies"]) continue;
                foreach (JObject arm in (JArray)record["arms"]) {
                    AssertSlabEmitted(vertices, (JObject)arm["slab"], "zoo " + (string)record["id"] + " arm " + (int)arm["dx"] + "," + (int)arm["dy"]);
                }
            }
        } finally {
            world.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    // -------------------------------------------------------- junction core

    [Test]
    public void ZooComposedJunctionsMatchTheSourceGeometry() {
        var catalogue = ConnectionCatalogue;
        int junctions = 0;
        foreach (JObject record in (JArray)ConnectionOracle["zoo"]["fences"]) {
            var arms = (JObject)record["arms"];
            if (!(Number(arms["x1"]) > Number(arms["x0"]) && Number(arms["y1"]) > Number(arms["y0"]))) continue;
            var module = Find((string)record["id"]);
            var neighbours = OutdoorModuleViews.Neighbours(module, zooFacts);
            var view = BuildOutdoor(module, zooFacts, catalogue, out var holder);
            try {
                Assert.AreEqual(2, view.ComposedArms, module.Id + " composes both arms");
                Assert.AreEqual((int)record["sourceGeometry"]["triangles"], view.TriangleCount,
                    module.Id + " composes the source's own triangle count");
                AssertWorldBounds(view.Bounds, SealedOracleBounds((JArray)record["sourceGeometry"]["bounds"], neighbours), module.Id);
                junctions++;
            } finally {
                UnityEngine.Object.DestroyImmediate(holder);
            }
        }
        Assert.AreEqual(16, junctions, "all 16 two-axis fences are composed");
    }

    // ------------------------------------------------------------ deletion

    [Test]
    public void DeletionFixturesMatchTheSourceAfterImages() {
        var fenceDeletion = (JObject)ConnectionOracle["deletion"]["fence"];
        var beforeFence = FactsOf((JArray)ConnectionFixture("fence-deletion")["modules"]);
        var afterFence = beforeFence.Where(module => module.Id != (string)fenceDeletion["removed"][0]).ToArray();
        var beforeIndex = StationFenceConnections.For(beforeFence);
        var afterIndex = StationFenceConnections.For(afterFence);
        foreach (JObject record in (JArray)fenceDeletion["before"]) {
            var module = beforeFence.First(candidate => candidate.Id == (string)record["id"]);
            AssertFenceRecord(beforeIndex, module, beforeFence, record, "deletion before " + module.Id);
        }
        foreach (JObject record in (JArray)fenceDeletion["after"]) {
            var module = afterFence.First(candidate => candidate.Id == (string)record["id"]);
            AssertFenceRecord(afterIndex, module, afterFence, record, "deletion after " + module.Id);
        }
        // d1 and d3 lose their arm toward the removed cell and cap the new far edge.
        var d1 = afterIndex.FencesAt(1, 0, 0).First();
        afterIndex.Sides(d1, out var east, out var west, out var north, out var south);
        Assert.IsFalse(east, "the removed middle cell is no longer a neighbour");
        Assert.IsTrue(west, "the run still joins west");
        Assert.IsFalse(north || south, "a straight run has no crosswise neighbour");
        Assert.AreEqual("x[-0.5,0.5] y[0,0] caps E", Describe(OutdoorModuleViews.FenceArms(d1.Rotation,
            new OutdoorNeighbours { Known = true, East = east, West = west, North = north, South = south })),
            "the surviving cell now caps the edge the removed cell used to join");

        var tactileDeletion = (JObject)ConnectionOracle["deletion"]["tactile"];
        var beforeTactile = FactsOf((JArray)ConnectionFixture("tactile-deletion")["modules"]);
        var afterTactile = beforeTactile.Where(module => module.Id != (string)tactileDeletion["removed"][0]).ToArray();
        foreach (JObject record in (JArray)tactileDeletion["before"]) {
            var module = beforeTactile.First(candidate => candidate.Id == (string)record["id"]);
            AssertTactileRecord(module, beforeTactile, record, "tactile deletion before " + module.Id);
        }
        foreach (JObject record in (JArray)tactileDeletion["after"]) {
            var module = afterTactile.First(candidate => candidate.Id == (string)record["id"]);
            AssertTactileRecord(module, afterTactile, record, "tactile deletion after " + module.Id);
        }
        Assert.AreEqual(0, StationTactileArms.Arms(afterTactile.First(module => module.Id == "q0"), afterTactile).Count,
            "the run end loses the arm it grew toward the deleted tile");
    }

    [Test]
    public void ZooCornerDeletionAndReopenMatchTheSource() {
        var deletion = (JObject)ConnectionOracle["zoo"]["image1Corner"]["deletion"];
        var withoutGate = (ModuleFacts[])zooFacts.Where(module => module.Id != "gate-245").ToArray();
        var index = StationFenceConnections.For(withoutGate);
        var fence81 = withoutGate.First(module => module.Id == "fence-81");
        AssertFenceRecord(index, fence81, withoutGate, (JObject)deletion["withoutGate"]["fence81"], "fence-81 without gate-245");
        index.Sides(fence81, out var east, out var west, out var north, out var south);
        Assert.IsFalse(north, "the north side is the new end, not a neighbour");
        Assert.AreEqual("x[0,0] y[-0.5,0.5] caps N", Describe(OutdoorModuleViews.FenceArms(fence81.Rotation,
            new OutdoorNeighbours { Known = true, East = east, West = west, North = north, South = south })), "the new cap");

        var withoutRun = (ModuleFacts[])zooFacts.Where(module => module.Id != "gate-245" && module.Id != "fence-80").ToArray();
        var loneIndex = StationFenceConnections.For(withoutRun);
        var lone = withoutRun.First(module => module.Id == "fence-81");
        AssertFenceRecord(loneIndex, lone, withoutRun, (JObject)deletion["withoutGateAndSouthRun"]["fence81"],
            "fence-81 without gate-245 and fence-80");
        loneIndex.Sides(lone, out _, out _, out _, out _);
        Assert.AreEqual("x[0,0] y[-0.5,0.5] caps NS", Describe(OutdoorModuleViews.FenceArms(lone.Rotation,
            OutdoorModuleViews.Neighbours(lone, loneIndex))), "an isolated rot-1 panel caps both ends of +y");

        // Reopen: the same delete written into the save envelope and read back through the
        // game's own reader must produce the same join (the cache cannot leak across worlds).
        var envelope = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json")));
        var modules = (JArray)envelope["static"]["modules"];
        foreach (var removing in new[] { "gate-245" })
            for (int i = modules.Count - 1; i >= 0; i--)
                if ((string)modules[i]["id"] == removing) modules.RemoveAt(i);
        var reopened = StationDocumentReader.Read(envelope.ToString(), StationSource.None).Document;
        var reopenedIndex = StationFenceConnections.ForDocument(reopened);
        var reopenedFence = reopened.Modules.First(module => module.Facts.Id == "fence-81").Facts;
        AssertFenceRecord(reopenedIndex, reopenedFence, reopened.Modules.Select(module => module.Facts).ToArray(),
            (JObject)deletion["reopenedWithoutGate"], "reopened fence-81 without gate-245");
        reopenedIndex.Sides(reopenedFence, out _, out _, out _, out var reopenedSouth);
        Assert.IsTrue(reopenedSouth, "the reopened corner still joins the run south");
    }

    // ------------------------------------------------------------ dependencies

    [Test]
    public void EditDependenciesMatchTheSourceRetainedSet() {
        foreach (JObject dependency in (JArray)ConnectionOracle["dependencies"]) {
            var before = FactsOf((JArray)dependency["before"]);
            var after = FactsOf((JArray)dependency["after"]);
            var expected = ((JArray)dependency["affected"]).Select(token => (string)token).ToArray();
            var actual = StationConnectionDependencies.Affected(before, after).ToArray();
            CollectionAssert.AreEqual(expected, actual, (string)dependency["id"] + ": committed rebuild set");
        }
    }

    [Test]
    public void PreviewRebuildsLessThanTheCommitAtADoorlessGate() {
        foreach (JObject dependency in (JArray)ConnectionOracle["dependencies"]) {
            if (dependency["preview"] == null) continue;
            var id = (string)dependency["id"];
            if (id == "preview-noise-barrier") continue; // the candidate is not in `after`; covered below.
            var before = FactsOf((JArray)dependency["before"]);
            var candidates = FactsOf((JArray)dependency["preview"]["candidates"]);
            var expected = ((JArray)dependency["preview"]["affected"]).Select(token => (string)token).ToArray();
            var actual = StationConnectionDependencies.Preview(before, candidates).ToArray();
            CollectionAssert.AreEqual(expected, actual, id + ": preview rebuild set");
            // The preview really is narrower than the commit where the source says so.
            if (id == "place-beside-doorless-gate")
                CollectionAssert.DoesNotContain(actual, "doorless-gate", "a drag does not rebuild a doorless gate's fence half");
        }
        var noise = (JObject)((JArray)ConnectionOracle["dependencies"]).First(dependency => (string)dependency["id"] == "preview-noise-barrier");
        var noiseCandidates = FactsOf((JArray)noise["preview"]["candidates"]);
        var noisePreview = StationConnectionDependencies.Preview(FactsOf((JArray)noise["before"]), noiseCandidates);
        CollectionAssert.DoesNotContain(noisePreview, "barrier", "a ground noise barrier draws no arms and is not rebuilt by a drag");
        CollectionAssert.Contains(noisePreview, "ordinary-end", "the adjacent ordinary fence is rebuilt");
    }

    [Test]
    public void ZooEditDependenciesAndReopenMatchTheSource() {
        foreach (JObject dependency in (JArray)ConnectionOracle["zooDependencies"]) {
            var removed = ((JArray)dependency["removed"]).Select(token => (string)token).ToArray();
            var after = zooFacts.Where(module => !removed.Contains(module.Id)).ToArray();
            var expected = ((JArray)dependency["affected"]).Select(token => (string)token).ToArray();
            var actual = StationConnectionDependencies.Affected(zooFacts, after).ToArray();
            CollectionAssert.AreEqual(expected, actual, (string)dependency["id"] + ": Zoo committed rebuild set");
            if (dependency["preview"] != null) {
                var candidates = FactsOf((JArray)dependency["preview"]["candidates"]);
                var preview = StationConnectionDependencies.Preview(zooFacts, candidates).ToArray();
                var expectedPreview = ((JArray)dependency["preview"]["affected"]).Select(token => (string)token).ToArray();
                CollectionAssert.AreEqual(expectedPreview, preview, (string)dependency["id"] + ": Zoo preview rebuild set");
            }
        }

        // Reopen: compute the same edit through two independently read documents.
        var first = StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json").Document;
        var second = StationDocumentReader.ReadFile("Assets/StationDesigner/Demos/zoo.metro.json").Document;
        var firstAfter = first.Modules.Where(module => module.Facts.Id != "gate-245").Select(module => module.Facts).ToArray();
        var secondAfter = second.Modules.Where(module => module.Facts.Id != "gate-245").Select(module => module.Facts).ToArray();
        var firstIds = StationConnectionDependencies.Affected(first.Modules.Select(module => module.Facts).ToArray(), firstAfter).ToArray();
        var secondIds = StationConnectionDependencies.Affected(second.Modules.Select(module => module.Facts).ToArray(), secondAfter).ToArray();
        CollectionAssert.AreEqual(firstIds, secondIds, "reopening the same save answers the same dependency set");
        CollectionAssert.Contains(firstIds, "fence-81", "the corner fence's join changed");

        // The StationDocument overloads answer the same set as the plain module lists.
        var documentBefore = DocumentOf(zooFacts);
        var documentAfter = DocumentOf(zooFacts.Where(module => module.Id != "gate-245").ToArray());
        CollectionAssert.AreEqual(firstIds, StationConnectionDependencies.Affected(documentBefore, documentAfter).ToArray(),
            "the document overload agrees with the module-list overload");
        var cornerCandidate = new ModuleFacts { Id = "candidate-east", Type = "fence", X = 76, Y = 18, Z = -15 };
        CollectionAssert.Contains(StationConnectionDependencies.Preview(documentBefore, new[] { cornerCandidate }),
            "fence-81", "the document preview overload finds the adjacent committed fence");
    }

    // ------------------------------------------------------ sidewalk seams

    [Test]
    public void SidewalkTilesKeepTheSourceArtworkAndHaveNoNeighbourRule() {
        // `OutdoorSurfaceModel.outdoorSurfaceGeometry`: one immutable one-metre tile per type,
        // repeated at every cell. The sidewalk top carries deliberate 0.008 m paver seams; the
        // builder reads no neighbour and there is no arm or join shape. This is a separate
        // case from tactile connectivity and must stay that way.
        var fixture = ConnectionFixture("surface-sidewalk-seams");
        StringAssert.Contains("repeated immutable one-metre tiles", (string)ConnectionOracle["surface"]["rule"],
            "paving is recorded as repeated artwork, not as a neighbour rule");
        var surfaces = (JArray)fixture["surfaces"];
        var facts = FactsOf((JArray)fixture["modules"]);
        var renderer = BuildSurface(facts, out var world, out var host);
        try {
            Assert.AreEqual(0, renderer.TactileArmParts, "a paved tile composes no arm");
            Assert.AreEqual(surfaces.Sum(surface => (int)surface["sourceGeometry"]["triangles"]), SurfaceTriangles(renderer),
                "the paved tiles are the source's own repeated artwork, not a neighbour shape");
            var vertices = SurfaceVertices(renderer);
            Assert.Greater(vertices.Count, 0, "the paved tiles batch");
            foreach (JObject surface in surfaces) {
                var id = (string)surface["id"];
                var module = facts.First(candidate => candidate.Id == id);
                var record = (JObject)surface["sourceGeometry"];
                var lo = new Vector3(module.X, module.Z + 1, module.Y);
                var hi = new Vector3(module.X + 1, module.Z + 1.1f, module.Y + 1);
                var inside = vertices.Where(vertex =>
                    vertex.x >= lo.x - .001f && vertex.x <= hi.x + .001f &&
                    vertex.y >= lo.y - .001f && vertex.y <= hi.y + .001f &&
                    vertex.z >= lo.z - .001f && vertex.z <= hi.z + .001f).ToList();
                Assert.Greater(inside.Count, 0, id + " drew no tile");
                Assert.AreEqual(lo.x, inside.Min(vertex => vertex.x), .01f, id + " tile starts on its own cell edge");
                Assert.AreEqual(hi.x, inside.Max(vertex => vertex.x), .01f, id + " tile ends on its own cell edge");
                Assert.AreEqual(lo.z, inside.Min(vertex => vertex.z), .01f, id + " tile is one cell along");
                Assert.AreEqual(hi.z, inside.Max(vertex => vertex.z), .01f, id + " tile is one cell along");
                Assert.AreEqual(.1f, inside.Max(vertex => vertex.y) - inside.Min(vertex => vertex.y), .01f, id + " raised tile height");
                var bounds = (JArray)record["bounds"];
                Assert.AreEqual((float)(Number(bounds[3]) - Number(bounds[0])), inside.Max(vertex => vertex.x) - inside.Min(vertex => vertex.x), .01f,
                    id + " keeps the source's one-metre envelope");
            }
            // The sidewalk's top pavers are inset: at a cell boundary only the 0.08 m base slab
            // may reach, never the paver top, so the 0.008 m artwork seam survives.
            var sidewalk = surfaces.Cast<JObject>().First(surface => (string)surface["type"] == "sidewalk");
            var seamTile = facts.First(candidate => candidate.Id == (string)sidewalk["id"]);
            float floor = seamTile.Z + 1;
            var inTile = vertices.Where(vertex =>
                vertex.x >= seamTile.X - .001f && vertex.x <= seamTile.X + 1.001f &&
                vertex.z >= seamTile.Y - .001f && vertex.z <= seamTile.Y + 1.001f).ToList();
            var onBoundary = inTile.Where(vertex =>
                vertex.x - seamTile.X < .001f || seamTile.X + 1 - vertex.x < .001f ||
                vertex.z - seamTile.Y < .001f || seamTile.Y + 1 - vertex.z < .001f).ToList();
            Assert.Greater(onBoundary.Count, 0, "the base slab reaches the cell boundary");
            Assert.IsTrue(onBoundary.All(vertex => vertex.y < floor + .081f),
                "only the base slab reaches the shared boundary; the paver artwork keeps its 0.008 m seam");
            StringAssert.Contains("0.008", (string)ConnectionOracle["surface"]["rule"], "the seam is recorded as artwork, not a join");
        } finally {
            world.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }


    sealed class CaptureContext : IStationViewRenderer {
        public StationViewBuildContext Context { get; private set; }
        public string Role => "probe";
        public void Build(StationViewBuildContext context) => Context = context;
        public void Release() => Context = null;
    }
}
