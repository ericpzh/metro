using System;
using System.Globalization;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// 20 §6 — the **draggable** 剖切 surface.
    ///
    /// The drawn sheet could already answer a ray, and the plane could already be written, but
    /// nothing connected them: the pointer router never granted a drag to the section, and the
    /// only slide helper measured two hits **on the same plane**, which cannot express a slide
    /// along the cut's own normal. The source instead grabs the sheet and projects the cut's
    /// normal into screen pixels (`SceneRenderer.sectionDragAxis`), so this is the port of that
    /// gesture:
    ///
    ///   * the axis is projected **once**, at the press, from the station bounds centre and that
    ///     centre plus one metre of the cut's normal — the frozen axis is what stops the cut
    ///     drifting while it moves;
    ///   * the pointer's travel is measured along that axis only, so a drag across the sheet does
    ///     nothing (`section.ts:walkAlong`/`dragOffset`);
    ///   * the step snaps to 0.5 m, or 0.05 m with Shift, with the source's own rounding;
    ///   * one `SectionOffset` view command is written per move through
    ///     <see cref="StationViewRig.SetSectionOffset"/> — no document edit, no revision, no undo
    ///     entry.
    ///
    /// The drag also owns the arrow's hover, using the same control hit as the press, and clears
    /// itself on up/cancel, a hidden surface, a mode swap or a station switch.
    /// </summary>
    public static class StationSectionDrag {
        /// <summary>`SECTION_SNAP` and `SECTION_SNAP_FINE`, metres.</summary>
        public const float Snap = .5f, SnapFine = .05f;
        /// <summary>Below this the projected axis has no length to drag along, in pixels.</summary>
        public const float MinSpanPixels = .5f;

        /// <summary>One gesture in flight, with everything the axis was measured from.</summary>
        public sealed class Drag {
            public bool Active;
            public int PointerId = -1;
            /// <summary>The press, in the pointer events' own pixel space.</summary>
            public Vector2 Origin;
            /// <summary>The cut's slide direction on screen, unit length.</summary>
            public Vector2 Axis = Vector2.right;
            /// <summary>How many pixels one metre of the slide covers.</summary>
            public float Span;
            /// <summary>The offset the grab started from.</summary>
            public float StartOffset;
            /// <summary>Which control was grabbed (`arrow-shaft`, `arrow-head`, `sheet`).</summary>
            public string Part = "";
            /// <summary>The frozen document normal, for the readout.</summary>
            public Vector3 Normal;
            public int Moves;
            public override string ToString() =>
                Part + " id=" + PointerId + " span=" + Span.ToString("0.###", CultureInfo.InvariantCulture) +
                " start=" + StartOffset.ToString("0.###", CultureInfo.InvariantCulture) +
                " moves=" + Moves;
        }

        static Drag drag;
        static bool hovered;

        /// <summary>The gesture in flight, or null.</summary>
        public static Drag Current => drag != null && drag.Active ? drag : null;

        /// <summary>True while the pointer is over a section control (the arrow, or the sheet).</summary>
        public static bool Hovered => hovered;

        /// <summary>The last gesture, kept for a verifier after it ended (`null` before any).</summary>
        public static Drag Last { get; private set; }

        /// <summary>
        /// `SceneRenderer.sectionDragAxis`: the cut's slide direction as it appears on screen, in
        /// the pointer events' pixel space, and how many pixels one metre of it covers. A cut that
        /// slides straight at the camera has no such line, and the caller refuses the grab.
        /// </summary>
        public static bool TryAxis(Camera camera, StationSectionView section, out Vector2 axis, out float span) {
            axis = Vector2.zero;
            span = 0f;
            if (camera == null || section == null) return false;
            var plane = section.Plane;
            var bounds = section.Bounds;
            var centre = bounds.size.sqrMagnitude > 1e-6f ? bounds.center : plane.Anchor;
            var normal = plane.Normal;
            var a = camera.WorldToScreenPoint(StationCameraSpace.ToWorld(centre));
            var b = camera.WorldToScreenPoint(StationCameraSpace.ToWorld(centre + normal));
            if (a.z <= 0f || b.z <= 0f) return false;
            var delta = new Vector2(b.x - a.x, b.y - a.y);
            span = delta.magnitude;
            if (!(span > MinSpanPixels) || float.IsNaN(span) || float.IsInfinity(span)) {
                span = 0f;
                return false;
            }
            axis = delta / span;
            return true;
        }

        /// <summary>
        /// Begin a drag from a press on a section control. False with the reason when the control
        /// was not hit, the axis is degenerate, or another pointer already owns the gesture.
        /// </summary>
        public static bool TryBegin(Camera camera, StationSectionView section, StationViewRig rig,
            StationPointerEvent pointer, Ray ray, out string reason) {
            reason = null;
            if (section == null || rig == null) { reason = "no-section"; return false; }
            if (drag != null && drag.Active) { reason = "section-drag-active"; return false; }
            if (!section.TrySectionControl(ray, out var part, out _, out _)) { reason = "section-no-control"; return false; }
            if (!TryAxis(camera, section, out var axis, out float span)) {
                // The source gives up on the grab rather than dividing by nothing.
                reason = "section-axis-degenerate";
                return false;
            }
            drag = new Drag {
                Active = true,
                PointerId = pointer.PointerId,
                Origin = pointer.ToScreen(),
                Axis = axis,
                Span = span,
                StartOffset = rig.SectionOffset,
                Part = part,
                Normal = section.Plane.Normal,
            };
            Hover(true);
            return true;
        }

        /// <summary>
        /// The offset a move asks for: `startOffset + dot(now − start, axis) / span`, snapped.
        /// Returns false when the pointer does not own the gesture.
        /// </summary>
        public static bool TryMove(StationPointerEvent pointer, bool fine, out float offset) {
            offset = 0f;
            if (drag == null || !drag.Active) return false;
            if (drag.PointerId >= 0 && pointer.PointerId >= 0 && drag.PointerId != pointer.PointerId) return false;
            var now = pointer.ToScreen();
            float walked = Vector2.Dot(now - drag.Origin, drag.Axis);
            offset = SnapOffset(DragOffset(drag.StartOffset, walked, drag.Span), fine);
            drag.Moves++;
            return true;
        }

        /// <summary>`snapOffset`: 0.5 m steps, 5 cm while Shift is held, with `Math.round`'s ties.</summary>
        public static float SnapOffset(float value, bool fine) {
            float step = fine ? SnapFine : Snap;
            return TsRound(value / step) * step;
        }

        /// <summary>
        /// `section.ts:dragOffset`: what a drag asks for, from the pointer's travel **along the
        /// frozen axis**. A step across the axis contributes nothing, which is the rule the mode
        /// exists for; a degenerate span leaves the cut where it was.
        /// </summary>
        public static float DragOffset(float startOffset, float walked, float span) =>
            !(span > 0f) ? startOffset : startOffset + walked / span;

        /// <summary>
        /// JavaScript's `Math.round`: halves go **up**, where `Mathf.Round`'s banker's rounding
        /// would answer differently for a negative half — the one case a fine drag lands on
        /// (`section-drag.test.mjs` pins the negative fine and coarse snaps).
        /// </summary>
        public static float TsRound(float value) => Mathf.Floor(value + .5f);

        /// <summary>End the gesture; the committed offset stays (an up is not an undo).</summary>
        public static void End() {
            if (drag == null) return;
            drag.Active = false;
            Last = drag;
            drag = null;
            Hover(false);
        }

        /// <summary>Abandon the gesture and put the cut back where the grab found it.</summary>
        public static void Cancel(StationViewRig rig) {
            if (drag == null) return;
            var restore = drag.StartOffset;
            drag.Active = false;
            Last = drag;
            drag = null;
            Hover(false);
            if (rig != null) rig.SetSectionOffset(restore);
        }

        /// <summary>Hover is the same control hit as the press, so the two can never disagree.</summary>
        public static bool UpdateHover(StationSectionView section, Ray ray) {
            bool over = section != null && section.TrySectionControl(ray, out _, out _, out _);
            Hover(over);
            return over;
        }

        static void Hover(bool on) {
            if (hovered == on) return;
            hovered = on;
            var rig = StationViewFeature.Active;
            if (rig != null) rig.SetSectionHover(on);
        }

        /// <summary>Forget the gesture and the hover (a station switch, a mode swap, a test).</summary>
        public static void Reset() {
            drag = null;
            hovered = false;
            Last = null;
        }

        /// <summary>
        /// Route one pointer event to the section's controls. Returns true when the section
        /// **consumed** the event, in which case no tool or camera gesture may also see it.
        /// </summary>
        public static bool Handle(StationGameHost host, StationViewRig rig, string type, StationPointerEvent pointer,
            Ray ray, bool fine, JObject reply, out string code, out string reason) {
            code = null;
            reason = null;
            var section = rig != null ? rig.sectionView : null;
            if (section == null) return false;
            switch (type) {
                case "pointer.down": {
                    if (!section.TrySectionControl(ray, out var part, out _, out _)) {
                        Hover(false);
                        return false;
                    }
                    // A press on the controls is a grab, not a second press on a tool drag.
                    if (!TryBegin(StationEditScene.EditCamera(host), section, rig, pointer, ray, out reason)) {
                        // The axis is degenerate (looking straight down the cut): the press is
                        // still the section's — it must not fall through to a tool.
                        reply["section"] = Snapshot(part);
                        if (reason == "section-axis-degenerate") return true;
                        return false;
                    }
                    reply["section"] = Snapshot(drag.Part);
                    return true;
                }
                case "pointer.move": {
                    if (drag == null || !drag.Active) {
                        // Hover uses the same hit as the press, and a control under the pointer
                        // keeps the tools' hover preview away.
                        return UpdateHover(section, ray);
                    }
                    if (!TryMove(pointer, fine, out float offset)) return true;
                    rig.SetSectionOffset(offset);
                    reply["section"] = Snapshot(drag.Part);
                    return true;
                }
                case "pointer.up": {
                    if (drag == null || !drag.Active) return false;
                    if (TryMove(pointer, fine, out float offset)) rig.SetSectionOffset(offset);
                    var ended = drag.Part;
                    End();
                    reply["section"] = Snapshot(ended);
                    return true;
                }
                case "pointer.cancel":
                case "pointer.leave": {
                    if (drag == null || !drag.Active) { Hover(false); return false; }
                    var abandoned = drag.Part;
                    Cancel(rig);
                    reply["section"] = Snapshot(abandoned);
                    return true;
                }
                default:
                    return false;
            }
        }

        /// <summary>The section's readout for `state.view.sectionHandle` and the reply.</summary>
        public static JObject Snapshot(string part) {
            var drag = Current ?? Last;
            var json = new JObject {
                ["active"] = Current != null,
                // The caller may not know which control it just drove (the state snapshot never
                // does), so an idle read reports the last gesture's own part.
                ["part"] = part ?? (drag != null ? drag.Part : ""),
                ["hovered"] = hovered,
            };
            if (drag != null) {
                json["axis"] = new JArray(drag.Axis.x, drag.Axis.y);
                json["span"] = drag.Span;
                json["startOffset"] = drag.StartOffset;
                json["origin"] = new JArray(drag.Origin.x, drag.Origin.y);
                json["pointerId"] = drag.PointerId;
                json["moves"] = drag.Moves;
                json["normal"] = new JArray(drag.Normal.x, drag.Normal.y, drag.Normal.z);
            }
            return json;
        }
    }
}
