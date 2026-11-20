using System;
using System.Collections.Generic;
using Metro.Build;

namespace Metro.View {
    public enum ModuleViewKind {
        /// <summary>A promoted prefab is instanced at the module pivot.</summary>
        Prefab,
        /// <summary>The runtime assembles the piece from the saved dimensions.</summary>
        Generated,
        /// <summary>A prefab whose artwork is repainted from station content.</summary>
        Live,
        /// <summary>The module legitimately draws nothing of its own.</summary>
        None,
        /// <summary>No rule or catalogue entry covers this saved variant.</summary>
        Unresolved,
    }

    public readonly struct ModuleVisual {
        public readonly string Key;
        public readonly ModuleViewKind Kind;
        public readonly string Detail;

        public ModuleVisual(string key, ModuleViewKind kind, string detail) { Key = key ?? ""; Kind = kind; Detail = detail ?? ""; }
        public bool HasModel => Key.Length > 0 && Kind != ModuleViewKind.Unresolved && Kind != ModuleViewKind.None;
        public static readonly ModuleVisual None = new ModuleVisual("", ModuleViewKind.None, "");
    }

    /// <summary>
    /// Resolves a saved module — its type, its authored config and the neighbours it
    /// shares a cell with — to one stable visual key. The key is the palette id for
    /// palette pieces, or an explicit <c>generated:</c>-style key for a piece the
    /// runtime assembles. Pure logic: no engine calls, so the rules are testable.
    ///
    /// The rules trace the TypeScript normalizers one family at a time:
    /// <c>sim/benches.ts</c>, <c>sim/gates.ts</c>, <c>sim/tvs.ts</c>,
    /// <c>sim/billboards.ts</c>, <c>sim/shelves.ts</c>, <c>sim/counters.ts</c>,
    /// <c>render/models/pieces/*Model.ts</c>.
    /// </summary>
    public static class ModuleViews {
        public const string TrackRun = "track-run";
        public const string PillarRun = "pillar-run";
        public const string PlatformEdge = "platform-edge";

