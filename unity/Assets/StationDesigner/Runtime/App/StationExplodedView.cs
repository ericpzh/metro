using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Metro.App {
    /// <summary>
    /// Full-screen standalone exploded-view presentation owner (Plan 19 §1–§4).
    ///
    /// Owns an isolated presentation hierarchy on User Layer 8 (<c>ExplodedPresentation</c>),
    /// an independent orthographic <see cref="Camera"/> and <see cref="StationCameraController"/>,
    /// deferred prop/ramp/lift batching, generation-fenced bridge commands, and live simulation
    /// pose attachment — leaving the editor world, camera, Undo stack, selection, and document
    /// revision untouched.
    /// </summary>
    public sealed class StationExplodedView : MonoBehaviour, IStationFrameSink {
        /// <summary>Three standalone exploded-view dark void (<c>#192532</c> in <c>explodedView.ts</c>).</summary>
        public static readonly Color DefaultVoidColor = new Color(0x19 / 255f, 0x25 / 255f, 0x32 / 255f, 1f);

        public const string PhaseClosed = "closed";
        public const string PhaseLoading = "loading";
        public const string PhaseReady = "ready";
        public const string PhaseError = "error";

        StationGameHost host;
        StationViewRig viewRig;

        GameObject viewerRigObject;
        Camera viewerCamera;
        readonly StationCameraController viewerCameraController = new StationCameraController {
            MaxDistance = StationCameraMath.MaxStandaloneDistance,
        };

        StationExplodedTrayBuilder builder;
        int presentationLayer = StationExplodedTrayBuilder.FallbackLayer;
        int generation;
        int sourceRevision;
        string phase = PhaseClosed;
        string lastError = "";
        string activeTheme = "blueprint";
        int viewportWidth = 1280;
        int viewportHeight = 720;

        // Saved editor camera & fog state while standalone viewer owns presentation
        bool editorBaselineSaved;
        Camera savedEditorCamera;
        bool savedEditorCameraEnabled;
        int savedEditorCullingMask;
        Color savedEditorBackground;
        Vector3 savedEditorPosition;
        Quaternion savedEditorRotation;
        bool savedEditorOrthographic;
        float savedEditorOrthoSize;
        float savedEditorFov;
        bool savedFogEnabled;
        FogMode savedFogMode;
        Color savedFogColor;
        float savedFogStart;
        float savedFogEnd;

        // Pointer capture state
        int? capturedPointerId;
        int draggedTrayIndex = -1;

        /// <summary>Deferred prop work items processed per frame while open.</summary>
        public int PropsBatchBudget { get; set; } = 96;

        /// <summary>When false (used by PlayMode cancellation tests), Update skips auto-advancing deferred props.</summary>
        public bool AutoAdvanceDeferredProps { get; set; } = true;

        public int Generation => generation;
        public int SourceRevision => sourceRevision;
        public string Phase => phase;
        public string LastError => lastError;
        public bool IsOpen => string.Equals(phase, PhaseLoading, StringComparison.Ordinal) ||
                              string.Equals(phase, PhaseReady, StringComparison.Ordinal);
        public bool IsReady => string.Equals(phase, PhaseReady, StringComparison.Ordinal);
        public bool IsEquipped => builder != null && builder.EquipmentReady;
        public bool IsDraggingTray => capturedPointerId.HasValue && draggedTrayIndex >= 0;
        public int ViewportWidth => viewportWidth;
        public int ViewportHeight => viewportHeight;
        public Camera ViewerCamera => viewerCamera;
        public StationCameraController CameraController => viewerCameraController;
        public StationExplodedTrayBuilder Builder => builder;

        public void Bind(StationGameHost stationHost, StationViewRig rig) {
            if (host == stationHost && viewRig == rig && viewerRigObject != null) return;
            UnbindCoordinator();
            host = stationHost;
            viewRig = rig;
            presentationLayer = StationExplodedTrayBuilder.ResolvePresentationLayer();
            EnsureViewerRig();
            StripPresentationLayerFromEditorCamera();
            StationFrameSinks.Add(this);
            if (host?.Coordinator != null) {
                host.Coordinator.BeforePreviousDispose += OnBeforePreviousWorldDispose;
            }
        }

        void UnbindCoordinator() {
            if (host?.Coordinator != null) {
                host.Coordinator.BeforePreviousDispose -= OnBeforePreviousWorldDispose;
            }
        }

        void EnsureViewerRig() {
            if (viewerRigObject != null) return;
            viewerRigObject = new GameObject("ExplodedViewerRig");
            viewerRigObject.layer = presentationLayer;
            viewerRigObject.transform.SetParent(transform, false);
            viewerRigObject.SetActive(false);

            var camGo = new GameObject("ExplodedViewerCamera");
            camGo.layer = presentationLayer;
            camGo.transform.SetParent(viewerRigObject.transform, false);
            viewerCamera = camGo.AddComponent<Camera>();
            viewerCamera.enabled = false;
            viewerCamera.orthographic = true;
            viewerCamera.cullingMask = 1 << presentationLayer;
            viewerCamera.clearFlags = CameraClearFlags.SolidColor;
            viewerCamera.backgroundColor = DefaultVoidColor;
            viewerCamera.nearClipPlane = StationCameraMath.OrthographicNear;
            viewerCamera.farClipPlane = 4000f;
            viewerCamera.allowHDR = false;
            viewerCamera.allowMSAA = true;
            viewerCamera.depth = 10f;
        }

        Camera ResolveEditorCamera() {
            if (viewRig != null && viewRig.viewCamera != null) return viewRig.viewCamera;
            if (host != null && host.stationCamera != null) return host.stationCamera;
            return null;
        }

        void StripPresentationLayerFromEditorCamera() {
            var edCam = ResolveEditorCamera();
            if (edCam != null) {
                edCam.cullingMask &= ~(1 << presentationLayer);
            }
        }

        static Color ResolveVoidColor(string theme) =>
            string.Equals(theme, "studio", StringComparison.OrdinalIgnoreCase)
                ? StationRenderRig.StudioVoidColor
                : DefaultVoidColor;

        void SaveEditorBaselineIfNeeded() {
            if (editorBaselineSaved) return;
            savedEditorCamera = ResolveEditorCamera();
            if (savedEditorCamera != null) {
                savedEditorCameraEnabled = savedEditorCamera.enabled;
                // Preserve any non-exploded layers; ensure ExplodedPresentation stays stripped on editor cam
                savedEditorCullingMask = savedEditorCamera.cullingMask & ~(1 << presentationLayer);
                savedEditorBackground = savedEditorCamera.backgroundColor;
                savedEditorPosition = savedEditorCamera.transform.position;
                savedEditorRotation = savedEditorCamera.transform.rotation;
                savedEditorOrthographic = savedEditorCamera.orthographic;
                savedEditorOrthoSize = savedEditorCamera.orthographicSize;
                savedEditorFov = savedEditorCamera.fieldOfView;
            }
            savedFogEnabled = RenderSettings.fog;
            savedFogMode = RenderSettings.fogMode;
            savedFogColor = RenderSettings.fogColor;
            savedFogStart = RenderSettings.fogStartDistance;
            savedFogEnd = RenderSettings.fogEndDistance;
            editorBaselineSaved = true;
        }

        void RestoreEditorBaseline() {
            if (viewerCamera != null) viewerCamera.enabled = false;
            if (viewerRigObject != null) viewerRigObject.SetActive(false);

            if (!editorBaselineSaved) {
                StripPresentationLayerFromEditorCamera();
                return;
            }

            var targetCam = savedEditorCamera != null ? savedEditorCamera : ResolveEditorCamera();
            if (targetCam != null) {
                targetCam.transform.SetPositionAndRotation(savedEditorPosition, savedEditorRotation);
                targetCam.orthographic = savedEditorOrthographic;
                targetCam.orthographicSize = savedEditorOrthoSize;
                targetCam.fieldOfView = savedEditorFov;
                targetCam.cullingMask = savedEditorCullingMask & ~(1 << presentationLayer);
                targetCam.backgroundColor = savedEditorBackground;
                targetCam.enabled = savedEditorCameraEnabled;
            }

            RenderSettings.fog = savedFogEnabled;
            RenderSettings.fogMode = savedFogMode;
            RenderSettings.fogColor = savedFogColor;
            RenderSettings.fogStartDistance = savedFogStart;
            RenderSettings.fogEndDistance = savedFogEnd;

            editorBaselineSaved = false;
            savedEditorCamera = null;
        }

        /// <summary>Legacy <c>view.set exploded</c> bridge hook.</summary>
        public bool SetOpenFromLegacyCommand(bool wantOpen) {
            if (wantOpen) {
                if (IsOpen) return true;
                return Open(activeTheme, viewportWidth, viewportHeight, out _);
            }
            Close();
            return true;
        }

        public bool Open(string theme, int width, int height, out string error) {
            error = "";
            if (host == null || !host.IsLoaded || host.Document == null) {
                error = "No committed station is loaded.";
                return false;
            }

            presentationLayer = StationExplodedTrayBuilder.ResolvePresentationLayer();
            EnsureViewerRig();

            if (!string.IsNullOrEmpty(theme)) activeTheme = theme;
            if (width > 0 && height > 0) {
                viewportWidth = width;
                viewportHeight = height;
            } else if (Screen.width > 0 && Screen.height > 0) {
                viewportWidth = Screen.width;
                viewportHeight = Screen.height;
            }

            SaveEditorBaselineIfNeeded();
            StripPresentationLayerFromEditorCamera();

            // Dispose any previous open session without clobbering the saved editor baseline
            DisposeBuilderAndInput();

            generation++;
            sourceRevision = host.CurrentRevision;
            phase = PhaseLoading;
            lastError = "";

            try {
                viewerRigObject.SetActive(true);
                builder = new StationExplodedTrayBuilder(
                    host.Document,
                    host.Coordinator?.World,
                    host.catalogue,
                    host.trainCatalogue,
                    host.stationShader,
                    viewerRigObject.transform,
                    presentationLayer);

                builder.BuildStructuralTrays();

                float aspect = viewportHeight > 0 ? (float)viewportWidth / viewportHeight : 16f / 9f;
                viewerCameraController.FrameStandalonePresentation(builder.CollectPackedDocumentBounds(), aspect);
                ApplyViewerCamera();

                var edCam = ResolveEditorCamera();
                if (edCam != null) edCam.enabled = false;

                viewerCamera.cullingMask = 1 << presentationLayer;
                viewerCamera.enabled = true;
                StationRenderRig.Apply(viewerCamera, activeTheme);
                RenderSettings.fog = false;
                viewerCamera.backgroundColor = ResolveVoidColor(activeTheme);

                builder.UpdateGuides(viewerCamera);
                TickCurrentSimulation(forceSnap: true);

                phase = PhaseReady;
                viewRig?.Commands?.SyncExplodedState(true);
                return true;
            } catch (Exception ex) {
                lastError = ex.Message;
                DisposeBuilderAndInput();
                RestoreEditorBaseline();
                phase = PhaseError;
                viewRig?.Commands?.SyncExplodedState(false);
                error = ex.Message;
                return false;
            }
        }

        /// <summary>Synchronously finishes all remaining deferred prop batches (useful for deterministic tests).</summary>
        public void CompleteAllPropsNow() {
            if (builder == null || builder.EquipmentReady) return;
            builder.CompleteAllProps();
            builder.UpdateGuides(viewerCamera);
            TickCurrentSimulation(forceSnap: true);
        }

        /// <summary>Steps a single batch of deferred prop work items.</summary>
        public bool StepPropsBatch(int maxItems) {
            if (builder == null) return false;
            bool finished = builder.StepPropsBatch(maxItems);
            if (finished) {
                builder.UpdateGuides(viewerCamera);
                TickCurrentSimulation(forceSnap: true);
            }
            return finished;
        }

        /// <summary>Idempotently closes the standalone viewer and restores editor presentation.</summary>
        public void Close() {
            DisposeBuilderAndInput();
            RestoreEditorBaseline();
            phase = PhaseClosed;
            lastError = "";
            viewRig?.Commands?.SyncExplodedState(false);
        }

        void DisposeBuilderAndInput() {
            capturedPointerId = null;
            draggedTrayIndex = -1;
            viewerCameraController.ClearHeld();
            if (builder != null) {
                builder.Dispose();
                builder = null;
            }
        }

        void OnBeforePreviousWorldDispose(StationWorldView outgoingWorld) {
            if (IsOpen || builder != null) {
                Close();
                host?.PublishStateNow();
            }
        }

        public void SetTheme(string theme) {
            if (!string.IsNullOrEmpty(theme)) activeTheme = theme;
            if (IsOpen && viewerCamera != null) {
                viewerCamera.backgroundColor = ResolveVoidColor(activeTheme);
                RenderSettings.fog = false;
            }
        }

        public void SetViewportSize(int width, int height) {
            if (width <= 0 || height <= 0) return;
            viewportWidth = width;
            viewportHeight = height;
            viewerCameraController.SetAspect((float)width / height);
            if (IsOpen) {
                ApplyViewerCamera();
                builder?.UpdateGuides(viewerCamera);
            }
        }

        void ApplyViewerCamera() {
            if (viewerCamera == null) return;
            viewerCameraController.ApplyTo(viewerCamera);
            viewerCamera.farClipPlane = Mathf.Max(4000f, viewerCameraController.State.Distance + 2500f);
            viewerCamera.cullingMask = 1 << presentationLayer;
        }

        void TickCurrentSimulation(bool forceSnap) {
            if (builder == null || host == null) return;
            var sim = host.Simulation;
            var simHost = sim as StationSimulationHost;
            double simTime = sim?.SimTimeSeconds ?? 0.0;
            double fraction = sim?.PresentationFraction ?? 0.0;
            if (double.IsNaN(fraction) || double.IsInfinity(fraction)) fraction = 0.0;
            var clock = new StationFrameClock(
                sim?.SimulationTick ?? 0,
                sim?.PresentationEpoch ?? 0,
                simTime,
                simTime - (1.0 - fraction) * StationSimConstants.SimSecondsPerTick,
                fraction,
                sim?.Playing ?? false);
            builder.TickLivePoses(simHost?.Session, clock, forceSnap);
        }

        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) {
            if (!IsReady || builder == null) return;
            var simHost = host?.Simulation as StationSimulationHost;
            builder.TickLivePoses(simHost?.Session, clock, forceSnap: false);
        }

        void Update() {
            if (!IsReady || builder == null) return;

            if (AutoAdvanceDeferredProps && !builder.EquipmentReady) {
                if (builder.StepPropsBatch(PropsBatchBudget)) {
                    builder.UpdateGuides(viewerCamera);
                    TickCurrentSimulation(forceSnap: true);
                    host?.PublishStateNow();
                }
            }

            if (!IsDraggingTray &&
                (viewerCameraController.HeldRight != 0f || viewerCameraController.HeldForward != 0f || viewerCameraController.HeldVertical != 0)) {
                viewerCameraController.Tick(Mathf.Min(Time.unscaledDeltaTime, 0.05f));
                ApplyViewerCamera();
                builder.UpdateGuides(viewerCamera);
                if (builder.SelectedIndex.HasValue) {
                    host?.PublishStateNow();
                }
            }
        }

        void OnDestroy() {
            StationFrameSinks.Remove(this);
            UnbindCoordinator();
            Close();
            if (viewerRigObject != null) {
                if (Application.isPlaying) Destroy(viewerRigObject);
                else DestroyImmediate(viewerRigObject);
                viewerRigObject = null;
                viewerCamera = null;
            }
        }

        /* ---------------------------------------- command operations */

        public bool SelectElevation(int? elevation, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!IsReady || builder == null) {
                rejectCode = "stale-generation";
                rejectReason = "Exploded viewer is not ready.";
                return false;
            }
            if (!elevation.HasValue) {
                builder.SelectTray(null);
                return true;
            }
            int idx = builder.Plan.IndexOfLevel(elevation.Value);
            if (idx < 0) {
                rejectCode = "unknown-elevation";
                rejectReason = "Elevation " + elevation.Value + " is not in the exploded tray ladder.";
                return false;
            }
            builder.SelectTray(idx);
            return true;
        }

        public bool SetFloorAndWallVisibility(int elevation, bool? floorVis, bool? wallsVis, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!IsReady || builder == null) {
                rejectCode = "stale-generation";
                rejectReason = "Exploded viewer is not ready.";
                return false;
            }
            int idx = builder.Plan.IndexOfLevel(elevation);
            if (idx < 0) {
                rejectCode = "unknown-elevation";
                rejectReason = "Elevation " + elevation + " is not in the exploded tray ladder.";
                return false;
            }
            if (!floorVis.HasValue && !wallsVis.HasValue) {
                rejectCode = "bad-visibility";
                rejectReason = "Expected floorVisible or wallsVisible boolean.";
                return false;
            }
            if (floorVis.HasValue) {
                builder.SetFloorVisibility(idx, floorVis.Value);
                if (!floorVis.Value && draggedTrayIndex == idx) {
                    draggedTrayIndex = -1;
                }
            }
            if (wallsVis.HasValue) {
                builder.SetWallsVisibility(idx, wallsVis.Value);
            }
            builder.UpdateGuides(viewerCamera);
            return true;
        }

        public void ResetArrangement() {
            if (!IsReady || builder == null) return;
            capturedPointerId = null;
            draggedTrayIndex = -1;
            builder.ResetArrangement();
            builder.UpdateGuides(viewerCamera);
        }

        public bool HandlePointerDown(int pointerId, float x, float y, int width, int height, out bool hitTray) {
            hitTray = false;
            if (!IsReady || builder == null || viewerCamera == null) return false;
            SetViewportSize(width, height);

            float nx = Mathf.Clamp01(x / Mathf.Max(1, width));
            float ny = Mathf.Clamp01(1f - (y / Mathf.Max(1, height)));
            var worldRay = viewerCamera.ViewportPointToRay(new Vector3(nx, ny, 0f));

            capturedPointerId = pointerId;
            if (builder.PickTray(worldRay, out int trayIdx, out _)) {
                hitTray = true;
                draggedTrayIndex = trayIdx;
                builder.SelectTray(trayIdx);
                // Suppress held WASD pan while dragging a floor tray
                viewerCameraController.SetHeldPlanar(0f, 0f, false);
            } else {
                draggedTrayIndex = -1;
                builder.SelectTray(null);
            }
            return true;
        }

        public bool HandlePointerMove(int pointerId, float dx, float dy, int width, int height, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!capturedPointerId.HasValue || capturedPointerId.Value != pointerId) {
                rejectCode = "uncaptured-pointer";
                rejectReason = "Pointer " + pointerId + " is not captured by the exploded viewer.";
                return false;
            }
            if (width > 0 && height > 0 && (width != viewportWidth || height != viewportHeight)) {
                SetViewportSize(width, height);
            }
            if (draggedTrayIndex >= 0 && builder != null) {
                var deltaDoc = viewerCameraController.TrayDragDelta(dx, dy, Mathf.Max(1, height), viewerCamera);
                builder.AddTrayManualDelta(draggedTrayIndex, deltaDoc);
                builder.UpdateGuides(viewerCamera);
            }
            return true;
        }

        public bool HandlePointerEnd(int pointerId, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!capturedPointerId.HasValue || capturedPointerId.Value != pointerId) {
                rejectCode = "uncaptured-pointer";
                rejectReason = "Pointer " + pointerId + " is not captured by the exploded viewer.";
                return false;
            }
            capturedPointerId = null;
            draggedTrayIndex = -1;
            return true;
        }

        public bool HandleCameraOp(JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!IsReady || builder == null) {
                rejectCode = "stale-generation";
                rejectReason = "Exploded viewer is not ready.";
                return false;
            }
            string op = payload?["op"]?.Value<string>() ?? "";
            if (TryReadPositiveInt(payload, "viewportWidth", out int vw) &&
                TryReadPositiveInt(payload, "viewportHeight", out int vh)) {
                SetViewportSize(vw, vh);
            }

            switch (op) {
                case "orbit": {
                    if (!TryReadFiniteFloat(payload, "dx", out float dx) ||
                        !TryReadFiniteFloat(payload, "dy", out float dy)) {
                        rejectCode = "bad-camera";
                        rejectReason = "Orbit requires finite dx and dy.";
                        return false;
                    }
                    float scale = 2f * Mathf.PI / Mathf.Max(1, viewportHeight);
                    if (payload["scale"] != null) {
                        if (!TryReadFiniteFloat(payload, "scale", out float explicitScale) || explicitScale <= 0f) {
                            rejectCode = "bad-camera";
                            rejectReason = "Orbit scale must be finite and positive.";
                            return false;
                        }
                        scale = explicitScale;
                    }
                    viewerCameraController.OrbitByPixels(dx, dy, scale);
                    ApplyViewerCamera();
                    builder.UpdateGuides(viewerCamera);
                    return true;
                }
                case "pan": {
                    if (!TryReadFiniteFloat(payload, "dx", out float dx) ||
                        !TryReadFiniteFloat(payload, "dy", out float dy)) {
                        rejectCode = "bad-camera";
                        rejectReason = "Pan requires finite dx and dy.";
                        return false;
                    }
                    viewerCameraController.PanByPixels(dx, dy, Mathf.Max(1, viewportHeight));
                    ApplyViewerCamera();
                    builder.UpdateGuides(viewerCamera);
                    return true;
                }
                case "zoom": {
                    float deltaY;
                    if (!TryReadFiniteFloat(payload, "deltaY", out deltaY) &&
                        !TryReadFiniteFloat(payload, "delta", out deltaY)) {
                        rejectCode = "bad-camera";
                        rejectReason = "Zoom requires finite deltaY.";
                        return false;
                    }
                    viewerCameraController.ZoomByWheel(deltaY);
                    ApplyViewerCamera();
                    builder.UpdateGuides(viewerCamera);
                    return true;
                }
                case "panPlanarHeld": {
                    if (!TryReadFiniteFloat(payload, "right", out float right) ||
                        !TryReadFiniteFloat(payload, "forward", out float forward)) {
                        rejectCode = "bad-camera";
                        rejectReason = "panPlanarHeld requires finite right and forward.";
                        return false;
                    }
                    bool boost = (payload["boost"]?.Type == JTokenType.Boolean && payload["boost"].Value<bool>()) ||
                                 (payload["fast"]?.Type == JTokenType.Boolean && payload["fast"].Value<bool>());
                    if (IsDraggingTray) {
                        viewerCameraController.SetHeldPlanar(0f, 0f, false);
                    } else {
                        viewerCameraController.SetHeldPlanar(right, forward, boost);
                    }
                    return true;
                }
                case "resize": {
                    if (!TryReadPositiveInt(payload, "viewportWidth", out int rw) ||
                        !TryReadPositiveInt(payload, "viewportHeight", out int rh)) {
                        rejectCode = "bad-viewport";
                        rejectReason = "Resize requires positive viewportWidth and viewportHeight.";
                        return false;
                    }
                    SetViewportSize(rw, rh);
                    return true;
                }
                default:
                    rejectCode = "unknown-camera-op";
                    rejectReason = "Unsupported exploded.camera op '" + op + "'.";
                    return false;
            }
        }

        /* ---------------------------------------- state snapshot */

        public JObject BuildSnapshot() {
            var rows = new JArray();
            JToken panelAnchor = JValue.CreateNull();
            var guides = new JArray();

            if (builder != null) {
                var trays = builder.Trays;
                for (int i = 0; i < trays.Count; i++) {
                    var t = trays[i];
                    rows.Add(new JObject {
                        ["elevation"] = t.Level,
                        ["floorVisible"] = t.FloorVisible,
                        ["wallsVisible"] = t.WallsVisible,
                        ["packedOffset"] = t.PackedOffset,
                        ["manualOffset"] = new JArray(t.ManualOffset.x, t.ManualOffset.y, t.ManualOffset.z),
                    });
                }

                if (viewerCamera != null && builder.TryProjectSelectedAnchor(viewerCamera, out var anchor)) {
                    panelAnchor = new JArray(anchor.x, anchor.y);
                }

                var conns = builder.Connections;
                var floorVis = builder.FloorVisibleFlags;
                var manual = builder.ManualOffsets;
                var packed = builder.Plan.PackedOffsets;
                var dir = builder.Plan.Direction;
                for (int i = 0; i < conns.Count; i++) {
                    var conn = conns[i];
                    if (conn.LowerIndex < 0 || conn.LowerIndex >= floorVis.Count || !floorVis[conn.LowerIndex]) continue;
                    if (conn.UpperIndex < 0 || conn.UpperIndex >= floorVis.Count || !floorVis[conn.UpperIndex]) continue;
                    StationExplodedConnections.EvaluateWorldEndpoints(
                        in conn, packed, dir, manual, out var lw, out var uw, out float dist);
                    if (dist < 1e-4f) continue;
                    guides.Add(new JObject {
                        ["id"] = conn.SourceModuleId,
                        ["kind"] = conn.Kind.ToString().ToLowerInvariant(),
                        ["lowerElevation"] = builder.Plan.Levels[conn.LowerIndex],
                        ["upperElevation"] = builder.Plan.Levels[conn.UpperIndex],
                        ["lowerWorld"] = new JArray(lw.x, lw.y, lw.z),
                        ["upperWorld"] = new JArray(uw.x, uw.y, uw.z),
                        ["distance"] = dist,
                    });
                }
            }

            JToken camJson = JValue.CreateNull();
            if (IsOpen && viewerCamera != null) {
                var snap = viewerCameraController.Snapshot(viewerCamera);
                camJson = new JObject {
                    ["position"] = new JArray(snap.Position.x, snap.Position.y, snap.Position.z),
                    ["target"] = new JArray(snap.Target.x, snap.Target.y, snap.Target.z),
                    ["right"] = new JArray(snap.Right.x, snap.Right.y, snap.Right.z),
                    ["up"] = new JArray(snap.Up.x, snap.Up.y, snap.Up.z),
                    ["back"] = new JArray(snap.Back.x, snap.Back.y, snap.Back.z),
                    ["ortho"] = snap.IsOrthographic,
                    ["orthoSize"] = snap.OrthoSize,
                    ["distance"] = snap.Distance,
                    ["fov"] = snap.Fov,
                };
            }

            return new JObject {
                ["generation"] = generation,
                ["sourceRevision"] = sourceRevision,
                ["phase"] = phase,
                ["equipped"] = IsEquipped,
                ["error"] = string.IsNullOrEmpty(lastError) ? JValue.CreateNull() : (JToken)lastError,
                ["selectedElevation"] = builder?.SelectedElevation.HasValue == true
                    ? (JToken)builder.SelectedElevation.Value
                    : JValue.CreateNull(),
                ["dragging"] = IsDraggingTray,
                ["pickCount"] = builder != null ? builder.PickCount : 0,
                ["rows"] = rows,
                ["panelAnchor"] = panelAnchor,
                ["activeGuides"] = guides.Count,
                ["guides"] = guides,
                ["camera"] = camJson,
            };
        }

        internal static bool TryReadFiniteFloat(JObject obj, string key, out float value) {
            value = 0f;
            if (obj == null) return false;
            var token = obj[key];
            if (token == null || (token.Type != JTokenType.Float && token.Type != JTokenType.Integer)) return false;
            double d = token.Value<double>();
            if (double.IsNaN(d) || double.IsInfinity(d)) return false;
            value = (float)d;
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        internal static bool TryReadExactInt(JObject obj, string key, out int value) {
            value = 0;
            if (obj == null) return false;
            var token = obj[key];
            if (token == null) return false;
            if (token.Type == JTokenType.Integer) {
                long l = token.Value<long>();
                if (l < int.MinValue || l > int.MaxValue) return false;
                value = (int)l;
                return true;
            }
            if (token.Type == JTokenType.Float) {
                double d = token.Value<double>();
                if (double.IsNaN(d) || double.IsInfinity(d) || Math.Abs(d - Math.Round(d)) > 1e-6) return false;
                if (d < int.MinValue || d > int.MaxValue) return false;
                value = (int)Math.Round(d);
                return true;
            }
            return false;
        }

        internal static bool TryReadPositiveInt(JObject obj, string key, out int value) {
            if (!TryReadExactInt(obj, key, out value)) return false;
            return value > 0;
        }
    }

    /// <summary>Publishes <c>payload.exploded</c> on every state/commit reply.</summary>
    public sealed class StationExplodedStateContributor : IStationStateContributor {
        readonly StationExplodedView viewer;
        public StationExplodedStateContributor(StationExplodedView viewer) { this.viewer = viewer; }
        public string Key => "exploded";
        public JObject BuildPayload(StationDocument document, StationIndex index) =>
            viewer != null ? viewer.BuildSnapshot() : null;
    }

    /// <summary>Handles <c>exploded.*</c> bridge commands with strict per-open generation fencing.</summary>
    public sealed class StationExplodedCommandHandler : IStationCommandHandler {
        readonly StationExplodedView viewer;
        readonly StationViewRig rig;
        readonly StationGameHost host;

        public StationExplodedCommandHandler(StationExplodedView viewer, StationViewRig rig, StationGameHost host) {
            this.viewer = viewer;
            this.rig = rig;
            this.host = host;
        }

        public string Capability => "exploded";

        public bool Handles(string type) => type != null && type.StartsWith("exploded.", StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject replyPayload, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (viewer == null || host == null) {
                rejectCode = "no-session";
                rejectReason = "Exploded viewer is not attached.";
                return false;
            }

            var input = command?.Payload;
            string type = command?.Type ?? "";

            switch (type) {
                case "exploded.open": {
                    int width = viewer.ViewportWidth;
                    int height = viewer.ViewportHeight;
                    if (input?["viewportWidth"] != null || input?["viewportHeight"] != null) {
                        if (!StationExplodedView.TryReadPositiveInt(input, "viewportWidth", out width) ||
                            !StationExplodedView.TryReadPositiveInt(input, "viewportHeight", out height)) {
                            rejectCode = "bad-viewport";
                            rejectReason = "viewportWidth and viewportHeight must be positive integers.";
                            return false;
                        }
                    }
                    string theme = input?["theme"]?.Type == JTokenType.String ? input["theme"].Value<string>() : null;
                    if (!viewer.Open(theme, width, height, out string openError)) {
                        rejectCode = host.IsLoaded ? "open-failed" : "no-session";
                        rejectReason = openError;
                        return false;
                    }
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.close": {
                    if (input?["generation"] != null && input["generation"].Type != JTokenType.Null) {
                        if (!StationExplodedView.TryReadExactInt(input, "generation", out int closeGen)) {
                            rejectCode = "bad-generation";
                            rejectReason = "generation must be an integer.";
                            return false;
                        }
                        // If a newer open session is already active, ignore a late cleanup from an older generation
                        if (viewer.IsOpen && closeGen != viewer.Generation) {
                            FillReply(replyPayload);
                            return true;
                        }
                    }
                    viewer.Close();
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.theme": {
                    if (input?["theme"] == null || input["theme"].Type != JTokenType.String) {
                        rejectCode = "bad-theme";
                        rejectReason = "theme must be a string.";
                        return false;
                    }
                    viewer.SetTheme(input["theme"].Value<string>());
                    FillReply(replyPayload);
                    return true;
                }
            }

            // Every other exploded.* command requires a live matching generation.
            if (!ValidateGeneration(input, out rejectCode, out rejectReason)) {
                return false;
            }

            switch (type) {
                case "exploded.select": {
                    int? elevation = null;
                    if (input != null && input.TryGetValue("elevation", out var elevToken) && elevToken.Type != JTokenType.Null) {
                        if (!StationExplodedView.TryReadExactInt(input, "elevation", out int parsedElev)) {
                            rejectCode = "unknown-elevation";
                            rejectReason = "elevation must be null or an integer.";
                            return false;
                        }
                        elevation = parsedElev;
                    }
                    if (!viewer.SelectElevation(elevation, out rejectCode, out rejectReason)) return false;
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.floorVisibility": {
                    if (!StationExplodedView.TryReadExactInt(input, "elevation", out int elev)) {
                        rejectCode = "unknown-elevation";
                        rejectReason = "elevation must be an integer.";
                        return false;
                    }
                    bool? floorVis = null;
                    bool? wallsVis = null;
                    if (input != null && input.TryGetValue("floorVisible", out var fv) && fv.Type != JTokenType.Null) {
                        if (fv.Type != JTokenType.Boolean) {
                            rejectCode = "bad-visibility";
                            rejectReason = "floorVisible must be boolean.";
                            return false;
                        }
                        floorVis = fv.Value<bool>();
                    }
                    if (input != null && input.TryGetValue("wallsVisible", out var wv) && wv.Type != JTokenType.Null) {
                        if (wv.Type != JTokenType.Boolean) {
                            rejectCode = "bad-visibility";
                            rejectReason = "wallsVisible must be boolean.";
                            return false;
                        }
                        wallsVis = wv.Value<bool>();
                    }
                    if (!viewer.SetFloorAndWallVisibility(elev, floorVis, wallsVis, out rejectCode, out rejectReason)) {
                        return false;
                    }
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.reset": {
                    viewer.ResetArrangement();
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.pointerDown": {
                    if (!StationExplodedView.TryReadExactInt(input, "pointerId", out int pointerId) ||
                        !StationExplodedView.TryReadFiniteFloat(input, "x", out float x) ||
                        !StationExplodedView.TryReadFiniteFloat(input, "y", out float y) ||
                        !StationExplodedView.TryReadPositiveInt(input, "viewportWidth", out int vw) ||
                        !StationExplodedView.TryReadPositiveInt(input, "viewportHeight", out int vh)) {
                        rejectCode = "bad-pointer";
                        rejectReason = "pointerDown requires integer pointerId, finite x/y, and positive viewport dimensions.";
                        return false;
                    }
                    if (!viewer.HandlePointerDown(pointerId, x, y, vw, vh, out bool captured)) {
                        rejectCode = "stale-generation";
                        rejectReason = "Exploded viewer is not ready.";
                        return false;
                    }
                    FillReply(replyPayload);
                    replyPayload["captured"] = captured;
                    return true;
                }

                case "exploded.pointerMove": {
                    if (!StationExplodedView.TryReadExactInt(input, "pointerId", out int pointerId) ||
                        !StationExplodedView.TryReadFiniteFloat(input, "dx", out float dx) ||
                        !StationExplodedView.TryReadFiniteFloat(input, "dy", out float dy) ||
                        !StationExplodedView.TryReadPositiveInt(input, "viewportWidth", out int vw) ||
                        !StationExplodedView.TryReadPositiveInt(input, "viewportHeight", out int vh)) {
                        rejectCode = "bad-pointer";
                        rejectReason = "pointerMove requires integer pointerId, finite dx/dy, and positive viewport dimensions.";
                        return false;
                    }
                    if (!viewer.HandlePointerMove(pointerId, dx, dy, vw, vh, out rejectCode, out rejectReason)) {
                        return false;
                    }
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.pointerUp":
                case "exploded.pointerCancel": {
                    if (!StationExplodedView.TryReadExactInt(input, "pointerId", out int pointerId)) {
                        rejectCode = "bad-pointer";
                        rejectReason = "pointerUp/pointerCancel requires integer pointerId.";
                        return false;
                    }
                    if (!viewer.HandlePointerEnd(pointerId, out rejectCode, out rejectReason)) {
                        return false;
                    }
                    FillReply(replyPayload);
                    return true;
                }

                case "exploded.camera": {
                    if (!viewer.HandleCameraOp(input, out rejectCode, out rejectReason)) {
                        return false;
                    }
                    FillReply(replyPayload);
                    return true;
                }

                default:
                    rejectCode = "unsupported-command";
                    rejectReason = "Unknown exploded command '" + type + "'.";
                    return false;
            }
        }

        bool ValidateGeneration(JObject input, out string rejectCode, out string rejectReason) {
            rejectCode = "";
            rejectReason = "";
            if (!StationExplodedView.TryReadExactInt(input, "generation", out int gen)) {
                rejectCode = "stale-generation";
                rejectReason = "Missing or non-integer exploded generation.";
                return false;
            }
            if (!viewer.IsOpen || gen != viewer.Generation) {
                rejectCode = "stale-generation";
                rejectReason = "Exploded generation " + gen + " is stale (active=" + viewer.Generation + ", open=" + viewer.IsOpen + ").";
                return false;
            }
            return true;
        }

        void FillReply(JObject replyPayload) {
            if (replyPayload != null) {
                replyPayload["exploded"] = viewer.BuildSnapshot();
                if (rig != null && rig.Configured) {
                    var snap = rig.SnapshotObject();
                    if (snap["view"] is JObject view && snap["capabilities"] is JObject viewCaps) {
                        view["capabilities"] = viewCaps.DeepClone();
                    }
                    replyPayload["view"] = snap["view"] ?? JValue.CreateNull();
                    replyPayload["capabilities"] = snap["capabilities"] ?? new JObject();
                }
                replyPayload["revision"] = host.CurrentRevision;
            }
            host?.PublishStateNow();
        }
    }
}
