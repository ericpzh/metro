using System;
using System.IO;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationSaveCandidateTests {
    [Serializable] class Cell { public int x,y,z; }
    [Serializable] class Module { public string id; }
    [Serializable] class Line { public string name; }
    [Serializable] class Candidate { public string name,nameEn,cityStyle; public int levelBase,storeyHeight; public Cell[] cells; public Module[] modules; public Line[] lines; }
    [Test] public void InspectsAuthoredSaveWithoutClaimingCompleteRead() {
        var dir=new DirectoryInfo(Application.dataPath);
        while(dir != null && !File.Exists(Path.Combine(dir.FullName,"video/demo-station.metro.json"))) dir=dir.Parent;
        Assert.NotNull(dir);
        var source=File.ReadAllText(Path.Combine(dir.FullName,"video/demo-station.metro.json"));
        var inspected=StationSaveCandidate.InspectV1(source); var evidence=Path.Combine(dir.FullName,".preview/unity/save-parity"); Directory.CreateDirectory(evidence); File.WriteAllText(Path.Combine(evidence,"cs-candidate.json"),inspected.InspectJson()); var candidate=JsonUtility.FromJson<Candidate>(inspected.InspectJson());
        Assert.AreEqual(0,inspected.DroppedCells); Assert.AreEqual(0,inspected.DroppedModules);
        Assert.AreEqual(1303,candidate.cells.Length); Assert.AreEqual(309,candidate.modules.Length); Assert.AreEqual(1,candidate.lines.Length);
        Assert.AreEqual("车站",candidate.name); Assert.AreEqual("1号线",candidate.lines[0].name); Assert.AreEqual(1,candidate.levelBase);
    }
}

