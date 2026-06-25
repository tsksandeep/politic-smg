# Frontend dev container (Vite + React). Dev-only image; the production build is served
# as static assets and is not part of the local-dev compose stack.
FROM node:20-alpine AS dev

WORKDIR /app

# Install deps first for layer caching. node_modules stays in the image (an anonymous volume
# in compose shadows the bind mount), so host/container arch differences don't leak.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev"]
