# Backend Dockerfile (multi-stage)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --production=false
COPY tsconfig.json ./
COPY src ./src
COPY src/database/migrations.sql ./src/database/migrations.sql
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/database/migrations.sql ./dist/database/migrations.sql
# Expose port
EXPOSE 3000
ENV PORT=3000
CMD ["node","dist/index.js"]
