/**
 * Модуль высокоточной геолокации (GPS) и компаса для страйкбола
 * Включает подавление шума/джиттера, фильтрацию погрешностей и WakeLock
 */
const TacticalGPS = {
  watchId: null,
  currentCoords: null,
  rawCoords: null,
  wakeLock: null,
  onLocationUpdate: null,
  isTracking: false,

  // Расчет дистанции между двумя координатами в метрах (формула гаверсинусов)
  getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  init(callback) {
    this.onLocationUpdate = callback;
    this.requestWakeLock();
    this.startTracking();

    // Слушаем компас устройства
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (event) => {
        if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
          this.updateHeading(event.webkitCompassHeading);
        } else if (event.alpha !== null && event.alpha !== undefined) {
          this.updateHeading(360 - event.alpha);
        }
      }, true);
    }
  },

  // Защита экрана от отключения во время боя
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
      console.warn('[GPS] WakeLock не поддерживается:', err);
    }
  },

  // Запуск аппаратного GPS слежения
  startTracking() {
    if (!navigator.geolocation) {
      console.warn('[GPS] Геолокация не поддерживается устройством.');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 1000
    };

    this.isTracking = true;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;
        const rawAccuracy = Math.round(pos.coords.accuracy) || 10;
        const rawSpeed = pos.coords.speed || 0;
        const rawHeading = pos.coords.heading || (this.currentCoords ? this.currentCoords.heading : 0);

        // Игнорируем выбросы с катастрофически низкой точностью (> 40 метров)
        if (rawAccuracy > 40 && this.currentCoords) {
          console.warn('[GPS] Пропущен спутниковый выброс с точностью ±' + rawAccuracy + 'м');
          return;
        }

        let filteredLat = rawLat;
        let filteredLng = rawLng;

        // Подавление джиттера: если боец стоит на месте
        if (this.currentCoords) {
          const dist = this.getDistanceMeters(this.currentCoords.lat, this.currentCoords.lng, rawLat, rawLng);

          // Если смещение меньше 2.5 метров и скорость минимальна — игнорируем дрожание спутников!
          if (dist < 2.5 && rawSpeed < 0.7) {
            filteredLat = this.currentCoords.lat;
            filteredLng = this.currentCoords.lng;
          } else {
            // Экспоненциальное сглаживание для плавности перемещения
            filteredLat = this.currentCoords.lat * 0.25 + rawLat * 0.75;
            filteredLng = this.currentCoords.lng * 0.25 + rawLng * 0.75;
          }
        }

        const coords = {
          lat: filteredLat,
          lng: filteredLng,
          rawLat: rawLat,
          rawLng: rawLng,
          heading: Math.round(rawHeading),
          speed: Math.round(rawSpeed * 3.6), // в км/ч
          altitude: Math.round(pos.coords.altitude || 0),
          accuracy: rawAccuracy,
          timestamp: pos.timestamp
        };

        this.currentCoords = coords;
        if (this.onLocationUpdate) {
          this.onLocationUpdate(coords);
        }
      },
      (err) => {
        console.warn('[GPS] Ошибка спутников:', err.message);
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

  stop() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
  }
};

window.TacticalGPS = TacticalGPS;

