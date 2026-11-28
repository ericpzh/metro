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
        /// <summary>The consist's orientation as it approaches and berths.</summary>
        public int DirectionSign = 1;
        public bool Terminal;
        /// <summary>Half the consist length along the run, metres.</summary>
        public float HalfLength;
        /// <summary>Metres of connected rail behind the berth (toward the −facing end).</summary>
        public float ApproachRun;
        /// <summary>Metres of connected rail ahead of the berth (toward the +facing end).</summary>
        public float DepartRun;
        /// <summary>A point on the platform that faces this track, in document axes.</summary>
        public Vector3 PlatformPoint;
        /// <summary>Document-space points of all platform edges bound to this track (zero, one, or both sides).</summary>
        public readonly List<Vector3> PlatformPoints = new List<Vector3>();
        /// <summary>True when the document binds a platform edge to this track.</summary>
        public bool HasPlatform;
        /// <summary>Track-local platform sides owned by this berth: bit 0 = left (+y), bit 1 = right (−y).</summary>
        public int TrackDoorSides;
        /// <summary>Consist door bank bitmask (bit 0 = +1, bit 1 = −1, 0..3).</summary>
        public int DoorBankMask;
        /// <summary>The bank that faces the platform when no edge exists (the source's `plus`).</summary>
        public int DefaultPlatformBank = 1;
        public StationModuleRecord Track;
        /// <summary>The shared rail datum for this berth (rail surface, cabin floor, platform top).</summary>
        public float RailSurfaceZ;
        public float CabinFloorDocumentZ;
        public float PlatformTopZ;
        /// <summary>The local ±1 edge the conductor rail sits on (0 for overhead).</summary>
        public int ThirdRailSide;

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
        StationVisibilityTarget cachedTarget;
        public StationVisibilityTarget Target => ResolveTarget();
        internal StationWorldView World;
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
        /// <summary>Bitmask of consist banks facing platforms (bit 0 = +1, bit 1 = −1, 0..3).</summary>
        public int DoorBankMask = 1;
        /// <summary>The standalone `Gangway&lt;n&gt;` roots the promoted formation carries.</summary>
        public readonly List<Transform> Gangways = new List<Transform>();
        /// <summary>The saved track's own storey band (the consist's visibility membership).</summary>
        public int LevelMin, LevelMax;
        public int[] LevelBands = Array.Empty<int>();
        /// <summary>The one world record this consist is registered under (`train:line|track`).</summary>
        public string VisibilityRecordId = "";
        /// <summary>Live line livery & city cab-mark renderer slots captured after compaction.</summary>
        public TrainLiveryBinding LiveryBinding;
        /// <summary>The saved track's document band, used for section classification.</summary>
        public StationBox ConsistBounds;
        public bool HasConsistBounds;

        /// <summary>The service run this consist last showed; a new run never blends from the old.</summary>
        public int ServiceSequence;
        /// <summary>The last two tick targets, so a rendered frame can sample between them.</summary>
        bool hasSample;
        TrainPhase samplePhase;
        double samplePhaseSeconds;
        float sampleOffset;
        float previousSampleOffset;
        float lastVisibilityOffset = float.NaN;

        public IReadOnlyList<TrainCarView> CarViews => cars;
        public int Cars => cars.Count;
        public bool Visible => Root != null && Root.activeSelf;
        public bool DoorsOpen => Rig != null &&
            (((DoorBankMask & 1) != 0 && Rig.Plus > 1e-4f) ||
             ((DoorBankMask & 2) != 0 && Rig.Minus > 1e-4f));

        internal void AddCar(TrainCarView car) => cars.Add(car);

        /// <summary>Forget the interpolation pair after a seek/restart/switch.</summary>
        public void ForgetSample() => hasSample = false;

        StationVisibilityTarget ResolveTarget() =>
            cachedTarget != null ? cachedTarget : (cachedTarget = Root != null ? Root.GetComponent<StationVisibilityTarget>() : null);

        /// <summary>
        /// Park the consist between services. The interpolation pair is dropped (the next
        /// dispatch starts from its own approach pose, never from the last departure), both
        /// door banks are shut, and the root — not a renderer flag — is the eligibility gate,
        /// so the level/section pass in `StationVisibilityTarget.Apply` cannot show it again.
        /// </summary>
        public void Retire() {
            ForgetSample();
            if (Rig != null) {
                Rig.SetBank(1, 0f);
                Rig.SetBank(-1, 0f);
            }
            DoorFraction = 0f;
            Phase = TrainPhase.None;
            PhaseSeconds = 0;
            ServiceSequence = 0;
            // Back on its mark: a parked consist has no pose of its own, and a restart that
            // publishes `None` leaves the previous departure offset in no place at all.
            OffsetMetres = 0f;
            lastVisibilityOffset = float.NaN;
            Place();
            if (Root != null && Root.activeSelf) Root.SetActive(false);
            var target = ResolveTarget();
            if (target != null && !target.parked) {
                target.parked = true;
                World?.Visibility?.ApplyTarget(target);
            }
        }

        /// <summary>
        /// Make the consist drawable. Called only after the frame's first pose and the door
        /// banks have been written, so a consist never flashes at the berth or with open
        /// doors from its previous service.
        /// </summary>
        public void Mount() {
            if (Root != null && !Root.activeSelf) Root.SetActive(true);
            var target = ResolveTarget();
            if (target == null) return;
            bool unparked = target.parked;
            target.parked = false;
            var visibility = World?.Visibility;
            bool sectionMoved = visibility != null && visibility.SectionClipping &&
                (float.IsNaN(lastVisibilityOffset) || Mathf.Abs(OffsetMetres - lastVisibilityOffset) > 1e-4f);
            if (unparked || sectionMoved) {
                lastVisibilityOffset = OffsetMetres;
                visibility?.ApplyTarget(target);
            }
        }

        /// <summary>
        /// Place the consist from one published frame. Nothing reads a wall clock:
        /// the offset is `trainAt(train)` on the derived berth, and the phase that has
        /// no run (berth/opening/dwell/closing/hold and a cleared `None`) stands at
        /// the mark exactly.
        /// </summary>
        public void Apply(StationTrainFrame frame) => Apply(frame, 1f);

        /// <summary>
        /// Place the consist for a rendered frame that falls inside the tick interval:
        /// the target offset is refreshed only when the frame's phase/phase-seconds
        /// change (a tick), and the pose samples from the previous target to the current
        /// one by <paramref name="alpha"/>. That is what makes an approach or a departure
        /// continuous instead of one jump per simulated second (RCA 14 §5.2).
        ///
        /// It snaps rather than blends when the previous target is not a compatible
        /// adjacent position on the phase curve: a phase change or a backwards phase
        /// clock (a seek). The sink also calls <see cref="ForgetSample"/> for a session
        /// switch or a restart, so nothing blends across a station that no longer exists.
        /// </summary>
        public void Apply(StationTrainFrame frame, float alpha) {
            Phase = frame.Phase;
            PhaseSeconds = frame.PhaseSeconds;
            ServiceSequence = frame.ServiceSequence;
            DoorFraction = Mathf.Clamp01((float)frame.DoorFraction);
            float target = TrainConsistGeometry.OffsetMetres(Phase, PhaseSeconds, Berth);
            if (!hasSample) {
                previousSampleOffset = sampleOffset = target;
                hasSample = true;
            } else if (frame.Phase != samplePhase || frame.PhaseSeconds < samplePhaseSeconds) {
                // Not an adjacent position on the same curve: a phase change (the
                // approach ends at the mark, a departure starts there, so the snap is
                // visually continuous) or a phase clock that went backwards (a seek).
                previousSampleOffset = sampleOffset = target;
            } else if (frame.PhaseSeconds != samplePhaseSeconds) {
                previousSampleOffset = sampleOffset;
                sampleOffset = target;
            }
            samplePhase = frame.Phase;
            samplePhaseSeconds = frame.PhaseSeconds;
            if (alpha >= 1f) OffsetMetres = sampleOffset;
            else if (alpha <= 0f) OffsetMetres = previousSampleOffset;
            else OffsetMetres = Mathf.Lerp(previousSampleOffset, sampleOffset, alpha);
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
        public const float CabinFloorZ = StationRailGeometry.CabinFloorZ;
        /// <summary>`trackTrainCentreV`'s platform clearance, metres.</summary>
        public const float PlatformGap = StationRailGeometry.PlatformGap;

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

        /// <summary>Indexed overload of <see cref="ServiceTracks(StationDocument, string)"/> scanning only track modules.</summary>
        public static List<StationModuleRecord> ServiceTracks(StationIndex index, string lineId) {
            var bound = new List<StationModuleRecord>();
            if (index == null || string.IsNullOrEmpty(lineId)) return bound;
            var tracks = index.ModulesOfType("track");
            for (int i = 0; i < tracks.Count; i++) {
                var module = tracks[i];
                if (module == null) continue;
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

        /// <summary>Indexed overload of <see cref="PlatformEdgeFor(StationDocument, StationModuleRecord, string, string)"/> scanning only platform-edge modules.</summary>
        public static StationModuleRecord PlatformEdgeFor(StationIndex index, StationModuleRecord track, string lineId, string direction) {
            if (index == null || track == null) return null;
            StationModuleRecord byDirection = null;
            var edges = index.ModulesOfType("platform-edge");
            for (int i = 0; i < edges.Count; i++) {
                var module = edges[i];
                if (module == null) continue;
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

        static void SelectBerthPlatformEdges(StationIndex index, StationModuleRecord track,
            string lineId, string direction, List<StationModuleRecord> output) {
            if (output == null) return;
            output.Clear();
            if (index == null || track == null || IsTunnelOrBridge(track)) return;
            var edges = index.ModulesOfType("platform-edge");
            List<StationModuleRecord> legacy = null;
            for (int i = 0; i < edges.Count; i++) {
                var module = edges[i];
                if (module == null) continue;
                if (!string.Equals(module.Config.Text("line"), lineId, StringComparison.Ordinal)) continue;
                var from = module.Config.Text("from");
                if (from.Length > 0) {
                    if (string.Equals(from, track.Id, StringComparison.Ordinal)) output.Add(module);
                    continue;
                }
                if (output.Count == 0 && string.Equals(module.Config.Text("dir"), direction, StringComparison.Ordinal)) {
                    if (legacy == null) legacy = new List<StationModuleRecord>(2);
                    legacy.Add(module);
                }
            }
            if (output.Count == 0 && legacy != null) {
                for (int i = 0; i < legacy.Count; i++) output.Add(legacy[i]);
            }
        }

        static float TrainCentreAcross(StationModuleRecord track, float vehicleWidth, StationIndex index,
            string lineId, string lineDirection) {
            if (track == null) return 0f;
            float depth = Depth(track);
            if (IsTunnelOrBridge(track)) return depth * .5f;
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = string.IsNullOrEmpty(lineDirection) ? "up" : lineDirection;
            var selected = new List<StationModuleRecord>(2);
            SelectBerthPlatformEdges(index, track, lineId, direction, selected);
            if (selected.Count == 0) return depth * .5f;
            bool hasLeft = false, hasRight = false;
            for (int i = 0; i < selected.Count; i++) {
                if (string.Equals(selected[i].Config.Text("side"), "left", StringComparison.Ordinal)) hasLeft = true;
                else hasRight = true;
            }
            if (hasLeft && hasRight) return depth * .5f;
            if (hasLeft) {
                float low = vehicleWidth * .5f;
                float high = depth - PlatformGap - vehicleWidth * .5f;
                return low <= high ? Mathf.Min(high, Mathf.Max(low, depth * .5f)) : low;
            }
            float rightLow = PlatformGap + vehicleWidth * .5f;
            float rightHigh = depth - vehicleWidth * .5f;
            return rightLow <= rightHigh ? Mathf.Min(rightHigh, Mathf.Max(rightLow, depth * .5f)) : rightHigh;
        }

        /// <summary>
        /// `trackTrainCentreV`: the vehicle centre across the bed, measured from the
        /// bed's local −y edge. A platform edge pulls the consist toward its own side;
        /// platforms on both sides (Spanish solution) keep it centred.
        /// </summary>
        public static float TrainCentreV(StationModuleRecord track, float vehicleWidth, StationDocument document,
            string lineId, string lineDirection) =>
            StationRailGeometry.TrainCentreAcross(track, vehicleWidth, document, lineId, lineDirection);

        /// <summary>
        /// `World.connectedRun`: how far the consist can run past its berth before the
        /// collinear rails of the same line and storey end, in metres. The berth sits
        /// half a cell in from the track record's origin corner (`centre = w/2`).
        /// </summary>
        public static void ConnectedRun(StationDocument document, StationModuleRecord track, out float back, out float forward) {
            ConnectedRunCore(document?.Modules, track, out back, out forward);
        }

        /// <summary>Indexed overload of <see cref="ConnectedRun(StationDocument, StationModuleRecord, out float, out float)"/> scanning only track modules.</summary>
        public static void ConnectedRun(StationIndex index, StationModuleRecord track, out float back, out float forward) {
            ConnectedRunCore(index?.ModulesOfType("track"), track, out back, out forward);
        }

        static void ConnectedRunCore(IReadOnlyList<StationModuleRecord> candidates, StationModuleRecord track, out float back, out float forward) {
            float centre = track.Width * .5f;
            back = centre;
            forward = track.Width - centre;
            if (candidates == null) return;
            int rotation = NormTurn(track.Rotation);
            var facing = Facing(rotation);
            var side = Side(rotation);
            float depth = Depth(track);
            string lineId = track.Config.Text("line");
            var spans = new List<Vector2>();
            for (int i = 0; i < candidates.Count; i++) {
                var module = candidates[i];
                if (module == null || module.Type != "track") continue;
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
                if (span.x > high || span.y < 0f) continue;
                high = Mathf.Max(high, span.y);
            }
            for (int i = spans.Count - 1; i >= 0; i--) {
                var span = spans[i];
                if (span.y < low || span.x > track.Width) continue;
                low = Mathf.Min(low, span.x);
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
            float scale, out TrainBerth berth, out string failure) =>
            TryBerth(document, null, line, track, scale, out berth, out failure);

        /// <summary>
        /// Indexed overload of <see cref="TryBerth(StationDocument, StationLineRecord, StationModuleRecord, float, out TrainBerth, out string)"/>
        /// scanning only track and platform-edge modules when <paramref name="index"/> is supplied.
        /// </summary>
        public static bool TryBerth(StationDocument document, StationIndex index, StationLineRecord line, StationModuleRecord track,
            float scale, out TrainBerth berth, out string failure) {
            berth = null;
            failure = "";
            if (line == null) { failure = "no-line"; return false; }
            if (track == null) { failure = "no-track"; return false; }
            if (track.Width < 1) { failure = "track-width"; return false; }
            float modelScale = scale > 0f ? scale : 1f;
            int rotation = NormTurn(track.Rotation);
            var facing = Facing(rotation);
            float width = StationRailGeometry.StockWidth(line.Stock) * modelScale;
            float across = index != null
                ? TrainCentreAcross(track, width, index, line.Id, line.Direction)
                : StationRailGeometry.TrainCentreAcross(track, width, document, line.Id, line.Direction);
            var offset = RotateLocal(rotation, (track.Width - 1) * .5f, across - .5f);
            var position = new Vector3(
                track.X + .5f + offset.x,
                track.Y + .5f + offset.y,
                StationRailGeometry.TrainOriginFor(track, modelScale));
            float back, forward;
            if (index != null) ConnectedRun(index, track, out back, out forward);
            else ConnectedRun(document, track, out back, out forward);
            var direction = track.Config.Text("dir");
            if (direction.Length == 0) direction = line.Direction;
            var selectedEdges = new List<StationModuleRecord>(2);
            if (index != null) SelectBerthPlatformEdges(index, track, line.Id, direction, selectedEdges);
            else StationRailGeometry.SelectBerthPlatformEdges(document, track, line.Id, direction, selectedEdges);
            var edge = selectedEdges.Count > 0 ? selectedEdges[0] : null;
            bool terminal = direction == StationTrainPose.TerminalDirection;
            int dirSign = terminal ? StationTrainPose.TerminalApproachSign(track.Width, back, forward) : DirectionSign(track, line);
            float approachRun = terminal && dirSign < 0 ? forward : back;
            List<ModuleFacts> edgeFacts;
            if (index != null) {
                var edges = index.ModulesOfType("platform-edge");
                edgeFacts = new List<ModuleFacts>(edges.Count);
                for (int i = 0; i < edges.Count; i++) {
                    if (edges[i]?.Facts != null) edgeFacts.Add(edges[i].Facts);
                }
            } else {
                edgeFacts = new List<ModuleFacts>(document != null ? document.Modules.Count : 0);
                if (document != null) {
                    for (int i = 0; i < document.Modules.Count; i++) edgeFacts.Add(document.Modules[i].Facts);
                }
            }
            int trackSides = 0;
            var platformPoints = new List<Vector3>(selectedEdges.Count);
            for (int i = 0; i < selectedEdges.Count; i++) {
                var m = selectedEdges[i];
                bool isLeft = string.Equals(m.Config.Text("side"), "left", StringComparison.Ordinal);
                int bit = isLeft ? 1 : 2;
                if ((trackSides & bit) == 0) {
                    trackSides |= bit;
                    platformPoints.Add(new Vector3(m.X + .5f, m.Y + .5f, m.Z + .5f));
                }
            }
            berth = new TrainBerth {
                LineId = line.Id, TrackId = track.Id, Stock = line.Stock, Cars = line.Cars, Scale = modelScale,
                DocumentPosition = position, Facing = facing,
                DirectionSign = dirSign,
                Terminal = terminal,
                HalfLength = TrainConsist.Length(line.Stock, line.Cars, modelScale) * .5f,
                ApproachRun = approachRun, DepartRun = terminal ? approachRun : forward,
                HasPlatform = edge != null,
                TrackDoorSides = trackSides,
                DoorBankMask = StationTrainPose.ConsistDoorBankMask(trackSides, dirSign),
                PlatformPoint = edge != null
                    ? new Vector3(edge.X + .5f, edge.Y + .5f, edge.Z + .5f)
                    : new Vector3(position.x, position.y - 1.5f, position.z),
                DefaultPlatformBank = 1,
                Track = track,
                RailSurfaceZ = StationRailGeometry.RailSurfaceZ(track, modelScale),
                CabinFloorDocumentZ = StationRailGeometry.CabinFloorFor(track, modelScale),
                PlatformTopZ = track.Z + StationRailGeometry.PlatformTopAboveModule,
                ThirdRailSide = StationRailGeometry.ThirdRailSide(track.Facts, edgeFacts,
                    StationRailGeometry.LineDirectionOf(document, track.Facts)),
            };
            berth.PlatformPoints.AddRange(platformPoints);
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
                        DrawnRunScale(StationSimConstants.TrainDepartSeconds) * (berth.Terminal ? -berth.DirectionSign : berth.DirectionSign);
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
    /// One presented door event: what a bank actually applied, with the doorway and the
    /// leaf pose it wrote. Recorded only while <see cref="TrainConsistViews.LogDoorEvents"/>
    /// is on (a verifier or a test), never per frame in the player.
    /// </summary>
    public struct TrainDoorEvent {
        /// <summary>The stable `lineId|trackId` the consist is keyed by.</summary>
        public string TrainId;
        /// <summary>The consist run the frame belonged to (a new dispatch takes the next).</summary>
        public int ServiceSequence;
        public TrainPhase Phase;
        public double PhaseSeconds;
        /// <summary>`opening` (left shut), `open` (reached 1), `closed` (reached 0).</summary>
        public string Kind;
        /// <summary>`+1` or `-1`: the leaf bank, not the platform side.</summary>
        public int Bank;
        /// <summary>The fraction the frame commanded for the consist.</summary>
        public float Commanded;
        /// <summary>The fraction this bank actually holds.</summary>
        public float Applied;
        /// <summary>The doorway the observed leaf belongs to (−1 when unpaired).</summary>
        public int Doorway;
        /// <summary>The observed leaf's local x / z in the consist root — the written pose.</summary>
        public float LeafX, LeafZ;

        public override string ToString() =>
            TrainId + "#" + ServiceSequence + " " + Phase + " t=" +
            PhaseSeconds.ToString("0.##", CultureInfo.InvariantCulture) + " " + Kind +
            " bank=" + Bank + " cmd=" + Commanded.ToString("0.###", CultureInfo.InvariantCulture) +
            " applied=" + Applied.ToString("0.###", CultureInfo.InvariantCulture) +
            " door=" + Doorway + " leafX=" + LeafX.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The consists of one built station world. It instantiates the promoted
    /// formation for every (line, track) the committed document runs — so a consist
    /// exists before the first frame — and registers **one visibility record per
    /// track** (`train:&lt;lineId&gt;|&lt;trackId&gt;`) on the consist root, so the cars,
    /// gangways, roofs, pantographs and fittings are shown and hidden together by the
    /// saved track's own storey band. Per-car identity, bounds and document position
    /// stay on <see cref="TrainCarView"/>; they are metadata, not visibility targets.
    ///
    /// A missing formation is named and draws nothing; a formation whose car nodes
    /// disagree with the catalogue is reported. No stand-in box is ever substituted.
    /// </summary>
    public sealed class TrainConsistViews {
        readonly List<TrainConsistView> consists = new List<TrainConsistView>();
        readonly Dictionary<string, TrainConsistView> byId =
            new Dictionary<string, TrainConsistView>(StringComparer.Ordinal);
        readonly Dictionary<string, float> lastBankFraction = new Dictionary<string, float>(StringComparer.Ordinal);
        readonly List<TrainDoorEvent> doorEvents = new List<TrainDoorEvent>();
        readonly HashSet<string> activeIds = new HashSet<string>(StringComparer.Ordinal);
        readonly ModuleMotionDispatch dispatch = new ModuleMotionDispatch { MeasureDisplacement = false };
        readonly Dictionary<string, StaticCombinedPart[]> staticBodyCache =
            new Dictionary<string, StaticCombinedPart[]>(StringComparer.Ordinal);
        readonly List<Mesh> staticBodyMeshes = new List<Mesh>();
        StationViewBuildContext context;

        internal readonly struct StaticCombinedPart {
            public readonly Mesh Mesh;
            public readonly Material Material;
            public readonly UnityEngine.Rendering.ShadowCastingMode Shadow;
            public readonly string Label;

            public StaticCombinedPart(Mesh mesh, Material material, UnityEngine.Rendering.ShadowCastingMode shadow, string label) {
                Mesh = mesh; Material = material; Shadow = shadow; Label = label;
            }
        }

        internal static void CompactConsistInstance(
            GameObject consist,
            string formationKey,
            Dictionary<string, StaticCombinedPart[]> cache,
            List<Mesh> ownedMeshes,
            UnityEngine.Rendering.ShadowCastingMode? forceShadowMode = null) {
            if (consist == null || cache == null || ownedMeshes == null) return;
            var carNodes = CollectCars(consist);
            for (int i = 0; i < carNodes.Count; i++) {
                var node = carNodes[i];
                if (node == null) continue;
                string originalName = node.name;
                int dash = originalName.IndexOf('-');
                string part = dash >= 0 && dash + 1 < originalName.Length ? originalName.Substring(dash + 1) : originalName;
                CompactSubtreeCore(node, (formationKey ?? "") + "|car|" + part, preserveDoors: true, cache, ownedMeshes, forceShadowMode);
            }
            var gangways = CollectGangways(consist);
            for (int i = 0; i < gangways.Count; i++) {
                var gw = gangways[i];
                if (gw == null) continue;
                CompactSubtreeCore(gw, (formationKey ?? "") + "|gangway", preserveDoors: false, cache, ownedMeshes, forceShadowMode);
            }
            ApplyUnbatchedLods(consist, cache, ownedMeshes);
        }

        static readonly System.Text.RegularExpressions.Regex DoorLeafPattern =
            new System.Text.RegularExpressions.Regex(@"Door\d+$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        sealed class StaticMatKey : IEquatable<StaticMatKey> {
            public readonly Material Material;
            public readonly UnityEngine.Rendering.ShadowCastingMode Shadow;
            public StaticMatKey(Material material, UnityEngine.Rendering.ShadowCastingMode shadow) {
                Material = material; Shadow = shadow;
            }
            public bool Equals(StaticMatKey other) =>
                other != null && ReferenceEquals(Material, other.Material) && Shadow == other.Shadow;
            public override bool Equals(object obj) => obj is StaticMatKey other && Equals(other);
            public override int GetHashCode() {
                unchecked {
                    int h = Material != null ? System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Material) : 0;
                    return (h * 397) ^ (int)Shadow;
                }
            }
        }

        sealed class StaticCombineBucket {
            public Material Material;
            public UnityEngine.Rendering.ShadowCastingMode Shadow;
            public readonly List<CombineInstance> Combines = new List<CombineInstance>();
            public readonly List<int> LastTiers = new List<int>();
            public int VertexCount;
        }

        static TrainMeshLods trainMeshLods;

        static TrainMeshLods LoadTrainLods() =>
            trainMeshLods != null ? trainMeshLods : trainMeshLods = Resources.Load<TrainMeshLods>(TrainMeshLods.ResourceKey);

        static void ApplyUnbatchedLods(GameObject consist, Dictionary<string, StaticCombinedPart[]> cache, List<Mesh> ownedMeshes) {
            var library = LoadTrainLods();
            if (library == null) return;
            foreach (var filter in consist.GetComponentsInChildren<MeshFilter>(true)) {
                var full = filter.sharedMesh;
                var low = library.FindLow(full);
                if (low == null) continue;
                // Keep the original leaf/pantograph transform and renderer, including its animation and materials.
                string key = "train-lod-mesh|" + full.GetEntityId();
                if (!cache.TryGetValue(key, out var parts)) {
                    var source = new CombineInstance { mesh = full, transform = Matrix4x4.identity };
                    var mesh = CombineTrainTiers(full.name, new[] { source }, new[] { 2 }, full.vertexCount,
                        library, allowOmission: false);
                    ownedMeshes.Add(mesh);
                    parts = new[] { new StaticCombinedPart(mesh, null, default, full.name) };
                    cache.Add(key, parts);
                }
                filter.sharedMesh = parts[0].Mesh;
            }
        }

        static Mesh CombineTrainTiers(string name, IReadOnlyList<CombineInstance> source, IReadOnlyList<int> lastTiers,
            int vertexCount, TrainMeshLods library, bool allowOmission) {
            var combines = new List<CombineInstance>(source.Count);
            var lowSlots = new int[source.Count];
            for (int i = 0; i < source.Count; i++) combines.Add(source[i]);
            for (int i = 0; i < source.Count; i++) {
                lowSlots[i] = i;
                if (library == null || (allowOmission && lastTiers[i] < 2)) continue;
                var part = source[i];
                if (part.mesh.subMeshCount != 1) continue;
                var low = library.FindLow(part.mesh);
                if (low == null) continue;
                lowSlots[i] = combines.Count;
                part.mesh = low;
                combines.Add(part);
                vertexCount += low.vertexCount;
            }

            var mesh = new Mesh {
                name = name,
                indexFormat = vertexCount > 65535
                    ? UnityEngine.Rendering.IndexFormat.UInt32
                    : UnityEngine.Rendering.IndexFormat.UInt16,
            };
            mesh.CombineMeshes(combines.ToArray(), mergeSubMeshes: true, useMatrices: true);
            mesh.RecalculateBounds();
            if (combines.Count == source.Count) {
                if (allowOmission) {
                    for (int i = 0; i < lastTiers.Count; i++) {
                        if (lastTiers[i] >= 2) continue;
                        StationMeshLodIndices.ApplyCombined(mesh, source, lastTiers);
                        break;
                    }
                }
                return mesh;
            }

            var indices = new List<int>();
            mesh.GetTriangles(indices, 0);
            var offsets = new int[combines.Count + 1];
            for (int i = 0; i < combines.Count; i++)
                offsets[i + 1] = offsets[i] + (int)combines[i].mesh.GetIndexCount(combines[i].subMeshIndex);
            var packed = new List<int>(indices.Count);
            void Append(int slot) {
                for (int i = offsets[slot]; i < offsets[slot + 1]; i++) packed.Add(indices[i]);
            }
            for (int i = 0; i < source.Count; i++)
                if (!allowOmission || lastTiers[i] >= 1) Append(i);
            int balancedCount = packed.Count;
            for (int i = 0; i < source.Count; i++)
                if (allowOmission && lastTiers[i] == 0) Append(i);
            int fullCount = packed.Count;
            for (int i = 0; i < source.Count; i++)
                if (!allowOmission || lastTiers[i] >= 2) Append(lowSlots[i]);
            StationMeshLodIndices.ApplyLowOverride(mesh, packed, fullCount, balancedCount);
            return mesh;
        }

        void CompactConsistStaticBodies(string formationKey, IReadOnlyList<TrainCarView> carViews, List<Transform> gangways) =>
            CompactConsistStaticBodies(formationKey, carViews, gangways, staticBodyCache, staticBodyMeshes);

        static void CompactConsistStaticBodies(
            string formationKey,
            IReadOnlyList<TrainCarView> carViews,
            List<Transform> gangways,
            Dictionary<string, StaticCombinedPart[]> cache,
            List<Mesh> ownedMeshes) {
            if (carViews != null) {
                for (int i = 0; i < carViews.Count; i++) {
                    var car = carViews[i];
                    if (car?.Root == null) continue;
                    CompactSubtreeCore(car.Root.transform, (formationKey ?? "") + "|car|" + (car.Part ?? ""),
                        preserveDoors: true, cache, ownedMeshes, null);
                }
            }
            if (gangways != null) {
                for (int i = 0; i < gangways.Count; i++) {
                    var gw = gangways[i];
                    if (gw == null) continue;
                    CompactSubtreeCore(gw, (formationKey ?? "") + "|gangway",
                        preserveDoors: false, cache, ownedMeshes, null);
                }
            }
        }

        static bool IsAnchorName(string name) {
            if (string.IsNullOrEmpty(name)) return false;
            return name.StartsWith("DoorCentre", StringComparison.Ordinal) ||
                string.Equals(name, "AxisX", StringComparison.Ordinal) ||
                string.Equals(name, "Front", StringComparison.Ordinal) ||
                string.Equals(name, "Up", StringComparison.Ordinal) ||
                string.Equals(name, "Approach", StringComparison.Ordinal);
        }

        static void MarkSubtree(Transform root, HashSet<Transform> set) {
            set.Add(root);
            for (int i = 0; i < root.childCount; i++) MarkSubtree(root.GetChild(i), set);
        }

        static void MarkAncestors(Transform node, Transform stopAt, HashSet<Transform> set) {
            var cur = node;
            while (cur != null) {
                set.Add(cur);
                if (cur == stopAt) break;
                cur = cur.parent;
            }
        }

        static bool IsActiveUnder(Transform node, Transform stopAt) {
            var cur = node;
            while (cur != null) {
                if (!cur.gameObject.activeSelf) return false;
                if (cur == stopAt) return true;
                cur = cur.parent;
            }
            return true;
        }

        void CompactSubtree(Transform subtreeRoot, string baseKey, bool preserveDoors) =>
            CompactSubtreeCore(subtreeRoot, baseKey, preserveDoors, staticBodyCache, staticBodyMeshes, null);

        static void CompactSubtreeCore(
            Transform subtreeRoot,
            string baseKey,
            bool preserveDoors,
            Dictionary<string, StaticCombinedPart[]> cache,
            List<Mesh> ownedMeshes,
            UnityEngine.Rendering.ShadowCastingMode? forceShadowMode) {
            if (subtreeRoot == null) return;
            var protectedNodes = new HashSet<Transform> { subtreeRoot };
            var allTransforms = subtreeRoot.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < allTransforms.Length; i++) {
                var t = allTransforms[i];
                if (t == null || t == subtreeRoot) continue;
                if (preserveDoors && DoorLeafPattern.IsMatch(t.name)) {
                    MarkSubtree(t, protectedNodes);
                    MarkAncestors(t, subtreeRoot, protectedNodes);
                } else if (IsAnchorName(t.name)) {
                    MarkAncestors(t, subtreeRoot, protectedNodes);
                }
            }

            var filters = subtreeRoot.GetComponentsInChildren<MeshFilter>(true);
            var eligible = new List<(MeshFilter Filter, MeshRenderer Renderer, Mesh Mesh, Material[] Mats)>(filters.Length);
            int totalVerts = 0;
            for (int i = 0; i < filters.Length; i++) {
                var mf = filters[i];
                if (mf == null || protectedNodes.Contains(mf.transform)) continue;
                if (!IsActiveUnder(mf.transform, subtreeRoot)) continue;
                var mr = mf.GetComponent<MeshRenderer>();
                if (mr == null || !mr.enabled) continue;
                var mesh = mf.sharedMesh;
                if (mesh == null || mesh.vertexCount == 0 || !mesh.isReadable) {
                    MarkAncestors(mf.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                var mats = mr.sharedMaterials;
                if (mats == null || mats.Length == 0) continue;
                bool allTri = true;
                int subCount = Math.Max(1, mesh.subMeshCount);
                for (int s = 0; s < subCount; s++) {
                    if (mesh.GetTopology(s) != MeshTopology.Triangles) { allTri = false; break; }
                }
                if (!allTri) {
                    MarkAncestors(mf.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                eligible.Add((mf, mr, mesh, mats));
                totalVerts += mesh.vertexCount;
            }

            if (eligible.Count < 4) return;

            string cacheKey = baseKey + "|" + eligible.Count + "|" + totalVerts;
            if (!cache.TryGetValue(cacheKey, out var cachedParts)) {
                var rootInv = subtreeRoot.worldToLocalMatrix;
                var buckets = new Dictionary<StaticMatKey, StaticCombineBucket>();
                var order = new List<StaticCombineBucket>();
                for (int i = 0; i < eligible.Count; i++) {
                    var item = eligible[i];
                    var localMat = rootInv * item.Filter.transform.localToWorldMatrix;
                    int subCount = Math.Max(1, item.Mesh.subMeshCount);
                    var shadow = forceShadowMode ?? item.Renderer.shadowCastingMode;
                    for (int s = 0; s < subCount; s++) {
                        var mat = item.Mats[Math.Min(s, item.Mats.Length - 1)];
                        if (mat == null) continue;
                        var key = new StaticMatKey(mat, shadow);
                        if (!buckets.TryGetValue(key, out var bucket)) {
                            bucket = new StaticCombineBucket { Material = mat, Shadow = shadow };
                            buckets[key] = bucket;
                            order.Add(bucket);
                        }
                        bucket.Combines.Add(new CombineInstance {
                            mesh = item.Mesh,
                            subMeshIndex = s,
                            transform = localMat,
                        });
                        bucket.LastTiers.Add(StaticDetailLastTier(item.Filter.transform.name));
                        bucket.VertexCount += item.Mesh.vertexCount;
                    }
                }
                var builtParts = new List<StaticCombinedPart>(order.Count);
                var library = LoadTrainLods();
                for (int b = 0; b < order.Count; b++) {
                    var bucket = order[b];
                    if (bucket.Combines.Count == 0) continue;
                    var matName = bucket.Material != null ? bucket.Material.name : "mat";
                    var combined = CombineTrainTiers(cacheKey + " [" + matName + "]", bucket.Combines,
                        bucket.LastTiers, bucket.VertexCount, library,
                        allowOmission: bucket.Material.renderQueue < (int)UnityEngine.Rendering.RenderQueue.Transparent);
                    ownedMeshes.Add(combined);
                    builtParts.Add(new StaticCombinedPart(combined, bucket.Material, bucket.Shadow, matName));
                }
                cachedParts = builtParts.ToArray();
                cache[cacheKey] = cachedParts;
            }

            if (cachedParts == null || cachedParts.Length == 0) return;

            var detachRoots = new HashSet<Transform>();
            for (int i = 0; i < eligible.Count; i++) {
                var cur = eligible[i].Filter.transform;
                while (cur != null && cur.parent != null && !protectedNodes.Contains(cur.parent)) {
                    cur = cur.parent;
                }
                if (cur != null && !protectedNodes.Contains(cur)) detachRoots.Add(cur);
            }
            foreach (var t in detachRoots) {
                if (t == null) continue;
                t.SetParent(null, false);
                t.gameObject.SetActive(false);
                DestroyNow(t.gameObject);
            }

            for (int p = 0; p < cachedParts.Length; p++) {
                var part = cachedParts[p];
                if (part.Mesh == null || part.Material == null) continue;
                var go = new GameObject("StaticBody " + part.Label);
                go.transform.SetParent(subtreeRoot, false);
                go.AddComponent<MeshFilter>().sharedMesh = part.Mesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = part.Material;
                mr.shadowCastingMode = part.Shadow;
                mr.receiveShadows = true;
            }
        }

        static int StaticDetailLastTier(string name) {
            if (name.StartsWith("bogie-wheel-face-bolt", StringComparison.Ordinal) ||
                name.StartsWith("bogie-primary-coil-spring", StringComparison.Ordinal))
                return 0;
            if (name.StartsWith("hanging-strap", StringComparison.Ordinal) ||
                name.StartsWith("cabin-ring-light", StringComparison.Ordinal) ||
                name.StartsWith("underframe-vent", StringComparison.Ordinal))
                return 1;
            return 2;
        }


        public IReadOnlyList<TrainConsistView> Consists => consists;
        readonly Dictionary<string, Material> liveryMaterials = new Dictionary<string, Material>(StringComparer.Ordinal);
        readonly List<Material> ownedLiveryMaterials = new List<Material>();
        StationDocument lastPresentationDoc;
        bool markListenerAttached;
        /// <summary>The per-world door dispatch; its probes measure the leaves' real travel.</summary>
        public ModuleMotionDispatch Dispatch => dispatch;
        /// <summary>Frames that positioned at least one consist.</summary>
        public int Applied { get; private set; }
        /// <summary>Record per-event door presentation (a verifier); off in the player.</summary>
        public bool LogDoorEvents { get; set; }
        /// <summary>The events recorded so far, oldest first.</summary>
        public IReadOnlyList<TrainDoorEvent> DoorEvents => doorEvents;
        public void ClearDoorEvents() { doorEvents.Clear(); lastBankFraction.Clear(); }

        public bool TryGet(string trainId, out TrainConsistView view) =>
            byId.TryGetValue(trainId ?? "", out view);

        public ModuleMotionProbe Probe(string trainId) => dispatch.Probe(trainId);

        /* ---------------------------------------------------------------- build */

        public void Build(StationViewBuildContext buildContext) {
            context = buildContext ?? throw new ArgumentNullException(nameof(buildContext));
            var document = context.Document;
            if (document == null) return;
            AttachMarkListener();
            BuildAllCore(
                context.World,
                document,
                context.Index,
                context.TrainCatalogue,
                context.RoleRoot(TrainConsistRenderer.RoleName),
                context.Root,
                context.ReportUnresolved,
                stagedRecords: null);
        }

        internal void StageBuild(
            StationWorldView world,
            StationDocument document,
            StationIndex index,
            Transform stagingRoot,
            Action<string, string, string, string> reportUnresolved,
            List<StationViewRecord> stagedRecords) {
            if (world == null || document == null || stagingRoot == null) return;
            BuildAllCore(
                world,
                document,
                index,
                world.TrainCatalogue,
                stagingRoot,
                world.Root,
                reportUnresolved,
                stagedRecords ?? new List<StationViewRecord>());
        }

        internal void AttachMarkListener() {
            if (!markListenerAttached) {
                TrainMarkTextureCache.TextureUpdated += OnTrainMarksUpdated;
                markListenerAttached = true;
            }
        }

        void BuildAllCore(
            StationWorldView world,
            StationDocument document,
            StationIndex index,
            TrainCatalogue catalogue,
            Transform parent,
            Transform boundsRoot,
            Action<string, string, string, string> reportUnresolved,
            List<StationViewRecord> stagedRecords) {
            lastPresentationDoc = document;
            for (int l = 0; l < document.Lines.Count; l++) {
                var line = document.Lines[l];
                if (line == null || string.IsNullOrEmpty(line.Id)) continue;
                var formationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, catalogue);
                var tracks = index != null
                    ? TrainConsistGeometry.ServiceTracks(index, line.Id)
                    : TrainConsistGeometry.ServiceTracks(document, line.Id);
                if (tracks.Count == 0) {
                    reportUnresolved?.Invoke("train-no-track", "line", line.Id,
                        "Line '" + line.Id + "' runs no saved track module, so no consist is drawn for it.");
                    continue;
                }
                for (int t = 0; t < tracks.Count; t++) {
                    try {
                        BuildConsist(world, document, index, line, tracks[t], formationKey, catalogue, parent, boundsRoot,
                            reportUnresolved, stagedRecords);
                    } catch (Exception error) {
                        reportUnresolved?.Invoke("train-build-failed", "train",
                            "train:" + line.Id + "|" + tracks[t].Id,
                            error.GetType().Name + ": " + error.Message);
                    }
                }
            }
        }

        void BuildConsist(
            StationWorldView world,
            StationDocument document,
            StationIndex index,
            StationLineRecord line,
            StationModuleRecord track,
            string formationKey,
            TrainCatalogue catalogue,
            Transform parent,
            Transform boundsRoot,
            Action<string, string, string, string> reportUnresolved,
            List<StationViewRecord> stagedRecords) {
            var trainId = line.Id + "|" + track.Id;
            var recordId = "train:" + trainId;
            if (catalogue == null) {
                reportUnresolved?.Invoke("no-train-catalogue", "train", recordId,
                    "No TrainCatalogue is bound to the scene, so no promoted formation can be drawn.");
                return;
            }
            if (!catalogue.TryGet(formationKey, out var entry) || entry == null || entry.prefab == null) {
                reportUnresolved?.Invoke("no-formation", "train", recordId,
                    "No promoted formation for key '" + formationKey + "' (line " + line.Id +
                    " stock " + line.Stock + ", " + line.Cars + " cars, " + line.Power +
                    "); nothing is drawn and no box stands in for it.");
                return;
            }
            float scale = ResolveModelScale(line);
            if (!TrainConsistGeometry.TryBerth(document, index, line, track, scale, out var berth, out var failure)) {
                reportUnresolved?.Invoke("train-berth", "train", recordId,
                    "The track record cannot give this consist a berth: " + failure + ".");
                return;
            }
            if (entry.cars != line.Cars) {
                reportUnresolved?.Invoke("formation-car-count", "train", recordId,
                    "Formation '" + formationKey + "' carries " + entry.cars + " cars but the line runs " +
                    line.Cars + "; the cars on the rails follow the promoted formation.");
            }
            var instance = UnityEngine.Object.Instantiate(entry.prefab, parent);
            instance.name = "consist " + trainId;
            // Apply the line's authored/storey model scale (default 0.98) onto the promoted
            // `Consist` node so every formation (not only Zoo's baked 0.98 livery) aligns its
            // car doors and cabin floor with the PSD run while keeping the wrapper at scale 1.
            float rigScale = ApplyConsistScale(instance, entry.bakedScale, scale);
            if (stagedRecords != null) StationEditTrace.AddInstantiatedPrefab();

            var view = new TrainConsistView {
                TrainId = trainId, LineId = line.Id, TrackId = track.Id,
                FormationKey = formationKey, PrefabPath = entry.prefabPath ?? "",
                Stock = line.Stock, Scale = scale, Berth = berth, Root = instance,
                World = world,
            };
            view.Place();

            var carNodes = CollectCars(instance);
            if (carNodes.Count == 0) {
                reportUnresolved?.Invoke("no-cars", "train", recordId,
                    "The promoted formation '" + formationKey + "' carries no Car<n> node; nothing is drawn.");
                DestroyNow(instance);
                return;
            }
            // The promoted prefab already lays the cars out on the source cadence in its
            // own `Consist` frame (`-car.centre` under the 180° Unity basis). Writing
            // `CarCentres` onto them here used the opposite sign in that basis and could
            // disagree with the gangways and doorway anchors that share the frame, so the
            // authored local positions are kept untouched. `CarCentres` remains the
            // independent expected cadence a test compares against.
            for (int i = 0; i < carNodes.Count; i++) {
                var node = carNodes[i];
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
                if (TryDocumentBounds(node, boundsRoot, out var bounds)) {
                    car.Bounds = bounds;
                    car.HasBounds = true;
                }
            }

            // The rig measures the promoted leaves against the stock's own door width;
            // track-local platform sides are converted into consist-local door banks once
            // at the consist boundary via StationTrainPose.ConsistDoorBankMask.
            var rig = new TrainDoorRig(instance, TrainDoorRig.ForLine(line.Stock, line.Cars, rigScale));
            view.Rig = rig;
            int bankMask = berth.DoorBankMask;
            view.DoorBankMask = bankMask;
            view.PlatformBank = (bankMask & 1) != 0 ? 1 : ((bankMask & 2) != 0 ? -1 : berth.DefaultPlatformBank);
            rig.SetActiveBankMask(bankMask);
            rig.Reset();
            if (rig.Leaves == 0) {
                reportUnresolved?.Invoke("train-rig-no-leaves", "train", recordId,
                    "The promoted formation carries no DoorNN leaf the rig can bind; its body is still drawn.");
            } else if (!dispatch.BindTrainMask(trainId, rig, bankMask)) {
                reportUnresolved?.Invoke("train-rig-unbound", "train", recordId,
                    "The consist's door rig could not be bound for frame.Trains.");
            }

            // One visibility target per track, not one per `Car<n>` root. The Zoo
            // formation also carries standalone `Gangway1…5` roots (and the roof/pantograph
            // wrappers); registering only the car nodes left every other part always
            // enabled, which is how fragments of the −15 m consist stayed on screen while
            // its cars were hidden with the −20 m storey. The saved track's own storey band
            // is the membership — never a child's measured bounds.
            var gangways = CollectGangways(instance);
            for (int i = 0; i < gangways.Count; i++) view.Gangways.Add(gangways[i]);
            CompactConsistStaticBodies(formationKey, view.CarViews, gangways);
            view.LiveryBinding = TrainLiveryBinder.Capture(instance);
            TrainLiveryBinder.Apply(
                view.LiveryBinding,
                line.Id,
                string.IsNullOrEmpty(line.Colour) ? StationCityStyles.LineColourFor(line.Id, document.City) : line.Colour,
                document.City,
                liveryMaterials,
                ownedLiveryMaterials,
                recaptureVisibility: false);
            ApplyUnbatchedLods(instance, staticBodyCache, staticBodyMeshes);
            var grid = StationLevelGrid.FromDocument(document.LevelBase, document.StoreyHeight);
            var bands = StationModuleLevels.Of(track.Facts, grid);
            int trackLevel = bands.Length > 0 ? bands[0] : StationModuleLevels.Band(grid, track.Z);
            int trackLevelMax = bands.Length > 0 ? bands[bands.Length - 1] : trackLevel;
            view.LevelMin = trackLevel;
            view.LevelMax = trackLevelMax;
            view.LevelBands = bands;
            view.VisibilityRecordId = recordId;
            var consistBounds = TrackBandBounds(track, scale);
            view.ConsistBounds = consistBounds;
            view.HasConsistBounds = !consistBounds.IsEmpty;
            if (stagedRecords != null) {
                stagedRecords.Add(new StationViewRecord {
                    Role = TrainConsistRenderer.RoleName,
                    ModuleId = recordId,
                    Part = "consist",
                    View = instance,
                    Bounds = view.HasConsistBounds ? consistBounds : default,
                    HasBounds = view.HasConsistBounds,
                    LevelMin = trackLevel,
                    LevelMax = trackLevelMax,
                    LevelBands = bands,
                });
            } else {
                world.RegisterModule(TrainConsistRenderer.RoleName, recordId, instance, "consist",
                    view.HasConsistBounds ? consistBounds : (StationBox?)null, trackLevel, trackLevelMax, bands);
            }
            var initialTarget = instance.GetComponent<StationVisibilityTarget>() ?? instance.AddComponent<StationVisibilityTarget>();
            initialTarget.Configure(StationPartRole.Train, bands, isParked: true);
            initialTarget.Refresh();

            // The formation is staged before the first published frame, but it is not a train
            // at a platform until a service run samples a pose (18 §7): a station opened
            // before Play must not show a consist parked at its berth.
            view.Retire();

            consists.Add(view);
            byId[trainId] = view;
        }

        /// <summary>
        /// The **saved track band** a consist's visibility belongs to: the track's own
        /// footprint at its own elevation, raised by the stock envelope. A child's bounds
        /// never decide storey membership (RCA 14 §1/§3).
        /// </summary>
        static StationBox TrackBandBounds(StationModuleRecord track, float scale) {
            var cells = StationFootprints.TrackCells(track);
            if (cells.Length == 0) {
                return new StationBox(track.X, track.Y, track.Z,
                    track.X + Mathf.Max(1, track.Width), track.Y + Mathf.Max(1, track.Depth), track.Z + 1 + 3.8f * scale);
            }
            float x0 = float.MaxValue, y0 = float.MaxValue, x1 = float.MinValue, y1 = float.MinValue;
            for (int i = 0; i < cells.Length; i++) {
                var point = cells[i];
                x0 = Mathf.Min(x0, (float)point.X); y0 = Mathf.Min(y0, (float)point.Y);
                x1 = Mathf.Max(x1, (float)point.X + 1); y1 = Mathf.Max(y1, (float)point.Y + 1);
            }
            return new StationBox(x0, y0, track.Z, x1, y1, track.Z + 1 + 3.8f * scale);
        }

        /* ----------------------------------------------------------- per frame */

        /// <summary>
        /// One published station frame: every consist the frame names moves to its
        /// phase pose and the dispatch drives only its platform-side bank. A frame
        /// that names no consist (a released session) leaves the last pose alone.
        /// </summary>
        public bool Apply(StationMotionFrame frame) => Apply(frame, 1f, false);

        /// <summary>
        /// Sample one consist frame at <paramref name="alpha"/> between the previous and
        /// current tick targets. <paramref name="resetHistory"/> snaps every consist
        /// (and the door dispatch) instead of blending; the sink passes it for a
        /// session switch, a seek or a restart.
        /// </summary>
        public bool Apply(StationMotionFrame frame, float alpha, bool resetHistory = false) {
            int positioned = 0;
            if (resetHistory) {
                for (int i = 0; i < consists.Count; i++) consists[i].ForgetSample();
                dispatch.ForgetSamples();
            }
            var trains = frame.Trains;
            // A frame that names no consist (a released session) leaves the last pose alone.
            if (trains == null) return false;
            activeIds.Clear();
            for (int i = 0; i < trains.Length; i++) {
                var train = trains[i];
                if (string.IsNullOrEmpty(train.Id)) continue;
                if (!byId.TryGetValue(train.Id, out var view) || view.Root == null) continue;
                // `None` with sequence 0 is a scheduled service in the gap between two runs:
                // the snapshot keeps it for the clock and arrival forecast, but there is no
                // consist on the rails to draw. Before 18 it stayed parked at its berth.
                if (train.Phase == TrainPhase.None || train.ServiceSequence == 0) {
                    view.Retire();
                    continue;
                }
                // Another run of the same service: start from its own approach pose instead of
                // blending out of the previous departure.
                if (train.ServiceSequence != view.ServiceSequence) view.ForgetSample();
                view.Apply(train, alpha);
                activeIds.Add(train.Id);
                positioned++;
            }
            // A service the frame no longer names is parked rather than left in its last pose.
            for (int i = 0; i < consists.Count; i++) {
                var view = consists[i];
                if (view.Root == null || activeIds.Contains(view.TrainId)) continue;
                view.Retire();
            }
            if (positioned > 0) {
                dispatch.Apply(frame, alpha);
                // A track with no platform edge has no bank the source would open
                // (`doorSides` is 0); hold it shut rather than open a tunnel wall.
                for (int i = 0; i < consists.Count; i++) {
                    var view = consists[i];
                    if (view.Berth != null && view.DoorBankMask == 0) view.Rig?.Reset();
                }
                // Only now, with the first pose and the door banks written, may a consist draw.
                for (int i = 0; i < consists.Count; i++) {
                    var view = consists[i];
                    if (view.Root != null && activeIds.Contains(view.TrainId)) view.Mount();
                }
                if (LogDoorEvents) RecordDoorEvents(trains);
                Applied++;
            }
            return positioned > 0;
        }

        /// <summary>
        /// Record what each consist's door banks actually applied this frame — an event,
        /// not a sample: `opening` the moment a bank leaves shut, `open` when it reaches
        /// the frame's command, `closed` when it gets back to 0. A stop therefore has
        /// exactly one `opening` and one `closed` per platform-side bank unless something
        /// re-opened it, and the opposite bank contributes nothing at all.
        /// </summary>
        void RecordDoorEvents(StationTrainFrame[] trains) {
            if (trains == null) return;
            for (int i = 0; i < trains.Length; i++) {
                var train = trains[i];
                if (string.IsNullOrEmpty(train.Id)) continue;
                if (!byId.TryGetValue(train.Id, out var view) || view.Rig == null) continue;
                var rig = view.Rig;
                bool commandedOpen = (train.Phase == TrainPhase.Opening || train.Phase == TrainPhase.Dwell) &&
                    view.Berth != null && view.Berth.HasPlatform;
                for (int b = 0; b < 2; b++) {
                    int bank = b == 0 ? 1 : -1;
                    float applied = rig.BankFraction(bank);
                    string key = train.Id + "|" + bank;
                    bool had = lastBankFraction.TryGetValue(key, out float previous);
                    lastBankFraction[key] = applied;
                    if (!had) previous = 0f;
                    if (applied == previous) continue;
                    string kind = previous <= 0f && applied > 0f ? "opening"
                        : previous > 0f && applied <= 0f ? "closed"
                        : applied >= 1f && previous < 1f ? "open"
                        : "";
                    if (kind.Length == 0) continue;
                    bool bankActive = (view.DoorBankMask & (bank >= 0 ? 1 : 2)) != 0;
                    doorEvents.Add(new TrainDoorEvent {
                        TrainId = train.Id, ServiceSequence = train.ServiceSequence, Phase = train.Phase,
                        PhaseSeconds = train.PhaseSeconds, Kind = kind, Bank = bank,
                        Commanded = (float)train.DoorFraction, Applied = applied,
                        Doorway = bankActive ? rig.ObservedDoorwayFor(bank) : -1,
                        LeafX = bankActive ? rig.ObservedLeafXFor(bank) : 0f,
                        LeafZ = bankActive ? rig.ObservedLeafZFor(bank) : 0f,
                    });
                }
                // A bank the platform does not face must never move: report it as its own
                // event so a verifier cannot mistake silence for a missing binding.
                if (commandedOpen && rig.InactiveFraction > 0f) {
                    doorEvents.Add(new TrainDoorEvent {
                        TrainId = train.Id, ServiceSequence = train.ServiceSequence, Phase = train.Phase,
                        PhaseSeconds = train.PhaseSeconds, Kind = "inactive-open", Bank = rig.InactiveBank,
                        Commanded = (float)train.DoorFraction, Applied = rig.InactiveFraction,
                        Doorway = -1, LeafX = 0f, LeafZ = 0f,
                    });
                }
            }
        }

        public void RefreshPresentation(StationDocument document) {
            if (document == null) return;
            lastPresentationDoc = document;
            var lineById = new Dictionary<string, StationLineRecord>(document.Lines.Count, StringComparer.Ordinal);
            for (int i = 0; i < document.Lines.Count; i++) {
                var l = document.Lines[i];
                if (l != null && !string.IsNullOrEmpty(l.Id)) lineById[l.Id] = l;
            }
            for (int i = 0; i < consists.Count; i++) {
                var c = consists[i];
                if (c?.LiveryBinding == null || c.Root == null) continue;
                string colour = lineById.TryGetValue(c.LineId, out var line) && !string.IsNullOrEmpty(line.Colour)
                    ? line.Colour
                    : StationCityStyles.LineColourFor(c.LineId, document.City);
                TrainLiveryBinder.Apply(
                    c.LiveryBinding, c.LineId, colour, document.City,
                    liveryMaterials, ownedLiveryMaterials, recaptureVisibility: true);
            }
        }

        void OnTrainMarksUpdated() {
            if (lastPresentationDoc != null) RefreshPresentation(lastPresentationDoc);
        }

        /* -------------------------------------------------------------- teardown */

        internal void DisposeRetired(StationLocalViewCommit commit) {
            if (markListenerAttached) {
                TrainMarkTextureCache.TextureUpdated -= OnTrainMarksUpdated;
                markListenerAttached = false;
            }
            lastPresentationDoc = null;
            if (commit != null && consists.Count > 0) {
                var alreadyRetired = new HashSet<GameObject>();
                for (int i = 0; i < commit.RetiredViews.Count; i++) {
                    if (commit.RetiredViews[i] != null) alreadyRetired.Add(commit.RetiredViews[i]);
                }
                for (int i = 0; i < consists.Count; i++) {
                    var root = consists[i].Root;
                    if (root != null && !alreadyRetired.Contains(root)) commit.RetiredViews.Add(root);
                }
            }
            consists.Clear();
            byId.Clear();
            dispatch.Clear();
            for (int i = 0; i < staticBodyMeshes.Count; i++) {
                var mesh = staticBodyMeshes[i];
                if (mesh == null) continue;
                if (commit != null) commit.RetiredMeshes.Add(mesh);
                else DestroyNow(mesh);
            }
            staticBodyMeshes.Clear();
            staticBodyCache.Clear();
            for (int i = 0; i < ownedLiveryMaterials.Count; i++) {
                if (ownedLiveryMaterials[i] != null) DestroyNow(ownedLiveryMaterials[i]);
            }
            ownedLiveryMaterials.Clear();
            liveryMaterials.Clear();
        }

        public void Dispose() {
            if (markListenerAttached) {
                TrainMarkTextureCache.TextureUpdated -= OnTrainMarksUpdated;
                markListenerAttached = false;
            }
            lastPresentationDoc = null;
            for (int i = 0; i < consists.Count; i++) {
                var root = consists[i].Root;
                if (root != null) DestroyNow(root);
            }
            consists.Clear();
            byId.Clear();
            dispatch.Clear();
            for (int i = 0; i < staticBodyMeshes.Count; i++) {
                if (staticBodyMeshes[i] != null) DestroyNow(staticBodyMeshes[i]);
            }
            staticBodyMeshes.Clear();
            staticBodyCache.Clear();
            for (int i = 0; i < ownedLiveryMaterials.Count; i++) {
                if (ownedLiveryMaterials[i] != null) DestroyNow(ownedLiveryMaterials[i]);
            }
            ownedLiveryMaterials.Clear();
            liveryMaterials.Clear();
        }

        /* -------------------------------------------------------------- helpers */

        /// <summary>
        /// Target model scale for a line's rolling stock, matching <see cref="OpeningModuleViews.ModelScaleOf"/>
        /// and <c>sim/stock.ts:trainScaleForStorey</c> (0.98 unless the line authored an explicit scale).
        /// </summary>
        public static float ResolveModelScale(StationLineRecord line) => OpeningModuleViews.ModelScaleOf(line);

        /// <summary>
        /// Applies <paramref name="targetScale"/> onto the promoted formation's <c>Consist</c> child
        /// (keeping the outer wrapper at <see cref="Vector3.one"/> so root-local metres and
        /// <see cref="TrainDoorRig"/> stay in world-metre units). Returns the scale that
        /// <see cref="TrainDoorRig.ForLine"/> should use in consist-root space.
        /// </summary>
        public static float ApplyConsistScale(GameObject instance, float bakedScale, float targetScale) {
            float effectiveTarget = targetScale > 0f ? targetScale : StationRailGeometry.DefaultScale;
            float effectiveBaked = bakedScale > 0f ? bakedScale : 1f;
            if (instance == null) return effectiveTarget;
            instance.transform.localScale = Vector3.one;
            var consist = instance.transform.Find("Unity basis/Consist");
            if (consist == null) {
                foreach (var child in instance.GetComponentsInChildren<Transform>(true)) {
                    if (string.Equals(child.name, "Consist", StringComparison.Ordinal)) {
                        consist = child;
                        break;
                    }
                }
            }
            if (consist != null) {
                consist.localScale = Vector3.one * effectiveTarget;
                return effectiveTarget;
            }
            float ratio = effectiveTarget / effectiveBaked;
            instance.transform.localScale = Vector3.one * ratio;
            return effectiveBaked;
        }

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

        /// <summary>Every standalone `Gangway&lt;n&gt;` root the promoted formation carries.</summary>
        public static List<Transform> CollectGangways(GameObject consist) {
            var gangways = new List<Transform>();
            if (consist == null) return gangways;
            foreach (var node in consist.GetComponentsInChildren<Transform>(true)) {
                if (!node.name.StartsWith("Gangway", StringComparison.Ordinal)) continue;
                gangways.Add(node);
            }
            return gangways;
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

        internal readonly struct StagedConsistEntry {
            public readonly TrainConsistView View;
            public readonly StationViewRecord Record;
            public readonly int BankMask;

            public StagedConsistEntry(TrainConsistView view, StationViewRecord record, int bankMask) {
                View = view;
                Record = record;
                BankMask = bankMask;
            }
        }

        internal Dictionary<string, StaticCombinedPart[]> CloneStaticBodyCache() =>
            new Dictionary<string, StaticCombinedPart[]>(staticBodyCache, StringComparer.Ordinal);

        internal Dictionary<string, Material> CloneLiveryMaterials() =>
            new Dictionary<string, Material>(liveryMaterials, StringComparer.Ordinal);

        internal bool TryStageSingleConsist(
            StationWorldView world,
            StationDocument document,
            StationIndex index,
            StationLineRecord line,
            StationModuleRecord track,
            string formationKey,
            TrainCatalogue catalogue,
            Transform stagingParent,
            Action<string, string, string, string> reportUnresolved,
            Dictionary<string, StaticCombinedPart[]> workingCache,
            List<Mesh> newMeshes,
            Dictionary<string, Material> workingLivery,
            List<Material> newLiveryMaterials,
            out StagedConsistEntry staged) {
            staged = default;
            var trainId = line.Id + "|" + track.Id;
            var recordId = "train:" + trainId;
            if (catalogue == null) {
                reportUnresolved?.Invoke("no-train-catalogue", "train", recordId,
                    "No TrainCatalogue is bound to the scene, so no promoted formation can be drawn.");
                return false;
            }
            if (!catalogue.TryGet(formationKey, out var entry) || entry == null || entry.prefab == null) {
                reportUnresolved?.Invoke("no-formation", "train", recordId,
                    "No promoted formation for key '" + formationKey + "' (line " + line.Id +
                    " stock " + line.Stock + ", " + line.Cars + " cars, " + line.Power +
                    "); nothing is drawn and no box stands in for it.");
                return false;
            }
            float scale = entry.bakedScale > 0f ? entry.bakedScale : 1f;
            if (!TrainConsistGeometry.TryBerth(document, index, line, track, scale, out var berth, out var failure)) {
                reportUnresolved?.Invoke("train-berth", "train", recordId,
                    "The track record cannot give this consist a berth: " + failure + ".");
                return false;
            }
            if (entry.cars != line.Cars) {
                reportUnresolved?.Invoke("formation-car-count", "train", recordId,
                    "Formation '" + formationKey + "' carries " + entry.cars + " cars but the line runs " +
                    line.Cars + "; the cars on the rails follow the promoted formation.");
            }
            var instance = UnityEngine.Object.Instantiate(entry.prefab, stagingParent);
            instance.name = "consist " + trainId;
            instance.transform.localScale = Vector3.one;
            StationEditTrace.AddInstantiatedPrefab();

            var view = new TrainConsistView {
                TrainId = trainId, LineId = line.Id, TrackId = track.Id,
                FormationKey = formationKey, PrefabPath = entry.prefabPath ?? "",
                Stock = line.Stock, Scale = scale, Berth = berth, Root = instance,
                World = world,
            };
            view.Place();

            var carNodes = CollectCars(instance);
            if (carNodes.Count == 0) {
                reportUnresolved?.Invoke("no-cars", "train", recordId,
                    "The promoted formation '" + formationKey + "' carries no Car<n> node; nothing is drawn.");
                DestroyNow(instance);
                return false;
            }
            var boundsRoot = world.Root;
            for (int i = 0; i < carNodes.Count; i++) {
                var node = carNodes[i];
                var originalName = node.name;
                var dash = originalName.IndexOf('-');
                var part = dash >= 0 && dash + 1 < originalName.Length ? originalName.Substring(dash + 1) : originalName;
                node.name = recordId + "|" + i;
                var car = new TrainCarView { Index = i, Part = part, Root = node.gameObject };
                view.AddCar(car);
                car.DocumentPosition = StationCoordinates.WorldToDocument(node.position);
                int level = StationCoordinates.StoreyBand(car.DocumentPosition.z, document.LevelBase);
                car.LevelMin = car.LevelMax = level;
                if (TryDocumentBounds(node, boundsRoot, out var bounds)) {
                    car.Bounds = bounds;
                    car.HasBounds = true;
                }
            }

            var rig = new TrainDoorRig(instance, TrainDoorRig.ForLine(line.Stock, line.Cars, scale));
            view.Rig = rig;
            int bankMask = berth.DoorBankMask;
            view.DoorBankMask = bankMask;
            view.PlatformBank = (bankMask & 1) != 0 ? 1 : ((bankMask & 2) != 0 ? -1 : berth.DefaultPlatformBank);
            rig.SetActiveBankMask(bankMask);
            rig.Reset();
            if (rig.Leaves == 0) {
                reportUnresolved?.Invoke("train-rig-no-leaves", "train", recordId,
                    "The promoted formation carries no DoorNN leaf the rig can bind; its body is still drawn.");
            }

            var gangways = CollectGangways(instance);
            for (int i = 0; i < gangways.Count; i++) view.Gangways.Add(gangways[i]);
            CompactConsistStaticBodies(formationKey, view.CarViews, gangways, workingCache, newMeshes);
            view.LiveryBinding = TrainLiveryBinder.Capture(instance);
            TrainLiveryBinder.Apply(
                view.LiveryBinding,
                line.Id,
                string.IsNullOrEmpty(line.Colour) ? StationCityStyles.LineColourFor(line.Id, document.City) : line.Colour,
                document.City,
                workingLivery,
                newLiveryMaterials,
                recaptureVisibility: false);
            ApplyUnbatchedLods(instance, workingCache, newMeshes);

            var grid = StationLevelGrid.FromDocument(document.LevelBase, document.StoreyHeight);
            var bands = StationModuleLevels.Of(track.Facts, grid);
            int trackLevel = bands.Length > 0 ? bands[0] : StationModuleLevels.Band(grid, track.Z);
            int trackLevelMax = bands.Length > 0 ? bands[bands.Length - 1] : trackLevel;
            view.LevelMin = trackLevel;
            view.LevelMax = trackLevelMax;
            view.LevelBands = bands;
            view.VisibilityRecordId = recordId;
            var consistBounds = TrackBandBounds(track, scale);
            view.ConsistBounds = consistBounds;
            view.HasConsistBounds = !consistBounds.IsEmpty;

            var record = new StationViewRecord {
                Role = TrainConsistRenderer.RoleName,
                ModuleId = recordId,
                Part = "consist",
                View = instance,
                Bounds = view.HasConsistBounds ? consistBounds : default,
                HasBounds = view.HasConsistBounds,
                LevelMin = trackLevel,
                LevelMax = trackLevelMax,
                LevelBands = bands,
            };

            var initialTarget = instance.GetComponent<StationVisibilityTarget>() ?? instance.AddComponent<StationVisibilityTarget>();
            initialTarget.Configure(StationPartRole.Train, bands, isParked: true);
            initialTarget.Refresh();
            view.Retire();

            staged = new StagedConsistEntry(view, record, bankMask);
            return true;
        }

        internal void CommitIncrementalDelta(
            StationDocument nextDocument,
            List<string> removedTrainIds,
            Dictionary<string, TrainBerth> retainedBerths,
            List<StagedConsistEntry> addedConsists,
            Dictionary<string, StaticCombinedPart[]> workingCache,
            List<Mesh> newMeshes,
            Dictionary<string, Material> workingLivery,
            List<Material> newLiveryMaterials,
            StationLocalViewCommit commit) {
            lastPresentationDoc = nextDocument;
            if (workingCache != null) {
                foreach (var kv in workingCache) staticBodyCache[kv.Key] = kv.Value;
            }
            if (newMeshes != null && newMeshes.Count > 0) staticBodyMeshes.AddRange(newMeshes);
            if (workingLivery != null) {
                foreach (var kv in workingLivery) liveryMaterials[kv.Key] = kv.Value;
            }
            if (newLiveryMaterials != null && newLiveryMaterials.Count > 0) ownedLiveryMaterials.AddRange(newLiveryMaterials);

            if (removedTrainIds != null && removedTrainIds.Count > 0) {
                var removedSet = new HashSet<string>(removedTrainIds, StringComparer.Ordinal);
                HashSet<GameObject> alreadyRetired = null;
                if (commit != null) {
                    alreadyRetired = new HashSet<GameObject>();
                    for (int i = 0; i < commit.RetiredViews.Count; i++) {
                        if (commit.RetiredViews[i] != null) alreadyRetired.Add(commit.RetiredViews[i]);
                    }
                }
                for (int i = consists.Count - 1; i >= 0; i--) {
                    var view = consists[i];
                    if (view == null || !removedSet.Contains(view.TrainId)) continue;
                    dispatch.Unbind(view.TrainId);
                    byId.Remove(view.TrainId);
                    consists.RemoveAt(i);
                    if (view.Root != null) {
                        if (commit != null) {
                            if (alreadyRetired.Add(view.Root)) commit.RetiredViews.Add(view.Root);
                        } else {
                            DestroyNow(view.Root);
                        }
                    }
                }
            }

            if (retainedBerths != null && retainedBerths.Count > 0) {
                for (int i = 0; i < consists.Count; i++) {
                    var view = consists[i];
                    if (view != null && retainedBerths.TryGetValue(view.TrainId, out var nextBerth)) {
                        view.Berth = nextBerth;
                    }
                }
            }

            if (addedConsists != null && addedConsists.Count > 0) {
                for (int i = 0; i < addedConsists.Count; i++) {
                    var item = addedConsists[i];
                    var view = item.View;
                    if (view == null) continue;
                    if (view.Rig != null && view.Rig.Leaves > 0) {
                        dispatch.BindTrainMask(view.TrainId, view.Rig, item.BankMask);
                    }
                    consists.Add(view);
                    byId[view.TrainId] = view;
                }
            }
            AttachMarkListener();
        }

        internal void ApplyRefreshedBerths(StationDocument nextDocument, Dictionary<string, TrainBerth> refreshed) {
            lastPresentationDoc = nextDocument;
            if (refreshed == null) return;
            for (int i = 0; i < consists.Count; i++) {
                var view = consists[i];
                if (view != null && refreshed.TryGetValue(view.TrainId, out var nextBerth)) {
                    view.Berth = nextBerth;
                }
            }
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
    public sealed class TrainConsistRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "trains";

        sealed class TrainPresentationStage : IStationLocalRendererStage {
            readonly WorldState state;
            readonly StationDocument nextDocument;

            public TrainPresentationStage(WorldState state, StationDocument nextDocument) {
                this.state = state;
                this.nextDocument = nextDocument;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                state?.Views?.RefreshPresentation(nextDocument);
            }

            public void Dispose() { }
        }

        sealed class TrainBerthRefreshStage : IStationLocalRendererStage {
            readonly TrainConsistRenderer owner;
            readonly WorldState state;
            readonly StationDocument nextDocument;
            readonly Dictionary<string, TrainBerth> refreshedBerths;

            public TrainBerthRefreshStage(
                TrainConsistRenderer owner,
                WorldState state,
                StationDocument nextDocument,
                Dictionary<string, TrainBerth> refreshedBerths) {
                this.owner = owner;
                this.state = state;
                this.nextDocument = nextDocument;
                this.refreshedBerths = refreshedBerths;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                state?.Views?.ApplyRefreshedBerths(nextDocument, refreshedBerths);
                owner.ViewsGeneration++;
            }

            public void Dispose() { }
        }

        static bool SameConsistStructure(TrainConsistView view, string formationKey, float scale, TrainBerth next) {
            if (view == null || view.Berth == null || next == null) return false;
            var cur = view.Berth;
            if (!string.Equals(view.FormationKey, formationKey, StringComparison.Ordinal)) return false;
            if (Math.Abs(view.Scale - scale) > 1e-4f) return false;
            if (cur.DirectionSign != next.DirectionSign ||
                cur.HasPlatform != next.HasPlatform ||
                cur.TrackDoorSides != next.TrackDoorSides ||
                cur.DoorBankMask != next.DoorBankMask ||
                cur.DefaultPlatformBank != next.DefaultPlatformBank ||
                cur.ThirdRailSide != next.ThirdRailSide) return false;
            if (Math.Abs(cur.HalfLength - next.HalfLength) > 1e-3f ||
                Math.Abs(cur.RailSurfaceZ - next.RailSurfaceZ) > 1e-3f ||
                Math.Abs(cur.CabinFloorDocumentZ - next.CabinFloorDocumentZ) > 1e-3f ||
                Math.Abs(cur.PlatformTopZ - next.PlatformTopZ) > 1e-3f) return false;
            if ((cur.DocumentPosition - next.DocumentPosition).sqrMagnitude > 1e-5f) return false;
            if ((cur.Facing - next.Facing).sqrMagnitude > 1e-5f) return false;
            return true;
        }

        static bool TryMatchExistingConsists(
            TrainConsistViews existingViews,
            StationDocument nextDocument,
            StationIndex nextIndex,
            TrainCatalogue catalogue,
            out Dictionary<string, TrainBerth> refreshedBerths) {
            refreshedBerths = null;
            if (existingViews == null || nextDocument == null || nextIndex == null || catalogue == null) return false;
            var curConsists = existingViews.Consists;
            var matched = new Dictionary<string, TrainBerth>(curConsists.Count, StringComparer.Ordinal);
            for (int l = 0; l < nextDocument.Lines.Count; l++) {
                var line = nextDocument.Lines[l];
                if (line == null || string.IsNullOrEmpty(line.Id)) continue;
                var formationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, catalogue);
                var tracks = TrainConsistGeometry.ServiceTracks(nextIndex, line.Id);
                if (tracks.Count == 0) continue;
                if (!catalogue.TryGet(formationKey, out var entry) || entry == null || entry.prefab == null) return false;
                float scale = entry.bakedScale > 0f ? entry.bakedScale : 1f;
                for (int t = 0; t < tracks.Count; t++) {
                    var track = tracks[t];
                    if (!TrainConsistGeometry.TryBerth(nextDocument, nextIndex, line, track, scale, out var berth, out _)) {
                        return false;
                    }
                    string trainId = line.Id + "|" + track.Id;
                    if (!existingViews.TryGet(trainId, out var curView) ||
                        !SameConsistStructure(curView, formationKey, scale, berth)) {
                        return false;
                    }
                    matched[trainId] = berth;
                }
            }
            if (matched.Count != curConsists.Count) return false;
            refreshedBerths = matched;
            return true;
        }

        sealed class StagedTrainRebuild : IStationLocalRendererStage {
            readonly TrainConsistRenderer owner;
            readonly WorldState state;
            readonly TrainConsistViews nextViews;
            readonly List<StationViewRecord> stagedRecords;
            bool committed;

            public StagedTrainRebuild(
                TrainConsistRenderer owner,
                WorldState state,
                TrainConsistViews nextViews,
                List<StationViewRecord> stagedRecords) {
                this.owner = owner;
                this.state = state;
                this.nextViews = nextViews;
                this.stagedRecords = stagedRecords;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                world.RetireRecordsWhere(r => r.Role == RoleName, commit, retireViewObjects: true);
                var oldViews = state.Views;
                if (oldViews != null) {
                    nextViews.LogDoorEvents = oldViews.LogDoorEvents;
                    oldViews.DisposeRetired(commit);
                }
                var roleRoot = world.RoleRoot(RoleName);
                var nextConsists = nextViews.Consists;
                for (int i = 0; i < nextConsists.Count; i++) {
                    var root = nextConsists[i]?.Root;
                    if (root != null && roleRoot != null) root.transform.SetParent(roleRoot, false);
                }
                for (int i = 0; i < stagedRecords.Count; i++) {
                    world.AddLocalRecord(stagedRecords[i], commit);
                }
                nextViews.AttachMarkListener();
                state.Views = nextViews;
                owner.ViewsGeneration++;
            }

            public void Dispose() {
                if (committed) return;
                nextViews?.Dispose();
                stagedRecords?.Clear();
            }
        }

        sealed class StagedTrainDelta : IStationLocalRendererStage {
            readonly TrainConsistRenderer owner;
            readonly WorldState state;
            readonly StationDocument nextDocument;
            readonly List<string> removedTrainIds;
            readonly Dictionary<string, TrainBerth> retainedBerths;
            readonly List<TrainConsistViews.StagedConsistEntry> addedConsists;
            readonly Dictionary<string, TrainConsistViews.StaticCombinedPart[]> workingCache;
            readonly List<Mesh> newMeshes;
            readonly Dictionary<string, Material> workingLivery;
            readonly List<Material> newLiveryMaterials;
            readonly bool refreshPresentation;
            bool committed;

            public StagedTrainDelta(
                TrainConsistRenderer owner,
                WorldState state,
                StationDocument nextDocument,
                List<string> removedTrainIds,
                Dictionary<string, TrainBerth> retainedBerths,
                List<TrainConsistViews.StagedConsistEntry> addedConsists,
                Dictionary<string, TrainConsistViews.StaticCombinedPart[]> workingCache,
                List<Mesh> newMeshes,
                Dictionary<string, Material> workingLivery,
                List<Material> newLiveryMaterials,
                bool refreshPresentation) {
                this.owner = owner;
                this.state = state;
                this.nextDocument = nextDocument;
                this.removedTrainIds = removedTrainIds;
                this.retainedBerths = retainedBerths;
                this.addedConsists = addedConsists;
                this.workingCache = workingCache;
                this.newMeshes = newMeshes;
                this.workingLivery = workingLivery;
                this.newLiveryMaterials = newLiveryMaterials;
                this.refreshPresentation = refreshPresentation;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (removedTrainIds != null && removedTrainIds.Count > 0) {
                    var removedRecordIds = new HashSet<string>(StringComparer.Ordinal);
                    for (int i = 0; i < removedTrainIds.Count; i++) removedRecordIds.Add("train:" + removedTrainIds[i]);
                    world.RetireRecordsWhere(r => r.Role == RoleName && removedRecordIds.Contains(r.ModuleId), commit, retireViewObjects: true);
                }
                var roleRoot = world.RoleRoot(RoleName);
                if (addedConsists != null) {
                    for (int i = 0; i < addedConsists.Count; i++) {
                        var root = addedConsists[i].View?.Root;
                        if (root != null && roleRoot != null) root.transform.SetParent(roleRoot, false);
                        if (addedConsists[i].Record != null) world.AddLocalRecord(addedConsists[i].Record, commit);
                    }
                }
                state.Views.CommitIncrementalDelta(
                    nextDocument,
                    removedTrainIds,
                    retainedBerths,
                    addedConsists,
                    workingCache,
                    newMeshes,
                    workingLivery,
                    newLiveryMaterials,
                    commit);
                if (refreshPresentation) {
                    state.Views.RefreshPresentation(nextDocument);
                }
                owner.ViewsGeneration++;
            }

            public void Dispose() {
                if (committed) return;
                if (addedConsists != null) {
                    for (int i = 0; i < addedConsists.Count; i++) {
                        var root = addedConsists[i].View?.Root;
                        if (root != null) {
                            if (Application.isPlaying) UnityEngine.Object.Destroy(root);
                            else UnityEngine.Object.DestroyImmediate(root);
                        }
                    }
                    addedConsists.Clear();
                }
                if (newMeshes != null) {
                    for (int i = 0; i < newMeshes.Count; i++) {
                        if (newMeshes[i] == null) continue;
                        if (Application.isPlaying) UnityEngine.Object.Destroy(newMeshes[i]);
                        else UnityEngine.Object.DestroyImmediate(newMeshes[i]);
                    }
                    newMeshes.Clear();
                }
                if (newLiveryMaterials != null) {
                    for (int i = 0; i < newLiveryMaterials.Count; i++) {
                        if (newLiveryMaterials[i] == null) continue;
                        if (Application.isPlaying) UnityEngine.Object.Destroy(newLiveryMaterials[i]);
                        else UnityEngine.Object.DestroyImmediate(newLiveryMaterials[i]);
                    }
                    newLiveryMaterials.Clear();
                }
            }
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            WorldState state = null;
            for (int i = worlds.Count - 1; i >= 0; i--) {
                if (worlds[i].World == context.World) { state = worlds[i]; break; }
            }
            if (state == null) {
                fallbackReason = "no-train-state";
                return false;
            }

            bool needsRebuild = context.LineStructureChanged;
            if (!needsRebuild) {
                var delta = context.Delta;
                for (int i = 0; i < delta.RemovedModules.Count; i++) {
                    if (context.PrevIndex.TryGetModule(delta.RemovedModules[i], out var oldMod) &&
                        oldMod != null && (oldMod.Type == "track" || oldMod.Type == "platform-edge")) {
                        needsRebuild = true;
                        break;
                    }
                }
            }
            if (!needsRebuild) {
                var delta = context.Delta;
                for (int i = 0; i < delta.ChangedModules.Count; i++) {
                    var mod = delta.ChangedModules[i];
                    if (mod != null && (mod.Type == "track" || mod.Type == "platform-edge")) {
                        needsRebuild = true;
                        break;
                    }
                }
            }

            if (needsRebuild) {
                if (!context.LineStructureChanged &&
                    !context.CityChanged &&
                    context.VisualChangedLineIds.Count == 0 &&
                    TryMatchExistingConsists(state.Views, context.NextDocument, context.NextIndex,
                        context.World.TrainCatalogue, out var refreshedBerths)) {
                    stage = new TrainBerthRefreshStage(this, state, context.NextDocument, refreshedBerths);
                    return true;
                }
                if (state.Views != null) {
                    var existingViews = state.Views;
                    var catalogue = context.World.TrainCatalogue;
                    var retainedBerths = new Dictionary<string, TrainBerth>(existingViews.Consists.Count, StringComparer.Ordinal);
                    var desiredIds = new HashSet<string>(StringComparer.Ordinal);
                    var addedConsists = new List<TrainConsistViews.StagedConsistEntry>();
                    var workingCache = existingViews.CloneStaticBodyCache();
                    var newMeshes = new List<Mesh>();
                    var workingLivery = existingViews.CloneLiveryMaterials();
                    var newLiveryMaterials = new List<Material>();
                    try {
                        var lines = context.NextDocument.Lines;
                        for (int l = 0; l < lines.Count; l++) {
                            var line = lines[l];
                            if (line == null || string.IsNullOrEmpty(line.Id)) continue;
                            var formationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, catalogue);
                            var tracks = TrainConsistGeometry.ServiceTracks(context.NextIndex, line.Id);
                            if (tracks.Count == 0) {
                                context.ReportUnresolved("train-no-track", "line", line.Id,
                                    "Line '" + line.Id + "' runs no saved track module, so no consist is drawn for it.");
                                continue;
                            }
                            bool hasEntry = false;
                            float scale = 1f;
                            if (catalogue != null && catalogue.TryGet(formationKey, out var entry) &&
                                entry != null && entry.prefab != null) {
                                hasEntry = true;
                                if (entry.bakedScale > 0f) scale = entry.bakedScale;
                            }
                            for (int t = 0; t < tracks.Count; t++) {
                                var track = tracks[t];
                                string trainId = line.Id + "|" + track.Id;
                                desiredIds.Add(trainId);
                                if (hasEntry &&
                                    existingViews.TryGet(trainId, out var curView) &&
                                    TrainConsistGeometry.TryBerth(context.NextDocument, context.NextIndex, line, track, scale, out var berth, out _) &&
                                    SameConsistStructure(curView, formationKey, scale, berth)) {
                                    retainedBerths[trainId] = berth;
                                    continue;
                                }
                                if (existingViews.TryStageSingleConsist(
                                        context.World, context.NextDocument, context.NextIndex,
                                        line, track, formationKey, catalogue, context.StagingRoot,
                                        context.ReportUnresolved,
                                        workingCache, newMeshes, workingLivery, newLiveryMaterials,
                                        out var stagedEntry)) {
                                    addedConsists.Add(stagedEntry);
                                }
                            }
                        }
                        var removedTrainIds = new List<string>();
                        var curList = existingViews.Consists;
                        for (int i = 0; i < curList.Count; i++) {
                            var cur = curList[i];
                            if (cur == null) continue;
                            if (!retainedBerths.ContainsKey(cur.TrainId)) {
                                removedTrainIds.Add(cur.TrainId);
                            }
                        }
                        bool refreshPres = context.CityChanged || context.VisualChangedLineIds.Count > 0;
                        stage = new StagedTrainDelta(
                            this, state, context.NextDocument,
                            removedTrainIds, retainedBerths, addedConsists,
                            workingCache, newMeshes, workingLivery, newLiveryMaterials,
                            refreshPres);
                        return true;
                    } catch {
                        for (int i = 0; i < addedConsists.Count; i++) {
                            var root = addedConsists[i].View?.Root;
                            if (root != null) {
                                if (Application.isPlaying) UnityEngine.Object.Destroy(root);
                                else UnityEngine.Object.DestroyImmediate(root);
                            }
                        }
                        for (int i = 0; i < newMeshes.Count; i++) {
                            if (newMeshes[i] == null) continue;
                            if (Application.isPlaying) UnityEngine.Object.Destroy(newMeshes[i]);
                            else UnityEngine.Object.DestroyImmediate(newMeshes[i]);
                        }
                        for (int i = 0; i < newLiveryMaterials.Count; i++) {
                            if (newLiveryMaterials[i] == null) continue;
                            if (Application.isPlaying) UnityEngine.Object.Destroy(newLiveryMaterials[i]);
                            else UnityEngine.Object.DestroyImmediate(newLiveryMaterials[i]);
                        }
                        throw;
                    }
                }
                var nextViews = new TrainConsistViews();
                var stagedRecords = new List<StationViewRecord>();
                try {
                    nextViews.StageBuild(
                        context.World,
                        context.NextDocument,
                        context.NextIndex,
                        context.StagingRoot,
                        context.ReportUnresolved,
                        stagedRecords);
                } catch {
                    nextViews.Dispose();
                    throw;
                }
                stage = new StagedTrainRebuild(this, state, nextViews, stagedRecords);
                return true;
            }

            if ((context.CityChanged || context.VisualChangedLineIds.Count > 0) && state.Views != null) {
                stage = new TrainPresentationStage(state, context.NextDocument);
            }
            return true;
        }

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
        /// <summary>Incremented whenever active consists are rebuilt so the frame sink snaps and mounts immediately.</summary>
        public int ViewsGeneration { get; private set; }

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

        /// <summary>Record per-event door presentation for the active world (off in the player).</summary>
        public bool LogDoorEvents {
            get { var state = ActiveState(); return state != null && state.Views.LogDoorEvents; }
            set { var state = ActiveState(); if (state != null) state.Views.LogDoorEvents = value; }
        }

        /// <summary>The active world's recorded door events, oldest first.</summary>
        public IReadOnlyList<TrainDoorEvent> DoorEvents {
            get { var state = ActiveState(); return state != null ? state.Views.DoorEvents : Array.Empty<TrainDoorEvent>(); }
        }

        public void ClearDoorEvents() { ActiveState()?.Views.ClearDoorEvents(); }

        public void RefreshPresentation(StationDocument document) {
            ActiveState()?.Views.RefreshPresentation(document);
        }

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            DropDisposedWorlds();
            var state = new WorldState {
                World = context.World, Context = context, Views = new TrainConsistViews(), Serial = ++serial,
            };
            worlds.Add(state);
            Current = this;
            ViewsGeneration++;
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
        public bool Apply(StationMotionFrame frame) => Apply(frame, 1f, false);

        /// <summary>Sample the frame at a presentation fraction (see <see cref="TrainConsistViews.Apply"/>).</summary>
        public bool Apply(StationMotionFrame frame, float alpha, bool resetHistory = false) {
            var state = ActiveState();
            if (state == null) return false;
            try {
                return state.Views.Apply(frame, alpha, resetHistory);
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
    /// `ModuleMotionFrameSink` uses (no host or scene edit).
    ///
    /// The source frame is refreshed on a fixed-tick boundary only; every rendered
    /// frame then samples it at the scheduler's presentation fraction, so an approach
    /// or departure moves continuously instead of once a simulated second (RCA 14 §5).
    /// A paused station has a frozen fraction, which is the identity and holds the last
    /// presented pose; a seek, restart or session switch drops the interpolation pair.
    /// </summary>
    sealed class TrainConsistFrameSink : IStationFrameSink {
        StationSimulationSession session;
        StationMotionFrame frame;
        long lastTick = long.MinValue;
        long lastEpoch = long.MinValue;
        int lastViewsGeneration = -1;
        bool hasFrame;

        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            var renderer = TrainConsistRenderer.Current;
            if (renderer == null || document == null) return;
            try {
                var host = StationGameHost.ResolveActive();
                if (host == null) return;
                var simHost = host.Simulation as StationSimulationHost;
                var published = simHost?.PublishedFrame;
                if (published == null) return;
                var live = simHost.Session;
                int viewsGen = renderer.ViewsGeneration;
                bool reset = !ReferenceEquals(live, session) || clock.Epoch != lastEpoch || viewsGen != lastViewsGeneration;
                if (reset) {
                    // A new session, invalidated history, or locally restaged consist set:
                    // snap to the frame's own pose instead of blending from a route the station no longer has.
                    session = live;
                    lastEpoch = clock.Epoch;
                    lastViewsGeneration = viewsGen;
                    lastTick = published.Tick;
                    frame = published.Motion;
                    hasFrame = true;
                    renderer.Apply(frame, 1f, true);
                    return;
                }
                if (!hasFrame || published.Tick != lastTick) {
                    frame = published.Motion;
                    lastTick = published.Tick;
                    hasFrame = true;
                }
                renderer.Apply(frame, (float)clock.Fraction, false);
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
