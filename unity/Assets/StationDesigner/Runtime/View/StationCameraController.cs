using System;
using UnityEngine;

namespace Metro.View {
    /// <summary>
    /// The station camera rig, ported from <c>game/src/render/scene/systems/CameraSystem.ts</c>
    /// and <c>game/src/app/viewHome.ts</c>. It owns the document-space target, eye,
    /// projection and lens; it never reads a Unity transform back into that state, so
    /// the ViewCube can read the same numbers the renderer uses. <see cref="ApplyTo"/>
    /// is the only place the document pose becomes a Unity transform, and
    /// <see cref="Snapshot(Camera)"/> reads the applied camera back so a published
    /// basis is the rendered basis.
    ///
    /// Source parity notes:
    /// * presets and face snaps aim at the **bounds centre** (`setPreset`,
    ///   `setViewDirection`), not at the active storey;
    /// * a storey step (`frame`) moves the eye and the aim together, preserving the
    ///   orbit offset, bearing and zoom;
    /// * 显示其他层 / ceiling / walls / section are not camera state: a view tool must
    ///   never move this rig.
    /// </summary>
    public sealed class StationCameraController {
        public readonly StationCameraState State = new StationCameraState();

        /// <summary>Raised after any camera mutation so the host can coalesce a publish.</summary>
        public event Action Changed;

        /// <summary>True once a station has been installed (its bounds are real).</summary>
        public bool HasStation { get; private set; }

        /// <summary>The held vertical pan direction: +1 up, -1 down, 0 released.</summary>
        public int HeldVertical { get; private set; }

        /// <summary>
        /// The held ground pan, in the camera's own screen axes (right / forward,
        /// each -1…1). It is the same translation <see cref="PanByMetres"/> applies,
        /// integrated per elapsed second, so WASD and a pointer pan cannot drift apart.
        /// </summary>
        public float HeldRight { get; private set; }
        public float HeldForward { get; private set; }

        /// <summary>Shift: the held pan's fast multiplier, exactly as the source's keys.</summary>
        public bool HeldFast { get; private set; }

        /// <summary>The last preset applied, for diagnostics and publish (custom after a free move).</summary>
        public StationCameraPreset Preset { get; private set; } = StationCameraPreset.Iso;

        public StationProjection Projection => State.Projection;
        public float Fov => State.Fov;
        public int ActiveLevel => State.ActiveLevel;

        /// <summary>Install a live station: new bounds, its active storey and the home view.</summary>
        public void SetStation(Bounds documentBounds, int activeLevel) {
            State.Bounds = documentBounds;
            State.ActiveLevel = activeLevel;
            State.OrthoZoom = 1f;
            ClearHeld();
            HasStation = true;
            Home();
            // The source station open runs `goHomeView` then `zoomBy(2 / 3)`: the
            // station opens 50% closer than the preset's own framing
            // (`app/Viewport.tsx`). The ⌂ button itself stays at 1×.
            ZoomBy(2f / 3f);
        }

        /// <summary>
        /// A station edit changed the bounds. The view stays where the player left it
        /// (the source homes only on a station switch); only framing numbers update.
        /// </summary>
        public void SetBounds(Bounds documentBounds, bool resetHome = false) {
            State.Bounds = documentBounds;
            if (resetHome) Home();
            else Raise();
        }

        /// <summary>
        /// Step the edited storey. The source <c>frame</c> keeps the plan centre but
        /// follows the storey vertically, moving eye and aim by the same delta so the
        /// orbit, bearing, distance and ortho zoom are untouched.
        /// </summary>
        public void SetActiveLevel(int level) {
            if (State.ActiveLevel == level) return;
            State.ActiveLevel = level;
            var centre = State.Bounds.center;
            centre.z = level + 1f;
            var delta = centre - State.Target;
            State.Target += delta;
            State.Position += delta;
            Raise();
        }

        /// <summary>回到默认视角: iso preset, perspective, the default lens. Nothing else.</summary>
        public void Home() {
            State.Projection = StationProjection.Perspective;
            State.Fov = StationCameraMath.DefaultFov;
            ClearHeld();
            ApplyPresetFrame(StationCameraPreset.Iso);
            Raise();
        }

        /// <summary>Drop every held pan: the house taking focus, a release, a new station.</summary>
        public void ClearHeld() {
            HeldVertical = 0;
            HeldRight = 0f;
            HeldForward = 0f;
            HeldFast = false;
        }

        /// <summary>The source four presets; <c>custom</c> is a no-op.</summary>
        public void SetPreset(StationCameraPreset preset) {
            if (preset == StationCameraPreset.Custom) return;
            ApplyPresetFrame(preset);
            Raise();
        }

