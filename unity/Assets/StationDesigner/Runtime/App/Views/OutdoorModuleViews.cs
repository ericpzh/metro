using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using UnityEngine;

namespace Metro.App {
    /// <summary>How the host placed the module's parent transform before calling the builder.</summary>
    public enum OutdoorPlacement {
        /// <summary>The parent already carries the module's world position and saved quarter turn.</summary>
        ParentPlaced = 0,
        /// <summary>The parent carries the world position only; the builder applies the saved quarter turn.</summary>
        PositionOnly = 1,
    }

    /// <summary>Which saved fact chose the panel's plan axis.</summary>
    public enum OutdoorYawSource {
        /// <summary>The saved `rot` quarter turn (an isolated panel, a tree, or a junction axis choice).</summary>
        SavedRotation = 0,
        /// <summary>The connected fence neighbours, exactly as `sim/fences.ts` `fenceArms` reads them.</summary>
        ArmAxis = 1,
    }

    /// <summary>
    /// The same-level sides of a fence cell that hold something a panel may meet
    /// (`FenceNeighbours` in `game/src/sim/fences.ts`). Set <see cref="Known"/> only
    /// when the host has an authoritative connection index; otherwise the builder
    /// falls back to the saved quarter turn and reports it as a diagnostic.
    /// </summary>
    public struct OutdoorNeighbours {
        public bool Known;
        public bool East, West, North, South;
        /// <summary>
        /// Extra arm reach past ±0.5 m to seal against an inset neighbour (gate machine cabinet or
        /// doorless gate interior barrier). Zero for fence-to-fence and for escalator, walkway, and
        /// stair landings (which provide an integral steel receiver pillar flush at the cell boundary).
        /// </summary>
        public float SealEast, SealWest, SealNorth, SealSouth;
        /// <summary>
        /// True when that side abuts an escalator, walkway, or stair landing's integral steel pillar
        /// at ±0.5 m, so the fence's glass and clamps bolt flush to the cell edge.
        /// </summary>
        public bool PillarEast, PillarWest, PillarNorth, PillarSouth;

        public int Degree => (East ? 1 : 0) + (West ? 1 : 0) + (North ? 1 : 0) + (South ? 1 : 0);
        public bool HasSeal => SealEast > 1e-4f || SealWest > 1e-4f || SealNorth > 1e-4f || SealSouth > 1e-4f;
        public bool HasPillar => PillarEast || PillarWest || PillarNorth || PillarSouth;
    }

    /// <summary>
    /// One saved outdoor module as the host hands it to the builder. Plain data: no
    /// document type is referenced and no coordinate is converted here. The host
    /// resolves the key through `ModuleViews.Resolve` / `RuntimeCatalogue`, places
    /// the parent transform with the shared conversion, and passes the resolved
    /// prefab; the builder validates the pair before instantiating.
    /// </summary>
    public struct OutdoorModuleRequest {
        public string ModuleId;
        public string Type;
        /// <summary>The key `ModuleViews.Resolve` returned for this record.</summary>
        public string ViewKey;
        /// <summary>`cfg.variant`, or the empty string when the record stores none.</summary>
        public string Variant;
        /// <summary>`cfg.mount`, when the record stores one.</summary>
        public string Mount;
        /// <summary>Raw `cfg` JSON, kept for provenance only; the builder never re-parses it.</summary>
        public string ConfigJson;
        /// <summary>Raw saved dimensions JSON, kept for provenance only.</summary>
        public string DimensionsJson;
        public int X, Y, Z;
        /// <summary>Saved counter-clockwise quarter turns (document convention).</summary>
        public int Rotation;
        public int Width, Depth;
        /// <summary>The catalogue entry's prefab, resolved by the host.</summary>
        public GameObject Prefab;
        /// <summary>The catalogue, so the builder can resolve a missing prefab and validate the key.</summary>
        public RuntimeCatalogue Catalogue;
        public OutdoorPlacement Placement;
        public OutdoorNeighbours Neighbours;
    }

    /// <summary>
    /// What the builder did for one module: the instance, the renderers, the stable
    /// module ID and the diagnostics a report or a verifier reads. A failed build
    /// always leaves <see cref="Instance"/> null and a non-empty
    /// <see cref="Diagnostic"/>; it never creates stand-in geometry.
    /// </summary>
    public sealed class OutdoorModuleView {
        public string ModuleId = "";
        public string Type = "";
        public string ViewKey = "";
        public string Variant = "";
        public string PrefabPath = "";
        /// <summary>Empty on a clean build; a stable `code:detail` list of caveats otherwise.</summary>
        public string Diagnostic = "";
        public GameObject Instance;
        public Renderer[] Renderers = Array.Empty<Renderer>();
        public int TriangleCount;
        public Bounds Bounds;
        /// <summary>False for both families: the source has no fence or tree motion channel.</summary>
        public bool Animated;
        public OutdoorYawSource YawSource;
        /// <summary>The absolute plan yaw chosen for the prefab, in Unity degrees.</summary>
        public float Yaw;
        /// <summary>
        /// True when the one-metre prefab panel covers exactly the span
        /// `sim/fences.ts` derives for the cell. False for a junction whose two arms
        /// cannot be represented by the single promoted panel.
        /// </summary>
        public bool PanelExtentMatchesSource;
        /// <summary>Connected sides read from <see cref="OutdoorModuleRequest.Neighbours"/>, or -1 when unknown.</summary>
        public int NeighbourDegree = -1;
        /// <summary>
        /// How many computed arms a junction was composed from (`fence-arms-composed:<n>`), or 0
        /// when the promoted panel was drawn instead. RCA 15 §4.
        /// </summary>
        public int ComposedArms;

        public bool Built => Instance != null;
    }

    /// <summary>The four arms a fence cell draws, in cell-centre metres (`sim/fences.ts`).</summary>
    public struct OutdoorFenceArms {
        public float X0, X1, Y0, Y1;
        public bool CapEast, CapWest, CapNorth, CapSouth;

        public float XSpan => X1 - X0;
        public float YSpan => Y1 - Y0;
        public bool RunsAlongX => XSpan > 1e-6f;
        public bool RunsAlongY => YSpan > 1e-6f;
    }

