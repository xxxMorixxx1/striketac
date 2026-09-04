@echo off
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
set "ANDROID_HOME=C:\Android\sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"

echo [1/3] Syncing Capacitor Android assets...
call npx cap sync android
if %ERRORLEVEL% NEQ 0 (
    echo Error during cap sync!
    exit /b %ERRORLEVEL%
)

echo [2/3] Compiling Android APK...
cd android
call gradlew.bat assembleDebug
if %ERRORLEVEL% NEQ 0 (
    echo Error during Gradle build!
    cd ..
    exit /b %ERRORLEVEL%
)
cd ..

echo [3/3] Copying APK to root directory and public web folder...
copy /Y android\app\build\outputs\apk\debug\app-debug.apk StrikeTac.apk
copy /Y android\app\build\outputs\apk\debug\app-debug.apk public\StrikeTac.apk
echo ===================================================
echo BUILD SUCCESS: StrikeTac.apk updated (v1.0.1)!
echo ===================================================
