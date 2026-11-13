using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 11 A2/A4 loader pipeline: the exported TypeScript demos, a tiny authored
    /// save and the repair migrations all pass the same reader; New, Open, OpenDemo
    /// and resync pass the same install transaction; a refusal keeps document,
    /// revision, world and simulation intact.
    /// </summary>
    public sealed class StationLoadPipelineTests {
        static string DataRoot => Application.dataPath;
        static string DemoPath(string id) => Path.Combine(DataRoot, "StationDesigner/Demos", id + ".metro.json");
        static JObject Provenance() => JObject.Parse(File.ReadAllText(Path.Combine(DataRoot, "StationDesigner/Demos/provenance.json")));

        GameObject rootObject;
        readonly List<StationWorldView> builtWorlds = new List<StationWorldView>();

        [SetUp]
        public void SetUp() {
            rootObject = new GameObject("StationLoadPipelineTests");
        }

        [TearDown]
        public void TearDown() {
            if (rootObject != null) UnityEngine.Object.DestroyImmediate(rootObject);
            StationRenderers.Clear();
        }

        // ------------------------------------------------------------- fixtures

        static string TinySave(JArray modules, JArray cells = null, JArray lines = null, int levelBase = 0, double serviceFrom = 23400, double serviceTo = 84600) {
            var envelope = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "ÃƒÂ¦Ã‚ÂµÃ¢â‚¬Â¹ÃƒÂ¨Ã‚Â¯Ã¢â‚¬Â¢ÃƒÂ§Ã‚Â«Ã¢â€žÂ¢",
                ["nameEn"] = "Test",
                ["city"] = "guangzhou",
                ["seed"] = 7654321,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = 5,
                ["service"] = new JObject { ["from"] = serviceFrom, ["to"] = serviceTo },
                ["peaks"] = new JArray {
                    new JObject { ["from"] = 26100, ["to"] = 32400 },
                    new JObject { ["from"] = 63000, ["to"] = 68400 },
                },
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray { Cell(0, 0, 0), Cell(1, 0, 0) },
                    ["modules"] = modules,
                    ["lines"] = lines ?? new JArray { Line("5", "5ÃƒÂ¥Ã‚ÂÃ‚Â·ÃƒÂ§Ã‚ÂºÃ‚Â¿") },
                },
            };
            return envelope.ToString(Newtonsoft.Json.Formatting.None);
        }

        static JObject Cell(int x, int y, int z, string finish = "floor.concrete") => new JObject {
            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid",
            ["zone"] = "unpaid",
            ["finish"] = new JObject { ["top"] = finish },
        };

        static JObject Module(string id, string type, int x, int y, int z, JObject cfg = null) => new JObject {
            ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = 0,
            ["cfg"] = cfg ?? new JObject(),
        };

        static JObject Line(string id, string name) => new JObject {
            ["id"] = id, ["name"] = name, ["nameEn"] = "Line " + id + "" , ["colour"] = "#c70541",
            ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail", ["psd"] = "full",
            ["direction"] = "up", ["upTerminus"] = "", ["downTerminus"] = "",
            ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
        };

        // -------------------------------------------------------------- shipped

        [Test]
        public void ShippedDocumentsMatchTheirProvenance() {
            var provenance = Provenance();
            var demos = (JArray)provenance["demos"];
            Assert.AreEqual(3, demos.Count, "the A1 manifest ships three demos");
            foreach (var row in demos) {
                string id = (string)row["id"];
                string file = (string)row["file"];
                var path = Path.Combine(DataRoot, "StationDesigner/Demos", file);
                Assert.IsTrue(File.Exists(path), "missing demo document: " + file);
                var text = File.ReadAllText(path);
                var read = StationDocumentReader.ReadFile(path);
                Assert.AreEqual((string)row["outputSha256"], read.Document.Source.Hash,
                    id + " carries the hash of the exact envelope it was read from");
                Assert.AreEqual((string)row["outputSha256"], StationDocumentReader.Hash(text), id + " output sha256");
                Assert.AreEqual((int)row["counts"]["cells"], read.Document.CellCount, id + " cells");
                Assert.AreEqual((int)row["counts"]["modules"], read.Document.ModuleCount, id + " modules");
                Assert.AreEqual((int)row["counts"]["lines"], read.Document.LineCount, id + " lines");
                Assert.AreEqual((string)row["label"], read.Document.Name, id + " name");
                Assert.AreEqual(0, read.Document.DroppedCells, id + " dropped cells");
                Assert.AreEqual(0, read.Document.DroppedModules, id + " dropped modules");
                Assert.AreEqual(5, read.Document.StoreyHeight);
                Assert.IsTrue(read.Index.IsValid, id + " index valid: " + FirstError(read));
                Assert.IsNotEmpty(read.Index.Levels.ToArray(), id + " levels");
                Assert.IsNotEmpty(read.Index.Lines, id + " lines indexed");
            }
        }

        static string FirstError(StationReadResult read) =>
            string.Join("; ", read.Diagnostics.Where(d => d.Severity == StationDiagnosticSeverity.Error).Select(d => d.ToString()));

        [Test]
        public void ReopenIsALosslessFixedPoint() {
            var read = StationDocumentReader.ReadFile(DemoPath("zoo"));
            var savedAt = DateTimeOffset.Parse(read.Document.SavedAt, System.Globalization.CultureInfo.InvariantCulture);
            var written = StationDocumentReader.Write(read.Document, savedAt);
            Assert.AreEqual(read.Document.NormalizedJson, written, "saving the committed document is byte-identical to the loaded envelope");
            var reopened = StationDocumentReader.Read(written, new StationSource("reopen", ""));
            Assert.AreEqual(read.Document.CellCount, reopened.Document.CellCount);
            Assert.AreEqual(read.Document.ModuleCount, reopened.Document.ModuleCount);
            Assert.AreEqual(read.Document.LineCount, reopened.Document.LineCount);
            Assert.AreEqual(read.Document.Name, reopened.Document.Name);
            Assert.AreEqual(written, reopened.Document.NormalizedJson);
            // Identity is stable, not just counts: every module id and cell key is the same.
            var before = read.Document.Modules.Select(m => m.Id).OrderBy(id => id, StringComparer.Ordinal).ToArray();
            var after = reopened.Document.Modules.Select(m => m.Id).OrderBy(id => id, StringComparer.Ordinal).ToArray();
            CollectionAssert.AreEqual(before, after, "module ids");
            var beforeCells = read.Document.Cells.Select(c => c.Key.ToString()).OrderBy(k => k, StringComparer.Ordinal).ToArray();
            var afterCells = reopened.Document.Cells.Select(c => c.Key.ToString()).OrderBy(k => k, StringComparer.Ordinal).ToArray();
            CollectionAssert.AreEqual(beforeCells, afterCells, "cell keys");
        }

        [Test]
        public void TinyAuthoredSaveUsesTheSameReader() {
            var modules = new JArray {
                Module("gate-1", "gate", 1, 0, 0, new JObject { ["dir"] = "both" }),
                Module("track-1", "track", 2, 0, -5, new JObject { ["line"] = "5", ["dir"] = "up" }),
            };
            var read = StationDocumentReader.Read(TinySave(modules, levelBase: 2), new StationSource("tiny", ""));
            Assert.AreEqual("ÃƒÂ¦Ã‚ÂµÃ¢â‚¬Â¹ÃƒÂ¨Ã‚Â¯Ã¢â‚¬Â¢ÃƒÂ§Ã‚Â«Ã¢â€žÂ¢", read.Document.Name);
            Assert.AreEqual("Test", read.Document.NameEn);
            Assert.AreEqual(2, read.Document.LevelBase);
            Assert.AreEqual(2, read.Document.CellCount);
            Assert.AreEqual(2, read.Document.ModuleCount);
            Assert.AreEqual(1, read.Document.LineCount);
            Assert.AreEqual(23400, read.Document.Day.Service.From, 1e-9);
            Assert.AreEqual(84600, read.Document.Day.Service.To, 1e-9);
            Assert.AreEqual(0, read.Index.TracksOfLine("5").Count == 1 ? 0 : 1, "track bound to line 5");
            var gate = read.Index.GetModule("gate-1");
            Assert.IsNotNull(gate);
            Assert.AreEqual("gate", gate.Type);
            var cell = read.Index.GetCell(0, 0, 0);
            Assert.IsNotNull(cell);
            Assert.AreEqual("floor.concrete", cell.FinishTop);
            // Reopen through the writer and the file reader.
            var path = Path.Combine(Path.GetTempPath(), "metro-tiny-" + Guid.NewGuid().ToString("N") + ".metro.json");
            try {
                File.WriteAllText(path, StationDocumentReader.Write(read.Document, DateTimeOffset.UtcNow));
                var reopened = StationDocumentReader.ReadFile(path);
                Assert.AreEqual(read.Document.ModuleCount, reopened.Document.ModuleCount);
                Assert.AreEqual(read.Document.LevelBase, reopened.Document.LevelBase);
            } finally {
                File.Delete(path);
            }
        }

        [Test]
        public void ChangedCellsModulesLinesAndDaySurviveReopen() {
            var read = StationDocumentReader.Read(TinySave(new JArray()), new StationSource("changed", ""));
            var envelope = JObject.Parse(read.Document.NormalizedJson);
            envelope["levelBase"] = 4;
            envelope["service"] = new JObject { ["from"] = 18000, ["to"] = 79200 };
            ((JArray)envelope["static"]["cells"])[0]["finish"]["top"] = "floor.marble";
            ((JArray)envelope["static"]["modules"]).Add(Module("tvm-1", "tvm", 1, 0, 0));
            ((JArray)envelope["static"]["lines"])[0]["name"] = "renamed line";
            var changed = StationDocumentReader.Read(envelope.ToString(Newtonsoft.Json.Formatting.None), new StationSource("changed-2", ""));
            Assert.AreEqual(4, changed.Document.LevelBase);
            Assert.AreEqual(18000, changed.Document.Day.Service.From, 1e-9);
            Assert.AreEqual("floor.marble", changed.Index.GetCell(0, 0, 0).FinishTop);
            Assert.IsNotNull(changed.Index.GetModule("tvm-1"));
            Assert.AreEqual("renamed line", changed.Document.Lines[0].Name);
            var reopened = StationDocumentReader.Read(StationDocumentReader.Write(changed.Document, DateTimeOffset.UtcNow), new StationSource("changed-3", ""));
            Assert.AreEqual("renamed line", reopened.Document.Lines[0].Name);
            Assert.AreEqual("floor.marble", reopened.Index.GetCell(0, 0, 0).FinishTop);
        }

        [Test]
        public void InvalidDocumentsAreRejectedWithTypedCodes() {
            AssertCode("parse-failed", "{ not json");
            AssertCode("parse-failed", "{\"format\":\"other\",\"formatVersion\":1,\"static\":{\"cells\":[]}}");
            var tooNew = JObject.Parse(TinySave(new JArray()));
            tooNew["formatVersion"] = 2;
            AssertCode("version-too-new", tooNew.ToString(Newtonsoft.Json.Formatting.None));
            var duplicateId = JObject.Parse(TinySave(new JArray {
                Module("same", "gate", 0, 0, 0), Module("same", "tvm", 1, 0, 0),
            }));
            AssertCode("duplicate-id", duplicateId.ToString(Newtonsoft.Json.Formatting.None));
            var duplicateCell = JObject.Parse(TinySave(new JArray(), new JArray { Cell(0, 0, 0), Cell(0, 0, 0) }));
            // The source grid repair keeps the first record at a coordinate and reports the
            // rest (`build/model/Grid.ts`). Tanwei ships 77 such duplicates, so the reader
            // must open it with a diagnostic instead of refusing the whole station.
            var duplicateRead = StationDocumentReader.Read(duplicateCell.ToString(Newtonsoft.Json.Formatting.None), new StationSource("invalid", ""));
            Assert.AreEqual(2, duplicateRead.Document.CellCount, "both saved cells stay in the document");
            Assert.AreEqual(1, duplicateRead.Index.CellCount, "the index keeps one record per coordinate");
            Assert.IsTrue(duplicateRead.Diagnostics.Any(d => d.Code == "duplicate-cell" && d.Severity == StationDiagnosticSeverity.Warning),
                "the duplicate is reported as a warning");
            var unknownType = JObject.Parse(TinySave(new JArray { Module("odd-1", "hoverbus", 0, 0, 0) }));
            var rejection = AssertCode("unsupported-record", unknownType.ToString(Newtonsoft.Json.Formatting.None));
            Assert.AreEqual("hoverbus", rejection.RecordType);
            Assert.AreEqual("odd-1", rejection.RecordId);
        }

        static StationRejection AssertCode(string code, string json) {
            try {
                StationDocumentReader.Read(json, new StationSource("invalid", ""));
                Assert.Fail("expected a station rejection with code " + code);
                return null;
            } catch (StationRejectedException error) {
                Assert.AreEqual(code, error.Rejection.Code, error.Rejection.Message);
                Assert.IsFalse(string.IsNullOrEmpty(error.Rejection.Reason), "a rejection explains itself");
                return error.Rejection;
            }
        }

        // -------------------------------------------------------------- repairs

        [Test]
        public void AdPostersAreBackfilledDeterministically() {
            var modules = new JArray {
                Module("billboard-test", "billboard", 0, 0, 0, new JObject { ["variant"] = "wide" }),
                Module("tv-test", "tv", 1, 0, 0),
            };
            var read = StationDocumentReader.Read(TinySave(modules), new StationSource("ads", ""));
            var poster = read.Index.GetModule("billboard-test").Config.Text("poster");
            Assert.IsFalse(string.IsNullOrEmpty(poster), "billboard gained a poster");
            StringAssert.StartsWith("landscape-", poster);
            Assert.IsFalse(string.IsNullOrEmpty(read.Index.GetModule("tv-test").Config.Text("poster")), "tv gained a poster");
            Assert.IsTrue(read.Diagnostics.Any(d => d.Code == "ad-posters-backfilled"));
            // The repair is part of the document and cannot re-roll on reopen.
            var reopened = StationDocumentReader.Read(StationDocumentReader.Write(read.Document, DateTimeOffset.UtcNow), new StationSource("ads-2", ""));
            Assert.AreEqual(poster, reopened.Index.GetModule("billboard-test").Config.Text("poster"));
            Assert.AreEqual(read.Document.ModuleCount, reopened.Document.ModuleCount, "no records added by ad repair");
        }

        [Test]
        public void LegacyRoomsGetTheirFurnitureOnce() {
            var modules = new JArray {
                Module("booth-1", "booth", 0, 0, 0, new JObject { ["kind"] = "ticket" }),
                Module("shop-1", "shop", 5, 0, 0, new JObject { ["kind"] = "store" }),
                Module("retail-1", "retail", 9, 0, 0),
            };
            modules[0]["w"] = 3; modules[0]["h"] = 3;
            modules[1]["w"] = 2; modules[1]["h"] = 2;
            modules[2]["w"] = 2; modules[2]["h"] = 2;
            var read = StationDocumentReader.Read(TinySave(modules), new StationSource("rooms", ""));
            Assert.IsTrue(read.Index.GetModule("booth-1").Config.Bool("stocked"), "booth marked stocked");
            Assert.IsTrue(read.Index.GetModule("shop-1").Config.Bool("stocked"), "shop marked stocked");
            Assert.IsTrue(read.Index.GetModule("retail-1").Config.Bool("stocked"), "retail marked stocked");
            var benches = read.Index.ModulesOfType("bench");
            Assert.AreEqual(1, benches.Count, "only the ticket booth materialises furniture (front=0: one bench on the far row)");
            Assert.AreEqual(1, benches[0].X);
            Assert.AreEqual(1, benches[0].Y);
            Assert.AreEqual(0, benches[0].Z);
            var reopened = StationDocumentReader.Read(StationDocumentReader.Write(read.Document, DateTimeOffset.UtcNow), new StationSource("rooms-2", ""));
            Assert.AreEqual(1, reopened.Index.ModulesOfType("bench").Count, "reopening does not duplicate furniture");
        }

        [Test]
        public void BridgePillarsAreRepairedAndIdempotent() {
            var bridge = Module("bridge-1", "track", 0, 0, 11, new JObject {
                ["line"] = "5", ["dir"] = "up", ["bridge"] = true,
            });
            bridge["w"] = 16; bridge["d"] = 1;
            var modules = new JArray { bridge, Module("track-1", "track", 0, 5, -5, new JObject { ["line"] = "5" }) };
            var cells = new JArray {
                Cell(4, 0, 0), Cell(12, 0, 0), Cell(0, 5, 0),
            };
            var read = StationDocumentReader.Read(TinySave(modules, cells), new StationSource("bridge", ""));
            var pillars = read.Index.ModulesOfType("pillar");
            Assert.AreEqual(2, pillars.Count, "one thick support per complete eight-metre bay");
            Assert.AreEqual("bridge-1:pillar:4", pillars[0].Id);
            Assert.AreEqual("bridge-1:pillar:12", pillars[1].Id);
            Assert.AreEqual(11, pillars[0].Config.Number("height"), "support rises from grade to the deck");
            var reopened = StationDocumentReader.Read(StationDocumentReader.Write(read.Document, DateTimeOffset.UtcNow), new StationSource("bridge-2", ""));
            Assert.AreEqual(2, reopened.Index.ModulesOfType("pillar").Count, "repair does not add a second set of pillars");
        }

        // ----------------------------------------------------------- transaction

        [Test]
        public void OpenDemoNewAndSwitchUseOneAtomicTransaction() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            var renderer = new CountingRenderer();
            coordinator.RegisterRenderer(renderer);
            var sim = new FakeSimulation();
            coordinator.SetSimulationHost(sim);
            var commits = 0;
            coordinator.Committed += _ => commits++;

            var zoo = coordinator.OpenFile(DemoPath("zoo"), "zoo");
            Assert.IsTrue(zoo.Accepted, zoo.ToString());
            Assert.AreEqual(1, coordinator.Revision);
            Assert.AreEqual("zoo", coordinator.SourceId);
            Assert.IsTrue(coordinator.World.IsActivated, "committed world is active");
            Assert.AreEqual(1, simulateCommits(sim));

            var previousWorld = coordinator.World;
            var tanwei = coordinator.OpenFile(DemoPath("tanwei"), "tanwei");
            Assert.IsTrue(tanwei.Accepted, tanwei.ToString());
            Assert.AreEqual(2, coordinator.Revision);
            Assert.AreNotSame(previousWorld, coordinator.World);
            Assert.IsTrue(previousWorld.IsDisposed, "previous world is disposed on success");
            Assert.IsTrue(sim.ActiveClockJson().Contains("simTimeSeconds"), "simulation was committed with the document");

            var newStation = coordinator.New("ÃƒÂ¦Ã¢â‚¬â€œÃ‚Â°ÃƒÂ§Ã‚Â«Ã¢â€žÂ¢", "shenzhen", 42);
            Assert.IsTrue(newStation.Accepted, newStation.ToString());
            Assert.AreEqual(3, coordinator.Revision);
            Assert.AreEqual("new", coordinator.SourceId);
            Assert.AreEqual(0, coordinator.Document.ModuleCount);
            Assert.AreEqual(3, commits);
        }

        static int simulateCommits(FakeSimulation sim) => sim.CommitCount;

        [Test]
        public void ARefusalKeepsTheCommittedStation() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            coordinator.RegisterRenderer(new CountingRenderer());
            var sim = new FakeSimulation();
            coordinator.SetSimulationHost(sim);
            var zoo = coordinator.OpenFile(DemoPath("zoo"), "zoo");
            Assert.IsTrue(zoo.Accepted);
            var document = coordinator.Document;
            var world = coordinator.World;
            int revision = coordinator.Revision;
            int aborts = sim.AbortCount;

            var rejected = coordinator.Open("{\"format\":\"metro-save\",\"formatVersion\":1,\"static\":{\"cells\":[]},\"name\":\"x\",\"static\":{\"cells\":[],\"modules\":[{\"id\":\"odd\",\"type\":\"hoverbus\",\"x\":0,\"y\":0,\"z\":0,\"cfg\":{}}],\"lines\":[]}}", StationSource.None, "bad");
            Assert.IsFalse(rejected.Accepted);
            Assert.AreEqual("unsupported-record", rejected.Rejection.Code);
            Assert.AreSame(document, coordinator.Document, "document unchanged");
            Assert.AreSame(world, coordinator.World, "world unchanged");
            Assert.IsFalse(world.IsDisposed, "the live world is not disposed by a failed candidate");
            Assert.AreEqual(revision, coordinator.Revision, "revision unchanged");
            Assert.AreEqual(aborts, sim.AbortCount, "a document refused before staging never touches the live session");
        }

        [Test]
        public void ARendererFailureRollsBackTheInstall() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            var renderer = new CountingRenderer();
            coordinator.RegisterRenderer(renderer);
            var sim = new FakeSimulation();
            coordinator.SetSimulationHost(sim);
            Assert.IsTrue(coordinator.OpenFile(DemoPath("zoo"), "zoo").Accepted);
            var document = coordinator.Document;
            var world = coordinator.World;
            int revision = coordinator.Revision;

            renderer.FailNext = true;
            var rejected = coordinator.OpenFile(DemoPath("tanwei"), "tanwei");
            Assert.IsFalse(rejected.Accepted);
            Assert.AreEqual("render-failed", rejected.Rejection.Code);
            Assert.AreEqual("test", rejected.Rejection.RecordId);
            Assert.AreSame(document, coordinator.Document);
            Assert.AreSame(world, coordinator.World);
            Assert.AreEqual(revision, coordinator.Revision);
            Assert.AreEqual(1, sim.AbortCount, "the failed candidate aborted exactly one staged session");
            // The failure is recoverable: the next load commits normally.
            renderer.FailNext = false;
            var recovered = coordinator.OpenFile(DemoPath("tanwei"), "tanwei");
            Assert.IsTrue(recovered.Accepted, recovered.ToString());
            Assert.AreEqual(revision + 1, coordinator.Revision);
        }

        [Test]
        public void AllDemosOpenAndZooAgainWithoutOrphans() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            coordinator.RegisterRenderer(new CountingRenderer());
            var worlds = new List<StationWorldView>();
            foreach (var id in new[] { "zoo", "tanwei", "tianhe", "zoo" }) {
                var result = coordinator.OpenFile(DemoPath(id), id);
                Assert.IsTrue(result.Accepted, id + ": " + result);
                worlds.Add(coordinator.World);
            }
            Assert.AreEqual(4, coordinator.Revision);
            Assert.AreEqual(4, worlds.Distinct().Count(), "every switch builds a fresh world");
            for (int i = 0; i < worlds.Count - 1; i++) {
                Assert.IsTrue(worlds[i].IsDisposed, "previous world " + i + " is disposed");
                Assert.IsTrue(worlds[i].RootObject == null, "previous root " + i + " is destroyed");
            }
            var zooCells = (int)((JArray)Provenance()["demos"]).First(row => (string)row["id"] == "zoo")["counts"]["cells"];
            Assert.AreEqual(zooCells, coordinator.Document.CellCount, "Zoo is the committed station again");
            Assert.AreEqual("zoo", coordinator.SourceId);
        }

        // ---------------------------------------------------------------- helpers

        sealed class CountingRenderer : IStationViewRenderer {
            public string Role => "test";
            public bool FailNext;
            public int Builds;
            public int Releases;
            public void Build(StationViewBuildContext context) {
                Builds++;
                if (FailNext) throw new InvalidOperationException("renderer exploded");
                var gates = context.Index.ModulesOfType("gate");
                if (gates.Count > 0) context.World.RegisterModule(Role, gates[0].Id, new GameObject("gate view"));
                if (gates.Count > 3) context.World.RegisterModule(Role, gates[3].Id, new GameObject("gate view 2"), "part");
                context.ReportUnresolved("test-note", "module", gates.Count > 0 ? gates[0].Id : "", "counting renderer");
            }
            public void Release() => Releases++;
        }

        sealed class FakeSimulation : IStationSimulationHost {
            public int StageCount;
            public int CommitCount;
            public int AbortCount;
            public int ReleaseCount;
            public bool Playing => false;
            public int Speed => 1;
            public double SimTimeSeconds => 23400;
            public void StageInstall(StationDocument document, StationIndex index) { StageCount++; }
            public void CommitInstall() { CommitCount++; }
            public void AbortInstall() { AbortCount++; }
            public void Tick(double realSeconds) { }
            public void Release() { ReleaseCount++; }
            public string ClockPayloadJson() => "{\"simTimeSeconds\":23400,\"playing\":false}";
            public string ActiveClockJson() => ClockPayloadJson();
        }

        // ------------------------------------------------------------ opening level

        [Test]
        public void TheOpeningLevelIsTheLowestAuthoredMetre() {
            // app/openingLevel.ts: the shell opens at the lowest authored height, so the
            // TS and Unity home views frame the same storey (plan 11 D4).
            var zoo = StationDocumentReader.Read(File.ReadAllText(DemoPath("zoo")), new StationSource("zoo", ""));
            Assert.That(zoo.Document.OpeningLevel, Is.EqualTo(-20), "Zoo opens on its basement metre");

            var tanwei = StationDocumentReader.Read(File.ReadAllText(DemoPath("tanwei")), new StationSource("tanwei", ""));
            Assert.That(tanwei.Document.OpeningLevel, Is.LessThanOrEqualTo(tanwei.Document.LevelBase), "Tanwei opens at or below its basis");

            // A station with no cell below its basis opens at the basis, and a module on a
            // lower metre wins over both.
            var empty = StationDocumentReader.Read(TinySave(new JArray(), new JArray { Cell(0, 0, 0) }, levelBase: 2), new StationSource("flat", ""));
            Assert.That(empty.Document.OpeningLevel, Is.EqualTo(0), "a floor at 0 beats a level base of 2");
            var moduleLow = Module("benches-1", "bench", 0, 0, -5);
            var lowered = StationDocumentReader.Read(TinySave(new JArray { moduleLow }, new JArray { Cell(0, 0, 0) }), new StationSource("low", ""));
            Assert.That(lowered.Document.OpeningLevel, Is.EqualTo(-5), "a module below the floor opens the station lower");
        }
    }
}
