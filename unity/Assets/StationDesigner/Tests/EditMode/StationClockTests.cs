using System;
using System.IO;
using Metro.Sim;
using NUnit.Framework;
using UnityEngine;

// Packet C Â· C2 â€” the station clock (`StationClock.cs`) against the TypeScript
// oracle in `station-clock-oracle.json` (written by
// `tools/unity-parity/record-station-clock.mjs`, which computes every expected
// value with `game/src/sim/clock.ts` itself).
//
// What a broken clock looks like is the point of most of these: a date one day
// out, a weekday one off, a midnight that never comes, a service window that
// never reopens, or `simTime` starting at 0:00 â€” all of them *look* like a
// working clock until they are pinned against real calendar facts.
public class StationClockTests {
    // ------------------------------------------------------------- oracle shape

    [Serializable] public sealed class Oracle {
        public string generatedBy, sourceSha, sourceDocument;
        public bool dayOverridden;
        public double referenceBootSeconds, simSecondsPerTick;
        public int maxTicksPerFrame;
        public DayInput input;
        public Normalization normalization;
        public Scenario[] scenarios;
    }
    [Serializable] public sealed class DayInput {
        public SpanInput service;
        public SpanInput[] peaks;
        public DemandInput demand;
        public CalendarInput calendar;
    }
    [Serializable] public sealed class SpanInput { public int from, to; }
    [Serializable] public sealed class DemandInput { public KnobsInput workday, offday; }
    [Serializable] public sealed class KnobsInput { public double amPeak, pmPeak, sharpness; }
    [Serializable] public sealed class CalendarInput { public DateInput epoch; public string[] holidays; }
    [Serializable] public sealed class DateInput { public int year, month, day; }
    [Serializable] public sealed class Normalization {
        public SpanInput serviceInverted, serviceOutOfRange, serviceAtDayEnd;
        public SpanInput[] peaksCrossed, peaksSqueezed;
        public CalendarCase calendarClamped, calendarMissingList;
        public KnobsInput demandRounded;
        public ClockParseCase secondsOfClock;
    }
    [Serializable] public sealed class CalendarCase { public DateInput epoch; public string[] holidays; }
    [Serializable] public sealed class ClockParseCase { public int open, lastMinute; }
    [Serializable] public sealed class Scenario {
        public string name;
        public double startSimTime;
        public DayInput input;
        public Step[] steps;
        public Frame[] frames;
    }
    [Serializable] public sealed class Step {
        public string op, label;
        public bool playing;
        public int speed;
        public double seconds, simTime;
        public int year, month, day;
    }
    [Serializable] public sealed class Frame {
        public string label;
        public int ticksTotal, dayIndex, weekday, timeOfDay;
        public double simTime, dayFraction, hourHand, minuteHand, demandRate;
        public string dateKey, dayType, period, clock, clockSeconds;
        public bool isOpen, peak;
    }

