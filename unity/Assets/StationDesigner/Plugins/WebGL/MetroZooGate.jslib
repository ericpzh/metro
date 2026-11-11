mergeInto(LibraryManager.library, {
  MetroZooGateState: function(json) { window.__metroZooGate = JSON.parse(UTF8ToString(json)); },
  MetroZooGateError: function(message) { window.__metroZooGateError = UTF8ToString(message); }
});
