using System;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// The host's active tool. Plan 11 A6: the React rail may *ask* for a tool, but the
    /// committed selection is C#'s, so a stale UI ack or a second client cannot put the
    /// two sides into different modes. Selecting a tool never edits the document, so
    /// this is a session-scoped command like camera and view.
    ///
    /// The vocabulary is the shell's own (<c>game/src/unity-web/main.tsx</c> maps the
    /// rail's many placement tools onto <c>inspect</c>, <c>floor</c>, <c>gate</c>,
    /// <c>paint</c> and <c>delete</c>); the remaining names are accepted so a later
    /// placement tool does not need a protocol change, and <see cref="Known"/> lets the
    /// UI publish exactly what the host will take.
    /// </summary>
    public static class StationToolSelection {
        public const string Default = "inspect";

        /// <summary>
        /// Every tool name the host accepts, in the shell's order. The names are the shared
        /// UI's own `Tool` union (`game/src/app/store/slices/ToolSlice.ts`) plus the
        /// session names this host had before the canonical set: `floor` and `gate` are
        /// **legacy aliases** normalized at this boundary (plan 27 §2), so an older caller
        /// keeps working while every new one speaks one vocabulary.
        /// </summary>
        public static readonly string[] Known = {
            "select", "pick", "move", "block", "wall", "delete", "module", "paint", "zone", "rail", "tunnel",
            "inspect", "road", "sign",
            // Legacy aliases, kept so the old shell and a packaged player still reach a tool.
            "floor", "gate",
        };

        /// <summary>The tools whose cell gesture owns the secondary button (dig/erase).</summary>
        static readonly string[] EraseTools = { "block", "wall", "delete", "paint", "zone" };
        /// <summary>The tools whose secondary button cancels a carried piece or clears a plan.</summary>
        static readonly string[] CancelTools = { "select", "pick", "move", "module", "rail", "tunnel", "road", "sign" };

        static string active = Default;
        static int generation;
        static int settingsGeneration;

        /// <summary>
        /// The active tool's placement settings, as the shell sends them with
        /// <c>tool.set</c>: the palette id (<c>moduleType</c>), the chosen quarter turn
        /// (<c>rotation</c>), the line a floor mark binds to (<c>lineId</c>), the block
        /// brush's cut modes and 生成墙壁 ring, and every other catalogue setting a tool
        /// reads. Session state, like the tool itself — never part of the document or its
        /// revision.
        /// </summary>
        static readonly JObject settings = new JObject();

        /// <summary>The committed tool name (canonical; never a legacy alias).</summary>
        public static string Active => active;

        /// <summary>Bumped on every accepted **tool** change; a UI can ignore an older ack.</summary>
        public static int Generation => generation;

        /// <summary>Bumped on every accepted **settings** change (`R`, `Tab`, a tile, a slider).</summary>
        public static int SettingsGeneration => settingsGeneration;

        /// <summary>A copy of the committed placement settings (safe to mutate).</summary>
        public static JObject Settings => (JObject)settings.DeepClone();

        public static string Setting(string key) =>
            settings[key] != null && settings[key].Type == JTokenType.String ? (string)settings[key] : "";

        public static int SettingInt(string key, int fallback) {
            var token = settings[key];
            if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) return fallback;
            return (int)token;
        }

        public static double SettingDouble(string key, double fallback) {
            var token = settings[key];
            if (token == null) return fallback;
            if (token.Type == JTokenType.Integer || token.Type == JTokenType.Float) return (double)token;
            if (token.Type == JTokenType.String &&
                double.TryParse((string)token, System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var parsed) &&
                !double.IsNaN(parsed) && !double.IsInfinity(parsed)) {
                return parsed;
            }
            return fallback;
        }

        public static bool SettingBool(string key, bool fallback = false) {
            var token = settings[key];
            if (token == null) return fallback;
            if (token.Type == JTokenType.Boolean) return (bool)token;
            if (token.Type == JTokenType.String) return string.Equals((string)token, "true", StringComparison.OrdinalIgnoreCase);
            if (token.Type == JTokenType.Integer) return (int)token != 0;
            return fallback;
        }

        /// <summary>
        /// What the **secondary** mouse button means for the committed tool, so the shell's
        /// camera adapter can leave a claimed gesture alone instead of starting a pan
        /// (plan 27 §2: "Give right-drag to tools, retain middle orbit and keyboard pan").
        /// </summary>
        public static string RightClaim {
            get {
                for (int i = 0; i < EraseTools.Length; i++)
                    if (string.Equals(EraseTools[i], active, StringComparison.Ordinal)) return "erase";
                // The 设备 palette carries two remove gestures of its own: a 屋顶 tile lifts the
                // piece it is aimed at, and a 支柱 press on a post takes it back down. Both read
                // the secondary button, so the camera must leave it alone (plan 28 §3).
                if (string.Equals(active, "module", StringComparison.Ordinal) && PaletteOwnsSecondary()) return "erase";
                for (int i = 0; i < CancelTools.Length; i++)
                    if (string.Equals(CancelTools[i], active, StringComparison.Ordinal)) return "cancel";
                return "pan";
            }
        }

        /// <summary>True for the 设备 tiles whose own gesture owns the secondary mouse button.</summary>
        static bool PaletteOwnsSecondary() {
            var id = Setting("moduleType") ?? "";
            return id.StartsWith("pillar", StringComparison.Ordinal) ||
                   string.Equals(id, "roof", StringComparison.Ordinal) ||
                   string.Equals(id, "roof-shell", StringComparison.Ordinal) ||
                   string.Equals(id, "roof-truss", StringComparison.Ordinal) ||
                   string.Equals(id, "roof-tapered", StringComparison.Ordinal) ||
                   string.Equals(id, "roof-canopy", StringComparison.Ordinal) ||
                   Metro.Build.StationModuleRuns.SupportsDragPlacement(id);
        }

        /// <summary>
        /// Normalize a requested name to the canonical vocabulary. Returns false with a
        /// stable code when the name is unknown.
        /// </summary>
        public static bool TryNormalize(string requested, out string canonical, out string code) {
            canonical = requested ?? "";
            code = null;
            if (string.IsNullOrEmpty(requested)) { code = "bad-payload"; return false; }
            switch (requested) {
                case "floor":
                    canonical = "block";
                    return true;
                case "gate":
                    // The original 闸机 tile is the `gate` palette entry under 设备.
                    canonical = "module";
                    if (settings["moduleType"] == null) settings["moduleType"] = "gate";
                    return true;
            }
            if (!IsKnown(requested)) { code = "unknown-tool"; return false; }
            return true;
        }

        public static bool IsKnown(string tool) {
            if (string.IsNullOrEmpty(tool)) return false;
            for (int i = 0; i < Known.Length; i++)
                if (string.Equals(Known[i], tool, StringComparison.Ordinal)) return true;
            return false;
        }

        /// <summary>
        /// Select a tool. Returns false with a stable code when the name is unknown; an
        /// unknown request leaves the committed selection untouched.
        /// </summary>
        public static bool TrySelect(string tool, out string previous, out string code) {
            previous = active;
            if (!TryNormalize(tool, out var canonical, out code)) return false;
            code = null;
            if (string.Equals(active, canonical, StringComparison.Ordinal)) return true;
            active = canonical;
            generation++;
            return true;
        }

        /// <summary>
        /// Replace the placement settings; a missing key keeps its committed value, an
        /// explicit null clears it. Returns true when the committed settings really moved,
        /// which is what a still pointer's ghost has to be rebuilt from.
        /// </summary>
        public static bool ApplySettings(JObject request) {
            if (request == null) return false;
            bool changed = false;
            foreach (var pair in request) {
                if (pair.Value == null || pair.Value.Type == JTokenType.Null) {
                    if (settings.Remove(pair.Key)) changed = true;
                    continue;
                }
                var next = pair.Value.DeepClone();
                if (JToken.DeepEquals(settings[pair.Key], next)) continue;
                settings[pair.Key] = next;
                changed = true;
            }
            if (changed) settingsGeneration++;
            return changed;
        }

        public static void Reset() {
            active = Default;
            generation = 0;
            settingsGeneration = 0;
            settings.RemoveAll();
        }

        public static JObject ToJson() => new JObject {
            ["tool"] = active,
            ["generation"] = generation,
            ["settingsGeneration"] = settingsGeneration,
            ["rightClaim"] = RightClaim,
            ["known"] = new JArray(Known),
            ["settings"] = Settings,
        };
    }

    /// <summary>
    /// The <c>tool.set</c> receiver. It acks with the tool the host now owns and the
    /// one it replaced, so the rail can settle on the host's answer instead of
    /// assuming its click won. Placement settings (`payload.settings`) ride the same
    /// command: they are session state, so the selection still never edits the document.
    /// </summary>
    public sealed class StationToolCommandHandler : IStationCommandHandler {
        public string Capability => "tool";

        public bool Handles(string type) =>
            string.Equals(type, "tool.set", StringComparison.Ordinal) ||
            string.Equals(type, "tool.get", StringComparison.Ordinal);

        public bool TryHandle(StationCommand command, JObject payload, out string rejectCode, out string rejectReason) {
            rejectReason = null;
            rejectCode = null;
            if (string.Equals(command.Type, "tool.get", StringComparison.Ordinal)) {
                payload["tool"] = StationToolSelection.Active;
                payload["generation"] = StationToolSelection.Generation;
                payload["settingsGeneration"] = StationToolSelection.SettingsGeneration;
                payload["rightClaim"] = StationToolSelection.RightClaim;
                payload["known"] = new JArray(StationToolSelection.Known);
                payload["settings"] = StationToolSelection.Settings;
                payload["changed"] = false;
                return true;
            }
            var token = payload["tool"];
            if (token == null || token.Type != JTokenType.String) {
                rejectCode = "bad-payload";
                rejectReason = "tool.set needs payload.tool as a string.";
                return false;
            }
            string requested = (string)token;
            string previous;
            string code;
            // The palette id the player had armed before this command: a same-tool swap to another
            // tile is an **owner** change, not a plain replan (plan 28 §2).
            string paletteBefore = StationToolSelection.Setting("moduleType");
            string zoneBrushBefore = StationToolSelection.Setting(StationZoneTool.BrushSetting);
            if (!StationToolSelection.TrySelect(requested, out previous, out code)) {
                rejectCode = code;
                rejectReason = string.Equals(code, "unknown-tool", StringComparison.Ordinal)
                    ? "'" + requested + "' is not a tool this host implements. Known: " + string.Join(", ", StationToolSelection.Known) + "."
                    : "tool.set needs a tool name.";
                return false;
            }
            bool settingsChanged = StationToolSelection.ApplySettings(payload["settings"] as JObject);
            bool toolChanged = !string.Equals(previous, StationToolSelection.Active, StringComparison.Ordinal);
            bool ownerChanged = !string.Equals(paletteBefore, StationToolSelection.Setting("moduleType"),
                StringComparison.Ordinal) ||
                (string.Equals(StationToolSelection.Active, "zone", StringComparison.Ordinal) &&
                 !string.Equals(zoneBrushBefore, StationToolSelection.Setting(StationZoneTool.BrushSetting),
                     StringComparison.Ordinal));
            // A still pointer has to be re-aimed: `R`, `Tab` and every rail/tile setting change
            // what the same pixel now resolves to (`BlockTool.refreshHover`). A tool change also
            // drops any plan the old owner was drawing, so ghost and commit cannot disagree; the
            // same-tool **palette swap** is an owner change too (a 屋顶 bay for a plate, a 支柱
            // for a bench), while a rotation/width/variant change replans and keeps a held press
            // (plan 28 §2).
            var host = StationEditHost.Host;
            if (host != null && host.IsLoaded && (toolChanged || settingsChanged)) {
                if (toolChanged) {
                    StationPointerRouter.OnToolChanged(host);
                    StationPointerRouter.RefreshHover(host);
                } else {
                    StationPointerRouter.OnToolSettingsEdited(host, ownerChanged);
                }
            }
            // An ack never reaches the shell's shared store, and `rightClaim` has to be current
            // the moment the next right press arrives: publish one state frame with the new
            // tool, its claim and the effective settings (plan 27 §2). A same-tool palette swap
            // (e.g. stair -> gate) can also change `rightClaim`, so publish on `ownerChanged` too.
            if (host != null && (toolChanged || ownerChanged)) host.PublishStateNow();
            payload["tool"] = StationToolSelection.Active;
            payload["previous"] = previous;
            payload["generation"] = StationToolSelection.Generation;
            payload["settingsGeneration"] = StationToolSelection.SettingsGeneration;
            payload["rightClaim"] = StationToolSelection.RightClaim;
            payload["known"] = new JArray(StationToolSelection.Known);
            payload["settings"] = StationToolSelection.Settings;
            payload["changed"] = toolChanged;
            payload["settingsChanged"] = settingsChanged;
            return true;
        }
    }

    /// <summary>
    /// Registers the tool receiver once, before the first scene, like every other
    /// feature packet, so the host's router advertises <c>capabilities.tool</c> without
    /// the host knowing about this file.
    /// </summary>
    public static class StationToolFeature {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() => StationCommandHandlers.Add(new StationToolCommandHandler());
    }
}
