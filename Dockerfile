FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --chown=node:node package.json server.js ./

USER node

EXPOSE 8080

CMD ["node", "server.js"]
