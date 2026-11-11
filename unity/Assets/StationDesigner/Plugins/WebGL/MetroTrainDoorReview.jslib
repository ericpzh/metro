mergeInto(LibraryManager.library, {
  MetroTrainDoorFrame: function(phase,time,plusMove,minusMove) {
    window.__metroTrainDoorFrame = {phase:phase,time:time,plusMove:plusMove,minusMove:minusMove};
  }
});
