FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache python3 make g++ \
	&& npm install

COPY . .

EXPOSE 8080

ENV NODE_ENV=production

CMD ["npm", "start"]
