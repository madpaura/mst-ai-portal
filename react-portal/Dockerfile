# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}

ARG VITE_AUTH_MODE=open
ENV VITE_AUTH_MODE=${VITE_AUTH_MODE}

ARG VITE_BETA_TAG=
ENV VITE_BETA_TAG=${VITE_BETA_TAG}

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Override main nginx config: move pid to /tmp so non-root nginx user can write it
COPY nginx-main.conf /etc/nginx/nginx.conf
# Template form so the same image works in bridge mode (backend:8000, listen 80)
# and host-network mode (127.0.0.1:${BACKEND_PORT}, listen ${FRONTEND_PORT}).
# The official nginx entrypoint renders /etc/nginx/templates/*.template into
# /etc/nginx/conf.d/ at startup via envsubst.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Defaults — overridden by docker-compose.hostnet.yml when HOST_NETWORK=true
ENV BACKEND_UPSTREAM=backend:8000 \
    NGINX_LISTEN=80 \
    NGINX_ENVSUBST_FILTER=^(BACKEND_UPSTREAM|NGINX_LISTEN)$

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Grant nginx user write access to the directories it needs at runtime,
# including /etc/nginx/conf.d so the entrypoint can write the rendered template.
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html /etc/nginx/conf.d \
    && chmod -R 755 /var/cache/nginx

USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
