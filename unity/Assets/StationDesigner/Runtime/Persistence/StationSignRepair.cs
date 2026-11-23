using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Metro.Build;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Metro.Persistence {
    /// <summary>R2 sign repair for explicit front/back boards; legacy component lists fail closed.</summary>
    public static class StationSignRepair {
        const double End=.12, Max=3.5, Min=1, Edge=.006, Row=.2;
        sealed class Item { public JObject value; public double x,width; public int index; }
        static double Numeric(JToken value,string name) {
            if (value==null || (value.Type!=JTokenType.Float && value.Type!=JTokenType.Integer)) throw new NotSupportedException("Invalid sign " + name);
            double n=(double)value; if(double.IsNaN(n)||double.IsInfinity(n)) throw new NotSupportedException("Invalid sign " + name); return n;
        }
        static string Prefix(string value,int count) { var output=new StringBuilder(); int n=0; for(int i=0;i<value.Length && n<count;i++,n++) { output.Append(value[i]); if(char.IsHighSurrogate(value[i]) && i+1<value.Length && char.IsLowSurrogate(value[i+1])) output.Append(value[++i]); } return output.ToString(); }
        static double Measure(string value,double size) { double em=0; for(int i=0;i<value.Length;i++) { int c=char.ConvertToUtf32(value,i); if(c>0xffff)i++; if(c>=0x2e80)em+=1; else if(c==' ')em+=.3; else if(c>='0'&&c<='9')em+=.58; else if(c>='A'&&c<='Z')em+=.68; else if(c>='a'&&c<='z')em+=.55; else em+=.6; } return em*size; }
        static bool HasCjk(string s) => Regex.IsMatch(s,@"[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]");
        static double Width(JObject c) {
            double scale=Math.Min(2,Math.Max(.4,Numeric(c["scale"],"scale"))), width;
            switch((string)c["kind"]) {
                case "arrow": var a=(string)c["arrow"]; width=(a=="uturn-right"||a=="uturn-left" ? .24 : .32)*scale; break;
                case "line": width=.28*scale; break;
                case "icon": width=.2*scale; break;
                case "text":
                    if(c["text"]?.Type!=JTokenType.String) throw new NotSupportedException("Invalid sign text");
                    var lines=Regex.Split((string)c["text"],@"\r?\n").Where(x=>x.Length>0).Take(2).Select(x=>Prefix(x,24)).ToArray();
                    if(lines.Length==0) throw new NotSupportedException("Empty sign text layout requires full sign repair");
                    double size=.107*scale; width=lines.Length==1 ? Measure(lines[0],size*2) : Math.Max(Measure(lines[0],size),Measure(lines[1],size*(HasCjk(lines[1])?1:.5))); break;
                default: throw new NotSupportedException("Unknown sign component");
            }
            return width+.04;
        }
        static double ClampPanel(double want) {
            const double step = 0.05;
            double rounded = Math.Floor((want + 1e-9) / step + 0.5) * step;
            return Math.Round(Math.Min(Max, Math.Max(Min, rounded)), 3);
        }
        static JArray Face(JToken raw) {
            if(raw==null || raw.Type==JTokenType.Null) return new JArray();
            if(!(raw is JArray input)) throw new NotSupportedException("Invalid sign board");
            var values=new List<JObject>(); var seen=new HashSet<string>();
            foreach(var rawItem in input.Take(10)) {
                var c=(rawItem as JObject)?.DeepClone() as JObject ?? throw new NotSupportedException("Invalid sign component");
                if(c["id"]?.Type!=JTokenType.String) throw new NotSupportedException("Invalid sign ID");
                string id=(string)c["id"]; if(id=="") id="c"+(values.Count+1); while(!seen.Add(id)) id+="_"; c["id"]=id;
                Numeric(c["x"],"x"); Numeric(c["y"],"y"); Numeric(c["scale"],"scale"); values.Add(c);
            }
            var items=values.Select((v,i)=>new Item {value=v,index=i,x=Numeric(v["x"],"x"),width=Width(v)}).Where(x=>x.width>0).OrderBy(x=>x.x).ThenBy(x=>x.index).ToArray();
            var occupied=new List<(double left,double right)>();
            foreach(var item in items) {
                double w=item.width, centre=Math.Max(End+w/2,Math.Min(item.x,Max-w/2));
                foreach(var used in occupied.OrderBy(x=>x.left)) if(centre-w/2<used.right && centre+w/2>used.left) centre=used.right+w/2;
                if(centre+w/2>Max) centre=Math.Max(End+w/2,Max-w/2);
                occupied.Add((centre-w/2,centre+w/2)); item.value["x"]=centre; item.value["y"]=Row;
            }
            double left=double.PositiveInfinity,right=0;
            foreach(var c in values) { double w=Width(c); if(w<=0)continue; double x=Numeric(c["x"],"x");left=Math.Min(left,x-w/2);right=Math.Max(right,x+w/2); }
            double panel=right<=0 || double.IsInfinity(left) ? Min : ClampPanel(Math.Max(Min,right-left+End*2));
            double shift=panel<Max && left>=Edge && right>panel-Edge ? (panel-(right-left))/2-left : 0;
            foreach(var c in values) {
                double w=Width(c),half=w/2+Edge,lo=half*2>=panel?panel/2:half,hi=half*2>=panel?panel/2:panel-half;
                c["x"]=Math.Min(hi,Math.Max(lo,Numeric(c["x"],"x")+shift)); c["y"]=Row;
                c["scale"]=Math.Min(2,Math.Max(.4,Numeric(c["scale"],"scale"))); c["side"]="both";
            }
            return new JArray(values);
        }
        public static string NormalizeSaveSignsJson(string json) {
            var doc=JObject.Parse(json); var result=new JArray();
            var modules=doc["static"]?["modules"] as JArray ?? throw new FormatException("Missing modules");
            foreach(var value in modules) if ((string)value["type"] == "sign") result.Add(JObject.Parse(NormalizeJson(value.ToString(Formatting.None))));
            return result.ToString(Formatting.None);
        }
        /// <summary>
        /// `splitSignBoards`: a per-component-era sign names each mark's own face — everything
        /// that is not the right face prints on the front, and the right-face marks are the back.
        /// </summary>
        static (JArray Front, JArray Back) SplitLegacy(JToken components) {
            var front=new JArray(); var back=new JArray();
            if (components is JArray array) foreach (var raw in array) {
                if (raw is not JObject mark) continue;
                (string.Equals((string)mark["side"], "right", StringComparison.Ordinal) ? back : front).Add(mark.DeepClone());
            }
            return (front, back);
        }

        public static string NormalizeJson(string json) {
            var mod=JObject.Parse(json); var cfg=mod["cfg"] as JObject ?? throw new NotSupportedException("Sign config missing");
            JArray front, back;
            if(cfg.Property("front")!=null || cfg.Property("back")!=null) {
                front=Face(cfg["front"]); back=Face(cfg["back"]);
            } else if(cfg.Property("components")!=null) {
                // Shape 3: the per-component era. Each mark's own `side` names its face.
                var split=SplitLegacy(cfg["components"]);
                front=Face(split.Front); back=Face(split.Back);
            } else {
                // Shape 2: a sign written before a board was a document — the default board on
                // the front and an **empty** back, because a back nobody composed should not
                // claim one. The default's line badge needs the document, so a bare
                // `NormalizeJson` prints the line-less board.
                front=Face(JArray.Parse(StationSignLayouts.Default(null))); back=new JArray();
            }
            var next=new JObject {["front"]=front,["back"]=back};
            foreach(string name in new[]{"mount","boothId","boothOffset"}) if(cfg.Property(name)!=null) next[name]=cfg[name].DeepClone();
            mod["cfg"]=next; return mod.ToString(Formatting.None);
        }
    }
}


