using System;
using System.Collections.Generic;
using Metro.Build;
using Metro.View;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Metro.App {
    /// <summary>
    /// Lead integration for plan 11: every packet's family builder is wrapped as an
    /// <see cref="IStationViewRenderer"/> here and registered once, so the station
    /// host (packet A) draws the same set of records for a demo document as for an
    /// opened save. A renderer draws only its own family, draws nothing for a record
    /// it cannot resolve, and reports the diagnostic instead of inventing geometry.
    /// </summary>
    public sealed class OutdoorModuleRenderer : IStationViewRenderer {
        public string Role => "modules";

        public void Build(StationViewBuildContext context) {
            if (context.Catalogue == null) {
                context.ReportUnresolved("missing-asset", "renderer", Role, "No RuntimeCatalogue on the station host.");
                return;
            }
            var records = context.Document.Modules;
            var facts = new ModuleFacts[records.Count];
            for (int i = 0; i < facts.Length; i++) facts[i] = records[i].Facts;
            OutdoorModuleViews.BuildAll(facts, context.Catalogue, context.RoleRoot(Role),
                (module, view) => context.World.RegisterModule(Role, module.Id, view.Instance, "", null, module.Z, module.Z + 1),
                (module, diagnostic) => context.ReportUnresolved("outdoor", module.Type, module.Id, diagnostic));
        }

        public void Release() { }
    }

    /// <summary>
    /// The document half of painting (plan 11 E3). Packet E resolves and validates a
    /// `face.paint` and returns the writes it would make; this applies those writes to
    /// the committed v1 document and installs it through the host's ordinary atomic
    /// edit transaction, so a paint bumps one revision, is serialized, and can be
    /// refused without touching the station. The handler in `StationCellView` calls it
    /// for any non-empty write set.
    /// </summary>
    public static class StationPaintCommit {
        public static bool TryCommit(JObject reply, out string code) {
            code = null;
            var writes = reply?["writes"] as JArray;
            if (writes == null || writes.Count == 0) return true;
            var host = UnityEngine.Object.FindAnyObjectByType<StationGameHost>();
            if (host == null || !host.IsLoaded) { code = "no-session"; return false; }
            var saved = host.SaveDocument();
            if (string.IsNullOrEmpty(saved)) { code = "no-document"; return false; }
            JObject envelope;
            try { envelope = JObject.Parse(saved); } catch (Exception) { code = "parse-failed"; return false; }
            var cells = (envelope["static"] as JObject)?["cells"] as JArray;
            if (cells == null) { code = "parse-failed"; return false; }
            var byKey = new Dictionary<(int X, int Y, int Z), JObject>();
            foreach (var token in cells) {
                if (!(token is JObject cell)) continue;
                byKey[((int)cell["x"], (int)cell["y"], (int)cell["z"])] = cell;
            }
            foreach (var token in writes) {
                if (!(token is JObject write)) continue;
                if (!(write["cell"] is JArray point) || point.Count < 3) continue;
                int x = (int)point[0], y = (int)point[1], z = (int)point[2];
                string face = (string)write["face"];
                if (string.IsNullOrEmpty(face)) continue;
                if (!byKey.TryGetValue((x, y, z), out var cell)) {
                    // Erasing or painting a record the document does not have: the source
                    // materialises the cell only when the write carries the ground it makes.
                    if (!(write["materialise"] is JObject materialise)) continue;
                    cell = new JObject {
                        ["x"] = x, ["y"] = y, ["z"] = z,
                        ["fill"] = (string)materialise["fill"] ?? "solid",
                    };
                    if (materialise["zone"] != null) cell["zone"] = materialise["zone"].DeepClone();
                    if (materialise["tags"] is JArray tags) cell["tags"] = tags.DeepClone();
                    cells.Add(cell);
                    byKey[(x, y, z)] = cell;
                }
                var finishes = cell["finish"] as JObject;
                if (finishes == null) { finishes = new JObject(); cell["finish"] = finishes; }
                var finish = write["finish"];
                if (finish == null || finish.Type == JTokenType.Null) finishes.Remove(face);
                else finishes[face] = (string)finish;
            }
            var result = host.ApplyDocumentEdit(envelope.ToString(Newtonsoft.Json.Formatting.None), host.CurrentSourceId);
            if (!result.Accepted) { code = result.Rejection?.Code ?? "rejected"; return false; }
            reply["requiresCommit"] = false;
            reply["revision"] = result.Revision;
            return true;
        }
    }

    /// <summary>
    /// The per-frame half of a family renderer: signal lenses and ambient vehicle
    /// poses read the committed station's clock through this sink, so the host does
    /// not need to know the road type. Registered once, like the renderers.
    /// </summary>
    sealed class RoadFrameSink : IStationFrameSink {
        public void Tick(StationDocument document, StationIndex index, StationFrameClock clock) =>
            // The presented instant, not the tick boundary: signals and ambient traffic
            // sample the shared presentation clock (RCA 14 §5.3).
            Metro.App.Views.StationRoadRenderer.Current?.Update(clock.PresentationSeconds);
    }

    /// <summary>
    /// The registration point. It runs before the first scene loads, so the host's
    /// scene needs no per-family wiring and a family added later does not edit the
    /// host. A renderer that needs a scene asset reads it from the build context.
    /// </summary>
    public static class StationFamilyRenderers {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Register() {
            StationRenderers.Add(new OutdoorModuleRenderer());
            // Plan 13 §3: the authored families the Zoo playtest could not see. Each claims
            // its own saved types and reports every module it cannot resolve by name.
            StationRenderers.Add(new Metro.App.Views.StationSurfaceModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationStreetModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationEquipmentModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationDisplayModuleRenderer());
            // Plan 22 §1: the two structure families generated from their saved dimensions. The
            // live registry had no owner for `pillar` or `roof`, so Tanwei's 73 pillars (11 of
            // them bridge piers) and 308 roofs reported `no-renderer` and drew nothing.
            StationRenderers.Add(new Metro.App.Views.StationStructureModuleRenderer());
            StationRenderers.Add(new Metro.App.Views.StationGridRenderer());
            StationRenderers.Add(new Metro.App.Views.StationOverlayRenderer());
            StationFrameSinks.Add(new RoadFrameSink());
        }
    }
}
