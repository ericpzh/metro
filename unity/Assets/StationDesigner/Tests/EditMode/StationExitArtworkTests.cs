using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
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

/// <summary>
/// Plan 16 §5.3 — the street's dynamic exit identity.
///
/// The promoted `ExitUncovered2`/`ExitCovered*`/`ExitDoorway*` prefabs bake their printed
/// fascia from the empty review export, and `Guidepost.prefab` bakes its station/rear/exit
/// plates the same way (the placeholder text the plan reports). This fixture proves, on
/// the real Zoo document and the real promoted prefabs:
///
///  * the exact plate nodes are found and **only** they are retired — the canopy, frame,
///    glass, railing, posts, pictogram and logo collar stay the prefab's own;
///  * a replaceable plate is mounted at the same node transform with the same mesh;
///  * the committed identity reaches the painter: station/nameEn/city, `exit.cfg.name`,
///    the line facts and the locale;
///  * the C# content key equals the key the TypeScript painter recorded (a rename or a
///    locale switch is a different key, and the reply paints the correspondingly
///    different pixels);
///  * `exit-uncovered-2-258 → C → guidepost-399` and
///    `exit-uncovered-2-398 → B → guidepost-400` are asserted from the committed document;
///  * a prefab with no identifiable plate is left alone and named, never given a floating
///    plate at a guessed transform.
///
/// The pixels are the **shipping painter's own PNGs**, recorded by
/// `tools/unity-parity/record-station-exit-faces.mjs` (headless Chrome running
/// `exitFaceProvider.ts`). A passing bind alone would not be evidence: the applied
/// texture is compared pixel for pixel with the recorded file.
/// </summary>
public class StationExitArtworkTests {
    const string OraclePath = "StationDesigner/Tests/EditMode/station-exit-faces-oracle.json";
    const string ZooPath = "Assets/StationDesigner/Demos/zoo.metro.json";

    static JObject oracle;
    static StationDocument zoo;
    static RuntimeCatalogue catalogue;
    static Shader shader;

