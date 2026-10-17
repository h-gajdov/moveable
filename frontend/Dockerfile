FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx/*.template /etc/nginx/templates/
COPY --from=build /app/dist /usr/share/nginx/html
ENV BACKEND_URL=http://backend:8080 \
    MAP_ORIGINS=https://tiles.openfreemap.org \
    NGINX_ENVSUBST_FILTER="^(BACKEND_URL|MAP_ORIGINS)$"
EXPOSE 80