    /// <summary>
    /// Runtime views for the two outdoor families, Zoo's 86 trees and 213 fences
    /// (`game/src/render/models/pieces/TreeModel.ts`, `FenceModel.ts`,
    /// `BlueSteelFence.ts`, `NoiseBarrierModel.ts`).
    ///
    /// Both families are instantiated from the promoted prefab the runtime
    /// catalogue carries for the resolved key: `tree`, `fence` (glass),
    /// `fence-iron`, `fence-steel-blue`, `fence-gate`, `noise-barrier`,
    /// `noise-barrier-half`, `noise-barrier-railing`. Trees have one promoted
    /// species (the street ash, full detail) because the source selects only a
    /// renderer LOD, which the export dropped; a saved tree config never chooses
    /// another species and is reported if it names one. Fences choose their
    /// prefab from `cfg.variant` exactly as `FenceModel.build` and
    /// `createModule` do.
    ///
    /// **No batching.** Every module keeps its own prefab instance, keyed by its
    /// stable module ID through the caller's view map, so picking, replace/remove
    /// and per-module visibility stay exact. The families are 299 Zoo views; a
    /// batch would have to re-create transforms, material slots and bounds and
    /// would lose the module→instance mapping the host uses. Neither family has a
    /// moving part (`unity/plan/motion-inventory.md` names no fence or tree
    /// channel): a fence gate is a fixed one-metre panel with hinge barrels and no
    /// scene system drives it, so nothing here may be folded into a moving batch.
    /// B3 owns the opening leaves that do move (fare gates, PSD, doors).
    ///
    /// **Fence composition.** The promoted fence prefab is the isolated one-metre
    /// panel that `sim/fences.ts` builds with no neighbours; it caps both ends and
    /// carries its own centre post. A run, an end and a junction are runtime
    /// composition in the source, and a single merged prefab cannot drop a cap or
    /// add a second arm. The builder therefore orients the panel from the
    /// neighbour-derived arm axis (not blindly from `rot`, which the source ignores
    /// for connected cells) and reports a junction whose two arms are missing. The
    /// measured gap over Zoo is in `unity/plan/11-evidence/B1.md`; closing it needs
    /// a re-export that names the cap posts/arms or an arm-composed builder.
    ///
    /// The builder never converts a document point: the host supplies the parent,
    /// already placed with `ModulePlacement`/`StationCoordinates`.
    /// </summary>
    public static class OutdoorModuleViews {
        public const string TreeKey = "tree";
        public const string GlassFenceKey = "fence";

        /// <summary>
        /// False: the source animates neither a tree nor a fence. A fence gate
        /// (`cfg.variant == "gate"`) is drawn closed by `FenceModel.build` and no
        /// scene system touches it (the moving station leaves are the fare gate,
        /// the platform screen, the swing door and the cubicle in
        /// `motion-inventory.md` §2–§4, which B3 owns). If the source ever gains a
        /// fence-gate leaf channel, add a per-module `SetOpen(float)` state keyed by
        /// module ID here — never a global boolean — and have B3 publish it.
        /// </summary>
        public const bool SourceHasMotion = false;

        /// <summary>The built-in meshes `GameObject.CreatePrimitive` hands out; a placeholder tells them apart.</summary>
        static readonly HashSet<string> BuiltinMeshes = new HashSet<string>(StringComparer.Ordinal) {
            "Cube", "Sphere", "Capsule", "Cylinder", "Quad", "Plane",
        };

        /// <summary>True for the saved types this builder owns; the host dispatches these before any batched path.</summary>
        public static bool Owns(string type) =>
            string.Equals(type, "tree", StringComparison.Ordinal) || string.Equals(type, "fence", StringComparison.Ordinal);

        /// <summary>
        /// The catalogue key the saved variant selects, from
        /// `game/src/sim/types.ts` `fence.cfg.variant` and
        /// `game/src/build/model/Equipment.ts`. Returns null for a non-outdoor type.
        /// The palette aliases `ModuleViews` writes (`noise-barrier*`) are accepted
        /// so a host that forwards a palette id does not report a false mismatch.
        /// </summary>
        public static string ExpectedKey(string type, string variant) {
            if (string.Equals(type, TreeKey, StringComparison.Ordinal)) return TreeKey;
            if (!string.Equals(type, "fence", StringComparison.Ordinal)) return null;
            switch (variant ?? "") {
                case "gate": return "fence-gate";
                case "iron": return "fence-iron";
                case "steel-blue": return "fence-steel-blue";
                case "bridge-railing": return "noise-barrier-railing";
                case "sound-barrier": return "noise-barrier";
                case "sound-barrier-half": return "noise-barrier-half";
                case "noise-barrier": return "noise-barrier";
                case "noise-barrier-half": return "noise-barrier-half";
                case "noise-barrier-railing": return "noise-barrier-railing";
                // `glass` and every unknown value draw the glass panel in FenceModel.
                default: return GlassFenceKey;
            }
        }

        /// <summary>
        /// A port of `fenceArms` (`game/src/sim/fences.ts:140`): a lone panel caps
        /// both ends of its `rot` axis, a run end caps the far edge, and a junction
        /// only draws toward its neighbours.
        /// </summary>
        public static OutdoorFenceArms FenceArms(int rotation, OutdoorNeighbours neighbours) {
            bool rotEven = NormTurn(rotation) % 2 == 0;
            int degree = neighbours.Degree;
            bool capEast = false, capWest = false, capNorth = false, capSouth = false;
            if (degree == 0) {
                if (rotEven) capEast = capWest = true;
                else capNorth = capSouth = true;
            } else if (degree == 1) {
                if (neighbours.East) capWest = true;
                else if (neighbours.West) capEast = true;
                else if (neighbours.North) capSouth = true;
                else if (neighbours.South) capNorth = true;
            }
            return new OutdoorFenceArms {
                X0 = neighbours.West || capWest ? -.5f : 0f,
                X1 = neighbours.East || capEast ? .5f : 0f,
                Y0 = neighbours.South || capSouth ? -.5f : 0f,
                Y1 = neighbours.North || capNorth ? .5f : 0f,
                CapEast = capEast, CapWest = capWest, CapNorth = capNorth, CapSouth = capSouth,
            };
        }

        /// <summary>
        /// Connectivity for a fence cell from the document's own modules: the four `connects`
        /// questions `FenceModel.build` asks, answered by the document-level
        /// <see cref="StationFenceConnections"/> port of `fenceConnectionIndex`
        /// (`game/src/sim/fences.ts`, RCA 15 §4).
        ///
        /// The index covers **fences**, a rail **landing** (a stair's full-width band, an
        /// escalator's or walkway's own landings) and a fare **gate's machine face**
        /// (`gateSolidFaces`), which is the face a run butts into; the lane side stays a doorway
        /// the run ends at. The index is cached per module list, so calling this per fence costs
        /// four lookups rather than a station scan.
        /// </summary>
        public static OutdoorNeighbours Neighbours(ModuleFacts module, IReadOnlyList<ModuleFacts> station) =>
            Neighbours(module, station == null ? StationFenceConnections.Empty : StationFenceConnections.For(station));

        /// <summary>True for the noise-barrier variants, which keep their saved orientation and prefab.</summary>
        public static bool IsNoiseBarrier(string variant, string viewKey = null) {
            switch (variant ?? "") {
                case "bridge-railing":
                case "sound-barrier":
                case "sound-barrier-half":
                case "noise-barrier":
                case "noise-barrier-half":
                case "noise-barrier-railing":
                    return true;
            }
            return !string.IsNullOrEmpty(viewKey) && viewKey.StartsWith("noise-barrier", StringComparison.Ordinal);
        }

