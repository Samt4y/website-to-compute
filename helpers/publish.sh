#!/bin/bash
# This script runs when you hit the Publish button.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}" || exit 1

PROJECT="${GITHUB_USER:-}-${RepositoryName:-}"
DOMAIN="?"
CONFIRM="🚨 Deploy a Compute app for this repo in your Fastly account and publish your website content? (y/n) "
NPX_ENV_PREFIX="NPM_CONFIG_STRICT_SSL=${NPM_CONFIG_STRICT_SSL:-false}"

if [ -z "${FASTLY_API_TOKEN:-}" ]; then
  echo '⚠️ Grab a Fastly API key and add it your repo before deploying! Check out the README for steps. 📖'
  exit 1
fi

if [ "${PROJECT}" = "-" ]; then
  echo '⚠️ Missing GITHUB_USER or RepositoryName. Set them and run publish again.'
  exit 1
fi

# Check if we already have a service for this repo and if so find its domain.
service_line=$(eval "${NPX_ENV_PREFIX} npx --yes @fastly/cli service describe --service-name='${PROJECT}' 2>/dev/null" | sed -n '1p')
service_id=$(printf '%s\n' "${service_line}" | awk '{print $2}')

if [ -n "${service_id}" ]; then
  domain_line=$(eval "${NPX_ENV_PREFIX} npx --yes @fastly/cli domain list --service-id='${service_id}' --version=latest 2>/dev/null" | sed -n '2p')
  domain_host=$(printf '%s\n' "${domain_line}" | awk '{print $3}')
  if [ -n "${domain_host}" ]; then
    DOMAIN="https://${domain_host}"
    CONFIRM="🚨 Update the content in your existing website at ${DOMAIN}? (y/n) "
  fi
fi

printf "%s" "${CONFIRM}"
read -r answer
if [ "$answer" = "${answer#[Yy]}" ]; then
  exit 1
fi

npm run build || { printf '\nOops! Build failed.\n'; exit 1; }

# Ensure app scaffold exists and matches this repo.
if [ ! -d "./deploy/_app" ] || [ ! -f "./deploy/_app/fastly.toml" ]; then
  eval "${NPX_ENV_PREFIX} npx --yes @fastly/compute-js-static-publish@latest --root-dir=./deploy/_site --output=./deploy/_app --kv-store-name='${PROJECT}-content' --name='${PROJECT}'" || { printf '\nOops! Could not create Fastly app scaffold.\n'; exit 1; }
else
  app_name=$(grep '^name' ./deploy/_app/fastly.toml | cut -d= -f2- | tr -d ' "')
  if [ "${app_name}" != "${PROJECT}" ]; then
    rm -rf ./deploy/_app
    eval "${NPX_ENV_PREFIX} npx --yes @fastly/compute-js-static-publish@latest --root-dir=./deploy/_site --output=./deploy/_app --kv-store-name='${PROJECT}-content' --name='${PROJECT}'" || { printf '\nOops! Could not recreate Fastly app scaffold.\n'; exit 1; }
  fi
fi

# Deploy app once if there is no service_id in fastly.toml.
service=$(grep '^service_id' ./deploy/_app/fastly.toml | cut -d= -f2- | tr -d ' "')
if [ -z "${service}" ]; then
  cd ./deploy/_app || exit 1
  eval "${NPX_ENV_PREFIX} npx --yes @fastly/cli compute publish --accept-defaults --auto-yes" || { printf '\nOops! Something went wrong deploying your app.\n'; exit 1; }
else
  cd ./deploy/_app || exit 1
fi

npm run fastly:publish || { printf '\nOops! Something went wrong publishing your content.\n'; exit 1; }

if [ "${DOMAIN}" = "?" ]; then
  domain_line=$(eval "${NPX_ENV_PREFIX} npx --yes @fastly/cli domain list --version=latest 2>/dev/null" | sed -n '2p')
  domain_host=$(printf '%s\n' "${domain_line}" | awk '{print $3}')
  if [ -n "${domain_host}" ]; then
    DOMAIN="https://${domain_host}"
  fi
fi

printf "\nWoohoo check out your site at ${DOMAIN} 🪩 🛼 🎏\n\n"
