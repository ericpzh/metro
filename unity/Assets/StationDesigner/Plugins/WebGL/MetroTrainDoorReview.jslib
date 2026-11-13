mergeInto(LibraryManager.library, {
  MetroTrainDoorFrame__sig: 'vifff',
  MetroTrainDoorFrame: function(phase,time,plusMove,minusMove) {
    window.__metroTrainDoorFrame = {phase:phase,time:time,plusMove:plusMove,minusMove:minusMove};
  }
});
