#!/bin/sh
echo "Installing Node Version Manager"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
nvm install 20

echo "Node and NPM version"
node -v
npm -v

echo "Reinstall PNPM"
npm uninstall -g pnpm
npm install -g pnpm

echo "Preparing to build site..."
rm -rf node_modules
pnpm install
pnpm run docs:build