        private void ApplyPresetFrame(StationCameraPreset preset) {
            var direction = StationCameraMath.PresetDirection(preset);
            if (direction.sqrMagnitude < 1e-12f) return;
            var centre = State.Bounds.center;
            float distance = StationCameraMath.FramingDistance(State.Bounds);
            State.Target = centre;
            State.Position = centre + direction * distance;
            State.Projection = StationCameraMath.PresetProjection(preset);
            Preset = preset;
        }

        /// <summary>
        /// Snap the camera to look along a document direction, from the station toward
        /// the camera — the ViewCube's faces pass a face normal, its corners a corner
        /// vector. Faces are true projections (<paramref name="projection"/> is
        /// orthographic), corners an isometric perspective.
        /// </summary>
        public void SetViewDirection(Vector3 direction, StationProjection projection) {
            if (direction.sqrMagnitude < 1e-12f) direction = new Vector3(1f, 0f, 0f);
            var dir = direction.normalized;
            // The camera is Z-up, so looking straight along ±Z makes `lookAt`
            // degenerate; a hair off-axis keeps the roll defined and still reads as a
            // top / bottom view (source `setViewDirection`).
            if (Mathf.Abs(dir.x) < 1e-3f && Mathf.Abs(dir.y) < 1e-3f) dir.x = 1e-3f;
            dir.Normalize();
            var centre = State.Bounds.center;
            float distance = StationCameraMath.FramingDistance(State.Bounds);
            State.Target = centre;
            State.Position = centre + dir * distance;
            State.Projection = projection;
            Preset = StationCameraPreset.Custom;
            Raise();
        }

        /// <summary>
        /// Orbit from a pointer drag (source <c>orbitBy</c>): yaw around document up,
        /// pitch around screen-right, the elevation stopping just short of the poles.
        /// <paramref name="radiansPerPixel"/> is the cube's 0.008 by default; a canvas
        /// drag passes its own viewport-derived rate.
        /// </summary>
        public void OrbitByPixels(float dxPixels, float dyPixels, float radiansPerPixel = StationCameraMath.OrbitRadiansPerPixel) {
            if (!IsFinite(dxPixels) || !IsFinite(dyPixels) || !IsFinite(radiansPerPixel) || radiansPerPixel <= 0f) return;
            var offset = State.Position - State.Target;
            if (offset.sqrMagnitude < 1e-12f) return;
            offset = StationCameraMath.RotateAbout(offset, StationCameraMath.DocumentUp, -dxPixels * radiansPerPixel);
            var forward = offset.normalized;
            var right = Vector3.Cross(StationCameraMath.DocumentUp, forward);
            if (right.sqrMagnitude < 1e-8f) right = new Vector3(1f, 0f, 0f);
            right.Normalize();
            offset = StationCameraMath.RotateAbout(offset, right, -dyPixels * radiansPerPixel);
            float length = offset.magnitude;
            StationCameraMath.AnglesOf(offset, out float theta, out float phi);
            PlaceAt(theta, phi, length);
            Raise();
        }

        private void PlaceAt(float theta, float phi, float length) {
            if (length < 1e-6f) return;
            var offset = StationCameraMath.OffsetAt(theta, phi, length);
            State.Position = State.Target + offset;
        }

        /// <summary>Wheel zoom, both projections, under the source limits.</summary>
        public void ZoomBy(float factor) {
            if (!IsFinite(factor) || factor <= 0f) return;
            if (State.IsOrthographic) {
                State.OrthoZoom = Mathf.Clamp(State.OrthoZoom * factor, StationCameraMath.OrthoZoomMin, StationCameraMath.OrthoZoomMax);
                Raise();
                return;
            }
            var offset = State.Position - State.Target;
            float distance = Mathf.Clamp(offset.magnitude * factor, StationCameraMath.MinDistance, StationCameraMath.MaxDistance);
            if (offset.sqrMagnitude < 1e-12f) offset = StationCameraMath.PresetDirection(StationCameraPreset.Iso);
            State.Position = State.Target + offset.normalized * distance;
            Raise();
        }

        /// <summary>Source wheel factor: <c>exp(deltaY * 0.001)</c>.</summary>
        public void ZoomByWheel(float deltaY) {
            if (!IsFinite(deltaY)) return;
            ZoomBy(Mathf.Exp(deltaY * .001f));
        }

        /// <summary>Set the perspective lens in degrees, clamped; a non-finite value is refused.</summary>
        public void SetFov(float degrees) {
            if (!StationCameraMath.TryClampFov(degrees, out float clamped)) return;
            if (Mathf.Approximately(State.Fov, clamped)) return;
            State.Fov = clamped;
            Raise();
        }

