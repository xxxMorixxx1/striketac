/**
 * Модуль тактической карты Leaflet для StrikeTac (v3.0)
 * Поддержка надежных спутниковых тайлов (Google Hybrid, OSM, Esri),
 * полигонов KMZ, меток бойцов, оффлайн-индикации и тактических приказов
 */
const TacticalMap = {
  map: null,
  layers: {},
  currentBaseLayer: 'google',
  
  boundaryLayer: null,
  playersMarkers: {},
  tacticalMarkers: {},
  myPlayerId: null,
  isFollowingGPS: true,
  onMapClickForMarker: null,

  init(containerId, initialCenter = [55.751244, 37.618423], zoom = 16) {
    if (this.map) return;

    this.map = L.map(containerId, {
      center: initialCenter,
      zoom: zoom,
      zoomControl: true,
      attributionControl: false
    });

    // 1. Гугл Спутник + Гибрид (дороги, ориентиры, 100% глобальное покрытие полигонов без надписей «Map data not yet available»)
    this.layers.google = L.tileLayer(
      'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      {
        maxZoom: 21,
        maxNativeZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
      }
    );

    // 2. Топографический / Схематичный слой (OpenStreetMap)
    this.layers.osm = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19
      }
    );

    // 3. Спутниковый слой Esri World Imagery (ArcGIS) с ограничением maxNativeZoom: 17,
    // чтобы при приближении тайлы плавно масштабировались и не выдавали серые водяные знаки ошибки
    this.layers.esri = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 20,
        maxNativeZoom: 17
      }
    );

    // По умолчанию включаем Google Hybrid (лучшее качество спутниковых снимков для страйкбола)
    this.currentBaseLayer = 'google';
    this.layers.google.addTo(this.map);

    // Событие смещения карты пользователем (отключает автоследование)
    this.map.on('dragstart', () => {
      this.isFollowingGPS = false;
      const followBtn = document.getElementById('btn-gps-follow');
      if (followBtn) followBtn.classList.remove('active');
    });

    // Клик по карте для установки тактической метки
    this.map.on('click', (e) => {
      if (this.onMapClickForMarker) {
        this.onMapClickForMarker(e.latlng.lat, e.latlng.lng);
      }
    });

    console.log('[Карта] Leaflet тактическая карта успешно запущена со спутником Google Hybrid.');
  },

  // Циклическое переключение слоев карты (Гугл Спутник -> Топо-схема -> Esri ArcGIS)
  toggleMapLayer() {
    let nextLayer = 'osm';
    let label = 'Топо-схема (OSM)';

    if (this.currentBaseLayer === 'google') {
      nextLayer = 'osm';
      label = 'Топо-схема (OSM)';
    } else if (this.currentBaseLayer === 'osm') {
      nextLayer = 'esri';
      label = 'Esri ArcGIS Спутник';
    } else {
      nextLayer = 'google';
      label = 'Гугл Спутник (Гибрид)';
    }

    return this.setLayer(nextLayer, label);
  },

  setLayer(layerKey, labelName) {
    if (!this.layers[layerKey]) return this.currentBaseLayer;

    // Удаляем все базовые слои
    Object.keys(this.layers).forEach(k => {
      if (this.map.hasLayer(this.layers[k])) {
        this.map.removeLayer(this.layers[k]);
      }
    });

    // Добавляем выбранный
    this.layers[layerKey].addTo(this.map);
    this.currentBaseLayer = layerKey;

    const names = {
      google: 'Гугл Спутник (Гибрид)',
      osm: 'Топо-схема (OSM)',
      esri: 'Esri ArcGIS Спутник'
    };

    return {
      id: layerKey,
      name: labelName || names[layerKey] || layerKey
    };
  },

  // Отрисовка границ полигона из KMZ (GeoJSON)
  renderBoundary(geojson) {
    if (!geojson || !geojson.features) return;

    if (this.boundaryLayer) {
      this.map.removeLayer(this.boundaryLayer);
    }

    this.boundaryLayer = L.geoJSON(geojson, {
      style: (feature) => {
        return {
          color: '#00ff9d',
          weight: 3,
          opacity: 0.9,
          dashArray: '8, 6',
          fillColor: '#00ff9d',
          fillOpacity: 0.08
        };
      },
      onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.name) {
          layer.bindTooltip(feature.properties.name, {
            permanent: false,
            direction: 'center',
            className: 'tactical-boundary-tooltip'
          });
        }
      }
    }).addTo(this.map);

    // Центрируем карту на полигоне
    if (geojson.bounds) {
      this.map.fitBounds(geojson.bounds, { padding: [30, 30] });
    } else if (this.boundaryLayer.getBounds().isValid()) {
      this.map.fitBounds(this.boundaryLayer.getBounds(), { padding: [30, 30] });
    }
  },

  // Очистка границы
  clearBoundary() {
    if (this.boundaryLayer) {
      this.map.removeLayer(this.boundaryLayer);
      this.boundaryLayer = null;
    }
  },

  // Создание или обновление метки бойца
  updatePlayerMarker(player, teamColor = '#f59e0b') {
    if (!player || !player.id) return;
    const playerId = player.id;
    const lat = Number(player.lat) || 55.751244;
    const lng = Number(player.lng) || 37.618423;
    const heading = player.heading || 0;
    const isMe = playerId === this.myPlayerId;
    const isOffline = !!player.isOffline;

    let statusClass = '';
    let statusIcon = '';
    if (isOffline) {
      statusClass = 'offline';
      statusIcon = '📡';
    } else if (player.status === 'hit') {
      statusClass = 'hit';
      statusIcon = '💀';
    } else if (player.status === 'respawn') {
      statusClass = 'respawn';
      statusIcon = '⌛';
    } else if (player.status === 'malfunction') {
      statusClass = 'malfunction';
      statusIcon = '🛠️';
    } else {
      statusIcon = player.role === 'captain' ? '⭐' : (player.role === 'organizer' ? '👑' : '▲');
    }

    const offlineBadge = isOffline ? ' <span style="color: #ff334b; font-size: 9px;">[ОФФЛАЙН]</span>' : '';

    const html = `
      <div class="player-map-icon ${isOffline ? 'player-is-offline' : ''}" style="--team-color: ${teamColor}">
        <div class="player-callsign-label" style="--team-color: ${teamColor}">
          ${isMe ? '👤 ' : ''}${escapeHtml(player.callsign || 'Боец')}${offlineBadge}
        </div>
        <div class="player-heading-pointer" style="transform: rotate(${heading}deg);"></div>
        <div class="player-pin-circle ${statusClass}">
          ${statusIcon}
        </div>
      </div>
    `;

    const customIcon = L.divIcon({
      html: html,
      className: 'player-marker-div',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    if (this.playersMarkers[playerId]) {
      this.playersMarkers[playerId].setLatLng([lat, lng]);
      this.playersMarkers[playerId].setIcon(customIcon);
    } else {
      const marker = L.marker([lat, lng], {
        icon: customIcon,
        zIndexOffset: isMe ? 1000 : 500
      }).addTo(this.map);
      this.playersMarkers[playerId] = marker;
    }

    // Отрисовка круга погрешности спутников вокруг своего бойца
    if (isMe && player.accuracy) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = L.circle([lat, lng], {
          radius: player.accuracy,
          color: '#00bfff',
          weight: 1,
          dashArray: '3, 4',
          fillColor: '#00bfff',
          fillOpacity: 0.1
        }).addTo(this.map);
      } else {
        this.accuracyCircle.setLatLng([lat, lng]);
        this.accuracyCircle.setRadius(player.accuracy);
      }
    }

    // Автоматическое следование за своим положением
    if (isMe && this.isFollowingGPS) {
      this.map.panTo([lat, lng], { animate: true, duration: 0.5 });
    }
  },

  // Удаление метки бойца при выходе
  removePlayerMarker(playerId) {
    if (this.playersMarkers[playerId]) {
      this.map.removeLayer(this.playersMarkers[playerId]);
      delete this.playersMarkers[playerId];
    }
  },

  // Очистить все метки бойцов
  clearAllPlayers() {
    Object.keys(this.playersMarkers).forEach(pid => {
      this.map.removeLayer(this.playersMarkers[pid]);
    });
    this.playersMarkers = {};
    if (this.accuracyCircle) {
      this.map.removeLayer(this.accuracyCircle);
      this.accuracyCircle = null;
    }
  },

  // Центрирование на всех бойцах полигона (чтобы никто не терялся за краем экрана)
  fitAllPlayers() {
    const latlngs = [];

    // Координаты всех текущих бойцов
    Object.values(this.playersMarkers).forEach(marker => {
      latlngs.push(marker.getLatLng());
    });

    if (latlngs.length === 0) {
      // Если бойцов нет, центрируем на границе полигона если есть
      if (this.boundaryLayer && this.boundaryLayer.getBounds().isValid()) {
        this.map.fitBounds(this.boundaryLayer.getBounds(), { padding: [30, 30], maxZoom: 17 });
      }
      return;
    }

    if (latlngs.length === 1) {
      this.map.setView(latlngs[0], 17, { animate: true });
      return;
    }

    const bounds = L.latLngBounds(latlngs);
    this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17, animate: true });
    this.isFollowingGPS = false;
    const followBtn = document.getElementById('btn-gps-follow');
    if (followBtn) followBtn.classList.remove('active');
  },

  // Добавление тактического маркера (приказы/враги)
  addTacticalMarker(marker, onDeleteCallback) {
    const id = marker.id;
    const typeIcons = {
      enemy: { icon: '🎯', color: '#ff334b', title: 'ВРАГ ЗАМЕЧЕН' },
      attack: { icon: '⚔️', color: '#f59e0b', title: 'АТАКА' },
      defend: { icon: '🛡️', color: '#00bfff', title: 'ОБОРОНА' },
      rally: { icon: '📍', color: '#00ff9d', title: 'ТОЧКА СБОРА' },
      sos: { icon: '🆘', color: '#ff0055', title: 'НУЖНА ПОМОЩЬ' }
    };

    const info = typeIcons[marker.type] || typeIcons.enemy;

    const html = `
      <div class="tactical-marker-icon" style="--marker-color: ${info.color}">
        <div class="tactical-marker-badge">
          <span>${info.icon}</span>
        </div>
        <div class="tactical-marker-title">${escapeHtml(marker.title || info.title)}</div>
      </div>
    `;

    const customIcon = L.divIcon({
      html: html,
      className: 'tactical-marker-div',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    const m = L.marker([marker.lat, marker.lng], { icon: customIcon, zIndexOffset: 800 }).addTo(this.map);

    const timeStr = new Date(marker.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const popupContent = `
      <div style="color: #000; font-family: monospace; font-size: 12px; min-width: 140px;">
        <b style="color: ${info.color}">${info.icon} ${escapeHtml(marker.title || info.title)}</b><br>
        <i>${escapeHtml(marker.description || '')}</i><br>
        <span style="color: #666;">Автор: ${escapeHtml(marker.authorCallsign)} (${timeStr})</span><br>
        <button id="del_mark_${marker.id}" style="margin-top: 6px; background: #ff334b; color: #fff; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">
          Удалить метку
        </button>
      </div>
    `;

    m.bindPopup(popupContent);
    m.on('popupopen', () => {
      const delBtn = document.getElementById(`del_mark_${marker.id}`);
      if (delBtn && onDeleteCallback) {
        delBtn.onclick = () => {
          onDeleteCallback(marker.id);
          this.map.closePopup();
        };
      }
    });

    this.tacticalMarkers[id] = m;
  },

  // Удаление тактического маркера
  removeTacticalMarker(markerId) {
    if (this.tacticalMarkers[markerId]) {
      this.map.removeLayer(this.tacticalMarkers[markerId]);
      delete this.tacticalMarkers[markerId];
    }
  },

  // Очистка всех тактических маркеров
  clearAllTacticalMarkers() {
    Object.keys(this.tacticalMarkers).forEach(id => {
      this.map.removeLayer(this.tacticalMarkers[id]);
    });
    this.tacticalMarkers = {};
  },

  // Центрирование на себе
  centerOnMe() {
    this.isFollowingGPS = true;
    if (this.myPlayerId && this.playersMarkers[this.myPlayerId]) {
      const latlng = this.playersMarkers[this.myPlayerId].getLatLng();
      this.map.setView(latlng, 17, { animate: true });
    }
  }
};

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.TacticalMap = TacticalMap;
