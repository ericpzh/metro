using System.Linq;
using Metro.View;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// The generated runtime catalogue: the mapping carries the palette and its views,
/// and placement offsets follow the source pivots.
/// </summary>
public class RuntimeCatalogueAssetTests {
    static RuntimeCatalogue Catalogue() {
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "the runtime catalogue asset is missing; run Metro.Editor.RuntimeCatalogue.Generate");
        return catalogue;
    }

    [Test] public void TheCatalogueCarriesThePaletteAndItsViews() {
        var catalogue = Catalogue();
        Assert.GreaterOrEqual(catalogue.Count, 200, "the mapping covers the 152 palette ids, supplemental variants and city pieces");
        var keys = catalogue.Entries.Select(entry => entry.key).ToArray();
        Assert.AreEqual(keys.Length, keys.Distinct().Count(), "duplicate catalogue key");
        Assert.GreaterOrEqual(catalogue.Entries.Count(entry => entry.palette), 152, "every palette id must be mapped");
        foreach (var entry in catalogue.Entries) {
            if (entry.kind == "generated") Assert.IsNotEmpty(entry.generator, entry.key + " has no generator");
            else Assert.IsNotNull(entry.prefab, entry.key + " has no prefab reference");
        }
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/Tv.prefab", catalogue.Entries.First(entry => entry.key == "tv").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/TvDouble.prefab", catalogue.Entries.First(entry => entry.key == "tv-double").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/Gate.prefab", catalogue.Entries.First(entry => entry.key == "gate").prefabPath);
        Assert.AreEqual("Assets/StationDesigner/Generated/Prefabs/GateNew.prefab", catalogue.Entries.First(entry => entry.key == "gate-new").prefabPath);
    }

    [Test] public void PlacementOffsetsFollowTheSourcePivots() {
        var catalogue = Catalogue();
        Vector3 Offset(string key) => catalogue.Entries.First(entry => entry.key == key).offset;
        Assert.AreEqual(new Vector3(.5f, .782f, 1f), Offset("bin"), "edge-decor bin sits against its trailing wall edge");
        Assert.AreEqual(new Vector3(.5f, .575f, 1f), Offset("bench-steel-2"), "a 2 m bench keeps its source cell pivot with the edge inset");
        Assert.AreEqual(new Vector3(.5f, .575f, 1f), Offset("bench-steel-1"));
        Assert.AreEqual(new Vector3(1f, .09f, 1f), Offset("door-steel-2"), "a two-cell door sits on the leading edge");
        Assert.AreEqual(new Vector3(.5f, .09f, 1f), Offset("door-steel-1"));
        Assert.AreEqual(new Vector3(.5f, .5f, 0f), Offset("psd-end"));
        Assert.AreEqual(new Vector3(.5f, .669873f, 1f), Offset("escalator"));
    }
}