        /// <summary>
        /// The visual key for one module, or an empty key with the reason it could not
        /// resolve. `station` is the module list in document order (the tv pair rule
        /// reads it); `views` answers which keys the catalogue actually carries.
        /// </summary>
        public static ModuleVisual Resolve(ModuleFacts module, IReadOnlyList<ModuleFacts> station, IModuleViewSet views) {
            if (module == null) throw new ArgumentNullException(nameof(module));
            if (views == null) throw new ArgumentNullException(nameof(views));
            var type = module.Type ?? "";
            var cfg = module.Config ?? ModuleConfig.Empty;

            ModuleVisual Key(string candidate, string detail = null) {
                if (string.IsNullOrEmpty(candidate)) return new ModuleVisual("", ModuleViewKind.Unresolved, detail ?? "no-key");
                if (!views.Has(candidate)) return new ModuleVisual("", ModuleViewKind.Unresolved, detail ?? "missing-key:" + candidate);
                return new ModuleVisual(candidate, ModuleViewKind.Prefab, detail ?? "");
            }
            ModuleVisual First(params string[] candidates) {
                foreach (var candidate in candidates) {
                    if (!string.IsNullOrEmpty(candidate) && views.Has(candidate)) return new ModuleVisual(candidate, ModuleViewKind.Prefab, "");
                }
                return new ModuleVisual("", ModuleViewKind.Unresolved, "no-variant-key");
            }

            switch (type) {
                case "bench": {
                    // `cfg.auto` marks the room builder's own fit-out; it has no variant and
                    // is the 1 m stainless piece (`benchSpec(undefined)`).
                    if (cfg.Bool("auto")) return Key("bench-steel-1", "auto-fitout");
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "bench-" + variant : "", "bench-steel-1");
                }
                case "bin": return Key("bin");
                case "gate": {
                    var modern = string.Equals(cfg.Text("variant"), "new", StringComparison.Ordinal);
                    var door = cfg.Text("door");
                    // A fence machine still draws the housing; its leaves are shut and the
                    // fence run closes the lane (`sim/gates.ts` `gateHasLane`).
                    var detail = door == "fence" || door == "none" ? "fence-door" : "";
                    return Key(modern ? "gate-new" : "gate", detail);
                }
                case "tvm": return Key("tvm");
                case "vending": return Key("vending");
                case "extinguisher": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 && variant != "standard" ? "extinguisher-" + variant : "", "extinguisher");
                }
                case "electrical-cabinet": return Key("electrical-cabinet");
                case "cctv": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 && variant != "bullet" ? "cctv-" + variant : "", "cctv");
                }
                case "tv": {
                    // Back-to-back pair on one cell: the first in document order hangs the
                    // shared housing, which draws both panes (`sim/tvs.ts` `tvPairSlot`).
                    if (TryPairSlot(module, station, out var hangs)) {
                        return hangs ? Key("tv-double", "pair-housing") : new ModuleVisual("", ModuleViewKind.None, "pair-panel");
                    }
                    return Key("tv");
                }
                case "clock": return Key(string.Equals(cfg.Text("variant"), "digital", StringComparison.Ordinal) ? "clock-digital" : "clock");
                case "monitor": return Key(string.Equals(cfg.Text("mount"), "wall", StringComparison.Ordinal) ? "monitor-wall" : "monitor-ceiling");
                case "linemap": return Key(string.Equals(cfg.Text("mount"), "stand", StringComparison.Ordinal) ? "linemap-stand" : "linemap-wall");
                case "sign": return Key(string.Equals(cfg.Text("mount"), "wall", StringComparison.Ordinal) ? "sign-wall" : "sign-ceiling");
                case "hanger": return Key(string.Equals(cfg.Text("mount"), "post", StringComparison.Ordinal) ? "hanger-post" : "hanger-roof");
                case "glass": {
                    var variant = cfg.Text("variant");
                    if (variant == "curtain-wall") return Key("curtain-wall");
                    return First(variant.Length > 0 ? "glass-" + variant : "", "glass-1x1");
                }
                case "door": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "door-" + variant : "", "door-steel-1");
                }
                case "fence": {
                    var variant = cfg.Text("variant");
                    switch (variant) {
                        case "gate": return Key("fence-gate");
                        case "iron": return Key("fence-iron");
                        case "steel-blue": return Key("fence-steel-blue");
                        // The save stores the source's own variant names (`sim/types.ts`);
                        // the palette aliases below stay for older recipes.
                        case "bridge-railing":
                        case "noise-barrier-railing": return Key("noise-barrier-railing");
                        case "sound-barrier":
                        case "noise-barrier": return Key("noise-barrier");
                        case "sound-barrier-half":
                        case "noise-barrier-half": return Key("noise-barrier-half");
                        default: return Key("fence");
                    }
                }
                case "billboard": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "billboard-" + variant : "", "billboard-wide");
                }
                case "shelf": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "shelf-" + variant : "", "shelf-dark-tall");
                }
                case "checkout": {
                    var variant = cfg.Text("variant");
                    var style = variant == "cafe" || variant == "cafe-pastry" || variant == "generic"
                        ? "checkout-" + variant : "checkout";
                    var length = StationFootprints.CounterLength(module.Width);
                    return Key(length == 1 ? style : $"{style}-{length}m");
                }
                case "exit": {
                    var style = cfg.Text("style");
                    if (style == "virtual") return Key("exit-virtual");
                    var bays = Math.Max(1, cfg.Int("bays", 2));
                    if (style == "doorway") return First("exit-doorway-" + Math.Min(bays, 4), "exit-doorway-1");
                    bool covered = !string.Equals(cfg.Text("covered"), "false", StringComparison.Ordinal);
                    if (covered) return First("exit-covered-" + bays, "exit");
                    return First("exit-uncovered-" + bays, "exit-uncovered-1");
                }
                case "guidepost": return Key("guidepost");
                case "calligraphy": {
                    var style = cfg.Text("style");
                    var axis = cfg.Text("axis");
                    return First(style.Length > 0 && axis.Length > 0 ? "calligraphy-" + style + "-" + axis : "", "calligraphy-kai-h");
                }
                case "tactile": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "tactile-" + variant : "", "tactile-guide");
                }
                case "floor-mark": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "floor-mark-" + variant : "", "floor-mark-boarding");
                }
                case "light": return Key(cfg.Text("variant") == "rectangular" ? "light-rectangular" : "light-circular");
                // Saved pillars range over 3–11 m heights; the palette prefab is one 5 m section.
                case "pillar": return new ModuleVisual(PillarRun, ModuleViewKind.Generated, "");
                case "roof": {
                    var variant = cfg.Text("variant");
                    // The save keeps the source's own variant names (`sim/types.ts`), and the
                    // promoted catalogue row for the tapered truss is `roof-tapered`: the saved
                    // `tapered-truss` used to build the key `roof-tapered-truss`, miss, and fall
                    // back to the flat `roof` tile, which is a 1 m ceiling plate (plan 22 §1).
                    if (variant == "tapered-truss") return Key("roof-tapered", "tapered-truss-alias");
                    return First(variant.Length > 0 ? "roof-" + variant : "", "roof");
                }
                case "court": {
                    var variant = cfg.Text("variant");
                    return First(variant.Length > 0 ? "court-" + variant : "", "court-pickleball");
                }
                case "busstop": {
                    var variant = cfg.Text("variant");
                    return Key(variant == "long" || (variant.Length == 0 && module.Width >= 8) ? "busstop-long" : "busstop-short");
                }
                case "cubicle": return Key(string.Equals(cfg.Text("variant"), "toilet", StringComparison.Ordinal) ? "cubicle-toilet" : "cubicle");
                case "psd-end": return Key(string.Equals(cfg.Text("variant"), "cover", StringComparison.Ordinal) ? "psd-end-cover" : "psd-end");
                case "stair": {
                    // A 楼梯块 is its own promoted piece (`StairBlock.prefab`, a solid 1 m cube of
                    // four treads), not a flight with a style: the saved `cfg.style` of a block is
                    // empty, so falling through to the style table resolved it to `stair-straight`
                    // and instanced a full stair run in a one-metre cell (plan 22 §3).
                    if (cfg.Bool("block")) return Key("stair-block", "block");
                    var style = cfg.Text("style");
                    return First(style.Length > 0 ? "stair-" + style : "", "stair-straight");
                }
                case "sidewalk":
                case "lawn":
                case "tree":
                case "road":
                case "ac-unit":
                case "vent":
                case "desk":
                case "urinal":
                case "sink":
                case "rail-signal":
                case "traffic-light":
                case "booth":
                case "shop":
                case "retail": return Key(type);
                case "escalator": return new ModuleVisual("escalator", ModuleViewKind.Generated, "");
                case "walkway": return new ModuleVisual("walkway", ModuleViewKind.Generated, "");
                case "lift": return new ModuleVisual("lift", ModuleViewKind.Generated, "");
                case "platform-edge": return new ModuleVisual(PlatformEdge, ModuleViewKind.Generated, "");
                case "track": return new ModuleVisual(TrackRun, ModuleViewKind.Generated, "");
                default:
                    return new ModuleVisual("", ModuleViewKind.Unresolved, "unmapped-type:" + type);
            }
        }

        /// <summary>
        /// True when the module is one half of a legal back-to-back 电视 pair on its
        /// cell; `hangs` names the first half in document order, which draws the shared
        /// housing (`sim/tvs.ts`).
        /// </summary>
        public static bool TryPairSlot(ModuleFacts module, IReadOnlyList<ModuleFacts> station, out bool hangs) {
            hangs = true;
            if (station == null || module == null || module.Type != "tv") return false;
            ModuleFacts mate = null;
            int mine = -1, theirs = -1;
            for (int i = 0; i < station.Count; i++) {
                var other = station[i];
                if (other == null || ReferenceEquals(other, module) || other.Type != "tv") continue;
                if (other.X != module.X || other.Y != module.Y || other.Z != module.Z) continue;
                if (NormTurn(other.Rotation - module.Rotation) != 2) continue;
                mate = other; theirs = i;
                break;
            }
            if (mate == null) return false;
            for (int i = 0; i < station.Count; i++) if (ReferenceEquals(station[i], module)) { mine = i; break; }
            if (mine < 0) {
                // Facts built from a copy: fall back to the id ordering the document uses.
                mine = theirs;
                hangs = string.CompareOrdinal(module.Id, mate.Id) < 0;
                return true;
            }
            hangs = mine < theirs;
            return true;
        }

        static int NormTurn(int turn) => ((turn % 4) + 4) % 4;

        /// <summary>A stable signature for an unmatched variant, so diagnostics group by config.</summary>
        public static string Signature(ModuleFacts module) {
            if (module == null) return "null";
            var cfg = module.Config ?? ModuleConfig.Empty;
            var parts = new List<string> { module.Type ?? "" };
            foreach (var key in new[] { "variant", "mount", "door", "dir", "style", "axis", "psd", "covered", "bays", "auto", "poster" }) {
                if (!cfg.Has(key)) continue;
                parts.Add(key + "=" + cfg.Text(key));
            }
            return string.Join("|", parts);
        }
    }
}
