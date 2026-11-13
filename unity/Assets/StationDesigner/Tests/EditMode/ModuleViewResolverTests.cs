using Metro.Build;
using Metro.View;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// The resolver turns a saved module into one stable visual key. These cases pin the
/// config normalizers the TypeScript builders own, including legacy records that
/// predate a config field.
/// </summary>
public class ModuleViewResolverTests {
    static readonly IModuleViewSet Views = new SetViewSet(new[] {
        "taxi-stand",
        "bench-steel-1", "bench-steel-2", "bench-seat-1", "bench-seat-2", "bench-wood-1", "bench-wood-2", "bench-office-1",
        "bin", "gate", "gate-new", "tvm", "vending", "extinguisher", "extinguisher-compact", "extinguisher-glass",
        "electrical-cabinet", "cctv", "cctv-ptz", "cctv-dome", "cctv-post", "tv", "tv-double",
        "clock", "clock-digital", "monitor-ceiling", "monitor-wall", "linemap-wall", "linemap-stand",
        "sign-ceiling", "sign-wall", "hanger-roof", "hanger-post", "glass-1x1", "glass-3x2", "curtain-wall",
        "door-steel-1", "door-steel-2", "door-wood-1", "fence", "fence-gate", "fence-iron", "fence-steel-blue",
        "noise-barrier", "billboard-wide", "billboard-large", "shelf-dark-tall", "shelf-cooler-dark", "checkout",
        "checkout-cafe", "exit", "exit-covered-1", "exit-covered-3", "exit-uncovered-1", "exit-uncovered-2",
        "exit-uncovered-3", "exit-doorway-1", "exit-doorway-2", "exit-doorway-3", "exit-doorway-4", "exit-virtual",
        "guidepost", "calligraphy-kai-h", "calligraphy-wei-h", "tactile-guide", "tactile-warning", "floor-mark-boarding",
        "board-mark-waiting", "light-rectangular", "light-circular", "pillar-slim", "pillar-thick", "roof", "roof-truss",
        "court-pickleball", "busstop-short", "busstop-long", "cubicle", "cubicle-toilet", "psd-end", "psd-end-cover",
        "stair-straight", "stair-right180", "escalator", "walkway", "lift", "track-run", "platform-edge",
        "sidewalk", "lawn", "tree", "road", "ac-unit", "vent", "desk", "urinal", "sink", "rail-signal", "pillar-run",
        "traffic-light", "booth", "shop", "retail",
    });

    static ModuleFacts Module(string type, params (string key, string value)[] cfg) {
        var values = new System.Collections.Generic.Dictionary<string, string>();
        foreach (var pair in cfg) values[pair.key] = pair.value;
        return new ModuleFacts { Id = type + "-1", Type = type, Config = new ModuleConfig(values) };
    }

    static string Key(ModuleFacts module, params ModuleFacts[] station) {
        var list = station.Length == 0 ? new[] { module } : station;
        return ModuleViews.Resolve(module, list, Views).Key;
    }

    [Test] public void BenchUsesItsVariantAndFallsBackToTheStainlessOne() {
        Assert.AreEqual("bench-steel-2", Key(Module("bench", ("variant", "steel-2"))));
        Assert.AreEqual("bench-seat-2", Key(Module("bench", ("variant", "seat-2"))));
        Assert.AreEqual("bench-steel-1", Key(Module("bench", ("variant", "galactic"))));
        Assert.AreEqual("bench-steel-1", Key(Module("bench")));
    }

    [Test] public void AutoBenchIsTheRoomFitoutPiece() {
        var bench = Module("bench", ("auto", "true"));
        Assert.AreEqual("bench-steel-1", Key(bench));
    }

