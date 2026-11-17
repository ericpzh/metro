using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
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
/// Plan 16 §5 pins for the exit head-house's floor and the two edit-time snaps.
///
/// The expectations are the TypeScript source's own answers, recorded by
/// `tools/unity-parity/record-station-exits.mjs`:
///
/// * `station-exits-oracle.json` `zooExits` — `buildExit`'s real concrete pad
///   rectangles (`exit-concrete-base` meshes) and the `exitRunOpenings` /
///   `exitLandingBack` description, plus every saved floor contributor under the
///   plate. `StationExitOpenings` must reproduce the pad set exactly; the
///   heading above `Pads`/`LandingPads` explains why a stair landing is a pad the
///   escalator-only version was missing.
/// * `snapExitToRamp` / `exitRunSnap` rows — the real `sim/exits.ts` functions over
///   straight, two- and three-lane and Zoo's escalator geometry, every rotation,
///   clamped bays, wrong levels, and the families the source refuses (block and
///   turning stairs, a lift, a level run, doorway and virtual exits).
///
/// The renderer test then builds the live `StationStreetModuleRenderer` over the
/// Zoo save, retires the promoted plinth and checks the **composed** strips against
/// the same pad set: every cell the source floors is covered, every cell it leaves
/// open is a hole, and the pavers and the virtual ground are excluded from the same
/// plate. That is the "pad, cell ground and pavers isolated" evidence, recorded as
/// geometry rather than a screenshot so it is reproducible.
/// </summary>
public class StationExitSnappingTests {
    const string OraclePath = "StationDesigner/Tests/EditMode/station-exits-oracle.json";
    const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
    const double Tolerance = 1e-6;

    static JObject oracle;
    static StationDocument zoo;

    static JObject Oracle => oracle ??= JObject.Parse(
        File.ReadAllText(Path.Combine(Application.dataPath, OraclePath)));

    static JArray ZooExits => (JArray)Oracle["zooExits"];

    static StationModuleRecord ZooExit(string id) =>
        zoo.Modules.First(module => module.Facts.Id == id);

    [OneTimeSetUp]
    public void LoadFixtures() {
        var read = StationDocumentReader.ReadFile(ZooPath);
        Assert.IsNotNull(read, "Zoo fixture missing: " + ZooPath);
        zoo = read.Document;
        Assert.IsNotNull((JArray)Oracle["zooExits"], "the exit oracle has no zoo rows");
    }

    // ------------------------------------------------------------ DTO → record

    static ModuleConfig ConfigOf(JToken cfg) {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (cfg is JObject obj) {
            foreach (var pair in obj) {
                var value = pair.Value;
                map[pair.Key] = value == null || value.Type == JTokenType.Null
                    ? ""
                    : value.Type == JTokenType.Object || value.Type == JTokenType.Array
                        ? value.ToString(Newtonsoft.Json.Formatting.None)
                        : Convert.ToString(((JValue)value).Value, CultureInfo.InvariantCulture);
            }
        }
        return new ModuleConfig(map);
    }

    static StationPoint? PointOf(JToken token) {
        if (!(token is JArray array) || array.Count < 3) return null;
        return new StationPoint((double)array[0], (double)array[1], (double)array[2]);
    }

    /// <summary>One oracle module DTO as the typed record the resolver's API takes.</summary>
    static StationModuleRecord RecordOf(JToken dto) {
        string id = (string)dto["id"];
        string type = (string)dto["type"];
        int x = (int)dto["x"], y = (int)dto["y"], z = (int)dto["z"];
        int rot = dto["rot"] == null ? 0 : (int)dto["rot"];
        int w = dto["w"] == null ? 1 : (int)dto["w"];
        int d = dto["d"] == null ? 1 : (int)dto["d"];
        int h = dto["h"] == null ? 1 : (int)dto["h"];
        var config = ConfigOf(dto["cfg"]);
        var from = PointOf(dto["from"]);
        var to = PointOf(dto["to"]);
        var facts = new ModuleFacts {
            Id = id, Type = type, X = x, Y = y, Z = z, Rotation = rot,
            Width = w, Depth = d, Config = config,
        };
        if (from.HasValue) facts.From = new ModuleFacts.Point { X = (int)Math.Round(from.Value.X), Y = (int)Math.Round(from.Value.Y), Z = (int)Math.Round(from.Value.Z), HasValue = true };
        if (to.HasValue) facts.To = new ModuleFacts.Point { X = (int)Math.Round(to.Value.X), Y = (int)Math.Round(to.Value.Y), Z = (int)Math.Round(to.Value.Z), HasValue = true };
        return new StationModuleRecord(id, type, x, y, z, rot, w, d, h, false, from, to,
            Array.Empty<string>(), "", facts);
    }

