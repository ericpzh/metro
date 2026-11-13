using System;
using System.Collections.Generic;
using System.Text;

namespace Metro.Sim {
    // The station's simulated clock — a port of game/src/sim/clock.ts and the day
    // half of game/src/sim/constants.ts.
    //
    // **The simulation counts seconds; a station lives on a calendar.** `SimTime`
    // is seconds since the station's day zero (`SIM_DAY`-sized), so day 0 is the
    // station's first day and the calendar enters in exactly one place: `StampAt`
    // lays that day on `SimCalendar.Epoch` and derives the date, the weekday and
    // the day type from it. A long run therefore crosses midnight on its own.
    //
    // Two things are authored per station and the rest is derived: the operating
    // hours (`Service`) and the two peak windows (`Peaks`) decide whether the
    // station is open at all and when its peaks land, and `PeriodOf` — the
    // function the dispatcher picks its headway with — reads the very same pair,
    // so a card that prints 已闭站 or 高峰 cannot disagree with the crowd it
    // describes.
    //
    // Pure and deterministic: no wall clock, no `Time.time`, no Unity types
    // (Metro.Sim has no engine references). Cold boot is `ReferenceBootSeconds`
    // (06:30) — the source `REFERENCE_BOOT`/`DEFAULT_SIM_TIME`.
    //
    // Labels are deliberately absent: the React app already owns the localized
    // strings (`stampAt().readout`), so C# publishes structured facts only and
    // the UI derives every printed word from the same `simTime`.

    /// <summary>The two kinds of day the station's demand is authored against (§7.4, §9.6C).</summary>
    public enum SimDayType { Workday = 0, Offday = 1 }

    /// <summary>高峰 / 平峰 / 夜间 — the three periods the timetable keys its headway on (§6.5).</summary>
    public enum SimPeriod { Peak = 0, Offpeak = 1, Late = 2 }

    /// <summary>A civil date in the proleptic Gregorian calendar. <c>Month</c> is 1–12.</summary>
    public struct SimDate : IEquatable<SimDate> {
        public int Year, Month, Day;
        public SimDate(int year, int month, int day) { Year = year; Month = month; Day = day; }
        public bool Equals(SimDate other) => Year == other.Year && Month == other.Month && Day == other.Day;
        public override bool Equals(object obj) => obj is SimDate other && Equals(other);
        public override int GetHashCode() => (Year * 372 + Month) * 31 + Day;
        public override string ToString() => StationClock.DateKeyOf(this);
        public static bool operator ==(SimDate a, SimDate b) => a.Equals(b);
        public static bool operator !=(SimDate a, SimDate b) => !a.Equals(b);
    }

    /// <summary>
    /// A span of the simulated day, in seconds since midnight. One shape for
    /// everything a station authors *about* the day — its opening hours and its two
    /// peak windows — so one normalizer, one day-bar band and one `Contains` serve
    /// all of them (§9.6C).
    /// </summary>
    public struct DaySpan {
        /// <summary>Seconds since midnight the span starts.</summary>
        public int From;
        /// <summary>Seconds since midnight it ends; <c>From &lt; To</c> for an authored span.</summary>
        public int To;
        public DaySpan(int from, int to) { From = from; To = to; }
        public int Length => To - From;
        /// <summary>Is <paramref name="timeOfDay"/> inside the window? Half-open, <c>[From, To)</c>.</summary>
        public bool Contains(int timeOfDay) => StationClock.WithinSpan(timeOfDay, this);
        public bool Contains(double timeOfDay) => StationClock.WithinSpan(timeOfDay, this);
        public override string ToString() => StationClock.ClockTextOf(From) + "-" + StationClock.ClockTextOf(To);
    }

    /// <summary>The station's two peak windows, 早高峰 then 晚高峰 (§9.6C 高峰时段).</summary>
    public struct PeakSpans {
        public DaySpan Early, Late;
        public PeakSpans(DaySpan early, DaySpan late) { Early = early; Late = late; }
        public DaySpan this[int index] => index == 0 ? Early : Late;
        public override string ToString() => Early + "," + Late;
    }

