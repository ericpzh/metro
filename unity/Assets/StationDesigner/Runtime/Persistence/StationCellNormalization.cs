using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    // Port of clearCeilingZoneLabels and clearContactFinishes. It operates on a
    // cloned candidate array and never mutates the caller's source JSON.
    public static class StationCellNormalization {
        sealed class Shape { public string kind, side, triangle; public int mask; }
        readonly struct Point { public readonly double x,y,z; public Point(double x,double y,double z){this.x=x;this.y=y;this.z=z;} }
        readonly struct Rect { public readonly double x0,x1,y0,y1; public Rect(double x0,double x1,double y0,double y1){this.x0=x0;this.x1=x1;this.y0=y0;this.y1=y1;} }
        static readonly (string face,int x,int y,int z)[] Directions = { ("e",1,0,0),("w",-1,0,0),("n",0,1,0),("s",0,-1,0),("top",0,0,1),("bottom",0,0,-1) };
        static readonly string[] Sides = { "n", "e", "s", "w" };
        static readonly int[] CornerMasks = { 1,2,4,8 }, HalfMasks = { 3,6,12,9 };
        static bool Tagged(JObject cell,string tag) => cell["tags"] is JArray tags && tags.Any(t => t.Type==JTokenType.String && (string)t==tag);
        static IEnumerable<string> Tags(JObject cell) {
            if (cell["tags"] == null || cell["tags"].Type == JTokenType.Null) yield break;
            if (!(cell["tags"] is JArray tags)) throw new FormatException("Invalid cell tags");
            foreach(var tag in tags) { if(tag.Type!=JTokenType.String)throw new FormatException("Invalid cell tag"); yield return (string)tag; }
        }
        static Shape ShapeOf(JObject cell) => ShapeOfTags(Tags(cell).ToArray());
        static Shape ShapeOfTags(IReadOnlyList<string> tags) {
            int mask=0;
            foreach(var tag in tags) {
                var split=tag.Split(':'); if(split.Length!=2) continue;
                int i=Array.IndexOf(Sides,split[1]); if(i<0)continue;
                if(split[0]=="half-wall")mask |= HalfMasks[i];
                else if(split[0]=="half-corner")mask |= CornerMasks[i];
            }
            if(mask!=0) {
                if(mask==15)return null;
                int h=Array.IndexOf(HalfMasks,mask); if(h>=0)return new Shape{kind="half",side=Sides[h],mask=mask};
                int c=Array.IndexOf(CornerMasks,mask); if(c>=0)return new Shape{kind="corner",side=Sides[c],mask=mask};
                return new Shape{kind="cuts",mask=mask};
            }
            foreach(var tag in tags) {
                var split=tag.Split(':'); if(split.Length!=2 || Array.IndexOf(Sides,split[1])<0)continue;
                if(split[0]=="tri-upper" || split[0]=="tri-lower")return new Shape{kind="triangle",side=split[1],triangle=split[0]=="tri-upper"?"upper":"lower"};
            }
            return null;
        }
        static List<Rect> Rectangles(int mask) {
            var result=new List<Rect>(); int north=mask&3,south=mask&12;
            if(north!=0) result.Add(new Rect((north&1)!=0?0:.5,(north&2)!=0?1:.5,.5,1));
            if(south!=0) result.Add(new Rect((south&8)!=0?0:.5,(south&4)!=0?1:.5,0,.5));
            return result;
        }
        static Rect Bounds(Shape s) {
            if(s==null || s.kind=="triangle")return new Rect(0,1,0,1);
            var rects=Rectangles(s.mask);
            return new Rect(rects.Min(r=>r.x0),rects.Max(r=>r.x1),rects.Min(r=>r.y0),rects.Max(r=>r.y1));
        }
        static bool Contains(Shape s,Point p) {
            if(s==null)return true;
            if(s.kind=="triangle") {
                double h=s.side=="n"?p.y:s.side=="s"?1-p.y:s.side=="e"?p.x:1-p.x;
                return s.triangle=="upper"?p.z<=h:p.z>=1-h;
            }
            if(s.kind=="cuts") {
                if(p.z < -1e-9 || p.z > 1+1e-9 || p.x < -1e-9 || p.x > 1+1e-9 || p.y < -1e-9 || p.y > 1+1e-9)return false;
                int corner=p.y>=.5?(p.x>=.5?2:1):(p.x>=.5?4:8);
                return (s.mask&corner)!=0;
            }
            var b=Bounds(s);return p.x>=b.x0&&p.x<=b.x1&&p.y>=b.y0&&p.y<=b.y1;
        }
        static bool InnerFace(int m,string f) {
            bool n=(m&1)!=0,e=(m&2)!=0,s=(m&4)!=0,w=(m&8)!=0;
            return f=="e"?(n&&!e)||(w&&!s):f=="w"?(e&&!n)||(s&&!w):f=="n"?(w&&!n)||(s&&!e):f=="s"?(n&&!w)||(e&&!s):false;
        }
        static void Push(List<Point> points,double x0,double x1,double y0,double y1,double z0,double z1) {
            foreach(double x in new[]{x0,x1})foreach(double y in new[]{y0,y1})foreach(double z in new[]{z0,z1})points.Add(new Point(x,y,z));
        }
        static List<Point> Boundary(Shape s,string face) {
            var points=new List<Point>();
            if(s?.kind=="triangle" && (s.triangle=="upper"?"top":"bottom")==face)return points;
            if(s?.kind=="cuts") {
                foreach(var r in Rectangles(s.mask)) {
                    if(face=="top"||face=="bottom") { double z=face=="top"?1:0;Push(points,r.x0,r.x1,r.y0,r.y1,z,z); }
                    else if(face=="n"&&r.y1==1)Push(points,r.x0,r.x1,1,1,0,1);
                    else if(face=="s"&&r.y0==0)Push(points,r.x0,r.x1,0,0,0,1);
                    else if(face=="e"&&r.x1==1)Push(points,1,1,r.y0,r.y1,0,1);
                    else if(face=="w"&&r.x0==0)Push(points,0,0,r.y0,r.y1,0,1);
                }
                return points;
            }
            var b=Bounds(s);
            if((face=="e"&&b.x1<1)||(face=="w"&&b.x0>0)||(face=="n"&&b.y1<1)||(face=="s"&&b.y0>0))return points;
            double[] xs=face=="e"?new[]{1d}:face=="w"?new[]{0d}:new[]{b.x0,b.x1};
            double[] ys=face=="n"?new[]{1d}:face=="s"?new[]{0d}:new[]{b.y0,b.y1};
            double[] zs=face=="top"?new[]{1d}:face=="bottom"?new[]{0d}:new[]{0d,1d};
            foreach(var x in xs)foreach(var y in ys)foreach(var z in zs) {var p=new Point(x,y,z);if(Contains(s,p))points.Add(p);}
            if(points.Count<3)points.Clear();return points;
        }
        static bool Covered(Shape shape,Shape neighbour,(string face,int x,int y,int z) d) {
            if(shape?.kind=="cuts"&&InnerFace(shape.mask,d.face))return false;
            var points=Boundary(shape,d.face);return points.Count>0&&points.All(p=>Contains(neighbour,new Point(p.x-d.x,p.y-d.y,p.z-d.z)));
        }
        static (double,double,double) Coordinates(JObject c) => ((double)c["x"],(double)c["y"],(double)c["z"]);
        public static string NormalizeJson(string json) {
            var cells=JArray.Parse(json);var solids=new Dictionary<(double,double,double),Shape>();
            foreach(var value in cells) {
                if(!(value is JObject c))throw new FormatException("Invalid cell");
                if((string)c["fill"]=="solid"&&!Tagged(c,"suspended-ceiling"))solids[Coordinates(c)]=ShapeOf(c);
            }
            foreach(JObject c in cells) {
                if(Tagged(c,"suspended-ceiling")||Tagged(c,"opening-ceiling")){c.Remove("zone");c.Remove("room");}
                if((string)c["fill"]!="solid" || c["finish"]==null || c["finish"].Type==JTokenType.Null || Tagged(c,"suspended-ceiling"))continue;
                if(!(c["finish"] is JObject finish))throw new FormatException("Invalid cell finish");
                var (x,y,z)=Coordinates(c);var shape=ShapeOf(c);bool changed=false;
                foreach(var d in Directions) {
                    if(finish.Property(d.face)==null||!solids.TryGetValue((x+d.x,y+d.y,z+d.z),out var neighbour)||!Covered(shape,neighbour,d))continue;
                    finish.Remove(d.face);changed=true;
                }
                if(changed&&!finish.HasValues)c.Remove("finish");
            }
            return cells.ToString(Formatting.None);
        }

        /// <summary>
        /// The **per-cell** rule <see cref="NormalizeJson"/> applies: strip the faces a solid
        /// neighbour fully covers and clear a suspended ceiling's zone/room labels.
        /// <paramref name="neighbourAt"/> answers the cell record at one coordinate (null when the
        /// coordinate is absent or not solid), so a local edit can normalise exactly the records
        /// it touched — the written cells and their six neighbours — without re-walking the
        /// station (plan 30 §3). The rule is the same one the open path runs; the two are pinned
        /// against each other by <c>StationLocalEditTests</c>.
        /// </summary>
        internal static void NormalizeCellRecord(JObject cell, Func<int,int,int,Metro.Build.StationCellRecord> neighbourAt) {
            if (cell == null) return;
            if (Tagged(cell,"suspended-ceiling")||Tagged(cell,"opening-ceiling")) { cell.Remove("zone"); cell.Remove("room"); }
            if ((string)cell["fill"]!="solid" || cell["finish"]==null || cell["finish"].Type==JTokenType.Null ||
                Tagged(cell,"suspended-ceiling")) return;
            if (!(cell["finish"] is JObject finish)) throw new FormatException("Invalid cell finish");
            var (x,y,z)=Coordinates(cell); var shape=ShapeOf(cell); bool changed=false;
            foreach (var d in Directions) {
                if (finish.Property(d.face)==null) continue;
                var neighbour = neighbourAt((int)x+d.x,(int)y+d.y,(int)z+d.z);
                if (neighbour == null || !neighbour.IsSolid || neighbour.HasTag("suspended-ceiling")) continue;
                if (!Covered(shape, ShapeOfTags(neighbour.Tags), d)) continue;
                finish.Remove(d.face); changed=true;
            }
            if (changed && !finish.HasValues) cell.Remove("finish");
        }
    }
}
