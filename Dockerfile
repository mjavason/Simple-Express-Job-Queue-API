# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install OS dependencies
RUN apk add --no-cache bash

# Copy dependency definitions
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build TypeScript code
RUN npm run build

# Expose application port
EXPOSE 5000

# Start app
CMD ["node", "./build/app.js"]
