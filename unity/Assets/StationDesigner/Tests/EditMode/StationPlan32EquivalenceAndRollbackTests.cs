using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Plan 32 §4 Completion Gates 1 &amp; 2:
    /// 1. Zoo remote strip delete, full save reopen, undo/redo, and delta/resync commit payload parity.
    /// 2. Reference-builder equivalence across deterministic multi-step edit sequences (shifted storeys,
    ///    16 m chunk seams, cut shapes, finishes, grade/interior holes, ramps, PSDs, support cascades,
    ///    bounds expansion/shrink, undo/redo) comparing incremental Document/Index, <see cref="StationCellMeshWorkspace"/>,
    ///    and <see cref="StationWalkGraphWorkspace"/>/<c>StageCellDelta</c> against full <see cref="StationDocumentReader.Read"/>,
    ///    <see cref="StationCellMesher.Mesh"/>, and <see cref="StationWalkGraphBuilder.Build"/>.
    /// 3. Stage failure injection and rollback across all three installation boundaries (document, retained view, simulation).
    /// </summary>
    public sealed class StationPlan32EquivalenceAndRollbackTests {
        static string ZooDemoPath => Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json");

        GameObject rootObject;

        [SetUp]
        public void SetUp() {
            StationWorldView.LocalStageFailureInjector = null;
            StationSimulationHost.SimStageFailureInjector = null;
            StationToolSelection.Reset();
            StationEditSession.Reset();
            rootObject = new GameObject("StationPlan32Tests");
        }

        [TearDown]
        public void TearDown() {
            StationWorldView.LocalStageFailureInjector = null;
            StationSimulationHost.SimStageFailureInjector = null;
            StationEditHost.ResetForTests();
            if (rootObject != null) UnityEngine.Object.DestroyImmediate(rootObject);
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
            StationToolSelection.Reset();
            StationEditSession.Reset();
        }

        static StationGameHost CreateHost(bool registerCellAndModuleViews = false) {
            var hostGo = new GameObject(StationGameHost.ObjectName);
            hostGo.transform.SetParent(GameObject.Find("StationPlan32Tests").transform, false);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
#if UNITY_EDITOR
            if (registerCellAndModuleViews) {
                host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(
                    "Assets/StationDesigner/Generated/RuntimeCatalogue.asset");
                host.stationShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            }
#endif
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);
            StationEditFeature.Attach(host);
            StationEditHost.Ensure().Bind(host);
            if (registerCellAndModuleViews) {
                host.RegisterRenderer(new StationCellRenderer());
                host.RegisterRenderer(new StationStructureModuleRenderer());
                host.RegisterRenderer(new OpeningModuleRenderer());
                host.RegisterRenderer(new VerticalModuleRenderer());
            }
            return host;
        }

        static string Cmd(string type, JObject payload = null, string id = null, int? expectedRevision = null) {
            var obj = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = id ?? ("cmd-" + Guid.NewGuid().ToString("N")),
                ["sessionId"] = "s-plan32",
                ["type"] = type,
                ["payload"] = payload ?? new JObject(),
            };
            if (expectedRevision.HasValue) obj["expectedRevision"] = expectedRevision.Value;
            return obj.ToString(Formatting.None);
        }

        static string CanonicalNodeKey(StationWalkGraph g, int node) {
            if (node < 0 || node >= g.NodeCount) return "<none>";
            if (g.NodeKey != null && node < g.NodeKey.Length && !string.IsNullOrEmpty(g.NodeKey[node])) return g.NodeKey[node];
            int x = (int)Math.Round(g.NodeX[node] - 0.5);
            int y = (int)Math.Round(g.NodeY[node] - 0.5);
            int z = (int)Math.Round(g.NodeZ[node] - 1.0);
            return StationWalkGraph.CellKey(x, y, z);
        }

        static void AssertDocumentAndIndexMatchFullRead(string stepLabel, StationDocument incDoc, StationIndex incIdx) {
            string serialized = incDoc.NormalizedJson;
            var full = StationDocumentReader.Read(serialized, new StationSource("ref", ""));

            Assert.AreEqual(full.Document.EnsureContentHash(), incDoc.EnsureContentHash(), stepLabel + ": content hash");
            Assert.AreEqual(full.Document.Cells.Count, incDoc.Cells.Count, stepLabel + ": cell count");
            Assert.AreEqual(full.Document.Modules.Count, incDoc.Modules.Count, stepLabel + ": module count");
            Assert.AreEqual(full.Index.Bounds.ToString(), incIdx.Bounds.ToString(), stepLabel + ": bounds");
            CollectionAssert.AreEqual(full.Index.Levels, incIdx.Levels, stepLabel + ": levels");

            foreach (var fCell in full.Document.Cells) {
                var iCell = incIdx.GetCell(fCell.Key);
                Assert.IsNotNull(iCell, stepLabel + ": missing indexed cell " + fCell.Key);
                Assert.AreEqual(fCell.RawJson, iCell.RawJson, stepLabel + ": cell RawJson at " + fCell.Key);
            }
            foreach (var fMod in full.Document.Modules) {
                Assert.IsTrue(incIdx.TryGetModule(fMod.Id, out var iMod), stepLabel + ": missing indexed module " + fMod.Id);
                Assert.AreEqual(fMod.RawJson, iMod.RawJson, stepLabel + ": module RawJson for " + fMod.Id);
            }
        }

        static void AssertMeshMatchesReference(
            string stepLabel,
            Dictionary<StationCellMeshWorkspace.ChunkBandKey, List<StationCellMeshGroup>> retained,
            StationDocument doc) {
            var refInput = StationCellRenderer.BuildInput(doc, null, null, null);
            var fullMesh = StationCellMesher.Mesh(refInput);

            var retainedGroups = retained.Values
                .SelectMany(g => g)
                .Where(g => g.TriangleCount > 0)
                .OrderBy(g => g.GroupKey, StringComparer.Ordinal)
                .ToList();
            var fullGroups = fullMesh.Groups
                .Where(g => g.TriangleCount > 0)
                .OrderBy(g => g.GroupKey, StringComparer.Ordinal)
                .ToList();

            Assert.AreEqual(fullGroups.Count, retainedGroups.Count, stepLabel + ": mesh group count");
            for (int i = 0; i < fullGroups.Count; i++) {
                var rg = retainedGroups[i];
                var fg = fullGroups[i];
                Assert.AreEqual(fg.GroupKey, rg.GroupKey, stepLabel + ": group key");
                Assert.AreEqual(fg.TriangleCount, rg.TriangleCount, stepLabel + " [" + fg.GroupKey + "]: triangles");
                Assert.AreEqual(fg.VertexCount, rg.VertexCount, stepLabel + " [" + fg.GroupKey + "]: vertices");
                Assert.AreEqual(fg.HasAnchor, rg.HasAnchor, stepLabel + " [" + fg.GroupKey + "]: HasAnchor");
                Assert.AreEqual(fg.Anchor, rg.Anchor, stepLabel + " [" + fg.GroupKey + "]: Anchor");
                for (int v = 0; v < fg.VertexCount; v++) {
                    Assert.LessOrEqual((rg.Positions[v] - fg.Positions[v]).sqrMagnitude, 1e-10f, stepLabel + " [" + fg.GroupKey + "]: pos " + v);
                    Assert.LessOrEqual((rg.Normals[v] - fg.Normals[v]).sqrMagnitude, 1e-10f, stepLabel + " [" + fg.GroupKey + "]: normal " + v);
                    Assert.AreEqual(fg.Colors[v].r, rg.Colors[v].r, 1e-5f, stepLabel + " [" + fg.GroupKey + "]: AO " + v);
                }
                for (int t = 0; t < fg.TriangleCount; t++) {
                    var rf = rg.LocalFaces[rg.LocalTriangleFaces[t]];
                    var ff = fg.LocalFaces[fg.LocalTriangleFaces[t]];
                    Assert.AreEqual(ff.CellKey, rf.CellKey, stepLabel + " [" + fg.GroupKey + "]: tri cell " + t);
                    Assert.AreEqual(ff.Face, rf.Face, stepLabel + " [" + fg.GroupKey + "]: tri face " + t);
                    Assert.AreEqual(ff.FinishId, rf.FinishId, stepLabel + " [" + fg.GroupKey + "]: tri finish " + t);
                }
            }
        }

        static void AssertGraphMatchesReference(string stepLabel, StationWalkGraph inc, StationDocument doc, StationIndex idx) {
            var fullProj = StationSessionProjection.Document(doc, idx);
            var full = StationWalkGraphBuilder.Build(fullProj);

            Assert.AreEqual(full.NodeCount, inc.NodeCount, stepLabel + ": NodeCount");
            Assert.AreEqual(full.StationArea, inc.StationArea, 1e-6, stepLabel + ": StationArea");
            Assert.AreEqual(full.MinX, inc.MinX, stepLabel + ": MinX");
            Assert.AreEqual(full.MaxX, inc.MaxX, stepLabel + ": MaxX");
            Assert.AreEqual(full.MinY, inc.MinY, stepLabel + ": MinY");
            Assert.AreEqual(full.MaxY, inc.MaxY, stepLabel + ": MaxY");
            CollectionAssert.AreEqual(full.LevelsZ, inc.LevelsZ, stepLabel + ": LevelsZ");
            CollectionAssert.AreEqual(full.Unported, inc.Unported, stepLabel + ": Unported");

            for (int f = 0; f < full.NodeCount; f++) {
                string key = CanonicalNodeKey(full, f);
                Assert.IsTrue(inc.TryNode(key, out int u), stepLabel + ": missing node " + key);
                Assert.AreEqual(full.NodeX[f], inc.NodeX[u], 1e-9, stepLabel + ": NodeX " + key);
                Assert.AreEqual(full.NodeY[f], inc.NodeY[u], 1e-9, stepLabel + ": NodeY " + key);
                Assert.AreEqual(full.NodeZ[f], inc.NodeZ[u], 1e-9, stepLabel + ": NodeZ " + key);
                Assert.AreEqual(full.NodeSpeed[f], inc.NodeSpeed[u], 1e-9, stepLabel + ": NodeSpeed " + key);
                Assert.AreEqual(full.NodeZone[f], inc.NodeZone[u], stepLabel + ": NodeZone " + key);

                var incTo = inc.AdjTo[u];
                var fullTo = full.AdjTo[f];
                Assert.AreEqual(fullTo.Length, incTo.Length, stepLabel + ": degree " + key);
                for (int e = 0; e < fullTo.Length; e++) {
                    Assert.AreEqual(CanonicalNodeKey(full, fullTo[e]), CanonicalNodeKey(inc, incTo[e]), stepLabel + ": edge target " + key + "#" + e);
                    Assert.AreEqual(full.AdjKind[f][e], inc.AdjKind[u][e], stepLabel + ": edge kind " + key + "#" + e);
                    Assert.AreEqual(full.AdjCost[f][e], inc.AdjCost[u][e], 1e-9, stepLabel + ": edge cost " + key + "#" + e);
                }
            }

            Assert.AreEqual(full.Servers.Count, inc.Servers.Count, stepLabel + ": Servers.Count");
            for (int s = 0; s < full.Servers.Count; s++) {
                Assert.AreEqual(full.Servers[s].Kind, inc.Servers[s].Kind, stepLabel + ": server kind " + s);
                Assert.AreEqual(CanonicalNodeKey(full, full.Servers[s].Node), CanonicalNodeKey(inc, inc.Servers[s].Node), stepLabel + ": server node " + s);
                Assert.AreEqual(CanonicalNodeKey(full, full.Servers[s].ExitNode), CanonicalNodeKey(inc, inc.Servers[s].ExitNode), stepLabel + ": server exit " + s);
            }

            Assert.AreEqual(full.Exits.Count, inc.Exits.Count, stepLabel + ": Exits.Count");
            Assert.AreEqual(full.Platforms.Count, inc.Platforms.Count, stepLabel + ": Platforms.Count");

            var incPlanner = new StationRoutePlanner(inc);
            var fullPlanner = new StationRoutePlanner(full);
            for (int ex = 0; ex < full.Exits.Count; ex++) {
                string exKey = CanonicalNodeKey(full, full.Exits[ex].Node);
                if (!inc.TryNode(exKey, out int iu) || !full.TryNode(exKey, out int fu)) continue;
                for (int pl = 0; pl < full.Platforms.Count; pl++) {
                    if (full.Platforms[pl].Doors.Length == 0) continue;
                    string dKey = CanonicalNodeKey(full, full.Platforms[pl].Doors[0]);
                    if (!inc.TryNode(dKey, out int idoor) || !full.TryNode(dKey, out int fdoor)) continue;
                    foreach (bool stepFree in new[] { false, true }) {
                        var needs = new StationRouteNeeds { StepFree = stepFree };
                        var rInc = incPlanner.Search(iu, idoor, needs);
                        var rFull = fullPlanner.Search(fu, fdoor, needs);
                        Assert.AreEqual(rFull.Found, rInc.Found, stepLabel + ": A* Found " + exKey + "->" + dKey + " sf=" + stepFree);
                        if (rFull.Found) Assert.AreEqual(rFull.Cost, rInc.Cost, 1e-6, stepLabel + ": A* Cost " + exKey + "->" + dKey);
                    }
                }
            }
        }

        static string BuildShiftedStoreyTestSave() {
            // Level base 3 puts the platform at -7, the concourse at -2 and the next floor at 3.
            var cells = new JArray();
            // Concourse slab across 16 m chunk seam x=13..18, y=13..18 at z = -2:
            for (int x = 13; x <= 18; x++) {
                for (int y = 13; y <= 18; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = -2, ["fill"] = "solid",
                        ["zone"] = "unpaid",
                        ["finish"] = new JObject { ["top"] = "floor.granite" },
                    });
                }
            }
            // Platform slab x=12..24, y=12..17 at z = -7 + track trench x=12..24, y=11 at z = -8:
            for (int x = 12; x <= 24; x++) {
                cells.Add(new JObject {
                    ["x"] = x, ["y"] = 11, ["z"] = -8, ["fill"] = "solid",
                    ["zone"] = "restricted",
                    ["finish"] = new JObject { ["top"] = "floor.track" },
                });
                for (int y = 12; y <= 17; y++) {
                    cells.Add(new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = -7, ["fill"] = "solid",
                        ["zone"] = "platform",
                        ["finish"] = new JObject { ["top"] = "floor.concrete" },
                    });
                }
            }
            // Authored solid cell at street grade (26, 15, 0) for grade dig -> void hole -> fill back to virtual street:
            cells.Add(new JObject {
                ["x"] = 26, ["y"] = 15, ["z"] = 0, ["fill"] = "solid",
                ["zone"] = "outside",
                ["finish"] = new JObject { ["top"] = "floor.concrete" },
            });

            // At the shifted upper-course boundary, (15,19,2) is an inferred
            // ceiling until the next-storey floor extends over the chunk seam.
            foreach (var (x, z) in new[] { (15, -2), (15, 2), (16, -2), (16, 1), (16, 2) }) {
                cells.Add(new JObject { ["x"] = x, ["y"] = 19, ["z"] = z, ["fill"] = "solid" });
            }
            cells.Add(new JObject { ["x"] = 15, ["y"] = 19, ["z"] = 0, ["fill"] = "void" });

            var modules = new JArray {
                // Street exit at (14, 10, 0):
                new JObject {
                    ["id"] = "exit-a", ["type"] = "exit", ["x"] = 14, ["y"] = 10, ["z"] = 0, ["rot"] = 0,
                    ["cfg"] = new JObject { ["name"] = "A", ["headHouse"] = true },
                },
                // Stair from street (14, 13, 0) down to concourse (14, 15, -2):
                new JObject {
                    ["id"] = "stair-street", ["type"] = "stair", ["x"] = 14, ["y"] = 13, ["z"] = -2, ["rot"] = 0,
                    ["from"] = new JArray(14, 13, 0), ["to"] = new JArray(14, 15, -2),
                    ["w"] = 1, ["h"] = 3,
                    ["cfg"] = new JObject(),
                },
                // Escalator from concourse (16, 14, -2) down to platform (16, 17, -7):
                new JObject {
                    ["id"] = "esc-plat", ["type"] = "escalator", ["x"] = 16, ["y"] = 14, ["z"] = -7, ["rot"] = 0,
                    ["from"] = new JArray(16, 14, -2), ["to"] = new JArray(16, 17, -7),
                    ["w"] = 1, ["h"] = 6,
                    ["cfg"] = new JObject(),
                },
                // Gate on concourse (15, 14, -2):
                new JObject {
                    ["id"] = "gate-1", ["type"] = "gate", ["x"] = 15, ["y"] = 14, ["z"] = -2, ["rot"] = 0,
                    ["cfg"] = new JObject { ["dir"] = "both", ["door"] = "lane" },
                },
                // Bench on concourse (18, 18, -2) to exercise support cascade on floor delete:
                new JObject {
                    ["id"] = "bench-cascade", ["type"] = "bench", ["x"] = 18, ["y"] = 18, ["z"] = -2, ["rot"] = 0,
                    ["cfg"] = new JObject(),
                },
                // Track + platform-edge (PSD) at y=11/12, z=-7:
                new JObject {
                    ["id"] = "track-1", ["type"] = "track", ["x"] = 12, ["y"] = 11, ["z"] = -7, ["rot"] = 0,
                    ["w"] = 13, ["h"] = 1,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up" },
                },
                new JObject {
                    ["id"] = "edge-1", ["type"] = "platform-edge", ["x"] = 12, ["y"] = 12, ["z"] = -7, ["rot"] = 0,
                    ["w"] = 13, ["h"] = 1,
                    ["cfg"] = new JObject { ["line"] = "1", ["from"] = "track-1", ["side"] = "right", ["psd"] = "full" },
                },
                new JObject {
                    ["id"] = "psd-end-1", ["type"] = "psd-end", ["x"] = 12, ["y"] = 12, ["z"] = -7, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1" },
                },
                new JObject {
                    ["id"] = "hanger-1", ["type"] = "hanger", ["x"] = 17, ["y"] = 15, ["z"] = -2, ["rot"] = 0,
                    ["w"] = 2, ["h"] = 1,
                    ["cfg"] = new JObject { ["mount"] = "roof" },
                },
            };

            var lines = new JArray {
                new JObject {
                    ["id"] = "1", ["name"] = "1号线", ["nameEn"] = "Line 1", ["colour"] = "#f0b429",
                    ["stock"] = "B", ["cars"] = 2, ["power"] = "overhead", ["psd"] = "full", ["direction"] = "up",
                    ["headwayProfile"] = new JObject { ["peak"] = 120, ["offpeak"] = 240, ["late"] = 480 },
                },
            };

            var envelope = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "错层验证站",
                ["nameEn"] = "Shifted Storey",
                ["city"] = "guangzhou",
                ["seed"] = 998877,
                ["levelBase"] = 3,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = cells,
                    ["modules"] = modules,
                    ["lines"] = lines,
                },
            };
            return StationDocumentReader.Read(envelope.ToString(Formatting.None), StationSource.None).Document.NormalizedJson;
        }

        [Test]
        public void ReferenceBuildersMatchIncrementalDocumentIndexMeshAndWalkGraphAcrossAllDeterministicScenarios() {
            var host = CreateHost(registerCellAndModuleViews: true);
            var openReply = JObject.Parse(host.SendForTest(Cmd("station.open", new JObject { ["document"] = BuildShiftedStoreyTestSave() }, "open-shifted")));
            Assert.AreEqual("commit", (string)openReply["kind"]);
            Assert.IsNotNull(openReply["payload"]["document"], "initial open emits full document");
            Assert.IsNull(openReply["payload"]["delta"]);

            var simHost = (StationSimulationHost)host.Simulation;
            simHost.Session.TryApplyCommand(SimCommandKind.Play, true, 0, out _);
            host.Coordinator.Tick(35.0);

            var initInput = StationCellRenderer.BuildInput(host.Document, null, null, null);
            var unthinned = new Dictionary<StationCellKey, StationCellShape>(host.Document.Cells.Count);
            foreach (var c in host.Document.Cells) if (c.IsSolid) unthinned[c.Key] = StationCellRules.ShapeOf(c.Tags);
            var meshWs = StationCellMeshWorkspace.Create(initInput, StationRampOpenings.PrepareOpenings(host.Index), unthinned);
            var retainedMesh = meshWs.MeshAll();

            AssertDocumentAndIndexMatchFullRead("initial", host.Document, host.Index);
            AssertMeshMatchesReference("initial", retainedMesh, host.Document);
            AssertGraphMatchesReference("initial", simHost.Session.WalkGraph, host.Document, host.Index);
            CheckCeilingSeamPicks();

            var curWorld = StationCellEditWorld.Build(host.Index, new StationCellReservations(host.Index));

            var steps = new (string Name, Func<StationCellEditWorld, StationDocument, StationIndex, StationCellPatch> BuildPatch)[] {
                ("ceiling-seam-upper-fill", (w, _, __) => StationCellPlanner.PlanAddCells(w, new[] {
                    new StationCellKey(16, 19, 3),
                })),
                ("ceiling-seam-upper-open", (w, _, __) => StationCellPlanner.PlanRemoveCells(w, new[] {
                    new StationCellKey(16, 19, 3),
                })),
                ("ceiling-seam-retag", (_, __, ___) => {
                    var patch = new StationCellPatch();
                    patch.Writes.Add(StationCellWrite.AddTags(new StationCellKey(16, 19, 2), new[] { "suspended-ceiling" }));
                    return patch;
                }),
                // 1. 16 m chunk seam (15..16) + shifted storey (-2) auto-floor expansion:
                ("chunk-seam-auto-floor", (w, _, __) => StationCellPlanner.PlanAutoFloor(w, new[] {
                    new StationCellKey(19, 15, -2),
                    new StationCellKey(19, 16, -2),
                })),
                // 2. Interior hole in shifted storey slab (opens interior auto-wall ring):
                ("interior-hole-open", (w, _, __) => StationCellPlanner.PlanRemoveCells(w, new[] {
                    new StationCellKey(15, 16, -2),
                })),
                // 3. Cut shapes (thin wall + corner cut across chunk seam):
                ("cut-shapes", (w, _, __) => StationCellPlanner.PlanWalls(w, new[] {
                    new StationCellKey(15, 15, -1),
                    new StationCellKey(16, 15, -1),
                }, StationWallSide.N, 1)),
                // 4. Finish paint + contact finish exposure/covering:
                ("finish-paint", (_, __, ___) => {
                    var p = new StationCellPatch();
                    p.Writes.Add(StationCellWrite.PaintFace(new StationCellKey(17, 17, -2), "top", "floor.marble#224466"));
                    p.Writes.Add(StationCellWrite.PaintFace(new StationCellKey(15, 15, -1), "n", "wall.enamel#4488cc"));
                    return p;
                }),
                // 5. At-grade street hole dig & fill (z = 0):
                ("grade-hole-dig", (w, _, __) => StationCellPlanner.PlanRemoveCells(w, new[] {
                    new StationCellKey(26, 15, 0),
                })),
                ("grade-hole-fill", (w, _, __) => StationCellPlanner.PlanAddCells(w, new[] {
                    new StationCellKey(26, 15, 0),
                })),
                // 6. Near-ramp + near-PSD floor extension:
                ("near-ramp-and-psd", (w, _, __) => StationCellPlanner.PlanAddCells(w, new[] {
                    new StationCellKey(17, 17, -7),
                    new StationCellKey(13, 18, -7),
                })),
                // 7. Support cascade (delete (18,18,-2) supporting bench-cascade):
                ("support-cascade-delete", (w, _, __) => StationCellPlanner.PlanRemoveCells(w, new[] {
                    new StationCellKey(18, 18, -2),
                })),
                // 8. Outer bounds expansion & shrink:
                ("bounds-expand", (w, _, __) => StationCellPlanner.PlanAddCells(w, new[] {
                    new StationCellKey(32, 32, -2),
                })),
                ("bounds-shrink", (w, _, __) => StationCellPlanner.PlanRemoveCells(w, new[] {
                    new StationCellKey(32, 32, -2),
                })),
            };

            int appliedSteps = 0;
            for (int i = 0; i < steps.Length; i++) {
                var (name, build) = steps[i];
                var prevIndex = host.Index;
                var patch = build(curWorld, host.Document, host.Index);
                Assert.IsTrue(patch != null && patch.HasWork, name + " must produce work");

                using var metrics = StationEditTrace.BeginMetrics();
                Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, name, "step-" + i, out var loadRes, out var errCode),
                    name + " failed: " + errCode);
                Assert.IsTrue(loadRes.Accepted, name + " accepted");
                Assert.IsTrue(metrics.Metrics.UsedLocalDocument, name + " used local document");
                Assert.IsTrue(metrics.Metrics.UsedIncrementalGraph, name + " used incremental walk graph");

                // Verify BuildCommitPayload emits delta (no eager full document):
                var commitPayload = host.BuildCommitPayload();
                Assert.IsNull(commitPayload["document"], name + ": local commit omits full document");
                Assert.IsNotNull(commitPayload["delta"], name + ": local commit carries delta");
                Assert.AreEqual(StationGameHost.CommitDeltaSchemaVersion, (int)commitPayload["delta"]["schemaVersion"]);
                Assert.AreEqual(host.CurrentRevision, (int)commitPayload["delta"]["revision"]);

                var stagedMesh = meshWs.StageDocumentDelta(host.Document, host.Index, host.Coordinator.CommittedRead.LocalDelta, prevIndex);
                stagedMesh.Commit();
                foreach (var kv in stagedMesh.GroupsByChunk) retainedMesh[kv.Key] = kv.Value;

                AssertDocumentAndIndexMatchFullRead("step:" + name, host.Document, host.Index);
                AssertMeshMatchesReference("step:" + name, retainedMesh, host.Document);
                AssertGraphMatchesReference("step:" + name, simHost.Session.WalkGraph, host.Document, host.Index);
                if (name.StartsWith("ceiling-seam-", StringComparison.Ordinal)) CheckCeilingSeamPicks();
                Assert.IsTrue(simHost.Session.Services.AllWalkingRoutesMatchCurrentGraph(), name + ": active passenger routes valid");

                if (name == "support-cascade-delete") {
                    Assert.IsFalse(host.Index.TryGetModule("bench-cascade", out _), "bench-cascade must be removed when support slab is deleted");
                }

                host.Coordinator.Tick(2.0);
                curWorld = curWorld.ApplyLocalDelta(host.Index, host.Coordinator.CommittedRead.LocalDelta);
                appliedSteps++;
            }

            // Full Undo chain back to revision 0, verifying parity + delta payload at every undo!
            for (int u = appliedSteps - 1; u >= 0; u--) {
                var prevIndex = host.Index;
                var undoReply = JObject.Parse(host.SendForTest(Cmd("edit.undo", new JObject(), "undo-" + u)));
                Assert.AreEqual("commit", (string)undoReply["kind"], "undo " + u);
                Assert.IsNull(undoReply["payload"]["document"], "undo " + u + " emits delta");
                Assert.IsNotNull(undoReply["payload"]["delta"], "undo " + u + " carries delta");

                var stagedMesh = meshWs.StageDocumentDelta(host.Document, host.Index, host.Coordinator.CommittedRead.LocalDelta, prevIndex);
                stagedMesh.Commit();
                foreach (var kv in stagedMesh.GroupsByChunk) retainedMesh[kv.Key] = kv.Value;

                AssertDocumentAndIndexMatchFullRead("undo-" + u, host.Document, host.Index);
                AssertMeshMatchesReference("undo-" + u, retainedMesh, host.Document);
                AssertGraphMatchesReference("undo-" + u, simHost.Session.WalkGraph, host.Document, host.Index);
                if (u < 3) CheckCeilingSeamPicks();
            }
            Assert.IsTrue(host.Index.TryGetModule("bench-cascade", out _), "undo restores cascaded module");

            // Redo 3 steps forward + explicit station.resync full-document verification:
            for (int r = 0; r < 3; r++) {
                var prevIndex = host.Index;
                var redoReply = JObject.Parse(host.SendForTest(Cmd("edit.redo", new JObject(), "redo-" + r)));
                Assert.AreEqual("commit", (string)redoReply["kind"], "redo " + r);
                Assert.IsNotNull(redoReply["payload"]["delta"], "redo " + r + " carries delta");

                var stagedMesh = meshWs.StageDocumentDelta(host.Document, host.Index, host.Coordinator.CommittedRead.LocalDelta, prevIndex);
                stagedMesh.Commit();
                foreach (var kv in stagedMesh.GroupsByChunk) retainedMesh[kv.Key] = kv.Value;

                AssertDocumentAndIndexMatchFullRead("redo-" + r, host.Document, host.Index);
                AssertMeshMatchesReference("redo-" + r, retainedMesh, host.Document);
                AssertGraphMatchesReference("redo-" + r, simHost.Session.WalkGraph, host.Document, host.Index);
                CheckCeilingSeamPicks();
            }

            var resyncReply = JObject.Parse(host.SendForTest(Cmd("station.resync", new JObject(), "resync-check")));
            Assert.AreEqual("commit", (string)resyncReply["kind"]);
            Assert.IsNotNull(resyncReply["payload"]["document"], "station.resync must always carry full document");
            Assert.IsNull(resyncReply["payload"]["delta"], "station.resync omits delta");

            void CheckCeilingSeamPicks() {
                bool upper = host.Index.GetCell(new StationCellKey(16, 19, 3))?.IsSolid ?? false;
                bool tagged = host.Index.GetCell(new StationCellKey(16, 19, 2)).HasTag("suspended-ceiling");
                Pick(15, upper ? StationSurfaceRole.Cell : StationSurfaceRole.Ceiling);
                if (!upper) Pick(16, tagged ? StationSurfaceRole.Ceiling : StationSurfaceRole.Cell);
            }

            void Pick(int x, StationSurfaceRole role) {
                var ray = new Ray(new Vector3(x + .5f, 3.25f, 19.5f), Vector3.down);
                Assert.IsTrue(StationCellRenderer.TryPickWorld(host.Coordinator.World, ray, StationCellPickFilter.Default, out var hit));
                Assert.AreEqual(new StationCellKey(x, 19, 2), hit.CellKey);
                Assert.AreEqual(StationFace.Top, hit.Face);
                Assert.AreEqual(role, hit.Role);
            }
        }

        [Test]
        public void ZooRemoteStripDeleteReopenUndoRedoAndDeltaPayloadParity() {
            var host = CreateHost();
            var zooJson = File.ReadAllText(ZooDemoPath);
            var open = JObject.Parse(host.SendForTest(Cmd("station.open", new JObject { ["document"] = zooJson, ["sourceId"] = "zoo" }, "open-zoo")));
            Assert.AreEqual("commit", (string)open["kind"]);
            string initialHash = host.CurrentSourceHash;

            // Delete (48, 5, -15) on Zoo (Plan 32's exact Zoo remote strip fixture) and verify remote auto-walls are preserved:
            var w0 = StationCellEditWorld.Build(host.Index, new StationCellReservations(host.Index));
            int totalAutoWallsBefore = host.Document.Cells.Count(c => c.HasTag("auto-wall"));
            Assert.Greater(totalAutoWallsBefore, 20, "Zoo has authored auto-walls");

            var delZooTarget = StationCellPlanner.PlanRemoveCells(w0, new[] { new StationCellKey(48, 5, -15) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, delZooTarget, "zoo-del-48-5--15", "zoo-del-1", out _, out var err1), err1);

            var w1 = w0.ApplyLocalDelta(host.Index, host.Coordinator.CommittedRead.LocalDelta);
            var reAddZooTarget = StationCellPlanner.PlanAutoFloor(w1, new[] { new StationCellKey(48, 5, -15) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, reAddZooTarget, "zoo-readd-48-5--15", "zoo-add-2", out _, out var err2), err2);

            var w2 = w1.ApplyLocalDelta(host.Index, host.Coordinator.CommittedRead.LocalDelta);
            var delAgain = StationCellPlanner.PlanRemoveCells(w2, new[] { new StationCellKey(48, 5, -15) });
            Assert.IsTrue(StationEditSession.TryApplyCells(host, delAgain, "zoo-del-again", "zoo-del-3", out _, out var err3), err3);

            int totalAutoWallsAfter = host.Document.Cells.Count(c => c.HasTag("auto-wall"));
            Assert.Greater(totalAutoWallsAfter, totalAutoWallsBefore - 15, "remote auto-walls across Zoo must be preserved");

            // Full save reopen must agree 100%:
            string savedAfterDel = host.Document.NormalizedJson;
            var reopened = StationDocumentReader.Read(savedAfterDel, new StationSource("reopen", ""));
            Assert.AreEqual(host.Document.EnsureContentHash(), reopened.Document.EnsureContentHash(), "reopened hash matches incremental document");
            Assert.AreEqual(host.Document.Cells.Count, reopened.Document.Cells.Count);
            Assert.AreEqual(host.Document.Modules.Count, reopened.Document.Modules.Count);

            // Undo 3 times restores exact initial Zoo hash; Redo 3 times restores exact post-delete hash:
            string postDelHash = host.CurrentSourceHash;
            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.undo", new JObject(), "zoo-u1")))["kind"]);
            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.undo", new JObject(), "zoo-u2")))["kind"]);
            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.undo", new JObject(), "zoo-u3")))["kind"]);
            Assert.AreEqual(initialHash, host.CurrentSourceHash, "undos restore exact Zoo hash");

            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.redo", new JObject(), "zoo-r1")))["kind"]);
            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.redo", new JObject(), "zoo-r2")))["kind"]);
            Assert.AreEqual("commit", (string)JObject.Parse(host.SendForTest(Cmd("edit.redo", new JObject(), "zoo-r3")))["kind"]);
            Assert.AreEqual(postDelHash, host.CurrentSourceHash, "redos restore exact post-delete hash");
        }

        [Test]
        public void StageFailureInjectionRollsBackCleanlyAtDocumentViewAndSimulationBoundaries() {
            var host = CreateHost(registerCellAndModuleViews: true);
            var open = JObject.Parse(host.SendForTest(Cmd("station.open", new JObject { ["document"] = BuildShiftedStoreyTestSave() }, "open-rb")));
            Assert.AreEqual("commit", (string)open["kind"]);

            var simHost = (StationSimulationHost)host.Simulation;
            simHost.Session.TryApplyCommand(SimCommandKind.Play, true, 0, out _);
            host.Coordinator.Tick(25.0);

            int revBaseline = host.CurrentRevision;
            var docBaseline = host.Document;
            var idxBaseline = host.Index;
            var worldBaseline = host.Coordinator.World;
            var graphBaseline = simHost.Session.WalkGraph;
            long simRevBaseline = simHost.Session.SessionRevision;
            int childCountBaseline = worldBaseline.Root.childCount;
            int recordCountBaseline = worldBaseline.Records.Count;
            string hashBaseline = host.CurrentSourceHash;

            // Boundary 1: Document / reader refusal
            var badDocRes = host.ApplyDocumentEdit("{not-json", "bad");
            Assert.IsFalse(badDocRes.Accepted);
            Assert.AreEqual(revBaseline, host.CurrentRevision);
            Assert.AreSame(docBaseline, host.Document);
            Assert.AreSame(graphBaseline, simHost.Session.WalkGraph);

            var editWorld = StationCellEditWorld.Build(host.Index, new StationCellReservations(host.Index));
            var validPatch = StationCellPlanner.PlanAutoFloor(editWorld, new[] { new StationCellKey(19, 15, -2) });
            Assert.IsTrue(validPatch.HasWork);

            // Boundary 2: Retained View staging failure AFTER StationCellRenderer staged its chunk meshes
            string structRole = new StationStructureModuleRenderer().Role;
            StationWorldView.LocalStageFailureInjector = role =>
                role == structRole ? new InvalidOperationException("injected-view-failure") : null;
            try {
                bool ok = StationEditSession.TryApplyCells(host, validPatch, "fail-view", "cmd-fail-view", out var viewFailRes, out var viewFailCode);
                Assert.IsFalse(ok);
                Assert.IsNotNull(viewFailRes);
                Assert.IsFalse(viewFailRes.Accepted);
                Assert.AreEqual("render-failed", viewFailCode);
            } finally {
                StationWorldView.LocalStageFailureInjector = null;
            }

            Assert.AreEqual(revBaseline, host.CurrentRevision, "view failure leaves revision untouched");
            Assert.AreSame(docBaseline, host.Document, "view failure leaves document untouched");
            Assert.AreSame(idxBaseline, host.Index, "view failure leaves index untouched");
            Assert.AreSame(worldBaseline, host.Coordinator.World, "view failure leaves world untouched");
            Assert.AreEqual(childCountBaseline, worldBaseline.Root.childCount, "staged local world GameObject cleaned up on view rollback");
            Assert.AreEqual(recordCountBaseline, worldBaseline.Records.Count, "world records untouched on view rollback");
            Assert.AreSame(graphBaseline, simHost.Session.WalkGraph, "simulation walk graph untouched on view rollback");
            Assert.AreEqual(simRevBaseline, simHost.Session.SessionRevision, "simulation revision untouched on view rollback");

            // Boundary 3: Simulation staging failure AFTER all retained view renderers staged cleanly
            StationSimulationHost.SimStageFailureInjector = _ => throw new InvalidOperationException("injected-sim-failure");
            try {
                bool ok = StationEditSession.TryApplyCells(host, validPatch, "fail-sim", "cmd-fail-sim", out var simFailRes, out var simFailCode);
                Assert.IsFalse(ok);
                Assert.IsNotNull(simFailRes);
                Assert.IsFalse(simFailRes.Accepted);
                Assert.AreEqual("simulation-failed", simFailCode);
            } finally {
                StationSimulationHost.SimStageFailureInjector = null;
            }

            Assert.AreEqual(revBaseline, host.CurrentRevision, "sim failure leaves revision untouched");
            Assert.AreSame(docBaseline, host.Document, "sim failure leaves document untouched");
            Assert.AreEqual(hashBaseline, host.CurrentSourceHash, "sim failure leaves content hash untouched");
            Assert.AreEqual(childCountBaseline, worldBaseline.Root.childCount, "staged local world GameObject cleaned up on sim rollback");
            Assert.AreEqual(recordCountBaseline, worldBaseline.Records.Count, "world records untouched on sim rollback");
            Assert.AreSame(graphBaseline, simHost.Session.WalkGraph, "walk graph untouched on sim rollback");
            Assert.AreEqual(simRevBaseline, simHost.Session.SessionRevision, "session revision untouched on sim rollback");
            Assert.IsTrue(simHost.Session.Services.AllWalkingRoutesMatchCurrentGraph(), "passenger routes untouched on sim rollback");

            // Recovery check: after both rollbacks, applying the exact same local edit succeeds cleanly on the retained fast path!
            using var recoveryMetrics = StationEditTrace.BeginMetrics();
            Assert.IsTrue(StationEditSession.TryApplyCells(host, validPatch, "recover-after-rollbacks", "cmd-recover", out var recRes, out var recErr), recErr);
            Assert.IsTrue(recRes.Accepted);
            Assert.AreEqual(revBaseline + 1, host.CurrentRevision);
            Assert.IsTrue(recoveryMetrics.Metrics.UsedLocalDocument,
                "recovered edit uses local document (fallback=" + recoveryMetrics.Metrics.DocumentFallbackReason + ")");
            Assert.IsTrue(recoveryMetrics.Metrics.UsedRetainedView,
                "recovered edit uses retained view (fallback=" + recoveryMetrics.Metrics.ViewFallbackReason + ")");
            Assert.IsTrue(recoveryMetrics.Metrics.UsedIncrementalGraph,
                "recovered edit uses incremental graph (fallback=" + recoveryMetrics.Metrics.SimFallbackReason + ")");
            AssertDocumentAndIndexMatchFullRead("post-rollback-recovery", host.Document, host.Index);
            AssertGraphMatchesReference("post-rollback-recovery", simHost.Session.WalkGraph, host.Document, host.Index);
        }

        [Test]
        public void AllTwelveNewlyLocalFamiliesStayLocalAndRollBackCleanly() {
            var host = CreateHost(registerCellAndModuleViews: true);
            host.RegisterRenderer(new StationSurfaceModuleRenderer());
            host.RegisterRenderer(new StationStreetModuleRenderer());
            host.RegisterRenderer(new StationEquipmentModuleRenderer());
            host.RegisterRenderer(new StationDisplayModuleRenderer());
            host.RegisterRenderer(new StationContactShadowRenderer());
            host.RegisterRenderer(new StationSignRenderer());
            host.RegisterRenderer(new TrainConsistRenderer());

            var open = JObject.Parse(host.SendForTest(Cmd("station.open", new JObject { ["document"] = BuildShiftedStoreyTestSave() }, "open-12fam")));
            Assert.AreEqual("commit", (string)open["kind"]);

            void AssertLocalPatch(string label, StationCellPatch patch) {
                using var metrics = StationEditTrace.BeginMetrics();
                Assert.IsTrue(StationEditSession.TryApplyCells(host, patch, label, "cmd-" + label, out var res, out var err),
                    $"{label} failed: {err}");
                Assert.IsTrue(res.Accepted, $"{label} not accepted");
                Assert.IsTrue(metrics.Metrics.UsedLocalDocument,
                    $"{label}: expected local document (fallback={metrics.Metrics.DocumentFallbackReason})");
                Assert.IsTrue(metrics.Metrics.UsedRetainedView,
                    $"{label}: expected retained view (fallback={metrics.Metrics.ViewFallbackReason})");
                Assert.IsTrue(metrics.Metrics.UsedIncrementalGraph,
                    $"{label}: expected incremental graph (fallback={metrics.Metrics.SimFallbackReason})");
                AssertDocumentAndIndexMatchFullRead(label, host.Document, host.Index);
            }

            StationEditDraft MakeDraft(string id, string type, int x, int y, int z, int w = 1, int d = 1, int h = 1, params (string k, string v)[] cfg) {
                var draft = new StationEditDraft { Id = id, Type = type, X = x, Y = y, Z = z, Rotation = 0, Width = w, Depth = d, Height = h };
                foreach (var kv in cfg) draft.Config[kv.k] = kv.v;
                return draft;
            }

            // Cover all 11 Tier-3 newly local families + Tier-4 sign (add, rollback, and remove):
            var cases = new (string Label, StationEditDraft Draft)[] {
                ("pillar", MakeDraft("loc-pillar-1", "pillar", 2, 2, -1, 1, 1, 4, ("variant", "thick"))),
                ("roof", MakeDraft("loc-roof-1", "roof", 2, 2, 4, 4, 4, 1, ("variant", "truss"))),
                ("tv", MakeDraft("loc-tv-1", "tv", 3, 3, -1, 1, 1, 1, ("mount", "ceiling"), ("poster", "0"))),
                ("calligraphy", MakeDraft("loc-callig-1", "calligraphy", 4, 1, -1, 2, 1, 1, ("style", "wei-h"))),
                ("linemap", MakeDraft("loc-linemap-1", "linemap", 5, 3, -1, 2, 1, 1, ("variant", "stand"))),
                ("glass", MakeDraft("loc-glass-1", "glass", 6, 3, -1, 2, 1, 2, ("variant", "2x2"))),
                ("booth", MakeDraft("loc-booth-1", "booth", 7, 4, -1, 3, 2, 3, ("kind", "ticket"), ("stocked", "true"))),
                ("track", MakeDraft("loc-track-1", "track", 10, 10, -2, 8, 1, 1, ("line", "L1"))),
                ("exit", MakeDraft("loc-exit-1", "exit", 2, 8, 0, 3, 2, 3, ("name", "A"), ("headHouse", "true"))),
                ("guidepost", MakeDraft("loc-guide-1", "guidepost", 6, 8, 0, 1, 1, 3, ("exitId", "loc-exit-1"))),
                ("psd-end", MakeDraft("loc-psdend-1", "psd-end", 9, 3, -1, 1, 1, 3, ("variant", "cover"))),
                ("sign", MakeDraft("loc-sign-1", "sign", 4, 4, -1, 2, 1, 1, ("mount", "ceiling"), ("preset", "exit"), ("text", "A"))),
            };

            foreach (var c in cases) {
                var addPatch = new StationCellPatch();
                addPatch.ModuleAdds.Add(c.Draft);
                addPatch.Changed = 1;
                AssertLocalPatch("add-" + c.Label, addPatch);
            }

            // Inject failure during a local sign edit to confirm zero leaked staged views on rollback:
            int revBeforeRb = host.CurrentRevision;
            int childCountBeforeRb = host.Coordinator.World.Root.childCount;
            int recCountBeforeRb = host.Coordinator.World.Records.Count;
            StationSimulationHost.SimStageFailureInjector = _ => throw new InvalidOperationException("injected-12fam-rb");
            try {
                var rbPatch = new StationCellPatch();
                rbPatch.ModuleAdds.Add(MakeDraft("loc-rb-sign", "sign", 5, 5, -1, 2, 1, 1, ("mount", "ceiling"), ("preset", "exit"), ("text", "B")));
                rbPatch.Changed = 1;
                Assert.IsFalse(StationEditSession.TryApplyCells(host, rbPatch, "rb-sign", "cmd-rb-sign", out _, out var rbCode));
                Assert.AreEqual("simulation-failed", rbCode);
            } finally {
                StationSimulationHost.SimStageFailureInjector = null;
            }
            Assert.AreEqual(revBeforeRb, host.CurrentRevision);
            Assert.AreEqual(childCountBeforeRb, host.Coordinator.World.Root.childCount);
            Assert.AreEqual(recCountBeforeRb, host.Coordinator.World.Records.Count);

            // Remove all 12 in reverse order and confirm every removal stays 100% local:
            for (int i = cases.Length - 1; i >= 0; i--) {
                var c = cases[i];
                var rmPatch = new StationCellPatch();
                rmPatch.RemoveModuleIds.Add(c.Draft.Id);
                rmPatch.Changed = 1;
                AssertLocalPatch("rm-" + c.Label, rmPatch);
            }
        }
    }
}
