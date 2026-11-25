using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Metro.Build;
using Metro.App.Views;
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

    /// <summary>
    /// What one named geometry part of a generated opening assembly is (RCA 15 §5). The
    /// source names every fitting it draws (`PsdModel.ts`'s `psd-threshold`,
    /// `psd-concrete-foundation`, `psd-info-housing`, `PsdEndModel.ts`'s
    /// `psd-cover-panel`), so a report or a test can ask for one by identity instead of
    /// guessing which box in a combined mesh is which.
    /// </summary>
    public enum OpeningPartRole {
        Other = 0,
        /// <summary>`psd-threshold`: the 0.02 m dark slab over the foundation.</summary>
        Threshold = 1,
        /// <summary>`psd-concrete-foundation`: the 0.98 m plinth under the threshold.</summary>
        Foundation = 2,
        /// <summary>`psd-info-housing` and its cap/ink bands: the fascia above the glazing.</summary>
        Fascia = 3,
        /// <summary>`psd-cover-panel`: a `psd-end` cover course.</summary>
        Cover = 4,
        /// <summary>`psd-fixed-glass` / `psd-door-glass`.</summary>
        Glass = 5,
        /// <summary>`psd-fixed-rail`, `psd-fixed-post`, `psd-section-pillar`, leaf frames.</summary>
        Frame = 6,
        /// <summary>A moving leaf's own parts.</summary>
        Door = 7,
        /// <summary>The red "mind the gap" threshold strip.</summary>
        Warning = 8,
    }

    /// <summary>
    /// One named, **measured** part of a built opening view. Bounds are recorded twice: in
    /// the module holder's frame (the source's own axes — <c>x</c> along the run, <c>y</c>
    /// up, <c>z</c> across) so it can be compared with `PsdModel.ts` line by line, and in
    /// document axes as an axis-aligned box in metres, so it can be compared with a save.
    /// </summary>
    public sealed class OpeningPart {
        public string Name = "";
        public OpeningPartRole Role;
        /// <summary>The measured object; null for a part the builder had to skip.</summary>
        public Transform Node;
        /// <summary>Mesh bounds in the module holder's frame (source axes: x along, y up, z across).</summary>
        public Bounds Local;
        /// <summary>The same box in document axes (plan x, plan y, elevation), axis-aligned.</summary>
        public Bounds Document;
        /// <summary>The finish id or palette slot the part was drawn with.</summary>
        public string Material = "";
        /// <summary>
        /// The local pose written to a promoted prefab before its bounds were measured — the
        /// **actual prefab offset**. Zero for generated geometry, whose boxes carry their
        /// own position.
        /// </summary>
        public Vector3 PrefabOffset;
        /// <summary>The document elevation of the holder this part hangs from.</summary>
        public float Datum;

        public override string ToString() {
            var id = CultureInfo.InvariantCulture;
            return Name + " " + Role + " local y " + Local.min.y.ToString("0.###", id) + ".." +
                Local.max.y.ToString("0.###", id) + " across " + Local.center.z.ToString("0.###", id) +
                " doc z " + Document.min.z.ToString("0.###", id) + ".." + Document.max.z.ToString("0.###", id) +
                (Material.Length > 0 ? " material=" + Material : "");
        }
    }

    /// <summary>One box a generated view emitted, in the module holder's local axes (18 §3).</summary>
    public struct OpeningBox {
        public string Part;
        public OpeningPartRole Role;
        public Vector3 Min, Max;
        public bool Glass;
        public Vector3 Size => Max - Min;
    }

    /// <summary>Which printed panel a PSD header or vinyl decal slot carries (`PsdHeader.ts` / `PsdDecals.ts`).</summary>
    public enum PsdHeaderKind {
        /// <summary>`psd-route-header`: the schematic/terminus panel over a fixed span.</summary>
        Route = 0,
        /// <summary>`psd-station-header`: the station-name panel over a doorway.</summary>
        Station = 1,
        /// <summary>`psd-fixed-sticker`: the paired route+station print on a half-height panel.</summary>
        HalfSticker = 2,
        /// <summary>`psd-fixed-band`: red/yellow mind-the-gap vinyl band along fixed glass panes.</summary>
        FixedBand = 3,
        /// <summary>`psd-door-band`: yellow/red mind-the-gap vinyl band on moving door leaves.</summary>
        DoorBand = 4,
        /// <summary>`psd-door-warning`: transparent yellow caution placard on moving door leaves.</summary>
        DoorWarning = 5,
        /// <summary>`psd-door-arrow` pointing toward local -X on the platform face.</summary>
        DoorArrowLeft = 6,
        /// <summary>`psd-door-arrow` pointing toward local +X on the platform face.</summary>
        DoorArrowRight = 7,
    }

    /// <summary>
    /// One platform-facing printed slot of a PSD run, in run-local source metres. This is
    /// the geometry half of sub-item 2: `PsdModel.buildPsd` cuts the header band into
    /// alternating route and station panels above the doorways and fills the fixed spans
    /// between them, and prints a paired sticker on every half-height fixed panel. The
    /// slot carries the pose and span a face provider needs to bind artwork, plus the
    /// request key over the data actually painted (never over the geometry).
    /// </summary>
    public struct PsdHeaderSlot {
        public PsdHeaderKind Kind;
        /// <summary>The doorway this panel sits over, or −1 for a route span or sticker.</summary>
        public int OpeningIndex;
        /// <summary>Run-local start of the panel (`buildPsd`'s `a`).</summary>
        public float Start;
        /// <summary>Run-local end of the panel (`buildPsd`'s `b`).</summary>
        public float End;
        /// <summary>Source-local `y` of the printed plane (the holder's local z).</summary>
        public float Across;
        /// <summary>Source-local `z` of the panel centre (the holder's local y).</summary>
        public float Mid;
        /// <summary>Printed height in metres (`headerH` 0.6, or `sw × 256/2048` for a sticker).</summary>
        public float Height;
        /// <summary>
        /// +1 when the printed face looks toward source **+y**, −1 toward −y. The screen
        /// faces the platform, so this is the platform facing, not the track facing.
        /// </summary>
        public float Facing;
        /// <summary>
        /// `PsdHeader.ts` / `PsdDecals.ts` canvas width for this slot: 1024 for one panel or
        /// fixed band, 2048 for the paired half-height sticker, 640 for door band/warning, 256 for arrows.
        /// </summary>
        public int Pixels;
        /// <summary>Canvas pixel height (`0` defaults to `PsdHeaderPanel.PixelHeight` = 256).</summary>
        public int PixelHeight;
        /// <summary>Horizontal UV repeat factor (`width / 1.2` for `FixedBand`, `1` otherwise).</summary>
        public float RepeatU;
        /// <summary>True when the painted PNG uses alpha transparency (`DoorWarning`, arrows).</summary>
        public bool Transparent;
        /// <summary>The artwork request key: painted data only (see <see cref="OpeningView.HeaderKey"/>).</summary>
        public string Key;
        /// <summary>An empty, correctly posed node a face provider can attach a quad to.</summary>
        public Transform Node;

        public float Width => End - Start;
        public float Centre => (Start + End) * .5f;

        public override string ToString() {
            var id = CultureInfo.InvariantCulture;
            return Kind + (OpeningIndex >= 0 ? "#" + OpeningIndex : "") + " [" + Start.ToString("0.###", id) + ".." +
                End.ToString("0.###", id) + "] w=" + Width.ToString("0.###", id) + " mid=" +
                Mid.ToString("0.###", id) + " facing=" + Facing.ToString("0", id);
        }
    }

    /// <summary>
    /// The port of `PsdHeader.ts:psdHeaderInfo` for one saved edge: the printed text a
    /// header panel carries. Every field here is painted, so every field here is part of
    /// the request key; nothing geometric is.
    /// </summary>
    public struct PsdHeaderPlan {
        public bool HasData;
        /// <summary>The edge's line id (`cfg.line`), empty when it names none.</summary>
        public string LineId;
        /// <summary>The line's ink (`line.colour`), the source's `#1b6fd6` default.</summary>
        public string Colour;
        /// <summary>`cfg.dir`: `up` or `down`.</summary>
        public string Direction;
        /// <summary>The committed station name (`ctx.data.name`), and its English line.</summary>
        public string StationName;
        public string StationNameEn;
        /// <summary>`psdHeaderInfo.destination`: the terminus this platform runs toward.</summary>
        public string Destination;
        public string DestinationEn;
        /// <summary>`psdHeaderInfo.adjacent`: the next station on the platform's plaque.</summary>
        public string Adjacent;
        public string AdjacentEn;
        /// <summary>The destination is this station, so the plaque carries no direction arrow.</summary>
        public bool Terminal;
        /// <summary>`psdHeaderInfo.arrow`: ±1, the side of the panel the download arrow sits on.</summary>
        public int Arrow;
        /// <summary>True when the direction label is the source's `t('up'/'down')` fallback.</summary>
        public bool DirectionFallback;

        /// <summary>The key over painted data only; geometry changes never move it.</summary>
        public string ContentKey {
            get {
                var text = new StringBuilder();
                text.Append(LineId).Append('\u001f').Append(Colour).Append('\u001f').Append(Direction)
                    .Append('\u001f').Append(StationName).Append('\u001f').Append(StationNameEn)
                    .Append('\u001f').Append(Destination).Append('\u001f').Append(DestinationEn)
                    .Append('\u001f').Append(Adjacent).Append('\u001f').Append(AdjacentEn)
                    .Append('\u001f').Append(Terminal ? '1' : '0').Append('\u001f').Append(Arrow)
                    .Append('\u001f').Append(DirectionFallback ? '1' : '0');
                return text.ToString();
            }
        }

        public override string ToString() {
            var text = new StringBuilder();
            text.Append("line=").Append(LineId).Append(" ink=").Append(Colour).Append(" dir=").Append(Direction);
            text.Append(" station=").Append(StationName);
            text.Append(" dest=").Append(Destination);
            if (Adjacent.Length > 0) text.Append(" next=").Append(Adjacent);
            text.Append(" arrow=").Append(Arrow).Append(" terminal=").Append(Terminal);
            return text.ToString();
        }
    }

    /// <summary>One built opening module: identity, provenance, geometry and its state.</summary>
    public sealed class OpeningView {
        internal readonly List<OpeningLeaf> leaves = new List<OpeningLeaf>();
        internal readonly List<OpeningPart> parts = new List<OpeningPart>();
        internal readonly List<PsdHeaderSlot> headers = new List<PsdHeaderSlot>();
        internal readonly List<PsdHeaderSlot> decals = new List<PsdHeaderSlot>();

        public OpeningKind Kind;
        public string ModuleId = "";
        public string Type = "";
        /// <summary>The catalogue key the view resolved to, or `generated:*` for an assembly.</summary>
        public string ViewKey = "";
        public string PrefabPath = "";
        /// <summary>Non-fatal caveats (`code:detail` list); empty when fully faithful.</summary>
        public string Diagnostic = "";
        /// <summary>
        /// A doorless gate's carried fence panel, in the **holder** frame: the cabinet jamb it
        /// starts at and the cell edge it reaches (18c §1). Signed, so a probe can tell the lane's
        /// own side from its mirror; zero on every other opening.
        /// </summary>
        public float PanelJamb, PanelEdge;
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
        /// <summary>
        /// The port of `PsdHeader.ts:psdHeaderInfo` for this run's edge: the line, direction
        /// and committed station names the printed panels would carry. Filled by
        /// <see cref="OpeningModuleViews.BuildRun"/>; empty for the other families.
        /// </summary>
        public PsdHeaderPlan Header;
        /// <summary>
        /// The artwork request key for this module's printed panels: <see cref="PsdHeaderPlan.ContentKey"/>,
        /// i.e. the painted data only. A face provider must treat a changed key as new pixels
        /// and an unchanged key as reusable, so moving a panel never re-renders it.
        /// </summary>
        public string HeaderKey = "";
        /// <summary>
        /// The finish id the foundation part was drawn with — `floor.concrete` when the host
        /// resolved the source finish, empty when only the flat palette slot was available.
        /// </summary>
        public string FoundationFinish = "";

        public IReadOnlyList<OpeningLeaf> Leaves => leaves;
        /// <summary>Every named, measured part of the assembly, in build order (RCA 15 §5).</summary>
        public IReadOnlyList<OpeningPart> Parts => parts;
        /// <summary>Every platform-facing printed header slot of a PSD run (RCA 15 §5 sub-item 2).</summary>
        public IReadOnlyList<PsdHeaderSlot> Headers => headers;
        /// <summary>Every platform-facing printed vinyl safety decal slot of a full-height PSD run (`PsdDecals.ts`).</summary>
        public IReadOnlyList<PsdHeaderSlot> Decals => decals;
        public bool Built => Instance != null;

        /// <summary>
        /// Every box this generated view emitted, with the part it belongs to and whether it
        /// is glazing. `BuildEnd` trims its return against the parent screen's housing before
        /// this is recorded, so a verifier (or a test) reads the **drawn** boxes, not the
        /// intended ones (18 §3).
        /// </summary>
        public readonly List<OpeningBox> boxes = new List<OpeningBox>();

        /// <summary>
        /// The parent screen's housing a fixed return was trimmed against, in this view's
        /// holder frame (18 §3). Empty for a continuation with no parent, so a verifier can
        /// tell "nothing to trim against" from "trimmed against nothing".
        /// </summary>
        public readonly List<PsdReturnTrim.Housing> housing = new List<PsdReturnTrim.Housing>();

        /// <summary>The drawn boxes of a generated view (18 §3).</summary>
        public IReadOnlyList<OpeningBox> Boxes => boxes;
        /// <summary>The parent housing a fixed return was trimmed against (empty when none).</summary>
        public IReadOnlyList<PsdReturnTrim.Housing> Housing => housing;

        /// <summary>The named part, or null when this view has no such part.</summary>
        public OpeningPart Part(string name) {
            for (int i = 0; i < parts.Count; i++)
                if (string.Equals(parts[i].Name, name, StringComparison.Ordinal)) return parts[i];
            return null;
        }

        /// <summary>Every part with one role, in build order.</summary>
        public List<OpeningPart> PartsOf(OpeningPartRole role) => parts.Where(part => part.Role == role).ToList();

        /// <summary>How many slots of one kind the run emitted.</summary>
        public int HeaderCount(PsdHeaderKind kind) => headers.Count(slot => slot.Kind == kind);

        /// <summary>The slot over one doorway, or default when the run has none.</summary>
        public PsdHeaderSlot StationHeader(int opening) {
            for (int i = 0; i < headers.Count; i++)
                if (headers[i].Kind == PsdHeaderKind.Station && headers[i].OpeningIndex == opening) return headers[i];
            return default;
        }

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
            if (parts.Count > 0) text.Append(" parts=").Append(parts.Count);
            if (headers.Count > 0) {
                text.Append(" headers=").Append(headers.Count);
                text.Append("(route=").Append(HeaderCount(PsdHeaderKind.Route))
                    .Append(",station=").Append(HeaderCount(PsdHeaderKind.Station))
                    .Append(",sticker=").Append(HeaderCount(PsdHeaderKind.HalfSticker)).Append(')');
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

        public bool Remove(string moduleId) =>
            !string.IsNullOrEmpty(moduleId) && views.Remove(moduleId);

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
        /// <summary>The run cell whose centre is nearest this doorway (`round(Centre)`).</summary>
        public int Cell;
        /// <summary>The doorway's document plan centre at the floor top (`StationPlatformDoorways`).</summary>
        public float DocumentX;
        public float DocumentY;
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
            int towardSign = layoutRef.Left ? -1 : 1;
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
            // The threshold, foundation and leaf planes come from the one shared rail/PSD
            // datum: the sill reaches exactly the platform-block inset edge, so the floor
            // slab and the sill never share a face.
            layoutRef.SillDepth = StationRailGeometry.PsdSillDepth(half);
            layoutRef.SillY = StationRailGeometry.PsdSillY(towardSign, half);
            layoutRef.LeafY = StationRailGeometry.PsdLeafY(towardSign, half);

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
                // RCA 16 §3.2: the shared doorway identity and world centre. The floor
                // vinyl (`snapBoardingMark`) and the train door stop opposite this same
                // `StationPlatformDoorways` point; a slot or mark must never re-derive it.
                var doorway = StationPlatformDoorways.At(request.ModuleId, i, request.X, request.Y, request.Z,
                    request.Rotation, request.Side, opening.Centre, opening.Width);
                opening.Cell = doorway.Cell;
                opening.DocumentX = (float)doorway.X;
                opening.DocumentY = (float)doorway.Y;
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
                StationRigidModelLods.Apply(view.Instance, System.IO.Path.GetFileNameWithoutExtension(view.PrefabPath));
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
            /// <summary>The `cfg.corner` module id a `psd-end` returns against (18 §3).</summary>
            public string Corner;
            public float OffsetX, OffsetY;
            public bool HasWidth, HasDepth;
            public float ConfigWidth, ConfigDepth;
            public bool HasTrack;
            public int TrackX, TrackY, TrackRotation, TrackWidth;
            public bool HasLine;
            public string Stock;
            public int Cars;
            public float ModelScale;
            // RCA 15 §5: the printed header panels need the line's ink and its termini, and
            // the station's committed names. All of it is resolved here so the geometry
            // builder never re-reads the document.
            public string LineColour;
            public string UpTerminus, DownTerminus, UpTerminusEn, DownTerminusEn;
            public string UpNextStation, DownNextStation, UpNextStationEn, DownNextStationEn;
            public string StationName, StationNameEn;
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
                Corner = cfg.Text("corner"),
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
                // RCA 15 §5: the printed header carries the line's ink, its terminus and the
                // next station for the edge's own direction; `PsdHeader.ts:psdHeaderInfo`.
                request.LineColour = line.Colour;
                request.UpTerminus = line.UpTerminus;
                request.DownTerminus = line.DownTerminus;
                request.UpTerminusEn = LineText(line, "upTerminusEn");
                request.DownTerminusEn = LineText(line, "downTerminusEn");
                request.UpNextStation = LineText(line, "upNextStation");
                request.DownNextStation = LineText(line, "downNextStation");
                request.UpNextStationEn = LineText(line, "upNextStationEn");
                request.DownNextStationEn = LineText(line, "downNextStationEn");
            }
            // The station's own committed name is what a station panel prints, so it is read
            // from the document the module belongs to (`ctx.data.name` in the source).
            var document = index?.Document;
            if (document != null) {
                request.StationName = document.Name;
                request.StationNameEn = document.NameEn;
            }
            return request;
        }

        /// <summary>
        /// A scalar string field of the saved line record that is not projected on
        /// <see cref="StationLineRecord"/> (`upTerminusEn`, `downNextStation`, …), read from
        /// its own authored JSON. Absent or unreadable fields are the empty string, exactly as
        /// `psdHeaderInfo`'s `?.trim() ?? ''` treats them.
        /// </summary>
        public static string LineText(StationLineRecord line, string key) {
            if (line == null || string.IsNullOrEmpty(key) || string.IsNullOrEmpty(line.RawJson)) return "";
            try {
                var record = JObject.Parse(line.RawJson);
                var value = record[key];
                return value == null || value.Type == JTokenType.Null ? "" : ((string)value ?? "").Trim();
            } catch (Exception) {
                return "";
            }
        }

        /// <summary>
        /// The port of `PsdHeader.ts:psdHeaderInfo`: the printed text one edge's header
        /// panels carry. A run whose record names no line still gets the source's default
        /// ink (`#1b6fd6`) and its direction's terminus is the direction label, which is
        /// reported through <see cref="PsdHeaderPlan.DirectionFallback"/> rather than hidden.
        /// </summary>
        public static PsdHeaderPlan PsdHeaderFor(OpeningRequest request) {
            bool down = string.Equals(request.Dir, "down", StringComparison.Ordinal);
            bool right = string.Equals(request.Side, "right", StringComparison.Ordinal);
            string rawStation = (request.StationName ?? "").Trim();
            string rawDestination = ((down ? request.DownTerminus : request.UpTerminus) ?? "").Trim();
            var plan = new PsdHeaderPlan {
                HasData = true,
                LineId = request.LineId ?? "",
                Colour = string.IsNullOrEmpty(request.LineColour) ? "#1b6fd6" : request.LineColour,
                Direction = down ? "down" : "up",
                StationName = rawStation,
                StationNameEn = (request.StationNameEn ?? "").Trim(),
                Destination = rawDestination,
                DestinationEn = ((down ? request.DownTerminusEn : request.UpTerminusEn) ?? "").Trim(),
                Adjacent = ((down ? request.DownNextStation : request.UpNextStation) ?? "").Trim(),
                AdjacentEn = ((down ? request.DownNextStationEn : request.UpNextStationEn) ?? "").Trim(),
            };
            plan.Terminal = rawStation.Length > 0 && rawDestination.Length > 0 &&
                string.Equals(rawDestination, rawStation, StringComparison.Ordinal);
            if (plan.StationName.Length == 0) {
                // `buildPsd`: `name = ctx.data.name || t('metro_station')`. The canvas prints
                // the Chinese line, so the fallback is the source's zh string.
                plan.StationName = "\u5730\u94c1\u7ad9";
            }
            if (plan.Destination.Length == 0) {
                // `psdHeaderInfo`: `destination || t(down ? 'down' : 'up')`.
                plan.Destination = down ? "\u4e0b\u884c" : "\u4e0a\u884c";
                plan.DirectionFallback = true;
            }
            // The platform-facing plane reverses its local x on the left bank.
            plan.Arrow = (down ? -1 : 1) * (right ? 1 : -1);
            return plan;
        }

        /// <summary>The artwork request key of one slot: the painted data, then the panel kind.</summary>
        public static string PsdHeaderKey(in PsdHeaderPlan plan, PsdHeaderKind kind) {
            if (PsdHeaderVocabulary.IsDecal(kind)) return "decal:" + PsdHeaderVocabulary.Kind(kind);
            return plan.ContentKey + "\u001f" + kind;
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
        /// Build a placement/move ghost for `psd-end` (half, full, corner-trimmed, or cover),
        /// `door` (with its exact leading-edge offset), `gate` (with its doorless fence panel),
        /// `cubicle`, or `platform-edge` through the exact same builder the live renderer commits.
        /// </summary>
        public static bool TryBuildPreview(
            StationModuleRecord record, StationIndex index, RuntimeCatalogue catalogue,
            Transform parent, Material ghostMaterial, out GameObject root, out List<Mesh> meshes) {
            root = null;
            meshes = null;
            if (record?.Facts == null || parent == null || ghostMaterial == null || !Owns(record.Type)) return false;
            var palette = OpeningPalette.CreatePreview(ghostMaterial);
            var request = RequestFor(record, index);
            ModuleFacts[] stationFacts;
            if (index?.Document?.Modules != null) {
                var mods = index.Document.Modules;
                stationFacts = new ModuleFacts[mods.Count];
                for (int i = 0; i < mods.Count; i++) stationFacts[i] = mods[i]?.Facts;
            } else {
                stationFacts = Array.Empty<ModuleFacts>();
            }
            if (!TryBuild(request, record.Facts, stationFacts, catalogue, parent, palette, out var view) ||
                view?.Holder == null) {
                if (view?.Holder != null) SafeDestroy(view.Holder.gameObject);
                palette.Release();
                return false;
            }
            root = view.Holder.gameObject;
            root.name = "ghost " + (string.IsNullOrEmpty(record.Id) ? record.Type : record.Id) + " " + record.Type;
            if (string.Equals(record.Type, "gate", StringComparison.Ordinal) && !GateHasLane(request.Door)) {
                foreach (var t in root.GetComponentsInChildren<Transform>(true)) {
                    if (t == null) continue;
                    if (string.Equals(t.name, "fence panel", StringComparison.Ordinal)) {
                        t.name = "ghost doorless gate panel";
                    } else if (string.Equals(t.name, "wing", StringComparison.Ordinal) ||
                               string.Equals(t.name, "left-leaf", StringComparison.Ordinal) ||
                               string.Equals(t.name, "right-leaf", StringComparison.Ordinal)) {
                        t.gameObject.SetActive(false);
                    }
                }
            }
            foreach (var r in root.GetComponentsInChildren<Renderer>(true)) {
                if (r == null) continue;
                r.forceMeshLod = 0;
                int count = Mathf.Max(1, r.sharedMaterials.Length);
                var mats = new Material[count];
                for (int i = 0; i < count; i++) mats[i] = ghostMaterial;
                r.sharedMaterials = mats;
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            meshes = new List<Mesh>(palette.MeshCount);
            palette.DrainMeshes(meshes);
            palette.Release();
            return true;
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
                case OpeningKind.PsdCover: return BuildEnd(request, facts, station, catalogue, parent, paint, view);
                case OpeningKind.Gate: return BuildGate(request, facts, station, catalogue, parent, view, paint);
                case OpeningKind.SwingDoor: return BuildDoor(request, facts, station, catalogue, parent, view, paint);
                case OpeningKind.Cubicle: return BuildCubicle(request, facts, catalogue, parent, view, paint);
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
                // `buildPsd` still draws the platform's yellow safety line where the screen is absent (§5.9).
                var bare = Holder(parent, request.ModuleId, facts, floorTop: false);
                if (bare == null) return Fail(view, "no-holder");
                float bareLen = Mathf.Max(1f, request.Width);
                float bareCx = -.5f + bareLen * .5f;
                float bareToward = string.Equals(request.Side, "right", StringComparison.Ordinal) ? 1f : -1f;
                float bareWall = bareToward * StationRailGeometry.PsdWallOffset;
                var bareCavity = new OpeningBuilder(bare, paint);
                bareCavity.Part("platform-yellow-line", OpeningPartRole.Warning);
                bareCavity.Box(OpeningColour.YellowLine, Local(bareCx, bareWall - bareToward * .16f, 1f + .003f),
                    LocalSize(bareLen, .10f, .006f));
                bareCavity.Finish(request.ModuleId, view);
                view.Holder = bare;
                view.Instance = bare.gameObject;
                view.ViewKey = PlatformEdgeKey + ":none";
                view.OpeningCount = 0;
                view.Movable = false;
                view.Diagnostic = "psd-none:no-screen";
                return true;
            }
            if (!TryPsdRun(run, out var layout, out var diagnostic)) return Fail(view, diagnostic);
            // RCA 15 §5: `buildPsd` positions its group at `(mod.x + .5, mod.y + .5, mod.z)`
            // and draws its foundation in the cell **below** the floor datum (`z0 = 1`), not
            // on the floor itself. `Holder(floorTop: true)` put this run one metre above that
            // datum — the foundation then stood on the platform as a bar and the run no longer
            // met its own generated `psd-end` panels (which are placed at `mod.z`). The run is
            // generated in the source frame, so it hangs at the source datum.
            var holder = Holder(parent, request.ModuleId, facts, floorTop: false);
            if (holder == null) return Fail(view, "no-holder");
            view.Holder = holder;
            view.Run = layout;
            view.ViewKey = PlatformEdgeKey;
            view.PrefabPath = "";
            view.OpeningCount = layout.Openings.Count;
            view.OpeningCentres = layout.Openings.Select(opening => opening.Centre).ToArray();
            view.FoundationFinish = paint != null ? paint.FoundationFinish : "";
            view.Header = PsdHeaderFor(request);
            view.HeaderKey = view.Header.ContentKey;
            var cavity = new OpeningBuilder(holder, paint);
            bool half = string.Equals(request.Psd, "half", StringComparison.Ordinal);
            float toward = layout.Left ? -1f : 1f;
            float len = layout.Length;
            float x0 = layout.RunStart;
            float cx = x0 + len * .5f;
            float wall = layout.WallOffset;
            const float z0 = 1f;

            // Sill, foundation, yellow safety line, fascia and the fascia's line-colour band. Each is its own
            // named part so its bounds can be compared with `PsdModel.ts` (RCA 15 §5).
            cavity.Part("platform-yellow-line", OpeningPartRole.Warning);
            cavity.Box(OpeningColour.YellowLine, Local(cx, wall - toward * .16f, z0 + .003f),
                LocalSize(len, .10f, .006f));
            cavity.Part("psd-threshold", OpeningPartRole.Threshold);
            cavity.Box(OpeningColour.Black, Local(cx, layout.SillY, z0 - .01f), LocalSize(len, layout.SillDepth, .02f));
            cavity.Part("psd-concrete-foundation", OpeningPartRole.Foundation);
            cavity.Box(OpeningColour.Concrete, Local(cx, layout.SillY, z0 - .51f), LocalSize(len, layout.SillDepth, .98f));
            if (!half) {
                float headerBottom = layout.GlassHeight;
                cavity.Part("psd-info-housing", OpeningPartRole.Fascia);
                cavity.Box(OpeningColour.White, Local(cx, wall, z0 + headerBottom + PsdHeaderHeight * .5f),
                    LocalSize(len, .24f, PsdHeaderHeight));
                cavity.Part("psd-fascia-cap", OpeningPartRole.Fascia);
                cavity.Box(OpeningColour.Black, Local(cx, wall, z0 + PsdFullHeight - .025f), LocalSize(len, .28f, .05f));
                cavity.Part("psd-line-colour-band", OpeningPartRole.Fascia);
                cavity.Box(OpeningColour.Line, Local(cx, wall - toward * .13f, z0 + headerBottom + .012f),
                    LocalSize(len, .03f, .025f));
            } else {
                cavity.Part("psd-fixed-cap", OpeningPartRole.Frame);
                cavity.Box(OpeningColour.Black, Local(cx, wall, z0 + PsdHalfHeight - .025f), LocalSize(len, .10f, .05f));
            }
            cavity.Part("psd-warning-strip", OpeningPartRole.Warning);
            cavity.Box(OpeningColour.Red, Local(cx, wall, z0 + .003f), LocalSize(len, .03f, .006f));

            cavity.Part("psd-fixed-glass", OpeningPartRole.Glass);
            foreach (var panel in layout.Panels) {
                float width = panel.y - panel.x;
                if (width <= .05f) continue;
                float mid = (panel.x + panel.y) * .5f;
                cavity.Box(OpeningColour.Glass, Local(mid, wall, layout.GlassMid),
                    LocalSize(width, .012f, layout.GlassHeight));
            }
            cavity.Part("psd-fixed-rail", OpeningPartRole.Frame);
            foreach (var panel in layout.Panels) {
                float width = panel.y - panel.x;
                if (width <= .05f) continue;
                float mid = (panel.x + panel.y) * .5f;
                if (half) {
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + PsdHalfHeight - .05f - .06f),
                        LocalSize(width, .08f, .12f));
                } else {
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + .03f), LocalSize(width, .12f, .06f));
                    cavity.Box(OpeningColour.Black, Local(mid, wall, z0 + layout.GlassHeight - .03f),
                        LocalSize(width, .12f, .06f));
                }
            }
            cavity.Part("psd-fixed-post", OpeningPartRole.Frame);
            foreach (var post in layout.Posts)
                cavity.Box(OpeningColour.Black, Local(post, wall, layout.GlassMid),
                    LocalSize(.08f, layout.FixedFrameDepth, layout.GlassHeight));
            cavity.Part("psd-section-pillar", OpeningPartRole.Frame);
            foreach (var pillar in layout.Pillars)
                cavity.Box(OpeningColour.Black, Local(pillar, wall, layout.GlassMid),
                    LocalSize(.16f, layout.FixedFrameDepth, layout.GlassHeight));

            // The moving leaves: tinted glass plus its frame, meeting frame, rails, and printed safety vinyl.
            // Each opening owns two leaves, and the pair parts by exactly one door width.
            float decalScale = Mathf.Min(1f, layout.GlassHeight / (2.95f - .05f - PsdHeaderHeight));
            float decalFacing = layout.Left ? 1f : -1f;
            if (!half) {
                var fixedDecalRoot = OpeningBuilder.Node(holder, "psd-decals", Vector3.zero);
                float fixedBandAcross = wall - toward * .075f;
                float fixedBandMid = z0 + 1.12f * decalScale;
                float fixedBandH = .15f * decalScale;
                foreach (var panel in layout.Panels) {
                    float panelW = panel.y - panel.x;
                    if (panelW <= .05f) continue;
                    AddDecalSlot(view.decals, fixedDecalRoot, PsdHeaderKind.FixedBand, -1,
                        panel.x, panel.y, fixedBandAcross, fixedBandMid, fixedBandH,
                        decalFacing, 1024, 128, panelW / 1.2f, false, view.Header,
                        Local((panel.x + panel.y) * .5f, fixedBandAcross, fixedBandMid));
                }
            }
            foreach (var opening in layout.Openings) {
                for (int side = 0; side < 2; side++) {
                    float sign = side == 0 ? -1f : 1f;
                    float leafX = opening.Centre + sign * opening.LeafWidth * .5f;
                    var node = cavity.Node("psd-leaf-" + opening.Index.ToString("00", CultureInfo.InvariantCulture) +
                        (side == 0 ? "-left" : "-right"), Local(leafX, layout.LeafY, layout.LeafMid));
                    if (node == null) continue;
                    var parts = new OpeningBuilder(node, paint);
                    parts.Part("psd-door-glass", OpeningPartRole.Glass);
                    parts.Box(OpeningColour.MovingGlass, Vector3.zero, LocalSize(opening.LeafWidth, .02f, layout.DoorHeight));
                    // All opaque fittings sit track-side of their glass plane.
                    parts.Part("psd-door-frame", OpeningPartRole.Frame);
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
                        // Moving leaf vinyl decals sit proud of the 0.02 m glass box on the platform face
                        // (`-toward * 0.011` / `-0.012`) and are parented to `node` so they slide with the leaf.
                        float leafStart = leafX - opening.LeafWidth * .5f;
                        float leafEnd = leafX + opening.LeafWidth * .5f;
                        float doorBandLocalZ = z0 + 1.12f * decalScale - layout.LeafMid;
                        AddDecalSlot(view.decals, node, PsdHeaderKind.DoorBand, opening.Index,
                            leafStart, leafEnd, layout.LeafY - toward * .011f, z0 + 1.12f * decalScale,
                            .15f * decalScale, decalFacing, 640, 128, 1f, false, view.Header,
                            Local(0f, -toward * .011f, doorBandLocalZ));
                        float warningW = Mathf.Min(.52f * decalScale, opening.LeafWidth - .1f);
                        if (warningW > .05f) {
                            float warningLocalZ = z0 + 1.88f * decalScale - layout.LeafMid;
                            AddDecalSlot(view.decals, node, PsdHeaderKind.DoorWarning, opening.Index,
                                leafX - warningW * .5f, leafX + warningW * .5f, layout.LeafY - toward * .012f,
                                z0 + 1.88f * decalScale, warningW * .75f, decalFacing, 640, 480, 1f, true, view.Header,
                                Local(0f, -toward * .012f, warningLocalZ));
                        }
                        float arrowSize = Mathf.Min(.24f * decalScale, opening.LeafWidth - .1f);
                        if (arrowSize > .05f) {
                            float arrowLocalZ = z0 + 1.48f * decalScale - layout.LeafMid;
                            int arrowSign = (toward < 0f ? -1 : 1) * (sign < 0f ? -1 : 1);
                            var arrowKind = arrowSign < 0 ? PsdHeaderKind.DoorArrowLeft : PsdHeaderKind.DoorArrowRight;
                            AddDecalSlot(view.decals, node, arrowKind, opening.Index,
                                leafX - arrowSize * .5f, leafX + arrowSize * .5f, layout.LeafY - toward * .012f,
                                z0 + 1.48f * decalScale, arrowSize, decalFacing, 256, 256, 1f, true, view.Header,
                                Local(0f, -toward * .012f, arrowLocalZ));
                        }
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
            // RCA 15 §5 sub-item 2: the printed header band, as slots a face provider can
            // bind. The panels themselves are not drawn here — the fascia housing behind them
            // is, so an unpainted slot cannot be mistaken for painted artwork.
            EmitHeaderSlots(holder, layout, half, view.headers, view.Header);
            cavity.Finish(request.ModuleId, view);
            view.Instance = holder.gameObject;
            view.Movable = view.leaves.Count > 0;
            view.Diagnostic = Append(diagnostic, "prefab-housing-unused:run-exceeds-fixture");
            // RCA 15 §5: the slots carry pose, span and key. A direct `BuildAll` (an EditMode
            // test, a bare verifier) has no face provider, so the run names that truth; the
            // renderer replaces this token with `served`/`pending` once it has bound the
            // browser's painted pixels (`OpeningModuleRenderer.BuildHeaders`).
            view.Diagnostic = Append(view.Diagnostic, HeaderArtworkUnported("no-face-provider", view.headers.Count));
            return true;
        }

        /// <summary>
        /// The named diagnostic a PSD run carries while its printed panels are not painted
        /// (RCA 15 §5). `reason` says what is missing — never that the artwork is simply
        /// "unported" when a provider exists.
        /// </summary>
        public static string HeaderArtworkUnported(string reason, int slots) =>
            "psd-header-artwork-unported:" + reason + "(" + slots.ToString(CultureInfo.InvariantCulture) + " slot(s))";

        /// <summary>
        /// Replace a view's printed-header diagnostic with the current truth (`served`,
        /// `pending`, or a named `unported`), leaving every other diagnostic untouched.
        /// </summary>
        public static void SetHeaderArtwork(OpeningView view, string token) {
            if (view == null) return;
            var kept = new StringBuilder();
            var parts = (view.Diagnostic ?? "").Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in parts) {
                var entry = part.Trim();
                if (entry.Length == 0 || entry.StartsWith("psd-header-artwork", StringComparison.Ordinal)) continue;
                if (kept.Length > 0) kept.Append("; ");
                kept.Append(entry);
            }
            if (!string.IsNullOrEmpty(token)) {
                if (kept.Length > 0) kept.Append("; ");
                kept.Append(token);
            }
            view.Diagnostic = kept.ToString();
        }

        /// <summary>
        /// The span arithmetic of `PsdModel.buildPsd`'s header block, as slots.
        ///
        /// Full height: the band over each doorway is a **station** panel spanning exactly the
        /// clear opening, and the fixed spans before, between and after the doorways are
        /// **route** panels; a span shorter than 0.05 m is dropped, as the source drops it.
        /// Half height: the top band is gone, so each fixed pane carries one paired
        /// **sticker** (route print on the left half, station print on the right), inset by
        /// 0.12 m per side, capped at 2.8 m and skipped below 0.7 m.
        /// </summary>
        public static void EmitHeaderSlots(Transform holder, PsdRunLayout layout, bool half,
            List<PsdHeaderSlot> slots, in PsdHeaderPlan plan) {
            if (layout == null || slots == null) return;
            float facing = layout.Left ? 1f : -1f;
            float toward = -facing;
            float wall = layout.WallOffset;
            float x0 = layout.RunStart;
            float end = layout.End;
            if (!half) {
                float mid = 1f + layout.GlassHeight + PsdHeaderHeight * .5f;
                float across = wall - toward * .13f;
                var headerRoot = holder ? OpeningBuilder.Node(holder, "psd-headers", Vector3.zero) : null;
                float cursor = x0;
                foreach (var opening in layout.Openings) {
                    float doorStart = opening.Centre - opening.Width * .5f;
                    AddHeaderSlot(slots, headerRoot, PsdHeaderKind.Route, -1, cursor, doorStart, across, mid,
                        PsdHeaderHeight, facing, 1024, plan);
                    AddHeaderSlot(slots, headerRoot, PsdHeaderKind.Station, opening.Index, doorStart,
                        opening.Centre + opening.Width * .5f, across, mid, PsdHeaderHeight, facing, 1024, plan);
                    cursor = opening.Centre + opening.Width * .5f;
                }
                AddHeaderSlot(slots, headerRoot, PsdHeaderKind.Route, -1, cursor, end, across, mid,
                    PsdHeaderHeight, facing, 1024, plan);
                return;
            }
            // A half-height screen prints the pair on the glass of every fixed pane, at the
            // track-side face of the fixed frame (the source's `fixedFrameDepth / 2 + 0.002`).
            // The slot spans the **printed** plate, inset 0.12 m per side and capped at 2.8 m.
            float surface = wall - toward * (layout.FixedFrameDepth * .5f + .002f);
            var stickerRoot = holder ? OpeningBuilder.Node(holder, "psd-header-stickers", Vector3.zero) : null;
            foreach (var panel in layout.Panels) {
                float width = panel.y - panel.x;
                float printed = Mathf.Min(width - .24f, 2.8f);
                if (printed < .7f) continue;
                float centre = (panel.x + panel.y) * .5f;
                AddHeaderSlot(slots, stickerRoot, PsdHeaderKind.HalfSticker, -1, centre - printed * .5f,
                    centre + printed * .5f, surface, layout.GlassMid, printed * (256f / 2048f), facing, 2048, plan);
            }
        }

        static void AddHeaderSlot(List<PsdHeaderSlot> slots, Transform root, PsdHeaderKind kind, int opening,
            float start, float end, float across, float mid, float height, float facing, int pixels,
            in PsdHeaderPlan plan) {
            float width = end - start;
            if (width < .05f) return;
            var slot = new PsdHeaderSlot {
                Kind = kind,
                OpeningIndex = opening,
                Start = start,
                End = end,
                Across = across,
                Mid = mid,
                Height = height,
                Facing = facing,
                Pixels = pixels,
                Key = PsdHeaderKey(plan, kind),
            };
            if (root) {
                float centre = (start + end) * .5f;
                var node = OpeningBuilder.Node(root, "psd-header-" + kind.ToString().ToLowerInvariant() + "-" +
                    slots.Count.ToString("00", CultureInfo.InvariantCulture), Local(centre, across, mid));
                if (node) {
                    // The slot's forward is the printed face normal — toward the platform, so a
                    // quad attached here reads from the platform and is culled from the track.
                    node.localRotation = Quaternion.LookRotation(new Vector3(0f, 0f, facing), Vector3.up);
                    slot.Node = node;
                }
            }
            slots.Add(slot);
        }

        static void AddDecalSlot(List<PsdHeaderSlot> slots, Transform parent, PsdHeaderKind kind, int opening,
            float start, float end, float across, float mid, float height, float facing,
            int pixels, int pixelHeight, float repeatU, bool transparent, in PsdHeaderPlan plan, Vector3 localPos) {
            float width = end - start;
            if (width < .05f || height < .02f) return;
            var slot = new PsdHeaderSlot {
                Kind = kind,
                OpeningIndex = opening,
                Start = start,
                End = end,
                Across = across,
                Mid = mid,
                Height = height,
                Facing = facing,
                Pixels = pixels,
                PixelHeight = pixelHeight,
                RepeatU = repeatU,
                Transparent = transparent,
                Key = PsdHeaderKey(plan, kind),
            };
            if (parent) {
                var node = OpeningBuilder.Node(parent, "psd-decal-" + PsdHeaderVocabulary.Kind(kind) + "-" +
                    slots.Count.ToString("00", CultureInfo.InvariantCulture), localPos);
                if (node) {
                    node.localRotation = Quaternion.LookRotation(new Vector3(0f, 0f, facing), Vector3.up);
                    slot.Node = node;
                }
            }
            slots.Add(slot);
        }

        /* --------------------------------------------------------- fixed PSD ends */

        static bool BuildEnd(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform parent, OpeningPalette paint, OpeningView view) {
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
                // `PsdEndModel`: one white box (width x depth x 1 m) at
                // `(offset[0], ±0.34 + offset[1], 0.5)` in the module's own frame — base at the
                // record's own elevation, course one metre tall, so it stacks on the screen.
                float width = request.HasWidth ? request.ConfigWidth : 1f;
                float depth = request.HasDepth ? request.ConfigDepth : .24f;
                float sideY = string.Equals(request.Side, "right", StringComparison.Ordinal) ? .34f : -.34f;
                // The source's panel centre in the holder's axes. The promoted `psd-end-cover`
                // prefab bakes its canonical panel there (measured: the GLB `psd-cover-panel`
                // node sits at source (0, −0.34, 0.5), so the piece is the **left-bank** course
                // and its pivot is the course base), which is why the instance is placed by its
                // measured centre rather than an assumed one.
                var target = Local(request.OffsetX, sideY + request.OffsetY, .5f);
                if (TryPrefab(request, catalogue, PsdCoverPrefabKey, holder, view, out var coverInstance)) {
                    var place = target;
                    coverInstance.transform.localPosition = Vector3.zero;
                    if (MeshBoundsIn(coverInstance.transform, holder, out var baked)) {
                        place = target - baked.center;
                        coverInstance.transform.localPosition = place;
                        if (Mathf.Abs(place.y) > 1e-3f) {
                            // The prefab's pivot is not the course base: say so rather than
                            // letting the mesh float or sink by a silent correction.
                            view.Diagnostic = "prefab-pivot-offset:y " +
                                place.y.ToString("+0.###;-0.###", CultureInfo.InvariantCulture);
                        }
                    }
                    if (PlanExtentsMatch(coverInstance, holder, width, depth, 1f, out var extentDiagnostic)) {
                        var part = MeasurePart("psd-cover-panel", OpeningPartRole.Cover, coverInstance.transform,
                            holder, paint, OpeningColour.White);
                        part.PrefabOffset = place;
                        view.parts.Add(part);
                        view.Instance = coverInstance;
                        view.ViewKey = PsdCoverPrefabKey;
                        view.Movable = false;
                        return true;
                    }
                    // Report the measured offset, not just a code: this is the number the RCA
                    // asked to measure before touching the course.
                    view.Diagnostic = Append(view.Diagnostic, "prefab-extent-mismatch:cover " + extentDiagnostic);
                    Discard(coverInstance);
                }
                var box = new OpeningBuilder(holder, paint);
                box.Part("psd-cover-panel", OpeningPartRole.Cover);
                box.Box(OpeningColour.White, Local(request.OffsetX, sideY + request.OffsetY, .5f),
                    LocalSize(width, depth, 1f));
                box.Finish(request.ModuleId, view);
                view.Instance = holder.gameObject;
                view.ViewKey = PsdEndGeneratedKey + ":cover";
                view.PrefabPath = "";
                view.Movable = false;
                if (view.Diagnostic.Length == 0)
                    view.Diagnostic = "prefab-extent-mismatch:cover " +
                        width.ToString("0.###", CultureInfo.InvariantCulture) + "x" +
                        depth.ToString("0.###", CultureInfo.InvariantCulture);
                return true;
            }

            if (half && TryPrefab(request, catalogue, PsdEndPrefabKey, holder, view, out var halfInstance)) {
                // `PsdEndModel`: `child.position.x += ox; child.position.y += oy` — the offset
                // is along/across in the **source** frame, so the holder-local position is
                // `Local(ox, oy, 0)`. (The previous `Local(ox, 0, oy)` put the across offset
                // into the elevation.) The promoted frame's x may be mirrored; a corner end's
                // ox is the only value this affects and no half-height corner exists in the
                // shipped saves, so it is applied in the document's x and reported if it moves.
                halfInstance.transform.localPosition = Local(endOffset.x, endOffset.y, 0f);
                view.parts.Add(MeasurePart("psd-end-panel", OpeningPartRole.Other, halfInstance.transform, holder,
                    paint, OpeningColour.White));
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
            // The screen faces the track: `side: right` mirrors the wall plane (a saved
            // `side` the run honours, and the return shares the run's frame).
            float wall = string.Equals(request.Side, "right", StringComparison.Ordinal) ? PsdWallOffset : -PsdWallOffset;
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
            // The same named parts the run records, so an end can be compared with the run it
            // continues (RCA 15 §5).
            cavity.Part("psd-threshold", OpeningPartRole.Threshold);
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, sillY + shiftY, z0 - .01f), LocalSize(len, sillDepth, .02f));
            cavity.Part("psd-concrete-foundation", OpeningPartRole.Foundation);
            cavity.Box(OpeningColour.Concrete, Local(cx + shiftX, sillY + shiftY, z0 - .51f), LocalSize(len, sillDepth, .98f));
            cavity.Part("psd-info-housing", OpeningPartRole.Fascia);
            cavity.Box(OpeningColour.White, Local(cx + shiftX, wall + shiftY, z0 + doorH + PsdHeaderHeight * .5f),
                LocalSize(len, .24f, PsdHeaderHeight));
            cavity.Part("psd-fascia-cap", OpeningPartRole.Fascia);
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + PsdFullHeight - .025f),
                LocalSize(len, .28f, .05f));
            cavity.Part("psd-warning-strip", OpeningPartRole.Warning);
            cavity.Box(OpeningColour.Red, Local(cx + shiftX, wall + shiftY, z0 + .003f), LocalSize(len, .03f, .006f));
            cavity.Part("psd-fixed-glass", OpeningPartRole.Glass);
            cavity.Box(OpeningColour.Glass, Local(cx + shiftX, wall + shiftY, glassMid), LocalSize(len, .012f, doorH));
            cavity.Part("psd-fixed-rail", OpeningPartRole.Frame);
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + .03f), LocalSize(len, .12f, .06f));
            cavity.Box(OpeningColour.Black, Local(cx + shiftX, wall + shiftY, z0 + doorH - .03f),
                LocalSize(len, .12f, .06f));
            cavity.Part("psd-fixed-post", OpeningPartRole.Frame);
            foreach (var post in new[] { x0 + .04f, x0 + len - .04f })
                cavity.Box(OpeningColour.Black, Local(post + shiftX, wall + shiftY, glassMid), LocalSize(.08f, .14f, doorH));
            cavity.Part("psd-section-pillar", OpeningPartRole.Frame);
            foreach (var pillar in new[] { x0 + .08f, x0 + len - .08f })
                cavity.Box(OpeningColour.Black, Local(pillar + shiftX, wall + shiftY, glassMid),
                    LocalSize(.16f, .14f, doorH));
            // 18 §3: the opaque return stops at its parent screen's housing, slice by slice,
            // while the fixed glass stays on the shared centreline. A continuation with no
            // resolvable parent is trimmed by its own box and tile bounds only, and says so.
            var housing = ParentHousing(request, facts, station, half, out var housingNote);
            bool trimmed = housing != null && housing.Count > 0;
            if (trimmed) view.housing.AddRange(housing);
            cavity.Trim((part, role, centre, size) => {
                bool glass = role == OpeningPartRole.Glass ||
                    (part ?? "").IndexOf("glass", StringComparison.OrdinalIgnoreCase) >= 0;
                return PsdReturnTrim.Apply(centre, size, glass, ox, housing);
            });
            cavity.Finish(request.ModuleId, view);
            view.Instance = holder.gameObject;
            view.ViewKey = PsdEndGeneratedKey;
            view.Movable = false;
            view.FoundationFinish = paint != null ? paint.FoundationFinish : "";
            view.Diagnostic = half ? "half-prefab-missing:generated" : "prefab-half-height:generated-full";
            view.Diagnostic = Append(view.Diagnostic, (trimmed ? "psd-end-housing:" : "psd-end-housing-missing:") +
                housingNote);
            return true;
        }

        /// <summary>
        /// 18 §3 — the parent screen's housing in the return's own frame. `cfg.corner` is
        /// resolved by **exact module id**; its run profile comes from the same `PsdRunLayout`
        /// arithmetic `BuildRun` draws; and every box is carried through the corner holder's
        /// transform into the return's, so the two pieces are compared in one frame.
        /// </summary>
        static List<PsdReturnTrim.Housing> ParentHousing(OpeningRequest request, ModuleFacts facts,
            IReadOnlyList<ModuleFacts> station, bool half, out string note) {
            note = "";
            if (string.IsNullOrEmpty(request.Corner)) { note = "no-corner"; return null; }
            ModuleFacts corner = null;
            if (station != null) {
                for (int i = 0; i < station.Count; i++) {
                    var candidate = station[i];
                    if (candidate == null) continue;
                    if (!string.Equals(candidate.Type, "platform-edge", StringComparison.Ordinal)) continue;
                    if (!string.Equals(candidate.Id, request.Corner, StringComparison.Ordinal)) continue;
                    corner = candidate;
                    break;
                }
            }
            if (corner == null) { note = "corner-not-found:" + request.Corner; return null; }
            var run = new PsdRunRequest {
                ModuleId = corner.Id, X = corner.X, Y = corner.Y, Z = corner.Z,
                Rotation = corner.Rotation, Width = Mathf.Max(1, corner.Width),
                Side = request.Side, Psd = request.Psd, StoreyHeight = request.StoreyHeight,
            };
            if (!TryPsdRun(run, out var layout, out var runDiagnostic)) {
                note = "corner-layout:" + runDiagnostic;
                return null;
            }
            var profile = PsdReturnTrim.ProfileFromRun(layout, half);
            if (profile.Count == 0) { note = "corner-empty"; return null; }
            var cornerFrame = Matrix4x4.TRS(Pivot(corner, new Vector3(.5f, .5f, 0f), false),
                ModulePlacement.Rotation(corner.Rotation), Vector3.one);
            var endFrame = Matrix4x4.TRS(Pivot(facts, new Vector3(.5f, .5f, 0f), false),
                ModulePlacement.Rotation(facts.Rotation), Vector3.one);
            var relative = endFrame.inverse * cornerFrame;
            var housing = new List<PsdReturnTrim.Housing>(profile.Count);
            for (int i = 0; i < profile.Count; i++) housing.Add(PsdReturnTrim.Transform(profile[i], relative));
            note = "boxes=" + housing.Count.ToString(CultureInfo.InvariantCulture);
            return housing;
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
        public static bool PlanExtentsMatch(GameObject instance, Transform holder, float width, float depth) =>
            PlanExtentsMatch(instance, holder, width, depth, 0f, out _);

        /// <summary>
        /// RCA 15 §5: a promoted prefab is accepted only when it reproduces **both** the saved
        /// plan extents and — when <paramref name="height"/> is positive — the saved vertical
        /// span of the course. A `psd-end` cover's base is the record's own elevation, so in
        /// the holder's frame the course must measure <c>[0, height]</c> up. The promoted
        /// `PsdEndCover` bakes its panel centred on its pivot, which is why the caller places
        /// the instance at the source's panel centre before asking; a prefab of another height
        /// (or one whose content is off-centre) is rejected with the measured span.
        /// </summary>
        public static bool PlanExtentsMatch(GameObject instance, Transform holder, float width, float depth,
            float height, out string diagnostic) {
            diagnostic = "";
            if (!instance || !holder) {
                diagnostic = "no-instance";
                return false;
            }
            if (!MeshBoundsIn(instance.transform, holder, out var bounds)) {
                diagnostic = "no-mesh";
                return false;
            }
            bool plan = Mathf.Abs(bounds.size.x - width) <= .02f && Mathf.Abs(bounds.size.z - depth) <= .02f;
            bool vertical = height <= 0f ||
                (Mathf.Abs(bounds.min.y) <= .02f && Mathf.Abs(bounds.max.y - height) <= .02f);
            if (plan && vertical) return true;
            var id = CultureInfo.InvariantCulture;
            var text = new StringBuilder();
            if (!plan) {
                text.Append("plan ").Append(bounds.size.x.ToString("0.###", id)).Append('x')
                    .Append(bounds.size.z.ToString("0.###", id)).Append(" saved ")
                    .Append(width.ToString("0.###", id)).Append('x').Append(depth.ToString("0.###", id));
            }
            if (!vertical) {
                if (text.Length > 0) text.Append("; ");
                text.Append("vertical measured ").Append(bounds.min.y.ToString("0.###", id)).Append("..")
                    .Append(bounds.max.y.ToString("0.###", id)).Append(" saved ")
                    .Append(0f.ToString("0.###", id)).Append("..").Append(height.ToString("0.###", id));
                text.Append(" offset ").Append((bounds.min.y - 0f).ToString("+0.###;-0.###", id));
            }
            diagnostic = text.ToString();
            return false;
        }

        /* ------------------------------------------------------------------ gates */

        static bool BuildGate(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform parent, OpeningView view, OpeningPalette paint) {
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
            ApplyGateIndicators(instance.transform, lane, request.Dir, paint);
            if (wing == null) {
                if (lane) return FailAndDiscard(view, "gate-has-no-wing");
                view.Movable = false;
                BuildGateFencePanel(request, facts, station, catalogue, instance.transform, view, paint);
                CompactGateInstance(entry.prefab, instance.transform, null, paint);
                return true;
            }
            if (!lane) {
                // A fence machine has no leaf channel: the source draws a fence panel through
                // the lane. The exported wings are the wrong geometry for it, so they are
                // retired and the panel is composed from the source's own fence numbers (18 §5).
                wing.gameObject.SetActive(false);
                view.Movable = false;
                BuildGateFencePanel(request, facts, station, catalogue, instance.transform, view, paint);
                CompactGateInstance(entry.prefab, instance.transform, wing, paint);
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
            CompactGateInstance(entry.prefab, instance.transform, wing, paint);
            return true;
        }

        /// <summary>
        /// Port of `GateModel`'s directional / doorless indicator plates:
        /// `allowed = hasLane &amp;&amp; (dir === 'both' || (fy === -1 ? dir === 'in' : dir === 'out'))`.
        /// Promoted `gate` and `gate-new` prefabs bake `gatePanel` on the entry (`Approach`, `fy = -1`)
        /// face and `gatePanelBack` on the exit (`Front`, `fy = +1`) face. Disallowed or fence-mode
        /// faces switch to `no-entry-cross` with `PieceBuilder`'s `64×76` `#ff4545` on `#0b0d11` cross.
        /// </summary>
        static void ApplyGateIndicators(Transform instance, bool lane, string rawDir, OpeningPalette paint) {
            if (!instance) return;
            string dir = string.IsNullOrEmpty(rawDir) ? "both" : rawDir;
            var approach = FindNode(instance, "Approach");
            var front = FindNode(instance, "Front");
            foreach (var renderer in instance.GetComponentsInChildren<MeshRenderer>(true)) {
                if (!renderer) continue;
                var material = renderer.sharedMaterial;
                var baseMat = material != null ? OutdoorModuleViews.MaterialBaseName(material.name) : "";
                var nodeName = renderer.gameObject.name ?? "";
                bool isIndicator = string.Equals(nodeName, "entry-arrow", StringComparison.Ordinal) ||
                    string.Equals(nodeName, "no-entry-cross", StringComparison.Ordinal) ||
                    string.Equals(baseMat, "gatePanel", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(baseMat, "gatePanelBack", StringComparison.OrdinalIgnoreCase);
                if (!isIndicator) continue;

                bool isEntryFace;
                if (string.Equals(baseMat, "gatePanel", StringComparison.OrdinalIgnoreCase)) {
                    isEntryFace = true;
                } else if (string.Equals(baseMat, "gatePanelBack", StringComparison.OrdinalIgnoreCase)) {
                    isEntryFace = false;
                } else if (approach && front) {
                    var centre = MeshBoundsIn(renderer.transform, instance, out var local)
                        ? local.center
                        : instance.InverseTransformPoint(renderer.transform.position);
                    var approachPos = instance.InverseTransformPoint(approach.position);
                    var frontPos = instance.InverseTransformPoint(front.position);
                    isEntryFace = (centre - approachPos).sqrMagnitude <= (centre - frontPos).sqrMagnitude;
                } else {
                    isEntryFace = renderer.transform.localPosition.y < 0f || renderer.transform.localPosition.z < 0f;
                }

                bool allowed = lane && (string.Equals(dir, "both", StringComparison.Ordinal) ||
                    (isEntryFace
                        ? string.Equals(dir, "in", StringComparison.Ordinal)
                        : string.Equals(dir, "out", StringComparison.Ordinal)));
                renderer.gameObject.name = allowed ? "entry-arrow" : "no-entry-cross";
                if (!allowed) {
                    var cross = paint != null
                        ? paint.GateCrossMaterial(material)
                        : GateIndicatorMaterialOwner.For(instance.gameObject, material);
                    if (cross != null) renderer.sharedMaterial = cross;
                }
            }
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
        /// 18 §5 — the fence panel a **doorless** machine carries through its lane. The
        /// source's doorless branch (`GateModel.build`) draws `drawFence` from the cabinet's
        /// inner jamb to the cell edge, a jamb post where it leaves the machine, and a free-end
        /// cap unless the neighbouring run carries the barrier on. The exported wings are the
        /// wrong geometry for this door type, and `StationOutdoorConnections.GateSolidFaces`
        /// already reports the gate as solid on every side, so without this the adjacent fence
        /// met a gap where the save promised a solid face.
        ///
        /// The jamb is measured from the promoted prefab (its lane leaves when it has them,
        /// its own cabinet body when it does not), so the panel lands in the machine's frame
        /// whatever handedness the promotion baked in. The arm, post and clamp dimensions are
        /// `OutdoorModuleViews`' shared `drawFence`/`fencePost` numbers, and `steel`/`glass`
        /// come from `Fence.prefab` first so the attached barrier matches an adjacent fence 1:1.
        /// </summary>
        static bool BuildGateFencePanel(OpeningRequest request, ModuleFacts facts, IReadOnlyList<ModuleFacts> station,
            RuntimeCatalogue catalogue, Transform instance, OpeningView view, OpeningPalette paint) {
            if (!instance) {
                view.Diagnostic = "fence-door:no-instance";
                return false;
            }
            if (!TryMeasureGateJambInHolder(instance, out float inner)) {
                view.Diagnostic = "fence-door:jamb-unmeasurable";
                return false;
            }
            // 18c §1: the panel grows toward the **lane's own** cell edge — +X in the holder frame,
            // the very side `LaneNeighbourCarries` looks at. Choosing the edge from the sign of a
            // jamb measured in the imported wing's frame put the panel one tile edge away, because
            // that wing carries glTFast's X reflection under the prefab's 180° wrapper.
            float edge = GateCellEdge;
            bool carried = LaneNeighbourCarries(facts, station);
            var steelVertices = new List<Vector3>();
            var steelTriangles = new List<int>();
            var glassVertices = new List<Vector3>();
            var glassTriangles = new List<int>();
            OutdoorModuleViews.AppendFenceRail(steelVertices, steelTriangles,
                glassVertices, glassTriangles, inner, edge, false);
            OutdoorModuleViews.AppendFencePost(steelVertices, steelTriangles, inner, 0f);
            if (!carried) {
                // `drawFence`'s `capE`: a free end caps itself one clamp inset from the edge.
                float cap = edge - Mathf.Sign(edge - inner) * .04f;
                OutdoorModuleViews.AppendFencePost(steelVertices, steelTriangles, cap, 0f);
            }
            var root = new GameObject("fence panel");
            root.transform.SetParent(instance, false);
            Material steel = null, glass = null;
            if (catalogue != null && catalogue.TryGet("fence", out var fenceEntry) && fenceEntry.prefab != null) {
                OutdoorModuleViews.TryExtractFenceMaterials(fenceEntry.prefab, out steel, out glass);
            }
            if (steel == null) steel = GateMaterial(instance, paint, "steel", OpeningColour.Steel);
            if (glass == null) {
                glass = GateMaterial(instance, null, "glass", OpeningColour.Glass);
                if (glass == null && paint != null) glass = paint[OpeningColour.Glass];
            }
            OutdoorModuleViews.AddPart(root.transform, "fence panel steel", steelVertices, steelTriangles, steel, paint);
            OutdoorModuleViews.AddPart(root.transform, "fence panel glass", glassVertices, glassTriangles, glass, paint);
            view.Instance = instance.gameObject;
            view.Diagnostic = carried ? "fence-door:panel-carried" : "fence-door:panel-capped";
            // The signed span the panel was drawn with, in the holder frame, for a probe that has
            // to read the **side** rather than an absolute extent (18c §1).
            view.PanelJamb = inner;
            view.PanelEdge = edge;
            return true;
        }

        /// <summary>
        /// `GateModel`'s doorless `drawFence` runs from the cabinet's inner jamb to the cell edge
        /// on the lane's own side: `inner = −(0.5 − GATE_W)` to `+0.5` in the **holder** frame.
        /// </summary>
        public static float GateJambInner => -(0.5f - GateWidth);
        /// <summary>The cell edge the lane opens towards, in the holder frame, metres.</summary>
        public const float GateCellEdge = .5f;

        /// <summary>
        /// The machine's inner jamb measured in its **holder** frame (18c §1). `TryMeasureGateLane`
        /// answers in the imported `wing` node's frame, which the promotion mirrors; reading those
        /// extents as if they were the outer instance's put the fence panel on the far edge. The
        /// lane always runs toward +X here, so the cabinet jamb is the endpoint nearer the centre
        /// on the −X side, and a prefab with no leaves falls back to the cabinet body's own edge.
        /// </summary>
        static bool TryMeasureGateJambInHolder(Transform instance, out float inner) {
            inner = 0f;
            if (!instance) return false;
            var left = FindNode(instance, "left-leaf");
            var right = FindNode(instance, "right-leaf");
            if (left && right) {
                var a = LeafLocalExtentX(left, instance);
                var b = LeafLocalExtentX(right, instance);
                float near = Mathf.Min(a.x, b.x), far = Mathf.Max(a.y, b.y);
                if (far - near > .05f) {
                    float endpoint = Mathf.Abs(near) <= Mathf.Abs(far) ? near : far;
                    inner = -Mathf.Abs(endpoint);
                    return true;
                }
            }
            if (!MeshBoundsIn(instance, instance, out var bounds)) return false;
            float lo = bounds.min.x, hi = bounds.max.x;
            if (hi - lo < .05f || hi - lo > .6f) return false;
            inner = -Mathf.Abs(Mathf.Abs(lo) <= Mathf.Abs(hi) ? lo : hi);
            return true;
        }

        /// <summary>
        /// The machine's inner jamb in its own local metres: the lane end nearer the cell centre
        /// when the promoted prefab carries leaves, otherwise the cabinet body's own nearer edge.
        /// </summary>
        static bool TryMeasureGateJamb(Transform instance, out float inner) {
            inner = 0f;
            if (!instance) return false;
            if (TryMeasureGateLane(instance, out var nearJamb, out var farJamb, out _)) {
                inner = Mathf.Abs(nearJamb) <= Mathf.Abs(farJamb) ? nearJamb : farJamb;
                return true;
            }
            if (!MeshBoundsIn(instance, instance, out var bounds)) return false;
            float lo = bounds.min.x, hi = bounds.max.x;
            // The bare cabinet is one machine wide (0.30 m); a wider extent means the bounds
            // cannot isolate it, so the jamb stays unmeasured and is named.
            if (hi - lo < .05f || hi - lo > .6f) return false;
            inner = Mathf.Abs(lo) <= Mathf.Abs(hi) ? lo : hi;
            return true;
        }

        /// <summary>
        /// `GateModel`'s doorless `carried`: a same-level fence, or a gate whose solid face
        /// points back at this cell, stands on the neighbour the lane opens towards.
        /// </summary>
        static bool LaneNeighbourCarries(ModuleFacts facts, IReadOnlyList<ModuleFacts> station) {
            if (facts == null || station == null) return false;
            StationFootprints.RotateLocal(facts.Rotation, 1, 0, out var ox, out var oy);
            int dx = (int)Math.Round(ox), dy = (int)Math.Round(oy);
            for (int i = 0; i < station.Count; i++) {
                var other = station[i];
                if (other == null || other.Z != facts.Z) continue;
                if (other.X != facts.X + dx || other.Y != facts.Y + dy) continue;
                if (string.Equals(other.Type, "fence", StringComparison.Ordinal)) return true;
                if (string.Equals(other.Type, "gate", StringComparison.Ordinal) &&
                    Metro.View.StationFenceConnections.GateSolidFaces(other, -dx, -dy)) return true;
            }
            return false;
        }

        /// <summary>The gate's own material naming the exact slot (not a substring like `darkSteel`), else the opening palette's.</summary>
        static Material GateMaterial(Transform instance, OpeningPalette paint, string match, int slot) {
            if (instance) {
                foreach (var renderer in instance.GetComponentsInChildren<MeshRenderer>(true)) {
                    foreach (var material in renderer.sharedMaterials) {
                        if (!material || material.name == null) continue;
                        var baseName = OutdoorModuleViews.MaterialBaseName(material.name);
                        if (string.Equals(baseName, match, StringComparison.OrdinalIgnoreCase)) return material;
                    }
                }
            }
            return paint != null ? paint[slot] : null;
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

        /// <summary>
        /// Measure one named part of a built view (RCA 15 §5): its mesh bounds in the holder's
        /// frame — the source's own axes, so they can be read against `PsdModel.ts` — and the
        /// same box in document axes. `palette`/`colour` only name the material it was drawn
        /// with, so a report says which slot (or which station finish) a part uses.
        /// </summary>
        public static OpeningPart MeasurePart(string name, OpeningPartRole role, Transform node, Transform holder,
            OpeningPalette palette = null, int colour = -1) {
            var part = new OpeningPart {
                Name = name ?? "",
                Role = role,
                Node = node,
                Material = colour == OpeningColour.Concrete && palette != null && palette.FoundationFinish.Length > 0
                    ? palette.FoundationFinish
                    : (colour >= 0 ? OpeningColour.Name(colour) : ""),
                Datum = holder ? StationCoordinates.WorldToDocument(holder.position).z : 0f,
            };
            if (!node || !holder || !MeshBoundsIn(node, holder, out var local)) return part;
            part.Local = local;
            var document = default(Bounds);
            for (int corner = 0; corner < 8; corner++) {
                var point = new Vector3(
                    (corner & 1) == 0 ? local.min.x : local.max.x,
                    (corner & 2) == 0 ? local.min.y : local.max.y,
                    (corner & 4) == 0 ? local.min.z : local.max.z);
                var inDocument = StationCoordinates.WorldToDocument(holder.TransformPoint(point));
                if (corner == 0) document = new Bounds(inDocument, Vector3.zero);
                else document.Encapsulate(inDocument);
            }
            part.Document = document;
            return part;
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
            RuntimeCatalogue catalogue, Transform parent, OpeningView view, OpeningPalette paint) {
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
                CompactSwingOpeningInstance(entry.prefab, instance.transform, pivots, paint);
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
            CompactSwingOpeningInstance(entry.prefab, instance.transform, pivots, paint);
            return true;
        }

        static bool BuildCubicle(OpeningRequest request, ModuleFacts facts, RuntimeCatalogue catalogue, Transform parent,
            OpeningView view, OpeningPalette paint) {
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
                CompactSwingOpeningInstance(entry.prefab, instance.transform, null, paint);
                return true;
            }
            var pivot = instance.GetComponentsInChildren<Transform>(true)
                .FirstOrDefault(node => node.name == "passenger-swing-door");
            if (!pivot) {
                view.Movable = false;
                view.Diagnostic = "no-swing-pivot:" + key;
                CompactSwingOpeningInstance(entry.prefab, instance.transform, null, paint);
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
            CompactSwingOpeningInstance(entry.prefab, instance.transform, new List<Transform> { pivot }, paint);
            return true;
        }

        /* ---------------------------------------------------- static subtree compaction */

        static readonly HashSet<string> GateExcludedNames = new HashSet<string>(StringComparer.Ordinal) {
            "wing", "fence panel", "entry-arrow", "no-entry-cross",
        };

        static readonly HashSet<string> OpeningProtectedNames = new HashSet<string>(StringComparer.Ordinal) {
            "gate-body", "Approach", "AxisX", "Front", "Up",
            "wing", "fence panel", "passenger-swing-door", "entry-arrow", "no-entry-cross",
        };

        static void CompactGateInstance(GameObject prefab, Transform instance, Transform wing, OpeningPalette paint) {
            if (prefab == null || instance == null || paint == null) return;
            HashSet<Transform> excluded = null;
            if (wing != null) (excluded ??= new HashSet<Transform>()).Add(wing);
            var fencePanel = instance.Find("fence panel");
            if (fencePanel != null) (excluded ??= new HashSet<Transform>()).Add(fencePanel);
            CompactSubtree(prefab, "gate:static", instance, paint, excluded, GateExcludedNames, OpeningProtectedNames);
        }

        static void CompactSwingOpeningInstance(GameObject prefab, Transform instance, List<Transform> pivots, OpeningPalette paint) {
            if (prefab == null || instance == null || paint == null) return;
            HashSet<Transform> excluded = null;
            if (pivots != null && pivots.Count > 0) {
                excluded = new HashSet<Transform>(pivots);
            }
            CompactSubtree(prefab, "opening:static", instance, paint, excluded, null, OpeningProtectedNames);
            if (pivots != null) {
                for (int i = 0; i < pivots.Count; i++) {
                    if (pivots[i] != null) {
                        CompactSubtree(prefab, "opening:pivot-" + i.ToString(CultureInfo.InvariantCulture),
                            pivots[i], paint, null, null, OpeningProtectedNames);
                    }
                }
            }
        }

        sealed class SubtreeMaterialKey : IEquatable<SubtreeMaterialKey> {
            public readonly Material Material;
            public readonly ShadowCastingMode Shadow;
            public SubtreeMaterialKey(Material material, ShadowCastingMode shadow) {
                Material = material;
                Shadow = shadow;
            }
            public bool Equals(SubtreeMaterialKey other) =>
                other != null && ReferenceEquals(Material, other.Material) && Shadow == other.Shadow;
            public override bool Equals(object obj) => obj is SubtreeMaterialKey other && Equals(other);
            public override int GetHashCode() {
                unchecked {
                    int h = Material != null ? System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Material) : 0;
                    return (h * 397) ^ (int)Shadow;
                }
            }
        }

        sealed class SubtreeCombineBucket {
            public Material Material;
            public ShadowCastingMode Shadow;
            public readonly List<CombineInstance> Combines = new List<CombineInstance>();
            public int VertexCount;
            public int MaxLodCount = 1;
            public bool HasSelectionCurve;
            public Mesh.LodSelectionCurve SelectionCurve;
        }

        static bool IsUnderAny(Transform node, Transform stopAt, HashSet<Transform> excludedRoots, HashSet<string> excludedNames) {
            var cur = node;
            while (cur != null) {
                if (excludedRoots != null && excludedRoots.Contains(cur)) return true;
                if (excludedNames != null && excludedNames.Contains(cur.name)) return true;
                if (cur == stopAt) return false;
                cur = cur.parent;
            }
            return false;
        }

        static bool IsActiveInSubtree(Transform node, Transform subtreeRoot) {
            var cur = node;
            while (cur != null) {
                if (!cur.gameObject.activeSelf) return false;
                if (cur == subtreeRoot) return true;
                cur = cur.parent;
            }
            return true;
        }

        static void MarkProtectedAncestors(Transform node, Transform subtreeRoot, HashSet<Transform> protectedNodes) {
            var cur = node;
            while (cur != null) {
                protectedNodes.Add(cur);
                if (cur == subtreeRoot) break;
                cur = cur.parent;
            }
        }

        static Matrix4x4 RelativeMatrix(Transform node, Transform ancestor) {
            var mat = Matrix4x4.identity;
            var cur = node;
            while (cur != null && cur != ancestor) {
                mat = Matrix4x4.TRS(cur.localPosition, cur.localRotation, cur.localScale) * mat;
                cur = cur.parent;
            }
            return mat;
        }

        static bool HasExtraComponents(Transform node) {
            var components = node.GetComponents<Component>();
            for (int i = 0; i < components.Length; i++) {
                var c = components[i];
                if (c == null || c is Transform || c is MeshFilter || c is MeshRenderer) continue;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Merge same-(material, shadow) readable triangle meshes inside <paramref name="subtreeRoot"/>
        /// while leaving excluded/moving subtrees and named anchors untouched, caching the merged
        /// multi-LOD meshes per <c>(prefab, tag)</c> on <paramref name="paint"/>.
        /// </summary>
        internal static void CompactSubtree(
            GameObject prefab,
            string tag,
            Transform subtreeRoot,
            OpeningPalette paint,
            HashSet<Transform> excludedRoots,
            HashSet<string> excludedNames,
            HashSet<string> protectedNames) {
            if (prefab == null || subtreeRoot == null || paint == null) return;
            var filters = subtreeRoot.GetComponentsInChildren<MeshFilter>(true);
            if (filters == null || filters.Length < 2) return;

            var lodLibrary = Resources.Load<StationRigidModelLods>(StationRigidModelLods.ResourcesPath + prefab.name);
            var protectedNodes = new HashSet<Transform> { subtreeRoot };
            var allTransforms = subtreeRoot.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < allTransforms.Length; i++) {
                var t = allTransforms[i];
                if (t == null) continue;
                if ((excludedRoots != null && excludedRoots.Contains(t)) ||
                    (excludedNames != null && excludedNames.Contains(t.name)) ||
                    (protectedNames != null && protectedNames.Contains(t.name)) ||
                    HasExtraComponents(t)) {
                    MarkProtectedAncestors(t, subtreeRoot, protectedNodes);
                }
            }

            var eligible = new List<(MeshFilter Filter, MeshRenderer Renderer, Mesh Mesh, Material[] Materials)>(filters.Length);
            for (int i = 0; i < filters.Length; i++) {
                var filter = filters[i];
                if (filter == null) continue;
                if (IsUnderAny(filter.transform, subtreeRoot, excludedRoots, excludedNames)) {
                    MarkProtectedAncestors(filter.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                if (!IsActiveInSubtree(filter.transform, subtreeRoot)) {
                    MarkProtectedAncestors(filter.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                var renderer = filter.GetComponent<MeshRenderer>();
                var mesh = filter.sharedMesh;
                if (renderer == null || !renderer.enabled || mesh == null || mesh.vertexCount == 0) {
                    MarkProtectedAncestors(filter.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                if (lodLibrary != null) mesh = lodLibrary.Resolve(mesh);
                var mats = renderer.sharedMaterials;
                if (!mesh.isReadable || mats == null || mats.Length == 0) {
                    MarkProtectedAncestors(filter.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                int subCount = Math.Max(1, mesh.subMeshCount);
                bool allTri = true;
                for (int s = 0; s < subCount; s++) {
                    var mat = mats[Math.Min(s, mats.Length - 1)];
                    if (mat == null || mesh.GetTopology(s) != MeshTopology.Triangles) {
                        allTri = false;
                        break;
                    }
                }
                if (!allTri) {
                    MarkProtectedAncestors(filter.transform, subtreeRoot, protectedNodes);
                    continue;
                }
                eligible.Add((filter, renderer, mesh, mats));
            }
            if (eligible.Count < 2) return;

            if (!paint.TryGetCompactedSubtree(prefab, tag, out var cachedParts)) {
                var buckets = new Dictionary<SubtreeMaterialKey, SubtreeCombineBucket>();
                var order = new List<SubtreeCombineBucket>();
                for (int i = 0; i < eligible.Count; i++) {
                    var item = eligible[i];
                    var rel = RelativeMatrix(item.Filter.transform, subtreeRoot);
                    int subCount = Math.Max(1, item.Mesh.subMeshCount);
                    int lodCount = Math.Max(1, item.Mesh.lodCount);
                    for (int s = 0; s < subCount; s++) {
                        var mat = item.Materials[Math.Min(s, item.Materials.Length - 1)];
                        var key = new SubtreeMaterialKey(mat, item.Renderer.shadowCastingMode);
                        if (!buckets.TryGetValue(key, out var bucket)) {
                            bucket = new SubtreeCombineBucket { Material = mat, Shadow = item.Renderer.shadowCastingMode };
                            buckets[key] = bucket;
                            order.Add(bucket);
                        }
                        bucket.Combines.Add(new CombineInstance {
                            mesh = item.Mesh,
                            subMeshIndex = s,
                            transform = rel,
                        });
                        bucket.VertexCount += item.Mesh.vertexCount;
                        if (lodCount > bucket.MaxLodCount) bucket.MaxLodCount = lodCount;
                        if (!bucket.HasSelectionCurve && lodCount > 1) {
                            bucket.HasSelectionCurve = true;
                            bucket.SelectionCurve = item.Mesh.lodSelectionCurve;
                        }
                    }
                }

                if (order.Count == 0 || order.Count >= eligible.Count) {
                    paint.StoreCompactedSubtree(prefab, tag, Array.Empty<OpeningPalette.CompactedPart>());
                    return;
                }

                var built = new List<OpeningPalette.CompactedPart>(order.Count);
                bool failed = false;
                for (int b = 0; b < order.Count; b++) {
                    var bucket = order[b];
                    string matLabel = bucket.Material != null ? bucket.Material.name : "mat";
                    string meshName = prefab.name + " " + tag + " [" + matLabel + "]";
                    if (!StationPrefabMeshTemplate.TryCombineBucketMesh(meshName, bucket.Combines, bucket.MaxLodCount,
                            bucket.HasSelectionCurve, bucket.SelectionCurve, bucket.VertexCount, out var merged)) {
                        failed = true;
                        break;
                    }
                    built.Add(new OpeningPalette.CompactedPart(merged, bucket.Material, bucket.Shadow, matLabel));
                }
                if (failed) {
                    for (int b = 0; b < built.Count; b++) SafeDestroy(built[b].Mesh);
                    paint.StoreCompactedSubtree(prefab, tag, Array.Empty<OpeningPalette.CompactedPart>());
                    return;
                }
                cachedParts = built.ToArray();
                for (int b = 0; b < cachedParts.Length; b++) paint.Own(cachedParts[b].Mesh);
                paint.StoreCompactedSubtree(prefab, tag, cachedParts);
            }

            if (cachedParts == null || cachedParts.Length == 0) return;

            var detachRoots = new HashSet<Transform>();
            for (int i = 0; i < eligible.Count; i++) {
                var item = eligible[i];
                var cur = item.Filter.transform;
                if (protectedNodes.Contains(cur)) {
                    item.Renderer.enabled = false;
                    item.Filter.sharedMesh = null;
                    SafeDestroy(item.Renderer);
                    SafeDestroy(item.Filter);
                    continue;
                }
                while (cur != null && cur.parent != null && !protectedNodes.Contains(cur.parent)) {
                    cur = cur.parent;
                }
                if (cur != null && !protectedNodes.Contains(cur)) detachRoots.Add(cur);
            }
            foreach (var t in detachRoots) {
                if (t == null) continue;
                t.SetParent(null, false);
                t.gameObject.SetActive(false);
                SafeDestroy(t.gameObject);
            }

            for (int p = 0; p < cachedParts.Length; p++) {
                var part = cachedParts[p];
                if (part.Mesh == null || part.Material == null) continue;
                var go = new GameObject("compacted " + part.Label, typeof(MeshFilter), typeof(MeshRenderer));
                go.transform.SetParent(subtreeRoot, false);
                go.GetComponent<MeshFilter>().sharedMesh = part.Mesh;
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = part.Material;
                mr.shadowCastingMode = part.Shadow;
                mr.receiveShadows = true;
            }
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

        /// <summary>
        /// `PieceBuilder.ts` `mats.gateCross`: a `64 × 76` unlit indicator texture with a `#0b0d11`
        /// background and two `lineWidth = 9` butt-capped `#ff4545` strokes `(15, 19) -> (49, 57)`
        /// and `(49, 19) -> (15, 57)`. Symmetric in both X and Y around `(32, 38)`.
        /// </summary>
        public static Texture2D BuildGateCrossTexture() {
            const int width = 64;
            const int height = 76;
            const float halfWidth = 4.5f;
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false, false) {
                name = "gateCross",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            var bg = new Color(11f / 255f, 13f / 255f, 17f / 255f, 1f);
            var fg = new Color(1f, 69f / 255f, 69f / 255f, 1f);
            var a1 = new Vector2(15f, 19f);
            var b1 = new Vector2(49f, 57f);
            var a2 = new Vector2(49f, 19f);
            var b2 = new Vector2(15f, 57f);
            var pixels = new Color32[width * height];
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    var p = new Vector2(x + .5f, y + .5f);
                    float coverage = Mathf.Max(
                        ButtStrokeCoverage(p, a1, b1, halfWidth),
                        ButtStrokeCoverage(p, a2, b2, halfWidth));
                    pixels[y * width + x] = (Color32)Color.Lerp(bg, fg, coverage);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            return texture;
        }

        static float ButtStrokeCoverage(Vector2 p, Vector2 a, Vector2 b, float halfWidth) {
            var ab = b - a;
            float len = ab.magnitude;
            if (len < 1e-5f) return 0f;
            var u = ab / len;
            var n = new Vector2(-u.y, u.x);
            var d = p - a;
            float along = Vector2.Dot(d, u);
            float perp = Mathf.Abs(Vector2.Dot(d, n));
            float dx = Mathf.Max(-along, along - len);
            float dy = perp - halfWidth;
            float dist = dx > 0f && dy > 0f ? Mathf.Sqrt(dx * dx + dy * dy) : Mathf.Max(dx, dy);
            return Mathf.Clamp01(.5f - dist);
        }
    }

    /// <summary>
    /// Fallback owner for `gateCross` indicator material/texture when `OpeningModuleViews.Build`
    /// is invoked without an <see cref="OpeningPalette"/> (for example in standalone view probes).
    /// </summary>
    internal sealed class GateIndicatorMaterialOwner : MonoBehaviour {
        Texture2D crossTexture;
        Material crossMaterial;

        public static Material For(GameObject target, Material template) {
            if (!target) return null;
            var owner = target.GetComponent<GateIndicatorMaterialOwner>();
            if (!owner) owner = target.AddComponent<GateIndicatorMaterialOwner>();
            if (owner.crossMaterial) return owner.crossMaterial;
            owner.crossTexture = OpeningModuleViews.BuildGateCrossTexture();
            if (template != null) {
                owner.crossMaterial = new Material(template) {
                    name = "gateCross",
                    renderQueue = template.renderQueue,
                };
            } else {
                var shader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Texture");
                if (shader == null) return null;
                owner.crossMaterial = new Material(shader) { name = "gateCross" };
            }
            StationSignMaterials.ApplyTexture(owner.crossMaterial, owner.crossTexture);
            return owner.crossMaterial;
        }

        void OnDestroy() {
            OpeningModuleViews.SafeDestroy(crossMaterial);
            crossMaterial = null;
            OpeningModuleViews.SafeDestroy(crossTexture);
            crossTexture = null;
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
        public const int YellowLine = 8;
        public const int Count = 9;

        public static readonly Color[] Values = {
            new Color(.92f, .92f, .9f),          // white fascia
            new Color(.08f, .08f, .09f),         // black frame
            new Color(.72f, .74f, .77f),         // steel
            new Color(.62f, .72f, .76f, .30f),   // fixed glass
            new Color(.48f, .58f, .62f, .34f),   // moving glass
            new Color(.78f, .12f, .10f),         // gate red / threshold
            new Color(.55f, .57f, .60f),         // concrete foundation
            new Color(.78f, .02f, .25f),         // line colour band
            new Color(1f, .773f, .180f),         // platform yellow safety line (#ffc52e)
        };

        /// <summary>The stable name of one palette slot, for a part's material note or a test.</summary>
        public static string Name(int colour) {
            switch (colour) {
                case White: return "white";
                case Black: return "black";
                case Steel: return "steel";
                case Glass: return "glass";
                case MovingGlass: return "moving-glass";
                case Red: return "red";
                case Concrete: return "concrete";
                case Line: return "line";
                case YellowLine: return "yellow-line";
                default: return "slot-" + colour.ToString(CultureInfo.InvariantCulture);
            }
        }
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
        /// <summary>
        /// `PsdModel` draws its foundation with the station finish `floor.concrete`
        /// (`finishSlab(g, ctx.finish('floor.concrete'), …)`), not with a flat colour, so the
        /// host may hand that material in. The palette never owns it.
        /// </summary>
        public const string FoundationFinishId = "floor.concrete";

        public readonly struct CompactedPart {
            public readonly Mesh Mesh;
            public readonly Material Material;
            public readonly ShadowCastingMode Shadow;
            public readonly string Label;

            public CompactedPart(Mesh mesh, Material material, ShadowCastingMode shadow, string label) {
                Mesh = mesh;
                Material = material;
                Shadow = shadow;
                Label = label ?? "";
            }
        }

        readonly struct CompactedKey : IEquatable<CompactedKey> {
            public readonly GameObject Prefab;
            public readonly string Tag;

            public CompactedKey(GameObject prefab, string tag) {
                Prefab = prefab;
                Tag = tag ?? "";
            }

            public bool Equals(CompactedKey other) =>
                ReferenceEquals(Prefab, other.Prefab) && string.Equals(Tag, other.Tag, StringComparison.Ordinal);

            public override bool Equals(object obj) => obj is CompactedKey other && Equals(other);

            public override int GetHashCode() {
                unchecked {
                    int h = Prefab != null ? System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(Prefab) : 0;
                    return (h * 397) ^ StringComparer.Ordinal.GetHashCode(Tag);
                }
            }
        }

        readonly Material[] materials;
        readonly List<Mesh> meshes = new List<Mesh>();
        readonly Dictionary<Shader, Material> gateCrossByShader = new Dictionary<Shader, Material>();
        readonly Dictionary<CompactedKey, CompactedPart[]> compactedSubtrees = new Dictionary<CompactedKey, CompactedPart[]>();
        Material gateCrossDefault;
        Texture2D gateCrossTexture;
        readonly bool ownsMaterials;
        bool released;

        public OpeningPalette(Shader shader) : this(shader, null, "") { }

        /// <summary>
        /// `foundation` is the resolved `floor.concrete` material (the palette does not own
        /// it) and `foundationFinish` its finish id. Passing neither leaves the flat
        /// `OpeningColour.Concrete` slot, which <see cref="FoundationFinish"/> reports as empty
        /// so a caller cannot mistake a stand-in for the source finish (RCA 15 §5).
        /// </summary>
        public OpeningPalette(Shader shader, Material foundation, string foundationFinish) {
            materials = new Material[OpeningColour.Count];
            Foundation = foundation;
            FoundationFinish = foundation ? (foundationFinish ?? "") : "";
            if (shader == null) {
                if (foundation) materials[OpeningColour.Concrete] = foundation;
                return;
            }
            ownsMaterials = true;
            for (int i = 0; i < materials.Length; i++) {
                materials[i] = new Material(shader) { name = "opening-" + i, color = OpeningColour.Values[i] };
            }
            // PSD panes carry their own alpha in `OpeningColour.Values` (.30 fixed, .34
            // moving); a Lit material would discard it, so both get the transparent surface.
            StationGlass.MakeTransparent(materials[OpeningColour.Glass], OpeningColour.Values[OpeningColour.Glass].a);
            StationGlass.MakeTransparent(materials[OpeningColour.MovingGlass], OpeningColour.Values[OpeningColour.MovingGlass].a);
            if (foundation) {
                // The finish material replaces the flat slot; it is the host's, so Release
                // must not destroy it. `ownsMaterials` stays true for the other seven.
                OpeningModuleViews.SafeDestroy(materials[OpeningColour.Concrete]);
                materials[OpeningColour.Concrete] = foundation;
            }
        }

        /// <summary>The resolved `floor.concrete` material, or null when only the flat slot exists.</summary>
        public Material Foundation { get; }

        /// <summary>The finish id behind <see cref="Foundation"/>: empty means the flat palette slot.</summary>
        public string FoundationFinish { get; }

        /// <summary>How many combined meshes the palette currently owns (a report/test figure).</summary>
        public int MeshCount => meshes.Count;

        public Material this[int colour] => materials != null && colour >= 0 && colour < materials.Length
            ? materials[colour] : null;

        public bool HasMaterials => ownsMaterials && materials != null && materials[0] != null;

        internal static OpeningPalette CreatePreview(Material ghostMaterial) {
            var palette = new OpeningPalette(null, null, "");
            if (ghostMaterial != null) {
                for (int i = 0; i < palette.materials.Length; i++) palette.materials[i] = ghostMaterial;
            }
            return palette;
        }

        internal void DrainMeshes(List<Mesh> target) {
            if (target != null && meshes.Count > 0) target.AddRange(meshes);
            meshes.Clear();
        }

        /// <summary>Hand one combined mesh to the palette, so it dies with the world.</summary>
        public void Own(Mesh mesh) { if (mesh) meshes.Add(mesh); }

        internal bool TryGetCompactedSubtree(GameObject prefab, string tag, out CompactedPart[] parts) {
            if (released || prefab == null) {
                parts = null;
                return false;
            }
            return compactedSubtrees.TryGetValue(new CompactedKey(prefab, tag), out parts);
        }

        internal void StoreCompactedSubtree(GameObject prefab, string tag, CompactedPart[] parts) {
            if (released || prefab == null) return;
            compactedSubtrees[new CompactedKey(prefab, tag)] = parts ?? Array.Empty<CompactedPart>();
        }

        /// <summary>
        /// Shared `gateCross` indicator material (`PieceBuilder.ts` `mats.gateCross`) matching
        /// the prefab indicator's unlit shader so doorless (`door: "fence"` / `"none"`) and
        /// disallowed one-way gate faces show a red `X` instead of the green entry arrow.
        /// </summary>
        public Material GateCrossMaterial(Material template) {
            if (released) return null;
            if (!ownsMaterials && materials != null && materials[0] != null) return materials[0];
            if (!gateCrossTexture) gateCrossTexture = OpeningModuleViews.BuildGateCrossTexture();
            if (template != null && template.shader != null) {
                if (gateCrossByShader.TryGetValue(template.shader, out var cached) && cached) return cached;
                var clone = new Material(template) {
                    name = "gateCross",
                    renderQueue = template.renderQueue,
                };
                StationSignMaterials.ApplyTexture(clone, gateCrossTexture);
                gateCrossByShader[template.shader] = clone;
                return clone;
            }
            if (!gateCrossDefault) {
                var fallbackShader = Shader.Find("Universal Render Pipeline/Unlit") ?? Shader.Find("Unlit/Texture");
                if (fallbackShader == null) return null;
                gateCrossDefault = new Material(fallbackShader) { name = "gateCross" };
                StationSignMaterials.ApplyTexture(gateCrossDefault, gateCrossTexture);
            }
            return gateCrossDefault;
        }

        public void Release() {
            if (released) return;
            released = true;
            compactedSubtrees.Clear();
            foreach (var mesh in meshes) OpeningModuleViews.SafeDestroy(mesh);
            meshes.Clear();
            foreach (var cross in gateCrossByShader.Values) OpeningModuleViews.SafeDestroy(cross);
            gateCrossByShader.Clear();
            OpeningModuleViews.SafeDestroy(gateCrossDefault);
            gateCrossDefault = null;
            OpeningModuleViews.SafeDestroy(gateCrossTexture);
            gateCrossTexture = null;
            if (!ownsMaterials) return;
            foreach (var material in materials) {
                if (!material) continue;
                // The host owns a handed-in foundation material.
                if (Foundation && material == Foundation) continue;
                OpeningModuleViews.SafeDestroy(material);
            }
        }
    }

    /// <summary>
    /// Boxes a generated opening view and combines them per material, plus one owned
    /// transform per moving fitting. Coordinates are the holder's local document axes
    /// (`x` plan x, `y` up, `z` plan y); callers pass source-local points through
    /// <see cref="OpeningModuleViews.Local"/>.
    /// </summary>
    public sealed class OpeningBuilder {
        /// <summary>One named part's boxes, per palette slot, and what it emitted.</summary>
        sealed class Batch {
            public string Name = "";
            public OpeningPartRole Role;
            public readonly Dictionary<int, List<CombineInstance>> Boxes = new Dictionary<int, List<CombineInstance>>();
            public GameObject First;
        }

        readonly Transform root;
        readonly OpeningPalette palette;
        readonly List<Batch> order = new List<Batch>();
        readonly List<Mesh> owned = new List<Mesh>();
        Batch current;

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

        /// <summary>
        /// Rewrite (or drop) every accumulated box before anything is combined. Each box is
        /// offered to <paramref name="rule"/> with its part name, role, holder-local centre and
        /// size; the rule returns the boxes that replace it (an empty list drops it). This is
        /// how the fixed return is trimmed at its parent screen (`18 §3`): the geometry is
        /// adjusted as data, so the same numbers can be asserted without reading a mesh.
        /// </summary>
        public void Trim(Func<string, OpeningPartRole, Vector3, Vector3,
            List<(Vector3 centre, Vector3 size)>> rule) {
            if (rule == null) return;
            foreach (var batch in order) {
                foreach (var pair in batch.Boxes) {
                    if (pair.Value.Count == 0) continue;
                    var kept = new List<CombineInstance>(pair.Value.Count);
                    for (int i = 0; i < pair.Value.Count; i++) {
                        var instance = pair.Value[i];
                        var centre = new Vector3(instance.transform.m03, instance.transform.m13, instance.transform.m23);
                        var size = new Vector3(instance.transform.m00, instance.transform.m11, instance.transform.m22);
                        var replacements = rule(batch.Name, batch.Role, centre, size);
                        if (replacements == null) continue;
                        for (int r = 0; r < replacements.Count; r++) {
                            var (newCentre, newSize) = replacements[r];
                            if (newSize.x <= 1e-6f || newSize.y <= 1e-6f || newSize.z <= 1e-6f) continue;
                            kept.Add(new CombineInstance {
                                mesh = instance.mesh,
                                transform = Matrix4x4.TRS(newCentre, Quaternion.identity, newSize),
                            });
                        }
                    }
                    pair.Value.Clear();
                    pair.Value.AddRange(kept);
                }
            }
        }

        /// <summary>Accumulate one box into its part's batch for one material.</summary>
        public void Box(int colour, Vector3 centre, Vector3 size) {
            var batch = Current();
            if (!batch.Boxes.TryGetValue(colour, out var parts)) batch.Boxes.Add(colour, parts = new List<CombineInstance>());
            parts.Add(new CombineInstance {
                mesh = UnitCube,
                transform = Matrix4x4.TRS(centre, Quaternion.identity, size),
            });
        }

        /// <summary>
        /// Start a named part (RCA 15 §5). Every box after this call belongs to it, so a part
        /// can be found by identity and its bounds measured instead of being one anonymous
        /// colour band among several.
        /// </summary>
        public void Part(string name, OpeningPartRole role = OpeningPartRole.Other) {
            current = new Batch { Name = name ?? "", Role = role };
            order.Add(current);
        }

        Batch Current() {
            if (current != null) return current;
            // No part was declared: keep the original one-band-per-colour assembly.
            current = new Batch { Name = "", Role = OpeningPartRole.Other };
            order.Add(current);
            return current;
        }

        /// <summary>One combined mesh per material, per named part, under this builder's root.</summary>
        public void Finish(string name) => Finish(name, null);

        static bool IsTransparentColour(int colour) =>
            colour == OpeningColour.Glass || colour == OpeningColour.MovingGlass;

        sealed class OpaqueColourBucket {
            public int Colour;
            public readonly List<CombineInstance> Instances = new List<CombineInstance>();
            public readonly List<Batch> Batches = new List<Batch>();
            public GameObject Emitted;
        }

        /// <summary>
        /// One combined mesh per opaque material across all named parts (keeping transparent glass
        /// parts separate), while recording every emitted part on `view` with its exact individual
        /// **measured** bounds in the holder's frame and in document axes (RCA 15 §5).
        /// </summary>
        public void Finish(string name, OpeningView view) {
            if (!root) return;
            var opaqueByColour = new Dictionary<int, OpaqueColourBucket>();
            var opaqueOrder = new List<OpaqueColourBucket>();
            var batchBounds = new Bounds[order.Count];
            var batchHasBounds = new bool[order.Count];
            var batchFirstColour = new int[order.Count];
            var batchTransparentFirst = new GameObject[order.Count];

            for (int b = 0; b < order.Count; b++) {
                var batch = order[b];
                batchFirstColour[b] = -1;
                if (batch.Boxes.Count == 0) continue;
                bool glassBatch = batch.Role == OpeningPartRole.Glass ||
                    (batch.Name ?? "").IndexOf("glass", StringComparison.OrdinalIgnoreCase) >= 0;

                foreach (var entry in batch.Boxes) {
                    var list = entry.Value;
                    if (list == null || list.Count == 0) continue;
                    int colour = entry.Key;
                    if (batchFirstColour[b] < 0) batchFirstColour[b] = colour;

                    for (int i = 0; i < list.Count; i++) {
                        var instance = list[i];
                        var centre = new Vector3(instance.transform.m03, instance.transform.m13, instance.transform.m23);
                        var size = new Vector3(instance.transform.m00, instance.transform.m11, instance.transform.m22);
                        var min = centre - size * .5f;
                        var max = centre + size * .5f;
                        if (view != null) {
                            view.boxes.Add(new OpeningBox {
                                Part = batch.Name ?? "", Role = batch.Role, Glass = glassBatch,
                                Min = min, Max = max,
                            });
                        }
                        if (!batchHasBounds[b]) {
                            batchBounds[b] = new Bounds(centre, size);
                            batchHasBounds[b] = true;
                        } else {
                            batchBounds[b].Encapsulate(min);
                            batchBounds[b].Encapsulate(max);
                        }
                    }

                    if (IsTransparentColour(colour)) {
                        var partGo = EmitCombinedMesh(
                            (batch.Name.Length > 0 ? batch.Name : name) + " " + colour,
                            root,
                            colour,
                            list);
                        if (batchTransparentFirst[b] == null) batchTransparentFirst[b] = partGo;
                        if (batch.First == null) batch.First = partGo;
                    } else {
                        if (!opaqueByColour.TryGetValue(colour, out var bucket)) {
                            bucket = new OpaqueColourBucket { Colour = colour };
                            opaqueByColour[colour] = bucket;
                            opaqueOrder.Add(bucket);
                        }
                        bucket.Instances.AddRange(list);
                        if (!bucket.Batches.Contains(batch)) bucket.Batches.Add(batch);
                    }
                }
            }

            for (int c = 0; c < opaqueOrder.Count; c++) {
                var bucket = opaqueOrder[c];
                if (bucket.Instances.Count == 0) continue;
                string goName;
                if (bucket.Batches.Count == 1 && bucket.Batches[0].Name.Length > 0) {
                    goName = bucket.Batches[0].Name + " " + bucket.Colour;
                } else {
                    goName = (string.IsNullOrEmpty(name) ? "opening" : name) + " " + OpeningColour.Name(bucket.Colour);
                }
                bucket.Emitted = EmitCombinedMesh(goName, root, bucket.Colour, bucket.Instances);
                for (int i = 0; i < bucket.Batches.Count; i++) {
                    if (bucket.Batches[i].First == null) bucket.Batches[i].First = bucket.Emitted;
                }
            }

            if (view != null) {
                float datum = StationCoordinates.WorldToDocument(root.position).z;
                for (int b = 0; b < order.Count; b++) {
                    var batch = order[b];
                    if (batch.Boxes.Count == 0) continue;
                    int firstColour = batchFirstColour[b] >= 0 ? batchFirstColour[b] : FirstColour(batch);
                    GameObject nodeGo = batch.First != null ? batch.First : batchTransparentFirst[b];
                    string partName = batch.Name.Length > 0 ? batch.Name : (nodeGo != null ? nodeGo.name : name);
                    var part = new OpeningPart {
                        Name = partName ?? "",
                        Role = batch.Role,
                        Node = nodeGo != null ? nodeGo.transform : null,
                        Material = firstColour == OpeningColour.Concrete && palette != null && palette.FoundationFinish.Length > 0
                            ? palette.FoundationFinish
                            : (firstColour >= 0 ? OpeningColour.Name(firstColour) : ""),
                        Datum = datum,
                    };
                    if (batchHasBounds[b]) {
                        var local = batchBounds[b];
                        part.Local = local;
                        var document = default(Bounds);
                        for (int corner = 0; corner < 8; corner++) {
                            var point = new Vector3(
                                (corner & 1) == 0 ? local.min.x : local.max.x,
                                (corner & 2) == 0 ? local.min.y : local.max.y,
                                (corner & 4) == 0 ? local.min.z : local.max.z);
                            var inDocument = StationCoordinates.WorldToDocument(root.TransformPoint(point));
                            if (corner == 0) document = new Bounds(inDocument, Vector3.zero);
                            else document.Encapsulate(inDocument);
                        }
                        part.Document = document;
                    }
                    view.parts.Add(part);
                }
            }

            order.Clear();
            current = null;
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

        GameObject EmitCombinedMesh(string goName, Transform parent, int colour, List<CombineInstance> instances) {
            var mesh = new Mesh {
                name = goName,
                indexFormat = instances.Count * 24 > 65534 ? IndexFormat.UInt32 : IndexFormat.UInt16,
            };
            // `useMatrices` must stay true: every instance carries its own TRS.
            mesh.CombineMeshes(instances.ToArray(), true, true);
            mesh.RecalculateBounds();
            owned.Add(mesh);
            var part = new GameObject(goName, typeof(MeshFilter), typeof(MeshRenderer));
            part.transform.SetParent(parent, false);
            part.GetComponent<MeshFilter>().sharedMesh = mesh;
            var material = palette != null ? palette[colour] : null;
            var renderer = part.GetComponent<MeshRenderer>();
            if (material != null) renderer.sharedMaterial = material;
            else renderer.enabled = false;
            return part;
        }

        static int FirstColour(Batch batch) {
            foreach (var pair in batch.Boxes) return pair.Key;
            return -1;
        }

        /// <summary>A named child node, for a fitting whose transform the state drives.</summary>
        public Transform Node(string name, Vector3 localPosition) => Node(root, name, localPosition);

        /// <summary>The same under an explicit parent (the header band's own root, say).</summary>
        public static Transform Node(Transform parent, string name, Vector3 localPosition) {
            if (!parent) return null;
            var node = new GameObject(name).transform;
            node.SetParent(parent, false);
            node.localPosition = localPosition;
            node.localRotation = Quaternion.identity;
            return node;
        }
    }

    /// <summary>
    /// The `openings` station renderer: it builds every opening module into the staged
    /// world and publishes one <see cref="OpeningModuleSet"/> keyed by module ID.
    /// </summary>
    public sealed class OpeningModuleRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "openings";

        static bool IsLocalOpeningType(string type) =>
            string.Equals(type, "gate", StringComparison.Ordinal) ||
            string.Equals(type, "door", StringComparison.Ordinal) ||
            string.Equals(type, "cubicle", StringComparison.Ordinal) ||
            string.Equals(type, "psd-end", StringComparison.Ordinal) ||
            string.Equals(type, "platform-edge", StringComparison.Ordinal);

        static bool IsFenceConnectionType(string type) =>
            string.Equals(type, "fence", StringComparison.Ordinal) ||
            string.Equals(type, "gate", StringComparison.Ordinal);

        sealed class StagedOpeningDelta : IStationLocalRendererStage {
            readonly OpeningModuleRenderer owner;
            readonly WorldState state;
            readonly HashSet<string> retiredIds;
            readonly List<(StationModuleRecord Module, OpeningView View)> stagedViews;
            readonly List<CoverChunkKey> dirtyCoverChunks;
            readonly Dictionary<CoverChunkKey, StationInstancedPrefabChunk> stagedCoverChunks;
            readonly Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>> stagedCoverChunkItems;
            readonly HashSet<string> removedOrMovedCoverIds;
            readonly bool rebuildHeaders;
            bool committed;

            public StagedOpeningDelta(
                OpeningModuleRenderer owner,
                WorldState state,
                HashSet<string> retiredIds,
                List<(StationModuleRecord Module, OpeningView View)> stagedViews,
                List<CoverChunkKey> dirtyCoverChunks,
                Dictionary<CoverChunkKey, StationInstancedPrefabChunk> stagedCoverChunks,
                Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>> stagedCoverChunkItems,
                HashSet<string> removedOrMovedCoverIds,
                bool rebuildHeaders) {
                this.owner = owner;
                this.state = state;
                this.retiredIds = retiredIds;
                this.stagedViews = stagedViews;
                this.dirtyCoverChunks = dirtyCoverChunks;
                this.stagedCoverChunks = stagedCoverChunks;
                this.stagedCoverChunkItems = stagedCoverChunkItems;
                this.removedOrMovedCoverIds = removedOrMovedCoverIds;
                this.rebuildHeaders = rebuildHeaders;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIds != null && retiredIds.Count > 0) {
                    world.RetireRecordsWhere(r => r.Role == RoleName && retiredIds.Contains(r.ModuleId),
                        commit, retireViewObjects: true);
                    foreach (var id in retiredIds) {
                        if (state.Set.TryGet(id, out var oldView)) {
                            state.Set.Remove(id);
                            if (oldView?.Holder != null) {
                                commit.RetiredViews.Add(oldView.Holder.gameObject);
                            }
                        }
                    }
                }

                var roleRoot = world.RoleRoot(RoleName);

                if (removedOrMovedCoverIds != null && removedOrMovedCoverIds.Count > 0) {
                    foreach (var id in removedOrMovedCoverIds) {
                        state.Set.Remove(id);
                        state.ModuleToCoverChunk.Remove(id);
                    }
                }

                if (dirtyCoverChunks != null && dirtyCoverChunks.Count > 0) {
                    for (int i = 0; i < dirtyCoverChunks.Count; i++) {
                        var ck = dirtyCoverChunks[i];
                        if (state.CoverChunksByKey.TryGetValue(ck, out var oldChunk)) {
                            foreach (var id in oldChunk.ModuleIds) state.ModuleToCoverChunk.Remove(id);
                            oldChunk.RetireFrom(world, state.Drawer, commit);
                            state.CoverChunksByKey.Remove(ck);
                        }
                        state.CoverChunkItems.Remove(ck);

                        if (stagedCoverChunks != null &&
                            stagedCoverChunks.TryGetValue(ck, out var newChunk) &&
                            newChunk.Views.Count > 0) {
                            for (int v = 0; v < newChunk.Views.Count; v++) {
                                var viewGo = newChunk.Views[v];
                                if (viewGo != null && roleRoot != null) viewGo.transform.SetParent(roleRoot, false);
                            }
#if !UNITY_WEBGL
                            if (Application.isPlaying && !Application.isEditor) {
                                for (int v = 0; v < newChunk.Views.Count; v++) {
                                    var viewGo = newChunk.Views[v];
                                    if (viewGo == null) continue;
                                    var renderers = viewGo.GetComponentsInChildren<Renderer>(true);
                                    for (int r = 0; r < renderers.Length; r++) {
                                        if (renderers[r] != null) renderers[r].shadowCastingMode = ShadowCastingMode.Off;
                                    }
                                }
                                for (int b = 0; b < newChunk.Batches.Count; b++) {
                                    if (newChunk.Batches[b] != null) newChunk.Batches[b].ShadowCasting = ShadowCastingMode.Off;
                                }
                            }
#endif
                            if (state.Drawer != null) {
                                for (int b = 0; b < newChunk.Batches.Count; b++) state.Drawer.Add(newChunk.Batches[b]);
                            }
                            for (int r = 0; r < newChunk.Records.Count; r++) {
                                world.AddLocalRecord(newChunk.Records[r], commit);
                            }
                            foreach (var id in newChunk.ModuleIds) state.ModuleToCoverChunk[id] = ck;
                            state.CoverChunksByKey[ck] = newChunk;

                            if (stagedCoverChunkItems != null && stagedCoverChunkItems.TryGetValue(ck, out var nextMap)) {
                                state.CoverChunkItems[ck] = nextMap;
                                var proxyGo = newChunk.Views[0];
                                var proxyTransform = proxyGo != null ? proxyGo.transform : null;
                                foreach (var kv in nextMap) {
                                    var view = kv.Value.View;
                                    if (view == null) continue;
                                    view.Instance = proxyGo;
                                    if (view.parts.Count > 0) view.parts[0].Node = proxyTransform;
                                    state.Set.Add(view);
                                }
                            }
                        }
                    }
                }

                if (stagedViews != null && stagedViews.Count > 0) {
                    for (int i = 0; i < stagedViews.Count; i++) {
                        var (mod, view) = stagedViews[i];
                        if (view?.Holder != null && roleRoot != null) {
                            view.Holder.SetParent(roleRoot, false);
                        } else if (view?.Instance != null && roleRoot != null) {
                            view.Instance.transform.SetParent(roleRoot, false);
                        }
#if !UNITY_WEBGL
                        if (Application.isPlaying && !Application.isEditor) {
                            var shadowRoot = view?.Holder != null ? view.Holder.gameObject : view?.Instance;
                            if (shadowRoot != null) {
                                var renderers = shadowRoot.GetComponentsInChildren<Renderer>(true);
                                for (int r = 0; r < renderers.Length; r++) {
                                    if (renderers[r] != null) renderers[r].shadowCastingMode = ShadowCastingMode.Off;
                                }
                            }
                        }
#endif
                        state.Set.Add(view);
                        if (view?.Instance != null) {
                            world.AddLocalRecord(new StationViewRecord {
                                Role = RoleName,
                                ModuleId = mod.Id,
                                View = view.Instance,
                                LevelMin = mod.Z,
                                LevelMax = mod.Z + 1,
                            }, commit);
                        }
                    }
                }

                if (rebuildHeaders && owner != null && roleRoot != null) {
                    if (state.Headers != null) {
                        PsdHeaderArtwork.ReleaseScope(state.Headers);
                        state.Headers = null;
                    }
                    for (int i = roleRoot.childCount - 1; i >= 0; i--) {
                        var child = roleRoot.GetChild(i);
                        if (child != null && child.name == "psd header pump") OpeningModuleViews.SafeDestroy(child.gameObject);
                    }
                    owner.BuildHeaders(null, state, roleRoot);
                }
            }

            public void Dispose() {
                if (committed) return;
                if (stagedViews != null) {
                    for (int i = 0; i < stagedViews.Count; i++) {
                        var view = stagedViews[i].View;
                        if (view?.Holder != null) OpeningModuleViews.SafeDestroy(view.Holder.gameObject);
                        else if (view?.Instance != null) OpeningModuleViews.SafeDestroy(view.Instance);
                    }
                    stagedViews.Clear();
                }
                if (stagedCoverChunks != null) {
                    foreach (var chunk in stagedCoverChunks.Values) chunk?.DestroyUncommitted();
                    stagedCoverChunks.Clear();
                }
            }
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            if (!states.TryGetValue(context.World, out var state) || state == null) {
                fallbackReason = "no-opening-state";
                return false;
            }

            var delta = context.Delta;
            var retiredIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyIds = new HashSet<string>(StringComparer.Ordinal);
            List<(int X, int Y, int Z)> fenceTouchPoints = null;
            HashSet<string> changedOrRemovedEdgeIds = null;
            HashSet<string> changedOrRemovedTrackIds = null;

            var dirtyCoverChunks = new HashSet<CoverChunkKey>();
            var removedOrMovedCoverIds = new HashSet<string>(StringComparer.Ordinal);
            Dictionary<CoverChunkKey, List<(StationStaticPrefabItem Item, OpeningView View)>> updatedCoverItemsByChunk = null;
            bool rebuildHeaders = false;

            int storeyHeight = Math.Max(1, context.NextDocument.StoreyHeight);
            var grid = StationLevelGrid.FromDocument(context.NextDocument.LevelBase, storeyHeight);

            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (!context.PrevIndex.TryGetModule(id, out var oldMod) || oldMod == null) continue;
                if (IsFenceConnectionType(oldMod.Type)) {
                    (fenceTouchPoints ??= new List<(int, int, int)>()).Add((oldMod.X, oldMod.Y, oldMod.Z));
                }
                if (string.Equals(oldMod.Type, "track", StringComparison.Ordinal)) {
                    (changedOrRemovedTrackIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(id);
                }
                if (string.Equals(oldMod.Type, "platform-edge", StringComparison.Ordinal)) {
                    (changedOrRemovedEdgeIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(id);
                    rebuildHeaders = true;
                }
                if (!OpeningModuleViews.Owns(oldMod.Type)) continue;
                if (!IsLocalOpeningType(oldMod.Type)) {
                    fallbackReason = "local-module-family:" + oldMod.Type;
                    return false;
                }
                if (state.ModuleToCoverChunk.TryGetValue(id, out var oldCk)) {
                    dirtyCoverChunks.Add(oldCk);
                    removedOrMovedCoverIds.Add(id);
                } else {
                    retiredIds.Add(id);
                }
            }

            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod == null) continue;
                if (IsFenceConnectionType(mod.Type)) {
                    (fenceTouchPoints ??= new List<(int, int, int)>()).Add((mod.X, mod.Y, mod.Z));
                    if (context.PrevIndex.TryGetModule(mod.Id, out var prevMod) && prevMod != null) {
                        fenceTouchPoints.Add((prevMod.X, prevMod.Y, prevMod.Z));
                    }
                }
                if (string.Equals(mod.Type, "track", StringComparison.Ordinal)) {
                    (changedOrRemovedTrackIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(mod.Id);
                }
                if (string.Equals(mod.Type, "platform-edge", StringComparison.Ordinal)) {
                    (changedOrRemovedEdgeIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(mod.Id);
                    rebuildHeaders = true;
                }
                if (!OpeningModuleViews.Owns(mod.Type)) continue;
                if (!IsLocalOpeningType(mod.Type)) {
                    fallbackReason = "local-module-family:" + mod.Type;
                    return false;
                }

                bool wasBatchedCover = state.ModuleToCoverChunk.TryGetValue(mod.Id, out var oldCk);
                if (wasBatchedCover) {
                    dirtyCoverChunks.Add(oldCk);
                    removedOrMovedCoverIds.Add(mod.Id);
                }

                if (state.CoverTemplate != null &&
                    state.BatchedCoverBands.Count > 0 &&
                    TryBuildBatchedCoverItem(mod, grid, state.CoverTemplate, state.CoverBakedBounds,
                        state.CoverPrefabPath, out int band, out var coverItem, out var coverView) &&
                    state.BatchedCoverBands.Contains(band)) {
                    var ck = new CoverChunkKey(band, CoverChunkCoord(mod.X), CoverChunkCoord(mod.Y));
                    dirtyCoverChunks.Add(ck);
                    updatedCoverItemsByChunk ??= new Dictionary<CoverChunkKey, List<(StationStaticPrefabItem, OpeningView)>>();
                    if (!updatedCoverItemsByChunk.TryGetValue(ck, out var list)) {
                        updatedCoverItemsByChunk[ck] = list = new List<(StationStaticPrefabItem, OpeningView)>(2);
                    }
                    list.Add((coverItem, coverView));
                    if (!wasBatchedCover && state.Set.TryGet(mod.Id, out _)) {
                        retiredIds.Add(mod.Id);
                    }
                    continue;
                }

                if (!wasBatchedCover) retiredIds.Add(mod.Id);
                dirtyIds.Add(mod.Id);
            }

            // A platform-edge reads its bound track's coordinates & span for doorway alignment.
            if (changedOrRemovedTrackIds != null && changedOrRemovedTrackIds.Count > 0) {
                var edges = context.NextIndex.ModulesOfType("platform-edge");
                for (int i = 0; i < edges.Count; i++) {
                    var edge = edges[i];
                    if (edge == null || dirtyIds.Contains(edge.Id)) continue;
                    string fromTrack = edge.Config.Text("from");
                    if (fromTrack.Length > 0 && changedOrRemovedTrackIds.Contains(fromTrack)) {
                        retiredIds.Add(edge.Id);
                        dirtyIds.Add(edge.Id);
                        (changedOrRemovedEdgeIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(edge.Id);
                        rebuildHeaders = true;
                    }
                }
            }

            // A doorless fare gate's carried fence panel depends on adjacent fence/gate tiles.
            if (fenceTouchPoints != null && fenceTouchPoints.Count > 0) {
                var gates = context.NextIndex.ModulesOfType("gate");
                for (int i = 0; i < gates.Count; i++) {
                    var g = gates[i];
                    if (g == null || dirtyIds.Contains(g.Id)) continue;
                    string door = g.Config.Text("door");
                    if (OpeningModuleViews.GateHasLane(door)) continue;
                    for (int t = 0; t < fenceTouchPoints.Count; t++) {
                        var pt = fenceTouchPoints[t];
                        if (g.Z == pt.Z && Math.Abs(g.X - pt.X) <= 1 && Math.Abs(g.Y - pt.Y) <= 1) {
                            retiredIds.Add(g.Id);
                            dirtyIds.Add(g.Id);
                            break;
                        }
                    }
                }
            }

            if (context.CityChanged || context.NameChanged || context.VisualChangedLineIds.Count > 0) {
                var edges = context.NextIndex.ModulesOfType("platform-edge");
                for (int i = 0; i < edges.Count; i++) {
                    var edge = edges[i];
                    if (edge == null) continue;
                    string lineId = edge.Config.Text("line");
                    if (context.CityChanged || context.NameChanged || context.VisualChangedLineIds.Contains(lineId)) {
                        if (!dirtyIds.Contains(edge.Id)) {
                            retiredIds.Add(edge.Id);
                            dirtyIds.Add(edge.Id);
                        }
                        if (context.LineStructureChanged || context.VisualChangedLineIds.Contains(lineId)) {
                            (changedOrRemovedEdgeIds ??= new HashSet<string>(StringComparer.Ordinal)).Add(edge.Id);
                        }
                        rebuildHeaders = true;
                    }
                }
            }

            // Full-height `psd-end` returns trim against their corner `platform-edge` housing (`cfg.corner`).
            if (changedOrRemovedEdgeIds != null && changedOrRemovedEdgeIds.Count > 0) {
                var psdEnds = context.NextIndex.ModulesOfType("psd-end");
                for (int i = 0; i < psdEnds.Count; i++) {
                    var end = psdEnds[i];
                    if (end == null || dirtyIds.Contains(end.Id)) continue;
                    var cfg = end.Config ?? ModuleConfig.Empty;
                    if (string.Equals(cfg.Text("variant"), "cover", StringComparison.Ordinal)) continue;
                    string corner = cfg.Text("corner");
                    if (corner.Length == 0 || !changedOrRemovedEdgeIds.Contains(corner)) continue;
                    if (!state.ModuleToCoverChunk.ContainsKey(end.Id)) {
                        retiredIds.Add(end.Id);
                    }
                    dirtyIds.Add(end.Id);
                }
            }

            if (retiredIds.Count == 0 && dirtyIds.Count == 0 && dirtyCoverChunks.Count == 0 && !rebuildHeaders) return true;

            var catalogue = context.World.Catalogue;
            if (dirtyIds.Count > 0 && catalogue == null) {
                fallbackReason = "no-catalogue:" + RoleName;
                return false;
            }

            bool needGateStation = false;
            bool needPsdEndStation = false;
            foreach (var id in dirtyIds) {
                if (context.NextIndex.TryGetModule(id, out var m) && m != null) {
                    if (string.Equals(m.Type, "gate", StringComparison.Ordinal)) needGateStation = true;
                    else if (string.Equals(m.Type, "psd-end", StringComparison.Ordinal)) needPsdEndStation = true;
                }
            }
            var gateFacts = needGateStation
                ? context.GetNextFactsOfTypes("gate", "fence")
                : Array.Empty<ModuleFacts>();
            var edgeFacts = needPsdEndStation
                ? context.GetNextFactsOfTypes("platform-edge")
                : Array.Empty<ModuleFacts>();

            var stagedViews = new List<(StationModuleRecord Module, OpeningView View)>(dirtyIds.Count);
            List<CoverChunkKey> dirtyChunkList = dirtyCoverChunks.Count > 0 ? new List<CoverChunkKey>(dirtyCoverChunks) : null;
            Dictionary<CoverChunkKey, StationInstancedPrefabChunk> stagedCoverChunks = null;
            Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>> stagedCoverChunkItems = null;

            try {
                foreach (var id in dirtyIds) {
                    if (!context.NextIndex.TryGetModule(id, out var mod) || mod == null) continue;
                    if (!IsLocalOpeningType(mod.Type)) continue;
                    var request = OpeningModuleViews.RequestFor(mod, context.NextIndex);
                    ModuleFacts[] stationFacts = string.Equals(mod.Type, "psd-end", StringComparison.Ordinal)
                        ? edgeFacts
                        : (string.Equals(mod.Type, "gate", StringComparison.Ordinal) ? gateFacts : Array.Empty<ModuleFacts>());
                    if (OpeningModuleViews.TryBuild(request, mod.Facts, stationFacts, catalogue, context.StagingRoot, state.Palette, out var view)) {
                        if (!string.IsNullOrEmpty(view.PrefabPath)) {
                            StationRigidModelLods.Apply(view.Instance, System.IO.Path.GetFileNameWithoutExtension(view.PrefabPath));
                        }
                        stagedViews.Add((mod, view));
                        StationEditTrace.AddInstantiatedPrefab();
                    } else {
                        context.ReportUnresolved("opening", mod.Type, mod.Id, view.Diagnostic);
                    }
                }

                if (dirtyChunkList != null && state.CoverTemplate != null && state.Templates != null) {
                    stagedCoverChunks = new Dictionary<CoverChunkKey, StationInstancedPrefabChunk>(dirtyChunkList.Count);
                    stagedCoverChunkItems = new Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>>(dirtyChunkList.Count);
                    for (int i = 0; i < dirtyChunkList.Count; i++) {
                        var ck = dirtyChunkList[i];
                        var nextMap = state.CoverChunkItems.TryGetValue(ck, out var existingMap)
                            ? new Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>(existingMap, StringComparer.Ordinal)
                            : new Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>(StringComparer.Ordinal);
                        foreach (var rid in removedOrMovedCoverIds) nextMap.Remove(rid);
                        if (updatedCoverItemsByChunk != null && updatedCoverItemsByChunk.TryGetValue(ck, out var added)) {
                            for (int j = 0; j < added.Count; j++) {
                                var entry = added[j];
                                nextMap[entry.Item.ModuleId] = entry;
                            }
                        }
                        if (nextMap.Count == 0) continue;
                        var itemList = new List<StationStaticPrefabItem>(nextMap.Count);
                        foreach (var kv in nextMap) itemList.Add(kv.Value.Item);
                        var chunk = StationInstancedPrefabChunk.Build(
                            Role,
                            ck.Label(),
                            state.CoverTemplate,
                            state.Templates,
                            context.StagingRoot,
                            itemList,
                            ck.Band,
                            ck.Band,
                            new[] { ck.Band });
                        stagedCoverChunks[ck] = chunk;
                        stagedCoverChunkItems[ck] = nextMap;
                    }
                }

                stage = new StagedOpeningDelta(
                    this, state, retiredIds, stagedViews,
                    dirtyChunkList, stagedCoverChunks, stagedCoverChunkItems, removedOrMovedCoverIds,
                    rebuildHeaders);
                return true;
            } catch {
                for (int i = 0; i < stagedViews.Count; i++) {
                    var view = stagedViews[i].View;
                    if (view?.Holder != null) OpeningModuleViews.SafeDestroy(view.Holder.gameObject);
                    else if (view?.Instance != null) OpeningModuleViews.SafeDestroy(view.Instance);
                }
                if (stagedCoverChunks != null) {
                    foreach (var chunk in stagedCoverChunks.Values) chunk?.DestroyUncommitted();
                }
                throw;
            }
        }

        /// <summary>
        /// One built world's openings. The host stages a candidate world while the live
        /// world is still drawing, then releases the *old* world after the candidate has
        /// built — so one shared set would be cleared out from under the new station
        /// (plan 11 B4's reopen-after-switch report caught exactly that).
        /// </summary>
        public const int DefaultPsdCoverBatchThreshold = 128;
        const int CoverChunkSize = 64;

        /// <summary>
        /// Minimum canonical `psd-end` cover count on one storey band before GPU-instanced chunk
        /// batching activates. Default 128 keeps Zoo's 101/103 per-band covers as 1:1 records while
        /// batching Tanwei's 144 and Tianhe's 1,270 canonical covers into instanced chunks.
        /// </summary>
        public int PsdCoverBatchThreshold = DefaultPsdCoverBatchThreshold;

        static int CoverChunkCoord(int value) => value >= 0 ? value / CoverChunkSize : (value - (CoverChunkSize - 1)) / CoverChunkSize;

        readonly struct CoverChunkKey : IEquatable<CoverChunkKey> {
            public readonly int Band, ChunkX, ChunkY;
            public CoverChunkKey(int band, int chunkX, int chunkY) {
                Band = band; ChunkX = chunkX; ChunkY = chunkY;
            }
            public bool Equals(CoverChunkKey other) => Band == other.Band && ChunkX == other.ChunkX && ChunkY == other.ChunkY;
            public override bool Equals(object obj) => obj is CoverChunkKey other && Equals(other);
            public override int GetHashCode() {
                unchecked {
                    int h = Band;
                    h = (h * 397) ^ ChunkX;
                    h = (h * 397) ^ ChunkY;
                    return h;
                }
            }
            public string Label() => "psd-cover " + Band + " " + ChunkX + "," + ChunkY;
        }

        sealed class WorldState {
            public StationWorldView World;
            public OpeningModuleSet Set;
            public OpeningPalette Palette;
            public StationPrefabTemplateCache Templates;
            public StationInstancedSurfaceDrawer Drawer;
            public readonly Dictionary<CoverChunkKey, StationInstancedPrefabChunk> CoverChunksByKey =
                new Dictionary<CoverChunkKey, StationInstancedPrefabChunk>();
            public readonly Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>> CoverChunkItems =
                new Dictionary<CoverChunkKey, Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>>();
            public readonly Dictionary<string, CoverChunkKey> ModuleToCoverChunk =
                new Dictionary<string, CoverChunkKey>(StringComparer.Ordinal);
            public readonly HashSet<int> BatchedCoverBands = new HashSet<int>();
            public StationPrefabMeshTemplate CoverTemplate;
            public Bounds CoverBakedBounds;
            public string CoverPrefabPath = "";
            /// <summary>
            /// The station finish library this world resolved for the PSD foundation's
            /// `floor.concrete` (`PsdModel` draws it with the station finish, not a palette
            /// colour). Owned here and disposed with the world; null when the export is absent,
            /// in which case every foundation reports the flat-slot fallback.
            /// </summary>
            public StationFinishLibrary Finishes;
            /// <summary>
            /// The world's printed-header connection (RCA 15 §5 sub-item 2): provider,
            /// texture cache and the quads on the header slots. Per world, because the
            /// renderer singleton is reused across the staged candidate and its teardown
            /// must never free the incoming station's artwork.
            /// </summary>
            public PsdHeaderArtworkScope Headers;
            public int Serial;
        }

        readonly Dictionary<StationWorldView, WorldState> states = new Dictionary<StationWorldView, WorldState>();
        WorldState newest;
        int serial;
        /// <summary>The host whose session/revision fences header replies (found lazily).</summary>
        StationGameHost host;

        public string Role => RoleName;

        /// <summary>Every built opening of the active world, keyed by module ID.</summary>
        public OpeningModuleSet Views => newest?.Set ?? new OpeningModuleSet();

        /// <summary>Number of GPU-instanced `psd-end:cover` chunks built for the newest live world.</summary>
        public int BatchedCoverChunkCount => newest?.CoverChunksByKey?.Count ?? 0;

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
                Serial = ++serial,
            };
            // RCA 15 §5: `PsdModel` builds the foundation with `ctx.finish('floor.concrete')`.
            // The palette takes that station finish so the plinth stops reading as a flat
            // opening-palette grey; when the export is missing the palette keeps the flat slot
            // and every view reports `FoundationFinish` empty.
            state.Finishes = StationCellRenderer.AcquireLibrary(context.Shader);
            var foundation = state.Finishes != null ? state.Finishes.For(OpeningPalette.FoundationFinishId) : null;
            state.Palette = new OpeningPalette(context.Shader, foundation,
                state.Finishes != null ? OpeningPalette.FoundationFinishId : "");
            if (context.World != null) states[context.World] = state;
            newest = state;
            if (!state.Palette.HasMaterials)
                context.ReportUnresolved("missing-asset", "renderer", Role, "No station shader; opening materials are unlit.");
            if (state.Finishes == null)
                context.ReportUnresolved("finish-library-missing", "opening", "platform-edge",
                    "The exported finish library is not staged, so the PSD foundation is drawn with the flat opening palette instead of 'floor.concrete'.");
            var roleRoot = context.RoleRoot(Role);

            var batchedCoverIds = TryBuildInstancedCovers(context, records, state, roleRoot);
            if (batchedCoverIds == null || batchedCoverIds.Count == 0) {
                OpeningModuleViews.BuildAll(records, context.Index, context.Catalogue, roleRoot, state.Palette, state.Set,
                    (module, view) => context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1),
                    (module, diagnostic) => context.ReportUnresolved("opening", module.Type, module.Id, diagnostic));
            } else {
                var facts = new ModuleFacts[records.Count];
                for (int i = 0; i < facts.Length; i++) facts[i] = records[i]?.Facts;
                for (int i = 0; i < records.Count; i++) {
                    var module = records[i];
                    if (module == null || !OpeningModuleViews.Owns(module.Type)) continue;
                    if (!string.IsNullOrEmpty(module.Id) && batchedCoverIds.Contains(module.Id)) continue;
                    var request = OpeningModuleViews.RequestFor(module, context.Index);
                    if (!OpeningModuleViews.TryBuild(request, module.Facts, facts, context.Catalogue, roleRoot, state.Palette, out var view)) {
                        context.ReportUnresolved("opening", module.Type, module.Id, view.Diagnostic);
                        continue;
                    }
                    StationRigidModelLods.Apply(view.Instance, System.IO.Path.GetFileNameWithoutExtension(view.PrefabPath));
                    state.Set.Add(view);
                    context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1);
                }
            }
            // RCA 15 §5 sub-item 2: mint the printed band's requests from the slots this
            // build created and bind the browser's pixels onto their posed nodes.
            BuildHeaders(context, state, roleRoot);
        }

        static bool TryBuildBatchedCoverItem(
            StationModuleRecord mod,
            StationLevelGrid grid,
            StationPrefabMeshTemplate coverTemplate,
            Bounds baked,
            string prefabPath,
            out int band,
            out StationStaticPrefabItem item,
            out OpeningView proxyView) {
            band = 0;
            item = default;
            proxyView = null;
            if (mod == null || mod.Facts == null || string.IsNullOrEmpty(mod.Id) || coverTemplate == null) return false;
            if (!string.Equals(mod.Type, "psd-end", StringComparison.Ordinal)) return false;
            var cfg = mod.Config ?? ModuleConfig.Empty;
            if (!string.Equals(cfg.Text("variant"), "cover", StringComparison.Ordinal)) return false;

            band = StationModuleLevels.Band(grid, mod.Z);
            float width = cfg.Has("width") ? (float)cfg.Number("width", 0) : 1f;
            float depth = cfg.Has("depth") ? (float)cfg.Number("depth", 0) : .24f;
            float ox = 0f, oy = 0f;
            if (cfg.TryNumbers("offset", out var off) && off.Length >= 2) {
                ox = (float)off[0];
                oy = (float)off[1];
            }
            float sideY = string.Equals(cfg.Text("side"), "right", StringComparison.Ordinal) ? .34f : -.34f;
            var target = OpeningModuleViews.Local(ox, sideY + oy, .5f);
            var place = target - baked.center;

            bool planMatch = Mathf.Abs(baked.size.x - width) <= .02f && Mathf.Abs(baked.size.z - depth) <= .02f;
            float minY = baked.min.y + place.y;
            float maxY = baked.max.y + place.y;
            bool verticalMatch = Mathf.Abs(minY) <= .02f && Mathf.Abs(maxY - 1f) <= .02f;
            if (!planMatch || !verticalMatch) return false;

            var holderPos = OpeningModuleViews.Pivot(mod.Facts, new Vector3(.5f, .5f, 0f), floorTop: false);
            var holderRot = ModulePlacement.Rotation(mod.Rotation);
            var holderWorld = Matrix4x4.TRS(holderPos, holderRot, Vector3.one);
            var instanceLocal = Matrix4x4.TRS(place, coverTemplate.PrefabLocalRotation, coverTemplate.PrefabLocalScale);
            var worldMatrix = holderWorld * instanceLocal;
            if (!coverTemplate.TryDocumentBounds(worldMatrix, out var docBox)) {
                docBox = new StationBox(mod.X, mod.Y, mod.Z, mod.X + 1, mod.Y + 1, mod.Z + 1);
            }

            item = new StationStaticPrefabItem(mod.Id, worldMatrix, docBox);
            proxyView = new OpeningView {
                Kind = OpeningKind.PsdCover,
                ModuleId = mod.Id,
                Type = mod.Type,
                ViewKey = OpeningModuleViews.PsdCoverPrefabKey,
                PrefabPath = prefabPath ?? "",
                Movable = false,
                OpeningCount = 0,
            };
            var docMin = new Vector3((float)docBox.X0, (float)docBox.Y0, (float)docBox.Z0);
            var docMax = new Vector3((float)docBox.X1, (float)docBox.Y1, (float)docBox.Z1);
            proxyView.parts.Add(new OpeningPart {
                Name = "psd-cover-panel",
                Role = OpeningPartRole.Cover,
                Local = new Bounds(target, baked.size),
                Document = new Bounds((docMin + docMax) * .5f, docMax - docMin),
                Material = OpeningColour.Name(OpeningColour.White),
                PrefabOffset = place,
                Datum = mod.Z,
            });
            return true;
        }

        HashSet<string> TryBuildInstancedCovers(
            StationViewBuildContext context,
            IReadOnlyList<StationModuleRecord> records,
            WorldState state,
            Transform roleRoot) {
            if (!SystemInfo.supportsInstancing || context.Catalogue == null || roleRoot == null) return null;
            int threshold = Math.Max(2, PsdCoverBatchThreshold);
            if (!context.Catalogue.TryGet(OpeningModuleViews.PsdCoverPrefabKey, out var coverEntry) || coverEntry.prefab == null) {
                return null;
            }
            int storeyHeight = Math.Max(1, context.Document.StoreyHeight);
            var grid = StationLevelGrid.FromDocument(context.Document.LevelBase, storeyHeight);

            // First quick pass: count psd-end covers per band before allocating templates.
            var roughBandCounts = new Dictionary<int, int>();
            bool anyBandEligible = false;
            for (int i = 0; i < records.Count; i++) {
                var mod = records[i];
                if (mod == null || !string.Equals(mod.Type, "psd-end", StringComparison.Ordinal)) continue;
                var cfg = mod.Config ?? ModuleConfig.Empty;
                if (!string.Equals(cfg.Text("variant"), "cover", StringComparison.Ordinal)) continue;
                int band = StationModuleLevels.Band(grid, mod.Z);
                roughBandCounts.TryGetValue(band, out int c);
                c++;
                roughBandCounts[band] = c;
                if (c >= threshold) anyBandEligible = true;
            }
            if (!anyBandEligible) return null;

            state.Templates ??= new StationPrefabTemplateCache();
            if (!state.Templates.TryGetTemplate(coverEntry.prefab, out var coverTemplate) || !coverTemplate.HasBounds) {
                return null;
            }

            var prefabLocal = Matrix4x4.TRS(Vector3.zero, coverTemplate.PrefabLocalRotation, coverTemplate.PrefabLocalScale);
            var baked = StationPrefabMeshTemplate.TransformBounds(coverTemplate.LocalBounds, prefabLocal);
            string coverPrefabPath = coverEntry.prefabPath ?? "";

            var candidates = new List<(StationModuleRecord Module, int Band, StationStaticPrefabItem Item, OpeningView View)>();
            var exactBandCounts = new Dictionary<int, int>();

            for (int i = 0; i < records.Count; i++) {
                var mod = records[i];
                if (mod == null || mod.Facts == null || string.IsNullOrEmpty(mod.Id)) continue;
                if (!string.Equals(mod.Type, "psd-end", StringComparison.Ordinal)) continue;
                var cfg = mod.Config ?? ModuleConfig.Empty;
                if (!string.Equals(cfg.Text("variant"), "cover", StringComparison.Ordinal)) continue;
                int roughBand = StationModuleLevels.Band(grid, mod.Z);
                if (!roughBandCounts.TryGetValue(roughBand, out int rough) || rough < threshold) continue;

                if (!TryBuildBatchedCoverItem(mod, grid, coverTemplate, baked, coverPrefabPath,
                        out int band, out var item, out var proxyView)) {
                    continue;
                }

                candidates.Add((mod, band, item, proxyView));
                exactBandCounts.TryGetValue(band, out int ec);
                exactBandCounts[band] = ec + 1;
            }

            var eligibleBands = new HashSet<int>();
            foreach (var kv in exactBandCounts) {
                if (kv.Value >= threshold) eligibleBands.Add(kv.Key);
            }
            if (eligibleBands.Count == 0) return null;

            state.CoverTemplate = coverTemplate;
            state.CoverBakedBounds = baked;
            state.CoverPrefabPath = coverPrefabPath;
            foreach (var b in eligibleBands) state.BatchedCoverBands.Add(b);

            state.Drawer = StationInstancedSurfaceDrawer.EnsureFor(context.Root);
            var batchedIds = new HashSet<string>(StringComparer.Ordinal);
            var byChunk = new Dictionary<CoverChunkKey, (List<StationStaticPrefabItem> Items, List<OpeningView> Views)>();

            for (int i = 0; i < candidates.Count; i++) {
                var c = candidates[i];
                if (!eligibleBands.Contains(c.Band)) continue;
                var ck = new CoverChunkKey(c.Band, CoverChunkCoord(c.Module.X), CoverChunkCoord(c.Module.Y));
                if (!byChunk.TryGetValue(ck, out var entry)) {
                    entry = (new List<StationStaticPrefabItem>(), new List<OpeningView>());
                    byChunk[ck] = entry;
                }
                entry.Items.Add(c.Item);
                entry.Views.Add(c.View);
                batchedIds.Add(c.Module.Id);
            }

            foreach (var kv in byChunk) {
                var ck = kv.Key;
                var chunk = StationInstancedPrefabChunk.Build(
                    Role,
                    ck.Label(),
                    coverTemplate,
                    state.Templates,
                    roleRoot,
                    kv.Value.Items,
                    ck.Band,
                    ck.Band,
                    new[] { ck.Band });
                chunk.RegisterInto(context.World, state.Drawer);
                state.CoverChunksByKey[ck] = chunk;

                var proxyGo = chunk.Views.Count > 0 ? chunk.Views[0] : null;
                var proxyTransform = proxyGo != null ? proxyGo.transform : null;
                var itemsList = kv.Value.Items;
                var viewsList = kv.Value.Views;
                var chunkMap = new Dictionary<string, (StationStaticPrefabItem Item, OpeningView View)>(itemsList.Count, StringComparer.Ordinal);
                for (int m = 0; m < itemsList.Count; m++) {
                    var item = itemsList[m];
                    var view = viewsList[m];
                    view.Instance = proxyGo;
                    if (view.parts.Count > 0) view.parts[0].Node = proxyTransform;
                    state.Set.Add(view);
                    chunkMap[item.ModuleId] = (item, view);
                    state.ModuleToCoverChunk[item.ModuleId] = ck;
                }
                state.CoverChunkItems[ck] = chunkMap;
            }

            return batchedIds;
        }

        /// <summary>
        /// The printed PSD headers of one world. The slots were already emitted by
        /// <see cref="OpeningModuleViews.BuildRun"/>; this creates the world's painter
        /// connection, binds one quad per slot (`slot.Width × slot.Height`, at the node the
        /// geometry half posed toward the platform) and asks the browser for the panels the
        /// slots' keys name. Every slot ends with either pixels or a named diagnostic.
        /// </summary>
        void BuildHeaders(StationViewBuildContext context, WorldState state, Transform roleRoot) {
            var views = new List<OpeningView>();
            foreach (var view in state.Set.Views) if (view.Headers.Count > 0) views.Add(view);
            if (views.Count == 0) return;
            var template = state.Palette != null ? state.Palette[OpeningColour.White] : null;
            if (template == null || roleRoot == null) {
                // No station material: the slots exist but cannot be printed. Say so instead
                // of dropping the band or shading it with an invented shader.
                foreach (var view in views)
                    OpeningModuleViews.SetHeaderArtwork(view,
                        OpeningModuleViews.HeaderArtworkUnported("no-station-material", view.Headers.Count));
                context?.ReportUnresolved("psd-header-material", "opening", views[0].ModuleId,
                    "No station shader/material for the printed PSD header band; " + views.Count +
                    " run(s) keep their header slots unpainted.");
                return;
            }
            host = host != null ? host : UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            var scope = roleRoot.gameObject.AddComponent<PsdHeaderArtworkScope>();
            var publishHost = host;
            if (publishHost != null) scope.Publish = json => publishHost != null && publishHost.PublishOutbound(json);
            scope.Provider = new PsdHeaderWebProvider(PsdHeaderArtwork.Send, CurrentContext);
            scope.Cache = new PsdHeaderTextureCache(scope.Provider, template);
            foreach (var view in views) {
                int bound = 0;
                var slots = view.Headers;
                for (int i = 0; i < slots.Count; i++) {
                    var binding = scope.Cache.Bind(view, slots[i]);
                    if (binding == null) continue;
                    scope.Bindings.Add(binding);
                    bound++;
                }
                var decalSlots = view.Decals;
                for (int i = 0; i < decalSlots.Count; i++) {
                    var binding = scope.Cache.Bind(view, decalSlots[i]);
                    if (binding == null) continue;
                    scope.Bindings.Add(binding);
                }
                if (bound == 0)
                    OpeningModuleViews.SetHeaderArtwork(view,
                        OpeningModuleViews.HeaderArtworkUnported("no-slot-node", slots.Count));
            }
            var pumpObject = new GameObject("psd header pump");
            pumpObject.transform.SetParent(roleRoot, false);
            pumpObject.AddComponent<PsdHeaderPump>().Cache = scope.Cache;
            state.Headers = scope;
            PsdHeaderArtwork.Attach(scope);
            scope.Cache.Pump();
            // The pump above asks once; a transport that is not attached yet leaves every
            // panel in the retry queue and the run's diagnostic names the missing route
            // until a later Pump heals it (no silent fallback).
            if (scope.Provider.DroppedRequests > 0) {
                foreach (var view in views)
                    OpeningModuleViews.SetHeaderArtwork(view,
                        OpeningModuleViews.HeaderArtworkUnported("no-transport", view.Headers.Count));
            }
            if (publishHost != null) publishHost.RegisterStateContributor(PsdHeaderArtwork.State);
        }

        /// <summary>
        /// The session and revision a header reply must still belong to. The same fence the
        /// sign face provider uses: a reply from another session, or for a revision the
        /// station has already moved past, is a picture of a station that is gone.
        /// </summary>
        PsdHeaderContext CurrentContext() {
            if (host == null) host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            return new PsdHeaderContext {
                SessionId = host != null ? host.ClientSessionId : "",
                Revision = host != null ? host.CurrentRevision : -1,
            };
        }

        public void Release() {
            // Drop only worlds the host has actually disposed; the outgoing world's
            // Release runs after the candidate's Build, so clearing everything here
            // would delete the live station's openings (B4's switch report).
            var dead = new List<StationWorldView>();
            foreach (var pair in states) {
                if (pair.Key == null || pair.Key.IsDisposed) {
                    pair.Value.Set.Clear();
                    if (pair.Value.CoverChunksByKey != null) {
                        foreach (var chunk in pair.Value.CoverChunksByKey.Values) {
                            if (chunk == null) continue;
                            if (pair.Value.Drawer != null) {
                                for (int b = 0; b < chunk.Batches.Count; b++) pair.Value.Drawer.Remove(chunk.Batches[b]);
                            }
                            for (int m = 0; m < chunk.ProxyMeshes.Count; m++) {
                                if (chunk.ProxyMeshes[m] != null) OpeningModuleViews.SafeDestroy(chunk.ProxyMeshes[m]);
                            }
                            chunk.ProxyMeshes.Clear();
                        }
                        pair.Value.CoverChunksByKey.Clear();
                    }
                    pair.Value.CoverChunkItems.Clear();
                    pair.Value.ModuleToCoverChunk.Clear();
                    pair.Value.BatchedCoverBands.Clear();
                    pair.Value.CoverTemplate = null;
                    pair.Value.Templates?.Dispose();
                    pair.Value.Templates = null;
                    pair.Value.Drawer = null;
                    // The printed headers belong to this world too: free their textures,
                    // quads and materials before the palette (their template) goes.
                    PsdHeaderArtwork.ReleaseScope(pair.Value.Headers);
                    pair.Value.Headers = null;
                    pair.Value.Palette?.Release();
                    pair.Value.Finishes?.Dispose();
                    pair.Value.Finishes = null;
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
