using System.Collections.Generic;
using System.IO;
using System.Linq;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Metro.View;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Metro.EditModeTests {
    /// <summary>
    /// 18 §4 — the wall station name. Zoo's eight `calligraphy-wei-h-*` inscriptions are a
    /// 站名 prop whose plate is painted from the **committed** station name (`动物园`),
    /// never the promoted prefab's baked review-document sample. The binder keeps the
    /// authored ink mesh and UV (so a round pillar host's curved mapping and the saved face
    /// survive untouched) and only swaps in an instance material carrying the painted panel.
    ///
    /// The layout numbers are `sim/calligraphy.ts` + `render/calligraphyFace.ts`: a 横排 run
    /// fills the panel's width, a 竖排 one its height, the pad is 0.3 m split between the
    /// ends, and the glyph is `min(0.85, slot × 0.92)`.
    /// </summary>
    public sealed class StationCalligraphyArtworkTests {
        const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";
        /// <summary>The scene's bound CJK typeface (`Bootstrap.FontPath`).</summary>
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
            Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
            shader = StationFinishLibrary.FindShader();
            Assert.IsNotNull(shader, "the station finish shader is missing");
            font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            Assert.IsNotNull(font, "the CJK font is missing: " + FontPath);
            Assert.AreEqual(8, zoo.Modules.Count(module => module.Type == "calligraphy"), "the Zoo inscription count changed");
        }

        /* ------------------------------------------------------------- harness */

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

        static StationDocument Rename(StationDocument source, string name, string nameEn) {
            var json = JObject.Parse(File.ReadAllText(ZooPath));
            json["name"] = name;
            json["nameEn"] = nameEn;
            var read = StationDocumentReader.Read(json.ToString(Formatting.None), new StationSource("test:rename", ""));
            Assert.IsNotNull(read?.Document, "the renamed document must load");
            return read.Document;
        }

        static MeshRenderer Ink(StationDisplayModuleRenderer display, string moduleId) {
            var built = display.Current.Modules.FirstOrDefault(module => module.ModuleId == moduleId);
            Assert.IsNotNull(built, "no display view for " + moduleId);
            return StationCalligraphyArtwork.FindInkRenderer(built.View);
        }

        static Texture2D Panel(MeshRenderer renderer) =>
            renderer && renderer.sharedMaterial && renderer.sharedMaterial.HasProperty("_BaseMap")
                ? renderer.sharedMaterial.GetTexture("_BaseMap") as Texture2D
                : null;

        /* --------------------------------------------------------------- tests */

        [Test]
        public void EveryZooInscriptionPrintsTheCommittedStationName() {
            Assert.AreEqual("动物园", zoo.Name, "the Zoo document's name");
            var run = Build(zoo, "calligraphy");
            try {
                var notes = run.Display.CalligraphyNotes
                    .Where(note => note.StartsWith(StationCalligraphyArtwork.NotePrefix, System.StringComparison.Ordinal))
                    .ToList();
                Assert.AreEqual(8, notes.Count, "one ledger line per inscription: " + string.Join("; ", run.Display.CalligraphyNotes));
                foreach (var module in zoo.Modules.Where(candidate => candidate.Type == "calligraphy")) {
                    var ink = Ink(run.Display, module.Id);
                    Assert.IsNotNull(ink, module.Id + " has no ink surface");
                    var material = ink.sharedMaterial;
                    StringAssert.Contains("calligraphy ink", material.name,
                        module.Id + " still wears the prefab's baked sample material");
                    var panel = Panel(ink);
                    Assert.IsNotNull(panel, module.Id + " painted no panel");
                    var note = notes.First(line => line.Contains(module.Id));
                    StringAssert.Contains("calligraphy-ink:" + module.Id + ":calligraphy|动物园|", note);
                    StringAssert.Contains(":glyphs=3:en=0", note);
                }
                // The plate is the ink alone: alpha 0 where the strokes are not.
                if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null) {
                    var texture = Panel(Ink(run.Display, "calligraphy-wei-h-365"));
                    int opaque = 0;
                    int leftThird = 0, middleThird = 0, rightThird = 0;
                    int texW = texture.width;
                    var pixels = texture.GetPixels32();
                    for (int idx = 0; idx < pixels.Length; idx++) {
                        if (pixels[idx].a <= 8) continue;
                        opaque++;
                        int px = idx % texW;
                        if (px < texW / 3) leftThird++;
                        else if (px < (texW * 2) / 3) middleThird++;
                        else rightThird++;
                    }
                    Assert.Greater(opaque, 200, "the painted panel carries the strokes");
                    Assert.Less(opaque, pixels.Length / 4, "the surrounding plate must stay transparent");
                    Assert.Greater(leftThird, 50, "first character 动 must be painted in the left third");
                    Assert.Greater(middleThird, 50, "second character 物 must be painted in the middle third");
                    Assert.Greater(rightThird, 50, "third character 园 must be painted in the right third (never clipped)");
                }
            } finally {
                Dispose(run);
            }
        }

        [Test]
        public void TheAuthoredInkMeshAndUvSurviveTheRepaint() {
            // The promoted prefab's own plate, measured before any binding.
            Assert.IsTrue(catalogue.TryGet("calligraphy-wei-h", out var entry), "the 魏碑 横排 prefab resolves");
            var prefab = entry.prefab;
            Assert.IsNotNull(prefab, "the promoted inscription prefab exists");
            var prefabInk = StationCalligraphyArtwork.FindInkRenderer(prefab);
            Assert.IsNotNull(prefabInk, "the promoted inscription has an ink surface: " +
                string.Join(" | ", prefab.GetComponentsInChildren<MeshRenderer>(true).Select(renderer =>
                    renderer.transform.name + "=" + string.Join(",", renderer.sharedMaterials.Select(material =>
                        material ? material.name : "null")))));
            var prefabMesh = prefabInk.GetComponent<MeshFilter>().sharedMesh;
            var uvs = prefabMesh.uv;
            Assert.GreaterOrEqual(uvs.Length, 4, "the plate is a mapped surface");

            var run = Build(zoo, "calligraphy uv");
            try {
                var ink = Ink(run.Display, "calligraphy-wei-h-365");
                var mesh = ink.GetComponent<MeshFilter>().sharedMesh;
                Assert.AreSame(prefabMesh, mesh, "the authored plate mesh is reused, never rebuilt");
                CollectionAssert.AreEqual(uvs, mesh.uv, "the authored UV mapping is untouched");
                Assert.AreEqual(prefabMesh.bounds, mesh.bounds, "the plate's plane and size are untouched");
            } finally {
                Dispose(run);
            }
        }

        [Test]
        public void ARenameRepaintsThePlateAndTheOptInEnglishLineAddsAPanel() {
            var run = Build(zoo, "calligraphy zoo");
            try {
                var first = Panel(Ink(run.Display, "calligraphy-wei-h-365"));
                Assert.IsNotNull(first);
                var renamed = Rename(zoo, "测试站", "Test");
                var other = Build(renamed, "calligraphy renamed");
                try {
                    var ink = Ink(other.Display, "calligraphy-wei-h-365");
                    var second = Panel(ink);
                    Assert.IsNotNull(second, "the renamed station painted no panel");
                    Assert.AreNotSame(first, second, "a rename must not reuse the old plate");
                    var note = other.Display.CalligraphyNotes.First(line => line.Contains("calligraphy-wei-h-365"));
                    StringAssert.Contains("calligraphy|测试站|", note);
                    StringAssert.Contains(":glyphs=3:en=0", note, "the English line is opt-in and this module does not opt in");
                } finally {
                    Dispose(other);
                }
            } finally {
                Dispose(run);
            }
        }

        [Test]
        public void LayoutMatchesTheSourcePanelNumbers() {
            // 横排: w 4 m, pad 0.3 m, three characters.
            var horizontal = StationCalligraphyArtwork.Layout("动物园", "h", "wei", new Vector2(4f, 1f));
            Assert.AreEqual(3, horizontal.Count);
            float slot = (4f - .3f) / 3f;
            float size = Mathf.Min(.85f, slot * .92f);
            for (int i = 0; i < 3; i++) {
                Assert.AreEqual(.15f + slot * (i + .5f), horizontal[i].X, 1e-4f, "横排 glyph " + i + " x");
                Assert.AreEqual(.5f, horizontal[i].Y, 1e-4f, "横排 glyph " + i + " sits on the centre line");
                Assert.AreEqual(size, horizontal[i].Size, 1e-4f, "横排 glyph " + i + " size");
                Assert.AreEqual("动物园"[i], horizontal[i].Char);
                // The wash is stable: the same text lays out identically on every rebuild.
                Assert.AreEqual(StationCalligraphyArtwork.Jitter("动物园"[i], i + 97) * .035f, horizontal[i].Turn, 1e-6f);
            }
            // 竖排: one column down the height.
            var vertical = StationCalligraphyArtwork.Layout("动物园", "v", "wei", new Vector2(1f, 1.6f));
            float columnSlot = (1.6f - .3f) / 3f;
            for (int i = 0; i < 3; i++) {
                Assert.AreEqual(.5f, vertical[i].X, 1e-4f, "竖排 glyph " + i + " x");
                Assert.AreEqual(.15f + columnSlot * (i + .5f), vertical[i].Y, 1e-4f, "竖排 glyph " + i + " y");
                Assert.AreEqual(Mathf.Min(.85f, columnSlot * .92f), vertical[i].Size, 1e-4f, "竖排 glyph " + i + " size");
            }
            // An unknown hand falls back to 楷书, exactly like `calligraphyStyle`.
            Assert.AreEqual("kai", StationCalligraphyArtwork.Style("nonesuch").Key);
            Assert.AreEqual("wei", StationCalligraphyArtwork.Style("wei").Key);
            Assert.AreEqual(new Vector2(4f, 1f), StationCalligraphyArtwork.PanelSize("h", 4f, 1f));
        }

        [Test]
        public void TheContentKeySeparatesRenameEnglishStyleAxisAndPanel() {            var panel = new Vector2(4f, 1f);
            var baseline = StationCalligraphyArtwork.ContentKey("动物园", "Zoo", false, "wei", "h", panel);
            Assert.AreNotEqual(baseline, StationCalligraphyArtwork.ContentKey("测试站", "Zoo", false, "wei", "h", panel),
                "a rename is a different plate");
            Assert.AreNotEqual(baseline, StationCalligraphyArtwork.ContentKey("动物园", "Zoo", true, "wei", "h", panel),
                "the opt-in English line is a different plate");
            Assert.AreNotEqual(baseline, StationCalligraphyArtwork.ContentKey("动物园", "Zoo", false, "kai", "h", panel),
                "the hand is part of the key");
            Assert.AreNotEqual(baseline, StationCalligraphyArtwork.ContentKey("动物园", "Zoo", false, "wei", "v", panel),
                "the axis is part of the key");
            Assert.AreNotEqual(baseline, StationCalligraphyArtwork.ContentKey("动物园", "Zoo", false, "wei", "h",
                new Vector2(5f, 1f)), "the panel dimensions are part of the key");
            // A rename with the English line off keeps the same key suffix for the run.
            Assert.AreEqual(baseline, StationCalligraphyArtwork.ContentKey("动物园", "Zoo", false, "wei", "h",
                new Vector2(4f, 1f)));
        }

        /* ---------------------------------------- billboards (plan 18 §2) */

        static MeshRenderer Poster(StationDisplayModuleRenderer display, string moduleId) {
            var built = display.Current.Modules.FirstOrDefault(module => module.ModuleId == moduleId);
            Assert.IsNotNull(built, "no display view for " + moduleId);
            return StationDisplayArtwork.FindPosterRenderer(built.View);
        }

        /// <summary>
        /// 18 §2 — a billboard prints **its own saved poster**. 97 Zoo billboards across 37
        /// authored slugs all showed the review document's one baked sample; the binder gives
        /// each its slug's texture on the authored `billboardPoster` plate.
        /// </summary>
        [Test]
        public void EveryZooBillboardPrintsItsOwnSavedSlug() {
            var run = Build(zoo, "billboards");
            try {
                var ledger = run.Display.BillboardNotes
                    .Where(note => note.StartsWith(StationDisplayArtwork.LedgerPrefix, System.StringComparison.Ordinal))
                    .ToList();
                Assert.AreEqual(97, ledger.Count, "one ledger line per Zoo billboard: " + string.Join("; ", run.Display.BillboardNotes.Take(4)));
                var first = Poster(run.Display, "billboard-large-131");
                var second = Poster(run.Display, "billboard-large-132");
                Assert.IsNotNull(first, "billboard-large-131 has no poster surface");
                Assert.IsNotNull(second, "billboard-large-132 has no poster surface");
                var firstTexture = StationDisplayArtwork.PosterTexture(first.sharedMaterial);
                var secondTexture = StationDisplayArtwork.PosterTexture(second.sharedMaterial);
                Assert.IsNotNull(firstTexture, "the poster's texture is bound");
                Assert.IsNotNull(secondTexture, "the second poster's texture is bound");
                Assert.AreEqual("landscape-10-jpg", firstTexture.name, "billboard-large-131 prints its saved slug");
                Assert.AreEqual("landscape-12-jpg", secondTexture.name, "billboard-large-132 prints its saved slug");
                Assert.AreNotSame(firstTexture, secondTexture, "two named billboards resolve different textures");
                var note = ledger.First(line => line.Contains("billboard-large-131"));
                StringAssert.Contains(":landscape-10-jpg:", note);
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The plate is static: the binder reads no wall clock and caches one material per
        /// (slug, panel), so a rebuild or a passing second cannot change the advertisement.
        /// </summary>
        [Test]
        public void ABillboardPosterIsFixedAndReusedForItsSlug() {
            var run = Build(zoo, "billboards fixed");
            try {
                var before = Poster(run.Display, "billboard-large-131");
                var material = before.sharedMaterial;
                var built = run.Display.Current.Modules.First(module => module.ModuleId == "billboard-large-131");
                var scope = run.Display.Current.Displays;
                Assert.IsNotNull(scope, "the world owns its billboard scope");
                Assert.IsTrue(StationDisplayArtwork.BindBillboard(scope, built.View,
                        zoo.Modules.First(m => m.Id == "billboard-large-131").Facts),
                    "rebinding the same billboard succeeds");
                Assert.AreSame(material, before.sharedMaterial, "the same slug reuses its material: the plate cannot drift");
                // One material per distinct (slug, plate) — not one per billboard.
                Assert.Less(scope.Materials.Count, 97, "billboards on the same slug share their material");
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The crop is `panelUvWindow`: a poster fitted to its panel by a centred UV window,
        /// never stretched. A 16:9 image on a 2.25:1 panel keeps the full width and crops the
        /// top/bottom; the material's texture scale carries that window.
        /// </summary>        [Test]
        public void ThePosterCropMatchesTheSourcePanelWindow() {
            var window = StationDisplayArtwork.UvWindow(1920f, 1080f, new Vector2(2.25f, 1f));
            Assert.AreEqual(0f, window.x, 1e-5f, "a wider panel keeps the whole image width");
            Assert.AreEqual(1f, window.y, 1e-5f);
            float keep = (1920f / 1080f) / 2.25f;
            Assert.AreEqual((1f - keep) * .5f, window.z, 1e-5f, "the crop is centred vertically");
            Assert.AreEqual(1f - (1f - keep) * .5f, window.w, 1e-5f);
            // An exact aspect match is the whole image.
            var exact = StationDisplayArtwork.UvWindow(1600f, 900f, new Vector2(16f, 9f));
            Assert.AreEqual(new Vector4(0f, 1f, 0f, 1f), exact, "an exact match shows the whole poster");
        }

        /* ------------------------------------- televisions (plan 20 §1) */

        const string Locale = "zh-CN";

        static StationClockFrame Clock(string text, string dateKey = "2026-01-01", int weekday = 4) {
            var parts = text.Split(':');
            int hour = int.Parse(parts[0], System.Globalization.CultureInfo.InvariantCulture);
            int minute = int.Parse(parts[1], System.Globalization.CultureInfo.InvariantCulture);
            double seconds = hour * 3600 + minute * 60;
            return new StationClockFrame {
                Clock = text, ClockSeconds = text + ":00", DateKey = dateKey, Weekday = weekday,
                TimeOfDaySeconds = (int)seconds,
                HourHandDegrees = (seconds % 43200) / 3600 * 30,
                MinuteHandDegrees = (seconds % 3600) / 60 * 6,
                Playing = false,
            };
        }

        static StationMotionFrame Frame(StationClockFrame clock, params StationTrainFrame[] trains) =>
            new StationMotionFrame { Clock = clock, Trains = trains };

        static StationTrainFrame Train(string lineId, string trackId, TrainPhase phase,
            double[] arrivals = null, bool[] atPlatform = null) => new StationTrainFrame {
                Id = lineId + "|" + trackId, LineId = lineId, TrackId = trackId, Phase = phase,
                ArrivalSeconds = arrivals, ArrivalAtPlatform = atPlatform,
            };

        static IEnumerable<StationDisplayTvArtwork.TvFace> Faces(StationDisplayArtwork.Scope scope) =>
            StationDisplayTvArtwork.EntriesFor(scope).SelectMany(entry => entry.Faces);

        /// <summary>
        /// 20 §1 — one emitted `tv-double` root stands for **two** saved televisions, and each has
        /// its own saved poster, its own sample point and its own screen. The 18-era binder kept
        /// `plates[0]` only, so the second face printed the first one's board; this pins the pair.
        /// </summary>
        [Test]
        public void ATvDoubleBindsBothSavedTelevisionsAndTheirOwnBoards() {
            var run = Build(zoo, "televisions pair");
            try {
                var scope = run.Display.Current.Displays;
                Assert.IsNotNull(scope, "the world owns its display scope");
                var faces = Faces(scope).ToList();
                Assert.Greater(faces.Count, 0, "the Zoo televisions bound their content windows: " +
                    string.Join("; ", scope.Notes.Take(6)));
                var paired = StationDisplayTvArtwork.EntriesFor(scope).FirstOrDefault(entry => entry.Faces.Count >= 2);
                Assert.IsNotNull(paired, "a `tv-double` must bind both of its faces");
                Assert.AreEqual(2, paired.Faces.Count, "a back-to-back pair carries exactly two screens");
                Assert.AreNotEqual(paired.Faces[0].ModuleId, paired.Faces[1].ModuleId,
                    "the two faces are two different saved televisions");
                Assert.AreEqual(0, paired.Faces[0].Slot);
                Assert.AreEqual(1, paired.Faces[1].Slot);
                Assert.IsNotNull(paired.Faces[1].Plate, "the pair's second departure board is bound too");
                // Each face prints its **own** saved slug, and the pair's two are independent.
                foreach (var face in paired.Faces) {
                    var facts = zoo.Modules.First(module => module.Id == face.ModuleId);
                    var slug = facts.Config.Text("poster");
                    if (slug.Length == 0) continue;
                    Assert.AreEqual(slug, face.PosterSlug, face.ModuleId + " prints its own saved poster");
                }
                Assert.AreNotEqual(paired.Faces[0].Deadline, paired.Faces[1].Deadline,
                    "the pair's two screens run independent deadlines");
                // Every bound face's window carries a catalogue texture, and each module is bound once.
                var ids = new HashSet<string>(System.StringComparer.Ordinal);
                foreach (var face in faces) {
                    Assert.IsTrue(ids.Add(face.ModuleId + "#" + face.Slot), "a face was bound twice: " + face);
                    Assert.IsNotNull(face.Window, face + " has no content window");
                    Assert.IsTrue(face.PosterSlug.Length > 0, face + " printed no poster");
                    Assert.IsNotNull(StationDisplayTvArtwork.PosterTextureOf(face), face + " has no poster texture");
                    Assert.IsTrue(face.Surface != null && face.Surface.Upright,
                        face + " is not upright: " + (face.Surface != null ? face.Surface.Basis : "no-surface"));
                    Assert.IsNotNull(face.Plate, face + " has no departure board");
                    Assert.IsTrue(face.PlateSurface != null && face.PlateSurface.Upright,
                        face + " departure board is not upright");
                    StringAssert.Contains("|06:30|1月1日|", face.PlateKey,
                        face + " must paint its initial departure board and clock immediately on build");
                }
                if (SystemInfo.graphicsDeviceType != UnityEngine.Rendering.GraphicsDeviceType.Null) {
                    var plateTex = StationDisplayArtwork.PosterTexture(faces[0].Plate.sharedMaterial);
                    Assert.IsNotNull(plateTex, "initial TV departure board texture is bound");
                    // In Texture2D (bottom-left origin), the dark strip between poster bottom (442.8 px from top)
                    // and footer strip top (486 px from top) sits around y = 540 - 465 = 75 px, x = 480 px.
                    var darkBand = plateTex.GetPixel(480, 75);
                    Assert.Less(darkBand.b, .12f, "band beneath TV poster must be #080a0c dark, never #258cdd blue");
                }
                // Every saved television is one face: a pair contributes both halves, so the
                // distinct module count is the module count itself, never plus the panels.
                Assert.AreEqual(zoo.Modules.Count(module => module.Type == "tv"), Faces(scope)
                    .Select(face => face.ModuleId).Distinct().Count(),
                    "every Zoo television has a face (a pair covers both halves)");
            } finally {
                Dispose(run);
            }
        }

        /// <summary>The pair's second half draws no prefab of its own (`ModuleViewKind.None`).</summary>
        static int ZooPainters(StationDocument document) {
            var facts = new List<ModuleFacts>();
            foreach (var other in document.Modules) facts.Add(other.Facts);
            int panels = 0;
            foreach (var module in document.Modules.Where(candidate => candidate.Type == "tv")) {
                if (Metro.View.ModuleViews.TryPairSlot(module.Facts, facts, out bool hangs) && !hangs) panels++;
            }
            return panels;
        }

        /// <summary>
        /// 20 §1 — the board selects the **nearest service track in 3D** to the screen and lists
        /// its own three forecasts. The 18-era painter folded every live train into one global
        /// minimum and read the direction off "is slot zero active", so every board printed the
        /// same train; this pins the source's three separate cards, both termini and the six-second
        /// approach edge (`station-display.test.mjs`).
        /// </summary>
        [Test]
        public void ATvBoardSelectsItsNearestServiceAndPrintsThreeSeparateCards() {
            var line = zoo.Lines[0];
            Assert.IsNotNull(line, "the Zoo document owns a line");
            var anchors = StationTvSchedule.Anchors(zoo);
            Assert.Greater(anchors.Count, 0, "the station's tracks resolved to anchors");
            var up = anchors.Values.FirstOrDefault(anchor => !string.Equals(anchor.Direction, "down", System.StringComparison.Ordinal));
            Assert.IsNotNull(up, "an up-direction service track exists");
            var sample = new Vector3((float)up.X, (float)up.Y, (float)up.Z);
            // 5 s is inside the six-second approach, 150 s is three displayed minutes, 300 s five.
            var clock = Clock("09:34");
            var frame = Frame(clock, Train(line.Id, up.TrackId, TrainPhase.Approach,
                new[] { 5.0, 150.0, 300.0 }, new[] { false, false, false }));
            var status = StationTvSchedule.Select(zoo, frame, true, sample);
            Assert.AreEqual(up.TrackId, status.TrackId, "the screen prints the track it stands beside");
            Assert.AreEqual(line.Name, status.Name);
            Assert.AreEqual(3, status.ArrivalCount, "three separately stacked cards");
            Assert.IsTrue(status.Arrivals[0].Arriving, "five seconds out counts as arriving");
            Assert.AreEqual(3, status.Arrivals[1].Minutes, "150 s is three displayed minutes, never 150");
            Assert.AreEqual(5, status.Arrivals[2].Minutes);
            var data = StationTvPlatePainter.Describe(zoo, frame, true, sample, Locale);
            var words = StationDisplayWords.For(Locale);
            Assert.AreEqual(words.Arriving, words.StatusText(status.Arrivals[0]));
            Assert.AreEqual("3 分钟", words.StatusText(status.Arrivals[1]));
            Assert.AreEqual("09:34", data.Clock, "the plate prints the published clock");
            Assert.AreEqual("1月1日", data.Date, "the plate prints the published date");
            // The direction-specific terminus, both ways.
            bool upDirection = !string.Equals(up.Direction, "down", System.StringComparison.Ordinal);
            Assert.AreEqual(upDirection ? line.UpTerminus : line.DownTerminus, status.Terminus,
                "the terminus follows the track's own direction");
            // A berthed train changes the first card and nothing else.
            var berthed = StationTvSchedule.Select(zoo,
                Frame(clock, Train(line.Id, up.TrackId, TrainPhase.Berth, new[] { 0.0, 120.0, 240.0 },
                    new[] { true, false, false })), true, sample);
            Assert.IsTrue(berthed.Arrivals[0].AtPlatform, "a berthed train stands at the platform");
            Assert.AreEqual(words.AtPlatform, words.StatusText(berthed.Arrivals[0]));
            Assert.AreEqual(2, berthed.Arrivals[1].Minutes);
            Assert.AreNotEqual(StationTvPlatePainter.Describe(zoo, frame, true, sample, Locale).Key,
                StationTvPlatePainter.Describe(zoo,
                    Frame(clock, Train(line.Id, up.TrackId, TrainPhase.Berth, new[] { 0.0, 120.0, 240.0 },
                        new[] { true, false, false })), true, sample, Locale).Key,
                "the arrival state is part of the board's key");
            // An idle service (between trains) still forecasts: the 18-era painter skipped it.
            var idle = StationTvSchedule.Select(zoo,
                Frame(clock, Train(line.Id, up.TrackId, TrainPhase.None, new[] { 90.0, 210.0, 330.0 },
                    new[] { false, false, false })), true, sample);
            Assert.AreEqual(up.TrackId, idle.TrackId, "a track between trains still answers its screen");
            Assert.AreEqual(3, idle.ArrivalCount, "an idle service keeps its forecast");
            Assert.AreEqual(2, idle.Arrivals[0].Minutes);
        }

        /// <summary>
        /// A screen with no forecast prints `暂无班次` on every card rather than inventing a
        /// countdown, and a document with no line prints `暂无线路` under three empty cards.
        /// </summary>
        [Test]
        public void AnEmptyForecastPrintsNoServicesRatherThanAnInventedCountdown() {
            var line = zoo.Lines[0];
            var anchors = StationTvSchedule.Anchors(zoo);
            var anchor = anchors.Values.First();
            var sample = new Vector3((float)anchor.X, (float)anchor.Y, (float)anchor.Z);
            var silent = StationTvSchedule.Select(zoo,
                Frame(Clock("06:30"), Train(line.Id, anchor.TrackId, TrainPhase.None)), true, sample);
            Assert.AreEqual(0, silent.ArrivalCount, "no forecast is no service, not a zero countdown");
            var words = StationDisplayWords.For(Locale);
            for (int card = 0; card < 3; card++) {
                Assert.AreEqual(words.NoServices, words.StatusText(silent.Arrivals[card]),
                    "card " + card + " prints the no-services word");
            }
            // No simulation frame at all: the station's first line, no arrivals.
            var noFrame = StationTvSchedule.Select(zoo, default, false, sample);
            Assert.IsTrue(noFrame.HasLine, "a plate with no session still names its line");
            Assert.AreEqual(line.Id, noFrame.LineId);
            Assert.AreEqual(0, noFrame.ArrivalCount);
            // And a document with no line at all.
            var empty = StationTvSchedule.Select(Rename(zoo, zoo.Name, zoo.NameEn), default, false, sample);
            Assert.IsTrue(empty.HasLine, "Zoo owns a line");
        }

        /// <summary>
        /// The board repaints only when what it prints changes: the same facts keep their
        /// material, a rename repaints the board and leaves the advertisement's rotation alone, and
        /// a locale switch repaints every board because the words are part of its identity.
        /// </summary>
        [Test]
        public void ATvBoardRepaintsOnlyWhenItsPrintedFactsChange() {
            var run = Build(zoo, "television plate");
            try {
                var scope = run.Display.Current.Displays;
                var face = Faces(scope).First(candidate => candidate.Plate != null);
                var line = zoo.Lines[0];
                var anchor = StationTvSchedule.Anchors(zoo).Values
                    .OrderBy(candidate => System.Math.Abs(candidate.X - face.Sample.x) + System.Math.Abs(candidate.Y - face.Sample.y))
                    .First();
                var clock = Clock("06:30");
                var approaching = Frame(clock, Train(line.Id, anchor.TrackId, TrainPhase.Approach,
                    new[] { 120.0, 240.0, 360.0 }, new[] { false, false, false }));
                var berth = Frame(clock, Train(line.Id, anchor.TrackId, TrainPhase.Berth,
                    new[] { 0.0, 120.0, 240.0 }, new[] { true, false, false }));
                StationDisplayTvArtwork.Advance(scope, 0, zoo, approaching, true);
                var firstBoard = face.Plate.sharedMaterial;
                Assert.IsNotNull(firstBoard, "the board printed its first frame");
                // `Status0` is the arrival's own diagnostic token; the printed word is asserted
                // through `StationDisplayWords`.
                Assert.AreEqual("2min", face.Status0, "the approaching forecast reached the board");
                Assert.AreEqual("2 分钟", StationDisplayWords.For(Locale).StatusText(
                    StationTvSchedule.Select(zoo, approaching, true, face.Sample).Arrivals[0]),
                    "the card prints the Chinese countdown");
                StringAssert.Contains("track=" + anchor.TrackId, string.Join("; ", scope.Notes.Skip(System.Math.Max(0, scope.Notes.Count - 8))));
                StationDisplayTvArtwork.Advance(scope, 1, zoo, approaching, true);
                Assert.AreSame(firstBoard, face.Plate.sharedMaterial, "the same facts do not repaint");
                StationDisplayTvArtwork.Advance(scope, 2, zoo, berth, true);
                Assert.AreNotSame(firstBoard, face.Plate.sharedMaterial, "an arriving train changes the board");
                // A rename repaints the board and leaves the content window alone.
                var windowBefore = face.PosterSlug;
                var renamed = Rename(zoo, "新站名", "New");
                StationDisplayTvArtwork.Advance(scope, 3, renamed, berth, true);
                Assert.AreEqual(windowBefore, face.PosterSlug, "a rename repaints only the board");
                var renamedData = StationTvPlatePainter.Describe(renamed,
                    StationTvSchedule.Select(renamed, berth, true, face.Sample), clock, Locale);
                StringAssert.Contains("新站名", renamedData.Key, "the station name is part of the board's key");
                var boardAfterRename = face.Plate.sharedMaterial;
                // A locale switch is part of the printed contents, so the board cannot keep its pixels.
                scope.Locale = "en";
                StationDisplayTvArtwork.Advance(scope, 4, renamed, berth, true);
                Assert.AreNotSame(boardAfterRename, face.Plate.sharedMaterial, "the locale is part of the board");
                StringAssert.Contains("|en|", face.PlateKey, "the board's key records the locale");
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// The production layout: a quarter-width column of three cards, the video aperture at
        /// `x=.25, w=.75, h=.82`, the station card under them and the date/HH:mm footer along the
        /// bottom (`stationDisplayLayout`).
        /// </summary>
        [Test]
        public void ThePlateLayoutMatchesTheReferenceBoard() {
            var layout = StationTvPlatePainter.Layout();
            Assert.AreEqual(960, StationTvPlatePainter.Width);
            Assert.AreEqual(540, StationTvPlatePainter.Height);
            Assert.AreEqual(240f, layout.Poster.X, 1e-3f, "the video aperture starts at a quarter of the plate");
            Assert.AreEqual(720f, layout.Poster.W, 1e-3f);
            Assert.AreEqual(442.8f, layout.Poster.H, 1e-3f);
            Assert.AreEqual(12f, layout.Card0.X, 1e-3f);
            Assert.AreEqual(12f, layout.Card0.Y, 1e-3f);
            Assert.AreEqual(216f, layout.Card0.W, 1e-3f);
            for (int card = 0; card < 3; card++) {
                var box = layout.Card(card);
                Assert.Less(box.X + box.W, layout.Poster.X, "card " + card + " stays in the left column");
                Assert.Less(box.Y + box.H, layout.Strip.Y, "card " + card + " stays above the footer");
            }
            Assert.AreEqual(layout.Strip.Y, layout.Clock.Y, 1e-3f, "the clock sits level with the strip");
            Assert.AreEqual(486f, layout.Strip.Y, 1e-3f);
            Assert.AreEqual(144f, layout.Clock.W, 1e-3f);
            Assert.LessOrEqual(layout.Station.Y + layout.Station.H, StationTvPlatePainter.Height);
            Assert.AreEqual(.25f, StationTvPlatePainter.PosterX);
            Assert.AreEqual(.82f, StationTvPlatePainter.PosterH);
        }

        /// <summary>
        /// The advertisement's cadence is the **wall clock**, independent of the simulation: a
        /// paused station keeps its board but its screens keep playing, each face on its own 6–20 s
        /// deadline, and a swap touches only the window.
        /// </summary>
        [Test]
        public void ATvAdRotationRunsOnTheWallClockIndependentlyOfTheSimulation() {
            var run = Build(zoo, "television rotation");
            try {
                var scope = run.Display.Current.Displays;
                var entries = StationDisplayTvArtwork.EntriesFor(scope);
                Assert.Greater(entries.Count, 0);
                foreach (var entry in entries) {
                    foreach (var face in entry.Faces) {
                        var facts = zoo.Modules.First(module => module.Id == face.ModuleId);
                        Assert.GreaterOrEqual(StationDisplayTvArtwork.SwapInterval(facts.Facts),
                            StationDisplayTvArtwork.MinSwapSeconds);
                        Assert.LessOrEqual(StationDisplayTvArtwork.SwapInterval(facts.Facts),
                            StationDisplayTvArtwork.MaxSwapSeconds);
                    }
                }
                var watch = entries[0].Faces[0];
                var before = watch.PosterSlug;
                int swaps = StationDisplayTvArtwork.Advance(scope, 1000);
                Assert.Greater(swaps, 0, "a due deadline swaps the content");
                Assert.AreNotEqual(before, watch.PosterSlug, "the window prints the next poster");
                Assert.Greater(watch.Swaps, 0, "the swap is recorded on the face");
                // Determinism: the same module id always starts on the same poster.
                var facts2 = zoo.Modules.First(module => module.Id == watch.ModuleId);
                Assert.AreEqual(StationDisplayTvArtwork.InitialPoster(facts2.Facts),
                    StationDisplayTvArtwork.InitialPoster(facts2.Facts),
                    "the starting poster is seeded from the module, not a random draw");
            } finally {
                Dispose(run);
            }
        }

        /// <summary>
        /// 20 §2 — the promoted plates carry the glTF V flip, so the canonical frame is what makes
        /// a Unity poster upright; a billboard's plate is confirmed upright and its crop is applied
        /// exactly once.
        /// </summary>
        [Test]
        public void EveryBoundPlateIsUprightAndCroppedOnce() {
            var run = Build(zoo, "upright plates");
            try {
                var scope = run.Display.Current.Displays;
                Assert.Greater(scope.Surfaces.Count, 0, "the world resolved its printed surfaces");
                foreach (var surface in scope.Surfaces) {
                    Assert.IsTrue(surface.Upright, surface.Key + " is not upright: " + surface.Basis);
                    Assert.Greater(surface.Panel.x, 0f);
                    Assert.Greater(surface.Panel.y, 0f);
                    Assert.IsNotNull(surface.Source, "the immutable source mesh is kept");
                    Assert.IsNotNull(surface.Canonical, "the canonical copy is installed");
                    StringAssert.Contains("physical-up", surface.Basis);
                    var filter = surface.Renderer.GetComponent<MeshFilter>();
                    var mesh = filter != null ? filter.sharedMesh : null;
                    Assert.IsNotNull(mesh, surface.Key + " active mesh");
                    var normals = mesh.normals;
                    var vertices = mesh.vertices;
                    var uvs = mesh.uv;
                    if (normals != null && normals.Length == vertices.Length && vertices.Length >= 4) {
                        var sum = Vector3.zero;
                        for (int i = 0; i < normals.Length; i++) sum += normals[i];
                        var outward = surface.Renderer.transform.TransformDirection(sum.normalized);
                        var lossy = surface.Renderer.transform.lossyScale;
                        if (lossy.x * lossy.y * lossy.z < 0f) outward = -outward;
                        if (Mathf.Abs(Vector3.Dot(outward.normalized, Vector3.up)) < .8f) {
                            var rightWorld = Vector3.Cross(outward.normalized, Vector3.up).normalized;
                            int left = 0, right = 0;
                            float minX = float.MaxValue, maxX = float.MinValue;
                            for (int i = 0; i < vertices.Length; i++) {
                                float rx = Vector3.Dot(surface.Renderer.transform.TransformPoint(vertices[i]), rightWorld);
                                if (rx < minX) { minX = rx; left = i; }
                                if (rx > maxX) { maxX = rx; right = i; }
                            }
                            Assert.Less(uvs[left].x, uvs[right].x - .1f,
                                surface.Key + " U is mirrored left-to-right when viewed from the front");
                        }
                    }
                }
                // A crop is applied once: every cropped mesh's UVs lie inside [0, 1] and the
                // canonical mesh itself still spans the whole image.
                foreach (var pair in scope.Meshes) {
                    var uvs = pair.Value.uv;
                    Assert.Greater(uvs.Length, 0, pair.Key);
                    foreach (var uv in uvs) {
                        Assert.GreaterOrEqual(uv.x, -1e-4f, pair.Key + " U outside the image");
                        Assert.LessOrEqual(uv.x, 1f + 1e-4f, pair.Key + " U outside the image");
                        Assert.GreaterOrEqual(uv.y, -1e-4f, pair.Key + " V outside the image");
                        Assert.LessOrEqual(uv.y, 1f + 1e-4f, pair.Key + " V outside the image");
                    }
                }
            } finally {
                Dispose(run);
            }
        }

        [Test]
        public void TvPlateAdvanceRespectsPaintBudgetSkipsHiddenFacesAndCatchesUp() {
            var run = Build(zoo, "tv budget probe");
            try {
                var scope = run.Display.Current.Displays;
                var faces = Faces(scope).Where(f => f.Plate != null).ToList();
                Assert.GreaterOrEqual(faces.Count, 2, "Zoo carries multiple TV faces");
                var clock1 = Clock("06:31");
                var frame1 = Frame(clock1);

                // Hide the first face and advance with skipHidden=true & budget=1.
                faces[0].Plate.enabled = false;
                StationDisplayTvArtwork.Advance(scope, run.World, 10, zoo, frame1, true, maxNewPaints: 1, skipHidden: true);
                Assert.GreaterOrEqual(StationDisplayTvArtwork.LastSkippedHiddenPlates, 1, "hidden TV face must be skipped");
                Assert.LessOrEqual(StationDisplayTvArtwork.LastPaintedPlates, 1, "new paints must respect per-frame budget");

                // Re-enable the hidden face and advance again; it must catch up to 06:31.
                faces[0].Plate.enabled = true;
                StationDisplayTvArtwork.Advance(scope, run.World, 11, zoo, frame1, true, maxNewPaints: 8, skipHidden: true);
                Assert.AreEqual(6 * 60 + 31, faces[0].Minute, "re-enabled TV face caught up to current minute");
            } finally {
                Dispose(run);
            }
        }
    }
}
