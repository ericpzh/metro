using System;
using System.IO;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

public class TianheGatePathTests {
    [Serializable] sealed class Fixture { public int gateId,passengerId; public double speed,rate; public GatePathSlice.Waypoint[] path; public Row[] trace; }
    [Serializable] sealed class Row { public int tick,state,pathIndex,gateDir,lane,waitCount; public double x,y,z,cooldown,waitAccum; public int[] queue; public bool dead; }
    [Test] public void SinglePassengerMatchesActualTianheWorldTrace() {
        var path=Path.Combine(Application.dataPath,"StationDesigner/Tests/EditMode/tianhe-gate-oracle.json");
        var fixture=JsonUtility.FromJson<Fixture>(File.ReadAllText(path)); Assert.AreEqual(419,fixture.gateId); Assert.AreEqual(1,fixture.passengerId);
        var sim=new GatePathSlice(fixture.path,fixture.speed,fixture.rate);
        foreach(var expected in fixture.trace) {
            sim.Step(); Assert.AreEqual(expected.tick,sim.Tick); Assert.AreEqual(expected.state,sim.State); Assert.AreEqual(expected.pathIndex,sim.PathIndex);
            Assert.AreEqual(expected.gateDir,sim.GateDirection); Assert.AreEqual(expected.queue.Length,sim.QueueCount); Assert.AreEqual(expected.lane,sim.Lane);
            Assert.That(sim.X,Is.EqualTo(expected.x).Within(1e-9)); Assert.That(sim.Y,Is.EqualTo(expected.y).Within(1e-9)); Assert.That(sim.Z,Is.EqualTo(expected.z).Within(1e-9));
            Assert.That(sim.Cooldown,Is.EqualTo(expected.cooldown).Within(1e-9)); Assert.That(sim.WaitAccum,Is.EqualTo(expected.waitAccum).Within(1e-9));
            Assert.AreEqual(expected.waitCount,sim.WaitCount); Assert.AreEqual(expected.dead,sim.Dead);
        }
    }
}

