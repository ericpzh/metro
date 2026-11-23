using System;
using Metro.Persistence;
using Metro.Sim;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

public class StationLineRepairTests {
    [Serializable] class Container { public Line[] lines; }
    [Serializable] class Line { public int cars; public float modelScale; public string upTerminus, downTerminus; public Profile headwayProfile; }
    [Serializable] class Profile { public int peak, offpeak, late; }
    [Test] public void RepairsFormationHeadwaysAndTermini() {
        var json = StationLineRepair.RepairJson("[{\"cars\":5,\"headwayProfile\":{\"peak\":59,\"offpeak\":200.5,\"late\":5000}}]");
        var line = JsonUtility.FromJson<Container>("{\"lines\":" + json + "}").lines[0];
        Assert.AreEqual(4, line.cars); Assert.That(line.modelScale, Is.EqualTo(.98f).Within(.00001));
        Assert.AreEqual("", line.upTerminus); Assert.AreEqual("", line.downTerminus);
        Assert.AreEqual(60, line.headwayProfile.peak); Assert.AreEqual(201, line.headwayProfile.offpeak); Assert.AreEqual(1200, line.headwayProfile.late);
    }

    [Test] public void LegacyScalarHeadwayAndPartialProfileFallBackToDefaultsLegByLeg() {
        // Legacy save with scalar headway and no headwayProfile falls back to 150 / 240 / 480.
        var legacy = JArray.Parse(StationLineRepair.RepairJson("[{\"id\":\"1\",\"headway\":180}]"))[0];
        Assert.AreEqual(150, (int)legacy["headwayProfile"]["peak"], "legacy scalar headway falls back peak to 150");
        Assert.AreEqual(240, (int)legacy["headwayProfile"]["offpeak"], "legacy scalar headway falls back offpeak to 240");
        Assert.AreEqual(480, (int)legacy["headwayProfile"]["late"], "legacy scalar headway falls back late to 480");

        // Non-object headwayProfile (scalar/null) also falls back cleanly.
        var scalarProfile = JArray.Parse(StationLineRepair.RepairJson("[{\"headwayProfile\":120},{\"headwayProfile\":null}]"));
        for (int i = 0; i < scalarProfile.Count; i++) {
            Assert.AreEqual(150, (int)scalarProfile[i]["headwayProfile"]["peak"]);
            Assert.AreEqual(240, (int)scalarProfile[i]["headwayProfile"]["offpeak"]);
            Assert.AreEqual(480, (int)scalarProfile[i]["headwayProfile"]["late"]);
        }

        // Partial headwayProfile keeps valid legs, clamps out-of-range legs, and defaults missing/non-numeric legs.
        var partial = JArray.Parse(StationLineRepair.RepairJson(
            "[{\"headwayProfile\":{\"peak\":20,\"offpeak\":\"bad\",\"late\":900.4}}]"))[0];
        Assert.AreEqual(60, (int)partial["headwayProfile"]["peak"], "below 60 clamps to floor");
        Assert.AreEqual(240, (int)partial["headwayProfile"]["offpeak"], "bad leg falls back to 240");
        Assert.AreEqual(900, (int)partial["headwayProfile"]["late"], "valid leg rounds to nearest whole second");
    }

    [TestCase(1, 2)]
    [TestCase(2, 2)]
    [TestCase(3, 3)]
    [TestCase(4, 4)]
    [TestCase(5, 4)]
    [TestCase(6, 6)]
    [TestCase(7, 6)]
    [TestCase(8, 8)]
    [TestCase(9, 8)]
    [TestCase(0, 2)]
    [TestCase(-1, 2)]
    public void SnapsCarsToNearestConsistFormationWithTiesRoundingDown(int rawCars, int expectedFormation) {
        var repaired = JArray.Parse(StationLineRepair.RepairJson("[{\"cars\":" + rawCars + "}]"))[0];
        Assert.AreEqual(expectedFormation, (int)repaired["cars"], $"cars={rawCars} should snap to {expectedFormation}");
    }

