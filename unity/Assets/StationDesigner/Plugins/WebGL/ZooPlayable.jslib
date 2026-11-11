mergeInto(LibraryManager.library, {
  ZooPlayableDownload: function (ptr) {
    const url = URL.createObjectURL(new Blob([UTF8ToString(ptr)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edited-zoo.metro.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  ZooPlayableOpen: function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      if (input.files.length) SendMessage('ZooPlayable', 'OpenFile', await input.files[0].text());
    };
    input.click();
  },
  ZooPlayableState: function (ptr) {
    if (!window.zooPlayableState) Module.canvas.addEventListener('contextmenu', event => event.preventDefault());
    window.zooPlayableState = JSON.parse(UTF8ToString(ptr));
    window.dispatchEvent(new CustomEvent('metro:zoo-state', {detail: window.zooPlayableState}));
  },
  ZooPlayablePointerOnCanvas: function (x, y, width, height) {
    const canvas = Module.canvas, rect = canvas.getBoundingClientRect();
    const element = document.elementFromPoint(rect.left + rect.width * x / width, rect.top + rect.height * (1 - y / height));
    return element === canvas;
  }
});
