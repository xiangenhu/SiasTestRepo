FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web ./web
COPY scripts ./scripts
RUN npm run build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server.js backend.js llm.js ./
COPY --chown=node:node data ./data
COPY --chown=node:node public ./public
COPY --from=build --chown=node:node /app/public/app.js ./public/app.js
USER node
EXPOSE 8080
CMD ["node", "server.js"]
