const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('petConfigUi', {
  origin: new URLSearchParams(location.search).get('origin') || 'http://127.0.0.1:3080',
});