    [Test] public void GateDefaultsToTheClassicLaneAndKeepsFenceMachines() {
        Assert.AreEqual("gate", Key(Module("gate", ("dir", "both"), ("door", "lane"))));
        Assert.AreEqual("gate-new", Key(Module("gate", ("variant", "new"), ("door", "lane"))));
        // A fence machine still draws the housing; only the lane is closed.
        var fence = ModuleViews.Resolve(Module("gate", ("door", "fence")), new[] { Module("gate", ("door", "fence")) }, Views);
        Assert.AreEqual("gate", fence.Key);
        Assert.AreEqual("fence-door", fence.Detail);
        // A record written before the door choice existed is a lane gate.
        Assert.AreEqual("gate", Key(Module("gate")));
    }

    [Test] public void CctvVariantsAndTheBulletDefault() {
        Assert.AreEqual("cctv", Key(Module("cctv")));
        Assert.AreEqual("cctv", Key(Module("cctv", ("variant", "bullet"))));
        Assert.AreEqual("cctv-post", Key(Module("cctv", ("variant", "post"))));
        Assert.AreEqual("cctv-ptz", Key(Module("cctv", ("variant", "ptz"))));
        Assert.AreEqual("cctv-dome", Key(Module("cctv", ("variant", "dome"))));
    }

    [Test] public void SingleTvAndBackToBackPair() {
        Assert.AreEqual("tv", Key(Module("tv", ("poster", "landscape-1-jpg"))));
        var first = Module("tv");
        var second = Module("tv");
        second.Id = "tv-2"; second.Rotation = 2;
        var station = new[] { first, second };
        Assert.AreEqual("tv-double", ModuleViews.Resolve(first, station, Views).Key);
        var panel = ModuleViews.Resolve(second, station, Views);
        Assert.AreEqual("", panel.Key);
        Assert.AreEqual(ModuleViewKind.None, panel.Kind, "the housing draws both panes; the second half must not draw a second model");
    }

    [Test] public void QuarterTurnTvsAreNotAPair() {
        var first = Module("tv");
        var second = Module("tv");
        second.Id = "tv-2"; second.Rotation = 1;
        var station = new[] { first, second };
        Assert.AreEqual("tv", ModuleViews.Resolve(first, station, Views).Key);
        Assert.AreEqual("tv", ModuleViews.Resolve(second, station, Views).Key);
    }

    [Test] public void ExitChoosesItsAssembledCanopy() {
        Assert.AreEqual("exit-uncovered-2", Key(Module("exit", ("covered", "false"), ("bays", "2"))));
        Assert.AreEqual("exit-covered-3", Key(Module("exit", ("covered", "true"), ("bays", "3"))));
        Assert.AreEqual("exit", Key(Module("exit", ("bays", "2"))));
        Assert.AreEqual("exit-doorway-3", Key(Module("exit", ("style", "doorway"), ("bays", "3"))));
        Assert.AreEqual("exit-virtual", Key(Module("exit", ("style", "virtual"))));
    }

    [Test] public void MountsSelectTheMountedVariant() {
        Assert.AreEqual("monitor-wall", Key(Module("monitor", ("mount", "wall"))));
        Assert.AreEqual("monitor-ceiling", Key(Module("monitor")));
        Assert.AreEqual("linemap-stand", Key(Module("linemap", ("mount", "stand"))));
        Assert.AreEqual("sign-wall", Key(Module("sign", ("mount", "wall"))));
        Assert.AreEqual("hanger-post", Key(Module("hanger", ("mount", "post"))));
        Assert.AreEqual("hanger-roof", Key(Module("hanger", ("mount", "roof"))));
    }

    [Test] public void DimensionDrivenFamiliesUseTheirGeneratorKeys() {
        Assert.AreEqual("escalator", Key(Module("escalator", ("incline", "30"), ("dir", "up"))));
        Assert.AreEqual("walkway", Key(Module("walkway")));
        Assert.AreEqual("lift", Key(Module("lift", ("rises", "[5,4]"))));
        Assert.AreEqual("stair-right180", Key(Module("stair", ("style", "right180"))));
        Assert.AreEqual("track-run", Key(Module("track", ("line", "5"))));
        Assert.AreEqual("platform-edge", Key(Module("platform-edge", ("psd", "full"))));
        Assert.AreEqual(ModuleViewKind.Generated, ModuleViews.Resolve(Module("escalator"), new[] { Module("escalator") }, Views).Kind);
    }

