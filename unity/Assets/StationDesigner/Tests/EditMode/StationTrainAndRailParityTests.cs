using System;
using System.Collections.Generic;
using System.Globalization;
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
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Domain D4 parity suite: rolling stock, train cabin lifecycle, train/door alignment,
    /// promoted formation asset audits, third-rail placement, rail/tunnel planning and tools,
    /// covered 5 m clearance, PSD header plaques and PSD end panels.
    /// </summary>
    public sealed class StationTrainAndRailParityTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        const string TanweiPath = "Assets/StationDesigner/Demos/tanwei.metro.json";

        readonly List<UnityEngine.Object> cleanupObjects = new List<UnityEngine.Object>();
        readonly List<StationWorldView> cleanupWorlds = new List<StationWorldView>();

        [TearDown]
        public void TearDown() {
            for (int i = cleanupWorlds.Count - 1; i >= 0; i--) cleanupWorlds[i]?.Dispose();
            cleanupWorlds.Clear();
            for (int i = cleanupObjects.Count - 1; i >= 0; i--) {
                if (cleanupObjects[i] != null) UnityEngine.Object.DestroyImmediate(cleanupObjects[i]);
            }
            cleanupObjects.Clear();
            StationEditHost.ResetForTests();
            StationEditSession.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationToolSelection.Reset();
            StationRenderers.Clear();
            StationFrameSinks.Clear();
            StationCommandHandlers.Clear();
        }

        T Track<T>(T obj) where T : UnityEngine.Object {
            if (obj != null) cleanupObjects.Add(obj);
            return obj;
        }

        StationWorldView TrackWorld(StationWorldView world) {
            if (world != null) cleanupWorlds.Add(world);
            return world;
        }

        static TrainCatalogue LoadTrainCatalogue() {
            var catalogue = AssetDatabase.LoadAssetAtPath<TrainCatalogue>(TrainCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "TrainCatalogue missing at " + TrainCatalogue.AssetPath);
            return catalogue;
        }

        static StationGameHost CreateHost(string saveJson) {
            StationEditSession.Reset();
            StationRailTool.Reset();
            StationTunnelTool.Reset();
            StationToolSelection.Reset();
            var go = new GameObject(StationGameHost.ObjectName);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            var awake = typeof(StationGameHost).GetMethod("Awake",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake);
            awake.Invoke(host, null);
            var opened = host.OpenDocument(saveJson, "file");
            Assert.IsTrue(opened.Accepted, opened.ToString());
            return host;
        }

        static StationReadResult ReadSave(string name, JArray cells, JArray modules, JArray lines,
            int storeyHeight = 5, int levelBase = 0, string nameEn = "") {
            var envelope = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["nameEn"] = nameEn,
                ["city"] = "guangzhou",
                ["seed"] = 7,
                ["levelBase"] = levelBase,
                ["storeyHeight"] = storeyHeight,
                ["static"] = new JObject {
                    ["cells"] = cells ?? new JArray(),
                    ["modules"] = modules ?? new JArray(),
                    ["lines"] = lines ?? new JArray(),
                },
            };
            var result = StationDocumentReader.Read(envelope.ToString(Formatting.None),
                new StationSource("test:" + name, ""));
            Assert.IsNotNull(result?.Document, "read failed: " + name);
            return result;
        }

        static JObject LineJson(string id, string stock, int cars, string power, string dir = "up",
            double modelScale = 1.0, string psd = "full", int? alight = null) {
            var line = new JObject {
                ["id"] = id,
                ["name"] = "Line " + id,
                ["colour"] = "#c70541",
                ["stock"] = stock,
                ["cars"] = cars,
                ["power"] = power,
                ["direction"] = dir,
                ["psd"] = psd,
                ["modelScale"] = modelScale,
                ["headwayProfile"] = new JObject { ["peak"] = 120, ["offpeak"] = 240, ["late"] = 480 },
            };
            if (alight.HasValue) line["alightPerTrain"] = alight.Value;
            return line;
        }

        static StationTrainFrame TrainFrame(string lineId, string trackId, TrainPhase phase,
            double phaseSeconds, double doorFraction, int seq = 1) => new StationTrainFrame {
                Id = lineId + "|" + trackId,
                LineId = lineId,
                TrackId = trackId,
                ServiceSequence = seq,
                Phase = phase,
                PhaseSeconds = phaseSeconds,
                DoorFraction = doorFraction,
            };

        static StationMotionFrame MotionFrame(bool playing, params StationTrainFrame[] trains) => new StationMotionFrame {
            Clock = new StationClockFrame { Playing = playing },
            Trains = trains ?? Array.Empty<StationTrainFrame>(),
            Escalators = Array.Empty<StationEscalatorFrame>(),
            Lifts = Array.Empty<StationLiftFrame>(),
            Doors = Array.Empty<StationDoorFrame>(),
            Passengers = Array.Empty<StationPassengerFrame>(),
            Gates = Array.Empty<StationGateFrame>(),
        };

        static StationSessionDocument CabinLifecycleDocument(int alightPerTrain = 8, int cars = 2,
            string stock = "L", double modelScale = 1.0) {
            var doc = new StationSessionDocument { StationId = "cabin-parity", LevelBase = 0 };
            for (int x = 0; x < 40; x++) {
                for (int y = 0; y < 8; y++) {
                    doc.Cells.Add(new StationCellFact {
                        X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1,
                    });
                }
            }
            doc.Modules.Add(new StationModuleFact {
                Id = "exit-1", Type = "exit", X = 4, Y = 6, Z = 0, Name = "A",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "track-1", Type = "track", X = 2, Y = 0, Z = 0, Rot = 0,
                Width = 36, Depth = 3, LineId = "1", Dir = "up",
            });
            doc.Modules.Add(new StationModuleFact {
                Id = "edge-1", Type = "platform-edge", X = 2, Y = 3, Z = 0, Rot = 0,
                Width = 36, LineId = "1", RailId = "track-1", Side = "left", Dir = "up",
            });
            doc.Lines.Add(new StationLineFact {
                Id = "1", Direction = "up", Stock = stock, Cars = cars, ModelScale = modelScale,
                HeadwayPeak = 90, HeadwayOffpeak = 90, HeadwayLate = 90,
                AuthoredAlight = true, AlightPerTrain = alightPerTrain,
            });
            return doc;
        }

        static void InvokeCompactConsist(GameObject root, string key, List<Mesh> ownedMeshes) {
            var compact = typeof(TrainConsistViews).GetMethod("CompactConsistInstance",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(compact, "TrainConsistViews.CompactConsistInstance method missing");
            var cache = Activator.CreateInstance(compact.GetParameters()[2].ParameterType);
            compact.Invoke(null, new object[] { root, key, cache, ownedMeshes, null });
        }

        static bool TryConsistLocalBounds(Transform consistRoot, IEnumerable<MeshFilter> filters, out Bounds bounds) {
            bounds = default;
            bool any = false;
            Matrix4x4 inv = consistRoot.worldToLocalMatrix;
            foreach (var mf in filters) {
                if (mf == null || mf.sharedMesh == null || mf.sharedMesh.vertexCount == 0) continue;
                var meshBounds = mf.sharedMesh.bounds;
                Matrix4x4 toConsist = inv * mf.transform.localToWorldMatrix;
                for (int corner = 0; corner < 8; corner++) {
                    var pt = new Vector3(
                        (corner & 1) == 0 ? meshBounds.min.x : meshBounds.max.x,
                        (corner & 2) == 0 ? meshBounds.min.y : meshBounds.max.y,
                        (corner & 4) == 0 ? meshBounds.min.z : meshBounds.max.z);
                    var local = toConsist.MultiplyPoint3x4(pt);
                    if (!any) { bounds = new Bounds(local, Vector3.zero); any = true; }
                    else bounds.Encapsulate(local);
                }
            }
            return any;
        }

        static int SubmeshIndexCount(Mesh mesh, int lod) {
            int total = 0;
            for (int s = 0; s < mesh.subMeshCount; s++) {
                total += (int)mesh.GetIndexCount(s, Math.Min(lod, mesh.lodCount - 1));
            }
            return total;
        }

        /* --------------------------------------------- 1. Stock & Sim/View parity */

        [Test]
        public void AllFiveStocksMatchSimAndViewCadenceLengthRatedLoadAndDoorCentres() {
            var expected = new (string Cls, double Length, int Doors, double RatedPerCar, double DoorWidth)[] {
                ("A", 22.0, 5, 250.0, 1.4),
                ("B", 19.5, 4, 200.0, 1.3),
                ("C", 19.0, 4, 170.0, 1.2),
                ("D", 20.1, 4, 1758.0 / 8.0, 1.4),
                ("L", 16.8, 3, 170.0, 1.4),
            };
            int[] carCounts = { 2, 3, 4, 6, 8 };
            double[] scales = { 1.0, 0.98 };

            // CabinFloorZ invariant from web stock.test.mjs: in [0.57, 0.7].
            Assert.That(StationServiceCadence.CabinFloorZ, Is.InRange(0.57, 0.7));
            Assert.That(StationRailGeometry.CabinFloorZ, Is.InRange(0.57f, 0.7f));
            Assert.AreEqual(StationServiceCadence.CabinFloorZ, StationRailGeometry.CabinFloorZ, 1e-6);

            foreach (var spec in expected) {
                Assert.IsTrue(TrainConsist.TryStock(spec.Cls, out var viewStock), spec.Cls);
                Assert.AreEqual(spec.Length, StationServiceCadence.CarLength(spec.Cls), 1e-9, spec.Cls + " sim length");
                Assert.AreEqual(spec.Length, viewStock.Length, 1e-5, spec.Cls + " view length");
                Assert.AreEqual(spec.Doors, StationServiceCadence.DoorsPerSide(spec.Cls), spec.Cls + " sim doorsPerSide");
                Assert.AreEqual(spec.Doors, viewStock.DoorsPerSide, spec.Cls + " view doorsPerSide");
                Assert.AreEqual(spec.RatedPerCar, StationServiceCadence.RatedPerCar(spec.Cls), 1e-9, spec.Cls + " ratedPerCar");
                Assert.AreEqual(spec.DoorWidth, viewStock.DoorWidth, 1e-5, spec.Cls + " doorWidth");

                foreach (int cars in carCounts) {
                    Assert.AreEqual((int)Math.Round(spec.RatedPerCar * cars),
                        StationServiceCadence.RatedCapacity(spec.Cls, cars), $"{spec.Cls}-{cars} rated capacity");

                    foreach (double scale in scales) {
                        var simCentres = StationServiceCadence.DoorCentres(spec.Cls, cars, scale);
                        var viewCentres = TrainConsist.DoorCentres(spec.Cls, cars, (float)scale);
                        Assert.AreEqual(cars * spec.Doors, simCentres.Length, $"{spec.Cls}-{cars} sim count");
                        Assert.AreEqual(simCentres.Length, viewCentres.Length, $"{spec.Cls}-{cars} view count");

                        // Exact front/back symmetry in StationServiceCadence (double, matching web stock.ts).
                        for (int i = 0; i < simCentres.Length; i++) {
                            Assert.AreEqual(-simCentres[simCentres.Length - 1 - i], simCentres[i], 1e-9,
                                $"{spec.Cls}-{cars}@{scale} door {i} front/back symmetry");
                        }

                        // Sim/View DoorCentres parity: TrainConsist uses float32 intermediate arithmetic
                        // which shifts exact .x5 midpoints by 0.1 m on 3-car B/D only; all other 23
                        // combinations match to float32 representation precision (< 1e-5 m).
                        bool float32TieBreak = cars == 3 && (spec.Cls == "B" || spec.Cls == "D");
                        float tol = float32TieBreak ? 0.1001f : 1e-5f;
                        for (int i = 0; i < simCentres.Length; i++) {
                            Assert.AreEqual((float)simCentres[i], viewCentres[i], tol,
                                $"{spec.Cls}-{cars}@{scale} door {i} sim vs view");
                            if (!float32TieBreak && scale == 1.0) {
                                Assert.Less(Math.Abs((float)simCentres[i] - viewCentres[i]), 1e-6f,
                                    $"{spec.Cls}-{cars} door {i} strict float parity");
                            }
                        }

                        // Uniform pitch inside every car (accounting for 0.1 m rounding).
                        for (int c = 0; c < cars; c++) {
                            int baseIdx = c * spec.Doors;
                            double firstPitch = simCentres[baseIdx + 1] - simCentres[baseIdx];
                            for (int d = 1; d < spec.Doors - 1; d++) {
                                double pitch = simCentres[baseIdx + d + 1] - simCentres[baseIdx + d];
                                Assert.AreEqual(firstPitch, pitch, 0.15 * scale,
                                    $"{spec.Cls}-{cars} car {c} door {d} uniform pitch");
                            }
                        }

                        // D-stock: 0.8 m single end plug doors vs 1.4 m inner doors.
                        if (spec.Cls == "D") {
                            for (int i = 0; i < viewCentres.Length; i++) {
                                float w = TrainConsist.DoorWidthAt("D", cars, (float)scale, viewCentres[i]);
                                bool isOuterEnd = i == 0 || i == viewCentres.Length - 1;
                                float expectedW = (isOuterEnd ? 0.8f : 1.4f) * (float)scale;
                                Assert.AreEqual(expectedW, w, 1e-4f,
                                    $"D-{cars}@{scale} door {i} outer={isOuterEnd}");
                            }
                        }
                    }
                }
            }
        }

        /* ---------------------------------------- 2. Train cabin lifecycle parity */

        [Test]
        public void CabinWaveSpawnsAtBerthNotApproachBoardersHoldThroughClosingAndDespawnAtHold() {
            var doc = CabinLifecycleDocument(alightPerTrain: 8);
            var graph = StationWalkGraphBuilder.Build(doc);
            var runtime = new StationServiceRuntime(new StationServiceOptions {
                Spawn = false, AlightPerTrain = 8,
            });
            runtime.Build(doc, graph, 42u);

            // Approach ticks: NO alighting wave spawns while the train is approaching.
            for (int t = 0; t < 6; t++) {
                runtime.Step(t, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Approach, t, 0) });
                Assert.AreEqual(0, runtime.Spawned, "wave must not spawn during Approach t=" + t);
                Assert.AreEqual(0, runtime.PassengerCount, "no cabin riders during Approach t=" + t);
            }

            // Berth: alighting wave spawns inside the cabin across doors.
            runtime.Step(6, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Berth, 0, 0) });
            Assert.AreEqual(8, runtime.Spawned, "alighting wave spawns on Berth");
            Assert.IsTrue(runtime.TryDoorStates("1", "track-1", out var berthDoors));
            Assert.Greater(berthDoors.Sum(d => d.CabinRows), 0, "cabin rows populated at Berth");

            // Seed boarders at every door so they wait for doors to clear then board.
            int seeded = runtime.SeedDoorRiders("1", "track-1", 2);
            Assert.Greater(seeded, 0, "boarders queued at platform doors");

            // Opening + Dwell: alighting wave clears, doors release, boarders enter the cabin.
            double simT = 7;
            runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 0, 0.0) });
            runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 1, 0.5) });
            for (int d = 0; d < 18; d++) {
                runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Dwell, d, 1.0) });
            }
            Assert.Greater(runtime.Alighted, 0, "alighting wave stepped out onto platform");
            Assert.Greater(runtime.Boarded, 0, "queued boarders boarded the consist");
            Assert.Greater(runtime.Onboard, 0, "boarded riders are inside the cabin");

            // Closing: boarders MUST stay inside the cabin while doors are closing.
            int onboardBeforeClosing = runtime.Onboard;
            runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Closing, 0, 1.0) });
            Assert.AreEqual(onboardBeforeClosing, runtime.Onboard, "boarders stay onboard at Closing t=0");
            runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Closing, 1, 0.5) });
            Assert.AreEqual(onboardBeforeClosing, runtime.Onboard, "boarders stay onboard through Closing t=1");
            var closingFrames = runtime.PassengerFrames();
            Assert.GreaterOrEqual(closingFrames.Count(p => p.ServerId == "line:1|track-1"), onboardBeforeClosing,
                "onboard riders remain published during Closing");

            // Hold: EmptyTrain despawns cabin riders BEFORE Depart.
            runtime.Step(simT++, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Hold, 0, 0.0) });
            Assert.AreEqual(0, runtime.Onboard, "cabin riders despawn at Hold before Depart");
            Assert.AreEqual(0, runtime.OnboardFor("1", "track-1"), "service onboard count cleared at Hold");
            var holdFrames = runtime.PassengerFrames();
            Assert.AreEqual(0, holdFrames.Count(p => p.ServerId == "line:1|track-1"),
                "no cabin riders remain after Hold");
        }

        [Test]
        public void BoardersStandBehindAlightingWaveInCabinSlots() {
            // Large wave so doors hit CABIN_ALIGHT_MAX_S (15 s) and open for boarding while rows
            // or queued boarders fill sequential rows inboard from the doorway.
            var doc = CabinLifecycleDocument(alightPerTrain: 0);
            var graph = StationWalkGraphBuilder.Build(doc);
            var runtime = new StationServiceRuntime(new StationServiceOptions {
                Spawn = false, AlightPerTrain = 0,
            });
            runtime.Build(doc, graph, 99u);

            runtime.Step(0, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Berth, 0, 0) });
            runtime.SeedDoorRiders("1", "track-1", 4);
            runtime.Step(1, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 0, 0) });
            runtime.Step(2, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 1, 0.5) });
            for (int d = 0; d < 8; d++) {
                runtime.Step(3 + d, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Dwell, d, 1.0) });
            }

            Assert.Greater(runtime.Onboard, 0, "riders boarded the cabin");
            Assert.IsTrue(runtime.TryDoorStates("1", "track-1", out var doorStates));

            // Verify private TrainRow & TrainDoor fields of every TrainRiding passenger satisfy
            // TrainRow >= cabinRows[door] and stand inside the car at CabinFloorZ.
            var paxField = typeof(StationServiceRuntime).GetField("passengers",
                BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(paxField);
            var list = (System.Collections.IList)paxField.GetValue(runtime);
            Assert.Greater(list.Count, 0);
            int checkedBoarders = 0;
            foreach (var p in list) {
                var t = p.GetType();
                string phaseName = t.GetField("Phase").GetValue(p).ToString();
                if (phaseName != "TrainRiding") continue;
                int door = (int)t.GetField("TrainDoor").GetValue(p);
                int row = (int)t.GetField("TrainRow").GetValue(p);
                double pz = (double)t.GetField("Z").GetValue(p);
                Assert.That(door, Is.InRange(0, doorStates.Length - 1));
                Assert.GreaterOrEqual(row, doorStates[door].CabinRows,
                    "boarder TrainRow must stand at or behind cabinDepth[door]");
                Assert.AreEqual(1.0, pz, 0.05, "boarder stands on cabin floor at platform level");
                checkedBoarders++;
            }
            Assert.Greater(checkedBoarders, 0, "verified boarded cabin passengers");
        }

        [Test]
        public void OrphanedCabinRidersCleanUpOnStructuralEditWithoutLeftBehindPenalty() {
            var doc = CabinLifecycleDocument(alightPerTrain: 6);
            var session = new StationSimulationSession(new StationSessionSetup {
                Document = doc,
                Day = StationDayData.Default,
                Seed = 17,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = false, AlightPerTrain = 6 },
            });

            // Advance until the train is in Berth or Dwell with cabin riders present.
            bool hadCabinRiders = false;
            for (int tick = 0; tick < 200; tick++) {
                session.Advance(1.0);
                var frames = session.PassengerFrames();
                if (frames.Any(p => p.ServerId == "line:1|track-1")) {
                    hadCabinRiders = true;
                    break;
                }
            }
            Assert.IsTrue(hadCabinRiders, "session should spawn alighting cabin riders on berth");
            int leftBehindBefore = session.Statistics.LeftBehind;

            // Structural edit removing the track and its platform edge while riders are inside the cabin.
            var edited = new StationSessionDocument { StationId = doc.StationId, LevelBase = doc.LevelBase };
            edited.Cells.AddRange(doc.Cells);
            edited.Modules.Add(doc.Modules.First(m => m.Type == "exit"));
            var staged = session.StageDocumentEdit(edited, StationDayData.Default, StationDocumentEditKind.Structural);
            session.CommitDocumentEdit(staged);

            var afterFrames = session.PassengerFrames();
            Assert.AreEqual(0, afterFrames.Count(p => p.ServerId == "line:1|track-1"),
                "orphaned cabin riders must be removed when their train disappears");
            Assert.AreEqual(leftBehindBefore, session.Statistics.LeftBehind,
                "orphan cleanup on structural edit must not penalize LeftBehind");
        }

        [Test]
        public void FullAlightAndBoardCycleReplaysDeterministicallyForSameSeed() {
            StationSimulationSession MakeSession() => new StationSimulationSession(new StationSessionSetup {
                Document = CabinLifecycleDocument(alightPerTrain: 10),
                Day = StationDayData.Default,
                Seed = 2026,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = true, AlightPerTrain = 10 },
            });

            var a = MakeSession();
            var b = MakeSession();
            bool sawBoarded = false, sawAlighted = false;
            for (int tick = 0; tick < 160; tick++) {
                a.Advance(1.0);
                b.Advance(1.0);
                var sa = a.Statistics;
                var sb = b.Statistics;
                Assert.AreEqual(sa.Boarded, sb.Boarded, "tick " + tick + " Boarded");
                Assert.AreEqual(sa.Alighted, sb.Alighted, "tick " + tick + " Alighted");
                Assert.AreEqual(sa.LeftBehind, sb.LeftBehind, "tick " + tick + " LeftBehind");
                Assert.AreEqual(sa.Population, sb.Population, "tick " + tick + " Population");
                var pa = a.PassengerFrames();
                var pb = b.PassengerFrames();
                Assert.AreEqual(pa.Length, pb.Length, "tick " + tick + " passenger count");
                for (int i = 0; i < pa.Length; i++) {
                    Assert.AreEqual(pa[i].SimId, pb[i].SimId, "tick " + tick + " pax id " + i);
                    Assert.AreEqual(pa[i].X, pb[i].X, 1e-9, "tick " + tick + " pax X " + i);
                    Assert.AreEqual(pa[i].Y, pb[i].Y, 1e-9, "tick " + tick + " pax Y " + i);
                }
                if (sa.Boarded > 0) sawBoarded = true;
                if (sa.Alighted > 0) sawAlighted = true;
            }
            Assert.IsTrue(sawAlighted, "full cycle must observe alighting passengers");
            Assert.IsTrue(sawBoarded, "full cycle must observe boarding passengers");
        }

        /* ----------------------------------------------- 3. Trains & doors parity */

        [Test]
        public void RotatedUpAndDownLAndDBerthsAlignEveryTrainDoorWithPsdOpenings() {
            var catalogue = LoadTrainCatalogue();
            var cases = new (string Stock, int Cars, string Power, int TrackW, float Scale)[] {
                ("L", 6, "third-rail", 101, 0.98f),
                ("A", 8, "overhead", 173, 0.98f),
                ("B", 6, "third-rail", 117, 0.98f),
                ("D", 2, "overhead", 42, 0.98f),
            };
            string[] dirs = { "up", "down" };

            foreach (var c in cases) {
                foreach (int rot in new[] { 0, 1, 2, 3 }) {
                    foreach (var dir in dirs) {
                        StationRailRules.RotateLocal(rot, 0, 3, out double ex, out double ey);
                        var modules = new JArray {
                            new JObject {
                                ["id"] = "track-1", ["type"] = "track",
                                ["x"] = 20, ["y"] = 20, ["z"] = 0,
                                ["w"] = c.TrackW, ["d"] = 3, ["rot"] = rot,
                                ["cfg"] = new JObject { ["line"] = "L1", ["dir"] = dir, ["power"] = c.Power },
                            },
                            new JObject {
                                ["id"] = "edge-1", ["type"] = "platform-edge",
                                ["x"] = 20 + (int)Math.Round(ex), ["y"] = 20 + (int)Math.Round(ey), ["z"] = 0,
                                ["w"] = c.TrackW, ["rot"] = rot,
                                ["cfg"] = new JObject {
                                    ["line"] = "L1", ["dir"] = dir, ["side"] = "left",
                                    ["psd"] = "full", ["from"] = "track-1",
                                },
                            },
                        };
                        var read = ReadSave($"align-{c.Stock}-r{rot}-{dir}", new JArray(), modules,
                            new JArray { LineJson("L1", c.Stock, c.Cars, c.Power, dir, c.Scale) });

                        var root = Track(new GameObject($"align-{c.Stock}-r{rot}-{dir}"));
                        var renderer = new TrainConsistRenderer();
                        var world = TrackWorld(new StationWorldView(root.transform, root.name,
                            new IStationViewRenderer[] { renderer },
                            new StationViewAssets { TrainCatalogue = catalogue }));
                        world.Build(read.Document, read.Index);
                        world.Activate();

                        Assert.IsTrue(renderer.TryGetConsist("L1|track-1", out var view),
                            $"{c.Stock} rot={rot} dir={dir} consist missing");
                        Assert.AreEqual(c.Scale, view.Scale, 1e-4f, $"{c.Stock} rot={rot} dir={dir} view scale");
                        renderer.Apply(MotionFrame(true, TrainFrame("L1", "track-1", TrainPhase.Dwell, 5, 1.0)));

                        // Project every DoorCentre-* anchor onto the track's local run axis from the
                        // rail's first-cell start edge (first cell centre (20.5, 20.5) - 0.5 * facing).
                        var facing = TrainConsistGeometry.Facing(rot);
                        var trackOrigin = new Vector2(20.5f, 20.5f) - facing * 0.5f;
                        var doorAlong = view.Root.GetComponentsInChildren<Transform>(true)
                            .Where(t => t.name.StartsWith("DoorCentre-", StringComparison.Ordinal))
                            .Select(t => {
                                var docPos = StationCoordinates.WorldToDocument(t.position);
                                return Vector2.Dot(new Vector2(docPos.x, docPos.y) - trackOrigin, facing);
                            })
                            .OrderBy(v => v)
                            .ToArray();

                        // Compare against the line's actual scale (what PSDs use), never view.Scale.
                        var psdOffsets = TrainConsist.DoorRunOffsets(c.Stock, c.Cars, c.Scale, c.TrackW)
                            .OrderBy(v => v)
                            .ToArray();

                        Assert.AreEqual(psdOffsets.Length, doorAlong.Length,
                            $"{c.Stock} rot={rot} dir={dir} door count");
                        for (int i = 0; i < psdOffsets.Length; i++) {
                            Assert.AreEqual(psdOffsets[i], doorAlong[i], 0.08f,
                                $"{c.Stock} rot={rot} dir={dir} scale={c.Scale} door {i} must align with PSD opening");
                        }
                    }
                }
            }
        }

        [Test]
        public void TianheParkEveryTrainDoorAlignsWithItsActualPsdOpenings() {
            const string tianhePath = "Assets/StationDesigner/Demos/tianhe.metro.json";
            if (!File.Exists(Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json"))) {
                Assert.Ignore("tianhe.metro.json not exported");
            }
            var catalogue = LoadTrainCatalogue();
            var read = StationDocumentReader.ReadFile(tianhePath);
            Assert.IsNotNull(read?.Document);

            var root = Track(new GameObject("tianhe-door-alignment"));
            var renderer = new TrainConsistRenderer();
            var world = TrackWorld(new StationWorldView(root.transform, "tianhe-door-alignment",
                new IStationViewRenderer[] { renderer },
                new StationViewAssets { TrainCatalogue = catalogue }));
            world.Build(read.Document, read.Index);
            world.Activate();

            int checkedEdges = 0;
            foreach (var edge in read.Index.ModulesOfType("platform-edge")) {
                var req = OpeningModuleViews.RequestFor(edge, read.Index);
                var runReq = new PsdRunRequest {
                    ModuleId = req.ModuleId, X = req.X, Y = req.Y, Z = req.Z,
                    Rotation = req.Rotation, Width = req.Width, Side = req.Side, Psd = req.Psd,
                    StoreyHeight = req.StoreyHeight, HasTrack = req.HasTrack,
                    TrackX = req.TrackX, TrackY = req.TrackY, TrackRotation = req.TrackRotation, TrackWidth = req.TrackWidth,
                    HasLine = req.HasLine, Stock = req.Stock, Cars = req.Cars, ModelScale = req.ModelScale,
                };
                Assert.IsTrue(OpeningModuleViews.TryPsdRun(runReq, out var layout, out var diag),
                    $"{edge.Id}: PSD layout failed ({diag})");
                string trainId = req.LineId + "|" + req.TrackId;
                Assert.IsTrue(renderer.TryGetConsist(trainId, out var consist), $"consist missing for {trainId}");
                Assert.AreEqual(req.ModelScale, consist.Scale, 1e-4f, $"{trainId} scale must match PSD scale");
                renderer.Apply(MotionFrame(true, TrainFrame(req.LineId, req.TrackId, TrainPhase.Dwell, 5, 1.0)));

                var facing = consist.Berth.Facing;
                var origin = new Vector2(consist.Berth.DocumentPosition.x, consist.Berth.DocumentPosition.y);
                var trainDoorAlong = consist.Root.GetComponentsInChildren<Transform>(true)
                    .Where(t => t.name.StartsWith("DoorCentre-", StringComparison.Ordinal))
                    .Select(t => {
                        var docPos = StationCoordinates.WorldToDocument(t.position);
                        return Vector2.Dot(new Vector2(docPos.x, docPos.y) - origin, facing);
                    })
                    .OrderBy(v => v)
                    .ToArray();

                Assert.Greater(layout.Openings.Count, 0, $"{edge.Id} has PSD openings");
                foreach (var opening in layout.Openings) {
                    float psdAlong = Vector2.Dot(new Vector2(opening.DocumentX, opening.DocumentY) - origin, facing);
                    float nearest = trainDoorAlong.Min(t => Mathf.Abs(t - psdAlong));
                    Assert.LessOrEqual(nearest, 0.08f,
                        $"{edge.Id} ({trainId}) opening #{opening.Index} at along={psdAlong:F3} drifted {nearest:F3} m from nearest train door");
                }
                checkedEdges++;
            }
            Assert.GreaterOrEqual(checkedEdges, 6, "checked all Tianhe Park platform edges");
        }

        [Test]
        public void AlightingPassengersSpawnInsideTrainShuffleForwardAndInterpolateOutThroughDoorway() {
            // Two-car L-stock (6 doors) with 24 alighting passengers -> 2 rows x 2 files per door.
            var doc = CabinLifecycleDocument(alightPerTrain: 24, cars: 2, stock: "L", modelScale: 0.98);
            var graph = StationWalkGraphBuilder.Build(doc);
            var runtime = new StationServiceRuntime(new StationServiceOptions { Spawn = false, AlightPerTrain = 24 });
            runtime.Build(doc, graph, 77u);
            Assert.IsTrue(StationTrainPose.TryBerth(doc, doc.Lines[0], true, "track-1", 0.98, out var berth, out var fail), fail);

            // Berth: all 24 passengers spawn inside the car cabin, never on the PSD platform row (y >= 3.0).
            runtime.Step(6, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Berth, 0, 0) });
            var berthFrames = runtime.PassengerFrames();
            Assert.AreEqual(24, berthFrames.Length, "all 24 alighters spawned at Berth");
            var berthById = berthFrames.ToDictionary(p => p.SimId);
            foreach (var p in berthFrames) {
                Assert.AreEqual(StationPassengerState.Alighting, p.State, $"pax {p.SimId} starts Alighting");
                double across = -(p.X - berth.X) * berth.Fy + (p.Y - berth.Y) * berth.Fx;
                Assert.LessOrEqual(Math.Abs(across), StationServiceCadence.CabinHalfWidth + 1e-6,
                    $"pax {p.SimId} must spawn inside train cabin (across={across:F3})");
                Assert.Less(p.Y, 3.0, $"pax {p.SimId} must spawn inside the car, not on the platform PSD tile");
            }

            // Opening t=0: doors begin opening, everyone still seated inside cabin.
            runtime.Step(7, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 0, 0.0) });
            var preStepFrames = runtime.PassengerFrames().ToDictionary(p => p.SimId);

            // Opening t=1: Row 0 (12 pax) steps out onto the platform doorway; Row 1 (12 pax) shuffles forward inside the car!
            runtime.Step(8, true, 0, new[] { TrainFrame("1", "track-1", TrainPhase.Opening, 1, 0.5) });
            var postStepFrames = runtime.PassengerFrames();
            int steppedOut = 0;
            int shuffledInside = 0;
            StationPassengerFrame sampleSteppedPrior = default, sampleSteppedCurrent = default;
            foreach (var cur in postStepFrames) {
                var prior = preStepFrames[cur.SimId];
                double moved = Math.Sqrt((cur.X - prior.X) * (cur.X - prior.X) + (cur.Y - prior.Y) * (cur.Y - prior.Y));
                if (cur.State == StationPassengerState.Walking && prior.State == StationPassengerState.Alighting) {
                    steppedOut++;
                    Assert.Greater(moved, 0.5, $"pax {cur.SimId} stepped from cabin to doorway");
                    Assert.Greater(cur.WalkDistance, 0.5, $"pax {cur.SimId} accumulated walk stride during step-out");
                    Assert.Greater(cur.WalkWeight, 0.5, $"pax {cur.SimId} animates walking while stepping out");
                    if (steppedOut == 1) { sampleSteppedPrior = prior; sampleSteppedCurrent = cur; }
                } else if (cur.State == StationPassengerState.Alighting) {
                    shuffledInside++;
                    Assert.Greater(moved, 0.25, $"remaining cabin pax {cur.SimId} must shuffle forward toward the door");
                    Assert.Greater(cur.Y, prior.Y, $"pax {cur.SimId} moved toward the left (+y) doorway");
                    Assert.Less(cur.Y, 3.0, $"shuffled cabin pax {cur.SimId} stays inside the train");
                    Assert.Greater(cur.WalkDistance, 0.25, $"shuffling pax {cur.SimId} advances WalkDistance");
                    Assert.Greater(cur.WalkWeight, 0.5, $"shuffling pax {cur.SimId} plays walking animation");
                }
            }
            Assert.AreEqual(12, steppedOut, "row 0 (2 abreast x 6 doors) stepped out");
            Assert.AreEqual(12, shuffledInside, "row 1 shuffled forward inside the car");

            // Crowd renderer interpolation: Alighting -> Walking must smoothly interpolate from cabin to PSD
            // instead of snapping straight to the PSD threshold.
            var adjacentMethod = typeof(PassengerCrowdRenderer).GetMethod("Adjacent",
                BindingFlags.Static | BindingFlags.NonPublic);
            Assert.IsNotNull(adjacentMethod, "PassengerCrowdRenderer.Adjacent missing");
            var priorPose = SessionPassengerFeed.Map(sampleSteppedPrior);
            var currentPose = SessionPassengerFeed.Map(sampleSteppedCurrent);
            bool isAdjacentExit = (bool)adjacentMethod.Invoke(null, new object[] { priorPose, currentPose });
            Assert.IsTrue(isAdjacentExit, "Alighting (cabin) -> Walking (PSD) must interpolate smoothly, never teleport to PSD");

            // Boarding transition (Queuing at PSD -> Boarding inside cabin) must also interpolate smoothly.
            var boardPrior = new PassengerPose {
                SimId = 900, X = sampleSteppedCurrent.X, Y = sampleSteppedCurrent.Y, Z = sampleSteppedCurrent.Z,
                State = StationPassengerState.Queuing, ServerId = "door:edge-1#0", Visible = true,
            };
            var boardCurrent = new PassengerPose {
                SimId = 900, X = sampleSteppedPrior.X, Y = sampleSteppedPrior.Y, Z = sampleSteppedPrior.Z,
                State = StationPassengerState.Boarding, ServerId = "line:1|track-1", Visible = true,
            };
            bool isAdjacentBoard = (bool)adjacentMethod.Invoke(null, new object[] { boardPrior, boardCurrent });
            Assert.IsTrue(isAdjacentBoard, "Queuing (PSD) -> Boarding (cabin) must interpolate smoothly into the train");
        }

        [Test]
        public void BareRailWithoutPlatformScreenOpensNeitherDoorBank() {
            var catalogue = LoadTrainCatalogue();
            var modules = new JArray {
                new JObject {
                    ["id"] = "track-bare", ["type"] = "track",
                    ["x"] = 0, ["y"] = 0, ["z"] = 0, ["w"] = 42, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                },
            };
            var read = ReadSave("bare-rail", new JArray(), modules,
                new JArray { LineJson("1", "L", 2, "third-rail", "up", 1.0) });

            var root = Track(new GameObject("bare-rail-root"));
            var renderer = new TrainConsistRenderer();
            var world = TrackWorld(new StationWorldView(root.transform, "bare-rail",
                new IStationViewRenderer[] { renderer },
                new StationViewAssets { TrainCatalogue = catalogue }));
            world.Build(read.Document, read.Index);
            world.Activate();

            Assert.IsTrue(renderer.TryGetConsist("1|track-bare", out var view));
            Assert.IsFalse(view.Berth.HasPlatform, "bare rail has no platform edge");

            renderer.Apply(MotionFrame(true, TrainFrame("1", "track-bare", TrainPhase.Dwell, 5, 1.0)));
            Assert.IsNotNull(view.Rig);
            Assert.AreEqual(0f, view.Rig.Plus, 1e-6f, "bare rail must not open +1 bank");
            Assert.AreEqual(0f, view.Rig.Minus, 1e-6f, "bare rail must not open -1 bank");
            Assert.IsFalse(view.DoorsOpen, "bare rail must report DoorsOpen == false");
        }

        [Test]
        public void ServiceDoorServersMatchConsistDoorCentresAcrossAllFiveStocks() {
            var stocks = new (string Stock, int Cars, int RailW)[] {
                ("A", 6, 134),
                ("B", 6, 120),
                ("C", 4, 78),
                ("D", 4, 82),
                ("L", 6, 102),
            };
            foreach (var s in stocks) {
                var doc = new StationSessionDocument { StationId = "doors-" + s.Stock, LevelBase = 0 };
                for (int x = 0; x < s.RailW + 4; x++) {
                    for (int y = 3; y <= 5; y++) {
                        doc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1 });
                    }
                }
                var track = new StationModuleFact {
                    Id = "track-1", Type = "track", X = 2, Y = 0, Z = 0, Rot = 0,
                    Width = s.RailW, Depth = 3, LineId = "1", Dir = "up",
                };
                var edge = new StationModuleFact {
                    Id = "edge-1", Type = "platform-edge", X = 2, Y = 3, Z = 0, Rot = 0,
                    Width = s.RailW, LineId = "1", RailId = "track-1", Side = "left", Dir = "up",
                };
                var line = new StationLineFact {
                    Id = "1", Stock = s.Stock, Cars = s.Cars, ModelScale = 1.0, Direction = "up",
                };
                doc.Modules.Add(track);
                doc.Modules.Add(edge);
                doc.Lines.Add(line);

                var graph = StationWalkGraphBuilder.Build(doc);
                var slots = StationServiceDoors.ForEdge(doc, graph, edge, track, line, out var diag);
                Assert.AreEqual("", diag, s.Stock + " unexpected door diagnostic");

                var viewOffsets = TrainConsist.DoorRunOffsets(s.Stock, s.Cars, 1f, s.RailW);
                Assert.AreEqual(viewOffsets.Length, slots.Count, s.Stock + " door server count");
                for (int i = 0; i < slots.Count; i++) {
                    double continuousWorldX = track.X + viewOffsets[i];
                    double serverCellCentreX = slots[i].X + 0.5;
                    Assert.LessOrEqual(Math.Abs(serverCellCentreX - continuousWorldX), 0.5 + 1e-4,
                        $"{s.Stock} door {i}: cell centre {serverCellCentreX} vs train door {continuousWorldX}");
                    Assert.AreEqual(viewOffsets[i], slots[i].Offset, 1e-4,
                        $"{s.Stock} door {i} exact run offset");
                }
            }
        }

        [Test]
        public void ThreeHundredTickPoseReplayIsDeterministicAndMonotonicInTunnels() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            var doc = StationSessionProjection.Document(read.Document, read.Index);
            var zooTrack = read.Document.Modules.First(m => m.Id == "track-1");
            Assert.IsTrue(TrainConsistGeometry.TryBerth(read.Document, read.Document.Lines[0], zooTrack, 0.98f,
                out var berth, out var fail), fail);

            StationSimulationSession MakeSession() => new StationSimulationSession(new StationSessionSetup {
                Document = doc,
                Day = StationDayData.Default,
                Seed = 77,
                StartSimTime = StationClock.ReferenceBootSeconds,
                StartPlaying = true,
                Services = new StationServiceOptions { Spawn = false },
            });

            var a = MakeSession();
            var b = MakeSession();
            bool sawApproach = false, sawDepart = false;
            TrainPhase prevPhase = TrainPhase.None;
            float prevOffset = 0f;

            for (int tick = 0; tick < 300; tick++) {
                a.Advance(1.0);
                b.Advance(1.0);
                var fa = a.Snapshot().Trains;
                var fb = b.Snapshot().Trains;
                Assert.AreEqual(fa.Length, fb.Length, "tick " + tick);
                for (int i = 0; i < fa.Length; i++) {
                    Assert.AreEqual(fa[i].Id, fb[i].Id, "tick " + tick);
                    Assert.AreEqual(fa[i].Phase, fb[i].Phase, "tick " + tick);
                    Assert.AreEqual(fa[i].PhaseSeconds, fb[i].PhaseSeconds, 1e-9, "tick " + tick);
                    Assert.AreEqual(fa[i].DoorFraction, fb[i].DoorFraction, 1e-9, "tick " + tick);
                    Assert.AreEqual(fa[i].ServiceSequence, fb[i].ServiceSequence, "tick " + tick);
                }

                var t1 = fa.First(tr => tr.TrackId == "track-1");
                float offset = TrainConsistGeometry.OffsetMetres(t1.Phase, t1.PhaseSeconds, berth);
                if (t1.Phase == TrainPhase.Approach && prevPhase == TrainPhase.Approach) {
                    // Approach moves monotonically toward 0 along DirectionSign.
                    Assert.LessOrEqual(Math.Abs(offset), Math.Abs(prevOffset) + 1e-4f,
                        $"tick {tick}: Approach offset must move monotonically toward berth");
                    sawApproach = true;
                }
                if (t1.Phase == TrainPhase.Depart && prevPhase == TrainPhase.Depart) {
                    // Depart moves monotonically away from 0 along DirectionSign.
                    Assert.GreaterOrEqual(Math.Abs(offset), Math.Abs(prevOffset) - 1e-4f,
                        $"tick {tick}: Depart offset must move monotonically away from berth");
                    sawDepart = true;
                }
                prevPhase = t1.Phase;
                prevOffset = offset;
            }
            Assert.IsTrue(sawApproach, "300 ticks on Zoo must exercise Approach tunnel progression");
            Assert.IsTrue(sawDepart, "300 ticks on Zoo must exercise Depart tunnel progression");
        }

        [Test]
        public void IdenticalConsistsOnSeparateFiveMetreStoreysKeepDistinctSlotsAndLevelBands() {
            var catalogue = LoadTrainCatalogue();
            var modules = new JArray {
                new JObject {
                    ["id"] = "track-lower", ["type"] = "track",
                    ["x"] = 0, ["y"] = 0, ["z"] = -5, ["w"] = 42, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "5", ["dir"] = "up", ["power"] = "third-rail" },
                },
                new JObject {
                    ["id"] = "track-upper", ["type"] = "track",
                    ["x"] = 0, ["y"] = 0, ["z"] = 0, ["w"] = 42, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "5", ["dir"] = "up", ["power"] = "third-rail" },
                },
            };
            var read = ReadSave("stacked-storeys", new JArray(), modules,
                new JArray { LineJson("5", "L", 2, "third-rail", "up", 1.0) }, storeyHeight: 5, levelBase: 0);

            var root = Track(new GameObject("stacked-storeys-root"));
            var renderer = new TrainConsistRenderer();
            var world = TrackWorld(new StationWorldView(root.transform, "stacked-storeys",
                new IStationViewRenderer[] { renderer },
                new StationViewAssets { TrainCatalogue = catalogue }));
            world.Build(read.Document, read.Index);
            world.Activate();

            Assert.AreEqual(2, renderer.Consists.Count, "stacked identical consists must keep distinct slots");
            Assert.IsTrue(renderer.TryGetConsist("5|track-lower", out var lower));
            Assert.IsTrue(renderer.TryGetConsist("5|track-upper", out var upper));
            Assert.AreEqual(5.0f, upper.Berth.DocumentPosition.z - lower.Berth.DocumentPosition.z, 1e-4f,
                "berths separated by exactly one 5 m storey");
            Assert.AreNotEqual(lower.VisibilityRecordId, upper.VisibilityRecordId);
            Assert.IsEmpty(lower.LevelBands.Intersect(upper.LevelBands),
                "stacked consists on separate 5 m storeys must have disjoint LevelBands");
        }

        [Test]
        public void TanweiDormantConsistsMatchAllLineAnchorsAndStayInvisibleBeforePlay() {
            var catalogue = LoadTrainCatalogue();
            var read = StationDocumentReader.ReadFile(TanweiPath);
            Assert.IsNotNull(read?.Document, "Tanwei failed to read");

            var root = Track(new GameObject("tanwei-dormant-root"));
            var renderer = new TrainConsistRenderer();
            var world = TrackWorld(new StationWorldView(root.transform, "tanwei-dormant",
                new IStationViewRenderer[] { renderer },
                new StationViewAssets { TrainCatalogue = catalogue }));
            world.Build(read.Document, read.Index);
            world.Activate();

            // Tanwei has Line 5 (L6 elevated z=11, track-1/track-3) and Line 6 (L4 underground z=-10, track-281/track-283).
            var expectedIds = new[] { "5|track-1", "5|track-3", "6|track-281", "6|track-283" };
            Assert.AreEqual(expectedIds.Length, renderer.Consists.Count, "Tanwei service consist count");
            foreach (var id in expectedIds) {
                Assert.IsTrue(renderer.TryGetConsist(id, out var view), "missing Tanwei consist " + id);
                Assert.IsNotNull(view.Berth, id + " berth");
                Assert.IsTrue(view.Berth.HasPlatform, id + " has platform anchor");
                Assert.Greater(view.Cars, 0, id + " cars");
            }

            // Before Play (Phase.None): every consist stays dormant and invisible with shut doors.
            renderer.Apply(MotionFrame(false,
                expectedIds.Select(id => {
                    var parts = id.Split('|');
                    return TrainFrame(parts[0], parts[1], TrainPhase.None, 0, 0);
                }).ToArray()));
            foreach (var id in expectedIds) {
                Assert.IsTrue(renderer.TryGetConsist(id, out var view));
                Assert.IsFalse(view.Visible, id + " must stay invisible before Play");
                Assert.IsFalse(view.DoorsOpen, id + " doors must stay shut while dormant");
            }
        }

        /* ---------------------------------- 4. Promoted formation asset audits */

        [Test]
        public void PromotedFormationsPutBogieWheelTreadAtRailHeadAcrossAllFiveStocks() {
            var catalogue = LoadTrainCatalogue();
            var keys = new[] { "A.2.overhead", "B.2.third-rail", "C.2.third-rail", "D.2.overhead", "L.2.third-rail" };
            // Wheel tread sits at RailHeadZ (-0.29) relative to TrainOriginZ (0.38) => -0.67 m in consist local Y.
            float expectedTreadY = StationRailGeometry.RailHeadZ - StationRailGeometry.TrainOriginZ;

            foreach (var key in keys) {
                Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
                var instance = Track(UnityEngine.Object.Instantiate(entry.prefab));
                var consistNode = instance.GetComponentsInChildren<Transform>(true)
                    .First(t => t.name == "Consist");

                var wheelTyres = instance.GetComponentsInChildren<MeshFilter>(true)
                    .Where(mf => mf.name.StartsWith("bogie-wheel-tyre", StringComparison.Ordinal))
                    .ToArray();
                Assert.IsNotEmpty(wheelTyres, key + " missing bogie-wheel-tyre meshes");

                Assert.IsTrue(TryConsistLocalBounds(consistNode, wheelTyres, out var wheelBounds), key);
                // Wheel flange dips ~0.0315 m below the running tread; tread sits at minY + 0.0315.
                float measuredTreadY = wheelBounds.min.y + 0.0315f;
                Assert.AreEqual(expectedTreadY, measuredTreadY, 0.025f,
                    $"{key}: wheel tread Y {measuredTreadY:0.###} must meet RailHeadZ ({expectedTreadY:0.###})");

                // Compact and verify wheels remain represented at Low LOD (lod 2).
                var owned = new List<Mesh>();
                try {
                    InvokeCompactConsist(instance, key, owned);
                    Assert.IsNotEmpty(owned, key + " compaction produced static meshes");
                    Assert.IsTrue(owned.Any(m => m.bounds.min.y <= expectedTreadY + 0.05f && SubmeshIndexCount(m, 2) > 0),
                        key + " Low LOD static mesh must keep wheel-level geometry");
                } finally {
                    foreach (var m in owned) UnityEngine.Object.DestroyImmediate(m);
                }
            }
        }

        [Test]
        public void PromotedFormationsCarryCarsMinusOneGangwaysSpanningCarGap() {
            var catalogue = LoadTrainCatalogue();
            foreach (var stock in TrainFormations.Stocks) {
                foreach (int cars in new[] { 2, 4, 6 }) {
                    string power = stock == "A" || stock == "D" ? "overhead" : "third-rail";
                    string key = TrainFormations.Key(stock, cars, power);
                    Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
                    var instance = Track(UnityEngine.Object.Instantiate(entry.prefab));
                    var gangways = TrainConsistViews.CollectGangways(instance);
                    var carNodes = TrainConsistViews.CollectCars(instance);

                    Assert.AreEqual(cars, carNodes.Count, key + " car node count");
                    Assert.AreEqual(cars - 1, gangways.Count, key + " must carry exactly cars - 1 gangways");

                    var carXs = carNodes.Select(c => instance.transform.InverseTransformPoint(c.position).x)
                        .OrderBy(x => x).ToArray();
                    var gwXs = gangways.Select(g => instance.transform.InverseTransformPoint(g.position).x)
                        .OrderBy(x => x).ToArray();
                    for (int i = 0; i < gwXs.Length; i++) {
                        float expectedMid = (carXs[i] + carXs[i + 1]) * 0.5f;
                        Assert.AreEqual(expectedMid, gwXs[i], 0.15f,
                            $"{key} gangway {i} must span gap between car {i} and car {i + 1}");
                    }

                    // Gangways survive compaction with non-zero Low LOD triangles.
                    var owned = new List<Mesh>();
                    try {
                        InvokeCompactConsist(instance, key, owned);
                        foreach (var gw in gangways) {
                            var filters = gw.GetComponentsInChildren<MeshFilter>(true);
                            Assert.IsNotEmpty(filters, key + " gangway mesh missing after compaction");
                            Assert.Greater(filters.Sum(mf => mf.sharedMesh != null ? SubmeshIndexCount(mf.sharedMesh, 2) : 0), 0,
                                key + " gangway must retain triangles at Low LOD");
                        }
                    } finally {
                        foreach (var m in owned) UnityEngine.Object.DestroyImmediate(m);
                    }
                }
            }
        }

        [Test]
        public void PromotedFormationsPreserveCabinInteriorAboveDoorHeadBeforeAndAfterLowLod() {
            var catalogue = LoadTrainCatalogue();
            const float DoorHeadY = 2.63f;
            var keys = new[] { "A.2.overhead", "B.2.third-rail", "C.2.third-rail", "D.2.overhead", "L.2.third-rail" };

            foreach (var key in keys) {
                Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
                var instance = Track(UnityEngine.Object.Instantiate(entry.prefab));
                var consistNode = instance.GetComponentsInChildren<Transform>(true)
                    .First(t => t.name == "Consist");

                foreach (var partName in new[] { "cabin-ceiling", "cabin-route-panel", "cabin-roof-lining" }) {
                    var partFilters = instance.GetComponentsInChildren<MeshFilter>(true)
                        .Where(mf => mf.name.StartsWith(partName, StringComparison.Ordinal))
                        .ToArray();
                    Assert.IsNotEmpty(partFilters, $"{key} missing {partName}");
                    Assert.IsTrue(TryConsistLocalBounds(consistNode, partFilters, out var bounds), key + " " + partName);
                    Assert.GreaterOrEqual(bounds.min.y, DoorHeadY - 0.02f,
                        $"{key} {partName} underside ({bounds.min.y:0.###}) must sit above door head ({DoorHeadY})");
                }

                // Compact and verify Low LOD reduces decorative tris while keeping interior roof/ceiling geometry.
                var owned = new List<Mesh>();
                try {
                    InvokeCompactConsist(instance, key, owned);
                    int lod0Tris = owned.Sum(m => SubmeshIndexCount(m, 0));
                    int lod2Tris = owned.Sum(m => SubmeshIndexCount(m, 2));
                    Assert.Greater(lod2Tris, 0, key + " Low LOD must keep visible geometry");
                    Assert.Less(lod2Tris, lod0Tris, key + " Low LOD must drop decorative details");
                    Assert.IsTrue(owned.Any(m => m.bounds.max.y >= 2.90f && SubmeshIndexCount(m, 2) > 0),
                        key + " cabin ceiling/interior envelope must survive Low LOD");
                } finally {
                    foreach (var m in owned) UnityEngine.Object.DestroyImmediate(m);
                }
            }
        }

        [Test]
        public void AllTwentyFiveOverheadFormationsCarryPantographsAndAllTwentyFiveThirdRailCarryNone() {
            var catalogue = LoadTrainCatalogue();
            int overheadCount = 0, thirdRailCount = 0;

            foreach (var key in TrainFormations.All()) {
                Assert.IsTrue(TrainFormations.TryParse(key, out _, out _, out var power, out _), key);
                Assert.IsTrue(catalogue.TryGet(key, out var entry), key);
                Assert.IsNotNull(entry.prefab, key + " prefab missing");

                var transforms = entry.prefab.GetComponentsInChildren<Transform>(true);
                int panRoots = transforms.Count(t => t.name.StartsWith("Pan", StringComparison.Ordinal));
                int panParts = transforms.Count(t =>
                    t.name.StartsWith("train-pantograph", StringComparison.Ordinal) ||
                    t.name.StartsWith("pantograph-contact-strip", StringComparison.Ordinal));

                if (power == "overhead") {
                    overheadCount++;
                    Assert.Greater(panRoots, 0, key + " overhead formation must carry Pan* nodes");
                    Assert.Greater(panParts, 0, key + " overhead formation must carry pantograph geometry");
                } else {
                    thirdRailCount++;
                    Assert.AreEqual(0, panRoots, key + " third-rail formation must carry zero Pan* nodes");
                    Assert.AreEqual(0, panParts, key + " third-rail formation must carry zero pantograph geometry");
                }
            }

            Assert.AreEqual(25, overheadCount, "expected 25 overhead formations");
            Assert.AreEqual(25, thirdRailCount, "expected 25 third-rail formations");
        }

        [Test]
        public void DStockDoorsVerifySingleAndDoubleLeavesPlugBeforeSlideFourRotationsAndLowLodGlass() {
            // 1. Plug-before-slide staging curve (PlugPhase = 0.18).
            Assert.AreEqual(0.18f, TrainDoorRig.PlugPhase, 1e-6f);
            var s0 = TrainDoorRig.Stage.At(0f);
            Assert.AreEqual(0f, s0.Plug, 1e-6f);
            Assert.AreEqual(0f, s0.Slide, 1e-6f);
            var sMidPlug = TrainDoorRig.Stage.At(0.09f);
            Assert.AreEqual(0.5f, sMidPlug.Plug, 1e-5f);
            Assert.AreEqual(0f, sMidPlug.Slide, 1e-6f, "slide must stay 0 during plug phase");
            var sPlugDone = TrainDoorRig.Stage.At(0.18f);
            Assert.AreEqual(1f, sPlugDone.Plug, 1e-5f);
            Assert.AreEqual(0f, sPlugDone.Slide, 1e-6f, "slide begins only after plug completes at 0.18");
            var sHalfSlide = TrainDoorRig.Stage.At(0.18f + 0.41f);
            Assert.AreEqual(1f, sHalfSlide.Plug, 1e-5f);
            Assert.AreEqual(0.5f, sHalfSlide.Slide, 1e-5f);
            var sOpen = TrainDoorRig.Stage.At(1f);
            Assert.AreEqual(1f, sOpen.Plug, 1e-5f);
            Assert.AreEqual(1f, sOpen.Slide, 1e-5f);

            // 2. D.2.overhead prefab: 8 DoorCentre anchors, single end leaves + inner double leaves,
            //    4-rotation platform-side binding, and transparent glass preserved at Low LOD.
            var catalogue = LoadTrainCatalogue();
            Assert.IsTrue(catalogue.TryGet("D.2.overhead", out var entry));
            var instance = Track(UnityEngine.Object.Instantiate(entry.prefab));

            var anchors = instance.GetComponentsInChildren<Transform>(true)
                .Where(t => t.name.StartsWith("DoorCentre-", StringComparison.Ordinal))
                .ToArray();
            Assert.AreEqual(8, anchors.Length, "2-car D stock has 8 DoorCentre anchors");

            // Check that single end leaves (1 per bank at outer cab anchors) and inner double leaves
            // (2 per bank at inner anchors) both exist on the D-stock prefab. Note that D-stock leaf
            // transforms sit at z=0 with geometry offset to each bank, so classify banks by mesh bounds.
            var leafNodes = instance.GetComponentsInChildren<Transform>(true)
                .Where(t => !t.name.StartsWith("DoorCentre", StringComparison.Ordinal) &&
                            t.name.Contains("Door") && char.IsDigit(t.name[t.name.Length - 1]))
                .ToArray();
            var anchorXs = anchors.Select(a => instance.transform.InverseTransformPoint(a.position).x)
                .OrderBy(x => x).ToArray();
            int singleAnchorCount = 0, doubleAnchorCount = 0;
            foreach (float ax in anchorXs) {
                int plusCount = 0, minusCount = 0;
                foreach (var leaf in leafNodes) {
                    var p = instance.transform.InverseTransformPoint(leaf.position);
                    if (Mathf.Abs(p.x - ax) >= 1.2f) continue;
                    var leafFilters = leaf.GetComponentsInChildren<MeshFilter>(true);
                    if (!TryConsistLocalBounds(instance.transform, leafFilters, out var lb)) continue;
                    if (lb.center.z >= 0f) plusCount++;
                    else minusCount++;
                }
                if (plusCount == 1 && minusCount == 1) singleAnchorCount++;
                else if (plusCount == 2 && minusCount == 2) doubleAnchorCount++;
            }
            Assert.AreEqual(2, singleAnchorCount, "D-stock cab ends each have 1 single door leaf per side");
            Assert.AreEqual(6, doubleAnchorCount, "D-stock inner doorways each have 2 double door leaves per side");

            // 3. Test TrainDoorRig plug-before-slide (0.18) across all 4 quarter rotations (0, 90, 180, 270 deg).
            Assert.IsTrue(catalogue.TryGet("A.2.overhead", out var aEntry));
            var aInstance = Track(UnityEngine.Object.Instantiate(aEntry.prefab));
            var rig = new TrainDoorRig(aInstance, TrainDoorRig.ForLine("A", 2, 1f));
            Assert.AreEqual(10, rig.Doors, "TrainDoorRig binds all 10 doorways on A2");
            foreach (int rot in new[] { 0, 1, 2, 3 }) {
                aInstance.transform.rotation = Quaternion.Euler(0f, -rot * 90f, 0f);
                var platformWorld = aInstance.transform.TransformPoint(new Vector3(0f, 0f, 3f));
                rig.SetPlatformSide(platformWorld);
                Assert.AreEqual(1, rig.PlatformBank, "rot " + rot + " platform side");
                rig.Apply(0f);
                float closedZ = rig.ObservedLeafZ;
                float closedX = rig.ObservedLeafX;
                rig.Apply(0.18f);
                Assert.Greater(Mathf.Abs(rig.ObservedLeafZ - closedZ), 0.04f, "rot " + rot + " plug moved");
                Assert.AreEqual(closedX, rig.ObservedLeafX, 1e-4f, "rot " + rot + " no slide at 0.18");
                rig.Apply(1f);
                Assert.Greater(rig.Movement, 0.5f, "rot " + rot + " full slide opened");
                Assert.AreEqual(0f, rig.InactiveFraction, 1e-6f, "rot " + rot + " opposite bank stayed shut");
                rig.Reset();
            }

            // 4. Compact D.2.overhead and verify transparent glass retains triangles at Low LOD.
            var owned = new List<Mesh>();
            try {
                InvokeCompactConsist(instance, "D.2.overhead", owned);
                var transparentRenderers = instance.GetComponentsInChildren<MeshRenderer>(true)
                    .Where(mr => mr.sharedMaterial != null &&
                                 mr.sharedMaterial.renderQueue >= (int)UnityEngine.Rendering.RenderQueue.Transparent)
                    .ToArray();
                Assert.IsNotEmpty(transparentRenderers, "D-stock must preserve transparent glass renderers");
                int glassLowLodTris = transparentRenderers.Sum(mr => {
                    var mf = mr.GetComponent<MeshFilter>();
                    return mf != null && mf.sharedMesh != null ? SubmeshIndexCount(mf.sharedMesh, 2) : 0;
                });
                Assert.Greater(glassLowLodTris, 0, "transparent glass must keep non-zero triangles at Low LOD");
            } finally {
                foreach (var m in owned) UnityEngine.Object.DestroyImmediate(m);
            }
        }

        /* ---------------------------------- 5. Third-rail & Rail/Tunnel parity */

        [Test]
        public void ThirdRailSideMatrixAndMeshLocalYSignMatchWebContract() {
            ModuleFacts TrackFact(string id, string dir, int rot = 0, bool tunnel = false, bool bridge = false) {
                var cfg = new Dictionary<string, string> { ["line"] = "5" };
                if (dir != null) cfg["dir"] = dir;
                if (tunnel) cfg["tunnel"] = "true";
                if (bridge) cfg["bridge"] = "true";
                return new ModuleFacts {
                    Id = id, Type = "track", X = 0, Y = 0, Z = 0, Width = 32, Depth = 3, Rotation = rot,
                    Config = new ModuleConfig(cfg),
                };
            }
            ModuleFacts EdgeFact(string id, string side, string from = null, string line = "5",
                string dir = "up", string psd = "full") {
                var cfg = new Dictionary<string, string> {
                    ["line"] = line, ["side"] = side, ["dir"] = dir, ["psd"] = psd,
                };
                if (!string.IsNullOrEmpty(from)) cfg["from"] = from;
                return new ModuleFacts {
                    Id = id, Type = "platform-edge", X = 0, Y = 3, Z = 0, Width = 32,
                    Config = new ModuleConfig(cfg),
                };
            }

            var leftEdge = EdgeFact("e-left", "left", from: "t1");
            var rightEdge = EdgeFact("e-right", "right", from: "t1");

            // Tunnel & bridge ignore screens -> travel-right (up => -1, down => +1).
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up", tunnel: true),
                new[] { rightEdge }, "up"), "tunnel up ignores right screen");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "down", tunnel: true),
                new[] { leftEdge }, "down"), "tunnel down ignores left screen");
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up", bridge: true),
                new[] { rightEdge }, "up"), "bridge up ignores right screen");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "down", bridge: true),
                new[] { leftEdge }, "down"), "bridge down ignores left screen");

            // Bare platform (no screens, or psd="none") -> travel-right.
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                Array.Empty<ModuleFacts>(), "up"), "bare platform up");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "down"),
                Array.Empty<ModuleFacts>(), "down"), "bare platform down");
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { EdgeFact("e-none", "right", from: "t1", psd: "none") }, "up"), "psd=none ignored");

            // Both-side screens -> travel-right.
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { leftEdge, rightEdge }, "up"), "both sides up -> travel-right");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "down"),
                new[] { leftEdge, rightEdge }, "down"), "both sides down -> travel-right");

            // Single screen -> opposite side.
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "down"),
                new[] { leftEdge }, "down"), "left screen forces -1 even on down");
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { rightEdge }, "up"), "right screen forces +1 even on up");

            // Ignores another track's screen.
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { EdgeFact("e-other", "right", from: "t2") }, "up"), "ignores other track's screen");

            // Legacy edge (no `from`) matches by line + dir.
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { EdgeFact("e-legacy", "right", from: null, line: "5", dir: "up") }, "up"),
                "legacy edge matches line+dir");
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up"),
                new[] { EdgeFact("e-wrongdir", "right", from: null, line: "5", dir: "down") }, "up"),
                "legacy edge rejects wrong dir");

            // Line direction & "up" fallback when track dir is absent.
            Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", null),
                Array.Empty<ModuleFacts>(), "down"), "falls back to lineDirection=down");
            Assert.AreEqual(-1, StationRailGeometry.ThirdRailSide(TrackFact("t1", null),
                Array.Empty<ModuleFacts>(), ""), "falls back to up when both empty");

            // Rotation 0..3 invariance (ThirdRailSide is track-local).
            foreach (int rot in new[] { 0, 1, 2, 3 }) {
                Assert.AreEqual(1, StationRailGeometry.ThirdRailSide(TrackFact("t1", "up", rot: rot),
                    new[] { rightEdge }, "up"), "rot " + rot + " invariance");
            }

            // RailRunGeometry Power mesh local across-axis sign (Unity local Z = track local Y).
            float bedCentreY = (3f - 1f) * 0.5f;
            var runPlus = RailRunGeometry.Build(24, 3, 1f, +1, catenary: false);
            var runMinus = RailRunGeometry.Build(24, 3, 1f, -1, catenary: false);
            Assert.Greater(runPlus.ThirdRailLocalY, bedCentreY, "+1 puts conductor rail on +Y side");
            Assert.Less(runMinus.ThirdRailLocalY, bedCentreY, "-1 puts conductor rail on -Y side");
            Assert.IsNotEmpty(runPlus.Power.Vertices);
            Assert.IsNotEmpty(runMinus.Power.Vertices);
            Assert.IsTrue(runPlus.Power.Vertices.All(v => v.z > bedCentreY), "+1 power mesh sits on +across half");
            Assert.IsTrue(runMinus.Power.Vertices.All(v => v.z < bedCentreY), "-1 power mesh sits on -across half");
        }

        [Test]
        public void RailPlannerResizeCollisionRefusalDeepBedAndQuarterTurns() {
            var slab = new JArray();
            for (int x = 0; x < 70; x++) {
                for (int y = 0; y < 70; y++) {
                    slab.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                    slab.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = -1, ["fill"] = "solid" });
                }
            }
            var emptyLinesRead = ReadSave("empty-lines", slab, new JArray(), new JArray());
            var blocked = StationRailPlanner.Plan(emptyLinesRead.Index, "", "up", 0, 35, 35, 0);
            Assert.AreEqual("no-line", blocked.Reason);
            Assert.IsFalse(blocked.ToPatch().HasWork);
            var twoCarLine = new JArray { LineJson("1", "L", 2, "third-rail", "up", 0.98) };
            var turnedRead = ReadSave("quarter-turns", slab, new JArray(), twoCarLine);
            var defaultPlan = StationRailPlanner.Plan(turnedRead.Index, "", "up", 0, 35, 35, 0);
            Assert.IsTrue(defaultPlan.Ok, defaultPlan.Reason);
            Assert.AreEqual("1", defaultPlan.LineId, "the first saved line is the fallback");

            // Deep 2-course bed digs z and z-1 ONLY on bed cells; adjacent platform cells stay intact.
            Assert.AreEqual(defaultPlan.Bed.Count * 2, defaultPlan.DigCells.Count, "2 courses dug per bed cell");
            var bedCoords = new HashSet<(int, int)>(defaultPlan.Bed.Select(c => (c.X, c.Y)));
            foreach (var dig in defaultPlan.DigCells) {
                Assert.IsTrue(bedCoords.Contains((dig.X, dig.Y)), "dig stays strictly within bed footprint");
                Assert.IsTrue(dig.Z == 0 || dig.Z == -1, "deep bed digs z and z-1 only");
            }
            // Adjacent platform row (defaultPlan.Y - 1 and defaultPlan.Y + defaultPlan.Depth) is untouched.
            Assert.IsFalse(defaultPlan.DigCells.Any(c => c.Y == defaultPlan.Y - 1 || c.Y == defaultPlan.Y + defaultPlan.Depth),
                "platform supports beside bed stay intact");

            // 2. Quarter-turned tracks (rot 0..3) all plan cleanly with rotated spans.
            foreach (int rot in new[] { 0, 1, 2, 3 }) {
                var p = StationRailPlanner.Plan(turnedRead.Index, "1", "up", rot, 35, 35, 0);
                Assert.IsTrue(p.Ok, $"rot={rot} failed: {p.Reason}");
                int minX = p.Bed.Min(c => c.X), maxX = p.Bed.Max(c => c.X);
                int minY = p.Bed.Min(c => c.Y), maxY = p.Bed.Max(c => c.Y);
                if (rot % 2 == 0) Assert.Greater(maxX - minX, maxY - minY, "rot " + rot + " runs along X");
                else Assert.Greater(maxY - minY, maxX - minX, "rot " + rot + " runs along Y");
            }

            // 3. Neighbouring-rail Resize collision refusal preserves original document.
            var twoTracks = new JArray {
                new JObject {
                    ["id"] = "track-a", ["type"] = "track", ["x"] = 5, ["y"] = 10, ["z"] = 0,
                    ["w"] = 20, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                },
                new JObject {
                    ["id"] = "track-b", ["type"] = "track", ["x"] = 28, ["y"] = 10, ["z"] = 0,
                    ["w"] = 20, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                },
            };
            var collideRead = ReadSave("resize-collide", slab, twoTracks, twoCarLine);
            var patch = StationRailPlanner.Resize(collideRead.Index, "track-a", 30, 3, out var reason);
            Assert.AreEqual("interference", reason, "resizing into neighbouring rail must refuse");
            Assert.IsEmpty(patch.ModuleReplaces, "refused resize emits no module replaces");
            Assert.IsEmpty(patch.Writes, "refused resize emits no cell writes");
            Assert.IsTrue(collideRead.Index.TryGetModule("track-a", out var originalA));
            Assert.AreEqual(20, originalA.Width, "original track-a width remains untouched");
        }

        [Test]
        public void TunnelOverVoidRefusesEquipmentOverlapSupportsAllFiveRunLengthsAndBoresFiveMetreEnvelope() {
            // 1. Default unset tunnelLength & bridgeLength == 32 (aligned with TRACK_RUN_LENGTHS).
            StationToolSelection.Reset();
            Assert.AreEqual(32, StationTunnelTool.ArmedLength(), "default tunnelLength must be 32");
            Assert.AreEqual(32, StationTunnelTool.ArmedBridgeLength(), "default bridgeLength must be 32");

            // 2. Tunnel over void refuses equipment overlap.
            var cells = new JArray();
            for (int x = 0; x < 10; x++) {
                for (int y = 0; y < 10; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            // Note: x >= 10 is pure void; place a bench at (14, 5, 0) in the void ahead of track-src.
            var modulesWithObstacle = new JArray {
                new JObject {
                    ["id"] = "track-src", ["type"] = "track", ["x"] = 2, ["y"] = 4, ["z"] = 0,
                    ["w"] = 8, ["d"] = 3, ["rot"] = 0,
                    ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                },
                new JObject {
                    ["id"] = "bench-in-void", ["type"] = "bench", ["x"] = 14, ["y"] = 5, ["z"] = 0,
                    ["rot"] = 0, ["cfg"] = new JObject(),
                },
            };
            var obstacleRead = ReadSave("tunnel-void-obstacle", cells, modulesWithObstacle,
                new JArray { LineJson("1", "L", 2, "third-rail") });
            var blockedPlan = StationRailPlanner.PlanTunnel(obstacleRead.Index, "track-src", 16, 9, 5, true);
            Assert.IsFalse(blockedPlan.Ok, "tunnel over void must still refuse equipment overlap");
            Assert.AreEqual("interference", blockedPlan.Reason);
            Assert.Contains("bench-in-void", blockedPlan.ColliderIds);

            // 3. All 5 canonical run lengths [4, 16, 32, 64, 128] via StationTunnelTool.
            int[] canonicalLengths = { 4, 16, 32, 64, 128 };
            foreach (int len in canonicalLengths) {
                var cleanModules = new JArray {
                    new JObject {
                        ["id"] = "track-src", ["type"] = "track", ["x"] = 2, ["y"] = 4, ["z"] = 0,
                        ["w"] = 8, ["d"] = 3, ["rot"] = 0,
                        ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                    },
                };
                var saveJson = new JObject {
                    ["format"] = StationDocumentReader.SaveFormat,
                    ["formatVersion"] = StationDocumentReader.SupportedVersion,
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = "tunnel-len-" + len, ["city"] = "guangzhou", ["seed"] = 7,
                    ["levelBase"] = 0, ["storeyHeight"] = 5,
                    ["static"] = new JObject {
                        ["cells"] = cells, ["modules"] = cleanModules,
                        ["lines"] = new JArray { LineJson("1", "L", 2, "third-rail") },
                    },
                }.ToString(Formatting.None);

                var host = CreateHost(saveJson);
                Track(host.gameObject);
                StationToolSelection.TrySelect("tunnel", out _, out _);
                StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = len });
                Assert.AreEqual(len, StationTunnelTool.ArmedLength());

                Assert.IsTrue(StationTunnelTool.Begin(host, StationCellFixture.Hit(9, 5, 0, true),
                    StationPointerEvent.Synthetic(100, 100, 800, 600, button: 0, timeMs: 0), 0,
                    out var code, out var reason), $"len={len} failed: {code ?? reason}");
                var bored = host.Index.Document.Modules.FirstOrDefault(m => m.Type == "track" && m.Id != "track-src");
                Assert.IsNotNull(bored, "len=" + len + " tunnel created");
                Assert.AreEqual(len, bored.Width, "len=" + len + " tunnel width");
                Assert.IsTrue(bored.Config.Bool("tunnel"), "len=" + len + " tunnel flag");
                var hostGo = host.gameObject;
                cleanupObjects.Remove(hostGo);
                UnityEngine.Object.DestroyImmediate(hostGo);
            }

            // 4. StationTunnelShell.Bore & Strip 5 m envelope: interior rock carved open, open-air walls & 5 m roof built.
            var rockCells = new JArray();
            for (int x = 0; x < 20; x++) {
                for (int y = 0; y < 10; y++) {
                    rockCells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            // Place rock inside the bore path (x=8..15, y=4..6, z=1..3) while leaving side walls (y=3,7) and roof (z=4) open so Bore constructs the shell.
            for (int x = 8; x < 16; x++) {
                for (int y = 4; y <= 6; y++) {
                    for (int z = 1; z <= 3; z++) {
                        rockCells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid" });
                    }
                }
            }
            var boreSave = new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "tunnel-shell-5m", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = rockCells,
                    ["modules"] = new JArray {
                        new JObject {
                            ["id"] = "track-src", ["type"] = "track", ["x"] = 2, ["y"] = 4, ["z"] = 0,
                            ["w"] = 6, ["d"] = 3, ["rot"] = 0,
                            ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                        },
                    },
                    ["lines"] = new JArray { LineJson("1", "L", 2, "third-rail") },
                },
            }.ToString(Formatting.None);

            var shellHost = CreateHost(boreSave);
            Track(shellHost.gameObject);
            StationToolSelection.TrySelect("tunnel", out _, out _);
            StationToolSelection.ApplySettings(new JObject { ["tunnelLength"] = 8 });
            Assert.IsTrue(StationTunnelTool.Begin(shellHost, StationCellFixture.Hit(7, 5, 0, true),
                StationPointerEvent.Synthetic(100, 100, 800, 600, button: 0, timeMs: 0), 0,
                out var boreCode, out var boreReason), boreCode ?? boreReason);

            var boreTrack = shellHost.Index.Document.Modules.First(m => m.Type == "track" && m.Id != "track-src");
            string shellTag = StationTunnelShell.Tag(boreTrack.Id);
            var taggedCells = shellHost.Index.Document.Cells.Where(c => c.Tags.Contains(shellTag)).ToList();
            Assert.IsNotEmpty(taggedCells, "bore created shell cells");
            int shellMaxZ = taggedCells.Max(c => c.Z);
            Assert.GreaterOrEqual(shellMaxZ, 4, "5 m storey tunnel shell roof reaches z >= 4");
            // Interior headroom (z = 1..3 inside bed) is carved open.
            Assert.IsFalse(shellHost.Index.Document.Cells.Any(c =>
                c.X >= 8 && c.X < 16 && c.Y >= 4 && c.Y < 7 && c.Z >= 1 && c.Z <= 3 && c.IsSolid),
                "tunnel bore clears interior headroom");

            var stripWrites = StationTunnelShell.Strip(shellHost.Index, boreTrack.Id);
            Assert.AreEqual(taggedCells.Count, stripWrites.Count, "Strip drops every owned shell cell");
        }

        [Test]
        public void CoveredRailClearanceFiveMetreFixtureRoundTripsCleanly() {
            string repoFixturePath = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../game/test/fixtures/covered-rail-clearance.metro.json"));
            string json;
            if (File.Exists(repoFixturePath)) {
                json = File.ReadAllText(repoFixturePath);
            } else {
                // Inline equivalent 5 m covered double-deck rail fixture if running outside the repo layout.
                var cells = new JArray();
                for (int x = -10; x < 34; x++) {
                    for (int y = 3; y <= 7; y++) {
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 2, ["fill"] = "solid" });
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 7, ["fill"] = "solid" });
                        cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 12, ["fill"] = "solid" });
                    }
                    cells.Add(new JObject { ["x"] = x, ["y"] = 6, ["z"] = 3, ["fill"] = "solid" });
                    cells.Add(new JObject { ["x"] = x, ["y"] = 6, ["z"] = 8, ["fill"] = "solid" });
                }
                var modules = new JArray {
                    new JObject {
                        ["id"] = "track-1", ["type"] = "track", ["x"] = -10, ["y"] = 3, ["z"] = 3,
                        ["w"] = 44, ["d"] = 3, ["rot"] = 0,
                        ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "up", ["power"] = "third-rail" },
                    },
                    new JObject {
                        ["id"] = "track-5", ["type"] = "track", ["x"] = -10, ["y"] = 3, ["z"] = 8,
                        ["w"] = 44, ["d"] = 3, ["rot"] = 0,
                        ["cfg"] = new JObject { ["line"] = "1", ["dir"] = "down", ["power"] = "third-rail" },
                    },
                };
                json = new JObject {
                    ["format"] = StationDocumentReader.SaveFormat,
                    ["formatVersion"] = StationDocumentReader.SupportedVersion,
                    ["savedAt"] = StationDocumentReader.FixedSavedAt,
                    ["name"] = "covered-rail-clearance", ["city"] = "guangzhou", ["seed"] = 7,
                    ["levelBase"] = 2, ["storeyHeight"] = 5,
                    ["static"] = new JObject {
                        ["cells"] = cells, ["modules"] = modules,
                        ["lines"] = new JArray { LineJson("1", "L", 2, "third-rail") },
                    },
                }.ToString(Formatting.None);
            }

            var read = StationDocumentReader.Read(json, new StationSource("covered-rail-clearance", ""));
            Assert.IsNotNull(read?.Document, "covered-rail-clearance read failed");
            Assert.AreEqual(5, read.Document.StoreyHeight, "fixture uses 5 m storey height");

            var tracks = read.Document.Modules.Where(m => m.Type == "track").OrderBy(m => m.Z).ToList();
            Assert.GreaterOrEqual(tracks.Count, 2, "fixture carries lower and upper stacked tracks");
            Assert.AreEqual(5, tracks[1].Z - tracks[0].Z, "stacked tracks separated by 5 m");

            // Verify 3-course third-rail headroom (z+1..z+3) above every track bed cell has zero solid obstruction.
            foreach (var track in tracks) {
                foreach (var cell in StationRailRules.Cells(track)) {
                    for (int dz = 1; dz <= StationRailRules.ThirdRailHeadroom; dz++) {
                        var above = read.Index.GetCell(cell.X, cell.Y, track.Z + dz);
                        Assert.IsTrue(above == null || !above.IsSolid,
                            $"track {track.Id} headroom blocked at ({cell.X},{cell.Y},{track.Z + dz})");
                    }
                }
            }

            // Round-trip through StationGameHost save & re-read.
            var host = CreateHost(json);
            Track(host.gameObject);
            string saved = host.SaveDocument();
            var roundTrip = StationDocumentReader.Read(saved, new StationSource("covered-rt", ""));
            Assert.IsNotNull(roundTrip?.Document, "round-trip failed");
            Assert.AreEqual(5, roundTrip.Document.StoreyHeight, "storeyHeight survives round-trip");
            Assert.AreEqual(read.Document.Cells.Count, roundTrip.Document.Cells.Count, "cell count preserved");
            Assert.AreEqual(read.Document.Modules.Count, roundTrip.Document.Modules.Count, "module count preserved");
        }

        /* ---------------------------------------- 6. PSD header & PSD end parity */

        [Test]
        public void PsdHeaderTerminalMatchingWhitespaceFallbackAndAllFourArrowDirections() {
            // 1. Only the matching terminus direction sets Terminal = true.
            var upTerminal = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "right", LineId = "5",
                StationName = "文冲", UpTerminus = "文冲", DownTerminus = "滘口",
            });
            var downNotTerminal = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "down", Side = "right", LineId = "5",
                StationName = "文冲", UpTerminus = "文冲", DownTerminus = "滘口",
            });
            Assert.IsTrue(upTerminal.Terminal, "up direction matches station terminus");
            Assert.IsFalse(downNotTerminal.Terminal, "opposite direction is not terminal");

            // 2. Trimmed whitespace match.
            var trimmed = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "left", LineId = "5",
                StationName = "  动物园  ", UpTerminus = " 动物园",
            });
            Assert.IsTrue(trimmed.Terminal, "trimmed station name matches trimmed terminus");

            // 3. Empty/whitespace StationName is NEVER terminal — even when Destination matches fallback "地铁站" or "上行".
            var emptyVsDefault = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "right", LineId = "5",
                StationName = "", UpTerminus = "地铁站",
            });
            Assert.AreEqual("地铁站", emptyVsDefault.StationName, "display fallback still populated");
            Assert.IsFalse(emptyVsDefault.Terminal, "empty StationName must NEVER falsely match fallback '地铁站'");

            var blankVsDirection = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "right", LineId = "5",
                StationName = "   ", UpTerminus = "",
            });
            Assert.IsFalse(blankVsDirection.Terminal, "whitespace StationName with empty terminus is never terminal");
            Assert.IsTrue(blankVsDirection.DirectionFallback, "empty terminus uses direction fallback");

            // 4. Whitespace nextStation trims cleanly to empty string.
            var wsNext = OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "right", LineId = "5",
                StationName = "动物园", UpTerminus = "文冲", UpNextStation = "   \t  ",
            });
            Assert.AreEqual("", wsNext.Adjacent, "whitespace nextStation falls back to empty");

            // 5. All 4 (dir, side) arrow combinations.
            Assert.AreEqual(-1, OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "left", StationName = "A", UpTerminus = "B",
            }).Arrow, "up/left arrow");
            Assert.AreEqual(1, OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "up", Side = "right", StationName = "A", UpTerminus = "B",
            }).Arrow, "up/right arrow");
            Assert.AreEqual(1, OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "down", Side = "left", StationName = "A", DownTerminus = "B",
            }).Arrow, "down/left arrow");
            Assert.AreEqual(-1, OpeningModuleViews.PsdHeaderFor(new OpeningModuleViews.OpeningRequest {
                Dir = "down", Side = "right", StationName = "A", DownTerminus = "B",
            }).Arrow, "down/right arrow");
        }

        [Test]
        public void PsdEndBlocksWalkGraphProvidesFourRotationClearanceRoundTripsAndSnapsToNeighbour() {
            // 1. psd-end blocks walk graph node on its own cell while neighbours stay walkable.
            var simDoc = new StationSessionDocument { StationId = "psd-end-walk", LevelBase = 0 };
            for (int x = 0; x < 6; x++) {
                for (int y = 0; y < 6; y++) {
                    simDoc.Cells.Add(new StationCellFact { X = x, Y = y, Z = 0, Solid = true, Zone = 2, Speed = 1 });
                }
            }
            simDoc.Modules.Add(new StationModuleFact {
                Id = "psd-end-1", Type = "psd-end", X = 3, Y = 3, Z = 0, Rot = 0,
            });
            var walkGraph = StationWalkGraphBuilder.Build(simDoc);
            Assert.IsFalse(walkGraph.TryNode(3, 3, 0, out _), "psd-end cell must be blocked in walk graph");
            Assert.IsTrue(walkGraph.TryNode(2, 3, 0, out _), "neighbouring floor cell stays walkable");
            Assert.IsTrue(walkGraph.TryNode(4, 3, 0, out _), "opposite neighbouring floor cell stays walkable");

            // 2. StationFootprints.TryClearance across all 4 rotations + save/read round-trip.
            var cells = new JArray();
            for (int x = 0; x < 12; x++) {
                for (int y = 0; y < 12; y++) {
                    cells.Add(new JObject { ["x"] = x, ["y"] = y, ["z"] = 0, ["fill"] = "solid" });
                }
            }
            var modules = new JArray();
            for (int rot = 0; rot < 4; rot++) {
                modules.Add(new JObject {
                    ["id"] = "psd-rot-" + rot, ["type"] = "psd-end",
                    ["x"] = 2 + rot * 2, ["y"] = 2, ["z"] = 0, ["rot"] = rot,
                    ["cfg"] = new JObject {
                        ["psd"] = rot % 2 == 0 ? "half" : "full",
                        ["corner"] = "edge-1",
                        ["offset"] = new JArray(0.05, 0.12),
                    },
                });
            }
            // Existing snapped psd-end panel with no nearby screen for positive continuation snap.
            modules.Add(new JObject {
                ["id"] = "psd-anchor", ["type"] = "psd-end",
                ["x"] = 6, ["y"] = 8, ["z"] = 0, ["rot"] = 0,
                ["cfg"] = new JObject {
                    ["psd"] = "half",
                    ["corner"] = "edge-far",
                    ["offset"] = new JArray(0.08, 0.14),
                },
            });

            var read = ReadSave("psd-end-parity", cells, modules, new JArray());
            for (int rot = 0; rot < 4; rot++) {
                Assert.IsTrue(read.Index.TryGetModule("psd-rot-" + rot, out var mod));
                Assert.IsTrue(StationFootprints.TryClearance(mod, out var box, out var reason),
                    $"rot={rot} TryClearance failed: {reason}");
                Assert.IsFalse(box.IsEmpty, "rot=" + rot + " clearance non-empty");
                double expectedH = rot % 2 == 0 ? StationFootprints.PsdHalfHeight : StationFootprints.PsdFullHeight;
                Assert.AreEqual(expectedH, box.Z1 - box.Z0, 1e-6, "rot=" + rot + " clearance height");
            }

            // Save round-trip preserves offset, corner, psd, rot.
            var host = CreateHost(new JObject {
                ["format"] = StationDocumentReader.SaveFormat,
                ["formatVersion"] = StationDocumentReader.SupportedVersion,
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = "psd-rt", ["city"] = "guangzhou", ["seed"] = 7,
                ["levelBase"] = 0, ["storeyHeight"] = 5,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() },
            }.ToString(Formatting.None));
            Track(host.gameObject);
            var rt = StationDocumentReader.Read(host.SaveDocument(), new StationSource("psd-rt", ""));
            Assert.IsNotNull(rt?.Document);
            Assert.IsTrue(rt.Index.TryGetModule("psd-anchor", out var rtAnchor));
            Assert.AreEqual("half", rtAnchor.Config.Text("psd"));
            Assert.AreEqual("edge-far", rtAnchor.Config.Text("corner"));
            Assert.AreEqual(0.08, rtAnchor.OffsetX, 1e-6);
            Assert.AreEqual(0.14, rtAnchor.OffsetY, 1e-6);

            // 3. Positive continuation snap onto neighbouring psd-end panel (carries glass plane, clears corner & OffsetX).
            var nextPanel = new StationEditDraft {
                Id = "psd-next", Type = "psd-end", X = 7, Y = 8, Z = 0, Rotation = 0,
            };
            nextPanel.Set("psd", "half");
            Assert.IsTrue(StationPsdEndRules.TrySnap(read.Index, nextPanel),
                "adjacent psd-end along same glass plane must snap to neighbour");
            Assert.AreEqual(0.0, nextPanel.OffsetX, 1e-6, "continuation snap clears corner length trim OffsetX");
            Assert.AreEqual(0.14, nextPanel.OffsetY, 1e-6, "continuation snap carries neighbour glass plane OffsetY");
            Assert.AreEqual("", nextPanel.Text("corner"), "continuation snap does not copy neighbour corner id");
        }

        [Test]
        public void TianheTypeAOpenPlugDoorsClearEveryPsdFrameOnSingleAndDualPlatforms() {
            const string tianhePath = "Assets/StationDesigner/Demos/tianhe.metro.json";
            if (!File.Exists(Path.Combine(Application.dataPath, "StationDesigner/Demos/tianhe.metro.json"))) {
                Assert.Ignore("tianhe.metro.json not exported");
            }
            var trainCatalogue = LoadTrainCatalogue();
            var openingCatalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(openingCatalogue, "RuntimeCatalogue missing");
            var read = StationDocumentReader.ReadFile(tianhePath);
            Assert.IsNotNull(read?.Document, "Tianhe failed to read");

            // Dual-platform (Spanish-solution) Line 13 Type-A tracks must centre across the 3 m bed.
            foreach (var trackId in new[] { "track-55", "track-57" }) {
                Assert.IsTrue(read.Index.TryGetModule(trackId, out var dualTrack));
                float v = StationRailGeometry.TrainCentreAcross(dualTrack, 3.0f * 0.98f, read.Document, "13", "up");
                Assert.AreEqual(1.5f, v, 1e-4f, trackId + " with platforms on both sides must centre at d/2");
            }

            var root = Track(new GameObject("tianhe-type-a-door-clearance"));
            var trains = new TrainConsistRenderer();
            var openings = new OpeningModuleRenderer();
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var world = TrackWorld(new StationWorldView(root.transform, "tianhe-clearance",
                new IStationViewRenderer[] { trains, openings },
                new StationViewAssets { Catalogue = openingCatalogue, TrainCatalogue = trainCatalogue, Shader = shader }));
            world.Build(read.Document, read.Index);
            world.Activate();

            var cases = new[] {
                ("11|track-53", "edge-track-53-left"),
                ("11|track-54", "edge-track-54-right"),
                ("13|track-55", "edge-track-55-right"),
                ("13|track-55", "edge-track-55-left"),
                ("13|track-57", "edge-track-57-right"),
                ("13|track-57", "edge-track-57-left"),
            };

            foreach (var (trainId, edgeId) in cases) {
                Assert.IsTrue(trains.TryGetConsist(trainId, out var consist), "missing consist " + trainId);
                Assert.IsTrue(openings.Views.TryGet(edgeId, out var psdView), "missing PSD " + edgeId);
                Assert.IsTrue(read.Index.TryGetModule(edgeId, out var edgeRec), "missing edge record " + edgeId);
                Assert.IsTrue(read.Index.TryGetModule(consist.TrackId, out var trackRec), "missing track " + consist.TrackId);

                consist.Mount();
                consist.Place();
                psdView.Apply(OpeningState.Uniform(1f));

                // Unit vector across the track from the consist centre toward this platform edge.
                var sideVec = TrainConsistGeometry.Side(trackRec.Rotation);
                bool isLeft = string.Equals(edgeRec.Config.Text("side"), "left", StringComparison.Ordinal);
                var toPlatform = isLeft ? sideVec : -sideVec;
                var berth = consist.Berth.DocumentPosition;
                float minDoorZ = trackRec.Z + 1.02f;

                // Closed doors must seat flush with the Type-A car skin (authoredOpen prefabs must not
                // retain their outward plug offset when closed).
                consist.Rig.Reset();
                float closedDoorMax = float.NegativeInfinity;
                foreach (var mf in consist.Root.GetComponentsInChildren<MeshFilter>(true)) {
                    if (mf == null || mf.sharedMesh == null) continue;
                    bool isDoorMesh = false;
                    for (var t = mf.transform; t != null && t != consist.Root.transform; t = t.parent) {
                        if (System.Text.RegularExpressions.Regex.IsMatch(t.name, @"Door\d+$")) {
                            isDoorMesh = true;
                            break;
                        }
                    }
                    if (!isDoorMesh) continue;
                    var verts = mf.sharedMesh.vertices;
                    var l2w = mf.transform.localToWorldMatrix;
                    for (int i = 0; i < verts.Length; i++) {
                        var doc = StationCoordinates.WorldToDocument(l2w.MultiplyPoint3x4(verts[i]));
                        if (doc.z < minDoorZ) continue;
                        float proj = (doc.x - berth.x) * toPlatform.x + (doc.y - berth.y) * toPlatform.y;
                        if (proj > closedDoorMax) closedDoorMax = proj;
                    }
                }
                Assert.LessOrEqual(closedDoorMax, 1.485f,
                    $"{trainId} vs {edgeId}: closed Type-A door max reach ({closedDoorMax:0.####} m) must seat flush with the 2.94 m car skin");

                consist.Rig.ApplyMask(1f);

                float trainDoorMax = float.NegativeInfinity;
                float trainDoorTopZ = float.NegativeInfinity;
                int doorFilterCount = 0;
                foreach (var mf in consist.Root.GetComponentsInChildren<MeshFilter>(true)) {
                    if (mf == null || mf.sharedMesh == null) continue;
                    bool isDoorMesh = false;
                    for (var t = mf.transform; t != null && t != consist.Root.transform; t = t.parent) {
                        if (System.Text.RegularExpressions.Regex.IsMatch(t.name, @"Door\d+$")) {
                            isDoorMesh = true;
                            break;
                        }
                    }
                    if (!isDoorMesh) continue;
                    doorFilterCount++;
                    var verts = mf.sharedMesh.vertices;
                    var l2w = mf.transform.localToWorldMatrix;
                    for (int i = 0; i < verts.Length; i++) {
                        var doc = StationCoordinates.WorldToDocument(l2w.MultiplyPoint3x4(verts[i]));
                        if (doc.z < minDoorZ) continue;
                        if (doc.z > trainDoorTopZ) trainDoorTopZ = doc.z;
                        float proj = (doc.x - berth.x) * toPlatform.x + (doc.y - berth.y) * toPlatform.y;
                        if (proj > trainDoorMax) trainDoorMax = proj;
                    }
                }
                Assert.Greater(doorFilterCount, 0, trainId + " must have door leaf meshes");

                float psdMin = float.PositiveInfinity;
                int psdFilterCount = 0;
                foreach (var mf in psdView.Holder.GetComponentsInChildren<MeshFilter>(true)) {
                    if (mf == null || mf.sharedMesh == null) continue;
                    psdFilterCount++;
                    var verts = mf.sharedMesh.vertices;
                    var l2w = mf.transform.localToWorldMatrix;
                    for (int i = 0; i < verts.Length; i++) {
                        var doc = StationCoordinates.WorldToDocument(l2w.MultiplyPoint3x4(verts[i]));
                        if (doc.z < minDoorZ || doc.z > trainDoorTopZ) continue;
                        float proj = (doc.x - berth.x) * toPlatform.x + (doc.y - berth.y) * toPlatform.y;
                        if (proj < psdMin) psdMin = proj;
                    }
                }
                Assert.Greater(psdFilterCount, 0, edgeId + " must have PSD meshes");

                float clearance = psdMin - trainDoorMax;
                Assert.Greater(clearance, 0.005f,
                    $"{trainId} vs {edgeId}: open Type-A plug door max reach ({trainDoorMax:0.####} m) overlaps PSD min reach ({psdMin:0.####} m), clearance={clearance:0.####} m");
            }
        }
    }
}
