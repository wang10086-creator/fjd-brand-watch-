FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY cloud/crypto.js ./cloud/crypto.js
COPY gateway ./gateway
ENV NODE_ENV=production
CMD ["node", "gateway/server.mjs"]