        /// <summary>The same question against an index the caller already built once for the document.</summary>
        public static OutdoorNeighbours Neighbours(ModuleFacts module, StationFenceConnections index) {
            var neighbours = new OutdoorNeighbours { Known = false };
            if (module == null || index == null) return neighbours;
            neighbours.Known = true;
            if (!string.Equals(module.Type, "fence", StringComparison.Ordinal)) return neighbours;
            index.Sides(module, out neighbours.East, out neighbours.West, out neighbours.North, out neighbours.South);
            index.SealExtensions(module, out neighbours.SealEast, out neighbours.SealWest, out neighbours.SealNorth, out neighbours.SealSouth);
            index.PillarSides(module, out neighbours.PillarEast, out neighbours.PillarWest, out neighbours.PillarNorth, out neighbours.PillarSouth);
            return neighbours;
        }

        /// <summary>
        /// Resolve the exact world-space pose of a straight prefab outdoor module (isolated fence
        /// panel, noise barrier, or tree) without instantiating its prefab. Returns false for
        /// connected fences that compose continuous/sealed arms so the caller uses <see cref="TryBuild"/>.
        /// </summary>
        public static bool TryResolveStaticPose(
            ModuleFacts module,
            RuntimeCatalogue.Entry entry,
            OutdoorNeighbours neighbours,
            out Vector3 worldPos,
            out Quaternion worldRot,
            out Vector3 worldScale,
            float lift = 0f) {
            worldPos = default;
            worldRot = Quaternion.identity;
            worldScale = Vector3.one;
            if (module == null || entry == null || entry.prefab == null || !Owns(module.Type)) return false;
            if (entry.kind != "prefab" && entry.kind != "live") return false;
            var req = new OutdoorModuleRequest {
                ModuleId = module.Id,
                Type = module.Type,
                ViewKey = entry.key ?? "",
                Variant = module.Config.Text("variant"),
                Rotation = module.Rotation,
                Neighbours = neighbours,
            };
            float yaw = SelectedYaw(req, out _, out _, out bool composeArms, out _);
            if (composeArms) return false;
            worldPos = ModulePlacement.Position(module, entry);
            worldPos.y += lift;
            var holderRot = ModulePlacement.Rotation(module.Rotation);
            var offset = Quaternion.Euler(0f, Mathf.DeltaAngle(ModulePlacement.Yaw(module.Rotation), yaw), 0f);
            worldRot = holderRot * entry.prefab.transform.localRotation * offset;
            worldScale = entry.prefab.transform.localScale;
            return true;
        }

        /// <summary>Build one module; returns the report with <see cref="OutdoorModuleView.Instance"/> null on failure.</summary>
        public static bool TryBuild(OutdoorModuleRequest request, Transform parent, out OutdoorModuleView view) =>
            TryBuild(request, parent, null, out view);

        /// <summary>
        /// Build every tree and fence record of a station under `parent`, in document
        /// order, and report the outcome per module. This is the whole-family entry a
        /// host renderer needs: it resolves through `ModuleViews.Resolve`, places the
        /// per-module pivot with the shared conversion, instantiates the prefab and
        /// hands back the built view (for the host's module-ID/pick registration) or
        /// the failure diagnostic. Nothing is drawn for a failure. Returns the number
        /// of instances built. The caller owns `parent`; failed holders are destroyed.
        /// </summary>
        public static int BuildAll(IReadOnlyList<ModuleFacts> station, RuntimeCatalogue catalogue, Transform parent,
            Action<ModuleFacts, OutdoorModuleView> built, Action<ModuleFacts, string> unresolved = null) {
            if (station == null || parent == null) return 0;
            // RCA 15 §4: one connection index for the whole document, built once here and shared
            // by every fence in the pass (it answers fences, gate machine faces and rail landings).
            var connections = StationFenceConnections.For(station);
            var surfaceLift = StationOutdoorSurfaceLift.ForFacts(station);
            int count = 0;
            for (int i = 0; i < station.Count; i++) {
                var module = station[i];
                if (module == null || !Owns(module.Type)) continue;
                if (catalogue == null) {
                    unresolved?.Invoke(module, "unresolved:no-prefab:" + module.Type);
                    continue;
                }
                var visual = ModuleViews.Resolve(module, station, catalogue);
                if (!visual.HasModel) {
                    unresolved?.Invoke(module, "unresolved:" + (visual.Detail.Length > 0 ? visual.Detail : "no-view"));
                    continue;
                }
                if (!catalogue.TryGet(visual.Key, out var entry) || entry.prefab == null) {
                    unresolved?.Invoke(module, "unresolved:no-prefab:" + visual.Key);
                    continue;
                }
                var holder = new GameObject(string.IsNullOrEmpty(module.Id) ? "outdoor pivot" : module.Id + " pivot").transform;
                holder.SetParent(parent, false);
                var pos = ModulePlacement.Position(module, entry);
                pos.y += surfaceLift.LiftOf(module);
                holder.SetPositionAndRotation(pos, ModulePlacement.Rotation(module.Rotation));
                var request = new OutdoorModuleRequest {
                    ModuleId = module.Id,
                    Type = module.Type,
                    ViewKey = visual.Key,
                    Variant = module.Config.Text("variant"),
                    Mount = module.Config.Text("mount"),
                    ConfigJson = "",
                    DimensionsJson = module.Width + "x" + module.Depth,
                    X = module.X, Y = module.Y, Z = module.Z,
                    Rotation = module.Rotation,
                    Width = module.Width, Depth = module.Depth,
                    Prefab = entry.prefab,
                    Catalogue = catalogue,
                    Placement = OutdoorPlacement.ParentPlaced,
                    Neighbours = Neighbours(module, connections),
                };
                if (!TryBuild(request, holder, null, out var view)) {
                    unresolved?.Invoke(module, view.Diagnostic);
                    Discard(holder.gameObject);
                    continue;
                }
                count++;
                built?.Invoke(module, view);
            }
            return count;
        }