    static StationModuleRecord ExitRecord(string type, int x, int y, int z, int rot, int bays, string id = "fresh-exit") {
        string style = type.IndexOf("-doorway-", StringComparison.Ordinal) >= 0 ? "doorway"
            : type.IndexOf("-virtual", StringComparison.Ordinal) >= 0 ? "virtual" : "";
        var values = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["name"] = "A", ["inRate"] = "900", ["open"] = "true",
            ["covered"] = type.IndexOf("-uncovered-", StringComparison.Ordinal) >= 0 ? "false" : "true",
            ["bays"] = bays.ToString(CultureInfo.InvariantCulture),
        };
        if (style.Length > 0) values["style"] = style;
        var config = new ModuleConfig(values);
        var facts = new ModuleFacts { Id = id, Type = "exit", X = x, Y = y, Z = z, Rotation = rot, Config = config };
        return new StationModuleRecord(id, "exit", x, y, z, rot, 1, 1, 1, false, null, null,
            Array.Empty<string>(), "", facts);
    }

    // ------------------------------------------------------------ pad helpers

    struct PadRow {
        public double X, Y, Width, Length, Height;
    }

    static List<PadRow> PadsOf(JToken row) {
        var pads = new List<PadRow>();
        foreach (var pad in (JArray)row["pads"]) {
            pads.Add(new PadRow {
                X = (double)pad["x"], Y = (double)pad["y"],
                Width = (double)pad["width"], Length = (double)pad["length"], Height = (double)pad["height"],
            });
        }
        pads.Sort((a, b) => {
            int order = a.X.CompareTo(b.X);
            if (order != 0) return order;
            order = a.Y.CompareTo(b.Y);
            if (order != 0) return order;
            order = a.Width.CompareTo(b.Width);
            if (order != 0) return order;
            order = a.Length.CompareTo(b.Length);
            return order != 0 ? order : a.Height.CompareTo(b.Height);
        });
        return pads;
    }

    static List<PadRow> ActualPads(StationExitOpenings openings) {
        var pads = new List<PadRow>();
        foreach (var pad in openings.Pads) pads.Add(new PadRow { X = pad.X, Y = pad.Y, Width = pad.Width, Length = pad.Length, Height = pad.Height });
        foreach (var pad in openings.LandingPads) pads.Add(new PadRow { X = pad.X, Y = pad.Y, Width = pad.Width, Length = pad.Length, Height = pad.Height });
        pads.Sort((a, b) => {
            int order = a.X.CompareTo(b.X);
            if (order != 0) return order;
            order = a.Y.CompareTo(b.Y);
            if (order != 0) return order;
            order = a.Width.CompareTo(b.Width);
            if (order != 0) return order;
            order = a.Length.CompareTo(b.Length);
            return order != 0 ? order : a.Height.CompareTo(b.Height);
        });
        return pads;
    }

    static bool Covers(IReadOnlyList<PadRow> pads, double x, double y) {
        for (int i = 0; i < pads.Count; i++) {
            var pad = pads[i];
            if (Math.Abs(x - pad.X) <= pad.Width / 2 + 1e-9 &&
                Math.Abs(y - pad.Y) <= pad.Length / 2 + 1e-9) return true;
        }
        return false;
    }

    static double Area(IReadOnlyList<PadRow> pads) {
        double area = 0;
        for (int i = 0; i < pads.Count; i++) area += pads[i].Width * pads[i].Length;
        return area;
    }

    /// <summary>The plan's floor cells, in the exit's own frame: centre offset from the model origin.</summary>
    static List<(int X, int Y, double LX, double LY)> PlateCells(StationModuleRecord exit, StationExitOpenings openings) {
        var cells = new List<(int, int, double, double)>();
        var box = StationFootprints.ExitFloorBounds(exit);
        for (int x = (int)Math.Floor(box.X0); x < box.X1; x++) {
            for (int y = (int)Math.Floor(box.Y0); y < box.Y1; y++) {
                StationExitSnapping.ExitLocal(x - exit.X, y - exit.Y, exit.Rotation, out var lx, out var ly);
                cells.Add((x, y, lx, ly));
            }
        }
        return cells;
    }

    // ================================================== §5.1 loaded well opening

    [Test]
    public void LoadedZooExitsMatchTheSourceOpeningAndPads() {
        Assert.AreEqual(2, ZooExits.Count, "two loaded Zoo head-houses are pinned");
        foreach (var row in ZooExits) {
            var exit = ZooExit((string)row["id"]);
            var openings = StationExitOpenings.For(zoo.Modules, exit);
            Assert.IsNotNull(openings, exit.Id + " has no opening description");
            Assert.AreEqual((bool)row["headHouse"], openings.IsHeadHouse, exit.Id + " head-house");
            Assert.AreEqual((int)row["bays"], StationFootprints.ExitBays(exit), exit.Id + " bays");
            Assert.AreEqual((double)row["span"]["centre"], openings.Centre, Tolerance, exit.Id + " span centre");
            Assert.AreEqual((double)row["span"]["half"], openings.Half, Tolerance, exit.Id + " span half");
            Assert.AreEqual((double)row["yHi"], openings.YHi, Tolerance, exit.Id + " street edge");
            Assert.AreEqual((double)row["landingBack"], openings.LandingBack, Tolerance, exit.Id + " exitLandingBack");

            // The run columns and half-widths are `exitRunOpenings`' own answer.
            var sourceRuns = (JArray)row["runs"];
            Assert.AreEqual(sourceRuns.Count, openings.Runs.Count, exit.Id + " run count");
            for (int i = 0; i < sourceRuns.Count; i++) {
                Assert.AreEqual((double)sourceRuns[i]["column"], openings.Runs[i].Column, Tolerance, exit.Id + " run " + i + " column");
                Assert.AreEqual((double)sourceRuns[i]["row"], openings.Runs[i].Row, Tolerance, exit.Id + " run " + i + " row");
                Assert.AreEqual((double)sourceRuns[i]["half"], openings.Runs[i].Half, Tolerance, exit.Id + " run " + i + " half");
            }

            // The concrete the real `buildExit` lays: strips **and** the per-run stair
            // landings, as one set. This is the parity the escalator-only version missed —
            // `exit-uncovered-2-258` holds a stair in one bay, so the source floors its 1 m
            // upper landing even though the corridor below it opens.
            var expected = PadsOf(row);
            var actual = ActualPads(openings);
            Assert.AreEqual(expected.Count, actual.Count, exit.Id + " concrete pad count " + Describe(actual));
            for (int i = 0; i < expected.Count; i++) {
                Assert.AreEqual(expected[i].X, actual[i].X, Tolerance, exit.Id + " pad " + i + " x");
                Assert.AreEqual(expected[i].Y, actual[i].Y, Tolerance, exit.Id + " pad " + i + " y");
                Assert.AreEqual(expected[i].Width, actual[i].Width, Tolerance, exit.Id + " pad " + i + " width");
                Assert.AreEqual(expected[i].Length, actual[i].Length, Tolerance, exit.Id + " pad " + i + " length");
                Assert.AreEqual(expected[i].Height, actual[i].Height, Tolerance, exit.Id + " pad " + i + " height");
            }

            // No pad overlaps another, and pad + open floor is exactly the plate.
            for (int i = 0; i < actual.Count; i++) {
                for (int j = i + 1; j < actual.Count; j++) {
                    bool overlap = Math.Abs(actual[i].X - actual[j].X) * 2 < actual[i].Width + actual[j].Width - 1e-9 &&
                                   Math.Abs(actual[i].Y - actual[j].Y) * 2 < actual[i].Length + actual[j].Length - 1e-9;
                    Assert.IsFalse(overlap, exit.Id + " pads " + i + " and " + j + " overlap");
                }
            }
            var cells = PlateCells(exit, openings);
            double plateArea = openings.Width * (openings.YHi - StationExitOpenings.BackY);
            Assert.AreEqual(plateArea, Area(actual) + cells.Count(cell => !Covers(actual, cell.LX, cell.LY)), 1e-6,
                exit.Id + " pads + open cells must tile the plate");
            // Everything left open is a run's wellway — never a hole beside the runs — and the
            // stair landing really closes its own cell.
            foreach (var cell in cells) {
                if (Covers(actual, cell.LX, cell.LY)) continue;
                Assert.IsTrue(openings.IsWellwayCell(cell.X, cell.Y),
                    exit.Id + " opened " + cell.X + "," + cell.Y + " but no run descends there");
            }
            int stairRows = openings.Runs.Count(run => !run.Escalator);
            Assert.AreEqual(stairRows, openings.LandingPads.Count, exit.Id + " one landing pad per non-escalator run");
        }
        // The asymmetry the fixture records: C holds a stair, B does not.
        var c = StationExitOpenings.For(zoo.Modules, ZooExit("exit-uncovered-2-258"));
        var b = StationExitOpenings.For(zoo.Modules, ZooExit("exit-uncovered-2-398"));
        Assert.AreEqual(1, c.LandingPads.Count, "exit C's stair needs its concrete top landing");
        Assert.AreEqual(0, b.LandingPads.Count, "exit B's two escalators own their decks");
        Assert.AreEqual(0, c.LandingPads[0].X, Tolerance, "the landing is on the stair's own column");
        Assert.AreEqual(1, c.LandingPads[0].Width, Tolerance, "one block wide");
        Assert.AreEqual(1, c.LandingPads[0].Length, Tolerance, "one block along the run");
    }

    [Test]
    public void RunTopsAndHalfWidthsMatchTheSourceOpenings() {
        foreach (var row in ZooExits) {
            var exit = ZooExit((string)row["id"]);
            foreach (var run in (JArray)row["runModules"]) {
                var record = zoo.Modules.First(module => module.Facts.Id == (string)run["id"]);
                // A one-run document isolates that run's `exitRunOpenings` answer, which is
                // `runTop` plus `exitRunHalf` — the view-layer port of both.
                var single = StationExitOpenings.For(new[] { record }, exit);
                var expected = (JArray)run["openings"];
                Assert.AreEqual(expected.Count, single.Runs.Count, record.Id + " opening count");
                for (int i = 0; i < expected.Count; i++) {
                    Assert.AreEqual((double)expected[i]["column"], single.Runs[i].Column, Tolerance, record.Id + " runTop column");
                    Assert.AreEqual((double)expected[i]["row"], single.Runs[i].Row, Tolerance, record.Id + " runTop row");
                    Assert.AreEqual((double)expected[i]["half"], single.Runs[i].Half, Tolerance, record.Id + " exitRunHalf");
                }
            }
        }
    }

    [Test]
    public void StreetRendererLeavesTheSourceWellwayOpenAndFloorsTheRest() {
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        var street = new StationStreetModuleRenderer();
        var surface = new StationSurfaceModuleRenderer();
        var capture = new ProbeRenderer();
        var host = new GameObject("exit well probe");
        StationWorldView world = null;
        try {
            world = new StationWorldView(host.transform, "probe", new IStationViewRenderer[] { street, surface, capture },
                new StationViewAssets { Catalogue = catalogue, Shader = ProbeShader() });
            world.Build(zoo, new StationIndex(zoo));

            // One composed note per head-house, and only C carries a stair landing. A pad-free
            // export adds its own `exit-pad-free` note beside it, so count the composed ones.
            var composed = street.ExitNotes.Where(note => note.StartsWith("exit-floor-composed:", StringComparison.Ordinal)).ToList();
            Assert.AreEqual(2, composed.Count, "one note per head-house: " + string.Join("; ", street.ExitNotes));
            Assert.AreEqual(1, composed.Count(note => note.EndsWith("1landing", StringComparison.Ordinal)),
                "the stair bay composes one landing: " + string.Join("; ", street.ExitNotes));
            Assert.AreEqual(1, composed.Count(note => note.EndsWith("0landing", StringComparison.Ordinal)),
                "the escalator-only house composes none: " + string.Join("; ", street.ExitNotes));
            foreach (var note in composed) {
                StringAssert.StartsWith("exit-floor-composed:", note);
                StringAssert.Contains("5strips:2runs:retired", note);
            }

            // The live composed strip mesh must cover exactly the source's concrete cells and
            // leave exactly the source's open cells. Point-in-triangle at cell centres, in the
            // exit's own frame, is the deterministic stand-in for the isolated screenshot.
            foreach (var row in ZooExits) {
                string id = (string)row["id"];
                var exit = ZooExit(id);
                var openings = StationExitOpenings.For(zoo.Modules, exit);
                var expected = PadsOf(row);
                var built = street.Current.Modules.First(module => module.Type == "exit" && module.ModuleId == id);
                var filter = built.View.GetComponentsInChildren<MeshFilter>(true)
                    .FirstOrDefault(candidate => candidate.sharedMesh && candidate.sharedMesh.name.EndsWith(" pad"));
                Assert.IsNotNull(filter, id + " drew no composed pad");
                var mesh = filter.sharedMesh;
                var vertices = mesh.vertices;
                var triangles = mesh.triangles;
                foreach (var cell in PlateCells(exit, openings)) {
                    bool covered = CoveredByTopFace(vertices, triangles, cell.LX, cell.LY);
                    bool expectedCovered = Covers(expected, cell.LX, cell.LY);
                    Assert.AreEqual(expectedCovered, covered,
                        id + " cell " + cell.X + "," + cell.Y + " (" + cell.LX + "," + cell.LY + ")" +
                        (expectedCovered ? " must be floored" : " must stay open over the run"));
                }

                // The promoted plinth is off, not merely hidden under ours.
                foreach (var renderer in built.View.GetComponentsInChildren<MeshRenderer>(true)) {
                    if (renderer.transform.name == "exit pad strips") continue;
                    bool concrete = renderer.sharedMaterials.Any(material =>
                        material && material.name.IndexOf("concrete", StringComparison.OrdinalIgnoreCase) >= 0);
                    if (concrete) Assert.IsFalse(renderer.enabled, id + " prefab plinth part must be retired");
                }
            }

            // The cell ground's own opening: the whole plate is a ground hole, so the virtual
            // street is not drawn under the pad at all (the pad is the floor there).
            var notes = new List<string>();
            var input = StationCellRenderer.BuildInput(capture.Context, null, notes);
            foreach (var row in ZooExits) {
                var exit = ZooExit((string)row["id"]);
                foreach (var cell in StationFootprints.ExitFootprint(exit)) {
                    Assert.IsTrue(input.GroundHoles.Contains(new StationCellKey((int)cell.X, (int)cell.Y, (int)cell.Z)),
                        exit.Id + " ground is not open at " + cell.X + "," + cell.Y);
                }
            }

            // The paver exclusion is the same plate, and every saved tile under it is hidden
            // rather than drawn over the well.
            int oracleTiles = ZooExits.Sum(row => ((JArray)row["surfaceTiles"]).Count);
            Assert.GreaterOrEqual(surface.HiddenTiles, oracleTiles,
                "every saved paver under a plate is excluded (plus other module-derived holes)");
            foreach (var row in ZooExits) {
                foreach (var tile in (JArray)row["surfaceTiles"]) {
                    Assert.IsTrue((bool)tile["hidden"], tile["id"] + " disappeared in the source");
                    var hidden = surface.Current.Modules.FirstOrDefault(module => module.ModuleId == (string)tile["id"]);
                    Assert.IsNotNull(hidden, tile["id"] + " was not registered as a hidden tile");
                    StringAssert.EndsWith(" hidden", hidden.View.name);
                    Assert.AreEqual("", hidden.Key, tile["id"] + " carries no geometry, only its reason");
                }
            }
        } finally {
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /// <summary>
    /// 18 §6  the street exits stay **open** over their wellways once the world is
    /// registered and the view-mode walk has run. The old defect was not the composed
    /// strip mesh (that was already right): `BuildExit` only switched the tagged plinth
    /// renderer off, and `StationVisibilityTarget.Apply` collected every child and set
    /// `renderer.enabled = visible`, so the next Hidden/Ghost/Base pass put the baked pad
    /// straight back over the well.
    ///
    /// The proof is an actual triangle hit from above, after the visibility pass: the
    /// first surface through a corridor cell must be below pad height (the ramp/tread or
    /// the storey below), while the composed strips and Exit C's stair landing must be the
    /// first surface at exactly the pad top. Candidates include the promoted prefab, the
    /// cell/ground meshes, the paver batches and the composed strips.
    /// </summary>
    [Test]
    public void TheWellwayStaysOpenAcrossTheVisibilityPassAndTheStripsStillFloor() {
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        var cells = new StationCellRenderer();
        var vertical = new VerticalModuleRenderer();
        var street = new StationStreetModuleRenderer();
        var surface = new StationSurfaceModuleRenderer();
        var capture = new ProbeRenderer();
        var host = new GameObject("exit visibility probe");
        StationWorldView world = null;
        StationVisibilityRegistry registry = null;
        try {
            world = new StationWorldView(host.transform, "probe",
                new IStationViewRenderer[] { cells, vertical, street, surface, capture },
                new StationViewAssets { Catalogue = catalogue, Shader = ProbeShader() });
            world.Build(zoo, new StationIndex(zoo));
            world.Activate();

            // The production registration: every record's own role and storey bands.
            var modules = new Dictionary<string, StationModuleRecord>(StringComparer.Ordinal);
            foreach (var module in zoo.Modules) modules[module.Id] = module;
            registry = new StationVisibilityRegistry(ProbeShader());
            registry.State.LevelBase = zoo.LevelBase;
            registry.State.StoreyHeight = zoo.StoreyHeight;
            var grid = registry.State.Grid;
            foreach (var record in world.Records) {
                if (record?.View == null) continue;
                registry.Register(record.View.transform,
                    StationViewFeature.RoleOf(record, modules),
                    StationViewFeature.LevelsOf(record, modules, grid));
            }

            var exitIds = new HashSet<string>(ZooExits.Select(row => (string)row["id"]), StringComparer.Ordinal);
            var exitTargets = world.Records
                .Where(record => record.View != null && exitIds.Contains(record.ModuleId))
                .Select(record => record.View.GetComponent<StationVisibilityTarget>())
                .Where(target => target != null).ToArray();
            Assert.AreEqual(ZooExits.Count, exitTargets.Length, "one registered visibility target per head-house");

            // Cycle every view mode the player can produce and end on Base: the retired
            // plinth must not come back on the Hidden -> Ghost -> Base sequence.
            foreach (var target in exitTargets) {
                foreach (var mode in new[] { StationDrawMode.Hidden, StationDrawMode.Ghost, StationDrawMode.Base }) {
                    target.Apply(mode, null);
                }
            }
            registry.State.ActiveLevel = 0;
            registry.Apply();

            foreach (var row in ZooExits) {
                string id = (string)row["id"];
                var exit = ZooExit(id);
                var openings = StationExitOpenings.For(zoo.Modules, exit);
                // The root sits on the cell's floor top; the plinth adds its own height on
                // top of it, so the pad's document plane is `z + 1 + EXIT_BASE_HEIGHT`.
                float tops = (float)(exit.Facts.Z + 1 + StationExitOpenings.BaseHeight);
                var built = street.Current.Modules.First(module => module.Type == "exit" && module.ModuleId == id);
                var pad = built.View.GetComponentsInChildren<MeshFilter>(true)
                    .FirstOrDefault(candidate => candidate.sharedMesh &&
                        candidate.sharedMesh.name.EndsWith(" pad", StringComparison.Ordinal));
                Assert.IsNotNull(pad, id + " drew no composed pad");
                var padMesh = pad.sharedMesh;
                var top = PadTopTriangles(padMesh, pad.transform, tops);
                bool IsEscalatorTopLanding(double lx, double ly) =>
                    openings.Runs.Any(run => run.Escalator &&
                        Math.Abs(lx - run.Column) < 1e-6 && Math.Abs(ly - run.Row) < 1e-6);

                // Every cell of the plate, judged by the composed mesh's own triangle: the
                // geometry decides the expectation, so a coverage bug cannot agree with itself.
                foreach (var cell in PlateCells(exit, openings)) {
                    float cx = cell.X + .5f;
                    float cy = cell.Y + .5f;
                    bool floored = CoversTopFace(top, cx, cy);
                    var hit = FirstSurface(world, cx, cy, exit.Facts.Z + 8f, exit.Facts.Z - 14f);
                    string where = id + " cell " + cell.X + "," + cell.Y;
                    if (floored) {
                        Assert.IsTrue(hit.Found, where + " is floored but the ray hit nothing");
                        Assert.AreEqual(tops, hit.Z, 1e-3f,
                            where + " first surface is '" + hit.Name + "' at " + hit.Z + " not the composed pad top");
                        Assert.AreEqual("exit pad strips", hit.Name,
                            where + " must be floored by the composed strips, not '" + hit.Name + "'");
                    } else if (IsEscalatorTopLanding(cell.LX, cell.LY)) {
                        // `buildExit` + `exitLandingHeight`: escalators own their top landing deck lifted
                        // to `tops` (`z + 1 + EXIT_BASE_HEIGHT`), while the exit's plinth/ground/pavers stay open.
                        Assert.IsTrue(hit.Found, where + " escalator top landing hit nothing");
                        StringAssert.StartsWith("escalator-", hit.Owner,
                            where + " escalator top landing must belong to the escalator, not '" + hit.Name + "' (" + hit.Owner + ")");
                        Assert.AreNotEqual("exit pad strips", hit.Name, where + " is an escalator deck, not a concrete strip");
                        Assert.GreaterOrEqual(hit.Z, tops - .03f, where + " escalator top landing was not lifted to the exit plinth");
                        Assert.LessOrEqual(hit.Z, tops + .06f, where + " escalator top landing rose above step/comb height");
                    } else {
                        Assert.IsTrue(hit.Found, where + " is open but the ray hit nothing at all");
                        Assert.Less(hit.Z, tops - 1e-3f,
                            where + " is still capped at pad height by '" + hit.Name + "' (" + hit.Owner + ")");
                        Assert.AreNotEqual("exit pad strips", hit.Name, where + " is open but the strips floor it");
                    }
                }

                // The source's own predicate: a wellway cell that no landing floors must be
                // open, and B's two escalator corridors are exactly that (excluding the 1 m
                // upper landing cell where each lifted escalator owns its own flat deck).
                var openWells = openings.WellwayCells()
                    .Where(cell => !CoversTopFace(top, cell.X + .5f, cell.Y + .5f)).ToList();
                int expectedOpen = openings.LandingPads.Count == 0 ? openings.WellwayCells().Count : -1;
                if (expectedOpen >= 0) {
                    Assert.AreEqual(expectedOpen, openWells.Count,
                        id + " opens one wellway cell per run column");
                }
                var plateByKey = PlateCells(exit, openings).ToDictionary(c => (c.X, c.Y));
                var descendingWells = openWells
                    .Where(cell => !plateByKey.TryGetValue((cell.X, cell.Y), out var local) ||
                        !IsEscalatorTopLanding(local.LX, local.LY))
                    .ToList();
                Assert.Greater(descendingWells.Count, 0, id + " exposes at least one open corridor cell");
                foreach (var cell in descendingWells) {
                    var hit = FirstSurface(world, cell.X + .5f, cell.Y + .5f, exit.Facts.Z + 8f, exit.Facts.Z - 14f);
                    Assert.IsTrue(hit.Found, id + " wellway " + cell.X + "," + cell.Y + " hit nothing below");
                    Assert.Less(hit.Z, tops - 1e-3f,
                        id + " wellway " + cell.X + "," + cell.Y + " is capped at " + hit.Z + " by '" +
                        hit.Name + "' (" + hit.Owner + ")");
                }

                // The opposite condition: Exit C's stair landing is the one floored run column.
                if (openings.LandingPads.Count > 0) {
                    foreach (var landing in openings.LandingPads) {
                        var cell = PlateCells(exit, openings).First(candidate =>
                            Math.Abs(candidate.LX - landing.X) < 1e-6 && Math.Abs(candidate.LY - landing.Y) < 1e-6);
                        var hit = FirstSurface(world, cell.X + .5f, cell.Y + .5f, exit.Facts.Z + 8f, exit.Facts.Z - 14f);
                        Assert.IsTrue(hit.Found, id + " stair landing " + cell.X + "," + cell.Y + " is open");
                        Assert.AreEqual(tops, hit.Z, 1e-3f,
                            id + " stair landing first surface is '" + hit.Name + "' at " + hit.Z);
                        Assert.AreEqual("exit pad strips", hit.Name,
                            id + " stair landing must be the composed concrete strip");
                    }
                }
            }
        } finally {
            registry?.Dispose();
            world?.Dispose();
            UnityEngine.Object.DestroyImmediate(host);
        }
    }

    /* -------------------------------------------- document-space surface probe */

    struct SurfaceHit {
        public bool Found;
        public float Z;
        public string Name;
        public string Owner;
    }

    /// <summary>The nearest enabled triangle a vertical document ray (from above) meets.</summary>
    static SurfaceHit FirstSurface(StationWorldView world, float x, float y, float fromZ, float toZ) {
        var best = new SurfaceHit { Z = float.MinValue };
        if (world == null) return best;
        foreach (var record in world.Records) {
            if (record?.View == null) continue;
            foreach (var renderer in record.View.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                // Cheap rejection: the renderer must span the cell column vertically.
                var bounds = renderer.bounds;
                var min = StationCoordinates.WorldToDocument(bounds.min);
                var max = StationCoordinates.WorldToDocument(bounds.max);
                if (x < min.x - .01f || x > max.x + .01f || y < min.y - .01f || y > max.y + .01f) continue;
                if (max.z < toZ || min.z > fromZ) continue;
                var filter = renderer.GetComponent<MeshFilter>();
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh || !mesh.isReadable) continue;
                var vertices = mesh.vertices;
                var triangles = mesh.triangles;
                var matrix = renderer.transform.localToWorldMatrix;
                for (int i = 0; i + 2 < triangles.Length; i += 3) {
                    var a = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i]]));
                    var b = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i + 1]]));
                    var c = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i + 2]]));
                    if (!VerticalHit(x, y, a, b, c, out float z)) continue;
                    if (z < toZ - 1e-4f || z > fromZ + 1e-4f) continue;
                    if (z <= best.Z) continue;
                    best = new SurfaceHit { Found = true, Z = z, Name = renderer.transform.name, Owner = record.ModuleId };
                }
            }
        }
        return best;
    }

    /// <summary>Barycentric hit of a vertical ray with one document-space triangle.</summary>
    static bool VerticalHit(float x, float y, Vector3 a, Vector3 b, Vector3 c, out float z) {
        z = 0f;
        float ax = b.x - a.x, ay = b.y - a.y, az = b.z - a.z;
        float bx = c.x - a.x, by = c.y - a.y, bz = c.z - a.z;
        float nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        if (Mathf.Abs(nz) < 1e-9f) return false;
        float e0 = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
        float e1 = (c.x - b.x) * (y - b.y) - (c.y - b.y) * (x - b.x);
        float e2 = (a.x - c.x) * (y - c.y) - (a.y - c.y) * (x - c.x);
        bool inside = (e0 >= 0f && e1 >= 0f && e2 >= 0f) || (e0 <= 0f && e1 <= 0f && e2 <= 0f);
        if (!inside) return false;
        z = a.z - (nx * (x - a.x) + ny * (y - a.y)) / nz;
        return true;
    }

    struct TopFace {
        public Vector3 A, B, C;
    }

    /// <summary>The composed pad's top-face triangles, measured in document space.</summary>
    static List<TopFace> PadTopTriangles(Mesh mesh, Transform transform, float top) {
        var faces = new List<TopFace>();
        var vertices = mesh.vertices;
        var triangles = mesh.triangles;
        var matrix = transform.localToWorldMatrix;
        for (int i = 0; i + 2 < triangles.Length; i += 3) {
            var a = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i]]));
            var b = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i + 1]]));
            var c = StationCoordinates.WorldToDocument(matrix.MultiplyPoint3x4(vertices[triangles[i + 2]]));
            if (Math.Abs(a.z - top) > 1e-4f || Math.Abs(b.z - top) > 1e-4f || Math.Abs(c.z - top) > 1e-4f) continue;
            faces.Add(new TopFace { A = a, B = b, C = c });
        }
        return faces;
    }

    static bool CoversTopFace(IReadOnlyList<TopFace> faces, float x, float y) {
        for (int i = 0; i < faces.Count; i++) {
            var face = faces[i];
            if (PointInTriangle(x, y, face.A.x, face.A.y, face.B.x, face.B.y, face.C.x, face.C.y)) return true;
        }
        return false;
    }

    /// <summary>True when a top-face triangle (y = the 0.25 m pad top) covers the plan point.</summary>
    static bool CoveredByTopFace(Vector3[] vertices, int[] triangles, double lx, double ly) {        const float top = (float)StationExitOpenings.BaseHeight;
        for (int i = 0; i + 2 < triangles.Length; i += 3) {
            var a = vertices[triangles[i]];
            var b = vertices[triangles[i + 1]];
            var c = vertices[triangles[i + 2]];
            if (Math.Abs(a.y - top) > 1e-4f || Math.Abs(b.y - top) > 1e-4f || Math.Abs(c.y - top) > 1e-4f) continue;
            if (PointInTriangle((float)lx, (float)ly, a.x, a.z, b.x, b.z, c.x, c.z)) return true;
        }
        return false;
    }

    static bool PointInTriangle(float px, float py, float ax, float ay, float bx, float by, float cx, float cy) {
        float d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
        float d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
        float d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
        bool hasNegative = d1 < -1e-6f || d2 < -1e-6f || d3 < -1e-6f;
        bool hasPositive = d1 > 1e-6f || d2 > 1e-6f || d3 > 1e-6f;
        return !(hasNegative && hasPositive);
    }

    static string Describe(IReadOnlyList<PadRow> pads) {
        var text = new System.Text.StringBuilder();
        foreach (var pad in pads) {
            if (text.Length > 0) text.Append(' ');
            text.Append('(').Append(pad.X.ToString("0.###", CultureInfo.InvariantCulture)).Append(',')
                .Append(pad.Y.ToString("0.###", CultureInfo.InvariantCulture)).Append(" ")
                .Append(pad.Width.ToString("0.###", CultureInfo.InvariantCulture)).Append('x')
                .Append(pad.Length.ToString("0.###", CultureInfo.InvariantCulture)).Append(" h")
                .Append(pad.Height.ToString("0.###", CultureInfo.InvariantCulture)).Append(')');
        }
        return text.ToString();
    }

    static Shader ProbeShader() {
        var shader = StationFinishLibrary.FindShader();
        if (shader) return shader;
        shader = Shader.Find("Universal Render Pipeline/Lit");
        return shader ? shader : Shader.Find("Standard");
    }

    // ========================================================== §5.2 exit snaps

    [Test]
    public void SnapExitToRampMatchesTheSourceOracle() {
        var reasons = new Dictionary<string, string> {
            ["block-stair-refused"] = "blocking-stair",
            ["turning-stair-refused"] = "turning-stair",
            ["lift-refused"] = "not-ramp",
            ["level-ramp-refused"] = "level-run",
            ["doorway-exit-refused"] = "not-head-house",
            ["virtual-exit-refused"] = "not-head-house",
        };
        foreach (var row in (JArray)Oracle["snapExitToRamp"]) {
            string id = (string)row["id"];
            var exitRow = row["exit"];
            var exit = ExitRecord((string)exitRow["type"], (int)exitRow["x"], (int)exitRow["y"], (int)exitRow["z"],
                (int)exitRow["rot"], (int)exitRow["bays"]);
            var ramp = RecordOf(row["ramp"]);
            bool ok = StationExitSnapping.TrySnapExitToRamp(exit, ramp, out var snap, out var reason);
            var expected = row["result"];
            if (expected == null || expected.Type == JTokenType.Null) {
                Assert.IsFalse(ok, id + " must refuse the snap, got " + (ok ? snap.ToString() : ""));
                if (reasons.TryGetValue(id, out var expectedReason))
                    Assert.AreEqual(expectedReason, reason, id + " refusal reason");
                continue;
            }
            Assert.IsTrue(ok, id + " must snap: " + reason);
            Assert.AreEqual((double)expected["x"], snap.X, Tolerance, id + " x");
            Assert.AreEqual((double)expected["y"], snap.Y, Tolerance, id + " y");
            Assert.AreEqual((double)expected["z"], snap.Z, Tolerance, id + " z");
            Assert.AreEqual((int)expected["rot"], snap.Rotation, id + " rotation");
            // The snapped description really reports the source's run set: rebuild the exit at
            // the snapped anchor and compare `exitRunOpenings` / `exitRunHalf` exactly.
            var snappedExit = ExitRecord((string)exitRow["type"], (int)Math.Round(snap.X), (int)Math.Round(snap.Y),
                (int)Math.Round(snap.Z), snap.Rotation, (int)exitRow["bays"]);
            var openings = StationExitOpenings.For(new[] { ramp }, snappedExit);
            Assert.IsNotNull(openings, id + " snapped exit has no opening description");
            var sourceOpenings = (JArray)row["openings"];
            Assert.AreEqual(sourceOpenings.Count, openings.Runs.Count, id + " snapped run count");
            for (int i = 0; i < sourceOpenings.Count; i++) {
                Assert.AreEqual((double)sourceOpenings[i]["column"], openings.Runs[i].Column, Tolerance, id + " snapped column");
                Assert.AreEqual((double)sourceOpenings[i]["row"], openings.Runs[i].Row, Tolerance, id + " snapped row");
                Assert.AreEqual((double)sourceOpenings[i]["half"], openings.Runs[i].Half, Tolerance, id + " snapped half");
            }
        }
    }

    [Test]
    public void ExitRunSnapMatchesTheSourceOracle() {
        // The fixture station: exits A and B plus two runs already linked to A, exactly as
        // the recorder built it. The doorway exit proves the snap is a head-house rule.
        var modules = new[] {
            ExitRecord("exit-uncovered-2", 10, 10, 0, 0, 2, "exit-a"),
            ExitRecord("exit-covered-3", 40, 40, 0, 2, 3, "exit-b"),
            ExitRecord("exit-doorway-2", 60, 60, 0, 0, 2, "exit-doorway"),
        };
        var exits = new Dictionary<string, StationModuleRecord> {
            ["10,10"] = modules[0], ["40,40"] = modules[1], ["60,60"] = modules[2],
        };
        var records = new List<StationModuleRecord>(modules);
        foreach (var row in (JArray)Oracle["exitRunSnap"]) {
            string id = (string)row["id"];
            var pointer = (JArray)row["pointer"];
            int x = (int)pointer[0], y = (int)pointer[1], z = (int)pointer[2];
            double run = row["run"] == null || row["run"].Type == JTokenType.Null
                ? StationExitSnapping.StairRun : (double)row["run"];
            double rise = row["rise"] == null || row["rise"].Type == JTokenType.Null
                ? StationExitSnapping.StairRise : (double)row["rise"];
            bool ok = StationExitSnapping.TrySnapRunToExitBay(records, x, y, z, run, rise, out var snap, out var reason);
            var expected = row["result"];
            if (expected == null || expected.Type == JTokenType.Null) {
                Assert.IsFalse(ok, id + " must not snap: " + (ok ? snap.ToString() : ""));
                continue;
            }
            Assert.IsTrue(ok, id + " must snap: " + reason);
            Assert.AreEqual((string)expected["exitId"], snap.ExitId, id + " exit");
            Assert.AreEqual((double)expected["bay"], snap.Bay, Tolerance, id + " bay");
            Assert.AreEqual(((JArray)expected["top"])[0].Value<double>(), snap.Top.X, Tolerance, id + " top x");
            Assert.AreEqual(((JArray)expected["top"])[1].Value<double>(), snap.Top.Y, Tolerance, id + " top y");
            Assert.AreEqual(((JArray)expected["top"])[2].Value<double>(), snap.Top.Z, Tolerance, id + " top z");
            Assert.AreEqual(((JArray)expected["base"])[0].Value<double>(), snap.Base.X, Tolerance, id + " base x");
            Assert.AreEqual(((JArray)expected["base"])[1].Value<double>(), snap.Base.Y, Tolerance, id + " base y");
            Assert.AreEqual(((JArray)expected["base"])[2].Value<double>(), snap.Base.Z, Tolerance, id + " base z");
            Assert.AreEqual((int)expected["rot"], snap.Rotation, id + " rotation");
        }
        // The defaults the resolver passes are the source's 长 rung and the 30° escalator run.
        Assert.AreEqual(8, StationExitSnapping.StairRun, "STAIR_RUN (长 5 m at 2:3)");
        Assert.AreEqual(5, StationExitSnapping.StairRise, "STAIR_RISE");
        Assert.AreEqual(9, StationExitSnapping.EscalatorRun, "ESCALATOR_RUN (30°)");
        Assert.AreEqual(5, StationExitSnapping.EscalatorRise, "ESCALATOR_RISE");
    }

    /// <summary>
    /// The lift source finding (plan 16 §5.2): the TypeScript tool has **no**
    /// lift-to-head-house snap. `snapExitToRamp` accepts only a stair or escalator, and the
    /// lift tool is a shaft/hover-extension path of its own (`EquipmentTool.liftHover` →
    /// `liftExtendedUp/Down`), never a bay snap. The recorder's `lift-refused` row is the
    /// source's own `null`; this pins that Unity must not invent the rule until the extra
    /// behaviour is specified separately.
    /// </summary>
    [Test]
    public void ALiftIsNotAnExitSnapRampInTheSourceOrHere() {
        var lift = RecordOf(((JArray)Oracle["snapExitToRamp"])
            .First(row => (string)row["id"] == "lift-refused")["ramp"]);
        Assert.AreEqual("lift", lift.Type, "fixture ramp");
        Assert.IsFalse(StationExitSnapping.IsSnapRamp(lift), "a lift is not a snap ramp");
        var exit = ExitRecord("exit-uncovered-2", 10, 10, 0, 0, 2);
        Assert.IsFalse(StationExitSnapping.TrySnapExitToRamp(exit, lift, out _, out var reason), "no lift snap");
        Assert.AreEqual("not-ramp", reason);
        var sourceRow = ((JArray)Oracle["snapExitToRamp"]).First(row => (string)row["id"] == "lift-refused");
        Assert.AreEqual(JTokenType.Null, sourceRow["result"].Type, "the source returns null for a lift");
    }

    sealed class ProbeRenderer : IStationViewRenderer {
        public StationViewBuildContext Context { get; private set; }
        public string Role => "probe";
        public void Build(StationViewBuildContext context) => Context = context;
        public void Release() => Context = null;
    }

    // ==================================================== §5.2 resolver wiring

    /// <summary>One oracle module DTO in the save's own shape, for a tiny probe document.</summary>
    static JObject SaveModule(JToken dto) {
        var module = new JObject {
            ["id"] = (string)dto["id"], ["type"] = (string)dto["type"],
            ["x"] = (int)dto["x"], ["y"] = (int)dto["y"], ["z"] = (int)dto["z"],
            ["rot"] = dto["rot"] == null ? 0 : (int)dto["rot"],
            ["w"] = dto["w"] == null ? 1 : (int)dto["w"],
            ["d"] = dto["d"] == null ? 1 : (int)dto["d"],
            ["h"] = dto["h"] == null ? 1 : (int)dto["h"],
            ["cfg"] = dto["cfg"]?.DeepClone() ?? new JObject(),
        };
        foreach (var key in new[] { "from", "to" }) {
            if (!(dto[key] is JArray point)) continue;
            module[key] = new JObject { ["x"] = point[0], ["y"] = point[1], ["z"] = point[2] };
        }
        return module;
    }

    static StationIndex Document(params JObject[] modules) => Document(new JArray(), modules);

    static StationIndex Document(JArray cells, params JObject[] modules) {
        var moduleArray = new JArray();
        foreach (var module in modules) moduleArray.Add(module);
        var save = new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "exit snap probe",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells,
                ["modules"] = moduleArray,
                ["lines"] = new JArray(),
            },
        };
        var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None),
            new StationSource("exit snap probe", ""));
        Assert.IsNotNull(read?.Document, "the probe document must parse");
        return read.Index;
    }

    static JObject SolidCell(int x, int y, int z) =>
        new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" };

    static StationPlacementHit Hit(int x, int y, int z) =>
        new StationPlacementHit(x, y, z, x, y, z, false, new StationPoint(x + .5, y + .5, z), z);

    static JObject SnapshotRow(string id) =>
        (JObject)((JArray)Oracle["snapExitToRamp"]).First(row => (string)row["id"] == id);

    [Test]
    public void ResolveSnapsAFreshExitOntoThePickedRamp() {
        // The source's `buildPlacementModule` order: build at the pointer, then
        // `snapExitToRamp(mod, targetRamp) ?? mod`.
        var ramp = SnapshotRow("straight-stair-south")["ramp"];
        // The stair's upper landing is a ground hole where the run goes through the
        // street, so the fixture gives the head-house an authored solid at its anchor
        // cell — the same support the Zoo street provides.
        var index = Document(new JArray { SolidCell(10, 10, 0) }, SaveModule(ramp));
        var request = new StationPlacementRequest {
            ToolType = "exit-uncovered-2",
            TargetModuleId = "ramp-straight-south",
            Hit = Hit(12, 12, 0),
            Rotation = 0,
        };
        var plan = StationModulePlacement.Resolve(index, request);
        Assert.IsTrue(plan.Ok, "a head-house with a valid plate must resolve: " + plan.Reason);
        var expected = SnapshotRow("straight-stair-south")["result"];
        Assert.AreEqual((int)expected["x"], plan.Candidate.X, "the bay lands on the ramp's upper endpoint");
        Assert.AreEqual((int)expected["y"], plan.Candidate.Y);
        Assert.AreEqual((int)expected["z"], plan.Candidate.Z);
        Assert.AreEqual((int)expected["rot"], plan.Candidate.Rotation);
        Assert.AreEqual("exit", plan.Candidate.Type);
        Assert.AreEqual("A", plan.Candidate.Text("name"), "a fresh exit letters itself");
        Assert.AreEqual(2, (int)plan.Candidate.Number("bays"), "the palette id's bay count");
        Assert.AreEqual("false", plan.Candidate.Text("covered"), "the -uncovered- id drops the canopy");

        // Without the ramp pick the same request keeps the pointer's own cell — the source's
        // `?? mod` fallback, not a refusal.
        var unsnapped = StationModulePlacement.Resolve(index, new StationPlacementRequest {
            ToolType = "exit-uncovered-2", Hit = Hit(12, 12, 0), Rotation = 0,
        });
        Assert.IsTrue(unsnapped.Ok, "the unsnapped fallback still resolves: " + unsnapped.Reason);
        Assert.AreEqual(12, unsnapped.Candidate.X);
        Assert.AreEqual(12, unsnapped.Candidate.Y);
    }

    [Test]
    public void ResolveSnapsAFreshRampIntoTheExitBay() {
        // The bay is A at (10,10,0), two bays, with its two escalator runs already saved —
        // exactly the document the source's `exitRunSnap` reads.
        var exitModule = new JObject {
            ["id"] = "exit-a", ["type"] = "exit", ["x"] = 10, ["y"] = 10, ["z"] = 0, ["rot"] = 0,
            ["w"] = 1, ["d"] = 1, ["h"] = 1,
            ["cfg"] = new JObject { ["name"] = "A", ["inRate"] = 900, ["open"] = true, ["covered"] = false, ["bays"] = 2 },
        };
        var index = Document(exitModule);

        // A fresh straight stair: its base is the pointer cell's exit bay, one storey below
        // and a full run back toward the mouth — not the street cell the pointer hit.
        var stair = StationModulePlacement.Resolve(index, new StationPlacementRequest {
            ToolType = "stair", Hit = Hit(10, 10, 0), Rotation = 0,
        });
        Assert.IsNotNull(stair.Candidate, "the stair candidate is built: " + stair.Reason);
        Assert.AreEqual(10, stair.Candidate.X, "bay 0 column");
        Assert.AreEqual(2, stair.Candidate.Y, "the base is one 8-cell run back");
        Assert.AreEqual(-5, stair.Candidate.Z, "one 5 m rise down");
        Assert.AreEqual(0, stair.Candidate.Rotation, "the run climbs toward the exit's +y");
        Assert.AreEqual(new StationPoint(10, 2, -5), stair.Candidate.From.Value);
        Assert.AreEqual(new StationPoint(10, 10, 0), stair.Candidate.To.Value);
        StringAssert.Contains("\"from\"", stair.Candidate.Text("flights"), "the single flight is authored");
        // The corridor envelope is not ported, so the resolver refuses to commit the run
        // rather than validate it with a guessed box.
        Assert.AreEqual("ramp-corridor-unported", stair.Reason,
            "a ramp's collision check cannot run until rampEnvelope is ported");

        // The escalator's own 30° rung: 9 cells of run, the same 5 m rise.
        var escalator = StationModulePlacement.Resolve(index, new StationPlacementRequest {
            ToolType = "escalator", Hit = Hit(10, 10, 0), Rotation = 0,
        });
        Assert.IsNotNull(escalator.Candidate, "the escalator candidate is built: " + escalator.Reason);
        Assert.AreEqual(1, escalator.Candidate.Y, "9 cells back for the 30° run");
        Assert.AreEqual(-5, escalator.Candidate.Z, "the same storey");
        Assert.AreEqual("30", escalator.Candidate.Text("incline"));
        Assert.AreEqual("up", escalator.Candidate.Text("dir"));
    }
}
