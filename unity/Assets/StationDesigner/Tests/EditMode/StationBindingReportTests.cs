using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Packet B4's proof that the **actual** Zoo load publishes its binding evidence:
    /// one row per committed module with the resolution key, the prefab/part
    /// provenance, the family builder that took it, its Unity placement and its motion
    /// status — and that a deliberate no-view is never confused with a fallback.
    ///
    /// The world here is built by the same renderers the generic player registers
    /// (`StationFamilyRenderers`, `VerticalModuleFeature`, `StationOpeningRenderers`,
    /// `StationSignPacket`, `StationRoadRenderer`), so the rows describe the load the
    /// browser sees. The frames come from the real <see cref="Metro.Sim.StationSimulationSession"/>
    /// over the committed document.
    ///
    /// The Zoo world is built **once** for the class (`OneTimeSetUp`): 4 299 modules and
    /// seven read-only assertions would otherwise rebuild it per test, which is slow
    /// and, on a shared Editor, antisocial. Each test only reads the finished report.
    /// </summary>
    public sealed class StationBindingReportTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

        static GameObject root;
        static StationWorldView zooWorld;
        static StationBindingReport report;
        static StationDocument document;

        [OneTimeSetUp]
        public void OneTimeSetUp() {
            root = new GameObject("StationBindingReportTests");
            var read = StationDocumentReader.ReadFile(ZooPath);
            document = read.Document;
            var renderers = Renderers();
            zooWorld = new StationWorldView(root.transform, "binding zoo", renderers, Assets());
            zooWorld.Build(document, read.Index);
            zooWorld.Activate();
            // The report must read the same renderer instances that built the world, so its
            // provenance comes from the views those builders really produced.
            report = StationBindingReport.Build("zoo", zooWorld, renderers, Catalogue(), Trains(), 40);
        }

        [OneTimeTearDown]
        public void OneTimeTearDown() {
            report?.Dispose();
            report = null;
            zooWorld?.Dispose();
            zooWorld = null;
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
            StationRenderers.Clear();
            StationFrameSinks.Clear();
        }

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "the runtime catalogue asset is missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static TrainCatalogue Trains() {
            var catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "the train catalogue asset is missing: " + TrainCatalogue.AssetPath);
            return catalogue;
        }

        /// <summary>The scene's shader: the sign renderer refuses to build without one, exactly
        /// as the player supplies `stationShader` from `Scenes/StationGame.unity`.</summary>
        static Shader SceneShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static StationViewAssets Assets() => new StationViewAssets {
            Catalogue = Catalogue(), TrainCatalogue = Trains(), Shader = SceneShader(),
        };

        static IStationViewRenderer[] Renderers() => new IStationViewRenderer[] {
            new OutdoorModuleRenderer(),
            new Metro.App.Views.VerticalModuleRenderer(),
            new OpeningModuleRenderer(),
            new StationSignRenderer(),
            new Metro.App.Views.StationRoadRenderer(),
            new Metro.App.Views.TrainConsistRenderer(),
            // Plan 13 §3: the four group renderers the generic player registered for
            // surfaces, street furniture, equipment and live displays. Without them the
            // report described a load the browser no longer runs (RCA 14 audit).
            new Metro.App.Views.StationSurfaceModuleRenderer(),
            new Metro.App.Views.StationStreetModuleRenderer(),
            new Metro.App.Views.StationEquipmentModuleRenderer(),
            new Metro.App.Views.StationDisplayModuleRenderer(),
        };

        [Test]
        public void ZooLoadWritesOneRowPerModuleWithItsRendererAndPlacement() {
            Assert.AreEqual(14066, document.CellCount, "Zoo cells");
            Assert.AreEqual(4299, document.ModuleCount, "Zoo modules");
            Assert.AreEqual(1, document.LineCount, "Zoo lines");
            Assert.AreEqual(document.ModuleCount + report.Trains.Count, report.Rows.Count,
                "one row per committed module (plus one per train)");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in report.Rows) {
                if (row.Kind != "module") continue;
                Assert.IsTrue(ids.Add(row.Id), "duplicate module row: " + row.Id);
                Assert.IsFalse(string.IsNullOrEmpty(row.Type), "type on " + row.Id);
                Assert.IsFalse(string.IsNullOrEmpty(row.Placement), "placement on " + row.Id);
                Assert.GreaterOrEqual(row.LevelMax, row.LevelMin, "level span on " + row.Id);
                if (!row.IsBound) continue;
                Assert.IsFalse(string.IsNullOrEmpty(row.ResolutionKey), "resolution key on " + row.Id);
                Assert.IsFalse(string.IsNullOrEmpty(row.Provenance), "provenance on " + row.Id);
                Assert.IsFalse(string.IsNullOrEmpty(row.RendererPath), "renderer path on " + row.Id);
            }
            Assert.AreEqual(document.ModuleCount, ids.Count, "every committed module id appears exactly once");
        }

        [Test]
        public void NamedFamiliesAreDrawnBoundAndMeasuredMoving() {
            var families = report.Families.ToDictionary(family => family.Family);
            foreach (var name in new[] { "stairs", "escalators", "lifts", "fences", "trees", "psd", "gates", "doors", "train-doors" }) {
                Assert.IsTrue(families.ContainsKey(name), "family row " + name);
                var family = families[name];
                Assert.AreEqual(0, family.Fallback, name + " has no fallback rows");
                Assert.AreEqual(0, family.NoView - family.Deliberate, name + " has no unhandled no-view rows");
                Assert.AreEqual(0, family.Unbound, name + " has no unbound rows");
                Assert.AreEqual(family.MovingRows - family.Immovable, family.Applied,
                    name + ": every moving row was driven by a frame or its own module state");
            }
            // The source's static families carry no channel and must not be reported as unbound.
            foreach (var name in new[] { "stairs", "fences", "trees" }) {
                var staticRows = report.Rows.Where(row => row.Family == name).ToArray();
                Assert.IsNotEmpty(staticRows, name + " rows");
                Assert.IsTrue(staticRows.All(row => row.Motion == "static:source"),
                    name + " is static in the source (motion-inventory)");
            }
            // A moving row that the frame actually drives must have moved on the object.
            var escalators = report.Rows.Where(row => row.Type == "escalator").ToArray();
            Assert.AreEqual(14, escalators.Length, "the 14 saved escalators");
            Assert.IsTrue(escalators.All(row => row.Motion == "bound:frame.Escalators"), "escalators are frame-driven");
            Assert.IsTrue(escalators.All(row => row.Applied), "each escalator binding was applied");
            Assert.IsTrue(escalators.Any(row => row.Moved > 1f), "the band travelled a measured distance");
            var prefabEscalators = escalators.Where(row => row.RendererPath == "vertical:VerticalModuleViews(prefab:escalator)").ToArray();
            var exitEscalators = escalators.Where(row => row.RendererPath == "vertical:VerticalModuleViews(dimensioned)").ToArray();
            Assert.AreEqual(11, prefabEscalators.Length, "11 interior Zoo escalators use the promoted prefab");
            Assert.AreEqual(3, exitEscalators.Length, "3 exit head-house escalators lift their upper landing by 0.25 m");
            Assert.IsTrue(exitEscalators.All(row => row.Provenance.Contains("prefab-rejected=exit-landing")),
                "exit escalators report exit-landing prefab rejection");
            // The lift binding is applied from the frame but C parks an uncalled car, so
            // nothing travels; that is a producer gap, not an unbound family.
            var lifts = report.Rows.Where(row => row.Type == "lift").ToArray();
            Assert.AreEqual(2, lifts.Length);
            Assert.IsTrue(lifts.All(row => row.Motion == "bound:frame.Lifts" && row.Applied), "lifts are frame-driven");
            Assert.IsTrue(lifts.All(row => row.Moved < .01f), "an uncalled car stays parked (C3 has no crowd)");
            // PSD leaves answer the berthing consist: at least one run opened in the 40 ticks.
            var psd = report.Rows.Where(row => row.Type == "platform-edge").ToArray();
            Assert.AreEqual(2, psd.Length);
            Assert.IsTrue(psd.All(row => row.Motion == "bound:frame.Doors"), "PSD runs are frame-driven");
            Assert.IsTrue(psd.Any(row => row.Moved > .3f), "a screen leaf slid on the berth");
            Assert.IsTrue(report.Rows.Where(row => row.Type == "psd-end").All(row => row.Motion == "static:source"),
                "a fixed screen end has no channel");
            // Gates answer the service's published lane state; room doors answer the crowd
            // proximity rule on the same passenger frames. Both are driven every tick.
            var gates = report.Rows.Where(row => row.Type == "gate").ToArray();
            Assert.AreEqual(15, gates.Length);
            Assert.IsTrue(gates.All(row => row.Motion == "bound:frame.Gates"),
                "every fare gate is driven by its own published lane state, never one station-wide switch");
            Assert.IsTrue(gates.All(row => row.Applied || !row.Movable),
                "every gate with a lane was driven from the service's gate frame");
            Assert.IsTrue(gates.Any(row => row.Moved > .05f), "a gate wing retracted a measured distance | " +
                report.FrameSource + " | " + string.Join("; ", gates.Select(row => row.Id + ":" + row.Motion +
                    ":applied=" + row.Applied + ":moved=" + row.Moved + ":movable=" + row.Movable)));
            // A fence-door gate (`gateHasLane` false) is bound and correctly immobile.
            Assert.IsTrue(gates.Where(row => !row.Movable).All(row => row.Motion == "bound:frame.Gates"),
                "a lane-less gate is still bound");
            var doors = report.Rows.Where(row => row.Type == "door" || row.Type == "cubicle").ToArray();
            Assert.AreEqual(10, doors.Length, "six standing doors and four cubicles");
            Assert.IsTrue(doors.All(row => row.Motion == "bound:frame.Passengers" && row.Applied),
                "swing leaves answer the published crowd proximity channel");
            Assert.IsTrue(doors.Any(row => row.Moved > 10f), "a hinge turned (degrees are folded into the probe)");
        }

        [Test]
        public void TreeFenceAndPsdRowsRecordTheirRealPrefabOrDimension() {
            var trees = report.Rows.Where(row => row.Type == "tree").ToArray();
            Assert.AreEqual(86, trees.Length);
            Assert.IsTrue(trees.All(row => row.Provenance.StartsWith("asset:Assets/StationDesigner/Generated/Prefabs/", StringComparison.Ordinal)),
                "a tree records the promoted prefab it instanced");
            Assert.IsTrue(trees.All(row => row.RendererPath == "modules:OutdoorModuleViews(prefab)"));
            var fences = report.Rows.Where(row => row.Type == "fence").ToArray();
            Assert.AreEqual(213, fences.Length);
            var variants = fences.Select(row => row.ResolutionKey).Distinct().OrderBy(key => key).ToArray();
            Assert.IsTrue(variants.Length >= 2, "Zoo's fences resolve more than one variant: " + string.Join(",", variants));
            var stairs = report.Rows.Where(row => row.Type == "stair").ToArray();
            Assert.AreEqual(5, stairs.Length);
            Assert.IsTrue(stairs.All(row => row.Provenance.StartsWith("dimensioned:stair", StringComparison.Ordinal)),
                "Zoo's stairs carry a wall side, so they are assembled at the authored dimensions");
            // Placement is the shared coordinate contract, not a re-derived box.
            var escalator = report.Rows.First(row => row.Id == "escalator-4059");
            StringAssert.Contains("rot=3", escalator.Placement);
            StringAssert.StartsWith("(", escalator.Placement);
            StringAssert.StartsWith("asset:Assets/StationDesigner/Generated/Prefabs/Escalator.prefab",
                escalator.Provenance);
        }

        [Test]
        public void DeliberateNoViewIsNeverCountedAsFallback() {
            var tv = report.Rows.Where(row => row.Type == "tv").ToArray();
            Assert.AreEqual(28, tv.Length, "the 28 saved televisions");
            var deliberate = tv.Where(row => row.Status.StartsWith("no-view: deliberate:pair-panel", StringComparison.Ordinal)).ToArray();
            Assert.IsNotEmpty(deliberate, "the second half of a back-to-back pair draws nothing by design");
            Assert.IsTrue(deliberate.All(row => row.Family == "other"));
            // A claimed type is drawn by its family renderer; since plan 13 §3 the
            // equipment renderer owns the 139 lights, so none of them may still report
            // itself as an unclaimed gap.
            var lights = report.Rows.Where(row => row.Type == "light").ToArray();
            Assert.AreEqual(139, lights.Length);
            Assert.IsTrue(lights.All(row => row.Status == "bound"), "a claimed type is drawn, not called unclaimed");
            Assert.IsTrue(lights.All(row => row.RendererPath.StartsWith("equipment:", StringComparison.Ordinal)),
                "the lights name the equipment renderer");
            // Every saved Zoo type is claimed by a renderer now, so an unclaimed branch
            // must not appear on the real load; the tiny-station probe below pins it.
            var unclaimed = report.Rows.Where(row =>
                row.Status.StartsWith("no-view: no-renderer:", StringComparison.Ordinal)).ToArray();
            Assert.IsEmpty(unclaimed.Select(row => row.Id + "=" + row.Status).ToArray(),
                "every Zoo type is claimed by a registered renderer");
            // The two reasons partition the module no-view rows; the train rows carry
            // their own status and are not claimed by either.
            var partition = report.Rows.Where(row => row.Kind == "module" && row.Status.StartsWith("no-view:", StringComparison.Ordinal)).ToArray();
            var unclassified = partition.Where(row =>
                !row.Status.StartsWith("no-view: no-renderer:", StringComparison.Ordinal) &&
                !row.Status.StartsWith("no-view: deliberate:", StringComparison.Ordinal)).ToArray();
            Assert.IsEmpty(unclassified.Select(row => row.Id + "=" + row.Status).ToArray(),
                "every no-view row names either a deliberate reason or a missing renderer");
            Assert.AreEqual(partition.Length,
                partition.Count(row => row.Status.StartsWith("no-view: no-renderer:", StringComparison.Ordinal)) +
                partition.Count(row => row.Status.StartsWith("no-view: deliberate:", StringComparison.Ordinal)),
                "the module no-view rows split in two");
            Assert.AreEqual(report.Status.NoView,
                partition.Length + report.Trains.Count(row => row.Status.StartsWith("no-view:", StringComparison.Ordinal)),
                "the status counter covers every no-view row");
            // A row is never a fallback merely because a renderer noted a caveat on a view it
            // did draw.
            var fallbacks = report.Rows.Where(row => row.IsFallback).Take(4)
                .Select(row => row.Type + " " + row.Id + " [" + row.Status + "] " + row.Note).ToArray();
            Assert.IsEmpty(fallbacks, report.Fallbacks + " fallback rows, e.g. " + string.Join(" | ", fallbacks));
            Assert.AreEqual(0, report.Fallbacks, "the real Zoo load reports no fallback module");
        }

        [Test]
        public void TheVerdictPassesEveryNamedFamilyIncludingTrainDoors() {
            // The rolling-stock renderer is part of this load now, so a consist is a
            // real view: the row is `bound`, names the trains renderer and its
            // placement, and the platform bank moved under the replayed frames.
            Assert.GreaterOrEqual(report.Trains.Count, 1, "Zoo binds one consist per service track");
            foreach (var train in report.Trains) {
                Assert.IsFalse(string.IsNullOrEmpty(train.Rig), "the rig measured the promoted formation");
                Assert.AreEqual("bound:frame.Trains", train.Motion, train.Id);
                Assert.AreEqual("bound", train.Status, train.Id + " is drawn by the trains renderer");
                Assert.IsTrue(train.Drawn, train.Id + " is drawn");
                Assert.AreEqual("trains:TrainConsistRenderer", train.RendererPath, train.Id);
                StringAssert.Contains("cars=6", train.Placement, train.Id + " records its consist placement");
            }
            var trainFamily = report.Families.First(family => family.Family == "train-doors");
            Assert.IsTrue(trainFamily.ViewsPass, "train doors: " + trainFamily.Verdict);
            Assert.IsTrue(trainFamily.BindingPass, "train doors: " + trainFamily.Verdict);
            Assert.AreEqual(trainFamily.MovingRows, trainFamily.Applied, "both consists were driven");
            Assert.AreEqual(trainFamily.MovingRows, trainFamily.Moved, "both platform banks moved");
            Assert.IsTrue(report.Passed, "every named family is drawn and bound: " + report.Verdict);
            Assert.IsTrue(report.Verdict.StartsWith("PASS:", StringComparison.Ordinal), report.Verdict);
            // Every named family passes on its own line; a regression in any other
            // family would still fail the report and this test.
            foreach (var name in new[] { "stairs", "escalators", "lifts", "fences", "trees", "psd", "gates", "doors", "train-doors" })
                Assert.IsTrue(report.Families.First(family => family.Family == name).Verdict.StartsWith("pass", StringComparison.Ordinal),
                    name + ": " + report.Families.First(family => family.Family == name).Verdict);
        }

        [Test]
        public void CsvAndSummaryCarryEveryRowAndTheVerdict() {
            var csv = report.ToCsv();
            var lines = csv.TrimEnd('\n').Split('\n');
            Assert.AreEqual(report.Rows.Count + 1, lines.Length, "header plus one line per row");
            StringAssert.StartsWith(StationBindingRow.CsvHeader, lines[0]);
            var escalatorLine = lines.First(line => line.StartsWith("module,escalator-4059,", StringComparison.Ordinal));
            StringAssert.Contains("escalators", escalatorLine);
            StringAssert.Contains("vertical:VerticalModuleViews", escalatorLine);
            StringAssert.Contains("bound:frame.Escalators", escalatorLine);
            var summary = report.SummaryText();
            StringAssert.Contains("modules=4299", summary);
            StringAssert.Contains("verdict: PASS", summary);
            StringAssert.Contains("train-doors", summary);
            var json = report.ToJson();
            Assert.AreEqual(report.Rows.Count, (int)json["status"]["rows"]);
            Assert.AreEqual(4299, (int)json["document"]["modules"]);
            Assert.AreEqual(true, (bool)json["verdict"]["passed"]);
            var trainRows = ((JArray)json["trains"]).ToArray();
            Assert.IsNotEmpty(trainRows, "the JSON carries the consist rows");
            foreach (var train in trainRows) {
                Assert.AreEqual("bound", (string)train["status"]);
                StringAssert.Contains("trains:TrainConsistRenderer", (string)train["renderer"]);
            }
            // CSV escaping keeps a note with a comma or quote intact.
            Assert.AreEqual("\"a,b\"", StationBindingRow.Escape("a,b"));
            Assert.AreEqual("\"a\"\"b\"", StationBindingRow.Escape("a\"b"));
        }

        [Test]
        public void FallbackAndDeliberateNoViewStayDistinctOnATinyStation() {
            // A tiny save: a gate a renderer refuses, and a type no renderer claims (a
            // urinal is a real saved type with no owning renderer).
            var json = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "binding probe",
                ["city"] = "guangzhou",
                ["seed"] = 7,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray { new JObject { ["x"] = 0, ["y"] = 0, ["z"] = 0, ["fill"] = "solid" } },
                    ["modules"] = new JArray {
                        new JObject { ["id"] = "gate-refused", ["type"] = "gate", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject { ["dir"] = "both" } },
                        new JObject { ["id"] = "urinal-1", ["type"] = "urinal", ["x"] = 1, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject() },
                    },
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(json.ToString(Newtonsoft.Json.Formatting.None), new StationSource("probe", ""));
            var catalogue = Catalogue();
            var probeRoot = new GameObject("binding probe root");
            var probeWorld = new StationWorldView(probeRoot.transform, "binding probe",
                new IStationViewRenderer[] { new RefusingRenderer() },
                new StationViewAssets { Catalogue = catalogue, Shader = SceneShader() });
            StationBindingReport probe = null;
            try {
                probeWorld.Build(read.Document, read.Index);
                probeWorld.Activate();
                probe = StationBindingReport.Build("probe", probeWorld, probeWorld.Renderers, catalogue, null, 2);
                var gate = probe.Rows.First(row => row.Id == "gate-refused");
                Assert.AreEqual("fallback", gate.Status, "a renderer-owned type with an unresolved diagnostic is a fallback");
                StringAssert.Contains("refused-on-purpose", gate.Note);
                var urinal = probe.Rows.First(row => row.Id == "urinal-1");
                Assert.AreEqual("no-view: no-renderer:urinal", urinal.Status, "an unclaimed type is a named gap, not a fallback");
                Assert.AreEqual(1, probe.Status.Fallback);
                Assert.AreEqual(1, probe.Status.NoView);
                Assert.AreEqual(0, probe.Status.Deliberate, "nothing here is deliberate");
                Assert.IsFalse(probe.Passed, "a gated family with a fallback fails the report");
                StringAssert.Contains("gates", probe.Verdict);
            } finally {
                probe?.Dispose();
                probeWorld.Dispose();
                UnityEngine.Object.DestroyImmediate(probeRoot);
            }
        }

        /// <summary>Claims the gate family and refuses every record it is given, with a diagnostic.</summary>
        sealed class RefusingRenderer : IStationViewRenderer {
            public string Role => "openings";
            public void Build(StationViewBuildContext context) {
                var modules = context.Document.Modules;
                for (int i = 0; i < modules.Count; i++) {
                    var module = modules[i];
                    if (module.Type != "gate") continue;
                    context.ReportUnresolved("refused-on-purpose", module.Type, module.Id, "test renderer refuses the gate");
                }
            }
            public void Release() { }
        }
    }
}
