/**
 * Тактический сетевой менеджер StrikeTac (Cloud Relay)
 * Работает через глобальный защищенный ретранслятор MQTT over WSS (EMQX / HiveMQ)
 * Обеспечивает мгновенную синхронизацию на любых расстояниях 24/7 БЕЗ серверов и ПК
 */
const TacticalNetwork = {
  client: null,
  lobbyCode: null,
  playerId: null,
  isHost: false,
  isConnected: false,
  activeBrokerIndex: 0,
  eventCallbacks: {},
  localLobbyData: null,
  currentCallsign: '',
  currentTeamId: 'yellow',

  // Список глобальных защищенных брокеров с авто-переключением
  BROKERS: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ],

  // Подключение к облачному ретранслятору
  connect(onSuccess, onError) {
    if (this.client) {
      try { this.client.end(true); } catch(e) {}
    }

    const brokerUrl = this.BROKERS[this.activeBrokerIndex];
    const clientId = 'striketac_' + Math.random().toString(36).substring(2, 10);
    console.log('[Cloud Relay] Подключение к брокеру:', brokerUrl);

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 4000,
        keepalive: 30
      });
    } catch (err) {
      console.error('[Cloud Relay] Ошибка запуска MQTT клиента:', err);
      this.switchBroker();
      return;
    }

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('[Cloud Relay] Связь с облачным ретранслятором установлена! Брокер:', brokerUrl);
      if (this.lobbyCode) {
        this.subscribeLobby(this.lobbyCode);
      }
      if (onSuccess) onSuccess(brokerUrl);
      this.trigger('connect', { broker: brokerUrl });
    });

    this.client.on('reconnect', () => {
      console.log('[Cloud Relay] Переподключение к ретранслятору...');
    });

    this.client.on('close', () => {
      this.isConnected = false;
      this.trigger('disconnect');
      if (onError) onError('close');
    });

    this.client.on('error', (err) => {
      console.warn('[Cloud Relay] Ошибка связи:', err);
      this.isConnected = false;
      this.switchBroker();
      if (onError) onError(err);
    });

    // Обработка входящих пакетов
    this.client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        // Игнорируем эхо собственных сообщений
        if (data._senderId && data._senderId === this.playerId) {
          return;
        }
        this.handleIncoming(data);
      } catch (e) {
        console.error('[Cloud Relay] Ошибка чтения пакета:', e);
      }
    });
  },

  switchBroker() {
    this.activeBrokerIndex = (this.activeBrokerIndex + 1) % this.BROKERS.length;
    console.warn('[Cloud Relay] Переключение на резервный шлюз:', this.BROKERS[this.activeBrokerIndex]);
    setTimeout(() => {
      this.connect();
    }, 2000);
  },

  // Подписка на виртуальную комнату лобби
  subscribeLobby(code) {
    this.lobbyCode = code.toUpperCase();
    const topic = 'striketac/' + this.lobbyCode + '/#';
    if (this.client && this.isConnected) {
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.error('[Cloud Relay] Ошибка подписки на комнату:', err);
        else console.log('[Cloud Relay] Подписан на комнату:', topic);
      });
    }
  },

  // Отправка события в комнату
  publish(action, payload = {}) {
    if (!this.client || !this.isConnected || !this.lobbyCode) {
      console.warn('[Cloud Relay] Нет подключения к шлюзу для отправки:', action);
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

  // Создание лобби (Организатор)
  createLobby(data, callback) {
    this.isHost = true;
    this.lobbyCode = (data.code || 'TAC' + Math.floor(1000 + Math.random() * 9000)).toUpperCase();
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.currentCallsign = data.callsign;
    this.currentTeamId = data.teamId || 'yellow';

    this.subscribeLobby(this.lobbyCode);

    const initialLobby = {
      code: this.lobbyCode,
      name: data.name || 'Тактическая игра',
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
          lat: data.lat || 55.751244,
          lng: data.lng || 37.618423,
          heading: 0,
          speed: 0
        }
      }
    };

    this.localLobbyData = initialLobby;

    // Анонсируем создание лобби
    this.publish('player:joined', {
      player: initialLobby.players[this.playerId]
    });

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

    this.subscribeLobby(this.lobbyCode);

    // Создаем базовое локальное представление
    const myPlayer = {
      id: this.playerId,
      callsign: data.callsign,
      teamId: this.currentTeamId,
      role: 'fighter',
      status: 'alive',
      lat: data.lat || 55.751244,
      lng: data.lng || 37.618423,
      heading: 0,
      speed: 0
    };

    this.localLobbyData = {
      code: this.lobbyCode,
      name: 'Игра #' + this.lobbyCode,
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

    // Оповещаем комнату о входе
    this.publish('player:joined', { player: myPlayer });

    // Запрашиваем состояние комнаты у хоста/участников
    setTimeout(() => {
      this.publish('sync:request', { requesterPlayerId: this.playerId });
    }, 400);

    if (callback) {
      callback({
        lobbyCode: this.lobbyCode,
        playerId: this.playerId,
        lobby: this.localLobbyData
      });
    }
  },

  // Обработка входящих сообщений
  handleIncoming(data) {
    const action = data.action;

    // Синхронизация данных для новых игроков
    if (action === 'sync:request') {
      if (this.localLobbyData) {
        this.publish('sync:response', {
          targetPlayerId: data.requesterPlayerId,
          lobby: this.localLobbyData
        });
      }
      return;
    }

    if (action === 'sync:response') {
      if (data.targetPlayerId === this.playerId && data.lobby) {
        // Объединяем информацию о лобби
        const remote = data.lobby;
        if (remote.boundary) this.localLobbyData.boundary = remote.boundary;
        if (remote.boundaryFileName) this.localLobbyData.boundaryFileName = remote.boundaryFileName;
        if (remote.tacticalMarkers) this.localLobbyData.tacticalMarkers = remote.tacticalMarkers;
        if (remote.respawnMode) this.localLobbyData.respawnMode = remote.respawnMode;
        if (remote.helicopterIntervalMinutes) this.localLobbyData.helicopterIntervalMinutes = remote.helicopterIntervalMinutes;

        // Добавляем уже присутствующих игроков
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

    // Добавление игрока
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
      }
      this.trigger('player:moved', data);
      return;
    }

    // Статус
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

    // Карта KMZ
    if (action === 'kmz:updated') {
      if (this.localLobbyData) {
        this.localLobbyData.boundary = data.boundary;
        this.localLobbyData.boundaryFileName = data.fileName;
      }
      this.trigger('kmz:updated', data);
      return;
    }

    // Общий триггер
    this.trigger(action, data);
  },

  // Отправка GPS
  sendGPS(coords) {
    this.publish('player:moved', {
      playerId: this.playerId,
      lat: coords.lat,
      lng: coords.lng,
      heading: coords.heading,
      speed: coords.speed,
      accuracy: coords.accuracy
    });
  },

  // Смена статуса (alive, hit, respawn)
  sendStatus(status) {
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

  // Тактическая метка
  addTacticalMarker(marker) {
    this.publish('tactical:marker_added', { marker });
  },

  removeTacticalMarker(markerId) {
    this.publish('tactical:marker_removed', { markerId });
  },

  // Обновление карты полигона
  broadcastKMZ(boundaryGeojson, fileName) {
    this.publish('kmz:updated', {
      boundary: boundaryGeojson,
      fileName: fileName
    });
  },

  // Подписка на события
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

