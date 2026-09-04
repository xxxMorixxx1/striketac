import os
import subprocess
import sys

# Hugging Face Spaces слушает порт 7860
os.environ["PORT"] = "7860"

print("=================================================", flush=True)
print("  ⚡ StrikeTac - Запуск тактического сервера в Hugging Face Space", flush=True)
print("=================================================", flush=True)

try:
    print("[1/2] Проверка зависимостей Node.js...", flush=True)
    subprocess.run(["npm", "install", "--omit=dev"], check=True)
except Exception as e:
    print(f"Предупреждение при npm install: {e}", flush=True)

print("[2/2] Запуск сервера StrikeTac на порту 7860...", flush=True)
proc = subprocess.Popen(["node", "server.js"])
proc.wait()
