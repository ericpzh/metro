using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Metro.App;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

/// <summary>
/// Packet F (plan 11): every saved 指示牌 shows its real board — the mount and
/// physical panel of `sim/sign.ts`, the front/back content of its document, and
/// the pixels `render/signFace.ts` paints, on the right side and the right way up.
///
/// The fixture is the shipped Zoo document; the pinned table is the shipping
/// TypeScript's own output for it (`signMountSpec` / `mountedSignBoards` /
/// `signBoardsPanel` / `signPlate`), so a port that drifts from the browser fails
/// here rather than in a screenshot nobody diffs.
/// </summary>
public class StationSignViewTests {
    /* ---------------------------------------------------------------- fixture */

    static string Root() {
        var dir = new DirectoryInfo(Application.dataPath);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "video/demo-station.metro.json"))) dir = dir.Parent;
        return dir != null ? dir.FullName : Directory.GetCurrentDirectory();
    }

    static string ZooPath => Path.Combine(Application.dataPath, "StationDesigner/Zoo/ZooSave.json");

    static JObject Save() => JObject.Parse(File.ReadAllText(ZooPath));

    static JObject[] SignModules(JObject save) =>
        save["static"]["modules"].Where(module => (string)module["type"] == "sign").Cast<JObject>().ToArray();

    static StationSignLine[] Lines(JObject save) =>
        save["static"]["lines"].Select(line => new StationSignLine(
            (string)line["id"], (string)line["name"], (string)line["colour"],
            line["nameEn"] != null ? (string)line["nameEn"] : "")).ToArray();

    /// <summary>
    /// One saved record as the view's plain request. The boards are the ones
    /// `StationSignRepair` normalized (the load path's own boundary), and a
    /// ceiling-anchored piece hangs from the block over its cell — the first branch
    /// of `hangCeilingLocal`; the others come from packet A's mount geometry.
    /// </summary>
    static StationSignRequest RequestFor(JObject module, StationSignLine[] lines, float? hangOverride = null) {
        var normalized = JObject.Parse(StationSignRepair.NormalizeJson(module.ToString(Newtonsoft.Json.Formatting.None)));
        var cfg = normalized["cfg"];
        var offset = cfg["boothOffset"] as JObject;
        bool anchored = module["ceilingAnchored"] != null && (bool)module["ceilingAnchored"];
        return new StationSignRequest {
            ModuleId = (string)module["id"],
            Mount = StationSignMounts.Of(cfg["mount"] != null ? (string)cfg["mount"] : ""),
            FrontJson = cfg["front"] != null ? cfg["front"].ToString(Newtonsoft.Json.Formatting.None) : "",
            BackJson = cfg["back"] != null ? cfg["back"].ToString(Newtonsoft.Json.Formatting.None) : "",
            BoothId = cfg["boothId"] != null ? (string)cfg["boothId"] : "",
            BoothOffsetX = offset?["x"] != null ? (float)offset["x"] : 0f,
            BoothOffsetY = offset?["y"] != null ? (float)offset["y"] : 0f,
            HangCeilingLocal = hangOverride ?? (anchored ? 0f : 4f),
            Lines = lines,
            DefaultLineId = lines.Length > 0 ? lines[0].Id : "",
            Locale = "zh-CN",
        };
    }

    /* -------------------------------------------------------------- materials */

    Material[] materials;
    StationSignMaterials palette;
    readonly List<GameObject> created = new List<GameObject>();

    [SetUp] public void SetUp() {
        var shader = Shader.Find("Unlit/Texture");
        Assert.IsNotNull(shader, "Unlit/Texture shader is missing in the editor");
        var solid = new Material(shader) { name = "sign test steel" };
        var face = new Material(shader) { name = "sign test face" };
        materials = new[] { solid, face };
        palette = StationSignMaterials.Create(solid, solid, solid, face);
        StationSignSignage.SendHook = null;
        StationSignSignage.Locale = "zh-CN";
    }

    [TearDown] public void TearDown() {
        StationSignSignage.SendHook = null;
        foreach (var gameObject in created) if (gameObject != null) UnityEngine.Object.DestroyImmediate(gameObject);
        created.Clear();
        foreach (var material in materials) if (material != null) UnityEngine.Object.DestroyImmediate(material);
    }

    StationSignView Build(StationSignRequest request, StationSignHolderSet holders = default) {
        var view = StationSignView.Build(request, palette, holders);
        created.Add(view.gameObject);
        return view;
    }

    /* ------------------------------------------------------------ the table */

    sealed class Row {
        public string Id;
        public StationSignMount Mount;
        public float PanelW, PanelH, CentreZ;
        public int PlateW, PlateH, Boards, Front, Back;
    }

    /// <summary>
    /// The 21 Zoo signs as the TypeScript model resolves them: mount, pair panel,
    /// plate pixels, mounted boards and the panel's centre. Generated from the
    /// shipping `sim/sign.ts` for this exact save (`unity/plan/11-evidence/F.md`).
    /// </summary>
    static readonly Row[] Zoo = {
            new Row { Id = "sign-309", Mount = StationSignMount.Ceiling, PanelW = 1.45f, PanelH = 0.4f, PlateW = 742, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 3, Back = 3 },
            new Row { Id = "sign-314", Mount = StationSignMount.Ceiling, PanelW = 1.15f, PanelH = 0.4f, PlateW = 589, PlateH = 205, Boards = 1, CentreZ = -0.65f, Front = 3, Back = 0 },
            new Row { Id = "sign-313", Mount = StationSignMount.Ceiling, PanelW = 1.65f, PanelH = 0.4f, PlateW = 845, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-315", Mount = StationSignMount.Ceiling, PanelW = 1.45f, PanelH = 0.4f, PlateW = 742, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 3, Back = 3 },
            new Row { Id = "sign-319", Mount = StationSignMount.Ceiling, PanelW = 1.65f, PanelH = 0.4f, PlateW = 845, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-301", Mount = StationSignMount.Ceiling, PanelW = 1.4f, PanelH = 0.4f, PlateW = 717, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 3, Back = 2 },
            new Row { Id = "sign-302", Mount = StationSignMount.Ceiling, PanelW = 1.6f, PanelH = 0.4f, PlateW = 819, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 2, Back = 4 },
            new Row { Id = "sign-382", Mount = StationSignMount.Ceiling, PanelW = 1.7f, PanelH = 0.4f, PlateW = 870, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-383", Mount = StationSignMount.Ceiling, PanelW = 2.05f, PanelH = 0.4f, PlateW = 1050, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 5, Back = 3 },
            new Row { Id = "sign-384", Mount = StationSignMount.Ceiling, PanelW = 1.95f, PanelH = 0.4f, PlateW = 998, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 5, Back = 2 },
            new Row { Id = "sign-385", Mount = StationSignMount.Ceiling, PanelW = 1f, PanelH = 0.4f, PlateW = 512, PlateH = 205, Boards = 1, CentreZ = -0.65f, Front = 2, Back = 0 },
            new Row { Id = "sign-386", Mount = StationSignMount.Ceiling, PanelW = 2.25f, PanelH = 0.4f, PlateW = 1152, PlateH = 205, Boards = 1, CentreZ = -0.65f, Front = 5, Back = 0 },
            new Row { Id = "sign-390", Mount = StationSignMount.Ceiling, PanelW = 1.45f, PanelH = 0.4f, PlateW = 742, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 3, Back = 3 },
            new Row { Id = "sign-392", Mount = StationSignMount.Ceiling, PanelW = 2.25f, PanelH = 0.4f, PlateW = 1152, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 5, Back = 5 },
            new Row { Id = "sign-wall-395", Mount = StationSignMount.Wall, PanelW = 1.65f, PanelH = 0.4f, PlateW = 845, PlateH = 205, Boards = 1, CentreZ = 1.65f, Front = 4, Back = 0 },
            new Row { Id = "sign-ceiling-396", Mount = StationSignMount.Ceiling, PanelW = 1.7f, PanelH = 0.4f, PlateW = 870, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-ceiling-397", Mount = StationSignMount.Ceiling, PanelW = 1.65f, PanelH = 0.4f, PlateW = 845, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-ceiling-398", Mount = StationSignMount.Ceiling, PanelW = 1.9f, PanelH = 0.4f, PlateW = 973, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 5, Back = 5 },
            new Row { Id = "sign-ceiling-399", Mount = StationSignMount.Ceiling, PanelW = 1.65f, PanelH = 0.4f, PlateW = 845, PlateH = 205, Boards = 2, CentreZ = -0.65f, Front = 4, Back = 4 },
            new Row { Id = "sign-wall-726", Mount = StationSignMount.Wall, PanelW = 1f, PanelH = 0.4f, PlateW = 512, PlateH = 205, Boards = 1, CentreZ = 2.2f, Front = 2, Back = 0 },
            new Row { Id = "sign-wall-727", Mount = StationSignMount.Wall, PanelW = 1f, PanelH = 0.4f, PlateW = 512, PlateH = 205, Boards = 1, CentreZ = 2.2f, Front = 2, Back = 0 },
    };

    /* ----------------------------------------------------------------- tests */

    [Test] public void ZooSignsMountTheSourceBoards() {
        var save = Save();
        var lines = Lines(save);
        var modules = SignModules(save);
        Assert.AreEqual(21, modules.Length, "the Zoo fixture carries 21 signs");
        Assert.AreEqual(Zoo.Length, modules.Length, "the pinned table must cover every saved sign");
        foreach (var expected in Zoo) {
            var module = modules.FirstOrDefault(value => (string)value["id"] == expected.Id);
            Assert.IsNotNull(module, "missing sign " + expected.Id);
            var view = Build(RequestFor(module, lines));
            Assert.IsTrue(view.Supported, expected.Id + ": " + view.Issue);
            Assert.AreEqual(expected.Mount, view.Mount, expected.Id + " mount");
            Assert.AreEqual(expected.PanelW, view.Panel.x, 0.0001f, expected.Id + " panel width");
            Assert.AreEqual(expected.PanelH, view.Panel.y, 0.0001f, expected.Id + " panel height");
            Assert.AreEqual(expected.CentreZ, view.PanelCentreZ, 0.0001f, expected.Id + " panel centre");
            Assert.AreEqual(expected.Boards, view.BoardCount, expected.Id + " boards");
            var front = view.FaceRequest(StationSignFaceName.Front);
            Assert.IsNotNull(front, expected.Id + " front request");
            Assert.AreEqual(expected.PlateW, front.PlateWidth, expected.Id + " plate width");
            Assert.AreEqual(expected.PlateH, front.PlateHeight, expected.Id + " plate height");
            Assert.AreEqual(expected.Front, front.Components.Length, expected.Id + " front components");
            var back = view.FaceRequest(StationSignFaceName.Back);
            if (expected.Back == 0) Assert.IsNull(back, expected.Id + " must not mount an empty back");
            else {
                Assert.IsNotNull(back, expected.Id + " back request");
                Assert.AreEqual(expected.Back, back.Components.Length, expected.Id + " back components");
            }
            // No promoted holder matches a Zoo sign: their ceilings are their own cell's
            // block (hang 0), not the export's 4 m room, so every board is built to size.
            Assert.IsFalse(view.HolderMatched, expected.Id + " must not stretch the promoted holder");
            Assert.AreEqual("parts", view.HolderSource, expected.Id + " holder source");
        }
    }

    [Test] public void MountGeometryFollowsTheSourceModel() {
        var save = Save();
        var lines = Lines(save);
        var modules = SignModules(save);

        // A hung board: dark frame round a lightbox at zc, two rods to the hang surface,
        // and one plate per face at ±(0.04 + 0.012).
        var hung = Build(RequestFor(modules.First(m => (string)m["id"] == "sign-309"), lines));
        Assert.AreEqual(-0.65f, hung.PanelCentreZ, 0.0001f);
        AssertNear(new Vector3(0f, -0.65f, 0.052f), hung.Front.LocalPosition, "front plate sits on the +plan-y side");
        AssertNear(new Vector3(0f, -0.65f, -0.052f), hung.Back.LocalPosition, "back plate is the opposite face");
        Assert.AreEqual(1.45f - 0.06f, hung.Front.Width, 0.0001f, "the plate is inset in the frame");
        Assert.AreEqual(0.4f - 0.06f, hung.Front.Height, 0.0001f);
        Assert.AreEqual(2, Parts(hung, "rod").Length, "two suspension rods");
        Assert.AreEqual(2, Parts(hung, "ceiling plate").Length, "two ceiling plates");
        var rod = Parts(hung, "rod")[0].transform;
        // hang 0 is the module's own z+1 plane; the rod spans (zc + H/2) .. (ceiling − 0.04).
        Assert.AreEqual(0.41f, rod.localScale.y, 0.0001f, "rod length to a 0 m hang surface");
        Assert.AreEqual(0.375f, Mathf.Abs(rod.localPosition.x), 0.0001f, "rods are spaced to the board's width");
        var frame = Parts(hung, "frame")[0].transform;
        AssertNear(new Vector3(1.45f, 0.08f, 0.4f), frame.localScale, "frame is the panel's own size");
        AssertNear(new Vector3(0f, -0.65f, 0f), frame.localPosition, "frame is centred on the panel");

        // A wall board is the sheet alone, 3 mm proud of the wall (no rods, no housing).
        var wall = Build(RequestFor(modules.First(m => (string)m["id"] == "sign-wall-395"), lines));
        Assert.AreEqual(0, Parts(wall, "frame").Length + Parts(wall, "rod").Length, "a wall board has no housing");
        AssertNear(new Vector3(0f, 1.65f, -0.497f), wall.Front.LocalPosition, "the sheet is bolted at eye height");
        Assert.AreEqual(1.65f, wall.Front.Width, 0.0001f, "a wall sheet is the whole panel");
        Assert.IsNull(wall.Back, "the wall is behind it, so there is no second face");

        // A booth board aligns with the header band rather than eye height.
        var booth = Build(RequestFor(modules.First(m => (string)m["id"] == "sign-wall-726"), lines));
        Assert.AreEqual(2.2f, booth.PanelCentreZ, 0.0001f, "booth header centre");
        Assert.AreEqual(1f, booth.Panel.x, 0.0001f);
        Assert.AreEqual(0, Parts(booth, "frame").Length, "the booth's frame is the backing");
    }

    [Test] public void FrontAndBackAreDistinctBoards() {
        var save = Save();
        var lines = Lines(save);
        var view = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-309"), lines));
        var front = view.FaceRequest(StationSignFaceName.Front);
        var back = view.FaceRequest(StationSignFaceName.Back);
        Assert.AreNotEqual(front.ContentKey, back.ContentKey, "front and back are two documents");
        StringAssert.Contains("文冲方向\nTowards Wenchong",
            front.Components.First(c => c.Kind == StationSignComponentKind.Text).Text);
        Assert.AreEqual(StationSignArrow.DownLeft, front.Components[0].Arrow, "the front approaches down-left");
        Assert.AreEqual(StationSignArrow.DownRight, back.Components.Last().Arrow, "the back reads the other way");

        // The two faces of one sign are two plates on one piece of steel, and each is
        // readable from its own side: front +z, back −z, never a mirrored copy.
        Assert.AreEqual(Vector3.forward, view.Front.LocalNormal);
        Assert.AreEqual(Vector3.back, view.Back.LocalNormal);
        Assert.AreEqual(180f, view.Front.LocalYaw, 0.001f);
        Assert.AreEqual(0f, view.Back.LocalYaw, 0.001f);
        Assert.AreEqual(front.PlateWidth, back.PlateWidth, "both plates are cut to the pair's panel");
        Assert.AreEqual(front.PlateHeight, back.PlateHeight);
    }

    [Test] public void CjkEnglishLineBadgeIconsAndArrowsReachThePainter() {
        var save = Save();
        var lines = Lines(save);
        var modules = SignModules(save);

        // sign-383: line badge + both languages + two diagonal arrows.
        var badge = Build(RequestFor(modules.First(m => (string)m["id"] == "sign-383"), lines));
        var request = badge.FaceRequest(StationSignFaceName.Front);
        Assert.AreEqual(2, request.Components.Count(c => c.Kind == StationSignComponentKind.Arrow));
        var line = request.Components.First(c => c.Kind == StationSignComponentKind.Line);
        Assert.AreEqual("5", line.LineId);
        Assert.IsTrue(line.English, "the shield prints its English gloss");
        Assert.AreEqual("5号线", request.ResolveLine(line)?.Name, "the shield reads the live line document");
        Assert.AreEqual("#c70541", request.ResolveLine(line)?.Colour);
        StringAssert.Contains("文冲方向", request.Components.First(c => c.Kind == StationSignComponentKind.Text).Text);
        CollectionAssert.Contains(request.LineDependencies, "5");

        // sign-314: a bitmap pictogram, a two-language label and an arrow.
        var icon = Build(RequestFor(modules.First(m => (string)m["id"] == "sign-314"), lines));
        var iconRequest = icon.FaceRequest(StationSignFaceName.Front);
        Assert.AreEqual(StationSignIcon.Lift, iconRequest.Components.First(c => c.Kind == StationSignComponentKind.Icon).Icon);
        Assert.IsTrue(StationSignVocabulary.IconNeedsArt(StationSignIcon.Lift), "the lift mark is bitmap art");
        StringAssert.Contains("C出口\nExit C", iconRequest.Components.First(c => c.Kind == StationSignComponentKind.Text).Text);
        Assert.AreEqual(StationSignArrow.Right, iconRequest.Components.First(c => c.Kind == StationSignComponentKind.Arrow).Arrow);

        // The bridge request carries that content verbatim: JSON is the painter's input.
        var sent = new List<string>();
        var provider = new StationSignWebProvider(json => { sent.Add(json); return true; },
            () => new StationSignContext { SessionId = "s-1", Revision = 4 });
        using (var cache = new StationSignTextureCache(provider)) {
            cache.Bind(badge, StationSignFaceName.Front);
            cache.Pump();
        }
        Assert.AreEqual(1, sent.Count, "one bounded request");
        var envelope = JObject.Parse(sent[0]);
        Assert.AreEqual("signRequest", (string)envelope["kind"]);
        Assert.AreEqual(2, (int)envelope["schemaVersion"]);
        Assert.AreEqual("sign.requestFace", (string)envelope["type"]);
        var payload = (JObject)envelope["payload"];
        var faceJson = (JObject)payload["faces"][0];
        Assert.AreEqual("sign-383", (string)faceJson["moduleId"]);
        Assert.AreEqual("front", (string)faceJson["face"]);
        Assert.AreEqual(2.05f, (float)faceJson["panel"]["w"], 0.0001f);
        StringAssert.Contains("文冲方向", faceJson["components"].ToString());
        Assert.AreEqual("5号线", (string)faceJson["lines"][0]["name"]);
        Assert.AreEqual("5", (string)faceJson["defaultLineId"]);
    }

    [Test] public void EveryFaceIsReadableFromItsOwnSide() {
        var save = Save();
        var lines = Lines(save);
        foreach (var module in SignModules(save)) {
            var view = Build(RequestFor(module, lines));
            foreach (var slot in view.Slots) {
                // The viewer stands on the face's own side, up is +y, and looks at it.
                var forward = -slot.LocalNormal;
                var viewerRight = Vector3.Cross(Vector3.up, forward).normalized;
                var rotation = Quaternion.Euler(0f, slot.LocalYaw, 0f);
                var u = rotation * Vector3.right;
                var v = rotation * Vector3.up;
                Assert.AreEqual(1f, Vector3.Dot(u, viewerRight), 0.001f,
                    module["id"] + " " + slot.Face + ": the painted +u must run to the viewer's right");
                Assert.AreEqual(1f, Vector3.Dot(v, Vector3.up), 0.001f,
                    module["id"] + " " + slot.Face + ": the painted +v must run up");
            }
        }
    }

    [Test] public void NormalizationIsAFixedPointOnTheSavedBoards() {
        var save = Save();
        foreach (var module in SignModules(save)) {
            var request = RequestFor(module, Lines(save));
            foreach (var json in new[] { request.FrontJson, request.BackJson }) {
                if (string.IsNullOrEmpty(json) || json.TrimStart()[0] != '[') continue;
                var boards = StationSignBoards.FromConfig(json, "", "");
                var once = StationSignBoards.Normalize(boards.Front);
                var twice = StationSignBoards.Normalize(once);
                Assert.AreEqual(once.Length, twice.Length, module["id"] + " normalize changed the count");
                for (int i = 0; i < once.Length; i++) {
                    Assert.AreEqual(once[i].X, twice[i].X, 0.0001f, module["id"] + " normalize moved x");
                    Assert.AreEqual(0.2f, once[i].Y, 0.0001f, module["id"] + " row centre");
                }
            }
        }
    }

    [Test] public void LegacyBoardsFailClosed() {
        var boards = StationSignBoards.FromConfig(null, null,
            "[{\"id\":\"c1\",\"kind\":\"arrow\",\"arrow\":\"left\",\"x\":0.3,\"y\":0.2,\"scale\":1,\"side\":\"both\"}]");
        Assert.IsFalse(boards.Supported, "a per-component board must not be guessed at");
        StringAssert.Contains("legacy", boards.Issue);
        var view = Build(new StationSignRequest {
            ModuleId = "legacy", Mount = StationSignMount.Ceiling,
            ComponentsJson = "[{\"id\":\"c1\",\"kind\":\"arrow\",\"arrow\":\"left\",\"x\":0.3,\"y\":0.2,\"scale\":1}]",
        });
        Assert.IsFalse(view.Supported);
        Assert.AreEqual(0, view.BoardCount);
        Assert.AreEqual(0, view.GetComponentsInChildren<MeshRenderer>().Length, "a refused record draws nothing");
    }

    /* ----------------------------------------------------- promoted holders */

    static GameObject Prefab(string name) => AssetDatabase.LoadAssetAtPath<GameObject>(
        "Assets/StationDesigner/Generated/Prefabs/" + name + ".prefab");

    [Test] public void PromotedHolderIsUsedOnlyWhenDimensionsAndAnchorsMatch() {
        var ceilingPrefab = Prefab("SignCeiling");
        var wallPrefab = Prefab("SignWall");
        Assert.IsNotNull(ceilingPrefab, "sign-ceiling prefab missing");
        Assert.IsNotNull(wallPrefab, "sign-wall prefab missing");
        var holders = new StationSignHolderSet { CeilingHolder = ceilingPrefab, WallHolder = wallPrefab };

        var save = Save();
        var lines = Lines(save);
        // sign-ceiling-398 is the one Zoo board at the export's own panel (1.9 x 0.4).
        var module = SignModules(save).First(m => (string)m["id"] == "sign-ceiling-398");

        var atExportHang = Build(RequestFor(module, lines, hangOverride: 4f), holders);
        Assert.IsTrue(StationSignView.MeasureHolder(ceilingPrefab, StationSignMount.Ceiling,
                new Vector2(1.9f, 0.4f), 3.35f, 4f, out var holderReason), holderReason);
        Assert.IsTrue(atExportHang.HolderMatched, "a 1.9 x 0.4 board under a 4 m ceiling is the holder's own case");
        Assert.AreEqual("promoted:SignCeiling", atExportHang.HolderSource);
        Assert.AreEqual(2, atExportHang.BoardCount, "both faces still mount on the promoted holder");
        Assert.AreEqual(1.9f - 0.06f, atExportHang.Front.Width, 0.0001f, "the plates are the packet's own, at the plate size");
        Assert.AreEqual(3.35f, atExportHang.PanelCentreZ, 0.0001f);
        Assert.IsNotNull(atExportHang.transform.Find("holder SignCeiling"), "the promoted holder is instantiated");

        // The same board at the Zoo sign's real hang (0, the block over its cell) is not
        // the export's 4 m room: the holder's rods would be the wrong length.
        var atZooHang = Build(RequestFor(module, lines, hangOverride: 0f), holders);
        Assert.IsFalse(atZooHang.HolderMatched);
        Assert.AreEqual("parts", atZooHang.HolderSource);

        // A wider board must never stretch the holder.
        var wider = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-386"), lines, hangOverride: 4f), holders);
        Assert.IsFalse(wider.HolderMatched, "2.25 m is not the holder's panel");
        Assert.AreEqual(2.25f, wider.Panel.x, 0.0001f);
        Assert.AreEqual(2.25f, Parts(wider, "frame")[0].transform.localScale.x, 0.0001f, "the frame is built to the board");

        // The wall holder matches the export's wall panel and nothing else.
        Assert.IsTrue(StationSignView.MeasureHolder(wallPrefab, StationSignMount.Wall,
            new Vector2(1.9f, 0.4f), StationSignMounts.WallPanelZ, 0f, out var wallReason), wallReason);
        Assert.IsFalse(StationSignView.MeasureHolder(wallPrefab, StationSignMount.Wall,
            new Vector2(1.65f, 0.4f), StationSignMounts.WallPanelZ, 0f, out _));
        Assert.IsFalse(StationSignView.MeasureHolder(null, StationSignMount.Ceiling,
            new Vector2(1.9f, 0.4f), 3.35f, 4f, out var missing), "no holder must not match");
        StringAssert.Contains("no promoted holder", missing);
    }

    /* -------------------------------------------------------------- the cache */

    /// <summary>A headless provider: records requests and feeds deterministic replies.</summary>
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

    /// <summary>A flat PNG, encoded by Unity, for cache mechanics that do not need art.</summary>
    static byte[] FlatPng(int width, int height, Color32 colour) {
        var texture = new Texture2D(width, height, TextureFormat.RGBA32, false);
        var pixels = new Color32[width * height];
        for (int i = 0; i < pixels.Length; i++) pixels[i] = colour;
        texture.SetPixels32(pixels);
        texture.Apply();
        var png = texture.EncodeToPNG();
        UnityEngine.Object.DestroyImmediate(texture);
        return png;
    }

    static StationSignFaceResponse Reply(StationSignFaceBatch batch, StationSignFaceRequest face, byte[] png, int? width = null, int? height = null) {
        return new StationSignFaceResponse {
            RequestId = batch.RequestId,
            ArtReady = true,
            Painted = new[] {
                new StationSignPaintedFace {
                    Key = face.ContentKey, ModuleId = face.ModuleId, Face = face.Face,
                    Width = width ?? face.PlateWidth, Height = height ?? face.PlateHeight, Png = png,
                },
            },
        };
    }

    [Test] public void CacheUploadsAndAssignsEachFaceSlot() {
        var save = Save();
        var lines = Lines(save);
        var view = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-309"), lines));
        var provider = new TestProvider();
        using (var cache = new StationSignTextureCache(provider)) {
            var binding = cache.BindView(view);
            Assert.IsNotNull(binding.Front);
            Assert.IsNotNull(binding.Back);
            cache.Pump();
            Assert.AreEqual(1, provider.Batches.Count, "both faces travel in one batch");
            var batch = provider.Batches[0];
            Assert.AreEqual(2, batch.Faces.Length);
            Assert.AreEqual("zh-CN", batch.Locale);

            // Deliver only the front: the back must stay unpainted.
            var front = batch.Faces.First(face => face.Face == StationSignFaceName.Front);
            var png = FlatPng(front.PlateWidth, front.PlateHeight, new Color32(13, 17, 22, 255));
            provider.Replies.Enqueue(Reply(batch, front, png));
            cache.Pump();
            Assert.IsNotNull(view.Front.AppliedTexture, "the front plate takes the painted texture");
            Assert.AreEqual(front.PlateWidth, view.Front.AppliedTexture.width);
            Assert.AreEqual(front.PlateHeight, view.Front.AppliedTexture.height);
            Assert.IsNull(view.Back.AppliedTexture, "a face with no reply keeps the dark plate");
            Assert.IsTrue(binding.Front.Fingerprint.Contains("@"), "the applied texture is fingerprinted");
            StringAssert.StartsWith(binding.Front.Key.Substring(0, 16), binding.Front.Fingerprint);
            Assert.AreEqual(1, cache.LiveTextureCount);
            Assert.AreEqual(1, cache.PendingFaceCount, "the back is still waiting");
        }
        UnityEngine.Object.DestroyImmediate(view.gameObject);
    }

    /// <summary>A `sign.faceChunk` as the browser sends it (a v2 command on the bridge).</summary>
    static string Chunk(string requestId, string key, string face, int width, int height, int count, int index, string data, string sessionId, int revision) {
        return new JObject {
            ["schemaVersion"] = 2, ["id"] = "c-chunk", ["sessionId"] = sessionId, ["type"] = "sign.faceChunk",
            ["payload"] = new JObject {
                ["requestId"] = requestId, ["key"] = key, ["moduleId"] = "sign-test", ["face"] = face,
                ["width"] = width, ["height"] = height, ["index"] = index, ["count"] = count,
                ["data"] = data, ["sessionId"] = sessionId, ["revision"] = revision,
            },
        }.ToString(Newtonsoft.Json.Formatting.None);
    }

    static string Ready(string requestId, string key, string face, int width, int height, int bytes, string sessionId, int revision) {
        return new JObject {
            ["schemaVersion"] = 2, ["id"] = "c-ready", ["sessionId"] = sessionId, ["type"] = "sign.faceReady",
            ["payload"] = new JObject {
                ["requestId"] = requestId, ["sessionId"] = sessionId, ["revision"] = revision, ["artReady"] = true,
                ["painted"] = new JArray(new JObject {
                    ["key"] = key, ["moduleId"] = "sign-test", ["face"] = face,
                    ["width"] = width, ["height"] = height, ["bytes"] = bytes, ["chunks"] = 1,
                }),
                ["pending"] = new JArray(),
            },
        }.ToString(Newtonsoft.Json.Formatting.None);
    }

    [Test] public void StaleRepliesAreRejectedBeforeTheyReachAPlate() {
        var save = Save();
        var lines = Lines(save);
        var view = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-314"), lines));
        var context = new StationSignContext { SessionId = "s-1", Revision = 7 };
        var sent = new List<string>();
        var provider = new StationSignWebProvider(json => { sent.Add(json); return true; }, () => context);
        var png = FlatPng(view.FaceRequest(StationSignFaceName.Front).PlateWidth,
            view.FaceRequest(StationSignFaceName.Front).PlateHeight, new Color32(200, 200, 200, 255));
        int plateW = view.FaceRequest(StationSignFaceName.Front).PlateWidth;
        int plateH = view.FaceRequest(StationSignFaceName.Front).PlateHeight;
        using (var cache = new StationSignTextureCache(provider)) {
            cache.BindView(view);
            cache.Pump();
            Assert.AreEqual(1, sent.Count);
            var request = JObject.Parse(sent[0]);
            var requestId = (string)request["id"];
            var key = (string)((JObject)request["payload"]["faces"][0])["key"];

            // 1. A reply for another session is a picture of another station.
            provider.Receive(Chunk(requestId, key, "front", plateW, plateH, 1, 0, Convert.ToBase64String(png), "s-2", 7));
            provider.Receive(Ready(requestId, key, "front", plateW, plateH, png.Length, "s-2", 7));
            cache.Pump();
            Assert.IsNull(view.Front.AppliedTexture, "a stale session must not paint the board");

            // 2. A reply for a revision the station has already moved past.
            cache.RetryNow();
            context.Revision = 9;
            cache.Pump();
            Assert.AreEqual(2, sent.Count, "the board is asked for again after the station moved on");
            requestId = (string)JObject.Parse(sent[1])["id"];
            provider.Receive(Chunk(requestId, key, "front", plateW, plateH, 1, 0, Convert.ToBase64String(png), "s-1", 7));
            provider.Receive(Ready(requestId, key, "front", plateW, plateH, png.Length, "s-1", 7));
            cache.Pump();
            Assert.IsNull(view.Front.AppliedTexture, "an older revision must not paint the board");

            // 3. A reply whose pixels are not the plate the board asked for.
            cache.RetryNow();
            cache.Pump();
            Assert.AreEqual(3, sent.Count);
            requestId = (string)JObject.Parse(sent[2])["id"];
            provider.Receive(Chunk(requestId, key, "front", plateW + 3, plateH, 1, 0, Convert.ToBase64String(png), "s-1", 9));
            provider.Receive(Ready(requestId, key, "front", plateW + 3, plateH, png.Length, "s-1", 9));
            cache.Pump();
            Assert.IsNull(view.Front.AppliedTexture, "a mis-sized plate must not be applied");

            // 4. And the current one lands.
            cache.RetryNow();
            cache.Pump();
            Assert.AreEqual(4, sent.Count);
            requestId = (string)JObject.Parse(sent[3])["id"];
            provider.Receive(Chunk(requestId, key, "front", plateW, plateH, 1, 0, Convert.ToBase64String(png), "s-1", 9));
            provider.Receive(Ready(requestId, key, "front", plateW, plateH, png.Length, "s-1", 9));
            cache.Pump();
            Assert.IsNotNull(view.Front.AppliedTexture, "the matching reply paints the plate");
        }
        UnityEngine.Object.DestroyImmediate(view.gameObject);
    }

    [Test] public void ChunkedPngFromTheShippingPainterLandsOnTheBoard() {
        // `drawSignPanel`'s own output for Zoo's sign-314 front face (589 x 205: the
        // lift pictogram, 中文/English label and arrow), through the packet's offscreen
        // painter. Bytes: 8,136, sha256 311fb4574af372003455b159a2a053870e59c88ff6cc0854781574743c4887c6.
        var fixture = Convert.FromBase64String(PainterFixtureFront);
        Assert.AreEqual(8136, fixture.Length, "the pinned fixture is the painter's 8,136-byte PNG");

        var save = Save();
        var lines = Lines(save);
        var view = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-314"), lines));
        Assert.AreEqual(589, view.FaceRequest(StationSignFaceName.Front).PlateWidth);
        Assert.AreEqual(205, view.FaceRequest(StationSignFaceName.Front).PlateHeight);
        var context = new StationSignContext { SessionId = "s-1", Revision = 2 };
        var sent = new List<string>();
        var provider = new StationSignWebProvider(json => { sent.Add(json); return true; }, () => context);
        using (var cache = new StationSignTextureCache(provider)) {
            var binding = cache.BindView(view);
            cache.Pump();
            var request = JObject.Parse(sent[0]);
            var requestId = (string)request["id"];
            var key = (string)((JObject)request["payload"]["faces"][0])["key"];

            // Two bounded slices, exactly as the bridge carries them (48 KiB in the Web build).
            var base64 = Convert.ToBase64String(fixture);
            const int chunkSize = 6000;
            int count = (base64.Length + chunkSize - 1) / chunkSize;
            for (int index = 0; index < count; index++) {
                var slice = base64.Substring(index * chunkSize, Math.Min(chunkSize, base64.Length - index * chunkSize));
                provider.Receive(Chunk(requestId, key, "front", 589, 205, count, index, slice, "s-1", 2));
            }
            provider.Receive(Ready(requestId, key, "front", 589, 205, fixture.Length, "s-1", 2));
            cache.Pump();
            Assert.IsNotNull(view.Front.AppliedTexture, "the reassembled PNG must land on the front plate");
            Assert.AreEqual(589, view.Front.AppliedTexture.width);
            Assert.AreEqual(205, view.Front.AppliedTexture.height);
            StringAssert.StartsWith(key.Substring(0, 16), view.Front.AppliedFingerprint);
            Assert.IsTrue(binding.Front.HasTexture);

            // The pixels are the painter's, not a placeholder: the board's near-black
            // ground and its pale ink are both present.
            var pixels = view.Front.AppliedTexture.GetPixels32();
            int ink = 0, ground = 0;
            foreach (var pixel in pixels) {
                if (pixel.r > 200 && pixel.g > 200 && pixel.b > 200) ink++;
                else if (pixel.r < 40 && pixel.g < 40 && pixel.b < 40) ground++;
            }
            Assert.Greater(ink, 1000, "the painted board carries its type and marks");
            Assert.Greater(ground, 1000, "the painted board carries its dark ground");

            // The same board on another sign is a cache hit, not a second paint.
            var second = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-314"), lines));
            var secondBinding = cache.Bind(second, StationSignFaceName.Front);
            Assert.IsNotNull(secondBinding);
            Assert.AreEqual(binding.Front.Key, secondBinding.Key, "same content, same key");
            Assert.AreSame(view.Front.AppliedTexture, second.Front.AppliedTexture, "the textures are shared, not repainted");
            UnityEngine.Object.DestroyImmediate(second.gameObject);
        }
        UnityEngine.Object.DestroyImmediate(view.gameObject);
    }

    [Test] public void InvalidationTouchesOnlyAffectedBoards() {
        var save = Save();
        var lines = Lines(save);
        var withLine = Build(RequestFor(SignModules(save).First(m => (string)m["id"] == "sign-309"), lines));
        var iconOnly = Build(new StationSignRequest {
            ModuleId = "icon-only", Mount = StationSignMount.Wall,
            FrontJson = "[{\"id\":\"c1\",\"kind\":\"icon\",\"icon\":\"lift\",\"x\":0.4,\"y\":0.2,\"scale\":1,\"side\":\"both\"}]",
            Lines = lines, DefaultLineId = "5", Locale = "zh-CN",
        });
        Assert.AreEqual(0, iconOnly.FaceRequest(StationSignFaceName.Front).LineDependencies.Length, "an icon-only board prints no shield");
        Assert.IsFalse(iconOnly.FaceRequest(StationSignFaceName.Front).DependsOnFont, "an icon-only board prints no type");
        Assert.IsTrue(withLine.FaceRequest(StationSignFaceName.Front).DependsOnFont, "the shield prints type");

        var provider = new TestProvider();
        using (var cache = new StationSignTextureCache(provider)) {
            var lineBinding = cache.BindView(withLine);
            var iconBinding = cache.BindView(iconOnly);
            cache.Pump();
            var batch = provider.Batches[0];
            foreach (var face in batch.Faces) {
                provider.Replies.Enqueue(Reply(batch, face, FlatPng(face.PlateWidth, face.PlateHeight, new Color32(30, 30, 30, 255))));
            }
            cache.Pump();
            Assert.AreEqual(3, cache.TextureCount, "two faces of the line board plus the icon board");
            var iconTexture = iconOnly.Front.AppliedTexture;
            Assert.IsNotNull(iconTexture);

            // A line edit reprints the boards that print that shield, and nothing else.
            cache.InvalidateLine("5");
            Assert.AreEqual(1, cache.TextureCount, "only the icon board keeps its pixels");
            Assert.AreEqual(2, cache.PendingFaceCount, "both faces of the line board are queued again");
            cache.Pump();
            Assert.AreEqual(2, provider.Batches.Count, "the reprint is one new batch");
            var reprint = provider.Batches[provider.Batches.Count - 1];
            Assert.AreEqual(2, reprint.Faces.Length, "the reprint asks only for the line board's faces");
            Assert.IsFalse(reprint.Faces.Any(face => face.ContentKey == iconBinding.Front.Key), "the icon board is not repainted");

            // A line nobody prints touches nothing.
            cache.InvalidateLine("2");
            Assert.AreEqual(1, cache.TextureCount);

            // A font epoch reprints type and leaves a pictogram-only board alone.
            cache.SetFontStamp("fonts-2");
            Assert.IsNotNull(iconOnly.Front.AppliedTexture, "the icon board keeps its pixels");
            Assert.AreSame(iconTexture, iconOnly.Front.AppliedTexture, "the icon board was not repainted");
        }
        UnityEngine.Object.DestroyImmediate(withLine.gameObject);
        UnityEngine.Object.DestroyImmediate(iconOnly.gameObject);
    }

    [Test] public void BoothOffsetIsADocumentSpaceStepOnTheRoot() {
        var save = Save();
        var lines = Lines(save);
        var module = SignModules(save).First(m => (string)m["id"] == "sign-wall-726");
        var request = RequestFor(module, lines);
        Assert.AreEqual(0f, request.BoothOffsetX, 0.0001f, "the saved booth offset");
        Assert.AreEqual(0f, request.BoothOffsetY, 0.0001f);
        var view = Build(request);
        // The view never steps itself: the sheet stays on the cell, and the caller's root
        // carries the booth offset in document axes (`SignModel`'s group.position).
        Assert.AreEqual(0f, view.Front.LocalPosition.x, 0.0001f);
        Assert.AreEqual(-0.497f, view.Front.LocalPosition.z, 0.0001f);
        Assert.AreEqual(2.2f, view.Front.LocalPosition.y, 0.0001f);

        // The placement helper applies it in document axes whatever the piece's turn is:
        // a 90° booth board must step along its booth face, not rotate its own step.
        var config = new ModuleConfig(new Dictionary<string, string> {
            { "mount", "wall" },
            { "boothId", "booth-278" },
            { "boothOffset", "{\"x\":0.25,\"y\":-0.4}" },
            { "front", "[{\"id\":\"c1\",\"kind\":\"icon\",\"icon\":\"lift\",\"x\":0.4,\"y\":0.2,\"scale\":1,\"side\":\"both\"}]" },
        });
        var facts = new ModuleFacts {
            Id = "synthetic-booth", Type = "sign", X = 10, Y = 20, Z = -15, Rotation = 1, Config = config,
        };
        var record = new StationModuleRecord("synthetic-booth", "sign", 10, 20, -15, 1, 1, 1, 1, false,
            null, null, Array.Empty<string>(), "{}", facts);
        var placement = StationSignViews.Placement(record);
        Assert.AreEqual(10 + 0.5 + 0.25, placement.x, 0.0001f, "document x keeps the offset sign");
        Assert.AreEqual(-15 + 1, placement.y, 0.0001f, "elevation is the module's z+1 plane");
        Assert.AreEqual(20 + 0.5 - 0.4, placement.z, 0.0001f, "document y is world z");
        Assert.AreEqual(new Vector2(0.25f, -0.4f), StationSignViews.BoothOffset(record));
    }

    /* ------------------------------------------------------------- the world */

    [Test] public void StationRendererBuildsEverySavedSignUnderTheSignsRole() {
        var result = StationDocumentReader.ReadFile(ZooPath);
        Assert.IsNotNull(result.Document, "the Zoo document must load");
        var catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing");
        var shader = Shader.Find("Unlit/Texture");
        var sent = new List<string>();
        StationSignSignage.SendHook = json => sent.Add(json);
        var root = new GameObject("station world test");
        created.Add(root);
        var world = new StationWorldView(root.transform, "signs test",
            new IStationViewRenderer[] { new StationSignRenderer() },
            new StationViewAssets { Catalogue = catalogue, Shader = shader });
        try {
            world.Build(result.Document, result.Index);
            var signs = result.Document.Modules.Count(module => module.Type == "sign");
            Assert.AreEqual(21, signs);
            int registered = 0;
            foreach (var record in world.Records) if (record.Role == "signs") registered++;
            Assert.AreEqual(21, registered, "every saved sign is one board view under the signs role");
            Assert.AreEqual(1, sent.Count, "the build asks for its boards once, in one bounded batch");
            var payload = (JObject)JObject.Parse(sent[0])["payload"];
            var faces = (JArray)payload["faces"];
            Assert.LessOrEqual(faces.Count, StationSignTextureCache.MaxRequestFaces,
                "the request is bounded to the batch size");

            // The cache is keyed by **content**, so the request carries one entry per
            // distinct board, not one per plate: 36 Zoo plates are 29 boards because
            // seven pairs carry identical content. Every plate must still be represented.
            var keys = new HashSet<string>(StringComparer.Ordinal);
            int plates = 0;
            foreach (var view in StationSignSignage.Renderer.Views) {
                foreach (var slot in view.Slots) {
                    plates++;
                    keys.Add(view.FaceRequest(slot.Face).ContentKey);
                }
            }
            Assert.AreEqual(36, plates, "the Zoo document paints 36 plates");
            Assert.AreEqual(keys.Count, faces.Count, "one request entry per distinct board");
            foreach (var face in faces) {
                Assert.IsTrue(keys.Contains((string)face["key"]), "a requested board must be a mounted plate");
            }
            Assert.AreEqual(Math.Min(StationSignTextureCache.MaxRequestFaces, keys.Count), faces.Count,
                "the batch is the smaller of the ceiling and the distinct boards");
            Assert.IsNotNull(StationSignSignage.Cache, "the renderer must leave a live painter connection");
            Assert.AreEqual(keys.Count, StationSignSignage.Cache.PendingFaceCount,
                "every distinct non-empty board is queued");
        } finally {
            world.Dispose();
        }
        Assert.IsNull(StationSignSignage.Provider, "releasing the world releases the painter's connection");
    }

    [Test] public void PerIdReportIsWrittenForEveryZooSign() {
        var save = Save();
        var lines = Lines(save);
        var provider = new TestProvider();
        var report = new StringBuilder();
        report.Append("# Packet F — per-ID sign report (generated by StationSignViewTests)\n\n");
        report.Append("| id | mount | panel m | plate m | boards | centre z | holder | front tex | back tex |\n");
        report.Append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
        using (var cache = new StationSignTextureCache(provider)) {
            var views = new List<StationSignView>();
            foreach (var module in SignModules(save)) {
                var view = Build(RequestFor(module, lines));
                views.Add(view);
                cache.BindView(view);
            }
            cache.Pump();
            // One entry per distinct board (29 for the 36 plates, because the cache is
            // content-addressed); answer each batch until every plate has its pixels so
            // the report carries a fingerprint for both faces.
            for (int round = 0; round < 4 && cache.PendingFaceCount > 0; round++) {
                var batch = provider.Batches[provider.Batches.Count - 1];
                foreach (var face in batch.Faces) {
                    provider.Replies.Enqueue(Reply(batch, face, FlatPng(face.PlateWidth, face.PlateHeight, new Color32(20, 24, 30, 255))));
                }
                cache.Pump();
            }
            Assert.AreEqual(0, cache.PendingFaceCount, "every Zoo plate has pixels for the report");
            foreach (var view in views) {
                int expected = (StationSignBoards.HasInk(view.Boards.Front, StationSignFaceName.Front) ? 1 : 0)
                    + (view.Mount == StationSignMount.Ceiling &&
                       StationSignBoards.HasInk(view.Boards.Back, StationSignFaceName.Back) ? 1 : 0);
                Assert.AreEqual(expected, view.BoardCount, view.ModuleId + " board count");
                Assert.IsTrue(view.Supported, view.ModuleId + ": " + view.Issue);
                report.Append("| ").Append(view.ModuleId)
                    .Append(" | ").Append(StationSignVocabulary.Mount(view.Mount))
                    .Append(" | ").Append(view.Panel.x.ToString("0.00", CultureInfo.InvariantCulture)).Append('×')
                    .Append(view.Panel.y.ToString("0.00", CultureInfo.InvariantCulture))
                    .Append(" | ").Append(view.Front != null ? view.Front.Width.ToString("0.00", CultureInfo.InvariantCulture) + "×" + view.Front.Height.ToString("0.00", CultureInfo.InvariantCulture) : "-")
                    .Append(" | ").Append(view.BoardCount)
                    .Append(" | ").Append(view.PanelCentreZ.ToString("0.000", CultureInfo.InvariantCulture))
                    .Append(" | ").Append(view.HolderSource)
                    .Append(" | ").Append(view.Front?.AppliedFingerprint ?? "-")
                    .Append(" | ").Append(view.Back?.AppliedFingerprint ?? "-")
                    .Append(" |\n");
                UnityEngine.Object.DestroyImmediate(view.gameObject);
            }
        }
        var directory = Path.Combine(Root(), ".preview/unity/signs");
        Directory.CreateDirectory(directory);
        File.WriteAllText(Path.Combine(directory, "f-report.md"), report.ToString());
        StringAssert.Contains("| sign-309 | ceiling | 1.45×0.40 |", report.ToString());
        StringAssert.Contains("sign-wall-726", report.ToString());
        Assert.AreEqual(21, report.ToString().Split('\n').Count(line => line.StartsWith("| sign-", StringComparison.Ordinal)));
    }

    /* -------------------------------------------------------------- helpers */

    static Transform[] Parts(StationSignView view, string name) =>
        view.GetComponentsInChildren<Transform>(true).Where(child => child.name == name).ToArray();

    static void AssertNear(Vector3 expected, Vector3 actual, string message) {
        Assert.AreEqual(expected.x, actual.x, 0.0001f, message + " x");
        Assert.AreEqual(expected.y, actual.y, 0.0001f, message + " y");
        Assert.AreEqual(expected.z, actual.z, 0.0001f, message + " z");
    }

    // The shipping painter's own pixels for Zoo's sign-314 front face: generated by
    // `drawSignPanel` through the packet's offscreen recording surface, 589 x 205,
    // 8,136 bytes, sha256 311fb4574af372003455b159a2a053870e59c88ff6cc0854781574743c4887c6.
    const string PainterFixtureFront =
        "iVBORw0KGgoAAAANSUhEUgAAAk0AAADNCAYAAACl1USpAAAACXBIWXMAAAsTAAALEwEAmpwYAAAfeklEQVR4nO2diXsV1f2H+w/Q" +
        "NmoP+xoIBBEQXBBQQXAFg6hUEBf2xYLWn9YVN8AQQUQRwWqrrbJDALdEUMEFxcpWRRRILCoFsrAEEiTy4HN+zxmfpPcmd0vu3Hu+" +
        "d+bN83yeSnLvzNzveefM2zPnnvlN734DNaEGMAADMAADMAADMDAwYg1+Q4E4SWAABmAABmAABmBgYNQaIE2cKJwoMAADMAADMAAD" +
        "/eooTW0zu+gmLdsRagADMAADMAADMOB7BtIzu4aXJgNIgzRFqAEMwAAMwAAMwIDvGWjcoh3SxInAiQADMAADMAADMNAgSg2QJiCh" +
        "o4ABGIABGIABGEiLXgOkiROFEwUGYAAGYAAGYCANaQICOgIYgAEYgAEYgAHtRg0YaQIkOhMYgAEYgAEYgIE0pAkI6AhgAAZgAAZg" +
        "AAY0I01AQEcAAzAAAzAAAzCQlpwacHuOk42TDQZgAAZgAAZgIA1pAgI6AhiAARiAARiAAc1IExDQEcAADMAADMAADKRxew4I6Ahg" +
        "AAZgAAZgAAa0lBowp0lAIxBqAAMwAAMwAANKfA2QJgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAA" +
        "DMCAEl8DpElAIxBqAAMwAAMwAANKfA2QJgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8D" +
        "pElAIxBqAAMwAAMwAANKfA2QJgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBq" +
        "AAMwAAMwAANKfA2QJgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBqAAMwAAMw" +
        "AANKfA2QJgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBqAAMwAAMwAANKfA2Q" +
        "JgGNQKgBDMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBqAAMwAAMwAANKfA2QJgGNQKgB" +
        "DMAADMAADCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBqAAMwAAMwAANKfA2QJgGNQKgBDMAADMAA" +
        "DCjxNUCaBDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMAADMCAEl8DpElAIxBqAAMwAAMwAANKfA2QJgGNQKgBDMAADMAADCjxNUCa" +
        "BDQCoQYwAAMwAAMwoMTXAGkS0AiEGsAADMCAdxm4/Oos68dAlCs1QJqAiZPJxwwMyLpBT7rrnqCMnTjZ+nERauAlBlaufls/NftZ" +
        "68dBVNw1QJoAiRPJxwwsXp6rK06eCsqBolLrx0WogdekyZxbiJNK+SBNAhqBUANbDCBNsEf/kzxpQpxUyvOGNAloBEINbDGANMEe" +
        "/U9ypQlxUinNHNIkoBEINbDFANIEe/Q/yZcmxEmlLHdIk8sFHT1uos5/d1290qxVO+tAxJNWbTvU63NPe3KG9WNPxfS6tL9+b/1H" +
        "tVKXb+rEK03pGZ1CHsOtI8fG/fleW7RMf/avLaKycMkK6+1OvCFNiJNKySBNLhZzyqNP6IqKCl3fny+/2pHQxn7/g/UJ2/aOr3fq" +
        "kpLSen3uk5WV+oGHHrF+MqRaBgy6MWRHPHT4iKRJ09lduoc8hgenPBH35/t8y/aQ27aZL7Z+ab3diXekCXFSKRekycVi5sycreP5" +
        "+e/+/e43cPM2evUbb+qDRUX61KlTekXuap2R2dn5vZv7KS4pieuzT8/OsX4ypFqQJqTJNoMkfmlCnFRKcYQ0eViaup3fU69ctSbk" +
        "vpYtX6nbZHR0bV9IU/JPXqQJabJ9ASHuSBPipFKGJaTJo9LU/YJeeuOnn0Xc3/IVubpRs9au7A9p+nV+z3U3DtNTHpumX/jr3535" +
        "L8ty1zj/+9zzC/Tku/+i+191rT6rUbOItezc/UK9YvVbUWuONCFNti8gxD1pQpxUSvCENHlQmpq0SHduw8XyM3fefFfEya/SZETp" +
        "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" +
        "va9tkIJBmjwmTes3fKhPnToVdh81ZcekXYdz9NGjR4Nel55xtm+lyWTEmAlRO5238tZaOTY/S5PtIE3224AgTg0sXhuQJo9JUySB" +
        "OX36tH594eJar+9wdtdar/W7NKX9oYnetHlbxA76WMVJ3bFzN9f3fV6P3vrKAYPC/h1pQpoQB+SJESdl5dqANPlImsLNaWqZ3l7n" +
        "5a/VW7dt13sKCpz/9vPtuapc1LuvPnr8RMTO6dXXaktoPOnU9TxdsPdHPXT4iLCvQZqQJqQJaeJWnbJyXUCaPCRNo8dNdL41d+LE" +
        "iZDbP378uPP3kWPGh/0MH328UXc9r0etv/lRmkzuue/hiJ2TmfdyTdb1ruzL3OIywmS2izRxe66KC+Y0IUjJkGTmOCmkyU/SZISp" +
        "pKQ0pv0YwTGTvS+57Arnva3adnD+vW3bdufvW7ZuY6QpoLazn5sXsbMxD6btdO75cfEz8Lohet+BYmd7ZhJypG/mhRtp2rJ9h/PV" +
        "5rqkStICY0bX6rqd/HXrkzKnydwSNftKRsrKf2JOE8Liq1E9xElF7ZcYafKANBlhKiz8rs77q5KjUEsU+H1OU2B+e0ZDPW3GLF3+" +
        "089hO5vvftinL+5zeZ23rZq01DlPz3FkoEp8zMT8SO8JJ00SwwN74+ePkSb7HPspiJNCmrwsTdfdcJOuqKio9z7N6NQvv/wS9LvD" +
        "h4/o1u0ykaYatb51xBi9v6gkbGdjRiaenbtAZ55zblRemrRs6whF4Orjy3Pf0A2btY76XqTJX+s0IU32RcJvQZxU2PORkaYUlyY3" +
        "9hv4U15ergcOqj1Hx88jTYFp3a6jfuWfi0Ku4VMV87f1H23Us+bM1XdMvlvffOsoZ47SuIl36hmzntF56z7QR479b4K5EbExEyY5" +
        "I1qxHAPSlJy2RprsX7wJ4tRAWJAmlwrpBWkqKi7WI0aNDfn5kKba4vLc8wt0Ucnhenfs5qKcPXO2bt46o06sIU1IEzKBUDHipJAm" +
        "2wbpd2kyyw2Yb9fx7bnY2/3Mhk2db8+ZyeLvrf9I/7i/KGxndrisQm/e9pV+4a9/1zfdfFu9H6IcTprMiNWugr1WUvj9PtfnNK19" +
        "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" +
        "AAZgQImvAdIkoBEINYABGIABGIABJb4GSJOARiDUAAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImv" +
        "AdIkoBEINYABGIABGIABJb4GSJOARiDUAAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEI" +
        "NYABGIABGIABJb4GSJOARiDUAAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIAB" +
        "GIABJb4GSJOARiDUAAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIABGIABJb4G" +
        "SJOARiDUAAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIABGIABJb4GSJOARiDU" +
        "AAZgAAZgAAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIABGIABJb4GSJOARiDUAAZgAAZg" +
        "AAaU+BogTQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIABGIABJb4GSJOARiDUAAZgAAZgAAaU+Bog" +
        "TQIagVADGIABGIABGFDia4A0CWgEQg1gAAZgAAZgQImvAdIkoBEINYABGIABGIABJb4GSJOARiDUAAZgAAZgAAaU+BogTQIagVAD" +
        "GIABGIABGFCpLU3pmV2dFxBqAAMwAAMwAAMw4HcG0jt0CS9NhBrAAAzAAAzAAAzAwMCQNUCaODk4OWAABmAABmAABvpFrwHSxInC" +
        "iQIDMAADMAADMNAveg3+H2iLGc3dB3qiAAAAAElFTkSuQmCC";
}
