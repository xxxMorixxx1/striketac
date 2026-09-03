/**
 * Главный координатор клиентской логики StrikeTac
 */
(function() {
  // Определение адреса сервера:
  // 1. Из сохраненных настроек (AppStorage)
  // 2. Если открыто в браузере - текущий домен (window.location.origin)
  // 3. Если в приложении Capacitor (Android APK) - сохраненный адрес или автоподсказка
  let serverUrl = AppStorage.getServerUrl();
  const isCapacitor = !!(window.Capacitor || window.location.protocol === 'capacitor:');
  
  if (!serverUrl) {
    if (!isCapacitor && window.location.origin && window.location.origin.startsWith('http')) {
      serverUrl = window.location.origin;
    }
  }

  console.log('[Связь] Инициализация подключения к серверу:', serverUrl || 'авто (текущий хост)');
  let socket = io(serverUrl || undefined, {
    transports: ['websocket', 'polling'],
    timeout: 10000
  });

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
  
  const modalAuth = document.getElementById('modal-auth');
  const tabBtnJoin = document.getElementById('tab-btn-join');
  const tabBtnCreate = document.getElementById('tab-btn-create');
  const formJoin = document.getElementById('form-join');
  const formCreate = document.getElementById('form-create');

  // Панель настройки адреса сервера
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
  const kmzStatusText = document.getElementById('kmz-status-text');
  const organizerPlayersList = document.getElementById('organizer-players-list');

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
      showToast('Адрес сервера сохранен! Переподключение...', '#00ff9d');
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

  // Сеть: Сокет статус
  function updateNetStatusDisplay(online, info = '') {
    if (online) {
      netStatusDot.classList.remove('offline');
      if (serverConnStatus) {
        serverConnStatus.textContent = `Подключено: ${serverUrl || 'Локальный сервер'}`;
        serverConnStatus.style.color = 'var(--color-green)';
      }
    } else {
      netStatusDot.classList.add('offline');
      if (serverConnStatus) {
        serverConnStatus.textContent = info || 'Связь с сервером отсутствует';
        serverConnStatus.style.color = 'var(--color-red)';
      }
    }
  }

  socket.on('connect', () => {
    updateNetStatusDisplay(true);
    console.log('[Связь] Успешно подключено к серверу! Socket ID:', socket.id);
  });

  socket.on('disconnect', () => {
    updateNetStatusDisplay(false, 'Связь потеряна');
    showToast('Связь с сервером потеряна. Работаем в автономном режиме...', '#ff334b');
  });

  socket.on('connect_error', (err) => {
    updateNetStatusDisplay(false, 'Ошибка соединения: ' + (err.message || 'сервер недоступен'));
    console.warn('[Связь] Ошибка подключения к серверу:', err.message);
  });

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

  // Настройка полей режима респауна при создании
  const selectRespawnMode = document.getElementById('select-respawn-mode');
  const groupHelicopter = document.getElementById('group-helicopter-interval');
  const groupTimer = document.getElementById('group-timer-minutes');

  selectRespawnMode.onchange = () => {
    const val = selectRespawnMode.value;
    groupHelicopter.style.display = val === 'helicopter' ? 'flex' : 'none';
    groupTimer.style.display = val === 'timer' ? 'flex' : 'none';
  };

  // ОТПРАВКА ФОРМЫ ВХОДА
  formJoin.onsubmit = (e) => {
    e.preventDefault();
    const code = document.getElementById('input-join-code').value.trim().toUpperCase();
    const callsign = document.getElementById('input-join-callsign').value.trim();
    const password = document.getElementById('input-join-password').value;

    if (!code || !callsign) {
      alert('Пожалуйста, введите код игры и ваш позывной');
      return;
    }

    AppStorage.setCallsign(callsign);
    AppStorage.setLastLobby(code);
    myCallsign = callsign;

    socket.emit('lobby:join', {
      code,
      callsign,
      teamId: myTeamId,
      password,
      lat: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lat : 55.751244,
      lng: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lng : 37.618423
    }, (res) => {
      if (res.error) {
        alert(res.error);
      } else {
        handleJoinSuccess(res.lobbyCode || code, res.playerId, res.lobby);
      }
    });
  };

  // ОТПРАВКА ФОРМЫ СОЗДАНИЯ (ХОСТ)
  formCreate.onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-create-name').value.trim();
    const code = document.getElementById('input-create-code').value.trim().toUpperCase();
    const callsign = document.getElementById('input-create-callsign').value.trim();
    const respawnMode = selectRespawnMode.value;
    const helicopterInterval = parseInt(document.getElementById('select-helicopter-interval').value);
    const timerMinutes = parseInt(document.getElementById('input-timer-minutes').value);
    const kmzFileInput = document.getElementById('input-create-kmz');

    AppStorage.setCallsign(callsign);
    myCallsign = callsign;

    socket.emit('lobby:create', {
      name,
      code,
      callsign,
      respawnMode,
      respawnTimeMinutes: timerMinutes,
      helicopterIntervalMinutes: helicopterInterval,
      teamId: myTeamId,
      lat: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lat : 55.751244,
      lng: TacticalGPS.currentCoords ? TacticalGPS.currentCoords.lng : 37.618423
    }, async (res) => {
      if (res.error) {
        alert(res.error);
      } else {
        const finalCode = res.lobbyCode;
        AppStorage.setLastLobby(finalCode);
        handleJoinSuccess(finalCode, res.playerId, res.lobby);

        // Если был выбран KMZ файл при создании — загружаем его сразу
        if (kmzFileInput.files && kmzFileInput.files[0]) {
          uploadKmzFile(kmzFileInput.files[0]);
        }
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

    // Скрываем окно авторизации и показываем панель статуса
    modalAuth.classList.add('hidden');
    statusBar.style.display = 'flex';

    // Настройка респауна
    RespawnManager.init({
      mode: lobby.respawnMode,
      timerMinutes: lobby.respawnTimeMinutes,
      helicopterIntervalMinutes: lobby.helicopterIntervalMinutes,
      onExitConfirmed: () => {
        socket.emit('respawn:confirm_exit', { lobbyCode: currentLobbyCode }, () => {
          showToast('Вы вернулись в бой!', '#00ff9d');
        });
      }
    });

    // Проверка прав капитана/организатора для отображения кнопок
    updatePermissionButtons();

    // Загрузка сохраненных границ из локального кэша (если сервер не передал или оффлайн)
    if (lobby.boundary) {
      TacticalMap.renderBoundary(lobby.boundary);
      AppStorage.saveBoundary(code, lobby.boundary, lobby.boundaryFileName);
    } else {
      const cached = AppStorage.getBoundary(code);
      if (cached && cached.boundary) {
        TacticalMap.renderBoundary(cached.boundary);
        showToast('Загружены локальные границы полигона из памяти', '#00bfff');
      }
    }

    // Отрисовка всех текущих игроков на карте
    renderAllPlayers(lobby);

    // Отрисовка существующих тактических маркеров
    if (lobby.tacticalMarkers) {
      lobby.tacticalMarkers.forEach(m => {
        TacticalMap.addTacticalMarker(m, (markerId) => {
          socket.emit('tactical:remove_marker', { lobbyCode: currentLobbyCode, markerId });
        });
      });
    }

    // Запуск GPS трекинга
    TacticalGPS.init((coords) => {
      // Обновляем свое положение локально
      if (lobby.players[myPlayerId]) {
        lobby.players[myPlayerId].lat = coords.lat;
        lobby.players[myPlayerId].lng = coords.lng;
        lobby.players[myPlayerId].heading = coords.heading;
        TacticalMap.updatePlayerMarker(lobby.players[myPlayerId], getTeamColor(myTeamId));
      }
      // Отправляем на сервер
      socket.emit('gps:update', {
        lobbyCode: currentLobbyCode,
        lat: coords.lat,
        lng: coords.lng,
        heading: coords.heading,
        speed: coords.speed,
        accuracy: coords.accuracy
      });
    });

    showToast(`Вы вошли в игру #${code}!`, '#00ff9d');
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
  }

  // СЕТЕВЫЕ СОБЫТИЯ SOCKET.IO

  // Обновление карты KMZ от организатора
  socket.on('kmz:updated', (data) => {
    TacticalMap.renderBoundary(data.boundary);
    AppStorage.saveBoundary(currentLobbyCode, data.boundary, data.fileName);
    showToast(`🗺️ Новая карта «${data.fileName}» сохранена на устройство!`, '#00ff9d');
    if (kmzStatusText) kmzStatusText.textContent = `Загружен: ${data.fileName}`;
  });

  // Новый игрок подключился
  socket.on('player:joined', (data) => {
    if (currentLobbyData && currentLobbyData.players) {
      currentLobbyData.players[data.player.id] = data.player;
    }
    TacticalMap.updatePlayerMarker(data.player, getTeamColor(data.player.teamId));
    showToast(`Боец ${data.player.callsign} вошел в игру`, getTeamColor(data.player.teamId));
  });

  // Перемещение другого игрока по GPS
  socket.on('player:moved', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      const p = currentLobbyData.players[data.playerId];
      p.lat = data.lat;
      p.lng = data.lng;
      p.heading = data.heading;
      TacticalMap.updatePlayerMarker(p, getTeamColor(p.teamId));
    }
  });

  // Смена статуса бойца
  socket.on('player:status_changed', (data) => {
    if (currentLobbyData && currentLobbyData.players && currentLobbyData.players[data.playerId]) {
      const p = currentLobbyData.players[data.playerId];
      p.status = data.status;
      p.respawnStartTime = data.respawnStartTime;
      TacticalMap.updatePlayerMarker(p, getTeamColor(p.teamId));
    }

    // Если статус сменился у меня
    if (data.playerId === myPlayerId) {
      document.querySelectorAll('.status-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === data.status);
      });

      if (data.status === 'respawn') {
        respawnBanner.classList.remove('hidden');
        if (RespawnManager.mode === 'timer') {
          RespawnManager.startIndividualTimer();
        }
      } else if (data.status === 'alive') {
        respawnBanner.classList.add('hidden');
      } else if (data.status === 'hit') {
        TacticalAudio.playHitSound();
      }
    } else {
      // Оповещение о товарище
      if (data.status === 'hit') {
        showToast(`💀 ${data.callsign} поражен!`, '#ff334b');
      } else if (data.status === 'alive' && data.message) {
        showToast(`🟢 ${data.message}`, '#00ff9d');
      }
    }
  });

  // Назначение капитана
  socket.on('team:captain_updated', (data) => {
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
  socket.on('tactical:marker_added', (data) => {
    TacticalMap.addTacticalMarker(data.marker, (markerId) => {
      socket.emit('tactical:remove_marker', { lobbyCode: currentLobbyCode, markerId });
    });
    TacticalAudio.playTacticalAlert();
    showToast(`📍 [${data.marker.authorCallsign}]: ${data.marker.title}`, '#f59e0b');
  });

  // Удаление тактической метки
  socket.on('tactical:marker_removed', (data) => {
    TacticalMap.removeTacticalMarker(data.markerId);
  });

  // КНОПКИ НИЖНЕЙ ПАНЕЛИ СТАТУСА (Один клик под перчатки)
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = () => {
      const status = btn.dataset.status;
      TacticalAudio.playClick();
      socket.emit('status:update', { lobbyCode: currentLobbyCode, status });
    };
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

  // Загрузка KMZ из панели организатора
  inputUploadKmz.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      uploadKmzFile(e.target.files[0]);
    }
  };

  function uploadKmzFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result.split(',')[1];
      showToast('Обработка и загрузка KMZ полигона...', '#00bfff');
      socket.emit('kmz:upload', {
        lobbyCode: currentLobbyCode,
        fileBase64: base64,
        fileName: file.name
      }, (res) => {
        if (res && res.error) {
          alert(res.error);
        } else {
          showToast(`Полигон «${file.name}» успешно разослан бойцам!`, '#00ff9d');
        }
      });
    };
    reader.readAsDataURL(file);
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
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 4px solid ' + teamColor;

      row.innerHTML = `
        <div>
          <b style="color: #fff;">${p.callsign}</b> 
          <span style="font-size: 11px; color: ${teamColor};">(${p.teamId})</span>
          <span style="font-size: 11px; color: var(--text-dim); margin-left: 6px;">[${isOrg ? 'Орг' : (isCaptain ? 'Капитан' : 'Боец')}]</span>
        </div>
        <div>
          ${!isOrg ? `
            <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" id="btn_capt_${p.id}">
              ${isCaptain ? 'Снять капитана' : 'Сделать капитаном'}
            </button>
          ` : '<span style="font-size: 11px; color: var(--color-green);">Хост</span>'}
        </div>
      `;

      organizerPlayersList.appendChild(row);

      const captBtn = document.getElementById(`btn_capt_${p.id}`);
      if (captBtn) {
        captBtn.onclick = () => {
          socket.emit('team:set_captain', {
            lobbyCode: currentLobbyCode,
            targetPlayerId: p.id,
            teamId: p.teamId,
            isCaptain: !isCaptain
          });
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

    socket.emit('tactical:add_marker', {
      lobbyCode: currentLobbyCode,
      type,
      title: typeNames[type] || 'Метка',
      description: desc,
      lat: targetLat,
      lng: targetLng
    }, () => {
      modalTactical.classList.add('hidden');
      document.getElementById('input-marker-desc').value = '';
    });
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
