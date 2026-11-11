using System;
using System.IO;
using Metro.Persistence;
namespace Metro.Editor {
 public static class InspectDemoSave {
  public static void Run() {
   var args=Environment.GetCommandLineArgs();int i=Array.IndexOf(args,"-demoSave");if(i<0||i+1>=args.Length)throw new Exception("Missing demo save");
   var save=StationSaveV1.Read(File.ReadAllText(args[i+1]));File.WriteAllText(args[i+1]+".cs.json",save.Write(new DateTimeOffset(2020,1,2,3,4,5,TimeSpan.Zero)));
  }
 }
}
