using System;
using System.IO;
using System.Diagnostics;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationAuthoredRoundTripTests {
    [Serializable] class Counts { public int droppedCells, droppedModules; }
    static readonly DateTimeOffset FixedTime=new DateTimeOffset(2020,1,2,3,4,5,TimeSpan.Zero);
    static string Root() { var dir=new DirectoryInfo(Application.dataPath); while(dir!=null&&!File.Exists(Path.Combine(dir.FullName,"video/demo-station.metro.json")))dir=dir.Parent; if(dir==null)throw new Exception("Repository fixture missing"); return dir.FullName; }
    static void Run(string source,string output,string report) {
        var save=StationSaveV1.Read(File.ReadAllText(source)); File.WriteAllText(output,save.Write(FixedTime));
        File.WriteAllText(report,JsonUtility.ToJson(new Counts {droppedCells=save.DroppedCells,droppedModules=save.DroppedModules}));
    }
    static void Oracle(string root,string mode) {
        string script=Path.Combine(root,"tools/unity-parity/save-roundtrip.mjs");
        var info=new ProcessStartInfo("node","\""+script+"\" "+mode) {WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true};
        using(var process=Process.Start(info)) { process.WaitForExit(); Assert.AreEqual(0,process.ExitCode,"TypeScript save oracle failed: " + mode); }
    }
    [Test] public void AuthoredSaveRoundTripsThroughBothEngines() {
        string root=Root(),output=Path.Combine(root,".preview/unity/save-parity"); Directory.CreateDirectory(output);
        Oracle(root,"prepare");
        Run(Path.Combine(root,"video/demo-station.metro.json"),Path.Combine(output,"cs-from-authored.json"),Path.Combine(output,"cs-from-authored.report.json"));
        Run(Path.Combine(output,"ts-write.json"),Path.Combine(output,"cs-from-ts.json"),Path.Combine(output,"cs-from-ts.report.json"));
        Oracle(root,"verify");
        Run(Path.Combine(output,"ts-from-cs.json"),Path.Combine(output,"cs-from-ts-from-cs.json"),Path.Combine(output,"cs-from-ts-from-cs.report.json"));
        Oracle(root,"verify-final");
    }
}