    /// <summary>The three knobs sheet 06's panel D puts in the player's hands (§9.6C 客流曲线).</summary>
    public struct DemandKnobs {
        /// <summary>早高峰量: the 08:00 peak's height. 1 is the reference weekday.</summary>
        public double AmPeak;
        /// <summary>晚高峰量: the 18:00 peak's height.</summary>
        public double PmPeak;
        /// <summary>波形陡峭度: a scale on the peaks' widths.</summary>
        public double Sharpness;
        public DemandKnobs(double amPeak, double pmPeak, double sharpness) { AmPeak = amPeak; PmPeak = pmPeak; Sharpness = sharpness; }
        public static DemandKnobs Default => new DemandKnobs(1, 0.78, 1);
        public static DemandKnobs DefaultOffday => new DemandKnobs(0.35, 0.4, 1.5);
        public override string ToString() => AmPeak + "," + PmPeak + "," + Sharpness;
    }

    /// <summary>The two saved curves: one for 工作日, one for 非工作日.</summary>
    public struct DayDemand {
        public DemandKnobs Workday, Offday;
        public DayDemand(DemandKnobs workday, DemandKnobs offday) { Workday = workday; Offday = offday; }
        public DemandKnobs For(SimDayType type) => type == SimDayType.Workday ? Workday : Offday;
        public static DayDemand Default => new DayDemand(DemandKnobs.Default, DemandKnobs.DefaultOffday);
    }

    /// <summary>The station's calendar: what day 0 is, and which dates are holidays.</summary>
    public struct SimCalendar {
        /// <summary>The civil date <c>simTime = 0</c> stands on, at 00:00 — 第 1 天 of the run.</summary>
        public SimDate Epoch;
        /// <summary>
        /// Holidays as <c>YYYY-MM-DD</c> keys. A date on this list is 非工作日 whatever
        /// weekday it falls on. <c>null</c> means "the document carries no list at all"
        /// during normalization (the shipped list applies); a normalized calendar always
        /// carries an array.
        /// </summary>
        public string[] Holidays;
        public SimCalendar(SimDate epoch, string[] holidays) { Epoch = epoch; Holidays = holidays; }
        public bool IsHoliday(string dateKey) {
            if (Holidays == null) return false;
            for (int i = 0; i < Holidays.Length; i++) if (Holidays[i] == dateKey) return true;
            return false;
        }
        public static SimCalendar Default => new SimCalendar(new SimDate(2026, 1, 1), StationClock.ShippedHolidays());
    }

    /// <summary>
    /// The station's authored day in one plain value: operating hours, the two peak
    /// windows, the two demand curves and the calendar. This is what the integration
    /// layer builds from the committed document (the C# side of
    /// <c>normalizeService</c>/<c>normalizePeaks</c>/<c>normalizeDayDemand</c>/<c>normalizeCalendar</c>)
    /// and hands to <see cref="StationClock"/>.
    /// </summary>
    public struct StationDayData {
        public DaySpan Service;
        public PeakSpans Peaks;
        public DayDemand Demand;
        public SimCalendar Calendar;
        public StationDayData(DaySpan service, PeakSpans peaks, DayDemand demand, SimCalendar calendar) {
            Service = service; Peaks = peaks; Demand = demand; Calendar = calendar;
        }
        /// <summary>What a document that has authored nothing runs: 06:30–23:30, the shipped peaks, the shipped calendar.</summary>
        public static StationDayData Default => StationClock.NormalizeDay(new StationDayData(
            StationClock.DefaultService, StationClock.DefaultPeaks, DayDemand.Default, SimCalendar.Default));
    }

    /// <summary>
    /// Everything a readout needs about one instant of simulated time: the day it
    /// stands on, the time of day to the second, and what that time *means* — open or
    /// shut, and which of the three service periods the timetable is running.
    /// </summary>
    public struct SimStamp {
        /// <summary>The sim seconds this stamp was read at.</summary>
        public double SimTime;
        /// <summary>Whole simulated days since the epoch: 0 on the station's first day.</summary>
        public int DayIndex;
        public SimDate Date;
        /// <summary><c>YYYY-MM-DD</c> — the key a holiday list is indexed by.</summary>
        public string DateKey;
        /// <summary>0 = Sunday … 6 = Saturday, the convention <c>Date.getUTCDay</c> uses.</summary>
        public int Weekday;
        public int Hour, Minute, Second;
        /// <summary>Seconds since midnight, 0 … 86399.</summary>
        public int TimeOfDay;
        /// <summary>How far through the day the clock stands, 0 … 1 — what a day bar draws.</summary>
        public double DayFraction;
        /// <summary><c>HH:MM</c>.</summary>
        public string Clock;
        /// <summary><c>HH:MM:SS</c>.</summary>
        public string ClockSeconds;
        /// <summary>Is the station open at this instant — inside its operating hours?</summary>
        public bool IsOpen;
        /// <summary>The operating hours this stamp was read against (§9.6C 营业时间).</summary>
        public DaySpan Service;
        public SimDayType DayType;
        public SimPeriod Period;
        /// <summary>The timetable is in its 高峰 window (and the day runs peaks at all).</summary>
        public bool Peak => Period == SimPeriod.Peak;
        /// <summary>Degrees clockwise from 12 o'clock, for an in-world clock's hands.</summary>
        public double HourHandDegrees, MinuteHandDegrees;
    }

