# Stage 1: Build the React/Vite app
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the frontend source
COPY . .

# Build-time API URL for Vite

# Default: use relative API path (works with nginx proxy in Docker + production)
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

# Alternative (not recommended for Docker builds):
# ARG VITE_API_URL=http://localhost:8001/api/v1
# ENV VITE_API_URL=$VITE_API_URL
# This would require the backend to be accessible at localhost:8001
# → only useful when frontend runs outside Docker (npm run dev without proxy)

# Build-time Firebase web SDK config — Vite inlines `import.meta.env.VITE_*` at
# build time, so these MUST be present when `npm run build` runs. They're
# public-by-design (Firebase enforces access via security rules + authorized
# domains), so passing them as build-args is fine. Pass via:
#
#   docker build \
#     --build-arg VITE_FIREBASE_API_KEY=AIza... \
#     --build-arg VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com \
#     --build-arg VITE_FIREBASE_PROJECT_ID=your-project \
#     --build-arg VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app \
#     --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
#     --build-arg VITE_FIREBASE_APP_ID=1:... \
#     -t traitharvest-frontend ./frontend
#
# Or in docker-compose, add `args:` under the `build:` block.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

# Build the production bundle
RUN npm run build

# Stage 2: Serve the built files with nginx
FROM nginx:stable-alpine

# Copy custom nginx config if you want SPA routing support
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the build output from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose nginx port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
