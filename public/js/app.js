/**
 * Главный координатор клиентской логики StrikeTac (v3.0)
 * Полная поддержка выделенного сокет-сервера, авто-переподключение при обрыве сети,
 * устойчивая сессия бойцов, спутник Google Hybrid, кнопка выхода и защита от задвоения.
 */
(function() {
  let myPlayerId = null;
  let currentLobbyCode = null;
  let myRole = 'fighter'; // 'organizer', 'captain', 'fighter'
  let myTeamId = 'yellow';
  let myCallsign = '';
  let currentLobbyData = null;

  // DOM Элементы: HUD
  const netStatusDot = document.getElementById('net-status-dot');
  const hudLobbyCode = document.getElementById('hud-lobby-code');
  const hudPlayerBadge = document.getElementById('hud-player-badge');
  const hudCallsignDisplay = document.getElementById('hud-callsign-display');
  const hudRoleIcon = document.getElementById('hud-role-icon');
  const hudGpsAccuracy = document.getElementById('hud-gps-accuracy');
  const hudPlayersCount = document.getElementById('hud-players-count');
  const btnLayerToggle = document.getElementById('btn-layer-toggle');
  const btnLeaveLobby = document.getElementById('btn-leave-lobby');
  const btnMenu = document.getElementById('btn-menu');

  // Баннер обрыва связи
  const reconnectBanner = document.getElementById('reconnect-banner');
  const reconnectText = document.getElementById('reconnect-text');
  const btnReconnectNow = document.getElementById('btn-reconnect-now');

  // Окно авторизации / входа
  const modalAuth = document.getElementById('modal-auth');
  const tabBtnJoin = document.getElementById('tab-btn-join');
  const tabBtnCreate = document.getElementById('tab-btn-create');
  const formJoin = document.getElementById('form-join');
  const formCreate = document.getElementById('form-create');
  const btnSubmitJoin = document.getElementById('btn-submit-join');
  const btnSubmitCreate = document.getElementById('btn-submit-create');
  const authNetBanner = document.getElementById('auth-net-banner');
  const authNetText = document.getElementById('auth-net-text');

  // Панель настройки сервера
  const btnToggleServerSettings = document.getElementById('btn-toggle-server-settings');
  const serverSettingsPanel = document.getElementById('server-settings-panel');
  const inputCustomServerUrl = document.getElementById('input-custom-server-url');
  const btnSaveServerUrl = document.getElementById('btn-save-server-url');
  const btnResetServerUrl = document.getElementById('btn-reset-server-url');
  const serverConnStatus = document.getElementById('server-conn-status');

  // Игровые панели
  const statusBar = document.getElementById('status-bar');
  const respawnBanner = document.getElementById('respawn-banner');
  const btnRespawnExit = document.getElementById('btn-respawn-exit');
  const btnGpsFollow = document.getElementById('btn-gps-follow');
  const btnAddTactical = document.getElementById('btn-add-tactical');
  const btnOrganizerPanel = document.getElementById('btn-organizer-panel');

  // Модальное тактическое меню
  const modalTacticalMenu = document.getElementById('modal-tactical-menu');
  const btnCloseMenu = document.getElementById('btn-close-menu');
  const menuLobbyCode = document.getElementById('menu-lobby-code');
  const menuCallsign = document.getElementById('menu-callsign');
  const menuTeam = document.getElementById('menu-team');
  const menuServerUrl = document.getElementById('menu-server-url');
  const menuBtnFitPlayers = document.getElementById('menu-btn-fit-players');
  const menuLayerGoogle = document.getElementById('menu-layer-google');
  const menuLayerOsm = document.getElementById('menu-layer-osm');
  const menuLayerEsri = document.getElementById('menu-layer-esri');
  const menuBtnReconnect = document.getElementById('menu-btn-reconnect');
  const menuBtnOrganizer = document.getElementById('menu-btn-organizer');
  const menuBtnLeave = document.getElementById('menu-btn-leave');

  // Панель организатора
  const modalOrganizer = document.getElementById('modal-organizer');
  const btnCloseOrganizer = document.getElementById('btn-close-organizer');
  const inputUploadKmz = document.getElementById('input-upload-kmz-field');
  const uploadKmzLabel = document.getElementById('upload-kmz-label');
  const kmzStatusText = document.getElementById('kmz-status-text');
  const organizerPlayersList = document.getElementById('organizer-players-list');
  const inputCreateKmz = document.getElementById('input-create-kmz');
  const createKmzLabel = document.getElementById('create-kmz-label');

  // Тактическая метка
  const modalTactical = document.getElementById('modal-tactical-marker');
  const btnCloseTactical = document.getElementById('btn-close-tactical');
  const btnSubmitTactical = document.getElementById('btn-submit-tactical-marker');

  // Алерт / Ошибка
  const modalTacticalAlert = document.getElementById('modal-tactical-alert');
  const alertIcon = document.getElementById('alert-icon');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const btnCloseAlert = document.getElementById('btn-close-alert');

  function showTacticalAlert(title, message, isError = true) {
    if (!modalTacticalAlert) {
      alert(message);
      return;
    }
    if (alertTitle) alertTitle.textContent = title || (isError ? 'ОШИБКА' : 'УВЕДОМЛЕНИЕ');
    if (alertIcon) alertIcon.textContent = isError ? '❌' : 'ℹ️';
    if (alertMessage) alertMessage.textContent = message;
    modalTacticalAlert.classList.remove('hidden');
    if (window.TacticalAudio) TacticalAudio.playHitSound();
  }

  if (btnCloseAlert && modalTacticalAlert) {
    btnCloseAlert.onclick = () => {
      modalTacticalAlert.classList.add('hidden');
      if (window.TacticalAudio) TacticalAudio.playClick();
    };
  }

  // 1. Инициализация карты (спутник Google Hybrid по умолчанию)
  TacticalMap.init('map');

  // 2. Инициализация настроек сервера
  function updateServerDisplay() {
    const currentUrl = AppStorage.getServerUrl();
    if (inputCustomServerUrl) {
      inputCustomServerUrl.value = currentUrl;
    }
    if (serverConnStatus) {
      const isAuto = !localStorage.getItem(AppStorage.KEYS.SERVER_URL);
      serverConnStatus.textContent = `${isAuto ? 'Авто: ' : 'Пользовательский: '} ${currentUrl}`;
    }
    if (menuServerUrl) {
      menuServerUrl.textContent = currentUrl;
    }
  }
  updateServerDisplay();

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
      updateServerDisplay();
      showToast('Адрес сервера сохранен! Переподключение...', '#00ff9d');
      TacticalNetwork.connect();
    };
  }

  if (btnResetServerUrl) {
    btnResetServerUrl.onclick = () => {
      const autoUrl = AppStorage.resetToAutoServerUrl();
      updateServerDisplay();
      showToast(`Сброшено на текущий адрес сайта: ${autoUrl}`, '#00ff9d');
      TacticalNetwork.connect();
    };
  }

  // Загрузка сохраненного позывного и кода лобби
  const savedCallsign = AppStorage.getCallsign();
  if (savedCallsign) {
    const inpJoin = document.getElementById('input-join-callsign');
    const inpCreate = document.getElementById('input-create-callsign');
    if (inpJoin) inpJoin.value = savedCallsign;
    if (inpCreate) inpCreate.value = savedCallsign;
  }
  const savedLobby = AppStorage.getLastLobby();
  if (savedLobby) {
    const inpCode = document.getElementById('input-join-code');
    if (inpCode) inpCode.value = savedLobby;
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

  // 3. Обновление статуса сети
  function updateNetStatusDisplay(online, info = '') {
    if (online) {
      if (netStatusDot) {
        netStatusDot.classList.remove('offline');
        netStatusDot.title = 'Сервер в сети: ' + TacticalNetwork.serverUrl;
      }
      if (authNetBanner) {
        authNetBanner.className = 'auth-net-banner online';
        if (authNetText) authNetText.textContent = info || 'Сервер активен: Онлайн ⚡';
      }
      if (serverConnStatus) {
        serverConnStatus.textContent = info || 'Сервер активен (Онлайн)';
        serverConnStatus.style.color = 'var(--color-green)';
      }
      if (reconnectBanner) {
        reconnectBanner.classList.add('hidden');
      }
      if (btnSubmitJoin) btnSubmitJoin.disabled = false;
      if (btnSubmitCreate) btnSubmitCreate.disabled = false;
    } else {
      if (netStatusDot) {
        netStatusDot.classList.add('offline');
        netStatusDot.title = 'Связь с сервером прервана';
      }
      if (authNetBanner) {
        authNetBanner.className = 'auth-net-banner offline';
        if (authNetText) authNetText.textContent = info || 'Связь с сервером прервана...';
      }
      if (serverConnStatus) {
        serverConnStatus.textContent = info || 'Связь с сервером отсутствует';
        serverConnStatus.style.color = 'var(--color-red)';
      }
      // Если игрок сейчас в активной игре — показываем плавающий баннер реконнекта
      if (currentLobbyCode && reconnectBanner) {
        reconnectBanner.classList.remove('hidden');
        if (reconnectText) reconnectText.textContent = 'Потеря связи с сервером. Ожидание сети...';
      }
    }
  }

  // 4. Подключение к выделенному серверу StrikeTac
  TacticalNetwork.connect(
    (connUrl) => {
      const displayHost = connUrl.replace(/^https?:\/\//, '');
      updateNetStatusDisplay(true, `⚡ Сервер StrikeTac: ${displayHost} (Онлайн)`);
    },
    (err) => {
      updateNetStatusDisplay(false, 'Связь с сервером прервана, переподключение...');
    }
  );

  // Сетевые слушатели состояния соединения
  TacticalNetwork.on('connection:status', (isConnected) => {
    if (isConnected) {
      updateNetStatusDisplay(true);
    } else {
      updateNetStatusDisplay(false);
    }
  });

  TacticalNetwork.on('connection:reconnecting', (attempt) => {
    if (currentLobbyCode && reconnectBanner) {
      reconnectBanner.classList.remove('hidden');
      if (reconnectText) reconnectText.textContent = `Переподключение к серверу (попытка #${attempt})...`;
    }
  });

  TacticalNetwork.on('connection:restored', () => {
    showToast('Связь с сервером восстановлена! ⚡', '#00ff9d');
    if (reconnectBanner) reconnectBanner.classList.add('hidden');
  });

  TacticalNetwork.on('connection:lost', () => {
    if (currentLobbyCode) {
      showToast('⚠️ Потеря связи с сервером. Авто-переподключение...', '#ff334b');
    }
  });

  // Кнопка немедленного переподключения
  if (btnReconnectNow) {
    btnReconnectNow.onclick = () => {
      TacticalNetwork.reconnect();
      showToast('Попытка переподключения к серверу...', '#00bfff');
    };
  }

  // Переключение вкладок входа / создания
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

  if (selectRespawnMode) {
    selectRespawnMode.onchange = () => {
      const mode = selectRespawnMode.value;
      if (mode === 'helicopter') {
        if (groupHelicopter) groupHelicopter.style.display = 'block';
        if (groupTimer) groupTimer.style.display = 'none';
      } else if (mode === 'timer') {
        if (groupHelicopter) groupHelicopter.style.display = 'none';
        if (groupTimer) groupTimer.style.display = 'block';
      } else {
        if (groupHelicopter) groupHelicopter.style.display = 'none';
        if (groupTimer) groupTimer.style.display = 'none';
      }
    };
  }

  // 5. Вход в существующую игру
  formJoin.onsubmit = (e) => {
    e.preventDefault();
    const code = document.getElementById('input-join-code').value.trim().toUpperCase();
    const callsign = document.getElementById('input-join-callsign').value.trim();
    const password = document.getElementById('input-join-password').value.trim();

    if (!code || !callsign) {
      showTacticalAlert('ВНИМАНИЕ', 'Пожалуйста, введите код игры и ваш позывной', false);
      return;
    }
    if (!password) {
      showTacticalAlert('ТРЕБУЕТСЯ ПАРОЛЬ', 'Введите пароль лобби, заданный организатором!', true);
      return;
    }

    if (!TacticalNetwork.isConnected) {
      showTacticalAlert('СЕТЬ НЕ ГОТОВА', 'Связь с сервером устанавливается. Подождите 1-2 секунды или нажмите «Авто» в настройках сервера...', false);
      TacticalNetwork.connect();
      return;
    }

    AppStorage.setCallsign(callsign);
    AppStorage.setLastLobby(code);
    myCallsign = callsign;

    if (btnSubmitJoin) {
      btnSubmitJoin.disabled = true;
      btnSubmitJoin.innerHTML = '⏳ ВХОД В ЛОББИ...';
    }

    TacticalNetwork.joinLobby({
      code,
      callsign,
      teamId: myTeamId,
      password,
      lat: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lat : 55.751244,
      lng: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lng : 37.618423
    }, (res) => {
      if (btnSubmitJoin) {
        btnSubmitJoin.disabled = false;
        btnSubmitJoin.innerHTML = 'ВОЙТИ В ИГРУ ⚡';
      }
      const isRecon = res.isReconnected;
      showToast(isRecon ? `✅ Сессия восстановлена! С возвращением, ${callsign}!` : `✅ Вход в лобби #${res.lobbyCode}...`, '#00ff9d');
      handleJoinSuccess(res.lobbyCode || code, res.playerId, res.lobby);
    }, (errReason) => {
      if (btnSubmitJoin) {
        btnSubmitJoin.disabled = false;
        btnSubmitJoin.innerHTML = 'ВОЙТИ В ИГРУ ⚡';
      }
      showTacticalAlert('ДОСТУП ЗАПРЕЩЕН', errReason || 'Неверный пароль или лобби не найдено', true);
    });
  };

  // 6. Создание новой игры организатором
  formCreate.onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('input-create-name').value.trim();
    const code = document.getElementById('input-create-code').value.trim().toUpperCase();
    const password = document.getElementById('input-create-password').value.trim();
    const callsign = document.getElementById('input-create-callsign').value.trim();
    const respawnMode = selectRespawnMode ? selectRespawnMode.value : 'helicopter';
    const helicopterInterval = parseInt(document.getElementById('select-helicopter-interval').value) || 15;
    const timerMinutes = parseInt(document.getElementById('input-timer-minutes').value) || 15;
    const kmzFileInput = document.getElementById('input-create-kmz');

    if (!password) {
      showTacticalAlert('ТРЕБУЕТСЯ ПАРОЛЬ', 'Пожалуйста, задайте пароль игры для бойцов!', true);
      return;
    }

    if (!TacticalNetwork.isConnected) {
      showTacticalAlert('СЕТЬ НЕ ГОТОВА', 'Связь с сервером устанавливается. Подождите пару секунд...', false);
      TacticalNetwork.connect();
      return;
    }

    AppStorage.setCallsign(callsign);
    myCallsign = callsign;

    if (btnSubmitCreate) {
      btnSubmitCreate.disabled = true;
      btnSubmitCreate.innerHTML = '⏳ СОЗДАНИЕ ЛОББИ...';
    }

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
      if (btnSubmitCreate) {
        btnSubmitCreate.disabled = false;
        btnSubmitCreate.innerHTML = 'СОЗДАТЬ ЛОББИ И СТАТЬ ХОСТОМ 👑';
      }
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
    }, (errReason) => {
      if (btnSubmitCreate) {
        btnSubmitCreate.disabled = false;
        btnSubmitCreate.innerHTML = 'СОЗДАТЬ ЛОББИ И СТАТЬ ХОСТОМ 👑';
      }
      showTacticalAlert('ОШИБКА СОЗДАНИЯ', errReason || 'Не удалось создать лобби', true);
    });
  };

  // 7. УСПЕШНЫЙ ВХОД В ЛОББИ
  function handleJoinSuccess(code, playerId, lobby) {
    currentLobbyCode = code;
    myPlayerId = playerId;
    currentLobbyData = lobby;
    TacticalMap.myPlayerId = playerId;

    const me = lobby.players[playerId];
    if (me) {
      myRole = me.role;
      myTeamId = me.teamId;
      myCallsign = me.callsign || myCallsign;
    }

    // Обновляем верхний HUD
    hudLobbyCode.textContent = `ЛОББИ: ${code}`;
    hudPlayerBadge.style.display = 'flex';
    hudCallsignDisplay.textContent = myCallsign;
    updateRoleIcon();
    updateOnlinePlayersCount();

    // Показываем кнопку выхода из лобби в хедере
    if (btnLeaveLobby) {
      btnLeaveLobby.style.display = 'flex';
    }

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
      if (kmzStatusText) kmzStatusText.textContent = `Загружен: ${lobby.boundaryFileName || 'Полигон'}`;
    } else if (window.DEFAULT_POLYGON_GEOJSON) {
      TacticalMap.renderBoundary(window.DEFAULT_POLYGON_GEOJSON);
      AppStorage.saveBoundary(code, window.DEFAULT_POLYGON_GEOJSON, 'Полигон Лесной Бор');
      if (kmzStatusText) kmzStatusText.textContent = 'Загружен: Полигон Лесной Бор';
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

      // Отправляем координаты союзникам (теперь без падений ошибок!)
      TacticalNetwork.sendGPS(coords);
    });

    // Если в лобби уже несколько игроков — мягко центрируем обзор на всех
    setTimeout(() => {
      if (lobby && lobby.players && Object.keys(lobby.players).length > 1) {
        TacticalMap.fitAllPlayers();
      }
    }, 600);

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
    if (!hudRoleIcon) return;
    if (myRole === 'organizer') {
      hudRoleIcon.textContent = '👑';
    } else if (myRole === 'captain') {
      hudRoleIcon.textContent = '⭐';
    } else {
      hudRoleIcon.textContent = '👤';
    }
  }

  function updatePermissionButtons() {
    const isOrg = myRole === 'organizer';
    const isCapt = myRole === 'captain';

    if (btnOrganizerPanel) btnOrganizerPanel.style.display = isOrg ? 'flex' : 'none';
    if (btnAddTactical) btnAddTactical.style.display = (isOrg || isCapt) ? 'flex' : 'none';
    if (menuBtnOrganizer) menuBtnOrganizer.style.display = isOrg ? 'block' : 'none';
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
    renderOrganizerPlayersList();
  }

  // МГНОВЕННОЕ ЛОКАЛЬНОЕ ПЕРЕКЛЮЧЕНИЕ СТАТУСА БОЙЦА
  function setLocalStatus(status) {
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });

    if (status === 'respawn') {
      respawnBanner.classList.remove('hidden');
      if (RespawnManager.mode === 'timer') {
        RespawnManager.startIndividualTimer();
      }
    } else if (status === 'alive') {
      respawnBanner.classList.add('hidden');
    } else if (status === 'hit') {
      if (window.TacticalAudio) TacticalAudio.playHitSound();
    }

    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[myPlayerId]) {
      currentLobbyData.players[myPlayerId].status = status;
      TacticalMap.updatePlayerMarker(currentLobbyData.players[myPlayerId], getTeamColor(myTeamId));
    }

    TacticalNetwork.sendStatus(status);
  }

  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = () => {
      const status = btn.dataset.status;
      if (window.TacticalAudio) TacticalAudio.playClick();
      setLocalStatus(status);
    };
  });

  // 8. ВЫХОД ИЗ ТЕКУЩЕГО ЛОББИ (ЧИСТОЕ УДАЛЕНИЕ СЕССИИ И ОЧИСТКА ЭКРАНА)
  function performLeaveLobby() {
    if (!currentLobbyCode) return;

    if (!confirm(`Вы действительно хотите покинуть игру #${currentLobbyCode}?`)) {
      return;
    }

    if (window.TacticalAudio) TacticalAudio.playClick();

    // 1. Уведомляем сервер об осознанном выходе
    TacticalNetwork.leaveLobby(() => {
      console.log('[StrikeTac] Выход из лобби подтвержден сервером.');
    });

    // 2. Останавливаем аппаратный GPS трекинг
    TacticalGPS.stop();

    // 3. Очищаем карту
    TacticalMap.clearAllPlayers();
    TacticalMap.clearAllTacticalMarkers();
    TacticalMap.clearBoundary();

    // 4. Сбрасываем локальное состояние
    const leftCode = currentLobbyCode;
    currentLobbyCode = null;
    myPlayerId = null;
    currentLobbyData = null;
    myRole = 'fighter';

    // 5. Возвращаем интерфейс в режим меню авторизации
    hudLobbyCode.textContent = 'НЕТ ИГРЫ';
    hudPlayerBadge.style.display = 'none';
    if (hudPlayersCount) hudPlayersCount.style.display = 'none';
    if (hudGpsAccuracy) hudGpsAccuracy.style.display = 'none';
    if (btnLeaveLobby) btnLeaveLobby.style.display = 'none';
    if (btnOrganizerPanel) btnOrganizerPanel.style.display = 'none';
    if (btnAddTactical) btnAddTactical.style.display = 'none';

    statusBar.style.display = 'none';
    respawnBanner.classList.add('hidden');
    if (modalTacticalMenu) modalTacticalMenu.classList.add('hidden');
    if (modalOrganizer) modalOrganizer.classList.add('hidden');
    if (reconnectBanner) reconnectBanner.classList.add('hidden');
    modalAuth.classList.remove('hidden');

    showToast(`Вы покинули лобби #${leftCode}`, '#00bfff');
  }

  if (btnLeaveLobby) {
    btnLeaveLobby.onclick = performLeaveLobby;
  }
  if (menuBtnLeave) {
    menuBtnLeave.onclick = performLeaveLobby;
  }

  // 9. СЕТЕВЫЕ СОБЫТИЯ СЕРВЕРА

  // Обновление карты полигона
  TacticalNetwork.on('kmz:updated', (data) => {
    TacticalMap.renderBoundary(data.boundary);
    AppStorage.saveBoundary(currentLobbyCode, data.boundary, data.fileName);
    showToast(`🗺️ Карта «${data.fileName}» сохранена на устройство!`, '#00ff9d');
    if (kmzStatusText) kmzStatusText.textContent = `Загружен: ${data.fileName}`;
  });

  // Новый боец подключился
  TacticalNetwork.on('player:joined', (data) => {
    if (!data || !data.player) return;
    if (currentLobbyData && currentLobbyData.players) {
      currentLobbyData.players[data.player.id] = data.player;
    }
    TacticalMap.updatePlayerMarker(data.player, getTeamColor(data.player.teamId));
    const title = data.isReconnected ? `Боец ${data.player.callsign} вернулся в строй` : `Боец ${data.player.callsign} вошел в игру`;
    showToast(title, getTeamColor(data.player.teamId));
    updateOnlinePlayersCount();
    renderOrganizerPlayersList();
  });

  TacticalNetwork.on('player:reconnected', (data) => {
    if (!data || !data.player) return;
    if (currentLobbyData && currentLobbyData.players) {
      currentLobbyData.players[data.player.id] = data.player;
    }
    TacticalMap.updatePlayerMarker(data.player, getTeamColor(data.player.teamId));
    showToast(`Боец ${data.player.callsign} на связи ⚡`, getTeamColor(data.player.teamId));
    updateOnlinePlayersCount();
    renderOrganizerPlayersList();
  });

  // Перемещение бойца (с автосозданием маркера если боец еще не был в словаре)
  TacticalNetwork.on('player:moved', (data) => {
    if (!data || !data.playerId) return;

    if (currentLobbyData && currentLobbyData.players) {
      let p = currentLobbyData.players[data.playerId];
      if (!p) {
        // Создаем бойца на основе обогащенных данных движения
        p = {
          id: data.playerId,
          callsign: data.callsign || 'Боец',
          teamId: data.teamId || 'yellow',
          role: data.role || 'fighter',
          status: data.status || 'alive',
          isOffline: false
        };
        currentLobbyData.players[data.playerId] = p;
        updateOnlinePlayersCount();
        renderOrganizerPlayersList();
      }

      p.lat = data.lat;
      p.lng = data.lng;
      p.heading = data.heading || 0;
      p.speed = data.speed || 0;
      p.accuracy = data.accuracy || 5;
      p.isOffline = false;

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

  // Боец временно ушел в оффлайн
  TacticalNetwork.on('player:offline', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      const p = currentLobbyData.players[data.playerId];
      p.isOffline = true;
      TacticalMap.updatePlayerMarker(p, getTeamColor(p.teamId));
      renderOrganizerPlayersList();
      showToast(`⚠️ Боец ${data.callsign} потерял связь`, '#ffb700');
    }
  });

  // Боец покинул лобби или удален по таймауту
  TacticalNetwork.on('player:left', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      delete currentLobbyData.players[data.playerId];
      TacticalMap.removePlayerMarker(data.playerId);
      updateOnlinePlayersCount();
      renderOrganizerPlayersList();
      const reason = data.reason === 'kicked' ? 'исключен организатором' : 'покинул лобби';
      showToast(`🚪 ${data.callsign || 'Боец'} ${reason}`, '#ff334b');
    }
  });

  // Восстановление сессии
  TacticalNetwork.on('lobby:rejoined', (res) => {
    if (res && res.lobby) {
      currentLobbyData = res.lobby;
      renderAllPlayers(res.lobby);
      updateOnlinePlayersCount();
      showToast('Синхронизация лобби завершена!', '#00ff9d');
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
    if (window.TacticalAudio) TacticalAudio.playTacticalAlert();
    showToast(`📍 [${data.marker.authorCallsign}]: ${data.marker.title}`, '#f59e0b');
  });

  // Удаление тактической метки
  TacticalNetwork.on('tactical:marker_removed', (data) => {
    TacticalMap.removeTacticalMarker(data.markerId);
  });

  // Кнопка подтверждения выхода из мертвяка
  if (btnRespawnExit) {
    btnRespawnExit.onclick = () => {
      RespawnManager.confirmExit();
    };
  }

  // 10. ПЕРЕКЛЮЧЕНИЕ СЛОЕВ КАРТЫ
  if (btnLayerToggle) {
    btnLayerToggle.onclick = () => {
      if (window.TacticalAudio) TacticalAudio.playClick();
      const res = TacticalMap.toggleMapLayer();
      updateMenuLayerButtons(res.id);
      showToast(`Режим карты: ${res.name}`, '#00bfff');
    };
  }

  function updateMenuLayerButtons(activeId) {
    if (menuLayerGoogle) menuLayerGoogle.classList.toggle('active', activeId === 'google');
    if (menuLayerOsm) menuLayerOsm.classList.toggle('active', activeId === 'osm');
    if (menuLayerEsri) menuLayerEsri.classList.toggle('active', activeId === 'esri');
  }

  if (menuLayerGoogle) {
    menuLayerGoogle.onclick = () => {
      TacticalMap.setLayer('google');
      updateMenuLayerButtons('google');
      showToast('Включен: Гугл Спутник (Гибрид)', '#00bfff');
    };
  }
  if (menuLayerOsm) {
    menuLayerOsm.onclick = () => {
      TacticalMap.setLayer('osm');
      updateMenuLayerButtons('osm');
      showToast('Включен: Топо-схема (OSM)', '#00bfff');
    };
  }
  if (menuLayerEsri) {
    menuLayerEsri.onclick = () => {
      TacticalMap.setLayer('esri');
      updateMenuLayerButtons('esri');
      showToast('Включен: Esri ArcGIS Спутник', '#00bfff');
    };
  }

  // Слежение за своим положением
  if (btnGpsFollow) {
    btnGpsFollow.onclick = () => {
      if (window.TacticalAudio) TacticalAudio.playClick();
      TacticalMap.centerOnMe();
      btnGpsFollow.classList.add('active');
    };
  }

  // Центрирование на всех бойцах полигона по клику на счетчик бойцов
  if (hudPlayersCount) {
    hudPlayersCount.onclick = () => {
      if (window.TacticalAudio) TacticalAudio.playClick();
      TacticalMap.fitAllPlayers();
      showToast('Обзор всех бойцов полигона', '#00bfff');
    };
  }

  // 11. ТАКТИЧЕСКОЕ МЕНЮ
  function openTacticalMenu() {
    if (window.TacticalAudio) TacticalAudio.playClick();
    if (menuLobbyCode) menuLobbyCode.textContent = currentLobbyCode || 'НЕТ ИГРЫ';
    if (menuCallsign) menuCallsign.textContent = myCallsign || 'Боец';
    if (menuTeam) menuTeam.textContent = myTeamId || 'Желтые';
    if (menuServerUrl) menuServerUrl.textContent = TacticalNetwork.serverUrl || 'Авто';
    updateMenuLayerButtons(TacticalMap.currentBaseLayer);

    if (modalTacticalMenu) modalTacticalMenu.classList.remove('hidden');
  }

  if (btnMenu) {
    btnMenu.onclick = openTacticalMenu;
  }
  if (btnCloseMenu) {
    btnCloseMenu.onclick = () => {
      if (modalTacticalMenu) modalTacticalMenu.classList.add('hidden');
    };
  }
  if (menuBtnFitPlayers) {
    menuBtnFitPlayers.onclick = () => {
      TacticalMap.fitAllPlayers();
      if (modalTacticalMenu) modalTacticalMenu.classList.add('hidden');
      showToast('Обзор всех бойцов полигона', '#00bfff');
    };
  }
  if (menuBtnReconnect) {
    menuBtnReconnect.onclick = () => {
      TacticalNetwork.reconnect();
      showToast('Проверка и переподключение к серверу...', '#00bfff');
    };
  }
  if (menuBtnOrganizer) {
    menuBtnOrganizer.onclick = () => {
      if (modalTacticalMenu) modalTacticalMenu.classList.add('hidden');
      renderOrganizerPlayersList();
      if (modalOrganizer) modalOrganizer.classList.remove('hidden');
    };
  }

  // 12. ШТАБ ОРГАНИЗАТОРА
  if (btnOrganizerPanel) {
    btnOrganizerPanel.onclick = () => {
      if (window.TacticalAudio) TacticalAudio.playClick();
      renderOrganizerPlayersList();
      if (modalOrganizer) modalOrganizer.classList.remove('hidden');
    };
  }
  if (btnCloseOrganizer) {
    btnCloseOrganizer.onclick = () => {
      if (modalOrganizer) modalOrganizer.classList.add('hidden');
    };
  }

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

  // Рендер списка бойцов в панели орга (с кнопками назначения капитана и кика)
  function renderOrganizerPlayersList() {
    if (!organizerPlayersList || !currentLobbyData || !currentLobbyData.players) return;
    organizerPlayersList.innerHTML = '';

    Object.values(currentLobbyData.players).forEach(p => {
      const isCaptain = p.role === 'captain';
      const isOrg = p.role === 'organizer';
      const isOffline = !!p.isOffline;
      const teamColor = getTeamColor(p.teamId);

      const row = document.createElement('div');
      row.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 10px; background: rgba(255,255,255,${isOffline ? '0.02' : '0.05'}); border-radius: 8px; border-left: 4px solid ${teamColor}; opacity: ${isOffline ? '0.65' : '1'};`;

      row.innerHTML = `
        <div>
          <b style="color: #fff; font-size: 13px;">${escapeHtml(p.callsign || 'Боец')}</b> 
          <span style="font-size: 11px; color: ${teamColor};">(${p.teamId})</span>
          <span style="font-size: 11px; color: var(--text-dim); margin-left: 4px;">[${isOrg ? 'Орг' : (isCaptain ? 'Капитан' : 'Боец')}]</span>
          ${isOffline ? '<span style="font-size: 10px; color: var(--color-red); margin-left: 4px; font-weight: 700;">[ОФФЛАЙН]</span>' : ''}
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          ${!isOrg ? `
            <button class="btn-secondary" style="padding: 5px 8px; font-size: 11px; border-radius: 6px;" id="btn_capt_${p.id}">
              ${isCaptain ? 'Снять' : 'Капитан'}
            </button>
            <button class="btn-secondary" style="padding: 5px 8px; font-size: 11px; border-radius: 6px; background: rgba(255,51,75,0.2); border-color: rgba(255,51,75,0.4); color: #ff334b;" id="btn_kick_${p.id}" title="Удалить из лобби">
              ✕
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

      const kickBtn = document.getElementById(`btn_kick_${p.id}`);
      if (kickBtn) {
        kickBtn.onclick = () => {
          if (confirm(`Удалить бойца "${p.callsign}" из лобби?`)) {
            TacticalNetwork.kickPlayer(p.id, () => {
              showToast(`Боец ${p.callsign} удален`, '#ff334b');
            });
          }
        };
      }
    });
  }

  // 13. ТАКТИЧЕСКАЯ МЕТКА
  if (btnAddTactical) {
    btnAddTactical.onclick = () => {
      if (window.TacticalAudio) TacticalAudio.playClick();
      if (modalTactical) modalTactical.classList.remove('hidden');
    };
  }
  if (btnCloseTactical) {
    btnCloseTactical.onclick = () => {
      if (modalTactical) modalTactical.classList.add('hidden');
    };
  }

  if (btnSubmitTactical) {
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
      if (modalTactical) modalTactical.classList.add('hidden');
      document.getElementById('input-marker-desc').value = '';
      showToast('Метка установлена!', '#f59e0b');
    };
  }

  // Всплывающие сообщения (Toast)
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
  window.performLeaveLobby = performLeaveLobby;
})();
