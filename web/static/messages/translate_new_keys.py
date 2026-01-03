#!/usr/bin/env python3
"""
Script to translate only specific new keys from en.json to all other locale files.
Uses googletrans for translation.
"""

import json
import asyncio
from googletrans import Translator

# The new keys to translate (dot-notation paths)
NEW_KEYS = [
    "onboarding.nextStepsTitle",
    "onboarding.nextStepsSubtitle",
    "onboarding.configureOwnTracks",
    "onboarding.configureOwnTracksDesc",
    "onboarding.importData",
    "onboarding.importDataDesc",
    "onboarding.generateTrips",
    "onboarding.generateTripsDesc",
    "onboarding.configureAI",
    "onboarding.configureAIDesc",
    "onboarding.getStarted",
]

# Target languages (excluding 'en')
TARGET_LANGS = {
    'nl': 'nl',      # Dutch
    'de': 'de',      # German
    'fr': 'fr',      # French
    'es': 'es',      # Spanish
    'it': 'it',      # Italian
    'pt': 'pt',      # Portuguese
    'ru': 'ru',      # Russian
    'ja': 'ja',      # Japanese
    'ko': 'ko',      # Korean
    'zh': 'zh-cn',   # Chinese (simplified)
}


def load_json(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(data, filename):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent='\t')
        f.write('\n')


def get_nested_value(data, path):
    """Get a value from nested dict using dot notation path."""
    keys = path.split('.')
    current = data
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return None
    return current


def set_nested_value(data, path, value):
    """Set a value in nested dict using dot notation path."""
    keys = path.split('.')
    current = data
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value


async def translate_new_keys():
    print("Loading English source file...")
    en_data = load_json('en.json')

    # Extract values for new keys
    keys_to_translate = []
    for key_path in NEW_KEYS:
        value = get_nested_value(en_data, key_path)
        if value:
            keys_to_translate.append((key_path, value))
            print(f"  Found: {key_path} = \"{value}\"")
        else:
            print(f"  Warning: Key not found: {key_path}")

    print(f"\nTotal keys to translate: {len(keys_to_translate)}\n")

    translator = Translator()

    for file_lang, google_lang in TARGET_LANGS.items():
        filename = f"{file_lang}.json"
        print(f"Processing {filename}...")

        try:
            target_data = load_json(filename)
        except FileNotFoundError:
            print(f"  Skipping {filename} - file not found")
            continue

        for key_path, en_value in keys_to_translate:
            try:
                # Translate the text
                result = await translator.translate(en_value, dest=google_lang)
                translated_text = result.text

                # Set the translated value
                set_nested_value(target_data, key_path, translated_text)
                print(f"  {key_path}: \"{translated_text}\"")

                # Small delay to avoid rate limiting
                await asyncio.sleep(0.1)

            except Exception as e:
                print(f"  Error translating {key_path}: {e}")
                # Keep the English value as fallback
                set_nested_value(target_data, key_path, en_value)

        # Save the updated file
        save_json(target_data, filename)
        print(f"  Saved {filename}\n")


async def main():
    print("=" * 60)
    print("Translating new onboarding keys to all locales")
    print("=" * 60 + "\n")

    try:
        await translate_new_keys()
        print("=" * 60)
        print("Translation complete!")
        print("=" * 60)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"Critical Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
