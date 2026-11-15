using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// 20 §3 — a 线网图 prints the **city's supplied map**.
    ///
    /// The promoted `linemap-wall`/`linemap-stand` prefabs expose `lineMapPlaceholder`, a drawn
    /// "no lines yet" board, and the display renderer instantiated them with no artwork binding at
    /// all — so a Zoo wall printed the placeholder even though the save has a line. The binder
    /// resolves `cityLineMapSlug` for the committed city (`network-map` for Guangzhou), prints the
    /// exported poster through the shared upright helper, fits it the way `lineMapArt.face` does
    /// and reports an unavailable city by exact name and slug.
    /// </summary>
    public sealed class StationLineMapArtworkTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        const string FontPath = "Assets/StationDesigner/Fonts/NotoSansSC.ttf";

        static StationDocument zoo;
        static RuntimeCatalogue catalogue;
        static Shader shader;
        static Font font;

        [OneTimeSetUp]
        public void Load() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read?.Document, "the Zoo document must load");
            zoo = read.Document;
            catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            Assert.IsNotNull(catalogue, "runtime catalogue asset missing");
            shader = StationFinishLibrary.FindShader();
            Assert.IsNotNull(shader, "the station finish shader is missing");
            font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            Assert.IsNotNull(font, "the CJK font is missing");
        }

        sealed class Built {
            public GameObject Root;
            public StationDisplayModuleRenderer Display;
            public StationWorldView World;
        }

        Built Build(StationDocument document, string name) {
            var root = new GameObject(name);
            var display = new StationDisplayModuleRenderer();
            var world = new StationWorldView(root.transform, name, new IStationViewRenderer[] { display },
                new StationViewAssets { Catalogue = catalogue, Shader = shader, Font = font });
            world.Build(document, new StationIndex(document));
            world.Activate();
            return new Built { Root = root, Display = display, World = world };
        }

        static void Dispose(Built built) {
            built.World?.Dispose();
            if (built.Root) UnityEngine.Object.DestroyImmediate(built.Root);
        }

        /// <summary>A copy of Zoo with a different committed city.</summary>
        static StationDocument WithCity(string city) {
            // The reader repairs an unknown city back to Guangzhou, so an unpackaged city can only
            // be expressed on a clone of the typed document.
            if (city != "guangzhou" && city != "shanghai" && city != "beijing" && city != "chengdu" &&
                city != "chongqing" && city != "wuhan" && city != "nanjing" && city != "shenzhen") {
                var typed = zoo;
                return new StationDocument(typed.Name, typed.NameEn, city, typed.Seed, typed.LevelBase,
                    typed.StoreyHeight, typed.Day, typed.Cells.ToArray(), typed.Modules.ToArray(),
                    typed.Lines.ToArray(), typed.DroppedCells, typed.DroppedModules, typed.Source,
                    typed.SavedAt, typed.NormalizedJson);
            }
            var json = JObject.Parse(File.ReadAllText(ZooPath));
            json["city"] = city;
            var read = StationDocumentReader.Read(json.ToString(Formatting.None), new StationSource("test:city", ""));
            Assert.IsNotNull(read?.Document, "the " + city + " document must load");
            Assert.AreEqual(city, read.Document.City, "the committed city is the one asked for");
            return read.Document;
        }

        /// <summary>`cityLineMapSlug`: Guangzhou prints the network map, every other city its own.</summary>
        [Test]
        public void TheCitySlugFollowsTheCommittedCity() {
            Assert.AreEqual("network-map", StationLineMapArtwork.SlugOf("guangzhou"));
            Assert.AreEqual("network-map", StationLineMapArtwork.SlugOf(""));
            Assert.AreEqual("network-map", StationLineMapArtwork.SlugOf(null));
            Assert.AreEqual("shanghai-map", StationLineMapArtwork.SlugOf("shanghai"));
            Assert.AreEqual("beijing-map", StationLineMapArtwork.SlugOf("Beijing"));
            Assert.AreEqual("shenzhen-map", StationLineMapArtwork.SlugOf("shenzhen"));
            // The exported table carries every city the source supports.
            foreach (var city in new[] { "guangzhou", "shanghai", "beijing", "chengdu", "chongqing", "wuhan", "nanjing", "shenzhen" }) {
                var slug = StationLineMapArtwork.SlugOf(city);
                Assert.IsNotNull(StationLineMapArtwork.Artwork(slug), "no exported poster for " + city + " (" + slug + ")");
            }
            // The fit rule: six filled maps are contained, the network and Shenzhen posters cropped.
            foreach (var slug in new[] { "shanghai-map", "beijing-map", "chengdu-map", "chongqing-map", "wuhan-map", "nanjing-map" })
                Assert.IsTrue(StationLineMapArtwork.Contain(slug), slug + " is fitted whole");
            foreach (var slug in new[] { "network-map", "shenzhen-map" })
                Assert.IsFalse(StationLineMapArtwork.Contain(slug), slug + " is cropped to its panel");
        }

        /// <summary>
        /// Zoo resolves the Guangzhou map, the placeholder's own contribution is replaced, and the
        /// board is upright. A second city resolves its own poster, and a committed city change
        /// refreshes a board that already exists.
        /// </summary>
        [Test]
        public void ZooPrintsTheGuangzhouMapAndASecondCityPrintsItsOwn() {
            var run = Build(zoo, "linemaps");
            try {
                var scope = run.Display.Current.Displays;
                var faces = StationLineMapArtwork.FacesFor(scope);
                Assert.Greater(faces.Count, 0, "the Zoo line maps bound their boards: " +
                    string.Join("; ", scope.Notes.ToList()));
                Assert.AreEqual("network-map", faces[0].Slug, "Zoo is Guangzhou, so it prints the network map");
                foreach (var face in faces) {
                    Assert.AreEqual("guangzhou", face.City);
                    Assert.IsNotNull(face.Surface, "the board resolved a printed surface");
                    Assert.IsTrue(face.Surface.Upright, "the map prints the right way up: " + face.Basis);
                    // The placeholder is gone: the printed plane wears the runtime print material.
                    StringAssert.StartsWith("display print", face.Surface.Renderer.sharedMaterial.name,
                        "the placeholder material still prints on " + face.ModuleId);
                    Assert.IsFalse(scope.Notes.Any(note =>
                        note.StartsWith("linemap-art-missing:", System.StringComparison.Ordinal) &&
                        note.Contains(face.ModuleId)));
                }
                // The stand prints both of its faces; the wall board prints one.
                var byModule = faces.GroupBy(face => face.ModuleId).ToDictionary(group => group.Key, group => group.ToList());
                Assert.Greater(byModule.Count, 0);
                foreach (var pair in byModule) {
                    var facts = zoo.Modules.First(module => module.Id == pair.Key);
                    bool stand = string.Equals(facts.Config.Text("mount"), "stand", System.StringComparison.Ordinal);
                    Assert.AreEqual(stand ? 2 : 1, pair.Value.Count,
                        pair.Key + (stand ? " is a totem and prints both faces" : " is a wall board and prints one"));
                    foreach (var face in pair.Value) {
                        Assert.IsNotNull(StationDisplayArtwork.PosterTexture(face.Surface.Renderer.sharedMaterial),
                            face + " painted no texture");
                        AssertPlateViewerOrientationAndScale(face.Surface.Renderer, !stand, face.ModuleId);
                    }
                }
            } finally {
                Dispose(run);
            }
            var shanghai = WithCity("shanghai");
            var second = Build(shanghai, "linemaps shanghai");
            try {
                var faces = StationLineMapArtwork.FacesFor(second.Display.Current.Displays);
                Assert.Greater(faces.Count, 0);
                Assert.AreEqual("shanghai-map", faces[0].Slug, "a Shanghai station prints its own map");
                Assert.AreEqual(StationDisplayArtwork.PlateFit.Contain, faces[0].Fit,
                    "the filled city maps are fitted whole");
            } finally {
                Dispose(second);
            }
        }

        static void AssertPlateViewerOrientationAndScale(MeshRenderer renderer, bool wallBoard, string label) {
            Assert.IsNotNull(renderer, label + " renderer");
            var filter = renderer.GetComponent<MeshFilter>();
            Assert.IsNotNull(filter?.sharedMesh, label + " sharedMesh");
            var mesh = filter.sharedMesh;
            var vertices = mesh.vertices;
            var normals = mesh.normals;
            var uvs = mesh.uv;
            Assert.GreaterOrEqual(vertices.Length, 4, label + " vertex count");
            Assert.AreEqual(vertices.Length, uvs.Length, label + " uv count");

            // Wall line maps (`LineMapModel.ts`) span 1.80 × 1.80 m inside the 1.92 × 1.94 m frame;
            // they must never shrink to a 0.75 m billboard plate by sharing a generic mesh key.
            if (wallBoard) {
                var worldSize = renderer.bounds.size;
                float planarSpan = Mathf.Max(worldSize.x, worldSize.z);
                Assert.Greater(planarSpan, 1.65f, label + " wall map horizontal span shrunk: " + worldSize);
                Assert.Greater(worldSize.y, 1.65f, label + " wall map vertical span shrunk: " + worldSize);
            }

            var sumNormal = Vector3.zero;
            for (int i = 0; i < normals.Length; i++) sumNormal += normals[i];
            var outwardWorld = renderer.transform.TransformDirection(sumNormal.normalized);
            var lossy = renderer.transform.lossyScale;
            if (lossy.x * lossy.y * lossy.z < 0f) outwardWorld = -outwardWorld;
            outwardWorld.Normalize();
            var upWorld = Vector3.up;
            // In Unity's left-handed world frame, `outwardWorld × upWorld` points to the viewer's right.
            var rightWorld = Vector3.Cross(outwardWorld, upWorld).normalized;

            int leftIdx = 0, rightIdx = 0, bottomIdx = 0, topIdx = 0;
            float minX = float.MaxValue, maxX = float.MinValue, minY = float.MaxValue, maxY = float.MinValue;
            for (int i = 0; i < vertices.Length; i++) {
                var wp = renderer.transform.TransformPoint(vertices[i]);
                float rx = Vector3.Dot(wp, rightWorld);
                float ry = Vector3.Dot(wp, upWorld);
                if (rx < minX) { minX = rx; leftIdx = i; }
                if (rx > maxX) { maxX = rx; rightIdx = i; }
                if (ry < minY) { minY = ry; bottomIdx = i; }
                if (ry > maxY) { maxY = ry; topIdx = i; }
            }
            Assert.Less(uvs[leftIdx].x, uvs[rightIdx].x - .25f,
                label + " U is mirrored left-to-right when viewed from the front");
            Assert.Less(uvs[bottomIdx].y, uvs[topIdx].y - .25f,
                label + " V is upside-down when viewed from the front");
        }

        /// <summary>
        /// A city with no exported poster keeps the placeholder — the source's own drawn-board
        /// fallback — and reports the exact city and slug instead of printing a blank panel.
        /// </summary>
        [Test]
        public void AnUnsupportedCityKeepsThePlaceholderAndIsReportedByExactSlug() {
            var unsupported = WithCity("atlantis");
            var run = Build(unsupported, "linemaps atlantis");
            try {
                var scope = run.Display.Current.Displays;
                Assert.AreEqual(0, StationLineMapArtwork.FacesFor(scope).Count, "no poster, no bound face");
                var missing = scope.Notes.Where(note =>
                    note.StartsWith("linemap-art-missing:", System.StringComparison.Ordinal)).ToList();
                Assert.Greater(missing.Count, 0, "the missing artwork is reported: " + string.Join("; ", scope.Notes.ToList()));
                StringAssert.Contains("city=atlantis", missing[0]);
                StringAssert.Contains("slug=atlantis-map", missing[0]);
                StringAssert.Contains("placeholder-kept", missing[0]);
            } finally {
                Dispose(run);
            }
        }

        [Test]
        public void ZooBillboardsAndTelevisionsPrintUnmirroredUprightPlatesAndDepartureBoards() {
            var run = Build(zoo, "billboards-and-tvs");
            try {
                var scope = run.Display.Current.Displays;
                Assert.Greater(scope.Bound, 0, "Zoo billboards bound");
                Assert.Greater(scope.Surfaces.Count, 0, "Zoo printed surfaces bound");
                foreach (var surface in scope.Surfaces) {
                    AssertPlateViewerOrientationAndScale(surface.Renderer, false, surface.Renderer.name);
                }

                var tvs = StationDisplayTvArtwork.EntriesFor(scope);
                Assert.Greater(tvs.Count, 0, "Zoo televisions bound");

                var session = new Metro.Sim.StationSimulationSession(
                    StationSessionProjection.Setup(zoo, new StationIndex(zoo), "test:zoo"));
                StationDisplayTvArtwork.RefreshPlates(scope, run.World, zoo, session.Snapshot(), true);

                foreach (var entry in tvs) {
                    foreach (var face in entry.Faces) {
                        AssertPlateViewerOrientationAndScale(face.Surface.Renderer, false, face.ModuleId + ":window" + face.Slot);
                        Assert.IsNotNull(face.PlateSurface, face.ModuleId + " departure board surface");
                        AssertPlateViewerOrientationAndScale(face.PlateSurface.Renderer, false, face.ModuleId + ":plate" + face.Slot);
                        Assert.IsFalse(string.IsNullOrEmpty(face.TrackId), face.ModuleId + " cold-boot track forecast");
                        Assert.AreNotEqual(face.Status0, face.Status1, face.ModuleId + " cold-boot arrival progression");
                    }
                }

                var samplePlate = StationDisplayArtwork.PosterTexture(tvs[0].Faces[0].Plate.sharedMaterial);
                Assert.IsNotNull(samplePlate, "TV departure plate texture");
                Assert.AreEqual(960, samplePlate.width);
                Assert.AreEqual(540, samplePlate.height);
                // Top-down y=460 (`540 - 460 = 80` in Texture2D bottom-up coordinates) sits inside the
                // `#080a0c` dark strip (`0.82 H .. 0.90 H`) beneath the ad window (`x = 500`).
                var stripPixel = samplePlate.GetPixel(500, 540 - 460);
                Assert.Less(stripPixel.r, 0.10f, "dark strip beneath ad window must be #080a0c, not blue");
                Assert.Less(stripPixel.b, 0.12f, "dark strip beneath ad window must be #080a0c, not blue");
                // Left sidebar card centre (`x = 90, top-down y = 60` -> `texY = 480`) is crisp white.
                var cardCenter = samplePlate.GetPixel(90, 540 - 60);
                Assert.Greater(cardCenter.r, 0.90f, "departure card interior must be white");
                // Just inside the card's straight top-left shoulder (`x = 30, top-down y = 14` -> `texY = 526`)
                // must still be crisp white (12 px corner radius, not a 100 px blurry oval).
                var cardShoulder = samplePlate.GetPixel(30, 540 - 14);
                Assert.Greater(cardShoulder.r, 0.85f, "departure card must have crisp 12px rounded corners, not an oval");
            } finally {
                Dispose(run);
            }
        }
    }
}
