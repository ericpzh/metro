using System;
using System.Collections.Generic;
using System.Linq;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>Published line facts an assembly needs (the consist its doors repeat).</summary>
    public struct TrainFacts {
        public string Stock, Power, Direction;
        public int Cars;
        public float ModelScale;
    }

    /// <summary>
    /// Runtime assemblies for families whose geometry depends on the saved
    /// dimensions. Each builder reads only the v1 document inputs recorded in
    /// `unity/plan/generated-runtime-sources.md` and emits a combined mesh plus the
    /// moving parts the view drives; a family without an assembler keeps its explicit
    /// fallback so the gap stays visible in the fallback count.
    /// </summary>
    static class RuntimeAssemblies {
        /// <summary>Promoted wrappers carry the exporter's basis correction on this child.</summary>
        public const string BasisChild = "Unity basis";

        sealed class Context {
            public ModuleFacts Module;
            public ModuleFacts[] Station;
            public Func<int,int,int,bool> Solid;
            public Mesh Cube;
            public StationMaterials Materials;
            public TrainFacts Line;
        }

        public static void PrepareImported(GameObject instance) {
            if (!instance) return;
            _ = instance.transform.Find(BasisChild);
        }

        /// <summary>
        /// Attach state-driven motion to a promoted prefab: the fare gate's fan wings
        /// and the analogue clock's two hands are named parts the exporter kept.
        /// </summary>
        public static void BindImported(GameObject instance, string key, ModuleFacts module) {
            if (!instance) return;
            var left = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "left-leaf");
            var right = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "right-leaf");
            if (left && right) {
                var motion = left.gameObject.AddComponent<ModuleMotion>();
                motion.kind = ModuleMotion.Kind.GateWings;
                motion.leaves = new[] { left, right };
                motion.leavesClosed = new[] { left.localPosition, right.localPosition };
                // `GateModel.buildGate`: the leaves span the lane between `inner` and 0.5.
                motion.leafWidth = .35f;
                motion.leafEdges = new[] { -.2f, .5f };
                motion.leafSigns = new[] { 1f, -1f };
            }
            if (module != null && module.Type == "clock") {
                var hour = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "clockHourHand");
                var minute = instance.GetComponentsInChildren<Transform>(true).FirstOrDefault(node => node.name == "clockMinuteHand");
                if (hour && minute) {
                    var motion = hour.gameObject.AddComponent<ModuleMotion>();
                    motion.kind = ModuleMotion.Kind.ClockHands;
                    motion.leaves = new[] { hour, minute };
                    motion.clockSeconds = 36540f;
                }
            }
        }

        public static bool TryBuild(string generator, ModuleFacts module, ModuleFacts[] station, Transform parent,
            Mesh cube, StationMaterials materials, Func<int,int,int,bool> solid, TrainFacts line, out GameObject assembly) {
            assembly = null;
            if (module == null || string.IsNullOrEmpty(generator)) return false;
            var context = new Context { Module = module, Station = station ?? Array.Empty<ModuleFacts>(), Solid = solid,
                Cube = cube, Materials = materials, Line = line };
            var kit = new GeometryKit(parent, cube, materials);
            try {
                switch (generator) {
                    case "track-run": TrackRun(context, kit); break;
                    case "psd-run": ScreenRun(context, kit); break;
                    case "stair-flights": StairFlights(context, kit); break;
                    case "escalator-run": EscalatorRun(context, kit); break;
                    case "walkway-run": WalkwayRun(context, kit); break;
                    case "lift-shaft": LiftShaft(context, kit); break;
                    case "hanger-rod": HangerRod(context, kit); break;
                    case "pillar-run": PillarRun(context, kit); break;
                    default:
                        UnityEngine.Object.Destroy(kit.Root.gameObject);
                        return false;
                }
            } catch (Exception error) {
                UnityEngine.Object.Destroy(kit.Root.gameObject);
                Debug.LogWarning($"Assembly {generator} for {module.Id} failed: {error.Message}");
                return false;
            }
            assembly = kit.Finish(module.Id);
            return true;
        }

        static Vector3 Centre(ModuleFacts module) =>
            new Vector3(module.X + .5f, module.Z + 1f, module.Y + .5f);

        static Quaternion Rotation(ModuleFacts module) => ModulePlacement.Rotation(module.Rotation);

        /* ------------------------------------------------------------------ track */

        static void TrackRun(Context context, GeometryKit kit) {
            var module = context.Module;
            var rotation = Rotation(module);
            // `TrackModel`: the group sits on the cell's bottom course, not the walking surface.
            var origin = new Vector3(module.X + .5f, module.Z, module.Y + .5f);
            float width = Mathf.Max(1, module.Width), depth = Mathf.Max(1, module.Depth);
            const float bedTop = -.4602f;
            kit.LocalBox(origin, rotation, new Vector3(0f, bedTop - .27f, 0f), new Vector3(width, .54f, depth), StationMaterials.Dark);
            int sleepers = Mathf.Max(2, Mathf.RoundToInt(width / .6f));
            for (int i = 0; i < sleepers; i++) {
                float x = (i + .5f) / sleepers * width - width * .5f;
                kit.LocalBox(origin, rotation, new Vector3(x, bedTop + .04f, 0f),
                    new Vector3(.23f, .08f, Mathf.Clamp(depth - .3f, 1.9f, 2.42f)), StationMaterials.Steel);
            }
            foreach (float side in new[] { -.7525f, .7525f })
                kit.LocalBox(origin, rotation, new Vector3(0f, bedTop + .16f, side), new Vector3(width, .16f, .15f), StationMaterials.Light);
            if (context.Line.Power == "third-rail") {
                float side = (module.Config.Text("dir") == "down" ? 1.05f : -1.05f);
                kit.LocalBox(origin, rotation, new Vector3(0f, bedTop + .24f, side), new Vector3(width, .1f, .12f), StationMaterials.Warm);
            }
            if (module.Config.Bool("tunnel")) {
                foreach (float side in new[] { -(depth * .5f + .2f), depth * .5f + .2f })
                    kit.LocalBox(origin, rotation, new Vector3(0f, 1.6f, side), new Vector3(width, 3.6f, .4f), StationMaterials.Dark);
                kit.LocalBox(origin, rotation, new Vector3(0f, 3.35f, 0f), new Vector3(width, .3f, depth + .8f), StationMaterials.Dark);
            }
        }

        /* --------------------------------------------------------- platform screen */

        static void ScreenRun(Context context, GeometryKit kit) {
            var module = context.Module;
            var rotation = Rotation(module);
            float width = Mathf.Max(1, module.Width);
            var origin = Centre(module);
            bool left = module.Config.Text("side") != "right";
            float wall = left ? -.34f : .34f;
            float floor = module.Z + 1f;
            // The screen repeats the owning rail's door cadence.
            var track = context.Station.FirstOrDefault(other => other.Id == module.Config.Text("from"));
            float railWidth = track?.Width ?? module.Width;
            float runStart = track != null ? track.X : module.X;
            var offsets = TrainConsist.DoorCentres(context.Line.Stock, context.Line.Cars, context.Line.ModelScale);
            var openings = new List<(float centre, float width)>();
            foreach (var offset in offsets) {
                float worldX = runStart + railWidth * .5f + offset;
                if (worldX < module.X || worldX > module.X + width) continue;
                openings.Add((worldX, TrainConsist.DoorWidthAt(context.Line.Stock, context.Line.Cars, context.Line.ModelScale, offset) * 1.5f));
            }
            openings.Sort((a, b) => a.centre.CompareTo(b.centre));
            const float glassHeight = 2.35f, headerHeight = .6f;
            // Threshold, header and the fixed panes between the openings.
            kit.LocalBox(origin, rotation, new Vector3(0f, .05f, wall), new Vector3(width, .1f, .24f), StationMaterials.Light);
            kit.LocalBox(origin, rotation, new Vector3(0f, glassHeight + headerHeight * .5f, wall),
                new Vector3(width, headerHeight, .12f), StationMaterials.Line);
            float cursor = module.X;
            foreach (var opening in openings) {
                float start = opening.centre - opening.width * .5f;
                if (start - cursor > .05f) FixedPane(context, kit, origin, rotation, cursor, start, wall, floor, glassHeight);
                // Jambs at both edges of the opening.
                foreach (float edge in new[] { start, start + opening.width })
                    kit.LocalBox(origin, rotation, new Vector3(edge - origin.x, glassHeight * .5f, wall),
                        new Vector3(.12f, glassHeight, .16f), StationMaterials.Steel);
                cursor = start + opening.width;
            }
            if (module.X + width - cursor > .05f) FixedPane(context, kit, origin, rotation, cursor, module.X + width, wall, floor, glassHeight);
            // Two retracting leaves per opening, driven by the published door fraction.
            var leaves = new List<Transform>();
            var closed = new List<Vector3>();
            float leafTravel = openings.Count > 0 ? openings[0].width * .5f : TrainConsist.DoorWidth(context.Line.Stock, context.Line.ModelScale) * .5f;
            foreach (var opening in openings) {
                float leafWidth = opening.width * .5f + .2f;
                for (int half = 0; half < 2; half++) {
                    float sign = half == 0 ? -1f : 1f;
                    var local = new Vector3(opening.centre - origin.x + sign * leafWidth * .5f, glassHeight * .5f, wall - .07f);
                    var leaf = kit.Part("screen-leaf", origin + rotation * local,
                        new Vector3(leafWidth, glassHeight, .06f), rotation, StationMaterials.Glass);
                    leaves.Add(leaf);
                    closed.Add(leaf.localPosition);
                }
            }
            if (leaves.Count > 0) {
                var motion = kit.Root.gameObject.AddComponent<ModuleMotion>();
                motion.kind = ModuleMotion.Kind.ScreenDoors;
                motion.leaves = leaves.ToArray();
                motion.leavesClosed = closed.ToArray();
                motion.leafTravel = leafTravel;
            }
        }

        static void FixedPane(Context context, GeometryKit kit, Vector3 origin, Quaternion rotation,
            float from, float to, float wall, float floor, float height) {
            float width = to - from;
            if (width <= .02f) return;
            kit.LocalBox(origin, rotation, new Vector3(from + width * .5f - origin.x, height * .5f, wall),
                new Vector3(width, height, .08f), StationMaterials.Glass);
        }

        /* ------------------------------------------------------------------ stairs */

        static void StairFlights(Context context, GeometryKit kit) {
            var module = context.Module;
            var flights = Flights(module);
            if (flights.Count == 0) flights.Add((new Vector3(module.X + .5f, module.Z + 1f, module.Y + .5f),
                new Vector3(module.X + 1.5f, module.Z + 2f, module.Y + .5f)));
            float width = (float)module.Config.Number("width", .68);
            bool straight = module.Config.Text("style").StartsWith("straight", StringComparison.Ordinal);
            // A single-lane straight stair fills its one-metre block minus both rails
            // (stairTreadWidth = 1 - 2 x STAIR_RAIL_PROUD = 0.79 m); a turning stair keeps
            // the saved run width.
            float treadWidth = straight ? 1f - .21f : Mathf.Max(.5f, width);
            var rotation = Rotation(module);
            for (int f = 0; f < flights.Count; f++) {
                var (from, to) = flights[f];
                var delta = to - from;
                var flat = new Vector3(delta.x, 0f, delta.z);
                float run = flat.magnitude;
                float rise = delta.y;
                if (run < .01f && Mathf.Abs(rise) < .01f) continue;
                int steps = Mathf.Max(2, Mathf.RoundToInt(Mathf.Abs(rise) * 6f));
                float going = run / steps, riser = rise / steps;
                var direction = run > .01f ? flat / run : Vector3.forward;
                var foot = from;
                for (int i = 0; i < steps; i++) {
                    var centre = foot + direction * (going * (i + .5f)) + Vector3.up * (riser * (i + 1) - .045f);
                    kit.Box(centre, new Vector3(treadWidth, .09f, Mathf.Max(going, .18f) + .02f), StationMaterials.Light,
                        Quaternion.LookRotation(direction));
                    kit.Box(centre + Vector3.down * .16f, new Vector3(treadWidth, .24f, .06f), StationMaterials.Steel,
                        Quaternion.LookRotation(direction));
                }
                // Handrails on both sides, three posts each.
                var side = Vector3.Cross(Vector3.up, direction).normalized;
                foreach (float edge in new[] { -.5f, .5f }) {
                    for (int post = 0; post < 3; post++) {
                        float t = (post + .5f) / 3f;
                        var basePoint = foot + direction * (run * t) + Vector3.up * (rise * t) + side * (edge * treadWidth);
                        kit.Box(basePoint + Vector3.up * .48f, new Vector3(.05f, .96f, .05f), StationMaterials.Steel,
                            Quaternion.LookRotation(direction));
                    }
                    var railStart = foot + side * (edge * treadWidth);
                    var railEnd = to + side * (edge * treadWidth);
                    var railCentre = (railStart + railEnd) * .5f + Vector3.up * .98f;
                    kit.Box(railCentre, new Vector3(.07f, .07f, Vector3.Distance(railStart, railEnd)), StationMaterials.Steel,
                        Quaternion.LookRotation(railEnd - railStart));
                }
                // Interior half landing between consecutive flights.
                if (f + 1 < flights.Count) {
                    var next = flights[f + 1].Item1;
                    var centre = (to + next) * .5f;
                    kit.Box(centre + Vector3.up * -.25f, new Vector3(Mathf.Abs(to.x - next.x) + treadWidth, .5f, Mathf.Abs(to.z - next.z) + 1f),
                        StationMaterials.Platform);
                }
            }
        }

        /// <summary>World point of an authored document anchor.</summary>
        static Vector3 World(ModuleFacts.Point point) =>
            new Vector3(point.X + .5f, point.Z + 1f, point.Y + .5f);

        static Vector3 PointJson(string json) {
            if (string.IsNullOrEmpty(json)) return new Vector3(float.NaN, float.NaN, float.NaN);
            try { return Point(JObject.Parse(json)); } catch { return new Vector3(float.NaN, float.NaN, float.NaN); }
        }

        static List<(Vector3 from, Vector3 to)> Flights(ModuleFacts module) {
            var result = new List<(Vector3, Vector3)>();
            var json = module.Config.Json("flights");
            if (!string.IsNullOrEmpty(json)) {
                try {
                    foreach (var item in JArray.Parse(json)) result.Add((Point(item["from"]), Point(item["to"])));
                } catch { /* fall through to the implied run */ }
            }
            return result;
        }

        static Vector3 Point(JToken token) =>
            new Vector3((float)token["x"] + .5f, (float)token["z"] + 1f, (float)token["y"] + .5f);

        /* --------------------------------------------------------------- escalator */

        static void EscalatorRun(Context context, GeometryKit kit) => RampBand(context, kit, true);

        static void WalkwayRun(Context context, GeometryKit kit) => RampBand(context, kit, false);

        static void RampBand(Context context, GeometryKit kit, bool escalator) {
            var module = context.Module;
            var from = module.From.HasValue ? World(module.From) : new Vector3(module.X + .5f, module.Z + 1f, module.Y + .5f);
            var to = module.To.HasValue ? World(module.To) : from + Vector3.forward * 8f;
            var delta = to - from;
            var flat = new Vector3(delta.x, 0f, delta.z);
            float horizontal = flat.magnitude;
            if (horizontal < .01f) return;
            var direction = flat / horizontal;
            float rise = delta.y;
            float incline = (float)module.Config.Number("incline", 30) * Mathf.Deg2Rad;
            float inclineRun = Mathf.Abs(rise) / Mathf.Tan(incline);
            float inset = Mathf.Max(0f, (horizontal - inclineRun) * .5f);
            float width = (float)module.Config.Number("width", 1);
            float band = .82f + (width - 1f);
            float railW = band - .16f, stepW = .68f + (width - 1f) - .16f;
            float slope = new Vector3(flat.x, rise, flat.z).magnitude;
            float flatLength = .5f + inset;
            float chain = slope + 2f * flatLength;
            int steps = Mathf.Max(4, Mathf.RoundToInt(chain / .4f));
            float pitch = chain / steps;
            float stepRise = Mathf.Max(.05f, rise == 0f ? .05f : rise / slope * pitch);
            var tilt = Quaternion.LookRotation(new Vector3(flat.x, rise, flat.z));
            // Landing decks at both ends.
            kit.Box(from + direction * (flatLength * .5f), new Vector3(stepW + .2f, .22f, flatLength), StationMaterials.Light, Quaternion.LookRotation(direction));
            kit.Box(to - direction * (flatLength * .5f), new Vector3(stepW + .2f, .22f, flatLength), StationMaterials.Light, Quaternion.LookRotation(direction));
            // Truss under the incline and the two balustrades.
            var mid = (from + to) * .5f;
            kit.Box(mid - Vector3.up * .42f, new Vector3(band, .5f, slope), StationMaterials.Dark, tilt);
            foreach (float side in new[] { -1f, 1f })
                kit.Box(mid + Vector3.up * .5f + Vector3.Cross(Vector3.up, direction) * side * (railW * .5f),
                    new Vector3(.12f, .9f, slope), StationMaterials.Glass, tilt);
            // One combined tread band; a sub-pitch shift reads as continuous travel.
            var treads = new List<CombineInstance>();
            for (int i = 0; i <= steps; i++) {
                var centre = from + direction * (flatLength + i * pitch * (horizontal / slope))
                    + Vector3.up * (i * stepRise + (rise == 0f ? .05f : 0f));
                treads.Add(new CombineInstance {
                    mesh = context.Cube,
                    transform = Matrix4x4.TRS(centre, tilt, new Vector3(stepW, .1f, Mathf.Max(.18f, pitch * (horizontal / slope)) + .01f)),
                });
            }
            var belt = new Mesh { name = "escalator band" };
            belt.CombineMeshes(treads.ToArray());
            var bandObject = new GameObject("tread-band", typeof(MeshFilter), typeof(MeshRenderer));
            bandObject.transform.SetParent(kit.Root, false);
            bandObject.GetComponent<MeshFilter>().sharedMesh = belt;
            bandObject.GetComponent<MeshRenderer>().sharedMaterial = context.Materials[StationMaterials.Steel];
            var motion = kit.Root.gameObject.AddComponent<ModuleMotion>();
            motion.kind = ModuleMotion.Kind.EscalatorSteps;
            motion.steps = new[] { bandObject.transform };
            motion.beltClosed = bandObject.transform.localPosition;
            motion.beltDirection = direction * (horizontal / slope) + Vector3.up * (rise / slope);
            motion.stepPitch = pitch;
            motion.loopMetres = chain;
            motion.speed = .5f;
            motion.direction = module.Config.Text("dir") == "down" ? -1f : 1f;
            // The assembled band is part of the assembly's lifetime.
            bandObject.AddComponent<AssemblyOwner>().Bind(new List<Mesh> { belt });
            kit.Combine(module.Id);
        }

        static Vector3 PointEnd(ModuleFacts module, Vector3 fallback) {
            var json = module.Config.Json("to");
            if (string.IsNullOrEmpty(json)) return fallback + Vector3.forward;
            try { return Point(JObject.Parse(json)); } catch { return fallback + Vector3.forward; }
        }

        /* -------------------------------------------------------------------- lift */

        static void LiftShaft(Context context, GeometryKit kit) {
            var module = context.Module;
            float size = (float)module.Config.Number("size", 2);
            var from = module.From.HasValue ? World(module.From) : new Vector3(float.NaN, float.NaN, float.NaN);
            var to = module.To.HasValue ? World(module.To) : new Vector3(float.NaN, float.NaN, float.NaN);
            if (float.IsNaN(from.y) || float.IsNaN(to.y)) {
                from = new Vector3(module.X + size * .5f, module.Z + 1f, module.Y + size * .5f);
                to = from + Vector3.up * 5f;
            }
            float height = Mathf.Abs(to.y - from.y);
            if (height < .1f) height = 5f;
            var origin = new Vector3(module.X + size * .5f, module.Z + 1f - .01f, module.Y + size * .5f);
            var rotation = Rotation(module);
            float half = size * .5f;
            foreach (float x in new[] { -.94f, .94f })
                foreach (float z in new[] { -.94f, .94f })
                    kit.LocalBox(origin, rotation, new Vector3(x * half, height * .5f, z * half), new Vector3(.1f, height, .1f), StationMaterials.Steel);
            foreach (float side in new[] { -1f, 1f }) {
                kit.LocalBox(origin, rotation, new Vector3(0f, height * .5f, side * half * .94f), new Vector3(size * .87f, height, .04f), StationMaterials.Glass);
                kit.LocalBox(origin, rotation, new Vector3(side * half * .94f, height * .5f, 0f), new Vector3(.04f, height, size * .87f), StationMaterials.Glass);
            }
            kit.LocalBox(origin, rotation, new Vector3(0f, height - .07f, 0f), new Vector3(size * .99f, .14f, size * .99f), StationMaterials.Dark);
            // Stops from cfg.rises: every stop but the top is a landing.
            var stops = new List<float> { 0f };
            var rises = Numbers(module.Config.Json("rises"));
            if (rises.Count == 0) rises.Add(height);
            float travelled = 0f;
            foreach (var rise in rises) {
                travelled += rise;
                if (travelled <= height + .01f) stops.Add(travelled);
            }
            foreach (var stop in stops) {
                foreach (float side in new[] { -1f, 1f })
                    kit.LocalBox(origin, rotation, new Vector3(side * half * .9f, stop + 1.2f, 0f), new Vector3(.1f, 2.4f, size * .8f), StationMaterials.Steel);
                kit.LocalBox(origin, rotation, new Vector3(0f, stop + 2.45f, 0f), new Vector3(size * .9f, .12f, size * .9f), StationMaterials.Light);
            }
            var cabin = kit.Node("lift-cabin", origin, rotation);
            var car = new GameObject("cabin", typeof(MeshFilter), typeof(MeshRenderer));
            car.transform.SetParent(cabin, false);
            car.transform.localPosition = new Vector3(0f, .9f, 0f);
            car.transform.localScale = new Vector3(size - .35f, 1.8f, size - .35f);
            car.GetComponent<MeshFilter>().sharedMesh = context.Cube;
            car.GetComponent<MeshRenderer>().sharedMaterial = context.Materials[StationMaterials.Light];
            var motion = kit.Root.gameObject.AddComponent<ModuleMotion>();
            motion.kind = ModuleMotion.Kind.LiftCar;
            motion.cabin = cabin;
            motion.cabinStops = stops.ToArray();
            motion.pauseSeconds = 8f;
        }

        static List<float> Numbers(string json) {
            var values = new List<float>();
            if (string.IsNullOrEmpty(json)) return values;
            try {
                foreach (var token in JArray.Parse(json)) values.Add((float)token);
            } catch { }
            return values;
        }

        /* ----------------------------------------------------------------- pillars */

        static void PillarRun(Context context, GeometryKit kit) {
            var module = context.Module;
            bool thick = module.Config.Text("variant") == "thick";
            float size = thick ? 1f : .3f;
            float height = (float)module.Config.Number("height", 5);
            var origin = Centre(module);
            var rotation = Rotation(module);
            kit.LocalBox(origin, rotation, new Vector3(0f, height * .5f, 0f), new Vector3(size, height, size), StationMaterials.Light);
            kit.LocalBox(origin, rotation, new Vector3(0f, .05f, 0f), new Vector3(size + .12f, .1f, size + .12f), StationMaterials.Dark);
            kit.LocalBox(origin, rotation, new Vector3(0f, height - .05f, 0f), new Vector3(size + .1f, .1f, size + .1f), StationMaterials.Dark);
        }

        /* ------------------------------------------------------------------ hanger */

        static void HangerRod(Context context, GeometryKit kit) {
            var module = context.Module;
            bool post = module.Config.Text("mount") == "post";
            float barTop = post ? 3f : 4f;
            float width = Mathf.Max(1, module.Width);
            var origin = new Vector3(module.X + .5f, module.Z + 1f, module.Y + .5f);
            var rotation = Rotation(module);
            float barY = module.Z + 1f + barTop;
            kit.LocalBox(origin, rotation, new Vector3(0f, barTop, 0f), new Vector3(width, .2f, .2f), StationMaterials.Steel);
            if (post) {
                kit.LocalBox(origin, rotation, new Vector3(0f, barTop * .5f, .17f), new Vector3(.18f, barTop, .18f), StationMaterials.Steel);
                kit.LocalBox(origin, rotation, new Vector3(0f, .02f, .17f), new Vector3(.36f, .05f, .36f), StationMaterials.Dark);
                return;
            }
            // `hangerRoofZ`: the lowest backing at or above the bar, else one storey up.
            float backing = float.NaN;
            for (int x = module.X; x < module.X + width; x++)
                for (int y = module.Y; y < module.Y + 1; y++)
                    for (int z = Mathf.CeilToInt(barY); z <= Mathf.CeilToInt(barY) + 4; z++)
                        if (context.Solid != null && context.Solid(x, y, z)) {
                            backing = Mathf.Min(float.IsNaN(backing) ? float.MaxValue : backing, z);
                            break;
                        }
            if (float.IsNaN(backing)) backing = barY + 1f;
            float rod = Mathf.Max(0f, backing - barY);
            kit.LocalBox(origin, rotation, new Vector3(0f, barTop + rod * .5f, 0f), new Vector3(.08f, Mathf.Max(.02f, rod), .08f), StationMaterials.Steel);
            kit.LocalBox(origin, rotation, new Vector3(0f, barTop + .02f, 0f), new Vector3(.3f, .04f, .3f), StationMaterials.Dark);
        }
    }
}
