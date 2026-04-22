# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

ARG VITE_AUTH_MODE=open
ENV VITE_AUTH_MODE=${VITE_AUTH_MODE}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# nginx runs as nginx user (uid 101) by default in the official image.
# Ensure cache/pid directories are writable for that user.
RUN chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx \
    && chmod -R 755 /var/cache/nginx

USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
