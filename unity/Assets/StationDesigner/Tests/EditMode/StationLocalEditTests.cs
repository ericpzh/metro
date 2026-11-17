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
    /// Plan 30 §3/§4: the **local** edit path must be indistinguishable from the complete
    /// envelope path. For real Zoo and Tanwei patches this fixture applies the same patch twice —
    /// once through <see cref="StationCellEdits"/> + <see cref="StationDocumentReader"/> (the full
    /// read) and once through <see cref="StationLocalEdit"/> — and asserts the normalized
    /// envelope, every cell record, every module id/fact, every index lookup and the diagnostics
    /// agree. It also pins that a record a load-time repair owns, a duplicated coordinate, a line
    /// add and an off-grid record are refused locally (so the caller falls back) instead of being
    /// projected by guesswork, and that a local edit through the host session is exactly one
    /// revision and one undo frame.
    /// </summary>
    public sealed class StationLocalEditTests {
        static string DataRoot => Application.dataPath;
        static string DemoPath(string id) => Path.Combine(DataRoot, "StationDesigner/Demos", id + ".metro.json");

        static readonly Dictionary<string, StationReadResult> fixtures = new Dictionary<string, StationReadResult>(StringComparer.Ordinal);

        /// <summary>The fixture's committed read result; shared because it is immutable.</summary>
        static StationReadResult Fixture(string id) {
            if (!fixtures.TryGetValue(id, out var read)) {
                read = StationDocumentReader.ReadFile(DemoPath(id));
                fixtures.Add(id, read);
            }
            return read;
        }

        static readonly string[] Demos = { "zoo", "tanwei" };

        // ------------------------------------------------------------ the patch set

        /// <summary>A key on open air, advanced off any saved record like the performance probes do.</summary>
        static StationCellKey EmptyCell(StationDocument document) {
            var key = new StationCellKey(42, 37, -12);
            while (FindCell(document, key) != null) key = new StationCellKey(key.X + 1, key.Y, key.Z);
            return key;
        }

        static StationCellRecord FindCell(StationDocument document, StationCellKey key) {
            for (int i = 0; i < document.CellCount; i++) if (document.Cells[i].Key == key) return document.Cells[i];
            return null;
        }

        static readonly (string Face, int X, int Y)[] Faces = {
            ("e", 1, 0), ("w", -1, 0), ("n", 0, 1), ("s", 0, -1),
        };

        /// <summary>
        /// A coordinate at the open side of an authored face finish: writing a solid block beside
        /// it is the patch whose answer depends on the cell repair, not just on the write.
        /// </summary>
        static bool TryOpenFinishedFace(StationIndex index, out StationCellKey target) {
            target = default;
            foreach (var cell in index.Document.Cells) {
                foreach (var face in Faces) {
                    if (string.IsNullOrEmpty(cell.FinishOf(face.Face))) continue;
                    var at = new StationCellKey(cell.X + face.X, cell.Y + face.Y, cell.Z);
                    if (index.GetCell(at) != null) continue;
                    target = at;
                    return true;
                }
            }
            return false;
        }

        static StationModuleRecord FirstModule(StationIndex index, string type) {
            var modules = index.ModulesOfType(type);
            return modules.Count > 0 ? modules[0] : null;
        }

        sealed class PatchCase {
            public string Name;
            public Func<StationCellPatch> Build;
        }

        static List<PatchCase> CellCases(StationReadResult read) {
            var document = read.Document;
            var empty = EmptyCell(document);
            var cases = new List<PatchCase> {
                new PatchCase {
                    Name = "place block",
                    Build = () => Set(empty, false),
                },
                new PatchCase {
                    Name = "delete block",
                    Build = () => Drop(empty),
                },
                new PatchCase {
                    Name = "dig void",
                    Build = () => Set(empty, true),
                },
            };
            var solid = FirstSolid(document);
            if (solid != null) {
                var key = solid.Key;
                cases.Add(new PatchCase {
                    Name = "append tag",
                    Build = () => { var patch = new StationCellPatch(); patch.Add(StationCellWrite.AddTags(key, new[] { "painted-ground" })); return patch; },
                });
                cases.Add(new PatchCase {
                    Name = "label zone",
                    Build = () => { var patch = new StationCellPatch(); patch.Add(StationCellWrite.Labels(key, "paid", null)); return patch; },
                });
                cases.Add(new PatchCase {
                    Name = "label room",
                    Build = () => { var patch = new StationCellPatch(); patch.Add(StationCellWrite.Labels(key, null, "office")); return patch; },
                });
                cases.Add(new PatchCase {
                    Name = "erase solid",
                    Build = () => Drop(key),
                });
            }
            if (TryOpenFinishedFace(read.Index, out var face)) {
                cases.Add(new PatchCase {
                    Name = "block beside a finished face",
                    Build = () => Set(face, false),
                });
            }
            return cases;
        }

        static StationCellPatch Set(StationCellKey key, bool isVoid) {
            var patch = new StationCellPatch();
            patch.Add(StationCellWrite.Set(key, isVoid));
            return patch;
        }

        static StationCellPatch Drop(StationCellKey key) {
            var patch = new StationCellPatch();
            patch.Add(StationCellWrite.Drop(key));
            return patch;
        }

        static StationCellRecord FirstSolid(StationDocument document) {
            for (int i = 0; i < document.CellCount; i++) if (document.Cells[i].IsSolid) return document.Cells[i];
            return null;
        }

        static List<PatchCase> ModuleCases(StationReadResult read) {
            var cases = new List<PatchCase>();
            var bench = FirstModule(read.Index, "bench");
            if (bench != null) {
                var at = Key(bench);
                cases.Add(new PatchCase {
                    Name = "add module",
                    Build = () => {
                        var patch = new StationCellPatch();
                        patch.AddModule(Draft("local-test-bench", "bench", at.X, at.Y, at.Z, "variant", "steel-1"));
                        return patch;
                    },
                });
                cases.Add(new PatchCase {
                    Name = "replace module",
                    Build = () => {
                        var patch = new StationCellPatch();
                        var draft = Draft(bench.Id, bench.Type, bench.X, bench.Y, bench.Z, "variant", bench.Config.Text("variant"));
                        draft.SourceId = bench.Id;
                        patch.ReplaceModule(draft);
                        return patch;
                    },
                });
                cases.Add(new PatchCase {
                    Name = "remove module",
                    Build = () => { var patch = new StationCellPatch(); patch.RemoveModuleIds.Add(bench.Id); return patch; },
                });
            }
            var tv = FirstModule(read.Index, "tv");
            if (tv != null) {
                cases.Add(new PatchCase {
                    Name = "remove screen",
                    Build = () => { var patch = new StationCellPatch(); patch.RemoveModuleIds.Add(tv.Id); return patch; },
                });
            }
            var fence = FirstModule(read.Index, "fence");
            if (fence != null) {
                cases.Add(new PatchCase {
                    Name = "remove fence",
                    Build = () => { var patch = new StationCellPatch(); patch.RemoveModuleIds.Add(fence.Id); return patch; },
                });
            }
            return cases;
        }

        static StationEditDraft Draft(string id, string type, int x, int y, int z, string key, string value) {
            var draft = new StationEditDraft { Id = id, Type = type, X = x, Y = y, Z = z, Rotation = 0, Width = 1, Depth = 1 };
            if (!string.IsNullOrEmpty(value)) draft.Set(key, value);
            return draft;
        }

        static StationCellKey Key(StationModuleRecord module) => new StationCellKey(module.X, module.Y, module.Z);

        // -------------------------------------------------------------- equivalence

        [Test]
        public void CellPatchesProjectTheSameDocumentAsAFullRead() {
            foreach (var demo in Demos) {
                var committed = Fixture(demo);
                var cases = CellCases(committed);
                Assert.Greater(cases.Count, 3, demo + ": the fixture must exercise several cell patch shapes");
                foreach (var patchCase in cases) AssertPatchEquivalence(demo, committed, patchCase);
            }
        }

        [Test]
        public void ModulePatchesProjectTheSameDocumentAsAFullRead() {
            foreach (var demo in Demos) {
                var committed = Fixture(demo);
                var cases = ModuleCases(committed);
                Assert.Greater(cases.Count, 1, demo + ": the fixture must exercise a module patch");
                foreach (var patchCase in cases) AssertPatchEquivalence(demo, committed, patchCase);
            }
        }

        void AssertPatchEquivalence(string demo, StationReadResult committed, PatchCase patchCase) {
            var patch = patchCase.Build();
            var label = demo + " / " + patchCase.Name;

            // (a) the full read path: the complete envelope text is patched and re-read.
            var before = StationDocumentReader.Write(committed.Document, DateTimeOffset.UtcNow);
            var next = StationCellEdits.Apply(before, patch, out var patchCode);
            Assert.IsNotNull(next, label + ": the full path patches the envelope (" + patchCode + ")");
            var full = StationDocumentReader.Read(next, new StationSource("fixture", ""));

            // (b) the local path: the committed document and index plus the same patch.
            var local = StationLocalEdit.TryApplyCells(committed, patch, "fixture", out var localCode);
            Assert.IsNotNull(local, label + ": the local path accepts a whitelisted patch (" + localCode + ")");

            AssertSameDocument(full.Document, local.Document, label);
            AssertSameLookups(full.Index, local.Index, patch, label);
        }

        /// <summary>The normalized envelope, every record and the size of the station.</summary>
        static void AssertSameDocument(StationDocument expected, StationDocument actual, string label) {
            // `savedAt` is the wall clock the edit happened at; everything else is the document.
            var expectedJson = Canonical(expected.NormalizedJson);
            var actualJson = Canonical(actual.NormalizedJson);
            if (!string.Equals(expectedJson, actualJson, StringComparison.Ordinal)) {
                Assert.Fail(label + ": normalized envelope differs\nfirst difference: " + FirstDifference(expectedJson, actualJson));
            }
            Assert.AreEqual(expected.Name, actual.Name, label + ": name");
            Assert.AreEqual(expected.NameEn, actual.NameEn, label + ": nameEn");
            Assert.AreEqual(expected.City, actual.City, label + ": city");
            Assert.AreEqual(expected.Seed, actual.Seed, label + ": seed");
            Assert.AreEqual(expected.LevelBase, actual.LevelBase, label + ": levelBase");
            Assert.AreEqual(expected.StoreyHeight, actual.StoreyHeight, label + ": storeyHeight");
            Assert.AreEqual(expected.DroppedCells, actual.DroppedCells, label + ": dropped cells");
            Assert.AreEqual(expected.DroppedModules, actual.DroppedModules, label + ": dropped modules");
            AssertDay(expected.Day, actual.Day, label);
            Assert.AreEqual(expected.CellCount, actual.CellCount, label + ": cell count");
            for (int i = 0; i < expected.CellCount; i++) {
                var a = expected.Cells[i];
                var b = actual.Cells[i];
                if (!SameCell(a, b)) Assert.Fail(label + ": cell #" + i + " differs (" + Describe(a) + " vs " + Describe(b) + ")");
            }
            Assert.AreEqual(expected.ModuleCount, actual.ModuleCount, label + ": module count");
            for (int i = 0; i < expected.ModuleCount; i++) {
                var a = expected.Modules[i];
                var b = actual.Modules[i];
                var caseLabel = label + ": module #" + i + " (" + a.Id + ")";
                Assert.AreEqual(a.Id, b.Id, caseLabel + " id");
                Assert.AreEqual(a.Type, b.Type, caseLabel + " type");
                Assert.AreEqual(a.X, b.X, caseLabel + " x");
                Assert.AreEqual(a.Y, b.Y, caseLabel + " y");
                Assert.AreEqual(a.Z, b.Z, caseLabel + " z");
                Assert.AreEqual(a.ExactZ, b.ExactZ, 1e-12, caseLabel + " exact z");
                Assert.AreEqual(a.Rotation, b.Rotation, caseLabel + " rot");
                Assert.AreEqual(a.Width, b.Width, caseLabel + " width");
                Assert.AreEqual(a.Depth, b.Depth, caseLabel + " depth");
                Assert.AreEqual(a.Height, b.Height, caseLabel + " height");
                Assert.AreEqual(a.PanelHeight, b.PanelHeight, 1e-12, caseLabel + " panel height");
                Assert.AreEqual(a.OffsetX, b.OffsetX, 1e-12, caseLabel + " offset x");
                Assert.AreEqual(a.OffsetY, b.OffsetY, 1e-12, caseLabel + " offset y");
                Assert.AreEqual(a.CeilingAnchored, b.CeilingAnchored, caseLabel + " ceiling");
                Assert.AreEqual(a.From, b.From, caseLabel + " from");
                Assert.AreEqual(a.To, b.To, caseLabel + " to");
                CollectionAssert.AreEqual(a.Tags, b.Tags, caseLabel + " tags");
                Assert.AreEqual(a.RawJson, b.RawJson, caseLabel + " raw record");
                Assert.AreEqual(a.Facts.Config.Count, b.Facts.Config.Count, caseLabel + " cfg count");
                foreach (var key in a.Facts.Config.Keys) {
                    Assert.AreEqual(a.Facts.Config.Text(key), b.Facts.Config.Text(key), caseLabel + " cfg." + key);
                }
            }
            Assert.AreEqual(expected.LineCount, actual.LineCount, label + ": line count");
            for (int i = 0; i < expected.LineCount; i++) {
                Assert.AreEqual(expected.Lines[i].RawJson, actual.Lines[i].RawJson, label + ": line #" + i + " raw record");
            }
        }

        static string Describe(StationCellRecord cell) => cell == null ? "absent" : cell.ToString() + " " + cell.RawJson;

        static bool SameCell(StationCellRecord a, StationCellRecord b) {
            if (a == null || b == null) return a == null && b == null;
            return a.X == b.X && a.Y == b.Y && a.Z == b.Z &&
                   string.Equals(a.Shape, b.Shape, StringComparison.Ordinal) &&
                   string.Equals(a.Fill, b.Fill, StringComparison.Ordinal) &&
                   string.Equals(a.Zone, b.Zone, StringComparison.Ordinal) &&
                   string.Equals(a.Room, b.Room, StringComparison.Ordinal) &&
                   SameStrings(a.Tags, b.Tags) &&
                   string.Equals(a.RawJson, b.RawJson, StringComparison.Ordinal);
        }

        static bool SameStrings(IReadOnlyList<string> a, IReadOnlyList<string> b) {
            if (a == null || b == null) return a == null && b == null;
            if (a.Count != b.Count) return false;
            for (int i = 0; i < a.Count; i++) if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            return true;
        }

        /// <summary>Every lookup a consumer can make, plus the diagnostics the index reports.</summary>
        static void AssertSameLookups(StationIndex expected, StationIndex actual, StationCellPatch patch, string label) {
            Assert.AreEqual(expected.CellCount, actual.CellCount, label + ": indexed cells");
            Assert.AreEqual(expected.ModuleCount, actual.ModuleCount, label + ": indexed modules");
            CollectionAssert.AreEqual(expected.Levels.ToArray(), actual.Levels.ToArray(), label + ": levels");
            Assert.AreEqual(expected.Bounds.ToString(), actual.Bounds.ToString(), label + ": bounds");
            Assert.AreEqual(expected.Lines.Count, actual.Lines.Count, label + ": lines");
            for (int i = 0; i < expected.Lines.Count; i++) {
                var line = expected.Lines[i];
                Assert.AreEqual(line.RawJson, actual.Lines[i].RawJson, label + ": line " + line.Id);
                var expectedTracks = expected.TracksOfLine(line.Id).Select(m => m.Id).OrderBy(id => id, StringComparer.Ordinal).ToArray();
                var actualTracks = actual.TracksOfLine(line.Id).Select(m => m.Id).OrderBy(id => id, StringComparer.Ordinal).ToArray();
                CollectionAssert.AreEqual(expectedTracks, actualTracks, label + ": tracks of " + line.Id);
            }
            // Every coordinate the patch named and the ring the cell repair can cover.
            foreach (var write in patch.Writes) {
                var key = write.Key;
                if (!SameCell(expected.GetCell(key), actual.GetCell(key))) {
                    Assert.Fail(label + ": cell lookup at " + key + " differs");
                }
                foreach (var step in Neighbours) {
                    var at = new StationCellKey(key.X + step.X, key.Y + step.Y, key.Z + step.Z);
                    if (!SameCell(expected.GetCell(at), actual.GetCell(at))) Assert.Fail(label + ": cell lookup at " + at + " differs");
                }
            }
            // Every module id the patch named, plus every id the station carries.
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var draft in patch.ModuleAdds) if (draft != null) ids.Add(draft.Id);
            foreach (var draft in patch.ModuleReplaces) if (draft != null) ids.Add(draft.Id);
            foreach (var id in patch.RemoveModuleIds) ids.Add(id);
            foreach (var module in expected.Document.Modules) ids.Add(module.Id);
            foreach (var id in ids) {
                var a = expected.GetModule(id);
                var b = actual.GetModule(id);
                if (a == null || b == null) {
                    Assert.AreEqual(a == null, b == null, label + ": module lookup " + id);
                    continue;
                }
                Assert.AreEqual(a.RawJson, b.RawJson, label + ": module lookup " + id);
            }
            foreach (var type in expected.Document.Modules.Select(m => m.Type).Distinct(StringComparer.Ordinal)) {
                Assert.AreEqual(expected.CountOfType(type), actual.CountOfType(type), label + ": count of " + type);
            }
            var expectedDiagnostics = expected.Diagnostics.Select(d => d.Code + "|" + d.RecordType + "|" + d.RecordId)
                .OrderBy(s => s, StringComparer.Ordinal).ToArray();
            var actualDiagnostics = actual.Diagnostics.Select(d => d.Code + "|" + d.RecordType + "|" + d.RecordId)
                .OrderBy(s => s, StringComparer.Ordinal).ToArray();
            CollectionAssert.AreEqual(expectedDiagnostics, actualDiagnostics, label + ": diagnostics");
        }

        static readonly (int X, int Y, int Z)[] Neighbours = {
            (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
        };

        static void AssertDay(StationDay expected, StationDay actual, string label) {
            Assert.AreEqual(expected.Service.ToString(), actual.Service.ToString(), label + ": service");
            Assert.AreEqual(expected.MorningPeak.ToString(), actual.MorningPeak.ToString(), label + ": morning peak");
            Assert.AreEqual(expected.EveningPeak.ToString(), actual.EveningPeak.ToString(), label + ": evening peak");
            Assert.AreEqual(expected.Workday.AmPeak, actual.Workday.AmPeak, 1e-12, label + ": workday am");
            Assert.AreEqual(expected.Offday.AmPeak, actual.Offday.AmPeak, 1e-12, label + ": offday am");
            Assert.AreEqual(expected.EpochYear, actual.EpochYear, label + ": epoch year");
            Assert.AreEqual(expected.EpochMonth, actual.EpochMonth, label + ": epoch month");
            Assert.AreEqual(expected.EpochDay, actual.EpochDay, label + ": epoch day");
            CollectionAssert.AreEqual(expected.Holidays, actual.Holidays, label + ": holidays");
        }

        /// <summary>The envelope text with only the wall-clock stamp normalised away.</summary>
        static string Canonical(string json) {
            var envelope = JObject.Parse(json);
            envelope["savedAt"] = StationDocumentReader.FixedSavedAt;
            return envelope.ToString(Newtonsoft.Json.Formatting.None);
        }

        static string FirstDifference(string expected, string actual) {
            int limit = Math.Min(expected.Length, actual.Length);
            for (int i = 0; i < limit; i++) {
                if (expected[i] == actual[i]) continue;
                int from = Math.Max(0, i - 60);
                int length = Math.Min(160, limit - from);
                return "at " + i + " expected «" + expected.Substring(from, length) + "» actual «" + actual.Substring(from, length) + "»";
            }
            return expected.Length == actual.Length ? "none" : "length " + expected.Length + " vs " + actual.Length;
        }

        // ----------------------------------------------------------------- refusals

        [Test]
        public void TheLocalPathRefusesARecordALoadTimeRepairOwns() {
            var tanwei = Fixture("tanwei");
            var bridge = tanwei.Index.ModulesOfType("track").FirstOrDefault(m => m.Config.Bool("bridge"));
            Assert.IsNotNull(bridge, "the Tanwei fixture carries a bridge track");
            Assert.AreEqual("local-bridge-pillars", Refusal(tanwei, () => Remove(bridge.Id)), "bridge track");

            var pillar = tanwei.Index.ModulesOfType("pillar").FirstOrDefault(m => m.Config.Text("bridgeId").Length > 0);
            Assert.IsNotNull(pillar, "the Tanwei fixture carries a bridge-owned pillar");
            Assert.AreEqual("local-bridge-pillars", Refusal(tanwei, () => Remove(pillar.Id)), "bridge pillar");

            var sign = tanwei.Index.ModulesOfType("sign").FirstOrDefault();
            Assert.IsNotNull(sign, "the Tanwei fixture carries a sign");
            Assert.AreEqual("local-sign-repair", Refusal(tanwei, () => Remove(sign.Id)), "sign");

            // A fresh screen without a poster would gain one on the next full read.
            var unpostered = new StationEditDraft { Id = "local-test-tv", Type = "tv", X = 1, Y = 1, Z = 0, Rotation = 0 };
            Assert.AreEqual("local-ad-poster", Refusal(tanwei, () => {
                var patch = new StationCellPatch();
                patch.AddModule(unpostered);
                return patch;
            }), "unpostered screen");

            // An off-grid record is one the grid repair drops, so only the full read can say so.
            var offGrid = new StationEditDraft { Id = "local-test-stair", Type = "stair", X = 1, Y = 1, Z = 0, Rotation = 0 };
            offGrid.From = new StationPoint(1.5, 1, 0);
            offGrid.To = new StationPoint(4.5, 1, 5);
            Assert.AreEqual("local-off-grid", Refusal(tanwei, () => {
                var patch = new StationCellPatch();
                patch.AddModule(offGrid);
                return patch;
            }), "off-grid module");
        }

        static StationCellPatch Remove(string id) {
            var patch = new StationCellPatch();
            patch.RemoveModuleIds.Add(id);
            return patch;
        }

        [Test]
        public void TheLocalPathRefusesAPatchTheCommittedDocumentCannotSatisfy() {
            var zoo = Fixture("zoo");
            // A line record is repaired on the way in and is never a local write.
            Assert.AreEqual("local-line-adds", Refusal(zoo, () => {
                var patch = new StationCellPatch();
                patch.AddLine(new StationLineDraft { Id = "99", Name = "local", Colour = "#123456" });
                return patch;
            }), "line add");

            // A coordinate two saved records share is not a one-record delta.
            var duplicated = DuplicatedCoordinate(zoo.Document);
            if (duplicated.HasValue) {
                Assert.AreEqual("local-duplicate-cell", Refusal(zoo, () => Set(duplicated.Value, false)), "duplicated coordinate");
            }

            // The refusals are only fallbacks: the full path still takes the same patch.
            var linePatch = new StationCellPatch();
            linePatch.AddLine(new StationLineDraft { Id = "99", Name = "local", Colour = "#123456" });
            var text = StationCellEdits.Apply(StationDocumentReader.Write(zoo.Document, DateTimeOffset.UtcNow), linePatch, out var code);
            Assert.IsNotNull(text, "the full path adds a line: " + code);
            Assert.IsNull(StationLocalEdit.TryApplyCells(zoo, linePatch, "fixture", out code), "and the local path refuses it");
            Assert.AreEqual("local-line-adds", code);
        }

        static StationCellKey? DuplicatedCoordinate(StationDocument document) {
            var seen = new HashSet<StationCellKey>();
            for (int i = 0; i < document.CellCount; i++) {
                if (!seen.Add(document.Cells[i].Key)) return document.Cells[i].Key;
            }
            return null;
        }

        static string Refusal(StationReadResult committed, Func<StationCellPatch> build) {
            Assert.IsNull(StationLocalEdit.TryApplyCells(committed, build(), "fixture", out var code), "the local path must refuse");
            return code;
        }

        // ------------------------------------------------- revision / undo / redo

        sealed class PassiveSimulation : IStationSimulationHost {
            public void StageInstall(StationDocument document, StationIndex index, bool isEdit = false,
                Metro.Sim.StationDocumentEditKind? editKind = null) { }
            public void CommitInstall() { }
            public void AbortInstall() { }
            public void Tick(double realSeconds) { }
            public void Release() { }
            public bool Playing => false;
            public int Speed => 1;
            public double SimTimeSeconds => 0;
            public long SimulationTick => 0;
            public double PresentationFraction => 0;
            public long PresentationEpoch => 0;
            public string ClockPayloadJson() => "{}";
            public string CapabilitiesPayloadJson() => "";
        }

        GameObject hostObject;
        StationGameHost host;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
        }

        [TearDown]
        public void TearDown() {
            StationEditHost.ResetForTests();
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        void OpenFixture(string demo) {
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            host.SetSimulationHost(new PassiveSimulation());
            var opened = host.OpenDocument(File.ReadAllText(DemoPath(demo)), demo);
            Assert.IsTrue(opened.Accepted, opened.ToString());
        }

        [Test]
        public void ALocalFixtureEditIsOneRevisionOneUndoFrameAndRedo() {
            OpenFixture("zoo");
            var key = EmptyCell(host.Document);
            int revision = host.CurrentRevision;

            Assert.IsTrue(StationEditSession.TryApplyCells(host, Set(key, false), "place", null, out _, out var code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision, "one local edit, one revision");
            Assert.AreEqual(1, StationEditSession.LocalEdits, "the edit installed through the local path");
            Assert.AreEqual(0, StationEditSession.FullEdits, "and never re-read the whole station");
            Assert.IsTrue(host.Index.GetCell(key)?.IsSolid == true, "the committed index has the block");
            Assert.AreEqual(1, UndoDepth(), "one undo frame");

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.AreEqual(revision + 2, host.CurrentRevision, "undo is one more revision");
            Assert.IsNull(host.Index.GetCell(key), "undo removed the block");
            Assert.AreEqual(1, RedoDepth(), "redo is armed");

            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.AreEqual(revision + 3, host.CurrentRevision);
            Assert.IsTrue(host.Index.GetCell(key)?.IsSolid == true, "redo re-applied the block");

            // The committed document is always a complete, re-openable envelope.
            var reopened = StationDocumentReader.Read(host.SaveDocument(), StationSource.None);
            Assert.IsTrue(reopened.Index.GetCell(key)?.IsSolid == true, "the saved envelope reopens with the block");
            Assert.AreEqual(host.Document.CellCount, reopened.Document.CellCount, "and is the same station");
        }

        [Test]
        public void ALocalModuleEditThroughTheSessionIsOneRevisionAndUndoes() {
            OpenFixture("zoo");
            var bench = FirstModule(host.Index, "bench");
            Assert.IsNotNull(bench, "the fixture carries a bench");
            int revision = host.CurrentRevision;
            var draft = Draft("local-test-bench", "bench", bench.X, bench.Y, bench.Z, "variant", "steel-1");
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", null,
                out _, out var code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            Assert.AreEqual(1, StationEditSession.LocalEdits, "the module edit installed through the local path");
            Assert.IsNotNull(host.Index.GetModule("local-test-bench"), "the committed index has the piece");
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsNull(host.Index.GetModule("local-test-bench"), "undo removed it again");
        }

        [Test]
        public void HistoryStaysBoundedAndNeverCrossesStations() {
            OpenFixture("zoo");
            var key = EmptyCell(host.Document);
            for (int i = 0; i < StationEditSession.MaxHistory + 4; i++) {
                var patch = i % 2 == 0 ? Set(key, false) : Drop(key);
                Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, "place", null, out _, out var code), code);
            }
            Assert.AreEqual(StationEditSession.MaxHistory, UndoDepth(), "the undo stack is capped");
            // A station switch makes the old frames meaningless: the next undo drops them.
            var opened = host.OpenDocument(File.ReadAllText(DemoPath("zoo")), "another-station");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            Assert.IsFalse(StationEditSession.TryUndo(host, out _, out var undoCode), "no frame may cross a station");
            Assert.AreEqual("no-history", undoCode);
            Assert.AreEqual(0, UndoDepth(), "the stale frames are gone");
        }

        static int UndoDepth() => (int)(StationEditSession.ToJson()["undoDepth"] ?? 0);
        static int RedoDepth() => (int)(StationEditSession.ToJson()["redoDepth"] ?? 0);
    }
}