        public void SetProjection(StationProjection projection) {
            if (State.Projection == projection) return;
            State.Projection = projection;
            Raise();
        }

        public void SetOrthographic(bool on) => SetProjection(on ? StationProjection.Orthographic : StationProjection.Perspective);

        /// <summary>
        /// Camera-relative ground pan, in **metres of the camera's own screen axes**
        /// (<c>x</c> = screen-right, <c>y</c> = the camera's ground-projected forward).
        /// Eye and aim move together, so the orbit offset — the view angle and distance —
        /// is preserved, exactly as the source WASD pan.
        /// </summary>
        public void PanByMetres(Vector2 screenMetres) {
            if (!TranslatePlanar(screenMetres)) return;
            Raise();
        }

        /// <summary>
        /// The ground pan's one translation. Eye and aim move together, so the orbit
        /// offset — the view angle and distance — is preserved. Returns false when the
        /// move is zero or degenerate; the caller owns the change notification, because
        /// <see cref="Tick"/> moves both axes in one frame and raises once.
        /// </summary>
        private bool TranslatePlanar(Vector2 screenMetres) {
            if (!IsFinite(screenMetres.x) || !IsFinite(screenMetres.y)) return false;
            if (screenMetres.sqrMagnitude < 1e-12f) return false;
            var forward = State.Target - State.Position;
            forward.z = 0f;
            if (forward.sqrMagnitude < 1e-6f) {
                // At the plan preset forward has no horizontal component. Use the
                // camera's screen-up axis instead of a world-axis guess (source).
                var snapshot = State.Snapshot();
                forward = new Vector3(snapshot.Up.x, snapshot.Up.y, 0f);
            }
            if (forward.sqrMagnitude < 1e-12f) forward = new Vector3(0f, 1f, 0f);
            forward.Normalize();
            var right = new Vector3(forward.y, -forward.x, 0f);
            var move = forward * screenMetres.y + right * screenMetres.x;
            State.Position += move;
            State.Target += move;
            return true;
        }

        /// <summary>
        /// A canvas drag's pointer travel converted to camera-screen metres: perspective
        /// uses the frustum at the aim distance, flat views the ortho half-height.
        /// </summary>
        public void PanByPixels(float dxPixels, float dyPixels, float viewportHeightPixels, bool dragWorld = true) {
            if (!IsFinite(dxPixels) || !IsFinite(dyPixels) || !IsFinite(viewportHeightPixels) || viewportHeightPixels <= 0f) return;
            float metresPerPixel = State.IsOrthographic
                ? 2f * Mathf.Max(.1f, State.OrthoSize) / viewportHeightPixels
                : 2f * State.Distance * Mathf.Tan(State.Fov * Mathf.Deg2Rad * .5f) / viewportHeightPixels;
            // Dragging the world right (`dx > 0`) moves the camera left; dragging it
            // down (`dy > 0`) moves the camera forward, which is what pushes the
            // content down the screen.
            float side = (dragWorld ? -1f : 1f) * dxPixels * metresPerPixel;
            float forward = (dragWorld ? 1f : -1f) * dyPixels * metresPerPixel;
            PanByMetres(new Vector2(side, forward));
        }

        /// <summary>Hold/release the Ctrl+Q / Ctrl+E vertical pan (and the ViewCube's arrows).</summary>
        public void SetHeldVertical(int direction, bool? fast = null) {
            int next = direction > 0 ? 1 : direction < 0 ? -1 : 0;
            bool changed = HeldVertical != next;
            HeldVertical = next;
            if (fast.HasValue && HeldFast != fast.Value) { HeldFast = fast.Value; changed = true; }
            if (changed) Raise();
        }

        /// <summary>
        /// Hold/release the camera-relative ground pan (WASD). Each axis is a bounded
        /// -1…1 intent, not a key: the keyboard and any other holder send the same
        /// pair, and a release is <c>(0, 0)</c>.
        /// </summary>
        public void SetHeldPlanar(float right, float forward, bool? fast = null) {
            float nextRight = IsFinite(right) ? Mathf.Clamp(right, -1f, 1f) : 0f;
            float nextForward = IsFinite(forward) ? Mathf.Clamp(forward, -1f, 1f) : 0f;
            bool changed = !Mathf.Approximately(HeldRight, nextRight) || !Mathf.Approximately(HeldForward, nextForward);
            HeldRight = nextRight;
            HeldForward = nextForward;
            if (fast.HasValue && HeldFast != fast.Value) { HeldFast = fast.Value; changed = true; }
            if (changed) Raise();
        }