    [Test] public void MissingOrInvalidCarsDefaultsToSixAndValidModelScaleAndTerminiArePreserved() {
        var missingCars = JArray.Parse(StationLineRepair.RepairJson("[{},{\"cars\":null},{\"cars\":\"six\"}]"));
        for (int i = 0; i < missingCars.Count; i++) {
            Assert.AreEqual(6, (int)missingCars[i]["cars"], $"non-numeric cars index {i} defaults to 6");
        }

        var preserved = JArray.Parse(StationLineRepair.RepairJson(
            "[{\"id\":\"2\",\"cars\":6,\"modelScale\":0.98,\"upTerminus\":\"广州南站\",\"downTerminus\":\"嘉禾望岗\"}]"))[0];
        Assert.AreEqual(0.98, (double)preserved["modelScale"], 1e-9, "valid 0.98 modelScale preserved");
        Assert.AreEqual("广州南站", (string)preserved["upTerminus"], "non-empty upTerminus preserved");
        Assert.AreEqual("嘉禾望岗", (string)preserved["downTerminus"], "non-empty downTerminus preserved");
        Assert.AreEqual(6, (int)preserved["cars"]);

        Assert.Throws<FormatException>(() => StationLineRepair.RepairJson("[42]"), "non-object line entry must throw");
    }

    [Test] public void ServiceTracksExcludesTunnelAndBridgeRunsUnlessNoPlatformTrackExists() {
        var doc = new StationSessionDocument { StationId = "service-tracks-filter" };
        doc.Modules.Add(new StationModuleFact { Id = "t-plat-1", Type = "track", LineId = "1", Width = 12 });
        doc.Modules.Add(new StationModuleFact { Id = "t-plat-2", Type = "track", LineId = "1", Width = 12 });
        doc.Modules.Add(new StationModuleFact { Id = "t-tunnel-1", Type = "track", LineId = "1", Width = 12, Tunnel = true });
        doc.Modules.Add(new StationModuleFact { Id = "t-bridge-1", Type = "track", LineId = "1", Width = 12, Bridge = true });
        doc.Modules.Add(new StationModuleFact { Id = "t-tunnel-only", Type = "track", LineId = "2", Width = 12, Tunnel = true });
        doc.Modules.Add(new StationModuleFact { Id = "t-bridge-only", Type = "track", LineId = "3", Width = 12, Bridge = true });
        doc.Modules.Add(new StationModuleFact { Id = "t-mixed-ext-1", Type = "track", LineId = "4", Width = 12, Tunnel = true });
        doc.Modules.Add(new StationModuleFact { Id = "t-mixed-ext-2", Type = "track", LineId = "4", Width = 12, Bridge = true });

        var line1 = StationServiceDoors.ServiceTracks(doc, "1");
        Assert.AreEqual(2, line1.Count, "tunnel and bridge extensions excluded when platform tracks exist");
        Assert.AreEqual("t-plat-1", line1[0].Id);
        Assert.AreEqual("t-plat-2", line1[1].Id);

        var line2 = StationServiceDoors.ServiceTracks(doc, "2");
        Assert.AreEqual(1, line2.Count, "tunnel-only line falls back to its tunnel track");
        Assert.AreEqual("t-tunnel-only", line2[0].Id);

        var line3 = StationServiceDoors.ServiceTracks(doc, "3");
        Assert.AreEqual(1, line3.Count, "bridge-only line falls back to its bridge track");
        Assert.AreEqual("t-bridge-only", line3[0].Id);

        var line4 = StationServiceDoors.ServiceTracks(doc, "4");
        Assert.AreEqual(2, line4.Count, "line with only tunnel/bridge tracks keeps both as fallback");

        var line5 = StationServiceDoors.ServiceTracks(doc, "5");
        Assert.AreEqual(0, line5.Count, "line with no tracks returns empty");

        // StationSessionDocument.ServiceTracks agrees with StationServiceDoors.ServiceTracks.
        Assert.AreEqual(line1.Count, doc.ServiceTracks("1").Count);
        Assert.AreEqual(line2.Count, doc.ServiceTracks("2").Count);
        Assert.AreEqual(line3.Count, doc.ServiceTracks("3").Count);
        Assert.AreEqual(line5.Count, doc.ServiceTracks("5").Count);
    }
}
