using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.Persistence;
using Metro.Sim;
using NUnit.Framework;

public class FirstPlayableTests {
    [Test] public void PlacementRequiresTheApproachAndRejectsInvalidEdits() {
        var station = new FirstPlayableStation();
        Assert.False(station.CanRun);
        Assert.False(station.PlaceGate(2, 0, 0));
        Assert.False(station.PlaceFloor(3, 0, 0));
        Assert.True(station.PlaceFloor(2, 0, 0));
        Assert.False(station.PlaceFloor(2, 0, 0));
        Assert.True(station.PlaceGate(2, 0, 0));
        Assert.False(station.PlaceGate(2, 0, 0));
        Assert.True(station.CanRun);
    }
    [Test] public void PassengerQueuesAndBoardsInOrder() {
        var sim = new FirstPlayableService();
        var seen = new List<FirstPlayableService.Stage> { sim.CurrentStage };
        for (int i = 0; i < 100 && !sim.Finished; i++) {
            sim.Step(); if (seen[seen.Count - 1] != sim.CurrentStage) seen.Add(sim.CurrentStage);
        }
        CollectionAssert.AreEqual(new[] { FirstPlayableService.Stage.Entrance, FirstPlayableService.Stage.WalkingToGate,
            FirstPlayableService.Stage.Queuing, FirstPlayableService.Stage.ThroughGate,
            FirstPlayableService.Stage.Platform, FirstPlayableService.Stage.Boarded }, seen);
        Assert.AreEqual(1, sim.BoardedCount); sim.Step(); Assert.AreEqual(1, sim.BoardedCount);
    }
    [Test] public void SecondGateRequiresConnectedApproachAndSurvivesSave() {
        var station = new FirstPlayableStation();
        Assert.True(station.PlaceFloor(2, 0, 0));
        Assert.True(station.PlaceGate(3, 1, 0));
        Assert.False(station.CanRun);
        StringAssert.Contains("disconnected", station.RouteProblem);
        Assert.True(station.PlaceFloor(2, 1, 0));
        Assert.True(station.TryRoute(out int x, out int lane));
        Assert.AreEqual(3, x); Assert.AreEqual(1, lane);
        var restored = FirstPlayableSave.Read(FirstPlayableSave.Write(station, DateTimeOffset.UnixEpoch));
        Assert.True(restored.HasFloor && restored.HasSecondFloor && restored.HasSecondGate);
        Assert.True(restored.TryRoute(out x, out lane));
        var sim = new FirstPlayableService(x, lane); bool queuedAtGate = false, passedGate = false;
        for (int i = 0; i < 100 && !sim.Finished; i++) {
            sim.Step();
            if (sim.CurrentStage == FirstPlayableService.Stage.ThroughGate) passedGate = true;
            if (sim.CurrentStage == FirstPlayableService.Stage.Queuing)
                queuedAtGate = Math.Abs(sim.X - 3.5) <= .6 && Math.Abs(sim.Y - 1.5) < .01;
        }
        Assert.True(queuedAtGate); Assert.True(passedGate); Assert.AreEqual(1, sim.BoardedCount);
    }
    [Test] public void DetourFollowsBuiltCellsAndMissingConnectionFails() {
        var station=new FirstPlayableStation();
        Assert.True(station.PlaceFloor(3,2,0)); Assert.True(station.PlaceGate(3,2,0));
        Assert.False(station.CanRun); StringAssert.Contains("disconnected",station.RouteProblem);
        Assert.True(station.PlaceFloor(2,2,0));
        Assert.True(station.TryPath(out var cells,out int gateIndex));
        CollectionAssert.Contains(cells,(2,2)); Assert.AreEqual((3,2),cells[gateIndex]);
        var restored=FirstPlayableSave.Read(FirstPlayableSave.Write(station,DateTimeOffset.UnixEpoch));
        Assert.True(restored.TryPath(out var restoredPath,out int restoredGate));
        var sim=new FirstPlayableService(restoredPath,restoredGate); bool onApproach=false, queue=false;
        for(int i=0;i<100 && !sim.Finished;i++) { sim.Step(); if(Math.Abs(sim.X-2.5)<.01 && Math.Abs(sim.Y-2.5)<.01) onApproach=true; if(sim.CurrentStage==FirstPlayableService.Stage.Queuing) queue=true; }
        Assert.True(onApproach); Assert.True(queue); Assert.AreEqual(1,sim.BoardedCount);
    }
    [Test] public void SaveRoundTripRestoresCommittedEditsAndRejectsBadInput() {
        var station = new FirstPlayableStation(); station.PlaceFloor(2, 0, 0); station.PlaceGate(2, 0, 0);
        var json = FirstPlayableSave.Write(station, new DateTimeOffset(2020, 1, 2, 3, 4, 5, TimeSpan.Zero));
        var restored = FirstPlayableSave.Read(json);
        Assert.True(restored.HasFloor); Assert.True(restored.HasGate); Assert.True(restored.CanRun);
        Assert.Throws<FormatException>(() => FirstPlayableSave.Read("not json"));
        Assert.True(station.CanRun);
    }
}
