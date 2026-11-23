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
        /// <summary>Optional authored top-finish lookup for a piece that wears its floor's finish.</summary>
        public Func<int, int, int, string> CellFinish;
        /// <summary>Optional palette material source; null builds default URP materials.</summary>
        public Func<int, Material> MaterialFor;
        /// <summary>
        /// Optional station-finish material source. A 楼梯块 wears its saved `cfg.finish`, then
        /// the top finish of the block it stands on, then the documented default  the same
        /// order `StairBlockModel.build` reads. Null falls back to the palette.
        /// </summary>
        public Func<string, Material> FinishFor;
        /// <summary>Optional source facts for the module itself (used for shared run/lane helpers).</summary>
        public ModuleFacts Facts;
        /// <summary>Optional station module list for exit-landing lifts, stair lane mates and ramp joins.</summary>
        public IReadOnlyList<ModuleFacts> Neighbours;

        public static VerticalModuleRequest FromFacts(ModuleFacts facts, GameObject prefab = null, string prefabKey = null,
            Func<int, int, int, bool> solid = null, Func<int, Material> materialFor = null,
            Func<string, Material> finishFor = null, Func<int, int, int, string> cellFinish = null,
            IReadOnlyList<ModuleFacts> neighbours = null) {
            if (facts == null) throw new ArgumentNullException(nameof(facts));
            var request = new VerticalModuleRequest {
                ModuleId = facts.Id,
                Type = facts.Type,
                ConfigJson = ConfigJsonOf(facts.Config),
                X = facts.X, Y = facts.Y, Z = facts.Z,
                Rotation = facts.Rotation,
                Width = facts.Width, Depth = facts.Depth,
                Prefab = prefab, PrefabKey = prefabKey, Solid = solid, MaterialFor = materialFor,
                FinishFor = finishFor, CellFinish = cellFinish,
                Facts = facts, Neighbours = neighbours,
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
        /// <summary>0 bottom stop … 1 top stop. NaN samples the endpoint/dwell cycle from <see cref="Seconds"/>.</summary>
        public float CabinFraction;
        /// <summary>0 shut … 1 open. NaN samples the endpoint/dwell cycle from <see cref="Seconds"/>.</summary>
        public float DoorFraction;
        /// <summary>Optional escalator phase in metres; NaN derives it from Seconds × 0.5 m/s.</summary>
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
        public float AuthoredHorizontal, AuthoredRise, ExitLift, YawDegrees, PrefabYawDegrees, TravelSign;
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
        /// 0  an opaque box at the same plane is what enclosed the glass.
        /// </summary>
        public int OpaqueShaftSidePanels { get; internal set; }
        public double CabinFloorZ { get; internal set; }
        public float DoorFraction { get; internal set; }
        public int AlignedStop { get; internal set; } = -1;

        internal BandRig Band;
        internal LiftRig Lift;
        internal List<BandStep> Steps;
        internal bool BandDirty = true;
        internal double LastAppliedBandPhase = double.NaN;
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
    /// authored run is the family's canonical 9-cell / 5 m / 30° / narrow one — all
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
        public const int PaletteGlass = 10, PaletteSteel = 6, PaletteDark = 5, PaletteLight = 13, PaletteLine = 7, PaletteWarm = 8, PalettePlatform = 2, PaletteRed = 9, PaletteGreen = 12;

        /// <summary>The escalator family's authored reference run (Escalator.prefab).</summary>
        public const int CanonicalEscalatorRunCells = 9;
        public const float CanonicalEscalatorRise = 5f;
        public const float CanonicalEscalatorIncline = 30f;
        /// <summary>The straight-stair family's authored reference run (StairStraight.prefab).</summary>
        public const int CanonicalStairRunCells = 8;
        public const float CanonicalStairRise = 5f;
        public const float CanonicalStairTreadWidth = .79f;
        /// <summary>The promoted Lift.prefab is one 2 × 2 shaft with a single five-metre interval.</summary>
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

        internal static void ConfigurePaletteMaterial(Material material, int palette) {
            if (!material) return;
            if (palette == PaletteGlass) {
                if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", StationGlass.DefaultTint);
                if (material.HasProperty("_Color")) material.SetColor("_Color", StationGlass.DefaultTint);
                StationGlass.MakeTransparent(material, .26f);
                return;
            }
            if (palette == PaletteSteel) {
                if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", .72f);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .66f);
            } else if (palette == PaletteDark) {
                if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", .35f);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .45f);
            } else if (palette == PaletteWarm) {
                if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", .1f);
                if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", .6f);
            }
        }

        /// <summary>Fallback material for tests and a host with no palette (the shader is found once).</summary>
        public static Material DefaultMaterial(int palette) {
            palette = Mathf.Clamp(palette, 0, Palette.Length - 1);
            if (DefaultMaterials.TryGetValue(palette, out var existing) && existing) return existing;
            if (!defaultShader) defaultShader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            var material = palette == PaletteGlass
                ? StationGlass.Create(defaultShader, "Vertical " + palette, StationGlass.DefaultTint, .26f)
                : new Material(defaultShader) { color = Palette[palette], name = "Vertical " + palette };
            if (palette != PaletteGlass) ConfigurePaletteMaterial(material, palette);
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
        /// in the authored travel direction (<c>to − from</c>) at 0.5 m/s and wraps into
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
        /// only the landing the car is aligned with opens — a through-floor's other
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
        /// <c>max(1.5, |Δz| / 1.5)</c> seconds with a smoothstep, and reverses at the
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
            // Ping-pong visit order: 0 → … → n-1 → … → 1 (then back to 0).
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
            public bool JoinLeft, JoinRight;
            public bool OpenLeft, OpenRight;
            public int Steps;
            public float Run, Rise, TreadWidth;
            public Vector3 Origin;            // document position of the flight group
            public float YawDegrees;
            public int Index;
            public bool OuterLower, OuterUpper;
        }

        /// <summary>
        /// `StairBlockModel.build`  a 楼梯块 fills its one-cell footprint with **steps solid
        /// from the floor up**, each a full-width slab `rise / steps` high and `1 / steps` deep,
        /// ascending along the module's own local +x. Four treads fill a 1 m rise, two fill a
        /// 0.5 m one. The finish is the saved override, then the top finish of the block the
        /// stair stands on, then the documented default (`DEFAULT_MATERIAL`).
        ///
        /// The interior faces the source omits are omitted here too: the +x face of every step
        /// but the last is buried in the step above it, and the −z face is the floor.
        /// </summary>
        static bool BuildStairBlock(BuildContext context, VerticalModuleView view, Config config) {
            var request = context.Request;
            float rise = (float)config.Number("blockHeight", 1);
            if (rise <= 1e-4f) rise = 1f;
            // `rise === 0.5 ? 2 : 4`: the source's two authored block heights.
            int steps = Math.Abs(rise - .5f) < 1e-6f ? 2 : 4;
            float tread = 1f / steps;
            var pivot = new Vector3(request.X, request.Y, request.Z);
            view.PivotDocument = pivot;
            context.Root.localPosition = StationCoordinates.Point(pivot);
            context.Root.localRotation = Quaternion.identity;

            var frame = new GameObject("stair-block").transform;
            frame.SetParent(context.Root, false);
            frame.localPosition = StationCoordinates.Point(new Vector3(request.X + .5f, request.Y + .5f, request.Z + 1f)) -
                StationCoordinates.Point(pivot);
            frame.localRotation = ModulePlacement.Rotation(request.Rotation);

            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var uvs = new List<Vector2>();
            for (int i = 0; i < steps; i++) {
                float height = (i + 1) * rise / steps;
                // Unity local axes under the module's turn: (along the run, up, across).
                int start = triangles.Count;
                BoxFaces.AppendUv(vertices, triangles, uvs,
                    new Vector3(-.5f + (i + .5f) * tread, height * .5f, 0f),
                    new Vector3(tread, 0f, 0f), new Vector3(0f, height, 0f), new Vector3(0f, 0f, 1f));
                // Face order is +x, −x, +y, −y, +z, −z: the +x face only closes the last tread,
                // and the bottom is the floor the block stands on.
                if (i < steps - 1) triangles.RemoveRange(start, 6);
                triangles.RemoveRange(triangles.Count - 6, 6);
            }
            var mesh = new Mesh { name = "stair-block treads" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetUVs(0, uvs);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            NewMeshObject("treads", frame, mesh, StairBlockMaterial(context, config));
            view.Meshes.Add(mesh);
            view.Register("treads", frame, false);

            context.LevelMin = request.Z;
            context.LevelMax = request.Z + (int)Math.Ceiling(rise);
            return true;
        }

        /// <summary>
        /// The finish a 楼梯块 wears: `cfg.finish`, then its supporting block's top finish, then
        /// the documented default. A host with no finish library falls back to the palette's
        /// platform concrete, which is the same family and is named in the reject reason.
        /// </summary>
        static Material StairBlockMaterial(BuildContext context, Config config) {
            var request = context.Request;
            string finish = config.Text("finish");
            if (finish.Length == 0 && request.CellFinish != null)
                finish = request.CellFinish(request.X, request.Y, request.Z) ?? "";
            if (finish.Length == 0) finish = StationFinishIds.DefaultMaterial;
            if (request.FinishFor != null) {
                var material = request.FinishFor(finish);
                if (material) return material;
            }
            return request.MaterialFor != null ? request.MaterialFor(PalettePlatform) : DefaultMaterial(PalettePlatform);
        }

        /// <summary>Port of <c>stairSurface</c> (<c>StairModel.ts</c>): saved <c>cfg.finish</c>,
        /// then the authored cell finish at <c>mod.from</c>, then <c>DEFAULT_MATERIAL</c>.</summary>
        static Material StairSurfaceMaterial(BuildContext context, Config config) {
            var request = context.Request;
            string finish = config.Text("finish");
            if (finish.Length == 0 && request.CellFinish != null) {
                int fx = request.HasEndpoints ? request.FromX : request.X;
                int fy = request.HasEndpoints ? request.FromY : request.Y;
                int fz = request.HasEndpoints ? request.FromZ : request.Z;
                finish = request.CellFinish(fx, fy, fz) ?? "";
            }
            if (finish.Length == 0) finish = StationFinishIds.DefaultMaterial;
            if (request.FinishFor != null) {
                var material = request.FinishFor(finish);
                if (material) return material;
            }
            return context.Material(PaletteLight);
        }

        static bool BuildStair(BuildContext context, VerticalModuleView view) {
            var request = context.Request;
            var config = ParseConfig(request.ConfigJson);
            // Plan 22 §3: a 楼梯块 is a **solid** one-cell stair and is built before any
            // endpoint is read (`StairBlockModel.build`). The saved `from`/`to` of a block only
            // describe its one-metre step, so letting them through the flight path drew thin
            // treads, stringers, glass panels and handrails inside the cube.
            if (config.Bool("block")) return BuildStairBlock(context, view, config);
            var flights = ReadFlights(config, request);
            if (flights.Count == 0) return false;
            bool block = config.Bool("block");
            string style = config.Text("style") ?? "";
            bool straight = style.Length == 0 || style.StartsWith("straight", StringComparison.Ordinal);
            float savedWidth = (float)config.Number("width", .68f);
            float treadWidth = StairTreadWidth(flights.Count, block, savedWidth);
            var slides = StairFlightSlides(flights, style, savedWidth, treadWidth);
            var mates = request.Neighbours != null && request.Facts != null
                ? StationRampOpenings.StairLaneMates(request.Neighbours, request.Facts)
                : null;
            var outerA = request.HasEndpoints ? new Vector3(request.FromX, request.FromY, request.FromZ) : flights[0].From;
            var outerB = request.HasEndpoints ? new Vector3(request.ToX, request.ToY, request.ToZ) : flights[flights.Count - 1].To;
            bool IsOuter(Vector3 p) =>
                (Mathf.Abs(p.x - outerA.x) < 1e-4f && Mathf.Abs(p.y - outerA.y) < 1e-4f && Mathf.Abs(p.z - outerA.z) < 1e-4f) ||
                (Mathf.Abs(p.x - outerB.x) < 1e-4f && Mathf.Abs(p.y - outerB.y) < 1e-4f && Mathf.Abs(p.z - outerB.z) < 1e-4f);

            float maxExitLift = 0f;
            var specs = new List<StairFlightSpec>(flights.Count);
            for (int i = 0; i < flights.Count; i++) {
                var flight = flights[i];
                var lowerRaw = flight.From.z <= flight.To.z ? flight.From : flight.To;
                var upperRaw = flight.From.z <= flight.To.z ? flight.To : flight.From;
                float liftFrom = (float)StationRampOpenings.ExitLandingHeight(request.Neighbours, flight.From.x, flight.From.y, flight.From.z);
                float liftTo = (float)StationRampOpenings.ExitLandingHeight(request.Neighbours, flight.To.x, flight.To.y, flight.To.z);
                maxExitLift = Mathf.Max(maxExitLift, Mathf.Max(liftFrom, liftTo));
                var liftedFrom = new Vector3(flight.From.x, flight.From.y, flight.From.z + liftFrom);
                var liftedTo = new Vector3(flight.To.x, flight.To.y, flight.To.z + liftTo);
                bool rawFromIsLower = liftedFrom.z <= liftedTo.z;
                var lower = rawFromIsLower ? liftedFrom : liftedTo;
                var upper = rawFromIsLower ? liftedTo : liftedFrom;
                var lowerUnlifted = rawFromIsLower ? flight.From : flight.To;
                var upperUnlifted = rawFromIsLower ? flight.To : flight.From;
                var delta = upper - lower;
                float run = new Vector2(delta.x, delta.y).magnitude;
                float rise = delta.z;
                if (run < 1e-3f || Math.Abs(rise) < 1e-3f) continue;
                var slide = i < slides.Count ? slides[i] : Vector2.zero;
                var walls = request.Solid != null ? StairWallSides(request.Solid, lowerRaw, upperRaw, treadWidth, slide) : default(Vector2Int);
                bool joinLeft = false, joinRight = false, openLeft = false, openRight = false;
                if (mates != null && mates.Count > 0) {
                    float ux = delta.x / run, uy = delta.y / run;
                    for (int m = 0; m < mates.Count; m++) {
                        var mate = mates[m];
                        float cross = mate.StepX * -uy + mate.StepY * ux;
                        if (cross > 1e-4f) {
                            joinLeft = true;
                            if (mate.SameFlight) openLeft = true;
                        } else if (cross < -1e-4f) {
                            joinRight = true;
                            if (mate.SameFlight) openRight = true;
                        }
                    }
                }
                specs.Add(new StairFlightSpec {
                    From = liftedFrom, To = liftedTo, Slide = slide,
                    WallLeft = request.Solid != null && walls.x != 0,
                    WallRight = request.Solid != null && walls.y != 0,
                    JoinLeft = joinLeft, JoinRight = joinRight,
                    OpenLeft = openLeft, OpenRight = openRight,
                    Run = run, Rise = rise, TreadWidth = treadWidth,
                    Origin = new Vector3(lower.x + .5f + slide.x, lower.y + .5f + slide.y, lower.z + 1f),
                    YawDegrees = Mathf.Atan2(delta.y, delta.x) * Mathf.Rad2Deg,
                    Index = i,
                    Steps = Mathf.Max(2, Mathf.RoundToInt(Mathf.Abs(rise) / StairRiseTarget)),
                    OuterLower = IsOuter(lowerUnlifted),
                    OuterUpper = IsOuter(upperUnlifted),
                });
            }
            if (specs.Count == 0) return false;

            bool anyWall = false;
            for (int i = 0; i < specs.Count; i++) if (specs[i].WallLeft || specs[i].WallRight) anyWall = true;
            bool anyMate = mates != null && mates.Count > 0;
            bool anyExitLift = maxExitLift > 1e-4f;
            bool hasCustomFinish = config.Text("finish").Length > 0;

            // The promoted straight stair is an exact reference only when the authored
            // piece has the same one-flight run, no wall side, no lane mate and no exit lift.
            bool prefabExact = request.Prefab != null && straight && specs.Count == 1 &&
                string.Equals(request.PrefabKey ?? "stair-straight", "stair-straight", StringComparison.Ordinal) &&
                Math.Abs(specs[0].Run - CanonicalStairRunCells) < 1e-3f &&
                Math.Abs(specs[0].Rise - CanonicalStairRise) < 1e-3f &&
                Math.Abs(specs[0].TreadWidth - CanonicalStairTreadWidth) < 1e-3f &&
                !anyWall && !anyMate && !anyExitLift && !hasCustomFinish;
            if (request.Prefab != null && !prefabExact) {
                if (anyWall) view.PrefabRejectReason = "wall-sides";
                else if (anyMate) view.PrefabRejectReason = "lane-mates";
                else if (anyExitLift) view.PrefabRejectReason = "exit-landing";
                else if (hasCustomFinish) view.PrefabRejectReason = "finish";
                else view.PrefabRejectReason = "dimensions";
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
                context.LevelMin = Mathf.FloorToInt(Mathf.Min(flights[0].From.z, flights[0].To.z));
                context.LevelMax = Mathf.CeilToInt(Mathf.Max(flights[0].From.z, flights[0].To.z));
                return true;
            }

            var surfaceMaterial = StairSurfaceMaterial(context, config);
            pivot = new Vector3(request.X, request.Y, request.Z);
            view.PivotDocument = pivot;
            context.Root.localPosition = StationCoordinates.Point(pivot);
            context.Root.localRotation = Quaternion.identity;
            for (int i = 0; i < specs.Count; i++) BuildStairFlight(context, view, specs[i], surfaceMaterial, pivot);
            BuildStairLandings(context, view, flights, slides, style, savedWidth, treadWidth, surfaceMaterial, request, pivot);
            RegisterStairAnchors(view, specs, flights, pivot);
            view.RunLength = specs[0].Run;
            context.LevelMin = int.MaxValue; context.LevelMax = int.MinValue;
            for (int i = 0; i < flights.Count; i++) {
                context.LevelMin = Mathf.Min(context.LevelMin, Mathf.FloorToInt(Mathf.Min(flights[i].From.z, flights[i].To.z)));
                context.LevelMax = Mathf.Max(context.LevelMax, Mathf.CeilToInt(Mathf.Max(flights[i].From.z, flights[i].To.z)));
            }
            return true;
        }

        static void AppendFittedBeam(PartMesh target, float inner, float stairRun, float midX, float yCenter,
            float width, float zCenter, float thickness, float theta, bool outerLower, bool outerUpper) {
            float cosT = Mathf.Cos(theta), sinT = Mathf.Sin(theta), tanT = Mathf.Tan(theta);
            float slopeLen = Mathf.Sqrt(stairRun * stairRun + (stairRun * tanT) * (stairRun * tanT));
            float halfLen = (slopeLen - thickness * tanT) * .5f;
            float halfT = thickness * .5f;
            var lb = new Vector2(midX - halfLen * cosT + halfT * sinT, zCenter - halfLen * sinT - halfT * cosT);
            var ub = new Vector2(midX + halfLen * cosT + halfT * sinT, zCenter + halfLen * sinT - halfT * cosT);
            var ut = new Vector2(midX + halfLen * cosT - halfT * sinT, zCenter + halfLen * sinT + halfT * cosT);
            var lt = new Vector2(midX - halfLen * cosT - halfT * sinT, zCenter - halfLen * sinT + halfT * cosT);
            if (!outerLower) {
                lb = new Vector2(inner, lb.y + (inner - lb.x) * tanT);
                lt = new Vector2(inner, lt.y + (inner - lt.x) * tanT);
            }
            if (!outerUpper) {
                float endX = inner + stairRun;
                ub = new Vector2(endX, ub.y + (endX - ub.x) * tanT);
                ut = new Vector2(endX, ut.y + (endX - ut.x) * tanT);
            }
            target.ExtrudePolygonDoc(new[] { lb, ub, ut, lt },
                new Vector3(0f, yCenter - width * .5f, 0f),
                new Vector3(1f, 0f, 0f), new Vector3(0f, 0f, 1f), new Vector3(0f, 1f, 0f), width);
        }

        static void BuildStairFlight(BuildContext context, VerticalModuleView view, StairFlightSpec spec,
            Material surfaceMaterial, Vector3 pivot) {
            var frame = new GameObject("flight-" + spec.Index).transform;
            frame.SetParent(context.Root, false);
            frame.localPosition = StationCoordinates.Point(spec.Origin) - StationCoordinates.Point(pivot);
            frame.localRotation = Quaternion.Euler(0f, -spec.YawDegrees, 0f);
            view.Register("flight-" + spec.Index, frame, false);

            float half = spec.TreadWidth * .5f;
            float yLo = spec.JoinRight ? -.5f : -half;
            float yHi = spec.JoinLeft ? .5f : half;
            float yMid = (yLo + yHi) * .5f;
            float yWide = yHi - yLo;
            float inner = (float)StationRunGeometry.StairTreadTrim(spec.Run);
            float stairRun = spec.Run - inner * 2f;
            var treads = new PartMesh(Vector3.zero);
            if (stairRun < .2f || spec.Rise < 1e-3f) {
                float span = Mathf.Max(spec.Run, .5f);
                treads.Box(new Vector3(span * .5f, yMid, -StairTreadThickness * .5f),
                    new Vector3(span, yWide, StairTreadThickness), Quaternion.identity);
                view.Meshes.Add(treads.Build(frame, surfaceMaterial, "treads"));
                view.Register("treads-" + spec.Index, frame, false);
                return;
            }
            float steps = spec.Steps;
            float stepRise = spec.Rise / steps;
            float going = stairRun / steps;
            float theta = Mathf.Atan2(spec.Rise, stairRun);
            float slopeLength = Mathf.Sqrt(stairRun * stairRun + spec.Rise * spec.Rise);
            float underside = spec.Rise * .5f - StairBodyDrop;

            var risers = new PartMesh(Vector3.zero);
            var stringers = new PartMesh(Vector3.zero);
            var soffit = new PartMesh(Vector3.zero);
            var handrails = new PartMesh(Vector3.zero);
            var posts = new PartMesh(Vector3.zero);
            var glass = new PartMesh(Vector3.zero);
            var beamRotation = Quaternion.Euler(0f, -theta * Mathf.Rad2Deg, 0f);

            for (int i = 0; i < spec.Steps; i++) {
                treads.Box(new Vector3(inner + i * going + going * .5f, yMid, (i + 1) * stepRise - StairTreadThickness * .5f),
                    new Vector3(going + .002f, yWide, StairTreadThickness), Quaternion.identity);
                risers.Box(new Vector3(inner + i * going, yMid, i * stepRise + stepRise * .5f),
                    new Vector3(.05f, yWide, stepRise), Quaternion.identity);
            }
            float midX = inner + stairRun * .5f;
            float stringerZ = underside + StairStringerThickness / (2f * Mathf.Cos(theta));
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? 1f : -1f;
                bool open = sign > 0 ? spec.OpenLeft : spec.OpenRight;
                if (open) continue;
                bool walled = sign > 0 ? spec.WallLeft : spec.WallRight;
                string railName = (sign > 0 ? "handrail-left-" : "handrail-right-") + spec.Index;
                // The stringer keeps every non-open side, a walled one included, and extends vertically into interior landings.
                AppendFittedBeam(stringers, inner, stairRun, midX, sign * (half + .05f), .11f,
                    stringerZ, StairStringerThickness, theta, spec.OuterLower, spec.OuterUpper);
                if (walled) continue;
                float railY = sign * (half + .07f);
                handrails.Box(new Vector3(midX, railY, spec.Rise * .5f + StairRailHeight),
                    new Vector3(slopeLength, .07f, .07f), beamRotation);
                view.Register(railName, NewAnchor(context.Root, railName,
                    spec.Origin + RotateDoc(spec.YawDegrees, new Vector3(midX, railY, spec.Rise * .5f + StairRailHeight)), Quaternion.identity), false);
                for (int i = 0; i <= 2; i++) {
                    float u = inner + (i / 2f) * stairRun;
                    posts.Box(new Vector3(u, railY, ((u - inner) / stairRun) * spec.Rise + .47f),
                        new Vector3(.05f, .05f, .94f), Quaternion.identity);
                }
                for (int pane = 0; pane < 2; pane++) {
                    float x0 = inner + pane * stairRun * .5f + .03f;
                    float x1 = inner + (pane + 1) * stairRun * .5f - .03f;
                    float z0 = (x0 - inner) / stairRun * spec.Rise;
                    float z1 = (x1 - inner) / stairRun * spec.Rise;
                    float paneTop = StairRailHeight - .06f;
                    glass.ExtrudePolygonDoc(new[] {
                        new Vector2(x0, z0 + .09f), new Vector2(x1, z1 + .09f),
                        new Vector2(x1, z1 + paneTop), new Vector2(x0, z0 + paneTop),
                    }, new Vector3(0f, railY - .0125f, 0f),
                        new Vector3(1f, 0f, 0f), new Vector3(0f, 0f, 1f), new Vector3(0f, 1f, 0f), .025f);
                }
            }
            float sLo = yLo - (spec.JoinRight ? 0f : .03f);
            float sHi = yHi + (spec.JoinLeft ? 0f : .03f);
            AppendFittedBeam(soffit, inner, stairRun, midX, (sLo + sHi) * .5f, sHi - sLo,
                underside + StairSoffitThickness / (2f * Mathf.Cos(theta)), StairSoffitThickness, theta,
                spec.OuterLower, spec.OuterUpper);

            // Outer handrails level off, wrap a quarter-turn elbow and drop into a newel post
            // at the landings the piece owns (the module's two authored endpoints), with curved glass infill.
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? 1f : -1f;
                if ((sign > 0 ? spec.OpenLeft : spec.OpenRight) || (sign > 0 ? spec.WallLeft : spec.WallRight)) continue;
                float y = sign * (half + .07f);
                for (int end = 0; end < 2; end++) {
                    int o = end == 0 ? -1 : 1;
                    if (o < 0 ? !spec.OuterLower : !spec.OuterUpper) continue;
                    float xEnd = o < 0 ? inner : inner + stairRun;
                    float floor = o < 0 ? 0f : spec.Rise;
                    float zEnd = floor + StairRailHeight;
                    handrails.Box(new Vector3(xEnd + o * (StairLead * .5f - .02f), y, zEnd), new Vector3(StairLead, .07f, .07f), Quaternion.identity);
                    handrails.TorusArcDoc(new Vector3(xEnd + o * StairLead, y, zEnd - StairReturnRadius),
                        new Vector3(o, 0f, 0f), new Vector3(0f, 0f, 1f), new Vector3(0f, 1f, 0f),
                        StairReturnRadius, .035f, 0f, Mathf.PI * .5f, 12, 8);
                    float post = zEnd - StairReturnRadius - floor;
                    posts.Box(new Vector3(xEnd + o * (StairLead + StairReturnRadius), y, floor + post * .5f), new Vector3(.07f, .07f, post), Quaternion.identity);

                    float panelEnd = StairLead + StairReturnRadius - .04f;
                    var returnGlass = new List<Vector2>(12) {
                        new Vector2(xEnd + o * .03f, floor + .09f),
                        new Vector2(xEnd + o * panelEnd, floor + .09f),
                    };
                    for (int k = 8; k >= 0; k--) {
                        float u = StairLead + (panelEnd - StairLead) * (k / 8f);
                        float du = u - StairLead;
                        float h = StairRailHeight - StairReturnRadius
                            + Mathf.Sqrt(Mathf.Max(0f, StairReturnRadius * StairReturnRadius - du * du)) - .06f;
                        returnGlass.Add(new Vector2(xEnd + o * u, floor + h));
                    }
                    returnGlass.Add(new Vector2(xEnd + o * .03f, floor + StairRailHeight - .06f));
                    glass.ExtrudePolygonDoc(returnGlass, new Vector3(0f, y - .0125f, 0f),
                        new Vector3(1f, 0f, 0f), new Vector3(0f, 0f, 1f), new Vector3(0f, 1f, 0f), .025f);
                }
            }
            int paletteSteel = PaletteSteel, paletteDark = PaletteDark, paletteGlass = PaletteGlass;
            if (treads.VertexCount > 0) view.Meshes.Add(treads.Build(frame, surfaceMaterial, "treads"));
            if (risers.VertexCount > 0) view.Meshes.Add(risers.Build(frame, surfaceMaterial, "risers"));
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
                var point = spec.Origin + RotateDoc(spec.YawDegrees, new Vector3(u, yMid, (middle + 1) * stepRise));
                view.Register("tread-sample-" + spec.Index, NewAnchor(context.Root, "tread-sample-" + spec.Index, point, Quaternion.identity), false);
            }
        }

        static void BuildStairLandings(BuildContext context, VerticalModuleView view, List<StairFlight> flights,
            List<Vector2> slides, string style, float savedWidth, float treadWidth, Material surfaceMaterial,
            VerticalModuleRequest request, Vector3 pivot) {
            for (int i = 0; i + 1 < flights.Count; i++) {
                var a = flights[i].To;
                var shape = LandingShape(flights, slides, style, savedWidth, treadWidth, i);
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
                view.Meshes.Add(surface.Build(landing, surfaceMaterial, "landing-surface"));
                view.Meshes.Add(mesh.Build(landing, context.Material(PaletteDark), "landing-frame"));
                var landingWalls = request.Solid != null ? LandingWalls(flights, i, shape, request.Solid) : default(StairLandingWalls);
                var slideIn = i < slides.Count ? slides[i] : Vector2.zero;
                var slideOut = i + 1 < slides.Count ? slides[i + 1] : Vector2.zero;
                BuildLandingRails(context, view, landing, center, sizeX, sizeY, flights, i, landingWalls, treadWidth, slideIn, slideOut);
                view.Register("turn-landing", NewAnchor(context.Root, "turn-landing", center, Quaternion.identity), false);
            }
        }

        static void BuildLandingRails(BuildContext context, VerticalModuleView view, Transform landing, Vector3 center,
            float sizeX, float sizeY, List<StairFlight> flights, int index, StairLandingWalls walls,
            float treadWidth, Vector2 slideIn, Vector2 slideOut) {
            var fin = flights[index];
            var fout = flights[index + 1];
            var attached = new HashSet<string>();
            AttachEdge(attached, fin.To, fin.From);
            AttachEdge(attached, fout.From, fout.To);
            var rail = new PartMesh(center);
            var glass = new PartMesh(center);
            var steel = new PartMesh(center);
            float x0 = center.x - sizeX * .5f, x1 = center.x + sizeX * .5f;
            float y0 = center.y - sizeY * .5f, y1 = center.y + sizeY * .5f;
            float top = center.z;

            float RailLine(char axis, float edge) {
                float best = float.NaN;
                float bestDist = float.MaxValue;
                void Consider(StairFlight f, Vector2 s) {
                    float fFrom = axis == 'x' ? f.From.x : f.From.y;
                    float fTo = axis == 'x' ? f.To.x : f.To.y;
                    if (Mathf.Abs(fFrom - fTo) > 1e-6f) return;
                    float c = fFrom + .5f + (axis == 'x' ? s.x : s.y);
                    float c0 = c - treadWidth * .5f - .07f;
                    float c1 = c + treadWidth * .5f + .07f;
                    float d0 = Mathf.Abs(c0 - edge), d1 = Mathf.Abs(c1 - edge);
                    if (d0 < bestDist) { bestDist = d0; best = c0; }
                    if (d1 < bestDist) { bestDist = d1; best = c1; }
                }
                Consider(fin, slideIn);
                Consider(fout, slideOut);
                return !float.IsNaN(best) && bestDist < .22f ? best : edge;
            }

            float rx0 = RailLine('x', x0), rx1 = RailLine('x', x1);
            float ry0 = RailLine('y', y0), ry1 = RailLine('y', y1);

            void Rail(string edge, float? loOpt = null, float? hiOpt = null) {
                bool horizontal = edge == "s" || edge == "n";
                float start = loOpt ?? (horizontal ? rx0 : ry0);
                float end = hiOpt ?? (horizontal ? rx1 : ry1);
                float length = end - start;
                if (length <= .01f) return;
                float mid = (start + end) * .5f;
                if (horizontal) {
                    float y = edge == "s" ? ry0 : ry1;
                    rail.Box(new Vector3(mid, y, top + StairRailHeight), new Vector3(length, .06f, .06f), Quaternion.identity);
                    glass.Box(new Vector3(mid, y, top + StairRailHeight * .5f), new Vector3(Mathf.Max(.01f, length - .2f), .025f, StairRailHeight - .16f), Quaternion.identity);
                    foreach (float px in new[] { start + .07f, end - .07f })
                        steel.Box(new Vector3(px, y, top + StairRailHeight * .5f), new Vector3(.05f, .05f, StairRailHeight), Quaternion.identity);
                } else {
                    float x = edge == "w" ? rx0 : rx1;
                    rail.Box(new Vector3(x, mid, top + StairRailHeight), new Vector3(.06f, length, .06f), Quaternion.identity);
                    glass.Box(new Vector3(x, mid, top + StairRailHeight * .5f), new Vector3(.025f, Mathf.Max(.01f, length - .2f), StairRailHeight - .16f), Quaternion.identity);
                    foreach (float py in new[] { start + .07f, end - .07f })
                        steel.Box(new Vector3(x, py, top + StairRailHeight * .5f), new Vector3(.05f, .05f, StairRailHeight), Quaternion.identity);
                }
            }

            string[] edges = { "s", "n", "w", "e" };
            for (int i = 0; i < edges.Length; i++) {
                var edge = edges[i];
                if (WallOf(walls, edge)) continue;
                if (!attached.Contains(edge)) { Rail(edge); continue; }
                var incoming = fin.To - fin.From;
                var outgoing = fout.To - fout.From;
                if (incoming.x * outgoing.x + incoming.y * outgoing.y <= 0f) continue;
                // Forward offset flights attach to opposite halves; rail the exposed remainder.
                bool horizontal = edge == "s" || edge == "n";
                var a = fin.To;
                string incomingEdge = Mathf.Abs(fin.From.x - a.x) >= Mathf.Abs(fin.From.y - a.y)
                    ? (fin.From.x > a.x ? "e" : "w")
                    : (fin.From.y > a.y ? "n" : "s");
                var endPt = edge == incomingEdge ? fin.To : fout.From;
                var slide = edge == incomingEdge ? slideIn : slideOut;
                float centre = horizontal ? endPt.x + .5f + slide.x : endPt.y + .5f + slide.y;
                float lo = horizontal ? x0 : y0;
                float hi = horizontal ? x1 : y1;
                float openLo = centre - treadWidth * .5f;
                float openHi = centre + treadWidth * .5f;
                if (openLo - lo > .1f) Rail(edge, horizontal ? rx0 : ry0, openLo - .07f);
                if (hi - openHi > .1f) Rail(edge, openHi + .07f, horizontal ? rx1 : ry1);
            }
            if (rail.VertexCount > 0) view.Meshes.Add(rail.Build(landing, context.Material(PaletteDark), "landing-rails"));
            if (glass.VertexCount > 0) view.Meshes.Add(glass.Build(landing, context.Material(PaletteGlass), "landing-glass"));
            if (steel.VertexCount > 0) view.Meshes.Add(steel.Build(landing, context.Material(PaletteSteel), "landing-posts"));
        }

        static void RegisterStairAnchors(VerticalModuleView view, List<StairFlightSpec> specs, List<StairFlight> flights, Vector3 pivot) {
            view.PivotDocument = pivot;
            view.Register("pivot", NewAnchor(view.Root, "pivot", pivot, Quaternion.identity), false);
            var first = specs[0].From;
            var last = specs[specs.Count - 1].To;
            var low = first.z <= last.z ? first : last;
            var high = first.z <= last.z ? last : first;
            view.Register("lower-landing", NewAnchor(view.Root, "lower-landing",
                new Vector3(low.x + .5f, low.y + .5f, low.z + 1f), Quaternion.identity), false);
            view.Register("upper-landing", NewAnchor(view.Root, "upper-landing",
                new Vector3(high.x + .5f, high.y + .5f, high.z + 1f), Quaternion.identity), false);
        }

        /* ------------------------------------------------------- build: band */

        const float RampJoinThickness = .05f;
        const float RampJoinRailOverlap = .02f;
        const float RampJoinDomeRadius = .065f;
        const float RampJoinDomeSpacing = 1.5f;

        static bool BuildBand(BuildContext context, VerticalModuleView view) {
            var request = context.Request;
            var config = ParseConfig(request.ConfigJson);
            if (!request.HasEndpoints && !(request.ToX != 0 || request.ToY != 0 || request.ToZ != 0)) return false;
            var from = new Vector3Int(request.FromX, request.FromY, request.FromZ);
            var to = new Vector3Int(request.ToX, request.ToY, request.ToZ);
            bool escalator = request.Type == "escalator";
            float inclineDegrees = escalator ? (float)config.Number("incline", 30) : 0f;
            float widthBlocks = (float)config.Number("width", 1);
            var band = BandGeometry(from, to, inclineDegrees, widthBlocks, escalator, request.Neighbours);
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
                Math.Abs(band.WidthBlocks - 1f) < 1e-3f &&
                band.ExitLift < 1e-4f;
            if (request.Prefab != null && !prefabExact)
                view.PrefabRejectReason = band.ExitLift >= 1e-4f ? "exit-landing" : "dimensions";

            context.Root.localPosition = StationCoordinates.Point(band.Lower);
            context.Root.localRotation = Quaternion.identity;
            if (prefabExact) {
                BuildBandPrefab(context, view, band, request);
            } else {
                BuildBandDimensioned(context, view, band);
            }
            if (escalator && request.Neighbours != null && request.Facts != null) {
                BuildRampJoins(context, view, band);
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
            var treadMaterials = new[] { context.Material(PaletteSteel), context.Material(PaletteWarm) };
            var riserMaterial = context.Material(PaletteSteel);
            var group = new GameObject("band").transform;
            group.SetParent(instance.transform, false);
            view.Register("band", group, true);
            for (int i = 0; i < band.Count; i++) {
                var tread = NewMeshObject("tread-" + i, group, treadMesh, treadMaterials);
                var riser = NewMeshObject("riser-" + i, group, riserMesh, riserMaterial);
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
            var runRotation = RotationFromBasis(basis.x, basis.y, basis.z);

            var truss = new PartMesh(band.Lower);
            var undercroft = new PartMesh(band.Lower);
            var skirt = new PartMesh(band.Lower);
            var balustradeLeft = new PartMesh(band.Lower);
            var balustradeRight = new PartMesh(band.Lower);
            var handrail = new PartMesh(band.Lower);
            var comb = new PartMesh(band.Lower);
            var deck = new PartMesh(band.Lower);
            var indicatorSteel = new PartMesh(band.Lower);
            var indicatorDark = new PartMesh(band.Lower);
            var indicatorGreen = new PartMesh(band.Lower);
            var indicatorRed = new PartMesh(band.Lower);

            float cosT = new Vector2(basis.x.x, basis.x.y).magnitude;
            float sinT = basis.x.z;
            float trussOffset = EscalatorFlatLength * cosT - EscalatorTrussDepth * .5f;
            truss.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, 0f, -trussOffset),
                new Vector3(band.Length, band.BodyWidth, EscalatorTrussDepth), runRotation);

            var horizontal = new Vector3(band.Climb.x, band.Climb.y, 0f);
            if (horizontal.sqrMagnitude > 1e-9f) horizontal.Normalize();
            var docUp = new Vector3(0f, 0f, 1f);

            // Port of `undercroftSolid` (EscalatorModel.ts): dark-steel wedge over the 1 m course beneath the truss.
            if (sinT >= .05f && cosT >= .05f) {
                float slope = sinT / cosT;
                float flat = band.Length * cosT;
                float lidRise = band.Length * sinT - .5f;
                float foot = .5f / slope;
                float courseEnd = 1.5f / slope;
                float end = Mathf.Min(flat, lidRise <= 1f ? flat : .5f + Mathf.Ceil(courseEnd - .5f));
                float top = end * slope - .5f;
                if (top >= .05f && end >= foot + .05f) {
                    float insetWidth = band.BodyWidth - 2f * EscalatorSurfaceClearance;
                    undercroft.ExtrudePolygonDoc(new[] {
                        new Vector2(foot, -EscalatorBaseBury),
                        new Vector2(end, -EscalatorBaseBury),
                        new Vector2(end, top + EscalatorSurfaceClearance),
                        new Vector2(foot, EscalatorSurfaceClearance),
                    }, band.Lower - basis.y * (insetWidth * .5f), horizontal, docUp, basis.y, insetWidth);
                }
            }

            // Rounded stadium outline for each glass balustrade (0..len with radius 0.5 semicircular ends).
            var glassOutline = new List<Vector2>(38);
            const int arcSegs = 18;
            for (int k = 0; k <= arcSegs; k++) {
                float angle = -Mathf.PI * .5f + Mathf.PI * (k / (float)arcSegs);
                glassOutline.Add(new Vector2(band.Length + .5f * Mathf.Cos(angle), .5f + .5f * Mathf.Sin(angle)));
            }
            for (int k = 0; k <= arcSegs; k++) {
                float angle = Mathf.PI * .5f + Mathf.PI * (k / (float)arcSegs);
                glassOutline.Add(new Vector2(.5f * Mathf.Cos(angle), .5f + .5f * Mathf.Sin(angle)));
            }

            float skirtWidth = (band.BodyWidth - band.BandWidth) * .5f + .03f;
            for (int side = 0; side < 2; side++) {
                float sign = side == 0 ? -1f : 1f;
                float skirtY = sign * (band.BandWidth * .5f + skirtWidth * .5f);
                skirt.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, skirtY, 0f),
                    new Vector3(band.Length, skirtWidth, .62f), runRotation);
                // Balustrade-foot newel plates stay under the skirts so the step band wellway centre remains open.
                skirt.Box(band.Lower + runRotation * new Vector3(.05f, skirtY, -.02f),
                    new Vector3(.5f, skirtWidth, .06f), runRotation);
                skirt.Box(band.Lower + runRotation * new Vector3(band.Length - .05f, skirtY, -.02f),
                    new Vector3(.5f, skirtWidth, .06f), runRotation);

                var balTarget = sign > 0f ? balustradeLeft : balustradeRight;
                balTarget.ExtrudePolygonDoc(glassOutline,
                    band.Lower + basis.y * (sign * band.RailWidth * .5f - .015f),
                    basis.x, basis.z, basis.y, .03f);

                float railY = sign * (band.RailWidth * .5f + .03f);
                handrail.Box(band.Lower + runRotation * new Vector3(band.Length * .5f, railY, 1f),
                    new Vector3(band.Length, .1f, .08f), runRotation);
                handrail.TorusArcDoc(band.Lower + basis.x * band.Length + basis.y * railY + basis.z * .5f,
                    basis.x, basis.z, basis.y, .5f, .045f, -Mathf.PI * .5f, Mathf.PI, 18, 8);
                handrail.TorusArcDoc(band.Lower + basis.y * railY + basis.z * .5f,
                    basis.x, basis.z, basis.y, .5f, .045f, Mathf.PI * .5f, Mathf.PI, 18, 8);
            }

            // Upright newel indicator housings, bezels and direction symbols (`EscalatorIndicatorModel.ts`).
            var bezelOutline = new Vector2[20];
            for (int k = 0; k < bezelOutline.Length; k++) {
                float a = 2f * Mathf.PI * k / bezelOutline.Length;
                bezelOutline[k] = new Vector2(.052f * Mathf.Cos(a), .052f * Mathf.Sin(a));
            }
            var arrowOutline = new[] {
                new Vector2(-.011f, -.036f), new Vector2(.011f, -.036f), new Vector2(.011f, 0f),
                new Vector2(.033f, 0f), new Vector2(0f, .036f), new Vector2(-.033f, 0f), new Vector2(-.011f, 0f),
            };
            for (int endIdx = 0; endIdx < 2; endIdx++) {
                bool atLower = endIdx == 0;
                bool isEntry = atLower ? band.TravelSign >= 0f : band.TravelSign < 0f;
                Vector3 endBase = atLower ? band.Lower : band.Upper;
                Vector3 outward = atLower ? -horizontal : horizontal;
                Vector3 lightX = Vector3.Cross(docUp, outward).normalized;
                Quaternion lightRot = RotationFromBasis(lightX, docUp, outward);
                for (int side = 0; side < 2; side++) {
                    float sign = side == 0 ? -1f : 1f;
                    float railY = sign * (band.RailWidth * .5f + .03f);
                    Vector3 lightPos = endBase + basis.y * railY + basis.z * .5f + outward * .51f;
                    indicatorSteel.Box(lightPos, new Vector3(.15f, .19f, .07f), lightRot);
                    indicatorDark.ExtrudePolygonDoc(bezelOutline, lightPos + outward * .0325f, lightX, docUp, outward, .009f);
                    if (isEntry) {
                        indicatorGreen.ExtrudePolygonDoc(arrowOutline, lightPos + outward * .042f, lightX, docUp, outward, .002f);
                    } else {
                        indicatorRed.Box(lightPos + outward * .043f, new Vector3(.066f, .018f, .002f), lightRot);
                    }
                }
            }

            // Level comb plates and U-shaped landing decks (`EscalatorModel.ts` lines 309-340).
            var levelYaw = Quaternion.AngleAxis(band.YawDegrees, Vector3.forward);
            float plateLen = .3f;
            float halfW = band.WidthBlocks * .5f;
            float innerDeck = band.FlatLength - plateLen;
            var deckOutline = new[] {
                new Vector2(0f, -halfW),
                new Vector2(band.FlatLength, -halfW),
                new Vector2(band.FlatLength, halfW),
                new Vector2(0f, halfW),
                new Vector2(0f, band.BandWidth * .5f),
                new Vector2(innerDeck, band.BandWidth * .5f),
                new Vector2(innerDeck, -band.BandWidth * .5f),
                new Vector2(0f, -band.BandWidth * .5f),
            };
            for (int end = 0; end < 2; end++) {
                int dir = end == 0 ? -1 : 1;
                var endPoint = end == 0 ? band.Lower : band.Upper;
                var combPoint = endPoint + horizontal * (dir * (band.FlatLength - plateLen * .5f)) + new Vector3(0f, 0f, .045f);
                comb.Box(combPoint, new Vector3(plateLen, band.BandWidth, .05f), levelYaw);
                deck.ExtrudePolygonDoc(deckOutline,
                    endPoint + new Vector3(0f, 0f, EscalatorSurfaceClearance - .09f),
                    horizontal * dir, basis.y * dir, docUp, .09f);
            }

            view.Meshes.Add(truss.Build(runFrame, context.Material(PaletteDark), "truss"));
            if (undercroft.VertexCount > 0) view.Meshes.Add(undercroft.Build(runFrame, context.Material(PaletteDark), "undercroft"));
            view.Meshes.Add(skirt.Build(runFrame, context.Material(PaletteSteel), "skirt"));
            if (balustradeLeft.VertexCount > 0) view.Meshes.Add(balustradeLeft.Build(runFrame, context.Material(PaletteGlass), "balustrade-left"));
            if (balustradeRight.VertexCount > 0) view.Meshes.Add(balustradeRight.Build(runFrame, context.Material(PaletteGlass), "balustrade-right"));
            view.Meshes.Add(handrail.Build(runFrame, context.Material(PaletteDark), "handrail"));
            view.Meshes.Add(comb.Build(runFrame, context.Material(PaletteWarm), "comb-plate"));
            if (deck.VertexCount > 0) view.Meshes.Add(deck.Build(runFrame, context.Material(PaletteSteel), "landing-deck"));
            if (indicatorSteel.VertexCount > 0) view.Meshes.Add(indicatorSteel.Build(runFrame, context.Material(PaletteSteel), "escalator-indicator"));
            if (indicatorDark.VertexCount > 0) view.Meshes.Add(indicatorDark.Build(runFrame, context.Material(PaletteDark), "escalator-indicator-bezel"));
            if (indicatorGreen.VertexCount > 0) view.Meshes.Add(indicatorGreen.Build(runFrame, context.Material(PaletteGreen), "entry-arrow"));
            if (indicatorRed.VertexCount > 0) view.Meshes.Add(indicatorRed.Build(runFrame, context.Material(PaletteRed), "stop-bar"));
            view.Register("truss", runFrame, false);

            band.PrefabFrame = false;
            view.Steps = new List<BandStep>(band.Count);
            var treadMesh = BuildTreadMesh(band);
            var riserMesh = BuildRiserMesh(band);
            view.Meshes.Add(treadMesh);
            view.Meshes.Add(riserMesh);
            var treadMaterials = new[] { context.Material(PaletteSteel), context.Material(PaletteWarm) };
            var riserMaterial = context.Material(PaletteSteel);
            var group = new GameObject("band").transform;
            group.SetParent(context.Root, false);
            view.Register("band", group, true);
            for (int i = 0; i < band.Count; i++) {
                var tread = NewMeshObject("tread-" + i, group, treadMesh, treadMaterials);
                var riser = NewMeshObject("riser-" + i, group, riserMesh, riserMaterial);
                view.Steps.Add(new BandStep { Index = i, Tread = tread, Riser = riser });
                if (i == 0) view.Register("tread-0", tread, true);
                if (i == band.Count - 1) view.Register("tread-last", tread, true);
            }
        }

        static void RegisterBandAnchors(BuildContext context, VerticalModuleView view, BandRig band, Vector3Int from, Vector3Int to) {
            view.Register("pivot", NewAnchor(context.Root, "pivot", band.Lower, Quaternion.identity), false);
            bool lowerFirst = from.z != to.z ? from.z < to.z : (from.x != to.x ? from.x < to.x : from.y < to.y);
            var lowCell = lowerFirst ? from : to;
            var highCell = lowerFirst ? to : from;
            float lenPlan = new Vector2(highCell.x - lowCell.x, highCell.y - lowCell.y).magnitude;
            float halfShift = lenPlan > 1e-6f ? (band.WidthBlocks - 1f) * .5f / lenPlan : 0f;
            float shiftX = (highCell.y - lowCell.y) * halfShift;
            float shiftY = -(highCell.x - lowCell.x) * halfShift;
            float liftLow = (float)StationRampOpenings.ExitLandingHeight(context.Request.Neighbours, lowCell.x, lowCell.y, lowCell.z);
            float liftHigh = (float)StationRampOpenings.ExitLandingHeight(context.Request.Neighbours, highCell.x, highCell.y, highCell.z);
            view.Register("lower-landing", NewAnchor(context.Root, "lower-landing",
                new Vector3(lowCell.x + .5f + shiftX, lowCell.y + .5f + shiftY, lowCell.z + 1f + liftLow), Quaternion.identity), false);
            view.Register("upper-landing", NewAnchor(context.Root, "upper-landing",
                new Vector3(highCell.x + .5f + shiftX, highCell.y + .5f + shiftY, highCell.z + 1f + liftHigh), Quaternion.identity), false);
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

        /* ------------------------------------------------------- ramp joins */

        sealed class RampJoinRun {
            public ModuleFacts Mod;
            public Vector3 Lower, Upper, Axis, Across, Normal;
            public float Length, PlanHalf, RailHalf, Trim, RailHeight;
            public Func<int, bool> Blocked;
        }

        static RampJoinRun MakeJoinRun(IReadOnlyList<ModuleFacts> neighbours, ModuleFacts mod,
            StationRunPoint from, StationRunPoint to, float dx = 0f, float dy = 0f) {
            var low = from.Z <= to.Z ? from : to;
            var high = from.Z <= to.Z ? to : from;
            var lower = new Vector3((float)low.X + .5f + dx, (float)low.Y + .5f + dy,
                (float)(low.Z + 1.0 + StationRampOpenings.ExitLandingHeight(neighbours, low)));
            var upper = new Vector3((float)high.X + .5f + dx, (float)high.Y + .5f + dy,
                (float)(high.Z + 1.0 + StationRampOpenings.ExitLandingHeight(neighbours, high)));
            var axis = new Vector3(upper.x - lower.x, upper.y - lower.y, 0f);
            float length = axis.magnitude;
            if (length < .1f || high.Z <= low.Z || (Mathf.Abs(axis.x) > 1e-5f && Mathf.Abs(axis.y) > 1e-5f)) return null;
            axis /= length;
            var across = new Vector3(-axis.y, axis.x, 0f);
            var climb = (upper - lower).normalized;
            var normal = new Vector3(-axis.x * climb.z, -axis.y * climb.z, new Vector2(climb.x, climb.y).magnitude);
            if (mod.Type == "escalator") {
                return new RampJoinRun {
                    Mod = mod, Lower = lower, Upper = upper, Axis = axis, Across = across, Normal = normal,
                    Length = length, PlanHalf = StationRunGeometry.EscalatorWidth(mod) * .5f,
                    RailHalf = (float)StationRunGeometry.EscalatorBalustradeWidth(mod) * .5f + .03f,
                    Trim = 0f, RailHeight = 1f, Blocked = _ => false,
                };
            }
            if (mod.Type != "stair") return null;
            float width = (float)StationRunGeometry.StairTreadWidth(mod);
            return new RampJoinRun {
                Mod = mod, Lower = lower, Upper = upper, Axis = axis, Across = across, Normal = normal,
                Length = length, PlanHalf = Mathf.Max(.5f, width * .5f + StairRailProud),
                RailHalf = width * .5f + .07f, Trim = (float)StationRunGeometry.StairTreadTrim(length),
                RailHeight = StairRailHeight, Blocked = _ => false,
            };
        }

        static List<RampJoinRun> JoinRunsOf(BuildContext context, ModuleFacts mod) {
            var list = new List<RampJoinRun>(2);
            var neighbours = context.Request.Neighbours;
            if (mod.Type == "escalator") {
                StationRunGeometry.EscalatorRun(mod, out var fFrom, out var fTo);
                var r = MakeJoinRun(neighbours, mod, fFrom, fTo);
                if (r != null) list.Add(r);
                return list;
            }
            if (mod.Type != "stair" || mod.Config.Bool("block")) return list;
            var flights = StationRunGeometry.StairFlights(mod);
            var slides = StationRunGeometry.StairFlightSlides(mod, flights);
            float treadW = (float)StationRunGeometry.StairTreadWidth(mod);
            for (int i = 0; i < flights.Count; i++) {
                var f = flights[i];
                var slide = i < slides.Count ? slides[i] : default;
                var r = MakeJoinRun(neighbours, mod, f.From, f.To, (float)slide.X, (float)slide.Y);
                if (r == null) continue;
                var lowVec = f.From.Z <= f.To.Z
                    ? new Vector3((float)f.From.X, (float)f.From.Y, (float)f.From.Z)
                    : new Vector3((float)f.To.X, (float)f.To.Y, (float)f.To.Z);
                var highVec = f.From.Z <= f.To.Z
                    ? new Vector3((float)f.To.X, (float)f.To.Y, (float)f.To.Z)
                    : new Vector3((float)f.From.X, (float)f.From.Y, (float)f.From.Z);
                var slideVec = new Vector2((float)slide.X, (float)slide.Y);
                r.Blocked = checkSide => {
                    if (context.Request.Solid != null) {
                        var walls = StairWallSides(context.Request.Solid, lowVec, highVec, treadW, slideVec);
                        if (checkSide > 0 ? walls.x != 0 : walls.y != 0) return true;
                    }
                    var mates = StationRampOpenings.StairLaneMates(neighbours, mod);
                    for (int m = 0; m < mates.Count; m++) {
                        var mate = mates[m];
                        if (mate.SameFlight && Math.Sign(mate.StepX * r.Across.x + mate.StepY * r.Across.y) == checkSide) return true;
                    }
                    return false;
                };
                list.Add(r);
            }
            return list;
        }

        static (Vector3 a, Vector3 b) JoinRail(RampJoinRun r, int side) {
            var offset = r.Across * (side * r.RailHalf);
            if (r.Mod.Type == "escalator") {
                offset += r.Normal * r.RailHeight;
                return (r.Lower + offset, r.Upper + offset);
            }
            offset.z = r.RailHeight;
            return (r.Lower + offset + r.Axis * r.Trim, r.Upper + offset - r.Axis * r.Trim);
        }

        static Vector3 JoinRailAt((Vector3 a, Vector3 b) line, Vector3 axis, float u) {
            float a = Vector3.Dot(line.a, axis);
            float b = Vector3.Dot(line.b, axis);
            return Vector3.LerpUnclamped(line.a, line.b, (u - a) / (b - a));
        }

        static Vector3 JoinReturnPoint(RampJoinRun r, int side, int end, float t) {
            var p = (end < 0 ? r.Lower : r.Upper) + r.Across * (side * r.RailHalf);
            if (r.Mod.Type == "escalator") {
                float phi = Mathf.PI * t;
                var climb = (r.Upper - r.Lower).normalized;
                return p + r.Normal * (.5f * (1f + Mathf.Cos(phi))) + climb * (end * .5f * Mathf.Sin(phi));
            }
            p += r.Axis * (-end * r.Trim);
            if (t <= .2f) return p + r.Axis * (end * .34f * t / .2f) + new Vector3(0f, 0f, r.RailHeight);
            float q = Mathf.Min(1f, (t - .2f) / .35f) * Mathf.PI * .5f;
            p += r.Axis * (end * (.34f + .25f * Mathf.Sin(q)));
            p.z += t <= .55f
                ? r.RailHeight - .25f + .25f * Mathf.Cos(q)
                : (r.RailHeight - .25f) * (1f - (t - .55f) / .45f);
            return p;
        }

        static bool JoinSpanBlocked(BuildContext context, RampJoinRun own, RampJoinRun other, int side, float start, float end) {
            float inner = Vector3.Dot(own.Lower, own.Across) + side * own.PlanHalf;
            float outer = Vector3.Dot(other.Lower, own.Across) - side * other.PlanHalf;
            float minAcross = Mathf.Min(inner, outer), maxAcross = Mathf.Max(inner, outer);
            bool IntersectsBox(float x0, float y0, float z0, float x1, float y1, float z1) {
                float aMin = float.MaxValue, aMax = float.MinValue;
                float cMin = float.MaxValue, cMax = float.MinValue;
                for (int k = 0; k < 4; k++) {
                    var corner = new Vector3((k & 1) == 0 ? x0 : x1, (k & 2) == 0 ? y0 : y1, 0f);
                    float al = Vector3.Dot(corner, own.Axis);
                    float ac = Vector3.Dot(corner, own.Across);
                    if (al < aMin) aMin = al; if (al > aMax) aMax = al;
                    if (ac < cMin) cMin = ac; if (ac > cMax) cMax = ac;
                }
                float lo = Mathf.Max(start, aMin), hi = Mathf.Min(end, aMax);
                if (hi <= lo + .001f || cMax <= minAcross + .001f || cMin >= maxAcross - .001f) return false;
                float ownOriginAlong = Vector3.Dot(own.Lower, own.Axis);
                float hLo = own.Lower.z + (lo - ownOriginAlong) / own.Length * (own.Upper.z - own.Lower.z);
                float hHi = own.Lower.z + (hi - ownOriginAlong) / own.Length * (own.Upper.z - own.Lower.z);
                return z1 > hLo + .001f && z0 < hHi + own.RailHeight - .001f;
            }

            var neighbours = context.Request.Neighbours;
            if (neighbours != null) {
                for (int i = 0; i < neighbours.Count; i++) {
                    var m = neighbours[i];
                    if (m == null || m.Id == own.Mod.Id || m.Id == other.Mod.Id) continue;
                    if (m.Type == "escalator" || m.Type == "walkway") {
                        if (!m.From.HasValue || !m.To.HasValue) continue;
                        StationRunGeometry.EscalatorRun(m, out var rf, out var rt);
                        float half = (float)StationRunOpeningsCorridorHalf(m);
                        float x0 = Mathf.Min((float)rf.X, (float)rt.X) + .5f - half, x1 = Mathf.Max((float)rf.X, (float)rt.X) + .5f + half;
                        float y0 = Mathf.Min((float)rf.Y, (float)rt.Y) + .5f - half, y1 = Mathf.Max((float)rf.Y, (float)rt.Y) + .5f + half;
                        float z0 = Mathf.Min((float)rf.Z, (float)rt.Z) + 1f, z1 = Mathf.Max((float)rf.Z, (float)rt.Z) + 3.2f;
                        if (IntersectsBox(x0, y0, z0, x1, y1, z1)) return true;
                    } else if (m.Type == "stair" && !m.Config.Bool("block")) {
                        var fls = StationRunGeometry.StairFlights(m);
                        var sls = StationRunGeometry.StairFlightSlides(m, fls);
                        float half = (float)StationRampOpenings.RampCorridorHalf(m);
                        for (int f = 0; f < fls.Count; f++) {
                            var fl = fls[f]; var sl = f < sls.Count ? sls[f] : default;
                            float x0 = Mathf.Min((float)fl.From.X, (float)fl.To.X) + .5f + (float)sl.X - half;
                            float x1 = Mathf.Max((float)fl.From.X, (float)fl.To.X) + .5f + (float)sl.X + half;
                            float y0 = Mathf.Min((float)fl.From.Y, (float)fl.To.Y) + .5f + (float)sl.Y - half;
                            float y1 = Mathf.Max((float)fl.From.Y, (float)fl.To.Y) + .5f + (float)sl.Y + half;
                            float z0 = Mathf.Min((float)fl.From.Z, (float)fl.To.Z) + 1f;
                            float z1 = Mathf.Max((float)fl.From.Z, (float)fl.To.Z) + 2.3f;
                            if (IntersectsBox(x0, y0, z0, x1, y1, z1)) return true;
                        }
                    } else if (m.Type == "lift" && m.From.HasValue && m.To.HasValue) {
                        int sz = StationRunGeometry.LiftSize(m);
                        float z0 = Mathf.Min(m.From.Z, m.To.Z) + 1f, z1 = Mathf.Max(m.From.Z, m.To.Z) + 3.5f;
                        if (IntersectsBox(m.X, m.Y, z0, m.X + sz, m.Y + sz, z1)) return true;
                    }
                }
            }

            if (context.Request.Solid != null) {
                Vector3 p0 = own.Lower + own.Across * minAcross - own.Across * Vector3.Dot(own.Lower, own.Across);
                Vector3 p1 = own.Upper + own.Across * maxAcross - own.Across * Vector3.Dot(own.Upper, own.Across);
                int xMin = Mathf.FloorToInt(Mathf.Min(p0.x, p1.x)) - 1;
                int xMax = Mathf.CeilToInt(Mathf.Max(p0.x, p1.x)) + 1;
                int yMin = Mathf.FloorToInt(Mathf.Min(p0.y, p1.y)) - 1;
                int yMax = Mathf.CeilToInt(Mathf.Max(p0.y, p1.y)) + 1;
                int zMin = Mathf.FloorToInt(own.Lower.z) - 1;
                int zMax = Mathf.CeilToInt(own.Upper.z + own.RailHeight) + 1;
                for (int cx = xMin; cx <= xMax; cx++) {
                    for (int cy = yMin; cy <= yMax; cy++) {
                        for (int cz = zMin; cz <= zMax; cz++) {
                            if (!context.Request.Solid(cx, cy, cz)) continue;
                            if (!IntersectsBox(cx, cy, cz, cx + 1f, cy + 1f, cz + 1f)) continue;
                            bool shaft = !context.Request.Solid(cx, cy, cz - 1) && !context.Request.Solid(cx, cy, cz - 2);
                            if (!shaft) return true;
                        }
                    }
                }
            }
            return false;
        }

        static double StationRunOpeningsCorridorHalf(ModuleFacts m) => StationRampOpenings.RampCorridorHalf(m);

        static void AppendJoinBoard(PartMesh mesh, List<(Vector3 a, Vector3 b)> rows, bool verticalThickness) {
            if (rows.Count < 2) return;
            var centres = new Vector3[rows.Count];
            for (int i = 0; i < rows.Count; i++) centres[i] = (rows[i].a + rows[i].b) * .5f;
            var back = new (Vector3 a, Vector3 b)[rows.Count];
            for (int i = 0; i < rows.Count; i++) {
                var tangent = centres[Mathf.Min(i + 1, rows.Count - 1)] - centres[Mathf.Max(0, i - 1)];
                Vector3 shift;
                if (verticalThickness) {
                    shift = new Vector3(0f, 0f, -RampJoinThickness);
                } else {
                    var cross = Vector3.Cross(tangent, rows[i].b - rows[i].a);
                    shift = cross.sqrMagnitude > 1e-12f ? cross.normalized * -RampJoinThickness : new Vector3(0f, 0f, -RampJoinThickness);
                }
                back[i] = (rows[i].a + shift, rows[i].b + shift);
            }
            for (int i = 0; i + 1 < rows.Count; i++) {
                var (a, b) = rows[i]; var (c, d) = rows[i + 1];
                var (aa, bb) = back[i]; var (cc, dd) = back[i + 1];
                mesh.QuadThreeDoc(a, c, d, b);
                mesh.QuadThreeDoc(aa, bb, dd, cc);
                mesh.QuadThreeDoc(a, aa, cc, c);
                mesh.QuadThreeDoc(b, d, dd, bb);
            }
            mesh.QuadThreeDoc(rows[0].a, rows[0].b, back[0].b, back[0].a);
            int last = rows.Count - 1;
            mesh.QuadThreeDoc(rows[last].a, back[last].a, back[last].b, rows[last].b);
        }

        static void AppendStairJoinBoard(PartMesh mesh, List<(Vector3 a, Vector3 b)> rows,
            (Vector3 a, Vector3 b) first, (Vector3 a, Vector3 b) last, int side, RampJoinRun own) {
            Vector3 Get((Vector3 a, Vector3 b) r, int idx) => idx == 0 ? r.a : r.b;
            int nearIdx = side > 0 ? 0 : 1;
            int farIdx = 1 - nearIdx;
            var a = Get(first, nearIdx); var b = Get(last, nearIdx);
            var c = new Vector3(b.x, b.y, Get(last, farIdx).z - EscalatorSurfaceClearance);
            var d = new Vector3(a.x, a.y, Get(first, farIdx).z - EscalatorSurfaceClearance);
            a.z = Mathf.Max(a.z, d.z + .01f);
            b.z = Mathf.Max(b.z, c.z + .01f);
            var diff = Get(first, nearIdx) - Get(first, farIdx);
            diff.z = 0f;
            var inward = diff.normalized * RampJoinThickness;
            var front = side > 0 ? new[] { d, c, b, a } : new[] { a, b, c, d };
            var backArr = new Vector3[4];
            for (int i = 0; i < 4; i++) backArr[i] = front[i] + inward;
            mesh.QuadThreeDoc(front[0], front[1], front[2], front[3]);
            mesh.QuadThreeDoc(backArr[3], backArr[2], backArr[1], backArr[0]);
            for (int i = 0; i < 4; i++) {
                int j = (i + 1) % 4;
                mesh.QuadThreeDoc(front[i], backArr[i], backArr[j], front[j]);
            }

            var shelfRows = new List<(Vector3 a, Vector3 b)>(rows.Count);
            for (int i = 0; i < rows.Count; i++) {
                var r0 = rows[i].a; var r1 = rows[i].b;
                if (nearIdx == 0) r0.z = r1.z; else r1.z = r0.z;
                shelfRows.Add((r0, r1));
            }
            AppendJoinBoard(mesh, shelfRows, true);

            for (int endIdx = 0; endIdx < 2; endIdx++) {
                var row = endIdx == 0 ? shelfRows[0] : shelfRows[shelfRows.Count - 1];
                float floor = endIdx == 0 ? own.Lower.z : own.Upper.z;
                int endSign = endIdx == 0 ? -1 : 1;
                var topA = row.a - new Vector3(0f, 0f, EscalatorSurfaceClearance);
                var topB = row.b - new Vector3(0f, 0f, EscalatorSurfaceClearance);
                var botA = new Vector3(topA.x, topA.y, floor - EscalatorSurfaceClearance);
                var botB = new Vector3(topB.x, topB.y, floor - EscalatorSurfaceClearance);
                var face = endSign > 0 ? new[] { botA, botB, topB, topA } : new[] { topA, topB, botB, botA };
                var innerFace = new Vector3[4];
                for (int i = 0; i < 4; i++) innerFace[i] = face[i] + own.Axis * (-endSign * RampJoinThickness);
                mesh.QuadThreeDoc(face[0], face[1], face[2], face[3]);
                mesh.QuadThreeDoc(innerFace[3], innerFace[2], innerFace[1], innerFace[0]);
                for (int i = 0; i < 4; i++) {
                    int j = (i + 1) % 4;
                    mesh.QuadThreeDoc(face[i], innerFace[i], innerFace[j], face[j]);
                }
            }

            var stairStart = Get(shelfRows[0], farIdx) + own.Axis * EscalatorSurfaceClearance - new Vector3(0f, 0f, 2f * EscalatorSurfaceClearance);
            var stairEnd = Get(shelfRows[shelfRows.Count - 1], farIdx) - own.Axis * EscalatorSurfaceClearance - new Vector3(0f, 0f, 2f * EscalatorSurfaceClearance);
            var s2 = new Vector3(stairEnd.x, stairEnd.y, own.Upper.z - .15f);
            var s3 = new Vector3(stairStart.x, stairStart.y, own.Lower.z - .15f);
            var sideFace = side > 0 ? new[] { s3, s2, stairEnd, stairStart } : new[] { stairStart, stairEnd, s2, s3 };
            var sideBack = new Vector3[4];
            for (int i = 0; i < 4; i++) sideBack[i] = sideFace[i] + inward;
            mesh.QuadThreeDoc(sideFace[0], sideFace[1], sideFace[2], sideFace[3]);
            mesh.QuadThreeDoc(sideBack[3], sideBack[2], sideBack[1], sideBack[0]);
            for (int i = 0; i < 4; i++) {
                int j = (i + 1) % 4;
                mesh.QuadThreeDoc(sideFace[i], sideBack[i], sideBack[j], sideFace[j]);
            }
        }

        static void BuildRampJoins(BuildContext context, VerticalModuleView view, BandRig band) {
            var ownList = JoinRunsOf(context, context.Request.Facts);
            if (ownList.Count == 0) return;
            var own = ownList[0];
            var neighbours = context.Request.Neighbours;
            for (int nIdx = 0; nIdx < neighbours.Count; nIdx++) {
                var neighbour = neighbours[nIdx];
                if (neighbour == null || neighbour.Id == own.Mod.Id) continue;
                if (neighbour.Type != "escalator" && neighbour.Type != "stair" && neighbour.Type != "walkway") continue;
                if (neighbour.Type == "escalator" && string.CompareOrdinal(own.Mod.Id, neighbour.Id) > 0) continue;

                var otherRuns = JoinRunsOf(context, neighbour);
                for (int oIdx = 0; oIdx < otherRuns.Count; oIdx++) {
                    var other = otherRuns[oIdx];
                    if (Vector3.Dot(own.Axis, other.Axis) < .999f ||
                        Mathf.Abs(own.Lower.z - other.Lower.z) > .001f ||
                        Mathf.Abs(own.Upper.z - other.Upper.z) > .001f) continue;
                    var delta = other.Lower - own.Lower;
                    if (Mathf.Abs(Vector3.Dot(delta, own.Axis)) > .001f || Mathf.Abs(own.Length - other.Length) > .001f) continue;
                    float distance = Vector3.Dot(delta, own.Across);
                    float separation = Mathf.Abs(distance);
                    float spacing = separation - own.PlanHalf - other.PlanHalf;
                    float maxSpan = neighbour.Type == "escalator" ? 1f : 0f;
                    if (spacing < -.001f || spacing > maxSpan + .001f) continue;
                    int side = distance >= 0f ? 1 : -1;
                    if (other.Blocked(-side)) continue;

                    var first = JoinRail(own, side);
                    var second = JoinRail(other, -side);
                    float start = Mathf.Max(Vector3.Dot(first.a, own.Axis), Vector3.Dot(second.a, own.Axis));
                    float end = Mathf.Min(Vector3.Dot(first.b, own.Axis), Vector3.Dot(second.b, own.Axis));
                    if (end - start < .1f) continue;
                    float gap = separation - own.RailHalf - other.RailHalf;
                    if (gap <= .03f) continue;
                    if (spacing > .001f && JoinSpanBlocked(context, own, other, side, start, end)) continue;

                    Vector3 Near(float u) => JoinRailAt(first, own.Axis, u) + own.Across * (-side * RampJoinRailOverlap) + new Vector3(0f, 0f, -.04f - EscalatorSurfaceClearance);
                    Vector3 Far(float u) => JoinRailAt(second, own.Axis, u) + own.Across * (side * RampJoinRailOverlap) + new Vector3(0f, 0f, -.04f - EscalatorSurfaceClearance);
                    (Vector3 a, Vector3 b) Row(Vector3 p, Vector3 q) => side > 0 ? (p, q) : (q, p);

                    var rows = new List<(Vector3 a, Vector3 b)>(48);
                    void AppendRow((Vector3 a, Vector3 b) r) {
                        if (rows.Count > 0) {
                            var prev = rows[rows.Count - 1];
                            if (Vector3.Distance(prev.a, r.a) + Vector3.Distance(prev.b, r.b) <= 1e-6f) return;
                        }
                        rows.Add(r);
                    }
                    (Vector3 a, Vector3 b) Returned(int endSign, float t) {
                        var a = JoinReturnPoint(own, side, endSign, t) + own.Across * (-side * RampJoinRailOverlap);
                        var b = JoinReturnPoint(other, -side, endSign, t) + own.Across * (side * RampJoinRailOverlap);
                        a.z -= .04f + EscalatorSurfaceClearance;
                        b.z -= .04f + EscalatorSurfaceClearance;
                        return Row(a, b);
                    }

                    bool mixed = neighbour.Type == "stair";
                    if (!mixed) for (int i = 20; i >= 0; i--) AppendRow(Returned(-1, i / 20f));
                    var firstRow = Row(Near(start), Far(start));
                    var lastRow = Row(Near(end), Far(end));
                    AppendRow(firstRow);
                    AppendRow(lastRow);
                    if (!mixed) for (int i = 0; i <= 20; i++) AppendRow(Returned(1, i / 20f));

                    var joinMesh = new PartMesh(band.Lower);
                    if (mixed) AppendStairJoinBoard(joinMesh, rows, firstRow, lastRow, side, own);
                    else AppendJoinBoard(joinMesh, rows, false);
                    if (joinMesh.VertexCount > 0) {
                        view.Meshes.Add(joinMesh.Build(context.Root, context.Material(PaletteSteel), "ramp-join"));
                        var joinNode = context.Root.Find("ramp-join");
                        if (joinNode) view.Register("ramp-join", joinNode, false);
                    }

                    if (mixed) {
                        // The facing escalator balustrade becomes a metal side panel (`RampJoinModel.ts` line 350).
                        string targetBalustrade = side > 0 ? "balustrade-left" : "balustrade-right";
                        var renders = context.Root.GetComponentsInChildren<MeshRenderer>(true);
                        for (int r = 0; r < renders.Length; r++) {
                            if (renders[r] && renders[r].name == targetBalustrade)
                                renders[r].sharedMaterial = context.Material(PaletteSteel);
                        }
                        if (side > 0) { firstRow.a.z = firstRow.b.z; lastRow.a.z = lastRow.b.z; }
                        else { firstRow.b.z = firstRow.a.z; lastRow.b.z = lastRow.a.z; }
                    }

                    var centreStart = (firstRow.a + firstRow.b) * .5f;
                    var centreEnd = (lastRow.a + lastRow.b) * .5f;
                    int domeCount = Mathf.Max(1, Mathf.FloorToInt(Vector3.Distance(centreStart, centreEnd) / RampJoinDomeSpacing));
                    bool twoColumn = spacing > .001f && !mixed;
                    float[] columns = twoColumn ? new[] { .25f, .75f } : new[] { .5f };
                    float radius = RampJoinDomeRadius * (twoColumn ? 2f : 1f);
                    var domeMesh = new PartMesh(band.Lower);
                    for (int i = 0; i < domeCount; i++) {
                        float t = (i + .5f) / domeCount;
                        var (a, b) = firstRow; var (c, d) = lastRow;
                        var domeNormal = (t >= .5f ? Vector3.Cross(c - a, d - a) : Vector3.Cross(d - a, b - a)).normalized;
                        for (int col = 0; col < columns.Length; col++) {
                            float acrossCol = columns[col];
                            Vector3 centre = twoColumn
                                ? Vector3.Lerp(Vector3.Lerp(a, c, t), Vector3.Lerp(b, d, t), acrossCol)
                                : (t >= .5f
                                    ? a * (1f - t) + c * (t - .5f) + d * .5f
                                    : a * .5f + d * t + b * (.5f - t));
                            domeMesh.HemisphereDoc(centre, domeNormal, radius, 16, 8);
                        }
                    }
                    if (domeMesh.VertexCount > 0) {
                        view.Meshes.Add(domeMesh.Build(context.Root, context.Material(PaletteSteel), "ramp-join-dome"));
                    }
                }
            }
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
            int size = Math.Abs(config.Number("size", 2) - 3) < 1e-6 ||
                string.Equals(config.Text("size"), "large", StringComparison.Ordinal) ? 3 : 2;
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
            if (!steel) {
                for (float bottom = 0f; bottom < height; bottom += 2f) {
                    float top = Mathf.Min(bottom + 2f, height);
                    float middle = (bottom + top) * .5f;
                    for (int s = -1; s <= 1; s += 2) {
                        shaftGlass.Box(new Vector3(s * outer, 0f, middle), new Vector3(.025f * k, 1.72f * k, top - bottom - .08f), Quaternion.identity);
                        shaft.Box(new Vector3(s * outer, 0f, bottom + .04f), new Vector3(.12f * k, 1.74f * k, .08f), Quaternion.identity);
                    }
                }
            }
            for (int i = 0; i + 1 < stops.Count; i++) {
                float local = (float)(stops[i] - fromZ);
                float top = (float)(stops[i + 1] - fromZ);
                float loFront = frontServed[i] ? Mathf.Max(local, local + LiftDoorwayHeight) : local;
                float loBack = backServed[i] ? Mathf.Max(local, local + LiftDoorwayHeight) : local;
                if (steel) {
                    if (top - loFront > .1f)
                        shaft.Box(new Vector3(0f, -outer, (loFront + top) * .5f), new Vector3(1.74f * k, .12f * k, top - loFront), Quaternion.identity);
                    if (top - loBack > .1f)
                        shaft.Box(new Vector3(0f, outer, (loBack + top) * .5f), new Vector3(1.74f * k, .12f * k, top - loBack), Quaternion.identity);
                } else {
                    StoryGlass(shaftGlass, shaft, -outer, loFront, top, k);
                    StoryGlass(shaftGlass, shaft, outer, loBack, top, k);
                }
            }
            for (int s = -1; s <= 1; s += 2) {
                // The glass housing has **no** full-height side wall: its side faces are the
                // glazed panel bays above (`shaftGlass`), exactly like `buildGlassLift`. The
                // old branch put a 0.12 m steel box at the same `s * outer` plane, enclosing
                // the 0.025 m pane, so a glazed lift read as an opaque shaft. The steel style
                // keeps its solid side walls and omits glazed walls across its full height.
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
                if (frontServed[i]) {
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
            if (shaftGlass.VertexCount > 0) view.Meshes.Add(shaftGlass.Build(frame, context.Material(PaletteGlass), "shaft-glass"));
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
            if (!steel && top > local + LiftDoorwayHeight)
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
            readonly List<Vector2> uvs = new List<Vector2>();
            readonly Vector3 pivot;
            public PartMesh(Vector3 pivotDocument) { pivot = pivotDocument; }
            public int VertexCount => vertices.Count;

            /// <summary>
            /// Append one document-axis box (centre/size/rotation in document axes). The edge
            /// vectors are mapped to Unity space before the faces are wound, so the
            /// document-to-Unity mirror (which swaps y and z) cannot invert a triangle  the
            /// old 8-vertex table ignored that mirror and produced bowtie quads (RCA 15 §3).
            /// </summary>
            public void Box(Vector3 centre, Vector3 size, Quaternion rotation) {
                BoxFaces.AppendUv(vertices, triangles, uvs, Doc(centre - pivot),
                    Doc(rotation * new Vector3(size.x, 0f, 0f)),
                    Doc(rotation * new Vector3(0f, size.y, 0f)),
                    Doc(rotation * new Vector3(0f, 0f, size.z)));
            }

            public void TriDoc(Vector3 a, Vector3 b, Vector3 c, Vector3 outwardDoc,
                Vector2 uvA = default, Vector2 uvB = default, Vector2 uvC = default, bool hasUv = false) {
                var pa = Doc(a - pivot);
                var pb = Doc(b - pivot);
                var pc = Doc(c - pivot);
                var cross = Vector3.Cross(pb - pa, pc - pa);
                if (cross.sqrMagnitude < 1e-16f) return;
                bool flip = Vector3.Dot(cross, Doc(outwardDoc)) < 0f;
                int start = vertices.Count;
                vertices.Add(pa);
                vertices.Add(pb);
                vertices.Add(pc);
                if (hasUv) {
                    uvs.Add(uvA);
                    uvs.Add(uvB);
                    uvs.Add(uvC);
                } else {
                    uvs.Add(new Vector2(a.x + a.y, a.z));
                    uvs.Add(new Vector2(b.x + b.y, b.z));
                    uvs.Add(new Vector2(c.x + c.y, c.z));
                }
                if (flip) {
                    triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 1);
                } else {
                    triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                }
            }

            public void QuadDoc(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 outwardDoc) {
                float uLen = Vector3.Distance(a, b);
                float vLen = Vector3.Distance(a, d);
                TriDoc(a, b, c, outwardDoc, new Vector2(0f, 0f), new Vector2(uLen, 0f), new Vector2(uLen, vLen), true);
                TriDoc(a, c, d, outwardDoc, new Vector2(0f, 0f), new Vector2(uLen, vLen), new Vector2(0f, vLen), true);
            }

            /// <summary>Append a triangle authored with right-handed Three.js CCW winding in document axes.</summary>
            public void TriThreeDoc(Vector3 a, Vector3 b, Vector3 c) {
                var nDoc = Vector3.Cross(b - a, c - a);
                if (nDoc.sqrMagnitude < 1e-16f) return;
                TriDoc(a, b, c, nDoc);
            }

            /// <summary>Append a quad authored with right-handed Three.js CCW winding in document axes.</summary>
            public void QuadThreeDoc(Vector3 a, Vector3 b, Vector3 c, Vector3 d) {
                TriThreeDoc(a, b, c);
                TriThreeDoc(a, c, d);
            }

            /// <summary>Extrude a 2D simple polygon along <paramref name="wAxisDoc"/> by <paramref name="depth"/>.</summary>
            public void ExtrudePolygonDoc(IReadOnlyList<Vector2> poly, Vector3 originDoc,
                Vector3 uAxisDoc, Vector3 vAxisDoc, Vector3 wAxisDoc, float depth) {
                if (poly == null || poly.Count < 3 || Mathf.Abs(depth) < 1e-6f) return;
                if (depth < 0f) {
                    originDoc += wAxisDoc * depth;
                    depth = -depth;
                }
                var pts = new List<Vector2>(poly.Count);
                for (int i = 0; i < poly.Count; i++) {
                    var p = poly[i];
                    if (pts.Count == 0 || (pts[pts.Count - 1] - p).sqrMagnitude > 1e-12f) pts.Add(p);
                }
                while (pts.Count > 1 && (pts[pts.Count - 1] - pts[0]).sqrMagnitude <= 1e-12f) pts.RemoveAt(pts.Count - 1);
                if (pts.Count < 3) return;

                float area2 = 0f;
                for (int i = 0; i < pts.Count; i++) {
                    var p = pts[i];
                    var q = pts[(i + 1) % pts.Count];
                    area2 += p.x * q.y - q.x * p.y;
                }
                if (Mathf.Abs(area2) < 1e-12f) return;
                if (area2 < 0f) pts.Reverse();

                Vector3 Back(Vector2 p) => originDoc + uAxisDoc * p.x + vAxisDoc * p.y;
                Vector3 Front(Vector2 p) => originDoc + uAxisDoc * p.x + vAxisDoc * p.y + wAxisDoc * depth;

                // Perimeter walls: each edge keeps its own flat normal.
                for (int i = 0; i < pts.Count; i++) {
                    var p = pts[i];
                    var q = pts[(i + 1) % pts.Count];
                    float du = q.x - p.x, dv = q.y - p.y;
                    if (du * du + dv * dv < 1e-12f) continue;
                    var wallOut = uAxisDoc * dv - vAxisDoc * du;
                    QuadDoc(Back(p), Back(q), Front(q), Front(p), wallOut);
                }

                // 2D ear-clipping triangulation for front and back caps.
                var idx = new List<int>(pts.Count);
                for (int i = 0; i < pts.Count; i++) idx.Add(i);
                int guard = idx.Count * idx.Count + 8;
                while (idx.Count > 3 && guard-- > 0) {
                    int earPos = -1;
                    for (int pass = 0; pass < 2 && earPos < 0; pass++) {
                        for (int k = 0; k < idx.Count; k++) {
                            int ia = idx[(k + idx.Count - 1) % idx.Count];
                            int ib = idx[k];
                            int ic = idx[(k + 1) % idx.Count];
                            var a2 = pts[ia]; var b2 = pts[ib]; var c2 = pts[ic];
                            float cross = (b2.x - a2.x) * (c2.y - a2.y) - (b2.y - a2.y) * (c2.x - a2.x);
                            if (pass == 0 ? cross <= 1e-8f : cross < -1e-8f) continue;
                            if (pass == 0) {
                                bool inside = false;
                                for (int m = 0; m < idx.Count; m++) {
                                    int id = idx[m];
                                    if (id == ia || id == ib || id == ic) continue;
                                    var p = pts[id];
                                    if ((p - a2).sqrMagnitude <= 1e-12f || (p - b2).sqrMagnitude <= 1e-12f || (p - c2).sqrMagnitude <= 1e-12f) continue;
                                    float c1 = (b2.x - a2.x) * (p.y - a2.y) - (b2.y - a2.y) * (p.x - a2.x);
                                    float c2v = (c2.x - b2.x) * (p.y - b2.y) - (c2.y - b2.y) * (p.x - b2.x);
                                    float c3 = (a2.x - c2.x) * (p.y - c2.y) - (a2.y - c2.y) * (p.x - c2.x);
                                    if (c1 >= -1e-7f && c2v >= -1e-7f && c3 >= -1e-7f) { inside = true; break; }
                                }
                                if (inside) continue;
                            }
                            earPos = k;
                            break;
                        }
                    }
                    if (earPos < 0) earPos = 0;
                    var pa2 = pts[idx[(earPos + idx.Count - 1) % idx.Count]];
                    var pb2 = pts[idx[earPos]];
                    var pc2 = pts[idx[(earPos + 1) % idx.Count]];
                    TriDoc(Back(pa2), Back(pc2), Back(pb2), -wAxisDoc, pa2, pc2, pb2, true);
                    TriDoc(Front(pa2), Front(pb2), Front(pc2), wAxisDoc, pa2, pb2, pc2, true);
                    idx.RemoveAt(earPos);
                }
                if (idx.Count == 3) {
                    var pa2 = pts[idx[0]]; var pb2 = pts[idx[1]]; var pc2 = pts[idx[2]];
                    TriDoc(Back(pa2), Back(pc2), Back(pb2), -wAxisDoc, pa2, pc2, pb2, true);
                    TriDoc(Front(pa2), Front(pb2), Front(pc2), wAxisDoc, pa2, pb2, pc2, true);
                }
            }

            /// <summary>Append a smooth-shaded torus arc tube in document axes, with flat end caps.</summary>
            public void TorusArcDoc(Vector3 centreDoc, Vector3 axisUDoc, Vector3 axisVDoc, Vector3 binormalDoc,
                float majorRadius, float minorRadius, float startAngle, float sweepAngle, int majorSegments, int radialSegments) {
                majorSegments = Mathf.Max(2, majorSegments);
                radialSegments = Mathf.Max(4, radialSegments);
                var uAxis = axisUDoc.normalized;
                var vAxis = axisVDoc.normalized;
                var bAxis = binormalDoc.normalized;
                int ringStride = radialSegments + 1;
                int baseIndex = vertices.Count;
                for (int i = 0; i <= majorSegments; i++) {
                    float tMajor = i / (float)majorSegments;
                    float u = startAngle + sweepAngle * tMajor;
                    var majorDir = (uAxis * Mathf.Cos(u) + vAxis * Mathf.Sin(u)).normalized;
                    for (int j = 0; j <= radialSegments; j++) {
                        float tMinor = j / (float)radialSegments;
                        float v = 2f * Mathf.PI * tMinor;
                        var radialOut = majorDir * Mathf.Cos(v) + bAxis * Mathf.Sin(v);
                        var posDoc = centreDoc + majorDir * majorRadius + radialOut * minorRadius;
                        vertices.Add(Doc(posDoc - pivot));
                        uvs.Add(new Vector2(tMajor * majorRadius * Mathf.Abs(sweepAngle), tMinor * 2f * Mathf.PI * minorRadius));
                    }
                }
                for (int i = 0; i < majorSegments; i++) {
                    float uMid = startAngle + sweepAngle * ((i + .5f) / majorSegments);
                    var majorMid = (uAxis * Mathf.Cos(uMid) + vAxis * Mathf.Sin(uMid)).normalized;
                    for (int j = 0; j < radialSegments; j++) {
                        float vMid = 2f * Mathf.PI * ((j + .5f) / radialSegments);
                        var outDoc = majorMid * Mathf.Cos(vMid) + bAxis * Mathf.Sin(vMid);
                        int i00 = baseIndex + i * ringStride + j;
                        int i10 = baseIndex + (i + 1) * ringStride + j;
                        int i11 = i10 + 1;
                        int i01 = i00 + 1;
                        var p00 = vertices[i00]; var p10 = vertices[i10]; var p11 = vertices[i11];
                        bool flip = Vector3.Dot(Vector3.Cross(p10 - p00, p11 - p00), Doc(outDoc)) < 0f;
                        if (flip) {
                            triangles.Add(i00); triangles.Add(i11); triangles.Add(i10);
                            triangles.Add(i00); triangles.Add(i01); triangles.Add(i11);
                        } else {
                            triangles.Add(i00); triangles.Add(i10); triangles.Add(i11);
                            triangles.Add(i00); triangles.Add(i11); triangles.Add(i01);
                        }
                    }
                }
                // End caps so open tube ends are never hollow.
                if (Mathf.Abs(sweepAngle) < 2f * Mathf.PI - 1e-3f) {
                    float sign = sweepAngle >= 0f ? 1f : -1f;
                    for (int end = 0; end < 2; end++) {
                        float u = end == 0 ? startAngle : startAngle + sweepAngle;
                        var majorDir = (uAxis * Mathf.Cos(u) + vAxis * Mathf.Sin(u)).normalized;
                        var tangent = (-uAxis * Mathf.Sin(u) + vAxis * Mathf.Cos(u)).normalized * sign;
                        var capOut = end == 0 ? -tangent : tangent;
                        var capCentre = centreDoc + majorDir * majorRadius;
                        for (int j = 0; j < radialSegments; j++) {
                            float v0 = 2f * Mathf.PI * (j / (float)radialSegments);
                            float v1 = 2f * Mathf.PI * ((j + 1) / (float)radialSegments);
                            var p0 = capCentre + (majorDir * Mathf.Cos(v0) + bAxis * Mathf.Sin(v0)) * minorRadius;
                            var p1 = capCentre + (majorDir * Mathf.Cos(v1) + bAxis * Mathf.Sin(v1)) * minorRadius;
                            TriDoc(capCentre, p0, p1, capOut);
                        }
                    }
                }
            }

            /// <summary>Append a smooth-shaded hemisphere dome in document axes (`RampJoinModel.ts` dome).</summary>
            public void HemisphereDoc(Vector3 centreDoc, Vector3 normalDoc, float radius, int lonSegments, int latSegments) {
                lonSegments = Mathf.Max(6, lonSegments);
                latSegments = Mathf.Max(3, latSegments);
                var n = normalDoc.sqrMagnitude > 1e-12f ? normalDoc.normalized : new Vector3(0f, 0f, 1f);
                var refAxis = Mathf.Abs(n.z) < .9f ? new Vector3(0f, 0f, 1f) : new Vector3(1f, 0f, 0f);
                var t1 = Vector3.Cross(refAxis, n).normalized;
                var t2 = Vector3.Cross(n, t1).normalized;
                int stride = lonSegments + 1;
                int baseIndex = vertices.Count;
                for (int lat = 0; lat <= latSegments; lat++) {
                    float v = lat / (float)latSegments;
                    float phi = Mathf.PI * .5f * v;
                    float cosP = Mathf.Cos(phi), sinP = Mathf.Sin(phi);
                    for (int lon = 0; lon <= lonSegments; lon++) {
                        float u = lon / (float)lonSegments;
                        float theta = 2f * Mathf.PI * u;
                        var dir = (t1 * Mathf.Cos(theta) + t2 * Mathf.Sin(theta)) * cosP + n * sinP;
                        vertices.Add(Doc(centreDoc + dir * radius - pivot));
                        uvs.Add(new Vector2(u, v));
                    }
                }
                for (int lat = 0; lat < latSegments; lat++) {
                    float phiMid = Mathf.PI * .5f * ((lat + .5f) / latSegments);
                    for (int lon = 0; lon < lonSegments; lon++) {
                        float thetaMid = 2f * Mathf.PI * ((lon + .5f) / lonSegments);
                        var outDoc = (t1 * Mathf.Cos(thetaMid) + t2 * Mathf.Sin(thetaMid)) * Mathf.Cos(phiMid) + n * Mathf.Sin(phiMid);
                        int i00 = baseIndex + lat * stride + lon;
                        int i01 = i00 + 1;
                        int i10 = baseIndex + (lat + 1) * stride + lon;
                        int i11 = i10 + 1;
                        if (lat == latSegments - 1) {
                            var p0 = vertices[i00]; var p1 = vertices[i01]; var pTop = vertices[i10];
                            bool flipTop = Vector3.Dot(Vector3.Cross(p1 - p0, pTop - p0), Doc(outDoc)) < 0f;
                            if (flipTop) { triangles.Add(i00); triangles.Add(i10); triangles.Add(i01); }
                            else { triangles.Add(i00); triangles.Add(i01); triangles.Add(i10); }
                        } else {
                            var p00 = vertices[i00]; var p01 = vertices[i01]; var p11 = vertices[i11];
                            bool flip = Vector3.Dot(Vector3.Cross(p01 - p00, p11 - p00), Doc(outDoc)) < 0f;
                            if (flip) {
                                triangles.Add(i00); triangles.Add(i11); triangles.Add(i01);
                                triangles.Add(i00); triangles.Add(i10); triangles.Add(i11);
                            } else {
                                triangles.Add(i00); triangles.Add(i01); triangles.Add(i11);
                                triangles.Add(i00); triangles.Add(i11); triangles.Add(i10);
                            }
                        }
                    }
                }
            }

            public Mesh Build(Transform parent, Material material, string name) {
                var mesh = new Mesh { name = name };
                if (vertices.Count > 65000) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
                mesh.SetVertices(vertices);
                mesh.SetTriangles(triangles, 0);
                if (uvs.Count == vertices.Count) mesh.SetUVs(0, uvs);
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
            var t = band.Climb.normalized;
            var docUp = new Vector3(0f, 0f, 1f);
            var side = Vector3.Cross(docUp, t).normalized;
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

        static readonly float[] CatalogueStairWidths = { .68f, 1.36f, 2.04f };

        static float StairTreadWidth(int flightCount, bool block, float width) {
            if (block || flightCount != 1) return width;
            for (int i = 0; i < CatalogueStairWidths.Length; i++) {
                if (Math.Abs(width - CatalogueStairWidths[i]) < 1e-6f)
                    return (i + 1) - 2f * StairRailProud;
            }
            return width;
        }

        static int StairRunBlocks(float width) => Mathf.Max(1, Mathf.Min(3, Mathf.RoundToInt(width + 2f * StairRailProud)));

        static bool StairOnBlockGrid(float width) => Math.Abs(width + 2f * StairRailProud - StairRunBlocks(width)) < 1e-6f;

        static List<Vector2> StairFlightSlides(List<StairFlight> flights, string style, float width, float treadWidth) {
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
                var f = flights[0];
                var lower = f.From.z <= f.To.z ? f.From : f.To;
                var upper = f.From.z <= f.To.z ? f.To : f.From;
                var delta = upper - lower;
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

        static bool IsQuarterTurn(List<StairFlight> flights) {
            if (flights.Count != 2) return false;
            var d0 = flights[0].To - flights[0].From;
            var d1 = flights[1].To - flights[1].From;
            return Math.Abs(d0.x * d1.x + d0.y * d1.y) < 1e-6f;
        }

        static Shape LandingShape(List<StairFlight> flights, List<Vector2> slides, string style, float savedWidth, float treadWidth, int index) {
            if (IsQuarterTurn(flights)) {
                var corner = flights[0].To;
                int lanes = StairOnBlockGrid(savedWidth) ? StairRunBlocks(savedWidth) : 1;
                var slide = slides.Count > 1 ? slides[1] : Vector2.zero;
                bool alongX = Math.Abs(flights[1].To.x - flights[1].From.x) > 1e-6f;
                int ux = Math.Sign(flights[1].To.x - flights[1].From.x);
                int uy = Math.Sign(flights[1].To.y - flights[1].From.y);
                int depth = Mathf.RoundToInt(alongX ? Mathf.Abs(flights[1].From.x - corner.x) : Mathf.Abs(flights[1].From.y - corner.y)) + 1;
                float centre = (alongX ? corner.y : corner.x) + .5f + (alongX ? slide.y : slide.x);
                double lo = centre - treadWidth * .5f;
                double hi = centre + treadWidth * .5f;
                int minRun = int.MaxValue, maxRun = int.MinValue;
                for (int along = 0; along < depth; along++) {
                    int c = Mathf.RoundToInt(alongX ? corner.x + ux * along : corner.y + uy * along);
                    if (c < minRun) minRun = c;
                    if (c > maxRun) maxRun = c;
                }
                double a0 = minRun, a1 = maxRun + 1;
                return alongX
                    ? new Shape { x0 = a0, y0 = lo, x1 = a1, y1 = hi, z = corner.z }
                    : new Shape { x0 = lo, y0 = a0, x1 = hi, y1 = a1, z = corner.z };
            }
            var a = flights[index].To;
            var b = flights[index + 1].From;
            float ax = a.x + .5f + (index < slides.Count ? slides[index].x : 0f);
            float ay = a.y + .5f + (index < slides.Count ? slides[index].y : 0f);
            float bx = b.x + .5f + (index + 1 < slides.Count ? slides[index + 1].x : 0f);
            float by = b.y + .5f + (index + 1 < slides.Count ? slides[index + 1].y : 0f);
            float cx = (ax + bx) * .5f, cy = (ay + by) * .5f;
            bool alignedForward = string.Equals(style, "centerForward", StringComparison.Ordinal);
            bool acrossX = Math.Abs(a.x - b.x) > 1e-6f || (alignedForward && Math.Abs(flights[index].From.x - a.x) < 1e-6f);
            bool acrossY = Math.Abs(a.y - b.y) > 1e-6f || (alignedForward && Math.Abs(flights[index].From.y - a.y) < 1e-6f);
            bool corner2 = !acrossX && !acrossY;
            float sx = acrossX ? Math.Abs(bx - ax) + savedWidth : corner2 ? savedWidth : 1f;
            float sy = acrossY ? Math.Abs(by - ay) + savedWidth : corner2 ? savedWidth : 1f;
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

        static BandRig BandGeometry(Vector3Int from, Vector3Int to, float inclineDegrees, float widthBlocks, bool escalator,
            IReadOnlyList<ModuleFacts> neighbours = null) {
            float dx = to.x - from.x, dy = to.y - from.y;
            float horizontal = new Vector2(dx, dy).magnitude;
            if (horizontal < 1e-6f) return null;
            float liftFrom = (float)StationRampOpenings.ExitLandingHeight(neighbours, from.x, from.y, from.z);
            float liftTo = (float)StationRampOpenings.ExitLandingHeight(neighbours, to.x, to.y, to.z);
            float rise = (to.z + liftTo) - (from.z + liftFrom);
            float angle = Mathf.Abs(inclineDegrees) < 1e-6f ? 0f : inclineDegrees * Mathf.Deg2Rad;
            float inset = 0f;
            if (escalator && angle > 1e-6f && Math.Abs(rise) > 1e-6f)
                inset = Mathf.Max(0f, (horizontal - Math.Abs(rise) / Mathf.Tan(angle)) * .5f);
            // `escalatorRun`: order low/high first so a descending wide run shifts to the same lanes as an ascending one.
            bool lowerFirst = from.z != to.z ? from.z < to.z : (from.x != to.x ? from.x < to.x : from.y < to.y);
            var lowCell = lowerFirst ? from : to;
            var highCell = lowerFirst ? to : from;
            float half = (widthBlocks - 1f) * .5f / horizontal;
            float shiftX = (highCell.y - lowCell.y) * half;
            float shiftY = -(highCell.x - lowCell.x) * half;
            float ux = dx / horizontal, uy = dy / horizontal;
            float fromX = from.x + .5f + shiftX + ux * inset;
            float fromY = from.y + .5f + shiftY + uy * inset;
            float toX = to.x + .5f + shiftX - ux * inset;
            float toY = to.y + .5f + shiftY - uy * inset;
            var a = new Vector3(fromX, fromY, from.z + 1f + liftFrom);
            var b = new Vector3(toX, toY, to.z + 1f + liftTo);
            float length = (b - a).magnitude;
            if (length < 1e-4f) return null;
            var t = (b - a) / length;
            bool ascends = b.z >= a.z;
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
                AuthoredHorizontal = horizontal, AuthoredRise = Mathf.Abs(to.z - from.z),
                ExitLift = Mathf.Max(liftFrom, liftTo),
                YawDegrees = Mathf.Atan2(climb.y, climb.x) * Mathf.Rad2Deg,
                PrefabYawDegrees = Mathf.Atan2(-climb.y, climb.x) * Mathf.Rad2Deg,
                TravelSign = ascends ? 1f : -1f,
            };
        }

        static Mesh BuildTreadMesh(BandRig band) {
            var mesh = new Mesh { name = "escalator tread", subMeshCount = 2 };
            var vertices = new List<Vector3>(48);
            var uvs = new List<Vector2>(48);
            var steelTris = new List<int>(36);
            var nosingTris = new List<int>(36);
            AppendRunBox(vertices, steelTris, uvs, new Vector3(0f, 0f, -.03f), new Vector3(band.StepRun * 1.02f, band.BandWidth, .06f), Quaternion.identity);
            AppendRunBox(vertices, nosingTris, uvs, new Vector3(band.StepRun * .5f - .03f, 0f, -.01f), new Vector3(.06f, band.BandWidth, .08f), Quaternion.identity);
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(steelTris, 0);
            mesh.SetTriangles(nosingTris, 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static Mesh BuildRiserMesh(BandRig band) {
            var mesh = new Mesh { name = "escalator riser" };
            var vertices = new List<Vector3>(24);
            var triangles = new List<int>(36);
            var uvs = new List<Vector2>(24);
            AppendRunBox(vertices, triangles, uvs, new Vector3(band.StepRun * .5f, 0f, band.StepRise * .5f), new Vector3(.05f, band.BandWidth, band.StepRise), Quaternion.identity);
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uvs);
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
        static void AppendRunBox(List<Vector3> vertices, List<int> triangles, List<Vector2> uvs, Vector3 centre, Vector3 size, Quaternion rotation) {
            BoxFaces.AppendUv(vertices, triangles, uvs, Doc(centre),
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

        static Transform NewMeshObject(string name, Transform parent, Mesh mesh, Material[] materials) {
            var go = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            go.transform.SetParent(parent, false);
            go.GetComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.GetComponent<MeshRenderer>();
            renderer.sharedMaterials = materials;
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
    public sealed class VerticalModuleRenderer : IStationViewRenderer, IStationLocalViewRenderer {
        public const string RoleName = "vertical";

        sealed class WorldState {
            public StationWorldView World;
            public readonly List<VerticalModuleView> Views = new List<VerticalModuleView>();
            public readonly Dictionary<string, VerticalModuleView> ById = new Dictionary<string, VerticalModuleView>(StringComparer.Ordinal);
            public readonly Dictionary<string, HashSet<StationCellKey>> ReadCellsById =
                new Dictionary<string, HashSet<StationCellKey>>(StringComparer.Ordinal);
            public Material[] Materials;
            public Func<int, Material> MaterialFor;
            /// <summary>
            /// The station finish library, acquired on first need: a 楼梯块 wears its saved /
            /// supporting-floor finish (plan 22 §3), which is the same library the cell mesher
            /// draws. Owned by this world, so a staged candidate never shares it with the
            /// outgoing station.
            /// </summary>
            public StationFinishLibrary Finishes;
            public Func<string, Material> FinishFor;
            public double ClockOrigin = double.NaN;

            public void EnsureFinishes(Shader shader) {
                if (Finishes != null || shader == null) return;
                Finishes = StationCellRenderer.AcquireLibrary(shader);
                if (Finishes != null) FinishFor = id => Finishes.For(id);
            }

            public void EnsureMaterials(Shader shader) {
                if (shader == null || Materials != null) return;
                Materials = new Material[VerticalModuleViews.Palette.Length];
                for (int i = 0; i < Materials.Length; i++) {
                    if (i == VerticalModuleViews.PaletteGlass) {
                        Materials[i] = StationGlass.Create(shader, "Vertical " + i, StationGlass.DefaultTint, .26f);
                    } else {
                        Materials[i] = new Material(shader) { color = VerticalModuleViews.Palette[i], name = "Vertical " + i };
                        VerticalModuleViews.ConfigurePaletteMaterial(Materials[i], i);
                    }
                }
                MaterialFor = palette => Materials[Mathf.Clamp(palette, 0, Materials.Length - 1)];
            }

            public void Add(VerticalModuleView view, HashSet<StationCellKey> readCells) {
                Views.Add(view);
                ById[view.ModuleId] = view;
                if (readCells != null) ReadCellsById[view.ModuleId] = readCells;
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
                ReadCellsById.Clear();
                ClockOrigin = double.NaN;
            }

            public void Dispose() {
                Reset();
                if (Materials != null) {
                    for (int i = 0; i < Materials.Length; i++) VerticalModuleViews.DestroyObject(Materials[i]);
                    Materials = null;
                    MaterialFor = null;
                }
                if (Finishes != null) {
                    Finishes.Dispose();
                    Finishes = null;
                }
                FinishFor = null;
            }
        }

        sealed class StagedVerticalDelta : IStationLocalRendererStage {
            readonly WorldState state;
            readonly HashSet<string> retiredIds;
            readonly List<(VerticalModuleView View, HashSet<StationCellKey> ReadCells)> staged;
            bool committed;

            public StagedVerticalDelta(
                WorldState state,
                HashSet<string> retiredIds,
                List<(VerticalModuleView View, HashSet<StationCellKey> ReadCells)> staged) {
                this.state = state;
                this.retiredIds = retiredIds;
                this.staged = staged;
            }

            public void Commit(StationWorldView world, StationLocalViewCommit commit) {
                committed = true;
                if (retiredIds.Count > 0) {
                    world.RetireRecordsWhere(rec => rec.Role == RoleName && retiredIds.Contains(rec.ModuleId), commit);
                    for (int i = state.Views.Count - 1; i >= 0; i--) {
                        var oldView = state.Views[i];
                        if (oldView == null || !retiredIds.Contains(oldView.ModuleId)) continue;
                        state.Views.RemoveAt(i);
                        state.ById.Remove(oldView.ModuleId);
                        state.ReadCellsById.Remove(oldView.ModuleId);
                        if (oldView.Root != null) commit.RetiredViews.Add(oldView.Root.gameObject);
                        oldView.Dispose();
                    }
                }

                var roleRoot = world.RoleRoot(RoleName);
                for (int i = 0; i < staged.Count; i++) {
                    var (view, readCells) = staged[i];
                    view.Root.SetParent(roleRoot, false);
                    state.Add(view, readCells);
                    world.AddLocalRecord(new StationViewRecord {
                        Role = RoleName,
                        ModuleId = view.ModuleId,
                        View = view.Root.gameObject,
                        Bounds = new StationBox(view.DocumentBounds.X0, view.DocumentBounds.Y0, view.DocumentBounds.Z0,
                            view.DocumentBounds.X1, view.DocumentBounds.Y1, view.DocumentBounds.Z1),
                        HasBounds = true,
                        LevelMin = view.LevelMin,
                        LevelMax = view.LevelMax,
                    }, commit);
                }
            }

            public void Dispose() {
                if (committed) return;
                for (int i = 0; i < staged.Count; i++) {
                    var view = staged[i].View;
                    if (view == null) continue;
                    if (view.Root != null) VerticalModuleViews.DestroyObject(view.Root.gameObject);
                    view.Dispose();
                }
                staged.Clear();
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
            var index = context.Index;
            var catalogue = context.Catalogue;
            var modules = document.Modules;
            var verticalNeighbours = new List<ModuleFacts>(64);
            for (int i = 0; i < modules.Count; i++) {
                var m = modules[i];
                if (m != null && (IsVerticalType(m.Type) || string.Equals(m.Type, "exit", StringComparison.Ordinal))) {
                    verticalNeighbours.Add(m.Facts);
                }
            }

            HashSet<StationCellKey> fallbackSolids = null;
            Dictionary<StationCellKey, string> fallbackTops = null;
            if (index == null) {
                fallbackSolids = new HashSet<StationCellKey>();
                fallbackTops = new Dictionary<StationCellKey, string>();
                for (int i = 0; i < document.Cells.Count; i++) {
                    var cell = document.Cells[i];
                    if (cell.IsSolid) fallbackSolids.Add(cell.Key);
                    if (cell.FinishTop.Length > 0) fallbackTops[cell.Key] = cell.FinishTop;
                }
            }

            try { state.EnsureFinishes(context.Shader); } catch (Exception) { /* a missing finish export falls back to the palette */ }
            var roleRoot = context.RoleRoot(RoleName);
            for (int i = 0; i < modules.Count; i++) {
                var module = modules[i];
                if (module == null || !IsVerticalType(module.Type)) continue;
                var readCells = new HashSet<StationCellKey>();
                Func<int, int, int, bool> solid = (x, y, z) => {
                    var key = new StationCellKey(x, y, z);
                    readCells.Add(key);
                    if (index != null) return index.GetCell(x, y, z) is StationCellRecord cell && cell.IsSolid;
                    return fallbackSolids.Contains(key);
                };
                Func<int, int, int, string> cellFinish = (x, y, z) => {
                    var key = new StationCellKey(x, y, z);
                    readCells.Add(key);
                    if (index != null) {
                        var cell = index.GetCell(x, y, z);
                        return cell != null && cell.FinishTop.Length > 0 ? cell.FinishTop : null;
                    }
                    return fallbackTops.TryGetValue(key, out var finish) ? finish : null;
                };
                GameObject prefab = null;
                string prefabKey = null;
                if (catalogue != null) {
                    var visual = ModuleViews.Resolve(module.Facts, Array.Empty<ModuleFacts>(), catalogue);
                    if (visual.HasModel && catalogue.TryGet(visual.Key, out var entry) && entry != null) {
                        prefab = entry.prefab;
                        prefabKey = visual.Key;
                    } else {
                        context.ReportUnresolved("vertical-key", module.Type, module.Id,
                            visual.Key.Length > 0 ? "catalogue entry missing: " + visual.Key : visual.Detail);
                    }
                }
                var request = VerticalModuleRequest.FromFacts(module.Facts, prefab, prefabKey, solid, state.MaterialFor,
                    state.FinishFor, cellFinish, verticalNeighbours);
                if (!VerticalModuleViews.TryBuild(request, roleRoot, out var view)) {
                    context.ReportUnresolved("vertical-build", module.Type, module.Id, "the authored record could not be built");
                    continue;
                }
                if (view.UsedPrefab && prefab != null) StationRigidModelLods.Apply(view.Root.gameObject, prefab.name);
                view.Root.name = module.Id;
                context.World.RegisterModule(RoleName, module.Id, view.Root.gameObject, "",
                    new StationBox(view.DocumentBounds.X0, view.DocumentBounds.Y0, view.DocumentBounds.Z0,
                        view.DocumentBounds.X1, view.DocumentBounds.Y1, view.DocumentBounds.Z1),
                    view.LevelMin, view.LevelMax);
                state.Add(view, readCells);
            }
        }

        static StationBox VerticalSearchEnvelope(StationModuleRecord module) {
            double x0 = module.X, x1 = module.X + Math.Max(1, module.Width);
            double y0 = module.Y, y1 = module.Y + Math.Max(1, module.Depth);
            double z0 = module.Z, z1 = module.Z + 5;
            if (module.From.HasValue) {
                var f = module.From.Value;
                x0 = Math.Min(x0, f.X); x1 = Math.Max(x1, f.X + 1);
                y0 = Math.Min(y0, f.Y); y1 = Math.Max(y1, f.Y + 1);
                z0 = Math.Min(z0, f.Z); z1 = Math.Max(z1, f.Z + 1);
            }
            if (module.To.HasValue) {
                var t = module.To.Value;
                x0 = Math.Min(x0, t.X); x1 = Math.Max(x1, t.X + 1);
                y0 = Math.Min(y0, t.Y); y1 = Math.Max(y1, t.Y + 1);
                z0 = Math.Min(z0, t.Z); z1 = Math.Max(z1, t.Z + 1);
            }
            return new StationBox(x0 - 4, y0 - 4, z0 - 6, x1 + 4, y1 + 4, z1 + 6);
        }

        static bool BoxesOverlap(in StationBox a, double bx0, double by0, double bz0, double bx1, double by1, double bz1) =>
            a.X0 <= bx1 && a.X1 >= bx0 && a.Y0 <= by1 && a.Y1 >= by0 && a.Z0 <= bz1 && a.Z1 >= bz0;

        static bool CellTouchesVerticalView(VerticalModuleView view, HashSet<StationCellKey> readCells, StationCellKey key) {
            if (readCells != null && readCells.Contains(key)) return true;
            var b = view.DocumentBounds;
            return key.X + 1 >= b.X0 - 1 && key.X <= b.X1 + 1 &&
                   key.Y + 1 >= b.Y0 - 1 && key.Y <= b.Y1 + 1 &&
                   key.Z + 1 >= b.Z0 - 2 && key.Z <= b.Z1 + 2;
        }

        public bool TryStageLocalDelta(
            StationLocalDeltaContext context,
            out IStationLocalRendererStage stage,
            out string fallbackReason) {
            stage = null;
            fallbackReason = null;
            var state = StateOf(context.World);
            if (state == null) {
                fallbackReason = "no-vertical-state";
                return false;
            }

            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            var dirtyIds = new HashSet<string>(StringComparer.Ordinal);
            List<StationBox> rampEnvelopes = null;

            var delta = context.Delta;
            for (int i = 0; i < delta.RemovedModules.Count; i++) {
                var id = delta.RemovedModules[i];
                if (context.PrevIndex.TryGetModule(id, out var oldMod) && IsVerticalType(oldMod.Type)) {
                    removedIds.Add(id);
                    (rampEnvelopes ??= new List<StationBox>()).Add(VerticalSearchEnvelope(oldMod));
                }
            }
            for (int i = 0; i < delta.ChangedModules.Count; i++) {
                var mod = delta.ChangedModules[i];
                if (mod != null && IsVerticalType(mod.Type)) {
                    dirtyIds.Add(mod.Id);
                    (rampEnvelopes ??= new List<StationBox>()).Add(VerticalSearchEnvelope(mod));
                    if (context.PrevIndex.TryGetModule(mod.Id, out var prevMod)) {
                        rampEnvelopes.Add(VerticalSearchEnvelope(prevMod));
                    }
                }
            }
            if (context.CityChanged || context.NameChanged) {
                var exits = context.NextIndex.ModulesOfType("exit");
                for (int i = 0; i < exits.Count; i++) {
                    var ex = exits[i];
                    if (ex != null && !removedIds.Contains(ex.Id)) dirtyIds.Add(ex.Id);
                }
            }

            if (rampEnvelopes != null) {
                for (int i = 0; i < state.Views.Count; i++) {
                    var view = state.Views[i];
                    if (view == null || removedIds.Contains(view.ModuleId) || dirtyIds.Contains(view.ModuleId)) continue;
                    var vb = view.DocumentBounds;
                    for (int e = 0; e < rampEnvelopes.Count; e++) {
                        if (BoxesOverlap(rampEnvelopes[e], vb.X0, vb.Y0, vb.Z0, vb.X1, vb.Y1, vb.Z1)) {
                            dirtyIds.Add(view.ModuleId);
                            break;
                        }
                    }
                }
            }

            if (context.CellsChanged && state.Views.Count > 0) {
                for (int i = 0; i < state.Views.Count; i++) {
                    var view = state.Views[i];
                    if (view == null || removedIds.Contains(view.ModuleId) || dirtyIds.Contains(view.ModuleId)) continue;
                    state.ReadCellsById.TryGetValue(view.ModuleId, out var readCells);
                    bool hit = false;
                    for (int r = 0; r < delta.RemovedCells.Count; r++) {
                        if (CellTouchesVerticalView(view, readCells, delta.RemovedCells[r])) { hit = true; break; }
                    }
                    if (!hit) {
                        for (int c = 0; c < delta.ChangedCells.Count; c++) {
                            if (CellTouchesVerticalView(view, readCells, delta.ChangedCells[c].Key)) { hit = true; break; }
                        }
                    }
                    if (hit) dirtyIds.Add(view.ModuleId);
                }
            }

            if (removedIds.Count == 0 && dirtyIds.Count == 0) return true;

            state.EnsureMaterials(context.World.Shader);
            try { state.EnsureFinishes(context.World.Shader); } catch (Exception) { }

            var rampAndExitFacts = dirtyIds.Count > 0
                ? context.GetNextFactsOfTypes("stair", "escalator", "walkway", "lift", "exit")
                : Array.Empty<ModuleFacts>();
            var nextIndex = context.NextIndex;
            var catalogue = context.World.Catalogue;
            var retiredIds = new HashSet<string>(removedIds, StringComparer.Ordinal);
            var stagedViews = new List<(VerticalModuleView View, HashSet<StationCellKey> ReadCells)>(dirtyIds.Count);

            try {
                foreach (var id in dirtyIds) {
                    retiredIds.Add(id);
                    if (!nextIndex.TryGetModule(id, out var module) || module == null || !IsVerticalType(module.Type)) continue;
                    var readCells = new HashSet<StationCellKey>();
                    Func<int, int, int, bool> solid = (x, y, z) => {
                        readCells.Add(new StationCellKey(x, y, z));
                        return nextIndex.GetCell(x, y, z) is StationCellRecord cell && cell.IsSolid;
                    };
                    Func<int, int, int, string> cellFinish = (x, y, z) => {
                        readCells.Add(new StationCellKey(x, y, z));
                        var cell = nextIndex.GetCell(x, y, z);
                        return cell != null && cell.FinishTop.Length > 0 ? cell.FinishTop : null;
                    };
                    GameObject prefab = null;
                    string prefabKey = null;
                    if (catalogue != null) {
                        var visual = ModuleViews.Resolve(module.Facts, Array.Empty<ModuleFacts>(), catalogue);
                        if (visual.HasModel && catalogue.TryGet(visual.Key, out var entry) && entry != null) {
                            prefab = entry.prefab;
                            prefabKey = visual.Key;
                        } else {
                            context.ReportUnresolved("vertical-key", module.Type, module.Id,
                                visual.Key.Length > 0 ? "catalogue entry missing: " + visual.Key : visual.Detail);
                        }
                    }
                    var request = VerticalModuleRequest.FromFacts(module.Facts, prefab, prefabKey, solid, state.MaterialFor,
                        state.FinishFor, cellFinish, rampAndExitFacts);
                    if (!VerticalModuleViews.TryBuild(request, context.StagingRoot, out var view)) {
                        context.ReportUnresolved("vertical-build", module.Type, module.Id, "the authored record could not be built");
                        continue;
                    }
                    if (view.UsedPrefab && prefab != null) StationRigidModelLods.Apply(view.Root.gameObject, prefab.name);
                    view.Root.name = module.Id;
                    StationEditTrace.AddInstantiatedPrefab();
                    stagedViews.Add((view, readCells));
                }
                stage = new StagedVerticalDelta(state, retiredIds, stagedViews);
                return true;
            } catch {
                for (int i = 0; i < stagedViews.Count; i++) {
                    if (stagedViews[i].View?.Root != null) VerticalModuleViews.DestroyObject(stagedViews[i].View.Root.gameObject);
                    stagedViews[i].View?.Dispose();
                }
                throw;
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
        public int ApplyAll(double simTimeSeconds, bool running, bool bandsOnly = false) {
            var world = ActiveState();
            if (world == null) return 0;
            if (double.IsNaN(world.ClockOrigin)) world.ClockOrigin = simTimeSeconds;
            int applied = 0;
            for (int i = 0; i < world.Views.Count; i++) {
                var view = world.Views[i];
                if (view == null) continue;
                if (bandsOnly && view.Band == null) continue;
                var state = new ModuleMotionState {
                    ModuleId = view.ModuleId, Seconds = simTimeSeconds, Running = running, DirectionSign = 1,
                    CabinFraction = float.NaN, DoorFraction = float.NaN, PhaseMeters = double.NaN, CabinHeight = double.NaN,
                };
                if (view.Band != null) {
                    if (view.Root != null && !view.Root.gameObject.activeInHierarchy) {
                        view.BandDirty = true;
                        continue;
                    }
                    // Accumulate from the load, exactly as `rollEscalator` does; the
                    // station clock may start at 06:30 rather than zero.
                    double metres = view.Band.TravelSign * VerticalModuleViews.EscalatorSpeed * (simTimeSeconds - world.ClockOrigin);
                    double phase = VerticalModuleViews.Wrap(metres, view.Band.ChainLength);
                    if (!view.BandDirty && !double.IsNaN(view.LastAppliedBandPhase) &&
                        Math.Abs(phase - view.LastAppliedBandPhase) < 1e-5) {
                        continue;
                    }
                    state.PhaseMeters = phase;
                    if (view.Apply(state)) {
                        view.LastAppliedBandPhase = phase;
                        view.BandDirty = false;
                        applied++;
                    }
                    continue;
                }
                if (view.Kind == VerticalModuleKind.Lift) {
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
    sealed class VerticalFrameSink : IStationFrameSink, IStationActiveDuringExplodedView {
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            var renderer = VerticalModuleRenderer.Current;
            if (renderer != null) renderer.ApplyAll(clock.PresentationSeconds, clock.Playing, bandsOnly: true);
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