        /// <summary>The source <c>moveSpeed</c>: 4–45 m/s by orbit distance, Shift ×3.</summary>
        public float MoveSpeed(bool fast = false) => StationCameraMath.MoveSpeed(State.Distance, fast);

        /// <summary>
        /// Advance every held pan by the elapsed real seconds: the vertical pair at
        /// <see cref="MoveSpeed"/> and the ground pair at the same rate, camera and aim
        /// moving together so the orbit offset (the view angle) is untouched. The two
        /// axes share one speed and one frame, exactly as the source's
        /// <c>panCamera</c>/<c>panCameraVertical</c> pair.
        /// </summary>
        public void Tick(float deltaSeconds, bool fast = false) {
            if (!IsFinite(deltaSeconds) || deltaSeconds <= 0f) return;
            if (HeldVertical == 0 && HeldRight == 0f && HeldForward == 0f) return;
            float speed = MoveSpeed(fast || HeldFast);
            float seconds = deltaSeconds;
            bool moved = false;
            if (HeldVertical != 0) {
                float step = HeldVertical * speed * seconds;
                State.Position = new Vector3(State.Position.x, State.Position.y, State.Position.z + step);
                State.Target = new Vector3(State.Target.x, State.Target.y, State.Target.z + step);
                moved = true;
            }
            if (HeldRight != 0f || HeldForward != 0f) {
                moved |= TranslatePlanar(new Vector2(HeldRight * speed * seconds, HeldForward * speed * seconds));
            }
            if (moved) Raise();
        }

        /// <summary>Viewport aspect for both projections; the ortho frustum refits from it.</summary>
        public void SetAspect(float aspect) {
            if (!IsFinite(aspect) || aspect <= 0f) return;
            if (Mathf.Approximately(State.Aspect, aspect)) return;
            State.Aspect = aspect;
            Raise();
        }

        /// <summary>
        /// Write the pose to the Unity camera. The document basis maps through
        /// <see cref="StationCameraMath.WorldRotation"/>, so the rendered
        /// <c>right/up/forward</c> are the mapped document basis — never a quaternion
        /// component reinterpretation.
        /// </summary>
        public void ApplyTo(Camera camera) {
            if (!camera) return;
            var snapshot = State.Snapshot();
            camera.orthographic = State.IsOrthographic;
            camera.fieldOfView = State.Fov;
            camera.aspect = State.Aspect;
            camera.orthographicSize = Mathf.Max(.1f, snapshot.OrthoSize);
            camera.nearClipPlane = State.IsOrthographic ? StationCameraMath.OrthographicNear : StationCameraMath.PerspectiveNear;
            camera.farClipPlane = StationCameraMath.Far;
            camera.transform.SetPositionAndRotation(
                StationCameraSpace.ToWorld(State.Position),
                StationCameraMath.WorldRotation(snapshot.Right, snapshot.Up, snapshot.Back));
        }

        /// <summary>
        /// Publish the pose. With a live camera the basis, position and projection are
        /// read back from what was actually rendered; without one the controller's own
        /// numbers are used (the EditMode proof).
        /// </summary>
        public StationCameraSnapshot Snapshot(Camera camera = null) {
            var snapshot = State.Snapshot();
            if (!camera) return snapshot;
            snapshot.Position = StationCameraSpace.ToDocument(camera.transform.position);
            snapshot.Right = StationCameraSpace.ToDocument(camera.transform.right).normalized;
            snapshot.Up = StationCameraSpace.ToDocument(camera.transform.up).normalized;
            snapshot.Back = -StationCameraSpace.ToDocument(camera.transform.forward).normalized;
            snapshot.Projection = camera.orthographic ? StationProjection.Orthographic : StationProjection.Perspective;
            snapshot.Fov = camera.orthographic ? State.Fov : camera.fieldOfView;
            snapshot.OrthoSize = camera.orthographicSize;
            snapshot.Distance = (camera.transform.position - StationCameraSpace.ToWorld(State.Target)).magnitude;
            snapshot.ActiveLevel = State.ActiveLevel;
            return snapshot;
        }

        /// <summary>
        /// The camera's current facing as a document step, for callers that have to say
        /// which side a pick came from (source <c>pickFacing</c>). The sign is
        /// <c>target - position</c> flattened, the direction the camera looks **from**.
        /// </summary>
        public Vector2 PickFacing() {
            var forward = State.Target - State.Position;
            forward.z = 0f;
            if (forward.sqrMagnitude < 1e-8f) return new Vector2(0f, -1f);
            forward.Normalize();
            return new Vector2(forward.x, forward.y);
        }

        private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

        private void Raise() => Changed?.Invoke();
    }
}