        /// <summary>
        /// Instantiate the resolved prefab under `parent`. Returns true only when a
        /// model instance exists; a false return creates nothing and names the
        /// reason in <see cref="OutdoorModuleView.Diagnostic"/>, so the caller can
        /// publish an explicit unresolved diagnostic instead of drawing a box.
        /// </summary>
        public static bool TryBuild(OutdoorModuleRequest request, Transform parent, List<Renderer> outRenderers,
            out OutdoorModuleView view) {
            view = new OutdoorModuleView {
                ModuleId = request.ModuleId ?? "",
                Type = request.Type ?? "",
                ViewKey = request.ViewKey ?? "",
                Variant = request.Variant ?? "",
            };
            if (parent == null) return Fail(view, "no-parent");
            if (!Owns(request.Type)) return Fail(view, "unsupported-type:" + (request.Type ?? ""));
            if (string.IsNullOrEmpty(request.ViewKey)) return Fail(view, "no-key");

            RuntimeCatalogue.Entry entry = null;
            bool hasEntry = request.Catalogue != null && request.Catalogue.TryGet(request.ViewKey, out entry);
            if (hasEntry) {
                view.PrefabPath = entry.prefabPath ?? "";
                if (entry.kind != "prefab" && entry.kind != "live")
                    return Fail(view, "not-a-prefab-key:" + request.ViewKey + ":" + (entry.kind ?? ""));
            }
            var prefab = request.Prefab;
            if (prefab == null) {
                if (!hasEntry || entry.prefab == null) return Fail(view, "no-prefab:" + request.ViewKey);
                prefab = entry.prefab;
            } else if (hasEntry && entry.prefab != null && entry.prefab != prefab) {
                // A valid key must use the catalogue's prefab; anything else would be a
                // silent variant substitution (the failure the negative test pins).
                return Fail(view, "prefab-key-mismatch:" + request.ViewKey);
            }

            var caveats = new List<string>();
            var expected = ExpectedKey(request.Type, request.Variant);
            if (!string.IsNullOrEmpty(expected) && expected != request.ViewKey) {
                caveats.Add("variant-key-mismatch:" + DescribeVariant(request.Variant) + "->" + expected + "!=" + request.ViewKey);
            }
            if (string.Equals(request.Type, TreeKey, StringComparison.Ordinal) && !string.IsNullOrEmpty(request.Variant)) {
                caveats.Add("tree-variant-ignored:" + request.Variant + " (one promoted species: street ash, full detail)");
            }
            var mount = request.Mount ?? "";
            if (mount.Length > 0 && !string.Equals(mount, "floor", StringComparison.Ordinal)) {
                caveats.Add("mount-not-applied:" + mount);
            }
            int width = Math.Max(1, request.Width), depth = Math.Max(1, request.Depth);
            if (width != 1 || depth != 1) caveats.Add("dimensions-not-scaled:" + width + "x" + depth);

            float yaw = SelectedYaw(request, out var yawSource, out bool panelExtent, out bool composeArms, out var armCaveat);
            if (!string.IsNullOrEmpty(armCaveat)) caveats.Add(armCaveat);

            Quaternion offset;
            if (request.Placement == OutdoorPlacement.ParentPlaced) {
                // The parent already carries the saved quarter turn; only the delta the
                // neighbour rule adds is applied here.
                offset = Quaternion.Euler(0f, Mathf.DeltaAngle(ModulePlacement.Yaw(request.Rotation), yaw), 0f);
            } else {
                offset = Quaternion.Euler(0f, yaw, 0f);
            }

            var instance = UnityEngine.Object.Instantiate(prefab, parent, false);
            instance.name = string.IsNullOrEmpty(request.ModuleId) ? prefab.name : request.ModuleId;
            var transform = instance.transform;
            // Preserve any authored root pose and add the module transform the builder owns.
            var authored = transform.localRotation;
            transform.localPosition = Vector3.zero;
            transform.localRotation = authored * offset;

            var renderers = instance.GetComponentsInChildren<Renderer>(true);
            var filters = instance.GetComponentsInChildren<MeshFilter>(true);
            bool anyMesh = false, onlyPrimitives = filters.Length > 0;
            foreach (var filter in filters) {
                var mesh = filter.sharedMesh;
                if (!mesh) continue;
                anyMesh = true;
                if (!BuiltinMeshes.Contains(mesh.name)) onlyPrimitives = false;
            }
            if (!anyMesh || renderers.Length == 0 || onlyPrimitives) {
                Discard(instance);
                return Fail(view, onlyPrimitives ? "primitive-placeholder:" + request.ViewKey : "prefab-has-no-meshes:" + request.ViewKey);
            }

            // Compose connected fences (1-axis runs/ends AND 2-axis L/T/+ junctions) directly from
            // `FenceArms` + neighbor seal extensions so connected ends drop duplicate end posts and
            // seal flush into adjacent escalators, walkways, stairs, and fare gates.
            if (composeArms) {
                if (TryComposeFenceArms(request, instance, out var composed, out var composedRenderers, out var count, out var failure)) {
                    Discard(instance);
                    instance = composed;
                    transform = instance.transform;
                    transform.localPosition = Vector3.zero;
                    // Composed arms are authored directly in the document cell frame (x = east, z = north),
                    // so cancel any saved parent rotation on the holder.
                    transform.localRotation = request.Placement == OutdoorPlacement.ParentPlaced
                        ? Quaternion.Euler(0f, -ModulePlacement.Yaw(request.Rotation), 0f)
                        : Quaternion.identity;
                    renderers = composedRenderers;
                    view.ComposedArms = count;
                    panelExtent = true;
                    caveats.Add("fence-arms-composed:" + count + "arms");
                } else {
                    caveats.Add(failure);
                }
            }

            int triangles = 0;
            foreach (var filter in instance.GetComponentsInChildren<MeshFilter>(true)) {
                var mesh = filter.sharedMesh;
                if (!mesh) continue;
                triangles += MeshTriangles(mesh);
            }

            view.Instance = instance;
            view.Renderers = renderers;
            view.TriangleCount = triangles;
            view.Bounds = WorldBounds(renderers, transform.position);
            view.Animated = false;
            view.Yaw = yaw;
            view.YawSource = yawSource;
            view.PanelExtentMatchesSource = panelExtent;
            view.NeighbourDegree = string.Equals(request.Type, "fence", StringComparison.Ordinal) && request.Neighbours.Known
                ? request.Neighbours.Degree : -1;
            view.Diagnostic = caveats.Count == 0 ? "" : string.Join("; ", caveats);
            if (outRenderers != null) {
                foreach (var renderer in renderers) outRenderers.Add(renderer);
            }
            return true;
        }

        static bool Fail(OutdoorModuleView view, string reason) {
            view.Diagnostic = "unresolved:" + reason;
            return false;
        }

