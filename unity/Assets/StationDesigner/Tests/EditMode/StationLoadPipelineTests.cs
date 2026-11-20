using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
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
            StationCommandHandlers.Clear();
            StationEditSession.Reset();
        }

        // ------------------------------------------------------------- fixtures

        static string TinySave(JArray modules, JArray cells = null, JArray lines = null, int levelBase = 0, double serviceFrom = 23400, double serviceTo = 84600) {
            var envelope = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "测试站",
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
                    ["lines"] = lines ?? new JArray { Line("5", "5号线") },
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
            Assert.AreEqual("测试站", read.Document.Name);
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

            var newStation = coordinator.New("新站", "shenzhen", 42);
            Assert.IsTrue(newStation.Accepted, newStation.ToString());
            Assert.AreEqual(3, coordinator.Revision);
            Assert.AreEqual("new", coordinator.SourceId);
            Assert.AreEqual(0, coordinator.Document.ModuleCount);
            Assert.AreEqual(3, commits);
        }

        static int simulateCommits(FakeSimulation sim) => sim.CommitCount;

        [Test]
        public void AnEditIsClassifiedBeforeTheWorldIsStaged() {
            // Plan 29 §3: the impact classification runs ahead of view staging, and the
            // simulation host receives that answer instead of walking the document again.
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            coordinator.RegisterRenderer(new CountingRenderer());
            var sim = new FakeSimulation();
            coordinator.SetSimulationHost(sim);

            Assert.IsTrue(coordinator.Open(ActiveServiceSaveJson(nameEn: "Classified"), StationSource.None, "classified").Accepted);
            Assert.IsNull(sim.LastEditKind, "a station open is not an edit");

            Assert.IsTrue(coordinator.InstallEditedDocument(ActiveServiceSaveJson(nameEn: "Renamed"), "label").Accepted);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, sim.LastEditKind, "a name/label edit is cosmetic");
            Assert.IsTrue(sim.LastStageWasEdit, "the staging call is an edit");

            Assert.IsTrue(coordinator.InstallEditedDocument(
                ActiveServiceSaveJson(nameEn: "Renamed", serviceTo: 82800), "day").Accepted);
            Assert.AreEqual(StationDocumentEditKind.DayOnly, sim.LastEditKind, "a service-window edit is day-only");

            Assert.IsTrue(coordinator.InstallEditedDocument(
                ActiveServiceSaveJson(nameEn: "Renamed", serviceTo: 82800, extraConcourseCell: true), "cell").Accepted);
            Assert.AreEqual(StationDocumentEditKind.Structural, sim.LastEditKind, "a cell change is structural");
        }

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
            public bool LastStageWasEdit;
            /// <summary>The classification the coordinator passed ahead of the world staging.</summary>
            public StationDocumentEditKind? LastEditKind;
            public int CommitCount;
            public int AbortCount;
            public int ReleaseCount;
            public bool Playing => false;
            public int Speed => 1;
            public double SimTimeSeconds => 23400;
            public long SimulationTick => 0;
            public double PresentationFraction => 0;
            public long PresentationEpoch => 0;
            public void StageInstall(StationDocument document, StationIndex index, bool isEdit = false,
                StationDocumentEditKind? editKind = null) {
                StageCount++;
                LastStageWasEdit = isEdit;
                LastEditKind = editKind;
            }
            public void CommitInstall() { CommitCount++; }
            public void AbortInstall() { AbortCount++; }
            public void Tick(double realSeconds) { }
            public void Release() { ReleaseCount++; }
            public string ClockPayloadJson() => "{\"simTimeSeconds\":23400,\"playing\":false}";
            public string CapabilitiesPayloadJson() => "{\"sessionId\":\"sim-test\",\"clock\":true,\"play\":true,\"speed\":true}";
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

        // --------------------------------------------- statistics run & edit lifecycle

        static string ActiveServiceSaveJson(string nameEn = "Stats Station", string cell32Finish = "floor.concrete", bool extraConcourseCell = false, double serviceTo = 84600) {
            var cells = new JArray();
            for (int x = 0; x <= 42; x++) {
                for (int y = 1; y <= 4; y++) {
                    if (x == 5 && y != 2) continue; // single gate throat at (5, 2)
                    string zone = x < 5 ? "unpaid" : "paid";
                    string finish = (x == 3 && y == 2) ? cell32Finish : "floor.concrete";
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid",
                        ["zone"] = zone,
                        ["finish"] = new JObject { ["top"] = finish },
                    });
                }
            }
            if (extraConcourseCell) {
                cells.Add(new JObject {
                    ["x"] = 43, ["y"] = 2, ["z"] = 0, ["fill"] = "solid",
                    ["zone"] = "paid",
                    ["finish"] = new JObject { ["top"] = "floor.concrete" },
                });
            }

            var modules = new JArray {
                new JObject {
                    ["id"] = "exit-a", ["type"] = "exit", ["x"] = 1, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["inRate"] = 1800, ["open"] = true, ["covered"] = false, ["bays"] = 2 },
                },
                new JObject {
                    ["id"] = "gate-1", ["type"] = "gate", ["x"] = 5, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["dir"] = "both", ["door"] = "lane" },
                },
                new JObject {
                    ["id"] = "track-1", ["type"] = "track", ["x"] = 6, ["y"] = -2, ["z"] = 0, ["rot"] = 0,
                    ["w"] = 36, ["d"] = 3, ["cfg"] = new JObject { ["line"] = "5", ["power"] = "third-rail", ["dir"] = "up" },
                },
                new JObject {
                    ["id"] = "edge-1", ["type"] = "platform-edge", ["x"] = 6, ["y"] = 1, ["z"] = 0, ["rot"] = 0,
                    ["w"] = 36, ["cfg"] = new JObject { ["line"] = "5", ["from"] = "track-1", ["side"] = "left", ["psd"] = "full", ["dir"] = "up" },
                },
            };

            var line = Line("5", "Line 5");
            line["cars"] = 2;
            line["alightPerTrain"] = 8;
            line["headwayProfile"] = new JObject { ["peak"] = 60, ["offpeak"] = 60, ["late"] = 60 };

            var raw = JObject.Parse(TinySave(modules, cells, new JArray { line }, serviceTo: serviceTo));
            raw["nameEn"] = nameEn;
            return raw.ToString(Newtonsoft.Json.Formatting.None);
        }

        static string HostEnvelope(string type, JObject payload = null, string id = "c-1") => new JObject {
            ["schemaVersion"] = 2,
            ["id"] = id,
            ["sessionId"] = "s-stats",
            ["type"] = type,
            ["payload"] = payload ?? new JObject(),
        }.ToString(Newtonsoft.Json.Formatting.None);

        [Test]
        public void StatisticsRunSurvivesLabelCosmeticDayStructuralUndoAbortedEditsRejectedLoadAndResyncWhileReloadResets() {
            var hostGo = new GameObject(StationGameHost.ObjectName);
            hostGo.transform.SetParent(rootObject.transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);

            var renderer = new CountingRenderer();
            host.RegisterRenderer(renderer);

            string baseJson = ActiveServiceSaveJson();

            // 1. Initial Open publishes fresh statistics & stationStatistics capability, without full history values in commit/state.
            var open0 = JObject.Parse(host.SendForTest(HostEnvelope("station.open", new JObject { ["document"] = baseJson }, "c-open-0")));
            Assert.AreEqual("commit", (string)open0["kind"], open0.ToString());
            Assert.IsTrue((bool)open0["payload"]["capabilities"]["stationStatistics"]);
            string run0 = (string)open0["payload"]["statistics"]["runId"];
            Assert.IsNotEmpty(run0);
            Assert.AreEqual(0, (int)open0["payload"]["statistics"]["history"]["count"]);
            Assert.IsNull(open0["payload"]["statistics"]["history"]["values"]);

            // 2. Reloading the exact same JSON hash starts a different statistics run!
            var open1 = JObject.Parse(host.SendForTest(HostEnvelope("station.open", new JObject { ["document"] = baseJson }, "c-open-1")));
            Assert.AreEqual("commit", (string)open1["kind"]);
            Assert.AreEqual((string)open0["payload"]["sourceHash"], (string)open1["payload"]["sourceHash"], "same save hash");
            string run1 = (string)open1["payload"]["statistics"]["runId"];
            Assert.AreNotEqual(run0, run1, "reopening the same hash must mint a fresh statistics run");

            // 3. Seek into Monday morning peak (2026-01-05 08:00) & run until >= 2 history rows, active crowd, and a berthed train / boardings exist.
            var seekPeak = JObject.Parse(host.SendForTest(HostEnvelope("sim.seek", new JObject { ["simTimeSeconds"] = 4 * 86400 + 28800 }, "c-seek")));
            Assert.AreEqual("ack", (string)seekPeak["kind"]);
            string activeRun = (string)seekPeak["payload"]["statistics"]["runId"];
            Assert.AreNotEqual(run1, activeRun);

            host.SendForTest(HostEnvelope("sim.play", new JObject { ["playing"] = true }, "c-play"));
            var session = ((StationSimulationHost)host.Simulation).Session;

            bool hitBerthedState = false;
            for (int i = 0; i < 240; i++) {
                host.Coordinator.Tick(1.0);
                if (session.History.Count >= 2 && session.Statistics.Boarded > 0 && (session.Services.Onboard > 0 || session.Statistics.Population > 3)) {
                    if (session.Services.Onboard > 0) {
                        hitBerthedState = true;
                        break;
                    }
                }
            }
            if (!hitBerthedState) {
                Assert.GreaterOrEqual(session.History.Count, 2);
                Assert.Greater(session.Statistics.Boarded, 0);
            }

            int rowsBeforeEdits = session.History.Count;
            int boardedBeforeEdits = session.Statistics.Boarded;
            int epochBeforeEdits = session.Services.GraphEpoch;

            // 4. Label / cosmetic edit keeps runId, history rows, cumulative totals, and walk graph epoch!
            var labelResult = host.ApplyDocumentEdit(ActiveServiceSaveJson(nameEn: "Renamed Station"), "label-edit");
            Assert.IsTrue(labelResult.Accepted, labelResult.ToString());
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(rowsBeforeEdits, session.History.Count);
            Assert.AreEqual(epochBeforeEdits, session.Services.GraphEpoch, "label edit is cosmetic and does not rebuild graph");
            Assert.AreEqual(boardedBeforeEdits, session.Statistics.Boarded);

            // 5. Cosmetic bin placement + Undo + Redo + Undo via StationEditSession keeps runId, history, and counters!
            var binDraft = new StationEditDraft {
                Id = "bin-cosmetic", Type = "bin", X = 12, Y = 4, Z = 0, Rotation = 0, Width = 1, Depth = 1, Height = 1,
            };
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, binDraft, null, "place", "c-bin", out _, out var editErr), editErr);
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(epochBeforeEdits, session.Services.GraphEpoch, "bin placement is sim-inert cosmetic");
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out editErr), editErr);
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out editErr), editErr);
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(rowsBeforeEdits, session.History.Count);
            Assert.AreEqual(boardedBeforeEdits, session.Statistics.Boarded);
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out editErr), editErr);

            // 6. Day-only edit keeps runId, history, and walk graph epoch!
            var dayEdit = host.ApplyDocumentEdit(ActiveServiceSaveJson(nameEn: "Renamed Station", serviceTo: 82800), "day-edit");
            Assert.IsTrue(dayEdit.Accepted, dayEdit.ToString());
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(epochBeforeEdits, session.Services.GraphEpoch, "day-only edit uses ApplyDay without graph rebuild");

            // 7. Structural edit (changing floor top finish speed + adding floor cell) keeps runId, history, and cumulative counters,
            // while rebuilding the graph and replanning active walkers!
            var structuralEdit = host.ApplyDocumentEdit(
                ActiveServiceSaveJson(nameEn: "Renamed Station", cell32Finish: "floor.granite", extraConcourseCell: true, serviceTo: 82800),
                "structural-edit");
            Assert.IsTrue(structuralEdit.Accepted, structuralEdit.ToString());
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(rowsBeforeEdits, session.History.Count);
            Assert.AreEqual(epochBeforeEdits + 1, session.Services.GraphEpoch, "top-finish speed + cell change triggered structural rebuild");
            Assert.IsTrue(session.Services.AllWalkingRoutesMatchCurrentGraph(), "all walking paths replanned onto new graph");
            Assert.AreEqual(boardedBeforeEdits, session.Statistics.Boarded);

            // 8. Aborted edit (renderer failure) drops staged data and leaves run, history, and crowd intact!
            int revBeforeFail = host.CurrentRevision;
            int epochBeforeFail = session.Services.GraphEpoch;
            renderer.FailNext = true;
            var abortedEdit = host.ApplyDocumentEdit(ActiveServiceSaveJson(nameEn: "Will Roll Back", extraConcourseCell: false), "abort-edit");
            renderer.FailNext = false;
            Assert.IsFalse(abortedEdit.Accepted);
            Assert.AreEqual(revBeforeFail, host.CurrentRevision);
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(epochBeforeFail, session.Services.GraphEpoch);
            Assert.AreEqual(rowsBeforeEdits, session.History.Count);
            Assert.AreEqual(boardedBeforeEdits, session.Statistics.Boarded);

            // 9. Rejected load leaves active station, revision, runId, and history untouched!
            var rejectedOpen = JObject.Parse(host.SendForTest(HostEnvelope("station.open", new JObject { ["document"] = "{not valid json" }, "c-bad-open")));
            Assert.AreEqual("reject", (string)rejectedOpen["kind"]);
            Assert.AreEqual(revBeforeFail, host.CurrentRevision);
            Assert.AreEqual(activeRun, session.StatisticsRunId);
            Assert.AreEqual(rowsBeforeEdits, session.History.Count);

            // 10. station.resync returns the current run descriptor, and stats.history reads rows without moving revision!
            var resyncReply = JObject.Parse(host.SendForTest(HostEnvelope("station.resync", null, "c-resync")));
            Assert.AreEqual("commit", (string)resyncReply["kind"]);
            Assert.AreEqual(revBeforeFail, host.CurrentRevision);
            Assert.AreEqual(activeRun, (string)resyncReply["payload"]["statistics"]["runId"]);
            Assert.AreEqual(rowsBeforeEdits, (int)resyncReply["payload"]["statistics"]["history"]["count"]);

            var historyAck = JObject.Parse(host.SendForTest(HostEnvelope(
                "stats.history",
                new JObject { ["runId"] = activeRun, ["from"] = 0, ["limit"] = 128 },
                "c-hist")));
            Assert.AreEqual("ack", (string)historyAck["kind"], historyAck.ToString());
            Assert.AreEqual(revBeforeFail, host.CurrentRevision, "stats.history must never move document revision");
            Assert.AreEqual(rowsBeforeEdits, (int)historyAck["payload"]["count"]);
            Assert.AreEqual(rowsBeforeEdits * StationStatisticsHistory.Stride, ((JArray)historyAck["payload"]["values"]).Count);

            // 11. Calendar date seek via sim.seek { year, month, day } resets history & mints a new runId while preserving cumulative boarded!
            var dateSeek = JObject.Parse(host.SendForTest(HostEnvelope(
                "sim.seek",
                new JObject { ["year"] = 2026, ["month"] = 1, ["day"] = 6 },
                "c-date-seek")));
            Assert.AreEqual("ack", (string)dateSeek["kind"], dateSeek.ToString());
            string postDateRun = (string)dateSeek["payload"]["statistics"]["runId"];
            Assert.AreNotEqual(activeRun, postDateRun);
            Assert.AreEqual(0, (int)dateSeek["payload"]["statistics"]["history"]["count"]);
            Assert.AreEqual(boardedBeforeEdits, (int)dateSeek["payload"]["statistics"]["metrics"]["boarded"]);
        }

        [Test]
        public void YieldedOpenCommitsRollsBackAndClearsPreviousReadOnSwitch() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            var renderer = new CountingRenderer();
            coordinator.RegisterRenderer(renderer);
            try {
                string saveA = TinySave(new JArray());
                StationLoadResult resA = null;
                var enumA = coordinator.OpenYielded(saveA, StationSource.None, "station-a", r => resA = r);
                int stepsA = 0;
                while (enumA.MoveNext()) stepsA++;
                Assert.GreaterOrEqual(stepsA, 3, "yielded open must pause across read, build, and commit boundaries");
                Assert.IsNotNull(resA);
                Assert.IsTrue(resA.Accepted);
                Assert.AreEqual(1, coordinator.Revision);
                Assert.AreEqual("station-a", coordinator.SourceId);
                var worldA = coordinator.World;

                // Failed render on yielded open must roll back atomically and leave station-a untouched.
                renderer.FailNext = true;
                StationLoadResult resFail = null;
                var enumFail = coordinator.OpenYielded(TinySave(new JArray { Module("b1", "bench", 0, 0, 0) }), StationSource.None, "station-fail", r => resFail = r);
                while (enumFail.MoveNext()) { }
                renderer.FailNext = false;
                Assert.IsNotNull(resFail);
                Assert.IsFalse(resFail.Accepted);
                Assert.AreEqual("render-failed", resFail.Rejection.Code);
                Assert.AreEqual(1, coordinator.Revision);
                Assert.AreSame(worldA, coordinator.World);
                Assert.IsFalse(worldA.IsDisposed);

                // Corrupt JSON on yielded open must reject with parse-failed and leave station-a untouched.
                StationLoadResult resBad = null;
                var enumBad = coordinator.OpenYielded("{bad json", StationSource.None, "station-bad", r => resBad = r);
                while (enumBad.MoveNext()) { }
                Assert.IsNotNull(resBad);
                Assert.IsFalse(resBad.Accepted);
                Assert.AreEqual("parse-failed", resBad.Rejection.Code);
                Assert.AreEqual(1, coordinator.Revision);
                Assert.AreSame(worldA, coordinator.World);

                // Successful station switch must dispose worldA and clear PreviousCommittedRead so old station is not pinned.
                StationLoadResult resB = null;
                var enumB = coordinator.OpenYielded(TinySave(new JArray { Module("b2", "bench", 1, 0, 0) }), StationSource.None, "station-b", r => resB = r);
                while (enumB.MoveNext()) { }
                Assert.IsNotNull(resB);
                Assert.IsTrue(resB.Accepted);
                Assert.AreEqual(2, coordinator.Revision);
                Assert.AreEqual("station-b", coordinator.SourceId);
                Assert.IsTrue(worldA.IsDisposed, "replaced world must be disposed");
                Assert.IsNull(coordinator.PreviousCommittedRead, "station switch must not pin previous station's read result");
            } finally {
                coordinator.Dispose();
            }
        }

        [Test]
        public void StreamingHashMatchesUtf8Sha256AcrossChunkBoundaries() {
            var longMixed = new StringBuilder(40000);
            for (int i = 0; i < 6000; i++) longMixed.Append("天河公园Tianhe-0123456789🚇");
            var samples = new[] { "", "hello", "广州地铁天河公园站", longMixed.ToString() };
            using var sha = SHA256.Create();
            foreach (var sample in samples) {
                var expectedBytes = sha.ComputeHash(Encoding.UTF8.GetBytes(sample));
                var expected = BitConverter.ToString(expectedBytes).Replace("-", "").ToLowerInvariant();
                Assert.AreEqual(expected, StationDocumentReader.Hash(sample), "mismatch for len=" + sample.Length);
            }
        }

        [Test]
        public void CellViewDirectStreamMatchesStandardMeshAndReleasesUploadBuffers() {
            var read = StationDocumentReader.Read(TinySave(new JArray(), new JArray {
                Cell(0, 0, 0, "floor.concrete"),
                Cell(1, 0, 0, "floor.terrazzo"),
                Cell(0, 1, 0, "floor.concrete"),
            }), StationSource.None);
            var fallback = new Material(Shader.Find("Hidden/InternalErrorShader") ?? Shader.Find("Standard"));
            try {
                var input = StationCellRenderer.BuildInput(read.Document, null, new List<string>(), null);
                var standardReq = new StationCellViewRequest {
                    Mesh = input,
                    FallbackMaterial = fallback,
                    Name = "Standard",
                };
                var directReq = new StationCellViewRequest {
                    Mesh = input,
                    FallbackMaterial = fallback,
                    Name = "Direct",
                    ReleaseUploadBuffers = true,
                    MarkMeshNoLongerReadable = false,
                };
                using var standardView = StationCellView.Build(standardReq, rootObject.transform);
                var workspace = StationCellMeshWorkspace.Create(input);
                using var directView = StationCellView.BuildFromWorkspace(directReq, rootObject.transform, workspace);

                Assert.AreEqual(standardView.MeshGroups, directView.MeshGroups, "group count");
                Assert.AreEqual(standardView.Triangles, directView.Triangles, "triangle count");
                Assert.Greater(directView.Triangles, 0);
                for (int i = 0; i < directView.Groups.Count; i++) {
                    var dg = directView.Groups[i];
                    var sg = standardView.Groups[i];
                    Assert.AreEqual(sg.Triangles, dg.Triangles);
                    Assert.AreEqual(sg.Data.VertexCount, dg.Data.VertexCount);
                    Assert.IsNull(dg.Data.Positions, "direct stream must not allocate retained Positions array");
                    Assert.IsNull(dg.Data.Normals, "direct stream must not allocate retained Normals array");
                    Assert.IsNull(dg.Data.TriangleFaces, "direct stream must not allocate retained TriangleFaces array");
                    Assert.IsNotNull(dg.WorldVertices, "picking vertices retained");
                    Assert.IsNotNull(dg.WorldIndices, "picking indices retained");
                }

                // Ray straight down onto top face of cell (0,0,0) in world space: (0.5, 5, 0.5) -> down
                var ray = new Ray(new Vector3(0.5f, 5f, 0.5f), Vector3.down);
                Assert.IsTrue(standardView.TryPick(ray, StationCellPickFilter.Default, out var sHit));
                Assert.IsTrue(directView.TryPick(ray, StationCellPickFilter.Default, out var dHit));
                Assert.AreEqual(sHit.CellKey, dHit.CellKey);
                Assert.AreEqual(sHit.Face, dHit.Face);
                Assert.AreEqual(sHit.FinishId, dHit.FinishId);
                Assert.AreEqual(standardView.Faces.Count, directView.Faces.Count, "lazy Faces rebuild count");
            } finally {
                UnityEngine.Object.DestroyImmediate(fallback);
            }
        }

        [Test]
        public void RepeatedDemoSwitchesHaveFlatManagedMemory() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            coordinator.RegisterRenderer(new StationCellRenderer());
            coordinator.RegisterRenderer(new StationSurfaceModuleRenderer());
            coordinator.RegisterRenderer(new StationStreetModuleRenderer());
            coordinator.RegisterRenderer(new StationEquipmentModuleRenderer());
            coordinator.RegisterRenderer(new StationDisplayModuleRenderer());
            coordinator.RegisterRenderer(new StationStructureModuleRenderer());
            coordinator.RegisterRenderer(new StationGridRenderer());
            coordinator.RegisterRenderer(new StationOverlayRenderer());
            coordinator.RegisterRenderer(new OpeningModuleRenderer());
            coordinator.RegisterRenderer(new StationRoadRenderer());
            coordinator.RegisterRenderer(new StationSignRenderer());
            coordinator.RegisterRenderer(new TrainConsistRenderer());
            coordinator.RegisterRenderer(new VerticalModuleRenderer());
            coordinator.RegisterRenderer(new OutdoorModuleRenderer());
            coordinator.RegisterRenderer(new PassengerCrowdRenderer());
            var simHost = new StationSimulationHost();
            coordinator.SetSimulationHost(simHost);
            var visibility = new StationVisibilityRegistry();
            coordinator.Committed += info => StationViewFeature.RegisterWorld(visibility, coordinator.World);
            try {
                (long live, WeakReference docRef, WeakReference idxRef, WeakReference worldRef, WeakReference cellRef, WeakReference simRef) OpenOne(string label, string id) {
                    var json = File.ReadAllText(DemoPath(id));
                    var res = coordinator.Open(json, new StationSource("demo:" + id, ""), id);
                    Assert.IsTrue(res.Accepted, id + " failed: " + res.Rejection?.Reason);
                    var refs = (
                        new WeakReference(res.Document),
                        new WeakReference(res.Index),
                        new WeakReference(coordinator.World),
                        new WeakReference(StationCellRenderer.Current),
                        new WeakReference(simHost.Session));
                    json = null;
                    res = null;
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    GC.Collect();
                    long live = GC.GetTotalMemory(true);
                    Debug.Log($"[MemSlope] {label} ({id}) liveMiB={live / (1024.0 * 1024.0):F1}");
                    return (live, refs.Item1, refs.Item2, refs.Item3, refs.Item4, refs.Item5);
                }
                var t1 = OpenOne("1-tianhe", "tianhe");
                var z1 = OpenOne("2-zoo", "zoo");
                Debug.Log($"[MemSlope] After 2-zoo, t1 alive: doc={t1.docRef.IsAlive} idx={t1.idxRef.IsAlive} world={t1.worldRef.IsAlive} cell={t1.cellRef.IsAlive} sim={t1.simRef.IsAlive}");
                var w1 = OpenOne("3-tanwei", "tanwei");
                Debug.Log($"[MemSlope] After 3-tanwei, t1 alive: doc={t1.docRef.IsAlive} idx={t1.idxRef.IsAlive} world={t1.worldRef.IsAlive} cell={t1.cellRef.IsAlive} sim={t1.simRef.IsAlive}");
                var t2 = OpenOne("4-tianhe", "tianhe");
                var z2 = OpenOne("5-zoo", "zoo");
                Debug.Log($"[MemSlope] After 5-zoo, t2 alive: doc={t2.docRef.IsAlive} idx={t2.idxRef.IsAlive} world={t2.worldRef.IsAlive} cell={t2.cellRef.IsAlive} sim={t2.simRef.IsAlive}");
                Assert.IsFalse(t1.docRef.IsAlive, "t1 Document leaked");
                Assert.IsFalse(t1.worldRef.IsAlive, "t1 World leaked");
                Assert.IsFalse(t1.cellRef.IsAlive, "t1 CellState leaked");
                Assert.IsFalse(t1.simRef.IsAlive, "t1 Session leaked");
                Assert.IsFalse(t2.docRef.IsAlive, "t2 Document leaked");
                Assert.IsFalse(t2.worldRef.IsAlive, "t2 World leaked");
                Assert.IsFalse(t2.cellRef.IsAlive, "t2 CellState leaked");
                Assert.IsFalse(t2.simRef.IsAlive, "t2 Session leaked");
            } finally {
                visibility.Dispose();
                coordinator.Dispose();
            }
        }

        [Test]
        public void HashEnvelopeMatchesNormalizedJsonSha256WithoutMaterializingJson() {
            foreach (var demoId in new[] { "zoo", "tianhe" }) {
                var read = StationDocumentReader.Read(File.ReadAllText(DemoPath(demoId)), new StationSource("demo:" + demoId, ""));
                var doc = read.Document;
                Assert.IsFalse(doc.HasMaterializedJson, demoId + ": Read must not eagerly materialize NormalizedJson");
                string streamedHash = StationDocumentReader.HashNormalizedEnvelope(doc);
                Assert.IsFalse(doc.HasMaterializedJson, demoId + ": HashEnvelope must not materialize NormalizedJson");
                Assert.IsNotEmpty(streamedHash);
                string expectedHash = StationDocumentReader.Hash(doc.NormalizedJson);
                Assert.IsTrue(doc.HasMaterializedJson);
                Assert.AreEqual(expectedHash, streamedHash, demoId + ": streamed envelope hash must match NormalizedJson SHA-256");
            }
        }

        [Test]
        public void StreamedCommitAndSaveEnvelopesMatchFullEnvelopesExactly() {
            var hostGo = new GameObject("StreamHost");
            hostGo.transform.SetParent(rootObject.transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(host, null);
            try {
                var zooJson = File.ReadAllText(DemoPath("zoo"));
                var openRes = host.OpenDocument(zooJson, "demo:zoo");
                Assert.IsTrue(openRes.Accepted);
                Assert.IsFalse(host.Document.HasMaterializedJson, "OpenDocument must not materialize NormalizedJson");

                var router = new StationCommandRouter(host);
                var cmd = new StationCommand {
                    SchemaVersion = StationCommandRouter.SchemaVersion,
                    Id = "cmd-open-1",
                    SessionId = "sess-1",
                    Type = "station.openDemo",
                };

                var chunks = new List<string>();
                Assert.IsTrue(router.TryStreamCommitEnvelope(cmd, openRes, chunks.Add), "TryStreamCommitEnvelope should stream");
                Assert.Greater(chunks.Count, 1, "zoo envelope should stream in multiple chunks");
                Assert.IsFalse(host.Document.HasMaterializedJson, "TryStreamCommitEnvelope must not materialize NormalizedJson");
                string streamedCommit = string.Concat(chunks);

                string fullCommit = router.FormatCommitOrReject(cmd, openRes);
                Assert.AreEqual(fullCommit, streamedCommit, "streamed commit envelope must match FormatCommitOrReject character-for-character");

                // Verify station.save includeDocument: true streaming produces valid ack with stamped document.
                var saveChunks = new List<string>();
                var saveCmd = new JObject {
                    ["schemaVersion"] = StationCommandRouter.SchemaVersion,
                    ["id"] = "cmd-save-1",
                    ["sessionId"] = "sess-1",
                    ["type"] = "station.save",
                    ["expectedRevision"] = host.CurrentRevision,
                    ["payload"] = new JObject { ["includeDocument"] = true },
                }.ToString(Newtonsoft.Json.Formatting.None);
                Assert.IsTrue(router.TryStreamDirectReply(saveCmd, saveChunks.Add), "station.save should stream");
                var saveEnv = JObject.Parse(string.Concat(saveChunks));
                Assert.AreEqual("ack", (string)saveEnv["kind"]);
                Assert.AreEqual("cmd-save-1", (string)saveEnv["id"]);
                Assert.AreEqual(host.CurrentSourceHash, (string)saveEnv["payload"]["sourceHash"]);
                var savedDocText = (string)saveEnv["payload"]["document"];
                Assert.IsNotEmpty(savedDocText);
                var reread = StationDocumentReader.Read(savedDocText, StationSource.None);
                Assert.AreEqual(host.Document.Cells.Count, reread.Document.Cells.Count);
                Assert.AreEqual(host.Document.Modules.Count, reread.Document.Modules.Count);
            } finally {
                UnityEngine.Object.DestroyImmediate(hostGo);
            }
        }

        [Test]
        public void DisplayArtworkReleaseScopeRemovesTvAndClockEntries() {
            var catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            var font = UnityEditor.AssetDatabase.LoadAssetAtPath<Font>("Assets/StationDesigner/Fonts/NotoSansSC.ttf");
            var assets = new StationViewAssets {
                Catalogue = catalogue,
                Shader = StationFinishLibrary.FindShader(),
                Font = font,
            };
            var read = StationDocumentReader.Read(File.ReadAllText(DemoPath("zoo")), new StationSource("demo:zoo", ""));
            var world = new StationWorldView(rootObject.transform, "DisplayScopeTest",
                new IStationViewRenderer[] { new StationDisplayModuleRenderer() }, assets);
            try {
                world.Build(read.Document, read.Index);
                world.Activate();
                var scope = world.Root.GetComponentInChildren<StationDisplayArtwork.Scope>(true);
                Assert.IsNotNull(scope, "zoo display build should create a StationDisplayArtwork.Scope");
                Assert.Greater(StationDisplayTvArtwork.EntriesFor(scope).Count, 0, "zoo should register TV entries");
                world.Dispose();
                Assert.AreEqual(0, StationDisplayTvArtwork.EntriesFor(scope).Count, "ReleaseScope must remove TV entries");
                Assert.AreEqual(0, StationClockArtwork.EntriesFor(scope).Count, "ReleaseScope must remove clock entries");
            } finally {
                if (!world.IsDisposed) world.Dispose();
            }
        }

        [Test]
        public void FullHostRepeatedDemoSwitchesReleasePreviousWorldsAndScopes() {
            var hostGo = new GameObject("FullHostLeakCheck");
            hostGo.transform.SetParent(rootObject.transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = StationFinishLibrary.FindShader();
            host.font = UnityEditor.AssetDatabase.LoadAssetAtPath<Font>("Assets/StationDesigner/Fonts/NotoSansSC.ttf");
            typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(host, null);
            StationViewFeature.Attach(host);
            try {
                (long live, WeakReference docRef, WeakReference worldRef, WeakReference signRef, WeakReference exitRef) Open(string label, string id) {
                    var json = File.ReadAllText(DemoPath(id));
                    var res = host.OpenDocument(json, id);
                    Assert.IsTrue(res.Accepted, id + " failed: " + res.Rejection?.Reason);
                    var signScope = host.Coordinator.World.Root.GetComponentInChildren<StationSignSignageScope>(true);
                    var exitScope = host.Coordinator.World.Root.GetComponentInChildren<StationExitArtworkScope>(true);
                    var refs = (
                        new WeakReference(res.Document),
                        new WeakReference(host.Coordinator.World),
                        new WeakReference(signScope),
                        new WeakReference(exitScope));
                    json = null;
                    res = null;
                    signScope = null;
                    exitScope = null;
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    GC.Collect();
                    long live = GC.GetTotalMemory(true);
                    Debug.Log($"[FullHostSlope] {label} ({id}) liveMiB={live / (1024.0 * 1024.0):F1}");
                    return (live, refs.Item1, refs.Item2, refs.Item3, refs.Item4);
                }

                var t1 = Open("1-tianhe", "tianhe");
                var z1 = Open("2-zoo", "zoo");
                var w1 = Open("3-tanwei", "tanwei");
                var t2 = Open("4-tianhe", "tianhe");
                var z2 = Open("5-zoo", "zoo");
                Debug.Log($"[FullHostSlope] t1 alive: doc={t1.docRef.IsAlive} world={t1.worldRef.IsAlive} sign={t1.signRef.IsAlive} exit={t1.exitRef.IsAlive}");
                Debug.Log($"[FullHostSlope] t2 alive: doc={t2.docRef.IsAlive} world={t2.worldRef.IsAlive} sign={t2.signRef.IsAlive} exit={t2.exitRef.IsAlive}");
                Assert.IsFalse(t1.docRef.IsAlive, "t1 Document leaked in full host");
                Assert.IsFalse(t1.worldRef.IsAlive, "t1 World leaked in full host");
                Assert.IsFalse(t2.docRef.IsAlive, "t2 Document leaked in full host");
                Assert.IsFalse(t2.worldRef.IsAlive, "t2 World leaked in full host");
                // Verify Detach unlinked replaced scopes so Previous chains never grow unbounded.
                var curSign = StationSignSignage.Scope;
                if (curSign != null) {
                    var prevSign = typeof(StationSignSignageScope).GetField("Previous", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(curSign);
                    Assert.IsNull(prevSign, "active sign scope must not retain disposed Previous chain");
                }
                var curExit = StationExitArtwork.Scope;
                if (curExit != null) {
                    var prevExit = typeof(StationExitArtworkScope).GetField("Previous", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(curExit);
                    Assert.IsNull(prevExit, "active exit scope must not retain disposed Previous chain");
                }
            } finally {
                UnityEngine.Object.DestroyImmediate(hostGo);
            }
        }

        [Test]
        public void YieldedOpenLowMemoryReplaceRollsBackCleanlyOnParseAndRenderFailure() {
            var coordinator = new StationLoadCoordinator(rootObject.transform);
            bool failNextBuild = false;
            var flaky = new ConditionalFailRenderer(() => failNextBuild);
            coordinator.RegisterRenderer(flaky);
            int restoredCount = 0;
            coordinator.WorldRestored += _ => restoredCount++;
            StationLoadCoordinator.LowMemoryReplaceRecordThresholdOverride = 1;
            try {
                StationLoadResult res1 = null;
                var e1 = coordinator.OpenYielded(TinySave(new JArray { Module("b1", "bench", 0, 0, 0) }), StationSource.None, "st-a", r => res1 = r);
                while (e1.MoveNext()) { }
                Assert.IsTrue(res1.Accepted);
                Assert.AreEqual(1, coordinator.Revision);

                // Parse failure under low-memory replace must restore visual world at revision 1.
                StationLoadResult badParse = null;
                var eBad = coordinator.OpenYielded("{not valid json", StationSource.None, "bad", r => badParse = r);
                while (eBad.MoveNext()) { }
                Assert.IsFalse(badParse.Accepted);
                Assert.AreEqual("parse-failed", badParse.Rejection.Code);
                Assert.AreEqual(1, coordinator.Revision);
                Assert.IsNotNull(coordinator.World);
                Assert.IsFalse(coordinator.World.IsDisposed);
                Assert.AreEqual(1, restoredCount);

                // Render failure under low-memory replace must restore visual world at revision 1.
                failNextBuild = true;
                StationLoadResult badRender = null;
                var eFail = coordinator.OpenYielded(TinySave(new JArray { Module("b2", "bench", 1, 0, 0) }), StationSource.None, "st-b", r => badRender = r);
                while (eFail.MoveNext()) { }
                Assert.IsFalse(badRender.Accepted);
                Assert.AreEqual("render-failed", badRender.Rejection.Code);
                Assert.AreEqual(1, coordinator.Revision);
                Assert.IsNotNull(coordinator.World);
                Assert.IsFalse(coordinator.World.IsDisposed);
                Assert.AreEqual("st-a", coordinator.SourceId);
                Assert.AreEqual(2, restoredCount);
            } finally {
                StationLoadCoordinator.LowMemoryReplaceRecordThresholdOverride = null;
                coordinator.Dispose();
            }
        }

        sealed class ConditionalFailRenderer : IStationViewRenderer {
            readonly Func<bool> shouldFail;
            public ConditionalFailRenderer(Func<bool> shouldFail) => this.shouldFail = shouldFail;
            public string Role => "flaky";
            public void Build(StationViewBuildContext context) {
                if (!failTriggered && shouldFail()) {
                    // Fail only once so the rollback rebuild of the previous station succeeds.
                    failTriggered = true;
                    throw new InvalidOperationException("injected renderer failure");
                }
            }
            bool failTriggered;
            public void Release() { }
        }
    }
}
