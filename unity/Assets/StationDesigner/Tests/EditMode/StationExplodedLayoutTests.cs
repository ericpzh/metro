using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Plan 19 §2.2 &amp; §5.1 EditMode parity suite for <see cref="StationExplodedLayoutPlan"/>.
/// Pins levels, direction, packedOffsets, per-tray retained cell counts &amp; digests,
/// hideable front-wall counts &amp; digests, retained module &amp; lift-slice ownership,
/// wall-mounted panel midpoint ownership, packed passenger support, and exploded lift poses
/// against <c>station-exploded-view-oracle.json</c> across Zoo, Tanwei, Tianhe, and
/// synthetic edge-case fixtures.
/// </summary>
public class StationExplodedLayoutTests {
    const string OracleRelPath = "StationDesigner/Tests/EditMode/station-exploded-view-oracle.json";

    static JObject oracle;
    static JObject Oracle => oracle ??= JObject.Parse(
        File.ReadAllText(Path.Combine(Application.dataPath, OracleRelPath), Encoding.UTF8));

    static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

    static string Sha256Hex(string text) {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(text));
        var sb = new StringBuilder(bytes.Length * 2);
        for (int i = 0; i < bytes.Length; i++) sb.Append(bytes[i].ToString("x2"));
        return sb.ToString();
    }

    static string DigestCellKeys(IEnumerable<StationCellKey> keys) {
        var sorted = keys
            .OrderBy(k => k.Z)
            .ThenBy(k => k.X)
            .ThenBy(k => k.Y)
            .Select(k => $"{k.X},{k.Y},{k.Z}");
        return Sha256Hex(string.Join("\n", sorted));
    }

    static string DigestStrings(IEnumerable<string> values) =>
        Sha256Hex(string.Join("\n", values.OrderBy(v => v, StringComparer.Ordinal)));

    static StationDocument LoadDemoDocument(JObject row) {
        string relPath = (string)row["path"];
        string fullPath = Path.Combine(RepoRoot, relPath.Replace('/', Path.DirectorySeparatorChar));
        Assert.IsTrue(File.Exists(fullPath), $"Missing demo file: {fullPath}");
        string rawText = File.ReadAllText(fullPath, Encoding.UTF8);
        Assert.AreEqual((string)row["textSha256"], Sha256Hex(rawText), $"Demo {row["id"]} SHA-256 drifted from oracle.");
        return StationDocumentReader.Read(rawText, new StationSource(relPath, "")).Document;
    }

    static StationDocument LoadFixtureDocument(JObject row) {
        string json = (string)row["normalizedJson"];
        return StationDocumentReader.Read(json, new StationSource("fixture:" + row["id"], "")).Document;
    }

    static void AssertMatchesOracleCase(StationDocument doc, JObject expected) {
        string id = (string)expected["id"];
        string beforeJson = doc.NormalizedJson;

        var plan = StationExplodedLayoutPlan.Build(doc);

        // Building an exploded layout plan never mutates the committed document.
        Assert.AreEqual(beforeJson.Length, doc.NormalizedJson.Length, $"{id}: document NormalizedJson length mutated");
        Assert.IsTrue(string.Equals(beforeJson, doc.NormalizedJson, StringComparison.Ordinal), $"{id}: document NormalizedJson mutated");

        var expectedLevels = ((JArray)expected["levels"]).Select(t => (int)t).ToArray();
        CollectionAssert.AreEqual(expectedLevels, plan.Levels, $"{id}: levels mismatch");

        var expectedDir = (JArray)expected["direction"];
        Assert.AreEqual(new Vector2Int((int)expectedDir[0], (int)expectedDir[1]), plan.Direction, $"{id}: direction mismatch");

        var expectedOffsets = ((JArray)expected["packedOffsets"]).Select(t => (int)t).ToArray();
        CollectionAssert.AreEqual(expectedOffsets, plan.PackedOffsets, $"{id}: packedOffsets mismatch");

        Assert.AreEqual((int)expected["totalRetainedCells"], plan.TotalRetainedCells, $"{id}: totalRetainedCells mismatch");
        Assert.AreEqual((int)expected["totalFrontWalls"], plan.TotalFrontWalls, $"{id}: totalFrontWalls mismatch");

        var expectedRetainedModules = ((JArray)expected["retainedSourceModuleIds"]).Select(t => (string)t).ToArray();
        var actualRetainedModules = plan.RetainedSourceModules.Select(m => m.Id).OrderBy(s => s, StringComparer.Ordinal).ToArray();
        CollectionAssert.AreEqual(expectedRetainedModules, actualRetainedModules, $"{id}: retainedSourceModuleIds mismatch");

        var expectedTrays = (JArray)expected["trays"];
        Assert.AreEqual(expectedTrays.Count, plan.Trays.Count, $"{id}: tray count mismatch");

        for (int i = 0; i < expectedTrays.Count; i++) {
            var et = (JObject)expectedTrays[i];
            var tray = plan.Trays[i];
            Assert.AreEqual((int)et["level"], tray.Level, $"{id} tray[{i}]: level mismatch");
            Assert.AreEqual((int)et["packedOffset"], tray.PackedOffset, $"{id} tray[{i}]: packedOffset mismatch");
            Assert.AreEqual((int)et["cellCount"], tray.Cells.Count, $"{id} tray {tray.Level}: cellCount mismatch");
            Assert.AreEqual((string)et["cellDigest"], DigestCellKeys(tray.Cells.Select(c => c.Key)), $"{id} tray {tray.Level}: cellDigest mismatch");
            Assert.AreEqual((int)et["frontWallCount"], tray.FrontWalls.Count, $"{id} tray {tray.Level}: frontWallCount mismatch");
            Assert.AreEqual((string)et["frontWallDigest"], DigestCellKeys(tray.FrontWalls.Select(c => c.Key)), $"{id} tray {tray.Level}: frontWallDigest mismatch");

            var pieceIds = tray.Modules.Select(m => m.Id)
                .Concat(tray.LiftSlices.Select(s => s.Id))
                .OrderBy(s => s, StringComparer.Ordinal)
                .ToArray();
            Assert.AreEqual((int)et["pieceCount"], pieceIds.Length, $"{id} tray {tray.Level}: pieceCount mismatch");
            Assert.AreEqual((string)et["pieceIdsDigest"], DigestStrings(pieceIds), $"{id} tray {tray.Level}: pieceIdsDigest mismatch");
        }

        var expectedWallOwners = (JArray)expected["wallMountedOwners"];
        if (expectedWallOwners != null) {
            foreach (JObject wo in expectedWallOwners) {
                string modId = (string)wo["id"];
                int expectedOwner = (int)wo["ownerLevel"];
                Assert.IsTrue(plan.ModuleOwnerById.TryGetValue(modId, out int actualOwner), $"{id}: missing wall-mounted owner for {modId}");
                Assert.AreEqual(expectedOwner, actualOwner, $"{id}: wall-mounted owner mismatch for {modId}");
            }
        }

        Assert.AreEqual((int)expected["passengerSupportCount"], plan.PassengerSupport.Count, $"{id}: passengerSupportCount mismatch");
        Assert.AreEqual((string)expected["passengerSupportDigest"], DigestCellKeys(plan.PassengerSupport), $"{id}: passengerSupportDigest mismatch");
    }

    [TestCase("zoo")]
    [TestCase("tanwei")]
    [TestCase("tianhe")]
    public void DemoStationsMatchTypeScriptExplodedOracle(string demoId) {
        var demos = (JArray)Oracle["demos"];
        var row = demos.Cast<JObject>().FirstOrDefault(d => (string)d["id"] == demoId);
        Assert.IsNotNull(row, $"Oracle missing demo '{demoId}'");
        var doc = LoadDemoDocument(row);
        AssertMatchesOracleCase(doc, row);
    }

    [TestCase("minimal-two-floor")]
    [TestCase("shifted-level-base")]
    [TestCase("concave-above-ground")]
    [TestCase("multi-stop-vertical")]
    public void SyntheticFixturesMatchTypeScriptExplodedOracle(string fixtureId) {
        var fixtures = (JArray)Oracle["fixtures"];
        var row = fixtures.Cast<JObject>().FirstOrDefault(f => (string)f["id"] == fixtureId);
        Assert.IsNotNull(row, $"Oracle missing fixture '{fixtureId}'");
        var doc = LoadFixtureDocument(row);
        AssertMatchesOracleCase(doc, row);
    }

    [Test]
    public void ExplodedLiftPosesMatchTypeScriptTerminalClampingAndAbsentBit() {
        var samples = (JArray)Oracle["liftPoseSamples"];
        Assert.IsNotNull(samples);
        Assert.Greater(samples.Count, 0);

        foreach (JObject sample in samples) {
            string id = (string)sample["id"];
            var input = ((JArray)sample["input"]).Select(t => (float)t).ToArray();
            var dirArr = (JArray)sample["direction"];
            var direction = new Vector2Int((int)dirArr[0], (int)dirArr[1]);
            var offsetEntries = (JArray)sample["offsets"];
            var levels = offsetEntries.Select(e => (int)e[0]).ToArray();
            var offsets = offsetEntries.Select(e => (int)e[1]).ToArray();
            var expected = ((JArray)sample["output"]).Select(t => (float)t).ToArray();

            var actual = StationExplodedLayoutPlan.ComputeExplodedLiftPoses(input, levels, offsets, direction);
            Assert.AreEqual(expected.Length, actual.Length, $"{id}: output length mismatch");
            for (int i = 0; i < expected.Length; i++) {
                Assert.AreEqual(expected[i], actual[i], 1e-4f, $"{id}[{i}] mismatch");
            }
            Assert.AreEqual((int)sample["absentBit"], StationExplodedLayoutPlan.ExplodedLiftAbsent);
        }
    }
}
