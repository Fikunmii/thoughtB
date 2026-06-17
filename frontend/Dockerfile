FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
RUN npm install -g http-server
EXPOSE 8080
CMD ["http-server", "dist", "-p", "8080", "--proxy", "http://localhost:8080?"]