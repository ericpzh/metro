using System;
using System.Collections.Generic;

namespace Metro.Sim {
    /// <summary>
    /// One optional passenger errand stop derived from the committed document
    /// (mirrors <c>game/src/sim/activityStops.ts</c> + <c>station.ts</c> stop registration).
    /// </summary>
    public sealed class StationActivityStopFact {
        /// <summary>Stable identifier: <c>module.Id</c> or <c>module.Id + ":seat" + slot</c> for multi-seat benches.</summary>
        public string Id = "";
        public string ModuleId = "";
        public int Node = -1;
        public string Kind = "";
        public double X;
        public double Y;
        public double Yaw;
        public StationPassengerActivity Activity = StationPassengerActivity.Shop;
        public double Duration;
        /// <summary>Walk-graph server index for serialized stops, or -1 for free-browse rooms/booths.</summary>
        public int Server = -1;
        /// <summary>False for office and toilet room shells so they are never picked as public shops.</summary>
        public bool PublicShop = true;
    }

    /// <summary>
    /// Engine-free activity stop discovery and front-only fixture access rules shared between
    /// <see cref="StationWalkGraphBuilder"/> and <see cref="StationWalkGraphWorkspace"/>.
    /// </summary>
    public static class StationActivityStops {
        public const double EdgeDecorCurtainShift = 0.15;
        public const double TvmRate = 1.5 / 60.0;

        static int NormRot(int rot) => ((rot % 4) + 4) % 4;

        public static void RotateLocal(int rot, double i, double j, out double x, out double y) {
            switch (NormRot(rot)) {
                case 1: x = -j; y = i; return;
                case 2: x = -i; y = -j; return;
                case 3: x = j; y = -i; return;
                default: x = i; y = j; return;
            }
        }

        public static void RotateLocalInt(int rot, int i, int j, out int x, out int y) {
            switch (NormRot(rot)) {
                case 1: x = -j; y = i; return;
                case 2: x = -i; y = -j; return;
                case 3: x = j; y = -i; return;
                default: x = i; y = j; return;
            }
        }

        public static int BenchSlots(string variant) {
            switch (variant) {
                case "wood-2":
                case "steel-2":
                case "seat-2":
                    return 2;
                default:
                    return 1;
            }
        }

        public static double ShelfDepth(string variant) {
            switch (variant) {
                case "cooler":
                case "cooler-dark":
                    return 0.66;
                case "clothing-rail":
                case "cafe-backbar":
                case "cafe-backbar-2":
                case "cafe-backbar-4":
                    return 0.60;
                case "clothing-table":
                case "ice-cream":
                    return 0.80;
                case "clothing-shoes":
                case "food-snacks":
                    return 0.55;
                case "food-bakery":
                case "fruit-tiered":
                    return 0.65;
                case "fruit-island":
                    return 0.90;
                case "books":
                case "bags":
                    return 0.40;
                default:
                    return 0.50;
            }
        }

        public static bool IsStopModuleType(string type) {
            switch (type) {
                case "tvm":
                case "vending":
                case "shelf":
                case "bench":
                case "cubicle":
                case "sink":
                case "retail":
                case "shop":
                case "booth":
                    return true;
                default:
                    return false;
            }
        }

        public static bool IsEdgeDecorType(string type) =>
            type == "tvm" || type == "vending" || type == "shelf";

        public static bool IsFixtureAccessType(string type) =>
            type == "bench" || type == "cubicle" || type == "sink";

        /// <summary>
        /// Computes the <c>(cellCoord, frontCoord)</c> single-entry pairs for <c>bench</c>, <c>cubicle</c>,
        /// and <c>sink</c> modules so passengers can only enter/leave through the front face.
        /// </summary>
        public static void FixtureAccessPairs(
            StationModuleFact module,
            List<(int X, int Y, int Z, int FrontX, int FrontY, int FrontZ)> output) {
            if (!IsFixtureAccessType(module.Type)) return;
            int slots = module.Type == "bench" ? BenchSlots(module.Variant) : 1;
            int frontLocalY = module.Type == "cubicle" ? -1 : 1;
            RotateLocalInt(module.Rot, 0, frontLocalY, out int fx, out int fy);
            for (int slot = 0; slot < slots; slot++) {
                RotateLocalInt(module.Rot, slot, 0, out int dx, out int dy);
                int cx = module.X + dx;
                int cy = module.Y + dy;
                output.Add((cx, cy, module.Z, cx + fx, cy + fy, module.Z));
            }
        }