    /// <summary>
    /// The station clock. Owns one number — <see cref="SimTime"/>, seconds since the
    /// station's day zero — and the authored day it is read against. The session that
    /// owns this clock decides when it advances; the clock never advances itself.
    /// </summary>
    public sealed class StationClock {
        /// <summary>A simulated day, in simulated seconds.</summary>
        public const int SimDaySeconds = 24 * 3600;
        /// <summary>The last minute of a day an operating window may reach: 23:59.</summary>
        public const int ServiceLatest = 23 * 3600 + 59 * 60;
        /// <summary>The shortest operating window a station may be given: 15 minutes.</summary>
        public const int ServiceMinSpan = 15 * 60;
        /// <summary>Cold boot: 06:30, the service opening — <c>DEFAULT_SIM_TIME</c>/<c>REFERENCE_BOOT</c>.</summary>
        public const double ReferenceBootSeconds = 6.5 * 3600;
        /// <summary>The thin-service shoulders of an open day, seconds since midnight.</summary>
        public const int ShoulderOpen = 6 * 3600 + 30 * 60;
        public const int ShoulderClose = 22 * 3600 + 30 * 60;

        public static readonly DaySpan DefaultService = new DaySpan(23400, 84600);
        public static readonly PeakSpans DefaultPeaks = new PeakSpans(new DaySpan(27000, 32400), new DaySpan(63000, 68400));

        /// <summary>Where the two peaks and the midday shelf sit, in hours after midnight.</summary>
        public const double DemandAmHour = 8, DemandPmHour = 18, DemandMiddayHour = 12.5;
        /// <summary>Their widths at <c>sharpness</c> 1, in hours.</summary>
        public const double DemandSigmaAm = 0.85, DemandSigmaPm = 1.05, DemandSigmaMidday = 2.2;
        /// <summary>The overnight floor the peaks rise from, and the midday shelf's height.</summary>
        public const double DemandFloor = 0.06, DemmandMiddayShelf = 0.18;

        SimCalendar calendar;
        DaySpan service;
        PeakSpans peaks;
        DayDemand demand;

        public StationClock() : this(StationDayData.Default, ReferenceBootSeconds) { }
        public StationClock(StationDayData day, double simTime) {
            SetDay(day);
            SimTime = simTime;
        }

        /// <summary>The authored day this clock is read against.</summary>
        public StationDayData Day => new StationDayData(service, peaks, demand, calendar);
        public SimCalendar Calendar => calendar;
        public DaySpan Service => service;
        public PeakSpans Peaks => peaks;
        public DayDemand Demand => demand;
        /// <summary>Seconds since the station's day zero (not a tick count).</summary>
        public double SimTime { get; private set; }

        /// <summary>
        /// Replace the authored day — the edit path. The clock's instant is untouched:
        /// an operating-hours edit changes what the time *means*, not what time it is.
        /// </summary>
        public void SetDay(StationDayData day) {
            var normalized = NormalizeDay(day);
            service = normalized.Service;
            peaks = normalized.Peaks;
            demand = normalized.Demand;
            calendar = normalized.Calendar;
        }

        /// <summary>Move the clock. Negative values read as dates before day 0, like the source.</summary>
        public void Seek(double simTimeSeconds) {
            if (double.IsNaN(simTimeSeconds) || double.IsInfinity(simTimeSeconds))
                throw new ArgumentOutOfRangeException(nameof(simTimeSeconds), "simTime must be finite");
            SimTime = simTimeSeconds;
        }

        /// <summary>Advance the clock by simulated seconds. The session owns the tick; this is the instant.</summary>
        public void Advance(double seconds) {
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) return;
            SimTime += seconds;
        }

