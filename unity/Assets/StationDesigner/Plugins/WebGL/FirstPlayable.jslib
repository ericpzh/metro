mergeInto(LibraryManager.library, {
  FirstPlayableDownload: function (ptr) {
    const blob = new Blob([UTF8ToString(ptr)], {type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'first-station.metro.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  FirstPlayableOpen: function () {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => { if (input.files.length) SendMessage('FirstPlayable', 'OpenFile', await input.files[0].text()); };
    input.click();
  },
  FirstPlayableState: function (ptr) { window.firstPlayableState = JSON.parse(UTF8ToString(ptr)); }
});
