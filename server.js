const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { parseKmzBuffer } = require('./kmz-parser');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50 MB для KMZ файлов
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck для облачных платформ (Render, Koyeb и др.)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Хранилище лобби в оперативной памяти
const lobbies = {};

// Вспомогательная функция расчета следующей волны вертолета
function calculateNextHelicopter(intervalMinutes) {
  const now = new Date();
  const currentMinutes = now.getMinutes();
  const currentSeconds = now.getSeconds();
  const currentTotalSec = currentMinutes * 60 + currentSeconds;

  const intervalSec = (intervalMinutes || 15) * 60;
  // Секунды с начала текущего часа
  const secInHour = 3600;
  const passedIntervals = Math.floor(currentTotalSec / intervalSec);
  let nextWaveSec = (passedIntervals + 1) * intervalSec;

  const remainingSeconds = nextWaveSec - currentTotalSec;
  const nextWaveDate = new Date(now.getTime() + remainingSeconds * 1000);

  return {
    remainingSeconds,
    nextWaveTime: nextWaveDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    nextWaveTimestamp: nextWaveDate.getTime()
  };
}

// REST API для быстрой проверки статуса
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    appName: 'StrikeTac Airsoft System',
    lobbiesCount: Object.keys(lobbies).length,
    time: new Date().toISOString()
  });
});

// Получение информации о лобби
app.get('/api/lobby/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const lobby = lobbies[code];
  if (!lobby) {
    return res.status(404).json({ error: 'Лобби не найдено' });
  }

  // Не отдаем пароль
  const safeData = {
    code: lobby.code,
    name: lobby.name,
    hasPassword: !!lobby.password,
    respawnMode: lobby.respawnMode,
    respawnTimeMinutes: lobby.respawnTimeMinutes,
    helicopterIntervalMinutes: lobby.helicopterIntervalMinutes,
    teams: lobby.teams,
    playersCount: Object.keys(lobby.players).length,
    hasBoundary: !!lobby.boundary,
    boundaryFileName: lobby.boundaryFileName
  };
  res.json(safeData);
});

// Загрузка KMZ файла через HTTP (альтернатива сокету)
app.post('/api/lobby/:code/upload-kmz', (req, res) => {
  const code = req.params.code.toUpperCase();
  const lobby = lobbies[code];
  if (!lobby) {
    return res.status(404).json({ error: 'Лобби не найдено' });
  }

  const { fileBase64, fileName } = req.body;
  if (!fileBase64) {
    return res.status(400).json({ error: 'Файл не передан' });
  }

  try {
    const buffer = Buffer.from(fileBase64, 'base64');
    const geojson = parseKmzBuffer(buffer);

    lobby.boundary = geojson;
    lobby.boundaryFileName = fileName || 'polygon.kmz';
    lobby.boundaryRawKmz = fileBase64;

    // Оповещаем всех игроков через сокет
    io.to(`lobby_${code}`).emit('kmz:updated', {
      boundary: lobby.boundary,
      fileName: lobby.boundaryFileName,
      rawKmz: lobby.boundaryRawKmz
    });

    res.json({
      success: true,
      featuresCount: geojson.features.length,
      center: geojson.center,
      bounds: geojson.bounds
    });
  } catch (err) {
    console.error('Ошибка парсинга KMZ:', err);
    res.status(500).json({ error: 'Ошибка обработки KMZ: ' + err.message });
  }
});

