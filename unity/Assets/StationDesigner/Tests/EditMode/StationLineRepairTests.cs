using System;
using Metro.Persistence;
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
}
