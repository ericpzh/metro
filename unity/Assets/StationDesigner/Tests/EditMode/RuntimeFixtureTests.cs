using System;
using System.IO;
using Metro.Sim;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class RuntimeFixtureTests {
    [Serializable] class Oracle { public uint seed; public Result output; }
    [Serializable] class Result { public double[] values; public uint state; public string hashInput; public uint hash; }
    [Test] public void RngMatchesTypeScriptOracleAndReplays() {
        var fixture = JsonUtility.FromJson<Oracle>(File.ReadAllText(Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/rng-oracle.json")));
        for (int run = 0; run < 2; run++) {
            var rng = new Rng(fixture.seed);
            foreach (var expected in fixture.output.values) Assert.AreEqual(expected, rng.Next());
            Assert.AreEqual(fixture.output.state, rng.State);
            Assert.AreEqual(fixture.output.hash, Rng.HashString(fixture.output.hashInput));
        }
        Assert.AreNotEqual(fixture.output.values[0], new Rng(fixture.seed + 1).Next());
    }
    [Test] public void EmptyV1SaveRoundTripsAndPreservesAuthoredUnicode() {
        const string source = "{\"format\":\"metro-save\",\"formatVersion\":1,\"name\":\"天河 😀\",\"nameEn\":\"Tianhe\",\"seed\":7,\"static\":{\"cells\":[],\"modules\":[],\"lines\":[]}}";
        var written = StationSave.ReadEmptyV1(source).WriteV1(new DateTimeOffset(2020, 1, 2, 3, 4, 5, TimeSpan.Zero));
        StringAssert.Contains("天河 😀", written);
        StringAssert.Contains("2020-01-02T03:04:05.000Z", written);
        Assert.DoesNotThrow(() => StationSave.ReadEmptyV1(written));
    }
    [Test] public void RefusesFutureOrUnportedRecords() {
        Assert.Throws<FormatException>(() => StationSave.ReadEmptyV1("{\"format\":\"metro-save\",\"formatVersion\":2,\"static\":{\"cells\":[]}}"));
        Assert.Throws<NotSupportedException>(() => StationSave.ReadEmptyV1("{\"format\":\"metro-save\",\"static\":{\"cells\":[{}]}}"));
    }
}
