mergeInto(LibraryManager.library, {
  MetroDemoIsZoo__sig: 'i',
  MetroDemoIsZoo: function() { return window.metroLaunch && window.metroLaunch.demoId === 'zoo' ? 1 : 0; },
  MetroDemoLoaded__sig: 'viii',
  MetroDemoLoaded: function(cells,modules,lines) { window.__metroDemoAck = {status:'loaded',id:'zoo',cells:cells,modules:modules,lines:lines}; },
  MetroDemoFailed__sig: 'vp',
  MetroDemoFailed: function(error) { window.__metroDemoAck = {status:'failed',error:UTF8ToString(error)}; }
});
