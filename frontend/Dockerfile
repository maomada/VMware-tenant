FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
ENV NODE_ENV=development
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
