#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

function usage() {
  console.log('Usage: node set-e2e-env.js --url <SUPABASE_URL> --anon <ANON_KEY> [--service <SERVICE_ROLE_KEY>] [--dry-run]')
  process.exit(1)
}

const argv = require('minimist')(process.argv.slice(2))
if (!argv.url || !argv.anon) usage()

const envPath = path.resolve(__dirname, '..', '.env.test')
let content = fs.readFileSync(envPath, 'utf8')

function setOrAppend(key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`)
  } else {
    content += `\n${key}=${value}\n`
  }
}

setOrAppend('NEXT_PUBLIC_SUPABASE_URL', argv.url)
setOrAppend('NEXT_PUBLIC_SUPABASE_ANON_KEY', argv.anon)
if (argv.service) setOrAppend('SUPABASE_SERVICE_ROLE_KEY', argv.service)

if (argv['dry-run']) {
  console.log('--- DRY RUN: .env.test content preview ---')
  console.log(content)
  process.exit(0)
}

fs.writeFileSync(envPath, content, 'utf8')
console.log('Updated .env.test with e2e Supabase values.')
