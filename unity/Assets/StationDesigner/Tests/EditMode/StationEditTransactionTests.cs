using System;
using System.IO;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 16 §1.4: the pure candidate resolver must answer exactly what the TypeScript
    /// source answers for the same pick. The fixture is recorded from the shipping game
    /// by <c>tools/unity-parity/record-station-edit-trace.mjs</c>
    /// (<c>pickCells</c> → <c>moduleAim</c> → <c>createModule</c> → <c>equipmentReason</c>,
    /// and <c>moveCandidate</c> for a carried piece), against the same exported Zoo save
    /// the Unity reader opens.
    ///
    /// The migrated families are bench, fence, tactile, floor-mark and the one-cell
    /// street furniture rows; the floor-mark's doorway snap is ported with the PSD
    /// packet, so the fixture records the **pre-snap** candidate both engines build.
    /// </summary>
    public sealed class StationEditResolverTests {
        static string DataRoot => Application.dataPath;
        static string OraclePath => Path.Combine(DataRoot, "StationDesigner/Tests/EditMode/station-edit-oracle.json");
        static string DemoPath => Path.Combine(DataRoot, "StationDesigner/Demos/zoo.metro.json");

        static JObject oracle;
        static StationDocument document;
        static StationIndex index;

        [SetUp]
        public void SetUp() {
            StationToolsReset();
            if (oracle == null) oracle = JObject.Parse(File.ReadAllText(OraclePath));
            if (document == null) {
                var read = StationDocumentReader.ReadFile(DemoPath);
                document = read.Document;
                Assert.IsTrue(StationIndex.TryCreate(document, out index, out var rejection), rejection?.ToString() ?? "");
            }
            StationEditSession.Reset();
        }

        [TearDown]
        public void TearDown() => StationToolsReset();

        static void StationToolsReset() {
            StationToolSelection.Reset();
            StationEditSession.Reset();
        }

        static StationPlacementHit Hit(JObject row) {
            var hit = (JObject)row["hit"];
            var cell = (JArray)hit["cell"];
            var place = (JArray)hit["place"];
            var point = (JArray)hit["point"];
            return new StationPlacementHit(
                (int)cell[0], (int)cell[1], (int)cell[2],
                (int)place[0], (int)place[1], (int)place[2], true,
                new StationPoint((double)point[0], (double)point[1], (double)point[2]),
                (int)cell[2] + 1);
        }

        static StationPlacementRequest Request(JObject row) => new StationPlacementRequest {
            ToolType = (string)row["paletteId"],
            Rotation = (int)row["rotation"],
            Hit = Hit(row),
        };

        [Test]
        public void FreshPlacementCandidatesAndVerdictsMatchTheTypeScriptGame() {
            var rows = (JArray)oracle["placements"];
            Assert.Greater(rows.Count, 0, "the oracle must record at least one placement");
            int compared = 0;
            foreach (var token in rows) {
                var row = (JObject)token;
                var request = Request(row);
                var plan = StationModulePlacement.Resolve(index, request);
                var expected = (JObject)row["candidate"];
                var label = (string)row["paletteId"] + " at " + string.Join(",", (JArray)row["aim"]) +
                    " [tool=" + request.ToolType + " variant=" + request.Variant + " reqW=" + request.Width +
                    " cand=" + (plan.Candidate == null ? "null" : plan.Candidate.Type + "/" + plan.Candidate.Text("variant")) + "]";
                Assert.IsNotNull(plan.Candidate, label + " must produce a candidate");
                Assert.AreEqual((string)expected["type"], plan.Candidate.Type, label + ": type");
                Assert.AreEqual((int)expected["x"], plan.Candidate.X, label + ": x");
                Assert.AreEqual((int)expected["y"], plan.Candidate.Y, label + ": y");
                Assert.AreEqual((int)expected["z"], plan.Candidate.Z, label + ": z");
                Assert.AreEqual((int)expected["rot"], StationFootprints.NormRot(plan.Candidate.Rotation), label + ": rot");
                Assert.AreEqual((int)expected["w"], plan.Candidate.Width, label + ": width");
                Assert.AreEqual((string)row["reason"], plan.Reason, label + ": verdict");
                var expectedColliders = ((JArray)row["colliders"]).ToObject<string[]>();
                CollectionAssert.AreEquivalent(expectedColliders, plan.ColliderIds, label + ": colliders");
                compared++;
            }
            Assert.Greater(compared, 0);
            var source = (JObject)oracle["source"];
            Assert.AreEqual(document.ModuleCount, (int)source["modules"], "fixture and document are the same station");
        }

        [Test]
        public void CarriedPieceMovesMatchTheTypeScriptGame() {
            var rows = (JArray)oracle["moves"];
            Assert.Greater(rows.Count, 0);
            foreach (var token in rows) {
                var row = (JObject)token;
                var id = (string)row["moduleId"];
                Assert.IsTrue(index.TryGetModule(id, out var module), "carried module " + id);
                var at = (JArray)row["at"];
                var hit = new StationPlacementHit((int)at[0], (int)at[1], (int)at[2],
                    (int)at[0], (int)at[1], (int)at[2], true,
                    new StationPoint((int)at[0] + 0.5, (int)at[1] + 0.5, (int)at[2] + 1), (int)at[2] + 1);
                var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                    Carried = module,
                    Rotation = (int)row["rotation"],
                    Hit = hit,
                });
                var expected = (JObject)row["candidate"];
                var label = id + " → " + string.Join(",", (JArray)row["at"]);
                Assert.IsNotNull(plan.Candidate, label);
                Assert.AreEqual((int)expected["x"], plan.Candidate.X, label + ": x");
                Assert.AreEqual((int)expected["y"], plan.Candidate.Y, label + ": y");
                Assert.AreEqual((int)expected["z"], plan.Candidate.Z, label + ": z");
                Assert.AreEqual((int)expected["rot"], StationFootprints.NormRot(plan.Candidate.Rotation), label + ": rot");
                Assert.AreEqual((string)row["reason"], plan.Reason, label + ": verdict");
                Assert.AreEqual(module.Id, plan.Candidate.SourceId, label + ": the carried identity is kept");
            }
        }

        [Test]
        public void EyedropperPaletteIdsMatchTheTypeScriptMapping() {
            foreach (var token in (JArray)oracle["picks"]) {
                var row = (JObject)token;
                Assert.IsTrue(index.TryGetModule((string)row["moduleId"], out var module));
                Assert.AreEqual((string)row["paletteId"], StationModulePick.PaletteIdFor(module),
                    "palette id for " + (string)row["moduleId"]);
            }
        }

        [Test]
        public void UnsupportedFamiliesAreRefusedBeforeACommitCanSeeThem() {
            // A 自动步道 is still outside the ported families (plan 16 §5 has since added the
            // head-house and the straight stair/escalator pair, whose candidate construction
            // the exit snaps need).
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "walkway",
                Rotation = 0,
                Hit = new StationPlacementHit(0, 0, 0, 0, 0, 1, true, new StationPoint(0.5, 0.5, 1), 1),
            });
            Assert.AreEqual("unsupported-family", plan.Reason);
            Assert.IsNull(plan.Candidate, "no candidate is invented for a family the port has not reached");
        }

        [Test]
        public void AWallMountedPieceIsRefusedWithItsOwnCodeRatherThanPlacedOnTheFloor() {
            var plan = StationModulePlacement.Resolve(index, new StationPlacementRequest {
                ToolType = "billboard",
                Rotation = 0,
                Hit = new StationPlacementHit(0, 0, 0, 0, 0, 1, true, new StationPoint(0.5, 0.5, 1), 1),
            });
            Assert.AreEqual("unsupported-family", plan.Reason);
        }
    }

    /// <summary>
    /// Plan 16 §1.5: the edit transaction. A placement, move and delete apply to the
    /// committed v1 envelope and install through the host's one atomic path; an invalid
    /// move leaves the saved object exactly where it was; undo/redo restore the whole
    /// envelope; a repeated command id never bumps the revision twice.
    /// </summary>
    public sealed class StationEditTransactionTests {
        GameObject hostObject;
        StationGameHost host;

        [SetUp]
        public void SetUp() {
            StationEditSession.Reset();
            StationScenePicker.Reset();
            StationToolSelection.Reset();
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(TinySave(), "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
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

        /// <summary>A 9 × 9 floor at z = 0 with one bench and one wall course behind it.</summary>
        static string TinySave() {
            var cells = new JArray();
            for (int x = 0; x < 9; x++) {
                for (int y = 0; y < 9; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            for (int x = 0; x < 9; x++) cells.Add(new JObject { ["x"] = x, ["y"] = 8, ["z"] = 1, ["fill"] = "solid" });
            var modules = new JArray {
                new JObject {
                    ["id"] = "bench-1", ["type"] = "bench", ["x"] = 2, ["y"] = 2, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "steel-1", ["note"] = "keep me" },
                },
            };
            return new JObject {
                ["format"] = "metro-save", ["formatVersion"] = 1, ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "Edit transaction fixture", ["nameEn"] = "", ["city"] = "guangzhou", ["seed"] = 1234567,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Newtonsoft.Json.Formatting.None);
        }

        static StationEditDraft Bench(int x, int y, int z, int rot = 0) {
            var draft = new StationEditDraft {
                Id = "bench-2", Type = "bench", X = x, Y = y, Z = z, Rotation = rot, Width = 1,
            };
            draft.Set("variant", "steel-1");
            return draft;
        }

        [Test]
        public void OnePlaceOneRevisionAndThePieceReopensFromTheSavedText() {
            int before = host.CurrentRevision;
            var draft = Bench(4, 2, 0);
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", "cmd-1",
                out var applied, out var code), code);
            Assert.AreEqual(before + 1, host.CurrentRevision, "one transaction, one revision");
            Assert.IsTrue(host.Index.GetModule("bench-2") != null, "the committed document has the piece");
            var reopened = StationDocumentReader.Read(host.SaveDocument(), StationSource.None);
            Assert.IsTrue(reopened.Document.Modules.AnyMatching("bench-2"), "and it reopens from the save text");
        }

        [Test]
        public void AnInvalidMoveLeavesTheSavedPieceExactlyWhereItWas() {
            int before = host.CurrentRevision;
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var bench));
            // (4, 2, 3) has no floor: the move must be refused, not committed.
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = bench, Rotation = 0,
                Hit = new StationPlacementHit(4, 2, 3, 4, 2, 3, true, new StationPoint(4.5, 2.5, 4), 4),
            });
            Assert.IsFalse(plan.Ok);
            Assert.AreEqual("floor", plan.Reason);
            Assert.AreEqual(before, host.CurrentRevision, "a refusal never bumps the revision");
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var after));
            Assert.AreEqual(2, after.X, "the saved object stayed where it was");
            Assert.AreEqual(2, after.Y);
        }

        [Test]
        public void MoveKeepsUnknownAuthoredFieldsAndUndoRestoresEachEnvelope() {
            int before = host.CurrentRevision;
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var bench));
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = bench, Rotation = 1,
                Hit = new StationPlacementHit(4, 2, 0, 4, 2, 0, true, new StationPoint(4.5, 2.5, 1), 1),
            });
            Assert.IsTrue(plan.Ok, plan.Reason);
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Replace, plan.Candidate, null, "move", "cmd-move",
                out _, out var code), code);
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var moved));
            Assert.AreEqual(4, moved.X);
            Assert.AreEqual(1, moved.Rotation);
            Assert.AreEqual("keep me", moved.Config.Text("note"), "an unknown authored cfg field travels with the piece");

            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var back));
            Assert.AreEqual(2, back.X, "undo restores the previous envelope");
            Assert.AreEqual(before + 2, host.CurrentRevision, "the move and its undo are each one revision");

            Assert.IsTrue(StationEditSession.TryRedo(host, out _, out code), code);
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var again));
            Assert.AreEqual(4, again.X, "redo re-applies it");
        }

        [Test]
        public void DeleteAndUndoRestoreTheWholeDocument() {
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out _));
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, "bench-1", "delete", "cmd-del",
                out _, out var code), code);
            Assert.IsNull(host.Index.GetModule("bench-1"));
            Assert.IsTrue(StationEditSession.TryUndo(host, out _, out code), code);
            Assert.IsTrue(host.Index.TryGetModule("bench-1", out var restored));
            Assert.AreEqual(2, restored.X);
        }

        [Test]
        public void AnEditCommitKeepsThePlayersStoreyAndCamera() {
            // Plan 16 §1.5 / plan 11 D4: an edit is the same station, so the commit must not
            // re-home the camera or jump the player to another storey. The pointer path
            // relies on this: a fixed screen pixel keeps aiming at the piece it placed.
            host.frameCameraOnCommit = true;
            var cameraObject = new GameObject("edit camera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.transform.SetPositionAndRotation(new Vector3(11f, 22f, 33f), Quaternion.Euler(10f, 20f, 0f));
            host.stationCamera = camera;
            host.SetActiveLevel(7);
            var before = camera.transform.position;
            int revision = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, Bench(4, 2, 0), null, "place", "cmd-view",
                out _, out var code), code);
            Assert.AreEqual(revision + 1, host.CurrentRevision);
            Assert.AreEqual(7, host.ActiveLevel, "an edit must not move the player's storey");
            Assert.AreEqual(before, camera.transform.position, "an edit must not re-home the camera");
            UnityEngine.Object.DestroyImmediate(cameraObject);
        }

        [Test]
        public void ARepeatedCommandIdIsNotASecondRevision() {
            var draft = Bench(4, 2, 0);
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", "same-id",
                out _, out var code), code);
            int revision = host.CurrentRevision;
            Assert.IsFalse(StationEditSession.TryApply(host, StationModuleEditMode.Add, draft, null, "place", "same-id",
                out _, out code));
            Assert.AreEqual("duplicate-command", code);
            Assert.AreEqual(revision, host.CurrentRevision, "the retry did not add a second revision");
        }

        [Test]
        public void AnUnknownMoveTargetIsRefusedWithoutTouchingTheSave() {
            int before = host.CurrentRevision;
            Assert.IsTrue(StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, "does-not-exist", "delete", "cmd-x",
                out _, out var code) == false);
            Assert.AreEqual("not-found", code);
            Assert.AreEqual(before, host.CurrentRevision);
        }

        static string Envelope(string type, JObject payload, string id, int? expectedRevision = null) {
            var envelope = new JObject {
                ["schemaVersion"] = 2, ["id"] = id, ["sessionId"] = "s-edit", ["type"] = type, ["payload"] = payload,
            };
            if (expectedRevision.HasValue) envelope["expectedRevision"] = expectedRevision.Value;
            return envelope.ToString(Newtonsoft.Json.Formatting.None);
        }
    }

    static class StationModuleEnumerable {
        public static bool AnyMatching(this System.Collections.Generic.IReadOnlyList<StationModuleRecord> modules, string id) {
            for (int i = 0; i < modules.Count; i++) if (string.Equals(modules[i].Id, id, StringComparison.Ordinal)) return true;
            return false;
        }
    }
}
