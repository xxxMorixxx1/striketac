/**
 * Модуль Мертвяка и Респауна StrikeTac
 * Поддерживает систему «Вертолет», индивидуальный таймер и подтверждение выхода
 */
const RespawnManager = {
  mode: 'helicopter', // 'helicopter', 'timer', 'instant'
  timerMinutes: 15,
  helicopterIntervalMinutes: 15,
  
  timerInterval: null,
  remainingSeconds: 0,
  isReadyToExit: false,
  onExitConfirmed: null,
  hasAlerted: false,

  init(options = {}) {
    this.mode = options.mode || 'helicopter';
    this.timerMinutes = options.timerMinutes || 15;
    this.helicopterIntervalMinutes = options.helicopterIntervalMinutes || 15;
    this.onExitConfirmed = options.onExitConfirmed || null;

    this.startLoop();
  },

  setMode(mode, timerMinutes, heliInterval) {
    this.mode = mode;
    if (timerMinutes) this.timerMinutes = timerMinutes;
    if (heliInterval) this.helicopterIntervalMinutes = heliInterval;
    this.hasAlerted = false;
    this.isReadyToExit = false;
  },

  // Запуск постоянного отсчета
  startLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      this.tick();
    }, 1000);
  },

  // Отсчет времени
  tick() {
    if (this.mode === 'helicopter') {
      const now = new Date();
      const currentSec = now.getMinutes() * 60 + now.getSeconds();
      const intervalSec = (this.helicopterIntervalMinutes || 15) * 60;
      const passed = Math.floor(currentSec / intervalSec);
      const nextWaveSec = (passed + 1) * intervalSec;
      
      this.remainingSeconds = nextWaveSec - currentSec;

      // Если до вылета осталось 0-5 секунд — вертолет прибыл!
      if (this.remainingSeconds <= 3) {
        if (!this.hasAlerted) {
          if (window.TacticalAudio) window.TacticalAudio.playRespawnAlert();
          this.hasAlerted = true;
        }
        this.isReadyToExit = true;
      } else {
        this.hasAlerted = false;
        this.isReadyToExit = false;
      }
    } else if (this.mode === 'timer') {
      if (this.remainingSeconds > 0) {
        this.remainingSeconds--;
        if (this.remainingSeconds === 0) {
          if (window.TacticalAudio) window.TacticalAudio.playRespawnAlert();
          this.isReadyToExit = true;
        }
      }
    } else if (this.mode === 'instant') {
      this.remainingSeconds = 0;
      this.isReadyToExit = true;
    }

    this.updateUI();
  },

  // Начало отсидки для индивидуального таймера
  startIndividualTimer() {
    this.remainingSeconds = this.timerMinutes * 60;
    this.isReadyToExit = false;
    this.hasAlerted = false;
  },

  // Обновление отображения в баннере
  updateUI() {
    const banner = document.getElementById('respawn-banner');
    const timerElem = document.getElementById('respawn-timer-display');
    const descElem = document.getElementById('respawn-desc-display');
    const exitBtn = document.getElementById('btn-respawn-exit');

    if (!banner || !timerElem || !exitBtn) return;

    const mins = Math.floor(this.remainingSeconds / 60);
    const secs = this.remainingSeconds % 60;
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (this.mode === 'helicopter') {
      descElem.textContent = `СИСТЕМА «ВЕРТОЛЕТ» (каждые ${this.helicopterIntervalMinutes} мин)`;
      timerElem.textContent = timeStr;
      
      if (this.isReadyToExit) {
        timerElem.textContent = 'ВЫЛЕТ!';
        exitBtn.style.display = 'block';
        exitBtn.textContent = 'ВЫЙТИ ИЗ МЕРТВЯКА';
      } else {
        exitBtn.style.display = 'block'; // Позволяем организаторский или досрочный выход при необходимости
        exitBtn.textContent = 'ВЫХОД В БОЙ';
      }
    } else if (this.mode === 'timer') {
      descElem.textContent = `ОТСИДКА В МЕРТВЯКЕ (${this.timerMinutes} МИН)`;
      timerElem.textContent = timeStr;

      if (this.isReadyToExit || this.remainingSeconds === 0) {
        timerElem.textContent = 'ВРЕМЯ ВЫШЛО';
        exitBtn.style.display = 'block';
      } else {
        exitBtn.style.display = 'block';
      }
    } else if (this.mode === 'instant') {
      descElem.textContent = 'РЕЖИМ БЕЗ ОТСИДКИ';
      timerElem.textContent = '00:00';
      exitBtn.style.display = 'block';
    }
  },

  // Подтверждение выхода бойцом
  confirmExit() {
    if (window.TacticalAudio) {
      window.TacticalAudio.playClick();
    }
    if (this.onExitConfirmed) {
      this.onExitConfirmed();
    }
  }
};

window.RespawnManager = RespawnManager;
