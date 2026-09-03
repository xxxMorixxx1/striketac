@echo off
chcp 65001 > nul
echo ===================================================
echo     STRIKETAC - Сборка Android APK
echo ===================================================
echo.
echo 1. Синхронизация веб-ресурсов...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Не удалось синхронизировать веб-ресурсы
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 2. Компиляция APK через Gradle...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo [ОШИБКА] Сборка APK завершилась с ошибкой
    cd ..
    pause
    exit /b %ERRORLEVEL%
)
cd ..

echo.
echo 3. Копирование APK в корень проекта...
copy /Y android\app\build\outputs\apk\debug\app-debug.apk StrikeTac.apk > nul

echo.
echo ===================================================
echo ✔ Сборка успешно завершена!
echo Файл: StrikeTac.apk
echo ===================================================
pause
