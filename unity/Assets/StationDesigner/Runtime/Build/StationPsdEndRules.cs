using System;
using System.Collections.Generic;

namespace Metro.Build {
    /// <summary>
    /// The 站台门 end panel's snap (`sim/psdEnds.ts` `snapPsdEnd`): a perpendicular return is
    /// seated on the **nearest run endpoint** in its own corner tile, so the end door's glass
    /// meets the screen line instead of floating a few centimetres off it. The panel keeps its
    /// anchor cell  only its local `offset` and the `corner` it belongs to change  which is
    /// also why a snapped panel's clearance is trimmed at the tile boundary.
    ///
    /// A panel with no screen in reach carries the **glass plane** of a neighbouring end panel
    /// across a tile instead, so a row of returns lines up along one plane.
    /// </summary>
    public static class StationPsdEndRules {
        /// <summary>`psdEndOffset`: a corner's length trim applies only when `corner` names a screen.</summary>
        public static void Offset(StationModuleRecord m, out double x, out double y) {
            if (m == null) { x = 0; y = 0; return; }
            x = m.Config.Has("corner") ? m.OffsetX : 0;
            y = m.OffsetY;
        }

        /// <summary>How far an end panel reaches for its screen: 0.8 m, the corner tile.</summary>
        public const double SnapReach = 0.8;

        /// <summary>The screen's height (`cfg.psd`, else its line's, else full).</summary>
        static string ScreenHeight(StationIndex index, StationModuleRecord screen) {
            var own = screen.Config.Text("psd");
            if (!string.IsNullOrEmpty(own)) return own;
            if (index != null) {
                var lineId = screen.Config.Text("line");
                foreach (var line in index.Document.Lines) {
                    if (!string.Equals(line.Id, lineId, StringComparison.Ordinal)) continue;
                    if (!string.IsNullOrEmpty(line.Psd)) return line.Psd;
                }
            }
            return "full";
        }

        /// <summary>
        /// `snapPsdEnd`: seat <paramref name="draft"/> on the nearest screen endpoint, or on the
        /// glass plane a neighbouring panel already holds. Returns true when the draft moved.
        /// </summary>
        public static bool TrySnap(StationIndex index, StationEditDraft draft) {
            if (index == null || draft == null) return false;
            if (!string.Equals(draft.Type, "psd-end", StringComparison.Ordinal)) return false;
            if (string.Equals(draft.Text("variant"), "cover", StringComparison.Ordinal)) return false;
            string psd = draft.Text("psd").Length > 0 ? draft.Text("psd") : "half";
            double bestDistance = SnapReach;
            StationModuleRecord bestScreen = null;
            double bestOffsetX = 0, bestOffsetY = 0;
            foreach (var screen in index.Document.Modules) {
                if (screen == null || screen.Type != "platform-edge") continue;
                if (screen.Z != draft.Z) continue;
                if (!string.Equals(ScreenHeight(index, screen), psd, StringComparison.Ordinal)) continue;
                int relative = StationFootprints.NormRot(screen.Rotation) - StationFootprints.NormRot(draft.Rotation);
                StationFootprints.RotateLocal(relative, 1, 0, out var axisX, out _);
                if (Math.Abs(axisX) > 0.01) continue;
                bool rightSide = string.Equals(screen.Config.Text("side"), "right", StringComparison.Ordinal);
                double toward = rightSide ? 1 : -1;
                StationFootprints.RotateLocal(screen.Rotation, 0, -toward, out var intoX, out var intoY);
                double width = Math.Max(1, screen.Width);
                foreach (var end in new[] { -0.5, width - 0.5 }) {
                    StationFootprints.RotateLocal(screen.Rotation, end, toward * 0.34, out var ex, out var ey);
                    double dx = screen.X + ex - draft.X;
                    double dy = screen.Y + ey - draft.Y;
                    double distance = Math.Sqrt(dx * dx + dy * dy);
                    if (distance >= bestDistance) continue;
                    // Anchor at the glass corner; the panel's span trims its far end to the tile.
                    StationFootprints.RotateLocal(-StationFootprints.NormRot(draft.Rotation),
                        dx + intoX * 0.5, dy + intoY * 0.5, out var cx, out var cy);
                    bestScreen = screen;
                    bestOffsetX = cx;
                    bestOffsetY = cy + 0.34;
                    bestDistance = distance;
                }
            }
            if (bestScreen != null) {
                draft.OffsetX = bestOffsetX;
                draft.OffsetY = bestOffsetY;
                draft.Set("corner", bestScreen.Id);
                return true;
            }
            // A real screen endpoint takes priority over a neighbouring panel's continuation;
            // with none in reach, carry only the glass plane across tiles  never the corner's
            // length trim.
            foreach (var other in index.Document.Modules) {
                if (other == null || other.Type != "psd-end") continue;
                if (string.Equals(other.Config.Text("variant"), "cover", StringComparison.Ordinal)) continue;
                if (string.Equals(other.Id, draft.Id, StringComparison.Ordinal)) continue;
                if (other.Z != draft.Z) continue;
                if (!string.Equals(other.Config.Text("psd"), psd, StringComparison.Ordinal)) continue;
                int relative = StationFootprints.NormRot(other.Rotation) - StationFootprints.NormRot(draft.Rotation);
                StationFootprints.RotateLocal(relative, 1, 0, out var axisX2, out _);
                if (Math.Abs(axisX2) < 0.99) continue;
                StationFootprints.RotateLocal(-StationFootprints.NormRot(draft.Rotation),
                    draft.X - other.X, draft.Y - other.Y, out var along, out var across);
                if (Math.Abs(along - Math.Round(along)) > 1e-9 || Math.Abs(Math.Abs(along) - 1) > 1e-9) continue;
                if (Math.Abs(across) > 1e-9) continue;
                Offset(other, out _, out var oy);
                StationFootprints.RotateLocal(other.Rotation, 0, oy - 0.34, out var gx, out var gy);
                StationFootprints.RotateLocal(draft.Rotation, Math.Round(along), 0, out var stepX, out var stepY);
                StationFootprints.RotateLocal(-StationFootprints.NormRot(draft.Rotation),
                    other.X + gx + stepX - draft.X, other.Y + gy + stepY - draft.Y, out var cx2, out var cy2);
                double distance2 = Math.Sqrt(cx2 * cx2 + cy2 * cy2);
                if (distance2 >= bestDistance) continue;
                draft.OffsetX = 0;
                draft.OffsetY = cy2 + 0.34;
                draft.Config.Remove("corner");
                bestDistance = distance2;
                return true;
            }
            return false;
        }

