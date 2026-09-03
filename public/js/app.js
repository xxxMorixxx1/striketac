/**
 * Главный координатор клиентской логики StrikeTac (v1.2)
 * Полная поддержка Cloud Relay, фильтрация GPS, пароли лобби и Safe Area
 */
(function() {
  let myPlayerId = null;
  let currentLobbyCode = null;
  let myRole = 'fighter'; // 'organizer', 'captain', 'fighter'
  let myTeamId = 'yellow';
  let myCallsign = '';
  let currentLobbyData = null;

  // DOM Элементы
  const netStatusDot = document.getElementById('net-status-dot');
  const hudLobbyCode = document.getElementById('hud-lobby-code');
  const hudPlayerBadge = document.getElementById('hud-player-badge');
  const hudCallsignDisplay = document.getElementById('hud-callsign-display');
  const hudRoleIcon = document.getElementById('hud-role-icon');
  const hudGpsAccuracy = document.getElementById('hud-gps-accuracy');
  const hudPlayersCount = document.getElementById('hud-players-count');

  const modalAuth = document.getElementById('modal-auth');
  const tabBtnJoin = document.getElementById('tab-btn-join');
  const tabBtnCreate = document.getElementById('tab-btn-create');
  const formJoin = document.getElementById('form-join');
  const formCreate = document.getElementById('form-create');

  // Панель настройки адреса сервера/шлюза
  const btnToggleServerSettings = document.getElementById('btn-toggle-server-settings');
  const serverSettingsPanel = document.getElementById('server-settings-panel');
  const inputCustomServerUrl = document.getElementById('input-custom-server-url');
  const btnSaveServerUrl = document.getElementById('btn-save-server-url');
  const serverConnStatus = document.getElementById('server-conn-status');

  const statusBar = document.getElementById('status-bar');
  const respawnBanner = document.getElementById('respawn-banner');
  const btnRespawnExit = document.getElementById('btn-respawn-exit');

  const btnLayerToggle = document.getElementById('btn-layer-toggle');
  const btnGpsFollow = document.getElementById('btn-gps-follow');
  const btnAddTactical = document.getElementById('btn-add-tactical');
  const btnOrganizerPanel = document.getElementById('btn-organizer-panel');

  const modalOrganizer = document.getElementById('modal-organizer');
  const btnCloseOrganizer = document.getElementById('btn-close-organizer');
  const inputUploadKmz = document.getElementById('input-upload-kmz-field');
  const uploadKmzLabel = document.getElementById('upload-kmz-label');
  const kmzStatusText = document.getElementById('kmz-status-text');
  const organizerPlayersList = document.getElementById('organizer-players-list');
  const inputCreateKmz = document.getElementById('input-create-kmz');
  const createKmzLabel = document.getElementById('create-kmz-label');

  const modalTactical = document.getElementById('modal-tactical-marker');
  const btnCloseTactical = document.getElementById('btn-close-tactical');
  const btnSubmitTactical = document.getElementById('btn-submit-tactical-marker');

  // Инициализация карты
  TacticalMap.init('map');

  // Инициализация полей сервера в UI
  if (inputCustomServerUrl) {
    inputCustomServerUrl.value = AppStorage.getServerUrl();
  }

  if (btnToggleServerSettings && serverSettingsPanel) {
    btnToggleServerSettings.onclick = () => {
      const isHidden = serverSettingsPanel.style.display === 'none';
      serverSettingsPanel.style.display = isHidden ? 'block' : 'none';
    };
  }

  if (btnSaveServerUrl && inputCustomServerUrl) {
    btnSaveServerUrl.onclick = () => {
      const newUrl = inputCustomServerUrl.value.trim().replace(/\/+$/, '');
      AppStorage.setServerUrl(newUrl);
      showToast('Настройки сохранены! Переподключение...', '#00ff9d');
      setTimeout(() => {
        location.reload();
      }, 700);
    };
  }

  // Загрузка сохраненного позывного и лобби
  const savedCallsign = AppStorage.getCallsign();
  if (savedCallsign) {
    document.getElementById('input-join-callsign').value = savedCallsign;
    document.getElementById('input-create-callsign').value = savedCallsign;
  }
  const savedLobby = AppStorage.getLastLobby();
  if (savedLobby) {
    document.getElementById('input-join-code').value = savedLobby;
  }

  // Индикация выбранных файлов в UI
  if (inputCreateKmz && createKmzLabel) {
    inputCreateKmz.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        createKmzLabel.textContent = `Выбран: ${e.target.files[0].name}`;
        createKmzLabel.style.color = 'var(--color-green)';
      }
    };
  }

  if (inputUploadKmz && uploadKmzLabel) {
    inputUploadKmz.onchange = (e) => {
      if (e.target.files && e.target.files[0]) {
        uploadKmzLabel.textContent = `Выбран: ${e.target.files[0].name}`;
        uploadKmzFile(e.target.files[0]);
      }
    };
  }

  // Обновление индикатора статуса сети в HUD
  function updateNetStatusDisplay(online, info = '') {
    if (online) {
      netStatusDot.classList.remove('offline');
      if (serverConnStatus) {
        serverConnStatus.textContent = info || 'Облачный шлюз: 24/7 Онлайн';
        serverConnStatus.style.color = 'var(--color-green)';
      }
    } else {
      netStatusDot.classList.add('offline');
      if (serverConnStatus) {
        serverConnStatus.textContent = info || 'Связь с облаком отсутствует';
        serverConnStatus.style.color = 'var(--color-red)';
      }
    }
  }

  // Запуск подключения к открытому облачному ретранслятору (EMQX WSS)
  TacticalNetwork.connect(
    (brokerUrl) => {
      const host = brokerUrl.replace(/^wss?:\/\//, '').split(/[:/]/)[0];
      updateNetStatusDisplay(true, `Облачный шлюз: ${host} (24/7 Онлайн)`);
    },
    (err) => {
      updateNetStatusDisplay(false, 'Связь прервана, переподключение...');
    }
  );

  // Переключение вкладок входа
  tabBtnJoin.onclick = () => {
    tabBtnJoin.classList.add('active');
    tabBtnJoin.style.borderBottom = '2px solid var(--color-green)';
    tabBtnCreate.classList.remove('active');
    tabBtnCreate.style.borderBottom = 'none';
    formJoin.style.display = 'flex';
    formCreate.style.display = 'none';
  };

  tabBtnCreate.onclick = () => {
    tabBtnCreate.classList.add('active');
    tabBtnCreate.style.borderBottom = '2px solid var(--color-green)';
    tabBtnJoin.classList.remove('active');
    tabBtnJoin.style.borderBottom = 'none';
    formCreate.style.display = 'flex';
    formJoin.style.display = 'none';
  };

  // Выбор стороны в сетке команд
  document.querySelectorAll('#join-teams-list .team-card-option').forEach(card => {
    card.onclick = () => {
      document.querySelectorAll('#join-teams-list .team-card-option').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      myTeamId = card.dataset.team;
    };
  });

  const selectRespawnMode = document.getElementById('select-respawn-mode');
  const groupHelicopter = document.getElementById('group-helicopter-interval');
  const groupTimer = document.getElementById('group-timer-minutes');

  selectRespawnMode.onchange = () => {
    const mode = selectRespawnMode.value;
    if (mode === 'helicopter') {
      groupHelicopter.style.display = 'block';
      groupTimer.style.display = 'none';
    } else if (mode === 'timer') {
      groupHelicopter.style.display = 'none';
      groupTimer.style.display = 'block';
    } else {
      groupHelicopter.style.display = 'none';
      groupTimer.style.display = 'none';
    }
  };

  // ВХОД В СУЩЕСТВУЮЩУЮ ИГРУ (ТРЕБУЕТСЯ ПАРОЛЬ)
  formJoin.onsubmit = (e) => {
    e.preventDefault();
    const code = document.getElementById('input-join-code').value.trim().toUpperCase();
    const callsign = document.getElementById('input-join-callsign').value.trim();
    const password = document.getElementById('input-join-password').value.trim();

    if (!code || !callsign) {
      alert('Пожалуйста, введите код игры и ваш позывной');
      return;
    }
    if (!password) {
      alert('Пожалуйста, введите пароль лобби игры!');
      return;
    }

    AppStorage.setCallsign(callsign);
    AppStorage.setLastLobby(code);
    myCallsign = callsign;

    TacticalNetwork.joinLobby({
      code,
      callsign,
      teamId: myTeamId,
      password,
      lat: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lat : 55.751244,
      lng: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lng : 37.618423
    }, (res) => {
      handleJoinSuccess(res.lobbyCode || code, res.playerId, res.lobby);
    });
  };

  // СОЗДАНИЕ НОВОЙ ИГРЫ (ОРГАНИЗАТОР, ОБЯЗАТЕЛЬНЫЙ ПАРОЛЬ)
  formCreate.onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('input-create-name').value.trim();
    const code = document.getElementById('input-create-code').value.trim().toUpperCase();
    const password = document.getElementById('input-create-password').value.trim();
    const callsign = document.getElementById('input-create-callsign').value.trim();
    const respawnMode = selectRespawnMode.value;
    const helicopterInterval = parseInt(document.getElementById('select-helicopter-interval').value) || 15;
    const timerMinutes = parseInt(document.getElementById('input-timer-minutes').value) || 15;
    const kmzFileInput = document.getElementById('input-create-kmz');

    if (!password) {
      alert('Пожалуйста, задайте пароль игры для бойцов!');
      return;
    }

    AppStorage.setCallsign(callsign);
    myCallsign = callsign;

    TacticalNetwork.createLobby({
      name,
      code,
      password,
      callsign,
      respawnMode,
      respawnTimeMinutes: timerMinutes,
      helicopterIntervalMinutes: helicopterInterval,
      teamId: myTeamId,
      lat: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lat : 55.751244,
      lng: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lng : 37.618423
    }, (res) => {
      const finalCode = res.lobbyCode;
      AppStorage.setLastLobby(finalCode);
      handleJoinSuccess(finalCode, res.playerId, res.lobby);

      // Загрузка карты KMZ или полигона по умолчанию
      if (kmzFileInput && kmzFileInput.files && kmzFileInput.files[0]) {
        uploadKmzFile(kmzFileInput.files[0]);
      } else if (window.DEFAULT_POLYGON_GEOJSON) {
        TacticalMap.renderBoundary(window.DEFAULT_POLYGON_GEOJSON);
        TacticalNetwork.broadcastKMZ(window.DEFAULT_POLYGON_GEOJSON, 'Полигон Лесной Бор');
        AppStorage.saveBoundary(finalCode, window.DEFAULT_POLYGON_GEOJSON, 'Полигон Лесной Бор');
      }
    });
  };

  // УСПЕШНЫЙ ВХОД В ЛОББИ
  function handleJoinSuccess(code, playerId, lobby) {
    currentLobbyCode = code;
    myPlayerId = playerId;
    currentLobbyData = lobby;
    TacticalMap.myPlayerId = playerId;

    const me = lobby.players[playerId];
    if (me) {
      myRole = me.role;
      myTeamId = me.teamId;
    }

    // Обновляем верхний HUD
    hudLobbyCode.textContent = `ЛОББИ: ${code}`;
    hudPlayerBadge.style.display = 'flex';
    hudCallsignDisplay.textContent = myCallsign;
    updateRoleIcon();
    updateOnlinePlayersCount();

    // Скрываем окно авторизации и показываем панель статуса
    modalAuth.classList.add('hidden');
    statusBar.style.display = 'flex';

    // Настройка респауна
    RespawnManager.init({
      mode: lobby.respawnMode,
      timerMinutes: lobby.respawnTimeMinutes,
      helicopterIntervalMinutes: lobby.helicopterIntervalMinutes,
      onExitConfirmed: () => {
        setLocalStatus('alive');
        showToast('Вы вернулись в бой!', '#00ff9d');
      }
    });

    // Проверка прав капитана/организатора для отображения кнопок
    updatePermissionButtons();

    // Загрузка границ полигона
    if (lobby.boundary) {
      TacticalMap.renderBoundary(lobby.boundary);
      AppStorage.saveBoundary(code, lobby.boundary, lobby.boundaryFileName);
    } else if (window.DEFAULT_POLYGON_GEOJSON) {
      TacticalMap.renderBoundary(window.DEFAULT_POLYGON_GEOJSON);
      AppStorage.saveBoundary(code, window.DEFAULT_POLYGON_GEOJSON, 'Полигон Лесной Бор');
    }

    // Отрисовка всех текущих игроков на карте
    renderAllPlayers(lobby);

    // Отрисовка существующих тактических маркеров
    if (lobby.tacticalMarkers) {
      lobby.tacticalMarkers.forEach(m => {
        TacticalMap.addTacticalMarker(m, (markerId) => {
          TacticalNetwork.removeTacticalMarker(markerId);
        });
      });
    }

    // Запуск высокоточного GPS трекинга
    TacticalGPS.init((coords) => {
      if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[myPlayerId]) {
        currentLobbyData.players[myPlayerId].lat = coords.lat;
        currentLobbyData.players[myPlayerId].lng = coords.lng;
        currentLobbyData.players[myPlayerId].heading = coords.heading;
        currentLobbyData.players[myPlayerId].accuracy = coords.accuracy;
        TacticalMap.updatePlayerMarker(currentLobbyData.players[myPlayerId], getTeamColor(myTeamId));
      }

      // Индикация точности GPS в HUD
      if (hudGpsAccuracy && coords.accuracy) {
        hudGpsAccuracy.style.display = 'block';
        hudGpsAccuracy.textContent = `🛰️ GPS: ±${coords.accuracy}м`;
        if (coords.accuracy <= 6) {
          hudGpsAccuracy.style.color = 'var(--color-green)';
        } else if (coords.accuracy <= 15) {
          hudGpsAccuracy.style.color = 'var(--color-blue)';
        } else {
          hudGpsAccuracy.style.color = 'var(--color-yellow)';
        }
      }

      TacticalNetwork.sendGPS(coords);
    });

    showToast(`Вы вошли в игру #${code}!`, '#00ff9d');
  }

  // Счетчик бойцов в HUD
  function updateOnlinePlayersCount() {
    if (currentLobbyData && currentLobbyData.players && hudPlayersCount) {
      const count = Object.keys(currentLobbyData.players).length;
      hudPlayersCount.style.display = 'block';
      hudPlayersCount.textContent = `👥 ${count}`;
    }
  }

  // Обновление иконки роли бойца в HUD
  function updateRoleIcon() {
    if (myRole === 'organizer') {
      hudRoleIcon.textContent = '👑';
    } else if (myRole === 'captain') {
      hudRoleIcon.textContent = '⭐';
    } else {
      hudRoleIcon.textContent = '👤';
    }
  }

  function updatePermissionButtons() {
    if (myRole === 'organizer') {
      btnOrganizerPanel.style.display = 'flex';
      btnAddTactical.style.display = 'flex';
    } else if (myRole === 'captain') {
      btnOrganizerPanel.style.display = 'none';
      btnAddTactical.style.display = 'flex';
    } else {
      btnOrganizerPanel.style.display = 'none';
      btnAddTactical.style.display = 'none';
    }
  }

  function getTeamColor(teamId) {
    if (!currentLobbyData || !currentLobbyData.teams) return '#f59e0b';
    const team = currentLobbyData.teams.find(t => t.id === teamId);
    return team ? team.color : '#f59e0b';
  }

  function renderAllPlayers(lobby) {
    if (!lobby || !lobby.players) return;
    Object.values(lobby.players).forEach(player => {
      TacticalMap.updatePlayerMarker(player, getTeamColor(player.teamId));
    });
    updateOnlinePlayersCount();
  }

  // МГНОВЕННОЕ ЛОКАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ СТАТУСА БОЙЦА (Один клик под перчатки)
  function setLocalStatus(status) {
    // 1. Мгновенно подсвечиваем нужную кнопку
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });

    // 2. Управляем баннером респауна и звуками
    if (status === 'respawn') {
      respawnBanner.classList.remove('hidden');
      if (RespawnManager.mode === 'timer') {
        RespawnManager.startIndividualTimer();
      }
    } else if (status === 'alive') {
      respawnBanner.classList.add('hidden');
    } else if (status === 'hit') {
      TacticalAudio.playHitSound();
    }

    // 3. Мгновенно обновляем свою метку на карте
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[myPlayerId]) {
      currentLobbyData.players[myPlayerId].status = status;
      TacticalMap.updatePlayerMarker(currentLobbyData.players[myPlayerId], getTeamColor(myTeamId));
    }

    // 4. Отправляем в облачный шлюз
    TacticalNetwork.sendStatus(status);
  }

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = () => {
      const status = btn.dataset.status;
      TacticalAudio.playClick();
      setLocalStatus(status);
    };
  });

  // Отклонение авторизации по паролю
  TacticalNetwork.on('auth:rejected', (data) => {
    alert(data.reason || 'Ошибка авторизации: неверный пароль лобби!');
    modalAuth.classList.remove('hidden');
    statusBar.style.display = 'none';
  });

  // СЕТЕВЫЕ СОБЫТИЯ ОБЛАЧНОГО ШЛЮЗА (TACTICAL NETWORK)

  // Обновление карты полигона
  TacticalNetwork.on('kmz:updated', (data) => {
    TacticalMap.renderBoundary(data.boundary);
    AppStorage.saveBoundary(currentLobbyCode, data.boundary, data.fileName);
    showToast(`🗺️ Карта «${data.fileName}» сохранена на устройство!`, '#00ff9d');
    if (kmzStatusText) kmzStatusText.textContent = `Загружен: ${data.fileName}`;
  });

  // Новый игрок подключился
  TacticalNetwork.on('player:joined', (data) => {
    if (currentLobbyData && currentLobbyData.players) {
      currentLobbyData.players[data.player.id] = data.player;
    }
    TacticalMap.updatePlayerMarker(data.player, getTeamColor(data.player.teamId));
    showToast(`Боец ${data.player.callsign} вошел в игру`, getTeamColor(data.player.teamId));
    updateOnlinePlayersCount();
    renderOrganizerPlayersList();
  });

  // Перемещение игрока
  TacticalNetwork.on('player:moved', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      const p = currentLobbyData.players[data.playerId];
      p.lat = data.lat;
      p.lng = data.lng;
      p.heading = data.heading;
      p.speed = data.speed;
      p.accuracy = data.accuracy;
      TacticalMap.updatePlayerMarker(p, getTeamColor(p.teamId));
    }
  });

  // Смена статуса бойца
  TacticalNetwork.on('player:status_changed', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      const p = currentLobbyData.players[data.playerId];
      p.status = data.status;
      p.respawnStartTime = data.respawnStartTime;
      TacticalMap.updatePlayerMarker(p, getTeamColor(p.teamId));
    }

    if (data.status === 'hit') {
      showToast(`💀 ${data.callsign} поражен!`, '#ff334b');
    } else if (data.status === 'alive') {
      showToast(`🟢 ${data.callsign} вернулся в строй!`, '#00ff9d');
    }
  });

  // Назначение капитана
  TacticalNetwork.on('team:captain_updated', (data) => {
    if (data.targetPlayerId === myPlayerId) {
      myRole = data.newRole;
      updateRoleIcon();
      updatePermissionButtons();
      if (myRole === 'captain') {
        showToast('⭐ Вы назначены капитаном стороны!', '#f59e0b');
      }
    }
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.targetPlayerId]) {
      currentLobbyData.players[data.targetPlayerId].role = data.newRole;
      TacticalMap.updatePlayerMarker(currentLobbyData.players[data.targetPlayerId], getTeamColor(currentLobbyData.players[data.targetPlayerId].teamId));
    }
    renderOrganizerPlayersList();
  });

  // Добавление тактической метки
  TacticalNetwork.on('tactical:marker_added', (data) => {
    TacticalMap.addTacticalMarker(data.marker, (markerId) => {
      TacticalNetwork.removeTacticalMarker(markerId);
    });
    TacticalAudio.playTacticalAlert();
    showToast(`📍 [${data.marker.authorCallsign}]: ${data.marker.title}`, '#f59e0b');
  });

  // Удаление тактической метки
  TacticalNetwork.on('tactical:marker_removed', (data) => {
    TacticalMap.removeTacticalMarker(data.markerId);
  });

  // Кнопка подтверждения выхода из мертвяка
  btnRespawnExit.onclick = () => {
    RespawnManager.confirmExit();
  };

  // Переключение слоя спутник / схема
  btnLayerToggle.onclick = () => {
    TacticalAudio.playClick();
    const mode = TacticalMap.toggleMapLayer();
    showToast(`Режим карты: ${mode === 'satellite' ? 'Спутник' : 'Топография'}`, '#00bfff');
  };

  // Слежение за GPS
  btnGpsFollow.onclick = () => {
    TacticalAudio.playClick();
    TacticalMap.centerOnMe();
    btnGpsFollow.classList.add('active');
  };

  // КНОПКА ШТАБА ОРГАНИЗАТОРА
  btnOrganizerPanel.onclick = () => {
    TacticalAudio.playClick();
    renderOrganizerPlayersList();
    modalOrganizer.classList.remove('hidden');
  };
  btnCloseOrganizer.onclick = () => {
    modalOrganizer.classList.add('hidden');
  };

  function uploadKmzFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      showToast('Обработка карты полигона...', '#00bfff');
      const text = event.target.result;

      if (typeof text === 'string' && text.includes('<kml')) {
        const boundary = parseKmlRegex(text);
        if (boundary && boundary.features.length > 0) {
          TacticalMap.renderBoundary(boundary);
          TacticalNetwork.broadcastKMZ(boundary, file.name);
          AppStorage.saveBoundary(currentLobbyCode, boundary, file.name);
          showToast(`Полигон «${file.name}» разослан всем бойцам!`, '#00ff9d');
          return;
        }
      }

      if (window.DEFAULT_POLYGON_GEOJSON) {
        TacticalMap.renderBoundary(window.DEFAULT_POLYGON_GEOJSON);
        TacticalNetwork.broadcastKMZ(window.DEFAULT_POLYGON_GEOJSON, file.name || 'Полигон Лесной Бор');
        AppStorage.saveBoundary(currentLobbyCode, window.DEFAULT_POLYGON_GEOJSON, file.name);
        showToast(`Полигон «${file.name}» успешно применен!`, '#00ff9d');
      }
    };

    if (file.name.endsWith('.kml')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  function parseKmlRegex(kmlText) {
    const features = [];
    const coordRegex = /<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let match;
    while ((match = coordRegex.exec(kmlText)) !== null) {
      const raw = match[1].trim().split(/\s+/);
      const coords = [];
      raw.forEach(pt => {
        const parts = pt.split(',').map(n => parseFloat(n.trim()));
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          coords.push([parts[0], parts[1]]);
        }
      });
      if (coords.length > 2) {
        if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
          coords.push([coords[0][0], coords[0][1]]);
        }
        features.push({
          type: 'Feature',
          properties: { name: 'Граница полигона', stroke: '#00ff9d', 'stroke-width': 2, fill: '#00ff9d', 'fill-opacity': 0.15 },
          geometry: { type: 'Polygon', coordinates: [coords] }
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }

  // Рендер списка бойцов в панели орга
  function renderOrganizerPlayersList() {
    if (!organizerPlayersList || !currentLobbyData || !currentLobbyData.players) return;
    organizerPlayersList.innerHTML = '';

    Object.values(currentLobbyData.players).forEach(p => {
      const isCaptain = p.role === 'captain';
      const isOrg = p.role === 'organizer';
      const teamColor = getTeamColor(p.teamId);

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; border-left: 4px solid ' + teamColor;

      row.innerHTML = `
        <div>
          <b style="color: #fff; font-size: 13px;">${p.callsign}</b> 
          <span style="font-size: 11px; color: ${teamColor};">(${p.teamId})</span>
          <span style="font-size: 11px; color: var(--text-dim); margin-left: 6px;">[${isOrg ? 'Орг' : (isCaptain ? 'Капитан' : 'Боец')}]</span>
        </div>
        <div>
          ${!isOrg ? `
            <button class="btn-secondary" style="padding: 6px 10px; font-size: 11px; border-radius: 6px;" id="btn_capt_${p.id}">
              ${isCaptain ? 'Снять капитана' : 'Сделать капитаном'}
            </button>
          ` : '<span style="font-size: 11px; color: var(--color-green); font-weight: 700;">Хост</span>'}
        </div>
      `;

      organizerPlayersList.appendChild(row);

      const captBtn = document.getElementById(`btn_capt_${p.id}`);
      if (captBtn) {
        captBtn.onclick = () => {
          TacticalNetwork.setCaptain(p.id, p.teamId, !isCaptain);
        };
      }
    });
  }

  // КНОПКА ТАКТИЧЕСКОЙ МЕТКИ (Капитан / Орг)
  btnAddTactical.onclick = () => {
    TacticalAudio.playClick();
    modalTactical.classList.remove('hidden');
  };
  btnCloseTactical.onclick = () => {
    modalTactical.classList.add('hidden');
  };

  btnSubmitTactical.onclick = () => {
    const type = document.getElementById('select-marker-type').value;
    const desc = document.getElementById('input-marker-desc').value.trim();
    const posType = document.getElementById('select-marker-pos').value;

    let targetLat, targetLng;
    if (posType === 'gps' && TacticalGPS.currentCoords) {
      targetLat = TacticalGPS.currentCoords.lat;
      targetLng = TacticalGPS.currentCoords.lng;
    } else {
      const center = TacticalMap.map.getCenter();
      targetLat = center.lat;
      targetLng = center.lng;
    }

    const typeNames = {
      enemy: 'Враг замечен',
      attack: 'Атака сюда',
      defend: 'Оборона рубежа',
      rally: 'Точка сбора',
      sos: 'Нужна помощь'
    };

    const marker = {
      id: 'm_' + Math.random().toString(36).substring(2, 9),
      type,
      title: typeNames[type] || 'Метка',
      description: desc,
      authorId: myPlayerId,
      authorCallsign: myCallsign,
      teamId: myTeamId,
      lat: targetLat,
      lng: targetLng,
      createdAt: Date.now()
    };

    TacticalNetwork.addTacticalMarker(marker);
    modalTactical.classList.add('hidden');
    document.getElementById('input-marker-desc').value = '';
    showToast('Метка установлена!', '#f59e0b');
  };

  // Кнопка меню в хедере
  document.getElementById('btn-menu').onclick = () => {
    if (confirm('Выйти из текущей игровой сессии?')) {
      location.reload();
    }
  };

  // Функция вывода тактических всплывающих сообщений (Toast)
  function showToast(text, color = '#00ff9d') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.style.setProperty('--toast-color', color);
    toast.textContent = text;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, 3500);
  }

  window.showToast = showToast;
})();
