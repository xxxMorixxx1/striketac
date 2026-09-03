/**
 * Тактический сетевой менеджер StrikeTac (Cloud Relay v1.2)
 * Работает через защищенный промышленный WSS-шлюз EMQX
 * С непрерывной телеметрией (Presence 3s), валидацией пароля и защитой от рассинхрона
 */
const TacticalNetwork = {
  client: null,
  lobbyCode: null,
  playerId: null,
  isHost: false,
  isConnected: false,
  eventCallbacks: {},
  localLobbyData: null,
  currentCallsign: '',
  currentTeamId: 'yellow',
  currentStatus: 'alive',
  currentLat: 55.751244,
  currentLng: 37.618423,
  currentHeading: 0,
  currentSpeed: 0,
  currentAccuracy: 5,
  presenceInterval: null,

  // Фиксированный глобальный шлюз (без перескакивания)
  BROKER_URL: 'wss://broker.emqx.io:8084/mqtt',

  connect(onSuccess, onError) {
    if (this.client) {
      try { this.client.end(true); } catch(e) {}
    }

    const clientId = 'striketac_' + Math.random().toString(36).substring(2, 10);
    console.log('[Cloud Relay] Подключение к шлюзу:', this.BROKER_URL);

    try {
      this.client = mqtt.connect(this.BROKER_URL, {
        clientId: clientId,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 3000,
        keepalive: 30
      });
    } catch (err) {
      console.error('[Cloud Relay] Ошибка запуска клиента:', err);
      if (onError) onError(err);
      return;
    }

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('[Cloud Relay] Связь со шлюзом EMQX активна!');
      if (this.lobbyCode) {
        this.subscribeLobby(this.lobbyCode);
      }
      if (onSuccess) onSuccess(this.BROKER_URL);
      this.trigger('connect', { broker: this.BROKER_URL });
    });

    this.client.on('reconnect', () => {
      console.log('[Cloud Relay] Переподключение к шлюзу...');
      this.trigger('reconnect');
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.trigger('disconnect');
      if (onError) onError('close');
    });

    this.client.on('error', (err) => {
      console.warn('[Cloud Relay] Сетевая ошибка:', err);
      this.isConnected = false;
      if (onError) onError(err);
    });

    // Прием входящих сообщений
    this.client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        // Игнорируем эхо собственных сообщений
        if (data._senderId && data._senderId === this.playerId) {
          return;
        }
        this.handleIncoming(data);
      } catch (e) {
        console.error('[Cloud Relay] Ошибка парсинга пакета:', e);
      }
    });
  },

  // Подписка на виртуальную комнату лобби
  subscribeLobby(code) {
    this.lobbyCode = code.toUpperCase();
    const topic = 'striketac/' + this.lobbyCode + '/#';
    if (this.client && this.isConnected) {
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.error('[Cloud Relay] Ошибка подписки:', err);
        else console.log('[Cloud Relay] Подписан на комнату:', topic);
      });
    }
  },

  // Отправка события
  publish(action, payload = {}) {
    if (!this.client || !this.isConnected || !this.lobbyCode) {
      return;
    }

    const topic = 'striketac/' + this.lobbyCode + '/' + action;
    const packet = {
      action: action,
      _senderId: this.playerId,
      _timestamp: Date.now(),
      ...payload
    };

    this.client.publish(topic, JSON.stringify(packet), { qos: 0 });
  },

  // Запуск постоянного тактического пинга присутствия (каждые 3 секунды)
  startPresenceLoop() {
    if (this.presenceInterval) clearInterval(this.presenceInterval);

    this.presenceInterval = setInterval(() => {
      if (!this.isConnected || !this.lobbyCode || !this.playerId) return;

      this.publish('player:presence', {
        player: {
          id: this.playerId,
          callsign: this.currentCallsign,
          teamId: this.currentTeamId,
          role: this.isHost ? 'organizer' : 'fighter',
          status: this.currentStatus,
          lat: this.currentLat,
          lng: this.currentLng,
          heading: this.currentHeading,
          speed: this.currentSpeed,
          accuracy: this.currentAccuracy
        }
      });
    }, 3000);
  },

  // Создание лобби (Организатор)
  createLobby(data, callback) {
    this.isHost = true;
    this.lobbyCode = (data.code || 'TAC' + Math.floor(1000 + Math.random() * 9000)).toUpperCase();
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.currentCallsign = data.callsign;
    this.currentTeamId = data.teamId || 'yellow';
    this.currentStatus = 'alive';
    if (data.lat) this.currentLat = data.lat;
    if (data.lng) this.currentLng = data.lng;

    this.subscribeLobby(this.lobbyCode);

    const initialLobby = {
      code: this.lobbyCode,
      name: data.name || 'Тактическая игра',
      password: data.password || '', // Пароль лобби
      respawnMode: data.respawnMode || 'helicopter',
      respawnTimeMinutes: data.respawnTimeMinutes || 15,
      helicopterIntervalMinutes: data.helicopterIntervalMinutes || 15,
      boundary: null,
      boundaryFileName: null,
      tacticalMarkers: [],
      teams: [
        { id: 'yellow', name: 'Желтые', color: '#f59e0b' },
        { id: 'blue', name: 'Синие', color: '#06b6d4' },
        { id: 'green', name: 'Зеленые', color: '#10b981' }
      ],
      players: {
        [this.playerId]: {
          id: this.playerId,
          callsign: data.callsign,
          teamId: this.currentTeamId,
          role: 'organizer',
          status: 'alive',
          lat: this.currentLat,
          lng: this.currentLng,
          heading: 0,
          speed: 0,
          accuracy: 5
        }
      }
    };

    this.localLobbyData = initialLobby;
    this.startPresenceLoop();

    // Анонс входа
    setTimeout(() => {
      this.publish('player:joined', { player: initialLobby.players[this.playerId] });
    }, 300);

    if (callback) {
      callback({
        lobbyCode: this.lobbyCode,
        playerId: this.playerId,
        lobby: initialLobby
      });
    }
  },

  // Подключение к существующему лобби
  joinLobby(data, callback) {
    this.isHost = false;
    this.lobbyCode = data.code.toUpperCase();
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.currentCallsign = data.callsign;
    this.currentTeamId = data.teamId || 'yellow';
    this.currentStatus = 'alive';
    if (data.lat) this.currentLat = data.lat;
    if (data.lng) this.currentLng = data.lng;

    this.subscribeLobby(this.lobbyCode);

    const myPlayer = {
      id: this.playerId,
      callsign: data.callsign,
      teamId: this.currentTeamId,
      role: 'fighter',
      status: 'alive',
      lat: this.currentLat,
      lng: this.currentLng,
      heading: 0,
      speed: 0,
      accuracy: 5
    };

    this.localLobbyData = {
      code: this.lobbyCode,
      name: 'Игра #' + this.lobbyCode,
      password: data.password || '',
      respawnMode: 'helicopter',
      respawnTimeMinutes: 15,
      helicopterIntervalMinutes: 15,
      boundary: null,
      boundaryFileName: null,
      tacticalMarkers: [],
      teams: [
        { id: 'yellow', name: 'Желтые', color: '#f59e0b' },
        { id: 'blue', name: 'Синие', color: '#06b6d4' },
        { id: 'green', name: 'Зеленые', color: '#10b981' }
      ],
      players: {
        [this.playerId]: myPlayer
      }
    };

    this.startPresenceLoop();

    // Запрос синхронизации и валидации пароля у хоста
    setTimeout(() => {
      this.publish('sync:request', {
        requesterPlayerId: this.playerId,
        password: data.password || '',
        player: myPlayer
      });
      this.publish('player:joined', { player: myPlayer });
    }, 400);

    if (callback) {
      callback({
        lobbyCode: this.lobbyCode,
        playerId: this.playerId,
        lobby: this.localLobbyData
      });
    }
  },

  // Обработка входящих пакетов
  handleIncoming(data) {
    const action = data.action;

    // Запрос синхронизации от нового бойца
    if (action === 'sync:request') {
      if (this.localLobbyData) {
        // Проверка пароля, если мы хост
        if (this.isHost && this.localLobbyData.password) {
          if (data.password !== this.localLobbyData.password) {
            console.warn('[Cloud Relay] Неверный пароль от бойца:', data.requesterPlayerId);
            this.publish('sync:rejected', {
              targetPlayerId: data.requesterPlayerId,
              reason: 'Неверный пароль лобби! Доступ запрещен.'
            });
            return;
          }
        }

        // Если пароль верен (или не задан) — отправляем полное состояние лобби
        this.publish('sync:response', {
          targetPlayerId: data.requesterPlayerId,
          lobby: this.localLobbyData
        });
      }
      return;
    }

    // Отклонение авторизации по паролю
    if (action === 'sync:rejected') {
      if (data.targetPlayerId === this.playerId) {
        this.trigger('auth:rejected', { reason: data.reason });
      }
      return;
    }

    // Ответ синхронизации
    if (action === 'sync:response') {
      if (data.targetPlayerId === this.playerId && data.lobby) {
        const remote = data.lobby;
        if (remote.boundary) this.localLobbyData.boundary = remote.boundary;
        if (remote.boundaryFileName) this.localLobbyData.boundaryFileName = remote.boundaryFileName;
        if (remote.tacticalMarkers) this.localLobbyData.tacticalMarkers = remote.tacticalMarkers;
        if (remote.respawnMode) this.localLobbyData.respawnMode = remote.respawnMode;
        if (remote.helicopterIntervalMinutes) this.localLobbyData.helicopterIntervalMinutes = remote.helicopterIntervalMinutes;
        if (remote.password) this.localLobbyData.password = remote.password;

        if (remote.players) {
          Object.values(remote.players).forEach(p => {
            if (p.id !== this.playerId) {
              this.localLobbyData.players[p.id] = p;
              this.trigger('player:joined', { player: p });
            }
          });
        }

        this.trigger('sync:received', this.localLobbyData);
        if (remote.boundary) {
          this.trigger('kmz:updated', { boundary: remote.boundary, fileName: remote.boundaryFileName });
        }
      }
      return;
    }

    // Постоянный пинг присутствия бойцов (Heartbeat Presence)
    if (action === 'player:presence') {
      if (data.player && data.player.id) {
        const p = data.player;
        const isNew = !this.localLobbyData.players[p.id];
        this.localLobbyData.players[p.id] = p;

        if (isNew) {
          this.trigger('player:joined', { player: p });
        } else {
          this.trigger('player:moved', {
            playerId: p.id,
            lat: p.lat,
            lng: p.lng,
            heading: p.heading,
            speed: p.speed,
            accuracy: p.accuracy
          });
          this.trigger('player:status_changed', {
            playerId: p.id,
            callsign: p.callsign,
            teamId: p.teamId,
            status: p.status
          });
        }
      }
      return;
    }

    // Новый игрок подключился
    if (action === 'player:joined') {
      if (this.localLobbyData && data.player) {
        this.localLobbyData.players[data.player.id] = data.player;
      }
      this.trigger('player:joined', data);
      return;
    }

    // Перемещение
    if (action === 'player:moved') {
      if (this.localLobbyData && this.localLobbyData.players[data.playerId]) {
        const p = this.localLobbyData.players[data.playerId];
        p.lat = data.lat;
        p.lng = data.lng;
        p.heading = data.heading;
        p.speed = data.speed;
        p.accuracy = data.accuracy;
      }
      this.trigger('player:moved', data);
      return;
    }

    // Смена статуса
    if (action === 'player:status_changed') {
      if (this.localLobbyData && this.localLobbyData.players[data.playerId]) {
        this.localLobbyData.players[data.playerId].status = data.status;
      }
      this.trigger('player:status_changed', data);
      return;
    }

    // Капитан
    if (action === 'team:captain_updated') {
      if (this.localLobbyData && this.localLobbyData.players[data.targetPlayerId]) {
        this.localLobbyData.players[data.targetPlayerId].role = data.newRole;
      }
      this.trigger('team:captain_updated', data);
      return;
    }

    // Тактические метки
    if (action === 'tactical:marker_added') {
      if (this.localLobbyData) {
        this.localLobbyData.tacticalMarkers.push(data.marker);
      }
      this.trigger('tactical:marker_added', data);
      return;
    }

    if (action === 'tactical:marker_removed') {
      if (this.localLobbyData) {
        this.localLobbyData.tacticalMarkers = this.localLobbyData.tacticalMarkers.filter(m => m.id !== data.markerId);
      }
      this.trigger('tactical:marker_removed', data);
      return;
    }

    // Обновление карты KMZ
    if (action === 'kmz:updated') {
      if (this.localLobbyData) {
        this.localLobbyData.boundary = data.boundary;
        this.localLobbyData.boundaryFileName = data.fileName;
      }
      this.trigger('kmz:updated', data);
      return;
    }

    this.trigger(action, data);
  },

  // Отправка GPS
  sendGPS(coords) {
    this.currentLat = coords.lat;
    this.currentLng = coords.lng;
    this.currentHeading = coords.heading;
    this.currentSpeed = coords.speed;
    this.currentAccuracy = coords.accuracy;

    this.publish('player:moved', {
      playerId: this.playerId,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading,
      speed: coords.speed,
      accuracy: coords.accuracy
    });
  },

  // Смена статуса
  sendStatus(status) {
    this.currentStatus = status;
    if (this.localLobbyData && this.localLobbyData.players[this.playerId]) {
      this.localLobbyData.players[this.playerId].status = status;
    }

    this.publish('player:status_changed', {
      playerId: this.playerId,
      callsign: this.currentCallsign,
      teamId: this.currentTeamId,
      status: status,
      respawnStartTime: status === 'respawn' ? Date.now() : null
    });
  },

  // Назначение капитана
  setCaptain(targetPlayerId, teamId, isCaptain) {
    const newRole = isCaptain ? 'captain' : 'fighter';
    this.publish('team:captain_updated', {
      teamId: teamId,
      captainId: isCaptain ? targetPlayerId : null,
      targetPlayerId: targetPlayerId,
      newRole: newRole
    });
  },

  addTacticalMarker(marker) {
    this.publish('tactical:marker_added', { marker });
  },

  removeTacticalMarker(markerId) {
    this.publish('tactical:marker_removed', { markerId });
  },

  broadcastKMZ(boundaryGeojson, fileName) {
    this.publish('kmz:updated', {
      boundary: boundaryGeojson,
      fileName: fileName
    });
  },

  on(event, callback) {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = [];
    }
    this.eventCallbacks[event].push(callback);
  },

  trigger(event, data) {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].forEach(cb => {
        try { cb(data); } catch(e) { console.error(e); }
      });
    }
  }
};

window.TacticalNetwork = TacticalNetwork;