        /// <summary>
        /// Mirrors <c>edgeDecorCurtainOffset</c>: when a floor-standing glass curtain stands directly
        /// behind an edge-decor module on the same storey, shift the stop pose 0.15 m toward the curtain.
        /// </summary>
        public static void EdgeDecorCurtainOffset(
            IReadOnlyList<StationModuleFact> modules,
            StationModuleFact decor,
            out double cx,
            out double cy) {
            cx = 0;
            cy = 0;
            if (modules == null || !IsEdgeDecorType(decor.Type)) return;
            RotateLocalInt(decor.Rot, 0, -1, out int wdx, out int wdy);
            int decorSpan = decor.Type == "shelf" ? Math.Max(1, decor.Width) : 1;
            for (int i = 0; i < modules.Count; i++) {
                var g = modules[i];
                if (g.Type != "glass" || !g.GlassFloorStanding || g.Z != decor.Z) continue;
                RotateLocalInt(g.Rot, 0, -1, out int gdx, out int gdy);
                if (wdx != -gdx || wdy != -gdy) continue;
                int gSpan = Math.Max(1, g.Width);
                bool overlap = false;
                for (int ds = 0; ds < decorSpan && !overlap; ds++) {
                    RotateLocalInt(decor.Rot, ds, 0, out int dcx, out int dcy);
                    int tx = decor.X + dcx, ty = decor.Y + dcy;
                    for (int gs = 0; gs < gSpan; gs++) {
                        RotateLocalInt(g.Rot, gs, 0, out int gcx, out int gcy);
                        if (g.X + gcx == tx && g.Y + gcy == ty) {
                            overlap = true;
                            break;
                        }
                    }
                }
                if (overlap) {
                    cx = wdx * EdgeDecorCurtainShift;
                    cy = wdy * EdgeDecorCurtainShift;
                    return;
                }
            }
        }

        /// <summary>
        /// Mirrors <c>activityStopPlaces(mod, modules)</c>: returns the stop pose(s) for
        /// <c>tvm</c>, <c>vending</c>, <c>shelf</c>, <c>bench</c>, <c>cubicle</c>, and <c>sink</c>.
        /// </summary>
        public static void ActivityStopPlaces(
            StationModuleFact module,
            IReadOnlyList<StationModuleFact> modules,
            List<StationActivityStopFact> output) {
            StationPassengerActivity activity;
            double duration;
            double localY;
            double facing;
            int slots = 1;
            bool usesCurtain = false;

            switch (module.Type) {
                case "tvm":
                    activity = StationPassengerActivity.Ticket;
                    duration = 24.0;
                    localY = 0.2 - 0.75; // -0.55
                    facing = Math.PI * 0.5;
                    usesCurtain = true;
                    break;
                case "vending":
                    activity = StationPassengerActivity.Vending;
                    duration = 12.0;
                    localY = 0.15 - 0.75; // -0.60
                    facing = Math.PI * 0.5;
                    usesCurtain = true;
                    break;
                case "shelf":
                    activity = StationPassengerActivity.Shop;
                    duration = 18.0;
                    localY = 0.5 - ShelfDepth(module.Variant) * 0.5 - 0.8;
                    facing = Math.PI * 0.5;
                    usesCurtain = true;
                    break;
                case "bench":
                    activity = StationPassengerActivity.Sit;
                    duration = 45.0;
                    localY = 0.075 + 0.13; // 0.205
                    facing = Math.PI * 0.5;
                    slots = BenchSlots(module.Variant);
                    break;
                case "cubicle":
                    activity = StationPassengerActivity.Toilet;
                    duration = 55.0;
                    localY = -0.03;
                    facing = -Math.PI * 0.5;
                    break;
                case "sink":
                    activity = StationPassengerActivity.Wash;
                    duration = 16.0;
                    localY = 0.38;
                    facing = -Math.PI * 0.5;
                    break;
                default:
                    return;
            }

            double cx = 0, cy = 0;
            if (usesCurtain) EdgeDecorCurtainOffset(modules, module, out cx, out cy);
            int rot = NormRot(module.Rot);
            double yaw = facing + rot * (Math.PI * 0.5);
            string baseId = module.Id ?? "";
            for (int slot = 0; slot < slots; slot++) {
                RotateLocal(rot, slot, localY, out double dx, out double dy);
                output.Add(new StationActivityStopFact {
                    Id = slot == 0 ? baseId : (baseId + ":seat" + slot),
                    ModuleId = baseId,
                    Kind = module.Type,
                    X = module.X + 0.5 + dx + cx,
                    Y = module.Y + 0.5 + dy + cy,
                    Yaw = yaw,
                    Activity = activity,
                    Duration = duration,
                    Server = -1,
                    PublicShop = true,
                });
            }
        }

