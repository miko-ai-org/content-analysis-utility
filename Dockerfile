FROM node:20

# Set working directory
WORKDIR /app

# Copy root package.json and install root deps (concurrently)
COPY package*.json ./
RUN npm install

# Copy frontend and backend separately
COPY ./ ./

# Install frontend dependencies
RUN npm install

# Expose ports
EXPOSE 3000 3000

# Start both frontend and backend concurrently
CMD ["npm", "run", "start"]
