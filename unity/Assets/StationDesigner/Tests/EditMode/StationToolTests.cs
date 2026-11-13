using System;
using Metro.App;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

/// <summary>
/// Plan 11 A6: the tool selection is a session-scoped command owned by the host.
/// The rail's click is a request; the host's ack is the state the UI must settle on.
/// These tests use the real handler and the real selection, not a mock.
/// </summary>
public class StationToolTests {
    readonly StationToolCommandHandler handler = new StationToolCommandHandler();

    [SetUp]
    public void SetUp() => StationToolSelection.Reset();

    [TearDown]
    public void TearDown() {
        StationToolSelection.Reset();
        // Remove only this packet's test registration: other suites may rely on the
        // process-wide registrations made at load time.
        StationCommandHandlers.Remove("tool");
    }

    static StationCommand Command(string type) => new StationCommand {
        SchemaVersion = StationCommandRouter.SchemaVersion,
        Id = "tool-test",
        SessionId = "tool-session",
        Type = type,
        Payload = new JObject(),
    };

    [Test]
    public void TheDefaultToolIsInspect() {
        Assert.That(StationToolSelection.Active, Is.EqualTo("inspect"));
        Assert.That(StationToolSelection.Generation, Is.Zero);
        Assert.That(StationToolSelection.IsKnown("inspect"), Is.True);
    }

    [Test]
    public void TheShellsWholeToolVocabularyIsAccepted() {
        // main.tsx maps the rail onto these five names; every one must be a request
        // the host takes, otherwise the rail silently desynchronises from the host.
        string[] shell = { "inspect", "floor", "gate", "paint", "delete" };
        string previous = StationToolSelection.Active;
        for (int i = 0; i < shell.Length; i++) {
            var payload = new JObject { ["tool"] = shell[i] };
            string code, reason;
            Assert.That(handler.TryHandle(Command("tool.set"), payload, out code, out reason), Is.True, shell[i] + " rejected: " + code + " " + reason);
            Assert.That((string)payload["tool"], Is.EqualTo(shell[i]));
            Assert.That((string)payload["previous"], Is.EqualTo(previous));
            // Selecting the tool that is already active is an accepted no-op; every
            // other selection must report that it changed the host's state.
            Assert.That((bool)payload["changed"], Is.EqualTo(!string.Equals(previous, shell[i], StringComparison.Ordinal)),
                shell[i] + " changed flag");
            Assert.That(StationToolSelection.Active, Is.EqualTo(shell[i]));
            previous = shell[i];
        }
        Assert.That(StationToolSelection.Generation, Is.EqualTo(shell.Length - 1),
            "the first selection is the default inspect, so only the other four bump the generation");
    }

    [Test]
    public void SelectingTheSameToolAgainAcksWithoutBumpingTheGeneration() {
        string code, reason;
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "paint" }, out code, out reason);
        int generation = StationToolSelection.Generation;
        var payload = new JObject { ["tool"] = "paint" };
        Assert.That(handler.TryHandle(Command("tool.set"), payload, out code, out reason), Is.True);
        Assert.That((bool)payload["changed"], Is.False);
        Assert.That((string)payload["previous"], Is.EqualTo("paint"));
        Assert.That(StationToolSelection.Generation, Is.EqualTo(generation));
    }

    [Test]
    public void AnUnknownToolIsRejectedAndTheSelectionIsUntouched() {
        string code, reason;
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "delete" }, out code, out reason);
        var payload = new JObject { ["tool"] = "demolish" };
        Assert.That(handler.TryHandle(Command("tool.set"), payload, out code, out reason), Is.False);
        Assert.That(code, Is.EqualTo("unknown-tool"));
        Assert.That(reason, Does.Contain("demolish"));
        Assert.That(StationToolSelection.Active, Is.EqualTo("delete"), "a rejected request must not move the committed tool");
    }

    [Test]
    public void AMissingToolNameIsABadPayload() {
        string code, reason;
        Assert.That(handler.TryHandle(Command("tool.set"), new JObject(), out code, out reason), Is.False);
        Assert.That(code, Is.EqualTo("bad-payload"));
        Assert.That(StationToolSelection.Active, Is.EqualTo("inspect"));
    }

    [Test]
    public void ToolGetPublishesTheCommittedStateAndTheKnownVocabulary() {
        string code, reason;
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "floor" }, out code, out reason);
        var payload = new JObject();
        Assert.That(handler.TryHandle(Command("tool.get"), payload, out code, out reason), Is.True);
        Assert.That((string)payload["tool"], Is.EqualTo("floor"));
        Assert.That((bool)payload["changed"], Is.False);
        Assert.That(payload["known"].Type, Is.EqualTo(JTokenType.Array));
        for (int i = 0; i < StationToolSelection.Known.Length; i++)
            Assert.That(((JArray)payload["known"])[i].ToString(), Is.EqualTo(StationToolSelection.Known[i]));
    }

    [Test]
    public void TheHandlerClaimsOnlyTheToolCommandsAndAdvertisesTheToolCapability() {
        Assert.That(handler.Capability, Is.EqualTo("tool"));
        Assert.That(handler.Handles("tool.set"), Is.True);
        Assert.That(handler.Handles("tool.get"), Is.True);
        Assert.That(handler.Handles("tool.commit"), Is.False);
        Assert.That(handler.Handles("view.set"), Is.False);
    }

    [Test]
    public void TheHandlerRegistersIntoTheProcessWideRegistry() {
        StationCommandHandlers.Add(new StationToolCommandHandler());
        var snapshot = StationCommandHandlers.Snapshot();
        bool found = false;
        for (int i = 0; i < snapshot.Count; i++)
            if (string.Equals(snapshot[i].Capability, "tool", StringComparison.Ordinal)) found = true;
        Assert.That(found, Is.True, "the tool capability must be visible to the router's capabilities payload");
        StationCommandHandlers.Remove("tool");
    }

    [Test]
    public void ResetRestoresTheDefaultSelection() {
        string code, reason;
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "paint" }, out code, out reason);
        StationToolSelection.Reset();
        Assert.That(StationToolSelection.Active, Is.EqualTo("inspect"));
        Assert.That(StationToolSelection.Generation, Is.Zero);
    }
}
