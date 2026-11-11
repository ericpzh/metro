using System.IO;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationSignRepairTests {
    [Test] public void AuthoredSignsAreNormalizedForTypeScriptComparison() {
        var dir=new DirectoryInfo(Application.dataPath);
        while(dir!=null&&!File.Exists(Path.Combine(dir.FullName,"video/demo-station.metro.json"))) dir=dir.Parent;
        Assert.NotNull(dir); var source=File.ReadAllText(Path.Combine(dir.FullName,"video/demo-station.metro.json"));
        string output=StationSignRepair.NormalizeSaveSignsJson(source); var evidence=Path.Combine(dir.FullName,".preview/unity/save-parity"); Directory.CreateDirectory(evidence);
        File.WriteAllText(Path.Combine(evidence,"cs-signs.json"),output); StringAssert.Contains("出口",output);
    }
    [Test] public void RepairSyntheticSignForTypeScriptOracle() {
        var dir=new DirectoryInfo(Application.dataPath);
        while(dir!=null&&!File.Exists(Path.Combine(dir.FullName,"video/demo-station.metro.json"))) dir=dir.Parent;
        Assert.NotNull(dir);
        string fixture=Path.Combine(Application.dataPath,"StationDesigner/Tests/EditMode/sign-normalization-input.json");
        string output=StationSignRepair.NormalizeSaveSignsJson(File.ReadAllText(fixture));
        var evidence=Path.Combine(dir.FullName,".preview/unity/save-parity"); Directory.CreateDirectory(evidence);
        File.WriteAllText(Path.Combine(evidence,"cs-sign-synthetic.json"),output);
        StringAssert.Contains("天河",output);
    }
    [Test] public void LegacySignsFailClosed() {
        Assert.Throws<System.NotSupportedException>(()=>StationSignRepair.NormalizeJson("{\"type\":\"sign\",\"cfg\":{}}"));
    }
}

