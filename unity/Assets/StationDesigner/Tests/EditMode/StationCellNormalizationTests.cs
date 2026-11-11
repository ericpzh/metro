using System;
using System.IO;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationCellNormalizationTests {
    [Serializable] class Oracle { public string sourceSha, bits; public string[] shapes; public Example[] explicitCases; }
    [Serializable] class Example { public string input, expected; }
    [Test] public void AllShapeFacePairsMatchTypeScriptOracle() {
        var path=Path.Combine(Application.dataPath,"StationDesigner/Tests/EditMode/cell-normalization-oracle.json");
        // JsonUtility maps the JSON field "explicit" via the dedicated test below.
        var oracle=JsonUtility.FromJson<Oracle>(File.ReadAllText(path));
        string[] faces={"e","w","n","s","top","bottom"};
        int[,] offsets={{1,0,0},{-1,0,0},{0,1,0},{0,-1,0},{0,0,1},{0,0,-1}};
        int index=0;
        foreach(string own in oracle.shapes)foreach(string neighbour in oracle.shapes)for(int face=0;face<faces.Length;face++) {
            string tags1=Tags(own),tags2=Tags(neighbour),name=faces[face];
            string input="[{\"x\":0,\"y\":0,\"z\":0,\"fill\":\"solid\",\"tags\":"+tags1+",\"finish\":{\""+name+"\":\"paint\"}},{\"x\":"+offsets[face,0]+",\"y\":"+offsets[face,1]+",\"z\":"+offsets[face,2]+",\"fill\":\"solid\",\"tags\":"+tags2+"}]";
            bool actual=StationCellNormalization.NormalizeJson(input).Contains("\""+name+"\":\"paint\"");
            Assert.AreEqual(oracle.bits[index++]=='1',actual,$"own={own}, neighbour={neighbour}, face={name}");
        }
        Assert.AreEqual(oracle.bits.Length,index);
    }
    static string Tags(string encoded) => encoded.Length==0?"[]":"[\""+string.Join("\",\"",encoded.Split('|'))+"\"]";
    [Serializable] class ExplicitOracle { public Example[] examples; }
    [Test] public void CeilingLabelsAndContactRulesMatchTypeScript() {
        var path=Path.Combine(Application.dataPath,"StationDesigner/Tests/EditMode/cell-normalization-oracle.json");
        var text=File.ReadAllText(path).Replace("\"explicit\":", "\"examples\":");
        var oracle=JsonUtility.FromJson<ExplicitOracle>(text);
        Assert.AreEqual(4,oracle.examples.Length);
        foreach(var example in oracle.examples) Assert.AreEqual(example.expected,StationCellNormalization.NormalizeJson(example.input));
    }
}
