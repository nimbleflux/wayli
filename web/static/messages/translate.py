import json
import asyncio
import sys
from googletrans import Translator
from copy import deepcopy

def load_json(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, filename):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def extract_strings(data, path=[]):
    strings = []
    if isinstance(data, dict):
        for k, v in data.items():
            strings.extend(extract_strings(v, path + [k]))
    elif isinstance(data, list):
        for i, v in enumerate(data):
            strings.extend(extract_strings(v, path + [i]))
    elif isinstance(data, str):
        strings.append((path, data))
    return strings

def set_nested_value(data, path, value):
    current = data
    for step in path[:-1]:
        if isinstance(current, list):
            current = current[int(step)]
        else:
            current = current[step]
            
    if isinstance(current, list):
        current[int(path[-1])] = value
    else:
        current[path[-1]] = value

async def translate_file(input_file, target_langs):
    print(f"Loading {input_file}...")
    original_data = load_json(input_file)
    
    text_entries = extract_strings(original_data)
    total_texts = len(text_entries)
    print(f"Found {total_texts} text strings to translate.\n")

    translator = Translator()
    
    for lang in target_langs:
        print(f"Starting translation to: {lang}")
        translated_data = deepcopy(original_data)
        
        # Translate one by one with small delays to avoid rate limiting
        for idx, (path, text) in enumerate(text_entries):
            try:
                # Await the async translate call
                result = await translator.translate(text, dest=lang)
                set_nested_value(translated_data, path, result.text)
                
                if (idx + 1) % 50 == 0:
                    print(f"  [{lang}] Processed {idx + 1}/{total_texts}")
                
                # Small delay to be polite to the API
                await asyncio.sleep(0.05)
                
            except Exception as e:
                print(f"  Error translating at index {idx}: {e}")
        
        output_filename = f"{lang}.json"
        if lang == 'zh-cn': 
            output_filename = 'zh.json'
            
        save_json(translated_data, output_filename)
        print(f"✓ Completed {output_filename}\n")

async def main():
    # Target languages
    # TARGET_LANGS = ['de', 'fr', 'zh-cn', 'ja']
    TARGET_LANGS = ['pt', 'it', 'ru', 'ko']
    
    print("Starting JSON translation...\n")
    try:
        await translate_file('en.json', TARGET_LANGS)
        print("✓ All translations finished successfully!")
    except KeyboardInterrupt:
        print("\nStopped by user.")
    except Exception as e:
        print(f"✗ Critical Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
