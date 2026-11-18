using System;
using System.Diagnostics;
using Metro.Build;
using UnityEngine.Profiling;

namespace Metro.App {
    /// <summary>Player CPU timeline markers plus optional managed allocation samples.
    /// Disabled in engine-free probes; the live host enables native markers on Awake.</summary>
    public static class StationEditProfiling {
        public static bool Enabled;
        /// <summary>Opt-in native command-to-commit and camera-render observations.</summary>
        public static event Action<CommitObservation> CommitSample;

        public readonly struct CommitObservation {
            public readonly string CommandId, SessionId, CommandType, Stage;
            public readonly int BaseRevision, Revision;
            public readonly double Milliseconds;

            internal CommitObservation(string id, string sessionId, string type, int baseRevision, int revision,
                string stage, double milliseconds) {
                CommandId = id;
                SessionId = sessionId;
                CommandType = type;
                BaseRevision = baseRevision;
                Revision = revision;
                Stage = stage;
                Milliseconds = milliseconds;
            }
        }

        internal sealed class CommitTrace {
            readonly string id, sessionId, type;
            readonly int baseRevision;
            readonly long start = Stopwatch.GetTimestamp();
            readonly Action<CommitObservation> sample;
            internal int Revision { get; private set; }

            internal CommitTrace(StationCommand command, int baseRevision, Action<CommitObservation> sample) {
                id = command.Id;
                sessionId = command.SessionId;
                type = command.Type;
                this.baseRevision = baseRevision;
                this.sample = sample;
            }

            internal void Commit(int revision) {
                Revision = revision;
                Mark("authoritative-commit");
            }

            internal void Mark(string stage) {
                double milliseconds = (Stopwatch.GetTimestamp() - start) * 1000d / Stopwatch.Frequency;
                sample(new CommitObservation(id, sessionId, type, baseRevision, Revision, stage, milliseconds));
            }
        }

        internal static CommitTrace ObserveCommit(StationCommand command, int baseRevision) {
            var sample = CommitSample;
            if (sample == null) return null;
            if (command.Type != "edit.undo" && command.Type != "edit.redo" &&
                (command.Type != "pointer.up" || !StationCellTool.HasGesture)) return null;
            return new CommitTrace(command, baseRevision, sample);
        }

        public static Scope Measure(string stage) => new Scope(stage);
        public readonly struct Scope : IDisposable {
            readonly bool enabled;
            readonly StationEditTrace.Scope managed;
            internal Scope(string stage) {
                enabled = Enabled;
                managed = StationEditTrace.Measure(stage);
                if (enabled) Profiler.BeginSample(stage);
            }
            public void Dispose() { if (enabled) Profiler.EndSample(); managed.Dispose(); }
        }
    }
}
