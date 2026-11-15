using Metro.Sim;
using NUnit.Framework;

namespace Metro.Tests {
    /// <summary>
    /// RCA 14 §5 (confirmed sampling cause): the simulation must keep advancing on
    /// whole one-second ticks, but the *presentation* of that tick must be continuous.
    /// The scheduler now publishes the fractional tick it is holding, pausing keeps
    /// that fraction (without banking paused time), and a seek/restart invalidates it.
    /// </summary>
    public sealed class StationMotionPresentationTests {
        static StationSimulationSession Session() => new StationSimulationSession(new StationSessionSetup {
            Document = new StationSessionDocument(),
            Day = StationDayData.Default,
            StartSimTime = 0,
            Speed = 1,
            SessionId = "presentation",
        });

        [Test]
        public void TheSchedulerPublishesTheFractionOfTheNextTick() {
            var session = Session();
            session.SetPlaying(true);
            Assert.AreEqual(0, session.Advance(.4), "four tenths of a second is not a tick");
            Assert.AreEqual(0, session.Tick, "the fixed tick has not advanced");
            Assert.AreEqual(.4, session.PresentationFraction, 1e-9, "the presentation fraction carries the remainder");

            Assert.AreEqual(0, session.Advance(.2));
            Assert.AreEqual(.6, session.PresentationFraction, 1e-9);

            Assert.AreEqual(1, session.Advance(.5), "0.6 + 0.5 crosses one whole tick");
            Assert.AreEqual(1, session.Tick, "the authoritative tick advanced exactly once");
            Assert.AreEqual(1.0, session.Clock.SimTime, 1e-9, "the clock is still whole simulated seconds");
            Assert.AreEqual(.1, session.PresentationFraction, 1e-9, "the leftover tenth is kept for the next frame");
        }

        [Test]
        public void PauseFreezesThePresentedFractionAndBanksNoTime() {
            var session = Session();
            session.SetPlaying(true);
            session.Advance(.5);
            Assert.AreEqual(.5, session.PresentationFraction, 1e-9);

            session.SetPlaying(false);
            double held = session.Clock.SimTime;
            session.Advance(3.5);
            Assert.AreEqual(held, session.Clock.SimTime, 1e-9, "a paused station does not advance");
            Assert.AreEqual(.5, session.PresentationFraction, 1e-9,
                "the presented fraction is frozen where it was, so the pose can be held exactly");

            session.SetPlaying(true);
            Assert.AreEqual(0, session.Advance(.25));
            Assert.AreEqual(.75, session.PresentationFraction, 1e-9,
                "resuming continues the fraction instead of snapping back to the tick boundary");
            Assert.AreEqual(held, session.Clock.SimTime, 1e-9, "the paused 3.5 s were not banked");
        }

        [Test]
        public void ASeekOrRestartInvalidatesThePresentedHistory() {
            var session = Session();
            session.SetPlaying(true);
            session.Advance(.7);
            long epoch = session.PresentationEpoch;

            session.SeekToSimTime(3600);
            Assert.Greater(session.PresentationEpoch, epoch, "a seek must invalidate the interpolation pair");
            Assert.AreEqual(0, session.PresentationFraction, 1e-9, "a seek drops the sub-tick fraction");
            Assert.AreEqual(0, session.Tick, "a seek never fakes a tick");

            epoch = session.PresentationEpoch;
            session.Restart();
            Assert.Greater(session.PresentationEpoch, epoch, "a restart must invalidate the interpolation pair");
        }

        [Test]
        public void SpeedChangesKeepTheFractionInsteadOfSnappingThePose() {
            var session = Session();
            session.SetPlaying(true);
            session.Advance(.5);
            long epoch = session.PresentationEpoch;
            Assert.IsTrue(session.SetSpeed(4));
            // A tick is always one simulated second; only how soon the next one arrives
            // changes. The presented pair is still valid, so no history reset is needed.
            Assert.AreEqual(epoch, session.PresentationEpoch, "a speed change is not a discontinuity");
            Assert.AreEqual(.5, session.PresentationFraction, 1e-9);
            Assert.AreEqual(2, session.Advance(.375), "at 4×, 0.375 real seconds is one and a half ticks on top of the held half");
            Assert.AreEqual(2, session.Tick);
            Assert.AreEqual(.0, session.PresentationFraction, 1e-9);
        }
    }
}
