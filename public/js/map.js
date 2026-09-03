/**
 * Модуль тактической карты Leaflet для StrikeTac
 * Поддержка спутника, границ KMZ, меток игроков и тактических приказов
 */
const TacticalMap = {
  map: null,
  layers: {},
  currentBaseLayer: 'satellite',
  
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

    // Спутниковый слой (Esri World Imagery)
    this.layers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 18 }
    );

    // Топографический / Схематичный слой (OpenStreetMap)
    this.layers.osm = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19 }
    );

    // По умолчанию включаем спутник (стандарт для страйкбола на полигоне)
    this.layers.satellite.addTo(this.map);

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

    console.log('[Карта] Leaflet инициализирован успешно.');
  },

  // Переключение режима Спутник / Карта
  toggleMapLayer() {
    if (this.currentBaseLayer === 'satellite') {
      this.map.removeLayer(this.layers.satellite);
      this.layers.osm.addTo(this.map);
      this.currentBaseLayer = 'osm';
    } else {
      this.map.removeLayer(this.layers.osm);
      this.layers.satellite.addTo(this.map);
      this.currentBaseLayer = 'satellite';
    }
    return this.currentBaseLayer;
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

    // Если есть границы, плавно центрируем карту на полигоне
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
    const playerId = player.id;
    const lat = player.lat;
    const lng = player.lng;
    const heading = player.heading || 0;
    const isMe = playerId === this.myPlayerId;

    let statusClass = '';
    let statusIcon = '';
    if (player.status === 'hit') {
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

    const html = `
      <div class="player-map-icon" style="--team-color: ${teamColor}">
        <div class="player-callsign-label" style="--team-color: ${teamColor}">
          ${isMe ? '👤 ' : ''}${escapeHtml(player.callsign || 'Боец')}
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
      const marker = L.marker([lat, lng], { icon: customIcon, zIndexOffset: isMe ? 1000 : 500 }).addTo(this.map);
      this.playersMarkers[playerId] = marker;
    }

    // Отрисовка круга реальной погрешности спутников вокруг своего бойца
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
