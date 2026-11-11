using System;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    // Authored-day normalization ported from sim/clock.ts and sim/demand.ts.
    public static class StationDayRepair {
        const int Latest = 86340, MinSpan = 900;
        static readonly string[] Holidays = {"2026-01-01","2026-01-02","2026-01-03","2026-02-15","2026-02-16","2026-02-17","2026-02-18","2026-02-19","2026-02-20","2026-02-21","2026-02-22","2026-02-23","2026-04-04","2026-04-05","2026-04-06","2026-05-01","2026-05-02","2026-05-03","2026-05-04","2026-05-05","2026-06-19","2026-06-20","2026-06-21","2026-09-25","2026-09-26","2026-09-27","2026-10-01","2026-10-02","2026-10-03","2026-10-04","2026-10-05","2026-10-06","2026-10-07"};
        static double Num(JToken t, double fallback) { if (t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float)) return fallback; var n=(double)t; return double.IsNaN(n)||double.IsInfinity(n)?fallback:n; }
        static double Clamp(double n,double min,double max) => Math.Max(min,Math.Min(max,n));
        static double Round(double n) => Math.Floor(n + .5);
        static int Seconds(JToken t, int fallback, int lo, int hi) => (int)Clamp(t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float) ? fallback : Round(Num(t, fallback)/60)*60,lo,hi);
        static JObject Span(JToken raw,int from,int to) { var obj=raw as JObject; int a=Seconds(obj?["from"],from,0,Latest-MinSpan); int b=Seconds(obj?["to"],to,a+MinSpan,Latest); return new JObject {["from"]=a,["to"]=b}; }
        static JObject Knobs(JToken raw,double a,double p,double s) { var o=raw as JObject; double Get(string key,double fallback,double lo,double hi) => Math.Floor(Clamp(Num(o?[key],fallback),lo,hi)*100+.5)/100; return new JObject {["amPeak"]=Get("amPeak",a,0,2.5),["pmPeak"]=Get("pmPeak",p,0,2.5),["sharpness"]=Get("sharpness",s,.4,2)}; }
        public static string RepairJson(string json) {
            var root=JObject.Parse(json); var service=Span(root["service"],23400,84600);
            var peaks=root["peaks"] as JArray; var early=Span(peaks?.Count>0?peaks[0]:null,27000,32400); var late=Span(peaks?.Count>1?peaks[1]:null,63000,68400);
            int end=Math.Min((int)early["to"],Latest-MinSpan); early["to"]=end; early["from"]=Math.Min((int)early["from"],end-MinSpan); int lateFrom=Math.Max((int)late["from"],end); late["from"]=lateFrom; late["to"]=Math.Max((int)late["to"],lateFrom+MinSpan);
            var rawDemand=root["demand"] as JObject; bool split=rawDemand != null && (rawDemand.Property("workday") != null || rawDemand.Property("offday") != null);
            var demand=new JObject {["workday"]=Knobs(split?rawDemand?["workday"]:rawDemand,1,.78,1),["offday"]=Knobs(split?rawDemand?["offday"]:null,.35,.4,1.5)};
            var calendar=root["calendar"] as JObject; var epoch=calendar?["epoch"] as JObject;
            int year=(int)Clamp(Round(Num(epoch?["year"],2026)),1970,2400), month=(int)Clamp(Round(Num(epoch?["month"],1)),1,12);
            int day=(int)Clamp(Round(Num(epoch?["day"],1)),1,DateTime.DaysInMonth(year,month));
            var holidays=new JArray(); if (calendar?.Property("holidays") == null) foreach(var key in Holidays) holidays.Add(key); else if(calendar["holidays"] is JArray list) foreach(var key in list) if(key.Type==JTokenType.String && Regex.IsMatch((string)key,@"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) holidays.Add(key.DeepClone());
            return new JObject {["service"]=service,["peaks"]=new JArray(early,late),["demand"]=demand,["calendar"]=new JObject {["epoch"]=new JObject {["year"]=year,["month"]=month,["day"]=day},["holidays"]=holidays}}.ToString(Formatting.None);
        }
    }
}