        public SimStamp Stamp() => StampAt(SimTime);
        public SimStamp StampAt(double simTimeSeconds) {
            long seconds = (long)Math.Floor(simTimeSeconds);
            var day = DayAt(simTimeSeconds, calendar);
            int timeOfDay = TimeOfDaySeconds(seconds);
            int hour = timeOfDay / 3600;
            int minute = (timeOfDay % 3600) / 60;
            int second = timeOfDay % 60;
            var stamp = new SimStamp {
                SimTime = simTimeSeconds,
                DayIndex = day.DayIndex,
                Date = day.Date,
                DateKey = day.DateKey,
                Weekday = day.Weekday,
                Hour = hour,
                Minute = minute,
                Second = second,
                TimeOfDay = timeOfDay,
                DayFraction = timeOfDay / (double)SimDaySeconds,
                Clock = Pad2(hour) + ":" + Pad2(minute),
                ClockSeconds = Pad2(hour) + ":" + Pad2(minute) + ":" + Pad2(second),
                IsOpen = WithinSpan(timeOfDay, service),
                Service = service,
                DayType = day.DayType,
                // The sim's own period, not a second reading of the windows: the clock
                // can never say 平峰 while the dispatcher is running its peak headway.
                Period = PeriodOf(seconds, service, peaks, day.DayType == SimDayType.Workday),
            };
            var hands = ClockHandAngles(seconds);
            stamp.HourHandDegrees = hands.hour;
            stamp.MinuteHandDegrees = hands.minute;
            return stamp;
        }

        public bool IsOpen => WithinSpan(TimeOfDaySeconds((long)Math.Floor(SimTime)), service);
        public SimPeriod Period => PeriodOf((long)Math.Floor(SimTime), service, peaks, DayType == SimDayType.Workday);
        public SimDayType DayType => DayAt(SimTime, calendar).DayType;

        /// <summary>Degrees clockwise from 12 o'clock, the same derivation the in-world 时钟 uses.</summary>
        public (double hour, double minute) Hands() => ClockHandAngles(SimTime);

        /// <summary>
        /// The demand multiplier the spawn applies at <paramref name="simTimeSeconds"/>:
        /// the day's curve shape scaled by the period the timetable is in. The period is
        /// derived here from the same windows <see cref="StampAt"/> reads.
        /// </summary>
        public double DemandRate(double simTimeSeconds, bool workday) {
            long seconds = (long)Math.Floor(simTimeSeconds);
            var period = PeriodOf(seconds, service, peaks, workday);
            var knobs = workday ? demand.Workday : demand.Offday;
            return DemandAt(HourOfDay(seconds), period, knobs);
        }

        // --------------------------------------------------------------- demand

        /// <summary>The time-of-day curve on its own, before the period scales it.</summary>
        public static double DemandShape(double hour, DemandKnobs knobs) {
            double s = knobs.Sharpness;
            return DemandFloor
                + knobs.AmPeak * Gauss(hour, DemandAmHour, DemandSigmaAm * s)
                + knobs.PmPeak * Gauss(hour, DemandPmHour, DemandSigmaPm * s)
                + DemmandMiddayShelf * Gauss(hour, DemandMiddayHour, DemandSigmaMidday * s);
        }

        /// <summary>The timetable's multiplier (§6.5).</summary>
        public static double PeriodFactor(SimPeriod period) =>
            period == SimPeriod.Peak ? 1 : period == SimPeriod.Offpeak ? 0.6 : 0.25;

        /// <summary>The multiplier the spawn applies at one instant.</summary>
        public static double DemandAt(double hour, SimPeriod period, DemandKnobs knobs) =>
            DemandShape(hour, knobs) * PeriodFactor(period);

        /// <summary>Seconds since midnight as hours (0–24, float).</summary>
        public static double HourOfDay(long seconds) => TimeOfDaySeconds(seconds) / 3600.0;

        static double Gauss(double x, double mu, double sigma) {
            double d = x - mu;
            return Math.Exp(-(d * d) / (2 * sigma * sigma));
        }

        // ---------------------------------------------------------- day / stamp

        /// <summary>The civil day <paramref name="simTimeSeconds"/> stands on.</summary>
        public static SimDay DayAt(double simTimeSeconds, SimCalendar calendar) {
            int dayIndex = (int)Math.Floor(simTimeSeconds / SimDaySeconds);
            long days = DaysFromCivil(calendar.Epoch.Year, calendar.Epoch.Month, calendar.Epoch.Day) + dayIndex;
            var date = CivilFromDays(days);
            int weekday = (int)(Mod(days + 4, 7));
            string dateKey = DateKeyOf(date);
            return new SimDay {
                DayIndex = dayIndex, Date = date, DateKey = dateKey, Weekday = weekday,
                DayType = DayTypeOf(weekday, dateKey, calendar.Holidays),
            };
        }

        /// <summary>The civil day a simulated instant falls on — the calendar half of a stamp.</summary>
        public struct SimDay {
            public int DayIndex;
            public SimDate Date;
            public string DateKey;
            public int Weekday;
            public SimDayType DayType;
        }