    [Test] public void UnknownTypesStayUnresolvedAndGroupByConfig() {
        var result = ModuleViews.Resolve(Module("teleporter", ("variant", "warp")), new[] { Module("teleporter") }, Views);
        Assert.AreEqual("", result.Key);
        Assert.AreEqual(ModuleViewKind.Unresolved, result.Kind);
        Assert.AreEqual("unmapped-type:teleporter", result.Detail);
        var missing = ModuleViews.Resolve(Module("bench", ("variant", "steel-9")), new[] { Module("bench") }, Views);
        Assert.AreEqual("bench-steel-1", missing.Key, "an unknown bench variant falls back to the stainless piece");
        Assert.AreEqual("teleporter|variant=warp", ModuleViews.Signature(Module("teleporter", ("variant", "warp"))));
    }

    [Test] public void FenceAndShelfVariantsMapToTheirPaletteRows() {
        Assert.AreEqual("fence", Key(Module("fence")));
        Assert.AreEqual("fence", Key(Module("fence", ("variant", "glass"))));
        Assert.AreEqual("fence-gate", Key(Module("fence", ("variant", "gate"))));
        Assert.AreEqual("fence-iron", Key(Module("fence", ("variant", "iron"))));
        Assert.AreEqual("fence-steel-blue", Key(Module("fence", ("variant", "steel-blue"))));
        Assert.AreEqual("noise-barrier", Key(Module("fence", ("variant", "noise-barrier"))));
        Assert.AreEqual("shelf-cooler-dark", Key(Module("shelf", ("variant", "cooler-dark"))));
        Assert.AreEqual("shelf-dark-tall", Key(Module("shelf")));
        Assert.AreEqual("checkout-cafe", Key(Module("checkout", ("variant", "cafe"))));
        Assert.AreEqual("glass-3x2", Key(Module("glass", ("variant", "3x2"))));
        Assert.AreEqual("door-wood-1", Key(Module("door", ("variant", "wood-1"))));
        Assert.AreEqual("calligraphy-wei-h", Key(Module("calligraphy", ("style", "wei"), ("axis", "h"))));
        Assert.AreEqual("tactile-warning", Key(Module("tactile", ("variant", "warning"))));
        Assert.AreEqual("floor-mark-boarding", Key(Module("floor-mark", ("variant", "boarding"))));
        Assert.AreEqual("light-circular", Key(Module("light", ("variant", "circular"))));
        // Saved pillar heights vary; the 5 m palette section cannot represent them.
        Assert.AreEqual("pillar-run", Key(Module("pillar", ("variant", "thick"), ("height", "4"))));
        Assert.AreEqual("pillar-run", Key(Module("pillar", ("variant", "slim"), ("height", "9"))));
    }

    [Test] public void ConfigFactsReadLegacyAndMissingValues() {
        var empty = ModuleConfig.Empty;
        Assert.AreEqual("", empty.Text("variant"));
        Assert.IsFalse(empty.Bool("auto"));
        Assert.AreEqual(2, empty.Int("bays", 2));
        var values = new System.Collections.Generic.Dictionary<string, string> {
            ["variant"] = "pos", ["auto"] = "true", ["width"] = "1.79", ["flights"] = "[{\"from\":{}}]",
        };
        var cfg = new ModuleConfig(values);
        Assert.AreEqual("pos", cfg.Text("variant"));
        Assert.IsTrue(cfg.Bool("auto"));
        Assert.AreEqual(1.79, cfg.Number("width"), 1e-9);
        Assert.AreEqual("[{\"from\":{}}]", cfg.Json("flights"));
    }
}
