mergeInto(LibraryManager.library, {
  MetroSaveParityResult__sig: 'vpii',
  MetroSaveParityResult: function (json, cells, modules) {
    window.__metroSaveParity = { status: 'passed', output: UTF8ToString(json), droppedCells: cells, droppedModules: modules };
  },
  MetroSaveParityError__sig: 'vp',
  MetroSaveParityError: function (message) { window.__metroSaveParity = { status: 'failed', error: UTF8ToString(message) }; }
});
