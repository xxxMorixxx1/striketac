/**
 * Модуль локального хранилища StrikeTac
 * Обеспечивает кэширование KMZ карты, настроек и позывного при потере интернета
 */
const AppStorage = {
  KEYS: {
    CALLSIGN: 'striketac_callsign',
    LAST_LOBBY: 'striketac_last_lobby',
    SAVED_KMZ_PREFIX: 'striketac_kmz_',
    PLAYER_SETTINGS: 'striketac_settings',
    SERVER_URL: 'striketac_server_url'
  },

  DEFAULT_SERVER_URL: 'https://striketac-mavik186.amvera.io',

  getServerUrl() {
    return localStorage.getItem(this.KEYS.SERVER_URL) || this.DEFAULT_SERVER_URL;
  },

  setServerUrl(url) {
    if (url !== undefined) {
      localStorage.setItem(this.KEYS.SERVER_URL, (url || '').trim().replace(/\/+$/, ''));
    }
  },

  getCallsign() {
    return localStorage.getItem(this.KEYS.CALLSIGN) || '';
  },

  setCallsign(callsign) {
    if (callsign) {
      localStorage.setItem(this.KEYS.CALLSIGN, callsign.trim());
    }
  },

  getLastLobby() {
    return localStorage.getItem(this.KEYS.LAST_LOBBY) || '';
  },

  setLastLobby(code) {
    if (code) {
      localStorage.setItem(this.KEYS.LAST_LOBBY, code.toUpperCase());
    }
  },

  // Сохранение границ полигона KMZ в память устройства
  saveBoundary(lobbyCode, boundaryGeojson, fileName) {
    try {
      const data = {
        code: lobbyCode,
        fileName: fileName || 'polygon.kmz',
        boundary: boundaryGeojson,
        savedAt: Date.now()
      };
      localStorage.setItem(this.KEYS.SAVED_KMZ_PREFIX + lobbyCode, JSON.stringify(data));
      console.log(`[Кэш] Границы полигона для лобби ${lobbyCode} успешно сохранены на устройство!`);
    } catch (e) {
      console.warn('[Кэш] Превышен лимит памяти хранилища для KMZ:', e);
    }
  },

  // Чтение сохраненных границ полигона (работает даже оффлайн в лесу)
  getBoundary(lobbyCode) {
    try {
      const item = localStorage.getItem(this.KEYS.SAVED_KMZ_PREFIX + lobbyCode);
      if (!item) return null;
      return JSON.parse(item);
    } catch (e) {
      console.error('[Кэш] Ошибка чтения сохраненных границ:', e);
      return null;
    }
  }
};

window.AppStorage = AppStorage;