    static Oracle cached;
    public static Oracle Instance() {
        if (cached != null) return cached;
        string path = Path.Combine(Application.dataPath, "StationDesigner/Tests/EditMode/station-clock-oracle.json");
        Assert.IsTrue(File.Exists(path), "Run tools/unity-parity/record-station-clock.mjs first: " + path);
        cached = JsonUtility.FromJson<Oracle>(File.ReadAllText(path));
        Assert.IsNotNull(cached, "station-clock-oracle.json did not parse");
        Assert.AreEqual("tools/unity-parity/record-station-clock.mjs", cached.generatedBy);
        Assert.IsNotNull(cached.input, "the oracle carries the authored-day payload");
        return cached;
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// True for a day payload that actually carries an authored day. Unity's JsonUtility
    /// turns a JSON `null` scenario override into a default-constructed instance rather than
    /// null, so "service and both peaks are zero" is the only reliable "nothing here" test.
    /// </summary>
    public static bool HasDay(DayInput input) =>
        input != null && input.service != null && (input.service.from > 0 || input.service.to > 0);

    public static StationDayData DayOf(DayInput input) {
        if (!HasDay(input)) return StationDayData.Default;
        var peaks = input.peaks ?? new SpanInput[0];
        var span = new DaySpan(input.service.from, input.service.to);
        var early = peaks.Length > 0 ? new DaySpan(peaks[0].from, peaks[0].to) : StationClock.DefaultPeaks.Early;
        var late = peaks.Length > 1 ? new DaySpan(peaks[1].from, peaks[1].to) : StationClock.DefaultPeaks.Late;
        var knobs = input.demand ?? new DemandInput();
        var workday = knobs.workday ?? new KnobsInput { amPeak = 1, pmPeak = 0.78, sharpness = 1 };
        var offday = knobs.offday ?? new KnobsInput { amPeak = 0.35, pmPeak = 0.4, sharpness = 1.5 };
        var calendar = input.calendar ?? new CalendarInput();
        var epoch = calendar.epoch ?? new DateInput { year = 2026, month = 1, day = 1 };
        return new StationDayData(
            span,
            new PeakSpans(early, late),
            new DayDemand(
                new DemandKnobs(workday.amPeak, workday.pmPeak, workday.sharpness),
                new DemandKnobs(offday.amPeak, offday.pmPeak, offday.sharpness)),
            new SimCalendar(new SimDate(epoch.year, epoch.month, epoch.day), calendar.holidays));
    }

    public static void AssertFrame(Frame expected, SimStamp actual, double simTime, long tick) {
        string where = expected.label + "@" + expected.clockSeconds;
        Assert.AreEqual(expected.simTime, simTime, 1e-6, "simTime " + where);
        Assert.AreEqual(expected.ticksTotal, (int)tick, "tick " + where);
        Assert.AreEqual(expected.dayIndex, actual.DayIndex, "dayIndex " + where);
        Assert.AreEqual(expected.dateKey, actual.DateKey, "dateKey " + where);
        Assert.AreEqual(expected.weekday, actual.Weekday, "weekday " + where);
        Assert.AreEqual(expected.dayType, actual.DayType == SimDayType.Workday ? "workday" : "offday", "dayType " + where);
        Assert.AreEqual(expected.period, actual.Period == SimPeriod.Peak ? "peak" : actual.Period == SimPeriod.Offpeak ? "offpeak" : "late", "period " + where);
        Assert.AreEqual(expected.isOpen, actual.IsOpen, "isOpen " + where);
        Assert.AreEqual(expected.peak, actual.Peak, "peak " + where);
        Assert.AreEqual(expected.timeOfDay, actual.TimeOfDay, "timeOfDay " + where);
        Assert.AreEqual(expected.dayFraction, actual.DayFraction, 1e-12, "dayFraction " + where);
        Assert.AreEqual(expected.clock, actual.Clock, "clock " + where);
        Assert.AreEqual(expected.clockSeconds, actual.ClockSeconds, "clockSeconds " + where);
        Assert.AreEqual(expected.hourHand, actual.HourHandDegrees, 1e-9, "hourHand " + where);
        Assert.AreEqual(expected.minuteHand, actual.MinuteHandDegrees, 1e-9, "minuteHand " + where);
    }

    // ------------------------------------------------------------------ tests

    [Test]
    public void ColdBootIsReferenceBootAt0630() {
        var oracle = Instance();
        var clock = new StationClock(DayOf(oracle.input), oracle.referenceBootSeconds);
        var stamp = clock.Stamp();
        Assert.AreEqual(StationClock.ReferenceBootSeconds, oracle.referenceBootSeconds, "REFERENCE_BOOT is DEFAULT_SIM_TIME");
        Assert.AreEqual(6.5 * 3600, StationClock.ReferenceBootSeconds);
        Assert.AreEqual(23400.0, clock.SimTime, 1e-12, "cold boot is 06:30, not 00:00 and not a tick count");
        Assert.AreEqual(0, stamp.DayIndex, "day 0 is the station's first day");
        Assert.AreEqual("06:30:00", stamp.ClockSeconds);
        Assert.IsTrue(stamp.IsOpen, "06:30 is the service opening, inside the window");
        var cold = oracle.scenarios[0];
        Assert.AreEqual("cold-boot", cold.name);
        AssertFrame(cold.frames[0], stamp, clock.SimTime, 0);
    }

    [Test]
    public void AnUnsetDayIsTheShippedDayNotAClosedStation() {
        // A default-constructed StationDayData is "no day authored", not a station open for
        // a quarter of an hour at midnight. The source load path never sees this because its
        // fields can be `undefined`; in C# a host that leaves the day unset arrives as zeros,
        // and the clock must still open at 06:30 rather than report 夜间 at every hour.
        Assert.IsTrue(StationClock.IsUnsetDay(default(StationDayData)));
        var clock = new StationClock(default(StationDayData), StationClock.ReferenceBootSeconds);
        var stamp = clock.Stamp();
        Assert.AreEqual(StationClock.DefaultService.From, stamp.Service.From, "service from");
        Assert.AreEqual(StationClock.DefaultService.To, stamp.Service.To, "service to");
        Assert.AreEqual(StationClock.DefaultPeaks.Early.From, clock.Peaks.Early.From, "morning peak");
        Assert.IsTrue(stamp.IsOpen, "06:30 is inside the shipped window");
        Assert.AreEqual("offpeak", StationSimulationSession.PeriodText(stamp.Period), "06:30 is 平峰, not 夜间");
        // A day that is authored is repaired, never replaced.
        Assert.IsFalse(StationClock.IsUnsetDay(StationDayData.Default));
        var narrowed = StationClock.NormalizeDay(new StationDayData(
            new DaySpan(9 * 3600, 17 * 3600), StationClock.DefaultPeaks, DayDemand.Default, SimCalendar.Default));
        Assert.AreEqual(9 * 3600, narrowed.Service.From);
        Assert.AreEqual(17 * 3600, narrowed.Service.To);
    }

    [Test]
    public void CalendarArithmeticIsExact() {
        // 1970-01-01 was a Thursday; the century rule matters (1900 is not a leap
        // year, 2000 is); a leap day is a day.
        Assert.AreEqual(0, StationClock.DaysFromCivil(1970, 1, 1));
        Assert.AreEqual(2, StationClock.DaysFromCivil(2000, 3, 1) - StationClock.DaysFromCivil(2000, 2, 28));
        Assert.AreEqual(1, StationClock.DaysFromCivil(1900, 3, 1) - StationClock.DaysFromCivil(1900, 2, 28));
        Assert.AreEqual(29, StationClock.DaysInMonth(2024, 2));
        Assert.AreEqual(28, StationClock.DaysInMonth(2026, 2));
        Assert.AreEqual(29, StationClock.DaysInMonth(2000, 2));
        Assert.AreEqual(28, StationClock.DaysInMonth(1900, 2));
        Assert.AreEqual(4, StationClock.WeekdayOf(new SimDate(2026, 1, 1)), "2026-01-01 was a Thursday");
        Assert.AreEqual(0, StationClock.WeekdayOf(new SimDate(2026, 1, 4)), "and the 4th a Sunday");
        Assert.AreEqual(4, StationClock.WeekdayOf(new SimDate(2024, 2, 29)));
        foreach (int days in new[] { -100000, -1, 0, 1, 19723, 100000 }) {
            var date = StationClock.CivilFromDays(days);
            Assert.AreEqual(days, StationClock.DaysFromCivil(date.Year, date.Month, date.Day), StationClock.DateKeyOf(date) + " round-trips");
        }
        Assert.AreEqual("0731-02-03", StationClock.DateKeyOf(new SimDate(731, 2, 3)), "the year is padded to four");
    }

    [Test]
    public void MidnightRollsTheDateAndTheDayIndex() {
        var calendar = SimCalendar.Default;
        var last = new StationClock(StationDayData.Default, 86400 - 1).Stamp();
        var midnight = new StationClock(StationDayData.Default, 86400).Stamp();
        Assert.AreEqual("23:59:59", last.ClockSeconds);
        Assert.AreEqual(0, last.DayIndex);
        Assert.AreEqual("00:00:00", midnight.ClockSeconds);
        Assert.AreEqual(1, midnight.DayIndex);
        Assert.AreEqual("2026-01-02", midnight.DateKey);
        Assert.AreEqual(5, midnight.Weekday, "the weekday walked with the date");
        // A time before the epoch reads as an earlier date, not as hour âˆ’1.
        var before = new StationClock(StationDayData.Default, -1).Stamp();
        Assert.AreEqual("23:59:59", before.ClockSeconds);
        Assert.AreEqual("2025-12-31", before.DateKey);
        Assert.AreEqual(-1, before.DayIndex);
        Assert.AreEqual(3, before.Weekday, "2025-12-31 was a Wednesday");
    }

    [Test]
    public void DayTypesComeFromTheCalendarAndTheWeekday() {
        var oracle = Instance();
        var day = DayOf(oracle.input);
        // This document lists 2026-01-05 (a Monday) as a holiday.
        var monday = new StationClock(day, StationClock.SimTimeAtDate(new SimDate(2026, 1, 5), day.Calendar.Epoch, 10 * 3600)).Stamp();
        Assert.AreEqual(1, monday.Weekday, "a holiday is still a Monday");
        Assert.AreEqual(SimDayType.Offday, monday.DayType, "a listed date is éžå·¥ä½œæ—¥ whatever weekday it falls on");
        var tuesday = new StationClock(day, StationClock.SimTimeAtDate(new SimDate(2026, 1, 6), day.Calendar.Epoch, 10 * 3600)).Stamp();
        Assert.AreEqual(SimDayType.Workday, tuesday.DayType);
        var saturday = new StationClock(day, StationClock.SimTimeAtDate(new SimDate(2026, 1, 10), day.Calendar.Epoch, 10 * 3600)).Stamp();
        Assert.AreEqual(SimDayType.Offday, saturday.DayType, "a Saturday is never a å·¥ä½œæ—¥");
        Assert.AreEqual(6, saturday.Weekday);
    }

    [Test]
    public void PeriodsReadTheDocumentsOwnWindows() {
        var oracle = Instance();
        var day = DayOf(oracle.input);
        // The document authors 05:00â€“23:00 and peaks 06:00â€“08:30 / 17:00â€“18:30 â€” not
        // the shipped pair, so this pins that the windows come from the document.
        SimPeriod At(int dayIndex, int hour, int minute) => new StationClock(day,
            dayIndex * 86400 + hour * 3600 + minute * 60).Stamp().Period;
        // Day 4 is 2026-01-05 â€” a listed holiday, so no peak applies even inside the window.
        Assert.AreEqual(SimPeriod.Offpeak, At(4, 7, 0), "an offday runs no é«˜å³°");
        // Day 5 is 2026-01-06, a workday.
        Assert.AreEqual(SimPeriod.Late, At(5, 4, 59), "shut before 05:00");
        Assert.AreEqual(SimPeriod.Late, At(5, 5, 0), "the window opens, but the 夜间 shoulder still runs until 06:30");
        Assert.AreEqual(SimPeriod.Late, At(5, 5, 59), "so an early opening is thin service, not offpeak");
        Assert.AreEqual(SimPeriod.Peak, At(5, 6, 0), "the document's morning peak opens at 06:00");
        Assert.AreEqual(SimPeriod.Offpeak, At(5, 8, 30), "and closes at 08:30");
        Assert.AreEqual(SimPeriod.Peak, At(5, 17, 0), "the evening peak");
        Assert.AreEqual(SimPeriod.Offpeak, At(5, 18, 30));
        Assert.AreEqual(SimPeriod.Late, At(5, 23, 0), "shut from 23:00");
    }

    [Test]
    public void ServiceWindowWrapsPastMidnight() {
        // A document window that reaches the end of the day shuts at 23:59 and stays
        // shut across midnight, then reopens at its own morning start.
        var day = new StationDayData(new DaySpan(22 * 3600, StationClock.ServiceLatest), StationClock.DefaultPeaks,
            DayDemand.Default, SimCalendar.Default);
        var clock = new StationClock(day, 22 * 3600);
        Assert.IsTrue(clock.Stamp().IsOpen, "22:00 opens");
        clock.Seek(StationClock.ServiceLatest - 1);
        Assert.IsTrue(clock.Stamp().IsOpen, "the last open second");
        clock.Seek(StationClock.ServiceLatest);
        Assert.IsFalse(clock.Stamp().IsOpen, "23:59 is shut â€” the span is half-open");
        clock.Seek(86400); // the next day, 00:00
        Assert.IsFalse(clock.Stamp().IsOpen, "and midnight is still the closed station");
        Assert.AreEqual(1, clock.Stamp().DayIndex, "while the day index has moved on");
        clock.Seek(86400 + 22 * 3600);
        Assert.IsTrue(clock.Stamp().IsOpen, "the window reopens the next evening");
        // The overnight reading exists for a caller handed a raw span: 22:00â€“02:00 is
        // open at 23:00 and 01:00 and shut at 12:00. The normalizer never emits one.
        var overnight = new DaySpan(22 * 3600, 2 * 3600);
        Assert.IsTrue(StationClock.WithinSpan(23 * 3600, overnight));
        Assert.IsTrue(StationClock.WithinSpan(3600, overnight));
        Assert.IsFalse(StationClock.WithinSpan(12 * 3600, overnight));
    }

    [Test]
    public void NormalizationMatchesTypeScript() {
        var oracle = Instance();
        var n = oracle.normalization;
        var inverted = StationClock.NormalizeService(new DaySpan(10 * 3600, 9 * 3600));
        Assert.AreEqual(n.serviceInverted.from, inverted.From);
        Assert.AreEqual(n.serviceInverted.to, inverted.To, "an inverted span is pushed to the shortest legal span");
        var outOfRange = StationClock.NormalizeService(new DaySpan(-100, 99 * 3600));
        Assert.AreEqual(n.serviceOutOfRange.from, outOfRange.From);
        Assert.AreEqual(n.serviceOutOfRange.to, outOfRange.To);
        var atEnd = StationClock.NormalizeService(new DaySpan(25 * 3600, 25 * 3600));
        Assert.AreEqual(n.serviceAtDayEnd.from, atEnd.From);
        Assert.AreEqual(n.serviceAtDayEnd.to, atEnd.To, "a start at the end of the day pulls the span back");

        var crossed = StationClock.NormalizePeaks(new DaySpan(8 * 3600, 20 * 3600), new DaySpan(9 * 3600, 10 * 3600));
        Assert.AreEqual(n.peaksCrossed[0].from, crossed.Early.From);
        Assert.AreEqual(n.peaksCrossed[0].to, crossed.Early.To);
        Assert.AreEqual(n.peaksCrossed[1].from, crossed.Late.From, "æ™šé«˜å³° starts where æ—©é«˜å³° ends");
        Assert.AreEqual(n.peaksCrossed[1].to, crossed.Late.To);
        var squeezed = StationClock.NormalizePeaks(new DaySpan(6 * 3600, StationClock.ServiceLatest), new DaySpan(17 * 3600, 19 * 3600));
        Assert.AreEqual(n.peaksSqueezed[0].to, squeezed.Early.To);
        Assert.AreEqual(n.peaksSqueezed[1].from, squeezed.Late.From, "the evening keeps the last quarter hour");
        Assert.AreEqual(n.peaksSqueezed[1].to, squeezed.Late.To);
        Assert.LessOrEqual(squeezed.Early.To, squeezed.Late.From, "the pair is always held in order");

        var clamped = StationClock.NormalizeCalendar(new SimCalendar(
            new SimDate(2026, 2, 30), new[] { "2026-01-01", "not-a-date", "2026-1-1" }));
        Assert.AreEqual(n.calendarClamped.epoch.year, clamped.Epoch.Year);
        Assert.AreEqual(n.calendarClamped.epoch.month, clamped.Epoch.Month);
        Assert.AreEqual(n.calendarClamped.epoch.day, clamped.Epoch.Day, "February has no 30th");
        CollectionAssert.AreEqual(n.calendarClamped.holidays, clamped.Holidays, "junk keys are dropped");
        // A list the document does not carry at all is the shipped one, not an empty list.
        var missing = StationClock.NormalizeCalendar(new SimCalendar(new SimDate(2026, 1, 1), null));
        Assert.AreEqual(n.calendarMissingList.holidays.Length, missing.Holidays.Length);
        Assert.AreEqual(n.calendarMissingList.holidays[0], missing.Holidays[0]);

        var rounded = StationClock.NormalizeDemand(new DemandKnobs(2.567, -1, 9));
        Assert.AreEqual(n.demandRounded.amPeak, rounded.AmPeak, "knobs are clamped and rounded to the slider grain");
        Assert.AreEqual(n.demandRounded.pmPeak, rounded.PmPeak);
        Assert.AreEqual(n.demandRounded.sharpness, rounded.Sharpness);
    }

    [Test]
    public void ClockTextAndParsingMatchTheSource() {
        var oracle = Instance();
        var p = oracle.normalization.secondsOfClock;
        Assert.AreEqual("05:00", StationClock.ClockTextOf(5 * 3600));
        Assert.AreEqual("23:59", StationClock.ClockTextOf(StationClock.ServiceLatest));
        Assert.AreEqual("00:00", StationClock.ClockTextOf(0));
        Assert.AreEqual(p.open, StationClock.SecondsOfClock("05:00"));
        Assert.AreEqual(p.lastMinute, StationClock.SecondsOfClock("23:59"));
        Assert.IsNull(StationClock.SecondsOfClock(""), "the empty box a half-typed input reports");
        Assert.IsNull(StationClock.SecondsOfClock("24:00"), "the day ends at 23:59 — there is no 24 o’clock");
        Assert.AreEqual(6 * 3600 + 30 * 60 + 15, StationClock.SecondsOfClock("06:30:15"));
        Assert.IsNull(StationClock.SecondsOfClock("6:5"));
        Assert.IsNull(StationClock.SecondsOfClock("06:60"));
        Assert.IsNull(StationClock.SecondsOfClock("opening"));
    }

    [Test]
    public void HandsMatchTheFace() {
        // 06:30 â€” the cold boot â€” is the whole difference between a clock face and a
        // plate with two bars laid on it: the hour hand stands halfway past 6.
        var boot = StationClock.ClockHandAngles(StationClock.ReferenceBootSeconds);
        Assert.AreEqual(195, boot.hour, 1e-9);
        Assert.AreEqual(180, boot.minute, 1e-9);
        var three = StationClock.ClockHandAngles(3 * 3600);
        Assert.AreEqual(90, three.hour, 1e-9);
        Assert.AreEqual(0, three.minute, 1e-9);
        // The minute hand carries the seconds, fractionally.
        Assert.AreEqual(273, StationClock.ClockHandAngles(45 * 60 + 30).minute, 1e-9);
        Assert.AreEqual(273.05, StationClock.ClockHandAngles(45 * 60 + 30.5).minute, 1e-9);
        // A time before the epoch reads as the hour it really is.
        var before = StationClock.ClockHandAngles(-3600);
        Assert.AreEqual(330, before.hour, 1e-9);
        // A full day is the same face.
        Assert.AreEqual(StationClock.ClockHandAngles(0).hour, StationClock.ClockHandAngles(86400).hour, 1e-9);
    }

    [Test]
    public void DemandCurveIsTheAuthoredOne() {
        var oracle = Instance();
        var day = DayOf(oracle.input);
        var clock = new StationClock(day, StationClock.ReferenceBootSeconds);
        // The multiplier the spawn reads is the document's curve on the document's period.
        double at = clock.DemandRate(StationClock.ReferenceBootSeconds, false);
        var frame = oracle.scenarios[0].frames[0];
        Assert.AreEqual(frame.demandRate, at, 1e-12, "cold-boot demand comes from the authored offday curve");
        // The demand multiplier is period-scaled, so peak > offpeak on the same shape.
        double peak = clock.DemandRate(5 * 86400 + 7 * 3600, true);
        double offpeak = clock.DemandRate(5 * 86400 + 12 * 3600, true);
        Assert.Greater(peak, offpeak, "07:00 is in this document's peak window, 12:00 is not");
        Assert.Greater(StationClock.DemandShape(8, DemandKnobs.Default), StationClock.DemandShape(3, DemandKnobs.Default));
    }

    [Test]
    public void EditingTheDayMovesWhatTheTimeMeansNotTheInstant() {
        var clock = new StationClock(StationDayData.Default, 3 * 3600);
        Assert.IsFalse(clock.Stamp().IsOpen, "03:00 is before the shipped window opens at 06:30");
        clock.SetDay(new StationDayData(new DaySpan(0, StationClock.ServiceLatest), StationClock.DefaultPeaks,
            DayDemand.Default, SimCalendar.Default));
        Assert.IsTrue(clock.Stamp().IsOpen, "an all-day window opens it");
        Assert.AreEqual(3 * 3600, clock.SimTime, 1e-12, "the edit did not move the clock");
        Assert.AreEqual("03:00:00", clock.Stamp().ClockSeconds);
    }
}