        /// <summary>
        /// Compose the arms `FenceArms` computes for any connected fence (straight run, run end,
        /// or L/T/+ junction) across `glass`, `iron`, `gate`, and `steel-blue`, extending any arm
        /// that meets an inset balustrade/rail/barrier so the joint is physically sealed.
        /// </summary>
        static bool TryComposeFenceArms(OutdoorModuleRequest request, GameObject panel, out GameObject composed,
            out Renderer[] renderers, out int armCount, out string failure) {
            composed = null;
            renderers = null;
            armCount = 0;
            failure = "";
            var variant = string.IsNullOrEmpty(request.Variant) ? "glass" : request.Variant;
            if (variant != "glass" && variant != "iron" && variant != "gate" && variant != "steel-blue") {
                failure = "fence-arms-uncomposed:variant:" + variant;
                return false;
            }
            if (!OpeningModuleViews.MeshBoundsIn(panel.transform, panel.transform, out var bounds)) {
                failure = "fence-arms-unmeasured:no-bounds";
                return false;
            }
            var size = bounds.size;
            float expectedHeight = variant == "steel-blue" ? 2f : 1f;
            float maxThickness = variant == "iron" ? 0.45f : 0.3f;
            if (Mathf.Abs(size.x - 1f) > .08f || Mathf.Abs(size.y - expectedHeight) > .15f || size.z > maxThickness) {
                failure = "fence-arms-unmeasured:" + Size(size.x) + "x" + Size(size.y) + "x" + Size(size.z);
                return false;
            }
            Material steel = null, glass = null, darkSteel = null, blueSteel = null;
            if (variant == "glass" || variant == "gate") {
                if (!TryExtractFenceMaterials(panel, out steel, out glass)) {
                    failure = "fence-arms-unmaterialised:" + (steel == null ? "steel" : "") + (glass == null ? (steel == null ? "+glass" : "glass") : "");
                    return false;
                }
                if (variant == "gate") {
                    darkSteel = ExtractNamedMaterial(panel, "darkSteel") ?? steel;
                }
            } else if (variant == "iron") {
                steel = ExtractNamedMaterial(panel, "steel") ?? FirstMaterial(panel);
                if (steel == null) { failure = "fence-arms-unmaterialised:steel"; return false; }
            } else if (variant == "steel-blue") {
                blueSteel = FirstMaterial(panel);
                if (blueSteel == null) { failure = "fence-arms-unmaterialised:steel-blue"; return false; }
            }

            var root = BuildComposedFenceObject(
                string.IsNullOrEmpty(request.ModuleId) ? "fence arms" : request.ModuleId,
                variant, request.Rotation, request.Neighbours, panel.transform.parent,
                steel, glass, darkSteel, blueSteel, out armCount);
            if (root == null) {
                failure = "fence-arms-empty";
                return false;
            }
            composed = root;
            renderers = root.GetComponentsInChildren<Renderer>(true);
            return true;
        }

        /// <summary>
        /// Build a composed fence mesh tree for a live placement or drag preview using one shared
        /// ghost material (no prefab instantiation required when previewing).
        /// </summary>
        public static bool TryBuildFencePreview(string moduleId, string variant, int rotation,
            OutdoorNeighbours neighbours, Transform parent, Material ghostMaterial, out GameObject root) {
            root = null;
            if (parent == null || ghostMaterial == null) return false;
            var normalized = string.IsNullOrEmpty(variant) ? "glass" : variant;
            if (normalized != "glass" && normalized != "iron" && normalized != "gate" && normalized != "steel-blue") {
                return false;
            }
            root = BuildComposedFenceObject(
                string.IsNullOrEmpty(moduleId) ? "ghost fence" : moduleId,
                normalized, rotation, neighbours, parent,
                ghostMaterial, ghostMaterial, ghostMaterial, ghostMaterial, out _);
            return root != null;
        }

        static GameObject BuildComposedFenceObject(string name, string variant, int rotation,
            OutdoorNeighbours neighbours, Transform parent,
            Material steel, Material glass, Material darkSteel, Material blueSteel, out int armCount) {
            armCount = 0;
            var arms = FenceArms(rotation, neighbours);
            float sealW = neighbours.West ? neighbours.SealWest : 0f;
            float sealE = neighbours.East ? neighbours.SealEast : 0f;
            float sealS = neighbours.South ? neighbours.SealSouth : 0f;
            float sealN = neighbours.North ? neighbours.SealNorth : 0f;
            float x0 = arms.X0 - sealW;
            float x1 = arms.X1 + sealE;
            float y0 = arms.Y0 - sealS;
            float y1 = arms.Y1 + sealN;

            var root = new GameObject(name);
            root.transform.SetParent(parent, false);

            if (variant == "steel-blue") {
                var verts = new List<Vector3>();
                var tris = new List<int>();
                if (arms.RunsAlongX) { AppendBlueSteelRail(verts, tris, x0, x1, false); armCount++; }
                if (arms.RunsAlongY) { AppendBlueSteelRail(verts, tris, y0, y1, true); armCount++; }
                AppendBlueSteelPost(verts, tris, 0f, 0f);
                if (arms.CapEast) AppendBlueSteelPost(verts, tris, .46f, 0f);
                if (arms.CapWest) AppendBlueSteelPost(verts, tris, -.46f, 0f);
                if (arms.CapNorth) AppendBlueSteelPost(verts, tris, 0f, .46f);
                if (arms.CapSouth) AppendBlueSteelPost(verts, tris, 0f, -.46f);
                AddPart(root.transform, "fence arms steel-blue", verts, tris, blueSteel);
                return root;
            }

            var steelVertices = new List<Vector3>();
            var steelTriangles = new List<int>();
            var glassVertices = new List<Vector3>();
            var glassTriangles = new List<int>();
            var darkVertices = new List<Vector3>();
            var darkTriangles = new List<int>();

            if (variant == "iron") {
                bool onlyY = !arms.RunsAlongX && arms.RunsAlongY;
                if (arms.RunsAlongX) { AppendIronRail(steelVertices, steelTriangles, x0, x1, false); armCount++; }
                if (arms.RunsAlongY) { AppendIronRail(steelVertices, steelTriangles, y0, y1, true); armCount++; }
                AppendIronPost(steelVertices, steelTriangles, 0f, 0f, onlyY);
                if (arms.CapEast) AppendIronPost(steelVertices, steelTriangles, .46f, 0f, false);
                if (arms.CapWest) AppendIronPost(steelVertices, steelTriangles, -.46f, 0f, false);
                if (arms.CapNorth) AppendIronPost(steelVertices, steelTriangles, 0f, .46f, true);
                if (arms.CapSouth) AppendIronPost(steelVertices, steelTriangles, 0f, -.46f, true);
                AddPart(root.transform, "fence arms iron", steelVertices, steelTriangles, steel);
                return root;
            }

            bool isGate = variant == "gate";
            bool flushW = neighbours.West && neighbours.PillarWest;
            bool flushE = neighbours.East && neighbours.PillarEast;
            bool flushS = neighbours.South && neighbours.PillarSouth;
            bool flushN = neighbours.North && neighbours.PillarNorth;
            if (arms.RunsAlongX) {
                if (isGate) AppendGateRail(steelVertices, steelTriangles, glassVertices, glassTriangles, darkVertices, darkTriangles, x0, x1, false, sealW > 1e-4f, sealE > 1e-4f, flushW, flushE);
                else AppendFenceRail(steelVertices, steelTriangles, glassVertices, glassTriangles, x0, x1, false, sealW > 1e-4f, sealE > 1e-4f, flushW, flushE);
                armCount++;
            }
            if (arms.RunsAlongY) {
                if (isGate) AppendGateRail(steelVertices, steelTriangles, glassVertices, glassTriangles, darkVertices, darkTriangles, y0, y1, true, sealS > 1e-4f, sealN > 1e-4f, flushS, flushN);
                else AppendFenceRail(steelVertices, steelTriangles, glassVertices, glassTriangles, y0, y1, true, sealS > 1e-4f, sealN > 1e-4f, flushS, flushN);
                armCount++;
            }
            if (!isGate) AppendFencePost(steelVertices, steelTriangles, 0f, 0f);
            if (arms.CapEast || (isGate && arms.X1 > 0f)) AppendFencePost(steelVertices, steelTriangles, .46f, 0f);
            if (arms.CapWest || (isGate && arms.X0 < 0f)) AppendFencePost(steelVertices, steelTriangles, -.46f, 0f);
            if (arms.CapNorth || (isGate && arms.Y1 > 0f)) AppendFencePost(steelVertices, steelTriangles, 0f, .46f);
            if (arms.CapSouth || (isGate && arms.Y0 < 0f)) AppendFencePost(steelVertices, steelTriangles, 0f, -.46f);

            AddPart(root.transform, "fence arms steel", steelVertices, steelTriangles, steel);
            AddPart(root.transform, "fence arms glass", glassVertices, glassTriangles, glass);
            if (darkVertices.Count > 0) AddPart(root.transform, "fence arms latch", darkVertices, darkTriangles, darkSteel ?? steel);
            return root;
        }

