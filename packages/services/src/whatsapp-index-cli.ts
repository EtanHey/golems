#!/usr/bin/env bun
/**
 * WhatsApp Index CLI
 *
 * Usage: golems index-whatsapp <export.txt> --chat "Chat Name"
 */

import { indexWhatsAppChat } from '@golems/shared/lib/whatsapp-indexer';

const args = process.argv.slice(2);

function printUsage() {
  console.log(`
Usage: golems index-whatsapp <export.txt> --chat "Chat Name"

Arguments:
  <export.txt>        Path to WhatsApp .txt export file
  --chat "Name"       Name of the chat (required)
  --gap-minutes N     Time window for grouping messages (default: 5)

Examples:
  golems index-whatsapp family-chat.txt --chat "Family Group"
  golems index-whatsapp john.txt --chat "John Doe" --gap-minutes 10

Export WhatsApp chat:
  1. Open chat in WhatsApp
  2. Click ⋮ menu → More → Export chat
  3. Choose "Without Media"
  4. Save .txt file
  `);
  process.exit(1);
}

// Parse arguments
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printUsage();
}

const exportPath = args[0];
let chatName: string | null = null;
let gapMinutes = 5;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--chat' && args[i + 1]) {
    chatName = args[i + 1];
    i++;
  } else if (args[i] === '--gap-minutes' && args[i + 1]) {
    gapMinutes = parseInt(args[i + 1], 10);
    i++;
  }
}

if (!exportPath) {
  console.error('Error: Missing export file path');
  printUsage();
}

if (!chatName) {
  console.error('Error: --chat is required');
  printUsage();
}

// Check if file exists
const fs = require('fs');
if (!fs.existsSync(exportPath)) {
  console.error(`Error: File not found: ${exportPath}`);
  process.exit(1);
}

// Run indexer
indexWhatsAppChat(exportPath, chatName!, { groupGapMinutes: gapMinutes })
  .then(() => {
    console.log('\n✓ WhatsApp chat indexed successfully');
    console.log('Search with: brainlayer search-fast "query" --project whatsapp');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Indexing failed:', error.message);
    process.exit(1);
  });
