using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// RCA 15 §1: `light-rectangular-401`…`404` and `cctv-362` are saved at <c>z = −1</c> with
    /// <c>ceilingAnchored: true</c>, so their ceiling is the street plane at elevation 0 and
    /// their bodies hang *below* it. The generic catalogue placement answered neither where the
    /// support is nor where on the prefab the attachment is, which is how ceiling lights and a
    /// CCTV ended up standing at ground level.
    ///
    /// The branches below are the source's own order in `sim/placement.ts:hangCeilingLocal`:
    /// authored anchor → overhead block (solid / virtual street / 站台-轨道桥 bed) → family
    /// fallback. The placement test then proves the built fixture's **top** lands on the
    /// resolved underside and that its storey membership is the storey it hangs above.
    /// </summary>
    public sealed class StationCeilingMountTests {
        /* ------------------------------------------------------- the branch table */

        static StationDocument Document(JArray modules, JArray cells = null) => StationDocumentReader.Read(new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "ceiling probe",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(),
            },
        }.ToString(Newtonsoft.Json.Formatting.None), new StationSource("ceiling probe", "")).Document;

        static JObject Module(string id, string type, int x, int y, int z, bool ceilingAnchored = false, JObject cfg = null) =>
            new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z, ["w"] = 1, ["h"] = 1, ["rot"] = 0,
                ["ceilingAnchored"] = ceilingAnchored, ["cfg"] = cfg ?? new JObject(),
            };

        static JObject Cell(int x, int y, int z, string fill = "solid") =>
            new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = fill };

        static ModuleFacts Facts(StationDocument document, string id) {
            for (int i = 0; i < document.Modules.Count; i++)
                if (string.Equals(document.Modules[i].Id, id, System.StringComparison.Ordinal))
                    return document.Modules[i].Facts;
            Assert.Fail("module not found: " + id);
            return null;
        }

        [Test]
        public void AnAuthoredCeilingAnchorHangsFromTheCellsOwnTop() {
            var document = Document(new JArray {
                Module("light-rectangular-401", "light", 4, 4, -1, ceilingAnchored: true,
                    cfg: new JObject { ["variant"] = "rectangular", ["position"] = 0 }),
            });
            var mounts = StationCeilingMounts.For(document);
            var facts = Facts(document, "light-rectangular-401");
            var mount = mounts.Resolve(facts, StationCeilingMounts.FallbackFor(facts, 5));
            Assert.AreEqual(StationCeilingMounts.SupportKind.AuthoredAnchor, mount.Support,
                "`ceilingAnchored` is the first branch: the block over the cell is the ceiling");
            Assert.AreEqual(0d, mount.Local, 1e-9, "local height is the cell's own top");
            Assert.AreEqual(0d, mount.Underside, 1e-9, "z = −1 hangs under the street plane at elevation 0");
        }

        [Test]
        public void AnOverheadSolidOrTheStreetOrARailDeckIsTheCeiling() {
            // A solid course directly over the fixture's own cell.
            var solid = Document(new JArray {
                Module("light-solid", "light", 2, 2, 4, cfg: new JObject { ["variant"] = "rectangular" }),
            }, new JArray { Cell(2, 2, 5) });
            var solidMount = StationCeilingMounts.For(solid).Resolve(Facts(solid, "light-solid"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.OverheadSolid, solidMount.Support);
            Assert.AreEqual(0d, solidMount.Local, 1e-9);

            // The virtual street: nothing authored over the cell, but z + 1 is the street plane.
            var street = Document(new JArray {
                Module("cctv-362", "cctv", 6, 6, -1, ceilingAnchored: true, cfg: new JObject { ["variant"] = "bullet" }),
            });
            var streetMount = StationCeilingMounts.For(street).Resolve(Facts(street, "cctv-362"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.AuthoredAnchor, streetMount.Support,
                "the authored anchor answers before the street does");

            // A dug ground hole is not street, so the street cannot be the ceiling over it.
            var hole = Document(new JArray {
                Module("light-hole", "light", 8, 8, -1, cfg: new JObject { ["variant"] = "rectangular" }),
            }, new JArray { Cell(8, 8, 0, "void") });
            var holeMount = StationCeilingMounts.For(hole).Resolve(Facts(hole, "light-hole"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.Fallback, holeMount.Support,
                "a dug hole is open air, so the street plane is not a top block");
            Assert.AreEqual(4d, holeMount.Local, 1e-9, "the light's own fallback is one storey less a metre");

            // A 站台 bed dug its own course, so no solid cell marks the deck: the track module is
            // the ceiling, one metre below its anchor. The deck's underside has to clear the
            // ground plane, because the virtual street is read *before* the deck in the source's
            // `topBlockOver` order — a deck at street level is not distinguishable from street.
            var track = new JObject {
                ["id"] = "track-deck", ["type"] = "track", ["x"] = 9, ["y"] = 9, ["z"] = 5, ["w"] = 1, ["h"] = 1,
                ["rot"] = 0, ["cfg"] = new JObject(),
            };
            var deck = Document(new JArray {
                Module("light-deck", "light", 9, 9, 3, cfg: new JObject { ["variant"] = "rectangular" }),
                track,
            });
            var deckMount = StationCeilingMounts.For(deck).Resolve(Facts(deck, "light-deck"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.OverheadTrackDeck, deckMount.Support,
                "a bridge bed hangs one metre below its anchor and is read from the module list");
            Assert.AreEqual(0d, deckMount.Local, 1e-9);
            Assert.AreEqual(4d, deckMount.Underside, 1e-9, "the deck's underside is the ceiling");
        }

        [Test]
        public void TheFamilyFallbacksMatchTheSource() {
            var document = Document(new JArray {
                Module("light-1", "light", 0, 0, 4, cfg: new JObject { ["variant"] = "rectangular" }),
                Module("light-2", "light", 1, 0, 4, ceilingAnchored: true, cfg: new JObject { ["variant"] = "rectangular" }),
                Module("vent-1", "vent", 2, 0, 4),
            });
            Assert.AreEqual(4d, StationCeilingMounts.FallbackFor(Facts(document, "light-1"), 5), 1e-9,
                "a light's fallback is `lightCeilingZ - z - 1`, one storey less a metre");
            Assert.AreEqual(0d, StationCeilingMounts.FallbackFor(Facts(document, "light-2"), 5), 1e-9,
                "an anchored light's ceiling is its own cell top");
            Assert.AreEqual(4d, StationCeilingMounts.FallbackFor(Facts(document, "vent-1"), 5), 1e-9,
                "every other hung piece falls back to one storey less a metre");
        }

        /* ------------------------------------------------------ the built fixture */

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "the runtime catalogue asset is missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader SceneShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static JObject Save(JArray modules, JArray cells = null) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "ceiling probe",
            ["city"] = "guangzhou",
            ["seed"] = 7,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(),
            },
        };

        (StationWorldView world, GameObject root, StationDocument document) Build(JObject save) {
            var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None),
                new StationSource("ceiling probe", ""));
            var root = new GameObject("ceiling probe world");
            var world = new StationWorldView(root.transform, "ceiling probe",
                new IStationViewRenderer[] { new StationEquipmentModuleRenderer() },
                new StationViewAssets { Catalogue = Catalogue(), Shader = SceneShader() });
            StationCeilingMounts.ClearTrace();
            world.Build(read.Document, read.Index);
            world.Activate();
            return (world, root, read.Document);
        }

        static StationBox MeasuredBounds(GameObject view) {
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            foreach (var filter in view.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                var local = mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var point = filter.transform.TransformPoint(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    var document = StationCoordinates.WorldToDocument(point);
                    min = Vector3.Min(min, document);
                    max = Vector3.Max(max, document);
                }
            }
            return new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
        }

        /// <summary>
        /// The promoted fixture's **attachment point**, measured from its own geometry. The
        /// mount resolver aligns this point to the resolved underside, so the export contract is
        /// what decides whether the alignment is a no-op or a correction — and a drifting export
        /// has to show up here rather than as a housing standing on the street.
        /// </summary>
        /// <summary>
        /// The promoted fixture's **attachment point**, measured from its own geometry. The
        /// mount resolver aligns this point to the resolved underside, so whatever the export
        /// baked here is compensated rather than trusted.
        ///
        /// Measured on the shipped export: `light-rectangular` spans local 3.92…4.00,
        /// `light-circular` 3.92…4.00, `cctv` 3.52…4.00, `vent` 3.94…4.00. The export baked the
        /// source's **fallback** ceiling — one storey less a metre, `STOREY_HEIGHT − 1 = 4` —
        /// into the prefab, so a root placed at the cell's own top leaves the housing floating
        /// four metres above it. For a ceiling-anchored record (`light-rectangular-401` at
        /// `z = −1`) that is four metres up in the air above the street, which is exactly the
        /// "ceiling lights and CCTV show at ground level" report. Aligning by this point puts the
        /// housing back under its real support, and it stays correct for the fallback branch too:
        /// the baked offset and the resolved offset then agree.
        /// </summary>
        [Test]
        public void ThePromotedFixturesReportTheirAttachmentPoint() {
            var catalogue = Catalogue();
            var lines = new List<string>();
            var measured = new List<(string key, double z0, double z1, double height)>();
            foreach (var key in new[] { "light-rectangular", "light-circular", "cctv", "cctv-post", "vent" }) {
                if (!catalogue.TryGet(key, out var entry) || entry.prefab == null) {
                    lines.Add(key + " | no entry");
                    continue;
                }
                var bounds = MeasuredBounds(entry.prefab);
                measured.Add((key, bounds.Z0, bounds.Z1, bounds.Height));
                lines.Add(key + " | z0=" + bounds.Z0 + " z1=" + bounds.Z1 + " height=" + bounds.Height +
                    " catalogueOffsetZ=" + entry.offset.z);
            }
            TestContext.WriteLine(string.Join("\n", lines));
            Assert.AreEqual(5, measured.Count, "every hung family has a promoted prefab: " + string.Join("; ", lines));
            foreach (var fixture in measured) {
                // The attachment point has to be a real surface of a fixture carried in the cell
                // it hangs in. Anything outside that storey means the export or the measurement
                // is wrong, and the mount resolver would then push the fixture into another floor.
                Assert.Greater(fixture.height, .01, fixture.key + " has geometry");
                Assert.Less(System.Math.Abs(fixture.z1), 5.5, fixture.key + " attaches within a storey of its root: " + fixture.z1);
                Assert.Less(System.Math.Abs(fixture.z0), 5.5, fixture.key + " hangs within a storey of its root: " + fixture.z0);
            }
        }

        [Test]
        public void TheCeilingFixtureHangsUnderItsSupportAndKeepsItsStorey() {
            StationCeilingMounts.TraceFilter = "light-rectangular-401";
            var built = Build(Save(new JArray {
                // The named Zoo record: z = −1, ceilingAnchored, rectangular housing.
                Module("light-rectangular-401", "light", 4, 4, -1, ceilingAnchored: true,
                    cfg: new JObject { ["variant"] = "rectangular", ["position"] = 0 }),
                // Control: a ground post CCTV is not ceiling-hung at all.
                Module("cctv-post-1", "cctv", 6, 4, 0, cfg: new JObject { ["variant"] = "post" }),
                // Control: a fixture whose level base shifts the storey it belongs to.
                Module("light-rectangular-405", "light", 8, 4, -1, ceilingAnchored: true,
                    cfg: new JObject { ["variant"] = "rectangular", ["position"] = 0 }),
            }));
            try {
                foreach (var line in StationCeilingMounts.TraceLines) TestContext.WriteLine(line);
                Assert.IsTrue(built.world.TryGetModule("light-rectangular-401", out var record),
                    "the hung light is registered");
                Assert.AreEqual("ceiling-fixture", record.Part, "it went through the mount resolver");
                Assert.IsTrue(record.HasBounds, "the record carries measured geometry bounds");
                var measured = MeasuredBounds(record.View);
                TestContext.WriteLine("light-rectangular-401 measured document bounds z0=" + measured.Z0 +
                    " z1=" + measured.Z1 + " x=" + measured.X0 + ".." + measured.X1);
                // The support is the street plane at document elevation 0, so the housing's top
                // is flush with it and the body hangs below: nothing stands on the street.
                Assert.AreEqual(0d, measured.Z1, .02, "the fixture's top is the resolved underside");
                Assert.Less(measured.Z0, -0.001, "the housing hangs below its support, not above it");
                Assert.AreEqual(-5, record.LevelMin, "membership is the storey it hangs above (z = −1)");
                Assert.AreEqual(-5, record.LevelMax);
                CollectionAssert.AreEqual(new[] { -5 }, record.LevelBands);

                // The ground post is not hung: it keeps the generic placement.
                Assert.IsTrue(built.world.TryGetModule("cctv-post-1", out var post));
                Assert.AreEqual("", post.Part, "a ground post is not a ceiling fixture");

                // A shifted level base changes the band, never the support elevation.
                Assert.IsTrue(built.world.TryGetModule("light-rectangular-405", out var shifted));
                Assert.AreEqual(0d, MeasuredBounds(shifted.View).Z1, .02);
            } finally {
                StationCeilingMounts.TraceFilter = null;
                StationCeilingMounts.ClearTrace();
                built.world.Dispose();
                Object.DestroyImmediate(built.root);
            }
        }

        [Test]
        public void ADugHoleUnderAFixtureUsesTheFallbackNotTheStreet() {
            var built = Build(Save(new JArray {
                Module("light-over-hole", "light", 3, 3, -1, cfg: new JObject { ["variant"] = "rectangular" }),
            }, new JArray { Cell(3, 3, 0, "void") }));
            try {
                Assert.IsTrue(built.world.TryGetModule("light-over-hole", out var record));
                // The fallback puts the housing a storey less a metre up: 4 m under the cell's
                // own floor top, which is the nominal ceiling line the source uses when it has
                // no slab to read. This is a named fallback, not a guessed support.
                var measured = MeasuredBounds(record.View);
                TestContext.WriteLine("light-over-hole measured z1=" + measured.Z1);
                Assert.Greater(measured.Z1, 3.5, "the fallback hangs near the nominal ceiling line");
                Assert.Less(measured.Z1, 4.05);
            } finally {
                built.world.Dispose();
                Object.DestroyImmediate(built.root);
            }
        }

        /* --------------------------------------------------- hung displays */

        (StationWorldView world, GameObject root, StationDisplayModuleRenderer displays, StationDocument document)
            BuildDisplays(JObject save) {
            var read = StationDocumentReader.Read(save.ToString(Newtonsoft.Json.Formatting.None),
                new StationSource("display ceiling probe", ""));
            var root = new GameObject("display ceiling probe world");
            var displays = new StationDisplayModuleRenderer();
            var world = new StationWorldView(root.transform, "display ceiling probe",
                new IStationViewRenderer[] { displays },
                new StationViewAssets { Catalogue = Catalogue(), Shader = SceneShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            return (world, root, displays, read.Document);
        }

        static JObject ZooSave() => JObject.Parse(System.IO.File.ReadAllText(
            System.IO.Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json")));

        static ModuleFacts ZooFacts(StationDocument document, string id) {
            for (int i = 0; i < document.Modules.Count; i++)
                if (string.Equals(document.Modules[i].Id, id, System.StringComparison.Ordinal))
                    return document.Modules[i].Facts;
            Assert.Fail("module not found: " + id);
            return null;
        }

        [Test]
        public void TvAndClockHangFromTheirResolvedSupportAndAWallMonitorDoesNot() {
            var built = BuildDisplays(ZooSave());
            try {
                var checkedHangs = 0;
                foreach (var id in new[] { "tv-259", "tv-261", "monitor-ceiling-729" }) {
                    Assert.IsTrue(built.world.TryGetModule(id, out var record), id + " is registered");
                    Assert.AreEqual("ceiling-fixture", record.Part, id + " went through the mount resolver");
                    var facts = ZooFacts(built.document, id);
                    var mount = StationCeilingMounts.For(built.document)
                        .Resolve(facts, StationCeilingMounts.FallbackFor(facts, built.document.StoreyHeight));
                    Assert.AreEqual(0d, mount.Local, 1e-9, id + " has a top block over its cell");
                    var measured = MeasuredBounds(record.View);
                    Assert.AreEqual(facts.Z + 1, measured.Z1, .02,
                        id + " top meets the resolved underside (" + mount.SupportName + ")");
                    Assert.Less(measured.Z0, facts.Z + 1, id + " hangs below its support, not above it");
                    checkedHangs++;
                }
                Assert.GreaterOrEqual(checkedHangs, 3);

                // A wall monitor is bolted at eye height: it keeps the generic placement and
                // must not be pushed onto a ceiling.
                Assert.IsTrue(built.world.TryGetModule("monitor-wall-732", out var wall));
                Assert.AreEqual("", wall.Part, "a wall monitor is not a ceiling fixture");
                var wallBounds = MeasuredBounds(wall.View);
                Assert.Greater(wallBounds.Z1, -15f + 1f, "the wall monitor's panel starts above the floor");
                Assert.LessOrEqual(wallBounds.Z1, -15f + 3.5f, "and stays inside the storey");
                Assert.Less(wallBounds.Z1, -15f + 4f - .4f,
                    "it is not re-centred onto the storey ceiling line");

                // Every hung display reports its support, underside and resulting bounds.
                var hung = new[] { "tv-259", "monitor-ceiling-729" };
                foreach (var id in hung) {
                    var note = built.displays.CeilingNotes.Find(line => line.StartsWith(id + " ", System.StringComparison.Ordinal));
                    Assert.IsNotNull(note, id + " has a ceiling note: " + string.Join("; ", built.displays.CeilingNotes));
                    StringAssert.Contains("support=", note);
                    StringAssert.Contains("underside=", note);
                    StringAssert.Contains("bounds z=", note);
                }
            } finally {
                built.world.Dispose();
                Object.DestroyImmediate(built.root);
            }
        }

        [Test]
        public void AHungDisplayWithNoTopBlockUsesTheNamedFallback() {
            var built = BuildDisplays(Save(new JArray {
                Module("tv-over-hole", "tv", 3, 3, 0, cfg: new JObject { ["variant"] = "solo" }),
            }, new JArray { Cell(3, 3, 1, "void") }));
            try {
                Assert.IsTrue(built.world.TryGetModule("tv-over-hole", out var record));
                Assert.AreEqual("ceiling-fixture", record.Part);
                var measured = MeasuredBounds(record.View);
                // The prefab bakes the fallback ceiling (one storey less a metre); the
                // resolved fallback agrees with it, so the body hangs from that line.
                Assert.AreEqual(1d + 4d, measured.Z1, .05, "the named fallback is the nominal ceiling line");
                Assert.Greater(measured.Z0, 1.5, "the body hangs below that line, not in the floor");
                var note = built.displays.CeilingNotes[0];
                StringAssert.Contains("support=fallback", note);
            } finally {
                built.world.Dispose();
                Object.DestroyImmediate(built.root);
            }
        }

        [Test]
        public void SignBoardWidthAgreesWithStationSignBoardsAcrossZooAndTanwei() {
            foreach (var rel in new[] { "StationDesigner/Demos/zoo.metro.json", "StationDesigner/Demos/tanwei.metro.json" }) {
                var path = System.IO.Path.Combine(Application.dataPath, rel);
                var doc = StationDocumentReader.Read(System.IO.File.ReadAllText(path), new StationSource(rel, path)).Document;
                int checkedCount = 0;
                foreach (var record in doc.Modules) {
                    if (record.Type != "sign") continue;
                    var mount = StationSignMounts.Of(record.Config.Text("mount"));
                    var boards = StationSignBoards.FromConfig(
                        record.Config.Json("front"),
                        record.Config.Json("back"),
                        record.Config.Json("components")).Mounted(mount);
                    float expected = StationSignBoards.Panel(boards).x;
                    double actual = StationFootprints.SignBoardWidth(record.Config);
                    Assert.AreEqual(expected, actual, 1e-5, record.Id + " in " + rel);
                    checkedCount++;
                }
                Assert.Greater(checkedCount, 20, "checked sign records in " + rel);
            }
        }

        [Test]
        public void HangerSupportChecksEligibilityRotationRodSpanAndMountUplift() {
            var wideMarks = new JArray();
            for (int i = 0; i < 9; i++) {
                wideMarks.Add(new JObject {
                    ["id"] = "a" + i, ["kind"] = "arrow", ["arrow"] = "left",
                    ["x"] = 0.12 + i * 0.36, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both",
                });
            }
            var narrowMarks = new JArray {
                new JObject { ["id"] = "a0", ["kind"] = "icon", ["icon"] = "lift", ["x"] = 0.22, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both" },
            };

            var document = Document(new JArray {
                new JObject { ["id"] = "hanger-roof", ["type"] = "hanger", ["x"] = 0, ["y"] = 0, ["z"] = 11, ["w"] = 4, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "roof" } },
                new JObject { ["id"] = "hanger-post", ["type"] = "hanger", ["x"] = 0, ["y"] = 5, ["z"] = 11, ["w"] = 4, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "post" } },
                // Narrow sign fits at endpoint cell x = 0 (0.5 - 0.30 >= 0), wide 3.5 m sign overflows x = 0 (0.5 - 1.48 < 0) but fits interior x = 1..2.
                new JObject { ["id"] = "sign-narrow-end", ["type"] = "sign", ["x"] = 0, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "ceiling", ["front"] = narrowMarks, ["back"] = new JArray() } },
                new JObject { ["id"] = "sign-wide-end", ["type"] = "sign", ["x"] = 0, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "ceiling", ["front"] = wideMarks, ["back"] = new JArray() } },
                new JObject { ["id"] = "sign-wide-mid", ["type"] = "sign", ["x"] = 1, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 2, ["cfg"] = new JObject { ["mount"] = "ceiling", ["front"] = wideMarks, ["back"] = new JArray() } },
                new JObject { ["id"] = "sign-perp", ["type"] = "sign", ["x"] = 1, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 1, ["cfg"] = new JObject { ["mount"] = "ceiling", ["front"] = narrowMarks, ["back"] = new JArray() } },
                new JObject { ["id"] = "sign-wall", ["type"] = "sign", ["x"] = 1, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "wall", ["front"] = narrowMarks, ["back"] = new JArray() } },
                new JObject { ["id"] = "clock-analogue-perp", ["type"] = "clock", ["x"] = 2, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 1, ["cfg"] = new JObject() },
                new JObject { ["id"] = "clock-digital-perp", ["type"] = "clock", ["x"] = 2, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 1, ["cfg"] = new JObject { ["variant"] = "digital" } },
                new JObject { ["id"] = "cctv-post", ["type"] = "cctv", ["x"] = 2, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["variant"] = "post" } },
                new JObject { ["id"] = "tv-on-post", ["type"] = "tv", ["x"] = 1, ["y"] = 5, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 2, ["cfg"] = new JObject() },
            });

            var roofHanger = Facts(document, "hanger-roof");
            Assert.IsTrue(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "sign-narrow-end")), "narrow sign rods fit endpoint");
            Assert.IsFalse(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "sign-wide-end")), "3.5 m sign rods overhang endpoint");
            Assert.IsTrue(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "sign-wide-mid")), "3.5 m sign rods fit interior cell");
            Assert.IsFalse(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "sign-perp")), "perpendicular sign rods miss bar");
            Assert.IsFalse(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "sign-wall")), "wall sign does not hang from bar");
            Assert.IsTrue(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "clock-analogue-perp")), "centred analogue clock rod fits any turn");
            Assert.IsFalse(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "clock-digital-perp")), "twin-rod digital clock requires parallel turn");
            Assert.IsFalse(StationCeilingMounts.HangerSupports(roofHanger, Facts(document, "cctv-post")), "post CCTV never hangs from bar");

            var mounts = StationCeilingMounts.For(document);
            var roofSignMount = mounts.Resolve(Facts(document, "sign-wide-mid"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.HangerRoof, roofSignMount.Support);
            Assert.AreEqual(4d, roofSignMount.Local, 1e-9, "roof hanger includes 1 m crossbar uplift (3 + 1)");
            Assert.AreEqual(16d, roofSignMount.Underside, 1e-9);

            var postTvMount = mounts.Resolve(Facts(document, "tv-on-post"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.HangerPost, postTvMount.Support);
            Assert.AreEqual(3d, postTvMount.Local, 1e-9, "post hanger beam stays 3 m above floor top");
            Assert.AreEqual(15d, postTvMount.Underside, 1e-9);

            // Verify PlaceCeilingFixture aligns TVs to 16 m on a roof hanger vs 15 m on a post hanger,
            // and check Tanwei's live hanger-mounted TV and PTZ CCTV records.
            var displayBuild = BuildDisplays(Save(new JArray {
                new JObject { ["id"] = "hanger-roof", ["type"] = "hanger", ["x"] = 0, ["y"] = 0, ["z"] = 11, ["w"] = 4, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "roof" } },
                new JObject { ["id"] = "hanger-post", ["type"] = "hanger", ["x"] = 0, ["y"] = 5, ["z"] = 11, ["w"] = 4, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "post" } },
                new JObject { ["id"] = "tv-roof", ["type"] = "tv", ["x"] = 1, ["y"] = 0, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject() },
                new JObject { ["id"] = "tv-post", ["type"] = "tv", ["x"] = 1, ["y"] = 5, ["z"] = 11, ["w"] = 1, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject() },
            }));
            try {
                Assert.IsTrue(displayBuild.world.TryGetModule("tv-roof", out var tvRoof));
                Assert.IsTrue(displayBuild.world.TryGetModule("tv-post", out var tvPost));
                Assert.AreEqual(16d, MeasuredBounds(tvRoof.View).Z1, .03, "roof-hanger TV attaches at 16 m");
                Assert.AreEqual(15d, MeasuredBounds(tvPost.View).Z1, .03, "post-hanger TV attaches at 15 m");
            } finally {
                displayBuild.world.Dispose();
                Object.DestroyImmediate(displayBuild.root);
            }

            var tanweiPath = System.IO.Path.Combine(Application.dataPath, "StationDesigner/Demos/tanwei.metro.json");
            var tanwei = StationDocumentReader.Read(System.IO.File.ReadAllText(tanweiPath), new StationSource("tanwei", tanweiPath)).Document;
            var tanweiMounts = StationCeilingMounts.For(tanwei);
            foreach (var id in new[] { "tv-256", "tv-257", "cctv-ptz-268", "cctv-ptz-270" }) {
                var facts = Facts(tanwei, id);
                var resolved = tanweiMounts.Resolve(facts, StationCeilingMounts.FallbackFor(facts, tanwei.StoreyHeight));
                Assert.AreEqual(StationCeilingMounts.SupportKind.HangerRoof, resolved.Support, id);
                Assert.AreEqual(16d, resolved.Underside, 1e-9, id);
            }
        }

        [Test]
        public void NearestExposedBackingResolvesAcrossFootprintBeforeFallback() {
            var document = Document(new JArray {
                Module("light-high-solid", "light", 2, 2, 6, cfg: new JObject { ["variant"] = "rectangular" }),
                Module("light-high-deck", "light", 5, 5, 6, cfg: new JObject { ["variant"] = "rectangular" }),
                Module("light-under-street", "light", 8, 8, -4, cfg: new JObject { ["variant"] = "rectangular" }),
                new JObject {
                    ["id"] = "track-high", ["type"] = "track", ["x"] = 5, ["y"] = 5, ["z"] = 10,
                    ["w"] = 2, ["d"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["bridge"] = true },
                },
                // Multi-cell roof hanger: slab at z = 14 covers only 3 of 4 cells, slab at z = 16 covers all 4.
                new JObject {
                    ["id"] = "hanger-span", ["type"] = "hanger", ["x"] = 10, ["y"] = 0, ["z"] = 8,
                    ["w"] = 4, ["h"] = 1, ["rot"] = 0, ["cfg"] = new JObject { ["mount"] = "roof" },
                },
            }, new JArray {
                // Wall stack at (2, 2, 9..10) exposes underside at z = 9 (not z = 10), plus higher slab at z = 12.
                Cell(2, 2, 9), Cell(2, 2, 10), Cell(2, 2, 12),
                // Partial slab at z = 14 (missing x = 13) and full slab at z = 16 across x = 10..13.
                Cell(10, 0, 14), Cell(11, 0, 14), Cell(12, 0, 14),
                Cell(10, 0, 16), Cell(11, 0, 16), Cell(12, 0, 16), Cell(13, 0, 16),
            });

            var mounts = StationCeilingMounts.For(document);

            var highSolid = mounts.Resolve(Facts(document, "light-high-solid"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.CeilingSolid, highSolid.Support);
            Assert.AreEqual(2d, highSolid.Local, 1e-9, "nearest exposed underside z = 9 gives 9 - 6 - 1 = 2 m");
            Assert.AreEqual(9d, highSolid.Underside, 1e-9);

            var highDeck = mounts.Resolve(Facts(document, "light-high-deck"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.CeilingTrackDeck, highDeck.Support);
            Assert.AreEqual(2d, highDeck.Local, 1e-9, "track at z = 10 has deck underside 9 -> local 2 m");
            Assert.AreEqual(9d, highDeck.Underside, 1e-9);

            var underStreet = mounts.Resolve(Facts(document, "light-under-street"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.CeilingGround, underStreet.Support);
            Assert.AreEqual(3d, underStreet.Local, 1e-9, "street at z = 0 above z = -4 gives local 3 m");
            Assert.AreEqual(0d, underStreet.Underside, 1e-9);

            var hangerSpan = mounts.Resolve(Facts(document, "hanger-span"), 4);
            Assert.AreEqual(StationCeilingMounts.SupportKind.CeilingSolid, hangerSpan.Support);
            Assert.AreEqual(7d, hangerSpan.Local, 1e-9, "partial slab at z = 14 skipped; full slab at z = 16 gives 16 - 8 - 1 = 7 m");
        }
    }
}
