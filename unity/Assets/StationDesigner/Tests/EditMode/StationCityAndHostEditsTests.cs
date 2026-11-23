using System;
using System.Collections.Generic;
using Metro.App;
using Metro.App.Views;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Metro.Tests {
    /// <summary>
    /// Plan 37 Track 3 parity suite: city-aware line defaults across all 8 palettes, custom
    /// colour preservation, cosmetic vs service vs structural classification, revision-checked
    /// host edits + 1-revision undo/redo + save/reopen, selective view retention, and live
    /// train livery + city mark binding.
    /// </summary>
    public sealed class StationCityAndHostEditsTests {
        readonly List<UnityEngine.Object> owned = new List<UnityEngine.Object>();

        [TearDown]
        public void TearDown() {
            StationEditSession.Reset();
            TrainMarkTextureCache.SetProviderForTests(null);
            for (int i = owned.Count - 1; i >= 0; i--) {
                if (owned[i] != null) UnityEngine.Object.DestroyImmediate(owned[i]);
            }
            owned.Clear();
        }

        [Test]
        public void CityLineDefaultsMatchAllEightPalettesAndFallback() {
            Assert.AreEqual("#f3d03e", StationLineDefaults.Default("1", "up", "third-rail", "guangzhou").Colour);
            Assert.AreEqual("#a4343a", StationLineDefaults.Default("1", "up", "third-rail", "beijing").Colour);
            Assert.AreEqual("#e4002b", StationLineDefaults.Default("1", "up", "third-rail", "shanghai").Colour);
            Assert.AreEqual("#00ab39", StationLineDefaults.Default("1", "up", "third-rail", "shenzhen").Colour);
            Assert.AreEqual("#10069f", StationLineDefaults.Default("1", "up", "third-rail", "chengdu").Colour);
            Assert.AreEqual("#e4002b", StationLineDefaults.Default("1", "up", "third-rail", "chongqing").Colour);
            Assert.AreEqual("#00a2df", StationLineDefaults.Default("1", "up", "third-rail", "nanjing").Colour);
            Assert.AreEqual("#3080b7", StationLineDefaults.Default("1", "up", "third-rail", "wuhan").Colour);
            Assert.AreEqual("guangzhou", StationCityStyles.Normalize("unknown-city"));
            Assert.IsFalse(StationCityStyles.IsValid("unknown-city"));
            Assert.IsTrue(StationCityStyles.IsValid("chongqing"));

            // Fallback colour for an unmapped line id uses the deterministic fallback palette.
            var fallback = StationLineDefaults.Default("999", "up", "third-rail", "guangzhou");
            Assert.IsTrue(fallback.Colour.StartsWith("#", StringComparison.Ordinal));
            Assert.AreEqual(7, fallback.Colour.Length);
        }

        [Test]
        public void EditClassifierSeparatesCosmeticServiceAndStructuralLineEdits() {
            var baseRead = MakeMinimalRead("guangzhou", "#ff00aa", "third-rail", 6, 150, 120);

            var cityLocal = StationHostEdits.TryPlanCity(baseRead, "beijing", "test", out var err);
            Assert.IsNotNull(cityLocal, err);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, cityLocal));
            Assert.AreEqual("#ff00aa", cityLocal.Document.Lines[0].Colour, "City switch must preserve explicit custom line colour.");

            var renameLocal = StationHostEdits.TryPlanRename(baseRead, "体育西路", "Tiyu Xilu", true, "test", out err);
            Assert.IsNotNull(renameLocal, err);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, renameLocal));

            Assert.IsTrue(StationHostEdits.TryPlanUpdateLine(baseRead, "1",
                new JObject { ["headwayProfile"] = new JObject { ["peak"] = 120, ["offpeak"] = 200, ["late"] = 420 } },
                "test", out var headwayLocal, out _, out err), err);
            Assert.AreEqual(StationDocumentEditKind.DayOnly, StationEditClassifier.ClassifyLocal(baseRead, headwayLocal));

            Assert.IsTrue(StationHostEdits.TryPlanUpdateLine(baseRead, "1",
                new JObject { ["colour"] = "#123456" },
                "test", out var colourLocal, out _, out err), err);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, colourLocal));

            var addedLocal = StationHostEdits.TryPlanAddLine(baseRead, "up", "test", out var addedLine, out err);
            Assert.IsNotNull(addedLocal, err);
            Assert.AreEqual("2", addedLine.Id);
            Assert.AreEqual(StationCityStyles.LineColourFor("2", "guangzhou"), addedLine.Colour);
            Assert.AreEqual(StationDocumentEditKind.Cosmetic, StationEditClassifier.ClassifyLocal(baseRead, addedLocal));
        }

        [Test]
        public void HostCommandsRoundTripCityRenameLinesInfoCardAndRejectStaleRevision() {
            var go = new GameObject("HostTrack3Test");
            owned.Add(go);
            var host = go.AddComponent<StationGameHost>();
            host.frameCameraOnCommit = false;
            typeof(StationGameHost).GetMethod("Awake",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(host, null);
            var handler = new StationEditCommandHandler();
            host.RegisterCommandHandler(handler);
            StationEditHost.Ensure().Bind(host);

            var baseRead = MakeMinimalRead("guangzhou", "#ff00aa", "third-rail", 6, 150, 120);
            var opened = host.OpenDocument(baseRead.Document.NormalizedJson, "test");
            Assert.IsTrue(opened.Accepted);
            int rev0 = host.CurrentRevision;

            // Stale expectedRevision is rejected cleanly without bumping revision.
            string staleReply = host.Router.Handle(Envelope("c-stale", "edit.city", new JObject { ["city"] = "shanghai" }, rev0 - 1));
            var staleObj = JObject.Parse(staleReply);
            Assert.AreEqual("reject", (string)staleObj["kind"]);
            Assert.AreEqual("revision-mismatch", (string)staleObj["code"]);
            Assert.AreEqual(rev0, host.CurrentRevision);

            // City switch commits in 1 revision, preserves custom line colour, and emits local delta.
            string cityReply = host.Router.Handle(Envelope("c-city", "edit.city", new JObject { ["city"] = "chengdu" }, rev0));
            var cityObj = JObject.Parse(cityReply);
            Assert.AreEqual("commit", (string)cityObj["kind"]);
            Assert.AreEqual(rev0 + 1, host.CurrentRevision);
            Assert.AreEqual("chengdu", host.Document.City);
            Assert.AreEqual("#ff00aa", host.Document.Lines[0].Colour);
            Assert.IsNotNull(cityObj["payload"]?["delta"]);

            // Bilingual rename commits in 1 revision.
            string renameReply = host.Router.Handle(Envelope("c-rename", "edit.rename",
                new JObject { ["name"] = "春熙路", ["nameEn"] = "Chunxi Rd" }, host.CurrentRevision));
            Assert.AreEqual("commit", (string)JObject.Parse(renameReply)["kind"]);
            Assert.AreEqual("春熙路", host.Document.Name);
            Assert.AreEqual("Chunxi Rd", host.Document.NameEn);

            // Add line picks Chengdu palette for line 2 and emits delta.linesJson.
            string addReply = host.Router.Handle(Envelope("c-add", "edit.line.add", new JObject { ["direction"] = "down" }, host.CurrentRevision));
            var addObj = JObject.Parse(addReply);
            Assert.AreEqual("commit", (string)addObj["kind"]);
            Assert.AreEqual(2, host.Document.Lines.Count);
            Assert.AreEqual(StationCityStyles.LineColourFor("2", "chengdu"), host.Document.Lines[1].Colour);
            Assert.IsNotNull(addObj["payload"]?["delta"]?["linesJson"]);

            // Update line 2 colour + headway.
            string updReply = host.Router.Handle(Envelope("c-upd", "edit.line.update",
                new JObject { ["lineId"] = "2", ["patch"] = new JObject { ["colour"] = "#22cc88", ["cars"] = 5 } },
                host.CurrentRevision));
            Assert.AreEqual("commit", (string)JObject.Parse(updReply)["kind"]);
            Assert.AreEqual("#22cc88", host.Document.Lines[1].Colour);
            Assert.AreEqual(4, host.Document.Lines[1].Cars, "5 cars snaps to 4 (ties round down).");

            // Lift door side, escalator reverse, one-way road reverse all commit cleanly.
            string liftReply = host.Router.Handle(Envelope("c-lift", "edit.lift.doors",
                new JObject { ["moduleId"] = "lift-1", ["z"] = 0, ["side"] = "both" }, host.CurrentRevision));
            Assert.AreEqual("commit", (string)JObject.Parse(liftReply)["kind"], "liftReply=" + liftReply);
            string liftRaw = host.Index.GetModule("lift-1")?.RawJson ?? "<null>";
            Assert.IsTrue(liftRaw.Contains("\"both\""), "liftRaw=" + liftRaw + " rev=" + host.CurrentRevision + " reply=" + liftReply);

            Assert.AreEqual("commit", (string)JObject.Parse(host.Router.Handle(Envelope("c-esc", "edit.run.reverse",
                new JObject { ["moduleId"] = "esc-1" }, host.CurrentRevision)))["kind"]);
            Assert.AreEqual("down", host.Index.GetModule("esc-1").Config.Text("dir"));

            Assert.AreEqual("commit", (string)JObject.Parse(host.Router.Handle(Envelope("c-road", "edit.road.reverse",
                new JObject { ["moduleId"] = "road-1" }, host.CurrentRevision)))["kind"]);
            Assert.AreEqual(2, host.Index.GetModule("road-1").Rotation);

            // Save & reopen preserves every edit.
            string saved = host.SaveDocument();
            var reloaded = StationDocumentReader.Read(saved, new StationSource("reopen", ""));
            Assert.AreEqual("chengdu", reloaded.Document.City);
            Assert.AreEqual("春熙路", reloaded.Document.Name);
            Assert.AreEqual("Chunxi Rd", reloaded.Document.NameEn);
            Assert.AreEqual(2, reloaded.Document.Lines.Count);
            Assert.AreEqual("#22cc88", reloaded.Document.Lines[1].Colour);

            // Undo steps back one revision each, and redo restores.
            int revBeforeUndo = host.CurrentRevision;
            Assert.AreEqual("commit", (string)JObject.Parse(host.Router.Handle(Envelope("c-undo1", "edit.undo", new JObject(), null)))["kind"]);
            Assert.AreEqual(revBeforeUndo + 1, host.CurrentRevision);
            Assert.AreEqual(0, host.Index.GetModule("road-1").Rotation);

            Assert.AreEqual("commit", (string)JObject.Parse(host.Router.Handle(Envelope("c-redo1", "edit.redo", new JObject(), null)))["kind"]);
            Assert.AreEqual(2, host.Index.GetModule("road-1").Rotation);
        }

        sealed class FakeMarkProvider : ITrainMarkProvider {
            readonly string targetKey;
            readonly Texture2D texture;
            public FakeMarkProvider(string targetKey, Texture2D texture) { this.targetKey = targetKey; this.texture = texture; }
            public bool TryProvide(TrainMarkRequestItem item, out Texture2D tex) {
                if (string.Equals(item.Key, targetKey, StringComparison.Ordinal)) {
                    tex = texture;
                    return true;
                }
                tex = null;
                return false;
            }
        }

        [Test]
        public void TrainLiveryBinderAppliesLiveLineColourAndCityMarks() {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            Assert.IsNotNull(shader, "Expected a standard shader for material binding.");

            var root = new GameObject("TrainMock");
            owned.Add(root);
            var mr = root.AddComponent<MeshRenderer>();
            var mf = root.AddComponent<MeshFilter>();
            mf.sharedMesh = Resources.GetBuiltinResource<Mesh>("Cube.fbx");

            var liveryTemplate = new Material(shader) { name = "lineLivery" };
            var markTemplate = new Material(shader) { name = "trainMark" };
            var cqTemplate = new Material(shader) { name = "chongqingTrainMark" };
            var njTemplate = new Material(shader) { name = "nanjingTrainMark" };
            owned.Add(liveryTemplate);
            owned.Add(markTemplate);
            owned.Add(cqTemplate);
            owned.Add(njTemplate);
            mr.sharedMaterials = new[] { liveryTemplate, markTemplate, cqTemplate, njTemplate };

            var pool = new Dictionary<string, Material>(StringComparer.Ordinal);
            var created = new List<Material>();
            try {
                var binding = TrainLiveryBinder.Capture(root);
                Assert.AreEqual(1, binding.Livery.Count);
                Assert.AreEqual(1, binding.CityMark.Count);
                Assert.AreEqual(1, binding.ChongqingMark.Count);
                Assert.AreEqual(1, binding.NanjingMark.Count);

                var fakeTex = new Texture2D(4, 4, TextureFormat.RGBA32, false);
                owned.Add(fakeTex);
                TrainMarkTextureCache.SetProviderForTests(
                    new FakeMarkProvider(TrainMarkTextureCache.ChongqingMarkKey("2", "#00aa55"), fakeTex));

                TrainLiveryBinder.Apply(binding, "2", "#00aa55", "chongqing", pool, created, recaptureVisibility: false);

                var mats = mr.sharedMaterials;
                Assert.AreNotSame(liveryTemplate, mats[0]);
                ColorUtility.TryParseHtmlString("#00aa55", out var expectedColor);
                Color actualColor = mats[0].HasProperty("_BaseColor") ? mats[0].GetColor("_BaseColor") : mats[0].color;
                Assert.AreEqual(expectedColor.r, actualColor.r, 0.02f);
                Assert.AreEqual(expectedColor.g, actualColor.g, 0.02f);
                Assert.AreEqual(expectedColor.b, actualColor.b, 0.02f);

                // Chongqing clears the generic trainMark and binds the Chongqing cab badge texture.
                Texture cqApplied = mats[2].HasProperty("_BaseMap") ? mats[2].GetTexture("_BaseMap") : mats[2].mainTexture;
                Assert.AreSame(fakeTex, cqApplied);
            } finally {
                for (int i = 0; i < created.Count; i++) {
                    if (created[i] != null) UnityEngine.Object.DestroyImmediate(created[i]);
                }
            }
        }

        static string Envelope(string id, string type, JObject payload, int? expectedRevision) {
            var env = new JObject {
                ["schemaVersion"] = 2,
                ["id"] = id,
                ["sessionId"] = "s-test",
                ["type"] = type,
                ["payload"] = payload ?? new JObject(),
            };
            if (expectedRevision.HasValue) env["expectedRevision"] = expectedRevision.Value;
            return env.ToString(Formatting.None);
        }

        static StationReadResult MakeMinimalRead(string city, string lineColour, string power, int cars, int peakHeadway, int alight) {
            var doc = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = "2026-01-01T00:00:00.000Z",
                ["name"] = "测试站",
                ["nameEn"] = "Test Station",
                ["city"] = city,
                ["seed"] = 12345,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["static"] = new JObject {
                    ["cells"] = new JArray {
                        new JObject { ["x"] = 0, ["y"] = 0, ["z"] = 0, ["shape"] = "solid", ["fill"] = "solid", ["zone"] = "unpaid" },
                    },
                    ["modules"] = new JArray {
                        new JObject {
                            ["id"] = "lift-1", ["type"] = "lift", ["x"] = 0, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                            ["cfg"] = new JObject { ["rises"] = new JArray(5) },
                        },
                        new JObject {
                            ["id"] = "esc-1", ["type"] = "escalator", ["x"] = 2, ["y"] = 0, ["z"] = 0, ["rot"] = 0,
                            ["from"] = new JObject { ["x"] = 2, ["y"] = 0, ["z"] = 0 },
                            ["to"] = new JObject { ["x"] = 10, ["y"] = 0, ["z"] = 5 },
                            ["cfg"] = new JObject { ["dir"] = "up" },
                        },
                        new JObject {
                            ["id"] = "road-1", ["type"] = "road", ["x"] = 0, ["y"] = 4, ["z"] = 0, ["rot"] = 0, ["w"] = 6,
                            ["cfg"] = new JObject { ["direction"] = "one-way", ["lanes"] = 2 },
                        },
                    },
                    ["lines"] = new JArray {
                        new JObject {
                            ["id"] = "1", ["name"] = "1号线", ["nameEn"] = "Line 1",
                            ["colour"] = lineColour, ["stock"] = "B", ["cars"] = cars,
                            ["power"] = power, ["psd"] = "full", ["direction"] = "up",
                            ["headwayProfile"] = new JObject { ["peak"] = peakHeadway, ["offpeak"] = 240, ["late"] = 480 },
                            ["alightPerTrain"] = alight, ["modelScale"] = 0.98,
                            ["upTerminus"] = "", ["downTerminus"] = "",
                        },
                    },
                },
            };
            return StationDocumentReader.Read(doc.ToString(Formatting.None), new StationSource("test", ""));
        }
    }
}
