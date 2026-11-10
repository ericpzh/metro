mergeInto(LibraryManager.library, {
  MetroReady: function () { document.documentElement.dataset.metroReady = 'true'; },
  MetroCount: function (count) { document.documentElement.dataset.metroClicks = String(count); },
  MetroTextChanged: function (text) { document.documentElement.dataset.metroText = UTF8ToString(text); }
});
