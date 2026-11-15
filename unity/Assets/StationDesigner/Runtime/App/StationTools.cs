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

        /// <summary>Every tool name the host accepts, in the shell's order.</summary>
        public static readonly string[] Known = {
            "inspect", "floor", "gate", "paint", "delete",
            "select", "pick", "move", "rail", "module", "zone", "road", "sign",
        };

        static string active = Default;
        static int generation;

        /// <summary>
        /// The active tool's placement settings, as the shell sends them with
        /// <c>tool.set</c>: the palette id (<c>moduleType</c>), the chosen quarter turn
        /// (<c>rotation</c>), the line a floor mark binds to (<c>lineId</c>) and an
        /// explicit variant/width for a palette family that cycles them. Session state,
        /// like the tool itself — never part of the document or its revision.
        /// </summary>
        static readonly JObject settings = new JObject();

        /// <summary>The committed tool name.</summary>
        public static string Active => active;

        /// <summary>Bumped on every accepted selection; a UI can ignore an older ack.</summary>
        public static int Generation => generation;

        /// <summary>A copy of the committed placement settings (safe to mutate).</summary>
        public static JObject Settings => (JObject)settings.DeepClone();

        public static string Setting(string key) =>
            settings[key] != null && settings[key].Type == JTokenType.String ? (string)settings[key] : "";

        public static int SettingInt(string key, int fallback) {
            var token = settings[key];
            if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) return fallback;
            return (int)token;
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
            if (string.IsNullOrEmpty(tool)) { code = "bad-payload"; return false; }
            if (!IsKnown(tool)) { code = "unknown-tool"; return false; }
            code = null;
            if (string.Equals(active, tool, StringComparison.Ordinal)) return true;
            active = tool;
            generation++;
            return true;
        }

        /// <summary>Replace the placement settings; a missing key keeps its committed value.</summary>
        public static void ApplySettings(JObject request) {
            if (request == null) return;
            foreach (var pair in request) {
                if (pair.Value == null || pair.Value.Type == JTokenType.Null) settings.Remove(pair.Key);
                else settings[pair.Key] = pair.Value.DeepClone();
            }
        }

        public static void Reset() {
            active = Default;
            generation = 0;
            settings.RemoveAll();
        }

        public static JObject ToJson() => new JObject {
            ["tool"] = active,
            ["generation"] = generation,
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
            if (!StationToolSelection.TrySelect(requested, out previous, out code)) {
                rejectCode = code;
                rejectReason = string.Equals(code, "unknown-tool", StringComparison.Ordinal)
                    ? "'" + requested + "' is not a tool this host implements. Known: " + string.Join(", ", StationToolSelection.Known) + "."
                    : "tool.set needs a tool name.";
                return false;
            }
            StationToolSelection.ApplySettings(payload["settings"] as JObject);
            payload["tool"] = StationToolSelection.Active;
            payload["previous"] = previous;
            payload["generation"] = StationToolSelection.Generation;
            payload["known"] = new JArray(StationToolSelection.Known);
            payload["settings"] = StationToolSelection.Settings;
            payload["changed"] = !string.Equals(previous, StationToolSelection.Active, StringComparison.Ordinal);
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
