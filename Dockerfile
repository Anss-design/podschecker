# Small image on purpose — Deplexo's free tier caps disk at 250MB and
# RAM at 128MB, so we keep the base image and dependency footprint
# minimal (alpine + production-only installs, no build toolchain needed
# since nothing in this app requires native compilation).

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# The app reads PORT from the environment (defaulting to 3000 if unset),
# which matches how most platforms, including Deplexo, assign ports.
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
