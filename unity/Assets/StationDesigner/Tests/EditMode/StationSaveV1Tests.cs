using System;
using System.IO;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationSaveV1Tests {
    [Test] public void WritesSupportedNonemptyStationWithoutLosingNamesAndCounts() {
        const string input="{\"format\":\"metro-save\",\"formatVersion\":1,\"name\":\"测试站 😀\",\"nameEn\":\"Test\",\"seed\":42,\"static\":{\"cells\":[{\"x\":-2,\"y\":0,\"z\":0,\"fill\":\"solid\"},{\"x\":0.5,\"y\":0,\"z\":0,\"fill\":\"solid\"}],\"modules\":[{\"id\":\"bench\",\"type\":\"bench\",\"x\":0,\"y\":1,\"z\":0,\"cfg\":{}}],\"lines\":[]}}";
        var save=StationSaveV1.Read(input); Assert.AreEqual(1,save.DroppedCells); Assert.AreEqual(0,save.DroppedModules);
        string output=save.Write(new DateTimeOffset(2020,1,2,3,4,5,TimeSpan.Zero));
        StringAssert.Contains("测试站 😀",output); StringAssert.Contains("2020-01-02T03:04:05.000Z",output);
        var dir=new DirectoryInfo(Application.dataPath); while(dir!=null&&!Directory.Exists(Path.Combine(dir.FullName,"video"))) dir=dir.Parent;
        Assert.NotNull(dir); var evidence=Path.Combine(dir.FullName,".preview/unity/save-parity"); Directory.CreateDirectory(evidence); File.WriteAllText(Path.Combine(evidence,"cs-simple.json"),output);
        Assert.DoesNotThrow(()=>StationSaveV1.Read(output));
    }
    [Test] public void DoesNotCommitAnUnportedSign() {
        const string input="{\"format\":\"metro-save\",\"static\":{\"cells\":[],\"modules\":[{\"type\":\"sign\",\"x\":0,\"y\":0,\"z\":0,\"cfg\":{}}],\"lines\":[]}}";
        Assert.Throws<NotSupportedException>(()=>StationSaveV1.Read(input));
    }
}
