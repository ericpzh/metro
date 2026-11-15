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
        const int ShiftBit = 1 << 3;

        /// <summary>The pointer events the section's controls may claim before any editor tool.</summary>
        static bool ShouldRouteSection(string type) =>
            type == "pointer.down" || type == "pointer.move" || type == "pointer.up";

        /// <summary>True when a pointer event needs the active storey's horizontal work plane evaluated as a fallback.</summary>
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
                CancelMove(host, editHost);
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (type == "pointer.leave") {
                ClearPlan(host, editHost);
                StationEditSession.Trace(type, StationToolSelection.Active, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }

            if (!StationPointerEvent.TryDecode(payload, out var pointer, out code)) return false;

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

            if (pointer.ToolGeneration >= 0 && pointer.ToolGeneration != StationToolSelection.Generation) {
                code = "stale-tool";
                reason = "The pointed-at tool is not the committed tool any more.";
                return false;
            }
            if (pointer.DocumentRevision >= 0 && pointer.DocumentRevision != host.CurrentRevision) {
                code = "stale-revision";
                reason = "The pointer event belongs to a revision the station no longer has.";
                return false;
            }

            var tool = StationToolSelection.Active;
            if (type == "pointer.up") {
                StationEditSession.Trace(type, tool, null, null,
                    revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
                reply["tool"] = tool;
                reply["toolGeneration"] = StationToolSelection.Generation;
                if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                return true;
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
                    Down(host, editHost, world, ray, pickContext, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.rightTap":
                    RightTap(host, editHost, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.move":
                    Move(host, editHost, world, ray, pickContext, tool, hit, reply, out code, out reason);
                    break;
            }

            StationEditSession.Trace(type, tool, hit, StationEditSession.Plan,
                revisionBefore, host.CurrentRevision, StationScenePicker.PickCount - picksBefore);
            reply["hit"] = HitJson(hit);
            reply["tool"] = StationToolSelection.Active;
            reply["toolGeneration"] = StationToolSelection.Generation;
            if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
            return true;
        }

        static void Down(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, string tool, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            StationEditSession.Picked = null;
            switch (tool) {
                case "select":
                    Select(host, editHost, hit);
                    return;
                case "pick":
                    Pick(host, editHost, hit);
                    return;
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

        static void RightTap(StationGameHost host, StationEditHost editHost, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            if (tool == "select") {
                Delete(host, editHost, hit, reply, out code, out reason);
                return;
            }
            if (StationEditSession.HasCarried) {
                CancelMove(host, editHost);
                return;
            }
            ClearPlan(host, editHost);
        }

        static void Move(StationGameHost host, StationEditHost editHost, StationWorldView world, Ray ray,
            in StationPickContext pickContext, string tool, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (StationEditSession.HasCarried) {
                AimMove(host, editHost, world, ray, pickContext, hit);
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
            return BuildRequest(world, ray, pickContext, hit, carried, rotation, toolType, variant, width, lineId, curtainHeight);
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
            editHost.Preview?.ClearGhost();
            editHost.Preview?.HideCarried(hit.Module.Id);
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
                    var editHost = StationEditHost.Ensure();
                    editHost.Bind(host);
                    editHost.Preview?.ClearGhost();
                    editHost.Preview?.HideCarried(module.Id);
                    return true;
                }
                case "edit.move.cancel":
                    StationPointerRouter.CancelMove(host, StationEditHost.Ensure());
                    return true;
                case "edit.undo": {
                    if (!StationEditSession.TryUndo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.redo": {
                    if (!StationEditSession.TryRedo(host, out _, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.delete": {
                    string id = String(payload, "moduleId");
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, id, "delete", command.Id, out _, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
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
