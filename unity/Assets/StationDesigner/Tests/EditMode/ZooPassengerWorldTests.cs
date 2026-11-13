using Metro.Sim;
using NUnit.Framework;

public class ZooPassengerWorldTests {
    [Test] public void BurstUsesOneSharedGateInArrivalOrder() {
        var route = new[] {
            new GatePathSlice.Waypoint(),
            new GatePathSlice.Waypoint { x = 1, gate = true },
            new GatePathSlice.Waypoint { x = 2, zone = 3 }
        };
        var world = new ZooPassengerWorld(route, 7654321, 3, 100000, .5);
        world.Step();
        Assert.AreEqual(3, world.Passengers.Count);
        world.Step();
        Assert.AreEqual(3, world.Queued);
        world.Step();
        Assert.AreEqual(2, world.Queued);
        Assert.AreEqual(1, world.Passengers[0].WaitCount);
        Assert.AreEqual(0, world.Passengers[1].WaitCount);
        world.Step();
        Assert.AreEqual(2, world.Queued);
        world.Step();
        Assert.AreEqual(1, world.Queued);
        Assert.AreEqual(2, world.Passengers[1].WaitAccum);
        for (int i = 0; i < 10 && !world.Complete; i++) world.Step();
        Assert.AreEqual(3, world.Boarded);
        foreach (var passenger in world.Passengers) Assert.AreEqual(1, passenger.WaitCount);
    }
}
