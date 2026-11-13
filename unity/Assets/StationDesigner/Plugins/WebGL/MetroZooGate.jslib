mergeInto(LibraryManager.library, {
  MetroZooGateState__sig: 'vp',
  MetroZooGateState: function(json) { window.__metroZooGate = JSON.parse(UTF8ToString(json)); },
  MetroZooGateError__sig: 'vp',
  MetroZooGateError: function(message) { window.__metroZooGateError = UTF8ToString(message); }
});
