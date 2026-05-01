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
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Grant nginx user write access to the directories it needs at runtime
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /usr/share/nginx/html \
    && chmod -R 755 /var/cache/nginx

USER nginx

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