        /// <summary>Which of §9.6C's two day types a date is: 非工作日 if listed or a weekend, else 工作日.</summary>
        public static SimDayType DayTypeOf(int weekday, string dateKey, string[] holidays) {
            if (holidays != null) for (int i = 0; i < holidays.Length; i++) if (holidays[i] == dateKey) return SimDayType.Offday;
            if (weekday == 6 || weekday == 0) return SimDayType.Offday;
            return SimDayType.Workday;
        }

        /// <summary>
        /// Which period the timetable is in at <paramref name="simTimeSeconds"/>: shut outside
        /// the station's operating hours, 高峰 inside a peak window, 夜间 on the shoulders,
        /// 平峰 otherwise. Shut is checked first — a station that opens at 08:00 is not in
        /// its 高峰 for the half hour before it opens.
        /// </summary>
        public static SimPeriod PeriodOf(long simTimeSeconds, DaySpan service, PeakSpans peaks, bool workday) {
            int t = TimeOfDaySeconds(simTimeSeconds);
            if (!WithinSpan(t, service)) return SimPeriod.Late;
            if (workday) {
                if (WithinSpan(t, peaks.Early) || WithinSpan(t, peaks.Late)) return SimPeriod.Peak;
            }
            if (t < ShoulderOpen || t >= ShoulderClose) return SimPeriod.Late;
            return SimPeriod.Offpeak;
        }

        public static bool IsOpenAt(int timeOfDay, DaySpan service) => WithinSpan(timeOfDay, service);

        /// <summary>
        /// Is <paramref name="timeOfDay"/> inside <paramref name="span"/>? Half-open,
        /// <c>[from, to)</c>, so an end and a start that meet are one instant.
        ///
        /// A span whose <c>From</c> is after its <c>To</c> is read as an **overnight**
        /// window that wraps past midnight (22:00–02:00). The source normalizer never
        /// emits one — it bends an inverted span into one day, and this port's
        /// <see cref="NormalizeService"/> does the same — so this branch only matters for
        /// a caller that hands the clock a raw span; on every normalized input it is dead
        /// code and the rule is the source's exactly.
        /// </summary>
        public static bool WithinSpan(int timeOfDay, DaySpan span) {
            if (span.From <= span.To) return timeOfDay >= span.From && timeOfDay < span.To;
            return timeOfDay >= span.From || timeOfDay < span.To;
        }
        public static bool WithinSpan(double timeOfDay, DaySpan span) {
            if (span.From <= span.To) return timeOfDay >= span.From && timeOfDay < span.To;
            return timeOfDay >= span.From || timeOfDay < span.To;
        }

        /// <summary>Seconds since midnight, wrapped into one day (a negative time reads as the day before).</summary>
        public static int TimeOfDaySeconds(long simTimeSeconds) => (int)Mod(simTimeSeconds, SimDaySeconds);
        public static double TimeOfDayOf(double simTimeSeconds) => Mod(simTimeSeconds, SimDaySeconds);

        static long Mod(long value, long modulus) {
            long r = value % modulus;
            return r < 0 ? r + modulus : r;
        }
        static double Mod(double value, double modulus) {
            double r = value % modulus;
            return r < 0 ? r + modulus : r;
        }

        /// <summary><c>HH:MM</c> for any seconds-since-midnight, e.g. an operating window's ends.</summary>
        public static string ClockTextOf(double seconds) {
            // JS Math.round is half-up toward +∞ — including negative halves.
            int whole = (int)Mod(SnapRound(seconds), SimDaySeconds);
            return Pad2(whole / 3600) + ":" + Pad2((whole % 3600) / 60);
        }

        /// <summary>
        /// The seconds since midnight an <c>HH:MM</c> (or <c>HH:MM:SS</c>) reads as, or null
        /// when the text is not a time — the one parse behind a time box.
        /// </summary>
        public static int? SecondsOfClock(string text) {
            if (text == null) return null;
            string value = text.Trim();
            int i = 0, h = 0, m = 0, s = 0;
            if (!ReadDigits(value, ref i, 1, 2, out h)) return null;
            if (i >= value.Length || value[i] != ':') return null;
            i++;
            if (!ReadDigits(value, ref i, 2, 2, out m)) return null;
            if (i < value.Length && value[i] == ':') {
                i++;
                if (!ReadDigits(value, ref i, 2, 2, out s)) return null;
            }
            if (i != value.Length) return null;
            if (h > 23 || m > 59 || s > 59) return null;
            return h * 3600 + m * 60 + s;
        }

