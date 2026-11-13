using System;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Metro.View {
    /// <summary>Which projection the station camera draws through.</summary>
    public enum StationProjection {
        Perspective = 0,
        Orthographic = 1,
    }

    /// <summary>The four flat/overhead presets the source camera offers, plus a free view.</summary>
    public enum StationCameraPreset {
        Custom = 0,
        Iso = 1,
        Plan = 2,
        Front = 3,
        Side = 4,
    }

    /// <summary>
    /// The one camera pose the bridge publishes, in **document** axes (save axes:
    /// <c>x</c> plan x, <c>y</c> plan y, <c>z</c> elevation). <see cref="Right"/>,
    /// <see cref="Up"/> and <see cref="Back"/> are the camera's actual rendered basis
    /// mapped back to document axes, with <c>Back = -forward</c>; the ViewCube dots its
    /// face normals against them directly, so the Unity world's <c>(x, elevation, y)</c>
    /// handedness is never mistaken for a quaternion component swap.
    /// </summary>
    [Serializable]
    public struct StationCameraSnapshot {
        public Vector3 Position;
        public Vector3 Target;
        public Vector3 Right;
        public Vector3 Up;
        public Vector3 Back;
        public StationProjection Projection;
        public float Fov;
        public float OrthoSize;
        public float Distance;
        public int ActiveLevel;

        public bool IsOrthographic => Projection == StationProjection.Orthographic;

        public void AppendJson(StringBuilder builder) {
            if (builder == null) throw new ArgumentNullException(nameof(builder));
            builder.Append("{\"position\":");
            StationCameraJson.AppendVector(builder, Position);
            builder.Append(",\"target\":");
            StationCameraJson.AppendVector(builder, Target);
            builder.Append(",\"right\":");
            StationCameraJson.AppendVector(builder, Right);
            builder.Append(",\"up\":");
            StationCameraJson.AppendVector(builder, Up);
            builder.Append(",\"back\":");
            StationCameraJson.AppendVector(builder, Back);
            builder.Append(",\"fov\":");
            StationCameraJson.AppendNumber(builder, Fov);
            builder.Append(",\"ortho\":");
            StationCameraJson.AppendBool(builder, IsOrthographic);
            builder.Append(",\"level\":");
            builder.Append(ActiveLevel);
            // Extras the ViewCube does not need; kept for the verifier and diagnostics.
            builder.Append(",\"orthoSize\":");
            StationCameraJson.AppendNumber(builder, OrthoSize);
            builder.Append(",\"distance\":");
            StationCameraJson.AppendNumber(builder, Distance);
            builder.Append('}');
        }

        public string ToJson() {
            var builder = new StringBuilder(320);
            AppendJson(builder);
            return builder.ToString();
        }
    }

    /// <summary>
    /// The mutable camera record: the target and eye in document metres, the loaded
    /// station's document bounds, the lens and the projection. It mirrors the source
    /// <c>CameraSystem</c> fields; <see cref="StationCameraController"/> is the only writer.
    /// </summary>
    [Serializable]
    public sealed class StationCameraState {
        /// <summary>Eye in document metres.</summary>
        public Vector3 Position;
        /// <summary>Aim point in document metres.</summary>
        public Vector3 Target;
        public StationProjection Projection;
        /// <summary>Vertical field of view of the perspective camera, degrees (source <c>camera.fov</c>).</summary>
        public float Fov = StationCameraMath.DefaultFov;
        /// <summary>Source <c>orthoZoom</c>: the wheel's zoom inside the flat frustum.</summary>
        public float OrthoZoom = 1f;
        /// <summary>Viewport aspect the projection is built for.</summary>
        public float Aspect = 16f / 9f;
        /// <summary>The storey being edited, in station metres.</summary>
        public int ActiveLevel;
        /// <summary>The live station's document-space bounds.</summary>
        public Bounds Bounds;

        public Vector3 Offset => Position - Target;
        public float Distance => Offset.magnitude;
        public bool IsOrthographic => Projection == StationProjection.Orthographic;

        /// <summary>The orthographic half-height: the source <c>applyOrtho</c> base.</summary>
        public float OrthoSize => StationCameraMath.OrthoSize(Bounds, OrthoZoom);

        public StationCameraSnapshot Snapshot() {
            var snapshot = new StationCameraSnapshot {
                Position = Position,
                Target = Target,
                Projection = Projection,
                Fov = Fov,
                OrthoSize = OrthoSize,
                Distance = Distance,
                ActiveLevel = ActiveLevel,
            };
            StationCameraMath.LookAt(Position - Target, out snapshot.Right, out snapshot.Up);
            snapshot.Back = Position - Target;
            if (snapshot.Back.sqrMagnitude > 1e-12f) snapshot.Back.Normalize();
            return snapshot;
        }
    }

    /// <summary>
    /// The one document↔Unity conversion the camera uses. Packet A's
    /// <c>Metro.View.StationCoordinates</c> is the intended owner; until it lands this
    /// repeats the verified plan-10 convention (<see cref="ModulePlacement"/>):
    /// world = <c>(x, elevation, y)</c>. When A lands, replace the two methods here and
    /// nothing else changes.
    /// </summary>
    public static class StationCameraSpace {
        /// <summary>Document point or direction → Unity world.</summary>
        public static Vector3 ToWorld(Vector3 document) => new Vector3(document.x, document.z, document.y);

        /// <summary>Unity world point or direction → document axes (the same swap).</summary>
        public static Vector3 ToDocument(Vector3 world) => new Vector3(world.x, world.z, world.y);

        /// <summary>Convert a Unity world-space station bounds into document-space bounds.</summary>
        public static Bounds ToDocument(Bounds world) => new Bounds(ToDocument(world.center), ToDocument(world.size));

        /// <summary>Convert document-space bounds into a Unity world-space bounds.</summary>
        public static Bounds ToWorld(Bounds document) => new Bounds(ToWorld(document.center), ToWorld(document.size));
    }

    /// <summary>
    /// The source camera constants and the portable math, kept free of a live
    /// <c>Camera</c> so the EditMode proof can pin the numbers without a renderer.
    /// Everything here is document-space; the Unity mirror is built only by
    /// <see cref="StationCameraController.ApplyTo"/>.
    /// </summary>
    public static class StationCameraMath {
        /// <summary>The perspective lens the camera opens with (source <c>DEFAULT_FOV</c>).</summary>
        public const float DefaultFov = 45f;
        /// <summary>The long end of the ViewCube slider (source <c>FOV_MIN_DEG</c>).</summary>
        public const float MinFov = 30f;
        /// <summary>The wide end of the ViewCube slider (source <c>FOV_MAX_DEG</c>).</summary>
        public const float MaxFov = 120f;

        /// <summary>Source <c>controls.minDistance</c>.</summary>
        public const float MinDistance = 4f;
        /// <summary>Source <c>controls.maxDistance</c>.</summary>
        public const float MaxDistance = 400f;
        /// <summary>Source orbit drag: radians of swing per pointer pixel.</summary>
        public const float OrbitRadiansPerPixel = 0.008f;
        /// <summary>Source <c>POLAR_EPS</c>: a hair short of the poles, where the azimuth dies.</summary>
        public const float PolarEpsilon = 0.02f;
        /// <summary>Source <c>Math.max(40, bounds.size.length() * 0.9)</c>.</summary>
        public const float MinFramingDistance = 40f;
        /// <summary>The share of the bounds' diagonal the presets stand back by.</summary>
        public const float FramingDistanceShare = 0.9f;
        /// <summary>Source ortho wheel limits.</summary>
        public const float OrthoZoomMin = 0.06f;
        public const float OrthoZoomMax = 16f;
        /// <summary>The share of the bounds' diagonal the ortho frustum's half-height is.</summary>
        public const float OrthoBaseShare = 0.7f;
        public const float PerspectiveNear = 0.5f;
        public const float OrthographicNear = 0.1f;
        public const float Far = 2000f;

        /// <summary>Document up: elevation is the save's <c>z</c> axis.</summary>
        public static readonly Vector3 DocumentUp = new Vector3(0f, 0f, 1f);

        /// <summary>The distance every preset and face snap stands back by.</summary>
        public static float FramingDistance(Bounds documentBounds) =>
            Mathf.Max(MinFramingDistance, documentBounds.size.magnitude * FramingDistanceShare);

        /// <summary>The orthographic half-height for a zoom (source <c>applyOrtho</c>).</summary>
        public static float OrthoSize(Bounds documentBounds, float orthoZoom) =>
            documentBounds.size.magnitude * OrthoBaseShare * Mathf.Clamp(orthoZoom, OrthoZoomMin, OrthoZoomMax);

        /// <summary>The source <c>setPreset</c> direction, from the aim toward the eye.</summary>
        public static Vector3 PresetDirection(StationCameraPreset preset) {
            switch (preset) {
                case StationCameraPreset.Iso: return new Vector3(1f, -1.2f, .85f).normalized;
                case StationCameraPreset.Plan: return new Vector3(0f, .001f, 1f).normalized;
                case StationCameraPreset.Front: return new Vector3(0f, -1f, 0f);
                case StationCameraPreset.Side: return new Vector3(1f, 0f, 0f);
                default: return Vector3.zero;
            }
        }

        /// <summary>The projections the source presets choose (iso is perspective).</summary>
        public static StationProjection PresetProjection(StationCameraPreset preset) {
            switch (preset) {
                case StationCameraPreset.Plan:
                case StationCameraPreset.Front:
                case StationCameraPreset.Side:
                    return StationProjection.Orthographic;
                default:
                    return StationProjection.Perspective;
            }
        }

        /// <summary>
        /// The camera basis for a given <c>back</c> vector, ported from three.js
        /// <c>Matrix4.lookAt</c> with the station's <c>up = +z</c> — including the
        /// near-pole nudge, so a top/bottom view has the same stable roll the source
        /// camera draws and the cube's dot products agree.
        /// </summary>
        public static void LookAt(Vector3 back, out Vector3 right, out Vector3 up) {
            var z = back;
            if (z.sqrMagnitude < 1e-12f) z = DocumentUp;
            z.Normalize();
            var x = Vector3.Cross(DocumentUp, z);
            if (x.sqrMagnitude < 1e-12f) {
                // Source: `if (Math.abs(up.z) === 1) z.x += 0.0001` — document up is +z.
                z = new Vector3(z.x + .0001f, z.y, z.z);
                x = Vector3.Cross(DocumentUp, z);
            }
            x.Normalize();
            var y = Vector3.Cross(z, x);
            y.Normalize();
            right = x;
            up = y;
        }

        /// <summary>
        /// Rotate a document vector about an axis by <paramref name="radians"/> using the
        /// right-hand rule (three's <c>applyAxisAngle</c>). Unity's
        /// <c>Quaternion.AngleAxis</c> follows the left-handed scene convention and would
        /// mirror the orbit, so the port states the rule itself.
        /// </summary>
        public static Vector3 RotateAbout(Vector3 vector, Vector3 axis, float radians) {
            float cos = Mathf.Cos(radians);
            float sin = Mathf.Sin(radians);
            return vector * cos + Vector3.Cross(axis, vector) * sin + axis * Vector3.Dot(axis, vector) * (1f - cos);
        }

        /// <summary>Clamp a perspective lens to the slider's own range; refuse non-finite input.</summary>
        public static bool TryClampFov(float degrees, out float clamped) {
            clamped = degrees;
            if (float.IsNaN(degrees) || float.IsInfinity(degrees)) return false;
            clamped = Mathf.Clamp(degrees, MinFov, MaxFov);
            return true;
        }

        /// <summary>The azimuth/polar pair an offset implies (source <c>orbitBy</c> tail).</summary>
        public static void AnglesOf(Vector3 offset, out float theta, out float phi) {
            float length = offset.magnitude;
            if (length < 1e-6f) {
                theta = 0f;
                phi = Mathf.PI * .5f;
                return;
            }
            theta = Mathf.Atan2(offset.y, offset.x);
            phi = Mathf.Acos(Mathf.Clamp(offset.z / length, -1f, 1f));
        }

        /// <summary>Place an offset at a clamped polar angle, preserving its length.</summary>
        public static Vector3 OffsetAt(float theta, float phi, float length) {
            float polar = Mathf.Clamp(phi, PolarEpsilon, Mathf.PI - PolarEpsilon);
            return new Vector3(
                length * Mathf.Sin(polar) * Mathf.Cos(theta),
                length * Mathf.Sin(polar) * Mathf.Sin(theta),
                length * Mathf.Cos(polar));
        }

        /// <summary>Source <c>moveSpeed</c>: metres per second, scaled by the orbit distance.</summary>
        public static float MoveSpeed(float distance, bool fast) =>
            Mathf.Max(4f, Mathf.Min(45f, distance * .4f)) * (fast ? 3f : 1f);

        /// <summary>
        /// The Unity camera rotation for a document basis. The world mapping is a
        /// reflection, so the Unity forward is <c>-ToWorld(back)</c>; the resulting
        /// columns are exactly <c>ToWorld(right)</c>, <c>ToWorld(up)</c> and that
        /// forward, which is what keeps the published basis the rendered one.
        /// </summary>
        public static Quaternion WorldRotation(Vector3 right, Vector3 up, Vector3 back) {
            var forward = -StationCameraSpace.ToWorld(back);
            if (forward.sqrMagnitude < 1e-12f) return Quaternion.identity;
            forward.Normalize();
            var worldUp = StationCameraSpace.ToWorld(up);
            if (worldUp.sqrMagnitude < 1e-12f) worldUp = Vector3.up;
            return Quaternion.LookRotation(forward, worldUp);
        }
    }

    /// <summary>Small invariant-culture JSON helpers shared by the camera and view snapshots.</summary>
    public static class StationCameraJson {
        public static void AppendVector(StringBuilder builder, Vector3 value) {
            builder.Append('[');
            AppendNumber(builder, value.x);
            builder.Append(',');
            AppendNumber(builder, value.y);
            builder.Append(',');
            AppendNumber(builder, value.z);
            builder.Append(']');
        }

        public static void AppendNumber(StringBuilder builder, float value) {
            if (float.IsNaN(value) || float.IsInfinity(value)) {
                builder.Append('0');
                return;
            }
            builder.Append(value.ToString("0.######", CultureInfo.InvariantCulture));
        }

        public static void AppendBool(StringBuilder builder, bool value) => builder.Append(value ? "true" : "false");

        public static string Quote(string value) {
            if (string.IsNullOrEmpty(value)) return "\"\"";
            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');
            foreach (char c in value) {
                switch (c) {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < 32) builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else builder.Append(c);
                        break;
                }
            }
            builder.Append('"');
            return builder.ToString();
        }
    }
}
