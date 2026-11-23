using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Reproducible EditMode benchmark and parity suite for road preview, commit (add &amp; erase),
    /// and undo on the shipped Zoo demo station (plan 37 §6.5).
    /// </summary>
    public sealed class StationRoadDeltaPerfTests {
        readonly List<GameObject> cleanup = new List<GameObject>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanup.Count - 1; i >= 0; i--) {
                if (cleanup[i] != null) UnityEngine.Object.DestroyImmediate(cleanup[i]);
            }
            cleanup.Clear();
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationToolSelection.Reset();
            StationCellTool.Reset();
            StationRoadTool.Reset();
            StationScenePicker.Reset();
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        [Test]
        public void MeasureRoadPreviewCommitEraseAndUndoOnZoo() {
            string repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
            string zooPath = Path.Combine(Application.dataPath, "StationDesigner", "Demos", "zoo.metro.json");
            Assert.IsTrue(File.Exists(zooPath), "Zoo demo missing: " + zooPath);
            string zooJson = File.ReadAllText(zooPath);

            // Register standard station renderers (excluding GPU RenderTexture TV painters for -nographics batchmode)
            // so the timing reflects real retained vs full rebuild cost across Zoo's 4,299 modules.
            StationRenderers.Clear();
            StationRenderers.Add(new StationCellRenderer());
            StationRenderers.Add(new StationRoadRenderer());
            StationRenderers.Add(new StationEquipmentModuleRenderer());
            StationRenderers.Add(new StationStructureModuleRenderer());
            StationRenderers.Add(new OpeningModuleRenderer());
            StationRenderers.Add(new VerticalModuleRenderer());
            StationRenderers.Add(new StationContactShadowRenderer());

            var hostGo = new GameObject("road-perf-host");
            cleanup.Add(hostGo);
            var host = hostGo.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            host.catalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.trainCatalogue = UnityEditor.AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            host.stationShader = StationFinishLibrary.FindShader();
            host.font = UnityEditor.AssetDatabase.LoadAssetAtPath<Font>("Assets/StationDesigner/Fonts/NotoSansSC.ttf");
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var opened = host.OpenDocument(zooJson, "zoo");
            Assert.IsTrue(opened.Accepted, opened.Rejection?.Reason ?? "open failed");

            // Branch a perpendicular 6 m two-way road southward from road-3976 (y=-15..-3, centre y=-9) at x=40.
            var addReq = new RoadEditRequest {
                mode = "add",
                z = 0,
                from = new[] { 40.0, -9.0 },
                to = new[] { 40.0, -35.0 },
                width = 6,
                direction = "two-way",
                rot = 0,
                expectedRevision = -1,
            };

            const int warmups = 1;
            const int trials = 3;
            var previewMs = new List<double>();
            var addMs = new List<double>();
            var undoAddMs = new List<double>();
            var eraseMs = new List<double>();
            var undoEraseMs = new List<double>();
            int localBefore = 0, fullBefore = 0, localAfter = 0, fullAfter = 0;

            for (int iter = 0; iter < warmups + trials; iter++) {
                bool record = iter >= warmups;
                if (iter == warmups) {
                    localBefore = StationEditSession.LocalEdits;
                    fullBefore = StationEditSession.FullEdits;
                }

                // 1. Preview
                var sw = Stopwatch.StartNew();
                Assert.IsTrue(StationRoadEditService.TryPreview(host, addReq, out var prev, out var pCode), pCode);
                sw.Stop();
                Assert.IsTrue(prev.Valid);
                if (record) previewMs.Add(sw.Elapsed.TotalMilliseconds);

                // 2. Commit (add)
                var beforeIds = new HashSet<string>(host.Index.Document.Modules.Where(m => m.Type == "road").Select(m => m.Id));
                sw.Restart();
                Assert.IsTrue(StationRoadEditService.TryCommit(host, addReq, out var cCode, out var cReason), cCode ?? cReason);
                sw.Stop();
                if (record) addMs.Add(sw.Elapsed.TotalMilliseconds);

                string addedId = host.Index.Document.Modules
                    .First(m => m.Type == "road" && !beforeIds.Contains(m.Id)).Id;

                // 3. Commit (erase the newly added road)
                var eraseReq = new RoadEditRequest {
                    mode = "delete",
                    z = 0,
                    from = new[] { 40.0, -25.0 },
                    to = new[] { 40.0, -25.0 },
                    pickedId = addedId,
                    expectedRevision = -1,
                };
                sw.Restart();
                Assert.IsTrue(StationRoadEditService.TryCommit(host, eraseReq, out var eCode, out var eReason), eCode ?? eReason);
                sw.Stop();
                if (record) eraseMs.Add(sw.Elapsed.TotalMilliseconds);

                // 4. Undo erase
                sw.Restart();
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var u1Code), u1Code);
                sw.Stop();
                if (record) undoEraseMs.Add(sw.Elapsed.TotalMilliseconds);

                // 5. Undo add (restores exact initial Zoo state)
                sw.Restart();
                Assert.IsTrue(StationEditSession.TryUndo(host, out _, out var u2Code), u2Code);
                sw.Stop();
                if (record) undoAddMs.Add(sw.Elapsed.TotalMilliseconds);
            }

            localAfter = StationEditSession.LocalEdits;
            fullAfter = StationEditSession.FullEdits;

            string report = string.Format(CultureInfo.InvariantCulture,
                "ROAD_PERF zoo_modules={0} trials={1} local_edits={2} full_edits={3} " +
                "preview_median_ms={4:F2} add_median_ms={5:F2} erase_median_ms={6:F2} " +
                "undo_erase_median_ms={7:F2} undo_add_median_ms={8:F2}",
                host.Index.Document.ModuleCount, trials,
                localAfter - localBefore, fullAfter - fullBefore,
                Median(previewMs), Median(addMs), Median(eraseMs), Median(undoEraseMs), Median(undoAddMs));

            UnityEngine.Debug.Log(report);
            string outDir = Path.Combine(repoRoot, ".preview", "unity");
            Directory.CreateDirectory(outDir);
            File.WriteAllText(Path.Combine(outDir, "road-perf-latest.txt"), report + "\n");
        }

        static double Median(List<double> values) {
            var sorted = values.OrderBy(v => v).ToList();
            return sorted[sorted.Count / 2];
        }
    }
}
