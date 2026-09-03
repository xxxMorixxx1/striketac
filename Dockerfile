FROM node:20-alpine

WORKDIR /app

# Копируем зависимости
COPY package*.json ./
RUN npm install --omit=dev

# Копируем исходный код
COPY kmz-parser.js server.js ./
COPY public ./public

ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