        static int ResolveShopNode(StationModuleFact module, Func<int, int, int, int> nodeAt) {
            int w = Math.Max(1, module.Width);
            int h = Math.Max(1, module.Height > 0 ? module.Height : module.Depth);
            int cx = module.X + (w >> 1);
            int cy = module.Y + (h >> 1);
            int n = nodeAt(cx, module.Y, module.Z);
            if (n >= 0) return n;
            n = nodeAt(module.X, cy, module.Z);
            if (n >= 0) return n;
            n = nodeAt(cx, cy, module.Z);
            if (n >= 0) return n;
            n = nodeAt(module.X + 1, module.Y + 1, module.Z);
            if (n >= 0) return n;
            for (int y = module.Y; y < module.Y + h; y++) {
                for (int x = module.X; x < module.X + w; x++) {
                    n = nodeAt(x, y, module.Z);
                    if (n >= 0) return n;
                }
            }
            return -1;
        }

        static int ResolveBoothNode(StationModuleFact module, Func<int, int, int, int> nodeAt) {
            int w = Math.Max(1, module.Width);
            int h = Math.Max(1, module.Height > 0 ? module.Height : module.Depth);
            int cx = module.X + (w >> 1);
            int cy = module.Y + (h >> 1);
            int[] xs = { cx, module.X - 1, module.X + w, cx, module.X - 1, module.X + w, module.X - 1, module.X + w };
            int[] ys = { module.Y - 1, cy, cy, module.Y + h, module.Y - 1, module.Y - 1, module.Y + h, module.Y + h };
            for (int i = 0; i < xs.Length; i++) {
                int n = nodeAt(xs[i], ys[i], module.Z);
                if (n >= 0) return n;
            }
            return -1;
        }

        /// <summary>
        /// Populates <see cref="StationWalkGraph.Stops"/> and their <c>"stop"</c> servers in exact
        /// document order. Shared verbatim by full build and incremental workspace rebuild.
        /// </summary>
        public static void PopulateGraphStops(
            StationWalkGraph graph,
            IReadOnlyList<StationModuleFact> modules,
            Func<int, int, int, int> nodeAt,
            Func<StationServerFact, int> addServer) {
            if (graph == null || modules == null || nodeAt == null || addServer == null) return;
            var places = new List<StationActivityStopFact>(4);
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                switch (module.Type) {
                    case "tvm":
                    case "vending":
                    case "shelf":
                    case "bench":
                    case "cubicle":
                    case "sink": {
                        places.Clear();
                        ActivityStopPlaces(module, modules, places);
                        for (int p = 0; p < places.Count; p++) {
                            var place = places[p];
                            int node = nodeAt((int)Math.Floor(place.X), (int)Math.Floor(place.Y), module.Z);
                            if (node < 0) continue;
                            int srvId = addServer(new StationServerFact {
                                Kind = "stop",
                                Label = module.Type,
                                Rate = TvmRate,
                                Node = node,
                                ExitNode = -1,
                                Batch = 1,
                                StopId = place.Id,
                            });
                            place.Node = node;
                            place.Server = srvId;
                            graph.Stops.Add(place);
                        }
                        break;
                    }
                    case "retail": {
                        int node = nodeAt(module.X, module.Y, module.Z);
                        if (node < 0) break;
                        graph.Stops.Add(new StationActivityStopFact {
                            Id = module.Id ?? "",
                            ModuleId = module.Id ?? "",
                            Node = node,
                            Kind = "retail",
                            X = graph.NodeX[node],
                            Y = graph.NodeY[node],
                            Yaw = 0,
                            Activity = StationPassengerActivity.Shop,
                            Duration = 0,
                            Server = -1,
                            PublicShop = true,
                        });
                        break;
                    }
                    case "shop": {
                        int node = ResolveShopNode(module, nodeAt);
                        if (node < 0) break;
                        bool publicShop = !string.Equals(module.ShopKind, "office", StringComparison.Ordinal) &&
                                          !string.Equals(module.ShopKind, "toilet", StringComparison.Ordinal);
                        graph.Stops.Add(new StationActivityStopFact {
                            Id = module.Id ?? "",
                            ModuleId = module.Id ?? "",
                            Node = node,
                            Kind = "shop",
                            X = graph.NodeX[node],
                            Y = graph.NodeY[node],
                            Yaw = 0,
                            Activity = StationPassengerActivity.Shop,
                            Duration = 0,
                            Server = -1,
                            PublicShop = publicShop,
                        });
                        break;
                    }
                    case "booth": {
                        int node = ResolveBoothNode(module, nodeAt);
                        if (node < 0) break;
                        graph.Stops.Add(new StationActivityStopFact {
                            Id = module.Id ?? "",
                            ModuleId = module.Id ?? "",
                            Node = node,
                            Kind = "booth",
                            X = graph.NodeX[node],
                            Y = graph.NodeY[node],
                            Yaw = 0,
                            Activity = StationPassengerActivity.Shop,
                            Duration = 0,
                            Server = -1,
                            PublicShop = true,
                        });
                        break;
                    }
                }
            }
        }
    }
}
