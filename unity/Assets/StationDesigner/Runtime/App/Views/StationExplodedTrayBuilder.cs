using System;
using System.Collections.Generic;
using System.Globalization;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App.Views {
    /// <summary>QA metadata for one clipped cross-storey ramp or bounded lift shaft slice.</summary>
    public readonly struct StationExplodedSliceRecord {
        public StationExplodedSliceRecord(
            string sourceModuleId,
            string kind,
            string partName,
            int trayIndex,
            int trayLevel,
            Bounds sourceDocumentBounds,
            int triangleCount) {
            SourceModuleId = sourceModuleId ?? "";
            Kind = kind ?? "";
            PartName = partName ?? "";
            TrayIndex = trayIndex;
            TrayLevel = trayLevel;
            SourceDocumentBounds = sourceDocumentBounds;
            TriangleCount = triangleCount;
        }

        public string SourceModuleId { get; }
        public string Kind { get; }
        public string PartName { get; }
        public int TrayIndex { get; }
        public int TrayLevel { get; }
        public Bounds SourceDocumentBounds { get; }
        public int TriangleCount { get; }
    }

    /// <summary>One rigid floor tray under the standalone exploded presentation root.</summary>
    public sealed class StationExplodedTrayInstance {
        internal readonly List<StationExplodedTrayBuilder.PickBucket> PickBuckets = new List<StationExplodedTrayBuilder.PickBucket>();
        internal readonly List<(MeshRenderer Renderer, Material SourceMaterial)> TintRenderers = new List<(MeshRenderer, Material)>();
        internal readonly Dictionary<Material, Material> ClonedBySource = new Dictionary<Material, Material>();
        internal bool IsTinted;

        public StationExplodedTrayInstance(
            int index,
            int level,
            int packedOffset,
            Vector3 packedDocumentOffset,
            Transform trayRoot,
            Transform floorRoot,
            Transform wallsRoot,
            Transform propsRoot,
            Transform liveRoot) {
            Index = index;
            Level = level;
            PackedOffset = packedOffset;
            PackedDocumentOffset = packedDocumentOffset;
            TrayRoot = trayRoot;
            FloorRoot = floorRoot;
            WallsRoot = wallsRoot;
            PropsRoot = propsRoot;
            LiveRoot = liveRoot;
            FloorVisible = true;
            WallsVisible = true;
            ManualOffset = Vector3.zero;
        }

        public int Index { get; }
        public int Level { get; }
        public int PackedOffset { get; }
        public Vector3 PackedDocumentOffset { get; }
        public Vector3 ManualOffset { get; internal set; }
        public bool FloorVisible { get; internal set; }
        public bool WallsVisible { get; internal set; }

        public Transform TrayRoot { get; }
        public Transform FloorRoot { get; }
        public Transform WallsRoot { get; }
        public Transform PropsRoot { get; }
        public Transform LiveRoot { get; }

        public Bounds SourceDocumentBounds { get; internal set; }
        public bool HasSourceBounds { get; internal set; }

        public Vector3 TotalDocumentOffset => PackedDocumentOffset + ManualOffset;
        public Vector3 WorldOffset => StationCoordinates.Point(TotalDocumentOffset);

        internal void EncapsulateDocumentPoint(Vector3 docPoint) {
            if (!HasSourceBounds) {
                SourceDocumentBounds = new Bounds(docPoint, Vector3.zero);
                HasSourceBounds = true;
            } else {
                var b = SourceDocumentBounds;
                b.Encapsulate(docPoint);
                SourceDocumentBounds = b;
            }
        }

        internal void EncapsulateWorldBounds(Bounds unshiftedWorldBounds) {
            for (int c = 0; c < 8; c++) {
                var worldCorner = new Vector3(
                    (c & 1) == 0 ? unshiftedWorldBounds.min.x : unshiftedWorldBounds.max.x,
                    (c & 2) == 0 ? unshiftedWorldBounds.min.y : unshiftedWorldBounds.max.y,
                    (c & 4) == 0 ? unshiftedWorldBounds.min.z : unshiftedWorldBounds.max.z);
                EncapsulateDocumentPoint(StationCoordinates.WorldToDocument(worldCorner));
            }
        }
    }

    /// <summary>
    /// Standalone exploded-view tray builder, CPU ray picker, dashed connector presenter, and
    /// live service pose follower (Plan 19 §2, §3, §4).
    ///
    /// Every tray is built once in unshifted source coordinates and positioned rigidly via
    /// <c>TrayRoot.localPosition = StationCoordinates.Point(packedDocumentOffset + manualOffset)</c>
    /// — never translating individual vertices during floor dragging.
    /// </summary>
    public sealed class StationExplodedTrayBuilder : IDisposable {
        public const string DefaultLayerName = "ExplodedPresentation";
        public const int FallbackLayer = 8;

        public static readonly Color SelectionTintColor = new Color(0x58 / 255f, 0xCA / 255f, 0xFF / 255f, 1f);
        public const float SelectionTintLerp = 0.28f;
        public static readonly Color SelectionEmissionAdd = new Color(0x12 / 255f, 0x36 / 255f, 0x4C / 255f, 1f);

        public static readonly Color GuideColor = new Color(0x8E / 255f, 0xD8 / 255f, 0xFF / 255f, 0.9f);
        public const float GuideDashMeters = 1.5f;
        public const float GuideGapMeters = 1.0f;

        static readonly int BaseColorId = Shader.PropertyToID("_BaseColor");
        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int EmissionColorId = Shader.PropertyToID("_EmissionColor");
        static readonly int DashSizeId = Shader.PropertyToID("_DashSize");
        static readonly int GapSizeId = Shader.PropertyToID("_GapSize");

        internal sealed class PickBucket {
            public Bounds SourceWorldBounds;
            public Vector3[] Vertices;
            public int[] Triangles;
            public bool IsFrontWall;
        }

        sealed class PropCombineBucket {
            public int TrayIndex;
            public Material SourceMaterial;
            public readonly List<Vector3> Positions = new List<Vector3>();
            public readonly List<Vector3> Normals = new List<Vector3>();
            public readonly List<Vector2> Uvs = new List<Vector2>();
            public readonly List<Color> Colors = new List<Color>();
            public readonly List<int> Indices = new List<int>();
        }

        sealed class LiftSliceBinding {
            public string SourceLiftId;
            public int TrayIndex;
            public int TrayLevel;
            public float FromZ;
            public float ToZ;
            public float SourceHiZ;
            public VerticalModuleView View;
        }

        sealed class EscalatorStepFollower {
            public Transform SourceTread;
            public Transform SourceRiser;
            public Transform TargetTread;
            public Transform TargetRiser;
        }

        sealed class EscalatorTrayBinding {
            public VerticalModuleView SourceView;
            public int TrayIndex;
            public float MinWorldY;
            public float MaxWorldY;
            public readonly List<EscalatorStepFollower> Steps = new List<EscalatorStepFollower>();
        }

        sealed class ConsistTrayBinding {
            public TrainConsistView View;
            public int TrayIndex;
        }

        struct RawPassengerSample {
            public StationPassengerFrame Frame;
            public int OwnerTrayIndex;
        }

        sealed class CachedSourceSubmesh {
            public Vector3[] Positions;
            public Vector3[] Normals;
            public Vector2[] Uvs;
            public Color[] Colors;
            public int[] Indices;
            public bool HasNormals;
        }

        readonly StationDocument document;
        readonly StationWorldView world;
        readonly RuntimeCatalogue catalogue;
        readonly TrainCatalogue trainCatalogue;
        readonly Shader fallbackShader;
        readonly int presentationLayer;

        readonly StationExplodedLayoutPlan plan;
        readonly StationExplodedConnection[] connections;
        readonly StationExplodedTrayInstance[] trays;
        readonly Vector3[] manualOffsets;
        readonly bool[] floorVisible;

        Dictionary<string, StationModuleRecord> modulesById;
        ModuleFacts[] allModuleFacts;
        HashSet<StationCellKey> allDocumentSolids;

        readonly List<Mesh> ownedMeshes = new List<Mesh>();
        readonly List<Material> ownedMaterials = new List<Material>();
        readonly List<StationExplodedSliceRecord> sliceRecords = new List<StationExplodedSliceRecord>();
        readonly List<LiftSliceBinding> liftBindings = new List<LiftSliceBinding>();
        readonly List<EscalatorTrayBinding> escalatorBindings = new List<EscalatorTrayBinding>();
        readonly List<ConsistTrayBinding> consistBindings = new List<ConsistTrayBinding>();
        readonly Dictionary<string, ConsistTrayBinding> consistById = new Dictionary<string, ConsistTrayBinding>(StringComparer.Ordinal);
        readonly Dictionary<string, Material> consistLiveryPool = new Dictionary<string, Material>(StringComparer.Ordinal);
        readonly ModuleMotionDispatch trainDoorDispatch = new ModuleMotionDispatch { MeasureDisplacement = false };
        bool trainMarkListenerAttached;

        // Deferred prop batch state (cleared once equipmentReady is true)
        readonly List<PropWorkItem> deferredItems = new List<PropWorkItem>();
        readonly Dictionary<(int tray, Material mat), PropCombineBucket> propBuckets =
            new Dictionary<(int tray, Material mat), PropCombineBucket>();
        readonly Dictionary<(int tray, Mesh mesh, int submesh, Material mat), List<Matrix4x4>> instancedPropBuckets =
            new Dictionary<(int tray, Mesh mesh, int submesh, Material mat), List<Matrix4x4>>();
        readonly Dictionary<(Mesh mesh, int submesh), CachedSourceSubmesh> sourceSubmeshCache =
            new Dictionary<(Mesh mesh, int submesh), CachedSourceSubmesh>();
        readonly List<StationSurfaceModuleRenderer.SurfacePart> tempSurfaceParts =
            new List<StationSurfaceModuleRenderer.SurfacePart>(16);
        int deferredCursor;

        // Reusable guide buffers (zero allocations during drag/reset/hide)
        readonly List<Vector3> guideVertices = new List<Vector3>(256);
        readonly List<Vector2> guideUvs = new List<Vector2>(256);
        readonly List<int> guideIndices = new List<int>(384);
        readonly List<(Vector3 lower, Vector3 upper)> lastGuideEndpoints = new List<(Vector3 lower, Vector3 upper)>(64);

        // Live passenger state (original-pose ownership + same-floor interpolation)
        readonly Dictionary<int, RawPassengerSample> previousPassengers = new Dictionary<int, RawPassengerSample>();
        readonly Dictionary<int, RawPassengerSample> lastTickPassengers = new Dictionary<int, RawPassengerSample>();
        readonly Dictionary<int, int> passengerTrayBySimId = new Dictionary<int, int>();
        readonly List<PassengerPose> presentedPassengers = new List<PassengerPose>(256);
        bool hasCachedLiveSample;
        StationSimulationSession cachedSession;
        StationMotionFrame cachedMotionFrame;
        StationPassengerFrame[] cachedPassengerFrames = Array.Empty<StationPassengerFrame>();
        long lastLiveTick = long.MinValue;
        long lastLiveEpoch = long.MinValue;
        float lastLiveAlpha = 1f;
        double lastPresentationSeconds;
        bool lastClockPlaying;

        StationFinishLibrary finishLibrary;
        bool ownsFinishLibrary;
        Material[] sharedLiftPalette;
        GameObject rootObject;
        Transform traysContainer;
        GameObject guidesObject;
        Mesh guidesMesh;
        Material guidesMaterial;
        GameObject passengersObject;
        PassengerCrowdView crowdView;
        int? selectedIndex;
        bool structuralBuilt;
        bool equipmentReady;
        bool disposed;

        enum PropWorkKind { WorldRecord, LiftSlice, RampModule }

        struct PropWorkItem {
            public PropWorkKind Kind;
            public StationViewRecord Record;
            public StationExplodedLiftSlice LiftSlice;
            public int LiftTrayIndex;
            public StationModuleRecord RampModule;
        }

        public StationExplodedTrayBuilder(
            StationDocument document,
            StationWorldView world,
            RuntimeCatalogue catalogue,
            TrainCatalogue trainCatalogue,
            Shader fallbackShader,
            Transform parent = null,
            int? layerOverride = null) {
            this.document = document ?? throw new ArgumentNullException(nameof(document));
            this.world = world;
            this.catalogue = catalogue;
            this.trainCatalogue = trainCatalogue;
            this.fallbackShader = fallbackShader != null ? fallbackShader : ResolveDefaultLitShader();
            presentationLayer = layerOverride ?? ResolvePresentationLayer();

            plan = StationExplodedLayoutPlan.Build(document);
            connections = StationExplodedConnections.Build(plan.RetainedSourceModules, plan.Levels, plan.StoreyHeight);

            int count = plan.Levels.Length;
            trays = new StationExplodedTrayInstance[count];
            manualOffsets = new Vector3[count];
            floorVisible = new bool[count];
            for (int i = 0; i < count; i++) floorVisible[i] = true;

            modulesById = new Dictionary<string, StationModuleRecord>(document.Modules.Count, StringComparer.Ordinal);
            allModuleFacts = new ModuleFacts[document.Modules.Count];
            for (int i = 0; i < document.Modules.Count; i++) {
                var mod = document.Modules[i];
                allModuleFacts[i] = mod?.Facts;
                if (mod != null && !string.IsNullOrEmpty(mod.Id)) modulesById[mod.Id] = mod;
            }

            allDocumentSolids = new HashSet<StationCellKey>(document.Cells.Count);
            for (int i = 0; i < document.Cells.Count; i++) {
                if (document.Cells[i].IsSolid) allDocumentSolids.Add(document.Cells[i].Key);
            }

            rootObject = new GameObject("ExplodedPresentation");
            if (parent != null) rootObject.transform.SetParent(parent, false);
            rootObject.transform.localPosition = Vector3.zero;
            rootObject.transform.localRotation = Quaternion.identity;
            rootObject.transform.localScale = Vector3.one;
            rootObject.layer = presentationLayer;

            var traysGo = new GameObject("Trays");
            traysGo.layer = presentationLayer;
            traysContainer = traysGo.transform;
            traysContainer.SetParent(rootObject.transform, false);

            for (int i = 0; i < count; i++) {
                var spec = plan.Trays[i];
                var trayGo = new GameObject("Tray " + spec.Level + "m");
                trayGo.layer = presentationLayer;
                var trayTransform = trayGo.transform;
                trayTransform.SetParent(traysContainer, false);
                trayTransform.localPosition = StationCoordinates.Point(spec.PackedDocumentOffset);
                trayTransform.localRotation = Quaternion.identity;
                trayTransform.localScale = Vector3.one;

                var floorRoot = CreateChildTransform(trayTransform, "FloorRoot", presentationLayer);
                var wallsRoot = CreateChildTransform(trayTransform, "WallsRoot", presentationLayer);
                var propsRoot = CreateChildTransform(trayTransform, "PropsRoot", presentationLayer);
                var liveRoot = CreateChildTransform(trayTransform, "LiveRoot", presentationLayer);

                trays[i] = new StationExplodedTrayInstance(
                    i,
                    spec.Level,
                    spec.PackedOffset,
                    spec.PackedDocumentOffset,
                    trayTransform,
                    floorRoot,
                    wallsRoot,
                    propsRoot,
                    liveRoot);
            }
        }

        public StationExplodedLayoutPlan Plan => plan;
        public IReadOnlyList<StationExplodedConnection> Connections => connections;
        public IReadOnlyList<StationExplodedTrayInstance> Trays => trays;
        public IReadOnlyList<StationExplodedSliceRecord> SliceRecords => sliceRecords;
        public IReadOnlyList<Vector3> ManualOffsets => manualOffsets;
        public IReadOnlyList<bool> FloorVisibleFlags => floorVisible;
        public int? SelectedIndex => selectedIndex;
        public int? SelectedElevation => selectedIndex.HasValue && selectedIndex.Value >= 0 && selectedIndex.Value < trays.Length
            ? trays[selectedIndex.Value].Level
            : (int?)null;
        public bool StructuralBuilt => structuralBuilt;
        public bool EquipmentReady => equipmentReady;
        public int DeferredRemaining => Math.Max(0, deferredItems.Count - deferredCursor);
        public int PresentationLayer => presentationLayer;
        public GameObject RootObject => rootObject;
        public Transform Root => rootObject != null ? rootObject.transform : null;
        public GameObject GuidesObject => guidesObject;
        public Mesh GuidesMesh => guidesMesh;
        public int PickCount { get; private set; }
        public int DynamicMeshCount => ownedMeshes.Count;
        public int ClonedMaterialCount => ownedMaterials.Count;
        public int ActiveGuideSegmentCount => lastGuideEndpoints.Count;
        public IReadOnlyList<(Vector3 lower, Vector3 upper)> LastGuideWorldEndpoints => lastGuideEndpoints;
        public int VisiblePassengerCount => crowdView != null ? crowdView.VisibleActors : 0;
        public IReadOnlyList<PassengerPose> PresentedPassengers => presentedPassengers;
        public IReadOnlyDictionary<int, int> PassengerTrayBySimId => passengerTrayBySimId;
        public PassengerCrowdView CrowdView => crowdView;
        public int ConsistCount => consistBindings.Count;

        internal IEnumerable<TrainConsistView> PresentedConsists {
            get {
                foreach (var binding in consistBindings) yield return binding.View;
            }
        }

        public int CountActiveLiftCabins(string sourceLiftId = null) {
            int active = 0;
            for (int i = 0; i < liftBindings.Count; i++) {
                var b = liftBindings[i];
                if (!string.IsNullOrEmpty(sourceLiftId) && !string.Equals(b.SourceLiftId, sourceLiftId, StringComparison.Ordinal)) {
                    continue;
                }
                if (b.View?.Lift?.Cabin != null &&
                    b.View.Lift.Cabin.gameObject.activeSelf &&
                    b.TrayIndex >= 0 && b.TrayIndex < floorVisible.Length && floorVisible[b.TrayIndex]) {
                    active++;
                }
            }
            return active;
        }

        public bool TryGetConsist(string trainId, out TrainConsistView consist, out int trayIndex) {
            if (!string.IsNullOrEmpty(trainId) && consistById.TryGetValue(trainId, out var binding)) {
                consist = binding.View;
                trayIndex = binding.TrayIndex;
                return true;
            }
            consist = null;
            trayIndex = -1;
            return false;
        }

        public static int ResolvePresentationLayer() {
            int named = LayerMask.NameToLayer(DefaultLayerName);
            return named >= 0 ? named : FallbackLayer;
        }

        static Shader ResolveDefaultLitShader() =>
            Shader.Find("Universal Render Pipeline/Lit") ??
            Shader.Find("Metro/Station Finish") ??
            Shader.Find("Standard");

        static Transform CreateChildTransform(Transform parent, string name, int layer) {
            var go = new GameObject(name);
            go.layer = layer;
            var t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = Vector3.zero;
            t.localRotation = Quaternion.identity;
            t.localScale = Vector3.one;
            return t;
        }

        /* --------------------------------------------- stage 1: structural trays */

        public void BuildStructuralTrays() {
            ThrowIfDisposed();
            if (structuralBuilt) return;

            var allRetained = new HashSet<StationCellKey>(plan.TotalRetainedCells);
            for (int i = 0; i < plan.Trays.Count; i++) {
                foreach (var key in plan.Trays[i].RetainedCellSet) allRetained.Add(key);
            }

            var sharedFinishes = StationCellRenderer.CurrentFinishes;
            if (sharedFinishes != null) {
                finishLibrary = sharedFinishes;
                ownsFinishLibrary = false;
            } else {
                finishLibrary = StationCellRenderer.AcquireLibrary(fallbackShader);
                ownsFinishLibrary = true;
            }
            var policy = new StationCellViewerPolicy(allRetained, omitSuspendedCeilings: true, isolateBandOcclusion: true);
            var meshInput = StationCellRenderer.BuildInput(document, finishLibrary, null, policy);
            var meshResult = StationCellMesher.Mesh(meshInput);

            foreach (var group in meshResult.Groups) {
                int trayIndex = plan.IndexOfLevel(group.Storey);
                if (trayIndex < 0) continue;
                var tray = trays[trayIndex];
                var spec = plan.Trays[trayIndex];
                var baseMat = ResolveFinishMaterial(group.FinishId);
                EmitCellGroupSplit(tray, spec.FrontWallCellSet, group, meshResult.Faces, baseMat);
            }

            // Ensure trays that only carry modules (e.g. Zoo 0 m exits) have initial footprint bounds
            // before deferred props finish so camera framing includes every non-empty tray.
            for (int i = 0; i < trays.Length; i++) {
                var tray = trays[i];
                var spec = plan.Trays[i];
                if (!tray.HasSourceBounds) {
                    for (int m = 0; m < spec.Modules.Count; m++) {
                        var mod = spec.Modules[m];
                        tray.EncapsulateDocumentPoint(new Vector3(mod.X, mod.Y, (float)mod.ExactZ));
                        tray.EncapsulateDocumentPoint(new Vector3(mod.X + Mathf.Max(1, mod.Width), mod.Y + Mathf.Max(1, mod.Depth), (float)mod.ExactZ + 3f));
                    }
                    for (int l = 0; l < spec.LiftSlices.Count; l++) {
                        var sl = spec.LiftSlices[l];
                        float size = StationRunGeometry.LiftSize(sl.Module.Facts);
                        tray.EncapsulateDocumentPoint(new Vector3(sl.Module.X, sl.Module.Y, (float)sl.FromZ));
                        tray.EncapsulateDocumentPoint(new Vector3(sl.Module.X + size, sl.Module.Y + size, (float)sl.ToZ));
                    }
                }
            }

            SetupGuidesMesh();
            UpdateGuides();
            BuildLiveConsists();
            BuildLiveCrowd();
            QueueDeferredPropWork();

            structuralBuilt = true;
            if (deferredItems.Count == 0) {
                equipmentReady = true;
                ReleaseTemporaryBuildState();
            }
        }

        Material ResolveFinishMaterial(string finishId) {
            if (finishLibrary != null) return finishLibrary.For(finishId);
            var fallback = new Material(fallbackShader) { name = "ExplodedFallback " + (finishId ?? "default") };
            ownedMaterials.Add(fallback);
            return fallback;
        }

        void EmitCellGroupSplit(
            StationExplodedTrayInstance tray,
            HashSet<StationCellKey> frontWallSet,
            StationCellMeshGroup group,
            IReadOnlyList<StationCellFaceRecord> faces,
            Material sourceMaterial) {
            if (group.Indices == null || group.Indices.Length < 3) return;
            int triCount = group.Indices.Length / 3;
            int frontCount = 0;
            bool[] triIsFront = null;

            if (frontWallSet != null && frontWallSet.Count > 0 && group.TriangleFaces != null) {
                triIsFront = new bool[triCount];
                for (int t = 0; t < triCount; t++) {
                    int faceIdx = t < group.TriangleFaces.Length ? group.TriangleFaces[t] : -1;
                    if (faceIdx >= 0 && faceIdx < faces.Count && frontWallSet.Contains(faces[faceIdx].CellKey)) {
                        triIsFront[t] = true;
                        frontCount++;
                    }
                }
            }

            if (frontCount == 0) {
                EmitCellBucketMesh(tray, group, null, wantFrontWall: false, sourceMaterial);
            } else if (frontCount == triCount) {
                EmitCellBucketMesh(tray, group, null, wantFrontWall: true, sourceMaterial);
            } else {
                EmitCellBucketMesh(tray, group, triIsFront, wantFrontWall: false, sourceMaterial);
                EmitCellBucketMesh(tray, group, triIsFront, wantFrontWall: true, sourceMaterial);
            }
        }

        void EmitCellBucketMesh(
            StationExplodedTrayInstance tray,
            StationCellMeshGroup group,
            bool[] triIsFront,
            bool wantFrontWall,
            Material sourceMaterial) {
            int srcTriCount = group.Indices.Length / 3;
            var remap = new Dictionary<int, int>(group.Positions.Length);
            var verts = new List<Vector3>(group.Positions.Length);
            var norms = new List<Vector3>(group.Normals.Length);
            var cols = group.Colors != null && group.Colors.Length == group.Positions.Length
                ? new List<Color>(group.Colors.Length)
                : null;
            var uvs = group.Uvs != null && group.Uvs.Length == group.Positions.Length
                ? new List<Vector2>(group.Uvs.Length)
                : null;
            var tris = new List<int>(group.Indices.Length);

            int MapVertex(int srcIdx) {
                if (remap.TryGetValue(srcIdx, out int mapped)) return mapped;
                mapped = verts.Count;
                remap[srcIdx] = mapped;
                var docPos = group.Positions[srcIdx];
                tray.EncapsulateDocumentPoint(docPos);
                verts.Add(StationCoordinates.Point(docPos));
                norms.Add(StationCoordinates.Point(group.Normals[srcIdx]));
                if (cols != null) cols.Add(group.Colors[srcIdx]);
                if (uvs != null) uvs.Add(group.Uvs[srcIdx]);
                return mapped;
            }

            for (int t = 0; t < srcTriCount; t++) {
                if (triIsFront != null && triIsFront[t] != wantFrontWall) continue;
                int a = MapVertex(group.Indices[t * 3]);
                // Document -> Unity swap is a reflection; reverse winding once here as StationCellView does.
                int b = MapVertex(group.Indices[t * 3 + 2]);
                int c = MapVertex(group.Indices[t * 3 + 1]);
                tris.Add(a);
                tris.Add(b);
                tris.Add(c);
            }

            if (tris.Count == 0) return;

            var vertArr = verts.ToArray();
            var triArr = tris.ToArray();
            var mesh = new Mesh {
                name = group.GroupKey + (wantFrontWall ? " [front-wall]" : " [floor]"),
            };
            if (vertArr.Length > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertArr);
            mesh.SetNormals(norms);
            if (cols != null) mesh.SetColors(cols);
            if (uvs != null) mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triArr, 0, calculateBounds: true);
            ownedMeshes.Add(mesh);

            var parent = wantFrontWall ? tray.WallsRoot : tray.FloorRoot;
            CreateTrayMeshObject(tray, parent, mesh.name, mesh, sourceMaterial);

            tray.PickBuckets.Add(new PickBucket {
                SourceWorldBounds = mesh.bounds,
                Vertices = vertArr,
                Triangles = triArr,
                IsFrontWall = wantFrontWall,
            });
        }

        /* --------------------------------------------- stage 2: deferred props */

        void QueueDeferredPropWork() {
            deferredItems.Clear();
            deferredCursor = 0;

            for (int t = 0; t < plan.Trays.Count; t++) {
                var slices = plan.Trays[t].LiftSlices;
                for (int s = 0; s < slices.Count; s++) {
                    deferredItems.Add(new PropWorkItem {
                        Kind = PropWorkKind.LiftSlice,
                        LiftSlice = slices[s],
                        LiftTrayIndex = t,
                    });
                }
            }

            for (int i = 0; i < plan.RetainedSourceModules.Count; i++) {
                var mod = plan.RetainedSourceModules[i];
                if (string.Equals(mod.Type, "stair", StringComparison.Ordinal) ||
                    string.Equals(mod.Type, "escalator", StringComparison.Ordinal) ||
                    string.Equals(mod.Type, "walkway", StringComparison.Ordinal)) {
                    deferredItems.Add(new PropWorkItem {
                        Kind = PropWorkKind.RampModule,
                        RampModule = mod,
                    });
                }
            }

            if (world != null) {
                var records = world.Records;
                for (int i = 0; i < records.Count; i++) {
                    var rec = records[i];
                    if (rec == null || rec.View == null) continue;
                    switch (rec.Role) {
                        case "cells":
                        case "grid":
                        case "overlays":
                        case "roads":
                        case "actors":
                        case "trains":
                        case "vertical":
                            continue;
                    }
                    if (rec.Role == StationModuleClaims.Surfaces && string.Equals(rec.Part, "hidden", StringComparison.Ordinal)) {
                        continue;
                    }
                    deferredItems.Add(new PropWorkItem {
                        Kind = PropWorkKind.WorldRecord,
                        Record = rec,
                    });
                }
            }
        }

        public void CompleteAllProps() {
            StepPropsBatch(int.MaxValue);
        }

        /// <summary>
        /// Processes up to <paramref name="maxItems"/> deferred prop items. Returns <c>true</c>
        /// once all prop geometry, ramp slices, and lift sections are built and flushed.
        /// </summary>
        public bool StepPropsBatch(int maxItems) {
            ThrowIfDisposed();
            if (!structuralBuilt) BuildStructuralTrays();
            if (equipmentReady) return true;

            int budget = Math.Max(1, maxItems);
            int processed = 0;
            while (deferredCursor < deferredItems.Count && processed < budget) {
                var item = deferredItems[deferredCursor++];
                processed++;
                switch (item.Kind) {
                    case PropWorkKind.LiftSlice:
                        BuildLiftSlice(item.LiftTrayIndex, item.LiftSlice);
                        break;
                    case PropWorkKind.RampModule:
                        BuildClippedRampModule(item.RampModule);
                        break;
                    case PropWorkKind.WorldRecord:
                        ExtractWorldRecord(item.Record);
                        break;
                }
            }

            if (deferredCursor >= deferredItems.Count) {
                FlushAllPropBuckets();
                ReleaseTemporaryBuildState();
                equipmentReady = true;
                if (selectedIndex.HasValue && selectedIndex.Value >= 0 && selectedIndex.Value < trays.Length) {
                    trays[selectedIndex.Value].IsTinted = false;
                }
                ApplySelectionTint();
                SyncEscalatorSteps();
                RefreshPausedPoses();
                return true;
            }
            return false;
        }

        void BuildLiftSlice(int trayIndex, StationExplodedLiftSlice slice) {
            if (trayIndex < 0 || trayIndex >= trays.Length || slice.Module == null) return;
            var tray = trays[trayIndex];
            EnsureLiftPalettes();

            var request = VerticalModuleRequest.FromFacts(
                slice.Module.Facts,
                prefab: null,
                prefabKey: null,
                solid: (x, y, z) => allDocumentSolids != null && allDocumentSolids.Contains(new StationCellKey(x, y, z)),
                materialFor: slot => sharedLiftPalette[Mathf.Clamp(slot, 0, sharedLiftPalette.Length - 1)]);

            request.ModuleId = slice.Id;
            request.Z = (int)Math.Round(slice.FromZ);
            request.HasEndpoints = true;
            request.FromX = slice.Module.X;
            request.FromY = slice.Module.Y;
            request.FromZ = (int)Math.Round(slice.FromZ);
            request.ToX = slice.Module.X;
            request.ToY = slice.Module.Y;
            request.ToZ = (int)Math.Round(slice.ToZ);
            request.ConfigJson = StripRisesFromConfig(request.ConfigJson);

            // Build in an unshifted temporary holder first to capture unshifted source-space pick triangles,
            // then reparent under tray.PropsRoot keeping localPosition intact.
            var holder = new GameObject("LiftSliceHolder");
            try {
                if (!VerticalModuleViews.TryBuild(request, holder.transform, out var view) || view?.Root == null) {
                    return;
                }
                view.Root.name = slice.Id;
                SetLayerRecursively(view.Root.gameObject, presentationLayer);

                Transform cabinTransform = view.Lift?.Cabin;
                foreach (var filter in view.Root.GetComponentsInChildren<MeshFilter>(true)) {
                    if (filter == null || filter.sharedMesh == null) continue;
                    var renderer = filter.GetComponent<MeshRenderer>();
                    if (renderer == null || !renderer.enabled) continue;
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                    if (renderer.sharedMaterial != null) {
                        tray.TintRenderers.Add((renderer, renderer.sharedMaterial));
                    }
                    if (cabinTransform != null && filter.transform.IsChildOf(cabinTransform)) continue;
                    RegisterTransformedPickMesh(tray, filter.sharedMesh, filter.transform.localToWorldMatrix, out var worldBounds);
                    tray.EncapsulateWorldBounds(worldBounds);
                }

                float size = StationRunGeometry.LiftSize(slice.Module.Facts);
                var sliceDocBounds = new Bounds();
                sliceDocBounds.SetMinMax(
                    new Vector3(slice.Module.X, slice.Module.Y, (float)slice.FromZ),
                    new Vector3(slice.Module.X + size, slice.Module.Y + size, (float)slice.ToZ));
                sliceRecords.Add(new StationExplodedSliceRecord(
                    slice.Module.Id,
                    "lift",
                    slice.Id,
                    trayIndex,
                    tray.Level,
                    sliceDocBounds,
                    CountHierarchyTriangles(view.Root)));

                view.Root.SetParent(tray.PropsRoot, worldPositionStays: false);

                double hi = slice.Module.From.HasValue && slice.Module.To.HasValue
                    ? Math.Max(slice.Module.From.Value.Z, slice.Module.To.Value.Z)
                    : slice.ToZ;
                liftBindings.Add(new LiftSliceBinding {
                    SourceLiftId = slice.Module.Id,
                    TrayIndex = trayIndex,
                    TrayLevel = tray.Level,
                    FromZ = (float)slice.FromZ,
                    ToZ = (float)slice.ToZ,
                    SourceHiZ = (float)hi,
                    View = view,
                });
            } finally {
                DestroyUnityObject(holder);
            }
        }

        static string StripRisesFromConfig(string configJson) {
            if (string.IsNullOrEmpty(configJson)) return "{}";
            try {
                var obj = JObject.Parse(configJson);
                obj.Remove("rises");
                return obj.ToString(Newtonsoft.Json.Formatting.None);
            } catch {
                return configJson;
            }
        }

        void EnsureLiftPalettes() {
            if (sharedLiftPalette != null) return;
            sharedLiftPalette = new Material[VerticalModuleViews.Palette.Length];
            for (int i = 0; i < sharedLiftPalette.Length; i++) {
                var mat = new Material(fallbackShader) {
                    color = VerticalModuleViews.Palette[i],
                    name = "ExplodedLiftShared #" + i,
                };
                if (mat.HasProperty(BaseColorId)) mat.SetColor(BaseColorId, VerticalModuleViews.Palette[i]);
                if (i == VerticalModuleViews.PaletteGlass) {
                    StationGlass.MakeTransparent(mat, 0.26f);
                }
                ownedMaterials.Add(mat);
                sharedLiftPalette[i] = mat;
            }
        }

        void BuildClippedRampModule(StationModuleRecord module) {
            if (module == null || world == null) return;
            StationViewRecord sourceRecord = null;
            var records = world.Records;
            for (int i = 0; i < records.Count; i++) {
                var candidate = records[i];
                if (candidate != null &&
                    string.Equals(candidate.Role, VerticalModuleRenderer.RoleName, StringComparison.Ordinal) &&
                    string.Equals(candidate.ModuleId, module.Id, StringComparison.Ordinal)) {
                    sourceRecord = candidate;
                    break;
                }
            }
            if (sourceRecord?.View == null) return;

            VerticalModuleView sourceVertical = null;
            var activeVertical = VerticalModuleRenderer.Current;
            if (activeVertical != null) {
                var views = activeVertical.Views;
                for (int i = 0; i < views.Count; i++) {
                    if (views[i] != null && string.Equals(views[i].ModuleId, module.Id, StringComparison.Ordinal)) {
                        sourceVertical = views[i];
                        break;
                    }
                }
            }

            Transform movingBandRoot = null;
            if (sourceVertical != null) sourceVertical.TryGetPart("band", out movingBandRoot);

            var staticFilters = new List<(MeshFilter filter, MeshRenderer renderer, Material[] materials)>();
            Bounds overallWorldBounds = default;
            bool hasWorldBounds = false;

            foreach (var filter in sourceRecord.View.GetComponentsInChildren<MeshFilter>(true)) {
                if (filter == null || filter.sharedMesh == null) continue;
                if (movingBandRoot != null && filter.transform.IsChildOf(movingBandRoot)) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !StationVisibilityTarget.ResolveDrawableBaseMaterials(renderer, out var mats)) continue;
                var wb = TransformLocalBounds(filter.sharedMesh.bounds, filter.transform.localToWorldMatrix);
                if (!hasWorldBounds) { overallWorldBounds = wb; hasWorldBounds = true; }
                else overallWorldBounds.Encapsulate(wb);
                staticFilters.Add((filter, renderer, mats));
            }

            if (!hasWorldBounds && sourceVertical?.Band != null) {
                var minDoc = Vector3.Min(sourceVertical.Band.Lower, sourceVertical.Band.Upper);
                var maxDoc = Vector3.Max(sourceVertical.Band.Lower, sourceVertical.Band.Upper) + new Vector3(1f, 1f, 1.2f);
                overallWorldBounds.SetMinMax(StationCoordinates.Point(minDoc), StationCoordinates.Point(maxDoc));
                hasWorldBounds = true;
            }
            if (!hasWorldBounds) return;

            int storeyHeight = plan.StoreyHeight;
            for (int t = 0; t < trays.Length; t++) {
                var tray = trays[t];
                float lowY = tray.Level;
                float highY = tray.Level + storeyHeight;
                if (overallWorldBounds.max.y <= lowY + 1e-5f || overallWorldBounds.min.y >= highY - 1e-5f) continue;

                int trayTriangles = 0;
                Bounds sliceDocBounds = default;
                bool hasSliceBounds = false;

                for (int f = 0; f < staticFilters.Count; f++) {
                    var (filter, _, mats) = staticFilters[f];
                    var mesh = filter.sharedMesh;
                    if (!mesh.isReadable) continue;
                    var matrix = filter.transform.localToWorldMatrix;
                    int subCount = Mathf.Max(1, mesh.subMeshCount);
                    for (int s = 0; s < subCount; s++) {
                        var mat = SubmeshMaterial(mats, s);
                        if (mat == null) continue;
                        if (ClipMeshSubmeshToBand(mesh, s, matrix, lowY, highY,
                                out var clippedPos, out var clippedNorm, out var clippedUv, out var clippedCol, out var clippedIdx)) {
                            AppendToPropBucket(t, mat, clippedPos, clippedNorm, clippedUv, clippedCol, clippedIdx);
                            for (int v = 0; v < clippedPos.Count; v++) {
                                var docPt = StationCoordinates.WorldToDocument(clippedPos[v]);
                                tray.EncapsulateDocumentPoint(docPt);
                                if (!hasSliceBounds) { sliceDocBounds = new Bounds(docPt, Vector3.zero); hasSliceBounds = true; }
                                else sliceDocBounds.Encapsulate(docPt);
                            }
                            trayTriangles += clippedIdx.Count / 3;
                        }
                    }
                }

                if (sourceVertical?.Steps != null && sourceVertical.Steps.Count > 0) {
                    AttachEscalatorStepFollowers(sourceVertical, tray, lowY, highY);
                }

                if (trayTriangles > 0 || (sourceVertical?.Steps != null && sourceVertical.Steps.Count > 0)) {
                    if (!hasSliceBounds) {
                        sliceDocBounds = new Bounds(
                            new Vector3(module.X + 0.5f, module.Y + 0.5f, lowY + storeyHeight * 0.5f),
                            new Vector3(1f, 1f, storeyHeight));
                    }
                    sliceRecords.Add(new StationExplodedSliceRecord(
                        module.Id,
                        module.Type,
                        module.Id + "@z=" + tray.Level,
                        t,
                        tray.Level,
                        sliceDocBounds,
                        trayTriangles));
                }
            }
        }

        void AttachEscalatorStepFollowers(VerticalModuleView sourceVertical, StationExplodedTrayInstance tray, float lowY, float highY) {
            EnsureLiftPalettes();
            var stepMaterial = sharedLiftPalette[VerticalModuleViews.PaletteSteel];
            var groupGo = new GameObject(sourceVertical.ModuleId + "-steps");
            groupGo.layer = presentationLayer;
            var groupTransform = groupGo.transform;
            groupTransform.SetParent(tray.LiveRoot, false);

            var binding = new EscalatorTrayBinding {
                SourceView = sourceVertical,
                TrayIndex = tray.Index,
                MinWorldY = lowY,
                MaxWorldY = highY,
            };

            for (int i = 0; i < sourceVertical.Steps.Count; i++) {
                var srcStep = sourceVertical.Steps[i];
                Transform dstTread = null;
                Transform dstRiser = null;
                if (srcStep.Tread != null) {
                    var mf = srcStep.Tread.GetComponent<MeshFilter>();
                    if (mf != null && mf.sharedMesh != null) {
                        dstTread = CreateTrayMeshObject(tray, groupTransform, "tread-" + i, mf.sharedMesh, stepMaterial).transform;
                    }
                }
                if (srcStep.Riser != null) {
                    var mf = srcStep.Riser.GetComponent<MeshFilter>();
                    if (mf != null && mf.sharedMesh != null) {
                        dstRiser = CreateTrayMeshObject(tray, groupTransform, "riser-" + i, mf.sharedMesh, stepMaterial).transform;
                    }
                }
                binding.Steps.Add(new EscalatorStepFollower {
                    SourceTread = srcStep.Tread,
                    SourceRiser = srcStep.Riser,
                    TargetTread = dstTread,
                    TargetRiser = dstRiser,
                });
            }

            escalatorBindings.Add(binding);
        }

        void SyncEscalatorSteps() {
            for (int b = 0; b < escalatorBindings.Count; b++) {
                var binding = escalatorBindings[b];
                if (binding.SourceView == null || binding.SourceView.Root == null) continue;
                bool trayShown = floorVisible[binding.TrayIndex];
                for (int i = 0; i < binding.Steps.Count; i++) {
                    var step = binding.Steps[i];
                    SyncSingleStepPart(step.SourceTread, step.TargetTread, trayShown, binding.MinWorldY, binding.MaxWorldY);
                    SyncSingleStepPart(step.SourceRiser, step.TargetRiser, trayShown, binding.MinWorldY, binding.MaxWorldY);
                }
            }
        }

        static void SyncSingleStepPart(Transform src, Transform dst, bool trayShown, float minY, float maxY) {
            if (dst == null) return;
            if (!trayShown || src == null || !src.gameObject.activeSelf) {
                if (dst.gameObject.activeSelf) dst.gameObject.SetActive(false);
                return;
            }
            var worldPos = src.position;
            bool inBand = worldPos.y >= minY - 1e-4f && worldPos.y < maxY - 1e-4f;
            if (!inBand) {
                if (dst.gameObject.activeSelf) dst.gameObject.SetActive(false);
                return;
            }
            if (!dst.gameObject.activeSelf) dst.gameObject.SetActive(true);
            dst.localPosition = worldPos;
            dst.localRotation = src.rotation;
            dst.localScale = src.lossyScale;
        }

        void ExtractWorldRecord(StationViewRecord record) {
            if (record?.View == null) return;

            if (record.Role == StationModuleClaims.Surfaces &&
                string.Equals(record.Part, "batch", StringComparison.Ordinal)) {
                var ids = record.SourceIds;
                if (ids == null || catalogue == null) return;
                for (int i = 0; i < ids.Length; i++) {
                    string id = ids[i];
                    if (string.IsNullOrEmpty(id) || !plan.ModuleOwnerById.TryGetValue(id, out int ownerLevel)) continue;
                    int trayIdx = plan.IndexOfLevel(ownerLevel);
                    if (trayIdx < 0 || !modulesById.TryGetValue(id, out var modRecord) || modRecord?.Facts == null) continue;
                    if (!StationSurfaceModuleRenderer.TryExtractTileParts(
                            modRecord.Facts, allModuleFacts, catalogue, tempSurfaceParts, out var placement, out _)) {
                        continue;
                    }
                    for (int p = 0; p < tempSurfaceParts.Count; p++) {
                        var part = tempSurfaceParts[p];
                        if (part.Mesh == null || part.Material == null) continue;
                        AddMeshSubmeshToTray(trayIdx, part.Mesh, part.Submesh, part.Material, placement * part.Local);
                    }
                }
                return;
            }

            if (record.SourceIds != null && record.SourceIds.Length > 0 &&
                record.View.TryGetComponent<StationInstancedSurfaceBatch>(out var instBatch) &&
                instBatch.SharedMesh != null && instBatch.ProxyRenderer != null &&
                StationVisibilityTarget.ResolveDrawableBaseMaterials(instBatch.ProxyRenderer, out var instMats) &&
                instMats != null && instMats.Length > 0 && instMats[0] != null) {
                var ids = record.SourceIds;
                var mat = instMats[0];
                var sharedMesh = instBatch.SharedMesh;
                int subIdx = instBatch.SubmeshIndex;
                var localBounds = sharedMesh.bounds;
                for (int i = 0; i < ids.Length; i++) {
                    string id = ids[i];
                    if (string.IsNullOrEmpty(id) || !plan.ModuleOwnerById.TryGetValue(id, out int ownerLevel)) continue;
                    int trayIdx = plan.IndexOfLevel(ownerLevel);
                    if (trayIdx < 0) continue;
                    if (!instBatch.TryGetSourceRange(i, out int start, out int count)) continue;
                    var key = (trayIdx, sharedMesh, subIdx, mat);
                    if (!instancedPropBuckets.TryGetValue(key, out var list)) {
                        list = new List<Matrix4x4>(Math.Max(16, count));
                        instancedPropBuckets[key] = list;
                    }
                    var tray = trays[trayIdx];
                    for (int k = 0; k < count; k++) {
                        var m = instBatch.Matrices[start + k];
                        list.Add(m);
                        tray.EncapsulateWorldBounds(TransformLocalBounds(localBounds, m));
                    }
                }
                return;
            }

            if (string.IsNullOrEmpty(record.ModuleId)) return;
            if (!plan.ModuleOwnerById.TryGetValue(record.ModuleId, out int modOwnerLevel)) return;
            int ownerTrayIndex = plan.IndexOfLevel(modOwnerLevel);
            if (ownerTrayIndex < 0) return;

            foreach (var filter in record.View.GetComponentsInChildren<MeshFilter>(true)) {
                if (filter == null || filter.sharedMesh == null) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !StationVisibilityTarget.ResolveDrawableBaseMaterials(renderer, out var mats)) continue;
                var mesh = filter.sharedMesh;
                var matrix = filter.transform.localToWorldMatrix;
                int submeshes = Mathf.Max(1, mesh.subMeshCount);
                for (int s = 0; s < submeshes; s++) {
                    var mat = SubmeshMaterial(mats, s);
                    if (mat == null) continue;
                    AddMeshSubmeshToTray(ownerTrayIndex, mesh, s, mat, matrix);
                }
            }
        }

        void AddMeshSubmeshToTray(int trayIndex, Mesh mesh, int submesh, Material sourceMaterial, Matrix4x4 worldMatrix) {
            var tray = trays[trayIndex];
            int clampedSubmesh = Mathf.Clamp(submesh, 0, Mathf.Max(0, mesh.subMeshCount - 1));
            var topology = mesh.GetTopology(clampedSubmesh);
            if (topology != MeshTopology.Triangles) {
                // Non-triangle primitives (such as a court net's MeshTopology.Lines) cannot be
                // merged into a triangle PropCombineBucket; mount a viewer-owned MeshRenderer so
                // the net lines travel rigidly with the tray.
                Mesh submeshAsset = null;
                if (mesh.subMeshCount <= 1) {
                    submeshAsset = mesh;
                } else if (mesh.isReadable) {
                    var indices = mesh.GetIndices(clampedSubmesh);
                    var verts = mesh.vertices;
                    if (indices != null && indices.Length > 0 && verts != null && verts.Length > 0) {
                        var extracted = new Mesh { name = mesh.name + " [Submesh " + clampedSubmesh + "]" };
                        if (verts.Length > 65000) extracted.indexFormat = IndexFormat.UInt32;
                        extracted.SetVertices(verts);
                        extracted.SetIndices(indices, topology, 0, calculateBounds: true);
                        ownedMeshes.Add(extracted);
                        submeshAsset = extracted;
                    }
                }
                if (submeshAsset != null) {
                    var lineGo = CreateTrayMeshObject(tray, tray.PropsRoot, submeshAsset.name, submeshAsset, sourceMaterial);
                    ApplyWorldMatrixToTransform(lineGo.transform, worldMatrix);
                    tray.EncapsulateWorldBounds(TransformLocalBounds(submeshAsset.bounds, worldMatrix));
                }
                return;
            }
            if (mesh.isReadable) {
                var cached = GetOrCacheSourceSubmesh(mesh, clampedSubmesh);
                if (cached != null) {
                    AppendTransformedSubmeshToPropBucket(trayIndex, cached, sourceMaterial, worldMatrix);
                }
                return;
            }

            // Fallback when an imported mesh is marked non-readable: instantiate a single viewer-owned
            // MeshRenderer sharing the imported Mesh asset (never destroyed on viewer dispose).
            var go = CreateTrayMeshObject(tray, tray.PropsRoot, mesh.name, mesh, sourceMaterial);
            ApplyWorldMatrixToTransform(go.transform, worldMatrix);
            var wb = TransformLocalBounds(mesh.bounds, worldMatrix);
            tray.EncapsulateWorldBounds(wb);
        }

        CachedSourceSubmesh GetOrCacheSourceSubmesh(Mesh mesh, int clampedSubmesh) {
            if (mesh == null || !mesh.isReadable) return null;
            var key = (mesh, clampedSubmesh);
            if (sourceSubmeshCache.TryGetValue(key, out var cached)) return cached;

            if (mesh.GetTopology(clampedSubmesh) != MeshTopology.Triangles) {
                sourceSubmeshCache[key] = null;
                return null;
            }
            var tris = mesh.GetTriangles(clampedSubmesh);
            if (tris == null || tris.Length < 3) {
                sourceSubmeshCache[key] = null;
                return null;
            }
            var srcVerts = mesh.vertices;
            if (srcVerts == null || srcVerts.Length == 0) {
                sourceSubmeshCache[key] = null;
                return null;
            }
            var srcNorms = mesh.normals;
            var srcUvs = mesh.uv;
            var srcCols = mesh.colors;
            bool hasNorms = srcNorms != null && srcNorms.Length == srcVerts.Length;
            bool hasUvs = srcUvs != null && srcUvs.Length == srcVerts.Length;
            bool hasCols = srcCols != null && srcCols.Length == srcVerts.Length;

            if (mesh.subMeshCount <= 1) {
                var full = new CachedSourceSubmesh {
                    Positions = srcVerts,
                    Normals = hasNorms ? srcNorms : null,
                    Uvs = hasUvs ? srcUvs : null,
                    Colors = hasCols ? srcCols : null,
                    Indices = tris,
                    HasNormals = hasNorms,
                };
                sourceSubmeshCache[key] = full;
                return full;
            }

            // Compact multi-submesh vertices once so repeated instances copy only referenced vertices.
            var remap = new Dictionary<int, int>(tris.Length);
            var outPos = new List<Vector3>();
            var outNorm = hasNorms ? new List<Vector3>() : null;
            var outUv = hasUvs ? new List<Vector2>() : null;
            var outCol = hasCols ? new List<Color>() : null;
            var outIdx = new int[tris.Length];
            for (int t = 0; t < tris.Length; t++) {
                int srcIdx = tris[t];
                if (!remap.TryGetValue(srcIdx, out int mapped)) {
                    mapped = outPos.Count;
                    remap[srcIdx] = mapped;
                    outPos.Add(srcVerts[srcIdx]);
                    if (outNorm != null) outNorm.Add(srcNorms[srcIdx]);
                    if (outUv != null) outUv.Add(srcUvs[srcIdx]);
                    if (outCol != null) outCol.Add(srcCols[srcIdx]);
                }
                outIdx[t] = mapped;
            }
            var compact = new CachedSourceSubmesh {
                Positions = outPos.ToArray(),
                Normals = outNorm != null ? outNorm.ToArray() : null,
                Uvs = outUv != null ? outUv.ToArray() : null,
                Colors = outCol != null ? outCol.ToArray() : null,
                Indices = outIdx,
                HasNormals = hasNorms,
            };
            sourceSubmeshCache[key] = compact;
            return compact;
        }

        void AppendTransformedSubmeshToPropBucket(
            int trayIndex,
            CachedSourceSubmesh src,
            Material sourceMaterial,
            Matrix4x4 worldMatrix) {
            var key = (trayIndex, sourceMaterial);
            if (!propBuckets.TryGetValue(key, out var bucket)) {
                bucket = new PropCombineBucket { TrayIndex = trayIndex, SourceMaterial = sourceMaterial };
                propBuckets[key] = bucket;
            }
            var srcPos = src.Positions;
            int vCount = srcPos.Length;
            if (bucket.Positions.Count + vCount >= 120000) {
                FlushPropBucket(bucket);
            }
            var tray = trays[trayIndex];
            int baseVertex = bucket.Positions.Count;
            var srcNorms = src.Normals;
            var srcUvs = src.Uvs;
            var srcCols = src.Colors;
            bool hasNorms = src.HasNormals && srcNorms != null;
            var normalMatrix = hasNorms ? worldMatrix.inverse.transpose : Matrix4x4.identity;
            bool flipWinding = worldMatrix.determinant < 0f;

            for (int i = 0; i < vCount; i++) {
                var wp = worldMatrix.MultiplyPoint3x4(srcPos[i]);
                bucket.Positions.Add(wp);
                tray.EncapsulateDocumentPoint(StationCoordinates.WorldToDocument(wp));
                if (hasNorms) {
                    var n = normalMatrix.MultiplyVector(srcNorms[i]);
                    if (n.sqrMagnitude > 1e-8f) n.Normalize();
                    bucket.Normals.Add(n);
                } else {
                    bucket.Normals.Add(Vector3.up);
                }
                bucket.Uvs.Add(srcUvs != null ? srcUvs[i] : Vector2.zero);
                bucket.Colors.Add(srcCols != null ? srcCols[i] : Color.white);
            }

            var srcIdx = src.Indices;
            int idxCount = srcIdx.Length;
            for (int t = 0; t + 2 < idxCount; t += 3) {
                bucket.Indices.Add(baseVertex + srcIdx[t]);
                bucket.Indices.Add(baseVertex + srcIdx[flipWinding ? t + 2 : t + 1]);
                bucket.Indices.Add(baseVertex + srcIdx[flipWinding ? t + 1 : t + 2]);
            }
        }

        void AppendToPropBucket(
            int trayIndex,
            Material sourceMaterial,
            List<Vector3> pos,
            List<Vector3> norm,
            List<Vector2> uv,
            List<Color> col,
            List<int> idx) {
            var key = (trayIndex, sourceMaterial);
            if (!propBuckets.TryGetValue(key, out var bucket)) {
                bucket = new PropCombineBucket { TrayIndex = trayIndex, SourceMaterial = sourceMaterial };
                propBuckets[key] = bucket;
            }
            if (bucket.Positions.Count + pos.Count >= 120000) {
                FlushPropBucket(bucket);
            }
            int baseVertex = bucket.Positions.Count;
            bucket.Positions.AddRange(pos);
            bucket.Normals.AddRange(norm);
            bucket.Uvs.AddRange(uv);
            bucket.Colors.AddRange(col);
            for (int i = 0; i < idx.Count; i++) bucket.Indices.Add(baseVertex + idx[i]);
        }

        void FlushAllPropBuckets() {
            foreach (var bucket in propBuckets.Values) {
                FlushPropBucket(bucket);
            }
            propBuckets.Clear();

            if (instancedPropBuckets.Count > 0 && rootObject != null) {
                var drawer = StationInstancedSurfaceDrawer.EnsureFor(rootObject.transform);
                drawer.PauseDuringExplodedView = false;
                foreach (var kv in instancedPropBuckets) {
                    var (trayIdx, mesh, subIdx, mat) = kv.Key;
                    var matrices = kv.Value;
                    if (mesh == null || mat == null || matrices == null || matrices.Count == 0) continue;
                    var tray = trays[trayIdx];
                    var go = new GameObject("ExplodedInstanced " + tray.Level + "m " + mesh.name);
                    go.layer = presentationLayer;
                    go.transform.SetParent(tray.PropsRoot, false);
                    go.transform.localPosition = Vector3.zero;
                    go.transform.localRotation = Quaternion.identity;
                    go.transform.localScale = Vector3.one;
                    var proxy = go.AddComponent<MeshRenderer>();
                    proxy.sharedMaterial = mat;
                    proxy.shadowCastingMode = ShadowCastingMode.Off;
                    proxy.receiveShadows = true;
                    tray.TintRenderers.Add((proxy, mat));
                    var batch = go.AddComponent<StationInstancedSurfaceBatch>();
                    batch.ShadowCasting = ShadowCastingMode.Off;
                    batch.ConfigureMatrices(mesh, subIdx, proxy, matrices, followTransformOffset: true);
                    drawer.Add(batch);
                }
                instancedPropBuckets.Clear();
            }
        }

        void FlushPropBucket(PropCombineBucket bucket) {
            if (bucket == null || bucket.Positions.Count == 0 || bucket.Indices.Count < 3) return;
            var tray = trays[bucket.TrayIndex];
            var vertArr = bucket.Positions.ToArray();
            var triArr = bucket.Indices.ToArray();

            var mesh = new Mesh {
                name = "ExplodedProps " + tray.Level + "m " + (bucket.SourceMaterial != null ? bucket.SourceMaterial.name : "mat"),
            };
            if (vertArr.Length > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertArr);
            mesh.SetNormals(bucket.Normals);
            mesh.SetUVs(0, bucket.Uvs);
            mesh.SetColors(bucket.Colors);
            mesh.SetTriangles(triArr, 0, calculateBounds: true);
            mesh.UploadMeshData(markNoLongerReadable: true);
            ownedMeshes.Add(mesh);

            CreateTrayMeshObject(tray, tray.PropsRoot, mesh.name, mesh, bucket.SourceMaterial);

            tray.PickBuckets.Add(new PickBucket {
                SourceWorldBounds = mesh.bounds,
                Vertices = vertArr,
                Triangles = triArr,
                IsFrontWall = false,
            });

            bucket.Positions.Clear();
            bucket.Normals.Clear();
            bucket.Uvs.Clear();
            bucket.Colors.Clear();
            bucket.Indices.Clear();
        }

        /* ---------------------------------------- physical band plane clipping */

        /// <summary>
        /// Port of <c>clipFloorGeometry</c> (<c>game/src/render/explodedLayout.ts</c>): clips
        /// source world-space triangles against <c>y &gt;= minY</c> and <c>y &lt;= maxY</c>,
        /// interpolating positions, normals, UVs, and vertex colors at crossings.
        /// </summary>
        public static bool ClipMeshSubmeshToBand(
            Mesh mesh,
            int submesh,
            Matrix4x4 worldMatrix,
            float minY,
            float maxY,
            out List<Vector3> outPos,
            out List<Vector3> outNorm,
            out List<Vector2> outUv,
            out List<Color> outCol,
            out List<int> outIndices) {
            outPos = new List<Vector3>();
            outNorm = new List<Vector3>();
            outUv = new List<Vector2>();
            outCol = new List<Color>();
            outIndices = new List<int>();

            if (!ExtractWorldSubmesh(mesh, submesh, worldMatrix,
                    out var srcPos, out var srcNorm, out var srcUv, out var srcCol, out var srcIdx)) {
                return false;
            }

            var poly = new List<ClipVertex>(8);
            var next = new List<ClipVertex>(8);

            for (int t = 0; t + 2 < srcIdx.Count; t += 3) {
                int i0 = srcIdx[t], i1 = srcIdx[t + 1], i2 = srcIdx[t + 2];
                poly.Clear();
                poly.Add(new ClipVertex(srcPos[i0], srcNorm[i0], srcUv[i0], srcCol[i0]));
                poly.Add(new ClipVertex(srcPos[i1], srcNorm[i1], srcUv[i1], srcCol[i1]));
                poly.Add(new ClipVertex(srcPos[i2], srcNorm[i2], srcUv[i2], srcCol[i2]));

                // Plane 1: +y - minY >= 0
                ClipPolygonAgainstPlane(poly, new Vector3(0f, 1f, 0f), -minY, next);
                if (next.Count < 3) continue;

                // Plane 2: -y + maxY >= 0
                ClipPolygonAgainstPlane(next, new Vector3(0f, -1f, 0f), maxY, poly);
                if (poly.Count < 3) continue;

                for (int j = 1; j + 1 < poly.Count; j++) {
                    int baseIdx = outPos.Count;
                    AppendClipVertex(poly[0], outPos, outNorm, outUv, outCol);
                    AppendClipVertex(poly[j], outPos, outNorm, outUv, outCol);
                    AppendClipVertex(poly[j + 1], outPos, outNorm, outUv, outCol);
                    outIndices.Add(baseIdx);
                    outIndices.Add(baseIdx + 1);
                    outIndices.Add(baseIdx + 2);
                }
            }

            return outIndices.Count >= 3;
        }

        readonly struct ClipVertex {
            public readonly Vector3 Pos;
            public readonly Vector3 Norm;
            public readonly Vector2 Uv;
            public readonly Color Col;

            public ClipVertex(Vector3 pos, Vector3 norm, Vector2 uv, Color col) {
                Pos = pos;
                Norm = norm;
                Uv = uv;
                Col = col;
            }

            public static ClipVertex Lerp(in ClipVertex a, in ClipVertex b, float t) {
                var n = Vector3.LerpUnclamped(a.Norm, b.Norm, t);
                if (n.sqrMagnitude > 1e-8f) n.Normalize();
                return new ClipVertex(
                    Vector3.LerpUnclamped(a.Pos, b.Pos, t),
                    n,
                    Vector2.LerpUnclamped(a.Uv, b.Uv, t),
                    Color.LerpUnclamped(a.Col, b.Col, t));
            }
        }

        static void ClipPolygonAgainstPlane(List<ClipVertex> input, Vector3 normal, float constant, List<ClipVertex> output) {
            output.Clear();
            int count = input.Count;
            if (count == 0) return;
            const float eps = -1e-6f;
            for (int i = 0; i < count; i++) {
                var a = input[i];
                var b = input[(i + 1) % count];
                float da = Vector3.Dot(normal, a.Pos) + constant;
                float db = Vector3.Dot(normal, b.Pos) + constant;
                if (da >= eps) output.Add(a);
                if ((da < eps) != (db < eps)) {
                    float denom = da - db;
                    float t = Mathf.Abs(denom) > 1e-12f ? Mathf.Clamp01(da / denom) : 0f;
                    output.Add(ClipVertex.Lerp(in a, in b, t));
                }
            }
        }

        static void AppendClipVertex(
            in ClipVertex v,
            List<Vector3> pos,
            List<Vector3> norm,
            List<Vector2> uv,
            List<Color> col) {
            pos.Add(v.Pos);
            norm.Add(v.Norm);
            uv.Add(v.Uv);
            col.Add(v.Col);
        }

        static bool ExtractWorldSubmesh(
            Mesh mesh,
            int submesh,
            Matrix4x4 worldMatrix,
            out List<Vector3> posResult,
            out List<Vector3> normResult,
            out List<Vector2> uvResult,
            out List<Color> colResult,
            out List<int> outIndices) {
            // The local function below captures these lists, so they cannot be the out
            // parameters themselves; the out parameters alias them from the first statement,
            // which also keeps every path (the early return included) definitely assigned.
            var outPos = new List<Vector3>();
            var outNorm = new List<Vector3>();
            var outUv = new List<Vector2>();
            var outCol = new List<Color>();
            posResult = outPos;
            normResult = outNorm;
            uvResult = outUv;
            colResult = outCol;
            outIndices = new List<int>();
            if (mesh == null || !mesh.isReadable) return false;

            int clampedSubmesh = Mathf.Clamp(submesh, 0, Mathf.Max(0, mesh.subMeshCount - 1));
            if (mesh.GetTopology(clampedSubmesh) != MeshTopology.Triangles) return false;
            var tris = mesh.GetTriangles(clampedSubmesh);
            if (tris == null || tris.Length < 3) return false;

            var srcVerts = mesh.vertices;
            if (srcVerts == null || srcVerts.Length == 0) return false;
            var srcNorms = mesh.normals;
            var srcUvs = mesh.uv;
            var srcCols = mesh.colors;

            bool hasNorms = srcNorms != null && srcNorms.Length == srcVerts.Length;
            bool hasUvs = srcUvs != null && srcUvs.Length == srcVerts.Length;
            bool hasCols = srcCols != null && srcCols.Length == srcVerts.Length;
            var normalMatrix = worldMatrix.inverse.transpose;
            bool flipWinding = worldMatrix.determinant < 0f;

            var remap = new Dictionary<int, int>(tris.Length);
            int Map(int idx) {
                if (remap.TryGetValue(idx, out int mapped)) return mapped;
                mapped = outPos.Count;
                remap[idx] = mapped;
                outPos.Add(worldMatrix.MultiplyPoint3x4(srcVerts[idx]));
                if (hasNorms) {
                    var n = normalMatrix.MultiplyVector(srcNorms[idx]);
                    if (n.sqrMagnitude > 1e-8f) n.Normalize();
                    outNorm.Add(n);
                } else {
                    outNorm.Add(Vector3.up);
                }
                outUv.Add(hasUvs ? srcUvs[idx] : Vector2.zero);
                outCol.Add(hasCols ? srcCols[idx] : Color.white);
                return mapped;
            }

            for (int t = 0; t + 2 < tris.Length; t += 3) {
                int a = Map(tris[t]);
                int b = Map(flipWinding ? tris[t + 2] : tris[t + 1]);
                int c = Map(flipWinding ? tris[t + 1] : tris[t + 2]);
                outIndices.Add(a);
                outIndices.Add(b);
                outIndices.Add(c);
            }
            return outIndices.Count >= 3;
        }

        void RegisterTransformedPickMesh(StationExplodedTrayInstance tray, Mesh mesh, Matrix4x4 worldMatrix, out Bounds worldBounds) {
            worldBounds = TransformLocalBounds(mesh.bounds, worldMatrix);
            if (!mesh.isReadable) return;
            var srcVerts = mesh.vertices;
            if (srcVerts == null || srcVerts.Length == 0) return;
            List<int> collectedTris = null;
            int submeshes = Mathf.Max(1, mesh.subMeshCount);
            for (int s = 0; s < submeshes; s++) {
                if (mesh.GetTopology(s) != MeshTopology.Triangles) continue;
                var subTris = mesh.GetTriangles(s);
                if (subTris == null || subTris.Length < 3) continue;
                collectedTris ??= new List<int>(subTris.Length);
                collectedTris.AddRange(subTris);
            }
            if (collectedTris == null || collectedTris.Count < 3) return;
            var srcTris = collectedTris.ToArray();
            var verts = new Vector3[srcVerts.Length];
            for (int i = 0; i < srcVerts.Length; i++) verts[i] = worldMatrix.MultiplyPoint3x4(srcVerts[i]);
            bool flip = worldMatrix.determinant < 0f;
            int[] tris;
            if (flip) {
                tris = new int[srcTris.Length];
                for (int t = 0; t + 2 < srcTris.Length; t += 3) {
                    tris[t] = srcTris[t];
                    tris[t + 1] = srcTris[t + 2];
                    tris[t + 2] = srcTris[t + 1];
                }
            } else {
                tris = srcTris;
            }
            tray.PickBuckets.Add(new PickBucket {
                SourceWorldBounds = worldBounds,
                Vertices = verts,
                Triangles = tris,
                IsFrontWall = false,
            });
        }

        /* ---------------------------------------- selection, drag & visibility */

        public void SelectTray(int? trayIndex) {
            ThrowIfDisposed();
            if (trayIndex.HasValue && (trayIndex.Value < 0 || trayIndex.Value >= trays.Length)) {
                trayIndex = null;
            }
            if (selectedIndex == trayIndex) return;
            selectedIndex = trayIndex;
            ApplySelectionTint();
        }

        void ApplySelectionTint() {
            for (int i = 0; i < trays.Length; i++) {
                var tray = trays[i];
                bool selected = selectedIndex.HasValue && selectedIndex.Value == i;
                if (tray.IsTinted == selected) continue;
                tray.IsTinted = selected;
                var bindings = tray.TintRenderers;
                for (int b = 0; b < bindings.Count; b++) {
                    var (renderer, sourceMat) = bindings[b];
                    if (renderer == null || sourceMat == null) continue;
                    renderer.sharedMaterial = selected
                        ? GetOrCreateTintedMaterial(tray, sourceMat)
                        : sourceMat;
                }
            }
        }

        public void SetTrayManualOffset(int trayIndex, Vector3 manualDocumentOffset) {
            ThrowIfDisposed();
            if (trayIndex < 0 || trayIndex >= trays.Length) return;
            manualOffsets[trayIndex] = manualDocumentOffset;
            var tray = trays[trayIndex];
            tray.ManualOffset = manualDocumentOffset;
            tray.TrayRoot.localPosition = tray.WorldOffset;
            UpdateGuides();
            RefreshPausedPoses();
        }

        public void AddTrayManualDelta(int trayIndex, Vector3 deltaDocumentOffset) {
            if (trayIndex < 0 || trayIndex >= trays.Length) return;
            SetTrayManualOffset(trayIndex, manualOffsets[trayIndex] + deltaDocumentOffset);
        }

        public void SetFloorVisibility(int trayIndex, bool visible) {
            ThrowIfDisposed();
            if (trayIndex < 0 || trayIndex >= trays.Length) return;
            floorVisible[trayIndex] = visible;
            var tray = trays[trayIndex];
            tray.FloorVisible = visible;
            if (tray.TrayRoot != null) tray.TrayRoot.gameObject.SetActive(visible);
            UpdateGuides();
            SyncEscalatorSteps();
            RefreshPausedPoses();
        }

        public void SetWallsVisibility(int trayIndex, bool visible) {
            ThrowIfDisposed();
            if (trayIndex < 0 || trayIndex >= trays.Length) return;
            var tray = trays[trayIndex];
            tray.WallsVisible = visible;
            if (tray.WallsRoot != null) tray.WallsRoot.gameObject.SetActive(visible);
        }

        /// <summary>
        /// Port of <c>ExplodedLayout.reset()</c>: clears manual offsets and selection while
        /// preserving <c>floorVisible</c> and <c>wallsVisible</c> choices.
        /// </summary>
        public void ResetArrangement() {
            ThrowIfDisposed();
            for (int i = 0; i < trays.Length; i++) {
                manualOffsets[i] = Vector3.zero;
                trays[i].ManualOffset = Vector3.zero;
                if (trays[i].TrayRoot != null) {
                    trays[i].TrayRoot.localPosition = trays[i].WorldOffset;
                }
            }
            SelectTray(null);
            UpdateGuides();
            RefreshPausedPoses();
        }

        /// <summary>
        /// Returns packed visible document bounds across all visible trays for initial
        /// standalone camera framing (<c>SceneRenderer.frameStandalonePresentation</c>).
        /// </summary>
        public List<Bounds> CollectPackedDocumentBounds(bool visibleOnly = true) {
            var list = new List<Bounds>(trays.Length);
            for (int i = 0; i < trays.Length; i++) {
                var tray = trays[i];
                if (visibleOnly && !tray.FloorVisible) continue;
                if (!tray.HasSourceBounds) continue;
                var b = tray.SourceDocumentBounds;
                b.center += tray.TotalDocumentOffset;
                list.Add(b);
            }
            return list;
        }

        /// <summary>
        /// Projects the selected tray's 8 bounding-box corners through <paramref name="viewerCamera"/>
        /// into top-left normalized viewport coordinates <c>[0..1, 0..1]</c> matching
        /// <c>ExplodedLayout.screenAnchor</c>.
        /// </summary>
        public bool TryProjectSelectedAnchor(Camera viewerCamera, out Vector2 normalizedAnchor) {
            normalizedAnchor = Vector2.zero;
            if (viewerCamera == null || !selectedIndex.HasValue) return false;
            int idx = selectedIndex.Value;
            if (idx < 0 || idx >= trays.Length) return false;
            var tray = trays[idx];
            if (!tray.HasSourceBounds) return false;

            var docBounds = tray.SourceDocumentBounds;
            var shift = tray.TotalDocumentOffset;
            float rightVpX = float.NegativeInfinity;
            float minVpY = float.PositiveInfinity;
            float maxVpY = float.NegativeInfinity;

            for (int c = 0; c < 8; c++) {
                var docCorner = new Vector3(
                    ((c & 1) == 0 ? docBounds.min.x : docBounds.max.x) + shift.x,
                    ((c & 2) == 0 ? docBounds.min.y : docBounds.max.y) + shift.y,
                    ((c & 4) == 0 ? docBounds.min.z : docBounds.max.z) + shift.z);
                var vp = viewerCamera.WorldToViewportPoint(StationCoordinates.Point(docCorner));
                if (vp.x > rightVpX) rightVpX = vp.x;
                if (vp.y < minVpY) minVpY = vp.y;
                if (vp.y > maxVpY) maxVpY = vp.y;
            }

            if (!float.IsFinite(rightVpX) || !float.IsFinite(minVpY) || !float.IsFinite(maxVpY)) return false;
            normalizedAnchor = new Vector2(rightVpX, 1f - (minVpY + maxVpY) * 0.5f);
            return true;
        }

        /* ---------------------------------------- single-ray CPU tray picking */

        /// <summary>
        /// Resolves a single world-space ray from the viewer camera against all visible trays and
        /// visible front-wall buckets. Hidden trays, hidden front-wall buckets, dashed guides, and
        /// live actors are excluded. Zero <see cref="Collider"/> components are used.
        /// </summary>
        public bool PickTray(Ray worldRay, out int trayIndex, out float bestDistance) {
            ThrowIfDisposed();
            PickCount++;
            trayIndex = -1;
            bestDistance = float.MaxValue;
            if (worldRay.direction.sqrMagnitude < 1e-12f) return false;

            var dir = worldRay.direction.normalized;
            for (int i = 0; i < trays.Length; i++) {
                var tray = trays[i];
                if (!tray.FloorVisible) continue;
                var localRay = new Ray(worldRay.origin - tray.WorldOffset, dir);
                var buckets = tray.PickBuckets;
                for (int b = 0; b < buckets.Count; b++) {
                    var bucket = buckets[b];
                    if (bucket.IsFrontWall && !tray.WallsVisible) continue;
                    if (!bucket.SourceWorldBounds.IntersectRay(localRay, out float boundsDist) || boundsDist > bestDistance) {
                        continue;
                    }
                    var verts = bucket.Vertices;
                    var tris = bucket.Triangles;
                    for (int t = 0; t + 2 < tris.Length; t += 3) {
                        if (RayIntersectsTriangle(
                                localRay,
                                verts[tris[t]],
                                verts[tris[t + 1]],
                                verts[tris[t + 2]],
                                bestDistance,
                                out float hitDist)) {
                            bestDistance = hitDist;
                            trayIndex = i;
                        }
                    }
                }
            }
            return trayIndex >= 0;
        }

        static bool RayIntersectsTriangle(Ray ray, Vector3 a, Vector3 b, Vector3 c, float maxDistance, out float distance) {
            const float eps = 1e-7f;
            distance = 0f;
            var e1 = b - a;
            var e2 = c - a;
            var p = Vector3.Cross(ray.direction, e2);
            float det = Vector3.Dot(e1, p);
            if (det > -eps && det < eps) return false;
            float invDet = 1f / det;
            var s = ray.origin - a;
            float u = Vector3.Dot(s, p) * invDet;
            if (u < 0f || u > 1f) return false;
            var q = Vector3.Cross(s, e1);
            float v = Vector3.Dot(ray.direction, q) * invDet;
            if (v < 0f || u + v > 1f) return false;
            float hit = Vector3.Dot(e2, q) * invDet;
            if (hit <= eps || hit >= maxDistance) return false;
            distance = hit;
            return true;
        }

        /* ---------------------------------------- dashed connector guides */

        void SetupGuidesMesh() {
            guidesObject = new GameObject("Guides");
            guidesObject.layer = presentationLayer;
            guidesObject.transform.SetParent(rootObject.transform, false);
            guidesObject.transform.localPosition = Vector3.zero;
            guidesObject.transform.localRotation = Quaternion.identity;
            guidesObject.transform.localScale = Vector3.one;

            guidesMesh = new Mesh { name = "ExplodedGuides" };
            guidesMesh.MarkDynamic();
            ownedMeshes.Add(guidesMesh);

            var guideShader = Resources.Load<Shader>("StationExplodedGuide") ??
                              Shader.Find("Metro/Station Exploded Guide") ??
                              fallbackShader;
            guidesMaterial = new Material(guideShader) { name = "ExplodedGuidesMaterial" };
            if (guidesMaterial.HasProperty(BaseColorId)) guidesMaterial.SetColor(BaseColorId, GuideColor);
            if (guidesMaterial.HasProperty(ColorId)) guidesMaterial.SetColor(ColorId, GuideColor);
            if (guidesMaterial.HasProperty(DashSizeId)) guidesMaterial.SetFloat(DashSizeId, GuideDashMeters);
            if (guidesMaterial.HasProperty(GapSizeId)) guidesMaterial.SetFloat(GapSizeId, GuideGapMeters);
            ownedMaterials.Add(guidesMaterial);

            var mf = guidesObject.AddComponent<MeshFilter>();
            mf.sharedMesh = guidesMesh;
            var mr = guidesObject.AddComponent<MeshRenderer>();
            mr.sharedMaterial = guidesMaterial;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
        }

        public void UpdateGuides(Camera viewerCamera = null) {
            if (guidesMesh == null) return;
            guideVertices.Clear();
            guideUvs.Clear();
            guideIndices.Clear();
            lastGuideEndpoints.Clear();

            float halfWidth = 0.08f;
            Vector3 viewForward = new Vector3(-0.57735f, -0.57735f, 0.57735f);
            if (viewerCamera != null) {
                viewForward = viewerCamera.transform.forward;
                if (viewerCamera.orthographic && viewerCamera.pixelHeight > 0) {
                    float worldPerPixel = (2f * viewerCamera.orthographicSize) / Mathf.Max(1, viewerCamera.pixelHeight);
                    halfWidth = Mathf.Clamp(worldPerPixel * 1.15f, 0.04f, 0.35f);
                }
            }

            for (int i = 0; i < connections.Length; i++) {
                var conn = connections[i];
                if (conn.LowerIndex < 0 || conn.LowerIndex >= floorVisible.Length || !floorVisible[conn.LowerIndex]) continue;
                if (conn.UpperIndex < 0 || conn.UpperIndex >= floorVisible.Length || !floorVisible[conn.UpperIndex]) continue;

                StationExplodedConnections.EvaluateWorldEndpoints(
                    in conn,
                    plan.PackedOffsets,
                    plan.Direction,
                    manualOffsets,
                    out var lowerWorld,
                    out var upperWorld,
                    out float docDistance);

                if (docDistance < 1e-4f) continue;
                var seg = upperWorld - lowerWorld;
                float worldLen = seg.magnitude;
                if (worldLen < 1e-4f) continue;

                lastGuideEndpoints.Add((lowerWorld, upperWorld));
                var dir = seg / worldLen;
                var side = Vector3.Cross(dir, viewForward);
                if (side.sqrMagnitude < 1e-6f) side = Vector3.Cross(dir, Vector3.up);
                if (side.sqrMagnitude < 1e-6f) side = Vector3.right;
                side = side.normalized * halfWidth;

                int baseV = guideVertices.Count;
                guideVertices.Add(lowerWorld - side);
                guideVertices.Add(lowerWorld + side);
                guideVertices.Add(upperWorld + side);
                guideVertices.Add(upperWorld - side);

                guideUvs.Add(new Vector2(0f, -1f));
                guideUvs.Add(new Vector2(0f, 1f));
                guideUvs.Add(new Vector2(docDistance, 1f));
                guideUvs.Add(new Vector2(docDistance, -1f));

                guideIndices.Add(baseV);
                guideIndices.Add(baseV + 1);
                guideIndices.Add(baseV + 2);
                guideIndices.Add(baseV);
                guideIndices.Add(baseV + 2);
                guideIndices.Add(baseV + 3);
            }

            guidesMesh.Clear(keepVertexLayout: false);
            if (guideVertices.Count > 0) {
                if (guideVertices.Count > 65000) guidesMesh.indexFormat = IndexFormat.UInt32;
                guidesMesh.SetVertices(guideVertices);
                guidesMesh.SetUVs(0, guideUvs);
                guidesMesh.SetTriangles(guideIndices, 0, calculateBounds: true);
            }
        }

        /* ---------------------------------------- live poses (passengers, trains, lifts, escalators) */

        void BuildLiveConsists() {
            consistBindings.Clear();
            consistById.Clear();
            if (trainCatalogue == null) return;

            var staticBodyCache = new Dictionary<string, TrainConsistViews.StaticCombinedPart[]>(StringComparer.Ordinal);
            for (int l = 0; l < document.Lines.Count; l++) {
                var line = document.Lines[l];
                if (line == null || string.IsNullOrEmpty(line.Id)) continue;
                var tracks = TrainConsistGeometry.ServiceTracks(document, line.Id);
                if (tracks.Count == 0) continue;
                string formationKey = TrainFormations.Select(line.Stock, line.Cars, line.Power, trainCatalogue);
                if (!trainCatalogue.TryGet(formationKey, out var entry) || entry == null || entry.prefab == null) continue;
                float scale = entry.bakedScale > 0f ? entry.bakedScale : 1f;

                for (int t = 0; t < tracks.Count; t++) {
                    var track = tracks[t];
                    int ownerLevel = plan.ModuleOwnerById.TryGetValue(track.Id, out int mappedOwner)
                        ? mappedOwner
                        : StationExplodedLayoutPlan.StoreyBand(track.ExactZ, plan.LevelBase, plan.StoreyHeight);
                    int trayIdx = plan.IndexOfLevel(ownerLevel);
                    if (trayIdx < 0) continue;
                    if (!TrainConsistGeometry.TryBerth(document, line, track, scale, out var berth, out _)) continue;

                    string trainId = line.Id + "|" + track.Id;
                    var instance = UnityEngine.Object.Instantiate(entry.prefab, trays[trayIdx].LiveRoot, false);
                    instance.name = "exploded-consist " + trainId;
                    instance.transform.localScale = Vector3.one;
                    TrainConsistViews.CompactConsistInstance(
                        instance, formationKey, staticBodyCache, ownedMeshes, ShadowCastingMode.Off);
                    var liveryBinding = TrainLiveryBinder.Capture(instance);
                    TrainLiveryBinder.Apply(
                        liveryBinding,
                        line.Id,
                        string.IsNullOrEmpty(line.Colour) ? StationCityStyles.LineColourFor(line.Id, document.City) : line.Colour,
                        document.City,
                        consistLiveryPool,
                        ownedMaterials,
                        recaptureVisibility: false);
                    if (!trainMarkListenerAttached) {
                        TrainMarkTextureCache.TextureUpdated += RefreshExplodedTrainMarks;
                        trainMarkListenerAttached = true;
                    }
                    SetLayerRecursively(instance, presentationLayer);

                    var view = new TrainConsistView {
                        TrainId = trainId,
                        LineId = line.Id,
                        TrackId = track.Id,
                        FormationKey = formationKey,
                        PrefabPath = entry.prefabPath ?? "",
                        Stock = line.Stock,
                        Scale = scale,
                        Berth = berth,
                        Root = instance,
                        LiveryBinding = liveryBinding,
                    };
                    PlaceConsistInTrayLocalSpace(view);

                    var rig = new TrainDoorRig(instance, TrainDoorRig.ForLine(line.Stock, line.Cars, scale));
                    view.Rig = rig;
                    int bankMask = berth.DoorBankMask;
                    view.DoorBankMask = bankMask;
                    view.PlatformBank = (bankMask & 1) != 0 ? 1 : ((bankMask & 2) != 0 ? -1 : berth.DefaultPlatformBank);
                    rig.SetActiveBankMask(bankMask);
                    rig.Reset();
                    if (rig.Leaves > 0) {
                        trainDoorDispatch.BindTrainMask(trainId, rig, bankMask);
                    }

                    view.Retire();
                    PlaceConsistInTrayLocalSpace(view);

                    var binding = new ConsistTrayBinding { View = view, TrayIndex = trayIdx };
                    consistBindings.Add(binding);
                    consistById[trainId] = binding;
                }
            }
        }

        static void PlaceConsistInTrayLocalSpace(TrainConsistView view) {
            if (view?.Root == null || view.Berth == null) return;
            var doc = new Vector3(
                view.Berth.DocumentPosition.x + view.Berth.Facing.x * view.OffsetMetres,
                view.Berth.DocumentPosition.y + view.Berth.Facing.y * view.OffsetMetres,
                view.Berth.DocumentPosition.z);
            view.DocumentPosition = doc;
            view.Root.transform.localPosition = StationCoordinates.Point(doc);
            var front = view.Berth.Facing * view.Berth.DirectionSign;
            float yaw = Mathf.Atan2(front.y, front.x) * Mathf.Rad2Deg;
            view.Root.transform.localRotation = Quaternion.Euler(0f, -yaw, 0f);
        }

        void BuildLiveCrowd() {
            var paxCatalogue = PassengerCatalogueAnchor.Resolve();
            if (paxCatalogue == null) return;
            passengersObject = new GameObject("Passengers");
            passengersObject.layer = presentationLayer;
            passengersObject.transform.SetParent(rootObject.transform, false);
            passengersObject.transform.localPosition = Vector3.zero;
            passengersObject.transform.localRotation = Quaternion.identity;
            passengersObject.transform.localScale = Vector3.one;

            crowdView = PassengerCrowdView.Build(
                passengersObject.transform,
                paxCatalogue,
                spawned: (actor, _) => {
                    if (actor?.Root != null) SetLayerRecursively(actor.Root, presentationLayer);
                });
            // PassengerCrowdView.Render invokes spawned only when registering via PassengerCrowdRenderer;
            // we also ensure newly spawned actor roots adopt presentationLayer after each Render call.
        }

        /// <summary>
        /// Updates passengers, train consists, lift cabins, and escalator rolling steps from the
        /// live simulation session without copying navigation state.
        /// </summary>
        long lastLiveGeneration = long.MinValue;

        public void TickPublishedPoses(StationPublishedSimFrame published, StationFrameClock clock, bool forceSnap = false) {
            ThrowIfDisposed();
            SyncEscalatorSteps();
            if (published == null) return;

            bool reset = forceSnap ||
                         !hasCachedLiveSample ||
                         published.Generation != lastLiveGeneration ||
                         clock.Epoch != lastLiveEpoch;

            if (reset || published.Tick != lastLiveTick) {
                lastLiveGeneration = published.Generation;
                cachedSession = null;
                cachedMotionFrame = published.Motion;
                cachedPassengerFrames = published.Motion.Passengers ?? Array.Empty<StationPassengerFrame>();
                UpdatePassengerTickBuffers(cachedPassengerFrames, reset);
                lastLiveTick = published.Tick;
                lastLiveEpoch = clock.Epoch;
                hasCachedLiveSample = true;
            }

            lastLiveAlpha = reset ? 1f : Mathf.Clamp01((float)clock.Fraction);
            lastPresentationSeconds = clock.PresentationSeconds;
            lastClockPlaying = clock.Playing;

            ApplyTrainFrames(cachedMotionFrame, lastLiveAlpha, reset);
            ApplyLiftFrames(cachedMotionFrame);
            ApplyPassengerFrames(lastLiveAlpha, lastPresentationSeconds, snapAll: reset);
        }

        public void TickLivePoses(StationSimulationSession session, StationFrameClock clock, bool forceSnap = false) {
            ThrowIfDisposed();
            SyncEscalatorSteps();
            if (session == null) return;

            bool reset = forceSnap ||
                         !hasCachedLiveSample ||
                         !ReferenceEquals(session, cachedSession) ||
                         clock.Epoch != lastLiveEpoch;

            if (reset || clock.Tick != lastLiveTick) {
                cachedSession = session;
                cachedMotionFrame = session.Snapshot();
                cachedPassengerFrames = session.PassengerFrames() ?? Array.Empty<StationPassengerFrame>();
                UpdatePassengerTickBuffers(cachedPassengerFrames, reset);
                lastLiveTick = clock.Tick;
                lastLiveEpoch = clock.Epoch;
                hasCachedLiveSample = true;
            }

            lastLiveAlpha = reset ? 1f : Mathf.Clamp01((float)clock.Fraction);
            lastPresentationSeconds = clock.PresentationSeconds;
            lastClockPlaying = clock.Playing;

            ApplyTrainFrames(cachedMotionFrame, lastLiveAlpha, reset);
            ApplyLiftFrames(cachedMotionFrame);
            ApplyPassengerFrames(lastLiveAlpha, lastPresentationSeconds, snapAll: reset);
        }

        /// <summary>
        /// Re-applies the cached simulation frame immediately when the station is paused and the
        /// player drags, hides, or resets a tray.
        /// </summary>
        public void RefreshPausedPoses() {
            if (!hasCachedLiveSample) return;
            ApplyTrainFrames(cachedMotionFrame, lastLiveAlpha, resetHistory: false);
            ApplyLiftFrames(cachedMotionFrame);
            ApplyPassengerFrames(lastLiveAlpha, lastPresentationSeconds, snapAll: false);
        }

        /// <summary>Deterministic test entry point for exercising live passenger/lift/train frames.</summary>
        public void ApplyLiveSampleForTest(
            StationMotionFrame motionFrame,
            StationPassengerFrame[] passengerFrames,
            long tick,
            float alpha,
            double presentationSeconds = 0.0,
            bool forceSnap = false) {
            ThrowIfDisposed();
            bool reset = forceSnap || !hasCachedLiveSample;
            if (reset || tick != lastLiveTick) {
                cachedMotionFrame = motionFrame;
                cachedPassengerFrames = passengerFrames ?? Array.Empty<StationPassengerFrame>();
                UpdatePassengerTickBuffers(cachedPassengerFrames, reset);
                lastLiveTick = tick;
                hasCachedLiveSample = true;
            }
            lastLiveAlpha = reset ? 1f : Mathf.Clamp01(alpha);
            lastPresentationSeconds = presentationSeconds;
            ApplyTrainFrames(cachedMotionFrame, lastLiveAlpha, reset);
            ApplyLiftFrames(cachedMotionFrame);
            ApplyPassengerFrames(lastLiveAlpha, lastPresentationSeconds, snapAll: reset);
        }

        void ApplyTrainFrames(StationMotionFrame frame, float alpha, bool resetHistory) {
            if (consistBindings.Count == 0) return;
            if (resetHistory) {
                for (int i = 0; i < consistBindings.Count; i++) consistBindings[i].View.ForgetSample();
                trainDoorDispatch.ForgetSamples();
            }
            var trains = frame.Trains;
            if (trains == null) return;

            var activeIds = new HashSet<string>(StringComparer.Ordinal);
            int positioned = 0;
            for (int i = 0; i < trains.Length; i++) {
                var train = trains[i];
                if (string.IsNullOrEmpty(train.Id) || !consistById.TryGetValue(train.Id, out var binding)) continue;
                var view = binding.View;
                if (view?.Root == null) continue;
                if (!floorVisible[binding.TrayIndex] || train.Phase == TrainPhase.None || train.ServiceSequence == 0) {
                    view.Retire();
                    PlaceConsistInTrayLocalSpace(view);
                    continue;
                }
                if (train.ServiceSequence != view.ServiceSequence) view.ForgetSample();
                view.Apply(train, alpha);
                PlaceConsistInTrayLocalSpace(view);
                activeIds.Add(train.Id);
                positioned++;
            }

            for (int i = 0; i < consistBindings.Count; i++) {
                var view = consistBindings[i].View;
                if (view?.Root == null || activeIds.Contains(view.TrainId)) continue;
                view.Retire();
                PlaceConsistInTrayLocalSpace(view);
            }

            if (positioned > 0) {
                trainDoorDispatch.Apply(frame, alpha);
                for (int i = 0; i < consistBindings.Count; i++) {
                    var view = consistBindings[i].View;
                    if (view.Berth != null && view.DoorBankMask == 0) view.Rig?.Reset();
                    if (view.Root != null && activeIds.Contains(view.TrainId)) view.Mount();
                }
            }
        }

        void ApplyLiftFrames(StationMotionFrame frame) {
            if (liftBindings.Count == 0) return;
            var liftsById = new Dictionary<string, StationLiftFrame>(StringComparer.Ordinal);
            if (frame.Lifts != null) {
                for (int i = 0; i < frame.Lifts.Length; i++) {
                    var lf = frame.Lifts[i];
                    if (!string.IsNullOrEmpty(lf.Id)) liftsById[lf.Id] = lf;
                }
            }

            for (int i = 0; i < liftBindings.Count; i++) {
                var binding = liftBindings[i];
                if (binding.View?.Lift == null) continue;
                float cabinFloorZ = binding.FromZ + 1f;
                float doorOpen = 0f;
                if (liftsById.TryGetValue(binding.SourceLiftId, out var liveLift)) {
                    cabinFloorZ = (float)(liveLift.Z + 1.0);
                    doorOpen = Mathf.Clamp01((float)liveLift.DoorFraction);
                }

                // Exact cabin-presence check from ComputeExplodedLiftPoses (`explodedLiftPoses`):
                bool present = floorVisible[binding.TrayIndex] &&
                               cabinFloorZ >= binding.FromZ + 1f - 1e-4f &&
                               (cabinFloorZ < binding.ToZ + 1f - 1e-4f ||
                                (Mathf.Approximately(binding.ToZ, binding.SourceHiZ) && cabinFloorZ <= binding.ToZ + 1f + 1e-4f));

                if (binding.View.Lift.Cabin != null) {
                    binding.View.Lift.Cabin.gameObject.SetActive(present);
                }
                binding.View.Apply(new ModuleMotionState {
                    ModuleId = binding.View.ModuleId,
                    CabinFraction = float.NaN,
                    CabinHeight = cabinFloorZ,
                    DoorFraction = present ? doorOpen : 0f,
                    PhaseMeters = double.NaN,
                });
            }
        }

        void UpdatePassengerTickBuffers(StationPassengerFrame[] frames, bool reset) {
            if (reset) {
                previousPassengers.Clear();
                lastTickPassengers.Clear();
                FillPassengerSampleMap(frames, previousPassengers);
                FillPassengerSampleMap(frames, lastTickPassengers);
                return;
            }
            previousPassengers.Clear();
            foreach (var pair in lastTickPassengers) previousPassengers[pair.Key] = pair.Value;
            lastTickPassengers.Clear();
            FillPassengerSampleMap(frames, lastTickPassengers);
        }

        void FillPassengerSampleMap(StationPassengerFrame[] frames, Dictionary<int, RawPassengerSample> target) {
            if (frames == null) return;
            for (int i = 0; i < frames.Length; i++) {
                var f = frames[i];
                int ownerBand = StationExplodedLayoutPlan.StoreyBand(f.Z, plan.LevelBase, plan.StoreyHeight);
                int ownerIdx = plan.IndexOfLevel(ownerBand);
                target[f.SimId] = new RawPassengerSample {
                    Frame = f,
                    OwnerTrayIndex = ownerIdx,
                };
            }
        }

        void ApplyPassengerFrames(float alpha, double simTimeSeconds, bool snapAll) {
            passengerTrayBySimId.Clear();
            presentedPassengers.Clear();

            for (int i = 0; i < cachedPassengerFrames.Length; i++) {
                var current = cachedPassengerFrames[i];
                if (!current.Visible) continue;

                // Owner tray is determined strictly from ORIGINAL pose Z before any manual shift
                // so overlapping dragged trays never steal riders based on displayed height.
                int ownerBand = StationExplodedLayoutPlan.StoreyBand(current.Z, plan.LevelBase, plan.StoreyHeight);
                int ownerIdx = plan.IndexOfLevel(ownerBand);
                if (ownerIdx < 0 || !floorVisible[ownerIdx]) continue;

                StationPassengerFrame sampled = current;
                if (!snapAll &&
                    alpha < 1f &&
                    previousPassengers.TryGetValue(current.SimId, out var prior) &&
                    prior.Frame.Visible &&
                    prior.OwnerTrayIndex == ownerIdx &&
                    ArePassengersAdjacentOnSameTray(prior.Frame, current)) {
                    sampled.X = LerpDouble(prior.Frame.X, current.X, alpha);
                    sampled.Y = LerpDouble(prior.Frame.Y, current.Y, alpha);
                    sampled.Z = LerpDouble(prior.Frame.Z, current.Z, alpha);
                    sampled.Heading = LerpAngle(prior.Frame.Heading, current.Heading, alpha);
                    sampled.ActivitySeconds = LerpDouble(prior.Frame.ActivitySeconds, current.ActivitySeconds, alpha);
                    sampled.WalkDistance = LerpDouble(prior.Frame.WalkDistance, current.WalkDistance, alpha);
                    sampled.WalkPhase = LerpDouble(prior.Frame.WalkPhase, current.WalkPhase, alpha);
                    sampled.WalkWeight = LerpDouble(prior.Frame.WalkWeight, current.WalkWeight, alpha);
                }

                int packedOff = plan.PackedOffsets[ownerIdx];
                double px = sampled.X + plan.Direction.x * packedOff;
                double py = sampled.Y + plan.Direction.y * packedOff;

                // Port of `filterExplodedPassengers`: keep riding passengers or walkers supported by
                // retained floor/ramp/lift/track cells in packed coordinates.
                bool supported = sampled.State == StationPassengerState.Riding ||
                                 plan.PassengerSupport.Contains(new StationCellKey(
                                     (int)Math.Floor(px),
                                     (int)Math.Floor(py),
                                     (int)Math.Floor(sampled.Z - 1.0 + 1e-3)));
                if (!supported) continue;

                passengerTrayBySimId[sampled.SimId] = ownerIdx;
                var manual = manualOffsets[ownerIdx];
                var pose = SessionPassengerFeed.Map(sampled);
                pose.X = px + manual.x;
                pose.Y = py + manual.y;
                pose.Z = sampled.Z + manual.z;
                presentedPassengers.Add(pose);
            }

            if (crowdView != null) {
                crowdView.Render(presentedPassengers, simTimeSeconds);
                foreach (var actor in crowdView.Actors) {
                    if (actor?.Root != null && actor.Root.layer != presentationLayer) {
                        SetLayerRecursively(actor.Root, presentationLayer);
                    }
                }
            }
        }

        static bool ArePassengersAdjacentOnSameTray(in StationPassengerFrame prior, in StationPassengerFrame current) {
            if (prior.Activity != current.Activity || prior.State != current.State) return false;
            double dx = current.X - prior.X;
            double dy = current.Y - prior.Y;
            double dz = current.Z - prior.Z;
            return dz * dz < 0.75 * 0.75 && dx * dx + dy * dy < 3.0 * 3.0;
        }

        static double LerpDouble(double a, double b, float t) => a + (b - a) * t;

        static double LerpAngle(double from, double to, float t) {
            double delta = to - from;
            while (delta > Math.PI) delta -= Math.PI * 2.0;
            while (delta < -Math.PI) delta += Math.PI * 2.0;
            return from + delta * t;
        }

        /* ---------------------------------------- materials & object helpers */

        Material GetOrCreateTintedMaterial(StationExplodedTrayInstance tray, Material sourceMaterial) {
            if (sourceMaterial == null) {
                sourceMaterial = ResolveFinishMaterial(null);
            }
            if (tray.ClonedBySource.TryGetValue(sourceMaterial, out var existing) && existing != null) {
                return existing;
            }
            var clone = new Material(sourceMaterial) {
                name = sourceMaterial.name + " [Tray " + tray.Level + "m Selected]",
            };
            if (clone.HasProperty(BaseColorId)) {
                clone.SetColor(BaseColorId, Color.Lerp(clone.GetColor(BaseColorId), SelectionTintColor, SelectionTintLerp));
            }
            if (clone.HasProperty(ColorId)) {
                clone.SetColor(ColorId, Color.Lerp(clone.GetColor(ColorId), SelectionTintColor, SelectionTintLerp));
            }
            if (clone.HasProperty(EmissionColorId)) {
                clone.EnableKeyword("_EMISSION");
                clone.SetColor(EmissionColorId, clone.GetColor(EmissionColorId) + SelectionEmissionAdd);
            }
            ownedMaterials.Add(clone);
            tray.ClonedBySource[sourceMaterial] = clone;
            return clone;
        }

        GameObject CreateTrayMeshObject(StationExplodedTrayInstance tray, Transform parent, string name, Mesh mesh, Material sourceMaterial) {
            if (sourceMaterial == null) {
                sourceMaterial = ResolveFinishMaterial(null);
            }
            var go = new GameObject(name);
            go.layer = presentationLayer;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = Vector3.zero;
            go.transform.localRotation = Quaternion.identity;
            go.transform.localScale = Vector3.one;
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = sourceMaterial;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = true;
            if (tray != null) {
                tray.TintRenderers.Add((mr, sourceMaterial));
            }
            return go;
        }

        void ReleaseTemporaryBuildState() {
            deferredItems.Clear();
            deferredItems.TrimExcess();
            propBuckets.Clear();
            instancedPropBuckets.Clear();
            sourceSubmeshCache.Clear();
            tempSurfaceParts.Clear();
            if (modulesById != null) {
                modulesById.Clear();
                modulesById = null;
            }
            allModuleFacts = null;
            if (allDocumentSolids != null) {
                allDocumentSolids.Clear();
                allDocumentSolids = null;
            }
        }

        static Material SubmeshMaterial(Material[] materials, int submesh) {
            if (materials == null || materials.Length == 0) return null;
            return submesh < materials.Length && materials[submesh] != null ? materials[submesh] : materials[0];
        }

        static Bounds TransformLocalBounds(Bounds local, Matrix4x4 matrix) {
            Bounds world = default;
            for (int c = 0; c < 8; c++) {
                var pt = matrix.MultiplyPoint3x4(new Vector3(
                    (c & 1) == 0 ? local.min.x : local.max.x,
                    (c & 2) == 0 ? local.min.y : local.max.y,
                    (c & 4) == 0 ? local.min.z : local.max.z));
                if (c == 0) world = new Bounds(pt, Vector3.zero);
                else world.Encapsulate(pt);
            }
            return world;
        }

        static void ApplyWorldMatrixToTransform(Transform target, Matrix4x4 m) {
            target.localPosition = m.GetColumn(3);
            var forward = (Vector3)m.GetColumn(2);
            var up = (Vector3)m.GetColumn(1);
            if (forward.sqrMagnitude > 1e-8f && up.sqrMagnitude > 1e-8f) {
                target.localRotation = Quaternion.LookRotation(forward, up);
            }
            float sign = m.determinant < 0f ? -1f : 1f;
            target.localScale = new Vector3(
                sign * ((Vector3)m.GetColumn(0)).magnitude,
                ((Vector3)m.GetColumn(1)).magnitude,
                ((Vector3)m.GetColumn(2)).magnitude);
        }

        static int CountHierarchyTriangles(Transform root) {
            int count = 0;
            if (root == null) return 0;
            foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true)) {
                var m = mf != null ? mf.sharedMesh : null;
                if (m == null) continue;
                int submeshes = Mathf.Max(1, m.subMeshCount);
                for (int s = 0; s < submeshes; s++) {
                    if (m.GetTopology(s) == MeshTopology.Triangles) count += (int)(m.GetIndexCount(s) / 3);
                }
            }
            return count;
        }

        public static void SetLayerRecursively(GameObject go, int layer) {
            if (go == null) return;
            go.layer = layer;
            var t = go.transform;
            int children = t.childCount;
            for (int i = 0; i < children; i++) {
                SetLayerRecursively(t.GetChild(i).gameObject, layer);
            }
        }

        void ThrowIfDisposed() {
            if (disposed) throw new ObjectDisposedException(nameof(StationExplodedTrayBuilder));
        }

        void RefreshExplodedTrainMarks() {
            if (document == null) return;
            var lineById = new Dictionary<string, StationLineRecord>(document.Lines.Count, StringComparer.Ordinal);
            for (int i = 0; i < document.Lines.Count; i++) {
                var l = document.Lines[i];
                if (l != null && !string.IsNullOrEmpty(l.Id)) lineById[l.Id] = l;
            }
            for (int i = 0; i < consistBindings.Count; i++) {
                var v = consistBindings[i]?.View;
                if (v?.LiveryBinding == null || v.Root == null) continue;
                string colour = lineById.TryGetValue(v.LineId, out var line) && !string.IsNullOrEmpty(line.Colour)
                    ? line.Colour
                    : StationCityStyles.LineColourFor(v.LineId, document.City);
                TrainLiveryBinder.Apply(
                    v.LiveryBinding, v.LineId, colour, document.City,
                    consistLiveryPool, ownedMaterials, recaptureVisibility: false);
            }
        }

        public void Dispose() {
            if (trainMarkListenerAttached) {
                TrainMarkTextureCache.TextureUpdated -= RefreshExplodedTrainMarks;
                trainMarkListenerAttached = false;
            }
            consistLiveryPool.Clear();
            if (disposed) return;
            disposed = true;

            if (crowdView != null) {
                crowdView.Release();
                crowdView = null;
            }

            for (int i = 0; i < liftBindings.Count; i++) {
                var view = liftBindings[i].View;
                if (view != null) {
                    if (view.Root != null) DestroyUnityObject(view.Root.gameObject);
                    view.Dispose();
                }
            }
            liftBindings.Clear();
            escalatorBindings.Clear();

            for (int i = 0; i < consistBindings.Count; i++) {
                if (consistBindings[i].View?.Root != null) {
                    DestroyUnityObject(consistBindings[i].View.Root);
                }
            }
            consistBindings.Clear();
            consistById.Clear();
            trainDoorDispatch.Clear();

            for (int i = 0; i < trays.Length; i++) {
                var tray = trays[i];
                if (tray == null) continue;
                tray.PickBuckets.Clear();
                tray.TintRenderers.Clear();
                tray.ClonedBySource.Clear();
            }

            for (int i = 0; i < ownedMeshes.Count; i++) {
                var m = ownedMeshes[i];
                if (m != null) {
                    m.Clear(keepVertexLayout: false);
                    DestroyUnityObject(m);
                }
            }
            ownedMeshes.Clear();

            for (int i = 0; i < ownedMaterials.Count; i++) {
                DestroyUnityObject(ownedMaterials[i]);
            }
            ownedMaterials.Clear();

            if (finishLibrary != null) {
                if (ownsFinishLibrary) finishLibrary.Dispose();
                finishLibrary = null;
                ownsFinishLibrary = false;
            }
            sharedLiftPalette = null;
            ReleaseTemporaryBuildState();

            if (rootObject != null) {
                DestroyUnityObject(rootObject);
                rootObject = null;
            }
        }

        static void DestroyUnityObject(UnityEngine.Object obj) {
            if (obj == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(obj);
            else UnityEngine.Object.DestroyImmediate(obj);
        }
    }
}
