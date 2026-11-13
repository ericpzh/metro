using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>
    /// Where one (line, track) service stands, in **document axes**: the berth point,
    /// the unit vector along the track's run, the direction sign, and the run lengths
    /// the approach/depart easing needs.
    ///
    /// Every number is derived from the committed document's own track and platform
    /// edge records (the port of `World.computeLineAnchors` /
    /// `trackTrainCentreV` / `connectedRun`), never from a hard-coded world position.
    /// </summary>
    public sealed class TrainBerth {
        public string LineId = "";
        public string TrackId = "";
        public string Stock = "";
        public int Cars;
        /// <summary>The promoted formation's authored model scale (0.98 for Zoo L6).</summary>
        public float Scale = 1f;
        /// <summary>Consist origin on the rail surface: plan x, plan y, elevation.</summary>
        public Vector3 DocumentPosition;
        /// <summary>Unit run direction in the plan, from the track's saved rotation.</summary>
        public Vector2 Facing = Vector2.right;
        /// <summary>`track.cfg.dir`: +1 up, −1 down (the source's `dirSign`).</summary>
        public int DirectionSign = 1;
        /// <summary>Half the consist length along the run, metres.</summary>
        public float HalfLength;
        /// <summary>Metres of connected rail behind the berth (toward the −facing end).</summary>
        public float ApproachRun;
        /// <summary>Metres of connected rail ahead of the berth (toward the +facing end).</summary>
        public float DepartRun;
        /// <summary>A point on the platform that faces this track, in document axes.</summary>
        public Vector3 PlatformPoint;
        /// <summary>True when the document binds a platform edge to this track.</summary>
        public bool HasPlatform;
        /// <summary>The bank that faces the platform when no edge exists (the source's `plus`).</summary>
        public int DefaultPlatformBank = 1;
        public StationModuleRecord Track;

        public string TrainId => LineId + "|" + TrackId;

        public override string ToString() =>
            TrainId + " berth=(" + DocumentPosition.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            DocumentPosition.y.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            DocumentPosition.z.ToString("0.###", CultureInfo.InvariantCulture) + ") facing=(" +
            Facing.x.ToString("0.###", CultureInfo.InvariantCulture) + "," +
            Facing.y.ToString("0.###", CultureInfo.InvariantCulture) + ") dir=" + DirectionSign +
            " half=" + HalfLength.ToString("0.###", CultureInfo.InvariantCulture) +
            " run=" + ApproachRun.ToString("0.###", CultureInfo.InvariantCulture) + "/" +
            DepartRun.ToString("0.###", CultureInfo.InvariantCulture) +
            " platform=" + (HasPlatform ? "yes" : "no");
    }

    /// <summary>One instantiated car of a consist (a `Car&lt;n&gt;-…` node of the promoted formation).</summary>
    public sealed class TrainCarView {
        public int Index;
        /// <summary>The authored part the car node names (`TrainLCabLead`, `TrainLMid`, …).</summary>
        public string Part = "";
        public GameObject Root;
        /// <summary>Car centre in document axes when the consist is at its berth.</summary>
        public Vector3 DocumentPosition;
        public StationBox Bounds;
        public bool HasBounds;
        public int LevelMin, LevelMax;
        public Transform Transform => Root != null ? Root.transform : null;
    }

    /// <summary>
    /// One drawn consist, keyed by the session's `lineId|trackId`. It owns the
    /// instantiated promoted formation, the derived berth and the door rig; the
    /// per-frame pose is a pure function of the published
    /// <see cref="StationTrainFrame"/> (phase + phase seconds), exactly like the
    /// source's `World.trainAt`, so applying the same frame twice is the identity.
    /// </summary>
    public sealed class TrainConsistView {
        readonly List<TrainCarView> cars = new List<TrainCarView>();

        public string TrainId = "";
        public string LineId = "";
        public string TrackId = "";
        public string FormationKey = "";
        public string PrefabPath = "";
        public string Stock = "";
        public float Scale = 1f;
        public TrainBerth Berth;
        public GameObject Root;
        public TrainDoorRig Rig;
        public TrainPhase Phase = TrainPhase.None;
        public double PhaseSeconds;
        /// <summary>The leaf fraction the frame commanded (before the rig's staging).</summary>
        public float DoorFraction;
        /// <summary>Signed metres along the track facing from the berth (negative on approach).</summary>
        public float OffsetMetres;
        /// <summary>Consist origin in document axes right now.</summary>
        public Vector3 DocumentPosition;
        /// <summary>The bank the document's platform faces today (+1 / −1).</summary>
        public int PlatformBank = 1;

        public IReadOnlyList<TrainCarView> CarViews => cars;
        public int Cars => cars.Count;
        public bool Visible => Root != null && Root.activeSelf;
        public bool DoorsOpen => Rig != null &&
            (PlatformBank >= 0 ? Rig.Plus : Rig.Minus) > 1e-4f;

        internal void AddCar(TrainCarView car) => cars.Add(car);

        /// <summary>
        /// Place the consist from one published frame. Nothing reads a wall clock:
        /// the offset is `trainAt(train)` on the derived berth, and the phase that has
        /// no run (berth/opening/dwell/closing/hold and a cleared `None`) stands at
        /// the mark exactly.
        /// </summary>
        public void Apply(StationTrainFrame frame) {
            Phase = frame.Phase;
            PhaseSeconds = frame.PhaseSeconds;
            DoorFraction = Mathf.Clamp01((float)frame.DoorFraction);
            OffsetMetres = TrainConsistGeometry.OffsetMetres(Phase, PhaseSeconds, Berth);
            Place();
        }

        /// <summary>Write the current offset onto the transform (document → Unity once).</summary>
        public void Place() {
            if (Root == null || Berth == null) return;
            var document = new Vector3(
                Berth.DocumentPosition.x + Berth.Facing.x * OffsetMetres,
                Berth.DocumentPosition.y + Berth.Facing.y * OffsetMetres,
                Berth.DocumentPosition.z);
            Root.transform.position = StationCoordinates.Point(document);
            DocumentPosition = document;
            for (int i = 0; i < cars.Count; i++) {
                var car = cars[i];
                if (car.Root == null) continue;
                car.DocumentPosition = StationCoordinates.WorldToDocument(car.Root.transform.position);
            }
            // The formation's local +x is its leading cab. A reversed service
            // (dirSign −1) turns the whole consist end for end, exactly as the
            // source's `buildTrain` mirrors the plan rather than the track.
            var front = Berth.Facing * Berth.DirectionSign;
            float yaw = Mathf.Atan2(front.y, front.x) * Mathf.Rad2Deg;
            Root.transform.rotation = Quaternion.Euler(0f, -yaw, 0f);
        }

        public override string ToString() =>
            TrainId + " " + FormationKey + " cars=" + Cars + " " + Phase +
            " t=" + PhaseSeconds.ToString("0.##", CultureInfo.InvariantCulture) +
            " offset=" + OffsetMetres.ToString("0.###", CultureInfo.InvariantCulture) +
            " door=" + DoorFraction.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The derivations behind <see cref="TrainBerth"/>: ports of the TypeScript
    /// rolling-stock geometry (`sim/track.ts`, `World.computeLineAnchors`,
    /// `World.connectedRun`, `World.trainAt`). Pure functions over the committed
    /// document, so a test can prove a car sits on the rail without a scene.
    /// </summary>
    public static class TrainConsistGeometry {
        /// <summary>`CABIN_FLOOR_Z` (`sim/stock.ts`): the car floor above the model origin.</summary>
        public const float CabinFloorZ = .62f;
        /// <summary>`trackTrainCentreV`'s platform clearance, metres.</summary>
        public const float PlatformGap = .1f;

        public static int NormTurn(int rotation) => ((rotation % 4) + 4) % 4;

        /// <summary>`rotateLocal`: a track-local offset (along, across) → plan offset.</summary>
        public static Vector2 RotateLocal(int rotation, float along, float across) {
            switch (NormTurn(rotation)) {
                case 1: return new Vector2(-across, along);
                case 2: return new Vector2(-along, -across);
                case 3: return new Vector2(across, -along);
                default: return new Vector2(along, across);
            }
        }

        /// <summary>`trackFacing`: the unit run direction of a track at this rotation.</summary>
        public static Vector2 Facing(int rotation) => RotateLocal(rotation, 1f, 0f);

        /// <summary>`trackSide`: the unit across direction (local +y) of a track.</summary>
        public static Vector2 Side(int rotation) => RotateLocal(rotation, 0f, 1f);

        public static int Depth(StationModuleRecord track) => Mathf.Max(1, track.Depth);

        public static bool IsTunnelOrBridge(StationModuleRecord track) =>
            track.Config.Bool("tunnel") || track.Config.Bool("bridge");

        /// <summary>
        /// `StationSessionDocument.ServiceTracks`: the platform tracks a line runs a
        /// consist on, in document order; tunnel/bridge runs are extensions unless the
        /// line owns nothing else. The ids here are exactly the ids the session
        /// publishes, so a view always has a frame to answer.
        /// </summary>
        public static List<StationModuleRecord> ServiceTracks(StationDocument document, string lineId) {
            var bound = new List<StationModuleRecord>();
            if (document == null || string.IsNullOrEmpty(lineId)) return bound;
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "track") continue;
                if (!string.Equals(module.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                bound.Add(module);
            }
            var platforms = new List<StationModuleRecord>();
            for (int i = 0; i < bound.Count; i++) if (!IsTunnelOrBridge(bound[i])) platforms.Add(bound[i]);
            return platforms.Count > 0 ? platforms : bound;
        }

        /// <summary>The platform edge that boards this track (`cfg.from`, else a direction match).</summary>
        public static StationModuleRecord PlatformEdgeFor(StationDocument document, StationModuleRecord track, string lineId, string direction) {
            if (document == null || track == null) return null;
            StationModuleRecord byDirection = null;
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "platform-edge") continue;
                if (!string.Equals(module.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                var from = module.Config.Text("from");
                if (from.Length > 0) {
                    if (string.Equals(from, track.Id, StringComparison.Ordinal)) return module;
                    continue;
                }
                if (byDirection != null) continue;
                if (string.Equals(module.Config.Text("dir"), direction, StringComparison.Ordinal)) byDirection = module;
            }
            return byDirection;
        }

        /// <summary>
        /// `trackTrainCentreV`: the vehicle centre across the bed, measured from the
        /// bed's local −y edge. A platform edge pulls the consist toward its own side.
        /// </summary>
        public static float TrainCentreV(StationModuleRecord track, float vehicleWidth, StationDocument document,
            string lineId, string lineDirection) {
            float depth = Depth(track);
            if (IsTunnelOrBridge(track)) return depth * .5f;
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = string.IsNullOrEmpty(lineDirection) ? "up" : lineDirection;
            var edge = PlatformEdgeFor(document, track, lineId, direction);
            if (edge == null) return depth * .5f;
            if (string.Equals(edge.Config.Text("side"), "left", StringComparison.Ordinal)) {
                float low = vehicleWidth * .5f;
                float high = depth - PlatformGap - vehicleWidth * .5f;
                return low <= high ? Mathf.Min(high, Mathf.Max(low, depth * .5f)) : low;
            }
            float rightLow = PlatformGap + vehicleWidth * .5f;
            float rightHigh = depth - vehicleWidth * .5f;
            return rightLow <= rightHigh ? Mathf.Min(rightHigh, Mathf.Max(rightLow, depth * .5f)) : rightHigh;
        }

        /// <summary>
        /// `World.connectedRun`: how far the consist can run past its berth before the
        /// collinear rails of the same line and storey end, in metres. The berth sits
        /// half a cell in from the track record's origin corner (`centre = w/2`).
        /// </summary>
        public static void ConnectedRun(StationDocument document, StationModuleRecord track, out float back, out float forward) {
            float centre = track.Width * .5f;
            back = centre;
            forward = track.Width - centre;
            if (document == null) return;
            int rotation = NormTurn(track.Rotation);
            var facing = Facing(rotation);
            var side = Side(rotation);
            float depth = Depth(track);
            string lineId = track.Config.Text("line");
            var spans = new List<Vector2>();
            for (int i = 0; i < document.Modules.Count; i++) {
                var module = document.Modules[i];
                if (module.Type != "track") continue;
                if (!string.Equals(module.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                if (module.Z != track.Z) continue;
                if (NormTurn(module.Rotation) != rotation) continue;
                float dx = module.X - track.X;
                float dy = module.Y - track.Y;
                float across = dx * side.x + dy * side.y;
                if (across >= depth || across + Depth(module) <= 0f) continue;
                float along = dx * facing.x + dy * facing.y;
                spans.Add(new Vector2(along, along + module.Width));
            }
            spans.Sort((a, b) => a.x.CompareTo(b.x));
            float low = 0f, high = track.Width;
            for (int i = 0; i < spans.Count; i++) {
                var span = spans[i];
                if (span.x > high || span.y < low) continue;
                low = Mathf.Min(low, span.x);
                high = Mathf.Max(high, span.y);
            }
            back = centre - low;
            forward = high - centre;
        }

        /// <summary>The source's `dirSign`: the track's own direction, else the line's.</summary>
        public static int DirectionSign(StationModuleRecord track, StationLineRecord line) {
            var direction = track.Config.Text("dir");
            if (string.Equals(direction, "down", StringComparison.OrdinalIgnoreCase)) return -1;
            if (string.Equals(direction, "up", StringComparison.OrdinalIgnoreCase)) return 1;
            // The source falls back to `line.travelSign`; the typed line keeps the
            // direction label, which is the same sign for every authored save.
            return line != null && string.Equals(line.Direction, "down", StringComparison.OrdinalIgnoreCase) ? -1 : 1;
        }

        /// <summary>Stock width in metres, before the promoted model scale (`STOCK[stock].width`).</summary>
        public static float StockWidth(string stock) =>
            TrainConsist.TryStock(stock, out var facts) ? facts.Width : 3f;

        /// <summary>
        /// The whole berth derivation for one track. Returns false with a stable
        /// reason when the record cannot be placed (a line with no track, an empty box).
        /// </summary>
        public static bool TryBerth(StationDocument document, StationLineRecord line, StationModuleRecord track,
            float scale, out TrainBerth berth, out string failure) {
            berth = null;
            failure = "";
            if (line == null) { failure = "no-line"; return false; }
            if (track == null) { failure = "no-track"; return false; }
            if (track.Width < 1) { failure = "track-width"; return false; }
            float modelScale = scale > 0f ? scale : 1f;
            int rotation = NormTurn(track.Rotation);
            var facing = Facing(rotation);
            float depth = Depth(track);
            float width = StockWidth(line.Stock) * modelScale;
            float across = TrainCentreV(track, width, document, line.Id, line.Direction);
            var offset = RotateLocal(rotation, (track.Width - 1) * .5f, across - .5f);
            var position = new Vector3(
                track.X + .5f + offset.x,
                track.Y + .5f + offset.y,
                track.Z + 1f - CabinFloorZ * modelScale);
            ConnectedRun(document, track, out float back, out float forward);
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = line.Direction;
            var edge = PlatformEdgeFor(document, track, line.Id, direction);
            berth = new TrainBerth {
                LineId = line.Id, TrackId = track.Id, Stock = line.Stock, Cars = line.Cars, Scale = modelScale,
                DocumentPosition = position, Facing = facing,
                DirectionSign = DirectionSign(track, line),
                HalfLength = TrainConsist.Length(line.Stock, line.Cars, modelScale) * .5f,
                ApproachRun = back, DepartRun = forward,
                HasPlatform = edge != null,
                PlatformPoint = edge != null
                    ? new Vector3(edge.X + .5f, edge.Y + .5f, edge.Z + .5f)
                    : new Vector3(position.x, position.y - 1.5f, position.z),
                DefaultPlatformBank = 1,
                Track = track,
            };
            return true;
        }

        /// <summary>
        /// The car centres a consist carries, in consist-root metres along the run:
        /// `c·L + L/2 − total/2` scaled by the promoted model scale (the source's
        /// `carCentre`, exactly the `Car&lt;n&gt;-…` node layout of the formation).
        /// </summary>
        public static float[] CarCentres(string stock, int cars, float scale) {
            if (cars <= 0) return Array.Empty<float>();
            float modelScale = scale > 0f ? scale : 1f;
            float length = TrainConsist.TryStock(stock, out var facts) ? facts.Length : 22f;
            length *= modelScale;
            float total = length * cars;
            var centres = new float[cars];
            for (int c = 0; c < cars; c++) centres[c] = c * length + length * .5f - total * .5f;
            return centres;
        }

        /// <summary>
        /// `approachProgress(t)`: ease-out that reaches 1 on the phase's **last drawn
        /// frame**, so the consist is at rest on the mark the tick the berth begins.
        /// </summary>
        public static float ApproachProgress(double phaseSeconds) {
            const double approach = StationSimConstants.TrainApproachSeconds;
            double steps = approach / StationSimConstants.SimSecondsPerTick;
            if (steps <= 2) return Clamp01((float)(phaseSeconds / approach));
            double p = Math.Min(1, phaseSeconds / approach);
            return Clamp01((float)((p * steps - 1) / (steps - 2)));
        }

        /// <summary>
        /// `drawnRunScale`: the depart phase's last drawn frame is `((S−1)/S)²` of the
        /// aimed distance, so the run is stretched by its reciprocal to end on the
        /// connected rail instead of a frame the sim never draws.
        /// </summary>
        public static float DrawnRunScale(double phaseSeconds) {
            double steps = phaseSeconds / StationSimConstants.SimSecondsPerTick;
            return steps > 1 ? (float)Math.Pow(steps / (steps - 1), 2) : 1f;
        }

        /// <summary>
        /// The signed metres from the berth along the track facing. Positive is the
        /// track's +facing end (departure), negative the −facing end (approach);
        /// the direction sign is folded in exactly as `World.trainAt` does.
        /// </summary>
        public static float OffsetMetres(TrainPhase phase, double phaseSeconds, TrainBerth berth) {
            if (berth == null) return 0f;
            switch (phase) {
                case TrainPhase.Approach: {
                    float q = ApproachProgress(phaseSeconds);
                    float remainder = 1f - q;
                    return -remainder * remainder * (berth.HalfLength + berth.ApproachRun) * berth.DirectionSign;
                }
                case TrainPhase.Depart: {
                    float p = Mathf.Min(1f, (float)(phaseSeconds / StationSimConstants.TrainDepartSeconds));
                    return p * p * (berth.HalfLength + berth.DepartRun) *
                        DrawnRunScale(StationSimConstants.TrainDepartSeconds) * berth.DirectionSign;
                }
                default:
                    // Berth, opening, dwell, closing, hold and a cleared phase all
                    // stand at the mark; a cleared phase is the restart contract.
                    return 0f;
            }
        }

        static float Clamp01(float value) => value < 0f ? 0f : value > 1f ? 1f : value;
    }

    /// <summary>
    /// The consists of one built station world. It instantiates the promoted
    /// formation for every (line, track) the committed document runs — so a consist
    /// exists before the first frame — registers every car with the world by
    /// `train:&lt;lineId&gt;|&lt;trackId&gt;|&lt;index&gt;`, and drives the published
    /// `StationMotionFrame` into their pose and platform-side door bank.
    ///
    /// A missing formation is named and draws nothing; a formation whose car nodes
    /// disagree with the catalogue is corrected to the source's car arithmetic and
    /// reported. No stand-in box is ever substituted.
    /// </summary>
    public sealed class TrainConsistViews {
        readonly List<TrainConsistView> consists = new List<TrainConsistView>();
        readonly Dictionary<string, TrainConsistView> byId =
            new Dictionary<string, TrainConsistView>(StringComparer.Ordinal);
        readonly ModuleMotionDispatch dispatch = new ModuleMotionDispatch();
        StationViewBuildContext context;

        public IReadOnlyList<TrainConsistView> Consists => consists;
        /// <summary>The per-world door dispatch; its probes measure the leaves' real travel.</summary>
        public ModuleMotionDispatch Dispatch => dispatch;
        /// <summary>Frames that positioned at least one consist.</summary>
        public int Applied { get; private set; }

        public bool TryGet(string trainId, out TrainConsistView view) =>
            byId.TryGetValue(trainId ?? "", out view);

        public ModuleMotionProbe Probe(string trainId) => dispatch.Probe(trainId);

        /* ---------------------------------------------------------------- build */

        public void Build(StationViewBuildContext buildContext) {
            context = buildContext ?? throw new ArgumentNullException(nameof(buildContext));
            var document = context.Document;
            if (document == null) return;
            var catalogue = context.TrainCatalogue;
            var roleRoot = context.RoleRoot(TrainConsistRenderer.RoleName);
            for (int l = 0; l < document.Lines.Count; l++) {
                var line = document.Lines[l];
                if (line == null || string.IsNullOrEmpty(line.Id)) continue;
                var formationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, catalogue);
                var tracks = TrainConsistGeometry.ServiceTracks(document, line.Id);
                if (tracks.Count == 0) {
                    context.ReportUnresolved("train-no-track", "line", line.Id,
                        "Line '" + line.Id + "' runs no saved track module, so no consist is drawn for it.");
                    continue;
                }
                for (int t = 0; t < tracks.Count; t++) {
                    try {
                        BuildConsist(document, line, tracks[t], formationKey, catalogue, roleRoot);
                    } catch (Exception error) {
                        context.ReportUnresolved("train-build-failed", "train",
                            "train:" + line.Id + "|" + tracks[t].Id,
                            error.GetType().Name + ": " + error.Message);
                    }
                }
            }
        }

        void BuildConsist(StationDocument document, StationLineRecord line, StationModuleRecord track,
            string formationKey, TrainCatalogue catalogue, Transform roleRoot) {
            var trainId = line.Id + "|" + track.Id;
            var recordId = "train:" + trainId;
            if (catalogue == null) {
                context.ReportUnresolved("no-train-catalogue", "train", recordId,
                    "No TrainCatalogue is bound to the scene, so no promoted formation can be drawn.");
                return;
            }
            if (!catalogue.TryGet(formationKey, out var entry) || entry == null || entry.prefab == null) {
                context.ReportUnresolved("no-formation", "train", recordId,
                    "No promoted formation for key '" + formationKey + "' (line " + line.Id +
                    " stock " + line.Stock + ", " + line.Cars + " cars, " + line.Power +
                    "); nothing is drawn and no box stands in for it.");
                return;
            }
            float scale = entry.bakedScale > 0f ? entry.bakedScale : 1f;
            if (!TrainConsistGeometry.TryBerth(document, line, track, scale, out var berth, out var failure)) {
                context.ReportUnresolved("train-berth", "train", recordId,
                    "The track record cannot give this consist a berth: " + failure + ".");
                return;
            }
            if (entry.cars != line.Cars) {
                context.ReportUnresolved("formation-car-count", "train", recordId,
                    "Formation '" + formationKey + "' carries " + entry.cars + " cars but the line runs " +
                    line.Cars + "; the cars on the rails follow the promoted formation.");
            }
            var instance = UnityEngine.Object.Instantiate(entry.prefab, roleRoot);
            instance.name = "consist " + trainId;
            // The promoted formation bakes the line's model scale on its own
            // `Consist` node; rescaling the wrapper would shrink it twice.
            instance.transform.localScale = Vector3.one;

            var view = new TrainConsistView {
                TrainId = trainId, LineId = line.Id, TrackId = track.Id,
                FormationKey = formationKey, PrefabPath = entry.prefabPath ?? "",
                Stock = line.Stock, Scale = scale, Berth = berth, Root = instance,
            };
            view.Place();

            var carNodes = CollectCars(instance);
            if (carNodes.Count == 0) {
                context.ReportUnresolved("no-cars", "train", recordId,
                    "The promoted formation '" + formationKey + "' carries no Car<n> node; nothing is drawn.");
                DestroyNow(instance);
                return;
            }
            // Place each car from the source's own cadence. The promoted prefab
            // already lays them out this way; writing the offsets from `TrainConsist`
            // keeps the cars on the derived rail even when a formation was re-promoted
            // with a different pivot.
            var centres = TrainConsistGeometry.CarCentres(line.Stock, carNodes.Count, scale);
            for (int i = 0; i < carNodes.Count; i++) {
                var node = carNodes[i];
                var local = instance.transform.InverseTransformPoint(node.position);
                local.x = centres[i];
                node.position = instance.transform.TransformPoint(local);
                var originalName = node.name;
                var dash = originalName.IndexOf('-');
                var part = dash >= 0 && dash + 1 < originalName.Length ? originalName.Substring(dash + 1) : originalName;
                node.name = recordId + "|" + i;
                var car = new TrainCarView { Index = i, Part = part, Root = node.gameObject };
                view.AddCar(car);
                car.DocumentPosition = StationCoordinates.WorldToDocument(node.position);
                // A car rides one storey: its wheels dip just below the platform floor,
                // so the record's level comes from the car origin, not the raw bounds.
                int level = StationCoordinates.StoreyBand(car.DocumentPosition.z, document.LevelBase);
                car.LevelMin = car.LevelMax = level;
                if (TryDocumentBounds(node, context.Root, out var bounds)) {
                    car.Bounds = bounds;
                    car.HasBounds = true;
                    context.World.RegisterModule(TrainConsistRenderer.RoleName, node.name, node.gameObject, "car",
                        bounds, level, level);
                } else {
                    context.World.RegisterModule(TrainConsistRenderer.RoleName, node.name, node.gameObject, "car",
                        null, level, level);
                }
            }

            // The rig measures the promoted leaves against the stock's own door
            // width; the bank that faces the platform is read off the placed object,
            // so a reversed service opens its mirrored bank and the far side stays shut.
            var rig = new TrainDoorRig(instance, TrainDoorRig.ForLine(line.Stock, line.Cars, scale));
            view.Rig = rig;
            view.PlatformBank = berth.HasPlatform
                ? TrainDoorRig.BankFacing(instance.transform, StationCoordinates.Point(berth.PlatformPoint))
                : berth.DefaultPlatformBank;
            rig.SetPlatformBank(view.PlatformBank);
            rig.SetBank(view.PlatformBank, 0f);
            rig.SetBank(-view.PlatformBank, 0f);
            if (rig.Leaves == 0) {
                context.ReportUnresolved("train-rig-no-leaves", "train", recordId,
                    "The promoted formation carries no DoorNN leaf the rig can bind; its body is still drawn.");
            } else if (!dispatch.BindTrain(trainId, rig, view.PlatformBank)) {
                context.ReportUnresolved("train-rig-unbound", "train", recordId,
                    "The consist's door rig could not be bound for frame.Trains.");
            }
            consists.Add(view);
            byId[trainId] = view;
        }

        /* ----------------------------------------------------------- per frame */

        /// <summary>
        /// One published station frame: every consist the frame names moves to its
        /// phase pose and the dispatch drives only its platform-side bank. A frame
        /// that names no consist (a released session) leaves the last pose alone.
        /// </summary>
        public bool Apply(StationMotionFrame frame) {
            int positioned = 0;
            var trains = frame.Trains;
            if (trains != null) {
                for (int i = 0; i < trains.Length; i++) {
                    var train = trains[i];
                    if (string.IsNullOrEmpty(train.Id)) continue;
                    if (!byId.TryGetValue(train.Id, out var view) || view.Root == null) continue;
                    view.Apply(train);
                    positioned++;
                }
            }
            if (positioned > 0) {
                dispatch.Apply(frame);
                // A track with no platform edge has no bank the source would open
                // (`doorSides` is 0); hold it shut rather than open a tunnel wall.
                for (int i = 0; i < consists.Count; i++) {
                    var view = consists[i];
                    if (view.Berth != null && !view.Berth.HasPlatform) view.Rig?.SetBank(view.PlatformBank, 0f);
                }
                Applied++;
            }
            return positioned > 0;
        }

        /* -------------------------------------------------------------- teardown */

        public void Dispose() {
            for (int i = 0; i < consists.Count; i++) {
                var root = consists[i].Root;
                if (root != null) DestroyNow(root);
            }
            consists.Clear();
            byId.Clear();
            dispatch.Clear();
        }

        /* -------------------------------------------------------------- helpers */

        /// <summary>Every `Car&lt;n&gt;-…` node of the promoted formation, in car order.</summary>
        public static List<Transform> CollectCars(GameObject consist) {
            var found = new List<KeyValuePair<int, Transform>>();
            if (consist == null) return new List<Transform>();
            foreach (var node in consist.GetComponentsInChildren<Transform>(true)) {
                int index = CarIndex(node.name);
                if (index < 0) continue;
                found.Add(new KeyValuePair<int, Transform>(index, node));
            }
            found.Sort((a, b) => a.Key.CompareTo(b.Key));
            var cars = new List<Transform>(found.Count);
            for (int i = 0; i < found.Count; i++) cars.Add(found[i].Value);
            return cars;
        }

        /// <summary>The `<n>` of `Car&lt;n&gt;-Part`; −1 for any other node.</summary>
        public static int CarIndex(string name) {
            if (string.IsNullOrEmpty(name) || !name.StartsWith("Car", StringComparison.Ordinal)) return -1;
            int dash = name.IndexOf('-', 3);
            if (dash <= 3) return -1;
            return int.TryParse(name.Substring(3, dash - 3), NumberStyles.Integer, CultureInfo.InvariantCulture, out var index) &&
                index >= 0 ? index : -1;
        }

        /// <summary>The car's document-axis box, measured while the staged world may be inactive.</summary>
        static bool TryDocumentBounds(Transform node, Transform root, out StationBox bounds) {
            bounds = default;
            // Mesh bounds rather than Renderer.bounds: the staged root is inactive
            // until commit (OpeningModuleViews makes the same choice).
            if (!OpeningModuleViews.MeshBoundsIn(node, root, out var local)) return false;
            var min = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            var max = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? local.min.x : local.max.x,
                    (corner & 2) == 0 ? local.min.y : local.max.y,
                    (corner & 4) == 0 ? local.min.z : local.max.z);
                var document = StationCoordinates.WorldToDocument(root.TransformPoint(point));
                min = Vector3.Min(min, document);
                max = Vector3.Max(max, document);
            }
            bounds = new StationBox(min.x, min.y, min.z, max.x, max.y, max.z);
            return !bounds.IsEmpty;
        }

        static void DestroyNow(UnityEngine.Object value) {
            if (!value) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }

    /// <summary>
    /// The generic player's rolling-stock renderer, role <c>trains</c>. Every build
    /// stages a complete consist set for the committed document's (line, track)
    /// services; the per-frame half lives in <see cref="TrainConsistFrameSink"/>.
    ///
    /// The host reuses renderer instances across staged worlds (the old world's
    /// `Release()` runs after the new world's `Build()`), so state is keyed by
    /// <see cref="StationWorldView"/> and a release drops only worlds already
    /// disposed — the same contract as `VerticalModuleRenderer`.
    /// </summary>
    public sealed class TrainConsistRenderer : IStationViewRenderer {
        public const string RoleName = "trains";

        sealed class WorldState {
            public StationWorldView World;
            public StationViewBuildContext Context;
            public TrainConsistViews Views;
            public int Serial;
        }

        readonly List<WorldState> worlds = new List<WorldState>();
        int serial;

        public string Role => RoleName;
        /// <summary>The renderer of the active built world; the frame sink and the report use it.</summary>
        public static TrainConsistRenderer Current { get; private set; }
        /// <summary>The last failure, kept off the Console so a console-clean gate is not broken.</summary>
        public string LastError { get; internal set; } = "";

        public IReadOnlyList<TrainConsistView> Consists {
            get {
                var state = ActiveState();
                return state != null ? (IReadOnlyList<TrainConsistView>)state.Views.Consists : Array.Empty<TrainConsistView>();
            }
        }

        public bool TryGetConsist(string trainId, out TrainConsistView view) {
            var state = ActiveState();
            view = null;
            return state != null && state.Views.TryGet(trainId ?? "", out view);
        }

        public ModuleMotionProbe Probe(string trainId) {
            var state = ActiveState();
            return state != null ? state.Views.Probe(trainId) : default;
        }

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            DropDisposedWorlds();
            var state = new WorldState {
                World = context.World, Context = context, Views = new TrainConsistViews(), Serial = ++serial,
            };
            worlds.Add(state);
            Current = this;
            try {
                state.Views.Build(context);
            } catch (Exception error) {
                // A rendering family must never refuse the whole station install for
                // one malformed formation: name it and leave the rest standing.
                LastError = error.GetType().Name + ": " + error.Message;
                context.ReportUnresolved("train-build-failed", "renderer", RoleName, LastError);
            }
        }

        /// <summary>One published session frame; false when the active world has no consults.</summary>
        public bool Apply(StationMotionFrame frame) {
            var state = ActiveState();
            if (state == null) return false;
            try {
                return state.Views.Apply(frame);
            } catch (Exception error) {
                LastError = error.GetType().Name + ": " + error.Message;
                return false;
            }
        }

        public void Release() => DropDisposedWorlds();

        /// <summary>Drop one world explicitly (tests and a station switch that bypasses Dispose).</summary>
        public void ReleaseWorld(StationWorldView world) {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                if (!ReferenceEquals(worlds[i].World, world)) continue;
                worlds[i].Views.Dispose();
                worlds.RemoveAt(i);
            }
            if (worlds.Count == 0 && ReferenceEquals(Current, this)) Current = null;
        }

        void DropDisposedWorlds() {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                var state = worlds[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                state.Views.Dispose();
                worlds.RemoveAt(i);
            }
            if (worlds.Count == 0 && ReferenceEquals(Current, this)) Current = null;
        }

        WorldState ActiveState() {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                var state = worlds[i];
                if (state.World != null && !state.World.IsDisposed) return state;
            }
            return null;
        }
    }

    /// <summary>
    /// Per-frame half of the rolling stock: the host ticks frame sinks with the
    /// committed station, so the sink reads the live session's own
    /// <see cref="StationMotionFrame"/> through the same seam
    /// `ModuleMotionFrameSink` uses (no host or scene edit). It re-applies only when
    /// the session tick, clock or play state changed, so a paused station keeps the
    /// pose the last frame wrote and an identical frame cannot drift it.
    /// </summary>
    sealed class TrainConsistFrameSink : IStationFrameSink {
        long lastTick = long.MinValue;
        double lastSimTime = double.NaN;
        bool lastPlaying;

        public void Tick(StationDocument document, StationIndex index, double simTimeSeconds) {
            var renderer = TrainConsistRenderer.Current;
            if (renderer == null || document == null) return;
            try {
                var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
                if (host == null) return;
                var session = (host.Simulation as StationSimulationHost)?.Session;
                if (session == null) return;
                if (session.Tick == lastTick &&
                    Math.Abs(simTimeSeconds - lastSimTime) < 1e-9 &&
                    session.Playing == lastPlaying) return;
                lastTick = session.Tick;
                lastSimTime = simTimeSeconds;
                lastPlaying = session.Playing;
                renderer.Apply(session.Snapshot());
            } catch (Exception error) {
                renderer.LastError = error.GetType().Name + ": " + error.Message;
            }
        }
    }

    /// <summary>Process-wide registration of the rolling-stock renderer and its frame sink.</summary>
    public static class TrainConsistFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => RegisterNow();

        /// <summary>Idempotent registration seam for an explicit host or a PlayMode test.</summary>
        public static void RegisterNow() {
            StationRenderers.Add(new TrainConsistRenderer());
            StationFrameSinks.Add(new TrainConsistFrameSink());
        }
    }
}
