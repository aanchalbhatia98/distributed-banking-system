# Use an official Node runtime as a parent image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and install dependencies
# We only copy package.json, and npm install will generate the lock file.
COPY ./src/package.json ./src/
RUN cd src && npm install --production

# Copy the rest of the application source code (server.js)
COPY ./src ./src

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["node", "src/server.js"]