        static Material ExtractNamedMaterial(GameObject prefab, string targetName) {
            if (!prefab) return null;
            foreach (var renderer in prefab.GetComponentsInChildren<MeshRenderer>(true)) {
                foreach (var material in renderer.sharedMaterials) {
                    if (!material) continue;
                    if (string.Equals(MaterialBaseName(material.name), targetName, StringComparison.OrdinalIgnoreCase))
                        return material;
                }
            }
            return null;
        }

        static Material FirstMaterial(GameObject prefab) {
            if (!prefab) return null;
            foreach (var renderer in prefab.GetComponentsInChildren<MeshRenderer>(true)) {
                foreach (var material in renderer.sharedMaterials) {
                    if (material != null) return material;
                }
            }
            return null;
        }

        /// <summary>Strip Unity's ` (Instance)` / importer suffix from a material name.</summary>
        public static string MaterialBaseName(string name) {
            if (string.IsNullOrEmpty(name)) return "";
            int suffix = name.IndexOf(" (", StringComparison.Ordinal);
            return (suffix > 0 ? name.Substring(0, suffix) : name).Trim();
        }

        /// <summary>
        /// Extract the exact `steel` and `glass` materials from `Fence.prefab` (never matching
        /// `darkSteel`, `tintedGlass`, or `trainGlass` via substring).
        /// </summary>
        public static bool TryExtractFenceMaterials(GameObject prefab, out Material steel, out Material glass) {
            steel = null;
            glass = null;
            if (!prefab) return false;
            foreach (var renderer in prefab.GetComponentsInChildren<MeshRenderer>(true)) {
                foreach (var material in renderer.sharedMaterials) {
                    if (!material) continue;
                    var baseName = MaterialBaseName(material.name);
                    if (steel == null && string.Equals(baseName, "steel", StringComparison.OrdinalIgnoreCase)) steel = material;
                    else if (glass == null && string.Equals(baseName, "glass", StringComparison.OrdinalIgnoreCase)) glass = material;
                }
            }
            return steel != null && glass != null;
        }

        /// <summary>
        /// One arm of `drawFence`: the steel top rail at 0.97 m, the glass panel between 0.11 and
        /// 0.89 m, and the paired clamps at each end (`PieceBuilder.drawFence`, glass variant).
        /// Shared with the doorless gate's lane panel (18 §5), which draws the same arm from the
        /// machine's jamb to the cell edge.
        /// </summary>
        public static void AppendFenceRail(List<Vector3> steelVertices, List<int> steelTriangles,
            List<Vector3> glassVertices, List<int> glassTriangles, float a, float b, bool alongY,
            bool sealLo = false, bool sealHi = false, bool flushLo = false, bool flushHi = false) {
            float lo = Mathf.Min(a, b), hi = Mathf.Max(a, b);
            float length = hi - lo;
            if (length <= 1e-6f) return;
            AppendTube(steelVertices, steelTriangles,
                alongY ? new Vector3(0f, .97f, lo) : new Vector3(lo, .97f, 0f),
                alongY ? new Vector3(0f, .97f, hi) : new Vector3(hi, .97f, 0f), .029f);
            float glassLo = (sealLo || flushLo) ? lo : lo + .006f;
            float glassHi = (sealHi || flushHi) ? hi : hi - .006f;
            float glassLength = Mathf.Max(.01f, glassHi - glassLo);
            float glassMid = (glassLo + glassHi) * .5f;
            BoxFaces.AppendAxisAligned(glassVertices, glassTriangles,
                alongY ? new Vector3(0f, .5f, glassMid) : new Vector3(glassMid, .5f, 0f),
                alongY ? new Vector3(.012f, .78f, glassLength) : new Vector3(glassLength, .78f, .012f));
            float clampLo = flushLo ? lo + .0275f : (sealLo ? Mathf.Max(lo, -.5f) + .045f : lo + .045f);
            float clampHi = flushHi ? hi - .0275f : (sealHi ? Mathf.Min(hi, .5f) - .045f : hi - .045f);
            for (int end = 0; end < 2; end++) {
                float at = end == 0 ? clampLo : clampHi;
                for (int step = 0; step < 2; step++) {
                    float z = step == 0 ? .18f : .78f;
                    BoxFaces.AppendAxisAligned(steelVertices, steelTriangles,
                        alongY ? new Vector3(0f, z, at) : new Vector3(at, z, 0f),
                        alongY ? new Vector3(.044f, .032f, .055f) : new Vector3(.055f, .032f, .044f));
                }
            }
        }

