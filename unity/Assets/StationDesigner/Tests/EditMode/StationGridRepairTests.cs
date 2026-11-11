using System;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationGridRepairTests {
    [Serializable] class Result { public Cell[] cells; public Module[] modules; public int droppedCells, droppedModules; }
    [Serializable] class Cell { public int x, y, z; }
    [Serializable] class Module { public string id; }
    [Test] public void RepairsGridAndKeepsWallOffsetsAndHalfStairFlights() {
        const string data = "{\"cells\":[{\"x\":-2,\"y\":3,\"z\":0},{\"x\":0.5,\"y\":0,\"z\":0}],\"modules\":[{\"id\":\"wall\",\"type\":\"linemap\",\"x\":1,\"y\":2,\"z\":0.99,\"cfg\":{}},{\"id\":\"bad\",\"type\":\"bench\",\"x\":1.5,\"y\":0,\"z\":0,\"cfg\":{}},{\"id\":\"stair\",\"type\":\"stair\",\"x\":0,\"y\":0,\"z\":0,\"cfg\":{\"flights\":[{\"from\":{\"x\":0,\"y\":0,\"z\":0.5},\"to\":{\"x\":0,\"y\":1,\"z\":1}}]}}]}";
        var result = JsonUtility.FromJson<Result>(StationGridRepair.RepairJson(data));
        Assert.AreEqual(1, result.droppedCells); Assert.AreEqual(1, result.droppedModules);
        Assert.AreEqual(-2, result.cells[0].x); Assert.AreEqual("wall", result.modules[0].id); Assert.AreEqual("stair", result.modules[1].id);
    }
    [Test] public void AuthoredSaveGridMatchesTypeScriptCounts() {
        var dir = new System.IO.DirectoryInfo(Application.dataPath);
        while (dir != null && !System.IO.File.Exists(System.IO.Path.Combine(dir.FullName, "video/demo-station.metro.json"))) dir = dir.Parent;
        Assert.NotNull(dir, "Repository fixture missing");
        var text = System.IO.File.ReadAllText(System.IO.Path.Combine(dir.FullName, "video/demo-station.metro.json"));
        var result = JsonUtility.FromJson<Result>(StationGridRepair.RepairSaveJson(text));
        Assert.AreEqual(0, result.droppedCells); Assert.AreEqual(0, result.droppedModules);
        Assert.AreEqual(1303, result.cells.Length); Assert.AreEqual(309, result.modules.Length);
    }
    [Test] public void FractionalGlassUsesWallAndCurtainRules() {
        const string data = "{\"cells\":[],\"modules\":[{\"id\":\"wall\",\"type\":\"glass\",\"x\":0,\"y\":0,\"z\":0.5,\"cfg\":{\"variant\":\"1x2\"}},{\"id\":\"curtain\",\"type\":\"glass\",\"x\":0,\"y\":0,\"z\":0.5,\"cfg\":{\"variant\":\"1x2\",\"curtainHeight\":2}},{\"id\":\"tall\",\"type\":\"glass\",\"x\":0,\"y\":0,\"z\":0.5,\"cfg\":{\"variant\":\"2x4\"}}]}";
        var result = JsonUtility.FromJson<Result>(StationGridRepair.RepairJson(data));
        Assert.AreEqual(2, result.droppedModules); Assert.AreEqual("wall", result.modules[0].id);
    }
}
