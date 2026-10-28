FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY cloud/crypto.js ./cloud/crypto.js
COPY history-recovery-contract.js ./history-recovery-contract.js
COPY gateway ./gateway
ENV NODE_ENV=production
CMD ["node", "gateway/server.mjs"]