        /// <summary>
        /// `snapPsdEndCover`: the white cover course attaches to one full-height support  a
        /// screen run under the click, an existing cover, or a full end door. It stacks one
        /// course above its support and copies the support's side and span, so the cover
        /// finishes the column the end door left.
        ///
        /// The end-door-to-cover branch (`fromEnd`) needs that door's trimmed local span; it is
        /// not ported yet, so a cover clicked where only a full end door stands is left
        /// unsnapped rather than guessed at.
        /// </summary>
        public static bool TrySnapCover(StationIndex index, StationEditDraft draft, string preferredId) {
            if (index == null || draft == null) return false;
            if (!string.Equals(draft.Text("variant"), "cover", StringComparison.Ordinal)) return false;
            var modules = index.Document.Modules;
            StationModuleRecord preferred = null;
            if (!string.IsNullOrEmpty(preferredId)) index.TryGetModule(preferredId, out preferred);
            // A direct pick is authoritative: stacked storeys can share a plan cell, so only the
            // module the pointer actually named may be the support.
            if (preferred != null && string.Equals(preferred.Type, "psd-end", StringComparison.Ordinal) &&
                string.Equals(preferred.Config.Text("variant"), "cover", StringComparison.Ordinal)) {
                StackOnCover(draft, preferred);
                return true;
            }
            if (preferred != null && string.Equals(preferred.Type, "psd-end", StringComparison.Ordinal) &&
                !string.Equals(preferred.Config.Text("variant"), "cover", StringComparison.Ordinal) &&
                string.Equals(preferred.Config.Text("psd"), "full", StringComparison.Ordinal)) {
                FromEnd(index, draft, preferred, preferred);
                return true;
            }
            if (preferred != null && string.Equals(preferred.Type, "platform-edge", StringComparison.Ordinal) &&
                string.Equals(ScreenHeight(index, preferred), "full", StringComparison.Ordinal) &&
                Covers(preferred, draft.X, draft.Y)) {
                StackOnScreen(draft, preferred);
                return true;
            }
            if (!string.IsNullOrEmpty(preferredId)) return false;
            StationModuleRecord cover = null;
            foreach (var module in modules) {
                if (module == null || module.Type != "psd-end") continue;
                if (!string.Equals(module.Config.Text("variant"), "cover", StringComparison.Ordinal)) continue;
                if (string.Equals(module.Id, draft.Id, StringComparison.Ordinal)) continue;
                if (module.X != draft.X || module.Y != draft.Y || module.Z != draft.Z) continue;
                if (cover == null || module.Z > cover.Z) cover = module;
            }
            if (cover != null) {
                StackOnCover(draft, cover);
                return true;
            }
            foreach (var screen in modules) {
                if (screen == null || screen.Type != "platform-edge") continue;
                if (screen.Z != draft.Z) continue;
                if (!string.Equals(ScreenHeight(index, screen), "full", StringComparison.Ordinal)) continue;
                if (!Covers(screen, draft.X, draft.Y)) continue;
                StackOnScreen(draft, screen);
                return true;
            }
            return false;
        }

