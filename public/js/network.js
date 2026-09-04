/**
 * Тактический сетевой менеджер StrikeTac (v2.0)
 * Поддерживает два режима работы:
 * 1. Выделенный сервер StrikeTac (Socket.IO) - мгновенный отклик, централизованный реестр лобби,
 *    работает по локальной сети Wi-Fi (192.168.x.x), Radmin VPN, localhost или облачному серверу.
 * 2. Автономный Cloud Relay (MQTT WSS) - для игр в лесу без ПК через защищенные WSS-шлюзы
 *    с гарантированным inbox-рукопожатием и повторными попытками.
 */
const TacticalNetwork = {
  transport: null, // 'socket' | 'mqtt'
  socket: null,
  client: null,

  lobbyCode: null,
  playerId: null,
  isHost: false,
  isConnected: false,
  serverUrl: '',

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
  activeBrokerUrl: 'wss://broker.emqx.io:8084/mqtt',
  CLOUD_BROKERS: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ],

  /**
   * Инициализация подключения
   */
  connect(onSuccess, onError) {
    // 1. Определение адреса сервера
    let configuredUrl = '';
    if (typeof AppStorage !== 'undefined' && AppStorage.getServerUrl) {
      configuredUrl = AppStorage.getServerUrl().trim();
    }

    if (!configuredUrl && typeof window !== 'undefined' && window.location && window.location.origin) {
      const origin = window.location.origin;
      if (origin.startsWith('http') && !origin.includes('capacitor:') && !origin.includes('localhost')) {
        configuredUrl = origin;
      }
    }

    if (!configuredUrl) {
      configuredUrl = 'https://striketac-mavik186.amvera.io';
    }

    // Если доступен Socket.IO (библиотека подключена), пробуем подключиться к серверу
    if (typeof io !== 'undefined') {
      const targetUrl = configuredUrl || undefined;
      console.log('[TacticalNetwork] Попытка подключения к серверу StrikeTac:', targetUrl || 'авто (текущий хост)');

      let hasResolved = false;
      try {
        const s = io(targetUrl, {
          transports: ['websocket', 'polling'],
          timeout: 4000,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1500
        });

        const connectTimer = setTimeout(() => {
          if (!s.connected && !hasResolved) {
            console.log('[TacticalNetwork] Сервер не ответил вовремя. Переключаемся на Cloud Relay...');
            this.initMqttRelay(onSuccess, onError);
          }
        }, 3500);

        s.on('connect', () => {
          clearTimeout(connectTimer);
          if (hasResolved && this.transport === 'socket') return;
          hasResolved = true;

          this.transport = 'socket';
          this.socket = s;
          this.isConnected = true;
          this.serverUrl = configuredUrl || (window.location && window.location.origin) || 'http://localhost:3000';
          console.log('[TacticalNetwork] ✅ Успешно подключено к тактическому серверу:', this.serverUrl);

          this.bindSocketEvents();
          if (onSuccess) onSuccess(this.serverUrl, 'socket');
          this.trigger('connection:status', true);
        });

        s.on('connect_error', (err) => {
          if (!hasResolved) {
            clearTimeout(connectTimer);
            hasResolved = true;
            console.warn('[TacticalNetwork] Сервер недоступен (' + err.message + '). Запуск Cloud Relay...');
            this.initMqttRelay(onSuccess, onError);
          }
        });

        s.on('disconnect', (reason) => {
          console.warn('[TacticalNetwork] Соединение с сервером потеряно:', reason);
          this.isConnected = false;
          this.trigger('connection:status', false);
        });

        return;
      } catch (err) {
        console.warn('[TacticalNetwork] Ошибка инициализации Socket.IO:', err);
      }
    }

    // Если Socket.IO недоступен, подключаем Cloud Relay
    this.initMqttRelay(onSuccess, onError);
  },

  /**
   * Настройка событий Socket.IO сервера
   */
  bindSocketEvents() {
    if (!this.socket) return;

    this.socket.on('player:joined', (data) => {
      this.trigger('player:joined', data);
    });

    this.socket.on('player:moved', (data) => {
      this.trigger('player:moved', data);
    });

    this.socket.on('player:status_changed', (data) => {
      this.trigger('player:status_changed', data);
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

    this.socket.on('player:disconnected', (data) => {
      this.trigger('player:disconnected', data);
    });
  },

  /**
   * Инициализация автономного облачного шлюза (MQTT Relay)
   */
  initMqttRelay(onSuccess, onError) {
    if (typeof mqtt === 'undefined') {
      console.error('[TacticalNetwork] MQTT библиотека не найдена!');
      if (onError) onError('Сетевые библиотеки не загружены');
      return;
    }

    this.transport = 'mqtt';
    const brokerUrl = this.activeBrokerUrl;
    const clientId = 'striketac_' + Math.random().toString(36).substring(2, 10);
    console.log('[Cloud Relay] Подключение к WSS-шлюзу:', brokerUrl);

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 3000,
        keepalive: 30
      });
    } catch (err) {
      console.error('[Cloud Relay] Ошибка запуска MQTT:', err);
      if (onError) onError(err.message);
      return;
    }

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('[Cloud Relay] ✅ Шлюз активен:', brokerUrl);
      if (onSuccess) onSuccess(brokerUrl, 'mqtt');
      this.trigger('connection:status', true);
    });

    this.client.on('error', (err) => {
      console.warn('[Cloud Relay] Ошибка сети:', err);
      this.isConnected = false;
      this.trigger('connection:status', false);
    });

    this.client.on('message', (topic, message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data._senderId && data._senderId === this.playerId) return;
        this.handleMqttIncoming(data);
      } catch (e) {
        console.error('[Cloud Relay] Ошибка парсинга пакета:', e);
      }
    });
  },

  /**
   * Создание лобби
   */
  createLobby(data, onSuccess, onError) {
    if (!this.isConnected) {
      if (onError) onError('Нет связи с сетью! Дождитесь подключения.');
      return;
    }

    // Режим 1: Выделенный сервер StrikeTac
    if (this.transport === 'socket' && this.socket) {
      this.socket.emit('lobby:create', data, (res) => {
        if (res.error) {
          if (onError) onError(res.error);
        } else {
          this.lobbyCode = res.lobbyCode;
          this.playerId = res.playerId;
          this.isHost = true;
          this.localLobbyData = res.lobby;
          if (onSuccess) onSuccess(res);
        }
      });
      return;
    }

    // Режим 2: Cloud Relay (MQTT)
    this.isHost = true;
    this.lobbyCode = (data.code || 'TAC' + Math.floor(1000 + Math.random() * 9000)).toUpperCase().trim();
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.currentCallsign = data.callsign || 'Организатор';
    this.currentTeamId = data.teamId || 'yellow';
    this.currentStatus = 'alive';
    if (data.lat) this.currentLat = data.lat;
    if (data.lng) this.currentLng = data.lng;

    const initialLobby = {
      code: this.lobbyCode,
      name: data.name || `Игра #${this.lobbyCode}`,
      password: (data.password || '').trim(),
      organizerPlayerId: this.playerId,
      respawnMode: data.respawnMode || 'helicopter',
      respawnTimeMinutes: data.respawnTimeMinutes || 15,
      helicopterIntervalMinutes: data.helicopterIntervalMinutes || 15,
      boundary: null,
      boundaryFileName: null,
      tacticalMarkers: [],
      teams: [
        { id: 'yellow', name: 'Желтые', color: '#f59e0b' },
        { id: 'blue', name: 'Синие', color: '#06b6d4' },
        { id: 'green', name: 'Зеленые', color: '#10b981' },
        { id: 'red', name: 'Красные', color: '#ef4444' }
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

    // Хост подписывается на топик комнаты
    const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
    this.client.subscribe(roomTopic, { qos: 0 }, (err) => {
      if (err) console.error('[Cloud Relay] Ошибка подписки на комнату:', err);
      console.log('[Cloud Relay] Организатор открыл комнату:', roomTopic);

      this.startMqttPresenceLoop();
      if (onSuccess) {
        onSuccess({
          lobbyCode: this.lobbyCode,
          playerId: this.playerId,
          lobby: initialLobby
        });
      }
    });
  },

  /**
   * Вход в существующее лобби
   */
  joinLobby(data, onSuccess, onError) {
    if (!this.isConnected) {
      if (onError) onError('Нет связи с сетью! Дождитесь подключения.');
      return;
    }

    const targetCode = (data.code || '').toUpperCase().trim();

    // Режим 1: Выделенный сервер StrikeTac
    if (this.transport === 'socket' && this.socket) {
      this.socket.emit('lobby:join', {
        code: targetCode,
        callsign: data.callsign,
        teamId: data.teamId,
        password: data.password,
        lat: data.lat || 55.751244,
        lng: data.lng || 37.618423
      }, (res) => {
        if (res.error) {
          if (onError) onError(res.error);
        } else {
          this.lobbyCode = targetCode;
          this.playerId = res.playerId;
          this.isHost = false;
          this.localLobbyData = res.lobby;
          if (onSuccess) onSuccess({ lobbyCode: targetCode, playerId: res.playerId, lobby: res.lobby });
        }
      });
      return;
    }

    // Режим 2: Cloud Relay (MQTT) с надежным handshake через inbox
    this.isHost = false;
    this.lobbyCode = targetCode;
    this.playerId = 'p_' + Math.random().toString(36).substring(2, 9);
    this.currentCallsign = data.callsign;
    this.currentTeamId = data.teamId || 'yellow';
    this.currentStatus = 'alive';
    if (data.lat) this.currentLat = data.lat;
    if (data.lng) this.currentLng = data.lng;

    const myPlayer = {
      id: this.playerId,
      callsign: this.currentCallsign,
      teamId: this.currentTeamId,
      role: 'fighter',
      status: 'alive',
      lat: this.currentLat,
      lng: this.currentLng,
      heading: 0,
      speed: 0,
      accuracy: 5
    };

    const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
    const inboxTopic = `striketac/v2/inbox/${this.playerId}`;

    let isResolved = false;
    let attempts = 0;
    const maxAttempts = 3;
    let retryTimer = null;

    const cleanup = () => {
      if (retryTimer) clearTimeout(retryTimer);
      try { this.client.unsubscribe(inboxTopic); } catch (e) {}
    };

    // Подписываемся на персональный inbox для получения ответа от хоста
    this.client.subscribe(inboxTopic, { qos: 0 }, (err) => {
      if (err) {
        if (onError) onError('Ошибка создания защищенного канала авторизации');
        return;
      }

      const sendAttempt = () => {
        if (isResolved) return;
        attempts++;
        console.log(`[Cloud Relay] Отправка join:request (попытка ${attempts}/${maxAttempts})...`);

        const packet = {
          action: 'join:request',
          _senderId: this.playerId,
          _timestamp: Date.now(),
          requesterPlayerId: this.playerId,
          inboxTopic: inboxTopic,
          password: (data.password || '').trim(),
          player: myPlayer
        };

        this.client.publish(roomTopic, JSON.stringify(packet), { qos: 0 });

        if (attempts < maxAttempts) {
          retryTimer = setTimeout(sendAttempt, 2500);
        } else {
          retryTimer = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              cleanup();
              if (onError) {
                onError(`Лобби #${targetCode} не отвечает!\nУбедитесь, что код введен верно и организатор находится в сети.`);
              }
            }
          }, 3000);
        }
      };

      sendAttempt();
    });

    this.joinPendingCallback = (response) => {
      if (isResolved) return;
      isResolved = true;
      cleanup();

      if (response.success) {
        this.localLobbyData = response.lobby;
        // После одобрения подписываемся на общий канал комнаты
        this.client.subscribe(roomTopic, { qos: 0 });
        this.startMqttPresenceLoop();
        if (onSuccess) {
          onSuccess({
            lobbyCode: this.lobbyCode,
            playerId: this.playerId,
            lobby: response.lobby
          });
        }
      } else {
        if (onError) onError(response.reason || 'Отказано в доступе организатором.');
      }
    };
  },

  /**
   * Обработка входящих сообщений в режиме Cloud Relay (MQTT)
   */
  handleMqttIncoming(data) {
    if (!data || !data.action) return;
    const action = data.action;

    // 1. Хост обрабатывает запрос на вход
    if (action === 'join:request') {
      if (this.isHost && this.localLobbyData) {
        console.log('[Cloud Relay] Хост получил запрос от', data.requesterPlayerId);
        const expectedPassword = (this.localLobbyData.password || '').trim();
        const incomingPassword = (data.password || '').trim();

        const responseTopic = data.inboxTopic || `striketac/v2/inbox/${data.requesterPlayerId}`;

        if (expectedPassword && incomingPassword !== expectedPassword) {
          console.warn('[Cloud Relay] Неверный пароль от', data.requesterPlayerId);
          this.client.publish(responseTopic, JSON.stringify({
            action: 'join:response',
            targetPlayerId: data.requesterPlayerId,
            success: false,
            reason: 'Неверный пароль лобби! Доступ запрещен.'
          }), { qos: 0 });
          return;
        }

        // Пароль верный — регистрируем бойца
        if (data.player && data.player.id) {
          this.localLobbyData.players[data.player.id] = data.player;
          this.trigger('player:joined', { player: data.player });
        }

        console.log('[Cloud Relay] Одобрен вход бойцу', data.requesterPlayerId);
        this.client.publish(responseTopic, JSON.stringify({
          action: 'join:response',
          targetPlayerId: data.requesterPlayerId,
          success: true,
          lobby: this.localLobbyData
        }), { qos: 0 });

        // Оповещаем остальных
        const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
        this.client.publish(roomTopic, JSON.stringify({
          action: 'player:joined',
          _senderId: this.playerId,
          player: data.player
        }), { qos: 0 });
      }
      return;
    }

    // 2. Клиент обрабатывает ответ на вход
    if (action === 'join:response') {
      if (data.targetPlayerId === this.playerId && this.joinPendingCallback) {
        this.joinPendingCallback(data);
        this.joinPendingCallback = null;
      }
      return;
    }

    // 3. Другие игровые события
    if (action === 'player:moved') {
      this.trigger('player:moved', data);
    } else if (action === 'player:status_changed') {
      this.trigger('player:status_changed', data);
    } else if (action === 'player:joined') {
      this.trigger('player:joined', data);
    } else if (action === 'tactical:marker_added') {
      this.trigger('tactical:marker_added', data);
    } else if (action === 'tactical:marker_removed') {
      this.trigger('tactical:marker_removed', data);
    } else if (action === 'team:captain_updated') {
      this.trigger('team:captain_updated', data);
    } else if (action === 'kmz:updated') {
      this.trigger('kmz:updated', data);
    }
  },

  /**
   * Фоновая телеметрия в MQTT
   */
  startMqttPresenceLoop() {
    if (this.presenceInterval) clearInterval(this.presenceInterval);
    this.presenceInterval = setInterval(() => {
      if (!this.isConnected || !this.lobbyCode) return;
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      const packet = {
        action: 'player:moved',
        _senderId: this.playerId,
        playerId: this.playerId,
        lat: this.currentLat,
        lng: this.currentLng,
        heading: this.currentHeading,
        speed: this.currentSpeed,
        accuracy: this.currentAccuracy
      };
      if (this.client) {
        this.client.publish(roomTopic, JSON.stringify(packet), { qos: 0 });
      }
    }, 3000);
  },

  /**
   * Обновление GPS координат
   */
  updateGPS(coords) {
    this.currentLat = coords.lat;
    this.currentLng = coords.lng;
    this.currentHeading = coords.heading || 0;
    this.currentSpeed = coords.speed || 0;
    this.currentAccuracy = coords.accuracy || 5;

    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('gps:update', coords);
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'player:moved',
        _senderId: this.playerId,
        playerId: this.playerId,
        lat: coords.lat,
        lng: coords.lng,
        heading: coords.heading,
        speed: coords.speed,
        accuracy: coords.accuracy
      }), { qos: 0 });
    }
  },

  /**
   * Смена статуса игрока
   */
  sendStatus(status) {
    this.currentStatus = status;

    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('status:update', { status: status });
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'player:status_changed',
        _senderId: this.playerId,
        playerId: this.playerId,
        callsign: this.currentCallsign,
        teamId: this.currentTeamId,
        status: status,
        respawnStartTime: status === 'respawn' ? Date.now() : null
      }), { qos: 0 });
    }
  },

  /**
   * Подтверждение выхода из мертвяка
   */
  sendRespawnExit() {
    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('respawn:confirm_exit', {});
      return;
    }
    this.sendStatus('alive');
  },

  /**
   * Назначение капитана
   */
  setCaptain(targetPlayerId, teamId, isCaptain) {
    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('team:set_captain', { targetPlayerId, teamId, isCaptain });
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'team:captain_updated',
        _senderId: this.playerId,
        teamId: teamId,
        captainId: isCaptain ? targetPlayerId : null,
        targetPlayerId: targetPlayerId,
        newRole: isCaptain ? 'captain' : 'fighter'
      }), { qos: 0 });
    }
  },

  /**
   * Добавление тактической метки
   */
  addTacticalMarker(marker) {
    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('tactical:add_marker', marker);
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'tactical:marker_added',
        _senderId: this.playerId,
        marker: marker
      }), { qos: 0 });
    }
  },

  /**
   * Удаление тактической метки
   */
  removeTacticalMarker(markerId) {
    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('tactical:remove_marker', { markerId });
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'tactical:marker_removed',
        _senderId: this.playerId,
        markerId: markerId
      }), { qos: 0 });
    }
  },

  /**
   * Рассылка карты полигона (KMZ / GeoJSON)
   */
  broadcastKMZ(boundaryGeojson, fileName) {
    if (this.transport === 'socket' && this.socket && this.isConnected) {
      this.socket.emit('kmz:broadcast', { boundary: boundaryGeojson, fileName });
      return;
    }

    if (this.transport === 'mqtt' && this.client && this.isConnected && this.lobbyCode) {
      const roomTopic = `striketac/v2/room/${this.lobbyCode}`;
      this.client.publish(roomTopic, JSON.stringify({
        action: 'kmz:updated',
        _senderId: this.playerId,
        boundary: boundaryGeojson,
        fileName: fileName
      }), { qos: 0 });
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
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
  }
};

window.TacticalNetwork = TacticalNetwork;