        static bool ReadDigits(string text, ref int index, int min, int max, out int value) {
            value = 0;
            int start = index;
            while (index < text.Length && index - start < max && text[index] >= '0' && text[index] <= '9') {
                value = value * 10 + (text[index] - '0');
                index++;
            }
            return index - start >= min;
        }

        /// <summary>
        /// Where an analogue clock's two hands stand at <paramref name="seconds"/>, in degrees
        /// clockwise from 12 o'clock. The hour hand carries the minutes and the minute hand
        /// the seconds; the input stays fractional, because a scene sweeps the hands between
        /// snapshots.
        /// </summary>
        public static (double hour, double minute) ClockHandAngles(double seconds) {
            double t = Mod(seconds, SimDaySeconds);
            return (((t % (12 * 3600)) / 3600) * 30, ((t % 3600) / 60) * 6);
        }

        // -------------------------------------------------------------- calendar

        /// <summary>Days since 1970-01-01 for a civil date (Howard Hinnant's <c>days_from_civil</c>).</summary>
        public static long DaysFromCivil(int year, int month, int day) {
            long y = year - (month <= 2 ? 1 : 0);
            long era = (y >= 0 ? y : y - 399) / 400;
            long yoe = y - era * 400;
            long doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
            long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
            return era * 146097 + doe - 719468;
        }

        /// <summary>The civil date <paramref name="days"/> after 1970-01-01 — the inverse of <see cref="DaysFromCivil"/>.</summary>
        public static SimDate CivilFromDays(long days) {
            long z = days + 719468;
            long era = (z >= 0 ? z : z - 146096) / 146097;
            long doe = z - era * 146097;
            long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
            long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            long mp = (5 * doy + 2) / 153;
            long day = doy - (153 * mp + 2) / 5 + 1;
            long month = mp + (mp < 10 ? 3 : -9);
            return new SimDate((int)(yoe + era * 400 + (month <= 2 ? 1 : 0)), (int)month, (int)day);
        }

        /// <summary><c>YYYY-MM-DD</c>: the key the holiday list is indexed by.</summary>
        public static string DateKeyOf(SimDate date) {
            var sb = new StringBuilder(10);
            string year = date.Year.ToString(System.Globalization.CultureInfo.InvariantCulture);
            for (int i = year.Length; i < 4; i++) sb.Append('0');
            sb.Append(year).Append('-').Append(Pad2(date.Month)).Append('-').Append(Pad2(date.Day));
            return sb.ToString();
        }

        /// <summary>The weekday of a date, 0 = Sunday. 1970-01-01 was a Thursday.</summary>
        public static int WeekdayOf(SimDate date) =>
            (int)Mod(DaysFromCivil(date.Year, date.Month, date.Day) + 4, 7);

        /// <summary>How many days a month has.</summary>
        public static int DaysInMonth(int year, int month) {
            int nextYear = month == 12 ? year + 1 : year;
            int nextMonth = month == 12 ? 1 : month + 1;
            return (int)(DaysFromCivil(nextYear, nextMonth, 1) - DaysFromCivil(year, month, 1));
        }

        /// <summary>
        /// The sim seconds at which the clock stands on <paramref name="date"/> at
        /// <paramref name="timeOfDay"/> — the arithmetic behind the 时刻 window's calendar
        /// pick, which **moves the station to that day** rather than relabelling day 0.
        /// </summary>
        public static double SimTimeAtDate(SimDate date, SimDate epoch, double timeOfDay) =>
            (DaysFromCivil(date.Year, date.Month, date.Day) - DaysFromCivil(epoch.Year, epoch.Month, epoch.Day)) * SimDaySeconds + timeOfDay;

        // ---------------------------------------------------------- normalization

        /// <summary>
        /// One span repaired into something the day can hold: both ends inside 00:00–23:59
        /// and at least a quarter of an hour apart. A <c>NaN</c>/infinite end means "missing"
        /// and takes the fallback, exactly as a non-number does in the source load path.
        /// </summary>
        public static DaySpan NormalizeService(DaySpan raw) => NormalizeService(raw.From, raw.To);
        public static DaySpan NormalizeService(double from, double to) {
            int a = ClampSeconds(from, DefaultService.From, 0, ServiceLatest - ServiceMinSpan);
            int b = ClampSeconds(to, DefaultService.To, a + ServiceMinSpan, ServiceLatest);
            return new DaySpan(a, b);
        }
        public static DaySpan NormalizeService(DaySpan raw, DaySpan fallback) => NormalizeService(raw.From, raw.To, fallback);
        public static DaySpan NormalizeService(double from, double to, DaySpan fallback) {
            int a = ClampSeconds(from, fallback.From, 0, ServiceLatest - ServiceMinSpan);
            int b = ClampSeconds(to, fallback.To, a + ServiceMinSpan, ServiceLatest);
            return new DaySpan(a, b);
        }

