using System;
using System.Collections.Generic;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// One decoded pointer event from the shell (`game/src/unity-web/pointerInput.ts`).
    /// The coordinates are the canvas-relative CSS pixels the player actually aimed with;
    /// the router normalizes them against the canvas size it was told, so WebGL's drawing
    /// buffer scale and the desktop presenter's DPI never change what was picked.
    /// </summary>
    public readonly struct StationPointerEvent {
        public readonly float X, Y, Width, Height;
        public readonly int PointerId;
        public readonly int Button;
        public readonly int Buttons;
        public readonly int Modifiers;
        public readonly int ToolGeneration;
        public readonly int DocumentRevision;
        /// <summary>The client's `performance.now()` at the event, in ms; −1 when absent.</summary>
        public readonly double TimeMs;

        StationPointerEvent(JObject payload) {
            Width = (float)Number(payload, "w", 0);
            Height = (float)Number(payload, "h", 0);
            X = (float)Number(payload, "x", 0);
            Y = (float)Number(payload, "y", 0);
            PointerId = (int)Number(payload, "pointerId", -1);
            Button = (int)Number(payload, "button", 0);
            Buttons = (int)Number(payload, "buttons", 0);
            Modifiers = (int)Number(payload, "modifiers", 0);
            ToolGeneration = (int)Number(payload, "toolGeneration", -1);
            DocumentRevision = (int)Number(payload, "documentRevision", -1);
            TimeMs = Number(payload, "time", -1);
        }

        /// <summary>A synthetic event for a test or a re-aimed cached pointer.</summary>
        public static StationPointerEvent Synthetic(float x, float y, float width, float height,
            int button = 0, int modifiers = 0, double timeMs = -1, int pointerId = -1, int buttons = -1) {
            int mask = buttons >= 0 ? buttons : button == 0 ? 1 : button == 1 ? 4 : button == 2 ? 2 : 0;
            return new StationPointerEvent(x, y, width <= 0 ? 1f : width, height <= 0 ? 1f : height,
                button, modifiers, timeMs, pointerId, -1, -1, mask);
        }

        StationPointerEvent(float x, float y, float width, float height, int button, int modifiers,
            double timeMs, int pointerId, int toolGeneration, int documentRevision, int buttons) {
            X = x; Y = y; Width = width; Height = height; Button = button; Modifiers = modifiers;
            TimeMs = timeMs; PointerId = pointerId; ToolGeneration = toolGeneration;
            DocumentRevision = documentRevision; Buttons = buttons;
        }

        public static int LastClientDocumentRevision { get; private set; } = -1;

        public static bool TryDecode(JObject payload, out StationPointerEvent pointer, out string code) {
            pointer = default;
            code = null;
            if (payload == null) { code = "bad-payload"; return false; }
            var pointerEvent = new StationPointerEvent(payload);
            if (!(pointerEvent.Width > 0) || !(pointerEvent.Height > 0)) { code = "bad-payload"; return false; }
            if (pointerEvent.DocumentRevision >= 0) LastClientDocumentRevision = pointerEvent.DocumentRevision;
            pointer = pointerEvent;
            return true;
        }

        static double Number(JObject payload, string key, double fallback) {
            var token = payload[key];
            if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) return fallback;
            return (double)token;
        }

        /// <summary>The event in Unity screen pixels (origin bottom-left).</summary>
        public Vector2 ToScreen() {
            float width = Mathf.Max(1f, Screen.width);
            float height = Mathf.Max(1f, Screen.height);
            return new Vector2(
                Mathf.Clamp(X / Width, 0f, 1f) * width,
                (1f - Mathf.Clamp(Y / Height, 0f, 1f)) * height);
        }
    }

    /// <summary>Shared view-context and scene-pick entry point for pointer and probe handlers.</summary>
    public static class StationEditScene {
        /// <summary>The rendered camera the pointer ray must come from.</summary>
        public static Camera EditCamera(StationGameHost host) {
            var rig = host != null ? host.GetComponent<StationViewRig>() : null;
            if (rig != null && rig.viewCamera != null) return rig.viewCamera;
            if (host != null && host.stationCamera != null) return host.stationCamera;
            return Camera.main;
        }

        /// <summary>
        /// Read the rig's applied camera, active level and visibility registry together so
        /// scene picking and placement resolution always agree with what is drawn on screen.
        /// </summary>
        public static void ResolveView(StationGameHost host, out StationViewRig rig, out Camera camera,
            out int activeLevel, out StationVisibilityRegistry visibility) {
            rig = host != null ? host.GetComponent<StationViewRig>() : null;
            camera = EditCamera(host);
            visibility = rig != null && rig.Visibility != null
                ? rig.Visibility
                : StationViewFeature.Active?.Visibility;
            activeLevel = rig != null && rig.Configured && rig.Visibility != null
                ? rig.Visibility.State.ActiveLevel
                : (host != null ? host.ActiveLevel : 0);
            if (host != null && host.ActiveLevel != activeLevel) host.SetActiveLevel(activeLevel);
        }

        public static StationSceneHit Pick(StationGameHost host, StationPointerEvent pointer, out string code) {
            code = null;
            var world = host != null ? host.Coordinator?.World : null;
            ResolveView(host, out _, out var camera, out var activeLevel, out var visibility);
            if (world == null || camera == null) { code = "no-session"; return null; }
            var ray = camera.ScreenPointToRay(pointer.ToScreen());
            return PickRay(host, world, camera, ray, activeLevel, visibility, true, out _, out code);
        }

        public static StationSceneHit PickRay(StationGameHost host, StationWorldView world, Camera camera, Ray ray,
            int activeLevel, StationVisibilityRegistry visibility, bool evaluateWorkPlane,
            out StationPickContext context, out string code) {
            code = null;
            context = default;
            if (world == null || camera == null) { code = "no-session"; return null; }
            StationEditSession.Level = activeLevel;
            var excludeId = StationEditSession.HasCarried ? StationEditSession.CarriedId : null;
            context = StationPickContext.FromCamera(camera, ray, visibility, excludeId, evaluateWorkPlane);
            return StationScenePicker.PickRay(world, ray, activeLevel, context);
        }
    }

    /// <summary>
    /// The canvas pointer router (plan 16 §1.2, plan 25 §3). It is the only owner of "what the
    /// pointer did": one ray per event shared with section-control arbitration, zero scene picks
    /// when a section handle consumes the event, and one scene pick per tool event handed
    /// unchanged to selection, candidate resolution, ghost preview and commit.
    /// </summary>
    public static class StationPointerRouter {
        /// <summary>The normalized modifier bit for Shift (`pointerInput.ts` passes `e.shiftKey`).</summary>
        const int ShiftBit = StationPointerModifiers.Shift;

        /// <summary>The pointer press that armed the in-flight gesture (plan 29 §2).</summary>
        static int activePointerId = -1;
        static int activePointerButton = -1;

        /// <summary>True while any tool owns a press in flight, a carried piece included.</summary>
        public static bool AnyEditGestureActive() =>
            StationCellTool.HasGesture || StationPaintTool.HasGesture || StationZoneTool.HasGesture ||
            StationSurfaceTool.HasGesture || StationRoofTool.HasGesture || StationRoadTool.HasGesture ||
            StationEditSession.HasCarried;

        /// <summary>
        /// Both build buttons held at once (`pointerInput.ts`'s chord). The browser cannot
        /// report the second press reliably, so the event's own `buttons` mask is the
        /// backstop: a chord cancels the press instead of aiming or finishing it.
        /// </summary>
        static bool HasBuildChord(in StationPointerEvent pointer) => (pointer.Buttons & 3) == 3;

        /// <summary>
        /// True when this move or release belongs to the press that armed the active gesture.
        /// A **move names no changed button** — the shell sends the unchanged-button sentinel
        /// (`pointerInput.ts`'s `MOVE_BUTTON`, −1) — so a move is owned when its pointer matches
        /// and its `buttons` mask still holds the recorded owner's bit. A **release** names the
        /// button that changed, and it must be the owner's own: the release of the other one is
        /// exactly what cancels the press (plan 29 §2, plan 30 §1).
        /// </summary>
        static bool OwnsPress(string type, in StationPointerEvent pointer) {
            if (!AnyEditGestureActive()) return true;
            if (activePointerId >= 0 && pointer.PointerId >= 0 && pointer.PointerId != activePointerId) return false;
            if (activePointerButton < 0) return true;
            if (string.Equals(type, "pointer.up", StringComparison.Ordinal)) return pointer.Button == activePointerButton;
            int ownerBit = activePointerButton == 0 ? 1 : activePointerButton == 2 ? 2 : 4;
            // The mask is authoritative even when the event cannot name a button: a move whose
            // mask lost the owning bit is a release nobody made, and must not aim the gesture.
            return (pointer.Buttons & ownerBit) != 0;
        }

        /// <summary>
        /// The button that armed the in-flight cell gesture, or the event's own when none is
        /// armed. A move carries the sentinel instead of a button, so the work-plane policy of
        /// a drag must read the press's button — otherwise a right erase would be handed the
        /// add plane by the corrected move encoding (plan 30 §1).
        /// </summary>
        static int ActiveGestureButton(in StationPointerEvent pointer) =>
            StationCellTool.HasGesture ? StationCellTool.Gesture.Button : pointer.Button;

        static void RememberPress(in StationPointerEvent pointer) {
            activePointerId = pointer.PointerId;
            activePointerButton = pointer.Button;
        }

        static void ForgetPress() {
            activePointerId = -1;
            activePointerButton = -1;
        }

        /// <summary>
        /// One cancellation for every edit owner (plan 29 §2): the cell/paint/zone/rail/tunnel/
        /// surface/roof/road tools, the carried piece, the section slide, both ghost layers,
        /// the plan and the footprint badge. It resolves zero scene picks and applies zero
        /// revisions, so a chord or Escape can never become an edit.
        /// </summary>
        public static bool CancelActiveGesture(StationGameHost host, StationEditHost editHost) {
            bool cancelled = AnyEditGestureActive();
            StationSectionDrag.Reset();
            StationCellTool.Cancel();
            StationPaintTool.Cancel();
            StationZoneTool.Cancel();
            StationRailTool.Cancel();
            StationTunnelTool.Cancel();
            StationSurfaceTool.Cancel();
            StationRoofTool.Cancel();
            StationPillarTool.Cancel();
            StationRoadTool.Cancel();
            if (host != null) CancelMove(host, editHost ?? StationEditHost.Ensure());
            ClearPlan(host, editHost);
            editHost?.Preview?.ClearCells();
            editHost?.Preview?.ClearGhost();
            // The badge is the cell plan's footprint: no plan, no badge.
            StationEditSession.Cells = null;
            StationEditSession.Plan = null;
            StationEditSession.Ghost = null;
            ForgetPress();
            return cancelled;
        }

        /// <summary>The pointer events the section's controls may claim before any editor tool.</summary>
        static bool ShouldRouteSection(string type) =>
            type == "pointer.down" || type == "pointer.move" || type == "pointer.up";

        /// <summary>
        /// The tools whose canvas gesture is resolved by <see cref="StationCellTool"/>. The
        /// shared UI speaks `block` / `wall` / `delete`; the old `floor` name is normalized to
        /// `block` at the tool boundary, so every one reaches this answer.
        /// </summary>
        public static bool IsCellTool(string tool) =>
            string.Equals(tool, "block", StringComparison.Ordinal) ||
            string.Equals(tool, "wall", StringComparison.Ordinal) ||
            string.Equals(tool, "delete", StringComparison.Ordinal);

        /// <summary>True while the committed tool draws its plan from cell geometry.</summary>
        public static bool CellToolActive => IsCellTool(StationToolSelection.Active);

        /// <summary>
        /// True while the armed 设备 palette is the 桥梁 tile (its own length and railing, and the
        /// same extension aim as the 隧道 tool — plan 28 §3c).
        /// </summary>
        static bool IsBridgeArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) &&
            string.Equals(StationToolSelection.Setting("moduleType"), "bridge", StringComparison.Ordinal);

        /// <summary>
        /// True while the armed 设备 palette is the 道路 stroke (`RoadTool`'s `moduleType === 'road'`).
        /// </summary>
        static bool RoadArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) &&
            string.Equals(StationToolSelection.Setting("moduleType"), "road", StringComparison.Ordinal);

        /// <summary>
        /// True while the armed 设备 palette is a **run** family (a dragged line of panels,
        /// plan 27 §5). It rides the same gesture owner and preview as the cell tools.
        /// </summary>
        static bool ModuleRunArmed() =>
            string.Equals(StationToolSelection.Active, "module", StringComparison.Ordinal) &&
            StationModuleRuns.IsLinePalette(StationToolSelection.Setting("moduleType"));

        /// <summary>
        /// True when a pointer event needs the active storey's horizontal work plane evaluated
        /// as a fallback (plan 29 §1). The reference's `CameraSystem.pick` always intersects the
        /// plane at `activeZ + 1` after a geometry miss, and `BlockTool` anchors an add on that
        /// non-solid cell; an erase or delete reads `hit.cell` only and must never synthesize a
        /// removal from empty air. So the plane is asked for by an **add** (a carried piece, any
        /// 设备 placement, the block brush's primary press/drag/release and the 墙 tool's add)
        /// and by a still hover of those tools, never by the secondary build button.
        /// </summary>
        public static bool NeedsWorkPlane(string tool, int button = 0) {
            if (StationEditSession.HasCarried) return true;
            if (string.Equals(tool, "module", StringComparison.Ordinal)) return true;
            // A gesture in flight answers for itself: its recorded owner and operation decide,
            // so a release aims exactly the plane its press and drags aimed.
            if (StationCellTool.HasGesture) return !StationCellTool.Gesture.Remove;
            if (button == 2) return false;
            return StationCellTool.WantsWorkPlane(tool);
        }

        /// <summary>The plane policy of the release of one in-flight cell gesture (plan 29 §1).</summary>
        static bool ReleaseNeedsWorkPlane() =>
            StationCellTool.HasGesture ? !StationCellTool.Gesture.Remove : false;

        /// <summary>Handle one `pointer.*` command. Returns false only for an unusable event.</summary>
        public static bool Handle(StationGameHost host, string type, JObject payload, JObject reply,
            out string code, out string reason, string commandId = null) {
            code = null;
            reason = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            int picksBefore = StationScenePicker.PickCount;
            var editHost = StationEditHost.Ensure();
            int revisionBefore = host.CurrentRevision;

            StationEditScene.ResolveView(host, out var rig, out var camera, out var activeLevel, out var visibility);
            var sectionView = rig != null ? rig.sectionView : null;

            if (sectionView != null && (type == "pointer.cancel" || type == "pointer.leave") &&
                StationSectionDrag.Handle(host, rig, type, default, default, false, reply, out code, out reason)) {
                if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                reply["tool"] = StationToolSelection.Active;
                reply["toolGeneration"] = StationToolSelection.Generation;
                return true;
            }
            if (type == "pointer.cancel") {
                CancelActiveGesture(host, editHost);
                // The draft and badge the shell draws live in `state.edit`; a cancel is not a
                // commit, so publish one state frame now rather than leaving the chip up until
                // the next interval tick (plan 29 §2).
                host.PublishStateNow();
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["cancelled"] = true;
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (type == "pointer.leave") {
                // A leave with a press in flight or a carried piece is a gap in tracking, not a
                // cancel: the reference keeps the armed gesture and parks the carried draft so the
                // player can reach the InfoCard's Confirm / Cancel controls (`MoveController`).
                if (!StationCellTool.HasGesture && !StationEditSession.HasCarried) {
                    StationCellTool.Leave();
                    StationPaintTool.Leave();
                    StationZoneTool.Leave();
                    StationRailTool.Leave();
                    StationTunnelTool.Leave();
                    StationSurfaceTool.Leave();
                    StationEditSession.ForgetPointer();
                    ClearPlan(host, editHost);
                } else if (StationEditSession.HasCarried) {
                    StationEditSession.ForgetPointer();
                }
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }

            if (!StationPointerEvent.TryDecode(payload, out var pointer, out code)) return false;
            StationEditProfiling.NoteClientPointerTime(pointer.TimeMs);
            var tool = StationToolSelection.Active;
            // Chord and ownership arbitration (plan 29 §2). The shell cancels its own chord,
            // but the host must not trust it: both build buttons held at once, a move whose
            // mask lost the owning button, or the release of a button that never armed the
            // press all cancel the gesture — zero picks, zero revisions, both ghost layers
            // and the badge cleared — instead of aiming or finishing it.
            if (HasBuildChord(pointer)) {
                CancelActiveGesture(host, editHost);
                return CancelledReply(host, type, tool, "chord", revisionBefore, picksBefore, reply);
            }
            if (type != "pointer.down" && type != "pointer.rightTap" && !OwnsPress(type, pointer)) {
                string cancelReason = type == "pointer.up" ? "other-release" : "unowned-pointer";
                CancelActiveGesture(host, editHost);
                return CancelledReply(host, type, tool, cancelReason, revisionBefore, picksBefore, reply);
            }
            // A stale event must not become the pointer a later settings/camera refresh re-aims:
            // its tool generation or revision names a session this host no longer has (plan 28 §2).
            bool staleTool = pointer.ToolGeneration >= 0 && pointer.ToolGeneration != StationToolSelection.Generation;
            bool staleRevision = pointer.DocumentRevision >= 0 && pointer.DocumentRevision != host.CurrentRevision;
            if (!staleTool && !staleRevision) StationEditSession.RememberPointer(pointer);

            // Compute ONE screen ray per event and share it between section-handle arbitration
            // and scene picking so a handle grab performs zero scene picks.
            var ray = camera != null ? camera.ScreenPointToRay(pointer.ToScreen()) : default;
            if (sectionView != null && camera != null && ShouldRouteSection(type)) {
                bool fine = (pointer.Modifiers & ShiftBit) != 0;
                if (StationSectionDrag.Handle(host, rig, type, pointer, ray, fine, reply, out code, out reason)) {
                    if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                    reply["tool"] = StationToolSelection.Active;
                    reply["toolGeneration"] = StationToolSelection.Generation;
                    return true;
                }
            }

            if (type == "pointer.up") {
                // The release is dispatched to the **owner recorded at the press**, never to
                // whatever tool happens to be committed when it arrives (plan 27 §2). A tool
                // or revision change in between cancels the gesture instead of applying it.
                ForgetPress();
                bool committed = false;
                if (StationRoadTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationRoadTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out _, out _);
                        committed = StationRoadTool.Finish(host, releaseHit, pointer, out code, out reason);
                        if (committed) {
                            editHost.Bind(host);
                        } else if (!string.IsNullOrEmpty(reason) && code == null) {
                            reply["reason"] = reason;
                        }
                    }
                } else if (StationPaintTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationPaintTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out _, out _);
                        committed = StationPaintTool.Finish(host, releaseHit, pointer, out code, out reason);
                        if (committed) {
                            StationPaintGame.Forget();
                            editHost.Bind(host);
                        } else if (!string.IsNullOrEmpty(reason) && code == null) {
                            reply["reason"] = reason;
                        }
                    }
                } else if (StationZoneTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationZoneTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out _, out _);
                        committed = StationZoneTool.Finish(host, releaseHit, pointer, out code, out reason);
                        if (committed) {
                            editHost.Bind(host);
                            AfterCommit(host, editHost, "");
                        } else if (!string.IsNullOrEmpty(reason) && code == null) {
                            reply["reason"] = reason;
                        }
                    }
                } else if (StationSurfaceTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationSurfaceTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out _, out _);
                        committed = StationSurfaceTool.Finish(host, releaseHit, pointer, out code, out reason);
                        if (committed) {
                            editHost.Bind(host);
                            AfterCommit(host, editHost, "");
                        } else if (!string.IsNullOrEmpty(reason) && code == null) {
                            reply["reason"] = reason;
                        }
                    }
                } else if (StationRoofTool.HasGesture) {
                    // A 屋顶 area/bay gesture commits on the release (`TileEquipmentTool.onUp`):
                    // the batch the ghost drew is the batch one revision lays.
                    if (staleTool || staleRevision) {
                        StationRoofTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out _, out _);
                        committed = StationRoofTool.Finish(host, releaseHit, pointer, ray, out code, out reason);
                        if (committed) {
                            editHost.Bind(host);
                            AfterCommit(host, editHost, "");
                        } else {
                            if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                            // A refused release leaves the batch drawn, so the player can see what
                            // the refusal is about; a cancel drops it.
                            editHost.EnsureBound(host);
                            editHost.Preview?.ShowModules(StationRoofTool.Accepted, StationRoofTool.Refused);
                        }
                    }
                } else if (StationCellTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationCellTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        // The release aims the plane its press aimed: a float block's release
                        // must resolve the same empty-air cell its ghost drew (plan 29 §1).
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, ReleaseNeedsWorkPlane(), out var releaseContext, out _);
                        committed = StationCellTool.Finish(host, releaseHit, pointer, out code, out reason, commandId);
                        if (committed) {
                            editHost.Bind(host);
                            AfterCommit(host, editHost, "");
                        } else if (code != null) {
                            reply["reason"] = reason ?? code;
                        }
                        _ = releaseContext;
                    }
                }
                if (IsCellTool(tool)) {
                    // A committed cell press leaves the pointer over the cell it just built. The
                    // re-aim is the **next frame's** work (plan 29 §3): the release's own pick
                    // already resolved the commit, and a second synchronous pick inside the
                    // install path only lengthened the pause the player feels. A refused or
                    // empty release just clears the drawn layer.
                    if (committed && StationEditSession.HasPointer) host.RequestHoverRefresh();
                    else DrawCells(host, editHost);
                }
                if (StationPaintTool.HasGesture == false) StationPaintTool.Publish();
                if (StationZoneTool.HasGesture == false) StationZoneTool.Publish();
                if (StationSurfaceTool.HasGesture == false) StationSurfaceTool.Publish();
                if (camera != null) PopulateCellReply(host, reply, editHost);
                PublishOutcome(type, tool, committed, code, reason);
                StationEditSession.Trace(type, tool, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["tool"] = tool;
                reply["toolGeneration"] = StationToolSelection.Generation;
                if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (staleTool) {
                code = "stale-tool";
                reason = "The pointed-at tool is not the committed tool any more.";
                return false;
            }
            if (staleRevision) {
                code = "stale-revision";
                reason = "The pointer event belongs to a revision the station no longer has.";
                return false;
            }
            if (type != "pointer.down" && type != "pointer.rightTap" && type != "pointer.move") {
                code = "unsupported-command";
                return false;
            }

            var world = host.Coordinator?.World;
            var hit = StationEditScene.PickRay(host, world, camera, ray, activeLevel, visibility,
                NeedsWorkPlane(tool, ActiveGestureButton(pointer)), out var pickContext, out code);
            if (tool == "select" && type == "pointer.down" && pointer.Button == 0 &&
                PassengerCrowdRenderer.Current != null &&
                PassengerCrowdRenderer.Current.TryPick(world, ray,
                    hit == null ? float.PositiveInfinity : Mathf.Min(hit.CellDistance, hit.ModuleDistance),
                    pickContext, out int passengerId)) {
                ForgetPress();
                StationEditSession.Picked = null;
                StationEditSession.SelectPassenger(passengerId);
                ClearCellLayer(editHost);
                editHost.Preview?.ClearGhost();
                editHost.Preview?.ClearHover();
                ClearSelectionHighlight(editHost);
                reply["edit"] = StationEditSession.ToJson();
                StationEditSession.Trace(type, tool, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                return true;
            }
            if (tool == "select" && type == "pointer.down" && pointer.Button == 0 &&
                StationEditSession.SelectionKind == "agent") StationEditSession.ClearSelection();
            if (hit == null) {
                // A miss: no surface under the pointer. The reference draws nothing there, so the
                // owning layer is cleared rather than left showing the previous aim (plan 28 §1).
                // It is a routed event that aimed at nothing — not a refusal of the command.
                if (IsCellTool(tool)) StationCellTool.Miss();
                if (StationRoofTool.IsArmed()) StationRoofTool.Miss();
                if (StationPillarTool.IsArmed()) StationPillarTool.Miss();
                ForgetPress();
                ClearCellLayer(editHost);
                editHost.Preview?.ClearGhost();
                reply["miss"] = true;
                reply["tool"] = tool;
                reply["toolGeneration"] = StationToolSelection.Generation;
                StationEditSession.Trace(type, tool, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                PopulateCellReply(host, reply, editHost);
                if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                return true;
            }

            if (type == "pointer.down" || type == "pointer.rightTap") ForgetPress();
            switch (type) {
                case "pointer.down":
                    Down(host, editHost, world, ray, pickContext, pointer, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.rightTap":
                    RightTap(host, editHost, pointer, ray, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.move":
                    Aim(host, editHost, world, ray, pickContext, pointer, tool, hit, reply, out code, out reason);
                    break;
            }
            // Record the press that owns whatever gesture it armed (plan 29 §2): the release
            // and the moves of that gesture must belong to the same pointer and button.
            if (type == "pointer.down" || type == "pointer.rightTap") {
                if (AnyEditGestureActive()) RememberPress(pointer);
                else ForgetPress();
            } else if (!AnyEditGestureActive()) {
                ForgetPress();
            }

            StationEditSession.Trace(type, tool, hit, StationEditSession.Plan,
                revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
            reply["hit"] = HitJson(hit);
            reply["tool"] = tool;
            reply["toolGeneration"] = StationToolSelection.Generation;
            PublishOutcome(type, tool, host.CurrentRevision != revisionBefore, code, reason);
            PopulateCellReply(host, reply, editHost);
            if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
            return true;
        }

        /// <summary>
        /// Publish one build outcome for the player (plan 28 §4): a **committed** press clears
        /// the notice, a refusal names itself as `blocked` (a candidate this surface turns away)
        /// or `stale` (the gesture's tool or revision moved), and a deliberate click that changes
        /// nothing is a `no-op`. A plain hover publishes nothing, so moving the pointer over
        /// awkward geometry never spams the shell.
        /// </summary>
        static void PublishOutcome(string type, string tool, bool committed, string code, string reason) {
            if (string.Equals(type, "pointer.move", StringComparison.Ordinal)) return;
            if (committed) { StationEditSession.ClearNotice(); return; }
            if (string.IsNullOrEmpty(code) && string.IsNullOrEmpty(reason)) return;
            string kind = "blocked";
            if (string.Equals(code, "stale-tool", StringComparison.Ordinal) ||
                string.Equals(code, "stale-revision", StringComparison.Ordinal) ||
                string.Equals(reason, "stale-tool", StringComparison.Ordinal) ||
                string.Equals(reason, "stale-revision", StringComparison.Ordinal)) kind = "stale";
            else if (string.Equals(code, "nothing-to-do", StringComparison.Ordinal) ||
                     string.Equals(reason, "nothing-to-do", StringComparison.Ordinal) ||
                     string.Equals(code, "no-track-to-remove", StringComparison.Ordinal) ||
                     string.Equals(code, "no-roof-to-remove", StringComparison.Ordinal)) kind = "no-op";
            StationEditSession.PublishNotice(kind, code ?? reason, reason, tool);
        }

        /// <summary>
        /// The reply of a cancelled press (plan 29 §2): no scene pick, no revision, both ghost
        /// layers and the footprint badge cleared. It is a routed event that deliberately did
        /// nothing, so it publishes no refusal notice — the player asked for it.
        /// </summary>
        static bool CancelledReply(StationGameHost host, string type, string tool, string reason,
            int revisionBefore, int picksBefore, JObject reply) {
            if (reply != null) {
                reply["cancelled"] = reason ?? "";
                reply["tool"] = tool;
                reply["toolGeneration"] = StationToolSelection.Generation;
                reply["edit"] = StationEditSession.ToJson();
            }
            // One immediate state frame so the shell drops the ghost's badge with the gesture
            // instead of waiting for the interval tick.
            if (host != null) host.PublishStateNow();
            StationEditSession.Trace(type, tool, null, null, revisionBefore, host.CurrentRevision,
                StationScenePicker.PickCount - picksBefore);
            return true;
        }

        /// <summary>
        /// Append the cell tool's aimed preview to a reply so the shell can read the same
        /// verdict the player sees: accepted/refused cells, the generated ring, the footprint
        /// badge and whether the whole gesture is refused. It **serializes only** (plan 28 §1):
        /// the drawn layer belongs to <see cref="DrawCells"/>, which every aim path calls, so a
        /// badge can never appear beside an invisible ghost.
        /// </summary>
        static void PopulateCellReply(StationGameHost host, JObject reply, StationEditHost editHost) {
            _ = host;
            _ = editHost;
            if (reply == null) return;
            var preview = StationCellTool.Preview;
            reply["cells"] = preview != null && preview.HasPlan ? preview.ToJson() : null;
            reply["zone"] = StationEditSession.Zone != null ? StationEditSession.Zone.ToJson() : null;
            reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
            reply["surface"] = StationEditSession.Surface != null ? StationEditSession.Surface.ToJson() : null;
            if (CellToolActive) reply["rightClaim"] = StationToolSelection.RightClaim;
        }

        /// <summary>
        /// Draw the cell tool's aimed plan on the game camera (plan 28 §1). Binding is checked
        /// first and is idempotent for one committed world, so drawing on the first aim after
        /// Open or New binds, while drawing under a still pointer never wipes the layer.
        /// </summary>
        static void DrawCells(StationGameHost host, StationEditHost editHost) {
            if (editHost == null) return;
            StationEditScene.ResolveView(host, out _, out _, out _, out var visibility);
            if (visibility != null && visibility.State.HideUi) {
                editHost.Preview?.ClearCells();
                StationEditSession.Ghost = null;
                return;
            }
            editHost.EnsureBound(host);
            editHost.Preview?.ShowCells(StationCellTool.Preview);
            StationEditSession.Ghost = editHost.Preview != null && !editHost.Preview.UiHidden
                ? editHost.Preview.Summary("cells")
                : null;
        }

        /// <summary>Drop the cell tool's drawn layer without touching its gesture.</summary>
        static void ClearCellLayer(StationEditHost editHost) {
            editHost?.Preview?.ClearCells();
            StationEditSession.Ghost = null;
        }


        /// <summary>
        /// The committed tool changed: drop every plan the old owner was drawing so no ghost
        /// (or its release) survives the switch (plan 27 §2: "Clear stale plans immediately on
        /// ownership changes").
        /// </summary>
        public static void OnToolChanged(StationGameHost host) {
            var editHost = StationEditHost.Ensure();
            StationCellTool.Cancel();
            StationPaintTool.Cancel();
            StationZoneTool.Cancel();
            StationRailTool.Cancel();
            StationTunnelTool.Cancel();
            StationSurfaceTool.Cancel();
            StationRoofTool.Cancel();
            StationPillarTool.Cancel();
            if (StationEditSession.HasCarried) CancelMove(host, editHost);
            ClearPlan(host, editHost);
        }

        /// <summary>
        /// The committed tool is unchanged but its **owner** moved (plan 28 §2): the same 设备
        /// tile swapped for another (a pillar for a bench, a roof bay for a plate) is an owner
        /// change, so the old owner's gesture and drawn layer are dropped *before* the new aim,
        /// while a plain rotation/width/variant change is a replan that keeps a held press.
        /// </summary>
        public static void OnToolSettingsEdited(StationGameHost host, bool ownerChanged) {
            if (ownerChanged) {
                var editHost = StationEditHost.Ensure();
                StationRoofTool.Cancel();
                StationPillarTool.Cancel();
                StationCellTool.Cancel();
                StationSurfaceTool.Cancel();
                ClearPlan(host, editHost);
            }
            RefreshHover(host);
        }

        /// <summary>
        /// Re-aim the cached pointer once (plan 27 §2, plan 28 §2). A settings, tool, camera or
        /// view change moves what the same pixel resolves to, and nothing else would rebuild
        /// the ghost under a still pointer. It resolves **one fresh ray and one fresh hit** and
        /// then runs the same non-committing aim a real `pointer.move` runs
        /// (<see cref="Aim"/>), so a stationary change and a moving pointer can never resolve
        /// two different ghosts.
        /// </summary>
        public static bool RefreshHover(StationGameHost host) {
            if (host == null || !host.IsLoaded) return false;
            var tool = StationToolSelection.Active;
            var editHost = StationEditHost.Ensure();
            StationEditScene.ResolveView(host, out _, out var camera, out var activeLevel, out var visibility);
            if (visibility != null && visibility.State.HideUi) {
                editHost.Preview?.ClearAll();
                StationEditSession.Ghost = null;
                return false;
            }
            if (!StationEditSession.HasPointer) {
                // The shell parked the pointer (a rail click, a leave): only the cell tool can
                // still re-plan its cached cell, and it draws nothing until the pointer returns.
                return StationCellTool.RefreshHover(host);
            }
            if (camera == null) return false;
            var world = host.Coordinator?.World;
            var ray = camera.ScreenPointToRay(StationEditSession.PointerScreen());
            var hit = StationEditScene.PickRay(host, world, camera, ray, activeLevel, visibility,
                NeedsWorkPlane(tool), out var pickContext, out _);
            if (hit == null) {
                // A miss under a still pointer drops what the old aim drew, exactly like a move
                // that leaves the station: no stale ghost survives a camera that no longer
                // points at the surface it was resolved against.
                if (IsCellTool(tool)) StationCellTool.Miss();
                ClearCellLayer(editHost);
                editHost.Preview?.ClearHover();
                return false;
            }
            editHost.EnsureBound(host);
            string code, reason;
            var discard = new JObject();
            Aim(host, editHost, world, ray, pickContext, StationEditSession.Pointer, tool, hit, discard,
                out code, out reason);
            return true;
        }

        /// <summary>
        /// A 删除 press on a piece whose family has its own reference delete gesture
        /// (`DeleteTool.ts`): a 道路 segment lifts the segment through `RoadTool`'s delete mode,
        /// a 屋顶 (or a stair's block) lifts the tile area through `RoofTool`'s remove mode, and
        /// a 盲道 / 围栏 / 场地分隔 is erased as a **line** through the pressed record's own run
        /// template. Returns true when the press was consumed by one of those owners; a family
        /// without one (a bench, a gate, a sign) falls through to the cell tool's frozen sweep.
        /// </summary>
        static bool BeginFamilyDelete(StationGameHost host, StationEditHost editHost, StationPointerEvent pointer,
            Ray ray, StationSceneHit hit, string tool, JObject reply, out string reason) {
            reason = null;
            if (!string.Equals(tool, "delete", StringComparison.Ordinal)) return false;
            if (pointer.Button != 0 && pointer.Button != 2) return false;
            if (hit == null || !hit.HasModule || !hit.ModuleWins || hit.Module == null) return false;
            var module = hit.Module;
            switch (module.Type) {
                case "road": {
                    if (!StationRoadTool.Begin(host, hit, pointer, 2, out reason)) {
                        if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                        return true;
                    }
                    StationRoadTool.Publish();
                    reply["road"] = StationEditSession.ToJson()["road"];
                    return true;
                }
                case "roof":
                case "stair": {
                    if (string.Equals(module.Type, "stair", StringComparison.Ordinal) &&
                        !module.Config.Bool("block")) return false;
                    if (!StationRoofTool.Begin(host, hit, pointer, ray, 2, out reason)) {
                        if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                        return true;
                    }
                    StationRoofTool.Publish();
                    editHost.EnsureBound(host);
                    editHost.Preview?.ShowModules(StationRoofTool.Accepted, StationRoofTool.Refused);
                    return true;
                }
                case "tactile":
                case "fence":
                    // The run families the reference deletes along their own line, not as one
                    // piece of a same-type sweep.
                    if (!StationCellTool.BeginRunErase(host, hit, pointer, out reason)) {
                        if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                        return true;
                    }
                    StationCellTool.Publish();
                    DrawCells(host, editHost);
                    reply["cells"] = StationCellTool.Preview.ToJson();
                    return true;
                case "court":
                    if (!string.Equals(module.Config.Text("variant"), "divider", StringComparison.Ordinal)) return false;
                    if (!StationCellTool.BeginRunErase(host, hit, pointer, out reason)) {
                        if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                        return true;
                    }
                    StationCellTool.Publish();
                    DrawCells(host, editHost);
                    reply["cells"] = StationCellTool.Preview.ToJson();
                    return true;
                default:
                    return false;
            }
        }

        static void Down(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationPointerEvent pointer, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            StationEditSession.Picked = null;
            if (StationEditSession.HasCarried) {
                if (pointer.Button == 2) {
                    CancelMove(host, editHost);
                    host.PublishStateNow();
                    return;
                }
                if (pointer.Button == 0) {
                    CommitMove(host, editHost, world, ray, pickContext, hit, reply, out code, out reason);
                    return;
                }
            }
            // A 删除 press keeps the reference's **family-specific** delete semantics before it
            // becomes a module sweep or a block rectangle (plan 30 §2): a road segment lifts the
            // segment, a roof/stair tile lifts its area, and a 盲道 path / 围栏 run / 场地分隔 is
            // erased as a line. Everything else keeps the press-frozen sweep the cell tool owns.
            if (IsCellTool(tool) && BeginFamilyDelete(host, editHost, pointer, ray, hit, tool, reply, out reason)) {
                return;
            }
            if (IsCellTool(tool) && (pointer.Button == 0 || pointer.Button == 2)) {
                // The block tool owns **both** build buttons: the primary adds, the secondary
                // digs/erases. The shell gives a claimed right button to the tool instead of the
                // camera pan, so this is the one owner of it.
                if (StationCellTool.Begin(host, hit, tool, pointer.Button, pointer, out reason)) {
                    StationCellTool.Publish();
                    DrawCells(host, editHost);
                    reply["cells"] = StationCellTool.Preview.ToJson();
                    return;
                }
                StationCellTool.Miss();
                ClearCellLayer(editHost);
                reply["cells"] = null;
                if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && ModuleRunArmed() &&
                (pointer.Button == 0 || pointer.Button == 2)) {
                // A run family (围栏 / 盲道 / floor mark) drags a line rather than placing one
                // panel per press (`EquipmentTool.beginLineAdd`).
                if (StationCellTool.Begin(host, hit, tool, pointer.Button, pointer, out reason)) {
                    StationCellTool.Publish();
                    DrawCells(host, editHost);
                    reply["cells"] = StationCellTool.Preview.ToJson();
                    return;
                }
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && RoadArmed() &&
                (pointer.Button == 0 || pointer.Button == 2)) {
                // The 道路 stroke drags a centreline between nodes (`RoadTool.begin`); its ghost is
                // the road preview the `road.preview` command already draws.
                if (StationRoadTool.Begin(host, hit, pointer, pointer.Button, out reason)) {
                    StationRoadTool.Publish();
                    reply["road"] = StationEditSession.ToJson()["road"];
                    return;
                }
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationSurfaceTool.IsArmed() &&
                (pointer.Button == 0 || pointer.Button == 2)) {
                // The 人行道 / 草坪 brushes pave a rectangle of tiles (`TileEquipmentTool`'s
                // outdoor branch): one finish per tile, the other kind replaces it.
                bool armed = StationSurfaceTool.Begin(host, hit, pointer, pointer.Button, out reason);
                if (!armed && !string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                StationSurfaceTool.Publish();
                editHost.Preview?.ShowSurface(StationSurfaceTool.Preview);
                reply["surface"] = StationEditSession.Surface != null ? StationEditSession.Surface.ToJson() : null;
                return;
            }
            // A 桥梁 is a fixed-length span hung off the hovered rail's free end — the same gesture
            // as a 隧道 (plan 28 §3c), with `cfg.bridge` and piers derived per bay in one revision.
            // Its aim, its ghost and its press read one shared plan.
            if (string.Equals(tool, "module", StringComparison.Ordinal) && IsBridgeArmed()) {
                StationTunnelTool.Aim(host, hit, pointer, true);
                StationTunnelTool.Publish();
                editHost.EnsureBound(host);
                var bridgePlan = StationTunnelTool.Preview;
                editHost.Preview?.ShowRail(bridgePlan, bridgePlan?.Track != null
                    ? StationBridgePillars.Candidates(host.Index, StationModulePlacement.ToRecord(bridgePlan.Track))
                    : null);
                reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                if (pointer.Button == 2) {
                    bool lifted = StationTunnelTool.Begin(host, hit, pointer, 2, true, out code, out reason);
                    if (!lifted) { if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason; return; }
                    editHost.Bind(host);
                    AfterCommit(host, editHost, "");
                    return;
                }
                if (!StationTunnelTool.Begin(host, hit, pointer, pointer.Button, true, out code, out reason)) {
                    if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                    return;
                }
                editHost.Bind(host);
                AfterCommit(host, editHost, StationTunnelTool.Preview?.Track?.Id ?? "");
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationLiftTool.IsArmed() &&
                (pointer.Button == 0 || pointer.Button == 2)) {
                // A press in an elevator's own column grows or trims that shaft; anywhere else it
                // falls through to the ordinary placement, which drops a fresh one (`placeLift`).
                if (StationLiftTool.Begin(host, hit, pointer, pointer.Button, out code, out reason)) {
                    if (!string.IsNullOrEmpty(code)) reply["code"] = code;
                    if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                    editHost.Bind(host);
                    AfterCommit(host, editHost, "");
                    return;
                }
            }
            switch (tool) {
                case "select":
                    Select(host, editHost, hit);
                    return;
                case "pick":
                    Pick(host, editHost, hit);
                    return;
                case "paint": {
                    // The 材质 brush is a face gesture: press anchors, release paints (or erases
                    // on the secondary button), and 取色 mode lifts the finish instead.
                    StationCellTool.Cancel();
                    if (StationPaintTool.Begin(host, hit, pointer, pointer.Button, out reason)) {
                        if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                        if (!StationPaintTool.HasGesture) {
                            // `pick` mode is one shot: publish and go.
                            StationPaintTool.Publish();
                            editHost.Preview?.ShowFaces(StationPaintTool.Preview);
                        } else {
                            StationPaintTool.Publish();
                            editHost.Preview?.ShowFaces(StationPaintTool.Preview);
                        }
                        reply["paint"] = StationEditSession.Paint != null ? StationEditSession.Paint.ToJson() : null;
                        return;
                    }
                    reply["paint"] = null;
                    return;
                }
                case "zone": {
                    // The 分区 brush labels **floor**: press anchors, release paints the dragged
                    // rectangle, and the secondary button (or the 无分区 tile) takes a label off.
                    StationCellTool.Cancel();
                    StationZoneTool.Begin(host, hit, pointer, pointer.Button, out reason);
                    if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                    StationZoneTool.Publish();
                    editHost.Preview?.ShowZone(StationZoneTool.Preview);
                    reply["zone"] = StationEditSession.Zone != null ? StationEditSession.Zone.ToJson() : null;
                    return;
                }
                case "rail": {
                    // The 站台 rail is a press tool: the primary button drops the whole pre-sized
                    // piece for the bound line, the secondary lifts the rail under the pointer.
                    StationCellTool.Cancel();
                    bool placedRail = StationRailTool.Begin(host, hit, pointer, pointer.Button, out code, out reason);
                    StationRailTool.Publish();
                    editHost.Preview?.ShowRail(StationRailTool.Preview);
                    reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                    if (!placedRail && !string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                    return;
                }
                case "tunnel": {
                    // The 隧道 tool extends the hovered rail along its own axis and lifts it on
                    // the secondary press (`TunnelTool.onDown`).
                    StationCellTool.Cancel();
                    bool bored = StationTunnelTool.Begin(host, hit, pointer, pointer.Button, false, out code, out reason);
                    StationTunnelTool.Publish();
                    editHost.EnsureBound(host);
                    editHost.Preview?.ShowRail(StationTunnelTool.Preview);
                    reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                    if (!bored && !string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                    return;
                }
                case "delete":
                    Delete(host, editHost, hit, reply, out code, out reason);
                    return;
                case "move":
                    if (StationEditSession.HasCarried)
                        CommitMove(host, editHost, world, ray, pickContext, hit, reply, out code, out reason);
                    else
                        BeginMove(host, editHost, hit, reply, out code, out reason);
                    return;
                case "module":
                    // A 屋顶 tile arms an area/bay gesture that commits on the release, and a
                    // 支柱 press over an existing post grows it in place (plan 28 §3).
                    if (StationRoofTool.IsArmed()) {
                        if (!StationRoofTool.Begin(host, hit, pointer, ray, pointer.Button, out reason)) {
                            if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                            return;
                        }
                        StationRoofTool.Publish();
                        editHost.EnsureBound(host);
                        editHost.Preview?.ShowModules(StationRoofTool.Accepted, StationRoofTool.Refused);
                        return;
                    }
                    if (StationPillarTool.IsArmed()) {
                        int revisionBeforePillar = host.CurrentRevision;
                        if (StationPillarTool.Begin(host, hit, pointer, pointer.Button, out code, out reason)) {
                            if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                            if (host.CurrentRevision != revisionBeforePillar) {
                                editHost.Bind(host);
                                AfterCommit(host, editHost, "");
                            }
                            reply["edit"] = StationEditSession.ToJson();
                            return;
                        }
                    }
                    Place(host, editHost, world, ray, pickContext, hit, reply, out code, out reason);
                    return;
                default:
                    reply["unsupportedTool"] = tool;
                    ClearPlan(host, editHost);
                    return;
            }
        }

        static void RightTap(StationGameHost host, StationEditHost editHost, StationPointerEvent pointer, Ray ray,
            string tool, StationSceneHit hit, JObject reply, out string code, out string reason) {
            code = null; reason = null;
            if (StationCellTool.HasGesture) {
                StationCellTool.Cancel();
                return;
            }
            if (tool == "select") {
                Delete(host, editHost, hit, reply, out code, out reason);
                return;
            }
            if (StationEditSession.HasCarried) {
                CancelMove(host, editHost);
                return;
            }
            if (IsCellTool(tool)) {
                // A right **tap** (no drag) is one erase, exactly like a left tap is one block:
                // the reference begins a remove gesture on the right press and releases it.
                if (StationCellTool.Begin(host, hit, tool, 2, pointer, out reason)) {
                    StationCellTool.Finish(host, hit, pointer, out code, out reason);
                    StationCellTool.Publish();
                    DrawCells(host, editHost);
                    if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                    return;
                }
                StationCellTool.Miss();
                ClearCellLayer(editHost);
            }
            if (string.Equals(tool, "paint", StringComparison.Ordinal)) {
                // A right tap on the brush erases the face back to the bare finish.
                if (StationPaintTool.Begin(host, hit, pointer, 2, out reason)) {
                    StationPaintTool.Finish(host, hit, pointer, out code, out reason);
                    StationPaintTool.Publish();
                    if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                    return;
                }
            }
            if (string.Equals(tool, "zone", StringComparison.Ordinal)) {
                // A right tap on the brush takes the label off exactly like arming 无分区: the
                // same gesture, cancelled into the eraser (`ZoneTool`'s `info.button === 2`).
                // Immediate booth removal in Begin completes without opening a drag gesture.
                StationZoneTool.Begin(host, hit, pointer, 2, out reason);
                if (StationZoneTool.HasGesture) {
                    StationZoneTool.Finish(host, hit, pointer, out code, out reason);
                }
                StationZoneTool.Publish();
                if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationSurfaceTool.IsArmed()) {
                // A right tap on a tile lifts that tile's own finish, like the brush's own release.
                StationSurfaceTool.Begin(host, hit, pointer, 2, out reason);
                StationSurfaceTool.Finish(host, hit, pointer, out code, out reason);
                StationSurfaceTool.Publish();
                if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && ModuleRunArmed()) {
                if (StationCellTool.Begin(host, hit, tool, 2, pointer, out reason)) {
                    StationCellTool.Finish(host, hit, pointer, out code, out reason);
                    StationCellTool.Publish();
                    if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                    return;
                }
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationRoofTool.IsArmed()) {
                // A right **tap** on a 屋顶 piece lifts the piece under the pointer (`TileEquipmentTool`
                // arms its remove gesture on the secondary press and releases it on the tap).
                if (StationRoofTool.Begin(host, hit, pointer, ray, 2, out reason)) {
                    bool lifted = StationRoofTool.Finish(host, hit, pointer, ray, out code, out reason);
                    if (lifted) {
                        editHost.Bind(host);
                        AfterCommit(host, editHost, "");
                    } else if (!string.IsNullOrEmpty(reason)) {
                        reply["reason"] = reason;
                    }
                    return;
                }
                if (!string.IsNullOrEmpty(reason)) reply["reason"] = reason;
                return;
            }
            ClearPlan(host, editHost);
        }

        /// <summary>
        /// The **non-committing** half of one pointer aim (plan 28 §2): re-plan whatever the
        /// committed tool draws, draw it on the committed world, and publish the plan. A real
        /// `pointer.move` and a stationary settings/camera refresh both run this, so the two can
        /// never resolve different ghosts for the same pixel.
        /// </summary>
        static void Aim(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationPointerEvent pointer, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            if (StationEditSession.HasCarried) {
                editHost.Preview?.ClearHover();
                AimMove(host, editHost, world, ray, pickContext, hit);
                return;
            }
            if (tool != "select" && tool != "pick" && tool != "move") editHost.Preview?.ClearHover();
            if (StationPaintTool.HasGesture || string.Equals(tool, "paint", StringComparison.Ordinal)) {
                StationPaintTool.Aim(host, hit, pointer);
                StationPaintTool.Publish();
                editHost.Preview?.ClearGhost();
                editHost.Preview?.ShowFaces(StationPaintTool.Preview);
                reply["paint"] = StationEditSession.Paint != null ? StationEditSession.Paint.ToJson() : null;
                return;
            }
            if (StationRoadTool.HasGesture) {
                StationRoadTool.Aim(host, hit, pointer);
                StationRoadTool.Publish();
                reply["road"] = StationEditSession.ToJson()["road"];
                return;
            }
            if (string.Equals(tool, "rail", StringComparison.Ordinal)) {
                // The rail ghost is the piece the press would drop, centred on the hovered cell.
                StationRailTool.Aim(host, hit, pointer);
                StationRailTool.Publish();
                editHost.Preview?.ShowRail(StationRailTool.Preview);
                reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                return;
            }
            if (string.Equals(tool, "tunnel", StringComparison.Ordinal)) {
                // The tunnel ghost hangs off the free end of the rail under the pointer.
                StationTunnelTool.Aim(host, hit, pointer, false);
                StationTunnelTool.Publish();
                editHost.Preview?.ShowRail(StationTunnelTool.Preview);
                reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                return;
            }
            if (IsBridgeArmed()) {
                // The bridge ghost is the span — and its piers — the press would build (plan 28 §3c).
                StationTunnelTool.Aim(host, hit, pointer, true);
                StationTunnelTool.Publish();
                var bridge = StationTunnelTool.Preview;
                editHost.Preview?.ShowRail(bridge, bridge?.Track != null
                    ? StationBridgePillars.Candidates(host.Index, StationModulePlacement.ToRecord(bridge.Track))
                    : null);
                reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
                return;
            }
            if (StationSurfaceTool.HasGesture || StationSurfaceTool.IsArmed()) {
                // A paved drag tints the rectangle of tiles it covers; a still pointer tints the
                // one tile under it and says so when the outdoor rules turn that cell away.
                StationSurfaceTool.Aim(host, hit, pointer);
                StationSurfaceTool.Publish();
                editHost.Preview?.ClearGhost();
                editHost.Preview?.ShowSurface(StationSurfaceTool.Preview);
                reply["surface"] = StationEditSession.Surface != null ? StationEditSession.Surface.ToJson() : null;
                return;
            }
            if (StationZoneTool.HasGesture || string.Equals(tool, "zone", StringComparison.Ordinal)) {
                // A zone drag tints the floor its rectangle covers; a still pointer tints the
                // one cell it is over (and says so when that cell is not floor).
                StationZoneTool.Aim(host, hit, pointer);
                StationZoneTool.Publish();
                editHost.Preview?.ClearGhost();
                editHost.Preview?.ShowZone(StationZoneTool.Preview);
                reply["zone"] = StationEditSession.Zone != null ? StationEditSession.Zone.ToJson() : null;
                return;
            }
            if (StationRoofTool.HasGesture) {
                // A 屋顶/楼梯 area gesture armed by 删除 (or by the 屋顶 palette) keeps its
                // remove/add plan through the whole drag (plan 30 §2).
                StationRoofTool.AimAt(host, hit, ray, pointer);
                StationRoofTool.Publish();
                editHost.EnsureBound(host);
                editHost.Preview?.ShowModules(StationRoofTool.Accepted, StationRoofTool.Refused);
                StationEditSession.Ghost = editHost.Preview != null && !editHost.Preview.UiHidden
                    ? editHost.Preview.Summary("roof")
                    : null;
                return;
            }
            if (StationCellTool.HasGesture) {
                StationCellTool.Aim(host, hit, pointer);
                StationCellTool.Publish();
                DrawCells(host, editHost);
                reply["cells"] = StationCellTool.Preview.ToJson();
                return;
            }
            if (StationEditSession.HasCarried) {
                AimMove(host, editHost, world, ray, pickContext, hit);
                return;
            }
            if (IsCellTool(tool)) {
                // A still pointer shows the one-cell ghost — the F key's first requirement is
                // that a correctly positioned ghost appears before any click.
                StationCellTool.Aim(host, hit, pointer);
                StationCellTool.Publish();
                DrawCells(host, editHost);
                reply["cells"] = StationCellTool.Preview.ToJson();
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationRoofTool.IsArmed()) {
                // The 屋顶 tiles are area/bay gestures, not one piece per press (plan 28 §3).
                StationRoofTool.AimAt(host, hit, ray, pointer);
                StationRoofTool.Publish();
                editHost.EnsureBound(host);
                editHost.Preview?.ShowModules(StationRoofTool.Accepted, StationRoofTool.Refused);
                StationEditSession.Ghost = editHost.Preview != null && !editHost.Preview.UiHidden
                    ? editHost.Preview.Summary("roof")
                    : null;
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && StationPillarTool.IsArmed()) {
                // A 支柱 on an existing post grows that post (plan 28 §3); the ghost is the grown
                // shaft, so the press commits exactly the height the player was shown.
                StationPillarTool.Aim(host, hit, pointer);
                StationPillarTool.Publish();
                editHost.EnsureBound(host);
                editHost.Preview?.ShowModules(StationPillarTool.Accepted, StationPillarTool.Refused);
                StationEditSession.Ghost = editHost.Preview != null && !editHost.Preview.UiHidden
                    ? editHost.Preview.Summary("pillar")
                    : null;
                return;
            }
            if (tool == "module") {
                Hover(host, editHost, world, ray, pickContext, hit);
                return;
            }
            ClearPlan(host, editHost, keepHover: true);
            editHost.Preview?.Hover(tool == "select" || tool == "pick" || tool == "move" ? hit.Module : null);
        }

        // --------------------------------------------------------------- selection

        static void Select(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            ClearPlan(host, editHost);
            if (hit.TargetKind == StationSceneTargetKind.Module) {
                StationEditSession.SelectModule(hit.Module);
                editHost.Preview?.Select(hit.Module);
                return;
            }
            if (hit.TargetKind == StationSceneTargetKind.Cell) {
                StationEditSession.SelectCell(hit.CellKey);
                ClearSelectionHighlight(editHost);
                return;
            }
            StationEditSession.ClearSelection();
            ClearSelectionHighlight(editHost);
        }

        // ---------------------------------------------------------------- eyedropper

        static void Pick(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            ClearPlan(host, editHost);
            if (hit.TargetKind != StationSceneTargetKind.Module) {
                StationEditSession.Picked = new JObject { ["moduleId"] = "", ["type"] = "", ["reason"] = "no-module" };
                return;
            }
            var module = hit.Module;
            StationEditSession.SelectModule(module);
            editHost.Preview?.Select(module);
            StationEditSession.Picked = new JObject {
                ["moduleId"] = module.Id,
                ["type"] = module.Type,
                ["cfg"] = SafeCfg(module),
                ["paletteId"] = StationModulePick.PaletteIdFor(module),
                ["reason"] = "",
            };
        }

        static JObject SafeCfg(StationModuleRecord module) {
            if (string.IsNullOrEmpty(module.RawJson)) return new JObject();
            try {
                var record = JObject.Parse(module.RawJson);
                return record["cfg"] as JObject ?? new JObject();
            } catch (Newtonsoft.Json.JsonException) { return new JObject(); }
        }

        // ------------------------------------------------------------------- place

        static void Hover(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit) {
            var plan = ResolvePlacement(host, world, ray, pickContext, hit);
            StationEditSession.Plan = plan;
            editHost.EnsureBound(host);
            editHost.Preview?.Show(plan);
            StationEditSession.Ghost = editHost.Preview != null && !editHost.Preview.UiHidden
                ? editHost.Preview.Summary("module")
                : null;
        }

        static void Place(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            var plan = ResolvePlacement(host, world, ray, pickContext, hit);
            if (plan.Candidate == null) {
                StationEditSession.Plan = plan;
                editHost.Preview?.Show(plan);
                reason = "no-candidate";
                reply["edit"] = StationEditSession.ToJson();
                return;
            }
            if (!plan.Ok) {
                StationEditSession.Plan = plan;
                editHost.Preview?.Show(plan);
                reason = plan.Reason;
                reply["edit"] = StationEditSession.ToJson();
                return;
            }
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, plan.Candidate.Type);
            // A fresh ad screen rolls its poster once, from the id it was just given (`needsPoster`).
            StationAdPosters.RollFor(plan.Candidate);
            // A run's corridor and the blocks it carves commit as one revision: the piece is
            // placed and the corridor opened together (`carveRampOpenings`).
            if (StationModuleFamilies.IsRamp(plan.Candidate.Type) && !plan.Candidate.Bool("block")) {
                var patch = new StationCellPatch();
                var candidateRecord = StationModulePlacement.ToRecord(plan.Candidate);
                patch.ModuleAdds.Add(plan.Candidate);
                foreach (var write in StationRampCarve.MaterializeExitFloorLandings(host.Index, candidateRecord))
                    patch.Writes.Add(write);
                foreach (var write in StationRampCarve.Carve(host.Index, new[] { candidateRecord }))
                    patch.Writes.Add(write);
                if (!StationEditSession.TryApplyCells(host, patch, "place", null, out _, out code)) {
                    reason = code;
                    return;
                }
                AfterCommit(host, editHost, plan.Candidate.Id);
                return;
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place", null, out _, out code)) {
                reason = code;
                return;
            }
            AfterCommit(host, editHost, plan.Candidate.Id);
        }

        static StationPlacementRequest RequestFor(StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit,
            StationModuleRecord carried, int carriedRotation) {
            int rotation = carried != null ? carriedRotation : StationToolSelection.SettingInt("rotation", 0);
            string toolType = carried == null ? StationToolSelection.Setting("moduleType") : "";
            string variant = carried == null ? StationToolSelection.Setting("variant") : "";
            int width = carried == null ? StationToolSelection.SettingInt("width", 0) : 0;
            string lineId = carried == null ? StationToolSelection.Setting("lineId") : "";
            int curtainHeight = StationToolSelection.SettingInt("curtainHeight", 4);
            if (carried == null && !string.IsNullOrEmpty(toolType)) {
                if ((string.Equals(toolType, "door", StringComparison.Ordinal) ||
                     toolType.StartsWith("door-", StringComparison.Ordinal)) &&
                    StationToolSelection.SettingBool("doorWide")) {
                    if (string.Equals(toolType, "door", StringComparison.Ordinal)) {
                        toolType = "door-steel-2";
                    } else if (toolType.EndsWith("-1", StringComparison.Ordinal)) {
                        toolType = toolType.Substring(0, toolType.Length - 2) + "-2";
                    }
                    if (!string.IsNullOrEmpty(variant) && variant.EndsWith("-1", StringComparison.Ordinal)) {
                        variant = variant.Substring(0, variant.Length - 2) + "-2";
                    }
                    width = 2;
                } else if (string.Equals(toolType, "hanger-roof", StringComparison.Ordinal) ||
                           string.Equals(toolType, "hanger-post", StringComparison.Ordinal)) {
                    int hangerLen = StationToolSelection.SettingInt("hangerLength", 0);
                    if (hangerLen > 0) width = hangerLen;
                } else if (string.Equals(toolType, "checkout", StringComparison.Ordinal) ||
                           toolType.StartsWith("checkout-", StringComparison.Ordinal)) {
                    int counterLen = StationToolSelection.SettingInt("counterLength", 0);
                    if (counterLen > 0) width = counterLen;
                } else if (string.Equals(toolType, "curtain-wall", StringComparison.Ordinal)) {
                    int curtainWidth = StationToolSelection.SettingInt("curtainWidth", 0);
                    if (curtainWidth > 0) width = curtainWidth;
                }
            }
            var request = BuildRequest(world, ray, pickContext, hit, carried, rotation, toolType, variant, width,
                lineId, curtainHeight);
            if (carried == null && string.Equals(toolType, "roof", StringComparison.Ordinal)) {
                // The 屋顶 tile's 贴顶 toggle pins the thin slab to the lower or upper half of
                // the cell it was dropped on (`roofPlateSnap`).
                request.RoofPlateSnap = StationToolSelection.Setting("roofPlateSnap");
            }
            if (carried == null && (toolType ?? "").StartsWith("roof-", StringComparison.Ordinal)) {
                // A truss bay's breadth is the 屋顶 folder's own 4/8/12 setting, not the
                // generic action-row width (`supportedRoofWidth`).
                request.Width = StationToolSelection.SettingInt("roofWidth", 4);
            }
            if (carried == null && (toolType ?? "").StartsWith("pillar", StringComparison.Ordinal)) {
                // A 支柱's shaft is the tile's own 2–6 m Tab section (`pillarLength`), not a
                // storey default; the palette id names its gauge (plan 28 §3).
                request.PillarLength = StationToolSelection.SettingInt("pillarLength",
                    StationPillarPlanning.DefaultLength);
            }
            if (carried == null && string.Equals(toolType, "stair-block", StringComparison.Ordinal)) {
                // The 楼梯块's height is the tool's own 高/低 toggle (`stairBlockHeight`).
                double metres = StationToolSelection.SettingDouble("stairBlockHeight", 1.0);
                request.BlockHeight = metres > 0 ? metres : 1.0;
            }
            if (carried == null && !string.IsNullOrEmpty(toolType) &&
                ((toolType.StartsWith("stair", StringComparison.Ordinal) && !string.Equals(toolType, "stair-block", StringComparison.Ordinal)) ||
                 string.Equals(toolType, "escalator", StringComparison.Ordinal))) {
                bool isEscalator = string.Equals(toolType, "escalator", StringComparison.Ordinal);
                string span = StationToolSelection.Setting("escalatorSpan");
                if (string.IsNullOrEmpty(span)) span = StationToolSelection.Setting("rampSpan");
                if (span != "double" && span != "triple") span = "single";
                request.RampSpan = span;
                string lengthKey = span == "triple" ? "tripleRampLength"
                    : span == "double" ? "doubleRampLength" : "rampLength";
                string lengthId = StationToolSelection.Setting(lengthKey);
                if (string.IsNullOrEmpty(lengthId)) lengthId = StationToolSelection.Setting("rampLength");
                request.RampLengthId = lengthId;
                if (isEscalator) {
                    request.EscalatorDown = string.Equals(StationToolSelection.Setting("escalatorDir"), "down", StringComparison.Ordinal);
                    request.EscalatorWidth = StationToolSelection.SettingInt("escalatorWidth", 1);
                } else {
                    request.StairWidth = StationToolSelection.SettingDouble("stairWidth", StationRampRules.Band);
                    request.StairStyle = StationToolSelection.Setting("stairStyle");
                }
            }
            if (carried == null && string.Equals(toolType, "lift", StringComparison.Ordinal)) {
                // `liftInterval` is the floor interval in metres; `liftSize` arms the 大 shaft
                // (numeric `3` from `toolAdapter.ts` as well as legacy `"large"`).
                request.LiftInterval = StationToolSelection.SettingInt("liftInterval", 5);
                request.LiftSizeLarge = StationToolSelection.SettingInt("liftSize", 2) == 3 ||
                    string.Equals(StationToolSelection.Setting("liftSize"), "large", StringComparison.Ordinal);
            }
            if (carried == null && string.Equals(toolType, "walkway", StringComparison.Ordinal)) {
                // The 自动步道's three catalogue lengths (短 30 / 中 60 / 长 90 cells), its travel
                // direction (`escalatorDir`, falling back to `walkwayDir`), and its width.
                var length = StationToolSelection.Setting("walkwayLength");
                request.WalkwayRun = length == "long" ? 90 : length == "medium" ? 60 : 30;
                var walkDir = StationToolSelection.Setting("escalatorDir");
                if (string.IsNullOrEmpty(walkDir)) walkDir = StationToolSelection.Setting("walkwayDir");
                request.WalkwayDown = string.Equals(walkDir, "down", StringComparison.Ordinal);
                int walkWidth = StationToolSelection.SettingInt("escalatorWidth", 0);
                if (walkWidth > 0) request.Width = walkWidth;
            }
            return request;
        }

        /// <summary>
        /// Build one <see cref="StationPlacementRequest"/> from a resolved <see cref="StationSceneHit"/>.
        /// Shared by production pointer routing and <c>edit.probe</c> so probes and clicks evaluate
        /// the exact same surface priority and attachment rules (`placementSurface.ts`).
        /// </summary>
        public static StationPlacementRequest BuildRequest(StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit, StationModuleRecord carried,
            int rotation, string toolType, string variant, int width, string lineId, int curtainHeight) {
            string pieceType = "";
            string pieceVariant = "";
            string pieceMount = "";
            if (carried != null) {
                pieceType = carried.Type ?? "";
                pieceVariant = carried.Config.Text("variant");
                pieceMount = carried.Config.Text("mount");
            } else if (StationModuleFamilies.TryParse(toolType ?? "", variant ?? "", width, out var family)) {
                pieceType = family.Type ?? "";
                pieceVariant = family.Variant ?? "";
                pieceMount = string.Equals(pieceType, "sign", StringComparison.Ordinal)
                    ? (string.Equals(toolType, "sign-wall", StringComparison.Ordinal) ? "wall" : "ceiling")
                    : pieceVariant;
            }

            var placementHit = StationPlacementHit.None;
            string targetModuleId = "";
            StationPoint? modulePoint = null;

            if (hit != null && hit.TargetKind == StationSceneTargetKind.Module && hit.ModuleExact) {
                var host = hit.Module;
                targetModuleId = host.Id;
                modulePoint = hit.ModulePoint;
                placementHit = StationPlacementHit.FromNormal(hit.ModulePoint, hit.ModuleNormal, true);
                if (IsOutdoorSurface(host.Type) && placementHit.Normal.Z > 0.5) {
                    // `placementSurface.ts`: sidewalk and lawn slabs are 10 cm proud of `host.Z + 1`,
                    // so `FromNormal` steps into `host.Z + 1`; anchor equipment back on `host.Z`.
                    placementHit = new StationPlacementHit(
                        placementHit.X, placementHit.Y, host.Z,
                        placementHit.X, placementHit.Y, host.Z,
                        true, hit.ModulePoint, host.Z + 1, new StationPoint(0, 0, 1));
                } else if (string.Equals(host.Type, "hanger", StringComparison.Ordinal) &&
                           StationModulePlacement.HangerAcceptsPiece(pieceType, pieceVariant, pieceMount)) {
                    // `placementSurface.ts`: ceiling-hung fittings aimed at a steel hanger bar anchor
                    // at `(floor(point.X), floor(point.Y), host.Z)`.
                    int cx = (int)Math.Floor(hit.ModulePoint.X);
                    int cy = (int)Math.Floor(hit.ModulePoint.Y);
                    placementHit = new StationPlacementHit(
                        cx, cy, host.Z, cx, cy, host.Z + 1,
                        true, hit.ModulePoint, host.Z + 1, placementHit.Normal);
                } else if (string.Equals(host.Type, "glass", StringComparison.Ordinal) &&
                           StationFootprints.GlassStandsOnFloor(host.Config) &&
                           string.Equals(pieceType, "door", StringComparison.Ordinal)) {
                    // Clicking anywhere up a floor-standing glass curtain with a door tool anchors
                    // the candidate on the curtain's floor storey so `TrySnapDoorToCurtain` fits it.
                    int cx = (int)Math.Floor(hit.ModulePoint.X);
                    int cy = (int)Math.Floor(hit.ModulePoint.Y);
                    placementHit = new StationPlacementHit(
                        cx, cy, host.Z, cx, cy, host.Z,
                        true, hit.ModulePoint, host.Z + 1, placementHit.Normal);
                }
            } else if (hit != null && hit.HasCell) {
                placementHit = hit.Cell;
            } else if (hit != null && hit.HasWorkPlane) {
                placementHit = hit.WorkPlane;
            }

            // `EquipmentTool.ts:pickSnapRamp`: head-house exits forgive tread gaps on straight
            // visible stairs/escalators via bounds only when not occluded by a nearer cell.
            if (carried == null && !string.IsNullOrEmpty(toolType) &&
                StationModuleFamilies.TryParseExit(toolType, out _, out _)) {
                bool directRamp = hit != null && hit.TargetKind == StationSceneTargetKind.Module &&
                                  StationModuleFamilies.IsRamp(hit.Module.Type);
                if (!directRamp && world != null) {
                    var snapRamp = StationScenePicker.PickSnapRampInBounds(world, ray, pickContext, hit);
                    if (snapRamp != null) {
                        targetModuleId = snapRamp.Id;
                        if (!placementHit.HasCell && snapRamp.From.HasValue && snapRamp.To.HasValue) {
                            var upper = snapRamp.From.Value.Z >= snapRamp.To.Value.Z
                                ? snapRamp.From.Value
                                : snapRamp.To.Value;
                            int ux = (int)Math.Round(upper.X);
                            int uy = (int)Math.Round(upper.Y);
                            int uz = (int)Math.Round(upper.Z);
                            placementHit = new StationPlacementHit(
                                ux, uy, uz, ux, uy, uz, false,
                                new StationPoint(ux + 0.5, uy + 0.5, uz + 1), uz + 1,
                                new StationPoint(0, 0, 1));
                        }
                    }
                }
            }

            var request = new StationPlacementRequest {
                Carried = carried,
                Rotation = rotation,
                LightPosition = carried == null
                    ? StationToolSelection.SettingInt("lightPosition", 0)
                    : StationEditSession.CarriedLightPosition,
                Hit = placementHit,
                TargetModuleId = targetModuleId,
                ModulePoint = modulePoint,
                CurtainHeight = curtainHeight,
            };
            if (carried == null) {
                request.ToolType = toolType ?? "";
                request.Variant = variant ?? "";
                request.Width = width;
                request.LineId = lineId ?? "";
            }
            return request;
        }

        static bool IsOutdoorSurface(string type) =>
            string.Equals(type, "sidewalk", StringComparison.Ordinal) ||
            string.Equals(type, "lawn", StringComparison.Ordinal);

        static StationPlacementPlan ResolvePlacement(StationGameHost host, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit) {
            var plan = StationModulePlacement.Resolve(host.Index, RequestFor(world, ray, pickContext, hit, null, 0));
            ApplyToolSettingsToCandidate(host.Index, plan?.Candidate);
            return plan;
        }

        static void ApplyToolSettingsToCandidate(StationIndex index, StationEditDraft candidate) {
            if (candidate == null) return;
            switch (candidate.Type) {
                case "gate": {
                    var gateDoor = StationToolSelection.Setting("gateDoor");
                    if (string.Equals(gateDoor, "fence", StringComparison.Ordinal) ||
                        string.Equals(gateDoor, "lane", StringComparison.Ordinal)) {
                        candidate.Set("door", gateDoor);
                    }
                    break;
                }
                case "lift": {
                    var liftStyle = StationToolSelection.Setting("liftStyle");
                    if (string.Equals(liftStyle, "steel", StringComparison.Ordinal) ||
                        string.Equals(liftStyle, "glass", StringComparison.Ordinal)) {
                        candidate.Set("style", liftStyle);
                    }
                    break;
                }
                case "guidepost": {
                    var exitId = StationToolSelection.Setting("guideExitId");
                    if (!string.IsNullOrEmpty(exitId)) candidate.Set("exitId", exitId);
                    break;
                }
                case "psd-end": {
                    if (string.Equals(candidate.Text("variant"), "cover", StringComparison.Ordinal)) break;
                    var psdHeight = StationToolSelection.Setting("psdEndHeight");
                    if ((string.Equals(psdHeight, "full", StringComparison.Ordinal) ||
                         string.Equals(psdHeight, "half", StringComparison.Ordinal)) &&
                        !string.Equals(candidate.Text("psd"), psdHeight, StringComparison.Ordinal)) {
                        candidate.Set("psd", psdHeight);
                        if (string.IsNullOrEmpty(candidate.Text("corner"))) {
                            StationPsdEndRules.TrySnap(index, candidate);
                        }
                    }
                    break;
                }
            }
        }

        // -------------------------------------------------------------------- move

        static void BeginMove(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (hit.TargetKind != StationSceneTargetKind.Module) { reason = "no-module"; return; }
            StationEditSession.SetCarried(hit.Module);
            StationEditSession.SelectModule(hit.Module);
            StationEditSession.Plan = null;
            StationEditSession.MoveReason = "";
            editHost.Bind(host);
            // The source's own cell shows the ghost straight away: a lifted piece that vanishes
            // until the next pointer move reads as a deletion (`MoveController`).
            LiftAtSource(host, editHost, hit.Module);
        }

        /// <summary>
        /// Aim a just-lifted piece at its **own** cell, so the ghost appears where the piece was
        /// without waiting for a pointer move. The hit is the piece's own cell, which is what the
        /// resolver takes for a carried draft.
        /// </summary>
        public static void LiftAtSource(StationGameHost host, StationEditHost editHost, StationModuleRecord module) {
            if (host == null || module == null) return;
            StationEditHost.Ensure().Preview?.HideCarried(module.Id);
            if (host.Index == null) return;
            var point = new StationPoint(module.X + 0.5, module.Y + 0.5, module.Z + 1);
            var at = new StationPlacementHit(module.X, module.Y, module.Z, module.X, module.Y, module.Z,
                true, point, module.Z + 1, new StationPoint(0, 0, 1));
            var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                Carried = module,
                Rotation = StationEditSession.CarriedRotation,
                LightPosition = StationEditSession.CarriedLightPosition,
                Hit = at,
                ModulePoint = point,
                CurtainHeight = StationToolSelection.SettingInt("curtainHeight", 4),
            });
            StationEditSession.Plan = plan;
            StationEditSession.MoveReason = plan.Reason;
            editHost.Bind(host);
            editHost.Preview?.Show(plan);
        }

        static void AimMove(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit) {
            if (!host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) {
                StationEditSession.MoveReason = "not-found";
                return;
            }
            var plan = StationModulePlacement.Resolve(host.Index,
                RequestFor(world, ray, pickContext, hit, module, StationEditSession.CarriedRotation));
            StationEditSession.Plan = plan;
            StationEditSession.MoveReason = plan.Reason;
            editHost.Bind(host);
            editHost.Preview?.Show(plan);
        }

        static void CommitMove(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (!host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) {
                CancelMove(host, editHost);
                host.PublishStateNow();
                reason = "not-found";
                return;
            }
            var plan = StationModulePlacement.Resolve(host.Index,
                RequestFor(world, ray, pickContext, hit, module, StationEditSession.CarriedRotation));
            CommitResolvedMove(host, editHost, module, plan, out code, out reason);
        }

        static void CommitResolvedMove(StationGameHost host, StationEditHost editHost, StationModuleRecord module,
            StationPlacementPlan plan, out string code, out string reason) {
            code = null; reason = null;
            StationEditSession.Plan = plan;
            if (plan == null || !plan.Ok || plan.Candidate == null) {
                string fail = plan != null && !string.IsNullOrEmpty(plan.Reason) ? plan.Reason : "no-hit";
                StationEditSession.MoveReason = fail;
                reason = fail;
                editHost.Bind(host);
                if (plan != null) editHost.Preview?.Show(plan);
                host.PublishStateNow();
                return;
            }
            if (StationModuleFamilies.IsRamp(plan.Candidate.Type) && !plan.Candidate.Bool("block")) {
                var patch = StationRampCarve.PlanRampMove(host.Index, module, plan.Candidate);
                if (!StationEditSession.TryApplyCells(host, patch, "move", null, out _, out code)) {
                    reason = code;
                    return;
                }
                AfterCommit(host, editHost, module.Id);
                return;
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Replace, plan.Candidate, null, "move", null, out _, out code)) {
                reason = code;
                return;
            }
            AfterCommit(host, editHost, module.Id);
        }

        internal static bool ConfirmMove(StationGameHost host, JObject payload, out string code, out string reason) {
            code = reason = null;
            if (!StationEditSession.HasCarried) return true;
            if (host?.Index == null || !host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) {
                CancelMove(host, StationEditHost.Ensure());
                host?.PublishStateNow();
                reason = "not-found";
                return true;
            }
            var parked = StationEditSession.Plan;
            if (parked != null && parked.IsMove) {
                CommitResolvedMove(host, StationEditHost.Ensure(), module, parked, out code, out reason);
                return string.IsNullOrEmpty(code);
            }
            if (!StationEditSession.HasPointer) return true;
            StationEditScene.ResolveView(host, out _, out var camera, out var activeLevel, out var visibility);
            if (camera == null) return true;
            var world = host.Coordinator?.World;
            var ray = camera.ScreenPointToRay(StationEditSession.PointerScreen());
            var hit = StationEditScene.PickRay(host, world, camera, ray, activeLevel, visibility,
                true, out var pickContext, out _);
            if (hit == null) return true;
            CommitMove(host, StationEditHost.Ensure(), world, ray, pickContext, hit, payload, out code, out reason);
            return string.IsNullOrEmpty(code);
        }

        /// <summary>A right press / Escape puts the carried piece back exactly where it was.</summary>
        public static void CancelMove(StationGameHost host, StationEditHost editHost) {
            if (StationEditSession.HasCarried) {
                StationEditSession.SetCarried(null);
                StationEditSession.MoveReason = "";
                editHost.Preview?.RestoreCarried();
            }
            editHost.Preview?.ClearGhost();
            StationEditSession.Plan = null;
        }

        /// <summary>Turn the carried piece one quarter turn.</summary>
        public static bool RotateCarried(StationGameHost host, int delta) {
            if (host?.Index == null || !host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) return false;
            int turn = StationFootprints.NormRot(StationEditSession.CarriedRotation + delta);
            if (module.Type != "light") StationEditSession.CarriedRotation = turn;
            else if (module.Config.Text("variant") != "circular") StationEditSession.CarriedRotation = turn % 2;
            return true;
        }

        // ------------------------------------------------------------------ delete

        static void Delete(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (hit.TargetKind != StationSceneTargetKind.Module) {
                reason = "no-module";
                reply["edit"] = StationEditSession.ToJson();
                return;
            }
            if (string.Equals(hit.Module.Type, "stair", StringComparison.Ordinal) && !hit.Module.Config.Bool("block")) {
                var drops = StationRampCarve.PlanLegacyLandingCleanup(host.Index, hit.Module);
                if (drops.Count > 0) {
                    var patch = new StationCellPatch();
                    patch.RemoveModuleIds.Add(hit.Module.Id);
                    for (int i = 0; i < drops.Count; i++) patch.Writes.Add(StationCellWrite.Drop(drops[i]));
                    if (!StationEditSession.TryApplyCells(host, patch, "delete", null, out _, out code)) {
                        reason = code;
                        return;
                    }
                    StationEditSession.ClearSelection();
                    ClearSelectionHighlight(editHost);
                    return;
                }
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, hit.Module.Id, "delete", null, out _, out code)) {
                reason = code;
                return;
            }
            StationEditSession.ClearSelection();
            ClearSelectionHighlight(editHost);
        }

        // ----------------------------------------------------------------- helpers

        /// <summary>
        /// Drop every plan an owner was drawing. One ghost owns the shared preview layer at a
        /// time, so both layers go: a stale cell ghost must not survive a selection, a tool
        /// switch or a leave (plan 28 §1).
        /// </summary>
        static void ClearPlan(StationGameHost host, StationEditHost editHost, bool keepHover = false) {
            _ = host;
            StationEditSession.Plan = null;
            if (!keepHover) editHost.Preview?.ClearHover();
            editHost.Preview?.ClearGhost();
            editHost.Preview?.ClearCells();
            StationEditSession.Ghost = null;
        }

        static void ClearSelectionHighlight(StationEditHost editHost) => editHost.Preview?.ClearSelection();

        static void AfterCommit(StationGameHost host, StationEditHost editHost, string selectId) {
            editHost.Bind(host);
            editHost.Preview?.RestoreCarried();
            StationEditSession.SetCarried(null);
            StationEditSession.MoveReason = "";
            StationEditSession.Plan = null;
            if (!string.IsNullOrEmpty(selectId) && host.Index.TryGetModule(selectId, out var module)) {
                StationEditSession.SelectModule(module);
                editHost.Preview?.Select(module);
            }
        }

        static string TargetKindName(StationSceneTargetKind kind) =>
            kind == StationSceneTargetKind.Module ? "module"
            : kind == StationSceneTargetKind.Cell ? "cell"
            : kind == StationSceneTargetKind.Plane ? "plane"
            : "none";

        static JObject HitJson(StationSceneHit hit) => new JObject {
            ["targetKind"] = TargetKindName(hit.TargetKind),
            ["cell"] = hit.HasCell ? new JArray(hit.CellKey.X, hit.CellKey.Y, hit.CellKey.Z) : null,
            ["place"] = hit.HasCell
                ? new JArray(hit.Cell.PlaceX, hit.Cell.PlaceY, hit.Cell.PlaceZ)
                : hit.HasWorkPlane
                    ? new JArray(hit.WorkPlane.PlaceX, hit.WorkPlane.PlaceY, hit.WorkPlane.PlaceZ)
                    : null,
            ["plane"] = hit.HasWorkPlane ? new JArray(hit.WorkPlane.X, hit.WorkPlane.Y, hit.WorkPlane.Z) : null,
            ["solid"] = hit.HasCell && hit.Cell.Solid,
            ["moduleId"] = hit.TargetKind == StationSceneTargetKind.Module ? hit.Module.Id : "",
            ["moduleType"] = hit.TargetKind == StationSceneTargetKind.Module ? hit.Module.Type : "",
            ["level"] = hit.Level,
        };
    }

    /// <summary>
    /// `pointer.*` and `edit.*` command handler. Pointer events are session-scoped (no
    /// `expectedRevision`) but carry the revision they were aimed at, which the router
    /// checks; a commit they cause bumps the revision once through the ordinary
    /// transaction, and the outer router answers with the commit envelope.
    /// </summary>
    public sealed class StationEditCommandHandler : IStationCommandHandler {
        public string Capability => "edit";

        public bool Handles(string type) =>
            type != null && (type.StartsWith("pointer.", StringComparison.Ordinal) ||
                             type.StartsWith("edit.", StringComparison.Ordinal));

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectCode = null;
            rejectReason = null;
            var host = StationEditHost.Host;
            if (host == null) { rejectCode = "no-session"; rejectReason = "No station host is in the scene."; return false; }
            if (command.Type.StartsWith("pointer.", StringComparison.Ordinal)) {
                return StationPointerRouter.Handle(host, command.Type, payload, payload, out rejectCode, out rejectReason, command.Id);
            }
            switch (command.Type) {
                case "edit.select": {
                    string id = String(payload, "moduleId");
                    if (id.Length == 0) { StationEditSession.ClearSelection(); return true; }
                    if (!host.IsLoaded || !host.Index.TryGetModule(id, out var module)) { rejectCode = "not-found"; return false; }
                    StationEditSession.SelectModule(module);
                    StationEditHost.Ensure().Preview?.Select(module);
                    return true;
                }
                case "edit.exit": {
                    string id = String(payload, "moduleId");
                    if (id.Length == 0) { rejectCode = "bad-payload"; rejectReason = "edit.exit needs payload.moduleId."; return false; }
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    bool hasName = payload["name"] != null && payload["name"].Type == JTokenType.String;
                    string name = hasName ? (string)payload["name"] : "";
                    bool hasInRate = payload["inRate"] != null &&
                        (payload["inRate"].Type == JTokenType.Integer || payload["inRate"].Type == JTokenType.Float);
                    double inRate = hasInRate ? (double)payload["inRate"] : 0;
                    bool hasOpen = payload["open"] != null && payload["open"].Type == JTokenType.Boolean;
                    bool open = hasOpen && (bool)payload["open"];
                    if (!hasName && !hasInRate && !hasOpen) {
                        rejectCode = "bad-payload";
                        rejectReason = "edit.exit needs at least one of name, inRate, or open.";
                        return false;
                    }
                    if (!StationEditSession.TryApplyExitSettings(host, id, hasName, name, hasInRate, inRate,
                        hasOpen, open, command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.city": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string city = String(payload, "city");
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanCity(beforeRead, city, host.CurrentSourceId, out rejectCode);
                    if (rejectCode == "no-change") return true;
                    if (local == null) { rejectReason = "Unsupported city style."; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "city", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.rename": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string name = String(payload, "name");
                    bool hasNameEn = payload["nameEn"] != null && payload["nameEn"].Type == JTokenType.String;
                    string nameEn = hasNameEn ? (string)payload["nameEn"] : "";
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanRename(beforeRead, name, nameEn, hasNameEn, host.CurrentSourceId, out rejectCode);
                    if (rejectCode == "no-change") return true;
                    if (local == null) { rejectReason = "Station name cannot be blank."; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "rename", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.line.add": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string dir = String(payload, "direction");
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanAddLine(beforeRead, dir, host.CurrentSourceId, out var addedLine, out rejectCode);
                    if (local == null) { rejectReason = rejectCode; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "line-add", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    if (addedLine != null) payload["lineId"] = addedLine.Id;
                    return true;
                }
                case "edit.line.remove": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string lineId = String(payload, "lineId");
                    var beforeRead = host.Coordinator.CommittedRead;
                    if (!StationHostEdits.TryPlanRemoveLine(beforeRead, lineId, host.CurrentSourceId,
                        out var local, out var fullEnvelope, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    bool ok = local != null
                        ? StationEditSession.TryApplyLocalRead(host, local, beforeRead, "line-remove", command.Id, out _, out rejectCode)
                        : StationEditSession.TryApplyPatch(host, fullEnvelope, "line-remove", command.Id, out _, out rejectCode);
                    if (!ok) { rejectReason = rejectCode; return false; }
                    return true;
                }
                case "edit.line.update": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string lineId = String(payload, "lineId");
                    var patch = payload["patch"] as JObject ?? payload;
                    var beforeRead = host.Coordinator.CommittedRead;
                    if (!StationHostEdits.TryPlanUpdateLine(beforeRead, lineId, patch, host.CurrentSourceId,
                        out var local, out var fullEnvelope, out rejectCode)) {
                        if (rejectCode == "no-change") return true;
                        rejectReason = rejectCode == "rail-overlap" ? "Resized track overlaps another rail." : rejectCode;
                        return false;
                    }
                    bool ok = local != null
                        ? StationEditSession.TryApplyLocalRead(host, local, beforeRead, "line-update", command.Id, out _, out rejectCode)
                        : StationEditSession.TryApplyPatch(host, fullEnvelope, "line-update", command.Id, out _, out rejectCode);
                    if (!ok) { rejectReason = rejectCode; return false; }
                    return true;
                }
                case "edit.lift.doors": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string id = String(payload, "moduleId");
                    int z = Int(payload, "z", 0);
                    string side = String(payload, "side");
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanLiftDoorSide(beforeRead, id, z, side, host.CurrentSourceId, out rejectCode);
                    if (rejectCode == "no-change") return true;
                    if (local == null) { rejectReason = rejectCode; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "lift-doors", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.run.reverse": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string id = String(payload, "moduleId");
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanSwitchRunDirection(beforeRead, id, host.CurrentSourceId, out rejectCode);
                    if (local == null) { rejectReason = rejectCode; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "run-reverse", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.road.reverse": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string id = String(payload, "moduleId");
                    var beforeRead = host.Coordinator.CommittedRead;
                    var local = StationHostEdits.TryPlanSwitchRoadDirection(beforeRead, id, host.CurrentSourceId, out rejectCode);
                    if (local == null) { rejectReason = rejectCode; return false; }
                    if (!StationEditSession.TryApplyLocalRead(host, local, beforeRead, "road-reverse", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.rail.regen": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    string trackId = String(payload, "trackId");
                    var fullEnvelope = StationHostEdits.TryPlanRegenRail(host.Coordinator.CommittedRead, trackId, out rejectCode);
                    if (fullEnvelope == null) { rejectReason = rejectCode; return false; }
                    if (!StationEditSession.TryApplyPatch(host, fullEnvelope, "rail-regen", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    return true;
                }
                case "edit.cancel":
                    // Escape is the keyboard half of the chord cancel (plan 29 §2): the same one
                    // cancellation drops every active tool gesture, the carried piece, both ghost
                    // layers and the badge, with zero picks and zero revisions.
                    payload["cancelled"] = StationPointerRouter.CancelActiveGesture(host, StationEditHost.Ensure());
                    host.PublishStateNow();
                    return true;
                case "edit.rotate": {
                    if (!StationEditSession.HasCarried) { rejectCode = "no-draft"; rejectReason = "No piece is being moved."; return false; }
                    StationPointerRouter.RotateCarried(host, Int(payload, "delta", 1));
                    // A rotation is a setting change under a still pointer: redraw in place rather
                    // than waiting for the next move (`MoveController` / `equipment.rotate`).
                    StationPointerRouter.RefreshHover(host);
                    host.PublishStateNow();
                    return true;
                }
                case "edit.move.lightPosition": {
                    if (!host.IsLoaded || !host.Index.TryGetModule(StationEditSession.CarriedId, out var light) ||
                        light.Type != "light" || light.Config.Text("variant") != "rectangular") return true;
                    int position = StationEditSession.CarriedLightPosition ?? light.Config.Int("position", 0);
                    StationEditSession.CarriedLightPosition = ((position % 9) + 10) % 9;
                    StationPointerRouter.RefreshHover(host);
                    host.PublishStateNow();
                    return true;
                }
                case "edit.move.start": {
                    string id = String(payload, "moduleId");
                    if (!host.IsLoaded || !host.Index.TryGetModule(id, out var module)) { rejectCode = "not-found"; return false; }
                    StationEditSession.SetCarried(module);
                    StationEditSession.Plan = null;
                    StationEditSession.MoveReason = "";
                    StationEditSession.SelectModule(module);
                    StationPointerRouter.LiftAtSource(host, StationEditHost.Ensure(), module);
                    host.PublishStateNow();
                    return true;
                }
                case "edit.move.cancel":
                    StationPointerRouter.CancelMove(host, StationEditHost.Ensure());
                    host.PublishStateNow();
                    return true;
                case "edit.move.confirm":
                    return StationPointerRouter.ConfirmMove(host, payload, out rejectCode, out rejectReason);
                case "edit.undo": {
                    if (!StationEditSession.TryUndo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationCellTool.Cancel();
                    StationEditHost.Ensure().Bind(host);
                    host.RequestHoverRefresh();
                    return true;
                }
                case "edit.redo": {
                    if (!StationEditSession.TryRedo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationCellTool.Cancel();
                    StationEditHost.Ensure().Bind(host);
                    host.RequestHoverRefresh();
                    return true;
                }
                case "edit.delete": {
                    string id = String(payload, "moduleId");
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    if (id.Length > 0) {
                        if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, id, "delete", command.Id, out _, out rejectCode)) {
                            rejectReason = rejectCode;
                            return false;
                        }
                        StationEditSession.ClearSelection();
                        return true;
                    }
                    // Keyboard selection removes one block. Pointer teardown can remove a wall column.
                    var cellToken = payload["cell"] as JArray;
                    if (cellToken == null || cellToken.Count < 3) {
                        rejectCode = "bad-payload";
                        rejectReason = "edit.delete needs payload.moduleId or payload.cell [x, y, z].";
                        return false;
                    }
                    var world = StationCellTool.World(host);
                    if (world == null) { rejectCode = "no-session"; return false; }
                    var cell = new StationCellKey((int)cellToken[0], (int)cellToken[1], (int)cellToken[2]);
                    var cells = new List<StationCellKey> { cell };
                    if (payload.Value<bool?>("singleCell") != true) {
                        var columns = StationCellPlanner.WallColumnsAt(world, cells);
                        if (columns.Count > 0) cells = columns;
                    }
                    var patch = StationCellPlanner.PlanRemoveCells(world, cells);
                    if (!patch.HasWork && patch.RemoveModuleIds.Count == 0) {
                        rejectCode = "nothing-to-delete";
                        rejectReason = "No block stands in that cell.";
                        return false;
                    }
                    if (!StationEditSession.TryApplyCells(host, patch, "delete", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    StationCellTool.World(host);
                    StationCellTool.Cancel();
                    StationEditHost.Ensure().Bind(host);
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.probe": {
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    int picksBefore = StationScenePicker.PickCount;
                    bool ok = TryProbe(host, payload, out var probe, out rejectCode);
                    // Probes are verifier/diagnostic queries, not routed pointer events.
                    _ = picksBefore;
                    if (!ok) return false;
                    if (payload["probeId"] != null) probe["probeId"] = payload["probeId"].DeepClone();
                    StationEditSession.Probe = (JObject)probe.DeepClone();
                    payload["probe"] = probe;
                    return true;
                }
                default:
                    rejectCode = "unsupported-command";
                    return false;
            }
        }

        static string String(JObject payload, string key) {
            var token = payload[key];
            return token != null && token.Type == JTokenType.String ? (string)token : "";
        }

        static int Int(JObject payload, string key, int fallback) {
            var token = payload[key];
            return token != null && (token.Type == JTokenType.Integer || token.Type == JTokenType.Float)
                ? (int)token : fallback;
        }

        static readonly Vector2[] ProbeOffsets = {
            new Vector2(0f, 0f),
            new Vector2(0f, -8f), new Vector2(0f, 8f), new Vector2(-8f, 0f), new Vector2(8f, 0f),
            new Vector2(0f, -18f), new Vector2(0f, 18f), new Vector2(-18f, 0f), new Vector2(18f, 0f),
            new Vector2(-12f, -12f), new Vector2(12f, 12f), new Vector2(-12f, 12f), new Vector2(12f, -12f),
            new Vector2(0f, -26f), new Vector2(0f, 26f), new Vector2(-26f, 0f), new Vector2(26f, 0f),
            new Vector2(-20f, -20f), new Vector2(20f, 20f), new Vector2(-20f, 20f), new Vector2(20f, -20f),
        };

        /// <summary>
        /// `edit.probe { kind: "place" | "refused" | "module" | "cell" | "empty" | "inspect", ... }`.
        /// Projects candidate document points through the live camera and keeps the first one
        /// the scene picker resolves back to that target under the rig's active visibility.
        /// </summary>
        static bool TryProbe(StationGameHost host, JObject payload, out JObject probe, out string code) {
            probe = null;
            code = null;
            StationEditScene.ResolveView(host, out _, out var camera, out var level, out var visibility);
            var world = host.Coordinator?.World;
            if (camera == null || world == null) { code = "no-camera"; return false; }
            string kind = String(payload, "kind");

            if (kind == "coord") {
                var cellArr = payload["cell"] as JArray;
                if (cellArr == null || cellArr.Count < 3) { code = "bad-payload"; return false; }
                int cx = (int)cellArr[0], cy = (int)cellArr[1], cz = (int)cellArr[2];
                var wantedKey = new StationCellKey(cx, cy, cz);
                bool doFocus = payload["focus"] != null && payload["focus"].Type == JTokenType.Boolean && (bool)payload["focus"];
                float focusDist = payload["distance"] != null && (payload["distance"].Type == JTokenType.Float || payload["distance"].Type == JTokenType.Integer)
                    ? (float)payload["distance"] : 26f;
                bool aimSolidBody = payload["solidCenter"] != null && payload["solidCenter"].Type == JTokenType.Boolean && (bool)payload["solidCenter"];
                bool exactCell = payload["exactCell"] != null && payload["exactCell"].Type == JTokenType.Boolean && (bool)payload["exactCell"];
                float w = Mathf.Max(1f, Screen.width), h = Mathf.Max(1f, Screen.height);
                var worldPts = aimSolidBody
                    ? new[] { StationCoordinates.FloorTop(cx, cy, cz), StationCoordinates.Point(new Vector3(cx + 0.5f, cy + 0.5f, cz + 0.5f)) }
                    : new[] { StationCoordinates.FloorTop(cx, cy, cz) };

                JObject TryMatchCurrentCamera(bool requireHorizontalMargin) {
                    foreach (var wPt in worldPts) {
                        var bScreen = Project(camera, wPt);
                        if (bScreen.z <= 0f) continue;
                        foreach (var off in ProbeOffsets) {
                            var scr = new Vector2(bScreen.x + off.x, bScreen.y + off.y);
                            float uCand = scr.x / w;
                            float vCand = 1f - scr.y / h;
                            // Keep probe pixels strictly inside the central viewport stage (clear of left/right
                            // side rails and any 352px tutorial card at left=24) on both WebGL and Desktop WebView2:
                            if (uCand < 0.30f || uCand > 0.75f || vCand < 0.14f || vCand > 0.85f) continue;
                            var hit = StationScenePicker.Pick(world, camera, scr, level, visibility, null, !exactCell);
                            var anchor = StationCellTool.CellAnchorFor(hit, exactCell, !exactCell);
                            if (!anchor.HasValue || anchor.Value != wantedKey) continue;
                            if (requireHorizontalMargin) {
                                var hitL = StationScenePicker.Pick(world, camera, new Vector2(scr.x - 3.5f, scr.y), level, visibility, null, !exactCell);
                                var hitR = StationScenePicker.Pick(world, camera, new Vector2(scr.x + 3.5f, scr.y), level, visibility, null, !exactCell);
                                var ancL = StationCellTool.CellAnchorFor(hitL, exactCell, !exactCell);
                                var ancR = StationCellTool.CellAnchorFor(hitR, exactCell, !exactCell);
                                if (ancL != wantedKey || ancR != wantedKey) continue;
                            }
                            return new JObject {
                                ["kind"] = "coord",
                                ["target"] = new JArray(cx, cy, cz),
                                ["x"] = cx, ["y"] = cy, ["z"] = cz,
                                ["u"] = uCand,
                                ["v"] = vCand,
                                ["hit"] = hit.ToString(),
                            };
                        }
                    }
                    return null;
                }

                if (doFocus && StationViewFeature.Active?.Commands?.Camera != null) {
                    var camCtrl = StationViewFeature.Active.Commands.Camera;
                    var docTarget = new Vector3(cx + 0.5f, cy + 0.5f, cz + 0.8f);
                    var curDir = camCtrl.State.Position - camCtrl.State.Target;
                    if (curDir.sqrMagnitude < 1e-4f) curDir = new Vector3(-0.58f, -0.58f, 0.57f);
                    Vector3[] candidateDirs = {
                        curDir.normalized,
                        new Vector3(-0.58f, -0.58f, 0.57f).normalized,
                        new Vector3(0.58f, -0.58f, 0.57f).normalized,
                        new Vector3(0.58f, 0.58f, 0.57f).normalized,
                        new Vector3(-0.58f, 0.58f, 0.57f).normalized,
                        new Vector3(-0.30f, -0.30f, 0.91f).normalized,
                        new Vector3(0.30f, -0.30f, 0.91f).normalized,
                        new Vector3(0.30f, 0.30f, 0.91f).normalized,
                        new Vector3(-0.30f, 0.30f, 0.91f).normalized,
                        new Vector3(0f, -0.10f, 0.995f).normalized,
                    };
                    foreach (bool margin in new[] { !exactCell, false }) {
                        foreach (var dir in candidateDirs) {
                            camCtrl.State.Projection = StationProjection.Perspective;
                            camCtrl.State.Target = docTarget;
                            camCtrl.State.Position = docTarget + dir * Mathf.Max(8f, focusDist);
                            StationViewFeature.Active.Commands.Camera.SetFov(camCtrl.State.Fov);
                            StationViewFeature.Active.Commands.ApplyCamera();
                            StationEditScene.ResolveView(host, out _, out camera, out level, out visibility);
                            var matched = TryMatchCurrentCamera(margin);
                            if (matched != null) {
                                probe = matched;
                                return true;
                            }
                        }
                        if (exactCell) break;
                    }
                } else {
                    if (!exactCell) {
                        var matchedMargin = TryMatchCurrentCamera(true);
                        if (matchedMargin != null) { probe = matchedMargin; return true; }
                    }
                    var matched = TryMatchCurrentCamera(false);
                    if (matched != null) { probe = matched; return true; }
                }

                var baseScreen = Project(camera, worldPts[0]);
                if (baseScreen.z <= 0f) { code = "behind-camera"; return false; }
                probe = new JObject {
                    ["kind"] = "coord",
                    ["target"] = new JArray(cx, cy, cz),
                    ["x"] = cx, ["y"] = cy, ["z"] = cz,
                    ["u"] = Mathf.Clamp(baseScreen.x / w, 0.22f, 0.76f),
                    ["v"] = Mathf.Clamp(1f - baseScreen.y / h, 0.12f, 0.86f),
                    ["fallbackProjection"] = true,
                };
                return true;
            }

            if (kind == "inspect") {
                string id = String(payload, "moduleId");
                int records = 0, active = 0, renderers = 0, enabled = 0, levelMin = 0, levelMax = 0;
                bool hasBounds = false;
                StationBox measured = default;
                bool haveMeasured = false;
                host.Index.TryGetModule(id, out var module);
                foreach (var record in world.Records) {
                    int batchIndex = record.SourceIds != null ? Array.IndexOf(record.SourceIds, id) : -1;
                    if (!string.Equals(record.ModuleId, id, StringComparison.Ordinal) && batchIndex < 0) continue;
                    records++;
                    levelMin = record.LevelMin; levelMax = record.LevelMax;
                    if (record.View != null && record.View.activeInHierarchy) active++;
                    if (batchIndex >= 0 && record.SourceBounds != null && batchIndex < record.SourceBounds.Length &&
                        !record.SourceBounds[batchIndex].IsEmpty) {
                        hasBounds = true; measured = record.SourceBounds[batchIndex]; haveMeasured = true;
                    } else if (record.HasBounds && !record.Bounds.IsEmpty) {
                        hasBounds = true; measured = record.Bounds; haveMeasured = true;
                    }
                    if (record.View != null) {
                        foreach (var renderer in record.View.GetComponentsInChildren<Renderer>(true)) {
                            renderers++;
                            if (renderer != null && renderer.enabled) enabled++;
                        }
                        if (!haveMeasured && TryMeasureEnabledRenderers(record.View, out var rendBox)) {
                            measured = rendBox;
                            haveMeasured = true;
                        }
                    }
                }
                probe = new JObject {
                    ["kind"] = "inspect",
                    ["moduleId"] = id,
                    ["moduleInDocument"] = module != null,
                    ["records"] = records,
                    ["active"] = active,
                    ["hasBounds"] = hasBounds,
                    ["renderers"] = renderers,
                    ["enabled"] = enabled,
                    ["levelMin"] = levelMin,
                    ["levelMax"] = levelMax,
                    ["level"] = level,
                };
                if (module != null && haveMeasured) {
                    probe["box"] = new JArray(Math.Round(measured.X0, 3), Math.Round(measured.Y0, 3), Math.Round(measured.Z0, 3),
                        Math.Round(measured.X1, 3), Math.Round(measured.Y1, 3), Math.Round(measured.Z1, 3));
                    var floorPixel = Project(camera, StationCoordinates.FloorTop(module.X, module.Y, module.Z));
                    var cx = (measured.X0 + measured.X1) / 2;
                    var cy = (measured.Y0 + measured.Y1) / 2;
                    var cz = (measured.Z0 + measured.Z1) / 2;
                    var boxPixel = Project(camera, StationCoordinates.Point(new Vector3((float)cx, (float)cy, (float)cz)));
                    // Prefer an exact triangle hit on this module around its rendered probe points so
                    // `boxUv` never lands in a gap between bench legs/backrests.
                    if (TryFindModulePixel(world, camera, level, visibility, module, out var exactScreen, out var exactHit)) {
                        boxPixel = exactScreen;
                    }
                    probe["floorUv"] = new JArray(floorPixel.x / Mathf.Max(1f, Screen.width), 1f - floorPixel.y / Mathf.Max(1f, Screen.height));
                    probe["boxUv"] = new JArray(boxPixel.x / Mathf.Max(1f, Screen.width), 1f - boxPixel.y / Mathf.Max(1f, Screen.height));
                    var floorHit = StationScenePicker.Pick(world, camera, floorPixel, level, visibility, null, false);
                    var boxHit = exactHit ?? StationScenePicker.Pick(world, camera, boxPixel, level, visibility, null, false);
                    probe["floorHit"] = floorHit != null ? floorHit.ToString() : "none";
                    probe["boxHit"] = boxHit != null ? boxHit.ToString() : "none";
                }
                return true;
            }

            if (kind == "module") {
                string type = String(payload, "moduleType");
                string moduleId = String(payload, "moduleId");
                bool filterZ = payload["z"] != null &&
                               (payload["z"].Type == JTokenType.Integer || payload["z"].Type == JTokenType.Float);
                int targetZ = filterZ ? Int(payload, "z", level) : 0;
                foreach (var module in host.Index.Document.Modules) {
                    if (moduleId.Length > 0 && !string.Equals(module.Id, moduleId, StringComparison.Ordinal)) continue;
                    if (type.Length > 0 && !string.Equals(module.Type, type, StringComparison.Ordinal)) continue;
                    if (filterZ && module.Z != targetZ) continue;
                    if (!TryFindModulePixel(world, camera, level, visibility, module, out var screen, out var hit)) continue;
                    probe = new JObject {
                        ["kind"] = "module",
                        ["targetKind"] = "module",
                        ["moduleId"] = module.Id,
                        ["moduleType"] = module.Type,
                        ["x"] = module.X, ["y"] = module.Y, ["z"] = module.Z,
                        ["u"] = screen.x / Mathf.Max(1f, Screen.width),
                        ["v"] = 1f - screen.y / Mathf.Max(1f, Screen.height),
                        ["point"] = new JArray(Math.Round(hit.ModulePoint.X, 3), Math.Round(hit.ModulePoint.Y, 3), Math.Round(hit.ModulePoint.Z, 3)),
                    };
                    return true;
                }
                code = "no-probe";
                return false;
            }

            if (kind == "block" || kind == "grade") {
                // The block brush's own probe (plan 27 §1): the pixel where its ghost draws an
                // **accepted** cell (`block`), or where it correctly draws nothing because the
                // street already is the floor (`grade`). A placement probe cannot answer this:
                // 方块 is not a catalogue family, so `StationModulePlacement.Resolve` has no
                // candidate to project.
                int targetZ = payload["z"] != null ? Int(payload, "z", level) : level;
                var cellWorld = StationCellTool.World(host);
                if (cellWorld == null) { code = "no-session"; return false; }
                // A probe answers one pixel, not the best one: each candidate costs a full
                // triangle pick over the visible station, and a scan of every pavement cell on a
                // 14 k-cell demo blocked the player long enough for the browser's own evaluate
                // call to time out. The first match wins.
                JObject blockMatch = null;
                float blockWidth = Mathf.Max(1f, Screen.width), blockHeight = Mathf.Max(1f, Screen.height);
                var candidates = new List<Vector2>();
                if (kind == "block") {
                    // Walk out from the middle of the viewport so the pixel stays central.
                    foreach (var cell in host.Index.Document.Cells) {
                        if (!cell.IsSolid || cell.Z != targetZ) continue;
                        var screen = Project(camera, StationCoordinates.FloorTop(cell.X, cell.Y, cell.Z));
                        if (screen.z <= 0f) continue;
                        if (screen.x <= blockWidth * 0.25f || screen.x >= blockWidth * 0.75f) continue;
                        if (screen.y <= blockHeight * 0.28f || screen.y >= blockHeight * 0.72f) continue;
                        candidates.Add(new Vector2(screen.x, screen.y));
                    }
                    candidates.Sort((a, b) =>
                        Score(a, blockWidth, blockHeight).CompareTo(Score(b, blockWidth, blockHeight)));
                    // Each candidate costs a full triangle pick over the visible station, and a
                    // large demo can offer thousands in the central band. Keep the best-scoring
                    // few and sample the rest evenly: a valid cell can sit well away from the
                    // middle in a dense station, and a centre-only scan misses it.
                    CapProbeCandidates(candidates, ProbeBudgetFor(host.Index?.Document?.Cells?.Count ?? 0));
                } else {
                    // The untouched street is easiest to find outside the built station, so the
                    // grade scan covers the whole viewport rather than the central band.
                    for (int gy = 1; gy <= 9; gy++)
                        for (int gx = 1; gx <= 9; gx++)
                            candidates.Add(new Vector2(gx / 10f * blockWidth, gy / 10f * blockHeight));
                }
                foreach (var screen in candidates) {
                    if (screen.x <= 1f || screen.x >= blockWidth - 1f || screen.y <= 1f || screen.y >= blockHeight - 1f) {
                        continue;
                    }
                    var hit = StationScenePicker.Pick(world, camera, screen, level, visibility, null, false);
                    if (hit == null || !hit.HasCell) continue;
                    var anchor = hit.Cell.Solid
                        ? new StationCellKey(hit.Cell.PlaceX, hit.Cell.PlaceY, hit.Cell.PlaceZ)
                        : new StationCellKey(hit.Cell.X, hit.Cell.Y, hit.Cell.Z);
                    if (kind == "grade") {
                        // The untouched virtual street: a surface the picker reports as a cell,
                        // which the plan says is already floor and must never be built on. A
                        // module standing on it is not the street, so the pick must be the cell
                        // surface itself.
                        if (hit.TargetKind != StationSceneTargetKind.Cell) continue;
                        if (hit.Cell.Z != StationFootprints.GroundZ) continue;
                        if (!cellWorld.IsGround(hit.Cell.X, hit.Cell.Y, hit.Cell.Z)) continue;
                    }
                    var check = StationCellPlanner.CheckBlockCells(cellWorld, new[] { anchor });
                    bool matches = kind == "block"
                        ? check.Accepted.Count == 1 && check.Blocked.Count == 0
                        : check.Accepted.Count == 0 && check.Ignored.Count == 1;
                    if (!matches) continue;
                    float u = screen.x / blockWidth, v = 1f - screen.y / blockHeight;
                    blockMatch = new JObject {
                        ["kind"] = kind,
                        ["targetKind"] = "cell",
                        ["x"] = anchor.X, ["y"] = anchor.Y, ["z"] = anchor.Z,
                        ["cell"] = new JArray(hit.Cell.X, hit.Cell.Y, hit.Cell.Z),
                        ["u"] = u, ["v"] = v,
                        ["accepted"] = check.Accepted.Count,
                        ["ignored"] = check.Ignored.Count,
                        ["blocked"] = check.Blocked.Count,
                    };
                    break;
                }
                if (blockMatch != null) { probe = blockMatch; return true; }
                code = "no-probe";
                return false;
            }

            if (kind == "zone") {
                // The 分区 brush's own probe: the pixel over a **floor** cell the brush would
                // label, so a packed-player case can click a known label target instead of
                // guessing at a wall coping or a ceiling plate.
                int zoneZ = payload["z"] != null ? Int(payload, "z", level) : level;
                var zoneWorld = StationZoneTool.World(host);
                if (zoneWorld == null) { code = "no-session"; return false; }
                float zoneWidth = Mathf.Max(1f, Screen.width), zoneHeight = Mathf.Max(1f, Screen.height);
                var zoneCandidates = new List<Vector2>();
                foreach (var cell in host.Index.Document.Cells) {
                    if (!cell.IsSolid || cell.Z != zoneZ) continue;
                    var screen = Project(camera, StationCoordinates.FloorTop(cell.X, cell.Y, cell.Z));
                    if (screen.z <= 0f) continue;
                    if (screen.x <= zoneWidth * 0.25f || screen.x >= zoneWidth * 0.75f) continue;
                    if (screen.y <= zoneHeight * 0.28f || screen.y >= zoneHeight * 0.72f) continue;
                    zoneCandidates.Add(new Vector2(screen.x, screen.y));
                }
                zoneCandidates.Sort((a, b) =>
                    Score(a, zoneWidth, zoneHeight).CompareTo(Score(b, zoneWidth, zoneHeight)));
                if (zoneCandidates.Count > ProbeBudgetFor(host.Index?.Document?.Cells?.Count ?? 0))
                    CapProbeCandidates(zoneCandidates, ProbeBudgetFor(host.Index?.Document?.Cells?.Count ?? 0));
                foreach (var screen in zoneCandidates) {
                    if (screen.x <= 1f || screen.x >= zoneWidth - 1f || screen.y <= 1f || screen.y >= zoneHeight - 1f) {
                        continue;
                    }
                    var hit = StationScenePicker.Pick(world, camera, screen, level, visibility, null, false);
                    if (hit == null || !hit.HasCell) continue;
                    var floorCell = hit.CellKey;
                    if (!zoneWorld.IsFloor(floorCell)) continue;
                    probe = new JObject {
                        ["kind"] = "zone",
                        ["targetKind"] = "cell",
                        ["x"] = floorCell.X, ["y"] = floorCell.Y, ["z"] = floorCell.Z,
                        ["cell"] = new JArray(floorCell.X, floorCell.Y, floorCell.Z),
                        ["u"] = screen.x / zoneWidth, ["v"] = 1f - screen.y / zoneHeight,
                    };
                    return true;
                }
                code = "no-probe";
                return false;
            }

            if (kind == "cell") {
                int targetZ = payload["z"] != null ? Int(payload, "z", level) : level;
                JObject bestCell = null;
                float bestCellScore = float.MaxValue;
                foreach (var cell in host.Index.Document.Cells) {
                    if (!cell.IsSolid || cell.Z != targetZ) continue;
                    var screen = Project(camera, StationCoordinates.FloorTop(cell.X, cell.Y, cell.Z));
                    if (!OnScreen(screen)) continue;
                    var hit = StationScenePicker.Pick(world, camera, screen, level, visibility, null, false);
                    if (hit == null || hit.TargetKind != StationSceneTargetKind.Cell || hit.CellKey.Z != targetZ) continue;
                    float u = screen.x / Mathf.Max(1f, Screen.width);
                    float v = 1f - screen.y / Mathf.Max(1f, Screen.height);
                    float score = Mathf.Abs(u - 0.5f) + Mathf.Abs(v - 0.5f);
                    if (score >= bestCellScore) continue;
                    bestCellScore = score;
                    bestCell = new JObject {
                        ["kind"] = "cell",
                        ["targetKind"] = "cell",
                        ["x"] = hit.CellKey.X, ["y"] = hit.CellKey.Y, ["z"] = hit.CellKey.Z,
                        ["u"] = u, ["v"] = v,
                    };
                }
                if (bestCell != null) { probe = bestCell; return true; }
                code = "no-probe";
                return false;
            }

            if (kind == "empty") {
                float w = Mathf.Max(1f, Screen.width), h = Mathf.Max(1f, Screen.height);
                for (int gy = 2; gy <= 8; gy++) {
                    for (int gx = 2; gx <= 8; gx++) {
                        float u = gx * 0.1f, v = gy * 0.1f;
                        if (u < 0.26f || u > 0.74f || v < 0.29f || v > 0.71f) continue;
                        var screen = new Vector2(u * w, (1f - v) * h);
                        var hit = StationScenePicker.Pick(world, camera, screen, level, visibility, null, true);
                        if (hit == null || (hit.TargetKind != StationSceneTargetKind.Plane && hit.TargetKind != StationSceneTargetKind.None))
                            continue;
                        probe = new JObject {
                            ["kind"] = "empty",
                            ["targetKind"] = hit.TargetKind == StationSceneTargetKind.Plane ? "plane" : "none",
                            ["u"] = u, ["v"] = v,
                            ["plane"] = hit.HasWorkPlane ? new JArray(hit.WorkPlane.X, hit.WorkPlane.Y, hit.WorkPlane.Z) : null,
                        };
                        return true;
                    }
                }
                code = "no-probe";
                return false;
            }

            string toolType = String(payload, "toolType");
            string variant = String(payload, "variant");
            int width = Int(payload, "width", 0);
            string lineId = String(payload, "lineId");
            int curtainHeight = Int(payload, "curtainHeight", 4);
            int rotation = Int(payload, "rotation", 0);
            var carried = kind == "refused" && StationEditSession.HasCarried &&
                          host.Index.TryGetModule(StationEditSession.CarriedId, out var carriedRecord)
                ? carriedRecord : null;
            int reqRotation = carried != null ? StationEditSession.CarriedRotation : rotation;
            string excludeId = StationEditSession.HasCarried ? StationEditSession.CarriedId : null;

            var candidateCells = new List<StationPoint>();
            foreach (var cell in host.Index.Document.Cells) {
                if (cell.IsSolid && cell.Z == level) candidateCells.Add(new StationPoint(cell.X, cell.Y, cell.Z));
            }
            if (candidateCells.Count == 0) {
                foreach (var module in host.Index.Document.Modules) {
                    if (module.Z == level) candidateCells.Add(new StationPoint(module.X, module.Y, module.Z));
                }
            }
            int stride = Mathf.Max(1, candidateCells.Count / 400);
            JObject bestProbe = null;
            float bestScore = float.MaxValue;
            for (int i = 0; i < candidateCells.Count; i += stride) {
                var cell = candidateCells[i];
                var screen = Project(camera, StationCoordinates.FloorTop((int)cell.X, (int)cell.Y, cell.Z));
                if (!OnScreen(screen)) continue;
                var ray = camera.ScreenPointToRay(screen);
                var pickContext = StationPickContext.FromCamera(camera, ray, visibility, excludeId, true);
                var hit = StationScenePicker.PickRay(world, ray, level, pickContext);
                if (kind != "refused" && hit.TargetKind == StationSceneTargetKind.Module &&
                    string.Equals(hit.Module.Type, "exit", StringComparison.Ordinal)) continue;

                var request = StationPointerRouter.BuildRequest(world, ray, pickContext, hit, carried,
                    reqRotation, toolType, variant, width, lineId, curtainHeight);
                if (!request.Hit.HasCell) continue;
                var plan = StationModulePlacement.Resolve(host.Index, request);
                if (plan.Candidate == null || plan.CellZ != level) continue;
                if (kind == "refused" ? plan.Ok : !plan.Ok) continue;

                float u = screen.x / Mathf.Max(1f, Screen.width);
                float v = 1f - screen.y / Mathf.Max(1f, Screen.height);
                float score = Mathf.Abs(u - 0.5f) + Mathf.Abs(v - 0.5f);
                if (score >= bestScore) continue;
                bestScore = score;
                bestProbe = new JObject {
                    ["kind"] = kind == "refused" ? "refused" : "place",
                    ["targetKind"] = hit.TargetKind == StationSceneTargetKind.Module ? "module"
                        : hit.TargetKind == StationSceneTargetKind.Cell ? "cell"
                        : hit.TargetKind == StationSceneTargetKind.Plane ? "plane"
                        : "none",
                    ["toolType"] = toolType,
                    ["x"] = plan.CellX, ["y"] = plan.CellY, ["z"] = plan.CellZ,
                    ["u"] = u,
                    ["v"] = v,
                    ["reason"] = plan.Reason ?? "",
                    ["plan"] = StationEditSession.PlanJson(plan),
                };
            }
            if (bestProbe != null) { probe = bestProbe; return true; }
            code = "no-probe";
            return false;
        }

        static bool TryFindModulePixel(StationWorldView world, Camera camera, int level,
            StationVisibilityRegistry visibility, StationModuleRecord module,
            out Vector3 screenOut, out StationSceneHit hitOut) {
            screenOut = default;
            hitOut = null;
            foreach (var point in ModuleProbePoints(world, module)) {
                var centre = Project(camera, StationCoordinates.Point(point));
                if (!OnScreen(centre)) continue;
                foreach (var offset in ProbeOffsets) {
                    var screen = centre + new Vector3(offset.x, offset.y, 0f);
                    var hit = StationScenePicker.Pick(world, camera, screen, level, visibility, null, false);
                    if (hit == null || hit.TargetKind != StationSceneTargetKind.Module ||
                        !string.Equals(hit.Module.Id, module.Id, StringComparison.Ordinal)) continue;
                    screenOut = screen;
                    hitOut = hit;
                    return true;
                }
            }
            return false;
        }

        static bool TryMeasureEnabledRenderers(GameObject view, out StationBox box) {
            box = default;
            var all = view.GetComponentsInChildren<Renderer>(true);
            var bounds = new Bounds();
            bool any = false;
            foreach (var renderer in all) {
                if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                if (!any) { bounds = renderer.bounds; any = true; }
                else bounds.Encapsulate(renderer.bounds);
            }
            if (!any) return false;
            var min = StationCoordinates.WorldToDocument(bounds.min);
            var max = StationCoordinates.WorldToDocument(bounds.max);
            box = new StationBox(
                Math.Min(min.x, max.x), Math.Min(min.y, max.y), Math.Min(min.z, max.z),
                Math.Max(min.x, max.x), Math.Max(min.y, max.y), Math.Max(min.z, max.z));
            return true;
        }

        static List<Vector3> ModuleProbePoints(StationWorldView world, StationModuleRecord module) {
            var points = new List<Vector3>(8);
            var bounds = new Bounds();
            bool any = false;
            if (world != null && module != null) {
                foreach (var record in world.Records) {
                    if (string.Equals(record.ModuleId, module.Id, StringComparison.Ordinal)) {
                        if (record.View == null) continue;
                        foreach (var renderer in record.View.GetComponentsInChildren<MeshRenderer>(true)) {
                            if (!renderer || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                            if (!any) { bounds = renderer.bounds; any = true; }
                            else bounds.Encapsulate(renderer.bounds);
                            var c = StationCoordinates.WorldToDocument(renderer.bounds.center);
                            if (points.Count < 4) points.Add(c);
                        }
                        continue;
                    }
                    int batchIndex = record.SourceIds != null ? Array.IndexOf(record.SourceIds, module.Id) : -1;
                    if (batchIndex >= 0 && record.SourceBounds != null && batchIndex < record.SourceBounds.Length &&
                        record.View != null && record.View.activeInHierarchy) {
                        var renderer = record.View.GetComponent<MeshRenderer>();
                        if (renderer != null && renderer.enabled) {
                            var b = record.SourceBounds[batchIndex];
                            points.Add(new Vector3(
                                (float)((b.X0 + b.X1) * 0.5),
                                (float)((b.Y0 + b.Y1) * 0.5),
                                (float)((b.Z0 + b.Z1) * 0.5)));
                        }
                    }
                }
            }
            if (any) {
                var min = StationCoordinates.WorldToDocument(bounds.min);
                var max = StationCoordinates.WorldToDocument(bounds.max);
                var centre = (min + max) * .5f;
                points.Insert(0, centre);
                points.Add(new Vector3(centre.x, centre.y, Mathf.Lerp(min.z, max.z, .35f)));
                points.Add(new Vector3(centre.x, centre.y, Mathf.Max(min.z + .01f, max.z - .02f)));
            }
            points.Add(new Vector3(module.X + .5f, module.Y + .5f, module.Z + 1f));
            return points;
        }

        static Vector3 Project(Camera camera, Vector3 worldPoint) => camera.WorldToScreenPoint(worldPoint);

        /// <summary>How many probe candidates may cost a scene pick.</summary>
        const int ProbeCandidateLimit = 192;
        /// <summary>
        /// The probe walk's budget for a document of this size. Every candidate costs a full
        /// triangle pick, and on a large station (动物园's neighbours run to five figures) 192 of
        /// them can hold the main thread long enough that the browser harness's own input
        /// dispatch times out — which is exactly what the Two heavy demos did. A big document
        /// therefore gets a smaller, still even sample: the probe only has to find **one** legal
        /// cell, not to survey the station.
        /// </summary>
        static int ProbeBudgetFor(int cellCount) {
            if (cellCount >= 20000) return 48;
            if (cellCount >= 8000) return 96;
            return ProbeCandidateLimit;
        }

        /// <summary>How many of the best-scoring candidates are always kept.</summary>
        const int ProbeCentralKeep = 64;

        /// <summary>
        /// Bound a probe's candidate list without losing the far side of a dense station: the
        /// central best-scoring few are kept and the rest are sampled evenly by score order, so
        /// a valid cell outside the middle is still reachable while the pick count stays bounded.
        /// </summary>
        static void CapProbeCandidates(List<Vector2> candidates, int limit = ProbeCandidateLimit) {
            if (candidates == null || candidates.Count <= limit) return;
            var keep = new List<Vector2>(limit);
            int central = Math.Min(ProbeCentralKeep, limit);
            for (int i = 0; i < central && i < candidates.Count; i++) keep.Add(candidates[i]);
            int remaining = limit - keep.Count;
            int tail = candidates.Count - central;
            if (remaining > 0 && tail > 0) {
                int stride = Math.Max(1, tail / remaining);
                for (int i = central; i < candidates.Count && keep.Count < limit; i += stride)
                    keep.Add(candidates[i]);
            }
            candidates.Clear();
            candidates.AddRange(keep);
        }

        /// <summary>A screen point's distance from the viewport centre, for a probe's ordering.</summary>
        static float Score(Vector2 screen, float width, float height) =>
            Mathf.Abs(screen.x / Mathf.Max(1f, width) - 0.5f) + Mathf.Abs(1f - screen.y / Mathf.Max(1f, height) - 0.5f);

        static bool OnScreen(Vector3 screen) {
            float width = Mathf.Max(1f, Screen.width), height = Mathf.Max(1f, Screen.height);
            return screen.z > 0f &&
                   screen.x > width * 0.25f && screen.x < width * 0.75f &&
                   screen.y > height * 0.28f && screen.y < height * 0.72f;
        }
    }

    /// <summary>
    /// Palette ids for the families whose creation the C# resolver already ports.
    /// </summary>
    public static class StationModulePick {
        public static string PaletteIdFor(StationModuleRecord module) {
            if (module == null) return "";
            switch (module.Type) {
                case "bench": return "bench-" + Fallback(module.Config.Text("variant"), "steel-1");
                case "fence":
                    switch (module.Config.Text("variant")) {
                        case "sound-barrier": return "noise-barrier";
                        case "sound-barrier-half": return "noise-barrier-half";
                        case "bridge-railing": return "noise-barrier-railing";
                        case "gate": return "fence-gate";
                        case "steel-blue": return "fence-steel-blue";
                        case "iron": return "fence-iron";
                        default: return "fence";
                    }
                case "tactile": return "tactile-" + Fallback(module.Config.Text("variant"), "guide");
                case "floor-mark": return "floor-mark-" + Fallback(module.Config.Text("variant"), "boarding");
                case "clock": return module.Config.Text("variant") == "digital" ? "clock-digital" : "clock";
                case "cctv": {
                    var variant = module.Config.Text("variant");
                    return variant == "post" ? "cctv-post" : variant == "ptz" ? "cctv-ptz" : variant == "dome" ? "cctv-dome" : "cctv";
                }
                case "monitor": return module.Config.Text("mount") == "wall" ? "monitor-wall" : "monitor-ceiling";
                case "light": return module.Config.Text("variant") == "rectangular" ? "light-rectangular" : "light-circular";
                case "gate": return module.Config.Text("variant") == "new" ? "gate-new" : "gate";
                case "cubicle": return module.Config.Text("variant") == "toilet" ? "cubicle-toilet" : "cubicle";
                case "court": return "court-" + Fallback(module.Config.Text("variant"), "pickleball");
                case "extinguisher": {
                    var variant = module.Config.Text("variant");
                    return variant == "compact" ? "extinguisher-compact" : variant == "glass" ? "extinguisher-glass" : "extinguisher";
                }
                case "tvm":
                case "vending":
                case "bin":
                case "desk":
                case "guidepost":
                case "urinal":
                case "sink":
                case "tv":
                case "vent":
                    return module.Type;
                default:
                    return "";
            }
        }

        static string Fallback(string value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value;
    }

    /// <summary>
    /// Process-wide registration: the pointer/edit handlers, the `edit` state contributor
    /// and the preview host.
    /// </summary>
    public static class StationEditFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => StationCommandHandlers.Add(new StationEditCommandHandler());

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Install() => Attach(UnityEngine.Object.FindAnyObjectByType<StationGameHost>());

        /// <summary>Test/entry point: bind the editor to one host.</summary>
        public static StationEditStateContributor Attach(StationGameHost host) {
            if (host == null) return null;
            var contributor = new StationEditStateContributor();
            host.RegisterStateContributor(contributor);
            host.RegisterCommandHandler(new StationEditCommandHandler());
            StationEditSession.Reset();
            StationScenePicker.Reset();
            return contributor;
        }
    }
}
