const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.clear();
console.log('\x1b[36m================================================================\x1b[0m');
console.log('\x1b[33m       STRIKETAC - ТАКТИЧЕСКИЙ ОНЛАЙН СЕРВЕР (4G / LTE)        \x1b[0m');
console.log('\x1b[36m================================================================\x1b[0m\n');

// 1. Проверяем cloudflared.exe
const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
if (!fs.existsSync(cloudflaredPath)) {
  console.log('\x1b[33m[1/3] Загрузка шлюза Cloudflare Tunnel (cloudflared.exe)...\x1b[0m');
  try {
    execSync('curl.exe -L --fail --silent --show-error -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe', { cwd: __dirname });
  } catch (e) {
    console.error('\x1b[31m[ОШИБКА] Не удалось загрузить cloudflared.exe\x1b[0m', e.message);
    process.exit(1);
  }
}

// 2. Запуск server.js
console.log('\x1b[37m[1/3] Запуск центрального сервера StrikeTac (Socket.IO)...\x1b[0m');
const nodeProc = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: ['ignore', 'inherit', 'inherit']
});

nodeProc.on('error', (err) => {
  console.error('\x1b[31m[ОШИБКА] Не удалось запустить server.js:\x1b[0m', err.message);
  process.exit(1);
});

// 3. Запуск Cloudflare Tunnel
console.log('\x1b[37m[2/3] Подключение глобального защищенного 4G-шлюза Cloudflare...\x1b[0m');
console.log('\x1b[90m  -> Выделение публичного интернет-адреса...\x1b[0m\n');

const cfProc = spawn(cloudflaredPath, ['tunnel', '--url', 'http://127.0.0.1:3000'], {
  cwd: __dirname
});

let foundUrl = false;

function scanOutput(data) {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match && !foundUrl) {
    foundUrl = true;
    const url = match[0];
    console.log('\x1b[32m================================================================\x1b[0m');
    console.log('\x1b[32m [3/3] СЕРВЕР УСПЕШНО ВЫВЕДЕН В ОНЛАЙН!\x1b[0m\n');
    console.log('\x1b[33m ВЫДЕЛЕННЫЙ ИНТЕРНЕТ-АДРЕС ДЛЯ ТЕЛЕФОНОВ:\x1b[0m');
    console.log(` \x1b[36m>>> ${url} <<<\x1b[0m\n`);
    console.log('\x1b[37m Инструкция для бойцов и организатора:\x1b[0m');
    console.log(' 1. Откройте StrikeTac на смартфонах.');
    console.log(' 2. В окне входа нажмите кнопку [СЕРВЕР] в правом верхнем углу.');
    console.log(` 3. Вставьте этот адрес: ${url} и нажмите [Сохранить].`);
    console.log(' 4. Бойцы подключаются через 4G/LTE из любой точки полигона!\n');
    console.log('\x1b[32m================================================================\x1b[0m');
    console.log('\x1b[33mСервер работает. Не закрывайте это окно во время игры!\x1b[0m');
    console.log('\x1b[90mДля остановки нажмите Ctrl+C или закройте это окно.\x1b[0m\n');
  }
}

cfProc.stdout.on('data', scanOutput);
cfProc.stderr.on('data', scanOutput);

cfProc.on('error', (err) => {
  console.error('\x1b[31m[ОШИБКА] Сбой шлюза Cloudflare:\x1b[0m', err.message);
});

function cleanup() {
  try { nodeProc.kill(); } catch (e) {}
  try { cfProc.kill(); } catch (e) {}
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
