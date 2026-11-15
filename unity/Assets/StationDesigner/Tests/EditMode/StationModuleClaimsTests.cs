using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using Metro.View;
using NUnit.Framework;

// Plan 13 §3 — the module coverage gate.
//
// The Zoo binding report used to count 3,689 authored modules as `no-view:
// no-renderer:<type>` while almost every one of those types already resolved to a live
// RuntimeCatalogue prefab. The two halves of the fix are a renderer that claims the type
// and `StationBindingReport.OwnedByRenderer` agreeing with it; a type that gains a
// renderer but not the whitelist entry keeps reporting `no-renderer`, which is exactly
// the regression these tests catch.
public class StationModuleClaimsTests {
    [Test]
    public void EveryClaimedTypeIsOwnedByTheRendererWhitelist() {
        var missing = new List<string>();
        foreach (var type in StationModuleClaims.AllTypes) {
            if (!StationBindingReport.OwnedByRenderer(type)) missing.Add(type);
        }
        Assert.IsEmpty(missing, "claimed by a renderer but not by the binding whitelist: " + string.Join(", ", missing));
    }

    [Test]
    public void TheClaimedGroupsCoverTheZooNoViewTypes() {
        // The 30 types the Zoo playtest reported as unclaimed, minus the deliberate
        // back-to-back TV halves (handled by the display renderer with `tv`).
        string[] zoo = {
            "sidewalk", "lawn", "light", "billboard", "tactile", "floor-mark", "cctv", "desk",
            "extinguisher", "bin", "bench", "tv", "clock", "shelf", "electrical-cabinet",
            "calligraphy", "track", "monitor", "tvm", "linemap", "sink", "rail-signal",
            "guidepost", "vending", "exit", "vent", "glass", "checkout", "booth", "ac-unit",
        };
        var missing = new List<string>();
        foreach (var type in zoo) {
            if (!StationModuleClaims.Owns(type)) missing.Add(type);
        }
        Assert.IsEmpty(missing, "Zoo types no group claims: " + string.Join(", ", missing));
        Assert.AreEqual(30, new HashSet<string>(zoo).Count, "the worklist has 30 distinct types");
        // Structure families generated directly from committed dimensions (`roof`, `pillar`, `hanger`).
        foreach (var type in new[] { "roof", "pillar", "hanger" }) {
            Assert.AreEqual(StationModuleClaims.Structure, StationModuleClaims.GroupOf(type),
                type + " is owned by the structure renderer");
        }
        // Tianhe Park's indoor sports enclosure uses `court` (`pickleball`, `badminton`, `divider`).
        Assert.AreEqual(StationModuleClaims.Equipment, StationModuleClaims.GroupOf("court"),
            "court is owned by the equipment renderer");
    }

    [Test]
    public void EachGroupHasItsOwnRoleAndDoesNotOverlap() {
        var seen = new Dictionary<string, string>();
        foreach (var type in StationModuleClaims.AllTypes) {
            var group = StationModuleClaims.GroupOf(type);
            Assert.IsFalse(seen.ContainsKey(type), type + " is claimed by two groups");
            seen[type] = group;
        }
        Assert.AreEqual(5, new HashSet<string>(seen.Values).Count,
            "five groups: surfaces, street, equipment, displays, structure");
    }

    [Test]
    public void TheRenderersPublishTheirRoles() {
        // `StationRenderers` is filled by `[RuntimeInitializeOnLoadMethod]`, which does not
        // run in EditMode, so the roles are read from the renderers themselves; the
        // registration call site is pinned by the browser run (`state.render.groups`).
        var renderers = new IStationViewRenderer[] {
            new StationSurfaceModuleRenderer(),
            new StationStreetModuleRenderer(),
            new StationEquipmentModuleRenderer(),
            new StationDisplayModuleRenderer(),
            new StationStructureModuleRenderer(),
            new StationGridRenderer(),
            new StationOverlayRenderer(),
        };
        var roles = new HashSet<string>();
        foreach (var renderer in renderers) roles.Add(renderer.Role);
        foreach (var role in new[] { StationModuleClaims.Surfaces, StationModuleClaims.Street, StationModuleClaims.Equipment, StationModuleClaims.Displays, StationModuleClaims.Structure, StationGridRenderer.RoleName, StationOverlayRenderer.RoleName }) {
            Assert.IsTrue(roles.Contains(role), "no renderer for role '" + role + "'");
        }
        Assert.AreEqual(7, roles.Count, "each renderer owns a distinct role");
    }

}
