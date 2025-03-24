FROM node:22-alpine AS build-stage
WORKDIR /app
COPY . .
RUN npm install -g pnpm@latest-10
RUN pnpm install
RUN npm i -g @vercel/ncc
RUN ncc build src/main.ts -o dist

FROM node:22-alpine
WORKDIR /app
COPY --from=build-stage /app/dist/index.js .
CMD ["node", "index.js"]
