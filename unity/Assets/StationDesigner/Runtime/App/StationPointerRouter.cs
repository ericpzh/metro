using System;
using System.Collections.Generic;
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
            int button = 0, int modifiers = 0, double timeMs = -1, int pointerId = -1) {
            return new StationPointerEvent(x, y, width <= 0 ? 1f : width, height <= 0 ? 1f : height,
                button, modifiers, timeMs, pointerId, -1, -1, button == 0 ? 1 : 2);
        }

        StationPointerEvent(float x, float y, float width, float height, int button, int modifiers,
            double timeMs, int pointerId, int toolGeneration, int documentRevision, int buttons) {
            X = x; Y = y; Width = width; Height = height; Button = button; Modifiers = modifiers;
            TimeMs = timeMs; PointerId = pointerId; ToolGeneration = toolGeneration;
            DocumentRevision = documentRevision; Buttons = buttons;
        }

        public static bool TryDecode(JObject payload, out StationPointerEvent pointer, out string code) {
            pointer = default;
            code = null;
            if (payload == null) { code = "bad-payload"; return false; }
            var pointerEvent = new StationPointerEvent(payload);
            if (!(pointerEvent.Width > 0) || !(pointerEvent.Height > 0)) { code = "bad-payload"; return false; }
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
        /// as a fallback. A cell gesture takes its cells from a **visible surface** only — a
        /// work-plane hit is empty air, which is what the reference's `BlockTool` ignores —
        /// so it asks for none, and the placement tools keep theirs.
        /// </summary>
        static bool NeedsWorkPlane(string tool) =>
            StationEditSession.HasCarried || string.Equals(tool, "module", StringComparison.Ordinal);

        /// <summary>Handle one `pointer.*` command. Returns false only for an unusable event.</summary>
        public static bool Handle(StationGameHost host, string type, JObject payload, JObject reply, out string code, out string reason) {
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
                StationCellTool.Cancel();
                StationPaintTool.Cancel();
                StationZoneTool.Cancel();
                StationRailTool.Cancel();
                StationTunnelTool.Cancel();
                StationSurfaceTool.Cancel();
                CancelMove(host, editHost);
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (type == "pointer.leave") {
                // A leave with a press in flight is a gap in tracking, not a cancel: the
                // reference keeps the armed gesture (`pointerInput.ts` only reports a leave with
                // no captured pointer). A plain leave parks the ghost.
                if (!StationCellTool.HasGesture) {
                    StationCellTool.Leave();
                    StationPaintTool.Leave();
                    StationZoneTool.Leave();
                    StationRailTool.Leave();
                    StationTunnelTool.Leave();
                    StationSurfaceTool.Leave();
                    StationEditSession.ForgetPointer();
                    ClearPlan(host, editHost);
                }
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }

            if (!StationPointerEvent.TryDecode(payload, out var pointer, out code)) return false;
            StationEditSession.RememberPointer(pointer);

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

            var tool = StationToolSelection.Active;
            bool staleTool = pointer.ToolGeneration >= 0 && pointer.ToolGeneration != StationToolSelection.Generation;
            bool staleRevision = pointer.DocumentRevision >= 0 && pointer.DocumentRevision != host.CurrentRevision;
            if (type == "pointer.up") {
                // The release is dispatched to the **owner recorded at the press**, never to
                // whatever tool happens to be committed when it arrives (plan 27 §2). A tool
                // or revision change in between cancels the gesture instead of applying it.
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
                } else if (StationCellTool.HasGesture) {
                    if (staleTool || staleRevision) {
                        StationCellTool.Cancel();
                        reason = staleTool ? "stale-tool" : "stale-revision";
                    } else if (camera != null) {
                        var releaseHit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray,
                            activeLevel, visibility, false, out var releaseContext, out _);
                        committed = StationCellTool.Finish(host, releaseHit, pointer, out code, out reason);
                        if (committed) {
                            editHost.Bind(host);
                            AfterCommit(host, editHost, "");
                        } else if (code != null) {
                            reply["reason"] = reason ?? code;
                        }
                        _ = releaseContext;
                    }
                }
                if (IsCellTool(tool) && !committed) StationCellTool.Publish();
                if (StationPaintTool.HasGesture == false) StationPaintTool.Publish();
                if (StationZoneTool.HasGesture == false) StationZoneTool.Publish();
                if (StationSurfaceTool.HasGesture == false) StationSurfaceTool.Publish();
                if (camera != null) PopulateCellReply(host, reply, editHost);
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
                NeedsWorkPlane(tool), out var pickContext, out code);
            if (hit == null) return false;

            switch (type) {
                case "pointer.down":
                    Down(host, editHost, world, ray, pickContext, pointer, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.rightTap":
                    RightTap(host, editHost, pointer, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.move":
                    Move(host, editHost, world, ray, pickContext, pointer, tool, hit, reply, out code, out reason);
                    break;
            }

            StationEditSession.Trace(type, tool, hit, StationEditSession.Plan,
                revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
            reply["hit"] = HitJson(hit);
            reply["tool"] = tool;
            reply["toolGeneration"] = StationToolSelection.Generation;
            PopulateCellReply(host, reply, editHost);
            if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
            return true;
        }

        /// <summary>
        /// Append the cell tool's aimed preview to a reply so the shell can read the same
        /// verdict the player sees: accepted/refused cells, the generated ring, the footprint
        /// badge and whether the whole gesture is refused.
        /// </summary>
        static void PopulateCellReply(StationGameHost host, JObject reply, StationEditHost editHost) {
            if (reply == null) return;
            var preview = StationCellTool.Preview;
            reply["cells"] = preview != null && preview.HasPlan ? preview.ToJson() : null;
            reply["zone"] = StationEditSession.Zone != null ? StationEditSession.Zone.ToJson() : null;
            reply["rail"] = StationEditSession.RailJson(StationEditSession.Rail);
            reply["surface"] = StationEditSession.Surface != null ? StationEditSession.Surface.ToJson() : null;
            if (!CellToolActive) {
                // One ghost owns the shared preview layer at a time. A face, floor or rail tool
                // draws its own layer before this reply is built, so the layer is only cleared
                // here when its owner has nothing to show (a commit, a cancel, another tool).
                var active = StationToolSelection.Active;
                bool paintOwner = string.Equals(active, "paint", StringComparison.Ordinal) && StationEditSession.Paint != null;
                bool zoneOwner = string.Equals(active, "zone", StringComparison.Ordinal) && StationEditSession.Zone != null;
                bool railOwner = (string.Equals(active, "rail", StringComparison.Ordinal) ||
                                  string.Equals(active, "tunnel", StringComparison.Ordinal)) &&
                                 StationEditSession.Rail != null;
                bool surfaceOwner = string.Equals(active, "module", StringComparison.Ordinal) &&
                                    StationEditSession.Surface != null;
                if (!paintOwner && !zoneOwner && !railOwner && !surfaceOwner) editHost.Preview?.ShowCells(null);
                return;
            }
            reply["rightClaim"] = StationToolSelection.RightClaim;
            _ = host;
            _ = editHost;
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
            if (StationEditSession.HasCarried) CancelMove(host, editHost);
            ClearPlan(host, editHost);
        }

        /// <summary>
        /// Re-aim the cached pointer once (plan 27 §2). A settings, camera or view change moves
        /// what the same pixel resolves to, and nothing else would rebuild the ghost under a
        /// still pointer.
        /// </summary>
        public static bool RefreshHover(StationGameHost host) {
            if (host == null || !host.IsLoaded) return false;
            bool cell = StationCellTool.RefreshHover(host);
            if (string.Equals(StationToolSelection.Active, "paint", StringComparison.Ordinal) &&
                StationEditSession.HasPointer) {
                // A finish/mode change under a still pointer redraws the face ghost; the brush's
                // own region does not depend on the camera, so the cached pointer is enough.
                StationEditScene.ResolveView(host, out _, out var paintCamera, out var paintLevel, out var paintVisibility);
                if (paintCamera != null) {
                    var paintRay = paintCamera.ScreenPointToRay(StationEditSession.PointerScreen());
                    var paintHit = StationEditScene.PickRay(host, host.Coordinator?.World, paintCamera, paintRay,
                        paintLevel, paintVisibility, false, out _, out _);
                    StationPaintTool.Aim(host, paintHit, StationEditSession.Pointer);
                    StationPaintTool.Publish();
                    StationEditHost.Ensure().Preview?.ShowFaces(StationPaintTool.Preview);
                    return true;
                }
            }
            if (string.Equals(StationToolSelection.Active, "zone", StringComparison.Ordinal) &&
                StationEditSession.HasPointer) {                // A brush change under a still pointer retints the floor it would label.
                StationEditScene.ResolveView(host, out _, out var zoneCamera, out var zoneLevel, out var zoneVisibility);
                if (zoneCamera != null) {
                    var zoneRay = zoneCamera.ScreenPointToRay(StationEditSession.PointerScreen());
                    var zoneHit = StationEditScene.PickRay(host, host.Coordinator?.World, zoneCamera, zoneRay,
                        zoneLevel, zoneVisibility, false, out _, out _);
                    StationZoneTool.Aim(host, zoneHit, StationEditSession.Pointer);
                    StationZoneTool.Publish();
                    StationEditHost.Ensure().Preview?.ShowZone(StationZoneTool.Preview);
                    return true;
                }
            }
            if (string.Equals(StationToolSelection.Active, "rail", StringComparison.Ordinal) &&
                StationEditSession.HasPointer) {
                // A line, rotation or direction change under a still pointer resizes and turns the
                // piece ghost without waiting for the next move.
                StationEditScene.ResolveView(host, out _, out var railCamera, out var railLevel, out var railVisibility);
                if (railCamera != null) {
                    var railRay = railCamera.ScreenPointToRay(StationEditSession.PointerScreen());
                    var railHit = StationEditScene.PickRay(host, host.Coordinator?.World, railCamera, railRay,
                        railLevel, railVisibility, false, out _, out _);
                    StationRailTool.Aim(host, railHit, StationEditSession.Pointer);
                    StationRailTool.Publish();
                    StationEditHost.Ensure().Preview?.ShowRail(StationRailTool.Preview);
                    return true;
                }
            }
            if (StationSurfaceTool.IsArmed() && StationEditSession.HasPointer) {
                // A tile-type change under a still pointer retints the rectangle it would pave.
                StationEditScene.ResolveView(host, out _, out var paveCamera, out var paveLevel, out var paveVisibility);
                if (paveCamera != null) {
                    var paveRay = paveCamera.ScreenPointToRay(StationEditSession.PointerScreen());
                    var paveHit = StationEditScene.PickRay(host, host.Coordinator?.World, paveCamera, paveRay,
                        paveLevel, paveVisibility, false, out _, out _);
                    StationSurfaceTool.Aim(host, paveHit, StationEditSession.Pointer);
                    StationSurfaceTool.Publish();
                    StationEditHost.Ensure().Preview?.ShowSurface(StationSurfaceTool.Preview);
                    return true;
                }
            }
            if (string.Equals(StationToolSelection.Active, "tunnel", StringComparison.Ordinal) &&
                StationEditSession.HasPointer) {
                // The armed tunnel length is part of the ghost, so a change to it re-aims too.
                StationEditScene.ResolveView(host, out _, out var boreCamera, out var boreLevel, out var boreVisibility);
                if (boreCamera != null) {
                    var boreRay = boreCamera.ScreenPointToRay(StationEditSession.PointerScreen());
                    var boreHit = StationEditScene.PickRay(host, host.Coordinator?.World, boreCamera, boreRay,
                        boreLevel, boreVisibility, false, out _, out _);
                    StationTunnelTool.Aim(host, boreHit, StationEditSession.Pointer);
                    StationTunnelTool.Publish();
                    StationEditHost.Ensure().Preview?.ShowRail(StationTunnelTool.Preview);
                    return true;
                }
            }
            var editHost = StationEditHost.Ensure();
            if (StationEditSession.HasCarried && StationEditSession.HasPointer) {                StationEditScene.ResolveView(host, out _, out var camera, out var level, out var visibility);
                if (camera == null) return cell;
                var ray = camera.ScreenPointToRay(StationEditSession.PointerScreen());
                var hit = StationEditScene.PickRay(host, host.Coordinator?.World, camera, ray, level, visibility,
                    true, out var context, out _);
                if (hit != null) {
                    AimMove(host, editHost, host.Coordinator?.World, ray, context, hit);
                    return true;
                }
            } else if (CellToolActive && !StationCellTool.HasGesture) {
                return cell;
            }
            return cell;
        }

        static void Down(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationPointerEvent pointer, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            StationEditSession.Picked = null;
            if (IsCellTool(tool) && (pointer.Button == 0 || pointer.Button == 2)) {
                // The block tool owns **both** build buttons: the primary adds, the secondary
                // digs/erases. The shell gives a claimed right button to the tool instead of the
                // camera pan, so this is the one owner of it.
                if (StationCellTool.Begin(host, hit, tool, pointer.Button, pointer, out reason)) {
                    StationCellTool.Publish();
                    reply["cells"] = StationCellTool.Preview.ToJson();
                    return;
                }
                reply["cells"] = null;
                return;
            }
            if (string.Equals(tool, "module", StringComparison.Ordinal) && ModuleRunArmed() &&
                (pointer.Button == 0 || pointer.Button == 2)) {
                // A run family (围栏 / 盲道 / floor mark) drags a line rather than placing one
                // panel per press (`EquipmentTool.beginLineAdd`).
                if (StationCellTool.Begin(host, hit, tool, pointer.Button, pointer, out reason)) {
                    StationCellTool.Publish();
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
            // as a 隧道, but it sets `cfg.bridge` and derives its piers per bay in the same revision.
            if (string.Equals(tool, "module", StringComparison.Ordinal) &&
                string.Equals(StationToolSelection.Setting("moduleType"), "bridge", StringComparison.Ordinal)) {
                var bridgeSource = StationTunnelTool.RailUnder(host, hit);
                if (bridgeSource == null) {
                    reason = "no-track";
                    return;
                }
                if (pointer.Button == 2) {
                    var sourceRail = bridgeSource;
                    var removal = StationRailPlanner.PlanRemoval(host.Index, sourceRail.Id);
                    if (!removal.HasWork) { reason = removal.Reason; return; }
                    var removalPatch = removal.ToPatch();
                    foreach (var write in StationTunnelShell.Strip(host.Index, sourceRail.Id)) removalPatch.Writes.Add(write);
                    if (!StationEditSession.TryApplyCells(host, removalPatch, "remove rail", null, out _, out code)) {
                        reason = code;
                        return;
                    }
                    AfterCommit(host, editHost, "");
                    return;
                }
                int bridgeLength = Math.Max(1, StationToolSelection.SettingInt("bridgeLength", 24));
                var bridgePlan = StationRailPlanner.PlanBridge(host.Index, bridgeSource.Id, bridgeLength,
                    hit.Cell.X, hit.Cell.Y, true, StationToolSelection.Setting("bridgeRailing"));
                if (!bridgePlan.Ok) {
                    reason = bridgePlan.Reason;
                    return;
                }
                bridgePlan.Track.Id = StationModulePlacement.NextId(host.Index, "track");
                var bridgePatch = bridgePlan.ToPatch();
                foreach (var pier in StationBridgePillars.Candidates(host.Index,
                             StationModulePlacement.ToRecord(bridgePlan.Track)))
                    bridgePatch.AddModule(pier);
                if (!StationEditSession.TryApplyCells(host, bridgePatch, "place bridge", null, out _, out code)) {
                    reason = code;
                    return;
                }
                AfterCommit(host, editHost, bridgePlan.Track.Id);
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
                    bool bored = StationTunnelTool.Begin(host, hit, pointer, pointer.Button, out code, out reason);
                    StationTunnelTool.Publish();
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
                    Place(host, editHost, world, ray, pickContext, hit, reply, out code, out reason);
                    return;
                default:
                    reply["unsupportedTool"] = tool;
                    ClearPlan(host, editHost);
                    return;
            }
        }

        static void RightTap(StationGameHost host, StationEditHost editHost, StationPointerEvent pointer, string tool,
            StationSceneHit hit, JObject reply, out string code, out string reason) {
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
                    if (!string.IsNullOrEmpty(reason) && code == null) reply["reason"] = reason;
                    return;
                }
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
                StationZoneTool.Begin(host, hit, pointer, 2, out reason);
                StationZoneTool.Finish(host, hit, pointer, out code, out reason);
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
            ClearPlan(host, editHost);
        }

        static void Move(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, StationPointerEvent pointer, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
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
                StationTunnelTool.Aim(host, hit, pointer);
                StationTunnelTool.Publish();
                editHost.Preview?.ShowRail(StationTunnelTool.Preview);
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
            if (StationCellTool.HasGesture) {
                StationCellTool.Aim(host, hit, pointer);
                StationCellTool.Publish();
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
                reply["cells"] = StationCellTool.Preview.ToJson();
                return;
            }
            if (tool == "module") {
                Hover(host, editHost, world, ray, pickContext, hit);
                return;
            }
            ClearPlan(host, editHost);
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
            editHost.Bind(host);
            editHost.Preview?.Show(plan);
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
                patch.ModuleAdds.Add(plan.Candidate);
                foreach (var write in StationRampCarve.Carve(host.Index,
                             new[] { StationModulePlacement.ToRecord(plan.Candidate) }))
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
            if (carried == null && string.Equals(toolType, "stair-block", StringComparison.Ordinal)) {
                // The 楼梯块's height is the tool's own 高/低 toggle (`stairBlockHeight`).
                var height = StationToolSelection.Setting("stairBlockHeight");
                request.BlockHeight = double.TryParse(height, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var metres) && metres > 0 ? metres : 1;
            }
            if (carried == null && string.Equals(toolType, "lift", StringComparison.Ordinal)) {
                // `liftInterval` is the floor interval in metres; `liftSize` arms the 大 shaft.
                request.LiftInterval = StationToolSelection.SettingInt("liftInterval", 5);
                request.LiftSizeLarge = string.Equals(StationToolSelection.Setting("liftSize"), "large",
                    StringComparison.Ordinal);
            }
            if (carried == null && string.Equals(toolType, "walkway", StringComparison.Ordinal)) {
                // The 自动步道's three catalogue lengths (短 30 / 中 60 / 长 90 cells) and its
                // travel direction; the endpoints carry both into the save.
                var length = StationToolSelection.Setting("walkwayLength");
                request.WalkwayRun = length == "long" ? 90 : length == "medium" ? 60 : 30;
                request.WalkwayDown = string.Equals(StationToolSelection.Setting("walkwayDir"), "down",
                    StringComparison.Ordinal);
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
            in StationPickContext pickContext, StationSceneHit hit) =>
            StationModulePlacement.Resolve(host.Index, RequestFor(world, ray, pickContext, hit, null, 0));

        // -------------------------------------------------------------------- move

        static void BeginMove(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (hit.TargetKind != StationSceneTargetKind.Module) { reason = "no-module"; return; }
            StationEditSession.CarriedId = hit.Module.Id;
            StationEditSession.CarriedRotation = hit.Module.Rotation;
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
                reason = "not-found";
                return;
            }
            var plan = StationModulePlacement.Resolve(host.Index,
                RequestFor(world, ray, pickContext, hit, module, StationEditSession.CarriedRotation));
            StationEditSession.Plan = plan;
            if (!plan.Ok) {
                StationEditSession.MoveReason = plan.Reason;
                reason = plan.Reason;
                editHost.Bind(host);
                editHost.Preview?.Show(plan);
                return;
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Replace, plan.Candidate, null, "move", null, out _, out code)) {
                reason = code;
                return;
            }
            AfterCommit(host, editHost, module.Id);
        }

        /// <summary>A right press / Escape puts the carried piece back exactly where it was.</summary>
        public static void CancelMove(StationGameHost host, StationEditHost editHost) {
            if (StationEditSession.HasCarried) {
                StationEditSession.CarriedId = "";
                StationEditSession.CarriedRotation = 0;
                StationEditSession.MoveReason = "";
                editHost.Preview?.RestoreCarried();
            }
            editHost.Preview?.ClearGhost();
            StationEditSession.Plan = null;
        }

        /// <summary>Turn the carried piece one quarter turn.</summary>
        public static bool RotateCarried(StationGameHost host, int delta) {
            if (!StationEditSession.HasCarried || host == null) return false;
            StationEditSession.CarriedRotation = StationFootprints.NormRot(StationEditSession.CarriedRotation + delta);
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
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, hit.Module.Id, "delete", null, out _, out code)) {
                reason = code;
                return;
            }
            StationEditSession.ClearSelection();
            ClearSelectionHighlight(editHost);
        }

        // ----------------------------------------------------------------- helpers

        static void ClearPlan(StationGameHost host, StationEditHost editHost) {
            StationEditSession.Plan = null;
            editHost.Preview?.ClearGhost();
        }

        static void ClearSelectionHighlight(StationEditHost editHost) => editHost.Preview?.ClearGhost();

        static void AfterCommit(StationGameHost host, StationEditHost editHost, string selectId) {
            editHost.Bind(host);
            editHost.Preview?.RestoreCarried();
            StationEditSession.CarriedId = "";
            StationEditSession.CarriedRotation = 0;
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
                return StationPointerRouter.Handle(host, command.Type, payload, payload, out rejectCode, out rejectReason);
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
                case "edit.cancel":
                    StationPointerRouter.CancelMove(host, StationEditHost.Ensure());
                    return true;
                case "edit.rotate": {
                    if (!StationEditSession.HasCarried) { rejectCode = "no-draft"; rejectReason = "No piece is being moved."; return false; }
                    StationPointerRouter.RotateCarried(host, Int(payload, "delta", 1));
                    // A rotation is a setting change under a still pointer: redraw in place rather
                    // than waiting for the next move (`MoveController` / `equipment.rotate`).
                    StationPointerRouter.RefreshHover(host);
                    return true;
                }
                case "edit.move.start": {
                    string id = String(payload, "moduleId");
                    if (!host.IsLoaded || !host.Index.TryGetModule(id, out var module)) { rejectCode = "not-found"; return false; }
                    StationEditSession.CarriedId = module.Id;
                    StationEditSession.CarriedRotation = module.Rotation;
                    StationEditSession.Plan = null;
                    StationEditSession.MoveReason = "";
                    StationEditSession.SelectModule(module);
                    StationPointerRouter.LiftAtSource(host, StationEditHost.Ensure(), module);
                    return true;
                }
                case "edit.move.cancel":
                    StationPointerRouter.CancelMove(host, StationEditHost.Ensure());
                    return true;
                case "edit.undo": {
                    if (!StationEditSession.TryUndo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    // The committed geometry is a different document now: any cached world and
                    // ghost belong to the revision that was just replaced.
                    StationCellTool.ForgetWorld();
                    StationCellTool.Cancel();
                    StationEditHost.Ensure().Bind(host);
                    return true;
                }
                case "edit.redo": {
                    if (!StationEditSession.TryRedo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    StationCellTool.ForgetWorld();
                    StationCellTool.Cancel();
                    StationEditHost.Ensure().Bind(host);
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
                    // A selected **cell** (or a caller that names one) goes through the same
                    // planner the brush uses, so the Delete key removes exactly what a right
                    // click would.
                    var cellToken = payload["cell"] as JArray;
                    if (cellToken == null || cellToken.Count < 3) {
                        rejectCode = "bad-payload";
                        rejectReason = "edit.delete needs payload.moduleId or payload.cell [x, y, z].";
                        return false;
                    }
                    var world = StationCellTool.World(host);
                    if (world == null) { rejectCode = "no-session"; return false; }
                    var cell = new StationCellKey((int)cellToken[0], (int)cellToken[1], (int)cellToken[2]);
                    var columns = StationCellPlanner.WallColumnsAt(world, new[] { cell });
                    var cells = columns.Count > 0 ? columns : new List<StationCellKey> { cell };
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
                    StationCellTool.ForgetWorld();
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
