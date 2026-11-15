using System;
using System.Collections.Generic;
using System.Linq;
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

namespace Metro.Tests {
    /// <summary>
    /// Plan 22 §1: the two structure families generated from their saved dimensions. Tanwei has
    /// 28 tapered-truss bays and 280 flat ceiling plates, plus 73 pillars — 11 of them bridge
    /// piers — and the live registry had no owner for either type, so all of them reported
    /// `no-renderer` and drew nothing while the web game drew them.
    ///
    /// The expectations are the source's own numbers (`RoofModel.ts`, `PillarModel.ts`,
    /// `structures.ts`), not eyeballed bounds.
    /// </summary>
    public sealed class StationStructureGeometryTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        const string TanweiPath = "Assets/StationDesigner/Demos/tanwei.metro.json";

        static JObject Module(string id, string type, int x, int y, int z, int w = 1, int d = 1, int rot = 0,
            JObject cfg = null) => new JObject {
            ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z,
            ["w"] = w, ["d"] = d, ["rot"] = rot, ["cfg"] = cfg ?? new JObject(),
        };

        static JObject ProbeSave() {
            var modules = new JArray {
                // A bridge run with its half-height sound barrier: the pier below it must stop at
                // the deck's underside, one metre below the track's own elevation.
                Module("track-1", "track", 0, -9, 11, 32, 3, 0, new JObject {
                    ["line"] = "5", ["dir"] = "up", ["bridge"] = true,
                    ["bridgeRailing"] = "sound-barrier-half", ["bridgeFinish"] = "floor.concrete",
                }),
                Module("track-1:pillar:4", "pillar", 4, -8, 0, cfg: new JObject {
                    ["size"] = "thick", ["height"] = 11, ["bridgeId"] = "track-1", ["finish"] = "floor.concrete",
                }),
                // A ground-standing pillar: its own saved height.
                Module("pillar-2", "pillar", 10, 10, 0, cfg: new JObject {
                    ["size"] = "thick", ["height"] = 5, ["finish"] = "floor.concrete",
                }),
                // The tapered truss bay exactly as Tanwei saves it: 4 × 12 m, one storey up.
                Module("roof-124", "roof", 49, -6, 11, 4, 12, 0, new JObject {
                    ["variant"] = "tapered-truss", ["finish"] = "floor.concrete",
                }),
                // A flat ceiling plate hung one metre below its module origin.
                Module("roof-1175", "roof", 1, -28, 7, 1, 1, 0, new JObject {
                    ["plateSnap"] = "lower", ["finish"] = "ceil.steel",
                }),
            };
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "structure probe", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = modules,
                    ["lines"] = new JArray(new JObject {
                        ["id"] = "5", ["name"] = "Line 5", ["colour"] = "#c70541",
                        ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail",
                        ["direction"] = "up", ["psd"] = "full",
                        ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
                    }),
                },
            };
            return save;
        }

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        /// <summary>Build the probe station with the structure and street renderers.</summary>
        static StationWorldView BuildProbe(out GameObject root) {
            var read = StationDocumentReader.Read(ProbeSave().ToString(Formatting.None),
                new StationSource("structure probe", ""));
            root = new GameObject("structure view probe");
            var structure = new StationStructureModuleRenderer();
            var street = new StationStreetModuleRenderer();
            var world = new StationWorldView(root.transform, "structure probe",
                new IStationViewRenderer[] { structure, street },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            return world;
        }

        static StationViewRecord ModuleOf(StationWorldView world, string id) {
            Assert.IsTrue(world.TryGetModule(id, out var record), "module not registered: " + id);
            Assert.IsNotNull(record.View, "module has no view: " + id);
            return record;
        }

        /* ------------------------------------------------------------ the alias */

        [Test]
        public void ASavedTaperedTrussResolvesToThePromotedTaperedRoof() {
            var catalogue = Catalogue();
            var facts = new List<ModuleFacts>();
            foreach (var variant in new[] { "tapered-truss", "truss", "shell", "canopy", "" }) {
                var module = ModuleFactsReader.Read(Module("roof", "roof", 0, 0, 0, 4, 12, 0, new JObject {
                    ["variant"] = variant,
                }));
                facts.Add(module);
                var visual = ModuleViews.Resolve(module, facts, catalogue);
                var expected = variant.Length == 0 ? "roof" : variant == "tapered-truss" ? "roof-tapered" : "roof-" + variant;
                Assert.AreEqual(expected, visual.Key, "saved roof variant '" + variant + "'");
                Assert.AreEqual(ModuleViewKind.Prefab, visual.Kind, "the promoted roof piece answers the key");
            }
        }

        [Test]
        public void ABlockStairResolvesToTheBlockPieceNotAFlight() {
            var catalogue = Catalogue();
            var facts = new List<ModuleFacts>();
            var block = ModuleFactsReader.Read(Module("stair-block", "stair", 0, 0, 0, 1, 1, 1, new JObject {
                ["width"] = 1, ["block"] = true, ["blockHeight"] = 1,
            }));
            facts.Add(block);
            var visual = ModuleViews.Resolve(block, facts, catalogue);
            Assert.AreEqual("stair-block", visual.Key, "a 楼梯块 is its own piece");
            Assert.AreEqual(ModuleViewKind.Prefab, visual.Kind);
        }

        /* ------------------------------------------------------------- the roofs */

        [Test]
        public void TheTaperedRoofUsesItsSavedBayInsteadOfTheFourMetreReference() {
            var world = BuildProbe(out var root);
            try {
                var record = ModuleOf(world, "roof-124");
                Assert.AreEqual("roof", record.Part, "the generated roof registers as its own part");
                var bounds = record.Bounds;
                Assert.AreEqual(49, bounds.X0, .05, "the saved 4 m bay length, not the promoted 4 m reference's plan");
                Assert.AreEqual(4, bounds.X1 - bounds.X0, .05);
                Assert.AreEqual(-6, bounds.Y0, .05);
                Assert.AreEqual(12, bounds.Y1 - bounds.Y0, .06,
                    "a 4 × 12 m bay spans its twelve-metre pitch, which the 4 × 4 m reference cannot");
                // `TRUSS_ROOF_BASE + TRUSS_ROOF_CHORD / 2` is the heavy central chord; its underside
                // is the lowest member, five metres above the roof's own origin (z + 1 = 12 m).
                Assert.AreEqual(17, bounds.Z0, .12, "the bottom chord hangs TRUSS_ROOF_BASE above the bay");
                Assert.AreEqual(22, bounds.Z1, .15, "the ridge closes at TRUSS_ROOF_BASE + HEIGHT");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void AFlatPlateFollowsItsSavedPlateSnapAndFinish() {
            var world = BuildProbe(out var root);
            try {
                var record = ModuleOf(world, "roof-1175");
                var bounds = record.Bounds;
                Assert.AreEqual(1, bounds.X0, .02);
                Assert.AreEqual(1, bounds.X1 - bounds.X0, .02);
                Assert.AreEqual(1, bounds.Y1 - bounds.Y0, .02);
                // `plateSnap: lower` hangs the plate one metre below the module origin, so the
                // storey's floor top is its ceiling: 7 m to 7.25 m, not 12.125 m.
                Assert.AreEqual(7, bounds.Z0, .02, "a `lower` plate is one metre below its module origin");
                Assert.AreEqual(.25, bounds.Z1 - bounds.Z0, .02, "ROOF_THICKNESS");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /* ----------------------------------------------------------- the pillars */

        [Test]
        public void ABridgePierStopsAtTheDeckUnderside() {
            var world = BuildProbe(out var root);
            try {
                var record = ModuleOf(world, "track-1:pillar:4");
                var bounds = record.Bounds;
                // `bridge.z − BRIDGE_DECK_DEPTH − mod.z − 1` = 11 − 1 − 0 − 1 = 9 m of shaft from
                // the floor top at elevation 1 to the deck underside at elevation 10.
                Assert.AreEqual(1, bounds.Z0, .02, "the shaft starts on its cell's floor top");
                Assert.AreEqual(10, bounds.Z1, .02, "a bridge pier stops at the deck's underside");
                Assert.AreEqual(9, bounds.Z1 - bounds.Z0, .03, "the plan's nine-metre shaft assembly");
                Assert.AreEqual(4, bounds.X0, .02);
                Assert.AreEqual(1, bounds.X1 - bounds.X0, .03, "a 粗柱 is one metre across");
                Assert.AreEqual(1, bounds.Y1 - bounds.Y0, .03);
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void AGroundPillarRisesItsOwnSavedHeight() {
            var world = BuildProbe(out var root);
            try {
                var record = ModuleOf(world, "pillar-2");
                var bounds = record.Bounds;
                Assert.AreEqual(1, bounds.Z0, .02, "the collar sits on the floor top");
                Assert.AreEqual(6, bounds.Z1, .02, "a five-metre pillar tops out five metres above its origin");
                Assert.AreEqual(10, bounds.X0, .02);
                Assert.AreEqual(11, bounds.X1, .02);
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /* ------------------------------------------------------------- coverage */

        [Test]
        public void EveryStructureModuleInTheProbeIsDrawnAndNoneIsReported() {
            var world = BuildProbe(out var root);
            try {
                var missing = world.Unresolved
                    .Where(diagnostic => diagnostic.Code.StartsWith("module-group", StringComparison.Ordinal) ||
                        diagnostic.Code == "no-renderer")
                    .Select(diagnostic => diagnostic.Code + ":" + diagnostic.RecordId).ToArray();
                Assert.IsEmpty(missing, "structure modules left unresolved: " + string.Join(", ", missing));
                foreach (var id in new[] { "track-1:pillar:4", "pillar-2", "roof-124", "roof-1175" }) {
                    var record = ModuleOf(world, id);
                    int renderers = record.View.GetComponentsInChildren<MeshRenderer>(true).Count(view => view.enabled);
                    Assert.Greater(renderers, 0, id + " drew no geometry");
                }
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TheRoofRoleAnswersTheRoofVisibilityPass() {
            // Hide Roof and the section plane reach generated parts only when the record resolves
            // to `StationPartRole.Roof`; a structure-role record used to fall through to `Prop`.
            var world = BuildProbe(out var root);
            try {
                var modules = world.Document.Modules.ToDictionary(module => module.Id, StringComparer.Ordinal);
                var roof = world.Records.First(record => record.ModuleId == "roof-124");
                var pillar = world.Records.First(record => record.ModuleId == "pillar-2");
                Assert.AreEqual(StationPartRole.Roof, StationViewFeature.RoleOf(roof, modules),
                    "a generated roof is a roof, not a prop");
                Assert.AreEqual(StationPartRole.Prop, StationViewFeature.RoleOf(pillar, modules),
                    "a pillar is a prop of its storey");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /* ---------------------------------------------------------- the constants */

        [Test]
        public void TheStructureConstantsAreTheSourcesOwn() {
            Assert.AreEqual(5f, StationStructureGeometry.TrussRoofBase);
            Assert.AreEqual(9.88f, StationStructureGeometry.TrussRoofRidge(12f), 1e-4f);
            Assert.AreEqual(10f, StationStructureGeometry.TrussRoofTop(12f), 1e-4f);
            Assert.AreEqual(-.875f, StationStructureGeometry.FlatRoofZ("lower"));
            Assert.AreEqual(-.125f, StationStructureGeometry.FlatRoofZ("upper"));
            Assert.AreEqual(5.125f, StationStructureGeometry.FlatRoofZ(""), 1e-4f);
            CollectionAssert.AreEqual(new[] { 2f, 9f }, StationStructureGeometry.CanopyPostRows(12f));
            var thick = ModuleFactsReader.Read(Module("p", "pillar", 0, 0, 0, cfg: new JObject { ["size"] = "thick" }));
            Assert.AreEqual(1f, StationStructureGeometry.PillarWidth(thick));
            var slim = ModuleFactsReader.Read(Module("p", "pillar", 0, 0, 0, rot: 3, cfg: new JObject { ["size"] = "slim" }));
            Assert.AreEqual(.35f, StationStructureGeometry.PillarOffset(slim).x, 1e-4f);
            Assert.AreEqual(.35f, StationStructureGeometry.PillarOffset(slim).y, 1e-4f);
            Assert.AreEqual(4f, StationStructureGeometry.HangerBarTop);
            Assert.AreEqual(3f, StationStructureGeometry.HangerPostBarTop);
            Assert.AreEqual(.2f, StationStructureGeometry.HangerBarDepth, 1e-4f);
            Assert.AreEqual(.18f, StationStructureGeometry.HangerPostWidth, 1e-4f);
            Assert.AreEqual(.17f, StationStructureGeometry.HangerPostOffset, 1e-4f);
        }

        /* ---------------------------------------------------------- the hangers */

        static List<Vector3> DocumentVertices(GameObject view) {
            var points = new List<Vector3>();
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled || filter.sharedMesh == null) continue;
                var vertices = filter.sharedMesh.vertices;
                for (int i = 0; i < vertices.Length; i++) {
                    points.Add(StationCoordinates.WorldToDocument(filter.transform.TransformPoint(vertices[i])));
                }
            }
            return points;
        }

        [Test]
        public void TanweiRoofHangersBindAndMeetThePitchedRoofAtEachEndpoint() {
            var read = StationDocumentReader.ReadFile(TanweiPath);
            Assert.IsNotNull(read.Document, "Tanwei save must load");
            var root = new GameObject("tanwei hanger probe");
            var structure = new StationStructureModuleRenderer();
            var world = new StationWorldView(root.transform, "tanwei hanger probe",
                new IStationViewRenderer[] { structure },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();

                var hangerIds = read.Document.Modules
                    .Where(module => module.Type == "hanger")
                    .Select(module => module.Id)
                    .ToArray();
                Assert.AreEqual(5, hangerIds.Length, "Tanwei carries five saved roof hangers");
                CollectionAssert.AreEquivalent(
                    new[] { "hanger-roof-248", "hanger-roof-247", "hanger-roof-249", "hanger-roof-250", "hanger-roof-259" },
                    hangerIds);

                var structureIds = new HashSet<string>(
                    read.Document.Modules
                        .Where(module => module.Type == "roof" || module.Type == "pillar" || module.Type == "hanger")
                        .Select(module => module.Id),
                    StringComparer.Ordinal);
                var missing = world.Unresolved
                    .Where(diagnostic => structureIds.Contains(diagnostic.RecordId) &&
                        (diagnostic.Code == "no-renderer" ||
                         diagnostic.Code.StartsWith("module-group", StringComparison.Ordinal)))
                    .Select(diagnostic => diagnostic.Code + ":" + diagnostic.RecordId)
                    .ToArray();
                Assert.IsEmpty(missing, "all structure modules bind cleanly: " + string.Join(", ", missing));

                const double expectedBarTop = 16.0;
                const double expectedRoofZ = 21.366666666666667;
                foreach (var id in hangerIds) {
                    var record = ModuleOf(world, id);
                    Assert.AreEqual("hanger", record.Part);
                    Assert.Greater(record.View.GetComponentsInChildren<MeshRenderer>(true).Count(r => r.enabled), 0, id);
                    Assert.AreEqual(expectedBarTop - StationStructureGeometry.HangerBarDepth, record.Bounds.Z0, .01, id + " bar bottom");
                    Assert.AreEqual(expectedRoofZ, record.Bounds.Z1, .01, id + " suspension top");
                }

                // Detailed geometric probe on hanger-roof-249 at (4, 3, 11), w = 8, rot = 3.
                var facts = read.Document.Modules.Select(m => m.Facts).ToArray();
                var probe = read.Document.Modules.First(m => m.Id == "hanger-roof-249");
                var run = StationStructureGeometry.HangerCells(probe.Facts);
                Assert.AreEqual(8, run.Length);
                Assert.AreEqual((4, 3), run[0], "run starts at (4, 3)");
                Assert.AreEqual((4, -4), run[7], "rot = 3 runs toward negative Y through (4, -4)");

                double? end0 = StationStructureGeometry.HangerRoofZ(read.Document.Cells, facts, probe.Facts, 4, 3);
                double? end1 = StationStructureGeometry.HangerRoofZ(read.Document.Cells, facts, probe.Facts, 4, -4);
                Assert.IsTrue(end0.HasValue && end1.HasValue, "both endpoints find roof backing");
                Assert.AreEqual(expectedRoofZ, end0.Value, 1e-4, "north endpoint backing");
                Assert.AreEqual(expectedRoofZ, end1.Value, 1e-4, "south endpoint backing");
                Assert.AreEqual(5.3666667, end0.Value - expectedBarTop, 1e-4, "5.367 m suspension above bar");

                var probeRecord = ModuleOf(world, "hanger-roof-249");
                Assert.AreEqual(4.4, probeRecord.Bounds.X0, .06, "clamp/bar X0 centred on x = 4.5");
                Assert.AreEqual(4.6, probeRecord.Bounds.X1, .06);
                Assert.AreEqual(-4.0, probeRecord.Bounds.Y0, .02, "8 m crossbar reaches y = -4.0");
                Assert.AreEqual(4.0, probeRecord.Bounds.Y1, .02, "8 m crossbar starts at y = +4.0");

                var vertices = DocumentVertices(probeRecord.View);
                // Interior vertices along the bar (between the two endpoint rods) top out at 16.000 m.
                var midBar = vertices.Where(v => v.y > -2.5f && v.y < 2.5f).ToArray();
                Assert.IsNotEmpty(midBar);
                Assert.AreEqual(15.8f, midBar.Min(v => v.z), 1e-3f, "bar underside");
                Assert.AreEqual(16.0f, midBar.Max(v => v.z), 1e-3f, "bar top at 16.000 m");

                // Both endpoint suspension rods rise from 16.000 m to 21.367 m independently.
                var rodStart = vertices.Where(v => v.y > 3.2f && v.z > 16.1f).ToArray();
                var rodEnd = vertices.Where(v => v.y < -3.2f && v.z > 16.1f).ToArray();
                Assert.IsNotEmpty(rodStart, "rod at (4, 3)");
                Assert.IsNotEmpty(rodEnd, "rod at (4, -4)");
                Assert.AreEqual((float)expectedRoofZ, rodStart.Max(v => v.z), 2e-3f, "start rod meets roof");
                Assert.AreEqual((float)expectedRoofZ, rodEnd.Max(v => v.z), 2e-3f, "end rod meets roof");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void ARotatedHangerSamplesBackingIndependentlyAtEachEndpoint() {
            // A rotated tapered roof (`rot = 1`, `w = 4`, `d = 12` at `(10, 0, 11)`):
            // `RotateLocal(1, i, j) = (-j, i)`, so `localY = j` runs across `x = 10 - j` (`x = 10` is
            // eave `j = 0`, `x = 5` is near crest `j = 5`).
            // Two rotated hangers test asymmetric per-endpoint backing:
            //   1. `hanger-slope`: `rot = 2` from `(10, 2, 11)` (`w = 6`) to `(5, 2, 11)` — endpoint 0
            //      is at eave (`j = 0` -> 21.0733 m) and endpoint 1 is near ridge (`j = 5` -> 21.8067 m).
            //   2. `hanger-mixed`: `rot = 2` from `(10, 1, 11)` (`w = 6`) to `(5, 1, 11)` with a lower
            //      solid block at `(10, 1, 18)` over endpoint 0 only — endpoint 0 stops at 18.000 m
            //      while endpoint 1 still rises to the roof at 21.8067 m.
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "asymmetric hanger probe", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray {
                        new JObject { ["x"] = 10, ["y"] = 1, ["z"] = 18, ["fill"] = "solid" },
                    },
                    ["modules"] = new JArray {
                        Module("roof-rot", "roof", 10, 0, 11, 4, 12, 1, new JObject {
                            ["variant"] = "tapered-truss", ["finish"] = "floor.concrete",
                        }),
                        Module("hanger-slope", "hanger", 10, 2, 11, 6, 1, 2, new JObject { ["mount"] = "roof" }),
                        Module("hanger-mixed", "hanger", 10, 1, 11, 6, 1, 2, new JObject { ["mount"] = "roof" }),
                    },
                    ["lines"] = new JArray(),
                },
            };

            var read = StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource("asymmetric probe", ""));
            var root = new GameObject("asymmetric hanger view");
            var structure = new StationStructureModuleRenderer();
            var world = new StationWorldView(root.transform, "asymmetric hanger probe",
                new IStationViewRenderer[] { structure },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();

                const double expectedEaveEnd = 12d + (9.88d - 0.88d * 5.5d / 6d);  // 21.073333...
                const double expectedCrestEnd = 12d + (9.88d - 0.88d * 0.5d / 6d); // 21.806667...

                var slopeVerts = DocumentVertices(ModuleOf(world, "hanger-slope").View);
                float slopeEaveTop = slopeVerts.Where(v => v.x > 10.2f && v.z > 16.1f).Max(v => v.z);
                float slopeCrestTop = slopeVerts.Where(v => v.x < 5.8f && v.z > 16.1f).Max(v => v.z);
                Assert.AreEqual((float)expectedEaveEnd, slopeEaveTop, 2e-3f, "eave-side rod stops at lower eave slope");
                Assert.AreEqual((float)expectedCrestEnd, slopeCrestTop, 2e-3f, "crest-side rod reaches higher ridge slope");
                Assert.Greater(slopeCrestTop - slopeEaveTop, .7f, "endpoints do not share a single backing sample");

                var mixedVerts = DocumentVertices(ModuleOf(world, "hanger-mixed").View);
                float solidTop = mixedVerts.Where(v => v.x > 10.2f && v.z > 16.1f).Max(v => v.z);
                float roofTop = mixedVerts.Where(v => v.x < 5.8f && v.z > 16.1f).Max(v => v.z);
                Assert.AreEqual(18f, solidTop, 2e-3f, "endpoint under nearer solid stops at 18.000 m");
                Assert.AreEqual((float)expectedCrestEnd, roofTop, 2e-3f, "other endpoint still rises to roof at 21.807 m");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void APostHangerBuildsItsThreeMetreBarOffsetPostAndKeepsPropVisibility() {
            var save = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "post hanger probe", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray(),
                    ["modules"] = new JArray {
                        Module("hanger-post-1", "hanger", 2, 5, 0, 4, 1, 0, new JObject { ["mount"] = "post" }),
                    },
                    ["lines"] = new JArray(),
                },
            };
            var read = StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource("post hanger probe", ""));
            var root = new GameObject("post hanger view");
            var world = new StationWorldView(root.transform, "post hanger probe",
                new IStationViewRenderer[] { new StationStructureModuleRenderer() },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();

                var record = ModuleOf(world, "hanger-post-1");
                Assert.AreEqual(1d, record.Bounds.Z0, .01, "post base stands on floor top z + 1");
                Assert.AreEqual(4d, record.Bounds.Z1, .01, "post crossbar tops out at 3 m above floor top");
                Assert.AreEqual(2d, record.Bounds.X0, .01);
                Assert.AreEqual(6d, record.Bounds.X1, .01, "4 m crossbar span");
                // Base extends to y = 5.5 + 0.17 + 0.18 = 5.85, bar back to y = 5.5 - 0.10 = 5.40.
                Assert.AreEqual(5.4d, record.Bounds.Y0, .01);
                Assert.AreEqual(5.85d, record.Bounds.Y1, .01);

                var modules = world.Document.Modules.ToDictionary(m => m.Id, StringComparer.Ordinal);
                Assert.AreEqual(StationPartRole.Prop, StationViewFeature.RoleOf(record, modules),
                    "HideRoof hides roof shells, not hangers");
                Assert.IsFalse(StationViewFeature.IsGradeModule(modules["hanger-post-1"]),
                    "HideGround does not hide hangers at datum z = 0");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }
    }
}
