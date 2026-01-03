#!/usr/bin/env node
/**
 * Script to translate only specific new keys from en.json to all other locale files.
 * Uses @vitalets/google-translate-api for translation.
 */

import { translate } from '@vitalets/google-translate-api';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The new keys to translate (dot-notation paths)
const NEW_KEYS = [
  'onboarding.nextStepsTitle',
  'onboarding.nextStepsSubtitle',
  'onboarding.configureOwnTracks',
  'onboarding.configureOwnTracksDesc',
  'onboarding.importData',
  'onboarding.importDataDesc',
  'onboarding.generateTrips',
  'onboarding.generateTripsDesc',
  'onboarding.configureAI',
  'onboarding.configureAIDesc',
  'onboarding.getStarted',
];

// Target languages (excluding 'en')
const TARGET_LANGS = {
  nl: 'nl', // Dutch
  de: 'de', // German
  fr: 'fr', // French
  es: 'es', // Spanish
  it: 'it', // Italian
  pt: 'pt', // Portuguese
  ru: 'ru', // Russian
  ja: 'ja', // Japanese
  ko: 'ko', // Korean
  zh: 'zh-CN', // Chinese (simplified)
};

function loadJson(filename) {
  const filepath = join(__dirname, filename);
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

function saveJson(data, filename) {
  const filepath = join(__dirname, filename);
  writeFileSync(filepath, JSON.stringify(data, null, '\t') + '\n', 'utf-8');
}

function getNestedValue(data, path) {
  const keys = path.split('.');
  let current = data;
  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = current[key];
    } else {
      return null;
    }
  }
  return current;
}

function setNestedValue(data, path, value) {
  const keys = path.split('.');
  let current = data;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateText(text, targetLang) {
  try {
    const result = await translate(text, { to: targetLang });
    return result.text;
  } catch (error) {
    console.error(`  Error translating: ${error.message}`);
    return text; // Fallback to English
  }
}

async function translateNewKeys() {
  console.log('Loading English source file...');
  const enData = loadJson('en.json');

  // Extract values for new keys
  const keysToTranslate = [];
  for (const keyPath of NEW_KEYS) {
    const value = getNestedValue(enData, keyPath);
    if (value) {
      keysToTranslate.push({ keyPath, value });
      console.log(`  Found: ${keyPath} = "${value}"`);
    } else {
      console.log(`  Warning: Key not found: ${keyPath}`);
    }
  }

  console.log(`\nTotal keys to translate: ${keysToTranslate.length}\n`);

  for (const [fileLang, googleLang] of Object.entries(TARGET_LANGS)) {
    const filename = `${fileLang}.json`;
    console.log(`Processing ${filename}...`);

    let targetData;
    try {
      targetData = loadJson(filename);
    } catch (error) {
      console.log(`  Skipping ${filename} - file not found`);
      continue;
    }

    for (const { keyPath, value: enValue } of keysToTranslate) {
      try {
        // Translate the text
        const translatedText = await translateText(enValue, googleLang);

        // Set the translated value
        setNestedValue(targetData, keyPath, translatedText);
        console.log(`  ${keyPath}: "${translatedText}"`);

        // Small delay to avoid rate limiting
        await sleep(200);
      } catch (error) {
        console.log(`  Error translating ${keyPath}: ${error.message}`);
        // Keep the English value as fallback
        setNestedValue(targetData, keyPath, enValue);
      }
    }

    // Save the updated file
    saveJson(targetData, filename);
    console.log(`  Saved ${filename}\n`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Translating new onboarding keys to all locales');
  console.log('='.repeat(60) + '\n');

  try {
    await translateNewKeys();
    console.log('='.repeat(60));
    console.log('Translation complete!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error(`Critical Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
