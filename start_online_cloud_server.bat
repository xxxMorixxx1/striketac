@echo off
chcp 65001 > nul
title STRIKETAC - Тактический Онлайн Сервер (Cloudflare 4G/LTE)
echo ================================================================
echo      STRIKETAC - ОНЛАЙН СЕРВЕР ДЛЯ СТРАЙКБОЛА (4G/LTE ОБЛАКО)
echo ================================================================
echo.
echo 1. Запуск центрального сервера StrikeTac (Socket.IO)...
echo 2. Подключение защищенного облачного шлюза Cloudflare...
echo.
echo Внимание: При закрытии этого окна сервер будет остановлен.
echo ================================================================
echo.

powershell -ExecutionPolicy Bypass -Command "$node = Start-Process node -ArgumentList 'server.js' -PassThru -NoNewWindow; Start-Sleep -Seconds 2; Write-Host 'Центральный сервер активен на порту 3000.' -ForegroundColor Green; Write-Host 'Инициализация глобального облачного HTTPS-канала...' -ForegroundColor Cyan; $cf = Start-Process .\cloudflared.exe -ArgumentList 'tunnel --url http://localhost:3000' -PassThru -NoNewWindow -RedirectStandardError cf.log; $url = $null; for ($i=0; $i -lt 15; $i++) { Start-Sleep -Seconds 1; if (Test-Path cf.log) { $line = Get-Content cf.log | Select-String -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($line -match '(https://[a-zA-Z0-9-]+\.trycloudflare\.com)') { $url = $matches[1]; break; } } }; Write-Host ''; Write-Host '================================================================' -ForegroundColor Yellow; if ($url) { Write-Host '  ВЫДЕЛЕННЫЙ ИНТЕРНЕТ-АДРЕС ДЛЯ 4G ТЕЛЕФОНОВ (ИЗ ЛЮБОЙ ТОЧКИ):' -ForegroundColor Green; Write-Host ('  ' + $url) -ForegroundColor Yellow; Write-Host ''; Write-Host '  Вставьте эту ссылку в приложении (кнопка СЕРВЕР) на смартфонах.' -ForegroundColor White; Write-Host '  Бойцы могут быть за километры в лесу - связь идет через 4G!' -ForegroundColor Cyan; } else { Write-Host '  Ошибка получения ссылки Cloudflare. Проверьте cf.log' -ForegroundColor Red; }; Write-Host '================================================================' -ForegroundColor Yellow; Write-Host 'Сервер работает. Для остановки закройте это окно или нажмите Ctrl+C.'; try { Wait-Process -Id $cf.Id } finally { Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue; Stop-Process -Id $cf.Id -Force -ErrorAction SilentlyContinue; Remove-Item cf.log -ErrorAction SilentlyContinue; }"
