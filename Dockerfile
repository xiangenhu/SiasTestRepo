FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --chown=node:node package.json server.js ./
COPY --chown=node:node public ./public

USER node

EXPOSE 8080

CMD ["node", "server.js"]
