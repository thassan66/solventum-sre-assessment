FROM node:22-alpine

# Set production environment
ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application source code
COPY server.js .

# Use built-in non-root node user (UID 1000)
USER node

EXPOSE 5000

CMD ["node", "server.js"]
