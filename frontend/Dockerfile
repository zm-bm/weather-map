FROM node:24-bookworm

WORKDIR /app/frontend

COPY frontend/package*.json ./

RUN npm install

COPY config /app/config

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
