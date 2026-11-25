using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Metro.App;
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
    /// Plan 11 packet F3: the 指示牌 editor's ✓ through the station host.
    ///
    /// The source edit model is `sim/sign.ts` + `SignSlice.setSignBoards`: the editor
    /// writes **whole faces** of one sign (front/back, the fields `SignComponent`
    /// declares) and C# owns the committed revision. Here that transaction is driven
    /// end to end through the real `StationGameHost`/`StationCommandRouter`:
    /// one `sign.commit` becomes exactly one document revision, the committed save
    /// re-reads to the same content, a stale revision cannot move the document, and an
    /// unchanged second ✓ is an idempotent ack. The cache cases pin the repaint the
    /// commit needs: only the edited sign's plates are re-requested.
    /// </summary>
    public sealed class StationSignEditTests {
        /* ------------------------------------------------------------- fixture */

        static string DataRoot => Application.dataPath;
        static string ZooPath => Path.Combine(DataRoot, "StationDesigner/Zoo/ZooSave.json");

        static JObject Zoo() => JObject.Parse(File.ReadAllText(ZooPath));

        /// <summary>One real Zoo sign record, re-parented onto the tiny station's grid.</summary>
        static JObject ZooSign(string id, int x = 0, int y = 0) {
            var module = (JObject)Zoo()["static"]["modules"].First(value => (string)value["id"] == id).DeepClone();
            module["x"] = x;
            module["y"] = y;
            module["z"] = 0;
            module["rot"] = 0;
            return module;
        }

        static JObject Line(string id = "5", string name = "5号线", string colour = "#c70541") => new JObject {
            ["id"] = id, ["name"] = name, ["nameEn"] = "Line " + id, ["colour"] = colour,
            ["stock"] = "L", ["cars"] = 6, ["power"] = "third-rail", ["psd"] = "full",
            ["direction"] = "up", ["upTerminus"] = "", ["downTerminus"] = "",
            ["headwayProfile"] = new JObject { ["peak"] = 150, ["offpeak"] = 240, ["late"] = 480 },
        };

        static JObject Cell(int x, int y, int z = 0) => new JObject {
            ["x"] = x, ["y"] = y, ["z"] = z, ["fill"] = "solid",
            ["zone"] = "unpaid", ["finish"] = new JObject { ["top"] = "floor.concrete" },
        };

        static JArray Modules(params JObject[] modules) {
            var array = new JArray();
            foreach (var module in modules) array.Add(module);
            return array;
        }

        static string TinySave(string name, params JObject[] modules) {
            var envelope = new JObject {
                ["format"] = "metro-save",
                ["formatVersion"] = 1,
                ["gameVersion"] = "0.2.0",
                ["savedAt"] = StationDocumentReader.FixedSavedAt,
                ["name"] = name,
                ["nameEn"] = "Sign edit test",
                ["city"] = "guangzhou",
                ["seed"] = 7654321,
                ["levelBase"] = 0,
                ["storeyHeight"] = 5,
                ["service"] = new JObject { ["from"] = 23400, ["to"] = 84600 },
                ["peaks"] = new JArray {
                    new JObject { ["from"] = 26100, ["to"] = 32400 },
                    new JObject { ["from"] = 63000, ["to"] = 68400 },
                },
                ["static"] = new JObject {
                    ["cells"] = new JArray { Cell(0, 0), Cell(4, 0), Cell(0, 2), Cell(4, 2) },
                    ["modules"] = Modules(modules),
                    ["lines"] = new JArray { Line() },
                },
            };
            return envelope.ToString(Formatting.None);
        }

        /* --------------------------------------------------------- components */

        static JObject Arrow(string id, string arrow, double x) => new JObject {
            ["id"] = id, ["kind"] = "arrow", ["arrow"] = arrow, ["x"] = x, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both",
        };

        static JObject Text(string id, string text, double x) => new JObject {
            ["id"] = id, ["kind"] = "text", ["text"] = text, ["x"] = x, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both",
        };

        static JObject Badge(string id, string lineId, double x, bool english = true) => new JObject {
            ["id"] = id, ["kind"] = "line", ["lineId"] = lineId, ["english"] = english,
            ["x"] = x, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both",
        };

        static JObject Icon(string id, string icon, double x) => new JObject {
            ["id"] = id, ["kind"] = "icon", ["icon"] = icon, ["x"] = x, ["y"] = 0.2, ["scale"] = 1, ["side"] = "both",
        };

        static JArray Face(params JObject[] components) {
            var array = new JArray();
            foreach (var component in components) array.Add(component);
            return array;
        }

        /// <summary>One face to write; a null back means "leave the committed back alone".</summary>
        static JObject Faces(JArray front, JArray back = null) {
            var faces = new JObject { ["front"] = front };
            if (back != null) faces["back"] = back;
            return faces;
        }

        static string Envelope(string type, int revision, JObject payload) => new JObject {
            ["schemaVersion"] = 2,
            ["id"] = "c-" + type,
            ["sessionId"] = "s-test",
            ["type"] = type,
            ["expectedRevision"] = revision,
            ["payload"] = payload,
        }.ToString(Formatting.None);

        static string Commit(string signId, int revision, JObject faces) =>
            Envelope("sign.commit", revision, new JObject { ["signId"] = signId, ["faces"] = faces });

        /* ------------------------------------------------------------ the host */

        GameObject hostObject;
        StationGameHost host;
        readonly List<string> sent = new List<string>();

        [SetUp]
        public void SetUp() {
            StationSignSignage.LastCommit = null;
            sent.Clear();
            StationSignSignage.SendHook = json => sent.Add(json); // the painter stays in the browser; replies are not needed here
            StationSignSignage.Locale = "zh-CN";
            hostObject = new GameObject(StationGameHost.ObjectName);
            host = hostObject.AddComponent<StationGameHost>();
            host.catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
            host.stationShader = Shader.Find("Unlit/Texture");
            host.frameCameraOnCommit = false;
            // A MonoBehaviour without `[ExecuteAlways]` gets no Awake in edit mode, and the
            // real host is the only place the router/coordinator exist. Invoke the message
            // directly: `SendMessage` is refused for a behaviour that is not running.
            var awake = typeof(StationGameHost).GetMethod("Awake", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.IsNotNull(awake, "StationGameHost.Awake exists");
            awake.Invoke(host, null);
            Assert.IsNotNull(host.Router, "the host's router is live");
            host.RegisterCommandHandler(new StationSignCommandHandler());
            host.RegisterRenderer(new StationSignRenderer());
        }

        [TearDown]
        public void TearDown() {
            if (hostObject != null) UnityEngine.Object.DestroyImmediate(hostObject);
            hostObject = null;
            host = null;
            StationSignSignage.LastCommit = null;
            StationSignSignage.SendHook = null;
            StationRenderers.Clear();
            StationCommandHandlers.Clear();
        }

        StationLoadResult Open(string name, params JObject[] modules) {
            var result = host.OpenDocument(TinySave(name, modules), "test");
            Assert.IsTrue(result.Accepted, result.ToString());
            return result;
        }

        /* ------------------------------------------------------------ helpers */

        static JObject Reply(string json) => JObject.Parse(json);

        static JObject Module(JObject document, string id) =>
            (JObject)document["static"]["modules"].First(module => (string)module["id"] == id);

        static JArray FrontOf(JObject document, string id, string face = "front") =>
            (JArray)Module(document, id)["cfg"][face];

        static JObject Reopen(string save) =>
            JObject.Parse(StationDocumentReader.Read(save, new StationSource("reopen", "")).Document.NormalizedJson);

        /// <summary>Two saves are the same station when everything but the write timestamp agrees.</summary>
        static void AssertSameSave(string expected, string actual, string message) {
            var left = JObject.Parse(expected);
            var right = JObject.Parse(actual);
            left.Remove("savedAt");
            right.Remove("savedAt");
            Assert.IsTrue(JToken.DeepEquals(left, right), message);
        }

        static void AssertFaceEquals(JArray expected, JArray actual, string message) {
            Assert.AreEqual(expected.Count, actual.Count, message + " component count");
            for (int i = 0; i < expected.Count; i++) {
                foreach (var field in new[] { "id", "kind", "text", "arrow", "icon", "lineId", "english" }) {
                    if (expected[i][field] == null && actual[i][field] == null) continue;
                    Assert.AreEqual((string)expected[i][field], (string)actual[i][field], message + " [" + i + "]." + field);
                }
                foreach (var field in new[] { "x", "y", "scale" }) {
                    Assert.AreEqual((double)expected[i][field], (double)actual[i][field], 0.00011, message + " [" + i + "]." + field);
                }
                Assert.AreEqual("both", (string)actual[i]["side"], message + " [" + i + "].side");
            }
        }

        /// <summary>
        /// The editor's own fields match, in order. Positions are deliberately not
        /// compared: the board settles a whole row, so the committed x is the packed
        /// position the source's `normalizeSignLayout` computes, not the request's.
        /// </summary>
        static void AssertContentEquals(JArray expected, JArray actual, string message) {
            Assert.AreEqual(expected.Count, actual.Count, message + " component count");
            for (int i = 0; i < expected.Count; i++) {
                foreach (var field in new[] { "id", "kind", "text", "arrow", "icon", "lineId", "english" }) {
                    if (expected[i][field] == null && actual[i][field] == null) continue;
                    Assert.AreEqual((string)expected[i][field], (string)actual[i][field], message + " [" + i + "]." + field);
                }
            }
        }

        static string FaceKey(StationDocument document, string id, StationSignFaceName face) {
            var record = document.Modules.First(module => module.Id == id);
            var request = StationSignFaceKeys.FromRecord(record, face, StationSignViews.Lines(document));
            return request != null ? request.ContentKey : null;
        }

        /* -------------------------------------------------------------- tests */

        [Test]
        public void WallAndHungFaceCommitsAreOneRevisionEachAndSurviveReopen() {
            Open("sign edits", ZooSign("sign-309", 0, 0), ZooSign("sign-wall-395", 4, 0));
            Assert.AreEqual(1, host.CurrentRevision);
            int before = host.CurrentRevision;

            // A hung board's 正面 and a wall board's 正面, each one ✓.
            var hungFront = Face(Arrow("c1", "down-left", 0.32), Text("c2", "文冲方向\nTowards Wenchong", 0.9), Badge("c3", "5", 1.35));
            var hungReply = Reply(host.SendForTest(Commit("sign-309", before, Faces(hungFront))));
            Assert.AreEqual("commit", (string)hungReply["kind"], "an edit that changes the document replies with its commit");
            Assert.AreEqual(before + 1, (int)hungReply["revision"], "one sign.edit is one revision");
            Assert.AreEqual(1, host.CurrentRevision - before, "the revision moved exactly once");

            var last = hungReply["payload"]["sign"]["lastCommit"];
            Assert.IsNotNull(last, "the commit payload names the sign edit it applied");
            Assert.AreEqual("sign-309", (string)last["signId"]);
            Assert.AreEqual("front", (string)last["face"]);
            Assert.AreEqual("front", (string)last["faces"][0]["face"]);
            Assert.IsNotEmpty((string)last["contentKey"], "the ack carries the face's content key");
            Assert.AreEqual(host.CurrentRevision, (int)last["revision"]);
            Assert.IsTrue((bool)last["changed"]);

            var wallFront = Face(Text("c1", "出口\nExit", 0.5), Arrow("c2", "right", 1.1), Icon("c3", "exit", 1.5), Arrow("c4", "right", 1.9));
            var wallReply = Reply(host.SendForTest(Commit("sign-wall-395", host.CurrentRevision, Faces(wallFront))));
            Assert.AreEqual("commit", (string)wallReply["kind"]);
            Assert.AreEqual(before + 2, host.CurrentRevision, "the second sign is its own one revision");
            Assert.AreEqual(2, host.CurrentRevision - before, "two ✓s are two revisions, never more");

            // Save -> reread -> equal: the committed save keeps the new content exactly.
            var saved = host.SaveDocument();
            var reopened = Reopen(saved);
            AssertContentEquals(hungFront, FrontOf(reopened, "sign-309"), "hung front");
            AssertContentEquals(wallFront, FrontOf(reopened, "sign-wall-395"), "wall front");
            AssertFaceEquals(FrontOf(Reopen(host.Document.NormalizedJson), "sign-309"), FrontOf(reopened, "sign-309"),
                "the committed hung board is a fixed point");
            AssertFaceEquals(FrontOf(Reopen(host.Document.NormalizedJson), "sign-wall-395"), FrontOf(reopened, "sign-wall-395"),
                "the committed wall board is a fixed point");
            Assert.AreEqual("wall", (string)Module(reopened, "sign-wall-395")["cfg"]["mount"], "the mount is not the editor's to write");
            Assert.AreEqual(0, FrontOf(reopened, "sign-wall-395").Count(component => (string)component["kind"] == "line"),
                "a wall sign does not invent a line badge");

            // The commit re-rendered the affected board: the rebuilt sign view carries the
            // committed content and the painter was asked for its new key. The unrelated
            // sign was rebuilt too (the whole station is one transaction) but the cache
            // case below pins that an in-place invalidation touches only the edited sign.
            var view = StationSignSignage.Renderer?.View("sign-309");
            Assert.IsNotNull(view, "the committed sign has a live view after the edit");
            Assert.AreEqual((string)last["contentKey"], view.FaceRequest(StationSignFaceName.Front).ContentKey,
                "the re-rendered face is keyed by the committed content");
            var requests = sent
                .Select(json => JObject.Parse(json))
                .Where(message => (string)message["kind"] == "signRequest")
                .ToArray();
            Assert.GreaterOrEqual(requests.Length, 2, "each commit's rebuilt sign asks for its boards");
            var requestedKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var req in requests) {
                foreach (var face in (JArray)req["payload"]["faces"]) requestedKeys.Add((string)face["key"]);
            }
            Assert.IsTrue(requestedKeys.Contains((string)last["contentKey"]),
                "the edited face's new content key is what the painter is asked for next");
        }

        [Test]
        public void EditingOneFaceLeavesTheOtherFaceUntouched() {
            Open("distinct boards", ZooSign("sign-301", 0, 0));
            var before = Reopen(host.Document.NormalizedJson);
            var backBefore = (JArray)FrontOf(before, "sign-301", "back").DeepClone();
            Assert.Greater(backBefore.Count, 0, "the fixture sign carries a composed back");
            Assert.AreNotEqual(FaceKey(host.Document, "sign-301", StationSignFaceName.Front),
                FaceKey(host.Document, "sign-301", StationSignFaceName.Back), "the two faces start distinct");

            var reply = Reply(host.SendForTest(Commit("sign-301", host.CurrentRevision,
                Faces(Face(Text("c1", "动物园\nZoo", 0.7))))));
            Assert.AreEqual("commit", (string)reply["kind"]);

            var after = Reopen(host.SaveDocument());
            AssertFaceEquals(backBefore, FrontOf(after, "sign-301", "back"), "the untouched back is exactly where it was");
            Assert.AreNotEqual(FaceKey(host.Document, "sign-301", StationSignFaceName.Front),
                FaceKey(host.Document, "sign-301", StationSignFaceName.Back), "editing the front does not copy it onto the back");
            var last = reply["payload"]["sign"]["lastCommit"];
            Assert.AreEqual(1, ((JArray)last["faces"]).Count, "only the written face is reported");
        }

        [Test]
        public void CjkEnglishBadgeArrowsAndLineColourProduceAStableContentKey() {
            Open("badges", ZooSign("sign-383", 0, 0));
            var content = Face(
                Arrow("c1", "up-left", 0.3),
                Text("c2", "换乘 3 号线\nInterchange Line 3", 0.95),
                Badge("c3", "5", 1.6),
                Arrow("c4", "down-right", 2.0),
                Icon("c5", "accessible", 2.3));
            var commit = Reply(host.SendForTest(Commit("sign-383", host.CurrentRevision, Faces(content))));
            Assert.AreEqual("commit", (string)commit["kind"], commit.ToString());
            var key = (string)commit["payload"]["sign"]["lastCommit"]["contentKey"];
            Assert.IsNotEmpty(key);
            Assert.AreEqual(key, FaceKey(host.Document, "sign-383", StationSignFaceName.Front),
                "the ack key is the key the renderer/cache computes for the committed face");
            Assert.AreEqual("front", (string)commit["payload"]["sign"]["lastCommit"]["face"],
                "a face-owned board prints on the face it was written to");

            // Save -> reopen must not change the key (the painter would reprint a board
            // nobody changed) and the CJK/English badge content must be verbatim.
            var save = host.SaveDocument();
            var read = StationDocumentReader.Read(save, new StationSource("key", ""));
            var reopenedKey = FaceKey(read.Document, "sign-383", StationSignFaceName.Front);
            Assert.AreEqual(key, reopenedKey, "the content key is stable across save and reopen");
            var stored = FrontOf(Reopen(save), "sign-383");
            Assert.IsTrue(stored.Any(component => (string)component["kind"] == "text" && ((string)component["text"]).Contains("换乘 3 号线")),
                "CJK text is stored");
            Assert.IsTrue(stored.Any(component => (string)component["kind"] == "text" && ((string)component["text"]).Contains("Interchange Line 3")),
                "the English gloss is stored");
            var badge = stored.First(component => (string)component["kind"] == "line");
            Assert.AreEqual("5", (string)badge["lineId"], "the badge keeps its line id");
            Assert.AreEqual(true, (bool)badge["english"], "the badge keeps its English gloss flag");

            // A line colour change reprints the shield: same components, different pixels,
            // so the content key the cache uses must change.
            var recoloured = JObject.Parse(host.Document.NormalizedJson);
            ((JObject)((JArray)recoloured["static"]["lines"])[0])["colour"] = "#009944";
            var recolouredRead = StationDocumentReader.Read(recoloured.ToString(Formatting.None), new StationSource("colour", ""));
            Assert.AreEqual("#009944", recolouredRead.Document.Lines[0].Colour);
            Assert.AreNotEqual(key, FaceKey(recolouredRead.Document, "sign-383", StationSignFaceName.Front),
                "a line colour change is a different board to paint");
        }

        [Test]
        public void StaleRevisionIsRejectedWithoutMovingTheDocument() {
            Open("stale", ZooSign("sign-309", 0, 0));
            int revision = host.CurrentRevision;
            var saved = host.SaveDocument();
            var reply = Reply(host.SendForTest(Commit("sign-309", revision - 1,
                Faces(Face(Text("c1", "旧文本", 0.5))))));
            Assert.AreEqual("reject", (string)reply["kind"], "the router refuses a stale command");
            Assert.AreEqual("revision-mismatch", (string)reply["code"]);
            Assert.AreEqual(revision, (int)reply["revision"], "a rejection reports the revision it left in place");
            Assert.AreEqual(revision, host.CurrentRevision, "the revision did not move");
            AssertSameSave(saved, host.SaveDocument(), "the committed document is untouched");

            // The transaction's own guard answers `stale-revision` for a direct caller
            // (a handler used without the router's transport check).
            var direct = new StationSignCommandHandler(() => new EditHost(host.Coordinator));
            var payload = new JObject {
                ["signId"] = "sign-309",
                ["faces"] = Faces(Face(Text("c1", "旧文本", 0.5))),
            };
            string code, reason;
            Assert.IsFalse(direct.TryHandle(new StationCommand {
                Type = "sign.commit", ExpectedRevision = revision - 1, Payload = payload,
            }, payload, out code, out reason));
            Assert.AreEqual("stale-revision", code, reason);
            AssertSameSave(saved, host.SaveDocument(), "the direct transaction did not mutate the document either");
        }

        [Test]
        public void UnknownSignAndUnknownFaceAreRejectedWithTheirCodes() {
            Open("unknown", ZooSign("sign-309", 0, 0));
            var saved = host.SaveDocument();
            int revision = host.CurrentRevision;

            var unknownSign = Reply(host.SendForTest(Commit("sign-nope", revision, Faces(Face(Arrow("c1", "left", 0.3))))));
            Assert.AreEqual("reject", (string)unknownSign["kind"]);
            Assert.AreEqual("unknown-sign", (string)unknownSign["code"]);

            var unknownFace = Reply(host.SendForTest(Envelope("sign.commit", revision, new JObject {
                ["signId"] = "sign-309",
                ["face"] = "left",
                ["content"] = Face(Arrow("c1", "left", 0.3)),
            })));
            Assert.AreEqual("reject", (string)unknownFace["kind"]);
            Assert.AreEqual("bad-payload", (string)unknownFace["code"], "a non-front/back face is a malformed payload");

            // A face the record does not carry at all is `unknown-face`: a legacy sign
            // whose config has neither board cannot be edited through this verb.
            var facts = new List<StationSignEditSign> {
                new StationSignEditSign { Id = "sign-309", Mount = "ceiling", HasFront = false, HasBack = false },
            };
            var validation = StationSignEdits.Validate(new StationSignEditRequest {
                SignId = "sign-309", ExpectedRevision = -1, Signs = facts,
                Writes = new List<StationSignEditFaceWrite> { new StationSignEditFaceWrite {
                    SignId = "sign-309", Face = StationSignEditFace.Front,
                    Content = new StationSignEditFaceContent { Components = new List<StationSignEditComponent>() },
                } },
            }, 1);
            Assert.IsFalse(validation.Accepted);
            Assert.AreEqual("unknown-face", validation.Code);

            Assert.AreEqual(revision, host.CurrentRevision, "no refusal moved the revision");
            AssertSameSave(saved, host.SaveDocument(), "no refusal touched the document");
        }

        [Test]
        public void DuplicateFaceWriteAndBadContentAreRejected() {
            Open("duplicate", ZooSign("sign-309", 0, 0));
            var saved = host.SaveDocument();
            int revision = host.CurrentRevision;
            var text = new StationSignEditComponent { Id = "c1", Kind = StationSignEditKind.Text, X = 0.5, Y = 0.2, Scale = 1, Text = "出口" };
            var writes = new List<StationSignEditFaceWrite> {
                new StationSignEditFaceWrite { SignId = "sign-309", Face = StationSignEditFace.Front,
                    Content = new StationSignEditFaceContent { Components = new List<StationSignEditComponent> { text } } },
                new StationSignEditFaceWrite { SignId = "sign-309", Face = StationSignEditFace.Front,
                    Content = new StationSignEditFaceContent { Components = new List<StationSignEditComponent> { text } } },
            };
            var signs = new List<StationSignEditSign> { new StationSignEditSign {
                Id = "sign-309", Mount = "ceiling", HasFront = true, HasBack = true,
            } };
            var duplicate = StationSignEdits.Validate(new StationSignEditRequest {
                SignId = "sign-309", Signs = signs, Writes = writes,
            }, revision);
            Assert.IsFalse(duplicate.Accepted);
            Assert.AreEqual("duplicate-line", duplicate.Code, "one transaction may write one face once");

            // Text bounds: 25 characters in one row is over `SIGN_TEXT_MAX`.
            var longText = new StationSignEditFaceContent { Components = new List<StationSignEditComponent> {
                new StationSignEditComponent { Id = "c1", Kind = StationSignEditKind.Text, X = 0.5, Y = 0.2, Scale = 1,
                    Text = new string('文', StationSignEdits.MaxTextCharacters + 1) },
            } };
            string message;
            Assert.IsFalse(StationSignEdits.ValidateContent(longText, new List<string> { "5" }, out message));
            StringAssert.Contains("at most 24", message);

            // An unknown line id is refused rather than painted as a neutral shield.
            var unknownLine = new StationSignEditFaceContent { Components = new List<StationSignEditComponent> {
                new StationSignEditComponent { Id = "c1", Kind = StationSignEditKind.Line, X = 0.5, Y = 0.2, Scale = 1, LineId = "99" },
            } };
            Assert.IsFalse(StationSignEdits.ValidateContent(unknownLine, new List<string> { "5" }, out message));
            StringAssert.Contains("99", message);

            AssertSameSave(saved, host.SaveDocument(), "validation never touches the document");
            Assert.AreEqual(revision, host.CurrentRevision);
        }

        [Test]
        public void SecondIdenticalEditIsAnIdempotentAck() {
            Open("idempotent", ZooSign("sign-309", 0, 0));
            var content = Face(Arrow("c1", "right", 0.32), Text("c2", "出口\nExit", 0.95));
            var first = Reply(host.SendForTest(Commit("sign-309", host.CurrentRevision, Faces(content))));
            Assert.AreEqual("commit", (string)first["kind"]);
            var firstKey = (string)first["payload"]["sign"]["lastCommit"]["contentKey"];
            var firstRevision = host.CurrentRevision;
            var firstSave = host.SaveDocument();

            var second = Reply(host.SendForTest(Commit("sign-309", firstRevision, Faces(content))));
            Assert.AreEqual("ack", (string)second["kind"], "an unchanged board is not a new document revision");
            Assert.AreEqual(firstRevision, (int)second["revision"]);
            Assert.AreEqual(firstRevision, host.CurrentRevision, "the revision did not move");
            Assert.AreEqual(firstKey, (string)second["payload"]["contentKey"], "the ack reports the committed face's key");
            Assert.AreEqual("front", (string)second["payload"]["face"]);
            Assert.AreEqual("sign-309", (string)second["payload"]["signId"]);
            Assert.AreEqual(false, (bool)second["payload"]["changed"]);
            AssertSameSave(firstSave, host.SaveDocument(), "the save is identical after the no-op");
        }

        [Test]
        public void StaleEditAfterStationSwitchIsRejected() {
            Open("first station", ZooSign("sign-309", 0, 0));
            int firstRevision = host.CurrentRevision;
            Assert.AreEqual("commit", (string)Reply(host.SendForTest(Commit("sign-309", firstRevision,
                Faces(Face(Text("c1", "第一站", 0.5))))))["kind"]);
            int staleRevision = firstRevision - 1;

            // Switch to a different document: the stale edit names the station the player
            // left, so it must not land on the new one even though the sign id repeats.
            Assert.IsTrue(host.OpenDocument(TinySave("second station", ZooSign("sign-309", 2, 0)), "test").Accepted);
            int switchedRevision = host.CurrentRevision;
            var switchedSave = host.SaveDocument();
            var reply = Reply(host.SendForTest(Commit("sign-309", staleRevision,
                Faces(Face(Text("c1", "旧站文本", 0.5))))));
            Assert.AreEqual("reject", (string)reply["kind"]);
            Assert.AreEqual("revision-mismatch", (string)reply["code"]);
            Assert.AreEqual(switchedRevision, host.CurrentRevision, "the new station's revision is unchanged");
            AssertSameSave(switchedSave, host.SaveDocument(), "the new station's document is unchanged");
            Assert.IsFalse(FrontOf(Reopen(host.SaveDocument()), "sign-309")
                .Any(component => ((string)component["text"]) == "旧站文本"), "the stale text never reached the new station");
        }

        /* ------------------------------------------------------------- cache */

        sealed class TestProvider : ISignFaceProvider {
            public readonly List<StationSignFaceBatch> Batches = new List<StationSignFaceBatch>();
            public readonly Queue<StationSignFaceResponse> Replies = new Queue<StationSignFaceResponse>();
            public void Request(StationSignFaceBatch batch) => Batches.Add(batch);
            public bool TryTake(out StationSignFaceResponse response) {
                if (Replies.Count == 0) { response = null; return false; }
                response = Replies.Dequeue();
                return true;
            }
            public void Cancel(string requestId) { }
            public void Dispose() { }
        }

        static byte[] FlatPng(int width, int height) {
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
            var pixels = new Color32[width * height];
            for (int i = 0; i < pixels.Length; i++) pixels[i] = new Color32(20, 24, 30, 255);
            texture.SetPixels32(pixels);
            texture.Apply();
            var png = texture.EncodeToPNG();
            UnityEngine.Object.DestroyImmediate(texture);
            return png;
        }

        static StationSignFaceResponse Reply(StationSignFaceBatch batch, StationSignFaceRequest face) =>
            new StationSignFaceResponse {
                RequestId = batch.RequestId, ArtReady = true,
                Painted = new[] { new StationSignPaintedFace {
                    Key = face.ContentKey, ModuleId = face.ModuleId, Face = face.Face,
                    Width = face.PlateWidth, Height = face.PlateHeight, Png = FlatPng(face.PlateWidth, face.PlateHeight),
                } },
            };

        StationSignView BuildView(StationSignLine[] lines, string id, StationSignMaterials materials, List<GameObject> created) {
            var record = host.Document.Modules.First(module => module.Id == id);
            var view = StationSignView.Build(StationSignViews.RequestFor(record, lines), materials);
            created.Add(view.gameObject);
            return view;
        }

        [Test]
        public void CommitInvalidatesOnlyTheEditedSignsCachedFaces() {
            Open("cache", ZooSign("sign-309", 0, 0), ZooSign("sign-313", 4, 0));
            var lines = StationSignViews.Lines(host.Document);
            var shader = Shader.Find("Unlit/Texture");
            var solid = new Material(shader);
            var faceMaterial = new Material(shader);
            var materials = StationSignMaterials.Create(solid, solid, solid, faceMaterial);
            var created = new List<GameObject>();
            var provider = new TestProvider();
            try {
                var edited = BuildView(lines, "sign-309", materials, created);
                var other = BuildView(lines, "sign-313", materials, created);
                using (var cache = new StationSignTextureCache(provider)) {
                    cache.BindView(edited);
                    cache.BindView(other);
                    cache.Pump();
                    Assert.AreEqual(1, provider.Batches.Count, "both signs are requested in one bounded batch");
                    foreach (var batch in provider.Batches.ToArray()) {
                        foreach (var face in batch.Faces) provider.Replies.Enqueue(Reply(batch, face));
                    }
                    cache.Pump();
                    Assert.AreEqual(0, cache.PendingFaceCount, "every plate has pixels");
                    var otherTexture = other.Front.AppliedTexture;
                    var otherPrint = other.Front.AppliedFingerprint;
                    Assert.IsNotNull(otherTexture);

                    // A commit re-renders the edited sign: its faces are retired and asked
                    // for again, while the sign the player did not touch keeps its pixels.
                    int retired = cache.InvalidateSign("sign-309");
                    Assert.AreEqual(2, retired, "both faces of the edited sign are invalidated");
                    cache.Pump();
                    var last = provider.Batches[provider.Batches.Count - 1];
                    var requested = last.Faces.Select(face => face.ModuleId).Distinct().ToArray();
                    CollectionAssert.AreEqual(new[] { "sign-309" }, requested, "only the edited sign is re-requested");
                    Assert.AreEqual(2, last.Faces.Length, "both of the edited sign's faces are re-requested");
                    Assert.AreSame(otherTexture, other.Front.AppliedTexture, "the unrelated sign keeps its texture");
                    Assert.AreEqual(otherPrint, other.Front.AppliedFingerprint, "and its fingerprint");
                    Assert.AreEqual(2, cache.LiveTextureCount, "only the unrelated sign's two plates are still live");
                }
            } finally {
                foreach (var gameObject in created) if (gameObject != null) UnityEngine.Object.DestroyImmediate(gameObject);
                UnityEngine.Object.DestroyImmediate(solid);
                UnityEngine.Object.DestroyImmediate(faceMaterial);
            }
        }

        /* ------------------------------------------------------------ report */

        [Test]
        public void ZooSignReportCarriesEveryRecordWithItsContentKeys() {
            var read = StationDocumentReader.ReadFile(ZooPath);
            Assert.IsNotNull(read.Document);
            var lines = StationSignViews.Lines(read.Document);
            var records = read.Document.Modules.Where(module => module.Type == "sign").ToArray();
            Assert.AreEqual(21, records.Length, "the Zoo fixture carries 21 sign records");
            var shader = Shader.Find("Unlit/Texture");
            var solid = new Material(shader);
            var faceMaterial = new Material(shader);
            var materials = StationSignMaterials.Create(solid, solid, solid, faceMaterial);
            var created = new List<GameObject>();
            var provider = new TestProvider();
            var report = new StringBuilder();
            report.Append("id,mount,boards,panel_w,panel_h,front_pieces,front_key,front_texture,back_pieces,back_key,back_texture\n");
            try {
                using (var cache = new StationSignTextureCache(provider)) {
                    var views = new List<StationSignView>();
                    foreach (var record in records) {
                        var view = StationSignView.Build(StationSignViews.RequestFor(record, lines), materials);
                        created.Add(view.gameObject);
                        views.Add(view);
                        cache.BindView(view);
                    }
                    cache.Pump();
                    for (int round = 0; round < 4 && cache.PendingFaceCount > 0; round++) {
                        var batch = provider.Batches[provider.Batches.Count - 1];
                        foreach (var face in batch.Faces) provider.Replies.Enqueue(Reply(batch, face));
                        cache.Pump();
                    }
                    Assert.AreEqual(0, cache.PendingFaceCount, "every plate is painted for the report");
                    foreach (var view in views.OrderBy(view => view.ModuleId, StringComparer.Ordinal)) {
                        var front = view.FaceRequest(StationSignFaceName.Front);
                        var back = view.FaceRequest(StationSignFaceName.Back);
                        report.Append(view.ModuleId).Append(',')
                            .Append(StationSignVocabulary.Mount(view.Mount)).Append(',')
                            .Append(view.BoardCount).Append(',')
                            .Append(view.Panel.x.ToString("0.##", CultureInfo.InvariantCulture)).Append(',')
                            .Append(view.Panel.y.ToString("0.##", CultureInfo.InvariantCulture)).Append(',')
                            .Append(front != null ? front.Components.Length.ToString(CultureInfo.InvariantCulture) : "0").Append(',')
                            .Append(front != null ? front.ContentKey : "").Append(',')
                            .Append(view.Front?.AppliedFingerprint ?? "").Append(',')
                            .Append(back != null ? back.Components.Length.ToString(CultureInfo.InvariantCulture) : "0").Append(',')
                            .Append(back != null ? back.ContentKey : "").Append(',')
                            .Append(view.Back?.AppliedFingerprint ?? "").Append('\n');
                    }
                }
            } finally {
                foreach (var gameObject in created) if (gameObject != null) UnityEngine.Object.DestroyImmediate(gameObject);
                UnityEngine.Object.DestroyImmediate(solid);
                UnityEngine.Object.DestroyImmediate(faceMaterial);
            }
            var rows = report.ToString().Split('\n').Where(line => line.StartsWith("sign-", StringComparison.Ordinal)).ToArray();
            Assert.AreEqual(21, rows.Length, "one row per saved sign");
            StringAssert.StartsWith("sign-309,ceiling,2,1.45,0.4,3,", rows.First(row => row.StartsWith("sign-309,", StringComparison.Ordinal)));
            StringAssert.StartsWith("sign-wall-395,wall,1,1.65,0.4,4,", rows.First(row => row.StartsWith("sign-wall-395,", StringComparison.Ordinal)));
            foreach (var row in rows) {
                var columns = row.Split(',');
                Assert.IsNotEmpty(columns[6], row + " front content key");
                Assert.IsNotEmpty(columns[7], row + " front texture fingerprint");
            }
            var directory = Path.Combine(Root(), ".preview/unity/signs");
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "f3-zoo-signs.csv"), report.ToString(), new UTF8Encoding(false));
        }

        static string Root() {
            var directory = new DirectoryInfo(Application.dataPath);
            while (directory != null && !File.Exists(Path.Combine(directory.FullName, "video/demo-station.metro.json"))) directory = directory.Parent;
            return directory != null ? directory.FullName : Directory.GetCurrentDirectory();
        }

        /* ------------------------------------------------------------- seam */

        /// <summary>The edit-host surface a coordinator (not a scene host) can supply.</summary>
        sealed class EditHost : IStationSignEditHost {
            readonly StationLoadCoordinator coordinator;
            public EditHost(StationLoadCoordinator coordinator) { this.coordinator = coordinator; }
            public StationDocument Document => coordinator.Document;
            public int CurrentRevision => coordinator.Revision;
            public string CurrentSourceId => coordinator.SourceId;
            public string SaveDocument() => coordinator.Save(DateTimeOffset.UtcNow);
            public StationLoadResult ApplyDocumentEdit(string json, string sourceId) => coordinator.InstallEditedDocument(json, sourceId);
            public void RegisterStateContributor(IStationStateContributor contributor) { }
        }
    }
}