        /// <summary>A cover stacks one course above the cover below it, carrying its own box.</summary>
        static void StackOnCover(StationEditDraft draft, StationModuleRecord support) {
            draft.X = support.X;
            draft.Y = support.Y;
            draft.Z = support.Z + 1;
            draft.Rotation = support.Rotation;
            draft.Set("psd", "full");
            draft.Set("support", support.Id);
            draft.Set("side", support.Config.Text("side").Length > 0 ? support.Config.Text("side") : "left");
            if (support.Config.Has("width")) draft.Set("width", Number(support.Config.Number("width", 1)));
            if (support.Config.Has("depth")) draft.Set("depth", Number(support.Config.Number("depth", 0.24)));
            draft.OffsetX = support.OffsetX;
            draft.OffsetY = support.OffsetY;
        }

        /// <summary>
        /// `fromEnd`: a cover over a full-height **end door** follows that door's trimmed local
        /// span  the door's own offset and span, shortened where its parent screen's corner
        /// crosses it  and stands one storey above the door's top. End doors render on the left
        /// PSD face even when their parent screen is on its right side, so the cover is left.
        /// </summary>
        static void FromEnd(StationIndex index, StationEditDraft draft, StationModuleRecord end,
            StationModuleRecord support) {
            Offset(end, out var ox, out var oy);
            double spanLo = Math.Max(-0.5, -0.5 - ox);
            double spanHi = Math.Min(0.5, 0.5 - ox);
            double minX = spanLo + ox, maxX = spanHi + ox;
            double minY = Math.Max(-0.5, oy - 0.46), maxY = Math.Min(0.5, oy - 0.22);
            StationModuleRecord parent = null;
            var cornerId = end.Config.Text("corner");
            if (!string.IsNullOrEmpty(cornerId) && index != null) index.TryGetModule(cornerId, out parent);
            if (parent != null && string.Equals(parent.Type, "platform-edge", StringComparison.Ordinal)) {
                int relative = StationFootprints.NormRot(parent.Rotation) - StationFootprints.NormRot(end.Rotation);
                StationFootprints.RotateLocal(relative, 1, 0, out var axisX, out _);
                if (Math.Abs(axisX) < 0.01) {
                    double wallY = string.Equals(parent.Config.Text("side"), "right", StringComparison.Ordinal) ? 0.34 : -0.34;
                    double bestX = ox > 0 ? double.NegativeInfinity : double.PositiveInfinity;
                    foreach (var px in new[] { -0.5, Math.Max(1, parent.Width) - 0.5 }) {
                        foreach (var py in new[] { wallY - 0.12, wallY + 0.12 }) {
                            StationFootprints.RotateLocal(parent.Rotation, px, py, out var wx, out var wy);
                            StationFootprints.RotateLocal(-StationFootprints.NormRot(end.Rotation),
                                parent.X + wx - end.X, parent.Y + wy - end.Y, out var lx, out _);
                            if (ox > 0) bestX = Math.Max(bestX, lx);
                            else bestX = Math.Min(bestX, lx);
                        }
                    }
                    if (ox > 0) minX = Math.Max(minX, bestX);
                    else if (ox < 0) maxX = Math.Min(maxX, bestX);
                }
            }
            draft.X = end.X;
            draft.Y = end.Y;
            draft.Z = end.Z + 1 + (int)Math.Round(StationFootprints.PsdFullHeight);
            draft.Rotation = end.Rotation;
            draft.Set("psd", "full");
            draft.Set("support", support.Id);
            draft.Set("width", Number(maxX - minX));
            draft.Set("depth", Number(maxY - minY));
            draft.OffsetX = (minX + maxX) / 2;
            draft.OffsetY = (minY + maxY) / 2 + 0.34;
            draft.Set("side", "left");
        }

        /// <summary>A cover over a full-height screen stands on that screen's column.</summary>
        static void StackOnScreen(StationEditDraft draft, StationModuleRecord screen) {
            draft.Z = screen.Z + 1 + (int)Math.Round(StationFootprints.PsdFullHeight);
            draft.Rotation = screen.Rotation;
            draft.Set("psd", "full");
            draft.Set("support", screen.Id);
            draft.Set("side", screen.Config.Text("side").Length > 0 ? screen.Config.Text("side") : "left");
        }

        /// <summary>`edgeCells(...).some(...)`: is the plan cell one of the screen run's own?</summary>
        static bool Covers(StationModuleRecord screen, int x, int y) {
            int width = Math.Max(1, screen.Width);
            for (int i = 0; i < width; i++) {
                StationFootprints.RotateLocal(screen.Rotation, i, 0, out var dx, out var dy);
                if (screen.X + (int)Math.Round(dx) == x && screen.Y + (int)Math.Round(dy) == y) return true;
            }
            return false;
        }

        static string Number(double value) => value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
    }
}
