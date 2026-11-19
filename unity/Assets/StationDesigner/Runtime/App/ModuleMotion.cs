using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Metro.App.Views;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// State-driven motion on a generated or promoted module view. The builder
    /// registers the moving transforms once; the view supplies the published state
    /// (simulation seconds, door fraction, run fraction) each frame, so the same
    /// inputs always sample the same pose and pausing holds the current one.
    ///
    /// The parameters trace the TypeScript owners recorded in
    /// `unity/plan/motion-inventory.md`: `setGateWing`, the PSD leaf travel, the
    /// escalator step chain and the lift car's smoothstep.
    ///
    /// Each moving channel has its own typed sampler — <see cref="ApplyGate"/>,
    /// <see cref="ApplyScreen"/>, <see cref="ApplyBeltPhase"/>,
    /// <see cref="ApplyCabinFraction"/> and <see cref="ApplyClockSeconds"/> — and
    /// <see cref="ModuleMotionDispatch"/> feeds them from a published
    /// <see cref="StationMotionFrame"/>. The samplers stay public and unchanged in
    /// meaning so every existing caller (the legacy Zoo slice, `RuntimeAssemblies`)
    /// keeps working; the dispatch is the one place that translates a station frame
    /// into per-family state.
    /// </summary>
    public sealed class ModuleMotion : MonoBehaviour {
        public enum Kind { None, GateWings, ScreenDoors, EscalatorSteps, LiftCar, ClockHands }

        public Kind kind = Kind.None;
        /// <summary>
        /// Stable module id this component drives. A <see cref="ModuleMotionDispatch"/>
        /// addresses the component by this id; empty means the object was built outside a
        /// station load (the legacy slice) and cannot be frame-addressed.
        /// </summary>
        public string moduleId = "";
        /// <summary>Distance a door leaf travels between closed and open, in metres.</summary>
        public float leafTravel;
        /// <summary>Leaf width at the closed pose, for the fan-wing scale.</summary>
        public float leafWidth;
        /// <summary>Gate wing pivots: an inner edge and a sign per leaf.</summary>
        public float[] leafEdges = System.Array.Empty<float>();
        public float[] leafSigns = System.Array.Empty<float>();
        public Transform[] leaves = System.Array.Empty<Transform>();
        public Vector3[] leavesClosed = System.Array.Empty<Vector3>();
        public Transform[] steps = System.Array.Empty<Transform>();
        public Vector3 beltClosed, beltDirection;
        public float stepPitch, loopMetres, speed = .5f, direction = 1f;
        public Transform cabin;
        public float[] cabinStops = System.Array.Empty<float>();
        public float pauseSeconds = 8f;
        /// <summary>Clock pose: seconds since midnight, mirrored on both faces.</summary>
        public float clockSeconds = 36540f;

        /// <summary>The builder's authored analogue-clock pose, 10:09 (`CLOCK_POSE_SECONDS`).</summary>
        public const float AuthoredClockSeconds = 36540f;

        float phase;

        /// <summary>
        /// The legacy combined entry: `seconds` drives the belt and the lift cycle,
        /// `doorFraction` drives the gate wings and the screen leaves. Kept for the
        /// existing slice callers; the frame dispatch uses the typed samplers below.
        /// </summary>
        public void Apply(float seconds, float doorFraction, int directionSign) {
            switch (kind) {
                case Kind.GateWings: ApplyGate(Mathf.Clamp01(doorFraction)); break;
                case Kind.ScreenDoors: ApplyScreen(Mathf.Clamp01(doorFraction)); break;
                case Kind.EscalatorSteps: ApplyBelt(seconds); break;
                case Kind.LiftCar: ApplyCar(seconds); break;
                case Kind.ClockHands: ApplyClock(); break;
            }
        }

        /* ------------------------------------------------- typed family samplers */

        /// <summary>`setGateWing`: the leaves compress into the machine and park at their jambs.</summary>
        public void ApplyGate(float open) {
            // `setGateWing`: the leaves retract to a thin edge inside the machine.
            for (int i = 0; i < leaves.Length; i++) {
                var leaf = leaves[i];
                if (!leaf) continue;
                float full = Mathf.Approximately(leafWidth, 0f) ? .35f : leafWidth;
                float width = full * (1f - open) + .025f * open;
                var scale = leaf.localScale;
                scale.x = width / full;
                leaf.localScale = scale;
                var position = leavesClosed[i];
                float edge = i < leafEdges.Length ? leafEdges[i] : 0f;
                float sign = i < leafSigns.Length ? leafSigns[i] : 1f;
                position.x = edge + sign * width * .5f;
                leaf.localPosition = position;
            }
        }

        /// <summary>One screen-run fraction: every leaf retracts toward its own jamb by `leafTravel`.</summary>
        public void ApplyScreen(float open) {
            // Each leaf retracts toward its own jamb by `leafTravel`.
            for (int i = 0; i < leaves.Length; i++) {
                var leaf = leaves[i];
                if (!leaf) continue;
                var closed = leavesClosed[i];
                leaf.localPosition = closed + new Vector3((i % 2 == 0 ? -1f : 1f) * leafTravel * open, 0f, 0f);
            }
        }

        /// <summary>
        /// Seat the belt at an absolute phase in metres (`rollEscalator`'s `roll.phase`).
        /// A frame publishes the phase directly, so this is the sampler the dispatch calls;
        /// <see cref="Apply(float,float,int)"/> keeps integrating it from sim seconds.
        /// </summary>
        public void ApplyBeltPhase(float phaseMetres, int directionSign) {
            if (steps.Length == 0) return;
            if (loopMetres > 0f) phaseMetres = Mathf.Repeat(phaseMetres, loopMetres);
            phase = phaseMetres;
            if (steps.Length == 1) {
                // One combined band: a uniform tread pitch makes a shift of less than one
                // pitch read as continuous travel, so the band can wrap without a seam.
                var band = steps[0];
                if (!band) return;
                float shift = stepPitch > 0f ? Mathf.Repeat(phase, stepPitch) : 0f;
                band.localPosition = beltClosed + beltDirection * shift;
                return;
            }
            for (int i = 0; i < steps.Length; i++) {
                var step = steps[i];
                if (!step) continue;
                float u = Mathf.Repeat(i * stepPitch + phase, loopMetres);
                var position = step.localPosition;
                position.x = u;
                step.localPosition = position;
            }
        }

        /// <summary>Absolute belt phase in metres, as last sampled.</summary>
        public float PhaseMetres => phase;

        /// <summary>
        /// Place the cabin at a fraction of its shaft: 0 the bottom stop, 1 the top.
        /// `ModuleMotionState.CabinFraction` publishes exactly this number; the
        /// endpoint/dwell cycle in <see cref="Apply(float,float,int)"/> stays the
        /// fallback when no frame supplies one.
        /// </summary>
        public void ApplyCabinFraction(float fraction) {
            if (!cabin || cabinStops.Length < 2) return;
            float clamped = Mathf.Clamp01(fraction);
            float bottom = cabinStops[0], top = cabinStops[cabinStops.Length - 1];
            var position = cabin.localPosition;
            position.y = Mathf.Lerp(bottom, top, clamped);
            cabin.localPosition = position;
        }

        /// <summary>
        /// Repose the two analogue hands from seconds since midnight (`clockHandAngles`).
        /// Both faces of a double-faced clock hang from the same pivot pair.
        /// </summary>
        public void ApplyClockSeconds(float seconds) {
            clockSeconds = seconds;
            ApplyClock();
        }

        void ApplyBelt(float seconds) {
            if (steps.Length == 0 || loopMetres <= 0f) return;
            ApplyBeltPhase(direction * speed * Mathf.Max(0f, seconds), 1);
        }

        void ApplyCar(float seconds) {
            if (!cabin || cabinStops.Length < 2) return;
            float cycle = 0f;
            int segment = 0;
            // One stop per `pauseSeconds` plus the travel between consecutive stops.
            for (int i = 0; i + 1 < cabinStops.Length; i++) {
                float travel = Mathf.Abs(cabinStops[i + 1] - cabinStops[i]) / 1.5f;
                if (seconds < cycle + pauseSeconds) { segment = i; break; }
                cycle += pauseSeconds;
                if (seconds < cycle + travel) {
                    float k = (seconds - cycle) / travel;
                    k = k * k * (3f - 2f * k);
                    var p = cabin.localPosition;
                    p.y = Mathf.Lerp(cabinStops[i], cabinStops[i + 1], k);
                    cabin.localPosition = p;
                    return;
                }
                cycle += travel;
                segment = i;
            }
            var hold = cabin.localPosition;
            hold.y = cabinStops[Mathf.Clamp(segment, 0, cabinStops.Length - 1)];
            cabin.localPosition = hold;
        }

        void ApplyClock() {
            // `clockHandAngles`: hour = (t mod 43200) / 3600 * 30, minute = (t mod 3600) / 60 * 6.
            if (leaves.Length < 2 || !leaves[0] || !leaves[1]) return;
            float t = clockSeconds;
            float hour = Mathf.Repeat(t, 43200f) / 3600f * 30f;
            float minute = Mathf.Repeat(t, 3600f) / 60f * 6f;
            leaves[0].localRotation = Quaternion.Euler(0f, 0f, -hour);
            leaves[1].localRotation = Quaternion.Euler(0f, 0f, -minute);
        }

        /// <summary>
        /// The authored reset pose: doors shut, belt seated at phase 0, cabin at its
        /// bottom stop, clock back to 10:09. Every write is the same arithmetic a
        /// sample of 0 performs, so a reset is exact (no accumulated residual).
        /// </summary>
        public void ResetPose() {
            switch (kind) {
                case Kind.GateWings: ApplyGate(0f); break;
                case Kind.ScreenDoors: ApplyScreen(0f); break;
                case Kind.EscalatorSteps: ApplyBeltPhase(0f, 1); break;
                case Kind.LiftCar: ApplyCabinFraction(0f); break;
                case Kind.ClockHands: ApplyClockSeconds(AuthoredClockSeconds); break;
            }
        }

        /// <summary>True when the kind carries a channel a station frame publishes.</summary>
        public bool IsFrameDriven {
            get {
                switch (kind) {
                    case Kind.EscalatorSteps: return true;
                    case Kind.LiftCar: return true;
                    case Kind.ClockHands: return true;
                    default: return false; // gate wings / screen leaves are fed by an opening view
                }
            }
        }
    }

    /// <summary>
    /// The moving families one station frame drives. The names follow the source's
    /// own parts, not the module types, so a stair and a tree are both static while a
    /// lift cabin and its doors are one moving family with two channels.
    /// </summary>
    public enum ModuleMotionFamily {
        None = 0,
        /// <summary>A flight of stairs: no channel in the source, checked for staying put.</summary>
        Stair = 1,
        Escalator = 2,
        Walkway = 3,
        /// <summary>Lift car and its landing/cabin door banks.</summary>
        Lift = 4,
        /// <summary>Platform screen doors: one fraction per platform edge.</summary>
        ScreenDoors = 5,
        /// <summary>Fare-gate lane wings.</summary>
        GateWings = 6,
        /// <summary>A standing/room door or a cubicle leaf, swinging about its hinge.</summary>
        SwingDoor = 7,
        /// <summary>A consist's two door banks, keyed by `lineId|trackId`.</summary>
        TrainDoors = 8,
        Clock = 9,
    }

    /// <summary>Which published channel feeds a binding, and whether one exists yet.</summary>
    public enum ModuleMotionChannel {
        None = 0,
        /// <summary>`StationMotionFrame.Escalators` (metres rolled, direction, speed).</summary>
        FrameEscalators = 1,
        /// <summary>`StationMotionFrame.Lifts` (stop index, door fraction, phase).</summary>
        FrameLifts = 2,
        /// <summary>`StationMotionFrame.Doors` (per platform edge, from its berthing consist).</summary>
        FrameDoors = 3,
        /// <summary>`StationMotionFrame.Trains` (per `lineId|trackId`).</summary>
        FrameTrains = 4,
        /// <summary>`StationMotionFrame.Clock` (hands and sim seconds).</summary>
        FrameClock = 5,
        /// <summary>
        /// The family moves in the source but the session publishes no channel for it yet
        /// (a legacy gate/swing binding before the crowd channel lands). The binding exists
        /// and <see cref="ModuleMotionDispatch.ApplyOpening"/> can drive it.
        /// </summary>
        PendingCrowd = 6,
        /// <summary>The source has no motion channel at all (stairs, fixed fences, trees, fixed PSD ends).</summary>
        StaticSource = 7,
        /// <summary>`StationMotionFrame.Gates` (per gate module, from its served passengers).</summary>
        FrameGates = 8,
        /// <summary>`StationMotionFrame.Passengers` proximity (a swing door's own occupancy rule).</summary>
        FrameCrowd = 9,
    }

    /// <summary>
    /// Two consecutive samples of one binding's published channels. The frame carries
    /// the current value; the previous one is kept so a caller that knows its
    /// interpolation fraction can smooth a 1 Hz frame into the render frame, exactly
    /// as `alpha` does in the TypeScript scene systems. A sample of the same frame
    /// twice is the identity, which is what makes a pause exact.
    /// </summary>
    public struct ModuleMotionSample {
        public bool HasSample;
        /// <summary>Belt phase in metres (`StationEscalatorFrame.PhaseMeters`).</summary>
        public double PreviousPhase, Phase;
        /// <summary>True when the phase crossed the loop seam between the two samples.</summary>
        public bool PhaseWrapped;
        /// <summary>Leaf fraction 0 shut … 1 open (PSD, gate, swing, train bank).</summary>
        public float PreviousDoor, Door;
        /// <summary>Cabin fraction 0 bottom … 1 top.</summary>
        public float PreviousCabin, Cabin;
        /// <summary>Sim seconds since midnight (analogue clock).</summary>
        public double PreviousClock, Clock;
        /// <summary>+1 the authored travel, −1 reversed, 0 stopped.</summary>
        public int Direction;
        /// <summary>The clock was playing when this sample was taken.</summary>
        public bool Running;
        /// <summary>
        /// The fixed simulation tick the current endpoints were taken from, and the
        /// service run they belong to. The history is keyed by **tick**, not by value:
        /// a repeated render of the same tick must leave both endpoints alone even when
        /// the published value has not changed (otherwise a dwell tick whose fraction
        /// repeated would keep re-playing the previous tick's travel).
        /// </summary>
        public long Tick;
        /// <summary>The service sequence of the current endpoints (0 when the channel has none).</summary>
        public int ServiceSequence;
        /// <summary>Set by a direct `ApplyOpening` push so it always starts a new sample.</summary>
        public long PushSerial;

        public override string ToString() {
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            text.Append("phase=").Append(Phase.ToString("0.###", id));
            if (PhaseWrapped) text.Append("(wrapped)");
            text.Append(" door=").Append(Door.ToString("0.###", id));
            text.Append(" cabin=").Append(Cabin.ToString("0.###", id));
            text.Append(" dir=").Append(Direction);
            if (!Running) text.Append(" paused");
            return text.ToString();
        }
    }

    /// <summary>What one binding did with the frames it was given.</summary>
    public struct ModuleMotionProbe {
        public string Id;
        public ModuleMotionFamily Family;
        public ModuleMotionChannel Channel;
        /// <summary>True when the dispatcher holds a target for this id.</summary>
        public bool Bound;
        /// <summary>How many times a frame (or a direct opening state) drove it.</summary>
        public int Applied;
        /// <summary>
        /// Metres of leaf/cabin travel plus hinge degrees measured from the driven
        /// transforms. 0 for a static family and for a moving part held at rest.
        /// </summary>
        public float Moved;
        public float Door;
        public double Phase;
        public int Direction;
        public override string ToString() =>
            Id + " " + Family + " " + Channel + (Bound ? "" : " unbound") +
            " applied=" + Applied + " moved=" + Moved.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The one dispatch from a published <see cref="StationMotionFrame"/> to every
    /// moving family. It holds one binding per module/train id and the previous and
    /// current value of the binding's channel, so:
    /// <list type="bullet">
    /// <item>nothing reads a wall clock — a paused frame (same values) samples the same
    /// pose exactly, at any real time;</item>
    /// <item><see cref="Reset"/> writes the authored shut pose with the same arithmetic
    /// as a sample of 0, so it leaves no residual;</item>
    /// <item>a state for one id never moves another id's parts (each binding is
    /// addressed by its own stable id).</item>
    /// </list>
    /// The typed samplers it calls are the existing per-family APIs —
    /// <see cref="VerticalModuleView.Apply(ModuleMotionState)"/>,
    /// <see cref="OpeningView.Apply(OpeningState)"/>, <see cref="TrainDoorRig.Apply(float)"/>
    /// and the <see cref="ModuleMotion"/> component's own samplers — so no family's
    /// behaviour changes here.
    /// </summary>
    public sealed class ModuleMotionDispatch {
        sealed class ProbeNode {
            public Transform Node;
            public Vector3 Rest;
            public float RestAngle;
        }

        sealed class Binding {
            public string Id;
            public ModuleMotionFamily Family;
            public ModuleMotionChannel Channel;
            public VerticalModuleView Vertical;
            public OpeningView Opening;
            public ModuleMotion Legacy;
            public TrainDoorRig Train;
            public int TrainBank = 1;
            public ModuleMotionSample Sample;
            public int Applied;
            public float Moved;
            public List<ProbeNode> Probe;
            public string Detail = "";
        }

        readonly List<Binding> bindings = new List<Binding>();
        readonly Dictionary<string, Binding> byId = new Dictionary<string, Binding>(StringComparer.Ordinal);

        /// <summary>Bindings held (one per module or train id).</summary>
        public int Count => bindings.Count;
        /// <summary>Bindings backed by a published frame channel.</summary>
        public int FedCount {
            get {
                int count = 0;
                for (int i = 0; i < bindings.Count; i++) if (IsFrameChannel(bindings[i].Channel)) count++;
                return count;
            }
        }
        public IReadOnlyList<string> Ids {
            get {
                var ids = new List<string>(bindings.Count);
                for (int i = 0; i < bindings.Count; i++) ids.Add(bindings[i].Id);
                return ids;
            }
        }

        /* ------------------------------------------------------------- binding */

        /// <summary>Bind one built vertical view (stair, escalator, walkway or lift).</summary>
        public bool Bind(VerticalModuleView view) {
            if (view == null || string.IsNullOrEmpty(view.ModuleId)) return false;
            var family = FamilyOf(view.Kind);
            var binding = Add(view.ModuleId, family, view: view);
            binding.Channel = ChannelOf(view);
            if (view.Band != null) binding.Detail = "band chain=" + view.Band.ChainLength.ToString("0.###", CultureInfo.InvariantCulture);
            else if (view.Lift != null) binding.Detail = "lift stops=" + view.Lift.Stops.Count + " height=" + view.Lift.Height.ToString("0.###", CultureInfo.InvariantCulture);
            return true;
        }

        /// <summary>Bind one built opening view (screen run, gate, standing door or cubicle).</summary>
        public bool Bind(OpeningView view) {
            if (view == null || string.IsNullOrEmpty(view.ModuleId)) return false;
            var family = FamilyOf(view.Kind);
            var binding = Add(view.ModuleId, family, opening: view);
            binding.Channel = ChannelOf(view);
            binding.Detail = "openings=" + view.OpeningCount + " leaves=" + view.Leaves.Count +
                (view.Movable ? " movable" : " fixed");
            return true;
        }

        /// <summary>
        /// Bind a legacy <see cref="ModuleMotion"/> component by its own
        /// <see cref="ModuleMotion.moduleId"/>. The component was built by the old
        /// slice's assembler, so it is only addressable once its id is set.
        /// </summary>
        public bool Bind(ModuleMotion motion) {
            if (motion == null || string.IsNullOrEmpty(motion.moduleId)) return false;
            var family = FamilyOf(motion.kind);
            var binding = Add(motion.moduleId, family, legacy: motion);
            binding.Channel = LegacyChannelOf(motion.kind);
            binding.Detail = "legacy:" + motion.kind;
            return true;
        }

        /// <summary>Bind a consist's door rig, keyed by the frame's `lineId|trackId`.</summary>
        public bool BindTrain(string trainId, TrainDoorRig rig, int bank = 1) {
            if (rig == null || string.IsNullOrEmpty(trainId)) return false;
            var binding = Add(trainId, ModuleMotionFamily.TrainDoors, train: rig);
            binding.TrainBank = bank >= 0 ? 1 : -1;
            binding.Channel = ModuleMotionChannel.FrameTrains;
            binding.Detail = "leaves=" + rig.Leaves + " doors=" + rig.Doors + " bank=" + binding.TrainBank +
                " anchors=" + rig.LineAnchors.Describe();
            return true;
        }

        Binding Add(string id, ModuleMotionFamily family, VerticalModuleView view = null, OpeningView opening = null,
            ModuleMotion legacy = null, TrainDoorRig train = null) {
            if (byId.TryGetValue(id, out var existing)) {
                // Re-binding the same id replaces the target, not the sample: a view instance
                // is rebuilt on a station switch while its id stays stable.
                existing.Vertical = view ?? existing.Vertical;
                existing.Opening = opening ?? existing.Opening;
                existing.Legacy = legacy ?? existing.Legacy;
                existing.Train = train ?? existing.Train;
                existing.Family = family == ModuleMotionFamily.None ? existing.Family : family;
                return existing;
            }
            var binding = new Binding {
                Id = id, Family = family, Channel = ModuleMotionChannel.None,
                Vertical = view, Opening = opening, Legacy = legacy, Train = train,
            };
            bindings.Add(binding);
            byId[id] = binding;
            return binding;
        }

        static ModuleMotionFamily FamilyOf(VerticalModuleKind kind) {
            switch (kind) {
                case VerticalModuleKind.Stair: return ModuleMotionFamily.Stair;
                case VerticalModuleKind.Escalator: return ModuleMotionFamily.Escalator;
                case VerticalModuleKind.Walkway: return ModuleMotionFamily.Walkway;
                case VerticalModuleKind.Lift: return ModuleMotionFamily.Lift;
                default: return ModuleMotionFamily.None;
            }
        }

        static ModuleMotionFamily FamilyOf(OpeningKind kind) {
            switch (kind) {
                case OpeningKind.PsdRun: return ModuleMotionFamily.ScreenDoors;
                case OpeningKind.Gate: return ModuleMotionFamily.GateWings;
                case OpeningKind.SwingDoor:
                case OpeningKind.Cubicle: return ModuleMotionFamily.SwingDoor;
                default: return ModuleMotionFamily.None; // fixed screen end / cover
            }
        }

        static ModuleMotionFamily FamilyOf(ModuleMotion.Kind kind) {
            switch (kind) {
                case ModuleMotion.Kind.GateWings: return ModuleMotionFamily.GateWings;
                case ModuleMotion.Kind.ScreenDoors: return ModuleMotionFamily.ScreenDoors;
                case ModuleMotion.Kind.EscalatorSteps: return ModuleMotionFamily.Escalator;
                case ModuleMotion.Kind.LiftCar: return ModuleMotionFamily.Lift;
                case ModuleMotion.Kind.ClockHands: return ModuleMotionFamily.Clock;
                default: return ModuleMotionFamily.None;
            }
        }

        static ModuleMotionChannel ChannelOf(VerticalModuleView view) {
            switch (view.Kind) {
                case VerticalModuleKind.Escalator:
                case VerticalModuleKind.Walkway: return ModuleMotionChannel.FrameEscalators;
                case VerticalModuleKind.Lift: return ModuleMotionChannel.FrameLifts;
                default: return ModuleMotionChannel.StaticSource;
            }
        }

        static ModuleMotionChannel ChannelOf(OpeningView view) {
            switch (view.Kind) {
                case OpeningKind.PsdRun: return ModuleMotionChannel.FrameDoors;
                case OpeningKind.Gate: return ModuleMotionChannel.FrameGates;
                case OpeningKind.SwingDoor:
                case OpeningKind.Cubicle: return ModuleMotionChannel.FrameCrowd;
                default: return ModuleMotionChannel.PendingCrowd;
            }
        }

        static ModuleMotionChannel LegacyChannelOf(ModuleMotion.Kind kind) {
            switch (kind) {
                case ModuleMotion.Kind.EscalatorSteps: return ModuleMotionChannel.FrameEscalators;
                case ModuleMotion.Kind.LiftCar: return ModuleMotionChannel.FrameLifts;
                case ModuleMotion.Kind.ClockHands: return ModuleMotionChannel.FrameClock;
                // A legacy gate waits for its module's binding to be driven directly; a
                // legacy screen run has no published platform id either.
                case ModuleMotion.Kind.GateWings: return ModuleMotionChannel.FrameGates;
                case ModuleMotion.Kind.ScreenDoors: return ModuleMotionChannel.PendingCrowd;
                default: return ModuleMotionChannel.StaticSource;
            }
        }

        static bool IsFrameChannel(ModuleMotionChannel channel) {
            switch (channel) {
                case ModuleMotionChannel.FrameEscalators:
                case ModuleMotionChannel.FrameLifts:
                case ModuleMotionChannel.FrameDoors:
                case ModuleMotionChannel.FrameTrains:
                case ModuleMotionChannel.FrameGates:
                case ModuleMotionChannel.FrameCrowd:
                case ModuleMotionChannel.FrameClock: return true;
                default: return false;
            }
        }

        /* -------------------------------------------------------------- driving */

        /// <summary>Drive every binding from one frame at full weight (the paused/settled pose).</summary>
        public int Apply(StationMotionFrame frame) => Apply(frame, 1f);

        /// <summary>
        /// Drive every binding from one frame, interpolating each channel from its
        /// previous sample by <paramref name="alpha"/> (`0` the previous sample, `1` this
        /// one). An endpoint sample is exact: `alpha` 1 writes the frame's own value, not
        /// a lerp that happens to round to it. Returns how many bindings a channel drove.
        /// </summary>
        public int Apply(StationMotionFrame frame, float alpha) {
            if (alpha < 0f) alpha = 0f;
            else if (alpha > 1f) alpha = 1f;
            var escalators = IndexEscalators(frame.Escalators);
            var lifts = IndexLifts(frame.Lifts);
            var doors = IndexDoors(frame.Doors);
            var trains = IndexTrains(frame.Trains);
            var gates = IndexGates(frame.Gates);
            long tick = frame.Clock.Tick;
            bool playing = frame.Clock.Playing;
            int applied = 0;
            for (int i = 0; i < bindings.Count; i++) {
                var binding = bindings[i];
                switch (binding.Family) {
                    case ModuleMotionFamily.Escalator:
                    case ModuleMotionFamily.Walkway: {
                        if (!escalators.TryGetValue(binding.Id, out var sample)) break;
                        binding.Channel = ModuleMotionChannel.FrameEscalators;
                        PushPhase(binding, sample.PhaseMeters, sample.Direction, playing, ChainOf(binding));
                        DriveBelt(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.Lift: {
                        if (!lifts.TryGetValue(binding.Id, out var sample)) break;
                        binding.Channel = ModuleMotionChannel.FrameLifts;
                        float cabin = sample.StopCount > 1
                            ? Mathf.Clamp01(sample.Stop / (float)(sample.StopCount - 1))
                            : 0f;
                        if (binding.Vertical != null && sample.HasCarElevation) {
                            var stops = binding.Vertical.Stops;
                            if (stops.Count > 1) cabin = Mathf.Clamp01((float)((sample.Z - stops[0]) / (stops[stops.Count - 1] - stops[0])));
                        }
                        PushRanges(binding, cabin, (float)sample.DoorFraction, playing, tick);
                        DriveLift(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.ScreenDoors: {
                        if ((binding.Opening == null && binding.Legacy == null) || !doors.TryGetValue(binding.Id, out var sample)) break;
                        binding.Channel = ModuleMotionChannel.FrameDoors;
                        // The PSD and the berthing consist read the same door fraction on the
                        // same tick, so a platform leaf and its train leaf cannot disagree.
                        PushRanges(binding, binding.Sample.Cabin, (float)sample.DoorFraction, playing, tick);
                        DriveOpening(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.TrainDoors: {
                        if (binding.Train == null || !trains.TryGetValue(binding.Id, out var sample)) break;
                        binding.Channel = ModuleMotionChannel.FrameTrains;
                        PushRanges(binding, binding.Sample.Cabin, (float)sample.DoorFraction, playing, tick,
                            sample.ServiceSequence);
                        DriveTrain(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.Clock: {
                        double seconds = frame.Clock.SimTimeSeconds;
                        if (double.IsNaN(seconds) || double.IsInfinity(seconds)) seconds = frame.Clock.TimeOfDaySeconds;
                        PushClock(binding, seconds, playing);
                        DriveClock(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.GateWings: {
                        if (!gates.TryGetValue(binding.Id, out var gate)) break;
                        // A fence machine carries no lane; its binding is still addressable
                        // for the report, but a frame must not pretend to drive a fixed part.
                        if (binding.Opening != null && !binding.Opening.Movable) break;
                        binding.Channel = ModuleMotionChannel.FrameGates;
                        // The gate server owns the lane and its leaf cycle: the published
                        // fraction is the service's own open/hold/shut curve, not a guess
                        // from how near anybody happens to be standing.
                        PushRanges(binding, binding.Sample.Cabin, Mathf.Clamp01((float)gate.Open), playing, tick);
                        DriveOpening(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.SwingDoor: {
                        if (binding.Opening == null || !binding.Opening.Movable) break;
                        binding.Channel = ModuleMotionChannel.FrameCrowd;
                        PushRanges(binding, binding.Sample.Cabin, SwingTarget(binding, frame.Passengers), playing, tick);
                        DriveOpening(binding, alpha);
                        applied++;
                        break;
                    }
                    case ModuleMotionFamily.Stair:
                        break; // static in the source; nothing to drive, nothing to fake
                }
            }
            return applied;
        }

        /// <summary>
        /// Drive one bound opening module directly — the seam a test or a non-frame owner
        /// uses for one gate lane or swing leaf. Refuses an id the dispatcher does not hold.
        /// Every call starts a new sample (the caller is the authority for this push).
        /// </summary>
        public bool ApplyOpening(string moduleId, float fraction) {
            if (string.IsNullOrEmpty(moduleId) || !byId.TryGetValue(moduleId, out var binding)) return false;
            if (binding.Opening == null && binding.Legacy == null) return false;
            var sample = binding.Sample;
            sample.PushSerial++;
            binding.Sample = sample;
            PushRanges(binding, binding.Sample.Cabin, Mathf.Clamp01(fraction), true,
                long.MinValue + binding.Sample.PushSerial, 0);
            binding.Channel = binding.Family == ModuleMotionFamily.ScreenDoors
                ? ModuleMotionChannel.FrameDoors
                : binding.Family == ModuleMotionFamily.GateWings ? ModuleMotionChannel.FrameGates
                : ModuleMotionChannel.PendingCrowd;
            DriveOpening(binding, 1f);
            binding.Applied++;
            return true;
        }

        /// <summary>Return every binding to the authored shut pose and forget its samples.</summary>
        public void Reset() {
            for (int i = 0; i < bindings.Count; i++) {
                var binding = bindings[i];
                binding.Sample = default;
                binding.Applied = 0;
                binding.Moved = 0f;
                binding.Probe = null;
                if (binding.Vertical != null) {
                    switch (binding.Vertical.Kind) {
                        case VerticalModuleKind.Escalator:
                        case VerticalModuleKind.Walkway:
                            binding.Vertical.Apply(new ModuleMotionState {
                                ModuleId = binding.Id, Seconds = 0, Running = true, DirectionSign = 1,
                                CabinFraction = float.NaN, DoorFraction = float.NaN,
                                PhaseMeters = 0, CabinHeight = double.NaN,
                            });
                            break;
                        case VerticalModuleKind.Lift:
                            binding.Vertical.Apply(ModuleMotionState.Lift(binding.Id, 0f, 0f));
                            break;
                    }
                }
                binding.Opening?.Apply(OpeningState.Shut);
                binding.Train?.Reset();
                binding.Legacy?.ResetPose();
            }
        }

        /// <summary>What one binding did; a probe for an unknown id is unbound.</summary>
        public ModuleMotionProbe Probe(string id) {
            var probe = new ModuleMotionProbe { Id = id ?? "" };
            if (string.IsNullOrEmpty(id) || !byId.TryGetValue(id, out var binding)) return probe;
            probe.Family = binding.Family;
            probe.Channel = binding.Channel;
            probe.Bound = true;
            probe.Applied = binding.Applied;
            probe.Moved = binding.Moved;
            probe.Door = binding.Sample.Door;
            probe.Phase = binding.Sample.Phase;
            probe.Direction = binding.Sample.Direction;
            return probe;
        }

        public IReadOnlyList<ModuleMotionProbe> Probes() {
            var probes = new List<ModuleMotionProbe>(bindings.Count);
            for (int i = 0; i < bindings.Count; i++) probes.Add(Probe(bindings[i].Id));
            return probes;
        }

        /// <summary>The channel a binding is fed by, or `None` when the id is unknown.</summary>
        public ModuleMotionChannel ChannelOf(string id) =>
            !string.IsNullOrEmpty(id) && byId.TryGetValue(id, out var binding) ? binding.Channel : ModuleMotionChannel.None;

        /// <summary>True when the dispatcher holds a target for this module/train id.</summary>
        public bool IsBound(string id) => !string.IsNullOrEmpty(id) && byId.ContainsKey(id);

        /// <summary>Drop every binding (a world switch rebinding the same ids).</summary>
        public void Clear() {
            bindings.Clear();
            byId.Clear();
        }

        /// <summary>
        /// Forget the previous/current interpolation pair without touching the pose the
        /// parts currently hold. A seek, a restart or a station switch invalidates the
        /// history: the next frame must snap to its own value rather than blend from a
        /// position the station no longer has (RCA 14 §5.2).
        /// </summary>
        public void ForgetSamples() {
            for (int i = 0; i < bindings.Count; i++) bindings[i].Sample = default;
        }

        public string Describe() =>
            "bindings=" + Count + " fed=" + FedCount + " moved=" +
            bindings.FindAll(binding => binding.Moved > 1e-4f).Count;

        /* ------------------------------------------------------------ internals */

        static Dictionary<string, StationEscalatorFrame> IndexEscalators(StationEscalatorFrame[] frames) {
            var index = new Dictionary<string, StationEscalatorFrame>(StringComparer.Ordinal);
            if (frames == null) return index;
            for (int i = 0; i < frames.Length; i++)
                if (!string.IsNullOrEmpty(frames[i].Id)) index[frames[i].Id] = frames[i];
            return index;
        }

        static Dictionary<string, StationLiftFrame> IndexLifts(StationLiftFrame[] frames) {
            var index = new Dictionary<string, StationLiftFrame>(StringComparer.Ordinal);
            if (frames == null) return index;
            for (int i = 0; i < frames.Length; i++)
                if (!string.IsNullOrEmpty(frames[i].Id)) index[frames[i].Id] = frames[i];
            return index;
        }

        static Dictionary<string, StationDoorFrame> IndexDoors(StationDoorFrame[] frames) {
            var index = new Dictionary<string, StationDoorFrame>(StringComparer.Ordinal);
            if (frames == null) return index;
            for (int i = 0; i < frames.Length; i++)
                if (!string.IsNullOrEmpty(frames[i].PlatformId)) index[frames[i].PlatformId] = frames[i];
            return index;
        }

        static Dictionary<string, StationTrainFrame> IndexTrains(StationTrainFrame[] frames) {
            var index = new Dictionary<string, StationTrainFrame>(StringComparer.Ordinal);
            if (frames == null) return index;
            for (int i = 0; i < frames.Length; i++)
                if (!string.IsNullOrEmpty(frames[i].Id)) index[frames[i].Id] = frames[i];
            return index;
        }

        static Dictionary<string, StationGateFrame> IndexGates(StationGateFrame[] frames) {
            var index = new Dictionary<string, StationGateFrame>(StringComparer.Ordinal);
            if (frames == null) return index;
            for (int i = 0; i < frames.Length; i++)
                if (!string.IsNullOrEmpty(frames[i].Id)) index[frames[i].Id] = frames[i];
            return index;
        }

        /// <summary>The source's swing-door radius and storey tolerance (`CrowdSystem`).</summary>
        const float SwingReach = 1.25f;
        const float SwingStorey = .5f;
        const float CubicleOccupiedRadius = .35f;

        /// <summary>
        /// Port of `CrowdSystem.detectGateCrossings`' swing-door half: a leaf opens while a
        /// walking body stands within 1.25 m of it on its own storey, and a cubicle stays
        /// shut while somebody is inside it. Read from the published passenger frames, so
        /// the fixed-tick service remains the one authority and no scene guess is needed.
        /// </summary>
        static float SwingTarget(Binding binding, StationPassengerFrame[] passengers) {
            var holder = binding.Opening != null ? binding.Opening.Holder : null;
            if (holder == null || passengers == null) return 0f;
            var at = StationCoordinates.WorldToDocument(holder.position);
            bool cubicle = binding.Opening.Kind == OpeningKind.Cubicle;
            bool occupied = false, near = false;
            for (int i = 0; i < passengers.Length; i++) {
                var passenger = passengers[i];
                if (!passenger.Visible) continue;
                if (Math.Abs(passenger.Z - at.z) > SwingStorey) continue;
                double dx = passenger.X - at.x, dy = passenger.Y - at.y;
                double distance = Math.Sqrt(dx * dx + dy * dy);
                if (cubicle) {
                    if (distance < CubicleOccupiedRadius) occupied = true;
                } else if (distance <= SwingReach &&
                    (passenger.State == StationPassengerState.Walking || passenger.State == StationPassengerState.Queuing)) {
                    near = true;
                }
            }
            return occupied ? 0f : near ? 1f : 0f;
        }

        static double ChainOf(Binding binding) {
            if (binding.Vertical != null && binding.Vertical.LoopSeconds > 0)
                return binding.Vertical.LoopSeconds * VerticalModuleViews.EscalatorSpeed;
            if (binding.Legacy != null) return binding.Legacy.loopMetres;
            return 0;
        }

        static void PushPhase(Binding binding, double phase, int direction, bool playing, double chain) {
            var sample = binding.Sample;
            if (sample.HasSample && phase == sample.Phase && direction == sample.Direction) {
                // The same published frame replayed: the previous sample is still the one
                // before it, so a paused station keeps a meaningful interpolation pair and
                // re-applying a frame is the identity.
                sample.Running = playing;
                binding.Sample = sample;
                return;
            }
            double previous = sample.HasSample ? sample.Phase : phase;
            bool wrapped = sample.HasSample && chain > 1e-6 && Math.Abs(phase - sample.Phase) > chain * .5;
            sample.PreviousPhase = previous;
            sample.Phase = phase;
            sample.PhaseWrapped = wrapped;
            sample.Direction = direction;
            sample.Running = playing;
            sample.HasSample = true;
            binding.Sample = sample;
        }

        static void PushRanges(Binding binding, float cabin, float door, bool playing, long tick, int sequence = 0) {
            var sample = binding.Sample;
            // The history is keyed by the fixed tick and the service run, never by the
            // values: a dwell tick that republishes the same open fraction is still a new
            // tick, and must move the previous endpoint up to it. Otherwise the pair keeps
            // the fraction from two ticks ago and every rendered frame replays that travel.
            if (sample.HasSample && sample.Tick == tick && sample.ServiceSequence == sequence &&
                cabin == sample.Cabin && door == sample.Door) {
                sample.Running = playing;
                binding.Sample = sample;
                return;
            }
            sample.PreviousCabin = sample.HasSample ? sample.Cabin : cabin;
            sample.PreviousDoor = sample.HasSample ? sample.Door : door;
            sample.Cabin = cabin;
            sample.Door = door;
            sample.Tick = tick;
            sample.ServiceSequence = sequence;
            sample.Running = playing;
            sample.HasSample = true;
            binding.Sample = sample;
        }

        static void PushClock(Binding binding, double seconds, bool playing) {
            var sample = binding.Sample;
            if (sample.HasSample && seconds == sample.Clock) {
                sample.Running = playing;
                binding.Sample = sample;
                return;
            }
            sample.PreviousClock = sample.HasSample ? sample.Clock : seconds;
            sample.Clock = seconds;
            sample.Running = playing;
            sample.HasSample = true;
            binding.Sample = sample;
        }

        /// <summary>`alpha` 1 is the frame's own value (exact); otherwise the previous sample leads.</summary>
        static double Interpolate(double previous, double current, float alpha) {
            if (alpha >= 1f) return current;
            if (alpha <= 0f) return previous;
            return previous + (current - previous) * alpha;
        }

        static double InterpolatePhase(ModuleMotionSample sample, float alpha, double chain) {
            if (alpha >= 1f) return sample.Phase;
            if (alpha <= 0f) return sample.PreviousPhase;
            double from = sample.PreviousPhase, to = sample.Phase;
            if (sample.PhaseWrapped && chain > 1e-6) {
                if (sample.Direction >= 0) {
                    if (to < from) to += chain;
                } else if (to > from) {
                    from += chain;
                }
                return Wrap(from + (to - from) * alpha, chain);
            }
            return from + (to - from) * alpha;
        }

        static double Wrap(double value, double modulus) {
            if (modulus <= 0) return value;
            double result = value % modulus;
            return result < 0 ? result + modulus : result;
        }

        void DriveBelt(Binding binding, float alpha) {
            var sample = binding.Sample;
            float phase = (float)InterpolatePhase(sample, alpha, ChainOf(binding));
            if (binding.Vertical != null) {
                binding.Vertical.Apply(new ModuleMotionState {
                    ModuleId = binding.Id, Seconds = 0, Running = true, DirectionSign = 1,
                    CabinFraction = float.NaN, DoorFraction = float.NaN,
                    PhaseMeters = phase, CabinHeight = double.NaN,
                });
            } else if (binding.Legacy != null) {
                binding.Legacy.ApplyBeltPhase(phase, sample.Direction);
            }
            binding.Applied++;
            Measure(binding);
        }

        void DriveLift(Binding binding, float alpha) {
            var sample = binding.Sample;
            float cabin = (float)Interpolate(sample.PreviousCabin, sample.Cabin, alpha);
            float door = (float)Interpolate(sample.PreviousDoor, sample.Door, alpha);
            if (binding.Vertical != null) {
                binding.Vertical.Apply(ModuleMotionState.Lift(binding.Id, cabin, door));
            } else if (binding.Legacy != null) {
                binding.Legacy.ApplyCabinFraction(cabin);
            }
            binding.Applied++;
            Measure(binding);
        }

        void DriveOpening(Binding binding, float alpha) {
            var sample = binding.Sample;
            float door = (float)Interpolate(sample.PreviousDoor, sample.Door, alpha);
            if (binding.Opening != null) {
                binding.Opening.Apply(OpeningState.Uniform(door));
            } else if (binding.Legacy != null) {
                if (binding.Legacy.kind == ModuleMotion.Kind.GateWings) binding.Legacy.ApplyGate(door);
                else binding.Legacy.ApplyScreen(door);
            }
            binding.Applied++;
            Measure(binding);
        }

        void DriveTrain(Binding binding, float alpha) {
            var sample = binding.Sample;
            float door = (float)Interpolate(sample.PreviousDoor, sample.Door, alpha);
            // One bank only: the source addresss each bank separately, and the frame
            // publishes one fraction per consist (`doorSides` is not ported yet), so the
            // bank the caller named as the platform side moves and its opposite stays shut.
            binding.Train.SetBank(binding.TrainBank, door);
            binding.Applied++;
            Measure(binding);
        }

        void DriveClock(Binding binding, float alpha) {
            var sample = binding.Sample;
            double seconds = Interpolate(sample.PreviousClock, sample.Clock, alpha);
            if (binding.Legacy != null) {
                binding.Legacy.ApplyClockSeconds((float)Wrap(seconds, 86400));
            }
            binding.Applied++;
            Measure(binding);
        }

        /// <summary>
        /// Measure how far the binding's moving parts travelled from the pose they held
        /// when the binding was first driven. A leaf that slides contributes metres, a
        /// hinge that turns degrees, and the sum is the *total* displacement of every
        /// driven node — so a symmetrically parting pair cannot cancel out, and a held
        /// part contributes nothing. That is how "paused stays put" is proven from the
        /// objects themselves rather than from a counter.
        /// </summary>
        void Measure(Binding binding) {
            if (binding.Train != null) {
                // A consist has no view in the generic player; the rig reports its own
                // observed leaf movement in metres.
                binding.Moved = Mathf.Max(binding.Moved, binding.Train.Movement);
                return;
            }
            if (binding.Probe == null) {
                var nodes = ProbeNodes(binding);
                if (nodes == null || nodes.Count == 0) return;
                binding.Probe = new List<ProbeNode>(nodes.Count);
                for (int i = 0; i < nodes.Count; i++) {
                    var node = nodes[i];
                    if (!node) continue;
                    binding.Probe.Add(new ProbeNode {
                        Node = node,
                        Rest = node.position,
                        RestAngle = Quaternion.Angle(Quaternion.identity, node.localRotation),
                    });
                }
                return;
            }
            float moved = 0f;
            for (int i = 0; i < binding.Probe.Count; i++) {
                var probe = binding.Probe[i];
                if (probe.Node == null) continue;
                moved += Vector3.Distance(probe.Rest, probe.Node.position) +
                    Mathf.Abs(Quaternion.Angle(Quaternion.identity, probe.Node.localRotation) - probe.RestAngle);
            }
            binding.Moved = Mathf.Max(binding.Moved, moved);
        }

        /// <summary>
        /// The transforms a family's law writes. Only the driven nodes are listed: a
        /// fixed truss, a screen's fixed glass or a gate's cabinet never enters the probe,
        /// so a family that wrongly moves one would show up as movement.
        /// </summary>
        static List<Transform> ProbeNodes(Binding binding) {
            var nodes = new List<Transform>();
            if (binding.Vertical != null) {
                var parts = binding.Vertical.Parts;
                for (int i = 0; i < parts.Count; i++) {
                    var part = parts[i];
                    if (part == null || !part.Moving || !part.Transform) continue;
                    nodes.Add(part.Transform);
                    // A group part (a band, a landing-door bank) moves its children, not itself.
                    var group = part.Transform;
                    for (int child = 0; child < group.childCount; child++) nodes.Add(group.GetChild(child));
                }
                if (nodes.Count == 0 && binding.Vertical.Lift != null && binding.Vertical.Lift.Cabin != null)
                    nodes.Add(binding.Vertical.Lift.Cabin);
                return nodes;
            }
            if (binding.Opening != null) {
                var leaves = binding.Opening.Leaves;
                for (int i = 0; i < leaves.Count; i++) {
                    var leaf = leaves[i];
                    if (leaf != null && leaf.Node) nodes.Add(leaf.Node);
                }
                return nodes;
            }
            if (binding.Legacy != null) {
                var leaves = binding.Legacy.leaves;
                if (leaves != null) for (int i = 0; i < leaves.Length; i++) if (leaves[i]) nodes.Add(leaves[i]);
                if (binding.Legacy.cabin) nodes.Add(binding.Legacy.cabin);
                if (binding.Legacy.steps != null) for (int i = 0; i < binding.Legacy.steps.Length; i++) if (binding.Legacy.steps[i]) nodes.Add(binding.Legacy.steps[i]);
                return nodes;
            }
            return nodes;
        }
    }

    /// <summary>
    /// The per-frame half of the dispatch: the host ticks every registered
    /// <see cref="IStationFrameSink"/> with the committed station, so this sink reads
    /// the live session's own <see cref="StationMotionFrame"/> and applies it to the
    /// bound views. A station-frame sink is the sanctioned zero-wiring seam
    /// (`StationFrameSinks`, plan 11's renderer registry): no host or scene edit.
    ///
    /// Which families it binds here, and why only these:
    /// <list type="bullet">
    /// <item><b>screen doors</b> — no other sink drives the opening views, so a PSD run
    /// otherwise never answers a berthing consist;</item>
    /// <item><b>train doors</b> — bound only when a caller has registered a consist rig
    /// (the generic player has no rolling-stock renderer yet, plan 11 C3);</item>
    /// <item><b>escalators/walkways/lifts</b> are deliberately left to
    /// <c>VerticalModuleFeature</c>'s sink, which already drives them from the same
    /// session clock; two sinks writing one band would fight. The dispatch still
    /// binds and drives them in the report and in the tests, which is where the
    /// per-family proof lives.</item>
    /// </list>
    ///
    /// **Sampling cadence (RCA 14 §5).** A session frame is refreshed only when the
    /// fixed tick (or the session/epoch) changes; the dispatch is then sampled at the
    /// scheduler's presentation fraction on *every* rendered frame. That is what turns
    /// a 1 Hz tick into continuous leaf, belt, cabin and clock motion instead of one
    /// one-second jump. While paused the fraction is frozen, so re-applying is the
    /// identity and the pose holds exactly where it was; a seek/restart/switch drops
    /// the interpolation history so nothing blends across the discontinuity.
    /// </summary>
    public sealed class ModuleMotionFrameSink : IStationFrameSink {
        readonly ModuleMotionDispatch dispatch = new ModuleMotionDispatch();
        StationDocument document;
        StationSimulationSession session;
        StationMotionFrame frame;
        long lastTick = long.MinValue;
        long lastEpoch = long.MinValue;
        bool hasFrame;

        /// <summary>The dispatch this sink drives (read-only for a verifier).</summary>
        public ModuleMotionDispatch Dispatch => dispatch;
        /// <summary>Suspend the sink when a verifier wants to hold a pose it set itself.</summary>
        public static bool Suspended;
        /// <summary>The last failure, kept off the Console so a console-clean gate is not broken.</summary>
        public string LastError { get; private set; } = "";

        public void Tick(StationDocument stationDocument, StationIndex index, StationFrameClock clock) {
            if (Suspended || stationDocument == null) return;
            try {
                if (document == null || !ReferenceEquals(stationDocument.ModulePages, document.ModulePages)) {
                    Rebuild(stationDocument);
                } else {
                    document = stationDocument;
                }
                var host = StationGameHost.ResolveActive();
                if (host == null) return;
                var live = (host.Simulation as StationSimulationHost)?.Session;
                if (live == null) return;
                // A new session (station switch) or an invalidated history (seek,
                // restart, rebuilt document) must snap, not blend.
                bool reset = !ReferenceEquals(live, session) || clock.Epoch != lastEpoch;
                if (reset) {
                    dispatch.ForgetSamples();
                    session = live;
                    lastEpoch = clock.Epoch;
                    lastTick = long.MinValue;
                }
                // Only a tick boundary refreshes the source frame; every rendered frame
                // samples it at the scheduler fraction.
                if (!hasFrame || clock.Tick != lastTick) {
                    frame = live.Snapshot();
                    lastTick = clock.Tick;
                    hasFrame = true;
                }
                dispatch.Apply(frame, (float)clock.Fraction);
            } catch (Exception error) {
                LastError = error.GetType().Name + ": " + error.Message;
            }
        }

        void Rebuild(StationDocument stationDocument) {
            dispatch.Clear();
            session = null;
            lastTick = long.MinValue;
            lastEpoch = long.MinValue;
            hasFrame = false;
            frame = default;
            document = stationDocument;
            var vertical = VerticalModuleRenderer.Current;
            if (vertical != null) foreach (var view in vertical.Views)
                if (view.Kind == VerticalModuleKind.Lift) dispatch.Bind(view);
            var openings = StationOpeningRenderers.Current;
            if (openings != null) foreach (var view in openings.Views.Views) dispatch.Bind(view);
        }
    }

    /// <summary>
    /// Process-wide registration of the frame sink, in the same pattern every family
    /// uses (`VerticalModuleFeature`, `StationSignPacket`): the host enumerates
    /// <see cref="StationFrameSinks"/> itself, so the integration needs no host edit.
    /// </summary>
    public static class ModuleMotionFeature {
        static ModuleMotionFrameSink sink;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => Install();

        /// <summary>Idempotent registration seam for a host, a PlayMode test or the editor.</summary>
        public static ModuleMotionFrameSink Install() {
            if (sink != null) return sink;
            sink = new ModuleMotionFrameSink();
            StationFrameSinks.Add(sink);
            return sink;
        }

        /// <summary>The registered sink, or null when nothing installed it.</summary>
        public static ModuleMotionFrameSink Sink => sink;

        /// <summary>Test seam: forget the registration (the next Install creates a new sink).</summary>
        public static void Uninstall() {
            if (sink == null) return;
            StationFrameSinks.Remove(sink);
            sink = null;
        }
    }
}