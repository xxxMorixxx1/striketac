/**
 * Модуль высокоточной геолокации (GPS) и компаса для страйкбола
 * Включает защиту от засыпания экрана (Wake Lock API)
 */
const TacticalGPS = {
  watchId: null,
  currentCoords: null,
  wakeLock: null,
  onLocationUpdate: null,
  simulationMode: false,
  simInterval: null,

  init(callback) {
    this.onLocationUpdate = callback;
    this.requestWakeLock();
    this.startTracking();

    // Слушаем изменение ориентации устройства для компаса
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (event) => {
        if (event.webkitCompassHeading) {
          // iOS compass
          this.updateHeading(event.webkitCompassHeading);
        } else if (event.alpha !== null) {
          // Android compass
          this.updateHeading(360 - event.alpha);
        }
      }, true);
    }
  },

  // Защита экрана от отключения во время игры
  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[GPS] Экран заблокирован от засыпания (WakeLock активен)');

        document.addEventListener('visibilitychange', async () => {
          if (this.wakeLock !== null && document.visibilityState === 'visible') {
            this.wakeLock = await navigator.wakeLock.request('screen');
          }
        });
      }
    } catch (err) {
      console.warn('[GPS] WakeLock не поддерживается браузером:', err);
    }
  },

  // Запуск GPS слежения высокой точности
  startTracking() {
    if (!navigator.geolocation) {
      console.warn('[GPS] Геолокация не поддерживается, включен режим симуляции.');
      this.startSimulation();
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading || (this.currentCoords ? this.currentCoords.heading : 0),
          speed: pos.coords.speed || 0,
          altitude: pos.coords.altitude || 0,
          accuracy: Math.round(pos.coords.accuracy) || 5,
          timestamp: pos.timestamp
        };
        this.currentCoords = coords;
        if (this.onLocationUpdate) {
          this.onLocationUpdate(coords);
        }
      },
      (err) => {
        console.warn('[GPS] Ошибка спутников:', err.message, 'Переключаем на базовые координаты.');
        // Если пользователь не дал доступ к GPS на ПК, переходим в мягкую симуляцию
        if (!this.currentCoords) {
          this.startSimulation();
        }
      },
      options
    );
  },

  updateHeading(heading) {
    if (this.currentCoords && heading !== undefined) {
      this.currentCoords.heading = Math.round(heading);
      if (this.onLocationUpdate) {
        this.onLocationUpdate(this.currentCoords);
      }
    }
  },

  // Режим симуляции для тестирования на компьютере / в помещении
  startSimulation(baseLat = 55.751244, baseLng = 37.618423) {
    if (this.simulationMode) return;
    this.simulationMode = true;
    console.log('[GPS] Активирован режим полигонной симуляции');

    let simLat = baseLat;
    let simLng = baseLng;
    let heading = 0;

    this.currentCoords = {
      lat: simLat,
      lng: simLng,
      heading: 0,
      speed: 1.2,
      accuracy: 3,
      timestamp: Date.now()
    };

    if (this.onLocationUpdate) {
      this.onLocationUpdate(this.currentCoords);
    }

    this.simInterval = setInterval(() => {
      // Имитируем небольшое тактическое перемещение бойца
      simLat += (Math.random() - 0.5) * 0.00015;
      simLng += (Math.random() - 0.5) * 0.00015;
      heading = (heading + (Math.random() - 0.5) * 30 + 360) % 360;

      this.currentCoords = {
        lat: simLat,
        lng: simLng,
        heading: Math.round(heading),
        speed: +(Math.random() * 2 + 0.5).toFixed(1),
        accuracy: 3,
        timestamp: Date.now()
      };

      if (this.onLocationUpdate) {
        this.onLocationUpdate(this.currentCoords);
      }
    }, 2500);
  },

  setSimulationPosition(lat, lng) {
    if (this.currentCoords) {
      this.currentCoords.lat = lat;
      this.currentCoords.lng = lng;
      if (this.onLocationUpdate) {
        this.onLocationUpdate(this.currentCoords);
      }
    }
  },

  stop() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
  }
};

window.TacticalGPS = TacticalGPS;
