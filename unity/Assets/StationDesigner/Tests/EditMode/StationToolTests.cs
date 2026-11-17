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
        // The shared UI speaks its own `Tool` union (plan 27 §2): the shell sends these
        // canonical names, and every one must be a request the host takes, otherwise the rail
        // silently desynchronises from the host.
        string[] shell = { "select", "pick", "move", "block", "wall", "delete", "module", "paint", "zone", "rail", "tunnel" };
        string previous = StationToolSelection.Active;
        int generation = StationToolSelection.Generation;
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
            if ((bool)payload["changed"]) generation++;
            Assert.That(StationToolSelection.Generation, Is.EqualTo(generation), shell[i] + " generation");
            previous = shell[i];
        }
    }

    [Test]
    public void TheLegacyFloorAndGateNamesAreNormalizedAtTheHostBoundary() {
        // The shell used `floor` for 方块 and `gate` for the 闸机 tile before the canonical
        // vocabulary (plan 27 §2). An older packaged player must still reach a tool, so the
        // host — not the UI — owns the rename.
        string code, reason;
        var floor = new JObject { ["tool"] = "floor" };
        Assert.That(handler.TryHandle(Command("tool.set"), floor, out code, out reason), Is.True, code);
        Assert.That((string)floor["tool"], Is.EqualTo("block"));
        Assert.That(StationToolSelection.Active, Is.EqualTo("block"));
        // `block` is the block brush the F shortcut selects, and it owns the secondary button.
        Assert.That(StationToolSelection.RightClaim, Is.EqualTo("erase"));

        var gate = new JObject { ["tool"] = "gate" };
        Assert.That(handler.TryHandle(Command("tool.set"), gate, out code, out reason), Is.True, code);
        Assert.That((string)gate["tool"], Is.EqualTo("module"));
        Assert.That((string)gate["settings"]["moduleType"], Is.EqualTo("gate"),
            "the original 闸机 palette entry travels under 设备");
    }

    [Test]
    public void ARightClaimFollowsTheCommittedTool() {
        string code, reason;
        // The block brush digs with the secondary button; a selection tool only cancels on a tap,
        // so the camera keeps owning a right drag there.
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "block" }, out code, out reason);
        Assert.That(StationToolSelection.RightClaim, Is.EqualTo("erase"));
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "select" }, out code, out reason);
        Assert.That(StationToolSelection.RightClaim, Is.EqualTo("cancel"));
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "inspect" }, out code, out reason);
        Assert.That(StationToolSelection.RightClaim, Is.EqualTo("pan"));
    }

    [Test]
    public void SettingsReplaceOnlyTheKeysTheyNameAndBumpTheirOwnGeneration() {
        string code, reason;
        var first = new JObject {
            ["tool"] = "block",
            ["settings"] = new JObject { ["halfWall"] = true, ["wallSnapCycle"] = 2, ["moduleType"] = "bench-steel-1" },
        };
        Assert.That(handler.TryHandle(Command("tool.set"), first, out code, out reason), Is.True, code);
        int generation = StationToolSelection.SettingsGeneration;
        Assert.That(generation, Is.GreaterThan(0), "a settings change is its own generation");
        Assert.That(StationToolSelection.SettingBool("halfWall"), Is.True);
        Assert.That(StationToolSelection.SettingInt("wallSnapCycle", 0), Is.EqualTo(2));
        int toolGeneration = StationToolSelection.Generation;

        // A `Tab` on another tile changes one key and leaves the rest committed.
        var second = new JObject { ["tool"] = "block", ["settings"] = new JObject { ["wallSnapCycle"] = 3 } };
        Assert.That(handler.TryHandle(Command("tool.set"), second, out code, out reason), Is.True, code);
        Assert.That(StationToolSelection.Generation, Is.EqualTo(toolGeneration),
            "a settings-only change never bumps the tool generation");
        Assert.That(StationToolSelection.SettingsGeneration, Is.GreaterThan(generation));
        Assert.That(StationToolSelection.SettingBool("halfWall"), Is.True, "an unnamed key keeps its value");
        Assert.That(StationToolSelection.SettingInt("wallSnapCycle", 0), Is.EqualTo(3));

        // Re-sending the same settings is an accepted no-op that does not bump the generation.
        int after = StationToolSelection.SettingsGeneration;
        var repeat = new JObject { ["tool"] = "block", ["settings"] = new JObject { ["wallSnapCycle"] = 3 } };
        Assert.That(handler.TryHandle(Command("tool.set"), repeat, out code, out reason), Is.True, code);
        Assert.That((bool)repeat["settingsChanged"], Is.False);
        Assert.That(StationToolSelection.SettingsGeneration, Is.EqualTo(after));
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
        handler.TryHandle(Command("tool.set"), new JObject { ["tool"] = "block" }, out code, out reason);
        var payload = new JObject();
        Assert.That(handler.TryHandle(Command("tool.get"), payload, out code, out reason), Is.True);
        Assert.That((string)payload["tool"], Is.EqualTo("block"));
        Assert.That((bool)payload["changed"], Is.False);
        Assert.That((string)payload["rightClaim"], Is.EqualTo("erase"));
        Assert.That(payload["settingsGeneration"].Type, Is.EqualTo(JTokenType.Integer));
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