        static void AppendGateRail(List<Vector3> steelVertices, List<int> steelTriangles,
            List<Vector3> glassVertices, List<int> glassTriangles,
            List<Vector3> darkVertices, List<int> darkTriangles,
            float a, float b, bool alongY, bool sealLo, bool sealHi, bool flushLo = false, bool flushHi = false) {
            float lo = Mathf.Min(a, b), hi = Mathf.Max(a, b);
            float length = hi - lo;
            if (length <= 1e-6f) return;
            AppendTube(steelVertices, steelTriangles,
                alongY ? new Vector3(0f, .97f, lo) : new Vector3(lo, .97f, 0f),
                alongY ? new Vector3(0f, .97f, hi) : new Vector3(hi, .97f, 0f), .029f);
            float glassLo = (sealLo || flushLo) ? lo : lo + .006f;
            float glassHi = (sealHi || flushHi) ? hi : hi - .006f;
            float glassLength = Mathf.Max(.01f, glassHi - glassLo);
            float glassMid = (glassLo + glassHi) * .5f;
            BoxFaces.AppendAxisAligned(glassVertices, glassTriangles,
                alongY ? new Vector3(0f, .545f, glassMid) : new Vector3(glassMid, .545f, 0f),
                alongY ? new Vector3(.012f, .69f, glassLength) : new Vector3(glassLength, .69f, .012f));
            float clampLo = flushLo ? lo + .0275f : (sealLo ? Mathf.Max(lo, -.5f) + .045f : lo + .045f);
            float clampHi = flushHi ? hi - .0275f : (sealHi ? Mathf.Min(hi, .5f) - .045f : hi - .045f);
            for (int end = 0; end < 2; end++) {
                float at = end == 0 ? clampLo : clampHi;
                for (int step = 0; step < 2; step++) {
                    float z = step == 0 ? .27f : .78f;
                    BoxFaces.AppendAxisAligned(steelVertices, steelTriangles,
                        alongY ? new Vector3(0f, z, at) : new Vector3(at, z, 0f),
                        alongY ? new Vector3(.044f, .032f, .055f) : new Vector3(.055f, .032f, .044f));
                }
            }
            AppendTube(steelVertices, steelTriangles,
                alongY ? new Vector3(0f, .2f, lo + .04f) : new Vector3(lo + .04f, .2f, 0f),
                alongY ? new Vector3(0f, .2f, hi - .04f) : new Vector3(hi - .04f, .2f, 0f), .018f);
            foreach (float hz in new[] { .3f, .77f }) {
                AppendTube(steelVertices, steelTriangles,
                    alongY ? new Vector3(0f, hz - .045f, clampLo) : new Vector3(clampLo, hz - .045f, 0f),
                    alongY ? new Vector3(0f, hz + .045f, clampLo) : new Vector3(clampLo, hz + .045f, 0f), .038f);
            }
            float latchAt = clampHi - .045f;
            BoxFaces.AppendAxisAligned(darkVertices, darkTriangles,
                alongY ? new Vector3(0f, .76f, latchAt) : new Vector3(latchAt, .76f, 0f),
                alongY ? new Vector3(.065f, .035f, .1f) : new Vector3(.1f, .035f, .065f));
        }

        static void AppendIronRail(List<Vector3> vertices, List<int> triangles, float a, float b, bool alongY) {
            float lo = Mathf.Min(a, b), hi = Mathf.Max(a, b);
            float length = hi - lo;
            if (length <= 1e-6f) return;
            AppendTube(vertices, triangles,
                alongY ? new Vector3(0f, .97f, lo) : new Vector3(lo, .97f, 0f),
                alongY ? new Vector3(0f, .97f, hi) : new Vector3(hi, .97f, 0f), .029f);
            AppendTube(vertices, triangles,
                alongY ? new Vector3(0f, .13f, lo) : new Vector3(lo, .13f, 0f),
                alongY ? new Vector3(0f, .13f, hi) : new Vector3(hi, .13f, 0f), .019f);
            int count = Mathf.Max(1, Mathf.RoundToInt(length / .125f));
            for (int i = 0; i < count; i++) {
                float s = lo + (i + .5f) * length / count;
                AppendTube(vertices, triangles,
                    alongY ? new Vector3(0f, .13f, s) : new Vector3(s, .13f, 0f),
                    alongY ? new Vector3(0f, .945f, s) : new Vector3(s, .945f, 0f), .012f);
            }
        }

        static void AppendIronPost(List<Vector3> vertices, List<int> triangles, float x, float y, bool alongY) {
            AppendTube(vertices, triangles, new Vector3(x, .035f, y), new Vector3(x, .97f, y), .024f);
            AppendTube(vertices, triangles,
                new Vector3(x - (alongY ? .18f : 0f), .035f, y - (alongY ? 0f : .18f)),
                new Vector3(x + (alongY ? .18f : 0f), .035f, y + (alongY ? 0f : .18f)), .022f);
        }

        static void AppendBlueSteelRail(List<Vector3> vertices, List<int> triangles, float a, float b, bool alongY) {
            float lo = Mathf.Min(a, b), hi = Mathf.Max(a, b);
            float length = hi - lo;
            if (length <= 1e-6f) return;
            foreach (float z in new[] { .06f, .72f, 1.975f }) {
                AppendTube(vertices, triangles,
                    alongY ? new Vector3(0f, z, lo) : new Vector3(lo, z, 0f),
                    alongY ? new Vector3(0f, z, hi) : new Vector3(hi, z, 0f), .025f);
            }
            float mid = (lo + hi) * .5f;
            BoxFaces.AppendAxisAligned(vertices, triangles,
                alongY ? new Vector3(0f, .39f, mid) : new Vector3(mid, .39f, 0f),
                alongY ? new Vector3(.018f, .6f, length) : new Vector3(length, .6f, .018f));
            const float bottom = .75f, top = 1.95f;
            for (int slopeSign = -1; slopeSign <= 1; slopeSign += 2) {
                float slope = slopeSign;
                for (float intercept = bottom - hi - 2f; intercept <= top + hi + 2f; intercept += .14f) {
                    float segLo = Mathf.Max(lo + .006f, slope > 0f ? bottom - intercept : intercept - top);
                    float segHi = Mathf.Min(hi - .006f, slope > 0f ? top - intercept : intercept - bottom);
                    if (segHi - segLo < .001f) continue;
                    float yLo = slope * segLo + intercept;
                    float yHi = slope * segHi + intercept;
                    AppendTube(vertices, triangles,
                        alongY ? new Vector3(0f, yLo, segLo) : new Vector3(segLo, yLo, 0f),
                        alongY ? new Vector3(0f, yHi, segHi) : new Vector3(segHi, yHi, 0f), .004f, 6);
                }
            }
        }

        static void AppendBlueSteelPost(List<Vector3> vertices, List<int> triangles, float x, float y) {
            BoxFaces.AppendAxisAligned(vertices, triangles, new Vector3(x, 1f, y), new Vector3(.045f, 2f, .045f));
            BoxFaces.AppendAxisAligned(vertices, triangles, new Vector3(x, .015f, y), new Vector3(.08f, .03f, .08f));
        }

