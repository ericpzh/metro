using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App.Views {
    /// <summary>The saved vertical-circulation family a view draws.</summary>
    public enum VerticalModuleKind { Stair, Escalator, Walkway, Lift }

    /// <summary>
    /// One saved stair / escalator / walkway / lift, reduced to the plain inputs the
    /// vertical builders read. The integration layer fills this from
    /// <see cref="ModuleFacts"/> (or a raw record); the builders never touch a
    /// document, an index or an editor-only type.
    ///
    /// The fields are document-axis facts: <c>X/Y/Z</c> is the saved base cell
    /// (plan x, plan y, elevation z) and <c>From/To</c> are the authored run
    /// endpoints in the same axes. <see cref="Prefab"/> is the promoted wrapper the
    /// caller resolved (<c>RuntimeCatalogue</c>/<c>ModuleViews.Resolve</c>); a
    /// builder instances it only when it is an exact match for the authored
    /// dimensions and leaves <see cref="VerticalModuleView.UsedPrefab"/> false
    /// otherwise, so no reference prefab is ever scaled to fit.
    /// </summary>
    public struct VerticalModuleRequest {
        public string ModuleId;
        public string Type;
        /// <summary>The module's <c>cfg</c> object as JSON. Empty is a legal empty config.</summary>
        public string ConfigJson;
        public int X, Y, Z;
        public int Rotation;
        public int Width, Depth;
        public int LevelBase;
        public bool HasEndpoints;
        public int FromX, FromY, FromZ, ToX, ToY, ToZ;
        public GameObject Prefab;
        public string PrefabKey;
        /// <summary>Optional authored-solid lookup for wall / landing-floor rules; null = no walls, portal assumed on floor.</summary>
        public Func<int, int, int, bool> Solid;
        /// <summary>Optional palette material source; null builds default URP materials.</summary>
        public Func<int, Material> MaterialFor;

        public static VerticalModuleRequest FromFacts(ModuleFacts facts, GameObject prefab = null, string prefabKey = null,
            Func<int, int, int, bool> solid = null, Func<int, Material> materialFor = null) {
            if (facts == null) throw new ArgumentNullException(nameof(facts));
            var request = new VerticalModuleRequest {
                ModuleId = facts.Id,
                Type = facts.Type,
                ConfigJson = ConfigJsonOf(facts.Config),
                X = facts.X, Y = facts.Y, Z = facts.Z,
                Rotation = facts.Rotation,
                Width = facts.Width, Depth = facts.Depth,
                Prefab = prefab, PrefabKey = prefabKey, Solid = solid, MaterialFor = materialFor,
            };
            if (facts.From.HasValue) {
                request.HasEndpoints = true;
                request.FromX = facts.From.X; request.FromY = facts.From.Y; request.FromZ = facts.From.Z;
                request.ToX = facts.To.X; request.ToY = facts.To.Y; request.ToZ = facts.To.Z;
            } else if (facts.To.HasValue) {
                request.HasEndpoints = true;
                request.FromX = facts.X; request.FromY = facts.Y; request.FromZ = facts.Z;
                request.ToX = facts.To.X; request.ToY = facts.To.Y; request.ToZ = facts.To.Z;
            }
            return request;
        }

        /// <summary>Rebuild the cfg object from the flattened facts (arrays/objects keep their JSON).</summary>
        static string ConfigJsonOf(ModuleConfig config) {
            var configObject = new JObject();
            if (config == null) return configObject.ToString(Newtonsoft.Json.Formatting.None);
            foreach (var key in config.Keys) {
                var text = config.Text(key);
                if (string.IsNullOrEmpty(text)) continue;
                if (text[0] == '{' || text[0] == '[') {
                    try { configObject[key] = JToken.Parse(text); continue; } catch { /* a plain string that starts with a bracket */ }
                }
                if (bool.TryParse(text, out var boolean)) { configObject[key] = boolean; continue; }
                if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)) { configObject[key] = number; continue; }
                configObject[key] = text;
            }
            return configObject.ToString(Newtonsoft.Json.Formatting.None);
        }
    }

    /// <summary>
    /// Per-module state published to one vertical view. The host keys it by the saved
    /// module id; a state for another module never moves this view. The plain fields
    /// follow the packet brief: <c>seconds</c>, <c>running</c>, <c>directionSign</c>,
    /// <c>cabinFraction</c> and <c>doorFraction</c>. <see cref="PhaseMeters"/> and
    /// <see cref="CabinHeight"/> are optional extensions for packet C: when its
    /// <c>StationEscalatorFrame.PhaseMeters</c> is known it is authoritative;
    /// otherwise the phase derives from <see cref="Seconds"/>.
    /// </summary>
    public struct ModuleMotionState {
        public string ModuleId;
        /// <summary>Simulation seconds. Pausing the station must freeze this number.</summary>
        public double Seconds;
        /// <summary>False while paused: the current pose is held, not advanced.</summary>
        public bool Running;
        /// <summary>+1 the authored travel, -1 reversed, 0 stopped.</summary>
        public int DirectionSign;
        /// <summary>0 bottom stop ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ 1 top stop. NaN samples the endpoint/dwell cycle from <see cref="Seconds"/>.</summary>
        public float CabinFraction;
        /// <summary>0 shut ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ 1 open. NaN samples the endpoint/dwell cycle from <see cref="Seconds"/>.</summary>
        public float DoorFraction;
        /// <summary>Optional escalator phase in metres; NaN derives it from Seconds ÃƒÆ’Ã¢â‚¬â€ 0.5 m/s.</summary>
        public double PhaseMeters;
        /// <summary>Optional lift cabin floor elevation in document z; NaN uses <see cref="CabinFraction"/> or the cycle.</summary>
        public double CabinHeight;

        public static ModuleMotionState Escalator(string moduleId, double seconds, bool running, int directionSign) =>
            new ModuleMotionState {
                ModuleId = moduleId, Seconds = seconds, Running = running, DirectionSign = directionSign,
                CabinFraction = float.NaN, DoorFraction = float.NaN, PhaseMeters = double.NaN, CabinHeight = double.NaN,
            };

        public static ModuleMotionState Lift(string moduleId, float cabinFraction, float doorFraction) =>
            new ModuleMotionState {
                ModuleId = moduleId, Seconds = 0, Running = false, DirectionSign = 1,
                CabinFraction = cabinFraction, DoorFraction = doorFraction, PhaseMeters = double.NaN, CabinHeight = double.NaN,
            };

        /// <summary>A state that leaves the current pose untouched.</summary>
        public static ModuleMotionState Hold(string moduleId) =>
            new ModuleMotionState {
                ModuleId = moduleId, Seconds = 0, Running = false, DirectionSign = 0,
                CabinFraction = float.NaN, DoorFraction = float.NaN, PhaseMeters = double.NaN, CabinHeight = double.NaN,
            };
    }

    /// <summary>One named part or traversal anchor of a vertical view.</summary>
    public sealed class VerticalPartRef {
        public string Name;
        public Transform Transform;
        public bool Moving;
        public VerticalPartRef(string name, Transform transform, bool moving) {
            Name = name ?? ""; Transform = transform; Moving = moving;
        }
    }

    /// <summary>
    /// The dimensioned segment chain of one escalator/walkway (source:
    /// <c>buildRampBand</c>). All values are derived from the authored run.
    /// </summary>
    internal sealed class BandRig {
        public Vector3 A, B, Lower, Upper, Climb;
        public float Length, InclineLength, RunPerMetre, FlatLength, Flat, ChainLength, Pitch, StepRise, StepRun;
        public float InclineDegrees, WidthBlocks, BodyWidth, BandWidth, RailWidth;
        public float AuthoredHorizontal, AuthoredRise, YawDegrees, PrefabYawDegrees, TravelSign;
        public int Count;
        public bool PrefabFrame;
    }

    /// <summary>One driven step: its tread+nosing mesh and its separate riser mesh.</summary>
    internal sealed class BandStep {
        public int Index;
        public Transform Tread;
        public Transform Riser;
    }

    /// <summary>One telescoping lift leaf: closed position, opening sign and travel.</summary>
    internal sealed class LiftLeaf {
        public Transform Transform;
        public float ClosedX, Sign, Travel;
    }

    /// <summary>The landing doors of one served level, front and back bank.</summary>
    internal sealed class LiftLevelRig {
        public int LevelZ;
        public Transform FrontGroup;
        public Transform BackGroup;
        public List<LiftLeaf> Front;
        public List<LiftLeaf> Back;
    }

    /// <summary>The moving parts of one lift: cabin and its two door banks.</summary>
    internal sealed class LiftRig {
        public Transform Frame;
        public Transform Cabin;
        public double PivotZ;
        public double Height;
        public double BottomStopZ, TopStopZ;
        public List<double> Stops;
        public List<int> Levels;
        public List<LiftLevelRig> LevelRigs;
        public List<LiftLeaf> CabinFront;
        public List<LiftLeaf> CabinBack;
    }

    /// <summary>
    /// One built vertical-circulation view: the promoted prefab (exact match) or a
    /// dimensioned assembly, its named parts/anchors, its document-axis bounds and
    /// the per-module motion hook. The root sits at the source group pivot with a
    /// document-axis local frame (Unity <c>(x, elevation, plan y)</c>).
    /// </summary>
    public sealed class VerticalModuleView : IDisposable {
        public string ModuleId = "";
        public string Type = "";
        public VerticalModuleKind Kind;
        public Transform Root;
        /// <summary>True only when the promoted prefab reproduces the authored piece exactly.</summary>
        public bool UsedPrefab;
        public string PrefabKey = "";
        /// <summary>Why a supplied prefab was rejected; empty when it was used or none was supplied.</summary>
        public string PrefabRejectReason = "";
        /// <summary>Authored document-axis pivot of the source group.</summary>
        public Vector3 PivotDocument;
        public Bounds WorldBounds;
        public StationBox DocumentBounds;
        public int LevelMin, LevelMax;

        public IReadOnlyList<VerticalPartRef> Parts => parts;
        public double PhaseMeters { get; internal set; }
        public double RunLength { get; internal set; }
        public double StepPitch { get; internal set; }
        public double LoopSeconds { get; internal set; }
        public double EscalatorSpeed { get; internal set; } = VerticalModuleViews.EscalatorSpeed;
        public int StepCount { get; internal set; }
        public IReadOnlyList<double> Stops { get; internal set; } = Array.Empty<double>();
        public IReadOnlyList<int> Levels { get; internal set; } = Array.Empty<int>();
        public int PortalCount { get; internal set; }
        /// <summary>
        /// Full-height opaque side walls the style branch emitted: 2 for a steel housing,
        /// 0 for a glazed one (whose sides are the panel bays). A glazed lift must report
        /// 0 — an opaque box at the same plane is what enclosed the glass.
        /// </summary>
        public int OpaqueShaftSidePanels { get; internal set; }
        public double CabinFloorZ { get; internal set; }
        public float DoorFraction { get; internal set; }
        public int AlignedStop { get; internal set; } = -1;

        internal BandRig Band;
        internal LiftRig Lift;
        internal List<BandStep> Steps;
        internal readonly List<VerticalPartRef> parts = new List<VerticalPartRef>();
        internal readonly List<Mesh> Meshes = new List<Mesh>();
        internal Func<int, Material> MaterialFor;

        /// <summary>
        /// Apply one module state. A state naming another module returns false and
        /// changes nothing; the station must never drive every vertical piece with one
        /// global state.
        /// </summary>
        public bool Apply(ModuleMotionState state) {
            if (!string.IsNullOrEmpty(state.ModuleId) && !string.Equals(state.ModuleId, ModuleId, StringComparison.Ordinal))
                return false;
            switch (Kind) {
                case VerticalModuleKind.Escalator:
                case VerticalModuleKind.Walkway:
                    return VerticalModuleViews.ApplyBand(this, state);
                case VerticalModuleKind.Lift:
                    return VerticalModuleViews.ApplyLift(this, state);
                default:
                    return true; // a stair is static; the state was accepted and nothing needed to move
            }
        }

        public bool TryGetPart(string name, out Transform transform) {
            for (int i = 0; i < parts.Count; i++) {
                if (string.Equals(parts[i].Name, name, StringComparison.Ordinal)) { transform = parts[i].Transform; return true; }
            }
            transform = null;
            return false;
        }

        public bool TryGetPartBounds(string name, out Bounds bounds) {
            bounds = default;
            if (!TryGetPart(name, out var transform) || !transform) return false;
            return VerticalModuleViews.TryMeasureBounds(transform, out bounds);
        }

        /// <summary>Live world bounds over every renderer under the root.</summary>
        public Bounds MeasureWorldBounds() {
            Bounds bounds = default;
            bool any = false;
            if (Root) {
                var renderers = Root.GetComponentsInChildren<Renderer>(true);
                for (int i = 0; i < renderers.Length; i++) {
                    var renderer = renderers[i];
                    if (!renderer) continue;
                    if (!any) { bounds = renderer.bounds; any = true; } else bounds.Encapsulate(renderer.bounds);
                }
            }
            if (any) WorldBounds = bounds;
            return bounds;
        }

        /// <summary>Live document-axis AABB (min = plan x / plan y / elevation).</summary>
        public StationBox MeasureDocumentBounds() {
            var bounds = MeasureWorldBounds();
            Vector3 min = bounds.min, max = bounds.max;
            Vector3 docMin = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
            Vector3 docMax = new Vector3(float.MinValue, float.MinValue, float.MinValue);
            for (int corner = 0; corner < 8; corner++) {
                var world = new Vector3((corner & 1) == 0 ? min.x : max.x, (corner & 2) == 0 ? min.y : max.y, (corner & 4) == 0 ? min.z : max.z);
                var doc = StationCoordinates.WorldToDocument(world);
                docMin = Vector3.Min(docMin, doc);
                docMax = Vector3.Max(docMax, doc);
            }
            DocumentBounds = new StationBox(docMin.x, docMin.y, docMin.z, docMax.x, docMax.y, docMax.z);
            return DocumentBounds;
        }

        internal void Register(string name, Transform transform, bool moving) {
            if (transform == null) return;
            parts.Add(new VerticalPartRef(name, transform, moving));
        }

        public void Dispose() {
            for (int i = 0; i < Meshes.Count; i++) VerticalModuleViews.DestroyObject(Meshes[i]);
            Meshes.Clear();
            Steps = null;
            Band = null;
            Lift = null;
        }
    }

    /// <summary>
    /// The runtime recipes for stairs, escalators, walkways and lifts. Each recipe is
    /// dimensioned from the authored record and traces the TypeScript owners
    /// (`render/models/pieces/StairModel.ts`, `EscalatorModel.ts`, `LiftModel.ts`,
    /// `sim/stairs.ts`, `sim/escalators.ts`, `sim/lifts.ts`).
    ///
    /// The escalator recipe instances the promoted <c>Escalator</c> prefab when the
    /// authored run is the family's canonical 9-cell / 5 m / 30Ãƒâ€šÃ‚Â° / narrow one ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â all
    /// fourteen Zoo runs are. Its baked step band is hidden and replaced by named,
    /// per-module driven steps, so the fixed truss, balustrades, handrails, comb
    /// plates and landing decks keep the promoted artwork while the moving band is
    /// driven from state. Nothing is scaled to fit: a prefab whose authored run does
    /// not match is rejected and the piece is assembled from primitives instead.
    ///
    /// Lifts are always assembled at their authored shaft length and gap list (both
    /// Zoo lifts are longer than the promoted five-metre reference), with one landing
    /// portal per served level, a cabin whose floor is the driven channel, and
    /// telescoping landing/cabin leaves.
    /// </summary>
    public static class VerticalModuleViews {
        public const float EscalatorSpeed = .5f;
        public const float LiftDoorSeconds = 2f;
        public const float LiftDwellSeconds = 6f;
        public const float LiftSpeed = 1.5f;

        // Palette ids shared with StationMaterials so a generated part reads as the
        // same station kit (index order is the palette's own).
        public const int PaletteGlass = 10, PaletteSteel = 6, PaletteDark = 5, PaletteLight = 13, PaletteLine = 7, PaletteWarm = 8, PalettePlatform = 2;

        /// <summary>The escalator family's authored reference run (Escalator.prefab).</summary>
        public const int CanonicalEscalatorRunCells = 9;
        public const float CanonicalEscalatorRise = 5f;
        public const float CanonicalEscalatorIncline = 30f;
        /// <summary>The straight-stair family's authored reference run (StairStraight.prefab).</summary>
        public const int CanonicalStairRunCells = 8;
        public const float CanonicalStairRise = 5f;
        public const float CanonicalStairTreadWidth = .79f;
        /// <summary>The promoted Lift.prefab is one 2 ÃƒÆ’Ã¢â‚¬â€ 2 shaft with a single five-metre interval.</summary>
        public const float CanonicalLiftShaftHeight = 5f;

        // TypeScript constants (game/src/sim/constants.ts, rampSurface.ts).
        const float StairRailProud = .105f;
        const float StairTreadThickness = .09f;
        const float StairRiseTarget = 1f / 6f;
        const float StairStringerThickness = .32f;
        const float StairSoffitThickness = .06f;
        const float StairLandingThickness = .5f;
        const float StairRailHeight = .95f;
        const float StairLead = .34f;
        const float StairReturnRadius = .25f;
        const float StairTransitionLength = .3f;
        const float StairBodyDrop = .36f;
        const float EscalatorBandBase = .68f;
        const float EscalatorBalustradeSpacing = .82f;
        const float EscalatorSkirtInset = .08f;
        const float EscalatorFlatLength = .5f;
        const float EscalatorTrussDepth = .34f;
        const float EscalatorSurfaceClearance = .005f;
        const float EscalatorBaseBury = .02f;
        const float EscalatorStepPitch = .4f;
        const float LiftOuter = .94f;
        const float LiftCap = .14f;
        const float LiftCapPlan = 1.98f;
        const float LiftInner = .72f;
        const float LiftDoorwayHeight = 2.58f;
        const int LiftStep = 5;
        const float LiftFloorSink = .01f;
        const float LiftPanelWidth = .378f;

        static readonly Dictionary<int, Material> DefaultMaterials = new Dictionary<int, Material>();
        static Shader defaultShader;
        internal static readonly Color32[] Palette = {
            new Color32(184, 185, 178, 255), new Color32(141, 151, 153, 255), new Color32(219, 212, 195, 255),
            new Color32(79, 113, 67, 255), new Color32(93, 106, 110, 255), new Color32(61, 69, 76, 255),
            new Color32(181, 192, 195, 255), new Color32(42, 107, 118, 255), new Color32(217, 169, 61, 255),
            new Color32(139, 77, 59, 255), new Color32(79, 140, 148, 255), new Color32(83, 60, 49, 255),
            new Color32(75, 120, 58, 255), new Color32(215, 227, 225, 255),
        };

        /// <summary>Fallback material for tests and a host with no palette (the shader is found once).</summary>
        public static Material DefaultMaterial(int palette) {
            palette = Mathf.Clamp(palette, 0, Palette.Length - 1);
            if (DefaultMaterials.TryGetValue(palette, out var existing) && existing) return existing;
            if (!defaultShader) defaultShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            var material = new Material(defaultShader) { color = Palette[palette], name = "Vertical " + palette };
            if (palette == PaletteGlass) StationGlass.MakeTransparent(material, .26f);
            DefaultMaterials[palette] = material;
            return material;
        }

        /* --------------------------------------------------------------- entry */

        /// <summary>
        /// Build one vertical module view under <paramref name="parent"/>. The parent
        /// must be an identity world root (the station renderer contract); the view
        /// places its own pivot. Returns false for an unknown type or a record without
        /// the endpoints the recipe needs, leaving no partial object behind.
        /// </summary>
        public static bool TryBuild(VerticalModuleRequest request, Transform parent, out VerticalModuleView view) {
            view = null;
            if (parent == null || string.IsNullOrEmpty(request.Type)) return false;
            VerticalModuleKind kind;
            switch (request.Type) {
                case "stair": kind = VerticalModuleKind.Stair; break;
                case "escalator": kind = VerticalModuleKind.Escalator; break;
                case "walkway": kind = VerticalModuleKind.Walkway; break;
                case "lift": kind = VerticalModuleKind.Lift; break;
                default: return false;
            }
            var root = new GameObject(string.IsNullOrEmpty(request.ModuleId) ? "vertical-module" : request.ModuleId);
            root.transform.SetParent(parent, false);
            var context = new BuildContext { Request = request, Root = root.transform, Kind = kind };
            var candidate = new VerticalModuleView { ModuleId = request.ModuleId ?? "", Type = request.Type, Kind = kind, Root = root.transform, MaterialFor = request.MaterialFor };
            try {
                bool built;
                switch (kind) {
                    case VerticalModuleKind.Stair: built = BuildStair(context, candidate); break;
                    case VerticalModuleKind.Lift: built = BuildLift(context, candidate); break;
                    default: built = BuildBand(context, candidate); break;
                }
                if (!built) {
                    DestroyObject(root);
                    return false;
                }
                candidate.LevelMin = context.LevelMin;
                candidate.LevelMax = context.LevelMax;
                candidate.WorldBounds = candidate.MeasureWorldBounds();
                candidate.MeasureDocumentBounds();
                view = candidate;
                return true;
            } catch (Exception error) {
                DestroyObject(root);
                candidate.Dispose();
                Debug.LogWarning("Vertical module " + request.Type + " " + request.ModuleId + " failed: " + error.Message);
                return false;
            }
        }

        /// <summary>Destroy an object in the mode that supports it: DestroyImmediate in the editor, Destroy in play mode.</summary>
        internal static void DestroyObject(UnityEngine.Object target) {
            if (!target) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(target);
            else UnityEngine.Object.DestroyImmediate(target);
        }

        /// <summary>Apply one state to every view; ids are matched inside each view.</summary>
        public static int Apply(IEnumerable<VerticalModuleView> views, ModuleMotionState state) {
            if (views == null) return 0;
            int applied = 0;
            foreach (var view in views) if (view != null && view.Apply(state)) applied++;
            return applied;
        }

        internal static Bounds MeasureBounds(Transform transform) {
            var bounds = new Bounds(transform.position, Vector3.zero);
            bool any = false;
            var renderers = transform.GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++) {
                if (!renderers[i]) continue;
                if (!any) { bounds = renderers[i].bounds; any = true; } else bounds.Encapsulate(renderers[i].bounds);
            }
            return bounds;
        }

        internal static bool TryMeasureBounds(Transform transform, out Bounds bounds) {
            bounds = default;
            if (!transform) return false;
            var renderers = transform.GetComponentsInChildren<Renderer>(true);
            bool any = false;
            for (int i = 0; i < renderers.Length; i++) {
                if (!renderers[i]) continue;
                if (!any) { bounds = renderers[i].bounds; any = true; } else bounds.Encapsulate(renderers[i].bounds);
            }
            return any;
        }

        /* -------------------------------------------------------------- motion */

        /// <summary>Port of <c>escalatorStepHeight</c> (sim/escalators.ts).</summary>
        internal static double StepHeight(double along, double inclineLength, double risePerM, double horizontalPerM) {
            double bend = Math.Min(StairTransitionLength / horizontalPerM, inclineLength / 4.0);
            double Bottom(double u) {
                if (u <= -bend) return 0;
                if (u < bend) return risePerM * (u + bend) * (u + bend) / (4.0 * bend);
                return risePerM * u;
            }
            return along <= inclineLength * .5 ? Bottom(along) : inclineLength * risePerM - Bottom(inclineLength - along);
        }

        /// <summary>
        /// Advance one escalator/walkway band and repose every step. The phase advances
        /// in the authored travel direction (<c>to ÃƒÂ¢Ã‹â€ Ã¢â‚¬â„¢ from</c>) at 0.5 m/s and wraps into
        /// <c>[0, chainLength)</c>; a step is hidden only while the comb covers it, so the
        /// visible span never shows a step teleporting from one landing to the other.
        /// </summary>
        internal static bool ApplyBand(VerticalModuleView view, ModuleMotionState state) {
            var band = view.Band;
            if (band == null) return true;
            double phase;
            if (!double.IsNaN(state.PhaseMeters) && !double.IsInfinity(state.PhaseMeters)) {
                phase = state.PhaseMeters;
            } else if (state.Running && state.DirectionSign != 0) {
                phase = band.TravelSign * state.DirectionSign * EscalatorSpeed * state.Seconds;
            } else {
                return true; // stopped or paused: hold the seated pose
            }
            phase = Wrap(phase, band.ChainLength);
            view.PhaseMeters = phase;
            if (view.Steps == null) return true;
            for (int i = 0; i < view.Steps.Count; i++) {
                var step = view.Steps[i];
                double u = Wrap(step.Index * band.Pitch + phase, band.ChainLength);
                double along = u - band.Flat;
                double height = StepHeight(along, band.InclineLength, band.Climb.z, band.RunPerMetre);
                double next = StepHeight(along + band.Pitch, band.InclineLength, band.Climb.z, band.RunPerMetre);
                bool covered = along < -band.Flat + band.Pitch * .5 || along > band.InclineLength + band.Flat - band.Pitch * .5;
                float riserHeight = (float)Math.Max(0.0, next - height);
                Vector3 position;
                Quaternion rotation;
                if (band.PrefabFrame) {
                    // Prefab local x = horizontal run, local y = elevation; the source
                    // step position is (climb.xy * along, height + 0.015), so the
                    // elevation channel is `height` itself (it already includes the
                    // climb), never `climb.z * along` on top of it.
                    position = new Vector3((float)(along * band.RunPerMetre), (float)(height + .015), 0f);
                    rotation = Quaternion.identity;
                } else {
                    var documentPosition = new Vector3(
                        (float)(band.Climb.x * along),
                        (float)(band.Climb.y * along),
                        (float)(height + .015));
                    position = Doc(documentPosition);
                    rotation = Quaternion.Euler(0f, -band.YawDegrees, 0f);
                }
                var tread = step.Tread;
                if (tread) {
                    tread.localPosition = position;
                    tread.localRotation = rotation;
                    tread.gameObject.SetActive(!covered);
                }
                var riser = step.Riser;
                if (riser) {
                    riser.localPosition = position;
                    riser.localRotation = rotation;
                    bool visible = !covered && riserHeight > 1e-5f;
                    riser.gameObject.SetActive(visible);
                    if (visible) riser.localScale = new Vector3(1f, riserHeight / band.StepRise, 1f);
                }
            }
            return true;
        }

        /// <summary>
        /// Apply a lift snapshot: the cabin floor is placed at
        /// <c>CabinFraction</c>/<c>CabinHeight</c> (or the endpoint/dwell cycle), and
        /// only the landing the car is aligned with opens ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a through-floor's other
        /// landing stays shut while the car travels past it.
        /// </summary>
        internal static bool ApplyLift(VerticalModuleView view, ModuleMotionState state) {
            var lift = view.Lift;
            if (lift == null) return true;
            double cabinFloor = double.NaN;
            float door = float.NaN;
            if (!float.IsNaN(state.CabinFraction)) {
                float fraction = Mathf.Clamp01(state.CabinFraction);
                cabinFloor = lift.Stops[0] + 1 + fraction * lift.Height;
            } else if (!double.IsNaN(state.CabinHeight)) {
                cabinFloor = state.CabinHeight;
            } else if (state.Running) {
                var sample = SampleLiftCycle(lift.Stops, state.Seconds, true, state.DirectionSign);
                cabinFloor = sample.CabinCellZ + 1;
                door = sample.DoorFraction;
            }
            if (!float.IsNaN(state.DoorFraction)) door = Mathf.Clamp01(state.DoorFraction);
            if (!double.IsNaN(cabinFloor)) {
                view.CabinFloorZ = cabinFloor;
                if (lift.Cabin) {
                    var position = lift.Cabin.localPosition;
                    position.y = (float)(cabinFloor - lift.PivotZ);
                    lift.Cabin.localPosition = position;
                }
            }
            if (float.IsNaN(door)) return true;
            view.DoorFraction = door;
            int aligned = -1;
            bool cabinAligned = false;
            for (int i = 0; i < lift.LevelRigs.Count; i++) {
                var level = lift.LevelRigs[i];
                bool isAligned = Math.Abs(view.CabinFloorZ - (level.LevelZ + 1)) < .011;
                if (isAligned) { aligned = level.LevelZ; cabinAligned = true; }
                float open = isAligned ? door : 0f;
                ApplyLeaves(level.Front, open);
                ApplyLeaves(level.Back, open);
            }
            view.AlignedStop = aligned;
            ApplyLeaves(lift.CabinFront, cabinAligned ? door : 0f);
            ApplyLeaves(lift.CabinBack, cabinAligned ? door : 0f);
            return true;
        }

        static void ApplyLeaves(List<LiftLeaf> leaves, float open) {
            if (leaves == null) return;
            for (int i = 0; i < leaves.Count; i++) {
                var leaf = leaves[i];
                if (!leaf.Transform) continue;
                var position = leaf.Transform.localPosition;
                position.x = leaf.ClosedX + leaf.Sign * leaf.Travel * open;
                leaf.Transform.localPosition = position;
            }
        }

        /* -------------------------------------------------------- lift cycle */

        /// <summary>One sampled pose of the documented lift endpoint/dwell cycle.</summary>
        public struct LiftCycleSample {
            public int StopIndex;
            /// <summary>The cabin's floor is this cell z + 1 (the stop's floor surface).</summary>
            public double CabinCellZ;
            public float DoorFraction;
            public string Phase;
        }

        /// <summary>
        /// The TypeScript lift choreography as a pure cycle: at a stop the doors open
        /// over 2 s, hold 6 s, close over 2 s, then the car travels
        /// <c>max(1.5, |ÃƒÅ½Ã¢â‚¬Âz| / 1.5)</c> seconds with a smoothstep, and reverses at the
        /// shaft ends. This is the oracle the view test samples for dwell; packet C's
        /// session currently parks an uncalled car, so the host may keep passing
        /// <see cref="ModuleMotionState.CabinFraction"/> instead.
        /// </summary>
        public static LiftCycleSample SampleLiftCycle(IReadOnlyList<double> stops, double seconds, bool running, int directionSign) {
            var result = new LiftCycleSample { Phase = "idle", DoorFraction = 0f };
            if (stops == null || stops.Count == 0) return result;
            var ordered = new List<double>(stops);
            ordered.Sort();
            if (directionSign < 0) ordered.Reverse();
            int count = ordered.Count;
            result.StopIndex = 0;
            result.CabinCellZ = ordered[0];
            if (count == 1 || !running) { result.Phase = "idle"; return result; }
            // Ping-pong visit order: 0 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ n-1 ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ 1 (then back to 0).
            var visits = new List<int>(2 * count - 2);
            for (int i = 0; i < count; i++) visits.Add(i);
            for (int i = count - 2; i >= 1; i--) visits.Add(i);
            double travelTotal = 0;
            for (int i = 0; i < visits.Count; i++) {
                int a = visits[i], b = visits[(i + 1) % visits.Count];
                travelTotal += Math.Max(1.5, Math.Abs(ordered[b] - ordered[a]) / LiftSpeed);
            }
            double holdTotal = visits.Count * (LiftDoorSeconds * 2 + LiftDwellSeconds);
            double cycle = travelTotal + holdTotal;
            if (cycle <= 1e-6) { result.Phase = "idle"; return result; }
            double t = Wrap(seconds, cycle);
            for (int i = 0; i < visits.Count; i++) {
                int here = visits[i];
                if (t < LiftDoorSeconds) {
                    result.StopIndex = here; result.CabinCellZ = ordered[here];
                    result.DoorFraction = (float)(t / LiftDoorSeconds); result.Phase = "opening";
                    return result;
                }
                t -= LiftDoorSeconds;
                if (t < LiftDwellSeconds) {
                    result.StopIndex = here; result.CabinCellZ = ordered[here];
                    result.DoorFraction = 1f; result.Phase = "dwell";
                    return result;
                }
                t -= LiftDwellSeconds;
                if (t < LiftDoorSeconds) {
                    result.StopIndex = here; result.CabinCellZ = ordered[here];
                    result.DoorFraction = (float)(1 - t / LiftDoorSeconds); result.Phase = "closing";
                    return result;
                }
                t -= LiftDoorSeconds;
                int next = visits[(i + 1) % visits.Count];
                double travel = Math.Max(1.5, Math.Abs(ordered[next] - ordered[here]) / LiftSpeed);
                if (t < travel) {
                    double k = t / travel;
                    double eased = k * k * (3 - 2 * k);
                    result.StopIndex = here;
                    result.CabinCellZ = ordered[here] + (ordered[next] - ordered[here]) * eased;
                    result.DoorFraction = 0f;
                    result.Phase = "travel";
                    return result;
                }
                t -= travel;
            }
            result.CabinCellZ = ordered[visits[0]];
            result.DoorFraction = 0f;
            result.Phase = "idle";
            return result;
        }

        /* --------------------------------------------------------- build: stairs */

        sealed class StairFlightSpec {
            public Vector3 From, To;          // document axes (cell corner + 0.5 / +1)
            public Vector2 Slide;             // stairFlightSlides
            public bool WallLeft, WallRight;
            public int Steps;
            public float Run, Rise, TreadWidth;
            public Vector3 Origin;            // document position of the flight group
            public float YawDegrees;
            public int Index;
            public bool OuterLower, OuterUpper;
        }

        static bool BuildStair(BuildContext context, VerticalModuleView view) {
            var request = context.Request;
            var config = ParseConfig(request.ConfigJson);
            var flights = ReadFlights(config, request);
            if (flights.Count == 0) return false;
            bool block = config.Bool("block");
            string style = config.Text("style") ?? "";
            bool straight = style.Length == 0 || style.StartsWith("straight", StringComparison.Ordinal);
            float savedWidth = (float)config.Number("width", .68f);
            float treadWidth = StairTreadWidth(straight, block, savedWidth);
            var slides = StairFlightSlides(flights, straight, block, savedWidth, treadWidth);
            var specs = new List<StairFlightSpec>(flights.Count);
            for (int i = 0; i < flights.Count; i++) {
                var flight = flights[i];
                var lower = flight.From.z <= flight.To.z ? flight.From : flight.To;
                var upper = flight.From.z <= flight.To.z ? flight.To : flight.From;
                var delta = upper - lower;
                float run = new Vector2(delta.x, delta.y).magnitude;
                float rise = delta.z;
                if (run < 1e-3f || Math.Abs(rise) < 1e-3f) continue;
                var slide = i < slides.Count ? slides[i] : Vector2.zero;
                var walls = request.Solid != null ? StairWallSides(request.Solid, lower, upper, treadWidth, slide) : default(Vector2Int);
                specs.Add(new StairFlightSpec {
                    From = flights[i].From, To = flights[i].To, Slide = slide,
                    WallLeft = request.Solid != null && walls.x != 0,
                    WallRight = request.Solid != null && walls.y != 0,
                    Run = run, Rise = rise, TreadWidth = treadWidth,
                    Origin = new Vector3(lower.x + .5f + slide.x, lower.y + .5f + slide.y, lower.z + 1f),
                    YawDegrees = Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg,
                    Index = i,
                    Steps = Mathf.Max(2, Mathf.RoundToInt(Mathf.Abs(rise) / StairRiseTarget)),
                    OuterLower = i == 0,
                    OuterUpper = i == flights.Count - 1,
                });
            }
            if (specs.Count == 0) return false;

            // The promoted straight stair is an exact reference only when the authored
            // piece has the same one-flight run and no wall side that would suppress one
            // of its handrails (its export ran on an empty document, so it always carries
            // both rails).
            bool prefabExact = request.Prefab != null && straight && specs.Count == 1 &&
                string.Equals(request.PrefabKey ?? "stair-straight", "stair-straight", StringComparison.Ordinal) &&
                Math.Abs(specs[0].Run - CanonicalStairRunCells) < 1e-3f &&
                Math.Abs(specs[0].Rise - CanonicalStairRise) < 1e-3f &&
                Math.Abs(specs[0].TreadWidth - CanonicalStairTreadWidth) < 1e-3f &&
                !specs[0].WallLeft && !specs[0].WallRight;
            if (request.Prefab != null && !prefabExact) {
                bool anyWall = false;
                for (int i = 0; i < specs.Count; i++) if (specs[i].WallLeft || specs[i].WallRight) anyWall = true;
                view.PrefabRejectReason = anyWall ? "wall-sides" : "dimensions";
            }

            Vector3 pivot;
            if (prefabExact) {
                // Reference origin = the module cell corner. The canonical flight starts
                // one cell centre into the module, so a turned stair places the corner
                // through the reversed quarter turn about that start.
                var first = specs[0];
                var lower = first.From.z <= first.To.z ? first.From : first.To;
                var start = new Vector3(lower.x + .5f, lower.y + .5f, lower.z + 1f);
                var turned = RotateClockwise(request.Rotation, .5f, .5f);
                pivot = new Vector3(start.x - turned.x, start.y - turned.y, start.z - 1f);
                context.Root.localPosition = StationCoordinates.Point(pivot);
                context.Root.localRotation = Quaternion.identity;
                var instance = UnityEngine.Object.Instantiate(request.Prefab, context.Root, false);
                instance.transform.localPosition = Vector3.zero;
                instance.transform.localRotation = Quaternion.Euler(0f, 90f * request.Rotation, 0f);
                view.Root = context.Root;
                view.UsedPrefab = true;
                view.PrefabKey = request.PrefabKey ?? "stair-straight";
                RegisterStairAnchors(view, specs, flights, pivot);
                context.LevelMin = Mathf.RoundToInt(Mathf.Min(flights[0].From.z, flights[0].To.z));
                context.LevelMax = Mathf.RoundToInt(Mathf.Max(flights[0].From.z, flights[0].To.z));
                return true;
            }

            pivot = new Vector3(request.X, request.Y, request.Z);
            view.PivotDocument = pivot;
            context.Root.localPosition = StationCoordinates.Point(pivot);
            context.Root.localRotation = Quaternion.identity;
            for (int i = 0; i < specs.Count; i++) BuildStairFlight(context, view, specs[i], pivot);
            BuildStairLandings(context, view, flights, specs, treadWidth, request, pivot);
            RegisterStairAnchors(view, specs, flights, pivot);
            view.RunLength = specs[0].Run;
            context.LevelMin = int.MaxValue; context.LevelMax = int.MinValue;
            for (int i = 0; i < flights.Count; i++) {
                context.LevelMin = Mathf.Min(context.LevelMin, Mathf.RoundToInt(Mathf.Min(flights[i].From.z, flights[i].To.z)));
                context.LevelMax = Mathf.Max(context.LevelMax, Mathf.RoundToInt(Mathf.Max(flights[i].From.z, flights[i].To.z)));
            }
            return true;
        }

        static void BuildStairFlight(BuildContext context, VerticalModuleView view, StairFlightSpec spec, Vector3 pivot) {
            var frame = new GameObject("flight-" + spec.Index).transform;
            frame.SetParent(context.Root, false);
            frame.localPosition = StationCoordinates.Point(spec.Origin) - StationCoordinates.Point(pivot);
            frame.localRotation = Quaternion.Euler(0f, -spec.YawDegrees, 0f);
            view.Register("flight-" + spec.Index, frame, false);

            float inner = Mathf.Min(.5f, Mathf.Max(0f, (spec.Run - .4f) * .5f));
            float stairRun = spec.Run - inner * 2f;
            if (stairRun < .2f) return;
            float half = spec.TreadWidth * .5f;
            float steps = spec.Steps;
            float stepRise = spec.Rise / steps;
            float going = stairRun / steps;
            float theta = Mathf.Atan2(spec.Rise, stairRun);
            float slopeLength = Mathf.Sqrt(stairRun * stairRun + spec.Rise * spec.Rise);
            float underside = spec.Rise * .5f - StairBodyDrop;
            float BeamLength(float thickness) => slopeLength - thickness * Mathf.Tan(theta);

            var treads = new PartMesh(Vector3.zero);
            var risers = new PartMesh(Vector3.zero);
            var stringers = new PartMesh(Vector3.zero);
            var soffit = new PartMesh(Vector3.zero);
            var handrails = new PartMesh(Vector3.zero);
            var posts = new PartMesh(Vector3.zero);
            var glass = new PartMesh(Vector3.zero);
            var beamRotation = Quaternion.Euler(0f, -theta * Mathf.Rad2Deg, 0f);

            for (int i = 0; i < spec.Steps; i++) {
                treads.Box(new Vector3(inner + i * going + going * .5f, 0f, (i + 1) * stepRise - StairTreadThickness * .5f),
                    new Vector3(going + .002f, spec.TreadWidth, StairTreadThickness), Quaternion.identity);
                risers.Box(new Vector3(inner + i * going, 0f, i * stepRise + stepRise * .5f),
                    new Vector3(.05f, spec.TreadWidth, stepRise), Quaternion.identity);
            }
            float midX = inner + stairRun * .5f;
            float yMid = 0f;
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? 1f : -1f;
                bool walled = sign > 0 ? spec.WallLeft : spec.WallRight;
                string railName = (sign > 0 ? "handrail-left-" : "handrail-right-") + spec.Index;
                // The stringer keeps every side, a walled one included.
                stringers.Box(new Vector3(midX, sign * (half + .05f), underside + StairStringerThickness / (2f * Mathf.Cos(theta))),
                    new Vector3(BeamLength(StairStringerThickness), .11f, StairStringerThickness), beamRotation);
                if (walled) continue;
                handrails.Box(new Vector3(midX, sign * (half + .07f), spec.Rise * .5f + StairRailHeight),
                    new Vector3(slopeLength, .07f, .07f), beamRotation);
                view.Register(railName, NewAnchor(context.Root, railName,
                    spec.Origin + RotateDoc(spec.YawDegrees, new Vector3(midX, sign * (half + .07f), spec.Rise * .5f + StairRailHeight)), Quaternion.identity), false);
                for (int i = 0; i <= 2; i++) {
                    float u = inner + (i / 2f) * stairRun;
                    posts.Box(new Vector3(u, sign * (half + .07f), ((u - inner) / stairRun) * spec.Rise + .47f),
                        new Vector3(.05f, .05f, .94f), Quaternion.identity);
                }
                for (int pane = 0; pane < 2; pane++) {
                    float x0 = inner + pane * stairRun * .5f + .03f;
                    float x1 = inner + (pane + 1) * stairRun * .5f - .03f;
                    float z0 = (x0 - inner) / stairRun * spec.Rise;
                    float z1 = (x1 - inner) / stairRun * spec.Rise;
                    float paneTop = StairRailHeight - .06f;
                    float paneLength = Mathf.Sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
                    glass.Box(new Vector3((x0 + x1) * .5f, sign * (half + .07f) + .0125f, (z0 + z1) * .5f + .09f + (paneTop - .09f) * .5f),
                        new Vector3(paneLength, .025f, paneTop - .09f), beamRotation);
                }
            }
            soffit.Box(new Vector3(midX, yMid, underside + StairSoffitThickness / (2f * Mathf.Cos(theta))),
                new Vector3(BeamLength(StairSoffitThickness), spec.TreadWidth + .06f, StairSoffitThickness), beamRotation);
            // Outer handrails level off and drop into a newel post at the landings the
            // piece owns (the module's two authored endpoints).
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? 1f : -1f;
                if (sign > 0 ? spec.WallLeft : spec.WallRight) continue;
                float y = sign * (half + .07f);
                for (int end = 0; end < 2; end++) {
                    int o = end == 0 ? -1 : 1;
                    if (o < 0 ? !spec.OuterLower : !spec.OuterUpper) continue;
                    float xEnd = o < 0 ? inner : inner + stairRun;
                    float floor = o < 0 ? 0f : spec.Rise;
                    float zEnd = floor + StairRailHeight;
                    handrails.Box(new Vector3(xEnd + o * (StairLead * .5f - .02f), y, zEnd), new Vector3(StairLead, .07f, .07f), Quaternion.identity);
                    float post = zEnd - StairReturnRadius - floor;
                    posts.Box(new Vector3(xEnd + o * (StairLead + StairReturnRadius), y, floor + post * .5f), new Vector3(.07f, .07f, post), Quaternion.identity);
                }
            }
            int paletteSteel = PaletteSteel, paletteDark = PaletteDark, paletteLight = PaletteLight, paletteGlass = PaletteGlass;
            if (treads.VertexCount > 0) view.Meshes.Add(treads.Build(frame, context.Material(paletteLight), "treads"));
            if (risers.VertexCount > 0) view.Meshes.Add(risers.Build(frame, context.Material(paletteLight), "risers"));
            if (stringers.VertexCount > 0) view.Meshes.Add(stringers.Build(frame, context.Material(paletteDark), "stringers"));
            if (soffit.VertexCount > 0) view.Meshes.Add(soffit.Build(frame, context.Material(paletteDark), "soffit"));
            if (handrails.VertexCount > 0) view.Meshes.Add(handrails.Build(frame, context.Material(paletteDark), "handrails"));
            if (posts.VertexCount > 0) view.Meshes.Add(posts.Build(frame, context.Material(paletteSteel), "posts"));
            if (glass.VertexCount > 0) view.Meshes.Add(glass.Build(frame, context.Material(paletteGlass), "glass"));
            view.Register("treads-" + spec.Index, frame, false);
            // The middle tread is the traversal plane anchor packet C can snap to.
            if (spec.Steps > 0) {
                int middle = spec.Steps / 2;
                float u = inner + middle * going + going * .5f;
                var point = spec.Origin + RotateDoc(spec.YawDegrees, new Vector3(u, 0f, (middle + 1) * stepRise));
                view.Register("tread-sample-" + spec.Index, NewAnchor(context.Root, "tread-sample-" + spec.Index, point, Quaternion.identity), false);
            }
        }

        static void BuildStairLandings(BuildContext context, VerticalModuleView view, List<StairFlight> flights,
            List<StairFlightSpec> specs, float width, VerticalModuleRequest request, Vector3 pivot) {
            for (int i = 0; i + 1 < flights.Count; i++) {
                var a = flights[i].To;
                var shape = LandingShape(flights, i, width);
                var center = new Vector3((float)((shape.x0 + shape.x1) * .5), (float)((shape.y0 + shape.y1) * .5), a.z + 1f);
                var mesh = new PartMesh(center);
                var surface = new PartMesh(center);
                float sizeX = (float)(shape.x1 - shape.x0), sizeY = (float)(shape.y1 - shape.y0);
                surface.Box(center + new Vector3(0f, 0f, -StairTreadThickness * .5f), new Vector3(sizeX, sizeY, StairTreadThickness), Quaternion.identity);
                mesh.Box(center + new Vector3(0f, 0f, -StairTreadThickness - (StairLandingThickness - StairTreadThickness) * .5f),
                    new Vector3(sizeX, sizeY, StairLandingThickness - StairTreadThickness), Quaternion.identity);
                var landing = new GameObject("landing-" + i).transform;
                landing.SetParent(context.Root, false);
                landing.localPosition = StationCoordinates.Point(center) - StationCoordinates.Point(pivot);
                landing.localRotation = Quaternion.identity;
                view.Register("landing-" + i, landing, false);
                view.Meshes.Add(surface.Build(landing, context.Material(PaletteLight), "landing-surface"));
                view.Meshes.Add(mesh.Build(landing, context.Material(PaletteDark), "landing-frame"));
                var landingWalls = request.Solid != null ? LandingWalls(flights, i, shape, request.Solid) : default(StairLandingWalls);
                BuildLandingRails(context, view, landing, center, sizeX, sizeY, flights, i, landingWalls, width);
                view.Register("turn-landing", NewAnchor(context.Root, "turn-landing", center, Quaternion.identity), false);
            }
        }

        static void BuildLandingRails(BuildContext context, VerticalModuleView view, Transform landing, Vector3 center,
            float sizeX, float sizeY, List<StairFlight> flights, int index, StairLandingWalls walls, float width) {
            var attached = new HashSet<string>();
            AttachEdge(attached, flights[index].To, flights[index].From);
            AttachEdge(attached, flights[index + 1].From, flights[index + 1].To);
            var rail = new PartMesh(center);
            var glass = new PartMesh(center);
            var steel = new PartMesh(center);
            float x0 = center.x - sizeX * .5f, x1 = center.x + sizeX * .5f;
            float y0 = center.y - sizeY * .5f, y1 = center.y + sizeY * .5f;
            float top = center.z;
            void Rail(string edge) {
                bool horizontal = edge == "s" || edge == "n";
                if (horizontal) {
                    float y = edge == "s" ? y0 : y1;
                    rail.Box(new Vector3(center.x, y, top + StairRailHeight), new Vector3(sizeX, .06f, .06f), Quaternion.identity);
                    glass.Box(new Vector3(center.x, y, top + StairRailHeight * .5f), new Vector3(Mathf.Max(.01f, sizeX - .2f), .025f, StairRailHeight - .16f), Quaternion.identity);
                    foreach (float px in new[] { x0 + .07f, x1 - .07f })
                        steel.Box(new Vector3(px, y, top + StairRailHeight * .5f), new Vector3(.05f, .05f, StairRailHeight), Quaternion.identity);
                } else {
                    float x = edge == "w" ? x0 : x1;
                    rail.Box(new Vector3(x, center.y, top + StairRailHeight), new Vector3(.06f, sizeY, .06f), Quaternion.identity);
                    glass.Box(new Vector3(x, center.y, top + StairRailHeight * .5f), new Vector3(.025f, Mathf.Max(.01f, sizeY - .2f), StairRailHeight - .16f), Quaternion.identity);
                    foreach (float py in new[] { y0 + .07f, y1 - .07f })
                        steel.Box(new Vector3(x, py, top + StairRailHeight * .5f), new Vector3(.05f, .05f, StairRailHeight), Quaternion.identity);
                }
            }
            string[] edges = { "s", "n", "w", "e" };
            for (int i = 0; i < edges.Length; i++) {
                var edge = edges[i];
                if (WallOf(walls, edge)) continue;
                if (!attached.Contains(edge)) { Rail(edge); continue; }
                var incoming = flights[index].To - flights[index].From;
                var outgoing = flights[index + 1].To - flights[index + 1].From;
                if (incoming.x * outgoing.x + incoming.y * outgoing.y > 0f) continue;
            }
            if (rail.VertexCount > 0) view.Meshes.Add(rail.Build(landing, context.Material(PaletteDark), "landing-rails"));
            if (glass.VertexCount > 0) view.Meshes.Add(glass.Build(landing, context.Material(PaletteGlass), "landing-glass"));
            if (steel.VertexCount > 0) view.Meshes.Add(steel.Build(landing, context.Material(PaletteSteel), "landing-posts"));
        }

        static void RegisterStairAnchors(VerticalModuleView view, List<StairFlightSpec> specs, List<StairFlight> flights, Vector3 pivot) {
            view.PivotDocument = pivot;
            view.Register("pivot", NewAnchor(view.Root, "pivot", pivot, Quaternion.identity), false);
            var from = flights[0].From;
            var last = flights[flights.Count - 1].To;
            view.Register("lower-landing", NewAnchor(view.Root, "lower-landing",
                new Vector3(from.x + .5f, from.y + .5f, from.z + 1f), Quaternion.identity), false);
            view.Register("upper-landing", NewAnchor(view.Root, "upper-landing",
                new Vector3(last.x + .5f, last.y + .5f, last.z + 1f), Quaternion.identity), false);
        }

        /* ------------------------------------------------------- build: band */

        static bool BuildBand(BuildContext context, VerticalModuleView view) {
            var request = context.Request;
            var config = ParseConfig(request.ConfigJson);
            if (!request.HasEndpoints && !(request.ToX != 0 || request.ToY != 0 || request.ToZ != 0)) return false;
            var from = new Vector3Int(request.FromX, request.FromY, request.FromZ);
            var to = new Vector3Int(request.ToX, request.ToY, request.ToZ);
            bool escalator = request.Type == "escalator";
            float inclineDegrees = escalator ? (float)config.Number("incline", 30) : 0f;
            float widthBlocks = (float)config.Number("width", 1);
            var band = BandGeometry(from, to, inclineDegrees, widthBlocks, escalator);
            if (band == null) return false;
            view.Band = band;
            view.RunLength = band.ChainLength;
            view.StepPitch = band.Pitch;
            view.StepCount = band.Count;
            view.LoopSeconds = band.ChainLength / EscalatorSpeed;
            view.PivotDocument = band.Lower;
            view.EscalatorSpeed = EscalatorSpeed;

            bool prefabExact = request.Prefab != null && escalator &&
                string.Equals(request.PrefabKey ?? "escalator", "escalator", StringComparison.Ordinal) &&
                Math.Abs(band.AuthoredHorizontal - CanonicalEscalatorRunCells) < 1e-3f &&
                Math.Abs(band.AuthoredRise - CanonicalEscalatorRise) < 1e-3f &&
                Math.Abs(band.InclineDegrees - CanonicalEscalatorIncline) < 1e-3f &&
                Math.Abs(band.WidthBlocks - 1f) < 1e-3f;
            if (request.Prefab != null && !prefabExact) view.PrefabRejectReason = "dimensions";

            context.Root.localPosition = StationCoordinates.Point(band.Lower);
            context.Root.localRotation = Quaternion.identity;
            if (prefabExact) {
                BuildBandPrefab(context, view, band, request);
            } else {
                BuildBandDimensioned(context, view, band);
            }
            RegisterBandAnchors(context, view, band, from, to);
            context.LevelMin = Mathf.Min(from.z, to.z);
            context.LevelMax = Mathf.Max(from.z, to.z);
            // Seat the band at phase 0 so the piece is complete before the first state.
            ApplyBand(view, new ModuleMotionState {
                ModuleId = request.ModuleId, Seconds = 0, Running = true, DirectionSign = 1,
                CabinFraction = float.NaN, DoorFraction = float.NaN, PhaseMeters = 0, CabinHeight = double.NaN,
            });
            return true;
        }

        static void BuildBandPrefab(BuildContext context, VerticalModuleView view, BandRig band, VerticalModuleRequest request) {
            var instance = UnityEngine.Object.Instantiate(request.Prefab, context.Root, false);
            var yaw = Quaternion.Euler(0f, band.PrefabYawDegrees, 0f);
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = yaw;
            view.UsedPrefab = true;
            view.PrefabKey = request.PrefabKey ?? "escalator";
            // The export baked the step band at phase 0. Hide those merged, unnamed
            // band meshes; the driven steps below take their place.
            var bandNode = FindBandNode(instance.transform);
            if (bandNode != null) {
                var children = bandNode.GetComponentsInChildren<MeshRenderer>(true);
                for (int i = 0; i < children.Length; i++) {
                    var node = children[i];
                    var name = node.gameObject.name;
                    if (name.StartsWith("comb-plate", StringComparison.Ordinal) || name.StartsWith("landing-deck", StringComparison.Ordinal)) continue;
                    node.enabled = false;
                }
            }
            band.PrefabFrame = true;
            view.Steps = new List<BandStep>(band.Count);
            var treadMesh = BuildTreadMesh(band);
            var riserMesh = BuildRiserMesh(band);
            view.Meshes.Add(treadMesh);
            view.Meshes.Add(riserMesh);
            var group = new GameObject("band").transform;
            group.SetParent(instance.transform, false);
            view.Register("band", group, true);
            for (int i = 0; i < band.Count; i++) {
                var tread = NewMeshObject("tread-" + i, group, treadMesh, context.Material(PaletteSteel));
                var riser = NewMeshObject("riser-" + i, group, riserMesh, context.Material(PaletteSteel));
                var step = new BandStep { Index = i, Tread = tread, Riser = riser };
                view.Steps.Add(step);
                if (i == 0) view.Register("tread-0", tread, true);
                if (i == band.Count - 1) view.Register("tread-last", tread, true);
            }
        }

        static void BuildBandDimensioned(BuildContext context, VerticalModuleView view, BandRig band) {
            var runFrame = new GameObject("run").transform;
            runFrame.SetParent(context.Root, false);
            runFrame.localPosition = Vector3.zero;
            runFrame.localRotation = Quaternion.identity;
            var basis = RunBasis(band);
            var runRotation = RotationFromBasis(new Vector3(basis.x.x, basis.x.y, basis.x.z),
                new Vector3(basis.y.x, basis.y.y, basis.y.z), new Vector3(basis.z.x, basis.z.y, basis.z.z));
            var truss = new PartMesh(band.Lower);
            var skirt = new PartMesh(band.Lower);
            var balustrade = new PartMesh(band.Lower);
            var handrail = new PartMesh(band.Lower);
            var comb = new PartMesh(band.Lower);
            float cosT = new Vector2(basis.x.x, basis.x.y).magnitude;
            float trussOffset = EscalatorFlatLength * cosT - EscalatorTrussDepth * .5f;
            truss.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, 0f, -trussOffset),
                new Vector3(band.Length, band.BodyWidth, EscalatorTrussDepth), runRotation);
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? -1f : 1f;
                float skirtWidth = (band.BodyWidth - band.BandWidth) * .5f + .03f;
                skirt.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, sign * (band.BandWidth * .5f + skirtWidth * .5f), 0f),
                    new Vector3(band.Length, skirtWidth, .62f), runRotation);
                balustrade.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, sign * (band.RailWidth * .5f + .015f), .5f),
                    new Vector3(band.Length, .03f, 1f), runRotation);
                handrail.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, sign * (band.RailWidth * .5f + .03f), 1f),
                    new Vector3(band.Length, .1f, .08f), runRotation);
            }
            var horizontal = new Vector3(band.Climb.x, band.Climb.y, 0f);
            if (horizontal.sqrMagnitude > 1e-9f) horizontal.Normalize();
            var levelRotation = Quaternion.Euler(0f, -band.YawDegrees, 0f);
            for (int end = 0; end < 2; end++) {
                int dir = end == 0 ? -1 : 1;
                var endPoint = band.Lower + (end == 0 ? Vector3.zero : band.Climb * band.Length);
                var combPoint = endPoint + horizontal * (dir * (band.FlatLength - .15f)) + new Vector3(0f, 0f, .045f);
                comb.Box(combPoint, new Vector3(.3f, band.BandWidth, .05f), levelRotation);
            }
            view.Meshes.Add(truss.Build(runFrame, context.Material(PaletteDark), "truss"));
            view.Meshes.Add(skirt.Build(runFrame, context.Material(PaletteSteel), "skirt"));
            view.Meshes.Add(balustrade.Build(runFrame, context.Material(PaletteGlass), "balustrade"));
            view.Meshes.Add(handrail.Build(runFrame, context.Material(PaletteDark), "handrail"));
            view.Meshes.Add(comb.Build(runFrame, context.Material(PaletteWarm), "comb"));
            view.Register("truss", runFrame, false);
            band.PrefabFrame = false;
            view.Steps = new List<BandStep>(band.Count);
            var treadMesh = BuildTreadMesh(band);
            var riserMesh = BuildRiserMesh(band);
            view.Meshes.Add(treadMesh);
            view.Meshes.Add(riserMesh);
            var group = new GameObject("band").transform;
            group.SetParent(context.Root, false);
            view.Register("band", group, true);
            for (int i = 0; i < band.Count; i++) {
                var tread = NewMeshObject("tread-" + i, group, treadMesh, context.Material(PaletteSteel));
                var riser = NewMeshObject("riser-" + i, group, riserMesh, context.Material(PaletteSteel));
                view.Steps.Add(new BandStep { Index = i, Tread = tread, Riser = riser });
                if (i == 0) view.Register("tread-0", tread, true);
                if (i == band.Count - 1) view.Register("tread-last", tread, true);
            }
        }

        static void RegisterBandAnchors(BuildContext context, VerticalModuleView view, BandRig band, Vector3Int from, Vector3Int to) {
            view.Register("pivot", NewAnchor(context.Root, "pivot", band.Lower, Quaternion.identity), false);
            view.Register("lower-landing", NewAnchor(context.Root, "lower-landing",
                new Vector3(from.x + .5f, from.y + .5f, from.z + 1f), Quaternion.identity), false);
            view.Register("upper-landing", NewAnchor(context.Root, "upper-landing",
                new Vector3(to.x + .5f, to.y + .5f, to.z + 1f), Quaternion.identity), false);
            var horizontal = new Vector3(band.Climb.x, band.Climb.y, 0f);
            if (horizontal.sqrMagnitude > 1e-9f) horizontal.Normalize();
            var right = new Vector3(-horizontal.y, horizontal.x, 0f);
            var mid = band.Lower + band.Climb * (band.Length * .5f) + new Vector3(0f, 0f, 1f);
            view.Register("band-lower", NewAnchor(context.Root, "band-lower", band.Lower, Quaternion.identity), false);
            view.Register("band-upper", NewAnchor(context.Root, "band-upper", band.Upper, Quaternion.identity), false);
            view.Register("handrail-left", NewAnchor(context.Root, "handrail-left", mid + right * (band.RailWidth * .5f + .03f), Quaternion.identity), false);
            view.Register("handrail-right", NewAnchor(context.Root, "handrail-right", mid - right * (band.RailWidth * .5f + .03f), Quaternion.identity), false);
            float plate = band.FlatLength - .15f;
            view.Register("comb-lower", NewAnchor(context.Root, "comb-lower",
                band.Lower + horizontal * (-plate) + new Vector3(0f, 0f, .045f), Quaternion.identity), false);
            view.Register("comb-upper", NewAnchor(context.Root, "comb-upper",
                band.Upper + horizontal * plate + new Vector3(0f, 0f, .045f), Quaternion.identity), false);
        }

        /* -------------------------------------------------------- build: lift */

        static bool BuildLift(BuildContext context, VerticalModuleView view) {
            var request = context.Request;
            var config = ParseConfig(request.ConfigJson);
            var rises = ReadNumbers(config, "rises");
            int baseZ = request.FromZ;
            int topZ = request.ToZ;
            if (!request.HasEndpoints && topZ <= baseZ) {
                float span = 0f;
                for (int i = 0; i < rises.Count; i++) span += (float)rises[i];
                if (span <= 0f) span = LiftStep;
                baseZ = request.Z;
                topZ = request.Z + Mathf.RoundToInt(span);
            }
            if (topZ <= baseZ) return false;
            int fromZ = Mathf.Min(baseZ, topZ);
            int toZ = Mathf.Max(baseZ, topZ);
            float height = toZ - fromZ;
            int size = Math.Abs(config.Number("size", 2) - 3) < 1e-6 ? 3 : 2;
            float k = size * .5f;
            bool steel = string.Equals(config.Text("style"), "steel", StringComparison.Ordinal);
            view.OpaqueShaftSidePanels = steel ? 2 : 0;
            var stops = LiftStops(fromZ, toZ, rises);
            var levels = LiftLevels(fromZ, rises);
            var doors = config.Object("doors");
            var pivot = new Vector3(request.X + k, request.Y + k, fromZ + 1f - LiftFloorSink);
            view.PivotDocument = pivot;
            view.RunLength = height;
            view.LoopSeconds = 0;
            view.Stops = stops;
            view.Levels = levels;
            context.Root.localPosition = StationCoordinates.Point(pivot);
            context.Root.localRotation = Quaternion.identity;
            var frame = new GameObject("shaft-frame").transform;
            frame.SetParent(context.Root, false);
            frame.localPosition = Vector3.zero;
            frame.localRotation = Quaternion.Euler(0f, -90f * request.Rotation, 0f);
            view.Register("pivot", NewAnchor(context.Root, "pivot", pivot, Quaternion.identity), false);
            view.Register("shaft", frame, false);
            // The promoted Lift.prefab is one 2 x 2 shaft with a single five-metre
            // interval; a supplied reference is rejected unless the authored shaft is
            // exactly that (the two Zoo shafts are 9 m and 13 m).
            bool liftPrefabExact = request.Prefab != null && Math.Abs(height - CanonicalLiftShaftHeight) < 1e-3f &&
                size == 2 && levels.Count == 1;
            if (request.Prefab != null) view.PrefabRejectReason = liftPrefabExact ? "cabin-rig-not-bound" : "dimensions";
            if (levels.Count > 0) {
                view.Register("lower-landing", NewAnchor(context.Root, "lower-landing",
                    LandingAnchor(request, size, request.Rotation, levels[0], false), Quaternion.identity), false);
                view.Register("upper-landing", NewAnchor(context.Root, "upper-landing",
                    LandingAnchor(request, size, request.Rotation, levels[levels.Count - 1], false), Quaternion.identity), false);
            }

            bool anyBack = false;
            for (int i = 0; i < levels.Count; i++) if (ServesSide(doors, levels[i], true)) anyBack = true;
            var portalFloors = new bool[levels.Count];
            var frontServed = new bool[levels.Count];
            var backServed = new bool[levels.Count];
            int portalCount = 0;
            for (int i = 0; i < levels.Count; i++) {
                int level = levels[i];
                float local = level - fromZ;
                int stopIndex = stops.IndexOf(level);
                float storyTop = stopIndex >= 0 && stopIndex + 1 < stops.Count ? (float)(stops[stopIndex + 1] - fromZ) : height;
                bool fits = local + LiftDoorwayHeight <= storyTop + 1e-6f;
                frontServed[i] = fits && ServesSide(doors, level, false);
                backServed[i] = fits && anyBack && ServesSide(doors, level, true);
                portalFloors[i] = request.Solid == null || LandingFloor(request.Solid, request.X, request.Y, size, request.Rotation, level, false);
                if (frontServed[i] && !portalFloors[i]) { frontServed[i] = false; }
                if (backServed[i] && !(request.Solid == null || LandingFloor(request.Solid, request.X, request.Y, size, request.Rotation, level, true))) backServed[i] = false;
                if (frontServed[i] || backServed[i]) portalCount++;
            }
            view.PortalCount = portalCount;

            var shaft = new PartMesh(Vector3.zero);
            var shaftGlass = new PartMesh(Vector3.zero);
            var guides = new PartMesh(Vector3.zero);
            var caps = new PartMesh(Vector3.zero);
            var portals = new PartMesh(Vector3.zero);
            var portalGlass = new PartMesh(Vector3.zero);
            float outer = LiftOuter * k;
            float capPlan = LiftCapPlan * k;
            float ringDepth = .27f * k;
            float ringOffset = size * .5f - ringDepth * .5f - .005f;
            float ringWidth = 2f * ringOffset + ringDepth;
            float ringLength = 2f * ringOffset - ringDepth;
            for (int sx = -1; sx <= 1; sx += 2) {
                for (int sy = -1; sy <= 1; sy += 2) {
                    shaft.Box(new Vector3(sx * outer, sy * outer, height * .5f), new Vector3(.14f * k, .14f * k, height), Quaternion.identity);
                    shaft.Box(new Vector3(sx * outer, sy * outer, .04f), new Vector3(.16f * k, .16f * k, .08f), Quaternion.identity);
                }
            }
            for (float bottom = 0f; bottom < height; bottom += 2f) {
                float top = Mathf.Min(bottom + 2f, height);
                float middle = (bottom + top) * .5f;
                for (int s = -1; s <= 1; s += 2) {
                    shaftGlass.Box(new Vector3(s * outer, 0f, middle), new Vector3(.025f * k, 1.72f * k, top - bottom - .08f), Quaternion.identity);
                    shaft.Box(new Vector3(s * outer, 0f, bottom + .04f), new Vector3(.12f * k, 1.74f * k, .08f), Quaternion.identity);
                }
            }
            for (int i = 0; i + 1 < stops.Count; i++) {
                float local = (float)(stops[i] - fromZ);
                float top = (float)(stops[i + 1] - fromZ);
                float loFront = frontServed[i] ? Mathf.Max(local, local + LiftDoorwayHeight) : local;
                float loBack = backServed[i] ? Mathf.Max(local, local + LiftDoorwayHeight) : local;
                StoryGlass(shaftGlass, shaft, -outer, loFront, top, k);
                StoryGlass(shaftGlass, shaft, outer, loBack, top, k);
            }
            for (int s = -1; s <= 1; s += 2) {
                // The glass housing has **no** full-height side wall: its side faces are the
                // glazed panel bays above (`shaftGlass`), exactly like `buildGlassLift`. The
                // old branch put a 0.12 m steel box at the same `s * outer` plane, enclosing
                // the 0.025 m pane, so a glazed lift read as an opaque shaft. The steel style
                // keeps its solid side walls.
                if (steel)
                    shaft.Box(new Vector3(s * outer, 0f, height * .5f), new Vector3(.12f * k, 1.74f * k, height), Quaternion.identity);
                float guideHeight = height - LiftCap;
                guides.Box(new Vector3(s * .84f * k, 0f, guideHeight * .5f), new Vector3(.055f * k, .065f * k, guideHeight), Quaternion.identity);
                for (float z = .4f; z < height; z += 2f)
                    shaft.Box(new Vector3(s * .88f * k, 0f, z), new Vector3(.13f * k, .16f * k, .06f), Quaternion.identity);
            }
            caps.Box(new Vector3(0f, 0f, height - LiftCap * .5f), new Vector3(capPlan, capPlan, LiftCap), Quaternion.identity);
            for (int s = -1; s <= 1; s += 2) {
                caps.Box(new Vector3(0f, s * ringOffset, LiftCap * .5f), new Vector3(ringWidth, ringDepth, LiftCap), Quaternion.identity);
                caps.Box(new Vector3(s * ringOffset, 0f, LiftCap * .5f), new Vector3(ringDepth, ringLength, LiftCap), Quaternion.identity);
            }

            var levelRigs = new List<LiftLevelRig>(levels.Count);
            for (int i = 0; i < levels.Count; i++) {
                int level = levels[i];
                float local = level - fromZ;
                var rig = new LiftLevelRig { LevelZ = level };
                if (frontServed[i]) BuildLandingPortal(context, view, frame, portals, portalGlass, local, -1, k, steel, height);
                if (backServed[i]) BuildLandingPortal(context, view, frame, portals, portalGlass, local, 1, k, steel, height);
                if (frontServed[i] || backServed[i]) {
                    var group = new GameObject("landing-doors-" + level + "-front").transform;
                    group.SetParent(frame, false);
                    group.localPosition = new Vector3(0f, local, -outer);
                    group.localRotation = Quaternion.identity;
                    rig.FrontGroup = group;
                    rig.Front = new List<LiftLeaf>(4);
                    BuildLiftLeaves(view, group, rig.Front, false, k, context.Material(steel ? PaletteSteel : PaletteGlass), 2.24f, 1.19f, false);
                    view.Register("landing-doors-" + level + "-front", group, true);
                }
                if (backServed[i]) {
                    var group = new GameObject("landing-doors-" + level + "-back").transform;
                    group.SetParent(frame, false);
                    group.localPosition = new Vector3(0f, local, outer);
                    group.localRotation = Quaternion.identity;
                    rig.BackGroup = group;
                    rig.Back = new List<LiftLeaf>(4);
                    BuildLiftLeaves(view, group, rig.Back, true, k, context.Material(steel ? PaletteSteel : PaletteGlass), 2.24f, 1.19f, false);
                    view.Register("landing-doors-" + level + "-back", group, true);
                }
                levelRigs.Add(rig);
                view.Register("stop-" + level, NewAnchor(context.Root, "stop-" + level,
                    LandingAnchor(request, size, request.Rotation, level, false), Quaternion.identity), false);
            }

            // Every stop the cabin can park at gets a traversal anchor: served levels use
            // their landing-row cell, the top cap uses the shaft centre at the cabin floor.
            for (int i = 0; i < stops.Count; i++) {
                int stop = (int)Math.Round(stops[i]);
                bool isLevel = false;
                for (int l = 0; l < levels.Count; l++) if (levels[l] == stop) { isLevel = true; break; }
                if (isLevel) continue;
                view.Register("stop-" + stop, NewAnchor(context.Root, "stop-" + stop,
                    new Vector3(request.X + k, request.Y + k, stop + 1f), Quaternion.identity), false);
            }

            var cabin = new GameObject("cabin").transform;
            cabin.SetParent(frame, false);
            cabin.localPosition = new Vector3(0f, (float)(fromZ + 1f - pivot.z), 0f);
            cabin.localRotation = Quaternion.identity;
            view.Register("cabin", cabin, true);
            BuildCabin(context, view, cabin, k, anyBack, steel);
            var cabinFrontGroup = new GameObject("cabin-door-front").transform;
            cabinFrontGroup.SetParent(cabin, false);
            view.Register("cabin-door-front", cabinFrontGroup, true);
            var cabinFront = new List<LiftLeaf>(4);
            BuildLiftLeaves(view, cabinFrontGroup, cabinFront, false, k, context.Material(steel ? PaletteDark : PaletteGlass), 2.15f, 1.24f, true);
            var cabinBack = new List<LiftLeaf>(4);
            if (anyBack) {
                var cabinBackGroup = new GameObject("cabin-door-back").transform;
                cabinBackGroup.SetParent(cabin, false);
                view.Register("cabin-door-back", cabinBackGroup, true);
                BuildLiftLeaves(view, cabinBackGroup, cabinBack, true, k, context.Material(steel ? PaletteDark : PaletteGlass), 2.15f, 1.24f, true);
            }

            view.Meshes.Add(shaft.Build(frame, context.Material(PaletteSteel), "shaft"));
            view.Meshes.Add(shaftGlass.Build(frame, context.Material(PaletteGlass), "shaft-glass"));
            view.Meshes.Add(guides.Build(frame, context.Material(PaletteDark), "guides"));
            view.Meshes.Add(caps.Build(frame, context.Material(steel ? PaletteSteel : PaletteDark), "caps"));
            if (portals.VertexCount > 0) view.Meshes.Add(portals.Build(frame, context.Material(PaletteSteel), "portals"));
            if (portalGlass.VertexCount > 0) view.Meshes.Add(portalGlass.Build(frame, context.Material(PaletteGlass), "portal-glass"));
            view.Lift = new LiftRig {
                Frame = frame, Cabin = cabin, PivotZ = pivot.z, Height = height,
                Stops = stops, Levels = levels, LevelRigs = levelRigs,
                CabinFront = cabinFront, CabinBack = cabinBack,
                BottomStopZ = fromZ, TopStopZ = toZ,
            };
            view.CabinFloorZ = fromZ + 1f;
            view.AlignedStop = fromZ;
            context.LevelMin = fromZ;
            context.LevelMax = toZ;
            // Seat the parked car and closed doors at the bottom stop.
            ApplyLift(view, ModuleMotionState.Lift(request.ModuleId, 0f, 0f));
            return true;
        }

        static void StoryGlass(PartMesh glass, PartMesh steel, float y, float lo, float top, float k) {
            for (float bottom = lo; bottom < top; bottom += 2f) {
                float bayTop = Mathf.Min(bottom + 2f, top);
                if (bayTop - bottom <= .1f) break;
                glass.Box(new Vector3(0f, y, (bottom + bayTop) * .5f), new Vector3(1.72f * k, .025f * k, bayTop - bottom - .08f), Quaternion.identity);
                steel.Box(new Vector3(0f, y, bottom + .04f), new Vector3(1.74f * k, .12f * k, .08f), Quaternion.identity);
            }
        }

        static void BuildLandingPortal(BuildContext context, VerticalModuleView view, Transform frame, PartMesh steelMesh,
            PartMesh glassMesh, float local, int side, float k, bool steel, float shaftHeight) {
            float y = side * LiftOuter * k;
            steelMesh.Box(new Vector3(0f, y - side * .04f * k, local + .035f), new Vector3(1.88f * k, .22f * k, .07f), Quaternion.identity);
            for (int s = -1; s <= 1; s += 2)
                steelMesh.Box(new Vector3(s * .79f * k, y, local + 1.16f), new Vector3(.18f * k, .16f * k, 2.32f), Quaternion.identity);
            steelMesh.Box(new Vector3(0f, y, local + 2.43f), new Vector3(1.74f * k, .16f * k, .22f), Quaternion.identity);
            float top = Mathf.Min(local + LiftStep, shaftHeight);
            if (top > local + LiftDoorwayHeight)
                glassMesh.Box(new Vector3(0f, y, (local + LiftDoorwayHeight + top) * .5f),
                    new Vector3(1.72f * k, .025f * k, top - local - LiftDoorwayHeight), Quaternion.identity);
            steelMesh.Box(new Vector3(.79f * k, y + side * .06f * k, local + 1.12f), new Vector3(.11f * k, .025f * k, .28f), Quaternion.identity);
        }

        static void BuildLiftLeaves(VerticalModuleView view, Transform parent, List<LiftLeaf> leaves, bool back, float k,
            Material material, float height, float zCenter, bool cabin) {
            // Leaf positions are authored in document axes inside a canonical lift
            // frame: width along doc x, thickness along doc y, height along doc z. The
            // frame is a Unity transform, so both the mesh and the local positions are
            // converted with the one document -> Unity mapping (x, z, y).
            float documentY = cabin ? (back ? .73f * k : -.73f * k) : 0f;
            float track = (back ? -1f : 1f) * .075f * k;
            var mesh = BoxMesh("lift door leaf", new Vector3(LiftPanelWidth * k, height, .035f * k));
            view.Meshes.Add(mesh);
            for (int sign = -1; sign <= 1; sign += 2) {
                for (int i = 0; i < 2; i++) {
                    float x = sign * (.18f + i * .36f) * k;
                    var leaf = NewMeshObject("lift-door-leaf", parent, mesh, material);
                    leaf.localPosition = new Vector3(x, zCenter, documentY + i * track);
                    leaf.localRotation = Quaternion.identity;
                    leaves.Add(new LiftLeaf { Transform = leaf, ClosedX = x, Sign = sign, Travel = i == 0 ? .5f : .14f });
                }
            }
        }

        static void BuildCabin(BuildContext context, VerticalModuleView view, Transform cabin, float k, bool anyBack, bool steel) {
            var body = new PartMesh(Vector3.zero);
            var glass = new PartMesh(Vector3.zero);
            body.Box(new Vector3(0f, 0f, .05f), new Vector3(1.5f * k, 1.5f * k, .1f), Quaternion.identity);
            body.Box(new Vector3(0f, 0f, .108f), new Vector3(1.36f * k, 1.36f * k, .015f), Quaternion.identity);
            body.Box(new Vector3(0f, 0f, 2.42f), new Vector3(1.54f * k, 1.54f * k, .12f), Quaternion.identity);
            body.Box(new Vector3(0f, 0f, 2.34f), new Vector3(.92f * k, .92f * k, .025f), Quaternion.identity);
            for (int s = -1; s <= 1; s += 2) {
                for (int t = -1; t <= 1; t += 2)
                    body.Box(new Vector3(s * .72f * k, t * .72f * k, 1.24f), new Vector3(.055f * k, .055f * k, 2.32f), Quaternion.identity);
                if (steel) {
                    body.Box(new Vector3(s * .72f * k, 0f, 1.3f), new Vector3(.025f * k, 1.38f * k, 2.12f), Quaternion.identity);
                } else {
                    glass.Box(new Vector3(s * .72f * k, 0f, 1.3f), new Vector3(.025f * k, 1.38f * k, 2.12f), Quaternion.identity);
                }
                body.Box(new Vector3(s * .72f * k, 0f, .2f), new Vector3(.055f * k, 1.44f * k, .2f), Quaternion.identity);
                body.Box(new Vector3(s * .9f * .72f * k, 0f, 1.02f), new Vector3(.035f * k, 1.16f * k, .035f), Quaternion.identity);
            }
            if (anyBack) {
                // the back face carries doors; no wall
            } else {
                if (steel) body.Box(new Vector3(0f, .72f * k, 1.3f), new Vector3(1.38f * k, .055f * k, 2.12f), Quaternion.identity);
                else glass.Box(new Vector3(0f, .72f * k, 1.3f), new Vector3(1.38f * k, .025f * k, 2.12f), Quaternion.identity);
                body.Box(new Vector3(0f, .72f * k, .2f), new Vector3(1.44f * k, .055f * k, .2f), Quaternion.identity);
            }
            view.Meshes.Add(body.Build(cabin, context.Material(PaletteSteel), "cabin-body"));
            if (glass.VertexCount > 0) view.Meshes.Add(glass.Build(cabin, context.Material(PaletteGlass), "cabin-glass"));
        }

        static Mesh BoxMesh(string name, Vector3 size) {
            var mesh = new Mesh { name = name };
            var verts = new List<Vector3>(24);
            var tris = new List<int>(36);
            BoxFaces.AppendAxisAligned(verts, tris, Vector3.zero, size);
            mesh.SetVertices(verts);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /* -------------------------------------------------------- geometry kit */

        sealed class BuildContext {
            public VerticalModuleRequest Request;
            public Transform Root;
            public VerticalModuleKind Kind;
            public int LevelMin, LevelMax;
            public Material Material(int palette) => Request.MaterialFor != null ? Request.MaterialFor(palette) : DefaultMaterial(palette);
        }

        sealed class PartMesh {
            readonly List<Vector3> vertices = new List<Vector3>();
            readonly List<int> triangles = new List<int>();
            readonly Vector3 pivot;
            public PartMesh(Vector3 pivotDocument) { pivot = pivotDocument; }
            public int VertexCount => vertices.Count;

            /// <summary>
            /// Append one document-axis box (centre/size/rotation in document axes). The edge
            /// vectors are mapped to Unity space before the faces are wound, so the
            /// document-to-Unity mirror (which swaps y and z) cannot invert a triangle — the
            /// old 8-vertex table ignored that mirror and produced bowtie quads (RCA 15 §3).
            /// </summary>
            public void Box(Vector3 centre, Vector3 size, Quaternion rotation) {
                BoxFaces.Append(vertices, triangles, Doc(centre - pivot),
                    Doc(rotation * new Vector3(size.x, 0f, 0f)),
                    Doc(rotation * new Vector3(0f, size.y, 0f)),
                    Doc(rotation * new Vector3(0f, 0f, size.z)));
            }

            public Mesh Build(Transform parent, Material material, string name) {
                var mesh = new Mesh { name = name };
                mesh.SetVertices(vertices);
                mesh.SetTriangles(triangles, 0);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                var go = NewMeshObject(name, parent, mesh, material);
                go.transform.localPosition = Vector3.zero;
                go.transform.localRotation = Quaternion.identity;
                return mesh;
            }
        }

        /* ------------------------------------------------------------- math */

        static Vector3 Doc(Vector3 document) => new Vector3(document.x, document.z, document.y);

        /// <summary>Rotate a document-axis vector counter-clockwise about the elevation axis.</summary>
        static Vector3 RotateDoc(float yawDegrees, Vector3 local) {
            float radians = yawDegrees * Mathf.Deg2Rad;
            float cos = Mathf.Cos(radians), sin = Mathf.Sin(radians);
            return new Vector3(local.x * cos - local.y * sin, local.x * sin + local.y * cos, local.z);
        }
        /// <summary>A Unity rotation whose local axes are the given document-axis basis (right-handed).</summary>
        static Quaternion RotationFromBasis(Vector3 x, Vector3 y, Vector3 z) {
            var matrix = new Matrix4x4();
            matrix.SetColumn(0, new Vector4(x.x, x.y, x.z, 0f));
            matrix.SetColumn(1, new Vector4(y.x, y.y, y.z, 0f));
            matrix.SetColumn(2, new Vector4(z.x, z.y, z.z, 0f));
            matrix.SetColumn(3, new Vector4(0f, 0f, 0f, 1f));
            return matrix.rotation;
        }

        internal static double Wrap(double value, double modulo) {
            if (modulo <= 0) return value;
            double wrapped = value % modulo;
            return wrapped < 0 ? wrapped + modulo : wrapped;
        }

        /// <summary>The clockwise plan quarter turn a saved stair rotation applies.</summary>
        static Vector2 RotateClockwise(int rotation, float x, float y) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: return new Vector2(y, -x);
                case 2: return new Vector2(-x, -y);
                case 3: return new Vector2(-y, x);
                default: return new Vector2(x, y);
            }
        }

        static (Vector3 x, Vector3 y, Vector3 z) RunBasis(BandRig band) {
            var t = (band.B - band.A).normalized;
            var side = Vector3.Cross(Vector3.up, t).normalized;
            var normal = Vector3.Cross(t, side).normalized;
            return (t, side, normal);
        }

        /* ---------------------------------------------------------- parsing */

        sealed class Config {
            readonly JObject root;
            public Config(JObject root) { this.root = root ?? new JObject(); }
            public string Text(string key) => root[key]?.Type == JTokenType.String ? (string)root[key] : "";
            public double Number(string key, double fallback) {
                var token = root[key];
                return token != null && (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) ? (double)token : fallback;
            }
            public bool Bool(string key, bool fallback = false) {
                var token = root[key];
                return token != null && token.Type == JTokenType.Boolean ? (bool)token : fallback;
            }
            public JObject Object(string key) => root[key] as JObject;
            public JToken Token(string key) => root[key];
        }

        static Config ParseConfig(string json) {
            if (string.IsNullOrEmpty(json)) return new Config(null);
            try { return new Config(JObject.Parse(json)); } catch { return new Config(null); }
        }

        sealed class StairFlight {
            public Vector3 From, To;
        }

        static List<StairFlight> ReadFlights(Config config, VerticalModuleRequest request) {
            var result = new List<StairFlight>();
            if (config.Token("flights") is JArray list) {
                foreach (var item in list) {
                    var from = item["from"];
                    var to = item["to"];
                    if (from == null || to == null) continue;
                    result.Add(new StairFlight {
                        From = new Vector3((float)from["x"], (float)from["y"], (float)from["z"]),
                        To = new Vector3((float)to["x"], (float)to["y"], (float)to["z"]),
                    });
                }
            }
            if (result.Count == 0 && request.HasEndpoints) {
                result.Add(new StairFlight {
                    From = new Vector3(request.FromX, request.FromY, request.FromZ),
                    To = new Vector3(request.ToX, request.ToY, request.ToZ),
                });
            }
            return result;
        }

        static float StairTreadWidth(bool straight, bool block, float width) {
            if (block) return width;
            bool narrow = Math.Abs(width - .68f) < 1e-6f;
            return straight && narrow ? 1f - 2f * StairRailProud : width;
        }

        static int StairRunBlocks(float width) => Mathf.Max(1, Mathf.Min(3, Mathf.RoundToInt(width + 2f * StairRailProud)));

        static bool StairOnBlockGrid(float width) => Math.Abs(width + 2f * StairRailProud - StairRunBlocks(width)) < 1e-6f;

        static List<Vector2> StairFlightSlides(List<StairFlight> flights, bool straight, bool block, float width, float treadWidth) {
            var slides = new List<Vector2>(flights.Count);
            for (int i = 0; i < flights.Count; i++) slides.Add(Vector2.zero);
            if (flights.Count == 0) return slides;
            if (flights.Count > 2) {
                float grid = StairOnBlockGrid(width) ? (StairRunBlocks(width) - 1) * .5f : 0f;
                for (int i = 0; i < flights.Count; i++) {
                    var delta = flights[i].To - flights[i].From;
                    float run = new Vector2(delta.x, delta.y).magnitude;
                    if (run < 1e-6f || grid == 0f) continue;
                    slides[i] = new Vector2(delta.y / run * grid, -delta.x / run * grid);
                }
                return slides;
            }
            if (flights.Count == 1) {
                float grid = StairOnBlockGrid(treadWidth) ? (StairRunBlocks(treadWidth) - 1) * .5f : 0f;
                if (grid == 0f) return slides;
                var delta = flights[0].To - flights[0].From;
                float run = new Vector2(delta.x, delta.y).magnitude;
                if (run < 1e-6f) return slides;
                slides[0] = new Vector2(delta.y / run * grid, -delta.x / run * grid);
                return slides;
            }
            var first = flights[0];
            var second = flights[1];
            var firstDelta = first.To - first.From;
            float firstRun = new Vector2(firstDelta.x, firstDelta.y).magnitude;
            if (firstRun < 1e-6f) return slides;
            float ux = firstDelta.x / firstRun;
            float uy = firstDelta.y / firstRun;
            float grid2 = StairOnBlockGrid(width) ? (StairRunBlocks(width) - 1) * .5f : 0f;
            var secondDelta = second.To - second.From;
            float dot = secondDelta.x * ux + secondDelta.y * uy;
            if (Math.Abs(dot) < 1e-6f) {
                float hand = secondDelta.x * uy - secondDelta.y * ux >= 0f ? 1f : -1f;
                slides[0] = new Vector2(uy * grid2 * hand, -ux * grid2 * hand);
                slides[1] = new Vector2(ux * grid2, uy * grid2);
                return slides;
            }
            float rx = second.From.x - first.From.x;
            float ry = second.From.y - first.From.y;
            float across = rx * -uy + ry * ux;
            float offset = Math.Abs(across);
            float slide = StairReturnSlide(offset, width);
            float side = across == 0f ? 0f : across > 0f ? -1f : 1f;
            slides[0] = new Vector2(uy * grid2, -ux * grid2);
            slides[1] = new Vector2(uy * grid2 - uy * side * slide, -ux * grid2 + ux * side * slide);
            return slides;
        }

        static float StairReturnSlide(float offset, float width) {
            float gap = width + 2f * StairRailProud;
            float step = offset - gap;
            float limit = Mathf.Max(0f, width * .5f - .25f);
            return Mathf.Max(0f, Mathf.Min(step, limit));
        }

        static Vector2Int StairWallSides(Func<int, int, int, bool> solid, Vector3 low, Vector3 high, float width, Vector2 slide) {
            var none = Vector2Int.zero;
            var delta = high - low;
            float run = new Vector2(delta.x, delta.y).magnitude;
            float rise = delta.z;
            if (run < 1e-6f || rise < 1e-3f) return none;
            float ux = delta.x / run, uy = delta.y / run;
            if (Math.Abs(Math.Abs(ux) + Math.Abs(uy) - 1f) > 1e-6f) return none;
            float half = width * .5f;
            float reach = half + StairRailProud;
            bool acrossX = ux == 0f;
            float right = acrossX ? uy : -ux;
            int probes = Mathf.Max(1, Mathf.RoundToInt(run));
            bool leftWall = true, rightWall = true;
            for (int i = 0; i < probes && (leftWall || rightWall); i++) {
                float cx = low.x + ux * i;
                float cy = low.y + uy * i;
                float along = acrossX ? cy : cx;
                int z = Mathf.FloorToInt(Mathf.Min(low.z + 1f + ((i + .5f) / run) * rise + 1e-9f, high.z));
                float centre = acrossX ? cx + .5f + slide.x : cy + .5f + slide.y;
                int lo = Mathf.CeilToInt(centre - half - .5f);
                int hi = Mathf.FloorToInt(centre + half - .5f);
                bool Probe(int side) {
                    float a = centre + side * right * half;
                    float b = centre + side * right * reach;
                    for (int k = Mathf.FloorToInt(Mathf.Min(a, b)); k <= Mathf.CeilToInt(Mathf.Max(a, b)) - 1; k++) {
                        if (k >= lo && k <= hi) continue;
                        if (!solid(acrossX ? k : (int)along, acrossX ? (int)along : k, z)) return false;
                    }
                    int outer = side * right > 0 ? hi + 1 : lo - 1;
                    return solid(acrossX ? outer : (int)along, acrossX ? (int)along : outer, z);
                }
                rightWall = rightWall && Probe(1);
                leftWall = leftWall && Probe(-1);
            }
            return new Vector2Int(leftWall ? 1 : 0, rightWall ? 1 : 0);
        }

        struct Shape { public double x0, y0, x1, y1, z; }

        static Shape LandingShape(List<StairFlight> flights, int index, float width) {
            var slides = StairFlightSlides(flights, false, false, width, width);
            var a = flights[index].To;
            var b = flights[index + 1].From;
            float ax = a.x + .5f + (index < slides.Count ? slides[index].x : 0f);
            float ay = a.y + .5f + (index < slides.Count ? slides[index].y : 0f);
            float bx = b.x + .5f + (index + 1 < slides.Count ? slides[index + 1].x : 0f);
            float by = b.y + .5f + (index + 1 < slides.Count ? slides[index + 1].y : 0f);
            float cx = (ax + bx) * .5f, cy = (ay + by) * .5f;
            bool acrossX = Math.Abs(a.x - b.x) > 1e-6f;
            bool acrossY = Math.Abs(a.y - b.y) > 1e-6f;
            bool corner = !acrossX && !acrossY;
            float sx = acrossX ? Math.Abs(bx - ax) + width : corner ? width : 1f;
            float sy = acrossY ? Math.Abs(by - ay) + width : corner ? width : 1f;
            return new Shape { x0 = cx - sx * .5f, y0 = cy - sy * .5f, x1 = cx + sx * .5f, y1 = cy + sy * .5f, z = a.z };
        }

        struct StairLandingWalls { public bool n, s, w, e; }

        static StairLandingWalls LandingWalls(List<StairFlight> flights, int index, Shape shape, Func<int, int, int, bool> solid) {
            int z = Mathf.FloorToInt((float)shape.z);
            var xs = new List<int>();
            for (int k = Mathf.FloorToInt((float)shape.x0); k < Mathf.CeilToInt((float)shape.x1); k++) xs.Add(k);
            var ys = new List<int>();
            for (int k = Mathf.FloorToInt((float)shape.y0); k < Mathf.CeilToInt((float)shape.y1); k++) ys.Add(k);
            int west = Mathf.FloorToInt((float)shape.x0 - 1f);
            int east = Mathf.CeilToInt((float)shape.x1);
            int south = Mathf.FloorToInt((float)shape.y0 - 1f);
            int north = Mathf.CeilToInt((float)shape.y1);
            bool everyX(int x) { for (int i = 0; i < ys.Count; i++) if (!solid(x, ys[i], z)) return false; return ys.Count > 0; }
            bool everyY(int y) { for (int i = 0; i < xs.Count; i++) if (!solid(xs[i], y, z)) return false; return xs.Count > 0; }
            return new StairLandingWalls { w = everyX(west), e = everyX(east), s = everyY(south), n = everyY(north) };
        }

        static bool WallOf(StairLandingWalls walls, string edge) {
            switch (edge) {
                case "n": return walls.n;
                case "s": return walls.s;
                case "w": return walls.w;
                case "e": return walls.e;
                default: return false;
            }
        }

        static void AttachEdge(HashSet<string> attached, Vector3 from, Vector3 to) {
            float dx = to.x - from.x, dy = to.y - from.y;
            attached.Add(Math.Abs(dx) >= Math.Abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "n" : "s"));
        }

        static BandRig BandGeometry(Vector3Int from, Vector3Int to, float inclineDegrees, float widthBlocks, bool escalator) {
            float dx = to.x - from.x, dy = to.y - from.y;
            float horizontal = new Vector2(dx, dy).magnitude;
            if (horizontal < 1e-6f) return null;
            float rise = to.z - from.z;
            float angle = Mathf.Abs(inclineDegrees) < 1e-6f ? 0f : inclineDegrees * Mathf.Deg2Rad;
            float inset = 0f;
            if (angle > 1e-6f && Math.Abs(rise) > 1e-6f) inset = Mathf.Max(0f, (horizontal - Math.Abs(rise) / Mathf.Tan(angle)) * .5f);
            // escalatorRun's centring shift: only a wide run moves across.
            float half = (widthBlocks - 1f) * .5f / horizontal;
            float shiftX = dy * half, shiftY = -dx * half;
            float ux = dx / horizontal, uy = dy / horizontal;
            float fromX = from.x + .5f + shiftX + ux * inset;
            float fromY = from.y + .5f + shiftY + uy * inset;
            float toX = to.x + .5f + shiftX - ux * inset;
            float toY = to.y + .5f + shiftY - uy * inset;
            var a = new Vector3(fromX, fromY, from.z + 1f);
            var b = new Vector3(toX, toY, to.z + 1f);
            float length = (b - a).magnitude;
            if (length < 1e-4f) return null;
            var t = (b - a) / length;
            bool ascends = to.z >= from.z;
            var lower = ascends ? a : b;
            var upper = ascends ? b : a;
            var climb = ascends ? t : -t;
            float runPerMetre = new Vector2(climb.x, climb.y).magnitude;
            if (runPerMetre < 1e-6f) return null;
            float flatLength = EscalatorFlatLength + inset;
            float flat = flatLength / runPerMetre;
            float chain = length + 2f * flat;
            int count = Mathf.Max(4, Mathf.RoundToInt(chain / EscalatorStepPitch));
            float pitch = chain / count;
            float stepRise = Mathf.Max(.05f, climb.z * pitch);
            float stepRun = Mathf.Max(.05f, runPerMetre * pitch);
            float bodyWidth = EscalatorBalustradeSpacing + (widthBlocks - 1f);
            float bandWidth = EscalatorBandBase + (widthBlocks - 1f) - 2f * EscalatorSkirtInset;
            float railWidth = bodyWidth - 2f * EscalatorSkirtInset;
            return new BandRig {
                A = a, B = b, Lower = lower, Upper = upper, Climb = climb,
                Length = length, InclineLength = length, RunPerMetre = runPerMetre, FlatLength = flatLength, Flat = flat,
                ChainLength = chain, Pitch = pitch, StepRise = stepRise, StepRun = stepRun, Count = count,
                InclineDegrees = inclineDegrees, WidthBlocks = widthBlocks, BodyWidth = bodyWidth,
                BandWidth = bandWidth, RailWidth = railWidth,
                AuthoredHorizontal = horizontal, AuthoredRise = Mathf.Abs(rise),
                YawDegrees = Mathf.Atan2(climb.y, climb.x) * Mathf.Rad2Deg,
                PrefabYawDegrees = Mathf.Atan2(-climb.y, climb.x) * Mathf.Rad2Deg,
                TravelSign = to.z >= from.z ? 1f : -1f,
            };
        }

        static Mesh BuildTreadMesh(BandRig band) {
            var mesh = new Mesh { name = "escalator tread" };
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            AppendRunBox(vertices, triangles, new Vector3(0f, 0f, -.03f), new Vector3(band.StepRun * 1.02f, band.BandWidth, .06f), Quaternion.identity);
            AppendRunBox(vertices, triangles, new Vector3(band.StepRun * .5f - .03f, 0f, -.01f), new Vector3(.06f, band.BandWidth, .08f), Quaternion.identity);
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildRiserMesh(BandRig band) {
            var mesh = new Mesh { name = "escalator riser" };
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            AppendRunBox(vertices, triangles, new Vector3(band.StepRun * .5f, 0f, band.StepRise * .5f), new Vector3(.05f, band.BandWidth, band.StepRise), Quaternion.identity);
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// <summary>
        /// Append a box authored in the run frame (x along the run, y across, z up) as Unity
        /// local vertices. As with <see cref="PartMesh.Box"/> the edges are mapped through the
        /// document-to-Unity mirror first and the winding is derived from the corners, so the
        /// escalator tread and riser faces are single-wound and flat (RCA 15 §3).
        /// </summary>
        static void AppendRunBox(List<Vector3> vertices, List<int> triangles, Vector3 centre, Vector3 size, Quaternion rotation) {
            BoxFaces.Append(vertices, triangles, Doc(centre),
                Doc(rotation * new Vector3(size.x, 0f, 0f)),
                Doc(rotation * new Vector3(0f, size.y, 0f)),
                Doc(rotation * new Vector3(0f, 0f, size.z)));
        }

        static Transform NewMeshObject(string name, Transform parent, Mesh mesh, Material material) {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(parent, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            return go.transform;
        }

        static Transform NewAnchor(Transform parent, string name, Vector3 documentPoint, Quaternion rotation) {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(StationCoordinates.Point(documentPoint), rotation);
            return go.transform;
        }

        static Transform FindBandNode(Transform root) {
            var transforms = root.GetComponentsInChildren<Transform>(true);
            for (int i = 0; i < transforms.Length; i++) {
                var candidate = transforms[i];
                int comb = 0, deck = 0;
                for (int c = 0; c < candidate.childCount; c++) {
                    var name = candidate.GetChild(c).name;
                    if (name.StartsWith("comb-plate", StringComparison.Ordinal)) comb++;
                    else if (name.StartsWith("landing-deck", StringComparison.Ordinal)) deck++;
                }
                if (comb >= 2 && deck >= 1) return candidate;
            }
            return null;
        }

        /* ------------------------------------------------------ lift helpers */

        static List<double> LiftStops(int fromZ, int toZ, List<double> rises) {
            var stops = new List<double> { fromZ };
            double z = fromZ;
            bool risesValid = rises.Count > 0;
            double sum = 0;
            for (int i = 0; i < rises.Count; i++) { if (rises[i] <= 0) risesValid = false; sum += rises[i]; }
            if (risesValid && Math.Abs(sum - (toZ - fromZ)) > 1e-6) risesValid = false;
            if (!risesValid) {
                rises = new List<double>();
                double left = toZ - fromZ;
                while (left > 1e-6) { double rise = Math.Min(LiftStep, left); rises.Add(rise); left -= rise; }
            }
            for (int i = 0; i < rises.Count; i++) {
                z += rises[i];
                if (z > toZ + 1e-6) break;
                stops.Add(z);
            }
            if (Math.Abs(stops[stops.Count - 1] - toZ) > 1e-6) stops.Add(toZ);
            return stops;
        }

        static List<int> LiftLevels(int fromZ, List<double> rises) {
            var levels = new List<int> { fromZ };
            int z = fromZ;
            for (int i = 0; i + 1 < rises.Count; i++) {
                z += (int)Math.Round(rises[i]);
                levels.Add(z);
            }
            return levels;
        }

        static bool ServesSide(JObject doors, int level, bool back) {
            if (doors == null) return !back;
            var token = doors[level.ToString(CultureInfo.InvariantCulture)];
            string side = token != null && token.Type == JTokenType.String ? (string)token : "front";
            if (side == "both") return true;
            if (side == "none") return false;
            return back ? side == "back" : side == "front";
        }

        static bool LandingFloor(Func<int, int, int, bool> solid, int x, int y, int size, int rotation, int level, bool back) {
            for (int lane = 0; lane < size; lane++) {
                var cell = LandingCell(x, y, size, rotation, level, back, lane);
                if (solid(cell.x, cell.y, level) && !solid(cell.x, cell.y, level + 1)) return true;
            }
            return false;
        }

        /// <summary>One landing-row cell (source <c>liftLandingRows</c>, one cell per plan column).</summary>
        static Vector2Int LandingCell(int x, int y, int size, int rotation, int level, bool back, int lane) {
            float half = size * .5f;
            float cx = x + half, cy = y + half;
            float front = back ? half + .5f : -(half + .5f);
            float i = lane - (size - 1) * .5f;
            var offset = RotateLocal(rotation, i, front);
            return new Vector2Int(Mathf.RoundToInt(cx + offset.x - .5f), Mathf.RoundToInt(cy + offset.y - .5f));
        }

        static Vector3 LandingAnchor(VerticalModuleRequest request, int size, int rotation, int level, bool back) {
            var cell = LandingCell(request.X, request.Y, size, rotation, level, back, 0);
            return new Vector3(cell.x + .5f, cell.y + .5f, level + 1f);
        }

        static Vector2 RotateLocal(int rotation, float i, float j) {
            switch (((rotation % 4) + 4) % 4) {
                case 1: return new Vector2(-j, i);
                case 2: return new Vector2(-i, -j);
                case 3: return new Vector2(j, -i);
                default: return new Vector2(i, j);
            }
        }

        static List<double> ReadNumbers(Config config, string key) {
            var result = new List<double>();
            var token = config.Token(key);
            if (token is JArray array) {
                foreach (var item in array) {
                    if (item.Type == JTokenType.Integer || item.Type == JTokenType.Float) result.Add((double)item);
                }
            }
            return result;
        }
    }

    /// <summary>
    /// The station-world renderer for stairs, escalators, walkways and lifts
    /// (<see cref="IStationViewRenderer"/>). It loops the committed document's four
    /// vertical types, resolves each through <c>ModuleViews.Resolve</c> /
    /// <c>RuntimeCatalogue</c>, builds the view with <see cref="VerticalModuleViews.TryBuild"/>
    /// and registers one record per module by stable id. Records it cannot build are
    /// reported, never replaced with a box.
    ///
    /// The host is expected to reuse renderer singletons across staged worlds (the old
    /// world's <c>Release()</c> runs after the new world's <c>Build()</c>), so every
    /// built view is owned by the <see cref="StationWorldView"/> that produced it and a
    /// release only drops worlds that are already disposed.
    ///
    /// The role is <c>vertical</c>: the lead's generic module renderer already claims
    /// <c>modules</c> and <see cref="StationRenderers"/> keeps one renderer per role.
    /// </summary>
    public sealed class VerticalModuleRenderer : IStationViewRenderer {
        public const string RoleName = "vertical";

        sealed class WorldState {
            public StationWorldView World;
            public readonly List<VerticalModuleView> Views = new List<VerticalModuleView>();
            public readonly Dictionary<string, VerticalModuleView> ById = new Dictionary<string, VerticalModuleView>(StringComparer.Ordinal);
            public Material[] Materials;
            public Func<int, Material> MaterialFor;
            public double ClockOrigin = double.NaN;

            public void EnsureMaterials(Shader shader) {
                if (shader == null || Materials != null) return;
                Materials = new Material[VerticalModuleViews.Palette.Length];
                for (int i = 0; i < Materials.Length; i++) {
                    Materials[i] = new Material(shader) { color = VerticalModuleViews.Palette[i], name = "Vertical " + i };
                }
                // Shaft, cabin, portal and balustrade glass all use the palette's glass slot;
                // the source renders them transparent (`PieceBuilder.glass`, opacity .26).
                if (Materials.Length > VerticalModuleViews.PaletteGlass) {
                    StationGlass.MakeTransparent(Materials[VerticalModuleViews.PaletteGlass], .26f);
                }
                MaterialFor = palette => Materials[Mathf.Clamp(palette, 0, Materials.Length - 1)];
            }

            public void Add(VerticalModuleView view) {
                Views.Add(view);
                ById[view.ModuleId] = view;
            }

            public void Reset() {
                for (int i = 0; i < Views.Count; i++) {
                    var view = Views[i];
                    if (view == null) continue;
                    if (view.Root) VerticalModuleViews.DestroyObject(view.Root.gameObject);
                    view.Dispose();
                }
                Views.Clear();
                ById.Clear();
                ClockOrigin = double.NaN;
            }

            public void Dispose() {
                Reset();
                if (Materials != null) {
                    for (int i = 0; i < Materials.Length; i++) VerticalModuleViews.DestroyObject(Materials[i]);
                    Materials = null;
                    MaterialFor = null;
                }
            }
        }

        readonly List<WorldState> worlds = new List<WorldState>();

        public string Role => RoleName;
        /// <summary>The most recently built world that is still live (for frame sinks and commands).</summary>
        public static VerticalModuleRenderer Current { get; private set; }
        public IReadOnlyList<VerticalModuleView> Views {
            get {
                var state = ActiveState();
                return state != null ? (IReadOnlyList<VerticalModuleView>)state.Views : Array.Empty<VerticalModuleView>();
            }
        }

        public void Build(StationViewBuildContext context) {
            if (context == null) throw new ArgumentNullException(nameof(context));
            DropDisposedWorlds();
            var state = StateOf(context.World);
            if (state == null) {
                state = new WorldState { World = context.World };
                worlds.Add(state);
            }
            state.Reset();
            state.EnsureMaterials(context.Shader);
            Current = this;
            var document = context.Document;
            if (document == null) return;
            var catalogue = context.Catalogue;
            var modules = document.Modules;
            var facts = new ModuleFacts[modules.Count];
            for (int i = 0; i < modules.Count; i++) facts[i] = modules[i].Facts;
            var solids = new HashSet<StationCellKey>();
            for (int i = 0; i < document.Cells.Count; i++) {
                var cell = document.Cells[i];
                if (cell.IsSolid) solids.Add(cell.Key);
            }
            Func<int, int, int, bool> solid = (x, y, z) => solids.Contains(new StationCellKey(x, y, z));
            var roleRoot = context.RoleRoot(RoleName);
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (module == null || !IsVerticalType(module.Type)) continue;
                GameObject prefab = null;
                string prefabKey = null;
                if (catalogue != null) {
                    var visual = ModuleViews.Resolve(module.Facts, facts, catalogue);
                    if (visual.HasModel && catalogue.TryGet(visual.Key, out var entry) && entry != null) {
                        prefab = entry.prefab;
                        prefabKey = visual.Key;
                    } else {
                        context.ReportUnresolved("vertical-key", module.Type, module.Id,
                            visual.Key.Length > 0 ? "catalogue entry missing: " + visual.Key : visual.Detail);
                    }
                }
                var request = VerticalModuleRequest.FromFacts(module.Facts, prefab, prefabKey, solid, state.MaterialFor);
                if (!VerticalModuleViews.TryBuild(request, roleRoot, out var view)) {
                    context.ReportUnresolved("vertical-build", module.Type, module.Id, "the authored record could not be built");
                    continue;
                }
                view.Root.name = module.Id;
                context.World.RegisterModule(RoleName, module.Id, view.Root.gameObject, "",
                    new StationBox(view.DocumentBounds.X0, view.DocumentBounds.Y0, view.DocumentBounds.Z0,
                        view.DocumentBounds.X1, view.DocumentBounds.Y1, view.DocumentBounds.Z1),
                    view.LevelMin, view.LevelMax);
                state.Add(view);
            }
        }

        /// <summary>Apply one module state to the matching view of the live world.</summary>
        public bool Apply(ModuleMotionState state) {
            var world = ActiveState();
            if (world == null || string.IsNullOrEmpty(state.ModuleId)) return false;
            return world.ById.TryGetValue(state.ModuleId, out var view) && view != null && view.Apply(state);
        }

        /// <summary>
        /// Drive every band from the station clock. Lifts stay parked (the source parks
        /// an uncalled car and packet C publishes no cabin height yet); use
        /// <see cref="Apply"/> with a lift snapshot to move a called car.
        /// </summary>
        public int ApplyAll(double simTimeSeconds, bool running) {
            var world = ActiveState();
            if (world == null) return 0;
            if (double.IsNaN(world.ClockOrigin)) world.ClockOrigin = simTimeSeconds;
            int applied = 0;
            for (int i = 0; i < world.Views.Count; i++) {
                var view = world.Views[i];
                if (view == null) continue;
                var state = new ModuleMotionState {
                    ModuleId = view.ModuleId, Seconds = simTimeSeconds, Running = running, DirectionSign = 1,
                    CabinFraction = float.NaN, DoorFraction = float.NaN, PhaseMeters = double.NaN, CabinHeight = double.NaN,
                };
                if (view.Band != null) {
                    // Accumulate from the load, exactly as `rollEscalator` does; the
                    // station clock may start at 06:30 rather than zero.
                    double metres = view.Band.TravelSign * VerticalModuleViews.EscalatorSpeed * (simTimeSeconds - world.ClockOrigin);
                    state.PhaseMeters = VerticalModuleViews.Wrap(metres, view.Band.ChainLength);
                } else if (view.Kind == VerticalModuleKind.Lift) {
                    state.CabinFraction = 0f;
                    state.DoorFraction = 0f;
                }
                if (view.Apply(state)) applied++;
            }
            return applied;
        }

        /// <summary>Drop the views and materials of one world (tests and explicit teardown).</summary>
        public void ReleaseWorld(StationWorldView world) {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                if (!ReferenceEquals(worlds[i].World, world)) continue;
                worlds[i].Dispose();
                worlds.RemoveAt(i);
            }
            if (worlds.Count == 0 && ReferenceEquals(Current, this)) Current = null;
        }

        public void Release() => DropDisposedWorlds();

        void DropDisposedWorlds() {
            for (int i = worlds.Count - 1; i >= 0; i--) {
                var state = worlds[i];
                if (state.World != null && !state.World.IsDisposed) continue;
                state.Dispose();
                worlds.RemoveAt(i);
            }
            if (worlds.Count == 0 && ReferenceEquals(Current, this)) Current = null;
        }

        WorldState StateOf(StationWorldView world) {
            for (int i = 0; i < worlds.Count; i++) if (ReferenceEquals(worlds[i].World, world)) return worlds[i];
            return null;
        }

        WorldState ActiveState() {
            for (int i = worlds.Count - 1; i >= 0; i--) if (worlds[i].World != null && !worlds[i].World.IsDisposed) return worlds[i];
            return null;
        }

        static bool IsVerticalType(string type) =>
            type == "stair" || type == "escalator" || type == "walkway" || type == "lift";
    }

    /// <summary>
    /// Per-frame half of the vertical family: the host ticks frame sinks with the
    /// committed station's presentation clock, so the bands roll continuously between
    /// 1 Hz simulation ticks instead of stepping once a second (RCA 14 §5.1). A paused
    /// clock is a frozen presentation instant, which holds the pose; lifts stay parked.
    /// </summary>
    sealed class VerticalFrameSink : IStationFrameSink {
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            var renderer = VerticalModuleRenderer.Current;
            if (renderer != null) renderer.ApplyAll(clock.PresentationSeconds, clock.Playing);
        }
    }

    /// <summary>Process-wide registration of the vertical renderer and its clock sink.</summary>
    public static class VerticalModuleFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => RegisterNow();

        /// <summary>Idempotent registration seam for an explicit host or a PlayMode test.</summary>
        public static void RegisterNow() {
            StationRenderers.Add(new VerticalModuleRenderer());
            StationFrameSinks.Add(new VerticalFrameSink());
        }
    }
}













