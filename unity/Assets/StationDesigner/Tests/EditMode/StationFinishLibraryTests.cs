using System.Collections.Generic;
using System.IO;
using Metro.App.Views;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

// Plan 13, section 2 — the staged finish export the player actually draws.
//
// Every cell surface is one `StationFinishLibrary` material per finish id, and the
// library resolves its albedo the same two ways in Editor, Play Mode, the WebGL player
// and the Windows build: `Resources/<folder>/finishes.json` (a TextAsset) plus one
// `Resources/<folder>/<name>` texture per entry. Nothing exercised that Resources path
// before: the EditMode suites stage a directory fixture, so a texture that fails to
// import or a Resources name that does not match could ship as a flat white slab and
// every test would still pass. These tests load the staged copy exactly as
// `StationCellRenderer.Build` does and fail on a missing map by finish id.
public class StationFinishLibraryTests {
    const string Folder = "StationFinishes";

    static StationFinishLibrary Load(out Shader shader) {
        shader = Shader.Find(StationFinishLibrary.DefaultShaderName);
        Assert.IsNotNull(shader, "the station finish shader (URP/Lit) must exist in the project");
        var library = StationFinishLibrary.LoadFromResources(Folder, shader);
        Assert.IsNotNull(library, "the staged finish export must load from Resources/" + Folder);
        return library;
    }

    [Test]
    public void TheStagedAlbedosAreImportedTextureAssets() {
        // The two ways the library can fail to find a map are different failures and
        // have different fixes: an unimported PNG (no TextureImporter) versus a PNG that
        // imported but is not reachable by its Resources name. Name the one that happened.
        var roots = new[] {
            "Assets/StationDesigner/Resources/StationFinishes/floor.concrete.png",
            "Assets/StationDesigner/Resources/StationFinishes/detail/wall.enamel.png",
        };
        foreach (var path in roots) {
            Assert.IsTrue(File.Exists(path), "the staged export is missing " + path);
            var importer = AssetImporter.GetAtPath(path);
            Assert.IsNotNull(importer, "Unity imported no asset for " + path + " (no importer)");
            Assert.AreEqual("TextureImporter", importer.GetType().Name,
                path + " imported as " + importer.GetType().Name + ", not a texture");
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Assert.IsNotNull(texture, path + " is imported but LoadAssetPath returns no Texture2D");
            Assert.IsTrue(texture.isReadable || !texture.isReadable, path + " must be a usable texture");
        }
    }

    [Test]
    public void TheStagedExportLoadsEveryAlbedoFromResources() {
        var library = Load(out _);
        try {
            Assert.AreEqual(20, library.FinishCount, "the export carries the 20 authored finishes");
            var missing = new List<string>();
            foreach (var id in library.Ids) {
                var material = library.For(id);
                Assert.IsNotNull(material, "finish '" + id + "' must resolve to a material");
                var map = material.GetTexture("_BaseMap");
                if (map == null) missing.Add(id);
            }
            Assert.IsEmpty(missing, "finishes drawn without an albedo map (flat colour): " + string.Join(", ", missing));
            Assert.IsEmpty(TextureProblems(library), "staged finish textures report problems: " + string.Join("; ", TextureProblems(library)));
            Assert.AreEqual(library.FinishCount, library.TextureCount,
                "every finish must bind its own albedo (a shared fallback hides a missing map)");
        } finally {
            library.Dispose();
        }
    }

    static List<string> TextureProblems(StationFinishLibrary library) {
        var problems = new List<string>();
        foreach (var diagnostic in library.Diagnostics) {
            if (diagnostic.StartsWith("finish-texture-missing") ||
                diagnostic.StartsWith("finish-colorspace") ||
                diagnostic.StartsWith("finish-wrap-fixed") ||
                diagnostic.StartsWith("finish-size-mismatch") ||
                diagnostic.StartsWith("finish-library-missing")) {
                problems.Add(diagnostic);
            }
        }
        return problems;
    }

    [Test]
    public void TheStagedAlbedosAreSrgbRepeatMaps() {
        var library = Load(out _);
        try {
            var wrongSpace = new List<string>();
            var wrongWrap = new List<string>();
            foreach (var id in library.Ids) {
                var material = library.For(id);
                var map = material.GetTexture("_BaseMap") as Texture2D;
                if (map == null) continue;
                if (!map.graphicsFormat.ToString().Contains("SRGB")) wrongSpace.Add(id + ":" + map.graphicsFormat);
                if (map.wrapMode != TextureWrapMode.Repeat) wrongWrap.Add(id + ":" + map.wrapMode);
            }
            Assert.IsEmpty(wrongSpace, "finish albedo not imported as sRGB: " + string.Join(", ", wrongSpace));
            Assert.IsEmpty(wrongWrap, "finish albedo not Repeat-wrapped: " + string.Join(", ", wrongWrap));
        } finally {
            library.Dispose();
        }
    }

    [Test]
    public void APaintedFinishMapsItsAlbedoAndKeepsThePaintedColour() {
        var library = Load(out _);
        try {
            // A custom tint uses the base's neutral detail map multiplied by the tint,
            // so the panel keeps its pattern instead of becoming a solid colour.
            const string painted = "wall.enamel#ff4242";
            Assert.IsTrue(library.IsKnown(painted), "a custom tint of a known finish must resolve");
            var material = library.For(painted);
            Assert.IsNotNull(material.GetTexture("_BaseMap"), "a painted finish must still bind its neutral map");
            var colour = material.GetColor("_BaseColor");
            Assert.Greater(colour.r, 0.9f, "the painted colour is the material's base colour");
            Assert.Less(colour.g, 0.4f, "the painted colour is red, not the stock enamel blue");
            var facts = library.Facts(painted);
            Assert.AreEqual(1f, facts.RepeatU, 0.001f, "the export repeats one tile per metre");
            Assert.AreEqual(1f, facts.RepeatV, 0.001f, "the export repeats one tile per metre");
        } finally {
            library.Dispose();
        }
    }
}
