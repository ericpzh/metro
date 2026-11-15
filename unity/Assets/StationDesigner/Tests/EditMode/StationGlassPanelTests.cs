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
    /// Plan 22 §2: curtain walls and the doors fitted into them.
    ///
    /// The promoted `curtain-wall` prefab is one fixed 2 × 4 m panel with an uninterrupted pane,
    /// and it was instanced through the generic catalogue pivot — the panel's own centre — while
    /// the source places a floor-standing curtain on the tile's **leading edge**. Tanwei's
    /// `curtain-wall-434` is a 1 × 4 m panel on the same anchor as `door-glass-1-437`, so the two
    /// came out 0.41 m apart with the door hanging in the air beside the glazing.
    ///
    /// The expectations below are `GlassModel.ts`'s own frame numbers (`GLASS_FRAME`) and
    /// `sim/placement.ts`'s `curtainCornerJoin` / `curtainDoorShare` / `snapDoorToCurtain`.
    /// </summary>
    public sealed class StationGlassPanelTests {
        static JObject Module(string id, string type, int x, int y, int z, int w = 1, int rot = 0, JObject cfg = null) =>
            new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z,
                ["w"] = w, ["rot"] = rot, ["cfg"] = cfg ?? new JObject(),
            };

        static JObject Save(JArray modules, JArray cells = null) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "glass probe", ["city"] = "guangzhou", ["seed"] = 3,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules,
                ["lines"] = new JArray(),
            },
        };

        static StationReadResult Read(JObject save) =>
            StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource("glass probe", ""));

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static StationWorldView Build(JObject save, out GameObject root, out StationEquipmentModuleRenderer equipment) {
            var read = Read(save);
            root = new GameObject("glass view probe");
            equipment = new StationEquipmentModuleRenderer();
            var world = new StationWorldView(root.transform, "glass probe",
                new IStationViewRenderer[] { equipment },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            return world;
        }

        /// <summary>The vertices of one named generated part, in document axes.</summary>
        static List<Vector3> PartVertices(GameObject view, string name) {
            var filter = view.GetComponentsInChildren<MeshFilter>(true).FirstOrDefault(candidate => candidate.name == name);
            if (!filter || !filter.sharedMesh) return new List<Vector3>();
            return filter.sharedMesh.vertices
                .Select(vertex => StationCoordinates.WorldToDocument(filter.transform.TransformPoint(vertex)))
                .ToList();
        }

        /* -------------------------------------------------------------- parsing */

        [Test]
        public void ThePaletteParserCreatesCurtainWallsAndDoors() {
            Assert.IsTrue(StationModuleFamilies.TryParse("curtain-wall", "", 2, out var curtain),
                "a 玻璃幕墙 palette id is placeable");
            Assert.AreEqual("glass", curtain.Type);
            Assert.AreEqual("2x4", curtain.Variant, "createModule: width 2 is the 2 × 4 m piece");
            Assert.AreEqual(2, curtain.Width);
            Assert.IsTrue(curtain.Centred, "a curtain run grows evenly either side of the pointer");

            Assert.IsTrue(StationModuleFamilies.TryParse("curtain-wall", "", 3, out var wide));
            Assert.AreEqual("3x4", wide.Variant);
            Assert.IsTrue(StationModuleFamilies.TryParse("curtain-wall", "", 1, out var narrow));
            Assert.AreEqual("1x4", narrow.Variant);

            Assert.IsTrue(StationModuleFamilies.TryParse("glass-1x4", "", 0, out var glass));
            Assert.AreEqual("1x4", glass.Variant);
            Assert.AreEqual(1, glass.Width);

            Assert.IsTrue(StationModuleFamilies.TryParse("door-glass-1", "", 0, out var door));
            Assert.AreEqual("door", door.Type);
            Assert.AreEqual("glass-1", door.Variant);
            Assert.AreEqual(1, door.Width);
            Assert.IsTrue(StationModuleFamilies.TryParse("door-steel-2", "", 0, out var pair));
            Assert.AreEqual(2, pair.Width, "a 双开 door asks for two cells");
        }

        /* ------------------------------------------------------------ envelope */

        [Test]
        public void AFloorStandingCurtainReservesItsRotatedEdgeStrip() {
            var read = Read(Save(new JArray {
                Module("curtain-wall-434", "glass", -7, -1, 11, 1, 3, new JObject { ["variant"] = "1x4" }),
            }));
            var record = read.Document.Modules.First(module => module.Id == "curtain-wall-434");
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var reason), reason);
            // rot 3 is the curtain's leading edge on −x: `edgeIn = GLASS_FRAME.depth / 2 − 0.5`
            // = −0.45, so the 0.1 m frame sits from x−7.00 to x−6.90, not on the cell centre.
            Assert.AreEqual(.1f, box.X1 - box.X0, .01, "the frame's own depth, not a wall panel's 0.25 m band");
            Assert.AreEqual(1.0f, box.Y1 - box.Y0, .01, "the run is one cell along its axis");
            Assert.AreEqual(-6.95, (box.X0 + box.X1) * .5, .01, "the pane's plane is the tile's leading edge");
            Assert.AreEqual(12, box.Z0, .01, "the envelope starts at the cell's floor top");
            Assert.AreEqual(16, box.Z1, .01, "a 1 × 4 m panel is four metres tall");
        }

        [Test]
        public void AWallMountedPanelKeepsItsWallStandoff() {
            var read = Read(Save(new JArray {
                Module("glass-2x1", "glass", 3, 4, 6, 2, 0, new JObject { ["variant"] = "2x1" }),
            }));
            var record = read.Document.Modules.First(module => module.Id == "glass-2x1");
            Assert.IsTrue(StationFootprints.TryClearance(record, out var box, out var reason), reason);
            Assert.AreEqual(.25f, box.Y1 - box.Y0, .01, "short cladding keeps the wall panel's band");
            Assert.AreEqual(1, box.Z1 - box.Z0, .01, "a 1 m band of wall");
        }

        /* ------------------------------------------------------------ geometry */

        [Test]
        public void TheGeneratedCurtainStandsOnItsTilesLeadingEdge() {
            var world = Build(Save(new JArray {
                Module("curtain-wall-434", "glass", -7, -1, 11, 1, 3, new JObject { ["variant"] = "1x4" }),
            }), out var root, out var equipment);
            try {
                Assert.IsTrue(world.TryGetModule("curtain-wall-434", out var record), "the curtain is registered");
                Assert.AreEqual("wall-glass", record.Part);
                var bounds = record.Bounds;
                Assert.AreEqual(.1, bounds.X1 - bounds.X0, .02, "the frame's depth across the run");
                Assert.AreEqual(1.0, bounds.Y1 - bounds.Y0, .02, "the run's length");
                Assert.AreEqual(-6.95, (bounds.X0 + bounds.X1) * .5, .02,
                    "the pane hangs on the tile's leading edge, 0.45 m off the cell centre");
                Assert.AreEqual(12, bounds.Z0, .02, "the sill sits on the cell's floor top");
                Assert.AreEqual(16, bounds.Z1, .02, "a 1 × 4 m panel is four metres tall");
                var pane = PartVertices(record.View, "glass-pane");
                Assert.IsNotEmpty(pane, "the generated pane is drawn");
                Assert.AreEqual(12.1, pane.Min(vertex => vertex.z), .02, "the pane starts above the sill rail");
                Assert.IsTrue(equipment.GlassNotes.Any(note => note.StartsWith("curtain-wall-434 ", StringComparison.Ordinal) &&
                    note.Contains("mount=floor-edge")), string.Join("; ", equipment.GlassNotes));
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void AFittedDoorCutsTheLowerGlazingAndKeepsTheUpperPane() {
            var withDoor = Build(Save(new JArray {
                Module("curtain-wall-434", "glass", -7, -1, 11, 1, 3, new JObject { ["variant"] = "1x4" }),
                Module("door-glass-1-437", "door", -7, -1, 11, 1, 3, new JObject { ["variant"] = "glass-1" }),
            }), out var root, out var equipment);
            GameObject plainRoot = null;
            StationWorldView plain = null;
            try {
                var cut = PartVertices(withDoor.Records.First(record => record.ModuleId == "curtain-wall-434").View,
                    "glass-pane");
                plain = Build(Save(new JArray {
                    Module("curtain-wall-434", "glass", -7, -1, 11, 1, 3, new JObject { ["variant"] = "1x4" }),
                }), out plainRoot, out _);
                var untouched = PartVertices(plain.Records.First(record => record.ModuleId == "curtain-wall-434").View,
                    "glass-pane");
                Assert.Less(cut.Min(vertex => vertex.z), 16f, "the upper pane starts somewhere below the head");
                // The door is 1.99 m: the lower glazing gives way, so the pane's lowest vertex rises
                // from just above the sill (12.1 m) to the transom (12 + 1.99 + 0.1 ≈ 14.09 m).
                Assert.Greater(cut.Min(vertex => vertex.z), 14f, "the door's opening is glazed out below the transom");
                Assert.Less(untouched.Min(vertex => vertex.z), 12.6f, "the same panel without a door keeps its lower pane");
                Assert.IsTrue(equipment.GlassNotes.Any(note => note.Contains("doors=1")),
                    "the fitted door is recorded: " + string.Join("; ", equipment.GlassNotes));
            } finally {
                withDoor.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
                plain?.Dispose();
                if (plainRoot) UnityEngine.Object.DestroyImmediate(plainRoot);
            }
        }

        [Test]
        public void AJoinedCornerDrawsOneEndPost() {
            // Two floor-standing curtains on one tile, a quarter turn apart: the end post that
            // would project into the other's frame is trimmed (`curtainCornerJoin`), so the corner
            // reads as one joined frame rather than two posts sharing the same space.
            var world = Build(Save(new JArray {
                Module("glass-0", "glass", 0, 0, 6, 2, 0, new JObject { ["variant"] = "2x4" }),
                Module("glass-1", "glass", 0, 0, 6, 2, 1, new JObject { ["variant"] = "2x4" }),
            }), out var root, out var equipment);
            try {
                var notes = string.Join("; ", equipment.GlassNotes);
                Assert.IsTrue(notes.Contains("joined=1"), "one end post is shared at the crossing: " + notes);
                Assert.IsTrue(notes.Contains("joined=0"), "only the trimmed panel loses a post: " + notes);
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        /* --------------------------------------------------------- interaction */

        [Test]
        public void ADoorDroppedOnACurtainSnapsIntoItsRun() {
            var read = Read(Save(new JArray {
                Module("curtain-wall-1", "glass", 0, 0, 0, 3, 0, new JObject { ["variant"] = "3x4" }),
            }));
            var request = new StationPlacementRequest {
                ToolType = "door-glass-2",
                Rotation = 0,
                Hit = StationPlacementHit.FromSurface(new StationPoint(1.5, .5, 1), 0, 0, 1, true),
                TargetModuleId = "curtain-wall-1",
                ModulePoint = new StationPoint(1.5, .5, 0),
            };
            var plan = StationModulePlacement.Resolve(read.Index, request);
            Assert.IsNotNull(plan.Candidate);
            // `snapDoorToCurtain`: the pointer is on the curtain's middle cell, so a 2 m door takes
            // the curtain's own axis and turn and starts on the run cell the snap centres it on.
            Assert.AreEqual(1, plan.Candidate.X);
            Assert.AreEqual(0, plan.Candidate.Y);
            Assert.AreEqual(0, plan.Candidate.Rotation);
            Assert.AreEqual(2, plan.Candidate.Width);
            Assert.IsEmpty(plan.ColliderIds, "a door fitted into a curtain shares its tile: " + string.Join(", ", plan.ColliderIds));
            Assert.IsTrue(plan.Ok, plan.Reason);

            // The clamp: a pointer on the run's last cell cannot push a 2 m door past the end.
            var clamped = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                ToolType = "door-glass-2",
                Rotation = 0,
                Hit = StationPlacementHit.FromSurface(new StationPoint(2.5, .5, 1), 0, 0, 1, true),
                TargetModuleId = "curtain-wall-1",
                ModulePoint = new StationPoint(2.5, .5, 0),
            });
            Assert.AreEqual(1, clamped.Candidate.X, "the door stays inside the curtain's three-cell run");
        }

        [Test]
        public void ADoorOnAnotherStoreyDoesNotSnap() {
            var read = Read(Save(new JArray {
                Module("curtain-wall-1", "glass", 0, 0, 0, 3, 0, new JObject { ["variant"] = "3x4" }),
            }));
            var request = new StationPlacementRequest {
                ToolType = "door-glass-1",
                Rotation = 0,
                Hit = StationPlacementHit.FromSurface(new StationPoint(1.5, .5, 6), 0, 0, 1, true),
                TargetModuleId = "curtain-wall-1",
                ModulePoint = new StationPoint(1.5, .5, 0),
            };
            var plan = StationModulePlacement.Resolve(read.Index, request);
            Assert.IsNotNull(plan.Candidate);
            Assert.AreNotEqual(0, plan.Candidate.Z, "the door keeps the storey it was aimed at");
        }

        [Test]
        public void ACurtainPlacedOverAFittedDoorIsNotACollision() {
            var read = Read(Save(new JArray {
                Module("door-glass-1-437", "door", 0, 0, 0, 1, 0, new JObject { ["variant"] = "glass-1" }),
            }));
            var request = new StationPlacementRequest {
                ToolType = "curtain-wall",
                Width = 1,
                Rotation = 0,
                Hit = StationPlacementHit.FromSurface(new StationPoint(.5, .5, 1), 0, 0, 1, true),
            };
            var plan = StationModulePlacement.Resolve(read.Index, request);
            Assert.AreEqual("glass", plan.Candidate.Type);
            Assert.AreEqual("1x4", plan.Candidate.Text("variant"));
            Assert.IsEmpty(plan.ColliderIds,
                "a curtain and the door fitted into it share their tile: " + string.Join(", ", plan.ColliderIds));
        }
    }
}