        /// <summary>One post of `fencePost`: the floor shoe, the upright tube and its two clamps.</summary>
        public static void AppendFencePost(List<Vector3> vertices, List<int> triangles, float x, float y) {
            BoxFaces.AppendAxisAligned(vertices, triangles, new Vector3(x, .018f, y), new Vector3(.11f, .036f, .11f));
            AppendTube(vertices, triangles, new Vector3(x, .035f, y), new Vector3(x, .97f, y), .026f);
            for (int step = 0; step < 2; step++) {
                float z = step == 0 ? .23f : .78f;
                BoxFaces.AppendAxisAligned(vertices, triangles, new Vector3(x, z, y), new Vector3(.075f, .035f, .055f));
            }
        }

        /// <summary>
        /// A capped tube between two points — `fenceTube`'s 12-sided cylinder.
        /// Side wall and end caps use separate ring vertices (like Three.js `CylinderGeometry`) so
        /// `RecalculateNormals` keeps pure smooth radial normals on the barrel instead of bending
        /// them 45° into the flat end caps.
        /// </summary>
        static void AppendTube(List<Vector3> vertices, List<int> triangles, Vector3 a, Vector3 b, float radius, int segments = 12) {
            var axis = b - a;
            if (axis.sqrMagnitude < 1e-12f) return;
            var direction = axis.normalized;
            var up = Mathf.Abs(Vector3.Dot(direction, Vector3.up)) > .99f ? Vector3.forward : Vector3.up;
            var right = Vector3.Cross(up, direction).normalized;
            var forward = Vector3.Cross(direction, right).normalized;
            int start = vertices.Count;
            for (int ring = 0; ring < 2; ring++) {
                var centre = ring == 0 ? a : b;
                for (int i = 0; i < segments; i++) {
                    float angle = Mathf.PI * 2f * i / segments;
                    vertices.Add(centre + right * (Mathf.Cos(angle) * radius) + forward * (Mathf.Sin(angle) * radius));
                }
            }
            for (int i = 0; i < segments; i++) {
                int next = (i + 1) % segments;
                int a0 = start + i, a1 = start + next;
                int b0 = start + segments + i, b1 = start + segments + next;
                triangles.Add(a0); triangles.Add(a1); triangles.Add(b0);
                triangles.Add(a1); triangles.Add(b1); triangles.Add(b0);
            }
            int capRingA = vertices.Count;
            for (int i = 0; i < segments; i++) vertices.Add(vertices[start + i]);
            int capRingB = vertices.Count;
            for (int i = 0; i < segments; i++) vertices.Add(vertices[start + segments + i]);
            int caps = vertices.Count;
            vertices.Add(a);
            vertices.Add(b);
            for (int i = 0; i < segments; i++) {
                int next = (i + 1) % segments;
                triangles.Add(caps); triangles.Add(capRingA + next); triangles.Add(capRingA + i);
                triangles.Add(caps + 1); triangles.Add(capRingB + i); triangles.Add(capRingB + next);
            }
        }

        public static void AddPart(Transform parent, string name, List<Vector3> vertices, List<int> triangles,
            Material material, OpeningPalette palette = null) {
            if (vertices.Count == 0 || triangles.Count == 0 || material == null) return;
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            var normals = mesh.normals;
            var uvs = new Vector2[vertices.Count];
            for (int i = 0; i < vertices.Count; i++) {
                var p = vertices[i];
                var n = i < normals.Length ? normals[i] : Vector3.up;
                float ax = Mathf.Abs(n.x), ay = Mathf.Abs(n.y), az = Mathf.Abs(n.z);
                if (ay >= ax && ay >= az) uvs[i] = new Vector2(p.x, p.z);
                else if (az >= ax) uvs[i] = new Vector2(p.x, p.y);
                else uvs[i] = new Vector2(p.z, p.y);
            }
            mesh.SetUVs(0, uvs);
            mesh.RecalculateBounds();
            if (palette != null) palette.Own(mesh);
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        }

        static string Size(float value) => value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);

        static string DescribeVariant(string variant) => string.IsNullOrEmpty(variant) ? "(none)" : variant;

        /// <summary>
        /// The panel yaw. A tree keeps the saved turn (`placeLocal` turns the tree
        /// group). A fence uses the arm axis the source bakes into its geometry:
        /// `FenceModel.build` never rotates its group, so a connected cell's axis is
        /// its neighbour set, and a saved `rot` that disagrees must not win. A
        /// junction (two axes) keeps the saved turn's axis because one promoted
        /// panel cannot cover both arms.
        /// </summary>
        static float SelectedYaw(OutdoorModuleRequest request, out OutdoorYawSource source, out bool panelExtent,
            out bool composeArms, out string caveat) {
            caveat = "";
            panelExtent = true;
            composeArms = false;
            source = OutdoorYawSource.SavedRotation;
            float saved = ModulePlacement.Yaw(request.Rotation);
            if (!string.Equals(request.Type, "fence", StringComparison.Ordinal)) return saved;
            if (IsNoiseBarrier(request.Variant, request.ViewKey)) return saved;
            if (!request.Neighbours.Known) {
                caveat = "neighbours-unknown:saved-turn";
                panelExtent = false;
                return saved;
            }
            var arms = FenceArms(request.Rotation, request.Neighbours);
            bool x = arms.RunsAlongX, y = arms.RunsAlongY;
            if (!x && !y) {
                panelExtent = false;
                return saved;
            }
            if (request.Neighbours.Degree == 0) return saved;
            // Every connected fence (1-axis straight runs / run ends and 2-axis L/T/+ junctions)
            // composes its computed arms directly in the cell frame so connected sides drop
            // redundant end posts and seal cleanly against inset escalators/stairs/gates.
            composeArms = true;
            if (x && y) {
                panelExtent = false;
                return 0f;
            }
            source = OutdoorYawSource.ArmAxis;
            return x ? 0f : -90f;
        }

        static int MeshTriangles(Mesh mesh) {
            long count = 0;
            for (int i = 0; i < mesh.subMeshCount; i++) {
                uint indices = mesh.GetIndexCount(i);
                count += indices > 0 ? indices / 3 : 0;
            }
            if (count == 0 && mesh.vertexCount > 0) count = mesh.vertexCount / 3;
            return (int)Math.Min(count, int.MaxValue);
        }

        static Bounds WorldBounds(Renderer[] renderers, Vector3 fallback) {
            var bounds = new Bounds(fallback, Vector3.zero);
            bool first = true;
            foreach (var renderer in renderers) {
                if (!renderer || !renderer.enabled) continue;
                if (first) { bounds = renderer.bounds; first = false; }
                else bounds.Encapsulate(renderer.bounds);
            }
            return bounds;
        }

        static void Discard(GameObject instance) {
            if (!instance) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(instance);
            else UnityEngine.Object.DestroyImmediate(instance);
        }

        static int NormTurn(int turn) => ((turn % 4) + 4) % 4;
    }
}