        /// <summary>
        /// The station's two peak windows, each repaired and the pair held in order:
        /// 早高峰 ends no later than 晚高峰 begins. A morning that runs to the end of the day
        /// leaves the evening the last quarter hour rather than nowhere.
        /// </summary>
        public static PeakSpans NormalizePeaks(PeakSpans raw) => NormalizePeaks(raw.Early, raw.Late);
        public static PeakSpans NormalizePeaks(DaySpan early, DaySpan late) {
            var first = NormalizeSpanWith(early, DefaultPeaks.Early);
            int earlyTo = Math.Min(first.To, ServiceLatest - ServiceMinSpan);
            first = new DaySpan(Math.Min(first.From, earlyTo - ServiceMinSpan), earlyTo);
            var second = NormalizeSpanWith(late, DefaultPeaks.Late);
            int from = Math.Max(second.From, first.To);
            return new PeakSpans(first, new DaySpan(from, Math.Max(second.To, from + ServiceMinSpan)));
        }
        /// <summary>A half-edited pair: a missing second window falls back to the shipped one.</summary>
        public static PeakSpans NormalizePeaks(DaySpan[] raw, PeakSpans fallback) {
            var early = raw != null && raw.Length > 0 ? raw[0] : fallback.Early;
            var late = raw != null && raw.Length > 1 ? raw[1] : fallback.Late;
            var first = NormalizeSpanWith(early, fallback.Early);
            int earlyTo = Math.Min(first.To, ServiceLatest - ServiceMinSpan);
            first = new DaySpan(Math.Min(first.From, earlyTo - ServiceMinSpan), earlyTo);
            var second = NormalizeSpanWith(late, fallback.Late);
            int from = Math.Max(second.From, first.To);
            return new PeakSpans(first, new DaySpan(from, Math.Max(second.To, from + ServiceMinSpan)));
        }

        static DaySpan NormalizeSpanWith(DaySpan raw, DaySpan fallback) {
            int a = ClampSeconds(raw.From, fallback.From, 0, ServiceLatest - ServiceMinSpan);
            int b = ClampSeconds(raw.To, fallback.To, a + ServiceMinSpan, ServiceLatest);
            return new DaySpan(a, b);
        }

        static int ClampSeconds(double value, double fallback, int lo, int hi) {
            if (double.IsNaN(value) || double.IsInfinity(value)) return ClampTo((int)Math.Round(fallback), lo, hi);
            // Whole minutes only: an operating time is authored in the timetable's own unit.
            return ClampTo((int)(Math.Floor(value / 60 + 0.5) * 60), lo, hi);
        }
        static int ClampTo(int v, int lo, int hi) => v < lo ? lo : v > hi ? hi : v;

        /// <summary>
        /// The station's calendar, repaired rather than refused: an epoch that is not a date
        /// falls back to the shipped one, and a key that is not <c>YYYY-MM-DD</c> is dropped.
        /// <paramref name="holidays"/> <c>null</c> means the document carries no list at all
        /// — the shipped 2026 arrangement applies — while an empty array is the player's own
        /// (empty) list.
        /// </summary>
        public static SimCalendar NormalizeCalendar(SimCalendar raw) {
            var epoch = NormalizeDate(raw.Epoch);
            if (raw.Holidays == null) return new SimCalendar(epoch, ShippedHolidays());
            var keys = new List<string>(raw.Holidays.Length);
            for (int i = 0; i < raw.Holidays.Length; i++) {
                string key = raw.Holidays[i];
                if (IsDateKey(key)) keys.Add(key);
            }
            return new SimCalendar(epoch, keys.ToArray());
        }

        static SimDate NormalizeDate(SimDate raw) {
            int year = ClampTo(raw.Year, 1970, 2400);
            int month = ClampTo(raw.Month, 1, 12);
            int day = ClampTo(raw.Day, 1, DaysInMonth(year, month));
            return new SimDate(year, month, day);
        }
        static bool IsDateKey(string key) {
            if (key == null || key.Length != 10) return false;
            for (int i = 0; i < 10; i++) {
                if (i == 4 || i == 7) { if (key[i] != '-') return false; continue; }
                if (key[i] < '0' || key[i] > '9') return false;
            }
            return true;
        }

