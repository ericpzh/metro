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

        public int Degree => (East ? 1 : 0) + (West ? 1 : 0) + (North ? 1 : 0) + (South ? 1 : 0);
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
        /// Connectivity for a fence cell from the document's own modules, matching
        /// `fenceConnectionIndex` for fences. Two neighbour kinds the TypeScript
        /// index also reads are not projected yet and are therefore not reported: a
        /// fare gate's machine face (`gateSolidFaces`) and a stair/escalator/walkway
        /// landing (`railLandingAt`). Zoo has four gate links and eight landing
        /// links across its 213 fences; the eight that change the derived arm axis
        /// are listed in `unity/plan/11-evidence/B1.md`. The station index should
        /// own this rule once packet A publishes it; a family builder must not
        /// re-derive another family's landing cells.
        /// </summary>
        public static OutdoorNeighbours Neighbours(ModuleFacts module, IReadOnlyList<ModuleFacts> station) {
            var neighbours = new OutdoorNeighbours { Known = false };
            if (module == null || station == null) return neighbours;
            neighbours.Known = true;
            for (int i = 0; i < station.Count; i++) {
                var other = station[i];
                if (other == null || ReferenceEquals(other, module)) continue;
                if (!string.Equals(other.Type, "fence", StringComparison.Ordinal) || other.Z != module.Z) continue;
                int dx = other.X - module.X, dy = other.Y - module.Y;
                if (dx == 1 && dy == 0) neighbours.East = true;
                else if (dx == -1 && dy == 0) neighbours.West = true;
                else if (dx == 0 && dy == 1) neighbours.North = true;
                else if (dx == 0 && dy == -1) neighbours.South = true;
            }
            return neighbours;
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
                holder.SetPositionAndRotation(ModulePlacement.Position(module, entry), ModulePlacement.Rotation(module.Rotation));
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
                    Neighbours = Neighbours(module, station),
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

            float yaw = SelectedYaw(request, out var yawSource, out bool panelExtent, out var armCaveat);
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
            int triangles = 0;
            bool anyMesh = false, onlyPrimitives = filters.Length > 0;
            foreach (var filter in filters) {
                var mesh = filter.sharedMesh;
                if (!mesh) continue;
                anyMesh = true;
                if (!BuiltinMeshes.Contains(mesh.name)) onlyPrimitives = false;
                triangles += MeshTriangles(mesh);
            }
            if (!anyMesh || renderers.Length == 0 || onlyPrimitives) {
                Discard(instance);
                return Fail(view, onlyPrimitives ? "primitive-placeholder:" + request.ViewKey : "prefab-has-no-meshes:" + request.ViewKey);
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

        static string DescribeVariant(string variant) => string.IsNullOrEmpty(variant) ? "(none)" : variant;

        /// <summary>
        /// The panel yaw. A tree keeps the saved turn (`placeLocal` turns the tree
        /// group). A fence uses the arm axis the source bakes into its geometry:
        /// `FenceModel.build` never rotates its group, so a connected cell's axis is
        /// its neighbour set, and a saved `rot` that disagrees must not win. A
        /// junction (two axes) keeps the saved turn's axis because one promoted
        /// panel cannot cover both arms.
        /// </summary>
        static float SelectedYaw(OutdoorModuleRequest request, out OutdoorYawSource source, out bool panelExtent, out string caveat) {
            caveat = "";
            panelExtent = true;
            source = OutdoorYawSource.SavedRotation;
            float saved = ModulePlacement.Yaw(request.Rotation);
            if (!string.Equals(request.Type, "fence", StringComparison.Ordinal)) return saved;
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
            if (x && y) {
                panelExtent = false;
                caveat = "arm-composition-missing:two-axes";
                return NormTurn(request.Rotation) % 2 == 0 ? 0f : -90f;
            }
            if (request.Neighbours.Degree == 0) return saved;
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