    // Re-read the fixture on every access: the asset can be regenerated while the Editor
    // domain stays alive, and a cached static would pin the old plate identities.
    static JObject Oracle => JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, OraclePath)));
    static JArray Rows => (JArray)Oracle["rows"];

    readonly List<GameObject> hosts = new List<GameObject>();
    readonly List<StationWorldView> worlds = new List<StationWorldView>();
    readonly List<JObject> requests = new List<JObject>();

    [OneTimeSetUp]
    public void LoadFixtures() {
        catalogue = AssetDatabase.LoadAssetAtPath<RuntimeCatalogue>(RuntimeCatalogue.AssetPath);
        Assert.IsNotNull(catalogue, "runtime catalogue asset missing; run the catalogue generator first");
        var read = StationDocumentReader.ReadFile(ZooPath);
        Assert.IsNotNull(read, "Zoo fixture missing: " + ZooPath);
        zoo = read.Document;
        shader = StationFinishLibrary.FindShader();
        if (!shader) shader = Shader.Find("Universal Render Pipeline/Lit");
        if (!shader) shader = Shader.Find("Standard");
        Assert.IsNotNull(shader, "no shader for the exit-prefab probe");
        Assert.Greater(Rows.Count, 8, "the exit-face oracle is missing rows");
    }

    [SetUp]
    public void Reset() {
        StationExitArtwork.SendHook = null;
        StationExitArtwork.Locale = "zh-CN";
        requests.Clear();
    }

    [TearDown]
    public void Release() {
        StationExitArtwork.SendHook = null;
        StationExitArtwork.Locale = "zh-CN";
        for (int i = 0; i < worlds.Count; i++) worlds[i]?.Dispose();
        worlds.Clear();
        for (int i = 0; i < hosts.Count; i++) if (hosts[i]) UnityEngine.Object.DestroyImmediate(hosts[i]);
        hosts.Clear();
        requests.Clear();
        Assert.IsTrue(StationExitArtwork.Scope == null, "no world scope may outlive the test");
    }

    /* ---------------------------------------------------------------- fixture */

    StationStreetModuleRenderer Build(StationDocument document) {
        var street = new StationStreetModuleRenderer();
        hosts.Add(new GameObject("exit artwork host " + hosts.Count));
        var world = new StationWorldView(hosts[hosts.Count - 1].transform, "exit artwork " + worlds.Count,
            new IStationViewRenderer[] { street }, new StationViewAssets { Catalogue = catalogue, Shader = shader });
        world.Build(document, new StationIndex(document));
        worlds.Add(world);
        return street;
    }

    static ModuleFacts Module(StationDocument document, string id) =>
        document.Modules.Select(record => record.Facts).First(facts => facts != null && facts.Id == id);

    static StationDocument RenameExit(StationDocument document, string exitId, string name) {
        var save = JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "StationDesigner/Demos/zoo.metro.json")));
        var module = ((JArray)save["static"]["modules"]).First(value => (string)value["id"] == exitId);
        ((JObject)module["cfg"])["name"] = name;
        var read = StationDocumentReader.Read(save.ToString(Formatting.None), new StationSource("exit rename probe", ""));
        Assert.IsNotNull(read?.Document, "the renamed save must parse");
        return read.Document;
    }

    static JObject RowFor(JObject face) {
        foreach (var token in Rows) {
            var row = (JObject)token;
            var facts = (JObject)row["facts"];
            if (!Same(face, facts, "painter")) continue;
            if (!Same(face, facts, "moduleId")) continue;
            if (!Same(face, facts, "station")) continue;
            if (!Same(face, facts, "stationEn")) continue;
            if (!Same(face, facts, "city")) continue;
            if (!Same(face, facts, "exitName")) continue;
            if (!Same(face, facts, "exitId")) continue;
            if (!Same(face, facts, "locale")) continue;
            if ((int?)face["pixels"] != (int?)facts["pixels"]) continue;
            if ((int?)face["pixelsHigh"] != (int?)facts["pixelsHigh"]) continue;
            float faceWidth = (float?)face["width"] ?? 0f, rowWidth = (float?)facts["width"] ?? 0f;
            if (Math.Abs(faceWidth - rowWidth) > 2e-3f) continue;
            float faceHeight = (float?)face["height"] ?? 0f, rowHeight = (float?)facts["height"] ?? 0f;
            if (Math.Abs(faceHeight - rowHeight) > 2e-3f) continue;
            return row;
        }
        return null;
    }

    static bool Same(JObject left, JObject right, string name) =>
        string.Equals((string)left[name] ?? "", (string)right[name] ?? "", StringComparison.Ordinal);

    /* -------------------------------------------------------------- replies */

    void Serve(JObject request, bool requireRows = true) {
        var payload = (JObject)request["payload"];
        var requestId = (string)request["id"];
        var revision = (int?)request["revision"] ?? -1;
        var sessionId = (string)request["sessionId"] ?? "";
        var painted = new JArray();
        foreach (var token in (JArray)payload["faces"]) {
            var face = (JObject)token;
            var row = RowFor(face);
            if (row == null) {
                if (requireRows) Assert.Fail("no recorded plate for " + face.ToString(Formatting.None));
                continue;
            }
            Assert.AreEqual((string)row["key"], (string)face["key"],
                (string)row["id"] + ": the C# content key must equal the painter's recorded key");
            var png = Convert.FromBase64String((string)row["pngBase64"]);
            var base64 = Convert.ToBase64String(png);
            const int chunkSize = 6000;
            int count = Math.Max(1, (base64.Length + chunkSize - 1) / chunkSize);
            for (int index = 0; index < count; index++) {
                var slice = base64.Substring(index * chunkSize, Math.Min(chunkSize, base64.Length - index * chunkSize));
                Send(new JObject {
                    ["schemaVersion"] = 2,
                    ["kind"] = "exit.faceChunk",
                    ["id"] = requestId + "-chunk-" + index,
                    ["sessionId"] = sessionId,
                    ["revision"] = revision,
                    ["type"] = "exit.faceChunk",
                    ["payload"] = new JObject {
                        ["requestId"] = requestId,
                        ["revision"] = revision,
                        ["sessionId"] = sessionId,
                        ["key"] = (string)row["key"],
                        ["moduleId"] = (string)face["moduleId"],
                        ["painter"] = (string)face["painter"],
                        ["width"] = (int)row["width"],
                        ["height"] = (int)row["height"],
                        ["locale"] = (string)row["locale"],
                        ["index"] = index,
                        ["count"] = count,
                        ["data"] = slice,
                    },
                });
            }
            painted.Add(new JObject {
                ["key"] = (string)row["key"],
                ["moduleId"] = (string)face["moduleId"],
                ["painter"] = (string)face["painter"],
                ["width"] = (int)row["width"],
                ["height"] = (int)row["height"],
                ["ink"] = (float)row["ink"],
                ["locale"] = (string)row["locale"],
                ["bytes"] = png.Length,
                ["chunks"] = count,
            });
        }
        Send(new JObject {
            ["schemaVersion"] = 2,
            ["kind"] = "exit.faceReady",
            ["id"] = requestId + "-ready",
            ["sessionId"] = sessionId,
            ["revision"] = revision,
            ["type"] = "exit.faceReady",
            ["payload"] = new JObject {
                ["requestId"] = requestId,
                ["revision"] = revision,
                ["sessionId"] = sessionId,
                ["artReady"] = true,
                ["painted"] = painted,
                ["pending"] = new JArray(),
            },
        });
        StationExitArtwork.Pump();
    }

    static void Send(JObject message) {
        Assert.IsTrue(StationExitArtwork.Receive(message.ToString(Formatting.None)),
            "the exit painter must accept the reply: " + message.ToString(Formatting.None));
    }

    IEnumerable<JObject> Faces() {
        foreach (var request in requests) {
            foreach (var token in (JArray)((JObject)request["payload"])["faces"]) yield return (JObject)token;
        }
    }

    static ExitFaceBinding Binding(StationExitArtworkScope scope, string moduleId, ExitFacePainter painter) =>
        scope.Bindings.FirstOrDefault(binding => binding.ModuleId == moduleId && binding.Painter == painter);

    /// <summary>The third (rear) triangular face's narrower square plate (`min(0.18, edge·.7)`).</summary>
    static ExitFaceBinding RearLetter(StationExitArtworkScope scope, string moduleId) =>
        scope.Bindings.FirstOrDefault(binding => binding.ModuleId == moduleId &&
            binding.Painter == ExitFacePainter.GuideExitLetter && binding.Facts != null && binding.Facts.Width < 0.15f);

    static byte[] Pixels(Texture2D texture) {
        Assert.IsNotNull(texture, "the plate must carry pixels");
        var pixels = texture.GetPixels32();
        var bytes = new byte[pixels.Length * 4];
        for (int i = 0; i < pixels.Length; i++) {
            bytes[i * 4] = pixels[i].r;
            bytes[i * 4 + 1] = pixels[i].g;
            bytes[i * 4 + 2] = pixels[i].b;
            bytes[i * 4 + 3] = pixels[i].a;
        }
        return bytes;
    }

    static byte[] RowPixels(JObject row) {
        var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
        try {
            Assert.IsTrue(texture.LoadImage(Convert.FromBase64String((string)row["pngBase64"])), "the recorded PNG must decode");
            return Pixels(texture);
        } finally {
            UnityEngine.Object.DestroyImmediate(texture);
        }
    }

    static void AssertPlateIsTheRecordedPrint(ExitFaceBinding binding, JObject row) {
        Assert.IsNotNull(binding, "the plate must be bound");
        Assert.IsTrue(binding.HasTexture, (string)row["id"] + ": the plate must carry the painter's pixels");
        Assert.AreEqual((int)row["width"], binding.Texture.width, (string)row["id"] + " texture width");
        Assert.AreEqual((int)row["height"], binding.Texture.height, (string)row["id"] + " texture height");
        var expected = RowPixels(row);
        var actual = Pixels(binding.Texture);
        Assert.AreEqual(expected.Length, actual.Length, (string)row["id"] + " pixel count");
        for (int i = 0; i < expected.Length; i++) {
            if (expected[i] == actual[i]) continue;
            Assert.Fail((string)row["id"] + ": pixel " + (i / 4) + " channel " + (i % 4) +
                " is " + actual[i] + " but the painter recorded " + expected[i]);
        }
    }

    /* -------------------------------------------------------------- identity */

    [Test]
    public void ZooExitsAndGuidepostsResolveTheDocumentedIdentity() {
        var facts = zoo.Modules.Select(record => record.Facts).ToArray();
        var guidepostC = Module(zoo, "guidepost-399");
        var guidepostB = Module(zoo, "guidepost-400");
        var exitC = StationExitArtwork.ResolveGuideExit(facts, guidepostC);
        var exitB = StationExitArtwork.ResolveGuideExit(facts, guidepostB);
        Assert.IsNotNull(exitC, "guidepost-399 links to a saved exit");
        Assert.IsNotNull(exitB, "guidepost-400 links to a saved exit");
        Assert.AreEqual("exit-uncovered-2-258", exitC.Id, "guidepost-399 → exit 258");
        Assert.AreEqual("exit-uncovered-2-398", exitB.Id, "guidepost-400 → exit 398");
        Assert.AreEqual("C", StationExitArtwork.ExitLabel(exitC), "exit 258 prints C");
        Assert.AreEqual("B", StationExitArtwork.ExitLabel(exitB), "exit 398 prints B");
        // The mapping is the document's, not a positional guess: the suffix rule is the
        // source's own, and an empty name stays empty for the painter's fallback.
        Assert.AreEqual("C", StationExitArtwork.StripExitSuffix("C口"), "a saved 口 suffix is stripped like guideLabels");
        Assert.AreEqual("", StationExitArtwork.StripExitSuffix(""), "an empty name stays empty (the painter's fallback)");
    }

    /* -------------------------------------------------------------- the build */

    [Test]
    public void StreetRendererBindsExplicitReplaceableFacesAndPaintsThem() {
        StationExitArtwork.SendHook = json => requests.Add(JObject.Parse(json));
        var street = Build(zoo);
        var scope = street.Current.Faces;
        Assert.IsNotNull(scope, "the street renderer must create one artwork scope for the world");
        Assert.IsNotNull(scope.Cache, "the scope must carry a texture cache");

        var faceNotes = worlds[0].Unresolved.Where(note => note.Code.StartsWith("exit-face", StringComparison.Ordinal)).ToArray();
        Assert.AreEqual(0, faceNotes.Length, "every plate must be identifiable: " +
            string.Join("; ", faceNotes.Select(note => note.Code + " " + note.RecordId + " " + note.Message)));

        // The plates each prefab actually carries, by the export's material/node identity.
        Assert.AreEqual(2, StationExitArtwork.Count(scope, ExitFacePainter.ExitHeader), "two head-houses, one fascia each");
        Assert.AreEqual(4, StationExitArtwork.Count(scope, ExitFacePainter.GuideStationUpper), "two guideposts, two upper station plates each");
        Assert.AreEqual(2, StationExitArtwork.Count(scope, ExitFacePainter.GuideStationRear), "two guideposts, one tall rear plate each");
        Assert.AreEqual(6, StationExitArtwork.Count(scope, ExitFacePainter.GuideExitLetter), "two guideposts, three square letter plates each");

        // Each replaceable node is a faithful copy of the baked plate's transform and mesh.
        foreach (var binding in scope.Bindings) {
            Assert.IsNotNull(binding.Baked, binding.ModuleId + ": no baked plate recorded");
            Assert.IsFalse(binding.Baked.enabled, binding.ModuleId + ": only the baked plate is retired");
            Assert.IsNotNull(binding.Quad, binding.ModuleId + ": no replaceable plate mounted");
            Assert.IsTrue(binding.Quad.activeSelf, binding.ModuleId + ": the mounted plate must be live");
            Assert.AreEqual(binding.Baked.transform.parent, binding.Quad.transform.parent, binding.ModuleId + ": same parent");
            Assert.AreEqual(binding.Baked.transform.localPosition, binding.Quad.transform.localPosition, binding.ModuleId + ": same local position");
            Assert.AreEqual(binding.Baked.transform.localRotation, binding.Quad.transform.localRotation, binding.ModuleId + ": same local rotation");
            Assert.AreEqual(binding.Baked.transform.localScale, binding.Quad.transform.localScale, binding.ModuleId + ": same local scale");
            Assert.AreNotSame(binding.Baked.GetComponent<MeshFilter>().sharedMesh,
                binding.Quad.GetComponent<MeshFilter>().sharedMesh,
                binding.ModuleId + ": the runtime plate owns an upright mesh, not the baked atlas mesh");
            AssertPlateIsUpright(binding);
            Assert.AreEqual("exit face " + ExitFaceVocabulary.Painter(binding.Painter) + " " + binding.ModuleId,
                binding.Quad.name, "the node is addressable by family and module");
        }
        Assert.AreEqual(3, StationExitArtwork.GuidePlateMetadata.Count,
            "the guidepost's writable surfaces are explicit metadata, not name guesses");
        StringAssert.Contains("guide-station-face|guidePlate_256x277|guideStationUpper",
            StationExitArtwork.GuidePlateMetadata[0]);

        // Only the plate renderers are retired; the rest of the prefab is untouched.
        int retired = 0;
        foreach (var built in street.Current.Modules.Where(module => module.Type == "exit" || module.Type == "guidepost")) {
            foreach (var renderer in built.View.GetComponentsInChildren<MeshRenderer>(true)) {
                var material = renderer.sharedMaterial;
                bool plate = material != null &&
                    (material.name.IndexOf("exitHeaderPlate", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     material.name.StartsWith("guidePlate_256x277", StringComparison.Ordinal) ||
                     material.name.StartsWith("guidePlate_256x993", StringComparison.Ordinal) ||
                     material.name.StartsWith("guidePlate_256x256_2", StringComparison.Ordinal));
                bool concrete = material != null && material.name.IndexOf("concrete", StringComparison.OrdinalIgnoreCase) >= 0;
                if (!plate) {
                    if (!concrete) Assert.IsTrue(renderer.enabled, built.ModuleId + ": non-face part " + renderer.name + " must stay enabled");
                    continue;
                }
                retired++;
                Assert.IsFalse(renderer.enabled, built.ModuleId + ": the baked plate " + renderer.name + " must be retired");
            }
        }
        Assert.AreEqual(14, retired, "two fascias + two guideposts × (2 upper + 1 rear + 3 letter) baked plates retired");

        // The committed identity reached the painter.
        var headerC = Faces().First(face => (string)face["moduleId"] == "exit-uncovered-2-258" && (string)face["painter"] == "exitHeader");
        Assert.AreEqual("C", (string)headerC["exitName"], "exit 258 submits its saved cfg.name");
        Assert.AreEqual("动物园", (string)headerC["station"], "the committed station name is submitted");
        Assert.AreEqual("Zoo", (string)headerC["stationEn"], "the committed English name is submitted");
        Assert.AreEqual("guangzhou", (string)headerC["city"], "the committed city is submitted");
        Assert.AreEqual("zh-CN", (string)headerC["locale"], "the print locale is submitted");
        var line = (JObject)((JArray)headerC["lines"])[0];
        Assert.AreEqual("5", (string)line["id"], "the station's line id is submitted");
        Assert.AreEqual("#c70541", (string)line["colour"], "the live line colour is submitted");

        var letterC = Faces().First(face => (string)face["moduleId"] == "guidepost-399" && (string)face["painter"] == "guideExitLetter");
        Assert.AreEqual("C", (string)letterC["exitName"], "guidepost 399 submits its linked exit's name");
        Assert.AreEqual("exit-uncovered-2-258", (string)letterC["exitId"], "guidepost 399 submits its cfg.exitId");
        Assert.AreEqual(256, (int)letterC["pixels"], "the square plate keeps the export's canvas width");
        Assert.AreEqual(256, (int)letterC["pixelsHigh"], "the square plate keeps the export's canvas height");
        var letterB = Faces().First(face => (string)face["moduleId"] == "guidepost-400" && (string)face["painter"] == "guideExitLetter");
        Assert.AreEqual("B", (string)letterB["exitName"], "guidepost 400 prints B");
        Assert.AreEqual("exit-uncovered-2-398", (string)letterB["exitId"], "guidepost 400 → exit 398");

        // Answer every request with the recorded painter PNGs.
        int served = 0;
        foreach (var request in requests.ToArray()) {
            if (!((JObject)request["payload"])["faces"].Any()) continue;
            Serve(request);
            served++;
        }
        Assert.AreEqual(requests.Count, served, "one reply per request");
        Assert.AreEqual(14, scope.Cache.ServedCount, "every replaceable plate shows painted pixels");
        Assert.Greater(scope.Cache.MinInk, 0.05f, "the painted plates carry ink, not a blank sheet");

        // Identity: 258 prints C, 399 prints it too; 398 prints B, 400 prints it too.
        AssertPlateIsTheRecordedPrint(Binding(scope, "exit-uncovered-2-258", ExitFacePainter.ExitHeader),
            Row("zoo-exit-258-header-c"));
        AssertPlateIsTheRecordedPrint(Binding(scope, "exit-uncovered-2-398", ExitFacePainter.ExitHeader),
            Row("zoo-exit-398-header-b"));
        AssertPlateIsTheRecordedPrint(Binding(scope, "guidepost-399", ExitFacePainter.GuideExitLetter),
            Row("zoo-guidepost-399-exit-letter"));
        AssertPlateIsTheRecordedPrint(Binding(scope, "guidepost-400", ExitFacePainter.GuideExitLetter),
            Row("zoo-guidepost-400-exit-letter"));
        AssertPlateIsTheRecordedPrint(Binding(scope, "guidepost-399", ExitFacePainter.GuideStationUpper),
            Row("zoo-guidepost-399-station-upper"));
        AssertPlateIsTheRecordedPrint(Binding(scope, "guidepost-399", ExitFacePainter.GuideStationRear),
            Row("zoo-guidepost-399-station-rear"));
        // The third triangular face's square plate is narrower (0.0975 m, not 0.18 m) and is
        // its own content identity even though it prints the same canvas.
        AssertPlateIsTheRecordedPrint(RearLetter(scope, "guidepost-399"), Row("zoo-guidepost-399-exit-letter-rear"));
        AssertPlateIsTheRecordedPrint(RearLetter(scope, "guidepost-400"), Row("zoo-guidepost-400-exit-letter-rear"));
        Assert.AreNotEqual(Binding(scope, "guidepost-399", ExitFacePainter.GuideExitLetter).Key,
            RearLetter(scope, "guidepost-399").Key, "the narrower plate is not the wide plate's key");
        Assert.AreNotEqual(
            Convert.ToBase64String(Pixels(Binding(scope, "guidepost-399", ExitFacePainter.GuideExitLetter).Texture)),
            Convert.ToBase64String(Pixels(Binding(scope, "guidepost-400", ExitFacePainter.GuideExitLetter).Texture)),
            "C and B are different plates");

        // The observable half a browser check consumes: `state.exit.faces`.
        var state = StationExitArtwork.State.BuildPayload(zoo, new StationIndex(zoo));
        var faces = (JObject)state["faces"];
        Assert.AreEqual(14, (int)faces["bound"], "every replaceable plate in the state report");
        Assert.AreEqual(14, (int)faces["served"], "every plate shows painted pixels");
        Assert.AreEqual(0, (int)faces["pending"], "nothing is left waiting");
        Assert.Greater((float)faces["minInk"], 0.05f, "the reported ink is the painter's, not a blank sheet");
        var reportedExit = ((JArray)faces["faces"]).First(face => (string)face["moduleId"] == "exit-uncovered-2-258" &&
            (string)face["painter"] == "exitHeader");
        Assert.IsTrue((bool)reportedExit["served"], "the fascia is reported served");
        Assert.AreEqual("zh-CN", (string)reportedExit["locale"], "the report names the print locale");
        var reportedPlate = (JArray)reportedExit["plate"];
        Assert.AreEqual(3.7f, (float)reportedPlate[0], 0.001f, "the fascia's metre width is reported");
        Assert.AreEqual(0.5f, (float)reportedPlate[1], 0.001f, "the fascia's metre height is reported");
    }

    /// <summary>
    /// The runtime plate's UVs put the image's top at the physical top edge, exactly
    /// once, and keep the export's own left/right. A four-corner labelled PNG would
    /// land its top two corners on the plate's upper pair and its right two on the
    /// export's own right edge; this proves the corner mapping without a GPU.
    /// </summary>
    static void AssertPlateIsUpright(ExitFaceBinding binding) {
        var baked = binding.Baked.GetComponent<MeshFilter>().sharedMesh;
        var runtime = binding.Quad.GetComponent<MeshFilter>().sharedMesh;
        Assert.IsNotNull(runtime, binding.ModuleId + ": the runtime plate has a mesh");
        Assert.AreEqual(baked.vertexCount, runtime.vertexCount, binding.ModuleId + ": same plate geometry");
        Assert.IsNotNull(binding.RuntimeMesh, binding.ModuleId + ": the upright mesh is owned by the binding");
        Assert.IsTrue(binding.UprightV, binding.ModuleId + ": " + binding.UvBasis);
        StringAssert.Contains("physical-up", binding.UvBasis);
        var vertices = runtime.vertices;
        var uv = runtime.uv;
        var bakedUv = baked.uv;
        var normal = Vector3.zero;
        foreach (var value in runtime.normals) normal += value;
        if (normal.sqrMagnitude < 1e-8f) normal = Vector3.forward;
        normal.Normalize();
        var up = binding.Quad.transform.InverseTransformDirection(Vector3.up);
        up -= normal * Vector3.Dot(up, normal);
        Assert.Greater(up.sqrMagnitude, 1e-6f, binding.ModuleId + ": the plate has a physical up");
        up.Normalize();
        int top = 0, bottom = 0;
        for (int i = 1; i < vertices.Length; i++) {
            if (Vector3.Dot(vertices[i], up) > Vector3.Dot(vertices[top], up)) top = i;
            if (Vector3.Dot(vertices[i], up) < Vector3.Dot(vertices[bottom], up)) bottom = i;
        }
        Assert.Greater(uv[top].y, .5f, binding.ModuleId + ": the image's top is at the physical top");
        Assert.Less(uv[bottom].y, .5f, binding.ModuleId + ": the image's bottom is at the physical bottom");
        // U is the export's own: the baked and runtime U agree vertex for vertex.
        for (int i = 0; i < uv.Length; i++)
            Assert.AreEqual(bakedUv[i].x, uv[i].x, 1e-5f, binding.ModuleId + ": U keeps the export's own left/right");
        // The two UV maxima are different corners: the image is not rotated by the fix.
        int maxU = 0, maxV = 0;
        for (int i = 1; i < uv.Length; i++) {
            if (uv[i].x > uv[maxU].x) maxU = i;
            if (uv[i].y > uv[maxV].y) maxV = i;
        }
        Assert.AreNotEqual(maxU, maxV, binding.ModuleId + ": the image's top-right is one corner, not a diagonal");
    }

    static JObject Row(string id) {
        foreach (var token in Rows) {
            if (string.Equals((string)token["id"], id, StringComparison.Ordinal)) return (JObject)token;
        }
        Assert.Fail("the exit-face oracle has no row '" + id + "'; it has " +
            string.Join(", ", Rows.Select(token => (string)token["id"])) +
            ". Re-run tools/unity-parity/record-station-exit-faces.mjs");
        return null;
    }

    /* --------------------------------------------------------------- rename */

    [Test]
    public void RenamingAnExitReprintsItsFasciaAndItsGuidepostLetter() {
        StationExitArtwork.SendHook = json => requests.Add(JObject.Parse(json));
        var street = Build(zoo);
        var first = street.Current.Faces;
        ServeAll();
        var cKey = Binding(first, "exit-uncovered-2-258", ExitFacePainter.ExitHeader).Key;
        var cLetter = Binding(first, "guidepost-399", ExitFacePainter.GuideExitLetter).Key;
        var cRearLetter = RearLetter(first, "guidepost-399").Key;

        // A committed save edit (the same load path `station.open` uses), then the staged
        // candidate world the host builds before disposing the outgoing one.
        var renamed = RenameExit(zoo, "exit-uncovered-2-258", "D");
        requests.Clear();
        street = Build(renamed);
        var second = street.Current.Faces;
        Assert.IsNotNull(second, "the staged world bound no street plates");
        Assert.IsTrue(first != second, "a committed edit builds a new world scope");

        var headerD = Faces().First(face => (string)face["moduleId"] == "exit-uncovered-2-258" && (string)face["painter"] == "exitHeader");
        Assert.AreEqual("D", (string)headerD["exitName"], "the renamed exit is what the painter receives");
        var letterD = Faces().First(face => (string)face["moduleId"] == "guidepost-399" && (string)face["painter"] == "guideExitLetter");
        Assert.AreEqual("D", (string)letterD["exitName"], "the linked guidepost follows the rename");
        Assert.AreNotEqual(cKey, (string)headerD["key"], "the exit fascia's content key changes with the name");
        Assert.AreNotEqual(cLetter, (string)letterD["key"], "the guidepost letter's content key changes with the name");
        var rearLetterD = Faces().First(face => (string)face["moduleId"] == "guidepost-399" &&
            (string)face["painter"] == "guideExitLetter" && ((float?)face["width"] ?? 1f) < 0.15f);
        Assert.AreNotEqual(cRearLetter, (string)rearLetterD["key"], "the narrow rear letter's key changes too");
        Assert.AreEqual((string)Row("rename-exit-258-header-d")["key"], (string)headerD["key"],
            "the renamed fascia is the painter's recorded D plate");
        Assert.AreEqual((string)Row("rename-guidepost-399-exit-letter-d")["key"], (string)letterD["key"],
            "the renamed guidepost letter is the painter's recorded D plate");

        ServeAll();
        AssertPlateIsTheRecordedPrint(Binding(second, "exit-uncovered-2-258", ExitFacePainter.ExitHeader),
            Row("rename-exit-258-header-d"));
        AssertPlateIsTheRecordedPrint(Binding(second, "guidepost-399", ExitFacePainter.GuideExitLetter),
            Row("rename-guidepost-399-exit-letter-d"));
        AssertPlateIsTheRecordedPrint(RearLetter(second, "guidepost-399"),
            Row("rename-guidepost-399-exit-letter-rear-d"));
        // The untouched exit is still B.
        AssertPlateIsTheRecordedPrint(Binding(second, "exit-uncovered-2-398", ExitFacePainter.ExitHeader),
            Row("zoo-exit-398-header-b"));

        // Disposing the candidate frees only its own pixels; the committed world's plate is
        // the same record it always was.
        var firstTexture = Binding(first, "exit-uncovered-2-258", ExitFacePainter.ExitHeader).Texture;
        worlds[worlds.Count - 1].Dispose();
        worlds.RemoveAt(worlds.Count - 1);
        Assert.IsTrue(firstTexture != null, "the outgoing world keeps its own pixels while it is still staged");
        Assert.IsNull(Binding(second, "exit-uncovered-2-258", ExitFacePainter.ExitHeader)?.Texture,
            "the candidate's plate was released with its world");
    }

    void ServeAll(bool requireRows = true) {
        foreach (var request in requests.ToArray()) {
            if (!((JObject)request["payload"])["faces"].Any()) continue;
            Serve(request, requireRows);
        }
        requests.Clear();
    }

    /* --------------------------------------------------------------- locale */

    [Test]
    public void LocaleSwitchReprintsTheStreetPlates() {
        StationExitArtwork.SendHook = json => requests.Add(JObject.Parse(json));
        var street = Build(zoo);
        var scope = street.Current.Faces;
        ServeAll();
        var header = Binding(scope, "exit-uncovered-2-258", ExitFacePainter.ExitHeader);
        var letter = Binding(scope, "guidepost-399", ExitFacePainter.GuideExitLetter);
        var rearLetter = RearLetter(scope, "guidepost-399");
        var headerKey = header.Key;
        var letterKey = letter.Key;
        var rearLetterKey = rearLetter.Key;
        var headerTexture = header.Texture;
        var letterTexture = letter.Texture;
        var requestsBefore = scope.Cache.RequestCount;
        var repaintsBefore = scope.Cache.RepaintCount;

        // The shell's `exit.locale` notice, through the packet's own command handler.
        var handler = new StationExitArtworkCommandHandler();
        Assert.IsTrue(handler.Handles("exit.locale"), "the packet owns the locale notice");
        var command = new StationCommand { Type = "exit.locale", Raw = "{\"type\":\"exit.locale\",\"payload\":{\"locale\":\"en\"}}" };
        Assert.IsTrue(handler.TryHandle(command, JObject.Parse("{\"locale\":\"en\"}"), out var rejectCode, out var rejectReason),
            "exit.locale must be accepted: " + rejectCode + " " + rejectReason);
        Assert.AreEqual("en", StationExitArtwork.Locale, "the packet adopted the shell locale");
        Assert.Greater(scope.Cache.RepaintCount, repaintsBefore, "a locale switch reprints the street plates");
        Assert.Greater(scope.Cache.RequestCount, requestsBefore, "a locale switch re-asks the painter");

        var enHeader = Faces().First(face => (string)face["moduleId"] == "exit-uncovered-2-258" && (string)face["painter"] == "exitHeader");
        var enLetter = Faces().First(face => (string)face["moduleId"] == "guidepost-399" && (string)face["painter"] == "guideExitLetter" && ((float?)face["width"] ?? 1f) >= 0.15f);
        var enRearLetter = Faces().First(face => (string)face["moduleId"] == "guidepost-399" && (string)face["painter"] == "guideExitLetter" && ((float?)face["width"] ?? 1f) < 0.15f);
        Assert.AreEqual("en", (string)enHeader["locale"], "the en locale reaches the fascia request");
        Assert.AreEqual("en", (string)enLetter["locale"], "the en locale reaches the guidepost request");
        Assert.AreEqual("en", (string)enRearLetter["locale"], "the en locale reaches the rear letter request");
        Assert.AreNotEqual(headerKey, (string)enHeader["key"], "locale is part of the fascia's identity");
        Assert.AreNotEqual(letterKey, (string)enLetter["key"], "locale is part of the letter's identity");
        Assert.AreNotEqual(rearLetterKey, (string)enRearLetter["key"], "locale is part of the rear letter's identity");

        // The recorded en plates are the ones the painter prints (their *pixels* are the
        // same as zh for Guangzhou: the fascia's copy is bilingual by construction). Only
        // the recorded en plates are answered; the rest stay pending in the cache,
        // which is why a missing row is not a failure here.
        ServeAll(requireRows: false);
        AssertPlateIsTheRecordedPrint(header, Row("locale-en-exit-258-header-c"));
        AssertPlateIsTheRecordedPrint(letter, Row("locale-en-guidepost-399-exit-letter-c"));
        AssertPlateIsTheRecordedPrint(rearLetter, Row("locale-en-guidepost-399-exit-letter-rear-c"));
        Assert.AreNotSame(headerTexture, header.Texture, "the reprint uploads a fresh texture, not the old one");
        Assert.AreNotSame(letterTexture, letter.Texture, "the reprint uploads a fresh texture, not the old one");
        Assert.AreEqual((string)Row("locale-en-exit-258-header-c")["sha256"], (string)Row("zoo-exit-258-header-c")["sha256"],
            "the Guangzhou fascia's ink is locale-neutral by the source's own construction");
        Assert.AreEqual((string)Row("locale-en-guidepost-399-exit-letter-c")["sha256"], (string)Row("zoo-guidepost-399-exit-letter")["sha256"],
            "the exit letter is locale-neutral");
    }

    /* --------------------------------------------------------------- missing */

    [Test]
    public void APrefabWithoutAPrintedPlateIsNamedAndLeftAlone() {
        // A stand-in for a promoted prefab that does not name a printable plate: the packet
        // must not guess a transform and must leave the baked face in place.
        var root = new GameObject("exit with no printed plate");
        try {
            var part = new GameObject("blob");
            part.transform.SetParent(root.transform, false);
            var renderer = part.AddComponent<MeshRenderer>();
            var mesh = new Mesh { name = "stand-in plate" };
            mesh.SetVertices(new List<Vector3> {
                new Vector3(-.5f, -.5f, 0f), new Vector3(.5f, -.5f, 0f),
                new Vector3(.5f, .5f, 0f), new Vector3(-.5f, .5f, 0f),
            });
            mesh.SetTriangles(new[] { 0, 1, 2, 0, 2, 3 }, 0);
            mesh.RecalculateBounds();
            part.AddComponent<MeshFilter>().sharedMesh = mesh;
            var material = new Material(shader) { name = "steel" };
            renderer.sharedMaterial = material;
            var module = new ModuleFacts {
                Id = "exit-no-face", Type = "exit", X = 0, Y = 0, Z = 0, Rotation = 0,
                Config = new ModuleConfig(new Dictionary<string, string> { ["name"] = "A" }),
            };
            Assert.AreEqual(0, StationExitArtwork.Discover(root, module).Count, "nothing identifiable to replace");
            var diagnostics = new List<StationExitArtwork.FaceDiagnostic>();
            StationExitArtwork.Bind(zoo, diagnostics.Add, () => null, root, module, zoo.Modules.Select(record => record.Facts).ToArray(), "Assets/Nowhere.prefab");
            Assert.AreEqual(1, diagnostics.Count, "one diagnostic, not a floating plate");
            Assert.AreEqual("exit-face-not-found", diagnostics[0].Code);
            Assert.AreEqual("exit-no-face", diagnostics[0].RecordId);
            StringAssert.Contains("Assets/Nowhere.prefab", diagnostics[0].Message);
            StringAssert.Contains("steel", diagnostics[0].Message, "the message names the materials it found");
            Assert.IsTrue(renderer.enabled, "the baked face is left alone");
            UnityEngine.Object.DestroyImmediate(material);
        } finally {
            UnityEngine.Object.DestroyImmediate(root);
        }
    }

    /* --------------------------------------------------------------- fence */

    [Test]
    public void ADelayedReplyForAnotherSessionOrAnOlderRevisionIsDropped() {
        const int revision = 5;
        var context = new ExitFaceContext { SessionId = "session-2", Revision = revision };
        var sent = new List<JObject>();
        var provider = new ExitFaceWebProvider(json => { sent.Add(JObject.Parse(json)); return true; }, () => context);
        try {
            var facts = new ExitFaceFacts {
                ModuleId = "exit-uncovered-2-258", Painter = ExitFacePainter.ExitHeader,
                Station = "动物园", StationEn = "Zoo", City = "guangzhou", ExitName = "C",
                ExitId = "exit-uncovered-2-258", Locale = "zh-CN",
            };
            provider.Request(new ExitFaceBatch { RequestId = "exit-req-fence-1", Locale = "zh-CN", Faces = new[] { facts } });
            Assert.AreEqual("session-2", (string)sent[0]["sessionId"], "the request carries the live session");
            Assert.AreEqual(revision, (int)sent[0]["revision"], "the request carries the committed revision");

            // A reply from the station the player left is fenced before it reaches the cache.
            Assert.IsTrue(provider.Receive(Reply(sent[0], "session-1", revision).ToString(Formatting.None)));
            Assert.AreEqual(1, provider.FencedReplies, "the old session's reply is dropped");
            Assert.IsFalse(provider.TryTake(out _), "nothing painted");

            // A reply minted for an older revision of this station is dropped too.
            provider.Request(new ExitFaceBatch { RequestId = "exit-req-fence-2", Locale = "zh-CN", Faces = new[] { facts } });
            Assert.IsTrue(provider.Receive(Reply(sent[1], "session-2", revision - 1).ToString(Formatting.None)));
            Assert.AreEqual(2, provider.FencedReplies, "the older revision's reply is dropped");
            Assert.IsFalse(provider.TryTake(out _), "nothing painted");

            // The matching session and revision is accepted (an empty painted set still
            // completes the request, so C# can ask again instead of waiting forever).
            provider.Request(new ExitFaceBatch { RequestId = "exit-req-fence-3", Locale = "zh-CN", Faces = new[] { facts } });
            Assert.IsTrue(provider.Receive(Reply(sent[2], "session-2", revision).ToString(Formatting.None)));
            Assert.AreEqual(2, provider.FencedReplies, "no third fence");
            Assert.IsTrue(provider.TryTake(out var accepted), "the matching reply is delivered");
            Assert.AreEqual("exit-req-fence-3", accepted.RequestId);
        } finally {
            provider.Dispose();
        }
    }

    static JObject Reply(JObject request, string sessionId, int revision) {
        var requestId = (string)request["id"];
        return new JObject {
            ["schemaVersion"] = 2,
            ["kind"] = "exit.faceReady",
            ["type"] = "exit.faceReady",
            ["id"] = requestId + "-ready",
            ["sessionId"] = sessionId,
            ["revision"] = revision,
            ["payload"] = new JObject {
                ["requestId"] = requestId,
                ["revision"] = revision,
                ["sessionId"] = sessionId,
                ["artReady"] = true,
                ["painted"] = new JArray(),
                ["pending"] = new JArray(),
            },
        };
    }
}
