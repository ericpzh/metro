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

        /// <summary>The committed tool name.</summary>
        public static string Active => active;

        /// <summary>Bumped on every accepted selection; a UI can ignore an older ack.</summary>
        public static int Generation => generation;

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

        public static void Reset() {
            active = Default;
            generation = 0;
        }

        public static JObject ToJson() => new JObject {
            ["tool"] = active,
            ["generation"] = generation,
            ["known"] = new JArray(Known),
        };
    }

    /// <summary>
    /// The <c>tool.set</c> receiver. It acks with the tool the host now owns and the
    /// one it replaced, so the rail can settle on the host's answer instead of
    /// assuming its click won.
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
            payload["tool"] = StationToolSelection.Active;
            payload["previous"] = previous;
            payload["generation"] = StationToolSelection.Generation;
            payload["known"] = new JArray(StationToolSelection.Known);
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