// Обработка WebSocket соединений
io.on('connection', (socket) => {
  let currentLobbyCode = null;
  let currentPlayerId = null;

  // 1. Создание нового лобби организатором
  socket.on('lobby:create', (data, callback) => {
    try {
      const code = (data.code || Math.random().toString(36).substring(2, 8)).toUpperCase();
      if (lobbies[code]) {
        return callback && callback({ error: 'Лобби с таким кодом уже существует' });
      }

      const defaultTeams = [
        { id: 'yellow', name: 'Желтые', color: '#f59e0b', captainId: null },
        { id: 'blue', name: 'Синие', color: '#06b6d4', captainId: null },
        { id: 'green', name: 'Зеленые', color: '#10b981', captainId: null },
        { id: 'red', name: 'Красные', color: '#ef4444', captainId: null }
      ];

      const lobby = {
        code,
        name: data.name || `Игра #${code}`,
        password: data.password || '',
        organizerSocketId: socket.id,
        organizerCallsign: data.callsign || 'Организатор',
        respawnMode: data.respawnMode || 'helicopter', // 'helicopter', 'timer', 'instant'
        respawnTimeMinutes: parseInt(data.respawnTimeMinutes) || 15,
        helicopterIntervalMinutes: parseInt(data.helicopterIntervalMinutes) || 15,
        teams: data.teams && data.teams.length > 0 ? data.teams : defaultTeams,
        players: {},
        tacticalMarkers: [],
        boundary: null,
        boundaryFileName: null,
        boundaryRawKmz: null,
        createdAt: Date.now()
      };

      lobbies[code] = lobby;

      // Автоматически подключаем организатора как игрока
      const playerId = `p_${socket.id.substring(0, 8)}`;
      currentLobbyCode = code;
      currentPlayerId = playerId;

      const player = {
        id: playerId,
        deviceId: data.deviceId || null,
        socketId: socket.id,
        callsign: data.callsign || 'Организатор',
        teamId: data.teamId || lobby.teams[0].id,
        role: 'organizer', // 'organizer', 'captain', 'fighter'
        status: 'alive',   // 'alive', 'hit', 'respawn', 'malfunction'
        isOffline: false,
        lat: data.lat || 55.751244,
        lng: data.lng || 37.618423,
        heading: 0,
        speed: 0,
        accuracy: 10,
        respawnStartTime: null,
        lastUpdated: Date.now()
      };

      lobby.players[playerId] = player;
      socket.join(`lobby_${code}`);

      console.log(`[Lobby ${code}] Создано лобби. Организатор: "${player.callsign}" (ID: ${playerId})`);

      if (callback) {
        callback({
          success: true,
          lobbyCode: code,
          playerId,
          lobby: getPublicLobbyData(lobby)
        });
      }
    } catch (err) {
      console.error('Ошибка создания лобби:', err);
      if (callback) callback({ error: err.message });
    }
  });

  // 2. Вход игрока в существующее лобби (с дедупликацией)
  socket.on('lobby:join', (data, callback) => {
    try {
      const code = (data.code || '').toUpperCase().trim();
      const lobby = lobbies[code];
      if (!lobby) {
        return callback && callback({ error: 'Лобби не найдено. Проверьте код.' });
      }

      if (lobby.password && lobby.password !== data.password) {
        return callback && callback({ error: 'Неверный пароль игры' });
      }

      const inputCallsign = (data.callsign || '').trim();
      const inputDeviceId = data.deviceId || null;

      // Проверяем: есть ли уже боец с таким позывным или deviceId в этом лобби
      let existingPlayer = null;
      for (const pid of Object.keys(lobby.players)) {
        const p = lobby.players[pid];
        const sameCallsign = inputCallsign && p.callsign && p.callsign.toLowerCase() === inputCallsign.toLowerCase();
        const sameDevice = inputDeviceId && p.deviceId && p.deviceId === inputDeviceId;
        if (sameCallsign || sameDevice) {
          existingPlayer = p;
          break;
        }
      }

      // Если боец найден (переподключение, обновление вкладки или возврат в приложение)
      if (existingPlayer) {
        // Отменяем таймер удаления оффлайн-игрока
        if (existingPlayer.disconnectTimer) {
          clearTimeout(existingPlayer.disconnectTimer);
          existingPlayer.disconnectTimer = null;
        }

        existingPlayer.socketId = socket.id;
        existingPlayer.isOffline = false;
        existingPlayer.disconnectTime = null;
        if (data.teamId) existingPlayer.teamId = data.teamId;
        if (data.lat) existingPlayer.lat = data.lat;
        if (data.lng) existingPlayer.lng = data.lng;
        if (inputDeviceId) existingPlayer.deviceId = inputDeviceId;
        existingPlayer.lastUpdated = Date.now();

        currentLobbyCode = code;
        currentPlayerId = existingPlayer.id;
        socket.join(`lobby_${code}`);

        console.log(`[Lobby ${code}] 🔄 Игрок "${existingPlayer.callsign}" переподключился (ID: ${existingPlayer.id})`);

        // Оповещаем остальных, что игрок вернулся
        socket.to(`lobby_${code}`).emit('player:joined', { player: existingPlayer, isReconnected: true });

        if (callback) {
          callback({
            success: true,
            playerId: existingPlayer.id,
            isReconnected: true,
            lobby: getPublicLobbyData(lobby)
          });
        }
        return;
      }

      // Иначе создаем нового бойца
      const playerId = `p_${socket.id.substring(0, 8)}_${Math.floor(100 + Math.random() * 900)}`;
      currentLobbyCode = code;
      currentPlayerId = playerId;

      // Определение роли: если сокет организатора заходит снова или обычный боец
      let role = 'fighter';
      if (socket.id === lobby.organizerSocketId) {
        role = 'organizer';
      }

      const player = {
        id: playerId,
        deviceId: inputDeviceId,
        socketId: socket.id,
        callsign: inputCallsign || `Боец_${Math.floor(100 + Math.random() * 900)}`,
        teamId: data.teamId || lobby.teams[0].id,
        role,
        status: 'alive',
        isOffline: false,
        lat: data.lat || 55.751244,
        lng: data.lng || 37.618423,
        heading: 0,
        speed: 0,
        accuracy: 10,
        respawnStartTime: null,
        lastUpdated: Date.now()
      };

      lobby.players[playerId] = player;
      socket.join(`lobby_${code}`);

      console.log(`[Lobby ${code}] ➕ Новый боец: "${player.callsign}" (ID: ${playerId})`);

      // Оповещаем остальных игроков о новом бойце
      socket.to(`lobby_${code}`).emit('player:joined', { player });

      if (callback) {
        callback({
          success: true,
          playerId,
          lobby: getPublicLobbyData(lobby)
        });
      }
    } catch (err) {
      console.error('Ошибка входа в лобби:', err);
      if (callback) callback({ error: err.message });
    }
  });

  // 3. Загрузка KMZ файла организатором через сокет
  socket.on('kmz:upload', (data, callback) => {
    try {
      const lobby = lobbies[currentLobbyCode];
      if (!lobby) return callback && callback({ error: 'Лобби не найдено' });

      // Проверка прав организатора
      const player = lobby.players[currentPlayerId];
      if (!player || player.role !== 'organizer') {
        return callback && callback({ error: 'Только организатор может загружать границы полигона' });
      }

      const buffer = Buffer.from(data.fileBase64, 'base64');
      const geojson = parseKmzBuffer(buffer);

      lobby.boundary = geojson;
      lobby.boundaryFileName = data.fileName || 'polygon.kmz';
      lobby.boundaryRawKmz = data.fileBase64;

      // Рассылаем всем подключенным бойцам
      io.to(`lobby_${currentLobbyCode}`).emit('kmz:updated', {
        boundary: lobby.boundary,
        fileName: lobby.boundaryFileName,
        rawKmz: lobby.boundaryRawKmz
      });

      if (callback) callback({ success: true, featuresCount: geojson.features.length, center: geojson.center });
    } catch (err) {
      console.error('Ошибка загрузки KMZ через сокет:', err);
      if (callback) callback({ error: 'Ошибка чтения KMZ: ' + err.message });
    }
  });

  // 3.1. Рассылка готового GeoJSON полигона организатором
  socket.on('kmz:broadcast', (data) => {
    try {
      if (!currentLobbyCode) return;
      const lobby = lobbies[currentLobbyCode];
      if (lobby) {
        lobby.boundary = data.boundary;
        lobby.boundaryFileName = data.fileName || 'polygon.kmz';
      }
      io.to(`lobby_${currentLobbyCode}`).emit('kmz:updated', {
        boundary: data.boundary,
        fileName: data.fileName || 'polygon.kmz'
      });
    } catch (err) {
      console.error('Ошибка broadcast KMZ:', err);
    }
  });

  // 4. Обновление GPS координат бойца
  socket.on('gps:update', (coords) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const player = lobby.players[currentPlayerId];
    if (!player) return;

    player.lat = coords.lat;
    player.lng = coords.lng;
    player.heading = coords.heading || 0;
    player.speed = coords.speed || 0;
    player.accuracy = coords.accuracy || 5;
    player.lastUpdated = Date.now();

    // Трансляция координат всем участникам лобби с полными метаданными игрока
    socket.to(`lobby_${currentLobbyCode}`).emit('player:moved', {
      playerId: currentPlayerId,
      callsign: player.callsign,
      teamId: player.teamId,
      role: player.role,
      status: player.status,
      lat: player.lat,
      lng: player.lng,
      heading: player.heading,
      speed: player.speed,
      accuracy: player.accuracy,
      lastUpdated: player.lastUpdated
    });
  });

  // 5. Смена игрового статуса (жив, поражен, мертвяк, поломка)
  socket.on('status:update', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const player = lobby.players[currentPlayerId];
    if (!player) return;

    const validStatuses = ['alive', 'hit', 'respawn', 'malfunction'];
    if (!validStatuses.includes(data.status)) {
      return callback && callback({ error: 'Неизвестный статус' });
    }

    player.status = data.status;
    if (data.status === 'respawn') {
      player.respawnStartTime = Date.now();
    } else if (data.status === 'alive') {
      player.respawnStartTime = null;
    }

    io.to(`lobby_${currentLobbyCode}`).emit('player:status_changed', {
      playerId: currentPlayerId,
      callsign: player.callsign,
      teamId: player.teamId,
      status: player.status,
      respawnStartTime: player.respawnStartTime
    });

    if (callback) callback({ success: true, status: player.status });
  });

  // 6. Подтверждение выхода из мертвяка
  socket.on('respawn:confirm_exit', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const player = lobby.players[currentPlayerId];
    if (!player) return;

    player.status = 'alive';
    player.respawnStartTime = null;

    io.to(`lobby_${currentLobbyCode}`).emit('player:status_changed', {
      playerId: currentPlayerId,
      callsign: player.callsign,
      teamId: player.teamId,
      status: 'alive',
      respawnStartTime: null,
      message: `Боец ${player.callsign} вышел из мертвяка в строй!`
    });

    if (callback) callback({ success: true });
  });

  // 7. Назначение капитана команды организатором
  socket.on('team:set_captain', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const sender = lobby.players[currentPlayerId];
    if (!sender || sender.role !== 'organizer') {
      return callback && callback({ error: 'Только организатор может назначать капитана' });
    }

    const { targetPlayerId, teamId, isCaptain } = data;
    const targetPlayer = lobby.players[targetPlayerId];
    if (!targetPlayer) return callback && callback({ error: 'Игрок не найден' });

    const team = lobby.teams.find(t => t.id === teamId);
    if (!team) return callback && callback({ error: 'Команда не найдена' });

    if (isCaptain) {
      // Снимаем прошлого капитана если был
      if (team.captainId && lobby.players[team.captainId]) {
        lobby.players[team.captainId].role = 'fighter';
      }
      team.captainId = targetPlayerId;
      targetPlayer.role = 'captain';
      targetPlayer.teamId = teamId;
    } else {
      if (team.captainId === targetPlayerId) {
        team.captainId = null;
      }
      targetPlayer.role = 'fighter';
    }

    io.to(`lobby_${currentLobbyCode}`).emit('team:captain_updated', {
      teamId,
      captainId: team.captainId,
      targetPlayerId,
      newRole: targetPlayer.role
    });

    if (callback) callback({ success: true });
  });

  // 8. Смена команды игроком
  socket.on('team:change', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const player = lobby.players[currentPlayerId];
    if (!player) return;

    player.teamId = data.newTeamId;

    io.to(`lobby_${currentLobbyCode}`).emit('player:team_changed', {
      playerId: currentPlayerId,
      newTeamId: player.teamId
    });

    if (callback) callback({ success: true, newTeamId: player.teamId });
  });

  // 9. Добавление тактического маркера (капитан или организатор)
  socket.on('tactical:add_marker', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const player = lobby.players[currentPlayerId];
    if (!player || (player.role !== 'captain' && player.role !== 'organizer')) {
      return callback && callback({ error: 'Только капитан или организатор может ставить тактические метки' });
    }

    const marker = {
      id: `m_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: data.type || 'enemy', // 'enemy', 'attack', 'defend', 'rally', 'sos'
      lat: data.lat,
      lng: data.lng,
      title: data.title || 'Метка',
      description: data.description || '',
      authorId: currentPlayerId,
      authorCallsign: player.callsign,
      authorTeamId: player.teamId,
      createdAt: Date.now()
    };

    lobby.tacticalMarkers.push(marker);

    io.to(`lobby_${currentLobbyCode}`).emit('tactical:marker_added', { marker });

    if (callback) callback({ success: true, marker });
  });

  // 10. Удаление тактического маркера
  socket.on('tactical:remove_marker', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const markerIndex = lobby.tacticalMarkers.findIndex(m => m.id === data.markerId);
    if (markerIndex !== -1) {
      const removed = lobby.tacticalMarkers.splice(markerIndex, 1)[0];
      io.to(`lobby_${currentLobbyCode}`).emit('tactical:marker_removed', { markerId: data.markerId });
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ error: 'Метка не найдена' });
    }
  });

  // 11. Запрос синхронизации времени вертолета
  socket.on('helicopter:sync', (callback) => {
    if (!currentLobbyCode) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const heliData = calculateNextHelicopter(lobby.helicopterIntervalMinutes);
    if (callback) callback(heliData);
  });

  // 12. Явный выход игрока из лобби (кнопка «Выйти из лобби»)
  socket.on('lobby:leave', (callback) => {
    if (currentLobbyCode && currentPlayerId) {
      const lobby = lobbies[currentLobbyCode];
      if (lobby && lobby.players[currentPlayerId]) {
        const player = lobby.players[currentPlayerId];
        if (player.disconnectTimer) {
          clearTimeout(player.disconnectTimer);
          player.disconnectTimer = null;
        }
        const callsign = player.callsign;
        delete lobby.players[currentPlayerId];
        socket.leave(`lobby_${currentLobbyCode}`);

        io.to(`lobby_${currentLobbyCode}`).emit('player:left', {
          playerId: currentPlayerId,
          callsign: callsign,
          reason: 'manual_exit'
        });

        console.log(`[Lobby ${currentLobbyCode}] 🚪 Боец "${callsign}" (ID: ${currentPlayerId}) вышел из лобби.`);
      }
      currentLobbyCode = null;
      currentPlayerId = null;
    }
    if (callback) callback({ success: true });
  });

  // 13. Исключение / удаление игрока организатором
  socket.on('lobby:kick_player', (data, callback) => {
    if (!currentLobbyCode || !currentPlayerId) return;
    const lobby = lobbies[currentLobbyCode];
    if (!lobby) return;

    const sender = lobby.players[currentPlayerId];
    if (!sender || sender.role !== 'organizer') {
      return callback && callback({ error: 'Только организатор может удалять игроков' });
    }

    const targetId = data.targetPlayerId;
    if (targetId && lobby.players[targetId]) {
      const target = lobby.players[targetId];
      if (target.disconnectTimer) {
        clearTimeout(target.disconnectTimer);
        target.disconnectTimer = null;
      }
      const callsign = target.callsign;
      delete lobby.players[targetId];

      io.to(`lobby_${currentLobbyCode}`).emit('player:left', {
        playerId: targetId,
        callsign: callsign,
        reason: 'kicked'
      });

      console.log(`[Lobby ${currentLobbyCode}] ⛔ Организатор удалил игрока "${callsign}" (ID: ${targetId}).`);
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ error: 'Игрок не найден' });
    }
  });

  // 14. Отключение сокета игрока (обрыв соединения, закрытие вкладки)
  socket.on('disconnect', (reason) => {
    if (currentLobbyCode && currentPlayerId) {
      const lobby = lobbies[currentLobbyCode];
      if (lobby && lobby.players[currentPlayerId]) {
        const player = lobby.players[currentPlayerId];
        player.isOffline = true;
        player.disconnectTime = Date.now();

        console.log(`[Lobby ${currentLobbyCode}] ⚠️ Игрок "${player.callsign}" потерял связь (${reason}).`);

        io.to(`lobby_${currentLobbyCode}`).emit('player:offline', {
          playerId: currentPlayerId,
          callsign: player.callsign
        });

        // Если это не организатор, запускаем таймаут (60 сек):
        // Если за 60 секунд боец не переподключился (закрыл вкладку/приложение), удаляем его из лобби
        if (player.role !== 'organizer') {
          if (player.disconnectTimer) {
            clearTimeout(player.disconnectTimer);
          }
          const savedCode = currentLobbyCode;
          const savedPid = currentPlayerId;
          player.disconnectTimer = setTimeout(() => {
            const currentLobby = lobbies[savedCode];
            if (currentLobby && currentLobby.players[savedPid] && currentLobby.players[savedPid].isOffline) {
              const cs = currentLobby.players[savedPid].callsign;
              delete currentLobby.players[savedPid];
              io.to(`lobby_${savedCode}`).emit('player:left', {
                playerId: savedPid,
                callsign: cs,
                reason: 'timeout'
              });
              console.log(`[Lobby ${savedCode}] ⏱️ Оффлайн-игрок "${cs}" удален по таймауту.`);
            }
          }, 60000);
        }
      }
    }
  });
});

// Формирование публичных данных лобби (без пароля)
function getPublicLobbyData(lobby) {
  return {
    code: lobby.code,
    name: lobby.name,
    respawnMode: lobby.respawnMode,
    respawnTimeMinutes: lobby.respawnTimeMinutes,
    helicopterIntervalMinutes: lobby.helicopterIntervalMinutes,
    teams: lobby.teams,
    players: lobby.players,
    tacticalMarkers: lobby.tacticalMarkers,
    boundary: lobby.boundary,
    boundaryFileName: lobby.boundaryFileName,
    boundaryRawKmz: lobby.boundaryRawKmz
  };
}

const os = require('os');

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }
  return addresses;
}

const targetPort = parseInt(PORT, 10);
server.listen(targetPort, '0.0.0.0', () => {
  const localIps = getLocalIpAddresses();
  console.log(`=======================================================`);
  console.log(`  ⚡ StrikeTac Airsoft Tactical Server запущен!`);
  console.log(`  Основной порт: ${targetPort}`);
  console.log(`  На этом ПК: http://localhost:${targetPort}`);
  if (localIps.length > 0) {
    console.log(`  Для телефонов (Wi-Fi / локальная сеть):`);
    localIps.forEach(net => {
      console.log(`    → [${net.name}]: http://${net.address}:${targetPort}`);
    });
  } else {
    console.log(`  В сети:     http://0.0.0.0:${targetPort}`);
  }
  console.log(`=======================================================`);
});

// Универсальная совместимость с Envoy / Nginx / Amvera / Docker
const extraPorts = [80, 3000].filter(p => p !== targetPort);
for (const p of extraPorts) {
  try {
    const extraServer = http.createServer(app);
    io.attach(extraServer);
    extraServer.on('error', () => {
      // Игнорируем EACCES (если нет прав root) или EADDRINUSE
    });
    extraServer.listen(p, '0.0.0.0', () => {
      console.log(`  Дополнительный облачный порт активен: ${p}`);
    });
  } catch (e) {
    // игнорируем
  }
}

