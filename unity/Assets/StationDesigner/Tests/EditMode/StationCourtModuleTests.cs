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
    public sealed class StationCourtModuleTests {
        const string TianhePath = "Assets/StationDesigner/Demos/tianhe.metro.json";

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static JObject MakeCourtSave(JArray cells, JArray modules) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "Court Probe",
            ["city"] = "guangzhou",
            ["seed"] = 1,
            ["levelBase"] = 0,
            ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules ?? new JArray(),
                ["lines"] = new JArray(),
            },
        };

        static StationReadResult Read(JObject save, string id) =>
            StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource(id, ""));

        static JArray FloorSlab(int x0, int y0, int x1, int y1, int z) {
            var cells = new JArray();
            for (int x = x0; x <= x1; x++) {
                for (int y = y0; y <= y1; y++) {
                    cells.Add(new JObject {
                        ["x"] = x,
                        ["y"] = y,
                        ["z"] = z,
                        ["fill"] = "solid",
                        ["top"] = "floor.stone",
                    });
                }
            }
            return cells;
        }

        [Test]
        public void TianheParkCourtsAreClaimedAndResolveAll282Instances() {
            Assert.IsTrue(StationBindingReport.OwnedByRenderer("court"), "court must be owned by a registered renderer");
            Assert.AreEqual(StationModuleClaims.Equipment, StationModuleClaims.GroupOf("court"));

            var read = StationDocumentReader.ReadFile(TianhePath);
            Assert.IsNotNull(read?.Document, "Tianhe fixture missing: " + TianhePath);

            var courts = read.Document.Modules.Where(m => m.Type == "court").ToArray();
            Assert.AreEqual(282, courts.Length, "Tianhe Park ships 282 court modules (14 pickleball + 268 dividers)");
            Assert.AreEqual(14, courts.Count(m => m.Config.Text("variant") == "pickleball"));
            Assert.AreEqual(268, courts.Count(m => m.Config.Text("variant") == "divider"));

            foreach (var court in courts) {
                Assert.AreEqual(-5, court.Z, court.Id + " sits on the -5m concourse");
                Assert.IsFalse(StationViewFeature.IsGradeModule(court),
                    court.Id + " at -5m must not be hidden as 0m street furniture");
            }

            var catalogue = Catalogue();
            var unresolved = new List<string>();
            var facts = read.Document.Modules.Select(m => m.Facts).ToArray();
            foreach (var court in courts) {
                var visual = ModuleViews.Resolve(court.Facts, facts, catalogue);
                if (!visual.HasModel || !catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) {
                    unresolved.Add(court.Id + ":" + visual.Key);
                }
            }
            Assert.IsEmpty(unresolved, "every Tianhe court module resolves to a promoted prefab");
        }

        [Test]
        public void CourtBayAndDividerPlacementHonourCornerPivotRotationAndDocumentBounds() {
            // Matches Tianhe Park's `court-pickleball-76069` at (100, -56, -5, rot 1) plus a divider on its backcourt
            // and a badminton bay at rot 0.
            var cells = FloorSlab(90, -58, 126, -38, -5);
            var modules = new JArray {
                new JObject {
                    ["id"] = "court-pickleball-76069",
                    ["type"] = "court",
                    ["x"] = 100, ["y"] = -56, ["z"] = -5, ["rot"] = 1,
                    ["cfg"] = new JObject { ["variant"] = "pickleball" },
                },
                new JObject {
                    ["id"] = "court-divider-probe",
                    ["type"] = "court",
                    ["x"] = 99, ["y"] = -55, ["z"] = -5, ["rot"] = 1,
                    ["cfg"] = new JObject { ["variant"] = "divider" },
                },
                new JObject {
                    ["id"] = "court-badminton-probe",
                    ["type"] = "court",
                    ["x"] = 105, ["y"] = -55, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "badminton" },
                },
            };

            var read = Read(MakeCourtSave(cells, modules), "court-probe");
            var catalogue = Catalogue();
            var root = new GameObject("court-world-probe");
            var equipment = new StationEquipmentModuleRenderer();
            StationWorldView world = null;
            try {
                StationScenePicker.Reset();
                world = new StationWorldView(root.transform, "court-probe", new IStationViewRenderer[] { equipment },
                    new StationViewAssets { Catalogue = catalogue, Shader = FindShader() });
                world.Build(read.Document, read.Index);
                world.Activate();

                Assert.AreEqual(0, world.Unresolved.Count, "court build must report zero unresolved items");
                Assert.AreEqual(3, equipment.BuiltCount);

                // Even if a caller populates Width/Depth on a court ModuleFacts, RunCentre stays zero.
                Assert.AreEqual(Vector3.zero, ModulePlacement.RunCentre(new ModuleFacts {
                    Type = "court", Width = 14, Depth = 7, Rotation = 1,
                }));

                var pickleballRecord = world.Records.First(r => r.ModuleId == "court-pickleball-76069");
                Assert.IsTrue(pickleballRecord.HasBounds, "court record carries measured document bounds");
                // rot=1 around (100.5, -55.5): local [-0.5..13.5] x [-0.5..6.5] -> X [94..101], Y [-56..-42].
                Assert.AreEqual(94.0, pickleballRecord.Bounds.X0, 0.05);
                Assert.AreEqual(101.0, pickleballRecord.Bounds.X1, 0.05);
                Assert.AreEqual(-56.0, pickleballRecord.Bounds.Y0, 0.05);
                Assert.AreEqual(-42.0, pickleballRecord.Bounds.Y1, 0.05);
                Assert.AreEqual(-4.0, pickleballRecord.Bounds.Z0, 0.05);
                Assert.AreEqual(-3.03, pickleballRecord.Bounds.Z1, 0.05);

                // Both pickleball and badminton prefabs carry a MeshTopology.Lines net submesh.
                var lineFilters = pickleballRecord.View.GetComponentsInChildren<MeshFilter>(true)
                    .Where(f => f.sharedMesh != null && f.sharedMesh.subMeshCount > 0 &&
                        f.sharedMesh.GetTopology(0) == MeshTopology.Lines)
                    .ToArray();
                Assert.AreEqual(1, lineFilters.Length, "pickleball court carries its line-topology net mesh");

                // Selection box wraps the full 7 x 14 m rotated rendered bounds plus SelectionPad.
                var pickleballModule = read.Index.GetModule("court-pickleball-76069");
                Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(world, pickleballModule, out var selBounds));
                Assert.AreEqual(7f + StationPlacementPreview.SelectionPad * 2f, selBounds.size.x, 0.08f);
                Assert.AreEqual(14f + StationPlacementPreview.SelectionPad * 2f, selBounds.size.z, 0.08f);

                // Eyedropper maps each court variant back to its palette id.
                Assert.AreEqual("court-pickleball", StationModulePick.PaletteIdFor(pickleballModule));
                Assert.AreEqual("court-divider", StationModulePick.PaletteIdFor(read.Index.GetModule("court-divider-probe")));
                Assert.AreEqual("court-badminton", StationModulePick.PaletteIdFor(read.Index.GetModule("court-badminton-probe")));

                // Scene picking: ray on the divider picks the divider; ray on open painted court picks the court.
                var dividerRay = new Ray(StationCoordinates.Point(new Vector3(99.5f, -54.5f, 10f)), Vector3.down);
                var dividerHit = StationScenePicker.PickRay(world, dividerRay, -5);
                Assert.IsTrue(dividerHit.HasModule);
                Assert.AreEqual("court-divider-probe", dividerHit.Module.Id, "divider standing on court wins its ray");

                var courtRay = new Ray(StationCoordinates.Point(new Vector3(96.5f, -45.5f, 10f)), Vector3.down);
                var courtHit = StationScenePicker.PickRay(world, courtRay, -5);
                Assert.IsTrue(courtHit.HasModule);
                Assert.AreEqual("court-pickleball-76069", courtHit.Module.Id, "open court floor picks the court module");
            } finally {
                StationScenePicker.Reset();
                world?.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void ExplodedTrayBuilderExtractsCourtTrianglesAndPreservesLineTopologyNetWithoutThrowing() {
            var cells = FloorSlab(0, 0, 16, 10, -5);
            var modules = new JArray {
                new JObject {
                    ["id"] = "court-pickleball-1",
                    ["type"] = "court",
                    ["x"] = 1, ["y"] = 1, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "pickleball" },
                },
                new JObject {
                    ["id"] = "court-divider-1",
                    ["type"] = "court",
                    ["x"] = 1, ["y"] = 9, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "divider" },
                },
            };

            var read = Read(MakeCourtSave(cells, modules), "exploded-court-probe");
            var catalogue = Catalogue();
            var worldRoot = new GameObject("exploded-court-world");
            var explodedHolder = new GameObject("exploded-court-holder");
            StationWorldView world = null;
            StationExplodedTrayBuilder builder = null;
            try {
                world = new StationWorldView(worldRoot.transform, "exploded-court",
                    new IStationViewRenderer[] { new StationEquipmentModuleRenderer() },
                    new StationViewAssets { Catalogue = catalogue, Shader = FindShader() });
                world.Build(read.Document, read.Index);
                world.Activate();

                builder = new StationExplodedTrayBuilder(
                    read.Document,
                    world,
                    catalogue,
                    trainCatalogue: null,
                    fallbackShader: FindShader(),
                    parent: explodedHolder.transform);
                builder.BuildStructuralTrays();
                bool ready = builder.StepPropsBatch(int.MaxValue);
                Assert.IsTrue(ready && builder.EquipmentReady, "exploded prop extraction must finish cleanly");
                Assert.AreEqual(1, builder.Trays.Count);

                var propsRoot = builder.Trays[0].PropsRoot;
                var filters = propsRoot.GetComponentsInChildren<MeshFilter>(true);
                bool hasTriangleProps = filters.Any(f => f.sharedMesh != null && f.sharedMesh.subMeshCount > 0 &&
                    f.sharedMesh.GetTopology(0) == MeshTopology.Triangles);
                bool hasLineNet = filters.Any(f => f.sharedMesh != null && f.sharedMesh.subMeshCount > 0 &&
                    f.sharedMesh.GetTopology(0) == MeshTopology.Lines);
                Assert.IsTrue(hasTriangleProps, "exploded tray combines court surface/post triangle meshes");
                Assert.IsTrue(hasLineNet, "exploded tray preserves the court net's MeshTopology.Lines mesh");
            } finally {
                builder?.Dispose();
                world?.Dispose();
                UnityEngine.Object.DestroyImmediate(explodedHolder);
                UnityEngine.Object.DestroyImmediate(worldRoot);
            }
        }

        [Test]
        public void CourtPlacementAllowsPortableDividerOnPaintedCourtWhileProtectingCentreNet() {
            var cells = FloorSlab(0, 0, 20, 12, -5);
            var modules = new JArray {
                new JObject {
                    ["id"] = "court-pickleball-1",
                    ["type"] = "court",
                    ["x"] = 2, ["y"] = 2, ["z"] = -5, ["rot"] = 0,
                    ["cfg"] = new JObject { ["variant"] = "pickleball" },
                },
            };
            var read = Read(MakeCourtSave(cells, modules), "placement-court-probe");

            // At rot=0, court-pickleball-1 spans X [2..16], Y [2..9]; centre net sits at X = 9 +/- 0.2 -> [8.8..9.2].
            var backcourtDivider = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                ToolType = "court-divider",
                Rotation = 0,
                Hit = new StationPlacementHit(3, 3, -5, 3, 3, -4, solid: true, new StationPoint(3.5, 3.5, -4), -4),
            });
            Assert.IsTrue(backcourtDivider.Ok, "portable divider can stand on painted backcourt: " + backcourtDivider.Reason);
            Assert.AreEqual("court", backcourtDivider.Candidate.Type);
            Assert.AreEqual("divider", backcourtDivider.Candidate.Text("variant"));

            var netCollisionDivider = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                ToolType = "court-divider",
                Rotation = 0,
                Hit = new StationPlacementHit(8, 5, -5, 8, 5, -4, solid: true, new StationPoint(8.5, 5.5, -4), -4),
            });
            Assert.AreEqual("occupied", netCollisionDivider.Reason, "divider crossing X [8..10] overlaps the net at X=9");
            CollectionAssert.Contains(netCollisionDivider.ColliderIds, "court-pickleball-1");
        }
    }
}
