using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// Parity tests for adjoining ramp seams and inner-railing suppression
    /// (<c>game/test/ramp-join.test.mjs</c> and <c>game/test/bay.test.mjs</c>):
    /// direct unit pins on <see cref="StationRampOpenings"/> and <see cref="VerticalModuleViews"/>
    /// covering escalator+escalator, stair+escalator, stair+stair, widened 1-block caps,
    /// obstacle suppression, and misaligned/opposing-direction rejections.
    /// </summary>
    public sealed class StationRampJoinTests {
        const string PrefabFolder = "Assets/StationDesigner/Generated/Prefabs/";

        readonly List<GameObject> parents = new List<GameObject>();
        readonly List<VerticalModuleView> views = new List<VerticalModuleView>();

        [TearDown]
        public void TearDown() {
            for (int i = 0; i < views.Count; i++) views[i]?.Dispose();
            views.Clear();
            for (int i = 0; i < parents.Count; i++) {
                if (parents[i] != null) UnityEngine.Object.DestroyImmediate(parents[i]);
            }
            parents.Clear();
        }

        /* ---------------------------------------------------------- helpers */

        static (int Dx, int Dy) StairFacing(int rot) {
            switch (((rot % 4) + 4) % 4) {
                case 1: return (1, 0);
                case 2: return (0, -1);
                case 3: return (-1, 0);
                default: return (0, 1);
            }
        }

        static JObject EscalatorJson(string id, int x, int y, int z, int rot = 0, int width = 1,
            string dir = "up", int run = 9, int rise = 5) {
            var (dx, dy) = StairFacing(rot);
            int lowX = x, lowY = y, lowZ = z;
            int highX = x + dx * run, highY = y + dy * run, highZ = z + rise;
            bool down = string.Equals(dir, "down", StringComparison.Ordinal);
            return new JObject {
                ["id"] = id, ["type"] = "escalator", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = down ? highX : lowX, ["y"] = down ? highY : lowY, ["z"] = down ? highZ : lowZ },
                ["to"] = new JObject { ["x"] = down ? lowX : highX, ["y"] = down ? lowY : highY, ["z"] = down ? lowZ : highZ },
                ["cfg"] = new JObject { ["incline"] = 30, ["dir"] = dir, ["width"] = width },
            };
        }

        static JObject StairJson(string id, int x, int y, int z, int rot = 0, double width = 0.68,
            int run = 8, int rise = 5, string flight = "") {
            var (dx, dy) = StairFacing(rot);
            var cfg = new JObject {
                ["width"] = width, ["style"] = "straight",
                ["flights"] = new JArray {
                    new JObject {
                        ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
                        ["to"] = new JObject { ["x"] = x + dx * run, ["y"] = y + dy * run, ["z"] = z + rise },
                    },
                },
            };
            if (!string.IsNullOrEmpty(flight)) cfg["flight"] = flight;
            return new JObject {
                ["id"] = id, ["type"] = "stair", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
                ["w"] = 1, ["d"] = 1,
                ["from"] = new JObject { ["x"] = x, ["y"] = y, ["z"] = z },
                ["to"] = new JObject { ["x"] = x + dx * run, ["y"] = y + dy * run, ["z"] = z + rise },
                ["cfg"] = cfg,
            };
        }

        static JObject StairBlockJson(string id, int x, int y, int z, int rot = 0) => new JObject {
            ["id"] = id, ["type"] = "stair", ["x"] = x, ["y"] = y, ["z"] = z, ["rot"] = rot,
            ["w"] = 1, ["d"] = 1,
            ["from"] = new JObject { ["x"] = x, ["y"] = y - 1, ["z"] = z },
            ["to"] = new JObject { ["x"] = x, ["y"] = y + 1, ["z"] = z + 1 },
            ["cfg"] = new JObject { ["width"] = 1, ["block"] = true, ["blockHeight"] = 1 },
        };

        static GameObject LoadPrefab(string name) =>
            AssetDatabase.LoadAssetAtPath<GameObject>(PrefabFolder + name + ".prefab");

        VerticalModuleView Build(JObject module, IReadOnlyList<ModuleFacts> neighbours,
            Func<int, int, int, bool> solid = null, bool withPrefab = false) {
            var parent = new GameObject("ramp-join-" + (string)module["id"]);
            parents.Add(parent);
            var facts = ModuleFactsReader.Read(module);
            GameObject prefab = null;
            string key = "";
            if (withPrefab) {
                if ((string)module["type"] == "escalator") { prefab = LoadPrefab("Escalator"); key = "escalator"; }
                else if ((string)module["type"] == "stair") { prefab = LoadPrefab("StairStraight"); key = "stair-straight"; }
            }
            var request = VerticalModuleRequest.FromFacts(facts, prefab, key, solid ?? ((_, __, ___) => false),
                null, null, null, neighbours);
            Assert.IsTrue(VerticalModuleViews.TryBuild(request, parent.transform, out var view),
                "build failed for " + (string)module["id"]);
            views.Add(view);
            return view;
        }

        static List<MeshFilter> JoinMeshes(VerticalModuleView view, string name = "ramp-join") =>
            view.Root.GetComponentsInChildren<MeshFilter>(true)
                .Where(f => f != null && string.Equals(f.name, name, StringComparison.Ordinal) && f.sharedMesh != null)
                .ToList();

        static (Vector3 Min, Vector3 Max) DocBoundsOf(MeshFilter filter) {
            var verts = filter.sharedMesh.vertices;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int i = 0; i < verts.Length; i++) {
                var p = StationCoordinates.WorldToDocument(filter.transform.TransformPoint(verts[i]));
                min = Vector3.Min(min, p);
                max = Vector3.Max(max, p);
            }
            return (min, max);
        }

        static Func<int, int, int, bool> SolidSet(params (int X, int Y, int Z)[] cells) {
            var set = new HashSet<(int, int, int)>(cells);
            return (x, y, z) => set.Contains((x, y, z));
        }

        /* --------------------------------------------- escalator + escalator */

        [Test]
        public void AdjacentEscalatorsShareOneSteelJoinCapAcrossRotationsWidthsAndDirections() {
            for (int rot = 0; rot < 4; rot++) {
                var (dx, dy) = StairFacing(rot);
                foreach (int width in new[] { 1, 2, 3 }) {
                    foreach (var dir in new[] { "up", "down" }) {
                        var a = EscalatorJson("a", 0, 0, 0, rot, width, dir);
                        var b = EscalatorJson("b", width * dy, -width * dx, 0, rot, 1, dir == "up" ? "down" : "up");
                        var facts = new List<ModuleFacts> { ModuleFactsReader.Read(a), ModuleFactsReader.Read(b) };

                        var viewA = Build(a, facts);
                        var viewB = Build(b, facts);
                        var capsA = JoinMeshes(viewA);
                        var capsB = JoinMeshes(viewB);

                        Assert.AreEqual(1, capsA.Count, $"rot={rot} w={width} dir={dir}: lower id owns the shared seam cap");
                        Assert.AreEqual(0, capsB.Count, $"rot={rot} w={width} dir={dir}: neighbour must not duplicate the seam");
                        Assert.AreEqual(1, JoinMeshes(viewA, "ramp-join-dome").Count,
                            $"rot={rot} w={width} dir={dir}: shared seam carries anti-slide domes");

                        var (min, max) = DocBoundsOf(capsA[0]);
                        var size = max - min;
                        float along = dx == 0 ? size.y : size.x;
                        float across = dx == 0 ? size.x : size.y;
                        Assert.Greater(along, 5f, $"rot={rot} w={width} dir={dir}: cap spans the incline");
                        Assert.AreEqual(0.32f, across, 0.02f,
                            $"rot={rot} w={width} dir={dir}: flush cap fills 28 cm gap + 2 cm rail overlap each side");

                        // Reversed neighbour list order must still assign the cap to "a" once.
                        var reversed = new List<ModuleFacts> { facts[1], facts[0] };
                        Assert.AreEqual(1, JoinMeshes(Build(a, reversed)).Count, "order-independent owner");
                        Assert.AreEqual(0, JoinMeshes(Build(b, reversed)).Count, "order-independent neighbour");

                        // Removing the neighbour removes the seam cap completely.
                        Assert.AreEqual(0, JoinMeshes(Build(a, new List<ModuleFacts> { facts[0] })).Count,
                            "solo escalator draws no seam cap");
                    }
                }
            }
        }

        [Test]
        public void EscalatorBankOfThreeCreatesTwoFlushCapsAndZeroOuterCaps() {
            var a = EscalatorJson("a", 0, 0, 0, 0, 1, "up");
            var b = EscalatorJson("b", 1, 0, 0, 0, 1, "down");
            var c = EscalatorJson("c", 2, 0, 0, 0, 1, "up");
            var facts = new List<ModuleFacts> {
                ModuleFactsReader.Read(a), ModuleFactsReader.Read(b), ModuleFactsReader.Read(c),
            };

            var capsA = JoinMeshes(Build(a, facts));
            var capsB = JoinMeshes(Build(b, facts));
            var capsC = JoinMeshes(Build(c, facts));

            Assert.AreEqual(1, capsA.Count, "a bridges only to b (not across b to c)");
            Assert.AreEqual(1, capsB.Count, "b bridges to c");
            Assert.AreEqual(0, capsC.Count, "outermost c owns no join cap");

            foreach (var cap in capsA.Concat(capsB)) {
                var (min, max) = DocBoundsOf(cap);
                Assert.AreEqual(0.32f, max.x - min.x, 0.02f,
                    "middle escalator stops a widened cap between outer pair");
            }
        }

        [Test]
        public void ParallelEscalatorsOneBlockApartShareWidenedCapAndObstaclesPreventIt() {
            var a = EscalatorJson("a", 0, 0, 0, 0, 1, "up");
            var b = EscalatorJson("b", 2, 0, 0, 0, 1, "down");
            var pair = new List<ModuleFacts> { ModuleFactsReader.Read(a), ModuleFactsReader.Read(b) };

            var widened = JoinMeshes(Build(a, pair));
            Assert.AreEqual(1, widened.Count, "one empty block between parallel escalators is bridged");
            var (min, max) = DocBoundsOf(widened[0]);
            Assert.AreEqual(1.32f, max.x - min.x, 0.03f, "widened cap spans the empty block plus rail overlaps");

            // Two empty blocks apart exceeds the widened cap span.
            var far = EscalatorJson("far", 3, 0, 0, 0, 1, "down");
            var farPair = new List<ModuleFacts> { ModuleFactsReader.Read(a), ModuleFactsReader.Read(far) };
            Assert.AreEqual(0, JoinMeshes(Build(a, farPair)).Count, "2-block clearance is not bridged");

            // Solid stacked wall in the middle gap suppresses the widened cap.
            var wallSolid = SolidSet((1, 3, 2), (1, 3, 3));
            Assert.AreEqual(0, JoinMeshes(Build(a, pair, wallSolid)).Count, "solid column blocks the widened cap");

            // A block deep beneath the incline does not block it.
            var deepBlock = SolidSet((1, 3, -5));
            Assert.AreEqual(1, JoinMeshes(Build(a, pair, deepBlock)).Count, "deep block below incline allows cap");

            // An isolated ceiling slab course over an open shaft allows the widened cap.
            var isolatedSlab = SolidSet((1, 3, 3));
            Assert.AreEqual(1, JoinMeshes(Build(a, pair, isolatedSlab)).Count,
                "isolated ceiling slab over cleared shaft allows cap");

            // A crossing stair in the gap blocks the widened cap.
            var crossing = StairJson("cross", 1, 3, 0, rot: 1);
            var withCrossing = new List<ModuleFacts> { pair[0], pair[1], ModuleFactsReader.Read(crossing) };
            Assert.AreEqual(0, JoinMeshes(Build(a, withCrossing)).Count, "crossing stair blocks widened cap");
        }

        /* ----------------------------------------------- stair + escalator */

        [Test]
        public void AdjacentStairAndEscalatorShareMixedJoinCapAndSwitchInnerBalustradeToSteel() {
            for (int rot = 0; rot < 4; rot++) {
                var (dx, dy) = StairFacing(rot);
                foreach (int side in new[] { -1, 1 }) {
                    // Pair an 8-cell escalator with an 8-cell straight stair so landings match exactly.
                    var esc = EscalatorJson("e", 0, 0, 0, rot, 1, "up", run: 8, rise: 5);
                    var st = StairJson("s", side * dy, -side * dx, 0, rot, 0.68, run: 8, rise: 5);
                    var facts = new List<ModuleFacts> { ModuleFactsReader.Read(esc), ModuleFactsReader.Read(st) };

                    var view = Build(esc, facts);
                    var caps = JoinMeshes(view);
                    Assert.AreEqual(1, caps.Count, $"rot={rot} side={side}: flush stair+escalator builds mixed join cap");
                    Assert.AreEqual(1, JoinMeshes(view, "ramp-join-dome").Count,
                        $"rot={rot} side={side}: mixed join cap seats domes");

                    // Facing escalator balustrade switches from glass to steel; outer remains glass.
                    var left = view.Root.GetComponentsInChildren<MeshRenderer>(true)
                        .FirstOrDefault(r => r.name == "balustrade-left");
                    var right = view.Root.GetComponentsInChildren<MeshRenderer>(true)
                        .FirstOrDefault(r => r.name == "balustrade-right");
                    Assert.IsNotNull(left);
                    Assert.IsNotNull(right);
                    var joinMat = caps[0].GetComponent<MeshRenderer>().sharedMaterial;
                    // `side = +1` places the stair along -Across (right side in BuildRampJoins), `side = -1` along +Across (left).
                    bool leftIsSteel = left.sharedMaterial == joinMat;
                    bool rightIsSteel = right.sharedMaterial == joinMat;
                    Assert.IsTrue(leftIsSteel ^ rightIsSteel,
                        $"rot={rot} side={side}: exactly the inner facing balustrade becomes steel while outer stays glass");
                }
            }

            // A stair separated by 1 empty block from an escalator is NOT bridged (mixed joins are flush only).
            var e0 = EscalatorJson("e0", 0, 0, 0, 0, 1, "up", run: 8, rise: 5);
            var sFar = StairJson("sFar", 2, 0, 0, 0, 0.68, run: 8, rise: 5);
            Assert.AreEqual(0, JoinMeshes(Build(e0, new List<ModuleFacts> {
                ModuleFactsReader.Read(e0), ModuleFactsReader.Read(sFar),
            })).Count, "separated stair and escalator do not bridge");
        }

        /* --------------------------------------------------- stair + stair */

        [Test]
        public void AdjacentStairsWithSharedFlightSuppressInnerRailingsWhileIndependentAndSeparatedStairsKeepThem() {
            // 1. Shared `cfg.flight` (one wide multi-lane flight): inner railings suppressed on the seam.
            var sharedA = StairJson("st-a", 0, 0, 0, rot: 0, width: 0.68, flight: "flight-1");
            var sharedB = StairJson("st-b", 1, 0, 0, rot: 0, width: 0.68, flight: "flight-1");
            var sharedFacts = new List<ModuleFacts> { ModuleFactsReader.Read(sharedA), ModuleFactsReader.Read(sharedB) };

            var matesA = StationRampOpenings.StairLaneMates(sharedFacts, sharedFacts[0]);
            var matesB = StationRampOpenings.StairLaneMates(sharedFacts, sharedFacts[1]);
            Assert.AreEqual(1, matesA.Count, "west stair detects east lane mate");
            Assert.IsTrue(matesA[0].SameFlight, "shared flight token flags SameFlight");
            Assert.AreEqual(1, matesA[0].StepX);
            Assert.AreEqual(1, matesB.Count, "east stair detects west lane mate");
            Assert.IsTrue(matesB[0].SameFlight);
            Assert.AreEqual(-1, matesB[0].StepX);

            var viewSharedA = Build(sharedA, sharedFacts, withPrefab: true);
            var viewSharedB = Build(sharedB, sharedFacts, withPrefab: true);
            Assert.IsFalse(viewSharedA.UsedPrefab, "lane-mated stair must not instance 2-rail prefab");
            Assert.AreEqual("lane-mates", viewSharedA.PrefabRejectReason);
            // rot 0 climbs +y: local left is -x (outer for A, inner for B), local right is +x (inner for A, outer for B).
            Assert.IsTrue(viewSharedA.TryGetPart("handrail-left-0", out _), "west stair keeps outer (-x) handrail");
            Assert.IsFalse(viewSharedA.TryGetPart("handrail-right-0", out _), "west stair suppresses inner (+x) handrail");
            Assert.IsFalse(viewSharedB.TryGetPart("handrail-left-0", out _), "east stair suppresses inner (-x) handrail");
            Assert.IsTrue(viewSharedB.TryGetPart("handrail-right-0", out _), "east stair keeps outer (+x) handrail");

            // 2. Adjacent independent stairs (no shared `cfg.flight`): treads meet at seam, inner railings STAY.
            var indepA = StairJson("ind-a", 0, 0, 0, rot: 0, width: 0.68);
            var indepB = StairJson("ind-b", 1, 0, 0, rot: 0, width: 0.68);
            var indepFacts = new List<ModuleFacts> { ModuleFactsReader.Read(indepA), ModuleFactsReader.Read(indepB) };

            var indepMates = StationRampOpenings.StairLaneMates(indepFacts, indepFacts[0]);
            Assert.AreEqual(1, indepMates.Count, "independent adjacent stairs still detect tread join");
            Assert.IsFalse(indepMates[0].SameFlight, "separate stairs are not SameFlight");

            var viewIndepA = Build(indepA, indepFacts);
            var viewIndepB = Build(indepB, indepFacts);
            Assert.IsTrue(viewIndepA.TryGetPart("handrail-left-0", out _));
            Assert.IsTrue(viewIndepA.TryGetPart("handrail-right-0", out _), "independent west stair keeps inner handrail");
            Assert.IsTrue(viewIndepB.TryGetPart("handrail-left-0", out _), "independent east stair keeps inner handrail");
            Assert.IsTrue(viewIndepB.TryGetPart("handrail-right-0", out _));

            // 3. Separated stairs (1-block gap): zero lane mates, both keep independent handrails.
            var sepB = StairJson("sep-b", 2, 0, 0, rot: 0, width: 0.68, flight: "flight-1");
            var sepFacts = new List<ModuleFacts> { ModuleFactsReader.Read(sharedA), ModuleFactsReader.Read(sepB) };
            Assert.AreEqual(0, StationRampOpenings.StairLaneMates(sepFacts, sepFacts[0]).Count,
                "separated stairs have no lane mates");
            var viewSepA = Build(sharedA, sepFacts);
            Assert.IsTrue(viewSepA.TryGetPart("handrail-left-0", out _));
            Assert.IsTrue(viewSepA.TryGetPart("handrail-right-0", out _), "separated stair keeps both handrails");
        }

        /* ---------------------------------------- opposing / misaligned / bad */

        [Test]
        public void OpposingDirectionMisalignedDifferentLengthOrBlockStairsDoNotJoin() {
            var baseEsc = EscalatorJson("e-base", 0, 0, 0, rot: 0, width: 1, dir: "up", run: 9, rise: 5);
            var baseFacts = ModuleFactsReader.Read(baseEsc);

            var nonJoining = new (string Label, JObject Other)[] {
                ("staggered landing y+1", EscalatorJson("z-stagger", 1, 1, 0, rot: 0)),
                ("opposing climb heading rot=2", EscalatorJson("z-oppose", 1, 9, 0, rot: 2)),
                ("crossing axis rot=1", EscalatorJson("z-cross", 1, 0, 0, rot: 1)),
                ("different elevation z=4", EscalatorJson("z-high", 1, 0, 4, rot: 0)),
                ("different run length short vs long", EscalatorJson("z-short", 1, 0, 0, rot: 0, run: 5, rise: 3)),
                ("stair block has no matching balustrade", StairBlockJson("z-block", 1, 0, 0, rot: 0)),
            };

            foreach (var (label, other) in nonJoining) {
                var neighbours = new List<ModuleFacts> { baseFacts, ModuleFactsReader.Read(other) };
                Assert.AreEqual(0, JoinMeshes(Build(baseEsc, neighbours)).Count,
                    label + " must not grow a ramp-join cap");
            }

            // Misaligned / opposing / diagonal stairs produce zero StairLaneMates.
            var baseStair = StairJson("s-base", 0, 0, 0, rot: 0, flight: "f");
            var baseStairFacts = ModuleFactsReader.Read(baseStair);
            var nonMateStairs = new (string Label, JObject Other)[] {
                ("opposing climb direction", StairJson("s-opp", 1, 8, 0, rot: 2, flight: "f")),
                ("different elevation", StairJson("s-hi", 1, 0, 5, rot: 0, flight: "f")),
                ("crossing axis", StairJson("s-cross", 1, 0, 0, rot: 1, flight: "f")),
                ("wide single-piece stair", StairJson("s-wide", 1, 0, 0, rot: 0, width: 1.36, flight: "f")),
                ("diagonal flight", new JObject {
                    ["id"] = "s-diag", ["type"] = "stair", ["x"] = 1, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                    ["from"] = new JObject { ["x"] = 1, ["y"] = 0, ["z"] = 0 },
                    ["to"] = new JObject { ["x"] = 4, ["y"] = 4, ["z"] = 5 },
                    ["cfg"] = new JObject { ["width"] = 0.68, ["style"] = "straight", ["flight"] = "f" },
                }),
            };
            foreach (var (label, other) in nonMateStairs) {
                var mates = StationRampOpenings.StairLaneMates(
                    new List<ModuleFacts> { baseStairFacts, ModuleFactsReader.Read(other) }, baseStairFacts);
                Assert.AreEqual(0, mates.Count, label + " must not be reported as a stair lane mate");
            }
        }
    }
}
