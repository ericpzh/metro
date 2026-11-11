using System;
using Metro.Persistence;
using NUnit.Framework;
using UnityEngine;

public class StationDayRepairTests {
    [Serializable] class Span { public int from,to; }
    [Serializable] class Knobs { public float amPeak,pmPeak,sharpness; }
    [Serializable] class Demand { public Knobs workday,offday; }
    [Serializable] class Date { public int year,month,day; }
    [Serializable] class Calendar { public Date epoch; public string[] holidays; }
    [Serializable] class Result { public Span service; public Span[] peaks; public Demand demand; public Calendar calendar; }
    [Test] public void RepairsAuthoredDayLikeTypeScript() {
        const string input="{\"service\":{\"from\":25000,\"to\":200},\"peaks\":[{\"from\":85000,\"to\":86000},{\"from\":10,\"to\":20}],\"demand\":{\"workday\":{\"amPeak\":9,\"sharpness\":0.1}},\"calendar\":{\"epoch\":{\"year\":2025,\"month\":2,\"day\":30},\"holidays\":[\"abc\",\"2026-99-99\"]}}";
        var x=JsonUtility.FromJson<Result>(StationDayRepair.RepairJson(input));
        Assert.AreEqual(25020,x.service.from); Assert.AreEqual(25920,x.service.to);
        Assert.AreEqual(84540,x.peaks[0].from); Assert.AreEqual(85440,x.peaks[0].to); Assert.AreEqual(85440,x.peaks[1].from); Assert.AreEqual(86340,x.peaks[1].to);
        Assert.AreEqual(2.5f,x.demand.workday.amPeak); Assert.AreEqual(.4f,x.demand.workday.sharpness);
        Assert.AreEqual(28,x.calendar.epoch.day); CollectionAssert.AreEqual(new[]{"2026-99-99"},x.calendar.holidays);
    }
}
