FROM node:22-alpine

WORKDIR /app

# Install deps based on lockfile (production only)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy prebuilt JS (built locally via `npm run build`)
COPY dist ./dist

# Bot listens on PORT (Azure injects this). Default for local docker run.
ENV PORT=3978
EXPOSE 3978

CMD ["node", "dist/index.js"]
