/**
 * Тактический сетевой менеджер StrikeTac (v3.0)
 * Единый выделенный сетевой стек на Socket.IO.
 * Полное удаление сторонних брокеров для максимальной надежности и устранения разделения сети.
 * Включает автоматическое переподключение, восстановление сессии при обрыве связи и защиту от задвоения.
 */
const TacticalNetwork = {
  transport: 'socket',
  socket: null,

  lobbyCode: null,
  playerId: null,
  isHost: false,
  isConnected: false,
  isReconnecting: false,
  serverUrl: '',

  eventCallbacks: {},
  localLobbyData: null,

  currentCallsign: '',
  currentPassword: '',
  currentTeamId: 'yellow',
  currentStatus: 'alive',
  currentLat: 55.751244,
  currentLng: 37.618423,
  currentHeading: 0,
  currentSpeed: 0,
  currentAccuracy: 5,

  /**
   * Инициализация постоянного подключения к серверу StrikeTac
   */
  connect(onSuccess, onError) {
    if (this.socket && (this.socket.connected || this.isConnected)) {
      if (onSuccess) onSuccess(this.serverUrl, 'socket');
      return;
    }

    // 1. Определение адреса сервера
    let targetUrl = '';
    if (typeof AppStorage !== 'undefined' && AppStorage.getServerUrl) {
      targetUrl = AppStorage.getServerUrl().trim();
    }
    if (!targetUrl && typeof window !== 'undefined' && window.location && window.location.origin) {
      targetUrl = window.location.origin;
    }

    this.serverUrl = targetUrl;
    console.log('[TacticalNetwork] Подключение к тактическому серверу:', targetUrl);

    if (typeof io === 'undefined') {
      const err = 'Библиотека Socket.IO не загружена!';
      console.error('[TacticalNetwork]', err);
      if (onError) onError(err);
      return;
    }

    try {
      // Закрываем предыдущий сокет если был
      if (this.socket) {
        try { this.socket.disconnect(); } catch (e) {}
      }

      this.socket = io(targetUrl, {
        transports: ['websocket', 'polling'],
        timeout: 8000,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 4000,
        randomizationFactor: 0.3
      });

      let initialResolved = false;

      // Успешное подключение
      this.socket.on('connect', () => {
        this.isConnected = true;
        this.isReconnecting = false;
        console.log('[TacticalNetwork] ✅ Соединение с сервером установлено! Socket ID:', this.socket.id);

        this.trigger('connection:status', true);
        this.trigger('connection:restored');

        // Если боец был в лобби и восстановил связь — автоматически перезаходим в комнату
        if (this.lobbyCode && this.currentCallsign) {
          console.log('[TacticalNetwork] 🔄 Восстановление сессии в лобби #' + this.lobbyCode + '...');
          this.rejoinActiveLobby();
        }

        if (!initialResolved) {
          initialResolved = true;
          if (onSuccess) onSuccess(this.serverUrl, 'socket');
        }
      });

      // Событие реконнекта
      this.socket.io.on('reconnect', (attempt) => {
        console.log(`[TacticalNetwork] 🔄 Успешное переподключение (попытка ${attempt})`);
        this.isConnected = true;
        this.isReconnecting = false;
        this.trigger('connection:status', true);
        this.trigger('connection:restored');
      });

      this.socket.io.on('reconnect_attempt', (attempt) => {
        this.isReconnecting = true;
        this.trigger('connection:reconnecting', attempt);
      });

      this.socket.on('connect_error', (err) => {
        console.warn('[TacticalNetwork] Ошибка связи с сервером:', err.message);
        this.isConnected = false;
        this.trigger('connection:status', false);

        if (!initialResolved) {
          initialResolved = true;
          if (onError) onError(`Не удалось подключиться к серверу (${targetUrl}): ${err.message}`);
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.warn('[TacticalNetwork] ⚠️ Потеря связи с сервером:', reason);
        this.isConnected = false;
        this.trigger('connection:status', false);
        this.trigger('connection:lost', reason);

        // Если сервер принудительно отключил, пробуем переподключиться
        if (reason === 'io server disconnect') {
          this.socket.connect();
        }
      });

      this.bindSocketEvents();

      // Мониторинг нативного статуса сети смартфона
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          console.log('[TacticalNetwork] 🌐 Сеть на устройстве включена, переподключение сокета...');
          if (this.socket && !this.socket.connected) {
            this.socket.connect();
          }
        });
        window.addEventListener('offline', () => {
          console.warn('[TacticalNetwork] 🚫 Сеть на устройстве отключена (нет интернета).');
          this.isConnected = false;
          this.trigger('connection:status', false);
          this.trigger('connection:lost', 'offline');
        });
      }

    } catch (err) {
      console.error('[TacticalNetwork] Ошибка создания сокета:', err);
      if (onError) onError(err.message);
    }
  },

  /**
   * Принудительное переподключение
   */
  reconnect() {
    if (this.socket) {
      this.socket.connect();
    } else {
      this.connect();
    }
  },

  /**
   * Автоматический перезаход в комнату после обрыва связи
   */
  rejoinActiveLobby() {
    if (!this.lobbyCode || !this.socket || !this.socket.connected) return;

    const deviceId = typeof AppStorage !== 'undefined' ? AppStorage.getDeviceId() : null;

    this.socket.emit('lobby:join', {
      code: this.lobbyCode,
      callsign: this.currentCallsign,
      password: this.currentPassword,
      teamId: this.currentTeamId,
      deviceId: deviceId,
      lat: this.currentLat,
      lng: this.currentLng
    }, (res) => {
      if (res && res.success) {
        this.playerId = res.playerId;
        this.localLobbyData = res.lobby;
        console.log(`[TacticalNetwork] ✅ Сессия в лобби #${this.lobbyCode} полностью восстановлена!`);
        this.trigger('lobby:rejoined', res);
      } else {
        console.warn('[TacticalNetwork] Ошибка восстановления в лобби:', res ? res.error : 'нет ответа');
      }
    });
  },

  /**
   * Настройка событий Socket.IO сервера
   */
  bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on('player:joined', (data) => {
      this.trigger('player:joined', data);
    });

    this.socket.on('player:reconnected', (data) => {
      this.trigger('player:reconnected', data);
    });

    this.socket.on('player:moved', (data) => {
      this.trigger('player:moved', data);
    });

    this.socket.on('player:status_changed', (data) => {
      this.trigger('player:status_changed', data);
    });

    this.socket.on('player:offline', (data) => {
      this.trigger('player:offline', data);
    });

    this.socket.on('player:left', (data) => {
      this.trigger('player:left', data);
    });

    this.socket.on('tactical:marker_added', (data) => {
      this.trigger('tactical:marker_added', data);
    });

    this.socket.on('tactical:marker_removed', (data) => {
      this.trigger('tactical:marker_removed', data);
    });

    this.socket.on('team:captain_updated', (data) => {
      this.trigger('team:captain_updated', data);
    });

    this.socket.on('kmz:updated', (data) => {
      this.trigger('kmz:updated', data);
    });

    this.socket.on('lobby:updated', (data) => {
      this.trigger('lobby:updated', data);
    });

    this.socket.on('player:team_changed', (data) => {
      this.trigger('player:team_changed', data);
    });
  },

  /**
   * Создание лобби организатором
   */
  createLobby(data, onSuccess, onError) {
    if (!this.isConnected || !this.socket) {
      if (onError) onError('Нет связи с сервером! Дождитесь подключения.');
      return;
    }

    const deviceId = typeof AppStorage !== 'undefined' ? AppStorage.getDeviceId() : null;

    const payload = {
      name: data.name,
      code: (data.code || '').toUpperCase().trim(),
      password: (data.password || '').trim(),
      callsign: (data.callsign || '').trim(),
      respawnMode: data.respawnMode || 'helicopter',
      respawnTimeMinutes: data.respawnTimeMinutes || 15,
      helicopterIntervalMinutes: data.helicopterIntervalMinutes || 15,
      teamId: data.teamId || 'yellow',
      deviceId: deviceId,
      lat: data.lat || 55.751244,
      lng: data.lng || 37.618423
    };

    this.socket.emit('lobby:create', payload, (res) => {
      if (res && res.error) {
        if (onError) onError(res.error);
      } else if (res && res.success) {
        this.lobbyCode = res.lobbyCode;
        this.playerId = res.playerId;
        this.isHost = true;
        this.currentCallsign = payload.callsign;
        this.currentPassword = payload.password;
        this.currentTeamId = payload.teamId;
        this.localLobbyData = res.lobby;
        if (onSuccess) onSuccess(res);
      } else {
        if (onError) onError('Сервер не вернул подтверждение создания лобби');
      }
    });
  },

  /**
   * Вход в существующее лобби
   */
  joinLobby(data, onSuccess, onError) {
    if (!this.isConnected || !this.socket) {
      if (onError) onError('Нет связи с тактическим сервером! Дождитесь подключения.');
      return;
    }

    const targetCode = (data.code || '').toUpperCase().trim();
    const deviceId = typeof AppStorage !== 'undefined' ? AppStorage.getDeviceId() : null;

    const payload = {
      code: targetCode,
      callsign: (data.callsign || '').trim(),
      password: (data.password || '').trim(),
      teamId: data.teamId || 'yellow',
      deviceId: deviceId,
      lat: data.lat || 55.751244,
      lng: data.lng || 37.618423
    };

    this.socket.emit('lobby:join', payload, (res) => {
      if (res && res.error) {
        if (onError) onError(res.error);
      } else if (res && res.success) {
        this.lobbyCode = targetCode;
        this.playerId = res.playerId;
        this.isHost = res.lobby && res.lobby.players && res.lobby.players[res.playerId] && res.lobby.players[res.playerId].role === 'organizer';
        this.currentCallsign = payload.callsign;
        this.currentPassword = payload.password;
        this.currentTeamId = payload.teamId;
        this.localLobbyData = res.lobby;
        if (onSuccess) onSuccess({ lobbyCode: targetCode, playerId: res.playerId, lobby: res.lobby, isReconnected: res.isReconnected });
      } else {
        if (onError) onError('Неизвестный ответ сервера');
      }
    });
  },

  /**
   * Выход из текущего лобби (кнопка выхода)
   */
  leaveLobby(callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('lobby:leave', () => {
        this.lobbyCode = null;
        this.playerId = null;
        this.localLobbyData = null;
        this.isHost = false;
        if (typeof AppStorage !== 'undefined') {
          AppStorage.clearCurrentLobby();
        }
        if (callback) callback();
      });
      return;
    }

    this.lobbyCode = null;
    this.playerId = null;
    this.localLobbyData = null;
    this.isHost = false;
    if (typeof AppStorage !== 'undefined') {
      AppStorage.clearCurrentLobby();
    }
    if (callback) callback();
  },

  /**
   * Исключение / кик игрока организатором
   */
  kickPlayer(targetPlayerId, callback) {
    if (this.socket && this.isConnected) {
      this.socket.emit('lobby:kick_player', { targetPlayerId }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Отправка GPS координат бойца
   * Поддерживает оба названия метода: sendGPS и updateGPS
   */
  sendGPS(coords) {
    this.updateGPS(coords);
  },

  updateGPS(coords) {
    if (!coords) return;
    this.currentLat = coords.lat;
    this.currentLng = coords.lng;
    this.currentHeading = coords.heading || 0;
    this.currentSpeed = coords.speed || 0;
    this.currentAccuracy = coords.accuracy || 5;

    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('gps:update', coords);
    }
  },

  /**
   * Смена статуса игрока (alive, hit, respawn, malfunction)
   */
  sendStatus(status, callback) {
    this.currentStatus = status;

    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('status:update', { status: status }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Подтверждение выхода из мертвяка
   */
  sendRespawnExit(callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('respawn:confirm_exit', {}, (res) => {
        if (callback) callback(res);
      });
      return;
    }
    this.sendStatus('alive', callback);
  },

  /**
   * Назначение капитана команды организатором
   */
  setCaptain(targetPlayerId, teamId, isCaptain, callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('team:set_captain', { targetPlayerId, teamId, isCaptain }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Смена команды
   */
  changeTeam(newTeamId, callback) {
    this.currentTeamId = newTeamId;
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('team:change', { newTeamId }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Добавление тактической метки
   */
  addTacticalMarker(marker, callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('tactical:add_marker', marker, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Удаление тактической метки
   */
  removeTacticalMarker(markerId, callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('tactical:remove_marker', { markerId }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Рассылка карты полигона (GeoJSON)
   */
  broadcastKMZ(boundaryGeojson, fileName) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('kmz:broadcast', { boundary: boundaryGeojson, fileName });
    }
  },

  /**
   * Загрузка сырого KMZ файла организатором
   */
  uploadKMZ(fileBase64, fileName, callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('kmz:upload', { fileBase64, fileName }, (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Синхронизация таймера вертолета
   */
  syncHelicopter(callback) {
    if (this.socket && this.isConnected && this.lobbyCode) {
      this.socket.emit('helicopter:sync', (res) => {
        if (callback) callback(res);
      });
    }
  },

  /**
   * Подписка на локальные события сети
   */
  on(event, callback) {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = [];
    }
    this.eventCallbacks[event].push(callback);
  },

  off(event, callback) {
    if (!this.eventCallbacks[event]) return;
    this.eventCallbacks[event] = this.eventCallbacks[event].filter(cb => cb !== callback);
  },

  trigger(event, data) {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error('[TacticalNetwork Event Error]', e); }
      });
    }
  }
};

window.TacticalNetwork = TacticalNetwork;