        /// <summary>
        /// One demand knob repaired into its written range at two decimals — the slider's own
        /// grain. A <c>NaN</c> knob is "missing" and takes the fallback.
        /// </summary>
        public static DemandKnobs NormalizeDemand(DemandKnobs raw) => NormalizeDemand(raw, DemandKnobs.Default);
        public static DemandKnobs NormalizeDemand(DemandKnobs raw, DemandKnobs fallback) => new DemandKnobs(
            Knob(raw.AmPeak, fallback.AmPeak, 0, 2.5),
            Knob(raw.PmPeak, fallback.PmPeak, 0, 2.5),
            Knob(raw.Sharpness, fallback.Sharpness, 0.4, 2));

        /// <summary>
        /// The two curves a document actually holds. A save from before the split carries one
        /// flat set of knobs — that was the 工作日 curve, so it stays the 工作日 one and the
        /// 非工作日 curve is the default. The integration layer passes
        /// <c>hasSplitCurves: false</c> for that legacy shape.
        /// </summary>
        public static DayDemand NormalizeDayDemand(DayDemand raw, bool hasSplitCurves) {
            if (!hasSplitCurves) {
                return new DayDemand(NormalizeDemand(raw.Workday, DemandKnobs.Default), DemandKnobs.DefaultOffday);
            }
            return new DayDemand(
                NormalizeDemand(raw.Workday, DemandKnobs.Default),
                NormalizeDemand(raw.Offday, DemandKnobs.DefaultOffday));
        }

        static double Knob(double value, double fallback, double lo, double hi) {
            if (double.IsNaN(value) || double.IsInfinity(value)) return RoundTo2(ClampTo(fallback, lo, hi));
            return RoundTo2(ClampTo(value, lo, hi));
        }
        static double ClampTo(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;
        static double RoundTo2(double v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

        /// <summary>
        /// Every part of the authored day repaired the way the source load path repairs it.
        ///
        /// One extra case the struct shape forces: a **default-constructed** <see cref="StationDayData"/>
        /// (service and both peaks all zero) is "no day authored at all", not a station that opens
        /// for a quarter of an hour at midnight. The source never has to say this because its load
        /// path takes `undefined` — `normalizeService(undefined)` and `normalizePeaks(undefined)` are
        /// the shipped windows — and a C# struct cannot carry `undefined`, so a host that leaves the
        /// day unset arrives here as zeros. Substituting the shipped day is what keeps an unset host
        /// from silently running a shut station (`late` at every hour) instead of 06:30–23:30.
        /// An authored `{from:0,to:0}` is unaffected because it is only reachable through the
        /// normalizers, which are pinned against the source's own repairs.
        /// </summary>
        public static StationDayData NormalizeDay(StationDayData raw) {
            if (IsUnsetDay(raw)) raw = new StationDayData(DefaultService, DefaultPeaks, DayDemand.Default, SimCalendar.Default);
            return new StationDayData(
                NormalizeService(raw.Service),
                NormalizePeaks(raw.Peaks),
                NormalizeDayDemand(raw.Demand, true),
                NormalizeCalendar(raw.Calendar));
        }

        /// <summary>True for the default-constructed day: nothing authored, no windows and no peaks.</summary>
        public static bool IsUnsetDay(StationDayData day) =>
            day.Service.From == 0 && day.Service.To == 0 &&
            day.Peaks.Early.From == 0 && day.Peaks.Early.To == 0 &&
            day.Peaks.Late.From == 0 && day.Peaks.Late.To == 0;

        /// <summary>国务院办公厅 国办发明电〔2025〕7号 — every 放假 date of the 2026 arrangement.</summary>
        public static string[] ShippedHolidays() => (string[])shippedHolidays.Clone();
        static readonly string[] shippedHolidays = {
            "2026-01-01", "2026-01-02", "2026-01-03",
            "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
            "2026-04-04", "2026-04-05", "2026-04-06",
            "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
            "2026-06-19", "2026-06-20", "2026-06-21",
            "2026-09-25", "2026-09-26", "2026-09-27",
            "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
        };

        // ------------------------------------------------------------------ text

        static string Pad2(int n) => n < 10 ? "0" + n : n.ToString(System.Globalization.CultureInfo.InvariantCulture);
        /// <summary>JS <c>Math.round</c>: halves go toward +∞, unlike .NET's banker's rounding.</summary>
        static double SnapRound(double value) => Math.Floor(value + 0.5);
    }
}
