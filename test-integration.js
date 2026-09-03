const io = require('socket.io-client');
const fs = require('fs');

async function runTest() {
  console.log('--- НАЧАЛО ТЕСТА ВЗАИМОДЕЙСТВИЯ STRIKETAC ---');

  const hostSocket = io('http://localhost:3000');
  const fighterSocket = io('http://localhost:3000');

  await Promise.all([
    new Promise(res => hostSocket.on('connect', res)),
    new Promise(res => fighterSocket.on('connect', res))
  ]);
  console.log('✔ Оба сокета успешно подключились к серверу');

  // 1. Организатор создает лобби
  let lobbyCode = 'TEST99';
  let hostPlayerId = null;
  await new Promise((resolve, reject) => {
    hostSocket.emit('lobby:create', {
      name: 'Битва за Лесной Бор',
      code: lobbyCode,
      callsign: 'Шериф',
      respawnMode: 'helicopter',
      helicopterIntervalMinutes: 15,
      teamId: 'yellow',
      lat: 55.7512,
      lng: 37.6184
    }, (res) => {
      if (res.error) return reject(new Error(res.error));
      hostPlayerId = res.playerId;
      console.log(`✔ Организатор создал лобби #${res.lobbyCode}, ID: ${res.playerId}`);
      resolve();
    });
  });

  // 2. Второй игрок подключается к лобби
  let fighterPlayerId = null;
  await new Promise((resolve, reject) => {
    fighterSocket.emit('lobby:join', {
      code: lobbyCode,
      callsign: 'Ворон',
      teamId: 'blue',
      lat: 55.7530,
      lng: 37.6210
    }, (res) => {
      if (res.error) return reject(new Error(res.error));
      fighterPlayerId = res.playerId;
      console.log(`✔ Боец Ворон вошел в лобби #${lobbyCode}, команда Синие, ID: ${res.playerId}`);
      resolve();
    });
  });

  // 3. Организатор загружает KMZ файл полигона
  const kmzBuffer = fs.readFileSync('sample_poligon.kmz');
  const kmzBase64 = kmzBuffer.toString('base64');

  const kmzReceivedPromise = new Promise(resolve => {
    fighterSocket.on('kmz:updated', (data) => {
      console.log(`✔ Боец Ворон получил карту KMZ! Объектов на полигоне: ${data.boundary.features.length}`);
      resolve(data);
    });
  });

  await new Promise((resolve, reject) => {
    hostSocket.emit('kmz:upload', {
      lobbyCode: lobbyCode,
      fileBase64: kmzBase64,
      fileName: 'poligon_lesnoy.kmz'
    }, (res) => {
      if (res.error) return reject(new Error(res.error));
      console.log(`✔ Организатор успешно загрузил KMZ на сервер! Обработано ${res.featuresCount} зон.`);
      resolve();
    });
  });

  await kmzReceivedPromise;

  // 4. Боец отправляет перемещение по GPS
  const moveReceivedPromise = new Promise(resolve => {
    hostSocket.on('player:moved', (data) => {
      if (data.playerId === fighterPlayerId) {
        console.log(`✔ Хост увидел перемещение бойца Ворон: [${data.lat}, ${data.lng}], курс: ${data.heading}°`);
        resolve(data);
      }
    });
  });

  fighterSocket.emit('gps:update', {
    lobbyCode: lobbyCode,
    lat: 55.7535,
    lng: 37.6215,
    heading: 145,
    speed: 2.1,
    accuracy: 4
  });

  await moveReceivedPromise;

  // 5. Боец переключает статус: Поражен
  const hitReceivedPromise = new Promise(resolve => {
    hostSocket.on('player:status_changed', (data) => {
      if (data.playerId === fighterPlayerId && data.status === 'hit') {
        console.log(`✔ Сервер и хост зафиксировали статус ПОРАЖЕН у бойца ${data.callsign}`);
        resolve(data);
      }
    });
  });

  fighterSocket.emit('status:update', { lobbyCode: lobbyCode, status: 'hit' });
  await hitReceivedPromise;

  // 6. Боец заходит в мертвяк
  const respawnReceivedPromise = new Promise(resolve => {
    hostSocket.on('player:status_changed', (data) => {
      if (data.playerId === fighterPlayerId && data.status === 'respawn') {
        console.log(`✔ Боец ${data.callsign} зашел в мертвяк, запущен таймер.`);
        resolve(data);
      }
    });
  });

  fighterSocket.emit('status:update', { lobbyCode: lobbyCode, status: 'respawn' });
  await respawnReceivedPromise;

  // 7. Боец подтверждает выход из мертвяка по вертолету
  const exitReceivedPromise = new Promise(resolve => {
    hostSocket.on('player:status_changed', (data) => {
      if (data.playerId === fighterPlayerId && data.status === 'alive') {
        console.log(`✔ Боец ${data.callsign} подтвердил выход из мертвяка и вернулся в строй!`);
        resolve(data);
      }
    });
  });

  fighterSocket.emit('respawn:confirm_exit', { lobbyCode: lobbyCode });
  await exitReceivedPromise;

  // 8. Организатор назначает бойца Ворона капитаном команды Синих
  const captainPromise = new Promise(resolve => {
    fighterSocket.on('team:captain_updated', (data) => {
      if (data.targetPlayerId === fighterPlayerId && data.newRole === 'captain') {
        console.log(`✔ Боец Ворон получил назначение КАПИТАНОМ команды ${data.teamId}!`);
        resolve(data);
      }
    });
  });

  hostSocket.emit('team:set_captain', {
    lobbyCode: lobbyCode,
    targetPlayerId: fighterPlayerId,
    teamId: 'blue',
    isCaptain: true
  });
  await captainPromise;

  // 9. Капитан Ворон ставит тактическую метку "Враг замечен"
  const markerPromise = new Promise(resolve => {
    hostSocket.on('tactical:marker_added', (data) => {
      console.log(`✔ Тактическая метка получена: "${data.marker.title}" (тип: ${data.marker.type}) от ${data.marker.authorCallsign}`);
      resolve(data);
    });
  });

  fighterSocket.emit('tactical:add_marker', {
    lobbyCode: lobbyCode,
    type: 'enemy',
    title: 'Враг замечен',
    description: '3 бойца у контрольной точки',
    lat: 55.7538,
    lng: 37.6212
  });
  await markerPromise;

  hostSocket.disconnect();
  fighterSocket.disconnect();

  console.log('==================================================');
  console.log('🎉 ВСЕ ИНТЕГРАЦИОННЫЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ!');
  console.log('==================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Ошибка теста:', err);
  process.exit(1);
});
