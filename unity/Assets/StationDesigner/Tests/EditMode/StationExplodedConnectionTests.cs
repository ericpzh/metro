using System;
using System.IO;
using System.Linq;
using System.Text;
using Metro.Build;
using Metro.Persistence;
using Metro.View;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

/// <summary>
/// Plan 19 §4.1 &amp; §5.1 EditMode parity suite for <see cref="StationExplodedConnections"/>.
/// Pins dashed vertical-circulation guide tuples (moduleId, kind, lower/upper indices &amp; levels,
/// exact cut-surface points) against <c>station-exploded-view-oracle.json</c> across Zoo,
/// Tanwei, Tianhe, and synthetic multi-flight / wide-escalator / gap-band fixtures, plus live
/// endpoint translation under manual tray dragging.
/// </summary>
public class StationExplodedConnectionTests {
    const string OracleRelPath = "StationDesigner/Tests/EditMode/station-exploded-view-oracle.json";
    const float PointTolerance = 1e-4f;

    static JObject oracle;
    static JObject Oracle => oracle ??= JObject.Parse(
        File.ReadAllText(Path.Combine(Application.dataPath, OracleRelPath), Encoding.UTF8));

    static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

    static StationDocument LoadCaseDocument(JObject row) {
        if (row["path"] != null) {
            string relPath = (string)row["path"];
            string fullPath = Path.Combine(RepoRoot, relPath.Replace('/', Path.DirectorySeparatorChar));
            return StationDocumentReader.ReadFile(fullPath).Document;
        }
        return StationDocumentReader.Read((string)row["normalizedJson"], new StationSource("fixture:" + row["id"], "")).Document;
    }

    static void AssertGuidesMatchOracle(JObject row) {
        string id = (string)row["id"];
        var doc = LoadCaseDocument(row);
        var plan = StationExplodedLayoutPlan.Build(doc);
        var actual = StationExplodedConnections.Build(plan.RetainedSourceModules, plan.Levels, plan.StoreyHeight);

        var expectedCounts = (JObject)row["guideCounts"];
        Assert.AreEqual((int)expectedCounts["total"], actual.Length, $"{id}: total guide count mismatch");
        Assert.AreEqual((int)expectedCounts["stair"], actual.Count(g => g.Kind == "stair"), $"{id}: stair guide count mismatch");
        Assert.AreEqual((int)expectedCounts["escalator"], actual.Count(g => g.Kind == "escalator"), $"{id}: escalator guide count mismatch");
        Assert.AreEqual((int)expectedCounts["lift"], actual.Count(g => g.Kind == "lift"), $"{id}: lift guide count mismatch");

        var expectedGuides = (JArray)row["guides"];
        Assert.AreEqual(expectedGuides.Count, actual.Length, $"{id}: guides array length mismatch");

        for (int i = 0; i < expectedGuides.Count; i++) {
            var eg = (JObject)expectedGuides[i];
            var ag = actual[i];
            Assert.AreEqual((string)eg["moduleId"], ag.ModuleId, $"{id} guide[{i}]: moduleId mismatch");
            Assert.AreEqual((string)eg["kind"], ag.Kind, $"{id} guide[{i}]: kind mismatch");
            Assert.AreEqual((int)eg["lowerIndex"], ag.LowerIndex, $"{id} guide[{i}]: lowerIndex mismatch");
            Assert.AreEqual((int)eg["upperIndex"], ag.UpperIndex, $"{id} guide[{i}]: upperIndex mismatch");
            Assert.AreEqual((int)eg["lowerLevel"], ag.LowerLevel, $"{id} guide[{i}]: lowerLevel mismatch");
            Assert.AreEqual((int)eg["upperLevel"], ag.UpperLevel, $"{id} guide[{i}]: upperLevel mismatch");

            var pt = (JArray)eg["point"];
            Assert.AreEqual((float)pt[0], ag.OriginalPoint.x, PointTolerance, $"{id} guide[{i}] ({ag.ModuleId}): point.x mismatch");
            Assert.AreEqual((float)pt[1], ag.OriginalPoint.y, PointTolerance, $"{id} guide[{i}] ({ag.ModuleId}): point.y mismatch");
            Assert.AreEqual((float)pt[2], ag.OriginalPoint.z, PointTolerance, $"{id} guide[{i}] ({ag.ModuleId}): point.z mismatch");
        }
    }

    [TestCase("zoo")]
    [TestCase("tanwei")]
    [TestCase("tianhe")]
    public void DemoStationGuidesMatchTypeScriptOracle(string demoId) {
        var row = ((JArray)Oracle["demos"]).Cast<JObject>().First(d => (string)d["id"] == demoId);
        AssertGuidesMatchOracle(row);
    }

    [TestCase("minimal-two-floor")]
    [TestCase("shifted-level-base")]
    [TestCase("concave-above-ground")]
    [TestCase("multi-stop-vertical")]
    public void SyntheticFixtureGuidesMatchTypeScriptOracle(string fixtureId) {
        var row = ((JArray)Oracle["fixtures"]).Cast<JObject>().First(f => (string)f["id"] == fixtureId);
        AssertGuidesMatchOracle(row);
    }

    [Test]
    public void EvaluateWorldEndpointsTracksPackedAndManualTrayShifts() {
        var conn = new StationExplodedConnection("esc-test", "escalator", 0, 1, -10, -5, new Vector3(4.5f, 8.5f, -5f));
        var packed = new[] { 0, 20 };
        var dir = new Vector2Int(1, 1);
        var manual = new[] { new Vector3(-3f, 2f, 0f), new Vector3(5f, -4f, 0f) };

        StationExplodedConnections.EvaluateWorldEndpoints(in conn, packed, dir, manual, out var lowerWorld, out var upperWorld, out float dist);

        // Document lower = (4.5 - 3, 8.5 + 2, -5) = (1.5, 10.5, -5) -> Unity world (1.5, -5, 10.5)
        // Document upper = (4.5 + 20 + 5, 8.5 + 20 - 4, -5) = (29.5, 24.5, -5) -> Unity world (29.5, -5, 24.5)
        Assert.AreEqual(1.5f, lowerWorld.x, 1e-4f);
        Assert.AreEqual(-5f, lowerWorld.y, 1e-4f);
        Assert.AreEqual(10.5f, lowerWorld.z, 1e-4f);

        Assert.AreEqual(29.5f, upperWorld.x, 1e-4f);
        Assert.AreEqual(-5f, upperWorld.y, 1e-4f);
        Assert.AreEqual(24.5f, upperWorld.z, 1e-4f);
        Assert.AreEqual(Vector3.Distance(lowerWorld, upperWorld), dist, 1e-4f);
    }
}
