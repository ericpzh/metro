using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Door-bank bindings for a promoted consist, derived from the formation's own
    /// anchors and the TypeScript rolling-stock data instead of hard-coded leaf names.
    ///
    /// Source contract (`unity/plan/motion-inventory.md` §1):
    /// <list type="bullet">
    /// <item>`TrainModel.buildTrain` places a doorway's two leaves at
    /// <c>dx ± doorWidth/4</c> and registers <c>{ openSign, travel = doorWidth/2 }</c>
    /// on the leaf itself. `setDoorsSides(plus, minus)` then writes, per leaf,
    /// <c>x = closedX + openSign · travel · slide</c> and
    /// <c>y = closedY + bank · plugTravel · plug</c>.</item>
    /// <item>`trainDoorMotion` stages the fraction: <c>plug = min(1, t / 0.18)</c>
    /// first, and only then <c>slide = (t − 0.18) / 0.82</c>. A PSD has no plug
    /// phase; a train leaf does, so the plug belongs to this rig, not to the caller.</item>
    /// <item>`TrainSystem.advanceTrainDoors` ramps each bank independently toward
    /// <c>open &amp;&amp; (doorSides &amp; bit)</c>, one fraction per bank over 2 sim
    /// seconds — so a bank that faces the tunnel wall never opens, and the two banks
    /// must be addressable separately (<see cref="Apply(float,float)"/>,
    /// <see cref="SetBank"/>).</item>
    /// </list>
    ///
    /// **Anchors, not leaf names.** The promoted formation carries one
    /// <c>DoorCentre-N</c> transform per doorway, plus the `AxisX`/`Front`/`Up`/
    /// `Approach` frame anchors the exporter writes
    /// (`tools/unity-assets/export-formations.mjs`). The rig measures each leaf's
    /// offset from its own doorway anchor and combines it with
    /// <see cref="Anchors"/> — the stock's door width from `sim/stock.ts` — so the
    /// closed pose, the travel and the slide sign come from the formation's data
    /// rather than from whatever pose the export happened to store. A leaf that has
    /// no anchor (a hand-made test consist) falls back to the measured pair gap and
    /// says so through <see cref="UsesAnchors"/>.
    ///
    /// **Which bank faces the platform is a property of the berth, not of the
    /// prefab.** <see cref="PlatformBank"/> defaults to +1 (the source's `plus`,
    /// world +z for Line 5 at Zoo). A reversed formation — the same consist turned
    /// end for end at the same berth, `dirSign` −1 — has its local +z pointing the
    /// other way, so the caller must call <see cref="SetPlatformSide"/> with a world
    /// point on the platform, or <see cref="SetPlatformBank"/>. Nothing else about
    /// the leaves changes: the pose law is local and reversible.
    /// </summary>
    public sealed class TrainDoorRig {
        /// <summary>How deep the leaf plugs out of the doorway before it slides (source `plugTravel`).</summary>
        public const float PlugMetres = .06f;
        /// <summary>`TRAIN_DOOR_PLUG_PHASE`: the plug owns the first 18 % of the opening travel.</summary>
        public const float PlugPhase = .18f;
        /// <summary>`DOOR_TRAVEL_S` / `TRAIN_DOOR_TRAVEL`: sim seconds for a full 0→1 crossing.</summary>
        public const float TravelSeconds = 2f;
        /// <summary>`STOCK.A.doorWidth`; the fallback when a caller supplies no line data.</summary>
        public const float DefaultDoorWidth = 1.4f;

        const float PairClusterMetres = 3f;
        const float DoorwayMergeMetres = .05f;

        /// <summary>The stock facts the leaf geometry repeats (`sim/stock.ts`).</summary>
        public struct Anchors {
            /// <summary>Stock class letter, `A`–`D` or `L`.</summary>
            public string Stock;
            public int Cars;
            /// <summary>The scale baked into the promoted consist (0.98 for Line 5 L).</summary>
            public float ModelScale;
            /// <summary>The stock's authored doorway width, before the model scale.</summary>
            public float DoorWidth;
            /// <summary>True when the values came from <see cref="ForLine"/>; false for a bare scale.</summary>
            public bool Valid;

            public static Anchors FromScale(float modelScale) => new Anchors {
                Stock = "", Cars = 0, ModelScale = modelScale > 0f ? modelScale : 1f,
                DoorWidth = DefaultDoorWidth, Valid = false,
            };

            public float Scale => ModelScale > 0f ? ModelScale : 1f;
            /// <summary>`travel` in consist-root metres: `doorWidth / 2 × modelScale`.</summary>
            public float Travel => DoorWidth * .5f * Scale;
            /// <summary>Half a leaf's closed offset from the doorway centre: `doorWidth / 4 × modelScale`.</summary>
            public float Quarter => DoorWidth * .25f * Scale;
            /// <summary>`plugTravel` in consist-root metres.</summary>
            public float Plug => PlugMetres * Scale;

            /// <summary>Provenance: `L6@0.98 doorW=1.4 anchor`, or `measured@0.98 doorW=1.4`.</summary>
            public string Describe() {
                var scale = Scale.ToString("0.###", CultureInfo.InvariantCulture);
                var width = DoorWidth.ToString("0.###", CultureInfo.InvariantCulture);
                if (!Valid) return "measured@" + scale + " doorW=" + width;
                return Stock + (Cars > 0 ? Cars.ToString(CultureInfo.InvariantCulture) : "") +
                    "@" + scale + " doorW=" + width + " anchor";
            }
        }

        /// <summary>The staged plug-and-slide pose of one leaf at a bank fraction (port of `trainDoorMotion`).</summary>
        public readonly struct Stage {
            /// <summary>Fraction of the slide travel; 0 until the plug is fully out.</summary>
            public readonly float Slide;
            /// <summary>Fraction of the plug travel; complete at <see cref="PlugPhase"/>.</summary>
            public readonly float Plug;

            public Stage(float slide, float plug) { Slide = slide; Plug = plug; }

            /// <summary>`trainDoorMotion(progress)`, clamped to <c>[0,1]</c>.</summary>
            public static Stage At(float progress) {
                float t = Mathf.Clamp01(progress);
                return new Stage(
                    Mathf.Max(0f, (t - PlugPhase) / (1f - PlugPhase)),
                    Mathf.Min(1f, t / PlugPhase));
            }

            public override string ToString() =>
                "slide=" + Slide.ToString("0.####", CultureInfo.InvariantCulture) +
                " plug=" + Plug.ToString("0.####", CultureInfo.InvariantCulture);
        }

        struct Leaf {
            public Transform node;
            public Transform parent;
            /// <summary>Position at fraction 0, in the consist root's local space.</summary>
            public Vector3 closed;
            /// <summary>+1 for the consist's local +z bank (source `plus`), −1 for the other.</summary>
            public int bank;
            /// <summary>+1 / −1 along the consist's local x (source `openSign`); 0 while unbound.</summary>
            public float openSign;
            /// <summary>Slide travel in root-local metres (source `travel`).</summary>
            public float travel;
            /// <summary>Plug travel in root-local metres (source `plugTravel`).</summary>
            public float plugTravel;
            /// <summary>Doorway index, −1 when the leaf could not be paired.</summary>
            public int door;
        }

        static readonly System.Text.RegularExpressions.Regex LeafName =
            new System.Text.RegularExpressions.Regex(@"Door\d+$", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        readonly List<Leaf> leaves = new List<Leaf>();
        readonly SortedSet<int> doors = new SortedSet<int>();
        readonly Transform root;
        readonly Anchors anchors;
        readonly bool anchored;
        readonly bool measured;
        readonly bool authoredOpen;
        float plus, minus;
        int platformBank = 1;
        int observed = -1;

        /// <summary>Every exported leaf the rig bound (`*DoorNN`).</summary>
        public int Leaves => leaves.Count;

        /// <summary>Doorways that produced a complete pair on at least one bank.</summary>
        public int Doors => doors.Count;

        /// <summary>Distinct banks found (2 on a promoted consist).</summary>
        public int Banks { get; }

        /// <summary>The bank that faces the platform: +1 (source `plus`) or −1 (`minus`).</summary>
        public int PlatformBank => platformBank;

        /// <summary>Fraction commanded on the +1 bank.</summary>
        public float Plus => plus;

        /// <summary>Fraction commanded on the −1 bank.</summary>
        public float Minus => minus;

        /// <summary>True when at least one doorway was bound from a `DoorCentre` anchor.</summary>
        public bool UsesAnchors => anchored;

        /// <summary>True when at least one doorway fell back to the measured pair gap.</summary>
        public bool UsesMeasuredPair => measured;

        /// <summary>The stock facts the rig measured against.</summary>
        public Anchors LineAnchors => anchors;

        /// <summary>True when the promoted cars stored their leaves at the jambs (authored open).</summary>
        public bool AuthoredOpen => authoredOpen;

        public Transform Observed => observed >= 0 && observed < leaves.Count ? leaves[observed].node : null;

        /// <summary>The observed leaf's closed x in the consist root's local space.</summary>
        public float ObservedClosed => observed >= 0 && observed < leaves.Count ? leaves[observed].closed.x : 0f;

        /// <summary>The observed leaf's slide travel in root-local metres.</summary>
        public float ObservedTravel => observed >= 0 && observed < leaves.Count ? leaves[observed].travel : 0f;

        /// <summary>Legacy entry: a bare model scale, the platform bank from the source's `plus`.</summary>
        public TrainDoorRig(GameObject consist, float modelScale)
            : this(consist, Anchors.FromScale(modelScale), 1) { }

        /// <summary>A rig driven by the line's stock data, platform bank +1.</summary>
        public TrainDoorRig(GameObject consist, Anchors lineAnchors) : this(consist, lineAnchors, 1) { }

        /// <summary>
        /// A rig driven by the line's stock data and the bank that faces the platform.
        /// `platformBank` is +1 for the source's `plus`, −1 for `minus`; use
        /// <see cref="BankFacing"/> or <see cref="SetPlatformSide"/> when the consist may
        /// be reversed at its berth.
        /// </summary>
        public TrainDoorRig(GameObject consist, Anchors lineAnchors, int platformBank) {
            anchors = lineAnchors.DoorWidth > 0f ? lineAnchors : Anchors.FromScale(lineAnchors.ModelScale);
            this.platformBank = platformBank >= 0 ? 1 : -1;
            if (!consist) { Banks = 0; return; }
            root = consist.transform;
            foreach (var node in root.GetComponentsInChildren<Transform>(true)) {
                if (!IsLeaf(node.name)) continue;
                var inRoot = root.InverseTransformPoint(node.position);
                leaves.Add(new Leaf {
                    node = node,
                    parent = node.parent,
                    closed = inRoot,
                    bank = inRoot.z >= 0f ? 1 : -1,
                    openSign = 0f,
                    travel = anchors.Travel,
                    plugTravel = anchors.Plug,
                    door = -1,
                });
            }
            if (leaves.Count > 0) {
                var anchorX = DoorAnchors(root);
                bool anyAnchored = false, anyMeasured = false, anyOpen = false;
                Bind(anchorX, ref anyAnchored, ref anyMeasured, ref anyOpen);
                anchored = anyAnchored;
                measured = anyMeasured;
                authoredOpen = anyOpen;
                Banks = leaves.Select(leaf => leaf.bank).Distinct().Count();
                PickObserved();
                ApplyBank(1, 0f);
                ApplyBank(-1, 0f);
            }
        }

        /// <summary>
        /// The stock facts for a line, from `sim/stock.ts` through the shared
        /// <see cref="TrainConsist"/> port. `cars` is informational for the doors (the
        /// cadence itself is the screen's business) but it keeps the provenance whole.
        /// </summary>
        public static Anchors ForLine(string stock, int cars, float modelScale) => new Anchors {
            Stock = string.IsNullOrEmpty(stock) ? "A" : stock.ToUpperInvariant(),
            Cars = Mathf.Max(0, cars),
            ModelScale = modelScale > 0f ? modelScale : 1f,
            DoorWidth = TrainConsist.DoorWidth(stock, 1f),
            Valid = true,
        };

        /// <summary>Which bank of `consist` faces a world point on the platform (+1 or −1).</summary>
        public static int BankFacing(Transform consist, Vector3 worldPlatformPoint) {
            if (!consist) return 1;
            return consist.InverseTransformPoint(worldPlatformPoint).z >= 0f ? 1 : -1;
        }

        /* ------------------------------------------------------------- binding */

        /// <summary>
        /// Bind every doorway of both banks. With `DoorCentre-*` anchors the source's own
        /// law decides the pose (<c>closedX = anchor ± doorWidth/4</c>,
        /// <c>openSign = ∓1</c>, travel `doorWidth/2 × scale`); without them the measured
        /// pair gap does, and the rig reports that it had to measure.
        /// </summary>
        void Bind(SortedDictionary<int, float> anchorX, ref bool anyAnchored, ref bool anyMeasured, ref bool anyOpen) {
            var pairs = new List<(int bank, int a, int b, float centre, bool anchor, int anchorIndex)>();
            foreach (int bank in new[] { -1, 1 }) {
                var byBank = Enumerable.Range(0, leaves.Count)
                    .Where(i => leaves[i].bank == bank)
                    .OrderBy(i => leaves[i].closed.x).ToList();
                if (byBank.Count < 2) continue;
                if (anchorX.Count > 0) {
                    foreach (var group in byBank.GroupBy(i => NearestDoor(anchorX, leaves[i].closed.x))) {
                        var pair = group.OrderBy(i => leaves[i].closed.x).ToArray();
                        if (pair.Length != 2) continue;
                        int a = pair[0], b = pair[1];
                        float gap = leaves[b].closed.x - leaves[a].closed.x;
                        if (gap <= .01f || gap > PairClusterMetres) continue;
                        pairs.Add((bank, a, b, (leaves[a].closed.x + leaves[b].closed.x) * .5f, true, group.Key));
                    }
                } else {
                    for (int i = 0; i + 1 < byBank.Count; i += 2) {
                        int a = byBank[i], b = byBank[i + 1];
                        float gap = leaves[b].closed.x - leaves[a].closed.x;
                        if (gap <= .01f || gap > PairClusterMetres) continue;
                        pairs.Add((bank, a, b, (leaves[a].closed.x + leaves[b].closed.x) * .5f, false, -1));
                    }
                }
            }

            // One doorway number per physical doorway: both banks of one anchor share it,
            // and unanchored pairs are merged by their measured centre.
            var doorwayOf = new Dictionary<int, int>();
            var centres = new List<(int door, float centre)>();
            int nextDoor = 0;
            foreach (var pair in pairs) {
                int door;
                if (pair.anchor) {
                    door = pair.anchorIndex;
                } else {
                    int found = -1;
                    foreach (var known in centres) {
                        if (Mathf.Abs(known.centre - pair.centre) > DoorwayMergeMetres) continue;
                        found = known.door;
                        break;
                    }
                    if (found < 0) found = nextDoor++;
                    centres.Add((found, pair.centre));
                    door = found;
                }
                doorwayOf[pair.a] = door;
                doorwayOf[pair.b] = door;
            }

            // The source's pose law, per pair.
            var seen = new HashSet<int>();
            foreach (var pair in pairs) {
                int a = pair.a, b = pair.b;
                float gap = leaves[b].closed.x - leaves[a].closed.x;
                float travel = anchors.Travel;
                float quarter = anchors.Quarter;
                if (travel <= 1e-4f) { travel = gap * .5f; quarter = travel * .5f; }
                bool open = Mathf.Abs(gap - 3f * travel) < Mathf.Abs(gap - 2f * quarter);
                var left = leaves[a];
                var right = leaves[b];
                left.openSign = -1f;
                right.openSign = 1f;
                left.travel = right.travel = travel;
                left.plugTravel = right.plugTravel = anchors.Plug;
                left.door = right.door = doorwayOf[a];
                if (pair.anchor) {
                    // The formation's own anchor is authoritative for the closed pose.
                    float centre = anchorX.TryGetValue(pair.anchorIndex, out var value) ? value : pair.centre;
                    left.closed.x = centre - quarter;
                    right.closed.x = centre + quarter;
                    if (open) anyOpen = true;
                } else if (open) {
                    // Stored at the jambs: pulling each leaf in by its travel closes the
                    // pair (the measured gap is 3 x travel, the shut one is 2 x travel).
                    left.closed.x += travel;
                    right.closed.x -= travel;
                    anyOpen = true;
                }
                leaves[a] = left;
                leaves[b] = right;
                if (seen.Add(left.door)) doors.Add(left.door);
                if (pair.anchor) anyAnchored = true; else anyMeasured = true;
            }
        }

        /// <summary>Read the formation's `DoorCentre-*` anchors, keyed by doorway index.</summary>
        static SortedDictionary<int, float> DoorAnchors(Transform root) {
            var found = new SortedDictionary<int, float>();
            foreach (var node in root.GetComponentsInChildren<Transform>(true)) {
                int index = AnchorIndex(node.name);
                if (index < 0) continue;
                found[index] = root.InverseTransformPoint(node.position).x;
            }
            return found;
        }

        static int AnchorIndex(string name) {
            if (string.IsNullOrEmpty(name) || !name.StartsWith("DoorCentre", StringComparison.Ordinal)) return -1;
            int dash = name.LastIndexOf('-');
            if (dash < 0 || dash + 1 >= name.Length) return -1;
            return int.TryParse(name.Substring(dash + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out var index)
                ? index : -1;
        }

        static int NearestDoor(SortedDictionary<int, float> anchorX, float x) {
            int best = -1;
            float distance = float.MaxValue;
            foreach (var pair in anchorX) {
                float delta = Mathf.Abs(pair.Value - x);
                if (delta >= distance) continue;
                distance = delta;
                best = pair.Key;
            }
            return best;
        }

        /// <summary>TrainLMidDoor00, TrainLCabLeadDoor00: a door leaf, never a DoorCentre anchor.</summary>
        static bool IsLeaf(string name) =>
            !string.IsNullOrEmpty(name) && !name.StartsWith("DoorCentre", StringComparison.Ordinal) && LeafName.IsMatch(name);

        void PickObserved() {
            observed = -1;
            for (int i = 0; i < leaves.Count; i++) {
                if (leaves[i].bank != platformBank || leaves[i].door < 0) continue;
                if (observed < 0 || leaves[i].closed.x < leaves[observed].closed.x) observed = i;
            }
            // A bank with no complete pair still reports a leaf, so a caller can sample it.
            if (observed < 0 && leaves.Count > 0) observed = 0;
        }

        /* ------------------------------------------------------------- driving */

        /// <summary>Choose which bank faces the platform (+1 = source `plus`, −1 = `minus`).</summary>
        public void SetPlatformBank(int bank) {
            int next = bank >= 0 ? 1 : -1;
            if (next == platformBank && observed >= 0) return;
            platformBank = next;
            PickObserved();
            ApplyBank(1, plus);
            ApplyBank(-1, minus);
        }

        /// <summary>Derive the platform bank from a world point that lies on the platform.</summary>
        public void SetPlatformSide(Vector3 worldPlatformPoint) => SetPlatformBank(BankFacing(root, worldPlatformPoint));

        /// <summary>Drive the platform bank only; the opposite bank is held where it is.</summary>
        public void Apply(float openness) {
            float fraction = Mathf.Clamp01(openness);
            if (platformBank >= 0) plus = fraction; else minus = fraction;
            ApplyBank(platformBank, fraction);
        }

        /// <summary>Drive both banks independently, exactly as `setDoorsSides(plus, minus)`.</summary>
        public void Apply(float plusFraction, float minusFraction) {
            plus = Mathf.Clamp01(plusFraction);
            minus = Mathf.Clamp01(minusFraction);
            ApplyBank(1, plus);
            ApplyBank(-1, minus);
        }

        /// <summary>Address one bank without touching the other.</summary>
        public void SetBank(int bank, float fraction) {
            float clamped = Mathf.Clamp01(fraction);
            if (bank >= 0) plus = clamped; else minus = clamped;
            ApplyBank(bank >= 0 ? 1 : -1, clamped);
        }

        /// <summary>
        /// `TrainSystem.advanceTrainDoors`: step each bank toward its target by
        /// `dt / DOOR_TRAVEL_S`, never past it, and place the leaves if anything moved.
        /// Returns true when a fraction changed.
        /// </summary>
        public bool Advance(float simDeltaSeconds, float plusTarget, float minusTarget) {
            float step = Mathf.Max(0f, simDeltaSeconds) / TravelSeconds;
            bool changed = Step(ref plus, Mathf.Clamp01(plusTarget), step);
            changed |= Step(ref minus, Mathf.Clamp01(minusTarget), step);
            if (!changed) return false;
            ApplyBank(1, plus);
            ApplyBank(-1, minus);
            return true;
        }

        static bool Step(ref float value, float target, float step) {
            if (value == target || step <= 0f) return false;
            value = target > value ? Mathf.Min(target, value + step) : Mathf.Max(target, value - step);
            return true;
        }

        /// <summary>Drive every bank to shut (the source's reset contract).</summary>
        public void Reset() { plus = 0f; minus = 0f; ApplyBank(1, 0f); ApplyBank(-1, 0f); }

        void ApplyBank(int bank, float fraction) {
            if (!root) return;
            var stage = Stage.At(fraction);
            for (int i = 0; i < leaves.Count; i++) {
                var leaf = leaves[i];
                if (!leaf.node || leaf.bank != bank || leaf.openSign == 0f) continue;
                var offset = new Vector3(leaf.openSign * leaf.travel * stage.Slide, 0f,
                    leaf.bank * leaf.plugTravel * stage.Plug);
                var target = leaf.closed + offset;
                leaf.node.localPosition = leaf.parent
                    ? leaf.parent.InverseTransformPoint(root.TransformPoint(target))
                    : target;
            }
        }

        /// <summary>Published movement of the observed platform-bank leaf, in metres.</summary>
        public float Movement {
            get {
                if (observed < 0 || !root) return 0f;
                var leaf = leaves[observed];
                if (!leaf.node) return 0f;
                return Mathf.Abs(root.InverseTransformPoint(leaf.node.position).x - leaf.closed.x);
            }
        }

        /// <summary>The staged sample of one bank, its leaf and doorway counts.</summary>
        public string DescribeBank(int bank) {
            var stage = Stage.At(bank >= 0 ? plus : minus);
            return (bank >= 0 ? "plus " : "minus ") + stage +
                " leaves=" + leaves.Count(leaf => leaf.bank == bank) +
                " doors=" + leaves.Where(leaf => leaf.bank == bank && leaf.door >= 0)
                    .Select(leaf => leaf.door).Distinct().Count();
        }

        /// <summary>A one-line diagnostic for the test log and the browser readout.</summary>
        public string Describe() {
            var platform = leaves.Where(leaf => leaf.bank == platformBank).OrderBy(leaf => leaf.closed.x).ToList();
            var gaps = new StringBuilder();
            for (int i = 0; i + 1 < platform.Count && i < 6; i += 2)
                gaps.Append((platform[i + 1].closed.x - platform[i].closed.x)
                    .ToString("0.###", CultureInfo.InvariantCulture)).Append(' ');
            return $"leaves={leaves.Count} banks={Banks} platform={platformBank} pairLeaves={platform.Count}" +
                $" gaps=[{gaps.ToString().Trim()}] doors={Doors} authoredOpen={AuthoredOpen}" +
                $" anchors={anchors.Describe()} anchored={anchored} measured={measured}" +
                $" travel={ObservedTravel.ToString("0.###", CultureInfo.InvariantCulture)}" +
                $" movement={Movement.ToString("0.###", CultureInfo.InvariantCulture)}";
        }
    }
}
