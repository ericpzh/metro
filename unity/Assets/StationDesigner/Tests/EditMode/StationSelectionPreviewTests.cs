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
    /// Plan 22 §3: the selection mark. Both branches of `StationPlacementPreview.Select` passed
    /// the nullable <c>selectMaterial</c> field, which nothing initialised, so `BuildBox` assigned
    /// a null material and every selection drew Unity's magenta missing-material. The geometry
    /// was also a 12-prism cage built from the **clearance** box scaled by 1.06, while the web
    /// pads the module's **rendered** bounds by a fixed 0.06 m and draws one thin `#55b6ff` line
    /// box (`ModuleSystem.ts:refreshSelection`).
    /// </summary>
    public sealed class StationSelectionPreviewTests {
        static JObject Module(string id, string type, int x, int y, int z, int w = 1, JObject cfg = null) =>
            new JObject {
                ["id"] = id, ["type"] = type, ["x"] = x, ["y"] = y, ["z"] = z,
                ["w"] = w, ["rot"] = 0, ["cfg"] = cfg ?? new JObject(),
            };

        static JObject Save(JArray modules, JArray cells = null, JArray lines = null) => new JObject {
            ["format"] = StationDocumentReader.SaveFormat,
            ["formatVersion"] = StationDocumentReader.SupportedVersion,
            ["savedAt"] = StationDocumentReader.FixedSavedAt,
            ["name"] = "selection probe", ["city"] = "guangzhou", ["seed"] = 5,
            ["levelBase"] = 0, ["storeyHeight"] = 5,
            ["static"] = new JObject {
                ["cells"] = cells ?? new JArray(),
                ["modules"] = modules,
                ["lines"] = lines ?? new JArray(),
            },
        };

        static JObject Cell(int x, int y, int z) => new JObject {
            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid",
        };

        static Bounds MeasureViewBounds(GameObject root) {
            var bounds = new Bounds();
            bool any = false;
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true)) {
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled || filter.sharedMesh == null) continue;
                var local = filter.sharedMesh.bounds;
                var matrix = filter.transform.localToWorldMatrix;
                for (int corner = 0; corner < 8; corner++) {
                    var pt = matrix.MultiplyPoint3x4(new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z));
                    if (!any) { bounds = new Bounds(pt, Vector3.zero); any = true; }
                    else bounds.Encapsulate(pt);
                }
            }
            Assert.IsTrue(any, "expected at least one enabled mesh renderer under " + root.name);
            return bounds;
        }

        static byte[] MakeTestPng(int width, int height, Color32 fill) {
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            try {
                var pixels = new Color32[width * height];
                for (int i = 0; i < pixels.Length; i++) pixels[i] = fill;
                texture.SetPixels32(pixels);
                texture.Apply(false, false);
                return texture.EncodeToPNG();
            } finally {
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        static RuntimeCatalogue Catalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue missing: " + RuntimeCatalogue.AssetPath);
            return catalogue;
        }

        static Shader FindShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");

        static StationWorldView Build(JObject save, out GameObject root) {
            var read = StationDocumentReader.Read(save.ToString(Formatting.None),
                new StationSource("selection probe", ""));
            root = new GameObject("selection probe");
            var world = new StationWorldView(root.transform, "selection probe",
                new IStationViewRenderer[] { new StationEquipmentModuleRenderer() },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            world.Build(read.Document, read.Index);
            world.Activate();
            return world;
        }

        /* --------------------------------------------------------- the material */

        [Test]
        public void TheSelectionColourIsTheSourcesLineBlue() {
            Assert.AreEqual(0x55 / 255f, StationPlacementPreview.SelectionColour.r, 1e-4f);
            Assert.AreEqual(0xb6 / 255f, StationPlacementPreview.SelectionColour.g, 1e-4f);
            Assert.AreEqual(1f, StationPlacementPreview.SelectionColour.b, 1e-4f);
            Assert.AreEqual(.06f, StationPlacementPreview.SelectionPad, 1e-6f, "the source's fixed pad");
        }

        [Test]
        public void TheSelectionMaterialIsNeverNullAndIsUnlit() {
            var material = StationPlacementPreview.CreateSelectionMaterial();
            Assert.IsNotNull(material, "a selection must never hand a null material to a renderer");
            try {
                Assert.AreEqual("edit selection", material.name);
                var colors = new List<Color>();
                if (material.HasProperty("_BaseColor")) colors.Add(material.GetColor("_BaseColor"));
                if (material.HasProperty("_Color")) colors.Add(material.GetColor("_Color"));
                Assert.IsNotEmpty(colors, "the material carries a colour property");
                foreach (var color in colors) {
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.r, color.r, 1e-4f);
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.g, color.g, 1e-4f);
                    Assert.AreEqual(StationPlacementPreview.SelectionColour.b, color.b, 1e-4f);
                }
                var shader = material.shader != null ? material.shader.name : "";
                StringAssert.DoesNotContain("Lit", shader,
                    "a line primitive has no normals, so a Lit material renders half the box black");
            } finally {
                UnityEngine.Object.DestroyImmediate(material);
            }
        }

        /* -------------------------------------------------------------- bounds */

        [Test]
        public void TheSelectionBoxIsTheRenderedBoundsPaddedBySixCentimetres() {
            var world = Build(Save(new JArray {
                Module("bench-1", "bench", 4, 4, 0, 2, new JObject { ["variant"] = "seat-2" }),
            }), out var root);
            try {
                var module = world.Document.Modules.First(record => record.Id == "bench-1");
                Assert.IsTrue(world.TryGetModule("bench-1", out var record), "the bench is registered");
                var drawn = new Bounds();
                bool any = false;
                foreach (var renderer in record.View.GetComponentsInChildren<MeshRenderer>(true)) {
                    if (!renderer) continue;
                    if (!any) { drawn = renderer.bounds; any = true; } else drawn.Encapsulate(renderer.bounds);
                }
                Assert.IsTrue(any, "the bench has drawn geometry");
                Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(world, module, out var box));
                Assert.AreEqual(drawn.center.x, box.center.x, .01);
                Assert.AreEqual(drawn.center.y, box.center.y, .01);
                Assert.AreEqual(drawn.center.z, box.center.z, .01);
                Assert.AreEqual(drawn.size.x + .12f, box.size.x, .01, "0.06 m on each side");
                Assert.AreEqual(drawn.size.y + .12f, box.size.y, .01);
                Assert.AreEqual(drawn.size.z + .12f, box.size.z, .01);
                // The clearance envelope is a different, larger box: this proves the mark measures
                // the drawn piece rather than the authored cell it reserves.
                Assert.IsTrue(StationFootprints.TryClearance(module, out var clearance, out _));
                Assert.Greater(clearance.Y1 - clearance.Y0, drawn.size.z - .01,
                    "a 2 m bench reserves its 2 cells, while it draws less than that");
            } finally {
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void AModuleWithNoViewFallsBackToItsAuthoredEnvelope() {
            var module = new StationModuleRecord("tree-1", "tree", 2, 3, 0, 0, 1, 1, 1, false, null, null, null, "", null);
            Assert.IsTrue(StationPlacementPreview.TrySelectionBounds(null, module, out var box),
                "a paving tile in a combined batch has no view of its own");
            Assert.IsTrue(StationFootprints.TryClearance(module, out var clearance, out var reason), reason);
            Assert.AreEqual(clearance.X1 - clearance.X0 + .12, box.size.x, .01);
            Assert.AreEqual(clearance.Y1 - clearance.Y0 + .12, box.size.z, .01,
                "the document's plan y is Unity's z");
            Assert.AreEqual(clearance.Z1 - clearance.Z0 + .12, box.size.y, .01);
        }

        /* ---------------------------------------------------------- sign preview */

        [Test]
        public void CeilingSignPreviewMatchesFinalSnappedHeightAndHangerHeight() {
            var cells = new JArray {
                Cell(4, 4, -5), // concourse floor
                Cell(4, 4, 0),  // ceiling slab directly overhead (underside at z = 0)
                Cell(8, 4, 0),  // floor under roof hanger
                Cell(12, 4, 0), // floor under post hanger
            };
            var modules = new JArray {
                new JObject {
                    ["id"] = "hanger-r", ["type"] = "hanger", ["x"] = 7, ["y"] = 4, ["z"] = 0, ["w"] = 4, ["rot"] = 0,
                    ["cfg"] = new JObject { ["mount"] = "roof" },
                },
                new JObject {
                    ["id"] = "hanger-p", ["type"] = "hanger", ["x"] = 11, ["y"] = 4, ["z"] = 0, ["w"] = 4, ["rot"] = 0,
                    ["cfg"] = new JObject { ["mount"] = "post" },
                },
            };
            var lines = new JArray {
                new JObject { ["id"] = "5", ["name"] = "5号线", ["colour"] = "#c5003e" },
            };
            var read = StationDocumentReader.Read(Save(modules, cells, lines).ToString(Formatting.None),
                new StationSource("sign height probe", ""));

            var previewGo = new GameObject("sign preview test");
            var preview = previewGo.AddComponent<StationPlacementPreview>();
            var placedRoot = new GameObject("placed sign comparison");
            try {
                preview.Bind(read.Index);

                // 1. Ceiling-anchored sign aimed at concourse floor under z=0 ceiling slab:
                //    final height must snap flush to underside y=0 (panel centre -0.65), not +2.35!
                var hit = new StationPlacementHit(4, 4, -5, 4, 4, -4, true, new StationPoint(4.5, 4.5, -4), -4);
                var plan = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    ToolType = "sign-ceiling",
                    Hit = hit,
                    Rotation = 0,
                });
                Assert.IsTrue(plan.Ok, "ceiling sign under slab should be valid: " + plan.Reason);
                Assert.AreEqual(-1, plan.Candidate.Z, "ceiling aim anchors in air cell below slab");
                Assert.IsTrue(plan.Candidate.CeilingAnchored, "slab overhead sets CeilingAnchored");

                preview.Show(plan);
                var ghostSign = previewGo.GetComponentInChildren<StationSignView>(true);
                Assert.IsNotNull(ghostSign, "sign preview must render via StationSignView, not bare prefab");
                Assert.AreEqual(-0.65f, ghostSign.PanelCentreZ, 1e-4f, "panel rides 0.65 m below ceiling underside");
                Assert.AreEqual(0f, ghostSign.transform.position.y, 1e-4f, "root aligns with ceiling underside");
                var ghostBounds = MeasureViewBounds(ghostSign.gameObject);
                Assert.AreEqual(0f, ghostBounds.max.y, 1e-3f, "ceiling plates touch slab underside at y = 0");
                Assert.AreEqual(-0.85f, ghostBounds.min.y, 1e-3f, "board bottom sits 0.85 m below ceiling");

                // Compare against the exact view StationSignRenderer would commit for the same record.
                var committedRecord = StationModulePlacement.ToRecord(plan.Candidate);
                var ceilingMounts = StationCeilingMounts.ForIndex(read.Index);
                float committedHang = (float)ceilingMounts.Resolve(committedRecord.Facts,
                    StationCeilingMounts.FallbackFor(committedRecord.Facts, 5)).Local;
                var placedReq = StationSignViews.RequestFor(committedRecord, StationSignViews.Lines(read.Document),
                    StationSignSignage.Locale, committedHang);
                var shader = FindShader();
                var mat = new Material(shader);
                try {
                    var placedSign = StationSignView.Build(placedReq,
                        StationSignMaterials.Create(mat, mat, mat, mat), default, placedRoot.transform);
                    placedSign.transform.SetPositionAndRotation(
                        StationSignViews.Placement(committedRecord),
                        ModulePlacement.Rotation(committedRecord.Rotation));
                    var placedBounds = MeasureViewBounds(placedSign.gameObject);
                    Assert.AreEqual(placedBounds.min.y, ghostBounds.min.y, 1e-3f, "preview bottom matches final placed sign");
                    Assert.AreEqual(placedBounds.max.y, ghostBounds.max.y, 1e-3f, "preview top matches final placed sign");
                    Assert.AreEqual(placedBounds.size.x, ghostBounds.size.x, 1e-3f, "preview width matches final placed sign");
                } finally {
                    UnityEngine.Object.DestroyImmediate(mat);
                }

                // 2. Roof hanger at z=0 -> hangCeilingLocal = 4, panel centre = 3.35, top at world y = 5.0.
                var roofHit = new StationPlacementHit(8, 4, 0, 8, 4, 1, true, new StationPoint(8.5, 4.5, 1), 1);
                var roofPlan = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    ToolType = "sign-ceiling",
                    Hit = roofHit,
                    Rotation = 0,
                });
                Assert.IsTrue(roofPlan.Ok, "sign on roof hanger should be valid: " + roofPlan.Reason);
                preview.Show(roofPlan);
                var roofGhost = previewGo.GetComponentInChildren<StationSignView>(true);
                Assert.IsNotNull(roofGhost);
                Assert.AreEqual(3.35f, roofGhost.PanelCentreZ, 1e-4f, "roof hanger adds 1 m crossbar uplift (4 - 0.65)");
                Assert.AreEqual(5f, MeasureViewBounds(roofGhost.gameObject).max.y, 1e-3f, "ceiling plates touch roof hanger bar at y = 5");

                // 3. Post hanger at z=0 -> hangCeilingLocal = 3, panel centre = 2.35, top at world y = 4.0.
                var postHit = new StationPlacementHit(12, 4, 0, 12, 4, 1, true, new StationPoint(12.5, 4.5, 1), 1);
                var postPlan = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    ToolType = "sign-ceiling",
                    Hit = postHit,
                    Rotation = 0,
                });
                Assert.IsTrue(postPlan.Ok, "sign on post hanger should be valid: " + postPlan.Reason);
                preview.Show(postPlan);
                var postGhost = previewGo.GetComponentInChildren<StationSignView>(true);
                Assert.IsNotNull(postGhost);
                Assert.AreEqual(2.35f, postGhost.PanelCentreZ, 1e-4f, "post hanger sits at local 3 - 0.65");
                Assert.AreEqual(4f, MeasureViewBounds(postGhost.gameObject).max.y, 1e-3f, "ceiling plates touch post hanger bar at y = 4");
            } finally {
                UnityEngine.Object.DestroyImmediate(previewGo);
                UnityEngine.Object.DestroyImmediate(placedRoot);
            }
        }

        [Test]
        public void SignPreviewDisplaysPaintedFaceContentAndPreservesSubscriptionAcrossHoverUpdates() {
            var cells = new JArray {
                Cell(4, 4, -5),
                Cell(4, 4, 0),
                Cell(5, 4, -5),
                Cell(5, 4, 0),
            };
            var lines = new JArray {
                new JObject { ["id"] = "5", ["name"] = "5号线", ["colour"] = "#c5003e" },
            };
            var read = StationDocumentReader.Read(Save(new JArray(), cells, lines).ToString(Formatting.None),
                new StationSource("sign content probe", ""));

            var sent = new List<string>();
            StationSignSignage.SendHook = json => sent.Add(json);
            StationSignSignage.Locale = "zh-CN";
            var worldRoot = new GameObject("sign world");
            var previewGo = new GameObject("sign content preview");
            var world = new StationWorldView(worldRoot.transform, "sign content probe",
                new IStationViewRenderer[] { new StationSignRenderer() },
                new StationViewAssets { Catalogue = Catalogue(), Shader = FindShader() });
            try {
                world.Build(read.Document, read.Index);
                world.Activate();
                Assert.IsNotNull(StationSignSignage.Cache, "StationSignRenderer attaches a live texture cache");

                var preview = previewGo.AddComponent<StationPlacementPreview>();
                preview.Bind(read.Index);

                string customFront = "[{\"id\":\"c1\",\"kind\":\"text\",\"text\":\"A出口\",\"x\":0.5,\"y\":0.2,\"scale\":1,\"side\":\"both\"}]";
                string customBack = "[{\"id\":\"c2\",\"kind\":\"text\",\"text\":\"B出口\",\"x\":0.5,\"y\":0.2,\"scale\":1,\"side\":\"both\"}]";
                var planA = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    ToolType = "sign-ceiling",
                    Hit = new StationPlacementHit(4, 4, -5, 4, 4, -4, true, new StationPoint(4.5, 4.5, -4), -4),
                    SignFrontJson = customFront,
                    SignBackJson = customBack,
                });
                Assert.IsTrue(planA.Ok, planA.Reason);
                preview.Show(planA);

                var ghostA = previewGo.GetComponentInChildren<StationSignView>(true);
                Assert.IsNotNull(ghostA);
                Assert.IsNotNull(ghostA.Front, "preview mounts the front sign face");
                Assert.IsNotNull(ghostA.Back, "preview mounts the composed back sign face");
                Assert.IsTrue(ghostA.FaceTint.HasValue, "preview applies translucent ghost tint to faces");
                Assert.AreEqual(1, sent.Count, "first hover sends exactly one sign.requestFace batch");

                // Moving hover to an adjacent cell while the first request is still in flight must NOT
                // drop the wanted key or spam a duplicate sign.requestFace.
                var planB = StationModulePlacement.Resolve(read.Index, new StationPlacementRequest {
                    ToolType = "sign-ceiling",
                    Hit = new StationPlacementHit(5, 4, -5, 5, 4, -4, true, new StationPoint(5.5, 4.5, -4), -4),
                    SignFrontJson = customFront,
                    SignBackJson = customBack,
                });
                Assert.IsTrue(planB.Ok, planB.Reason);
                preview.Show(planB);
                Assert.AreEqual(1, sent.Count, "re-hovering preserves cache subscription without duplicate request");

                var ghostB = previewGo.GetComponentInChildren<StationSignView>(true);
                Assert.IsNotNull(ghostB);
                var outbound = JObject.Parse(sent[0]);
                string reqId = (string)outbound["payload"]["requestId"];
                var faces = (JArray)outbound["payload"]["faces"];
                Assert.AreEqual(2, faces.Count, "both front and back faces were requested");
                var paintedMeta = new JArray();
                foreach (JObject face in faces) {
                    string key = (string)face["key"];
                    string faceName = (string)face["face"];
                    string moduleId = (string)face["moduleId"];
                    var req = ghostB.FaceRequest(faceName == "back" ? StationSignFaceName.Back : StationSignFaceName.Front);
                    int pw = req.PlateWidth;
                    int ph = req.PlateHeight;
                    var png = MakeTestPng(pw, ph, new Color32(240, 200, 40, 255));
                    var chunk = new JObject {
                        ["type"] = "sign.faceChunk",
                        ["payload"] = new JObject {
                            ["requestId"] = reqId,
                            ["key"] = key,
                            ["moduleId"] = moduleId,
                            ["face"] = faceName,
                            ["width"] = pw,
                            ["height"] = ph,
                            ["index"] = 0,
                            ["count"] = 1,
                            ["data"] = Convert.ToBase64String(png),
                        },
                    };
                    Assert.IsTrue(StationSignSignage.Receive(chunk.ToString(Formatting.None)));
                    paintedMeta.Add(new JObject {
                        ["key"] = key,
                        ["width"] = pw,
                        ["height"] = ph,
                        ["bytes"] = png.Length,
                    });
                }
                var ready = new JObject {
                    ["type"] = "sign.faceReady",
                    ["payload"] = new JObject {
                        ["requestId"] = reqId,
                        ["artReady"] = true,
                        ["painted"] = paintedMeta,
                        ["pending"] = new JArray(),
                    },
                };
                Assert.IsTrue(StationSignSignage.Receive(ready.ToString(Formatting.None)));
                StationSignSignage.Pump();

                Assert.IsNotNull(ghostB.Front.AppliedTexture, "front face receives painted sign content");
                Assert.IsNotNull(ghostB.Back.AppliedTexture, "back face receives painted sign content");
                Assert.AreSame(ghostB.Front.AppliedTexture, ghostB.Front.Material.mainTexture);
                Assert.Less(ghostB.Front.Material.GetColor("_BaseColor").a, 1f, "sign face stays translucent");
                Assert.AreEqual((float)UnityEngine.Rendering.CullMode.Back, ghostB.Front.Material.GetFloat("_Cull"),
                    "sign face remains single-sided so rotation orientation is readable");

                // Clearing the ghost releases all live texture references cleanly.
                preview.ClearGhost();
                Assert.AreEqual(0, StationSignSignage.Cache.LiveTextureCount, "ClearGhost unsubscribes preview bindings");
            } finally {
                StationSignSignage.SendHook = null;
                UnityEngine.Object.DestroyImmediate(previewGo);
                world.Dispose();
                UnityEngine.Object.DestroyImmediate(worldRoot);
            }
        }
    }
}
