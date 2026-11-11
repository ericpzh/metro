using System;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>Transactional v1 save adapter for the bounded first station.</summary>
    public static class FirstPlayableSave {
        public static string Write(FirstPlayableStation station, DateTimeOffset savedAt) {
            if (station == null) throw new ArgumentNullException(nameof(station));
            var cells = new JArray(); var modules = new JArray();
            if (station.HasFloor) cells.Add(new JObject { ["x"] = 2, ["y"] = 0, ["z"] = 0, ["fill"] = "solid" });
            if (station.HasSecondFloor) cells.Add(new JObject { ["x"] = 2, ["y"] = 1, ["z"] = 0, ["fill"] = "solid" });
            if (station.HasDetourApproach) cells.Add(new JObject { ["x"] = 2, ["y"] = 2, ["z"] = 0, ["fill"] = "solid" });
            if (station.HasDetourFloor) cells.Add(new JObject { ["x"] = 3, ["y"] = 2, ["z"] = 0, ["fill"] = "solid" });
            if (station.HasDetourGate) modules.Add(new JObject { ["id"] = "detour-gate", ["type"] = "gate", ["x"] = 3, ["y"] = 2, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject() });
            if (station.HasSecondGate) modules.Add(new JObject { ["id"] = "second-gate", ["type"] = "gate", ["x"] = 3, ["y"] = 1, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject() });
            if (station.HasGate) modules.Add(new JObject { ["id"] = "first-gate", ["type"] = "gate", ["x"] = 2, ["y"] = 0, ["z"] = 0, ["rot"] = 0, ["cfg"] = new JObject() });
            var input = new JObject { ["format"] = "metro-save", ["formatVersion"] = 1, ["name"] = "First Station", ["seed"] = 7654321,
                ["static"] = new JObject { ["cells"] = cells, ["modules"] = modules, ["lines"] = new JArray() } };
            return StationSaveV1.Read(input.ToString(Formatting.None)).Write(savedAt);
        }
        public static FirstPlayableStation Read(string json) {
            var save = StationSaveV1.Read(json);
            if (save.DroppedCells != 0 || save.DroppedModules != 0 || save.LineCount != 0) throw new FormatException("Unsupported station content");
            var station = new FirstPlayableStation();
            var cells = save.SolidCells(); var gates = save.Gates();
            if (cells.Length != save.CellCount || gates.Length != save.ModuleCount) throw new FormatException("Unsupported station content");
            foreach (var cell in cells) if (!station.PlaceFloor(cell.X, cell.Y, cell.Z)) throw new FormatException("Invalid floor");
            foreach (var gate in gates) if (gate.Rotation != 0 || !station.PlaceGate(gate.X, gate.Y, gate.Z)) throw new FormatException("Invalid gate");
            return station;
        }
    }
}
