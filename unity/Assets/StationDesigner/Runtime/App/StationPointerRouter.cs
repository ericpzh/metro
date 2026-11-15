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

    /// <summary>The preview/selection component the handlers drive, or null before a scene host exists.</summary>
    public static class StationEditScene {
        /// <summary>The rendered camera the pointer ray must come from.</summary>
        public static Camera EditCamera(StationGameHost host) {
            var rig = host != null ? host.GetComponent<StationViewRig>() : null;
            if (rig != null && rig.viewCamera != null) return rig.viewCamera;
            if (host != null && host.stationCamera != null) return host.stationCamera;
            return Camera.main;
        }

        public static StationSceneHit Pick(StationGameHost host, StationPointerEvent pointer, out string code) {
            code = null;
            var world = host != null ? host.Coordinator?.World : null;
            var camera = EditCamera(host);
            if (world == null || camera == null) { code = "no-session"; return null; }
            StationEditSession.Level = host.ActiveLevel;
            return StationScenePicker.Pick(world, camera, pointer.ToScreen(), host.ActiveLevel);
        }
    }

    /// <summary>
    /// The canvas pointer router (plan 16 §1.2). It is the only owner of "what the
    /// pointer did": one scene pick per event, one tool dispatch, and the same pick
    /// handed to the candidate resolver, the ghost and the commit. Camera gestures stay
    /// with the React canvas layer (`cameraAdapter.ts` owns middle/right drag, pan and
    /// wheel), so these events are the left-button/tool stream only.
    ///
    /// The router never edits the save itself. Place/move/delete go through
    /// <see cref="StationEditSession.TryApply"/>, which stages the complete envelope
    /// through <c>StationGameHost.ApplyDocumentEdit</c>.
    /// </summary>
    public static class StationPointerRouter {
        /// <summary>A drawn body may start slightly behind the surface under it (an exit head-house is drawn past its box); this is the forgiveness the source's own occlusion check implies.</summary>
        const float ModuleForgivenessMetres = 1.0f;

        /// <summary>The normalized modifier bit for Shift (`pointerInput.ts` passes `e.shiftKey`).</summary>
        const int ShiftBit = 1 << 3;

        /// <summary>The pointer events the section's controls may claim before any editor tool.</summary>
        static bool ShouldRouteSection(string type) =>
            type == "pointer.down" || type == "pointer.move" || type == "pointer.up";

        /// <summary>Handle one `pointer.*` command. Returns false only for an unusable event.</summary>
        public static bool Handle(StationGameHost host, string type, JObject payload, JObject reply, out string code, out string reason) {
            code = null;
            reason = null;
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            var editHost = StationEditHost.Ensure();
            int revisionBefore = host.CurrentRevision;
            // 20 §6: the section's own controls own the pointer before any editor tool. One ray is
            // built here and shared by the control hit and — only if the control declines — the
            // scene pick, so a grab can never also start a place or a pan.
            var rig = host.GetComponent<StationViewRig>();
            var sectionView = rig != null ? rig.sectionView : null;
            var camera = StationEditScene.EditCamera(host);
            if (sectionView != null && (type == "pointer.cancel" || type == "pointer.leave") &&
                StationSectionDrag.Handle(host, rig, type, default, default, false, reply, out code, out reason)) {
                // Escape and a lost pointer end the grab and put the cut back where it was found.
                if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                reply["tool"] = StationToolSelection.Active;
                reply["toolGeneration"] = StationToolSelection.Generation;
                return true;
            }
            if (sectionView != null && camera != null && ShouldRouteSection(type) &&
                StationPointerEvent.TryDecode(payload, out var aim, out _)) {
                bool fine = (aim.Modifiers & ShiftBit) != 0;
                var ray = camera.ScreenPointToRay(aim.ToScreen());
                if (StationSectionDrag.Handle(host, rig, type, aim, ray, fine, reply, out code, out reason)) {
                    if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
                    reply["tool"] = StationToolSelection.Active;
                    reply["toolGeneration"] = StationToolSelection.Generation;
                    return true;
                }
            }
            if (type == "pointer.cancel") {
                CancelMove(host, editHost);
                StationEditSession.Trace(type, StationToolSelection.Active, null, null, revisionBefore, host.CurrentRevision);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (type == "pointer.leave") {
                ClearPlan(host, editHost);
                StationEditSession.Trace(type, StationToolSelection.Active, null, null, revisionBefore, host.CurrentRevision);
                reply["edit"] = StationEditSession.ToJson();
                return true;
            }
            if (!StationPointerEvent.TryDecode(payload, out var pointer, out code)) return false;
            // A stale tool generation or document revision belongs to a gesture the
            // station no longer has: drop it without touching the draft or the save.
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
            var hit = StationEditScene.Pick(host, pointer, out code);
            if (hit == null) return false;
            // One pick, then every later decision reads this `hit` and nothing else.
            var tool = StationToolSelection.Active;
            switch (type) {
                case "pointer.down":
                    Down(host, editHost, tool, hit, pointer, reply, out code, out reason);
                    break;
                case "pointer.rightTap":
                    RightTap(host, editHost, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.move":
                    Move(host, editHost, tool, hit, reply, out code, out reason);
                    break;
                case "pointer.up":
                    reply["edit"] = StationEditSession.ToJson();
                    StationEditSession.Trace(type, tool, null, null, revisionBefore, host.CurrentRevision);
                    break;
                default:
                    code = "unsupported-command";
                    return false;
            }
            if (type != "pointer.up") {
                StationEditSession.Trace(type, tool, hit, StationEditSession.Plan, revisionBefore, host.CurrentRevision);
            }
            reply["hit"] = HitJson(hit);
            reply["tool"] = StationToolSelection.Active;
            reply["toolGeneration"] = StationToolSelection.Generation;
            if (reply["edit"] == null) reply["edit"] = StationEditSession.ToJson();
            return true;
        }

        static void Down(StationGameHost host, StationEditHost editHost, string tool, StationSceneHit hit,
            StationPointerEvent pointer, JObject reply, out string code, out string reason) {
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
                    if (StationEditSession.HasCarried) CommitMove(host, editHost, hit, reply, out code, out reason);
                    else BeginMove(host, editHost, hit, reply, out code, out reason);
                    return;
                case "module":
                    Place(host, editHost, hit, reply, out code, out reason);
                    return;
                default:
                    // A tool this router has no canvas behaviour for (floor, gate, paint,
                    // rail, zone, road, sign, inspect) keeps its own handler; the reply
                    // says so instead of pretending the click did something.
                    reply["unsupportedTool"] = tool;
                    ClearPlan(host, editHost);
                    return;
            }
        }

        static void RightTap(StationGameHost host, StationEditHost editHost, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            if (tool == "select") {
                // The 选择 tool's right-click bulldozes what is under the pointer.
                Delete(host, editHost, hit, reply, out code, out reason);
                return;
            }
            if (StationEditSession.HasCarried) {
                CancelMove(host, editHost);
                return;
            }
            ClearPlan(host, editHost);
        }

        static void Move(StationGameHost host, StationEditHost editHost, string tool, StationSceneHit hit,
            JObject reply, out string code, out string reason) {
            code = null; reason = null;
            if (StationEditSession.HasCarried) {
                AimMove(host, editHost, hit);
                return;
            }
            if (tool == "module") {
                Hover(host, editHost, hit);
                return;
            }
            ClearPlan(host, editHost);
        }

        // --------------------------------------------------------------- selection

        static void Select(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            ClearPlan(host, editHost);
            if (hit.HasModule && ModuleWins(hit)) {
                StationEditSession.SelectModule(hit.Module);
                editHost.Preview?.Select(hit.Module);
                return;
            }
            if (hit.HasCell) {
                StationEditSession.SelectCell(new StationCellKey(hit.Cell.X, hit.Cell.Y, hit.Cell.Z));
                ClearSelectionHighlight(editHost);
                return;
            }
            StationEditSession.ClearSelection();
            ClearSelectionHighlight(editHost);
        }

        /// <summary>A module body wins over the block behind it unless the block is clearly in front.</summary>
        static bool ModuleWins(StationSceneHit hit) =>
            hit.HasModule && (!hit.HasCell || hit.ModuleDistance <= hit.CellDistance + ModuleForgivenessMetres);

        // ---------------------------------------------------------------- eyedropper

        static void Pick(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            ClearPlan(host, editHost);
            if (!hit.HasModule || !ModuleWins(hit)) {
                StationEditSession.Picked = new JObject { ["moduleId"] = "", ["type"] = "", ["reason"] = "no-module" };
                return;
            }
            var module = hit.Module;
            StationEditSession.SelectModule(module);
            editHost.Preview?.Select(module);
            // The palette id itself is the TypeScript rail's answer (`paletteIdForModule`
            // in `PickTool.ts`): the shell maps this record against the committed document
            // it already adopted, so the mapping has one owner. The host still reports the
            // families whose palette id it can name, for a headless verifier.
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

        static void Hover(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            var plan = ResolvePlacement(host, hit);
            StationEditSession.Plan = plan;
            editHost.Bind(host);
            editHost.Preview?.Show(plan);
        }

        static void Place(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            var plan = ResolvePlacement(host, hit);
            if (plan.Candidate == null) {
                // An ok plan with no piece is not a commit and must not be a silent click: name
                // it so the pointer trace and the verifier can tell it from a refusal.
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
                // An invalid placement is not a commit: the station is untouched and the
                // refusal is what the click produced.
                reply["edit"] = StationEditSession.ToJson();
                return;
            }
            plan.Candidate.Id = StationModulePlacement.NextId(host.Index, plan.Candidate.Type);
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Add, plan.Candidate, null, "place", null, out var result, out code)) {
                reason = code;
                return;
            }
            AfterCommit(host, editHost, plan.Candidate.Id);
        }

        /// <summary>
        /// 18 §9 — **one** request for one pointer event. The event's hit is resolved once
        /// (module, host and drawn face); this builder carries the module the ray really met as
        /// the host (`TargetModuleId`) and the face it met as the placement hit, so a placement,
        /// a move aim and a move commit cannot read three different surfaces. The old code
        /// passed only `hit.Cell` — the wall or floor *behind* the module — so a wall decor, a
        /// hung fitting or an exit/ramp snap lost its visible host and support geometry.
        /// </summary>
        static StationPlacementRequest RequestFor(StationSceneHit hit, StationModuleRecord carried, int carriedRotation) {
            var request = new StationPlacementRequest {
                Carried = carried,
                Rotation = carried != null ? carriedRotation : StationToolSelection.SettingInt("rotation", 0),
                Hit = PlacementHit(hit),
                TargetModuleId = hit.HasModule ? hit.Module.Id : "",
                // Plan 22 §2: the point the ray met on the picked module, kept separately from the
                // placement cell. The door-to-curtain snap needs it to know which run cell of the
                // curtain the pointer is over; `Hit` prefers the cell *behind* the model.
                ModulePoint = hit.HasModule ? hit.ModulePoint : (StationPoint?)null,
                CurtainHeight = StationToolSelection.SettingInt("curtainHeight", 4),
            };
            if (carried == null) {
                request.ToolType = StationToolSelection.Setting("moduleType");
                request.Variant = StationToolSelection.Setting("variant");
                request.Width = StationToolSelection.SettingInt("width", 0);
                request.LineId = StationToolSelection.Setting("lineId");
            }
            return request;
        }

        /// <summary>
        /// The placement hit one event gives. The analytic cell surface is the tool's own datum
        /// whenever the ray met one (the source's `pickCell`), because `StationModulePlacement`
        /// still resolves floor/cell anchors: steering a plain floor placement onto a prop's
        /// drawn face made `Resolve` answer an ok plan with no candidate, which committed
        /// nothing and left the click silently dead (the `station-editing` verifier case
        /// caught exactly that). A module's drawn face supplies the hit only when the ray met
        /// **no** cell — a prop standing in front of empty space — and the remaining §9b work
        /// is teaching `Resolve` the wall, ceiling/hanger and rail/ramp anchors, at which point
        /// the face becomes the primary datum.
        /// </summary>
        static StationPlacementHit PlacementHit(StationSceneHit hit) {
            if (hit.HasCell) return hit.Cell;
            if (hit.HasModule && hit.ModuleExact) {
                int stepX = Math.Abs(hit.ModuleNormal.X) > .5 ? Math.Sign(hit.ModuleNormal.X) : 0;
                int stepY = Math.Abs(hit.ModuleNormal.Y) > .5 ? Math.Sign(hit.ModuleNormal.Y) : 0;
                int stepZ = Math.Abs(hit.ModuleNormal.Z) > .5 ? Math.Sign(hit.ModuleNormal.Z) : 0;
                if (stepX != 0 || stepY != 0 || stepZ != 0) {
                    return StationPlacementHit.FromSurface(hit.ModulePoint, stepX, stepY, stepZ, true);
                }
            }
            return StationPlacementHit.None;
        }

        static StationPlacementPlan ResolvePlacement(StationGameHost host, StationSceneHit hit) =>
            StationModulePlacement.Resolve(host.Index, RequestFor(hit, null, 0));

        // -------------------------------------------------------------------- move

        static void BeginMove(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (!hit.HasModule || !ModuleWins(hit)) { reason = "no-module"; return; }
            StationEditSession.CarriedId = hit.Module.Id;
            StationEditSession.CarriedRotation = hit.Module.Rotation;
            StationEditSession.SelectModule(hit.Module);
            editHost.Bind(host);
            editHost.Preview?.HideCarried(hit.Module.Id);
            AimMove(host, editHost, hit);
        }

        static void AimMove(StationGameHost host, StationEditHost editHost, StationSceneHit hit) {
            if (!host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) {
                StationEditSession.MoveReason = "not-found";
                return;
            }
            var plan = StationModulePlacement.Resolve(host.Index,
                RequestFor(hit, module, StationEditSession.CarriedRotation));
            StationEditSession.Plan = plan;
            StationEditSession.MoveReason = plan.Reason;
            editHost.Preview?.Show(plan);
        }

        static void CommitMove(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (!host.Index.TryGetModule(StationEditSession.CarriedId, out var module)) {
                CancelMove(host, editHost);
                reason = "not-found";
                return;
            }
            var plan = StationModulePlacement.Resolve(host.Index,
                RequestFor(hit, module, StationEditSession.CarriedRotation));
            StationEditSession.Plan = plan;
            if (!plan.Ok) {
                // An invalid drop leaves **both** the carried draft and the saved object
                // intact: the player can keep aiming or put it back.
                StationEditSession.MoveReason = plan.Reason;
                reason = plan.Reason;
                editHost.Preview?.Show(plan);
                return;
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Replace, plan.Candidate, null, "move", null, out var result, out code)) {
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

        /// <summary>Turn the carried piece one quarter turn and re-aim it at the last hover.</summary>
        public static bool RotateCarried(StationGameHost host, int delta) {
            if (!StationEditSession.HasCarried || host == null) return false;
            StationEditSession.CarriedRotation = StationFootprints.NormRot(StationEditSession.CarriedRotation + delta);
            return true;
        }

        // ------------------------------------------------------------------ delete

        static void Delete(StationGameHost host, StationEditHost editHost, StationSceneHit hit, JObject reply,
            out string code, out string reason) {
            code = null; reason = null;
            if (!hit.HasModule || !ModuleWins(hit)) {
                reason = "no-module";
                reply["edit"] = StationEditSession.ToJson();
                return;
            }
            if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, hit.Module.Id, "delete", null, out var result, out code)) {
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

        static JObject HitJson(StationSceneHit hit) => new JObject {
            ["cell"] = hit.HasCell ? new JArray(hit.Cell.X, hit.Cell.Y, hit.Cell.Z) : null,
            ["place"] = hit.HasCell ? new JArray(hit.Cell.PlaceX, hit.Cell.PlaceY, hit.Cell.PlaceZ) : null,
            ["solid"] = hit.HasCell && hit.Cell.Solid,
            ["moduleId"] = hit.HasModule ? hit.Module.Id : "",
            ["moduleType"] = hit.HasModule ? hit.Module.Type : "",
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
                    StationEditSession.SelectModule(module);
                    var editHost = StationEditHost.Ensure();
                    editHost.Bind(host);
                    editHost.Preview?.HideCarried(module.Id);
                    return true;
                }
                case "edit.move.cancel":
                    StationPointerRouter.CancelMove(host, StationEditHost.Ensure());
                    return true;
                case "edit.undo": {
                    if (!StationEditSession.TryUndo(host, out var result, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.redo": {
                    if (!StationEditSession.TryRedo(host, out var result, out rejectCode)) { rejectReason = rejectCode; return false; }
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.delete": {
                    string id = String(payload, "moduleId");
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    if (!StationEditSession.TryApply(host, StationModuleEditMode.Remove, null, id, "delete", command.Id, out var result, out rejectCode)) {
                        rejectReason = rejectCode;
                        return false;
                    }
                    StationEditSession.ClearSelection();
                    return true;
                }
                case "edit.probe": {
                    // Deterministic target for the browser verifier: find a cell or module
                    // the live camera can actually aim at, prove the picker resolves back to
                    // it, and return its normalized viewport position. Nothing is edited.
                    if (!host.IsLoaded) { rejectCode = "no-session"; return false; }
                    if (!TryProbe(host, payload, out var probe, out rejectCode)) return false;
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

        /// <summary>
        /// `edit.probe { kind: "place" | "refused" | "module", toolType?, moduleType? }`.
        /// It projects candidate document points through the live camera and keeps the
        /// first one the scene picker resolves back to that same target, so a browser test
        /// can click at a known-good pixel without guessing an authoring layout.
        /// </summary>
        static bool TryProbe(StationGameHost host, JObject payload, out JObject probe, out string code) {
            probe = null;
            code = null;
            var camera = StationEditScene.EditCamera(host);
            var world = host.Coordinator?.World;
            if (camera == null || world == null) { code = "no-camera"; return false; }
            int level = host.ActiveLevel;
            string kind = String(payload, "kind");
            if (kind == "inspect") {
                // Diagnostic: where a module stands in the pick index (records, bounds,
                // visibility, measured renderers). Used by the browser verifier when a
                // freshly committed module is not pickable.
                string id = String(payload, "moduleId");
                int records = 0, active = 0, renderers = 0, enabled = 0, levelMin = 0, levelMax = 0;
                bool hasBounds = false;
                StationBox measured = default;
                bool haveMeasured = false;
                StationModuleRecord module = null;
                host.Index.TryGetModule(id, out module);
                foreach (var record in world.Records) {
                    if (!string.Equals(record.ModuleId, id, StringComparison.Ordinal)) continue;
                    records++;
                    levelMin = record.LevelMin; levelMax = record.LevelMax;
                    if (record.View != null && record.View.activeInHierarchy) active++;
                    if (record.HasBounds && !record.Bounds.IsEmpty) { hasBounds = true; measured = record.Bounds; haveMeasured = true; }
                    if (record.View != null) {
                        foreach (var renderer in record.View.GetComponentsInChildren<Renderer>(true)) {
                            renderers++;
                            if (renderer != null && renderer.enabled) enabled++;
                        }
                        if (!hasBounds && !haveMeasured) {
                            var all = record.View.GetComponentsInChildren<Renderer>(true);
                            var bounds = new Bounds();
                            bool any = false;
                            foreach (var renderer in all) {
                                if (renderer == null || !renderer.enabled) continue;
                                if (!any) { bounds = renderer.bounds; any = true; } else bounds.Encapsulate(renderer.bounds);
                            }
                            if (any) {
                                var min = StationCoordinates.WorldToDocument(bounds.min);
                                var max = StationCoordinates.WorldToDocument(bounds.max);
                                measured = new StationBox(Math.Min(min.x, max.x), Math.Min(min.y, max.y), Math.Min(min.z, max.z),
                                    Math.Max(min.x, max.x), Math.Max(min.y, max.y), Math.Max(min.z, max.z));
                                haveMeasured = true;
                            }
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
                    // Where the picker actually looks: the module's floor anchor and its
                    // measured body centre.
                    var floorPixel = Project(camera, StationCoordinates.FloorTop(module.X, module.Y, module.Z));
                    var cx = (measured.X0 + measured.X1) / 2;
                    var cy = (measured.Y0 + measured.Y1) / 2;
                    var cz = (measured.Z0 + measured.Z1) / 2;
                    var boxPixel = Project(camera, StationCoordinates.Point(new Vector3((float)cx, (float)cy, (float)cz)));
                    probe["floorUv"] = new JArray(floorPixel.x / Mathf.Max(1f, Screen.width), 1f - floorPixel.y / Mathf.Max(1f, Screen.height));
                    probe["boxUv"] = new JArray(boxPixel.x / Mathf.Max(1f, Screen.width), 1f - boxPixel.y / Mathf.Max(1f, Screen.height));
                    var floorHit = StationScenePicker.Pick(world, camera, floorPixel, level);
                    var boxHit = StationScenePicker.Pick(world, camera, boxPixel, level);
                    probe["floorHit"] = floorHit != null ? floorHit.ToString() : "none";
                    probe["boxHit"] = boxHit != null ? boxHit.ToString() : "none";
                }
                return true;
            }
            if (kind == "module") {
                string type = String(payload, "moduleType");
                string moduleId = String(payload, "moduleId");
                // A thin occluder (a rail, a PSD post) can sit on the projected centre of an
                // otherwise visible piece; the small offsets let the probe find a pixel the
                // picker really resolves back to that module.
                var offsets = new[] { new Vector2(0f, 0f), new Vector2(0f, -18f), new Vector2(0f, 18f),
                    new Vector2(-18f, 0f), new Vector2(18f, 0f), new Vector2(-18f, -18f), new Vector2(18f, 18f) };
                foreach (var module in host.Index.Document.Modules) {
                    if (moduleId.Length > 0 && !string.Equals(module.Id, moduleId, StringComparison.Ordinal)) continue;
                    if (type.Length > 0 && !string.Equals(module.Type, type, StringComparison.Ordinal)) continue;
                    // A module's authored cell floor is not where it is drawn: a bench's seat
                    // sits above and inside its cell, and since 18 §9 the picker answers from
                    // the drawn surface, so aiming at the floor top can miss the piece and hand
                    // the pixel to the paving tile in front. Probe the module's **drawn**
                    // bounds first, then its cell floor.
                    foreach (var point in ModuleProbePoints(world, module)) {
                        var centre = Project(camera, StationCoordinates.Point(point));
                        if (!OnScreen(centre)) continue;
                        foreach (var offset in offsets) {
                            var screen = centre + new Vector3(offset.x, offset.y, 0f);
                            var hit = StationScenePicker.Pick(world, camera, screen, level);
                            if (!hit.HasModule || !string.Equals(hit.Module.Id, module.Id, StringComparison.Ordinal)) continue;
                            probe = new JObject {
                                ["kind"] = "module",
                                ["moduleId"] = module.Id,
                                ["moduleType"] = module.Type,
                                ["x"] = module.X, ["y"] = module.Y, ["z"] = module.Z,
                                ["u"] = screen.x / Mathf.Max(1f, Screen.width),
                                ["v"] = 1f - screen.y / Mathf.Max(1f, Screen.height),
                            };
                            return true;
                        }
                    }
                }
                code = "no-probe";
                return false;
            }
            string toolType = String(payload, "toolType");
            int rotation = Int(payload, "rotation", 0);
            // Sample the active storey's own cells, not a stride across every storey: a
            // station can have most of its cells on other levels. A street storey can be
            // **module-only** (Zoo's virtual ground carries no authored cells at z=0), so the
            // modules standing on that level are candidates too — their floor aim is the same
            // plane the player clicks.
            var candidates = new List<StationCellRecord>();
            foreach (var cell in host.Index.Document.Cells) {
                if (cell.IsSolid && cell.Z == level) candidates.Add(cell);
            }
            var candidateCells = new List<StationPoint>();
            foreach (var cell in candidates) candidateCells.Add(new StationPoint(cell.X, cell.Y, cell.Z));
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
                // What matters is where the click lands, not the sampled cell: the ray may
                // meet a nearer block, or the storey's virtual ground plane. Resolve at the
                // hit's own whole cell and report that.
                var hit = StationScenePicker.Pick(world, camera, screen, level);
                if (!hit.HasCell) continue;
                // Place on the storey being edited: a piece dropped on a higher block from a
                // lower view is above the cutaway and correctly unpickable afterwards, so the
                // probe (and the player's own click) must stay on the active level.
                if (hit.Cell.Z != level) continue;
                // An exit head-house draws far past its collision box, so a piece placed
                // inside its plan can never be pointed at again: the exit body wins every
                // later pick (correctly). Every other drawn body is left alone — the source
                // pointer path places around them and the picker lets the nearest body win.
                if (kind != "refused" && hit.HasModule && hit.Module.Type == "exit") continue;
                var plan = StationModulePlacement.Resolve(host.Index, new StationPlacementRequest {
                    ToolType = toolType,
                    Rotation = kind == "refused" && StationEditSession.HasCarried
                        ? StationEditSession.CarriedRotation : rotation,
                    // A move's refusal is judged with the carried piece excluded from its own
                    // collision: a cell the fresh piece is refused on **because the carried
                    // piece stands there** is a valid drop, not an invalid one.
                    Carried = kind == "refused" && StationEditSession.HasCarried &&
                              host.Index.TryGetModule(StationEditSession.CarriedId, out var carried)
                        ? carried : null,
                    Hit = hit.Cell,
                });
                if (kind == "refused" ? plan.Ok : !plan.Ok) continue;
                // Prefer the most central pixel: the piece is then framed away from the
                // shell's rails and its own post-commit probe cannot fall outside the safe
                // region or behind an edge panel.
                float u = screen.x / Mathf.Max(1f, Screen.width);
                float v = 1f - screen.y / Mathf.Max(1f, Screen.height);
                float score = Mathf.Abs(u - 0.5f) + Mathf.Abs(v - 0.5f);
                if (score >= bestScore) continue;
                bestScore = score;
                bestProbe = new JObject {
                    ["kind"] = kind == "refused" ? "refused" : "place",
                    ["toolType"] = toolType,
                    ["x"] = hit.Cell.X, ["y"] = hit.Cell.Y, ["z"] = hit.Cell.Z,
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

        /// <summary>
        /// The document points worth aiming at for one module: the centre and top of the union
        /// of its **enabled renderer bounds** (its drawn body), then its authored cell floor.
        /// A probe that only knows the cell floor cannot aim at a drawn piece (18 §9's
        /// surface-accurate picker answers the geometry, not the cell box).
        /// </summary>
        static List<Vector3> ModuleProbePoints(StationWorldView world, StationModuleRecord module) {
            var points = new List<Vector3>(4);
            var bounds = new Bounds();
            bool any = false;
            if (world != null && module != null) {
                foreach (var record in world.Records) {
                    if (!string.Equals(record.ModuleId, module.Id, StringComparison.Ordinal)) continue;
                    if (record.View == null) continue;
                    foreach (var renderer in record.View.GetComponentsInChildren<Renderer>(true)) {
                        if (!renderer || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                        if (!any) { bounds = renderer.bounds; any = true; }
                        else bounds.Encapsulate(renderer.bounds);
                    }
                }
            }
            if (any) {
                var min = StationCoordinates.WorldToDocument(bounds.min);
                var max = StationCoordinates.WorldToDocument(bounds.max);
                var centre = (min + max) * .5f;
                points.Add(centre);
                points.Add(new Vector3(centre.x, centre.y, Mathf.Max(min.z + .01f, max.z - .02f)));
            }
            points.Add(new Vector3(module.X + .5f, module.Y + .5f, module.Z + 1f));
            return points;
        }

        static Vector3 Project(Camera camera, Vector3 worldPoint) => camera.WorldToScreenPoint(worldPoint);

        /// <summary>
        /// A probe must land in the free middle of the viewport: the shell's rails, inspector
        /// and time panels own the edges, so a click there would be a React hit, not a canvas
        /// one.
        /// </summary>
        static bool OnScreen(Vector3 screen) {
            float width = Mathf.Max(1f, Screen.width), height = Mathf.Max(1f, Screen.height);
            return screen.z > 0f &&
                   screen.x > width * 0.25f && screen.x < width * 0.75f &&
                   screen.y > height * 0.28f && screen.y < height * 0.72f;
        }
    }

    /// <summary>
    /// Palette ids for the families whose creation the C# resolver already ports. The
    /// shell's own `paletteIdForModule` remains the authority for every other family;
    /// this answers the same question for a headless verifier and for the migrated set.
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
    /// and the preview host. It follows packet D's after-scene pattern, so the scene needs
    /// no reference and the browser verifier sees `payload.edit` beside `payload.tool`.
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
