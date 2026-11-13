using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>The opening families packet B3 owns.</summary>
    public enum OpeningKind {
        /// <summary>Not an opening module.</summary>
        None = 0,
        /// <summary>A `platform-edge` screen run with one sliding leaf pair per opening.</summary>
        PsdRun = 1,
        /// <summary>A fixed `psd-end` screen panel (full height, or the half-height prefab).</summary>
        PsdEnd = 2,
        /// <summary>A `psd-end` `variant: cover` white course above the screen.</summary>
        PsdCover = 3,
        /// <summary>A fare gate: its two lane leaves retract into the cabinets.</summary>
        Gate = 4,
        /// <summary>A standing `door` or a room doorway: its leaf pivots about its hinge.</summary>
        SwingDoor = 5,
        /// <summary>A toilet cubicle door: a swing leaf that is held shut while occupied.</summary>
        Cubicle = 6,
    }

    /// <summary>
    /// One module's commanded opening state. The source has **one fraction per screen
    /// run**, **one per gate lane** and **one per swing leaf**; a screen's openings are
    /// the only case where a run can carry more than one, and even then the source moves
    /// them together. The array form exists so a future per-opening hold (one doorway
    /// kept shut for a fault) does not need a second API — but the default is a single
    /// fraction, and nothing here is station-wide.
    ///
    /// There is deliberately no station-wide `doorsOpen`: every command names a module
    /// ID, and <see cref="OpeningModuleSet.Apply(string, OpeningState)"/> refuses an ID
    /// it did not build.
    /// </summary>
    public readonly struct OpeningState {
        readonly float[] openings;

        OpeningState(float fraction, float[] perOpening) {
            Default = Mathf.Clamp01(fraction);
            openings = perOpening;
        }

        /// <summary>The fraction every opening without an explicit entry uses.</summary>
        public float Default { get; }

        /// <summary>How many per-opening entries were supplied (0 for a uniform state).</summary>
        public int Count => openings?.Length ?? 0;

        /// <summary>The fraction for one opening index; the default when none was supplied.</summary>
        public float At(int opening) {
            if (openings == null || opening < 0 || opening >= openings.Length) return Default;
            return Mathf.Clamp01(openings[opening]);
        }

        /// <summary>Shut: the state of every opening with no berth, walker or train.</summary>
        public static OpeningState Shut => new OpeningState(0f, null);

        /// <summary>One fraction for every opening of the module.</summary>
        public static OpeningState Uniform(float fraction) => new OpeningState(fraction, null);

        /// <summary>Per-opening fractions, in opening order.</summary>
        public static OpeningState PerOpening(params float[] fractions) =>
            new OpeningState(0f, fractions == null ? null : (float[])fractions.Clone());

        public override string ToString() =>
            (Count == 0 ? Default.ToString("0.###", CultureInfo.InvariantCulture)
                : string.Join(",", openings.Select(value => value.ToString("0.###", CultureInfo.InvariantCulture))));
    }

    /// <summary>How one moving fitting answers to its module's fraction.</summary>
    public enum OpeningLeafKind {
        /// <summary>A screen-door leaf: slides along the run by `travel × fraction`.</summary>
        Slide = 0,
        /// <summary>A fare-gate wing: compresses toward its cabinet (scale + position).</summary>
        GateWing = 1,
        /// <summary>A swing leaf: rotates about its authored hinge by `fraction × 81°`.</summary>
        SwingPivot = 2,
    }

    /// <summary>
    /// One moving fitting of a built opening view, with the numbers its law reads. The
    /// source's laws are pure functions of a fraction, so every field here is measured
    /// once at build time and never re-derived while the station is live.
    /// </summary>
    public sealed class OpeningLeaf {
        public string Name = "";
        public OpeningLeafKind LeafKind;
        /// <summary>The transform the law writes (the leaf mesh node, or the swing pivot).</summary>
        public Transform Node;
        /// <summary>The opening index this fitting belongs to.</summary>
        public int Opening;
        /// <summary>Local position at fraction 0 (the parent's space).</summary>
        public Vector3 Closed;
        /// <summary>Slide travel in metres (PSD leaves), or the lane reach (gate wings).</summary>
        public float Travel;
        /// <summary>+1 / −1 slide direction (PSD `openSign`, gate leaf `sign`).</summary>
        public float Sign;
        /// <summary>The leaf's authored local scale, so a repeated `Apply(0)` leaves no residual.</summary>
        public Vector3 AuthoredScale = Vector3.one;
        /// <summary>Gate `fullW`: the width one wing covers at shut.</summary>
        public float GateFullWidth;
        /// <summary>Gate `edgeX`: the jamb the wing retracts to.</summary>
        public float GateEdge;
        /// <summary>How far a swing leaf turns at fraction 1 (source `π × 0.45`).</summary>
        public float MaxDegrees = 81f;
        /// <summary>
        /// The local-Y angle multiplier at fraction 1 for a swing leaf: the source sign times
        /// the promoted frame's determinant (`OpeningModuleViews.SwingLocalDegrees`).
        /// </summary>
        public float SwingFactor = -1f;
        /// <summary>
        /// The hinge axis in the pivot's parent frame — the **source up** direction, which is
        /// `OpeningAxis.Z`. It is not assumed to be the local Y: the opening GLBs wrap their
        /// Z-up content in a −90°-about-X node, so below that node the pivot's local **Z** is
        /// up, and a `Euler(0, θ, 0)` swing would sweep the leaf across the doorway instead of
        /// through it.
        /// </summary>
        public Vector3 SwingUp = Vector3.up;
        /// <summary>The source frame the leaf's law was calibrated in (`""` for a generated run).</summary>
        public string Axis = "";

        /// <summary>The fraction the leaf currently shows.</summary>
        public float Fraction { get; internal set; }

        public override string ToString() {
            var id = CultureInfo.InvariantCulture;
            switch (LeafKind) {
                case OpeningLeafKind.GateWing:
                    return "gate wing " + Name + " edge=" + GateEdge.ToString("0.###", id) +
                        " full=" + GateFullWidth.ToString("0.###", id) + " f=" + Fraction.ToString("0.###", id);
                case OpeningLeafKind.SwingPivot:
                    return "pivot " + Name + " sign=" + Sign.ToString("0", id) + " f=" + Fraction.ToString("0.###", id);
                default:
                    return "slide " + Name + " closedX=" + Closed.x.ToString("0.###", id) +
                        " travel=" + Travel.ToString("0.###", id) + " sign=" + Sign.ToString("0", id) +
                        " opening=" + Opening + " f=" + Fraction.ToString("0.###", id);
            }
        }
    }

    /// <summary>One built opening module: identity, provenance, geometry and its state.</summary>
    public sealed class OpeningView {
        internal readonly List<OpeningLeaf> leaves = new List<OpeningLeaf>();

        public OpeningKind Kind;
        public string ModuleId = "";
        public string Type = "";
        /// <summary>The catalogue key the view resolved to, or `generated:*` for an assembly.</summary>
        public string ViewKey = "";
        public string PrefabPath = "";
        /// <summary>Non-fatal caveats (`code:detail` list); empty when fully faithful.</summary>
        public string Diagnostic = "";
        public GameObject Instance;
        /// <summary>The module pivot the view hangs from (position + saved quarter turn).</summary>
        public Transform Holder;
        /// <summary>True when at least one fitting moves; false for fixed glass and covers.</summary>
        public bool Movable;
        /// <summary>The number of independent openings the module exposes.</summary>
        public int OpeningCount;
        /// <summary>The line this opening serves (`cfg.line`), empty when the record names none.</summary>
        public string LineId = "";
        /// <summary>The rail this screen run follows (`cfg.from`), empty when none.</summary>
        public string TrackId = "";
        /// <summary>
        /// The source frame the promoted content was calibrated in (`source-x`, `mirrored-x`,
        /// `assumed-document`), read from the piece's own `AxisX`/`Front`/`Up` anchors. Empty
        /// for a generated view, whose frame is the document's by construction.
        /// </summary>
        public string AxisConvention = "";
        public float[] OpeningCentres = Array.Empty<float>();
        /// <summary>The PSD arithmetic the view was assembled from, for a report or a test.</summary>
        public PsdRunLayout Run;

        public IReadOnlyList<OpeningLeaf> Leaves => leaves;
        public bool Built => Instance != null;

        /// <summary>The fraction last applied to one opening.</summary>
        public float FractionAt(int opening) {
            for (int i = 0; i < leaves.Count; i++) if (leaves[i].Opening == opening) return leaves[i].Fraction;
            return 0f;
        }

        /// <summary>Apply this module's own state. Never touches another module.</summary>
        public void Apply(OpeningState state) {
            for (int i = 0; i < leaves.Count; i++) {
                var leaf = leaves[i];
                if (!leaf.Node) continue;
                float fraction = state.At(leaf.Opening);
                switch (leaf.LeafKind) {
                    case OpeningLeafKind.GateWing: {
                        // `setGateWing`: the wing compresses into its cabinet and parks at the jamb.
                        float full = Mathf.Approximately(leaf.GateFullWidth, 0f) ? .35f : leaf.GateFullWidth;
                        float width = full * (1f - fraction) + .025f * fraction;
                        var scale = leaf.AuthoredScale;
                        scale.x = leaf.AuthoredScale.x * (width / full);
                        leaf.Node.localScale = scale;
                        var position = leaf.Closed;
                        position.x = leaf.GateEdge + leaf.Sign * width * .5f;
                        leaf.Node.localPosition = position;
                        break;
                    }
                    case OpeningLeafKind.SwingPivot: {
                        // `CrowdSystem`: pivot.rotation.z = sign * open * pi * 0.45 — a turn
                        // about the source's **up** axis, which `SwingUp` carries into the
                        // promoted frame, and `SwingFactor` carries the source sign and the
                        // frame's determinant. Rotating about the local Y instead is only right
                        // when the imported frame happens to be Y-up; these pieces are Z-up.
                        leaf.Node.localRotation = Quaternion.AngleAxis(
                            leaf.SwingFactor * fraction * leaf.MaxDegrees, leaf.SwingUp);
                        break;
                    }
                    default: {
                        var position = leaf.Closed;
                        position.x = leaf.Closed.x + leaf.Sign * leaf.Travel * fraction;
                        leaf.Node.localPosition = position;
                        break;
                    }
                }
                leaf.Fraction = fraction;
            }
        }

        /// <summary>A one-line report row, keyed by the stable module ID.</summary>
        public string Describe() {
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            text.Append(ModuleId).Append(' ').Append(Type).Append(' ').Append(Kind).Append(" key=").Append(ViewKey);
            if (LineId.Length > 0) text.Append(" line=").Append(LineId);
            if (TrackId.Length > 0) text.Append(" track=").Append(TrackId);
            if (AxisConvention.Length > 0) text.Append(" axis=").Append(AxisConvention);
            text.Append(" openings=").Append(OpeningCount).Append(" leaves=").Append(leaves.Count);
            text.Append(" movable=").Append(Movable);
            if (Run != null) {
                text.Append(" doorW=").Append(Run.DoorWidth.ToString("0.###", id));
                text.Append(" travel=").Append(Run.Travel.ToString("0.###", id));
            }
            if (OpeningCentres.Length > 0) {
                text.Append(" centres=[");
                for (int i = 0; i < OpeningCentres.Length; i++) {
                    if (i > 0) text.Append(',');
                    text.Append(OpeningCentres[i].ToString("0.###", id));
                }
                text.Append(']');
            }
            if (Diagnostic.Length > 0) text.Append(" diagnostic=").Append(Diagnostic);
            return text.ToString();
        }
    }

    /// <summary>
    /// Every opening view of one station world, keyed by module ID. It is the state hub:
    /// a simulation or a verifier calls <see cref="Apply(string, OpeningState)"/> for one
    /// module at a time, so an unrelated platform, lift or gate cannot move because
    /// another opening did.
    /// </summary>
    public sealed class OpeningModuleSet {
        readonly Dictionary<string, OpeningView> views = new Dictionary<string, OpeningView>(StringComparer.Ordinal);

        public int Count => views.Count;
        public IEnumerable<OpeningView> Views => views.Values;

        /// <summary>Modules that carry a moving fitting.</summary>
        public int MovableCount => views.Values.Count(view => view.Movable);

        /// <summary>Declared openings over every module (a 101 m run declares 18).</summary>
        public int OpeningCount => views.Values.Sum(view => view.OpeningCount);

        public void Add(OpeningView view) {
            if (view == null || string.IsNullOrEmpty(view.ModuleId)) return;
            views[view.ModuleId] = view;
        }

        public bool TryGet(string moduleId, out OpeningView view) {
            view = null;
            return !string.IsNullOrEmpty(moduleId) && views.TryGetValue(moduleId, out view);
        }

        /// <summary>
        /// Drive **one** module. Returns false when the module has no opening view, so a
        /// caller cannot mistake a typo for a silent station-wide command.
        /// </summary>
        public bool Apply(string moduleId, OpeningState state) {
            if (!TryGet(moduleId, out var view)) return false;
            view.Apply(state);
            return true;
        }

        /// <summary>Drive one opening of one module, leaving its siblings where they are.</summary>
        public bool Apply(string moduleId, int opening, float fraction) {
            if (!TryGet(moduleId, out var view)) return false;
            var current = new float[Mathf.Max(1, view.OpeningCount)];
            for (int i = 0; i < current.Length; i++) current[i] = view.FractionAt(i);
            if (opening >= 0 && opening < current.Length) current[opening] = fraction;
            view.Apply(OpeningState.PerOpening(current));
            return true;
        }

        public void Clear() => views.Clear();

        public string Describe() =>
            "modules=" + Count + " movable=" + MovableCount + " openings=" + OpeningCount;
    }

    /// <summary>What the run solver needs: the saved `platform-edge` record and its rail/line.</summary>
    public struct PsdRunRequest {
        public string ModuleId;
        public int X, Y, Z, Rotation, Width;
        /// <summary>`cfg.side`: `left` (the track lies local −y) or `right`.</summary>
        public string Side;
        /// <summary>`cfg.psd`: `full`, `half` or `none`.</summary>
        public string Psd;
        public int StoreyHeight;
        public bool HasTrack;
        public int TrackX, TrackY, TrackRotation, TrackWidth;
        public bool HasLine;
        public string Stock;
        public int Cars;
        public float ModelScale;
    }

    /// <summary>One doorway cut into a screen run, in run-local metres from the group origin.</summary>
    public struct PsdOpening {
        public int Index;
        /// <summary>The doorway centre along the run.</summary>
        public float Centre;
        /// <summary>The clear width the screen is cut at (`doorWidthAt × 1.5` for a full screen).</summary>
        public float Width;
        /// <summary>`width / 2`: how far one leaf slides.</summary>
        public float Travel;
        /// <summary>`width / 2 + 0.20`: the leaf's own width (the source overhangs the seam).</summary>
        public float LeafWidth;
        public override string ToString() =>
            "#" + Index + " at " + Centre.ToString("0.###", CultureInfo.InvariantCulture) +
            " w=" + Width.ToString("0.###", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The port of `buildPsd`'s arithmetic (`render/models/pieces/PsdModel.ts`) for one
    /// saved run: the door cadence from the rail's own width and the line's stock, the
    /// openings that fall on the run, the fixed-pane spans between them, the mullions and
    /// the section pillars. Pure numbers — no engine types — so it is testable and so the
    /// geometry builder and the evidence report read one implementation.
    /// </summary>
    public sealed class PsdRunLayout {
        public string ModuleId = "";
        public float Length;
        /// <summary>True for `side: left`: the screen faces local −y, which is the track.</summary>
        public bool Left = true;
        public float WallOffset;
        public float DoorWidth;
        public float Travel;
        public float LeafWidth;
        public float FullHeight = 3f;
        public float HeaderHeight = .6f;
        public float DoorHeight;
        public float GlassHeight;
        public float GlassMid;
        public float LeafMid;
        public float LeafY;
        public float SlideOffset;
        public float SillDepth;
        public float SillY;
        public float FixedFrameDepth;
        public int StoreyHeight = 5;
        public float BedWidth;
        public float RunStart = -.5f;
        public bool HasLine;
        public string Stock = "";
        public int Cars;
        public float ModelScale = 1f;
        /// <summary>Set when the view had to fall back or omit something.</summary>
        public string Diagnostic = "";

        public readonly List<PsdOpening> Openings = new List<PsdOpening>();
        /// <summary>Fixed glass spans between the openings, in run-local x.</summary>
        public readonly List<Vector2> Panels = new List<Vector2>();
        /// <summary>A jamb at each opening edge and one at each end.</summary>
        public readonly List<float> Posts = new List<float>();
        /// <summary>One structural pillar between sections and one at each end.</summary>
        public readonly List<float> Pillars = new List<float>();

        public float End => RunStart + Length;
        public int OpeningCount => Openings.Count;

        public override string ToString() =>
            "len=" + Length.ToString("0.###", CultureInfo.InvariantCulture) +
            " openings=" + Openings.Count +
            " doorW=" + DoorWidth.ToString("0.###", CultureInfo.InvariantCulture) +
            " travel=" + Travel.ToString("0.###", CultureInfo.InvariantCulture) +
            " side=" + (Left ? "left" : "right");
    }

    /// <summary>
    /// Runtime views for the moving openings: platform screen doors, their fixed ends and
    /// cover courses, fare gates, standing/room doors and toilet cubicles
    /// (`unity/plan/motion-inventory.md` §1–§4).
    ///
    /// **PSD runs are assembled, not scaled.** A `platform-edge` record is a *run*: Zoo's
    /// two are 101 m with 18 openings each. The promoted `PlatformEdge` prefab is the
    /// export's 20 m B-stock fixture with four openings, so instancing it would put the
    /// doors in the wrong place for every other run. The run is therefore built from the
    /// source's own arithmetic — `doorRunOffsets` from the rail's width and the line's
    /// stock (`PsdRunLayout`) — and only its *fixed glass, jambs, pillars, sill, fascia
    /// and moving leaves* are drawn. The prefab's own housing/header/decals are not used:
    /// the exported housing is the same 20 m fixture, and its printed decals are sign-face
    /// artwork owned by packet F's engine.
    ///
    /// **Fixed PSD ends keep the prefab where it matches.** The promoted `PsdEnd` is the
    /// *half-height* course the export froze (`export-canopy.mjs`), and `PsdEndCover` is a
    /// 1 × 0.24 × 1 m box. A saved `psd-end` with `psd: full` (12 in Zoo) needs the
    /// full-height end assembly `PsdEndModel.build` makes at its own trimmed span, so it is
    /// generated; a half-height end or a cover whose saved width/depth equal the prefab's
    /// measured extents is instanced. `audit-runtime-models.mjs` carries the same rule
    /// (`psd-end` half → prefab, `psd-end` full → `generated:psd-end-full`).
    ///
    /// **Gates and doors use the exported pivots.** A fare gate's `wing` group holds
    /// `left-leaf`/`right-leaf`; a swing door's `passenger-swing-door` node is its hinge.
    /// The gate's lane reach, jamb and sign are measured from the prefab and checked
    /// against `GateModel`'s constants; the swing hinge's `sign` follows from which side of
    /// the pivot its leaf hangs. A fence-door gate has **no leaf channel** in the source
    /// (`gateHasLane` is false): its wings are hidden and the missing fence run is
    /// reported, never animated.
    ///
    /// No method here reads a clock or a global flag. <see cref="OpeningModuleSet.Apply(string, OpeningState)"/>
    /// is the only way a fitting moves.
    /// </summary>
    public static class OpeningModuleViews {
        /// <summary>The catalogue key for a full-height screen end assembly (generated).</summary>
        public const string PsdEndGeneratedKey = "generated:psd-end-full";
        public const string PsdEndPrefabKey = "psd-end";
        public const string PsdCoverPrefabKey = "psd-end-cover";
        public const string PlatformEdgeKey = "platform-edge";

        // `sim/constants.ts`
        public const float PsdFullHeight = 3f;
        public const float PsdHalfHeight = 1.45f;
        public const float PsdWallOffset = .34f;
        public const float PsdBaseDepth = .18f;
        public const float PsdFullDoorWidthScale = 1.5f;
        public const float PsdHeaderHeight = .6f;
        public const float PsdDoorTopGap = .05f;
        /// <summary>`GateModel.GATE_W`.</summary>
        public const float GateWidth = .30f;
        /// <summary>`DOOR_FRAME.postDepth`.</summary>
        public const float DoorPostDepth = .18f;
        /// <summary>`DOOR_FRAME.post`.</summary>
        public const float DoorPost = .06f;
        /// <summary>`CrowdSystem`'s swing limit: `π × 0.45` in degrees.</summary>
        public const float SwingMaxDegrees = 81f;
        /// <summary>`CrowdSystem`'s swing rate, per sim second.</summary>
        public const float SwingRate = 1.5f;

        /// <summary>True for the saved types this builder owns.</summary>
        public static bool Owns(string type) {
            switch (type ?? "") {
                case "platform-edge":
                case "psd-end":
                case "gate":
                case "door":
                case "cubicle": return true;
                default: return false;
            }
        }

        /// <summary>The opening kind a saved type maps to.</summary>
        public static OpeningKind KindOf(string type) {
            switch (type ?? "") {
                case "platform-edge": return OpeningKind.PsdRun;
                case "psd-end": return OpeningKind.PsdEnd;
                case "gate": return OpeningKind.Gate;
                case "door": return OpeningKind.SwingDoor;
                case "cubicle": return OpeningKind.Cubicle;
                default: return OpeningKind.None;
            }
        }

        /// <summary>`sim/track.ts` `rotateLocal`: a local (along, across) offset to plan axes.</summary>
        public static Vector2 RotateLocal(int rotation, float along, float across) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: return new Vector2(-across, along);
                case 2: return new Vector2(-along, -across);
                case 3: return new Vector2(across, -along);
                default: return new Vector2(along, across);
            }
        }

        /// <summary>`sim/psdEnds.ts` `psdEndOffset`: only a corner carries a length offset.</summary>
        public static Vector2 PsdEndOffset(bool hasCorner, float offsetX, float offsetY) =>
            new Vector2(hasCorner ? offsetX : 0f, offsetY);

        /// <summary>`sim/psdEnds.ts` `psdEndSpan`: the corner is shortened at its tile boundary.</summary>
        public static Vector2 PsdEndSpan(float offsetX) =>
            new Vector2(Mathf.Max(-.5f, -.5f - offsetX), Mathf.Min(.5f, .5f - offsetX));

        /// <summary>`sim/gates.ts` `gateHasLane`: a fence machine lets nobody through.</summary>
        public static bool GateHasLane(string door) =>
            !string.Equals(door, "fence", StringComparison.Ordinal) && !string.Equals(door, "none", StringComparison.Ordinal);

        /// <summary>`setGateWing`'s leaf width at a fraction, and the jamb it parks at.</summary>
        public static float GateLeafWidth(float fullWidth, float fraction) {
            float t = Mathf.Clamp01(fraction);
            return fullWidth * (1f - t) + .025f * t;
        }

        /// <summary>`setGateWing`'s leaf centre for an authored jamb and sign.</summary>
        public static float GateLeafCentre(float edgeX, float sign, float width) => edgeX + sign * width * .5f;

        /// <summary>`CrowdSystem`'s swing angle in degrees, about the document's up axis.</summary>
        public static float SwingDegrees(float sign, float fraction) => sign * Mathf.Clamp01(fraction) * SwingMaxDegrees;

        /// <summary>
        /// The source frame of one promoted opening piece, read from the `AxisX`/`Front`/`Up`
        /// anchors the exporter writes next to the pivot (`tools/unity-assets/export-formations.mjs`
        /// `anchors()`, `export-opening.mjs`). Two things are *not* assumed:
        /// <list type="bullet">
        /// <item><b>Which local axis is up.</b> The GLBs wrap their Z-up content in a root node
        /// rotated −90° about X, so the pivot sits in the source frame: `Z` is the piece's up
        /// and is usually the pivot's local **Z**, not the local Y.</item>
        /// <item><b>Which way x points.</b> glTF's right-handed frame becomes Unity's
        /// left-handed one on import, so the promoted content presents x negated relative to the
        /// save (the gate lane reads −0.5…0.2 for `GateModel`'s −0.2…0.5).</item>
        /// </list>
        /// Every heading and every signed offset in this packet is calibrated from these three
        /// anchors rather than assumed, so a re-export with another convention keeps the same
        /// source behaviour.
        /// </summary>
        public struct OpeningAxis {
            /// <summary>The source +x (along the run) direction in the pivot's parent frame.</summary>
            public Vector3 X;
            /// <summary>The source +y (across the piece) direction in the pivot's parent frame.</summary>
            public Vector3 Y;
            /// <summary>The source +z (**up**) direction in the pivot's parent frame.</summary>
            public Vector3 Z;
            /// <summary>+1 when the prefab frame is a rotation of the source, −1 when it is a reflection.</summary>
            public float Determinant;
            /// <summary>False when the piece carries no anchors and the document frame was assumed.</summary>
            public bool Known;
            /// <summary>True when the promoted content presents the source's +x along its own −x.</summary>
            public bool MirroredX => Known && Vector3.Dot(X, Vector3.right) < 0f;
            /// <summary>
            /// `x-negated` / `source-x` names the x convention and `det` the frame's
            /// orientation: +1 means the promoted frame is a rotation of the source (a pure x
            /// negation paired with the glTF y/z swap), −1 means it is a reflection.
            /// </summary>
            public string Describe() => Known
                ? (MirroredX ? "x-negated" : "source-x") + " det=" + Determinant.ToString("0", CultureInfo.InvariantCulture)
                : "assumed-document";
        }

        /// <summary>
        /// Read the anchor frame that belongs to `pivot`'s parent (the imported model root).
        /// The `Approach` anchor is its negative counterpart in the source and is reported
        /// through <see cref="SwingSign"/>'s sibling test, not needed here.
        /// </summary>
        public static OpeningAxis ReadAxis(Transform pivot) {
            var axis = new OpeningAxis {
                X = Vector3.right, Y = Vector3.forward, Z = Vector3.up,
                Determinant = -1f, Known = false,
            };
            var root = pivot ? pivot.parent : null;
            if (!root) return axis;
            var x = FindNode(root, "AxisX");
            var y = FindNode(root, "Front");
            var z = FindNode(root, "Up");
            if (!x || !y || !z) return axis;
            axis.X = root.InverseTransformDirection(x.position - root.position);
            axis.Y = root.InverseTransformDirection(y.position - root.position);
            axis.Z = root.InverseTransformDirection(z.position - root.position);
            if (axis.X.sqrMagnitude < .01f || axis.Y.sqrMagnitude < .01f || axis.Z.sqrMagnitude < .01f) return axis;
            axis.X.Normalize();
            axis.Y.Normalize();
            axis.Z.Normalize();
            axis.Determinant = Mathf.Sign(Vector3.Dot(axis.X, Vector3.Cross(axis.Y, axis.Z)));
            if (Mathf.Approximately(axis.Determinant, 0f)) axis.Determinant = -1f;
            axis.Known = true;
            return axis;
        }

        /// <summary>
        /// The source's local angle for a swing leaf at `fraction`: `det × sign × fraction × 81°`,
        /// measured **about <see cref="HingeAxis"/>(axis)** — the source's up axis. A heading about
        /// that axis keeps its sense across a rotation of the frame and reverses across a
        /// reflection, which is what <see cref="OpeningAxis.Determinant"/> carries.
        /// </summary>
        public static float SwingLocalDegrees(OpeningAxis axis, float sign, float fraction) =>
            axis.Determinant * SwingDegrees(sign, fraction);

        /// <summary>
        /// The hinge axis in the pivot's parent frame: the source's **up** direction.
        ///
        /// It is not assumed to be the local Y. Every opening GLB wraps its Z-up content in a
        /// root node rotated −90° about X (`matrix 1,0,0,0 / 0,0,-1,0 / 0,1,0,0`), so the pivot
        /// lives in the source frame below that node: `AxisZ` is the pivot's local **Z**, and a
        /// `Euler(0, θ, 0)` swing would sweep the leaf *across* the doorway (a 90° axis error)
        /// rather than through it. The anchors make this explicit instead of assumed.
        /// </summary>
        public static Vector3 HingeAxis(OpeningAxis axis) => axis.Known ? axis.Z : Vector3.up;

        /// <summary>The door a `door` module's variant names (`sim/doors.ts` `doorSpec`).</summary>
        public static string DoorVariantOrDefault(string variant) =>
            string.IsNullOrEmpty(variant) ? "steel-1" : variant;

        /* ----------------------------------------------------------------- PSD run */

        /// <summary>
        /// Port of `buildPsd`'s door arithmetic for one saved run. Returns false only when
        /// the record cannot describe a screen at all (no width, or `psd: none`); a missing
        /// rail or line falls back exactly as the source does and says so in
        /// <see cref="PsdRunLayout.Diagnostic"/>.
        /// </summary>
        public static bool TryPsdRun(PsdRunRequest request, out PsdRunLayout layout, out string diagnostic) {
            layout = new PsdRunLayout {
                ModuleId = request.ModuleId ?? "",
                Length = Mathf.Max(1, request.Width),
                Left = !string.Equals(request.Side, "right", StringComparison.Ordinal),
                StoreyHeight = request.StoreyHeight > 0 ? request.StoreyHeight : StationCoordinates.StoreyHeight,
                HasLine = request.HasLine,
                Stock = request.Stock ?? "",
                Cars = request.Cars,
                ModelScale = request.ModelScale > 0f ? request.ModelScale : 1f,
            };
            diagnostic = "";
            bool half = string.Equals(request.Psd, "half", StringComparison.Ordinal);
            if (string.Equals(request.Psd, "none", StringComparison.Ordinal)) {
                diagnostic = "psd-none:no-leaves";
                return false;
            }
            var layoutRef = layout;
            layoutRef.WallOffset = layoutRef.Left ? -PsdWallOffset : PsdWallOffset;
            float toward = layoutRef.Left ? -1f : 1f;
            float x0 = -.5f;
            float len = layoutRef.Length;
            layoutRef.RunStart = x0;

            layoutRef.DoorHeight = half ? (PsdHalfHeight - .05f) - .12f : PsdFullHeight - PsdDoorTopGap - PsdHeaderHeight;
            layoutRef.GlassHeight = layoutRef.DoorHeight;
            layoutRef.DoorWidth = 0f;
            layoutRef.GlassMid = 1f + layoutRef.GlassHeight * .5f;
            layoutRef.LeafMid = 1f + layoutRef.DoorHeight * .5f;
            layoutRef.FixedFrameDepth = half ? .10f : .14f;
            layoutRef.SlideOffset = layoutRef.FixedFrameDepth * .5f;
            float sillTrackReach = layoutRef.SlideOffset + (half ? .10f : .12f) + .01f;
            layoutRef.SillDepth = PsdBaseDepth * .5f + sillTrackReach;
            layoutRef.SillY = layoutRef.WallOffset + toward * (sillTrackReach - PsdBaseDepth * .5f) * .5f;
            layoutRef.LeafY = layoutRef.WallOffset + toward * layoutRef.SlideOffset;

            // The cadence is measured from the consist centre, which is the rail's centre —
            // not this edge's, which may cover only part of the bed.
            float bedWidth = request.HasTrack && request.TrackWidth > 0 ? request.TrackWidth : len;
            layoutRef.BedWidth = bedWidth;
            float i0;
            if (request.HasTrack) {
                var local = RotateLocal(-request.TrackRotation, request.X - request.TrackX, request.Y - request.TrackY);
                i0 = local.x;
            } else {
                i0 = (bedWidth - len) * .5f;
                diagnostic = Append(diagnostic, "no-rail:assumed-centred");
            }
            if (!request.HasLine) diagnostic = Append(diagnostic, "no-line:default-stock");
            string stock = request.HasLine ? request.Stock : "A";
            int cars = request.HasLine && request.Cars > 0 ? request.Cars : 1;
            float scale = layoutRef.ModelScale;
            float widthScale = half ? 1f : PsdFullDoorWidthScale;

            var offsets = TrainConsist.DoorRunOffsets(stock, cars, scale, Mathf.RoundToInt(bedWidth));
            var accepted = new List<PsdOpening>();
            foreach (var offset in offsets) {
                float centre = offset - i0 + x0;
                float width = TrainConsist.DoorWidthAt(stock, cars, scale, centre + i0 - x0 - bedWidth * .5f) * widthScale;
                if (centre - width * .5f <= x0 + .1f) continue;
                if (centre + width * .5f >= x0 + len - .1f) continue;
                accepted.Add(new PsdOpening {
                    Index = accepted.Count,
                    Centre = centre,
                    Width = width,
                    Travel = width * .5f,
                    LeafWidth = width * .5f + .20f,
                });
            }
            accepted.Sort((a, b) => a.Centre.CompareTo(b.Centre));
            for (int i = 0; i < accepted.Count; i++) {
                var opening = accepted[i];
                opening.Index = i;
                accepted[i] = opening;
                layoutRef.Openings.Add(opening);
            }
            layoutRef.DoorWidth = layoutRef.Openings.Count > 0 ? layoutRef.Openings[0].Width : 0f;
            layoutRef.Travel = layoutRef.Openings.Count > 0 ? layoutRef.Openings[0].Travel : 0f;
            layoutRef.LeafWidth = layoutRef.Openings.Count > 0 ? layoutRef.Openings[0].LeafWidth : 0f;

            // Fixed panes, jambs and the structural pillars between sections.
            float cursor = x0;
            foreach (var opening in layoutRef.Openings) {
                float start = opening.Centre - opening.Width * .5f;
                if (start - cursor > .05f) layoutRef.Panels.Add(new Vector2(cursor, start));
                layoutRef.Posts.Add(start);
                layoutRef.Posts.Add(start + opening.Width);
                cursor = start + opening.Width;
            }
            if (x0 + len - cursor > .05f) layoutRef.Panels.Add(new Vector2(cursor, x0 + len));
            if (!half) {
                layoutRef.Posts.Add(x0 + .04f);
                layoutRef.Posts.Add(x0 + len - .04f);
            }
            layoutRef.Pillars.Add(x0 + .08f);
            for (int i = 1; i < layoutRef.Openings.Count; i++)
                layoutRef.Pillars.Add((layoutRef.Openings[i - 1].Centre + layoutRef.Openings[i].Centre) * .5f);
            layoutRef.Pillars.Add(x0 + len - .08f);
            if (layoutRef.Openings.Count == 0)
                diagnostic = Append(diagnostic, "no-openings:cadence-outside-run");
            layout = layoutRef;
            return layout.Openings.Count > 0 || layout.Panels.Count > 0;
        }

        static string Append(string current, string code) =>
            string.IsNullOrEmpty(current) ? code : current + "; " + code;

        /* ------------------------------------------------------------- framing */

        /// <summary>Source-local (along, across, up) → the module holder's local Unity axes.</summary>
        public static Vector3 Local(float x, float y, float z) => new Vector3(x, z, y);

        /// <summary>Source-local size (along, across, up) → the module holder's local axes.</summary>
        public static Vector3 LocalSize(float sx, float sy, float sz) => new Vector3(sx, sz, sy);

        /// <summary>
        /// The document-space pivot a catalogue entry records, rotated with the module.
        /// `entry.offset` is the source group's position in cell-relative document axes, so
        /// subtracting the cell anchor leaves the piece's own local offset, which the saved
        /// quarter turn then rotates exactly as `rotateLocal` does in the source.
        /// </summary>
        public static Vector3 Pivot(ModuleFacts module, Vector3 entryOffset, bool floorTop) {
            float rise = floorTop ? 1f : 0f;
            var anchor = StationCoordinates.Point(new Vector3(module.X + .5f, module.Y + .5f, module.Z + rise));
            var localDocument = entryOffset - new Vector3(.5f, .5f, floorTop ? 1f : 0f);
            return anchor + ModulePlacement.Rotation(module.Rotation) * Local(localDocument.x, localDocument.y, localDocument.z);
        }

        /* --------------------------------------------------------------- building */

        /// <summary>
        /// Build every opening module of a station under `parent`, in document order, and
        /// report one <see cref="OpeningView"/> per built module. The caller owns `parent`;
        /// a module that cannot be drawn is reported through `unresolved` and draws nothing.
        /// </summary>
        public static int BuildAll(IReadOnlyList<StationModuleRecord> station, StationIndex index, RuntimeCatalogue catalogue,
            Transform parent, OpeningPalette paint, OpeningModuleSet target, Action<StationModuleRecord, OpeningView> built,
            Action<StationModuleRecord, string> unresolved) {
            if (station == null || parent == null || target == null) return 0;
            var facts = new ModuleFacts[station.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = station[i]?.Facts;
            int count = 0;
            for (int i = 0; i < station.Count; i++) {
                var module = station[i];
                if (module == null || !Owns(module.Type)) continue;
                var request = RequestFor(module, index);
                if (!TryBuild(request, station[i].Facts, facts, catalogue, parent, paint, out var view)) {
                    unresolved?.Invoke(module, view.Diagnostic);
                    continue;
                }
                target.Add(view);
                count++;
                built?.Invoke(module, view);
            }
            return count;
        }

        /// <summary>Everything one module's build reads, flattened out of the document records.</summary>
        public struct OpeningRequest {
            public string ModuleId;
            public string Type;
            public string ViewKey;
            public int X, Y, Z, Rotation, Width, Depth;
            public int StoreyHeight;
            public string Variant, Mount, Psd, Side, Door, Dir, LineId, TrackId;
            public bool HasCorner;
            public float OffsetX, OffsetY;
            public bool HasWidth, HasDepth;
            public float ConfigWidth, ConfigDepth;
            public bool HasTrack;
            public int TrackX, TrackY, TrackRotation, TrackWidth;
            public bool HasLine;
            public string Stock;
            public int Cars;
            public float ModelScale;
            public GameObject Prefab;
            public RuntimeCatalogue Catalogue;
        }

        /// <summary>Flatten one document record (and its rail/line) into a request.</summary>
        public static OpeningRequest RequestFor(StationModuleRecord module, StationIndex index) {
            var cfg = module.Config ?? ModuleConfig.Empty;
            var request = new OpeningRequest {
                ModuleId = module.Id,
                Type = module.Type,
                X = module.X, Y = module.Y, Z = module.Z,
                Rotation = module.Rotation,
                Width = module.Width,
                Depth = module.Depth,
                StoreyHeight = index?.StoreyHeight ?? StationCoordinates.StoreyHeight,
                Variant = cfg.Text("variant"),
                Mount = cfg.Text("mount"),
                Psd = cfg.Text("psd"),
                Side = cfg.Text("side"),
                Door = cfg.Text("door"),
                Dir = cfg.Text("dir"),
                LineId = cfg.Text("line"),
                TrackId = cfg.Text("from"),
                HasCorner = cfg.Has("corner") && cfg.Text("corner").Length > 0,
                HasWidth = cfg.Has("width"),
                HasDepth = cfg.Has("depth"),
                ConfigWidth = (float)cfg.Number("width", 0),
                ConfigDepth = (float)cfg.Number("depth", 0),
            };
            if (cfg.TryNumbers("offset", out var offset) && offset.Length >= 2) {
                request.OffsetX = (float)offset[0];
                request.OffsetY = (float)offset[1];
            }
            if (request.Type == "platform-edge" && !string.IsNullOrEmpty(request.TrackId) && index != null &&
                index.TryGetModule(request.TrackId, out var track)) {
                request.HasTrack = true;
                request.TrackX = track.X;
                request.TrackY = track.Y;
                request.TrackRotation = track.Rotation;
                request.TrackWidth = track.Width;
            }
            var line = LineOf(index, request.Type == "platform-edge" ? request.LineId : "");
            if (line != null) {
                request.HasLine = true;
                request.Stock = line.Stock;
                request.Cars = line.Cars;
                request.ModelScale = ModelScaleOf(line);
                // `buildPsd` reads `cfg.psd ?? line.psd`: a record that names no height takes
                // the line's own screen height.
                if (string.IsNullOrEmpty(request.Psd)) request.Psd = line.Psd ?? "";
            }
            return request;
        }

        /// <summary>The saved line record with this id, or null.</summary>
        public static StationLineRecord LineOf(StationIndex index, string lineId) {
            var lines = index?.Lines;
            if (lines == null) return null;
            for (int i = 0; i < lines.Count; i++)
                if (string.Equals(lines[i].Id, lineId, StringComparison.Ordinal)) return lines[i];
            return null;
        }

        /// <summary>
        /// `modelScale` is not projected on <see cref="StationLineRecord"/>, so it is read from
        /// the record's own authored JSON — the same value `sim/stock.ts` `trainScaleForStorey`
        /// defaults to when a line stores none.
        /// </summary>
        public static float ModelScaleOf(StationLineRecord line) {
            if (line == null || string.IsNullOrEmpty(line.RawJson)) return .98f;
            try {
                var record = JObject.Parse(line.RawJson);
                var value = record["modelScale"];
                if (value != null) return Mathf.Max(.1f, (float)value);
            } catch (Exception) { /* an unreadable record falls back to the storey's scale */ }
            return .98f;
        }

        /// <summary>
        /// Build one module. Returns false with <see cref="OpeningView.Diagnostic"/> set and
        /// nothing drawn when the record cannot be honoured; a fixed end or cover returns
        /// true with <see cref="OpeningView.Movable"/> false.
        /// </summary>
        public static bool TryBuild(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform parent, OpeningPalette paint, out OpeningView view) {
            view = new OpeningView {
                Kind = KindOf(request.Type),
                ModuleId = request.ModuleId ?? "",
                Type = request.Type ?? "",
                LineId = request.LineId ?? "",
                TrackId = request.TrackId ?? "",
            };
            if (parent == null) return Fail(view, "no-parent");
            if (facts == null) return Fail(view, "no-facts");
            if (!Owns(request.Type)) return Fail(view, "unsupported-type:" + request.Type);
            switch (view.Kind) {
                case OpeningKind.PsdRun: return BuildRun(request, facts, catalogue, parent, paint, view);
                case OpeningKind.PsdEnd:
                case OpeningKind.PsdCover: return BuildEnd(request, facts, catalogue, parent, paint, view);
                case OpeningKind.Gate: return BuildGate(request, facts, station, catalogue, parent, view);
                case OpeningKind.SwingDoor: return BuildDoor(request, facts, station, catalogue, parent, view);
                case OpeningKind.Cubicle: return BuildCubicle(request, facts, catalogue, parent, view);
                default: return Fail(view, "unsupported-type:" + request.Type);
            }
        }

        /* ------------------------------------------------------------- the PSD run */

        static bool BuildRun(OpeningRequest request, ModuleFacts facts, RuntimeCatalogue catalogue, Transform parent,
            OpeningPalette paint, OpeningView view) {
            var run = new PsdRunRequest {
                ModuleId = request.ModuleId,
                X = request.X, Y = request.Y, Z = request.Z,
                Rotation = request.Rotation, Width = request.Width,
                Side = request.Side, Psd = request.Psd, StoreyHeight = request.StoreyHeight,
                HasTrack = request.HasTrack,
                TrackX = request.TrackX, TrackY = request.TrackY,
                TrackRotation = request.TrackRotation, TrackWidth = request.TrackWidth,
                HasLine = request.HasLine, Stock = request.Stock, Cars = request.Cars,
                ModelScale = request.ModelScale,
            };
            if (string.Equals(request.Psd, "none", StringComparison.Ordinal)) {
                // `buildPsd` still draws the platform's safety line where the screen is absent.
                var bare = Holder(parent, request.ModuleId, facts);
                if (bare == null) return Fail(view, "no-holder");
                view.Holder = bare;
                view.Instance = bare.gameObject;
                view.ViewKey = PlatformEdgeKey + ":none";
                view.OpeningCount = 0;
                view.Movable = false;
                view.Diagnostic = "psd-none:no-screen";
                return true;
            }
            if (!TryPsdRun(run, out var layout, out var diagnostic)) return Fail(view, diagnostic);
            var holder = Holder(parent, request.ModuleId, facts);
            if (holder == null) return Fail(view, "no-holder");
            view.Holder = holder;
            view.Run = layout;
            view.ViewKey = PlatformEdgeKey;
            view.PrefabPath = "";
            view.OpeningCount = layout.Openings.Count;
            view.OpeningCentres = layout.Openings.Select(opening => opening.Centre).ToArray();
            var cavity = new OpeningBuilder(holder, paint);
            bool half = string.Equals(request.Psd, "half", StringComparison.Ordinal);
            float toward = layout.Left ? -1f : 1f;
            float len = layout.Length;
            float x0 = layout.RunStart;
            float cx = x0 + len * .5f;
            float wall = layout.WallOffset;
            const float z0 = 1f;

            // Sill, foundation, fascia and the fascia's line-colour band.
            cavity.Box(OpeningColour.Black, Local(cx, layout.SillY, z0 - .01f), LocalSize(len, layout.SillDepth, .02f));
            cavity.Box(OpeningColour.Concrete, Local(cx, layout.SillY, z0 - .51f), LocalSize(len, layout.SillDepth, .98f));
            if (!half) {
                float headerBottom = layout.GlassHeight;
                cavity.Box(OpeningColour.White, Local(cx, wall, z0 + headerBottom + PsdHeaderHeight * .5f),
                    LocalSize(len, .24f, PsdHeaderHeight));
                cavity.Box(OpeningColour.Black, Local(cx, wall, z0 + PsdFullHeight - .025f), LocalSize(len, .28f, .05f));
                cavity.Box(OpeningColour.Line, Local(cx, wall - toward * .13f, z0 + headerBottom + .012f),
                    LocalSize(len, .03f, .025f));
            } else {
                cavity.Box(OpeningColour.Black, Local(cx, wall, z0 + PsdHalfHeight - .025f), LocalSize(len, .10f, .05f));
            }
            cavity.Box(OpeningColour.Red, Local(cx, wall, z0 + .003f), LocalSize(len, .03f, .006f));

            foreach (var panel in layout.Panels) {
                float width = panel.y - panel.x;
                if (width <= .05f) continue;
                float mid = (panel.x + panel.y) * .5f;
                cavity.Box(OpeningColour.Glass, Local(mid, wall, layout.GlassMid),
                    LocalSize(width, .012f, layout.GlassHeight));
                if (half) {
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + PsdHalfHeight - .05f - .06f),
                        LocalSize(width, .08f, .12f));
                } else {
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + .03f), LocalSize(width, .12f, .06f));
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + layout.GlassHeight - .03f),
                        LocalSize(width, .12f, .06f));
                }
            }
            foreach (var post in layout.Posts)
                cavity.Box(OpeningColour.Black, Local(post, wall, layout.GlassMid),
                    LocalSize(.08f, layout.FixedFrameDepth, layout.GlassHeight));
            foreach (var pillar in layout.Pillars)
                cavity.Box(OpeningColour.Black, Local(pillar, wall, layout.GlassMid),
                    LocalSize(.16f, layout.FixedFrameDepth, layout.GlassHeight));

            // The moving leaves: tinted glass plus its frame, meeting frame and rails. Each
            // opening owns two leaves, and the pair parts by exactly one door width.
            foreach (var opening in layout.Openings) {
                for (int side = 0; side < 2; side++) {
                    float sign = side == 0 ? -1f : 1f;
                    float leafX = opening.Centre + sign * opening.LeafWidth * .5f;
                    var node = cavity.Node("psd-leaf-" + opening.Index.ToString("00", CultureInfo.InvariantCulture) +
                        (side == 0 ? "-left" : "-right"), Local(leafX, layout.LeafY, layout.LeafMid));
                    if (node == null) continue;
                    var parts = new OpeningBuilder(node, paint);
                    parts.Box(OpeningColour.MovingGlass, Vector3.zero, LocalSize(opening.LeafWidth, .02f, layout.DoorHeight));
                    // All opaque fittings sit track-side of their glass plane.
                    float frameX = sign * (opening.Width * .5f + .20f - .03f - opening.LeafWidth * .5f);
                    parts.Box(OpeningColour.Black, Local(frameX, toward * .06f, 0f),
                        LocalSize(.06f, .12f, layout.DoorHeight));
                    parts.Box(OpeningColour.Black, Local(sign * .015f - sign * opening.LeafWidth * .5f, toward * .06f, 0f),
                        LocalSize(.03f, .12f, layout.DoorHeight));
                    if (!half) {
                        parts.Box(OpeningColour.Black, Local(0f, toward * .06f, z0 + .03f - layout.LeafMid),
                            LocalSize(opening.LeafWidth, .12f, .06f));
                        parts.Box(OpeningColour.Black, Local(0f, toward * .06f, z0 + layout.DoorHeight - .03f - layout.LeafMid),
                            LocalSize(opening.LeafWidth, .12f, .06f));
                    }
                    parts.Finish(request.ModuleId + " leaf");
                    view.leaves.Add(new OpeningLeaf {
                        Name = node.name,
                        LeafKind = OpeningLeafKind.Slide,
                        Node = node,
                        Opening = opening.Index,
                        Closed = node.localPosition,
                        Travel = opening.Travel,
                        Sign = sign,
                        AuthoredScale = node.localScale,
                    });
                }
            }
            cavity.Finish(request.ModuleId);
            view.Instance = holder.gameObject;
            view.Movable = view.leaves.Count > 0;
            view.Diagnostic = Append(diagnostic, "decals-unported:sign-face-engine");
            view.Diagnostic = Append(view.Diagnostic, "prefab-housing-unused:run-exceeds-fixture");
            return true;
        }

        /* --------------------------------------------------------- fixed PSD ends */

        static bool BuildEnd(OpeningRequest request, ModuleFacts facts, RuntimeCatalogue catalogue, Transform parent,
            OpeningPalette paint, OpeningView view) {
            bool cover = string.Equals(request.Variant, "cover", StringComparison.Ordinal);
            bool half = string.Equals(request.Psd, "half", StringComparison.Ordinal);
            view.Kind = cover ? OpeningKind.PsdCover : OpeningKind.PsdEnd;
            view.OpeningCount = 0;
            // An end panel applies `psdEndOffset`: only a corner carries a length offset, so a
            // stray saved x offset on a continuation must not move it. A cover course reads
            // its own `cfg.offset` verbatim (`PsdEndModel`). Both offsets act on the fittings,
            // never on the module's own pivot.
            var endOffset = PsdEndOffset(request.HasCorner, request.OffsetX, request.OffsetY);
            var holder = Holder(parent, request.ModuleId, facts, floorTop: false);
            if (holder == null) return Fail(view, "no-holder");
            view.Holder = holder;

            if (cover) {
                // `PsdEndModel`: one white box (width x depth x 1 m) whose base sits at the
                // record's own elevation, so the course stacks above the screen.
                float width = request.HasWidth ? request.ConfigWidth : 1f;
                float depth = request.HasDepth ? request.ConfigDepth : .24f;
                float sideY = string.Equals(request.Side, "right", StringComparison.Ordinal) ? .34f : -.34f;
                var place = Local(request.OffsetX, 0f, request.OffsetY);
                if (TryPrefab(request, catalogue, PsdCoverPrefabKey, holder, view, out var coverInstance) &&
                    PlanExtentsMatch(coverInstance, holder, width, depth)) {
                    // The prefab's panel is baked at the canonical offset; a saved offset moves
                    // the whole course.
                    coverInstance.transform.localPosition = place;
                    view.Instance = coverInstance;
                    view.ViewKey = PsdCoverPrefabKey;
                    view.Movable = false;
                    return true;
                }
                if (coverInstance) Discard(coverInstance);
                var box = new OpeningBuilder(holder, paint);
                box.Box(OpeningColour.White, Local(request.OffsetX, sideY + request.OffsetY, .5f),
                    LocalSize(width, depth, 1f));
                box.Finish(request.ModuleId);
                view.Instance = holder.gameObject;
                view.ViewKey = PsdEndGeneratedKey + ":cover";
                view.PrefabPath = "";
                view.Movable = false;
                view.Diagnostic = "prefab-extent-mismatch:cover " +
                    width.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
                    depth.ToString("0.###", CultureInfo.InvariantCulture);
                return true;
            }

            if (half && TryPrefab(request, catalogue, PsdEndPrefabKey, holder, view, out var halfInstance)) {
                halfInstance.transform.localPosition = Local(endOffset.x, 0f, endOffset.y);
                view.Instance = halfInstance;
                view.ViewKey = PsdEndPrefabKey;
                view.Movable = false;
                return true;
            }
            if (half && view.Instance) { Discard(view.Instance); view.Instance = null; }

            // Full height: the end assembly `PsdEndModel` builds at the saved span. The
            // promoted `PsdEnd` is the half-height course, so it cannot serve here.
            var span = PsdEndSpan(endOffset.x);
            float ox = endOffset.x;
            float oy = endOffset.y;
            float x0 = span.x;
            float len = span.y - span.x;
            if (len <= .01f) return Fail(view, "empty-span");
            float wall = -PsdWallOffset;
            const float z0 = 1f;
            float doorH = PsdFullHeight - PsdDoorTopGap - PsdHeaderHeight;
            float glassMid = z0 + doorH * .5f;
            float cx = x0 + len * .5f;
            float slideOffset = .07f;
            float sillReach = slideOffset + .12f + .01f;
            float sillDepth = PsdBaseDepth * .5f + sillReach;
            float sillY = wall + (sillReach - PsdBaseDepth * .5f) * .5f;

            var cavity = new OpeningBuilder(holder, paint);
            float shiftX = ox;
            float shiftY = oy;
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, sillY + shiftY, z0 - .01f), LocalSize(len, sillDepth, .02f));
            cavity.Box(OpeningColour.Concrete, Local(cx + shiftX, sillY + shiftY, z0 - .51f), LocalSize(len, sillDepth, .98f));
            cavity.Box(OpeningColour.White, Local(cx + shiftX, wall + shiftY, z0 + doorH + PsdHeaderHeight * .5f),
                LocalSize(len, .24f, PsdHeaderHeight));
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + PsdFullHeight - .025f),
                LocalSize(len, .28f, .05f));
            cavity.Box(OpeningColour.Red, Local(cx + shiftX, wall + shiftY, z0 + .003f), LocalSize(len, .03f, .006f));
            cavity.Box(OpeningColour.Glass, Local(cx + shiftX, wall + shiftY, glassMid), LocalSize(len, .012f, doorH));
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + .03f), LocalSize(len, .12f, .06f));
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + doorH - .03f),
                LocalSize(len, .12f, .06f));
            foreach (var post in new[] { x0 + .04f, x0 + len - .04f })
                cavity.Box(OpeningColour.Black, Local(post + shiftX, wall + shiftY, glassMid), LocalSize(.08f, .14f, doorH));
            foreach (var pillar in new[] { x0 + .08f, x0 + len - .08f })
                cavity.Box(OpeningColour.Black, Local(pillar + shiftX, wall + shiftY, glassMid),
                    LocalSize(.16f, .14f, doorH));
            cavity.Finish(request.ModuleId);
            view.Instance = holder.gameObject;
            view.ViewKey = PsdEndGeneratedKey;
            view.Movable = false;
            view.Diagnostic = half ? "half-prefab-missing:generated" : "prefab-half-height:generated-full";
            return true;
        }

        static bool TryPrefab(OpeningRequest request, RuntimeCatalogue catalogue, string key, Transform holder,
            OpeningView view, out GameObject instance) {
            instance = null;
            if (catalogue == null || !catalogue.TryGet(key, out var entry) || entry.prefab == null) return false;
            instance = UnityEngine.Object.Instantiate(entry.prefab, holder, false);
            instance.name = string.IsNullOrEmpty(request.ModuleId) ? entry.prefab.name : request.ModuleId;
            view.PrefabPath = entry.prefabPath ?? "";
            return true;
        }

        /// <summary>The measured plan extents of an instance, in its holder's local document axes.</summary>
        static bool PlanExtentsMatch(GameObject instance, Transform holder, float width, float depth) {
            if (!instance || !holder) return false;
            if (!MeshBoundsIn(instance.transform, holder, out var bounds)) return false;
            return Mathf.Abs(bounds.size.x - width) <= .02f && Mathf.Abs(bounds.size.z - depth) <= .02f;
        }

        /* ------------------------------------------------------------------ gates */

        static bool BuildGate(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform parent, OpeningView view) {
            var visual = ModuleViews.Resolve(facts, station, catalogue);
            if (!visual.HasModel) return Fail(view, "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view"));
            if (catalogue == null || !catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null)
                return Fail(view, "no-prefab:" + visual.Key);
            var holder = Holder(parent, request.ModuleId, facts);
            if (holder == null) return Fail(view, "no-holder");
            var instance = UnityEngine.Object.Instantiate(entry.prefab, holder, false);
            instance.name = request.ModuleId;
            view.Holder = holder;
            view.Instance = instance;
            view.ViewKey = visual.Key;
            view.PrefabPath = entry.prefabPath ?? "";
            view.OpeningCount = 1;

            var wing = FindNode(instance.transform, "wing");
            bool lane = GateHasLane(request.Door);
            if (wing == null) {
                if (lane) return FailAndDiscard(view, "gate-has-no-wing");
                view.Movable = false;
                view.Diagnostic = "fence-door:no-fence-panel";
                return true;
            }
            if (!lane) {
                // A fence machine has no leaf channel: the source draws a fence panel through
                // the lane. B3 must not animate the exported wings in its place.
                wing.gameObject.SetActive(false);
                view.Movable = false;
                view.Diagnostic = "fence-door:leaves-hidden; fence-run-unported";
                return true;
            }
            var left = FindNode(wing, "left-leaf");
            var right = FindNode(wing, "right-leaf");
            if (left == null || right == null) return FailAndDiscard(view, "gate-leaves-missing");
            // `GateModel`: the two wings span the lane exactly at shut, so the lane's own
            // extent and each wing's jamb/sign are measured rather than assumed. The wing's
            // `sign` follows from which end of the lane it grows from, not from its name, so
            // the law holds whatever handedness the promotion baked in.
            if (!TryMeasureGateLane(instance.transform, out var nearJamb, out var farJamb, out var full))
                return FailAndDiscard(view, "gate-lane-unmeasurable");
            if (!TryMeasureGateWing(wing, left, nearJamb, farJamb, out var leftEdge, out var leftSign) ||
                !TryMeasureGateWing(wing, right, nearJamb, farJamb, out var rightEdge, out var rightSign))
                return FailAndDiscard(view, "gate-wing-outside-lane");
            AddWing(view, left, leftEdge, full, leftSign);
            AddWing(view, right, rightEdge, full, rightSign);
            view.Movable = true;
            view.AxisConvention = GateLaneMirrored(nearJamb, farJamb) ? "x-negated" : "source-x";
            // The law starts at the authored shut pose, so the strongest check is that the
            // measured jambs reproduce `GateModel`'s lane up to the promoted handedness and
            // that each wing's authored centre is what the law writes at fraction 0.
            bool laneOk = GateGeometryMatchesSource(nearJamb, farJamb, full);
            bool poseOk = ShutPoseMatches(view, full);
            view.Diagnostic = laneOk && poseOk
                ? ""
                : "gate-lane-differs:GATE_W " + nearJamb.ToString("0.###", CultureInfo.InvariantCulture) + ".." +
                  farJamb.ToString("0.###", CultureInfo.InvariantCulture) + " wing=" +
                  full.ToString("0.###", CultureInfo.InvariantCulture) + " lane=" + laneOk + " pose=" + poseOk;
            return true;
        }

        /// <summary>True when every wing's authored centre is the pose `setGateWing(0)` writes.</summary>
        static bool ShutPoseMatches(OpeningView view, float fullWidth) {
            if (view == null) return false;
            foreach (var leaf in view.leaves) {
                if (leaf.LeafKind != OpeningLeafKind.GateWing) continue;
                float expected = GateLeafCentre(leaf.GateEdge, leaf.Sign, fullWidth);
                if (Mathf.Abs(leaf.Closed.x - expected) > .02f) return false;
            }
            return true;
        }

        /// <summary>
        /// `Gate.prefab`'s own lane: the near jamb, the far jamb and one wing's width.
        /// </summary>
        public static bool TryMeasureGateLane(Transform gate, out float nearJamb, out float farJamb, out float wingWidth) {
            nearJamb = farJamb = wingWidth = 0f;
            var wing = FindNode(gate, "wing");
            if (!wing) wing = gate;
            var left = FindNode(wing, "left-leaf");
            var right = FindNode(wing, "right-leaf");
            if (!left || !right) return false;
            var a = LeafLocalExtentX(left, wing);
            var b = LeafLocalExtentX(right, wing);
            nearJamb = Mathf.Min(a.x, b.x);
            farJamb = Mathf.Max(a.y, b.y);
            wingWidth = (farJamb - nearJamb) * .5f;
            return farJamb - nearJamb > .05f;
        }

        /// <summary>
        /// The jamb one exported wing retracts to, and the sign that says which way it grows:
        /// +1 for the wing whose own extent starts at the lane's near jamb, −1 for the far one.
        /// </summary>
        public static bool TryMeasureGateWing(Transform wing, Transform leaf, float nearJamb, float farJamb,
            out float edge, out float sign) {
            edge = 0f;
            sign = 0f;
            if (!wing || !leaf) return false;
            var extent = LeafLocalExtentX(leaf, wing);
            bool atNear = Mathf.Abs(extent.x - nearJamb) <= Mathf.Abs(extent.y - farJamb);
            if (atNear) { edge = nearJamb; sign = 1f; } else { edge = farJamb; sign = -1f; }
            // The wing must actually be a leaf of this lane, not a stray mesh.
            return extent.y - extent.x > .05f && extent.y - extent.x <= (farJamb - nearJamb) + .02f;
        }

        static void AddWing(OpeningView view, Transform leaf, float edge, float fullWidth, float sign) {
            view.leaves.Add(new OpeningLeaf {
                Name = leaf.name,
                LeafKind = OpeningLeafKind.GateWing,
                Node = leaf,
                Opening = 0,
                Closed = leaf.localPosition,
                Sign = sign,
                GateEdge = edge,
                GateFullWidth = fullWidth,
                AuthoredScale = leaf.localScale,
            });
        }

        /// <summary>
        /// A leaf's own x extent inside `space`, packed as `(min, max)` in the vector's x/z.
        /// The mesh's local geometry is centred on the leaf's own origin, so the extent is the
        /// authored position plus the geometry's bounds — no pose assumption.
        /// </summary>
        static Vector2 LeafLocalExtentX(Transform leaf, Transform space) {
            if (!MeshBoundsIn(leaf, space, out var geometry)) {
                var position = space.InverseTransformPoint(leaf.position);
                return new Vector2(position.x, position.x);
            }
            return new Vector2(geometry.min.x, geometry.max.x);
        }

        /// <summary>
        /// The mesh bounds of `content` expressed in `space`'s local frame. It reads
        /// <see cref="MeshFilter.sharedMesh"/> rather than <c>Renderer.bounds</c>, so it is
        /// valid while the staged world root is still inactive.
        /// </summary>
        public static bool MeshBoundsIn(Transform content, Transform space, out Bounds bounds) {
            bounds = default;
            if (!content || !space) return false;
            bool first = true;
            foreach (var filter in content.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter ? filter.sharedMesh : null;
                if (!mesh) continue;
                var local = mesh.bounds;
                for (int corner = 0; corner < 8; corner++) {
                    var point = new Vector3(
                        (corner & 1) == 0 ? local.min.x : local.max.x,
                        (corner & 2) == 0 ? local.min.y : local.max.y,
                        (corner & 4) == 0 ? local.min.z : local.max.z);
                    var inSpace = space.InverseTransformPoint(filter.transform.TransformPoint(point));
                    if (first) { bounds = new Bounds(inSpace, Vector3.zero); first = false; }
                    else bounds.Encapsulate(inSpace);
                }
            }
            return !first;
        }

        /// <summary>`GateModel`'s lane: `inner = −(0.5 − GATE_W)` to `0.5`, one wing = half.</summary>
        public static bool GateGeometryMatchesSource(float nearJamb, float farJamb, float fullWidth, float tolerance = .02f) {
            float inner = -(0.5f - GateWidth), far = .5f;
            if (Mathf.Abs(fullWidth - (far - inner) * .5f) > tolerance) return false;
            // The promoted prefab may bake the save's x mirror (glTFast's handedness flip), so
            // the lane is allowed to arrive either as inner…far or as its negative image.
            bool direct = Mathf.Abs(nearJamb - inner) <= tolerance && Mathf.Abs(farJamb - far) <= tolerance;
            bool mirrored = Mathf.Abs(nearJamb + far) <= tolerance && Mathf.Abs(farJamb + inner) <= tolerance;
            return direct || mirrored;
        }

        /// <summary>True when the promoted lane reads as the x mirror of `GateModel`'s inner…far.</summary>
        public static bool GateLaneMirrored(float nearJamb, float farJamb) =>
            Mathf.Abs(nearJamb + .5f) < Mathf.Abs(nearJamb + (0.5f - GateWidth));

        /// <summary>
        /// The source's local hinge sign for one swing leaf: −1 when the leaf hangs along the
        /// source's +x from its hinge (the single door, the first leaf of a pair, the cubicle),
        /// +1 when it hangs the other way. Read through <see cref="OpeningAxis"/> so it holds in
        /// either promoted handedness.
        /// </summary>
        public static float SwingSign(Transform pivot) => SwingSign(pivot, ReadAxis(pivot));

        /// <summary>The hinge sign in an explicit source frame.</summary>
        public static float SwingSign(Transform pivot, OpeningAxis axis) {
            if (!pivot) return -1f;
            if (!MeshBoundsIn(pivot, pivot, out var bounds)) return -1f;
            // The leaf's centre relative to its hinge, in the pivot's parent frame.
            var world = pivot.TransformPoint(bounds.center);
            var inParent = pivot.parent ? pivot.parent.InverseTransformPoint(world) : world;
            var hang = inParent - pivot.localPosition;
            return Vector3.Dot(hang, axis.X) > 0f ? -1f : 1f;
        }

        /* ------------------------------------------------------------------ doors */

        static bool BuildDoor(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform parent, OpeningView view) {
            var visual = ModuleViews.Resolve(facts, station, catalogue);
            if (!visual.HasModel) return Fail(view, "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view"));
            if (catalogue == null || !catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null)
                return Fail(view, "no-prefab:" + visual.Key);
            // The doorway's line sits one frame half-depth inside the anchor cell's leading
            // edge and turns with the piece (`DoorModel.buildStandingDoor` EDGE_IN).
            float edgeIn = DoorPostDepth * .5f - .5f;
            var holder = Holder(parent, request.ModuleId, facts, floorTop: true,
                extraLocal: new Vector3(0f, 0f, edgeIn));
            if (holder == null) return Fail(view, "no-holder");
            var instance = UnityEngine.Object.Instantiate(entry.prefab, holder, false);
            instance.name = request.ModuleId;
            view.Holder = holder;
            view.Instance = instance;
            view.ViewKey = visual.Key;
            view.PrefabPath = entry.prefabPath ?? "";
            view.OpeningCount = 1;
            var pivots = instance.GetComponentsInChildren<Transform>(true)
                .Where(node => node.name == "passenger-swing-door").ToList();
            if (pivots.Count == 0) {
                // `doorSpec`'s single/double choice: a doorway without a pivot is a static
                // frame in this promotion, which would silently stop moving. Report it.
                view.Movable = false;
                view.Diagnostic = "no-swing-pivot:" + visual.Key;
                return true;
            }
            var axis = ReadAxis(pivots[0]);
            view.AxisConvention = axis.Describe();
            foreach (var pivot in pivots) {
                float sign = SwingSign(pivot, axis);
                view.leaves.Add(new OpeningLeaf {
                    Name = pivot.name,
                    LeafKind = OpeningLeafKind.SwingPivot,
                    Node = pivot,
                    Opening = 0,
                    Closed = pivot.localPosition,
                    Sign = sign,
                    SwingFactor = axis.Determinant * sign,
                    SwingUp = HingeAxis(axis),
                    MaxDegrees = SwingMaxDegrees,
                    AuthoredScale = pivot.localScale,
                    Axis = axis.Describe(),
                });
            }
            view.Movable = true;
            if (pivots.Count > 2) view.Diagnostic = "unexpected-pivot-count:" + pivots.Count;
            return true;
        }

        static bool BuildCubicle(OpeningRequest request, ModuleFacts facts, RuntimeCatalogue catalogue, Transform parent,
            OpeningView view) {
            var values = facts.Config;
            var key = string.Equals(values.Text("variant"), "toilet", StringComparison.Ordinal) ? "cubicle-toilet" : "cubicle";
            if (catalogue == null || !catalogue.TryGet(key, out var entry) || entry.prefab == null)
                return Fail(view, "no-prefab:" + key);
            bool standalone = string.Equals(values.Text("variant"), "toilet", StringComparison.Ordinal);
            var holder = Holder(parent, request.ModuleId, facts);
            if (holder == null) return Fail(view, "no-holder");
            var instance = UnityEngine.Object.Instantiate(entry.prefab, holder, false);
            instance.name = request.ModuleId;
            view.Holder = holder;
            view.Instance = instance;
            view.ViewKey = key;
            view.PrefabPath = entry.prefabPath ?? "";
            view.OpeningCount = 1;
            if (standalone) {
                // `CubicleModel`: the standalone toilet is a closed sanitary fitting with no
                // partition and no door, so it has no moving part.
                view.Movable = false;
                return true;
            }
            var pivot = instance.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(node => node.name == "passenger-swing-door");
            if (!pivot) {
                view.Movable = false;
                view.Diagnostic = "no-swing-pivot:" + key;
                return true;
            }
            var axis = ReadAxis(pivot);
            view.AxisConvention = axis.Describe();
            float cubicleSign = SwingSign(pivot, axis);
            view.leaves.Add(new OpeningLeaf {
                Name = pivot.name,
                LeafKind = OpeningLeafKind.SwingPivot,
                Node = pivot,
                Opening = 0,
                Closed = pivot.localPosition,
                Sign = cubicleSign,
                SwingFactor = axis.Determinant * cubicleSign,
                SwingUp = HingeAxis(axis),
                MaxDegrees = SwingMaxDegrees,
                AuthoredScale = pivot.localScale,
                Axis = axis.Describe(),
            });
            view.Movable = true;
            return true;
        }

        /* --------------------------------------------------------------- helpers */

        static Transform Holder(Transform parent, string moduleId, ModuleFacts facts, bool floorTop = true,
            Vector3 extraLocal = default) {
            if (parent == null || facts == null) return null;
            var holder = new GameObject(string.IsNullOrEmpty(moduleId) ? "opening pivot" : moduleId + " pivot").transform;
            holder.SetParent(parent, false);
            var pivot = Pivot(facts, new Vector3(.5f, .5f, floorTop ? 1f : 0f), floorTop);
            holder.SetPositionAndRotation(pivot + ModulePlacement.Rotation(facts.Rotation) * extraLocal,
                ModulePlacement.Rotation(facts.Rotation));
            return holder;
        }

        static Transform FindNode(Transform root, string name) {
            if (!root) return null;
            foreach (var node in root.GetComponentsInChildren<Transform>(true))
                if (node.name == name) return node;
            return null;
        }

        static void Discard(GameObject instance) => SafeDestroy(instance);

        /// <summary>
        /// Destroy an object in the mode the editor is in. `Object.Destroy` is an error in edit
        /// mode (and Unity fails an EditMode test on the resulting log line), so every release
        /// path in this family goes through here.
        /// </summary>
        public static void SafeDestroy(UnityEngine.Object target) {
            if (!target) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(target);
            else UnityEngine.Object.DestroyImmediate(target);
        }

        static bool Fail(OpeningView view, string code) {
            view.Diagnostic = "unresolved:" + code;
            return false;
        }

        static bool FailAndDiscard(OpeningView view, string code) {
            if (view.Instance) Discard(view.Instance);
            if (view.Holder) Discard(view.Holder.gameObject);
            view.Instance = null;
            view.Holder = null;
            return Fail(view, code);
        }
    }

    /// <summary>The material slots a generated opening assembly uses (`PsdModel`'s palette).</summary>
    public static class OpeningColour {
        public const int White = 0;
        public const int Black = 1;
        public const int Steel = 2;
        public const int Glass = 3;
        public const int MovingGlass = 4;
        public const int Red = 5;
        public const int Concrete = 6;
        public const int Line = 7;
        public const int Count = 8;

        public static readonly Color[] Values = {
            new Color(.92f, .92f, .9f),          // white fascia
            new Color(.08f, .08f, .09f),         // black frame
            new Color(.72f, .74f, .77f),         // steel
            new Color(.62f, .72f, .76f, .30f),   // fixed glass
            new Color(.48f, .58f, .62f, .34f),   // moving glass
            new Color(.78f, .12f, .10f),         // gate red / threshold
            new Color(.55f, .57f, .60f),         // concrete foundation
            new Color(.78f, .02f, .25f),         // line colour band
        };
    }

    /// <summary>
    /// The materials and the owned meshes of one generated opening assembly. It is created
    /// per build from the host's station shader and released with the world, so a station
    /// switch cannot leak a material or a combined mesh into the next document.
    ///
    /// Release is edit-mode safe: <c>Object.Destroy</c> is an error in the editor, so both
    /// materials and meshes go through <see cref="OpeningModuleViews.SafeDestroy"/>.
    /// </summary>
    public sealed class OpeningPalette {
        readonly Material[] materials;
        readonly List<Mesh> meshes = new List<Mesh>();
        readonly bool ownsMaterials;
        bool released;

        public OpeningPalette(Shader shader) {
            materials = new Material[OpeningColour.Count];
            if (shader == null) return;
            ownsMaterials = true;
            for (int i = 0; i < materials.Length; i++) {
                materials[i] = new Material(shader) { name = "opening-" + i, color = OpeningColour.Values[i] };
            }
        }

        /// <summary>How many combined meshes the palette currently owns (a report/test figure).</summary>
        public int MeshCount => meshes.Count;

        public Material this[int colour] => materials != null && colour >= 0 && colour < materials.Length
            ? materials[colour] : null;

        public bool HasMaterials => ownsMaterials && materials != null && materials[0] != null;

        /// <summary>Hand one combined mesh to the palette, so it dies with the world.</summary>
        public void Own(Mesh mesh) { if (mesh) meshes.Add(mesh); }

        public void Release() {
            if (released) return;
            released = true;
            foreach (var mesh in meshes) OpeningModuleViews.SafeDestroy(mesh);
            meshes.Clear();
            if (!ownsMaterials) return;
            foreach (var material in materials) OpeningModuleViews.SafeDestroy(material);
        }
    }

    /// <summary>
    /// Boxes a generated opening view and combines them per material, plus one owned
    /// transform per moving fitting. Coordinates are the holder's local document axes
    /// (`x` plan x, `y` up, `z` plan y); callers pass source-local points through
    /// <see cref="OpeningModuleViews.Local"/>.
    /// </summary>
    public sealed class OpeningBuilder {
        readonly Transform root;
        readonly OpeningPalette palette;
        readonly Dictionary<int, List<CombineInstance>> batches = new Dictionary<int, List<CombineInstance>>();
        readonly List<Mesh> owned = new List<Mesh>();

        static Mesh unitCube;

        public OpeningBuilder(Transform parent, OpeningPalette palette) {
            root = parent;
            this.palette = palette;
        }

        public Transform Root => root;

        /// <summary>The shared unit cube every box instance scales.</summary>
        public static Mesh UnitCube {
            get {
                if (unitCube) return unitCube;
                unitCube = new Mesh { name = "opening unit cube" };
                var vertices = new Vector3[24];
                var normals = new Vector3[24];
                var uvs = new Vector2[24];
                var triangles = new int[36];
                int v = 0, t = 0;
                foreach (var (normal, right, up) in CubeFaces()) {
                    var centre = normal * .5f;
                    vertices[v + 0] = centre - right * .5f - up * .5f;
                    vertices[v + 1] = centre - right * .5f + up * .5f;
                    vertices[v + 2] = centre + right * .5f + up * .5f;
                    vertices[v + 3] = centre + right * .5f - up * .5f;
                    normals[v + 0] = normals[v + 1] = normals[v + 2] = normals[v + 3] = normal;
                    uvs[v + 0] = new Vector2(0f, 0f);
                    uvs[v + 1] = new Vector2(0f, 1f);
                    uvs[v + 2] = new Vector2(1f, 1f);
                    uvs[v + 3] = new Vector2(1f, 0f);
                    // Wind the quad so its face normal agrees with the authored normal: a
                    // wrongly wound box is invisible from outside under backface culling.
                    var a = vertices[v + 1] - vertices[v + 0];
                    var b = vertices[v + 2] - vertices[v + 0];
                    bool flip = Vector3.Dot(Vector3.Cross(a, b), normal) < 0f;
                    if (flip) {
                        triangles[t + 0] = v; triangles[t + 1] = v + 2; triangles[t + 2] = v + 1;
                        triangles[t + 3] = v; triangles[t + 4] = v + 3; triangles[t + 5] = v + 2;
                    } else {
                        triangles[t + 0] = v; triangles[t + 1] = v + 1; triangles[t + 2] = v + 2;
                        triangles[t + 3] = v; triangles[t + 4] = v + 2; triangles[t + 5] = v + 3;
                    }
                    v += 4;
                    t += 6;
                }
                unitCube.vertices = vertices;
                unitCube.normals = normals;
                unitCube.uv = uvs;
                unitCube.triangles = triangles;
                unitCube.RecalculateBounds();
                return unitCube;
            }
        }

        static IEnumerable<(Vector3 normal, Vector3 right, Vector3 up)> CubeFaces() {
            yield return (Vector3.right, Vector3.back, Vector3.up);
            yield return (Vector3.left, Vector3.forward, Vector3.up);
            yield return (Vector3.up, Vector3.right, Vector3.forward);
            yield return (Vector3.down, Vector3.right, Vector3.back);
            yield return (Vector3.forward, Vector3.left, Vector3.up);
            yield return (Vector3.back, Vector3.right, Vector3.up);
        }

        /// <summary>Accumulate one box into its material's batch.</summary>
        public void Box(int colour, Vector3 centre, Vector3 size) {
            if (!batches.TryGetValue(colour, out var parts)) batches.Add(colour, parts = new List<CombineInstance>());
            parts.Add(new CombineInstance {
                mesh = UnitCube,
                transform = Matrix4x4.TRS(centre, Quaternion.identity, size),
            });
        }

        /// <summary>One combined mesh per material under this builder's root.</summary>
        public void Finish(string name) {
            if (!root) return;
            foreach (var entry in batches) {
                if (entry.Value.Count == 0) continue;
                var mesh = new Mesh { name = name + " " + entry.Key, indexFormat = IndexFormat.UInt32 };
                // `useMatrices` must stay true: every instance carries its own TRS.
                mesh.CombineMeshes(entry.Value.ToArray(), true, true);
                owned.Add(mesh);
                var part = new GameObject(name + " " + entry.Key, typeof(MeshFilter), typeof(MeshRenderer));
                part.transform.SetParent(root, false);
                part.GetComponent<MeshFilter>().sharedMesh = mesh;
                var material = palette != null ? palette[entry.Key] : null;
                var renderer = part.GetComponent<MeshRenderer>();
                if (material != null) renderer.sharedMaterial = material;
                else renderer.enabled = false;
            }
            batches.Clear();
            // The combined meshes belong to the palette and are freed with it. `AssemblyOwner`
        // from the lead's kit is deliberately not used: its `OnDestroy` calls `Object.Destroy`,
        // which is an error during an edit-mode teardown.
            if (owned.Count == 0) return;
            if (palette != null) {
                foreach (var mesh in owned) palette.Own(mesh);
            } else {
                foreach (var mesh in owned) OpeningModuleViews.SafeDestroy(mesh);
            }
            owned.Clear();
        }

        /// <summary>A named child node, for a fitting whose transform the state drives.</summary>
        public Transform Node(string name, Vector3 localPosition) {
            if (!root) return null;
            var node = new GameObject(name).transform;
            node.SetParent(root, false);
            node.localPosition = localPosition;
            node.localRotation = Quaternion.identity;
            return node;
        }
    }

    /// <summary>
    /// The `openings` station renderer: it builds every opening module into the staged
    /// world and publishes one <see cref="OpeningModuleSet"/> keyed by module ID.
    /// </summary>
    public sealed class OpeningModuleRenderer : IStationViewRenderer {
        public const string RoleName = "openings";

        /// <summary>
        /// One built world's openings. The host stages a candidate world while the live
        /// world is still drawing, then releases the *old* world after the candidate has
        /// built — so one shared set would be cleared out from under the new station
        /// (plan 11 B4's reopen-after-switch report caught exactly that).
        /// </summary>
        sealed class WorldState {
            public StationWorldView World;
            public OpeningModuleSet Set;
            public OpeningPalette Palette;
            public int Serial;
        }

        readonly Dictionary<StationWorldView, WorldState> states = new Dictionary<StationWorldView, WorldState>();
        WorldState newest;
        int serial;

        public string Role => RoleName;

        /// <summary>Every built opening of the active world, keyed by module ID.</summary>
        public OpeningModuleSet Views => newest?.Set ?? new OpeningModuleSet();

        public void Build(StationViewBuildContext context) {
            if (context == null) return;
            if (context.Catalogue == null) {
                context.ReportUnresolved("missing-asset", "renderer", Role, "No RuntimeCatalogue on the station host.");
                return;
            }
            var records = context.Document?.Modules;
            if (records == null) {
                context.ReportUnresolved("missing-document", "renderer", Role, "The build context has no document.");
                return;
            }
            var state = new WorldState {
                World = context.World,
                Set = new OpeningModuleSet(),
                Palette = new OpeningPalette(context.Shader),
                Serial = ++serial,
            };
            if (context.World != null) states[context.World] = state;
            newest = state;
            if (!state.Palette.HasMaterials)
                context.ReportUnresolved("missing-asset", "renderer", Role, "No station shader; opening materials are unlit.");
            var roleRoot = context.RoleRoot(Role);
            OpeningModuleViews.BuildAll(records, context.Index, context.Catalogue, roleRoot, state.Palette, state.Set,
                (module, view) => context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1),
                (module, diagnostic) => context.ReportUnresolved("opening", module.Type, module.Id, diagnostic));
        }

        public void Release() {
            // Drop only worlds the host has actually disposed; the outgoing world's
            // Release runs after the candidate's Build, so clearing everything here
            // would delete the live station's openings (B4's switch report).
            var dead = new List<StationWorldView>();
            foreach (var pair in states) {
                if (pair.Key == null || pair.Key.IsDisposed) {
                    pair.Value.Set.Clear();
                    pair.Value.Palette?.Release();
                    dead.Add(pair.Key);
                }
            }
            for (int i = 0; i < dead.Count; i++) states.Remove(dead[i]);
            WorldState next = null;
            foreach (var state in states.Values) if (next == null || state.Serial > next.Serial) next = state;
            newest = next;
        }
    }

    /// <summary>
    /// Self-registration, plan 11's zero-wiring contract: the host enumerates
    /// <see cref="StationRenderers"/> at <c>Awake</c>, so this file adds its renderer before
    /// the first scene loads and the integrator edits no shared file. The static handle
    /// lets a simulation or a verifier reach the per-module state without a scene lookup.
    /// </summary>
    public static class StationOpeningRenderers {
        /// <summary>The renderer whose <see cref="OpeningModuleRenderer.Views"/> the host drives.</summary>
        public static OpeningModuleRenderer Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            var renderer = new OpeningModuleRenderer();
            Current = renderer;
            StationRenderers.Add(renderer);
        }

        /// <summary>Test seam: install a renderer without a domain reload.</summary>
        public static OpeningModuleRenderer Install() {
            var renderer = new OpeningModuleRenderer();
            Current = renderer;
            StationRenderers.Add(renderer);
            return renderer;
        }
    }
}