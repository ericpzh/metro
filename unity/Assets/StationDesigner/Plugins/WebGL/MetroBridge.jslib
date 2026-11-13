mergeInto(LibraryManager.library, {
  MetroReady__sig: 'v',
  MetroReady: function () { document.documentElement.dataset.metroReady = 'true'; },
  MetroCount__sig: 'vi',
  MetroCount: function (count) { document.documentElement.dataset.metroClicks = String(count); },
  MetroTextChanged__sig: 'vp',
  MetroTextChanged: function (text) { document.documentElement.dataset.metroText = UTF8ToString(text); }
});
